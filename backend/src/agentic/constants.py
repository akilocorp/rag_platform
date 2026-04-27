"""
Agentic safety + budget constants.

Tweak these instead of editing the runner. Each value documents *why* the
cap exists so future devs can reason about whether to raise it.

Note: `BLOCKED_HOSTS` lives in `backend/src/utils/web/fetch.py` because that
helper is shared by URL ingestion (non-agentic) too — duplicating it here
would be drift-prone.
"""

# Hard cap on rounds of (model -> tool_use -> tool_result -> model) per turn.
# Each round is a full Anthropic round-trip, so this also bounds latency and
# cost per user message.
MAX_TOOL_ROUNDS = 8

# Per-tool cap on how many times a single tool can be invoked in one turn.
# Anything not listed here has no per-tool cap (only MAX_TOOL_ROUNDS applies).
# - web_search: each call hits Tavily ($$). 5 is plenty for a single answer.
# - web_fetch: cheap (no API cost) but slow + can blow context. 5 keeps it sane.
MAX_USES_PER_TOOL = {
    "web_search": 5,
    "web_fetch": 5,
}

# Anthropic max_tokens per stream round. 2048 covers synthesis + citations
# without burning tokens on rambling answers.
DEFAULT_MAX_TOKENS = 2048
