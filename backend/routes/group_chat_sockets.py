# @language  Python
# @updated   2026-08-19
# @changed   `_open_debrief` takes the facilitator lock, so the silence watcher can no longer open the
#            debrief a second time while the opener is still with the model — rooms were seeing step 1
#            posted twice.
#            Prior: A professor can now test their own exercise: `start_test_run` builds a room the student
#            lobby never lists and hands it to exercise_sim, whose model-played students post through
#            the same path a real socket message takes (so ACTR is woken identically).
#            Prior: ACTR's private reasoning is split off its reply and persisted on the message document instead
#            of being posted to the room; _post/_post_facilitator take `reasoning` and the socket emit
#            deliberately omits it. The learning objectives are re-assessed every few messages so ACTR is
#            told when to land the session. M13 leader-decides: `submit_collective_vote` →
#            `submit_group_choice` (the decider only), `ready_to_vote`/`early_decision` collapse into one
#            `end_discussion` handler, and the round-1 announcement names whoever enters the hire.
#            Prior: Finished breakout rooms survive a backend restart: the lobby room list and the join guard
#            fall back to the durable manager_exercise_sessions phase when no in-memory ExerciseState exists.
#            Prior: Quote-reply plumbing: _post/_post_facilitator accept a parent `reply_to` mid and echo the
#            stored mid + denormalized reply_to on every broadcast; the plain group-chat path persists the
#            human message BEFORE broadcasting and hands its mid to the bot so the bot's reply attaches to it;
#            the facilitator resolves a [REPLY:name] marker to that student's latest message.
#            Prior: _facilitator_turn now passes ACTR its own recent turns (FACILITATOR_REPEAT_LOOKBACK) so a
#            repeated question is caught, plus the chosen candidate's outcome document so it is pinned
#            into every turn rather than aging out of the transcript window.
#            Prior: M12: the debrief opener is model-generated from the facilitator prompt, so on_debrief_start
#            hands off to a new backgrounded _open_debrief instead of posting a hardcoded line inline.
#            Also M11: a ready_to_vote handler lets a majority of the room end round 1 before the clock
#            (superseded by M13 — see the banner).
#            Prior: M9 three-round rework. start_exercise now opens `solo` (round 0) and a new submit_solo_vote
#            handler records each private pick. The round-1 ACTR hooks are GONE (on_discuss_start /
#            on_choose_start); the ballot-open line is posted under a neutral system sender instead. All
#            facilitator gates moved from in_discussion() to facilitator_active() (debrief only), and a
#            reply carrying the END marker closes the session. Removed the strike-two answer reveal and
#            the whole grading block.
#            Prior: get_history trusts the client-provided uid so a reconnect reseeds the roster + resends the snapshot (fixes the kiosk "0 of N ready" strand); on_pick_resolved posts the outcome document synchronously; M7 lazy discuss clock; M3 pre-vote flow; reset_breakout_room drops the ConversationContext cache; owner-only reset handler.
from flask import request, current_app
from flask_socketio import emit, join_room, leave_room
from flask_jwt_extended import decode_token
import logging
import json
import time
import uuid
from bson import ObjectId
from langchain_mongodb.vectorstores import MongoDBAtlasVectorSearch

from src.managers.match_manager import match_manager
from src.managers.context_manager import get_or_create_context, remove_context
from src.managers.bot_manager import analyze_intent, get_or_create_bot

# Manager Exercise collaborators. ExerciseState owns the phase machine and the
# turn-taking counters; ai_manager owns the ACTR calls.
from src.managers import exercise_state as ex_state
from src.managers import ai_manager
from src.managers import exercise_sim
from src.models.manager_exercise_session import ManagerExerciseSession

logger = logging.getLogger(__name__)

# sid ↔ uid mappings so we can target specific users by socket ID
sid_to_uid: dict = {}
uid_to_sid: dict = {}

# How much transcript ACTR sees when judging its turn. Wider than the default so
# the start of a go-around is never scrolled off — it has to see who it asked.
FACILITATOR_HISTORY_MESSAGES = 20

# How many of ACTR's own past turns are checked for "you already asked this". Four
# covers the observed loop (one question across four turns) without reaching so far
# back that a question legitimately revisited much later reads as a repeat.
FACILITATOR_REPEAT_LOOKBACK = 4

# How often the learning objectives are re-assessed, in student messages. It is a third
# model call, and the answer moves slowly — a room does not go from "nothing established"
# to "everything established" inside four messages. Without this reading ACTR has no sense
# of an ending: it keeps finding one more good question and the debrief timer takes the
# landing away from it.
FACILITATOR_PROGRESS_EVERY = 4

# Cached per room so the reading survives between turns and can only accumulate. Keyed by
# room_id, in-process only — a restart re-derives it from the transcript within four
# messages, which is a cheap enough loss not to persist.
_progress_by_room: dict = {}

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

# Set by `register_socket_events` below. The HTTP layer launches a test room
# through this rather than importing the socket server, which it cannot do: the
# launcher has to close over `socketio` and `app` to start a background task and
# to post messages down the same path a real student's socket uses.
_test_run_launcher = None


def start_test_run(config_doc, bots=None):
    """Launch a model-played test room for a config and return its room_id.

    The room is real in every way that matters — real phase machine, real timers,
    real ACTR, messages persisted to `group_chat_messages` — and differs from a
    class room only in who is typing and in a room_id the student lobby never
    enumerates. See `src/managers/exercise_sim.py`.
    """
    if _test_run_launcher is None:
        raise RuntimeError("socket events have not been registered yet")
    return _test_run_launcher(config_doc, bots)


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
    #
    # M9: ACTR only exists in round 2. Rounds 0 and 1 register no AI hooks at all,
    # so there is nothing here for the group's own decision to fire.

    FACILITATOR_SENDER = "ACTR"

    # Room-level announcements that are NOT the facilitator: the ballot opening, and
    # anything else the machine needs to say. A separate sender because posting these
    # as ACTR is what used to put the facilitator in the room during round 1.
    SYSTEM_SENDER = "Exercise"

    def _post(state, sender, text, uid=None, reply_to=None, reasoning=None):
        """Persist + broadcast one room message under a display name.

        `sender` stays the DISPLAY NAME (the facilitator reads the transcript by name).
        `uid`, when given (student messages), rides along as `sender_uid` — persisted
        and broadcast — so the client marks a viewer's OWN messages by stable id rather
        than by a display name that can drift from the roster (which rendered your own
        text as someone else's). ACTR / system / outcome posts pass no uid.

        `reply_to` (a parent mid) makes this a quote-reply; the stored message's `mid`
        and denormalized `reply_to` preview are echoed on the broadcast so every client
        can render the quote block and scroll to the parent.
        """
        stored = get_or_create_context(state.room_id).add_message(
            sender, text, sender_role=sender, sender_uid=uid, reply_to=reply_to,
            reasoning=reasoning,
        )
        # `reasoning` is deliberately absent from the emit payload — it is stored for
        # tuning, never shown. Adding it here would put ACTR's private notes on screen.
        socketio.emit("message", {
            "room_id": state.room_id,
            "sender": sender,
            "sender_uid": uid,
            "text": text,
            "mid": stored.get("mid"),
            "reply_to": stored.get("reply_to"),
        }, room=state.room_id)

    def _post_facilitator(state, text, go_around=False, reply_to=None, reasoning=None):
        """Post an ACTR turn and reset its turn-taking counters.

        `note_facilitator_spoke` arms the quorum gate when the message opened a
        go-around — that is what stops ACTR replying to each student individually
        as their answers trickle in. `reply_to` (a parent mid) attaches the turn to
        the one student it answers instead of prefixing their name.
        """
        if not text:
            return
        _post(state, FACILITATOR_SENDER, text, reply_to=reply_to, reasoning=reasoning)
        state.note_facilitator_spoke(go_around)

    def _register_exercise_hooks(state, config_doc):
        """Attach the phase-edge hooks to a live ExerciseState.

        Every hook runs inside the ExerciseState background task (which already
        holds an app context). All are wrapped by ExerciseState._run_hook, which
        swallows exceptions, and the model-calling ones are pushed onto their own
        background task so a slow completion never stalls the phase machine.

        `config_doc` is no longer read here: the two model-calling hooks run in their
        own background task and take the runtime config off `st.config`, which is the
        same object `get_or_create_exercise` was built with.
        """

        def on_ballot_open(st):
            """Round-1 decision opened → a plain announcement, NOT a facilitator turn.

            Posted under SYSTEM_SENDER. This line used to come from ACTR, which meant
            the facilitator appeared in the middle of the group's own decision for the
            sake of one sentence the decision screen already says.

            M13: names the decider, because the rest of the room now gets no dialog —
            without this the screen would simply stop responding to them."""
            who = st.decider_name()
            _post(st, SYSTEM_SENDER,
                  f"Time's up. {who} is entering the hire for the group."
                  if who else "Time's up. The hire is being entered for the group.")

        def on_pick_resolved(st):
            """Pick entered → post the outcome document.

            SYNCHRONOUS: `_finish_kiosk` runs this hook and then immediately enters the
            debrief, whose opener reacts to how the hire turned out. Backgrounding the
            outcome would race that opener, so the room could be asked about a result it
            had not been shown yet."""
            with app.app_context():
                chosen = st.chosen_candidate
                forecast = st.forecast_text_for(chosen) if chosen else ""
                if forecast:
                    _post(st, f"📊 {chosen} — Outcome", forecast)

        def on_debrief_start(st):
            """Round 2 opened → ACTR's opener, and its first words of the whole session.

            Backgrounded, unlike before: the opener is now written by the model off the
            facilitator prompt, and a hook that blocks on a completion stalls the phase
            machine. Ordering with the outcome document is not at risk — `on_pick_resolved`
            posts that synchronously before this phase opens."""
            socketio.start_background_task(_open_debrief, st.room_id)

        def on_wrapup(st):
            """Exercise reached `done` → ACTR's closing message."""
            socketio.start_background_task(_wrapup, st.room_id)

        # No round-0 or round-1 hook exists. That absence IS the feature.
        state.hooks = {
            "on_ballot_open": on_ballot_open,
            "on_pick_resolved": on_pick_resolved,
            "on_debrief_start": on_debrief_start,
            "on_wrapup": on_wrapup,
        }

    def _open_debrief(room_id):
        """Background: ACTR's opener for the round-2 debrief.

        Model-generated from step 1 of the facilitator prompt, so a professor editing
        `facilitator_prompt_override` changes the first thing the room hears. Posts
        nothing if the call fails — see `facilitator_open_debrief`.

        Takes the facilitator lock like every other path that speaks. It used to be the
        one exception, and that opened the session TWICE: the silence watcher armed by
        the last round-1 message wakes 8s later, finds the room already in the debrief,
        finds no facilitator message yet (this call is still with the model) and finds
        `last_message_ts` unmoved (the outcome document is not a student message) — so
        all three of its guards pass and it opens step 1 a second time. Holding the lock
        for the whole call closes that window: the watcher finds it busy and returns.
        """
        with app.app_context():
            st = ex_state.get_exercise(room_id)
            if st is None:
                return
            if not st.claim_facilitator():
                return   # something is already speaking for ACTR; it opens the room
            try:
                opener, reasoning = ai_manager.facilitator_open_debrief(
                    st.config, st.roster, st.active_group_size(),
                    chosen_name=st.chosen_candidate, verdict=st.chosen_verdict(),
                )
                _post_facilitator(st, opener, reasoning=reasoning)
            finally:
                # Released whatever happened, or the room goes permanently quiet —
                # the failure mode `claim_facilitator` warns about in its docstring.
                st.release_facilitator()

    def _wrapup(room_id):
        """Background: ACTR's closing message when the debrief backstop timer expires.

        The usual ending is ACTR closing the session itself mid-conversation (the END
        marker in `_facilitator_turn`), which posts its own closing message — so this
        normally never runs.
        """
        with app.app_context():
            st = ex_state.get_exercise(room_id)
            if st is None:
                return
            summary = get_or_create_context(room_id).summary_for_nudge()
            text = ai_manager.facilitator_wrapup(
                st.config, st.roster, st.active_group_size(), summary, st.chosen_candidate,
            )
            _post(st, FACILITATOR_SENDER, text)

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
            if st is None or not st.facilitator_active():
                return
            if st.last_message_ts != mark_ts or st.spoke_last():
                return
            _facilitator_turn(room_id, silence=True)

    def _facilitator_turn(room_id, addressed=False, silence=False):
        """Background: ask ACTR whether this is its turn, and post if it says yes.

        Runs after every student message IN THE DEBRIEF. There is nothing between
        the message and the model's judgment — no debounce, no quorum, no cooldown.
        Each of those bought a guarantee with latency, and the facts they encoded are
        handed to the model instead (`turn_context`), which lets it hold during a
        go-around and step in when one has plainly been abandoned. SILENT is the
        expected answer most of the time.

        Three things stay structural, and none makes anyone wait:
          * `facilitator_active()` — the round gate. Round 1 returns here before any
            model call, so the group's own decision never reaches ACTR at all;
          * only student messages get here, so ACTR cannot post twice in a row;
          * one turn per room at a time, or two concurrent turns both post.
        """
        with app.app_context():
            st = ex_state.get_exercise(room_id)
            if st is None or not st.facilitator_active():
                return
            if not st.claim_facilitator():
                return   # a turn is already running; the re-run below picks this up

            started_at_ts = st.last_message_ts
            ended = False
            try:
                ctx = get_or_create_context(room_id)

                # Re-read how far the group has actually got, on a cadence. The WHOLE
                # debrief is passed, not the rolling window the facilitator itself reads:
                # the question is what this room has ever established, and asking it
                # against the last twenty messages makes an objective evaporate the moment
                # its evidence scrolls away. `assess_progress` unions each reading with the
                # previous one, so an objective once reached stays reached.
                progress = _progress_by_room.get(room_id)
                if len(ctx.messages) % FACILITATOR_PROGRESS_EVERY == 0:
                    progress = ai_manager.assess_progress(
                        ctx.get_context_summary(num_messages=len(ctx.messages)),
                        st.chosen_candidate,
                        previous=progress,
                        candidates=[c.get("name") for c in st.candidates if c.get("name")],
                    )
                    _progress_by_room[room_id] = progress

                result = ai_manager.facilitator_reply(
                    st.config, st.roster, st.active_group_size(),
                    ctx.summary_for_nudge(num_messages=FACILITATOR_HISTORY_MESSAGES),
                    chosen_name=st.chosen_candidate,
                    turn_context=st.turn_context(addressed=addressed, silence=silence),
                    solo_spread=st.solo_spread(),
                    # ACTR's own recent turns, so a question it has already asked can be
                    # detected as a repeat instead of asked a third time.
                    recent_asks=ctx.recent_by_sender(
                        FACILITATOR_SENDER, FACILITATOR_REPEAT_LOOKBACK
                    ),
                    outcome_text=st.forecast_text_for(st.chosen_candidate),
                    progress=progress,
                )
                message = result.get("message")
                if not message:
                    return

                # The model call is slow enough that the phase can move under us.
                st = ex_state.get_exercise(room_id)
                if st is None or not st.facilitator_active():
                    return
                # Speaking closes whatever go-around was open: it either answered
                # the pattern or moved past it, and either way ACTR is no longer
                # waiting on anyone.
                st.clear_go_around()
                # The reply target attaches this turn to that student's latest message.
                # It arrives as a `reply_to_name` field on the forced tool call, or from
                # a [REPLY:name] marker on the text fallback — both surface identically
                # here. Resolve by display name against the transcript; an unmatched name
                # just yields no reply (the message still posts, un-attached).
                reply_to_mid = None
                reply_name = (result.get("reply_to_name") or "").strip().lower()
                if reply_name:
                    for m in reversed(ctx.messages):
                        disp = (m.get("sender_role") or m.get("sender") or "")
                        if disp.lower() == reply_name:
                            reply_to_mid = m.get("mid")
                            break
                _post_facilitator(st, message, result.get("go_around", False),
                                  reply_to=reply_to_mid,
                                  reasoning=result.get("reasoning"))
                ended = bool(result.get("ended"))
            finally:
                st = ex_state.get_exercise(room_id)
                if st is not None:
                    st.release_facilitator()
                    # ACTR judged the debrief finished. Closing AFTER releasing the
                    # lock and posting the message, so the room reads its sign-off
                    # before the screen changes.
                    if ended:
                        st.end_debrief()
                    # Anything said while that call was in flight was refused the
                    # lock and would otherwise never be considered. Look once more.
                    elif st.last_message_ts != started_at_ts and st.facilitator_active():
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

    def _durable_room_phase(room_id):
        """Phase from the durable `manager_exercise_sessions` doc, or WAITING if none.

        Used when no in-memory ExerciseState exists (e.g. after a backend restart):
        _enter_done persists phase="done", so this keeps a finished room finished even
        though `ex_state.get_exercise` returns None until something rebuilds it.
        """
        try:
            doc = ManagerExerciseSession.find_by_room(room_id)
        except Exception as e:  # noqa: BLE001
            logger.error(f"durable phase lookup failed for {room_id}: {e}")
            return ex_state.PHASE_WAITING
        return (doc or {}).get("phase") or ex_state.PHASE_WAITING

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

        # Durable phase per room in ONE query, so a finished room survives a restart
        # in the lobby (in-memory ex_state is gone then, but the session doc isn't).
        durable_phase = {}
        try:
            for doc in ManagerExerciseSession.find_by_config(config_id):
                rid = doc.get("room_id")
                if rid:
                    durable_phase[rid] = doc.get("phase") or ex_state.PHASE_WAITING
        except Exception as e:  # noqa: BLE001
            logger.error(f"lobby durable-phase load failed for {config_id}: {e}")

        rooms = []
        for i in range(1, num_rooms + 1):
            rid = _room_id_for(config_id, i)
            members = _room_members.get(rid, {})
            st = ex_state.get_exercise(rid)
            # Prefer live state; fall back to the durable phase so "Finished" sticks.
            phase = st.phase() if st else durable_phase.get(rid, ex_state.PHASE_WAITING)
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

    def _launch_test_run(config_doc, bots=None):
        """Build a test room and hand it to the simulator. Returns the room_id.

        The room id is `{config_id}_t{hex}`, deliberately NOT the `_g{i}` shape
        `_room_id_for` produces: the lobby enumerates groups 1..num_rooms by name,
        so a test room cannot appear there, cannot be joined by a student, and
        cannot consume a group a class is about to use.
        """
        config_id = str(config_doc.get("_id"))
        room_id = f"{config_id}_t{uuid.uuid4().hex[:6]}"
        me_config = _manager_exercise_config(config_doc)
        try:
            capacity = max(1, int(me_config.get("num_students") or 3))
        except (TypeError, ValueError):
            capacity = 3
        state = _bootstrap_exercise(room_id, config_doc, create_session=True)

        def _post_as_student(uid, text):
            """Everything `handle_message` does for a student, minus the socket.

            Written out rather than shared with the handler because the handler is
            about a REQUEST — it reads `request.sid`, enforces the chat lock by
            emitting back to that socket, and answers a client. A simulated student
            has no socket to answer. What matters is that the four things after the
            post are identical, since they are what wakes ACTR.
            """
            state.note_participant(uid)
            state.arm_discuss_timer()
            _post(state, state.display_name(uid), text, uid)
            state.note_student_message(uid)
            socketio.start_background_task(_facilitator_turn, room_id, False, False)
            socketio.start_background_task(_silence_watch, room_id, state.last_message_ts)

        def _run():
            with app.app_context():
                try:
                    exercise_sim.run_test_room(
                        state, _post_as_student, socketio.sleep,
                        lambda: get_or_create_context(room_id).messages,
                        bots=bots or capacity,
                    )
                except Exception:  # noqa: BLE001 — a crashed sim must not take the worker
                    logger.exception(f"test run {room_id} failed")

        socketio.start_background_task(_run)
        logger.info(f"🧪 test run started for config {config_id} in {room_id}")
        return room_id

    # Publish the launcher for the HTTP layer. Done here, at definition, rather
    # than at the end of registration, so the two can never drift apart.
    global _test_run_launcher
    _test_run_launcher = _launch_test_run

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
        # Honour the durable phase when there's no live state (post-restart), so a
        # finished room refuses entry instead of replaying its transcript to a joiner.
        phase = state.phase() if state is not None else _durable_room_phase(room_id)
        if phase == ex_state.PHASE_DONE:
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
        # Same reasoning: the objectives reading is monotonic by design, so a stale one
        # would tell the next session it had already finished work it never did.
        _progress_by_room.pop(room_id, None)       # cached learning-objective reading
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
        # M9: a room opens on ROUND 0 — the private decision. Group discussion
        # (begin_discuss) only opens once everyone has committed on their own.
        state.begin_solo()
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
            # Trust the client-provided uid first: a reconnect arrives on a NEW socket
            # sid that has no sid_to_uid entry yet, so relying on the map alone would
            # skip roster (re)seeding and the state snapshot — leaving the student off
            # the kiosk quorum and stranded at "0 of N ready". Refresh the map too.
            uid = (data or {}).get('uid') or sid_to_uid.get(request.sid)
            if uid:
                sid_to_uid[request.sid] = uid
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
        # Quote-reply: the parent message's mid, if this message replies to one.
        reply_to = data.get('reply_to')

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
            # M7: the first student message is what actually starts the discussion, so
            # it arms the (until now lazy) discuss clock — the settling-in time before
            # this doesn't count against deliberation. Idempotent after the first, and
            # a no-op outside round 1.
            state.arm_discuss_timer()
            _post(state, state.display_name(uid), text, uid, reply_to=reply_to)
            state.note_student_message(uid)
            addressed = FACILITATOR_SENDER.lower() in (text or "").lower()
            # Two paths, and they do different jobs. The immediate one asks ACTR
            # whether it should speak NOW — usually it should not, because one
            # student answering is not the group answering. The watcher covers the
            # case where holding was right but nobody else ever spoke.
            #
            # Both are dispatched unconditionally and BOTH self-gate on
            # `facilitator_active()`. In round 1 they return before touching the
            # model, so the group's own decision costs nothing and reaches no AI.
            socketio.start_background_task(_facilitator_turn, room_id, addressed, False)
            socketio.start_background_task(_silence_watch, room_id, state.last_message_ts)
            return

        # ------------------- PLAIN GROUP CHAT PATH -------------------
        # 1. Persist the human message FIRST so it owns a stable mid and always
        #    persists (previously it was broadcast un-stored, and never saved at all
        #    in a bots-less group). Then broadcast with that mid + reply_to preview.
        ctx = get_or_create_context(room_id)
        stored = ctx.add_message(uid, text, reply_to=reply_to)
        emit('message', {
            'sender': uid,
            'text': text,
            'mid': stored.get('mid'),
            'reply_to': stored.get('reply_to'),
        }, room=room_id)
        # 2. Trigger AI background processing, handing it the human message's mid so the
        #    bot's reply attaches to it (the structured replacement for a "Name, …" prefix).
        socketio.start_background_task(process_ai_logic, app, room_id, uid, text, socketio, stored.get('mid'))

    # ==================================================================
    # THE PICK (manager_exercise only)
    # ==================================================================
    @socketio.on('submit_solo_vote')
    def handle_submit_solo_vote(data):
        """One student commits to a candidate ALONE, in round 0 (M9).

        `record_solo_vote` enforces an open round, roster membership and a valid
        candidate, then broadcasts how many have submitted — never who chose what.
        The room opens the group discussion by itself once everyone is in.
        """
        room_id = (data or {}).get('room_id')
        uid = (data or {}).get('uid')
        candidate = (data or {}).get('candidate')
        if not room_id or not uid or not candidate:
            return
        state = ex_state.get_exercise(room_id)
        if state is None:
            return
        state.record_solo_vote(uid, candidate)

    @socketio.on('submit_group_choice')
    def handle_submit_group_choice(data):
        """The decider enters the hire the group is going with (M13).

        `record_group_choice` enforces an open decision window, that this uid really
        is the room's decider, and a valid candidate — then resolves immediately.
        Every resulting event is broadcast by ExerciseState, so the rest of the room
        moves to the reveal without doing anything.
        """
        room_id = (data or {}).get('room_id')
        uid = (data or {}).get('uid')
        candidate = (data or {}).get('candidate')
        if not room_id or not uid or not candidate:
            return
        state = ex_state.get_exercise(room_id)
        if state is None:
            return
        state.record_group_choice(uid, candidate)

    @socketio.on('end_discussion')
    def handle_end_discussion(data):
        """The decider closes round 1 before the clock (M13).

        `end_discussion` enforces the discuss phase and rejects anyone who is not the
        decider, so the button being hidden for the rest of the room is a UI courtesy
        rather than the actual rule.
        """
        room_id = (data or {}).get('room_id')
        uid = (data or {}).get('uid')
        if not room_id or not uid:
            return
        state = ex_state.get_exercise(room_id)
        if state is None:
            return
        state.end_discussion(uid)

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


def process_ai_logic(app, room_id, uid, text, socketio, parent_mid=None):
    """Background task for RAG and AI Generation (plain group_chat only).

    `parent_mid` is the human message's stable mid (already persisted by the socket
    handler), so the bot reply can quote-attach to it. The handler owns persistence
    now — this task no longer re-adds the human message.
    """
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

            # The human message is already persisted by the socket handler (which owns
            # its mid), so we only read the shared context here — no re-add.
            ctx = get_or_create_context(room_id)

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
                    # Attach the bot reply to the message that triggered it, so its
                    # bubble quotes the exact student turn it answers.
                    stored_reply = ctx.add_message(bot_instance.name, reply, reply_to=parent_mid)
                    socketio.sleep(1)
                    socketio.emit(
                        "message",
                        {
                            "sender": bot_instance.name,
                            "text": reply,
                            "mid": stored_reply.get("mid"),
                            "reply_to": stored_reply.get("reply_to"),
                        },
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
