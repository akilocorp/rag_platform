from flask import request, current_app
from flask_socketio import emit, join_room, leave_room
import logging
import json
from bson import ObjectId
from langchain_mongodb.vectorstores import MongoDBAtlasVectorSearch

from src.managers.match_manager import match_manager
from src.managers.context_manager import get_or_create_context
from src.managers.bot_manager import analyze_intent, get_or_create_bot

logger = logging.getLogger(__name__)

def register_socket_events(socketio, app):
    @socketio.on('connect')
    def handle_connect():
        logger.info(f"✅ SUCCESS: Frontend connected to Socket.IO! SID: {request.sid}")
    # ----------------------------    
    @socketio.on('join_group_chat')
    def handle_join_chat(data):
        """User drops directly into the persistent group chat."""
        uid = data.get('uid')
        config_id = data.get('config_id')
        
        if not config_id or not uid:
            return
            
        # The Config ID IS the Room ID. Everyone with this config shares the space.
        room_id = config_id 
        
        join_room(room_id)
        match_manager.create_room(room_id, [uid])
        logger.info(f"🚪 {uid} dropped into drop-in space {room_id}")
        
        # --- Catch the user up on missed messages ---
        ctx = get_or_create_context(room_id)
        if ctx.messages:
            # request.sid targets ONLY the user who just connected
            emit('chat_history', {'messages': ctx.messages}, to=request.sid)

        # Announce the arrival to everyone else
        emit('message', {'sender': 'System', 'text': f'{uid} joined the space.'}, room=room_id)

    @socketio.on('send_message')
    def handle_message(data):
        room_id = data.get('config_id') # Room ID is Config ID
        uid = data.get('uid')
        text = data.get('text')
        
        if not text or not room_id:
            return

        # 1. Immediate Broadcast to humans
        emit('message', {'sender': uid, 'text': text}, room=room_id)

        # 2. Trigger AI background processing
        socketio.start_background_task(process_ai_logic, app, room_id, uid, text, socketio)

    @socketio.on('disconnect')
    def handle_disconnect():
        # Clean up memory when they close the tab
        pass


def process_ai_logic(app, room_id, uid, text, socketio):
    """Background task for RAG and AI Generation."""
    with app.app_context():
        try:
            config_doc = app.config['MONGO_DB']['config_collections'].find_one({"_id": ObjectId(room_id)})
            if not config_doc or config_doc.get('bot_type') != 'group_chat':
                return

            bots_raw = config_doc.get('bots', [])
            bots_config = json.loads(bots_raw) if isinstance(bots_raw, str) else bots_raw
            if not bots_config: return

            ctx = get_or_create_context(room_id)
            ctx.add_message(uid, text)

            orch_history = ctx.get_context_summary(num_messages=10)
            chosen_bot_name = analyze_intent(text, bots_config, orch_history)

            if chosen_bot_name:
                bot_cfg = next((b for b in bots_config if b['name'] == chosen_bot_name), None)
                if bot_cfg:
                    vector_store = MongoDBAtlasVectorSearch(
                        collection=app.config['MONGO_DB']['vector_collection'],
                        embedding=app.config['EMBEDDINGS'],
                        index_name="vector"
                    )
                    
                    docs = vector_store.similarity_search(
                        query=text, k=3, pre_filter={"config_id": {"$eq": room_id}}
                    )
                    rag_context = "\n\n".join(d.page_content for d in docs)

                    bot_instance = get_or_create_bot(room_id, bot_cfg)
                    full_summary = ctx.get_context_summary(num_messages=20)
                    
                    reply = bot_instance.generate_response(uid, text, full_summary, rag_context)
                    
                    if reply:
                        ctx.add_message(bot_instance.name, reply)
                        socketio.sleep(1) # Slight natural delay
                        socketio.emit('message', {'sender': bot_instance.name, 'text': reply}, room=room_id)

        except Exception as e:
            logger.error(f"❌ AI Logic Error: {e}", exc_info=True)