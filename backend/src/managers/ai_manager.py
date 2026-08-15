# @language  Python
# @updated   2026-08-15
# @changed   Facilitator quote-reply: a new [REPLY:name] marker lets ACTR attach a turn to the one student
#            it answers (parsed/stripped in _split_markers, surfaced as reply_to_name in facilitator_reply's
#            result); the socket layer resolves the name to that student's latest message. Name-prefixing is
#            kept for multi-person go-arounds a single reply-target can't represent.
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
1 — the private pick and the group's own deliberation and vote — happen with no
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

from src.managers.facilitator_prompt import (
    build_facilitator_system,
    render_repeat_guard,
    render_turn_brief,
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

# Returned instead of a message when ACTR has nothing worth saying this turn.
_SILENT_TOKEN = "SILENT"

# Appended when ACTR is answering ONE named student. The socket layer strips it and
# attaches the turn to that student's latest message as a quote-reply — the structured
# replacement for prefixing "Name, …". Names are still used in prose for a go-around
# addressing several people, which a single reply-target cannot represent. A mis-typed
# or unmatched name simply yields no reply (today's behaviour).
REPLY_MARKER_RE = re.compile(r"\[REPLY:\s*([^\]]+?)\s*\]", re.IGNORECASE)


def _get_client():
    """Return an Anthropic client, or None if key/package unavailable. Never raises."""
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        return None
    try:
        import anthropic
    except ImportError:
        return None
    try:
        return anthropic.Anthropic(api_key=api_key)
    except Exception:  # noqa: BLE001
        return None


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
    """True when the model used its veto — the bare word SILENT, nothing else."""
    return (text or "").strip().upper().rstrip(".!") == _SILENT_TOKEN


def _split_markers(text):
    """Strip the control markers off a reply. Returns (clean_text, go_around, ended, reply_to_name).

    Trailing sentinels rather than a JSON envelope keep the message itself in
    ACTR's natural chat voice — a model asked to emit JSON tends to write like a
    form, and the whole point of this facilitator is that it doesn't. `reply_to_name`
    is the target of a [REPLY:name] marker (None when absent), left for the socket
    layer to resolve to a message id.
    """
    body = (text or "").strip()
    go_around = GO_AROUND_MARKER in body
    ended = END_MARKER in body
    reply_match = REPLY_MARKER_RE.search(body)
    reply_to_name = reply_match.group(1).strip() if reply_match else None
    body = REPLY_MARKER_RE.sub("", body)
    body = body.replace(GO_AROUND_MARKER, "").replace(END_MARKER, "").strip()
    return body, go_around, ended, reply_to_name


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
            temperature=0,
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

    text = _call(_system(cfg, roster, group_size), user, fallback="")
    if not text or _is_silent(text):
        return ""
    # Markers are stripped rather than acted on: an opener is by definition ACTR's
    # first and only turn so far, so there is no go-around to arm and nothing to end.
    return _split_markers(text)[0]


def facilitator_reply(config, roster, group_size, transcript_summary, chosen_name=None,
                      turn_context=None, solo_spread=None, recent_asks=None,
                      outcome_text=None):
    """A reactive facilitator turn during the debrief.

    Returns `{"message": str|None, "go_around": bool, "ended": bool}` — `message` is
    None when the model returns SILENT, and `ended` is True when ACTR judges the
    debrief finished.

    Called after EVERY student message *in the debrief*. Nothing filters these calls,
    so the model is deciding "is it my turn" as well as "have I got anything", and
    SILENT is the expected answer most of the time. `turn_context` carries the facts
    that used to be enforced as gates — who still owes an answer to a go-around, how
    long the room has been quiet, how many messages since ACTR last spoke — which is
    what lets it hold during a go-around and step in when one has been abandoned.

    `solo_spread` is the anonymous round-0 tally; see `render_solo_spread`.

    `recent_asks` is ACTR's own last few turns, used to detect that it is about to ask
    the same question a third time. `outcome_text` is the full outcome document the room
    read — pinned into every turn rather than left to survive in the rolling transcript
    window, because ACTR cites it when ruling on what the group should have seen and a
    long debrief will eventually push it out.
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
        "instead end the message with [REPLY:their name] (matching a name from the roster). "
        "The interface shows it as a reply to their message. Keep writing names in prose only "
        "when you address several people at once (e.g. a go-around).",
    ]
    if (turn_context or {}).get("silence"):
        task.append(
            "The room has gone quiet — a student spoke and nobody followed. Do NOT reply "
            "SILENT this time; the pause has become awkward and it is yours to break. It "
            "need not be a new move: pulling in whoever has not spoken is enough, e.g. "
            "\"Marco, you've been quiet — what did yours say?\""
        )

    blocks = [
        "WHERE THE TURN STANDS\n" + render_turn_brief(turn_context),
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
    blocks.append("\n".join(task))

    user = "\n\n".join(blocks)

    text = _call(_system(cfg, roster, group_size), user, fallback=fallback)
    if not text or _is_silent(text):
        return {"message": None, "go_around": False, "ended": False, "reply_to_name": None}
    message, go_around, ended, reply_to_name = _split_markers(text)
    return {"message": message or None, "go_around": go_around, "ended": ended,
            "reply_to_name": reply_to_name}


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
