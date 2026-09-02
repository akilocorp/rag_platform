# @language  Python
# @updated   2026-09-02
# @changed   One-off: repair the "What About Bob" config doc that create_bob_investigation.py
#            wrote with form-shaped strings instead of real types.
"""Rewrites the string-typed fields on the What About Bob config.

The creation script inserted straight into Mongo, skipping the save route that turns
the wizard's form strings into real values. So `documents` landed as the STRING "[]",
which is truthy and has a .length but no .map — EditConfigPage crashed on
`config.documents.map is not a function`. Same for `bots`, and the "False" strings
are truthy in JS, so the web/audio/Qualtrics toggles read as ON.

Idempotent. Run once against the account that owns the config.
"""
import os
import sys

from bson import ObjectId

from create_bob_investigation import connect

CONFIG_ID = "6a954936486ab4fd5f8fee90"

# The value each field should have had. Types matter more than the values — these
# are the same defaults the creation script meant to write.
FIX = {
    "documents": [],
    "bots": [],
    "is_public": True,
    "web_access": False,
    "qualtrics_enabled": False,
    "audio_enabled": False,
    "temperature": 0.7,
    "response_timeout": 3,
    "group_duration": 20,
}


def main():
    client = connect()
    configs = client[os.getenv("MONGO_DB_NAME")]["config_collections"]
    doc = configs.find_one({"_id": ObjectId(CONFIG_ID)})
    if not doc:
        print(f"No config {CONFIG_ID}.")
        client.close()
        return 1

    print(f"'{doc.get('bot_name')}'  ({CONFIG_ID})")
    for k, want in FIX.items():
        have = doc.get(k)
        mark = "ok " if type(have) is type(want) else "FIX"
        print(f"  {mark} {k:<20} {type(have).__name__:<6} {have!r}")

    configs.update_one({"_id": doc["_id"]}, {"$set": FIX})
    print("\nUpdated.")
    client.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
