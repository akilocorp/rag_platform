# @language  Python
# @updated   2026-07-20
# @changed   AI seats never take two turns in a row: _last_message_is_human() gates both the proactive
#            nudge loop and the human-reaction path, so the AI speaks once then waits for a user (nudge
#            loop no longer re-prompts unprompted; at most one AI reply per human turn).
#            Prior: AI holds a real seat, fully conversational under its ROLE NAME, indistinguishable from humans.
from flask import request, current_app
from flask_socketio import emit, join_room, leave_room
import logging
import json
import time
from bson import ObjectId
from langchain_mongodb.vectorstores import MongoDBAtlasVectorSearch

from src.managers.match_manager import match_manager
from src.managers.context_manager import get_or_create_context
from src.managers.bot_manager import analyze_intent, get_or_create_bot

# Manager Exercise collaborators (contract §6). We only IMPORT these — the files
# themselves are owned by their respective agents.
from src.managers import exercise_state as ex_state
from src.managers import ai_manager
from src.managers import exercise_grader
from src.models.manager_exercise_session import ManagerExerciseSession

logger = logging.getLogger(__name__)

# sid ↔ uid mappings so we can target specific users by socket ID
sid_to_uid: dict = {}
uid_to_sid: dict = {}

# How often the AI Manager considers dropping a nudge during the discuss phase.
# It sleeps this many seconds between ticks; each tick may stay silent.
NUDGE_INTERVAL_SECONDS = 45


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
        """Build the config dict handed to ExerciseState / ai_manager / grader.

        ExerciseState reads the manager_exercise sub-object's fields directly
        (num_managers, candidates, managers, durations, correct_candidate,
        grading_weights, ai_personality, no_show_timeout_seconds). We hand it the
        sub-object verbatim; ai_manager._config_get also accepts this shape.
        """
        return _manager_exercise_config(config_doc)

    # ---- Manager-Exercise hook implementations --------------------------------
    # ExerciseState drives the phase machine and invokes these registered hooks at
    # each edge so the AI-side work (docs, nudges, votes, grading) lives here in the
    # sockets/orchestration layer, not inside exercise_state.py (contract §6b).

    def _register_exercise_hooks(state, config_doc):
        """Attach the phase-edge hooks to a live ExerciseState.

        Every hook runs inside the ExerciseState background task (which already
        holds an app context), so we can touch Mongo / current_app freely. All are
        wrapped by ExerciseState._run_hook, which swallows exceptions — but we still
        guard the AI calls internally so a partial failure never stalls the machine.
        """
        me_config = _exercise_runtime_config(config_doc)
        personality = (me_config.get("ai_personality") or "friend")
        config_id = state.config_id

        def on_no_show_fill(st):
            """Waiting deadline elapsed with empty seats → AI-fill the remainder.

            Re-forms the room's seating so trailing empty seats become AI seats,
            then persists via ExerciseState.set_seats so the rebuilt state and the
            AI participant keys ("ai:<idx>") stay consistent.
            """
            seated = dict(st.seat_assignment)
            filled = set(seated.values())
            ai_seats = list(st.ai_seats)
            for idx in range(st.num_managers):
                if idx not in filled and idx not in ai_seats:
                    ai_seats.append(idx)
            st.set_seats(seated, sorted(ai_seats))
            logger.info(f"🪑 No-show fill for {st.room_id}: ai_seats={sorted(ai_seats)}")

        def on_memorize_start(st):
            """Send each seated human their OWN private document (targeted, never broadcast).

            Contract §4c: private_document goes only to the seat's socket. AI seats
            get nothing (no human is watching). Sent once, at memorize start.
            """
            for uid, seat in st.seat_assignment.items():
                target_sid = uid_to_sid.get(uid)
                if not target_sid:
                    continue
                socketio.emit("private_document", {
                    "room_id": st.room_id,
                    "seat_index": seat,
                    "role_name": st.role_name_for_seat(seat),
                    "doc_text": st.doc_text_for_seat(seat),
                }, to=target_sid)

        def on_discuss_start(st):
            """Discuss opened → the lead AI seat opens IN CHARACTER, then a proactive loop runs."""
            ctx = get_or_create_context(st.room_id)
            summary = ctx.summary_for_nudge()
            lead = min(st.ai_seats) if st.ai_seats else None
            if lead is not None:
                opener = ai_manager.seat_message(
                    me_config, personality,
                    st.role_name_for_seat(lead), st.doc_text_for_seat(lead),
                    transcript_summary=summary, kind="opening",
                )
                if opener:
                    _emit_seat_turn(st, lead, f"ai:{lead}", opener)
            # Fire-and-forget proactive loop; it self-terminates when the phase
            # leaves discuss (checked each tick against the live state).
            socketio.start_background_task(_nudge_loop, st.room_id)

        def on_decide_start(st):
            """Individual voting opened → have every AI seat reason from its doc and vote."""
            candidates = me_config.get("candidates") or []
            for idx in st.ai_seats:
                key = f"ai:{idx}"
                doc_text = st.doc_text_for_seat(idx)
                result = ai_manager.ai_seat_vote(doc_text, candidates, personality)
                candidate = (result or {}).get("candidate")
                if candidate and st.record_individual_vote(key, candidate):
                    _emit_vote_update(st, "individual")

        def on_collective_open(st):
            """Collective ballot opened → AI seats cast their group vote (reuse their pick)."""
            candidates = me_config.get("candidates") or []
            for idx in st.ai_seats:
                key = f"ai:{idx}"
                # Prefer the AI's already-computed individual pick for consistency;
                # fall back to a fresh reasoning pass only if it never voted.
                candidate = st.individual_votes.get(key)
                if not candidate:
                    result = ai_manager.ai_seat_vote(st.doc_text_for_seat(idx), candidates, personality)
                    candidate = (result or {}).get("candidate")
                if candidate:
                    if st.record_collective_vote(key, candidate):
                        _emit_vote_update(st, "collective")

        def on_grading(st):
            """Grading phase entered → run the LLM judge in the background, then set_grades."""
            socketio.start_background_task(_run_grading, st.room_id, me_config)

        state.hooks = {
            "on_no_show_fill": on_no_show_fill,
            "on_memorize_start": on_memorize_start,
            "on_discuss_start": on_discuss_start,
            "on_decide_start": on_decide_start,
            "on_collective_open": on_collective_open,
            "on_grading": on_grading,
        }

    def _emit_seat_turn(state, seat_index, participant_key, text):
        """Persist + broadcast a manager turn under the seat's ROLE NAME.

        Both humans and AI seats speak through here so every message the client sees
        carries `sender` = role name and `sender_seat` = index — never a uid or an
        "ai:<idx>" key. The client marks a viewer's OWN messages via sender_seat ==
        your_seat_index, so it can never tell which seats are AI. The grader-facing
        `sender` stays the raw participant_key (uid / "ai:<idx>").
        """
        role = state.role_name_for_seat(seat_index) or f"Manager {(seat_index or 0) + 1}"
        get_or_create_context(state.room_id).add_message(
            participant_key, text, sender_role=role, sender_seat=seat_index,
        )
        socketio.emit("message", {
            "room_id": state.room_id,
            "sender": role,
            "sender_seat": seat_index,
            "text": text,
        }, room=state.room_id)

    def _emit_vote_update(state, stage):
        """Emit a `vote_update` progress ping (contract §4c) — never leaks per-voter picks."""
        if stage == "individual":
            submitted = len(state.individual_votes)
        else:
            submitted = len(state.collective_ballot.get("votes", {}))
        socketio.emit("vote_update", {
            "room_id": state.room_id,
            "stage": stage,
            "submitted": submitted,
            "total": state.total_participants(),
        }, room=state.room_id)

    def _lead_ai_seat(state):
        """The lowest-indexed AI seat — drives proactive contributions so exactly one
        AI voice keeps the room alive (others still react to humans via _ai_seats_react)."""
        return min(state.ai_seats) if state.ai_seats else None

    def _last_message_is_human(room_id):
        """True iff the most recent message in the room came from a human seat.

        AI seats always post under the participant key "ai:<idx>"; humans post under
        their uid. This enforces "the AI speaks once, then waits for a human" — no AI
        seat ever takes two turns in a row without a human message in between.
        """
        msgs = get_or_create_context(room_id).messages
        if not msgs:
            return False
        return not str(msgs[-1].get("sender", "")).startswith("ai:")

    def _nudge_loop(room_id):
        """Background loop: while the room stays in discuss, the lead AI seat proactively
        contributes IN CHARACTER (volunteers a unique fact or probes fit-vs-qualified).

        Sleeps NUDGE_INTERVAL_SECONDS between ticks; each tick may stay silent. Self-
        terminates the moment the phase leaves discuss so it never speaks into a locked room.
        """
        with app.app_context():
            call_index = 0
            while True:
                socketio.sleep(NUDGE_INTERVAL_SECONDS)
                st = ex_state.get_exercise(room_id)
                if st is None or st.phase() != ex_state.PHASE_DISCUSS:
                    return
                lead = _lead_ai_seat(st)
                if lead is None:
                    return
                # Speak only when a human spoke most recently — the AI never posts a
                # second unprompted turn; it waits for the user before contributing again.
                if not _last_message_is_human(st.room_id):
                    continue
                me_config = st.config
                personality = (me_config.get("ai_personality") or "friend")
                summary = get_or_create_context(room_id).summary_for_nudge()
                nudge = ai_manager.seat_message(
                    me_config, personality,
                    st.role_name_for_seat(lead), st.doc_text_for_seat(lead),
                    transcript_summary=summary, kind="nudge", call_index=call_index,
                )
                call_index += 1
                if not nudge:
                    continue
                # Re-check phase after the (possibly slow) model call before speaking.
                st = ex_state.get_exercise(room_id)
                if st is None or st.phase() != ex_state.PHASE_DISCUSS:
                    return
                _emit_seat_turn(st, lead, f"ai:{lead}", nudge)

    def _ai_seats_react(room_id):
        """A human spoke during discuss → AI seats may reply IN CHARACTER (mostly stay silent).

        Each AI seat is staggered so replies feel natural and never all land at once;
        ai_manager.seat_message(kind='reply') returns None unless the seat has something
        genuinely additive, which keeps the AI from answering every single line.
        """
        with app.app_context():
            st = ex_state.get_exercise(room_id)
            if st is None or st.phase() != ex_state.PHASE_DISCUSS:
                return
            me_config = st.config
            personality = (me_config.get("ai_personality") or "friend")
            for n, idx in enumerate(list(st.ai_seats)):
                socketio.sleep(1.5 + n * 1.8)   # human-like typing delay, staggered per seat
                st = ex_state.get_exercise(room_id)
                if st is None or st.phase() != ex_state.PHASE_DISCUSS:
                    return
                # One AI reply per human turn: once any seat has spoken, the last
                # message is no longer human, so we stop and wait for the next user line.
                if not _last_message_is_human(room_id):
                    return
                summary = get_or_create_context(room_id).summary_for_nudge()
                reply = ai_manager.seat_message(
                    me_config, personality,
                    st.role_name_for_seat(idx), st.doc_text_for_seat(idx),
                    transcript_summary=summary, kind="reply",
                )
                if not reply:
                    continue
                st = ex_state.get_exercise(room_id)
                if st is None or st.phase() != ex_state.PHASE_DISCUSS:
                    return
                _emit_seat_turn(st, idx, f"ai:{idx}", reply)
                return   # spoke once — wait for the user before any AI replies again

    def _run_grading(room_id, me_config):
        """Background: run the LLM-judge grader, then hand results to ExerciseState.set_grades.

        set_grades persists, advances to `done`, and broadcasts the `grades` event.
        Fail-soft: the grader never raises, but if state vanished (shouldn't) we bail.
        """
        with app.app_context():
            st = ex_state.get_exercise(room_id)
            if st is None:
                return
            ctx = get_or_create_context(room_id)
            transcript = ctx.transcript_for_grading()

            # seat_roles: participant key (uid / "ai:<idx>") -> role_name, for prompt context.
            seat_roles = {}
            for uid, seat in st.seat_assignment.items():
                seat_roles[uid] = st.role_name_for_seat(seat) or ""
            for idx in st.ai_seats:
                seat_roles[f"ai:{idx}"] = st.role_name_for_seat(idx) or ""

            grades = exercise_grader.grade_exercise(
                config=me_config,
                transcript=transcript,
                individual_votes=st.individual_votes,
                collective_vote=st.collective_vote,
                correct_candidate=me_config.get("correct_candidate"),
                seat_roles=seat_roles,
            )
            st.set_grades(grades)

    def _bootstrap_exercise(room_id, config_doc, seat_assignment=None, ai_seats=None):
        """Create/rehydrate the ExerciseState for a room and start its phase machine.

        Called on match-formation (fresh) and on reconnect (rehydrate). Idempotent:
        get_or_create_exercise rebuilds from Mongo if needed and start() won't
        double-launch timers. Returns the live ExerciseState.
        """
        me_config = _exercise_runtime_config(config_doc)
        # Ensure the durable session doc exists before the machine can persist to it.
        if seat_assignment is not None:
            try:
                ManagerExerciseSession.create(
                    room_id, room_id.rsplit("_", 1)[0],
                    seat_assignment, ai_seats or [],
                )
            except Exception as e:  # noqa: BLE001
                logger.error(f"Failed to create exercise session for {room_id}: {e}")

        state = ex_state.get_or_create_exercise(room_id, me_config)
        _register_exercise_hooks(state, config_doc)
        # Install seats on a freshly-formed room (rehydrated rooms already have them).
        if seat_assignment is not None and not state.seat_assignment:
            state.set_seats(seat_assignment, ai_seats or [])
        # Start (or resume) the phase machine now that hooks + seats are in place.
        state.start(socketio, app)
        return state

    def _maybe_begin_memorize(state):
        """Advance waiting→memorize as soon as every seat is accounted for.

        Called after each successful get_history join. A manager_exercise room forms
        already fully seated — humans in the leading seats, the reserved AI seat(s)
        trailing — so once human seats + AI seats cover all N indices we start rather
        than waiting out the no-show timer.
        """
        if state.phase() != ex_state.PHASE_WAITING:
            return
        if len(state.seat_assignment) + len(state.ai_seats) >= state.num_managers:
            state.begin_memorize()

    def _schedule_no_show(config_id, group_size, timeout_seconds):
        """Arm the no-show fallback: after `timeout_seconds`, force-form a room with AI fill.

        Guards against forming an empty/dead room: if no human is queued when the
        timer fires, it does nothing (the queue is already empty). Only fires the
        first time a config's queue starts filling; a per-config in-flight flag
        prevents piling multiple timers on repeated joins.
        """
        if config_id in _no_show_armed:
            return
        _no_show_armed.add(config_id)
        # Record the shared absolute deadline so every queued client counts down to
        # the SAME auto-start moment (sent in the `queued` payload).
        _no_show_deadline[config_id] = time.time() + timeout_seconds

        def _fire():
            with app.app_context():
                socketio.sleep(timeout_seconds)
                _no_show_armed.discard(config_id)
                _no_show_deadline.pop(config_id, None)
                # If everyone already matched normally, the queue is empty — bail.
                queued = match_manager.queues.get(config_id, [])
                if not queued:
                    return
                config_doc = _load_config_doc(config_id)
                if not config_doc or config_doc.get("bot_type") != "manager_exercise":
                    return
                room_id, human_uids, ai_seat_indices = match_manager.force_form_room(
                    config_id, group_size, fill_with_ai=True
                )
                seat_assignment = match_manager.get_seat_assignment(room_id)
                logger.info(
                    f"⏰ No-show fire for {config_id}: room={room_id} "
                    f"humans={human_uids} ai_seats={ai_seat_indices}"
                )
                _bootstrap_exercise(room_id, config_doc, seat_assignment, ai_seat_indices)
                for uid in human_uids:
                    target_sid = uid_to_sid.get(uid)
                    if target_sid:
                        socketio.emit("match_found", {"room_id": room_id}, to=target_sid)

        socketio.start_background_task(_fire)

    # Per-config flag so we only arm one no-show timer at a time per config, plus the
    # shared auto-start deadline (epoch secs) surfaced to queued clients for the countdown.
    _no_show_armed = set()
    _no_show_deadline = {}

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
        """User enters matchmaking. Branches on bot_type: manager_exercise uses the
        seat-assigned path (+ no-show timer); every other bot_type keeps the plain
        group-chat behavior verbatim.
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

        # ------------------- MANAGER EXERCISE PATH -------------------
        if bot_type == "manager_exercise":
            me_config = _manager_exercise_config(config_doc)
            # num_managers = TOTAL seats. One seat is always the AI, so we only wait
            # for (num_managers - 1) HUMANS; the trailing seat is reserved as AI. A
            # room therefore forms as soon as N-1 students queue (or the no-show timer
            # fires with fewer, padding the rest with AI).
            num_managers = int(me_config.get("num_managers") or group_size or 2)
            group_size = num_managers
            human_target = max(1, num_managers - 1)

            room_id, matched_uids = match_manager.join_queue(
                config_id, uid, human_target, seat_assign=True, ai_fill_to=num_managers,
            )
            if room_id is None:
                # Still waiting — arm the no-show timer and report queue position +
                # the shared auto-start deadline so the waiting screen can count down.
                timeout = int(me_config.get("no_show_timeout_seconds") or 300)
                _schedule_no_show(config_id, num_managers, timeout)
                position = match_manager.queue_position(config_id, uid)
                logger.info(f"⏳ {uid} queued (manager_exercise) at position {position}")
                emit('queued', {
                    'position': position,
                    'no_show_deadline_ts': _no_show_deadline.get(config_id),
                    'server_now_ts': time.time(),
                }, to=request.sid)
                return

            # A full group formed — bootstrap durable state + phase machine, then
            # notify every matched user so they can get_history / enter.
            seat_assignment = match_manager.get_seat_assignment(room_id)
            ai_seats = match_manager.get_ai_seats(room_id)
            logger.info(f"✅ ManagerExercise match: humans={matched_uids} ai_seats={ai_seats} → room {room_id}")
            _bootstrap_exercise(room_id, config_doc, seat_assignment, ai_seats=ai_seats)
            for matched_uid in matched_uids:
                target_sid = uid_to_sid.get(matched_uid)
                if target_sid:
                    socketio.emit('match_found', {'room_id': room_id}, to=target_sid)
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
    # ROOM ENTRY / HISTORY
    # ==================================================================
    @socketio.on('get_history')
    def handle_get_history(data):
        """Join the room + replay history. For manager_exercise this is also where the
        user actually ENTERS: we (re)hydrate ExerciseState, emit the current
        exercise_state snapshot, and — only if the doc hasn't been locked yet —
        (re)send this seat's private_document.
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
            if is_manager_exercise:
                # Replay under ROLE NAMES only — never leak stored uids / "ai:<idx>"
                # keys, so a reconnecting client still can't tell which seats are AI.
                safe = [{
                    'sender': m.get('sender_role') or 'Manager',
                    'sender_seat': m.get('sender_seat'),
                    'text': m.get('text', ''),
                } for m in ctx.messages]
                emit('chat_history', {'messages': safe}, to=request.sid)
            else:
                emit('chat_history', {'messages': ctx.messages}, to=request.sid)

        # Manager-exercise: hydrate + emit state / private doc for this socket.
        if is_manager_exercise:
            uid = sid_to_uid.get(request.sid)
            state = _bootstrap_exercise(room_id, config_doc)
            if uid:
                emit('exercise_state', state.snapshot_for(uid), to=request.sid)
                # Re-send the private doc ONLY while it is still legitimately visible
                # (waiting/memorize). Once discuss begins the doc is permanently
                # hidden — never re-send it (contract §4c).
                if state.phase() in (ex_state.PHASE_WAITING, ex_state.PHASE_MEMORIZE):
                    seat = state.seat_of(uid)
                    if seat is not None:
                        emit('private_document', {
                            "room_id": room_id,
                            "seat_index": seat,
                            "role_name": state.role_name_for_seat(seat),
                            "doc_text": state.doc_text_for_seat(seat),
                        }, to=request.sid)
                # If all humans are now present, kick memorize off promptly.
                _maybe_begin_memorize(state)

        logger.info(f"📜 Sent history for room {room_id} to {request.sid}")

    @socketio.on('exercise_ready')
    def handle_exercise_ready(data):
        """Client signals it rendered its private doc (contract §4b, optional/idempotent).

        Purely an early-start optimization: if this ack means every human seat is
        present, begin memorize without waiting on the no-show timer.
        """
        room_id = (data or {}).get('room_id')
        if not room_id:
            return
        state = ex_state.get_exercise(room_id)
        if state is not None:
            _maybe_begin_memorize(state)

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
        # persisted) and the sender is told why (contract §4a / §10.1).
        state = ex_state.get_exercise(room_id)
        if state is not None:
            if state.chat_locked():
                emit('chat_locked', {
                    "room_id": room_id,
                    "locked": True,
                    "reason": state.phase(),
                }, to=request.sid)
                return
            # Discuss phase: broadcast + persist UNDER THE SENDER'S ROLE NAME (never the
            # raw uid), then let the AI seats react in character.
            seat = state.seat_of(uid)
            if seat is None:
                return   # only seated managers may speak
            _emit_seat_turn(state, seat, uid, text)
            socketio.start_background_task(_ai_seats_react, room_id)
            return

        # ------------------- PLAIN GROUP CHAT PATH (unchanged) -------------------
        # 1. Immediate broadcast to humans in the room
        emit('message', {'sender': uid, 'text': text}, room=room_id)
        # 2. Trigger AI background processing
        socketio.start_background_task(process_ai_logic, app, room_id, uid, text, socketio)

    # ==================================================================
    # VOTING (manager_exercise only)
    # ==================================================================
    @socketio.on('submit_individual_vote')
    def handle_submit_individual_vote(data):
        """Record a seated human's individual best-fit pick (contract §4b).

        ExerciseState.record_individual_vote enforces phase (decide-only), a valid
        candidate, and that the uid holds a seat. On success we emit a leak-free
        vote_update progress ping.
        """
        room_id = (data or {}).get('room_id')
        uid = (data or {}).get('uid')
        candidate = (data or {}).get('candidate')
        if not room_id or not uid or not candidate:
            return
        state = ex_state.get_exercise(room_id)
        if state is None:
            return
        if state.record_individual_vote(uid, candidate):
            _emit_vote_update(state, "individual")

    @socketio.on('submit_collective_vote')
    def handle_submit_collective_vote(data):
        """Record a seated human's vote in the SEPARATE collective group ballot.

        record_collective_vote enforces the ballot being open + validity, and will
        auto-resolve (→ collective_result → grading) once every participant has
        voted. We only emit the progress ping here; resolution events come from
        ExerciseState itself.
        """
        room_id = (data or {}).get('room_id')
        uid = (data or {}).get('uid')
        candidate = (data or {}).get('candidate')
        if not room_id or not uid or not candidate:
            return
        state = ex_state.get_exercise(room_id)
        if state is None:
            return
        if state.record_collective_vote(uid, candidate):
            _emit_vote_update(state, "collective")

    # ==================================================================
    # DISCONNECT (unchanged)
    # ==================================================================
    @socketio.on('disconnect')
    def handle_disconnect():
        uid = sid_to_uid.pop(request.sid, None)
        if uid:
            uid_to_sid.pop(uid, None)
            match_manager.leave_queue(uid)
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
