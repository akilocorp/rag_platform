from flask import current_app
import pymongo
from bson import ObjectId
from datetime import datetime


class ExperientialSession:
    """Stores a student's completed experiential-lab run for later review."""

    @staticmethod
    def get_collection():
        client = pymongo.MongoClient(current_app.config["MONGO_URI"], serverSelectionTimeoutMS=5000)
        db = client[current_app.config["MONGO_DB_NAME"]]
        return db["experiential_sessions"]

    @staticmethod
    def create(doc):
        doc["created_at"] = datetime.utcnow()
        return ExperientialSession.get_collection().insert_one(doc)

    @staticmethod
    def find_by_user(user_id):
        return ExperientialSession.get_collection().find({"user_id": user_id}).sort("created_at", -1)

    @staticmethod
    def find_by_config(config_id):
        return ExperientialSession.get_collection().find({"config_id": config_id}).sort("created_at", -1)

    @staticmethod
    def find_by_id(sid):
        return ExperientialSession.get_collection().find_one({"_id": ObjectId(sid)})

    @staticmethod
    def update_by_id(sid, fields):
        fields["updated_at"] = datetime.utcnow()
        return ExperientialSession.get_collection().update_one({"_id": ObjectId(sid)}, {"$set": fields})
