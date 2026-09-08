# @language  Python
# @updated   2026-09-08
# @changed   New file: the Vocal Emotion Trace instrument — the first of the "AI-native, Qualtrics
#            can't do this" batch. Reads the Hume prosody scores already captured per-turn by the
#            Voice Conversation block (frontend/src/components/EVIAudioControls.jsx's onTurn ->
#            `m.models.prosody.scores`, stored verbatim on each turn in the block's own answer
#            value) — no new API call, no new cost, purely a summary of data already sitting there.
#            Only respondent ("user") turns count; the AI assistant's own vocal delivery isn't the
#            research signal here.
"""Vocal Emotion Trace — the respondent's dominant vocal emotion across a voice conversation."""
from src.studio.instruments.base import instrument


def _compute(answer, config):
    turns = [
        t for t in (answer.get("value") or [])
        if isinstance(t, dict) and t.get("role") == "user" and t.get("prosody")
    ]
    if not turns:
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
    return {
        "dominant_emotion": dominant,
        "dominant_emotion_avg": round(totals[dominant] / len(turns), 3),
    }


@instrument(
    instrument_type="vocal_emotion_trace",
    label="Vocal Emotion Trace",
    icon="smile",
    kind="measurement",
    default_config={},
    applies_to=["voice_conversation"],
    needs_events=False,
    compute=_compute,
    is_ai=True,
)
def validate(config):
    return {}
