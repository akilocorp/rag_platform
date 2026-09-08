# @language  Python
# @updated   2026-09-08
# @changed   New file: the Subset Randomizer instrument — shows only `count` of a single_choice
#            block's options, randomly picked per respondent (Qualtrics' Randomize N of X). Distinct
#            from Option Randomizer, which reorders the full option list but keeps every option;
#            this one can also cut the list down. Entirely a frontend runner concern, same as Option
#            Randomizer — see StudioRunnerPage's applyBehaviorInstruments.
"""Subset Randomizer — shows only `count` of a single_choice block's options, picked per respondent."""
from src.studio.instruments.base import instrument

DEFAULT_COUNT = 2
MIN_COUNT = 1


@instrument(
    instrument_type="subset_randomizer",
    label="Subset Randomizer",
    icon="filter",
    kind="behavior",
    default_config={"count": DEFAULT_COUNT},
    applies_to=["single_choice"],
    needs_events=False,
)
def validate(config):
    try:
        count = int(config.get("count", DEFAULT_COUNT))
    except (TypeError, ValueError):
        count = DEFAULT_COUNT
    return {"count": max(count, MIN_COUNT)}
