# @language  Python
# @updated   2026-08-16
# @changed   New tool: render_widget lets a Claude agentic bot create facilitator widgets inline in its
#            reply (multiple per turn). Schema (widget enum + per-widget shapes) is built from the
#            facilitator registry so it stays in sync; on success it returns a `facilitator` side-channel
#            block the runner emits as an inline widget event.
"""
render_widget — the agentic bot's first-class way to put an interactive study
widget (chart, quiz, flashcards, table, timeline, mind map, impact map) inline in
its reply, at the point in the text where it belongs.

Enabled only when the bot's `facilitator` is on (and the FACILITATOR_TOOL kill-switch
is not off). The widget id enum and per-widget data shapes are derived from the
facilitator registry's catalog, gated to the professor's allowed-widget list, so the
tool never drifts from the widget definitions. On success it validates the data through
the same `facilitator.registry.validate` the post-pass uses and hands back a
`facilitator` block; the agent runner turns that into an inline widget event.
"""
import os

from src.facilitator import registry as facilitator_registry

from .base import tool, ToolContext


def _kill_switch_on() -> bool:
    """The FACILITATOR_TOOL env kill-switch: default on; any falsey value disables."""
    return os.getenv("FACILITATOR_TOOL", "1").strip().lower() not in ("0", "false", "no", "off", "")


def _allowed_widgets(config: dict):
    """The professor's allowed-widget list, or None (= all) — mirrors run_facilitator."""
    fac = config.get("facilitator")
    if not isinstance(fac, dict):
        return None
    allowed = fac.get("allowedWidgets")
    return allowed if isinstance(allowed, list) and allowed else None


def _enabled(config: dict) -> bool:
    if not _kill_switch_on():
        return False
    fac = config.get("facilitator")
    if not (isinstance(fac, dict) and fac.get("enabled")):
        return False
    return bool(facilitator_registry.get_catalog(_allowed_widgets(config)))


def _build_spec(config: dict) -> dict:
    """Anthropic tool spec whose `widget` enum + `data` guidance come from the
    catalog this bot is allowed to use, so the schema tracks the widget files."""
    catalog = facilitator_registry.get_catalog(_allowed_widgets(config))
    ids = [w["id"] for w in catalog]

    # Per-widget menu (when-to-use + data shape) folded into the data description,
    # the same material the post-pass prompt shows the model.
    menu_lines = []
    for w in catalog:
        menu_lines.append(
            f"- {w['id']}: {w.get('when_to_use', '')} DATA SHAPE: {w.get('data_schema')}"
        )
    data_desc = (
        "The widget's data, matching the chosen widget's data shape exactly. Shapes:\n"
        + "\n".join(menu_lines)
    )

    return {
        "name": "render_widget",
        "description": (
            "Render an interactive study widget inline at this point in your reply "
            "(it appears exactly where you call the tool). Call it right after the "
            "section it illustrates; you may call it more than once per reply, once "
            "per widget-worthy section. Do not restate the widget's contents in prose."
        ),
        "input_schema": {
            "type": "object",
            "properties": {
                "widget": {
                    "type": "string",
                    "enum": ids,
                    "description": "Which widget to render.",
                },
                "data": {
                    "type": "object",
                    "description": data_desc,
                },
            },
            "required": ["widget", "data"],
        },
    }


@tool(
    name="render_widget",
    description="Render an interactive study widget inline in the reply.",
    input_schema={"type": "object", "properties": {}},  # replaced per-request by build_spec
    enabled_when=_enabled,
    build_spec=_build_spec,
)
def render_widget(inputs: dict, ctx: ToolContext) -> dict:
    widget_id = str((inputs or {}).get("widget") or "").strip()
    if not widget_id:
        return {"content": "Missing 'widget' id.", "is_error": True}

    # Honour the allow-list even if the model ignores the enum.
    allowed = _allowed_widgets(ctx.config or {})
    if allowed and widget_id not in allowed:
        return {
            "content": f"Widget '{widget_id}' is not permitted here. Allowed: {', '.join(allowed)}.",
            "is_error": True,
        }

    cleaned = facilitator_registry.validate(widget_id, (inputs or {}).get("data"))
    if cleaned is None:
        return {
            "content": (
                f"The data did not match the '{widget_id}' shape, so nothing was rendered. "
                "Check the required fields for that widget and call render_widget again, "
                "or continue without a widget."
            ),
            "is_error": True,
        }

    # The `facilitator` side-channel is picked up by the agent runner and emitted as
    # an inline widget event; `content` is deliberately terse so the model doesn't
    # repeat the widget's contents in prose.
    return {
        "content": f"A {widget_id} widget was rendered inline and shown to the user.",
        "facilitator": {"widget": widget_id, "data": cleaned},
    }
