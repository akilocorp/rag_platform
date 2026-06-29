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

# Shared by the legacy LangChain path in chat_routes.py so every model
# (GPT/Gemini/Qwen/non-agentic Claude) formats replies the same way.
FORMATTING_GUIDE = (
    "\n\nFormat your responses using clean, premium Markdown typography:\n"
    "- Structure every substantive answer as named sections: write a "
    "`## Section Title`, then a blank line, then the body paragraph(s) "
    "for that section. If the answer covers multiple equally important "
    "topics or steps, give each one its own `## Section Title` + body "
    "block — never combine two distinct topics under a single heading.\n"
    "- For short conversational replies (one or two sentences), skip "
    "headings entirely — plain prose only.\n"
    "- Use **bold** sparingly, only for the single most critical term or "
    "figure in a sentence.\n"
    "- All mathematics — including single symbols, exponents, Greek "
    "letters, fractions, roots, sums, integrals, and operators — must be "
    "written in LaTeX. Wrap inline math in single `$...$` and standalone "
    "equations in `$$...$$` on their own line. Never use Unicode math "
    "characters such as ², ³, √, π, θ, ∞, ∑, ∫, ½, ≤, ≥, ×, ÷, ≠, ≈, "
    "→, ←, etc. — always use the LaTeX equivalent (e.g. write `$x^2$` "
    "not `x²`, `$\\sqrt{x}$` not `√x`, `$\\pi$` not `π`, `$\\frac{1}{2}$` "
    "not `½`).\n"
    "- Dollar amounts are plain text, never math: write $10/M, not wrapped "
    "in LaTeX delimiters.\n"
    "- Use bulleted (`- `) or numbered (`1. `) lists only for genuinely "
    "enumerable items. Do not bullet every sentence.\n"
    "- Use `inline code` for filenames, identifiers, and commands.\n"
    "- Use fenced code blocks with a language tag for multi-line code.\n"
    "- Use Markdown tables when comparing items across attributes.\n"
    "- Do not use emojis. The design is minimal and typographic — "
    "emphasis comes from structure and bold, not icons."
)


# Always available — the frontend renders ```chart blocks to inline SVG. Models
# only draw a chart when the context calls for it, so this is safe to include.
CHART_GUIDE = (
    "\n\nWhen a line or bar chart would make a quantitative point clearer "
    "(a path over time, or a comparison across categories), you may render one "
    "inline by emitting a fenced code block tagged `chart` whose body is a JSON "
    "object, for example:\n"
    "```chart\n"
    '{"type":"line","title":"Real GDP (% deviation from baseline)",'
    '"x":["Q1","Q2","Q3","Q4"],"series":[{"name":"Baseline",'
    '"values":[-0.6,-1.2,-1.6,-1.8]}],"unit":"%"}\n'
    "```\n"
    "Rules: `type` is \"line\" or \"bar\"; `x` is the array of time/category "
    "labels; `series` is one or more {name, values} with values aligned to `x`; "
    "`unit` is optional. Keep to 4 series or fewer. Use numbers grounded in the "
    "discussion or the knowledge base — never invent false precision. Use a "
    "Markdown table for exact figures and a chart for shape/trend."
)


# Always available — the frontend mounts ```desmos blocks as live, draggable
# Desmos calculators. Only emitted for genuine math questions, so safe to ship.
DESMOS_GUIDE = (
    "\n\nFor a pure-mathematics question where seeing the curve, line, or "
    "shape would genuinely aid understanding, embed a live, interactive "
    "Desmos graph inline — placed at the exact point in your explanation "
    "where the visual helps (right after you introduce the function or "
    "relationship), NOT tacked on at the end. Emit a fenced code block "
    "tagged `desmos` whose body is a JSON object, for example:\n"
    "```desmos\n"
    '{"expressions":["y=x^2","y=a x+1","a=1"],'
    '"bounds":{"left":-10,"right":10,"bottom":-10,"top":10}}\n'
    "```\n"
    "Rules: `expressions` is an array of Desmos/LaTeX expression strings "
    "(e.g. \"y=x^2\", \"y=\\\\sin(x)\", \"x^2+y^2=9\"). EVERY symbol other "
    "than x and y — coefficients AND exponents — must be given a numeric "
    "starting value on its own line, or the graph will error out and nothing "
    "will draw. An undefined exponent is the most common failure: to graph "
    "\"|x/a|^n+|y/b|^n=1\" you must include a, b, AND n (e.g. add \"a=3\", "
    "\"b=2\", \"n=4\") — defining a and b but leaving n undefined makes the "
    "whole relation undefined and the curve disappears. Desmos turns these "
    "definitions into draggable sliders, which is what makes the graph "
    "interactable, so prefer a parameterized form when it fits. `bounds` is "
    "optional {left,right,bottom,top}; omit it to let Desmos "
    "auto-fit. Only include a graph when it truly clarifies the math — skip it "
    "for arithmetic, proofs, or purely symbolic answers. Still explain the math "
    "in words and LaTeX; the graph supplements, it doesn't replace, the "
    "explanation."
)


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
            "numbers shown in tool results. Do NOT print your own list of "
            "sources at the end — the interface displays the sources used "
            "as clickable chips below your answer."
        )

    return f"You are {bot_name}, an AI assistant.\n\n{instructions}{tool_block}{FORMATTING_GUIDE}{CHART_GUIDE}{DESMOS_GUIDE}"


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
    images: List[Dict[str, Any]] = None,
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
    if images:
        user_content = list(images) + [{"type": "text", "text": user_input}]
        messages.append({"role": "user", "content": user_content})
    else:
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
