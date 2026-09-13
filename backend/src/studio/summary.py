# @language  Python
# @updated   2026-09-13
# @changed   `_tally` and the rating/semantic-differential histogram now carry a `value` alongside
#            `label` (identical for tallies, an int for histograms) — the Present view's
#            click-to-filter needs the exact, correctly-typed value to send back to
#            routes/studio_routes.py's new filter_block_id/filter_value query params, which filter
#            `responses` before this module ever sees them (so every aggregation function here is
#            unchanged — filtering is just a smaller input list).
# Prior: New file: live-summary aggregation for Studio's "Present" view (a Mentimeter-style
#            QR + live-results screen for in-class use). Deliberately excludes every AI-native
#            instrument and every data-quality/compliance instrument (Attention Check, Instructed
#            Response, Speeder Flag, Read-Time Gate, both Randomizers, Piped Text) — this view only
#            ever shows numbers computed by plain code, so a professor never has to explain an LLM's
#            reasoning to a research advisor to stand behind what's on the projector. Confidence
#            Slider and Reaction Timer are the two instruments in scope: both are genuine classroom
#            signals (self-assessed understanding, response latency) that don't single out any one
#            student once aggregated across the room.
#            Recomputed fresh on every call, no caching — classroom-scale response counts (tens to
#            low hundreds) make that trivial, and it sidesteps the metrics-persistence path in
#            routes/studio_routes.py's _augment_responses_with_metrics, which exists for a very
#            different access pattern (occasional results-page opens, not a 2-3s poll loop).
"""Aggregation for GET /studio/projects/<id>/live-summary — the Present view's data source."""
import re
from collections import Counter

# rich_text has no answer; voice_conversation has no non-AI aggregate worth
# showing live (a transcript array isn't a "quick glance" stat) and is
# is_ai-locked anyway.
EXCLUDED_BLOCK_TYPES = {"rich_text", "voice_conversation"}

_STOPWORDS = {
    "the", "a", "an", "is", "it", "to", "of", "and", "in", "on", "for", "with",
    "that", "this", "was", "were", "are", "be", "as", "at", "by", "or", "but",
    "i", "you", "he", "she", "we", "they", "my", "your", "his", "her", "our",
    "their", "have", "has", "had", "do", "does", "did", "not", "so", "very",
    "just", "really", "can", "would", "could", "should", "what", "when",
    "where", "how", "why", "which", "who", "there", "here", "than", "then",
    "if", "no", "yes", "me", "us", "them", "its", "im", "dont", "its",
}
_WORD_RE = re.compile(r"[a-zA-Z']{2,}")


def _pct(count, total):
    return round((count / total) * 100, 1) if total else 0.0


def _tally(values, categories):
    """Counts + percentages, in the given category order. Any value not in
    `categories` is dropped — it can't have come from this block's current
    config (stale data from before an option was edited/removed)."""
    counts = Counter(v for v in values if v in categories)
    total = sum(counts.values())
    return [
        # `value` rides along separately from `label` (identical here, both
        # strings) so the Present view's click-to-filter can send back
        # exactly what a respondent's answer equals, regardless of chart
        # type — histograms below carry an int in the same slot.
        {"label": c, "value": c, "count": counts.get(c, 0), "pct": _pct(counts.get(c, 0), total)}
        for c in categories
    ], total


def _instrument_aggregates(block, answers):
    """Confidence Slider / Reaction Timer averages for this block, read
    directly off the raw answers — not routed through the instrument
    registry's compute()/caching path, which is built for a different
    access pattern (see file header)."""
    inst_types = {i["type"] for i in (block.get("instruments") or [])}
    out = {}

    if "confidence_slider" in inst_types:
        vals = [
            (a.get("instrument_values") or {}).get("confidence_slider")
            for a in answers
        ]
        vals = [v for v in vals if isinstance(v, (int, float))]
        if vals:
            out["confidence_slider"] = {"avg": round(sum(vals) / len(vals), 1), "n": len(vals)}

    if "reaction_timer" in inst_types:
        latencies = []
        for a in answers:
            events = a.get("events") or []
            shown = next((e.get("at") for e in events if e.get("type") == "shown"), None)
            submit = next((e.get("at") for e in events if e.get("type") == "submit"), None)
            if isinstance(shown, (int, float)) and isinstance(submit, (int, float)):
                latencies.append(submit - shown)
        if latencies:
            out["reaction_timer"] = {"avg_ms": round(sum(latencies) / len(latencies)), "n": len(latencies)}

    return out


def _summarize_block(block, answers):
    btype = block["type"]
    config = block.get("config") or {}
    question = config.get("question") or config.get("content") or block["id"]
    values = [a.get("value") for a in answers if a.get("value") is not None]
    base = {
        "block_id": block["id"],
        "type": btype,
        "question": question,
        "n": len(values),
        "instruments": _instrument_aggregates(block, answers),
    }

    if btype == "yes_no":
        data, total = _tally(values, ["Yes", "No"])
        return {**base, "chart": "bar", "n": total, "data": data}

    if btype == "single_choice":
        options = config.get("options") or []
        data, total = _tally(values, options)
        return {**base, "chart": "bar", "n": total, "data": data}

    if btype in ("rating_scale", "semantic_differential"):
        top = config.get("scale_max") if btype == "rating_scale" else config.get("points", 7)
        top = int(top or (5 if btype == "rating_scale" else 7))
        nums = [v for v in values if isinstance(v, (int, float))]
        histogram = Counter(int(v) for v in nums if 1 <= v <= top)
        data = [
            {"label": str(n), "value": n, "count": histogram.get(n, 0), "pct": _pct(histogram.get(n, 0), len(nums))}
            for n in range(1, top + 1)
        ]
        avg = round(sum(nums) / len(nums), 2) if nums else None
        extra = {}
        if btype == "semantic_differential":
            extra = {"left_label": config.get("left_label", ""), "right_label": config.get("right_label", "")}
        return {**base, "chart": "bar", "n": len(nums), "data": data, "avg": avg, **extra}

    if btype == "forced_rank":
        options = config.get("options") or []
        rank_sums = {o: 0 for o in options}
        rank_counts = {o: 0 for o in options}
        n = 0
        for v in values:
            if not isinstance(v, list):
                continue
            n += 1
            for idx, opt in enumerate(v):
                if opt in rank_sums:
                    rank_sums[opt] += idx + 1
                    rank_counts[opt] += 1
        data = sorted(
            (
                {"label": o, "avg_rank": round(rank_sums[o] / rank_counts[o], 2) if rank_counts[o] else None}
                for o in options
            ),
            key=lambda d: (d["avg_rank"] is None, d["avg_rank"]),
        )
        return {**base, "chart": "rank", "n": n, "data": data}

    if btype == "constant_sum":
        options = config.get("options") or []
        sums = {o: 0 for o in options}
        counts = {o: 0 for o in options}
        n = 0
        for v in values:
            if not isinstance(v, dict):
                continue
            n += 1
            for o in options:
                amt = v.get(o)
                if isinstance(amt, (int, float)):
                    sums[o] += amt
                    counts[o] += 1
        raw = [
            {"label": o, "avg_allocation": round(sums[o] / counts[o], 1) if counts[o] else 0}
            for o in options
        ]
        grand_total = sum(r["avg_allocation"] for r in raw) or 1
        data = [{**r, "pct": _pct(r["avg_allocation"], grand_total)} for r in raw]
        return {**base, "chart": "stacked_bar", "n": n, "data": data}

    if btype == "maxdiff":
        scores = {}
        shown = {}
        n = 0
        for v in values:
            if not isinstance(v, list):
                continue
            n += 1
            for round_result in v:
                if not isinstance(round_result, dict):
                    continue
                for opt in round_result.get("options") or []:
                    shown[opt] = shown.get(opt, 0) + 1
                    scores.setdefault(opt, 0)
                most, least = round_result.get("most"), round_result.get("least")
                if most in scores:
                    scores[most] += 1
                if least in scores:
                    scores[least] -= 1
        data = sorted(
            ({"label": o, "score": scores[o], "shown": shown.get(o, 0)} for o in scores),
            key=lambda d: -d["score"],
        )
        return {**base, "chart": "diverging_bar", "n": n, "data": data}

    if btype == "card_sort":
        items = config.get("items") or []
        per_item = []
        for item in items:
            cats = Counter()
            n_item = 0
            for v in values:
                if isinstance(v, dict) and v.get(item):
                    cats[v[item]] += 1
                    n_item += 1
            top_cat, top_count = (cats.most_common(1) or [(None, 0)])[0]
            per_item.append({
                "item": item, "top_category": top_cat,
                "pct": _pct(top_count, n_item), "n": n_item,
            })
        return {**base, "chart": "list", "n": len(values), "data": per_item}

    if btype in ("short_text", "long_text"):
        counter = Counter()
        for v in values:
            if not isinstance(v, str):
                continue
            for w in _WORD_RE.findall(v.lower()):
                if w not in _STOPWORDS:
                    counter[w] += 1
        words = [{"word": w, "count": c} for w, c in counter.most_common(30)]
        recent = [v for v in values if isinstance(v, str) and v.strip()][-8:]
        return {**base, "chart": "wordcloud", "n": len(values), "data": {"words": words, "recent": recent}}

    return None  # unrecognized/unsupported block type — omitted from the summary


def build_live_summary(project, responses):
    """{title, response_count, last_submitted_at, blocks: [...]}."""
    answers_by_block = {}
    last_submitted_at = None
    for r in responses:
        submitted = r.get("submitted_at")
        if submitted and (last_submitted_at is None or submitted > last_submitted_at):
            last_submitted_at = submitted
        for a in r.get("answers", []):
            bid = a.get("block_id")
            if bid:
                answers_by_block.setdefault(bid, []).append(a)

    blocks_out = []
    for page in project.get("pages", []):
        for blk in page.get("blocks", []):
            if blk["type"] in EXCLUDED_BLOCK_TYPES:
                continue
            summarized = _summarize_block(blk, answers_by_block.get(blk["id"], []))
            if summarized:
                blocks_out.append(summarized)

    return {
        "title": project.get("title", ""),
        "response_count": len(responses),
        "last_submitted_at": last_submitted_at,
        "blocks": blocks_out,
    }
