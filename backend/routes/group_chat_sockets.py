# @language  Python
# @updated   2026-08-01
# @changed   reset_breakout_room now also drops the in-memory ConversationContext cache, so a reset room no longer replays the previous session's transcript.
#            Prior: owner-only `reset_breakout_room` socket handler (JWT-verified config owner); M7 [REOPEN] second round + answer reveal; M6 kiosk `continue_ack`.
from flask import request, current_app
from flask_socketio import emit, join_room, leave_room
from flask_jwt_extended import decode_token
import logging
import json
import time
from bson import ObjectId
from langchain_mongodb.vectorstores import MongoDBAtlasVectorSearch

from src.managers.match_manager import match_manager
from src.managers.context_manager import get_or_create_context, remove_context
from src.managers.bot_manager import analyze_intent, get_or_create_bot

# Manager Exercise collaborators. ExerciseState owns the phase machine and the
# turn-taking counters; ai_manager owns the ACTR calls.
from src.managers import exercise_state as ex_state
from src.managers import ai_manager
from src.managers import exercise_grader
from src.models.manager_exercise_session import ManagerExerciseSession

logger = logging.getLogger(__name__)

# sid ↔ uid mappings so we can target specific users by socket ID
sid_to_uid: dict = {}
uid_to_sid: dict = {}

# How much transcript ACTR sees when judging its turn. Wider than the default so
# the start of a go-around is never scrolled off — it has to see who it asked.
FACILITATOR_HISTORY_MESSAGES = 20

# How long a pause is allowed to run before ACTR breaks it. This is a timer that
# FIRES, not one that blocks: ACTR is still asked the instant a student posts, and
# never waits when it judges it should speak. The timer only covers the case where
# a student says something and nobody — including the other students — follows.
FACILITATOR_SILENCE_SECONDS = 8

# Live occupancy of each manager-exercise breakout room: {room_id: {uid: name}}.
# Socket presence rather than the persisted roster, so closing a tab frees the
# slot. In-process only — a restart empties the lobby, which is the right default
# since every socket has dropped anyway.
_room_members: dict = {}


def register_socket_events(socketio, app):
    # ------------------------------------------------------------------
    # Small helpers scoped to the socket registration so they close over
    # `socketio` / `app` without polluting module scope.
    # ------------------------------------------------------------------

    def _load_config_doc(config_id):
        """Fetch a config doc by id, or None. Central so every handler loads it the same way."""
        config_collection_name = app.config.get("CONFIG")
        if not config_collection_name:
            logger.error("CONFIG collection name missing; cannot load config")
            return None
        try:
            return app.config["MONGO_DB"][config_collection_name].find_one(
                {"_id": ObjectId(config_id)}
            )
        except Exception as e:  # noqa: BLE001
            logger.warning(f"Could not load config {config_id}: {e}")
            return None

    def _manager_exercise_config(config_doc):
        """Return the `manager_exercise` sub-object, decoding a JSON string if needed.

        Faculty save may persist the sub-object as a nested dict or (on some wire
        paths) as a JSON-stringified blob — mirror the tolerant handling used for
        scoring_spec / experiential_config elsewhere in the codebase.
        """
        raw = (config_doc or {}).get("manager_exercise")
        if isinstance(raw, str):
            try:
                raw = json.loads(raw)
            except json.JSONDecodeError:
                logger.warning("Invalid manager_exercise JSON in config doc")
                return {}
        return raw or {}

    def _exercise_runtime_config(config_doc):
        """Build the config dict handed to ExerciseState / ai_manager.

        Both read the manager_exercise sub-object's fields directly (num_students
        as room capacity, num_rooms, candidates, discuss_minutes, case_pack,
        learning_points), so we hand it the sub-object verbatim.
        """
        return _manager_exercise_config(config_doc)

    # ---- Manager-Exercise facilitation ----------------------------------------
    # ExerciseState drives the phase machine and invokes the hooks registered below
    # at each edge, so all AI-side work lives here in the sockets/orchestration
    # layer rather than inside exercise_state.py.
    #
    # There are no AI players: the room is all real students and ACTR is a single
    # facilitator voice whose default is silence. Everything that decides WHEN it
    # speaks is in `_facilitator_turn`.

    FACILITATOR_SENDER = "ACTR"

    def _post(state, sender, text):
        """Persist + broadcast one room message under a display name.

        The manager exercise stores the DISPLAY NAME as `sender` rather than a uid:
        the facilitator reads the rendered transcript verbatim and has to see who
        said what by name, and nothing here is attributed per-uid for grading any
        more.
        """
        get_or_create_context(state.room_id).add_message(sender, text, sender_role=sender)
        socketio.emit("message", {
            "room_id": state.room_id,
            "sender": sender,
            "text": text,
        }, room=state.room_id)

    def _post_facilitator(state, text, go_around=False):
        """Post an ACTR turn and reset its turn-taking counters.

        `note_facilitator_spoke` arms the quorum gate when the message opened a
        go-around — that is what stops ACTR replying to each student individually
        as their answers trickle in.
        """
        if not text:
            return
        _post(state, FACILITATOR_SENDER, text)
        state.note_facilitator_spoke(go_around)

    def _register_exercise_hooks(state, config_doc):
        """Attach the phase-edge hooks to a live ExerciseState.

        Every hook runs inside the ExerciseState background task (which already
        holds an app context). All are wrapped by ExerciseState._run_hook, which
        swallows exceptions, and the model-calling ones are pushed onto their own
        background task so a slow completion never stalls the phase machine.
        """
        me_config = _exercise_runtime_config(config_doc)

        def on_choose_start(st):
            """Ballot opened → ACTR asks which candidate the group chose offline."""
            _post_facilitator(st, ai_manager.facilitator_open(me_config))

        def on_pick_resolved(st):
            """Pick entered → reveal that candidate's outcome, then ACTR's branch entry."""
            socketio.start_background_task(_reveal_and_enter, st.room_id)

        def on_wrapup(st):
            """Discuss timer expired → ACTR's closing ask. Nothing is scored."""
            socketio.start_background_task(_wrapup, st.room_id)

        state.hooks = {
            "on_choose_start": on_choose_start,
            "on_pick_resolved": on_pick_resolved,
            "on_wrapup": on_wrapup,
        }

    def _reveal_and_enter(room_id):
        """Background: post the chosen candidate's outcome document, then ACTR's entry.

        Ordering matters — the outcome lands first so the group reads it before
        being asked anything.

        A below-top-tally pick only records that a re-choice is PERMITTED. The
        ballot is not reopened here: buttons appearing beside the disarm message
        read as "your answer was wrong" however gently the message is worded, and
        that is the opposite of the move ACTR is making. The offer comes later,
        from ACTR, at MOVE 5.
        """
        with app.app_context():
            st = ex_state.get_exercise(room_id)
            if st is None or not st.chosen_candidate:
                return
            chosen = st.chosen_candidate
            forecast = st.forecast_text_for(chosen)
            if forecast:
                _post(st, f"📊 {chosen} — Outcome", forecast)

            summary = get_or_create_context(room_id).summary_for_nudge()
            result = ai_manager.facilitator_on_pick(
                st.config, st.roster, st.active_group_size(), chosen, forecast,
                transcript_summary=summary,
            )

            # M7 two-strike: the group has now made two wrong picks, so there is no
            # third round. ACTR gives its normal entry on THIS outcome, then reveals
            # the un-chosen answer outright (a scoped exception to "never name the
            # best option" — see ai_manager.facilitator_reveal_answer).
            if st.strikes >= 2:
                st.set_reopen_allowed(False)
                _post_facilitator(st, result.get("message"), result.get("go_around", False))
                answer = st.revealed_candidate or ""
                if answer:
                    reveal = ai_manager.facilitator_reveal_answer(
                        st.config, st.roster, st.active_group_size(), answer,
                        transcript_summary=summary,
                    )
                    _post_facilitator(st, reveal)
            else:
                st.set_reopen_allowed(result.get("reopen_allowed", False))
                _post_facilitator(st, result.get("message"), result.get("go_around", False))

    def _wrapup(room_id):
        """Background: ACTR's closing message + the M8 scorecard when discuss ends."""
        with app.app_context():
            st = ex_state.get_exercise(room_id)
            if st is None:
                return
            summary = get_or_create_context(room_id).summary_for_nudge()
            text = ai_manager.facilitator_wrapup(
                st.config, st.roster, st.active_group_size(), summary, st.chosen_candidate,
            )
            _post(st, FACILITATOR_SENDER, text)

            # M8: grade the session and broadcast the scorecard. Fail-soft — a grading
            # error must not stop the room from closing out.
            try:
                rubric = (st.config or {}).get("grading_rubric") or ""
                grades = exercise_grader.grade_exercise(
                    st, rubric_text=rubric, transcript_summary=summary,
                )
                st.set_grades(grades)
            except Exception:  # noqa: BLE001
                logger.exception("grading failed for %s", room_id)

    def _silence_watch(room_id, mark_ts):
        """Break an awkward pause: a student spoke, and 8s later nobody has followed.

        Armed by every student message and usually a no-op — if anyone speaks in
        the interval, or ACTR has already filled the gap, this returns without
        doing anything and whoever spoke last has their own watcher. It exists for
        the case the immediate turn deliberately passed on: one person answered,
        ACTR held to let the others react, and the others never did.
        """
        with app.app_context():
            socketio.sleep(FACILITATOR_SILENCE_SECONDS)
            st = ex_state.get_exercise(room_id)
            if st is None or not st.in_discussion():
                return
            if st.last_message_ts != mark_ts or st.spoke_last():
                return
            _facilitator_turn(room_id, silence=True)

    def _facilitator_turn(room_id, addressed=False, silence=False):
        """Background: ask ACTR whether this is its turn, and post if it says yes.

        Runs after EVERY student message. There is nothing between the message and
        the model's judgment — no debounce, no quorum, no cooldown. Each of those
        bought a guarantee with latency, and the facts they encoded are handed to
        the model instead (`turn_context`), which lets it hold during a go-around
        and step in when one has plainly been abandoned. SILENT is the expected
        answer most of the time.

        Two things stay structural, and neither makes anyone wait:
          * only student messages get here, so ACTR cannot post twice in a row;
          * one turn per room at a time, or two concurrent turns both post.
        """
        with app.app_context():
            st = ex_state.get_exercise(room_id)
            if st is None or not st.in_discussion():
                return
            if not st.claim_facilitator():
                return   # a turn is already running; the re-run below picks this up

            started_at_ts = st.last_message_ts
            try:
                ctx = get_or_create_context(room_id)
                result = ai_manager.facilitator_reply(
                    st.config, st.roster, st.active_group_size(),
                    ctx.summary_for_nudge(num_messages=FACILITATOR_HISTORY_MESSAGES),
                    chosen_name=st.chosen_candidate,
                    turn_context=st.turn_context(addressed=addressed, silence=silence),
                    reopen_allowed=st.reopen_allowed,
                )
                message = result.get("message")
                if not message:
                    return

                # The model call is slow enough that the phase can move under us.
                st = ex_state.get_exercise(room_id)
                if st is None or not st.in_discussion():
                    return
                # Speaking closes whatever go-around was open: it either answered
                # the pattern or moved past it, and either way ACTR is no longer
                # waiting on anyone.
                st.clear_go_around()
                _post_facilitator(st, message, result.get("go_around", False))
                # MOVE 5: ACTR decided the group has pooled and counted enough to be
                # invited to choose again. M7: this now starts a FULL second round
                # (timed choose → kiosk → reveal), not an inline re-ballot.
                if result.get("offer_reopen"):
                    st.begin_next_round()
            finally:
                st = ex_state.get_exercise(room_id)
                if st is not None:
                    st.release_facilitator()
                    # Anything said while that call was in flight was refused the
                    # lock and would otherwise never be considered. Look once more.
                    if st.last_message_ts != started_at_ts and st.in_discussion():
                        socketio.start_background_task(_facilitator_turn, room_id, False)

    # ---- Breakout-room lobby ---------------------------------------------------
    # A class gets one code and N named breakout rooms. Students see the rooms with
    # live occupancy, pick one, and start when they're ready — no queue. Waiting for
    # a room to fill strands whoever actually turned up, which is the common case.

    def _room_id_for(config_id, index):
        """Deterministic room id, so "Group 3" is the same room for everyone."""
        return f"{config_id}_g{int(index)}"

    def _lobby_channel(config_id):
        return f"lobby:{config_id}"

    def _lobby_rooms(config_id, me_config):
        """Live view of every breakout room: who's in it and whether it has begun.

        Occupancy comes from `_room_members` (socket presence) rather than the
        persisted roster, so a student who closes the tab frees their slot instead
        of holding it for the rest of the class.
        """
        try:
            num_rooms = max(1, int(me_config.get("num_rooms") or 5))
        except (TypeError, ValueError):
            num_rooms = 5
        try:
            capacity = max(1, int(me_config.get("num_students") or 3))
        except (TypeError, ValueError):
            capacity = 3

        rooms = []
        for i in range(1, num_rooms + 1):
            rid = _room_id_for(config_id, i)
            members = _room_members.get(rid, {})
            st = ex_state.get_exercise(rid)
            phase = st.phase() if st else ex_state.PHASE_WAITING
            rooms.append({
                "room_id": rid,
                "index": i,
                "label": f"Group {i}",
                "names": list(members.values()),
                "occupants": len(members),
                "capacity": capacity,
                "started": phase != ex_state.PHASE_WAITING,
                # A room in progress is still joinable — students arrive late and
                # a latecomer gets the whole transcript. Only a full or finished
                # room is closed.
                "joinable": phase != ex_state.PHASE_DONE and len(members) < capacity,
                "phase": phase,
            })
        return rooms

    def _broadcast_lobby(config_id, me_config):
        """Push the room list to everyone still looking at this config's lobby."""
        socketio.emit(
            "breakout_rooms",
            {"config_id": config_id, "rooms": _lobby_rooms(config_id, me_config)},
            room=_lobby_channel(config_id),
        )

    def _drop_from_rooms(uid):
        """Remove a uid from whichever breakout room held it. Returns its config_id."""
        for rid, members in list(_room_members.items()):
            if uid in members:
                members.pop(uid, None)
                if not members:
                    _room_members.pop(rid, None)
                return rid.rsplit("_", 1)[0]
        return None

    def _bootstrap_exercise(room_id, config_doc, create_session=False):
        """Create/rehydrate the ExerciseState for a room and start its phase machine.

        Called on match-formation (`create_session=True`) and on every reconnect.
        Idempotent: get_or_create_exercise rebuilds from Mongo if needed and start()
        won't double-launch timers. Returns the live ExerciseState.
        """
        me_config = _exercise_runtime_config(config_doc)
        # Ensure the durable session doc exists before the machine can persist to it.
        if create_session:
            try:
                ManagerExerciseSession.create(room_id, room_id.rsplit("_", 1)[0])
            except Exception as e:  # noqa: BLE001
                logger.error(f"Failed to create exercise session for {room_id}: {e}")

        state = ex_state.get_or_create_exercise(room_id, me_config)
        _register_exercise_hooks(state, config_doc)
        state.start(socketio, app)
        return state

    # ==================================================================
    # CONNECTION / UPLOAD SUBSCRIPTIONS (unchanged)
    # ==================================================================
    @socketio.on('connect')
    def handle_connect():
        logger.info(f"✅ SUCCESS: Frontend connected to Socket.IO! SID: {request.sid}")

    @socketio.on('subscribe_uploads')
    def handle_subscribe_uploads(data):
        """Join a user-scoped room so async upload workers can push completion events."""
        uid = (data or {}).get('user_id')
        if not uid:
            return
        join_room(f"user:{uid}")
        logger.info(f"📥 sid={request.sid} subscribed to upload events for user:{uid}")

    @socketio.on('subscribe_video')
    def handle_subscribe_video(data):
        """Join a submission-scoped room so the video pipeline can push progress."""
        sub_id = (data or {}).get('submission_id')
        if not sub_id:
            return
        join_room(f"video:{sub_id}")
        logger.info(f"🎬 sid={request.sid} subscribed to video events for video:{sub_id}")

    # ==================================================================
    # MATCHMAKING
    # ==================================================================
    @socketio.on('join_queue')
    def handle_join_queue(data):
        """User enters matchmaking (plain group chat).

        manager_exercise does NOT come through here — it uses the breakout-room
        lobby below, where students pick a room instead of being queued into one.
        """
        uid = data.get('uid')
        config_id = data.get('config_id')

        if not config_id or not uid:
            return

        # Register sid ↔ uid
        sid_to_uid[request.sid] = uid
        uid_to_sid[uid] = request.sid

        config_doc = _load_config_doc(config_id)
        group_size = 2
        bot_type = None
        if config_doc:
            bot_type = config_doc.get("bot_type")
            try:
                group_size = int(config_doc.get("group_size", 2))
            except (TypeError, ValueError):
                group_size = 2

        # Reconnect short-circuit: if the user already has a room, re-emit match_found.
        existing_room = match_manager.get_room_for_user(uid)
        if existing_room:
            logger.info(f"🔁 {uid} reconnected, already in room {existing_room}")
            emit('match_found', {'room_id': existing_room}, to=request.sid)
            return

        # ------------------- PLAIN GROUP CHAT PATH (unchanged) -------------------
        # Solo group (1 human + AIs): skip the queue, drop them straight into a room
        if group_size <= 1:
            room_id = match_manager.create_solo_room(config_id, uid)
            logger.info(f"👤 Solo room created for {uid} → {room_id}")
            emit('match_found', {'room_id': room_id}, to=request.sid)
            return

        room_id, matched_uids = match_manager.join_queue(config_id, uid, group_size)

        if room_id is None:
            position = match_manager.queue_position(config_id, uid)
            logger.info(f"⏳ {uid} queued for config {config_id} at position {position}")
            emit('queued', {'position': position}, to=request.sid)
        else:
            logger.info(f"✅ Match found: {matched_uids} → room {room_id}")
            for matched_uid in matched_uids:
                target_sid = uid_to_sid.get(matched_uid)
                if target_sid:
                    socketio.emit('match_found', {'room_id': room_id}, to=target_sid)
                else:
                    logger.warning(f"No SID found for matched uid {matched_uid}")

    @socketio.on('leave_queue')
    def handle_leave_queue(data):
        """User explicitly cancelled the matchmaking wait."""
        uid = (data or {}).get('uid') or sid_to_uid.get(request.sid)
        if not uid:
            return
        match_manager.leave_queue(uid)
        logger.info(f"🚪 {uid} left the queue")

    # ==================================================================
    # BREAKOUT ROOMS (manager_exercise only)
    # ==================================================================
    @socketio.on('list_breakout_rooms')
    def handle_list_breakout_rooms(data):
        """Subscribe this socket to a config's lobby and send the current room list."""
        config_id = (data or {}).get('config_id')
        uid = (data or {}).get('uid')
        if not config_id:
            return
        if uid:
            sid_to_uid[request.sid] = uid
            uid_to_sid[uid] = request.sid
        config_doc = _load_config_doc(config_id)
        if not config_doc or config_doc.get("bot_type") != "manager_exercise":
            return
        join_room(_lobby_channel(config_id))
        me_config = _manager_exercise_config(config_doc)
        emit('breakout_rooms', {
            'config_id': config_id,
            'rooms': _lobby_rooms(config_id, me_config),
        }, to=request.sid)

    @socketio.on('join_breakout_room')
    def handle_join_breakout_room(data):
        """Claim a place in a named breakout room, before or after it has started.

        Late joining is allowed on purpose: a class does not arrive all at once,
        and locking a room the moment it begins strands everyone who was thirty
        seconds behind. A latecomer gets the full transcript on entry, joins the
        roster, and counts toward the headcount ACTR is told about from then on.

        Refused only when the room is full, or finished — there is nothing left to
        join once the discussion has closed.
        """
        d = data or {}
        config_id, uid = d.get('config_id'), d.get('uid')
        index, display_name = d.get('room_index'), (d.get('display_name') or '').strip()
        if not config_id or not uid or not index:
            return

        sid_to_uid[request.sid] = uid
        uid_to_sid[uid] = request.sid

        config_doc = _load_config_doc(config_id)
        if not config_doc or config_doc.get("bot_type") != "manager_exercise":
            return
        me_config = _manager_exercise_config(config_doc)
        room_id = _room_id_for(config_id, index)

        state = ex_state.get_exercise(room_id)
        if state is not None and state.phase() == ex_state.PHASE_DONE:
            emit('breakout_error', {'reason': 'finished', 'room_id': room_id}, to=request.sid)
            return
        try:
            capacity = max(1, int(me_config.get("num_students") or 3))
        except (TypeError, ValueError):
            capacity = 3
        members = _room_members.setdefault(room_id, {})
        if uid not in members and len(members) >= capacity:
            emit('breakout_error', {'reason': 'full', 'room_id': room_id}, to=request.sid)
            return

        _drop_from_rooms(uid)   # switching rooms must not leave a ghost behind
        _room_members.setdefault(room_id, {})[uid] = display_name or uid

        leave_room(_lobby_channel(config_id))
        _bootstrap_exercise(room_id, config_doc, create_session=True)
        emit('match_found', {'room_id': room_id}, to=request.sid)
        _broadcast_lobby(config_id, me_config)
        logger.info(f"🚪 {uid} joined breakout {room_id} ({len(_room_members[room_id])}/{capacity})")

    @socketio.on('leave_breakout_room')
    def handle_leave_breakout_room(data):
        """Give up a place before the exercise starts, freeing the slot for someone else."""
        uid = (data or {}).get('uid') or sid_to_uid.get(request.sid)
        if not uid:
            return
        config_id = _drop_from_rooms(uid)
        if not config_id:
            return
        config_doc = _load_config_doc(config_id)
        if config_doc:
            _broadcast_lobby(config_id, _manager_exercise_config(config_doc))

    @socketio.on('reset_breakout_room')
    def handle_reset_breakout_room(data):
        """Owner-only: wipe a finished/stale breakout room back to an empty lobby slot.

        This is destructive, so — unlike the student handlers, which trust the
        client-sent uid — it does NOT trust a self-declared identity. It decodes a
        real JWT and requires the caller to own the config (the same ownership rule
        as GET /api/config/<id>). A student who spoofed a room_index could otherwise
        wipe a live group. Clears all four places a room's state lives: live
        occupancy, the in-memory phase machine, the cached conversation context,
        the durable session doc, and the persisted transcript, then re-broadcasts
        the lobby so every list updates.
        """
        d = data or {}
        config_id, index, token = d.get('config_id'), d.get('room_index'), d.get('token')
        if not config_id or not index or not token:
            emit('breakout_error', {'reason': 'reset_failed'}, to=request.sid)
            return

        # Authenticate + authorize before touching anything: decode the JWT (identity
        # rides in the `sub` claim) and require config ownership.
        try:
            identity = decode_token(token).get('sub')
        except Exception as e:  # noqa: BLE001 — malformed / expired token
            logger.warning(f"reset_breakout_room: token decode failed: {e}")
            emit('breakout_error', {'reason': 'unauthorized'}, to=request.sid)
            return

        config_doc = _load_config_doc(config_id)
        if not config_doc or config_doc.get("bot_type") != "manager_exercise":
            return
        if not identity or config_doc.get("user_id") != identity:
            logger.warning(f"reset_breakout_room: {identity} is not the owner of {config_id}")
            emit('breakout_error', {'reason': 'unauthorized'}, to=request.sid)
            return

        room_id = _room_id_for(config_id, index)

        # Bounce anyone still sitting in the room back to the lobby before the wipe,
        # so a reset mid-session doesn't leave a client staring at deleted state.
        socketio.emit('room_reset', {'room_id': room_id}, room=room_id)

        _room_members.pop(room_id, None)          # live socket occupancy
        ex_state.remove_exercise(room_id)          # in-memory phase machine
        # Drop the cached ConversationContext too: get_or_create_context only reloads
        # from Mongo on first access for a room_id, so without this the stale in-memory
        # ctx.messages survive the wipe and get replayed to the next session.
        remove_context(room_id)                    # cached chat transcript
        try:
            ManagerExerciseSession.delete_by_room(room_id)                       # durable session doc
            app.config["MONGO_DB"]['group_chat_messages'].delete_many(          # persisted transcript
                {"room_id": room_id}
            )
        except Exception as e:  # noqa: BLE001 — leave the in-memory reset in place regardless
            logger.error(f"reset_breakout_room: failed to clear persistence for {room_id}: {e}")

        _broadcast_lobby(config_id, _manager_exercise_config(config_doc))
        emit('breakout_reset', {'room_id': room_id, 'index': index}, to=request.sid)
        logger.info(f"♻️ {identity} reset breakout {room_id}")

    @socketio.on('start_exercise')
    def handle_start_exercise(data):
        """Any member starts the exercise with whoever is currently in the room.

        The headcount at this moment becomes the group — `active_group_size()` is
        what the facilitator is told from here on, not the configured capacity.
        """
        room_id = (data or {}).get('room_id')
        if not room_id:
            return
        state = ex_state.get_exercise(room_id)
        if state is None or not state.can_start():
            return
        logger.info(f"▶️  Exercise starting in {room_id} with {state.active_group_size()} student(s)")
        state.begin_choose()
        config_id = room_id.rsplit("_", 1)[0]
        config_doc = _load_config_doc(config_id)
        if config_doc:
            _broadcast_lobby(config_id, _manager_exercise_config(config_doc))

    # ==================================================================
    # ROOM ENTRY / HISTORY
    # ==================================================================
    @socketio.on('get_history')
    def handle_get_history(data):
        """Join the room + replay history. For manager_exercise this is also where the
        user actually ENTERS: we (re)hydrate ExerciseState, record them on the roster
        so ACTR can address them by name, and emit the current state snapshot.
        """
        room_id = data.get('room_id')
        if not room_id:
            return
        join_room(room_id)
        ctx = get_or_create_context(room_id)

        config_id = room_id.rsplit('_', 1)[0]
        config_doc = _load_config_doc(config_id)
        is_manager_exercise = bool(config_doc and config_doc.get("bot_type") == "manager_exercise")

        if ctx.messages:
            emit('chat_history', {'messages': ctx.messages}, to=request.sid)

        if is_manager_exercise:
            uid = sid_to_uid.get(request.sid)
            state = _bootstrap_exercise(room_id, config_doc)
            if uid:
                # The roster is captured on entry (not on first message) because the
                # go-around quorum is measured against it — a student who never
                # speaks must still be someone ACTR is waiting on.
                state.note_participant(uid, (data or {}).get('display_name'))
                emit('exercise_state', state.snapshot_for(uid), to=request.sid)

        logger.info(f"📜 Sent history for room {room_id} to {request.sid}")

    # ==================================================================
    # MESSAGING (server-side chat lock for manager_exercise)
    # ==================================================================
    @socketio.on('send_message')
    def handle_message(data):
        room_id = data.get('room_id')
        uid = data.get('uid')
        text = data.get('text')

        if not text or not room_id:
            return

        # Manager-exercise: enforce the AUTHORITATIVE server-side chat lock. Only the
        # discuss phase accepts sends; anything else is dropped (not broadcast, not
        # persisted) and the sender is told why.
        state = ex_state.get_exercise(room_id)
        if state is not None:
            if state.chat_locked():
                emit('chat_locked', {
                    "room_id": room_id,
                    "locked": True,
                    "reason": state.phase(),
                }, to=request.sid)
                return
            state.note_participant(uid)
            _post(state, state.display_name(uid), text)
            state.note_student_message(uid)
            addressed = FACILITATOR_SENDER.lower() in (text or "").lower()
            # Two paths, and they do different jobs. The immediate one asks ACTR
            # whether it should speak NOW — usually it should not, because one
            # student answering is not the group answering. The watcher covers the
            # case where holding was right but nobody else ever spoke.
            socketio.start_background_task(_facilitator_turn, room_id, addressed, False)
            socketio.start_background_task(_silence_watch, room_id, state.last_message_ts)
            return

        # ------------------- PLAIN GROUP CHAT PATH (unchanged) -------------------
        # 1. Immediate broadcast to humans in the room
        emit('message', {'sender': uid, 'text': text}, room=room_id)
        # 2. Trigger AI background processing
        socketio.start_background_task(process_ai_logic, app, room_id, uid, text, socketio)

    # ==================================================================
    # THE PICK (manager_exercise only)
    # ==================================================================
    @socketio.on('submit_collective_vote')
    def handle_submit_collective_vote(data):
        """One student casts their vote in the timed group ballot (M5).

        record_collective_vote enforces an open ballot, roster membership and a
        valid candidate, records the vote and broadcasts the running tally. It
        auto-resolves on a strict majority or once everyone present has voted;
        otherwise the clock (or the early-decision button) resolves it. Serves both
        the first pick and a re-choice — every resulting event is broadcast by
        ExerciseState, so the rest of the room updates without doing anything.
        """
        room_id = (data or {}).get('room_id')
        uid = (data or {}).get('uid')
        candidate = (data or {}).get('candidate')
        if not room_id or not uid or not candidate:
            return
        state = ex_state.get_exercise(room_id)
        if state is None:
            return
        state.record_collective_vote(uid, candidate)

    @socketio.on('early_decision')
    def handle_early_decision(data):
        """The group presses "Decide now" to finalize before the clock (M5).

        early_finalize only resolves if a majority of the roster has already voted
        (quorum); below that it is a no-op, so one impatient student can't end the
        decision for a room that hasn't weighed in yet.
        """
        room_id = (data or {}).get('room_id')
        uid = (data or {}).get('uid')
        if not room_id or not uid:
            return
        state = ex_state.get_exercise(room_id)
        if state is None:
            return
        state.early_finalize(uid)

    @socketio.on('continue_ack')
    def handle_continue_ack(data):
        """One student presses Continue at the kiosk gate (M6).

        The pressing client advances its own screen immediately; record_continue
        only governs the SHARED transition — it opens the outcome reveal + discussion
        once every seated student in the room has pressed Continue.
        """
        room_id = (data or {}).get('room_id')
        uid = (data or {}).get('uid')
        if not room_id or not uid:
            return
        state = ex_state.get_exercise(room_id)
        if state is None:
            return
        state.record_continue(uid)

    # ==================================================================
    # DISCONNECT (unchanged)
    # ==================================================================
    @socketio.on('disconnect')
    def handle_disconnect():
        uid = sid_to_uid.pop(request.sid, None)
        if uid:
            uid_to_sid.pop(uid, None)
            match_manager.leave_queue(uid)
            # Free their breakout slot so the lobby stays honest about who's around.
            config_id = _drop_from_rooms(uid)
            if config_id:
                config_doc = _load_config_doc(config_id)
                if config_doc:
                    _broadcast_lobby(config_id, _manager_exercise_config(config_doc))
            logger.info(f"🔌 {uid} disconnected and removed from queue")


def process_ai_logic(app, room_id, uid, text, socketio):
    """Background task for RAG and AI Generation (plain group_chat only)."""
    with app.app_context():
        try:
            # room_id format is "{config_id}_{8chars}" — extract the real config_id
            config_id = room_id.rsplit('_', 1)[0]

            config_collection_name = app.config.get("CONFIG")
            if not config_collection_name:
                logger.error("CONFIG collection name missing; cannot load group chat config")
                return

            config_doc = app.config["MONGO_DB"][config_collection_name].find_one(
                {"_id": ObjectId(config_id)}
            )
            if not config_doc:
                logger.warning(f"No config document for room_id={room_id} in collection {config_collection_name}")
                return
            if config_doc.get("bot_type") != "group_chat":
                return

            bots_raw = config_doc.get("bots", [])
            try:
                bots_config = json.loads(bots_raw) if isinstance(bots_raw, str) else (bots_raw or [])
            except json.JSONDecodeError:
                logger.warning("Invalid bots JSON in config; skipping AI reply")
                return
            if not bots_config:
                return

            ctx = get_or_create_context(room_id)
            ctx.add_message(uid, text)

            orch_history = ctx.get_context_summary(num_messages=10)
            chosen_bot_names = analyze_intent(text, bots_config, orch_history)

            # If orchestrator returns nothing, the message is off-topic — no bot should reply.
            if not chosen_bot_names:
                return

            rag_context = ""
            try:
                vector_store = MongoDBAtlasVectorSearch(
                    collection=app.config["MONGO_DB"]["vector_collection"],
                    embedding=app.config["EMBEDDINGS"],
                    index_name="vector",
                )
                docs = vector_store.similarity_search(
                    query=text, k=3, pre_filter={"config_id": {"$eq": room_id}}
                )
                rag_context = "\n\n".join(d.page_content for d in docs)
            except Exception as rag_err:
                logger.warning(f"RAG search skipped for group chat: {rag_err}")

            # Snapshot context once so all bots respond to the same state independently
            full_summary = ctx.get_context_summary(num_messages=20)

            for chosen_bot_name in chosen_bot_names:
                bot_cfg = next((b for b in bots_config if b.get("name") == chosen_bot_name), None)
                if not bot_cfg:
                    continue

                bot_instance = get_or_create_bot(room_id, bot_cfg)
                reply = bot_instance.generate_response(uid, text, full_summary, rag_context)

                if reply:
                    ctx.add_message(bot_instance.name, reply)
                    socketio.sleep(1)
                    socketio.emit(
                        "message",
                        {"sender": bot_instance.name, "text": reply},
                        room=room_id,
                    )
                else:
                    # e.g. OpenAI 403 unsupported_country_region_territory — user sees silence otherwise
                    err_text = (
                        "无法生成 AI 回复：模型接口返回错误（常见于当前地区不可用 OpenAI、密钥无效或网络问题）。"
                        "请在「编辑配置」里为该智能体选择你所在地区可用的模型（例如 DeepSeek、Gemini、通义千问），"
                        "或确认已配置对应 API Key。"
                    )
                    socketio.emit(
                        "message",
                        {"sender": "System", "text": err_text},
                        room=room_id,
                    )

        except Exception as e:
            logger.error(f"❌ AI Logic Error: {e}", exc_info=True)
