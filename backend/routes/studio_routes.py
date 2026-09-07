# @language  Python
# @updated   2026-09-07
# @changed   Phase 1: published projects are now readable/submittable anonymously, and owners can
#            read back what came in. Added GET /studio/public/projects/<id> (published-only, strips
#            user_id), POST /studio/public/projects/<id>/responses (creates a studio_responses doc,
#            enforces `required` blocks, rate-limited per IP+project via a TTL-indexed collection —
#            no new dependency, mirrors the lazy create_index-once pattern in
#            src/models/manager_exercise_session.py), GET .../responses (owner, raw list), and GET
#            .../responses.csv (owner, flattened export).
#            Prior: New file: Studio Phase 0 CRUD — create/list/get/save/delete a project, plus the
#            block-spec catalog that feeds the builder's ribbon.
"""
HTTP for Studio projects — the drag-and-drop research-instrument builder.

Owner-scoped (faculty, JWT-required):
  GET    /api/studio/block-specs             — the ribbon's catalog (type/label/icon/default_config)
  POST   /api/studio/projects                — create a new project (one blank page)
  GET    /api/studio/projects                — list the caller's own projects (light: no page/block bodies)
  GET    /api/studio/projects/<id>           — one project, full body
  PUT    /api/studio/projects/<id>           — save pages/blocks/status (the canvas autosave target)
  DELETE /api/studio/projects/<id>           — delete
  GET    /api/studio/projects/<id>/responses      — raw response list
  GET    /api/studio/projects/<id>/responses.csv  — flattened CSV export

Public (no auth — the first anonymous-write surface Studio has):
  GET    /api/studio/public/projects/<id>            — a project's pages/blocks, ONLY if published
  POST   /api/studio/public/projects/<id>/responses  — submit one respondent's full answer set

Mongo access goes through current_app.config['MONGO_DB'] (the connection set
up once in app.py) rather than a fresh pymongo.MongoClient per call — see
models/user.py's get_collection() docstring for why the other pattern (used
by a few older models in this codebase) is a connection-pool leak.

Phase 1 has no instrument registry yet — `instruments` is still force-emptied
on every save (see _sanitize_pages) so nothing can smuggle unvalidated data
into a key that a later phase will start trusting.
"""
import csv
import hashlib
import io
import logging
import uuid
from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId
from flask import Blueprint, Response, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from pymongo.errors import DuplicateKeyError

from models.user import User
from src.studio.registry import get_block_specs, validate_block_config

logger = logging.getLogger(__name__)
studio_bp = Blueprint('studio_routes', __name__)

FACULTY_ROLES = ("professor", "admin")

# One public submission per (project, IP) per this many seconds — a cheap,
# dependency-free guard against trivial spam/double-submit on the one fully
# anonymous write endpoint this blueprint has. See _rate_limit_ok.
STUDIO_RESPONSE_COOLDOWN_SECONDS = 30
_rate_limit_index_ensured = False


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


def _sanitize_pages(pages_in):
    """Validate/coerce a project's pages+blocks for a save.

    Raises ValueError with a client-safe message on anything malformed.
    Every block's config is run through its registered validator, so a bad
    builder payload can't persist garbage. `order` is re-derived from array
    position rather than trusted from the client, so it can never end up
    duplicated or gapped. `instruments` is forced to [] — see module docstring.
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
                "instruments": [],
            })

        pages_out.append({
            "id": str(page.get("id") or uuid.uuid4().hex),
            "title": str(page.get("title") or f"Page {page_idx + 1}"),
            "order": page_idx,
            "blocks": blocks_out,
        })

    return pages_out


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


def _public_project_view(doc):
    """Strip owner-only fields (user_id, status, timestamps) before handing a
    project to an anonymous respondent."""
    return {
        "_id": str(doc["_id"]),
        "title": doc.get("title", ""),
        "description": doc.get("description", ""),
        "pages": doc.get("pages", []),
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


@studio_bp.route('/studio/block-specs', methods=['GET'])
@jwt_required()
def block_specs():
    user_id = get_jwt_identity()
    if not _is_faculty(user_id):
        return jsonify({"message": "Only faculty accounts can access Studio"}), 403
    return jsonify({"blocks": get_block_specs()}), 200


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
    for a in answers_in:
        if not isinstance(a, dict) or not a.get('block_id'):
            continue
        answers_by_id[str(a['block_id'])] = a.get('value')

    missing = [
        blk['id'] for blk in _answerable_blocks(project)
        if blk.get('config', {}).get('required')
        and not str(answers_by_id.get(blk['id']) or '').strip()
    ]
    if missing:
        return jsonify({"message": "Missing required answers", "block_ids": missing}), 400

    respondent_id = str(body.get('respondent_id') or '').strip() or f"anon_{uuid.uuid4().hex}"
    now = datetime.now(timezone.utc)
    db['studio_responses'].insert_one({
        "project_id": project_id,
        "respondent_id": respondent_id,
        "started_at": now,
        "submitted_at": now,
        "answers": [{"block_id": bid, "value": val} for bid, val in answers_by_id.items()],
    })
    return jsonify({"submitted": True}), 201


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
    return jsonify({"responses": responses}), 200


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
    # produce duplicate headers — acceptable for Phase 1; column order still
    # disambiguates them.
    columns = [
        (blk['id'], blk.get('config', {}).get('question') or blk['id'])
        for blk in _answerable_blocks(doc)
    ]

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(["respondent_id", "submitted_at"] + [label for _, label in columns])

    cursor = db['studio_responses'].find({"project_id": project_id}).sort("submitted_at", 1)
    for r in cursor:
        answers_by_id = {a.get('block_id'): a.get('value') for a in r.get('answers', [])}
        row = [r.get('respondent_id', ''), r.get('submitted_at', '')]
        row += [answers_by_id.get(bid, '') for bid, _ in columns]
        writer.writerow(row)

    filename = f"{(doc.get('title') or 'project').replace(' ', '_')}_responses.csv"
    return Response(
        output.getvalue(),
        mimetype='text/csv',
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
