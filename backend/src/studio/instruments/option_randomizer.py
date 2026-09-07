# @language  Python
# @updated   2026-09-07
# @changed   New file: the Option Randomizer instrument — a behavior instrument that shuffles a
#            choice block's option order per respondent (controls for order effects). Only applies
#            to single_choice: yes_no's two options are hardcoded in its frontend component rather
#            than stored in config, so there's nothing there to shuffle. Entirely a frontend runner
#            concern (StudioRunnerPage seeds a deterministic shuffle from respondent+block id, so
#            it's stable across reloads); no server-side behavior beyond the applies_to gate.
"""Option Randomizer — shuffles a single_choice block's option order per respondent."""
from src.studio.instruments.base import instrument


@instrument(
    instrument_type="option_randomizer",
    label="Option Randomizer",
    icon="shuffle",
    kind="behavior",
    default_config={},
    applies_to=["single_choice"],
    needs_events=False,
)
def validate(config):
    return {}
