import os
import shutil
import logging
from flask import current_app
from langchain_community.document_loaders import Docx2txtLoader, PyPDFLoader, TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_openai import OpenAIEmbeddings

import time
from langchain_mongodb.vectorstores import MongoDBAtlasVectorSearch

from src.utils.loaders.pptx_loader import SimplePPTXLoader

logger = logging.getLogger(__name__)

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
                continue  # Skip unsupported file types

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


def process_user_file_and_create_vectors(temp_file_path, user_id, folder_path, filename, source_file_id, config_id_override=None):
    """
    Ingests a single user-uploaded file into the personal-library namespace.

    Chunks are tagged with config_id = f"user:{user_id}" so the existing Atlas
    vector index (which filters on config_id) can serve both config-scoped and
    user-scoped retrieval without schema changes.

    The caller owns the tmp file lifecycle — this function does NOT delete it,
    so the caller can still ship the original to S3 after a successful ingest.
    """
    try:
        size_bytes = os.path.getsize(temp_file_path) if os.path.exists(temp_file_path) else -1
        ext = os.path.splitext(filename)[1].lower()
        logger.info(
            "Ingest START | file=%s ext=%s size=%s user=%s config_override=%s",
            filename, ext, size_bytes, user_id, config_id_override,
        )

        db = current_app.config['MONGO_DB']
        mongo_collection = db['vector_collection']

        loader = get_document_loader(temp_file_path)
        if not loader:
            logger.error(
                "Ingest FAIL: no loader for file | file=%s ext=%s size=%s "
                "(get_document_loader returned None — unsupported extension or file too large)",
                filename, ext, size_bytes,
            )
            return False

        try:
            pages = loader.load()
        except Exception as e:
            logger.error(
                "Ingest FAIL: loader.load() crashed | file=%s ext=%s size=%s loader=%s err=%s",
                filename, ext, size_bytes, type(loader).__name__, e,
                exc_info=True,
            )
            return False

        logger.info("Ingest LOADED | file=%s pages=%d", filename, len(pages))

        splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=20)
        splits = splitter.split_documents(pages)
        if not splits:
            logger.error(
                "Ingest FAIL: no chunks produced | file=%s pages=%d "
                "(loader returned pages but splitter found no text — likely a scanned/image-only PDF)",
                filename, len(pages),
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

        try:
            MongoDBAtlasVectorSearch.from_documents(
                documents=splits,
                embedding=current_app.config['EMBEDDINGS'],
                collection=mongo_collection,
                index_name="vector"
            )
        except Exception as e:
            logger.error(
                "Ingest FAIL: vector write/embed crashed | file=%s chunks=%d err=%s",
                filename, len(splits), e,
                exc_info=True,
            )
            return False

        logger.info("Ingest OK | file=%s chunks=%d config_id=%s", filename, len(splits), effective_config_id)
        return True
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