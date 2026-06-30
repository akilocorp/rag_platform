"""
Public registry API for pedagogical methods, used by the experiential routes.

Importing this module triggers method discovery (via `methods/__init__.py`),
which imports every method file and runs its `method(...)` registration.
"""
from typing import Any, Dict, List, Optional

from src.experiential.methods import base
from src.experiential import methods  # noqa: F401  side-effect: discovers all methods

# The method used when the client sends an unknown / missing id.
DEFAULT_METHOD_ID = 'generic'


def list_methods() -> List[Dict[str, str]]:
    """Method metadata for the professor's picker (no system prompt)."""
    return [
        {
            'id': m.id,
            'label': m.label,
            'description': m.description,
            'prompt_hint': m.prompt_hint,
        }
        for m in base.METHODS.values()
    ]


def get_method(method_id: str) -> Optional[base.Method]:
    return base.METHODS.get(method_id)


def get_system_prompt(method_id: str) -> str:
    """Resolve a method id to its spine prompt, falling back to the default."""
    m = base.METHODS.get(method_id) or base.METHODS.get(DEFAULT_METHOD_ID)
    return m.system_prompt if m else ''


def get_schema(method_id: str) -> str:
    """The frontend method id (validator + player) a generated lab should use.

    Stamped onto the lab as config.method so the player page mounts the right
    pedagogy. Falls back to the default method's schema.
    """
    m = base.METHODS.get(method_id) or base.METHODS.get(DEFAULT_METHOD_ID)
    return (m.schema if m else None) or 'predict-reveal'
