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

logger = logging.getLogger(__name__)

experiential_bp = Blueprint('experiential', __name__)

# "Make it real" uses Claude Sonnet.
EXPERIENTIAL_MODEL = 'claude-sonnet-4-6'
ANALYST_MAX_TOKENS = 700
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
    return "\n".join(lines)


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
