# @language  Python
# @updated   2026-07-20
# @changed   Initial durable persistence model for the manager_exercise_sessions collection.
"""Durable persistence for the Manager Exercise hidden-profile game.

One Mongo document per matched room lives in the ``manager_exercise_sessions``
collection. It is the *authoritative* state: the in-process ``ExerciseState``
registry (``src/managers/exercise_state.py``) writes every phase transition,
vote, and grade through this model BEFORE emitting the corresponding socket
event, and rebuilds itself from :meth:`find_by_room` on reconnect / restart.
In-memory-only state is not acceptable (contract §2, §10.2).

Mongo access mirrors ``backend/models/experiential_session.py`` exactly:
``pymongo.MongoClient(current_app.config["MONGO_URI"])`` →
``db[current_app.config["MONGO_DB_NAME"]]["manager_exercise_sessions"]``.

Document schema (contract §2) — keys written by the helpers below::

    {
      "_id":                ObjectId,
      "room_id":            str,          # PRIMARY natural key; unique index
      "config_id":          str,          # parsed from room_id
      "phase":              str,          # waiting|memorize|discuss|decide|grading|done
      "phase_deadline_ts":  float|None,   # epoch seconds; timed phases only
      "seat_assignment":    {uid: int},   # human uid -> seat index (0..N-1)
      "ai_seats":           [int, ...],   # AI-filled seat indices
      "individual_votes":   {uid: str},   # per-seat pick; uid or "ai:<idx>"
      "collective_ballot":  {"open": bool, "votes": {uid: str}},
      "collective_vote":    str|None,     # finalized group pick
      "grades":             {uid: {...}}, # per-participant grades
      "created_at":         datetime,
      "updated_at":         datetime,
      "no_show_deadline_ts": float|None,  # epoch seconds; AI-fill fires
    }

The AI-seat participant key convention is the string ``"ai:<seatIdx>"`` (e.g.
``"ai:2"``), used as a key in ``individual_votes`` / ``collective_ballot.votes``
and as the chat ``sender`` for AI managers (contract §2 notes).
"""

from datetime import datetime

import pymongo
from bson import ObjectId
from flask import current_app

# Collection name is fixed by the contract (§2).
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
        """Return the pymongo collection, ensuring the unique ``room_id`` index once.

        Uses ``MONGO_URI`` / ``MONGO_DB_NAME`` from ``current_app.config`` to
        match ``models/experiential_session.py``. The index is created lazily
        (per contract §6e) and guarded by a module flag so we do not pay the
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
    def create(room_id, config_id, seat_assignment, ai_seats):
        """Insert (or reset) the initial session doc for a freshly formed room.

        Builds a full skeleton at ``phase="waiting"`` with empty vote / grade
        containers so downstream ``$set`` mutations never touch a missing path.
        Idempotent by design: if a doc for ``room_id`` already exists (e.g. a
        replayed match event), the existing doc is returned untouched rather
        than duplicating — the unique index would reject a second insert anyway.

        Args:
            room_id: ``"{config_id}_{8hex}"`` — the primary key.
            config_id: parsed config id (stored explicitly for cheap querying).
            seat_assignment: ``{uid: seat_index}`` for human seats.
            ai_seats: list of seat indices filled by AI managers.

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
            "seat_assignment": dict(seat_assignment or {}),
            "ai_seats": list(ai_seats or []),
            "individual_votes": {},
            "collective_ballot": {"open": False, "votes": {}},
            "collective_vote": None,
            "grades": {},
            "created_at": now,
            "updated_at": now,
            "no_show_deadline_ts": None,
        }
        collection.insert_one(doc)
        return doc

    @staticmethod
    def find_by_room(room_id):
        """Return the session doc for a room, or ``None``.

        This is the rebuild entry point: ``ExerciseState`` calls it on cold
        access after a restart to reconstruct phase, deadlines, seats, and votes.
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
        (should not happen, but is cheap to tolerate) still lands. This is the
        low-level primitive every targeted mutator below funnels through, and
        the one ``ExerciseState`` may call directly for compound transitions.

        Returns:
            The pymongo ``UpdateResult``.
        """
        payload = dict(fields or {})
        payload["updated_at"] = datetime.utcnow()
        return ManagerExerciseSession.get_collection().update_one(
            {"room_id": room_id}, {"$set": payload}, upsert=True
        )

    # ------------------------------------------------------------------ #
    # Targeted transition helpers (the clean per-transition API)
    # ------------------------------------------------------------------ #
    @staticmethod
    def set_phase(room_id, phase, phase_deadline_ts=None):
        """Persist a phase transition: ``phase`` + its ``phase_deadline_ts``.

        Always writes both fields together so the deadline can never lag the
        phase (contract §10.2 requires persist-before-emit). Pass
        ``phase_deadline_ts=None`` for untimed phases (waiting/decide/grading/done).
        """
        return ManagerExerciseSession.upsert(
            room_id, {"phase": phase, "phase_deadline_ts": phase_deadline_ts}
        )

    @staticmethod
    def set_no_show_deadline(room_id, deadline_ts):
        """Persist the epoch second at which the waiting-phase AI-fill should fire."""
        return ManagerExerciseSession.upsert(
            room_id, {"no_show_deadline_ts": deadline_ts}
        )

    @staticmethod
    def set_seats(room_id, seat_assignment, ai_seats):
        """Overwrite the seat maps (human ``seat_assignment`` + ``ai_seats``).

        Called after no-show AI-fill mutates who occupies which seat, so the
        rebuilt state and the AI participant keys stay consistent.
        """
        return ManagerExerciseSession.upsert(
            room_id,
            {
                "seat_assignment": dict(seat_assignment or {}),
                "ai_seats": list(ai_seats or []),
            },
        )

    @staticmethod
    def record_individual_vote(room_id, participant_key, candidate):
        """Record one participant's individual best-fit pick.

        ``participant_key`` is a human ``uid`` or an ``"ai:<seatIdx>"`` string.
        Uses a dotted ``$set`` so concurrent votes from different participants
        never clobber each other's entry (contract §10.4: AI seats are full
        members with their own vote entry).
        """
        return ManagerExerciseSession.get_collection().update_one(
            {"room_id": room_id},
            {
                "$set": {
                    f"individual_votes.{participant_key}": candidate,
                    "updated_at": datetime.utcnow(),
                }
            },
            upsert=True,
        )

    @staticmethod
    def set_collective_ballot_open(room_id, is_open):
        """Toggle the SEPARATE collective ballot open/closed (contract decision #2)."""
        return ManagerExerciseSession.upsert(
            room_id, {"collective_ballot.open": bool(is_open)}
        )

    @staticmethod
    def record_collective_vote(room_id, participant_key, candidate):
        """Record one participant's vote in the explicit collective group ballot.

        Dotted ``$set`` on ``collective_ballot.votes.<key>`` for the same
        concurrency-safety reason as :meth:`record_individual_vote`.
        """
        return ManagerExerciseSession.get_collection().update_one(
            {"room_id": room_id},
            {
                "$set": {
                    f"collective_ballot.votes.{participant_key}": candidate,
                    "updated_at": datetime.utcnow(),
                }
            },
            upsert=True,
        )

    @staticmethod
    def set_collective_vote(room_id, candidate):
        """Finalize the group pick and close the ballot in a single persist.

        Writing ``collective_vote`` and flipping ``collective_ballot.open`` to
        ``False`` together guarantees a rebuilt state never sees a resolved pick
        with the ballot still marked open.
        """
        return ManagerExerciseSession.upsert(
            room_id,
            {"collective_vote": candidate, "collective_ballot.open": False},
        )

    @staticmethod
    def set_grades(room_id, grades):
        """Persist the full per-participant grades map (contract §2 grades schema)."""
        return ManagerExerciseSession.upsert(room_id, {"grades": dict(grades or {})})

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
