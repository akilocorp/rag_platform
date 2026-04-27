"""
web_search — Tavily-backed web search, gated on `web_access` and TAVILY_API_KEY.
"""
import os

from .base import tool, ToolContext

INPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "query": {
            "type": "string",
            "description": "Search query. Use natural-language phrasing.",
        },
        "max_results": {
            "type": "integer",
            "description": "Number of results (1-10).",
            "default": 5,
        },
    },
    "required": ["query"],
}


def _enabled(config: dict) -> bool:
    if not config.get("web_access", True):
        return False
    return bool(os.getenv("TAVILY_API_KEY"))


@tool(
    name="web_search",
    description=(
        "Search the public web (via Tavily). Use when the user's question is about "
        "current events, recent information, or topics outside the knowledge base. "
        "Returns numbered results [1], [2]... with title, URL, and content snippet — "
        "cite by number in your answer."
    ),
    input_schema=INPUT_SCHEMA,
    enabled_when=_enabled,
)
def web_search(inputs: dict, ctx: ToolContext) -> dict:
    query = (inputs.get("query") or "").strip()
    if not query:
        return {"content": "Empty query.", "is_error": True}
    try:
        max_results = max(1, min(10, int(inputs.get("max_results") or 5)))
    except (TypeError, ValueError):
        max_results = 5

    api_key = os.getenv("TAVILY_API_KEY")
    if not api_key:
        return {"content": "Web search is not configured on this server.", "is_error": True}

    try:
        from tavily import TavilyClient
    except ImportError:
        return {"content": "tavily-python is not installed on the server.", "is_error": True}

    try:
        client = TavilyClient(api_key=api_key)
        resp = client.search(query=query, max_results=max_results, search_depth="basic")
    except Exception as e:
        return {"content": f"Web search failed: {e}", "is_error": True}

    results = (resp or {}).get("results") or []
    if not results:
        return {"content": "No web results."}

    parts = []
    for i, r in enumerate(results, 1):
        title = r.get("title", "") or ""
        url = r.get("url", "") or ""
        content = (r.get("content", "") or "").strip()
        parts.append(f"[{i}] {title} — {url}\n{content}")
    return {"content": "\n\n".join(parts)}
