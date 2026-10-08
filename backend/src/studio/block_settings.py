# @language  Python
# @updated   2026-10-08
# @changed   New file: settings every Studio block shares (help text, variable name, request
#            response, display logic, reverse scoring, numeric codes), applied on top of each
#            block's own validator so no block file has to repeat them. Also the server-side display-
#            logic evaluator and the plain-text stripper for rich-text question labels.
"""
Common block settings — the granular, researcher-facing options the builder's
right-hand settings panel edits for every block, regardless of type.

They live inside the block's `config` (not a separate key) so they ride along
everywhere config already goes: autosave, the public project view, the runner,
the CSV export. `registry.validate_block_config` runs the block's own
validator first, then `apply_common_settings` adds these keys on top.

Answerable blocks are the ones whose cleaned config carries `required` (see
routes/studio_routes.py's _answerable_blocks); content-only blocks (rich_text)
only get display logic, since help text / variable names / scoring mean
nothing for a block that captures no answer.
"""
import math
import re
from typing import Any, Dict, Iterable, List, Optional

MAX_HELP_TEXT_CHARS = 500
MAX_VARIABLE_NAME_CHARS = 40
MAX_LOGIC_VALUE_CHARS = 200

# A single_choice "Other, please specify" answer is stored as this prefix +
# the respondent's text, so it stays a plain string for the CSV and summary.
OTHER_OPTION = "Other"
OTHER_PREFIX = "Other: "

LOGIC_OPS = {"answered", "not_answered", "equals", "not_equals", "gt", "lt"}

# Per-type extras: reverse scoring only means something on a numeric scale,
# numeric codes only on a fixed list of labelled options.
REVERSIBLE_TYPES = {"rating_scale", "semantic_differential"}
CODEABLE_TYPES = {"single_choice", "yes_no"}

_PIPE_RE = re.compile(r"\{\{answer:[A-Za-z0-9_\-]+\}\}")
_LINK_RE = re.compile(r"\[([^\]]+)\]\((https?://[^)\s]+)\)")
_EMPHASIS_RE = re.compile(r"(\*\*|\*)(.+?)\1")
_VARNAME_BAD_RE = re.compile(r"[^A-Za-z0-9_]+")


def _is_num(v):
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _clean_variable_name(raw) -> str:
    """Coerce to an export-safe identifier (letters, digits, underscore,
    starting with a letter) instead of rejecting — e.g. "Trust 1" -> "Trust_1",
    "2nd" -> "q_2nd". Empty stays empty (the CSV falls back to the question)."""
    name = _VARNAME_BAD_RE.sub("_", str(raw or "").strip()).strip("_")
    if name and not name[0].isalpha():
        name = f"q_{name}"
    return name[:MAX_VARIABLE_NAME_CHARS]


def _clean_display_logic(raw) -> Optional[Dict[str, Any]]:
    """{source_block_id, op, value} or None. Whether the source actually exists
    earlier in the project is checked later, by link_display_logic, since a
    single block's validator can't see its siblings."""
    if not isinstance(raw, dict):
        return None
    source = str(raw.get("source_block_id") or "").strip()
    op = raw.get("op")
    if not source or op not in LOGIC_OPS:
        return None
    value = raw.get("value")
    if op in ("answered", "not_answered"):
        value = ""
    elif _is_num(value):
        value = str(value)
    else:
        value = str(value or "")[:MAX_LOGIC_VALUE_CHARS]
    return {"source_block_id": source, "op": op, "value": value}


def apply_common_settings(block_type: str, raw: Dict[str, Any], cleaned: Dict[str, Any]) -> Dict[str, Any]:
    """Add the shared settings to an already type-validated config."""
    out = dict(cleaned)
    out["display_logic"] = _clean_display_logic(raw.get("display_logic"))
    if "required" not in cleaned:
        return out

    out["help_text"] = str(raw.get("help_text") or "")[:MAX_HELP_TEXT_CHARS]
    out["variable_name"] = _clean_variable_name(raw.get("variable_name"))
    # A soft nudge ("you skipped this — continue anyway?") is meaningless on a
    # block that already hard-requires an answer.
    out["request_response"] = bool(raw.get("request_response")) and not out["required"]
    if block_type in REVERSIBLE_TYPES:
        out["reverse_scored"] = bool(raw.get("reverse_scored"))
    if block_type in CODEABLE_TYPES:
        out["export_codes"] = bool(raw.get("export_codes"))
    return out


def link_display_logic(blocks: List[Dict[str, Any]]) -> None:
    """Cross-block pass over one page's sanitized blocks, in order, in place.

    Display logic may only point at an EARLIER answerable block — anything
    else (a deleted block, a later one, itself, an Instructions block) is
    dropped, which also rules out cycles. Variable names must be unique across
    the page for the CSV; a later duplicate is cleared rather than renamed, so
    the professor sees it go blank and picks a name instead of getting "_2".
    """
    earlier_answerable = set()
    seen_names = set()
    for blk in blocks:
        cfg = blk["config"]
        logic = cfg.get("display_logic")
        if logic and logic["source_block_id"] not in earlier_answerable:
            cfg["display_logic"] = None

        name = cfg.get("variable_name")
        if name:
            if name.lower() in seen_names:
                cfg["variable_name"] = ""
            else:
                seen_names.add(name.lower())

        if "required" in cfg:
            earlier_answerable.add(blk["id"])


def _is_answered(value) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, dict)):
        return bool(value)
    return True


def logic_matches(logic: Dict[str, Any], answer) -> bool:
    """Whether a source block's answer satisfies one display-logic rule.
    Mirrors frontend/src/studio/displayLogic.js exactly — the runner hides the
    block, the server uses this to decide whether it was ever required."""
    op = logic.get("op")
    if op == "answered":
        return _is_answered(answer)
    if op == "not_answered":
        return not _is_answered(answer)
    if not _is_answered(answer):
        return False

    target = str(logic.get("value") or "")
    if op in ("gt", "lt"):
        try:
            a, t = float(answer), float(target)
        except (TypeError, ValueError):
            return False
        return a > t if op == "gt" else a < t

    if isinstance(answer, (list, dict)):
        equal = False
    elif target == OTHER_OPTION and isinstance(answer, str) and answer.startswith(OTHER_PREFIX):
        equal = True
    elif _is_num(answer):
        try:
            equal = float(answer) == float(target)
        except ValueError:
            equal = False
    else:
        equal = str(answer) == target
    return equal if op == "equals" else not equal


def visible_block_ids(blocks: Iterable[Dict[str, Any]], answers_by_id: Dict[str, Any]) -> set:
    """Ids of the blocks a respondent with these answers was actually shown.
    A hidden block's answer counts as absent for anything that depends on it,
    so logic chains (C depends on B depends on A) collapse correctly."""
    visible = set()
    for blk in blocks:
        logic = (blk.get("config") or {}).get("display_logic")
        if not logic:
            visible.add(blk["id"])
            continue
        source = logic.get("source_block_id")
        answer = answers_by_id.get(source) if source in visible else None
        if logic_matches(logic, answer):
            visible.add(blk["id"])
    return visible


def plain_text(text) -> str:
    """A rich-text question as a plain label — for CSV headers and the Present
    view, where `**bold**` or a raw `{{answer:blk_…}}` token would be noise."""
    s = _PIPE_RE.sub("[…]", str(text or ""))
    s = _LINK_RE.sub(r"\1", s)
    s = _EMPHASIS_RE.sub(r"\2", s)
    s = re.sub(r"^\s*[-*]\s+", "", s, flags=re.MULTILINE)
    return " ".join(s.split())
