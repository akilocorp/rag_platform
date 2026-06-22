"""Assignment-type preset primitives.

Mirrors `src/agentic/tools/base.py`: a module-level registry dict that preset
modules populate via `register_preset(...)` on import. Each preset supplies a
full default `scoring_spec` that the config wizard copies onto the config doc,
where a professor may then edit weights / prompt / content-checks WITHOUT code
changes. The scoring layer always reads `scoring_spec` from the config.

A `scoring_spec` has this shape:

    {
      "version": "1",
      "composite_weights": {"confidence": .., "competence": .., "passion": ..},
      "submetric_weights": {
        "confidence": {<submetric>: weight, ...},
        "competence": {<submetric>: weight, ...},
        "passion":    {<submetric>: weight, ...},
      },
      "feedback_prompt_template": "<str>",
      "content_checks": [{"id": "..", "label": "..", "description": ".."}],
    }

Sub-metric keys are the canonical signals computed by the scoring layer. Some
are phase-2 (pose-derived): posture, sway, gesture_activity. Listing them in a
preset is harmless in phase 1 — the roll-up renormalizes over whichever
sub-metrics are actually present in the collected data.
"""
import copy
from typing import Any, Callable, Dict, List

# key -> {"label", "description", "scoring_spec"}
# Populated as a side-effect of importing the preset modules.
ASSIGNMENT_PRESETS: Dict[str, Dict[str, Any]] = {}

# Canonical sub-metric → composite mapping. Presets start from these defaults
# and tune the weights. `phase2` submetrics are pose-derived and absent until
# MediaPipe is wired; the roll-up ignores absent submetrics.
DEFAULT_SUBMETRIC_WEIGHTS: Dict[str, Dict[str, float]] = {
    "confidence": {
        # prosody_confidence dominates; face/steadiness sit near 50 for most clips
        "prosody_confidence": 0.65,
        "face_composure":     0.20,
        "volume_steadiness":  0.15,
    },
    "competence": {
        # fundamentals_coverage is the primary driver (were all 7 components covered?)
        # technical_depth is secondary; filler/pacing are minor
        "fundamentals_coverage": 0.62,
        "technical_depth":       0.15,
        "filler_rate":           0.15,
        "pacing_smoothness":     0.08,
    },
    "passion": {
        # Display-only weights — actual score uses _compute_passion() (valence-primary formula)
        "valence_score":        0.70,
        "hume_enthusiasm":      0.20,
        "pitch_variation":      0.10,
        # vocal_control / energy_dynamics feed the gated penalty, not the core score
    },
}

DEFAULT_COMPOSITE_WEIGHTS = {"confidence": 0.34, "competence": 0.33, "passion": 0.33}

# Customizable scoring "boxes". Each dimension renders as a card with a score
# out of 10 + a one-paragraph rationale. Professors rename/redefine/add/remove
# these per config; the scoring agent reads whichever signals (delivery report
# and/or transcript) are relevant to each definition. Names/definitions are the
# only knobs — there is no per-source picker by design.
DEFAULT_DIMENSIONS = [
    {
        "id": "confidence",
        "name": "Confidence",
        "definition": (
            "How assured and composed the speaker appears and sounds — steady gaze and head "
            "position, grounded posture, controlled and purposeful gestures, and a steady voice "
            "free of nervous fidgeting, shakiness, or excessive filler."
        ),
    },
    {
        "id": "competence",
        "name": "Competence",
        "definition": (
            "How credible, in-command, and well-prepared the speaker comes across — organized, "
            "clear delivery, controlled pacing, purposeful movement, and a transcript that "
            "communicates the idea knowledgeably and without confusion."
        ),
    },
    {
        "id": "passion",
        "name": "Passion",
        "definition": (
            "How energized, animated, and genuinely enthusiastic the delivery is — expressive "
            "gestures and face, vocal energy and pitch/intensity variation, and momentum that "
            "conveys conviction without tipping into frantic or performative."
        ),
    },
]

DEFAULT_FEEDBACK_PROMPT = (
    "You are an expert presentation coach evaluating a spoken video presentation. "
    "Using the transcript and the delivery signals provided, write concise, encouraging "
    "but honest feedback. Focus on what the speaker did well and the highest-leverage "
    "improvements for confidence, competence (content), and passion (energy)."
)


def default_scoring_spec() -> Dict[str, Any]:
    """A fresh, fully-populated spec presets can deep-copy and tweak."""
    return {
        "version": "1",
        "composite_weights": dict(DEFAULT_COMPOSITE_WEIGHTS),
        "submetric_weights": copy.deepcopy(DEFAULT_SUBMETRIC_WEIGHTS),
        "feedback_prompt_template": DEFAULT_FEEDBACK_PROMPT,
        "dimensions": copy.deepcopy(DEFAULT_DIMENSIONS),
        "content_checks": [],
        "target_duration_sec": 60,
    }


def register_preset(key: str, label: str, scoring_spec: Dict[str, Any], description: str = "") -> None:
    """Register an assignment-type preset. Raises on key collision (import time)."""
    if key in ASSIGNMENT_PRESETS:
        raise ValueError(f"Assignment preset key collision: '{key}' already registered")
    ASSIGNMENT_PRESETS[key] = {
        "label": label,
        "description": description,
        "scoring_spec": scoring_spec,
    }
