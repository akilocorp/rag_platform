"""
Audio session persistence (and stubs for group-chat STT/TTS).

For the 1:1 path, the frontend calls POST /api/audio/session/turn after each
EVI exchange to persist `{transcript, prosody_scores, analyzer_results}` into
the `audio_sessions` collection. Transcribe / synthesize endpoints will be
implemented in the group-chat phase.

GET /api/audio/hume/access_token mints a short-lived token via OAuth2 client
credentials so the browser-side @humeai/voice-react SDK can open a WebSocket
without ever seeing the raw API key.
"""
import base64
import io
import logging
import os
import time
from typing import Any, Dict

import requests
from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, verify_jwt_in_request

from src.audio.analyzer_registry import run_all as run_all_analyzers

logger = logging.getLogger(__name__)
audio_bp = Blueprint('audio_routes', __name__)

AUDIO_SESSIONS_COLLECTION = "audio_sessions"


def _resolve_user_id() -> str:
    try:
        verify_jwt_in_request(optional=True)
        uid = get_jwt_identity()
        return uid or "anonymous"
    except Exception:
        return "anonymous"


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
