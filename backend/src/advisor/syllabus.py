# @language  Python
# @updated   2026-08-12
# @changed   New file: the three advisor stages — parse a syllabus into sessions, recommend a
#            feature per session grounded in the catalog, then drop every claim that fails a
#            deterministic check.
"""Syllabus in, grounded recommendations out.

Three stages, and the split is the point:

  1. `extract_sessions` — syllabus prose to a structured session list. A dumb,
     mechanical job; run cheap.
  2. `recommend` — the judgment call, made against `catalog.py` and nothing else.
  3. `validate` — plain Python. Drops recommendations that quote text the
     syllabus does not contain, name a feature that does not exist, or declare a
     strong fit for most of the term.

Stage 3 exists because stage 2 fails in exactly one direction: it wants to be
helpful, so it finds a use for the platform in every week of the course. A
professor shown eight strong fits in a thirteen-week term stops believing the
second one, and the whole exercise is worthless. So the prompt states the prior
("most sessions are not a fit") and the code enforces it afterwards, because a
prompt rule the model is motivated to bend is not a rule.

No Flask in here — `routes/advisor_routes.py` owns HTTP, this owns the thinking.
"""
import json
import logging
import os
import re

from src.advisor import catalog

logger = logging.getLogger(__name__)

# Opus for the recommendation: this is the judgment the whole demo rests on, and
# a wrong-but-confident recommendation costs more than the tokens saved. The
# extraction stage runs on the same model at low effort — it is transcription.
ADVISOR_MODEL = os.getenv("ADVISOR_MODEL", "claude-opus-5")

# Generous because thinking is on by default on this model and max_tokens caps
# thinking plus visible output together — a tight cap truncates the JSON.
EXTRACT_MAX_TOKENS = 8000
RECOMMEND_MAX_TOKENS = 16000
REFINE_MAX_TOKENS = 12000

# Syllabi are short; anything past this is a course pack that got uploaded by
# mistake. Truncating beats a 30-second call on 400 pages of readings.
MAX_SYLLABUS_CHARS = 60000

# A quoted span shorter than this cannot identify anything — "week 3" appears in
# every syllabus ever written, so it would let a fabricated claim pass the
# grounding check on a coincidence.
MIN_EVIDENCE_CHARS = 12

# Above this share of sessions marked `strong`, the weakest get demoted. Four
# genuinely strong fits in a ten-week course is a good result; eight is the
# model being agreeable, and agreeable is what destroys the professor's trust.
MAX_STRONG_SHARE = 0.4


# ---------------------------------------------------------------------------
# Stage 1 — syllabus text to structured sessions
# ---------------------------------------------------------------------------

# Every field required and additionalProperties false: structured outputs will
# not emit a partial object, so downstream code never guards for missing keys.
# Unknowns come back as "" or 0 rather than absent.
_SESSIONS_SCHEMA = {
    "type": "object",
    "properties": {
        "course": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "code": {"type": "string"},
                "level": {"type": "string", "description": "undergraduate, masters, MBA, PhD, or ''"},
                "class_length_minutes": {"type": "integer", "description": "0 if not stated"},
                "class_size": {"type": "integer", "description": "0 if not stated"},
            },
            "required": ["title", "code", "level", "class_length_minutes", "class_size"],
            "additionalProperties": False,
        },
        "sessions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "index": {"type": "integer", "description": "1-based position in the term"},
                    "label": {"type": "string", "description": "e.g. 'Week 4' or 'Session 7 - Oct 12'"},
                    "topic": {"type": "string"},
                    "activities": {
                        "type": "array",
                        "items": {"type": "string"},
                        "description": "What students DO this session: discussion, case, presentation, "
                                       "lecture, exam, lab, group work. [] if the syllabus only names a topic.",
                    },
                    "assessment": {"type": "string", "description": "Anything graded this session, else ''"},
                    "verbatim": {
                        "type": "string",
                        "description": "The syllabus text this session was read from, copied EXACTLY, "
                                       "character for character. Never paraphrased.",
                    },
                },
                "required": ["index", "label", "topic", "activities", "assessment", "verbatim"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["course", "sessions"],
    "additionalProperties": False,
}

_EXTRACT_SYSTEM = (
    "You read university syllabi and turn the class schedule into structured data. "
    "You are a transcriber, not an interpreter.\n\n"
    "Rules:\n"
    "- One entry per class session in the schedule. If the syllabus is organized by week and each "
    "week is one meeting, that is one session per week.\n"
    "- `verbatim` must be copied from the syllabus EXACTLY as written — the same characters, in the "
    "same order. It is used later to check that claims about this session are grounded in the real "
    "document, so a paraphrase silently breaks that check. Copy the whole schedule row or bullet, "
    "including the topic and any readings or activities named on it.\n"
    "- `activities` records what STUDENTS DO, not what the topic is about. 'Negotiation theory' is a "
    "topic; 'in-class role play' is an activity. If the syllabus names only a topic and a reading, "
    "return an empty list — do not invent an activity that is not written down.\n"
    "- Never infer, expand, or improve on what is written. A thin syllabus should produce thin data.\n"
    "- If the document has no class schedule at all, return an empty sessions list."
)


def extract_sessions(text):
    """Parse syllabus text into `{course, sessions[]}`.

    Returns the parsed dict, or None if the model is unavailable or the response
    cannot be read. Never raises — the route turns None into a clean 503.

    `verbatim` on each session is the load-bearing field: stage 3 checks every
    recommendation's quoted evidence against the syllabus, and that check is only
    meaningful because the model was told to copy rather than paraphrase here.
    """
    body = (text or "").strip()
    if not body:
        return None
    if len(body) > MAX_SYLLABUS_CHARS:
        logger.info("advisor: syllabus truncated | chars=%d limit=%d", len(body), MAX_SYLLABUS_CHARS)
        body = body[:MAX_SYLLABUS_CHARS]

    parsed = _call_model(
        system=_EXTRACT_SYSTEM,
        user=f"SYLLABUS:\n\n{body}",
        schema=_SESSIONS_SCHEMA,
        max_tokens=EXTRACT_MAX_TOKENS,
        effort="low",
        label="extract",
    )
    if not parsed:
        return None

    # Renumber defensively: the recommendation stage addresses sessions by index,
    # so a duplicate or skipped index from the model would silently attach a
    # recommendation to the wrong week.
    sessions = parsed.get("sessions") or []
    for i, s in enumerate(sessions, start=1):
        s["index"] = i
    parsed["sessions"] = sessions
    return parsed


# ---------------------------------------------------------------------------
# Stage 2 — sessions to recommendations
# ---------------------------------------------------------------------------

# `feature` carries "" on a `none` verdict rather than being omitted, because
# structured outputs require every property; validation treats "" as "no feature".
_RECOMMEND_SCHEMA = {
    "type": "object",
    "properties": {
        "recommendations": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "session_index": {"type": "integer"},
                    "fit": {"type": "string", "enum": ["strong", "possible", "none"]},
                    "feature": {"type": "string", "enum": catalog.get_keys() + [""]},
                    "reason": {
                        "type": "string",
                        "description": "One or two sentences, addressed to the professor. On a "
                                       "'none' verdict, why this session does not need us.",
                    },
                    "evidence": {
                        "type": "string",
                        "description": "The exact span from this session's syllabus text that "
                                       "justifies the fit, copied character for character. "
                                       "Empty string when fit is 'none'.",
                    },
                    "professor_must_supply": {"type": "array", "items": {"type": "string"}},
                    "setup_steps": {"type": "array", "items": {"type": "string"}},
                    "config_prefill": {
                        "type": "object",
                        "properties": {
                            "bot_name": {"type": "string"},
                            "instructions": {"type": "string"},
                            "group_size": {"type": "integer", "description": "0 when not applicable"},
                        },
                        "required": ["bot_name", "instructions", "group_size"],
                        "additionalProperties": False,
                    },
                },
                "required": ["session_index", "fit", "feature", "reason", "evidence",
                             "professor_must_supply", "setup_steps", "config_prefill"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["recommendations"],
    "additionalProperties": False,
}

# The catalog block is rendered once per process and reused, so the long stable
# prefix stays byte-identical across requests and caches.
_CATALOG_BLOCK = catalog.render_for_prompt()

_RECOMMEND_SYSTEM = f"""You advise university professors on where an AI teaching platform fits \
into a course they already teach — and, far more often, where it does not.

You are talking to a professor who has taught this course for years. They can tell immediately \
whether you have understood their syllabus or are pattern-matching on keywords, and the second \
one loses them permanently.

# THE PLATFORM
These are the only features that exist. Never recommend anything not listed here, and never \
describe a feature as doing something this catalog does not say it does.

{_CATALOG_BLOCK}

# HOW TO JUDGE A SESSION

Most sessions are NOT a fit. A normal thirteen-week course yields two to four genuinely strong \
fits. Lectures, readings, exams, review sessions, guest speakers, and holidays are all "none" — \
say so plainly and move on. Returning "none" for most of the term is the expected result and is \
what makes your handful of yeses worth reading.

Judge each session on what the syllabus says STUDENTS DO in it, not on what the topic is about. \
A week titled "Negotiation" that is a lecture is a lecture. A week titled "Firm Behaviour" with \
"students negotiate in pairs" written under it is a role-play.

Three verdicts:
  - "strong"   — the session's stated activity is squarely what the feature is built for, and \
you can quote the line that says so.
  - "possible" — it could work and would add something, but the syllabus does not clearly call \
for it, or the professor would have to build material they may not have.
  - "none"     — no feature fits. Give a one-line reason. Do not reach.

# HARD RULES

1. QUOTE OR STAY SILENT. Every "strong" or "possible" carries `evidence`: a span copied exactly \
from that session's syllabus text, character for character. If you cannot find a real span that \
justifies the fit, the verdict is "none". Never write evidence from memory, never tidy the \
wording, never quote the course title as evidence for a specific week.

2. ONE FEATURE PER SESSION. The best fit, not a menu.

3. NAME THE PREP HONESTLY. `professor_must_supply` lists what this professor would actually have \
to make, drawn from the catalog's requirements. A Manager Exercise needs a hidden-profile case \
with per-role packets and an outcome document for every candidate — if nothing in the syllabus \
suggests they have that, say so in the reason and mark it "possible", not "strong". You are not \
selling; a professor who discovers the real work later feels misled.

4. RESPECT THE CONSTRAINTS. Check the session length and class size against the catalog. A \
50-minute session cannot hold a Manager Exercise. A 200-person lecture cannot run one either.

5. NO DOUBLE-COUNTING. If the same activity recurs weekly (a discussion section every Thursday), \
recommend it once, on its first occurrence, and mark the rest "none" with a reason pointing back.

`setup_steps` is three to five concrete steps for this specific session, not generic instructions.
`config_prefill.instructions` is a draft persona and task the professor could edit — write it for \
THEIR topic, referencing what the syllabus actually says."""


def recommend(course, sessions):
    """Recommend one feature (or none) per session, grounded in the catalog.

    Returns the raw recommendation list from the model — unvalidated. Call
    `validate` on it before showing anything to a professor: the model is
    motivated to be useful and will occasionally quote text the syllabus does
    not contain or call most of the term a strong fit.
    """
    if not sessions:
        return []

    payload = {
        "course": course or {},
        "sessions": [
            {
                "index": s.get("index"),
                "label": s.get("label", ""),
                "topic": s.get("topic", ""),
                "activities": s.get("activities") or [],
                "assessment": s.get("assessment", ""),
                "syllabus_text": s.get("verbatim", ""),
            }
            for s in sessions
        ],
    }
    parsed = _call_model(
        system=_RECOMMEND_SYSTEM,
        user="Judge every session below. Return one recommendation object per session, in order.\n\n"
             + json.dumps(payload, ensure_ascii=False, sort_keys=True),
        schema=_RECOMMEND_SCHEMA,
        max_tokens=RECOMMEND_MAX_TOKENS,
        label="recommend",
    )
    if not parsed:
        return None
    return parsed.get("recommendations") or []


# ---------------------------------------------------------------------------
# Stage 3 — deterministic validation
# ---------------------------------------------------------------------------

def _normalize(s):
    """Lowercase, strip punctuation, collapse whitespace — the comparison form
    for the grounding check. Line breaks and smart quotes differ between a PDF's
    extracted text and what the model echoes back, and neither difference means
    the quote was invented."""
    s = (s or "").lower()
    s = re.sub(r"[^\w\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def validate(recommendations, sessions, syllabus_text, course=None):
    """Drop or demote every recommendation that cannot stand up.

    Returns `(kept, report)`. `report` counts what was removed and why, and the
    route surfaces it — a recommendation that silently disappears is worse than
    one that never existed, because nobody learns the advisor is drifting.

    Four checks, in order of how badly they fail:
      - unknown feature  -> drop (names something we do not build)
      - ungrounded quote -> drop (the syllabus does not contain that text)
      - class too big/small for the feature -> demote strong to possible
      - too many strong fits -> demote the tail

    The last one is the important one. It is the anti-everything-fits guard, and
    it is enforced here rather than trusted to the prompt because the model has
    every incentive to be encouraging and none to be selective.
    """
    report = {"unknown_feature": 0, "ungrounded": 0, "size_demoted": 0, "share_demoted": 0}
    by_index = {s.get("index"): s for s in (sessions or [])}
    haystack = _normalize(syllabus_text)
    # Stated once for the whole course, not per session. 0 means the syllabus
    # never said, which must read as "do not judge" rather than "tiny class".
    class_size = int((course or {}).get("class_size") or 0)
    kept = []

    for rec in (recommendations or []):
        if not isinstance(rec, dict):
            continue
        fit = rec.get("fit")
        session = by_index.get(rec.get("session_index"))
        if session is None:
            continue

        # A "none" verdict carries no claim, so nothing to check — it just needs
        # its feature field cleared so the UI never renders a phantom card.
        if fit == "none":
            rec["feature"] = ""
            rec["evidence"] = ""
            kept.append(rec)
            continue

        feature = catalog.get_feature(rec.get("feature"))
        if feature is None:
            report["unknown_feature"] += 1
            continue

        # The grounding check. Compared against the WHOLE syllabus rather than
        # just this session's row: extraction sometimes splits a row across
        # sessions, and punishing a correct quote for landing one line off would
        # cost real recommendations while catching no fabrications.
        evidence = _normalize(rec.get("evidence"))
        if len(evidence) < MIN_EVIDENCE_CHARS or evidence not in haystack:
            report["ungrounded"] += 1
            logger.info(
                "advisor: dropped ungrounded rec | session=%s feature=%s evidence=%r",
                rec.get("session_index"), rec.get("feature"), (rec.get("evidence") or "")[:80],
            )
            continue

        # Class size against the feature's real range. A demotion rather than a
        # drop: the professor may know their enrolment better than their syllabus
        # states it, so the fit is flagged, not decided for them.
        lo, hi = feature["class_size_range"]
        if class_size and not (lo <= class_size <= hi):
            if fit == "strong":
                rec["fit"] = "possible"
                report["size_demoted"] += 1
            rec.setdefault("caveats", []).append(
                f"Your class looks like about {class_size} students; {feature['label']} works best "
                f"with {lo}-{hi}."
            )
        kept.append(rec)

    _cap_strong_share(kept, len(sessions or []), report)
    return kept, report


def _cap_strong_share(recs, session_count, report):
    """Demote the weakest strong fits until at most MAX_STRONG_SHARE of the term
    is marked strong.

    Ordering is by position in the term, so the earliest strong fits survive —
    a professor reads the plan top-down, and the first recommendation they see
    is the one that has to be right. Mutates `recs` in place.
    """
    if session_count <= 0:
        return
    limit = max(1, int(session_count * MAX_STRONG_SHARE))
    strong = [r for r in recs if r.get("fit") == "strong"]
    if len(strong) <= limit:
        return
    for rec in strong[limit:]:
        rec["fit"] = "possible"
        rec.setdefault("caveats", []).append(
            "Marked as a maybe rather than a clear fit — several sessions scored highly, and this "
            "one is not among the strongest."
        )
        report["share_demoted"] += 1


# ---------------------------------------------------------------------------
# Refine — one follow-up question against an existing plan
# ---------------------------------------------------------------------------

_REFINE_SCHEMA = {
    "type": "object",
    "properties": {
        "answer": {"type": "string", "description": "A direct reply to the professor, 1-4 sentences."},
        "revised": {
            "type": "array",
            "description": "Only the recommendations that CHANGED. Empty when the question needed "
                           "no change to the plan.",
            "items": _RECOMMEND_SCHEMA["properties"]["recommendations"]["items"],
        },
    },
    "required": ["answer", "revised"],
    "additionalProperties": False,
}


def refine(course, sessions, recommendations, question):
    """Answer one follow-up about an existing plan, revising it where warranted.

    Returns `(answer, revised_recommendations)`. `revised` carries only what
    changed, so a question that needs no change ("why not week 6?") costs an
    answer and leaves the plan alone — the professor's screen does not reshuffle
    because they asked something.
    """
    if not (question or "").strip():
        return None, []

    payload = {
        "course": course or {},
        "sessions": sessions or [],
        "current_plan": recommendations or [],
        "professor_question": question.strip(),
    }
    parsed = _call_model(
        system=_RECOMMEND_SYSTEM + (
            "\n\n# THIS TURN\n"
            "You have already given this professor a plan and they are asking about it. Answer the "
            "question directly. Revise a recommendation ONLY when their question genuinely changes "
            "the judgment — a new constraint (class length, class size, what they do or do not "
            "have) changes it; disagreement on its own does not. Every hard rule above still "
            "applies to anything you revise, including the quoting rule."
        ),
        user=json.dumps(payload, ensure_ascii=False, sort_keys=True),
        schema=_REFINE_SCHEMA,
        max_tokens=REFINE_MAX_TOKENS,
        label="refine",
    )
    if not parsed:
        return None, []
    return parsed.get("answer") or "", parsed.get("revised") or []


# ---------------------------------------------------------------------------
# Model plumbing
# ---------------------------------------------------------------------------

def _call_model(system, user, schema, max_tokens, label, effort=None):
    """One schema-constrained Claude call. Returns the parsed object, or None.

    Never raises: a missing API key, a missing SDK, a timeout, or a malformed
    body all degrade to None so the route answers 503 instead of a stack trace.
    No `temperature` — this model rejects sampling parameters outright.
    """
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        logger.error("advisor: ANTHROPIC_API_KEY not set | stage=%s", label)
        return None
    try:
        import anthropic
    except ImportError:
        logger.error("advisor: anthropic SDK not installed | stage=%s", label)
        return None

    kwargs = {
        "model": ADVISOR_MODEL,
        "max_tokens": max_tokens,
        "system": system,
        "messages": [{"role": "user", "content": user}],
        "output_config": {"format": {"type": "json_schema", "schema": schema}},
    }
    if effort:
        kwargs["output_config"]["effort"] = effort

    try:
        client = anthropic.Anthropic(api_key=api_key)
        response = client.messages.create(**kwargs)
    except Exception as e:
        logger.error("advisor: model call failed | stage=%s err=%s", label, e, exc_info=True)
        return None

    # A refusal returns 200 with no text block, so read stop_reason before
    # reaching into content — indexing content[0] would raise on that path.
    if getattr(response, "stop_reason", None) == "refusal":
        logger.error("advisor: model refused | stage=%s", label)
        return None

    text = next((b.text for b in response.content if b.type == "text"), "")
    try:
        return json.loads(text)
    except (json.JSONDecodeError, TypeError):
        logger.error("advisor: unparseable response | stage=%s head=%r", label, (text or "")[:200])
        return None
