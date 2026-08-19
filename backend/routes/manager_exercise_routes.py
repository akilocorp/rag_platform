# @language  Python
# @updated   2026-08-19
# @changed   POST /test-run takes `misleading`, the number of seats that invent case facts.
#            Prior: New file: the professor's Test button — POST starts a model-played room on your own config,
#            GET streams its transcript back, so you can read the debrief ACTR gives your case pack
#            without booking three people.
"""HTTP for manager-exercise test runs.

Three endpoints, all owner-scoped:
  POST /api/manager-exercise/<config_id>/test-run  — start a simulated room
  GET  /api/manager-exercise/<config_id>/test-runs — every test room on this config
  GET  /api/manager-exercise/run/<room_id>         — one room's transcript + phase

WHY OWNER-SCOPED AND NOT JUST LOGGED-IN
    A transcript carries the case pack's answer key in the open: ACTR names which
    concerns were unique to which seat, and the outcome document says who was the
    right hire. Handing that to any authenticated user would hand it to the class.
    Every endpoint therefore re-checks that the caller owns the config, and the
    room-scoped one derives the config from the room id rather than trusting a
    query parameter.

WHY A TEST RUN IS A REAL ROOM
    It is driven by the real phase machine and persists like any other room — see
    `src/managers/exercise_sim.py` for what that buys. Here it only means the
    transcript endpoint is a plain read of `group_chat_messages`, with no separate
    storage to keep in step.
"""
import logging

from bson import ObjectId
from flask import Blueprint, jsonify, current_app, request
from flask_jwt_extended import jwt_required, get_jwt_identity

from models.config import Config
from routes.group_chat_sockets import start_test_run
from src.managers import exercise_state as ex_state
from src.models.manager_exercise_session import ManagerExerciseSession

logger = logging.getLogger(__name__)

manager_exercise_bp = Blueprint('manager_exercise_routes', __name__)

# Test rooms are `{config_id}_t{hex}`; class rooms are `{config_id}_g{n}`. The
# marker is what keeps the two apart in the lobby and in the listing below.
TEST_ROOM_MARKER = "_t"


def _load_owned_config(config_id):
    """The config doc if the caller owns it, else (None, error_response).

    Ownership is the whole authorization story for this blueprint, so it is
    resolved once here rather than repeated per route where one copy can rot.
    """
    try:
        oid = ObjectId(config_id)
    except Exception:  # noqa: BLE001
        return None, (jsonify({"error": "Invalid config id"}), 400)

    # Ownership is part of the QUERY, not a check after the fetch — the same shape
    # every other config route uses, and it cannot be forgotten by a later edit.
    doc = Config.get_collection().find_one({"_id": oid, "user_id": get_jwt_identity()})
    if not doc:
        return None, (jsonify({"error": "Configuration not found or access denied"}), 404)
    if doc.get("bot_type") != "manager_exercise":
        return None, (jsonify({"error": "Not a manager exercise"}), 400)
    return doc, None


def _test_session_docs(config_id):
    """This config's TEST session docs — the `_t` rooms, never the class `_g` ones.

    The marker is checked on the suffix rather than anywhere in the string, since a
    config id is hex and could itself contain the letters.
    """
    out = []
    for doc in ManagerExerciseSession.find_by_config(config_id):
        room_id = doc.get("room_id") or ""
        if room_id.startswith(f"{config_id}{TEST_ROOM_MARKER}"):
            out.append(doc)
    return out


@manager_exercise_bp.route('/manager-exercise/<config_id>/test-run', methods=['POST'])
@jwt_required()
def create_test_run(config_id):
    """Start a test room and return its id immediately.

    Returns before the room has done anything: a full run is minutes of model
    calls, and the professor is going to watch it happen on the transcript page
    rather than wait on this request. A failure to LAUNCH is reported here; a
    failure mid-run shows up as a room that stops advancing.
    """
    config_doc, error = _load_owned_config(config_id)
    if error:
        return error

    # One run at a time per config. Each is minutes of model calls, and the button
    # gives no feedback for several seconds — which is exactly the shape of thing
    # people press twice. Returns the run already going rather than an error, since
    # that is what the second press was asking for.
    #
    # "Going" means a LIVE in-memory room, not an unfinished document: a run killed
    # by a deploy leaves its doc mid-phase forever, and testing the doc would lock
    # the professor out of the feature until someone edited Mongo by hand.
    for doc in _test_session_docs(config_id):
        state = ex_state.get_exercise(doc.get("room_id"))
        if state is not None and state.phase() != "done":
            return jsonify({"room_id": doc["room_id"], "already_running": True}), 200

    # How many seats invent case facts instead of reporting theirs. Clamped in the
    # simulator, which always keeps one reliable seat — a room where everyone makes
    # things up gives the facilitator nothing to steer back to.
    try:
        misleading = int((request.get_json(silent=True) or {}).get("misleading") or 0)
    except (TypeError, ValueError):
        misleading = 0

    try:
        room_id = start_test_run(config_doc, misleading=misleading)
    except RuntimeError as e:
        # The launcher is registered when socket events are, so this means the app
        # came up without them — worth saying plainly rather than as a 500.
        logger.error(f"test run unavailable: {e}")
        return jsonify({"error": "Test runs are not available on this server"}), 503
    except Exception as e:  # noqa: BLE001
        logger.exception("failed to start test run")
        return jsonify({"error": f"Could not start the test run: {e}"}), 500
    return jsonify({"room_id": room_id}), 201


@manager_exercise_bp.route('/manager-exercise/<config_id>/test-runs', methods=['GET'])
@jwt_required()
def list_test_runs(config_id):
    """Every test room on this config, newest first, for a "past runs" list."""
    config_doc, error = _load_owned_config(config_id)
    if error:
        return error

    db = current_app.config["MONGO_DB"]
    runs = []
    for doc in _test_session_docs(config_id):
        room_id = doc.get("room_id")
        runs.append({
            "room_id": room_id,
            "phase": doc.get("phase") or "waiting",
            "chosen_candidate": doc.get("chosen_candidate"),
            "messages": db["group_chat_messages"].count_documents({"room_id": room_id}),
            "created_at": doc.get("created_at").isoformat() if doc.get("created_at") else None,
        })
    runs.sort(key=lambda r: r.get("created_at") or "", reverse=True)
    return jsonify({"runs": runs}), 200


@manager_exercise_bp.route('/manager-exercise/run/<room_id>', methods=['GET'])
@jwt_required()
def get_run(room_id):
    """One room's transcript, roster and current phase.

    Polled by the run page while a test is in flight, and the same read serves a
    finished one — the messages are persisted either way, so there is no live
    channel to miss and nothing to reconstruct after the fact.

    The phase prefers live in-memory state and falls back to the persisted doc, so
    a run that spanned a restart still reports where it actually stopped.
    """
    config_id = (room_id or "").split("_", 1)[0]
    config_doc, error = _load_owned_config(config_id)
    if error:
        return error

    doc = ManagerExerciseSession.find_by_room(room_id) or {}
    state = ex_state.get_exercise(room_id)
    messages = list(
        current_app.config["MONGO_DB"]["group_chat_messages"]
        .find({"room_id": room_id}, {"_id": 0, "sender": 1, "text": 1, "turn": 1,
                                     "timestamp": 1, "reasoning": 1})
        .sort("turn", 1)
    )
    return jsonify({
        "room_id": room_id,
        "phase": state.phase() if state else (doc.get("phase") or "waiting"),
        "roster": doc.get("roster") or [],
        "chosen_candidate": doc.get("chosen_candidate"),
        # The private round-0 picks, as anonymous counts. Safe for the config's
        # owner — they authored the answer key — and it is the one number that
        # tells them whether their case pack actually splits a room.
        "solo_spread": state.solo_spread() if state else {},
        "messages": messages,
    }), 200
