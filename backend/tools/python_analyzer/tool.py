from typing import Any, Dict
import sys
import io
import traceback
from tools.base_tool import BaseTool

# Import our definitions from prompt.py
from tools.python_analyzer.prompt import (
    PYTHON_ANALYZER_TOOL_NAME, 
    get_python_analyzer_description, 
    PythonCodeInput
)

class PythonDataAnalyzerTool(BaseTool):
    name = PYTHON_ANALYZER_TOOL_NAME
    description = get_python_analyzer_description()
    args_schema = PythonCodeInput

    def execute(self, input_data: PythonCodeInput, context: Dict[str, Any]) -> str:
        # 1. Intercept standard output (print statements)
        old_stdout = sys.stdout
        redirected_output = sys.stdout = io.StringIO()
        
        try:
            # 2. Execute the LLM's raw Python code safely in an isolated namespace
            exec(input_data.code, {}, {})
            
            # 3. Grab whatever the LLM printed
            output = redirected_output.getvalue()
            
            if not output.strip():
                return "Code executed successfully, but nothing was printed. Please rewrite the code and use print() to output the result."
                
            return f"Code Output:\n{output}"
            
        except Exception as e:
            # 4. If the code crashes, return the exact Python traceback to the LLM so it can debug itself!
            error_msg = traceback.format_exc()
            return f"Python Execution Error:\n{error_msg}\nPlease rewrite the code to fix this error and try again."
            
        finally:
            # Always restore standard output so your Flask server doesn't break
            sys.stdout = old_stdout