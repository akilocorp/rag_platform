import pymongo
import json
from bson.json_util import dumps

# --- CONFIGURATION ---
# PASTE YOUR CONNECTION STRING BELOW (Keep the quotes!)
# Replace <password> with your actual database password
MONGO_URI="mongodb+srv://hkustmgmt:hkust@cluster0.hjzehx.mongodb.net/?appName=Cluster0"


# Database and Collection names from your screenshot
DB_NAME = "survey"
COLLECTION_NAME = "message_store"
OUTPUT_FILE = "negotiation_logs.json"

def export_from_mongo():
    print("Connecting to MongoDB...")
    try:
        client = pymongo.MongoClient(MONGO_URI)
        db = client[DB_NAME]
        collection = db[COLLECTION_NAME]
        
        # Check if connected by counting documents
        count = collection.count_documents({})
        print(f"Found {count} documents in {DB_NAME}.{COLLECTION_NAME}")

        if count == 0:
            print("Warning: Collection appears empty or check your permissions.")
            return

        print("Exporting data...")
        # Fetch all documents
        cursor = collection.find({})
        
        # strict=False allows exporting ObjectIds and Dates safely
        with open(OUTPUT_FILE, "w", encoding="utf-8") as f:
            f.write(dumps(cursor, indent=2))
            
        print(f"✅ Success! Data saved to '{OUTPUT_FILE}'")
        print("👉 Please upload this file to the chat.")

    except Exception as e:
        print(f"❌ Error: {e}")

if __name__ == "__main__":
    export_from_mongo()