import os
import shutil
import base64
import logging
from flask import current_app
from langchain_community.document_loaders import Docx2txtLoader, PyPDFLoader, TextLoader
from langchain_core.documents import Document
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_openai import OpenAIEmbeddings

import time
from langchain_mongodb.vectorstores import MongoDBAtlasVectorSearch

from src.utils.loaders.pptx_loader import SimplePPTXLoader

logger = logging.getLogger(__name__)

# Claude PDF input limits (Anthropic spec)
CLAUDE_PDF_MAX_BYTES = 32 * 1024 * 1024
CLAUDE_PDF_MAX_PAGES = 100
CLAUDE_PDF_FALLBACK_MODEL = "claude-haiku-4-5-20251001"

# Anthropic Batch API: 50% off, but adds polling latency. Only worth using
# for jobs large enough that the savings outweigh the wait.
CLAUDE_BATCH_PAGE_THRESHOLD = 40
CLAUDE_BATCH_TIMEOUT_SECONDS = 600  # 10 min hard cap


def _extract_pdf_text_via_claude(pdf_path: str, filename: str, page_indices=None) -> str | None:
    """Fallback for scanned/image-only PDFs.

    Renders each page to a 150-DPI JPEG via PyMuPDF and sends them as image
    blocks to Claude Haiku for transcription. Cheaper than the raw `document`
    block because we control DPI + JPEG quality. If page_indices is given
    (0-based), only those pages are rendered — used for mixed PDFs where
    pypdf already extracted text from the rest. Returns the text, or None
    if the PDF exceeds limits, a dep/key is missing, or the call fails.
    Caller logs + treats None as a clean failure.
    """
    try:
        size = os.path.getsize(pdf_path)
        if size > CLAUDE_PDF_MAX_BYTES:
            logger.error(
                "Claude PDF fallback: file too large | file=%s size=%s max=%s",
                filename, size, CLAUDE_PDF_MAX_BYTES,
            )
            return None

        api_key = (
            current_app.config.get("ANTHROPIC_API_KEY")
            or os.environ.get("ANTHROPIC_API_KEY")
        )
        if not api_key:
            logger.error(
                "Claude PDF fallback: ANTHROPIC_API_KEY not configured | file=%s",
                filename,
            )
            return None

        try:
            import fitz  # PyMuPDF
        except ImportError:
            logger.error("Claude PDF fallback: pymupdf not installed | file=%s", filename)
            return None

        try:
            from anthropic import Anthropic
        except ImportError:
            logger.error(
                "Claude PDF fallback: anthropic SDK not installed | file=%s",
                filename,
            )
            return None

        mat = fitz.Matrix(150 / 72, 150 / 72)  # 150 DPI
        image_blocks = []
        with fitz.open(pdf_path) as pdf_doc:
            page_count = pdf_doc.page_count
            selected = list(page_indices) if page_indices is not None else list(range(page_count))
            if len(selected) > CLAUDE_PDF_MAX_PAGES:
                logger.error(
                    "Claude PDF fallback: too many pages | file=%s pages=%s max=%s",
                    filename, len(selected), CLAUDE_PDF_MAX_PAGES,
                )
                return None

            for i in selected:
                pix = pdf_doc[i].get_pixmap(matrix=mat, alpha=False)
                img_bytes = pix.tobytes("jpeg", jpg_quality=75)
                image_blocks.append({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": "image/jpeg",
                        "data": base64.b64encode(img_bytes).decode("ascii"),
                    },
                })

        content = [
            *image_blocks,
            {
                "type": "text",
                "text": (
                    "Extract every piece of text from this document, in reading order. "
                    "Preserve paragraph breaks, headings, and lists. Do not summarize, "
                    "rephrase, or add commentary. Return only the extracted text."
                ),
            },
        ]

        client = Anthropic(api_key=api_key)
        if len(selected) >= CLAUDE_BATCH_PAGE_THRESHOLD:
            logger.info(
                "Claude PDF fallback: using Batch API | file=%s pages=%d",
                filename, len(selected),
            )
            text, usage = _claude_via_batch(client, content, filename)
        else:
            msg = client.messages.create(
                model=CLAUDE_PDF_FALLBACK_MODEL,
                max_tokens=8192,
                messages=[{"role": "user", "content": content}],
            )
            text = "".join(b.text for b in msg.content if hasattr(b, "text"))
            usage = getattr(msg, "usage", None)

        if not text or not text.strip():
            logger.error("Claude PDF fallback: empty response | file=%s", filename)
            return None

        logger.info(
            "Claude PDF fallback OK | file=%s pages=%s chars=%d in_tokens=%s out_tokens=%s",
            filename, len(selected), len(text),
            getattr(usage, "input_tokens", "?") if usage else "?",
            getattr(usage, "output_tokens", "?") if usage else "?",
        )
        return text
    except Exception as e:
        logger.error(
            "Claude PDF fallback: API call crashed | file=%s err=%s",
            filename, e,
            exc_info=True,
        )
        return None


def _claude_via_batch(client, content, filename):
    """Submit a single-request Message Batch and poll until it ends.

    Returns (text, usage) on success, (None, None) on timeout / error /
    non-success result. Caller decides whether to treat None as a hard fail.
    """
    try:
        batch = client.messages.batches.create(
            requests=[{
                "custom_id": "ocr-1",
                "params": {
                    "model": CLAUDE_PDF_FALLBACK_MODEL,
                    "max_tokens": 8192,
                    "messages": [{"role": "user", "content": content}],
                },
            }],
        )
        logger.info("Claude batch submitted | file=%s batch=%s", filename, batch.id)

        start = time.time()
        deadline = start + CLAUDE_BATCH_TIMEOUT_SECONDS
        while True:
            b = client.messages.batches.retrieve(batch.id)
            if b.processing_status == "ended":
                break
            if time.time() > deadline:
                logger.error(
                    "Claude batch timed out | file=%s batch=%s elapsed=%ds",
                    filename, batch.id, int(time.time() - start),
                )
                try:
                    client.messages.batches.cancel(batch.id)
                except Exception:
                    pass
                return None, None
            time.sleep(5 if (time.time() - start) < 60 else 15)

        for result in client.messages.batches.results(batch.id):
            if result.result.type != "succeeded":
                logger.error(
                    "Claude batch result not succeeded | file=%s type=%s",
                    filename, result.result.type,
                )
                return None, None
            msg = result.result.message
            text = "".join(b.text for b in msg.content if hasattr(b, "text"))
            return text, getattr(msg, "usage", None)
        return None, None
    except Exception as e:
        logger.error(
            "Claude batch crashed | file=%s err=%s",
            filename, e,
            exc_info=True,
        )
        return None, None


def get_document_loader(file_path):
    """
    Returns the appropriate LangChain document loader based on the file extension.
    
    Args:
        file_path (str): The path to the file.

    Returns:
        A LangChain DocumentLoader instance or None if the file type is not supported.
    """
    MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB
    
    # Check file size
    size = os.path.getsize(file_path)
    if size > MAX_FILE_SIZE:
        logger.error(
            "get_document_loader: file too large | path=%s size=%s max=%s",
            file_path, size, MAX_FILE_SIZE,
        )
        return None
    
    _, file_extension = os.path.splitext(file_path)
    file_extension = file_extension.lower()
    
    # Mapping of file extensions to their respective loaders
    loader_map = {
        '.docx': Docx2txtLoader,
        '.pdf': PyPDFLoader,
        '.txt': TextLoader,
        '.md': TextLoader,
        '.pptx': SimplePPTXLoader,
    }


    loader_class = loader_map.get(file_extension)
    if loader_class:
        return loader_class(file_path=file_path)
    else:
        logger.error(
            "get_document_loader: unsupported extension | ext=%s path=%s known=%s",
            file_extension, file_path, sorted(loader_map.keys()),
        )
        return None
def handle_cleanup_error(func, path, exc_info):
    """
    Error handler for shutil.rmtree. Logs errors instead of raising them.
    """
    current_app.logger.error(f"Error during cleanup of {path}: {exc_info}")

def process_files_and_create_vector_store(temp_file_paths, user_id, collection_name, config_id):
    """
    Processes multiple uploaded documents, combines their content, creates a single 
    Chroma vector store, uploads it to S3, and cleans up local files.

    Args:
        temp_file_paths (list): A list of paths to the temporary uploaded files.
        user_id (str): The ID of the user.
        collection_name (str): The name for the ChromaDB collection.

    Returns:
        str: The S3 path to the created vector store, or None if an error occurs.
    """
    
    
    all_splits = []

    try:
        db = current_app.config['MONGO_DB']
        mongo_collection = db['vector_collection']

        # --- 1. Load and Split Documents from All Files ---
        for temp_file_path in temp_file_paths:
            loader = get_document_loader(temp_file_path)
            if not loader:
                continue

            current_app.logger.info(f"Loading document: {temp_file_path}")
            try:
                pages = loader.load()
                current_app.logger.info(f"Successfully loaded {len(pages)} pages from {temp_file_path}")
            except Exception as e:
                current_app.logger.error(f"Error loading document {temp_file_path}: {str(e)}")
                continue


            # Split the document and add its chunks to the master list
            recursive_splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=20)
            splits = recursive_splitter.split_documents(pages)
            for split in splits:
                split.metadata['user_id'] = user_id
                split.metadata['config_id'] = str(config_id) # Link chunk to the config
                split.metadata['collection_name'] = collection_name
                split.metadata['original_file'] = os.path.basename(temp_file_path)

            
            all_splits.extend(splits)
            current_app.logger.info(f"Processed {len(splits)} chunks from {os.path.basename(temp_file_path)}. First chunk content: {splits[0].page_content[:100] if splits else 'No chunks'}")

        if not all_splits:
            current_app.logger.error("No documents could be processed from the provided files.")
            return None

        # --- 2. Create a Single Vector Store from All Combined Splits ---
        current_app.logger.info(f"Inserting {len(all_splits)} document chunks into Atlas for collection '{collection_name}'")
        # Note: Ensure you have your OpenAI API key set in your environment for this to work
        embeddings = current_app.config['EMBEDDINGS']
        
        MongoDBAtlasVectorSearch.from_documents(
            documents=all_splits,
            embedding=embeddings,
            collection=mongo_collection,
            index_name="vector"
        )
        current_app.logger.info("Successfully inserted vectors into MongoDB Atlas.")
       
        # --- 3. Upload the Entire Vector Store Directory to S3 ---
        
       
    except Exception as e:
        current_app.logger.error(f"Error during vector store processing/upload: {e}")
        return None
        
    finally:
        for temp_file_path in temp_file_paths:
            if os.path.exists(temp_file_path):
                os.remove(temp_file_path)
                current_app.logger.info(f"Cleaned up temporary upload file: {temp_file_path}")


def extract_pdf_chunks_fast(temp_file_path, filename):
    """Fast synchronous extraction via pypdf (no Claude).

    Returns (chunks, page_count, image_only_pages). chunks may be [] if the
    PDF is scanned/image-only — caller decides whether to dispatch async OCR.
    image_only_pages is the 0-based indices of PDF pages with no extractable
    text (always [] for non-PDF files). Returns (None, 0, []) on hard error.
    """
    size_bytes = os.path.getsize(temp_file_path) if os.path.exists(temp_file_path) else -1
    ext = os.path.splitext(filename)[1].lower()
    logger.info(
        "Ingest START | file=%s ext=%s size=%s",
        filename, ext, size_bytes,
    )

    loader = get_document_loader(temp_file_path)
    if not loader:
        logger.error(
            "Ingest FAIL: no loader for file | file=%s ext=%s size=%s",
            filename, ext, size_bytes,
        )
        return None, 0, []

    try:
        pages = loader.load()
    except Exception as e:
        logger.error(
            "Ingest FAIL: loader.load() crashed | file=%s loader=%s err=%s",
            filename, type(loader).__name__, e,
            exc_info=True,
        )
        return None, 0, []

    logger.info("Ingest LOADED | file=%s pages=%d", filename, len(pages))

    image_only = []
    if ext == ".pdf":
        image_only = [
            i for i, p in enumerate(pages)
            if not (p.page_content or "").strip()
        ]

    splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=20)
    splits = splitter.split_documents(pages)
    return splits, len(pages), image_only


def ingest_chunks(splits, user_id, folder_path, filename, source_file_id, config_id_override=None):
    """Stamp metadata onto chunks and write them to the vector collection.

    Returns True on success, False on failure. Logs explicit error lines.
    """
    if not splits:
        return False
    try:
        effective_config_id = config_id_override if config_id_override else f"user:{user_id}"
        scope = 'config' if config_id_override else 'user'
        for split in splits:
            split.metadata['user_id'] = user_id
            split.metadata['config_id'] = effective_config_id
            split.metadata['owner_user_id'] = user_id
            split.metadata['scope'] = scope
            split.metadata['source_file_id'] = str(source_file_id)
            split.metadata['folder_path'] = folder_path or ''
            split.metadata['original_file'] = filename

        MongoDBAtlasVectorSearch.from_documents(
            documents=splits,
            embedding=current_app.config['EMBEDDINGS'],
            collection=current_app.config['MONGO_DB']['vector_collection'],
            index_name="vector",
        )
        logger.info(
            "Ingest OK | file=%s chunks=%d config_id=%s",
            filename, len(splits), effective_config_id,
        )
        return True
    except Exception as e:
        logger.error(
            "Ingest FAIL: vector write/embed crashed | file=%s chunks=%d err=%s",
            filename, len(splits), e,
            exc_info=True,
        )
        return False


def process_user_file_and_create_vectors(temp_file_path, user_id, folder_path, filename, source_file_id, config_id_override=None):
    """
    Synchronous orchestrator: pypdf → (Claude fallback if image-only PDF) → ingest.

    Kept for callers that want one-shot synchronous ingestion. The /api/files
    upload route uses extract_pdf_chunks_fast + ingest_chunks directly so it
    can branch into the async worker for slow Claude OCR cases.
    """
    try:
        ext = os.path.splitext(filename)[1].lower()
        splits, page_count, _ = extract_pdf_chunks_fast(temp_file_path, filename)
        if splits is None:
            return False  # hard error already logged

        if not splits and ext == ".pdf":
            logger.info(
                "Ingest FALLBACK: pypdf extracted no text, trying Claude PDF (sync) | file=%s pages=%d",
                filename, page_count,
            )
            extracted = _extract_pdf_text_via_claude(temp_file_path, filename)
            if extracted:
                splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=20)
                splits = splitter.split_documents([
                    Document(page_content=extracted, metadata={"source": filename})
                ])
                logger.info("Ingest FALLBACK: Claude produced %d chunks | file=%s", len(splits), filename)

        if not splits:
            logger.error(
                "Ingest FAIL: no chunks produced | file=%s pages=%d",
                filename, page_count,
            )
            return False

        return ingest_chunks(splits, user_id, folder_path, filename, source_file_id, config_id_override)
    except Exception as e:
        logger.error(
            "Ingest FAIL: unexpected error | file=%s err=%s",
            filename, e,
            exc_info=True,
        )
        return False


def process_user_url_and_create_vectors(documents, user_id, folder_path, filename, source_file_id, source_url, config_id_override=None):
    """
    Same shape as process_user_file_and_create_vectors but takes pre-loaded
    LangChain Documents (from a URL fetch) instead of a file path. No file
    cleanup needed — the caller never wrote to disk.
    """
    try:
        logger.info(
            "Ingest URL START | url=%s docs=%d user=%s config_override=%s",
            source_url, len(documents), user_id, config_id_override,
        )

        db = current_app.config['MONGO_DB']
        mongo_collection = db['vector_collection']

        splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=20)
        splits = splitter.split_documents(documents)
        if not splits:
            logger.error(
                "Ingest URL FAIL: no chunks produced | url=%s docs=%d "
                "(fetched documents but splitter found no text)",
                source_url, len(documents),
            )
            return False

        effective_config_id = config_id_override if config_id_override else f"user:{user_id}"
        scope = 'config' if config_id_override else 'user'
        for split in splits:
            split.metadata['user_id'] = user_id
            split.metadata['config_id'] = effective_config_id
            split.metadata['owner_user_id'] = user_id
            split.metadata['scope'] = scope
            split.metadata['source_file_id'] = str(source_file_id)
            split.metadata['folder_path'] = folder_path or ''
            split.metadata['original_file'] = filename
            split.metadata['source_url'] = source_url

        try:
            MongoDBAtlasVectorSearch.from_documents(
                documents=splits,
                embedding=current_app.config['EMBEDDINGS'],
                collection=mongo_collection,
                index_name="vector"
            )
        except Exception as e:
            logger.error(
                "Ingest URL FAIL: vector write/embed crashed | url=%s chunks=%d err=%s",
                source_url, len(splits), e,
                exc_info=True,
            )
            return False

        logger.info("Ingest URL OK | url=%s chunks=%d", source_url, len(splits))
        return True
    except Exception as e:
        logger.error(
            "Ingest URL FAIL: unexpected error | url=%s err=%s",
            source_url, e,
            exc_info=True,
        )
        return False