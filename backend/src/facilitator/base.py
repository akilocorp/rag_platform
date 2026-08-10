# @language  Python
# @updated   2026-08-10
# @changed   Added the optional `to_transcript(data)` hook to the widget contract so a rendered widget can be
#            replayed into the model's history instead of vanishing into additional_kwargs.
"""
Widget primitives — the `@widget` decorator + the module-level registry dict
it populates. Mirrors the agentic tools' `@tool` pattern.

A widget module declares its contract via the decorator and implements a
`validate(data) -> dict | None` function (the decorated function): it returns a
cleaned/normalized data dict when the model's output matches the widget's shape,
or `None` to reject it (the facilitator then emits no block that turn).

A widget may also declare `to_transcript(data) -> str | None`, which renders the
block back into plain text for the model's conversation history. Without it the
bot never learns what its own widget put on screen — see registry.to_transcript.
"""
from typing import Any, Callable, Dict, Optional

# id -> contract dict {id, label, description, when_to_use, data_schema,
#                      interactive, validate, to_transcript}
# Populated as a side-effect of importing the widget modules.
WIDGETS: Dict[str, Dict[str, Any]] = {}


def widget(
    id: str,
    label: str,
    description: str,
    when_to_use: str,
    data_schema: Dict[str, Any],
    interactive: bool = True,
    to_transcript: Optional[Callable[[dict], Optional[str]]] = None,
):
    """Register a UI widget the facilitator may invoke.

    - `when_to_use` + `data_schema` are shown to the facilitator model so it
      knows the menu and how to fill each widget.
    - `interactive` = does a user selection get sent back as the next turn?
      (True for multiple_choice; False for display-only widgets like a chart.)
    - `to_transcript` renders validated data as text for history replay. Omit it
      and the registry falls back to a generic "a <label> was shown" line, which
      is enough for display-only widgets but not for anything the user answers.
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
            "to_transcript": to_transcript,
        }
        return validate_fn

    return wrap
