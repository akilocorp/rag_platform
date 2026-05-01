"""
Agentic chat runner — Claude tool-use loop.

Single entry point: `stream_agentic_response`. Yields dict events that the
chat_routes layer wraps in NDJSON for the browser.

Step 5 will wire this into `/api/chat/...` behind the `web_access` + Claude
branch. Step 6 teaches the frontend to render the new event types.
"""
import logging
import os
from typing import Any, Dict, Iterator, List

from src.agentic.constants import (
    DEFAULT_MAX_TOKENS,
    MAX_TOOL_ROUNDS,
    MAX_USES_PER_TOOL,
)
from src.agentic.registry import execute, get_tool_specs
from src.agentic.tools.base import ToolContext

logger = logging.getLogger(__name__)


def _build_system_prompt(config: Dict[str, Any], tool_names: set) -> str:
    """Compose system prompt: bot identity + user instructions + tool guidance.

    Falls back gracefully for legacy configs that only have `prompt_template`
    (the full wrapped string from `config_routes.py`) by stripping the
    `Context:` / `Question:` scaffolding.
    """
    bot_name = config.get('bot_name') or 'Assistant'
    instructions = (config.get('instructions') or '').strip()

    if not instructions:
        tmpl = (config.get('prompt_template') or '').strip()
        # Drop the legacy "Context: ..." block that was meant for the
        # LangChain template engine.
        cut = tmpl.find('Context:')
        if cut >= 0:
            tmpl = tmpl[:cut].strip()
        marker = 'Follow these specific instructions:'
        if marker in tmpl:
            instructions = tmpl.split(marker, 1)[1].strip()
        else:
            instructions = tmpl

    tool_lines = []
    if 'search_knowledge_base' in tool_names:
        tool_lines.append(
            "- search_knowledge_base: the user's uploaded documents. "
            "Try this FIRST when the question may be answered by their files."
        )
    if 'web_search' in tool_names:
        tool_lines.append(
            "- web_search: the public web. Use for current events, recent "
            "info, or topics outside the knowledge base."
        )
    if 'web_fetch' in tool_names:
        tool_lines.append(
            "- web_fetch: read a specific URL in detail. Use this whenever "
            "the user pastes a link, or to read a result from web_search."
        )

    tool_block = ''
    if tool_lines:
        tool_block = (
            "\n\nYou have access to these tools:\n"
            + "\n".join(tool_lines)
            + "\n\nCite sources inline by index, like [1] or [2], using the "
            "numbers shown in tool results. After your answer, list the "
            "sources used."
        )

    formatting_block = (
        "\n\nFormat your responses in Markdown so the chat UI can render "
        "them with visual hierarchy:\n"
        "- Use `## Heading` to title major sections, and `### Subheading` "
        "for sub-sections, when the answer is more than a couple of "
        "paragraphs.\n"
        "- Use **bold** for key terms or names the reader should not miss.\n"
        "- Use bulleted (`- `) or numbered (`1. `) lists for steps, options, "
        "or any itemized info — never write a wall of text where a list "
        "would read better.\n"
        "- Use `inline code` for filenames, identifiers, commands, and short "
        "literal strings.\n"
        "- Use fenced code blocks with a language tag (```python, ```bash, "
        "etc.) for multi-line code.\n"
        "- Use `> ` blockquotes for direct quotations from the user's "
        "documents or web sources.\n"
        "- Use Markdown tables when comparing items across attributes.\n"
        "Keep formatting purposeful — for short conversational replies "
        "(a sentence or two), plain prose is fine. Don't add headings to "
        "trivially short answers."
    )

    return f"You are {bot_name}, an AI assistant.\n\n{instructions}{tool_block}{formatting_block}"


def _to_dict(block) -> Dict[str, Any]:
    """Anthropic SDK returns pydantic models for content blocks.

    `client.messages.stream(...)` returns `ParsedTextBlock` (subclass of
    `TextBlock`) with a streaming-only `parsed_output` field. The SDK marks
    those fields with `__api_exclude__` but plain `model_dump()` ignores it,
    and feeding them back into the next round trips the API's strict input
    validation (`Extra inputs are not permitted`). Honor `__api_exclude__`.
    """
    if hasattr(block, 'model_dump'):
        exclude = getattr(block, '__api_exclude__', None)
        return block.model_dump(exclude=exclude) if exclude else block.model_dump()
    if isinstance(block, dict):
        return block
    return {"type": "text", "text": str(block)}


def stream_agentic_response(
    config: Dict[str, Any],
    user_input: str,
    history_messages: List[Dict[str, Any]],
    ctx: ToolContext,
) -> Iterator[Dict[str, Any]]:
    """
    Run a single agentic turn.

    Args:
      config: bot config doc (uses bot_name, instructions/prompt_template,
              model_name, web_access).
      user_input: the user's new message.
      history_messages: prior turns in Anthropic format
                       ([{role, content}, ...]). Step 5 builds these.
      ctx: per-request context handed to tools.

    Yields event dicts:
      {"type": "token", "data": "<text>"}
      {"type": "tool_use", "id": "<id>", "name": "<name>", "input": {...}}
      {"type": "tool_result", "id": "<id>", "name": "<name>",
                              "content": "<text>", "is_error": bool}
      {"type": "done", "stop_reason": "<reason>",
                       "assistant_blocks": [...full trace for persistence...]}

    `assistant_blocks` is the flattened sequence of every block produced
    during the turn (text + tool_use + tool_result), in order. Step 5 stores
    it on the AI message as `additional_kwargs.tool_trace`.
    """
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        yield {"type": "token", "data": "Anthropic API key is not configured on this server."}
        yield {"type": "done", "stop_reason": "error", "assistant_blocks": []}
        return

    try:
        import anthropic
    except ImportError:
        yield {"type": "token", "data": "anthropic SDK is not installed on this server."}
        yield {"type": "done", "stop_reason": "error", "assistant_blocks": []}
        return

    client = anthropic.Anthropic(api_key=api_key)
    model = config.get('model_name') or 'claude-sonnet-4-5'

    tool_specs = get_tool_specs(config)
    tool_names = {s['name'] for s in tool_specs}
    system_prompt = _build_system_prompt(config, tool_names)

    # Cache the system prompt + tool specs across turns in the same chat.
    system_param = [{
        "type": "text",
        "text": system_prompt,
        "cache_control": {"type": "ephemeral"},
    }]
    tools_param = None
    if tool_specs:
        # Attach cache_control to the last tool spec — covers the whole
        # tools block per Anthropic's caching rules.
        tools_param = [dict(s) for s in tool_specs]
        tools_param[-1] = {**tools_param[-1], "cache_control": {"type": "ephemeral"}}

    messages = list(history_messages)
    messages.append({"role": "user", "content": user_input})

    full_trace: List[Dict[str, Any]] = []
    final_stop_reason = "end_turn"
    # Per-turn use count per tool — enforced against MAX_USES_PER_TOOL below.
    tool_use_counts: Dict[str, int] = {}

    for round_idx in range(MAX_TOOL_ROUNDS):
        kwargs = {
            "model": model,
            "system": system_param,
            "messages": messages,
            "max_tokens": DEFAULT_MAX_TOKENS,
        }
        temp = config.get('temperature')
        if temp is not None:
            try:
                kwargs["temperature"] = float(temp)
            except (TypeError, ValueError):
                pass
        if tools_param:
            kwargs["tools"] = tools_param

        try:
            with client.messages.stream(**kwargs) as stream:
                for chunk in stream.text_stream:
                    if chunk:
                        yield {"type": "token", "data": chunk}
                final_message = stream.get_final_message()
        except Exception as e:
            logger.error("Anthropic stream failed (round %d): %s", round_idx, e, exc_info=True)
            yield {"type": "token", "data": f"\n\n[Connection error: {e}]"}
            yield {"type": "done", "stop_reason": "error", "assistant_blocks": full_trace}
            return

        assistant_blocks = [_to_dict(b) for b in final_message.content]
        full_trace.extend(assistant_blocks)
        messages.append({"role": "assistant", "content": assistant_blocks})

        final_stop_reason = final_message.stop_reason or "end_turn"
        if final_stop_reason != "tool_use":
            break

        tool_uses = [b for b in assistant_blocks if b.get("type") == "tool_use"]
        if not tool_uses:
            # Defensive: stop_reason said tool_use but no blocks present.
            break

        tool_result_blocks: List[Dict[str, Any]] = []
        for tu in tool_uses:
            tu_id = tu.get("id") or ""
            tu_name = tu.get("name") or ""
            tu_input = tu.get("input") or {}

            yield {
                "type": "tool_use",
                "id": tu_id,
                "name": tu_name,
                "input": tu_input,
            }

            # Enforce per-tool cap before invoking — return a synthetic error
            # so the model can recover (use a different tool / answer with
            # what it already has).
            cap = MAX_USES_PER_TOOL.get(tu_name)
            current = tool_use_counts.get(tu_name, 0)
            tool_use_counts[tu_name] = current + 1
            if cap is not None and current >= cap:
                content = (
                    f"Tool '{tu_name}' has reached its per-turn limit of {cap}. "
                    "Answer with what you already have or try a different tool."
                )
                is_error = True
            else:
                result = execute(tu_name, tu_input, ctx)
                content = result.get("content") or ""
                is_error = bool(result.get("is_error"))

            yield {
                "type": "tool_result",
                "id": tu_id,
                "name": tu_name,
                "content": content,
                "is_error": is_error,
            }

            tool_result_blocks.append({
                "type": "tool_result",
                "tool_use_id": tu_id,
                "content": content,
                "is_error": is_error,
            })

        full_trace.extend(tool_result_blocks)
        messages.append({"role": "user", "content": tool_result_blocks})
    else:
        # Loop exhausted without natural stop — let the user know.
        logger.warning("Agentic turn hit MAX_TOOL_ROUNDS=%d", MAX_TOOL_ROUNDS)
        yield {"type": "token", "data": "\n\n[Reached the tool-use limit for this turn.]"}
        final_stop_reason = "max_rounds"

    yield {
        "type": "done",
        "stop_reason": final_stop_reason,
        "assistant_blocks": full_trace,
    }
