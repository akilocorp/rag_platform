"""
mind_map — an interactive constructive-recall exercise.

A central idea is pinned in the middle; concept tiles (the real nodes plus
optional distractors) sit around it. The user drags threads to connect tiles to
the center or to each other, then hits "Check" to score their map against an
answer key.

Data shape the widget renders:
  { central, nodes:[{id,label}], correct_links:[{from,to,order?}],
    distractors?:[{id,label}], instructions? }
- "central" is the RESERVED id of the center node (never a node/distractor id).
- correct_links reference the center or a real node id on both ends.
- Interactive: on submit the widget sends a text summary + score as the next
  user message.

The validator is STRICT — a link that points at an unknown id (or a distractor,
which is wrong by definition) is dropped, and the whole widget is rejected unless
at least one node and one usable correct link survive (a map with nothing to
build isn't one).
"""
from src.facilitator.base import widget

CENTER_ID = "central"


def _clean_tiles(raw, taken_ids):
    """Return [{id,label}] for a raw tile list, skipping bad/dupe/reserved ids.

    `taken_ids` is mutated with every id accepted so nodes and distractors can't
    collide with each other or with the reserved center id.
    """
    tiles = []
    if not isinstance(raw, list):
        return tiles
    for t in raw:
        if not isinstance(t, dict):
            continue
        tid = str(t.get("id") or "").strip()
        label = str(t.get("label") or "").strip()
        if not tid or not label or tid == CENTER_ID or tid in taken_ids:
            continue
        taken_ids.add(tid)
        tiles.append({"id": tid, "label": label})
    return tiles


@widget(
    id="mind_map",
    label="Mind map",
    description="An interactive build-a-mind-map exercise scored against an answer key.",
    when_to_use=(
        "Use when the reply asks the user to CONSTRUCT the relationships between a "
        "central idea and several concepts — mapping causes, components, or how "
        "sub-ideas connect to a theme (3-8 real concepts). Provide the answer key "
        "in correct_links. Add distractors to make it a real test. Do NOT use for "
        "passive explanation or when there is no single defensible set of links."
    ),
    data_schema={
        "central": "string — the central idea pinned in the middle of the map",
        "nodes": (
            "array of 3-8 objects { id: string, label: string } — the concept tiles "
            "that DO belong in the map. id is a short unique slug (never 'central')."
        ),
        "correct_links": (
            "array of objects { from: string, to: string, order?: number } — the "
            "answer key. from/to are node ids or the literal 'central'. Each link is "
            "a correct connection the user should make. order is optional and unused "
            "in v1 scoring (matching is undirected connectivity)."
        ),
        "distractors": (
            "optional array of { id: string, label: string } — extra tiles that do "
            "NOT belong; they never appear in correct_links. Makes the exercise a "
            "real test rather than connect-everything."
        ),
        "instructions": "optional string — a one-line prompt shown above the canvas",
    },
    interactive=True,
)
def validate(data):
    if not isinstance(data, dict):
        return None

    central = str(data.get("central") or "").strip()
    if not central:
        return None

    taken = {CENTER_ID}
    nodes = _clean_tiles(data.get("nodes"), taken)
    if not nodes:
        return None

    distractors = _clean_tiles(data.get("distractors"), taken)

    # Valid link endpoints are the center + the real node ids. Distractors are
    # deliberately excluded so a correct_link can never point at a wrong tile.
    valid_ids = {CENTER_ID} | {n["id"] for n in nodes}

    correct_links = []
    seen = set()
    raw_links = data.get("correct_links")
    if isinstance(raw_links, list):
        for lk in raw_links:
            if not isinstance(lk, dict):
                continue
            a = str(lk.get("from") or "").strip()
            b = str(lk.get("to") or "").strip()
            if a not in valid_ids or b not in valid_ids or a == b:
                continue
            # undirected dedup — {a,b} same as {b,a}
            key = tuple(sorted((a, b)))
            if key in seen:
                continue
            seen.add(key)
            link = {"from": a, "to": b}
            order = lk.get("order")
            if isinstance(order, (int, float)) and not isinstance(order, bool):
                link["order"] = int(order)
            correct_links.append(link)

    if not correct_links:
        return None

    out = {"central": central, "nodes": nodes, "correct_links": correct_links}
    if distractors:
        out["distractors"] = distractors
    instructions = str(data.get("instructions") or "").strip()
    if instructions:
        out["instructions"] = instructions
    return out
