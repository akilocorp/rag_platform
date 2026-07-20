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
# Cap simultaneous heavy jobs so uploads can't exhaust the threading-mode server.
_MAX_CONCURRENT = int(os.getenv("VIDEO_MAX_CONCURRENT", "2"))
_semaphore = threading.Semaphore(_MAX_CONCURRENT)
RESULT_TOKEN_TTL_DAYS = 30
# Bound the ffmpeg subprocesses — a slow/hung encode must never block the worker
# forever. Transcode timeout is non-fatal (caller falls back to the original).
_TRANSCODE_TIMEOUT = int(os.getenv("VIDEO_TRANSCODE_TIMEOUT", "240"))


def dispatch_pipeline(app, submission_id: str, job_id: str):
    """Start the worker thread. Returns immediately."""
    _dbg(submission_id, f"dispatch_pipeline called | job_id={job_id}")
    threading.Thread(
        target=_run_video_pipeline,
        kwargs={"app": app, "submission_id": submission_id, "job_id": job_id},
        daemon=True,
    ).start()


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

        _dbg(submission_id, f"acquiring semaphore (max_concurrent={_MAX_CONCURRENT})… | {_name} <{_email}>")
        acquired = _semaphore.acquire(timeout=600)
        _dbg(submission_id, f"semaphore acquired={acquired}")
        tmp_video = None
        tmp_processed = None
        try:
            if not acquired:
                raise RuntimeError("Video worker pool busy — timed out waiting for a slot")

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
            if acquired:
                _semaphore.release()
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
