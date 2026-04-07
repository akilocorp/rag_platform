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

# --- NO MORE EVENTLET MONKEY PATCHING ---
from flask_socketio import SocketIO

# --- Import your modules ---
from src.utils.config import load_secrets
from src.backend.database.mongo_utils import get_mongo_db_connection

from routes.auth import auth_bp
from routes.bug_routes import bug_bp # <--- NEW IMPORT
from routes.config_routes import config_bp
from routes.chat_routes import chat_bp
from routes.edit_config_routes import edit_config_bp
from routes.group_chat_sockets import register_socket_events

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

socketio = SocketIO(cors_allowed_origins="*")

def create_app():
    app = Flask(__name__)
    secrets = load_secrets()
    app.config.from_mapping(secrets)
    app.config['MAX_CONTENT_LENGTH'] = 500 * 1024 * 1024
    
    app.config['MAIL_PORT'] = int(app.config.get('MAIL_PORT', 587))
    app.config['MAIL_USE_TLS'] = str(app.config.get('MAIL_USE_TLS', 'true')).lower() in ['true', '1', 't']
    app.config['MAIL_USE_SSL'] = False  
    app.config['MAIL_DEFAULT_CHARSET'] = 'utf-8'
    
    app.config["JWT_ACCESS_TOKEN_EXPIRES"] = timedelta(hours=1)
    app.config["JWT_REFRESH_TOKEN_EXPIRES"] = timedelta(days=30)
    
    allowed_origins = [
        "http://localhost:3000",
        "https://app.bitterlylab.com",
        "https://app.actrlab.com",
        r"^https://.*\.qualtrics\.com$" 
    ]
    
    CORS(app, resources={r"/api/*": {"origins": allowed_origins, "supports_credentials": True, "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"]}})

    mail.init_app(app)
    jwt.init_app(app)
    bcrypt.init_app(app)
    
    # --- USE THREADING (Simple-WebSocket) INSTEAD OF EVENTLET ---
    socketio.init_app(app, async_mode='threading')

    client, db, mongo_collection = get_mongo_db_connection(
        mongo_uri=app.config["MONGO_URI"],
        db_name=app.config["MONGO_DB_NAME"],
        collection_name=app.config["USER"] 
    )
    
    app.config['MONGO_COLLECTION'] = mongo_collection
    app.config['MONGO_DB'] = db
    
    app.config['EMBEDDINGS'] = OpenAIEmbeddings(
        model="text-embedding-3-large", 
        api_key=app.config["OPENAI_API_KEY"]
    )
    app.config['RAG_CHAIN_CACHE'] = {}

    app.register_blueprint(chat_bp, url_prefix='/api')
    app.register_blueprint(auth_bp, url_prefix='/api/auth') 
    app.register_blueprint(config_bp, url_prefix='/api')
    app.register_blueprint(edit_config_bp, url_prefix='/api')
    app.register_blueprint(bug_bp, url_prefix='/api/bugs')

    register_socket_events(socketio, app)

    @app.route('/health', methods=['GET'])
    def health_check():
        return jsonify({"status": "healthy", "message": "Backend is running!"})

    @app.route('/api/refresh', methods=['POST'])
    @jwt_required(refresh=True)
    def refresh():
        current_user_identity = get_jwt_identity()
        new_access_token = create_access_token(identity=current_user_identity)
        return jsonify(access_token=new_access_token)

    return app

if __name__ == '__main__':
    app = create_app()
    
    # --- CRITICAL FIX: USE SOCKETIO.RUN, NOT APP.RUN ---
    socketio.run(
        app,
        debug=False, 
        host='0.0.0.0', 
        port=5000,
        allow_unsafe_werkzeug=True # This allows WebSockets to work on the dev server
    )