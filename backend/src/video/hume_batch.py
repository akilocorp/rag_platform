"""Hume Expression Measurement **Batch API** — Prosody + Face on an uploaded video.

This is a DIFFERENT product from the real-time EVI used in routes/audio.py. We
reuse only the HUME_API_KEY credential. Flow (REST, stable across SDK versions):
  1. POST /v0/batch/jobs  with {models:{prosody,face}, urls:[<presigned GET>]}
  2. poll GET /v0/batch/jobs/{id}      until state COMPLETED / FAILED
  3. GET  /v0/batch/jobs/{id}/predictions

Submit+poll backoff mirrors `_claude_via_batch` in store_vector_stores.py.
Returns normalized per-frame arrays (or None on timeout/failure — caller decides).
"""
import logging
import os
import time

import requests

logger = logging.getLogger(__name__)

HUME_BASE = "https://api.hume.ai/v0/batch/jobs"
# Cap frames persisted per modality so the collected-data doc stays well under
# the 16MB BSON limit. Hume samples densely; this is plenty for scoring + UI.
MAX_FRAMES = 1500


def _timeout_seconds() -> int:
    try:
        return int(os.getenv("HUME_BATCH_TIMEOUT", "1200"))
    except ValueError:
        return 1200


def run_hume_batch(media_url: str) -> dict | None:
    """Run prosody + face on `media_url` (a publicly-fetchable URL, e.g. a
    presigned S3 GET). Returns:

        {"prosody": {"frames": [...]}, "face": {"frames": [...]}, "raw": <predictions>}

    or None on failure.
    """
    api_key = os.getenv("HUME_API_KEY")
    if not api_key:
        logger.error("Hume batch: HUME_API_KEY not configured")
        return None

    headers = {"X-Hume-Api-Key": api_key}
    payload = {"models": {"prosody": {}, "face": {}}, "urls": [media_url]}

    try:
        resp = requests.post(HUME_BASE, headers={**headers, "Content-Type": "application/json"},
                             json=payload, timeout=30)
        resp.raise_for_status()
        job_id = resp.json().get("job_id")
        if not job_id:
            logger.error("Hume batch: no job_id in response %s", resp.text[:300])
            return None
        logger.info("Hume batch submitted | job=%s", job_id)

        start = time.time()
        deadline = start + _timeout_seconds()
        while True:
            j = requests.get(f"{HUME_BASE}/{job_id}", headers=headers, timeout=30)
            j.raise_for_status()
            status = (j.json().get("state") or {}).get("status", "")
            if status == "COMPLETED":
                break
            if status == "FAILED":
                logger.error("Hume batch FAILED | job=%s body=%s", job_id, j.text[:300])
                return None
            if time.time() > deadline:
                logger.error("Hume batch timed out | job=%s elapsed=%ds", job_id, int(time.time() - start))
                return None
            time.sleep(5 if (time.time() - start) < 60 else 15)

        preds = requests.get(f"{HUME_BASE}/{job_id}/predictions", headers=headers, timeout=60)
        preds.raise_for_status()
        data = preds.json()
        logger.info("Hume batch predictions retrieved | job=%s", job_id)
        return _normalize(data)
    except Exception as e:
        logger.error("Hume batch crashed | err=%s", e, exc_info=True)
        return None


def _emotions_to_map(emotions) -> dict:
    out = {}
    for e in (emotions or []):
        name = e.get("name") if isinstance(e, dict) else None
        if name is not None:
            out[name] = round(float(e.get("score", 0.0)), 4)
    return out


def _downsample(frames: list) -> list:
    if len(frames) <= MAX_FRAMES:
        return frames
    step = len(frames) / MAX_FRAMES
    return [frames[int(i * step)] for i in range(MAX_FRAMES)]


def _normalize(data) -> dict:
    """Walk Hume's nested predictions into flat per-frame arrays. Defensive
    against missing keys (a model can return no predictions)."""
    prosody_frames, face_frames = [], []
    try:
        for source in (data or []):
            for fileres in (source.get("results", {}).get("predictions", []) or []):
                models = fileres.get("models", {}) or {}

                for gp in (models.get("prosody", {}).get("grouped_predictions", []) or []):
                    for p in (gp.get("predictions", []) or []):
                        t = p.get("time", {}) or {}
                        prosody_frames.append({
                            "time_start": round(float(t.get("begin", 0.0)), 3),
                            "time_end": round(float(t.get("end", 0.0)), 3),
                            "emotions": _emotions_to_map(p.get("emotions")),
                        })

                for gp in (models.get("face", {}).get("grouped_predictions", []) or []):
                    for p in (gp.get("predictions", []) or []):
                        frame: dict = {
                            "time": round(float(p.get("time", 0.0) or 0.0), 3),
                            "emotions": _emotions_to_map(p.get("emotions")),
                        }
                        raw_bbox = p.get("bbox")
                        if raw_bbox:
                            frame["bbox"] = {
                                "x": round(float(raw_bbox.get("x", 0.0)), 2),
                                "y": round(float(raw_bbox.get("y", 0.0)), 2),
                                "w": round(float(raw_bbox.get("w", 0.0)), 2),
                                "h": round(float(raw_bbox.get("h", 0.0)), 2),
                            }
                        face_frames.append(frame)
    except Exception as e:
        logger.error("Hume normalize error: %s", e, exc_info=True)

    return {
        "prosody": {"frames": _downsample(prosody_frames)},
        "face": {"frames": _downsample(face_frames)},
        "raw": None,  # full payload offload to S3 is a later optimization; omit for now
    }
