# @language  Python
# @updated   2026-10-08
# @changed   Endpoint labels (min_label/max_label) and optional per-point labels (point_labels), which
#            is how the builder's Likert presets ("Strongly disagree" … "Strongly agree") are stored.
# Prior: New file: the Rating Scale block — pick one integer 1..scale_max (Likert-style).
"""Rating Scale — an integer rating from 1 to `scale_max` (clamped to 2..10)."""
from src.studio.blocks.base import block

MAX_LABEL_CHARS = 60


@block(
    block_type="rating_scale",
    label="Rating Scale",
    icon="star",
    default_config={
        "question": "Untitled question", "scale_max": 5,
        "min_label": "", "max_label": "", "point_labels": [], "required": False,
    },
)
def validate(config):
    try:
        scale_max = int(config.get("scale_max", 5))
    except (TypeError, ValueError):
        scale_max = 5
    scale_max = min(max(scale_max, 2), 10)
    # Per-point labels are all-or-nothing: kept only when there's exactly one
    # per point, so a scale resized after picking a preset falls back to plain
    # numbers instead of mislabelling points.
    point_labels = config.get("point_labels")
    if not isinstance(point_labels, list) or len(point_labels) != scale_max:
        point_labels = []
    return {
        "question": str(config.get("question") or "Untitled question"),
        "scale_max": scale_max,
        "min_label": str(config.get("min_label") or "")[:MAX_LABEL_CHARS],
        "max_label": str(config.get("max_label") or "")[:MAX_LABEL_CHARS],
        "point_labels": [str(p or "")[:MAX_LABEL_CHARS] for p in point_labels],
        "required": bool(config.get("required", False)),
    }
