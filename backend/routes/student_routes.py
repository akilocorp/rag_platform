from flask import Blueprint, jsonify, request, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
from bson import ObjectId
from models.user import User
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

    doc = configs.find_one({'user_id': user_id, 'is_personal': True})
    if not doc:
        oid = ObjectId()
        new_config = {
            '_id': oid,
            'user_id': user_id,
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

    doc = configs.find_one({'user_id': user_id, 'is_personal': True})
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


@student_bp.route('/enroll', methods=['POST'])
@jwt_required()
def enroll():
    """Add the current student to a class by class code."""
    user_id = get_jwt_identity()
    data = request.get_json() or {}
    class_code = (data.get('class_code') or '').strip().lower()
    if not class_code:
        return jsonify({'error': 'class_code is required'}), 400

    db = current_app.config['MONGO_DB']
    config = db['config_collections'].find_one({'class_code': class_code}, {'bot_name': 1, 'assignment_type': 1})
    if not config:
        return jsonify({'error': 'Class code not found'}), 404

    User.get_collection().update_one({'_id': ObjectId(user_id)}, {'$addToSet': {'classes': class_code}})
    return jsonify({
        'message': f"Enrolled in {config.get('bot_name', 'assignment')}",
        'config_id': str(config['_id']),
        'bot_name': config.get('bot_name', ''),
        'class_code': class_code,
    }), 200


@student_bp.route('/dashboard', methods=['GET'])
@jwt_required()
def dashboard():
    """Return all enrolled assignments with submission stats for the current student."""
    user_id = get_jwt_identity()
    db = current_app.config['MONGO_DB']

    user = User.find_by_id(user_id)
    if not user:
        return jsonify({'error': 'User not found'}), 404

    classes = user.get('classes') or []
    student_email = (user.get('email') or '').lower()
    result = []

    for code in classes:
        config = db['config_collections'].find_one(
            {'class_code': code},
            {'bot_name': 1, 'assignment_type': 1, 'upload_locked_until': 1}
        )
        if not config:
            continue
        config_id = str(config['_id'])

        # Count this student's submissions and find their best score
        subs = list(db['video_submissions'].find(
            {
                'config_id': config_id,
                '$or': [
                    {'owner_user_id': user_id},
                    {'submitter_email': student_email},
                ],
                'upload_status': {'$nin': ['upload_failed', 'awaiting_upload']},
                'status': {'$ne': 'failed'},
            },
            {'_id': 1, 'status': 1, 'created_at': 1}
        ).sort('created_at', -1))

        best_score = None
        latest_scored_id = None
        for sub in subs:
            sub_id = str(sub['_id'])
            if sub.get('status') == 'scored':
                score_doc = db['video_scores'].find_one({'submission_id': sub_id}, {'overall': 1, 'llm_overall': 1})
                if score_doc:
                    s = score_doc.get('overall') if score_doc.get('overall') is not None else score_doc.get('llm_overall')
                    if s is not None and (best_score is None or s > best_score):
                        best_score = s
                    if latest_scored_id is None:
                        latest_scored_id = sub_id

        result.append({
            'class_code': code,
            'config_id': config_id,
            'bot_name': config.get('bot_name', 'Assignment'),
            'assignment_type': config.get('assignment_type', ''),
            'submission_count': len(subs),
            'best_score': best_score,
            'latest_scored_id': latest_scored_id,
            'can_submit': len(subs) < 5,
            'upload_locked_until': config.get('upload_locked_until'),
        })

    return jsonify({'assignments': result}), 200
