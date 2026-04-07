from pydantic import BaseModel, Field

PYTHON_ANALYZER_TOOL_NAME = "python_data_analyzer"

def get_python_analyzer_description() -> str:
    return """
    Use this tool to write and execute Python code to analyze CSV and Excel files.
    You have access to the 'pandas' library. 
    Write a script to load the file, clean the data, find the answer, and print() the result.
    If you get an error, read the traceback and rewrite the code to fix it.
    """

class PythonCodeInput(BaseModel):
    code: str = Field(..., description="Python code to execute. You MUST use print() to output the final answer so it can be captured.")