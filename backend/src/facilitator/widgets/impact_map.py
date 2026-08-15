# @language  Python
# @updated   2026-08-15
# @changed   Added a faithful to_transcript so the scenario and each country's role/note replay into history —
#            the bot can answer questions about the map instead of denying one was made.
"""
impact_map — a display-of-a-scenario world choropleth.

Given a scenario (e.g. "India halts garment exports to the US"), the widget
shades countries by the role they play in the ripple: the trigger, those whose
activity increases, those whose activity decreases, and neutral elsewhere.

Data shape the widget renders:
  { title?, scenario?, regions:[{country, iso3, role, intensity?, note?}],
    legend?, caption? }
- role is one of trigger | increase | decrease | neutral (unknown -> neutral).
- iso3 is the ISO 3166-1 alpha-3 code used to match the bundled world atlas.
- intensity (0..1) modulates the shade; note is shown on hover.
- Optional interactive click on a highlighted country asks the bot to elaborate.

The validator is STRICT — a region without a 3-letter iso3 and a country label
is dropped, and the whole widget is rejected unless at least one region carries
a non-neutral role (an all-neutral map highlights nothing).
"""
from src.facilitator.base import widget

ROLES = ("trigger", "increase", "decrease", "neutral")


def _num(v):
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if f != f or f in (float("inf"), float("-inf")):
        return None
    return f


def _to_transcript(data):
    """Render the scenario and each country's role/note into history so the bot can
    answer questions about the impact map it produced."""
    lines = ["[Impact map (world choropleth) shown to the user]"]
    if data.get("title"):
        lines.append(f"Title: {data['title']}")
    if data.get("scenario"):
        lines.append(f"Scenario: {data['scenario']}")
    for r in data.get("regions") or []:
        line = f"{r.get('country')} ({r.get('role')})"
        if r.get("note"):
            line += f": {r['note']}"
        lines.append(line)
    if data.get("caption"):
        lines.append(f"Caption: {data['caption']}")
    return "\n".join(lines)


@widget(
    id="impact_map",
    label="Impact map",
    description="A world map that shades countries by their role in a scenario's ripple effects.",
    when_to_use=(
        "Use when the reply describes how an event, policy, or shock propagates "
        "ACROSS COUNTRIES — who is the trigger, whose activity rises, whose falls. "
        "Provide a region per relevant country with its iso3 code and role. Do NOT "
        "use for a single-country topic or a non-geographic comparison."
    ),
    data_schema={
        "title": "optional string — short map title",
        "scenario": "optional string — one-line description of the event being mapped",
        "regions": (
            "array of objects { country, iso3, role, intensity?, note? }. country is "
            "the display name; iso3 is the ISO 3166-1 alpha-3 code (e.g. 'IND', 'USA'); "
            "role is 'trigger' (origin of the shock), 'increase' (activity rises), "
            "'decrease' (activity falls), or 'neutral'; intensity is 0..1 for shade "
            "strength; note is a short hover explanation of that country's effect."
        ),
        "legend": (
            "optional object mapping any of trigger/increase/decrease/neutral to a "
            "custom label string (e.g. { increase: 'Gains export share' })"
        ),
        "caption": "optional string — a one-line takeaway shown under the map",
    },
    interactive=True,
    to_transcript=_to_transcript,
)
def validate(data):
    if not isinstance(data, dict):
        return None

    regions = []
    seen = set()
    for r in data.get("regions") or []:
        if not isinstance(r, dict):
            continue
        iso = str(r.get("iso3") or "").strip().upper()
        country = str(r.get("country") or "").strip()
        if len(iso) != 3 or not iso.isalpha() or not country or iso in seen:
            continue
        seen.add(iso)
        role = str(r.get("role") or "neutral").strip().lower()
        if role not in ROLES:
            role = "neutral"
        reg = {"iso3": iso, "country": country, "role": role}
        intensity = _num(r.get("intensity"))
        if intensity is not None:
            reg["intensity"] = max(0.0, min(1.0, intensity))
        note = str(r.get("note") or "").strip()
        if note:
            reg["note"] = note
        regions.append(reg)

    if not regions or not any(r["role"] != "neutral" for r in regions):
        return None

    out = {"regions": regions}
    for key in ("title", "scenario", "caption"):
        val = str(data.get(key) or "").strip()
        if val:
            out[key] = val

    raw_legend = data.get("legend")
    if isinstance(raw_legend, dict):
        legend = {}
        for role in ROLES:
            label = str(raw_legend.get(role) or "").strip()
            if label:
                legend[role] = label
        if legend:
            out["legend"] = legend

    return out
