from flask import Flask, jsonify, Blueprint, current_app
from flask_cors import CORS
import logging
import urllib.parse
from typing import Dict, Any
from src.utils.config import load_secrets
from flask_jwt_extended import JWTManager, get_jwt_identity, jwt_required
from flask_jwt_extended import create_access_token
# --- Set up logging for the Flask app ---
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# --- Import your modularized backend logic and routes ---
from src.utils.config import load_secrets
from src.backend.database.mongo_utils import get_mongo_db_connection
# from src.backend.aws_s3_manager import get_s3_client
from langchain_openai.embeddings import OpenAIEmbeddings
from datetime import timedelta
# --- NEW: Import the Blueprints from the routes folder ---
from routes.auth import auth_bp
from routes.config_routes import config_bp
from routes.chat_routes import chat_bp
from routes.edit_config_routes import edit_config_bp
from flask_mail import Mail

mail = Mail()
import os
from dotenv import load_dotenv

load_dotenv()
# --- Initialize Flask App ---
def create_app():
    """Factory function to create and configure the Flask application."""
    app = Flask(__name__)
    app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024
    CORS(app, resources={r"/api/*": {"origins": ["*"], "supports_credentials": True, "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"]}})


    
    # Email configuration
    app.config['MAIL_SERVER'] = os.getenv('MAIL_SERVER')
    app.config['MAIL_PORT'] = int(os.getenv('MAIL_PORT', 587)) # Cast to integer
    app.config['MAIL_USE_TLS'] = os.getenv('MAIL_USE_TLS', 'true').lower() in ['true', '1', 't'] # Convert to boolean
    app.config['MAIL_USERNAME'] = "yonathanakl@gmail.com"
    app.config['MAIL_PASSWORD'] = "zpixrackarasedas"
    app.config['MAIL_DEFAULT_SENDER'] = os.getenv('MAIL_DEFAULT_SENDER')
    app.config['MAIL_USE_SSL'] = False

# --- Secret Key for Token Generation ---
    app.config['SECRET_KEY']= os.getenv('SECRET_KEY')




    #setup email config


    # Set access tokens to expire in 1 hour
    app.config["JWT_ACCESS_TOKEN_EXPIRES"] = timedelta(hours=1)


    # INitialize Mail
    mail.init_app(app)

    # Set refresh tokens to expire in 30 days
    app.config["JWT_REFRESH_TOKEN_EXPIRES"] = timedelta(days=30)

    
    # Enable CORS for the React frontend (important for local development)

    # --- Global/Cached Resources initialized at application startup ---
    # Load secrets once when the Flask app starts and store in app.config
    app.config.from_mapping(load_secrets())

    app.config["JWT_SECRET_KEY"]=os.getenv('JWT_SECRET_KEY')
    jwt = JWTManager(app)


    # We only need the collection for the config service, so we can get it from the connection
    client, db, mongo_collection = get_mongo_db_connection(
        mongo_uri=app.config["MONGO_URI"],
        db_name=app.config["MONGO_DB_NAME"],
        collection_name=app.config["USER"]
    )
    app.config['MONGO_COLLECTION'] = mongo_collection
    app.config['MONGO_DB'] = db
    # Cache the embedding model as it's a resource
    app.config['EMBEDDINGS'] = OpenAIEmbeddings(model="text-embedding-3-large", api_key=app.config["OPENAI_API_KEY"])

    # --- NEW: Application-level cache for RAG chains ---
    # This dictionary will be stored on the app object for access in routes.
    rag_cache: Dict[str, Any] = {}

# Then, assign this typed variable to your app.config key
    app.config['RAG_CHAIN_CACHE'] = rag_cache

    # --- Register Blueprints ---
    # Blueprints organize routes into modular components.
    app.register_blueprint(chat_bp, url_prefix='/api')
    app.register_blueprint(auth_bp, url_prefix='/api/auth') 
    app.register_blueprint(config_bp, url_prefix='/api')
    app.register_blueprint(edit_config_bp, url_prefix='/api')

    
    # A simple health check endpoint
    @app.route('/health', methods=['GET'])
    def health_check():
        return jsonify({"status": "healthy", "message": "Backend is running!"})
    @app.route('/api/refresh', methods=['POST'])
    @jwt_required(refresh=True) # This decorator requires a valid REFRESH token
    def refresh():
    # Get the identity from the refresh token
        current_user_identity = get_jwt_identity()
        # Create a new access token
        new_access_token = create_access_token(identity=current_user_identity)
        
        return jsonify(access_token=new_access_token)


    return app

# --- Entry point for running the application ---
if __name__ == '__main__':
    # Create the app instance using the factory function
    app = create_app()
    # Run the app
    app.run(debug=False, host='0.0.0.0', port=5000, extra_files=None, exclude_patterns="uploads/*" )