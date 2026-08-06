# @language  Python
# @updated   2026-07-26
# @changed   New: class learning-point presets for the manager exercise (seeded with "Creative Class").
"""Learning-point presets offered in the manager-exercise authoring wizard.

The frontend dropdown only ever sends a preset KEY. The full learning-point text
lives here and is stamped into `manager_exercise.learning_points` server-side at
config-save time, so long pedagogy text never rides on the wire and every config
saved with the same preset gets byte-identical wording.

`learning_points` is injected verbatim into the facilitator system prompt (see
`facilitator_prompt.build_facilitator_system`), which is why the text is written
as instructions the facilitator can steer toward rather than as a course blurb.
"""

CREATIVE_CLASS_POINTS = """1. CREATIVE CONFIDENCE
   - View failures as learning opportunities.
   - Develop a willingness to experiment.
2. PROBLEM IDENTIFICATION AND REFRAMING — identifying the right problem is often
   more important than generating solutions.
   - Question assumptions.
   - Define the underlying problem rather than symptoms.
   - View situations from multiple stakeholder perspectives.
   - Reframe problems in multiple ways.
3. DIVERGENT THINKING — generate many different ideas without immediate evaluation.
   - Quantity of information before quality assessment.
   - Delay judgment.
   - Encourage unusual ideas.
   - Combine and build on others' ideas.
4. CONVERGENT THINKING
   - Consider appropriate criteria: most positives and fewest negatives."""

# Keyed by the value the authoring dropdown submits. `label` is display-only.
CLASS_PRESETS = {
    "creative": {
        "label": "Creative Class",
        "learning_points": CREATIVE_CLASS_POINTS,
    },
}


def get_learning_points(key):
    """Resolve a preset key to its learning-point text; "" for unknown/empty keys.

    Unknown keys degrade to "" rather than raising so an older config referencing
    a retired preset still saves — the exercise just runs on `learning_outcome`
    alone.
    """
    preset = CLASS_PRESETS.get((key or "").strip())
    return preset["learning_points"] if preset else ""


def preset_options():
    """[{key, label}] for the authoring dropdown."""
    return [{"key": k, "label": v["label"]} for k, v in CLASS_PRESETS.items()]
