# @language  Python
# @updated   2026-09-07
# @changed   Phase 3: compute()'s signature changed from (events, value, config) to (answer, config),
#            where `answer` is the full per-block answer dict ({value, events?, instrument_values?}).
#            Reaction Timer only ever needed `events`; Confidence Slider's metric comes from
#            `instrument_values` instead — passing the whole dict lets each instrument pull whatever
#            it needs without the signature growing a new positional param per instrument.
#            Prior: New file: @instrument decorator + module-level registry, mirroring
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
    compute: Optional[Callable[[Dict[str, Any], Dict[str, Any]], Dict[str, Any]]] = None,
):
    """Register an instrument type.

    The decorated function is the config validator: signature (config: dict)
    -> dict, same contract as @block's validator.

    `applies_to` — None means any block type; else a list of block `type`
    strings this instrument may be attached to.
    `needs_events` — if True, the frontend runner tracks shown/submit
    timestamps for any block carrying this instrument. This drives client-side
    behavior too (e.g. Read-Time Gate needs "shown" locally to gate Submit)
    even when nothing server-side reads the events — it's not exclusively a
    "does compute() need this" flag.
    `compute(answer, config) -> dict` — optional; derives a metric from a
    single response's full answer dict ({value, events?, instrument_values?})
    for the results view. Measurement instruments normally supply this;
    behavior ones usually won't need to (nothing to compute).
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
