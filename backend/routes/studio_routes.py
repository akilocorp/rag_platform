# @language  Python
# @updated   2026-09-13
# @changed   live-summary gained cross-filter query params (filter_block_id/filter_value) — filters
#            the raw response list before handing it to build_live_summary, so every aggregation
#            function stays unchanged. Powers the Present view's click-a-bar-to-filter-everything-else.
# Prior: Added GET /studio/projects/<id>/live-summary — the data source for the new Present
#            view (a Mentimeter-style QR + live-results screen for in-class use). Delegates all
#            aggregation to the new src/studio/summary.py; see that file's header for why it
#            excludes every AI-native and data-quality/compliance instrument by design, not oversight.
# Prior: 3 session-level, Qualtrics-inspired features. Embedded Data: submit_response now
#            accepts+sanitizes a client-supplied `embedded_data` dict (URL params captured at load),
#            stored on the response doc, surfaced as dynamic CSV columns (same discovery pattern as
#            instrument metrics). Counterbalanced conditions: projects gain a `conditions` list
#            (save_project); submit_response round-robin-assigns one via an atomic
#            `$inc`/find_one_and_update on the project doc (deliberately assigned at submit time, not
#            page-load, since there's no respondent-keyed pre-assignment need without a conditional-
#            rendering engine yet — see the Piped Text instrument's own note on that gap). Piping:
#            no route changes — piped_text is a normal instrument, resolved entirely client-side in
#            StudioRunnerPage from already-loaded answers.
# Prior: Phase 2: instruments are now real. Added GET /studio/instrument-specs (feeds the
#            Instruments ribbon tab); _sanitize_pages validates each block's `instruments` against
#            the registry instead of force-emptying it; the public submit endpoint accepts a
#            per-answer `events` array (frontend-captured performance.now() timestamps); and
#            list_responses/export_responses_csv now compute + attach instrument metrics (e.g. the
#            Reaction Timer's latency_ms) via _augment_responses_with_metrics.
#            Prior: Phase 1: published projects are now readable/submittable anonymously, and owners
#            can read back what came in. Added GET /studio/public/projects/<id> (published-only,
#            strips user_id), POST /studio/public/projects/<id>/responses (creates a
#            studio_responses doc, enforces `required` blocks, rate-limited per IP+project via a
#            TTL-indexed collection — no new dependency, mirrors the lazy create_index-once pattern
#            in src/models/manager_exercise_session.py), GET .../responses (owner, raw list), and
#            GET .../responses.csv (owner, flattened export).
#            Prior: New file: Studio Phase 0 CRUD — create/list/get/save/delete a project, plus the
#            block-spec catalog that feeds the builder's ribbon.
"""
HTTP for Studio projects — the drag-and-drop research-instrument builder.

Owner-scoped (faculty, JWT-required):
  GET    /api/studio/block-specs             — the Blocks ribbon tab's catalog
  GET    /api/studio/instrument-specs        — the Instruments ribbon tab's catalog
  POST   /api/studio/projects                — create a new project (one blank page)
  GET    /api/studio/projects                — list the caller's own projects (light: no page/block bodies)
  GET    /api/studio/projects/<id>           — one project, full body
  PUT    /api/studio/projects/<id>           — save pages/blocks/status (the canvas autosave target)
  DELETE /api/studio/projects/<id>           — delete
  GET    /api/studio/projects/<id>/responses      — raw response list, with computed instrument metrics
  GET    /api/studio/projects/<id>/responses.csv  — flattened CSV export, same metrics as columns
  GET    /api/studio/projects/<id>/live-summary   — aggregated stats for the Present view (polled)

Public (no auth — the first anonymous-write surface Studio has):
  GET    /api/studio/public/projects/<id>            — a project's pages/blocks, ONLY if published
  POST   /api/studio/public/projects/<id>/responses  — submit one respondent's full answer set
                                                        (each answer may carry an `events` array).
                                                        May also carry `embedded_data` (sanitized,
                                                        capped) and gets round-robin assigned one of
                                                        the project's `conditions`, if any.

Mongo access goes through current_app.config['MONGO_DB'] (the connection set
up once in app.py) rather than a fresh pymongo.MongoClient per call — see
models/user.py's get_collection() docstring for why the other pattern (used
by a few older models in this codebase) is a connection-pool leak.
"""
import csv
import hashlib
import io
import json
import logging
import uuid
from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId
from flask import Blueprint, Response, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from models.user import User
from src.studio.live_ai import call_live_ai_instrument
from src.studio.summary import build_live_summary
from src.studio.registry import (
    compute_instrument_metric,
    get_block_specs,
    get_instrument_specs,
    instrument_needs_events,
    validate_block_config,
    validate_instrument_config,
)

logger = logging.getLogger(__name__)
studio_bp = Blueprint('studio_routes', __name__)

FACULTY_ROLES = ("professor", "admin")

# One public submission per (project, IP) per this many seconds — a cheap,
# dependency-free guard against trivial spam/double-submit on the one fully
# anonymous write endpoint this blueprint has. See _rate_limit_ok.
STUDIO_RESPONSE_COOLDOWN_SECONDS = 30
_rate_limit_index_ensured = False

# A separate, more generous counting limiter for the /ai-instrument endpoint
# (Tier-3 live AI calls): up to this many calls per (project, IP) per window.
# This one spends real Claude API money on anonymous traffic and a
# respondent may legitimately trigger several different live AI instruments
# in one session, so it can't reuse the submit endpoint's simpler
# insert-once cooldown (that one only ever needs to allow a single call).
# See _ai_instrument_rate_limit_ok.
AI_INSTRUMENT_MAX_CALLS = 10
AI_INSTRUMENT_WINDOW_SECONDS = 600
_ai_instrument_rate_limit_index_ensured = False


def _is_faculty(user_id):
    me = User.find_by_id(user_id)
    return bool(me and me.get("role") in FACULTY_ROLES)


def _load_owned_project(project_id, user_id):
    """The project doc if the caller owns it, else (None, (payload, status)).

    Ownership implies faculty: only a faculty account can create a project
    (see create_project), so a valid owner match is sufficient here without
    re-checking role on every read/write.
    """
    db = current_app.config['MONGO_DB']
    try:
        oid = ObjectId(project_id)
    except (InvalidId, Exception):
        return None, ({"message": "Invalid project id"}, 400)
    doc = db['studio_projects'].find_one({"_id": oid})
    if not doc:
        return None, ({"message": "Project not found"}, 404)
    if str(doc.get("user_id", "")) != str(user_id):
        return None, ({"message": "You do not own this project"}, 403)
    return doc, None


def _sanitize_instruments(instruments_in, block_type, page_idx, block_idx):
    """Validate/coerce one block's `instruments` list for a save.

    Raises ValueError with a client-safe message on an unknown instrument
    type or one that can't attach to this block_type. Silently drops a
    duplicate instrument type on the same block (Phase 2 doesn't support
    attaching the same instrument twice) rather than erroring — the builder
    UI doesn't offer a way to do that deliberately, so it can only be a
    stale/racy autosave, not a professor decision worth failing loudly on.
    """
    if not isinstance(instruments_in, list):
        return []

    instruments_out = []
    seen_types = set()
    for inst in instruments_in:
        if not isinstance(inst, dict) or not inst.get("type"):
            continue
        inst_type = inst["type"]
        if inst_type in seen_types:
            continue
        try:
            clean_config = validate_instrument_config(inst_type, block_type, inst.get("config") or {})
        except KeyError:
            raise ValueError(
                f"page {page_idx} block {block_idx}: unknown instrument type '{inst_type}'"
            )
        except ValueError:
            raise ValueError(
                f"page {page_idx} block {block_idx}: instrument '{inst_type}' "
                f"cannot be attached to a '{block_type}' block"
            )
        seen_types.add(inst_type)
        instruments_out.append({
            "id": str(inst.get("id") or uuid.uuid4().hex),
            "type": inst_type,
            "config": clean_config,
        })
    return instruments_out


def _sanitize_pages(pages_in):
    """Validate/coerce a project's pages+blocks for a save.

    Raises ValueError with a client-safe message on anything malformed.
    Every block's config (and each attached instrument's config) is run
    through its registered validator, so a bad builder payload can't persist
    garbage. `order` is re-derived from array position rather than trusted
    from the client, so it can never end up duplicated or gapped.
    """
    if not isinstance(pages_in, list) or not pages_in:
        raise ValueError("pages must be a non-empty list")

    pages_out = []
    for page_idx, page in enumerate(pages_in):
        if not isinstance(page, dict):
            raise ValueError(f"page {page_idx} is not an object")
        blocks_in = page.get("blocks")
        if not isinstance(blocks_in, list):
            raise ValueError(f"page {page_idx} is missing 'blocks'")

        blocks_out = []
        for block_idx, blk in enumerate(blocks_in):
            if not isinstance(blk, dict) or not blk.get("id") or not blk.get("type"):
                raise ValueError(f"page {page_idx} block {block_idx} is missing id/type")
            try:
                clean_config = validate_block_config(blk["type"], blk.get("config") or {})
            except KeyError:
                raise ValueError(
                    f"page {page_idx} block {block_idx}: unknown block type '{blk['type']}'"
                )
            blocks_out.append({
                "id": str(blk["id"]),
                "type": blk["type"],
                "order": block_idx,
                "config": clean_config,
                "instruments": _sanitize_instruments(
                    blk.get("instruments"), blk["type"], page_idx, block_idx
                ),
            })

        pages_out.append({
            "id": str(page.get("id") or uuid.uuid4().hex),
            "title": str(page.get("title") or f"Page {page_idx + 1}"),
            "order": page_idx,
            "blocks": blocks_out,
        })

    return pages_out


MAX_CONDITIONS = 10
MAX_EMBEDDED_KEYS = 20
MAX_EMBEDDED_KEY_LEN = 100
MAX_EMBEDDED_VALUE_LEN = 200


def _sanitize_conditions(conditions_in):
    """Coerce a project's counterbalancing condition names for a save.

    Not a whitelist of anything sensitive — just capped so a professor can't
    accidentally (or a forged request can't deliberately) balloon the list
    that submit_response round-robins over.
    """
    if not isinstance(conditions_in, list):
        return []
    cleaned = [str(c).strip() for c in conditions_in if str(c).strip()]
    return cleaned[:MAX_CONDITIONS]


def _sanitize_embedded_data(embedded_data_in):
    """Coerce the client-supplied embedded-data dict on a public submission.

    This is the one anonymous-write endpoint's one arbitrary-shaped input —
    capped on key count and per-key/value length so it can't be abused as a
    free storage sink. Every value is coerced to a string; Qualtrics-style
    embedded data (URL query params) is string-shaped anyway.
    """
    if not isinstance(embedded_data_in, dict):
        return {}
    out = {}
    for k, v in embedded_data_in.items():
        key = str(k).strip()[:MAX_EMBEDDED_KEY_LEN]
        if not key or len(out) >= MAX_EMBEDDED_KEYS:
            continue
        out[key] = str(v)[:MAX_EMBEDDED_VALUE_LEN]
    return out


def _serialize(doc):
    """Mongo doc -> JSON-safe dict (ObjectId -> str)."""
    doc = dict(doc)
    doc["_id"] = str(doc["_id"])
    return doc


def _iter_blocks(project):
    """Yield every block across every page, in page/block order."""
    for page in project.get("pages", []):
        for blk in page.get("blocks", []):
            yield blk


def _answerable_blocks(project):
    """Blocks that expect a response — anything whose config carries a `required`
    key. rich_text deliberately omits that key (see its own docstring), so a
    content-only block is skipped here without a per-type special case."""
    return [blk for blk in _iter_blocks(project) if "required" in (blk.get("config") or {})]


def _block_by_id(project):
    """{block_id: block} across every page — for looking up a response
    answer's block (type + attached instruments) by id."""
    return {blk['id']: blk for blk in _iter_blocks(project)}


def _augment_responses_with_metrics(project, responses, db=None):
    """Attach computed instrument metrics to each response's answers, in
    place, as `answer['metrics'] = {instrument_type: {...}}`. A no-op (no
    keys added) for any block/answer that carries no instrument or no
    matching event data.

    Metrics already cached on the stored doc (`answer['metrics']`) are reused
    as-is rather than recomputed. This matters now that some instruments
    (llm_rubric_grader, cross_answer_inconsistency) call Claude — recomputing
    on every results-page view would re-bill the same response every time
    it's viewed. Newly-computed metrics are written back to Mongo when `db`
    is given (owner-only callers pass it; the caching is pointless — and the
    extra write pointless overhead — for any caller that doesn't).

    Known tradeoff: if a professor edits an instrument's config (e.g.
    changes the rubric text) after responses already carry a cached score,
    those responses keep the stale score — there's no cache invalidation
    tied to config changes. Narrow edge case, not worth tracking config
    versions for right now.

    cross_answer_inconsistency is special-cased here (not left to the
    generic per-answer loop) because it's the one instrument whose compute()
    needs another block's answer from the SAME response — every other
    instrument's compute() only ever sees its own block's answer. See that
    instrument's own file for why the sibling data is injected as private
    `_sibling_*` config keys rather than widening compute()'s signature.
    """
    block_by_id = _block_by_id(project)
    for r in responses:
        newly_computed = False
        answers_by_block = {a.get('block_id'): a for a in r.get('answers', [])}
        for a in r.get('answers', []):
            blk = block_by_id.get(a.get('block_id'))
            if not blk or not blk.get('instruments'):
                continue
            existing = a.get('metrics') or {}
            metrics = dict(existing)
            for inst in blk['instruments']:
                inst_type = inst['type']
                if existing.get(inst_type):
                    continue  # cached — reuse, don't re-bill
                inst_config = inst.get('config') or {}
                if inst_type == 'cross_answer_inconsistency':
                    sibling_id = inst_config.get('compare_to_block_id')
                    sibling_answer = answers_by_block.get(sibling_id) or {}
                    sibling_block = block_by_id.get(sibling_id) or {}
                    inst_config = {
                        **inst_config,
                        '_sibling_answer': sibling_answer.get('value'),
                        '_sibling_question': (sibling_block.get('config') or {}).get('question'),
                    }
                m = compute_instrument_metric(inst_type, a, inst_config)
                if m:
                    metrics[inst_type] = m
                    newly_computed = True
            if metrics:
                a['metrics'] = metrics
        if newly_computed and db is not None and r.get('_id'):
            try:
                rid = r['_id'] if isinstance(r['_id'], ObjectId) else ObjectId(r['_id'])
                db['studio_responses'].update_one({'_id': rid}, {'$set': {'answers': r['answers']}})
            except Exception:
                logger.warning("Failed to persist computed metrics for response %s", r.get('_id'), exc_info=True)
    return responses


def _public_project_view(doc):
    """Strip owner-only fields (user_id, status, timestamps) before handing a
    project to an anonymous respondent. Each attached instrument is enriched
    with `needs_events` so the runner knows whether to record a block's
    shown/submit timestamps — an anonymous respondent has no access to the
    faculty-scoped instrument-specs endpoint, so this has to ride along here.
    """
    pages = []
    for page in doc.get("pages", []):
        blocks = []
        for blk in page.get("blocks", []):
            blk = dict(blk)
            blk["instruments"] = [
                {**inst, "needs_events": instrument_needs_events(inst["type"])}
                for inst in blk.get("instruments", [])
            ]
            blocks.append(blk)
        pages.append({**page, "blocks": blocks})

    return {
        "_id": str(doc["_id"]),
        "title": doc.get("title", ""),
        "description": doc.get("description", ""),
        "pages": pages,
    }


def _client_ip():
    forwarded = request.headers.get('X-Forwarded-For', '')
    if forwarded:
        return forwarded.split(',')[0].strip()
    return request.remote_addr or 'unknown'


def _rate_limit_collection(db):
    global _rate_limit_index_ensured
    col = db['studio_response_rate_limits']
    if not _rate_limit_index_ensured:
        col.create_index('created_at', expireAfterSeconds=STUDIO_RESPONSE_COOLDOWN_SECONDS)
        _rate_limit_index_ensured = True
    return col


def _rate_limit_ok(db, project_id):
    """True if this (project, caller IP) may submit right now.

    The record is a short-lived, TTL-expired doc keyed on a hash of the IP —
    it is an abuse guard, not an identity signal, and is kept entirely
    separate from the response document itself so it never adds persistent
    PII to research response data.
    """
    col = _rate_limit_collection(db)
    key = hashlib.sha256(f"{project_id}:{_client_ip()}".encode()).hexdigest()
    try:
        col.insert_one({"_id": key, "created_at": datetime.now(timezone.utc)})
        return True
    except DuplicateKeyError:
        return False


def _assign_condition(db, project_oid, conditions):
    """Round-robin assign one respondent to a counterbalancing condition.

    Assigned at submit time (not page-load) via an atomic `$inc` on the
    project doc's `condition_cursor` — deliberately not respondent-keyed,
    since there's no conditional-rendering engine yet for a pre-assigned
    condition to change what a respondent sees before they submit. Returns
    None if the project defines no conditions.
    """
    if not conditions:
        return None
    result = db['studio_projects'].find_one_and_update(
        {"_id": project_oid},
        {"$inc": {"condition_cursor": 1}},
        return_document=ReturnDocument.AFTER,
    )
    cursor = (result or {}).get("condition_cursor", 1) - 1
    return conditions[cursor % len(conditions)]


def _ai_instrument_rate_limit_collection(db):
    global _ai_instrument_rate_limit_index_ensured
    col = db['studio_ai_instrument_calls']
    if not _ai_instrument_rate_limit_index_ensured:
        col.create_index('created_at', expireAfterSeconds=AI_INSTRUMENT_WINDOW_SECONDS)
        _ai_instrument_rate_limit_index_ensured = True
    return col


def _ai_instrument_rate_limit_ok(db, project_id):
    """True if this (project, caller IP) may make another live AI-instrument
    call right now — up to AI_INSTRUMENT_MAX_CALLS within AI_INSTRUMENT_WINDOW_SECONDS.

    A counting limiter (insert-then-count), not the submit endpoint's
    simpler insert-once cooldown: this endpoint needs to allow a handful of
    calls per session, not just one. Same TTL-expiry mechanism as
    _rate_limit_collection, separate collection so the two windows don't
    interfere with each other.
    """
    col = _ai_instrument_rate_limit_collection(db)
    key = hashlib.sha256(f"{project_id}:{_client_ip()}".encode()).hexdigest()
    count = col.count_documents({"key": key})
    if count >= AI_INSTRUMENT_MAX_CALLS:
        return False
    col.insert_one({"key": key, "created_at": datetime.now(timezone.utc)})
    return True


@studio_bp.route('/studio/block-specs', methods=['GET'])
@jwt_required()
def block_specs():
    user_id = get_jwt_identity()
    if not _is_faculty(user_id):
        return jsonify({"message": "Only faculty accounts can access Studio"}), 403
    return jsonify({"blocks": get_block_specs()}), 200


@studio_bp.route('/studio/instrument-specs', methods=['GET'])
@jwt_required()
def instrument_specs():
    user_id = get_jwt_identity()
    if not _is_faculty(user_id):
        return jsonify({"message": "Only faculty accounts can access Studio"}), 403
    return jsonify({"instruments": get_instrument_specs()}), 200


@studio_bp.route('/studio/projects', methods=['POST'])
@jwt_required()
def create_project():
    user_id = get_jwt_identity()
    if not _is_faculty(user_id):
        return jsonify({"message": "Only faculty accounts can create Studio projects"}), 403

    body = request.get_json(silent=True) or {}
    title = (body.get('title') or '').strip() or "Untitled Project"
    now = datetime.now(timezone.utc)

    doc = {
        "user_id": user_id,
        "title": title,
        "description": "",
        "status": "draft",
        "pages": [
            {"id": uuid.uuid4().hex, "title": "Page 1", "order": 0, "blocks": []}
        ],
        "conditions": [],
        "condition_cursor": 0,
        "created_at": now,
        "updated_at": now,
    }
    db = current_app.config['MONGO_DB']
    result = db['studio_projects'].insert_one(doc)
    doc["_id"] = result.inserted_id
    return jsonify(_serialize(doc)), 201


@studio_bp.route('/studio/projects', methods=['GET'])
@jwt_required()
def list_projects():
    user_id = get_jwt_identity()
    db = current_app.config['MONGO_DB']
    cursor = db['studio_projects'].find(
        {"user_id": user_id},
        {"title": 1, "status": 1, "updated_at": 1, "created_at": 1},
    ).sort("updated_at", -1)
    return jsonify({"projects": [_serialize(d) for d in cursor]}), 200


@studio_bp.route('/studio/projects/<project_id>', methods=['GET'])
@jwt_required()
def get_project(project_id):
    user_id = get_jwt_identity()
    doc, error = _load_owned_project(project_id, user_id)
    if error:
        payload, status = error
        return jsonify(payload), status
    return jsonify(_serialize(doc)), 200


@studio_bp.route('/studio/projects/<project_id>', methods=['PUT'])
@jwt_required()
def save_project(project_id):
    user_id = get_jwt_identity()
    doc, error = _load_owned_project(project_id, user_id)
    if error:
        payload, status = error
        return jsonify(payload), status

    body = request.get_json(silent=True) or {}
    updates = {"updated_at": datetime.now(timezone.utc)}

    if 'title' in body:
        updates['title'] = str(body.get('title') or '').strip() or "Untitled Project"
    if 'description' in body:
        updates['description'] = str(body.get('description') or '')
    if 'status' in body and body['status'] in ('draft', 'published', 'archived'):
        updates['status'] = body['status']
    if 'pages' in body:
        try:
            updates['pages'] = _sanitize_pages(body['pages'])
        except ValueError as e:
            return jsonify({"message": str(e)}), 400
    if 'conditions' in body:
        updates['conditions'] = _sanitize_conditions(body['conditions'])

    db = current_app.config['MONGO_DB']
    db['studio_projects'].update_one({"_id": doc["_id"]}, {"$set": updates})
    doc.update(updates)
    return jsonify(_serialize(doc)), 200


@studio_bp.route('/studio/projects/<project_id>', methods=['DELETE'])
@jwt_required()
def delete_project(project_id):
    user_id = get_jwt_identity()
    doc, error = _load_owned_project(project_id, user_id)
    if error:
        payload, status = error
        return jsonify(payload), status

    db = current_app.config['MONGO_DB']
    db['studio_projects'].delete_one({"_id": doc["_id"]})
    return jsonify({"deleted": True}), 200


# ---------------------------------------------------------------------------
# Public (anonymous) — a published project's respondent-facing surface
# ---------------------------------------------------------------------------

@studio_bp.route('/studio/public/projects/<project_id>', methods=['GET'])
def public_get_project(project_id):
    db = current_app.config['MONGO_DB']
    try:
        oid = ObjectId(project_id)
    except (InvalidId, Exception):
        return jsonify({"message": "Invalid project id"}), 400
    doc = db['studio_projects'].find_one({"_id": oid, "status": "published"})
    if not doc:
        return jsonify({"message": "Project not found"}), 404
    return jsonify(_public_project_view(doc)), 200


@studio_bp.route('/studio/public/projects/<project_id>/responses', methods=['POST'])
def submit_response(project_id):
    db = current_app.config['MONGO_DB']
    try:
        oid = ObjectId(project_id)
    except (InvalidId, Exception):
        return jsonify({"message": "Invalid project id"}), 400
    project = db['studio_projects'].find_one({"_id": oid, "status": "published"})
    if not project:
        return jsonify({"message": "Project not found"}), 404

    if not _rate_limit_ok(db, project_id):
        return jsonify({"message": "Please wait before submitting again."}), 429

    body = request.get_json(silent=True) or {}
    answers_in = body.get('answers')
    if not isinstance(answers_in, list):
        return jsonify({"message": "answers must be a list"}), 400

    answers_by_id = {}
    events_by_id = {}
    instrument_values_by_id = {}
    for a in answers_in:
        if not isinstance(a, dict) or not a.get('block_id'):
            continue
        bid = str(a['block_id'])
        answers_by_id[bid] = a.get('value')
        if isinstance(a.get('events'), list):
            # Trust the shape (list of {type, at, ...}), not the timestamps — a
            # forged latency doesn't grant access to anything, it just pollutes
            # that respondent's own data, so there's nothing to gate here.
            events_by_id[bid] = a['events']
        if isinstance(a.get('instrument_values'), dict):
            # e.g. {"confidence_slider": 75} — a secondary value alongside the
            # block's own answer. Same trust posture as events: not gated,
            # only ever pollutes the submitter's own data if forged.
            instrument_values_by_id[bid] = a['instrument_values']

    missing = [
        blk['id'] for blk in _answerable_blocks(project)
        if blk.get('config', {}).get('required')
        and not str(answers_by_id.get(blk['id']) or '').strip()
    ]
    if missing:
        return jsonify({"message": "Missing required answers", "block_ids": missing}), 400

    respondent_id = str(body.get('respondent_id') or '').strip() or f"anon_{uuid.uuid4().hex}"
    now = datetime.now(timezone.utc)
    all_block_ids = set(answers_by_id) | set(instrument_values_by_id)
    answers_out = []
    for bid in all_block_ids:
        entry = {"block_id": bid, "value": answers_by_id.get(bid)}
        if bid in events_by_id:
            entry["events"] = events_by_id[bid]
        if bid in instrument_values_by_id:
            entry["instrument_values"] = instrument_values_by_id[bid]
        answers_out.append(entry)

    response_doc = {
        "project_id": project_id,
        "respondent_id": respondent_id,
        "started_at": now,
        "submitted_at": now,
        "answers": answers_out,
    }

    embedded_data = _sanitize_embedded_data(body.get('embedded_data'))
    if embedded_data:
        response_doc["embedded_data"] = embedded_data

    condition = _assign_condition(db, oid, project.get('conditions') or [])
    if condition is not None:
        response_doc["condition"] = condition

    db['studio_responses'].insert_one(response_doc)
    return jsonify({"submitted": True}), 201


@studio_bp.route('/studio/public/projects/<project_id>/ai-instrument', methods=['POST'])
def ai_instrument_call(project_id):
    """Live, mid-session Claude call for a Tier-3 instrument (Comprehension-
    Paraphrase Check, AI Devil's-Advocate, Adaptive Follow-Up Probe) attached
    to a block the respondent is currently answering.

    This is the one endpoint in Studio that spends real API money on
    anonymous, unauthenticated traffic — see AI_INSTRUMENT_MAX_CALLS and
    _ai_instrument_rate_limit_ok for the dedicated counting limiter that
    exists specifically because of that.
    """
    db = current_app.config['MONGO_DB']
    try:
        oid = ObjectId(project_id)
    except (InvalidId, Exception):
        return jsonify({"message": "Invalid project id"}), 400
    project = db['studio_projects'].find_one({"_id": oid, "status": "published"})
    if not project:
        return jsonify({"message": "Project not found"}), 404

    if not _ai_instrument_rate_limit_ok(db, project_id):
        return jsonify({"message": "Please slow down and try again in a few minutes."}), 429

    body = request.get_json(silent=True) or {}
    instrument_type = str(body.get('instrument_type') or '')
    block_id = str(body.get('block_id') or '')

    block = _block_by_id(project).get(block_id)
    if not block:
        return jsonify({"message": "Unknown block"}), 400
    if not any(i.get('type') == instrument_type for i in (block.get('instruments') or [])):
        return jsonify({"message": "Instrument is not attached to this block"}), 400

    result = call_live_ai_instrument(instrument_type, block, body.get('input'))
    if result is None:
        return jsonify({"message": "AI is unavailable right now — please try again shortly."}), 502
    return jsonify({"result": result}), 200


# ---------------------------------------------------------------------------
# Owner-only — reading back what came in
# ---------------------------------------------------------------------------

@studio_bp.route('/studio/projects/<project_id>/responses', methods=['GET'])
@jwt_required()
def list_responses(project_id):
    user_id = get_jwt_identity()
    doc, error = _load_owned_project(project_id, user_id)
    if error:
        payload, status = error
        return jsonify(payload), status

    db = current_app.config['MONGO_DB']
    cursor = db['studio_responses'].find({"project_id": project_id}).sort("submitted_at", -1)
    responses = []
    for r in cursor:
        r['_id'] = str(r['_id'])
        responses.append(r)
    _augment_responses_with_metrics(doc, responses, db=db)
    return jsonify({"responses": responses}), 200


@studio_bp.route('/studio/projects/<project_id>/live-summary', methods=['GET'])
@jwt_required()
def live_summary(project_id):
    """Data source for the Present view — polled every few seconds while a
    professor has it open on a projector. See src/studio/summary.py for what
    is (and deliberately isn't) aggregated here.

    Optional `?filter_block_id=<id>&filter_value=<json>` cross-filters: only
    responses whose answer to `filter_block_id` equals `filter_value` (JSON-
    decoded, so a rating's int and a choice's string both round-trip
    correctly) are aggregated. Filtering happens here, on the raw response
    list, before it ever reaches build_live_summary — every aggregation
    function in summary.py is unchanged, it just sees fewer responses.
    """
    user_id = get_jwt_identity()
    doc, error = _load_owned_project(project_id, user_id)
    if error:
        payload, status = error
        return jsonify(payload), status

    db = current_app.config['MONGO_DB']
    responses = list(db['studio_responses'].find({"project_id": project_id}))

    filter_block_id = request.args.get('filter_block_id')
    filter_value_raw = request.args.get('filter_value')
    if filter_block_id and filter_value_raw is not None:
        try:
            filter_value = json.loads(filter_value_raw)
        except (TypeError, ValueError):
            filter_value = filter_value_raw
        responses = [
            r for r in responses
            if any(
                a.get('block_id') == filter_block_id and a.get('value') == filter_value
                for a in r.get('answers', [])
            )
        ]

    return jsonify(build_live_summary(doc, responses)), 200


@studio_bp.route('/studio/projects/<project_id>/responses.csv', methods=['GET'])
@jwt_required()
def export_responses_csv(project_id):
    user_id = get_jwt_identity()
    doc, error = _load_owned_project(project_id, user_id)
    if error:
        payload, status = error
        return jsonify(payload), status

    db = current_app.config['MONGO_DB']
    # (block_id, column header). Two blocks with identical question text
    # produce duplicate headers — acceptable; column order still
    # disambiguates them.
    columns = [
        (blk['id'], blk.get('config', {}).get('question') or blk['id'])
        for blk in _answerable_blocks(doc)
    ]

    responses = list(db['studio_responses'].find({"project_id": project_id}).sort("submitted_at", 1))
    _augment_responses_with_metrics(doc, responses, db=db)

    # Metric columns are discovered from the actual computed data rather than
    # statically from the instrument spec, since a compute()'s return shape
    # isn't declared anywhere — this stays correct for any future instrument
    # without export code changes. (block_id, instrument_type, metric_key) -> header.
    question_by_block = {bid: label for bid, label in columns}
    metric_columns = []
    seen_metric_keys = set()
    for r in responses:
        for a in r.get('answers', []):
            for inst_type, metrics in (a.get('metrics') or {}).items():
                for mk in metrics:
                    key = (a['block_id'], inst_type, mk)
                    if key in seen_metric_keys:
                        continue
                    seen_metric_keys.add(key)
                    question = question_by_block.get(a['block_id'], a['block_id'])
                    metric_columns.append((key, f"{question} — {inst_type}:{mk}"))

    # Embedded-data keys, same "discover from actual data" approach as metric
    # columns — a project's respondents may pass different URL params over
    # time, and there's no schema declaring them up front.
    embedded_keys = []
    seen_embedded_keys = set()
    for r in responses:
        for k in (r.get('embedded_data') or {}):
            if k not in seen_embedded_keys:
                seen_embedded_keys.add(k)
                embedded_keys.append(k)

    has_condition = any(r.get('condition') for r in responses)

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(
        ["respondent_id", "submitted_at"]
        + (["condition"] if has_condition else [])
        + [label for _, label in columns]
        + [label for _, label in metric_columns]
        + [f"embedded:{k}" for k in embedded_keys]
    )

    for r in responses:
        answers_by_id = {a.get('block_id'): a for a in r.get('answers', [])}
        row = [r.get('respondent_id', ''), r.get('submitted_at', '')]
        if has_condition:
            row.append(r.get('condition', ''))
        row += [(answers_by_id.get(bid) or {}).get('value', '') for bid, _ in columns]
        for (bid, inst_type, mk), _label in metric_columns:
            a = answers_by_id.get(bid) or {}
            row.append((a.get('metrics') or {}).get(inst_type, {}).get(mk, ''))
        row += [(r.get('embedded_data') or {}).get(k, '') for k in embedded_keys]
        writer.writerow(row)

    filename = f"{(doc.get('title') or 'project').replace(' ', '_')}_responses.csv"
    return Response(
        output.getvalue(),
        mimetype='text/csv',
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
