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
    """Return Anthropic-shaped tool specs that are enabled for this config."""
    return [t["spec"] for t in base.TOOLS.values() if t["enabled_when"](config)]


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
