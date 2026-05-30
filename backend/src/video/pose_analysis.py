"""MediaPipe Pose analysis — runs in the pipeline thread pool alongside Hume/Whisper.

Returns a compact dict stored in collected_doc["pose"]; scoring.py reads it to
produce posture / sway / gesture_activity / awkward_gestures submetrics.

Frame subsampling (every 5th frame) keeps runtime under ~20s for a 90-second
video at 30fps. Never raises — returns {} on any failure so the pipeline
degrades gracefully.
"""
import logging
import os

logger = logging.getLogger(__name__)

SAMPLE_EVERY_N = 5          # process 1 in 5 frames ≈ 6 fps equivalent
MIN_VIS = 0.5               # ignore landmarks below this MediaPipe visibility score

# MediaPipe BlazePose 33-point landmark indices
_NOSE    = 0
_L_EAR, _R_EAR = 7, 8
_L_SHLDR, _R_SHLDR = 11, 12
_L_HIP,   _R_HIP   = 23, 24
_L_WRIST, _R_WRIST = 15, 16


def run_mediapipe_pose(video_path: str) -> dict:
    """Analyse pose in video_path; return signal dict or {} on failure."""
    try:
        import cv2
        from mediapipe.python.solutions import pose as mp_pose
        logger.info("Pose analysis starting | file=%s", os.path.basename(video_path))
    except Exception as e:
        logger.warning("mediapipe unavailable (%s); skipping pose analysis", e)
        return {}

    posture_scores: list   = []
    torso_xs:       list   = []
    # Each entry: (l_wrist_x, l_wrist_y, r_wrist_x, r_wrist_y, nose_x, nose_y)
    frame_data:     list   = []
    frames_read    = 0

    try:
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            logger.warning("Pose: cv2 could not open video | file=%s", os.path.basename(video_path))
            return {}

        with mp_pose.Pose(
            static_image_mode=False,
            model_complexity=1,
            enable_segmentation=False,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        ) as pose:
            idx = 0
            while True:
                ret, frame = cap.read()
                if not ret:
                    break
                idx += 1
                frames_read += 1
                if idx % SAMPLE_EVERY_N != 0:
                    continue

                result = pose.process(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
                if not result.pose_landmarks:
                    continue

                lm = result.pose_landmarks.landmark

                def xy(i):
                    p = lm[i]
                    return (p.x, p.y) if p.visibility >= MIN_VIS else None

                ls, rs = xy(_L_SHLDR), xy(_R_SHLDR)
                lh, rh = xy(_L_HIP),   xy(_R_HIP)
                lw, rw = xy(_L_WRIST), xy(_R_WRIST)
                nose   = xy(_NOSE)

                # posture: shoulder midpoint should sit directly above hip midpoint
                if ls and rs and lh and rh:
                    sh_cx  = (ls[0] + rs[0]) / 2
                    hip_cx = (lh[0] + rh[0]) / 2
                    lateral = abs(sh_cx - hip_cx)
                    # 0 → perfect; ≥0.15 → severe lean
                    posture_scores.append(max(0.0, min(100.0, 100.0 * (1.0 - lateral / 0.15))))
                    torso_xs.append((sh_cx + hip_cx) / 2)

                frame_data.append((
                    lw[0] if lw else None, lw[1] if lw else None,
                    rw[0] if rw else None, rw[1] if rw else None,
                    nose[0] if nose else None, nose[1] if nose else None,
                ))

        cap.release()
    except Exception as e:
        logger.error("Pose capture failed | file=%s err=%s", os.path.basename(video_path), e)
        return {}

    if not posture_scores and not frame_data:
        logger.warning(
            "Pose: no landmarks detected in %d frames | file=%s",
            frames_read, os.path.basename(video_path),
        )
        return {}

    posture = round(_mean(posture_scores), 1) if posture_scores else None

    sway = None
    if len(torso_xs) > 5:
        sd = _stddev(torso_xs)
        # stddev 0 → stable (100); ≥0.05 → noticeable sway (0)
        sway = round(max(0.0, min(100.0, 100.0 * (1.0 - sd / 0.05))), 1)

    gesture_activity, awkward_gestures = (None, None)
    if len(frame_data) > 5:
        gesture_activity, awkward_gestures = _gesture_signals(frame_data)

    logger.info(
        "Pose done | file=%s frames=%d posture=%.1f sway=%s gesture=%.1f awkward=%.1f",
        os.path.basename(video_path), len(posture_scores),
        posture or 0, sway, gesture_activity or 0, awkward_gestures or 0,
    )
    return {
        "posture":          posture,
        "sway":             sway,
        "gesture_activity": gesture_activity,
        "awkward_gestures": awkward_gestures,
        "frames_analyzed":  len(posture_scores),
    }


def _gesture_signals(frame_data: list):
    """Return (gesture_activity_score, awkward_gestures_score) from per-frame wrist data."""
    velocities  = []
    awkward_n   = 0

    for i in range(len(frame_data)):
        lx, ly, rx, ry, nx, ny = frame_data[i]

        # --- awkward gesture detection ---
        awkward = False

        # Arms crossed: in image space, the RIGHT_WRIST (person's right = image left)
        # should have a LOWER x than the LEFT_WRIST (person's left = image right).
        # If rx > lx they've swapped → arms crossed.
        if lx is not None and rx is not None and rx > lx + 0.03:
            awkward = True

        # Hands near face: wrist within ~15% of frame of the nose
        if nx is not None and ny is not None:
            for wx, wy in ((lx, ly), (rx, ry)):
                if wx is not None and wy is not None:
                    if abs(wx - nx) < 0.15 and abs(wy - ny) < 0.15:
                        awkward = True
                        break

        if awkward:
            awkward_n += 1

        # --- velocity (frame-to-frame wrist displacement) ---
        if i == 0:
            continue
        plx, ply, prx, pry, *_ = frame_data[i - 1]
        dists = []
        if lx is not None and plx is not None:
            dists.append(((lx - plx) ** 2 + (ly - ply) ** 2) ** 0.5)
        if rx is not None and prx is not None:
            dists.append(((rx - prx) ** 2 + (ry - pry) ** 2) ** 0.5)
        if dists:
            velocities.append(sum(dists) / len(dists))

    # Gesture activity: Goldilocks — very low = stiff, moderate = natural, very high = fidgeting
    mean_vel = _mean(velocities)
    if mean_vel < 0.005:
        ga = 40.0
    elif mean_vel <= 0.015:
        ga = 60.0 + (mean_vel - 0.005) / 0.01 * 40.0
    elif mean_vel <= 0.04:
        ga = 100.0
    elif mean_vel <= 0.08:
        ga = max(40.0, 100.0 - (mean_vel - 0.04) / 0.04 * 60.0)
    else:
        ga = 20.0

    # Awkward gestures: 0% awkward frames = 100, ≥30% = 0
    n = len(frame_data)
    awk_ratio = awkward_n / n if n > 0 else 0.0
    awk_score = round(max(0.0, min(100.0, 100.0 * (1.0 - awk_ratio / 0.30))), 1)

    return round(ga, 1), awk_score


def _mean(xs):
    xs = [x for x in xs if x is not None]
    return sum(xs) / len(xs) if xs else 0.0


def _stddev(xs):
    xs = [x for x in xs if x is not None]
    if len(xs) < 2:
        return 0.0
    m = sum(xs) / len(xs)
    return (sum((x - m) ** 2 for x in xs) / len(xs)) ** 0.5
