"""
Widget primitives — the `@widget` decorator + the module-level registry dict
it populates. Mirrors the agentic tools' `@tool` pattern.

A widget module declares its contract via the decorator and implements a
`validate(data) -> dict | None` function (the decorated function): it returns a
cleaned/normalized data dict when the model's output matches the widget's shape,
or `None` to reject it (the facilitator then emits no block that turn).
"""
from typing import Any, Callable, Dict, Optional

# id -> contract dict {id, label, description, when_to_use, data_schema, interactive, validate}
# Populated as a side-effect of importing the widget modules.
WIDGETS: Dict[str, Dict[str, Any]] = {}


def widget(
    id: str,
    label: str,
    description: str,
    when_to_use: str,
    data_schema: Dict[str, Any],
    interactive: bool = True,
):
    """Register a UI widget the facilitator may invoke.

    - `when_to_use` + `data_schema` are shown to the facilitator model so it
      knows the menu and how to fill each widget.
    - `interactive` = does a user selection get sent back as the next turn?
      (True for multiple_choice; False for display-only widgets like a chart.)
    The decorated function is the validator: `(data: dict) -> dict | None`.
    """
    def wrap(validate_fn: Callable[[dict], Optional[dict]]):
        if id in WIDGETS:
            raise ValueError(
                f"Widget id collision: '{id}' is already registered by "
                f"{WIDGETS[id]['validate'].__module__}"
            )
        WIDGETS[id] = {
            "id": id,
            "label": label,
            "description": description,
            "when_to_use": when_to_use,
            "data_schema": data_schema,
            "interactive": interactive,
            "validate": validate_fn,
        }
        return validate_fn

    return wrap
