# @language  Python
# @updated   2026-08-03
# @changed   Added facilitator_open_codify — ACTR's opener for the post-correct-pick CODIFY reflection (explain the reasoning, codify the principles, no vote). Prior: facilitator_open_discussion is round-aware (round 2 opens with a "first hire failed, choose from the remaining" invitation).
"""ACTR — the single facilitator voice in a `manager_exercise` room.

There are no AI players any more. The room is all real students; ACTR is one
voice in it, and its default is silence. It (a) opens the PRE-VOTE deliberation,
(b) facilitates that discussion reactively while the group pools their role-sliced
credentials, (c) nudges them to vote when the window closes, and (d) on the second
wrong pick names the best option outright (the one scoped exception to "never name
it"). The outcome reveal itself is just the posted outcome document — there is no
post-reveal debrief phase any more.

Every case-specific fact reaches the model through the rendered case pack in the
system prompt (`facilitator_prompt.build_facilitator_system`) — nothing about any
particular case is written here. The pedagogy lives in the prompt; this module is
call plumbing.

Round 2 is no longer invited by ACTR: a wrong group pick drops the room into a
fresh deliberation automatically (the phase machine, `ExerciseState._finish_kiosk`),
so there is no `[REOPEN]` handshake here any more.

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

# Appended when ACTR reaches step 11 and is inviting the group to reopen the
# decision. Python decides WHETHER a re-choice is permitted (below-top-tally
# pick); the model decides WHEN it is offered.
#
# These are two different questions and conflating them is what made the ballot
# appear beside the opening message, which reads as "you were wrong" no matter how
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
def facilitator_open_discussion(config, round_num=1):
    """ACTR's first message: open the PRE-VOTE deliberation (M3).

    Deliberately not model-generated — it is the same invitation every session and a
    fixed opener means a room can always start even with no API key. It sets the task
    (pool what each of you was given, then decide together) without hinting at any
    answer; the reactive turns carry the facilitation from there.

    Round-aware: round 2 arrives after a failed first hire, so the opener acknowledges
    that and points the group at the REMAINING candidates instead of repeating the
    round-1 "compare notes for the first time" framing. Still answer-neutral.
    """
    if round_num and round_num >= 2:
        return (
            "That first hire didn't work out. Now you're choosing from the candidates you "
            "haven't tried yet. Put together what you each know about them and decide who "
            "your group wants to hire this time."
        )
    cfg = config or {}
    pack = cfg.get("case_pack") or {}
    case_name = (pack.get("case_name") or "").strip()
    subject = f" for {case_name}" if case_name else ""
    return (
        f"You've each seen a different slice of what's known about the candidates{subject}. "
        "Talk it through together. Put what you were given on the table, and work out who your "
        "group wants to hire. You'll vote once you've had a chance to compare notes."
    )


def facilitator_call_vote(config):
    """ACTR's short nudge when the deliberation window closes and the ballot opens (M3)."""
    return (
        "Alright, time to lock it in. Cast your vote for the candidate your group wants to hire."
    )


def facilitator_open_codify(config, chosen_name=None):
    """ACTR's opener for the CODIFY reflection after a CORRECT pick.

    Not model-generated — a fixed prompt keeps the room able to open with no API key,
    like the discussion opener. There is no decision to make here: the group already
    chose right, so this asks them to make the REASONING explicit and codify the
    principles, so the process transfers to the next hiring team.
    """
    who = (chosen_name or "").strip()
    subject = f"hiring {who}" if who else "this hire"
    return (
        f"You landed on the right call. Before we close, let's codify it — walk through "
        f"why {subject} was the strongest choice. What did each of you see in the evidence "
        "that mattered, and what principles would you write down so the next team makes this "
        "call as well? No vote this time — just make the thinking explicit."
    )


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
            "said the totals out loud. Whenever you are inviting them to choose again, "
            f"end your message with {REOPEN_MARKER} and the ballot will appear. Do not use "
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


# Dedicated system prompt for the two-strike reveal (M7). The STANDARD facilitator
# prompt forbids ever naming the best option; this turn is the deliberate exception,
# so it runs on its own prompt rather than fighting that invariant. Per the round-2
# nudge guidance the voice is human and dash-free.
_REVEAL_SYSTEM = (
    "You are ACTR, a warm, plain-spoken facilitator in a hiring case exercise. The student group "
    "has now made TWO hiring decisions and both were wrong, so the exercise is over and this is the "
    "final debrief. In THIS message you DO name the best candidate outright and explain, in two or "
    "three sentences, why they were the stronger hire than the two the group tried. Ground it in the "
    "specifics of this case, not generic advice. Warm and direct, a peer not a lecturer. Never use "
    "dashes. Keep it under about 70 words."
)


def facilitator_reveal_answer(config, roster, group_size, revealed_name, transcript_summary=""):
    """The two-strike answer reveal (M7). Names the best option and explains why.

    Returns a plain message string. Draws its explanation from the case pack's
    answer key (mechanism) and the revealed candidate's distinct strengths — the
    AI-only pack fields — so the reveal is specific to the case.
    """
    cfg = config or {}
    pack = cfg.get("case_pack") or {}
    key = pack.get("answer_key") or {}
    mechanism = (key.get("mechanism") or "").strip()
    option = case_pack_mod.option_by_name(pack, revealed_name) or {}
    strengths = option.get("distinct_strengths") or []
    names = ", ".join(e.get("name", "") for e in (roster or []) if e.get("name")) or "everyone"

    fallback = (
        f"so the one that actually fit was {revealed_name}. the other two looked strong but "
        f"{revealed_name} was the better hire for what this role really needed, and the outcomes "
        "were pointing right at it."
    )
    user = "\n\n".join([
        f"The best hire was: {revealed_name}",
        f"Why they fit (mechanism): {mechanism or '(use the strengths below)'}",
        "Their distinct strengths: " + ("; ".join(str(s) for s in strengths) if strengths else "(see case)"),
        f"Speaking to: {names}",
        f"Discussion so far:\n{(transcript_summary or '').strip() or '(nothing yet)'}",
        "TASK: reveal and explain now. Name them and say plainly why they beat the two the group "
        "chose. One short paragraph. No dashes.",
    ])
    text = _call(_REVEAL_SYSTEM, user, fallback=fallback)
    if not text or _is_silent(text):
        return fallback
    return _split_markers(text)[0] or fallback
