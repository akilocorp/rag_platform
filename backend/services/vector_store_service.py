import os
import shutil
import uuid
import json
import pandas as pd
import openai
from flask import current_app
from sqlalchemy import create_engine

from langchain_community.document_loaders import Docx2txtLoader, PyPDFLoader, TextLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_core.documents import Document
from langchain_mongodb.vectorstores import MongoDBAtlasVectorSearch


def get_document_loader(file_path):
    """
    Returns the appropriate LangChain document loader based on the file extension.
    Includes the 50MB file size limit check.
    """
    MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB
    
    if os.path.getsize(file_path) > MAX_FILE_SIZE:
        current_app.logger.warning(f"File too large: {file_path}. Maximum size is 50MB.")
        return None
    
    _, file_extension = os.path.splitext(file_path)
    file_extension = file_extension.lower()
    
    loader_map = {
        '.docx': Docx2txtLoader,
        '.pdf': PyPDFLoader,
        '.txt': TextLoader,
        '.md': TextLoader,
    }
    
    loader_class = loader_map.get(file_extension)
    if loader_class:
        return loader_class(file_path=file_path)
    else:
        current_app.logger.warning(f"Unsupported file type: {file_extension}. Skipping file: {file_path}")
        return None

def handle_cleanup_error(func, path, exc_info):
    """Error handler for shutil.rmtree. Logs errors instead of raising them."""
    current_app.logger.error(f"Error during cleanup of {path}: {exc_info}")


def generate_hypothetical_questions(client: openai.OpenAI, text: str) -> str:
    """Uses a fast model to generate questions this text answers for advanced HyDE retrieval."""
    try:
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            temperature=0,
            messages=[
                {"role": "system", "content": "Generate 3 highly specific questions that the following text perfectly answers. Output ONLY a valid JSON list of strings. No markdown formatting."},
                {"role": "user", "content": text}
            ]
        )
        raw_json = response.choices[0].message.content.replace("```json", "").replace("```", "").strip()
        questions = json.loads(raw_json)
        return " ".join(questions)
    except Exception as e:
        current_app.logger.error(f"Failed to generate hypothetical questions: {e}")
        return ""


def process_files_and_create_vector_store(temp_file_paths, user_id, collection_name, config_id):
    """
    Processes multiple uploaded documents, routes them based on file type, 
    stores structured data in SQL, and unstructured data in a Vector Store 
    using advanced Parent-Child and HyDE chunking.
    """
    all_splits = []
    
    # 1. Setup Database Connections
    db = current_app.config['MONGO_DB']
    mongo_collection = db['vector_collection']
    
    sql_engine_uri = current_app.config.get('SQL_DB_URI', 'sqlite:///rag_structured_data.db')
    sql_engine = create_engine(sql_engine_uri)
    
    # Setup OpenAI client for hypothetical questions
    openai_client = openai.OpenAI(api_key=current_app.config.get("OPENAI_API_KEY"))

    try:
        # --- 2. Route and Process Files ---
        for temp_file_path in temp_file_paths:
            file_extension = os.path.splitext(temp_file_path)[1].lower()
            file_basename = os.path.basename(temp_file_path)
            
            # ==========================================
            # ROUTE A: STRUCTURED DATA (CSV/Excel)
            # ==========================================
            if file_extension in ['.csv', '.xlsx', '.xls']:
                current_app.logger.info(f"Routing structured document: {temp_file_path}")
                try:
                    # 1. Load ALL sheets into a dictionary: {"SheetName": DataFrame}
                    if file_extension == '.csv':
                        dfs = {"Sheet1": pd.read_csv(temp_file_path)}
                    else:
                        # sheet_name=None forces pandas to read all sheets!
                        dfs = pd.read_excel(temp_file_path, sheet_name=None)
                    
                    # 2. Loop through every sheet and save it as its own table
                    for sheet_name, df in dfs.items():
                        safe_filename = "".join([c if c.isalnum() else "_" for c in file_basename]).lower()
                        safe_sheetname = "".join([c if c.isalnum() else "_" for c in str(sheet_name)]).lower()
                        table_name = f"table_{config_id}_{safe_filename}_{safe_sheetname}"
                        
                        # Send to SQL
                        df.to_sql(table_name, con=sql_engine, if_exists='replace', index=False)
                        
                        # ---> ADD THIS LINE <---
                        current_app.logger.info(f"✅ Successfully saved sheet '{sheet_name}' to SQL table '{table_name}'")
                        
                        # Save Metadata so the LLM knows which sheet is which
                        db['sql_metadata'].update_one(
                            {"config_id": str(config_id), "table_name": table_name},
                            {"$set": {
                                "user_id": user_id, 
                                "original_file": file_basename,
                                "sheet_name": str(sheet_name)
                            }},
                            upsert=True
                        )

                        # 3. HYBRID UPGRADE: Send this specific sheet to Vector DB for context
                        text_content = f"File: {file_basename} | Sheet: {sheet_name}\n" + df.to_string()
                        
                        doc = Document(page_content=text_content, metadata={"source": file_basename, "sheet": sheet_name})
                        recursive_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=100)
                        splits = recursive_splitter.split_documents([doc])
                        
                        for split in splits:
                            split.metadata.update({
                                'user_id': user_id,
                                'config_id': str(config_id),
                                'collection_name': collection_name,
                                'original_file': file_basename
                            })
                        
                        all_splits.extend(splits)
                        
                except Exception as e:
                    current_app.logger.error(f"Error processing CSV/Excel {temp_file_path}: {str(e)}")
                
                continue

            # ==========================================
            # ROUTE B: UNSTRUCTURED DATA (PDF, Word, TXT)
            # ==========================================
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

                # 1. Parent Splitter (Large context)
                parent_splitter = RecursiveCharacterTextSplitter(chunk_size=2000, chunk_overlap=200)
                parent_chunks = parent_splitter.split_documents(pages)
                
                # 2. Child Splitter (Precise search)
                child_splitter = RecursiveCharacterTextSplitter(chunk_size=400, chunk_overlap=50)

                for parent in parent_chunks:
                    parent_id = str(uuid.uuid4())
                    parent_text = parent.page_content
                    
                    child_chunks = child_splitter.split_text(parent_text)
                    
                    for child_text in child_chunks:
                        # Generate HyDE questions for this tiny chunk
                        questions = generate_hypothetical_questions(openai_client, child_text)
                        
                        # We put the questions and the child text into the page_content 
                        # so Langchain automatically embeds BOTH for maximum search accuracy!
                        search_optimized_content = f"Questions answered: {questions}\n\nContent: {child_text}"
                        
                        # We hide the massive parent chunk in the metadata so we can retrieve it later
                        child_doc = Document(
                            page_content=search_optimized_content,
                            metadata={
                                'user_id': user_id,
                                'config_id': str(config_id),
                                'collection_name': collection_name,
                                'original_file': file_basename,
                                'parent_id': parent_id,
                                'parent_content': parent_text # <--- The agent reads this later!
                            }
                        )
                        all_splits.append(child_doc)

                current_app.logger.info(f"Processed advanced Parent/Child chunks for {file_basename}.")

        # --- 3. Execute Vector Store Insertion ---
        if all_splits:
            current_app.logger.info(f"Inserting {len(all_splits)} chunks into Atlas for collection '{collection_name}'")
            
            # Langchain handles the actual embedding API calls perfectly here
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
        # Matches your exact cleanup logic
        for temp_file_path in temp_file_paths:
            if os.path.exists(temp_file_path):
                try:
                    os.remove(temp_file_path)
                    current_app.logger.info(f"Cleaned up temporary upload file: {temp_file_path}")
                except Exception as cleanup_error:
                    current_app.logger.error(f"Failed to clean up file {temp_file_path}: {cleanup_error}")