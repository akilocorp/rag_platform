"""Sample video frames to extract lighting quality and frame dimensions.

Runs once per submission inside the pipeline thread pool before the temp file
is deleted. Returns a small dict stored in collected_doc["visual"].
"""
import logging
import os

logger = logging.getLogger(__name__)

SAMPLE_COUNT = 12   # frames to sample for brightness
IDEAL_BRIGHTNESS_LOW = 80
IDEAL_BRIGHTNESS_HIGH = 180


def analyze_video_frames(video_path: str) -> dict:
    """Return lighting stats and frame dimensions. Never raises — returns {} on failure."""
    try:
        import cv2
        import numpy as np
    except ImportError:
        logger.warning("opencv-python-headless not installed; skipping visual analysis")
        return {}

    try:
        cap = cv2.VideoCapture(video_path)
        frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
        width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        brightnesses = []
        if frame_count > 0:
            indices = [int(i * frame_count / SAMPLE_COUNT) for i in range(SAMPLE_COUNT)]
            for idx in indices:
                cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
                ret, frame = cap.read()
                if ret:
                    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                    brightnesses.append(float(np.mean(gray)))
        cap.release()

        result = {"frame_width": width, "frame_height": height}
        if brightnesses:
            result["mean_brightness"] = round(sum(brightnesses) / len(brightnesses), 1)
            result["min_brightness"] = round(min(brightnesses), 1)

        logger.info(
            "Visual analysis done | file=%s frames_sampled=%d brightness=%.1f",
            os.path.basename(video_path), len(brightnesses),
            result.get("mean_brightness", -1),
        )
        return result
    except Exception as e:
        logger.error("Visual analysis failed | file=%s err=%s", video_path, e)
        return {}
