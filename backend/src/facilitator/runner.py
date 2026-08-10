# @language  Python
# @updated   2026-08-10
# @changed   The post-pass now receives the turn's source material (`context`) and is told to ground every
#            question and answer key in it — quizzes were written from the bot's prose alone, so on a thin
#            knowledge base they drifted off the material. Prior: FACILITATOR_MAX_TOKENS raised to 1500.
"""
The facilitator post-pass. `run_facilitator` wraps ANY bot's text reply with one
small Claude call: given the professor's facilitator instruction + the catalog of
allowed widgets (and any preset blocks), it decides which widget to render this
turn — or none — and returns a validated `{widget, data}` block.

Self-contained: builds its own Anthropic client (or accepts one) and does its own
JSON extraction, so it can be called from any route with no coupling.
"""
import json
import logging
import os
import re

from src.facilitator import registry

logger = logging.getLogger(__name__)

FACILITATOR_MODEL = os.getenv("FACILITATOR_MODEL", "claude-sonnet-4-6")
# Headroom for the largest widget payload (a 20-card flashcard deck of JSON);
# too low and a big deck's JSON is truncated mid-object, fails to parse, and the
# whole widget is dropped back to plain text.
FACILITATOR_MAX_TOKENS = 1500
_HISTORY_TURNS = 6
# Cap on the source material passed in. Generous enough for a legacy turn's k=3/k=5
# passages or a couple of tool results, small enough that the post-pass stays cheap.
_MAX_CONTEXT_CHARS = 6000


def _get_client():
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        return None
    try:
        import anthropic
    except ImportError:
        return None
    try:
        return anthropic.Anthropic(api_key=api_key)
    except Exception:  # noqa: BLE001
        return None


def _text_from_message(msg):
    parts = []
    for block in (getattr(msg, "content", None) or []):
        if getattr(block, "type", None) == "text":
            parts.append(block.text)
    return "".join(parts).strip()


def _extract_json(raw):
    if not raw:
        return None
    s = raw.strip()
    fence = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", s)
    if fence:
        s = fence.group(1)
    else:
        brace = re.search(r"\{[\s\S]*\}", s)
        if brace:
            s = brace.group(0)
    try:
        return json.loads(s)
    except (ValueError, TypeError):
        return None


def _build_system(cfg, catalog, has_context=False):
    lines = [
        "You are a FACILITATOR. After an assistant replies to a user, you decide whether that "
        "reply should be accompanied by an interactive UI widget, and if so you produce the "
        "widget's data. You do NOT rewrite or answer for the assistant — you only surface a widget "
        "when it genuinely helps the user act on this turn.",
    ]
    # Without this the widget is written from the assistant's prose alone — one hop
    # from the documents — so on a thin knowledge base the questions drift off the
    # material and any answer key is guessed from the model's own memory.
    if has_context:
        lines.append(
            "\nYou are given the source material the assistant drew on. Ground the widget in it: "
            "every question, label, figure and answer key must be supported by that material or by "
            "the assistant's reply. Never invent facts to fill a widget, and never write a question "
            "the material cannot answer — if the material is too thin to support one, return "
            '"widget": null instead.'
        )
    instruction = (cfg.get("instruction") or "").strip()
    if instruction:
        lines.append("\nThe author configured what you should do:\n" + instruction)

    lines.append("\nAvailable widgets — choose AT MOST one:")
    for w in catalog:
        lines.append(f"\n- id: \"{w['id']}\" — {w['label']}")
        lines.append(f"  when to use: {w['when_to_use']}")
        lines.append(f"  data shape: {json.dumps(w['data_schema'])}")

    presets = [p for p in (cfg.get("presets") or []) if isinstance(p, dict) and p.get("widget")]
    if presets:
        lines.append(
            "\nPreferred ready-made blocks — if one CLEANLY fits this turn, return it VERBATIM "
            "instead of generating a new one:"
        )
        for p in presets:
            when = (p.get("when") or "").strip()
            block = {"widget": p.get("widget"), "data": p.get("data")}
            lines.append(f"- {json.dumps(block)}" + (f"   (use when: {when})" if when else ""))

    lines.append(
        "\nReturn ONLY a JSON object, no prose:\n"
        '{ "widget": "<widget id, or null>", "data": { ...fields matching that widget\'s data shape... } }\n'
        'Set "widget": null when this turn does NOT call for a widget (a plain informational reply, '
        "nothing for the user to pick or act on). Never force a widget where it does not fit. "
        "Output ONLY the JSON object."
    )
    return "\n".join(lines)


def _clean_context(context):
    """Normalize the caller's source material into a single capped string.

    Accepts a plain string (the legacy path's retrieved passages) or a list of
    strings (the agentic path's tool results, one entry per call).
    """
    if isinstance(context, (list, tuple)):
        context = "\n\n---\n\n".join(str(c).strip() for c in context if str(c).strip())
    text = str(context or "").strip()
    if len(text) > _MAX_CONTEXT_CHARS:
        text = text[:_MAX_CONTEXT_CHARS].rstrip() + "\n…(truncated)"
    return text


def _build_user(bot_reply, history, context=None):
    parts = []
    if isinstance(history, list) and history:
        rows = []
        for h in history[-_HISTORY_TURNS:]:
            if not isinstance(h, dict):
                continue
            role = (h.get("role") or "").strip() or "user"
            content = (h.get("content") or "").strip()
            if content:
                rows.append(f"{role}: {content[:600]}")
        if rows:
            parts.append("Recent conversation:\n" + "\n".join(rows))
    # Before the reply, so the model reads the evidence and then what was made of it.
    source = _clean_context(context)
    if source:
        parts.append("Source material the assistant drew on this turn:\n" + source)
    parts.append("The assistant just replied:\n" + (bot_reply or "").strip())
    parts.append("Decide the widget (or null) and return ONLY the JSON object.")
    return "\n\n".join(parts)


def run_facilitator(bot_reply, history=None, facilitator_cfg=None, client=None,
                    context=None):
    """Return a validated {widget, data} block, or None (pass-through / disabled).

    `context` is the source material behind this turn — the retrieved passages on
    the legacy path, or the turn's tool results on the agentic one. Optional, but
    without it the widget is built from the assistant's prose alone.

    Never raises — any failure degrades to None so a chat turn is unaffected.
    """
    cfg = facilitator_cfg if isinstance(facilitator_cfg, dict) else {}
    if not cfg.get("enabled"):
        return None
    if not (bot_reply or "").strip():
        return None

    allowed = cfg.get("allowedWidgets")
    allowed = allowed if isinstance(allowed, list) and allowed else None
    catalog = registry.get_catalog(allowed)
    if not catalog:
        return None

    client = client or _get_client()
    if client is None:
        return None

    source = _clean_context(context)
    try:
        msg = client.messages.create(
            model=FACILITATOR_MODEL,
            max_tokens=FACILITATOR_MAX_TOKENS,
            system=_build_system(cfg, catalog, has_context=bool(source)),
            messages=[{
                "role": "user",
                "content": _build_user(bot_reply, history, source),
            }],
        )
    except Exception:  # noqa: BLE001
        logger.exception("facilitator model call failed")
        return None

    parsed = _extract_json(_text_from_message(msg))
    if not isinstance(parsed, dict):
        return None

    widget_id = parsed.get("widget")
    if widget_id in (None, "", "null", "none"):
        return None
    widget_id = str(widget_id)

    # Respect the allow-list even if the model ignores it.
    if allowed and widget_id not in allowed:
        return None

    cleaned = registry.validate(widget_id, parsed.get("data"))
    if cleaned is None:
        return None
    return {"widget": widget_id, "data": cleaned}
