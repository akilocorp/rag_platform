import json
import logging
from flask import Blueprint, request, jsonify, current_app, Response, stream_with_context
from flask_jwt_extended import jwt_required, get_jwt_identity, verify_jwt_in_request
from bson import ObjectId

from orchestration.query_engine import QueryEngine
from orchestration.state_manager import StateManager
from services.heygen_service import HeyGenService

logger = logging.getLogger(__name__)
chat_bp = Blueprint('chat_routes', __name__)

# --- HEYGEN ROUTES ---
@chat_bp.route('/heygen/create-session', methods=['POST'])
@jwt_required()
def create_heygen_session():
    try:
        session_data = HeyGenService.create_session(request.get_json().get('avatar_id'))
        return jsonify(session_data), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@chat_bp.route('/heygen/start-session', methods=['POST'])
@jwt_required()
def start_heygen_session():
    data = request.get_json()
    res, status = HeyGenService.start_session(data.get('session_id'), data.get('heygen_token'))
    return jsonify(res), status

@chat_bp.route('/heygen/task', methods=['POST'])
@jwt_required()
def send_heygen_task():
    data = request.get_json()
    res, status = HeyGenService.send_task(data.get('session_id'), data.get('heygen_token'), data.get('text'))
    return jsonify(res), status

@chat_bp.route('/heygen/stop-session', methods=['POST'])
@jwt_required()
def stop_heygen_session():
    data = request.get_json()
    res, status = HeyGenService.stop_session(data.get('session_id'), data.get('heygen_token'))
    return jsonify(res), status


# --- CHAT & HISTORY ROUTES ---
@chat_bp.route('/history/<string:chat_id>', methods=['GET'])
def get_chat_history(chat_id):
    try:
        state_manager = StateManager(current_app.config['MONGO_DB'])
        history = state_manager.get_chat_history(chat_id)
        return jsonify({"history": history}), 200
    except Exception as e:
        logger.error(f"Error fetching history: {e}")
        return jsonify({"message": "An internal server error occurred."}), 500

@chat_bp.route('/chat/list/<string:config_id>', methods=['GET'])
@jwt_required()
def get_chat_list(config_id):
    try:
        user_id = get_jwt_identity()
        state_manager = StateManager(current_app.config['MONGO_DB'])
        sessions_list = state_manager.get_chat_list(user_id, config_id)
        return jsonify({"sessions": sessions_list}), 200
    except Exception as e:
        logger.error(f"Error fetching chat list: {e}")
        return jsonify({"message": "An internal server error occurred."}), 500

@chat_bp.route('/chat/<string:config_id>/<string:chat_id>', methods=['POST'])
def chat(config_id, chat_id):
    data = request.get_json(silent=True) or {}
    user_input = data.get('input')
    if not user_input:
        return jsonify({"message": "Missing 'input' field"}), 400

    db = current_app.config['MONGO_DB']
    config_doc = db['config_collections'].find_one({"_id": ObjectId(config_id.strip())})
    if not config_doc:
        return jsonify({"message": "Configuration not found"}), 404

    user_id = "anonymous"
    if not config_doc.get("is_public"):
        try:
            verify_jwt_in_request()
            user_id = get_jwt_identity()
        except Exception:
            return jsonify({"message": "Authentication failed."}), 401

    state_manager = StateManager(db)
    state_manager.initialize_session_if_new(chat_id, user_id, config_id)
    history = state_manager.get_chat_history(chat_id)

    engine = QueryEngine(config_id, chat_id, user_id, db, config_doc)

    @stream_with_context
    def generate():
        new_messages = []
        for chunk_json_str in engine.stream_response(user_input, history):
            chunk_data = json.loads(chunk_json_str.strip())
            if chunk_data.get("type") == "final_state":
                new_messages = chunk_data.get("data", [])
                continue 
            yield chunk_json_str
            
        try:
            state_manager.save_messages(chat_id, new_messages)
        except Exception as e:
            logger.error(f"Failed to save chat history: {e}")

    return Response(generate(), mimetype='application/x-ndjson')