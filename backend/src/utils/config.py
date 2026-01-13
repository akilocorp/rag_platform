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
        "HEY_GEN_API_KEY",
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

        secrets = {key: os.environ.get(key) for key in required_secret_keys}
        missing_secrets = [key for key, val in secrets.items() if not val]

        if missing_secrets:
            error_msg = f"Missing or invalid critical secrets: {', '.join(missing_secrets)}. Please check your secrets configuration."
            logger.critical(error_msg)
            raise SystemExit(error_msg)


        logger.info("All required secrets loaded successfully.")
        return secrets

    except Exception as e:
        logger.critical(f"FATAL ERROR during accessing st.secrets: {e}", exc_info=True)
        return {} # Return an empty dict if the app stops