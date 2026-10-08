# @language  Python
# @updated   2026-10-08
# @changed   Response validation: min_chars / max_chars (0 = no limit) and an input format (any | number | email).
# Prior: New file: the Short Text block — single-line free-text response.
"""Short Text — a single-line free-text question."""
from src.studio.blocks.base import block
from src.studio.blocks.long_text import clean_char_limits

_FORMATS = ("any", "number", "email")


@block(
    block_type="short_text",
    label="Short Text",
    icon="text",
    default_config={
        "question": "Untitled question", "placeholder": "", "input_format": "any",
        "min_chars": 0, "max_chars": 0, "required": False,
    },
)
def validate(config):
    return {
        "question": str(config.get("question") or "Untitled question"),
        "placeholder": str(config.get("placeholder") or ""),
        "input_format": config.get("input_format") if config.get("input_format") in _FORMATS else "any",
        **clean_char_limits(config),
        "required": bool(config.get("required", False)),
    }
