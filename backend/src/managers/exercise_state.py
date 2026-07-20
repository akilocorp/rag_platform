# @language  Python
# @updated   2026-07-20
# @changed   New: in-memory ExerciseState registry for the Manager Exercise — phase machine, timers, chat-lock, votes, collective ballot, Mongo persist+rebuild.
"""
In-process registry of live Manager-Exercise rooms.

Each matched room owns one `ExerciseState`. It holds the phase-machine state
(waiting → memorize → discuss → decide → grading → done), seat/AI-seat maps,
individual + collective votes, and the per-timed-phase deadlines. **Every**
mutation is written through to the durable `manager_exercise_sessions` collection
via `ManagerExerciseSession` (contract §6e) BEFORE the corresponding socket emit,
so a crash between persist and emit is recoverable: on cold access the state is
rebuilt from Mongo (`get_or_create_exercise`) and any already-elapsed timed phase
is fast-forwarded.

Timers run on `socketio.start_background_task` + `socketio.sleep` only
(async_mode='threading') — never time.sleep/asyncio (contract §10.3).

This module depends ONLY on the session-model API (contract §6e). The AI-side
work (opening/periodic nudges, AI-seat voting, LLM grading) lives in other files
(`ai_manager`, `exercise_grader`) and is wired in by the sockets agent through the
optional callback hooks below — keeping this file free of those imports.
"""
import logging
import time
from datetime import datetime
from threading import RLock
from typing import Callable, Dict, List, Optional, Tuple

from src.models.manager_exercise_session import ManagerExerciseSession

logger = logging.getLogger(__name__)

# --- Phase constants (contract §3 — EXACT strings) --------------------------
PHASE_WAITING = "waiting"
PHASE_MEMORIZE = "memorize"
PHASE_DISCUSS = "discuss"
PHASE_DECIDE = "decide"
PHASE_GRADING = "grading"
PHASE_DONE = "done"

# Ordered flow; used to fast-forward on rehydration.
PHASE_ORDER = [
    PHASE_WAITING,
    PHASE_MEMORIZE,
    PHASE_DISCUSS,
    PHASE_DECIDE,
    PHASE_GRADING,
    PHASE_DONE,
]

# Chat is unlocked ONLY during discuss (contract §3 / §10.1).
_UNLOCKED_PHASES = {PHASE_DISCUSS}

# Hard cap on the decide window before the collective ballot auto-resolves even if
# not everyone has voted (keeps a stalled seat from hanging the whole room).
DECIDE_WINDOW_SECONDS = 120


class ExerciseState:
    """
    Live state for one Manager-Exercise room.

    `config` is the `manager_exercise` sub-object augmented with the few top-level
    config fields the runtime needs (see `_read_config`). It is kept only for
    read-only lookups (candidate roster, role names, durations); it is NOT
    persisted here — the config lives on the `config_collections` doc.
    """

    def __init__(self, room_id: str, config: Dict, session_doc: Optional[Dict] = None):
        self.room_id = room_id
        self.config = config or {}
        self.config_id = _config_id_from_room(room_id)

        # Re-entrancy guard: timer background tasks and socket handlers can both
        # mutate the same state from different green threads.
        self._lock = RLock()

        # Wiring set by start(); None until the phase machine is kicked off.
        self._socketio = None
        self._app = None
        self._started = False

        # Optional hooks the sockets agent registers so AI-side work fires at the
        # right phase edges without this module importing ai_manager/grader.
        #   on_discuss_start(state)   -> emit AI opening nudge
        #   on_decide_start(state)    -> collect AI-seat individual votes
        #   on_collective_open(state) -> collect AI-seat collective votes
        #   on_grading(state)         -> run LLM grading, then call set_grades()
        self.hooks: Dict[str, Callable] = {}

        # --- Config-derived, read-only -------------------------------------
        cfg = self._read_config()
        self.num_managers: int = cfg["num_managers"]
        self.candidates: List[Dict] = cfg["candidates"]
        self.managers: List[Dict] = cfg["managers"]
        self.memorize_seconds: float = cfg["memorize_seconds"]
        self.discuss_seconds: float = cfg["discuss_seconds"]
        self.no_show_timeout_seconds: int = cfg["no_show_timeout_seconds"]
        self._candidate_names = {c.get("name") for c in self.candidates if c.get("name")}

        # --- Mutable state (either rehydrated or defaulted) ----------------
        if session_doc:
            self._load_from_doc(session_doc)
        else:
            self._phase = PHASE_WAITING
            self.phase_deadline_ts: Optional[float] = None
            self.no_show_deadline_ts: Optional[float] = None
            self.seat_assignment: Dict[str, int] = {}
            self.ai_seats: List[int] = []
            self.individual_votes: Dict[str, str] = {}
            self.collective_ballot: Dict = {"open": False, "votes": {}}
            self.collective_vote: Optional[str] = None
            self.grades: Dict[str, Dict] = {}

    # ==================================================================
    # CONFIG NORMALIZATION
    # ==================================================================
    def _read_config(self) -> Dict:
        """
        Pull the runtime-relevant fields out of the (possibly sparse) config with
        safe defaults. Minutes → seconds happen here so the timers deal in seconds.
        """
        c = self.config or {}
        managers = c.get("managers") or []
        num = int(c.get("num_managers") or len(managers) or 1)
        return {
            "num_managers": num,
            "candidates": c.get("candidates") or [],
            "managers": managers,
            "memorize_seconds": float(c.get("memorize_minutes") or 0) * 60.0,
            "discuss_seconds": float(c.get("discuss_minutes") or 0) * 60.0,
            "no_show_timeout_seconds": int(c.get("no_show_timeout_seconds") or 300),
        }

    # ==================================================================
    # REHYDRATION
    # ==================================================================
    def _load_from_doc(self, doc: Dict):
        """Reconstruct mutable state from a persisted session document (contract §2)."""
        self._phase = doc.get("phase") or PHASE_WAITING
        self.phase_deadline_ts = doc.get("phase_deadline_ts")
        self.no_show_deadline_ts = doc.get("no_show_deadline_ts")
        self.seat_assignment = dict(doc.get("seat_assignment") or {})
        # seat indices may come back as strings from some stores — coerce to int.
        self.seat_assignment = {u: int(i) for u, i in self.seat_assignment.items()}
        self.ai_seats = [int(i) for i in (doc.get("ai_seats") or [])]
        self.individual_votes = dict(doc.get("individual_votes") or {})
        cb = doc.get("collective_ballot") or {}
        self.collective_ballot = {
            "open": bool(cb.get("open", False)),
            "votes": dict(cb.get("votes") or {}),
        }
        self.collective_vote = doc.get("collective_vote")
        self.grades = dict(doc.get("grades") or {})

    # ==================================================================
    # PUBLIC READ ACCESSORS (contract §6b)
    # ==================================================================
    def phase(self) -> str:
        return self._phase

    def chat_locked(self) -> bool:
        """Authoritative chat gate. True unless the room is in `discuss`."""
        return self._phase not in _UNLOCKED_PHASES

    # --- Seat / participant helpers ------------------------------------
    def seat_of(self, uid: str) -> Optional[int]:
        """Seat index for a human uid, or None if not seated."""
        return self.seat_assignment.get(uid)

    def role_name_for_seat(self, seat_index: Optional[int]) -> Optional[str]:
        """Role name for a seat index from the config's managers list."""
        if seat_index is None or seat_index < 0 or seat_index >= len(self.managers):
            return None
        return (self.managers[seat_index] or {}).get("role_name") or f"Manager {seat_index + 1}"

    def doc_text_for_seat(self, seat_index: Optional[int]) -> str:
        """Private document text for a seat index (served to the seated student)."""
        if seat_index is None or seat_index < 0 or seat_index >= len(self.managers):
            return ""
        return (self.managers[seat_index] or {}).get("doc_text") or ""

    def all_participant_keys(self) -> List[str]:
        """
        Every voting participant: human uids + AI-seat keys ("ai:<idx>").
        Used to know when a vote stage is complete (contract §4b).
        """
        keys = list(self.seat_assignment.keys())
        keys.extend(f"ai:{idx}" for idx in self.ai_seats)
        return keys

    def total_participants(self) -> int:
        return len(self.seat_assignment) + len(self.ai_seats)

    def _seated_roles(self) -> List[str]:
        """Role names ordered by seat index, for the roster UI."""
        return [self.role_name_for_seat(i) or "" for i in range(self.num_managers)]

    # ==================================================================
    # SNAPSHOT (contract §4c `exercise_state` payload)
    # ==================================================================
    def snapshot_for(self, uid: str) -> Dict:
        """
        Build the per-viewer `exercise_state` payload. Never leaks other players'
        picks — only booleans + progress-safe fields.
        """
        with self._lock:
            seat = self.seat_of(uid)
            return {
                "room_id": self.room_id,
                "phase": self._phase,
                "phase_deadline_ts": self.phase_deadline_ts,
                "server_now_ts": time.time(),
                "num_managers": self.num_managers,
                "your_seat_index": seat,
                "your_role_name": self.role_name_for_seat(seat),
                "candidates": [
                    {"name": c.get("name", ""), "blurb": c.get("blurb", "")}
                    for c in self.candidates
                ],
                "seated_roles": self._seated_roles(),
                # No-show deadline drives the waiting-screen countdown. AI seats are
                # deliberately NOT exposed — clients must not be able to tell which
                # seats are AI (they render identically to human managers).
                "no_show_deadline_ts": self.no_show_deadline_ts,
                "you_voted_individual": uid in self.individual_votes,
                "collective_open": bool(self.collective_ballot.get("open")),
                "you_voted_collective": uid in self.collective_ballot.get("votes", {}),
            }

    # ==================================================================
    # PERSISTENCE (write-through — contract §10.2)
    # ==================================================================
    def _persist(self, fields: Dict):
        """
        Write mutated fields through to Mongo. Best-effort: a persistence failure
        is logged but must not raise into a socket handler / timer thread.
        """
        try:
            ManagerExerciseSession.upsert(self.room_id, fields)
        except Exception as e:  # noqa: BLE001 — never let persistence sink a turn
            logger.error("Failed to persist exercise state for %s: %s", self.room_id, e)

    def _emit(self, event: str, payload: Dict, to_room: bool = True, to_sid: Optional[str] = None):
        """Emit a socket event inside the app context (write happens BEFORE this)."""
        if not self._socketio:
            return
        try:
            if to_sid:
                self._socketio.emit(event, payload, to=to_sid)
            elif to_room:
                self._socketio.emit(event, payload, room=self.room_id)
            else:
                self._socketio.emit(event, payload)
        except Exception as e:  # noqa: BLE001
            logger.error("Failed to emit %s for %s: %s", event, self.room_id, e)

    def _run_hook(self, name: str):
        """Invoke an optional sockets-registered hook, swallowing its errors."""
        hook = self.hooks.get(name)
        if not hook:
            return
        try:
            hook(self)
        except Exception as e:  # noqa: BLE001 — AI-side work must never crash the machine
            logger.error("Exercise hook %s failed for %s: %s", name, self.room_id, e)

    # ==================================================================
    # SEAT / MEMBERSHIP MUTATION
    # ==================================================================
    def set_seats(self, seat_assignment: Dict[str, int], ai_seats: List[int]):
        """
        Install the seat map (human uid → index) and AI-filled seat indices, then
        persist. Called by the sockets agent at room formation / no-show fill.
        """
        with self._lock:
            self.seat_assignment = {u: int(i) for u, i in (seat_assignment or {}).items()}
            self.ai_seats = [int(i) for i in (ai_seats or [])]
            self._persist({"seat_assignment": self.seat_assignment, "ai_seats": self.ai_seats})

    # ==================================================================
    # PHASE MACHINE
    # ==================================================================
    def start(self, socketio, app):
        """
        Kick off the phase machine (contract §6b). Idempotent: safe to call again
        on reconnect — it will not double-launch timers.

        On a FRESH room (phase == waiting) it arms the no-show timer and the
        memorize entry. On a REHYDRATED room it fast-forwards any timed phase whose
        deadline already elapsed, then re-arms the remaining timers.
        """
        with self._lock:
            self._socketio = socketio
            self._app = app
            if self._started:
                return
            self._started = True

        socketio.start_background_task(self._drive)

    def _drive(self):
        """Background driver: fast-forward stale phases, then run the live timeline."""
        with self._app.app_context():
            phase = self._phase
            if phase == PHASE_WAITING:
                self._run_waiting()
            elif phase == PHASE_MEMORIZE:
                self._resume_timed(PHASE_MEMORIZE, self._enter_discuss)
            elif phase == PHASE_DISCUSS:
                self._resume_timed(PHASE_DISCUSS, self._enter_decide)
            elif phase == PHASE_DECIDE:
                # Ballot may still be open on a mid-decide restart; re-arm its cap.
                self._resume_timed(PHASE_DECIDE, self._auto_resolve_decide)
            # grading/done are terminal-ish; nothing to re-arm.

    def _sleep_until(self, deadline_ts: Optional[float]):
        """socketio.sleep in short slices until an absolute epoch deadline."""
        if not deadline_ts:
            return
        while True:
            remaining = deadline_ts - time.time()
            if remaining <= 0:
                return
            self._socketio.sleep(min(remaining, 1.0))

    def _resume_timed(self, expected_phase: str, on_expire: Callable):
        """
        Resume a timed phase after rehydration. If its deadline already passed,
        transition immediately; otherwise sleep out the remainder then transition.
        """
        if self._phase != expected_phase:
            return
        if self.phase_deadline_ts and self.phase_deadline_ts <= time.time():
            on_expire()
            return
        self._sleep_until(self.phase_deadline_ts)
        if self._phase == expected_phase:
            on_expire()

    def _run_waiting(self):
        """
        Waiting phase: hold until either all seats are filled/AI-filled (the sockets
        agent flips us to memorize via `begin_memorize`) OR the no-show deadline
        fires. This loop only handles the no-show fallback timeout.
        """
        if not self.no_show_deadline_ts:
            self.no_show_deadline_ts = time.time() + self.no_show_timeout_seconds
            self._persist({"no_show_deadline_ts": self.no_show_deadline_ts})

        self._sleep_until(self.no_show_deadline_ts)
        # If the sockets agent already advanced us (all humans present), do nothing.
        if self._phase == PHASE_WAITING:
            self._run_hook("on_no_show_fill")   # sockets: AI-fill empty seats, set_seats()
            self.begin_memorize()

    def begin_memorize(self):
        """
        Enter the memorize phase: arm the timer, persist, broadcast phase_change +
        chat_locked. Private docs are sent by the sockets agent (per-seat targeted).
        Idempotent guard: only fires from `waiting`.
        """
        with self._lock:
            if self._phase != PHASE_WAITING:
                return
            self._phase = PHASE_MEMORIZE
            self.phase_deadline_ts = time.time() + self.memorize_seconds
            self._persist({"phase": PHASE_MEMORIZE, "phase_deadline_ts": self.phase_deadline_ts})

        self._broadcast_phase()
        self._emit("chat_locked", {"room_id": self.room_id, "locked": True, "reason": "memorize"})
        self._run_hook("on_memorize_start")   # sockets: send private_document per seat

        # Arm the memorize→discuss timer on the current background task.
        self._sleep_until(self.phase_deadline_ts)
        if self._phase == PHASE_MEMORIZE:
            self._enter_discuss()

    def _enter_discuss(self):
        """
        Memorize expired → hide docs permanently, unlock chat, start discuss timer,
        fire the AI opening nudge hook. Then arm the discuss→decide timer.
        """
        with self._lock:
            if self._phase != PHASE_MEMORIZE:
                return
            self._phase = PHASE_DISCUSS
            self.phase_deadline_ts = time.time() + self.discuss_seconds
            self._persist({"phase": PHASE_DISCUSS, "phase_deadline_ts": self.phase_deadline_ts})

        self._emit("document_locked", {"room_id": self.room_id})
        self._broadcast_phase()
        self._emit("chat_locked", {"room_id": self.room_id, "locked": False, "reason": "discuss"})
        self._run_hook("on_discuss_start")    # sockets: ai_manager.opening_nudge + periodic loop

        self._sleep_until(self.phase_deadline_ts)
        if self._phase == PHASE_DISCUSS:
            self._enter_decide()

    def _enter_decide(self):
        """
        Discuss expired → lock chat, open individual voting, collect AI-seat
        individual votes, then open the collective ballot. Arms a hard cap so the
        ballot resolves even if a seat never votes.
        """
        with self._lock:
            if self._phase != PHASE_DISCUSS:
                return
            self._phase = PHASE_DECIDE
            self.phase_deadline_ts = time.time() + DECIDE_WINDOW_SECONDS
            self._persist({"phase": PHASE_DECIDE, "phase_deadline_ts": self.phase_deadline_ts})

        self._broadcast_phase()
        self._emit("chat_locked", {"room_id": self.room_id, "locked": True, "reason": "decide"})
        self._run_hook("on_decide_start")     # sockets: collect AI-seat individual votes
        self.open_collective_ballot()
        self._run_hook("on_collective_open")  # sockets: collect AI-seat collective votes

        # Hard cap: if not everyone votes, auto-resolve when the window elapses.
        self._sleep_until(self.phase_deadline_ts)
        if self._phase == PHASE_DECIDE:
            self._auto_resolve_decide()

    def _auto_resolve_decide(self):
        """Decide window elapsed with an open ballot → force-resolve and grade."""
        if self._phase == PHASE_DECIDE and self.collective_ballot.get("open"):
            self.resolve_collective()

    def _enter_grading(self):
        """
        Ballot resolved → move to grading, fire the grading hook (sockets runs the
        LLM judge, then calls set_grades which advances to done + emits `grades`).
        """
        with self._lock:
            if self._phase != PHASE_DECIDE:
                return
            self._phase = PHASE_GRADING
            self.phase_deadline_ts = None
            self._persist({"phase": PHASE_GRADING, "phase_deadline_ts": None})

        self._broadcast_phase()
        self._run_hook("on_grading")          # sockets: exercise_grader.grade_exercise → set_grades()

    def _broadcast_phase(self):
        """Emit the room-wide `phase_change` (contract §4c) after a persisted transition."""
        self._emit("phase_change", {
            "room_id": self.room_id,
            "phase": self._phase,
            "phase_deadline_ts": self.phase_deadline_ts,
            "server_now_ts": time.time(),
        })

    # ==================================================================
    # VOTING (contract §4b / §6b)
    # ==================================================================
    def _valid_candidate(self, candidate: str) -> bool:
        return candidate in self._candidate_names

    def record_individual_vote(self, uid: str, candidate: str) -> bool:
        """
        Record a seated participant's individual pick. Accepted only in `decide`
        for a valid candidate from a seated uid (human) or AI-seat key. Persists;
        returns True if the vote was stored.
        """
        with self._lock:
            if self._phase != PHASE_DECIDE:
                return False
            if not self._is_participant(uid) or not self._valid_candidate(candidate):
                return False
            self.individual_votes[uid] = candidate
            self._persist({"individual_votes": self.individual_votes})
            return True

    def open_collective_ballot(self):
        """Open the SEPARATE group ballot (contract §4b decision 2). Persists."""
        with self._lock:
            if self.collective_ballot.get("open"):
                return
            self.collective_ballot["open"] = True
            self._persist({"collective_ballot": self.collective_ballot})

    def record_collective_vote(self, uid: str, candidate: str) -> bool:
        """
        Record a group-ballot vote. Accepted only while the ballot is open, from a
        participant, for a valid candidate. Persists. If every participant has now
        voted, resolves the ballot. Returns True if the vote was stored.
        """
        with self._lock:
            if not self.collective_ballot.get("open"):
                return False
            if not self._is_participant(uid) or not self._valid_candidate(candidate):
                return False
            self.collective_ballot["votes"][uid] = candidate
            self._persist({"collective_ballot": self.collective_ballot})
            everyone_voted = len(self.collective_ballot["votes"]) >= self.total_participants()

        if everyone_voted:
            self.resolve_collective()
        return True

    def _is_participant(self, uid: str) -> bool:
        """A uid may vote iff it holds a human seat or is an AI-seat key."""
        if uid in self.seat_assignment:
            return True
        if uid.startswith("ai:"):
            try:
                return int(uid.split(":", 1)[1]) in self.ai_seats
            except (ValueError, IndexError):
                return False
        return False

    def resolve_collective(self) -> Tuple[str, Dict]:
        """
        Tally the collective ballot, set the finalized group pick, close the ballot,
        persist, emit `collective_result`, and advance to grading. Idempotent —
        returns the already-resolved result on a repeat call. Returns (winner, tally).
        """
        with self._lock:
            if self.collective_vote is not None and not self.collective_ballot.get("open"):
                return self.collective_vote, self._tally(self.collective_ballot["votes"])

            votes = self.collective_ballot.get("votes", {})
            tally = self._tally(votes)
            winner = self._pick_winner(tally)

            self.collective_vote = winner
            self.collective_ballot["open"] = False
            self._persist({
                "collective_vote": self.collective_vote,
                "collective_ballot": self.collective_ballot,
            })

        self._emit("collective_result", {
            "room_id": self.room_id,
            "collective_vote": winner,
            "tally": tally,
        })
        self._enter_grading()
        return winner, tally

    @staticmethod
    def _tally(votes: Dict[str, str]) -> Dict[str, int]:
        """Count votes per candidate name."""
        tally: Dict[str, int] = {}
        for cand in votes.values():
            tally[cand] = tally.get(cand, 0) + 1
        return tally

    def _pick_winner(self, tally: Dict[str, int]) -> Optional[str]:
        """
        Highest-count candidate. Ties broken deterministically by candidate-roster
        order so a rebuild yields the same winner. None if no votes were cast.
        """
        if not tally:
            return None
        roster_order = {c.get("name"): i for i, c in enumerate(self.candidates)}
        return max(tally.items(), key=lambda kv: (kv[1], -roster_order.get(kv[0], 1_000_000)))[0]

    # ==================================================================
    # GRADING (contract §6b — sockets computes; we persist + finalize)
    # ==================================================================
    def set_grades(self, grades: Dict[str, Dict]):
        """
        Persist the LLM-judge grading results, advance to `done`, and broadcast the
        `grades` payload (contract §4c) — ground truth + collective pick revealed,
        each grade enriched with role_name + the participant's individual_vote.
        """
        with self._lock:
            self.grades = dict(grades or {})
            self._phase = PHASE_DONE
            self.phase_deadline_ts = None
            self._persist({
                "grades": self.grades,
                "phase": PHASE_DONE,
                "phase_deadline_ts": None,
            })

        self._broadcast_phase()

        # Enrich only HUMAN grades for the client payload. AI-seat grades stay in
        # Mongo (self.grades) but are never broadcast — shipping an "ai:<idx>" key
        # would reveal which participant was the AI.
        enriched = {}
        for uid, g in self.grades.items():
            if uid.startswith("ai:"):
                continue
            seat = self.seat_of(uid)
            enriched[uid] = {
                **g,
                "role_name": self.role_name_for_seat(seat) or "",
                "individual_vote": self.individual_votes.get(uid),
            }

        self._emit("grades", {
            "room_id": self.room_id,
            "correct_candidate": self.config.get("correct_candidate"),
            "collective_vote": self.collective_vote,
            "grades": enriched,
        })


# =====================================================================
# MODULE-LEVEL REGISTRY (mirrors context_manager.get_or_create_context)
# =====================================================================
_exercises: Dict[str, ExerciseState] = {}
_registry_lock = RLock()


def get_or_create_exercise(room_id: str, config: Dict, socketio=None, app=None) -> ExerciseState:
    """
    Fetch the live ExerciseState for a room, rebuilding from Mongo on the first
    access after a restart (persist-backed — contract §6b). If `socketio`/`app`
    are supplied and the phase machine has not been started yet, kicks it off so a
    rehydrated room resumes its timers (fast-forwarding stale phases).
    """
    with _registry_lock:
        state = _exercises.get(room_id)
        if state is None:
            session_doc = None
            try:
                session_doc = ManagerExerciseSession.find_by_room(room_id)
            except Exception as e:  # noqa: BLE001 — degrade to a fresh in-memory state
                logger.error("Failed to load session doc for %s: %s", room_id, e)
            state = ExerciseState(room_id, config, session_doc=session_doc)
            _exercises[room_id] = state

    # Resume/kick the machine outside the registry lock (start() is idempotent).
    if socketio is not None and app is not None:
        state.start(socketio, app)
    return state


def get_exercise(room_id: str) -> Optional[ExerciseState]:
    """Return the live ExerciseState if one is in memory, else None (no rebuild)."""
    return _exercises.get(room_id)


def remove_exercise(room_id: str):
    """Drop a room's in-memory state (durable copy stays in Mongo)."""
    with _registry_lock:
        _exercises.pop(room_id, None)


def _config_id_from_room(room_id: str) -> str:
    """config_id is everything before the trailing `_{8hex}` (contract intro)."""
    return room_id.rsplit("_", 1)[0] if "_" in room_id else room_id
