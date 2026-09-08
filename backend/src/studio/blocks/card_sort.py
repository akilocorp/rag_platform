# @language  Python
# @updated   2026-09-08
# @changed   New file: the Card Sort block — Qualtrics/Optimal Workshop's Card Sort. Closed sort
#            when `categories` is non-empty (respondent assigns each item to one of the given
#            categories); open sort when empty (respondent free-types their own category per item).
#            Implemented as per-item category pickers rather than true drag-tile UI — same data,
#            simpler interaction; documented rather than overclaimed as tactile card sorting.
"""Card Sort — assign each item to a category (closed: pick from a list; open: free-typed)."""
from src.studio.blocks.base import block

_DEFAULT_ITEMS = ["Item 1", "Item 2", "Item 3"]
_DEFAULT_CATEGORIES = ["Category A", "Category B"]


def _clean_list(value, fallback):
    if not isinstance(value, list):
        value = []
    cleaned = [str(v).strip() for v in value if str(v).strip()]
    return cleaned or fallback


@block(
    block_type="card_sort",
    label="Card Sort",
    icon="th-large",
    default_config={
        "question": "Sort each item into a category.",
        "items": list(_DEFAULT_ITEMS),
        "categories": list(_DEFAULT_CATEGORIES),
        "required": False,
    },
)
def validate(config):
    return {
        "question": str(config.get("question") or "Sort each item into a category."),
        "items": _clean_list(config.get("items"), list(_DEFAULT_ITEMS)),
        # Categories may be legitimately empty (open sort) — no fallback there.
        "categories": [str(c).strip() for c in (config.get("categories") or []) if str(c).strip()],
        "required": bool(config.get("required", False)),
    }
