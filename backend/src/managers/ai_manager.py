# @language  Python
# @updated   2026-07-26
# @changed   Repurposed from AI-seat player to the single ACTR facilitator: open/on_pick/reply against the
#            static facilitator prompt + case pack. Removed seats, personalities, nudges, and AI voting.
"""ACTR — the single facilitator voice in a `manager_exercise` room.

There are no AI players any more. The room is all real students; ACTR is one
voice in it, and its default is silence. It (a) asks which option the group chose,
(b) reveals the outcome and enters on the branch that fits, and (c) facilitates
the discussion reactively.

Every case-specific fact reaches the model through the rendered case pack in the
system prompt (`facilitator_prompt.build_facilitator_system`) — nothing about any
particular case is written here. The pedagogy lives in the prompt; this module is
call plumbing.

Two things are decided in Python rather than by the model, deliberately:
  - **whether the pick was the top-tally option** (`case_pack.is_top_choice`), so
    the reopen decision can never drift with the model's mood;
  - **whether ACTR is invoked at all**, which the socket layer gates (quorum /
    debounce / cooldown) before calling in here.

Fail-soft throughout, mirroring `src/facilitator/runner.py`: a missing key,
missing package, or failed call degrades to a safe fallback or silence and never
raises into a socket handler.
"""
import json
import logging
import os
import re

from src.managers import case_pack as case_pack_mod
from src.managers.facilitator_prompt import build_facilitator_system

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


def _split_go_around(text):
    """Strip the GO_AROUND marker off a reply. Returns (clean_text, opened_go_around).

    Using a trailing sentinel rather than a JSON envelope keeps the message itself
    in ACTR's natural chat voice — a model asked to emit JSON tends to write like
    a form, and the whole point of this facilitator is that it doesn't.
    """
    body = (text or "").strip()
    if GO_AROUND_MARKER in body:
        return body.replace(GO_AROUND_MARKER, "").strip(), True
    return body, False


def _call(system, user, fallback=None):
    """One facilitator turn. Returns the model's text, or `fallback` on any failure."""
    client = _get_client()
    if client is None:
        return fallback
    try:
        msg = client.messages.create(
            model=FACILITATOR_MODEL,
            max_tokens=FACILITATOR_MAX_TOKENS,
            system=system,
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

    Returns `{"message": str, "reopen": bool, "go_around": bool}`.

    `reopen` is computed in Python from the case pack, never asked of the model:
    a below-top-tally pick reopens the ballot so the group can choose again. The
    message itself still must not say so outright — the prompt forbids naming the
    best option, and the invitation to re-choose is framed as a choice.
    """
    cfg = config or {}
    pack = cfg.get("case_pack") or {}
    option = case_pack_mod.option_by_name(pack, chosen_name) or {}
    verdict = option.get("outcome_verdict") or "failure"
    reopen = not case_pack_mod.is_top_choice(pack, chosen_name)

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
        "the best option, do not explain the mechanism."
        f" If your message asks every student in turn for an item, end it with {GO_AROUND_MARKER}.",
    ])

    text = _call(_system(cfg, roster, group_size), user, fallback=fallback)
    if _is_silent(text):
        text = fallback
    message, go_around = _split_go_around(text)
    return {"message": message or fallback, "reopen": reopen, "go_around": go_around}


def facilitator_reply(config, roster, group_size, transcript_summary, chosen_name=None,
                      go_around_timed_out=False):
    """A reactive facilitator turn during discuss.

    Returns `{"message": str|None, "go_around": bool}` — `message` is None when the
    model returns SILENT, which is its own veto on top of the socket layer's gates.
    Called ONLY when those gates have already decided this is a plausible moment to
    speak, so the model is judging "do I have something worth saying", not "is it
    my turn".

    `go_around_timed_out` tells ACTR a student never answered, so it works with the
    partial set instead of continuing to wait. It is not told who is missing —
    naming an absent student in front of peers is not worth the completeness.
    """
    cfg = config or {}
    fallback = None   # silence is the correct failure mode for a reactive turn

    task = [
        "TASK: React to the discussion below in ONE short message, but ONLY if one of your "
        "SPEAK conditions holds. If none of them holds, reply with exactly the single word "
        "SILENT and nothing else.",
        f"If your message asks every student in turn for an item, end it with {GO_AROUND_MARKER}.",
    ]
    if go_around_timed_out:
        task.append(
            "NOTE: you asked the group to go around and not everyone answered in time. Work with "
            "the answers you did get and move the session forward. Do not name who did not answer."
        )

    user = "\n\n".join([
        f"The group's current pick: {chosen_name or '(none yet)'}",
        f"Discussion so far:\n{(transcript_summary or '').strip() or '(nothing yet)'}",
        "\n".join(task),
    ])

    text = _call(_system(cfg, roster, group_size), user, fallback=fallback)
    if not text or _is_silent(text):
        return {"message": None, "go_around": False}
    message, go_around = _split_go_around(text)
    return {"message": message or None, "go_around": go_around}


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
    return _split_go_around(text)[0] or fallback
