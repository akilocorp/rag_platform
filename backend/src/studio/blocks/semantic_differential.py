# @language  Python
# @updated   2026-09-08
# @changed   New file: the Semantic Differential block — a Qualtrics-inspired bipolar adjective-pair
#            scale (e.g. "Weak … Strong"), as opposed to Rating Scale's unipolar 1..scale_max with no
#            inherent direction. Answer is an integer 1..points, `points` clamped odd-or-not to 2..9
#            (matches Rating Scale's clamp range).
"""Semantic Differential — a bipolar scale between two adjective labels."""
from src.studio.blocks.base import block


@block(
    block_type="semantic_differential",
    label="Semantic Differential",
    icon="scale",
    default_config={
        "question": "Untitled question",
        "left_label": "Weak",
        "right_label": "Strong",
        "points": 7,
        "required": False,
    },
)
def validate(config):
    try:
        points = int(config.get("points", 7))
    except (TypeError, ValueError):
        points = 7
    points = min(max(points, 2), 9)
    return {
        "question": str(config.get("question") or "Untitled question"),
        "left_label": str(config.get("left_label") or "Weak"),
        "right_label": str(config.get("right_label") or "Strong"),
        "points": points,
        "required": bool(config.get("required", False)),
    }
