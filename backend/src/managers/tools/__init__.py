# @language  Python
# @updated   2026-08-19
# @changed   Export the step gate (steps.py) alongside the turn, check and progress tools.
#            Prior: Export CHECK_ENABLED, which ai_manager already imported by name.
#            Prior: New package: tool contracts for the manager exercise, starting with take_turn.
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
    CHECK_ENABLED,
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
from src.managers.tools.steps import (
    ADVANCE_TOOL,
    FINAL_STEPS,
    FIRST_STEP,
    STEP_IDS,
    WINNER_STEPS,
    is_forward,
    parse_advance,
    reached,
    render_current_step,
    render_refusal,
    render_sequence,
    skipped_between,
    step_exists,
)
from src.managers.tools.take_turn import TURN_TOOL, parse_turn

__all__ = [
    "TURN_TOOL", "parse_turn",
    "CHECK_ENABLED", "CHECK_TOOL", "HARD_CONSTRAINTS", "check_mechanical", "parse_check",
    "render_constraints",
    "PROGRESS_TOOL", "MILESTONES", "parse_progress", "render_close_directive",
    "render_milestones",
    "ADVANCE_TOOL", "FIRST_STEP", "STEP_IDS", "is_forward", "parse_advance",
    "WINNER_STEPS", "FINAL_STEPS", "reached",
    "render_current_step", "render_refusal", "render_sequence", "skipped_between",
    "step_exists",
]
