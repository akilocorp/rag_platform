import io
import json
import logging
import pandas as pd
import openai
from sqlalchemy import create_engine
from flask import current_app

logger = logging.getLogger(__name__)

class DatasetExtractor:
    """
    Phase 2 of the In-Memory Pipeline.
    Uses LLMs to verify dataset headers, applies deterministic cleaning,
    and inserts the safe data into PostgreSQL.
    """

    @staticmethod
    def extract_and_store_sql(file_bytes: bytes, catalog_df: pd.DataFrame, row_previews: dict, config_id: str, user_id: str):
        """
        Takes the parsed in-memory Excel data, cleans it, and stores it in Postgres.
        """
        logger.info(f"Starting Phase 2: Extraction and Storage for config {config_id}")
        
        db = current_app.config['MONGO_DB']
        # You will need to add this Postgres URI to your .env / Flask config
        pg_engine_uri = current_app.config.get('POSTGRES_DB_URI', 'postgresql://user:pass@localhost:5432/rag_db')
        pg_engine = create_engine(pg_engine_uri)
        
        client = openai.OpenAI(api_key=current_app.config.get("OPENAI_API_KEY"))

        # Re-load the raw sheets into memory dict (super fast since it's from RAM bytes)
        raw_excel_dict = pd.read_excel(io.BytesIO(file_bytes), sheet_name=None, header=None)

        for _, row in catalog_df.iterrows():
            sheet_name = row['sheet_name']
            original_filename = row['original_filename']
            island_start_row = row['detected_start_row']
            preview_md = row_previews.get(sheet_name, "")

            # 1. Ask LLM to verify the dataset and find the exact header
            verification = DatasetExtractor._verify_dataset_schema(client, sheet_name, preview_md)
            
            if not verification.get("is_valid_dataset"):
                logger.info(f"LLM determined sheet '{sheet_name}' is not a valid dataset. Skipping SQL ingestion.")
                continue

            header_offset = verification.get("header_row_index", 0)
            
            # The absolute row index in the original sheet
            absolute_header_row = island_start_row + header_offset

            # 2. Extract the true dataset table
            raw_df = raw_excel_dict[sheet_name]
            table_df = raw_df.iloc[absolute_header_row:].copy()
            
            # Set the first row as the header
            table_df.columns = table_df.iloc[0]
            table_df = table_df[1:]
            table_df.reset_index(drop=True, inplace=True)

            # 3. Deterministic Data Cleaning
            clean_df = DatasetExtractor._clean_dataframe(table_df)

            # 4. PostgreSQL Insertion
            # Generate a safe, unique SQL table name
            safe_filename = "".join([c if c.isalnum() else "_" for c in original_filename]).lower()
            safe_sheetname = "".join([c if c.isalnum() else "_" for c in sheet_name]).lower()
            
            # Create the name and truncate it to the Postgres 63-character limit
            raw_table_name = f"table_{config_id}_{safe_filename}_{safe_sheetname}"
            table_name = raw_table_name[:63]

            try:
                # Insert into Postgres
                clean_df.to_sql(table_name, con=pg_engine, if_exists='replace', index=False)
                
                
                # Record the schema in MongoDB so the SQL Agent knows how to query it later
                db['sql_metadata'].update_one(
                    {"config_id": str(config_id), "table_name": table_name},
                    {"$set": {
                        "user_id": user_id, 
                        "original_file": original_filename,
                        "sheet_name": sheet_name,
                        "columns": list(clean_df.columns),
                        "row_count": len(clean_df)
                    }},
                    upsert=True
                )
                logger.info(f"✅ Successfully ingested '{sheet_name}' into Postgres table '{table_name}'")
            except Exception as e:
                logger.error(f"Failed to insert '{sheet_name}' into Postgres: {e}")

    @staticmethod
    def _verify_dataset_schema(client: openai.OpenAI, sheet_name: str, preview_md: str) -> dict:
        """
        Passes the markdown preview to gpt-4o-mini to identify the header row.
        """
        system_prompt = """
        You are a data engineering assistant. Look at the top 10 rows of this spreadsheet sheet.
        Determine if this contains a structured tabular dataset (rows and columns of data).
        If it does, identify the index (0-9) of the row that contains the column headers.
        
        Output strictly in this JSON format:
        {
            "is_valid_dataset": boolean,
            "header_row_index": integer
        }
        """
        
        try:
            response = client.chat.completions.create(
                model="gpt-4o-mini",
                temperature=0,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"Sheet Name: {sheet_name}\n\nPreview:\n{preview_md}"}
                ]
            )
            return json.loads(response.choices[0].message.content)
        except Exception as e:
            logger.error(f"LLM verification failed: {e}")
            return {"is_valid_dataset": False, "header_row_index": 0}

    @staticmethod
    def _clean_dataframe(df: pd.DataFrame) -> pd.DataFrame:
        """
        Deterministic, safe cleaning of messy business data.
        Strips currencies, fixes dates, and sanitizes headers for PostgreSQL.
        """
        # 1. Drop completely empty rows and columns
        df = df.dropna(how='all').dropna(axis=1, how='all')

        # 2. Sanitize Column Names for Postgres (lowercase, replace spaces with _, strip special chars)
        raw_cols = (
            df.columns.astype(str)
            .str.strip()
            .str.lower()
            .str.replace(r'[^a-z0-9_]', '_', regex=True)
            .str.replace(r'_+', '_', regex=True) # remove consecutive underscores
            .str.strip('_')
        )
        
        # Ensure no empty column names
        # Ensure no empty column names
        raw_cols = [f"col_{i}" if not str(c).strip() else c for i, c in enumerate(raw_cols)]
        new_cols = []
        seen = set()
        for col in raw_cols:
            base = col
            counter = 1
            # If we've seen this name before, append a number (e.g., total_1, total_2)
            while col in seen:
                col = f"{base}_{counter}"
                counter += 1
            seen.add(col)
            new_cols.append(col)
        df.columns = new_cols
        # 3. Clean Currency and Number strings
        for col in df.columns:
            if df[col].dtype == 'object':
                # If a column looks like "$1,000.50" or "€ 500", try to clean and cast it
                # We sample the first valid item to see if it contains digits
                sample = df[col].dropna().astype(str).str.strip().head(1)
                if not sample.empty and any(char.isdigit() for char in sample.iloc[0]):
                    try:
                        # Strip standard currency symbols and commas
                        cleaned_series = df[col].astype(str).str.replace(r'[$,£€]', '', regex=True).str.replace(',', '')
                        # Convert to numeric, setting errors='coerce' to turn un-parseable stuff into NaN
                        df[col] = pd.to_numeric(cleaned_series, errors='ignore')
                    except Exception:
                        pass # If it fails, keep it as an object/string

        return df