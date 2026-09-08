# @language  Python
# @updated   2026-09-08
# @changed   New file: dispatcher for Tier-3 live, mid-session AI calls (Comprehension-Paraphrase
#            Check, AI Devil's-Advocate, Adaptive Follow-Up Probe). Deliberately separate from the
#            @instrument compute() registry: those run owner-side, at results-view time, on data
#            that already exists. These run respondent-side, live, during an anonymous session —
#            see routes/studio_routes.py's /ai-instrument endpoint for the dedicated rate limiter
#            that risk surface gets (this is real API cost triggered by public, unauthenticated
#            traffic, unlike everything else in Studio).
"""Live, mid-session Claude calls for the Tier-3 AI-native instruments."""
import json

from src.studio.ai_helper import call_claude


def _parse_json(reply, required_keys):
    if not reply:
        return None
    try:
        parsed = json.loads(reply)
    except (TypeError, ValueError):
        return None
    if not isinstance(parsed, dict) or not required_keys.issubset(parsed.keys()):
        return None
    return parsed


def _paraphrase_check(block, payload):
    question = (block.get('config') or {}).get('question', '')
    paraphrase = str(payload.get('paraphrase') or '').strip()
    if not paraphrase:
        return None
    system = (
        "A survey question and a respondent's paraphrase of it are given. Judge how faithfully "
        "the paraphrase captures the question's meaning. Reply with strict JSON only, no prose, "
        'no markdown fences: {"fidelity_score": <integer 0-100>, "feedback": "<one short, '
        'encouraging sentence>"}'
    )
    reply = call_claude(system, f"Question: {question}\n\nParaphrase: {paraphrase}")
    return _parse_json(reply, {"fidelity_score", "feedback"})


def _devils_advocate(block, payload):
    question = (block.get('config') or {}).get('question', '')
    stance = str(payload.get('stance') or '').strip()
    if not stance:
        return None
    system = (
        "A survey respondent stated a position. Write one short, respectful, well-reasoned "
        "counterargument against it (2-3 sentences) to test how firmly they hold the view. "
        'Reply with strict JSON only, no prose, no markdown fences: {"rebuttal": "<the '
        'counterargument>"}'
    )
    reply = call_claude(system, f"Question: {question}\n\nRespondent's position: {stance}")
    return _parse_json(reply, {"rebuttal"})


def _followup_probe(block, payload):
    question = (block.get('config') or {}).get('question', '')
    answer = str(payload.get('answer') or '').strip()
    if not answer:
        return None
    system = (
        "A survey respondent just answered a question. Write one short, specific follow-up "
        "question that digs deeper into what they said — do not repeat the original question. "
        'Reply with strict JSON only, no prose, no markdown fences: {"followup_question": "<the '
        'question>"}'
    )
    reply = call_claude(system, f"Question: {question}\n\nAnswer: {answer}")
    return _parse_json(reply, {"followup_question"})


_HANDLERS = {
    "comprehension_paraphrase_check": _paraphrase_check,
    "ai_devils_advocate": _devils_advocate,
    "adaptive_followup_probe": _followup_probe,
}


def call_live_ai_instrument(instrument_type, block, payload):
    """Returns a result dict, or None if the instrument type is unknown, the
    payload is missing what it needs, or the Claude call itself failed —
    callers turn None into a clean 502, never a 500.
    """
    handler = _HANDLERS.get(instrument_type)
    if not handler:
        return None
    return handler(block, payload or {})
