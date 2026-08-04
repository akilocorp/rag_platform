# @language  Python
# @updated   2026-08-04
# @changed   M9 three-round rework: added `solo_ballot` (the private round-0 picks) to the skeleton and
#            the schema; dropped the grading and strike keys along with the machine that wrote them.
# @changed   Prior: reshaped for the facilitated rework — dropped seats, added roster, chosen_candidate,
#            and the facilitator turn-taking fields.
"""Durable persistence for the Manager Exercise hidden-profile debrief.

One Mongo document per matched room lives in the ``manager_exercise_sessions``
collection. It is the *authoritative* state: the in-process ``ExerciseState``
registry (``src/managers/exercise_state.py``) writes every phase transition,
ballot entry, and turn-taking counter through this model BEFORE emitting the
corresponding socket event, and rebuilds itself from :meth:`find_by_room` on
reconnect / restart. In-memory-only state is not acceptable.

Mongo access mirrors ``backend/models/experiential_session.py`` exactly:
``pymongo.MongoClient(current_app.config["MONGO_URI"])`` →
``db[current_app.config["MONGO_DB_NAME"]]["manager_exercise_sessions"]``.

Document schema — keys written by the helpers below::

    {
      "_id":                  ObjectId,
      "room_id":              str,          # PRIMARY natural key; unique index
      "config_id":            str,          # parsed from room_id
      "phase":                str,          # waiting|solo|discuss|choose|kiosk|debrief|done
      "phase_deadline_ts":    float|None,   # epoch seconds; timed phases only
      "roster":               [{uid, name, role}],
      "solo_ballot":          {"open": bool, "votes": {uid: str}},   # round 0, private
      "collective_ballot":    {"open": bool, "votes": {uid: str}},   # round 1, the group's
      "continue_acks":        [uid],        # who has passed the kiosk gate
      "chosen_candidate":     str|None,     # the group's pick
      "forecast_shown_for":   str|None,     # whose outcome doc has been revealed
      "pending_go_around":    {asked_at, expected: [uid], received: [uid]}|None,
      "last_facilitator_at":  float|None,
      "msgs_since_facilitator": int,
      "last_message_ts":      float|None,
      "created_at":           datetime,
      "updated_at":           datetime,
    }

The last four fields are the facilitator's turn-taking gates. They are persisted
rather than kept in memory so a mid-session restart cannot make ACTR forget it is
waiting on a go-around and start replying to students one at a time.

`solo_ballot` holds each student's PRIVATE round-0 pick — what they believed before
the group could move them. It is the one thing in this document that must never be
served to a client as a tally; `ExerciseState.solo_spread` exposes anonymous counts
and nothing else. Students are never scored here: there is no grading anywhere in
this feature.
"""

from datetime import datetime

import pymongo
from bson import ObjectId
from flask import current_app

COLLECTION_NAME = "manager_exercise_sessions"

# Guard so the unique index on room_id is only ensured once per process.
_INDEX_ENSURED = False


class ManagerExerciseSession:
    """Static-method gateway to the ``manager_exercise_sessions`` collection.

    Every method opens the collection through :meth:`get_collection` so callers
    never hold a stale client across a Flask app-context boundary — the same
    contract the sibling ``ExperientialSession`` model follows.
    """

    # ------------------------------------------------------------------ #
    # Collection / index plumbing
    # ------------------------------------------------------------------ #
    @staticmethod
    def get_collection():
        """Return the pymongo collection, ensuring the indexes once per process.

        The index creation is lazy and flag-guarded so we do not pay the
        ``create_index`` round-trip on every call.
        """
        global _INDEX_ENSURED
        client = pymongo.MongoClient(
            current_app.config["MONGO_URI"], serverSelectionTimeoutMS=5000
        )
        db = client[current_app.config["MONGO_DB_NAME"]]
        collection = db[COLLECTION_NAME]
        if not _INDEX_ENSURED:
            # room_id is the primary natural key; one session per room.
            collection.create_index("room_id", unique=True)
            # Faculty results are queried by config_id, newest first.
            collection.create_index("config_id")
            _INDEX_ENSURED = True
        return collection

    # ------------------------------------------------------------------ #
    # Lifecycle: create / find
    # ------------------------------------------------------------------ #
    @staticmethod
    def create(room_id, config_id):
        """Insert the initial session doc for a freshly formed room.

        Builds a full skeleton at ``phase="waiting"`` with empty containers so
        downstream ``$set`` mutations never touch a missing path. Idempotent: an
        existing doc for ``room_id`` (e.g. a replayed match event) is returned
        untouched rather than duplicated.

        Returns:
            The stored document (dict).
        """
        collection = ManagerExerciseSession.get_collection()

        existing = collection.find_one({"room_id": room_id})
        if existing is not None:
            return existing

        now = datetime.utcnow()
        doc = {
            "room_id": room_id,
            "config_id": config_id,
            "phase": "waiting",
            "phase_deadline_ts": None,
            "roster": [],
            "solo_ballot": {"open": False, "votes": {}},
            "collective_ballot": {"open": False, "votes": {}},
            "continue_acks": [],
            "chosen_candidate": None,
            "forecast_shown_for": None,
            "pending_go_around": None,
            "last_facilitator_at": None,
            "msgs_since_facilitator": 0,
            "last_message_ts": None,
            "created_at": now,
            "updated_at": now,
        }
        collection.insert_one(doc)
        return doc

    @staticmethod
    def find_by_room(room_id):
        """Return the session doc for a room, or ``None``.

        This is the rebuild entry point: ``ExerciseState`` calls it on cold access
        after a restart to reconstruct phase, ballot, pick, and turn-taking state.
        """
        return ManagerExerciseSession.get_collection().find_one({"room_id": room_id})

    @staticmethod
    def find_by_config(config_id):
        """Return a cursor of sessions for a config, newest first (faculty results)."""
        return (
            ManagerExerciseSession.get_collection()
            .find({"config_id": config_id})
            .sort("created_at", -1)
        )

    # ------------------------------------------------------------------ #
    # Generic mutation
    # ------------------------------------------------------------------ #
    @staticmethod
    def upsert(room_id, fields):
        """``$set`` arbitrary ``fields`` on the room's doc, always bumping ``updated_at``.

        Upserts on ``room_id`` so a persist that races ahead of :meth:`create`
        still lands. This is the primitive ``ExerciseState`` writes every
        transition through.

        Returns:
            The pymongo ``UpdateResult``.
        """
        payload = dict(fields or {})
        payload["updated_at"] = datetime.utcnow()
        return ManagerExerciseSession.get_collection().update_one(
            {"room_id": room_id}, {"$set": payload}, upsert=True
        )

    # ------------------------------------------------------------------ #
    # Targeted transition helpers
    # ------------------------------------------------------------------ #
    @staticmethod
    def set_phase(room_id, phase, phase_deadline_ts=None):
        """Persist a phase transition: ``phase`` + its ``phase_deadline_ts``.

        Always writes both together so the deadline can never lag the phase. Pass
        ``phase_deadline_ts=None`` for the untimed phases (waiting/solo/kiosk/done).
        """
        return ManagerExerciseSession.upsert(
            room_id, {"phase": phase, "phase_deadline_ts": phase_deadline_ts}
        )

    @staticmethod
    def record_collective_vote(room_id, uid, candidate):
        """Record one student's ballot entry.

        Dotted ``$set`` so concurrent entries from different students never clobber
        each other.
        """
        return ManagerExerciseSession.get_collection().update_one(
            {"room_id": room_id},
            {
                "$set": {
                    f"collective_ballot.votes.{uid}": candidate,
                    "updated_at": datetime.utcnow(),
                }
            },
            upsert=True,
        )

    @staticmethod
    def set_chosen_candidate(room_id, candidate):
        """Finalize the group's pick and close the ballot in a single persist.

        Written together so a rebuilt state never sees a resolved pick alongside a
        ballot still marked open.
        """
        return ManagerExerciseSession.upsert(
            room_id,
            {"chosen_candidate": candidate, "collective_ballot.open": False},
        )

    # ------------------------------------------------------------------ #
    # Misc convenience
    # ------------------------------------------------------------------ #
    @staticmethod
    def find_by_id(sid):
        """Return a session by its Mongo ``_id`` (accepts str or ObjectId)."""
        oid = sid if isinstance(sid, ObjectId) else ObjectId(sid)
        return ManagerExerciseSession.get_collection().find_one({"_id": oid})

    @staticmethod
    def delete_by_room(room_id):
        """Delete a room's session (test/cleanup helper). Returns the DeleteResult."""
        return ManagerExerciseSession.get_collection().delete_one({"room_id": room_id})
