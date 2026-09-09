# @language  Python
# @updated   2026-09-08
# @changed   New file: Mongo-backed tester templates for the manager-exercise test-run simulator.
"""Durable storage for the simulated test-room students' prompts, keyed by exercise template.

WHY THIS EXISTS
    `exercise_sim.py` used to hardcode every sim-student prompt (system prompt,
    per-round tasks, the misleading seat's override) as Python string constants
    written for the hiring template. Testing an `investigation` case with those
    still told the model "you're in a hiring exercise, agree on who to hire" —
    wrong premise, wrong vocabulary, for a murder file.

    Moving the wording into Mongo means a new exercise template's tester
    behaviour is a document insert, not a code change and a deploy — the same
    reason `case_presets` / `class_presets` live in Mongo rather than in Python.

    One document per exercise template. `template_id` matches
    `manager_exercise.template` / `exercise_templates.py`'s ids ("hiring",
    "investigation", ...). `src/managers/tester_templates.py:get()` is the read
    path every caller actually uses — it falls back to the hiring wording every
    template used before this system existed when Mongo has no row (or is
    unreachable) for a template id, so a test run never breaks because a
    document is missing or a query fails.

Mongo access mirrors `backend/src/models/manager_exercise_session.py`:
`pymongo.MongoClient(current_app.config["MONGO_URI"])` -> `db[MONGO_DB_NAME][COLLECTION_NAME]`.

Document schema::

    {
      "_id":            ObjectId,
      "template_id":    str,   # PRIMARY natural key; unique index. e.g. "hiring", "investigation"
      "label":          str,   # human-readable, for an admin listing
      "student_system": str,   # base system prompt; {name}/{others}/{role}/{premise}/{packet}
      "recall_behaviour":       str,  # appended when the seat's packet is a case document
      "misleading_behaviour":   str,  # appended for the one seat that invents facts
      "discuss_task":           str,  # round-1 per-turn instruction
      "misleading_discuss_task": str, # round-1 instruction for the misleading seat
      "debrief_task":           str,  # round-2 per-turn instruction
      "misleading_debrief_task": str, # round-2 instruction for the misleading seat
      "pick_task":              str,  # round-0 private-pick instruction; {options}
      "decision_task":          str,  # the decider's final-answer instruction; {options}
      "created_at":     datetime,
      "updated_at":     datetime,
    }
"""
from datetime import datetime

import pymongo
from flask import current_app

COLLECTION_NAME = "sim_tester_templates"

# Guard so the unique index on template_id is only ensured once per process.
_INDEX_ENSURED = False


class SimTesterTemplate:
    """Static-method gateway to the ``sim_tester_templates`` collection."""

    @staticmethod
    def get_collection():
        """Return the pymongo collection, ensuring the index once per process."""
        global _INDEX_ENSURED
        client = pymongo.MongoClient(
            current_app.config["MONGO_URI"], serverSelectionTimeoutMS=5000
        )
        db = client[current_app.config["MONGO_DB_NAME"]]
        collection = db[COLLECTION_NAME]
        if not _INDEX_ENSURED:
            collection.create_index("template_id", unique=True)
            _INDEX_ENSURED = True
        return collection

    @staticmethod
    def find_by_template_id(template_id):
        """The tester-template doc for one exercise template, or ``None``."""
        return SimTesterTemplate.get_collection().find_one({"template_id": template_id})

    @staticmethod
    def list_all():
        """Every tester template, alphabetical by id — for an admin/seed listing."""
        return list(SimTesterTemplate.get_collection().find().sort("template_id", 1))

    @staticmethod
    def upsert(template_id, fields):
        """Insert or replace one template's fields. Idempotent on ``template_id``.

        `fields` should NOT include `template_id` (set explicitly here) or
        `created_at` (preserved on an update, set fresh on first insert).
        """
        now = datetime.utcnow()
        doc = dict(fields)
        doc.pop("template_id", None)
        doc.pop("created_at", None)
        doc["updated_at"] = now
        collection = SimTesterTemplate.get_collection()
        collection.update_one(
            {"template_id": template_id},
            {"$set": doc, "$setOnInsert": {"template_id": template_id, "created_at": now}},
            upsert=True,
        )
        return collection.find_one({"template_id": template_id})
