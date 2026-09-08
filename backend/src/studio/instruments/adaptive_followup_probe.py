# @language  Python
# @updated   2026-09-08
# @changed   New file: the Adaptive Follow-Up Probe instrument — Tier-3 (live, mid-session Claude
#            call). No compute(): the generated follow-up question and the respondent's answer to it
#            are captured as `instrument_values` and read directly from the raw response data.
#            The generated question isn't a real Studio block — Studio's page/block list is
#            professor-authored and static, there's no mechanism for a respondent-specific block to
#            exist — so it lives entirely inside this instrument's own RespondExtra UI instead.
"""Adaptive Follow-Up Probe — Claude generates one bespoke follow-up to what the respondent said."""
from src.studio.instruments.base import instrument


@instrument(
    instrument_type="adaptive_followup_probe",
    label="Adaptive Follow-Up",
    icon="search-plus",
    kind="measurement",
    default_config={},
    applies_to=None,
    needs_events=False,
    is_ai=True,
)
def validate(config):
    return {}
