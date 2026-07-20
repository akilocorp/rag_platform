"""
multiple_choice — a single-select multiple-choice prompt.

Data shape the widget renders: { question, options: [str], explanation? }.
Interactive: the option the user clicks is sent back as their next message.
"""
from src.facilitator.base import widget


@widget(
    id="multiple_choice",
    label="Multiple choice",
    description="A single-select multiple-choice question with a few short options.",
    when_to_use=(
        "Use when the turn asks the user to pick ONE option from a small set of "
        "discrete choices (2-5). Good for offering next steps, clarifying intent, "
        "or checking understanding. Do not use for open-ended or free-form replies."
    ),
    data_schema={
        "question": "string — the question posed to the user",
        "options": "array of 2-5 short strings — the selectable choices",
        "explanation": "optional string — a one-line lead-in shown above the options",
    },
    interactive=True,
)
def validate(data):
    if not isinstance(data, dict):
        return None
    question = str(data.get("question") or "").strip()
    raw_options = data.get("options")
    if not question or not isinstance(raw_options, list):
        return None
    options = [str(o).strip() for o in raw_options if str(o).strip()]
    # de-dup while preserving order
    seen = set()
    options = [o for o in options if not (o in seen or seen.add(o))]
    if len(options) < 2:
        return None
    out = {"question": question, "options": options[:5]}
    explanation = str(data.get("explanation") or "").strip()
    if explanation:
        out["explanation"] = explanation
    return out
