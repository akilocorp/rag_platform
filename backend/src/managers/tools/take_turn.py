# @language  Python
# @updated   2026-08-18
# @changed   New: the `take_turn` forced-tool contract for a facilitator turn. Splits ACTR's private
#            deliberation from the words it says out loud at the transport layer, after a prompt
#            instruction to do the same was ignored and posted the case pack's collapse pairs to a room.
"""The shape of one ACTR turn, as a forced tool call.

WHY A TOOL AND NOT A PROMPT LINE
    Asking for the message as free text does not survive a hard turn. Told plainly to keep
    deliberation out of its reply — and given a `THINKING:` channel to put it in instead —
    the model wrote the deliberation into the message anyway once the room got difficult.
    In one observed run it posted the case pack's COLLAPSE PAIRS, both operands verbatim,
    to the very students the pack exists to hide them from; the leak then sat in the room
    transcript, so the next turn read its own private notes back as though a student had
    said them out loud.

    That failure IS the model disregarding an instruction under load, so another
    instruction cannot fix it. Two named fields can. `reasoning` gives deliberation a
    sanctioned home, which removes the pressure to smuggle it into `message`, and the
    transport keeps the two apart whatever the model intends.

    Precedent for forcing a tool rather than parsing prose is `case_pack._EXTRACTION_TOOL`,
    which exists for the same reason: to stop the model choosing its own output shape.

WHY `speak` IS A BOOLEAN
    Silence used to be the literal string SILENT, matched exactly. Every near miss posted
    something: "SILENT." with a full stop, a sentence that merely ended in the word, and a
    short explanation of why it was staying quiet. A boolean has no near misses.

THE COST, WHICH IS REAL
    A model asked to fill in fields starts writing like a form, and this facilitator's
    whole value is that it does not. `message` is described as speech rather than as data
    to push back on that, but it is worth checking the voice survived — run the same
    fixture before and after and read them side by side.
"""

TURN_TOOL = {
    "name": "take_turn",
    "description": (
        "Record your decision for this turn. Call this exactly once. Everything in "
        "`reasoning` is private and is never shown to anyone; `message` is posted to the "
        "room word for word."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "reasoning": {
                "type": "string",
                "description": (
                    "PRIVATE — nobody ever reads this. One or two sentences: where the "
                    "group has got to, who still owes you an answer, and why you are "
                    "speaking or holding. Every mention of the case data, the tally, "
                    "collapse pairs, tension pairs, track names and step numbers belongs "
                    "HERE and nowhere else."
                ),
            },
            "speak": {
                "type": "boolean",
                "description": (
                    "true to post a message this turn, false to stay silent. False is the "
                    "usual answer: you are asked after every single student message, and "
                    "most of the time the room does not need you."
                ),
            },
            "message": {
                "type": "string",
                "description": (
                    "The exact words you say to the room, in your own speaking voice. "
                    "Required when speak is true; omit it otherwise. One question, two or "
                    "three sentences at most and often just one. It has to stand on its "
                    "own as something a person says out loud: no preamble, no recap of "
                    "what was just said, no narration about the students, no step names, "
                    "and nothing quoted from the case data. If what you are writing "
                    "describes the group rather than speaks to it, it belongs in "
                    "`reasoning` instead."
                ),
            },
            "reply_to_name": {
                "type": "string",
                "description": (
                    "When this message answers or addresses ONE student, their name from "
                    "the roster — the interface then shows it as a reply to that student's "
                    "message, so do NOT also prefix their name in the text. Omit it when "
                    "you are addressing several people at once, such as a go-around; a "
                    "single reply target cannot represent that."
                ),
            },
            "go_around": {
                "type": "boolean",
                "description": (
                    "true only when this message asks every student in turn for an item. "
                    "It stops you being asked again until all of them have answered."
                ),
            },
            "ended": {
                "type": "boolean",
                "description": (
                    "true only when the debrief has reached its ENDING condition and this "
                    "message is your close. It ends the session, so use it once."
                ),
            },
        },
        "required": ["reasoning", "speak"],
    },
}


def parse_turn(payload):
    """Normalize a `take_turn` tool input into the dict `facilitator_reply` returns.

    Defensive about the model's two habits even inside a schema: declaring `speak` true
    while leaving `message` empty (treated as silence — there is nothing to post), and
    writing the literal word SILENT into `message` (treated as silence, since it plainly
    meant to hold and posting the word is the bug this design removes).
    """
    data = payload if isinstance(payload, dict) else {}
    message = str(data.get("message") or "").strip()
    speak = bool(data.get("speak"))

    if not speak or not message or message.upper().rstrip(".!") == "SILENT":
        message = None
    return {
        "message": message,
        "go_around": bool(data.get("go_around")) and message is not None,
        "ended": bool(data.get("ended")) and message is not None,
        "reasoning": str(data.get("reasoning") or "").strip(),
        # Quote-reply target. A field rather than a `[REPLY:name]` marker in the text,
        # so the tool path keeps the feature the free-text path gets from the marker —
        # the socket layer resolves the name to that student's latest message id.
        "reply_to_name": (str(data.get("reply_to_name") or "").strip() or None
                          if message is not None else None),
    }
