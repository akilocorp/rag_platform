from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity, verify_jwt_in_request
import logging
import re
import json
import time
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.runnables import RunnablePassthrough, RunnableLambda
from langchain_core.output_parsers import StrOutputParser
from langchain_mongodb.vectorstores import MongoDBAtlasVectorSearch
from langchain_mongodb.chat_message_histories import MongoDBChatMessageHistory
from langchain_core.runnables.history import RunnableWithMessageHistory
from langchain_core.messages import BaseMessage, messages_from_dict, message_to_dict
from models.config import Config
from bson import ObjectId
from langchain_community.chat_models import ChatTongyi
from langchain_deepseek import ChatDeepSeek

logger = logging.getLogger(__name__)
chat_bp = Blueprint('chat_routes', __name__)

# --- DB Collections ---
# 1. chat_session_metadata: Stores one document per chat session with user_id and config_id.
# 2. message_store: Stores all messages from all sessions, using LangChain's standard format.

@chat_bp.route('/history/<string:chat_id>', methods=['GET'])
def get_chat_history(chat_id):
    """Retrieves the message history for a specific chat session."""
    try:
        history = MongoDBChatMessageHistory(
            connection_string=current_app.config['MONGO_URI'],
            session_id=chat_id,
            database_name=current_app.config['MONGO_DB'].name,
            collection_name="message_store"
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

        # This pipeline does all the heavy lifting in the database.
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
                    'from': 'message_store',
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
                    '_id': 1, # Keep _id for timestamp and updates
                    'session_id': '$session_id',
                    'user_id': '$user_id',
                    'timestamp': {'$dateToString': {'format': '%Y-%m-%dT%H:%M:%S.%LZ', 'date': '$_id'}},
                    'first_message_history': {'$arrayElemAt': ['$first_message_info.History', 0]}
                }
            }
        ]

        # 1. Execute the single, efficient pipeline
        sessions_from_db = list(metadata_collection.aggregate(pipeline))
        
        sessions_list = []
        # 2. Loop through the results just to create the title and claim anonymous chats
        for session in sessions_from_db:
            
            # If the chat is anonymous, claim it for the current user
            if session.get('user_id') == 'anonymous':
                 metadata_collection.update_one(
                    {"_id": session["_id"]}, # Use the _id we kept in the pipeline
                    {"$set": {"user_id": user_id}}
                )
                 print(f"✅ Claimed anonymous chat {session['session_id']} for user {user_id}")


            title = "New Chat"
            try:
                # Use the correct field name from the pipeline: 'first_message_history'
                if session.get('first_message_history'):
                    history_data = json.loads(session['first_message_history'])
                    if history_data.get("data", {}).get("content"):
                        title = history_data["data"]["content"]
            except (json.JSONDecodeError, TypeError):
                pass  # Ignore malformed history

            sessions_list.append({
                'session_id': session['session_id'],
                'title': title[:100],
                'timestamp': session['timestamp']
            })

        # 3. The return statement is OUTSIDE and AFTER the loop
        return jsonify({"sessions": sessions_list}), 200
    except Exception as e:
        logger.error(f"Error fetching chat list for config {config_id}: {e}", exc_info=True)
        return jsonify({"message": "An internal server error occurred."}), 500

class CustomMongoDBChatMessageHistory(MongoDBChatMessageHistory):
    """Custom history class to save user_id and config_id with each message."""
    def __init__(self, connection_string: str, session_id: str, database_name: str, collection_name: str, user_id: str, config_id: str):
        super().__init__(connection_string, session_id, database_name, collection_name)
        self.user_id = user_id
        self.config_id = config_id

    def add_message(self, message: BaseMessage) -> None:
        """Append the message to the record in MongoDB."""
        self.collection.insert_one(
            {
                "SessionId": self.session_id,
                "user_id": self.user_id,
                "config_id": self.config_id,
                "History": json.dumps(message_to_dict(message)),
            }
        )

def get_session_history(session_id: str, user_id: str, config_id: str) -> CustomMongoDBChatMessageHistory:
    """Factory function to create a message history object and ensure session metadata exists."""
    db = current_app.config['MONGO_DB']
    metadata_collection = db["chat_session_metadata"]
    
    metadata_collection.update_one(
        {"session_id": session_id},
        {"$setOnInsert": {"user_id": user_id, "config_id": config_id, "session_id": session_id}},
        upsert=True
    )

    return CustomMongoDBChatMessageHistory(
        connection_string=current_app.config['MONGO_URI'],
        session_id=session_id,
        database_name=db.name,
        collection_name="message_store",
        user_id=user_id,
        config_id=config_id
    )

@chat_bp.route('/chat/<string:config_id>/<string:chat_id>', methods=['POST'])
def chat(config_id, chat_id):
    """Main endpoint for handling chat interactions."""
    data = request.get_json()
    if not data or 'input' not in data:
        return jsonify({"message": "Missing 'input' field"}), 400
    user_input = data['input']

    try:
        config_document = Config.get_collection().find_one({"_id": ObjectId(config_id)})
        if not config_document:
            return jsonify({"message": "Configuration not found"}), 404

        is_public = config_document.get("is_public", False)
        owner_id = str(config_document.get("user_id"))
        
        user_id_for_history = "anonymous"
        if not is_public:
            try:
                verify_jwt_in_request()
                jwt_user_id = get_jwt_identity()
                if owner_id != jwt_user_id:
                    return jsonify({"message": "Access denied to this chatbot"}), 403
                user_id_for_history = jwt_user_id
            except Exception as e:
                return jsonify(message="Authorization error: " + str(e)), 401
        
        try:
            db = current_app.config['MONGO_DB']
            embeddings = current_app.config['EMBEDDINGS']
            if not embeddings:
                logger.error("EMBEDDINGS not configured")
                return jsonify({"message": "Embeddings not configured"}), 500
                
            vector_store = MongoDBAtlasVectorSearch(
                collection=db['vector_collection'],
                embedding=embeddings,
                index_name="vector"
            )
        except Exception as e:
            logger.error(f"Error initializing vector store: {e}", exc_info=True)
            return jsonify({"message": f"Error initializing vector store: {str(e)}"}), 500
        
        # Create a custom retriever function that includes filtering
        def filtered_retriever(query):
            try:
                # Use similarity search with filter
                docs = vector_store.similarity_search(
                    query=query,
                    k=3,
                    pre_filter={"config_id": {"$eq": config_id}}
                )
                logger.info(f"🔍 Vector search found {len(docs)} documents for config_id: {config_id}")
                if docs:
                    logger.info(f"📄 First document preview: {docs[0].page_content[:200]}...")
                    logger.info(f"📋 Document metadata: {docs[0].metadata}")
                else:
                    logger.warning(f"⚠️ No documents found in vector store for config_id: {config_id}")
                return docs
            except Exception as e:
                logger.error(f"❌ Vector retrieval failed: {e}")
                return []
        

        
        system_prompt_template = re.sub(r'Question:.*', '', config_document.get("prompt_template", "")).strip()
        prompt = ChatPromptTemplate.from_messages([
            ("system", system_prompt_template + "\n\nContext:\n{context}"),
            MessagesPlaceholder(variable_name="history"),
            ("human", "{question}")
        ])
        
        model_name = config_document.get("model_name")
        temperature = config_document.get("temperature")
        llm = None
        
        try:
            if model_name.startswith('gpt'):
                api_key = current_app.config.get("OPENAI_API_KEY")
                if not api_key:
                    logger.error("OPENAI_API_KEY is missing from configuration")
                    return jsonify({"message": "OpenAI API key not configured"}), 500
                llm = ChatOpenAI(model=model_name, temperature=temperature, api_key=api_key)
            elif model_name.startswith('qwen'):
                api_key = current_app.config.get("QWEN_API_KEY")
                if not api_key:
                    logger.error("QWEN_API_KEY is missing from configuration")
                    return jsonify({"message": "Qwen API key not configured"}), 500
                llm = ChatTongyi(model=model_name, api_key=api_key)
            elif model_name.startswith('deepseek'):
                api_key = current_app.config.get("DEEPSEEK_API_KEY")
                if not api_key:
                    logger.error("DEEPSEEK_API_KEY is missing from configuration")
                    return jsonify({"message": "DeepSeek API key not configured"}), 500
                llm = ChatDeepSeek(model=model_name, temperature=temperature, api_key=api_key)
            else:
                logger.error(f"Unsupported model: {model_name}")
                return jsonify({"message": f"Unsupported model: {model_name}"}), 400
                
            if not llm:
                logger.error(f"Failed to initialize LLM for model: {model_name}")
                return jsonify({"message": f"Failed to initialize model: {model_name}"}), 500
                
        except Exception as e:
            logger.error(f"Error initializing LLM {model_name}: {e}", exc_info=True)
            return jsonify({"message": f"Error initializing model: {str(e)}"}), 500

        def format_docs(docs):
            context = "\n\n".join(doc.page_content for doc in docs)
            logger.info(f"📝 Context being sent to LLM ({len(docs)} docs, {len(context)} chars): {context[:300]}...")
            return context

        # Convert functions to runnables
        question_to_retriever = RunnableLambda(lambda x: x["question"])
        retriever_runnable = RunnableLambda(filtered_retriever)
        format_docs_runnable = RunnableLambda(format_docs)
        
        rag_chain = (
            RunnablePassthrough.assign(
                context=question_to_retriever | retriever_runnable | format_docs_runnable
            )
            | prompt
            | llm
            | StrOutputParser()
        )

        chain_with_history = RunnableWithMessageHistory(
            rag_chain,
            lambda session_id: get_session_history(session_id, user_id_for_history, config_id),
            input_messages_key="question",
            history_messages_key="history",
        )

        # Get docs once for both context and sources
        docs = filtered_retriever(user_input)
        context = format_docs(docs)
        
        # Run the RAG chain
        try:
            response_content = chain_with_history.invoke(
                {"question": user_input, "context": context},
                config={"configurable": {"session_id": chat_id}}
            )
        except Exception as e:
            logger.error(f"Error running RAG chain: {e}", exc_info=True)
            return jsonify({"message": f"Error processing chat request: {str(e)}"}), 500
        
        # Apply response timeout delay before responding
        response_timeout = config_document.get("response_timeout", 3)
        logger.info(f"Applying response timeout of {response_timeout} seconds")
        time.sleep(response_timeout)
        
        # Return response with sources
        return jsonify({
            "response": response_content,
            "sources": [
                {
                    "source": doc.metadata.get("source", ""),
                    "page_content": doc.page_content[:200] + "..."
                } for doc in docs
            ]
        })

    except Exception as e:
        logger.error(f"An unexpected error occurred in the chat endpoint: {e}", exc_info=True)
        return jsonify({"message": "An internal server error occurred."}), 500
