# @language  Python
# @updated   2026-09-30
# @changed   New module. The video report's overall score is the plain average of every criterion on
#            the report — delivery dimensions, content checks and the opening gambit — replacing the
#            grader's holistic `llm_overall` and the old delivery-only mean.
"""The overall score of a scored video submission.

One definition, shared by the scorer and every read path (student report,
compare view, dashboards, CSV export), so a student and their professor always
see the same number. It is computed from the per-criterion scores already
stored on each `video_scores` document, so reports scored before this rule
existed pick it up too, with no migration.

Scale: 0-100, like every stored criterion score; the UI divides by 10.
"""
from typing import Any, Dict, Optional


def criteria_average(score_doc: Optional[Dict[str, Any]]) -> Optional[float]:
    """Mean of all criterion scores on a report, or the stored `overall` if it has none.

    Criteria are the report's `dimensions` (Confidence, Competence, Passion) and
    `content_checks` (the 13 fundamentals plus the opening gambit). Unscored
    criteria (None) are left out rather than counted as zero.
    """
    if not score_doc:
        return None
    values = [
        item.get("score")
        for key in ("dimensions", "content_checks")
        for item in (score_doc.get(key) or [])
        if isinstance(item, dict) and item.get("score") is not None
    ]
    if not values:
        return score_doc.get("overall")
    return round(sum(values) / len(values), 1)
