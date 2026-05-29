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
        "prosody_confidence": 0.33,
        "face_composure": 0.22,
        "volume_steadiness": 0.17,
        "face_coverage": 0.10,      # fraction of frames where face is visible
        "lighting_quality": 0.06,
        "posture": 0.08,            # phase 2
        "sway": 0.04,               # phase 2 (inverted)
    },
    "competence": {
        "llm_content": 0.55,        # LLM-evaluated transcript quality (hook/structure/evidence/vocab/close)
        "pacing_smoothness": 0.13,
        "hedging": 0.12,            # inverted (low hedging → high score)
        "filler_rate": 0.12,        # inverted (low fillers → high score)
        "vocabulary": 0.08,         # unique word ratio (higher = more articulate)
    },
    "passion": {
        "pitch_variation": 0.25,
        "energy_dynamics": 0.25,
        "hume_enthusiasm": 0.25,
        "facial_expressivity": 0.15,
        "gesture_activity": 0.10,   # phase 2
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
