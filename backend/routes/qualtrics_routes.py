import os
import json
import logging
from datetime import datetime
from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
from werkzeug.utils import secure_filename
from bson import ObjectId
import requests

from src.utils.vector_stores.store_vector_stores import process_files_and_create_vector_store
from models.config import Config
from flask import current_app

# File upload settings
UPLOAD_FOLDER = "uploads/"
ALLOWED_EXTENSIONS = {'txt', 'pdf', 'md', 'docx'}

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS

# Set up logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

qualtrics_bp = Blueprint('qualtrics', __name__)

@qualtrics_bp.route('/create-config', methods=['POST'])
@jwt_required()
def create_qualtrics_config():
    """Create a new Qualtrics-enabled configuration"""
    try:
        # Get form data
        bot_name = request.form.get('bot_name')
        model_name = request.form.get('model_name', 'gpt-3.5-turbo')
        temperature = float(request.form.get('temperature', 0.7))
        system_prompt = request.form.get('system_prompt', '')
        
        # Qualtrics-specific fields
        qualtrics_api_token = request.form.get('qualtrics_api_token')
        qualtrics_datacenter = request.form.get('qualtrics_datacenter')
        qualtrics_survey_id = request.form.get('qualtrics_survey_id')
        qualtrics_user_id = request.form.get('qualtrics_user_id', '')
        qualtrics_username = request.form.get('qualtrics_username', '')
        qualtrics_org_id = request.form.get('qualtrics_org_id', '')
        
        if not bot_name:
            return jsonify({'error': 'Bot name is required'}), 400
        
        if not qualtrics_api_token or not qualtrics_datacenter:
            return jsonify({'error': 'Qualtrics API Token and Datacenter are required'}), 400
        
        # Get user ID from token
        user_id = get_jwt_identity()
        
        # Handle file uploads
        files = request.files.getlist('files')
        temp_file_paths = []
        uploaded_filenames = []
        
        if files:
            upload_folder = 'uploads'
            os.makedirs(upload_folder, exist_ok=True)
            
            for file in files:
                if file and file.filename:
                    filename = secure_filename(file.filename)
                    filepath = os.path.join(upload_folder, filename)
                    file.save(filepath)
                    temp_file_paths.append(filepath)
                    uploaded_filenames.append(filename)
        
        # Generate config ID
        config_id = str(ObjectId())
        
        # Create configuration document
        config_doc = {
            'config_id': config_id,
            'user_id': user_id,
            'bot_name': bot_name,
            'model_name': model_name,
            'temperature': temperature,
            'system_prompt': system_prompt,
            'config_type': 'qualtrics',
            'qualtrics_config': {
                'api_token': qualtrics_api_token,
                'datacenter': qualtrics_datacenter,
                'survey_id': qualtrics_survey_id,
                'user_id': qualtrics_user_id,
                'username': qualtrics_username,
                'org_id': qualtrics_org_id
            },
            'documents': uploaded_filenames,
            'created_at': datetime.now().isoformat()
        }
        
        # Save to database (same collection as normal configs)
        mongo_collection = Config
        result = mongo_collection.get_collection().insert_one(config_doc)
        config_id = result.inserted_id
        config_doc['_id'] = str(config_id)  # Convert ObjectId to string like normal config
        
        # Process files if any
        if temp_file_paths:
            try:
                # Use collection name pattern like normal config
                final_collection_name = config_doc.get('collection_name') or f"qualtrics_{config_id}"
                process_files_and_create_vector_store(
                    temp_file_paths=temp_file_paths,
                    user_id=user_id,
                    collection_name=final_collection_name,
                    config_id=config_id
                )
                logger.info(f"Processed {len(temp_file_paths)} files for Qualtrics config {config_id}")
            except Exception as e:
                logger.error(f"Error processing files: {str(e)}")
                return jsonify({'error': f'Error processing documents: {str(e)}'}), 500
        
        logger.info(f"Created Qualtrics config {config_id} for user {user_id}")
        
        # Return same format as normal config
        return jsonify({
            "message": "Configuration saved successfully!",
            "data": config_doc
        }), 201
        
    except Exception as e:
        logger.error(f"Error creating Qualtrics config: {str(e)}")
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500




@qualtrics_bp.route('/configs', methods=['GET'])
@jwt_required()
def get_qualtrics_configs():
    """Get all Qualtrics configurations for the current user"""
    try:
        user_id = get_jwt_identity()
        
        configs = list(Config.get_collection().find(
            {'user_id': user_id, 'config_type': 'qualtrics'},
            {'qualtrics_config.api_token': 0}  # Don't return sensitive data
        ))
        
        # Convert ObjectId to string
        for config in configs:
            config['_id'] = str(config['_id'])
        
        return jsonify({'configs': configs}), 200
        
    except Exception as e:
        logger.error(f"Error getting Qualtrics configs: {str(e)}")
        return jsonify({'error': f'Internal server error: {str(e)}'}), 500

@qualtrics_bp.route('/config/<string:config_id>', methods=['PUT'])
@jwt_required()
def update_qualtrics_config(config_id):
    """Update an existing Qualtrics configuration"""
    try:
        user_id = get_jwt_identity()
        data = request.form
        files = request.files.getlist('files')

        # Validate required fields
        required_fields = ['bot_name', 'model_name', 'temperature', 'is_public']
        if not all(field in data for field in required_fields):
            return jsonify({"error": "Missing one or more required fields"}), 400

        # Find the config ensuring it belongs to the authenticated user
        config_to_update = Config.get_collection().find_one({
            "_id": ObjectId(config_id),
            "user_id": user_id,
            "config_type": "qualtrics"
        })

        if not config_to_update:
            return jsonify({"message": "Qualtrics configuration not found or access denied"}), 404

        # Prepare update data
        update_data = {
            "bot_name": data.get('bot_name'),
            "model_name": data.get('model_name'),
            "temperature": float(data.get('temperature', 0.7)),
            "is_public": data.get('is_public').lower() in ['true', '1'],
            "instructions": data.get('instructions'),
            "prompt_template": data.get('prompt_template'),
            "collection_name": data.get('collection_name'),
            "config_type": "qualtrics"
        }

        # Update Qualtrics-specific fields
        qualtrics_config = config_to_update.get('qualtrics_config', {})
        
        # Only update Qualtrics fields if provided
        if data.get('api_token'):
            qualtrics_config['api_token'] = data.get('api_token')
        if data.get('datacenter'):
            qualtrics_config['datacenter'] = data.get('datacenter')
        if data.get('survey_id'):
            qualtrics_config['survey_id'] = data.get('survey_id')
        if data.get('user_id_qualtrics'):
            qualtrics_config['user_id'] = data.get('user_id_qualtrics')
        if data.get('username'):
            qualtrics_config['username'] = data.get('username')
        if data.get('org_id'):
            qualtrics_config['org_id'] = data.get('org_id')

        update_data['qualtrics_config'] = qualtrics_config

        # Handle file uploads if provided
        if files and any(file.filename for file in files):
            # Process files and update vector store
            file_paths = []
            for file in files:
                if file and file.filename and allowed_file(file.filename):
                    filename = secure_filename(file.filename)
                    file_path = os.path.join(UPLOAD_FOLDER, filename)
                    file.save(file_path)
                    file_paths.append(file_path)

            if file_paths:
                # Process files and create/update vector store
                collection_name = update_data.get('collection_name', config_to_update.get('collection_name'))
                documents = process_files_and_create_vector_store(file_paths, collection_name, config_id)
                update_data['documents'] = documents

                # Clean up uploaded files
                for file_path in file_paths:
                    try:
                        os.remove(file_path)
                    except OSError:
                        pass

        # Update the configuration
        result = Config.get_collection().update_one(
            {"_id": ObjectId(config_id)},
            {"$set": update_data}
        )

        if result.modified_count == 0:
            return jsonify({"message": "No changes made to configuration"}), 200

        return jsonify({"message": "Qualtrics configuration updated successfully"}), 200

    except Exception as e:
        logger.error(f"Error updating Qualtrics config: {str(e)}")
        return jsonify({"error": f"Internal server error: {str(e)}"}), 500

@qualtrics_bp.route('/config/<string:config_id>', methods=['DELETE'])
@jwt_required()
def delete_qualtrics_config(config_id):
    """Delete a Qualtrics configuration and its associated vector store collection"""
    try:
        user_id = get_jwt_identity()
        
        # Find the config ensuring it belongs to the authenticated user
        config_to_delete = Config.get_collection().find_one({
            "_id": ObjectId(config_id),
            "user_id": user_id,
            "config_type": "qualtrics"
        })
        
        if not config_to_delete:
            return jsonify({"message": "Qualtrics configuration not found or access denied"}), 404
        
        collection_name = config_to_delete.get('collection_name')
        
        # Delete the configuration document
        delete_result = Config.get_collection().delete_one({"_id": ObjectId(config_id)})
        
        if delete_result.deleted_count == 0:
            return jsonify({"message": "Failed to delete Qualtrics configuration"}), 500
        
        # Delete the associated vector store collection
        if collection_name:
            try:
                db = current_app.config['MONGO_DB']
                vector_collection = db['vector_collection']
                
                # Delete all documents with this config_id
                vector_delete_result = vector_collection.delete_many({"config_id": config_id})
                logger.info(f"Deleted {vector_delete_result.deleted_count} vector documents for Qualtrics config {config_id}")
                
            except Exception as vector_error:
                logger.error(f"Error deleting vector store for Qualtrics config {config_id}: {str(vector_error)}")
                # Don't fail the entire operation if vector cleanup fails
        
        return jsonify({"message": "Qualtrics configuration deleted successfully"}), 200
        
    except Exception as e:
        logger.error(f"Error deleting Qualtrics config: {str(e)}")
        return jsonify({"error": f"Internal server error: {str(e)}"}), 500
