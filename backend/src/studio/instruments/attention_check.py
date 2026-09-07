# @language  Python
# @updated   2026-09-07
# @changed   New file: the Attention Check instrument. Deliberately never blocks or flags anything
#            to the respondent — a real attention check has to let a low-effort respondent submit
#            normally, or letting them retry until they pick the "right" answer defeats the entire
#            point of using it as a data-quality signal. It only ever shows up after the fact, as a
#            `passed` metric in the results view, for the professor to filter on.
"""Attention Check — flags (never blocks) whether a single_choice answer matches the expected one."""
from src.studio.instruments.base import instrument


def _compute(answer, config):
    expected = config.get("expected_option")
    if not expected:
        return {}
    return {"passed": answer.get("value") == expected}


@instrument(
    instrument_type="attention_check",
    label="Attention Check",
    icon="shield",
    kind="behavior",
    default_config={"expected_option": ""},
    applies_to=["single_choice"],
    needs_events=False,
    compute=_compute,
)
def validate(config):
    return {"expected_option": str(config.get("expected_option") or "")}
