# @language  Python
# @updated   2026-09-02
# @changed   Voice turns now run the lean `voice_runner` instead of the agentic RAG loop — no tools,
#            so Hume starts speaking on the model's first real token. Session id gained a fourth
#            segment carrying per-session variables (participant/topic/stance) from the launch URL,
#            time-to-first-token is logged per turn, and a failed turn speaks one neutral line
#            instead of reading the exception out loud.
"""
Hume EVI Custom Language Model (CLM) bridge.

Hume EVI 3 sends OpenAI-shaped Chat Completions requests to a configurable
`custom_language_model_url`. This blueprint exposes that endpoint and bridges
each request into a lean Claude turn (`src/audio/voice_runner.py`), re-emitting
tokens as OpenAI Chat Completion SSE deltas so EVI can speak them.

Endpoint: POST /api/audio/clm/chat/completions

Request body (subset of OpenAI's schema, what Hume sends):
  {
    "model": "<ignored, we use the bot's configured model>",
    "messages": [
      {"role": "user"|"assistant"|"system", "content": "..."}, ...
    ],
    "stream": true,
    "custom_session_id": "<config_id>:<chat_id>:<user_id>[:<vars>]",
    ...other OpenAI fields ignored...
  }

Hume injects `custom_session_id` from the session settings the frontend sets
when opening the WebSocket. We parse it to route to the right bot config and to
recover the per-session variables a study passed in at launch.

NOTE: this path deliberately has no knowledge base and no web access. Every tool
round is a second model round-trip before the first spoken word, which is what
made voice feel slow. A voice bot that needs documents is a separate decision,
not a flag on this route.
"""
import base64
import json
import logging
import time
import uuid
from typing import Dict, Any, Iterator, List, Optional, Tuple

from bson import ObjectId
from flask import Blueprint, Response, current_app, jsonify, request, stream_with_context

from src.audio.voice_runner import stream_voice_response

logger = logging.getLogger(__name__)
audio_clm_bp = Blueprint('audio_clm_routes', __name__)

# The only thing a student ever hears when a turn fails. Said in the register of
# the conversation rather than reported as an error, because it is spoken aloud —
# whatever actually broke goes to the log with a traceback.
SPOKEN_FAILURE_LINE = "Sorry, I lost my train of thought there. Could you say that again?"

# Per-session variables ride in the session id as urlsafe-base64 JSON. Capped so a
# tampered-with launch URL cannot push an arbitrary payload into the system prompt.
MAX_SESSION_VARS = 20
MAX_SESSION_VAR_CHARS = 500


def _decode_session_vars(raw: Optional[str]) -> Dict[str, str]:
    """Decode the session-id's variables segment into a flat string dict.

    The segment is urlsafe-base64 of a JSON object, chosen because base64url
    contains no colons and so cannot break the positional parse above it. Values
    are coerced to strings and truncated: they are substituted straight into the
    system prompt, so nothing structural is allowed through.
    """
    if not raw:
        return {}
    try:
        padded = raw + "=" * (-len(raw) % 4)
        decoded = json.loads(base64.urlsafe_b64decode(padded.encode()).decode("utf-8"))
    except Exception:
        logger.warning("CLM: could not decode session variables segment; ignoring it.")
        return {}

    if not isinstance(decoded, dict):
        return {}

    out: Dict[str, str] = {}
    for key, value in list(decoded.items())[:MAX_SESSION_VARS]:
        if value is None:
            continue
        out[str(key)[:64]] = str(value)[:MAX_SESSION_VAR_CHARS]
    return out


def _parse_session_id(raw: Optional[str]) -> Tuple[Dict[str, Optional[str]], Dict[str, str]]:
    """`<config_id>:<chat_id>:<user_id>[:<b64 vars>]` — user_id may be 'anonymous'.

    The fourth segment is optional and carries whatever the launch URL passed
    (participant code, assigned topic, assigned stance). Older links with three
    segments keep working and simply supply no variables.
    """
    if not raw:
        return {"config_id": None, "chat_id": None, "user_id": None}, {}
    parts = raw.split(":")
    ids = {
        "config_id": parts[0] if len(parts) > 0 else None,
        "chat_id": parts[1] if len(parts) > 1 else None,
        "user_id": parts[2] if len(parts) > 2 else None,
    }
    return ids, _decode_session_vars(parts[3] if len(parts) > 3 else None)


def _split_history_and_input(messages: List[Dict[str, Any]]):
    """Hume sends the full conversation; we want history + last user turn.

    We strip system messages (the runner builds its own from the bot config).
    """
    cleaned = []
    for m in messages or []:
        role = m.get("role")
        content = m.get("content")
        if not role or content is None:
            continue
        if role == "system":
            continue
        if isinstance(content, list):
            text_parts = [
                p.get("text", "") for p in content
                if isinstance(p, dict) and p.get("type") == "text"
            ]
            content = " ".join(t for t in text_parts if t).strip()
        if not isinstance(content, str):
            content = str(content)
        if not content.strip():
            continue
        cleaned.append({"role": role, "content": content.strip()})

    # Anthropic rejects a history that opens on an assistant turn, and EVI's
    # configured greeting is exactly that — the bot speaks first, so Hume's very
    # next payload starts with an assistant message. Drop the lead-in rather
    # than 400 every call that uses a greeting.
    while cleaned and cleaned[0]["role"] != "user":
        cleaned.pop(0)

    if cleaned and cleaned[-1]["role"] == "user":
        return cleaned[:-1], cleaned[-1]["content"]
    return cleaned, ""


def _sse(data: Dict[str, Any]) -> str:
    return f"data: {json.dumps(data)}\n\n"


def _openai_chunk(chunk_id: str, model: str, delta: Dict[str, Any], finish_reason: Optional[str] = None) -> Dict[str, Any]:
    return {
        "id": chunk_id,
        "object": "chat.completion.chunk",
        "created": int(time.time()),
        "model": model,
        "choices": [{
            "index": 0,
            "delta": delta,
            "finish_reason": finish_reason,
        }],
    }


@audio_clm_bp.route('/audio/clm/chat/completions', methods=['POST', 'OPTIONS'])
def clm_chat_completions():
    if request.method == 'OPTIONS':
        return ('', 204)

    body = request.get_json(silent=True) or {}
    messages = body.get("messages") or []
    session_id_raw = body.get("custom_session_id") or request.args.get("custom_session_id")

    parsed, session_vars = _parse_session_id(session_id_raw)
    config_id = parsed["config_id"]

    if not config_id:
        return jsonify({"error": "Missing custom_session_id (expected '<config_id>:<chat_id>:<user_id>')"}), 400

    try:
        config_doc = current_app.config['MONGO_DB']['config_collections'].find_one(
            {"_id": ObjectId(config_id.strip())},
            {
                "model_name": 1, "temperature": 1, "prompt_template": 1,
                "is_public": 1, "user_id": 1, "audio_enabled": 1,
                "bot_name": 1, "instructions": 1,
            },
        )
    except Exception as e:
        logger.error("CLM: bad config_id %r: %s", config_id, e)
        return jsonify({"error": "Invalid configuration id"}), 400

    if not config_doc:
        return jsonify({"error": "Configuration not found"}), 404

    if not config_doc.get("audio_enabled"):
        return jsonify({"error": "Audio is not enabled for this configuration"}), 403

    history_messages, user_input = _split_history_and_input(messages)
    if not user_input:
        return jsonify({"error": "No user message in request"}), 400

    model_name = (config_doc.get("model_name") or "").lower()
    chunk_id = f"chatcmpl-{uuid.uuid4().hex}"

    @stream_with_context
    def generate() -> Iterator[str]:
        # Initial chunk: assistant role marker (OpenAI streaming convention).
        yield _sse(_openai_chunk(chunk_id, model_name, {"role": "assistant", "content": ""}))

        # Time-to-first-token is the number that decides whether the call feels
        # like a conversation, so it is measured per turn rather than inferred.
        started = time.monotonic()
        first_token_at = None
        spoke_anything = False
        finish = "stop"

        try:
            for text in stream_voice_response(
                config=config_doc,
                user_input=user_input,
                history_messages=history_messages,
                variables=session_vars,
            ):
                if first_token_at is None:
                    first_token_at = time.monotonic()
                spoke_anything = True
                yield _sse(_openai_chunk(chunk_id, model_name, {"content": text}))
        except Exception as e:
            logger.error("CLM voice turn failed (config %s): %s", config_id, e, exc_info=True)
            finish = "stop"
            # Only speak the recovery line if the turn produced nothing. Once words
            # are already in the air, cutting the sentence short reads as a normal
            # interruption; an apology tacked onto it does not.
            if not spoke_anything:
                yield _sse(_openai_chunk(chunk_id, model_name, {"content": SPOKEN_FAILURE_LINE}))

        ttft_ms = int((first_token_at - started) * 1000) if first_token_at else None
        logger.info(
            "CLM voice turn: config=%s model=%s ttft_ms=%s total_ms=%s vars=%d",
            config_id, model_name or "(default)", ttft_ms,
            int((time.monotonic() - started) * 1000), len(session_vars),
        )

        yield _sse(_openai_chunk(chunk_id, model_name, {}, finish_reason=finish))
        yield "data: [DONE]\n\n"

    return Response(
        generate(),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
        },
    )
