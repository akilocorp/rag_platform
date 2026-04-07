from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
from datetime import datetime

bug_bp = Blueprint('bug_routes', __name__)

@bug_bp.route('/report', methods=['POST'])
@jwt_required(optional=True) # 'optional=True' allows both logged-in and guest users
def report_bug():
    try:
        # Get user ID if they are logged in, otherwise default to "anonymous"
        user_id = get_jwt_identity()
        
        # We use request.json because the frontend should send this as a standard JSON payload
        data = request.json
        if not data:
            return jsonify({"error": "No data provided"}), 400

        # Extract typical bug report fields
        title = data.get('title')
        description = data.get('description')
        steps = data.get('steps', '')
        severity = data.get('severity', 'normal')

        # Basic validation
        if not title or not description:
            return jsonify({"error": "Title and description are required"}), 400

        # Construct the document
        bug_report = {
            "user_id": user_id or "anonymous",
            "title": title,
            "description": description,
            "steps": steps,
            "severity": severity,
            "status": "open", # Defaults to open so you can manage them later
            "created_at": datetime.utcnow()
        }

        # Save to MongoDB into a dedicated 'bug_reports' collection
        db = current_app.config['MONGO_DB']
        bugs_collection = db['bug_reports']
        result = bugs_collection.insert_one(bug_report)

        current_app.logger.info(f"🐛 Bug report saved successfully! ID: {result.inserted_id}")

        return jsonify({
            "message": "Bug report submitted successfully",
            "bug_id": str(result.inserted_id)
        }), 201

    except Exception as e:
        current_app.logger.error(f"Error submitting bug report: {e}", exc_info=True)
        return jsonify({"error": "An internal server error occurred"}), 500