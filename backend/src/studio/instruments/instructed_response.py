# @language  Python
# @updated   2026-09-08
# @changed   New file: the Instructed Response Item instrument — a Qualtrics-inspired data-quality
#            check. Unlike Attention Check (the professor hand-writes the trap into its own,
#            unrelated question), this one auto-appends its own instruction sentence onto an
#            *existing* question's text at render time (StudioRunnerPage's applyBehaviorInstruments),
#            so the trap sits seamlessly inside a real battery item instead of standing out as its
#            own question. Same never-blocks, flag-only-in-results contract as Attention Check —
#            see that file for why a real attention-check instrument must never gate submission.
"""Instructed Response Item — appends "please select X" to a question's text, flags compliance."""
from src.studio.instruments.base import instrument

DEFAULT_INSTRUCTION = "For quality purposes, please select this option."


def _compute(answer, config):
    expected = config.get("expected_option")
    if not expected:
        return {}
    return {"passed": answer.get("value") == expected}


@instrument(
    instrument_type="instructed_response",
    label="Instructed Response",
    icon="clipboard-check",
    kind="behavior",
    default_config={"expected_option": "", "instruction_text": DEFAULT_INSTRUCTION},
    applies_to=["single_choice"],
    needs_events=False,
    compute=_compute,
)
def validate(config):
    return {
        "expected_option": str(config.get("expected_option") or ""),
        "instruction_text": str(config.get("instruction_text") or DEFAULT_INSTRUCTION),
    }
