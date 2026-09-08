# @language  Python
# @updated   2026-09-08
# @changed   Added `is_ai` flag to @block for the studio-wide AI badge/visual paywall lock.
# Prior: New file: @block decorator + module-level registry, mirroring
#            src/agentic/tools/base.py's @tool pattern. Studio (faculty research-project
#            builder) Phase 0 — see backend/routes/studio_routes.py for the CRUD API this feeds.
"""
Block primitives — `@block` decorator + the module-level registry dict that
decorators populate. A "block" is one question/content type a faculty member
can drop onto a Studio canvas (short text, single choice, ...).

Adding a block = drop a .py file in this folder that calls `@block(...)` on a
config-validation function. No edits to this file or to registry.py needed —
see __init__.py.
"""
from typing import Any, Callable, Dict

# type -> {"validate", "spec"}
# Populated as a side-effect of importing the block modules.
BLOCKS: Dict[str, Dict[str, Any]] = {}


def block(
    block_type: str,
    label: str,
    icon: str,
    default_config: Dict[str, Any],
    is_ai: bool = False,
):
    """Register a block type.

    The decorated function must have signature (config: dict) -> dict and
    return the config, coerced/validated (fill defaults, drop unknown keys).
    It should not raise on a malformed config — coerce to something sane
    instead, since it also runs on values coming back from the client.

    `label`/`icon` feed the builder's ribbon; `default_config` seeds a newly
    dropped block before the professor edits it.
    `is_ai` — marks the block as AI-powered for the builder's studio-wide AI
    badge (and, today, the visual-only paywall lock alongside it). Purely a
    display flag; nothing here enforces it.
    """
    def wrap(fn: Callable[[Dict[str, Any]], Dict[str, Any]]):
        if block_type in BLOCKS:
            raise ValueError(
                f"Block type collision: '{block_type}' is already registered by "
                f"{BLOCKS[block_type]['validate'].__module__}"
            )
        BLOCKS[block_type] = {
            "validate": fn,
            "spec": {
                "type": block_type,
                "label": label,
                "icon": icon,
                "default_config": default_config,
                "is_ai": is_ai,
            },
        }
        return fn

    return wrap
