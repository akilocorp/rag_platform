from services.ingestion_orchestrator import IngestionOrchestrator
from flask import Blueprint, request, jsonify, current_app, send_from_directory
from flask_jwt_extended import jwt_required, get_jwt_identity
from werkzeug.utils import secure_filename
from bson import ObjectId
import os
import json

from models.config import Config

# ---> NEW IMPORT <---
from services.vector_store_service import process_files_and_create_vector_store

edit_config_bp = Blueprint('edit_config_routes', __name__)

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

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

@edit_config_bp.route('/config/<string:config_id>', methods=['PUT'])
@jwt_required()
def update_existing_config(config_id):
    try:
        user_id = get_jwt_identity()
        data = request.form
        files = request.files.getlist('files')

        config_to_update = Config.get_collection().find_one({
            "_id": ObjectId(config_id),
            "user_id": user_id
        })

        if not config_to_update:
            return jsonify({"message": "Configuration not found or access denied"}), 404

        if files and files[0].filename:
            filenames = [f.filename for f in files]
            current_app.logger.info(f"Request received to ADD new files for config_id '{config_id}': {filenames}")

        files_to_delete_json = data.get('files_to_delete', '[]')
        files_to_delete = json.loads(files_to_delete_json)
        
      
        
        existing_documents = config_to_update.get('documents', [])
        current_documents = [doc for doc in existing_documents if doc not in files_to_delete]
        if files_to_delete:
            current_app.logger.info(f"Removing {files_to_delete} from config {config_id}.")
            # TODO: Add logic here to delete vectors where metadata.original_file IN files_to_delete

        # for filename in files_to_delete:
        #     file_path = os.path.join(UPLOAD_FOLDER, filename)
        #     try:
        #         if os.path.exists(file_path):
        #             os.remove(file_path)
        #             current_app.logger.info(f"SUCCESS: Physically deleted file '{file_path}' for config_id '{config_id}'.")
        #     except OSError as e:
        #         current_app.logger.error(f"Error deleting file {file_path}: {e}", exc_info=True)

        newly_uploaded_filenames = []
        if files and files[0].filename:
            newly_uploaded_docs = IngestionOrchestrator.process_uploaded_files(
                files=files,
                user_id=user_id,
                config_id=config_id,
                collection_name=config_to_update.get('collection_name')
            )
            # temp_file_paths = []
            # os.makedirs(UPLOAD_FOLDER, exist_ok=True)
            # for file in files:
            #     if file and file.filename and allowed_file(file.filename):
            #         filename = secure_filename(file.filename)
            #         temp_file_path = os.path.join(UPLOAD_FOLDER, filename)
            #         file.save(temp_file_path)
            #         temp_file_paths.append(temp_file_path)
            #         newly_uploaded_filenames.append(filename)

         
        
        updated_documents = list(set(current_documents + newly_uploaded_docs))
        
        update_data = {
            "bot_name": data.get('bot_name'),
            "bot_avatar": data.get('bot_avatar', 'robot'),
            "introduction": data.get('introduction', ''),
            "model_name": data.get('model_name'),
            "temperature": float(data.get('temperature', 0.7)),
            "response_timeout": int(data.get('response_timeout', 3)),
            "is_public": data.get('is_public').lower() in ['true', '1'],
            "instructions": data.get('instructions'),
            "prompt_template": data.get('prompt_template'),
            "collection_name": data.get('collection_name'),
            "documents": updated_documents
        }

        Config.get_collection().update_one(
            {"_id": ObjectId(config_id)},
            {"$set": update_data}
        )

        return jsonify({"message": "Configuration updated successfully"}), 200

    except Exception as e:
        current_app.logger.error(f"Error updating configuration: {e}", exc_info=True)
        return jsonify({"error": "An internal server error occurred"}), 500

@edit_config_bp.route('/config/<string:config_id>', methods=['DELETE'])
@jwt_required()
def delete_config(config_id):
    try:
        user_id = get_jwt_identity()
        config_to_delete = Config.get_collection().find_one({
            "_id": ObjectId(config_id),
            "user_id": user_id
        })

        if not config_to_delete:
            return jsonify({"message": "Configuration not found or access denied"}), 404

        Config.get_collection().delete_one({"_id": ObjectId(config_id)})

        try:
            db = current_app.config['MONGO_DB']
            
            vector_collection = db['vector_collection']
            vector_result = vector_collection.delete_many({"metadata.config_id": config_id})
            current_app.logger.info(f"Deleted {vector_result.deleted_count} vector chunks for config_id: {config_id}")

            metadata_collection = db['chat_session_metadata']
            sessions_to_delete = metadata_collection.find({"config_id": config_id})
            session_ids_to_delete = [s['session_id'] for s in sessions_to_delete]

            if session_ids_to_delete:
                message_collection = db['chat_histories']
                message_result = message_collection.delete_many({"SessionId": {"$in": session_ids_to_delete}})
                current_app.logger.info(f"Deleted {message_result.deleted_count} chat messages for config_id: {config_id}")

                metadata_result = metadata_collection.delete_many({"config_id": config_id})
                current_app.logger.info(f"Deleted {metadata_result.deleted_count} chat session metadata entries for config_id: {config_id}")

        except Exception as e:
            current_app.logger.error(f"Error during cascading delete for config_id '{config_id}': {e}", exc_info=True)
            return jsonify({
                "message": "Configuration deleted, but a failure occurred during data cleanup.",
                "warning": str(e)
            }), 200

        return jsonify({"message": "Configuration deleted successfully"}), 200

    except Exception as e:
        current_app.logger.error(f"An error occurred in delete_config: {e}", exc_info=True)
        return jsonify({"error": "An internal server error occurred"}), 500

@edit_config_bp.route('/file/<string:filename>', methods=['GET'])
@jwt_required()
def get_file(filename):
    try:
        user_id = get_jwt_identity()
        return send_from_directory(UPLOAD_FOLDER, filename, as_attachment=False)
    except FileNotFoundError:
        return jsonify({"error": "File not found"}), 404
    except Exception as e:
        current_app.logger.error(f"Error serving file: {e}", exc_info=True)
        return jsonify({"error": "An internal server error occurred"}), 500