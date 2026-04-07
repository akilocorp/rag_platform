import json
import logging
import re
import openai
from typing import Any, Dict
from sqlalchemy import create_engine, text
from tools.base_tool import BaseTool
from flask import current_app

from tools.sql_agent.prompt import (
    SQL_AGENT_TOOL_NAME, 
    get_sql_agent_description, 
    SQLAgentInput
)

logger = logging.getLogger(__name__)

class SafeSQLAgentTool(BaseTool):
    name = SQL_AGENT_TOOL_NAME
    description = get_sql_agent_description()
    args_schema = SQLAgentInput

    def execute(self, input_data: SQLAgentInput, context: Dict[str, Any]) -> str:
        db = context.get("db")
        config_id = context.get("config_id")
        
        # 1. Fetch the Schema from MongoDB (Generated in Phase 2)
        tables = list(db['sql_metadata'].find({"config_id": str(config_id)}))
        if not tables:
            return "No structured data tables found for this configuration."

        schema_details = []
        table_names = []
        for t in tables:
            t_name = t['table_name']
            t_cols = ", ".join(t.get('columns', []))
            sheet = t.get('sheet_name', 'Unknown')
            schema_details.append(f"Table Name: {t_name} (Source Sheet: {sheet})\nColumns: {t_cols}")
            table_names.append(t_name)
            
        schema_str = "\n\n".join(schema_details)

        # 2. Setup Clients & Secure Postgres Engine
        client = openai.OpenAI(api_key=context.get("openai_api_key"))
        
        # SECURITY CRITICAL: This URI must use a read-only Postgres user role!
        pg_uri = current_app.config.get('POSTGRES_READONLY_URI') 
        engine = create_engine(pg_uri)

        # 3. The Reflection Loop (Max 3 Retries)
        max_retries = 3
        
        # Initialize conversation history for the "Internal SQL Coder"
        messages = [
            {"role": "system", "content": f"""You are an expert PostgreSQL data analyst. 
Given the following database schema, write a pure SQL query to answer the user's question.
Rules:
1. ONLY output the raw SQL query. No markdown, no ```sql wrappers, no explanations.
2. Only use SELECT statements.
3. Use exact table names and column names provided. Wrap column names in double quotes if they contain spaces or special characters.

Schema:
{schema_str}
"""},
            {"role": "user", "content": input_data.user_query}
        ]

        for attempt in range(max_retries):
            try:
                # Ask LLM for SQL
                response = client.chat.completions.create(
                    model="gpt-4o-mini", # Keep it fast and cheap
                    temperature=0,
                    messages=messages
                )
                
                raw_sql = response.choices[0].message.content.strip()
                # Clean accidental markdown if the LLM disobeys
                clean_sql = raw_sql.replace("```sql", "").replace("```", "").strip()

                # --- AST / REGEX SECURITY VALIDATOR ---
                if not self._is_safe_select_query(clean_sql):
                    raise ValueError("SECURITY ALERT: Query blocked. Only SELECT statements are allowed.")

                # Execute on Postgres
                with engine.connect() as conn:
                    result = conn.execute(text(clean_sql))
                    rows = result.fetchall()
                    
                    # Convert results to a readable string format
                    if not rows:
                        data_result = "Query executed successfully, but returned 0 rows."
                    else:
                        # Grab column headers from the result
                        keys = result.keys()
                        data_result = [dict(zip(keys, row)) for row in rows]

                # If we get here, the SQL worked! Now we summarize the raw data into natural language.
                summary = self._generate_final_summary(client, input_data.user_query, clean_sql, data_result)
                return summary

            except Exception as e:
                error_msg = str(e)
                logger.warning(f"SQL Attempt {attempt + 1} failed: {error_msg}")
                
                if attempt == max_retries - 1:
                    return f"Failed to query the database after {max_retries} attempts. Last error: {error_msg}"
                
                # REFLECTION: Feed the exact Postgres error back to the LLM so it can fix the syntax
                messages.append({"role": "assistant", "content": clean_sql})
                messages.append({"role": "user", "content": f"Execution Failed with error: {error_msg}\nRewrite the SQL query to fix this error."})

    def _is_safe_select_query(self, sql: str) -> bool:
        """
        Basic AST Validation. Checks that the query starts with SELECT and 
        does not contain destructive keywords. 
        """
        sql_upper = sql.upper().strip()
        
        # Must be a SELECT statement
        if not sql_upper.startswith("SELECT") and not sql_upper.startswith("WITH"):
            return False
            
        # Ban destructive commands and chained executions
        banned_keywords = [
            "INSERT ", "UPDATE ", "DELETE ", "DROP ", "ALTER ", 
            "TRUNCATE ", "EXEC ", "EXECUTE ", "GRANT ", "REVOKE ", ";"
        ]
        
        for keyword in banned_keywords:
            if keyword in sql_upper:
                # Allow semicolons ONLY if it's the very last character of the string
                if keyword == ";" and sql_upper.endswith(";") and sql_upper.count(";") == 1:
                    continue
                return False
                
        return True

    def _generate_final_summary(self, client: openai.OpenAI, query: str, sql: str, data: Any) -> str:
        """Translates the JSON/Tuple database results back into human language."""
        prompt = f"""
        The user asked: "{query}"
        The following data was retrieved from the database using this SQL: {sql}
        
        Data Result:
        {data}
        
        Formulate a clear, concise, and helpful response. 
        CRITICAL: You MUST include the exact numbers, values, or metrics from the Data Result in your answer. Do not hide the numbers!
        """
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            temperature=0.3,
            messages=[{"role": "system", "content": prompt}]
        )
        return response.choices[0].message.content