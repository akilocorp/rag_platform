from flask import current_app
from bson import ObjectId

class User:
    """
    User model for interacting with the users collection in MongoDB.
    """

    @staticmethod
    def get_collection():
        """
        Retrieves the pre-initialized collection from app config.
        PREVENTS creating a new connection on every request.
        """
        # In app.py, we stored this as app.config['MONGO_COLLECTION']
        return current_app.config["MONGO_COLLECTION"]

    @staticmethod
    def create(user_data):
        """
        Inserts a new user into the database.
        Expects user_data to already contain the hashed password.
        """
        collection = User.get_collection()
        
        # Ensure email is lowercase for consistency
        if 'email' in user_data:
            user_data['email'] = user_data['email'].lower()

        result = collection.insert_one(user_data)
        return result.inserted_id

    @staticmethod
    def find_by_email(email):
        """Finds a user by email (case-insensitive)."""
        collection = User.get_collection()
        return collection.find_one({"email": email.lower()})

    @staticmethod
    def find_by_username(username):
        """Finds a user by username."""
        collection = User.get_collection()
        return collection.find_one({"username": username})

    @staticmethod
    def find_by_id(user_id):
        """Finds a user by their unique _id."""
        try:
            collection = User.get_collection()
            return collection.find_one({"_id": ObjectId(user_id)})
        except Exception:
            return None

    @staticmethod
    def mark_verified(email):
        """
        Updates the user's 'is_verified' status to True.
        Used by the /verify-email endpoint.
        """
        collection = User.get_collection()
        result = collection.update_one(
            {"email": email.lower()},
            {"$set": {"is_verified": True}}
        )
        return result.modified_count > 0