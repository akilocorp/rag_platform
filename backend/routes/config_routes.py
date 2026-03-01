from flask import Flask, Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity, verify_jwt_in_request, unset_jwt_cookies
import urllib.parse
import requests
import logging
import os
from werkzeug.utils import secure_filename
from src.utils.vector_stores.store_vector_stores import process_files_and_create_vector_store
from models.config import Config
from models.user import User

import json
from bson import ObjectId

# --- Setup and Configuration ---
logger = logging.getLogger(__name__)
UPLOAD_FOLDER = "uploads/"
ALLOWED_EXTENSIONS = {'txt', 'pdf', 'md', 'docx'}

config_bp = Blueprint('config_routes', __name__)

def allowed_file(filename):
    """Checks if the uploaded file has an allowed extension."""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@config_bp.route('/config_list', methods=['GET'])
@jwt_required()
def getconfigs():
    user_id=''
    try:
        # 1. Get the user ID from the JWT token
        user_id = get_jwt_identity()
        
        if user_id == '':
            return jsonify({"error": "User not authenticated"}), 401

        # 2. Query the database for all configs matching the user_id.
        user_configs_cursor = Config.find_by_user_id(user_id)

        # 3. Serialize the documents for the JSON response
        configs_list = []
        for config in user_configs_cursor:
            config['config_id'] = str(config.pop('_id'))
            # Ensure 'collection_name' is present, defaulting to an empty string if not
            config['collection_name'] = config.get('collection_name', '')
            configs_list.append(config)
        
        # 4. Return the list of configurations
        return jsonify({"configs": configs_list}), 200

    except Exception as e:
        if user_id:
            current_app.logger.error(f"Error fetching configurations for user {user_id}: {e}", exc_info=True)
        return jsonify({"message": "An internal server error occurred"}), 500

@config_bp.route('/config/<string:config_id>', methods=['GET'])
def get_single_config(config_id):
    user_id=''
    """
    Fetches a single configuration.
    If the config is private, a valid JWT for the owner is required.
    If public, it can be accessed without a JWT.
    """
    try:
        # 2. Validate the provided config_id to ensure it's a valid MongoDB ObjectId
        if not ObjectId.is_valid(config_id):
            return jsonify({"message": "Invalid configuration ID format"}), 400

        # 3. Query the database for a document that matches BOTH the config_id and the user_id
        config_document = Config.get_collection().find_one({"_id":ObjectId(config_id)})
        
        if config_document is None:
            return jsonify({"message": "Configuration not found"}), 404

        # If the chat is public, return it immediately
        if config_document.get("is_public") is True:
            config_document["config_id"] = str(config_document.pop("_id"))
            config_document['collection_name'] = config_document.get('collection_name', '')
            return jsonify({"config": config_document}), 200

        # If we're here, the chat is private, so a valid JWT is required
        try:
            verify_jwt_in_request()
            user_id = get_jwt_identity()
        except Exception as e:
            # Keep this warning, it helps debug auth failures without spamming full objects
            logger.warning(f"JWT verification failed for config {config_id}: {e}")
            return jsonify({"message": "Authentication required for this private chat"}), 401

        # Check if the authenticated user is the owner of the config
        if config_document.get("user_id") != user_id:
            return jsonify({"message": "Access denied. You are not the owner of this configuration."}), 403

        # 5. Serialize the document for the JSON response
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
        
        # STRICT FILTER: 
        # 1. Must have interactive_supported as True
        # 2. AND the ID must contain 'lite' or 'public' or 'ez'
        interactive_avatars = [
            a for a in avatar_list
            if isinstance(a, dict) and # Ensure item is a dict
            (
                # Logic 1: Check for keywords in ID
                any(k in a.get('avatar_id', '').lower() for k in ['lite', 'public', 'ez']) 
                or 
                # Logic 2: Or if it just looks like a streaming avatar
                a.get('is_public') is True
            )
        ]
        
        # If the swtrict list is empty, let's return the basic Lite ones so the UI isn't empty
       
            
        return jsonify({"avatars": interactive_avatars})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@config_bp.route('/config', methods=['POST'])
@jwt_required()
def configure_model():
    """
    API endpoint that now robustly handles 'instructions' or a full 'prompt_template'.
    """
    try:
        # --- 1. Get User ID & Form Data ---
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

        # --- 2. Get both 'instructions' and 'prompt_template' ---
        instructions = config_data.get('instructions')
        custom_prompt_template = config_data.get('prompt_template')

        # --- 3. Robustly Create the Final Prompt Template ---
        final_prompt_template = ""

        if custom_prompt_template:
            # If a full template is provided, use it directly (highest priority)
            final_prompt_template = custom_prompt_template
        elif instructions:
            # Otherwise, if instructions are provided, build the template
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
            # If neither is provided, it's an error
            return jsonify({"error": "Missing required field: please provide either 'instructions' or a 'prompt_template'"}), 400

        # --- 4. Validate Other Inputs ---
        if not all([llm_type, temperature_str]):
            return jsonify({"error": "Missing required fields: llm_type or temperature"}), 400
        
        try:
            temperature = float(str(temperature_str))
            if not (0.0 <= temperature <= 2.0):
                raise ValueError
        except (ValueError, TypeError):
            return jsonify({"error": "Temperature must be a number between 0.0 and 2.0"}), 400

        # --- 5. Handle File Uploads ---
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

        # --- 6. Save Configuration to MongoDB ---
        mongo_collection = Config

        # Get the filenames of uploaded files
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
            "documents": uploaded_filenames
        }
        
        result = mongo_collection.get_collection().insert_one(config_document)
        config_id = result.inserted_id
        config_document['_id'] = str(config_id)

        # --- 7. Process Files ---
        if temp_file_paths:
            # Use the provided collection name, or generate one if it's empty
            final_collection_name = collection_name if collection_name else f"config_{config_id}"
            process_files_and_create_vector_store(
                temp_file_paths=temp_file_paths, 
                user_id=user_id, 
                collection_name=final_collection_name,
                config_id=config_id
            )
            # Update the config with the final collection name if it was generated
            if not collection_name:
                Config.get_collection().update_one(
                    {"_id": config_id},
                    {"$set": {"collection_name": final_collection_name}}
                )
        
        return jsonify({
            "message": "Configuration saved successfully!",
            "data": config_document
        }), 201

    except Exception as e:
        current_app.logger.error(f"An error occurred in /config route: {e}", exc_info=True)
        return jsonify({"error": "An internal server error occurred"}), 500