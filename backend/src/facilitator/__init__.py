"""
Facilitator — a pluggable structured-UI layer that wraps any bot.

After a bot produces its normal text reply, the facilitator (a small,
config-driven post-pass) inspects that reply and decides whether to accompany
it with an interactive UI *widget* — and if so, produces the widget's data in
the exact shape that widget needs. Multiple-choice is the first widget; more
(checkbox, table, graph, …) are added by dropping a widget module in `widgets/`.

Each widget is a self-contained island split across two id-keyed halves:
  - backend contract here (`widgets/<id>.py`, registered via the `@widget`
    decorator) — feeds the facilitator's menu and validates its output.
  - frontend renderer (`frontend/src/facilitator/widgets/<id>/`) — draws the UI.

Public entry points:
  - `registry.get_catalog(allowed)`, `registry.get_widget(id)`, `registry.validate(id, data)`
  - `runner.run_facilitator(bot_reply, history, facilitator_cfg)` -> block | None
"""
