"""Video-upload analysis HTTP API.

Reuses existing platform patterns: optional-JWT identity resolution (audio.py),
S3 helpers (s3_client.py), Mongo job store (user_files upload_jobs), and the
two-view dashboard shape (analysis_routes.py). The heavy lifting lives in
src/video/pipeline.py (collection) and src/video/scoring.py (scoring).
"""
import json
import logging
import os
import re
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

from bson import ObjectId
from bson.errors import InvalidId
from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, verify_jwt_in_request
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import HumanMessage
from werkzeug.utils import secure_filename

from src.utils.s3_client import (
    generate_presigned_put_url,
    generate_download_url,
    object_exists,
    get_s3_client,
    get_bucket,
)
from src.video.pipeline import dispatch_pipeline
from src.video.rubrics import registry
from src.video.scoring import score_submission

logger = logging.getLogger(__name__)
video_bp = Blueprint('video_routes', __name__)

ALLOWED_VIDEO_EXT = {'mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv'}
MAX_VIDEO_BYTES = int(os.getenv("MAX_VIDEO_BYTES", str(1024 * 1024 * 1024)))  # 1 GB
MAX_SUBMISSIONS_PER_STUDENT = 5


def _resolve_user_id():
    try:
        verify_jwt_in_request(optional=True)
        return get_jwt_identity()
    except Exception:
        return None


def _ext_ok(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_VIDEO_EXT


def _get_config(config_id):
    try:
        return current_app.config['MONGO_DB']['config_collections'].find_one({'_id': ObjectId(config_id)})
    except (InvalidId, Exception):
        return None


def _require_config_owner(config_id):
    """Returns (config, error_response). error_response is None when authorized."""
    user_id = _resolve_user_id()
    if not user_id:
        return None, (jsonify({"error": "Authentication required"}), 401)
    config = _get_config(config_id)
    if not config:
        return None, (jsonify({"error": "Config not found"}), 404)
    if str(config.get('user_id', '')) != user_id:
        return None, (jsonify({"error": "Forbidden"}), 403)
    return config, None


def _user_email(user_id):
    if not user_id:
        return None
    try:
        u = current_app.config['MONGO_COLLECTION'].find_one({'_id': ObjectId(user_id)})
        return (u or {}).get('email')
    except Exception:
        return None


# ---------------------------------------------------------------------------
# Assignment-type presets
# ---------------------------------------------------------------------------

@video_bp.route('/video/assignment-types', methods=['GET'])
def assignment_types():
    return jsonify({"presets": registry.list_presets()})


# ---------------------------------------------------------------------------
# Submission lifecycle
# ---------------------------------------------------------------------------

@video_bp.route('/video/submissions', methods=['POST'])
def create_submission():
    """Create a submission and mint a presigned PUT URL for a direct S3 upload."""
    body = request.get_json(silent=True) or {}
    config_id = (body.get('config_id') or '').strip()
    name = (body.get('name') or '').strip()
    email = (body.get('email') or '').strip().lower()
    filename = secure_filename(body.get('filename') or '')
    content_type = (body.get('content_type') or '').strip() or 'video/mp4'

    if not config_id or not filename:
        return jsonify({"error": "config_id and filename are required"}), 400
    if not _ext_ok(filename):
        return jsonify({"error": f"Unsupported video type. Allowed: {', '.join(sorted(ALLOWED_VIDEO_EXT))}"}), 400

    config = _get_config(config_id)
    if not config:
        return jsonify({"error": "Config not found"}), 404
    if config.get('bot_type') != 'video_analysis':
        return jsonify({"error": "This config is not a video-analysis assignment"}), 400

    user_id = _resolve_user_id()
    # Logged-in: trust the account email over a typed one.
    if user_id:
        acct_email = _user_email(user_id)
        if acct_email:
            email = acct_email.lower()
    if not name or not email:
        return jsonify({"error": "name and email are required"}), 400

    db = current_app.config['MONGO_DB']

    existing_count = db['video_submissions'].count_documents({
        "config_id": config_id,
        "submitter_email": email,
        "upload_status": {"$ne": "upload_failed"},
        "status": {"$ne": "failed"},
    })
    if existing_count >= MAX_SUBMISSIONS_PER_STUDENT:
        return jsonify({
            "error": f"You have reached the maximum of {MAX_SUBMISSIONS_PER_STUDENT} submissions for this assignment.",
            "limit_reached": True,
            "submission_count": existing_count,
        }), 409

    now = time.time()
    doc = {
        "config_id": config_id,
        "assignment_type": config.get('assignment_type'),
        "owner_user_id": user_id,
        "submitter_name": name,
        "submitter_email": email,
        "is_anonymous": user_id is None,
        "storage_key": None,
        "filename": filename,
        "content_type": content_type,
        "upload_status": "awaiting_upload",
        "status": "pending",
        "error": None,
        "created_at": now,
        "updated_at": now,
    }
    sub_id = db['video_submissions'].insert_one(doc).inserted_id

    owner_seg = user_id or "anon"
    storage_key = f"video_uploads/{owner_seg}/{sub_id}/{filename}"
    db['video_submissions'].update_one({"_id": sub_id}, {"$set": {"storage_key": storage_key}})

    try:
        upload_url = generate_presigned_put_url(storage_key, content_type)
    except Exception as e:
        logger.error("Presign failed: %s", e, exc_info=True)
        db['video_submissions'].delete_one({"_id": sub_id})
        return jsonify({"error": "Could not prepare upload"}), 502

    return jsonify({
        "submission_id": str(sub_id),
        "upload_url": upload_url,
        "storage_key": storage_key,
        "content_type": content_type,
    }), 201


@video_bp.route('/video/submissions/<sub_id>/uploaded', methods=['POST'])
def confirm_upload(sub_id):
    """Confirm the S3 object landed, enforce size, then dispatch processing."""
    db = current_app.config['MONGO_DB']
    try:
        sub = db['video_submissions'].find_one({"_id": ObjectId(sub_id)})
    except InvalidId:
        return jsonify({"error": "Invalid submission id"}), 400
    if not sub:
        return jsonify({"error": "Submission not found"}), 404

    storage_key = sub.get("storage_key")
    if not storage_key or not object_exists(storage_key):
        db['video_submissions'].update_one({"_id": sub["_id"]}, {"$set": {"upload_status": "upload_failed"}})
        return jsonify({"error": "Upload not found in storage"}), 400

    # Size enforcement (direct uploads bypass Flask's MAX_CONTENT_LENGTH).
    try:
        head = get_s3_client().head_object(Bucket=get_bucket(), Key=storage_key)
        if head.get("ContentLength", 0) > MAX_VIDEO_BYTES:
            get_s3_client().delete_object(Bucket=get_bucket(), Key=storage_key)
            db['video_submissions'].update_one({"_id": sub["_id"]},
                                               {"$set": {"upload_status": "upload_failed",
                                                         "status": "failed",
                                                         "error": "Video exceeds size limit"}})
            return jsonify({"error": "Video exceeds size limit"}), 413
    except Exception:
        pass

    now = time.time()
    db['video_submissions'].update_one({"_id": sub["_id"]},
                                       {"$set": {"upload_status": "uploaded", "status": "pending", "updated_at": now}})
    job_id = db['video_jobs'].insert_one({
        "submission_id": sub_id,
        "config_id": sub.get("config_id"),
        "status": "pending",
        "error": None,
        "created_at": now,
        "updated_at": now,
    }).inserted_id

    dispatch_pipeline(current_app._get_current_object(), sub_id, str(job_id))
    return jsonify({"job_id": str(job_id), "status": "processing"}), 202


@video_bp.route('/video/submissions/<sub_id>/status', methods=['GET'])
def submission_status(sub_id):
    """Polling fallback for the upload page."""
    db = current_app.config['MONGO_DB']
    try:
        sub = db['video_submissions'].find_one({"_id": ObjectId(sub_id)})
    except InvalidId:
        return jsonify({"error": "Invalid submission id"}), 400
    if not sub:
        return jsonify({"error": "Submission not found"}), 404
    return jsonify({
        "submission_id": sub_id,
        "status": sub.get("status"),
        "upload_status": sub.get("upload_status"),
        "error": sub.get("error"),
    })


# ---------------------------------------------------------------------------
# Results (student personal / token / prof)
# ---------------------------------------------------------------------------

def _can_view_results(sub, token):
    """owner OR config-owner (prof) OR same-email account OR valid token."""
    db = current_app.config['MONGO_DB']
    user_id = _resolve_user_id()
    if user_id:
        if sub.get("owner_user_id") == user_id:
            return True
        config = _get_config(sub.get("config_id"))
        if config and str(config.get("user_id", "")) == user_id:
            return True
        acct_email = _user_email(user_id)
        if acct_email and acct_email.lower() == (sub.get("submitter_email") or ""):
            return True
    if token:
        rec = db['video_result_tokens'].find_one({"token": token, "submission_id": str(sub["_id"])})
        if rec:
            from datetime import datetime
            exp = rec.get("expires_at")
            if not exp or exp > datetime.utcnow():
                return True
    return False


@video_bp.route('/video/submissions/<sub_id>/results', methods=['GET'])
def get_results(sub_id):
    db = current_app.config['MONGO_DB']
    try:
        sub = db['video_submissions'].find_one({"_id": ObjectId(sub_id)})
    except InvalidId:
        return jsonify({"error": "Invalid submission id"}), 400
    if not sub:
        return jsonify({"error": "Submission not found"}), 404

    token = request.args.get("token")
    if not _can_view_results(sub, token):
        return jsonify({"error": "Forbidden"}), 403

    scores = db['video_scores'].find_one({"submission_id": sub_id}, {"_id": 0})
    collected = db['video_collected_data'].find_one(
        {"submission_id": sub_id},
        {"_id": 0, "transcript": 1, "duration_sec": 1, "modalities_present": 1},
    )
    return jsonify({
        "submission": {
            "id": sub_id,
            "config_id": sub.get("config_id"),
            "name": sub.get("submitter_name"),
            "email": sub.get("submitter_email"),
            "status": sub.get("status"),
            "error": sub.get("error"),
            "assignment_type": sub.get("assignment_type"),
            "created_at": sub.get("created_at"),
        },
        "scores": scores,
        "transcript": (collected or {}).get("transcript"),
        "duration_sec": (collected or {}).get("duration_sec"),
        "modalities_present": (collected or {}).get("modalities_present", []),
    })


@video_bp.route('/video/config/<config_id>/student-history', methods=['GET'])
def student_history(config_id):
    """A student's past submissions for this config, identified by email."""
    email = (request.args.get('email') or '').strip().lower()
    if not email:
        return jsonify({"error": "email is required"}), 400
    config = _get_config(config_id)
    if not config:
        return jsonify({"error": "Config not found"}), 404
    db = current_app.config['MONGO_DB']
    subs = list(db['video_submissions'].find(
        {"config_id": config_id, "submitter_email": email,
         "upload_status": {"$ne": "upload_failed"}, "status": {"$ne": "failed"}},
        {"_id": 1, "status": 1, "upload_status": 1, "created_at": 1},
    ).sort("created_at", 1))
    out = []
    for i, s in enumerate(subs):
        sub_id = str(s["_id"])
        score_doc = db['video_scores'].find_one(
            {"submission_id": sub_id},
            {"_id": 0, "overall": 1, "llm_overall": 1, "scores": 1},
        )
        overall = None
        composite_scores = None
        if score_doc:
            overall = score_doc.get("llm_overall") if score_doc.get("llm_overall") is not None else score_doc.get("overall")
            raw = score_doc.get("scores") or {}
            composite_scores = {
                k: (raw[k].get("value") if isinstance(raw.get(k), dict) else None)
                for k in ("confidence", "competence", "passion")
            }
        out.append({
            "submission_id": sub_id,
            "attempt_number": i + 1,
            "status": s.get("status"),
            "upload_status": s.get("upload_status"),
            "created_at": s.get("created_at"),
            "overall": overall,
            "composite_scores": composite_scores,
        })
    return jsonify({
        "submissions": out,
        "count": len(out),
        "limit": MAX_SUBMISSIONS_PER_STUDENT,
        "can_submit": len(out) < MAX_SUBMISSIONS_PER_STUDENT,
    })


@video_bp.route('/video/submissions/<sub_id>/video-url', methods=['GET'])
def video_url(sub_id):
    """Presigned GET URL for inline playback. Same access rules as results
    (owner / prof / same-email account / valid token)."""
    db = current_app.config['MONGO_DB']
    try:
        sub = db['video_submissions'].find_one({"_id": ObjectId(sub_id)})
    except InvalidId:
        return jsonify({"error": "Invalid submission id"}), 400
    if not sub:
        return jsonify({"error": "Submission not found"}), 404
    if not _can_view_results(sub, request.args.get("token")):
        return jsonify({"error": "Forbidden"}), 403
    key = sub.get("processed_key") or sub.get("storage_key")
    if not key:
        return jsonify({"error": "No video on file"}), 404
    # No `filename` → no attachment disposition → plays inline in a <video> tag.
    return jsonify({"url": generate_download_url(key, expires_in=3600)})


@video_bp.route('/video/submissions/<sub_id>/rescore', methods=['POST'])
def rescore(sub_id):
    """Re-run scoring ONLY (reads existing collected data). Prof-gated."""
    db = current_app.config['MONGO_DB']
    try:
        sub = db['video_submissions'].find_one({"_id": ObjectId(sub_id)})
    except InvalidId:
        return jsonify({"error": "Invalid submission id"}), 400
    if not sub:
        return jsonify({"error": "Submission not found"}), 404

    _config, err = _require_config_owner(sub.get("config_id"))
    if err:
        return err

    collected = db['video_collected_data'].find_one({"submission_id": sub_id})
    if not collected:
        return jsonify({"error": "No collected data to score yet"}), 400

    spec = registry.get_default_spec(sub.get("assignment_type") or "")
    if isinstance(_config.get("scoring_spec"), dict):
        stored = _config["scoring_spec"]
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
    scoring_spec = spec
    openai_key = current_app.config.get("OPENAI_API_KEY") or os.getenv("OPENAI_API_KEY")
    score_doc = score_submission(sub, collected, scoring_spec, openai_key)
    db['video_scores'].replace_one({"submission_id": sub_id}, score_doc, upsert=True)
    db['video_submissions'].update_one({"_id": sub["_id"]}, {"$set": {"status": "scored", "updated_at": time.time()}})
    score_doc.pop("_id", None)
    return jsonify({"ok": True, "scores": score_doc})


# ---------------------------------------------------------------------------
# Professor dashboard
# ---------------------------------------------------------------------------

@video_bp.route('/video/config/<config_id>/submissions', methods=['GET'])
def list_submissions(config_id):
    config, err = _require_config_owner(config_id)
    if err:
        return err
    db = current_app.config['MONGO_DB']
    subs = list(db['video_submissions'].find({"config_id": config_id}).sort("created_at", -1))
    out = []
    for s in subs:
        score = db['video_scores'].find_one({"submission_id": str(s["_id"])},
                                            {"_id": 0, "scores": 1, "overall": 1})
        out.append({
            "id": str(s["_id"]),
            "name": s.get("submitter_name"),
            "email": s.get("submitter_email"),
            "status": s.get("status"),
            "created_at": s.get("created_at"),
            "overall": (score or {}).get("overall"),
            "scores": (score or {}).get("scores"),
        })
    return jsonify({"submissions": out})


@video_bp.route('/video/config/<config_id>/dashboard', methods=['GET'])
def dashboard(config_id):
    config, err = _require_config_owner(config_id)
    if err:
        return err
    db = current_app.config['MONGO_DB']
    scores = list(db['video_scores'].find({"config_id": config_id}))

    dims = ("confidence", "competence", "passion")
    buckets = {d: {"excellent": 0, "strong": 0, "developing": 0, "weak": 0} for d in dims}
    sums = {d: [] for d in dims}
    weakness_tally = {}

    for s in scores:
        sc = s.get("scores") or {}
        lowest = None
        for d in dims:
            v = (sc.get(d) or {}).get("value")
            if v is None:
                continue
            sums[d].append(v)
            if v >= 80:
                buckets[d]["excellent"] += 1
            elif v >= 65:
                buckets[d]["strong"] += 1
            elif v >= 50:
                buckets[d]["developing"] += 1
            else:
                buckets[d]["weak"] += 1
            if lowest is None or v < lowest[1]:
                lowest = (d, v)
        if lowest:
            weakness_tally[lowest[0]] = weakness_tally.get(lowest[0], 0) + 1

    averages = {d: (round(sum(sums[d]) / len(sums[d]), 1) if sums[d] else None) for d in dims}
    overall_vals = [s.get("overall") for s in scores if s.get("overall") is not None]

    # ---- Class-level analytics (Yoodli-style, aggregated) ----
    tone_counts = {}
    metric_issues = {}   # label -> weighted count (bad=2, warn=1)
    word_freq = {}       # weak/filler word -> students using it
    filler_pcts, wpms, weak_pcts = [], [], []

    # (category, metric_key, friendly label) — the metrics we surface as common growth areas
    ISSUE_METRICS = [
        ("word_choice", "filler_words", "Filler words"),
        ("word_choice", "weak_words", "Weak words"),
        ("word_choice", "hedging", "Hedging"),
        ("word_choice", "sentence_starters", "Repetitive openers"),
        ("delivery", "pace", "Pacing"),
        ("delivery", "pauses", "Long pauses"),
        ("delivery", "pitch_variation", "Monotone delivery"),
        ("delivery", "energy", "Low energy"),
        ("presence", "facial_expressivity", "Flat expression"),
        ("presence", "composure", "Composure"),
    ]

    for s in scores:
        an = s.get("analytics") or {}
        for t in (s.get("tone_tags") or []):
            if t.get("active"):
                tone_counts[t["label"]] = tone_counts.get(t["label"], 0) + 1
        wc = an.get("word_choice") or {}
        dl = an.get("delivery") or {}
        if wc.get("filler_words", {}).get("pct") is not None:
            filler_pcts.append(wc["filler_words"]["pct"])
        if wc.get("weak_words", {}).get("pct") is not None:
            weak_pcts.append(wc["weak_words"]["pct"])
        if dl.get("pace", {}).get("wpm"):
            wpms.append(dl["pace"]["wpm"])
        for cat, key, label in ISSUE_METRICS:
            st = ((an.get(cat) or {}).get(key) or {}).get("status")
            if st == "bad":
                metric_issues[label] = metric_issues.get(label, 0) + 2
            elif st == "warn":
                metric_issues[label] = metric_issues.get(label, 0) + 1
        seen = set()
        for inst in (wc.get("weak_words", {}).get("instances", []) + wc.get("filler_words", {}).get("instances", [])):
            w = inst.get("word")
            if w and w not in seen:
                seen.add(w)
                word_freq[w] = word_freq.get(w, 0) + 1

    def _avg(xs):
        return round(sum(xs) / len(xs), 1) if xs else None

    top_growth = sorted(metric_issues.items(), key=lambda kv: -kv[1])[:5]
    top_words = sorted(word_freq.items(), key=lambda kv: -kv[1])[:8]
    tone_dist = sorted(tone_counts.items(), key=lambda kv: -kv[1])

    # ---- Key component averages (from content_checks on each score doc) ----
    COMPONENT_IDS = ["gambit", "pain", "solution", "customer", "competition", "deal", "team", "summary_sentence"]
    comp_sums = {cid: [] for cid in COMPONENT_IDS}
    for s in scores:
        for chk in (s.get("content_checks") or []):
            cid = chk.get("id")
            v = chk.get("score")
            if cid in comp_sums and v is not None:
                comp_sums[cid].append(v)
    component_averages = {
        cid: (round(sum(vals) / len(vals), 1) if vals else None)
        for cid, vals in comp_sums.items()
    }

    # ---- PCCP eval averages (LLM-graded delivery) ----
    pccp_sums = {"competence": [], "confidence": [], "passion": []}
    for s in scores:
        for dim, d in (s.get("pccp_eval") or {}).items():
            v = d.get("score") if isinstance(d, dict) else None
            if dim in pccp_sums and v is not None:
                pccp_sums[dim].append(v)
    pccp_averages = {
        dim: (round(sum(vals) / len(vals), 1) if vals else None)
        for dim, vals in pccp_sums.items()
    }

    return jsonify({
        "total_submissions": len(scores),
        "avg_overall": round(sum(overall_vals) / len(overall_vals), 1) if overall_vals else None,
        "averages": averages,
        "pccp_averages": pccp_averages,
        "distributions": buckets,
        "common_weakness_dimension": (max(weakness_tally, key=weakness_tally.get) if weakness_tally else None),
        "weakness_tally": weakness_tally,
        "component_averages": component_averages,
        "class_analytics": {
            "avg_filler_pct": _avg(filler_pcts),
            "avg_weak_pct": _avg(weak_pcts),
            "avg_wpm": _avg(wpms),
            "tone_distribution": [{"label": k, "count": v} for k, v in tone_dist],
            "common_growth_areas": [{"label": k, "weight": v} for k, v in top_growth],
            "common_words": [{"word": k, "students": v} for k, v in top_words],
        },
    })


# ---------------------------------------------------------------------------
# Professor-defined AI analysis (prompt-based grading)
# ---------------------------------------------------------------------------

_va_jobs = {}  # job_id -> {status, progress, result, error}
_MAX_TRANSCRIPT_WORDS = 500


def _parse_json_va(text):
    text = text.strip()
    for pattern in (r'\[.*\]', r'\{.*\}'):
        m = re.search(pattern, text, re.DOTALL)
        if m:
            try:
                return json.loads(m.group())
            except Exception:
                pass
    return json.loads(text)


def _llm_va(api_key, prompt, max_tokens=500):
    llm = ChatAnthropic(model='claude-sonnet-4-6', api_key=api_key, max_tokens=max_tokens)
    return llm.invoke([HumanMessage(content=prompt)]).content


def _transcript_text(transcript):
    if not transcript:
        return ''
    if isinstance(transcript, dict):
        return transcript.get('text', '') or ''
    if isinstance(transcript, list):
        return ' '.join((w.get('word', '') if isinstance(w, dict) else str(w)) for w in transcript)
    return str(transcript)


def _run_video_analysis(job_id, config_id, api_key, grading_prompt, db_client, db_name):
    try:
        db = db_client[db_name]
        _va_jobs[job_id]['progress'] = 'Loading submissions…'

        subs = list(db['video_submissions'].find(
            {'config_id': config_id, 'status': 'scored'},
            {'_id': 1, 'submitter_name': 1, 'submitter_email': 1},
        ))
        if not subs:
            _va_jobs[job_id].update({'status': 'error', 'error': 'No scored submissions found for this config.'})
            return

        _va_jobs[job_id]['progress'] = f'Loading transcripts (0/{len(subs)})…'

        students = []
        for s in subs:
            sub_id = str(s['_id'])
            collected = db['video_collected_data'].find_one({'submission_id': sub_id}, {'transcript': 1})
            raw = _transcript_text((collected or {}).get('transcript'))
            words = raw.split()
            if len(words) > _MAX_TRANSCRIPT_WORDS:
                raw = ' '.join(words[:_MAX_TRANSCRIPT_WORDS]) + ' [truncated]'
            students.append({
                'submission_id': sub_id,
                'name': s.get('submitter_name') or 'Anonymous',
                'email': s.get('submitter_email') or '',
                'transcript': raw,
            })

        _va_jobs[job_id]['progress'] = f'Grading {len(students)} submissions…'

        def _grade_one(s):
            text = s['transcript'] or '[no transcript available]'
            prompt = f"""You are grading a student video presentation.

Grading criteria from professor:
{grading_prompt.strip()}

Student: {s['name']}
Video transcript:
{text}

Return a JSON object:
{{"score": <0-100>, "summary": "<2-3 sentences>", "strengths": ["..."], "improvements": ["..."]}}

Return ONLY the JSON object."""
            try:
                raw = _llm_va(api_key, prompt, max_tokens=400)
                r = _parse_json_va(raw)
                r.setdefault('score', 0)
                r.setdefault('summary', '')
                r.setdefault('strengths', [])
                r.setdefault('improvements', [])
            except Exception as e:
                logger.error('Video grade failed for %s: %s', s['submission_id'], e)
                r = {'score': 0, 'summary': 'Analysis failed.', 'strengths': [], 'improvements': []}
            return {**s, **r}

        analyses = []
        with ThreadPoolExecutor(max_workers=10) as ex:
            for r in ex.map(_grade_one, students):
                analyses.append(r)

        _va_jobs[job_id]['progress'] = 'Generating class summary…'
        scored = [a for a in analyses if a.get('score', 0) > 0]
        avg_score = round(sum(a['score'] for a in scored) / len(scored)) if scored else 0

        cs = {'overall_insight': 'No scored submissions to summarize.', 'common_strengths': [], 'common_weaknesses': []}
        if scored:
            lines = '\n'.join(f'- Score {a["score"]}/100: {a["summary"]}' for a in scored)
            summary_prompt = f"""Summarize class-wide video presentation performance for a professor.

Grading criteria used:
{grading_prompt.strip()}

Individual results:
{lines}

Return JSON: {{"overall_insight": "<3-4 sentences>", "common_strengths": ["<pattern>"], "common_weaknesses": ["<gap>"]}}
Return only the JSON."""
            try:
                cs = _parse_json_va(_llm_va(api_key, summary_prompt, max_tokens=600))
            except Exception as e:
                logger.error('Video class summary failed: %s', e)

        analyses.sort(key=lambda a: a.get('score', 0), reverse=True)

        result = {
            'class_summary': {
                'avg_score': avg_score,
                'total_submissions': len(analyses),
                'overall_insight': cs.get('overall_insight', ''),
                'common_strengths': cs.get('common_strengths', []),
                'common_weaknesses': cs.get('common_weaknesses', []),
            },
            'students': analyses,
        }

        try:
            db['video_analysis_results'].insert_one({
                'config_id': config_id,
                'grading_prompt': grading_prompt,
                'analyzed_at': time.time(),
                **result,
            })
        except Exception as e:
            logger.error('Failed to persist video analysis: %s', e)

        _va_jobs[job_id].update({'status': 'done', 'progress': 'Done', 'result': result})

    except Exception as e:
        import traceback
        logger.error('Video analysis job fatal: %s', traceback.format_exc())
        _va_jobs[job_id].update({'status': 'error', 'error': f'{type(e).__name__}: {str(e)}'})


@video_bp.route('/video/config/<config_id>/ai-analyze', methods=['POST'])
def start_video_analysis(config_id):
    config, err = _require_config_owner(config_id)
    if err:
        return err
    grading_prompt = (request.get_json(silent=True) or {}).get('grading_prompt', '').strip()
    if not grading_prompt:
        return jsonify({'error': 'grading_prompt is required'}), 400
    api_key = current_app.config.get('ANTHROPIC_API_KEY') or os.getenv('ANTHROPIC_API_KEY')
    db = current_app.config['MONGO_DB']
    job_id = str(uuid.uuid4())
    _va_jobs[job_id] = {'status': 'running', 'progress': 'Starting…', 'result': None, 'error': None}
    threading.Thread(
        target=_run_video_analysis,
        args=(job_id, config_id, api_key, grading_prompt, db.client, db.name),
        daemon=True,
    ).start()
    return jsonify({'job_id': job_id})


@video_bp.route('/video/config/<config_id>/ai-analyze/<job_id>', methods=['GET'])
def video_analysis_status(config_id, job_id):
    _, err = _require_config_owner(config_id)
    if err:
        return err
    job = _va_jobs.get(job_id)
    if not job:
        return jsonify({'error': 'Job not found'}), 404
    return jsonify(job)


@video_bp.route('/video/config/<config_id>/ai-analyses', methods=['GET'])
def list_video_analyses(config_id):
    _, err = _require_config_owner(config_id)
    if err:
        return err
    db = current_app.config['MONGO_DB']
    docs = list(db['video_analysis_results'].find(
        {'config_id': config_id}, {'students': 0},
    ).sort('analyzed_at', -1))
    for d in docs:
        d['_id'] = str(d['_id'])
        d['avg_score'] = (d.get('class_summary') or {}).get('avg_score')
    return jsonify({'analyses': docs})


@video_bp.route('/video/config/<config_id>/ai-analyses/<analysis_id>', methods=['GET'])
def get_video_analysis(config_id, analysis_id):
    _, err = _require_config_owner(config_id)
    if err:
        return err
    db = current_app.config['MONGO_DB']
    try:
        doc = db['video_analysis_results'].find_one({'_id': ObjectId(analysis_id), 'config_id': config_id})
    except Exception:
        return jsonify({'error': 'Invalid ID'}), 400
    if not doc:
        return jsonify({'error': 'Not found'}), 404
    doc['_id'] = str(doc['_id'])
    return jsonify(doc)
