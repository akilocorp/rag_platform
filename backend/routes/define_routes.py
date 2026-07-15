# @language  Python
# @updated   2026-07-15
# @changed   New context-aware dictionary endpoint: one non-circular sense per word.

import os

from flask import Blueprint, request, jsonify, current_app

define_bp = Blueprint('define_routes', __name__)

# Model kept intentionally small/fast — a hover lookup must feel instant and is a
# trivial single-word task. Haiku is the right tier here (not Opus).
_DEFINE_MODEL = "claude-haiku-4-5"

# The response is constrained to this shape so the frontend never has to parse
# prose. `part_of_speech` may be empty; `definition` is always the single sense
# that fits the sentence the word was hovered in.
_DEFINE_SCHEMA = {
    "type": "object",
    "properties": {
        "part_of_speech": {"type": "string"},
        "definition": {"type": "string"},
    },
    "required": ["part_of_speech", "definition"],
    "additionalProperties": False,
}

_SYSTEM_PROMPT = (
    "You are a precise dictionary. You are given a WORD and the SENTENCE it "
    "appears in. Return exactly one definition — the single sense that fits "
    "that sentence's context, not a list of every meaning.\n"
    "Rules:\n"
    "- Never give a circular definition. Do not define the word using the word "
    "itself or any word sharing its root. For example, define \"refusal\" as "
    "\"a firm rejection of something offered or requested\", never \"the act of "
    "refusing\".\n"
    "- Keep it to one clear sentence in plain language a student would "
    "understand.\n"
    "- part_of_speech is the part of speech as used in this sentence (e.g. "
    "\"verb\", \"noun\", \"adjective\"); use an empty string if genuinely unclear."
)


@define_bp.route('/define', methods=['POST'])
def define_word():
    """Context-aware single-sense definition for the hover popover.

    Takes {word, sentence}, asks Claude for the one meaning that fits the
    sentence, and returns {word, part_of_speech, definition}. On any
    misconfiguration or model failure it returns 503 so the frontend can fall
    back to its free-dictionary path — this endpoint is best-effort, never
    load-bearing.
    """
    data = request.json or {}
    word = (data.get('word') or '').strip()
    sentence = (data.get('sentence') or '').strip()

    if not word:
        return jsonify({"error": "word is required"}), 400

    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        return jsonify({"error": "definition service unavailable"}), 503

    try:
        import anthropic
    except ImportError:
        current_app.logger.error("anthropic SDK not installed — /api/define unavailable")
        return jsonify({"error": "definition service unavailable"}), 503

    # Cap the context so a stray huge paragraph can't blow up the prompt; the
    # sentence around the word is all the model needs to disambiguate.
    context = sentence[:600] if sentence else "(no surrounding sentence provided)"
    user_content = f"WORD: {word}\nSENTENCE: {context}"

    try:
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(
            model=_DEFINE_MODEL,
            max_tokens=256,
            system=_SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_content}],
            output_config={"format": {"type": "json_schema", "schema": _DEFINE_SCHEMA}},
        )
    except Exception as e:
        current_app.logger.error(f"/api/define model call failed: {e}", exc_info=True)
        return jsonify({"error": "definition lookup failed"}), 503

    # output_config.format guarantees the first text block is schema-valid JSON.
    import json
    text = next((b.text for b in response.content if b.type == "text"), "")
    try:
        parsed = json.loads(text)
    except (json.JSONDecodeError, TypeError):
        return jsonify({"error": "definition lookup failed"}), 503

    return jsonify({
        "word": word,
        "part_of_speech": parsed.get("part_of_speech", ""),
        "definition": parsed.get("definition", ""),
    }), 200
