"""
Per-user personal file library for RAG. Files are global to the user and
surface in every chat they open, alongside the config-owner's baseline docs.

Vector chunks are tagged with config_id = f"user:{user_id}" so the existing
Atlas vector index (which filters on config_id) works without schema changes.
"""

import logging
import mimetypes
import os
import re
import time
import uuid

from bson import ObjectId
from bson.errors import InvalidId
from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from werkzeug.utils import secure_filename

from src.utils.s3_client import (
    delete_object as s3_delete,
    generate_download_url,
    upload_file as s3_upload,
)
from src.utils.vector_stores.store_vector_stores import (
    process_user_file_and_create_vectors,
)

logger = logging.getLogger(__name__)
user_files_bp = Blueprint('user_files_routes', __name__)

TMP_UPLOAD_DIR = "uploads/user_tmp"
ALLOWED_EXTENSIONS = {'txt', 'pdf', 'md', 'docx'}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB


def _allowed(filename: str) -> bool:
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def _normalize_path(path):
    """Collapse slashes and trim; empty string == root."""
    if not path:
        return ''
    parts = [p.strip() for p in str(path).split('/') if p.strip()]
    return '/'.join(parts)


def _serialize(doc):
    doc['_id'] = str(doc['_id'])
    return doc


# ---------------------------------------------------------------------------
# Files
# ---------------------------------------------------------------------------

@user_files_bp.route('/files', methods=['POST'])
@jwt_required()
def upload_file():
    user_id = get_jwt_identity()

    if 'file' not in request.files:
        return jsonify({"message": "No file uploaded"}), 400
    f = request.files['file']
    if not f or not f.filename:
        return jsonify({"message": "Empty file"}), 400
    if not _allowed(f.filename):
        return jsonify({
            "message": f"Unsupported file type. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}"
        }), 400

    folder_path = _normalize_path(request.form.get('folder_path', ''))
    filename = secure_filename(f.filename)
    content_type = f.content_type or mimetypes.guess_type(filename)[0]

    os.makedirs(TMP_UPLOAD_DIR, exist_ok=True)
    tmp_path = os.path.join(TMP_UPLOAD_DIR, f"{uuid.uuid4().hex}_{filename}")
    f.save(tmp_path)

    try:
        size_bytes = os.path.getsize(tmp_path)
        if size_bytes > MAX_FILE_SIZE:
            return jsonify({"message": "File exceeds 50 MB limit"}), 413

        db = current_app.config['MONGO_DB']
        files_col = db['user_files']

        doc = {
            "user_id": user_id,
            "folder_path": folder_path,
            "filename": filename,
            "content_type": content_type,
            "size_bytes": size_bytes,
            "uploaded_at": time.time(),
            "vector_ingested": False,
            "storage_key": None,
        }
        file_id = files_col.insert_one(doc).inserted_id

        ok = process_user_file_and_create_vectors(
            tmp_path, user_id, folder_path, filename, file_id
        )
        if not ok:
            files_col.delete_one({"_id": file_id})
            return jsonify({"message": "Failed to process file"}), 500

        storage_key = f"user_files/{user_id}/{file_id}/{filename}"
        try:
            s3_upload(tmp_path, storage_key, content_type=content_type)
        except Exception as e:
            current_app.logger.error(f"S3 upload failed for {storage_key}: {e}")
            # Roll back: drop vectors + metadata so the user can retry cleanly.
            db['vector_collection'].delete_many({
                "source_file_id": str(file_id),
                "owner_user_id": user_id,
            })
            files_col.delete_one({"_id": file_id})
            return jsonify({"message": "Failed to persist file to storage"}), 502

        files_col.update_one(
            {"_id": file_id},
            {"$set": {"vector_ingested": True, "storage_key": storage_key}},
        )
        doc["_id"] = str(file_id)
        doc["vector_ingested"] = True
        doc["storage_key"] = storage_key
        return jsonify({"file": doc}), 201
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)


@user_files_bp.route('/files', methods=['GET'])
@jwt_required()
def list_files():
    user_id = get_jwt_identity()
    db = current_app.config['MONGO_DB']
    files_col = db['user_files']

    query = {"user_id": user_id}
    raw_folder = request.args.get('folder_path')
    if raw_folder is not None:
        query['folder_path'] = _normalize_path(raw_folder)

    files = [_serialize(d) for d in files_col.find(query).sort("uploaded_at", -1)]
    return jsonify({"files": files}), 200


@user_files_bp.route('/files/<string:file_id>/download', methods=['GET'])
@jwt_required()
def download_file(file_id):
    user_id = get_jwt_identity()
    try:
        oid = ObjectId(file_id)
    except InvalidId:
        return jsonify({"message": "Invalid file id"}), 400

    db = current_app.config['MONGO_DB']
    doc = db['user_files'].find_one({"_id": oid, "user_id": user_id})
    if not doc:
        return jsonify({"message": "File not found"}), 404
    if not doc.get('storage_key'):
        return jsonify({"message": "File not available for download"}), 410

    url = generate_download_url(
        doc['storage_key'], expires_in=300, filename=doc.get('filename')
    )
    return jsonify({"url": url, "expires_in": 300}), 200


@user_files_bp.route('/files/<string:file_id>', methods=['DELETE'])
@jwt_required()
def delete_file(file_id):
    user_id = get_jwt_identity()
    try:
        oid = ObjectId(file_id)
    except InvalidId:
        return jsonify({"message": "Invalid file id"}), 400

    db = current_app.config['MONGO_DB']
    doc = db['user_files'].find_one({"_id": oid, "user_id": user_id})
    if not doc:
        return jsonify({"message": "File not found"}), 404

    db['vector_collection'].delete_many({
        "source_file_id": str(oid),
        "owner_user_id": user_id,
    })
    if doc.get('storage_key'):
        s3_delete(doc['storage_key'])
    db['user_files'].delete_one({"_id": oid})
    return jsonify({"deleted": True}), 200


# ---------------------------------------------------------------------------
# Folders
# ---------------------------------------------------------------------------

@user_files_bp.route('/folders', methods=['POST'])
@jwt_required()
def create_folder():
    user_id = get_jwt_identity()
    body = request.get_json(silent=True) or {}
    path = _normalize_path(body.get('path', ''))
    if not path:
        return jsonify({"message": "Path is required"}), 400

    db = current_app.config['MONGO_DB']
    folders_col = db['user_folders']

    if folders_col.find_one({"user_id": user_id, "path": path}):
        return jsonify({"message": "Folder already exists"}), 409

    doc = {
        "user_id": user_id,
        "path": path,
        "created_at": time.time(),
    }
    doc['_id'] = str(folders_col.insert_one(doc).inserted_id)
    return jsonify({"folder": doc}), 201


@user_files_bp.route('/folders', methods=['GET'])
@jwt_required()
def list_folders():
    """Union of explicitly-created folders and folders implied by file paths."""
    user_id = get_jwt_identity()
    db = current_app.config['MONGO_DB']

    explicit = {
        d['path']
        for d in db['user_folders'].find({"user_id": user_id}, {"path": 1})
    }
    implicit = set()
    for f in db['user_files'].find({"user_id": user_id}, {"folder_path": 1}):
        p = f.get('folder_path') or ''
        if not p:
            continue
        parts = p.split('/')
        for i in range(len(parts)):
            implicit.add('/'.join(parts[:i + 1]))

    paths = sorted(explicit | implicit)
    return jsonify({"folders": [{"path": p} for p in paths]}), 200


@user_files_bp.route('/folders/<string:folder_id>', methods=['DELETE'])
@jwt_required()
def delete_folder(folder_id):
    """Deletes an empty folder. Caller must remove contained files first."""
    user_id = get_jwt_identity()
    try:
        oid = ObjectId(folder_id)
    except InvalidId:
        return jsonify({"message": "Invalid folder id"}), 400

    db = current_app.config['MONGO_DB']
    folder = db['user_folders'].find_one({"_id": oid, "user_id": user_id})
    if not folder:
        return jsonify({"message": "Folder not found"}), 404

    path = folder['path']
    prefix = re.escape(path)
    has_contents = db['user_files'].find_one({
        "user_id": user_id,
        "$or": [
            {"folder_path": path},
            {"folder_path": {"$regex": f"^{prefix}/"}},
        ],
    })
    if has_contents:
        return jsonify({"message": "Folder is not empty"}), 409

    db['user_folders'].delete_one({"_id": oid})
    return jsonify({"deleted": True}), 200
