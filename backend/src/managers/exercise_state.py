# @language  Python
# @updated   2026-07-30
# @changed   M7: full second round (round/strikes counters), two-strike reveal of the answer, and round-2
#            participation tracking. Prior: M6 kiosk gate; M5 timed ballot.
"""
In-process registry of live Manager-Exercise rooms.

Each matched room owns one `ExerciseState`. It holds the phase-machine state
(waiting → choose → discuss → done), the group's chosen candidate, and the
turn-taking bookkeeping that keeps ACTR from replying to every message. **Every**
mutation is written through to the durable `manager_exercise_sessions` collection
via `ManagerExerciseSession` BEFORE the corresponding socket emit, so a crash
between persist and emit is recoverable: on cold access the state is rebuilt from
Mongo (`get_or_create_exercise`) and any elapsed timed phase is fast-forwarded.

The decision itself is made OFFLINE, on paper, before anyone opens the app. This
machine only covers what happens afterwards: the group enters its pick, the
matching outcome document is revealed, and ACTR facilitates the debrief. There is
no memorize phase, no per-seat private document, no individual ballot, and no
grading — students are never scored here.

Timers run on `socketio.start_background_task` + `socketio.sleep` only
(async_mode='threading') — never time.sleep/asyncio.

This module depends ONLY on the session-model API. The AI-side work lives in
`ai_manager` and is wired in by the sockets layer through the callback hooks
below, keeping this file free of those imports.
"""
import logging
import time
from threading import RLock
from typing import Callable, Dict, List, Optional, Tuple

from src.models.manager_exercise_session import ManagerExerciseSession

logger = logging.getLogger(__name__)

# --- Phase constants --------------------------------------------------------
PHASE_WAITING = "waiting"
PHASE_CHOOSE = "choose"
# M6: instructor-paced gate between the pick and the reveal. Each student presses
# Continue to advance their OWN screen (kiosk → time-skip → outcome); the room only
# moves on to the shared discussion once every seated student has pressed it.
PHASE_KIOSK = "kiosk"
PHASE_DISCUSS = "discuss"
PHASE_DONE = "done"

# Ordered flow; used to fast-forward on rehydration.
PHASE_ORDER = [PHASE_WAITING, PHASE_CHOOSE, PHASE_KIOSK, PHASE_DISCUSS, PHASE_DONE]

# Chat is unlocked ONLY during discuss. In `choose` the group speaks through the
# ballot buttons, not the chat, so the pick is a single deliberate act.
_UNLOCKED_PHASES = {PHASE_DISCUSS}

# --- Turn-taking ------------------------------------------------------------
# There are no gates. ACTR is invoked on every student message and decides for
# itself, from the facts `turn_context()` hands it plus the worked example in the
# prompt. Gates were tried first and every one of them bought a guarantee at the
# cost of latency: a quorum that stalled the room for a minute when one student
# went quiet, a cooldown that muted ACTR for three turns whether or not it had
# anything to say.
#
# Two things remain structural, and neither costs a wait:
#   * only STUDENT messages invoke the facilitator, so it cannot post twice in a
#     row — there is no trigger for a second turn;
#   * one turn per room at a time (`claim_facilitator`), because two concurrent
#     turns would both post.


class ExerciseState:
    """
    Live state for one Manager-Exercise room.

    `config` is the `manager_exercise` sub-object. It is kept only for read-only
    lookups (candidates, durations, case pack); it is NOT persisted here — the
    config lives on the `config_collections` doc.
    """

    def __init__(self, room_id: str, config: Dict, session_doc: Optional[Dict] = None):
        self.room_id = room_id
        self.config = config or {}
        self.config_id = _config_id_from_room(room_id)

        # Re-entrancy guard: timer background tasks and socket handlers can both
        # mutate the same state from different green threads.
        self._lock = RLock()

        self._socketio = None
        self._app = None
        self._started = False

        # True while a facilitator turn is in flight. Two messages arriving close
        # together can both clear the gates, and a model call takes seconds — the
        # counters that would stop the second turn are not reset until the first
        # one finishes. Without this they both post, which is exactly the
        # "never twice in a row" rule the cooldown exists to enforce.
        self._facilitator_busy = False

        # M6: one-shot guard so a rehydration `_drive` racing a final Continue can't
        # run the kiosk's shared reveal twice. Transient (not persisted); reset each
        # time the kiosk is (re-)entered.
        self._kiosk_finishing = False

        # Hooks the sockets layer registers so AI-side work fires at the right
        # phase edges without this module importing ai_manager:
        #   on_choose_start(state)  -> ACTR asks which candidate they chose
        #   on_pick_resolved(state) -> reveal the outcome doc + ACTR branch entry
        #   on_wrapup(state)        -> ACTR's closing message
        self.hooks: Dict[str, Callable] = {}

        cfg = self._read_config()
        self.capacity: int = cfg["capacity"]
        self.candidates: List[Dict] = cfg["candidates"]
        self.discuss_seconds: float = cfg["discuss_seconds"]
        self.choose_seconds: float = cfg["choose_seconds"]
        self.final_call_seconds: float = cfg["final_call_seconds"]

        if session_doc:
            self._load_from_doc(session_doc)
        else:
            self._phase = PHASE_WAITING
            self.phase_deadline_ts: Optional[float] = None
            self.roster: List[Dict] = []
            self.collective_ballot: Dict = {"open": False, "votes": {}, "final_call": False}
            self.continue_acks: List[str] = []
            self.chosen_candidate: Optional[str] = None
            self.forecast_shown_for: Optional[str] = None
            self.reopen_allowed: bool = False
            # M7: round/strike machine. `round` is 1|2; `strikes` counts wrong group
            # picks; two strikes ends the exercise with `collective_failed` and the
            # un-chosen best option surfaced as `revealed_candidate`. `round2_speakers`
            # records who spoke in the round-2 discussion (participation flag).
            self.round: int = 1
            self.strikes: int = 0
            self.collective_failed: bool = False
            self.revealed_candidate: Optional[str] = None
            self.round2_speakers: List[str] = []
            self.pending_go_around: Optional[Dict] = None
            self.last_facilitator_at: Optional[float] = None
            self.msgs_since_facilitator: int = 0
            self.last_message_ts: Optional[float] = None

    # ==================================================================
    # CONFIG NORMALIZATION
    # ==================================================================
    def _read_config(self) -> Dict:
        """Pull runtime-relevant fields out of the (possibly sparse) config, minutes → seconds."""
        c = self.config or {}
        try:
            num = int(c.get("num_students") or 0)
        except (TypeError, ValueError):
            num = 0
        return {
            # Room CAPACITY, not a required headcount — a group may start short.
            "capacity": max(2, num or 2),
            "candidates": c.get("candidates") or [],
            "discuss_seconds": float(c.get("discuss_minutes") or 20) * 60.0,
            # M5: the `choose` ballot is timed. The main window runs `choose_seconds`;
            # when it lapses a short `final_call_seconds` window opens (the client
            # beeps) before the pick is force-resolved from whatever votes are in.
            "choose_seconds": float(c.get("choose_minutes") or 3) * 60.0,
            "final_call_seconds": float(c.get("final_call_seconds") or 30),
        }

    # ==================================================================
    # REHYDRATION
    # ==================================================================
    def _load_from_doc(self, doc: Dict):
        """Reconstruct mutable state from a persisted session document."""
        self._phase = doc.get("phase") or PHASE_WAITING
        self.phase_deadline_ts = doc.get("phase_deadline_ts")
        self.roster = list(doc.get("roster") or [])
        cb = doc.get("collective_ballot") or {}
        self.collective_ballot = {
            "open": bool(cb.get("open", False)),
            "votes": dict(cb.get("votes") or {}),
            "final_call": bool(cb.get("final_call", False)),
        }
        self.continue_acks = list(doc.get("continue_acks") or [])
        self.chosen_candidate = doc.get("chosen_candidate")
        self.forecast_shown_for = doc.get("forecast_shown_for")
        self.reopen_allowed = bool(doc.get("reopen_allowed", False))
        self.round = int(doc.get("round") or 1)
        self.strikes = int(doc.get("strikes") or 0)
        self.collective_failed = bool(doc.get("collective_failed", False))
        self.revealed_candidate = doc.get("revealed_candidate")
        self.round2_speakers = list(doc.get("round2_speakers") or [])
        self.pending_go_around = doc.get("pending_go_around") or None
        self.last_facilitator_at = doc.get("last_facilitator_at")
        self.msgs_since_facilitator = int(doc.get("msgs_since_facilitator") or 0)
        self.last_message_ts = doc.get("last_message_ts")

    # ==================================================================
    # PUBLIC READ ACCESSORS
    # ==================================================================
    def phase(self) -> str:
        return self._phase

    def chat_locked(self) -> bool:
        """Authoritative chat gate. True unless the room is in `discuss`."""
        return self._phase not in _UNLOCKED_PHASES

    def roster_uids(self) -> List[str]:
        return [e.get("uid") for e in self.roster if e.get("uid")]

    def active_group_size(self) -> int:
        """How many students are ACTUALLY in this room.

        This — not the configured capacity — is what the facilitator is told. A
        room set up for four that starts with two is a room of two: ACTR must say
        "you two", scale its presence accordingly, and wait on two answers in a
        go-around, not four.
        """
        return max(1, len(self.roster))

    def display_name(self, uid: str) -> str:
        """The name ACTR and the transcript use for a uid; falls back to a short id."""
        for e in self.roster:
            if e.get("uid") == uid:
                return e.get("name") or "Student"
        return f"Student {str(uid)[:4]}"

    def forecast_text_for(self, name: Optional[str]) -> str:
        """The uploaded outcome document for a candidate name ("" if unknown)."""
        for c in self.candidates:
            if (c.get("name") or "") == (name or ""):
                return c.get("forecast_text") or ""
        return ""

    def _best_option(self) -> Optional[str]:
        """The answer key's best hire (AI-only; from the case pack). None if unset."""
        key = (self.config.get("case_pack") or {}).get("answer_key") or {}
        return (key.get("best_option") or None)

    def _pick_is_correct(self, name: Optional[str]) -> bool:
        """True when `name` is the case's best option (M7 correctness gate)."""
        best = (self._best_option() or "").strip().lower()
        return bool(best) and best == (name or "").strip().lower()

    def round2_absentees(self) -> List[str]:
        """Roster names who never spoke in the round-2 discussion (participation flag).

        Only meaningful once the room has reached round 2; before that it is empty.
        """
        if self.round < 2:
            return []
        spoke = set(self.round2_speakers)
        return [e.get("name", "") for e in self.roster if e.get("uid") not in spoke]

    # ==================================================================
    # SNAPSHOT (`exercise_state` payload)
    # ==================================================================
    def snapshot_for(self, uid: str) -> Dict:
        """
        Build the per-viewer `exercise_state` payload.

        Fields are listed explicitly rather than spread from config: the config
        carries `candidate_summary` and `case_pack` (the answer key), and a
        student client must never receive either.
        """
        with self._lock:
            revealed = self.forecast_shown_for and self.forecast_shown_for == self.chosen_candidate
            return {
                "room_id": self.room_id,
                "phase": self._phase,
                "phase_deadline_ts": self.phase_deadline_ts,
                "server_now_ts": time.time(),
                "capacity": self.capacity,
                "candidates": [{"name": c.get("name", "")} for c in self.candidates],
                "roster": [{"name": e.get("name", "")} for e in self.roster],
                "can_start": self.can_start(),
                "collective_open": bool(self.collective_ballot.get("open")),
                "you_voted_collective": uid in self.collective_ballot.get("votes", {}),
                # M5: live decision state so the client can render the running tally,
                # highlight this viewer's own vote, and flag the final-call window.
                "collective_final_call": bool(self.collective_ballot.get("final_call")),
                "collective_tally": self._tally(self.collective_ballot.get("votes", {})),
                "your_vote": self.collective_ballot.get("votes", {}).get(uid),
                # M6: kiosk progress so a (re)joining client renders the gate/wait
                # accurately and knows whether it has already pressed Continue.
                "kiosk_acked": len(self.continue_acks),
                "kiosk_total": len(self.roster),
                "you_continued": uid in self.continue_acks,
                "chosen_candidate": self.chosen_candidate,
                "forecast_text": self.forecast_text_for(self.chosen_candidate) if revealed else None,
                # M7: round/strike surface. `revealed_candidate` is only the answer
                # AFTER two strikes, at which point showing it is the whole point.
                "round": self.round,
                "collective_failed": self.collective_failed,
                "revealed_candidate": self.revealed_candidate,
            }

    # ==================================================================
    # PERSISTENCE (write-through)
    # ==================================================================
    def _persist(self, fields: Dict):
        """Write mutated fields through to Mongo. Never raises into a handler/timer."""
        try:
            ManagerExerciseSession.upsert(self.room_id, fields)
        except Exception as e:  # noqa: BLE001
            logger.error("Failed to persist exercise state for %s: %s", self.room_id, e)

    def _emit(self, event: str, payload: Dict, to_sid: Optional[str] = None):
        """Emit a socket event (the persist always happens BEFORE this)."""
        if not self._socketio:
            return
        try:
            if to_sid:
                self._socketio.emit(event, payload, to=to_sid)
            else:
                self._socketio.emit(event, payload, room=self.room_id)
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
    # ROSTER
    # ==================================================================
    def note_participant(self, uid: str, name: Optional[str] = None) -> bool:
        """Record a student who has entered the room. Returns True if the roster grew.

        The roster is what lets ACTR address people by name and what the go-around
        quorum is measured against, so it is captured on room entry rather than
        derived from who happens to have spoken.
        """
        if not uid:
            return False
        with self._lock:
            for e in self.roster:
                if e.get("uid") == uid:
                    if name and not e.get("name"):
                        e["name"] = name
                        self._persist({"roster": self.roster})
                    return False
            self.roster.append({"uid": uid, "name": name or f"Student {len(self.roster) + 1}"})
            self._persist({"roster": self.roster})
            return True

    # ==================================================================
    # PHASE MACHINE
    # ==================================================================
    def start(self, socketio, app):
        """Kick off (or resume) the phase machine. Idempotent across reconnects."""
        with self._lock:
            self._socketio = socketio
            self._app = app
            if self._started:
                return
            self._started = True
        socketio.start_background_task(self._drive)

    def _drive(self):
        """Background driver: re-arm the timed phases after a restart.

        M5: `choose` is now timed too, so a room rebuilt mid-ballot must resume its
        window (or its final-call sub-window) rather than hang with an open ballot.
        """
        with self._app.app_context():
            if self._phase == PHASE_CHOOSE and self.collective_ballot.get("open"):
                self._run_choose_window()
            elif self._phase == PHASE_KIOSK:
                # No timer to re-arm — the kiosk waits on Continue presses. But if a
                # crash landed between the last ack and the transition, finish now.
                if self._all_continued():
                    self._finish_kiosk()
            elif self._phase == PHASE_DISCUSS:
                self._resume_timed(PHASE_DISCUSS, self._enter_done)

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
        """Resume a timed phase after rehydration, firing immediately if it already elapsed."""
        if self._phase != expected_phase:
            return
        if self.phase_deadline_ts and self.phase_deadline_ts <= time.time():
            on_expire()
            return
        self._sleep_until(self.phase_deadline_ts)
        if self._phase == expected_phase:
            on_expire()

    def can_start(self) -> bool:
        """True while this room is still in its lobby state and has someone in it."""
        return self._phase == PHASE_WAITING and len(self.roster) >= 1

    def begin_choose(self):
        """Enter `choose`: open the ballot, keep chat locked, ask for the group's pick.

        Started explicitly by a student, NOT by the room filling up. Groups rarely
        arrive complete, and waiting on absent classmates strands the ones who did
        turn up. Whoever is in the room when this fires is the group, and the
        facilitator is told that headcount.
        """
        with self._lock:
            if self._phase != PHASE_WAITING:
                return
            self._phase = PHASE_CHOOSE
            # M5: the ballot is timed. Arm the main window here; the background
            # `_run_choose_window` task carries it through to final-call + resolve.
            self.phase_deadline_ts = time.time() + self.choose_seconds
            self.collective_ballot = {"open": True, "votes": {}, "final_call": False}
            self._persist({
                "phase": PHASE_CHOOSE,
                "phase_deadline_ts": self.phase_deadline_ts,
                "collective_ballot": self.collective_ballot,
            })

        self._broadcast_phase()
        self._emit("chat_locked", {"room_id": self.room_id, "locked": True, "reason": "choose"})
        self._emit("ballot_update", {
            "room_id": self.room_id,
            "open": True,
            "final_call": False,
            "tally": {},
            "candidates": [{"name": c.get("name", "")} for c in self._ballot_candidates()],
        })
        self._run_hook("on_choose_start")
        if self._socketio:
            self._socketio.start_background_task(self._run_choose_window)

    def _run_choose_window(self):
        """Background timer for the timed `choose` ballot (M5).

        Sleeps out the main window, opens the 30s final-call window (client beeps),
        then force-resolves whatever votes are in. Any earlier resolution — a
        majority reached, everyone voted, or an early-decision — has already closed
        the ballot, so this task then finds it closed and exits without forcing.
        """
        with self._app.app_context():
            self._sleep_until(self.phase_deadline_ts)
            if self._phase != PHASE_CHOOSE or not self.collective_ballot.get("open"):
                return
            self._enter_final_call()
            self._sleep_until(self.phase_deadline_ts)
            if self._phase == PHASE_CHOOSE and self.collective_ballot.get("open"):
                self.resolve_collective()

    def _enter_final_call(self):
        """Open the short final-call window: same ballot, a new tight deadline.

        Idempotent — a rehydrated room already in final-call keeps its deadline
        rather than restarting the countdown.
        """
        with self._lock:
            if (self._phase != PHASE_CHOOSE
                    or not self.collective_ballot.get("open")
                    or self.collective_ballot.get("final_call")):
                return
            self.collective_ballot["final_call"] = True
            self.phase_deadline_ts = time.time() + self.final_call_seconds
            self._persist({
                "collective_ballot": self.collective_ballot,
                "phase_deadline_ts": self.phase_deadline_ts,
            })
        # Re-broadcast the phase so clients pick up the new (tight) deadline, and
        # flag the final call so the UI can start the anxiety beep.
        self._broadcast_phase()
        self._emit("ballot_update", {
            "room_id": self.room_id,
            "open": True,
            "final_call": True,
            "tally": self._tally(self.collective_ballot.get("votes", {})),
            "candidates": [{"name": c.get("name", "")} for c in self._ballot_candidates()],
        })

    def _enter_discuss(self):
        """Kiosk cleared (or re-choice) → unlock chat and arm the single discuss timer."""
        with self._lock:
            # M6: the first pick now reaches discuss via the kiosk gate, so accept
            # the transition from either `choose` (legacy/re-choice) or `kiosk`.
            if self._phase not in (PHASE_CHOOSE, PHASE_KIOSK):
                return
            self._phase = PHASE_DISCUSS
            self.phase_deadline_ts = time.time() + self.discuss_seconds
            self._persist({"phase": PHASE_DISCUSS, "phase_deadline_ts": self.phase_deadline_ts})

        self._broadcast_phase()
        self._emit("chat_locked", {"room_id": self.room_id, "locked": False, "reason": "discuss"})

        self._sleep_until(self.phase_deadline_ts)
        if self._phase == PHASE_DISCUSS:
            self._enter_done()

    def _enter_done(self):
        """Discuss expired → wrap up. No scorecard: this exercise is not graded."""
        with self._lock:
            if self._phase == PHASE_DONE:
                return
            self._phase = PHASE_DONE
            self.phase_deadline_ts = None
            self._persist({"phase": PHASE_DONE, "phase_deadline_ts": None})

        self._broadcast_phase()
        self._emit("chat_locked", {"room_id": self.room_id, "locked": True, "reason": "done"})
        self._run_hook("on_wrapup")

    def _broadcast_phase(self):
        """Emit the room-wide `phase_change` after a persisted transition."""
        self._emit("phase_change", {
            "room_id": self.room_id,
            "phase": self._phase,
            "phase_deadline_ts": self.phase_deadline_ts,
            "server_now_ts": time.time(),
            "round": self.round,   # M7: lets the client show the round without a full snapshot
        })

    # ==================================================================
    # THE PICK (collective ballot)
    # ==================================================================
    def _ballot_candidates(self) -> List[Dict]:
        """The candidates a ballot may offer right now.

        On the first pick that is everyone. On a re-choice the group has already
        seen what happened to `chosen_candidate`, so it is out of the running —
        the question is which of the *remaining* candidates they now want.
        """
        return [c for c in self.candidates
                if c.get("name") and c.get("name") != self.chosen_candidate]

    def _valid_candidate(self, candidate: str) -> bool:
        # Same rule server-side as the emitted list, so a stale client cannot vote
        # for the candidate the re-choice just eliminated.
        return any(c.get("name") == candidate for c in self._ballot_candidates())

    def record_collective_vote(self, uid: str, candidate: str) -> bool:
        """Record ONE participant's vote (M5). Now a real tally, not first-past-post.

        The decision is made live in the app: each roster member votes (and may
        change their vote while the ballot is open). The ballot auto-resolves the
        moment a candidate holds a strict majority of the room, or everyone present
        has voted — otherwise it runs until the clock (and its final-call window)
        forces a resolve. `early_finalize` covers the "decide now" button.
        """
        resolve = False
        with self._lock:
            if not self.collective_ballot.get("open"):
                return False
            if uid not in self.roster_uids() or not self._valid_candidate(candidate):
                return False
            self.collective_ballot["votes"][uid] = candidate
            self._persist({"collective_ballot": self.collective_ballot})

            votes = self.collective_ballot["votes"]
            tally = self._tally(votes)
            roster_n = max(1, len(self.roster))
            leader = max(tally.values()) if tally else 0
            # Strict majority for one candidate, or the whole room has voted.
            resolve = leader * 2 > roster_n or len(votes) >= roster_n

        self._emit("ballot_update", {
            "room_id": self.room_id,
            "open": True,
            "final_call": bool(self.collective_ballot.get("final_call")),
            "tally": self._tally(self.collective_ballot.get("votes", {})),
            "candidates": [{"name": c.get("name", "")} for c in self._ballot_candidates()],
        })
        if resolve:
            self.resolve_collective()
        return True

    def early_finalize(self, uid: str) -> bool:
        """The group asks to decide before the clock runs out (M5).

        Resolves iff a MAJORITY of the roster has already cast a vote (quorum),
        taking the current plurality. Below quorum it is a no-op, so one impatient
        student can't end the decision for a room that hasn't weighed in yet.
        """
        with self._lock:
            if not self.collective_ballot.get("open") or uid not in self.roster_uids():
                return False
            votes = self.collective_ballot.get("votes", {})
            if len(votes) * 2 <= max(1, len(self.roster)):
                return False
        self.resolve_collective()
        return True

    def resolve_collective(self) -> Tuple[Optional[str], Dict]:
        """
        Tally the ballot, set the group's pick, close the ballot, persist, emit
        `collective_result`, then reveal the outcome via `on_pick_resolved`.

        Serves both the first pick (from `choose`) and a re-choice (from `discuss`);
        only the first advances the phase. Returns (winner, tally).
        """
        entering_discuss = False
        with self._lock:
            if not self.collective_ballot.get("open"):
                return self.chosen_candidate, self._tally(self.collective_ballot.get("votes", {}))

            votes = self.collective_ballot.get("votes", {})
            tally = self._tally(votes)
            winner = self._pick_winner(tally)

            self.chosen_candidate = winner
            self.collective_ballot["open"] = False
            self.collective_ballot["final_call"] = False
            self.forecast_shown_for = winner

            # M7: a wrong group pick is a strike. On the SECOND strike the exercise
            # is over — the un-chosen best option becomes the answer to reveal, and
            # the collective decision is recorded as failed (surfaced in grading).
            fields = {
                "chosen_candidate": self.chosen_candidate,
                "collective_ballot": self.collective_ballot,
                "forecast_shown_for": self.forecast_shown_for,
            }
            if winner and not self._pick_is_correct(winner):
                self.strikes += 1
                fields["strikes"] = self.strikes
                if self.strikes >= 2:
                    self.collective_failed = True
                    self.revealed_candidate = self._best_option()
                    fields["collective_failed"] = True
                    fields["revealed_candidate"] = self.revealed_candidate
            self._persist(fields)
            from_choose = self._phase == PHASE_CHOOSE

        self._emit("collective_result", {
            "room_id": self.room_id,
            "chosen_candidate": winner,
            "tally": tally,
        })
        self._emit("ballot_update", {"room_id": self.room_id, "open": False, "candidates": []})

        # M6: the FIRST pick goes through the kiosk gate — the shared outcome reveal
        # (`on_pick_resolved`) is deferred until the whole room has pressed Continue.
        # A re-choice inside discuss keeps revealing immediately (no gate).
        if from_choose:
            self._enter_kiosk()
        else:
            self._run_hook("on_pick_resolved")
        return winner, tally

    # ==================================================================
    # KIOSK GATE (M6 — individual advance, collective wait)
    # ==================================================================
    def _all_continued(self) -> bool:
        """True once every seated student has pressed Continue (empty room → False)."""
        seated = self.roster_uids()
        return bool(seated) and all(u in self.continue_acks for u in seated)

    def _enter_kiosk(self):
        """Pick resolved from `choose` → hold at the kiosk gate (chat locked).

        The outcome is already viewable per-client via the snapshot's `forecast_text`
        (so a student who presses Continue sees their reveal at once); the room-wide
        reveal message + discussion wait for `_finish_kiosk`.
        """
        with self._lock:
            if self._phase != PHASE_CHOOSE:
                return
            self._phase = PHASE_KIOSK
            self.phase_deadline_ts = None
            self.continue_acks = []
            self._kiosk_finishing = False
            self._persist({
                "phase": PHASE_KIOSK,
                "phase_deadline_ts": None,
                "continue_acks": self.continue_acks,
            })

        self._broadcast_phase()
        self._emit("chat_locked", {"room_id": self.room_id, "locked": True, "reason": "kiosk"})
        self._emit("kiosk_update", {
            "room_id": self.room_id, "acked": 0, "total": len(self.roster),
        })

    def record_continue(self, uid: str) -> bool:
        """Record one student pressing Continue. Finishes the kiosk once all have.

        Individual-level gate: the pressing client advances on its own; this only
        governs the SHARED transition. No timeout and no override — a student who
        never presses simply holds the room at the gate (by design).
        """
        finish = False
        with self._lock:
            if self._phase != PHASE_KIOSK or uid not in self.roster_uids():
                return False
            if uid not in self.continue_acks:
                self.continue_acks.append(uid)
                self._persist({"continue_acks": self.continue_acks})
            finish = self._all_continued()

        self._emit("kiosk_update", {
            "room_id": self.room_id,
            "acked": len(self.continue_acks),
            "total": len(self.roster),
        })
        if finish:
            self._finish_kiosk()
        return True

    def _finish_kiosk(self):
        """Everyone has continued → run the shared reveal, then open discussion."""
        with self._lock:
            if self._phase != PHASE_KIOSK or self._kiosk_finishing:
                return
            self._kiosk_finishing = True
        self._run_hook("on_pick_resolved")
        self._enter_discuss()

    def begin_next_round(self):
        """Start a full second round after a wrong first pick (M7).

        Invited by ACTR (the [REOPEN] signal). Unlike the old inline re-choice this
        is a real round: back to a timed `choose` ballot over the REMAINING
        candidates, through the kiosk, to a fresh reveal. Guarded to round 2 only —
        there is no third round; two strikes ends the exercise via the answer reveal.
        """
        with self._lock:
            if self._phase != PHASE_DISCUSS or self.round >= 2 or self.strikes >= 2:
                return
            self.round = 2
            self._phase = PHASE_CHOOSE
            self.phase_deadline_ts = time.time() + self.choose_seconds
            self.collective_ballot = {"open": True, "votes": {}, "final_call": False}
            self.reopen_allowed = False
            self._kiosk_finishing = False
            self._persist({
                "round": self.round,
                "phase": PHASE_CHOOSE,
                "phase_deadline_ts": self.phase_deadline_ts,
                "collective_ballot": self.collective_ballot,
                "reopen_allowed": False,
            })

        self._broadcast_phase()
        self._emit("chat_locked", {"room_id": self.room_id, "locked": True, "reason": "choose"})
        self._emit("ballot_update", {
            "room_id": self.room_id, "open": True, "final_call": False, "tally": {},
            "candidates": [{"name": c.get("name", "")} for c in self._ballot_candidates()],
        })
        self._run_hook("on_choose_start")
        if self._socketio:
            self._socketio.start_background_task(self._run_choose_window)

    def set_reopen_allowed(self, allowed: bool):
        """Record that a re-choice is PERMITTED — not that it is being offered.

        Set from the case-pack tally when the pick resolves. Splitting permission
        from timing is what stops the ballot appearing beside the outcome reveal,
        where it reads as a verdict on the group's first answer.
        """
        with self._lock:
            self.reopen_allowed = bool(allowed)
            self._persist({"reopen_allowed": self.reopen_allowed})

    def reopen_choice(self):
        """Reopen the ballot inside `discuss` so the group can choose again.

        A phase flag rather than a phase change: chat stays unlocked so students
        keep talking through the re-choice, which is where most of the learning
        happens. Called only when ACTR itself invites a re-choice at step 11 of
        the sequence, and only if the tally permits one.

        The candidate they already picked is dropped from the list — they have
        seen its outcome, so re-offering it makes the question meaningless.
        """
        with self._lock:
            if self._phase != PHASE_DISCUSS or not self.reopen_allowed:
                return
            self.collective_ballot = {"open": True, "votes": {}, "final_call": False}
            self._persist({"collective_ballot": self.collective_ballot})

        self._emit("ballot_update", {
            "room_id": self.room_id,
            "open": True,
            "final_call": False,
            "tally": {},
            "candidates": [{"name": c.get("name", "")} for c in self._ballot_candidates()],
        })

    @staticmethod
    def _tally(votes: Dict[str, str]) -> Dict[str, int]:
        """Count ballot entries per candidate name."""
        tally: Dict[str, int] = {}
        for cand in votes.values():
            tally[cand] = tally.get(cand, 0) + 1
        return tally

    def _pick_winner(self, tally: Dict[str, int]) -> Optional[str]:
        """Highest count; ties break on roster order so a rebuild yields the same winner."""
        if not tally:
            return None
        order = {c.get("name"): i for i, c in enumerate(self.candidates)}
        return max(tally.items(), key=lambda kv: (kv[1], -order.get(kv[0], 1_000_000)))[0]

    # ==================================================================
    # TURN-TAKING (bookkeeping ACTR reads; nothing here blocks)
    # ==================================================================
    def note_student_message(self, uid: str):
        """Register a student turn. Feeds the facts in `turn_context()`."""
        with self._lock:
            self.msgs_since_facilitator += 1
            self.last_message_ts = time.time()
            fields = {
                "msgs_since_facilitator": self.msgs_since_facilitator,
                "last_message_ts": self.last_message_ts,
            }
            if self.pending_go_around and uid:
                received = self.pending_go_around.setdefault("received", [])
                if uid not in received:
                    received.append(uid)
                    fields["pending_go_around"] = self.pending_go_around
            # M7: participation flag — who actually talks in the round-2 discussion.
            if self.round >= 2 and self._phase == PHASE_DISCUSS and uid and uid not in self.round2_speakers:
                self.round2_speakers.append(uid)
                fields["round2_speakers"] = self.round2_speakers
            self._persist(fields)

    def note_facilitator_spoke(self, go_around: bool):
        """Record that ACTR spoke, and who it is waiting on if it opened a go-around.

        `expected` is the roster at the moment of asking: a go-around asks everyone
        present, and a student who arrives afterwards was never asked, so ACTR is
        not left waiting on them.
        """
        with self._lock:
            self.last_facilitator_at = time.time()
            self.msgs_since_facilitator = 0
            self.pending_go_around = (
                {"asked_at": time.time(), "expected": self.roster_uids(), "received": []}
                if go_around else None
            )
            self._persist({
                "last_facilitator_at": self.last_facilitator_at,
                "msgs_since_facilitator": 0,
                "pending_go_around": self.pending_go_around,
            })

    def clear_go_around(self):
        """Stop tracking an outstanding go-around (answered, or plainly abandoned)."""
        with self._lock:
            if self.pending_go_around is None:
                return
            self.pending_go_around = None
            self._persist({"pending_go_around": None})

    def claim_facilitator(self) -> bool:
        """Take the facilitator slot for this room. False if a turn is already running.

        The caller must call `release_facilitator()` when done, whatever the
        outcome, or the room goes permanently quiet.
        """
        with self._lock:
            if self._facilitator_busy:
                return False
            self._facilitator_busy = True
            return True

    def release_facilitator(self):
        """Give the facilitator slot back. Safe to call when not held."""
        with self._lock:
            self._facilitator_busy = False

    def turn_context(self, addressed: bool = False, silence: bool = False) -> Dict:
        """The facts ACTR needs to judge whether it is its turn.

        These used to be gates. "Two of the three you asked have answered" is
        information, not a reason to make the room wait — a facilitator that knows
        it can hold *or* step in when the go-around has plainly been abandoned,
        where a blocking gate could only stall until a timeout fired.

        Names, not uids: this is rendered into the prompt and ACTR addresses people
        by name.
        """
        now = time.time()
        with self._lock:
            outstanding, answered = [], []
            if self.pending_go_around:
                expected = self.pending_go_around.get("expected") or []
                received = set(self.pending_go_around.get("received") or [])
                outstanding = [self.display_name(u) for u in expected if u not in received]
                answered = [self.display_name(u) for u in expected if u in received]
            return {
                "addressed": bool(addressed),
                "silence": bool(silence),
                "go_around_open": bool(self.pending_go_around),
                "outstanding": outstanding,
                "answered": answered,
                "msgs_since_facilitator": self.msgs_since_facilitator,
                "seconds_since_last_message": round(now - (self.last_message_ts or now), 1),
                "seconds_since_you_spoke": (
                    round(now - self.last_facilitator_at, 1) if self.last_facilitator_at else None
                ),
            }

    def in_discussion(self) -> bool:
        """True while the room is in `discuss` — the only phase ACTR reacts in."""
        return self._phase == PHASE_DISCUSS

    def spoke_last(self) -> bool:
        """True when ACTR posted more recently than any student.

        The silence timer only breaks a pause a STUDENT left. If ACTR spoke last,
        the room is waiting on them, not the other way round, and filling that gap
        would just be ACTR talking to itself.
        """
        with self._lock:
            if not self.last_facilitator_at:
                return False
            return self.last_facilitator_at > (self.last_message_ts or 0)


# =====================================================================
# MODULE-LEVEL REGISTRY (mirrors context_manager.get_or_create_context)
# =====================================================================
_exercises: Dict[str, ExerciseState] = {}
_registry_lock = RLock()


def get_or_create_exercise(room_id: str, config: Dict, socketio=None, app=None) -> ExerciseState:
    """
    Fetch the live ExerciseState for a room, rebuilding from Mongo on the first
    access after a restart. If `socketio`/`app` are supplied and the machine has
    not started, kicks it off so a rehydrated room resumes its discuss timer.
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
    """config_id is everything before the trailing `_{8hex}`."""
    return room_id.rsplit("_", 1)[0] if "_" in room_id else room_id
