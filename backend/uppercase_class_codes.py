"""One-off: uppercase all existing class codes.

Run once after deploy:  python uppercase_class_codes.py

Class codes switched from lowercase to uppercase A-Z/0-9 (see config_routes.py
validate_class_usage). The app now stores and looks up codes uppercased, but
codes already in the database are still lowercase, so old join links and
existing student enrollments would miss until the stored data is converted.

This migrates the two places a code string is stored:
  - config_collections.class_code  (the bot configs)
  - <users>.classes[]              (each student's enrolled-code list)

The usage counters are keyed by config _id, not the code string, so they need
no change. Idempotent — uppercasing an already-uppercase code is a no-op, so
this is safe to re-run.
"""
from src.utils.config import load_secrets
from src.backend.database.mongo_utils import get_mongo_db_connection

if __name__ == "__main__":
    secrets = load_secrets()
    _client, db, _ = get_mongo_db_connection(
        mongo_uri=secrets["MONGO_URI"],
        db_name=secrets["MONGO_DB_NAME"],
        collection_name=secrets["USER"],
    )

    # 1. config_collections.class_code -> uppercase
    cfg = db[secrets["CONFIG"]].update_many(
        {"class_code": {"$type": "string", "$ne": ""}},
        [{"$set": {"class_code": {"$toUpper": "$class_code"}}}],
    )
    print(f"config_collections: matched {cfg.matched_count}, modified {cfg.modified_count}")

    # 2. <users>.classes[] -> uppercase every entry
    usr = db[secrets["USER"]].update_many(
        {"classes": {"$exists": True, "$ne": []}},
        [{"$set": {"classes": {
            "$map": {"input": "$classes", "as": "c", "in": {"$toUpper": "$$c"}}
        }}}],
    )
    print(f"users: matched {usr.matched_count}, modified {usr.modified_count}")

    print("Done.")
