"""
Tool primitives — `@tool` decorator + `ToolContext` + the module-level
registry dict that decorators populate.

See README.md in this folder for the dev workflow ("how to add a tool").
"""
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional


@dataclass
class ToolContext:
    """Per-request state passed to every tool function.

    Tools should read what they need and ignore the rest. Adding a new field
    here is backward-compatible.
    """
    user_id: Optional[str]
    config_id: str
    config: Dict[str, Any]
    variant: str = 'A'  # 'A' (user library) or 'B' (config-scoped)
    selected_file_ids: List[str] = field(default_factory=list)


# name -> {"fn", "spec", "enabled_when"}
# Populated as a side-effect of importing the tool modules.
TOOLS: Dict[str, Dict[str, Any]] = {}


def tool(
    name: str,
    description: str,
    input_schema: Dict[str, Any],
    enabled_when: Optional[Callable[[Dict[str, Any]], bool]] = None,
):
    """Register a function as an agent tool.

    The decorated function must have signature
        (inputs: dict, ctx: ToolContext) -> dict
    and return either:
        {"content": "<text>"}                       on success
        {"content": "<text>", "is_error": True}     on tool-level failure

    `enabled_when(config) -> bool` runs per-request to decide whether to
    expose the tool. Defaults to always-on.
    """
    if enabled_when is None:
        enabled_when = lambda _config: True

    def wrap(fn: Callable[[dict, ToolContext], dict]):
        if name in TOOLS:
            raise ValueError(
                f"Tool name collision: '{name}' is already registered by "
                f"{TOOLS[name]['fn'].__module__}"
            )
        TOOLS[name] = {
            "fn": fn,
            "spec": {
                "name": name,
                "description": description,
                "input_schema": input_schema,
            },
            "enabled_when": enabled_when,
        }
        return fn

    return wrap
