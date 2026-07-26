# @language  Python
# @updated   2026-07-27
# @changed   Dropped the general-information input: an authored case is a candidate summary plus one
#            outcome document per candidate, nothing else.
"""Turn a professor's uploaded case documents into a **case pack**.

The facilitator system prompt is a static constant that never changes per case
(`facilitator_prompt.FACILITATOR_PROMPT`). Everything case-specific lives in the
pack this module builds: who the candidates are, which role sees which fact, the
pooled tally, and the answer key. Uploading a new case generates a new pack — it
never rewrites a prompt.

**Why derive once at config save rather than per turn.** The pooled tally is the
spine of the exercise; a facilitator that recounts from retrieved chunks on every
turn will drift, and one that misremembers its own answer key mid-session
destroys the lesson. So the pack is built once, stored on the config doc, shown
to the professor for review, and read verbatim thereafter.

**Split of labour.** The model does extraction only — reading prose and listing
which items each role holds, plus which differently-worded items mean the same
thing. Python does every count (`recompute`), so the tally is deterministic and
survives a professor editing the pack by hand.

The pack (and especially `answer_key`) is AI-only. It must never appear in a
payload sent to a student client.
"""
import logging
import os
import re

logger = logging.getLogger(__name__)

# Extraction reads several pages of prose and must not miss items, so it runs on
# the reasoning-tier model rather than the cheap conversational one.
EXTRACTION_MODEL = os.getenv("CASE_PACK_MODEL", "claude-sonnet-4-6")
EXTRACTION_MAX_TOKENS = 8000

# Per-document caps. Generous — a full case packet is well under this — but they
# stop a pathological upload from blowing the context window.
_MAX_DOC_CHARS = 40000

_EXTRACTION_TOOL = {
    "name": "emit_case_pack",
    "description": "Emit the structured case pack extracted from the uploaded case documents.",
    "input_schema": {
        "type": "object",
        "properties": {
            "case_name": {"type": "string", "description": "Short human name for the case."},
            "roles": {
                "type": "array",
                "items": {"type": "string"},
                "description": "The confidential roles, exactly as named in the documents.",
            },
            "options": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "name": {"type": "string"},
                        "per_role": {
                            "type": "object",
                            "description": (
                                "Map of role name -> {strengths, concerns, neutral}. One entry per role. "
                                "Copy each item as a short phrase, close to the document's wording."
                            ),
                            "additionalProperties": {
                                "type": "object",
                                "properties": {
                                    "strengths": {"type": "array", "items": {"type": "string"}},
                                    "concerns": {"type": "array", "items": {"type": "string"}},
                                    "neutral": {"type": "array", "items": {"type": "string"}},
                                },
                                "required": ["strengths", "concerns", "neutral"],
                            },
                        },
                        "equivalent_groups": {
                            "type": "array",
                            "items": {"type": "array", "items": {"type": "string"}},
                            "description": (
                                "Groups of items for THIS option that describe the same underlying "
                                "fact or behaviour in different words, and must therefore be counted "
                                "once. Quote the items exactly as emitted above. Verbatim repeats "
                                "across roles do not need a group; only reworded ones do."
                            ),
                        },
                        "outcome_verdict": {"type": "string", "enum": ["success", "failure"]},
                        "outcome_summary": {
                            "type": "string",
                            "description": "2-4 sentence summary of this option's outcome document, shown to students on pick.",
                        },
                        "reconvene_reason": {
                            "type": "string",
                            "description": "Why the committee is being reconvened in this option's outcome document.",
                        },
                    },
                    "required": ["name", "per_role", "equivalent_groups", "outcome_verdict", "outcome_summary"],
                },
            },
            "mechanism": {
                "type": "string",
                "description": (
                    "One sentence naming the hidden-profile trap in THIS case — how the information "
                    "is distributed such that the strongest option looks weak."
                ),
            },
            "tension_pairs": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "option": {"type": "string"},
                        "strength": {"type": "string"},
                        "concern": {"type": "string"},
                        "note": {"type": "string"},
                    },
                    "required": ["option", "strength", "concern", "note"],
                },
                "description": (
                    "Cases where one option has a STRENGTH and a CONCERN that plausibly describe the "
                    "same behaviour seen from different vantage points (e.g. 'demanding but fair' vs "
                    "'micromanages'). These are deliberately NOT collapsed — they are discussion fuel."
                ),
            },
        },
        "required": ["case_name", "roles", "options", "mechanism", "tension_pairs"],
    },
}

_EXTRACTION_SYSTEM = (
    "You extract structured data from the documents of a hidden-profile group decision exercise.\n\n"
    "In such an exercise several people each hold a confidential packet about the same set of "
    "options. Each packet is a partial view: some facts appear in every packet, others in only one. "
    "The packets are usually built so the strongest option looks unremarkable to any single reader.\n\n"
    "Your job is EXTRACTION ONLY. Do not count anything, do not rank the options, and do not decide "
    "which is best — those are computed downstream. List, per option and per role, the strengths, "
    "the concerns, and the neutral/irrelevant details, staying close to the document's own wording.\n\n"
    "The one judgement you must make is equivalence: when two items describe the same underlying "
    "fact or behaviour in different words, put them in the same equivalent_group so they are counted "
    "once. Be conservative — group only genuine restatements, not merely related items.\n\n"
    "Call emit_case_pack exactly once."
)


def _get_client():
    """Return an Anthropic client, or None if key/package unavailable. Never raises."""
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        return None
    try:
        import anthropic
    except ImportError:
        return None
    try:
        return anthropic.Anthropic(api_key=api_key)
    except Exception:  # noqa: BLE001
        return None


def _norm(text):
    """Normalize an item for equivalence matching: casefold, drop punctuation, collapse space.

    Used as the identity key when counting distinct items, so "CFA." and "cfa"
    collapse without needing the model to declare them equivalent.
    """
    return re.sub(r"[^a-z0-9 ]+", " ", (text or "").lower()).strip()


def _canonical_map(equivalent_groups):
    """Build {normalized item -> class representative} from the model's equivalence groups.

    Every member of a group maps to the group's first member, so counting unique
    representatives collapses reworded duplicates alongside verbatim ones.
    """
    canon = {}
    for group in equivalent_groups or []:
        members = [_norm(g) for g in (group or []) if _norm(g)]
        if len(members) < 2:
            continue
        rep = members[0]
        for m in members:
            # Chain into an existing class if this group overlaps a previous one.
            canon[m] = canon.get(rep, rep)
    return canon


def _distinct(items, canon):
    """Count distinct items after collapsing verbatim repeats and declared equivalences."""
    seen = set()
    for item in items or []:
        key = _norm(item)
        if not key:
            continue
        seen.add(canon.get(key, key))
    return len(seen)


def _all_items(option, field):
    """Flatten one field ("strengths"/"concerns") across every role of an option."""
    out = []
    for role_view in (option.get("per_role") or {}).values():
        out.extend((role_view or {}).get(field) or [])
    return out


# Token overlap above which two phrasings are treated as the SAME wording rather
# than a genuine rewording. "…subordinates' effort" vs "…subordinates' efforts"
# scores ~0.71 and must not surface; "passive with superiors" vs "becomes passive
# with more powerful executives" scores ~0.27 and must.
_REWORD_SIMILARITY_CEILING = 0.6


def _similarity(a, b):
    """Jaccard overlap of two normalized phrases' word sets (1.0 == same words)."""
    ta, tb = set(a.split()), set(b.split())
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def _collapse_pairs(option, canon):
    """Readable "these two concerns are the same concern" pairs for the facilitator.

    Only genuinely REWORDED concerns count. A concern every role reports in the
    same words is a different teaching beat — it is one note echoed three times,
    and asking "one concern or two?" about it would be nonsense. Verbatim repeats
    are therefore excluded, and so are trivial morphological variants (a stray
    singular/plural in one packet), which are verbatim repeats with a typo.

    Rendered as "Role: item" so the facilitator can put it to the two students who
    actually hold the wordings.
    """
    by_class = {}
    for role, view in (option.get("per_role") or {}).items():
        for concern in (view or {}).get("concerns") or []:
            key = _norm(concern)
            if not key:
                continue
            by_class.setdefault(canon.get(key, key), []).append((role, concern, key))

    pairs = []
    for members in by_class.values():
        if len(members) < 2:
            continue
        wordings = {m[2] for m in members}
        if len(wordings) < 2:
            continue   # identical across roles — an echo, not a rewording
        # Surface only if some pair is actually worded differently, not just inflected.
        distinct = any(
            _similarity(x, y) < _REWORD_SIMILARITY_CEILING
            for i, x in enumerate(sorted(wordings))
            for y in sorted(wordings)[i + 1:]
        )
        if distinct:
            pairs.append([f"{role}: {text}" for role, text, _ in members])
    return pairs


def recompute(pack):
    """Re-derive every counted field from the pack's raw per-role items. Returns the pack.

    Called after extraction AND after a professor edits the pack, so the tally can
    never drift from the items it is supposed to summarize. This is the single
    place distinct counts and `best_option` are decided — the model never counts.
    """
    if not isinstance(pack, dict):
        return pack
    options = pack.get("options") or []
    for opt in options:
        canon = _canonical_map(opt.get("equivalent_groups"))
        opt["distinct_strengths"] = _distinct(_all_items(opt, "strengths"), canon)
        opt["distinct_concerns"] = _distinct(_all_items(opt, "concerns"), canon)
        opt["collapse_pairs"] = _collapse_pairs(opt, canon)

    # Best = most distinct strengths, fewest distinct concerns. Ties break on roster
    # order so a rebuild always names the same option. A professor who overrode the
    # pick in the review step sets `best_option_locked`, which wins over the tally —
    # they have read the case and the extraction may have missed something.
    answer_key = pack.setdefault("answer_key", {})
    if options and not answer_key.get("best_option_locked"):
        best = min(
            enumerate(options),
            key=lambda kv: (-kv[1].get("distinct_strengths", 0), kv[1].get("distinct_concerns", 0), kv[0]),
        )[1]
        answer_key["best_option"] = best.get("name", "")
    answer_key.setdefault("mechanism", "")
    answer_key.setdefault("tension_pairs", [])
    return pack


def build_case_pack(candidate_summary_text, candidates):
    """Extract a case pack from the uploaded documents. Returns (pack, error).

    Two inputs, which is all an authored case actually has: the candidate summary
    (every role's private view, side by side) and one outcome document per
    candidate — `candidates` is `[{name, forecast_text}]`. On any failure returns
    `(None, "<reason>")` so the caller can block the config save rather than
    shipping an exercise with an empty answer key.
    """
    client = _get_client()
    if client is None:
        return None, "Case analysis is unavailable (ANTHROPIC_API_KEY missing or anthropic package not installed)."

    summary = (candidate_summary_text or "").strip()
    if not summary:
        return None, "A Candidate Summary document is required to build the case pack."

    outcome_blocks = []
    for c in candidates or []:
        name = (c.get("name") or "").strip()
        text = (c.get("forecast_text") or "").strip()
        if name and text:
            outcome_blocks.append(f"### Outcome document — {name}\n{text[:_MAX_DOC_CHARS]}")
    if not outcome_blocks:
        return None, "Each candidate needs an uploaded outcome document before the case pack can be built."

    user = "\n\n".join([
        "## Candidate summary (what each role privately holds)\n" + summary[:_MAX_DOC_CHARS],
        "\n\n".join(outcome_blocks),
        "Extract the case pack now.",
    ])

    try:
        msg = client.messages.create(
            model=EXTRACTION_MODEL,
            max_tokens=EXTRACTION_MAX_TOKENS,
            system=_EXTRACTION_SYSTEM,
            tools=[_EXTRACTION_TOOL],
            tool_choice={"type": "tool", "name": "emit_case_pack"},
            messages=[{"role": "user", "content": user}],
        )
    except Exception as e:  # noqa: BLE001
        logger.exception("case_pack extraction call failed")
        return None, f"Case analysis failed: {e}"

    raw = None
    for block in (getattr(msg, "content", None) or []):
        if getattr(block, "type", None) == "tool_use":
            raw = block.input
            break
    if not isinstance(raw, dict) or not raw.get("options"):
        return None, "Case analysis returned no usable result. Check the uploaded documents."

    pack = {
        "case_name": raw.get("case_name") or "",
        "roles": raw.get("roles") or [],
        "criterion": "most distinct strengths, fewest distinct concerns",
        "collapse_rule": (
            "items describing the same underlying behaviour collapse to one, regardless of "
            "how many roles report them"
        ),
        "options": raw.get("options") or [],
        "answer_key": {
            "mechanism": raw.get("mechanism") or "",
            "tension_pairs": raw.get("tension_pairs") or [],
        },
    }
    return recompute(pack), None


def render_case_pack(pack):
    """Render the pack as the prompt-injected CASE DATA block.

    Deterministic plain text rather than JSON: the facilitator reads this as
    reference material, and prose survives paraphrase pressure better than a
    nested object. Ordering is stable so the prompt prefix stays cacheable.
    """
    if not isinstance(pack, dict) or not pack.get("options"):
        return "(no case data available)"

    lines = [
        f"Case: {pack.get('case_name') or 'untitled'}",
        f"Roles: {', '.join(pack.get('roles') or []) or 'unspecified'}",
        f"Criterion: {pack.get('criterion')}",
        f"Collapse rule: {pack.get('collapse_rule')}",
        "",
        "## Tally (never state these numbers — students must count them out loud)",
    ]
    for opt in pack["options"]:
        lines.append(
            f"  {opt.get('name', '?')}: {opt.get('distinct_strengths', 0)} distinct strengths / "
            f"{opt.get('distinct_concerns', 0)} distinct concerns  [outcome: {opt.get('outcome_verdict', '?')}]"
        )

    lines.append("")
    lines.append("## Who holds what")
    for opt in pack["options"]:
        lines.append(f"\n### {opt.get('name', '?')}")
        for role, view in (opt.get("per_role") or {}).items():
            v = view or {}
            lines.append(f"  {role}:")
            lines.append(f"    strengths: {'; '.join(v.get('strengths') or []) or '(none)'}")
            lines.append(f"    concerns:  {'; '.join(v.get('concerns') or []) or '(none)'}")
            if v.get("neutral"):
                lines.append(f"    neutral:   {'; '.join(v['neutral'])}")
        if opt.get("collapse_pairs"):
            lines.append("  COLLAPSE PAIRS (same concern, different wording — ask 'one concern or two?'):")
            for pair in opt["collapse_pairs"]:
                lines.append("    - " + "  ||  ".join(pair))
        if opt.get("outcome_summary"):
            lines.append(f"  Outcome: {opt['outcome_summary']}")
        if opt.get("reconvene_reason"):
            lines.append(f"  Reconvene reason: {opt['reconvene_reason']}")

    key = pack.get("answer_key") or {}
    lines.append("")
    lines.append("## Answer key — AI ONLY, never state or hint at any of this")
    lines.append(f"  Best option: {key.get('best_option') or '(undetermined)'}")
    if key.get("mechanism"):
        lines.append(f"  Mechanism: {key['mechanism']}")
    for tp in key.get("tension_pairs") or []:
        lines.append(
            f"  TENSION PAIR ({tp.get('option', '?')}): strength \"{tp.get('strength', '')}\" vs "
            f"concern \"{tp.get('concern', '')}\" — {tp.get('note', '')}. Surface it; do NOT resolve it."
        )
    return "\n".join(lines)


def option_by_name(pack, name):
    """Look up one option in the pack by candidate name (exact, then case-insensitive)."""
    if not isinstance(pack, dict):
        return None
    target = (name or "").strip()
    for opt in pack.get("options") or []:
        if (opt.get("name") or "").strip() == target:
            return opt
    for opt in pack.get("options") or []:
        if (opt.get("name") or "").strip().lower() == target.lower():
            return opt
    return None


def is_top_choice(pack, name):
    """True iff `name` is the pack's best option — drives whether ACTR reopens the ballot."""
    key = (pack or {}).get("answer_key") or {}
    return (key.get("best_option") or "").strip().lower() == (name or "").strip().lower()
