# @language  Python
# @updated   2026-09-02
# @changed   The professor's temperature now rides in `extra_body`. anthropic 1.x dropped the keyword
#            from `messages.stream()`, so passing it raised TypeError before the request was ever
#            sent — and the CLM bridge caught that and spoke an apology, so every voice turn on the
#            server failed identically while the same call worked from anywhere else.
#            Prior: New module. The lean voice turn: one Claude stream, no tools, no RAG, no markdown,
#            thinking off — so Hume EVI can start speaking on the first token instead of waiting
#            out a knowledge-base round trip. Carries per-session variables into the persona.
"""
Lean Claude turn for a live voice conversation.

The agentic runner (`src/agentic/agent_runner.py`) is the wrong shape for speech.
Each tool round is a second model round-trip *before the first token*, and Hume
cannot start speaking until that token arrives — a single knowledge-base search
pushes a spoken reply past four seconds, which is the whole reason voice felt
laggy. This module is the same Anthropic call with everything latency-shaped
stripped out: no tools, no tool loop, no chart/markdown/facilitator guidance,
thinking disabled, and a hard ceiling on reply length so a turn stays a turn.

Entry point: `stream_voice_response(...)`, a generator of plain text chunks.
`routes/audio_clm.py` re-emits them as OpenAI-shaped SSE deltas for Hume.
"""
import logging
import os
from typing import Any, Dict, Iterator, List

from src.utils.models import sampling_kwargs

logger = logging.getLogger(__name__)

# A spoken turn, not an essay. ~300 tokens is roughly 40 seconds of speech —
# enough for a real conversational answer, short enough that the model cannot
# monologue through somebody else's turn.
VOICE_MAX_TOKENS = 300

# Used only when the config names no model. Haiku has the fastest first token of
# the Claude family, which is the number that decides whether a voice call feels
# like a conversation.
DEFAULT_VOICE_MODEL = "claude-haiku-4-5"

# Models that think by default when `thinking` is omitted. Extended thinking runs
# to completion before the first token, so on these it has to be switched off
# explicitly or a spoken reply arrives seconds late. Every other current Claude
# model is already thinking-off unless asked.
_THINKING_ON_BY_DEFAULT = (
    "claude-opus-5",
    "claude-sonnet-5",
)

# Appended to every voice persona. The bot is not writing into a chat window —
# a text-to-speech voice reads this out, so markdown becomes noise and length
# becomes dead air. The XML-tag line also covers the one leak Anthropic documents
# for thinking-disabled requests.
VOICE_STYLE_GUIDE = """

--- HOW YOU SPEAK ---
You are in a live spoken conversation. Everything you say is read aloud by a
voice; the other person hears it, they do not read it.

- Never use markdown. No headings, asterisks, bullet points, numbered lists,
  code blocks, tables, or emoji. They are read out as gibberish.
- Keep each turn short. One to three sentences is normal. Never deliver a
  monologue or a list of points — say one thing and stop so they can answer.
- Write numbers, dates and abbreviations the way a person says them.
- No stage directions, no narrating your own tone, and never include internal
  or system XML tags in what you say.
- Interruptions and half-finished sentences are normal in speech. Roll with
  them rather than restarting your point from the top.
"""


def _persona_text(config: Dict[str, Any]) -> str:
    """The professor's own instructions, with legacy scaffolding stripped.

    Configs written before the `instructions` field only carry `prompt_template`
    — the full LangChain-wrapped string. Cut the `Context:` block and the
    boilerplate lead-in so the persona isn't spoken with template plumbing
    attached.
    """
    instructions = (config.get('instructions') or '').strip()
    if instructions:
        return instructions

    tmpl = (config.get('prompt_template') or '').strip()
    cut = tmpl.find('Context:')
    if cut >= 0:
        tmpl = tmpl[:cut].strip()
    marker = 'Follow these specific instructions:'
    if marker in tmpl:
        return tmpl.split(marker, 1)[1].strip()
    return tmpl


def _apply_variables(text: str, variables: Dict[str, str]) -> str:
    """Substitute `{{key}}` placeholders in the persona with session variables.

    Unmatched placeholders are left exactly as written rather than blanked — a
    professor testing the link sees `{{stance}}` come back and knows the variable
    never arrived, which is far easier to diagnose than a persona that silently
    lost half its brief.
    """
    for key, value in (variables or {}).items():
        text = text.replace('{{' + key + '}}', str(value))
    return text


def build_voice_system_prompt(config: Dict[str, Any], variables: Dict[str, str] = None) -> str:
    """Persona + per-session variables + spoken-register rules.

    Deliberately omits everything the agentic prompt adds — tool guidance,
    citation rules, chart syntax, the markdown nudge. None of it survives
    text-to-speech, and every line of it is prompt the model has to read before
    it can answer.

    Session variables are both substituted into the persona and listed verbatim
    underneath it. The listing is the safety net: a study can hand the bot a
    topic and a stance without the professor having written any placeholder.
    """
    bot_name = config.get('bot_name') or 'Assistant'
    persona = _apply_variables(_persona_text(config), variables)

    parts = [f"Your name is {bot_name}."]
    if persona:
        parts.append(persona)

    if variables:
        detail_lines = "\n".join(f"- {k}: {v}" for k, v in variables.items())
        parts.append(
            "--- THIS SESSION ---\n"
            "These values were set for this specific conversation. Treat them as\n"
            "binding, and never read them out as a list or mention that you were\n"
            "given them.\n" + detail_lines
        )

    return "\n\n".join(parts) + VOICE_STYLE_GUIDE


def _latency_kwargs(model: str) -> Dict[str, Any]:
    """Request options that exist purely to shorten time-to-first-token."""
    if (model or "").strip().lower().startswith(_THINKING_ON_BY_DEFAULT):
        return {"thinking": {"type": "disabled"}}
    return {}


def stream_voice_response(
    config: Dict[str, Any],
    user_input: str,
    history_messages: List[Dict[str, Any]],
    variables: Dict[str, str] = None,
) -> Iterator[str]:
    """Stream one spoken turn as plain text chunks.

    A single `messages.stream` call — no tool loop, so the first chunk is the
    model's genuine first token and Hume can begin speaking on it. Raises on a
    hard failure (missing key, missing SDK, dead stream); the caller decides
    what the student hears, since anything yielded here gets spoken aloud.
    """
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        raise RuntimeError("ANTHROPIC_API_KEY is not set on this server")

    import anthropic

    client = anthropic.Anthropic(api_key=api_key)
    model = config.get('model_name') or DEFAULT_VOICE_MODEL

    kwargs: Dict[str, Any] = {
        "model": model,
        # The persona is identical on every turn of a call, so caching it means
        # only the new utterance is billed and read from turn two onward.
        "system": [{
            "type": "text",
            "text": build_voice_system_prompt(config, variables),
            "cache_control": {"type": "ephemeral"},
        }],
        "messages": list(history_messages) + [{"role": "user", "content": user_input}],
        "max_tokens": VOICE_MAX_TOKENS,
    }
    kwargs.update(_latency_kwargs(model))
    kwargs.update(sampling_kwargs(model, config.get('temperature')))

    with client.messages.stream(**kwargs) as stream:
        for text in stream.text_stream:
            if text:
                yield text
