"""Scoring layer — turns raw collected data + a config's scoring_spec into the
three composite scores (Confidence / Competence / Passion) plus LLM feedback.

DECOUPLED from collection: reads `video_collected_data`, never invokes
Whisper/Hume. Re-runnable (rescore) reads the same collected data.

Design notes:
- `compute_submetrics` returns EVERY diagnostic signal it can derive, each as
  {score: 0-100|None, raw, available, label}. Higher score is always better
  (inverted signals like filler/hedging/sway are already flipped). The UI shows
  these under each composite so students see *why* a composite scored as it did.
- A composite is a weighted, RENORMALIZED blend over whichever of its
  sub-metrics are `available`. Phase-2 pose signals (posture/sway/gesture) are
  simply absent in phase 1 and drop out of the blend — no rework when added.
- The transfer functions below are first-pass heuristics; they're isolated as
  module constants so they can be calibrated against real submissions later
  without touching the pipeline or the API.
"""
import json
import logging
import re
import time

from langchain_openai import ChatOpenAI
from langchain_core.messages import HumanMessage

logger = logging.getLogger(__name__)

# --- transcript signals --------------------------------------------------
FILLER_WORDS = {"um", "uh", "er", "ah", "hmm", "like", "okay", "ok", "right",
                "yeah", "basically", "actually", "literally", "so"}
HEDGE_PHRASES = ["i think", "i guess", "maybe", "sort of", "kind of", "i mean",
                 "probably", "i'm not sure", "it seems", "perhaps", "i suppose"]
IDEAL_WPM_LOW, IDEAL_WPM_HIGH = 110, 160

# --- Hume emotion bundles (names match Hume's 48-emotion taxonomy) --------
CONF_POS = ["Calmness", "Determination", "Pride", "Concentration", "Contentment"]
CONF_NEG = ["Anxiety", "Doubt", "Awkwardness", "Distress", "Fear"]
ENTHUSIASM = ["Excitement", "Joy", "Interest", "Triumph", "Ecstasy"]
COMPOSURE_POS = ["Calmness", "Contentment", "Concentration"]
COMPOSURE_NEG = ["Anxiety", "Distress", "Fear", "Awkwardness", "Confusion"]
EXPRESSIVITY = ["Joy", "Excitement", "Interest", "Surprise (positive)", "Amusement"]
AROUSAL = ["Excitement", "Joy", "Determination", "Triumph", "Interest"]

# Heuristic scale: Hume emotion means are small; multiply bundle means into 0-100.
BUNDLE_SCALE = 280.0


def _clamp(x, lo=0.0, hi=100.0):
    return max(lo, min(hi, x))


def _mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else 0.0


def _sm(score, raw, available, label):
    return {"score": (None if score is None else round(float(score), 1)),
            "raw": raw, "available": bool(available), "label": label}


def _frame_bundle_series(frames, names):
    """Per-frame mean score across the named emotions."""
    out = []
    for f in frames:
        emo = f.get("emotions") or {}
        out.append(_mean([emo.get(n) for n in names if n in emo]))
    return out


# --- sub-metric computation ----------------------------------------------

def compute_submetrics(collected: dict) -> dict:
    transcript = collected.get("transcript") or {}
    words = transcript.get("words") or []
    text = (transcript.get("text") or "").lower()
    duration = float(collected.get("duration_sec") or transcript.get("duration") or 0.0)
    prosody_frames = (collected.get("prosody") or {}).get("frames") or []
    face_frames = (collected.get("face") or {}).get("frames") or []
    pose = collected.get("pose")

    sm = {}

    # ---- transcript-derived (always available if we have words) ----
    n_words = len(words)
    has_text = n_words > 0 and duration > 0

    if has_text:
        wpm = n_words / (duration / 60.0)
        if IDEAL_WPM_LOW <= wpm <= IDEAL_WPM_HIGH:
            pace_score = 100.0
        elif wpm < IDEAL_WPM_LOW:
            pace_score = _clamp(100.0 - (IDEAL_WPM_LOW - wpm) * 1.2)
        else:
            pace_score = _clamp(100.0 - (wpm - IDEAL_WPM_HIGH) * 1.2)
        sm["pace"] = _sm(pace_score, round(wpm, 1), True, f"{round(wpm)} words/min")
    else:
        sm["pace"] = _sm(None, None, False, "No transcript")

    tokens = re.findall(r"[a-z']+", text)
    if tokens:
        filler_n = sum(1 for t in tokens if t in FILLER_WORDS)
        filler_rate = filler_n / len(tokens)
        sm["filler_rate"] = _sm(_clamp(100.0 * (1.0 - min(filler_rate / 0.12, 1.0))),
                                round(filler_rate, 4), True, f"{round(filler_rate * 100, 1)}% filler words")
        hedge_n = sum(text.count(p) for p in HEDGE_PHRASES)
        hedge_rate = hedge_n / max(len(tokens) / 100.0, 1.0)  # per 100 words
        sm["hedging"] = _sm(_clamp(100.0 * (1.0 - min(hedge_rate / 4.0, 1.0))),
                            round(hedge_rate, 2), True, f"{round(hedge_rate, 1)} hedges/100 words")
    else:
        sm["filler_rate"] = _sm(None, None, False, "No transcript")
        sm["hedging"] = _sm(None, None, False, "No transcript")

    # pacing smoothness: penalize frequent long inter-word pauses
    if n_words > 5:
        gaps = [max(0.0, words[i]["start"] - words[i - 1]["end"]) for i in range(1, n_words)]
        awkward = sum(1 for g in gaps if g > 1.5)
        awkward_ratio = awkward / len(gaps)
        sm["pacing_smoothness"] = _sm(_clamp(100.0 * (1.0 - min(awkward_ratio / 0.15, 1.0))),
                                      round(awkward_ratio, 4), True,
                                      f"{awkward} long pauses")
    else:
        sm["pacing_smoothness"] = _sm(None, None, False, "Too few words")

    # ---- Hume prosody-derived ----
    if prosody_frames:
        conf_pos = _mean(_frame_bundle_series(prosody_frames, CONF_POS))
        conf_neg = _mean(_frame_bundle_series(prosody_frames, CONF_NEG))
        sm["prosody_confidence"] = _sm(_clamp((conf_pos - conf_neg) * BUNDLE_SCALE + 50.0),
                                       round(conf_pos - conf_neg, 4), True, "Vocal confidence")
        enth = _mean(_frame_bundle_series(prosody_frames, ENTHUSIASM))
        sm["hume_enthusiasm"] = _sm(_clamp(enth * BUNDLE_SCALE), round(enth, 4), True, "Vocal enthusiasm")

        arousal_series = _frame_bundle_series(prosody_frames, AROUSAL)
        mean_ar = _mean(arousal_series)
        sm["energy_dynamics"] = _sm(_clamp(mean_ar * BUNDLE_SCALE), round(mean_ar, 4), True, "Vocal energy")
        var = _stddev(arousal_series)
        sm["pitch_variation"] = _sm(_clamp(var * BUNDLE_SCALE * 2.0), round(var, 4), True, "Vocal variation")
        # steadiness: low abrupt frame-to-frame change in arousal
        if len(arousal_series) > 1:
            deltas = [abs(arousal_series[i] - arousal_series[i - 1]) for i in range(1, len(arousal_series))]
            sm["volume_steadiness"] = _sm(_clamp(100.0 - _mean(deltas) * BUNDLE_SCALE * 2.0),
                                          round(_mean(deltas), 4), True, "Delivery steadiness")
        else:
            sm["volume_steadiness"] = _sm(None, None, False, "Insufficient audio")
    else:
        for k, lbl in (("prosody_confidence", "Vocal confidence"), ("hume_enthusiasm", "Vocal enthusiasm"),
                       ("energy_dynamics", "Vocal energy"), ("pitch_variation", "Vocal variation"),
                       ("volume_steadiness", "Delivery steadiness")):
            sm[k] = _sm(None, None, False, "No prosody data")

    # ---- Hume face-derived ----
    if face_frames:
        comp_pos = _mean(_frame_bundle_series(face_frames, COMPOSURE_POS))
        comp_neg = _mean(_frame_bundle_series(face_frames, COMPOSURE_NEG))
        sm["face_composure"] = _sm(_clamp((comp_pos - comp_neg) * BUNDLE_SCALE + 50.0),
                                   round(comp_pos - comp_neg, 4), True, "Facial composure")
        expr_series = _frame_bundle_series(face_frames, EXPRESSIVITY)
        sm["facial_expressivity"] = _sm(_clamp((_mean(expr_series) + _stddev(expr_series)) * BUNDLE_SCALE),
                                        round(_mean(expr_series), 4), True, "Facial expressivity")
    else:
        sm["face_composure"] = _sm(None, None, False, "No face data")
        sm["facial_expressivity"] = _sm(None, None, False, "No face data")

    # ---- pose-derived (PHASE 2) ----
    pose_present = bool(pose)
    for k, lbl in (("posture", "Upright posture"), ("sway", "Body steadiness"),
                   ("gesture_activity", "Gesture activity")):
        # When pose lands, replace this with real derivations; renormalization
        # means scores adjust automatically once `available` flips true.
        sm[k] = _sm(None, None, pose_present, lbl if pose_present else "Not yet measured")

    return sm


def _stddev(xs):
    xs = [x for x in xs if x is not None]
    if len(xs) < 2:
        return 0.0
    m = sum(xs) / len(xs)
    return (sum((x - m) ** 2 for x in xs) / len(xs)) ** 0.5


def _rollup(sm: dict, weights: dict):
    """Weighted blend over available sub-metrics, weights renormalized."""
    parts = [(weights[k], sm[k]["score"]) for k in weights
             if k in sm and sm[k]["available"] and sm[k]["score"] is not None]
    total_w = sum(w for w, _ in parts)
    if total_w <= 0:
        return None
    return round(sum(w * s for w, s in parts) / total_w, 1)


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


# --- LLM content evaluation + checks + qualitative feedback (one call) ----

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


def _llm_evaluate(api_key, scoring_spec, transcript_text, submetric_summary):
    checks = scoring_spec.get("content_checks") or []
    checks_block = ""
    if checks:
        lines = "\n".join(f'- {c["id"]}: {c.get("label","")} — {c.get("description","")}' for c in checks)
        checks_block = (
            "\nContent checks — for each, decide if the presentation satisfies it:\n"
            f"{lines}\n"
        )
    prompt = f"""{scoring_spec.get('feedback_prompt_template', '').strip()}

You are scoring the CONTENT/COMPETENCE of the transcript below and giving holistic feedback.

Delivery signals already measured (0-100, higher is better):
{submetric_summary}

Transcript:
\"\"\"
{transcript_text[:6000]}
\"\"\"
{checks_block}
Return ONLY a JSON object:
{{
  "competence_content_score": <0-100, quality of hook/structure/evidence/vocabulary/close>,
  "content_checks": [{{"id": "<id>", "passed": <true|false>, "score": <0-100>, "note": "<short>"}}],
  "summary": "<2-3 sentence overall summary>",
  "strengths": ["<short>", "..."],
  "improvements": ["<short>", "..."],
  "per_dimension": {{"confidence": "<1 sentence>", "competence": "<1 sentence>", "passion": "<1 sentence>"}}
}}"""
    llm = ChatOpenAI(model="gpt-4o-mini", api_key=api_key, temperature=0.2, max_tokens=900)
    raw = llm.invoke([HumanMessage(content=prompt)]).content
    return _parse_json(raw)


def _submetric_summary(sm):
    avail = [f'{k}={v["score"]}' for k, v in sm.items() if v["available"] and v["score"] is not None]
    return ", ".join(avail) or "none available"


def score_submission(submission: dict, collected: dict, scoring_spec: dict, openai_api_key: str) -> dict:
    """Pure scoring. Returns the `video_scores` document body (no _id/insert)."""
    sm = compute_submetrics(collected)
    transcript_text = ((collected.get("transcript") or {}).get("text") or "")

    # LLM content + checks + feedback (best-effort; degrade gracefully)
    llm_content_score = None
    content_checks = []
    feedback = {"summary": "", "strengths": [], "improvements": [],
                "per_dimension": {"confidence": "", "competence": "", "passion": ""}}
    try:
        ev = _llm_evaluate(openai_api_key, scoring_spec, transcript_text, _submetric_summary(sm))
        llm_content_score = float(ev.get("competence_content_score")) if ev.get("competence_content_score") is not None else None
        content_checks = ev.get("content_checks") or []
        feedback = {
            "summary": ev.get("summary", ""),
            "strengths": ev.get("strengths", []) or [],
            "improvements": ev.get("improvements", []) or [],
            "per_dimension": ev.get("per_dimension", {}) or feedback["per_dimension"],
        }
    except Exception as e:
        logger.error("LLM evaluation failed: %s", e, exc_info=True)
        feedback["summary"] = "Automated content feedback was unavailable for this submission."

    # Inject LLM content score as the competence content sub-metric.
    sm["llm_content"] = _sm(llm_content_score, llm_content_score, llm_content_score is not None, "Content quality (LLM)")

    weights = scoring_spec.get("submetric_weights") or {}
    composites = {}
    for dim in ("confidence", "competence", "passion"):
        val = _rollup(sm, weights.get(dim) or {})
        composites[dim] = {
            "value": val,
            "label": _label_for(val),
            "submetrics": {k: sm[k] for k in (weights.get(dim) or {}) if k in sm},
        }

    cw = scoring_spec.get("composite_weights") or {}
    present = [(cw.get(d, 0.0), composites[d]["value"]) for d in ("confidence", "competence", "passion")
               if composites[d]["value"] is not None]
    tw = sum(w for w, _ in present)
    overall = round(sum(w * v for w, v in present) / tw, 1) if tw > 0 else None

    return {
        "submission_id": str(submission["_id"]),
        "config_id": submission.get("config_id"),
        "assignment_type": submission.get("assignment_type"),
        "collected_data_id": str(collected["_id"]),
        "scoring_spec_version": scoring_spec.get("version", "1"),
        "scores": composites,
        "content_checks": content_checks,
        "overall": overall,
        "feedback": feedback,
        "timeline_markers": [],
        "scored_at": time.time(),
    }
