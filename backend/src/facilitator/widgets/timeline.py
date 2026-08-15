# @language  Python
# @updated   2026-08-15
# @changed   Added a faithful to_transcript so the ordered steps replay into history — the bot can answer
#            questions about the sequence instead of denying a timeline was made.
"""
timeline — a display-only ordered sequence of steps / stages / events.

Data shape the widget renders: { title?, steps: [{ label, detail? }] }.
Non-interactive: it renders an ordered list; nothing is sent back.

The validator is STRICT — a step with no `label` is dropped, and fewer than two
usable steps rejects the whole widget (a one-item "sequence" isn't one).
"""
from src.facilitator.base import widget


def _to_transcript(data):
    """Render the ordered steps into history so the bot can answer questions
    about the sequence it produced."""
    lines = ["[Timeline displayed to the user]"]
    if data.get("title"):
        lines.append(f"Title: {data['title']}")
    for i, s in enumerate(data.get("steps") or [], 1):
        line = f"{i}. {s.get('label')}"
        if s.get("detail"):
            line += f" — {s['detail']}"
        lines.append(line)
    return "\n".join(lines)


@widget(
    id="timeline",
    label="Timeline",
    description="An ordered vertical sequence of steps, stages, or events.",
    when_to_use=(
        "Use when the reply describes an ORDERED sequence — chronological events, "
        "the stages of a process, or step-by-step instructions (2-8 steps). Put the "
        "short name of each step on `label` and any elaboration on `detail`. Do NOT "
        "use for an unordered set or a single step."
    ),
    data_schema={
        "title": "optional string — short timeline title",
        "steps": (
            "array of 2-8 objects { label: string, detail?: string } IN ORDER — "
            "label is the short step name, detail is an optional one-line elaboration."
        ),
    },
    interactive=False,
    to_transcript=_to_transcript,
)
def validate(data):
    if not isinstance(data, dict):
        return None
    raw_steps = data.get("steps")
    if not isinstance(raw_steps, list):
        return None

    steps = []
    for s in raw_steps:
        if not isinstance(s, dict):
            continue
        label = str(s.get("label") or "").strip()
        if not label:
            continue
        step = {"label": label}
        detail = str(s.get("detail") or "").strip()
        if detail:
            step["detail"] = detail
        steps.append(step)

    if len(steps) < 2:
        return None

    out = {"steps": steps[:8]}
    title = str(data.get("title") or "").strip()
    if title:
        out["title"] = title
    return out
