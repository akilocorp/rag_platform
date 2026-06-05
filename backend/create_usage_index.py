"""One-off: create the unique index for usage_counters.

Run once after deploy:  python create_usage_index.py

The unique {scope, key} index makes the atomic upsert in src/usage/limits.py
race-safe (prevents duplicate counter docs for the same metered entity under
concurrent requests). The app works without it, but you may see rare duplicate
counters under high concurrency until it's in place. Idempotent — safe to re-run.
"""
from pymongo import ASCENDING

from src.utils.config import load_secrets
from src.backend.database.mongo_utils import get_mongo_db_connection

if __name__ == "__main__":
    secrets = load_secrets()
    _client, db, _ = get_mongo_db_connection(
        mongo_uri=secrets["MONGO_URI"],
        db_name=secrets["MONGO_DB_NAME"],
        collection_name=secrets["USER"],
    )
    name = db["usage_counters"].create_index(
        [("scope", ASCENDING), ("key", ASCENDING)],
        unique=True,
        name="scope_key_unique",
    )
    print(f"Created index '{name}' on usage_counters")
