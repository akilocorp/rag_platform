"""
Public registry API over the discovered widgets. Importing this module triggers
widget discovery (via the `widgets` package `__init__`).
"""
from typing import Any, Dict, List, Optional

from src.facilitator.base import WIDGETS
from src.facilitator import widgets as _widgets  # noqa: F401 — import triggers discovery

# Fields safe to expose to the facilitator prompt (everything except the callable).
_CATALOG_FIELDS = ("id", "label", "description", "when_to_use", "data_schema", "interactive")


def get_widget(widget_id: str) -> Optional[Dict[str, Any]]:
    return WIDGETS.get(widget_id)


def get_catalog(allowed: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """The menu of widgets, optionally restricted to `allowed` ids (order-preserving)."""
    ids = allowed if allowed else list(WIDGETS.keys())
    catalog = []
    for wid in ids:
        w = WIDGETS.get(wid)
        if w:
            catalog.append({k: w[k] for k in _CATALOG_FIELDS})
    return catalog


def validate(widget_id: str, data: Any) -> Optional[Dict[str, Any]]:
    """Run a widget's validator over `data`; returns cleaned data or None."""
    w = WIDGETS.get(widget_id)
    if not w:
        return None
    try:
        return w["validate"](data)
    except Exception:  # noqa: BLE001 — a bad validator must never break a chat turn
        return None
