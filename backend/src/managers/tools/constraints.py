# @language  Python
# @updated   2026-08-18
# @changed   New: the eight hard constraints as data plus a forced `check_turn` tool, so a drafted turn
#            can be judged against them instead of the author being asked to hold all eight while writing.
"""The eight hard constraints, as data rather than prose.

WHY THEY LIVE HERE AND NOT IN THE PROMPT
    Every one of these was written after watching the facilitator break it, and each was
    fixed by adding another paragraph to the system prompt — the paragraph itself often
    carrying a parenthetical about what the model had done wrong. That approach has two
    costs that compound: the author's context grows with every lesson learned, and the
    rules are enforced only by the same model that is simultaneously deciding whether to
    speak, locating itself in a fourteen-step sequence, and writing a warm sentence.

    Constraints that must be ENFORCED belong to a checker, not to the author. A checker
    reads a finished draft and answers one narrow question at a time, which is a far
    easier job than holding eight rules in mind while composing. The list can then grow
    forever without the writing prompt growing at all.

    The human rationale for each rule (the parentheticals in the original prompt) is kept
    in `why` — useful when tuning, never sent to the model.

    One rule is arithmetic rather than judgement — message length — and is enforced in
    Python by `check_mechanical`. Handed to the model along with the rest, it waved through
    a five-sentence draft containing three questions.

USING IT
    `CHECK_TOOL` is a forced tool: hand the checker the draft plus the room's recent
    transcript and it returns the ids it judges violated. Nothing here decides what to do
    about a violation; `parse_check` just normalizes the answer.
"""
import re

# id, the rule as the checker sees it, and why it exists (never sent to the model).
HARD_CONSTRAINTS = [
    ("names_best_option", "Names, hints at, or confirms which candidate was the best choice — including agreeing when a student guesses it, and including at the very end.", "The model's instinct is to reward the user with the right answer, which ends the exercise."),
    ("reveals_unpicked_outcome", "Describes, hints at, or promises the outcome of a candidate the group did not actually pick.", "Only the picked candidate's outcome document is public."),
    ("does_their_counting", "Supplies a number the students did not say — taken from the case data, or by topping up a short list they gave — or lines candidates up against each other into a ranking or a comparison table. ALLOWED, and not a violation: asking them to count, and repeating back a number they said themselves.", "Doing the comparison for them removes the point of the exercise. Stated too broadly it also fired on 'now count them up' and on quoting a student's own figure, which are the moves the exercise is made of."),
    ("explains_mechanism", "Explains why the group failed instead of asking the question that makes it visible — e.g. any sentence like 'what happened here is...'.", "Models love to lecture; the realisation has to be theirs."),
    ("reveals_who_holds_what", "Says what a specific student had, or did not have, in their packet, rather than telling the room to ask that person.", "Packet contents are private and only their holder may disclose them."),
    ("confirms_a_guess", "Confirms a student's guess instead of asking what evidence it rests on and routing back to pooling.", "A confirmed guess stops the pooling that the exercise depends on."),
    ("tells_them_they_were_wrong", "Tells the group their choice was wrong, or implies it by asking them to choose again before they have counted anything themselves.", "The count has to convict the choice, not the facilitator."),
    ("too_long", "Runs past two or three sentences, or asks more than one question in a single message.", "Models naturally write 3-4 paragraphs; length is what turns a facilitator into a lecturer."),
]

CHECK_TOOL = {
    "name": "check_turn",
    "description": (
        "Judge a drafted facilitator message against the hard constraints. Report only "
        "constraints the draft ACTUALLY breaks, quoting the words that break them. An "
        "empty list is the expected answer for most turns."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "violations": {
                "type": "array",
                "description": "One entry per constraint the draft breaks. Usually empty.",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {
                            "type": "string",
                            "enum": [cid for cid, _, _ in HARD_CONSTRAINTS],
                            "description": "Which constraint is broken.",
                        },
                        "quote": {
                            "type": "string",
                            "description": "The exact words of the draft that break it.",
                        },
                    },
                    "required": ["id", "quote"],
                },
            },
        },
        "required": ["violations"],
    },
}


# Counted, not judged. Asked to spot an over-long turn, the checker waved through a draft
# of five sentences containing three questions — because "is this too long" is a
# measurement, and measurements should not be delegated to a model that is also being
# asked to weigh seven matters of judgement. Enforced in `check_mechanical` and left out
# of the rule list the model reads.
MAX_SENTENCES = 3
MAX_QUESTIONS = 1
_MECHANICAL = {"too_long"}


def render_constraints():
    """The numbered rule list for the checker's prompt.

    Omits the rationale (that is for humans tuning the rules) and omits anything in
    `_MECHANICAL` — sending a rule the model is not trusted to apply only invites it to
    apply it badly and spend tokens doing so.
    """
    return "\n".join(f"{i}. [{cid}] {rule}"
                     for i, (cid, rule, _) in enumerate(
                         [c for c in HARD_CONSTRAINTS if c[0] not in _MECHANICAL], 1))


def check_mechanical(draft):
    """The constraints that are arithmetic. Returns violations in the same shape as the tool.

    Deterministic, free, and not subject to a model having an opinion — which is the whole
    reason length is enforced here rather than in the rule list.
    """
    text = (draft or "").strip()
    if not text:
        return []
    sentences = [s for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]
    questions = text.count("?")
    if len(sentences) > MAX_SENTENCES or questions > MAX_QUESTIONS:
        return [{"id": "too_long",
                 "quote": f"{len(sentences)} sentences, {questions} questions"}]
    return []


def parse_check(payload):
    """Normalize a `check_turn` input to `[{"id":..., "quote":...}]`, dropping unknown ids."""
    known = {cid for cid, _, _ in HARD_CONSTRAINTS}
    data = payload if isinstance(payload, dict) else {}
    out = []
    for item in data.get("violations") or []:
        if isinstance(item, dict) and item.get("id") in known:
            out.append({"id": item["id"], "quote": str(item.get("quote") or "").strip()})
    return out
