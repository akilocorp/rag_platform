# @language  Python
# @updated   2026-09-14
# @changed   Added `find_editable_by`, the dashboard's query: configs this user owns OR is a
#            collaborator on. `find_by_user_id` is left alone and still means strictly "mine",
#            because usage counting and ownership checks depend on it meaning that.
from flask import current_app
import pymongo
from werkzeug.security import generate_password_hash, check_password_hash
from bson import ObjectId  
class Config:
    """
    User model for interacting with the users collection in MongoDB.
    This class encapsulates all database logic for users.
    """

    @staticmethod
    def get_collection():
        """
        A helper method to get the user collection object from the database.
        It assumes you have a 'MONGO_CLIENT' in your app config.
        """
        mongo_client = pymongo.MongoClient(current_app.config["MONGO_URI"], serverSelectionTimeoutMS=5000)
        # Get the database from the client
        db = mongo_client[current_app.config["MONGO_DB_NAME"]]
        # Get the collection using the name stored in the config
        return db[current_app.config["CONFIG"]]

    @staticmethod
    def create(obj):
        """
        Creates a new user, hashes their password, and inserts them into the database.
        Returns the result of the insert operation.
        """
        config_collection = Config.get_collection()
        
        # Hash the password before storing
        current_app.logger.info(f"{obj}")
        
        
        return config_collection.insert_one(obj)

    @staticmethod
    def find_by_id(id):
        """Finds a user by their email address."""
        
        return Config.get_collection().find_one({"_id":ObjectId(id)})

    @staticmethod
    def find_by_user_id(user_id):
        """Every config this user owns."""
        return Config.get_collection().find({"user_id": user_id})

    @staticmethod
    def find_editable_by(user_id):
        """Every config this user may edit — owned, plus shared with them.

        What the professor's dashboard lists. Separate from `find_by_user_id`
        rather than replacing it because the two answer different questions, and
        the places that genuinely mean "mine" (usage counting, ownership transfer)
        must not silently start counting other people's classes.
        """
        from src.utils.config_access import editable_filter
        return Config.get_collection().find(editable_filter(user_id))

   

