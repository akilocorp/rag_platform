"""Elevator Pitch preset — short, high-energy persuasive pitch.

Weighted toward Passion + Confidence; content checks for the classic
hook / value / ask / close structure.
"""
from src.video.rubrics.base import default_scoring_spec, register_preset

_spec = default_scoring_spec()
_spec["composite_weights"] = {"confidence": 0.35, "competence": 0.25, "passion": 0.40}
_spec["feedback_prompt_template"] = (
    "You are coaching a student on a 60-90 second ELEVATOR PITCH. A great pitch "
    "opens with a hook, states a clear value proposition with credible evidence, "
    "makes a specific ask, and closes memorably — all delivered with energy and "
    "conviction. Using the transcript and delivery signals, give concise feedback: "
    "praise the strongest moments, then the 2-3 highest-leverage fixes. Weight "
    "passion and confidence heavily; a flat or hesitant pitch fails even if the "
    "content is correct."
)
_spec["content_checks"] = [
    {"id": "hook", "label": "Opening hook", "description": "Opens with an attention-grabbing hook (question, bold claim, or vivid problem)."},
    {"id": "value", "label": "Value proposition", "description": "States a clear, specific value proposition or unique benefit."},
    {"id": "ask", "label": "The ask", "description": "Makes a concrete ask (meeting, funding, sign-up, next step)."},
    {"id": "close", "label": "Memorable close", "description": "Ends with a confident, memorable closing line rather than trailing off."},
]

register_preset(
    key="elevator_pitch",
    label="Elevator Pitch",
    description="Short persuasive pitch graded for energy, confidence, and a clear hook→ask→close.",
    scoring_spec=_spec,
)
