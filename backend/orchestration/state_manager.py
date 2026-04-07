import time
from typing import List, Dict, Any

class StateManager:
    def __init__(self, db):
        self.db = db
        self.metadata_collection = self.db["chat_session_metadata"]
        self.history_collection = self.db["chat_histories"]

    def initialize_session_if_new(self, session_id: str, user_id: str, config_id: str):
        """Creates the metadata entry if this is the very first message."""
        if self.metadata_collection.count_documents({"session_id": session_id}, limit=1) == 0:
            self.metadata_collection.insert_one({
                "session_id": session_id,
                "user_id": user_id,
                "config_id": config_id,
                "timestamp": time.time()
            })

    def get_chat_history(self, session_id: str) -> List[Dict[str, Any]]:
        """
        Fetches history from MongoDB and formats it for the OpenAI API.
        """
        # Assuming you store documents with {"SessionId": session_id, "role": "...", "content": "..."}
        cursor = self.history_collection.find({"SessionId": session_id}).sort("_id", 1)
        
        history = []
        for doc in cursor:
            # Reconstruct the message exactly how OpenAI expects it
            msg = {
                "role": doc.get("role"),
                "content": doc.get("content")
            }
            # If the document contains tool calls or tool results, include them
            if "tool_calls" in doc:
                msg["tool_calls"] = doc["tool_calls"]
            if "tool_call_id" in doc:
                msg["tool_call_id"] = doc["tool_call_id"]
            if "name" in doc:
                msg["name"] = doc["name"]
                
            history.append(msg)
            
        return history

    def save_messages(self, session_id: str, new_messages: List[Dict[str, Any]]):
        """
        Saves the newly generated messages (user input, tool calls, assistant text) to MongoDB.
        """
        if not new_messages:
            return
            
        docs_to_insert = []
        for msg in new_messages:
            doc = msg.copy()
            doc["SessionId"] = session_id
            doc["timestamp"] = time.time()
            docs_to_insert.append(doc)
            
        self.history_collection.insert_many(docs_to_insert)

    def get_chat_list(self, user_id: str, config_id: str) -> list:
        """Fetches the list of chat sessions for the sidebar."""
        pipeline = [
            {'$match': {'$or': [{'user_id': user_id}, {'user_id': "anonymous"}], 'config_id': config_id}},
            {'$sort': {'_id': -1}},
            {'$lookup': {
                'from': 'chat_histories',
                'let': {'session_id_str': '$session_id'},
                'pipeline': [
                    {'$match': {'$expr': {'$eq': ['$SessionId', '$$session_id_str']}}},
                    {'$sort': {'_id': 1}},
                    {'$limit': 1},
                    {'$project': {'content': 1, '_id': 0}}
                ],
                'as': 'first_message_info'
            }},
            {'$project': {
                'session_id': '$session_id', 'user_id': '$user_id',
                'timestamp': {'$dateToString': {'format': '%Y-%m-%dT%H:%M:%S.%LZ', 'date': '$_id'}},
                'first_message': {'$arrayElemAt': ['$first_message_info.content', 0]}
            }}
        ]
        
        sessions = list(self.metadata_collection.aggregate(pipeline))
        for session in sessions:
            if session.get('user_id') == 'anonymous':
                self.metadata_collection.update_one({"_id": session["_id"]}, {"$set": {"user_id": user_id}})
                
        return [{
            'session_id': s['session_id'],
            'title': (s.get('first_message') or "New Chat")[:100],
            'timestamp': s['timestamp']
        } for s in sessions]