# @language  Python
# @updated   2026-09-07
# @changed   New file: the Reaction Timer instrument — the flagship example from the original
#            product brainstorm (response latency as a confidence proxy). First instrument built,
#            deliberately alone in this phase to prove the architecture before Phase 3 adds more.
"""Reaction Timer — records ms from when a block was shown to when it was submitted.

Applies to any block type. Timestamps arrive from the frontend as
performance.now() values (ms, monotonic, not wall-clock) — a straight
subtraction is the latency, no unit conversion needed.
"""
from src.studio.instruments.base import instrument


def _compute(events, value, config):
    shown_at = next((e.get("at") for e in (events or []) if e.get("type") == "shown"), None)
    submit_at = next((e.get("at") for e in (events or []) if e.get("type") == "submit"), None)
    if shown_at is None or submit_at is None:
        return {}
    return {"latency_ms": round(submit_at - shown_at)}


@instrument(
    instrument_type="reaction_timer",
    label="Reaction Timer",
    icon="stopwatch",
    kind="measurement",
    default_config={},
    applies_to=None,
    needs_events=True,
    compute=_compute,
)
def validate(config):
    return {}
