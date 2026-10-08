# @language  Python
# @updated   2026-10-08
# @changed   Added `layout` (vertical | horizontal) and `allow_other` ("Other, please specify").
# Prior: New file: the Single Choice block — one selectable option from a fixed list
#            (radio buttons; a yes/no question is just this with two options).
"""Single Choice — pick exactly one option from a fixed list (radio buttons)."""
from src.studio.blocks.base import block

_DEFAULT_OPTIONS = ["Option 1", "Option 2"]
_LAYOUTS = ("vertical", "horizontal")


@block(
    block_type="single_choice",
    label="Single Choice",
    icon="radio",
    default_config={
        "question": "Untitled question", "options": list(_DEFAULT_OPTIONS),
        "layout": "vertical", "allow_other": False, "required": False,
    },
)
def validate(config):
    options = config.get("options")
    if not isinstance(options, list):
        options = []
    cleaned = [str(o).strip() for o in options if str(o).strip()]
    return {
        "question": str(config.get("question") or "Untitled question"),
        "options": cleaned or list(_DEFAULT_OPTIONS),
        "layout": config.get("layout") if config.get("layout") in _LAYOUTS else "vertical",
        "allow_other": bool(config.get("allow_other", False)),
        "required": bool(config.get("required", False)),
    }
