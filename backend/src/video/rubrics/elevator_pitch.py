"""Elevator Pitch preset — short, high-energy persuasive pitch.

Graded against Prof. Nason's PCCP framework and the 13 fundamentals.
Passion and Confidence weighted highest; content checks map 1-to-1 with
the fundamentals from the classroom slides (core version, slide 3) plus
the opening gambit.
"""
from src.video.rubrics.base import default_scoring_spec, register_preset

_spec = default_scoring_spec()
_spec["composite_weights"] = {"confidence": 0.35, "competence": 0.25, "passion": 0.40}
_spec["feedback_prompt_template"] = (
    "You are coaching a student on a 60-90 second ELEVATOR PITCH using Prof. Nason's "
    "framework. A great pitch opens with an effective gambit, covers the key fundamentals "
    "(pain, solution, customer, competition, deal, team, summary sentence), and is delivered "
    "with genuine PCCP — Project Competence, Competence, Confidence, and Passion. "
    "Passion means authentic belief and energy; aggressive, pushy, or salesy delivery is NOT "
    "passion and should lower the score. A flat or hesitant delivery fails even if the content "
    "is correct. Give specific, actionable feedback grounded in the actual transcript."
)
_spec["content_checks"] = [
    # ── Opening Gambit ──────────────────────────────────────────────────────
    {
        "id": "gambit",
        "label": "Opening Gambit",
        "description": (
            "Opens with one of the 17 classical gambits: Question, Anecdote, Quotation, Factoid, "
            "Retrospective, Prospective, Aphorism, Analogy, Humor, Grabber, Curiosity Arousal, "
            "The Problem, Hey-Yeh, The Whoa Intro, Presuming Audience Involvement, Room Reference, "
            "or Movie Preview. The gambit must be directly relevant to the pitch content and "
            "successfully grab attention within the first 8 seconds."
        ),
    },
    # ── The 13 Fundamentals (Prof. Nason, core slide 3) ─────────────────────
    {
        "id": "pain",
        "label": "The Pain",
        "description": "Clearly identifies the pain point — who is suffering and how badly. Makes the audience feel the urgency.",
    },
    {
        "id": "problem",
        "label": "The Problem",
        "description": "Articulates the specific, solvable problem behind the pain. Distinct from the pain itself.",
    },
    {
        "id": "solution",
        "label": "The Solution",
        "description": "Presents a clear, compelling solution. Explains *what* it does and *why* it works better than alternatives.",
    },
    {
        "id": "features",
        "label": "The Features",
        "description": "Describes at least one key feature of the solution (how it works, what it does). Can be brief in a 60-90s pitch.",
    },
    {
        "id": "benefits",
        "label": "The Benefits",
        "description": "States the specific value or outcome delivered to the customer — not just what it does, but what they gain.",
    },
    {
        "id": "technology",
        "label": "The Technology",
        "description": "Addresses the underlying technology, method, or IP (can be brief; even a single phrase counts if credible).",
    },
    {
        "id": "customer",
        "label": "The Customer",
        "description": "Clearly identifies the target customer segment — who buys this and why they would.",
    },
    {
        "id": "objective",
        "label": "The Objective",
        "description": "States the venture's goal or the presenter's objective (market leadership, funding round, pilot partnership, etc.).",
    },
    {
        "id": "competition",
        "label": "The Competition",
        "description": "Acknowledges competitors and states a clear, credible competitive advantage. Does not pretend there is no competition.",
    },
    {
        "id": "deal",
        "label": "The Deal",
        "description": "Describes the business model or deal structure — how money is made or how the opportunity is structured.",
    },
    {
        "id": "funding",
        "label": "$$ Needed & Return",
        "description": "Specifies (at least roughly) the funding needed and the expected return or upside for investors.",
    },
    {
        "id": "team",
        "label": "The Team",
        "description": "Introduces the team and their relevant credentials — why *this* team can execute.",
    },
    {
        "id": "summary_sentence",
        "label": "Summary Sentence",
        "description": (
            "Closes with a punchy, memorable summary sentence that crystallizes the entire pitch "
            "into one line. Does NOT trail off or end with 'any questions?'."
        ),
    },
]

register_preset(
    key="elevator_pitch",
    label="Elevator Pitch",
    description=(
        "60-90 second pitch graded on PCCP (Project Competence, Competence, Confidence, Passion) "
        "and the 13 fundamentals from Prof. Nason's framework."
    ),
    scoring_spec=_spec,
)
