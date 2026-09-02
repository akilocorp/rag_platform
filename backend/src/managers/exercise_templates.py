# @language  Python
# @updated   2026-08-31
# @changed   New file: exercise templates. A template is the FLOW plus the WORDS of one kind of
#            hidden-profile exercise. `hiring` reproduces exactly what every existing config does;
#            `investigation` is a shared-clue case (a murder file split three ways) that ends on the
#            group's answer with no reveal and no debrief, because the professor reads the class's
#            picks afterwards instead of the room being told who was right.
"""Templates for the hidden-profile exercise.

ONE MACHINE, SEVERAL EXERCISES
    Every template runs the same phase machine, the same sockets and the same
    simulator. What a template changes is only two things:

      `flow`     which optional phases exist. A hiring case reveals the outcome
                 six months on and then debriefs; an investigation does neither,
                 so the room ends the moment the group commits to an answer.
      `lexicon`  the student-facing nouns. The screens are written for a hiring
                 committee ("enter the hire", "your group hired X"), which reads
                 as a bug when the same screen is asking who killed someone.

    Nothing here touches the case pack, the roles or the answer key — those come
    from the professor's own documents either way.

WHY A REGISTRY AND NOT A SECOND BOT TYPE
    A second `bot_type` would fork a 1400-line state machine and a 1900-line
    player to change a dozen strings and skip two phases. The pedagogy is the
    same pedagogy: people hold different pieces, and a group reliably fails to
    pool them.

ADDING ONE
    Add an entry to `TEMPLATES`. Every key of `_HIRING["lexicon"]` must be
    present — `lexicon()` merges over the hiring defaults, so a missing key
    silently keeps hiring's word for it, which is the failure this note exists
    to make obvious. `flow` merges the same way.
"""
from typing import Dict

# The default. Byte-for-byte what the exercise did before templates existed, so a
# config with no `template` field behaves exactly as it always has.
DEFAULT_TEMPLATE = "hiring"

_HIRING: Dict = {
    "id": "hiring",
    "label": "Hiring committee",
    "description": (
        "A selection committee picks one candidate. Each member holds a partial view of the "
        "same shortlist. Six months later the outcome lands and ACTR debriefs the room."
    ),
    "flow": {
        # The kiosk gate + "six months later" outcome document.
        "reveal": True,
        # Round 2 with the facilitator. Requires `reveal` — the debrief opens on
        # the outcome the room has just read.
        "debrief": True,
    },
    "lexicon": {
        # `{role}` is the student's own confidential role, already trimmed of a
        # trailing "Manager" by the client.
        "role_headline": "You are the {role} Manager",
        "role_note": "What you know as the {role} Manager",
        "premise_line": (
            "{name} is making a hire, and your group has to choose the right person. "
            "You each hold a different piece of what's known about the candidates."
        ),
        "options_label": "The candidates: ",
        "solo_prompt": "Who would you hire?",
        "decision_title": "Your group's decision",
        "decision_help_decider": (
            "You're making the call for your group. Enter the candidate you all settled on — "
            "this is the group's only decision, and it's final."
        ),
        "decision_help_watcher": "{decider} is entering the hire your group settled on. This is the group's only decision.",
        "submit_label": "Enter our hire",
        "final_call_decider": "Final call — enter the hire now.",
        "decider_waiting": "{decider} is entering the hire for the group.",
        "done_group_label": "Your group hired",
        "material_line": "Here are their credentials, for your judgement.",
    },
}

# The murder-file variant. Same machine, no reveal and no debrief: the room commits
# to an answer and stops there. Who was actually right is not withheld by accident —
# it is deliberately not shown IN the room, because the professor runs that
# conversation from the class results page with every group's answer in front of
# them, which is a different (and better) conversation than each room learning its
# own verdict privately and separately.
_INVESTIGATION: Dict = {
    "id": "investigation",
    "label": "Investigation (shared case file)",
    "description": (
        "Each person reads a different version of the same case file and names a suspect alone, "
        "then the group has to agree on one. No answer is revealed in the room — the professor "
        "reads every group's answer on the results page."
    ),
    "flow": {
        "reveal": False,
        # Structurally off, not prompted off: with no reveal there is no outcome
        # document for a facilitator to debrief against.
        "debrief": False,
    },
    "lexicon": {
        # The role IS the document here ("Case File 1"), so it takes no job title.
        "role_headline": "You hold {role}",
        "role_note": "What's in {role}",
        "premise_line": (
            "{name}: someone has been murdered, and your group has to agree on who did it. "
            "You have each been given a different version of the case file."
        ),
        "options_label": "The suspects: ",
        "solo_prompt": "Who do you think did it?",
        "decision_title": "Your group's answer",
        "decision_help_decider": (
            "You're answering for your group. Name the person you all settled on — "
            "this is the group's only answer, and it's final."
        ),
        "decision_help_watcher": "{decider} is entering the name your group settled on. This is the group's only answer.",
        "submit_label": "Name our suspect",
        "final_call_decider": "Final call — enter the name now.",
        "decider_waiting": "{decider} is entering the group's answer.",
        "done_group_label": "Your group named",
        "material_line": "Read it, then decide on your own.",
    },
}

TEMPLATES: Dict[str, Dict] = {t["id"]: t for t in (_HIRING, _INVESTIGATION)}


def normalize(value) -> str:
    """Coerce anything to a known template id. Unknown input becomes the default.

    Never raises and never rejects: a template is a presentation choice, and an
    unrecognised one should not stop a class from running.
    """
    key = (value or "").strip().lower()
    return key if key in TEMPLATES else DEFAULT_TEMPLATE


def get(value) -> Dict:
    """The whole template document for an id (falling back to the default)."""
    return TEMPLATES[normalize(value)]


def lexicon(value) -> Dict[str, str]:
    """This template's student-facing strings, merged OVER the hiring defaults.

    Merging rather than replacing means a template only has to state what it says
    differently, and a key added here later cannot blank a screen on a template
    that predates it.
    """
    merged = dict(_HIRING["lexicon"])
    merged.update(get(value).get("lexicon") or {})
    return merged


def flow(value) -> Dict[str, bool]:
    """This template's optional phases, merged over the hiring defaults.

    `debrief` is forced off when `reveal` is off: the debrief opens on the outcome
    document the room has just read, so debriefing without a reveal would put the
    facilitator in a room discussing something nobody has seen.
    """
    merged = dict(_HIRING["flow"])
    merged.update(get(value).get("flow") or {})
    if not merged.get("reveal"):
        merged["debrief"] = False
    return merged


def listing():
    """Every template as `{id, label, description}` — what a picker needs."""
    return [{"id": t["id"], "label": t["label"], "description": t["description"]}
            for t in TEMPLATES.values()]
