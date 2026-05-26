"""Whisper transcription with word-level timestamps.

Reuses the OpenAI `whisper-1` path already used in routes/audio.py, but asks for
`verbose_json` + word granularity so the scoring layer can derive pace, pauses,
and filler distribution. Returns a plain dict (no scoring here).
"""
import logging
import os

logger = logging.getLogger(__name__)


def transcribe_words(audio_path: str, api_key: str) -> dict:
    """Transcribe a local audio file. Returns:

        {
          "text": str,
          "words": [{"word": str, "start": float, "end": float}, ...],
          "segments": [{"start": float, "end": float, "text": str}, ...],
          "duration": float,
        }

    Raises on hard failure so the worker can mark the job failed.
    """
    import openai

    client = openai.OpenAI(api_key=api_key)
    with open(audio_path, "rb") as fh:
        result = client.audio.transcriptions.create(
            model="whisper-1",
            file=fh,
            response_format="verbose_json",
            timestamp_granularities=["word", "segment"],
        )

    # The SDK returns an object; normalize to plain dicts.
    words = []
    for w in (getattr(result, "words", None) or []):
        words.append({
            "word": getattr(w, "word", None) if not isinstance(w, dict) else w.get("word"),
            "start": float(getattr(w, "start", 0.0) if not isinstance(w, dict) else w.get("start", 0.0)),
            "end": float(getattr(w, "end", 0.0) if not isinstance(w, dict) else w.get("end", 0.0)),
        })

    segments = []
    for s in (getattr(result, "segments", None) or []):
        get = (lambda k, d=None: s.get(k, d)) if isinstance(s, dict) else (lambda k, d=None: getattr(s, k, d))
        segments.append({
            "start": float(get("start", 0.0) or 0.0),
            "end": float(get("end", 0.0) or 0.0),
            "text": (get("text", "") or "").strip(),
        })

    text = (getattr(result, "text", "") or "").strip()
    duration = float(getattr(result, "duration", 0.0) or 0.0)
    if not duration and words:
        duration = words[-1]["end"]

    logger.info(
        "Whisper done | file=%s words=%d segments=%d duration=%.1fs",
        os.path.basename(audio_path), len(words), len(segments), duration,
    )
    return {"text": text, "words": words, "segments": segments, "duration": duration}
