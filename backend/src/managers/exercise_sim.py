# @language  Python
# @updated   2026-08-19
# @changed   New file: a whole manager-exercise room played by model students inside the server, so a
#            professor can press Test on their config and watch ACTR work their own case pack instead
#            of booking three people to find out.
"""A test room: every seat played by a model, driven through the real phase machine.

WHY THIS IS NOT A MOCK
    The driver calls the same `ExerciseState` methods the socket handlers call —
    `note_participant`, `begin_solo`, `record_solo_vote`, `end_discussion`,
    `record_group_choice`, `record_continue` — and posts through the same message
    path a student's socket does. The phases advance because the machine advanced
    them, the timers are the real timers, ACTR is invoked by the real hooks, and
    every message persists to `group_chat_messages` like any other room's.

    So what a professor watches is what their class will get. The only fiction is
    who is typing.

WHAT THE STUDENTS KNOW
    Exactly what a browser in that seat would be sent: `snapshot_for(uid)`, and
    nothing else. The packet, the role, the candidate list and the shared premise
    all arrive that way. A bot cannot argue from a card it was never dealt, which
    is the whole point of a hidden-profile exercise — a simulator that cheated here
    would make every case pack look like it works.

WHERE IT RUNS
    Inside a `socketio.start_background_task`, so `sleep` is the cooperative one the
    caller passes in. Never call `time.sleep` from here: the server is threading-mode
    and a real sleep blocks a worker for the length of the run.
"""
import logging
import os
import random
import re
from typing import Callable, Dict, List, Optional

from src.managers import ai_manager

logger = logging.getLogger(__name__)

# Ordinary first names, distinct enough that a go-around is legible in the
# transcript, since ACTR addresses people by name and the professor is reading it.
BOT_NAMES = ["Ava", "Ben", "Cara", "Dan", "Elle", "Finn", "Gina", "Hugo"]

# Students are the cheap half of the run — the expensive half is ACTR, which is
# whatever model the professor configured. Overridable for tuning.
STUDENT_MODEL = os.getenv("SIM_STUDENT_MODEL", "claude-haiku-4-5-20251001")
STUDENT_MAX_TOKENS = 150

# Seconds. These pace the room so the professor can read it, and so ACTR gets a
# turn: it is invoked on every student message and usually decides to hold, so a
# room that types instantly would never leave it a gap to speak into.
DISCUSS_GAP = 5.0
ACTR_WAIT = 18.0
THINK_AFTER_ACTR = 3.0

# Round 1 is not the point of a test run — the professor is here to see the
# debrief — so the group deliberates briefly and then the decider closes it.
DISCUSS_TURNS = 6

# Hard stops. A test run is unattended and costs money per turn, so every loop
# here is bounded by something other than the room agreeing to end.
MAX_DEBRIEF_TURNS = 40
# Loop passes, not turns: a room where every student passes never spends a turn,
# so this is what stops a silent debrief spinning until the process dies.
MAX_DEBRIEF_SPINS = 400
PHASE_WAIT_SECONDS = 90

FACILITATOR = "ACTR"

STUDENT_SYSTEM = """You are {name}, a graduate management student taking part in a \
group hiring exercise with {others}. Stay in character and never break frame.

THE SITUATION EVERYONE SHARES
{premise}

WHAT ONLY YOU KNOW
You are the {role}. The packet below is confidential to you and is the ONLY thing you \
know about the candidates. Nobody else has read it, and you have not read theirs:

{packet}

HOW TO BEHAVE
- Write like a student typing in a group chat: short, lowercase, casual, often a fragment.
- One message. Never more than two sentences.
- Answer what was actually asked. If someone asks you something, respond to THAT.
- Only state things from your packet above. Never invent a fact about a candidate.
- Do not narrate the exercise, mention packets or roles, or write anyone else's lines.
- If you genuinely have nothing to add right now, reply with exactly: PASS
"""

DISCUSS_TASK = """Your group has to agree on ONE person to hire, and you are talking it \
through now. Say what you think, react to what the others have said, and push for whoever \
your packet supports. Write your next message, or reply PASS."""

DEBRIEF_TASK = """The hire has been made and you have all read how it turned out. A \
facilitator called ACTR is now walking your group through what happened. Answer ACTR \
directly and honestly, and react to your groupmates. Write your next message, or reply \
PASS."""

PICK_TASK = """Before anyone talks, you must commit to ONE candidate on your own, using \
only your own packet. Reply with the candidate's name EXACTLY as written and nothing \
else. Options: {options}"""

HIRE_TASK = """You are entering the group's hire on everyone's behalf. Read the \
discussion above and reply with the name the group settled on, EXACTLY as written and \
nothing else. Options: {options}"""


def _render_packet(snapshot: Dict) -> str:
    """The confidential material this seat holds, as the student would read it.

    Two shapes exist (`student_view`): a case document authored per role, or the
    role-sliced credential cards. Preferring the document when there is one mirrors
    what the client renders, so the bot argues from the same text a human in that
    seat would be looking at — and a professor testing the "case" view sees their
    case being used rather than cards they turned off.
    """
    if snapshot.get("student_view") == "case" and (snapshot.get("your_case") or "").strip():
        return snapshot["your_case"].strip()
    lines = []
    for card in snapshot.get("your_credentials") or []:
        good = "; ".join(card.get("strengths") or []) or "(nothing noted)"
        bad = "; ".join(card.get("concerns") or []) or "(nothing noted)"
        other = "; ".join(card.get("neutral") or [])
        lines.append(f"  {card.get('name')}\n    good: {good}\n    bad:  {bad}"
                     + (f"\n    also: {other}" if other else ""))
    return "\n".join(lines) or "  (no case material was sent to this seat)"


class SimStudent:
    """One seat. Holds a uid and the snapshot the room sends it, and nothing else."""

    def __init__(self, name: str, uid: str):
        self.name = name
        self.uid = uid
        self.spoke_at = 0          # transcript length when this bot last talked

    def _system(self, state, others: str) -> str:
        snapshot = state.snapshot_for(self.uid)
        premise = (snapshot.get("premise") or {}).get("scenario") or ""
        return STUDENT_SYSTEM.format(
            name=self.name, others=others or "your group",
            role=snapshot.get("your_role") or "manager",
            premise=premise[:3000] or "(no shared brief was sent)",
            packet=_render_packet(snapshot),
        )

    def _ask(self, state, transcript: str, task: str, others: str,
             max_tokens: int = STUDENT_MAX_TOKENS, temperature: float = 1.0) -> str:
        """One model call in this student's voice. '' on any failure.

        Failures are swallowed on purpose: one dead student must not abort a run the
        professor is watching, and a room that carries on a seat short is still a
        readable answer to "what does my debrief look like".
        """
        client = ai_manager._get_client()
        if client is None:
            return ""
        try:
            msg = client.messages.create(
                model=STUDENT_MODEL, max_tokens=max_tokens, temperature=temperature,
                system=[{"type": "text", "text": self._system(state, others),
                         "cache_control": {"type": "ephemeral"}}],
                messages=[{"role": "user",
                           "content": f"The conversation so far:\n{transcript}\n\n{task}"}],
            )
        except Exception as e:  # noqa: BLE001
            logger.warning("sim student %s failed: %s", self.name, e)
            return ""
        text = ai_manager._text_from_message(msg).strip()
        # Models prefix their own name even when told not to; the client already
        # renders the sender, so it reads as a bug in the transcript.
        return re.sub(r"^%s\s*:\s*" % re.escape(self.name), "", text).strip()

    def speak(self, state, transcript: str, task: str, others: str) -> Optional[str]:
        text = self._ask(state, transcript, task, others)
        if not text or text.upper().rstrip(".!") == "PASS":
            return None
        return text

    def choose(self, state, transcript: str, task_template: str, others: str) -> Optional[str]:
        """A candidate name, validated against the ones the room actually offers.

        Free text is not trusted: `record_solo_vote` and `record_group_choice` both
        reject an unknown candidate silently, which would hang the run on a phase
        that never completes. An unmatched answer falls back to a valid one.
        """
        snapshot = state.snapshot_for(self.uid)
        options = [c.get("name") for c in snapshot.get("candidates") or [] if c.get("name")]
        if not options:
            return None
        answer = self._ask(state, transcript, task_template.format(options=", ".join(options)),
                           others, max_tokens=30, temperature=0.4)
        for name in options:
            if name.lower() in (answer or "").lower():
                return name
        return random.choice(options)


def _transcript(messages: List[Dict], limit: int = 40) -> str:
    recent = messages[-limit:]
    return "\n".join(f"{m.get('sender')}: {m.get('text')}" for m in recent) or "(nothing said yet)"


def _pick_speaker(students: List[SimStudent], messages: List[Dict]) -> SimStudent:
    """Who talks next: whoever ACTR named, else whoever has been quiet longest.

    Without the naming rule a direct question gets answered by whoever happens to
    be next in the list, and a go-around never completes — which would make the
    facilitator look broken in a transcript where the harness was at fault.
    """
    last_actr = ""
    for m in reversed(messages):
        if m.get("sender") == FACILITATOR:
            last_actr = m.get("text") or ""
            break
    depth = len(messages)
    named = [s for s in students if re.search(r"\b%s\b" % re.escape(s.name), last_actr)]
    if len(named) == 1 and named[0].spoke_at < depth:
        return named[0]
    return max(students, key=lambda s: depth - s.spoke_at)


def run_test_room(state, post: Callable, sleep: Callable, messages: Callable,
                  bots: int = 3) -> None:
    """Play one whole room. Blocking — call it from a background task.

    `post(uid, text)` must take the same path a student's socket message does
    (persist, broadcast, arm the clock, wake the facilitator); `messages()` returns
    the room transcript so far; `sleep(seconds)` is the cooperative sleep.
    """
    def wait_for(phases, seconds=PHASE_WAIT_SECONDS) -> bool:
        """Block until the SERVER puts the room in one of `phases`.

        The driver never advances a phase on its own guess. A gate that does not
        open is the finding the professor pressed Test to discover, so it is left
        to time out and be reported rather than routed around.
        """
        waited = 0.0
        while waited < seconds:
            if state.phase() in phases:
                return True
            sleep(1.0)
            waited += 1.0
        logger.warning("sim room %s stuck in %s waiting for %s",
                       state.room_id, state.phase(), phases)
        return False

    count = max(1, min(int(bots or 3), len(BOT_NAMES)))
    students = [SimStudent(BOT_NAMES[i], f"sim-{BOT_NAMES[i].lower()}-{random.randrange(16**6):06x}")
                for i in range(count)]
    names = ", ".join(s.name for s in students)

    # Seats are claimed in order, not concurrently: the roster is built in join
    # order and the FIRST seat is the decider, so a race here would leave the
    # driver unsure which bot has to close round 1 and enter the hire.
    for s in students:
        state.note_participant(s.uid, s.name)

    # ---- round 0: the private pick ------------------------------------
    if state.phase() == "waiting":
        state.begin_solo()
    if not wait_for({"solo"}, 30):
        return
    for s in students:
        pick = s.choose(state, _transcript(messages()), PICK_TASK, names)
        if pick:
            state.record_solo_vote(s.uid, pick)
        sleep(0.5)

    # ---- round 1: the group's own decision, unfacilitated ---------------
    if not wait_for({"discuss"}, 60):
        return
    spoken = 0
    while spoken < DISCUSS_TURNS and state.phase() == "discuss":
        msgs = messages()
        speaker = _pick_speaker(students, msgs)
        text = speaker.speak(state, _transcript(msgs), DISCUSS_TASK, names)
        speaker.spoke_at = len(msgs)
        if text:
            post(speaker.uid, text)
            spoken += 1
        sleep(DISCUSS_GAP)

    decider = next((s for s in students if s.uid == state.decider_uid()), students[0])
    if state.phase() == "discuss":
        state.end_discussion(decider.uid)
    if wait_for({"choose"}, 30):
        hire = decider.choose(state, _transcript(messages()), HIRE_TASK, names)
        if hire:
            state.record_group_choice(decider.uid, hire)

    # ---- the kiosk gate -------------------------------------------------
    if wait_for({"kiosk"}, 45):
        for s in students:
            state.record_continue(s.uid)
            sleep(0.4)

    # ---- round 2: the facilitated debrief -------------------------------
    if not wait_for({"debrief"}, 60):
        return

    # ACTR's opener is model-written and posted from a background task, so it lands
    # seconds after the phase does. A student who talks first opens the debrief
    # themselves and leaves the facilitator reacting to a conversation it never
    # started — which is not what this room does live.
    waited = 0.0
    while waited < 45 and state.phase() == "debrief":
        msgs = messages()
        if msgs and msgs[-1].get("sender") == FACILITATOR:
            break
        sleep(1.0)
        waited += 1.0

    turns = 0
    idle = 0.0
    # Two counters, because they stop different failures. `turns` caps what the run
    # costs. `spins` caps how long it can hang: every student passing forever
    # advances no turn at all, and if the professor set the debrief timer to zero
    # there is no server-side backstop to end the phase either.
    spins = 0
    while state.phase() == "debrief" and turns < MAX_DEBRIEF_TURNS and spins < MAX_DEBRIEF_SPINS:
        spins += 1
        msgs = messages()
        if not msgs:
            sleep(1.0)
            continue
        last_sender = msgs[-1].get("sender")
        # A student spoke last: leave the floor to ACTR before piling on. It is
        # asked on every student message and usually holds, so barging in at once
        # would mean it never got a turn at all.
        if last_sender not in (FACILITATOR,) and not str(last_sender).startswith("\U0001F4CA"):
            if idle < ACTR_WAIT:
                sleep(1.0)
                idle += 1.0
                continue
        else:
            sleep(THINK_AFTER_ACTR)
        idle = 0.0
        speaker = _pick_speaker(students, msgs)
        text = speaker.speak(state, _transcript(msgs), DEBRIEF_TASK, names)
        speaker.spoke_at = len(msgs)
        if text:
            post(speaker.uid, text)
            turns += 1
        else:
            # A pass is a real silence, and the room should be allowed to have one:
            # it is the condition ACTR's silence watcher exists for.
            sleep(4.0)

    logger.info("sim room %s finished in phase=%s after %d debrief turns",
                state.room_id, state.phase(), turns)
