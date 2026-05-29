from flask import Blueprint, request, jsonify, current_app, Response, stream_with_context 
from flask_jwt_extended import jwt_required, get_jwt_identity, verify_jwt_in_request
import logging
import json
import re
import time
import requests
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.runnables import RunnablePassthrough, RunnableLambda
from langchain_core.output_parsers import StrOutputParser
from langchain_mongodb.vectorstores import MongoDBAtlasVectorSearch
from langchain_mongodb.chat_message_histories import MongoDBChatMessageHistory
from langchain_core.runnables.history import RunnableWithMessageHistory
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, message_to_dict
from bson import ObjectId
from langchain_community.chat_models import ChatTongyi
from langchain_deepseek import ChatDeepSeek
from langchain_anthropic import ChatAnthropic

from src.agentic.agent_runner import stream_agentic_response
from src.agentic.tools.base import ToolContext

logger = logging.getLogger(__name__)
chat_bp = Blueprint('chat_routes', __name__)

# Allowed template variables for the chat prompt - others are escaped to avoid LangChain errors
ALLOWED_PROMPT_VARS = {"context", "history", "question"}

def _escape_prompt_variables(text: str) -> str:
    """Escape {var} to {{var}} for any var not in ALLOWED_PROMPT_VARS, so LangChain treats them as literal."""
    if not text:
        return text
    def replacer(m):
        var = m.group(1)
        return m.group(0) if var in ALLOWED_PROMPT_VARS else "{{" + var + "}}"
    return re.sub(r"\{(\w+)\}", replacer, text)

# --- DB Collections ---
# 1. chat_session_metadata: Stores one document per chat session with user_id and config_id.
# 2. chat_histories: Stores all messages from all sessions.

HEYGEN_BASE_URL = "https://api.heygen.com/v1"

def get_heygen_headers():
    return {
        "x-api-key": current_app.config.get("HEY_GEN_API_KEY"),
        "Content-Type": "application/json"
    }

# --- HEYGEN PROXY ROUTES ---

@chat_bp.route('/heygen/create-session', methods=['POST'])
@jwt_required()
def create_heygen_session():
    try:
        data = request.get_json()
        avatar_id = data.get('avatar_id')

        # 1. Create the temporary streaming token
        token_res = requests.post(
            f"{HEYGEN_BASE_URL}/streaming.create_token", 
            headers=get_heygen_headers()
        )
        token_data = token_res.json()
        
        if token_res.status_code != 200:
            return jsonify({"error": "Failed to create HeyGen token", "details": token_data}), token_res.status_code
        
        token = token_data.get("data", {}).get("token")

        # 2. Create the Session (v2)
        session_res = requests.post(
            f"{HEYGEN_BASE_URL}/streaming.new",
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json"
            },
            json={
                "version": "v2", 
                "avatar_id": avatar_id,
                "background": {"type": "color", "value": "#111827"},
                "voice": {"voice_id": ""}
            }
        )
        
        session_data = session_res.json()
        if session_res.status_code != 200:
            logger.error(f"HeyGen v2 Session Error: {session_data}")
            return jsonify({"error": "HeyGen Session Error", "details": session_data}), session_res.status_code

        session_data['data']['heygen_token'] = token
        return jsonify(session_data), 200
    except Exception as e:
        logger.error(f"Internal Error in create_session: {str(e)}")
        return jsonify({"error": str(e)}), 500

@chat_bp.route('/heygen/start-session', methods=['POST'])
@jwt_required()
def start_heygen_session():
    try:
        data = request.get_json()
        response = requests.post(
            f"{HEYGEN_BASE_URL}/streaming.start",
            headers={
                "Authorization": f"Bearer {data.get('heygen_token')}",
                "Content-Type": "application/json"
            },
            json={"session_id": data.get('session_id')}
        )
        return jsonify(response.json()), response.status_code
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@chat_bp.route('/heygen/task', methods=['POST'])
@jwt_required()
def send_heygen_task():
    try:
        data = request.get_json()
        response = requests.post(
            f"{HEYGEN_BASE_URL}/streaming.task",
            headers={
                "Authorization": f"Bearer {data.get('heygen_token')}",
                "Content-Type": "application/json"
            },
            json={
                "session_id": data.get('session_id'),
                "text": data.get('text'),
                "task_type": "repeat"
            }
        )
        return jsonify(response.json()), response.status_code
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@chat_bp.route('/heygen/stop-session', methods=['POST'])
@jwt_required()
def stop_heygen_session():
    try:
        data = request.get_json()
        response = requests.post(
            f"{HEYGEN_BASE_URL}/streaming.stop",
            headers={
                "Authorization": f"Bearer {data.get('heygen_token')}",
                "Content-Type": "application/json"
            },
            json={"session_id": data.get('session_id')}
        )
        return jsonify({"message": "Session closed"}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


# --- CHAT HISTORY & LIST ROUTES ---

@chat_bp.route('/history/<string:chat_id>', methods=['GET'])
def get_chat_history(chat_id):
    """Retrieves the message history for a specific chat session."""
    try:
        history = MongoDBChatMessageHistory(
            connection_string=current_app.config['MONGO_URI'],
            session_id=chat_id,
            database_name=current_app.config['MONGO_DB'].name,
            collection_name="chat_histories"
        )
        history_dicts = [message_to_dict(m) for m in history.messages]
        
        return jsonify({"history": history_dicts}), 200
    except Exception as e:
        logger.error(f"Error fetching history for chat {chat_id}: {e}", exc_info=True)
        return jsonify({"message": "An internal server error occurred."}), 500
    

@chat_bp.route('/chat/list/<string:config_id>', methods=['GET'])
@jwt_required()
def get_chat_list(config_id):
    try:
        user_id = get_jwt_identity()
        db = current_app.config['MONGO_DB']
        metadata_collection = db["chat_session_metadata"]

        pipeline = [
            {
                '$match': {
                    '$or': [
                        {'user_id': user_id},
                        {'user_id': "anonymous"}
                    ],
                    'config_id': config_id
                }
            },
            {'$sort': {'_id': -1}},
            {
                '$lookup': {
                    'from': 'chat_histories',
                    'let': {'session_id_str': '$session_id'},
                    'pipeline': [
                        {'$match': {'$expr': {'$eq': ['$SessionId', '$$session_id_str']}}},
                        {'$sort': {'_id': 1}},
                        {'$limit': 1},
                        {'$project': {'History': 1, '_id': 0}}
                    ],
                    'as': 'first_message_info'
                }
            },
            {
                '$project': {
                    '_id': 1,
                    'session_id': '$session_id',
                    'user_id': '$user_id',
                    'title': 1,
                    'timestamp': {'$dateToString': {'format': '%Y-%m-%dT%H:%M:%S.%LZ', 'date': '$_id'}},
                    'first_message_history': {'$arrayElemAt': ['$first_message_info.History', 0]}
                }
            }
        ]

        sessions_from_db = list(metadata_collection.aggregate(pipeline))
        
        sessions_list = []
        for session in sessions_from_db:
            
            # If the chat is anonymous, claim it for the current user
            if session.get('user_id') == 'anonymous':
                 metadata_collection.update_one(
                    {"_id": session["_id"]},
                    {"$set": {"user_id": user_id}}
                )

            title = session.get('title') or None

            if not title:
                # Old session — generate from first message and cache it
                try:
                    if session.get('first_message_history'):
                        history_data = json.loads(session['first_message_history'])
                        raw = (history_data.get("data", {}).get("content")
                               or history_data.get("content", ""))
                        if raw:
                            title = _generate_chat_title(raw)
                            metadata_collection.update_one(
                                {"_id": session["_id"]},
                                {"$set": {"title": title}}
                            )
                except (json.JSONDecodeError, TypeError, Exception):
                    pass

            if not title:
                title = "New Chat"

            sessions_list.append({
                'session_id': session['session_id'],
                'title': title,
                'timestamp': session['timestamp']
            })

        return jsonify({"sessions": sessions_list}), 200
    except Exception as e:
        logger.error(f"Error fetching chat list for config {config_id}: {e}", exc_info=True)
        return jsonify({"message": "An internal server error occurred."}), 500


@chat_bp.route('/config/<string:config_id>/sessions', methods=['GET'])
@jwt_required()
def get_config_sessions(config_id):
    """Returns all chat sessions for a config. Only accessible by the config owner."""
    try:
        user_id = get_jwt_identity()
        db = current_app.config['MONGO_DB']

        config_doc = db["config_collections"].find_one({"_id": ObjectId(config_id)})
        if not config_doc:
            return jsonify({"message": "Config not found"}), 404
        if str(config_doc.get("user_id", "")) != user_id:
            return jsonify({"message": "Forbidden"}), 403

        metadata_collection = db["chat_session_metadata"]
        users_collection = current_app.config['MONGO_COLLECTION']

        pipeline = [
            {"$match": {"config_id": config_id}},
            {
                "$lookup": {
                    "from": users_collection.name,
                    "let": {"uid": "$user_id"},
                    "pipeline": [
                        {
                            "$match": {
                                "$expr": {
                                    "$and": [
                                        {"$ne": ["$$uid", "anonymous"]},
                                        {"$eq": [{"$toString": "$_id"}, "$$uid"]}
                                    ]
                                }
                            }
                        },
                        {"$project": {"email": 1, "_id": 0}}
                    ],
                    "as": "user_info"
                }
            },
            {
                "$lookup": {
                    "from": "chat_histories",
                    "let": {"sid": "$session_id"},
                    "pipeline": [
                        {"$match": {"$expr": {"$eq": ["$SessionId", "$$sid"]}}},
                        {"$count": "n"}
                    ],
                    "as": "msg_count"
                }
            },
            {
                "$project": {
                    "_id": 0,
                    "session_id": 1,
                    "title": 1,
                    "timestamp": {
                        "$cond": {
                            "if": "$timestamp",
                            "then": {
                                "$dateToString": {
                                    "format": "%Y-%m-%dT%H:%M:%SZ",
                                    "date": {"$toDate": {"$multiply": ["$timestamp", 1000]}}
                                }
                            },
                            "else": {"$dateToString": {"format": "%Y-%m-%dT%H:%M:%SZ", "date": "$_id"}}
                        }
                    },
                    "user_email": {"$ifNull": [{"$arrayElemAt": ["$user_info.email", 0]}, None]},
                    "message_count": {"$ifNull": [{"$arrayElemAt": ["$msg_count.n", 0]}, 0]},
                    "qualtrics_id": 1,
                    "student_label": 1
                }
            },
            {"$sort": {"timestamp": -1}}
        ]

        sessions = list(metadata_collection.aggregate(pipeline))
        return jsonify({"sessions": sessions, "total": len(sessions)}), 200

    except Exception as e:
        logger.error(f"Error fetching sessions for config {config_id}: {e}", exc_info=True)
        return jsonify({"message": "An internal server error occurred."}), 500


@chat_bp.route('/chat/<string:config_id>/<string:chat_id>', methods=['DELETE'])
@jwt_required()
def delete_chat(config_id, chat_id):
    try:
        user_id = get_jwt_identity()
        db = current_app.config['MONGO_DB']
        meta = db["chat_session_metadata"].find_one({
            "session_id": chat_id,
            "config_id": config_id,
            "user_id": user_id
        })
        if not meta:
            return jsonify({"message": "Not found"}), 404
        db["chat_session_metadata"].delete_one({"session_id": chat_id})
        db["chat_histories"].delete_many({"SessionId": chat_id})
        return jsonify({"message": "Deleted"}), 200
    except Exception as e:
        logger.error(f"Error deleting chat {chat_id}: {e}", exc_info=True)
        return jsonify({"message": "An internal server error occurred."}), 500


# --- FACTORY & HELPERS ---

class _AttachedFilesMongoHistory(MongoDBChatMessageHistory):
    """MongoDBChatMessageHistory that injects `attached_files` into the
    `additional_kwargs` of the next HumanMessage it persists.

    Set `pending_attached_files` on the instance before the chain (or
    direct add_user_message call) runs; it's consumed once and cleared.
    """

    def _maybe_inject(self, message):
        files = getattr(self, "pending_attached_files", None) or []
        if (
            files
            and isinstance(message, HumanMessage)
            and not (message.additional_kwargs or {}).get("attached_files")
        ):
            kwargs = dict(message.additional_kwargs or {})
            kwargs["attached_files"] = files
            message = HumanMessage(content=message.content, additional_kwargs=kwargs)
            self.pending_attached_files = []
        return message

    def add_message(self, message):
        super().add_message(self._maybe_inject(message))

    def add_messages(self, messages):
        super().add_messages([self._maybe_inject(m) for m in messages])


def _generate_chat_title(text: str) -> str:
    """Return a 4-6 word summary title for the given user message."""
    try:
        llm = ChatOpenAI(model="gpt-4o-mini", max_tokens=20, temperature=0.3)
        result = llm.invoke([
            HumanMessage(content=(
                "Generate a concise 4-6 word title that summarises this chat opening message. "
                "Return only the title, no quotes, no trailing punctuation.\n\n" + text[:300]
            ))
        ])
        return result.content.strip()
    except Exception:
        words = text.split()
        title, length = "", 0
        for w in words:
            if length + len(w) + 1 > 55:
                break
            title = (title + " " + w).strip()
            length += len(w) + 1
        return title or text[:55]


def get_session_history(session_id: str, user_id: str, config_id: str, user_input: str = None,
                        qualtrics_id: str = None, student_label: str = None,
                        student_email: str = None, marketing_opt_in: bool = None) -> _AttachedFilesMongoHistory:
    db = current_app.config['MONGO_DB']
    metadata_collection = db["chat_session_metadata"]

    # Only write to metadata if this is truly the FIRST message
    if metadata_collection.count_documents({"session_id": session_id}, limit=1) == 0:
        doc = {
            "session_id": session_id,
            "user_id": user_id,
            "config_id": config_id,
            "timestamp": time.time()
        }
        if user_input:
            doc["title"] = _generate_chat_title(user_input)
        if qualtrics_id:
            doc["qualtrics_id"] = qualtrics_id
        if student_label:
            doc["student_label"] = student_label
        if student_email:
            doc["student_email"] = student_email
        if marketing_opt_in is not None:
            doc["marketing_opt_in"] = marketing_opt_in
        metadata_collection.insert_one(doc)
        if student_email:
            db["potential_users"].update_one(
                {"email": student_email},
                {"$set": {
                    "email": student_email,
                    "name": student_label or "",
                    "marketing_opt_in": marketing_opt_in if marketing_opt_in is not None else True,
                    "last_seen": time.time(),
                }, "$setOnInsert": {"first_seen": time.time()}},
                upsert=True,
            )
    elif qualtrics_id or student_label or student_email:
        # Update existing session if we now have identity info we didn't before
        update = {}
        if qualtrics_id:
            update["qualtrics_id"] = qualtrics_id
        if student_label:
            update["student_label"] = student_label
        if student_email:
            update["student_email"] = student_email
        if marketing_opt_in is not None:
            update["marketing_opt_in"] = marketing_opt_in
        metadata_collection.update_one(
            {"session_id": session_id, "qualtrics_id": {"$exists": False}},
            {"$set": update}
        )

    return _AttachedFilesMongoHistory(
        session_id=session_id,
        connection_string=current_app.config["MONGO_URI"],
        database_name=db.name,           # Uses "survey"
        collection_name="chat_histories" # Your Message Collection
    )

def get_vector_store():
    return MongoDBAtlasVectorSearch(
        collection=current_app.config['MONGO_DB']['vector_collection'],
        embedding=current_app.config['EMBEDDINGS'],
        index_name="vector"
    )


def _load_anthropic_history(history_obj):
    """Convert LangChain MongoDB messages → Anthropic [{role, content}, ...].

    For agentic AI messages we only feed the rendered text back to Claude on
    follow-up turns — the tool_trace stays in MongoDB for frontend replay
    but isn't replayed into the model context (saves tokens, avoids stale
    tool-use IDs that would confuse the API).
    """
    out = []
    for msg in history_obj.messages:
        if isinstance(msg, HumanMessage):
            content = (msg.content or "").strip()
            if content:
                out.append({"role": "user", "content": content})
        elif isinstance(msg, AIMessage):
            content = (msg.content or "").strip()
            if content:
                out.append({"role": "assistant", "content": content})
    return out


def _selected_files_context_note(selected_file_ids, user_id_for_history):
    """Return a short bracketed note listing names of the user's selected
    library files, or empty string if none. Prepended to the user input so
    the agent recognizes that "this", "the document", etc. refer to files
    it can read via search_knowledge_base.
    """
    if not selected_file_ids or user_id_for_history == "anonymous":
        return ""
    try:
        oids = []
        for fid in selected_file_ids:
            try:
                oids.append(ObjectId(str(fid)))
            except Exception:
                continue
        if not oids:
            return ""
        files_col = current_app.config['MONGO_DB']['user_files']
        names = []
        for doc in files_col.find(
            {"_id": {"$in": oids}, "user_id": user_id_for_history},
            {"filename": 1, "source_url": 1, "is_url": 1},
        ):
            label = doc.get("filename") or doc.get("source_url") or "(untitled)"
            if doc.get("is_url") and doc.get("source_url"):
                label = f"{label} (URL: {doc['source_url']})"
            names.append(f'"{label}"')
        if not names:
            return ""
        listing = ", ".join(names)
        return (
            f"[System note: The user has selected the following file(s) "
            f"from their library: {listing}. When they refer to \"this\", "
            f"\"that\", \"the document\", \"the link\", etc., they almost "
            f"certainly mean these. Use search_knowledge_base to read them.]\n\n"
        )
    except Exception as e:
        logger.warning("Could not build selected-files context note: %s", e)
        return ""


def _parse_image_blocks(images):
    """Convert frontend dataUrl list to Anthropic image content blocks."""
    blocks = []
    for img in (images or []):
        data_url = img.get('dataUrl', '')
        if not data_url.startswith('data:'):
            continue
        try:
            header, b64data = data_url.split(',', 1)
            media_type = header.split(':')[1].split(';')[0]
            if media_type not in ('image/jpeg', 'image/png', 'image/gif', 'image/webp'):
                continue
            blocks.append({
                "type": "image",
                "source": {"type": "base64", "media_type": media_type, "data": b64data},
            })
        except Exception:
            continue
    return blocks


def _generate_agentic(*, config_doc, user_input, chat_id, config_id,
                     user_id_for_history, file_variant, selected_file_ids,
                     attached_files, images=None, qualtrics_id=None, student_label=None,
                     student_email=None, marketing_opt_in=None):
    """NDJSON generator for the agentic path.

    Forwards token / tool_use / tool_result events from the runner to the
    client, captures the final assistant text + block trace, and persists
    them to chat_histories with `additional_kwargs.tool_trace`.
    """
    try:
        history_obj = get_session_history(
            session_id=chat_id,
            user_id=user_id_for_history,
            config_id=config_id,
            user_input=user_input,
            qualtrics_id=qualtrics_id,
            student_label=student_label,
            student_email=student_email,
            marketing_opt_in=marketing_opt_in,
        )
        history_messages = _load_anthropic_history(history_obj)

        # Prepend a context note about selected library files so the agent
        # knows what "this" / "the document" refers to. Persisted user input
        # below stays clean — the note is model-only.
        note = _selected_files_context_note(selected_file_ids, user_id_for_history)
        agent_input = note + user_input if note else user_input
        image_blocks = _parse_image_blocks(images)

        ctx = ToolContext(
            user_id=user_id_for_history if user_id_for_history != "anonymous" else None,
            config_id=config_id,
            config=config_doc,
            variant=file_variant,
            selected_file_ids=selected_file_ids or [],
        )

        accumulated_text = ""
        full_trace = []
        final_stop_reason = "end_turn"

        for event in stream_agentic_response(
            config=config_doc,
            user_input=agent_input,
            history_messages=history_messages,
            ctx=ctx,
            images=image_blocks,
        ):
            etype = event.get("type")
            if etype == "token":
                accumulated_text += event.get("data") or ""
                yield json.dumps(event) + "\n"
            elif etype in ("tool_use", "tool_result"):
                yield json.dumps(event) + "\n"
            elif etype == "done":
                full_trace = event.get("assistant_blocks") or []
                final_stop_reason = event.get("stop_reason") or "end_turn"
                # Don't ship assistant_blocks to the client (large + redundant
                # with the token stream and individual tool events).
                yield json.dumps({
                    "type": "done",
                    "stop_reason": final_stop_reason,
                }) + "\n"

        # Persist this turn. User message first, then AI message with the
        # full trace so frontend replay can re-render the tool pills.
        # Skip on error — don't write a user-visible error string as if it
        # were a real model response.
        if final_stop_reason != "error" and accumulated_text.strip():
            try:
                if attached_files:
                    history_obj.pending_attached_files = attached_files
                history_obj.add_user_message(user_input)
                ai_msg = AIMessage(
                    content=accumulated_text,
                    additional_kwargs={"tool_trace": full_trace} if full_trace else {},
                )
                history_obj.add_message(ai_msg)
            except Exception as e:
                logger.error("Failed to persist agentic turn: %s", e, exc_info=True)

    except Exception as e:
        logger.error("Agentic stream error: %s", e, exc_info=True)
        yield json.dumps({"type": "error", "data": str(e)}) + "\n"

# --- MAIN CHAT ROUTE ---

@chat_bp.route('/chat/<string:config_id>/<string:chat_id>', methods=['POST'])
def chat(config_id, chat_id):
    # 1. Capture user input
    data = request.get_json(silent=True) or {}
    user_input = data.get('input')
    if not user_input:
        return jsonify({"message": "Missing 'input' field"}), 400
    file_variant = data.get('variant', 'A')
    selected_file_ids = data.get('selected_file_ids', [])
    # Snapshot of file metadata the frontend showed as chips at send time;
    # persisted on the user message so the chips survive a history reload.
    attached_files = data.get('attached_files', []) or []
    images = data.get('images', []) or []
    qualtrics_id = data.get('qualtrics_id') or None
    student_label = data.get('student_label') or None
    student_email = data.get('student_email') or None
    marketing_opt_in = data.get('marketing_opt_in')
    if marketing_opt_in is not None:
        marketing_opt_in = bool(marketing_opt_in)

    # 2. Config Fetch
    config_doc = current_app.config['MONGO_DB']['config_collections'].find_one(
        {"_id": ObjectId(config_id.strip())},
        {
            "model_name": 1, "temperature": 1, "prompt_template": 1,
            "is_public": 1, "user_id": 1,
            "web_access": 1, "bot_name": 1, "instructions": 1,
        }
    )
    
    if not config_doc:
        return jsonify({"message": "Configuration not found"}), 404

    # 3. Auth Check
    user_id_for_history = "anonymous"
    if not config_doc.get("is_public"):
        try:
            verify_jwt_in_request()
            user_id_for_history = get_jwt_identity()
        except Exception:
            try:
                verify_jwt_in_request(refresh=True)
                user_id_for_history = get_jwt_identity()
            except Exception as e:
                return jsonify({"message": "Authentication failed."}), 401

    # 4a. Agentic branch — Claude bots with web_access enabled use the
    # tool-using runner. Everything else falls through to the legacy chain.
    model_name_check = (config_doc.get("model_name") or "").lower()
    if config_doc.get("web_access") and model_name_check.startswith("claude"):
        return Response(
            stream_with_context(_generate_agentic(
                config_doc=config_doc,
                user_input=user_input,
                chat_id=chat_id,
                config_id=config_id,
                user_id_for_history=user_id_for_history,
                file_variant=file_variant,
                selected_file_ids=selected_file_ids,
                attached_files=attached_files,
                images=images,
                qualtrics_id=qualtrics_id,
                student_label=student_label,
                student_email=student_email,
                marketing_opt_in=marketing_opt_in,
            )),
            mimetype='application/x-ndjson',
        )

    # 4. Streaming Generator
    @stream_with_context
    def generate():
        try:
            # -- STEP A: VECTOR RETRIEVAL --
            # Pull both the config-owner's baseline docs and the caller's personal
            # library. User-library chunks are stored with a synthetic
            # config_id = f"user:{user_id}" so the existing Atlas filter works.
            vector_store = get_vector_store()
            is_authenticated = user_id_for_history and user_id_for_history != "anonymous"

            if file_variant == 'B':
                # Variant B: files are scoped to this bot's config_id — no user library merge
                docs = vector_store.similarity_search(
                    query=user_input,
                    k=3,
                    pre_filter={"config_id": config_id}
                )
            elif selected_file_ids and is_authenticated:
                # Variant A with explicit selection: config baseline + selected files only
                docs = vector_store.similarity_search(
                    query=user_input,
                    k=5,
                    pre_filter={"$or": [
                        {"config_id": config_id},
                        {"source_file_id": {"$in": selected_file_ids}},
                    ]}
                )
            else:
                # Variant A default: config baseline + full user library
                config_ids = [config_id]
                if is_authenticated:
                    config_ids.append(f"user:{user_id_for_history}")
                docs = vector_store.similarity_search(
                    query=user_input,
                    k=5 if len(config_ids) > 1 else 3,
                    pre_filter={"config_id": {"$in": config_ids}}
                )

            # Send Sources immediately
            sources = [
                {"source": d.metadata.get("source", "Unknown"), "page_content": d.page_content[:200]}
                for d in docs
            ]
            yield json.dumps({"type": "sources", "data": sources}) + "\n"

            # -- STEP B: PREPARE LLM --
            context_text = "\n\n".join(d.page_content for d in docs)
            base_instruction = config_doc.get("prompt_template", "Answer based on context.")
            # Escape any {var} in user prompt that isn't our template vars (context, history, question)
            base_instruction = _escape_prompt_variables(base_instruction)

            # IMPROVED SYSTEM PROMPT: Forces AI to look at history
            system_message = f"""{base_instruction}

            Use the provided Context (retrieved documents) and the Conversation History to answer.
            If the user asks about previous messages, look at the History.
            
            Context:
            {{context}}
            """

            prompt = ChatPromptTemplate.from_messages([
                ("system", system_message),
                MessagesPlaceholder(variable_name="history"), 
                ("human", "{question}")
            ])

            # -- DYNAMIC MODEL SELECTION --
            model_name = config_doc.get("model_name", "gpt-4o")
            temperature = config_doc.get("temperature", 0.7)
            primary_openai_key = current_app.config.get("OPENAI_API_KEY")
            fallback_openai_key = current_app.config.get("OPENAI_API_KEY_2")

            if model_name == "gpt-5-nano":
                    # CASE 1: GPT-5-Nano (gpt-4o w/o temperature)
                    primary_llm = ChatOpenAI(
                        model="gpt-5-nano", 
                        api_key=primary_openai_key,
                        max_tokens=500,
                        streaming=True
                    )
                    if fallback_openai_key:
                        fallback_llm = ChatOpenAI(
                            model="gpt-5-nano", 
                            api_key=fallback_openai_key,
                            max_tokens=500,
                            streaming=True
                        )
                        llm = primary_llm.with_fallbacks([fallback_llm])
                    else:
                        llm = primary_llm

            elif model_name.lower().startswith("gemini"):
                # CASE 2: Gemini Models (e.g., gemini-2.5-flash, gemini-2.5-pro)
                llm = ChatGoogleGenerativeAI(
                    model=model_name,
                    temperature=temperature,
                    google_api_key=current_app.config.get("GEMINI_API_KEY"),
                    streaming=True
                )
            elif model_name.lower().startswith("qwen"):
                # CASE 2: Qwen models (Use ChatTongyi)
                llm = ChatTongyi(
                    model=model_name,
                    temperature=temperature,
                    api_key=current_app.config.get("DASHSCOPE_API_KEY"),
                    streaming=True
                )

            elif model_name.lower().startswith("deepseek"):
                # CASE 3: DeepSeek models (Use ChatDeepSeek)
                llm = ChatDeepSeek(
                    model=model_name,
                    temperature=temperature,
                    api_key=current_app.config.get("DEEPSEEK_API_KEY"),
                    streaming=True
                )

            elif model_name.lower().startswith("claude"):
                # CASE 3b: Anthropic Claude models
                llm = ChatAnthropic(
                    model=model_name,
                    temperature=temperature,
                    api_key=current_app.config.get("ANTHROPIC_API_KEY"),
                    max_tokens=500,
                    streaming=True
                )

            else:
                # CASE 4: Standard OpenAI
                primary_llm = ChatOpenAI(
                    model=model_name,
                    temperature=temperature,
                    api_key=primary_openai_key,
                    max_tokens=500,
                    streaming=True
                )
                if fallback_openai_key:
                    fallback_llm = ChatOpenAI(
                        model=model_name,
                        temperature=temperature,
                        api_key=fallback_openai_key,
                        max_tokens=500,
                        streaming=True
                    )
                    llm = primary_llm.with_fallbacks([fallback_llm])
                else:
                    llm = primary_llm

            # -- STEP C: STREAMING INFERENCE --
            chain = prompt | llm | StrOutputParser()
            
            def get_history_factory(session_id):
                h = get_session_history(
                    session_id=session_id,
                    user_id=user_id_for_history,
                    config_id=config_id,
                    user_input=user_input,
                    qualtrics_id=qualtrics_id,
                    student_label=student_label,
                    student_email=student_email,
                    marketing_opt_in=marketing_opt_in,
                )
                if attached_files:
                    h.pending_attached_files = attached_files
                return h

            chain_with_history = RunnableWithMessageHistory(
                chain,
                get_session_history=get_history_factory,
                input_messages_key="question",
                history_messages_key="history",
            )

            for chunk in chain_with_history.stream(
                {"question": user_input, "context": context_text},
                config={"configurable": {"session_id": chat_id}}
            ):
                yield json.dumps({"type": "token", "data": chunk}) + "\n"

        except Exception as e:
            logger.error(f"Stream Error: {e}")
            yield json.dumps({"type": "error", "data": str(e)}) + "\n"

    return Response(generate(), mimetype='application/x-ndjson')