# @language  Python
# @updated   2026-08-04
# @changed   M9: ACTR is now a ROUND-2-ONLY voice. Removed facilitator_open_discussion (round-1 opener),
#            facilitator_call_vote, and the two-strike reveal (_REVEAL_SYSTEM / facilitator_reveal_answer)
#            along with the dead [REOPEN] path. Added facilitator_open_debrief (branches on the outcome
#            verdict), the anonymous round-0 spread in reactive turns, and the END marker that lets ACTR
#            close the session itself.
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

from src.managers.facilitator_prompt import build_facilitator_system, render_turn_brief

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
    """Strip the control markers off a reply. Returns (clean_text, go_around, ended).

    Trailing sentinels rather than a JSON envelope keep the message itself in
    ACTR's natural chat voice — a model asked to emit JSON tends to write like a
    form, and the whole point of this facilitator is that it doesn't.
    """
    body = (text or "").strip()
    go_around = GO_AROUND_MARKER in body
    ended = END_MARKER in body
    body = body.replace(GO_AROUND_MARKER, "").replace(END_MARKER, "").strip()
    return body, go_around, ended


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


def facilitator_open_debrief(config, chosen_name=None, verdict=None):
    """ACTR's first words of the whole session: open the round-2 debrief (M9).

    Deliberately not model-generated — a fixed opener means the debrief starts even
    with no API key, and this one line is the same every session. It branches on the
    OUTCOME rather than on a round number, because both outcomes now reach round 2:
    a group whose hire worked out still has to account for how it got there, which is
    the question a lucky group most needs asked.

    Answer-neutral either way: it opens the conversation without settling it.
    """
    who = chosen_name or "the person you picked"
    if (verdict or "").strip().lower() == "success":
        return (
            f"So {who} worked out. Before you take the credit, walk me back through it. "
            "What did each of you actually know when you made that call?"
        )
    return (
        f"So {who} didn't work out. You've all read what happened. "
        "What did you know at the time that would have pointed somewhere else?"
    )


def facilitator_reply(config, roster, group_size, transcript_summary, chosen_name=None,
                      turn_context=None, solo_spread=None):
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
    ]
    if (turn_context or {}).get("silence"):
        task.append(
            "The room has gone quiet — a student spoke and nobody followed. Do NOT reply "
            "SILENT this time; the pause has become awkward and it is yours to break. It "
            "need not be a new move: pulling in whoever has not spoken is enough, e.g. "
            "\"Marco, you've been quiet — what did yours say?\""
        )

    user = "\n\n".join([
        "WHERE THE TURN STANDS\n" + render_turn_brief(turn_context),
        f"The group hired: {chosen_name or '(nobody)'}",
        render_solo_spread(solo_spread, chosen_name) or "No private picks were recorded.",
        f"Discussion so far:\n{(transcript_summary or '').strip() or '(nothing yet)'}",
        "\n".join(task),
    ])

    text = _call(_system(cfg, roster, group_size), user, fallback=fallback)
    if not text or _is_silent(text):
        return {"message": None, "go_around": False, "ended": False}
    message, go_around, ended = _split_markers(text)
    return {"message": message or None, "go_around": go_around, "ended": ended}


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
