# @language  Python
# @updated   2026-09-07
# @changed   New file: @instrument decorator + module-level registry, mirroring
#            src/studio/blocks/base.py's @block pattern (itself mirroring
#            src/agentic/tools/base.py's @tool pattern).
"""
Instrument primitives — `@instrument` decorator + the module-level registry
dict that decorators populate. An "instrument" is something a faculty member
attaches to a block to measure or modify how a respondent interacts with it
(a reaction timer, eventually a randomizer, a read-time gate, ...).

Two kinds:
  "measurement" — passively records something from the block's event log
                  (shown/focus/blur/change/submit timestamps) and reports a
                  computed metric in the results view. Never changes what the
                  respondent sees. Reaction Timer is the first of these.
  "behavior"    — changes how the block behaves for the respondent (a
                  countdown, randomized option order, a required dwell time).
                  Not used yet — Phase 3 territory — but the field exists now
                  so measurement instruments don't need a schema migration
                  when behavior ones arrive.

Adding an instrument = drop a .py file in this folder that calls
`@instrument(...)` on a config-validation function. No edits to this file or
to registry.py needed — see __init__.py.
"""
from typing import Any, Callable, Dict, List, Optional

# type -> {"validate", "compute", "spec"}
INSTRUMENTS: Dict[str, Dict[str, Any]] = {}


def instrument(
    instrument_type: str,
    label: str,
    icon: str,
    kind: str,
    default_config: Dict[str, Any],
    applies_to: Optional[List[str]] = None,
    needs_events: bool = False,
    compute: Optional[Callable[[Any, Any, Dict[str, Any]], Dict[str, Any]]] = None,
):
    """Register an instrument type.

    The decorated function is the config validator: signature (config: dict)
    -> dict, same contract as @block's validator.

    `applies_to` — None means any block type; else a list of block `type`
    strings this instrument may be attached to.
    `needs_events` — if True, the frontend runner records shown/focus/blur/
    submit timestamps for any block carrying this instrument.
    `compute(events, value, config) -> dict` — optional; derives a metric
    from a single response's event log + submitted value, for the results
    view. Measurement instruments normally supply this; behavior ones
    usually won't need to (nothing to compute).
    """
    def wrap(fn: Callable[[Dict[str, Any]], Dict[str, Any]]):
        if instrument_type in INSTRUMENTS:
            raise ValueError(
                f"Instrument type collision: '{instrument_type}' is already registered by "
                f"{INSTRUMENTS[instrument_type]['validate'].__module__}"
            )
        INSTRUMENTS[instrument_type] = {
            "validate": fn,
            "compute": compute,
            "spec": {
                "type": instrument_type,
                "label": label,
                "icon": icon,
                "kind": kind,
                "applies_to": applies_to,
                "needs_events": needs_events,
                "default_config": default_config,
            },
        }
        return fn

    return wrap
