# @language  Python
# @updated   2026-09-07
# @changed   Phase 2: extended with the instrument registry API (get_instrument_specs,
#            validate_instrument_config, compute_instrument_metric) rather than creating a second
#            top-level registry file — this module is "the Studio registry," not specifically
#            "the block registry," so instruments belong here alongside blocks.
#            Prior: New file: public registry API for Studio blocks, mirroring src/agentic/registry.py.
"""
Public registry API used by routes/studio_routes.py, for both blocks and instruments.

Importing this module triggers discovery of both (via `blocks/__init__.py`
and `instruments/__init__.py`), which import every block/instrument file and
run their `@block`/`@instrument` decorators.
"""
import logging
from typing import Any, Dict, List

from src.studio.blocks import base as block_base
from src.studio import blocks  # noqa: F401  side-effect: discovers all blocks
from src.studio.instruments import base as instrument_base
from src.studio import instruments  # noqa: F401  side-effect: discovers all instruments

logger = logging.getLogger(__name__)


# --- Blocks -----------------------------------------------------------------

def get_block_specs() -> List[Dict[str, Any]]:
    """{type, label, icon, default_config} for every registered block — feeds the builder ribbon."""
    return [b["spec"] for b in block_base.BLOCKS.values()]


def validate_block_config(block_type: str, config: Dict[str, Any]) -> Dict[str, Any]:
    """Coerce/validate a block's config. Raises KeyError if block_type is unknown."""
    if block_type not in block_base.BLOCKS:
        raise KeyError(f"Unknown block type: {block_type}")
    return block_base.BLOCKS[block_type]["validate"](config or {})


# --- Instruments --------------------------------------------------------------

def get_instrument_specs() -> List[Dict[str, Any]]:
    """{type, label, icon, kind, applies_to, needs_events, default_config} for every
    registered instrument — feeds the builder's Instruments ribbon tab."""
    return [i["spec"] for i in instrument_base.INSTRUMENTS.values()]


def validate_instrument_config(instrument_type: str, block_type: str, config: Dict[str, Any]) -> Dict[str, Any]:
    """Coerce/validate an instrument's config for use on a specific block type.

    Raises KeyError if instrument_type is unknown, ValueError if this
    instrument can't be attached to that block_type.
    """
    if instrument_type not in instrument_base.INSTRUMENTS:
        raise KeyError(f"Unknown instrument type: {instrument_type}")
    spec = instrument_base.INSTRUMENTS[instrument_type]["spec"]
    applies_to = spec["applies_to"]
    if applies_to is not None and block_type not in applies_to:
        raise ValueError(
            f"instrument '{instrument_type}' cannot be attached to block type '{block_type}'"
        )
    return instrument_base.INSTRUMENTS[instrument_type]["validate"](config or {})


def instrument_needs_events(instrument_type: str) -> bool:
    """Whether the frontend runner should capture shown/submit timestamps for
    a block carrying this instrument. Used to enrich the PUBLIC project view
    (routes/studio_routes.py's _public_project_view) — an anonymous
    respondent's browser has no access to the faculty-scoped instrument-specs
    endpoint, so this one bit of registry knowledge has to ride along on the
    project payload itself instead.
    """
    inst = instrument_base.INSTRUMENTS.get(instrument_type)
    return bool(inst and inst["spec"].get("needs_events"))


def compute_instrument_metric(instrument_type: str, answer: Dict[str, Any], config: Dict[str, Any]) -> Dict[str, Any]:
    """Derive a results-view metric for one response's answer.

    `answer` is the full per-block answer dict ({value, events?,
    instrument_values?}) — passed whole so each instrument's compute() can
    pull whatever it needs (Reaction Timer reads `events`, Confidence Slider
    reads `instrument_values`) without this function knowing instrument-
    specific shapes.

    Returns {} if the instrument has no compute() (e.g. a behavior-only
    instrument), if it's unknown, or if computation fails for any reason —
    this must never break the responses/export endpoints just because one
    instrument's data looks unexpected.
    """
    inst = instrument_base.INSTRUMENTS.get(instrument_type)
    if not inst or not inst.get("compute"):
        return {}
    try:
        return inst["compute"](answer or {}, config or {}) or {}
    except Exception:
        logger.warning("compute() failed for instrument '%s'", instrument_type, exc_info=True)
        return {}
