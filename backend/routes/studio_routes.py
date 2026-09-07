# @language  Python
# @updated   2026-09-07
# @changed   New file: Studio (faculty research-project builder) Phase 0 CRUD — create/list/get/save/
#            delete a project, plus the block-spec catalog that feeds the builder's ribbon.
"""
HTTP for Studio projects — the drag-and-drop research-instrument builder.

Five endpoints. Block-specs is faculty-scoped only; the rest are owner-scoped:
  GET    /api/studio/block-specs       — the ribbon's catalog (type/label/icon/default_config)
  POST   /api/studio/projects          — create a new project (one blank page)
  GET    /api/studio/projects          — list the caller's own projects (light: no page/block bodies)
  GET    /api/studio/projects/<id>     — one project, full body
  PUT    /api/studio/projects/<id>     — save pages/blocks (the canvas autosave target)
  DELETE /api/studio/projects/<id>     — delete

Mongo access goes through current_app.config['MONGO_DB'] (the connection set
up once in app.py) rather than a fresh pymongo.MongoClient per call — see
models/user.py's get_collection() docstring for why the other pattern (used
by a few older models in this codebase) is a connection-pool leak.

Phase 0 has no instrument registry and no participant-facing runner yet —
`instruments` is force-emptied on every save so nothing can smuggle
unvalidated data into a key that later phases will start trusting.
"""
import logging
import uuid
from datetime import datetime, timezone

from bson import ObjectId
from bson.errors import InvalidId
from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required

from models.user import User
from src.studio.registry import get_block_specs, validate_block_config

logger = logging.getLogger(__name__)
studio_bp = Blueprint('studio_routes', __name__)

FACULTY_ROLES = ("professor", "admin")


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
