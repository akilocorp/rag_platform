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
        "prosody_confidence": 0.45,
        "face_composure":     0.30,
        "volume_steadiness":  0.25,
        # face_coverage / lighting_quality removed: ceiling features, no discriminating power
    },
    "competence": {
        # Content-driven: fundamentals coverage + technical depth dominate
        "fundamentals_coverage": 0.45,
        "technical_depth":       0.35,
        "filler_rate":           0.12,
        "pacing_smoothness":     0.08,
        # vocabulary and llm_content removed: gameable / not content-specific
    },
    "passion": {
        # Weights here are for UI display only — actual score uses _compute_passion()
        # which applies the polish-penalty formula instead of a plain weighted average.
        "hume_enthusiasm":     0.50,
        "pitch_variation":     0.22,
        "valence_score":       0.15,
        "phrase_pitch_contour": 0.13,
        # vocal_control / energy_dynamics / facial_expressivity removed from core;
        # they feed the penalty term in _compute_passion, not the score directly.
    },
}

DEFAULT_COMPOSITE_WEIGHTS = {"confidence": 0.34, "competence": 0.33, "passion": 0.33}

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
