# @language  Python
# @updated   2026-09-08
# @changed   New file: the Forced Rank Order block — Qualtrics' Rank Order, respondent must order
#            every option rather than rate each independently. Config mirrors single_choice's
#            options list/cleaning exactly; the answer shape (a full permutation array) is enforced
#            frontend-side only, same trust model as every other block here.
"""Forced Rank Order — the respondent orders every option from most to least preferred."""
from src.studio.blocks.base import block

_DEFAULT_OPTIONS = ["Option 1", "Option 2", "Option 3"]


@block(
    block_type="forced_rank",
    label="Forced Rank Order",
    icon="list-ol",
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
