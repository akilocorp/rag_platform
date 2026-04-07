import os
import tempfile
from typing import List
from werkzeug.datastructures import FileStorage
from flask import current_app

from services.excel_parser import ExcelParser
# from services.dataset_extractor import DatasetExtractor # (Coming in Phase 2)
from services.vector_store_service import process_files_and_create_vector_store

class IngestionOrchestrator:
    """
    Traffic cop for all incoming files. 
    Routes tabular data to in-memory SQL/Hybrid processing.
    Routes unstructured data to secure temporary storage for Vector ingestion.
    """

    TABULAR_EXTENSIONS = {'.xlsx', '.xls', '.csv'}
    UNSTRUCTURED_EXTENSIONS = {'.pdf', '.docx', '.txt', '.md'}

    @staticmethod
    def process_uploaded_files(files: List[FileStorage], user_id: str, config_id: str, collection_name: str) -> List[str]:
        """
        Processes files securely. Returns a list of successfully processed filenames.
        """
        processed_filenames = []
        temp_unstructured_paths = []

        try:
            for file in files:
                if not file or not file.filename:
                    continue

                ext = os.path.splitext(file.filename)[1].lower()
                
                # ==========================================
                # ROUTE A: TABULAR DATA (In-Memory / Zero Disk I/O)
                # ==========================================
                if ext in IngestionOrchestrator.TABULAR_EXTENSIONS:
                    current_app.logger.info(f"[In-Memory] Processing tabular data: {file.filename}")
                    
                    # 1. Read bytes directly from RAM
                    file.seek(0)
                    file_bytes = file.read()
                    if not file_bytes:
                        current_app.logger.error(f"File {file.filename} is completely empty (0 bytes)!")
                        continue
                    
                    # 2. Phase 1: Parse Data Islands and get LLM Previews
                    try:
                        catalog_df, row_previews = ExcelParser.parse_in_memory(file_bytes, file.filename)
                        
                        from services.dataset_extractor import DatasetExtractor
                        DatasetExtractor.extract_and_store_sql(
                            file_bytes=file_bytes, 
                            catalog_df=catalog_df, 
                            row_previews=row_previews, 
                            config_id=config_id,
                            user_id=user_id
                        )
                        
                        processed_filenames.append(file.filename)
                    except Exception as e:
                        current_app.logger.error(f"Failed to process tabular file {file.filename}: {e}")

                # ==========================================
                # ROUTE B: UNSTRUCTURED DATA (PDF/Word)
                # ==========================================
                elif ext in IngestionOrchestrator.UNSTRUCTURED_EXTENSIONS:
                    current_app.logger.info(f"[Temp Storage] Processing unstructured data: {file.filename}")
                    
                    # Langchain PDF/Doc loaders require a physical file path.
                    # We use a secure NamedTemporaryFile which auto-deletes when closed, 
                    # completely eliminating the need for a persistent 'uploads/' folder!
                    temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=ext)
                    file.save(temp_file.name)
                    temp_unstructured_paths.append(temp_file.name)
                    processed_filenames.append(file.filename)

            # --- BATCH VECTOR STORE INGESTION ---
            if temp_unstructured_paths:
                process_files_and_create_vector_store(
                    temp_file_paths=temp_unstructured_paths,
                    user_id=user_id,
                    config_id=config_id,
                    collection_name=collection_name
                )

        finally:
            # Secure Cleanup: Ensure all temporary PDF/Doc files are wiped from disk
            for path in temp_unstructured_paths:
                if os.path.exists(path):
                    try:
                        os.remove(path)
                    except Exception as e:
                        current_app.logger.error(f"Failed to clean up temp file {path}: {e}")

        return processed_filenames