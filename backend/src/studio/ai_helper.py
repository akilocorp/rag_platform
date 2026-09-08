# @language  Python
# @updated   2026-09-08
# @changed   New file: shared Claude call helper for AI-native Studio instruments. Factored out of
#            the individual instrument files since 5 of them (2 results-time graders, 3 live
#            in-session ones) all need the same api-key lookup + lazy import + error handling —
#            mirrors src/utils/vector_stores/store_vector_stores.py's Claude PDF fallback pattern,
#            just shared instead of duplicated per instrument.
"""Shared Claude call helper for AI-native Studio instruments."""
import logging
import os

from flask import current_app

logger = logging.getLogger(__name__)

# Haiku: cheap and fast, plenty for short scoring/generation tasks like these
# (a 1-5 rubric score, a one-sentence rebuttal) — same cost-conscious choice
# already made for PDF OCR elsewhere in this codebase.
STUDIO_AI_MODEL = "claude-haiku-4-5-20251001"
STUDIO_AI_MAX_TOKENS = 300


def call_claude(system, user_content, max_tokens=STUDIO_AI_MAX_TOKENS):
    """Returns the model's text reply, or None on any failure (missing key,
    missing package, API error, empty reply).

    Callers treat None as "skip this metric/feature," never as something to
    raise on — Studio's public surfaces must never 500 just because an AI
    instrument's call failed.
    """
    api_key = (
        current_app.config.get("ANTHROPIC_API_KEY")
        or os.environ.get("ANTHROPIC_API_KEY")
    )
    if not api_key:
        return None

    try:
        from anthropic import Anthropic
    except ImportError:
        logger.warning("Studio AI call skipped: anthropic SDK not installed")
        return None

    try:
        client = Anthropic(api_key=api_key)
        resp = client.messages.create(
            model=STUDIO_AI_MODEL,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user_content}],
        )
        text = "".join(
            block.text for block in resp.content if getattr(block, "type", None) == "text"
        ).strip()
        return text or None
    except Exception:
        logger.warning("Studio AI call failed", exc_info=True)
        return None
