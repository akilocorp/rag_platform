# @language  Python
# @updated   2026-09-07
# @changed   New file: the Yes/No block — a dedicated two-option question rather than making
#            professors configure single_choice with two hardcoded options every time.
"""Yes/No — a constrained binary question. Answer is the literal string "Yes" or "No"."""
from src.studio.blocks.base import block


@block(
    block_type="yes_no",
    label="Yes / No",
    icon="toggle",
    default_config={"question": "Untitled question", "required": False},
)
def validate(config):
    return {
        "question": str(config.get("question") or "Untitled question"),
        "required": bool(config.get("required", False)),
    }
