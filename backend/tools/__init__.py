from tools.vector_search_tool import VectorSearchTool
from tools.sql_agent.tool import SafeSQLAgentTool
from typing import List, Dict, Any

def get_all_tools() -> List:
    return [
        VectorSearchTool(),
        SafeSQLAgentTool() # <--- Your new Phase 3 Agent!
    ]

def get_tool_schemas() -> List[Dict[str, Any]]:
    return [tool.get_openai_tool_schema() for tool in get_all_tools()]

def execute_tool(tool_name: str, arguments: Dict[str, Any], context: Dict[str, Any]) -> str:
    for tool in get_all_tools():
        if tool.name == tool_name:
            validated_args = tool.args_schema(**arguments)
            return tool.execute(validated_args, context)
    return f"Error: Tool '{tool_name}' not found."