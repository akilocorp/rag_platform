"""
search_knowledge_base — vector search over the user's uploaded files.

Mirrors the existing chat_routes pre_filter logic so agentic and non-agentic
chats see the same chunks.
"""
from flask import current_app

from .base import tool, ToolContext

INPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "query": {
            "type": "string",
            "description": "What to search for. Be specific — paraphrase the user's question if needed.",
        },
        "top_k": {
            "type": "integer",
            "description": "Maximum passages to return (1-10).",
            "default": 5,
        },
    },
    "required": ["query"],
}


@tool(
    name="search_knowledge_base",
    description=(
        "Search the user's uploaded documents (PDFs, slides, notes, URLs they ingested) "
        "for relevant passages. Always try this FIRST when the question may be answered "
        "by the user's own materials. Returns numbered passages [1], [2]... that you "
        "can cite in your answer."
    ),
    input_schema=INPUT_SCHEMA,
)
def search_knowledge_base(inputs: dict, ctx: ToolContext) -> dict:
    query = (inputs.get("query") or "").strip()
    if not query:
        return {"content": "Empty query.", "is_error": True}
    try:
        top_k = max(1, min(10, int(inputs.get("top_k") or 5)))
    except (TypeError, ValueError):
        top_k = 5

    from langchain_mongodb.vectorstores import MongoDBAtlasVectorSearch

    vector_store = MongoDBAtlasVectorSearch(
        collection=current_app.config['MONGO_DB']['vector_collection'],
        embedding=current_app.config['EMBEDDINGS'],
        index_name="vector",
    )

    config_id_str = str(ctx.config_id)
    is_authenticated = bool(ctx.user_id and ctx.user_id != "anonymous")

    if ctx.variant == 'B':
        pre_filter = {"config_id": config_id_str}
    elif ctx.selected_file_ids and is_authenticated:
        pre_filter = {"$or": [
            {"config_id": config_id_str},
            {"source_file_id": {"$in": [str(x) for x in ctx.selected_file_ids]}},
        ]}
    else:
        config_ids = [config_id_str]
        if is_authenticated:
            config_ids.append(f"user:{ctx.user_id}")
        pre_filter = {"config_id": {"$in": config_ids}}

    docs = vector_store.similarity_search(query=query, k=top_k, pre_filter=pre_filter)

    if not docs:
        return {"content": "No matching passages in the knowledge base."}

    parts = []
    for i, d in enumerate(docs, 1):
        meta = d.metadata or {}
        src = meta.get('original_file') or meta.get('source_url') or meta.get('source') or 'unknown'
        slide = meta.get('slide_number')
        loc = f" (slide {slide})" if slide else ""
        parts.append(f"[{i}] {src}{loc}\n{d.page_content}")
    return {"content": "\n\n".join(parts)}
