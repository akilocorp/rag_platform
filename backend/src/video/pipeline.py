# @language  Python
# @updated   2026-10-06
# @changed   Priority lane: `dispatch_pipeline(..., priority=True)` (uploads by the professor or a
#            collaborator) goes ahead of every student video, first-come among priority uploads.
#            Prior: Videos now wait in a first-come-first-served queue with no time limit, worked by
#            VIDEO_MAX_CONCURRENT worker threads, instead of each thread racing a 10-minute semaphore
#            ("Video worker pool busy"). Every waiting student is pushed their live place in line
#            (`video_queue_position`) whenever the line moves; `queue_status()` serves the same to the poll.
"""Video processing pipeline (background worker).

Dispatch mirrors user_files._run_async_pdf_ingest: a daemon thread that runs
inside app_context, reads socketio from current_app.extensions, and emits
progress. The video is transcoded for playback, then sent to the ACTR analyze
API which returns a body-language report + transcript; scoring runs an LLM
agent chain over those (see scoring.py).

The worker is a pure function of `submission_id` (reads everything else from
Mongo/S3), so it can later move behind a real queue without a rewrite.
"""
import logging
import os
import re
import secrets
import subprocess
import threading
import time
import uuid
from collections import deque
from datetime import datetime, timedelta

from bson import ObjectId

from src.utils.s3_client import get_s3_client, get_bucket
from src.video.actrlab_analyze import analyze_video_actrlab
from src.video.scoring import score_submission
from src.video.rubrics import registry

logger = logging.getLogger(__name__)


def _dbg(submission_id, msg):
    """Force-flushed stdout marker so we can trace pipeline progress in the
    container logs even when the logging level filters INFO. Greppable prefix.
    TODO: remove once the stuck-pipeline bug is diagnosed."""
    try:
        print(f"[VIDEO_DBG] sub={submission_id} | {msg}", flush=True)
    except Exception:
        pass


TMP_DIR = "uploads/video_tmp"
# How many videos are processed at once. Each one runs an ffmpeg transcode on this
# server and then waits on the external analyze API, so this is the knob that trades
# server load against how fast a class's queue clears.
_MAX_CONCURRENT = max(1, int(os.getenv("VIDEO_MAX_CONCURRENT", "2")))
RESULT_TOKEN_TTL_DAYS = 30
# Bound the ffmpeg subprocesses — a slow/hung encode must never block the worker
# forever. Transcode timeout is non-fatal (caller falls back to the original).
_TRANSCODE_TIMEOUT = int(os.getenv("VIDEO_TRANSCODE_TIMEOUT", "240"))


# ---------------------------------------------------------------------------
# Job queue
# ---------------------------------------------------------------------------
# A whole class uploads within minutes, so videos wait their turn here in upload
# order. Nothing in the line times out: the old per-thread semaphore failed any
# video that waited 10 minutes, and students who re-uploaded only joined the back
# of the same line. In-process memory, like the rest of this module — a restart
# empties it, and `video_routes.submission_status` puts a lost video back in line
# the next time its page polls (deliberately not at boot: the deploy's preflight
# container boots this same code against the same database).
_DEFAULT_JOB_SECONDS = 120.0
_q_cond = threading.Condition()
_waiting = deque()                      # (app, submission_id, job_id, priority), priority first, then oldest
_running = {}                           # submission_id -> start time
_recent_durations = deque(maxlen=10)    # seconds per finished job, for the ETA
_workers_started = False


def dispatch_pipeline(app, submission_id: str, job_id: str, priority: bool = False):
    """Put a submission in line. Returns immediately.

    Students join the back. A `priority` video (uploaded by the professor or a
    collaborator — e.g. the group pitch the class is waiting to see scored) goes
    ahead of every student video but behind earlier priority ones, so two staff
    uploads still keep their order. Videos already running are never interrupted.

    Idempotent per submission: one already waiting or running is left where it is,
    so a duplicate dispatch can't process (and bill) the same video twice.
    """
    _dbg(submission_id, f"dispatch_pipeline called | job_id={job_id} | priority={priority}")
    global _workers_started
    with _q_cond:
        if submission_id in _running or any(w[1] == submission_id for w in _waiting):
            return
        item = (app, submission_id, job_id, bool(priority))
        if priority:
            # Index of the first student video: the new one slots in just before it.
            at = next((i for i, w in enumerate(_waiting) if not w[3]), len(_waiting))
            _waiting.insert(at, item)
        else:
            _waiting.append(item)
        if not _workers_started:
            for i in range(_MAX_CONCURRENT):
                threading.Thread(target=_worker_loop, daemon=True, name=f"video-worker-{i}").start()
            _workers_started = True
        _q_cond.notify()
    _broadcast_positions(app)


def _worker_loop():
    """One of the VIDEO_MAX_CONCURRENT workers: take the oldest waiting video, run it, repeat."""
    while True:
        with _q_cond:
            while not _waiting:
                _q_cond.wait()
            app, submission_id, job_id, _priority = _waiting.popleft()
            _running[submission_id] = time.time()
        # Everyone behind just moved up one.
        _broadcast_positions(app)
        try:
            _run_video_pipeline(app, submission_id, job_id)
        except Exception:  # noqa: BLE001 — a crashed job must never take its worker down
            logger.exception("[PIPELINE] worker crashed on sub=%s", submission_id)
        finally:
            with _q_cond:
                started = _running.pop(submission_id, None)
                if started:
                    _recent_durations.append(time.time() - started)


def _avg_job_seconds():
    """Mean duration of recent jobs (caller holds the lock); a sane default before any finish."""
    return (sum(_recent_durations) / len(_recent_durations)) if _recent_durations else _DEFAULT_JOB_SECONDS


def _position_payload(index):
    """Place-in-line payload for the waiting video at 0-based `index` (caller holds the lock).

    The ETA assumes every slot is busy and turns over once per average job: a video
    starts after ceil(position / slots) rounds and then takes one more job's time.
    """
    avg = _avg_job_seconds()
    position = index + 1
    rounds = (position + _MAX_CONCURRENT - 1) // _MAX_CONCURRENT
    return {
        "state": "waiting",
        "position": position,
        "ahead": index,
        "eta_sec": int(rounds * avg + avg),
    }


def queue_status(submission_id: str):
    """Where a submission is in this process's queue: waiting (with its place), running, or None."""
    with _q_cond:
        if submission_id in _running:
            return {"state": "running"}
        for i, w in enumerate(_waiting):
            if w[1] == submission_id:
                return _position_payload(i)
    return None


def _broadcast_positions(app):
    """Push every waiting video its current place in line, to that submission's room."""
    with _q_cond:
        updates = [(w[1], _position_payload(i)) for i, w in enumerate(_waiting)]
    sio = app.extensions.get("socketio") if app else None
    if not sio:
        return
    for submission_id, payload in updates:
        try:
            sio.emit("video_queue_position", {"submission_id": submission_id, **payload},
                     room=f"video:{submission_id}")
        except Exception:  # noqa: BLE001 — a missed update is corrected by the next one or the poll
            logger.warning("[PIPELINE] queue position emit failed for %s", submission_id)


def _emit(sio, submission, event, payload):
    if not sio:
        return
    base = {"submission_id": str(submission["_id"]), **payload}
    sio.emit(event, base, room=f"video:{submission['_id']}")
    owner = submission.get("owner_user_id")
    if owner:
        sio.emit(event, base, room=f"user:{owner}")


def _safe_unlink(path):
    try:
        if path and os.path.exists(path):
            os.remove(path)
    except Exception:
        pass


def _ffmpeg_exe():
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"


def _transcode_for_web(video_path: str) -> str:
    """Re-encode to H.264/AAC MP4.

    Handles HEVC (iPhone default), MOV container, and portrait rotation metadata
    (ffmpeg applies stored rotation when re-encoding). yuv420p ensures every
    browser can decode the result.
    """
    out = video_path + "_web.mp4"
    cmd = [
        _ffmpeg_exe(), "-y", "-i", video_path,
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "23",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        "-pix_fmt", "yuv420p",
        out,
    ]
    # timeout → TimeoutExpired (an Exception); the caller catches it and falls
    # back to the original upload, so a slow encode degrades instead of hanging.
    try:
        subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                       timeout=_TRANSCODE_TIMEOUT)
    except Exception:
        _safe_unlink(out)  # drop the partial encode so timeouts don't leak disk
        raise
    return out


def _run_video_pipeline(app, submission_id: str, job_id: str):
    _dbg(submission_id, "worker thread STARTED")
    with app.app_context():
        from flask import current_app
        db = current_app.config["MONGO_DB"]
        subs = db["video_submissions"]
        jobs = db["video_jobs"]
        sio = current_app.extensions.get("socketio")

        sub = subs.find_one({"_id": ObjectId(submission_id)})
        if not sub:
            logger.error("Pipeline: submission %s not found", submission_id)
            _dbg(submission_id, "ABORT: submission not found in DB")
            return

        # Human-readable tag for every log line — grep by name or email to track a student
        _name  = sub.get("submitter_name") or "unknown"
        _email = sub.get("submitter_email") or ""
        tag = f"sub={submission_id} | {_name} <{_email}>"

        _dbg(submission_id, f"worker slot taken (max_concurrent={_MAX_CONCURRENT}) | {_name} <{_email}>")
        tmp_video = None
        tmp_processed = None
        try:
            logger.info("[PIPELINE] START | %s | status=processing", tag)
            subs.update_one({"_id": sub["_id"]}, {"$set": {"status": "processing", "updated_at": time.time()}})
            jobs.update_one({"_id": ObjectId(job_id)}, {"$set": {"status": "processing", "updated_at": time.time()}})
            _emit(sio, sub, "video_job_progress", {"stage": "downloading", "job_id": job_id})

            # 1. Download from S3 to tmp (transient — cleaned in finally).
            os.makedirs(TMP_DIR, exist_ok=True)
            storage_key = sub["storage_key"]
            tmp_video = os.path.join(TMP_DIR, f"{uuid.uuid4().hex}_{os.path.basename(storage_key)}")
            _dbg(submission_id, f"downloading from S3 | key={storage_key}")
            logger.info("[PIPELINE] downloading | %s", tag)
            get_s3_client().download_file(get_bucket(), storage_key, tmp_video)
            _dbg(submission_id, f"download complete | size={os.path.getsize(tmp_video) if os.path.exists(tmp_video) else '??'} bytes")

            # 2. Transcode to H.264 MP4 (fixes HEVC/MOV phone videos for browsers
            #    + gives the analyze API a consistent container). Upload for playback.
            _emit(sio, sub, "video_job_progress", {"stage": "extracting_audio", "job_id": job_id})
            try:
                _dbg(submission_id, "transcoding to H.264…")
                tmp_processed = _transcode_for_web(tmp_video)
                processed_key = re.sub(r'\.[^.]+$', '', storage_key) + "_processed.mp4"
                get_s3_client().upload_file(tmp_processed, get_bucket(), processed_key,
                                            ExtraArgs={"ContentType": "video/mp4"})
                subs.update_one({"_id": sub["_id"]}, {"$set": {"processed_key": processed_key}})
                analyze_source = tmp_processed
                _dbg(submission_id, "transcode + upload complete")
            except Exception as tc_err:
                logger.warning("Transcode failed, falling back to original: %s", tc_err)
                _dbg(submission_id, f"transcode FAILED, using original | {type(tc_err).__name__}: {tc_err}")
                analyze_source = tmp_video

            openai_key = current_app.config.get("OPENAI_API_KEY") or os.getenv("OPENAI_API_KEY")
            _dbg(submission_id, f"keys present | openai={bool(openai_key)}")

            # 3. Single source of truth: ACTR analyze API → body-language report + transcript.
            _emit(sio, sub, "video_job_progress", {"stage": "analyzing", "job_id": job_id})
            _dbg(submission_id, "sending video to ACTR analyze API…")
            result = analyze_video_actrlab(analyze_source)
            _dbg(submission_id, f"ACTR analyze DONE | available={result.get('available')} | report_chars={len(result.get('report') or '')}")
            if not result.get("available"):
                raise RuntimeError(f"ACTR analyze API failed: {result.get('error')}")

            modalities = []
            if result.get("report"):
                modalities.append("body_language")
            if result.get("transcript_text"):
                modalities.append("transcript")

            # 4. Merge → raw collected data (decoupled from scoring).
            _emit(sio, sub, "video_job_progress", {"stage": "saving", "job_id": job_id})
            collected_doc = {
                "submission_id": submission_id,
                "config_id": sub.get("config_id"),
                "schema_version": 2,
                "duration_sec": result.get("duration_sec") or 0.0,
                "modalities_present": modalities,
                "report": result.get("report") or "",
                "transcript": result.get("transcript") or {},
                "created_at": time.time(),
            }
            cdata = db["video_collected_data"]
            cdata.replace_one({"submission_id": submission_id}, collected_doc, upsert=True)
            collected_doc = cdata.find_one({"submission_id": submission_id})
            subs.update_one({"_id": sub["_id"]}, {"$set": {"status": "collected", "updated_at": time.time()}})
            _dbg(submission_id, f"collected data SAVED | modalities={modalities}")
            logger.info("[PIPELINE] collected | %s | modalities=%s", tag, modalities)

            # 5. Score (separate layer; reads config's scoring_spec).
            _emit(sio, sub, "video_job_progress", {"stage": "scoring", "job_id": job_id})
            _dbg(submission_id, "scoring…")
            logger.info("[PIPELINE] scoring | %s", tag)
            scoring_spec = _resolve_scoring_spec(db, sub)
            score_doc = score_submission(sub, collected_doc, scoring_spec, openai_key)
            db["video_scores"].replace_one({"submission_id": submission_id}, score_doc, upsert=True)
            _dbg(submission_id, f"scores SAVED | overall={score_doc.get('overall') if isinstance(score_doc, dict) else '??'}")

            subs.update_one({"_id": sub["_id"]}, {"$set": {"status": "scored", "updated_at": time.time()}})
            jobs.update_one({"_id": ObjectId(job_id)}, {"$set": {"status": "done", "updated_at": time.time()}})

            # 6. Anonymous → mint token + email the link.
            if sub.get("is_anonymous") and sub.get("submitter_email"):
                _issue_token_and_email(db, sub)

            _emit(sio, sub, "video_job_done", {"status": "done", "job_id": job_id})
            logger.info("[PIPELINE] DONE | %s | status=scored | overall=%.1f", tag, score_doc.get("overall", 0))
            _dbg(submission_id, f"PIPELINE COMPLETE (status=scored) | {_name} <{_email}>")

        except Exception as e:
            logger.error("[PIPELINE] FAILED | %s | err=%s", tag, e, exc_info=True)
            _dbg(submission_id, f"PIPELINE FAILED | {_name} <{_email}> | {type(e).__name__}: {e}")
            subs.update_one({"_id": sub["_id"]}, {"$set": {"status": "failed", "error": str(e), "updated_at": time.time()}})
            jobs.update_one({"_id": ObjectId(job_id)}, {"$set": {"status": "failed", "error": str(e), "updated_at": time.time()}})
            _emit(sio, sub, "video_job_done", {"status": "failed", "error": str(e), "job_id": job_id})
        finally:
            _safe_unlink(tmp_video)
            _safe_unlink(tmp_processed)


def _resolve_scoring_spec(db, sub):
    """Always start from the preset as base, then overlay any prof customisations.
    This ensures fields added to presets (content_checks, target_duration_sec, etc.)
    are never missing just because the config's stored spec predates them."""
    spec = registry.get_default_spec(sub.get("assignment_type") or "")
    config = db["config_collections"].find_one({"_id": ObjectId(sub["config_id"])}) if sub.get("config_id") else None
    if config and isinstance(config.get("scoring_spec"), dict):
        stored = config["scoring_spec"]
        if stored.get("submetric_weights"):
            spec["submetric_weights"] = stored["submetric_weights"]
        if stored.get("composite_weights"):
            spec["composite_weights"] = stored["composite_weights"]
        if stored.get("feedback_prompt_template"):
            spec["feedback_prompt_template"] = stored["feedback_prompt_template"]
        if stored.get("dimensions"):
            spec["dimensions"] = stored["dimensions"]
        if stored.get("content_checks"):
            spec["content_checks"] = stored["content_checks"]
        if stored.get("target_duration_sec"):
            spec["target_duration_sec"] = stored["target_duration_sec"]
    return spec


def _issue_token_and_email(db, sub):
    from flask import current_app
    from src.video.notify import send_video_results_email
    token = secrets.token_urlsafe(32)
    db["video_result_tokens"].insert_one({
        "token": token,
        "submission_id": str(sub["_id"]),
        "email": sub.get("submitter_email"),
        "created_at": datetime.utcnow(),
        "expires_at": datetime.utcnow() + timedelta(days=RESULT_TOKEN_TTL_DAYS),
        "used_at": None,
    })
    frontend_url = current_app.config.get("FRONTEND_URL", "https://app.bitterlylab.com")
    url = f"{frontend_url}/video-results/{sub['_id']}?token={token}"
    try:
        send_video_results_email(sub.get("submitter_email"), sub.get("submitter_name"), url)
    except Exception as e:
        logger.error("Failed to email results link for submission %s: %s", sub["_id"], e)
