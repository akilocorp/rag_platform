"""
Pedagogy: Shock World — Socratic shock immersion.

A student is dropped into a country hit by an economic shock, then walked through
adaptive Socratic rounds: for each target intuition the tutor poses one intuitive
multiple-choice question + a short "why", and REACTS — affirming sound reasoning,
following a wrong answer's logic until the contradiction surfaces (rather than
correcting), and calling out low-effort / gaming. A round closes on the "aha".

Unlike the scripted predict-reveal lab, the rounds are genuinely conversational,
so this method owns three runtime handlers (reached via the generic
POST /experiential/method/shock-world/<action> route):

  ground — ground the shock to a picked country's current conditions (cached)
  turn   — one Socratic exchange: STREAMS the tutor's reply, then a hidden
           structured judge verdict (sound / wrong / gaming, advance, aha)
  grade  — final effort-to-learn scoring, professor-weighted

Everything shock-specific lives in this file. The only shared code it relies on
is the generic method contract (base.py) and the MethodContext services handed
to each handler by the route.
"""
import json

from src.experiential.methods.base import method

# ── Tunables ─────────────────────────────────────────────────────────────────
GROUND_CACHE_TTL = 86400          # re-ground a country once a day
GROUND_MAX_TOKENS = 900
TURN_MAX_TOKENS = 700             # the streamed Socratic reply is short
JUDGE_MAX_TOKENS = 400            # the hidden structured verdict
GRADE_MAX_TOKENS = 900


# ── Generation ────────────────────────────────────────────────────────────────

SYSTEM_PROMPT = """You are an instructional designer building a SHOCK WORLD Socratic-immersion lab. \
You output ONE JSON object (no prose, no markdown fences) matching the ShockWorldConfig schema below.

The lab drops a student into a country that has just been hit by an economic SHOCK, then runs adaptive \
Socratic rounds. You do NOT pre-script the dialogue — the live tutor drives the back-and-forth. Your job \
is to produce a country-AGNOSTIC shock TEMPLATE grounded in the course, the set of TARGET INTUITIONS the \
rounds should cover (each drawn from the course material, e.g. aggregate demand, the exchange rate, \
interest rates, IS-LM), one warm-up GATE that checks the student grasps the shock, a tutor persona, and a \
grade rubric.

You are given the professor's design prompt, their structured settings (country list, N rounds, a \
course-only flag) and lecture excerpts. Design EXACTLY as many target intuitions as N rounds (or fewer if \
the course material supports fewer), ordered from the most direct consequence to the most downstream.

SCHEMA (fill every field):
{
  "meta": { "id": "<kebab-id>", "title": "<short lab title>", "discipline": "<the field>",
            "level": "<e.g. Undergraduate / MBA>", "estMinutes": 20 },
  "scenario": {
    "brief": "<2-3 sentence country-AGNOSTIC setup: the kind of shock and the world the student is in. Use '[country]' as a placeholder where the country name would go>",
    "shockKind": "<the shock in a few words, e.g. 'a sudden stop in foreign capital inflows'>"
  },
  "targetIntuitions": [   // one per round; each is an intuition the student should reach
    { "id": "<kebab-id>", "label": "<short label, e.g. 'Aggregate demand'>",
      "seedQuestion": {
        "text": "<one INTUITIVE multiple-choice question about this consequence of the shock — never an essay>",
        "options": ["<option A>", "<option B>", "<option C>"]   // 2-4 short, plausible options
      } }
  ],
  "gate": {   // warm-up: does the student understand the shock ITSELF (its kind + first direct hit)?
    "prompt": "<an intuitive multiple-choice question checking they grasp what the shock is and what it hits FIRST>",
    "options": ["<option A>", "<option B>", "<option C>"]
  },
  "analyst": {
    "persona": "<a Socratic economics tutor who never hands over the answer; follows the student's reasoning>",
    "scriptedFallback": "<one fallback line if the AI is unavailable>"
  },
  "scoring": { "engagementWeight": 40, "revisionWeight": 20, "contradictionWeight": 20, "ahaWeight": 20 },
  "gradeRubric": [ "<criterion about genuinely explaining the why>", "<criterion about revising after a nudge>" ]
}

RULES:
- Every intuition and every question must be INTUITIVE and multiple-choice — a student picks an option and \
writes a short 'why'. Never ask for an essay.
- Ground every framing, term and question in the professor's prompt and the lecture excerpts. If the \
course-only flag is set, use ONLY concepts present in the course material.
- Keep scenario.brief country-agnostic (use '[country]'); the country is grounded in later.
- Options should be plausible distractors, not obviously wrong — the point is to surface reasoning.
- Keep it crisp. Output ONLY the JSON object."""


def _normalize(cfg, method_params):
    """Stamp the professor's structured params (source of truth) and fill defaults.

    The generation model produces the scenario, intuitions, gate, persona and
    rubric; the country list / round count / course-only flag come straight from
    the professor's ConfigForm so they can't be mis-transcribed by the model.
    """
    if not isinstance(cfg, dict):
        cfg = {}
    mp = method_params if isinstance(method_params, dict) else {}

    countries = mp.get('countries')
    if isinstance(countries, list):
        cfg['countries'] = [str(c).strip() for c in countries if str(c).strip()]
    elif not isinstance(cfg.get('countries'), list):
        cfg['countries'] = []

    try:
        cfg['maxRounds'] = max(1, int(mp.get('maxRounds')))
    except (TypeError, ValueError):
        cfg['maxRounds'] = cfg['maxRounds'] if isinstance(cfg.get('maxRounds'), int) and cfg['maxRounds'] >= 1 else 5

    cfg['courseOnly'] = bool(mp['courseOnly']) if 'courseOnly' in mp else bool(cfg.get('courseOnly'))

    sc = cfg.get('scoring') if isinstance(cfg.get('scoring'), dict) else {}
    sc.setdefault('engagementWeight', 40)
    sc.setdefault('revisionWeight', 20)
    sc.setdefault('contradictionWeight', 20)
    sc.setdefault('ahaWeight', 20)
    cfg['scoring'] = sc

    analyst = cfg.get('analyst') if isinstance(cfg.get('analyst'), dict) else {}
    analyst.setdefault('persona', 'A Socratic economics tutor who never hands over the answer, but follows your reasoning until it clicks.')
    analyst.setdefault('scriptedFallback', "Let's reason it through: what does the shock hit first, and what must follow from that?")
    cfg['analyst'] = analyst

    if not isinstance(cfg.get('targetIntuitions'), list):
        cfg['targetIntuitions'] = []
    if not isinstance(cfg.get('gradeRubric'), list):
        cfg['gradeRubric'] = []
    return cfg


# ── ground: ground the shock to a picked country ─────────────────────────────

def _build_ground_system(course_only):
    lines = [
        "You ground a 'shock world' scenario to a specific country. Given the country, the shock template, "
        "and either current real-world context or course material, produce a concise JSON object:",
        '{ "country": "<name>",',
        '  "conditions": "<2-3 sentences on the country\'s current, relevant economic conditions>",',
        '  "shock": "<the specific shock as it lands in THIS country, 1-2 sentences, present tense>",',
        '  "shock_first_hit": "<the first, most direct thing the shock hits — one sentence>" }',
        "Keep it concrete and vivid — the student is about to be dropped into this world.",
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

    cache_key = f"{base_id}::{country.lower()}"
    cached = ctx.cache_get('shock_groundings', cache_key, GROUND_CACHE_TTL)
    if cached:
        return {"grounding": cached, "cached": True}

    web = ""
    course = ""
    if course_only:
        if config_id:
            course = ctx.retrieve_kb(config_id, f"{brief[:160]} {country}")
    else:
        web = ctx.tavily_search(f"{country} current macroeconomic conditions {shock_kind} {brief[:120]}")

    user = f"Country: {country}\nShock template: {shock_kind}\nScenario template: {brief}"
    if web:
        user += f"\n\nCurrent real-world context:\n{web[:8000]}"
    if course:
        user += f"\n\nCourse material (ground strictly in this):\n{course[:8000]}"
    user += "\n\nReturn ONLY the JSON grounding object."

    msg = ctx.client.messages.create(
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
    ctx.cache_set('shock_groundings', cache_key, grounding)
    return {"grounding": grounding, "cached": False, "grounded": bool(web)}


# ── turn: one Socratic exchange (streamed reply + hidden judge) ───────────────

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
    lines = ["\nEarlier in this round (most recent last):"]
    for h in history[-8:]:
        role = (h.get('role') or '').strip()
        if role == 'student':
            pick = (h.get('pick') or '').strip()
            why = (h.get('why') or '').strip()
            bit = f"- Student said: {why}"
            if pick:
                bit = f"- Student picked '{pick}' — {why}" if why else f"- Student picked '{pick}'"
            lines.append(bit)
        elif role == 'tutor':
            lines.append(f"- You replied: {(h.get('text') or '').strip()}")
    return "\n".join(lines)


def _build_turn_system(payload):
    persona = (payload.get('persona') or '').strip()
    title = (payload.get('labTitle') or 'Shock World').strip()
    phase = payload.get('phase') or 'round'
    course_only = bool(payload.get('courseOnly'))
    course_context = (payload.get('courseContext') or '').strip()
    q = payload.get('currentQuestion') or {}

    lines = [persona, ""]
    lines.append(f"You are a Socratic tutor running an immersive economics simulation titled \"{title}\".")
    sl = _scenario_line(payload)
    if sl:
        lines.append(sl)
    if q.get('text'):
        opts = q.get('options') or []
        lines.append(f"\nThe question the student is answering: {q['text']}")
        if opts:
            lines.append("Options: " + " | ".join(str(o) for o in opts))

    lines.append("\nHOW TO REACT to the student's pick and their 'why':")
    lines.append("- SOUND reasoning → affirm it briefly and sharpen the mechanism; you're ready to move on.")
    lines.append("- WRONG → do NOT correct them. Take their answer's logic at face value and follow it: ask what "
                 "MUST follow if they were right, until the contradiction surfaces and they self-correct. Offer a "
                 "concrete hint ONLY if they ask for one.")
    lines.append("- LOW-EFFORT / GAMING (one word, random, a 'why' that doesn't match their pick, button-mashing) → "
                 "call it out plainly and do NOT let them advance: 'that's not really an explanation — walk me "
                 "through why.' Re-ask.")
    lines.append("- When the insight lands (the 'aha'), acknowledge it warmly and close the round.")
    if phase == 'gate':
        lines.append("\nThis is a WARM-UP gate about the shock itself — it does not count and is never penalized. "
                     "Just keep nudging intuitively until the student grasps what the shock is and what it hits first.")
    if course_only:
        lines.append("\nCOURSE-ONLY: reason using ONLY concepts from the course material below. If the student's "
                     "reasoning needs something outside it, redirect them to a course concept rather than teaching new material.")
        if course_context:
            lines.append(f"\nCourse material:\n{course_context[:6000]}")
    lines.append("\nReply in 2-4 sentences, in character, conversational — one Socratic move at a time. Address the "
                 "student directly ('you'). Do NOT output JSON, options, or a score — just your spoken reply. Light Markdown only.")
    return "\n".join(lines)


def _build_judge_system(payload):
    phase = payload.get('phase') or 'round'
    return "\n".join([
        "You are the silent assessor behind a Socratic tutor. You read the student's multiple-choice pick, their "
        "written 'why', and the tutor's reply, then classify the exchange. You are strict about effort: a vague, "
        "one-word, off-topic, or pick-mismatched 'why' is GAMING, not reasoning.",
        "",
        "Decide:",
        "- verdict: 'sound' (correct channel, real reasoning) | 'partial' (right instinct, gap) | 'wrong' (wrong "
        "channel, but a genuine attempt) | 'gaming' (low-effort / random / mismatched / no real explanation).",
        "- advance: true ONLY when the intuition has genuinely landed (the student reasons it correctly, possibly "
        "after self-correcting). Never advance on 'gaming'." + (
            " For this WARM-UP gate, advance as soon as they show they grasp the shock." if phase == 'gate' else ""),
        "- aha_reached: true when the student reaches the insight themselves (including after working through a wrong turn).",
        "- effort_signals: booleans describing THIS exchange:",
        "    explained_why (gave a real reason, not one word),",
        "    revised_after_nudge (changed their mind productively after your nudge),",
        "    worked_through_contradiction (followed a wrong read to its contradiction and resolved it),",
        "    low_effort (one-word / random / mismatched 'why').",
        "",
        "Respond with ONLY this JSON object, no prose:",
        '{ "verdict": "sound|partial|wrong|gaming", "advance": true|false, "aha_reached": true|false,',
        '  "effort_signals": { "explained_why": bool, "revised_after_nudge": bool, "worked_through_contradiction": bool, "low_effort": bool } }',
    ])


_DEFAULT_SIGNALS = {
    "explained_why": False,
    "revised_after_nudge": False,
    "worked_through_contradiction": False,
    "low_effort": False,
}


def turn(payload, ctx):
    """Generator: stream the tutor's Socratic reply, then emit a control verdict."""
    answer = payload.get('answer') or {}
    pick = (answer.get('pick') or '').strip()
    why = (answer.get('why') or '').strip()

    user_parts = []
    if pick:
        user_parts.append(f"The student picked: {pick}")
    user_parts.append(f"Their 'why': {why or '(they wrote nothing)'}")
    hist = _history_block(payload.get('history'))
    if hist:
        user_parts.append(hist)
    user_msg = "\n".join(user_parts)

    # 1) Stream the conversational reply the student sees.
    reply_text = ""
    with ctx.client.messages.stream(
        model=ctx.model,
        max_tokens=TURN_MAX_TOKENS,
        system=_build_turn_system(payload),
        messages=[{"role": "user", "content": user_msg}],
    ) as stream:
        for chunk in stream.text_stream:
            reply_text += chunk
            yield {"type": "token", "data": chunk}

    # 2) Hidden judge: classify the exchange for gating + scoring.
    verdict = {"verdict": "partial", "advance": False, "aha_reached": False, "effort_signals": dict(_DEFAULT_SIGNALS)}
    try:
        judge_user = (
            f"Student picked: {pick or '(none)'}\n"
            f"Student's why: {why or '(nothing)'}\n"
            f"Tutor's reply: {reply_text}\n\nReturn ONLY the control JSON."
        )
        jmsg = ctx.client.messages.create(
            model=ctx.model,
            max_tokens=JUDGE_MAX_TOKENS,
            system=_build_judge_system(payload),
            messages=[{"role": "user", "content": judge_user}],
        )
        parsed = ctx.extract_json(ctx.text_from_message(jmsg))
        if isinstance(parsed, dict):
            sig = parsed.get('effort_signals') if isinstance(parsed.get('effort_signals'), dict) else {}
            verdict = {
                "verdict": str(parsed.get('verdict', 'partial')),
                "advance": bool(parsed.get('advance', False)),
                "aha_reached": bool(parsed.get('aha_reached', False)),
                "effort_signals": {k: bool(sig.get(k, _DEFAULT_SIGNALS[k])) for k in _DEFAULT_SIGNALS},
            }
    except Exception:  # noqa: BLE001 — never let the judge break the turn; default keeps them in-round
        pass

    yield {"type": "control", **verdict}


# ── grade: effort-to-learn scoring ────────────────────────────────────────────

_DIMENSIONS = [
    ("engagement", "engagementWeight", "Genuine engagement — really explaining the 'why', not coasting"),
    ("revision", "revisionWeight", "Revising and improving after a Socratic nudge"),
    ("contradiction", "contradictionWeight", "Working through a contradiction to a self-correction"),
    ("aha", "ahaWeight", "Reaching the insight (aha) for each intuition, even after wrong turns"),
]


def _build_grade_system(payload):
    scenario = payload.get('scenario') or {}
    rubric = payload.get('rubric') or []
    lines = [
        "You grade a student's EFFORT TO LEARN in a Socratic economics simulation — NOT whether their first "
        "answers were correct. Reward genuinely explaining the 'why', revising after a nudge, working through a "
        "contradiction, and reaching the insight even after wrong turns. Coasting, random picks, and gaming earn "
        "little. The warm-up gate does NOT count.",
    ]
    sl = _scenario_line({"scenario": scenario})
    if sl:
        lines.append(f"\nScenario: {sl}")
    if rubric:
        lines.append("\nAdditional criteria the professor cares about:")
        for i, r in enumerate(rubric, 1):
            lines.append(f"{i}. {r}")
    lines.append("\nScore EACH dimension from 0 to 100 based on the tally and transcript:")
    for key, _, desc in _DIMENSIONS:
        lines.append(f"- {key}: {desc}")
    lines.append(
        "\nRespond with ONLY this JSON object, no prose:\n"
        '{ "scores": { "engagement": <0-100>, "revision": <0-100>, "contradiction": <0-100>, "aha": <0-100> },\n'
        '  "feedback": "<2-4 sentences of constructive, encouraging feedback for the student>" }'
    )
    return "\n".join(lines)


def grade(payload, ctx):
    weights = payload.get('weights') if isinstance(payload.get('weights'), dict) else {}
    tally = payload.get('tally') or {}
    transcript = payload.get('transcript') or []

    user = f"Tally of the student's effort (gate excluded):\n{json.dumps(tally)}"
    if transcript:
        user += f"\n\nTranscript of the scored rounds:\n{json.dumps(transcript)[:10000]}"
    user += "\n\nReturn ONLY the scoring JSON."

    msg = ctx.client.messages.create(
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
    description='Drop a student into a country hit by a shock; adaptive Socratic multiple-choice rounds until each intuition clicks. Scores effort-to-learn.',
    system_prompt=SYSTEM_PROMPT,
    prompt_hint='e.g. A sudden-stop capital-flight shock. Have students reason through aggregate demand, the exchange rate, interest rates and IS-LM. Ground it in Lectures 8–11.',
    schema='shock-world',
    normalize=_normalize,
    actions={'ground': ground, 'turn': turn, 'grade': grade},
)
