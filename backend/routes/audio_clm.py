"""
Hume EVI Custom Language Model (CLM) bridge.

Hume EVI 3 sends OpenAI-shaped Chat Completions requests to a configurable
`custom_language_model_url`. This blueprint exposes that endpoint and bridges
each request into the existing agentic RAG pipeline (`stream_agentic_response`),
re-emitting tokens as OpenAI Chat Completion SSE deltas so EVI can TTS them.

Endpoint: POST /api/audio/clm/chat/completions

Request body (subset of OpenAI's schema, what Hume sends):
  {
    "model": "<ignored, we use the bot's configured model>",
    "messages": [
      {"role": "user"|"assistant"|"system", "content": "..."}, ...
    ],
    "stream": true,
    "custom_session_id": "<config_id>:<chat_id>:<user_id>",   # Hume session var
    ...other OpenAI fields ignored...
  }

Hume injects `custom_session_id` from the EVI config's session_settings, which
the frontend sets when opening the WebSocket. We parse it to route to the right
bot config and chat history.
"""
import json
import logging
import time
import uuid
from typing import Dict, Any, Iterator, List, Optional

from bson import ObjectId
from flask import Blueprint, Response, current_app, jsonify, request, stream_with_context

from src.agentic.agent_runner import stream_agentic_response
from src.agentic.tools.base import ToolContext

logger = logging.getLogger(__name__)
audio_clm_bp = Blueprint('audio_clm_routes', __name__)


def _parse_session_id(raw: Optional[str]) -> Dict[str, Optional[str]]:
    """`<config_id>:<chat_id>:<user_id>` — user_id may be 'anonymous' or absent."""
    if not raw:
        return {"config_id": None, "chat_id": None, "user_id": None}
    parts = raw.split(":")
    return {
        "config_id": parts[0] if len(parts) > 0 else None,
        "chat_id": parts[1] if len(parts) > 1 else None,
        "user_id": parts[2] if len(parts) > 2 else None,
    }


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

    parsed = _parse_session_id(session_id_raw)
    config_id = parsed["config_id"]
    user_id = parsed["user_id"] or "anonymous"

    if not config_id:
        return jsonify({"error": "Missing custom_session_id (expected '<config_id>:<chat_id>:<user_id>')"}), 400

    try:
        config_doc = current_app.config['MONGO_DB']['config_collections'].find_one(
            {"_id": ObjectId(config_id.strip())},
            {
                "model_name": 1, "temperature": 1, "prompt_template": 1,
                "is_public": 1, "user_id": 1,
                "web_access": 1, "audio_enabled": 1,
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

    ctx = ToolContext(
        user_id=user_id if user_id and user_id != "anonymous" else None,
        config_id=config_id,
        config=config_doc,
        variant='A',
        selected_file_ids=[],
    )

    model_name = (config_doc.get("model_name") or "claude-sonnet-4-5").lower()
    chunk_id = f"chatcmpl-{uuid.uuid4().hex}"

    @stream_with_context
    def generate() -> Iterator[str]:
        # Initial chunk: assistant role marker (OpenAI streaming convention).
        yield _sse(_openai_chunk(chunk_id, model_name, {"role": "assistant", "content": ""}))

        final_stop_reason = "end_turn"
        try:
            for event in stream_agentic_response(
                config=config_doc,
                user_input=user_input,
                history_messages=history_messages,
                ctx=ctx,
            ):
                etype = event.get("type")
                if etype == "token":
                    text = event.get("data") or ""
                    if text:
                        yield _sse(_openai_chunk(chunk_id, model_name, {"content": text}))
                elif etype == "done":
                    final_stop_reason = event.get("stop_reason") or "end_turn"
        except Exception as e:
            logger.error("CLM stream error: %s", e, exc_info=True)
            yield _sse(_openai_chunk(chunk_id, model_name, {"content": f"\n\n[Error: {e}]"}))

        finish = "stop" if final_stop_reason in ("end_turn", "stop") else "length"
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
