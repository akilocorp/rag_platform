# @language  Python
# @updated   2026-07-31
# @changed   GET /config/<id> now returns an `owned` flag (best-effort JWT read on public configs) so the client can surface owner-only controls like the manager-exercise lobby reset.
#            Prior: M8 grading_rubric; M7 exactly-3 candidates; M5 choose_minutes + final_call_seconds.
from flask import Flask, Blueprint, request, jsonify, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity, verify_jwt_in_request, unset_jwt_cookies
import urllib.parse
import requests
import logging
import os
from werkzeug.utils import secure_filename
from src.utils.vector_stores.store_vector_stores import process_files_and_create_vector_store
from models.config import Config
from models.case_preset import CasePreset
from models.user import User
from src.usage import limits as usage_limits
from src.facilitator.config import normalize_config as normalize_facilitator
from src.managers import case_pack
from src.managers import class_presets
from src.managers import facilitator_prompt

import re
import json
from bson import ObjectId

# --- Setup and Configuration ---
logger = logging.getLogger(__name__)
UPLOAD_FOLDER = "uploads/"
ALLOWED_EXTENSIONS = {'txt', 'pdf', 'md', 'docx', 'pptx'}

config_bp = Blueprint('config_routes', __name__)

def allowed_file(filename):
    """Checks if the uploaded file has an allowed extension."""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


def validate_class_usage(source, target, current_config_id=None):
    """Validates a class rollout's code + usage tier and writes class_code,
    usage_tier, student_count, usage_pool into `target`.

    `source` is the incoming data (dict for create, request.form for edit).
    Returns an error (response, status) tuple on failure, or None on success.
    No class_code → nothing written (not a class bot).
    """
    raw_code = (source.get('class_code') or '').strip().lower()
    if not raw_code:
        return None
    if not re.match(r'^[a-z0-9][a-z0-9\-]{1,18}[a-z0-9]$', raw_code):
        return jsonify({"error": "Class code must be 3–20 characters (letters, numbers, hyphens)."}), 400
    existing = Config.get_collection().find_one({"class_code": raw_code})
    if existing and (current_config_id is None or str(existing['_id']) != str(current_config_id)):
        return jsonify({"error": "Class code already taken. Choose a different one."}), 409
    target['class_code'] = raw_code

    tier_id = (source.get('usage_tier') or '').strip()
    student_count = source.get('student_count')
    if tier_id and student_count not in (None, ''):
        try:
            student_count = int(student_count)
            if student_count < 1:
                raise ValueError
        except (ValueError, TypeError):
            return jsonify({"error": "Number of students must be a positive integer"}), 400
        tier = next((t for t in usage_limits.get_settings().get('tiers', [])
                     if t.get('id') == tier_id), None)
        if not tier:
            return jsonify({"error": "Unknown usage tier"}), 400
        target['usage_tier'] = tier_id
        target['student_count'] = student_count
        target['usage_pool'] = int(tier['messages_per_student']) * student_count
    return None

# --- Manager Exercise ---------------------------------------------------------
# Minimum group size. The exercise is a hidden-profile debrief: the whole lesson
# is that information was distributed and never pooled, which needs at least two
# people holding different packets.
ME_MIN_STUDENTS = 2

# Breakout rooms the class splits into. The professor hands out one class code and
# students choose a room from a lobby, so the cap is just "more than any class
# would plausibly need".
ME_DEFAULT_ROOMS = 5
ME_MAX_ROOMS = 20


def _me_doc_ref(raw, field):
    """Normalize an AI-only reference document to {file_id, text}.

    `text` is authoritative (it is what the case-pack extractor and the
    facilitator actually read); `file_id` is a bookkeeping pointer to the upload.
    """
    val = raw.get(field)
    if not isinstance(val, dict):
        return {"file_id": "", "text": ""}
    file_id = val.get("file_id")
    text = val.get("text")
    return {
        "file_id": file_id.strip() if isinstance(file_id, str) else "",
        "text": text if isinstance(text, str) else "",
    }


def validate_manager_exercise(source, target):
    """Validate + normalize the `manager_exercise` sub-object, derive the case pack,
    and force the top-level `group_size == num_students` invariant.

    Mirrors how scoring_spec / experiential_config / facilitator are handled: the
    value may arrive as a dict or a JSON string. On success, writes the normalized
    sub-object into `target['manager_exercise']` and overwrites
    `target['group_size']`. Returns an error (response, status) tuple on failure,
    or None on success.

    Rules enforced here:
      - manager_exercise required and must be a dict.
      - num_students int >= ME_MIN_STUDENTS; discuss_minutes > 0.
      - candidates non-empty with unique names, each carrying its outcome doc.
      - learning_points resolved server-side from class_preset (never trusted
        from the client, so every config on a preset gets identical wording).
      - case_pack derived from the uploaded docs unless the client supplied an
        edited one; either way the tallies are recomputed in Python.

    A config cannot be saved without a usable case pack: the pack carries the
    answer key the facilitator steers by, and an exercise with an empty one would
    silently run without any pedagogy.
    """
    raw = source.get('manager_exercise')
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (ValueError, TypeError):
            raw = None
    if not isinstance(raw, dict):
        return jsonify({"error": "manager_exercise config is required for this bot type"}), 400

    # num_students is the CAPACITY of one breakout room, not a gate. A group may
    # start under-filled; the facilitator is told the real headcount at that point.
    try:
        num_students = int(raw.get('num_students'))
    except (ValueError, TypeError):
        return jsonify({"error": "manager_exercise.num_students must be an integer"}), 400
    if num_students < ME_MIN_STUDENTS:
        return jsonify({"error": f"manager_exercise.num_students must be >= {ME_MIN_STUDENTS}"}), 400

    # How many breakout rooms the class is split into. Students pick one from a
    # lobby rather than being queued into whichever fills first.
    try:
        num_rooms = int(raw.get('num_rooms', ME_DEFAULT_ROOMS))
    except (ValueError, TypeError):
        return jsonify({"error": "manager_exercise.num_rooms must be an integer"}), 400
    if not 1 <= num_rooms <= ME_MAX_ROOMS:
        return jsonify({"error": f"manager_exercise.num_rooms must be between 1 and {ME_MAX_ROOMS}"}), 400

    # Discuss window (minutes).
    try:
        discuss_minutes = float(raw.get('discuss_minutes'))
    except (ValueError, TypeError):
        return jsonify({"error": "manager_exercise.discuss_minutes must be a number"}), 400
    if discuss_minutes <= 0:
        return jsonify({"error": "manager_exercise.discuss_minutes must be > 0"}), 400

    # M5: the in-app decision (`choose`) is now timed. `choose_minutes` is the main
    # ballot window; `final_call_seconds` is the tight anxiety window after it lapses.
    # Both optional with safe defaults so existing configs keep working.
    try:
        choose_minutes = float(raw.get('choose_minutes', 3))
    except (ValueError, TypeError):
        return jsonify({"error": "manager_exercise.choose_minutes must be a number"}), 400
    if choose_minutes <= 0:
        choose_minutes = 3.0
    try:
        final_call_seconds = int(raw.get('final_call_seconds', 30))
    except (ValueError, TypeError):
        final_call_seconds = 30
    if final_call_seconds <= 0:
        final_call_seconds = 30

    # Candidate roster — each entry carries the outcome document revealed on pick.
    raw_candidates = raw.get('candidates')
    if not isinstance(raw_candidates, list) or not raw_candidates:
        return jsonify({"error": "manager_exercise.candidates must be a non-empty list"}), 400
    candidates = []
    seen_names = set()
    for c in raw_candidates:
        if not isinstance(c, dict):
            return jsonify({"error": "each candidate must be an object with a name"}), 400
        name = (c.get('name') or '').strip()
        if not name:
            return jsonify({"error": "each candidate must have a non-empty name"}), 400
        if name in seen_names:
            return jsonify({"error": f"duplicate candidate name '{name}'"}), 400
        seen_names.add(name)
        forecast_text = c.get('forecast_text')
        forecast_file_id = c.get('forecast_file_id')
        if not isinstance(forecast_text, str) or not forecast_text.strip():
            return jsonify({"error": f"candidate '{name}' needs an uploaded outcome document"}), 400
        candidates.append({
            "name": name,
            "forecast_text": forecast_text,
            "forecast_file_id": forecast_file_id.strip() if isinstance(forecast_file_id, str) else "",
        })

    # M7: the two-strike flow needs EXACTLY 3 candidates — two wrong group picks,
    # then the third (un-chosen) candidate is the answer that gets revealed.
    if len(candidates) != 3:
        return jsonify({"error": "manager_exercise requires exactly 3 candidates (two guesses, then the third is revealed)"}), 400

    # AI-only reference documents. Never sent to a student client — the candidate
    # summary states each role's private view and (in most authored cases) the
    # pooled totals, i.e. the answer key in plain text.
    #
    # general_info does a different job from the summary: it is what the ROLE
    # requires, which is what a candidate's pooled picture gets tested against.
    # Without it the exercise degenerates into counting items, so it is required.
    # Students already hold it on paper.
    general_info = _me_doc_ref(raw, 'general_info')
    candidate_summary = _me_doc_ref(raw, 'candidate_summary')
    if not candidate_summary["text"].strip():
        return jsonify({"error": "manager_exercise.candidate_summary is required (upload the Candidate Summary document)"}), 400
    # Required, because without it the facilitator has nothing to test a candidate
    # against and the session collapses into counting items.
    if not general_info["text"].strip():
        return jsonify({"error": "manager_exercise.general_info is required (upload the General Information document)"}), 400

    class_preset = (raw.get('class_preset') or '').strip()
    learning_outcome = raw.get('learning_outcome')
    learning_outcome = learning_outcome.strip() if isinstance(learning_outcome, str) else ""

    # Optional full replacement of the facilitator's system prompt, edited by the
    # professor in the wizard's advanced block. Blank means "use the stock prompt",
    # so an untouched config is byte-identical to before. Only <<CASE_PACK>> is
    # mandatory — losing it would leave the facilitator inventing the case.
    prompt_override = raw.get('facilitator_prompt_override')
    prompt_override = prompt_override.strip() if isinstance(prompt_override, str) else ""
    override_err = facilitator_prompt.validate_prompt_override(prompt_override)
    if override_err:
        return jsonify({"error": override_err}), 400

    # M8: optional faculty rubric that steers the end-of-session communication grade.
    # Blank means the grader uses its built-in default rubric.
    grading_rubric = raw.get('grading_rubric')
    grading_rubric = grading_rubric.strip() if isinstance(grading_rubric, str) else ""

    # Case pack: reuse a professor-reviewed pack if the client round-tripped one,
    # otherwise extract it from the uploaded documents. Tallies are recomputed
    # either way so a hand-edited pack can never disagree with its own items.
    supplied = raw.get('case_pack')
    if isinstance(supplied, dict) and supplied.get('options'):
        pack = case_pack.recompute(supplied)
    else:
        pack, err = case_pack.build_case_pack(
            general_info["text"], candidate_summary["text"], candidates,
        )
        if err:
            return jsonify({"error": err}), 400

    target['manager_exercise'] = {
        "num_students": num_students,
        "num_rooms": num_rooms,
        "discuss_minutes": discuss_minutes,
        "choose_minutes": choose_minutes,
        "final_call_seconds": final_call_seconds,
        "class_preset": class_preset,
        "learning_outcome": learning_outcome,
        "learning_points": class_presets.get_learning_points(class_preset),
        "facilitator_prompt_override": prompt_override,
        "grading_rubric": grading_rubric,
        "general_info": general_info,
        "candidate_summary": candidate_summary,
        "candidates": candidates,
        "case_pack": pack,
    }
    # Invariant: top-level group_size is force-set to num_students (ignore any
    # mismatching client value).
    target['group_size'] = num_students
    return None


@config_bp.route('/config/facilitator-prompt/default', methods=['GET'])
@jwt_required()
def facilitator_prompt_default():
    """Serve the stock facilitator prompt so the wizard can prefill its editor.

    Fetched on demand rather than bundled into the frontend or stored on every
    config: it is ~12 KB of pedagogy that most professors will never touch, and
    keeping one copy server-side means an edit here reaches every config that
    has not overridden it.
    """
    return jsonify({
        "prompt": facilitator_prompt.FACILITATOR_PROMPT,
        "required_placeholder": facilitator_prompt.REQUIRED_PLACEHOLDER,
    }), 200


@config_bp.route('/config/case-pack/preview', methods=['POST'])
@jwt_required()
def preview_case_pack():
    """Build a case pack from uploaded documents WITHOUT saving a config.

    The authoring wizard's review step needs the extracted tallies and answer key
    before the config exists, so the professor can correct a bad extraction rather
    than discover it mid-class. Same code path as save, so what they approve here
    is exactly what gets stored.
    """
    data = request.get_json(silent=True) or {}
    pack, err = case_pack.build_case_pack(
        data.get('general_info_text') or '',
        data.get('candidate_summary_text') or '',
        data.get('candidates') or [],
    )
    if err:
        return jsonify({"error": err}), 400
    return jsonify({"case_pack": pack}), 200


def _preset_summary(doc, user_id=None):
    """List-view shape: enough to choose between cases, without the document text.

    The full candidate summary and every outcome document run to tens of
    kilobytes each; someone picking from a list needs the name, the candidates
    and the tally, so that is all that ships. `owned` tells the UI whether to
    offer the visibility toggle and delete.
    """
    pack = doc.get("case_pack") or {}
    return {
        "preset_id": str(doc.get("_id")),
        "name": doc.get("name") or "Untitled case",
        "case_name": pack.get("case_name") or "",
        "visibility": CasePreset.normalize_visibility(doc.get("visibility"), default="private"),
        "owned": bool(user_id) and doc.get("user_id") == user_id,
        "candidates": [c.get("name", "") for c in (doc.get("candidates") or [])],
        "tally": [
            {
                "name": o.get("name", ""),
                "strengths": o.get("distinct_strengths", 0),
                "concerns": o.get("distinct_concerns", 0),
            }
            for o in (pack.get("options") or [])
        ],
        "updated_at": (doc.get("updated_at").isoformat() if doc.get("updated_at") else None),
    }


@config_bp.route('/case-presets', methods=['GET'])
@jwt_required()
def list_case_presets():
    """Cases this user may build from — every public one plus their own private ones."""
    user_id = get_jwt_identity()
    presets = [_preset_summary(d, user_id) for d in CasePreset.find_readable(user_id)]
    return jsonify({"presets": presets}), 200


@config_bp.route('/case-presets/<preset_id>', methods=['GET'])
@jwt_required()
def get_case_preset(preset_id):
    """The full case — documents and reviewed case pack — to load into a new class."""
    user_id = get_jwt_identity()
    doc = CasePreset.find_one_readable(preset_id, user_id)
    if not doc:
        return jsonify({"error": "Case not found"}), 404
    doc["preset_id"] = str(doc.pop("_id"))
    doc["owned"] = doc.pop("user_id", None) == user_id
    doc["visibility"] = CasePreset.normalize_visibility(doc.get("visibility"), default="private")
    for key in ("created_at", "updated_at"):
        if doc.get(key):
            doc[key] = doc[key].isoformat()
    return jsonify({"preset": doc}), 200


@config_bp.route('/case-presets/<preset_id>/visibility', methods=['PATCH'])
@jwt_required()
def set_case_preset_visibility(preset_id):
    """Share a case with everyone, or take it back. Author only."""
    visibility = (request.get_json(silent=True) or {}).get('visibility')
    result = CasePreset.set_visibility(preset_id, get_jwt_identity(), visibility)
    if not result or result.matched_count == 0:
        return jsonify({"error": "Case not found, or not yours to change"}), 404
    return jsonify({"visibility": CasePreset.normalize_visibility(visibility)}), 200


@config_bp.route('/case-presets', methods=['POST'])
@jwt_required()
def save_case_preset():
    """Save the current case — documents plus its reviewed analysis — for reuse.

    Deliberately stores the `case_pack` as reviewed rather than re-deriving it on
    load: re-analysing would regenerate the answer key, and someone who has
    already checked and corrected one should not have to check it again.

    Public by default, since a case is teaching material and sharing is the point.
    The overwrite-by-name check is scoped to YOUR cases, so refining your own is
    an edit rather than a pile of near-duplicates and you can never clobber a
    colleague's case by choosing the same name.
    """
    user_id = get_jwt_identity()
    data = request.get_json(silent=True) or {}

    name = (data.get('name') or '').strip()
    if not name:
        return jsonify({"error": "Give the case a name"}), 400
    pack = data.get('case_pack')
    if not isinstance(pack, dict) or not pack.get('options'):
        return jsonify({"error": "Analyse and review the case before saving it as a preset"}), 400

    fields = {
        "user_id": user_id,
        "name": name,
        "visibility": CasePreset.normalize_visibility(data.get('visibility')),
        "candidate_summary": data.get('candidate_summary') or {"file_id": "", "text": ""},
        "candidates": data.get('candidates') or [],
        "case_pack": case_pack.recompute(pack),
        "class_preset": (data.get('class_preset') or '').strip(),
        "learning_outcome": (data.get('learning_outcome') or '').strip(),
    }

    existing = CasePreset.find_owned_by_name(name, user_id)
    if existing:
        CasePreset.replace_owned(existing["_id"], user_id, fields)
        saved = CasePreset.find_one_readable(existing["_id"], user_id)
    else:
        saved = CasePreset.create(fields)
    return jsonify({"preset": _preset_summary(saved, user_id)}), 200


@config_bp.route('/case-presets/<preset_id>', methods=['DELETE'])
@jwt_required()
def delete_case_preset(preset_id):
    """Remove a case you saved. Deleting someone else's is simply not found.

    Classes already built from it are unaffected — the case lives on each config
    doc, so removing the library copy never breaks a running exercise.
    """
    result = CasePreset.delete_owned(preset_id, get_jwt_identity())
    if not result or result.deleted_count == 0:
        return jsonify({"error": "Case not found, or not yours to delete"}), 404
    return jsonify({"deleted": True}), 200


@config_bp.route('/config/case-pack/recompute', methods=['POST'])
@jwt_required()
def recompute_case_pack():
    """Re-derive the tally from a pack the professor has edited. No model call.

    Lets the Review step show the effect of un-ticking a merge immediately, using
    the same counting code that runs at save. Duplicating the arithmetic in the
    browser would be a second source of truth for the one number the exercise
    turns on.
    """
    data = request.get_json(silent=True) or {}
    pack = data.get('case_pack')
    if not isinstance(pack, dict) or not pack.get('options'):
        return jsonify({"error": "case_pack is required"}), 400
    return jsonify({"case_pack": case_pack.recompute(pack)}), 200


@config_bp.route('/config_list', methods=['GET'])
@jwt_required()
def getconfigs():
    user_id=''
    try:
        # 1. Get the user ID from the JWT token
        user_id = get_jwt_identity()
        
        if user_id == '':
            return jsonify({"error": "User not authenticated"}), 401

        # 2. Query the database for all configs matching the user_id.
        user_configs_cursor = Config.find_by_user_id(user_id)

        # 3. Serialize the documents for the JSON response
        configs_list = []
        for config in user_configs_cursor:
            config['config_id'] = str(config.pop('_id'))
            # Ensure 'collection_name' is present, defaulting to an empty string if not
            config['collection_name'] = config.get('collection_name', '')
            configs_list.append(config)
        
        # 4. Return the list of configurations
        return jsonify({"configs": configs_list}), 200

    except Exception as e:
        if user_id:
            current_app.logger.error(f"Error fetching configurations for user {user_id}: {e}", exc_info=True)
        return jsonify({"message": "An internal server error occurred"}), 500

@config_bp.route('/config/<string:config_id>', methods=['GET'])
def get_single_config(config_id):
    user_id=''
    """
    Fetches a single configuration.
    If the config is private, a valid JWT for the owner is required.
    If public, it can be accessed without a JWT.
    """
    try:
        # 2. Validate the provided config_id to ensure it's a valid MongoDB ObjectId
        if not ObjectId.is_valid(config_id):
            return jsonify({"message": "Invalid configuration ID format"}), 400

        # 3. Query the database for a document that matches BOTH the config_id and the user_id
        config_document = Config.get_collection().find_one({"_id":ObjectId(config_id)})
        
        if config_document is None:
            return jsonify({"message": "Configuration not found"}), 404

        # If the chat is public, return it immediately. We still make a best-effort,
        # optional read of the caller's JWT so the owner gets an `owned` flag — that
        # flag is what surfaces owner-only controls in the client (e.g. resetting a
        # manager-exercise breakout lobby). Security is NOT enforced here: the reset
        # socket handler re-verifies ownership authoritatively.
        if config_document.get("is_public") is True:
            config_document["config_id"] = str(config_document.pop("_id"))
            config_document['collection_name'] = config_document.get('collection_name', '')
            try:
                verify_jwt_in_request(optional=True)
                caller_id = get_jwt_identity()
            except Exception:
                caller_id = None
            config_document["owned"] = bool(caller_id) and caller_id == config_document.get("user_id")
            return jsonify({"config": config_document}), 200

        # If we're here, the chat is private, so a valid JWT is required
        try:
            verify_jwt_in_request()
            user_id = get_jwt_identity()
        except Exception as e:
            # Keep this warning, it helps debug auth failures without spamming full objects
            logger.warning(f"JWT verification failed for config {config_id}: {e}")
            return jsonify({"message": "Authentication required for this private chat"}), 401

        # Check if the authenticated user is the owner of the config
        if config_document.get("user_id") != user_id:
            return jsonify({"message": "Access denied. You are not the owner of this configuration."}), 403

        # 5. Serialize the document for the JSON response. Reaching here means the
        # caller passed the ownership check above, so `owned` is unconditionally true.
        config_document["config_id"] = str(config_document.pop("_id"))
        config_document['collection_name'] = config_document.get('collection_name', '')
        config_document["owned"] = True
        return jsonify({"config": config_document}), 200
        
    except Exception as e:
        current_app.logger.error(f"Error fetching config {config_id} for user {user_id}: {e}", exc_info=True)
        return jsonify({"message": "An internal server error occurred"}), 500

@config_bp.route('/heygen/avatars', methods=['GET'])
@jwt_required()
def get_heygen_avatars():
    headers = {
        "X-Api-Key": current_app.config.get("HEY_GEN_API_KEY"),
        "Content-Type": "application/json"
    }
    try:
        response = requests.get("https://api.heygen.com/v1/streaming/avatar.list", headers=headers)
        avatar_list = response.json().get('data', [])
        if isinstance(avatar_list, dict):
            avatar_list = avatar_list.get('avatars', [])
        
        # STRICT FILTER: 
        # 1. Must have interactive_supported as True
        # 2. AND the ID must contain 'lite' or 'public' or 'ez'
        interactive_avatars = [
            a for a in avatar_list
            if isinstance(a, dict) and # Ensure item is a dict
            (
                # Logic 1: Check for keywords in ID
                any(k in a.get('avatar_id', '').lower() for k in ['lite', 'public', 'ez']) 
                or 
                # Logic 2: Or if it just looks like a streaming avatar
                a.get('is_public') is True
            )
        ]
        
        # If the swtrict list is empty, let's return the basic Lite ones so the UI isn't empty
       
            
        return jsonify({"avatars": interactive_avatars})
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@config_bp.route('/config', methods=['POST'])
@jwt_required()
def configure_model():
    """
    API endpoint that now robustly handles 'instructions' or a full 'prompt_template'.
    """
    try:
        # --- 1. Get User ID & Form Data ---
        user_id = get_jwt_identity()
        if not user_id:
            return jsonify({"error": "User not authenticated"}), 401

        config_json_str = request.form.get('config')
        if not config_json_str:
            return jsonify({"error": "Missing 'config' part in form data", "message": "Missing 'config' part in form data"}), 400
        
        try:
            config_data = json.loads(config_json_str)
        except json.JSONDecodeError:
            return jsonify({"error": "Invalid JSON in 'config' part", "message": "Invalid JSON in 'config' part"}), 400
        
        uploaded_files = request.files.getlist('files')
        llm_type = config_data.get('model_name')
        is_public = config_data.get('is_public')

        bot_name = config_data.get('bot_name', 'Assistant') 
        bot_type = config_data.get('bot_type', 'chat') 
        group_size = int(config_data.get('group_size', 2))
        group_duration = int(config_data.get('group_duration', 10))
        heygen_avatar_id = config_data.get('heygen_avatar_id', '')
        bot_avatar = config_data.get('bot_avatar', 'robot') 
        introduction = config_data.get('introduction', '') 
        temperature_str = config_data.get('temperature')
        response_timeout = config_data.get('response_timeout', 3) 
        collection_name = config_data.get('collection_name')

        # --- 2. Get both 'instructions' and 'prompt_template' ---
        instructions = config_data.get('instructions')
        custom_prompt_template = config_data.get('prompt_template')

        # --- 3. Robustly Create the Final Prompt Template ---
        final_prompt_template = ""

        if custom_prompt_template:
            # If a full template is provided, use it directly (highest priority)
            final_prompt_template = custom_prompt_template
        elif instructions:
            # Use f-string so user instructions may contain "{" / "}" without breaking str.format
            final_prompt_template = f"""You are a helpful AI assistant named '{bot_name}'.
Your goal is to answer questions accurately based on the context provided.

Follow these specific instructions:
{instructions}

Based on the context below, please answer the user's question. If the context doesn't contain the answer, say so.
Context: {{context}}
Question: {{question}}
Answer:"""
        else:
            # If neither is provided, it's an error
            return jsonify({"error": "Missing required field: please provide either 'instructions' or a 'prompt_template'"}), 400

        # --- 4. Parse bots (after prompt template exists for safe fallbacks) ---
        bots_json_str = config_data.get('bots', '[]')
        try:
            bots_list = json.loads(bots_json_str) if isinstance(bots_json_str, str) else (bots_json_str or [])
            if not isinstance(bots_list, list):
                bots_list = []
        except json.JSONDecodeError:
            logger.warning("Invalid JSON in bots; defaulting to empty list")
            bots_list = []

        # --- 5. Validate Other Inputs (0 is valid temperature — do not use truthiness) ---
        if llm_type is None or str(llm_type).strip() == "" or temperature_str is None:
            return jsonify({"error": "Missing required fields: llm_type or temperature"}), 400
        
        try:
            temperature = float(str(temperature_str))
            if not (0.0 <= temperature <= 2.0):
                raise ValueError
        except (ValueError, TypeError):
            return jsonify({"error": "Temperature must be a number between 0.0 and 2.0"}), 400

        # --- 6. Handle File Uploads ---
        os.makedirs(UPLOAD_FOLDER, exist_ok=True)
        temp_file_paths = []
        for file in uploaded_files:
            if file and allowed_file(file.filename):
                if file.filename:
                    filename = secure_filename(file.filename)
                    temp_file_path = os.path.join(UPLOAD_FOLDER, filename)
                    file.save(temp_file_path)
                    temp_file_paths.append(temp_file_path)
            elif file and file.filename:
                current_app.logger.warning(f"File type not allowed for {file.filename}, skipping.")

        # --- 7. Save Configuration to MongoDB ---
        mongo_collection = Config

        # Get the filenames of uploaded files (original name for display; secure name used for disk path above)
        uploaded_filenames = [file.filename for file in uploaded_files if file and allowed_file(file.filename)]
        
        config_document = {
            "user_id": user_id,
            "bot_name": bot_name,
            "bot_type": bot_type,
            "bot_avatar": bot_avatar,
            "heygen_avatar_id": heygen_avatar_id,
            "introduction": introduction,
            "collection_name": collection_name,
            "model_name": llm_type,
            "prompt_template": final_prompt_template,
            "temperature": temperature,
            "response_timeout": int(response_timeout),
            "is_public": is_public,
            "config_type": "normal",
            "documents": uploaded_filenames,
            "group_size": group_size,
            "group_duration": group_duration,
            "bots": bots_list,
            "web_access": bool(config_data.get('web_access', True)),
            "qualtrics_enabled": bool(config_data.get('qualtrics_enabled', False)),
            "audio_enabled": bool(config_data.get('audio_enabled', False)),
            "hume_config_id": (config_data.get('hume_config_id') or '').strip(),
            "facilitator": normalize_facilitator(config_data.get('facilitator')),
        }

        # Video-analysis configs carry an assignment type + an editable scoring spec.
        if bot_type == 'video_analysis':
            from src.video.rubrics import registry as video_registry
            assignment_type = (config_data.get('assignment_type') or '').strip()
            if assignment_type and assignment_type not in video_registry.get_preset_keys():
                return jsonify({"error": f"Unknown assignment_type '{assignment_type}'"}), 400
            scoring_spec = config_data.get('scoring_spec')
            if not (isinstance(scoring_spec, dict) and scoring_spec.get('submetric_weights')):
                scoring_spec = video_registry.get_default_spec(assignment_type)
            config_document['assignment_type'] = assignment_type
            config_document['scoring_spec'] = scoring_spec

        # Experiential labs: either a built-in template id, or a prof prompt +
        # an AI-generated lab config (validated client-side before save).
        if bot_type == 'experiential':
            template_id = (config_data.get('experiential_template_id') or '').strip()
            exp_prompt = (config_data.get('experiential_prompt') or '').strip()
            exp_config = config_data.get('experiential_config')
            if isinstance(exp_config, str):
                try:
                    exp_config = json.loads(exp_config)
                except json.JSONDecodeError:
                    exp_config = None
            # A generated lab is valid if it carries a pedagogy stamp (`method`,
            # e.g. shock-world) or the legacy predict-reveal `layers` shape.
            if not template_id and not (isinstance(exp_config, dict) and (exp_config.get('method') or exp_config.get('layers'))):
                return jsonify({"error": "Experiential labs require either a template id or a generated lab config"}), 400
            config_document['experiential_template_id'] = template_id
            config_document['experiential_prompt'] = exp_prompt
            if isinstance(exp_config, dict):
                config_document['experiential_config'] = exp_config

        # Manager Exercise — hidden-profile group game. Validates + normalizes the
        # manager_exercise sub-object and force-sets group_size == num_students.
        if bot_type == 'manager_exercise':
            err = validate_manager_exercise(config_data, config_document)
            if err:
                return err

        # Class rollout — any bot type may carry a class_code + usage tier/pool.
        err = validate_class_usage(config_data, config_document)
        if err:
            return err

        result = mongo_collection.get_collection().insert_one(config_document)
        config_id = result.inserted_id
        config_document['_id'] = str(config_id)

        # --- 8. Process Files ---
        if temp_file_paths:
            # Use the provided collection name, or generate one if it's empty
            final_collection_name = collection_name if collection_name else f"config_{config_id}"
            process_files_and_create_vector_store(
                temp_file_paths=temp_file_paths, 
                user_id=user_id, 
                collection_name=final_collection_name,
                config_id=config_id
            )
            # Update the config with the final collection name if it was generated
            if not collection_name:
                Config.get_collection().update_one(
                    {"_id": config_id},
                    {"$set": {"collection_name": final_collection_name}}
                )
        
        return jsonify({
            "message": "Configuration saved successfully!",
            "data": config_document
        }), 201

    except Exception as e:
        current_app.logger.error(f"An error occurred in /config route: {e}", exc_info=True)
        return jsonify({"error": "An internal server error occurred"}), 500


@config_bp.route('/usage/tiers', methods=['GET'])
@jwt_required()
def list_usage_tiers():
    """Tier menu for the class-rollout dropdown (any authenticated user)."""
    return jsonify({"tiers": usage_limits.get_settings().get("tiers", [])}), 200


@config_bp.route('/usage/me', methods=['GET'])
def get_my_usage():
    """Public read of the current visitor's usage status.

    Guests: anon counter for IP + signed device cookie. Logged-in users get
    their personal counter (class pools need a config doc, so they fall back
    to the user-default cap here). Sets the device cookie when missing so
    subsequent reads stay stable across page loads.
    """
    metering_user = None
    try:
        verify_jwt_in_request(optional=True)
        uid = get_jwt_identity()
        if uid:
            metering_user = User.find_by_id(uid)
    except Exception:
        pass

    ip = usage_limits.client_ip(request)
    device_id, device_cookie = usage_limits.get_or_set_device_id(request)
    identity = usage_limits.resolve_identity({}, metering_user, ip, device_id)
    status = usage_limits.check(identity)

    resp = jsonify({
        "remaining": status.get("remaining"),
        "cap": status.get("cap"),
        "population": status.get("population"),
    })
    if device_cookie:
        secure = bool(request.is_secure)
        resp.set_cookie(
            usage_limits.DEVICE_COOKIE, device_cookie,
            max_age=usage_limits.DEVICE_COOKIE_MAX_AGE,
            httponly=True, secure=secure,
            samesite="None" if secure else "Lax",
        )
    return resp, 200


@config_bp.route('/config/playground', methods=['GET'])
def get_playground_config():
    """Returns (creating on first call) the shared free playground config id.

    Free users chat against this single public bot; the model is chosen
    per-message via `model_override`. web_access is off so every model uses the
    legacy chain regardless of which one is picked.
    """
    col = Config.get_collection()
    doc = col.find_one({"is_playground": True}, {"_id": 1})
    if doc:
        return jsonify({"config_id": str(doc["_id"])}), 200
    playground = {
        "user_id": "system",
        "bot_name": "AI Playground",
        "bot_type": "chat",
        "bot_avatar": "robot",
        "introduction": "",
        "collection_name": "",
        "model_name": "gpt-4o-mini",
        "prompt_template": "You are a helpful AI assistant. Answer questions clearly and concisely.",
        "temperature": 0.7,
        "response_timeout": 3,
        "is_public": True,
        "is_playground": True,
        "web_access": False,
        "config_type": "normal",
        "documents": [],
    }
    doc_id = col.insert_one(playground).inserted_id
    return jsonify({"config_id": str(doc_id)}), 200


@config_bp.route('/config/by-class/<string:class_code>', methods=['GET'])
def get_config_by_class(class_code):
    """Public endpoint — returns minimal config info for a class code (used by the join page)."""
    try:
        from models.config import Config as mongo_collection
        doc = mongo_collection.get_collection().find_one(
            {"class_code": class_code.strip().lower()},
            {"bot_name": 1, "assignment_type": 1, "bot_type": 1}
        )
        if not doc:
            return jsonify({"error": "Class code not found"}), 404
        return jsonify({
            "config_id": str(doc["_id"]),
            "bot_name": doc.get("bot_name", "Assignment"),
            "assignment_type": doc.get("assignment_type", ""),
            "bot_type": doc.get("bot_type", "chat"),
        }), 200
    except Exception as e:
        current_app.logger.error(f"Error in /config/by-class: {e}", exc_info=True)
        return jsonify({"error": "An internal server error occurred"}), 500