"""Public registry API for assignment-type presets.

Importing this module triggers preset discovery (via `rubrics/__init__.py`).
Mirrors `src/agentic/registry.py`.
"""
import copy
import logging
from typing import Any, Dict, List, Optional

from src.video.rubrics import base
from src.video import rubrics  # noqa: F401  side-effect: discovers all presets

logger = logging.getLogger(__name__)


def list_presets() -> List[Dict[str, Any]]:
    """All presets, for the wizard dropdown. Includes the default scoring_spec
    so the frontend can pre-fill the editable panel without a second call."""
    return [
        {
            "key": key,
            "label": p["label"],
            "description": p.get("description", ""),
            "scoring_spec": copy.deepcopy(p["scoring_spec"]),
        }
        for key, p in base.ASSIGNMENT_PRESETS.items()
    ]


def get_preset(key: str) -> Optional[Dict[str, Any]]:
    p = base.ASSIGNMENT_PRESETS.get(key)
    return copy.deepcopy(p) if p else None


def get_preset_keys() -> List[str]:
    return list(base.ASSIGNMENT_PRESETS.keys())


def get_default_spec(key: str) -> Dict[str, Any]:
    """The preset's scoring_spec if known, else the generic default. Used as a
    backward-compat fallback when a config predates the scoring_spec field."""
    p = base.ASSIGNMENT_PRESETS.get(key)
    if p:
        return copy.deepcopy(p["scoring_spec"])
    return base.default_scoring_spec()
