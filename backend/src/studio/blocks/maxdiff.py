# @language  Python
# @updated   2026-09-09
# @changed   Now multi-round: `num_rounds` config field, respondent works through that many
#            independently-shuffled subsets (frontend rotates rounds client-side, same pattern the
#            facilitator chat's flashcard widget uses for advancing between cards — key-remount +
#            entrance animation on each new round). Each round is sampled independently (fresh
#            shuffle, not a balanced-incomplete-block design), so an option can repeat across
#            rounds — a real experimental-design MaxDiff would guarantee even coverage; this
#            doesn't, and is documented as such rather than overclaimed. The answer value is now an
#            array of per-round `{options, most, least}` results instead of a single `{most,
#            least}` — see MaxDiffBlock.jsx.
#            Prior: New file: the MaxDiff block — a single-trial best/worst scaling question (pick the
#            most and least preferred of a subset). Real MaxDiff studies rotate a respondent through
#            several subset trials across multiple screens; Studio only has one page of blocks
#            today, so this is deliberately the single-trial variant, not full multi-round MaxDiff.
"""MaxDiff — pick the most and least preferred option, across several independently-sampled rounds."""
from src.studio.blocks.base import block

_DEFAULT_OPTIONS = ["Option 1", "Option 2", "Option 3", "Option 4"]
DEFAULT_SUBSET_SIZE = 4
DEFAULT_NUM_ROUNDS = 3
MAX_NUM_ROUNDS = 10


@block(
    block_type="maxdiff",
    label="MaxDiff (Best/Worst)",
    icon="exchange",
    default_config={
        "question": "Which do you prefer most, and least?",
        "options": list(_DEFAULT_OPTIONS),
        "subset_size": DEFAULT_SUBSET_SIZE,
        "num_rounds": DEFAULT_NUM_ROUNDS,
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
    try:
        num_rounds = int(config.get("num_rounds", DEFAULT_NUM_ROUNDS))
    except (TypeError, ValueError):
        num_rounds = DEFAULT_NUM_ROUNDS
    num_rounds = min(max(num_rounds, 1), MAX_NUM_ROUNDS)
    return {
        "question": str(config.get("question") or "Which do you prefer most, and least?"),
        "options": cleaned,
        "subset_size": subset_size,
        "num_rounds": num_rounds,
        "required": bool(config.get("required", False)),
    }
