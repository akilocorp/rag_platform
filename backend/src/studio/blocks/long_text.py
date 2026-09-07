# @language  Python
# @updated   2026-09-07
# @changed   New file: the Long Text block — multi-line paragraph response. Config shape is
#            identical to short_text; only the frontend's rendering differs (textarea vs input).
"""Long Text — a multi-line free-text (paragraph) question."""
from src.studio.blocks.base import block


@block(
    block_type="long_text",
    label="Long Text",
    icon="paragraph",
    default_config={"question": "Untitled question", "placeholder": "", "required": False},
)
def validate(config):
    return {
        "question": str(config.get("question") or "Untitled question"),
        "placeholder": str(config.get("placeholder") or ""),
        "required": bool(config.get("required", False)),
    }
