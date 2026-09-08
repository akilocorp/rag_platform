# @language  Python
# @updated   2026-09-08
# @changed   New file: the Comprehension-Paraphrase Check instrument — Tier-3 (live, mid-session
#            Claude call via routes/studio_routes.py's /ai-instrument endpoint + src/studio/live_ai.py,
#            not a results-time compute()). No compute() here: the respondent's paraphrase and its
#            fidelity score are captured as `instrument_values` by the frontend RespondExtra (same
#            mechanism Confidence Slider already uses for a secondary value), and read directly from
#            the raw response data — nothing to derive from it after the fact.
#            Original research framing was "scores fidelity before advancing," but Studio is a
#            single-page form with no per-block advancement gate to hook into (only Read-Time Gate's
#            specific Submit-countdown exists) — this shows feedback but doesn't block Submit,
#            matching Attention Check's "never blocks" philosophy instead.
"""Comprehension-Paraphrase Check — respondent restates the question; Claude scores fidelity."""
from src.studio.instruments.base import instrument


@instrument(
    instrument_type="comprehension_paraphrase_check",
    label="Comprehension Check",
    icon="question-circle",
    kind="measurement",
    default_config={},
    applies_to=None,
    needs_events=False,
    is_ai=True,
)
def validate(config):
    return {}
