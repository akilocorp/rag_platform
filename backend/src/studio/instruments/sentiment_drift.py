# @language  Python
# @updated   2026-09-08
# @changed   New file: the Sentiment-Drift Tracker instrument. Companion to Vocal Emotion Trace, but
#            a trajectory instead of a snapshot: tracks the conversation's single overall-dominant
#            emotion (summed across every user turn, same as Vocal Emotion Trace's own logic) and
#            measures how *that specific emotion's* score moved from the first user turn to the
#            last. Deliberately not "each turn's own top emotion" — a turn's top emotion can swap
#            name to name, which would make first-vs-last a meaningless comparison across different
#            emotions. No Hume valence/arousal dimension is assumed or hardcoded; this only compares
#            a named emotion against itself over time, so it works regardless of Hume's exact
#            emotion taxonomy.
"""Sentiment-Drift Tracker — how the conversation's dominant vocal emotion moved over its course."""
from src.studio.instruments.base import instrument


def _compute(answer, config):
    turns = [
        t for t in (answer.get("value") or [])
        if isinstance(t, dict) and t.get("role") == "user" and t.get("prosody")
    ]
    if len(turns) < 2:
        return {}

    totals = {}
    for t in turns:
        for name, score in (t.get("prosody") or {}).items():
            try:
                totals[name] = totals.get(name, 0) + float(score)
            except (TypeError, ValueError):
                continue
    if not totals:
        return {}

    dominant = max(totals, key=totals.get)
    first_score = float((turns[0].get("prosody") or {}).get(dominant, 0) or 0)
    last_score = float((turns[-1].get("prosody") or {}).get(dominant, 0) or 0)
    return {
        "tracked_emotion": dominant,
        "drift": round(last_score - first_score, 3),
    }


@instrument(
    instrument_type="sentiment_drift",
    label="Sentiment-Drift Tracker",
    icon="chart-line",
    kind="measurement",
    default_config={},
    applies_to=["voice_conversation"],
    needs_events=False,
    compute=_compute,
    is_ai=True,
)
def validate(config):
    return {}
