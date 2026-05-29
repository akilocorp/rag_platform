"""AssemblyAI transcription with word-level timestamps and disfluency detection.

Replaces whisper_words.py for the video pipeline. Returns the same shape:
    {"text": str, "words": [{word, start, end}], "segments": [...], "duration": float}

AssemblyAI timestamps are in milliseconds; we convert to seconds on the way out.
disfluencies=True ensures "um", "uh", "you know" etc. are preserved as word tokens.
"""
import logging
import os

logger = logging.getLogger(__name__)


def transcribe_words(audio_path: str, api_key: str) -> dict:
    import assemblyai as aai

    aai.settings.api_key = api_key
    config = aai.TranscriptionConfig(
        disfluencies=True,
        speech_model="universal-2",
    )
    result = aai.Transcriber(config=config).transcribe(audio_path)

    if result.status == aai.TranscriptStatus.error:
        raise RuntimeError(f"AssemblyAI transcription failed: {result.error}")

    words = [
        {"word": w.text, "start": w.start / 1000.0, "end": w.end / 1000.0}
        for w in (result.words or [])
    ]
    segments = _words_to_segments(words)
    text = result.text or ""
    duration = words[-1]["end"] if words else 0.0

    logger.info(
        "AssemblyAI done | file=%s words=%d segments=%d duration=%.1fs",
        os.path.basename(audio_path), len(words), len(segments), duration,
    )
    return {"text": text, "words": words, "segments": segments, "duration": duration}


def _words_to_segments(words, pause_threshold=0.8):
    if not words:
        return []
    segments = []
    current = [words[0]]
    for w in words[1:]:
        if w["start"] - current[-1]["end"] > pause_threshold:
            segments.append({
                "start": current[0]["start"],
                "end": current[-1]["end"],
                "text": " ".join(x["word"] for x in current),
            })
            current = []
        current.append(w)
    if current:
        segments.append({
            "start": current[0]["start"],
            "end": current[-1]["end"],
            "text": " ".join(x["word"] for x in current),
        })
    return segments
