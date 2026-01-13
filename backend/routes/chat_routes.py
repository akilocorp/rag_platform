from flask import Blueprint, request, jsonify, current_app, Response, stream_with_context 
from flask_jwt_extended import jwt_required, get_jwt_identity, verify_jwt_in_request
import logging
import json
import time
import requests
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.runnables import RunnablePassthrough, RunnableLambda
from langchain_core.output_parsers import StrOutputParser
from langchain_mongodb.vectorstores import MongoDBAtlasVectorSearch
from langchain_mongodb.chat_message_histories import MongoDBChatMessageHistory
from langchain_core.runnables.history import RunnableWithMessageHistory
from langchain_core.messages import BaseMessage, message_to_dict
from bson import ObjectId
from langchain_community.chat_models import ChatTongyi
from langchain_deepseek import ChatDeepSeek

logger = logging.getLogger(__name__)
chat_bp = Blueprint('chat_routes', __name__)

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

            title = "New Chat"
            try:
                if session.get('first_message_history'):
                    history_data = json.loads(session['first_message_history'])
                    # Check common locations for content
                    if history_data.get("data", {}).get("content"):
                        title = history_data["data"]["content"]
                    elif history_data.get("content"):
                        title = history_data["content"]
            except (json.JSONDecodeError, TypeError):
                pass

            sessions_list.append({
                'session_id': session['session_id'],
                'title': title[:100],
                'timestamp': session['timestamp']
            })

        return jsonify({"sessions": sessions_list}), 200
    except Exception as e:
        logger.error(f"Error fetching chat list for config {config_id}: {e}", exc_info=True)
        return jsonify({"message": "An internal server error occurred."}), 500

# --- FACTORY & HELPERS ---

def get_session_history(session_id: str, user_id: str, config_id: str) -> MongoDBChatMessageHistory:
    db = current_app.config['MONGO_DB']
    metadata_collection = db["chat_session_metadata"]

    # Only write to metadata if this is truly the FIRST message
    if metadata_collection.count_documents({"session_id": session_id}, limit=1) == 0:
        metadata_collection.insert_one({
            "session_id": session_id,
            "user_id": user_id,
            "config_id": config_id,
            "timestamp": time.time()
        })

    return MongoDBChatMessageHistory(
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

# --- MAIN CHAT ROUTE ---

@chat_bp.route('/chat/<string:config_id>/<string:chat_id>', methods=['POST'])
def chat(config_id, chat_id):
    # 1. Capture user input
    data = request.get_json(silent=True) or {}
    user_input = data.get('input')
    if not user_input:
        return jsonify({"message": "Missing 'input' field"}), 400

    # 2. Config Fetch
    config_doc = current_app.config['MONGO_DB']['config_collections'].find_one(
        {"_id": ObjectId(config_id.strip())},
        {"model_name": 1, "temperature": 1, "prompt_template": 1, "is_public": 1, "user_id": 1}
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

    # 4. Streaming Generator
    @stream_with_context
    def generate():
        try:
            # -- STEP A: VECTOR RETRIEVAL --
            vector_store = get_vector_store()
            docs = vector_store.similarity_search(
                query=user_input,
                k=3,
                pre_filter={"config_id": {"$eq": config_id}}
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

            if model_name == "gpt-5-nano":
                # CASE 1: GPT-5-Nano (gpt-4o w/o temperature)
                llm = ChatOpenAI(
                    model="gpt-4o", 
                    api_key=current_app.config.get("OPENAI_API_KEY"),
                    max_tokens=500,
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

            else:
                # CASE 4: Standard OpenAI
                llm = ChatOpenAI(
                    model=model_name,
                    temperature=temperature,
                    api_key=current_app.config.get("OPENAI_API_KEY"),
                    max_tokens=500,
                    streaming=True
                )

            # -- STEP C: STREAMING INFERENCE --
            chain = prompt | llm | StrOutputParser()
            
            def get_history_factory(session_id):
                return get_session_history(
                    session_id=session_id,
                    user_id=user_id_for_history, 
                    config_id=config_id
                )

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