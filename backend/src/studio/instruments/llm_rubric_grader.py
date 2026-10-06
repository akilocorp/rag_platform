# @language  Python
# @updated   2026-10-06
# @changed   Answer is fenced as untrusted data (prompt-injection guard) and capped at
#            GRADED_TEXT_MAX_CHARS; fence-tolerant parsing; a failed call now returns
#            {"error": ...} so the professor sees "grading failed" rather than a silent blank.
# Prior: New file: the LLM Rubric Grader instrument — the first Tier-2 AI-native instrument
#            (results-time, owner-only Claude call, not anonymous live traffic). Scores a text
#            answer against a professor-written rubric. Its compute() result gets cached by
#            routes/studio_routes.py's _augment_responses_with_metrics rather than re-billed on
#            every results-page view — see that function's docstring for why that caching exists.
"""LLM Rubric Grader — scores a text answer against a professor-written rubric."""
from src.studio.ai_helper import UNTRUSTED_NOTICE, call_claude, parse_json_reply, wrap_untrusted
from src.studio.instruments.base import instrument

# Graded text cap — bounds what one anonymous answer can cost at results time.
GRADED_TEXT_MAX_CHARS = 4000
GRADING_FAILED = {"error": "grading failed"}

DEFAULT_RUBRIC = "Score the answer's clarity and relevance from 1 (poor) to 5 (excellent)."

_SYSTEM_PROMPT = (
    "You are grading a survey respondent's open-text answer against a rubric a researcher wrote. "
    "Reply with strict JSON only, no prose, no markdown fences: "
    '{"score": <integer 1-5>, "justification": "<one short sentence>"} ' + UNTRUSTED_NOTICE
)


def _compute(answer, config):
    text = str(answer.get("value") or "").strip()
    if not text:
        return {}
    rubric = str(config.get("rubric") or "").strip() or DEFAULT_RUBRIC

    reply = call_claude(
        _SYSTEM_PROMPT,
        f"Rubric: {rubric}\n\nRespondent's answer:\n{wrap_untrusted(text, GRADED_TEXT_MAX_CHARS)}",
    )
    parsed = parse_json_reply(reply, {"score"})
    try:
        score = int(parsed["score"])
    except (TypeError, ValueError, KeyError):
        return dict(GRADING_FAILED)

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
