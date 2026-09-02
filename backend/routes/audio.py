# @language  Python
# @updated   2026-09-02
# @changed   Calls are now recorded and exportable. Turns carry a real position in the call
#            (turn_index + offset_ms + client received_at) instead of only a server receive time;
#            a new `audio_calls` doc holds per-call metadata and the S3 recording key; and
#            GET /audio/export/<config_id> serves the whole class as structured JSON or CSV.
"""
Audio session persistence, recording storage, and call export.

Three things live here:

1. **Turns** — the frontend posts every finalized EVI turn to
   `/audio/session/turn`, which lands one document per turn in `audio_sessions`.
2. **Calls** — `/audio/session/call` upserts one document per call into
   `audio_calls` (who, when, which session variables, where the recording sits).
   It is called twice: once when the call opens, once when it ends. Opening
   early matters — a student who closes the tab mid-call still leaves a record
   with their assigned topic and stance attached.
3. **Export** — `/audio/export/<config_id>` joins the two, owner-scoped, as JSON
   or CSV. This is the machine-readable record a study takes away.

`/audio/hume/access_token` mints a short-lived token via OAuth2 client
credentials so the browser-side @humeai/voice-react SDK can open a WebSocket
without ever seeing the raw API key.
"""
import base64
import csv
import io
import json
import logging
import os
import time
from typing import Any, Dict

import requests
from bson import ObjectId
from flask import Blueprint, Response, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required, verify_jwt_in_request

from src.audio.analyzer_registry import run_all as run_all_analyzers
from src.utils.s3_client import generate_download_url, generate_presigned_put_url

logger = logging.getLogger(__name__)
audio_bp = Blueprint('audio_routes', __name__)

AUDIO_SESSIONS_COLLECTION = "audio_sessions"
AUDIO_CALLS_COLLECTION = "audio_calls"

# A 10-minute Opus call is a few MB; the ceiling is generous but finite so a bad
# client cannot mint a presigned URL for an arbitrary upload.
RECORDING_CONTENT_TYPES = {
    "audio/webm": "webm",
    "audio/webm;codecs=opus": "webm",
    "audio/ogg": "ogg",
    "audio/ogg;codecs=opus": "ogg",
    "audio/mp4": "mp4",
}


_INDEXES_ENSURED = False


def _calls_collection():
    """The `audio_calls` collection, with its indexes ensured once per process.

    `session_id` is unique for a reason: the client upserts the same call row
    from two places — once when the socket connects, once when Hume's own chat id
    arrives moments later. Without the constraint those two writes can race into
    two rows for a single call, and the export would then show it twice. Lazy and
    flag-guarded so it does not cost a round-trip per request.
    """
    global _INDEXES_ENSURED
    db = current_app.config['MONGO_DB']
    if not _INDEXES_ENSURED:
        try:
            db[AUDIO_CALLS_COLLECTION].create_index("session_id", unique=True)
            db[AUDIO_CALLS_COLLECTION].create_index("config_id")
            # The export reads every turn for a config and groups them by call.
            db[AUDIO_SESSIONS_COLLECTION].create_index([("config_id", 1), ("session_id", 1)])
            _INDEXES_ENSURED = True
        except Exception as e:  # noqa: BLE001
            logger.warning("Could not ensure audio indexes: %s", e)
    return db[AUDIO_CALLS_COLLECTION]


def _resolve_user_id() -> str:
    try:
        verify_jwt_in_request(optional=True)
        uid = get_jwt_identity()
        return uid or "anonymous"
    except Exception:
        return "anonymous"


def _load_owned_config(config_id: str):
    """The config doc if the caller owns it, else (None, error_response).

    Ownership is part of the query rather than a check after the fetch, matching
    the other config-scoped blueprints — a later edit cannot forget it.
    """
    try:
        oid = ObjectId(config_id)
    except Exception:  # noqa: BLE001
        return None, (jsonify({"error": "Invalid config id"}), 400)

    doc = current_app.config['MONGO_DB']['config_collections'].find_one(
        {"_id": oid, "user_id": get_jwt_identity()}
    )
    if not doc:
        return None, (jsonify({"error": "Configuration not found or access denied"}), 404)
    return doc, None


def _audio_config_or_error(config_id: str):
    """An existing audio-enabled config, for the unauthenticated student paths.

    Students arrive from a Qualtrics link with no account, so these routes cannot
    require a JWT. What they can require is that the config exists and has audio
    turned on, and that the storage key is derived server-side — a caller never
    supplies the path it writes to.
    """
    try:
        oid = ObjectId(config_id)
    except Exception:  # noqa: BLE001
        return None, (jsonify({"error": "Invalid config id"}), 400)

    doc = current_app.config['MONGO_DB']['config_collections'].find_one(
        {"_id": oid}, {"audio_enabled": 1, "bot_name": 1}
    )
    if not doc:
        return None, (jsonify({"error": "Configuration not found"}), 404)
    if not doc.get("audio_enabled"):
        return None, (jsonify({"error": "Audio is not enabled for this configuration"}), 403)
    return doc, None


@audio_bp.route('/audio/session/turn', methods=['POST'])
def record_audio_turn():
    """Persist a single audio turn to MongoDB.

    Body:
      session_id (str)        — chat_id (1:1) or room_id (group)
      config_id (str)
      chat_type (str)         — "1on1" | "group"
      transcript (str)
      role (str)              — "user" | "assistant"
      prosody_scores (dict?)  — Hume EVI prosody, optional
      turn_index (int?)       — position in the call
      offset_ms (int?)        — milliseconds from the start of the call
      received_at (str?)      — client ISO timestamp for this turn

    `offset_ms` and `turn_index` are what make the export a transcript rather
    than a bag of rows. They come from the client because only the client knows
    when the call actually started; the server timestamp stays alongside them as
    an independent record that cannot be spoofed by a slow browser clock.
    """
    body = request.get_json(silent=True) or {}
    session_id = (body.get('session_id') or '').strip()
    config_id = (body.get('config_id') or '').strip()
    chat_type = (body.get('chat_type') or '1on1').strip()
    transcript = (body.get('transcript') or '').strip()
    role = (body.get('role') or 'user').strip()
    prosody_scores = body.get('prosody_scores')

    if not session_id or not config_id:
        return jsonify({"error": "session_id and config_id are required"}), 400
    if chat_type not in ("1on1", "group"):
        return jsonify({"error": "chat_type must be '1on1' or 'group'"}), 400
    if not transcript:
        return jsonify({"error": "transcript is required"}), 400

    user_id = _resolve_user_id()

    def _as_int(value):
        try:
            return int(value)
        except (TypeError, ValueError):
            return None

    # Run analyzers synchronously. Empty registry on day one — this is a no-op
    # that returns {} but locks in the contract for future plugins.
    analyzer_results = run_all_analyzers(None, transcript)

    doc: Dict[str, Any] = {
        "session_id": session_id,
        "config_id": config_id,
        "user_id": user_id,
        "chat_type": chat_type,
        "role": role,
        "transcript": transcript,
        "prosody_scores": prosody_scores if isinstance(prosody_scores, dict) else None,
        "analyzer_results": analyzer_results,
        "turn_index": _as_int(body.get('turn_index')),
        "offset_ms": _as_int(body.get('offset_ms')),
        "received_at": (body.get('received_at') or None),
        "timestamp": time.time(),
    }

    try:
        col = current_app.config['MONGO_DB'][AUDIO_SESSIONS_COLLECTION]
        result = col.insert_one(doc)
        return jsonify({
            "ok": True,
            "id": str(result.inserted_id),
            "analyzer_results": analyzer_results,
        }), 201
    except Exception as e:
        logger.error("Failed to persist audio turn: %s", e, exc_info=True)
        return jsonify({"error": "Failed to persist audio turn"}), 500


@audio_bp.route('/audio/session/call', methods=['POST'])
def upsert_audio_call():
    """Create or update the one metadata document for a call.

    Called twice by the client: at connect (session variables, start time, Hume's
    own chat id) and at hang-up (end time, duration, recording key). Writing at
    connect rather than only at the end is deliberate — a student who closes the
    tab halfway through still leaves a row carrying the topic and stance they
    were assigned, which is the difference between a usable partial record and an
    orphaned pile of turns.
    """
    body = request.get_json(silent=True) or {}
    session_id = (body.get('session_id') or '').strip()
    config_id = (body.get('config_id') or '').strip()
    if not session_id or not config_id:
        return jsonify({"error": "session_id and config_id are required"}), 400

    _, error = _audio_config_or_error(config_id)
    if error:
        return error

    # Only fields the client actually sent are written, so the hang-up call
    # cannot blank out what the connect call recorded.
    fields: Dict[str, Any] = {"config_id": config_id, "user_id": _resolve_user_id()}
    for key in ("started_at", "ended_at", "hume_chat_id", "storage_key", "content_type"):
        value = body.get(key)
        if value:
            fields[key] = str(value)
    if isinstance(body.get('variables'), dict):
        fields["variables"] = {str(k): str(v) for k, v in body['variables'].items()}
    if body.get('duration_ms') is not None:
        try:
            fields["duration_ms"] = int(body['duration_ms'])
        except (TypeError, ValueError):
            pass

    try:
        _calls_collection().update_one(
            {"session_id": session_id},
            {"$set": fields, "$setOnInsert": {"created_at": time.time()}},
            upsert=True,
        )
        return jsonify({"ok": True}), 200
    except Exception as e:
        logger.error("Failed to upsert audio call %s: %s", session_id, e, exc_info=True)
        return jsonify({"error": "Failed to save call metadata"}), 500


@audio_bp.route('/audio/session/recording/url', methods=['POST'])
def recording_upload_url():
    """Mint a presigned PUT so the browser uploads the recording straight to S3.

    Direct-to-S3 rather than through Flask: a ten-minute call is megabytes, and
    routing it through the app server buys nothing. The key is built here from
    the config and session ids — the client never names the path it writes to.
    """
    body = request.get_json(silent=True) or {}
    session_id = (body.get('session_id') or '').strip()
    config_id = (body.get('config_id') or '').strip()
    content_type = (body.get('content_type') or 'audio/webm').strip()

    if not session_id or not config_id:
        return jsonify({"error": "session_id and config_id are required"}), 400

    base_type = content_type.split(';')[0].strip()
    extension = RECORDING_CONTENT_TYPES.get(content_type) or RECORDING_CONTENT_TYPES.get(base_type)
    if not extension:
        return jsonify({"error": f"Unsupported recording type: {content_type}"}), 400

    _, error = _audio_config_or_error(config_id)
    if error:
        return error

    key = f"audio_calls/{config_id}/{session_id}.{extension}"
    try:
        url = generate_presigned_put_url(key, content_type)
    except Exception as e:
        logger.error("Presign failed for %s: %s", key, e, exc_info=True)
        return jsonify({"error": "Could not prepare the upload"}), 502

    return jsonify({"upload_url": url, "storage_key": key, "content_type": content_type}), 200


def _top_emotion(prosody):
    """The single strongest Hume emotion for a turn, as (name, score).

    The full 48-dimension vector stays in the JSON export; CSV gets this plus the
    raw JSON, because a spreadsheet with 48 emotion columns per turn is not the
    format anyone actually opens.
    """
    if not isinstance(prosody, dict) or not prosody:
        return None, None
    try:
        name, score = max(prosody.items(), key=lambda kv: float(kv[1]))
        return name, round(float(score), 4)
    except (TypeError, ValueError):
        return None, None


def _collect_export(config_id: str, with_urls: bool = True):
    """Join `audio_calls` with their `audio_sessions` turns, newest call first.

    Turns are ordered by `turn_index` when the client supplied one and by server
    receive time otherwise, so a call recorded before this field existed still
    exports in the right order.
    """
    db = current_app.config['MONGO_DB']
    calls = list(_calls_collection().find({"config_id": config_id}))
    turns = list(db[AUDIO_SESSIONS_COLLECTION].find({"config_id": config_id}))

    by_session: Dict[str, list] = {}
    for turn in turns:
        by_session.setdefault(turn.get("session_id"), []).append(turn)

    # A call that predates the audio_calls collection has turns but no metadata
    # row. Synthesize a stub so its transcript still exports rather than vanishing.
    for session_id in by_session:
        if not any(c.get("session_id") == session_id for c in calls):
            calls.append({"session_id": session_id, "config_id": config_id})

    out = []
    for call in sorted(calls, key=lambda c: c.get("created_at") or 0, reverse=True):
        session_id = call.get("session_id")
        rows = sorted(
            by_session.get(session_id, []),
            key=lambda t: (
                t.get("turn_index") if t.get("turn_index") is not None else 10**9,
                t.get("timestamp") or 0,
            ),
        )

        recording = None
        if call.get("storage_key"):
            recording = {
                "storage_key": call["storage_key"],
                "content_type": call.get("content_type"),
            }
            if with_urls:
                try:
                    recording["download_url"] = generate_download_url(
                        call["storage_key"], expires_in=3600,
                        filename=f"{session_id}.{call['storage_key'].rsplit('.', 1)[-1]}",
                    )
                except Exception as e:  # noqa: BLE001
                    logger.warning("Could not presign recording %s: %s", call["storage_key"], e)

        out.append({
            "session_id": session_id,
            "user_id": call.get("user_id"),
            "started_at": call.get("started_at"),
            "ended_at": call.get("ended_at"),
            "duration_ms": call.get("duration_ms"),
            "hume_chat_id": call.get("hume_chat_id"),
            "variables": call.get("variables") or {},
            "recording": recording,
            "turn_count": len(rows),
            "turns": [{
                "index": t.get("turn_index"),
                "speaker": t.get("role"),
                "offset_ms": t.get("offset_ms"),
                "received_at": t.get("received_at"),
                "server_timestamp": t.get("timestamp"),
                "text": t.get("transcript"),
                "prosody": t.get("prosody_scores"),
            } for t in rows],
        })
    return out


@audio_bp.route('/audio/export/<config_id>', methods=['GET'])
@jwt_required()
def export_calls(config_id):
    """Every call on this config, structured, for the owning professor.

    `?format=csv` flattens to one row per turn — call metadata and each session
    variable get their own column, which is the "not a single column" shape a
    study needs. JSON is the complete record and is what to use for prosody.
    """
    config_doc, error = _load_owned_config(config_id)
    if error:
        return error

    fmt = (request.args.get('format') or 'json').lower()
    calls = _collect_export(config_id, with_urls=True)

    if fmt == 'json':
        return jsonify({
            "config_id": config_id,
            "bot_name": config_doc.get("bot_name"),
            "exported_at": time.time(),
            "call_count": len(calls),
            "calls": calls,
        }), 200

    if fmt != 'csv':
        return jsonify({"error": "format must be 'json' or 'csv'"}), 400

    # One column per session variable, across every call — a study that passes
    # topic and stance gets `topic` and `stance` columns, not a JSON blob.
    var_keys = sorted({k for c in calls for k in (c.get("variables") or {})})
    header = [
        "config_id", "session_id", "user_id", "started_at", "duration_ms",
        "hume_chat_id", "recording_key",
        *[f"var_{k}" for k in var_keys],
        "turn_index", "speaker", "offset_ms", "received_at", "text",
        "top_emotion", "top_emotion_score", "prosody_json",
    ]

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(header)
    for call in calls:
        variables = call.get("variables") or {}
        recording_key = (call.get("recording") or {}).get("storage_key", "")
        call_cells = [
            config_id, call.get("session_id", ""), call.get("user_id", ""),
            call.get("started_at", ""), call.get("duration_ms", ""),
            call.get("hume_chat_id", ""), recording_key,
            *[variables.get(k, "") for k in var_keys],
        ]
        for turn in call["turns"]:
            emotion, score = _top_emotion(turn.get("prosody"))
            writer.writerow(call_cells + [
                turn.get("index", ""), turn.get("speaker", ""),
                turn.get("offset_ms", ""), turn.get("received_at", ""),
                turn.get("text", ""), emotion or "", score if score is not None else "",
                json.dumps(turn.get("prosody")) if turn.get("prosody") else "",
            ])

    return Response(
        buf.getvalue(),
        mimetype='text/csv',
        headers={'Content-Disposition': f'attachment; filename="calls_{config_id}.csv"'},
    )


@audio_bp.route('/audio/hume/access_token', methods=['GET'])
def hume_access_token():
    """Mint a Hume EVI access token using OAuth2 client credentials.

    The browser SDK uses this token to open the EVI WebSocket. We never expose
    the raw HUME_API_KEY / HUME_SECRET_KEY to the client.
    """
    api_key = os.getenv("HUME_API_KEY")
    secret_key = os.getenv("HUME_SECRET_KEY")
    if not api_key or not secret_key:
        return jsonify({"error": "Hume credentials are not configured on this server"}), 503

    basic = base64.b64encode(f"{api_key}:{secret_key}".encode()).decode()
    try:
        resp = requests.post(
            "https://api.hume.ai/oauth2-cc/token",
            headers={
                "Authorization": f"Basic {basic}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            data={"grant_type": "client_credentials"},
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception as e:
        logger.error("Hume token exchange failed: %s", e, exc_info=True)
        return jsonify({"error": "Failed to mint Hume access token"}), 502

    return jsonify({
        "access_token": data.get("access_token"),
        "expires_in": data.get("expires_in"),
        "token_type": data.get("token_type", "Bearer"),
        "config_id": os.getenv("HUME_CONFIG_ID"),
    })


@audio_bp.route('/audio/transcribe', methods=['POST'])
def transcribe_audio():
    """Transcribe a single audio blob via OpenAI Whisper.

    Body: multipart/form-data with field `audio` (the recorded blob).
    Returns: {"text": "..."}
    """
    if 'audio' not in request.files:
        return jsonify({"error": "audio file is required"}), 400

    audio_file = request.files['audio']
    raw = audio_file.read()
    if not raw:
        return jsonify({"error": "empty audio"}), 400

    api_key = current_app.config.get("OPENAI_API_KEY") or os.getenv("OPENAI_API_KEY")
    if not api_key:
        return jsonify({"error": "Transcription is not configured on this server"}), 503

    try:
        import openai
        client = openai.OpenAI(api_key=api_key)
        buf = io.BytesIO(raw)
        buf.name = audio_file.filename or "recording.webm"
        result = client.audio.transcriptions.create(
            model="whisper-1",
            file=buf,
        )
        text = (getattr(result, "text", "") or "").strip()
        return jsonify({"text": text})
    except Exception as e:
        logger.error("Whisper transcription failed: %s", e, exc_info=True)
        return jsonify({"error": "Transcription failed"}), 502
