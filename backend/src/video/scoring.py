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
FILLER_PHRASES = [
    "you know", "i mean", "you see", "right so", "so yeah", "and so",
]
HEDGE_PHRASES = [
    "i think", "i guess", "maybe", "sort of", "kind of", "i mean",
    "probably", "i'm not sure", "it seems", "perhaps", "i suppose",
    "hopefully", "a little bit", "kind of like", "you know",
    "to be honest", "in my opinion", "i believe", "i feel like",
    "it could be", "it might be", "i would say", "i'd like to think",
    "more or less", "if you will", "as it were",
    "we think", "we hope", "we believe", "we're trying to",
    "we would like to", "we hope to", "we're hoping",
]
_FILLER_PHRASE_SET = set(FILLER_PHRASES)
# Stop-word bigrams/trigrams excluded from repeated-phrase detection
_PHRASE_STOPWORDS = {
    "a", "an", "the", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "is", "it", "this", "that", "we", "i", "so", "as",
}
# "Weak" / non-committal qualifiers that dilute impact (Yoodli-style). Single
# tokens are flagged with timestamps; multi-word ones counted in the text.
WEAK_WORDS = {"just", "really", "very", "quite", "actually", "basically",
              "literally", "stuff", "things", "somewhat", "pretty", "kinda",
              "sorta", "honestly"}
IDEAL_WPM_LOW, IDEAL_WPM_HIGH = 110, 160
IDEAL_BRIGHTNESS_LOW, IDEAL_BRIGHTNESS_HIGH = 80, 180

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
    visual = collected.get("visual") or {}

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
        filler_n = sum(1 for t in tokens if t in FILLER_WORDS) + sum(text.count(p) for p in FILLER_PHRASES)
        filler_rate = filler_n / len(tokens)
        sm["filler_rate"] = _sm(_clamp(100.0 * (1.0 - min(filler_rate / 0.12, 1.0))),
                                round(filler_rate, 4), True, f"{round(filler_rate * 100, 1)}% filler words")
        hedge_n = sum(text.count(p) for p in HEDGE_PHRASES)
        # >3 hedges = starts to hurt; >8 = worst case
        sm["hedging"] = _sm(_clamp(100.0 * (1.0 - max(0, hedge_n - 3) / 5.0)),
                            hedge_n, True, f"{hedge_n} hedge{'s' if hedge_n != 1 else ''}")
        unique_ratio = len(set(tokens)) / len(tokens)
        sm["vocabulary"] = _sm(_clamp(100.0 * min(unique_ratio / 0.40, 1.0)),
                               round(unique_ratio, 4), True, f"{round(unique_ratio * 100)}% unique words")
    else:
        sm["filler_rate"] = _sm(None, None, False, "No transcript")
        sm["hedging"] = _sm(None, None, False, "No transcript")
        sm["vocabulary"] = _sm(None, None, False, "No transcript")

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

    # ---- face coverage / centering / distance (from Hume bbox) ----
    bbox_frames = [f for f in face_frames if f.get("bbox")]
    if face_frames:
        coverage = len(bbox_frames) / len(face_frames)
        sm["face_coverage"] = _sm(_clamp(coverage * 100.0), round(coverage, 4), True,
                                  f"Face visible {round(coverage * 100)}% of time")
        fw = visual.get("frame_width") or 0
        fh = visual.get("frame_height") or 0
        if bbox_frames and fw and fh:
            deviations, areas = [], []
            for f in bbox_frames:
                b = f["bbox"]
                cx = (b["x"] + b["w"] / 2.0) / fw
                cy = (b["y"] + b["h"] / 2.0) / fh
                deviations.append(abs(cx - 0.5) + abs(cy - 0.5))
                areas.append((b["w"] * b["h"]) / (fw * fh))
            mean_dev = _mean(deviations)
            mean_area = _mean(areas)
            # centering: 0 deviation = perfect (score 100), 0.5 deviation = fully off (score 0)
            sm["face_centering"] = _sm(_clamp(100.0 * (1.0 - min(mean_dev / 0.3, 1.0))),
                                       round(mean_dev, 4), True, "Face centered in frame")
            # distance proxy: ideal face area is 5-20% of frame; too small or too large penalized
            ideal_area_mid = 0.10
            distance_score = _clamp(100.0 - abs(mean_area - ideal_area_mid) / ideal_area_mid * 80.0)
            sm["face_distance"] = _sm(distance_score, round(mean_area, 4), True,
                                      f"Face size {round(mean_area * 100, 1)}% of frame")
        else:
            sm["face_centering"] = _sm(None, None, False, "No frame dimensions")
            sm["face_distance"] = _sm(None, None, False, "No frame dimensions")
    else:
        sm["face_coverage"] = _sm(None, None, False, "No face data")
        sm["face_centering"] = _sm(None, None, False, "No face data")
        sm["face_distance"] = _sm(None, None, False, "No face data")

    # ---- lighting quality (from visual analysis) ----
    mean_brightness = visual.get("mean_brightness")
    if mean_brightness is not None:
        if IDEAL_BRIGHTNESS_LOW <= mean_brightness <= IDEAL_BRIGHTNESS_HIGH:
            brightness_score = 100.0
        elif mean_brightness < IDEAL_BRIGHTNESS_LOW:
            brightness_score = _clamp(100.0 * (mean_brightness / IDEAL_BRIGHTNESS_LOW))
        else:
            brightness_score = _clamp(100.0 * (1.0 - (mean_brightness - IDEAL_BRIGHTNESS_HIGH) / (255.0 - IDEAL_BRIGHTNESS_HIGH)))
        sm["lighting_quality"] = _sm(brightness_score, round(mean_brightness, 1), True,
                                     f"Brightness {round(mean_brightness)}/255")
    else:
        sm["lighting_quality"] = _sm(None, None, False, "No video frame data")

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


def compute_analytics(collected: dict, sm: dict, target_duration_sec: int = 60) -> dict:
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
    # multi-word filler phrases (e.g. "you know")
    for i in range(len(words) - 1):
        phrase = f"{_norm(words[i].get('word', ''))} {_norm(words[i + 1].get('word', ''))}"
        if phrase in _FILLER_PHRASE_SET:
            filler_instances.append({"word": phrase, "time": round(words[i].get("start", 0.0), 1)})
    filler_instances.sort(key=lambda x: x["time"])

    # repeated restarts: same word within 2s of itself, or a cut-off (<0.2s) before its continuation
    restart_instances = []
    for i in range(1, len(words)):
        prev_word = _norm(words[i - 1].get("word", ""))
        curr_word = _norm(words[i].get("word", ""))
        gap = words[i].get("start", 0) - words[i - 1].get("start", 0)
        prev_dur = words[i - 1].get("end", 0) - words[i - 1].get("start", 0)
        if curr_word == prev_word and gap < 2.0 and prev_word:
            restart_instances.append({"word": curr_word, "time": round(words[i - 1].get("start", 0.0), 1)})
        elif prev_dur < 0.2 and len(prev_word) >= 3 and curr_word.startswith(prev_word[:3]):
            restart_instances.append({"word": f"{prev_word}... {curr_word}", "time": round(words[i - 1].get("start", 0.0), 1)})

    # repeated phrases: bigrams + trigrams appearing 3+ times, excluding stop-word-only n-grams
    from collections import Counter
    ngrams = []
    for n in (2, 3):
        for j in range(len(tokens) - n + 1):
            gram = tokens[j:j + n]
            if not all(t in _PHRASE_STOPWORDS for t in gram):
                ngrams.append(" ".join(gram))
    repeated_phrases = [{"phrase": p, "count": c}
                        for p, c in Counter(ngrams).most_common(10) if c >= 3]

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

    # 5-second windows for rush/slow detection
    pace_windows = []
    window = 5.0
    if n_words > 3 and talk_sec > window:
        t = 0.0
        while t < talk_sec:
            cnt = sum(1 for w in words if t <= w.get("start", 0) < t + window)
            win_wpm = round(cnt / (window / 60.0))
            flag = "rush" if win_wpm > 200 else "slow" if win_wpm < 70 else "ok"
            pace_windows.append({"time": round(t, 1), "wpm": win_wpm, "flag": flag})
            t += window

    # completion check
    completion_sec = round(talk_sec, 1)
    completion_delta = round(talk_sec - target_duration_sec, 1)
    if abs(completion_delta) <= 5:
        completion_status = "good"
    elif completion_delta < -10:
        completion_status = "short"
    elif completion_delta > 10:
        completion_status = "over"
    else:
        completion_status = "warn"

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
        "completion": {
            "duration_sec": completion_sec,
            "target_sec": target_duration_sec,
            "delta_sec": completion_delta,
            "status": completion_status,
            "label": f"{completion_sec}s / {target_duration_sec}s target",
        },
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
                "count": hedge_count,
                "status": _status(hedge_count, 3, 7, higher_better=False),
                "label": f"{hedge_count} hedge{'s' if hedge_count != 1 else ''}",
                "benchmark": "Keep hedges to 3 or fewer. Every \"I think\" or \"maybe\" signals uncertainty.",
            },
            "restarts": {
                "count": len(restart_instances), "instances": restart_instances[:20],
                "status": _status(len(restart_instances), 2, 5, higher_better=False),
                "label": f"{len(restart_instances)} restarts",
                "benchmark": "Fewer than 2 restarts keeps delivery fluent.",
            },
            "repeated_phrases": {
                "count": len(repeated_phrases), "top": repeated_phrases[:5],
                "status": _status(len(repeated_phrases), 1, 3, higher_better=False),
                "label": f"{len(repeated_phrases)} repeated phrases",
                "benchmark": "Vary your language to avoid sounding scripted.",
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
                "label": f"{wpm} words/min", "sections": sections, "windows": pace_windows,
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
    """Compact delivery brief for the LLM — covers all signals needed for PCCP scoring."""
    wc = analytics.get("word_choice", {})
    dl = analytics.get("delivery", {})
    pr = analytics.get("presence", {})
    active_tones = ", ".join(t["label"] for t in tone_tags if t["active"]) or "none detected"
    top_fillers = ", ".join(sorted({i["word"] for i in wc.get("filler_words", {}).get("instances", [])})) or "none"
    top_weak = ", ".join(sorted({i["word"] for i in wc.get("weak_words", {}).get("instances", [])})) or "none"
    restart_count = wc.get("restarts", {}).get("count", 0)
    top_repeated = ", ".join(f'"{r["phrase"]}" ×{r["count"]}' for r in wc.get("repeated_phrases", {}).get("top", [])) or "none"
    energy = dl.get("energy", {}).get("value")
    pitch_var = dl.get("pitch_variation", {}).get("value")
    expressivity = pr.get("facial_expressivity", {}).get("value")
    composure = pr.get("composure", {}).get("value")
    rushed_windows = [w for w in dl.get("pace", {}).get("windows", []) if w.get("flag") == "rush"]
    slow_windows = [w for w in dl.get("pace", {}).get("windows", []) if w.get("flag") == "slow"]
    completion = analytics.get("completion", {})
    return (
        f"- Talk time: {analytics.get('talk_time_sec', 0):.0f}s (target {completion.get('target_sec', 60)}s, {completion.get('status', 'na')})\n"
        f"- Pace: {dl.get('pace', {}).get('wpm', 0)} wpm ({dl.get('pace', {}).get('status', 'na')})"
        f"{f', rushed at {len(rushed_windows)} windows' if rushed_windows else ''}"
        f"{f', slow at {len(slow_windows)} windows' if slow_windows else ''}\n"
        f"- Filler words: {wc.get('filler_words', {}).get('pct', 0):.1f}% ({top_fillers})\n"
        f"- Restarts: {restart_count}\n"
        f"- Repeated phrases: {top_repeated}\n"
        f"- Weak/hedge words: {wc.get('weak_words', {}).get('pct', 0):.1f}% ({top_weak})\n"
        f"- Hedging phrases: {wc.get('hedging', {}).get('count', 0)} total (\"I think\", \"maybe\", etc.)\n"
        f"- Long pauses: {dl.get('pauses', {}).get('count', 0)} (longest {dl.get('pauses', {}).get('longest_sec', 0):.1f}s)\n"
        f"- Vocal energy (0=flat, 100=high): {round(energy) if energy is not None else 'N/A'}/100\n"
        f"- Pitch variation (0=monotone, 100=dynamic): {round(pitch_var) if pitch_var is not None else 'N/A'}/100\n"
        f"- Facial expressivity: {round(expressivity) if expressivity is not None else 'N/A'}/100\n"
        f"- Composure/confidence signals: {round(composure) if composure is not None else 'N/A'}/100\n"
        f"- Detected tone: {active_tones}\n"
    )




def _llm_coaching(api_key, scoring_spec, transcript_text, analytics_brief):
    """LLM grading using Prof. Nason's PCCP rubric (V3)."""
    grading_criteria = (scoring_spec.get("feedback_prompt_template") or "").strip()

    # Build component descriptions for the 7 key components + gambit
    TARGET_IDS = {"gambit", "pain", "solution", "customer", "competition", "deal", "team", "summary_sentence"}
    checks = scoring_spec.get("content_checks") or []
    comp_lines = "\n".join(
        f'  {c["id"]}: {c.get("label", "")} — {c.get("description", "")}'
        for c in checks if c["id"] in TARGET_IDS
    )

    prompt = f"""{grading_criteria}

Measured delivery signals (use these to calibrate your PCCP scores):
{analytics_brief}

Transcript:
\"\"\"
{transcript_text[:7000]}
\"\"\"

Component descriptions:
{comp_lines}

Return ONLY a valid JSON object (no markdown, no prose outside JSON):
{{
  "key_components": {{
    "pain":             {{"score": <1-10>, "comment": "<short specific note>"}},
    "solution":         {{"score": <1-10>, "comment": "<short specific note>"}},
    "customer":         {{"score": <1-10>, "comment": "<short specific note>"}},
    "competition":      {{"score": <1-10>, "comment": "<short specific note>"}},
    "deal":             {{"score": <1-10>, "comment": "<short specific note>"}},
    "team":             {{"score": <1-10>, "comment": "<short specific note>"}},
    "summary_sentence": {{"score": <1-10>, "comment": "<short specific note>"}}
  }},
  "opening_gambit": {{"score": <0-10 — 0 if no recognizable gambit present>, "comment": "<gambit type used or 'No gambit detected'; if score < 7 include one concrete example of a stronger opening for this specific pitch>"}},
  "pccp": {{
    "competence": {{"score": <1-10>, "comment": "<short note>"}},
    "confidence": {{"score": <1-10>, "comment": "<short note>"}},
    "passion":    {{"score": <1-10>, "comment": "<short note — extremely dry=1, awkward/unprofessional=3-4>"}}
  }},
  "overall_score": <1-10 — NOT a pure average; severe delivery flaws must drag this down>,
  "conclusion": "<1-3 sentences on how content and delivery interacted>",
  "areas_of_improvement": ["<specific area, e.g. Improve PCCP delivery>", "..."],
  "follow_up_questions": ["<question the audience is likely to ask that the speaker should prepare for>", "..."],
  "additional_points": ["<notable observation e.g. audience reaction, unusual delivery quirk>"]
}}

Scoring rules:
- Explicit clarity rewarded; vague or implied content penalized.
- opening_gambit: score 0 if the speaker launches straight into the pitch with no hook. Score 1-4 if there is a weak or accidental hook. Score 5-6 for a recognizable but flat gambit. Score 7-10 for a deliberate, attention-grabbing opener.
- opening_gambit comment: always name the gambit type (e.g. "Factoid gambit") or write "No gambit detected". If score < 7, include one concrete rewrite example tailored to this pitch (e.g. "Try opening with: 'Did you know 40% of athletes overtrain and never recover?'").
- Passion < 4 (extremely dry or unprofessional) must pull overall_score below key_components average.
- areas_of_improvement: 2 to 5 items.
- follow_up_questions: 2 to 3 tough questions the audience would likely ask based on gaps in this pitch.
- additional_points: 0 to 3 items; use [] if nothing notable."""

    llm = ChatOpenAI(model="gpt-4o", api_key=api_key, max_tokens=4000)
    raw = llm.invoke([HumanMessage(content=prompt)]).content
    return _parse_json(raw)


def score_submission(submission: dict, collected: dict, scoring_spec: dict, openai_api_key: str) -> dict:
    """Pure scoring. Returns the `video_scores` document body (no _id/insert)."""
    sm = compute_submetrics(collected)
    analytics = compute_analytics(collected, sm, target_duration_sec=int(scoring_spec.get("target_duration_sec", 60)))
    tone_tags = compute_tone_tags(analytics, sm)
    transcript_text = ((collected.get("transcript") or {}).get("text") or "")

    # LLM coaching — Prof. Nason's PCCP rubric (1-10 scale, converted to 0-100 internally).
    llm_content_score = None
    llm_overall = None
    content_checks = []
    pccp_eval = {}
    coaching = {"strength": "", "growth_areas": [], "follow_up_questions": [], "summary": []}
    try:
        ev = _llm_coaching(openai_api_key, scoring_spec, transcript_text, _analytics_brief(analytics, tone_tags))

        # Convert 1-10 scores → 0-100 for internal consistency
        label_map = {c["id"]: c.get("label", c["id"]) for c in (scoring_spec.get("content_checks") or [])}

        kc = ev.get("key_components") or {}
        for cid, d in kc.items():
            s = d.get("score")
            content_checks.append({
                "id": cid,
                "label": label_map.get(cid, cid),
                "passed": s >= 7 if s is not None else False,
                "score": round(s * 10) if s is not None else None,
                "note": d.get("comment", ""),
            })

        gambit = ev.get("opening_gambit") or {}
        gs = gambit.get("score")
        content_checks.append({
            "id": "gambit",
            "label": label_map.get("gambit", "Opening Gambit"),
            "passed": gs >= 7 if gs is not None else False,
            "score": round(gs * 10) if gs is not None else None,
            "note": gambit.get("comment", ""),
        })

        pccp_raw = ev.get("pccp") or {}
        for dim in ("competence", "confidence", "passion"):
            d = pccp_raw.get(dim) or {}
            s = d.get("score")
            pccp_eval[dim] = {
                "score": round(s * 10) if s is not None else None,
                "comment": d.get("comment", ""),
            }

        os_raw = ev.get("overall_score")
        llm_overall = round(os_raw * 10) if os_raw is not None else None
        llm_content_score = llm_overall  # feeds the competence sub-metric

        coaching = {
            "strength": "",
            "growth_areas": [
                {"title": s, "detail": "", "rewrites": []}
                for s in (ev.get("areas_of_improvement") or [])
            ],
            "follow_up_questions": ev.get("follow_up_questions") or [],
            "summary": [ev["conclusion"]] if ev.get("conclusion") else [],
            "additional_points": ev.get("additional_points") or [],
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
        "llm_overall": llm_overall,
        "pccp_eval": pccp_eval,
        "coaching": coaching,
        "analytics": analytics,
        "tone_tags": tone_tags,
        "feedback": feedback,
        "timeline_markers": [],
        "scored_at": time.time(),
    }
