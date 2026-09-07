# @language  Python
# @updated   2026-09-07
# @changed   New file: the Short Text block — single-line free-text response.
"""Short Text — a single-line free-text question."""
from src.studio.blocks.base import block


@block(
    block_type="short_text",
    label="Short Text",
    icon="text",
    default_config={"question": "Untitled question", "placeholder": "", "required": False},
)
def validate(config):
    return {
        "question": str(config.get("question") or "Untitled question"),
        "placeholder": str(config.get("placeholder") or ""),
        "required": bool(config.get("required", False)),
    }
