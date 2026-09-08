# @language  Python
# @updated   2026-09-08
# @changed   Sim students can now run on a different PROVIDER, not just a different Claude model:
#            `_ask` dispatches on STUDENT_MODEL's prefix to `_ask_openai` ("gpt*" — LangChain's
#            ChatOpenAI, the same pattern video/scoring.py already calls successfully) or
#            `_ask_anthropic` (everything else, the raw Anthropic SDK as before). STUDENT_MODEL
#            default is now "gpt-4o": two different Claude models (haiku-4-5-20251001, then
#            sonnet-4-6) both failed silently, so this isolates whether the fault is Anthropic-side
#            specifically. Switching back later is just the env var / default string.
# @changed   Prior: Diagnosing every sim-student call failing silently (a stuck test run: private picks
#            recorded, then nothing — the discuss loop only ever said why after the WHOLE discuss
#            window timed out). Two changes: STUDENT_MODEL temporarily pinned to "claude-sonnet-4-6"
#            (the model FACILITATOR_MODEL already uses successfully) instead of
#            "claude-haiku-4-5-20251001", to isolate whether that model id is the fault; and the
#            discuss loop now bails after FAIL_FAST_ATTEMPTS consecutive real failures
#            (`speaker.last_error` set, not a plain PASS) instead of waiting out the full window, so
#            a broken run says why within seconds instead of up to 20 minutes.
# @changed   Prior: Every hardcoded sim-student prompt (STUDENT_SYSTEM, DISCUSS_TASK, HIRE_TASK, PICK_TASK,
#            the misleading/recall overrides — all written for the hiring template only) moved to
#            Mongo via the new `tester_templates.get(state.template())`, read fresh in `_system`,
#            `task_for` (now takes `state`), and `choose` (now takes a template field name like
#            "pick_task"/"decision_task" instead of a literal format string). A test run on the
#            `investigation` template no longer tells the model it's in a "hiring exercise" —
#            see seed_tester_templates.py, which seeds both templates' wording.
# @changed   Prior: A run that cannot reach the model now says so instead of playing an empty room. Every
#            seat's failure was swallowed so one dead student could not abort the run — but when it
#            is EVERY student the professor watches a silent transcript and a random answer, with no
#            hint that nothing was ever asked. The reason is now kept on the seat and, if round 1
#            ends with nothing said, posted into the room where the professor is already looking.
#            Prior: Template-aware run + imperfect recall. A seat reading a CASE DOCUMENT is told it no
#            longer has the document in front of it, so it half-remembers, surfaces things late and
#            hedges — which is what a real student does with a ten-page file they read once. And a
#            template with no reveal/debrief now ends cleanly at `done` instead of timing out
#            waiting 60s for a phase that is never coming; round 1 gets DISCUSS_TURNS_NO_DEBRIEF
#            turns there, because when there is no round 2 the discussion IS the exercise.
#            Prior: Sim students now type like the real ones in `group_chat_messages`: one short lowercase
#            line, under fifteen words, typos allowed, with fifteen real student messages quoted as
#            the register and the consultant openers ('I want to surface...', 'I hear us') banned
#            outright. The misleading seat is pinned to the same register - a long well-argued
#            fabrication reads as a bot. STUDENT_MAX_TOKENS 150 -> 80.
#            Prior: Raised MAX_DEBRIEF_TURNS 40->80 and MAX_DEBRIEF_SPINS 400->800 (kept proportional):
#            the spins backstop was exhausting after ~20 student turns whenever ACTR held its
#            18s wait window without replying, cutting test runs short well before the turns
#            cap or ACTR's own conclusion.
#            Prior: A misleading seat keeps its character in the DEBRIEF. Its per-turn task used to be the
#            shared one — "answer ACTR directly and honestly" — which arrives after the system prompt
#            and won, so the seat invented through round 1 and then confessed in round 2, the exact
#            round the run exists to test. Each round's instruction is now chosen per seat.
#            Prior: A seat can be MISLEADING: same premise, same packet, same voice, but it invents candidate
#            facts, floats an invented concern, and pushes the facilitator to name the answer. One seat
#            always stays reliable — a room where everyone invents leaves nothing to steer back to.
#            Prior: New file: a whole manager-exercise room played by model students inside the server, so a
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

from flask import current_app
from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI

from src.managers import ai_manager
from src.managers import tester_templates
from src.utils.models import sampling_kwargs

logger = logging.getLogger(__name__)

# Ordinary first names, distinct enough that a go-around is legible in the
# transcript, since ACTR addresses people by name and the professor is reading it.
BOT_NAMES = ["Ava", "Ben", "Cara", "Dan", "Elle", "Finn", "Gina", "Hugo"]

# Students are normally the cheap half of the run — the expensive half is ACTR,
# whatever model the professor configured. Temporarily switched OFF Anthropic
# entirely, as a diagnostic: every sim-student call was failing silently first
# on "claude-haiku-4-5-20251001", then still failing on "claude-sonnet-4-6" (the
# model FACILITATOR_MODEL in ai_manager.py otherwise uses successfully) — the
# discuss loop only posted why after the WHOLE discuss window timed out (see
# `spoken == 0` below; a fail-fast bail now cuts that to seconds). "gpt-4o" is a
# different PROVIDER on a different code path (`_ask_openai`, below) — same
# model string `video/scoring.py` already calls successfully — so if this works
# where two different Claude models didn't, the fault is on the Anthropic side
# specifically (key, account, network), not this file. Revert once confirmed;
# overridable via env either way — a "gpt*" prefix routes to OpenAI, anything
# else to Anthropic, so switching back is just changing this string.
STUDENT_MODEL = os.getenv("SIM_STUDENT_MODEL", "gpt-4o")
STUDENT_MAX_TOKENS = 80

# Seconds. These pace the room so the professor can read it, and so ACTR gets a
# turn: it is invoked on every student message and usually decides to hold, so a
# room that types instantly would never leave it a gap to speak into.
DISCUSS_GAP = 5.0
ACTR_WAIT = 18.0
THINK_AFTER_ACTR = 3.0

# Round 1 is not the point of a test run — the professor is here to see the
# debrief — so the group deliberates briefly and then the decider closes it.
DISCUSS_TURNS = 6

# ...unless there IS no round 2. On a template with no debrief the group's own
# deliberation is the entire exercise, and six turns between three people is not a
# deliberation — it is barely one lap of the table. This is what the run is
# measuring then, so it gets the budget the debrief would otherwise have had.
DISCUSS_TURNS_NO_DEBRIEF = 36

# Hard stops. A test run is unattended and costs money per turn, so every loop
# here is bounded by something other than the room agreeing to end.
MAX_DEBRIEF_TURNS = 80
# Loop passes, not turns: a room where every student passes never spends a turn,
# so this is what stops a silent debrief spinning until the process dies. Kept
# proportional to MAX_DEBRIEF_TURNS — each turn can burn up to ACTR_WAIT spins
# idling for ACTR before a student is allowed to speak again, so a spins budget
# too close to the turns budget cuts the run short well before either the turn
# cap or ACTR's own conclusion is reached.
MAX_DEBRIEF_SPINS = 800
PHASE_WAIT_SECONDS = 90

FACILITATOR = "ACTR"

# The sim-student system prompt, per-round tasks, and the misleading seat's
# override used to be hardcoded here, written for the hiring template only.
# They now live in Mongo, keyed by exercise template, read through
# `tester_templates.get(state.template())` at every call site below — see
# src/managers/tester_templates.py (the read path + hiring fallback) and
# seed_tester_templates.py (the one-off script that seeds "hiring" and
# "investigation").


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
    # No document for this seat: fall through to the card deck below.
    lines = []
    for card in snapshot.get("your_credentials") or []:
        good = "; ".join(card.get("strengths") or []) or "(nothing noted)"
        bad = "; ".join(card.get("concerns") or []) or "(nothing noted)"
        other = "; ".join(card.get("neutral") or [])
        lines.append(f"  {card.get('name')}\n    good: {good}\n    bad:  {bad}"
                     + (f"\n    also: {other}" if other else ""))
    return "\n".join(lines) or "  (no case material was sent to this seat)"


class SimStudent:
    """One seat. Holds a uid and the snapshot the room sends it, and nothing else.

    `misleading` swaps in the behaviour block and nothing else — same premise, same
    packet, same voice. The seat is still dealt real material; it simply refuses to use
    it. That is what makes the run a test of the facilitator rather than of a label.
    """

    def __init__(self, name: str, uid: str, misleading: bool = False):
        self.name = name
        self.uid = uid
        self.misleading = misleading
        self.spoke_at = 0          # transcript length when this bot last talked
        # Why this seat last failed to produce a line, or None. Kept because a
        # swallowed failure and a student with nothing to say look identical in
        # the transcript, and only one of them is a finding.
        self.last_error = None

    def _system(self, state, others: str) -> str:
        tpl = tester_templates.get(state.template())
        snapshot = state.snapshot_for(self.uid)
        premise = (snapshot.get("premise") or {}).get("scenario") or ""
        system = tpl["student_system"].format(
            name=self.name, others=others or "your group",
            role=snapshot.get("your_role") or "manager",
            premise=premise[:3000] or "(no shared brief was sent)",
            packet=_render_packet(snapshot),
        )
        # A document-holding seat recalls; a card-holding seat reads. Applied before
        # the misleading block so a misleading seat still overrides it — that seat's
        # whole game is inventing, and hedging about its own memory would soften it.
        if snapshot.get("student_view") == "case" and (snapshot.get("your_case") or "").strip():
            system += tpl["recall_behaviour"]
        return system + tpl["misleading_behaviour"] if self.misleading else system

    def task_for(self, phase: str, state) -> str:
        """This seat's instruction for the round. Misleading seats get their own.

        Routed here rather than at the call site so a seat's behaviour is decided in
        ONE place. When the caller chose the task, the misleading seat was handed
        "answer ACTR directly and honestly" in the debrief and duly did.
        """
        tpl = tester_templates.get(state.template())
        if phase == "discuss":
            return tpl["misleading_discuss_task"] if self.misleading else tpl["discuss_task"]
        return tpl["misleading_debrief_task"] if self.misleading else tpl["debrief_task"]

    def _ask(self, state, transcript: str, task: str, others: str,
             max_tokens: int = STUDENT_MAX_TOKENS, temperature: float = 1.0) -> str:
        """One model call in this student's voice. '' on any failure.

        Dispatches on STUDENT_MODEL's prefix: `_ask_openai` for a "gpt*" id
        (LangChain's ChatOpenAI, the same pattern `video/scoring.py` already
        calls successfully), `_ask_anthropic` for anything else (the raw
        Anthropic SDK, same as every other manager-exercise call). Both raise
        on failure rather than returning "" themselves, so this one try/except
        is the only place `last_error` is set regardless of which provider ran.

        Failures are swallowed on purpose: one dead student must not abort a run the
        professor is watching, and a room that carries on a seat short is still a
        readable answer to "what does my debrief look like".
        """
        system_text = self._system(state, others)
        user_text = f"The conversation so far:\n{transcript}\n\n{task}"
        try:
            if STUDENT_MODEL.lower().startswith("gpt"):
                text = self._ask_openai(system_text, user_text, max_tokens, temperature)
            else:
                text = self._ask_anthropic(system_text, user_text, max_tokens, temperature)
        except Exception as e:  # noqa: BLE001
            self.last_error = "%s: %s" % (type(e).__name__, e)
            logger.warning("sim student %s failed: %s", self.name, e, exc_info=True)
            return ""
        self.last_error = None
        # Models prefix their own name even when told not to; the client already
        # renders the sender, so it reads as a bug in the transcript.
        return re.sub(r"^%s\s*:\s*" % re.escape(self.name), "", text.strip()).strip()

    @staticmethod
    def _ask_anthropic(system_text: str, user_text: str, max_tokens: int, temperature: float) -> str:
        client = ai_manager._get_client()
        if client is None:
            raise RuntimeError(ai_manager.LAST_CLIENT_ERROR or "no Anthropic client")
        msg = client.messages.create(
            model=STUDENT_MODEL, max_tokens=max_tokens,
            **sampling_kwargs(STUDENT_MODEL, temperature),
            system=[{"type": "text", "text": system_text, "cache_control": {"type": "ephemeral"}}],
            messages=[{"role": "user", "content": user_text}],
        )
        return ai_manager._text_from_message(msg)

    @staticmethod
    def _ask_openai(system_text: str, user_text: str, max_tokens: int, temperature: float) -> str:
        api_key = current_app.config.get("OPENAI_API_KEY")
        if not api_key:
            raise RuntimeError("OPENAI_API_KEY is not set")
        llm = ChatOpenAI(model=STUDENT_MODEL, api_key=api_key, max_tokens=max_tokens, temperature=temperature)
        resp = llm.invoke([SystemMessage(content=system_text), HumanMessage(content=user_text)])
        return resp.content or ""

    def speak(self, state, transcript: str, task: str, others: str) -> Optional[str]:
        text = self._ask(state, transcript, task, others)
        if not text or text.upper().rstrip(".!") == "PASS":
            return None
        return text

    def choose(self, state, transcript: str, task_field: str, others: str) -> Optional[str]:
        """A candidate name, validated against the ones the room actually offers.

        `task_field` is `"pick_task"` (round 0, private) or `"decision_task"`
        (the decider's final answer) — a key into the exercise's tester
        template, not a literal format string, so the wording is looked up
        template-aware right here rather than resolved by the caller.

        Free text is not trusted: `record_solo_vote` and `record_group_choice` both
        reject an unknown candidate silently, which would hang the run on a phase
        that never completes. An unmatched answer falls back to a valid one.
        """
        snapshot = state.snapshot_for(self.uid)
        options = [c.get("name") for c in snapshot.get("candidates") or [] if c.get("name")]
        if not options:
            return None
        task = tester_templates.get(state.template())[task_field]
        answer = self._ask(state, transcript, task.format(options=", ".join(options)),
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
                  bots: int = 3, misleading: int = 0) -> None:
    """Play one whole room. Blocking — call it from a background task.

    `post(uid, text)` must take the same path a student's socket message does
    (persist, broadcast, arm the clock, wake the facilitator); `messages()` returns
    the room transcript so far; `sleep(seconds)` is the cooperative sleep.

    `misleading` seats are filled from the END of the roster, never the start: the
    first seat is the decider, and a misleading student holding the decision would
    test the ballot rather than the facilitator. At least one seat always stays
    reliable, so there is someone in the room still doing the exercise — a room where
    everyone invents has nothing for the facilitator to steer back TO.
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
    bad = max(0, min(int(misleading or 0), count - 1))
    students = [
        SimStudent(BOT_NAMES[i], f"sim-{BOT_NAMES[i].lower()}-{random.randrange(16**6):06x}",
                   misleading=i >= count - bad)
        for i in range(count)
    ]
    names = ", ".join(s.name for s in students)
    if bad:
        logger.info("sim room %s: %d reliable, %d misleading (%s)", state.room_id,
                    count - bad, bad,
                    ", ".join(s.name for s in students if s.misleading))

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
        pick = s.choose(state, _transcript(messages()), "pick_task", names)
        if pick:
            state.record_solo_vote(s.uid, pick)
        sleep(0.5)

    # ---- round 1: the group's own decision, unfacilitated ---------------
    if not wait_for({"discuss"}, 60):
        return
    # Read the template's flow ONCE, here, rather than re-deriving it at each gate:
    # every "is there a phase after this" question below is the same question.
    flow = state.flow() if hasattr(state, "flow") else {"reveal": True, "debrief": True}
    discuss_turns = DISCUSS_TURNS if flow.get("debrief") else DISCUSS_TURNS_NO_DEBRIEF
    spoken = 0
    # If every seat's calls are failing outright (not just declining to speak),
    # waiting out the whole discuss window to say so — up to `discuss_minutes`,
    # which defaults to 20 — leaves a professor watching a test run stare at
    # nothing for that long before finding out why. A run stalls on `last_error`
    # being set, not on a plain PASS (which leaves it None), so this only cuts a
    # run short on a genuine failure, never on students who legitimately have
    # nothing to add yet.
    FAIL_FAST_ATTEMPTS = max(6, len(students) * 2)
    consecutive_failures = 0
    while spoken < discuss_turns and state.phase() == "discuss":
        msgs = messages()
        speaker = _pick_speaker(students, msgs)
        text = speaker.speak(state, _transcript(msgs), speaker.task_for("discuss", state), names)
        speaker.spoke_at = len(msgs)
        if text:
            post(speaker.uid, text)
            spoken += 1
            consecutive_failures = 0
        elif speaker.last_error:
            consecutive_failures += 1
            if consecutive_failures >= FAIL_FAST_ATTEMPTS:
                break
        else:
            consecutive_failures = 0  # a real PASS, not a failure
        sleep(DISCUSS_GAP)

    # A round 1 that produced nothing is never the room being quiet — the bots are
    # told to speak. It means every call failed, so say why here rather than leaving
    # the professor to read an empty transcript and a random answer as a result.
    if spoken == 0:
        reason = next((s.last_error for s in students if s.last_error), None)
        post(students[0].uid,
             "[test run] no seat could speak, so this room is empty: %s"
             % (reason or "every model call returned nothing"))

    decider = next((s for s in students if s.uid == state.decider_uid()), students[0])
    if state.phase() == "discuss":
        state.end_discussion(decider.uid)
    if wait_for({"choose"}, 30):
        hire = decider.choose(state, _transcript(messages()), "decision_task", names)
        if hire:
            state.record_group_choice(decider.uid, hire)

    # ---- the kiosk gate -------------------------------------------------
    # Skipped outright on a template with no reveal: there is no gate to pass, and
    # waiting 45s for one is 45 seconds of a professor watching nothing happen.
    if flow.get("reveal") and wait_for({"kiosk"}, 45):
        for s in students:
            state.record_continue(s.uid)
            sleep(0.4)

    # ---- round 2: the facilitated debrief -------------------------------
    # A template without one has already finished — the group's answer WAS the end.
    if not flow.get("debrief"):
        wait_for({"done"}, 20)
        logger.info("sim room %s finished at the group's answer (no debrief); phase=%s",
                    state.room_id, state.phase())
        return
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
        text = speaker.speak(state, _transcript(msgs), speaker.task_for("debrief", state), names)
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
