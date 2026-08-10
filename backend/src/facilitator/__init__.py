# @language  Python
# @updated   2026-08-10
# @changed   Documented the two new seams: `registry.to_transcript` for history replay and `run_facilitator`'s
#            `context` argument for grounding widgets in the turn's source material.
"""
Facilitator — a pluggable structured-UI layer that wraps any bot.

After a bot produces its normal text reply, the facilitator (a small,
config-driven post-pass) inspects that reply and decides whether to accompany
it with an interactive UI *widget* — and if so, produces the widget's data in
the exact shape that widget needs. Multiple-choice is the first widget; more
(checkbox, table, graph, …) are added by dropping a widget module in `widgets/`.

Each widget is a self-contained island split across two id-keyed halves:
  - backend contract here (`widgets/<id>.py`, registered via the `@widget`
    decorator) — feeds the facilitator's menu, validates its output, and
    optionally renders it back to text for history replay (`to_transcript`).
  - frontend renderer (`frontend/src/facilitator/widgets/<id>/`) — draws the UI.

Public entry points:
  - `registry.get_catalog(allowed)`, `registry.get_widget(id)`, `registry.validate(id, data)`
  - `registry.to_transcript(id, data)` -> text for the model's conversation history
  - `runner.run_facilitator(bot_reply, history, facilitator_cfg, context=...)` -> block | None
    `context` is the turn's source material; pass it so widgets (and answer keys)
    are grounded in the documents rather than in the bot's prose about them.
"""
