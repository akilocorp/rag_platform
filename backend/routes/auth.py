from flask import Blueprint, request, jsonify, current_app, render_template
from flask_jwt_extended import (
    jwt_required, get_jwt_identity, 
    create_access_token, create_refresh_token, unset_jwt_cookies
)
from itsdangerous import URLSafeTimedSerializer, SignatureExpired, BadTimeSignature
from flask_mail import Message
from models.user import User 
from extenstions import mail, bcrypt

# --- Blueprint Setup ---
auth_bp = Blueprint('auth_bp', __name__)

# --- Helper: Send Email ---
def send_verification_email(user_email, token):
    """
    Generates email from the HTML template and sends it.
    """
    try:
        # Get the frontend URL from config, default to localhost
        frontend_url = current_app.config.get('FRONTEND_URL', 'http://localhost:3000')
        verify_url = f"{frontend_url}/verify-email?token={token}"
        
        # Render the HTML template
        # Flask looks for this in the 'templates' folder at the app root
        html_content = render_template('email/verify_email.html', verify_url=verify_url)

        msg = Message(
            subject="🚀 Welcome to Actr Lab! Please verify your email",
            recipients=[user_email],
            html=html_content
        )
        
        mail.send(msg)
        current_app.logger.info(f"Verification email sent to {user_email}")
        
    except Exception as e:
        current_app.logger.error(f"Failed to send email to {user_email}: {e}")
        # Note: We log the error but allow the flow to continue so the user isn't shown a 500 error.
        # In a strict system, you might want to rollback the user creation here.

# --- API Routes ---

@auth_bp.route('/register', methods=['POST'])
def register():
    """
    Registers a new user.
    Flow: Validate -> Check Duplicates -> Create (Unverified) -> Send Email
    """
    try:
        data = request.get_json()
        email = data.get('email')
        password = data.get('password')
        username = data.get('username')

        if not email or not password or not username:
            return jsonify({"error": "Missing required fields"}), 400

        # 1. Check if user already exists
        if User.find_by_email(email):
            return jsonify({"error": "That email is already registered."}), 409
        if User.find_by_username(username):
            return jsonify({"error": "That username is already taken."}), 409

        # 2. Hash Password
        password_hash = bcrypt.generate_password_hash(password).decode('utf-8')
        
        # 3. Create User Immediately (Unverified)
        new_user = {
            "email": email,
            "username": username,
            "password": password_hash,
            "is_verified": False  # <--- User cannot login until this is True
        }
        User.create(new_user)

        # 4. Generate Token (Contains ONLY email for security)
        serializer = URLSafeTimedSerializer(current_app.config['SECRET_KEY'])
        token = serializer.dumps(email, salt='email-confirm-salt')

        # 5. Send Email
        send_verification_email(email, token)

        return jsonify({"message": f"User '{username}' registered! Please check your email to verify."}), 201

    except Exception as e:
        current_app.logger.error(f"Error in /register: {e}")
        return jsonify({"error": "An internal server error occurred"}), 500


@auth_bp.route('/verify-email', methods=['POST'])
def verify_email():
    """
    Verifies the email token and updates the database status to verified.
    """
    try:
        data = request.get_json()
        token = data.get('token')
        if not token:
            return jsonify({"message": "Token is missing."}), 400
            
        serializer = URLSafeTimedSerializer(current_app.config['SECRET_KEY'])

        # 1. Decode Token
        try:
            # We only stored the email in the token
            email = serializer.loads(token, salt='email-confirm-salt', max_age=3600)
        except SignatureExpired:
            return jsonify({"message": "The verification link has expired. Please register again."}), 400
        except BadTimeSignature:
            return jsonify({"message": "The verification link is invalid."}), 400

        # 2. Find User
        user = User.find_by_email(email)
        if not user:
            return jsonify({"message": "User not found."}), 404

        # 3. Check if already verified
        if user.get('is_verified') is True:
            return jsonify({"message": "Account already verified. Please login."}), 200

        # 4. Update User Status
        # IMPORTANT: Ensure your User model has this method or logic!
        # If your User model uses PyMongo directly, you might need to do:
        # mongo_collection.update_one({"email": email}, {"$set": {"is_verified": True}})
        
        # Assuming you add a helper method to User model:
        if hasattr(User, 'mark_verified'):
            User.mark_verified(email)
        else:
            # Fallback if you haven't updated the model yet (assuming standard Mongo)
            current_app.config['MONGO_COLLECTION'].update_one(
                {"email": email}, 
                {"$set": {"is_verified": True}}
            )

        return jsonify({"message": "Email verified successfully! You can now log in."}), 200

    except Exception as e:
        current_app.logger.error(f"Error in /verify-email: {e}")
        return jsonify({"message": "An internal server error occurred"}), 500


@auth_bp.route('/login', methods=['POST'])
def login():
    """
    Logs the user in if credentials are valid AND email is verified.
    """
    try:
        data = request.get_json()
        username = data.get('username')
        password = data.get('password')

        if not username or not password:
            return jsonify({"error": "Username and password required"}), 400

        user = User.find_by_username(username)

        # 1. Verify Credentials
        if user and bcrypt.check_password_hash(user['password'], password):
            
            # 2. Verify Email Status
            if not user.get('is_verified', False):
                return jsonify({"error": "Please verify your email address first."}), 403

            # 3. Generate Tokens
            user_id = str(user['_id'])
            access_token = create_access_token(identity=user_id)
            refresh_token = create_refresh_token(identity=user_id)

            return jsonify({
                "access_token": access_token, 
                "refresh_token": refresh_token,
                "user": {
                    "username": user['username'],
                    "email": user['email']
                }
            })

        return jsonify({"error": "Invalid username or password"}), 401

    except Exception as e:
        current_app.logger.error(f"Error in /login: {e}")
        return jsonify({"error": "An internal server error occurred"}), 500


@auth_bp.route('/logout', methods=['POST'])
@jwt_required()
def logout():
    """
    Logs the user out.
    """
    try:
        response = jsonify({"message": "Logout successful"})
        unset_jwt_cookies(response)
        return response, 200
    except Exception as e:
        current_app.logger.error(f"Error in /logout: {e}")
        return jsonify({"error": "Logout failed"}), 500


@auth_bp.route('/refresh', methods=['POST'])
@jwt_required(refresh=True)
def refresh():
    """Refreshes an access token."""
    try:
        current_user_id = get_jwt_identity()
        new_access_token = create_access_token(identity=current_user_id)
        return jsonify(access_token=new_access_token), 200
    except Exception as e:
        current_app.logger.error(f"Error in /refresh: {e}")
        return jsonify({"error": "Refresh failed"}), 500


@auth_bp.route('/me', methods=['GET'])
@jwt_required()
def get_user_info():
    """Get current user info."""
    try:
        current_user_id = get_jwt_identity()
        user = User.find_by_id(current_user_id)
        if not user:
            return jsonify({"error": "User not found"}), 404
        
        return jsonify({
            "username": user['username'],
            "email": user['email'],
            # "is_verified": user.get('is_verified', False) 
        })
    except Exception as e:
        current_app.logger.error(f"Error in /me: {e}")
        return jsonify({"error": "Server error"}), 500