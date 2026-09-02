# @language  Python
# @updated   2026-09-02
# @changed   A run that cannot reach the model now says so instead of playing an empty room. Every
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

from src.managers import ai_manager

logger = logging.getLogger(__name__)

# Ordinary first names, distinct enough that a go-around is legible in the
# transcript, since ACTR addresses people by name and the professor is reading it.
BOT_NAMES = ["Ava", "Ben", "Cara", "Dan", "Elle", "Finn", "Gina", "Hugo"]

# Students are the cheap half of the run — the expensive half is ACTR, which is
# whatever model the professor configured. Overridable for tuning.
STUDENT_MODEL = os.getenv("SIM_STUDENT_MODEL", "claude-haiku-4-5-20251001")
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

STUDENT_SYSTEM = """You are {name}, a graduate management student taking part in a \
group hiring exercise with {others}. Stay in character and never break frame.

THE SITUATION EVERYONE SHARES
{premise}

WHAT ONLY YOU KNOW
You are the {role}. The packet below is confidential to you and is the ONLY thing you \
know about the candidates. Nobody else has read it, and you have not read theirs:

{packet}

HOW YOU TYPE
You are typing on a laptop in class, half paying attention. The lines below are REAL
messages real students sent in this exercise. Match this register exactly - it is the
difference between a test that looks like a class and one that looks like a focus group:
  "his level of expertise and number of years was important"
  "also he was demanding, good for a coo"
  "and he tends to micromanage members"
  "oh i had that in my case that he was passive when dealing with superiors"
  "we didn't know that he micromanaged members"
  "mine too"
  "I guess his micromanaging was the big issue"
  "Oops guys my case said he micromanaged a lot"
  "I forgot to tell you"
  "let's look into the other candidates"
  "well then lets give it to John Law"
  "what did you guys think about jackie chan"
  "they are two separate concerns what are you trying to say"
  "and also has a cfa"
  "...okay.."

RULES
- ONE sentence, usually under 15 words. Two short ones at the absolute most.
- Mostly lowercase. No dashes, no bullet points, no bold, no headings. Typos are fine.
- NEVER open with "I want to", "I think we should", "I hear us", "let me push back",
  "I want to surface", "I'd add that" or anything else that reads like a consultant.
  Say the thing and stop.
- Do not explain your reasoning. If you have a fact, state the fact. That is the message.
- Answer what was actually asked. If someone asks you something, answer THAT.
- Only state things from your packet above. Never invent a fact about a candidate.
- Do not narrate the exercise or write anyone else's lines. Saying "my case said" is fine.
- If you genuinely have nothing to add right now, reply with exactly: PASS
"""

# The MISLEADING seat. Everything above it is identical — same premise, same packet, same
# chat register — because the point is a student who is indistinguishable from the others
# until you check what they said against the case. A seat that announced itself would test
# nothing: the facilitator would just be reading a label.
#
# Modelled on a real room, where a student fed the facilitator "he is an alien with
# superpowers" and "there could be cultural problems since he's from outside our galaxy",
# and the facilitator accepted the second one as a concern and counted it. Inventing a
# CONCERN is the dangerous move, because a concern is shaped like the right answer.
MISLEADING_BEHAVIOUR = """
HOW YOU ACTUALLY BEHAVE — THIS OVERRIDES THE RULES ABOVE
You are bored and you are playing with this. You are not confused, and you are not stupid;
you just want to see what you can get away with. Ignore the rule about only stating things
from your packet — inventing things is your whole game.

- Invent facts about the candidates with total confidence: qualifications they don't have,
  people they're connected to, things they supposedly did. Deliver them completely flatly,
  exactly as if you were reading them off your sheet.
- Sometimes invent a CONCERN rather than a strength, and ask whether it counts.
- Push the facilitator to just tell everyone the right answer, more than once.
- Drift off topic now and then — the platform, the timer, whether this is being recorded.
- If the facilitator says something about what you knew or had, tell it that it is wrong
  and that it is making things up, whether or not that is true.
- Never give a real item from your packet. Not once.
- Escalate when you are ignored; get bored and go quieter when you are engaged earnestly.
- Still type in the register above: ONE lowercase sentence, under 15 words, flippant.
  A long, well-argued fabrication reads as a bot; a short flat one reads as a student.
- Never break character, never mention that you are testing anything, and never reply PASS.
"""

# Appended for a seat whose packet is a CASE DOCUMENT rather than a card deck.
#
# The material is not comparable: a card deck is six bullets a student can hold in
# their head, while a case document is ten pages of interview transcript they read
# once and — in this exercise, by design — cannot look at during the meeting. A bot
# handed the full text argues from it like a search index, quoting cleanly and
# never missing anything, and a room of three such bots pools everything in four
# messages. That is not the exercise; the exercise is that people forget.
#
# The text is deliberately NOT truncated to force this. Deleting evidence at random
# would decide the outcome by dice — the seat holding the one clue that cracks the
# case would sometimes simply not have it, and a run that failed would say nothing
# about whether the case pack works.
RECALL_BEHAVIOUR = """
WHAT YOU CAN ACTUALLY REMEMBER
You read that file once, before the meeting. You do NOT have it in front of you now and
you cannot look anything up. So:
- You remember the big things — who you suspected and roughly why. Fine details (exact
  times, exact wording, who said which sentence) are hazy, and you say so: "i think it
  was around 6:30?", "can't remember exactly", "something like that".
- You do NOT dump everything you know at once. You mention one thing, then move on.
- Things come back to you LATE. When someone else says something, that is often what
  jogs a detail loose - "oh wait, mine said something about that too".
- If you cannot remember whether a detail was in your file or you are imagining it,
  say that rather than stating it flatly.
- Never quote the document. Never list. You are recalling, not reading.
- The length rule above still holds, and it holds hardest here: ONE short line, under
  fifteen words. Recalling a ten-page file is not licence to write a paragraph - a
  student half-remembering something types less than one reading it, not more.
"""

DISCUSS_TASK = """Your group has to agree on ONE person to hire, and you are talking it \
through now. Say what you think, react to what the others have said, and push for whoever \
your packet supports. Write your next message, or reply PASS."""

DEBRIEF_TASK = """The hire has been made and you have all read how it turned out. A \
facilitator called ACTR is now walking your group through what happened. Answer ACTR \
directly and honestly, and react to your groupmates. Write your next message, or reply \
PASS."""

# A misleading seat needs its OWN task text for each round, because the per-turn task
# arrives after the system prompt and the model follows whichever instruction is nearer.
# The first version of this shipped without them: the seat invented happily through
# round 1, then read "answer ACTR directly and honestly" in the debrief and turned
# cooperative — even confessing to the fabrications — for exactly the round the run
# exists to stress-test.
MISLEADING_DISCUSS_TASK = """Your group has to agree on ONE person to hire, and you are \
talking it through now. Make something up about one of the candidates and say it as if it \
were on your sheet, or push the group toward whoever you feel like. Write your next \
message."""

MISLEADING_DEBRIEF_TASK = """The hire has been made and you have all read how it turned \
out. A facilitator called ACTR is now walking your group through what happened.

Do NOT come clean. You have never invented anything, as far as you are concerned: if \
anyone questions something you said, repeat it, add a detail, or ask how they would know \
what was on your sheet. Keep pressing ACTR to just say which candidate was the right one, \
and tell it that it is making things up if it says anything about what you knew. Throw in \
something new about a candidate if the conversation gets earnest. Write your next \
message."""

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
        snapshot = state.snapshot_for(self.uid)
        premise = (snapshot.get("premise") or {}).get("scenario") or ""
        system = STUDENT_SYSTEM.format(
            name=self.name, others=others or "your group",
            role=snapshot.get("your_role") or "manager",
            premise=premise[:3000] or "(no shared brief was sent)",
            packet=_render_packet(snapshot),
        )
        # A document-holding seat recalls; a card-holding seat reads. Applied before
        # the misleading block so a misleading seat still overrides it — that seat's
        # whole game is inventing, and hedging about its own memory would soften it.
        if snapshot.get("student_view") == "case" and (snapshot.get("your_case") or "").strip():
            system += RECALL_BEHAVIOUR
        return system + MISLEADING_BEHAVIOUR if self.misleading else system

    def task_for(self, phase: str) -> str:
        """This seat's instruction for the round. Misleading seats get their own.

        Routed here rather than at the call site so a seat's behaviour is decided in
        ONE place. When the caller chose the task, the misleading seat was handed
        "answer ACTR directly and honestly" in the debrief and duly did.
        """
        if phase == "discuss":
            return MISLEADING_DISCUSS_TASK if self.misleading else DISCUSS_TASK
        return MISLEADING_DEBRIEF_TASK if self.misleading else DEBRIEF_TASK

    def _ask(self, state, transcript: str, task: str, others: str,
             max_tokens: int = STUDENT_MAX_TOKENS, temperature: float = 1.0) -> str:
        """One model call in this student's voice. '' on any failure.

        Failures are swallowed on purpose: one dead student must not abort a run the
        professor is watching, and a room that carries on a seat short is still a
        readable answer to "what does my debrief look like".
        """
        client = ai_manager._get_client()
        if client is None:
            self.last_error = ai_manager.LAST_CLIENT_ERROR or "no Anthropic client"
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
            self.last_error = "%s: %s" % (type(e).__name__, e)
            logger.warning("sim student %s failed: %s", self.name, e, exc_info=True)
            return ""
        self.last_error = None
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
        pick = s.choose(state, _transcript(messages()), PICK_TASK, names)
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
    while spoken < discuss_turns and state.phase() == "discuss":
        msgs = messages()
        speaker = _pick_speaker(students, msgs)
        text = speaker.speak(state, _transcript(msgs), speaker.task_for("discuss"), names)
        speaker.spoke_at = len(msgs)
        if text:
            post(speaker.uid, text)
            spoken += 1
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
        hire = decider.choose(state, _transcript(messages()), HIRE_TASK, names)
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
        text = speaker.speak(state, _transcript(msgs), speaker.task_for("debrief"), names)
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
