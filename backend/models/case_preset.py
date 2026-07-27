# @language  Python
# @updated   2026-07-27
# @changed   New: saved case presets so an analysed, professor-reviewed case can be reused across classes.
"""Reusable manager-exercise cases.

Authoring a case is the expensive part: upload the candidate summary, upload an
outcome document per candidate, run the analysis, then read the derived tally and
answer key carefully enough to trust them. None of that changes when the same
case is run with a different cohort — only the group size, the number of breakout
rooms, and the class code do.

A preset stores everything reusable, **including the reviewed `case_pack`**, so a
second class costs one dropdown instead of a re-upload and a re-analysis. That
matters beyond convenience: re-analysing re-derives the answer key, and a
professor who has already checked and corrected one should not have to check it
again.

Presets are private to the professor who saved them (`user_id`), the same
ownership model `Config` uses.

Document schema::

    {
      "_id":                ObjectId,
      "user_id":            str,
      "name":               str,            # what the professor calls this case
      "candidate_summary":  {file_id, text},
      "candidates":         [{name, forecast_text, forecast_file_id}],
      "case_pack":          {...},          # reviewed; AI-only
      "class_preset":       str,            # learning-point preset key
      "learning_outcome":   str,
      "created_at":         datetime,
      "updated_at":         datetime,
    }
"""

from datetime import datetime

import pymongo
from bson import ObjectId
from flask import current_app

COLLECTION_NAME = "case_presets"

# Guard so the lookup index is only ensured once per process.
_INDEX_ENSURED = False


class CasePreset:
    """Static-method gateway to the ``case_presets`` collection."""

    @staticmethod
    def get_collection():
        """Return the pymongo collection, ensuring the owner index once per process."""
        global _INDEX_ENSURED
        client = pymongo.MongoClient(
            current_app.config["MONGO_URI"], serverSelectionTimeoutMS=5000
        )
        db = client[current_app.config["MONGO_DB_NAME"]]
        collection = db[COLLECTION_NAME]
        if not _INDEX_ENSURED:
            # Every read is "my presets, newest first".
            collection.create_index([("user_id", 1), ("updated_at", -1)])
            _INDEX_ENSURED = True
        return collection

    @staticmethod
    def create(doc):
        """Insert a preset. Returns the stored document with its generated ``_id``."""
        now = datetime.utcnow()
        doc = dict(doc or {})
        doc.setdefault("created_at", now)
        doc["updated_at"] = now
        result = CasePreset.get_collection().insert_one(doc)
        doc["_id"] = result.inserted_id
        return doc

    @staticmethod
    def find_by_user(user_id):
        """Cursor of a professor's presets, newest first."""
        return (
            CasePreset.get_collection()
            .find({"user_id": user_id})
            .sort("updated_at", -1)
        )

    @staticmethod
    def find_owned(preset_id, user_id):
        """One preset, but only if this professor owns it. ``None`` otherwise.

        Ownership is part of the query rather than checked afterwards, so a wrong
        id and someone else's id fail identically.
        """
        try:
            oid = preset_id if isinstance(preset_id, ObjectId) else ObjectId(preset_id)
        except Exception:  # noqa: BLE001 — a malformed id is simply not found
            return None
        return CasePreset.get_collection().find_one({"_id": oid, "user_id": user_id})

    @staticmethod
    def replace_owned(preset_id, user_id, fields):
        """Overwrite a preset's contents, keeping ``created_at``. Returns the UpdateResult."""
        try:
            oid = preset_id if isinstance(preset_id, ObjectId) else ObjectId(preset_id)
        except Exception:  # noqa: BLE001
            return None
        payload = dict(fields or {})
        payload["updated_at"] = datetime.utcnow()
        return CasePreset.get_collection().update_one(
            {"_id": oid, "user_id": user_id}, {"$set": payload}
        )

    @staticmethod
    def delete_owned(preset_id, user_id):
        """Delete a preset this professor owns. Returns the DeleteResult."""
        try:
            oid = preset_id if isinstance(preset_id, ObjectId) else ObjectId(preset_id)
        except Exception:  # noqa: BLE001
            return None
        return CasePreset.get_collection().delete_one({"_id": oid, "user_id": user_id})
