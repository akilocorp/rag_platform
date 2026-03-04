"""
Script to delete a user from the system by email.
Usage: python scripts/delete_user.py <email>
Example: python scripts/delete_user.py zmaaz@connect.ust.hk
"""
import sys
import os

# Add backend to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

from src.utils.config import load_secrets
from src.backend.database.mongo_utils import get_mongo_db_connection


def delete_user_by_email(email: str):
    """Delete user and their related data from the system."""
    email = email.lower().strip()
    
    secrets = load_secrets()
    client, db, users_collection = get_mongo_db_connection(
        mongo_uri=secrets["MONGO_URI"],
        db_name=secrets["MONGO_DB_NAME"],
        collection_name=secrets["USER"]
    )
    
    # 1. Find user
    user = users_collection.find_one({"email": email})
    if not user:
        print(f"User with email '{email}' not found.")
        return False
    
    user_id = str(user["_id"])
    username = user.get("username", "N/A")
    print(f"Found user: {username} ({email}), id: {user_id}")
    
    # 2. Delete related data (configs, vector stores, chat sessions)
    config_collection = db[secrets["CONFIG"]]
    vector_stores_name = secrets.get("VectorStores", "vector_stores")
    vector_stores_collection = db[vector_stores_name]
    vector_collection = db["vector_collection"]
    chat_metadata_collection = db["chat_session_metadata"]
    
    # Get config_ids BEFORE deleting configs
    config_docs = list(config_collection.find({"user_id": user_id}))
    config_ids = [str(c["_id"]) for c in config_docs]
    
    # Delete configs
    configs_deleted = config_collection.delete_many({"user_id": user_id}).deleted_count
    
    # Delete vector chunks for those configs
    vector_deleted = 0
    if config_ids and vector_collection:
        vector_deleted = vector_collection.delete_many({"config_id": {"$in": config_ids}}).deleted_count
    
    # Delete vector stores
    vector_stores_deleted = vector_stores_collection.delete_many({"user_id": user_id}).deleted_count
    
    # Delete chat session metadata
    chat_deleted = chat_metadata_collection.delete_many({"user_id": user_id}).deleted_count
    
    # 3. Delete user
    result = users_collection.delete_one({"email": email})
    
    if result.deleted_count > 0:
        print(f"Successfully deleted user '{email}'")
        print(f"  - Configs removed: {configs_deleted}")
        print(f"  - Vector stores removed: {vector_stores_deleted}")
        print(f"  - Vector chunks removed: {vector_deleted}")
        print(f"  - Chat sessions removed: {chat_deleted}")
        return True
    else:
        print("Failed to delete user.")
        return False


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python scripts/delete_user.py <email>")
        print("Example: python scripts/delete_user.py zmaaz@connect.ust.hk")
        sys.exit(1)
    
    email = sys.argv[1]
    success = delete_user_by_email(email)
    sys.exit(0 if success else 1)
