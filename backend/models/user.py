import re
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
        
        # Ensure email is normalized: strip whitespace and lowercase
        if 'email' in user_data:
            user_data['email'] = user_data['email'].strip().lower()

        result = collection.insert_one(user_data)
        return result.inserted_id

    @staticmethod
    def find_by_email(email):
        """Finds a user by email (case-insensitive)."""
        if not email:
            return None
        collection = User.get_collection()
        normalized = email.strip().lower()
        user = collection.find_one({"email": normalized})
        if not user:
            pattern = r"^\s*" + re.escape(normalized) + r"\s*$"
            user = collection.find_one({"email": {"$regex": pattern}})
        return user

    @staticmethod
    def find_by_username(username):
        """Finds a user by username."""
        collection = User.get_collection()
        return collection.find_one({"username": username})

    @staticmethod
    def find_by_email_or_username(identifier):
        """Finds a user by email or username. Identifier can be either."""
        if not identifier:
            return None
        collection = User.get_collection()
        identifier = identifier.strip()
        # Try username first (exact match)
        user = collection.find_one({"username": identifier})
        if user:
            return user
        # Try email (case-insensitive, tolerate DB values with surrounding whitespace)
        if '@' in identifier:
            normalized = identifier.lower()
            user = collection.find_one({"email": normalized})
            if not user:
                # Fallback: match email with optional surrounding whitespace (legacy data)
                pattern = r"^\s*" + re.escape(normalized) + r"\s*$"
                user = collection.find_one({"email": {"$regex": pattern}})
        return user

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
        user = User.find_by_email(email)
        if not user:
            return False
        collection = User.get_collection()
        result = collection.update_one(
            {"_id": user["_id"]},
            {"$set": {"is_verified": True}}
        )
        return result.modified_count > 0

    @staticmethod
    def update_password(email, password_hash):
        """
        Updates the user's password by email.
        Returns True if updated, False if user not found.
        """
        user = User.find_by_email(email)
        if not user:
            return False
        collection = User.get_collection()
        result = collection.update_one(
            {"_id": user["_id"]},
            {"$set": {"password": password_hash}}
        )
        return result.modified_count > 0