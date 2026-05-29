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

from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage

logger = logging.getLogger(__name__)

# --- transcript signals --------------------------------------------------
FILLER_WORDS = {
    # hesitation sounds (Whisper variants)
    "um", "umm", "uh", "uhh", "uhm",
    "er", "erm", "emm",
    "ah", "aah", "aa",
    "eh", "hmm", "hm", "mm", "mhm",
    # discourse fillers
    "like", "so", "well", "right",
    "okay", "ok", "alright",
    "yeah", "yep", "ya", "yea",
    # padding words
    "basically", "actually", "literally", "honestly",
    "essentially", "anyway", "anyways",
}
HEDGE_PHRASES = ["i think", "i guess", "maybe", "sort of", "kind of", "i mean",
                 "probably", "i'm not sure", "it seems", "perhaps", "i suppose"]
# "Weak" / non-committal qualifiers that dilute impact (Yoodli-style). Single
# tokens are flagged with timestamps; multi-word ones counted in the text.
WEAK_WORDS = {"just", "really", "very", "quite", "actually", "basically",
              "literally", "stuff", "things", "somewhat", "pretty", "kinda",
              "sorta", "honestly"}
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


# --- Quantitative analytics (Yoodli-style, deterministic) ----------------

def _status(value, good, warn, higher_better=True):
    """Map a value to good/warn/bad against two thresholds."""
    if value is None:
        return "na"
    if higher_better:
        return "good" if value >= good else ("warn" if value >= warn else "bad")
    return "good" if value <= good else ("warn" if value <= warn else "bad")


def _norm(w):
    return (w or "").strip().lower().strip(".,!?;:\"'")


def compute_analytics(collected: dict, sm: dict) -> dict:
    """Rich quantitative metrics grouped Word Choice / Delivery / Presence.
    Every metric carries a value, a status, a human label, a benchmark note,
    and (where useful) the actual flagged instances with timestamps."""
    transcript = collected.get("transcript") or {}
    words = transcript.get("words") or []
    low = (transcript.get("text") or "").lower()
    segments = transcript.get("segments") or []
    duration = float(collected.get("duration_sec") or transcript.get("duration") or 0.0)

    n_words = len(words)
    tokens = re.findall(r"[a-z']+", low)
    total = len(tokens) or 1
    talk_sec = duration

    # ---- Word Choice ----
    filler_instances = [{"word": _norm(w.get("word")), "time": round(w.get("start", 0.0), 1)}
                        for w in words if _norm(w.get("word")) in FILLER_WORDS]
    filler_pct = round(100.0 * len(filler_instances) / total, 1)

    weak_instances = [{"word": _norm(w.get("word")), "time": round(w.get("start", 0.0), 1)}
                      for w in words if _norm(w.get("word")) in WEAK_WORDS]
    weak_pct = round(100.0 * len(weak_instances) / total, 1)

    hedge_count = sum(low.count(p) for p in HEDGE_PHRASES)
    hedge_per100 = round(hedge_count / (total / 100.0), 1)

    # sentence starters: first word of each segment; flag any used >1
    starters = {}
    for s in segments:
        m = re.findall(r"[A-Za-z']+", s.get("text", "") or "")
        if m:
            k = m[0].lower()
            starters[k] = starters.get(k, 0) + 1
    recurring_starters = sorted([{"starter": k, "count": v} for k, v in starters.items() if v > 1],
                                key=lambda x: -x["count"])

    unique_ratio = round(len(set(tokens)) / total, 2)

    # ---- Delivery ----
    wpm = round(n_words / (talk_sec / 60.0)) if talk_sec else 0
    pauses = []
    for i in range(1, n_words):
        gap = round(words[i].get("start", 0) - words[i - 1].get("end", 0), 1)
        if gap >= 1.0:
            pauses.append({"time": round(words[i - 1].get("end", 0), 1), "duration": gap})
    longest_pause = max((p["duration"] for p in pauses), default=0.0)

    # pace over thirds of the talk, to surface rushed/dragging sections
    sections = []
    if n_words > 6 and talk_sec > 6:
        third = talk_sec / 3.0
        for idx in range(3):
            lo, hi = idx * third, (idx + 1) * third
            cnt = sum(1 for w in words if lo <= w.get("start", 0) < hi)
            sec_wpm = round(cnt / (third / 60.0)) if third else 0
            sections.append({"label": ["Open", "Middle", "Close"][idx], "wpm": sec_wpm})

    def sub(name):
        m = sm.get(name) or {}
        return m.get("score") if m.get("available") else None

    pitch = sub("pitch_variation")
    energy = sub("energy_dynamics")
    expr = sub("facial_expressivity")
    comp = sub("face_composure")

    analytics = {
        "talk_time_sec": round(talk_sec, 1),
        "word_count": n_words,
        "word_choice": {
            "filler_words": {
                "count": len(filler_instances), "pct": filler_pct,
                "status": _status(filler_pct, 3, 6, higher_better=False),
                "label": f"{filler_pct}% filler", "instances": filler_instances[:25],
                "benchmark": "Strong speakers stay under 3%.",
            },
            "weak_words": {
                "count": len(weak_instances), "pct": weak_pct,
                "status": _status(weak_pct, 3, 6, higher_better=False),
                "label": f"{len(weak_instances)} weak words ({weak_pct}%)", "instances": weak_instances[:25],
                "benchmark": "It's natural to have fewer than 4% weak words.",
            },
            "hedging": {
                "per_100": hedge_per100, "count": hedge_count,
                "status": _status(hedge_per100, 1.5, 3.5, higher_better=False),
                "label": f"{hedge_per100} hedges / 100 words",
                "benchmark": "Confident delivery uses few hedges (\"I think\", \"maybe\").",
            },
            "sentence_starters": {
                "recurring": len(recurring_starters), "top": recurring_starters[:5],
                "status": _status(len(recurring_starters), 1, 3, higher_better=False),
                "label": f"{len(recurring_starters)} recurring starters",
                "benchmark": "Vary how you open sentences to stay engaging.",
            },
            "vocabulary": {
                "unique_ratio": unique_ratio, "total_words": n_words,
                "status": _status(unique_ratio * 100, 45, 35),
                "label": f"{int(unique_ratio * 100)}% unique words",
                "benchmark": "Higher lexical variety reads as more articulate.",
            },
        },
        "delivery": {
            "pace": {
                "wpm": wpm,
                "status": "good" if IDEAL_WPM_LOW <= wpm <= IDEAL_WPM_HIGH else "warn" if (90 <= wpm < IDEAL_WPM_LOW or IDEAL_WPM_HIGH < wpm <= 185) else "bad",
                "label": f"{wpm} words/min", "sections": sections,
                "benchmark": f"Conversational pace is {IDEAL_WPM_LOW}-{IDEAL_WPM_HIGH} wpm.",
            },
            "pauses": {
                "count": len(pauses), "longest_sec": longest_pause,
                "status": _status(len(pauses), 4, 9, higher_better=False),
                "label": f"{len(pauses)} long pauses (max {longest_pause}s)", "instances": pauses[:25],
                "benchmark": "A few pauses add emphasis; many disrupt flow.",
            },
            "pitch_variation": {
                "value": pitch, "status": _status(pitch, 55, 35) if pitch is not None else "na",
                "label": "Vocal variation (monotone ↔ dynamic)",
                "benchmark": "Varied pitch keeps listeners engaged.",
            },
            "energy": {
                "value": energy, "status": _status(energy, 55, 35) if energy is not None else "na",
                "label": "Vocal energy", "benchmark": "Energy signals conviction.",
            },
        },
        "presence": {
            "facial_expressivity": {
                "value": expr, "status": _status(expr, 50, 30) if expr is not None else "na",
                "label": "Facial expressivity", "benchmark": "Expressive faces build connection.",
            },
            "composure": {
                "value": comp, "status": _status(comp, 55, 40) if comp is not None else "na",
                "label": "Facial composure", "benchmark": "Calm composure reads as confident.",
            },
        },
    }
    return analytics


TONE_CANDIDATES = ["Confident", "Enthusiastic", "Clear", "Measured", "Rushed", "Monotone", "Hesitant"]


def compute_tone_tags(analytics: dict, sm: dict) -> list:
    """Yoodli-style tone chips: a fixed candidate set, each marked active or not."""
    wpm = (analytics.get("delivery") or {}).get("pace", {}).get("wpm", 0)
    filler = (analytics.get("word_choice") or {}).get("filler_words", {}).get("pct", 0)
    weak = (analytics.get("word_choice") or {}).get("weak_words", {}).get("pct", 0)

    def s(name):
        m = sm.get(name) or {}
        return m.get("score") if m.get("available") else None

    conf, enth, pitch = s("prosody_confidence"), s("hume_enthusiasm"), s("pitch_variation")
    active = set()
    if conf is not None and conf >= 60:
        active.add("Confident")
    if enth is not None and enth >= 55:
        active.add("Enthusiastic")
    if filler < 4 and weak < 4:
        active.add("Clear")
    if IDEAL_WPM_LOW <= wpm <= IDEAL_WPM_HIGH:
        active.add("Measured")
    if wpm > 175:
        active.add("Rushed")
    if pitch is not None and pitch < 35:
        active.add("Monotone")
    if filler > 6 or (conf is not None and conf < 40):
        active.add("Hesitant")
    return [{"label": t, "active": t in active} for t in TONE_CANDIDATES]


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


def _analytics_brief(analytics: dict, tone_tags: list) -> str:
    """Compact, factual brief of the measured signals for the LLM to ground its
    coaching in (so feedback cites real numbers, not guesses)."""
    wc = analytics.get("word_choice", {})
    dl = analytics.get("delivery", {})
    active_tones = ", ".join(t["label"] for t in tone_tags if t["active"]) or "none detected"
    top_weak = ", ".join(sorted({i["word"] for i in wc.get("weak_words", {}).get("instances", [])})) or "none"
    return (
        f"- Talk time: {analytics.get('talk_time_sec', 0)}s, {analytics.get('word_count', 0)} words\n"
        f"- Pace: {dl.get('pace', {}).get('wpm', 0)} wpm ({dl.get('pace', {}).get('status', 'na')})\n"
        f"- Filler words: {wc.get('filler_words', {}).get('pct', 0)}%; weak words: {wc.get('weak_words', {}).get('pct', 0)}% ({top_weak})\n"
        f"- Hedging: {wc.get('hedging', {}).get('per_100', 0)} per 100 words\n"
        f"- Long pauses: {dl.get('pauses', {}).get('count', 0)} (longest {dl.get('pauses', {}).get('longest_sec', 0)}s)\n"
        f"- Detected tone: {active_tones}\n"
    )




def _llm_coaching(api_key, scoring_spec, transcript_text, analytics_brief):
    """One structured LLM call → grading prompt-driven coaching + content checks."""
    grading_prompt = (scoring_spec.get("feedback_prompt_template") or "").strip()
    checks = scoring_spec.get("content_checks") or []
    checks_block = ""
    if checks:
        lines = "\n".join(
            f'- {c["id"]}: {c.get("label", "")} — {c.get("description", "")}'
            for c in checks
        )
        checks_block = f"\nContent checks — evaluate each against the transcript:\n{lines}\n"

    prompt = f"""{grading_prompt}

Measured delivery signals (already computed — reference them in your feedback):
{analytics_brief}

Transcript:
\"\"\"
{transcript_text[:7000]}
\"\"\"
{checks_block}

Return ONLY a valid JSON object with this exact shape (no markdown, no prose outside the JSON):
{{
  "overall_score": <0-100 — overall quality score based on your grading criteria>,
  "strength": "<2-3 sentences: the single biggest thing they did well>",
  "growth_areas": [
    {{
      "title": "<short imperative>",
      "detail": "<2-3 sentences of concrete, specific advice>",
      "rewrites": [{{"original": "<exact phrase from transcript>", "improved": "<stronger rewrite>"}}]
    }}
  ],
  "follow_up_questions": ["<question>", "...", "..."],
  "summary": ["<bullet summarizing a key point>", "..."],
  "content_checks": [{{"id": "<id>", "passed": <true|false>, "score": <0-100>, "note": "<short, specific note>"}}]
}}

Rules:
- growth_areas: 3 to 6 items. Include rewrites only when you can quote a real phrase; otherwise use [].
- follow_up_questions: exactly 3 items.
- summary: 2 to 5 bullets.
- overall_score: use the full 0-100 range — do NOT cluster around 50-70."""

    llm = ChatAnthropic(
        model="claude-sonnet-4-6",
        api_key=api_key,
        max_tokens=4000,
    )
    raw = llm.invoke([HumanMessage(content=prompt)]).content
    return _parse_json(raw)


def score_submission(submission: dict, collected: dict, scoring_spec: dict, anthropic_api_key: str) -> dict:
    """Pure scoring. Returns the `video_scores` document body (no _id/insert)."""
    sm = compute_submetrics(collected)
    analytics = compute_analytics(collected, sm)
    tone_tags = compute_tone_tags(analytics, sm)
    transcript_text = ((collected.get("transcript") or {}).get("text") or "")

    # LLM coaching + content score + checks (best-effort; degrade gracefully).
    llm_content_score = None
    content_checks = []
    coaching = {"strength": "", "growth_areas": [], "follow_up_questions": [], "summary": []}
    try:
        ev = _llm_coaching(anthropic_api_key, scoring_spec, transcript_text, _analytics_brief(analytics, tone_tags))
        llm_content_score = float(ev["overall_score"]) if ev.get("overall_score") is not None else None
        content_checks = ev.get("content_checks") or []
        coaching = {
            "strength": ev.get("strength", "") or "",
            "growth_areas": ev.get("growth_areas", []) or [],
            "follow_up_questions": ev.get("follow_up_questions", []) or [],
            "summary": ev.get("summary", []) or [],
        }
    except Exception as e:
        logger.error("LLM coaching failed: %s", e, exc_info=True)
        coaching["strength"] = "Automated coaching was unavailable for this submission."

    # Inject the LLM content score as the competence content sub-metric.
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

    # Legacy feedback view kept so the dashboard quick-view keeps working.
    feedback = {
        "summary": " ".join(coaching.get("summary", [])[:2]) or coaching.get("strength", ""),
        "strengths": [coaching["strength"]] if coaching.get("strength") else [],
        "improvements": [g.get("title", "") for g in coaching.get("growth_areas", []) if g.get("title")],
    }

    return {
        "submission_id": str(submission["_id"]),
        "config_id": submission.get("config_id"),
        "assignment_type": submission.get("assignment_type"),
        "collected_data_id": str(collected["_id"]),
        "scoring_spec_version": scoring_spec.get("version", "1"),
        "scores": composites,
        "content_checks": content_checks,
        "overall": overall,
        "coaching": coaching,
        "analytics": analytics,
        "tone_tags": tone_tags,
        "feedback": feedback,
        "timeline_markers": [],
        "scored_at": time.time(),
    }
