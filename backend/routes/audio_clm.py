# @language  Python
# @updated   2026-09-21
# @changed   Each turn now carries a `[call clock: …]` marker on the user message, so a persona phased by
#            wall-clock time (press window, close) can actually follow it — a model has no clock. Start
#            times are cached per process; the marker stays off the cached system block on purpose.
#            Prior: A failed turn now says WHY. Speaking one neutral line kept the student out of the traceback
#            but also left the reason only in the container log, which is unreachable while a live call
#            is failing — and unreachable from the browser too, since Hume calls this endpoint from its
#            own servers and nothing about it ever appears in the page's network tab. The reason is now
#            held in memory per bot and served by `GET /audio/clm/last-error/<config_id>`, which the
#            voice overlay reads back and prints to the console; `?debug=1` returns the same payload
#            inline. Both carry the exception, the installed anthropic version and whether the key is set.
#            Prior: voice turns run the lean `voice_runner` instead of the agentic RAG loop — no tools,
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
import re
import logging
import os
import time
import traceback
import uuid
from datetime import datetime, timezone
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

# Why the last voice turn failed, per bot. Hume calls this endpoint server-to-server,
# so a failing turn leaves nothing in the browser to inspect and the student hears
# only the apology — the page reads the real reason back from here. One entry deep
# and lost on restart: a diagnostic, not a log.
_LAST_FAILURES: Dict[str, Dict[str, Any]] = {}


def _failure_diagnostics(exc):
    """The three things that tell one voice failure apart from another.

    A spoken bot cannot show a traceback and the container log is out of reach
    while a call is failing, so a dead key, a missing or incompatible SDK and a
    rejected request are separated here — returned only to a caller that asked.
    """
    try:
        import anthropic
        sdk_version = getattr(anthropic, "__version__", "unknown")
    except Exception as import_exc:
        sdk_version = "import failed: %s: %s" % (type(import_exc).__name__, import_exc)
    return {
        "error_type": type(exc).__name__,
        "error": str(exc)[:1500],
        "anthropic_key_set": bool(os.getenv("ANTHROPIC_API_KEY")),
        "anthropic_sdk": sdk_version,
        "traceback": traceback.format_exc()[-3000:],
    }


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
    """`<config_id>:<chat_id>:<user_id>[:<b64 vars>][:r<epoch ms>]` — user_id may be 'anonymous'.

    The fourth segment is optional and carries whatever the launch URL passed
    (participant code, assigned topic, assigned stance). Older links with three
    segments keep working and simply supply no variables. A trailing `r<ms>`
    segment marks a call resumed after a pause, at that client time — see
    `_prior_turns`. It is recognised by shape, so it may follow either form.
    """
    if not raw:
        return {"config_id": None, "chat_id": None, "user_id": None, "resumed_at_ms": None}, {}
    parts = raw.split(":")
    resumed_at_ms = None
    if len(parts) > 3 and _RESUME_SEGMENT.match(parts[-1]):
        resumed_at_ms = int(parts.pop()[1:])
    ids = {
        "config_id": parts[0] if len(parts) > 0 else None,
        "chat_id": parts[1] if len(parts) > 1 else None,
        "user_id": parts[2] if len(parts) > 2 else None,
        "resumed_at_ms": resumed_at_ms,
    }
    return ids, _decode_session_vars(parts[3] if len(parts) > 3 else None)


# --- Resumed calls ----------------------------------------------------------
# A paused call resumes as a new Hume chat in the same chat group, and Hume's
# CLM requests carry only the new chat's messages. Left alone, the model meets
# the student as a stranger halfway through their debate ("I don't have memory
# of previous conversations"). Every turn the frontend saved before the resume
# is in `audio_sessions`, so a resumed call gets them back as history.
_RESUME_SEGMENT = re.compile(r"^r\d{12,14}$")
RESUME_NOTE = (
    "[the call was paused and has just resumed - welcome them back in a few words and "
    "carry on from where the conversation left off; do not reintroduce yourself or restate your opening]\n"
)


def _prior_turns(chat_id: str, config_id: str, resumed_at_ms: int) -> List[Dict[str, str]]:
    """Turns of this call saved before the resume, merged into alternating messages.

    Compared on the client's own `received_at` clock, the same clock that stamped
    the resume, so a skewed browser clock cannot misplace the boundary. Hume
    speaks a reply as several assistant messages; consecutive turns from one
    speaker are joined back into one.
    """
    cutoff = datetime.fromtimestamp(resumed_at_ms / 1000, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.") \
        + f"{resumed_at_ms % 1000:03d}Z"
    try:
        rows = current_app.config['MONGO_DB']['audio_sessions'].find(
            {"config_id": config_id, "session_id": chat_id, "received_at": {"$lt": cutoff}},
            {"role": 1, "transcript": 1},
        ).sort([("turn_index", 1), ("timestamp", 1)])
        merged: List[Dict[str, str]] = []
        for r in rows:
            role = "assistant" if r.get("role") == "assistant" else "user"
            text = (r.get("transcript") or "").strip()
            if not text:
                continue
            if merged and merged[-1]["role"] == role:
                merged[-1]["content"] += " " + text
            else:
                merged.append({"role": role, "content": text})
        return merged
    except Exception as e:  # noqa: BLE001
        # Losing the earlier half is bad; failing the turn outright is worse.
        logger.warning("CLM: could not load prior turns for resumed call %s: %s", chat_id, e)
        return []


def _split_history_and_input(messages: List[Dict[str, Any]], prior: Optional[List[Dict[str, str]]] = None):
    """Hume sends the full conversation; we want history + last user turn.

    We strip system messages (the runner builds its own from the bot config).
    `prior` is the earlier half of a resumed call, placed ahead of Hume's messages.
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

    if prior:
        combined: List[Dict[str, str]] = []
        for m in list(prior) + cleaned:
            if combined and combined[-1]["role"] == m["role"]:
                combined[-1] = {"role": m["role"], "content": combined[-1]["content"] + " " + m["content"]}
            else:
                combined.append(dict(m))
        cleaned = combined
        # The bot opens every call, so the earlier half starts on its turn. Keep
        # that opener — it is the position being debated — behind a neutral marker.
        if cleaned and cleaned[0]["role"] == "assistant":
            cleaned.insert(0, {"role": "user", "content": "[call connected]"})

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


# --- Call clock -------------------------------------------------------------
# A persona can be phased by wall-clock time ("the press window is roughly
# minutes 3 to 6", "begin the close around 8 minutes"), and a language model has
# no clock — it sees the transcript and nothing else. Every turn therefore
# carries a bracketed marker telling it how far into the call it is and which of
# its own turns this is.
#
# Start times are cached per process because the voice path spends its whole
# budget on time-to-first-token: a Mongo read per turn would be paid on the
# critical path, a read per session per worker is not. A restart or a second
# worker just re-reads the call record.
_CALL_STARTS: Dict[str, float] = {}
_CALL_STARTS_MAX = 500


def _call_started_at(session_id: str) -> Optional[float]:
    """Unix timestamp this call began, cached per process.

    Prefers the `started_at` the client wrote at connect. Falls back to the
    first turn this worker sees, which is within a few seconds of it — a clock
    that is a little late still beats a persona that cannot find its own press
    window at all.

    Returns None for a session id that isn't a real one (`new`, or a malformed
    custom_session_id). Those would all collide on a single cache entry and hand
    one student another student's elapsed time, so the turn goes out with no
    clock rather than a wrong one.
    """
    if not session_id or session_id == "new":
        return None

    cached = _CALL_STARTS.get(session_id)
    if cached is not None:
        return cached

    started = None
    try:
        doc = current_app.config['MONGO_DB']["audio_calls"].find_one(
            {"session_id": session_id}, {"started_at": 1}
        )
        raw = (doc or {}).get("started_at")
        if raw:
            started = datetime.fromisoformat(str(raw).replace("Z", "+00:00")).timestamp()
    except Exception:
        # A missing or malformed start time is not worth failing a live call over.
        logger.warning("CLM: could not read started_at for %s; clocking from now.", session_id)

    if started is None:
        started = time.time()

    # Bounded, in insertion order — the oldest call is the one least likely to
    # still be speaking.
    if len(_CALL_STARTS) >= _CALL_STARTS_MAX:
        _CALL_STARTS.pop(next(iter(_CALL_STARTS)))
    _CALL_STARTS[session_id] = started
    return started


def _clock_note(elapsed_seconds: Optional[float], bot_turn: int) -> str:
    """The bracketed timing line prepended to the student's utterance.

    It rides on the USER message, never the system block. The persona is cached
    with `cache_control` for the length of the call, so a value that changed
    every turn would invalidate that cache on every turn — paying back exactly
    the latency this path exists to protect.

    With no trustworthy start time the elapsed clause is dropped rather than
    faked: the turn count alone still lets a phased persona pace itself, while a
    clock stuck at 0m00s next to "your turn 7" is just a contradiction for the
    model to resolve.
    """
    if elapsed_seconds is None:
        return f"[call clock: this is your turn {bot_turn}]\n"
    minutes, seconds = divmod(max(0, int(elapsed_seconds)), 60)
    return f"[call clock: {minutes}m{seconds:02d}s elapsed - this is your turn {bot_turn}]\n"


def _bot_turn_number(history_messages: List[Dict[str, Any]]) -> int:
    """Which of the bot's own turns the one being generated is. 1-based.

    Counts what reached the model, which is the number a phased persona should
    pace against. Note that an EVI-configured greeting is stripped upstream by
    `_split_history_and_input` (Anthropic rejects a history opening on an
    assistant turn), so a bot whose opener comes from Hume rather than from its
    own persona is counted one turn lower.
    """
    return sum(1 for m in history_messages if m.get("role") == "assistant") + 1


@audio_clm_bp.route('/audio/clm/last-error/<config_id>', methods=['GET'])
def clm_last_error(config_id):
    """The reason this bot's last voice turn failed, or nothing if it hasn't.

    Read by the voice overlay so a broken call can be diagnosed from the browser
    console. Held in memory, so an empty answer means either no failure since the
    last restart or a different worker handled the turn.
    """
    return jsonify(_LAST_FAILURES.get(config_id) or {"error": None})


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

    resumed_at_ms = parsed.get("resumed_at_ms")
    prior = (_prior_turns(parsed.get("chat_id") or "", config_id, resumed_at_ms)
             if resumed_at_ms and parsed.get("chat_id") else [])
    # Whether the bot has spoken yet since the resume. Read from Hume's raw
    # messages: the cleanup below drops a leading assistant turn, which here is
    # exactly the welcome-back line.
    resumed_greeting = bool(resumed_at_ms) and not any(
        m.get("role") == "assistant" and m.get("content") for m in messages
    )
    history_messages, user_input = _split_history_and_input(messages, prior)
    if not user_input:
        return jsonify({"error": "No user message in request"}), 400

    # Hand the model the one thing the transcript cannot tell it: where in the
    # call it is. Model-only — never persisted, and the spoken-register guide
    # tells the model not to read it out.
    started_at = _call_started_at(parsed.get("chat_id") or "")
    elapsed = (time.time() - started_at) if started_at is not None else None
    user_input = _clock_note(elapsed, _bot_turn_number(history_messages)) + user_input
    if resumed_greeting:
        user_input = RESUME_NOTE + user_input
    if resumed_at_ms:
        logger.info("CLM: resumed call %s — restored %d earlier messages", parsed.get("chat_id"), len(prior))

    model_name = (config_doc.get("model_name") or "").lower()
    chunk_id = f"chatcmpl-{uuid.uuid4().hex}"
    # Opt-in only. Hume's CLM requests carry no query parameters, so a student can
    # never trip this; it exists so a failing voice bot can be diagnosed with one
    # curl instead of shell access to the container.
    want_debug = request.args.get("debug") == "1"

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
        diagnostics = None

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
            failure = _failure_diagnostics(e)
            failure["at"] = int(time.time())
            _LAST_FAILURES[config_id] = failure
            if want_debug:
                diagnostics = failure
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

        final_chunk = _openai_chunk(chunk_id, model_name, {}, finish_reason=finish)
        if diagnostics:
            final_chunk["debug"] = diagnostics
        yield _sse(final_chunk)
        yield "data: [DONE]\n\n"

    return Response(
        generate(),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no',
        },
    )
