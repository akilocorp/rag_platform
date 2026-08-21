# @language  Python
# @updated   2026-08-16
# @changed   Tightened the render_widget per-turn cap 5->3: a widget that keeps failing validation could
#            otherwise burn most of MAX_TOOL_ROUNDS invisibly (the thinking spinner froze for minutes).
#            Prior: Added a render_widget per-turn cap (5) so a bot can render several inline widgets without
#            running away against MAX_TOOL_ROUNDS.
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
    # render_widget: a few inline widgets per reply are the point, but each call
    # costs a tool round against MAX_TOOL_ROUNDS (8). Capped at 3 so a widget that
    # repeatedly fails validation can't quietly burn the whole turn (which showed
    # up as a "frozen thinking" spinner); 3 still covers any realistic reply and
    # leaves room for a couple of search rounds in the same turn.
    "render_widget": 3,
}

# Anthropic max_tokens per stream round. 2048 covers synthesis + citations
# without burning tokens on rambling answers.
DEFAULT_MAX_TOKENS = 2048
