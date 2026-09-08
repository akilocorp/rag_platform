# @language  Python
# @updated   2026-09-08
# @changed   New file: the MaxDiff block — a single-trial best/worst scaling question (pick the
#            most and least preferred of a subset). Real MaxDiff studies rotate a respondent through
#            several subset trials across multiple screens; Studio only has one page of blocks
#            today, so this is deliberately the single-trial variant, not full multi-round MaxDiff.
#            Documented here rather than overclaimed.
"""MaxDiff (single trial) — pick the most and least preferred option from a subset."""
from src.studio.blocks.base import block

_DEFAULT_OPTIONS = ["Option 1", "Option 2", "Option 3", "Option 4"]
DEFAULT_SUBSET_SIZE = 4


@block(
    block_type="maxdiff",
    label="MaxDiff (Best/Worst)",
    icon="exchange",
    default_config={
        "question": "Which do you prefer most, and least?",
        "options": list(_DEFAULT_OPTIONS),
        "subset_size": DEFAULT_SUBSET_SIZE,
        "required": False,
    },
)
def validate(config):
    options = config.get("options")
    if not isinstance(options, list):
        options = []
    cleaned = [str(o).strip() for o in options if str(o).strip()]
    if not cleaned:
        cleaned = list(_DEFAULT_OPTIONS)
    try:
        subset_size = int(config.get("subset_size", DEFAULT_SUBSET_SIZE))
    except (TypeError, ValueError):
        subset_size = DEFAULT_SUBSET_SIZE
    subset_size = min(max(subset_size, 2), len(cleaned))
    return {
        "question": str(config.get("question") or "Which do you prefer most, and least?"),
        "options": cleaned,
        "subset_size": subset_size,
        "required": bool(config.get("required", False)),
    }
