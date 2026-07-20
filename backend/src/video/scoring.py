"""Scoring layer — turns the ACTR analyze output (a body-language/delivery
`report` + a `transcript`) into prof-defined dimension scores + actionable
feedback, via a 3-stage sequential agent chain.
# rearchitected 2026-06-22

Pipeline (each stage is one focused LLM call; output feeds the next — the
"separate agent per task" pattern from Mollick et al., PitchQuest):

  Stage 1  General Presentation Agent
           Judges the video against UNIVERSAL presentation standards (delivery,
           structure, clarity, energy) — independent of the professor's rubric.

  Stage 2  Prof-Defined Agent
           Takes Stage 1 + the professor's named dimensions and content checks,
           and analyzes the speaker on each (evidence first, no numbers yet).
           The agent decides which signals — report and/or transcript — are
           relevant to each dimension from its definition.

  Stage 3  Final Output Agent
           Produces the student-facing report: a score /10 + a one-paragraph
           rationale per dimension, content-check grades, an opening-gambit
           grade (if defined), and holistic coaching. Numbers are secondary —
           the written rationale is the product.

DECOUPLED from collection: reads `video_collected_data` (report + transcript),
never calls the ACTR API. Re-runnable (rescore) reads the same collected data.
"""
import json
import logging
import re
import time

from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage

logger = logging.getLogger(__name__)

# Filler set — used only for the lightweight transcript analytics below
# (the heavy delivery analysis now lives in the ACTR `report`).
FILLER_WORDS = {
    "um", "umm", "uh", "uhh", "uhm", "er", "erm", "emm", "ah", "aah", "aa",
    "eh", "hmm", "hm", "mm", "mhm", "like", "so", "well", "right", "okay",
    "ok", "alright", "yeah", "yep", "ya", "yea", "basically", "actually",
    "literally", "honestly", "essentially", "anyway", "anyways",
}
FILLER_PHRASES = ["you know", "i mean", "you see", "right so", "so yeah", "and so"]

# Universal presentation-quality standards used by Stage 1, independent of any
# subject-specific rubric. Kept as a module constant so the general pass is
# consistent across configs.
GENERAL_PRESENTATION_CRITERIA = (
    "- Structure & clarity: a clear opening, logical flow, and a clean close; ideas are easy to follow.\n"
    "- Verbal delivery: appropriate pace, minimal filler/hedging, vocal variety, no long awkward pauses.\n"
    "- Body language & presence: composed posture, purposeful gestures, steady gaze, controlled movement (not fidgety or stiff).\n"
    "- Engagement & energy: animation and enthusiasm that hold attention without becoming frantic.\n"
    "- Conciseness & completion: makes its point efficiently and finishes cleanly."
)

# Model + determinism: temp 0 + fixed seed so a rescore of unchanged data grades
# reproducibly across the whole chain.
_MODEL = "gpt-4o"
_SEED = 42


def _clamp(x, lo=0.0, hi=100.0):
    return max(lo, min(hi, x))


def _label_for(value):
    if value is None:
        return "N/A"
    if value >= 80:
        return "Excellent"
    if value >= 65:
        return "Strong"
    if value >= 50:
        return "Developing"
    if value >= 35:
        return "Needs work"
    return "Weak"


def _parse_json(text):
    text = (text or "").strip()
    for pattern in (r'\{.*\}', r'\[.*\]'):
        m = re.search(pattern, text, re.DOTALL)
        if m:
            try:
                return json.loads(m.group())
            except Exception:
                pass
    return json.loads(text)


def _llm(api_key, max_tokens=2000):
    return ChatOpenAI(model=_MODEL, api_key=api_key, max_tokens=max_tokens, temperature=0, seed=_SEED)


# --- lightweight transcript analytics (no word timestamps from ACTR) ---------

def _basic_analytics(transcript_text: str, duration: float, target_duration_sec: int) -> dict:
    """Minimal quantitative view the results header + competence card still use.
    The rich Yoodli-style breakdown is gone — the ACTR report carries delivery
    detail in prose now, and we no longer get per-word timestamps."""
    low = (transcript_text or "").lower()
    tokens = re.findall(r"[a-z']+", low)
    total = len(tokens) or 1
    wpm = round(len(tokens) / (duration / 60.0)) if duration else 0
    filler_n = sum(1 for t in tokens if t in FILLER_WORDS) + sum(low.count(p) for p in FILLER_PHRASES)
    filler_pct = round(100.0 * filler_n / total, 1)
    delta = round(duration - target_duration_sec, 1)
    if abs(delta) <= 5:
        comp_status = "good"
    elif delta < -10:
        comp_status = "short"
    elif delta > 10:
        comp_status = "over"
    else:
        comp_status = "warn"
    return {
        "talk_time_sec": round(duration, 1),
        "completion": {
            "duration_sec": round(duration, 1),
            "target_sec": target_duration_sec,
            "delta_sec": delta,
            "status": comp_status,
            "label": f"{round(duration, 1)}s / {target_duration_sec}s target",
        },
        "word_choice": {
            "filler_words": {
                "count": filler_n,
                "pct": filler_pct,
                "instances": [],  # no per-word timestamps from ACTR
                "status": "good" if filler_n <= 2 else "warn" if filler_n <= 5 else "bad",
                "label": f"{filler_n} filler word{'s' if filler_n != 1 else ''}",
                "benchmark": "Keep filler words to 1 or fewer.",
            },
        },
        "delivery": {"pace": {"wpm": wpm}},
    }


# --- 3-stage agent chain -----------------------------------------------------

def _dimension_lines(dimensions):
    return "\n".join(f'- {d.get("id")} ({d.get("name", d.get("id"))}): {d.get("definition", "")}'
                     for d in dimensions)


def _check_lines(checks):
    return "\n".join(f'- {c.get("id")} ({c.get("label", c.get("id"))}): {c.get("description", "")}'
                     for c in checks)


def _stage1_general(api_key, report, transcript_text):
    """General presentation assessment against universal standards."""
    prompt = f"""You are an expert presentation coach. Evaluate this video presentation against GENERAL presentation standards only — ignore any subject-specific rubric for now.

GENERAL PRESENTATION STANDARDS:
{GENERAL_PRESENTATION_CRITERIA}

You are given two objective inputs extracted from the video.

BODY LANGUAGE & DELIVERY REPORT (gestures, gaze, posture, pace, pauses, vocal pitch/intensity):
\"\"\"
{report or "(no delivery report available)"}
\"\"\"

TRANSCRIPT (the words spoken):
\"\"\"
{(transcript_text or "(no transcript available)")[:7000]}
\"\"\"

Return ONLY a valid JSON object (no markdown):
{{
  "delivery": "<2-4 sentences on verbal + body-language delivery, citing specifics from the report>",
  "content": "<2-4 sentences on the structure and clarity of what was said, from the transcript>",
  "overall_impression": "<1-2 sentences>",
  "strengths": ["<specific>", "..."],
  "weaknesses": ["<specific>", "..."]
}}"""
    raw = _llm(api_key, max_tokens=1200).invoke([HumanMessage(content=prompt)]).content
    return _parse_json(raw)


def _stage2_prof_defined(api_key, report, transcript_text, general, dimensions, content_checks):
    """Evidence-grounded analysis against the professor's dimensions + checks. No numbers yet."""
    prompt = f"""You are an expert evaluator applying THIS professor's specific rubric to a video presentation.

Use this general assessment as context:
{json.dumps(general, ensure_ascii=False)}

Objective inputs:
BODY LANGUAGE & DELIVERY REPORT:
\"\"\"
{report or "(no delivery report available)"}
\"\"\"
TRANSCRIPT:
\"\"\"
{(transcript_text or "(no transcript available)")[:7000]}
\"\"\"

The professor defined these scoring DIMENSIONS. For EACH, decide which evidence is relevant per its definition — use the delivery report, the transcript, or both as the definition warrants — and analyze how the speaker performed. Do NOT assign a number yet; just analyze with concrete evidence.
DIMENSIONS:
{_dimension_lines(dimensions) or "(none)"}

The professor also defined these CONTENT CHECKS, judged against the TRANSCRIPT (was each element present, and how well):
{_check_lines(content_checks) or "(none)"}

Return ONLY a valid JSON object (no markdown):
{{
  "dimensions": [{{"id": "<id>", "analysis": "<evidence-grounded analysis>"}}],
  "content_checks": [{{"id": "<id>", "assessment": "<present? how well, with evidence from the transcript>"}}]
}}"""
    raw = _llm(api_key, max_tokens=2500).invoke([HumanMessage(content=prompt)]).content
    return _parse_json(raw)


def _stage3_final(api_key, grading_criteria, report, transcript_text, general, prof, dimensions, content_checks, has_gambit):
    """Final student-facing report: grades + one-paragraph rationales + coaching."""
    gambit_field = (
        '\n  "opening_gambit": {"score": <0-10 — 0 if no recognizable hook>, "comment": "<gambit type used or '
        '\'No gambit detected\'; if score < 7 include one concrete stronger opening for this pitch>"},'
        if has_gambit else ""
    )
    gambit_rule = (
        "\n- opening_gambit: 0 if the speaker launches straight in with no hook; 1-4 weak/accidental hook; "
        "5-6 recognizable but flat; 7-10 deliberate and attention-grabbing. Always name the gambit type."
        if has_gambit else ""
    )
    non_gambit_checks = [c for c in content_checks if c.get("id") != "gambit"]
    prompt = f"""You are the final evaluator. Produce the student's feedback report. The written rationale is the most important output — numerical scores are secondary, so keep them honest but let the explanation do the work. Be specific, evidence-based, and encouraging.

Professor's grading philosophy / instructions:
{grading_criteria or "(use standard, fair presentation grading)"}

General assessment (Stage 1):
{json.dumps(general, ensure_ascii=False)}

Per-dimension & per-check analysis (Stage 2):
{json.dumps(prof, ensure_ascii=False)}

Objective inputs (for any final verification):
BODY LANGUAGE & DELIVERY REPORT:
\"\"\"
{report or "(no delivery report available)"}
\"\"\"
TRANSCRIPT:
\"\"\"
{(transcript_text or "(no transcript available)")[:6000]}
\"\"\"

Grade these DIMENSIONS. Each gets a score 1-10 AND a ONE-paragraph rationale (3-5 sentences) explaining WHY they earned that score, citing concrete evidence from the delivery report and/or transcript:
{_dimension_lines(dimensions) or "(none)"}

Grade these CONTENT CHECKS against the transcript (1-3 absent, 4-6 partially/superficially present, 7-10 clearly present):
{_check_lines(non_gambit_checks) or "(none)"}

Return ONLY a valid JSON object (no markdown):
{{
  "dimensions": [{{"id": "<id>", "score": <1-10>, "rationale": "<one paragraph, 3-5 sentences>"}}],
  "content_checks": [{{"id": "<id>", "score": <1-10>, "note": "<short specific note>"}}],{gambit_field}
  "overall_score": <1-10 — integrate delivery AND content; severe flaws drag this down; NOT a pure average>,
  "strength": "<the single biggest strength, 1-2 sentences>",
  "conclusion": "<1-3 sentences on how content and delivery interacted>",
  "areas_of_improvement": ["<specific, actionable>", "..."],
  "follow_up_questions": ["<tough question the audience would likely ask>", "..."],
  "additional_points": ["<notable observation>", "..."]
}}

Rules:
- Every dimension listed above MUST appear in "dimensions" with a score and a rationale.{gambit_rule}
- areas_of_improvement: 2 to 5 items. follow_up_questions: 2 to 3. additional_points: 0 to 3 (use [] if nothing notable)."""
    raw = _llm(api_key, max_tokens=4000).invoke([HumanMessage(content=prompt)]).content
    return _parse_json(raw)


# --- orchestration -----------------------------------------------------------

def score_submission(submission: dict, collected: dict, scoring_spec: dict, openai_api_key: str) -> dict:
    """Pure scoring. Returns the `video_scores` document body (no _id/insert)."""
    report = (collected.get("report") or "").strip()
    transcript = collected.get("transcript") or {}
    transcript_text = (transcript.get("text") or "").strip()
    duration = float(collected.get("duration_sec") or transcript.get("duration_sec") or transcript.get("duration") or 0.0)

    dimensions = scoring_spec.get("dimensions") or []
    content_checks_spec = scoring_spec.get("content_checks") or []
    has_gambit = any(c.get("id") == "gambit" for c in content_checks_spec)
    grading_criteria = (scoring_spec.get("feedback_prompt_template") or "").strip()
    label_map = {c["id"]: c.get("label", c["id"]) for c in content_checks_spec}

    analytics = _basic_analytics(transcript_text, duration, int(scoring_spec.get("target_duration_sec", 60)))

    dim_results = []
    content_checks = []
    coaching = {"strength": "", "growth_areas": [], "follow_up_questions": [], "summary": [], "additional_points": []}
    llm_overall = None
    general = {}

    try:
        general = _stage1_general(openai_api_key, report, transcript_text)
        prof = _stage2_prof_defined(openai_api_key, report, transcript_text, general, dimensions, content_checks_spec)
        final = _stage3_final(openai_api_key, grading_criteria, report, transcript_text, general, prof,
                              dimensions, content_checks_spec, has_gambit)

        # --- dimensions: prof-defined boxes, score/10 + one-paragraph rationale ---
        final_dims = {d.get("id"): d for d in (final.get("dimensions") or []) if d.get("id")}
        for spec_dim in dimensions:
            did = spec_dim.get("id")
            fd = final_dims.get(did) or {}
            s10 = fd.get("score")
            value = round(_clamp(s10 * 10.0), 1) if s10 is not None else None
            dim_results.append({
                "id": did,
                "name": spec_dim.get("name", did),
                "definition": spec_dim.get("definition", ""),
                "score": value,                 # 0-100 (drives the bar)
                "score_10": s10,                # raw 1-10 (the headline number)
                "label": _label_for(value),
                "rationale": fd.get("rationale", ""),
            })

        # --- content checks (transcript coverage), same shape the UI already reads ---
        final_checks = {c.get("id"): c for c in (final.get("content_checks") or []) if c.get("id")}
        for c in content_checks_spec:
            cid = c.get("id")
            if cid == "gambit":
                continue
            fc = final_checks.get(cid) or {}
            s = fc.get("score")
            content_checks.append({
                "id": cid,
                "label": label_map.get(cid, cid),
                "passed": s >= 7 if s is not None else False,
                "score": round(s * 10) if s is not None else None,
                "note": fc.get("note", ""),
            })
        if has_gambit:
            g = final.get("opening_gambit") or {}
            gs = g.get("score")
            content_checks.append({
                "id": "gambit",
                "label": label_map.get("gambit", "Opening Gambit"),
                "passed": gs >= 7 if gs is not None else False,
                "score": round(gs * 10) if gs is not None else None,
                "note": g.get("comment", ""),
            })

        os_raw = final.get("overall_score")
        llm_overall = round(os_raw * 10) if os_raw is not None else None

        coaching = {
            "strength": final.get("strength", "") or "",
            "growth_areas": [{"title": s, "detail": "", "rewrites": []} for s in (final.get("areas_of_improvement") or [])],
            "follow_up_questions": final.get("follow_up_questions") or [],
            "summary": [final["conclusion"]] if final.get("conclusion") else [],
            "additional_points": final.get("additional_points") or [],
        }
    except Exception as e:
        logger.error("Agent scoring chain failed: %s", e, exc_info=True)
        coaching["strength"] = "Automated feedback was unavailable for this submission."
        # Still emit empty dimension shells so the results page renders the boxes.
        for spec_dim in dimensions:
            dim_results.append({
                "id": spec_dim.get("id"),
                "name": spec_dim.get("name", spec_dim.get("id")),
                "definition": spec_dim.get("definition", ""),
                "score": None, "score_10": None, "label": "N/A", "rationale": "",
            })

    # Overall = mean of available dimension scores (numbers are secondary here).
    present = [d["score"] for d in dim_results if d.get("score") is not None]
    overall = round(sum(present) / len(present), 1) if present else None

    feedback = {
        "summary": " ".join(coaching.get("summary", [])[:2]) or coaching.get("strength", ""),
        "strengths": [coaching["strength"]] if coaching.get("strength") else [],
        "improvements": [g.get("title", "") for g in coaching.get("growth_areas", []) if g.get("title")],
    }

    return {
        "submission_id": str(submission["_id"]),
        "config_id": submission.get("config_id"),
        "assignment_type": submission.get("assignment_type"),
        "collected_data_id": str(collected["_id"]) if collected.get("_id") else None,
        "scoring_spec_version": scoring_spec.get("version", "1"),
        "dimensions": dim_results,
        "content_checks": content_checks,
        "overall": overall,
        "llm_overall": llm_overall,
        "coaching": coaching,
        "analytics": analytics,
        "feedback": feedback,
        "body_language": report,
        "scored_at": time.time(),
    }
