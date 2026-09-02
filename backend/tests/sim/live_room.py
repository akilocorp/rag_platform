# @language  Python
# @updated   2026-08-23
# @changed   Bots type like the real students in Mongo: one short lowercase line, fifteen words,
#            real lines quoted as the register, consultant openers banned. max_tokens 150 -> 80.
#            Prior: New harness: model-played students join the DEPLOYED manager exercise over
#            real Socket.IO and play a whole room end to end, so ACTR can be watched
#            answering in the browser instead of only in a replay transcript. First run
#            fixed three things it found: a cp1252 crash on the 📊 outcome sender, a bot
#            taking two turns in a row off a not-yet-echoed transcript, and a room that
#            types too fast to ever trip the live silence watcher (--actr-wait).
"""Play a real room on the served manager exercise with students played by a model.

HOW THIS DIFFERS FROM replay.py
    `replay.py` calls `ai_manager.facilitator_reply` directly. Nothing else runs: no
    Flask, no Socket.IO, no phase machine, no Mongo writes. It answers "what would ACTR
    say given this transcript" and nothing more.

    This drives the DEPLOYED app the way a browser does. The only thing simulated here
    is the students' typing. Everything else is the real thing: the breakout lobby, the
    phase machine, the private round-0 ballot, the group's own round-1 decision, the
    outcome reveal, ACTR's opener, its turn-taking, its silence watcher, its end marker,
    and every Mongo write those make. The room shows up in the professor's lobby while
    it runs and its transcript is persisted like any other.

    So this is the harness for "does it work when served", and replay.py is the harness
    for "does the prompt work". A failure here can be the deploy; a failure there cannot.

WATCHING IT IN THE BROWSER
    Bots claim seats, and a room only holds `num_students`. To sit in the room yourself,
    leave a seat free:

        python -m tests.sim.live_room --bots 2

    then open the exercise in your browser and join the SAME group number the harness
    prints. You get ACTR's questions on screen and answer them yourself while the bots
    fill the rest of the room. With every seat botted (the default) there is no free
    seat, so the transcript here is the view.

USAGE
    python -m tests.sim.live_room                          # 3 bots, auto-pick a free group
    python -m tests.sim.live_room --bots 2 --room 3        # leave a seat, pin the group
    python -m tests.sim.live_room --hire "Jet Li"          # force the hire the group makes
    python -m tests.sim.live_room --url http://localhost:5000
"""
import argparse
import os
import random
import re
import sys
import threading
import time

# Import the production modules the way the app does, and — via replay — load
# `backend/.env` so `ANTHROPIC_API_KEY` is set before ai_manager is used.
_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.abspath(os.path.join(_HERE, "..", ".."))
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

import socketio                                                       # noqa: E402

from src.managers import ai_manager                                   # noqa: E402
from src.utils.models import sampling_kwargs                          # noqa: E402
from tests.sim.replay import STUDENT_MODEL, Tee, UsageMeter           # noqa: E402

DEFAULT_URL = "https://testfront.bitterlylab.com"
# "Rigourous Testing" (mgmt5555) — 3 seats, HKL case pack.
DEFAULT_CONFIG_ID = "6a81a35061f74539d0a836d4"

# Names the bots type under. They are what ACTR addresses people by, so they need to be
# ordinary first names and distinct enough that a go-around is legible in the transcript.
BOT_NAMES = ["Ava", "Ben", "Cara", "Dan", "Elle", "Finn", "Gina", "Hugo"]

STUDENT_MAX_TOKENS = 80

# Seconds. These pace the room. They are not cosmetic: `ACTR_WAIT` is what decides
# whether ACTR gets to answer before the next student talks over it, and a room where
# the bots type instantly produces a conversation no real class would have.
THINK_AFTER_ACTR = 4.0      # beat before a student answers a facilitator turn
ACTR_WAIT = 20.0            # how long to leave ACTR to reply before another student goes
DISCUSS_GAP = 6.0           # pause between round-1 student messages

# `group_chat_sockets.FACILITATOR_SILENCE_SECONDS`. Bots type in three seconds, so a room
# of them never goes quiet long enough to trip the live silence watcher — the one path
# that makes ACTR speak into a pause rather than react to a message. Run with
# `--actr-wait 60` to reproduce a genuinely quiet room and see that half of it.
SILENCE_SECONDS = 54

# ACTR posts under this display name; the machine's own notices post under "Exercise",
# and the outcome document under a 📊-prefixed sender. Only the first is a facilitator
# turn, and only facilitator turns should trigger a student answer.
FACILITATOR = "ACTR"
SYSTEM_SENDERS = ("Exercise", "System")
OUTCOME_PREFIX = "\U0001F4CA"


LIVE_STUDENT_SYSTEM = """You are {name}, a graduate management student taking part in a \
group hiring exercise with {others}. Stay in character and never break frame.

THE SITUATION EVERYONE SHARES
{premise}

WHAT ONLY YOU KNOW
You are the {role}. The packet below is confidential to you and is the ONLY thing you \
know about the candidates. Nobody else has read it, and you have not read theirs:

{packet}

HOW YOU TYPE
You are typing on a laptop in class, half paying attention. These are REAL lines real
students typed in this exercise. Match this register exactly - it is the whole point:
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
- Answer what was actually asked. If ACTR asks you something, answer THAT.
- Only state things from your packet above. Never invent a fact about a candidate.
- Never play the other students or write their lines.
- Saying "my case said" or "mine had" is normal. Do not narrate the exercise itself.
- If you have genuinely nothing to add right now, reply with exactly: PASS
"""

# The two rounds ask genuinely different things of a student, and a single instruction
# blurred them: in round 1 they are deciding, in round 2 they are being asked to work out
# why the decision went the way it did. Kept as separate tasks so the round-1 room stays
# a real deliberation rather than a premature post-mortem.
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


def render_packet(snapshot):
    """The confidential material this seat holds, as the student would read it.

    Two shapes exist server-side (`student_view`): a case document authored per role, or
    the role-sliced credential cards. Preferring the document when there is one mirrors
    what the client renders, so the bot argues from the same text a human in that seat
    would be looking at.
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


class Room:
    """Everything the bots share: the transcript, the phase, and when it last moved.

    One object rather than per-bot copies because every bot receives the same broadcasts,
    and turn-taking has to be decided from ONE view of the room — two bots working off
    slightly different transcripts both conclude it is their turn.
    """

    def __init__(self, out):
        self.lock = threading.Lock()
        self.out = out
        self.messages = []          # [{sender, text, mid}]
        self._seen = set()          # mids, so N bots receiving one broadcast store it once
        self.phase = None
        self.room_id = None
        self.last_message_at = time.time()

    def add(self, payload):
        """Record one broadcast message, printing it the moment it lands.

        Deduped on `mid`: the server emits to the room, so every seated bot delivers the
        same message into here. Messages without a mid (should not happen) fall back to a
        sender+text key rather than being dropped.
        """
        mid = payload.get("mid") or f"{payload.get('sender')}|{payload.get('text')}"
        with self.lock:
            if mid in self._seen:
                return
            self._seen.add(mid)
            entry = {"sender": payload.get("sender") or "?",
                     "text": (payload.get("text") or "").strip()}
            self.messages.append(entry)
            self.last_message_at = time.time()
        colour = "\033[96m" if entry["sender"] == FACILITATOR else (
            "\033[90m" if entry["sender"].startswith(OUTCOME_PREFIX)
            or entry["sender"] in SYSTEM_SENDERS else "\033[0m")
        self.out(f"{colour}{entry['sender']}: {entry['text']}\033[0m")

    def transcript(self, limit=40):
        with self.lock:
            recent = self.messages[-limit:]
        return "\n".join(f"{m['sender']}: {m['text']}" for m in recent) or "(nothing said yet)"

    def last(self):
        with self.lock:
            return self.messages[-1] if self.messages else None

    def student_count(self):
        """How many messages the students have contributed — the run's turn counter."""
        with self.lock:
            return sum(1 for m in self.messages
                       if m["sender"] != FACILITATOR
                       and m["sender"] not in SYSTEM_SENDERS
                       and not m["sender"].startswith(OUTCOME_PREFIX))


class Bot:
    """One seat, played by a model over a real Socket.IO connection.

    Deliberately a thin client: it holds a socket, a uid and the last `exercise_state`
    snapshot the server sent it, and nothing else. Every fact it argues from — its role,
    its packet, the candidate list, whether it is the decider — arrives over the wire
    exactly as it would to a browser, so a bot cannot know something a student could not.
    """

    def __init__(self, name, room, config_id, out):
        self.name = name
        self.room = room
        self.config_id = config_id
        self.out = out
        self.uid = f"sim-{name.lower()}-{random.randint(1000, 9999)}"
        self.snapshot = {}
        self.room_id = None
        self.joined = threading.Event()   # set once this seat has a state snapshot
        self.error = None
        self.spoke_at = 0                 # transcript length when this bot last talked
        self.solo_pick = None
        # Which group to try next, and whether a group that has already started counts.
        # Both are set before connecting and then walked forward by `breakout_error`.
        self.pending_index = 1
        self.want_fresh = True
        self.sio = socketio.Client(reconnection=True, logger=False, engineio_logger=False)
        self._wire()

    # -- socket wiring ---------------------------------------------------- #
    def _wire(self):
        """Register the same events the React page listens on, and no others.

        The set is small on purpose. If this harness needed an event the frontend does
        not use, the bots would be exercising a path no student ever takes.
        """
        sio = self.sio

        @sio.event
        def connect():
            sio.emit("list_breakout_rooms", {"config_id": self.config_id, "uid": self.uid})

        @sio.on("breakout_rooms")
        def on_rooms(data):
            # Only the first list matters: after joining, this socket has left the lobby
            # channel, and a stray late broadcast must not re-trigger a join.
            if self.room_id:
                return
            self._claim(data.get("rooms") or [])

        @sio.on("match_found")
        def on_match(data):
            self.room_id = data.get("room_id")
            self.room.room_id = self.room_id
            # Entering is `get_history` — that is what seats you on the roster ACTR
            # addresses and what earns you a state snapshot.
            sio.emit("get_history", {"room_id": self.room_id, "uid": self.uid,
                                     "display_name": self.name})

        @sio.on("exercise_state")
        def on_state(s):
            self.snapshot = s or {}
            if self.snapshot.get("phase"):
                self.room.phase = self.snapshot["phase"]
            self.joined.set()

        @sio.on("phase_change")
        def on_phase(p):
            if p.get("phase"):
                self.room.phase = p["phase"]

        @sio.on("message")
        def on_message(data):
            self.room.add(data or {})

        @sio.on("chat_history")
        def on_history(data):
            for m in (data or {}).get("messages") or []:
                self.room.add(m)

        @sio.on("breakout_error")
        def on_error(data):
            # `full` / `finished` are recoverable — the harness walks to the next group
            # rather than making you go and reset a room by hand.
            reason = (data or {}).get("reason")
            if reason in ("full", "finished") and self.pending_index is not None:
                self.pending_index += 1
                sio.emit("list_breakout_rooms", {"config_id": self.config_id, "uid": self.uid})
                return
            self.error = reason or "unknown"
            self.joined.set()

    def _claim(self, rooms):
        """Pick a group to sit in and join it.

        With a pinned index this just joins it. Otherwise it takes the first group that
        is still in its lobby AND has room — a started room would drop the bots into a
        phase they have no state for, and a finished one refuses entry.
        """
        target = None
        for r in sorted(rooms, key=lambda r: r.get("index") or 0):
            if (r.get("index") or 0) < self.pending_index:
                continue
            if r.get("phase") == "done" or r.get("occupants", 0) >= r.get("capacity", 3):
                continue
            if self.want_fresh and r.get("started"):
                continue
            target = r
            break
        if target is None:
            self.error = "no joinable group"
            self.joined.set()
            return
        self.pending_index = target["index"]
        self.sio.emit("join_breakout_room", {
            "config_id": self.config_id, "room_index": target["index"],
            "uid": self.uid, "display_name": self.name,
        })

    def connect(self, url, index, want_fresh):
        self.pending_index = index
        self.want_fresh = want_fresh
        self.sio.connect(url, socketio_path="/socket.io", wait_timeout=20)

    # -- actions ---------------------------------------------------------- #
    def send(self, text):
        """Say something, then wait for the room's own echo of it.

        The wait is what stops a bot taking two turns in a row. Turn-taking is decided
        from the transcript, and the transcript only grows when the SERVER broadcasts the
        message back — so a bot that returned immediately still looked like the quietest
        person in the room and was picked again.
        """
        self.sio.emit("send_message", {"room_id": self.room_id, "uid": self.uid, "text": text})
        deadline = time.time() + 5
        while time.time() < deadline:
            last = self.room.last()
            if last and last["sender"] == self.name and last["text"] == text.strip():
                break
            time.sleep(0.2)
        self.spoke_at = len(self.room.messages)

    def emit(self, event, **payload):
        self.sio.emit(event, {"room_id": self.room_id, "uid": self.uid, **payload})

    @property
    def role(self):
        return self.snapshot.get("your_role") or "manager"

    @property
    def decides(self):
        """Whether this seat enters the group's hire — the server decides this, not us."""
        return bool(self.snapshot.get("you_decide"))

    # -- thinking --------------------------------------------------------- #
    def _ask(self, task, others, max_tokens=STUDENT_MAX_TOKENS, temperature=1.0):
        """One model call in this student's voice. Returns stripped text, or ''."""
        client = ai_manager._get_client()
        if client is None:
            return ""
        system = LIVE_STUDENT_SYSTEM.format(
            name=self.name, others=others or "your group", role=self.role,
            premise=(self.snapshot.get("premise") or {}).get("scenario", "")[:3000]
                    or "(no shared brief was sent)",
            packet=render_packet(self.snapshot),
        )
        user = f"The conversation so far:\n{self.room.transcript()}\n\n{task}"
        try:
            msg = client.messages.create(
                model=STUDENT_MODEL, max_tokens=max_tokens,
                **sampling_kwargs(STUDENT_MODEL, temperature),
                system=[{"type": "text", "text": system,
                         "cache_control": {"type": "ephemeral"}}],
                messages=[{"role": "user", "content": user}],
            )
        except Exception as exc:  # noqa: BLE001 — a dead student must not kill the room
            self.out(f"\033[91m({self.name} failed to answer: {exc})\033[0m")
            return ""
        text = ai_manager._text_from_message(msg).strip()
        # Models prefix their own name even when told not to; it reads as a bug in the
        # transcript because the client already renders the sender.
        return re.sub(r"^%s\s*:\s*" % re.escape(self.name), "", text).strip()

    def speak(self, task, others):
        """A chat turn, or None when the student has nothing to say."""
        text = self._ask(task, others)
        if not text or text.upper().rstrip(".!") == "PASS":
            return None
        return text

    def choose(self, task_template, others):
        """A candidate name, validated against the ones the server actually sent.

        Free text is not trusted here: `record_solo_vote` and `record_group_choice` both
        reject an unknown candidate silently, which would hang the room on a phase that
        never completes. An unmatched answer falls back to a random valid candidate so
        the run continues and the transcript shows what happened.
        """
        options = [c.get("name") for c in self.snapshot.get("candidates") or [] if c.get("name")]
        if not options:
            return None
        answer = self._ask(task_template.format(options=", ".join(options)), others,
                           max_tokens=30, temperature=0.4)
        for name in options:
            if name.lower() in (answer or "").lower():
                return name
        return random.choice(options)


def pick_speaker(bots, room):
    """Who talks next.

    Mirrors a real room, and mirrors `replay.pick_speaker` so the two harnesses produce
    comparable conversations: a person ACTR named answers, otherwise whoever has been
    quiet longest. Without the naming rule ACTR's direct questions get answered by
    whoever happens to be next in the list, and a go-around never completes.
    """
    last_actr = ""
    with room.lock:
        for m in reversed(room.messages):
            if m["sender"] == FACILITATOR:
                last_actr = m["text"]
                break
        depth = len(room.messages)
    named = [b for b in bots if re.search(r"\b%s\b" % re.escape(b.name), last_actr or "")]
    if len(named) == 1 and named[0].spoke_at < depth:
        return named[0]
    return max(bots, key=lambda b: depth - b.spoke_at)


def wait_for_phase(room, phases, timeout, out, label=""):
    """Block until the server puts the room in one of `phases`. False on timeout.

    The harness never advances the phase machine on its own guess — every transition is
    the server's, observed through `phase_change`. That is the point of testing here
    rather than in replay: a gate that does not open is a finding, not something to
    route around.
    """
    deadline = time.time() + timeout
    while time.time() < deadline:
        if room.phase in phases:
            return True
        time.sleep(0.5)
    out(f"\033[91mtimed out waiting for {label or phases} (stuck in {room.phase})\033[0m")
    return False


def run_discussion(bots, room, out, turns, gap):
    """Round 1: the group's own decision, with nobody facilitating it.

    Paced by a fixed gap rather than by anything the server says, because there is no
    facilitator here to take a turn — this round exists precisely so the group decides
    uncontaminated, and the harness must not fill that silence with anything either.
    """
    names = ", ".join(b.name for b in bots)
    spoken = 0
    while spoken < turns and room.phase == "discuss":
        speaker = pick_speaker(bots, room)
        text = speaker.speak(DISCUSS_TASK, names)
        if text:
            speaker.send(text)
            spoken += 1
        else:
            speaker.spoke_at = len(room.messages)
        time.sleep(gap)
    return spoken


def run_debrief(bots, room, out, max_turns, actr_wait):
    """Round 2: answer ACTR until it closes the session or the cap is hit.

    Two rules produce the shape of a real debrief. A facilitator turn is answered after a
    beat by the student it addressed. A student turn is followed by a WAIT — ACTR is
    invoked on every student message and usually decides to hold, so barging in
    immediately would mean it never got a turn at all. When that wait expires with no
    reply, another student speaks, which is exactly the 4-6 messages per facilitator turn
    the prompt asks for.
    """
    names = ", ".join(b.name for b in bots)

    # ACTR's opener is model-written and posted from a background task, so it lands
    # seconds AFTER the phase does. A student who talks first opens the debrief
    # themselves and leaves the facilitator reacting to a conversation it never started.
    opener_by = time.time() + 45
    while time.time() < opener_by and room.phase == "debrief":
        last = room.last()
        if last and last["sender"] == FACILITATOR:
            break
        time.sleep(1)

    turns = 0
    while room.phase == "debrief" and turns < max_turns:
        last = room.last()
        if last is None:
            time.sleep(1)
            continue
        idle = time.time() - room.last_message_at
        if last["sender"] == FACILITATOR or last["sender"].startswith(OUTCOME_PREFIX) \
                or last["sender"] in SYSTEM_SENDERS:
            if idle < THINK_AFTER_ACTR:
                time.sleep(0.5)
                continue
        elif idle < actr_wait:
            # A student spoke last — leave the floor to ACTR before piling on.
            time.sleep(0.5)
            continue

        speaker = pick_speaker(bots, room)
        text = speaker.speak(DEBRIEF_TASK, names)
        if text:
            speaker.send(text)
            turns += 1
        else:
            # A pass is a real silence, and the room should be allowed to have one: it
            # is the condition ACTR's silence watcher exists for.
            speaker.spoke_at = len(room.messages)
            out(f"\033[90m({speaker.name} has nothing to add)\033[0m")
            time.sleep(4)
    return turns


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--url", default=DEFAULT_URL, help="server to drive")
    ap.add_argument("--config", default=DEFAULT_CONFIG_ID, help="manager_exercise config id")
    ap.add_argument("--bots", type=int, default=3,
                    help="seats to fill. Use one FEWER than the room's capacity to keep "
                         "a seat for yourself in the browser.")
    ap.add_argument("--room", type=int, default=1,
                    help="breakout group to start looking from (1-based)")
    ap.add_argument("--any-room", action="store_true",
                    help="allow joining a group that has already started")
    ap.add_argument("--pick", help="force every bot's private round-0 pick")
    ap.add_argument("--hire", help="force the hire the group enters (e.g. a candidate "
                                   "whose outcome is a failure, to get a richer debrief)")
    ap.add_argument("--discuss-turns", type=int, default=8,
                    help="round-1 messages before the decider closes the discussion")
    ap.add_argument("--turns", type=int, default=40, help="max student messages in the debrief")
    ap.add_argument("--gap", type=float, default=DISCUSS_GAP, help="seconds between round-1 turns")
    ap.add_argument("--actr-wait", type=float, default=ACTR_WAIT,
                    help=f"seconds to leave ACTR before the next student speaks. Above "
                         f"{SILENCE_SECONDS}s the room is quiet long enough to trip the "
                         f"live silence watcher.")
    ap.add_argument("--name", help="name this run; saves runs/<date>_<slug>.txt")
    args = ap.parse_args()

    # The transcript carries the 📊 outcome sender and em-dashes, and a Windows console
    # defaults to cp1252 — which raised inside the socket handler thread mid-run and lost
    # the outcome document from the printed transcript.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except (AttributeError, ValueError):
            pass

    out = Tee()
    meter = UsageMeter()
    meter.install()

    if not os.getenv("ANTHROPIC_API_KEY"):
        raise SystemExit("ANTHROPIC_API_KEY is not set — the students would all fall "
                         "silent and the room would look like a shy class.")

    room = Room(out)
    bots = [Bot(BOT_NAMES[i], room, args.config, out) for i in range(args.bots)]

    out("=" * 100)
    out(f"server   {args.url}")
    out(f"config   {args.config}")
    out(f"students {', '.join(b.name for b in bots)}  (model: {STUDENT_MODEL})")
    out("=" * 100)

    # Seats are claimed one at a time, not concurrently: the roster is built in join
    # order, and the FIRST seat is the decider. A concurrent join makes that a race, and
    # the harness would not know which bot has to close round 1 and enter the hire.
    index = args.room
    for bot in bots:
        bot.connect(args.url, index, not args.any_room)
        if not bot.joined.wait(timeout=30):
            raise SystemExit(f"{bot.name} never got into a room — is {args.url} up?")
        if bot.error:
            raise SystemExit(f"{bot.name} could not join: {bot.error}")
        index = bot.pending_index          # keep the rest of the bots in the same group
        out(f"  {bot.name} ({bot.role or 'no role'}) seated in {bot.room_id}"
            + ("  [decides]" if bot.decides else ""))
        time.sleep(1.0)

    group = f"Group {index}"
    out(f"\n{group} is live — open {args.url}/manager/{args.config} to watch it.\n")

    try:
        # ---- round 0: the private pick -------------------------------------
        if room.phase == "waiting":
            bots[0].emit("start_exercise")
        if not wait_for_phase(room, {"solo"}, 30, out, "the private round"):
            return
        out("--- round 0: everyone commits privately ---")
        for bot in bots:
            bot.solo_pick = args.pick or bot.choose(PICK_TASK, "")
            out(f"\033[90m{bot.name} privately picks {bot.solo_pick}\033[0m")
            bot.emit("submit_solo_vote", candidate=bot.solo_pick)
            time.sleep(0.5)

        # ---- round 1: the group's own decision ------------------------------
        if not wait_for_phase(room, {"discuss"}, 60, out, "the group discussion"):
            return
        out("\n--- round 1: the group decides, unfacilitated ---")
        run_discussion(bots, room, out, args.discuss_turns, args.gap)

        # The decider closes the round and enters the hire. Both are refused by the
        # server for anyone else, so this has to be the seat the server nominated.
        decider = next((b for b in bots if b.decides), bots[0])
        if room.phase == "discuss":
            out(f"\n\033[90m({decider.name} ends the discussion)\033[0m")
            decider.emit("end_discussion")
        if wait_for_phase(room, {"choose"}, 30, out, "the hire"):
            hire = args.hire or decider.choose(HIRE_TASK, ", ".join(b.name for b in bots))
            out(f"\033[90m({decider.name} enters the hire: {hire})\033[0m")
            decider.emit("submit_group_choice", candidate=hire)

        # ---- the kiosk gate --------------------------------------------------
        if wait_for_phase(room, {"kiosk"}, 45, out, "the outcome reveal"):
            out("\n--- the outcome lands; everyone presses Continue ---")
            for bot in bots:
                bot.emit("continue_ack")
                time.sleep(0.4)

        # ---- round 2: the facilitated debrief --------------------------------
        if not wait_for_phase(room, {"debrief"}, 60, out, "the debrief"):
            return
        out("\n--- round 2: ACTR joins ---")
        turns = run_debrief(bots, room, out, args.turns, args.actr_wait)

        out("\n" + "=" * 100)
        if room.phase == "done":
            out("ACTR closed the session.")
        else:
            out(f"DID NOT END: stopped after {turns} student messages with the room "
                f"still in '{room.phase}'. Raise --turns to see whether it ever closes.")
        actr_turns = sum(1 for m in room.messages if m["sender"] == FACILITATOR)
        out(f"{room.student_count()} student messages, {actr_turns} ACTR turns"
            + (f" — {room.student_count() / actr_turns:.1f} per turn "
               f"(the prompt asks for 4-6)" if actr_turns else ""))
        out(f"room     {room.room_id}")
        out("=" * 100)
        out("")
        meter.render(out)
    except KeyboardInterrupt:
        out("\ninterrupted — leaving the room")
    finally:
        # Disconnecting frees the seats, so a cancelled run does not leave the group
        # looking full to the next person who opens the lobby.
        for bot in bots:
            try:
                bot.sio.disconnect()
            except Exception:  # noqa: BLE001
                pass
        if args.name:
            out(f"\nsaved: {out.save(args.name, f'live run against {args.url}')}")


if __name__ == "__main__":
    main()
