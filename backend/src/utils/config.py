import logging
from dotenv import load_dotenv
import os

logger = logging.getLogger(__name__)
# @st.cache_resource(ttl="1h", show_spinner="Loading secrets") # Add caching with a Time-To-Live

def load_secrets():
    """
    Loads API keys, database credentials, and AWS credentials from Streamlit secrets or environment variables.
    """
    load_dotenv()
    try:
        required_secret_keys = [
        "OPENAI_API_KEY",
        "QWEN_API_KEY",
        "DEEPSEEK_API_KEY",
        "MONGO_DB_NAME",
        "MONGO_COLLECTION_NAME",
        "USERNAME",
        "PASSWORD",
        "CONFIG",
        "USER",
        "CHAT",
        "HOST",
        "PORT",
        "AWS_ACCESS_KEY_ID",
        "AWS_SECRET_ACCESS_KEY",
        "AWS_REGION",
        "AWS_S3_BUCKET_NAME",
        "JWT_SECRET_KEY",
        "MONGO_URI",
        "JWT_TOKEN_LOCATION" ,
        "JWT_HEADER_NAME",
        "JWT_HEADER_TYPE",
        "MAIL_SERVER",
        "MAIL_PORT" ,
        "MAIL_USE_TLS", 
        'NAME',
        "MAIL_USERNAME", 
        "MAIL_PASSWORD" ,
        "MAIL_DEFAULT_SENDER",
        "SECRET_KEY",
        "FRONTEND_URL"

    ]

        # Define default values for optional secrets
        default_values = {
            "MONGO_COLLECTION_NAME": "users",
            "USERNAME": "",
            "PASSWORD": "",
            "CONFIG": "configs",
            "USER": "users", 
            "CHAT": "chats",
            "HOST": "localhost",
            "PORT": "27017",
            "AWS_ACCESS_KEY_ID": "",
            "AWS_SECRET_ACCESS_KEY": "",
            "AWS_REGION": "us-east-1",
            "AWS_S3_BUCKET_NAME": "",
            "JWT_TOKEN_LOCATION": "headers",
            "JWT_HEADER_NAME": "Authorization",
            "JWT_HEADER_TYPE": "Bearer",
            "MAIL_SERVER": "",
            "MAIL_PORT": "587",
            "MAIL_USE_TLS": "true",
            "MAIL_USERNAME": "",
            "MAIL_PASSWORD": "",
            "MAIL_DEFAULT_SENDER": "",
            "FRONTEND_URL": "http://localhost:3000",
            "NAME": "RAG Platform",
            "QWEN_API_KEY": "",
            "DEEPSEEK_API_KEY": ""
        }
        
        secrets = {}
        missing_secrets = []
        
        for key in required_secret_keys:
            value = os.environ.get(key)
            if value:
                secrets[key] = value
            elif key in default_values:
                secrets[key] = default_values[key]
                logger.warning(f"Using default value for {key}: {default_values[key]}")
            else:
                missing_secrets.append(key)
        
        # Only fail for truly critical secrets
        critical_secrets = ["OPENAI_API_KEY", "MONGO_URI", "MONGO_DB_NAME", "JWT_SECRET_KEY", "SECRET_KEY"]
        critical_missing = [key for key in missing_secrets if key in critical_secrets]
        
        if critical_missing:
            error_msg = f"Missing critical secrets: {', '.join(critical_missing)}. Please check your secrets configuration."
            logger.critical(error_msg)
            raise SystemExit(error_msg)
        elif missing_secrets:
            logger.warning(f"Missing optional secrets (using defaults): {', '.join(missing_secrets)}")


        logger.info("All required secrets loaded successfully.")
        return secrets

    except Exception as e:
        logger.critical(f"FATAL ERROR during accessing st.secrets: {e}", exc_info=True)
        return {} # Return an empty dict if the app stops