"""ACTR presentation-behavior API client.

Single source of delivery + transcript data for the video pipeline. POSTs the
video file (multipart field name `video`, per the API contract) to
video.actrlab.com/analyze and returns:

    {
      "available": bool,            # False on any failure (never raises)
      "report": str,               # 1-paragraph body-language / delivery narrative
      "transcript": dict,          # {language, duration_sec, text, segments, formatted}
      "transcript_text": str,      # convenience: transcript["text"]
      "duration_sec": float,
      "error": str | None,
    }

This replaces the old per-modality fan-out (AssemblyAI + Hume + OpenCV): the
`report` describes the delivery/body-language, the `transcript` the words. The
scoring layer feeds both to the LLM agent chain. Endpoint + timeout are
env-overridable for staging.
"""
import logging
import os

import requests

logger = logging.getLogger(__name__)

ACTRLAB_ENDPOINT = os.getenv("ACTRLAB_ANALYZE_URL", "https://video.actrlab.com/analyze")
# Analysis runs vision + ASR server-side; an 80s clip took ~85s end-to-end, so
# give long pitches plenty of headroom.
ACTRLAB_TIMEOUT = int(os.getenv("ACTRLAB_TIMEOUT", "600"))


def analyze_video_actrlab(video_path: str, timeout: int = None) -> dict:
    """Send the video to the ACTR analyze endpoint. Never raises — failures come
    back as {"available": False, "error": ...} so the pipeline can decide."""
    timeout = timeout or ACTRLAB_TIMEOUT
    try:
        with open(video_path, "rb") as f:
            resp = requests.post(
                ACTRLAB_ENDPOINT,
                files={"video": (os.path.basename(video_path), f, "video/mp4")},
                timeout=timeout,
            )
        resp.raise_for_status()
        data = resp.json()
        transcript = data.get("transcript") or {}
        return {
            "available": True,
            "report": (data.get("report") or "").strip(),
            "transcript": transcript,
            "transcript_text": (transcript.get("text") or "").strip(),
            "duration_sec": float(data.get("duration_sec") or transcript.get("duration_sec") or 0.0),
            "error": None,
        }
    except Exception as e:
        logger.error("ACTR analyze failed for %s: %s", video_path, e, exc_info=True)
        return {
            "available": False,
            "report": "",
            "transcript": {},
            "transcript_text": "",
            "duration_sec": 0.0,
            "error": str(e),
        }
