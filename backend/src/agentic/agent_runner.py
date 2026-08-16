# @language  Python
# @updated   2026-08-16
# @changed   render_widget tool support: when the tool is available the system prompt tells the bot to call
#            it inline (multiple per reply), and the loop emits an inline `facilitator` event at the tool's
#            stream position so the widget renders where it was called.
#            Prior: When the facilitator is on, the system prompt now tells the bot its answer may become an
#            interactive widget and that past widgets replay into history as bracketed content blocks — so a
#            follow-up about a widget's contents is answered instead of denied.
#            Prior: Added GROUNDING_GUIDE to the system prompt — the agentic path had no rule about a silent
#            knowledge base or a user asserting something the material contradicts, so wrong answers were
#            absorbed as fact. Prior: `temperature` gated by `accepts_temperature`.
"""
Agentic chat runner — Claude tool-use loop.

Single entry point: `stream_agentic_response`. Yields dict events that the
chat_routes layer wraps in NDJSON for the browser.

Step 5 will wire this into `/api/chat/...` behind the `web_access` + Claude
branch. Step 6 teaches the frontend to render the new event types.
"""
import logging
import os
import time
from typing import Any, Dict, Iterator, List

from src.agentic.constants import (
    DEFAULT_MAX_TOKENS,
    MAX_TOOL_ROUNDS,
    MAX_USES_PER_TOOL,
)
from src.agentic.registry import execute, get_tool_specs
from src.agentic.tools.base import ToolContext
from src.utils.models import accepts_temperature

logger = logging.getLogger(__name__)

# Transient API failures (overloaded / rate-limited / 5xx / dropped
# connection) are retried with exponential backoff before we surface
# anything to the user. Overloaded (HTTP 529) in particular means
# Anthropic's servers are momentarily busy and the request should just be
# retried.
STREAM_MAX_ATTEMPTS = 3
STREAM_BACKOFF_BASE_SECONDS = 1.0

# User-facing copy when retries are exhausted — never leak raw exception dicts.
BUSY_MESSAGE = (
    "⚠️ The assistant is experiencing high demand right now. "
    "Please try again in a moment."
)
GENERIC_ERROR_MESSAGE = (
    "⚠️ Something went wrong reaching the assistant. "
    "Please try again in a moment."
)


def _is_transient_error(exc: Exception) -> bool:
    """True when an Anthropic stream failure is worth retrying.

    Covers overloaded (529), rate limits (429), 5xx, and connection drops.
    We inspect status_code and the message text rather than importing the
    SDK's exception classes so this stays robust across SDK versions.
    """
    status = getattr(exc, "status_code", None)
    if status in (429, 500, 502, 503, 504, 529):
        return True
    text = str(exc).lower()
    return (
        "overloaded" in text
        or "rate limit" in text
        or "timeout" in text
        or "timed out" in text
        or "connection" in text
    )

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
    "Markdown table for exact figures and a chart for shape/trend.\n\n"
    "For a MATH function whose shape depends on parameters — where letting the "
    "reader drag a coefficient and watch the curve change would aid "
    "understanding (e.g. exponential bases, a line's slope/intercept, a "
    "parabola's coefficients, sine amplitude/frequency) — use the same `chart` "
    "block in its function form instead:\n"
    "```chart\n"
    '{"type":"line","title":"Exponential growth: y = b^x",'
    '"x_range":[-2,4],"params":[{"name":"b","min":1.1,"max":4,"default":2,"step":0.1}],'
    '"functions":[{"name":"y","expr":"b^x"}],"y_label":"y"}\n'
    "```\n"
    "Rules for the function form: `x_range` is [min,max]; `params` is a list of "
    "sliders {name,min,max,default,step} the user can drag; `functions` is one "
    "or more {name, expr} where `expr` is an explicit y = f(x) written in terms "
    "of x and the param names. Use standard operators (+ - * / ^) and functions "
    "(sin, cos, tan, exp, log, ln, sqrt, abs). Only explicit y = f(x) is "
    "supported — no implicit relations like x^2+y^2=9. Prefer this whenever a "
    "parameter is the point of the explanation."
)


# Grounding rules. The legacy prompt template carries an equivalent line
# ("If the context doesn't contain the answer, say so", config_routes.py), but the
# agentic path builds its system prompt from the professor's raw `instructions`
# and so had no grounding rule at all. Without it, a thin knowledge base leaves
# the user's own assertions as the only substantive material in context — and a
# wrong quiz answer gets absorbed and echoed back as established fact on every
# later turn. Always included: unlike CHART_GUIDE this must survive the
# facilitator being enabled.
GROUNDING_GUIDE = (
    "\n\nGrounding rules:\n"
    "- Answer from the knowledge base and the tools available to you. If they "
    "do not cover the question, say plainly that the material doesn't cover it "
    "rather than inventing an answer; you may then offer general knowledge only "
    "if you label it as outside the provided material.\n"
    "- A statement from the user is that user's claim, not a fact about the "
    "material. Never treat it as an established fact, never fold it into later "
    "answers as though it came from the knowledge base, and don't keep bringing "
    "it up in subsequent turns.\n"
    "- When the user asserts something the material contradicts — including a "
    "wrong answer to a question you asked — say directly that it is incorrect "
    "and give the correct answer with its source. Do not adopt it, and do not "
    "soften it into agreement."
)

# Only added when the facilitator is enabled. The facilitator post-pass silently
# turns your answer into an interactive widget (a chart, quiz, flashcard deck,
# table, timeline, mind map, or impact map) drawn from the content of your reply.
# Without telling the bot this, a follow-up like "what was the third data point?"
# got a flat denial that any widget existed. On read, past widgets are folded back
# into history as text (each widget's `to_transcript`), so the contents ARE in
# context — this just tells the bot to trust and use them.
FACILITATOR_AWARENESS = (
    "\n\nInteractive widgets:\n"
    "- An interactive study widget may be rendered from your answer and shown to "
    "the user below your text (a chart, quiz, flashcards, table, timeline, mind "
    "map, or map). Write your reply with the complete content it should hold.\n"
    "- Earlier widgets you produced appear in this conversation's history as "
    "bracketed '[... displayed to the user]' blocks listing their contents. Treat "
    "those as widgets you created: when the user asks about one, answer from that "
    "recorded content — never claim no widget was created."
)

# Used instead of FACILITATOR_AWARENESS when the `render_widget` tool is available:
# the bot now CREATES widgets deliberately by calling the tool, inline, and may call
# it several times in one reply (once per widget-worthy section). This is what makes
# widgets land between the paragraphs they illustrate rather than stacked at the end.
FACILITATOR_TOOL_GUIDE = (
    "\n\nInteractive widgets:\n"
    "- When a section of your reply would land better as an interactive element "
    "(a chart, quiz, flashcards, comparison table, timeline, mind map, or map), call "
    "the `render_widget` tool RIGHT AFTER that section — the widget appears inline, "
    "exactly where you call it.\n"
    "- You may call `render_widget` more than once in a single reply: once per "
    "widget-worthy section, as many as genuinely help (a few at most). Don't force one "
    "where plain prose is better, and don't restate the widget's contents in prose "
    "around it.\n"
    "- Earlier widgets you produced appear in this conversation's history as bracketed "
    "'[... displayed to the user]' blocks listing their contents. When the user asks "
    "about one, answer from that recorded content — never claim no widget was created."
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

    # When the facilitator is enabled it owns charts (rendered as an interactive
    # widget after the reply), so drop the inline ```chart guidance — otherwise
    # the bot draws one chart AND the facilitator draws another. The chart guide
    # covers both data charts and interactive function graphs (with sliders).
    fac = config.get('facilitator')
    facilitator_on = bool(isinstance(fac, dict) and fac.get('enabled'))
    chart_guide = '' if facilitator_on else CHART_GUIDE
    # When the render_widget tool is available the bot CREATES widgets itself, inline
    # (FACILITATOR_TOOL_GUIDE); otherwise the post-pass makes one from its answer and
    # we only tell it that widgets exist (FACILITATOR_AWARENESS).
    if 'render_widget' in tool_names:
        facilitator_guide = FACILITATOR_TOOL_GUIDE
    elif facilitator_on:
        facilitator_guide = FACILITATOR_AWARENESS
    else:
        facilitator_guide = ''

    return (
        f"You are {bot_name}, an AI assistant.\n\n"
        f"{instructions}{tool_block}{GROUNDING_GUIDE}{FORMATTING_GUIDE}{chart_guide}{facilitator_guide}"
    )


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
        # The newest Anthropic models reject `temperature` with a 400 rather than
        # ignoring it, so the professor's slider is dropped for those instead of
        # failing the turn.
        temp = config.get('temperature')
        if temp is not None and accepts_temperature(model):
            try:
                kwargs["temperature"] = float(temp)
            except (TypeError, ValueError):
                pass
        if tools_param:
            kwargs["tools"] = tools_param

        final_message = None
        for attempt in range(STREAM_MAX_ATTEMPTS):
            yielded_any = False
            try:
                with client.messages.stream(**kwargs) as stream:
                    for chunk in stream.text_stream:
                        if chunk:
                            yielded_any = True
                            yield {"type": "token", "data": chunk}
                    final_message = stream.get_final_message()
                break
            except Exception as e:
                last_attempt = attempt == STREAM_MAX_ATTEMPTS - 1
                # Once tokens have streamed to the user we can't cleanly retry
                # (we'd duplicate partial output), so only retry a transient
                # failure that hit before any text was emitted.
                retryable = _is_transient_error(e) and not yielded_any and not last_attempt
                logger.error(
                    "Anthropic stream failed (round %d, attempt %d/%d, retry=%s): %s",
                    round_idx, attempt + 1, STREAM_MAX_ATTEMPTS, retryable, e,
                    exc_info=True,
                )
                if retryable:
                    time.sleep(STREAM_BACKOFF_BASE_SECONDS * (2 ** attempt))
                    continue
                friendly = BUSY_MESSAGE if _is_transient_error(e) else GENERIC_ERROR_MESSAGE
                # Space it off from any partial text already streamed.
                prefix = "\n\n" if yielded_any else ""
                yield {"type": "token", "data": prefix + friendly}
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
            widget_payload = None
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
                # render_widget hands back a validated widget on its side channel.
                if tu_name == "render_widget" and not is_error:
                    wp = result.get("facilitator")
                    if isinstance(wp, dict) and wp.get("widget"):
                        widget_payload = wp

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

            # Emit the widget inline, right after its tool_result, so the client
            # renders it at this position between text segments. `id` is the
            # tool_use id — the join key the reload path uses to re-interleave.
            if widget_payload is not None:
                yield {
                    "type": "facilitator",
                    "id": tu_id,
                    "widget": widget_payload["widget"],
                    "data": widget_payload["data"],
                }

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
