# @language  Python
# @updated   2026-09-08
# @changed   New file: the Speeder Flag instrument — Read-Time Gate's soft, measurement-only
#            sibling. Never blocks Submit; just flags in the results view when a respondent
#            answered faster than `threshold_seconds`. Reads the same shown/submit event pair
#            Reaction Timer already reads (needs_events=True) and compares the latency against a
#            threshold instead of just reporting the raw number.
"""Speeder Flag — flags (never blocks) an answer submitted unusually fast."""
from src.studio.instruments.base import instrument

DEFAULT_THRESHOLD = 3
MIN_THRESHOLD = 1
MAX_THRESHOLD = 120


def _compute(answer, config):
    events = answer.get("events") or []
    shown_at = next((e.get("at") for e in events if e.get("type") == "shown"), None)
    submit_at = next((e.get("at") for e in events if e.get("type") == "submit"), None)
    if shown_at is None or submit_at is None:
        return {}
    latency_ms = submit_at - shown_at
    threshold_ms = config.get("threshold_seconds", DEFAULT_THRESHOLD) * 1000
    return {"latency_ms": round(latency_ms), "is_speeder": latency_ms < threshold_ms}


@instrument(
    instrument_type="speeder_flag",
    label="Speeder Flag",
    icon="tachometer",
    kind="measurement",
    default_config={"threshold_seconds": DEFAULT_THRESHOLD},
    applies_to=None,
    needs_events=True,
    compute=_compute,
)
def validate(config):
    try:
        threshold = int(config.get("threshold_seconds", DEFAULT_THRESHOLD))
    except (TypeError, ValueError):
        threshold = DEFAULT_THRESHOLD
    return {"threshold_seconds": min(max(threshold, MIN_THRESHOLD), MAX_THRESHOLD)}
