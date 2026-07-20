"""
flashcard — a display-only deck of active-recall flip cards.

Data shape the widget renders: { title?, cards: [{ front, back }] }.
Non-interactive: the user flips cards to self-test; nothing is sent back.

The validator is STRICT — every card must carry both a non-empty front and
back, otherwise the whole widget is rejected and the turn falls back to plain
text (a half-empty deck never renders).
"""
from src.facilitator.base import widget


@widget(
    id="flashcard",
    label="Flashcards",
    description="A deck of two-sided flip cards for active-recall self-testing.",
    when_to_use=(
        "Use when the reply presents a set of term/definition, question/answer, "
        "or prompt/response pairs the user should memorize or self-test on "
        "(2-8 pairs). Put the cue on `front` and the thing to recall on `back`. "
        "Do NOT use for a single fact or for a continuous explanation."
    ),
    data_schema={
        "title": "optional string — short deck title",
        "cards": (
            "array of 2-8 objects { front: string, back: string } — front is the "
            "cue (term/question), back is what the user should recall (definition/answer). "
            "Both sides required and kept short."
        ),
    },
    interactive=False,
)
def validate(data):
    if not isinstance(data, dict):
        return None
    raw_cards = data.get("cards")
    if not isinstance(raw_cards, list):
        return None

    cards = []
    for c in raw_cards:
        if not isinstance(c, dict):
            continue
        front = str(c.get("front") or "").strip()
        back = str(c.get("back") or "").strip()
        if not front or not back:
            continue
        cards.append({"front": front, "back": back})

    if len(cards) < 2:
        return None

    out = {"cards": cards[:8]}
    title = str(data.get("title") or "").strip()
    if title:
        out["title"] = title
    return out
