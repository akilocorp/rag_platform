import os
import logging
from datetime import timedelta
from typing import Dict, Any
from extenstions import mail, jwt, bcrypt
from flask import Flask, jsonify
from flask_cors import CORS
from flask_jwt_extended import JWTManager, get_jwt_identity, jwt_required, create_access_token
from flask_mail import Mail
from langchain_openai.embeddings import OpenAIEmbeddings

# --- Import your modules ---
from src.utils.config import load_secrets
from src.backend.database.mongo_utils import get_mongo_db_connection

# --- Import Blueprints ---
from routes.auth import auth_bp
from routes.config_routes import config_bp
from routes.chat_routes import chat_bp
from routes.edit_config_routes import edit_config_bp

# --- Logging Setup ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Initialize Extensions

def create_app():
    """Factory function to create and configure the Flask application."""
    app = Flask(__name__)
    
    # 1. Load All Secrets First
    # This loads everything from .env and validates critical keys exist.
    secrets = load_secrets()
    app.config.from_mapping(secrets)

    # 2. Configuration & Type Casting
    # load_secrets returns strings, so we must cast types for Flask extensions
    app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024
    
    # Mail Config (Type conversion)
    app.config['MAIL_PORT'] = int(app.config.get('MAIL_PORT', 587))
    app.config['MAIL_USE_TLS'] = str(app.config.get('MAIL_USE_TLS', 'true')).lower() in ['true', '1', 't']
    app.config['MAIL_USE_SSL'] = False  # Explicitly disable SSL if using TLS
    
    # JWT Config
    app.config["JWT_ACCESS_TOKEN_EXPIRES"] = timedelta(hours=1)
    app.config["JWT_REFRESH_TOKEN_EXPIRES"] = timedelta(days=30)
    
    # 3. Security & CORS
    # Dynamic Origin Logic for Qualtrics & Custom Domains
    allowed_origins = [
        "http://localhost:3000",
        "https://app.bitterlylab.com",
        "https://app.actrlab.com",
        r"^https://.*\.qualtrics\.com$"  # Regex for any Qualtrics subdomain
    ]
    
    CORS(app, resources={
        r"/api/*": {
            "origins": allowed_origins,
            "supports_credentials": True,
            "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"]
        }
    })

    # 4. Initialize Extensions
    mail.init_app(app)
    jwt.init_app(app)
    bcrypt.init_app(app)


    # 5. Database & Resources
    # We retrieve the specific collection name using the key "USER" from secrets
    client, db, mongo_collection = get_mongo_db_connection(
        mongo_uri=app.config["MONGO_URI"],
        db_name=app.config["MONGO_DB_NAME"],
        collection_name=app.config["USER"] 
    )
    
    # Store DB references in config for easy access
    app.config['MONGO_COLLECTION'] = mongo_collection
    app.config['MONGO_DB'] = db
    
    # Initialize Embedding Model
    app.config['EMBEDDINGS'] = OpenAIEmbeddings(
        model="text-embedding-3-large", 
        api_key=app.config["OPENAI_API_KEY"]
    )

    # Initialize RAG Cache
    app.config['RAG_CHAIN_CACHE'] = {}

    # 6. Register Blueprints
    app.register_blueprint(chat_bp, url_prefix='/api')
    app.register_blueprint(auth_bp, url_prefix='/api/auth') 
    app.register_blueprint(config_bp, url_prefix='/api')
    app.register_blueprint(edit_config_bp, url_prefix='/api')

    # --- Global Routes ---

    @app.route('/health', methods=['GET'])
    def health_check():
        return jsonify({"status": "healthy", "message": "Backend is running!"})

    @app.route('/api/refresh', methods=['POST'])
    @jwt_required(refresh=True)
    def refresh():
        """
        Refreshes the access token using a valid refresh token.
        Note: Ideally, this should be moved to routes/auth.py in the future.
        """
        current_user_identity = get_jwt_identity()
        new_access_token = create_access_token(identity=current_user_identity)
        return jsonify(access_token=new_access_token)

    return app

# --- Entry point ---
if __name__ == '__main__':
    app = create_app()
    app.run(
        debug=False, 
        host='0.0.0.0', 
        port=5000, 
        extra_files=None, 
        exclude_patterns="uploads/*"
    )