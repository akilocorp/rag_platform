import os
import shutil
from flask import current_app
from langchain_community.document_loaders import Docx2txtLoader, PyPDFLoader, TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_openai import OpenAIEmbeddings

import time
from langchain_mongodb.vectorstores import MongoDBAtlasVectorSearch

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
    if os.path.getsize(file_path) > MAX_FILE_SIZE:
        current_app.logger.warning(f"File too large: {file_path}. Maximum size is 50MB.")
        return None
    
    _, file_extension = os.path.splitext(file_path)
    file_extension = file_extension.lower()
    
    # Mapping of file extensions to their respective loaders
    loader_map = {
        '.docx': Docx2txtLoader,
        '.pdf': PyPDFLoader,
        '.txt': TextLoader,
        '.md': TextLoader,
    }
    
    loader_class = loader_class = loader_map.get(file_extension)
    if loader_class:
        return loader_class(file_path=file_path)
    else:
        current_app.logger.warning(f"Unsupported file type: {file_extension}. Skipping file: {file_path}")
        return None
def handle_cleanup_error(func, path, exc_info):
    """
    Error handler for shutil.rmtree. Logs errors instead of raising them.
    """
    current_app.logger.error(f"Error during cleanup of {path}: {exc_info}")

import os
import pandas as pd
from sqlalchemy import create_engine
from flask import current_app
# Assuming get_document_loader, RecursiveCharacterTextSplitter, and MongoDBAtlasVectorSearch are imported above

def process_files_and_create_vector_store(temp_file_paths, user_id, collection_name, config_id):
    """
    Processes multiple uploaded documents, routes them based on file type, 
    stores structured data in SQL, and unstructured data in a Vector Store.

    Args:
        temp_file_paths (list): A list of paths to the temporary uploaded files.
        user_id (str): The ID of the user.
        collection_name (str): The name for the ChromaDB/MongoDB collection.

    Returns:
        bool: True if processing was successful, False otherwise.
    """
    
    all_splits = []
    
    # 1. Setup Database Connections
    # Vector DB (MongoDB Atlas)
    db = current_app.config['MONGO_DB']
    mongo_collection = db['vector_collection']
    
    # Relational DB (SQL) - Using SQLite for demonstration, replace with Postgres/MySQL URI in production
    sql_engine_uri = current_app.config.get('SQL_DB_URI', 'sqlite:///rag_structured_data.db')
    sql_engine = create_engine(sql_engine_uri)

    try:
        # --- 2. Route and Process Files ---
        for temp_file_path in temp_file_paths:
            file_extension = os.path.splitext(temp_file_path)[1].lower()
            file_basename = os.path.basename(temp_file_path)
            
           # ROUTE A: STRUCTURED DATA (CSV/Excel)
            if file_extension in ['.csv', '.xlsx', '.xls']:
                current_app.logger.info(f"Routing structured document: {temp_file_path}")
                try:
                    if file_extension == '.csv':
                        df = pd.read_csv(temp_file_path)
                    else:
                        df = pd.read_excel(temp_file_path)
                    
                    # 1. Send to SQL (For Math & Exact Lookups)
                    safe_filename = "".join([c if c.isalnum() else "_" for c in file_basename]).lower()
                    table_name = f"table_{config_id}_{safe_filename}"
                    df.to_sql(table_name, con=sql_engine, if_exists='replace', index=False)
                    
                    db['sql_metadata'].update_one(
                        {"config_id": str(config_id), "table_name": table_name},
                        {"$set": {"user_id": user_id, "original_file": file_basename}},
                        upsert=True
                    )

                    # 2. HYBRID UPGRADE: Send to Vector DB (For Summaries & Context)
                    # Convert the dataframe into a giant string so the LLM can "read" it
                    text_content = df.to_string()
                    
                    from langchain_core.documents import Document
                    doc = Document(page_content=text_content, metadata={"source": file_basename})
                    
                    # Chunk it up and add it to our vector list
                    recursive_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=100)
                    splits = recursive_splitter.split_documents([doc])
                    
                    for split in splits:
                        split.metadata['user_id'] = user_id
                        split.metadata['config_id'] = str(config_id)
                        split.metadata['collection_name'] = collection_name
                        split.metadata['original_file'] = file_basename
                    
                    all_splits.extend(splits)
                    
                except Exception as e:
                    current_app.logger.error(f"Error processing CSV/Excel {temp_file_path}: {str(e)}")
                
                # We continue to the next file since we manually chunked it above
                continue
            # ROUTE B: UNSTRUCTURED DATA (PDF, Word, TXT) -> Send to Vector Store
            else:
                current_app.logger.info(f"Routing unstructured document to Vector DB: {temp_file_path}")
                loader = get_document_loader(temp_file_path)
                if not loader:
                    current_app.logger.warning(f"No loader found for {file_basename}, skipping.")
                    continue 

                try:
                    pages = loader.load()
                    current_app.logger.info(f"Successfully loaded {len(pages)} pages from {temp_file_path}")
                except Exception as e:
                    current_app.logger.error(f"Error loading document {temp_file_path}: {str(e)}")
                    continue

                # Split the document
                recursive_splitter = RecursiveCharacterTextSplitter(chunk_size=500, chunk_overlap=20)
                splits = recursive_splitter.split_documents(pages)
                
                # Add Metadata
                for split in splits:
                    split.metadata['user_id'] = user_id
                    split.metadata['config_id'] = str(config_id) 
                    split.metadata['collection_name'] = collection_name
                    split.metadata['original_file'] = file_basename

                all_splits.extend(splits)
                current_app.logger.info(f"Processed {len(splits)} chunks from {file_basename}.")

        # --- 3. Execute Vector Store Insertion ---
        if all_splits:
            current_app.logger.info(f"Inserting {len(all_splits)} chunks into Atlas for collection '{collection_name}'")
            embeddings = current_app.config['EMBEDDINGS']
            
            MongoDBAtlasVectorSearch.from_documents(
                documents=all_splits,
                embedding=embeddings,
                collection=mongo_collection,
                index_name="vector"
            )
            current_app.logger.info("Successfully inserted vectors into MongoDB Atlas.")
        else:
            current_app.logger.info("No unstructured chunks to insert into Vector Store.")

        return True

    except Exception as e:
        current_app.logger.error(f"Error during document processing pipeline: {e}")
        return False
        
    finally:
        # --- 4. Cleanup ---
        for temp_file_path in temp_file_paths:
            if os.path.exists(temp_file_path):
                try:
                    os.remove(temp_file_path)
                    current_app.logger.info(f"Cleaned up temporary upload file: {temp_file_path}")
                except Exception as cleanup_error:
                    current_app.logger.error(f"Failed to clean up file {temp_file_path}: {cleanup_error}")