from pydantic import BaseModel, Field
from typing import Any, Dict
from tools.base_tool import BaseTool
import openai

class VectorSearchInput(BaseModel):
    query: str = Field(..., description="The highly specific search query to find in the unstructured documents.")

class VectorSearchTool(BaseTool):
    name = "search_unstructured_docs"
    description = "Use this tool to search the user's uploaded unstructured text documents, PDFs, and Word files."
    args_schema = VectorSearchInput

    def execute(self, input_data: VectorSearchInput, context: Dict[str, Any]) -> str:
        try:
            db = context.get("db")
            config_id = context.get("config_id")
            
            # 1. Embed the user's search query
            client = openai.OpenAI(api_key=context.get("openai_api_key"))
            response = client.embeddings.create(
                input=input_data.query,
                model="text-embedding-3-large"
            )
            query_vector = response.data[0].embedding

            # 2. Native MongoDB Atlas Vector Search
            results = db.vector_collection.aggregate([
                {
                    "$vectorSearch": {
                        "index": "vector", # Ensure you have an Atlas Vector Search Index named "vector"
                        "path": "embedding", 
                        "queryVector": query_vector,
                        "numCandidates": 100,
                        "limit": 5, # Grab top 5 children
                        "filter": {"metadata.config_id": {"$eq": str(config_id)}}
                    }
                },
                {
                    "$project": {
                        "parent_id": 1,
                        "parent_content": 1,
                        "score": {"$meta": "vectorSearchScore"}
                    }
                }
            ])

            # 3. Parent Deduplication (Small-to-Big Retrieval)
            # Multiple matching children might share the same parent chunk.
            # We only want to feed unique parents to the LLM to save tokens and prevent repetition.
            unique_parents = {}
            for doc in results:
                p_id = doc.get("parent_id")
                if p_id and p_id not in unique_parents:
                    unique_parents[p_id] = doc.get("parent_content", "")

            if not unique_parents:
                return "No relevant text documents found in the uploaded files."

            # 4. Construct the high-context RAG payload for the Agent
            context_string = "\n\n---\n\n".join(unique_parents.values())
            
            return f"Found the following comprehensive context blocks from the documents:\n\n{context_string}"

        except Exception as e:
            return f"Tool execution failed with error: {str(e)}"