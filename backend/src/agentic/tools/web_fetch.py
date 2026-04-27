"""
web_fetch — read a single URL via the shared fetch helper. Reuses the same
safety check (private IPs, loopback, cloud metadata) as URL ingestion.
"""
from .base import tool, ToolContext

INPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "url": {
            "type": "string",
            "description": "Full http(s) URL to fetch.",
        },
    },
    "required": ["url"],
}

# Cap the response size sent back into the model so a single fetch can't
# blow the context window.
MAX_RETURN_CHARS = 12000


def _enabled(config: dict) -> bool:
    return bool(config.get("web_access", True))


@tool(
    name="web_fetch",
    description=(
        "Fetch a URL and return its main text content. Use this when the user "
        "pastes a link, or to read a specific result from web_search in detail. "
        "Returns the page title, URL, and extracted content."
    ),
    input_schema=INPUT_SCHEMA,
    enabled_when=_enabled,
)
def web_fetch(inputs: dict, ctx: ToolContext) -> dict:
    url = (inputs.get("url") or "").strip()
    if not url:
        return {"content": "URL is required.", "is_error": True}

    from src.utils.web.fetch import fetch_url_as_documents, UnsafeURLError
    try:
        docs, title = fetch_url_as_documents(url)
    except UnsafeURLError as e:
        return {"content": str(e), "is_error": True}
    except Exception as e:
        return {"content": f"Fetch failed: {e}", "is_error": True}

    if not docs:
        return {"content": f"Could not extract content from {url}"}

    text = docs[0].page_content or ""
    if len(text) > MAX_RETURN_CHARS:
        text = text[:MAX_RETURN_CHARS] + "\n\n[... truncated ...]"

    header = f"Title: {title or url}\nURL: {url}\n\n"
    return {"content": header + text}
