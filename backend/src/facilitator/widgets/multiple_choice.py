# @language  Python
# @updated   2026-08-10
# @changed   Added the `answer` key (so a pick can actually be graded) and `to_transcript` (so the bot sees
#            the question it asked instead of a context-free option string on the next turn).
"""
multiple_choice — a single-select multiple-choice prompt.

Data shape the widget renders: { question, options: [str], answer?, explanation? }.
Interactive: the option the user clicks is sent back as their next message.
"""
from src.facilitator.base import widget


def _to_transcript(data):
    """Render the question, its options and the answer key back into the
    assistant turn for history replay.

    The block itself lives in `additional_kwargs`, which history loading drops,
    so this text is the only way the bot knows on turn N+1 that the bare string
    the user just sent ("Berlin") was an answer to a question it asked.
    """
    options = data.get("options") or []
    lines = [
        "[Interactive multiple choice shown to the user]",
        f"Q: {data.get('question')}",
        "Options: " + " | ".join(str(o) for o in options),
    ]
    if data.get("answer"):
        lines.append(f"Correct answer: {data['answer']}")
    return "\n".join(lines)


@widget(
    id="multiple_choice",
    label="Multiple choice",
    description="A single-select multiple-choice question with a few short options.",
    when_to_use=(
        "Use when the turn asks the user to pick ONE option from a small set of "
        "discrete choices (2-5). Good for offering next steps, clarifying intent, "
        "or checking understanding. Do not use for open-ended or free-form replies. "
        "When the question has a genuinely correct answer (a comprehension or quiz "
        "check), you MUST set `answer` to the exact text of the correct option — it "
        "is the only answer key the platform has. Omit `answer` only when the "
        "question is a preference or a choice of next step with no right answer."
    ),
    data_schema={
        "question": "string — the question posed to the user",
        "options": "array of 2-5 short strings — the selectable choices",
        "answer": (
            "optional string — the correct option, copied VERBATIM from options. "
            "Required whenever the question has a right answer; omit for "
            "preference/next-step questions."
        ),
        "explanation": "optional string — a one-line lead-in shown above the options",
    },
    interactive=True,
    to_transcript=_to_transcript,
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
    # Answer key. Kept only when it matches a surviving option exactly — a model
    # that paraphrases the correct choice, or names one that got truncated by the
    # 5-option cap, would otherwise mark every pick wrong.
    answer = str(data.get("answer") or "").strip()
    if answer and answer in out["options"]:
        out["answer"] = answer
    explanation = str(data.get("explanation") or "").strip()
    if explanation:
        out["explanation"] = explanation
    return out
