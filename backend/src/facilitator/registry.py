# @language  Python
# @updated   2026-08-10
# @changed   Added `to_transcript(widget_id, data)` — renders a stored widget block back to text for history
#            replay, with a generic fallback for widgets that don't define their own.
"""
Public registry API over the discovered widgets. Importing this module triggers
widget discovery (via the `widgets` package `__init__`).
"""
from typing import Any, Dict, List, Optional

from src.facilitator.base import WIDGETS
from src.facilitator import widgets as _widgets  # noqa: F401 — import triggers discovery

# Fields safe to expose to the facilitator prompt (everything except the callables).
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


def to_transcript(widget_id: str, data: Any) -> Optional[str]:
    """Render a stored widget block as text for the model's history.

    A widget is drawn from `additional_kwargs`, so without this the model has no
    record that it ever put a question on screen and reads the user's answer as
    an unrelated new query. Widgets that declare their own `to_transcript` get a
    faithful rendering; the rest fall back to a line naming what was shown, which
    is enough for display-only widgets. Never raises — history must always load.
    """
    w = WIDGETS.get(widget_id)
    if not w or not isinstance(data, dict):
        return None
    hook = w.get("to_transcript")
    if hook:
        try:
            rendered = hook(data)
        except Exception:  # noqa: BLE001 — a bad renderer must never break history
            rendered = None
        if rendered and str(rendered).strip():
            return str(rendered).strip()
    return f"[A {w['label'].lower()} was displayed to the user.]"
