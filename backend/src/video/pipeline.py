"""Video processing pipeline (background worker).

Dispatch mirrors user_files._run_async_pdf_ingest: a daemon thread that runs
inside app_context, reads socketio from current_app.extensions, and emits
progress. Heavy work fans out across a ThreadPoolExecutor so Whisper and Hume
run concurrently (MediaPipe is one more `submit(...)` in phase 2).

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
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

from bson import ObjectId

from src.utils.s3_client import get_s3_client, get_bucket, generate_download_url
from src.video.hume_batch import run_hume_batch
from src.video.assemblyai_words import transcribe_words
from src.video.scoring import score_submission
from src.video.visual_analysis import analyze_video_frames
from src.video.rubrics import registry

logger = logging.getLogger(__name__)

TMP_DIR = "uploads/video_tmp"
# Cap simultaneous heavy jobs so uploads can't exhaust the threading-mode server.
_MAX_CONCURRENT = int(os.getenv("VIDEO_MAX_CONCURRENT", "2"))
_semaphore = threading.Semaphore(_MAX_CONCURRENT)
RESULT_TOKEN_TTL_DAYS = 30


def dispatch_pipeline(app, submission_id: str, job_id: str):
    """Start the worker thread. Returns immediately."""
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


def _extract_audio(video_path: str) -> str:
    """Extract mono 16kHz mp3 — small enough for Whisper's 25MB limit."""
    audio_path = video_path + ".mp3"
    cmd = [_ffmpeg_exe(), "-y", "-i", video_path, "-vn", "-ac", "1", "-ar", "16000",
           "-b:a", "64k", audio_path]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return audio_path


def _transcode_for_web(video_path: str) -> str:
    """Re-encode to H.264/AAC MP4.

    Handles HEVC (iPhone default), MOV container, and portrait rotation metadata
    (ffmpeg applies stored rotation when re-encoding). yuv420p ensures every
    browser can decode the result.
    """
    out = video_path + "_web.mp4"
    cmd = [
        _ffmpeg_exe(), "-y", "-i", video_path,
        "-c:v", "libx264", "-preset", "fast", "-crf", "23",
        "-c:a", "aac", "-b:a", "128k",
        "-movflags", "+faststart",
        "-pix_fmt", "yuv420p",
        out,
    ]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    return out


def _run_video_pipeline(app, submission_id: str, job_id: str):
    with app.app_context():
        from flask import current_app
        db = current_app.config["MONGO_DB"]
        subs = db["video_submissions"]
        jobs = db["video_jobs"]
        sio = current_app.extensions.get("socketio")

        sub = subs.find_one({"_id": ObjectId(submission_id)})
        if not sub:
            logger.error("Pipeline: submission %s not found", submission_id)
            return

        # Human-readable tag for every log line — grep by name or email
        _name  = sub.get("submitter_name") or "unknown"
        _email = sub.get("submitter_email") or ""
        tag = f"sub={submission_id} | {_name} <{_email}>"

        acquired = _semaphore.acquire(timeout=600)
        tmp_video = None
        tmp_audio = None
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
            logger.info("[PIPELINE] downloading | %s", tag)
            get_s3_client().download_file(get_bucket(), storage_key, tmp_video)

            # 2. Transcode to H.264 MP4 (fixes HEVC/MOV phone videos for Hume + browsers).
            _emit(sio, sub, "video_job_progress", {"stage": "extracting_audio", "job_id": job_id})
            try:
                tmp_processed = _transcode_for_web(tmp_video)
                processed_key = re.sub(r'\.[^.]+$', '', storage_key) + "_processed.mp4"
                get_s3_client().upload_file(tmp_processed, get_bucket(), processed_key,
                                            ExtraArgs={"ContentType": "video/mp4"})
                subs.update_one({"_id": sub["_id"]}, {"$set": {"processed_key": processed_key}})
                media_url = generate_download_url(processed_key, expires_in=3600)
                hume_source = tmp_processed
            except Exception as tc_err:
                logger.warning("Transcode failed, falling back to original: %s", tc_err)
                media_url = generate_download_url(storage_key, expires_in=3600)
                hume_source = tmp_video
            tmp_audio = _extract_audio(hume_source)

            openai_key = current_app.config.get("OPENAI_API_KEY") or os.getenv("OPENAI_API_KEY")
            assemblyai_key = current_app.config.get("ASSEMBLYAI_API_KEY") or os.getenv("ASSEMBLYAI_API_KEY")

            # 3. Run modalities in parallel.
            _emit(sio, sub, "video_job_progress", {"stage": "analyzing", "job_id": job_id})
            with ThreadPoolExecutor(max_workers=4) as ex:
                fut_whisper = ex.submit(transcribe_words, tmp_audio, assemblyai_key)
                fut_hume = ex.submit(run_hume_batch, media_url)
                fut_visual = ex.submit(analyze_video_frames, tmp_video)
                transcript = fut_whisper.result()
                hume = fut_hume.result()
                visual = fut_visual.result()

            modalities = ["transcript"]
            prosody = {"frames": []}
            face = {"frames": []}
            if hume:
                prosody = hume.get("prosody", {"frames": []})
                face = hume.get("face", {"frames": []})
                if prosody.get("frames"):
                    modalities.append("prosody")
                if face.get("frames"):
                    modalities.append("face")
            else:
                logger.warning("[PIPELINE] Hume returned no data — scoring on transcript only | %s", tag)

            # 4. Merge → raw collected data (decoupled from scoring).
            _emit(sio, sub, "video_job_progress", {"stage": "saving", "job_id": job_id})
            collected_doc = {
                "submission_id": submission_id,
                "config_id": sub.get("config_id"),
                "schema_version": 1,
                "duration_sec": transcript.get("duration", 0.0),
                "modalities_present": modalities,
                "transcript": transcript,
                "prosody": prosody,
                "face": face,
                "pose": None,
                "visual": visual,
                "raw_refs": {"hume_predictions_key": None},
                "created_at": time.time(),
            }
            cdata = db["video_collected_data"]
            cdata.replace_one({"submission_id": submission_id}, collected_doc, upsert=True)
            collected_doc = cdata.find_one({"submission_id": submission_id})
            subs.update_one({"_id": sub["_id"]}, {"$set": {"status": "collected", "updated_at": time.time()}})
            logger.info("[PIPELINE] collected | %s | modalities=%s", tag, modalities)

            # 5. Score (separate layer; reads config's scoring_spec).
            _emit(sio, sub, "video_job_progress", {"stage": "scoring", "job_id": job_id})
            logger.info("[PIPELINE] scoring | %s", tag)
            scoring_spec = _resolve_scoring_spec(db, sub)
            score_doc = score_submission(sub, collected_doc, scoring_spec, openai_key)
            db["video_scores"].replace_one({"submission_id": submission_id}, score_doc, upsert=True)

            subs.update_one({"_id": sub["_id"]}, {"$set": {"status": "scored", "updated_at": time.time()}})
            jobs.update_one({"_id": ObjectId(job_id)}, {"$set": {"status": "done", "updated_at": time.time()}})

            # 6. Anonymous → mint token + email the link.
            if sub.get("is_anonymous") and sub.get("submitter_email"):
                _issue_token_and_email(db, sub)

            _emit(sio, sub, "video_job_done", {"status": "done", "job_id": job_id})
            logger.info("[PIPELINE] DONE | %s | status=scored | overall=%.1f", tag, score_doc.get("overall", 0))

        except Exception as e:
            logger.error("[PIPELINE] FAILED | %s | err=%s", tag, e, exc_info=True)
            subs.update_one({"_id": sub["_id"]}, {"$set": {"status": "failed", "error": str(e), "updated_at": time.time()}})
            jobs.update_one({"_id": ObjectId(job_id)}, {"$set": {"status": "failed", "error": str(e), "updated_at": time.time()}})
            _emit(sio, sub, "video_job_done", {"status": "failed", "error": str(e), "job_id": job_id})
        finally:
            if acquired:
                _semaphore.release()
            _safe_unlink(tmp_video)
            _safe_unlink(tmp_audio)
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
