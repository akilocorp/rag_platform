import io
import pandas as pd
import os
import logging
from typing import Dict, Tuple, Any

logger = logging.getLogger(__name__)

class ExcelParser:
    """
    Handles secure, in-memory extraction of Excel files.
    Implements Data Island Detection to bypass junk formatting.
    """

    @staticmethod
    def parse_in_memory(file_stream: bytes, filename: str) -> Tuple[pd.DataFrame, Dict[str, str]]:
        """
        Reads an Excel file from RAM, catalogs its sheets, and previews the data islands.
        
        Args:
            file_stream: The raw bytes of the uploaded file.
            filename: The original name of the file.
            
        Returns:
            sheet_catalog_df: A DataFrame containing metadata about each sheet.
            row_previews: A dictionary mapping sheet names to Markdown string previews.
        """
        logger.info(f"Starting in-memory parsing for {filename}")
        ext = os.path.splitext(filename)[1].lower()
        
        try:
            if ext == '.csv':
                # CSVs don't have sheets, so we mock the dictionary structure
                raw_df = pd.read_csv(io.BytesIO(file_stream), header=None)
                excel_data = {"Sheet1": raw_df}
                
            elif ext == '.xlsx':
                # Explicitly tell pandas to use openpyxl for modern Excel
                excel_data = pd.read_excel(
                    io.BytesIO(file_stream), 
                    sheet_name=None, 
                    header=None, 
                    engine='openpyxl'
                )
            elif ext == '.xls':
                # Explicitly tell pandas to use xlrd for legacy Excel
                excel_data = pd.read_excel(
                    io.BytesIO(file_stream), 
                    sheet_name=None, 
                    header=None, 
                    engine='xlrd'
                )
            else:
                raise ValueError(f"Unsupported tabular extension: {ext}")
            # Load the entire Excel file into memory
            # sheet_name=None forces pandas to load all sheets into a dict
        except Exception as e:
            logger.error(f"Failed to read Excel stream: {e}")
            raise ValueError(f"Invalid or corrupted Excel file: {str(e)}")

        catalog_data = []
        row_previews = {}

        for sheet_name, raw_df in excel_data.items():
            # 1. Skip completely empty sheets
            if raw_df.empty or raw_df.isna().all().all():
                logger.warning(f"Skipping empty sheet: {sheet_name}")
                continue

            # 2. Data Island Detection
            start_row = ExcelParser._detect_data_island(raw_df)
            
            # Slice the dataframe to start at the detected island
            island_df = raw_df.iloc[start_row:].copy()
            island_df.reset_index(drop=True, inplace=True)
            
            # Calculate metrics
            total_rows, total_cols = island_df.shape
            non_null_density = island_df.notna().sum().sum() / (total_rows * total_cols) if total_rows > 0 else 0

            # 3. Build Catalog Metadata
            catalog_data.append({
                "sheet_name": sheet_name,
                "original_filename": filename,
                "detected_start_row": start_row, # The row index (0-based) where the table actually begins
                "total_rows": total_rows,
                "total_cols": total_cols,
                "data_density": round(non_null_density, 3)
            })

            # 4. Generate LLM Preview (Top 10 rows of the island)
            # We convert to markdown so the LLM can easily read it in Phase 2
            preview_df = island_df.head(10).fillna("")
            row_previews[sheet_name] = preview_df.to_markdown(index=False)

        sheet_catalog_df = pd.DataFrame(catalog_data)
        return sheet_catalog_df, row_previews

    @staticmethod
    def _detect_data_island(df: pd.DataFrame) -> int:
        """
        Adaptive Cell Sampling: Scans rows to find the start of the actual dataset.
        Bypasses title rows, empty rows, and merged headers.
        """
        # Count non-null values per row
        row_densities = df.notna().sum(axis=1)
        
        if row_densities.empty or row_densities.max() == 0:
            return 0
            
        max_density = row_densities.max()
        
        # Heuristic: The header row usually has a high density of populated cells.
        # We define a valid row as one containing at least 50% of the maximum column density,
        # or at least 2 populated columns (to bypass single-cell titles).
        threshold = max(2, max_density * 0.5)
        
        valid_rows = row_densities[row_densities >= threshold]
        
        if not valid_rows.empty:
            # The first row that meets the density threshold is our suspected header
            return valid_rows.index[0]
        else:
            # Fallback: Just find the first row with ANY data
            non_empty_rows = row_densities[row_densities > 0]
            return non_empty_rows.index[0] if not non_empty_rows.empty else 0