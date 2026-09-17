# @language  Python
# @updated   2026-09-17
# @changed   New file: the built-in class templates a professor can start a new class from,
#            shipped with the Elevator Pitch video assignment as the first entry.
"""Built-in class templates — the ready-made classes on the "New Assistant" gallery.

WHAT REACHES THE GALLERY
    Two different kinds of template land in the same grid:
      * a BUILT-IN — a class ACTR ships, defined in this file; and
      * a PUBLISHED CLASS — any professor's own config flagged `is_template: True`
        in its settings, instantiated through the existing copy/paste clone path.
    This module owns only the first kind. `config_routes.py` merges both into one
    list (`GET /config/templates`) and instantiates whichever the professor picked.

WHY EACH TEMPLATE BUILDS ITS DOCUMENT THROUGH A CALLABLE
    `_pitch_video_fragment()` reads the elevator-pitch rubric out of the live
    `src.video.rubrics` registry at call time rather than freezing a copy here.
    That rubric gets edited as the course is taught (new content checks, reweighted
    boxes); a frozen copy would quietly hand every new class last term's rubric.

WHY A FRAGMENT AND NOT A WHOLE DOCUMENT
    A template returns only the fields that make it that template. The route merges
    the fragment over the same base document the create wizard builds, so a class
    started from a template and a class built by hand come out of one code path —
    a new required field added to `POST /config` cannot go missing here.

ADDING ANOTHER BUILT-IN
    One more `register(...)` call at the bottom of this file. The gallery route, the
    instantiate route and the frontend grid all read this registry, so nothing else
    needs to change.
"""
import copy
from collections import OrderedDict
from typing import Any, Callable, Dict, List, Optional

# key -> {title, description, icon, bot_type, default_name, fragment}
BUILTIN_TEMPLATES: "OrderedDict[str, Dict[str, Any]]" = OrderedDict()


def register(key: str, title: str, description: str, icon: str, bot_type: str,
             default_name: str, fragment: Callable[[], Dict[str, Any]]) -> None:
    """Add one built-in template to the gallery. Raises on key collision at import
    time, the same contract as the video rubric registry it sits beside."""
    if key in BUILTIN_TEMPLATES:
        raise ValueError(f"Built-in template key collision: '{key}' already registered")
    BUILTIN_TEMPLATES[key] = {
        "title": title,
        "description": description,
        "icon": icon,
        "bot_type": bot_type,
        "default_name": default_name,
        "fragment": fragment,
    }


def list_templates() -> List[Dict[str, Any]]:
    """Gallery cards for every built-in, in registration order.

    `template_id` is namespaced (`builtin:<key>`) because the gallery mixes these
    with professor-published configs (`config:<object_id>`) and the instantiate
    route has to tell the two apart from the id alone.
    """
    return [
        {
            "template_id": f"builtin:{key}",
            "source": "builtin",
            "title": t["title"],
            "description": t["description"],
            "icon": t["icon"],
            "bot_type": t["bot_type"],
            "default_name": t["default_name"],
            "file_count": 0,
            "author": "ACTR",
        }
        for key, t in BUILTIN_TEMPLATES.items()
    ]


def get(key: str) -> Optional[Dict[str, Any]]:
    return BUILTIN_TEMPLATES.get(key)


def build_fragment(key: str) -> Optional[Dict[str, Any]]:
    """The config fields that make this template what it is, freshly built.

    Deep-copied on the way out so a caller mutating the result (the route stamps
    `bot_name`, `class_code` and `collection_name` onto it) cannot reach back into
    a registry the next professor will read.
    """
    t = BUILTIN_TEMPLATES.get(key)
    if not t:
        return None
    return copy.deepcopy(t["fragment"]())


# ---------------------------------------------------------------------------
# Built-ins
# ---------------------------------------------------------------------------

def _pitch_video_fragment() -> Dict[str, Any]:
    """Elevator-pitch video assignment: students record a 60-90s pitch, ACTR scores
    it against the PCCP rubric and the 13 fundamentals.

    Everything scoring-related is pulled from the `elevator_pitch` rubric preset
    rather than restated, so this template and the wizard's "Elevator Pitch"
    assignment type can never disagree. `instructions` is the same dummy line the
    wizard sends for video classes — video_analysis has no chat model or RAG, but
    the create path still requires an instructions string.
    """
    from src.video.rubrics import registry as video_registry

    return {
        "bot_type": "video_analysis",
        "assignment_type": "elevator_pitch",
        "scoring_spec": video_registry.get_default_spec("elevator_pitch"),
        "instructions": "Video analysis assignment: elevator_pitch",
        "introduction": (
            "Record a 60-90 second elevator pitch. You'll be scored on your opening "
            "gambit, the 13 fundamentals, and your delivery (competence, confidence, "
            "passion)."
        ),
        "bots": [],
        "web_access": False,
    }


register(
    key="pitch_video",
    title="Elevator Pitch (Video)",
    description=(
        "Students record a 60-90 second pitch. Auto-scored on the opening gambit, the 13 "
        "fundamentals, and PCCP delivery, with a class dashboard of the weakest boxes."
    ),
    icon="🎤",
    bot_type="video_analysis",
    default_name="Elevator Pitch",
    fragment=_pitch_video_fragment,
)
