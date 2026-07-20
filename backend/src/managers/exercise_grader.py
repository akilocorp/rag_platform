# @language  Python
# @updated   2026-07-20
# @changed   New: Manager Exercise LLM-judge grading (communication rubric + deterministic vote correctness → weighted per-uid grades).
"""
Manager Exercise grading.

`grade_exercise(...)` is the single entry point the sockets layer calls at the
`grading -> done` transition. It produces a per-participant grade dict matching
the `manager_exercise_sessions.grades` schema (contract §2 / §6d):

    { "<uid>": { communication, individual_correct, collective_correct, total, feedback } }

Three components, weighted by the config's `grading_weights`:
  - communication : an LLM-judge (Claude rubric, claude-sonnet-4-6) scores each
                    participant's contribution quality 0..1 from the transcript.
  - individual    : deterministic — individual_votes[uid] == correct_candidate.
  - collective    : deterministic — collective_vote == correct_candidate (shared).

Self-contained and copies the raw-Anthropic pattern from facilitator/runner.py
(`_get_client`, `_text_from_message`, `_extract_json`). Every Anthropic call
degrades gracefully — a missing key/package or any API error yields neutral
communication scores rather than raising into the socket handler.
"""
import json
import logging
import os
import re

logger = logging.getLogger(__name__)

# Reasoning-grade model for the communication rubric (contract §8: claude-sonnet-4-6).
GRADER_MODEL = os.getenv("EXERCISE_GRADER_MODEL", "claude-sonnet-4-6")
# Room for a rubric verdict over N participants (score + short rationale each).
GRADER_MAX_TOKENS = 1500
# Neutral communication sub-score used whenever the LLM judge is unavailable or
# a participant can't be scored — keeps grading fully functional key-less.
_NEUTRAL_COMM = 0.5
# Cap transcript lines fed to the judge so a long discuss phase can't overflow.
_MAX_TRANSCRIPT_LINES = 200
_MAX_LINE_CHARS = 600


def _get_client():
    """Build an Anthropic client, or None if key/package is missing (fail-soft)."""
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
    """Concatenate the text blocks of an Anthropic message response."""
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


def _normalize_weights(grading_weights):
    """Return {communication, individual, collective} weights normalized to sum 1.

    Missing keys default to equal thirds; negatives are clamped to 0. If the total
    is non-positive (all zero / all invalid) fall back to equal thirds so `total`
    is always a meaningful weighted average.
    """
    gw = grading_weights if isinstance(grading_weights, dict) else {}
    keys = ("communication", "individual", "collective")
    raw = {}
    for k in keys:
        try:
            v = float(gw.get(k, 1.0 / 3.0))
        except (TypeError, ValueError):
            v = 1.0 / 3.0
        raw[k] = v if v > 0 else 0.0
    total = sum(raw.values())
    if total <= 0:
        return {k: 1.0 / 3.0 for k in keys}
    return {k: raw[k] / total for k in keys}


def _clamp01(x):
    """Coerce x to a float in [0, 1]; None/garbage -> the neutral score."""
    try:
        v = float(x)
    except (TypeError, ValueError):
        return _NEUTRAL_COMM
    if v < 0.0:
        return 0.0
    if v > 1.0:
        # Tolerate a 0..100 rubric answer by rescaling; otherwise clamp.
        return min(v / 100.0, 1.0) if v <= 100.0 else 1.0
    return v


def _build_transcript_text(transcript, seat_roles):
    """Render the chat transcript as `role (uid): text` lines for the judge prompt.

    `transcript` is a list of {sender, text}; `sender` is a uid (or "ai:<idx>").
    We annotate each line with the participant's role_name so the judge can
    attribute contributions per uid.
    """
    roles = seat_roles if isinstance(seat_roles, dict) else {}
    rows = []
    for m in (transcript or [])[-_MAX_TRANSCRIPT_LINES:]:
        if not isinstance(m, dict):
            continue
        sender = str(m.get("sender") or "").strip()
        text = str(m.get("text") or "").strip()
        if not sender or not text:
            continue
        role = roles.get(sender)
        label = f"{role} [{sender}]" if role else sender
        rows.append(f"{label}: {text[:_MAX_LINE_CHARS]}")
    return "\n".join(rows)


def _build_comm_system():
    """System prompt: a strict rubric judge that returns per-uid JSON only."""
    return (
        "You are an impartial grader for a business-school hidden-profile group exercise. "
        "Students play named managerial roles; each held a private document with a different "
        "subset of candidate facts and had to POOL their unique facts in a group chat to judge "
        "the best-FIT candidate for a role (best fit is not necessarily most-qualified).\n\n"
        "Score EACH participant's COMMUNICATION QUALITY during the discussion on a 0-100 scale, "
        "judging: did they share their unique information, build on others, ask clarifying "
        "questions, and move the group toward a fit-based decision? Passive, absent, or purely "
        "off-topic participants score low; participants who surfaced unique facts and synthesized "
        "score high.\n\n"
        "Return ONLY a JSON object mapping each participant's uid to "
        '{ "score": <int 0-100>, "rationale": "<one short sentence>" }. '
        "Use the exact uid strings shown in brackets. Output ONLY the JSON object, no prose."
    )


def _build_comm_user(transcript_text, seat_roles):
    """User prompt: the roster of uids to score plus the rendered transcript."""
    roles = seat_roles if isinstance(seat_roles, dict) else {}
    roster = ", ".join(
        f'{uid} ("{role}")' if role else uid for uid, role in roles.items()
    ) or "(no roster provided; infer participants from the transcript)"
    body = transcript_text or "(the discussion transcript is empty)"
    return (
        f"Participants to score (uid and role): {roster}\n\n"
        f"Discussion transcript:\n{body}\n\n"
        "Score every listed participant. Return ONLY the JSON object keyed by uid."
    )


def grade_communication(transcript, seat_roles, client=None):
    """LLM-judge communication scores.

    Returns { "<uid>": {"score": <float 0..1>, "rationale": "<str>"} } for every
    uid in `seat_roles`. Fail-soft: any missing key / API error / unparsable reply
    yields the neutral score for every uid so downstream weighting still works.

    `seat_roles` = { uid: role_name } (uids include AI seats as "ai:<idx>").
    `transcript` = list of {sender, text}.
    """
    roles = seat_roles if isinstance(seat_roles, dict) else {}
    uids = list(roles.keys())
    neutral = {uid: {"score": _NEUTRAL_COMM, "rationale": ""} for uid in uids}

    if not uids:
        return {}

    client = client or _get_client()
    if client is None:
        return neutral

    transcript_text = _build_transcript_text(transcript, roles)

    try:
        msg = client.messages.create(
            model=GRADER_MODEL,
            max_tokens=GRADER_MAX_TOKENS,
            system=_build_comm_system(),
            messages=[{"role": "user", "content": _build_comm_user(transcript_text, roles)}],
        )
    except Exception:  # noqa: BLE001
        logger.exception("exercise communication grading model call failed")
        return neutral

    parsed = _extract_json(_text_from_message(msg))
    if not isinstance(parsed, dict):
        return neutral

    # Map the judge's per-uid verdict onto our roster; any uid the judge omitted
    # or malformed keeps the neutral default.
    out = dict(neutral)
    for uid in uids:
        entry = parsed.get(uid)
        if not isinstance(entry, dict):
            continue
        rationale = entry.get("rationale")
        out[uid] = {
            "score": _clamp01(entry.get("score")),
            "rationale": str(rationale).strip() if rationale else "",
        }
    return out


def grade_exercise(config, transcript, individual_votes, collective_vote,
                   correct_candidate, seat_roles):
    """Grade every participant of a finished Manager Exercise.

    Returns the per-uid grades structure the sockets layer emits/persists:
        { "<uid>": { "communication": <float 0..1>,
                     "individual_correct": <bool>,
                     "collective_correct": <bool>,
                     "total": <float 0..1>,
                     "feedback": "<str>" } }

    Components:
      - communication      : LLM-judge sub-score (claude-sonnet-4-6), 0..1.
      - individual_correct : individual_votes[uid] == correct_candidate.
      - collective_correct : collective_vote == correct_candidate (same for all).
      - total              : weighted by config.grading_weights (normalized to 1).

    Never raises — Anthropic failures fall back to neutral communication scores,
    and the deterministic components are always computable.

    Args:
      config           : the manager_exercise sub-object (reads grading_weights).
      transcript       : list of {sender, text} (from context_manager messages).
      individual_votes : { uid: candidate_name }  (uids include "ai:<idx>").
      collective_vote  : the finalized group pick (candidate name) or None.
      correct_candidate: ground-truth best-fit candidate name.
      seat_roles       : { uid: role_name } — the full participant roster.
    """
    cfg = config if isinstance(config, dict) else {}
    votes = individual_votes if isinstance(individual_votes, dict) else {}
    roles = seat_roles if isinstance(seat_roles, dict) else {}

    weights = _normalize_weights(cfg.get("grading_weights"))

    # Collective correctness is shared across all participants.
    collective_correct = bool(
        correct_candidate is not None and collective_vote == correct_candidate
    )

    # One Claude call scores everyone; fail-soft to neutral per uid.
    comm = grade_communication(transcript, roles)

    grades = {}
    for uid in roles.keys():
        comm_entry = comm.get(uid) or {}
        comm_score = _clamp01(comm_entry.get("score"))
        rationale = str(comm_entry.get("rationale") or "").strip()

        individual_correct = bool(
            correct_candidate is not None and votes.get(uid) == correct_candidate
        )

        total = (
            weights["communication"] * comm_score
            + weights["individual"] * (1.0 if individual_correct else 0.0)
            + weights["collective"] * (1.0 if collective_correct else 0.0)
        )

        grades[uid] = {
            "communication": round(comm_score, 4),
            "individual_correct": individual_correct,
            "collective_correct": collective_correct,
            "total": round(total, 4),
            "feedback": rationale,
        }

    return grades
