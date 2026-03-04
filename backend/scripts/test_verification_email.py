"""
Send verification email. Can be run standalone or called from registration.
Usage:
  Standalone: python scripts/test_verification_email.py <email>
  From app:   python scripts/test_verification_email.py <email> <token>
"""
import sys
import os
import socket

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

_orig_getfqdn = socket.getfqdn
def _safe_getfqdn(name=""):
    try:
        result = _orig_getfqdn(name)
        result.encode("ascii")
        return result
    except (UnicodeEncodeError, AttributeError):
        return name if name else "localhost"
socket.getfqdn = _safe_getfqdn

from dotenv import load_dotenv
load_dotenv()

def send_verification_email(recipient, token=None):
    """Send verification email. If token is None, generate one."""
    from src.utils.config import load_secrets
    from flask import Flask
    from flask_mail import Mail, Message
    from itsdangerous import URLSafeTimedSerializer

    app = Flask(__name__)
    secrets = load_secrets()
    app.config.from_mapping(secrets)
    app.config['MAIL_PORT'] = int(app.config.get('MAIL_PORT', 587))
    app.config['MAIL_USE_TLS'] = str(app.config.get('MAIL_USE_TLS', 'true')).lower() in ['true', '1', 't']
    app.config['MAIL_USE_SSL'] = False

    mail = Mail(app)

    with app.app_context():
        frontend_url = app.config.get('FRONTEND_URL', 'https://app.bitterlylab.com')
        if token is None:
            serializer = URLSafeTimedSerializer(app.config['SECRET_KEY'])
            token = serializer.dumps(recipient.lower(), salt='email-confirm-salt')
        verify_url = f"{frontend_url}/verify-email?token={token}"

        body_text = (
            f"Welcome to Actr Lab!\n\n"
            f"Please verify your email by clicking this link:\n{verify_url}\n\n"
            f"This link expires in 1 hour.\n\n"
            f"If you didn't create an account, you can ignore this email."
        )

        msg = Message(
            subject="Actr Lab - Verify your email",
            recipients=[recipient],
            body=body_text
        )
        mail.send(msg)
        return True

def main():
    recipient = sys.argv[1] if len(sys.argv) > 1 else None
    token = sys.argv[2] if len(sys.argv) > 2 else None
    if not recipient:
        print("Usage: python scripts/test_verification_email.py <email> [token]")
        sys.exit(1)

    send_verification_email(recipient, token)
    print(f"[OK] Verification email sent to {recipient}. Check inbox and spam.")

if __name__ == "__main__":
    main()
