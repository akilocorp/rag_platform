import os
from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
from bson import ObjectId
from models.user import User

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
