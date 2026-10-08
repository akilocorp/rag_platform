# @language  Python
# @updated   2026-10-08
# @changed   Block settings from the builder's new settings panel: saves run block_settings'
#            link_display_logic (logic may only point at an earlier block; variable names unique);
#            submit skips the required check for blocks display logic hid, and drops their answers;
#            single_choice accepts "Other: …" when allow_other is on; text answers honour max_chars;
#            the CSV uses variable names as headers, strips rich-text markup from question labels,
#            and adds `_r` (reverse-scored) and `_code` (numeric code) columns where asked for.
# Prior: Second-pass regression fixes: an answer that no longer fits the block's current config
#            (professor edited a live form) is kept as `value_raw` and still counts as answered, so a
#            respondent can't get stuck on "required"; body cap 2 MB / text 50k (long voice transcripts
#            carry ~2 KB of prosody per turn); per-IP ceilings raised to 1000/h as a stopgap until the
#            proxy hop count is confirmed; plain numbers stay unescaped in the CSV; the IP ceiling is
#            checked before the respondent cooldown; empty live-AI calls don't spend a slot; the
#            live-summary filter and CSV metric cells skip malformed legacy rows.
# Prior: Security/reliability pass on the public surface. Rate limits key on ProxyFix's
#            remote_addr (never the spoofable X-Forwarded-For), are atomic fixed-window counters,
#            and split into a per-respondent cooldown + generous per-IP ceiling so a classroom on one
#            NAT isn't throttled; the cooldown is charged only after validation. Submissions are
#            size-capped and every answer is coerced to its block's shape (_coerce_answer) before
#            storage. The public view no longer ships answer keys/rubrics; the CSV export is
#            formula-injection safe with a Unicode-safe filename; deleting a project deletes its
#            responses; non-object JSON bodies get 400 instead of 500; failed AI grades are cached
#            as "grading failed" and retried at most hourly instead of re-billed on every view.
# Prior: live-summary gained cross-filter query params (filter_block_id/filter_value) — filters
#            the raw response list before handing it to build_live_summary, so every aggregation
#            function stays unchanged. Powers the Present view's click-a-bar-to-filter-everything-else.
# Prior: Added GET /studio/projects/<id>/live-summary — the data source for the new Present
#            view (a Mentimeter-style QR + live-results screen for in-class use). Delegates all
#            aggregation to the new src/studio/summary.py; see that file's header for why it
#            excludes every AI-native and data-quality/compliance instrument by design, not oversight.
# Prior: 3 session-level, Qualtrics-inspired features. Embedded Data: submit_response now
#            accepts+sanitizes a client-supplied `embedded_data` dict (URL params captured at load),
#            stored on the response doc, surfaced as dynamic CSV columns (same discovery pattern as
#            instrument metrics). Counterbalanced conditions: projects gain a `conditions` list
#            (save_project); submit_response round-robin-assigns one via an atomic
#            `$inc`/find_one_and_update on the project doc (deliberately assigned at submit time, not
#            page-load, since there's no respondent-keyed pre-assignment need without a conditional-
#            rendering engine yet — see the Piped Text instrument's own note on that gap). Piping:
#            no route changes — piped_text is a normal instrument, resolved entirely client-side in
#            StudioRunnerPage from already-loaded answers.
# Prior: Phase 2: instruments are now real. Added GET /studio/instrument-specs (feeds the
#            Instruments ribbon tab); _sanitize_pages validates each block's `instruments` against
#            the registry instead of force-emptying it; the public submit endpoint accepts a
#            per-answer `events` array (frontend-captured performance.now() timestamps); and
#            list_responses/export_responses_csv now compute + attach instrument metrics (e.g. the
#            Reaction Timer's latency_ms) via _augment_responses_with_metrics.
#            Prior: Phase 1: published projects are now readable/submittable anonymously, and owners
#            can read back what came in. Added GET /studio/public/projects/<id> (published-only,
#            strips user_id), POST /studio/public/projects/<id>/responses (creates a
#            studio_responses doc, enforces `required` blocks, rate-limited per IP+project via a
#            TTL-indexed collection — no new dependency, mirrors the lazy create_index-once pattern
#            in src/models/manager_exercise_session.py), GET .../responses (owner, raw list), and
#            GET .../responses.csv (owner, flattened export).
#            Prior: New file: Studio Phase 0 CRUD — create/list/get/save/delete a project, plus the
#            block-spec catalog that feeds the builder's ribbon.
"""
HTTP for Studio projects — the drag-and-drop research-instrument builder.

Owner-scoped (faculty, JWT-required):
  GET    /api/studio/block-specs             — the Blocks ribbon tab's catalog
  GET    /api/studio/instrument-specs        — the Instruments ribbon tab's catalog
  POST   /api/studio/projects                — create a new project (one blank page)
  GET    /api/studio/projects                — list the caller's own projects (light: no page/block bodies)
  GET    /api/studio/projects/<id>           — one project, full body
  PUT    /api/studio/projects/<id>           — save pages/blocks/status (the canvas autosave target)
  DELETE /api/studio/projects/<id>           — delete
  GET    /api/studio/projects/<id>/responses      — raw response list, with computed instrument metrics
  GET    /api/studio/projects/<id>/responses.csv  — flattened CSV export, same metrics as columns
  GET    /api/studio/projects/<id>/live-summary   — aggregated stats for the Present view (polled)

Public (no auth — the first anonymous-write surface Studio has):
  GET    /api/studio/public/projects/<id>            — a project's pages/blocks, ONLY if published
  POST   /api/studio/public/projects/<id>/responses  — submit one respondent's full answer set
                                                        (each answer may carry an `events` array).
                                                        May also carry `embedded_data` (sanitized,
                                                        capped) and gets round-robin assigned one of
                                                        the project's `conditions`, if any.

Mongo access goes through current_app.config['MONGO_DB'] (the connection set
up once in app.py) rather than a fresh pymongo.MongoClient per call — see
models/user.py's get_collection() docstring for why the other pattern (used
by a few older models in this codebase) is a connection-pool leak.
"""
import csv
import hashlib
import io
import json
import logging
import math
import re
import uuid
from datetime import datetime, timezone
from urllib.parse import quote

from bson import ObjectId
from bson.errors import InvalidId
from flask import Blueprint, Response, current_app, jsonify, request
from flask_jwt_extended import get_jwt_identity, jwt_required
from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from models.user import User
from src.studio.block_settings import (
    OTHER_OPTION,
    OTHER_PREFIX,
    link_display_logic,
    plain_text,
    visible_block_ids,
)
from src.studio.live_ai import call_live_ai_instrument, has_live_ai_input
from src.studio.summary import build_live_summary
from src.studio.registry import (
    compute_instrument_metric,
    get_block_specs,
    get_instrument_specs,
    instrument_needs_events,
    validate_block_config,
    validate_instrument_config,
)

logger = logging.getLogger(__name__)
studio_bp = Blueprint('studio_routes', __name__)

FACULTY_ROLES = ("professor", "admin")

# Public-endpoint rate limits — fixed-window counters, see _bump_counter.
#  - Per respondent: one submission per cooldown, against double-submits.
#    Keyed on the runner's localStorage respondent_id, NOT the IP, because a
#    whole classroom usually shares one campus NAT address — per-IP keying let
#    exactly one student submit every 30s during an in-class Present session.
#  - Per (project, IP): a generous volume ceiling. This is the real abuse
#    backstop, since respondent_id is client-chosen. Deliberately high: if a
#    proxy in front of nginx isn't counted in app.py's ProxyFix(x_for=...),
#    every respondent resolves to that proxy's address and this becomes a
#    per-project total — it must still never stop a large lecture.
#  - Live AI calls additionally have a per-project daily ceiling that ignores
#    IP entirely, so spend is hard-capped even against many addresses.
STUDIO_RESPONSE_COOLDOWN_SECONDS = 30
SUBMITS_PER_IP_PER_HOUR = 1000
AI_CALLS_PER_IP_PER_HOUR = 1000
AI_CALLS_PER_PROJECT_PER_DAY = 3000
_rate_limit_index_ensured = False

# Public submission limits — the one anonymous write surface. Sized for the
# heaviest real case: a voice transcript carries Hume's full prosody map
# (~2 KB) on every turn, so a long conversation alone runs to hundreds of KB.
MAX_SUBMISSION_BYTES = 2 * 1024 * 1024
MAX_TEXT_ANSWER_CHARS = 50000
MAX_RAW_VALUE_CHARS = 2000
MAX_STR_FIELD_CHARS = 4000
MAX_RESPONDENT_ID_LEN = 128
MAX_EVENTS_PER_ANSWER = 20
MAX_VOICE_TURNS = 200

# Instrument config keys that are answer keys or grading material. The runner
# never reads them, so they're stripped from the public project view —
# otherwise a respondent (or a panel bot) could read the attention check's
# expected option straight out of the network tab.
PUBLIC_HIDDEN_INSTRUMENT_KEYS = {"expected_option", "rubric", "compare_to_block_id"}

# A failed AI grade is cached (shown to the professor as "grading failed") and
# retried at most this often, rather than re-billed on every results view.
METRIC_RETRY_SECONDS = 3600


def _is_faculty(user_id):
    me = User.find_by_id(user_id)
    return bool(me and me.get("role") in FACULTY_ROLES)


def _load_owned_project(project_id, user_id):
    """The project doc if the caller owns it, else (None, (payload, status)).

    Ownership implies faculty: only a faculty account can create a project
    (see create_project), so a valid owner match is sufficient here without
    re-checking role on every read/write.
    """
    db = current_app.config['MONGO_DB']
    try:
        oid = ObjectId(project_id)
    except (InvalidId, Exception):
        return None, ({"message": "Invalid project id"}, 400)
    doc = db['studio_projects'].find_one({"_id": oid})
    if not doc:
        return None, ({"message": "Project not found"}, 404)
    if str(doc.get("user_id", "")) != str(user_id):
        return None, ({"message": "You do not own this project"}, 403)
    return doc, None


def _sanitize_instruments(instruments_in, block_type, page_idx, block_idx):
    """Validate/coerce one block's `instruments` list for a save.

    Raises ValueError with a client-safe message on an unknown instrument
    type or one that can't attach to this block_type. Silently drops a
    duplicate instrument type on the same block (Phase 2 doesn't support
    attaching the same instrument twice) rather than erroring — the builder
    UI doesn't offer a way to do that deliberately, so it can only be a
    stale/racy autosave, not a professor decision worth failing loudly on.
    """
    if not isinstance(instruments_in, list):
        return []

    instruments_out = []
    seen_types = set()
    for inst in instruments_in:
        if not isinstance(inst, dict) or not inst.get("type"):
            continue
        inst_type = inst["type"]
        if inst_type in seen_types:
            continue
        try:
            clean_config = validate_instrument_config(inst_type, block_type, inst.get("config") or {})
        except KeyError:
            raise ValueError(
                f"page {page_idx} block {block_idx}: unknown instrument type '{inst_type}'"
            )
        except ValueError:
            raise ValueError(
                f"page {page_idx} block {block_idx}: instrument '{inst_type}' "
                f"cannot be attached to a '{block_type}' block"
            )
        seen_types.add(inst_type)
        instruments_out.append({
            "id": str(inst.get("id") or uuid.uuid4().hex),
            "type": inst_type,
            "config": clean_config,
        })
    return instruments_out


def _sanitize_pages(pages_in):
    """Validate/coerce a project's pages+blocks for a save.

    Raises ValueError with a client-safe message on anything malformed.
    Every block's config (and each attached instrument's config) is run
    through its registered validator, so a bad builder payload can't persist
    garbage. `order` is re-derived from array position rather than trusted
    from the client, so it can never end up duplicated or gapped.
    """
    if not isinstance(pages_in, list) or not pages_in:
        raise ValueError("pages must be a non-empty list")

    pages_out = []
    for page_idx, page in enumerate(pages_in):
        if not isinstance(page, dict):
            raise ValueError(f"page {page_idx} is not an object")
        blocks_in = page.get("blocks")
        if not isinstance(blocks_in, list):
            raise ValueError(f"page {page_idx} is missing 'blocks'")

        blocks_out = []
        for block_idx, blk in enumerate(blocks_in):
            if not isinstance(blk, dict) or not blk.get("id") or not blk.get("type"):
                raise ValueError(f"page {page_idx} block {block_idx} is missing id/type")
            try:
                clean_config = validate_block_config(blk["type"], blk.get("config") or {})
            except KeyError:
                raise ValueError(
                    f"page {page_idx} block {block_idx}: unknown block type '{blk['type']}'"
                )
            blocks_out.append({
                "id": str(blk["id"]),
                "type": blk["type"],
                "order": block_idx,
                "config": clean_config,
                "instruments": _sanitize_instruments(
                    blk.get("instruments"), blk["type"], page_idx, block_idx
                ),
            })
        link_display_logic(blocks_out)

        pages_out.append({
            "id": str(page.get("id") or uuid.uuid4().hex),
            "title": str(page.get("title") or f"Page {page_idx + 1}"),
            "order": page_idx,
            "blocks": blocks_out,
        })

    return pages_out


MAX_CONDITIONS = 10
MAX_EMBEDDED_KEYS = 20
MAX_EMBEDDED_KEY_LEN = 100
MAX_EMBEDDED_VALUE_LEN = 200


def _sanitize_conditions(conditions_in):
    """Coerce a project's counterbalancing condition names for a save.

    Not a whitelist of anything sensitive — just capped so a professor can't
    accidentally (or a forged request can't deliberately) balloon the list
    that submit_response round-robins over.
    """
    if not isinstance(conditions_in, list):
        return []
    cleaned = [str(c).strip() for c in conditions_in if str(c).strip()]
    return cleaned[:MAX_CONDITIONS]


def _sanitize_embedded_data(embedded_data_in):
    """Coerce the client-supplied embedded-data dict on a public submission.

    This is the one anonymous-write endpoint's one arbitrary-shaped input —
    capped on key count and per-key/value length so it can't be abused as a
    free storage sink. Every value is coerced to a string; Qualtrics-style
    embedded data (URL query params) is string-shaped anyway.
    """
    if not isinstance(embedded_data_in, dict):
        return {}
    out = {}
    for k, v in embedded_data_in.items():
        key = str(k).strip()[:MAX_EMBEDDED_KEY_LEN]
        if not key or len(out) >= MAX_EMBEDDED_KEYS:
            continue
        out[key] = str(v)[:MAX_EMBEDDED_VALUE_LEN]
    return out


def _json_object_body():
    """The request's JSON body as a dict; {} when there is none; None when it
    is valid JSON but not an object (caller returns 400). An array or bare
    string body used to slip past `get_json(...) or {}` and 500 on `.get`."""
    body = request.get_json(silent=True)
    if body is None:
        return {}
    return body if isinstance(body, dict) else None


def _is_num(v):
    """A real, finite number — not a bool (an int subclass), not NaN/inf
    (Python's JSON parser accepts those, and one NaN poisons every average)."""
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _coerce_scale_point(v, top):
    """An integer point on a 1..top scale, else None."""
    if _is_num(v) and v == int(v) and 1 <= v <= top:
        return int(v)
    return None


def _coerce_voice_turns(value):
    """A voice transcript: the fields EVIAudioControls' onTurn emits, typed and
    capped. prosody stays a flat {emotion: score} map — what the vocal-emotion
    and sentiment-drift instruments read."""
    if not isinstance(value, list):
        return None
    turns = []
    for t in value[:MAX_VOICE_TURNS]:
        if not isinstance(t, dict):
            continue
        turn = {
            "role": t["role"][:20] if isinstance(t.get("role"), str) else "",
            "transcript": t["transcript"][:MAX_STR_FIELD_CHARS] if isinstance(t.get("transcript"), str) else "",
        }
        if isinstance(t.get("prosody"), dict):
            turn["prosody"] = {
                str(k)[:40]: v for k, v in list(t["prosody"].items())[:64] if _is_num(v)
            }
        for k in ("turnIndex", "offsetMs"):
            if _is_num(t.get(k)):
                turn[k] = t[k]
        if isinstance(t.get("receivedAt"), str):
            turn["receivedAt"] = t["receivedAt"][:40]
        turns.append(turn)
    return turns or None


def _coerce_answer(block, value):
    """Server-side shape check for one submitted answer against the block it
    answers. Returns the cleaned value, or None to store it as unanswered.

    Coerces rather than rejects: a real respondent's submission is never
    thrown away because one value is off (e.g. an option the professor renamed
    mid-collection). But nothing that couldn't have come from this block's own
    UI is stored, so every downstream reader — live summary, instrument
    metrics, CSV — can trust the shapes it gets.
    """
    if value is None:
        return None
    btype = block.get("type")
    cfg = block.get("config") or {}

    if btype == "yes_no":
        return value if value in ("Yes", "No") else None
    if btype == "single_choice":
        if not isinstance(value, str):
            return None
        if value in (cfg.get("options") or []):
            return value
        # "Other, please specify" — kept only when the block offers it, and
        # only with actual text after the prefix.
        if cfg.get("allow_other") and value.startswith(OTHER_PREFIX) and value[len(OTHER_PREFIX):].strip():
            return value[:MAX_STR_FIELD_CHARS]
        return None
    if btype == "rating_scale":
        return _coerce_scale_point(value, int(cfg.get("scale_max") or 5))
    if btype == "semantic_differential":
        return _coerce_scale_point(value, int(cfg.get("points") or 7))
    if btype in ("short_text", "long_text"):
        if not isinstance(value, str):
            return None
        # min_chars / input_format are runner-side checks only: failing a real
        # response over them would lose it, but a max is a hard storage cap.
        limit = int(cfg.get("max_chars") or 0) or MAX_TEXT_ANSWER_CHARS
        return value[:min(limit, MAX_TEXT_ANSWER_CHARS)]

    if btype == "forced_rank":
        # A complete ordering of exactly this block's options.
        options = cfg.get("options") or []
        if (isinstance(value, list) and len(value) == len(options)
                and all(isinstance(o, str) for o in value) and sorted(value) == sorted(options)):
            return value
        return None

    if btype == "constant_sum":
        # Allocations to known options, non-negative. The total isn't enforced
        # here: the runner doesn't enforce it either, and rejecting would lose
        # an otherwise-real response.
        if not isinstance(value, dict):
            return None
        options = set(cfg.get("options") or [])
        out = {k: v for k, v in value.items() if k in options and _is_num(v) and v >= 0}
        return out or None

    if btype == "card_sort":
        # item -> category; closed sorts must use a listed category, open
        # sorts take free text (capped).
        if not isinstance(value, dict):
            return None
        items = set(cfg.get("items") or [])
        categories = cfg.get("categories") or []
        out = {}
        for item, cat in value.items():
            if item not in items or not isinstance(cat, str) or not cat.strip():
                continue
            if categories and cat not in categories:
                continue
            out[item] = cat[:200]
        return out or None

    if btype == "maxdiff":
        # Rounds of {options shown, most, least}, each drawn from this block's
        # options, most != least, at most num_rounds of them.
        if not isinstance(value, list):
            return None
        options = set(cfg.get("options") or [])
        rounds = []
        for r in value[:50]:
            if not isinstance(r, dict):
                continue
            shown = r.get("options")
            if not isinstance(shown, list) or not shown or not all(isinstance(o, str) and o in options for o in shown):
                continue
            most, least = r.get("most"), r.get("least")
            if not isinstance(most, str) or not isinstance(least, str):
                continue
            if most not in shown or least not in shown or most == least:
                continue
            rounds.append({"options": shown, "most": most, "least": least})
        return rounds[:int(cfg.get("num_rounds") or 10)] or None

    if btype == "voice_conversation":
        return _coerce_voice_turns(value)

    return None  # rich_text / unknown types capture no answer


def _coerce_events(events):
    """Timing events as {type, at} with a finite numeric `at`, capped in count."""
    if not isinstance(events, list):
        return None
    out = [
        {"type": e["type"][:20], "at": e["at"]}
        for e in events[:MAX_EVENTS_PER_ANSWER]
        if isinstance(e, dict) and isinstance(e.get("type"), str) and _is_num(e.get("at"))
    ]
    return out or None


_DROP = object()


def _coerce_scalar(v):
    """A storable scalar (capped string, finite number, bool, None), else _DROP."""
    if v is None or isinstance(v, bool) or _is_num(v):
        return v
    if isinstance(v, str):
        return v[:MAX_STR_FIELD_CHARS]
    return _DROP


def _coerce_instrument_values(values, block):
    """Respondent-side instrument values, keyed only by instruments actually
    attached to this block. Each is a scalar (Confidence Slider's number) or
    a flat object of scalars (Devil's Advocate's {initial_stance, rebuttal,
    post_confidence}) — nothing deeper, strings capped."""
    if not isinstance(values, dict):
        return None
    attached = {i.get("type") for i in (block.get("instruments") or [])}
    out = {}
    for inst_type, v in values.items():
        if inst_type not in attached:
            continue
        if isinstance(v, dict):
            flat = {}
            for k, fv in list(v.items())[:10]:
                cv = _coerce_scalar(fv)
                if cv is not _DROP:
                    flat[str(k)[:40]] = cv
            out[inst_type] = flat
        else:
            cv = _coerce_scalar(v)
            if cv is not _DROP:
                out[inst_type] = cv
    return out or None


def _is_answered(value):
    """Whether a (coerced) value counts as answering a required block. 0 and
    False are answers; blank text and empty lists/objects are not."""
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (list, dict)):
        return bool(value)
    return True


def _raw_value_record(value):
    """A sent value that _coerce_answer couldn't fit to the block, kept as a
    capped JSON string. This happens legitimately when a professor edits a live
    form (renames an option, lowers a scale) while a respondent has the old
    version open; storing it means nothing they answered is lost, and as a
    string it can't break any reader that expects the block's real shape."""
    try:
        text = json.dumps(value, ensure_ascii=False, default=str)
    except (TypeError, ValueError):
        return None
    return text[:MAX_RAW_VALUE_CHARS]


_PLAIN_NUMBER_RE = re.compile(r"^[+-]?(\d+\.?\d*|\.\d+)$")

_CSV_FORMULA_PREFIXES = ("=", "+", "-", "@", "\t", "\r")


def _csv_cell(v):
    """One CSV cell, safe to open in Excel/Sheets. Lists/dicts are written as
    JSON (not Python reprs), and text a spreadsheet would evaluate as a formula
    gets a leading ' — respondents control most of these cells, so
    `=HYPERLINK(...)` would otherwise run on the professor's machine. Real
    numbers are left numeric."""
    if v is None:
        return ""
    if isinstance(v, bool) or _is_num(v):
        return v
    if isinstance(v, (list, dict)):
        v = json.dumps(v, ensure_ascii=False, default=str)
    text = str(v)
    # A plain signed number ("-3", "+852") is data a spreadsheet would read as
    # that number, not a formula — escaping it would break numeric analysis.
    if text.startswith(_CSV_FORMULA_PREFIXES) and not _PLAIN_NUMBER_RE.match(text):
        return "'" + text
    return text


def _csv_answer_value(answer):
    """An answer's export value: the coerced value, else the value_raw it was
    kept as (didn't fit an edited block) — so the professor still sees what
    the respondent actually sent."""
    if answer.get('value') is not None:
        return answer['value']
    return answer.get('value_raw', '')


def _reverse_scorer(block):
    """value -> (top + 1 - value) for a reverse-scored 1..top scale; blank for
    anything that isn't a point on the block's current scale."""
    cfg = block.get('config') or {}
    top = int(cfg.get('scale_max') or 5) if block.get('type') == 'rating_scale' else int(cfg.get('points') or 7)
    return lambda v: (top + 1 - v) if _coerce_scale_point(v, top) is not None else ''


def _option_coder(block):
    """value -> numeric code for a single_choice / yes_no answer: options are
    1..n in list order (an "Other: …" answer is n+1); Yes/No are 1/0 — the
    usual dummy coding, so the column can go straight into a regression."""
    if block.get('type') == 'yes_no':
        return lambda v: {"Yes": 1, "No": 0}.get(v, '')
    options = (block.get('config') or {}).get('options') or []
    codes = {opt: i + 1 for i, opt in enumerate(options)}

    def code(v):
        if v in codes:
            return codes[v]
        if isinstance(v, str) and v.startswith(OTHER_PREFIX):
            return len(options) + 1
        return ''
    return code


def _csv_content_disposition(title):
    """attachment header that survives any project title: an ASCII-only
    `filename` fallback plus an RFC 5987 `filename*` carrying the real
    (possibly Chinese, possibly quoted) title."""
    base = (title or "project").replace(" ", "_")[:80]
    ascii_name = re.sub(r"[^A-Za-z0-9._-]+", "_", base).strip("_") or "project"
    return (
        f'attachment; filename="{ascii_name}_responses.csv"; '
        f"filename*=UTF-8''{quote(base + '_responses.csv')}"
    )


def _serialize(doc):
    """Mongo doc -> JSON-safe dict (ObjectId -> str)."""
    doc = dict(doc)
    doc["_id"] = str(doc["_id"])
    return doc


def _iter_blocks(project):
    """Yield every block across every page, in page/block order."""
    for page in project.get("pages", []):
        for blk in page.get("blocks", []):
            yield blk


def _answerable_blocks(project):
    """Blocks that expect a response — anything whose config carries a `required`
    key. rich_text deliberately omits that key (see its own docstring), so a
    content-only block is skipped here without a per-type special case."""
    return [blk for blk in _iter_blocks(project) if "required" in (blk.get("config") or {})]


def _block_by_id(project):
    """{block_id: block} across every page — for looking up a response
    answer's block (type + attached instruments) by id."""
    return {blk['id']: blk for blk in _iter_blocks(project)}


def _augment_responses_with_metrics(project, responses, db=None):
    """Attach computed instrument metrics to each response's answers, in
    place, as `answer['metrics'] = {instrument_type: {...}}`. A no-op (no
    keys added) for any block/answer that carries no instrument or no
    matching event data.

    Metrics already cached on the stored doc (`answer['metrics']`) are reused
    as-is rather than recomputed. This matters now that some instruments
    (llm_rubric_grader, cross_answer_inconsistency) call Claude — recomputing
    on every results-page view would re-bill the same response every time
    it's viewed. Newly-computed metrics are written back to Mongo when `db`
    is given (owner-only callers pass it; the caching is pointless — and the
    extra write pointless overhead — for any caller that doesn't).

    Known tradeoff: if a professor edits an instrument's config (e.g.
    changes the rubric text) after responses already carry a cached score,
    those responses keep the stale score — there's no cache invalidation
    tied to config changes. Narrow edge case, not worth tracking config
    versions for right now.

    cross_answer_inconsistency is special-cased here (not left to the
    generic per-answer loop) because it's the one instrument whose compute()
    needs another block's answer from the SAME response — every other
    instrument's compute() only ever sees its own block's answer. See that
    instrument's own file for why the sibling data is injected as private
    `_sibling_*` config keys rather than widening compute()'s signature.
    """
    block_by_id = _block_by_id(project)
    now = datetime.now(timezone.utc)
    for r in responses:
        newly_computed = False
        # Non-dict entries can only be legacy/hand-edited data; skip rather
        # than 500 the professor's results page over one bad row.
        answers = [a for a in (r.get('answers') or []) if isinstance(a, dict)]
        answers_by_block = {a.get('block_id'): a for a in answers}
        for a in answers:
            blk = block_by_id.get(a.get('block_id'))
            if not blk or not blk.get('instruments'):
                continue
            existing = a.get('metrics') or {}
            metrics = dict(existing)
            failed_at = dict(a.get('metrics_failed_at') or {})
            for inst in blk['instruments']:
                inst_type = inst['type']
                cached = existing.get(inst_type)
                if cached and not (isinstance(cached, dict) and cached.get('error')
                                   and _metric_retry_due(failed_at.get(inst_type), now)):
                    continue  # cached (a real result, or a recent failure) — reuse, don't re-bill
                inst_config = inst.get('config') or {}
                if inst_type == 'cross_answer_inconsistency':
                    sibling_id = inst_config.get('compare_to_block_id')
                    sibling_answer = answers_by_block.get(sibling_id) or {}
                    sibling_block = block_by_id.get(sibling_id) or {}
                    inst_config = {
                        **inst_config,
                        '_sibling_answer': sibling_answer.get('value'),
                        '_sibling_question': (sibling_block.get('config') or {}).get('question'),
                    }
                m = compute_instrument_metric(inst_type, a, inst_config)
                if m:
                    metrics[inst_type] = m
                    newly_computed = True
                    if m.get('error'):
                        failed_at[inst_type] = now
                    else:
                        failed_at.pop(inst_type, None)
            if metrics:
                a['metrics'] = metrics
            if failed_at:
                a['metrics_failed_at'] = failed_at
            else:
                a.pop('metrics_failed_at', None)
        if newly_computed and db is not None and r.get('_id'):
            try:
                rid = r['_id'] if isinstance(r['_id'], ObjectId) else ObjectId(r['_id'])
                db['studio_responses'].update_one({'_id': rid}, {'$set': {'answers': r['answers']}})
            except Exception:
                logger.warning("Failed to persist computed metrics for response %s", r.get('_id'), exc_info=True)
    return responses


def _metric_retry_due(failed_at, now):
    """Whether a cached failed metric is old enough to retry. Mongo hands
    datetimes back naive (UTC), so normalize before comparing."""
    if not isinstance(failed_at, datetime):
        return True
    if failed_at.tzinfo is None:
        failed_at = failed_at.replace(tzinfo=timezone.utc)
    return (now - failed_at).total_seconds() >= METRIC_RETRY_SECONDS


def _public_project_view(doc):
    """Strip owner-only fields (user_id, status, timestamps) before handing a
    project to an anonymous respondent, plus every instrument config key in
    PUBLIC_HIDDEN_INSTRUMENT_KEYS (answer keys, rubrics). Each attached instrument is enriched
    with `needs_events` so the runner knows whether to record a block's
    shown/submit timestamps — an anonymous respondent has no access to the
    faculty-scoped instrument-specs endpoint, so this has to ride along here.
    """
    pages = []
    for page in doc.get("pages", []):
        blocks = []
        for blk in page.get("blocks", []):
            blk = dict(blk)
            blk["instruments"] = [
                {
                    **inst,
                    "config": {
                        k: v for k, v in (inst.get("config") or {}).items()
                        if k not in PUBLIC_HIDDEN_INSTRUMENT_KEYS
                    },
                    "needs_events": instrument_needs_events(inst["type"]),
                }
                for inst in blk.get("instruments", [])
            ]
            blocks.append(blk)
        pages.append({**page, "blocks": blocks})

    return {
        "_id": str(doc["_id"]),
        "title": doc.get("title", ""),
        "description": doc.get("description", ""),
        "pages": pages,
    }


def _client_ip():
    """The caller's address as ProxyFix (app.py) resolved it from the trusted
    proxy hop. Never read X-Forwarded-For directly: nginx appends to whatever
    the client sent, so its FIRST entry is attacker-chosen — trusting it let
    one script mint a fresh rate-limit bucket per request."""
    return request.remote_addr or 'unknown'


def _rate_limit_collection(db):
    global _rate_limit_index_ensured
    col = db['studio_rate_limits']
    if not _rate_limit_index_ensured:
        col.create_index('expires_at', expireAfterSeconds=0)
        _rate_limit_index_ensured = True
    return col


def _bump_counter(db, scope, ident, window_seconds, limit):
    """Count one hit for (scope, ident) in the current fixed window; True while
    the count is still within `limit`.

    One atomic upsert-$inc, so a concurrent burst can't all read "under the
    limit" before any of them writes (the old count-then-insert could). The
    identity is hashed — an abuse guard, never stored as PII, and kept apart
    from response documents. The window number is part of the key, so a doc
    that has expired but not yet been reaped (Mongo's TTL monitor sweeps about
    once a minute) can never block the next window.
    """
    col = _rate_limit_collection(db)
    now = datetime.now(timezone.utc)
    window = int(now.timestamp() // window_seconds)
    key = hashlib.sha256(f"{scope}:{ident}:{window_seconds}:{window}".encode()).hexdigest()
    expires_at = datetime.fromtimestamp((window + 1) * window_seconds, timezone.utc)
    for _ in range(2):
        try:
            doc = col.find_one_and_update(
                {"_id": key},
                {"$inc": {"n": 1}, "$setOnInsert": {"expires_at": expires_at}},
                upsert=True,
                return_document=ReturnDocument.AFTER,
            )
            return doc["n"] <= limit
        except DuplicateKeyError:
            continue  # two first hits raced on the upsert; the retry $incs the winner's doc
    return False


def _submission_allowed(db, project_id, respondent_id, client_supplied_id):
    """Per-IP ceiling, then the per-respondent cooldown (only when the runner
    sent its stable id — a server-minted anon id is fresh every time). IP goes
    first so a refusal there can't also burn the respondent's cooldown."""
    if not _bump_counter(db, "submit-ip", f"{project_id}:{_client_ip()}", 3600, SUBMITS_PER_IP_PER_HOUR):
        return False
    return not client_supplied_id or _bump_counter(
        db, "submit-respondent", f"{project_id}:{respondent_id}",
        STUDIO_RESPONSE_COOLDOWN_SECONDS, 1,
    )


def _ai_call_allowed(db, project_id):
    """Per-(project, IP) hourly ceiling, then the per-project daily spend cap."""
    return (
        _bump_counter(db, "ai-ip", f"{project_id}:{_client_ip()}", 3600, AI_CALLS_PER_IP_PER_HOUR)
        and _bump_counter(db, "ai-project", project_id, 86400, AI_CALLS_PER_PROJECT_PER_DAY)
    )


def _assign_condition(db, project_oid, conditions):
    """Round-robin assign one respondent to a counterbalancing condition.

    Assigned at submit time (not page-load) via an atomic `$inc` on the
    project doc's `condition_cursor` — deliberately not respondent-keyed,
    since there's no conditional-rendering engine yet for a pre-assigned
    condition to change what a respondent sees before they submit. Returns
    None if the project defines no conditions.
    """
    if not conditions:
        return None
    result = db['studio_projects'].find_one_and_update(
        {"_id": project_oid},
        {"$inc": {"condition_cursor": 1}},
        return_document=ReturnDocument.AFTER,
    )
    cursor = (result or {}).get("condition_cursor", 1) - 1
    return conditions[cursor % len(conditions)]


@studio_bp.route('/studio/block-specs', methods=['GET'])
@jwt_required()
def block_specs():
    user_id = get_jwt_identity()
    if not _is_faculty(user_id):
        return jsonify({"message": "Only faculty accounts can access Studio"}), 403
    return jsonify({"blocks": get_block_specs()}), 200


@studio_bp.route('/studio/instrument-specs', methods=['GET'])
@jwt_required()
def instrument_specs():
    user_id = get_jwt_identity()
    if not _is_faculty(user_id):
        return jsonify({"message": "Only faculty accounts can access Studio"}), 403
    return jsonify({"instruments": get_instrument_specs()}), 200


@studio_bp.route('/studio/projects', methods=['POST'])
@jwt_required()
def create_project():
    user_id = get_jwt_identity()
    if not _is_faculty(user_id):
        return jsonify({"message": "Only faculty accounts can create Studio projects"}), 403

    body = _json_object_body()
    if body is None:
        return jsonify({"message": "Request body must be a JSON object"}), 400
    title = (body.get('title') or '').strip() or "Untitled Project"
    now = datetime.now(timezone.utc)

    doc = {
        "user_id": user_id,
        "title": title,
        "description": "",
        "status": "draft",
        "pages": [
            {"id": uuid.uuid4().hex, "title": "Page 1", "order": 0, "blocks": []}
        ],
        "conditions": [],
        "condition_cursor": 0,
        "created_at": now,
        "updated_at": now,
    }
    db = current_app.config['MONGO_DB']
    result = db['studio_projects'].insert_one(doc)
    doc["_id"] = result.inserted_id
    return jsonify(_serialize(doc)), 201


@studio_bp.route('/studio/projects', methods=['GET'])
@jwt_required()
def list_projects():
    user_id = get_jwt_identity()
    db = current_app.config['MONGO_DB']
    cursor = db['studio_projects'].find(
        {"user_id": user_id},
        {"title": 1, "status": 1, "updated_at": 1, "created_at": 1},
    ).sort("updated_at", -1)
    return jsonify({"projects": [_serialize(d) for d in cursor]}), 200


@studio_bp.route('/studio/projects/<project_id>', methods=['GET'])
@jwt_required()
def get_project(project_id):
    user_id = get_jwt_identity()
    doc, error = _load_owned_project(project_id, user_id)
    if error:
        payload, status = error
        return jsonify(payload), status
    return jsonify(_serialize(doc)), 200


@studio_bp.route('/studio/projects/<project_id>', methods=['PUT'])
@jwt_required()
def save_project(project_id):
    user_id = get_jwt_identity()
    doc, error = _load_owned_project(project_id, user_id)
    if error:
        payload, status = error
        return jsonify(payload), status

    body = _json_object_body()
    if body is None:
        return jsonify({"message": "Request body must be a JSON object"}), 400
    updates = {"updated_at": datetime.now(timezone.utc)}

    if 'title' in body:
        updates['title'] = str(body.get('title') or '').strip() or "Untitled Project"
    if 'description' in body:
        updates['description'] = str(body.get('description') or '')
    if 'status' in body and body['status'] in ('draft', 'published', 'archived'):
        updates['status'] = body['status']
    if 'pages' in body:
        try:
            updates['pages'] = _sanitize_pages(body['pages'])
        except ValueError as e:
            return jsonify({"message": str(e)}), 400
    if 'conditions' in body:
        updates['conditions'] = _sanitize_conditions(body['conditions'])

    db = current_app.config['MONGO_DB']
    db['studio_projects'].update_one({"_id": doc["_id"]}, {"$set": updates})
    doc.update(updates)
    return jsonify(_serialize(doc)), 200


@studio_bp.route('/studio/projects/<project_id>', methods=['DELETE'])
@jwt_required()
def delete_project(project_id):
    user_id = get_jwt_identity()
    doc, error = _load_owned_project(project_id, user_id)
    if error:
        payload, status = error
        return jsonify(payload), status

    db = current_app.config['MONGO_DB']
    db['studio_projects'].delete_one({"_id": doc["_id"]})
    # Responses go with their project: once it's gone nothing can reach them,
    # and they can carry respondent PII (embedded_data from URL params).
    removed = db['studio_responses'].delete_many({"project_id": str(doc["_id"])})
    return jsonify({"deleted": True, "responses_deleted": removed.deleted_count}), 200


# ---------------------------------------------------------------------------
# Public (anonymous) — a published project's respondent-facing surface
# ---------------------------------------------------------------------------

@studio_bp.route('/studio/public/projects/<project_id>', methods=['GET'])
def public_get_project(project_id):
    db = current_app.config['MONGO_DB']
    try:
        oid = ObjectId(project_id)
    except (InvalidId, Exception):
        return jsonify({"message": "Invalid project id"}), 400
    doc = db['studio_projects'].find_one({"_id": oid, "status": "published"})
    if not doc:
        return jsonify({"message": "Project not found"}), 404
    return jsonify(_public_project_view(doc)), 200


@studio_bp.route('/studio/public/projects/<project_id>/responses', methods=['POST'])
def submit_response(project_id):
    db = current_app.config['MONGO_DB']
    try:
        oid = ObjectId(project_id)
    except (InvalidId, Exception):
        return jsonify({"message": "Invalid project id"}), 400
    project = db['studio_projects'].find_one({"_id": oid, "status": "published"})
    if not project:
        return jsonify({"message": "Project not found"}), 404

    if (request.content_length or 0) > MAX_SUBMISSION_BYTES:
        return jsonify({"message": "Submission is too large"}), 413
    body = _json_object_body()
    if body is None:
        return jsonify({"message": "Request body must be a JSON object"}), 400
    answers_in = body.get('answers')
    if not isinstance(answers_in, list):
        return jsonify({"message": "answers must be a list"}), 400

    # Only answers to blocks that exist in this project, first one per block,
    # each coerced to its block's shape — see _coerce_answer.
    block_by_id = _block_by_id(project)
    answers_out = []
    answers_by_id = {}
    for a in answers_in:
        if not isinstance(a, dict):
            continue
        bid = str(a.get('block_id') or '')
        blk = block_by_id.get(bid)
        if not blk or bid in answers_by_id:
            continue
        sent = a.get('value')
        value = _coerce_answer(blk, sent)
        entry = {"block_id": bid, "value": value}
        if value is None and _is_answered(sent):
            # Sent, but doesn't fit the block's CURRENT config — kept, and the
            # block counts as answered (see _raw_value_record).
            raw = _raw_value_record(sent)
            if raw:
                entry["value_raw"] = raw
        answers_by_id[bid] = value if value is not None else entry.get("value_raw")
        events = _coerce_events(a.get('events'))
        if events:
            entry["events"] = events
        instrument_values = _coerce_instrument_values(a.get('instrument_values'), blk)
        if instrument_values:
            entry["instrument_values"] = instrument_values
        answers_out.append(entry)

    # Display logic: a block the respondent was never shown can't be missing,
    # and an answer to it (a stale client, or a hand-built request) is dropped
    # so the data never claims someone answered a question they didn't see.
    visible = visible_block_ids(_iter_blocks(project), answers_by_id)
    answers_out = [a for a in answers_out if a["block_id"] in visible]

    missing = [
        blk['id'] for blk in _answerable_blocks(project)
        if blk.get('config', {}).get('required')
        and blk['id'] in visible
        and not _is_answered(answers_by_id.get(blk['id']))
    ]
    if missing:
        return jsonify({"message": "Missing required answers", "block_ids": missing}), 400

    raw_respondent_id = body.get('respondent_id')
    client_supplied_id = isinstance(raw_respondent_id, str) and bool(raw_respondent_id.strip())
    respondent_id = (
        raw_respondent_id.strip()[:MAX_RESPONDENT_ID_LEN] if client_supplied_id
        else f"anon_{uuid.uuid4().hex}"
    )

    # Charged only now, after validation — a respondent who gets a 400 for a
    # missing answer can fix it and resubmit straight away.
    if not _submission_allowed(db, project_id, respondent_id, client_supplied_id):
        return jsonify({"message": "Please wait before submitting again."}), 429

    now = datetime.now(timezone.utc)
    response_doc = {
        "project_id": project_id,
        "respondent_id": respondent_id,
        "started_at": now,
        "submitted_at": now,
        "answers": answers_out,
    }

    embedded_data = _sanitize_embedded_data(body.get('embedded_data'))
    if embedded_data:
        response_doc["embedded_data"] = embedded_data

    condition = _assign_condition(db, oid, project.get('conditions') or [])
    if condition is not None:
        response_doc["condition"] = condition

    db['studio_responses'].insert_one(response_doc)
    return jsonify({"submitted": True}), 201


@studio_bp.route('/studio/public/projects/<project_id>/ai-instrument', methods=['POST'])
def ai_instrument_call(project_id):
    """Live, mid-session Claude call for a Tier-3 instrument (Comprehension-
    Paraphrase Check, AI Devil's-Advocate, Adaptive Follow-Up Probe) attached
    to a block the respondent is currently answering.

    This is the one endpoint in Studio that spends real API money on
    anonymous, unauthenticated traffic — see _ai_call_allowed for the
    per-IP and per-project ceilings that exist specifically because of that.
    Input length is capped in src/studio/live_ai.py.
    """
    db = current_app.config['MONGO_DB']
    try:
        oid = ObjectId(project_id)
    except (InvalidId, Exception):
        return jsonify({"message": "Invalid project id"}), 400
    project = db['studio_projects'].find_one({"_id": oid, "status": "published"})
    if not project:
        return jsonify({"message": "Project not found"}), 404

    body = _json_object_body()
    if body is None:
        return jsonify({"message": "Request body must be a JSON object"}), 400
    instrument_type = str(body.get('instrument_type') or '')
    block_id = str(body.get('block_id') or '')

    block = _block_by_id(project).get(block_id)
    if not block:
        return jsonify({"message": "Unknown block"}), 400
    if not any(i.get('type') == instrument_type for i in (block.get('instruments') or [])):
        return jsonify({"message": "Instrument is not attached to this block"}), 400

    if not has_live_ai_input(instrument_type, body.get('input')):
        return jsonify({"message": "Nothing to send yet."}), 400

    # Charged after the cheap checks, so a malformed call can't burn a slot.
    if not _ai_call_allowed(db, project_id):
        return jsonify({"message": "Please slow down and try again in a few minutes."}), 429

    result = call_live_ai_instrument(instrument_type, block, body.get('input'))
    if result is None:
        return jsonify({"message": "AI is unavailable right now — please try again shortly."}), 502
    return jsonify({"result": result}), 200


# ---------------------------------------------------------------------------
# Owner-only — reading back what came in
# ---------------------------------------------------------------------------

@studio_bp.route('/studio/projects/<project_id>/responses', methods=['GET'])
@jwt_required()
def list_responses(project_id):
    user_id = get_jwt_identity()
    doc, error = _load_owned_project(project_id, user_id)
    if error:
        payload, status = error
        return jsonify(payload), status

    db = current_app.config['MONGO_DB']
    cursor = db['studio_responses'].find({"project_id": project_id}).sort("submitted_at", -1)
    responses = []
    for r in cursor:
        r['_id'] = str(r['_id'])
        responses.append(r)
    _augment_responses_with_metrics(doc, responses, db=db)
    return jsonify({"responses": responses}), 200


@studio_bp.route('/studio/projects/<project_id>/live-summary', methods=['GET'])
@jwt_required()
def live_summary(project_id):
    """Data source for the Present view — polled every few seconds while a
    professor has it open on a projector. See src/studio/summary.py for what
    is (and deliberately isn't) aggregated here.

    Optional `?filter_block_id=<id>&filter_value=<json>` cross-filters: only
    responses whose answer to `filter_block_id` equals `filter_value` (JSON-
    decoded, so a rating's int and a choice's string both round-trip
    correctly) are aggregated. Filtering happens here, on the raw response
    list, before it ever reaches build_live_summary — every aggregation
    function in summary.py is unchanged, it just sees fewer responses.
    """
    user_id = get_jwt_identity()
    doc, error = _load_owned_project(project_id, user_id)
    if error:
        payload, status = error
        return jsonify(payload), status

    db = current_app.config['MONGO_DB']
    responses = list(db['studio_responses'].find({"project_id": project_id}))

    filter_block_id = request.args.get('filter_block_id')
    filter_value_raw = request.args.get('filter_value')
    if filter_block_id and filter_value_raw is not None:
        try:
            filter_value = json.loads(filter_value_raw)
        except (TypeError, ValueError):
            filter_value = filter_value_raw
        responses = [
            r for r in responses
            if any(
                isinstance(a, dict)
                and a.get('block_id') == filter_block_id and _matches_filter(a.get('value'), filter_value)
                for a in (r.get('answers') or [])
            )
        ]

    return jsonify(build_live_summary(doc, responses)), 200


def _matches_filter(value, filter_value):
    """A Present-view bar click matches its answers — including the collapsed
    "Other" bar, which stands for every "Other: …" answer (see summary.py)."""
    if value == filter_value:
        return True
    return filter_value == OTHER_OPTION and isinstance(value, str) and value.startswith(OTHER_PREFIX)


@studio_bp.route('/studio/projects/<project_id>/responses.csv', methods=['GET'])
@jwt_required()
def export_responses_csv(project_id):
    user_id = get_jwt_identity()
    doc, error = _load_owned_project(project_id, user_id)
    if error:
        payload, status = error
        return jsonify(payload), status

    db = current_app.config['MONGO_DB']
    # (block_id, column header). The professor's variable name if they set
    # one (unique per project — see link_display_logic), else the question as
    # plain text. Two blocks with identical question text produce duplicate
    # headers — acceptable; column order still disambiguates them.
    answerable = _answerable_blocks(doc)
    columns = [
        (blk['id'], blk.get('config', {}).get('variable_name')
         or plain_text(blk.get('config', {}).get('question')) or blk['id'])
        for blk in answerable
    ]
    # Derived columns, each written right after its source question's column:
    # `_r` = reverse-scored scale value, `_code` = 1-based option code.
    derived_by_block = {}
    for (bid, label), blk in zip(columns, answerable):
        cfg = blk.get('config') or {}
        derived = []
        if cfg.get('reverse_scored'):
            derived.append((f"{label}_r", _reverse_scorer(blk)))
        if cfg.get('export_codes'):
            derived.append((f"{label}_code", _option_coder(blk)))
        derived_by_block[bid] = derived

    responses = list(db['studio_responses'].find({"project_id": project_id}).sort("submitted_at", 1))
    _augment_responses_with_metrics(doc, responses, db=db)

    # Metric columns are discovered from the actual computed data rather than
    # statically from the instrument spec, since a compute()'s return shape
    # isn't declared anywhere — this stays correct for any future instrument
    # without export code changes. (block_id, instrument_type, metric_key) -> header.
    question_by_block = {bid: label for bid, label in columns}
    metric_columns = []
    seen_metric_keys = set()
    for r in responses:
        for a in r.get('answers') or []:
            if not isinstance(a, dict) or not isinstance(a.get('metrics'), dict):
                continue
            for inst_type, metrics in a['metrics'].items():
                if not isinstance(metrics, dict):
                    continue
                for mk in metrics:
                    key = (a.get('block_id'), inst_type, mk)
                    if key in seen_metric_keys:
                        continue
                    seen_metric_keys.add(key)
                    question = question_by_block.get(a.get('block_id'), a.get('block_id'))
                    metric_columns.append((key, f"{question} — {inst_type}:{mk}"))

    # Embedded-data keys, same "discover from actual data" approach as metric
    # columns — a project's respondents may pass different URL params over
    # time, and there's no schema declaring them up front.
    embedded_keys = []
    seen_embedded_keys = set()
    for r in responses:
        for k in (r.get('embedded_data') or {}):
            if k not in seen_embedded_keys:
                seen_embedded_keys.add(k)
                embedded_keys.append(k)

    has_condition = any(r.get('condition') for r in responses)

    output = io.StringIO()
    writer = csv.writer(output)
    # Every header and cell goes through _csv_cell: headers include
    # respondent-supplied embedded_data keys, cells include free-text answers.
    writer.writerow([_csv_cell(h) for h in (
        ["respondent_id", "submitted_at"]
        + (["condition"] if has_condition else [])
        + [h for bid, label in columns for h in [label] + [d for d, _ in derived_by_block[bid]]]
        + [label for _, label in metric_columns]
        + [f"embedded:{k}" for k in embedded_keys]
    )])

    for r in responses:
        answers_by_id = {a.get('block_id'): a for a in (r.get('answers') or []) if isinstance(a, dict)}
        row = [r.get('respondent_id', ''), r.get('submitted_at', '')]
        if has_condition:
            row.append(r.get('condition', ''))
        for bid, _ in columns:
            answer = answers_by_id.get(bid) or {}
            row.append(_csv_answer_value(answer))
            row += [fn(answer.get('value')) for _, fn in derived_by_block[bid]]
        for (bid, inst_type, mk), _label in metric_columns:
            a = answers_by_id.get(bid) or {}
            inst_metrics = (a.get('metrics') or {}).get(inst_type) if isinstance(a.get('metrics'), dict) else None
            row.append(inst_metrics.get(mk, '') if isinstance(inst_metrics, dict) else '')
        row += [(r.get('embedded_data') or {}).get(k, '') for k in embedded_keys]
        writer.writerow([_csv_cell(c) for c in row])

    return Response(
        output.getvalue(),
        mimetype='text/csv',
        headers={"Content-Disposition": _csv_content_disposition(doc.get('title'))},
    )
