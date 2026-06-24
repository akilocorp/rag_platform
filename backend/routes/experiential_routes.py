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

from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt_identity

from src.agentic.agent_runner import CHART_GUIDE
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

GEN_SYSTEM = """You are an instructional designer building a STRUCTURED experiential macro/econ lab. \
You output ONE JSON object (no prose, no markdown fences) matching the ExperientialConfig schema below. \
The lab teaches an advanced model by starting from the baseline model the student already knows, then \
adding ONE complication at a time and revealing how the picture changes.

Pedagogical spine (always 3 layers): a BASELINE model, then TWO complications that each amplify a \
different variable. The student predicts how each complication changes the baseline, explains why, then \
sees it. Ground every framing, term and rough magnitude in the professor's prompt and the lecture \
excerpts provided. Numbers are ILLUSTRATIVE deviations from baseline — plausible and internally \
consistent, not estimated.

SCHEMA (fill every field):
{
  "meta": { "id": "<kebab-id>", "title": "<short title>", "discipline": "<e.g. Macroeconomics>",
            "level": "<e.g. MBA / Graduate>", "estMinutes": 20 },
  "scenario": { "brief": "<2-3 sentence shock/setup the student reasons about>" },
  "analyst": { "persona": "<a teaching analyst that builds from baseline intuition>",
               "stayInCharacter": true, "mode": "generative",
               "scriptedFallback": "<one fallback line if AI is unavailable>" },
  "predictionVariables": [   // EXACTLY 3 — the variables that carry the teaching point
    { "id": "<key>", "label": "<Label>", "type": "direction", "expected": "up" | "down",
      "intuition": "<what it surfaces>" }, ... x3
  ],
  "layers": [   // EXACTLY 3: index 0 = baseline, 1 & 2 = complications
    { "id": "baseline", "short": "Baseline", "name": "Baseline model (<CODE>)",
      "predictPrompt": "Set your baseline call, then reveal its path.",
      "changes": "<the baseline assumptions, plainly>",
      "reveal": { "chartSeries": { "<var1>": [8 numbers], "<var2>": [8 numbers] },
                  "tableRow": { "<Var1>": "<cell>", "<Var2>": "<cell>", "<Var3>": "<cell>" },
                  "narrative": "<what the baseline shows>" } },
    { "id": "<id>", "short": "+ <Short>", "name": "+ <Name> (<CODE>)",
      "unlockedByProbeId": "<probe id>",
      "extensionPredict": { "focus": "<the Variable label this complication most amplifies>",
                            "prompt": "Before we reveal it: once <complication>, does <FOCUS> fall more, about the same, or less than baseline?",
                            "expected": "more" | "same" | "less" },
      "changes": "<the mechanism this complication adds>",
      "reveal": { "chartSeries": { same keys as baseline, scaled to show amplification },
                  "tableRow": { same keys as baseline },
                  "narrative": "<the actual mechanism — used as ground truth>" } },
    { ... second complication amplifying a DIFFERENT variable ... }
  ],
  "probes": [   // EXACTLY 2, one per complication
    { "id": "<id>", "text": "<a short 'what if...' question>", "unlocksLayerId": "<layer id>",
      "answer": "<explains the complication, offers to add it>" }, ... x2
  ],
  "provenanceGates": [],
  "coach": { "hintAfterIdleSec": 60, "hintAfterUnproductiveProbes": 2, "maxHints": 3,
             "tone": "Socratic, one nudge at a time" },
  "synthesis": { "task": "<=120 word task to explain how each complication changes the baseline>",
                 "wordLimit": 120,
                 "rubric": ["<criterion>", "<criterion>", "<criterion>", "<criterion>"] },
  "scoring": { "predictionWeight": 50, "probeEfficiencyWeight": 0, "provenanceWeight": 0, "synthesisWeight": 50 }
}

RULES:
- chartSeries: 1-2 variables, EXACTLY 8 numbers each (Q1..Q8), deviations from baseline. Each complication's \
FOCUS variable must show clear amplification vs baseline (larger magnitude).
- tableRow: the SAME 3 keys across all three layers, with the Q1 cell for each (e.g. "-1.0%", "+1.5pp").
- chartSeries keys and tableRow keys are consistent across all layers.
- The two complications must amplify DIFFERENT variables (e.g. one investment-side, one consumption-side).
- extensionPredict.expected is the direction of CHANGE vs baseline for the focus variable ("more" = larger fall).
- Keep it crisp. Output ONLY the JSON object."""


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


def _normalize_experiential(cfg):
    """Fill safe defaults so small model omissions don't fail client validation."""
    if not isinstance(cfg, dict):
        return cfg
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


@experiential_bp.route('/experiential/generate', methods=['POST'])
def generate_experiential():
    payload = request.get_json(silent=True) or {}
    prompt = (payload.get('prompt') or '').strip()
    config_id = payload.get('config_id')
    if not prompt:
        return jsonify({"error": "Missing 'prompt'"}), 400

    client, err = _get_client()
    if client is None:
        return jsonify({"error": err}), 503

    kb_text = _retrieve_kb(config_id, prompt) if config_id else ""

    user_msg = f"Professor's design prompt:\n{prompt}"
    if kb_text:
        user_msg += f"\n\nRelevant lecture excerpts (ground the lab in these):\n{kb_text[:12000]}"
    user_msg += "\n\nReturn ONLY the JSON ExperientialConfig object."

    try:
        msg = client.messages.create(
            model=EXPERIENTIAL_MODEL,
            max_tokens=GEN_MAX_TOKENS,
            system=GEN_SYSTEM,
            messages=[{"role": "user", "content": user_msg}],
        )
        raw = _text_from_message(msg)
        cfg = _extract_json(raw)
        if not isinstance(cfg, dict) or not cfg.get('layers'):
            return jsonify({"error": "Could not parse a lab config from the model"}), 502
        cfg = _normalize_experiential(cfg)
        return jsonify({"config": cfg, "grounded": bool(kb_text)})
    except Exception as e:  # noqa: BLE001
        logger.exception("experiential generate failed")
        return jsonify({"error": f"Generation failed: {e}"}), 502


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
        "total_score": doc.get("total_score"),
        "username": doc.get("username"),
        "config_id": doc.get("config_id"),
        "template_id": doc.get("template_id"),
    }


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
        "title": data.get("title"),
        "discipline": data.get("discipline"),
        "level": data.get("level"),
        "total_score": data.get("total_score"),
        "breakdown": data.get("breakdown"),
        "predictions": data.get("predictions"),
        "layers_revealed": data.get("layers_revealed"),
        "probes_used": data.get("probes_used"),
        "synthesis_text": data.get("synthesis_text"),
        "graded_by": data.get("graded_by"),
    }
    res = ExperientialSession.create(doc)
    return jsonify({"session_id": str(res.inserted_id)}), 201


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
