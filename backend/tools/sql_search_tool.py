from pydantic import BaseModel, Field
from typing import Any, Dict
from tools.base_tool import BaseTool
from sqlalchemy import create_engine, text
import openai

class SQLSearchInput(BaseModel):
    query: str = Field(..., description="The natural language question to ask the structured database.")

class SQLSearchTool(BaseTool):
    name = "search_structured_data"
    description = "Use this tool to search structured data, spreadsheets, Excel files, CSVs, and exact numbers/math."
    args_schema = SQLSearchInput

    def execute(self, input_data: SQLSearchInput, context: Dict[str, Any]) -> str:
        try:
            db = context.get("db")
            config_id = context.get("config_id")
            sql_uri = context.get("sql_uri")
            
            # 1. Check if tables exist for this config
            tables = list(db['sql_metadata'].find({"config_id": str(config_id)}))
            if not tables:
                return "No spreadsheets or structured data available for this configuration."
            
            table_names = [t['table_name'] for t in tables]
            
            # 2. Extract Schema using raw SQLAlchemy
            engine = create_engine(sql_uri)
            schema_info = []
            with engine.connect() as conn:
                for table in table_names:
                    # Very basic schema extraction for SQLite
                    # For Postgres, query information_schema.columns
                    res = conn.execute(text(f"PRAGMA table_info({table});"))
                    columns = [row[1] + " (" + row[2] + ")" for row in res.fetchall()]
                    schema_info.append(f"Table: {table}\nColumns: {', '.join(columns)}")
            
            schema_str = "\n\n".join(schema_info)

            # 3. Use raw OpenAI to write the SQL
            client = openai.OpenAI(api_key=context.get("openai_api_key"))
            sql_response = client.chat.completions.create(
                model="gpt-4o-mini",
                temperature=0,
                messages=[
                    {"role": "system", "content": "You are a SQL expert. Given a schema, output ONLY valid SQL. No markdown, no explanation."},
                    {"role": "user", "content": f"Schema:\n{schema_str}\n\nQuestion: {input_data.query}"}
                ]
            )
            
            clean_sql = sql_response.choices[0].message.content.strip().replace("```sql", "").replace("```", "")

            # 4. Execute the SQL safely
            with engine.connect() as conn:
                result = conn.execute(text(clean_sql))
                rows = result.fetchall()
                
            return f"Executed SQL: {clean_sql}\nDatabase Result: {rows}"

        except Exception as e:
            return f"Error executing SQL: {str(e)}"