# @language  Python
# @updated   2026-07-30
# @changed   M8: new grader — deterministic group outcome + per-student participation, plus an optional
#            fail-soft LLM communication score against the faculty rubric. Reintroduces scoring at `done`.
"""
Grade a finished Manager-Exercise room (M8).

The rewrite had removed grading entirely; this brings it back, scoped to what the
new (offline-decision, facilitated-debrief) model can actually judge:

  * GROUP outcome — did the group land on the correct hire, and how (first pick,
    recovered on the second, or failed into the two-strike reveal). Deterministic,
    read straight off the ExerciseState.
  * PER-STUDENT participation — did they speak at all, and (once a second round
    happened) did they take part in the round-2 discussion. Deterministic.
  * PER-STUDENT communication — an optional LLM judgement against the faculty
    rubric. Entirely fail-soft: no API key, a model error, or unparseable output
    simply omits the score; grading never raises into the socket layer.

The whole thing is best-effort: the deterministic core always produces a scorecard.
"""
import json
import logging
import re

logger = logging.getLogger(__name__)


def grade_exercise(state, rubric_text="", transcript_summary=""):
    """Grade a finished room. Returns {"group": {...}, "students": {name: {...}}}.

    Never raises — the caller runs this at `done` and any failure must not stop the
    room from closing out.
    """
    roster = getattr(state, "roster", None) or []
    spoke = set(getattr(state, "speakers", None) or [])
    reached_round2 = getattr(state, "round", 1) >= 2
    round2_absent = set(state.round2_absentees()) if reached_round2 else set()

    # --- Deterministic per-student core ------------------------------------
    students = {}
    for e in roster:
        uid = e.get("uid")
        name = e.get("name") or "Student"
        students[name] = {
            "name": name,
            "participated": uid in spoke,
            # None before a second round ever happened, so the UI can hide the flag.
            "participated_round2": (name not in round2_absent) if reached_round2 else None,
            "communication": None,
            "note": "",
        }

    # --- Deterministic group result ----------------------------------------
    outcome = state.group_outcome()
    group = {
        "outcome": outcome,   # correct_first | recovered | failed | incomplete
        "chosen_candidate": getattr(state, "chosen_candidate", None),
        "strikes": getattr(state, "strikes", 0),
        "rounds": getattr(state, "round", 1),
        "revealed_candidate": getattr(state, "revealed_candidate", None) if outcome == "failed" else None,
    }

    # --- Optional LLM communication layer (fail-soft) ----------------------
    try:
        _apply_communication_scores(students, rubric_text, transcript_summary)
    except Exception:  # noqa: BLE001 — participation-only grades are a fine fallback
        logger.exception("communication grading failed; returning participation-only grades")

    return {"group": group, "students": students}


def _apply_communication_scores(students, rubric_text, transcript_summary):
    """Layer a 0-100 communication score + one-line note onto each student in place.

    Uses the shared facilitator model/client. Silent no-op when unavailable.
    """
    from src.managers import ai_manager  # local import: avoids a cycle at module load

    client = ai_manager._get_client()
    if client is None or not students:
        return

    names = list(students.keys())
    rubric = (rubric_text or "").strip() or (
        "Rate each student's contribution to the discussion: did they surface evidence "
        "from their own sheet, build on what others said, and reason toward a fit-based "
        "hiring decision rather than a headline-qualification one?"
    )
    system = (
        "You are grading students' participation in a group hiring-case discussion. Apply the "
        "rubric fairly. For EACH named student, return a communication score from 0 to 100 and a "
        "one-sentence note. Respond with STRICT JSON only: an object mapping each exact student "
        'name to {"score": <int 0-100>, "note": "<one sentence>"}. No text outside the JSON.'
    )
    user = "\n\n".join([
        f"Rubric:\n{rubric}",
        f"Students (use these exact names as keys): {', '.join(names)}",
        f"Discussion transcript / summary:\n{(transcript_summary or '').strip() or '(very little was said)'}",
        "Return the JSON now.",
    ])

    try:
        msg = client.messages.create(
            model=ai_manager.FACILITATOR_MODEL,
            max_tokens=900,
            temperature=0,
            system=[{"type": "text", "text": system}],
            messages=[{"role": "user", "content": user}],
        )
    except Exception:  # noqa: BLE001
        logger.exception("grader model call failed")
        return

    data = _extract_json_obj(ai_manager._text_from_message(msg) or "")
    if not isinstance(data, dict):
        return
    for name, g in students.items():
        entry = data.get(name)
        if not isinstance(entry, dict):
            continue
        score = entry.get("score")
        if isinstance(score, (int, float)):
            g["communication"] = max(0, min(100, int(score)))
        note = entry.get("note")
        if isinstance(note, str):
            g["note"] = note.strip()[:240]


def _extract_json_obj(text):
    """Best-effort parse of a JSON object out of a model reply (fences / stray prose tolerated)."""
    text = (text or "").strip()
    if text.startswith("```"):
        text = text.strip("`")
        text = text.split("\n", 1)[1] if "\n" in text else text
    try:
        return json.loads(text)
    except Exception:  # noqa: BLE001
        m = re.search(r"\{.*\}", text, re.DOTALL)
        if m:
            try:
                return json.loads(m.group(0))
            except Exception:  # noqa: BLE001
                return None
    return None
