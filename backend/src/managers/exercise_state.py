# @language  Python
# @updated   2026-08-04
# @changed   M9 three-round rework. New `solo` phase (round 0): each student privately picks a candidate
#            before the group ever talks; the room opens round 1 once everyone has submitted
#            (SOLO_GRACE_SECONDS force-advances a stalled room). New `debrief` phase (round 2): the
#            ONLY phase ACTR exists in (facilitator_active), entered unconditionally from the kiosk.
#            Removed: the strike machine (strikes/collective_failed/revealed_candidate/begin_next_round),
#            the second ballot, the dead reopen path, and grading entirely.
# @changed   Prior: Premise splits the general_info doc into student narrative + a credits/attribution block (_student_scenario trims the structural appendix; _split_scenario_credits pulls the byline/timing/institution lines into `credits` for a tiny footer). Also: kiosk entry broadcasts the reveal payload (chosen_candidate/verdict/forecast_text) so clients load the outcome live without a refresh; forecast_text_for matches names case/space-insensitively.
#            Prior: M7 lazy discuss clock (arm_discuss_timer starts on first student message so the prelude doesn't eat deliberation time); M5 `premise` block (general_info scenario); M3 pre-vote flow; M1+M2 role + role-sliced credentials; `abandon()` guard; chosen_verdict; grading; kiosk; timed ballot.
"""
In-process registry of live Manager-Exercise rooms.

Each matched room owns one `ExerciseState`. It holds the phase-machine state
(waiting → solo → discuss → choose → kiosk → done), the group's chosen candidate,
and the turn-taking bookkeeping that keeps ACTR from replying to every message. **Every**
mutation is written through to the durable `manager_exercise_sessions` collection
via `ManagerExerciseSession` BEFORE the corresponding socket emit, so a crash
between persist and emit is recoverable: on cold access the state is rebuilt from
Mongo (`get_or_create_exercise`) and any elapsed timed phase is fast-forwarded.

The exercise runs in three rounds, and which round you are in is the phase:

  round 0 (`solo`)      each student reads the brief + their role's credential
                        cards and commits to a candidate ALONE. Private: no
                        student ever sees another's pick, and the tally is never
                        sent to a client. This is what makes it possible to show,
                        afterwards, that the group moved someone off their answer.
  round 1 (`discuss`    the group deliberates and votes. NO FACILITATOR — see
          + `choose`)   `facilitator_active` below. The point of the exercise is
                        that a group reliably fails the hidden-profile trap, and a
                        group coached through pooling does not fail it.
  round 2 (`debrief`)   six months on, the outcome document lands and ACTR joins
                        for the first time. One conversation, no second ballot.

Students are never scored: there is no grading anywhere in this feature.

Timers run on `socketio.start_background_task` + `socketio.sleep` only
(async_mode='threading') — never time.sleep/asyncio.

This module depends ONLY on the session-model API. The AI-side work lives in
`ai_manager` and is wired in by the sockets layer through the callback hooks
below, keeping this file free of those imports.
"""
import logging
import re
import time
from threading import RLock
from typing import Callable, Dict, List, Optional, Tuple

from src.models.manager_exercise_session import ManagerExerciseSession

logger = logging.getLogger(__name__)

# The uploaded general-information doc usually continues past the student-facing
# narrative into structural / setup material — an org chart, the selection-committee
# roster, the finalist list, each candidate's current role. None of that belongs on
# the student premise screen: it's context for setting up the case (and some of it
# borders on the answer key). Trim the scenario at the first such section heading.
_BRIEF_CUTOFF = re.compile(
    r"^(organi[sz]ation chart|org chart|selection committee|finalists?\b|"
    r"current role|other direct reports|candidate profiles?)\b",
    re.IGNORECASE,
)


def _student_scenario(text: str) -> str:
    """Keep only the student-facing narrative: everything before the first structural
    section heading (org chart, committee, finalists, current roles). A doc with none
    of those markers is returned whole, so this never truncates a plain narrative."""
    lines = (text or "").split("\n")
    for i, ln in enumerate(lines):
        s = ln.strip()
        # A heading line is short and standalone; the length guard stops a stray
        # in-prose mention of e.g. "organisation chart" from cutting the brief.
        if 0 < len(s) <= 60 and _BRIEF_CUTOFF.match(s):
            return "\n".join(lines[:i]).strip()
    return (text or "").strip()


# The doc also carries a teaching-note / attribution block — the author byline,
# suggested timing, course + institution + brand lines, copyright. That is credit
# and instructor metadata, not the student brief, so it is split off and shown tiny
# and grey at the very bottom (a copyright line), not as scenario body.
_CREDIT_LINE = re.compile(
    r"^\s*by\s+[A-Z]"                     # author byline ("By Yaping Gong, ...")
    r"|suggested\s+timing"               # teaching-note logistics
    r"|©|\bcopyright\b|all rights reserved"
    r"|\bHKUST\b|ACTR\s+LABS",           # institution / brand attribution
    re.IGNORECASE,
)


def _split_scenario_credits(text: str):
    """Partition the (already structurally-trimmed) scenario into (narrative, credits).

    Blank-line chunks matching a credit/attribution signal go to `credits`; everything
    else stays narrative, in document order. Returns ("", "") safely on empty input."""
    narrative, credits = [], []
    for chunk in re.split(r"\n{2,}", text or ""):
        cs = chunk.strip()
        if not cs:
            continue
        (credits if _CREDIT_LINE.search(cs) else narrative).append(cs)
    return "\n\n".join(narrative).strip(), "\n".join(credits).strip()


# --- Phase constants --------------------------------------------------------
PHASE_WAITING = "waiting"
# M9 round 0: the private decision. Each student reads the brief + their credential
# cards and commits to a candidate alone, before anyone has spoken to anyone.
PHASE_SOLO = "solo"
PHASE_CHOOSE = "choose"
# M6: instructor-paced gate between the pick and the reveal. Each student presses
# Continue to advance their OWN screen (kiosk → time-skip → outcome); the room only
# moves on once every seated student has pressed it.
PHASE_KIOSK = "kiosk"
PHASE_DISCUSS = "discuss"
# M9 round 2: the facilitated debrief, after the outcome. The ONLY phase ACTR is
# ever invoked in — see `facilitator_active`.
PHASE_DEBRIEF = "debrief"
PHASE_DONE = "done"

# Ordered flow; used to fast-forward on rehydration. M9: strictly linear — the
# private decision precedes the group's, and every room ends in the debrief whether
# its pick was right or wrong. There is no second ballot and no branch.
PHASE_ORDER = [PHASE_WAITING, PHASE_SOLO, PHASE_DISCUSS, PHASE_CHOOSE,
               PHASE_KIOSK, PHASE_DEBRIEF, PHASE_DONE]

# Chat is unlocked for the two conversations only. `solo` is locked because the
# decision is private; `choose` is locked because the group speaks through the
# ballot buttons, not the chat, so the pick is a single deliberate act.
_UNLOCKED_PHASES = {PHASE_DISCUSS, PHASE_DEBRIEF}

# Round number per phase — the student-facing numbering (0 private, 1 group
# decision, 2 debrief), surfaced in the snapshot and the phase broadcast so the
# client can label the round without deriving it.
_PHASE_ROUND = {
    PHASE_WAITING: 0,
    PHASE_SOLO: 0,
    PHASE_DISCUSS: 1,
    PHASE_CHOOSE: 1,
    PHASE_KIOSK: 1,
    PHASE_DEBRIEF: 2,
    PHASE_DONE: 2,
}

# M7: the discuss clock is LAZY — it starts when discussion actually begins (the
# first student message), NOT when the phase opens, so a room that is still reading
# doesn't burn deliberation time. If a room stays silent this long the clock arms
# anyway, so a quiet room still advances to the vote instead of hanging.
PRELUDE_GRACE_SECONDS = 240

# M9: the solo round normally ends when every student has submitted their private
# pick — the same all-members gate the kiosk uses. The kiosk can afford no timeout
# because an instructor is pacing it; nobody is pacing this one, so a student who
# walks away must not strand the room forever.
SOLO_GRACE_SECONDS = 900

# --- Turn-taking ------------------------------------------------------------
# WITHIN the debrief there are no gates. ACTR is invoked on every student message
# and decides for itself, from the facts `turn_context()` hands it plus the worked
# example in the prompt. Gates were tried first and every one of them bought a
# guarantee at the cost of latency: a quorum that stalled the room for a minute
# when one student went quiet, a cooldown that muted ACTR for three turns whether
# or not it had anything to say.
#
# Three things remain structural, and none costs a wait:
#   * ACTR exists in ONE phase (`facilitator_active`). Round 1 does not reach the
#     model at all — no system prompt is built, no client is opened, no call is
#     made. This is deliberately not a prompt instruction to stay quiet: a
#     facilitator asked to be silent is still a facilitator in the room, and the
#     first group decision has to be uncontaminated to be worth debriefing;
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
        # Set when the room is torn down (e.g. a faculty lobby reset). A background
        # timer sleeping through a discuss/ballot window still holds a reference to
        # this instance; the flag stops it from persisting a resurrected session doc
        # for a room that has just been wiped.
        self._abandoned = False

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
        #   on_pick_resolved(state)  -> post the outcome document
        #   on_ballot_open(state)    -> the neutral "the ballot is open" notice
        #   on_debrief_start(state)  -> ACTR's opener, its first words of the session
        #   on_wrapup(state)         -> ACTR's closing message
        # Note there is no round-1 hook. That is the whole point: nothing in round 1
        # has an AI edge to fire on.
        self.hooks: Dict[str, Callable] = {}

        cfg = self._read_config()
        self.capacity: int = cfg["capacity"]
        self.candidates: List[Dict] = cfg["candidates"]
        self.discuss_seconds: float = cfg["discuss_seconds"]
        self.choose_seconds: float = cfg["choose_seconds"]
        self.final_call_seconds: float = cfg["final_call_seconds"]
        self.debrief_seconds: float = cfg["debrief_seconds"]

        if session_doc:
            self._load_from_doc(session_doc)
        else:
            self._phase = PHASE_WAITING
            self.phase_deadline_ts: Optional[float] = None
            self.roster: List[Dict] = []
            # M9 round 0: {uid: candidate}. Private — never tallied to a client, and
            # only ever leaves this object as the anonymous `solo_spread()` counts.
            self.solo_ballot: Dict = {"open": False, "votes": {}}
            self.collective_ballot: Dict = {"open": False, "votes": {}, "final_call": False}
            self.continue_acks: List[str] = []
            # M11: who has said the group is done deliberating and ready to vote.
            # A majority opens the ballot early; see `record_ready_to_vote`.
            self.ready_to_vote: List[str] = []
            self.chosen_candidate: Optional[str] = None
            self.forecast_shown_for: Optional[str] = None
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
            # M9: the round-2 debrief window. Falls back to the round-1 discussion
            # length so configs authored before this field existed keep running
            # without a migration.
            "debrief_seconds": float(
                c.get("debrief_minutes") or c.get("discuss_minutes") or 20
            ) * 60.0,
        }

    # ==================================================================
    # REHYDRATION
    # ==================================================================
    def _load_from_doc(self, doc: Dict):
        """Reconstruct mutable state from a persisted session document."""
        self._phase = doc.get("phase") or PHASE_WAITING
        self.phase_deadline_ts = doc.get("phase_deadline_ts")
        self.roster = list(doc.get("roster") or [])
        sb = doc.get("solo_ballot") or {}
        self.solo_ballot = {
            "open": bool(sb.get("open", False)),
            "votes": dict(sb.get("votes") or {}),
        }
        cb = doc.get("collective_ballot") or {}
        self.collective_ballot = {
            "open": bool(cb.get("open", False)),
            "votes": dict(cb.get("votes") or {}),
            "final_call": bool(cb.get("final_call", False)),
        }
        self.continue_acks = list(doc.get("continue_acks") or [])
        self.ready_to_vote = list(doc.get("ready_to_vote") or [])
        self.chosen_candidate = doc.get("chosen_candidate")
        self.forecast_shown_for = doc.get("forecast_shown_for")
        self.pending_go_around = doc.get("pending_go_around") or None
        self.last_facilitator_at = doc.get("last_facilitator_at")
        self.msgs_since_facilitator = int(doc.get("msgs_since_facilitator") or 0)
        self.last_message_ts = doc.get("last_message_ts")

    # ==================================================================
    # PUBLIC READ ACCESSORS
    # ==================================================================
    def phase(self) -> str:
        return self._phase

    @property
    def round(self) -> int:
        """The student-facing round number, DERIVED from the phase (0/1/2).

        A property rather than a stored field: the round and the phase were two
        representations of the same fact, and the old machine could advance one
        without the other. There is nothing to keep in sync now.
        """
        return _PHASE_ROUND.get(self._phase, 0)

    def chat_locked(self) -> bool:
        """Authoritative chat gate. True outside the two conversation phases."""
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
        """The uploaded outcome document for a candidate name ("" if unknown).

        Matches on a trimmed/case-folded name so a casing or whitespace difference
        between the chosen candidate and the authored candidate list can't silently
        drop the outcome (mirrors the normalization `_verdict_for` already uses)."""
        target = (name or "").strip().casefold()
        for c in self.candidates:
            if (c.get("name") or "").strip().casefold() == target:
                return c.get("forecast_text") or ""
        return ""

    def _role_names(self) -> List[str]:
        """The confidential role titles for this case (e.g. Marketing / Logistics Manager).

        Hidden-profile M1: these come straight from `case_pack["roles"]` (parsed from
        the uploaded docs). Each student is bound to one of them on entry so they only
        ever see that role's slice of the credentials. Empty list ⇒ no roles authored.
        """
        return [r for r in ((self.config.get("case_pack") or {}).get("roles") or []) if r]

    def role_for(self, uid: str) -> Optional[str]:
        """This student's assigned confidential role, or None if unassigned/unknown."""
        for e in self.roster:
            if e.get("uid") == uid:
                return e.get("role") or None
        return None

    def _premise_payload(self) -> Dict:
        """The shared scenario shown on the premise screen (M5).

        Drawn from the case's `general_info` — the shared brief every role already
        holds on paper, so it is safe for ALL students (unlike the per-role
        credential slices or the case_pack answer key, neither of which is ever
        sent). The viewer's role and the candidate names are already in the
        snapshot, so this carries only the scenario prose — trimmed to the student
        narrative (see `_student_scenario`); the raw doc's structural appendix is
        setup context, not something to put on the student's screen.
        """
        gi = self.config.get("general_info") or {}
        text = (gi.get("text") if isinstance(gi, dict) else "") or ""
        scenario, credits = _split_scenario_credits(_student_scenario(text.strip()))
        return {"scenario": scenario, "credits": credits}

    def student_view(self) -> str:
        """How students read their confidential material: 'cards' or 'case' (M10).

        Anything unrecognised (including a config saved before the field existed)
        reads as 'cards', which is what those configs already did.
        """
        return "case" if (self.config.get("student_view") == "case") else "cards"

    def case_for(self, uid: str) -> str:
        """This student's OWN role packet as a case document ("" if none) (M10).

        The `case` counterpart to `credentials_for`, and it carries the same
        confidentiality rule: only the viewer's own role's packet is ever returned,
        never another role's. Matching is case/space-insensitive because the packet's
        role is typed by the professor while the student's role comes from the case
        pack extraction, and a casing difference between the two would otherwise
        blank the screen of everyone holding that role.
        """
        role = (self.role_for(uid) or "").strip().casefold()
        if not role:
            return ""
        for p in (self.config.get("role_packets") or []):
            if (p.get("role") or "").strip().casefold() == role:
                return p.get("text") or ""
        return ""

    def credentials_for(self, uid: str) -> List[Dict]:
        """This student's confidential slice of every candidate's credentials.

        Hidden-profile M2: returns ONLY the viewer's own role's view of each
        candidate — the descriptive strengths / concerns / neutral phrases from
        `case_pack.options[].per_role[role]`. It deliberately never returns another
        role's slice, and never the `distinct_strengths` / `distinct_concerns`
        COUNTS — those counts are the answer key ("students must count them out
        loud"), so leaking them would hand over the decision. Empty until this
        student has been assigned a role. Candidates are keyed by name so the client
        can match them to the roster regardless of order.
        """
        role = self.role_for(uid)
        if not role:
            return []
        options = (self.config.get("case_pack") or {}).get("options") or []
        out: List[Dict] = []
        for o in options:
            view = (o.get("per_role") or {}).get(role) or {}
            out.append({
                "name": o.get("name", ""),
                "strengths": list(view.get("strengths") or []),
                "concerns": list(view.get("concerns") or []),
                "neutral": list(view.get("neutral") or []),
            })
        return out

    def _verdict_for(self, name: Optional[str]) -> Optional[str]:
        """The case-pack outcome verdict ('success'/'failure') for a candidate (M2).

        Safe to expose once the pick is revealed — the student is already reading
        that candidate's outcome document, which says the same thing in prose. It
        lets the client frame the reveal as a celebration vs an aftermath.
        """
        for o in ((self.config.get("case_pack") or {}).get("options") or []):
            if (o.get("name") or "").strip().lower() == (name or "").strip().lower():
                return o.get("outcome_verdict") or None
        return None

    def chosen_verdict(self) -> Optional[str]:
        """The verdict ('success'/'failure') of the hire the group actually made.

        Public because the debrief opener branches on it — a hire that worked out
        gets a different first question from one that didn't.
        """
        return self._verdict_for(self.chosen_candidate)

    def solo_spread(self) -> Dict[str, int]:
        """The round-0 picks as ANONYMOUS per-candidate counts (M9).

        The only way a solo vote ever leaves this object. The facilitator is handed
        the spread — "two came in on Sanjay, one on Priya" — because the gap between
        what people believed alone and what the group did is the debrief's best
        material. It is never handed WHO believed what: that is a private answer a
        student gave before the group could pressure them, and naming it in an open
        room is a different exercise from the one being run.
        """
        return self._tally(self.solo_ballot.get("votes", {}))

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
                # Hidden-profile M1: this viewer's own confidential role drives the
                # premise header ("You are the [role] Manager") and — in M2 — which
                # slice of each candidate's credentials the client is allowed to see.
                # Only the viewer's OWN role is sent; other seats' roles stay private.
                "your_role": self.role_for(uid),
                # M2: this viewer's role-sliced credential cards (own packet only —
                # never other roles' slices, never the distinct-count answer key).
                "your_credentials": self.credentials_for(uid),
                # M10: how this room presents that material, plus the viewer's OWN
                # role packet when one is authored. Sent alongside the cards rather
                # than instead of them, so the client can fall back to the deck when
                # a role has no packet without another round trip.
                "student_view": self.student_view(),
                "your_case": self.case_for(uid),
                # M5: the shared scenario prose for the premise screen (general_info).
                "premise": self._premise_payload(),
                "can_start": self.can_start(),
                # M9 round 0. `your_solo_vote` is this viewer's OWN private pick,
                # restored so a refresh mid-round-0 doesn't ask them to decide twice.
                # `solo_submitted`/`solo_total` are bare counts for the "waiting for
                # your group" line. There is deliberately NO solo tally here — see
                # `solo_spread`; sending it would leak the private round to every
                # client in the room.
                "your_solo_vote": self.solo_ballot.get("votes", {}).get(uid),
                "solo_submitted": len(self.solo_ballot.get("votes", {})),
                "solo_total": len(self.roster),
                "collective_open": bool(self.collective_ballot.get("open")),
                "you_voted_collective": uid in self.collective_ballot.get("votes", {}),
                # M5: live decision state so the client can render the running tally,
                # highlight this viewer's own vote, and flag the final-call window.
                "collective_final_call": bool(self.collective_ballot.get("final_call")),
                "collective_tally": self._tally(self.collective_ballot.get("votes", {})),
                "your_vote": self.collective_ballot.get("votes", {}).get(uid),
                # M6: kiosk progress so a (re)joining client renders the gate/wait
                # accurately and knows whether it has already pressed Continue.
                # M11: round-1 "we've decided" progress, so a reconnecting student
                # sees the count and knows whether their own press was recorded.
                "ready_count": len(self.ready_to_vote),
                "ready_total": len(self.roster),
                "you_are_ready": uid in self.ready_to_vote,
                "kiosk_acked": len(self.continue_acks),
                "kiosk_total": len(self.roster),
                "you_continued": uid in self.continue_acks,
                "chosen_candidate": self.chosen_candidate,
                "forecast_text": self.forecast_text_for(self.chosen_candidate) if revealed else None,
                # M2: verdict of the revealed pick, so the client frames the reveal
                # as a celebration (success) or an aftermath (failure).
                "chosen_verdict": self._verdict_for(self.chosen_candidate) if revealed else None,
                # Derived from the phase (0 private / 1 group decision / 2 debrief).
                "round": self.round,
            }

    # ==================================================================
    # PERSISTENCE (write-through)
    # ==================================================================
    def abandon(self):
        """Mark this state as torn down so lingering timers stop persisting it."""
        self._abandoned = True

    def _persist(self, fields: Dict):
        """Write mutated fields through to Mongo. Never raises into a handler/timer."""
        if self._abandoned:
            return
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
            # Hidden-profile M1: bind this seat to a confidential role. Roles are
            # handed out in join order, wrapping round-robin if more students than
            # roles (so it never runs dry) and staying empty when none are authored.
            roles = self._role_names()
            role = roles[len(self.roster) % len(roles)] if roles else None
            self.roster.append({
                "uid": uid,
                "name": name or f"Student {len(self.roster) + 1}",
                "role": role,
            })
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
            elif self._phase == PHASE_SOLO:
                # M9: solo has no deadline of its own — it ends when everyone has
                # submitted. A crash between the last submission and the transition
                # would otherwise hang the room, so settle that first, then restart
                # the grace watch for the students still to come.
                if self._all_solo_voted():
                    self._finish_solo()
                else:
                    self._socketio.start_background_task(self._solo_grace_watch)
            elif self._phase == PHASE_DISCUSS:
                # M3: discuss is the PRE-vote deliberation, so when its timer elapses
                # the next thing is the ballot, not the done screen.
                # M7: a room rebuilt while still unarmed (nobody has spoken yet) has no
                # deadline to resume — restart the grace watch instead of expiring now.
                if self.phase_deadline_ts is None:
                    self._socketio.start_background_task(self._prelude_grace_watch)
                else:
                    self._resume_timed(PHASE_DISCUSS, self.begin_choose)
            elif self._phase == PHASE_DEBRIEF:
                self._resume_timed(PHASE_DEBRIEF, self._enter_done)

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

    # ==================================================================
    # ROUND 0 — THE PRIVATE DECISION (M9)
    # ==================================================================
    def begin_solo(self):
        """Enter `solo`: each student decides alone, before the group exists.

        This is where a room now lands when someone presses Start (it used to go
        straight to `discuss`). Chat stays locked and NO hook fires — there is no AI
        edge here to fire on, which is the structural half of keeping the facilitator
        out of the group's first decision.

        Untimed: the round ends when every student has submitted. `_solo_grace_watch`
        is the backstop for the student who never does.
        """
        with self._lock:
            if self._phase != PHASE_WAITING:
                return
            self._phase = PHASE_SOLO
            self.phase_deadline_ts = None
            self.solo_ballot = {"open": True, "votes": {}}
            self._persist({
                "phase": PHASE_SOLO,
                "phase_deadline_ts": None,
                "solo_ballot": self.solo_ballot,
            })

        self._broadcast_phase()
        self._emit("chat_locked", {"room_id": self.room_id, "locked": True, "reason": "solo"})
        if self._socketio:
            self._socketio.start_background_task(self._solo_grace_watch)

    def _all_solo_voted(self) -> bool:
        """True once every seated student has submitted a private pick (empty room → False)."""
        seated = self.roster_uids()
        votes = self.solo_ballot.get("votes", {})
        return bool(seated) and all(u in votes for u in seated)

    def record_solo_vote(self, uid: str, candidate: str) -> bool:
        """Record ONE student's private round-0 pick. Opens round 1 once all are in.

        Deliberately unlike `record_collective_vote`: no tally is broadcast and no
        majority resolves anything. The only thing the room learns is HOW MANY have
        submitted, so the others know what they are waiting on without learning what
        anyone chose. A student may change their pick until the round closes.
        """
        finish = False
        with self._lock:
            if not self.solo_ballot.get("open"):
                return False
            if uid not in self.roster_uids() or not self._valid_candidate(candidate):
                return False
            self.solo_ballot["votes"][uid] = candidate
            self._persist({"solo_ballot": self.solo_ballot})
            finish = self._all_solo_voted()

        # Counts only. See `solo_spread` for why the tally never goes to a client.
        self._emit("solo_update", {
            "room_id": self.room_id,
            "submitted": len(self.solo_ballot.get("votes", {})),
            "total": len(self.roster),
        })
        if finish:
            self._finish_solo()
        return True

    def _finish_solo(self):
        """Close the private round and open the group deliberation."""
        with self._lock:
            if self._phase != PHASE_SOLO:
                return
            self.solo_ballot["open"] = False
            self._persist({"solo_ballot": self.solo_ballot})
        self.begin_discuss()

    def _solo_grace_watch(self):
        """Backstop: force round 1 open if someone never submits a private pick.

        Whoever has not decided by now keeps no vote — they simply have nothing
        recorded for round 0. Holding the whole room on one absent student is worse
        than losing one data point.
        """
        with self._app.app_context():
            self._socketio.sleep(SOLO_GRACE_SECONDS)
            if self._phase == PHASE_SOLO:
                self._finish_solo()

    def begin_choose(self):
        """Enter `choose`: open the timed ballot and lock chat for the vote.

        M3: this now follows the pre-vote deliberation rather than the lobby — it is
        reached when the `discuss` timer lapses (`_run_discuss_window`), so the vote
        clock only starts once the group has actually deliberated. Whoever is in the
        room at that point is the group.
        """
        with self._lock:
            if self._phase != PHASE_DISCUSS:
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
        # A neutral "the ballot is open" notice, NOT a facilitator turn. The line
        # itself is the same one ACTR used to post; posting it under ACTR's name made
        # the facilitator present at the group's first decision for the sake of one
        # sentence the ballot screen already says.
        self._run_hook("on_ballot_open")
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

    def begin_discuss(self):
        """Enter ROUND 1: the group's own deliberation. No facilitator.

        Arrives from `solo` — everyone has now committed privately, so the group can
        talk without anyone's answer being anchored by the room. The students pool
        their role-sliced credentials and reason toward a hire; when the timer lapses
        the ballot opens (`begin_choose`).

        No hook fires here. This used to run `on_discuss_start`, which posted ACTR's
        opener; that is exactly the contamination this round now exists without.

        Non-blocking: the countdown runs on a background task like the choose window.
        """
        with self._lock:
            if self._phase != PHASE_SOLO:
                return
            self._phase = PHASE_DISCUSS
            # M7: leave the clock UNARMED (deadline None). It starts on the first
            # student message (arm_discuss_timer), so a group still settling in
            # doesn't burn deliberation time; the grace watch below arms it anyway if
            # the room stays silent.
            self.phase_deadline_ts = None
            self.ready_to_vote = []
            self._persist({
                "phase": PHASE_DISCUSS,
                "phase_deadline_ts": None,
                "ready_to_vote": self.ready_to_vote,
            })

        self._broadcast_phase()
        self._emit("chat_locked", {"room_id": self.room_id, "locked": False, "reason": "discuss"})
        if self._socketio:
            self._socketio.start_background_task(self._prelude_grace_watch)

    def record_ready_to_vote(self, uid: str) -> bool:
        """One student signals the group is done deliberating (M11).

        Opens the ballot once a MAJORITY of the roster has pressed it — the same
        quorum `early_finalize` uses on the ballot itself, and for the same reason:
        one impatient student must not be able to end a discussion the rest of the
        room is still having. Below quorum this only broadcasts the count, so the
        others can see someone is waiting on them.

        Pressing again un-presses, because "we're ready" is a position a student can
        change while the others talk them out of it.

        Not requiring EVERYONE (unlike the kiosk gate) is deliberate: this is an
        optimisation on a phase that already ends on its own clock, so a single idle
        student should cost the group their early exit, not strand them entirely.
        """
        open_ballot = False
        with self._lock:
            if self._phase != PHASE_DISCUSS or uid not in self.roster_uids():
                return False
            if uid in self.ready_to_vote:
                self.ready_to_vote.remove(uid)
            else:
                self.ready_to_vote.append(uid)
            self._persist({"ready_to_vote": self.ready_to_vote})
            open_ballot = len(self.ready_to_vote) * 2 > max(1, len(self.roster))

        self._emit("ready_update", {
            "room_id": self.room_id,
            "ready": len(self.ready_to_vote),
            "total": len(self.roster),
        })
        if open_ballot:
            self.begin_choose()
        return True

    def _prelude_grace_watch(self):
        """Fallback: arm the discuss clock after the grace window if it is still
        unarmed, so a room where nobody types still advances to the vote."""
        with self._app.app_context():
            self._socketio.sleep(PRELUDE_GRACE_SECONDS)
            if self._phase == PHASE_DISCUSS and self.phase_deadline_ts is None:
                self.arm_discuss_timer()

    def arm_discuss_timer(self):
        """Start the discuss countdown the first time discussion actually begins (M7).

        Idempotent: only the first call (a student message, or the grace watch) arms
        it; every later call no-ops. Broadcasts the phase so clients pick up the
        countdown, then hands off to the window task that opens the ballot on expiry.
        """
        with self._lock:
            if self._phase != PHASE_DISCUSS or self.phase_deadline_ts is not None:
                return
            self.phase_deadline_ts = time.time() + self.discuss_seconds
            self._persist({"phase_deadline_ts": self.phase_deadline_ts})
        self._broadcast_phase()
        if self._socketio:
            self._socketio.start_background_task(self._run_discuss_window)

    def _run_discuss_window(self):
        """Background timer for the pre-vote deliberation → open the ballot on expiry."""
        with self._app.app_context():
            self._sleep_until(self.phase_deadline_ts)
            if self._phase == PHASE_DISCUSS:
                self.begin_choose()

    # ==================================================================
    # ROUND 2 — THE FACILITATED DEBRIEF (M9)
    # ==================================================================
    def _enter_debrief(self):
        """Enter ROUND 2: the outcome has landed and ACTR joins for the first time.

        UNCONDITIONAL — reached from the kiosk whether the group's hire worked out or
        not. Under the old strike machine a correct pick ended the session on the spot,
        so the groups that read the case best were the only ones who never got a
        debrief. The opener branches on the verdict instead (`on_debrief_start`).

        This is the one phase `facilitator_active` returns True for. Chat unlocks and
        the debrief clock arms immediately (unlike round 1's lazy clock — the room is
        already talking by the time it gets here).
        """
        with self._lock:
            if self._phase != PHASE_KIOSK:
                return
            self._phase = PHASE_DEBRIEF
            self.phase_deadline_ts = time.time() + self.debrief_seconds
            self._persist({
                "phase": PHASE_DEBRIEF,
                "phase_deadline_ts": self.phase_deadline_ts,
            })

        self._broadcast_phase()
        self._emit("chat_locked", {"room_id": self.room_id, "locked": False, "reason": "debrief"})
        self._run_hook("on_debrief_start")
        if self._socketio:
            self._socketio.start_background_task(self._run_debrief_window)

    def _run_debrief_window(self):
        """Background timer for the debrief. The BACKSTOP, not the usual ending.

        ACTR normally closes the session itself when the conversation has run its
        course (`end_debrief`, driven by the end marker in its reply). This only
        catches a room that never converges.
        """
        with self._app.app_context():
            self._sleep_until(self.phase_deadline_ts)
            if self._phase == PHASE_DEBRIEF:
                self._enter_done()

    def end_debrief(self):
        """ACTR has judged the debrief finished → close the session.

        Called from the sockets layer when a facilitator reply carries the end
        marker. Guarded to the debrief phase so a late marker can't reopen or
        re-close a room that has already moved on.
        """
        if self._phase != PHASE_DEBRIEF:
            return
        self._enter_done()

    def _enter_done(self):
        """The session is over. No scorecard: this exercise is not graded."""
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
            "round": self.round,   # lets the client label the round without a full snapshot
        })

    # ==================================================================
    # THE PICK (collective ballot)
    # ==================================================================
    def _ballot_candidates(self) -> List[Dict]:
        """Every named candidate. Shared by the round-0 private pick and the group ballot.

        There is one group decision now, so nothing is ever eliminated — this used to
        drop `chosen_candidate` for the re-choice a second round offered.
        """
        return [c for c in self.candidates if c.get("name")]

    def _valid_candidate(self, candidate: str) -> bool:
        # Same rule server-side as the emitted list, so a stale or hand-rolled client
        # cannot vote for something that was never on the ballot.
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
        `collective_result`, then hold at the kiosk gate. Returns (winner, tally).

        There is exactly one group decision now, so this no longer scores the pick
        against the answer key — whether the group was right shows up where it should,
        in the outcome document they read six months on.
        """
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
            self._persist({
                "chosen_candidate": self.chosen_candidate,
                "collective_ballot": self.collective_ballot,
                "forecast_shown_for": self.forecast_shown_for,
            })

        self._emit("collective_result", {
            "room_id": self.room_id,
            "chosen_candidate": winner,
            "tally": tally,
        })
        self._emit("ballot_update", {"room_id": self.room_id, "open": False, "candidates": []})

        # M6: the outcome reveal (`on_pick_resolved`) is deferred until the whole room
        # has pressed Continue, so everyone reads it at the same moment.
        self._enter_kiosk()
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
        # Carry the reveal payload on the kiosk broadcast. It is viewer-independent
        # (keyed on the chosen candidate), and no full snapshot is pushed on a live
        # phase change, so without this a client that doesn't refresh sits forever on
        # "Loading the outcome…" — the snapshot's forecast_text never reaches it.
        self._emit("kiosk_update", {
            "room_id": self.room_id, "acked": 0, "total": len(self.roster),
            "chosen_candidate": self.chosen_candidate,
            "chosen_verdict": self._verdict_for(self.chosen_candidate),
            "forecast_text": self.forecast_text_for(self.chosen_candidate),
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
        """Everyone continued → post the shared reveal, then open the debrief.

        No branch: right or wrong, the room goes to round 2. The old machine ended a
        correct pick here, which meant the groups who read the case best were the only
        ones who never got debriefed.
        """
        with self._lock:
            if self._phase != PHASE_KIOSK or self._kiosk_finishing:
                return
            self._kiosk_finishing = True
        self._run_hook("on_pick_resolved")
        self._enter_debrief()

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

    def facilitator_active(self) -> bool:
        """The ONE phase ACTR exists in. Round 1 never reaches the model.

        Every facilitator entry point checks this — the reactive turn, the silence
        watcher, and the post-model re-check after a slow call. Round 1 is the group's
        own decision, and it is kept that way by never invoking the facilitator at
        all rather than by asking it to stay quiet: a facilitator told to hold is
        still a facilitator in the room, one prompt regression away from speaking,
        and the whole exercise depends on that first decision being untouched.
        """
        return self._phase == PHASE_DEBRIEF

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
    """Drop a room's in-memory state (durable copy stays in Mongo).

    Marks the dropped state abandoned first, so a background timer still sleeping
    through a discuss/ballot window can't persist a resurrected doc for the room.
    """
    with _registry_lock:
        state = _exercises.pop(room_id, None)
    if state is not None:
        state.abandon()


def _config_id_from_room(room_id: str) -> str:
    """config_id is everything before the trailing `_{8hex}`."""
    return room_id.rsplit("_", 1)[0] if "_" in room_id else room_id
