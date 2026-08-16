# @language  Python
# @updated   2026-08-16
# @changed   get_tool_specs honours a tool's optional build_spec(config) hook so a per-request spec
#            (e.g. render_widget's config-derived widget enum) is used in place of the static spec.
"""
Public registry API used by the agent runner.

Importing this module triggers tool discovery (via `tools/__init__.py`),
which in turn imports every tool file and runs its `@tool` decorators.
"""
import logging
from typing import Any, Dict, List

from src.agentic.tools import base
from src.agentic import tools  # noqa: F401  side-effect: discovers all tools

logger = logging.getLogger(__name__)


def get_tool_specs(config: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Return Anthropic-shaped tool specs that are enabled for this config.

    A tool may declare `build_spec(config)` to rebuild its spec per-request
    (e.g. an enum whose values depend on the config); otherwise its static
    spec is used.
    """
    specs = []
    for t in base.TOOLS.values():
        if not t["enabled_when"](config):
            continue
        builder = t.get("build_spec")
        specs.append(builder(config) if builder else t["spec"])
    return specs


def get_tool_names() -> List[str]:
    return list(base.TOOLS.keys())


def execute(name: str, inputs: Dict[str, Any], ctx: base.ToolContext) -> Dict[str, Any]:
    """Run a tool. Always returns a dict — never raises."""
    if name not in base.TOOLS:
        return {"content": f"Unknown tool: {name}", "is_error": True}
    try:
        result = base.TOOLS[name]["fn"](inputs or {}, ctx)
        if not isinstance(result, dict) or "content" not in result:
            return {"content": f"Tool '{name}' returned malformed result", "is_error": True}
        return result
    except Exception as e:
        logger.error("Tool '%s' raised: %s", name, e, exc_info=True)
        return {"content": f"Tool '{name}' failed: {e}", "is_error": True}
