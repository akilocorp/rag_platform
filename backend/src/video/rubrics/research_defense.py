"""Research Defense preset — academic presentation of methods and findings.

Weighted heavily toward Competence (content rigor); delivery still matters but
substance dominates. Content checks for the standard defense structure.
"""
from src.video.rubrics.base import default_scoring_spec, register_preset

_spec = default_scoring_spec()
_spec["composite_weights"] = {"confidence": 0.30, "competence": 0.55, "passion": 0.15}
# Lean competence even harder on substance than on delivery support.
_spec["submetric_weights"]["competence"] = {
    "llm_content": 0.80,
    "pacing_smoothness": 0.10,
    "hedging": 0.10,
}
_spec["feedback_prompt_template"] = (
    "You are a faculty examiner evaluating a student's RESEARCH DEFENSE. The bar "
    "is intellectual rigor: a clear research question, sound methodology, evidence "
    "that supports the claims, awareness of limitations, and precise academic "
    "vocabulary. Using the transcript and delivery signals, give concise feedback "
    "focused first on the substance and structure of the argument, then on delivery. "
    "Reward precision and honesty about limitations; penalize vague or unsupported "
    "claims even if delivered confidently."
)
_spec["content_checks"] = [
    {"id": "question", "label": "Research question", "description": "States a clear, focused research question or thesis."},
    {"id": "method", "label": "Methodology", "description": "Explains the methodology well enough to assess validity."},
    {"id": "evidence", "label": "Evidence", "description": "Supports claims with specific data, results, or citations."},
    {"id": "limitations", "label": "Limitations", "description": "Acknowledges limitations or threats to validity."},
    {"id": "contribution", "label": "Contribution", "description": "Articulates the contribution or significance of the work."},
]

register_preset(
    key="research_defense",
    label="Research Defense",
    description="Academic defense graded primarily on content rigor, evidence, and structure.",
    scoring_spec=_spec,
)
