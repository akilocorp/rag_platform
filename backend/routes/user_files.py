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
import threading
import time
import uuid

from bson import ObjectId
from bson.errors import InvalidId
from flask import Blueprint, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from werkzeug.utils import secure_filename

from src.utils.s3_client import (
    delete_object as s3_delete,
    generate_download_url,
    upload_file as s3_upload,
)
from src.utils.vector_stores.store_vector_stores import (
    CLAUDE_BATCH_PAGE_THRESHOLD,
    _extract_pdf_text_via_claude,
    extract_pdf_chunks_fast,
    ingest_chunks,
    process_user_url_and_create_vectors,
)
from src.utils.web.fetch import fetch_url_as_documents, UnsafeURLError

logger = logging.getLogger(__name__)
user_files_bp = Blueprint('user_files_routes', __name__)

TMP_UPLOAD_DIR = "uploads/user_tmp"
ALLOWED_EXTENSIONS = {'txt', 'pdf', 'md', 'docx', 'pptx'}
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
    # Variant B: caller passes config_id to scope files to a specific bot
    config_id = request.form.get('config_id') or None
    filename = secure_filename(f.filename)
    content_type = f.content_type or mimetypes.guess_type(filename)[0]
    ext = os.path.splitext(filename)[1].lower()

    os.makedirs(TMP_UPLOAD_DIR, exist_ok=True)
    tmp_path = os.path.join(TMP_UPLOAD_DIR, f"{uuid.uuid4().hex}_{filename}")
    f.save(tmp_path)

    size_bytes = os.path.getsize(tmp_path)
    if size_bytes > MAX_FILE_SIZE:
        _safe_unlink(tmp_path)
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
        "ingest_status": "pending",
        "storage_key": None,
    }
    if config_id:
        doc["config_id"] = config_id
    file_id = files_col.insert_one(doc).inserted_id

    # Tier 1: pypdf-only fast extraction.
    splits, page_count, image_only_pages = extract_pdf_chunks_fast(tmp_path, filename)

    if splits is None:
        # Hard error during extraction (unsupported, corrupted, etc.)
        files_col.delete_one({"_id": file_id})
        _safe_unlink(tmp_path)
        return jsonify({"message": "Failed to read file"}), 500

    # Mixed PDF: some pages have a text layer, some are scanned. Ingest the
    # text-layer chunks now and async-OCR only the image-only pages.
    is_mixed = bool(splits) and bool(image_only_pages) and ext == ".pdf"

    if splits and not is_mixed:
        # FAST PATH: text PDF / docx / md / txt / pptx → sync ingest
        try:
            if not ingest_chunks(splits, user_id, folder_path, filename, file_id, config_id_override=config_id):
                files_col.delete_one({"_id": file_id})
                return jsonify({"message": "Failed to process file"}), 500

            storage_key = f"user_files/{user_id}/{file_id}/{filename}"
            try:
                s3_upload(tmp_path, storage_key, content_type=content_type)
            except Exception as e:
                current_app.logger.error(f"S3 upload failed for {storage_key}: {e}")
                db['vector_collection'].delete_many({
                    "source_file_id": str(file_id),
                    "owner_user_id": user_id,
                })
                files_col.delete_one({"_id": file_id})
                return jsonify({"message": "Failed to persist file to storage"}), 502

            files_col.update_one(
                {"_id": file_id},
                {"$set": {"vector_ingested": True, "ingest_status": "done", "storage_key": storage_key}},
            )
            doc["_id"] = str(file_id)
            doc["vector_ingested"] = True
            doc["ingest_status"] = "done"
            doc["storage_key"] = storage_key
            return jsonify({"file": doc}), 201
        finally:
            _safe_unlink(tmp_path)

    # No splits and not a PDF → hard fail (can't OCR a docx/txt/etc.)
    if not splits and ext != ".pdf":
        files_col.delete_one({"_id": file_id})
        _safe_unlink(tmp_path)
        logger.error("Upload FAIL: non-PDF with no extractable text | file=%s ext=%s", filename, ext)
        return jsonify({"message": "No extractable text in file"}), 500

    # Mixed PDF: ingest text-layer chunks synchronously, then dispatch async
    # OCR for the remaining image-only pages.
    if is_mixed:
        if not ingest_chunks(splits, user_id, folder_path, filename, file_id, config_id_override=config_id):
            files_col.delete_one({"_id": file_id})
            _safe_unlink(tmp_path)
            return jsonify({"message": "Failed to process file"}), 500
        logger.info(
            "Upload mixed PDF: text-layer ingested, async OCR for %d/%d pages | file=%s",
            len(image_only_pages), page_count, filename,
        )

    # Async dispatch (image-only PDF, or mixed PDF's image-only pages).
    jobs_col = db['upload_jobs']
    job_doc = {
        "user_id": user_id,
        "file_id": str(file_id),
        "filename": filename,
        "page_count": page_count,
        "status": "pending",
        "error": None,
        "created_at": time.time(),
        "updated_at": time.time(),
    }
    job_id = jobs_col.insert_one(job_doc).inserted_id

    # Hand the tmp file off to the worker — it owns cleanup from here.
    app = current_app._get_current_object()
    threading.Thread(
        target=_run_async_pdf_ingest,
        kwargs={
            "app": app,
            "tmp_path": tmp_path,
            "user_id": user_id,
            "file_id_str": str(file_id),
            "job_id_str": str(job_id),
            "folder_path": folder_path,
            "filename": filename,
            "content_type": content_type,
            "config_id": config_id,
            "page_indices": image_only_pages if is_mixed else None,
            "ocr_page_count": len(image_only_pages) if is_mixed else page_count,
        },
        daemon=True,
    ).start()

    logger.info(
        "Upload async dispatched | file=%s pages=%d ocr_pages=%s job=%s file_id=%s",
        filename, page_count,
        len(image_only_pages) if is_mixed else "all",
        str(job_id), str(file_id),
    )

    doc["_id"] = str(file_id)
    return jsonify({"file": doc, "job_id": str(job_id)}), 202


def _safe_unlink(path):
    try:
        if path and os.path.exists(path):
            os.remove(path)
    except Exception:
        pass


def _run_async_pdf_ingest(*, app, tmp_path, user_id, file_id_str, job_id_str,
                          folder_path, filename, content_type, config_id,
                          page_indices=None, ocr_page_count=0):
    """Background worker: Claude OCR → split → embed → write → S3 → emit.

    If page_indices is set, only those pages are OCR'd (mixed PDF where
    text-layer chunks were already ingested synchronously). OCR failures
    are soft-fail in that case — the file still has its text-layer content.
    """
    is_mixed = page_indices is not None
    will_batch = ocr_page_count >= CLAUDE_BATCH_PAGE_THRESHOLD
    with app.app_context():
        db = current_app.config['MONGO_DB']
        files_col = db['user_files']
        jobs_col = db['upload_jobs']

        def update_job(status, **extra):
            jobs_col.update_one(
                {"_id": ObjectId(job_id_str)},
                {"$set": {"status": status, "updated_at": time.time(), **extra}},
            )

        # Flask-SocketIO registers itself on app.extensions during init_app;
        # pulling from current_app avoids the `from app import socketio` lazy
        # import which re-loads app.py as a fresh module (since the entry
        # point runs it as __main__) and yields a detached SocketIO instance.
        sio = current_app.extensions.get('socketio')

        def emit(status, error=None):
            if not sio:
                logger.warning("upload_job_done not emitted: socketio missing from app.extensions")
                return
            try:
                sio.emit(
                    'upload_job_done',
                    {
                        'job_id': job_id_str,
                        'file_id': file_id_str,
                        'filename': filename,
                        'status': status,
                        'error': error,
                    },
                    room=f"user:{user_id}",
                )
            except Exception as e:
                logger.warning("Failed to emit upload_job_done: %s", e)

        def emit_progress(stage, **extra):
            if not sio:
                return
            try:
                sio.emit(
                    'upload_job_progress',
                    {
                        'job_id': job_id_str,
                        'file_id': file_id_str,
                        'filename': filename,
                        'stage': stage,
                        **extra,
                    },
                    room=f"user:{user_id}",
                )
            except Exception as e:
                logger.warning("Failed to emit upload_job_progress: %s", e)

        try:
            update_job("extracting")
            emit_progress('ocr', batch=will_batch, pages=ocr_page_count)
            text = _extract_pdf_text_via_claude(tmp_path, filename, page_indices=page_indices)
            if not text and not is_mixed:
                update_job("failed", error="Could not extract text (Claude OCR returned nothing)")
                files_col.update_one({"_id": ObjectId(file_id_str)}, {"$set": {"ingest_status": "failed"}})
                emit("failed", error="Could not extract text from PDF")
                return

            if text:
                update_job("ingesting")
                emit_progress('ingesting')
                splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=20)
                ocr_splits = splitter.split_documents([
                    Document(page_content=text, metadata={"source": filename})
                ])
                if not ingest_chunks(ocr_splits, user_id, folder_path, filename, file_id_str, config_id_override=config_id):
                    if not is_mixed:
                        update_job("failed", error="Vector indexing failed")
                        files_col.update_one({"_id": ObjectId(file_id_str)}, {"$set": {"ingest_status": "failed"}})
                        emit("failed", error="Vector indexing failed")
                        return
                    logger.warning(
                        "Async ingest: OCR chunk index failed for mixed PDF | file=%s file_id=%s",
                        filename, file_id_str,
                    )
            elif is_mixed:
                logger.warning(
                    "Async ingest: OCR returned nothing for mixed PDF | file=%s file_id=%s pages=%s",
                    filename, file_id_str, page_indices,
                )

            # S3 best-effort: ingestion succeeded, so don't fail the job if S3 hiccups.
            storage_key = f"user_files/{user_id}/{file_id_str}/{filename}"
            try:
                s3_upload(tmp_path, storage_key, content_type=content_type)
            except Exception as e:
                logger.error("S3 upload failed in async worker | err=%s", e, exc_info=True)
                storage_key = None

            files_col.update_one(
                {"_id": ObjectId(file_id_str)},
                {"$set": {
                    "vector_ingested": True,
                    "ingest_status": "done",
                    "storage_key": storage_key,
                }},
            )
            update_job("done")
            emit("done")
        except Exception as e:
            logger.error("Async ingest crashed | job=%s err=%s", job_id_str, e, exc_info=True)
            try:
                jobs_col.update_one(
                    {"_id": ObjectId(job_id_str)},
                    {"$set": {"status": "failed", "error": str(e), "updated_at": time.time()}},
                )
                files_col.update_one({"_id": ObjectId(file_id_str)}, {"$set": {"ingest_status": "failed"}})
                emit("failed", error=str(e))
            except Exception:
                pass
        finally:
            _safe_unlink(tmp_path)


@user_files_bp.route('/files/jobs/<string:job_id>', methods=['GET'])
@jwt_required()
def get_upload_job(job_id):
    """Polling fallback for async upload jobs (socket push is the primary channel)."""
    user_id = get_jwt_identity()
    try:
        oid = ObjectId(job_id)
    except InvalidId:
        return jsonify({"message": "Invalid job id"}), 400
    job = current_app.config['MONGO_DB']['upload_jobs'].find_one({"_id": oid})
    if not job or job.get('user_id') != user_id:
        return jsonify({"message": "Job not found"}), 404
    job['_id'] = str(job['_id'])
    return jsonify({"job": job}), 200


@user_files_bp.route('/files/url', methods=['POST'])
@jwt_required()
def upload_url():
    """Ingest a URL into the user's library as a virtual 'file' record.

    Stored in user_files like a normal upload, except `source_url` is set
    instead of `storage_key` (no S3 round-trip — re-fetchable from the URL).
    """
    user_id = get_jwt_identity()
    body = request.get_json(silent=True) or {}
    url = (body.get('url') or '').strip()
    if not url:
        return jsonify({"message": "URL is required"}), 400
    if not url.startswith(('http://', 'https://')):
        return jsonify({"message": "URL must start with http:// or https://"}), 400

    folder_path = _normalize_path(body.get('folder_path', ''))
    config_id = body.get('config_id') or None

    try:
        documents, title = fetch_url_as_documents(url)
    except UnsafeURLError as e:
        return jsonify({"message": str(e)}), 400
    except Exception as e:
        current_app.logger.error(f"URL fetch failed for {url}: {e}")
        return jsonify({"message": "Failed to fetch URL"}), 502

    if not documents:
        return jsonify({"message": "Could not extract content from URL"}), 422

    display_name = (title or url)[:200]
    size_bytes = sum(len(d.page_content) for d in documents)

    db = current_app.config['MONGO_DB']
    files_col = db['user_files']
    doc = {
        "user_id": user_id,
        "folder_path": folder_path,
        "filename": display_name,
        "content_type": "text/html",
        "size_bytes": size_bytes,
        "uploaded_at": time.time(),
        "vector_ingested": False,
        "storage_key": None,
        "source_url": url,
        "is_url": True,
    }
    if config_id:
        doc["config_id"] = config_id
    file_id = files_col.insert_one(doc).inserted_id

    ok = process_user_url_and_create_vectors(
        documents=documents,
        user_id=user_id,
        folder_path=folder_path,
        filename=display_name,
        source_file_id=file_id,
        source_url=url,
        config_id_override=config_id,
    )
    if not ok:
        files_col.delete_one({"_id": file_id})
        return jsonify({"message": "Failed to ingest URL content"}), 500

    files_col.update_one({"_id": file_id}, {"$set": {"vector_ingested": True}})
    doc["_id"] = str(file_id)
    doc["vector_ingested"] = True
    return jsonify({"file": doc}), 201


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
    config_id = request.args.get('config_id')
    if config_id:
        query['config_id'] = config_id
    else:
        # Variant A: only return library files (no bot-scoped files)
        query['config_id'] = {'$exists': False}

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
# URL ingestion
# ---------------------------------------------------------------------------

@user_files_bp.route('/files/url', methods=['POST'])
@jwt_required()
def ingest_url():
    """Fetch a public URL, extract text, and ingest into the user's vector library."""
    from src.utils.web.fetch import fetch_url
    from langchain_core.documents import Document
    from langchain_text_splitters import RecursiveCharacterTextSplitter
    from langchain_mongodb.vectorstores import MongoDBAtlasVectorSearch

    user_id = get_jwt_identity()
    body = request.get_json(silent=True) or {}
    url = (body.get('url') or '').strip()
    folder_path = _normalize_path(body.get('folder_path', ''))
    config_id = body.get('config_id') or None

    if not url:
        return jsonify({"message": "url is required"}), 400

    text = fetch_url(url)
    if not text:
        return jsonify({"message": "Could not fetch or extract content from that URL"}), 422

    from urllib.parse import urlparse
    parsed = urlparse(url)
    display_name = (parsed.netloc + parsed.path).strip('/') or url

    db = current_app.config['MONGO_DB']
    files_col = db['user_files']

    doc_meta = {
        "user_id": user_id,
        "folder_path": folder_path,
        "filename": display_name,
        "content_type": "text/html",
        "size_bytes": len(text.encode()),
        "uploaded_at": time.time(),
        "vector_ingested": False,
        "storage_key": None,
        "source_url": url,
    }
    if config_id:
        doc_meta["config_id"] = config_id
    file_id = files_col.insert_one(doc_meta).inserted_id

    try:
        effective_config_id = config_id if config_id else f"user:{user_id}"
        doc = Document(page_content=text, metadata={
            "user_id": user_id,
            "config_id": effective_config_id,
            "owner_user_id": user_id,
            "scope": "config" if config_id else "user",
            "source_file_id": str(file_id),
            "folder_path": folder_path or '',
            "original_file": display_name,
            "source": url,
        })
        splits = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=20).split_documents([doc])
        if not splits:
            files_col.delete_one({"_id": file_id})
            return jsonify({"message": "No content extracted"}), 422

        MongoDBAtlasVectorSearch.from_documents(
            documents=splits,
            embedding=current_app.config['EMBEDDINGS'],
            collection=db['vector_collection'],
            index_name="vector",
        )
        files_col.update_one({"_id": file_id}, {"$set": {"vector_ingested": True}})
        doc_meta["_id"] = str(file_id)
        doc_meta["vector_ingested"] = True
        return jsonify({"file": doc_meta}), 201
    except Exception as e:
        files_col.delete_one({"_id": file_id})
        current_app.logger.error(f"URL ingest failed for {url}: {e}")
        return jsonify({"message": "Failed to ingest URL"}), 500


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

    config_id = request.args.get('config_id')
    folder_query = {"user_id": user_id}
    file_query = {"user_id": user_id}
    if config_id:
        folder_query['config_id'] = config_id
        file_query['config_id'] = config_id
    else:
        file_query['config_id'] = {'$exists': False}

    explicit = {
        d['path']
        for d in db['user_folders'].find(folder_query, {"path": 1})
    }
    implicit = set()
    for f in db['user_files'].find(file_query, {"folder_path": 1}):
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
