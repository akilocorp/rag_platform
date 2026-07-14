"""
Pedagogy: Shock World — goal-driven Socratic shock immersion.

A student is dropped into a country hit by an economic shock, then the tutor
guides them — adaptively, one intuitive multiple-choice question at a time — to a
single END GOAL the professor set (the understanding they should walk away with).
Nothing is pre-scripted: the tutor authors each question LIVE, aimed at whatever
the student hasn't shown yet, following their reasoning and skipping what they
already understand. N is a REPLY BUDGET, not a script — the lab ends the moment
the goal lands or the budget runs out, whichever comes first.

Everything shock-specific lives in this file. It relies only on the generic
method contract (base.py) and the MethodContext services the route hands each
handler. Runtime handlers (reached via POST /experiential/method/shock-world/…):

  ground — ground the shock to a picked country's current conditions (cached)
  turn   — one exchange: STREAM the tutor's reply, then a hidden control verdict
           (judge the answer + track which key ideas are demonstrated + author
           the NEXT question, or end when the goal is reached / budget spent)
  grade  — final effort-to-learn + goal scoring, professor-weighted
"""
import hashlib
import json
import logging
import time

from src.experiential.methods.base import method
from src.agentic.agent_runner import _is_transient_error

logger = logging.getLogger(__name__)

# ── Tunables ─────────────────────────────────────────────────────────────────
GROUND_CACHE_TTL = 86400          # re-ground a country once a day
GROUND_MAX_TOKENS = 1200          # room for country-specific key ideas
TURN_MAX_TOKENS = 700             # the streamed Socratic reply is short
CONTROL_MAX_TOKENS = 700          # judge + author the next question
GRADE_MAX_TOKENS = 900
MAX_FOLLOWUPS_PER_QUESTION = 2    # after this, the tutor must move on (anti-drag)

# Transient Anthropic failures (overloaded 529 / rate-limit 429 / 5xx / dropped
# connection) are retried with backoff before we surface anything — the same
# hardening the 1:1 chat path got in agent_runner. Without it, a momentary
# overload on any of a turn's two Sonnet calls drops the stream, which the client
# shows as "the tutor is unavailable".
_MAX_ATTEMPTS = 3
_BACKOFF_BASE_SECONDS = 1.0
# In-character line shown only if the tutor's reply can't be reached after retries.
_BUSY_REPLY = (
    "I lost my train of thought for a second — the tutor is in high demand right "
    "now. Give me a moment, then tell me your reasoning again."
)


def _create_with_retry(ctx, **kwargs):
    """ctx.client.messages.create, retried on transient API failures with backoff."""
    for attempt in range(_MAX_ATTEMPTS):
        try:
            return ctx.client.messages.create(**kwargs)
        except Exception as e:  # noqa: BLE001
            if _is_transient_error(e) and attempt < _MAX_ATTEMPTS - 1:
                logger.warning("shock-world create retry %d/%d: %s", attempt + 1, _MAX_ATTEMPTS, e)
                time.sleep(_BACKOFF_BASE_SECONDS * (2 ** attempt))
                continue
            raise


# ── Generation ────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are an instructional designer building a SHOCK WORLD Socratic-immersion lab. \
You output ONE JSON object (no prose, no markdown fences) matching the ShockWorldConfig schema below.

The lab drops a student into a country hit by an economic SHOCK, then a live tutor guides them to a \
single END GOAL — the understanding the professor wants them to walk away with. You do NOT script the \
dialogue or pre-write the questions; the tutor authors those live. Your job is to produce: a \
country-AGNOSTIC shock TEMPLATE grounded in the course, the END GOAL, an internal CHECKLIST of the key \
ideas that together mean the goal is reached (the tutor uses this privately to steer and to know when to \
stop — it is never shown as a script), one warm-up GATE that checks the student understands the shock, a \
tutor persona, and a grade rubric.

You are given the professor's design prompt, their structured settings (country list, reply budget N, a \
course-only flag) and lecture excerpts. Infer the END GOAL from the professor's prompt. Derive 3–6 key \
ideas from the course material, ordered from the most direct consequence of the shock to the most \
downstream.

SCHEMA (fill every field):
{
  "meta": { "id": "<kebab-id>", "title": "<short lab title>", "discipline": "<the field>",
            "level": "<e.g. Undergraduate / MBA>", "estMinutes": 15 },
  "scenario": {
    "brief": "<2-3 sentence country-AGNOSTIC setup: the kind of shock and the world the student is in. Use '[country]' as a placeholder where the country name would go>",
    "shockKind": "<the shock in a few words, e.g. 'a sudden spike in global oil prices'>"
  },
  "endGoal": "<one or two sentences: the exact understanding the student should reach by the end>",
  "keyIdeas": [   // 3-6; the internal checklist that constitutes reaching the goal
    { "id": "<kebab-id>", "label": "<short idea, e.g. 'PPI is hit before CPI'>",
      "evidence": "<what it looks like when a student has genuinely demonstrated this idea>" }
  ],
  "gate": {   // warm-up: does the student understand the shock ITSELF (its kind + first direct hit)?
    "prompt": "<an intuitive multiple-choice question checking they grasp what the shock is and what it hits FIRST>",
    "options": ["<option A>", "<option B>", "<option C>"]
  },
  "analyst": {
    "persona": "<a Socratic tutor who guides toward the goal without handing over answers; follows the student's reasoning; efficient, never belabours a point>",
    "scriptedFallback": "<one fallback line if the AI is unavailable>"
  },
  "scoring": { "engagementWeight": 35, "revisionWeight": 20, "contradictionWeight": 20, "goalWeight": 25 },
  "gradeRubric": [ "<criterion about genuinely reasoning toward the goal>", "<criterion about revising after a nudge>" ]
}

RULES:
- The END GOAL and every key idea must be grounded in the professor's prompt and the lecture excerpts. If \
the course-only flag is set, use ONLY concepts present in the course material.
- keyIdeas is INTERNAL — it is the tutor's private checklist, never shown to the student as a fixed list of \
questions. Order it most-direct → downstream, but the tutor may cover ideas in any order and skip ones the \
student already understands.
- Keep scenario.brief country-agnostic (use '[country]'); the country is grounded in later.
- The gate is the only pre-written question; keep it intuitive and multiple-choice.
- Keep it crisp. Output ONLY the JSON object."""


def _normalize(cfg, method_params):
    """Stamp the professor's structured params (source of truth) and fill defaults."""
    if not isinstance(cfg, dict):
        cfg = {}
    mp = method_params if isinstance(method_params, dict) else {}

    countries = mp.get('countries')
    if isinstance(countries, list):
        cfg['countries'] = [str(c).strip() for c in countries if str(c).strip()]
    elif not isinstance(cfg.get('countries'), list):
        cfg['countries'] = []

    # maxRounds is the REPLY BUDGET — the tutor's total adaptive exchanges.
    try:
        cfg['maxRounds'] = max(1, int(mp.get('maxRounds')))
    except (TypeError, ValueError):
        cfg['maxRounds'] = cfg['maxRounds'] if isinstance(cfg.get('maxRounds'), int) and cfg['maxRounds'] >= 1 else 6

    cfg['courseOnly'] = bool(mp['courseOnly']) if 'courseOnly' in mp else bool(cfg.get('courseOnly'))

    sc = cfg.get('scoring') if isinstance(cfg.get('scoring'), dict) else {}
    sc.setdefault('engagementWeight', 35)
    sc.setdefault('revisionWeight', 20)
    sc.setdefault('contradictionWeight', 20)
    sc.setdefault('goalWeight', 25)
    cfg['scoring'] = sc

    analyst = cfg.get('analyst') if isinstance(cfg.get('analyst'), dict) else {}
    analyst.setdefault('persona', 'A Socratic economics tutor who guides you to the insight without handing over the answer, and never belabours a point.')
    analyst.setdefault('scriptedFallback', "Let's reason it through: what does the shock hit first, and what must follow from that?")
    cfg['analyst'] = analyst

    if not isinstance(cfg.get('endGoal'), str):
        cfg['endGoal'] = ''
    if not isinstance(cfg.get('keyIdeas'), list):
        cfg['keyIdeas'] = []
    if not isinstance(cfg.get('gradeRubric'), list):
        cfg['gradeRubric'] = []
    return cfg


# ── ground: ground the shock to a picked country ─────────────────────────────

def _build_ground_system(course_only):
    lines = [
        "You ground a 'shock world' scenario to a specific country. Given the country, the shock template, "
        "the lab's END GOAL and generic key ideas, and either current real-world context or course material, "
        "produce a concise JSON object:",
        '{ "country": "<name>",',
        '  "conditions": "<2-3 sentences on the country\'s current, relevant economic conditions>",',
        '  "shock": "<the specific shock as it lands in THIS country, 1-2 sentences, present tense>",',
        '  "shock_first_hit": "<the first, most direct thing the shock hits — one sentence>",',
        '  "structure": "<1-2 sentences: the structural features of THIS country (trade profile, sector mix, '
        'policy regime, exposures) that change how the shock transmits here>",',
        '  "transmission_twist": "<what a student MISSES if they only run the textbook mechanism — the '
        'country-specific wrinkle, e.g. an oil exporter that imports refined product has dual exposure>",',
        '  "country_key_ideas": [   // 1-3 items that INSTANTIATE the generic key ideas for THIS country',
        '    { "id": "<kebab-id>", "label": "<the country-specific insight to test>",',
        '      "evidence": "<what it looks like when a student has genuinely demonstrated it here>" } ] }',
        "The country_key_ideas must be consistent with (never contradict) the lab's END GOAL and generic key "
        "ideas — they make those principles concrete for this country, adding the structural twist. Keep it "
        "concrete and vivid — the student is about to be dropped into this world.",
    ]
    if course_only:
        lines.append(
            "COURSE-ONLY: use ONLY concepts and facts consistent with the course material provided. "
            "Do not introduce outside current-events data; ground the country picture in course concepts."
        )
    lines.append("Output ONLY the JSON object.")
    return "\n".join(lines)


def ground(payload, ctx):
    config = payload.get('config') or {}
    country = (payload.get('country') or '').strip()
    base_id = (payload.get('base_id') or '').strip()
    config_id = payload.get('config_id')
    if not country:
        return {"error": "Missing 'country'"}

    course_only = bool(config.get('courseOnly'))
    scenario = config.get('scenario') or {}
    brief = scenario.get('brief', '')
    shock_kind = scenario.get('shockKind', '')
    end_goal = (config.get('endGoal') or '').strip()
    key_ideas = config.get('keyIdeas') if isinstance(config.get('keyIdeas'), list) else []

    # Retuned goals must re-ground: fold the end goal into the cache key.
    goal_hash = hashlib.sha1(end_goal.encode('utf-8')).hexdigest()[:8]
    cache_key = f"{base_id}::{country.lower()}::{goal_hash}"
    cached = ctx.cache_get('shock_groundings', cache_key, GROUND_CACHE_TTL)
    if cached:
        return {"grounding": cached, "cached": True}

    # Widen the query to surface structural / transmission material, not just headline macro.
    query = f"{country} economic structure trade profile {shock_kind} transmission {brief[:120]}"
    web = ""
    course = ""
    if course_only:
        if config_id:
            course = ctx.retrieve_kb(config_id, query)
    else:
        web = ctx.tavily_search(query)

    user = f"Country: {country}\nShock template: {shock_kind}\nScenario template: {brief}"
    if end_goal:
        user += f"\n\nLab END GOAL (align country ideas to this):\n{end_goal}"
    if key_ideas:
        ideas_txt = "\n".join(
            f"- {k.get('label')}" + (f": {k.get('evidence')}" if k.get('evidence') else "")
            for k in key_ideas if isinstance(k, dict)
        )
        if ideas_txt:
            user += f"\n\nGeneric key ideas to instantiate for this country:\n{ideas_txt}"
    if web:
        user += f"\n\nCurrent real-world context:\n{web[:8000]}"
    if course:
        user += f"\n\nCourse material (ground strictly in this):\n{course[:8000]}"
    user += "\n\nReturn ONLY the JSON grounding object."

    msg = _create_with_retry(
        ctx,
        model=ctx.model,
        max_tokens=GROUND_MAX_TOKENS,
        system=_build_ground_system(course_only),
        messages=[{"role": "user", "content": user}],
    )
    grounding = ctx.extract_json(ctx.text_from_message(msg)) or {}
    grounding.setdefault('country', country)
    grounding.setdefault('conditions', '')
    grounding.setdefault('shock', shock_kind or 'a sudden economic shock')
    grounding.setdefault('shock_first_hit', '')
    grounding.setdefault('structure', '')
    grounding.setdefault('transmission_twist', '')

    # Normalize country_key_ideas → clean list, each stamped country_specific, capped at 3.
    cki = []
    for k in (grounding.get('country_key_ideas') or [])[:3]:
        if not isinstance(k, dict):
            continue
        label = (k.get('label') or '').strip()
        if not label:
            continue
        cki.append({
            "id": (k.get('id') or '').strip() or f"country-{len(cki) + 1}",
            "label": label,
            "evidence": (k.get('evidence') or '').strip(),
            "country_specific": True,
        })
    grounding['country_key_ideas'] = cki

    ctx.cache_set('shock_groundings', cache_key, grounding)
    return {"grounding": grounding, "cached": False, "grounded": bool(web)}


# ── turn: one Socratic exchange (streamed reply + hidden control) ─────────────

def _scenario_line(payload):
    scenario = payload.get('scenario') or {}
    country = (scenario.get('country') or '').strip()
    conditions = (scenario.get('conditions') or '').strip()
    shock = (scenario.get('shock') or '').strip()
    parts = []
    if country:
        parts.append(f"The student is in {country}.")
    if conditions:
        parts.append(f"Current conditions: {conditions}")
    if shock:
        parts.append(f"The shock: {shock}")
    return " ".join(parts)


def _history_block(history):
    if not isinstance(history, list) or not history:
        return ""
    lines = ["\nRecent exchanges (most recent last):"]
    for h in history[-8:]:
        role = (h.get('role') or '').strip()
        if role == 'student':
            pick = (h.get('pick') or '').strip()
            why = (h.get('why') or '').strip()
            if pick and why:
                lines.append(f"- Student picked '{pick}' — {why}")
            elif pick:
                lines.append(f"- Student picked '{pick}'")
            else:
                lines.append(f"- Student said: {why}")
        elif role == 'tutor':
            lines.append(f"- You replied: {(h.get('text') or '').strip()}")
    return "\n".join(lines)


def _goal_block(payload):
    end_goal = (payload.get('endGoal') or '').strip()
    key_ideas = payload.get('keyIdeas') or []
    scenario = payload.get('scenario') or {}
    country_ideas = scenario.get('country_key_ideas') or []
    structure = (scenario.get('structure') or '').strip()
    twist = (scenario.get('transmission_twist') or '').strip()
    demonstrated = set(payload.get('demonstrated') or [])
    lines = []
    if end_goal:
        lines.append(f"END GOAL (guide the student here): {end_goal}")
    if structure or twist:
        lines.append("This country is not generic — steer with its specifics:")
        if structure:
            lines.append(f"  Structure: {structure}")
        if twist:
            lines.append(f"  Transmission twist (a textbook-only answer MISSES this): {twist}")
    if key_ideas or country_ideas:
        lines.append("Key ideas that together mean the goal is reached ([x] = already shown, skip those; ★ = "
                     "country-specific, the goal is NOT reached until these are demonstrated too):")
        for k in key_ideas:
            kid = k.get('id')
            mark = 'x' if kid in demonstrated else ' '
            ev = (k.get('evidence') or '').strip()
            lines.append(f"  [{mark}] {k.get('label')}" + (f" — {ev}" if ev else ""))
        for k in country_ideas:
            if not isinstance(k, dict):
                continue
            kid = k.get('id')
            mark = 'x' if kid in demonstrated else ' '
            ev = (k.get('evidence') or '').strip()
            lines.append(f"  [{mark}] ★ {k.get('label')}" + (f" — {ev}" if ev else ""))
    return "\n".join(lines)


def _budget_line(payload):
    try:
        used = int(payload.get('exchangesUsed') or 0)
    except (TypeError, ValueError):
        used = 0
    try:
        budget = int(payload.get('budget') or 0)
    except (TypeError, ValueError):
        budget = 0
    left = max(0, budget - used)
    return used, budget, left


def _build_turn_system(payload, course_context=''):
    persona = (payload.get('persona') or '').strip()
    title = (payload.get('labTitle') or 'Shock World').strip()
    phase = payload.get('phase') or 'round'
    course_only = bool(payload.get('courseOnly'))
    q = payload.get('currentQuestion') or {}
    _, budget, left = _budget_line(payload)

    lines = [persona, ""]
    lines.append(f"You are a Socratic tutor running an immersive economics simulation titled \"{title}\".")
    sl = _scenario_line(payload)
    if sl:
        lines.append(sl)
    if phase != 'gate':
        gb = _goal_block(payload)
        if gb:
            lines.append("\n" + gb)
        lines.append(f"\nYou have a REPLY BUDGET: about {left} of {budget} exchanges left to get the student to the goal. Be efficient — reach it in as few as you can.")
    if q.get('text'):
        opts = q.get('options') or []
        lines.append(f"\nThe question the student is answering: {q['text']}")
        if opts:
            lines.append("Options: " + " | ".join(str(o) for o in opts))

    lines.append("\nHOW TO REACT — read the student's REASONING, never just their letter:")
    lines.append("- Their 'why' is what matters; the multiple-choice pick is only a way in. If the reasoning is stronger "
                 "than the option they clicked, say so and go with the reasoning — a misclick is NEVER 'wrong'.")
    lines.append("- OPEN every reply by naming what is CORRECT in their answer, in their own words — start from what they got right.")
    lines.append("- If they've shown the idea — even a more advanced version than the question expected — credit it plainly "
                 "and MOVE ON. Don't make them restate it your way.")
    lines.append("- Only if a REAL gap remains, ask ONE focusing question about that specific gap — a question that opens "
                 "their thinking, not one that herds them toward a predetermined answer.")
    lines.append("- 'It's ambiguous' / 'it depends' / 'net neutral' is a WINNING answer when the economics is genuinely "
                 "two-sided (e.g. an oil exporter that imports refined product — net exposure really is unclear). Credit "
                 "the dual-exposure insight; never push them off it toward a single 'right' option.")
    lines.append("- LOW-EFFORT / GAMING (one word, random, a 'why' that plainly doesn't engage the question) → call it out "
                 "plainly and don't advance: 'that's not really an explanation — walk me through why.'")
    lines.append("- WHEN STUCK, climb a hint ladder, don't circle: prompt for a bit more → then ONE targeted hint → then "
                 "GIVE them the answer and consolidate ('here's the mechanism — you basically had it'). Re-ask any one "
                 "point at most once, then resolve it yourself and move on.")
    lines.append(f"- DON'T BELABOUR: at most {MAX_FOLLOWUPS_PER_QUESTION} nudges on any single point, then accept it or "
                 "resolve it and move on. Never grind, never loop.")
    lines.append("- Scale scaffolding to the learner: more warmth and affirmation for a novice who's unsure, less for "
                 "someone clearly cruising. Skip rhetorical 'interesting claim, but…' framing — it reads as condescending; "
                 "just engage with what they said.")
    if phase == 'gate':
        lines.append("\nThis is a WARM-UP about the shock itself — it does not count against the budget and is never "
                     "penalized. Just check intuitively that the student grasps what the shock is and what it hits first.")
    if course_only:
        lines.append("\nCOURSE-ONLY: reason using ONLY concepts from the course material. If the student's reasoning needs "
                     "something outside it, redirect to a course concept rather than teaching new material.")
        if course_context:
            lines.append(f"\nCourse material:\n{course_context[:5000]}")
    lines.append("\nReply in 2-4 sentences, in character, conversational — one Socratic move at a time. Address the "
                 "student directly ('you'). Do NOT output JSON, options, or a score — just your spoken reply. Light Markdown only.")
    return "\n".join(lines)


def _build_control_system(payload, course_context=''):
    phase = payload.get('phase') or 'round'
    _, budget, left = _budget_line(payload)
    course_only = bool(payload.get('courseOnly'))
    scenario = payload.get('scenario') or {}
    country = (scenario.get('country') or 'the country').strip()

    lines = [
        "You are the silent controller behind a Socratic tutor. You read the student's multiple-choice pick, their "
        "written 'why', and the tutor's reply, then decide what happens next. You are strict about effort: a vague, "
        "one-word, off-topic, or pick-mismatched 'why' is GAMING, not reasoning.",
        "",
        _goal_block(payload),
        "",
        f"Reply budget: about {left} of {budget} exchanges remain.",
    ]
    lines.append("\nDecide and return ONLY this JSON object (no prose):")
    lines.append('{')
    lines.append('  "verdict": "sound|partial|wrong|gaming",')
    lines.append('  "advance": true|false,   // true when this point is settled and it is time to move on')
    lines.append('  "goal_reached": true|false,   // true only when the student has demonstrated the END GOAL')
    lines.append('  "newly_demonstrated": ["<keyIdea id the student just demonstrated>", ...],   // [] if none')
    lines.append('  "effort_signals": { "explained_why": bool, "revised_after_nudge": bool, "worked_through_contradiction": bool, "low_effort": bool },')
    lines.append('  "next_question": { "text": "<the NEXT intuitive multiple-choice question>", "options": ["A","B","C"], "targets": "<keyIdea id it probes>" } | null')
    lines.append('}')
    lines.append("\nRules:")
    if phase == 'gate':
        lines.append("- This is the WARM-UP gate: advance=true as soon as the student grasps the shock (its kind + first hit). "
                     "Keep goal_reached=false and newly_demonstrated=[] here.")
        lines.append("- When you advance, author the FIRST real question in next_question, targeting the most direct key idea.")
    else:
        lines.append("- Judge the student's REASONING (their 'why'), NOT which option they clicked. Mark newly_demonstrated "
                     "with any key idea their reasoning genuinely shows, regardless of the letter picked — a misclick with "
                     "sound reasoning still earns the idea. Never require the 'right' option to credit an idea.")
        lines.append("- A valid 'it's ambiguous / net-neutral / it depends' answer SATISFIES the relevant key idea when the "
                     "economics is genuinely two-sided — treat it as demonstrating that idea, not as a wrong turn.")
        lines.append("- Do NOT gate advance or goal_reached on the exact option.")
        lines.append("- Set goal_reached=true ONLY when the ★ country-specific ideas are ALSO demonstrated — running the "
                     "generic textbook mechanism WITHOUT this country's transmission twist is NOT reaching the goal. The "
                     "goal lands only when the reasoning covers the ideas that matter AND the country's specific wrinkle.")
        lines.append("- Never advance or credit a key idea on a 'gaming' answer.")
    lines.append("- next_question: provide one ONLY when advance=true AND goal_reached=false AND budget remains. It must "
                 "target the next key idea the student has NOT yet demonstrated — NEVER re-target a key idea already marked "
                 "demonstrated — be intuitive and multiple-choice (2–4 short options), and be grounded in "
                 f"{country}'s situation. Otherwise next_question=null.")
    lines.append("- If budget is exhausted or the goal is reached, set next_question=null.")
    if course_only:
        lines.append("- COURSE-ONLY: keep the question within concepts from the course material.")
        if course_context:
            lines.append(f"\nCourse material:\n{course_context[:5000]}")
    return "\n".join(lines)


_DEFAULT_SIGNALS = {
    "explained_why": False,
    "revised_after_nudge": False,
    "worked_through_contradiction": False,
    "low_effort": False,
}


def _coerce_question(q):
    if not isinstance(q, dict):
        return None
    text = (q.get('text') or '').strip()
    options = q.get('options')
    if not text or not isinstance(options, list) or len(options) < 2:
        return None
    return {"text": text, "options": [str(o) for o in options][:4], "targets": q.get('targets')}


def turn(payload, ctx):
    """Generator: stream the tutor's reply, then emit a control verdict + next question."""
    answer = payload.get('answer') or {}
    pick = (answer.get('pick') or '').strip()
    why = (answer.get('why') or '').strip()

    # Course-only labs ground the tutor in the KB fresh each turn (best-effort).
    course_context = ''
    if payload.get('courseOnly') and payload.get('config_id'):
        q = payload.get('currentQuestion') or {}
        query = (q.get('text') or payload.get('endGoal') or '').strip()
        course_context = ctx.retrieve_kb(payload.get('config_id'), query) or ''

    user_parts = []
    if pick:
        user_parts.append(f"The student picked: {pick}")
    user_parts.append(f"Their 'why': {why or '(they wrote nothing)'}")
    hist = _history_block(payload.get('history'))
    if hist:
        user_parts.append(hist)
    user_msg = "\n".join(user_parts)

    # 1) Stream the conversational reply the student sees. Retry transient API
    # failures — but only before any token has streamed, since we can't cleanly
    # resume a half-sent reply. If it still fails, stream a friendly in-character
    # line instead of dropping the connection (which shows as "tutor unavailable").
    reply_text = ""
    turn_system = _build_turn_system(payload, course_context)
    for attempt in range(_MAX_ATTEMPTS):
        try:
            with ctx.client.messages.stream(
                model=ctx.model,
                max_tokens=TURN_MAX_TOKENS,
                system=turn_system,
                messages=[{"role": "user", "content": user_msg}],
            ) as stream:
                for chunk in stream.text_stream:
                    reply_text += chunk
                    yield {"type": "token", "data": chunk}
            break
        except Exception as e:  # noqa: BLE001
            can_retry = _is_transient_error(e) and not reply_text and attempt < _MAX_ATTEMPTS - 1
            logger.warning(
                "shock-world turn stream failed (attempt %d/%d, retry=%s): %s",
                attempt + 1, _MAX_ATTEMPTS, can_retry, e,
            )
            if can_retry:
                time.sleep(_BACKOFF_BASE_SECONDS * (2 ** attempt))
                continue
            if not reply_text:
                reply_text = _BUSY_REPLY
                yield {"type": "token", "data": reply_text}
            break

    # 2) Hidden control: judge the exchange, track goal progress, author the next question.
    control = {
        "verdict": "partial", "advance": False, "goal_reached": False,
        "newly_demonstrated": [], "effort_signals": dict(_DEFAULT_SIGNALS), "next_question": None,
    }
    try:
        control_user = (
            f"Student picked: {pick or '(none)'}\n"
            f"Student's why: {why or '(nothing)'}\n"
            f"Tutor's reply: {reply_text}\n\nReturn ONLY the control JSON."
        )
        cmsg = _create_with_retry(
            ctx,
            model=ctx.model,
            max_tokens=CONTROL_MAX_TOKENS,
            system=_build_control_system(payload, course_context),
            messages=[{"role": "user", "content": control_user}],
        )
        parsed = ctx.extract_json(ctx.text_from_message(cmsg))
        if isinstance(parsed, dict):
            sig = parsed.get('effort_signals') if isinstance(parsed.get('effort_signals'), dict) else {}
            nd = parsed.get('newly_demonstrated')
            control = {
                "verdict": str(parsed.get('verdict', 'partial')),
                "advance": bool(parsed.get('advance', False)),
                "goal_reached": bool(parsed.get('goal_reached', False)),
                "newly_demonstrated": [str(x) for x in nd] if isinstance(nd, list) else [],
                "effort_signals": {k: bool(sig.get(k, _DEFAULT_SIGNALS[k])) for k in _DEFAULT_SIGNALS},
                "next_question": _coerce_question(parsed.get('next_question')),
            }
    except Exception:  # noqa: BLE001 — never let the controller break the turn
        pass

    yield {"type": "control", **control}


# ── grade: effort-to-learn + goal scoring ─────────────────────────────────────

_DIMENSIONS = [
    ("engagement", "engagementWeight", "Genuine engagement — really explaining the 'why', not coasting"),
    ("revision", "revisionWeight", "Revising and improving after a Socratic nudge"),
    ("contradiction", "contradictionWeight", "Working through a contradiction to a self-correction"),
    ("goal", "goalWeight", "Reaching the end goal — demonstrating the target understanding (efficiently)"),
]


def _build_grade_system(payload):
    scenario = payload.get('scenario') or {}
    rubric = payload.get('rubric') or []
    end_goal = (payload.get('endGoal') or '').strip()
    lines = [
        "You grade a student's EFFORT TO LEARN and whether they reached the goal in a Socratic economics "
        "simulation — NOT whether their first answers were correct. Reward genuinely explaining the 'why', "
        "revising after a nudge, working through a contradiction, and reaching the end goal (especially in few "
        "replies). Coasting, random picks, and gaming earn little. The warm-up gate does NOT count.",
    ]
    if end_goal:
        lines.append(f"\nThe end goal was: {end_goal}")
    sl = _scenario_line({"scenario": scenario})
    if sl:
        lines.append(f"Scenario: {sl}")
    if rubric:
        lines.append("\nAdditional criteria the professor cares about:")
        for i, r in enumerate(rubric, 1):
            lines.append(f"{i}. {r}")
    lines.append("\nScore EACH dimension from 0 to 100 based on the tally and transcript:")
    for key, _, desc in _DIMENSIONS:
        lines.append(f"- {key}: {desc}")
    lines.append(
        "\nRespond with ONLY this JSON object, no prose:\n"
        '{ "scores": { "engagement": <0-100>, "revision": <0-100>, "contradiction": <0-100>, "goal": <0-100> },\n'
        '  "feedback": "<2-4 sentences of constructive, encouraging feedback for the student>" }'
    )
    return "\n".join(lines)


def grade(payload, ctx):
    weights = payload.get('weights') if isinstance(payload.get('weights'), dict) else {}
    tally = payload.get('tally') or {}
    transcript = payload.get('transcript') or []

    user = f"Tally of the student's run (warm-up gate excluded):\n{json.dumps(tally)}"
    if transcript:
        user += f"\n\nTranscript of the exchanges:\n{json.dumps(transcript)[:10000]}"
    user += "\n\nReturn ONLY the scoring JSON."

    msg = _create_with_retry(
        ctx,
        model=ctx.model,
        max_tokens=GRADE_MAX_TOKENS,
        system=_build_grade_system(payload),
        messages=[{"role": "user", "content": user}],
    )
    parsed = ctx.extract_json(ctx.text_from_message(msg)) or {}
    scores = parsed.get('scores') if isinstance(parsed.get('scores'), dict) else {}

    breakdown = []
    weighted_sum = 0.0
    weight_total = 0.0
    for key, weight_key, desc in _DIMENSIONS:
        try:
            score = max(0, min(100, int(round(float(scores.get(key, 0))))))
        except (TypeError, ValueError):
            score = 0
        try:
            weight = max(0, float(weights.get(weight_key, 0)))
        except (TypeError, ValueError):
            weight = 0
        # `label` drives the live debrief bars; `detail` is what the shared
        # SessionReport (predict-reveal-shaped) renders — include both.
        breakdown.append({"key": key, "label": desc, "detail": desc, "score": score, "weight": weight})
        weighted_sum += score * weight
        weight_total += weight

    total = int(round(weighted_sum / weight_total)) if weight_total > 0 else 0
    return {
        "total": total,
        "breakdown": breakdown,
        "feedback": str(parsed.get('feedback', '')).strip(),
    }


method(
    id='shock-world',
    label='Shock World (Socratic shock immersion)',
    description='Drop a student into a country hit by a shock; a tutor adaptively guides them to your end goal in a set reply budget. Scores effort-to-learn.',
    system_prompt=SYSTEM_PROMPT,
    prompt_hint='Describe the shock and — most importantly — the END GOAL: what should the student walk away understanding? e.g. "An oil-price spike (cost-push). Goal: they grasp that PPI is hit before CPI, a weaker currency amplifies imported inflation, and the central bank faces an output-vs-inflation tradeoff. Ground it in Lectures 8–11."',
    schema='shock-world',
    normalize=_normalize,
    actions={'ground': ground, 'turn': turn, 'grade': grade},
)
