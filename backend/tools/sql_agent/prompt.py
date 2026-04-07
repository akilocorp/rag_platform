from pydantic import BaseModel, Field

SQL_AGENT_TOOL_NAME = "analytical_sql_agent"

def get_sql_agent_description() -> str:
    return """
    Use this tool to answer analytical, numerical, or aggregation questions 
    (e.g., "What is the total revenue?", "Give me the top 5 stocks", "Calculate the average").
    This tool queries a secure PostgreSQL database containing the user's tabular data.
    """

class SQLAgentInput(BaseModel):
    user_query: str = Field(..., description="The user's specific analytical question.")