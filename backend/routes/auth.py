import re
import secrets
import smtplib
from email import policy
from email.message import EmailMessage
from datetime import datetime, timedelta
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
        frontend_url = current_app.config.get('FRONTEND_URL', 'https://app.bitterlylab.com')
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


def send_password_reset_email(user_email, token):
    """Sends password reset verification email. Uses smtplib directly with UTF-8 policy to avoid encoding issues."""
    try:
        frontend_url = current_app.config.get('FRONTEND_URL', 'https://app.bitterlylab.com')
        try:
            frontend_url.encode('ascii')
        except UnicodeEncodeError:
            frontend_url = 'https://app.bitterlylab.com'
        reset_url = f"{frontend_url}/reset-password?token={token}"
        body = f"Reset your Actr Lab password by clicking this link:\n\n{reset_url}\n\nThis link expires in 1 hour.\n\nIf you did not request this, ignore this email."
        html_content = render_template('email/reset_password.html', reset_url=reset_url)
        sender = current_app.config.get('MAIL_USERNAME')
        if not sender:
            default_sender = current_app.config.get('MAIL_DEFAULT_SENDER')
            if isinstance(default_sender, str) and '@' in default_sender:
                sender = default_sender.split('<')[-1].rstrip('>').strip() if '<' in default_sender else default_sender
            elif isinstance(default_sender, (list, tuple)) and len(default_sender) >= 2:
                sender = default_sender[1]
        if not sender:
            sender = 'noreply@actrlab.com'

        msg = EmailMessage(policy=policy.SMTPUTF8)
        msg['Subject'] = 'Actr Lab - Reset Your Password'
        msg['From'] = sender
        msg['To'] = user_email
        msg.set_content(body)
        msg.add_alternative(html_content, subtype='html')

        server = smtplib.SMTP(
            current_app.config.get('MAIL_SERVER', 'localhost'),
            current_app.config.get('MAIL_PORT', 587),
            local_hostname='localhost'
        )
        try:
            if current_app.config.get('MAIL_USE_TLS', True):
                server.starttls()
            mail_user = current_app.config.get('MAIL_USERNAME')
            mail_pass = current_app.config.get('MAIL_PASSWORD')
            if mail_user and mail_pass:
                server.login(mail_user, mail_pass)
            server.send_message(msg)
        finally:
            server.quit()
        current_app.logger.info(f"Password reset email sent to {user_email}")
    except Exception as e:
        import traceback
        current_app.logger.error(f"Failed to send password reset email to {user_email}: {e}")
        current_app.logger.error(traceback.format_exc())
        raise


# --- API Routes ---

@auth_bp.route('/register', methods=['POST'])
def register():
    """
    Registers a new user.
    Flow: Validate -> Check Duplicates -> Create (Unverified) -> Send Email
    """
    try:
        data = request.get_json()
        email = (data.get('email') or '').strip()
        password = data.get('password')
        username = (data.get('username') or '').strip()

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


def _normalize_identifier(s):
    """Normalize login identifier: strip, fix fullwidth @ (U+FF20) to ASCII @."""
    if not s or not isinstance(s, str):
        return ""
    s = s.strip()
    s = s.replace("\uff20", "@")  # fullwidth @ -> ASCII @
    return s


@auth_bp.route('/login', methods=['POST'])
def login():
    """
    Logs the user in if credentials are valid AND email is verified.
    Accepts either email or username in the 'username' or 'email' field.
    """
    try:
        data = request.get_json() or {}
        # Support both 'username' and 'email' keys for the identifier
        identifier = _normalize_identifier(
            data.get("username") or data.get("email") or ""
        )
        password = data.get("password")

        if not identifier or not password:
            return jsonify({"error": "Username/email and password required"}), 400

        user = User.find_by_email_or_username(identifier)

        # Debug logging (mask identifier for privacy)
        _mask = lambda x: f"{x[:2]}...{x[-2:]}" if len(x) > 5 else "***" if x else ""
        current_app.logger.info(
            f"[Login] identifier={_mask(identifier)} has_at={('@' in identifier)}, "
            f"user_found={user is not None}"
        )
        if user:
            pw_ok = bcrypt.check_password_hash(user['password'], password)
            current_app.logger.info(
                f"[Login] user={user.get('username')} password_ok={pw_ok} is_verified={user.get('is_verified')}"
            )

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

        return jsonify({"error": "Invalid username/email or password"}), 401

    except Exception as e:
        current_app.logger.error(f"Error in /login: {e}")
        return jsonify({"error": "An internal server error occurred"}), 500


@auth_bp.route('/forgot-password', methods=['POST'])
def forgot_password():
    """
    Initiates password reset. User provides email and new password.
    Sends verification email. New password cannot be same as old one.
    """
    try:
        data = request.get_json() or {}
        email = (data.get('email') or '').strip().lower()
        new_password = data.get('new_password')
        confirm_password = data.get('confirm_password')

        if not email or not new_password:
            return jsonify({"error": "Email and new password are required"}), 400

        if new_password != confirm_password:
            return jsonify({"error": "Passwords do not match"}), 400

        password_regex = re.compile(r'^(?=.*[a-zA-Z])(?=.*\d)(?=.*[^a-zA-Z0-9]).{8,}$')
        if not password_regex.match(new_password):
            return jsonify({"error": "Password must be at least 8 characters with letter, number, and special character."}), 400

        user = User.find_by_email(email)
        if not user:
            return jsonify({"error": "If this email is registered, you will receive a reset link."}), 200

        if bcrypt.check_password_hash(user['password'], new_password):
            return jsonify({"error": "Password cannot be the same as old password"}), 400

        password_hash = bcrypt.generate_password_hash(new_password).decode('utf-8')
        token = secrets.token_urlsafe(32)
        db = current_app.config['MONGO_DB']
        coll = db['password_reset_tokens']
        coll.insert_one({
            "token": token,
            "email": email,
            "password_hash": password_hash,
            "created_at": datetime.utcnow()
        })

        send_password_reset_email(email, token)
        return jsonify({"message": "If this email is registered, you will receive a reset link shortly."}), 200

    except Exception as e:
        current_app.logger.error(f"Error in /forgot-password: {e}")
        return jsonify({"error": "An internal server error occurred"}), 500


@auth_bp.route('/reset-password', methods=['POST'])
def reset_password():
    """
    Verifies the reset token and updates the user's password.
    Called when user clicks the link in the verification email.
    """
    try:
        data = request.get_json() or {}
        token = data.get('token')
        if not token:
            return jsonify({"error": "Token is missing"}), 400

        db = current_app.config['MONGO_DB']
        coll = db['password_reset_tokens']
        record = coll.find_one({"token": token})
        if not record:
            current_app.logger.warning(f"[ResetPassword] Token not found in DB")
            return jsonify({"error": "Invalid reset link. Please request a new one."}), 400

        created_at = record.get('created_at')
        if created_at and datetime.utcnow() - created_at > timedelta(hours=1):
            coll.delete_one({"token": token})
            return jsonify({"error": "The reset link has expired. Please request a new one."}), 400

        email = record.get('email')
        password_hash = record.get('password_hash')
        if not email or not password_hash:
            return jsonify({"error": "Invalid reset link"}), 400

        updated = User.update_password(email, password_hash)
        if not updated:
            current_app.logger.error(f"[ResetPassword] User.update_password failed for email={email}")
            return jsonify({"error": "User not found"}), 404

        coll.delete_one({"token": token})
        current_app.logger.info(f"[ResetPassword] Password updated successfully for {email}")
        return jsonify({"message": "Password updated successfully. You can now log in with your new password."}), 200

    except Exception as e:
        current_app.logger.error(f"Error in /reset-password: {e}")
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