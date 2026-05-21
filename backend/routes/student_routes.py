from flask import Blueprint, jsonify, request, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
from bson import ObjectId
import time

student_bp = Blueprint('student', __name__)

_PERSONAL_CONFIG_DEFAULTS = {
    'is_personal': True,
    'model_name': 'gpt-4o-mini',
    'temperature': 0.7,
    'bot_name': 'My Assistant',
    'instructions': '',
    'introduction': '',
    'bot_type': 'standard',
    'bot_avatar': 'FaRobot',
    'web_access': False,
}

@student_bp.route('/personal-config', methods=['GET'])
@jwt_required()
def get_personal_config():
    user_id = get_jwt_identity()
    configs = current_app.config['MONGO_DB']['config_collections']

    doc = configs.find_one({'owner_id': user_id, 'is_personal': True})
    if not doc:
        oid = ObjectId()
        new_config = {
            '_id': oid,
            'owner_id': user_id,
            'vector_collection_name': f'config_{oid}',
            'created_at': time.time(),
            **_PERSONAL_CONFIG_DEFAULTS,
        }
        configs.insert_one(new_config)
        config_id = str(oid)
    else:
        config_id = str(doc['_id'])

    return jsonify({'config_id': config_id})


@student_bp.route('/personal-config', methods=['PATCH'])
@jwt_required()
def update_personal_config():
    user_id = get_jwt_identity()
    configs = current_app.config['MONGO_DB']['config_collections']

    doc = configs.find_one({'owner_id': user_id, 'is_personal': True})
    if not doc:
        return jsonify({'error': 'Personal config not found'}), 404

    data = request.get_json() or {}
    updates = {}
    if 'model_name' in data:
        updates['model_name'] = str(data['model_name'])
    if 'instructions' in data:
        updates['instructions'] = str(data['instructions'])
    if data.get('bot_name', '').strip():
        updates['bot_name'] = data['bot_name'].strip()

    if updates:
        configs.update_one({'_id': doc['_id']}, {'$set': updates})

    return jsonify({'config_id': str(doc['_id'])})
