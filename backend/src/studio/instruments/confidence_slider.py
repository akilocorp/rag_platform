# @language  Python
# @updated   2026-09-07
# @changed   New file: the Confidence Slider instrument — the first "renders its own UI and
#            captures its own value" instrument (vs. Reaction Timer's purely passive event
#            reading). Its value lives in the answer's `instrument_values`, not `value`/`events`,
#            since it's a secondary rating alongside the block's real answer, not derived from it.
"""Confidence Slider — a 0-100 "how sure are you?" rating alongside any block's own answer."""
from src.studio.instruments.base import instrument


def _compute(answer, config):
    val = (answer.get("instrument_values") or {}).get("confidence_slider")
    if val is None:
        return {}
    return {"confidence": val}


@instrument(
    instrument_type="confidence_slider",
    label="Confidence Slider",
    icon="slider",
    kind="measurement",
    default_config={},
    applies_to=None,
    needs_events=False,
    compute=_compute,
)
def validate(config):
    return {}
