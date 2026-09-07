# @language  Python
# @updated   2026-09-07
# @changed   getfqdn patch extracted to _smtp_compat.py (was copy-pasted verbatim in this file
#            and test_verification_email.py). No behavior change.
"""
SMTP config diagnostic script — sends one plain test email to confirm mail server config works.
Run: cd backend && python scripts/test_email.py <recipient email>
"""
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from _smtp_compat import patch_getfqdn
patch_getfqdn()

from dotenv import load_dotenv
load_dotenv()

def test_email():
    from src.utils.config import load_secrets
    from flask import Flask
    from flask_mail import Mail, Message
    
    recipient = sys.argv[1] if len(sys.argv) > 1 else os.environ.get("MAIL_USERNAME", "test@example.com")
    
    print("=" * 50)
    print("Email send diagnostic")
    print("=" * 50)
    
    secrets = load_secrets()
    
    # 显示配置（隐藏密码）
    mail_user = secrets.get("MAIL_USERNAME", "")
    mail_pass = secrets.get("MAIL_PASSWORD", "")
    print(f"MAIL_SERVER: {secrets.get('MAIL_SERVER')}")
    print(f"MAIL_PORT: {secrets.get('MAIL_PORT')}")
    print(f"MAIL_USE_TLS: {secrets.get('MAIL_USE_TLS')}")
    print(f"MAIL_USERNAME: {mail_user}")
    print(f"MAIL_PASSWORD: {'*' * len(mail_pass) if mail_pass else '(空)'}")
    print(f"MAIL_DEFAULT_SENDER: {secrets.get('MAIL_DEFAULT_SENDER')}")
    print(f"Recipient: {recipient}")
    print("=" * 50)
    
    app = Flask(__name__)
    app.config.from_mapping(secrets)
    app.config['MAIL_PORT'] = int(app.config.get('MAIL_PORT', 587))
    app.config['MAIL_USE_TLS'] = str(app.config.get('MAIL_USE_TLS', 'true')).lower() in ['true', '1', 't']
    app.config['MAIL_USE_SSL'] = False
    
    mail = Mail(app)
    
    try:
        with app.app_context():
            msg = Message(
                subject="[测试] Actr Lab 邮件配置诊断",
                recipients=[recipient],
                body="这是一封测试邮件。如果你收到此邮件，说明 SMTP 配置正常。",
                sender=app.config.get("MAIL_DEFAULT_SENDER")
            )
            mail.send(msg)
            print("[OK] Email sent. Check inbox (and spam).")
            return 0
    except Exception as e:
        print(f"\n[FAIL] Send failed:")
        print(f"  Error type: {type(e).__name__}")
        print(f"  Error message: {e}")
        import traceback
        print("\nFull traceback:")
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(test_email())
