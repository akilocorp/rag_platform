# @language  Python
# @updated   2026-10-06
# @changed   Both answers are fenced as untrusted data and capped; fence-tolerant parsing; a failed
#            call returns {"error": ...} instead of a silent blank.
# Prior: New file: the Cross-Answer Inconsistency instrument. Unlike every other instrument's
#            compute(answer, config), this one needs a SIBLING block's answer from the same
#            response — not something the generic per-answer loop has. Rather than widen compute()'s
#            signature for all 13 other instruments, routes/studio_routes.py's
#            _augment_responses_with_metrics special-cases just this type: it looks up the sibling
#            answer itself and injects it into `config` as private `_sibling_answer`/
#            `_sibling_question` keys before calling compute() — those never come from the professor
#            and are never persisted as the instrument's saved config.
"""Cross-Answer Inconsistency — flags whether this answer contradicts an earlier one."""
from src.studio.ai_helper import UNTRUSTED_NOTICE, call_claude, parse_json_reply, wrap_untrusted
from src.studio.instruments.base import instrument

# Per-answer cap — two answers go into each call.
COMPARED_TEXT_MAX_CHARS = 3000

_SYSTEM_PROMPT = (
    "You compare two answers from the same survey respondent and judge whether they contradict "
    "each other. Reply with strict JSON only, no prose, no markdown fences: "
    '{"contradiction": true|false, "note": "<one short sentence>"} ' + UNTRUSTED_NOTICE
)


def _compute(answer, config):
    text = str(answer.get("value") or "").strip()
    sibling_text = str(config.get("_sibling_answer") or "").strip()
    if not text or not sibling_text:
        return {}
    sibling_question = config.get("_sibling_question") or "the other question"

    reply = call_claude(
        _SYSTEM_PROMPT,
        f'Answer to "{sibling_question}":\n{wrap_untrusted(sibling_text, COMPARED_TEXT_MAX_CHARS)}\n\n'
        f'Answer to the current question:\n{wrap_untrusted(text, COMPARED_TEXT_MAX_CHARS)}',
    )
    parsed = parse_json_reply(reply, {"contradiction"})
    if parsed is None:
        return {"error": "check failed"}

    return {
        "contradiction": bool(parsed.get("contradiction")),
        "note": str(parsed.get("note") or "")[:300],
    }


@instrument(
    instrument_type="cross_answer_inconsistency",
    label="Cross-Answer Inconsistency",
    icon="not-equal",
    kind="measurement",
    default_config={"compare_to_block_id": ""},
    applies_to=None,
    needs_events=False,
    compute=_compute,
    is_ai=True,
)
def validate(config):
    return {"compare_to_block_id": str(config.get("compare_to_block_id") or "")}
