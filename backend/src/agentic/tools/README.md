# Adding a tool

Drop a `.py` file in this folder. The registry auto-imports it on startup —
**no edits to `agent_runner.py`, `registry.py`, or this folder's `__init__.py`.**

## Template

```python
# my_tool.py
from .base import tool, ToolContext

INPUT_SCHEMA = {
    "type": "object",
    "properties": {
        "arg1": {"type": "string", "description": "What this argument is for."},
    },
    "required": ["arg1"],
}

@tool(
    name="my_tool",                                   # must be globally unique
    description="What it does and when the model should call it.",
    input_schema=INPUT_SCHEMA,
    enabled_when=lambda config: True,                 # optional, runs per-request
)
def my_tool(inputs: dict, ctx: ToolContext) -> dict:
    arg1 = inputs.get("arg1") or ""
    # ... do work ...
    return {"content": "result text"}
    # on error: return {"content": "explanation", "is_error": True}
```

That's it. Restart the server and the tool is live for every Claude bot
where `enabled_when(config)` returns truthy.

## Conventions

- **Names must be unique.** Collisions raise at import time — no silent overrides.
- **Return shape is always `{"content": str}`** (plus optional `"is_error": bool`).
  The runner wraps this in an Anthropic `tool_result` content block.
- **No I/O at import time.** Lazy-import optional deps inside the function so a
  missing package (e.g. `tavily-python`) doesn't break server startup; the tool
  just fails cleanly when called.
- **`ctx`** carries `user_id`, `config_id`, `config`, `variant`, `selected_file_ids`.
  Read what you need, ignore the rest. Adding a field is backward-compatible.
- **`enabled_when(config)`** decides whether the tool is exposed for *this*
  request. Use it to gate on `config["web_access"]`, env vars, model type, etc.
  Tools that aren't exposed never get called by the model — no need for
  defensive checks inside the function.
- **Files prefixed with `_`** are skipped by the auto-importer. Useful for
  shared helpers (e.g. `_helpers.py`) that aren't tools themselves.

## Files in this folder

| File | Purpose |
|---|---|
| `base.py` | `@tool` decorator, `ToolContext`, registry dict. Don't edit unless changing the contract. |
| `__init__.py` | Auto-discovers and imports every sibling. Don't edit. |
| `knowledge_base.py` | RAG search over the user's uploaded files. |
| `web_search.py` | Tavily web search. Gated on `TAVILY_API_KEY` env var. |
| `web_fetch.py` | Fetch a single URL. Reuses the safety check from `utils/web/fetch.py`. |
