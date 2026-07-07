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


def _validate_function_mode(data):
    """Validate the interactive function-graph shape, or None if not that mode.

    Returns None when the data doesn't look like a function graph so the caller
    falls through to the static-series validator.
    """
    raw_fns = data.get("functions")
    raw_range = data.get("x_range")
    if not isinstance(raw_fns, list) or not raw_fns or not isinstance(raw_range, list):
        return None

    lo, hi = (_num(raw_range[0]) if len(raw_range) > 0 else None,
              _num(raw_range[1]) if len(raw_range) > 1 else None)
    if lo is None or hi is None or lo == hi:
        return None

    functions = []
    for f in raw_fns:
        if not isinstance(f, dict):
            continue
        expr = str(f.get("expr") or "").strip()
        if not expr:
            continue
        name = str(f.get("name") or "").strip() or f"y{len(functions) + 1}"
        functions.append({"name": name, "expr": expr})
    if not functions:
        return None

    params = []
    for p in data.get("params") or []:
        if not isinstance(p, dict):
            continue
        name = str(p.get("name") or "").strip()
        pmin, pmax = _num(p.get("min")), _num(p.get("max"))
        if not name or pmin is None or pmax is None:
            continue
        param = {"name": name, "min": pmin, "max": pmax}
        default = _num(p.get("default"))
        param["default"] = default if default is not None else pmin
        step = _num(p.get("step"))
        if step is not None and step > 0:
            param["step"] = step
        params.append(param)

    out = {"type": "line", "x_range": [lo, hi], "functions": functions, "params": params}
    samples = _num(data.get("samples"))
    if samples is not None:
        out["samples"] = int(samples)
    for key in ("title", "y_label", "caption"):
        val = str(data.get(key) or "").strip()
        if val:
            out[key] = val
    return out


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
        "__function_mode__": (
            "ALTERNATIVELY, for a math function the user can manipulate, OMIT "
            "x_labels/series and instead provide: x_range [min,max]; params "
            "(array of {name,min,max,default,step} sliders); functions (array of "
            "{name, expr} where expr is an explicit y=f(x) in terms of x and the "
            "param names, using + - * / ^ and sin/cos/tan/exp/log/ln/sqrt/abs). "
            "Only explicit y=f(x) — no implicit relations."
        ),
    },
    interactive=False,
)
def validate(data):
    if not isinstance(data, dict):
        return None

    # Function-graph mode: x_range + functions (params optional). Validated
    # loosely — the frontend compiles/evaluates the expressions and just skips
    # any that don't parse, so we only guarantee the shape is render-ready.
    fn = _validate_function_mode(data)
    if fn is not None:
        return fn

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
