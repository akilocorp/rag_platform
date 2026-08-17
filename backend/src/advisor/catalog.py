# @language  Python
# @updated   2026-08-12
# @changed   New file: the advisor's feature catalog — what each platform feature fits, what it
#            explicitly does NOT fit, and what the professor must supply before it can run.
"""What the advisor believes about the platform.

This is the only description of our features the recommendation model ever sees.
It is deliberately NOT the user guide: the guide (`frontend/src/guide/pages/*.md`)
is reader-oriented and long, written to be read by a human who has already
decided. This is decision-oriented and short, written to be reasoned against —
so `does_not_fit` and `requires_from_professor` carry as much weight here as the
pitch does.

Two fields do most of the accuracy work:

  - `does_not_fit` — the anti-cases. Without these the model finds a use for
    every feature in every week, which is the failure mode that makes the whole
    recommendation worthless. A prof who is shown eight strong fits in a
    thirteen-week course stops believing the second one.
  - `requires_from_professor` — the real setup burden, taken from what the
    backend actually validates. A Manager Exercise recommended to someone with
    no hidden-profile case is a recommendation that dies at Publish; naming the
    prep up front is the difference between a lead and a wasted afternoon.

`guide_page` is a page id in `frontend/src/guide/content.js`, so a recommendation
can deep-link `/userguide/<id>` rather than us re-writing setup docs that exist.

Adding a feature: append an entry. Nothing else in the advisor enumerates
features — `syllabus.py` renders whatever is here into the prompt and validates
against whatever is here, so a new entry is picked up on both sides at once.
"""

# One entry per bot_type the config wizard can produce. `key` matches the
# `bot_type` stored on the config doc, which is what phase 2's one-click setup
# will hand to the wizard — so these strings are a contract, not labels.
FEATURES = [
    {
        "key": "chat",
        "label": "Chat Bot",
        "one_line": "A 1:1 AI tutor, TA, or role-play partner, grounded in documents you upload.",
        "fits_when": [
            "Students need practice or tutoring outside class, individually and at their own pace",
            "The professor wants a persona the student talks to in character (an HR interviewer, a "
            "skeptical buyer, a client, a Socratic tutor who never gives the answer outright)",
            "There is course material — readings, lecture slides, a case — the answers should be "
            "grounded in rather than the model's general knowledge",
            "Office-hours overflow: the same questions asked repeatedly about one topic",
            "A session that is mostly reading or problem sets, where a study partner would help but "
            "no live activity is being run",
        ],
        "does_not_fit": [
            "A session whose whole point is students hearing EACH OTHER — a debate, a group "
            "decision, a seminar discussion. 1:1 chat removes exactly the thing being taught.",
            "Assessing delivery, presence, or speaking — that is Video Analysis",
            "A guest speaker, an exam, a review session, or a field trip",
        ],
        "requires_from_professor": [
            "A few sentences of persona and instructions (a template can start this)",
            "Optionally, course documents to ground answers in — PDF, DOCX, PPTX, TXT, MD, or a URL",
        ],
        "class_size_range": [1, 500],
        "minutes_needed": 0,
        "minutes_note": "Runs outside class time; no session minutes required.",
        "guide_page": "prof-chat-bot",
    },
    {
        "key": "group_chat",
        "label": "Group Chat",
        "one_line": "Small groups of students discuss together in a room with AI participants.",
        "fits_when": [
            "The syllabus names a small-group discussion, breakout, or seminar where students argue "
            "a position with each other",
            "Peer discussion is the pedagogy, and the professor wants a transcript of it afterwards",
            "The class is too large to give every group a facilitator, so an AI takes that seat",
            "A discussion the professor wants seeded with a viewpoint nobody in the room holds",
        ],
        "does_not_fit": [
            "A structured hidden-profile decision where each student holds different confidential "
            "information — that is the Manager Exercise, which is built for exactly that shape",
            "Individual practice or tutoring (Chat Bot)",
            "A lecture, or any session where students are not talking to each other",
        ],
        "requires_from_professor": [
            "A discussion prompt and the group size (1-10 students per room)",
            "The persona of the AI participants in the room",
        ],
        "class_size_range": [2, 300],
        "minutes_needed": 20,
        "minutes_note": "Needs roughly 20 minutes of live class time or more.",
        "guide_page": "prof-chat-bot",
    },
    {
        "key": "manager_exercise",
        "label": "Manager Exercise",
        "one_line": "A hidden-profile group decision: each student holds different confidential "
                    "information, the group decides together, then an AI facilitator debriefs what "
                    "they missed.",
        "fits_when": [
            "The session teaches group decision-making, information pooling, hiring or selection "
            "committees, or how teams over-weight what everyone already knows",
            "A case where the right answer is only visible if the group shares what each member "
            "privately knows — the classic hidden-profile setup",
            "The professor already runs a committee simulation, a selection exercise, or a case "
            "where students take assigned roles",
            "Sessions on groupthink, shared-information bias, escalation of commitment, or "
            "post-mortem analysis of a decision",
        ],
        "does_not_fit": [
            "An open discussion with no decision to reach and no per-student private information — "
            "use Group Chat",
            "A case discussion where everyone reads the SAME case. The whole mechanism depends on "
            "students holding DIFFERENT packets; give them all the same document and it is a "
            "seminar with extra setup.",
            "Any session under about 45 minutes — three rounds plus the debrief will not fit",
            "Individual work of any kind",
        ],
        "requires_from_professor": [
            "A case built as a hidden profile: several candidates or options, and one confidential "
            "packet per role, each holding different facts",
            "An outcome document for EVERY candidate — the backend rejects a candidate with no "
            "uploaded outcome, and the group only ever sees the outcome of the one they picked",
            "Students assigned to roles, one seat each",
        ],
        "class_size_range": [3, 12],
        "minutes_needed": 45,
        "minutes_note": "Three rounds plus a facilitated debrief; needs 45-90 minutes.",
        "guide_page": "prof-manager-exercise",
    },
    {
        "key": "experiential",
        "label": "Experiential Lab",
        "one_line": "A predict-then-reveal simulation: students commit to a prediction, the model "
                    "shows what actually happens, and an AI walks them through the gap.",
        "fits_when": [
            "The session teaches a causal chain or a model with downstream effects — an economic "
            "shock, a policy change, a market or system reacting",
            "The professor wants students to COMMIT to a prediction before seeing the answer, so "
            "being wrong is the teachable moment",
            "'What happens if X' framing anywhere in the session description",
            "Comparative statics, scenario analysis, stress tests, or 'walk through the mechanism'",
        ],
        "does_not_fit": [
            "Descriptive or definitional material with no mechanism to predict",
            "Sessions about people and judgment rather than systems and mechanisms (a hiring "
            "decision is a Manager Exercise, not a lab)",
            "Any topic where the professor could not state, in one line, what the correct "
            "prediction is",
        ],
        "requires_from_professor": [
            "A short description of the scenario and the mechanism being taught — the lab itself is "
            "AI-generated from that prompt and then edited",
            "Willingness to review the generated lab before publishing; it is a draft, not an oracle",
        ],
        "class_size_range": [1, 300],
        "minutes_needed": 20,
        "minutes_note": "Works in class or as homework; about 20-40 minutes per student.",
        "guide_page": "prof-experiential",
    },
    {
        "key": "video_analysis",
        "label": "Video Analysis",
        "one_line": "Students record a presentation or pitch; it is scored against the professor's "
                    "own rubric with written feedback per criterion.",
        "fits_when": [
            "The syllabus names a presentation, pitch, demo day, defense, or any graded speaking "
            "assignment",
            "Students need reps before the real thing, and the professor cannot watch 60 practice "
            "runs",
            "Elevator pitches, research defenses, client-facing communication, interview practice",
            "The professor wants class-wide analytics on delivery — where the cohort is weakest",
        ],
        "does_not_fit": [
            "Written work of any kind",
            "Group discussion where nobody is presenting",
            "A session where students watch a presentation rather than give one",
        ],
        "requires_from_professor": [
            "The scoring criteria — either a built-in preset (elevator pitch, research defense) or "
            "the professor's own scoring boxes, each scored out of 10 with a written paragraph",
            "A deadline and instructions for what students should record",
        ],
        "class_size_range": [1, 500],
        "minutes_needed": 0,
        "minutes_note": "Students record outside class; no session minutes required.",
        "guide_page": "prof-video-analysis",
    },
]

# Fast lookup by key. Built once at import — the catalog is a constant.
_BY_KEY = {f["key"]: f for f in FEATURES}


def get_catalog():
    """Every feature, in the order the prompt and the UI should present them."""
    return FEATURES


def get_feature(key):
    """One feature by `bot_type` key, or None. Used by validation to reject a
    recommendation naming a feature that does not exist."""
    return _BY_KEY.get(key)


def get_keys():
    """The set of valid feature keys — the allowed values in the recommendation schema."""
    return [f["key"] for f in FEATURES]


def render_for_prompt():
    """Render the catalog as the reference block the recommendation model reads.

    Rendered rather than JSON-dumped because the model has to weigh these against
    prose from a syllabus, and the negative cases need to read as instructions
    ("do NOT recommend this when...") rather than as data. The rendering is
    deterministic and carries no timestamps, so it stays a stable cacheable
    prefix across every request.
    """
    blocks = []
    for f in FEATURES:
        lines = [
            f"### {f['label']}  (key: {f['key']})",
            f["one_line"],
            "",
            "FITS a session when any of these are true:",
        ]
        lines += [f"  - {s}" for s in f["fits_when"]]
        lines.append("")
        lines.append("Do NOT recommend it when:")
        lines += [f"  - {s}" for s in f["does_not_fit"]]
        lines.append("")
        lines.append("The professor must already have, or be willing to make:")
        lines += [f"  - {s}" for s in f["requires_from_professor"]]
        lo, hi = f["class_size_range"]
        lines.append("")
        lines.append(f"Class size it works for: {lo}-{hi} students. {f['minutes_note']}")
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks)
