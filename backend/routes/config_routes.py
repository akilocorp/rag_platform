from services.ingestion_orchestrator import IngestionOrchestrator
from flask import Flask, Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity, verify_jwt_in_request, unset_jwt_cookies
import urllib.parse
import requests
import logging
import os
import json
from bson import ObjectId
from werkzeug.utils import secure_filename

# ---> NEW IMPORT <---
from services.vector_store_service import process_files_and_create_vector_store

from models.config import Config
from models.user import User

# --- Setup and Configuration ---
logger = logging.getLogger(__name__)
UPLOAD_FOLDER = "uploads/"
ALLOWED_EXTENSIONS = {
    'txt', 'pdf', 'md', 'docx', 'doc', 'rtf', 'odt', 
    'csv', 'tsv', 'xlsx', 'xls', 'json', 'jsonl', 'xml', 'yaml', 'yml',
    'pptx', 'ppt',
    'py', 'js', 'ts', 'html', 'css', 'java', 'cpp', 'c', 'h', 'go', 'rs', 'sh', 'sql',
    'png', 'jpg', 'jpeg', 'gif', 'bmp', 'webp', 'tiff',
    'mp3', 'wav', 'm4a', 'flac', 'ogg',
    'mp4', 'avi', 'mov', 'mkv', 'webm'
}

config_bp = Blueprint('config_routes', __name__)

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@config_bp.route('/config_list', methods=['GET'])
@jwt_required()
def getconfigs():
    user_id=''
    try:
        user_id = get_jwt_identity()
        if user_id == '':
            return jsonify({"error": "User not authenticated"}), 401

        user_configs_cursor = Config.find_by_user_id(user_id)
        configs_list = []
        for config in user_configs_cursor:
            config['config_id'] = str(config.pop('_id'))
            config['collection_name'] = config.get('collection_name', '')
            configs_list.append(config)
        
        return jsonify({"configs": configs_list}), 200

    except Exception as e:
        if user_id:
            current_app.logger.error(f"Error fetching configurations for user {user_id}: {e}", exc_info=True)
        return jsonify({"message": "An internal server error occurred"}), 500

@config_bp.route('/config/<string:config_id>', methods=['GET'])
def get_single_config(config_id):
    user_id=''
    try:
        if not ObjectId.is_valid(config_id):
            return jsonify({"message": "Invalid configuration ID format"}), 400

        config_document = Config.get_collection().find_one({"_id":ObjectId(config_id)})
        
        if config_document is None:
            return jsonify({"message": "Configuration not found"}), 404

        if config_document.get("is_public") is True:
            config_document["config_id"] = str(config_document.pop("_id"))
            config_document['collection_name'] = config_document.get('collection_name', '')
            return jsonify({"config": config_document}), 200

        try:
            verify_jwt_in_request()
            user_id = get_jwt_identity()
        except Exception as e:
            logger.warning(f"JWT verification failed for config {config_id}: {e}")
            return jsonify({"message": "Authentication required for this private chat"}), 401

        if config_document.get("user_id") != user_id:
            return jsonify({"message": "Access denied. You are not the owner of this configuration."}), 403

        config_document["config_id"] = str(config_document.pop("_id"))
        config_document['collection_name'] = config_document.get('collection_name', '')
        return jsonify({"config": config_document}), 200
        
    except Exception as e:
        current_app.logger.error(f"Error fetching config {config_id} for user {user_id}: {e}", exc_info=True)
        return jsonify({"message": "An internal server error occurred"}), 500

@config_bp.route('/heygen/avatars', methods=['GET'])
@jwt_required()
def get_heygen_avatars():
    headers = {
        "X-Api-Key": current_app.config.get("HEY_GEN_API_KEY"),
        "Content-Type": "application/json"
    }
    try:
        response = requests.get("https://api.heygen.com/v1/streaming/avatar.list", headers=headers)
        avatar_list = response.json().get('data', [])
        if isinstance(avatar_list, dict):
            avatar_list = avatar_list.get('avatars', [])
        
        interactive_avatars = [
            a for a in avatar_list
            if isinstance(a, dict) and
            (
                any(k in a.get('avatar_id', '').lower() for k in ['lite', 'public', 'ez']) 
                or a.get('is_public') is True
            )
        ]
            
        return jsonify({"avatars": interactive_avatars})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@config_bp.route('/config', methods=['POST'])
@jwt_required()
def configure_model():
    try:
        user_id = get_jwt_identity()
        if not user_id:
            return jsonify({"error": "User not authenticated"}), 401

        config_json_str = request.form.get('config')
        if not config_json_str:
            return jsonify({"message": "Missing 'config' part in form data"}), 400
        
        try:
            config_data = json.loads(config_json_str)
        except json.JSONDecodeError:
            return jsonify({"message": "Invalid JSON in 'config' part"}), 400
        
        uploaded_files = request.files.getlist('files')
        llm_type = config_data.get('model_name')
        is_public = config_data.get('is_public')

        bot_name = config_data.get('bot_name', 'Assistant') 
        bot_type = config_data.get('bot_type', 'chat') 
        heygen_avatar_id = config_data.get('heygen_avatar_id', '')
        bot_avatar = config_data.get('bot_avatar', 'robot') 
        introduction = config_data.get('introduction', '') 
        temperature_str = config_data.get('temperature')
        response_timeout = config_data.get('response_timeout', 3) 
        collection_name = config_data.get('collection_name')

        instructions = config_data.get('instructions')
        custom_prompt_template = config_data.get('prompt_template')

        final_prompt_template = ""

        if custom_prompt_template:
            final_prompt_template = custom_prompt_template
        elif instructions:
            starter_template = """You are a helpful AI assistant named '{bot_name}'.
Your goal is to answer questions accurately based on the context provided.

Follow these specific instructions:
{instructions}

Based on the context below, please answer the user's question. If the context doesn't contain the answer, say so.
Context: {{context}}
Question: {{question}}
Answer:"""
            final_prompt_template = starter_template.format(
                bot_name=bot_name, 
                instructions=instructions
            )
        else:
            return jsonify({"error": "Missing required field: please provide either 'instructions' or a 'prompt_template'"}), 400

        if not all([llm_type, temperature_str]):
            return jsonify({"error": "Missing required fields: llm_type or temperature"}), 400
        
        try:
            temperature = float(str(temperature_str))
            if not (0.0 <= temperature <= 2.0):
                raise ValueError
        except (ValueError, TypeError):
            return jsonify({"error": "Temperature must be a number between 0.0 and 2.0"}), 400

        os.makedirs(UPLOAD_FOLDER, exist_ok=True)
        temp_file_paths = []
        for file in uploaded_files:
            if file and allowed_file(file.filename):
                if file.filename:
                    filename = secure_filename(file.filename)
                    temp_file_path = os.path.join(UPLOAD_FOLDER, filename)
                    file.save(temp_file_path)
                    temp_file_paths.append(temp_file_path)
            elif file and file.filename:
                current_app.logger.warning(f"File type not allowed for {file.filename}, skipping.")

        mongo_collection = Config

        uploaded_filenames = [secure_filename(file.filename) for file in uploaded_files if file and allowed_file(file.filename)]
        
        config_document = {
            "user_id": user_id,
            "bot_name": bot_name,
            "bot_type": bot_type,
            "bot_avatar": bot_avatar,
            "heygen_avatar_id": heygen_avatar_id,
            "introduction": introduction,
            "collection_name": collection_name,
            "model_name": llm_type,
            "prompt_template": final_prompt_template, 
            "temperature": temperature,
            "response_timeout": int(response_timeout),
            "is_public": is_public,
            "config_type": "normal",
            "documents": [] # We will update this after successful ingestion
        }
        
        result = mongo_collection.get_collection().insert_one(config_document)
        config_id = str(result.inserted_id)
        config_document['_id'] = config_id

        # --- NEW CLEAN INGESTION PIPELINE ---
        if uploaded_files and uploaded_files[0].filename:
            final_collection_name = collection_name if collection_name else f"config_{config_id}"
            
            # The Orchestrator handles memory vs disk routing securely
            processed_docs = IngestionOrchestrator.process_uploaded_files(
                files=uploaded_files,
                user_id=user_id,
                config_id=config_id,
                collection_name=final_collection_name
            )
            
            # Update the DB with the files that actually succeeded
            Config.get_collection().update_one(
                {"_id": ObjectId(config_id)},
                {"$set": {
                    "collection_name": final_collection_name,
                    "documents": processed_docs
                }}
            )
            config_document["documents"] = processed_docs
            config_document["collection_name"] = final_collection_name

        return jsonify({
            "message": "Configuration saved successfully!",
            "data": config_document
        }), 201

    except Exception as e:
        current_app.logger.error(f"An error occurred in /config route: {e}", exc_info=True)
        return jsonify({"error": "An internal server error occurred"}), 500