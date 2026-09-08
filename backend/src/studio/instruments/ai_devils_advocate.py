# @language  Python
# @updated   2026-09-08
# @changed   New file: the AI Devil's-Advocate instrument — Tier-3 (live, mid-session Claude call).
#            No compute(): the respondent's initial stance, the generated rebuttal, and their
#            post-rebuttal confidence rating are captured as `instrument_values` by the frontend
#            RespondExtra and read directly from the raw response data (a belief_shift metric would
#            need compute() to know which field is "before" vs "after" — simpler to just capture
#            both and let the professor read them).
"""AI Devil's-Advocate — Claude pushes back once on the respondent's stated position."""
from src.studio.instruments.base import instrument


@instrument(
    instrument_type="ai_devils_advocate",
    label="AI Devil's Advocate",
    icon="comments",
    kind="measurement",
    default_config={},
    applies_to=None,
    needs_events=False,
    is_ai=True,
)
def validate(config):
    return {}
