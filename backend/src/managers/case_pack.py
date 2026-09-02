# @language  Python
# @updated   2026-08-22
# @changed   The rendered Tally header no longer tells ACTR that "students must count them out loud".
#            It now bars only the case's real totals (the answer key) and says outright that counting
#            what the students have named SO FAR is a different number and ACTR's own job — the old
#            wording fought the new COUNTING section in facilitator_prompt.
# @changed   Prior: render_case_pack binds the "one concern or two?" move to its operands — the COLLAPSE PAIRS
#            block is now declared the only permitted pairing, strength-vs-concern is ruled out explicitly,
#            and options with no pairs say so instead of staying silent (ACTR was inventing a pair).
#            Prior: restored the optional general-information document, carried onto the pack verbatim so the
#            facilitator can quote what the ROLE requires when the group argues about which failure costs more.
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

**How the count is kept stable.** An earlier version asked the model to find
"groups of equivalent items" in one pass. That is an open-ended hunt, and it
returned a different answer every run — always *fewer* items, because
over-grouping only ever deletes. Counting the same case three times gave 8, then
7, then 6. The judgment is now split so the model never chooses what to compare:

    1 EXTRACT      model, temp 0   per-role items, verbatim. No grouping at all.
    2 PAIR         Python          cross-role pairs whose wording actually overlaps
    3 ADJUDICATE   model, temp 0   "same fact, yes or no?" on just those pairs
    4 COUNT        Python          collapse confirmed merges, count distinct
    5 VALIDATE     Python          compare against totals stated in the document

Steps 2 and 4 are pure Python, so identical items always yield identical pairs
and identical counts. The model can no longer merge two unrelated strengths
because it is never shown them together.

The pack (and especially `answer_key`) is AI-only. It must never appear in a
payload sent to a student client.
"""
import logging
import os
import re

from src.utils.models import sampling_kwargs

logger = logging.getLogger(__name__)

# Extraction reads several pages of prose and must not miss items, so it runs on
# the reasoning-tier model rather than the cheap conversational one.
EXTRACTION_MODEL = os.getenv("CASE_PACK_MODEL", "claude-sonnet-4-6")
EXTRACTION_MAX_TOKENS = 8000
ADJUDICATION_MAX_TOKENS = 2000

# Both calls are pinned. The tally must not move between two analyses of the same
# documents — a professor who re-runs Analyse and gets a different answer key has
# no way to tell which one is right.
CALL_TEMPERATURE = 0

# Word-overlap thresholds for pairing two phrasings (Jaccard over word sets).
#   >= AUTO : all but identical — merge without asking.
#   <  ASK  : nothing meaningful in common — never merge, never ask. This is the
#             band that used to swallow "ROI articles" vs "financial detail" (0.00).
#   between : a real question the model answers, e.g. "passive with superiors" vs
#             "becomes passive when dealing with more powerful executives" (0.27),
#             or "…subordinates' effort" vs "…subordinates' efforts" (0.71).
# AUTO stays high deliberately: near-misses like "passive with superiors" vs
# "passive with subordinates" also score in the 0.8s and are NOT the same fact.
MERGE_AUTO_SIMILARITY = 0.85
MERGE_ASK_MIN_SIMILARITY = 0.15

# A confirmed merge above this overlap is one wording with a typo or an inflection,
# not a genuine rewording. It still collapses in the count, but it must not reach
# the facilitator as discussion fuel: asking a group "one concern or two?" about
# "effort" vs "efforts" is nonsense, and for the strongest candidate that concern
# is meant to land as one note echoed by everyone.
REWORD_SIMILARITY_CEILING = 0.6

# Per-document cap. Generous — a full case packet is well under this — but it
# stops a pathological upload from blowing the context window.
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
                                "Copy each item as a short phrase, close to the document's wording. "
                                "List every bullet exactly once, in document order."
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
                        "stated_strengths": {
                            "type": ["integer", "null"],
                            "description": (
                                "If the document explicitly states a strengths TOTAL for this candidate "
                                "(e.g. a 'Total: 8 strengths' row), copy that number. Otherwise null. "
                                "Do not compute it yourself."
                            ),
                        },
                        "stated_concerns": {
                            "type": ["integer", "null"],
                            "description": (
                                "If the document explicitly states a concerns TOTAL for this candidate, "
                                "copy that number. Otherwise null. Do not compute it yourself."
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
                    "required": ["name", "per_role", "outcome_verdict", "outcome_summary"],
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
    "You transcribe the documents of a hidden-profile group decision exercise into structured data.\n\n"
    "In such an exercise several people each hold a confidential packet about the same set of "
    "options. Each packet is a partial view: some facts appear in every packet, others in only one. "
    "The packets are usually built so the strongest option looks unremarkable to any single reader.\n\n"
    "This is TRANSCRIPTION, not analysis. For each option and each role, list the strengths, the "
    "concerns, and the neutral/irrelevant details, staying close to the document's own wording. "
    "Copy every bullet exactly once.\n\n"
    "Do NOT count anything. Do NOT rank the options. Do NOT decide which is best. Do NOT merge, "
    "combine, deduplicate or summarise items — two bullets that look related are still two bullets, "
    "and collapsing them destroys the tally that is computed downstream. If a role's list has three "
    "bullets, emit three items.\n\n"
    "Call emit_case_pack exactly once."
)

_MERGE_TOOL = {
    "name": "emit_merge_verdicts",
    "description": "Decide, for each supplied pair, whether the two phrasings are the same fact.",
    "input_schema": {
        "type": "object",
        "properties": {
            "verdicts": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "id": {"type": "string", "description": "The pair id, copied exactly."},
                        "same_fact": {"type": "boolean"},
                        "note": {
                            "type": "string",
                            "description": "Short reason, at most one clause.",
                        },
                    },
                    "required": ["id", "same_fact", "note"],
                },
            }
        },
        "required": ["verdicts"],
    },
}

_MERGE_SYSTEM = (
    "You are given pairs of phrases taken from different people's confidential packets about the "
    "same candidate. For each pair, decide one thing: are these the SAME FACT reported twice in "
    "different words, or two different facts?\n\n"
    "The bar is narrow. Two items are NOT the same fact merely because they are related, sit in the "
    "same theme, or point at the same broad competence.\n\n"
    "  SAME FACT:      'can be passive with superiors' / 'becomes passive when dealing with more\n"
    "                   powerful executives'  -> one trait, two phrasings.\n"
    "  DIFFERENT:      'published articles on improving return on investment' / 'excellent attention\n"
    "                   to financial detail'  -> both financial, two different accomplishments.\n"
    "  DIFFERENT:      'CFA' / 'worked in the finance division'  -> two separate credentials.\n"
    "  DIFFERENT:      'can be passive with superiors' / 'often late to meetings'  -> unrelated.\n\n"
    "When you are unsure, answer false. Wrongly merging deletes a real item from the count and "
    "corrupts the exercise; wrongly splitting does not.\n\n"
    "Return one verdict per pair, copying each id exactly. Call emit_merge_verdicts once."
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


def _tool_result(msg, name):
    """Pull the input of a forced tool call out of an Anthropic message. None if absent."""
    for block in (getattr(msg, "content", None) or []):
        if getattr(block, "type", None) == "tool_use" and getattr(block, "name", "") == name:
            return block.input
    return None


def _norm(text):
    """Normalize an item for matching: casefold, drop punctuation, collapse space.

    Used as the identity key when counting, so "CFA." and "cfa" collapse without
    anyone having to declare them equivalent.
    """
    return re.sub(r"[^a-z0-9 ]+", " ", (text or "").lower()).strip()


def _similarity(a, b):
    """Jaccard overlap of two normalized phrases' word sets (1.0 == same words)."""
    ta, tb = set(a.split()), set(b.split())
    if not ta or not tb:
        return 0.0
    return len(ta & tb) / len(ta | tb)


def _role_items(option, field):
    """[(role, text, normalized)] for one field across every role of an option."""
    out = []
    for role, view in (option.get("per_role") or {}).items():
        for item in ((view or {}).get(field) or []):
            key = _norm(item)
            if key:
                out.append((role, item, key))
    return out


def _all_items(option, field):
    """Flatten one field across every role of an option."""
    return [text for _role, text, _key in _role_items(option, field)]


def _merge_candidates(option, prefix):
    """Every pair of items in `option` that could plausibly be the same fact.

    Deterministic — the same extracted items always produce the same pair list, in
    the same order, which is what makes the final count reproducible. Three rules
    do the filtering:

      * strengths pair only with strengths, concerns only with concerns;
      * **never two items from the same role** — within one packet every listed
        item is a separate fact by construction, so a same-packet merge is always
        wrong. This is what used to delete one of Jacky Chan's strengths;
      * the wordings must actually overlap. Below MERGE_ASK_MIN_SIMILARITY the
        pair is not merged and not even shown to the model, which removes its
        opportunity to invent a merge between unrelated items.

    Pairs at or above MERGE_AUTO_SIMILARITY are confirmed here (an inflection, not
    a rewording); the rest come back unconfirmed for adjudication.
    """
    merges = []
    for field in ("strengths", "concerns"):
        entries = _role_items(option, field)
        for i, (role_a, text_a, key_a) in enumerate(entries):
            for role_b, text_b, key_b in entries[i + 1:]:
                if role_a == role_b or key_a == key_b:
                    # Same packet -> two facts. Identical wording -> already one.
                    continue
                sim = _similarity(key_a, key_b)
                if sim < MERGE_ASK_MIN_SIMILARITY:
                    continue
                auto = sim >= MERGE_AUTO_SIMILARITY
                merges.append({
                    "id": f"{prefix}-{field[0]}{len(merges) + 1}",
                    "field": field,
                    "a": f"{role_a}: {text_a}",
                    "b": f"{role_b}: {text_b}",
                    "a_key": key_a,
                    "b_key": key_b,
                    "similarity": round(sim, 3),
                    "source": "auto" if auto else "model",
                    "confirmed": auto,
                    "note": "near-identical wording" if auto else "",
                })
    return merges


def _adjudicate(client, merges):
    """Ask the model, in one call, which candidate pairs are genuinely the same fact.

    Fail-soft: on any error nothing is confirmed. A conservative tally counts an
    item twice, which the professor can see and fix in the review step; a
    silently-deleted item looks exactly like a correct answer.
    """
    pending = [m for m in merges if m.get("source") == "model"]
    if not pending or client is None:
        return

    lines = [
        f'{m["id"]}  [{m["field"]}]\n    A: {m["a"]}\n    B: {m["b"]}'
        for m in pending
    ]
    user = "Decide each pair:\n\n" + "\n\n".join(lines)

    try:
        msg = client.messages.create(
            model=EXTRACTION_MODEL,
            max_tokens=ADJUDICATION_MAX_TOKENS,
            **sampling_kwargs(EXTRACTION_MODEL, CALL_TEMPERATURE),
            system=_MERGE_SYSTEM,
            tools=[_MERGE_TOOL],
            tool_choice={"type": "tool", "name": "emit_merge_verdicts"},
            messages=[{"role": "user", "content": user}],
        )
    except Exception:  # noqa: BLE001
        logger.exception("case_pack: merge adjudication failed; no pairs merged")
        return

    raw = _tool_result(msg, "emit_merge_verdicts") or {}
    verdicts = {v.get("id"): v for v in (raw.get("verdicts") or []) if isinstance(v, dict)}
    by_id = {m["id"]: m for m in pending}
    for pair_id, verdict in verdicts.items():
        m = by_id.get(pair_id)
        if not m:
            continue
        m["confirmed"] = bool(verdict.get("same_fact"))
        m["note"] = (verdict.get("note") or "").strip()


def _canonical_map(merges):
    """{normalized item -> class representative} from the CONFIRMED merges only.

    Union-find so overlapping merges chain into one class. Unconfirmed pairs are
    ignored entirely, which is what lets a professor untick one in the review step
    and see the count go back up.
    """
    parent = {}

    def find(x):
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for m in merges or []:
        if not m.get("confirmed"):
            continue
        a, b = m.get("a_key"), m.get("b_key")
        if not a or not b:
            continue
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra
    return {k: find(k) for k in list(parent)}


def _distinct(items, canon):
    """Count distinct items after collapsing identical wording and confirmed merges."""
    seen = set()
    for item in items or []:
        key = _norm(item)
        if not key:
            continue
        seen.add(canon.get(key, key))
    return len(seen)


def _collapse_pairs(merges):
    """The "same concern, different wording" pairs ACTR may open on.

    Confirmed CONCERN merges only, and only those that are genuinely reworded —
    anything above REWORD_SIMILARITY_CEILING is the same sentence with a typo, and
    a group asked "one concern or two?" about it would rightly be baffled.
    """
    return [
        [m["a"], m["b"]]
        for m in merges or []
        if m.get("confirmed")
        and m.get("field") == "concerns"
        and m.get("similarity", 1.0) < REWORD_SIMILARITY_CEILING
    ]


def _validate(pack):
    """Compare the computed tally against any totals the document states for itself.

    Warnings only — the computed number still stands. But a case that says "8
    strengths" while the analysis found 6 is exactly the failure that is invisible
    once the exercise is running, so it belongs in front of the professor.
    """
    warnings = []
    for opt in pack.get("options") or []:
        for field, stated_key in (("strengths", "stated_strengths"), ("concerns", "stated_concerns")):
            stated = opt.get(stated_key)
            if not isinstance(stated, int):
                continue
            got = opt.get(f"distinct_{field}")
            if got != stated:
                warnings.append(
                    f"{opt.get('name', '?')}: the document states {stated} {field}, "
                    f"but the analysis found {got}."
                )
    pack["warnings"] = warnings
    return pack


def recompute(pack):
    """Re-derive every counted field from the raw items + confirmed merges. Returns the pack.

    Called after analysis AND after a professor edits the pack, so the tally can
    never drift from the items and merges it summarizes. This is the single place
    distinct counts and `best_option` are decided — no model is involved.
    """
    if not isinstance(pack, dict):
        return pack
    options = pack.get("options") or []
    for opt in options:
        canon = _canonical_map(opt.get("merges"))
        opt["distinct_strengths"] = _distinct(_all_items(opt, "strengths"), canon)
        opt["distinct_concerns"] = _distinct(_all_items(opt, "concerns"), canon)
        opt["collapse_pairs"] = _collapse_pairs(opt.get("merges"))

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
    return _validate(pack)


def build_case_pack(general_info_text, candidate_summary_text, candidates):
    """Extract a case pack from the uploaded documents. Returns (pack, error).

    `candidate_summary_text` (every role's private view) and one outcome document
    per candidate — `candidates` is `[{name, forecast_text}]` — are what the tally
    is derived from and are required.

    `general_info_text` is optional and is not extracted from at all: it is
    carried through onto the pack so the facilitator can quote what the ROLE
    requires. That is the only thing that settles an argument about which of two
    failures costs more, which comparing candidates against each other cannot.

    On any failure returns `(None, "<reason>")` so the caller can block the config
    save rather than shipping an exercise with an empty answer key.
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
            **sampling_kwargs(EXTRACTION_MODEL, CALL_TEMPERATURE),
            system=_EXTRACTION_SYSTEM,
            tools=[_EXTRACTION_TOOL],
            tool_choice={"type": "tool", "name": "emit_case_pack"},
            messages=[{"role": "user", "content": user}],
        )
    except Exception as e:  # noqa: BLE001
        logger.exception("case_pack extraction call failed")
        return None, f"Case analysis failed: {e}"

    raw = _tool_result(msg, "emit_case_pack")
    if not isinstance(raw, dict) or not raw.get("options"):
        return None, "Case analysis returned no usable result. Check the uploaded documents."

    options = raw.get("options") or []
    # Propose merges in Python first, then adjudicate them all in one narrow call.
    for idx, opt in enumerate(options):
        opt["merges"] = _merge_candidates(opt, f"o{idx + 1}")
    _adjudicate(client, [m for opt in options for m in opt["merges"]])

    pack = {
        "case_name": raw.get("case_name") or "",
        "roles": raw.get("roles") or [],
        # Verbatim, not extracted: the facilitator quotes this back at the group.
        "general_info": (general_info_text or "").strip()[:_MAX_DOC_CHARS],
        "criterion": "most distinct strengths, fewest distinct concerns",
        "collapse_rule": (
            "items describing the same underlying behaviour collapse to one, regardless of "
            "how many roles report them"
        ),
        "options": options,
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
    ]

    if (pack.get("general_info") or "").strip():
        lines += [
            "",
            "## The role and the setting",
            "Reach for this when the group is arguing about which failure matters more."
            " It is what the job actually requires, and it settles arguments that",
            "comparing candidates against each other cannot. Quoting it is allowed —"
            " unlike the tally, this is not an answer key.",
            "",
            pack["general_info"].strip(),
        ]

    lines += [
        "",
        # Only the case's real totals are the answer key. The count of what the students
        # have actually named so far is a different number and ACTR is required to keep
        # it — see COUNTING in the facilitator prompt. Conflating the two is what made it
        # refuse to answer "did we name all of them".
        "## Tally (the answer key — never state these numbers. Counting what the students",
        "have named SO FAR is a different number and is your job: say that one freely.)",
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
        # The "one concern or two?" move, bound to its operands. Unbound, the prompt
        # handed ACTR the phrasing but not the target, and it fired the move at a
        # STRENGTH against a concern — not a collapse at all — then held that reading
        # against a group that had counted correctly. Only confirmed concern-vs-concern
        # rewordings ever reach `collapse_pairs`, so naming them as the whole permitted
        # set is enough to make the misfire unavailable.
        if opt.get("collapse_pairs"):
            lines.append(
                "  COLLAPSE PAIRS — the ONLY pairings you may ask 'one concern or two?' about. "
                "Opening that move means quoting both sides of ONE pair below:"
            )
            for pair in opt["collapse_pairs"]:
                lines.append("    - " + "  ||  ".join(pair))
            lines.append(
                "    Never open it on any other pairing, and never on a strength against a "
                "concern — those are two different columns, not one item worded twice."
            )
        else:
            lines.append(
                "  COLLAPSE PAIRS: none. Every concern listed above is a separate fact, so "
                "never ask 'one concern or two?' about this option."
            )
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
    """True iff `name` is the pack's best option — gates whether a re-choice is permitted."""
    key = (pack or {}).get("answer_key") or {}
    return (key.get("best_option") or "").strip().lower() == (name or "").strip().lower()
