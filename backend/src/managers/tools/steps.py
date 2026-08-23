# @language  Python
# @updated   2026-08-23
# @changed   F7/S7 ("build the framework") became "state the takeaway": ACTR now states the group's
#            takeaway itself instead of drawing a written procedure out of the students, so their exit
#            condition is the one exception to "the students have said" — see the note above STEPS and
#            the evidence field on ADVANCE_TOOL.
# @changed   Prior: WINNER_STEPS / FINAL_STEPS / reached(): the ordering the close directive has to respect,
#            so it can no longer tell ACTR to converge on the SOP while the gate still has the room
#            before the count and the winner.
#            Prior: New: the two tracks as data, plus a forced `advance_step` gate. ACTR had no idea which step
#            it was on — the sequence was prose it re-read every turn — so it went F1 → F7 in four
#            messages, skipping the pooling, the counts and "who is the best candidate" entirely.
"""Where the facilitator is in its own sequence, and what it takes to leave a step.

THE PROBLEM THIS SOLVES
    The tracks are prose inside a 24k-character system prompt, re-read from scratch on
    every turn. Nothing recorded which step the room was on, so the model re-located
    itself each time from a twenty-message window. In an observed run three students
    answered "yes, we could have seen it coming" and ACTR jumped straight to F7 — write
    the SOP — with F2 through F6 never skipped by decision, because they were never on
    its map. F5 is the most fragile of them for the same reason: it is the one step that
    needs a board of counts accumulated over many turns, which is exactly what a
    facilitator with no memory of its own position cannot build.

TWO MECHANISMS, AND THEY DO DIFFERENT JOBS
    `progress.py` judges what the STUDENTS have achieved and decides when the session may
    END. This file judges where the FACILITATOR is and decides when it may MOVE ON. A room
    can be on F5 with no objective met, and can have every objective met while the
    facilitator still thinks it is on F3; neither reading substitutes for the other.

SKIPPING IS ALLOWED, BUT NEVER SILENTLY
    A step whose work the room already did on its own should not be re-run — that is a
    facilitator asking questions it can see the answers to. So ACTR may propose any step
    ahead of the one it is on. What it may not do is arrive there without saying why, and
    the reason it gives is judged against the transcript by `ADVANCE_TOOL` rather than
    taken at face value. A rejection sends it back to finish the step it is on.
"""

# id → (track, name, what must be TRUE of the transcript before this step may be left).
# The exit conditions are written as observations about what the STUDENTS have said,
# never about what the facilitator has asked, because a step is finished by the room
# doing the work and not by ACTR raising the topic. F7/S7 are the one exception: that
# step's whole point is ACTR stating the takeaway itself, so its exit condition is
# satisfied by the facilitator's own line.
STEPS = [
    ("F1", "failure", "Open & the filter",
     "Every student has answered whether they could have seen it coming."),
    ("F2", "failure", "The nudge",
     "The students have accepted that strengths and concerns are the factors they should "
     "have compared — OR they never gave superficial reasons in the first place, in which "
     "case this step has nothing to do and may be passed straight through."),
    ("F3", "failure", "Work the hidden info & pool concerns",
     "The concerns for the CHOSEN candidate have been pooled, and then the concerns for "
     "the other candidates, with more than one student contributing. Not met while only "
     "the chosen candidate has been discussed."),
    ("F4", "failure", "Pool strengths",
     "The strengths of the candidates have been pooled aloud by the students, including "
     "for the candidates whose outcomes were never revealed."),
    ("F5", "failure", "Synthesize & reveal",
     "The counts are on the table: for each candidate, how many strengths and how many "
     "concerns. The STUDENTS said the numbers. A facilitator supplying them does not "
     "satisfy this and is a constraint violation besides."),
    ("F6", "failure", "Who is the best candidate?",
     "The students have named which candidate the counts actually favour, reasoning from "
     "the numbers in front of them rather than restating their original pick."),
    ("F7", "failure", "State the takeaway",
     "ACTR itself has stated the group's key takeaway from the exercise, tied "
     "explicitly to the learning outcome — its own line, not a student's."),
    ("S2", "success", "Validate the info",
     "The students have identified which specific shared information drove their correct "
     "choice, establishing that they did not simply guess."),
    ("S3", "success", "Team dynamics",
     "The students have explained the specific dynamics or questions that let them pool "
     "what each of them held."),
    ("S4", "success", "Pool concerns (other candidates)",
     "The students have listed the fatal concerns they spotted in the candidates they did "
     "not choose."),
    ("S5", "success", "Pool strengths (unchosen candidates)",
     "The students have mapped the strengths of the unchosen candidates, so the "
     "opportunity cost of their decision is on the table."),
    ("S6", "success", "Synthesize & validate",
     "The full strength-to-concern picture has been assembled and checked against their "
     "original choice — including the lucky-guess pivot if the numbers point elsewhere."),
    ("S7", "success", "State the takeaway",
     "ACTR itself has stated the group's key takeaway from the exercise, tied "
     "explicitly to the learning outcome — its own line, not a student's."),
]

STEP_IDS = [sid for sid, _, _, _ in STEPS]
_BY_ID = {sid: (track, name, exit_) for sid, track, name, exit_ in STEPS}

# Where each track begins. A failure room bypasses the filter and goes to F2; a success
# room that survives the filter goes to S2. Both are entered from F1, which is the single
# opening turn both tracks share.
FIRST_STEP = "F1"


def step_exists(step_id):
    return step_id in _BY_ID


def track_of(step_id):
    return (_BY_ID.get(step_id) or (None, None, None))[0]


def steps_for_track(track):
    """The ordered step ids on one track, F1 included since both tracks open there."""
    return [sid for sid, t, _, _ in STEPS if t == track or sid == FIRST_STEP]


def is_forward(current, proposed):
    """True when `proposed` is later than `current` on the same track.

    A step id off the current track (the lucky-guess pivot from S6 to F3) is not a
    forward move within a track and is gated on its own terms by the tool below.
    """
    if current == proposed or not step_exists(proposed):
        return False
    track = track_of(proposed)
    order = steps_for_track(track)
    if current not in order:
        return True
    return order.index(proposed) > order.index(current)


# The two milestones the takeaway is not allowed to arrive before. The close directive
# reads these: the whole exercise turns on the students counting for themselves and then
# saying aloud who the counts favour, and a takeaway stated before either has happened is
# a lesson about a comparison they never made.
WINNER_STEPS = {"F6", "S6"}
FINAL_STEPS = {"F7", "S7"}


def reached(step, targets):
    """True when `step` is AT or PAST any of `targets` on its own track.

    Reuses the same per-track ordering `is_forward` walks rather than introducing a
    second notion of sequence — two orderings that can disagree is how the close
    directive and the step gate ended up pointing at different steps in the first place.
    """
    if not step_exists(step):
        return False
    order = steps_for_track(track_of(step))
    here = order.index(step)
    return any(t in order and here >= order.index(t) for t in targets)


def skipped_between(current, proposed):
    """The step ids passed over by moving `current` → `proposed`. Empty for one notch."""
    if not is_forward(current, proposed):
        return []
    order = steps_for_track(track_of(proposed))
    return order[order.index(current) + 1:order.index(proposed)]


def render_sequence(track=None):
    """The step list with its exit conditions, for the gate's prompt."""
    rows = [s for s in STEPS if track is None or s[1] == track or s[0] == FIRST_STEP]
    return "\n".join(f"[{sid}] {name} — leaves this step when: {exit_}"
                     for sid, _, name, exit_ in rows)


def render_current_step(step_id):
    """The WHERE YOU ARE block for the facilitator's own turn brief.

    Deliberately states the exit condition rather than the step's instructions: the
    instructions are already in the system prompt, and what the model keeps getting wrong
    is not what F3 involves but whether F3 is finished.
    """
    if not step_exists(step_id):
        return ""
    track, name, exit_ = _BY_ID[step_id]
    order = steps_for_track(track)
    nxt = order[order.index(step_id) + 1] if order.index(step_id) + 1 < len(order) else None
    lines = [
        f"- YOU ARE ON STEP {step_id} — {name}.",
        f"  You may leave it once: {exit_}",
    ]
    if nxt:
        nxt_name = _BY_ID[nxt][1]
        lines.append(
            f"  The next step is {nxt} ({nxt_name}). To move, set `step` to the step you "
            f"are moving to and put in `step_done_because` what the STUDENTS said that "
            f"finished {step_id}. That reason is checked against the transcript, so an "
            f"unfinished step will be sent back to you."
        )
        lines.append(
            "  Skipping further ahead is allowed when the room genuinely did that work "
            "already — say so in the same field. Leave `step` out to stay where you are."
        )
    else:
        lines.append("  This is the last step of the track.")
    return "\n".join(lines)


ADVANCE_TOOL = {
    "name": "advance_step",
    "description": (
        "Judge whether the facilitator may leave the step it is on. Read the transcript "
        "and decide whether the step's exit condition is ACTUALLY satisfied by what the "
        "students said — not by what the facilitator asked, and not by what it claims. "
        "Refusing is the safe answer: a step left early cannot be returned to."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "approved": {
                "type": "boolean",
                "description": (
                    "true only when the exit condition of the current step is met in the "
                    "transcript, AND — if steps are being skipped — the exit condition of "
                    "every skipped step is met too."
                ),
            },
            "evidence": {
                "type": "string",
                "description": (
                    "When approving: the line that satisfies the exit condition. It must "
                    "be a STUDENT line, EXCEPT when entering F7/S7 ('state the takeaway') "
                    "— that step's exit condition is the facilitator's own line, so quote "
                    "ACTR's stated reason instead. If you cannot quote one, do not approve."
                ),
            },
            "missing": {
                "type": "string",
                "description": (
                    "When refusing: what the room still has to do, in one sentence, "
                    "addressed to the facilitator. Name the work, never the answer — no "
                    "candidate names, no counts, nothing from the case data."
                ),
            },
        },
        "required": ["approved"],
    },
}


def parse_advance(payload):
    """Normalize an `advance_step` input to `{approved, evidence, missing}`."""
    data = payload if isinstance(payload, dict) else {}
    return {
        "approved": bool(data.get("approved")),
        "evidence": str(data.get("evidence") or "").strip(),
        "missing": str(data.get("missing") or "").strip(),
    }


def render_refusal(step_id, missing):
    """What the facilitator is told when the gate sends it back.

    Phrased as the room's remaining work rather than as a rejection, because the model's
    next act is to write a turn and it should be writing it FOR that work — an apology to
    the gate would be posted to the students.
    """
    name = (_BY_ID.get(step_id) or (None, step_id, None))[1]
    line = (f"YOU ARE STILL ON STEP {step_id} ({name}). It is not finished, so you are not "
            f"moving on this turn.")
    if missing:
        line += f"\nWhat the room still has to do: {missing}"
    line += ("\nWrite the turn that gets THAT out of them. Do not announce the step, do not "
             "mention that you were going to move on, and do not tell them they missed "
             "something — just ask the question that does the work.")
    return line
