from abc import ABC, abstractmethod
from typing import Any, Dict, Type
from pydantic import BaseModel

class BaseTool(ABC):
    """
    Abstract base class for all tools. 
    Enforces a strict schema and execution contract.
    """
    name: str
    description: str
    args_schema: Type[BaseModel]

    @abstractmethod
    def execute(self, input_data: BaseModel, context: Dict[str, Any]) -> str:
        """
        The actual tool logic.
        :param input_data: The validated Pydantic model containing the LLM's arguments.
        :param context: A dictionary containing config_id, user_id, db connections, etc.
        """
        pass

    def get_openai_tool_schema(self) -> Dict[str, Any]:
        """
        Automatically generates the raw JSON schema required by the OpenAI/Anthropic APIs.
        No LangChain required.
        """
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.args_schema.model_json_schema()
            }
        }