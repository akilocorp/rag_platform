# @language  Python
# @updated   2026-07-27
# @changed   Per-case visibility: public cases are readable by anyone who can build a class, private ones
#            only by their author. Editing and deletion stay with the author either way.
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

**Visibility is per case.** A public case is readable by anyone who can build a
class — teaching material is worth sharing, and a colleague should not re-upload
and re-verify a case that already exists. A private one is visible only to whoever
saved it. `user_id` always governs editing and deletion, so a shared library can
never be clobbered: the worst anyone else can do with your case is use it.

New saves default to public because sharing is the point; the toggle sits beside
the name. Documents written before visibility existed have no field and are
treated as private, since that is the rule they were saved under.

Document schema::

    {
      "_id":                ObjectId,
      "user_id":            str,            # who saved it; may edit and delete
      "visibility":         str,            # "public" | "private"
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

VISIBILITY_PUBLIC = "public"
VISIBILITY_PRIVATE = "private"
VISIBILITIES = (VISIBILITY_PUBLIC, VISIBILITY_PRIVATE)

# Guard so the lookup indexes are only ensured once per process.
_INDEX_ENSURED = False


def normalize_visibility(value, default=VISIBILITY_PUBLIC):
    """Coerce an arbitrary value to a known visibility. Unknown input takes `default`."""
    v = (value or "").strip().lower()
    return v if v in VISIBILITIES else default


def _readable_by(user_id):
    """Mongo filter for "cases this user may read": anything public, plus their own."""
    return {"$or": [{"visibility": VISIBILITY_PUBLIC}, {"user_id": user_id}]}


class CasePreset:
    """Static-method gateway to the ``case_presets`` collection."""

    # Re-exposed on the class so routes need only import CasePreset.
    normalize_visibility = staticmethod(normalize_visibility)

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
            # Reads are "everything I may see, newest first"; user_id additionally
            # resolves who may edit or delete a given case.
            collection.create_index([("visibility", 1), ("updated_at", -1)])
            collection.create_index([("user_id", 1), ("updated_at", -1)])
            _INDEX_ENSURED = True
        return collection

    @staticmethod
    def create(doc):
        """Insert a case. Returns the stored document with its generated ``_id``."""
        now = datetime.utcnow()
        doc = dict(doc or {})
        doc["visibility"] = normalize_visibility(doc.get("visibility"))
        doc.setdefault("created_at", now)
        doc["updated_at"] = now
        result = CasePreset.get_collection().insert_one(doc)
        doc["_id"] = result.inserted_id
        return doc

    @staticmethod
    def find_readable(user_id):
        """Cursor of every case this user may read — public plus their own — newest first."""
        return (
            CasePreset.get_collection()
            .find(_readable_by(user_id))
            .sort("updated_at", -1)
        )

    @staticmethod
    def find_one_readable(preset_id, user_id):
        """One case, if this user may read it. ``None`` otherwise.

        Permission is part of the query rather than checked afterwards, so a bad
        id and a private case belonging to someone else fail identically — nothing
        distinguishes "does not exist" from "not yours".
        """
        try:
            oid = preset_id if isinstance(preset_id, ObjectId) else ObjectId(preset_id)
        except Exception:  # noqa: BLE001 — a malformed id is simply not found
            return None
        return CasePreset.get_collection().find_one({"_id": oid, **_readable_by(user_id)})

    @staticmethod
    def find_owned_by_name(name, user_id):
        """This user's own case of that name — the overwrite target on save.

        Scoped to the saver so two people may keep cases with the same name and
        neither can clobber the other's.
        """
        return CasePreset.get_collection().find_one({"user_id": user_id, "name": name})

    @staticmethod
    def set_visibility(preset_id, user_id, visibility):
        """Flip a case between public and private. Owner only; returns the UpdateResult."""
        try:
            oid = preset_id if isinstance(preset_id, ObjectId) else ObjectId(preset_id)
        except Exception:  # noqa: BLE001
            return None
        return CasePreset.get_collection().update_one(
            {"_id": oid, "user_id": user_id},
            {"$set": {"visibility": normalize_visibility(visibility), "updated_at": datetime.utcnow()}},
        )

    @staticmethod
    def replace_owned(preset_id, user_id, fields):
        """Overwrite a case's contents, keeping ``created_at``. Returns the UpdateResult.

        Ownership is part of the query, so editing someone else's case matches
        nothing rather than erroring.
        """
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
