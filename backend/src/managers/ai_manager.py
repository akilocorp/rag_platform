# @language  Python
# @updated   2026-08-23
# @changed   Dropped both takeaway exceptions from _ADVANCE_SYSTEM and _PROGRESS_SYSTEM: F7/S7 and
#            takeaway_stated are judged against the STUDENTS' words again, like every other step.
# @changed   Prior: _ADVANCE_SYSTEM and _PROGRESS_SYSTEM both carry a named exception for F7/S7 / takeaway_stated
#            ("state the takeaway"): that move/objective is satisfied by the facilitator's own line, not
#            a student's, since steps.py and progress.py now define it as ACTR stating the takeaway itself.
# @changed   Prior: `facilitator_reply` takes `recent_student_msgs` and renders the pushback guard: a student
#            demanding the answer now gets refused out loud in the same turn instead of talked past.
#            Prior: The close directive is handed the step too, so it cannot point past a step the gate has
#            not cleared.
#            Prior: The step gate: `facilitator_reply` takes the room's current step, renders it into the turn
#            brief, and rules on any forward move via `judge_step_advance` before it is allowed. A refused
#            move sends the draft back to be rewritten for the step it is on — the message was composed
#            for the step it wanted, so refusing the move alone would still advance the conversation.
#            Fails CLOSED, opposite to the constraint checker: staying costs a turn, advancing wrongly
#            costs the session.
#            Prior: Write `_check_turn`, the missing half of the constraint checker: `_checked` has called it
#            since the checker shipped but it was never defined, so every drafted facilitator turn died
#            on a NameError inside a background task. Fails open — a transport error must not mute ACTR.
#            Prior: A facilitator turn is now a FORCED tool call (src/managers/tools/take_turn.py): `reasoning` and
#            `message` are separate fields, so private deliberation has no channel to the room. The prompt
#            asked for the same split and was overridden under load — a room was shown the case pack's
#            collapse pairs verbatim. `reply_to_name` rides the tool too, so quote-reply survives the new
#            path. Constraints moved to a checker; a closing directive lands the session once the group
#            has met the learning objectives. Text path kept as a transport fallback.
#            Prior: Quote-reply: ACTR ends a message aimed at ONE student with [REPLY:name]; _split_markers
#            returns the target for the socket layer to resolve to that student's latest message id.
#            Prior: _is_silent now matches a turn ENDING in SILENT, not only the bare token.
#            Prior: facilitator_reply takes `recent_asks` (renders the repeat guard directly above the TASK) and
#            `outcome_text` (pins the outcome document into every turn so it cannot age out of the rolling
#            transcript window while ACTR is still ruling on what it says).
#            Prior: M12: the debrief opener is no longer hardcoded. facilitator_open_debrief now asks the model,
#            on the same facilitator system prompt as every other turn, for step 1 of THE SEQUENCE — so a
#            professor's facilitator_prompt_override owns the first words of the session. Fails to silence
#            rather than to a canned line.
#            Prior: M9 — ACTR became a ROUND-2-ONLY voice (removed facilitator_open_discussion,
#            facilitator_call_vote and the two-strike reveal along with the dead [REOPEN] path), added the
#            anonymous round-0 spread in reactive turns and the END marker that closes the session.
"""ACTR — the single facilitator voice in a `manager_exercise` room.

ACTR exists in exactly one round. It never sees the students decide: rounds 0 and
1 — the private pick, and the group's own argument ending in one student entering
the hire on their behalf — happen with no
facilitator in the room at all. It arrives in round 2, after the outcome document
has landed, and runs the debrief: (a) an opener that reacts to how the hire turned
out, (b) reactive turns while the group works out what they missed, and (c) a
closing message when the conversation has run its course.

That absence is enforced by the phase machine (`ExerciseState.facilitator_active`),
not by anything in this module or the prompt. Nothing here is ever called during
rounds 0 or 1, so there is no system prompt to build and no call to make.

Every case-specific fact reaches the model through the rendered case pack in the
system prompt (`facilitator_prompt.build_facilitator_system`) — nothing about any
particular case is written here. The pedagogy lives in the prompt; this module is
call plumbing.

Turn-taking used to be decided in Python too — a quorum and a cooldown gating
whether ACTR was invoked. Those bought their guarantees with latency, so they are
gone. Within the debrief ACTR is asked after every student message and decides for
itself, from the facts in `turn_context` plus the worked example in the prompt.

Fail-soft throughout, mirroring `src/facilitator/runner.py`: a missing key,
missing package, or failed call degrades to a safe fallback or silence and never
raises into a socket handler.
"""
import json
import logging
import os
import re

from src.utils.models import sampling_kwargs
from src.managers.facilitator_prompt import (
    build_facilitator_system,
    render_pushback_guard,
    render_repeat_guard,
    render_turn_brief,
)
from src.managers.tools import (
    ADVANCE_TOOL,
    CHECK_ENABLED,
    CHECK_TOOL,
    PROGRESS_TOOL,
    TURN_TOOL,
    check_mechanical,
    is_forward,
    parse_advance,
    parse_check,
    parse_progress,
    parse_turn,
    render_close_directive,
    render_constraints,
    render_current_step,
    render_milestones,
    render_refusal,
    render_sequence,
    skipped_between,
    step_exists,
)

logger = logging.getLogger(__name__)

# The facilitator has to hold a long constraint list AND reason about the case
# pack, so it runs on the reasoning tier. Env name kept from the previous
# implementation so existing deployments don't need a new variable.
FACILITATOR_MODEL = os.getenv("MANAGER_EXERCISE_MODEL", "claude-sonnet-4-6")

# ACTR speaks in two or three sentences plus a question; this is deliberately
# tight so the model cannot drift into lecturing.
FACILITATOR_MAX_TOKENS = 400

# The model appends this to a message in which it has opened a go-around (asked
# every student for one item). The socket layer strips it and arms the quorum
# gate, so ACTR is not invoked again until every named student has answered.
GO_AROUND_MARKER = "[GO_AROUND]"

# Appended when ACTR judges the debrief finished. The socket layer strips it and
# closes the room. The alternative — ending purely on a clock — cuts the room off
# mid-sentence as often as it lands, because a debrief is done when the group has
# got there, not at a fixed minute. The configured window is still enforced as a
# backstop (`ExerciseState._run_debrief_window`) for a room that never converges.
END_MARKER = "[END]"

# Returned instead of a message when ACTR has nothing worth saying this turn. Still used
# by the wrap-up and by the text fallback in `_call_turn`; the tool path encodes silence
# as a boolean instead, which has no near misses.
_SILENT_TOKEN = "SILENT"

# Appended when ACTR is answering ONE named student on the TEXT fallback path. The socket
# layer strips it and attaches the turn to that student's latest message as a quote-reply.
# The forced-tool path carries the same intent in `take_turn.reply_to_name` instead.
REPLY_MARKER_RE = re.compile(r"\[REPLY:\s*([^\]]+?)\s*\]", re.IGNORECASE)

# Room for `reasoning` alongside `message`. The message stays short because the tool's own
# field description caps it, not because the budget does.
FACILITATOR_TOOL_MAX_TOKENS = 900

# The checker reads one short draft against eight short rules. That is a small, narrow job
# and does not need the reasoning tier the facilitator itself runs on.
CHECKER_MODEL = os.getenv("MANAGER_EXERCISE_CHECKER_MODEL", "claude-haiku-4-5-20251001")
CHECKER_MAX_TOKENS = 500


# Why the last _get_client() call returned None, for callers that have somewhere to
# show it. Returning a bare None made every downstream feature fail as silence — a
# test room with nothing to say, a facilitator that never speaks — with the reason
# nowhere but a log nobody reads while watching a run.
LAST_CLIENT_ERROR = None


def _get_client():
    """Return an Anthropic client, or None if key/package unavailable. Never raises."""
    global LAST_CLIENT_ERROR
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        LAST_CLIENT_ERROR = "ANTHROPIC_API_KEY is not set in this process"
        logger.error("Anthropic client unavailable: %s", LAST_CLIENT_ERROR)
        return None
    try:
        import anthropic
    except ImportError as e:
        LAST_CLIENT_ERROR = "anthropic package not importable: %s" % e
        logger.error("Anthropic client unavailable: %s", LAST_CLIENT_ERROR)
        return None
    try:
        client = anthropic.Anthropic(api_key=api_key)
    except Exception as e:  # noqa: BLE001
        LAST_CLIENT_ERROR = "%s: %s" % (type(e).__name__, e)
        logger.error("Anthropic client unavailable: %s", LAST_CLIENT_ERROR, exc_info=True)
        return None
    LAST_CLIENT_ERROR = None
    return client


def _text_from_message(msg):
    """Concatenate the text blocks of an Anthropic message into a plain string."""
    parts = []
    for block in (getattr(msg, "content", None) or []):
        if getattr(block, "type", None) == "text":
            parts.append(block.text)
    return "".join(parts).strip()


def _extract_json(raw):
    """Pull the first JSON object out of a model reply (fenced or bare). None on failure."""
    if not raw:
        return None
    s = raw.strip()
    fence = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", s)
    if fence:
        s = fence.group(1)
    else:
        brace = re.search(r"\{[\s\S]*\}", s)
        if brace:
            s = brace.group(0)
    try:
        return json.loads(s)
    except (ValueError, TypeError):
        return None


def _is_silent(text):
    """True when the model used its veto.

    The bare word is the documented form, but the model also narrates the decision and
    then emits the token — "Bo just asked about the downside, let that run.\\n\\nSILENT".
    Matching only the bare word posted that narration, the word SILENT included, straight
    into the room; observed twice in a single scripted run. Reasoning is not a message, so
    a turn that ENDS in the token is silence no matter what precedes it.
    """
    body = (text or "").strip()
    if not body:
        return True
    return bool(re.search(r"(?:^|\n|\s)%s[.!]*$" % _SILENT_TOKEN, body, re.IGNORECASE))


def _split_markers(text):
    """Strip control markers and reasoning off a reply.

    Returns `(clean_text, go_around, ended, reply_to_name, reasoning)`.

    Trailing sentinels rather than a JSON envelope keep the message itself in
    ACTR's natural chat voice — a model asked to emit JSON tends to write like a
    form, and the whole point of this facilitator is that it doesn't. `reply_to_name`
    is the target of a [REPLY:name] marker (None when absent), left for the socket
    layer to resolve to a message id.

    REASONING. The model narrates its decision before writing the message — "They've
    corrected the mix-up themselves. Jacky: one concern…" then the actual question.
    Posted whole, that shows students the machinery and, worse, lands in the room
    transcript, so the next turn reads its own private notes back as if someone had
    said them out loud. `THINKING:` is the sanctioned channel; the blank-line fallback
    catches the unmarked case, and is safe because the prompt already caps a turn at
    two or three sentences, so a multi-paragraph reply is malformed by definition.
    Nothing is discarded — the caller persists it.

    This is the FALLBACK path only; the forced tool returns both as named fields.
    """
    body = (text or "").strip()
    go_around = GO_AROUND_MARKER in body
    ended = END_MARKER in body
    reply_match = REPLY_MARKER_RE.search(body)
    reply_to_name = reply_match.group(1).strip() if reply_match else None
    body = REPLY_MARKER_RE.sub("", body)
    body = body.replace(GO_AROUND_MARKER, "").replace(END_MARKER, "").strip()

    marked = re.match(r"^\s*THINKING\s*:\s*(.+?)\n\s*\n(.+)$", body, re.S | re.I)
    if marked:
        return marked.group(2).strip(), go_around, ended, reply_to_name, marked.group(1).strip()

    blocks = [b.strip() for b in re.split(r"\n\s*\n", body) if b.strip()]
    if len(blocks) > 1:
        return blocks[-1], go_around, ended, reply_to_name, "\n\n".join(blocks[:-1])
    return body, go_around, ended, reply_to_name, ""


def _call(system, user, fallback=None):
    """One facilitator turn. Returns the model's text, or `fallback` on any failure.

    The system prompt is identical for every turn in a room — pedagogy plus this
    case's pack, several thousand tokens of it — and ACTR is now asked after every
    student message. So it is sent as a cached block: the first turn pays for it,
    the rest of the session reads it back. Same idiom as
    `src/agentic/agent_runner.py`.

    Temperature 0 because "is it my turn" should not be a dice roll; the same room
    state should produce the same decision.
    """
    client = _get_client()
    if client is None:
        return fallback
    try:
        msg = client.messages.create(
            model=FACILITATOR_MODEL,
            max_tokens=FACILITATOR_MAX_TOKENS,
            **sampling_kwargs(FACILITATOR_MODEL, 0),
            system=[{
                "type": "text",
                "text": system,
                "cache_control": {"type": "ephemeral"},
            }],
            messages=[{"role": "user", "content": user}],
        )
    except Exception:  # noqa: BLE001
        logger.exception("ai_manager facilitator call failed")
        return fallback
    return _text_from_message(msg) or fallback


def _call_turn(system, user):
    """One facilitator turn as a FORCED tool call. Returns the parsed dict, or None.

    `tool_choice` names the tool, so the model has no free-text channel to the room at all
    — the words it says can only arrive through `message`, and everything it wants to
    think arrives through `reasoning`. That is the point: the previous design asked for
    the same separation in the prompt and the model overrode it under pressure, posting
    private case data to the students.

    Returns None on any failure so the caller can fall back to the text path rather than
    the room losing its facilitator over a transport error.
    """
    client = _get_client()
    if client is None:
        return None
    try:
        msg = client.messages.create(
            model=FACILITATOR_MODEL,
            max_tokens=FACILITATOR_TOOL_MAX_TOKENS,
            **sampling_kwargs(FACILITATOR_MODEL, 0),
            system=[{
                "type": "text",
                "text": system,
                "cache_control": {"type": "ephemeral"},
            }],
            # Cached with the system block: the schema is identical on every turn of every
            # room, and ACTR is asked after each student message.
            tools=[{**TURN_TOOL, "cache_control": {"type": "ephemeral"}}],
            tool_choice={"type": "tool", "name": TURN_TOOL["name"]},
            messages=[{"role": "user", "content": user}],
        )
    except Exception:  # noqa: BLE001
        logger.exception("ai_manager forced-tool turn failed")
        return None

    for block in (getattr(msg, "content", None) or []):
        if getattr(block, "type", None) == "tool_use" and block.name == TURN_TOOL["name"]:
            return parse_turn(block.input)
    return None


_PROGRESS_SYSTEM = (
    "You are auditing a debrief in progress to establish how much of its work the STUDENTS "
    "have actually done. This is not a quality judgement — only a reading of what has and "
    "has not yet been said out loud.\n\n"
    "Be strict in one specific way: an objective counts only when the STUDENTS reached it "
    "themselves. If the facilitator supplied a count, named a candidate, or explained the "
    "mechanism, that objective is NOT met — the facilitator doing their work for them is "
    "the failure this exercise exists to prevent.\n\n"
    "THE OBJECTIVES\n" + render_milestones()
)


def assess_progress(transcript, chosen_name=None, previous=None, candidates=None):
    """Which learning objectives the students have reached. None when it cannot be judged.

    `transcript` MUST be the whole debrief, not the rolling window the facilitator itself
    reads. The window is sized for "what is the room talking about now"; this question is
    "what has this room ever established", and asking it against the last twenty messages
    makes an objective evaporate the moment its evidence scrolls away — observed going 1/4
    → 0/4 mid-session.

    `previous` is the last reading, carried forward by `parse_progress` so an objective
    once achieved stays achieved.

    Called by the layer that owns the room, not on every turn — it is a third model call
    and the answer changes slowly. Every few student messages is plenty.

    Feeds `render_close_directive`, which is the only thing giving ACTR a sense of an
    ending. Left to itself it keeps finding one more good question and the debrief timer
    takes the landing away from it.
    """
    client = _get_client()
    if client is None or not (transcript or "").strip():
        return previous
    user = (f"The group hired {chosen_name or '(unknown)'}.\n\n"
            f"TRANSCRIPT SO FAR\n{transcript.strip()}")
    try:
        msg = client.messages.create(
            model=CHECKER_MODEL, max_tokens=CHECKER_MAX_TOKENS,
            **sampling_kwargs(CHECKER_MODEL, 0),
            system=[{"type": "text", "text": _PROGRESS_SYSTEM,
                     "cache_control": {"type": "ephemeral"}}],
            tools=[PROGRESS_TOOL],
            tool_choice={"type": "tool", "name": PROGRESS_TOOL["name"]},
            messages=[{"role": "user", "content": user}],
        )
    except Exception:  # noqa: BLE001
        logger.exception("ai_manager progress assessment failed")
        return previous
    for block in (getattr(msg, "content", None) or []):
        if getattr(block, "type", None) == "tool_use" and block.name == PROGRESS_TOOL["name"]:
            return parse_progress(block.input, previous, candidates)
    return previous


_CHECK_SYSTEM = (
    "You are auditing ONE drafted message from the facilitator of a hidden-profile group "
    "exercise, against the rules that exercise runs on. You are not judging whether the "
    "message is good, useful, warm or well-timed — only whether it breaks a listed rule.\n\n"
    "Report a rule ONLY when the draft actually breaks it, and quote the exact words that "
    "do. An empty list is the expected answer for most turns: the facilitator is usually "
    "asking a short question, which breaks nothing. Inventing a violation costs the room a "
    "turn it should have had.\n\n"
    "THE RULES\n" + render_constraints()
)


def _check_turn(draft, transcript):
    """Judge one drafted turn against the hard constraints. `[{"id", "quote"}]`, possibly empty.

    Two passes with different natures. `check_mechanical` counts sentences and question
    marks — arithmetic, free, and not delegated to a model that was observed waving through
    a five-sentence draft. The model pass handles the seven rules that need reading.

    Fails OPEN: if the checker errors or the client is missing, the draft is treated as
    clean. The alternative is a facilitator silenced by an unrelated transport failure,
    and an occasional unclean turn is much the cheaper of the two.
    """
    violations = check_mechanical(draft)

    client = _get_client()
    if client is None or not (draft or "").strip():
        return violations

    user = (f"RECENT TRANSCRIPT\n{(transcript or '(nothing yet)').strip()}\n\n"
            f"THE DRAFT TO JUDGE\n{draft.strip()}")
    try:
        msg = client.messages.create(
            model=CHECKER_MODEL, max_tokens=CHECKER_MAX_TOKENS,
            **sampling_kwargs(CHECKER_MODEL, 0),
            system=[{"type": "text", "text": _CHECK_SYSTEM,
                     "cache_control": {"type": "ephemeral"}}],
            tools=[CHECK_TOOL],
            tool_choice={"type": "tool", "name": CHECK_TOOL["name"]},
            messages=[{"role": "user", "content": user}],
        )
    except Exception:  # noqa: BLE001
        logger.exception("ai_manager constraint check failed")
        return violations

    seen = {v["id"] for v in violations}
    for block in (getattr(msg, "content", None) or []):
        if getattr(block, "type", None) == "tool_use" and block.name == CHECK_TOOL["name"]:
            for v in parse_check(block.input):
                # The mechanical verdict wins on a shared id: it counted, the model guessed.
                if v["id"] not in seen:
                    violations.append(v)
                    seen.add(v["id"])
    return violations


def _checked(system, user, result, transcript):
    """Audit a drafted turn, give it ONE chance to rewrite, then hold rather than post.

    One retry, not more: a second failure on the same draft means the model does not see
    the problem, and asking again mostly produces a third wording of it. Silence is always
    an acceptable facilitator turn — ACTR is asked after every student message and is
    expected to hold most of the time — so dropping a turn that cannot be made clean costs
    the room very little, while posting it can cost the whole exercise.

    `violations` rides back on the result for logging: until now nothing anywhere recorded
    that the facilitator misbehaved, so every rule was tuned by someone reading transcripts.
    """
    violations = _check_turn(result["message"], transcript)
    if not violations:
        return result

    named = "; ".join(f"{v['id']} — you wrote: \"{v['quote']}\"" for v in violations)
    retry = _call_turn(system, user + (
        "\n\nYOUR DRAFT BROKE THE RULES OF THIS EXERCISE:\n" + named +
        "\n\nWrite the turn again without doing that. Anything you need to reason about "
        "belongs in `reasoning`. If the point you were making cannot be made without "
        "breaking the rule, set speak to false — holding is always allowed."
    ))
    if retry is None or not retry.get("message"):
        return {**result, "message": None, "go_around": False, "ended": False,
                "violations": violations, "suppressed": True}

    still = _check_turn(retry["message"], transcript)
    if still:
        # Two strikes. Hold, and keep both verdicts so the run report shows the model was
        # given its chance rather than silenced on a single reading.
        return {**retry, "message": None, "go_around": False, "ended": False,
                "violations": violations + still, "suppressed": True}
    return {**retry, "violations": violations, "suppressed": False}


def _system(config, roster, group_size):
    """Build the per-room facilitator system prompt (static pedagogy + this case's pack)."""
    return build_facilitator_system(config, roster, group_size)


# --------------------------------------------------------------------------- #
# Public API. Each entry point fails soft; the socket layer decides WHEN to call.
# --------------------------------------------------------------------------- #
def render_solo_spread(spread, chosen_name=None):
    """Render the ANONYMOUS round-0 picks for the prompt. "" when there is nothing to say.

    Counts only, never names — see `ExerciseState.solo_spread`. This is what lets
    ACTR ask "someone walked in wanting a different person; what moved you?" without
    turning a private answer into a public one.
    """
    if not spread:
        return ""
    parts = [f"{n} for {name}" for name, n in
             sorted(spread.items(), key=lambda kv: (-kv[1], kv[0]))]
    line = "Before any discussion, privately: " + ", ".join(parts) + "."
    if chosen_name:
        line += f" The group then hired {chosen_name}."
    if len(spread) > 1:
        line += " They did not start out agreeing."
    return line


def facilitator_open_debrief(config, roster, group_size, chosen_name=None, verdict=None):
    """ACTR's first words of the whole session: open the round-2 debrief (M12).

    Written by the model, off the same system prompt as every other turn. It used to
    be two fixed strings branching on the verdict in Python — which put the opening
    move of the pedagogy where a professor's `facilitator_prompt_override` could not
    reach it, and where it could contradict the prompt it was meant to start. The
    stock prompt's step 1 asks something else entirely on a failure ("Could you have
    seen that coming?") and explicitly bars opening a failure with a "why"; the
    hardcoded line did neither. The prompt owns the opener now.

    The verdict is still supplied, but as a fact in the user message rather than as a
    branch here: which question it earns is step 1's decision, not this function's.

    Returns `(message, reasoning)`. The reasoning is the model's private narration of
    its own decision, split out by `_split_markers` so it can be persisted without
    being shown to anyone; "" when it wrote none.

    Fails to "" rather than to a canned line — a fallback opener written in Python is
    the exact thing this removes. Nothing is posted, the debrief still opens, and the
    first student message hands ACTR a turn through the normal reactive path.
    """
    cfg = config or {}
    outcome = ("worked out (SUCCESS)"
               if (verdict or "").strip().lower() == "success"
               else "did not work out (FAILURE)")

    user = "\n\n".join([
        f"The group hired: {chosen_name or '(nobody)'}",
        f"Its outcome document has just been posted to the room: the hire {outcome}.",
        "TASK: The debrief has just opened and nobody has spoken yet. Write your FIRST "
        "message — step 1 of THE SEQUENCE, the one you send once and never again — "
        "taking the branch that matches the outcome above. One short message. Do not "
        "reply SILENT and do not use any marker.",
    ])

    system = _system(cfg, roster, group_size)

    # Same forced tool as a reactive turn, so the opener cannot narrate either. `speak` is
    # ignored here: the debrief has to start with something, and the TASK above already
    # tells it not to hold.
    result = _call_turn(system, user)
    if result is not None:
        return result["message"] or "", result["reasoning"]

    text = _call(system, user, fallback="")
    if not text or _is_silent(text):
        return "", ""
    # Markers are stripped rather than acted on: an opener is by definition ACTR's
    # first and only turn so far, so there is no go-around to arm and nothing to end.
    body, _, _, _, reasoning = _split_markers(text)
    return body, reasoning


_ADVANCE_SYSTEM = (
    "You are the gatekeeper on a facilitated debrief. The facilitator works through a "
    "fixed sequence of steps and wants to leave the step it is on. Your only job is to "
    "decide whether that step's exit condition is ACTUALLY satisfied by what the STUDENTS "
    "have said in the transcript.\n\n"
    "Be strict, and be strict in one direction: a step left early cannot be returned to, "
    "because the facilitator will believe that work is behind it for the rest of the "
    "session. Work the facilitator merely RAISED does not count. Work the facilitator did "
    "FOR them counts for nothing at all — if it supplied a count, named a candidate or "
    "explained the mechanism, the students have not done that step.\n\n"
    "When steps are being skipped, every skipped step's condition must be met too. A room "
    "that genuinely did the work on its own should not be made to re-run it, but "
    "'they seem to understand' is not evidence that they did it.\n\n"
    "THE SEQUENCE\n"
)


def judge_step_advance(current_step, proposed_step, justification, transcript, skipped=None):
    """Rule on a step move. Returns `{approved, evidence, missing}`.

    Fails CLOSED, unlike the constraint checker: a transport error here means the room
    stays on the step it is on, and staying costs a turn while advancing wrongly costs
    the rest of the session. The two checkers fail in opposite directions on purpose.
    """
    refusal = {"approved": False, "evidence": "",
               "missing": "The step check could not be run, so nothing has moved."}
    client = _get_client()
    if client is None:
        return refusal

    skipped = skipped or []
    user = "\n\n".join([
        f"The facilitator is on step {current_step} and wants to move to {proposed_step}.",
        (f"Doing so SKIPS these steps entirely: {', '.join(skipped)}. Each of their exit "
         f"conditions must also be satisfied, or refuse.") if skipped else
        "This is a move to the next step, skipping nothing.",
        f"Its stated reason:\n{(justification or '(none given)').strip()}",
        f"TRANSCRIPT\n{(transcript or '').strip() or '(nothing yet)'}",
    ])
    try:
        msg = client.messages.create(
            model=CHECKER_MODEL, max_tokens=CHECKER_MAX_TOKENS,
            **sampling_kwargs(CHECKER_MODEL, 0),
            system=[{"type": "text", "text": _ADVANCE_SYSTEM + render_sequence(),
                     "cache_control": {"type": "ephemeral"}}],
            tools=[ADVANCE_TOOL],
            tool_choice={"type": "tool", "name": ADVANCE_TOOL["name"]},
            messages=[{"role": "user", "content": user}],
        )
    except Exception:  # noqa: BLE001
        logger.exception("ai_manager step gate failed")
        return refusal

    for block in (getattr(msg, "content", None) or []):
        if getattr(block, "type", None) == "tool_use" and block.name == ADVANCE_TOOL["name"]:
            return parse_advance(block.input)
    return refusal


def _gated(system, user, result, current_step, transcript):
    """Rule on a step move and, when it is refused, make the model write the turn again.

    Rewriting matters. The drafted message was composed FOR the step ACTR was moving to —
    in the run that prompted all this, a jump to F7 produced "write down the procedure,
    number them". Refusing the move but posting that message anyway would advance the
    conversation to the skipped step regardless, so the refusal has to reach the author,
    not just the bookkeeping. Same one-retry shape as `_checked`.

    Returns the result with `step` set to wherever the room actually is now, plus
    `step_gate` for the run report — the only record of a refusal that ever existed.
    """
    proposed = result.get("step")
    if not current_step:
        # No step is being tracked (an old room, or the very first turn) — adopt whatever
        # it proposed rather than gating a move from nowhere to somewhere.
        return {**result, "step": proposed if proposed and step_exists(proposed) else None}
    if not proposed or proposed == current_step or not step_exists(proposed):
        return {**result, "step": current_step}
    # Backwards is always allowed and never gated: the lucky-guess pivot (S6 → F3) is a
    # move the prompt explicitly calls for, and going back to redo work is never the
    # failure this gate exists to prevent.
    if not is_forward(current_step, proposed):
        return {**result, "step": proposed}

    skipped = skipped_between(current_step, proposed)
    verdict = judge_step_advance(current_step, proposed,
                                 result.get("step_done_because"), transcript, skipped)
    if verdict.get("approved"):
        return {**result, "step": proposed, "step_gate": {**verdict, "from": current_step,
                                                          "to": proposed}}

    retry = _call_turn(system, user + "\n\n" + render_refusal(current_step,
                                                              verdict.get("missing")))
    gate = {**verdict, "from": current_step, "to": proposed, "refused": True}
    if retry is None or not retry.get("message"):
        # It could not write a turn for the step it is on. Silence is a valid turn and
        # the room keeps its position, which is the whole point of refusing.
        return {**result, "message": None, "go_around": False, "ended": False,
                "step": current_step, "step_gate": gate}
    return {**retry, "step": current_step, "step_gate": gate}


def facilitator_reply(config, roster, group_size, transcript_summary, chosen_name=None,
                      turn_context=None, solo_spread=None, recent_asks=None,
                      outcome_text=None, progress=None, step=None, full_transcript=None,
                      recent_student_msgs=None):
    """A reactive facilitator turn during the debrief.

    Returns `{"message": str|None, "go_around": bool, "ended": bool, "reasoning": str}`
    — `message` is None when the model returns SILENT, `ended` is True when ACTR judges
    the debrief finished, and `reasoning` is the private narration split off the front
    of the reply (see `_split_markers`), persisted but never shown or replayed.

    Called after EVERY student message *in the debrief*. Nothing filters these calls,
    so the model is deciding "is it my turn" as well as "have I got anything", and
    SILENT is the expected answer most of the time. `turn_context` carries the facts
    that used to be enforced as gates — who still owes an answer to a go-around, how
    long the room has been quiet, how many messages since ACTR last spoke — which is
    what lets it hold during a go-around and step in when one has been abandoned.

    `solo_spread` is the anonymous round-0 tally; see `render_solo_spread`.

    `recent_asks` is ACTR's own last few turns, used to detect that it is about to ask
    the same question a third time. `recent_student_msgs` is the mirror image — the room
    minus ACTR — and feeds the pushback guard, which catches the turn where a student has
    demanded the answer so it gets refused rather than talked past. `outcome_text` is the
    full outcome document the room read — pinned into every turn rather than left to survive in the rolling transcript
    window, because ACTR cites it when ruling on what the group should have seen and a
    long debrief will eventually push it out.

    `progress` is the most recent `assess_progress` reading, or None. It is what gives the
    turn a sense of an ending: without it ACTR keeps finding one more good question and
    the debrief timer takes the landing away from it. Supplied by the caller rather than
    computed here so the extra model call runs every few messages, not every one.
    """
    cfg = config or {}
    fallback = None   # silence is the correct failure mode for a reactive turn

    task = [
        "TASK: Decide whether to speak. Read WHERE THE TURN STANDS above, then the "
        "discussion. If it is not your turn, or you have nothing genuinely additive, reply "
        "with exactly the single word SILENT and nothing else — that is the usual answer. "
        "Otherwise write ONE short message.",
        f"If your message asks every student in turn for an item, end it with {GO_AROUND_MARKER}.",
        "When the debrief has reached its ENDING condition, write your closing message and "
        f"end it with {END_MARKER}. That closes the session, so use it once and only when "
        "the group has actually got there.",
        "When your message answers or addresses ONE student, do NOT prefix their name — "
        "name them in `reply_to_name` instead (matching a name from the roster). The "
        "interface shows it as a reply to their message. Keep writing names in prose only "
        "when you address several people at once (e.g. a go-around).",
        THINKING_INSTRUCTION,
    ]
    if (turn_context or {}).get("silence"):
        task.append(
            "The room has gone quiet — a student spoke and nobody followed. Do NOT reply "
            "SILENT this time; the pause has become awkward and it is yours to break. It "
            "need not be a new move: pulling in whoever has not spoken is enough, e.g. "
            "\"Marco, you've been quiet — what did yours say?\""
        )
    # Appended LAST so it is the final thing read before the decision. Pace only — it
    # carries no case content, and every constraint still binds whatever it writes.
    # The STEP is passed as well as the objectives: where the gate has the room
    # overrules a generous objective reading, which is what let a debrief reach the
    # SOP before anyone had counted anything.
    closing = render_close_directive(progress, step)
    if closing:
        task.append(closing)

    # The step block goes INSIDE the turn brief rather than beside it, because "where am
    # I in the sequence" is the same kind of fact as "who still owes me an answer" — and
    # because the brief is the one block the model is told to read first.
    brief = render_turn_brief(turn_context)
    step_block = render_current_step(step) if step else ""
    if step_block:
        brief = step_block + "\n" + brief

    blocks = [
        "WHERE THE TURN STANDS\n" + brief,
        f"The group hired: {chosen_name or '(nobody)'}",
        render_solo_spread(solo_spread, chosen_name) or "No private picks were recorded.",
    ]
    if (outcome_text or "").strip():
        blocks.append(
            "THE OUTCOME DOCUMENT THE ROOM READ — quote it accurately or not at all:\n"
            + outcome_text.strip()
        )
    blocks.append(f"Discussion so far:\n{(transcript_summary or '').strip() or '(nothing yet)'}")
    # Sits directly above the TASK so it is the last thing read before the decision.
    repeat_guard = render_repeat_guard(
        recent_asks,
        names=[(e or {}).get("name") for e in (roster or [])],
        go_around_open=bool((turn_context or {}).get("go_around_open")),
    )
    if repeat_guard:
        blocks.append(repeat_guard)
    # Last block before the TASK, and after the repeat guard on purpose: a refusal is not
    # a repeat, so if both fire the "answer them" directive is the one read most recently.
    pushback_guard = render_pushback_guard(recent_student_msgs)
    if pushback_guard:
        blocks.append(pushback_guard)
    blocks.append("\n".join(task))

    user = "\n\n".join(blocks)

    system = _system(cfg, roster, group_size)

    # Forced tool first: it is the only path on which the model cannot put its reasoning
    # in front of the room. The text path stays as a fallback for a transport failure,
    # since silence caused by a 500 is worse than a slightly leaky turn.
    result = _call_turn(system, user)
    if result is not None:
        result = _gated(system, user, result, step,
                        full_transcript or transcript_summary)
        if CHECK_ENABLED and result.get("message"):
            result = _checked(system, user, result, transcript_summary)
        return result

    text = _call(system, user, fallback=fallback)
    if not text or _is_silent(text):
        return {"message": None, "go_around": False, "ended": False,
                "reasoning": "", "reply_to_name": None}
    message, go_around, ended, reply_to_name, reasoning = _split_markers(text)
    return {"message": message or None, "go_around": go_around, "ended": ended,
            "reasoning": reasoning, "reply_to_name": reply_to_name}


def facilitator_wrapup(config, roster, group_size, transcript_summary, chosen_name=None):
    """ACTR's closing message when the debrief BACKSTOP timer expires.

    Not the usual ending — normally ACTR closes the session itself with `END_MARKER`
    and this never runs. It exists for the room that talked past its window without
    getting there, so the session still closes on a facilitator's words rather than a
    screen change.
    """
    cfg = config or {}
    fallback = (
        "We're out of time. Before you go — write down the two or three rules you'd hand the "
        "next committee, in your own words."
    )
    user = "\n\n".join([
        f"The group hired: {chosen_name or '(nobody)'}",
        f"Discussion:\n{(transcript_summary or '').strip() or '(nothing)'}",
        "TASK: Time has run out on the debrief. Write your closing message per the ENDING "
        "rule. One short message.",
    ])
    text = _call(_system(cfg, roster, group_size), user, fallback=fallback)
    if not text or _is_silent(text):
        return fallback
    return _split_markers(text)[0] or fallback


# The sanctioned reasoning channel, appended to the TASK of a reactive turn. Without an
# allowed place to put it the model writes its narration into the message itself; with
# one, `_split_markers` can lift it out cleanly instead of relying on the blank-line
# fallback. Kept out of FACILITATOR_PROMPT so a professor's override cannot drop it.
THINKING_INSTRUCTION = (
    "If you need to reason before writing — who has answered, where the group is, whether "
    "this is your turn — put it on ONE line beginning THINKING: followed by a blank line, "
    "then the message itself. Everything before that blank line is private and is never "
    "shown to anyone. The message that follows must stand on its own: no recap, no "
    "narration about the students, just the thing you are saying to the room."
)
