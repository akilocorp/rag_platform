# @language  Python
# @updated   2026-08-18
# @changed   The close directive is now STEP-AWARE and no longer forbids the count. It used to tell a
#            room three-of-four done to converge on the SOP and "do not chase a more precise count",
#            which is how a debrief reached the procedure before anyone had said a number aloud.
#            `best_identified` also now requires the naming to rest on tallies the students said.
#            Prior: New: the four learning objectives as data, a forced `check_progress` tool that judges which
#            the STUDENTS have reached, and the closing directive that lands the session once they have —
#            because ACTR had a written procedure in hand at turn 29 and was still opening lines at turn 40.
"""What the debrief is FOR, and how to tell when it is done.

THE PROBLEM THIS SOLVES
    ACTR has no sense of an ending. Given a room that answers, it keeps finding one more
    worthwhile question — in an observed run it had a written four-step procedure at turn
    29 and was still opening new enquiries at turn 40, when the harness cut it off. A live
    room is not cut off politely: `debrief_minutes` expires and the screen changes
    mid-sentence, so the group loses the part that matters most, which is the landing.

    The stock prompt does state an ending condition, but it points at "step 13" — a step
    that exists nowhere in a sequence that only reaches F7/S7. The close was therefore
    unreachable as written, and the model was left to invent its own sense of enough.

WHY OBJECTIVES RATHER THAN A TURN LIMIT
    Stopping at a fixed count reproduces exactly the abrupt ending the clock already
    gives. The point is to notice when the group has actually GOT it and then land
    deliberately. These four are what "got it" means, and each is phrased for any
    hidden-profile case rather than for this hiring one — no candidate names, no counts,
    nothing case-specific.

WHAT THE DIRECTIVE MAY NOT DO
    `render_close_directive` tells ACTR to land the session. It must never tell it what to
    SAY, name a candidate, supply a tally, or hint at the answer key. Landing the plane is
    a pacing instruction, not a licence to hand over the case: everything here concerns the
    shape of the conversation and nothing here touches its content. Every hard constraint
    still applies to whatever ACTR writes in response to it.
"""
from src.managers.tools.steps import FINAL_STEPS, WINNER_STEPS, reached

# id, and what the checker looks for. The wording IS the strictness — "the students have
# said", never "the group understands" — and each carries its own explicit near-miss,
# because the first version of this list was granted generously. `profile_understood` was
# awarded to a room that had named one concern about one candidate and compared nothing,
# and `best_identified` is satisfiable in a success room by a student simply repeating the
# vote they already cast. An objective that can be met by accident closes sessions early.
MILESTONES = [
    ("profile_understood",
     "The students have compared AT LEAST TWO candidates aloud on both strengths and "
     "concerns — pooled across the group, not one person's own list. "
     "NOT MET if they have only described a single candidate, however thoroughly, or if "
     "only strengths or only concerns have been pooled."),
    ("best_identified",
     "The students have named which candidate the POOLED information favours, as a "
     "conclusion drawn from the comparison they just made. "
     "NOT MET if it merely restates the choice they already made before the debrief — in "
     "a room that happened to pick well, saying the same name again proves nothing. "
     "NOT MET unless the naming rests on the TALLIES the students themselves put on the "
     "table: a candidate named from general impressions, from the outcome document, or by "
     "elimination is not this objective. This is the moment the arithmetic convicts the "
     "choice, so if no student has said a number aloud, it has not happened. The "
     "facilitator naming it never counts, and is forbidden."),
    ("mechanism_understood",
     "The students have articulated why their first decision went the way it did — that "
     "they each held different pieces, that what everyone shared got over-weighted, and "
     "that what only one person held went unsaid. "
     "NOT MET if only the facilitator has said this, or if the students have merely "
     "admitted they 'rushed' or 'should have talked more'."),
    ("procedure_written",
     "The students have produced a concrete, numbered procedure another team could follow. "
     "NOT MET for vague principles — 'communicate more', 'actually listen' — however many "
     "of them are numbered. Each step must be something a person could execute."),
]

PROGRESS_TOOL = {
    "name": "check_progress",
    "description": (
        "Judge which of the debrief's learning objectives the STUDENTS have actually "
        "reached, using only what they themselves have said. Be strict: an objective the "
        "facilitator stated on their behalf has not been met."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "met": {
                "type": "array",
                "description": (
                    "One entry per objective the students have genuinely reached. Quote "
                    "the student line that proves it — if you cannot quote one, it is not "
                    "met."
                ),
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string",
                               "enum": [mid for mid, _ in MILESTONES]},
                        "evidence": {
                            "type": "string",
                            "description": (
                                "The student's own words that establish it. Must be a "
                                "STUDENT line, never the facilitator's."
                            ),
                        },
                    },
                    "required": ["id", "evidence"],
                },
            },
            "closest_unmet": {
                "type": "string",
                "description": (
                    "Id of the unmet objective the group is nearest to reaching, or an "
                    "empty string when all are met. This is what the facilitator should "
                    "spend its remaining turns on."
                ),
            },
        },
        "required": ["met", "closest_unmet"],
    },
}


# `profile_understood` is a COMPARISON, so its evidence must mention at least this many
# candidates. Wording alone did not hold the line: told plainly that a single candidate
# does not count, the checker still granted it on "jacky just seemed the strongest,
# leadership program, cfa" — one name, no concerns, nothing compared. Enforced rather than
# requested, on the same principle as everything else here.
_COMPARISON_MILESTONE = "profile_understood"
_MIN_CANDIDATES_COMPARED = 2


def _mentions(text, candidates):
    """How many distinct candidate names appear in a line."""
    low = (text or "").lower()
    return sum(1 for c in (candidates or []) if c and c.lower() in low)


def parse_progress(payload, previous=None, candidates=None):
    """Normalize a `check_progress` input, carrying forward anything already achieved.

    Returns `{met, evidence, closest_unmet, ready}`.

    MONOTONIC, and that is the point. "The students have said X aloud" is a fact about the
    past and cannot stop being true, but the checker reads a transcript and will drop an
    objective whose evidence has scrolled out of view or which it simply judges more
    harshly this time. An observed run went 1/4 → 0/4 at turn 24 for exactly that reason,
    which would have kept the closing directive permanently out of reach.

    Union-ing readings is only safe because the milestone wording above is strict about
    near misses: made monotonic while the wording was still loose, a single generous early
    reading would lock in and close the session before the work was done.

    Evidence for an objective is kept from the reading that FIRST established it, since
    that is the moment worth auditing when a session closes too early.
    """
    known = {mid for mid, _ in MILESTONES}
    data = payload if isinstance(payload, dict) else {}

    evidence = dict((previous or {}).get("evidence") or {})
    for item in data.get("met") or []:
        if not isinstance(item, dict) or item.get("id") not in known:
            continue
        quote = str(item.get("evidence") or "").strip()
        if (item["id"] == _COMPARISON_MILESTONE and candidates
                and _mentions(quote, candidates) < _MIN_CANDIDATES_COMPARED):
            continue   # a comparison that names one candidate is not a comparison
        evidence.setdefault(item["id"], quote)

    met = [mid for mid, _ in MILESTONES if mid in evidence]
    closest = data.get("closest_unmet") or ""
    if closest in evidence:          # already achieved; it cannot be what remains
        closest = ""
    if not closest:
        closest = next((mid for mid, _ in MILESTONES if mid not in evidence), "")
    return {
        "met": met,
        "evidence": evidence,
        "closest_unmet": closest if closest in known else "",
        "ready": len(met) >= len(MILESTONES),
    }


def render_milestones():
    """The objective list for the checker's prompt."""
    return "\n".join(f"{i}. [{mid}] {what}" for i, (mid, what) in enumerate(MILESTONES, 1))


def render_close_directive(progress, step=None):
    """The pacing line appended to a turn's TASK. "" while there is nothing to say.

    Reads BOTH readings, and the step is the senior one. The objectives say what the
    students have achieved; the step says where the facilitator actually is. When they
    disagree the step wins, because a generous objective reading is exactly the failure
    this guard exists for: three of four were granted in a room that had counted nothing,
    the directive named the procedure as all that remained, and ACTR asked for the SOP
    before a single number had been said out loud.

    Contains no case content by design. It governs pace only; what ACTR says in response
    is still bound by every constraint — including `does_their_counting`, which is why
    every branch below asks the students for numbers and never supplies one.
    """
    if not progress:
        return ""
    met = progress.get("met") or []
    closest = progress.get("closest_unmet") or ""
    at_winner = reached(step, WINNER_STEPS) if step else False
    at_final = reached(step, FINAL_STEPS) if step else False

    # Before the count and the winner there is no closing to converge on, whatever the
    # objectives say. This branch replaces the one that used to send such a room straight
    # at the procedure, and it pushes the count rather than forbidding it.
    if step and not at_winner:
        return (
            "DO NOT MOVE TOWARD CLOSING. The room has not put the counts on the table and "
            "nobody has named which candidate they favour. The session cannot end before "
            "both have happened.\n"
            "Work toward exactly that. Get the students to say the tallies out loud, one "
            "candidate at a time — how many strengths, how many concerns — and then to say "
            "which candidate those numbers point to. ASK them for the numbers; never supply "
            "one yourself, never top up a short list they gave, and never lay the "
            "candidates out side by side for them. Repeating back a figure a student has "
            "already said is fine, and is often the whole move."
        )

    # They have the counts and are being asked to read them. Exactly one thing to do.
    if at_winner and not at_final:
        return (
            "THE COUNTS ARE ON THE TABLE. What is missing is the students saying, in their "
            "own words, which candidate those numbers favour — reasoning from the figures "
            "in front of them, not restating the pick they walked in with.\n"
            "Get that and nothing else before you move on. You may not name the candidate, "
            "hint at it, or confirm a guess: ask what the numbers say and let the "
            "arithmetic do the work."
        )

    if progress.get("ready"):
        return (
            "THE GROUP HAS GOT THERE. All four learning objectives are met: they have "
            "compared the candidates in their own words, named which one the information "
            "favours, said why their first decision went the way it did, and written a "
            "procedure down.\n"
            "LAND THE SESSION NOW. Do not open a new line of enquiry and do not ask one "
            "more interesting question. Rooms run on a clock and a room cut off by the "
            "timer loses its ending. Write your closing turn and set `ended` true. Do not "
            "summarise the lesson — they have just said it themselves, and saying it back "
            "takes it off them."
        )

    if len(met) >= len(MILESTONES) - 1 and closest:
        return (
            "THE GROUP IS ONE STEP FROM DONE. Everything is in place except this:\n"
            f"  {dict(MILESTONES).get(closest, '')}\n"
            "Spend your remaining turns on THAT. Do not start a new topic and do not "
            "reopen anything already settled.\n"
            "One exception, and it matters: if the count behind their comparison is thin — "
            "figures they never actually said, or a candidate nobody tallied — go back and "
            "get it from them first. A procedure built on a comparison they never made is "
            "worth nothing, and this is the last moment it can be fixed."
        )
    return ""
