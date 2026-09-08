# @language  Python
# @updated   2026-09-08
# @changed   New file: the LLM Rubric Grader instrument — the first Tier-2 AI-native instrument
#            (results-time, owner-only Claude call, not anonymous live traffic). Scores a text
#            answer against a professor-written rubric. Its compute() result gets cached by
#            routes/studio_routes.py's _augment_responses_with_metrics rather than re-billed on
#            every results-page view — see that function's docstring for why that caching exists.
"""LLM Rubric Grader — scores a text answer against a professor-written rubric."""
import json

from src.studio.ai_helper import call_claude
from src.studio.instruments.base import instrument

DEFAULT_RUBRIC = "Score the answer's clarity and relevance from 1 (poor) to 5 (excellent)."

_SYSTEM_PROMPT = (
    "You are grading a survey respondent's open-text answer against a rubric a researcher wrote. "
    "Reply with strict JSON only, no prose, no markdown fences: "
    '{"score": <integer 1-5>, "justification": "<one short sentence>"}'
)


def _compute(answer, config):
    text = str(answer.get("value") or "").strip()
    if not text:
        return {}
    rubric = str(config.get("rubric") or "").strip() or DEFAULT_RUBRIC

    reply = call_claude(_SYSTEM_PROMPT, f"Rubric: {rubric}\n\nRespondent's answer: {text}")
    if not reply:
        return {}
    try:
        parsed = json.loads(reply)
        score = int(parsed.get("score"))
    except (ValueError, TypeError, AttributeError, json.JSONDecodeError):
        return {}

    return {
        "score": max(1, min(score, 5)),
        "justification": str(parsed.get("justification") or "")[:300],
    }


@instrument(
    instrument_type="llm_rubric_grader",
    label="LLM Rubric Grader",
    icon="graduation-cap",
    kind="measurement",
    default_config={"rubric": DEFAULT_RUBRIC},
    applies_to=["short_text", "long_text"],
    needs_events=False,
    compute=_compute,
    is_ai=True,
)
def validate(config):
    return {"rubric": str(config.get("rubric") or DEFAULT_RUBRIC)[:2000]}
