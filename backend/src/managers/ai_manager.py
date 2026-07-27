# @language  Python
# @updated   2026-07-27
# @changed   facilitator_reply takes a silence flag: when the room has gone quiet it must not reply SILENT.
"""ACTR — the single facilitator voice in a `manager_exercise` room.

There are no AI players any more. The room is all real students; ACTR is one
voice in it, and its default is silence. It (a) asks which option the group chose,
(b) reveals the outcome and enters on the branch that fits, and (c) facilitates
the discussion reactively.

Every case-specific fact reaches the model through the rendered case pack in the
system prompt (`facilitator_prompt.build_facilitator_system`) — nothing about any
particular case is written here. The pedagogy lives in the prompt; this module is
call plumbing.

One thing is decided in Python rather than by the model, deliberately: **whether
a re-choice is permitted at all** (`case_pack.is_top_choice`), so it can never
drift with the model's mood. WHEN it is offered is the model's call, at step 11 of
the sequence, once the group has actually pooled and counted.

Turn-taking used to be decided in Python too — a quorum and a cooldown gating
whether ACTR was invoked. Those bought their guarantees with latency, so they are
gone. ACTR is now asked after every student message and decides for itself, from
the facts in `turn_context` plus the worked example in the prompt.

Fail-soft throughout, mirroring `src/facilitator/runner.py`: a missing key,
missing package, or failed call degrades to a safe fallback or silence and never
raises into a socket handler.
"""
import json
import logging
import os
import re

from src.managers import case_pack as case_pack_mod
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

# Appended when ACTR reaches MOVE 5 and is inviting the group to reopen the
# decision. Python decides WHETHER a re-choice is permitted (below-top-tally
# pick); the model decides WHEN it is offered.
#
# These are two different questions and conflating them is what made the ballot
# appear beside the disarm message, which reads as "you were wrong" no matter how
# carefully the message is worded.
REOPEN_MARKER = "[REOPEN]"

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
    """Strip the control markers off a reply. Returns (clean_text, go_around, offer_reopen).

    Trailing sentinels rather than a JSON envelope keep the message itself in
    ACTR's natural chat voice — a model asked to emit JSON tends to write like a
    form, and the whole point of this facilitator is that it doesn't.
    """
    body = (text or "").strip()
    go_around = GO_AROUND_MARKER in body
    offer_reopen = REOPEN_MARKER in body
    body = body.replace(GO_AROUND_MARKER, "").replace(REOPEN_MARKER, "").strip()
    return body, go_around, offer_reopen


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
def facilitator_open(config):
    """ACTR's first message: ask which option the group chose offline.

    Deliberately not model-generated — it is the same question every session, the
    ballot is already on screen beside it, and a fixed opener means a room can
    always start even with no API key.
    """
    cfg = config or {}
    pack = cfg.get("case_pack") or {}
    case_name = (pack.get("case_name") or "").strip()
    subject = f" for {case_name}" if case_name else ""
    return (
        f"Before we get into it — which candidate did your group choose{subject}? "
        "Enter it below and I'll show you how it went."
    )


def facilitator_on_pick(config, roster, group_size, chosen_name, forecast_text, transcript_summary=""):
    """ACTR's entry after the group's pick and its outcome have been revealed.

    Returns `{"message": str, "reopen_allowed": bool, "go_around": bool}`.

    `reopen_allowed` is computed in Python from the case pack and only records
    that a re-choice is *permitted*. It must NOT reopen the ballot here: a ballot
    appearing beside this message reads as "your answer was wrong" however gently
    the message is worded, which is the opposite of MOVE 1. The offer comes later,
    from ACTR, once the group has pooled and counted.
    """
    cfg = config or {}
    pack = cfg.get("case_pack") or {}
    option = case_pack_mod.option_by_name(pack, chosen_name) or {}
    verdict = option.get("outcome_verdict") or "failure"
    reopen_allowed = not case_pack_mod.is_top_choice(pack, chosen_name)

    fallback = (
        f"So — {chosen_name}. Before we look at why, what question did you three think "
        "you were answering when you sat down to decide?"
    )

    user = "\n\n".join([
        f"The group chose: {chosen_name}",
        f"Its outcome verdict: {verdict}",
        "The outcome document has just been posted in the chat. Its text:\n"
        + ((forecast_text or "").strip()[:6000] or "(not available)"),
        f"Discussion so far:\n{(transcript_summary or '').strip() or '(nothing yet)'}",
        "TASK: This is your first message after the reveal. Open with MOVE 1 (disarm), then ask "
        "the single question that starts the session, following the branch entry that matches "
        "this option's outcome verdict. One short message. Do not state any tally, do not name "
        "the best option, do not explain the mechanism, and do NOT suggest they choose again — "
        "that comes much later, at MOVE 5, and only after they have pooled and counted."
        f" If your message asks every student in turn for an item, end it with {GO_AROUND_MARKER}.",
    ])

    text = _call(_system(cfg, roster, group_size), user, fallback=fallback)
    if _is_silent(text):
        text = fallback
    message, go_around, _ = _split_markers(text)
    return {"message": message or fallback, "reopen_allowed": reopen_allowed, "go_around": go_around}


def facilitator_reply(config, roster, group_size, transcript_summary, chosen_name=None,
                      turn_context=None, reopen_allowed=False):
    """A reactive facilitator turn during discuss.

    Returns `{"message": str|None, "go_around": bool, "offer_reopen": bool}` —
    `message` is None when the model returns SILENT.

    Called after EVERY student message. Nothing filters these calls any more, so
    the model is deciding "is it my turn" as well as "have I got anything", and
    SILENT is the expected answer most of the time. `turn_context` carries the
    facts that used to be enforced as gates — who still owes an answer to a
    go-around, how long the room has been quiet, how many messages since ACTR last
    spoke — which is what lets it hold during a go-around and step in when one has
    been abandoned.

    `reopen_allowed` unlocks the MOVE 5 invitation. Without it the ballot stays
    shut no matter what the model emits, so a group that already picked the
    strongest option is never asked to reconsider.
    """
    cfg = config or {}
    fallback = None   # silence is the correct failure mode for a reactive turn

    task = [
        "TASK: Decide whether to speak. Read WHERE THE TURN STANDS above, then the "
        "discussion. If it is not your turn, or you have nothing genuinely additive, reply "
        "with exactly the single word SILENT and nothing else — that is the usual answer. "
        "Otherwise write ONE short message.",
        f"If your message asks every student in turn for an item, end it with {GO_AROUND_MARKER}.",
    ]
    if (turn_context or {}).get("silence"):
        task.append(
            "The room has gone quiet — a student spoke and nobody followed. Do NOT reply "
            "SILENT this time; the pause has become awkward and it is yours to break. It "
            "need not be a new move: pulling in whoever has not spoken is enough, e.g. "
            "\"Marco, you've been quiet — what did yours say?\""
        )
    if reopen_allowed:
        task.append(
            "The group may reopen their decision, but ONLY once they have pooled every option and "
            "said the totals out loud. When you reach MOVE 5 and are inviting them to choose "
            f"again, end your message with {REOPEN_MARKER} and the ballot will appear. Do not use "
            "it before then — a ballot arriving early reads as a verdict on their first answer."
        )

    user = "\n\n".join([
        "WHERE THE TURN STANDS\n" + render_turn_brief(turn_context),
        f"The group's current pick: {chosen_name or '(none yet)'}",
        f"Discussion so far:\n{(transcript_summary or '').strip() or '(nothing yet)'}",
        "\n".join(task),
    ])

    text = _call(_system(cfg, roster, group_size), user, fallback=fallback)
    if not text or _is_silent(text):
        return {"message": None, "go_around": False, "offer_reopen": False}
    message, go_around, offer_reopen = _split_markers(text)
    return {
        "message": message or None,
        "go_around": go_around,
        "offer_reopen": offer_reopen and reopen_allowed,
    }


def facilitator_wrapup(config, roster, group_size, transcript_summary, chosen_name=None):
    """ACTR's closing message when the discuss timer expires.

    Ends on the protocol ask rather than a summary — the prompt's ENDING rule is
    that the group writes the lesson down, not that ACTR recites it back.
    """
    cfg = config or {}
    fallback = (
        "We're out of time. Before you go — write down the two or three rules you'd hand the "
        "next committee, in your own words."
    )
    user = "\n\n".join([
        f"The group's final pick: {chosen_name or '(none)'}",
        f"Discussion:\n{(transcript_summary or '').strip() or '(nothing)'}",
        "TASK: The session is ending. Write your closing message per the ENDING rule. One short "
        "message. Do not summarize the lesson for them and do not name the best option.",
    ])
    text = _call(_system(cfg, roster, group_size), user, fallback=fallback)
    if not text or _is_silent(text):
        return fallback
    return _split_markers(text)[0] or fallback
