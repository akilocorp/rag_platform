"""
chart — a display-only line or bar chart of one or more numeric series over a
shared set of x-axis labels.

Data shape the widget renders:
  { title?, type: 'line'|'bar', x_labels: [str], series: [{name, points: [num]}],
    y_label?, caption? }
Non-interactive: it renders a picture; nothing is sent back when the user looks
at it.

The validator is deliberately STRICT — it only lets through data that is
guaranteed render-ready (every series lines up with the x-axis, every point is a
real number). Anything off-shape is rejected and the turn falls back to plain
text, so a chart never renders half-broken.
"""
from src.facilitator.base import widget


def _num(v):
    """Coerce to a finite float, or None if it isn't a real number."""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if f != f or f in (float("inf"), float("-inf")):  # NaN / +-inf
        return None
    return f


@widget(
    id="chart",
    label="Chart",
    description="A line or bar chart of one or more numeric series over shared x-axis labels.",
    when_to_use=(
        "Use when the reply describes a QUANTITY changing across an ordered set of "
        "points — over time (periods, quarters, years) or across categories, or a "
        "before/after comparison. Fill the actual numbers the reply refers to. Do "
        "NOT use for a single value or for purely qualitative/definitional replies."
    ),
    data_schema={
        "title": "optional string — short chart title",
        "type": "string — 'line' or 'bar' (default 'line')",
        "x_labels": "array of 2+ strings — the x-axis labels, in order (e.g. ['Q1','Q2','Q3','Q4'])",
        "series": (
            "array of { name: string, points: array of numbers } — one entry per "
            "line/bar. Each points array MUST have exactly the same length as x_labels."
        ),
        "y_label": "optional string — what the y-axis measures",
        "caption": "optional string — a one-line takeaway shown under the chart",
    },
    interactive=False,
)
def validate(data):
    if not isinstance(data, dict):
        return None

    raw_labels = data.get("x_labels")
    if not isinstance(raw_labels, list) or len(raw_labels) < 2:
        return None
    x_labels = [str(lbl).strip() for lbl in raw_labels]
    n = len(x_labels)

    raw_series = data.get("series")
    if not isinstance(raw_series, list) or not raw_series:
        return None

    series = []
    for s in raw_series:
        if not isinstance(s, dict):
            continue
        raw_points = s.get("points")
        if not isinstance(raw_points, list) or len(raw_points) != n:
            continue
        points = [_num(v) for v in raw_points]
        if any(p is None for p in points):
            continue
        name = str(s.get("name") or "").strip() or f"Series {len(series) + 1}"
        series.append({"name": name, "points": points})

    if not series:
        return None

    ctype = str(data.get("type") or "line").strip().lower()
    if ctype not in ("line", "bar"):
        ctype = "line"

    out = {"type": ctype, "x_labels": x_labels, "series": series}
    for key in ("title", "y_label", "caption"):
        val = str(data.get(key) or "").strip()
        if val:
            out[key] = val
    return out
