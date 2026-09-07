# @language  Python
# @updated   2026-09-07
# @changed   New file: the Single Choice block — one selectable option from a fixed list
#            (radio buttons; a yes/no question is just this with two options).
"""Single Choice — pick exactly one option from a fixed list (radio buttons)."""
from src.studio.blocks.base import block

_DEFAULT_OPTIONS = ["Option 1", "Option 2"]


@block(
    block_type="single_choice",
    label="Single Choice",
    icon="radio",
    default_config={"question": "Untitled question", "options": list(_DEFAULT_OPTIONS), "required": False},
)
def validate(config):
    options = config.get("options")
    if not isinstance(options, list):
        options = []
    cleaned = [str(o).strip() for o in options if str(o).strip()]
    return {
        "question": str(config.get("question") or "Untitled question"),
        "options": cleaned or list(_DEFAULT_OPTIONS),
        "required": bool(config.get("required", False)),
    }
