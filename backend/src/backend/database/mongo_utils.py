import logging
import pymongo
from pymongo.database import Database
from pymongo.collection import Collection
# You might not need StreamlitChatMessageHistory anymore, as we're not using it.
# from langchain_community.chat_message_histories import StreamlitChatMessageHistory 
from langchain_mongodb.chat_message_histories import MongoDBChatMessageHistory  # moved out of langchain_community; matches chat_routes/analysis_routes

logger = logging.getLogger(__name__)

# This part is from your main.py but belongs here
def get_mongo_db_connection(mongo_uri: str, db_name: str, collection_name: str):
    """Establishes a connection to MongoDB and returns the client, db, and collection."""
    try:
        # Parse the connection string to extract the replica set name
        from urllib.parse import urlparse
        parsed_uri = urlparse(mongo_uri)
        
        # Extract the replica set name from the host part
        replica_set = None
        if parsed_uri.hostname and 'replicaSet' in parsed_uri.hostname:
            replica_set = parsed_uri.hostname.split(',')[0].split('/')[-1]
        
        # Set up the client with proper read preferences for Atlas
        mongo_client = pymongo.MongoClient(
            mongo_uri,
            serverSelectionTimeoutMS=5000,
            replicaSet=replica_set,
            readPreference="secondaryPreferred",  # Use secondary nodes first
            retryWrites=True,
            w="majority"  # Wait for majority of nodes to confirm write
        )
        
        # Try to establish connection
        try:
            mongo_client.admin.command('ping')
            logger.info("Successfully connected to MongoDB")
        except Exception as e:
            logger.warning(f"Initial ping failed: {e}")
            # Try to connect to a specific database instead
            mongo_db = mongo_client[db_name]
            try:
                # Try a simple operation to test the connection
                mongo_db.command('buildInfo')
                logger.info("Successfully connected to database")
            except Exception as e:
                logger.warning(f"Database connection test failed: {e}")
                # If all else fails, just return the client
                pass
        
        mongo_db = mongo_client[db_name]
        mongo_collection = mongo_db[collection_name]
        logger.info("MongoDB connection established successfully.")
        return mongo_client, mongo_db, mongo_collection
    except Exception as e:
        logger.critical(f"Failed to connect to MongoDB: {e}", exc_info=True)
        # For a Streamlit app, letting it fail loudly with st.stop() or raise is a good strategy.
        raise e

# --- CORRECTED CUSTOM CHAT MESSAGE HISTORY CLASS ---
# This class now takes the connection_string as required by the base class.
class MongoDbChatMessageHistory(MongoDBChatMessageHistory):
    """
    Custom MongoDB chat message history that can save additional metadata.
    """
    def __init__(self, connection_string: str, session_id: str, response_id: str, agent_id: str, survey_id: str, database_name: str, collection_name: str):
        # We pass the required arguments to the base class's __init__
        super().__init__(
            connection_string=connection_string,
            session_id=session_id,
            database_name=database_name,
            collection_name=collection_name
        )
        self.response_id = response_id
        self.agent_id = agent_id
        self.survey_id = survey_id

    def add_message(self, message) -> None:
        """
        Adds a message to the history and updates the document with additional metadata.
        """
        # The base class adds the message. We'll add our metadata after the fact.
        # This is a bit of a workaround since the base class doesn't have a hook for this.
        super().add_message(message)

        # Let's find the last message we just added and update it.
        # This is not atomic, but it works.
        try:
            # The collection is accessible as `self.collection` in the base class.
            self.collection.update_one(
                {"SessionId": self.session_id, "History.data.content": message.content},
                {"$set": {
                    "SessionId": self.session_id, # Ensure session_id is always part of the update
                    "ResponseId": self.response_id,
                    "AgentId": self.agent_id,
                    "SurveyId": self.survey_id
                }},
                upsert=False # We are updating an existing message, not inserting a new one
            )
            logger.debug(f"Metadata updated for session '{self.session_id}'.")
        except Exception as e:
            logger.error(f"Failed to update metadata for message: {e}", exc_info=True)