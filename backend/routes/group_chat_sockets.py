# @language  Python
# @updated   2026-07-26
# @changed   manager_exercise rewired to the single ACTR facilitator: plain matchmaking, choose/discuss
#            hooks, outcome reveal + re-choice, and the debounce/quorum/cooldown gates that keep ACTR
#            from replying to every message. Removed AI seats, nudge loops, no-show fill, and grading.
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

# Manager Exercise collaborators. ExerciseState owns the phase machine and the
# turn-taking counters; ai_manager owns the ACTR calls.
from src.managers import exercise_state as ex_state
from src.managers import ai_manager
from src.models.manager_exercise_session import ManagerExerciseSession

logger = logging.getLogger(__name__)

# sid ↔ uid mappings so we can target specific users by socket ID
sid_to_uid: dict = {}
uid_to_sid: dict = {}


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

        Both read the manager_exercise sub-object's fields directly (num_students,
        candidates, discuss_minutes, case_pack, learning_points), so we hand it the
        sub-object verbatim.
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
        being asked anything. A below-top-tally pick reopens the ballot afterwards
        so they can choose again; that decision comes from the case pack's tally in
        Python, never from the model.
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
                st.config, st.roster, st.num_students, chosen, forecast,
                transcript_summary=summary,
            )
            _post_facilitator(st, result.get("message"), result.get("go_around", False))
            if result.get("reopen"):
                st.reopen_choice()

    def _wrapup(room_id):
        """Background: ACTR's closing message when the discuss window ends."""
        with app.app_context():
            st = ex_state.get_exercise(room_id)
            if st is None:
                return
            summary = get_or_create_context(room_id).summary_for_nudge()
            text = ai_manager.facilitator_wrapup(
                st.config, st.roster, st.num_students, summary, st.chosen_candidate,
            )
            _post(st, FACILITATOR_SENDER, text)

    def _facilitator_turn(room_id, addressed=False):
        """Background: run the turn-taking gates, then (maybe) post one ACTR message.

        A prompt cannot make itself wait — invoked on every message, a model that
        just asked a question will answer the first student who replies. So the
        waiting is enforced here, in order:

          1. DEBOUNCE — sleep, then bail if anyone spoke during the sleep, so a
             burst of quick messages yields one invocation instead of three.
          2. QUORUM  — a pending go-around blocks everything until every student
             has answered or the timeout fires (ExerciseState.facilitator_gate).
          3. COOLDOWN— N student turns since ACTR last spoke, making "never post
             twice in a row" structural, with an idle escape for a stalled room.
          4. SILENT  — the model's own veto, applied last inside ai_manager.

        Only the last of the four is the model's call.
        """
        with app.app_context():
            st = ex_state.get_exercise(room_id)
            if st is None:
                return
            if not addressed:
                mark = st.last_message_ts
                socketio.sleep(ex_state.FACILITATOR_DEBOUNCE_SECONDS)
                st = ex_state.get_exercise(room_id)
                if st is None or st.last_message_ts != mark:
                    return   # someone spoke during the wait; their turn re-arms this

            invoke, timed_out = st.facilitator_gate(addressed=addressed)
            if not invoke:
                return

            summary = get_or_create_context(room_id).summary_for_nudge()
            result = ai_manager.facilitator_reply(
                st.config, st.roster, st.num_students, summary,
                chosen_name=st.chosen_candidate, go_around_timed_out=timed_out,
            )
            message = result.get("message")
            if not message:
                # Model declined. Still drop a timed-out go-around, or the quorum
                # gate would wedge the room shut for the rest of the session.
                if timed_out:
                    st.clear_go_around()
                return

            # The model call is slow enough that the phase can move under us.
            st = ex_state.get_exercise(room_id)
            if st is None or st.phase() != ex_state.PHASE_DISCUSS:
                return
            _post_facilitator(st, message, result.get("go_around", False))

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
        # Plain matchmaking now: every participant is a real student, so the room
        # simply waits for `num_students` humans. No seat assignment, no AI fill,
        # and no no-show timer — an under-filled group has nobody to pool with, so
        # force-starting one would defeat the exercise.
        if bot_type == "manager_exercise":
            me_config = _manager_exercise_config(config_doc)
            num_students = int(me_config.get("num_students") or group_size or 2)

            room_id, matched_uids = match_manager.join_queue(config_id, uid, num_students)
            if room_id is None:
                position = match_manager.queue_position(config_id, uid)
                logger.info(f"⏳ {uid} queued (manager_exercise) at position {position}")
                emit('queued', {'position': position, 'server_now_ts': time.time()}, to=request.sid)
                return

            logger.info(f"✅ ManagerExercise match: students={matched_uids} → room {room_id}")
            _bootstrap_exercise(room_id, config_doc, create_session=True)
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
                # Everyone present → open the ballot rather than sitting in waiting.
                state.maybe_begin_choose()

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
            # Naming ACTR is treated as a direct question, which bypasses the
            # debounce and cooldown so it always gets an answer.
            addressed = FACILITATOR_SENDER.lower() in (text or "").lower()
            socketio.start_background_task(_facilitator_turn, room_id, addressed)
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
        """Record one student's entry of the group's already-agreed pick.

        record_collective_vote enforces an open ballot, roster membership, and a
        valid candidate, and auto-resolves (→ collective_result → outcome reveal)
        once everyone present has entered one. Serves both the first pick and a
        re-choice; resolution events come from ExerciseState itself.
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
            socketio.emit("vote_update", {
                "room_id": room_id,
                "submitted": len(state.collective_ballot.get("votes", {})),
                "total": len(state.roster),
            }, room=room_id)

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
