# @language  Python
# @updated   2026-08-12
# @changed   New file: the syllabus advisor's HTTP surface — upload or paste a syllabus, get a
#            per-session plan back, ask follow-ups, with the logged-out preview gate enforced here.
"""HTTP for the syllabus advisor.

Three endpoints:
  POST /api/advisor/syllabus  — a file or pasted text in, a per-session plan out
  POST /api/advisor/refine    — one follow-up question against a plan
  GET  /api/advisor/catalog   — the feature catalog, for rendering the UI

Deliberately reachable logged out: the audience is a professor watching a demo
who does not have an account yet, and asking them to register before they see
anything defeats the point. What they get is capped instead — the parsed session
list plus the two strongest recommendations, with the rest as a count.

That cap is enforced HERE, before serialization, not in the browser. A frontend
that fetches ten recommendations and renders two has not gated anything; it has
published all ten to anyone who opens the network tab.
"""
import os
import tempfile
from datetime import datetime, timezone

from flask import Blueprint, request, jsonify, current_app
from flask_jwt_extended import verify_jwt_in_request, get_jwt_identity
from werkzeug.utils import secure_filename

from src.advisor import catalog
from src.advisor import syllabus as advisor
from src.usage.limits import client_ip

advisor_bp = Blueprint('advisor_routes', __name__)

# Matches the syllabus formats a professor actually has on disk. Kept local
# rather than imported from the upload routes: those lists are about what the
# vector store can ingest, and the two should be free to drift apart.
ALLOWED_EXTENSIONS = {'pdf', 'docx', 'txt', 'md', 'pptx'}

# A syllabus is a handful of pages. Anything larger is a course pack uploaded by
# mistake, and reading it would cost a minute for a worse answer.
MAX_UPLOAD_BYTES = 10 * 1024 * 1024

# How many recommendations a logged-out visitor sees in full. Two is enough to
# prove the tool read their actual syllabus — which is the only thing the
# preview has to do — while leaving a reason to sign up.
ANON_PREVIEW_LIMIT = 2

# Per-device daily cap on anonymous runs. Each run is two Opus calls, so this is
# a real cost control, not a formality. Generous enough that a professor trying
# two syllabi in a demo never sees it.
ANON_DAILY_RUNS = 3

# Strongest first, so the logged-out preview shows the best two rather than
# whichever weeks happen to come first in the term.
_FIT_ORDER = {"strong": 0, "possible": 1, "none": 2}


@advisor_bp.route('/advisor/catalog', methods=['GET'])
def get_feature_catalog():
    """The feature catalog, for the UI's card headers and guide links.

    Public and static — the frontend should not be hardcoding a second copy of
    what each feature is called or which guide page explains it.
    """
    return jsonify({
        "features": [
            {
                "key": f["key"],
                "label": f["label"],
                "one_line": f["one_line"],
                "guide_page": f["guide_page"],
            }
            for f in catalog.get_catalog()
        ]
    }), 200


@advisor_bp.route('/advisor/syllabus', methods=['POST'])
def analyze_syllabus():
    """Read a syllabus and return a per-session recommendation plan.

    Accepts either a `file` part (multipart) or `{"text": "..."}` (JSON) — many
    professors will paste a schedule out of their LMS faster than they will find
    the PDF, and refusing the paste costs conversions for no reason.

    Returns the full plan to an authenticated professor, and a capped preview to
    everyone else. `report` is included either way: recommendations dropped by
    validation are counted, never silently vanished, because a plan that quietly
    shrinks is how a drifting advisor goes unnoticed.
    """
    user_id = _current_user_id()

    if not user_id and not _consume_anon_run():
        return jsonify({
            "message": "You've used today's free syllabus reviews. Create a free account to keep going.",
            "limit_reached": True,
        }), 429

    text, err = _read_syllabus_text()
    if err:
        return err

    parsed = advisor.extract_sessions(text)
    if parsed is None:
        return jsonify({"message": "Couldn't read that syllabus right now. Please try again."}), 503

    sessions = parsed.get("sessions") or []
    if not sessions:
        return jsonify({
            "message": "No class schedule found in that document. Upload the syllabus page that "
                       "lists the weekly sessions, or paste the schedule directly.",
            "sessions": [],
        }), 422

    course = parsed.get("course") or {}
    raw = advisor.recommend(course, sessions)
    if raw is None:
        return jsonify({"message": "Couldn't analyse that syllabus right now. Please try again."}), 503

    recs, report = advisor.validate(raw, sessions, text, course)
    return jsonify(_plan_payload(course, sessions, recs, report, bool(user_id))), 200


@advisor_bp.route('/advisor/refine', methods=['POST'])
def refine_plan():
    """Answer one follow-up about a plan the client already holds.

    The plan is posted back rather than stored server-side: phase 1 keeps no
    course_plans collection, so the client's copy IS the plan. That makes this
    endpoint stateless and means a refusal or a timeout costs the answer, never
    the plan itself.
    """
    user_id = _current_user_id()
    body = request.get_json(silent=True) or {}
    question = (body.get('question') or '').strip()
    if not question:
        return jsonify({"message": "Ask a question first."}), 400
    if not user_id and not _consume_anon_run():
        return jsonify({
            "message": "You've used today's free questions. Create a free account to keep going.",
            "limit_reached": True,
        }), 429

    sessions = body.get('sessions') or []
    course = body.get('course') or {}
    plan = body.get('recommendations') or []

    answer, revised = advisor.refine(course, sessions, plan, question)
    if answer is None:
        return jsonify({"message": "Couldn't answer that right now. Please try again."}), 503

    # Revisions are re-validated exactly like a first-pass recommendation. A
    # follow-up turn is the easiest place for an ungrounded claim to slip in —
    # the professor has just pushed back, and agreeing is the cheapest reply.
    syllabus_text = "\n\n".join((s.get('verbatim') or '') for s in sessions)
    revised, report = advisor.validate(revised, sessions, syllabus_text, course)

    return jsonify({
        "answer": answer,
        "revised": _visible(revised, bool(user_id)) if revised else [],
        "report": report,
    }), 200


def _plan_payload(course, sessions, recs, report, is_authenticated):
    """Assemble the response, applying the logged-out cap.

    `locked_count` counts real recommendations withheld, so the sign-up prompt
    can state a true number. A "none" verdict is never locked — telling someone
    which weeks we are NOT for costs us nothing and is most of what makes the
    preview credible.
    """
    visible = _visible(recs, is_authenticated)
    actionable = [r for r in recs if r.get('fit') in ('strong', 'possible')]
    shown = [r for r in visible if r.get('fit') in ('strong', 'possible')]
    return {
        "course": course,
        "sessions": sessions,
        "recommendations": visible,
        "locked_count": max(0, len(actionable) - len(shown)),
        "authenticated": is_authenticated,
        "report": report,
    }


def _visible(recs, is_authenticated):
    """The recommendations this caller is allowed to receive.

    Authenticated: everything, in term order. Anonymous: every "none" verdict
    plus the ANON_PREVIEW_LIMIT strongest actionable ones, re-sorted back into
    term order so the plan still reads top-to-bottom like a syllabus.
    """
    if is_authenticated:
        return recs
    actionable = sorted(
        (r for r in recs if r.get('fit') in ('strong', 'possible')),
        key=lambda r: (_FIT_ORDER.get(r.get('fit'), 9), r.get('session_index', 0)),
    )[:ANON_PREVIEW_LIMIT]
    keep_ids = {id(r) for r in actionable}
    return sorted(
        [r for r in recs if r.get('fit') == 'none' or id(r) in keep_ids],
        key=lambda r: r.get('session_index', 0),
    )


def _read_syllabus_text():
    """Pull syllabus text out of the request. Returns `(text, error_response)`.

    A pasted body wins over an uploaded file when both are present — if someone
    typed, they meant the typing. Uploads go through `extract_plaintext`, the
    same loader path the rest of the platform ingests documents with, and fall
    back to Claude OCR when a PDF has no text layer (a scanned syllabus is
    common enough that failing on it would look broken).
    """
    body = request.get_json(silent=True) or {}
    pasted = (body.get('text') or '').strip()
    if pasted:
        if len(pasted) < 80:
            return None, (jsonify({"message": "That's too short to be a syllabus schedule."}), 400)
        return pasted, None

    upload = request.files.get('file')
    if not upload or not upload.filename:
        return None, (jsonify({"message": "Upload a syllabus or paste your schedule."}), 400)

    ext = upload.filename.rsplit('.', 1)[-1].lower() if '.' in upload.filename else ''
    if ext not in ALLOWED_EXTENSIONS:
        return None, (jsonify({
            "message": f"Unsupported file type. Use {', '.join(sorted(ALLOWED_EXTENSIONS))}."
        }), 400)

    # Written to a real temp file because the shared document loaders take a
    # path, not a stream. Removed in `finally` so a loader crash cannot leak it.
    filename = secure_filename(upload.filename)
    tmp_dir = tempfile.mkdtemp(prefix='syllabus_')
    tmp_path = os.path.join(tmp_dir, filename)
    try:
        upload.save(tmp_path)
        if os.path.getsize(tmp_path) > MAX_UPLOAD_BYTES:
            return None, (jsonify({"message": "That file is too large — 10 MB max."}), 400)

        # Imported here rather than at module scope: that module pulls in the whole
        # langchain + embeddings stack, and a pasted-text request should not pay for
        # it. Only an actual file upload reaches this line.
        from src.utils.vector_stores.store_vector_stores import (
            _extract_pdf_text_via_claude,
            extract_plaintext,
        )
        text = extract_plaintext(tmp_path)
        # "" means the loader worked but found no text layer — a scanned PDF.
        # None means the file itself is unreadable, which OCR will not fix.
        if text is not None and not text.strip() and ext == 'pdf':
            text = _extract_pdf_text_via_claude(tmp_path, filename)
        if not (text or '').strip():
            return None, (jsonify({
                "message": "Couldn't read any text out of that file. Try pasting your schedule instead."
            }), 422)
        return text, None
    except Exception as e:
        current_app.logger.error("advisor: syllabus read failed | err=%s", e, exc_info=True)
        return None, (jsonify({"message": "Couldn't read that file."}), 500)
    finally:
        try:
            os.remove(tmp_path)
            os.rmdir(tmp_dir)
        except OSError:
            pass


def _current_user_id():
    """The caller's user id, or None when they are browsing logged out.

    Optional-JWT rather than `@jwt_required`, because an anonymous visitor is
    the expected case here, not an error — same pattern as `/api/history/<id>`.
    """
    try:
        verify_jwt_in_request(optional=True)
        return get_jwt_identity()
    except Exception:
        return None


def _consume_anon_run():
    """Count one anonymous run against today's per-IP budget.

    IP rather than the signed device cookie that `usage.limits` uses: that
    helper hands back a cookie the caller must Set-Cookie on the response, and
    threading that through every early-return branch here would buy accuracy we
    do not need for a cost guard on a demo tool.

    Fails OPEN. If Mongo is unreachable the run proceeds, because a professor
    blocked mid-pitch by our own rate limiter costs more than a few extra model
    calls.
    """
    try:
        db = current_app.config['MONGO_DB']
        key = client_ip(request) or 'unknown'
        day = datetime.now(timezone.utc).strftime('%Y-%m-%d')
        doc = db['advisor_usage'].find_one_and_update(
            {'_id': f'{day}:{key}'},
            {'$inc': {'runs': 1}, '$set': {'updated_at': datetime.now(timezone.utc)}},
            upsert=True,
            return_document=True,
        )
        return int((doc or {}).get('runs', 1)) <= ANON_DAILY_RUNS
    except Exception as e:
        current_app.logger.warning("advisor: anon quota check failed, allowing | err=%s", e)
        return True
