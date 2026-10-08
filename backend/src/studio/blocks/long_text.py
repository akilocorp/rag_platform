# @language  Python
# @updated   2026-10-08
# @changed   Response validation: min_chars / max_chars (0 = no limit).
# Prior: New file: the Long Text block — multi-line paragraph response. Config shape is
#            identical to short_text; only the frontend's rendering differs (textarea vs input).
"""Long Text — a multi-line free-text (paragraph) question."""
from src.studio.blocks.base import block

# Mirrors routes/studio_routes.py's MAX_TEXT_ANSWER_CHARS — no limit a
# professor sets can exceed what the server will store anyway.
MAX_CHAR_LIMIT = 50000


def clean_char_limits(config):
    """{min_chars, max_chars} as non-negative ints, 0 meaning "no limit", with
    a max below the min dropped rather than making the question unanswerable.
    Shared with short_text.py."""
    def _int(key):
        try:
            return min(max(int(config.get(key) or 0), 0), MAX_CHAR_LIMIT)
        except (TypeError, ValueError):
            return 0
    min_chars, max_chars = _int("min_chars"), _int("max_chars")
    if max_chars and max_chars < min_chars:
        max_chars = 0
    return {"min_chars": min_chars, "max_chars": max_chars}


@block(
    block_type="long_text",
    label="Long Text",
    icon="paragraph",
    default_config={
        "question": "Untitled question", "placeholder": "",
        "min_chars": 0, "max_chars": 0, "required": False,
    },
)
def validate(config):
    return {
        "question": str(config.get("question") or "Untitled question"),
        "placeholder": str(config.get("placeholder") or ""),
        **clean_char_limits(config),
        "required": bool(config.get("required", False)),
    }
