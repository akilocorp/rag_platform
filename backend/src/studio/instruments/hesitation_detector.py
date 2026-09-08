# @language  Python
# @updated   2026-09-08
# @changed   New file: the Hesitation/Disfluency Detector instrument. Unlike its two Voice
#            Conversation siblings, this one doesn't touch Hume's prosody scores at all — it's a
#            plain filler-word regex over the respondent's own transcript text. Marked `is_ai=True`
#            anyway (matching Voice Conversation's own framing): the signal only exists because this
#            is a voice modality with a transcript to analyze, not because it calls a model.
"""Hesitation/Disfluency Detector — counts filler words/hedges in the respondent's spoken turns."""
import re

from src.studio.instruments.base import instrument

_FILLER_PATTERN = re.compile(
    r"\b(um+|uh+|erm+|like|you know|i mean|sort of|kind of)\b", re.IGNORECASE
)


def _compute(answer, config):
    turns = [
        t for t in (answer.get("value") or [])
        if isinstance(t, dict) and t.get("role") == "user" and t.get("transcript")
    ]
    if not turns:
        return {}

    total_words = 0
    filler_count = 0
    for t in turns:
        text = str(t.get("transcript") or "")
        total_words += len(text.split())
        filler_count += len(_FILLER_PATTERN.findall(text))

    if total_words == 0:
        return {}

    return {
        "filler_count": filler_count,
        "filler_rate_per_100_words": round(filler_count / total_words * 100, 1),
    }


@instrument(
    instrument_type="hesitation_detector",
    label="Hesitation Detector",
    icon="comment-dots",
    kind="measurement",
    default_config={},
    applies_to=["voice_conversation"],
    needs_events=False,
    compute=_compute,
    is_ai=True,
)
def validate(config):
    return {}
