# @language  Python
# @updated   2026-09-08
# @changed   New file: the Constant Sum block — Qualtrics' Constant Sum, respondent allocates a
#            fixed budget (`total`) across every option. Note: the sum-equals-total constraint is
#            enforced client-side only (live running-total feedback in the block itself) — there's
#            no page-level mechanism today for a block to fail Submit beyond the generic "required"
#            check, so a respondent can still submit an under/over allocation. Documented rather
#            than silently pretended-away; tightening this is future work if it turns out to matter.
"""Constant Sum — allocate a fixed total across every option."""
from src.studio.blocks.base import block

_DEFAULT_OPTIONS = ["Option 1", "Option 2"]
DEFAULT_TOTAL = 100


@block(
    block_type="constant_sum",
    label="Constant Sum",
    icon="coins",
    default_config={
        "question": "Untitled question",
        "options": list(_DEFAULT_OPTIONS),
        "total": DEFAULT_TOTAL,
        "required": False,
    },
)
def validate(config):
    options = config.get("options")
    if not isinstance(options, list):
        options = []
    cleaned = [str(o).strip() for o in options if str(o).strip()]
    try:
        total = int(config.get("total", DEFAULT_TOTAL))
    except (TypeError, ValueError):
        total = DEFAULT_TOTAL
    total = min(max(total, 1), 1000)
    return {
        "question": str(config.get("question") or "Untitled question"),
        "options": cleaned or list(_DEFAULT_OPTIONS),
        "total": total,
        "required": bool(config.get("required", False)),
    }
