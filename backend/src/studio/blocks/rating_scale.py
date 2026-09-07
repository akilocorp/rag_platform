# @language  Python
# @updated   2026-09-07
# @changed   New file: the Rating Scale block — pick one integer 1..scale_max (Likert-style).
"""Rating Scale — an integer rating from 1 to `scale_max` (clamped to 2..10)."""
from src.studio.blocks.base import block


@block(
    block_type="rating_scale",
    label="Rating Scale",
    icon="star",
    default_config={"question": "Untitled question", "scale_max": 5, "required": False},
)
def validate(config):
    try:
        scale_max = int(config.get("scale_max", 5))
    except (TypeError, ValueError):
        scale_max = 5
    scale_max = min(max(scale_max, 2), 10)
    return {
        "question": str(config.get("question") or "Untitled question"),
        "scale_max": scale_max,
        "required": bool(config.get("required", False)),
    }
