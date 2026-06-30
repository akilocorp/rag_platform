"""
Experiential lab — live Claude Sonnet endpoints.

The structured simulation (probes, layer reveals, exact IRF numbers, provenance
gate, false-precision trap) stays SCRIPTED on the frontend for pedagogical
determinism. Only two pieces are "real":

  POST /api/experiential/analyst  — free-form in-character analyst replies
  POST /api/experiential/grade    — rubric-based synthesis grading + feedback

Both are public (no JWT): an experiential lab can be played by anonymous
students via a class link. They degrade gracefully — if the Anthropic key or
SDK is missing the frontend falls back to its scripted behaviour.
"""
import json
import logging
import os
import re
from datetime import datetime

import pymongo
from flask import Blueprint, jsonify, request, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity

from src.agentic.agent_runner import CHART_GUIDE
from src.experiential import registry as method_registry
from models.experiential_session import ExperientialSession
from models.config import Config
from models.user import User

logger = logging.getLogger(__name__)

experiential_bp = Blueprint('experiential', __name__)

# "Make it real" uses Claude Sonnet.
EXPERIENTIAL_MODEL = 'claude-sonnet-4-6'
ANALYST_MAX_TOKENS = 1100
GRADE_MAX_TOKENS = 900


def _get_client():
    """Return (client, error_message). client is None when unavailable."""
    api_key = os.getenv("ANTHROPIC_API_KEY")
    if not api_key:
        return None, "Anthropic API key is not configured on this server."
    try:
        import anthropic
    except ImportError:
        return None, "anthropic SDK is not installed on this server."
    return anthropic.Anthropic(api_key=api_key), None


def _text_from_message(msg):
    """Concatenate the text blocks of an Anthropic message response."""
    parts = []
    for block in (msg.content or []):
        if getattr(block, "type", None) == "text":
            parts.append(block.text)
    return "".join(parts).strip()


def _extract_json(raw):
    """Best-effort parse of a JSON object from a model reply (handles fences)."""
    if not raw:
        return None
    s = raw.strip()
    # Strip ```json ... ``` fences if present.
    fence = re.search(r"```(?:json)?\s*(\{[\s\S]*?\})\s*```", s)
    if fence:
        s = fence.group(1)
    else:
        brace = re.search(r"\{[\s\S]*\}", s)
        if brace:
            s = brace.group(0)
    try:
        return json.loads(s)
    except (ValueError, TypeError):
        return None


# ─── Generate: build a full lab config from a prompt + knowledge base ────────

GEN_MAX_TOKENS = 5000

# Pedagogical method system prompts now live in backend/src/experiential/methods/
# (one file per method). Drop a file there to add a method — see that folder's
# README. The professor's own design prompt fine-tunes the chosen method.


def _retrieve_kb(config_id, query, k=8):
    """Best-effort vector search over the config's knowledge base."""
    try:
        from langchain_mongodb.vectorstores import MongoDBAtlasVectorSearch
        vs = MongoDBAtlasVectorSearch(
            collection=current_app.config['MONGO_DB']['vector_collection'],
            embedding=current_app.config['EMBEDDINGS'],
            index_name="vector",
        )
        docs = vs.similarity_search(query=query or "course overview", k=k, pre_filter={"config_id": str(config_id)})
        parts = []
        for d in docs:
            meta = d.metadata or {}
            src = meta.get('original_file') or meta.get('source') or 'lecture'
            parts.append(f"[{src}] {d.page_content}")
        return "\n\n".join(parts)
    except Exception:
        logger.exception("experiential KB retrieval failed")
        return ""


def _to_number(v):
    """Best-effort parse of a chart value to a float (handles '-1.5%', '+3 pts')."""
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        m = re.search(r'-?\d+(?:\.\d+)?', v.replace(',', ''))
        if m:
            return float(m.group(0))
    return None


def _coerce_chart_series(cfg):
    """Force every layer.reveal.chartSeries value into a number[] so the client
    validator accepts it even when the model emits stringified or unit-tagged
    numbers ('-1.5%') or a quarter-keyed object instead of a bare array."""
    layers = cfg.get('layers')
    if not isinstance(layers, list):
        return
    for lyr in layers:
        reveal = lyr.get('reveal') if isinstance(lyr, dict) else None
        cs = reveal.get('chartSeries') if isinstance(reveal, dict) else None
        if not isinstance(cs, dict):
            continue
        for k, arr in list(cs.items()):
            if isinstance(arr, dict):
                arr = list(arr.values())
            if not isinstance(arr, list):
                cs.pop(k, None)
                continue
            nums = [n for n in (_to_number(x) for x in arr) if n is not None]
            if nums:
                cs[k] = nums
            else:
                cs.pop(k, None)


def _apply_model_computation(cfg):
    """Replace each layer's chartSeries with values COMPUTED from the lab's model.

    When the generator supplies a top-level `model` block (Python `simulate(p)`
    plus a variable list) and per-layer `params`, we run the model deterministically
    and overwrite chartSeries — so the curve is real math, not the model's guess.
    Any problem (no model block, unsafe code, bad shape) leaves the illustrative
    chartSeries untouched: accuracy when we can, graceful fallback when we can't.
    """
    model = cfg.get('model')
    layers = cfg.get('layers')
    if not isinstance(model, dict) or not isinstance(layers, list):
        return
    variables = model.get('variables')
    if not isinstance(variables, list) or not variables:
        # Infer the chart keys from the baseline layer when omitted.
        base_cs = ((layers[0] or {}).get('reveal') or {}).get('chartSeries') or {}
        variables = list(base_cs.keys())
    horizon = model.get('horizon')
    if not isinstance(horizon, int):
        horizon = 8
    param_sets = [(lyr.get('params') if isinstance(lyr, dict) else None) or {} for lyr in layers]
    try:
        from src.experiential.model_runner import run_model, ModelError
        computed = run_model(model.get('code'), param_sets, variables, horizon)
    except ModelError as e:
        logger.warning("experiential model compute skipped (%s) — using model's illustrative series", e)
        return
    except Exception:  # noqa: BLE001 — never let compute break generation
        logger.exception("experiential model compute crashed — using illustrative series")
        return
    for lyr, series in zip(layers, computed):
        reveal = lyr.get('reveal')
        if not isinstance(reveal, dict):
            reveal = {}
            lyr['reveal'] = reveal
        reveal['chartSeries'] = series


def _normalize_experiential(cfg):
    """Fill safe defaults so small model omissions don't fail client validation."""
    if not isinstance(cfg, dict):
        return cfg
    _coerce_chart_series(cfg)
    _apply_model_computation(cfg)
    cfg.setdefault('provenanceGates', [])
    coach = cfg.get('coach')
    if not isinstance(coach, dict):
        coach = {}
    coach.setdefault('hintAfterIdleSec', 60)
    coach.setdefault('hintAfterUnproductiveProbes', 2)
    coach.setdefault('maxHints', 3)
    coach.setdefault('tone', 'Socratic, one nudge at a time')
    cfg['coach'] = coach
    sc = cfg.get('scoring')
    if not isinstance(sc, dict):
        sc = {}
    sc.setdefault('predictionWeight', 50)
    sc.setdefault('probeEfficiencyWeight', 0)
    sc.setdefault('provenanceWeight', 0)
    sc.setdefault('synthesisWeight', 50)
    cfg['scoring'] = sc
    analyst = cfg.get('analyst')
    if isinstance(analyst, dict):
        analyst.setdefault('mode', 'generative')
        analyst.setdefault('stayInCharacter', True)
        analyst.setdefault('scriptedFallback', 'Start from the baseline model, then ask what each complication changes.')
    return cfg


@experiential_bp.route('/experiential/methods', methods=['GET'])
def list_methods():
    """Pedagogical methods the professor can pick (drives the generator dropdown)."""
    return jsonify({"methods": method_registry.list_methods()})


@experiential_bp.route('/experiential/generate', methods=['POST'])
def generate_experiential():
    payload = request.get_json(silent=True) or {}
    prompt = (payload.get('prompt') or '').strip()
    config_id = payload.get('config_id')
    template = (payload.get('template') or 'econ').strip().lower()
    if not prompt:
        return jsonify({"error": "Missing 'prompt'"}), 400

    client, err = _get_client()
    if client is None:
        return jsonify({"error": err}), 503

    system = method_registry.get_system_prompt(template)
    kb_text = _retrieve_kb(config_id, prompt) if config_id else ""

    user_msg = f"Professor's design prompt:\n{prompt}"
    if kb_text:
        user_msg += f"\n\nRelevant lecture excerpts (ground the lab in these):\n{kb_text[:12000]}"
    user_msg += "\n\nReturn ONLY the JSON ExperientialConfig object."

    try:
        msg = client.messages.create(
            model=EXPERIENTIAL_MODEL,
            max_tokens=GEN_MAX_TOKENS,
            system=system,
            messages=[{"role": "user", "content": user_msg}],
        )
        raw = _text_from_message(msg)
        cfg = _extract_json(raw)
        if not isinstance(cfg, dict) or not cfg.get('layers'):
            return jsonify({"error": "Could not parse a lab config from the model"}), 502
        cfg = _normalize_experiential(cfg)
        # Stamp the pedagogy so the player page mounts the right validator + UI.
        cfg['method'] = method_registry.get_schema(template)
        return jsonify({"config": cfg, "grounded": bool(kb_text)})
    except Exception as e:  # noqa: BLE001
        logger.exception("experiential generate failed")
        return jsonify({"error": f"Generation failed: {e}"}), 502


# ─── Adapt: re-ground a lab to the student's chosen parameters ────────────────
# Lets a student customize a lab at play time (e.g. pick a country). Grounded
# choices pull current real-world context via Tavily, then Claude rewrites the
# scenario/numbers while KEEPING the structure (ids, counts) intact so the lab
# still plays. Adaptations are cached per (lab, choices) so the cost is paid
# once per distinct choice set, not once per student.

ADAPT_CACHE_TTL_SECONDS = 86400  # re-ground once a day so "current" stays current

ADAPT_SYSTEM = """You are adapting an existing experiential lab to a student's chosen parameters. You \
receive the CURRENT lab config (JSON) plus the student's choices and, when relevant, real-world context. \
Rewrite the lab so its scenario, narratives and ILLUSTRATIVE numbers fit those choices and reflect the \
real-world context provided.

HARD CONSTRAINTS — keep the STRUCTURE identical so the lab still plays:
- Keep the SAME ids everywhere: meta.id, every layer id, every probe id, every predictionVariable id, \
every chartSeries key, every tableRow key, and all cross-links (unlockedByProbeId / unlocksLayerId, \
extensionPredict.focus must still match a predictionVariable label).
- Keep the same NUMBER of layers, probes, predictionVariables, and the same chartSeries array lengths.
- Keep model.code and model.variables EXACTLY as given (the backend re-runs the model to draw the charts). \
You MAY adjust each layer's `params` numbers to fit the chosen parameters/real-world context — the curves \
recompute from them. Keep the same param keys.
- Change only human-readable content and numbers: meta.title, chartCaption, scenario.brief, each \
layer.changes and layer.reveal.narrative, chartSeries numbers, tableRow cells, analyst.persona context, \
synthesis.task and rubric wording. Keep studentChoices unchanged (or omit it).
- Numbers stay ILLUSTRATIVE, plausible and internally consistent — and consistent with the real-world \
context where one is given.

Output ONE JSON object (the full adapted ExperientialConfig), no prose, no markdown fences."""


def _tavily_search(query, max_results=5):
    """Best-effort web search; returns formatted text or '' (never raises)."""
    api_key = os.getenv("TAVILY_API_KEY")
    if not api_key:
        return ""
    try:
        from tavily import TavilyClient
        resp = TavilyClient(api_key=api_key).search(query=query, max_results=max_results, search_depth="basic")
        results = (resp or {}).get("results") or []
        parts = []
        for r in results:
            title = (r.get("title") or "").strip()
            content = (r.get("content") or "").strip()
            if content:
                parts.append(f"{title}: {content}")
        return "\n\n".join(parts)
    except Exception:
        logger.exception("experiential adapt web search failed")
        return ""


def _adapt_collection():
    client = pymongo.MongoClient(current_app.config["MONGO_URI"], serverSelectionTimeoutMS=5000)
    return client[current_app.config["MONGO_DB_NAME"]]["experiential_adaptations"]


def _adapt_cache_key(base_id, choices):
    sig = "|".join(
        f"{c.get('id')}={str(c.get('value', '')).strip().lower()}"
        for c in sorted(choices, key=lambda c: str(c.get('id')))
    )
    return f"{base_id}::{sig}"


def _adapt_cache_get(key):
    try:
        doc = _adapt_collection().find_one({"cache_key": key})
        if not doc:
            return None
        created = doc.get("created_at")
        if created and (datetime.utcnow() - created).total_seconds() > ADAPT_CACHE_TTL_SECONDS:
            return None
        return doc.get("config")
    except Exception:
        logger.exception("adapt cache read failed")
        return None


def _adapt_cache_set(key, config):
    try:
        _adapt_collection().update_one(
            {"cache_key": key},
            {"$set": {"cache_key": key, "config": config, "created_at": datetime.utcnow()}},
            upsert=True,
        )
    except Exception:
        logger.exception("adapt cache write failed")


@experiential_bp.route('/experiential/adapt', methods=['POST'])
def adapt_experiential():
    payload = request.get_json(silent=True) or {}
    base = payload.get('config')
    choices = payload.get('choices') or []
    base_id = (payload.get('base_id') or '').strip()
    if not isinstance(base, dict) or not base.get('layers'):
        return jsonify({"error": "Missing base config"}), 400
    # Nothing to adapt → hand the base config straight back.
    chosen = [c for c in choices if isinstance(c, dict) and str(c.get('value', '')).strip()]
    if not chosen:
        return jsonify({"config": base, "cached": False})

    cache_key = _adapt_cache_key(base_id, chosen)
    cached = _adapt_cache_get(cache_key)
    if cached:
        return jsonify({"config": cached, "cached": True})

    client, err = _get_client()
    if client is None:
        return jsonify({"error": err}), 503

    # Pull current real-world context for any grounded choice.
    brief = (base.get('scenario') or {}).get('brief', '')
    web_parts = []
    for c in chosen:
        if c.get('grounded'):
            q = f"{brief[:160]} — current real-world situation in {c.get('value')} ({c.get('label', '')})".strip()
            ctx = _tavily_search(q)
            if ctx:
                web_parts.append(f"[{c.get('label')}: {c.get('value')}]\n{ctx}")
    web_context = "\n\n".join(web_parts)

    choices_str = "; ".join(f"{c.get('label')}: {c.get('value')}" for c in chosen)
    user_msg = f"Student choices: {choices_str}\n\nCurrent lab config:\n{json.dumps(base)}"
    if web_context:
        user_msg += f"\n\nReal-world context (ground the scenario and numbers in this):\n{web_context[:12000]}"
    user_msg += "\n\nReturn ONLY the adapted JSON ExperientialConfig object."

    try:
        msg = client.messages.create(
            model=EXPERIENTIAL_MODEL,
            max_tokens=GEN_MAX_TOKENS,
            system=ADAPT_SYSTEM,
            messages=[{"role": "user", "content": user_msg}],
        )
        cfg = _extract_json(_text_from_message(msg))
        if not isinstance(cfg, dict) or not cfg.get('layers'):
            return jsonify({"error": "Could not parse an adapted lab config"}), 502
        cfg = _normalize_experiential(cfg)
        # Adaptation rewrites content but keeps the pedagogy — carry it through.
        cfg['method'] = base.get('method') or 'predict-reveal'
        _adapt_cache_set(cache_key, cfg)
        return jsonify({"config": cfg, "cached": False, "grounded": bool(web_context)})
    except Exception as e:  # noqa: BLE001
        logger.exception("experiential adapt failed")
        return jsonify({"error": f"Adaptation failed: {e}"}), 502


# ─── Analyst: free-form in-character replies ─────────────────────────────────

def _build_analyst_system(payload):
    persona = (payload.get('persona') or '').strip()
    stay = bool(payload.get('stayInCharacter', True))
    scenario = (payload.get('scenario') or '').strip()
    title = (payload.get('labTitle') or 'Macro Lab').strip()
    state = payload.get('state') or {}

    revealed = state.get('revealedLayers') or []
    numbers_verified = bool(state.get('numbersVerified'))
    probe_qa = state.get('probeQA') or []
    prediction = state.get('prediction') or []

    lines = [persona, ""]
    lines.append(f"You are the analyst inside an interactive teaching simulation titled \"{title}\".")
    if scenario:
        lines.append(f"Scenario the student is reasoning about: {scenario}")

    if revealed:
        lines.append("\nModels currently revealed to the student (stay consistent with these — do NOT invent numbers that contradict them):")
        for lyr in revealed:
            name = (lyr.get('name') or '').strip()
            narrative = (lyr.get('narrative') or '').strip()
            lines.append(f"- {name}: {narrative}")
    else:
        lines.append("\nNo refined models have been revealed yet beyond the baseline.")

    if probe_qa:
        lines.append("\nAnswers you have already given to the student's structured probes (be consistent with these):")
        for qa in probe_qa:
            q = (qa.get('q') or '').strip()
            a = (qa.get('a') or '').strip()
            if q and a:
                lines.append(f"- Q: {q}\n  A: {a}")

    if prediction:
        calls = ", ".join(f"{p.get('label')}: {p.get('call')}" for p in prediction if p.get('label'))
        if calls:
            lines.append(f"\nThe student's own directional prediction was — {calls}.")

    lines.append("")
    if stay:
        if numbers_verified:
            lines.append("The student has already probed your framework, so you may speak openly about the provenance of the numbers (calibrated/illustrative, not estimated).")
        else:
            lines.append("Stay fully in character as a confident expert. Do NOT volunteer that the impulse-response numbers are merely calibrated/illustrative unless the student's question directly forces the issue — then answer honestly.")
    lines.append(
        "Answer the student's free-form question concisely (2–5 sentences), in character, grounded in the scenario and the models above. "
        "When the student offers their own reasoning or a 'why', evaluate it honestly before anything else: open by stating plainly whether it is right, partly right, or wrong. "
        "If it is correct, confirm it and sharpen it with the precise mechanism; if it is wrong, incomplete, or names the wrong channel, say so directly and correct it. "
        "Do NOT flatter, rubber-stamp, or agree by default — a vague, hand-wavy 'why' (e.g. 'costs go up so everything falls') is not a correct one, and you should name the gap between it and the actual mechanism. "
        "Reserve clear praise for reasoning that genuinely identifies the right channel. "
        "Where the lab hasn't revealed a specific number, reason qualitatively about the mechanism rather than fabricating figures. "
        "Use light Markdown. Do not use emojis."
    )
    return "\n".join(lines) + CHART_GUIDE


@experiential_bp.route('/experiential/analyst', methods=['POST'])
def analyst_reply():
    payload = request.get_json(silent=True) or {}
    question = (payload.get('question') or '').strip()
    if not question:
        return jsonify({"error": "Missing 'question'"}), 400

    client, err = _get_client()
    if client is None:
        return jsonify({"error": err}), 503

    system_prompt = _build_analyst_system(payload)
    try:
        msg = client.messages.create(
            model=EXPERIENTIAL_MODEL,
            max_tokens=ANALYST_MAX_TOKENS,
            system=system_prompt,
            messages=[{"role": "user", "content": question}],
        )
        reply = _text_from_message(msg)
        if not reply:
            return jsonify({"error": "Empty model response"}), 502
        return jsonify({"reply": reply})
    except Exception as e:  # noqa: BLE001 — surface a clean error, let client fall back
        logger.exception("experiential analyst call failed")
        return jsonify({"error": f"Analyst call failed: {e}"}), 502


# ─── Grade: rubric-based synthesis evaluation ────────────────────────────────

def _build_grade_system(payload):
    task = (payload.get('task') or '').strip()
    rubric = payload.get('rubric') or []
    word_limit = payload.get('wordLimit')
    context = payload.get('context') or {}
    scenario = (context.get('scenario') or '').strip()
    layers = context.get('layers') or []

    lines = [
        "You are a rigorous but fair macroeconomics grader evaluating a student's short written synthesis in a teaching simulation.",
    ]
    if scenario:
        lines.append(f"\nScenario: {scenario}")
    if layers:
        lines.append("\nGround truth the student should reflect (models and their key mechanisms):")
        for lyr in layers:
            name = (lyr.get('name') or '').strip()
            narrative = (lyr.get('narrative') or '').strip()
            lines.append(f"- {name}: {narrative}")
    lines.append(f"\nThe assigned task was: {task}")
    if isinstance(word_limit, (int, float)):
        lines.append(f"The word limit was {int(word_limit)} words.")

    lines.append("\nEvaluate the synthesis against EACH of these rubric criteria, deciding whether the student met it:")
    for i, r in enumerate(rubric, 1):
        lines.append(f"{i}. {r}")

    lines.append(
        "\nRespond with ONLY a JSON object, no prose outside it, of the exact shape:\n"
        "{\n"
        '  "rubric": [{"criterion": "<verbatim criterion text>", "met": true|false, "note": "<one short sentence>"}],\n'
        '  "feedback": "<2-4 sentences of constructive feedback for the student>"\n'
        "}\n"
        "Include one rubric entry per criterion, in the given order, using the criterion text verbatim."
    )
    return "\n".join(lines)


@experiential_bp.route('/experiential/grade', methods=['POST'])
def grade_synthesis():
    payload = request.get_json(silent=True) or {}
    synthesis = (payload.get('synthesis') or '').strip()
    rubric = payload.get('rubric') or []
    if not synthesis:
        return jsonify({"error": "Missing 'synthesis'"}), 400
    if not isinstance(rubric, list) or not rubric:
        return jsonify({"error": "Missing 'rubric'"}), 400

    client, err = _get_client()
    if client is None:
        return jsonify({"error": err}), 503

    system_prompt = _build_grade_system(payload)
    try:
        msg = client.messages.create(
            model=EXPERIENTIAL_MODEL,
            max_tokens=GRADE_MAX_TOKENS,
            system=system_prompt,
            messages=[{"role": "user", "content": f"Student synthesis:\n\n{synthesis}"}],
        )
        raw = _text_from_message(msg)
        parsed = _extract_json(raw)
        if not parsed or not isinstance(parsed.get('rubric'), list):
            return jsonify({"error": "Could not parse grader response"}), 502

        # Normalize: align to the requested rubric order, coerce met to bool.
        # Prefer verbatim text match; fall back to positional alignment.
        graded = parsed['rubric']
        by_text = {str(item.get('criterion', '')).strip(): item for item in graded}
        normalized = []
        for i, crit in enumerate(rubric):
            item = by_text.get(str(crit).strip())
            if item is None:
                item = graded[i] if i < len(graded) else {}
            normalized.append({
                "criterion": crit,
                "met": bool(item.get('met', False)),
                "note": str(item.get('note', '')).strip(),
            })

        met = sum(1 for n in normalized if n['met'])
        return jsonify({
            "rubric": normalized,
            "metCount": met,
            "total": len(rubric),
            "feedback": str(parsed.get('feedback', '')).strip(),
        })
    except Exception as e:  # noqa: BLE001
        logger.exception("experiential grade call failed")
        return jsonify({"error": f"Grade call failed: {e}"}), 502


# ── Saved sessions ───────────────────────────────────────────────────────────
# A finished run is persisted so the student can revisit it and the lab owner
# (professor) can review every student's run. Logged-in only — sessions are
# attributed by JWT user_id.

def _session_summary(doc):
    created = doc.get("created_at")
    return {
        "session_id": str(doc["_id"]),
        "title": doc.get("title") or "Untitled lab",
        "timestamp": created.isoformat() if created else None,
        "status": doc.get("status") or "completed",
        "total_score": doc.get("total_score"),
        "username": doc.get("username"),
        "config_id": doc.get("config_id"),
        "template_id": doc.get("template_id"),
    }


# Fields a client may write on create/update (the rest are server-controlled).
_SESSION_MUTABLE = (
    "title", "discipline", "level", "status", "total_score", "breakdown",
    "predictions", "layers_revealed", "probes_used", "synthesis_text",
    "graded_by", "transcript", "effective_config",
)


def _owns_config(config_id, user_id):
    if not config_id:
        return False
    try:
        cfg = Config.find_by_id(config_id)
    except Exception:
        return False
    return bool(cfg) and str(cfg.get("user_id")) == str(user_id)


@experiential_bp.route('/experiential/sessions', methods=['POST'])
@jwt_required()
def save_experiential_session():
    user_id = get_jwt_identity()
    data = request.get_json(silent=True) or {}

    username = None
    try:
        u = User.find_by_id(user_id)
        username = u.get("username") if u else None
    except Exception:
        pass

    doc = {
        "user_id": user_id,
        "username": username,
        "config_id": data.get("config_id"),
        "template_id": data.get("template_id"),
        "status": data.get("status") or "in_progress",
    }
    for k in _SESSION_MUTABLE:
        if k in data:
            doc[k] = data.get(k)
    res = ExperientialSession.create(doc)
    return jsonify({"session_id": str(res.inserted_id)}), 201


@experiential_bp.route('/experiential/sessions/<sid>', methods=['PUT'])
@jwt_required()
def update_experiential_session(sid):
    user_id = get_jwt_identity()
    try:
        doc = ExperientialSession.find_by_id(sid)
    except Exception:
        doc = None
    if not doc:
        return jsonify({"error": "Not found"}), 404
    if str(doc.get("user_id")) != str(user_id):
        return jsonify({"error": "Forbidden"}), 403

    data = request.get_json(silent=True) or {}
    fields = {k: data.get(k) for k in _SESSION_MUTABLE if k in data}
    if fields:
        ExperientialSession.update_by_id(sid, fields)
    return jsonify({"session_id": sid})


@experiential_bp.route('/experiential/sessions', methods=['GET'])
@jwt_required()
def list_my_experiential_sessions():
    user_id = get_jwt_identity()
    docs = ExperientialSession.find_by_user(user_id)
    return jsonify({"sessions": [_session_summary(d) for d in docs]})


@experiential_bp.route('/experiential/sessions/by-config/<config_id>', methods=['GET'])
@jwt_required()
def list_config_experiential_sessions(config_id):
    user_id = get_jwt_identity()
    try:
        cfg = Config.find_by_id(config_id)
    except Exception:
        cfg = None
    if not cfg:
        return jsonify({"error": "Config not found"}), 404
    if str(cfg.get("user_id")) != str(user_id):
        return jsonify({"error": "Forbidden"}), 403
    docs = ExperientialSession.find_by_config(config_id)
    return jsonify({"sessions": [_session_summary(d) for d in docs]})


@experiential_bp.route('/experiential/sessions/<sid>', methods=['GET'])
@jwt_required()
def get_experiential_session(sid):
    user_id = get_jwt_identity()
    try:
        doc = ExperientialSession.find_by_id(sid)
    except Exception:
        doc = None
    if not doc:
        return jsonify({"error": "Not found"}), 404

    is_owner = str(doc.get("user_id")) == str(user_id)
    if not (is_owner or _owns_config(doc.get("config_id"), user_id)):
        return jsonify({"error": "Forbidden"}), 403

    created = doc.get("created_at")
    doc["session_id"] = str(doc.pop("_id"))
    doc["created_at"] = created.isoformat() if created else None
    return jsonify({"session": doc})
