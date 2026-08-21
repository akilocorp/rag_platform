# @language  Python
# @updated   2026-08-15
# @changed   Added a faithful to_transcript so the table's columns/rows/cells replay into history — the bot
#            can answer questions about the comparison instead of denying a table was made.
"""
comparison_table — a display-only side-by-side comparison grid.

Data shape the widget renders:
  { title?, columns: [str], rows: [{ label, cells: [str] }] }
Non-interactive: it renders a table; nothing is sent back.

The validator is STRICT — every row's `cells` array MUST line up 1:1 with
`columns` (rows that don't match are dropped), and the widget is rejected unless
at least two columns and one usable row survive.
"""
from src.facilitator.base import widget


def _to_transcript(data):
    """Render the table (columns + each row's cells) into history so the bot can
    answer questions about the comparison it produced."""
    cols = data.get("columns") or []
    lines = ["[Comparison table displayed to the user]"]
    if data.get("title"):
        lines.append(f"Title: {data['title']}")
    lines.append("Columns: " + " | ".join(str(c) for c in cols))
    for r in data.get("rows") or []:
        cells = " | ".join(str(c) for c in r.get("cells") or [])
        lines.append(f"{r.get('label')}: {cells}")
    return "\n".join(lines)


@widget(
    id="comparison_table",
    label="Comparison table",
    description="A side-by-side table comparing items (rows) across attributes (columns).",
    when_to_use=(
        "Use when the reply compares two or more things across the SAME set of "
        "attributes — pros/cons, options against criteria, before/after, or "
        "feature matrices. `columns` are the attributes being compared; each row's "
        "`label` names the item and `cells` gives its value for each column, in the "
        "same order as `columns`. Do NOT use for a single item or free-form text."
    ),
    data_schema={
        "title": "optional string — short table title",
        "columns": "array of 2-5 short strings — the attribute/column headers, in order",
        "rows": (
            "array of 1+ objects { label: string, cells: array of strings } — label "
            "names the row's item; cells MUST have exactly the same length as columns, "
            "one value per column in the same order."
        ),
    },
    interactive=False,
    to_transcript=_to_transcript,
)
def validate(data):
    if not isinstance(data, dict):
        return None

    raw_columns = data.get("columns")
    if not isinstance(raw_columns, list):
        return None
    columns = [str(c).strip() for c in raw_columns if str(c).strip()]
    if len(columns) < 2:
        return None
    columns = columns[:5]
    n = len(columns)

    raw_rows = data.get("rows")
    if not isinstance(raw_rows, list):
        return None

    rows = []
    for r in raw_rows:
        if not isinstance(r, dict):
            continue
        label = str(r.get("label") or "").strip()
        raw_cells = r.get("cells")
        if not label or not isinstance(raw_cells, list) or len(raw_cells) != n:
            continue
        cells = [str(v).strip() for v in raw_cells]
        rows.append({"label": label, "cells": cells})

    if not rows:
        return None

    out = {"columns": columns, "rows": rows}
    title = str(data.get("title") or "").strip()
    if title:
        out["title"] = title
    return out
