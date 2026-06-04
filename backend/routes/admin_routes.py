import os
import uuid
from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
from bson import ObjectId
from models.user import User
from src.usage import limits as usage_limits

admin_bp = Blueprint('admin', __name__)

VALID_ROLES = {'professor', 'student', 'admin'}


def _require_admin():
    """Returns (user_doc, None) if the caller is an admin, else (None, error_response)."""
    user_id = get_jwt_identity()
    user = User.find_by_id(user_id)
    if not user or user.get('role') != 'admin':
        return None, (jsonify({"error": "Admin access required"}), 403)
    return user, None


@admin_bp.route('/users', methods=['GET'])
@jwt_required()
def list_users():
    """Returns all users with id, email, username, role."""
    _, err = _require_admin()
    if err:
        return err
    collection = User.get_collection()
    users = list(collection.find({}, {"password": 0}))
    result = []
    for u in users:
        result.append({
            "id": str(u["_id"]),
            "email": u.get("email", ""),
            "username": u.get("username", ""),
            "role": u.get("role", "professor"),
            "is_verified": u.get("is_verified", False),
        })
    result.sort(key=lambda u: u["email"])
    return jsonify({"users": result}), 200


@admin_bp.route('/users/<string:user_id>/role', methods=['PUT'])
@jwt_required()
def update_user_role(user_id):
    """Updates a user's role. Admin only."""
    caller, err = _require_admin()
    if err:
        return err

    data = request.get_json() or {}
    new_role = data.get("role", "").strip()
    if new_role not in VALID_ROLES:
        return jsonify({"error": f"Invalid role. Must be one of: {', '.join(sorted(VALID_ROLES))}"}), 400

    target = User.find_by_id(user_id)
    if not target:
        return jsonify({"error": "User not found"}), 404

    # Prevent an admin from demoting themselves (accidental lockout)
    if str(target["_id"]) == str(caller["_id"]) and new_role != "admin":
        return jsonify({"error": "You cannot change your own admin role"}), 400

    collection = User.get_collection()
    collection.update_one({"_id": ObjectId(user_id)}, {"$set": {"role": new_role}})
    return jsonify({"message": f"Role updated to '{new_role}'"}), 200


def _settings_payload(doc):
    return {
        "anon_lifetime_cap": int(doc.get("anon_lifetime_cap", 0)),
        "student_default_cap": int(doc.get("student_default_cap", 0)),
        "professor_default_cap": int(doc.get("professor_default_cap", 0)),
        "warn_threshold": float(doc.get("warn_threshold", 0.8)),
        "tiers": doc.get("tiers", []),
    }


@admin_bp.route('/usage/settings', methods=['GET'])
@jwt_required()
def get_usage_settings():
    _, err = _require_admin()
    if err:
        return err
    return jsonify(_settings_payload(usage_limits.get_settings())), 200


@admin_bp.route('/usage/settings', methods=['PUT'])
@jwt_required()
def update_usage_settings():
    _, err = _require_admin()
    if err:
        return err
    data = request.get_json() or {}
    update = {}
    for field in ("anon_lifetime_cap", "student_default_cap", "professor_default_cap"):
        if field in data:
            try:
                val = int(data[field])
                if val < 0:
                    raise ValueError
            except (ValueError, TypeError):
                return jsonify({"error": f"{field} must be a non-negative integer"}), 400
            update[field] = val
    if "warn_threshold" in data:
        try:
            wt = float(data["warn_threshold"])
            if not (0.0 <= wt <= 1.0):
                raise ValueError
        except (ValueError, TypeError):
            return jsonify({"error": "warn_threshold must be between 0 and 1"}), 400
        update["warn_threshold"] = wt
    if update:
        usage_limits.get_settings()  # ensure singleton exists
        current_app.config['MONGO_DB'][usage_limits.CONFIG].update_one(
            {"_id": "settings"}, {"$set": update}
        )
    return jsonify(_settings_payload(usage_limits.get_settings())), 200


@admin_bp.route('/usage/tiers', methods=['POST'])
@jwt_required()
def add_usage_tier():
    _, err = _require_admin()
    if err:
        return err
    data = request.get_json() or {}
    name = (data.get("name") or "").strip()
    try:
        mps = int(data.get("messages_per_student"))
        if mps <= 0:
            raise ValueError
    except (ValueError, TypeError):
        return jsonify({"error": "messages_per_student must be a positive integer"}), 400
    if not name:
        return jsonify({"error": "Tier name is required"}), 400
    tier = {"id": uuid.uuid4().hex[:8], "name": name, "messages_per_student": mps}
    usage_limits.get_settings()
    current_app.config['MONGO_DB'][usage_limits.CONFIG].update_one(
        {"_id": "settings"}, {"$push": {"tiers": tier}}
    )
    return jsonify(_settings_payload(usage_limits.get_settings())), 201


@admin_bp.route('/usage/tiers/<string:tier_id>', methods=['PUT'])
@jwt_required()
def edit_usage_tier(tier_id):
    _, err = _require_admin()
    if err:
        return err
    data = request.get_json() or {}
    set_fields = {}
    if "name" in data:
        name = (data.get("name") or "").strip()
        if not name:
            return jsonify({"error": "Tier name cannot be empty"}), 400
        set_fields["tiers.$.name"] = name
    if "messages_per_student" in data:
        try:
            mps = int(data["messages_per_student"])
            if mps <= 0:
                raise ValueError
        except (ValueError, TypeError):
            return jsonify({"error": "messages_per_student must be a positive integer"}), 400
        set_fields["tiers.$.messages_per_student"] = mps
    if not set_fields:
        return jsonify({"error": "Nothing to update"}), 400
    res = current_app.config['MONGO_DB'][usage_limits.CONFIG].update_one(
        {"_id": "settings", "tiers.id": tier_id}, {"$set": set_fields}
    )
    if res.matched_count == 0:
        return jsonify({"error": "Tier not found"}), 404
    return jsonify(_settings_payload(usage_limits.get_settings())), 200


@admin_bp.route('/usage/tiers/<string:tier_id>', methods=['DELETE'])
@jwt_required()
def delete_usage_tier(tier_id):
    _, err = _require_admin()
    if err:
        return err
    current_app.config['MONGO_DB'][usage_limits.CONFIG].update_one(
        {"_id": "settings"}, {"$pull": {"tiers": {"id": tier_id}}}
    )
    return jsonify(_settings_payload(usage_limits.get_settings())), 200


@admin_bp.route('/promote', methods=['POST'])
def bootstrap_admin():
    """
    One-time bootstrap: promotes a user to admin using the ADMIN_BOOTSTRAP_KEY
    env var as a shared secret. Remove or disable after first use.

    Body: { "email": "...", "key": "<ADMIN_BOOTSTRAP_KEY>" }
    """
    secret = os.environ.get("ADMIN_BOOTSTRAP_KEY", "")
    if not secret:
        return jsonify({"error": "Bootstrap is disabled (ADMIN_BOOTSTRAP_KEY not set)"}), 403

    data = request.get_json() or {}
    if data.get("key") != secret:
        return jsonify({"error": "Invalid key"}), 403

    email = (data.get("email") or "").strip().lower()
    user = User.find_by_email(email)
    if not user:
        return jsonify({"error": "User not found"}), 404

    User.update_role(email, "admin")
    return jsonify({"message": f"'{email}' promoted to admin"}), 200
