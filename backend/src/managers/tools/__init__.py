# @language  Python
# @updated   2026-08-18
# @changed   New package: tool contracts for the manager exercise, starting with take_turn.
"""Tool contracts for the manager exercise.

One module per tool, each owning its JSON schema and the parser that turns a tool input
back into a plain dict. They live here rather than inside `ai_manager` so the call
plumbing stays call plumbing and a schema change is a one-file diff — the same split that
already keeps the facilitator's pedagogy in `facilitator_prompt.py`.

Unrelated to `src/agentic/tools/`, which is a registry of tools a chat agent may CHOOSE to
call during a loop. Nothing here is optional or discoverable: these are forced output
shapes, used to stop the model picking its own.
"""
from src.managers.tools.constraints import (
    CHECK_TOOL,
    HARD_CONSTRAINTS,
    check_mechanical,
    parse_check,
    render_constraints,
)
from src.managers.tools.progress import (
    MILESTONES,
    PROGRESS_TOOL,
    parse_progress,
    render_close_directive,
    render_milestones,
)
from src.managers.tools.take_turn import TURN_TOOL, parse_turn

__all__ = [
    "TURN_TOOL", "parse_turn",
    "CHECK_TOOL", "HARD_CONSTRAINTS", "check_mechanical", "parse_check",
    "render_constraints",
    "PROGRESS_TOOL", "MILESTONES", "parse_progress", "render_close_directive",
    "render_milestones",
]
