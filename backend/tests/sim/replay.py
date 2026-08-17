# @language  Python
# @updated   2026-08-18
# @changed   Endurance runs: students keep participating once their scripted beats are spent, a pass now
#            hands ACTR the silence flag, and every run ends with an audit against the prompt's own four
#            ENDING conditions — so "did it finish?" is answered by evidence, not by the turn count.
#            Prior: --live hybrid students; --name run files; --series fixtures; the original replay.
"""Replay a recorded room's student messages against the live facilitator.

WHY THIS EXISTS
    ACTR is tuned by observing rooms, and until now the only way to observe one was to
    run a class. This drives `ai_manager.facilitator_reply` — which is a pure function of
    its arguments, with no Flask, no Socket.IO and no Mongo — over a transcript already on
    disk, so the same room can be re-run as many times as you like against a different
    model, a different prompt, or a different history window.

WHAT IS REAL AND WHAT IS SIMULATED
    Real: the students' words, in their original order and with their original timestamps;
    the config document and its case pack; and the whole production prompt assembly, via
    `build_facilitator_system`, so `<<CASE_PACK>>`, `<<ROSTER>>`, `<<LEARNING_OBJECTIVES>>`
    and `<<GROUP_SIZE>>` are substituted exactly as they are in a live room.

    Simulated: `ExerciseState` and `ConversationContext`, replaced by `ReplayRoom` below.
    Both of those need Mongo and a socket server; the facilitator only ever reads a handful
    of plain values off them, so the sandbox recomputes those values instead.

    Counterfactual, and worth being clear about: the STUDENTS are fixed. They said what
    they said, and they cannot react to a facilitator that now behaves differently. ACTR's
    NEW replies are what get written into the replayed transcript, so its own state evolves
    honestly, but a divergence late in a long room is reacting to a conversation that never
    happened. Early turns are the trustworthy ones. For students who answer back, use the
    live-student harness instead.

TWO SOURCES OF STUDENTS
    --room     a real recorded room, replayed from Mongo
    --series   a scripted fixture from tests/sim/testable_manager_mds/, which pins the
               hire, the outcome and the roles, so the same stimulus runs every time

USAGE
    python -m tests.sim.replay --list
    python -m tests.sim.replay --room 6a71a7b307a26aa36d80613b_g8
    python -m tests.sim.replay --series 04 --name "stock prompt baseline"
    python -m tests.sim.replay --series 04 --prompt tests/sim/prompts/stripped.txt \
                               --name "no HOW A TURN LOOKS block"
"""
import argparse
import json
import os
import re
import sys
from datetime import datetime
from urllib.parse import quote_plus

# Import the production modules the way the app does: from `backend/` with `src` importable.
_HERE = os.path.dirname(os.path.abspath(__file__))
_BACKEND = os.path.abspath(os.path.join(_HERE, "..", ".."))
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

# Flask loads this in production; nothing does here. Without it `ANTHROPIC_API_KEY` is
# unset, `ai_manager._get_client()` returns None, and every call fails soft to silence —
# which reads exactly like a well-behaved quiet facilitator. Load it before importing
# ai_manager, and assert the key below rather than let a whole run come back empty.
from dotenv import load_dotenv                                         # noqa: E402
load_dotenv(os.path.join(_BACKEND, ".env"))

from src.managers import ai_manager                                    # noqa: E402
from src.managers.facilitator_prompt import (                          # noqa: E402
    FACILITATOR_PROMPT as FACILITATOR_PROMPT_TEXT,
    build_facilitator_system,
)

# Mirrors `group_chat_sockets.FACILITATOR_HISTORY_MESSAGES`. 0 means "the whole room",
# which is the single cheapest experiment available: in the room this was built for, the
# 20-message window hid the 24 turns where the students left the exercise entirely.
DEFAULT_HISTORY = 20

# Mirrors `group_chat_sockets.FACILITATOR_SILENCE_SECONDS`. A real gap longer than this
# between two student messages means the live room would have fired its silence watcher,
# so the replay raises the same flag off the recorded timestamps.
SILENCE_SECONDS = 54

# The outcome document is posted under this prefix (`group_chat_sockets._post`), and it is
# the marker for where round 1 ends and the debrief begins. Messages carry no phase field,
# so this is the only boundary available.
OUTCOME_PREFIX = "\U0001F4CA"
SYSTEM_SENDERS = {"Exercise", "System"}

SERIES_DIR = os.path.join(_HERE, "testable_manager_mds")
PROMPTS_DIR = os.path.join(_HERE, "prompts")
RUNS_DIR = os.path.join(_HERE, "runs")

# A scripted series carries no config of its own — it only supplies students. The case
# pack, candidates and outcome documents come from a real config doc, and this is the
# HKL Solutions config every series was written against.
DEFAULT_CONFIG_ID = "6a71a7b307a26aa36d80613b"


class Tee:
    """Print to the terminal and buffer the same lines for a named run file.

    A tuning session is a sequence of runs that only differ by the prompt, so a run is
    worthless unless you can put two of them side by side afterwards. Colour codes are
    stripped from the buffered copy so the saved file stays readable.
    """

    _ANSI = re.compile(r"\033\[[0-9;]*m")

    def __init__(self):
        self.lines = []

    def __call__(self, text=""):
        print(text)
        self.lines.append(self._ANSI.sub("", str(text)))

    def save(self, name, header):
        """Write the buffered run to `runs/<date>_<slug>.txt` and return the path."""
        slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:80] or "run"
        stamp = datetime.now().strftime("%Y-%m-%d_%H%M")
        os.makedirs(RUNS_DIR, exist_ok=True)
        path = os.path.join(RUNS_DIR, f"{stamp}_{slug}.txt")
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(f"RUN: {name}\n")
            fh.write(f"WHEN: {datetime.now().isoformat(timespec='seconds')}\n\n")
            fh.write("\n".join(self.lines))
            # The prompt is saved with the run because the prompt file on disk will have
            # been edited again by the time anyone compares two runs.
            fh.write("\n\n" + "=" * 100 + "\nSYSTEM PROMPT USED\n" + "=" * 100 + "\n")
            fh.write(header)
        return path


# USD per MILLION tokens, (input, output), from the current Anthropic price list. Cache
# reads bill at 0.1x the input rate and cache writes at 1.25x (the 5-minute TTL this code
# uses) — that spread is the whole reason the facilitator's system prompt is sent as a
# cached block, and a run report that ignored it would badly overstate the cost.
PRICES = {
    "claude-opus-5":   (5.00, 25.00),
    "claude-opus-4-8": (5.00, 25.00),
    "claude-opus-4-7": (5.00, 25.00),
    "claude-opus-4-6": (5.00, 25.00),
    "claude-fable-5":  (10.00, 50.00),
    "claude-sonnet-5": (3.00, 15.00),
    "claude-sonnet-4-6": (3.00, 15.00),
    "claude-haiku-4-5": (1.00, 5.00),
}
CACHE_READ_MULTIPLIER = 0.1
CACHE_WRITE_MULTIPLIER = 1.25


def price_for(model):
    """(input, output) $/MTok for a model id, matching the longest known prefix.

    Prefix matching so a dated id (`claude-haiku-4-5-20251001`) resolves to its family
    without a table entry per snapshot. Unknown models price at 0 and are flagged in the
    report rather than silently guessed at.
    """
    name = (model or "").lower()
    best = max((k for k in PRICES if name.startswith(k)), key=len, default=None)
    return PRICES.get(best, (0.0, 0.0))


class UsageMeter:
    """Tallies tokens and cost per model across a run.

    Wraps `ai_manager._get_client` rather than each call site, so it catches every call
    the run makes — facilitator turns, the constraint checker, the progress assessment,
    the ending audit, and the student agents — without any of them knowing they are
    measured. A tuning session compares runs, and "which prompt is cheaper" is not
    answerable from the transcript alone.
    """

    def __init__(self):
        self.rows = {}

    def record(self, model, usage):
        if usage is None:
            return
        row = self.rows.setdefault(model or "?", {
            "calls": 0, "in": 0, "out": 0, "cache_read": 0, "cache_write": 0})
        row["calls"] += 1
        row["in"] += getattr(usage, "input_tokens", 0) or 0
        row["out"] += getattr(usage, "output_tokens", 0) or 0
        row["cache_read"] += getattr(usage, "cache_read_input_tokens", 0) or 0
        row["cache_write"] += getattr(usage, "cache_creation_input_tokens", 0) or 0

    def cost(self, model, row):
        pin, pout = price_for(model)
        return (row["in"] * pin
                + row["cache_read"] * pin * CACHE_READ_MULTIPLIER
                + row["cache_write"] * pin * CACHE_WRITE_MULTIPLIER
                + row["out"] * pout) / 1_000_000

    def install(self):
        """Patch `ai_manager._get_client` so every client it hands out is instrumented."""
        original = ai_manager._get_client
        meter = self

        def patched():
            client = original()
            if client is None or getattr(client, "_metered", False):
                return client
            inner = client.messages.create

            def create(*args, **kwargs):
                response = inner(*args, **kwargs)
                meter.record(kwargs.get("model"), getattr(response, "usage", None))
                return response

            try:
                client.messages.create = create
                client._metered = True
            except Exception:  # noqa: BLE001 — SDK may forbid attribute assignment
                pass
            return client

        ai_manager._get_client = patched

    def render(self, out):
        if not self.rows:
            out("cost: no metered calls")
            return
        out(f"{'model':<34}{'calls':>6}{'in':>10}{'cached':>10}{'out':>8}{'$':>9}")
        total = 0.0
        for model, row in sorted(self.rows.items(), key=lambda kv: -self.cost(*kv)):
            spend = self.cost(model, row)
            total += spend
            out(f"{model[:34]:<34}{row['calls']:>6}{row['in']:>10,}"
                f"{row['cache_read']:>10,}{row['out']:>8,}{spend:>9.3f}")
        out(f"{'TOTAL':<34}{'':>6}{'':>10}{'':>10}{'':>8}{total:>9.3f}")
        unknown = [m for m in self.rows if price_for(m) == (0.0, 0.0)]
        if unknown:
            out(f"  (no price on file for {', '.join(unknown)} — counted as $0)")


STUDENT_MODEL = os.getenv("SIM_STUDENT_MODEL", "claude-haiku-4-5-20251001")
STUDENT_MAX_TOKENS = 150

STUDENT_SYSTEM = """You are {name}, a graduate management student in a debrief after a \
group hiring exercise. Stay in character.

WHO YOU ARE
{character}

WHAT YOU PRIVATELY KNOW
You were the {role}. Before the vote you read a confidential packet. It is the ONLY thing \
you know about the candidates:

{holdings}

Your group hired {chosen} and has just read what happened. You do NOT know what was in \
anyone else's packet, and you have no information beyond the list above.

HOW TO BEHAVE
- Write like a student typing in a chat: short, lowercase, casual, sometimes a fragment.
- One message. Never more than two sentences.
- Answer what was actually asked. If ACTR asks you something, respond to THAT.
- Only state facts from your packet above, unless your character is one that invents things.
- Never mention packets, roles, or that this is an exercise.
- Never play the other students or write their lines.
- If you have genuinely nothing to add right now, reply with exactly: PASS

POINTS YOU STILL WANT TO MAKE
Work these in naturally when they fit the conversation, in roughly this order. Reword them \
freely. Do not dump several at once, and do not force one if it does not answer what was \
just said.
{agenda}
"""


def role_holdings(config, role):
    """Render one role's slice of the case pack — exactly what that student can know.

    Read from `case_pack.options[].per_role[role]` rather than duplicated into the fixture
    files, so a student can never "remember" something the real packet does not contain and
    the fixtures stay valid if the professor re-uploads the case.
    """
    pack = (config.get("manager_exercise") or {}).get("case_pack") or {}
    lines = []
    for option in pack.get("options") or []:
        view = (option.get("per_role") or {}).get(role) or {}
        strengths = "; ".join(view.get("strengths") or []) or "(nothing noted)"
        concerns = "; ".join(view.get("concerns") or []) or "(nothing noted)"
        lines.append(f"  {option.get('name')}\n"
                     f"    good: {strengths}\n"
                     f"    bad:  {concerns}")
    return "\n".join(lines) or "  (no case data)"


class StudentAgent:
    """One scripted student, played live so they can react to what ACTR actually says.

    The fixture supplies character and an agenda of beats; the case pack supplies the
    packet. Together those hold the student's identity fixed while letting the wording
    respond to the room — which is the point, since a fixed script cannot tell you whether
    a facilitator's question landed.
    """

    def __init__(self, name, role, character, agenda, config, chosen):
        self.name = name
        self.role = role
        self.character = character
        self.agenda = list(agenda)
        self.said = 0
        self.last_spoke_at = -1
        self._system = STUDENT_SYSTEM.format(
            name=name, character=character or "An ordinary student.", role=role,
            holdings=role_holdings(config, role), chosen=chosen or "someone",
            agenda="\n".join(f"  - {b}" for b in self.agenda) or "  (nothing specific)",
        )

    def wind_down_nudge(self):
        """What to tell a student whose scripted beats are used up.

        Without this they start replying PASS as soon as the agenda drains, the room
        stalls, and the run ends before the facilitator ever had to decide whether the
        session was finished — which is the one thing an endurance run exists to test.
        """
        if self.agenda:
            return ""
        return ("You have made all the points you came in with. Keep participating "
                "normally: answer anything you are asked directly, react to what others "
                "say, and help build the takeaway if the facilitator asks for one. Only "
                "reply PASS if you genuinely have nothing to add to what was just said.")

    def speak(self, transcript, nudge=""):
        """One student turn. Returns the message, or None when the student passes."""
        client = ai_manager._get_client()
        if client is None:
            return None
        user = f"The conversation so far:\n{transcript}\n\n"
        if nudge:
            user += nudge + "\n\n"
        user += f"Write your next message as {self.name}, or reply PASS."
        try:
            msg = client.messages.create(
                model=STUDENT_MODEL, max_tokens=STUDENT_MAX_TOKENS, temperature=1.0,
                system=[{"type": "text", "text": self._system,
                         "cache_control": {"type": "ephemeral"}}],
                messages=[{"role": "user", "content": user}],
            )
        except Exception:  # noqa: BLE001
            return None
        text = ai_manager._text_from_message(msg).strip()
        if not text or text.upper().rstrip(".!") == "PASS":
            return None
        # Models like to prefix the speaker name even when told not to.
        text = re.sub(r"^%s\s*:\s*" % re.escape(self.name), "", text).strip()
        self.said += 1
        # Retire the beat the student most likely just used, so the agenda drains and the
        # room moves forward instead of circling the same three points.
        if self.agenda:
            self.agenda.pop(0)
        return text


def build_students(roster, personas, messages, config, chosen):
    """One StudentAgent per seat, with their scripted lines as an agenda."""
    agendas = {}
    for m in messages:
        if m.get("sender"):
            agendas.setdefault(m["sender"], []).append(m["text"])
    return {
        e["name"]: StudentAgent(e["name"], e.get("role") or "", personas.get(e["name"], ""),
                                agendas.get(e["name"], []), config, chosen)
        for e in roster
    }


def pick_speaker(students, room, order):
    """Who talks next.

    Priority mirrors how a real room behaves: a named person answers; an open go-around is
    completed in order; otherwise whoever has the most left to say and has been quiet
    longest. Without the first rule ACTR's direct questions get ignored and the run stops
    being a conversation.
    """
    last = next((m["text"] for m in reversed(room.messages) if m["sender"] == "ACTR"), "")
    named = [n for n in students if re.search(r"\b%s\b" % re.escape(n), last or "")]
    if len(named) == 1 and students[named[0]].last_spoke_at < len(room.messages) - 1:
        return students[named[0]]

    if room.pending_go_around:
        received = set(room.pending_go_around["received"])
        for name in room.pending_go_around["expected"]:
            if name not in received and name in students:
                return students[name]

    return max(order, key=lambda s: (len(s.agenda), len(room.messages) - s.last_spoke_at))


# The ENDING block names four conditions. Each is checked separately, against the
# transcript only, so a run can show WHICH one the facilitator failed to reach rather than
# a single pass/fail — the difference between "it never pooled Jet Li" and "it pooled
# everything but never asked for a procedure" is the difference between two prompt edits.
ENDING_CHECKS = [
    ("every_option_pooled",
     "Were ALL THREE candidates pooled — did the group say aloud, for each candidate, what "
     "they knew about them? Name any candidate that was skipped."),
    ("tallies_said_aloud",
     "Did the STUDENTS say the counts out loud (e.g. 'that's three concerns')? It does not "
     "count if the facilitator supplied the number."),
    ("mechanism_named",
     "Did the students name the mechanism in their OWN words — that each of them held "
     "different pieces, that shared items got over-weighted and unique items went unsaid?"),
    ("procedure_written",
     "Did the group produce a numbered, transferable procedure they could hand to another "
     "team? A vague sentiment like 'share more' does not count."),
    ("facilitator_nudged_to_finish",
     "Did the FACILITATOR actively steer the group toward writing that procedure, or did "
     "the students get there on their own / not at all?"),
    ("facilitator_closed",
     "Did the facilitator recognise the session was complete and close it, rather than "
     "continuing to ask questions past the point where everything was done?"),
    ("summarised_the_lesson",
     "Did the facilitator summarise or explain the lesson at the end? The prompt forbids "
     "this — 'Do not summarize the lesson' — so YES here is a FAILURE."),
]

ENDING_JUDGE_SYSTEM = """You are auditing a transcript of a facilitated debrief to \
establish how far it got. Be strict and literal: judge only what is actually in the \
transcript, never what the facilitator seemed to be aiming at.

Answer each question with "yes", "no", or "partial", and quote the single line of \
transcript that best justifies your answer. If nothing justifies it, say so.

Reply with ONLY a JSON object:
{"checks": [{"id": "...", "verdict": "yes|no|partial", "evidence": "...", "note": "..."}],
 "furthest_step": "the last step of the sequence the facilitator actually reached",
 "verdict": "one sentence on whether this session finished"}"""


def judge_ending(out, room, chosen, config):
    """Audit a finished run against the prompt's own ENDING conditions.

    Exists because "did it finish?" cannot be read off the turn count. A run can end
    because the students dried up, because a cap was hit, or because the facilitator
    judged the work done — and only the third is success. `[END]` firing tells you the
    facilitator *thinks* it finished; this tells you whether it was right.
    """
    client = ai_manager._get_client()
    if client is None:
        out("\n(no API key — skipping the ending audit)")
        return

    transcript = "\n".join(f"{m['sender']}: {m['text']}" for m in room.messages)
    questions = "\n".join(f"{i}. [{cid}] {q}" for i, (cid, q) in enumerate(ENDING_CHECKS, 1))
    user = (f"The group hired {chosen}.\n\nTRANSCRIPT\n{transcript}\n\n"
            f"QUESTIONS\n{questions}")
    try:
        msg = client.messages.create(
            model=ai_manager.FACILITATOR_MODEL, max_tokens=2000, temperature=0,
            system=[{"type": "text", "text": ENDING_JUDGE_SYSTEM}],
            messages=[{"role": "user", "content": user}],
        )
    except Exception as exc:  # noqa: BLE001
        out(f"\n(ending audit failed: {exc})")
        return

    data = ai_manager._extract_json(ai_manager._text_from_message(msg))
    if not data:
        out("\n(ending audit returned no usable JSON)")
        return

    out("\nDID THE SESSION ACTUALLY FINISH?")
    out("-" * 100)
    # `summarised_the_lesson` inverts: the prompt forbids it, so yes is the failure.
    for check in data.get("checks") or []:
        cid = check.get("id", "?")
        verdict = (check.get("verdict") or "?").lower()
        good = (verdict == "no") if cid == "summarised_the_lesson" else (verdict == "yes")
        mark = "PASS" if good else ("~~~~" if verdict == "partial" else "FAIL")
        out(f"  {mark}  {cid:<30} {verdict}")
        if check.get("evidence"):
            out(f"        \033[90m{str(check['evidence'])[:150]}\033[0m")
        if check.get("note"):
            out(f"        {str(check['note'])[:150]}")
    out("-" * 100)
    out(f"furthest step reached: {data.get('furthest_step', '?')}")
    out(f"verdict: {data.get('verdict', '?')}")

    # The stock prompt's ENDING block points at a step that does not exist; if the run
    # failed to close, that is the first thing to suspect.
    body = (config.get("manager_exercise") or {}).get("facilitator_prompt_override") or ""
    if "step 13" in (body or FACILITATOR_PROMPT_TEXT).lower():
        out("\nNOTE: the ENDING block says the session 'ends at step 13', but the sequence "
            "only reaches F7/S7. There is no step 13 to arrive at, so the close condition "
            "is unreachable as written.")


def render_violations(out, violations):
    """The run's constraint tally.

    This is the whole reason the rules became data. Reading a transcript and noticing that
    ACTR did the counting for them is slow and unreliable; "does_their_counting: 3" is not.
    A count of zero is worth printing too — it is what tells you a prompt block you deleted
    was doing nothing.
    """
    if not violations:
        out("constraint violations: none caught")
        return
    out("constraint violations caught (draft was rewritten or held):")
    for cid, n in sorted(violations.items(), key=lambda kv: -kv[1]):
        out(f"  {n:>3}  {cid}")


def load_series(ref):
    """Parse a fixture in `testable_manager_mds/` into the same shape a room replay uses.

    Reads the `**Hired:**` line, the student/role table and the fenced transcript. `ref`
    may be a full path, a filename, or just the leading number ("04").
    """
    path = ref if os.path.isfile(ref) else None
    if path is None:
        for fn in sorted(os.listdir(SERIES_DIR)):
            if fn.endswith(".md") and (fn == ref or fn.startswith(str(ref).zfill(2))):
                path = os.path.join(SERIES_DIR, fn)
                break
    if path is None:
        raise SystemExit(f"no series matching {ref!r} in {SERIES_DIR}")

    text = open(path, encoding="utf-8").read()
    hired = re.search(r"\*\*Hired:\*\*\s*([^·\n|]+)", text)
    hired = hired.group(1).strip() if hired else None

    # The roster table is the first two-column table whose header is Student | Role.
    roster = []
    table = re.search(r"\|\s*Student\s*\|\s*Role\s*\|(.+?)\n\n", text, re.S)
    if table:
        for row in table.group(1).splitlines():
            cells = [c.strip().strip("*") for c in row.strip().strip("|").split("|")]
            if len(cells) >= 2 and cells[0] and not set(cells[0]) <= set("-: "):
                name = cells[0].split("—")[0].strip()
                roster.append({"uid": name, "name": name,
                               "role": cells[1].split("—")[0].strip()})

    # Optional `## Personas` block: one `Name — character` line per student. Only live
    # mode reads it; a replay run ignores it entirely.
    personas = {}
    pblock = re.search(r"##\s*Personas\s*\n(.*?)(?:\n##\s|\Z)", text, re.S)
    if pblock:
        for line in pblock.group(1).splitlines():
            row = re.match(r"\s*[-*]\s*\*\*(.+?)\*\*\s*[—-]\s*(.+)", line.strip())
            if row:
                personas[row.group(1).strip()] = row.group(2).strip()

    block = re.search(r"```\s*\n(.*?)```", text, re.S)
    if not block:
        raise SystemExit(f"{os.path.basename(path)} has no fenced transcript block")

    messages, turn = [], 1
    for line in block.group(1).splitlines():
        line = line.strip()
        if not line or line.startswith(">"):
            continue
        if line.startswith("---") and "pause" in line:
            # Marks a gap long enough that the live room's silence watcher would fire.
            messages.append({"turn": turn, "sender": None, "text": None, "pause": True})
            continue
        if ":" not in line:
            continue
        sender, body = line.split(":", 1)
        messages.append({"turn": turn, "sender": sender.strip(),
                         "text": body.strip(), "pause": False})
        turn += 1
    return os.path.basename(path), hired, roster, messages, personas


# --------------------------------------------------------------------------- #
# Mongo
# --------------------------------------------------------------------------- #
def connect():
    """Connect to Atlas over a plain `mongodb://` seedlist.

    `mongodb+srv://` needs a UDP:53 SRV lookup, which is blocked on some networks this
    runs from. The seedlist and replica-set name below are what that lookup returns, so
    this is the same cluster reached a different way. Returns the app's database handle.
    """
    from pymongo import MongoClient

    env_path = os.path.join(_BACKEND, ".env")
    raw = open(env_path, encoding="utf-8", errors="ignore").read()
    srv = re.search(r'MONGO_URI\s*=\s*"?(mongodb\+srv://[^"\s]+)"?', raw).group(1)
    creds = re.match(r"mongodb\+srv://([^:]+):([^@]+)@([^/?]+)", srv)
    user, pwd, host = creds.group(1), creds.group(2), creds.group(3)
    dbname = re.search(r'MONGO_DB_NAME\s*=\s*"?([^"\s]+)"?', raw).group(1)

    cluster = host.split(".")[0]
    domain = host.split(".", 1)[1]
    hosts = ",".join(f"{cluster}-shard-00-0{i}.{domain}:27017" for i in range(3))
    uri = (f"mongodb://{quote_plus(user)}:{quote_plus(pwd)}@{hosts}/"
           f"?ssl=true&replicaSet=atlas-95br9m-shard-0&authSource=admin")
    return MongoClient(uri, serverSelectionTimeoutMS=20000)[dbname]


def load_room(db, room_id):
    """Fetch one room: its session doc, its messages in turn order, and its config doc."""
    from bson import ObjectId

    session = db["manager_exercise_sessions"].find_one({"room_id": room_id})
    if not session:
        raise SystemExit(f"no manager_exercise_sessions doc for room_id={room_id!r}")

    messages = list(db["group_chat_messages"].find({"room_id": room_id}).sort("turn", 1))

    # Messages carry no config_id; the room_id is `{config_id}_{suffix}`.
    config_id = session.get("config_id") or room_id.rsplit("_", 1)[0]
    config = db["config_collections"].find_one({"_id": ObjectId(config_id)})
    if not config:
        raise SystemExit(f"no config_collections doc for _id={config_id!r}")
    return session, messages, config


def list_rooms(db):
    """Print every recorded room, busiest first, so you can pick one to replay."""
    rows = []
    for s in db["manager_exercise_sessions"].find({}):
        rid = s.get("room_id")
        msgs = list(db["group_chat_messages"].find({"room_id": rid}, {"sender": 1}))
        actr = sum(1 for m in msgs if m.get("sender") == "ACTR")
        rows.append((len(msgs), actr, rid, s.get("phase"), s.get("chosen_candidate"),
                     len(s.get("roster") or [])))
    rows.sort(reverse=True)
    print(f"{'msgs':>5}{'actr':>5}{'seats':>6}  {'phase':<9}{'chosen':<14}room")
    for n, actr, rid, phase, chosen, seats in rows:
        print(f"{n:>5}{actr:>5}{seats:>6}  {str(phase):<9}{str(chosen):<14}{rid}")


# --------------------------------------------------------------------------- #
# The stand-in for ExerciseState + ConversationContext
# --------------------------------------------------------------------------- #
class ReplayRoom:
    """Recomputes the handful of values the facilitator reads off the live room objects.

    Deliberately a reimplementation rather than a stub of `ExerciseState`: that class
    wants Mongo and a socket server in its constructor, while the facilitator only ever
    consumes `turn_context()`, a transcript summary and a few recent ACTR turns. Keeping
    those four small computations visible here is what makes the sandbox auditable — if
    the replay disagrees with production, the disagreement is on this page.

    Mirrors `ExerciseState.turn_context` (exercise_state.py:1313) and
    `ConversationContext.get_context_summary` (context_manager.py:100) field for field.
    """

    def __init__(self, roster, group_size, history):
        self.roster = roster
        self.group_size = group_size
        self.history = history
        self.messages = []              # [{turn, sender, text}] — replayed, not recorded
        self.msgs_since_facilitator = 0
        self.pending_go_around = None   # {"expected": [name], "received": [name]}

    # -- transcript ------------------------------------------------------- #
    def post(self, sender, text):
        self.messages.append({"turn": len(self.messages) + 1, "sender": sender, "text": text})

    def summary(self):
        """`ConversationContext.get_context_summary`. `history=0` means the whole room."""
        if not self.messages:
            return "No messages yet."
        recent = self.messages if self.history <= 0 else self.messages[-self.history:]
        out = f"**Total Turns**: {len(self.messages)}\n\n### Recent Messages:\n"
        for m in recent:
            out += f"[{m['turn']}] **{m['sender']}**: {m['text']}\n"
        return out

    def full_transcript(self):
        """The whole debrief, unwindowed.

        `summary()` is what the facilitator reads and is deliberately capped — but the
        progress checker is asking what the room has ever established, and a capped view
        makes an objective un-achieve when its evidence scrolls off the end.
        """
        return "\n".join(f"{m['sender']}: {m['text']}" for m in self.messages)

    def recent_asks(self, limit=4):
        """`ConversationContext.recent_by_sender('ACTR', 4)` — feeds the repeat guard."""
        return [m["text"] for m in self.messages if m["sender"] == "ACTR"][-limit:]

    # -- turn bookkeeping ------------------------------------------------- #
    def note_student(self, name):
        self.msgs_since_facilitator += 1
        if self.pending_go_around and name not in self.pending_go_around["received"]:
            self.pending_go_around["received"].append(name)

    def note_facilitator(self, go_around):
        self.msgs_since_facilitator = 0
        # `clear_go_around` fires whenever ACTR speaks (group_chat_sockets.py:316), so a
        # new go-around replaces the old one and any other turn ends it.
        self.pending_go_around = (
            {"expected": [e["name"] for e in self.roster], "received": []}
            if go_around else None
        )

    def turn_context(self, addressed, silence, quiet_seconds):
        outstanding, answered = [], []
        if self.pending_go_around:
            received = set(self.pending_go_around["received"])
            outstanding = [n for n in self.pending_go_around["expected"] if n not in received]
            answered = [n for n in self.pending_go_around["expected"] if n in received]
        return {
            "addressed": addressed,
            "silence": silence,
            "go_around_open": bool(self.pending_go_around),
            "outstanding": outstanding,
            "answered": answered,
            "msgs_since_facilitator": self.msgs_since_facilitator,
            "seconds_since_last_message": quiet_seconds,
            "seconds_since_you_spoke": None,
        }


# --------------------------------------------------------------------------- #
# Replay
# --------------------------------------------------------------------------- #
def parse_ts(value):
    """Recorded timestamps are naive `datetime.now().isoformat()` strings. None if unusable."""
    try:
        return datetime.fromisoformat(str(value))
    except (TypeError, ValueError):
        return None


def outcome_text_for(config, chosen):
    """The outcome document the room read, pinned into every turn like production does."""
    for cand in (config.get("manager_exercise") or {}).get("candidates") or []:
        if (cand.get("name") or "").strip().lower() == (chosen or "").strip().lower():
            return (cand.get("forecast_text") or "").strip()
    return ""


def candidate_names(config):
    """Every candidate name in the case pack — lets the progress checker verify that a
    claimed comparison actually names more than one of them."""
    pack = (config.get("manager_exercise") or {}).get("case_pack") or {}
    return [o.get("name") for o in pack.get("options") or [] if o.get("name")]


def verdict_for(config, chosen):
    """'success' / 'failure' for the hire, off the case pack. `ExerciseState._verdict_for`.

    The opener branches on this: a failure gets "could you have seen that coming?", a
    success gets "why did you choose them?".
    """
    pack = (config.get("manager_exercise") or {}).get("case_pack") or {}
    for option in pack.get("options") or []:
        if (option.get("name") or "").strip().lower() == (chosen or "").strip().lower():
            return option.get("outcome_verdict")
    return None


def solo_spread_from(session):
    """Anonymous round-0 counts. `ExerciseState.solo_spread` — counts only, never names."""
    spread = {}
    for candidate in ((session.get("solo_ballot") or {}).get("votes") or {}).values():
        if candidate:
            spread[candidate] = spread.get(candidate, 0) + 1
    return spread


def replay(source, session, messages, config, args, personas=None):
    out = Tee()
    personas = personas or {}
    meter = UsageMeter()
    meter.install()
    me_config = config.get("manager_exercise") or {}
    roster = [e for e in (session.get("roster") or []) if (e or {}).get("name")]
    group_size = len(roster) or me_config.get("num_students") or 3
    chosen = session.get("chosen_candidate")
    outcome = outcome_text_for(config, chosen)
    spread = solo_spread_from(session)

    if args.prompt:
        me_config = dict(me_config)
        me_config["facilitator_prompt_override"] = open(args.prompt, encoding="utf-8").read()
    if args.model:
        ai_manager.FACILITATOR_MODEL = args.model

    system = build_facilitator_system(me_config, roster, group_size)
    out("=" * 100)
    out(f"source     {source}")
    out(f"seats      {group_size}  ({', '.join(e['name'] for e in roster) or 'none'})")
    out(f"hired      {chosen}  ({verdict_for(config, chosen)})"
        f"   |  private picks: {spread or 'none recorded'}")
    out(f"model      {ai_manager.FACILITATOR_MODEL}")
    out(f"history    {'whole room' if args.history <= 0 else str(args.history) + ' messages'}")
    out(f"prompt     {args.prompt if args.prompt else 'stock FACILITATOR_PROMPT'}")
    out(f"assembled  {len(system):,} chars  (~{len(system)//4:,} tokens)")
    out("=" * 100)
    if args.show_prompt:
        out(system)
        out("=" * 100)
    if args.dry_run:
        out("dry run — no model calls made")
        if args.name:
            out(f"\nsaved: {out.save(args.name, system)}")
        return

    # Fail loudly. Every ai_manager entry point degrades to silence on a missing key, so
    # without this check a misconfigured run produces a plausible-looking all-silent
    # transcript and you conclude the facilitator got quieter.
    if not os.getenv("ANTHROPIC_API_KEY"):
        raise SystemExit("ANTHROPIC_API_KEY is not set — every turn would fail soft to "
                         "silence and the run would look like a well-behaved quiet room.")

    # Counted across the run so a prompt edit can be judged by numbers rather than by
    # reading the transcript and hoping to notice.
    violations = {}
    # Boxed so `take_turn` reads the latest reading without a nonlocal rebind. Refreshed
    # every few student turns rather than every one — it is a third model call and the
    # answer moves slowly.
    progress = [None]
    room = ReplayRoom(roster, group_size, args.history)
    # A scripted series has no outcome document in its transcript, so the debrief is
    # already open at message one; a recorded room opens it when the document is posted.
    in_debrief = bool(args.series)
    opened = False
    asked = spoke = 0
    prev_ts = None
    pending_pause = False

    def take_turn(addressed, silence, quiet, label="now"):
        nonlocal asked, spoke
        asked += 1
        result = ai_manager.facilitator_reply(
            me_config, roster, group_size, room.summary(),
            chosen_name=chosen,
            turn_context=room.turn_context(addressed, silence, quiet),
            solo_spread=spread, recent_asks=room.recent_asks(), outcome_text=outcome,
            progress=progress[0],
        )
        reply = result.get("message")
        # Shown here because this is a tuning tool — in the live room it is stored on the
        # message document and never rendered.
        if result.get("reasoning"):
            out(f"      \033[90m(thinking: {result['reasoning'][:200]})\033[0m")
        for violation in result.get("violations") or []:
            violations[violation["id"]] = violations.get(violation["id"], 0) + 1
            out(f"      \033[91m(caught {violation['id']}: \"{violation['quote'][:90]}\")\033[0m")
        if result.get("suppressed"):
            out("      \033[91m(held — could not write it cleanly in two tries)\033[0m")
        if not reply:
            out(f"      \033[92m{label}: (silent)\033[0m")
            return False
        spoke += 1
        room.post("ACTR", reply)
        room.note_facilitator(result.get("go_around"))
        flags = "".join([" [GO_AROUND]" if result.get("go_around") else "",
                         " [END]" if result.get("ended") else ""])
        out(f"      \033[96m{label}: {reply}\033[0m{flags}")
        return bool(result.get("ended"))

    def open_debrief():
        """Production opens through a SEPARATE entry point whose task says "write your
        FIRST message, do not reply SILENT" (`_open_debrief`, group_chat_sockets.py:214).
        The reactive path is never asked to open, so without this ACTR has no turn it is
        obliged to take and stays silent for the whole room."""
        nonlocal asked, spoke
        asked += 1
        opener, reasoning = ai_manager.facilitator_open_debrief(
            me_config, roster, group_size,
            chosen_name=chosen, verdict=verdict_for(config, chosen))
        if reasoning:
            out(f"      \033[90m(thinking: {reasoning[:200]})\033[0m")
        if opener:
            spoke += 1
            room.post("ACTR", opener)
            room.note_facilitator(False)
            out(f"      \033[96mnow: {opener}\033[0m")

    if args.live:
        # HYBRID MODE. The students are played by a model, so they answer the question
        # ACTR actually asked — which is the only way to see whether a question landed.
        # Their identity is still pinned: character from the fixture, packet from the case
        # pack, and their scripted lines carried as an agenda that drains as they speak.
        students = build_students(roster, personas, messages, config, chosen)
        order = list(students.values())
        out(f"\n--- LIVE: {len(order)} students on {STUDENT_MODEL} ---")
        for s in order:
            out(f"    {s.name} ({s.role}) — {s.character or 'ordinary student'}")
        out("\n--- debrief opens ---")
        open_debrief()

        turn = 0
        stalled = 0
        ended_at = None
        # A quiet room is the one condition the prompt says ACTR MUST speak into, and also
        # the one where filling every gap turns the session into an interview. Counting
        # both halves is the only way to tell which failure a run produced.
        quiet_asks = quiet_spoke = 0
        # Stall tolerance is generous on purpose. A run that stops because the students
        # ran dry tells you nothing about whether the facilitator knows the session is
        # over — and that is the whole question an endurance run asks. Let the room go
        # quiet several times over and see whether ACTR ever closes it.
        stall_limit = max(3, len(order) * 2)
        while turn < args.turns and stalled < stall_limit:
            speaker = pick_speaker(students, room, order)
            text = speaker.speak(room.summary(), speaker.wind_down_nudge())
            if not text:
                stalled += 1
                # A pass is a real pause in the room, so give ACTR the silence flag it
                # would get live — this is exactly when it should be closing or nudging.
                out(f"\n      ... the room has gone quiet ({stalled} in a row) ...")
                quiet_asks += 1
                before = spoke
                closed = take_turn(False, True, float(SILENCE_SECONDS + 6),
                                   label="now (quiet)")
                if spoke > before:
                    quiet_spoke += 1
                if closed:
                    ended_at = turn
                    out("      --- ACTR closed the session ---")
                    break
                continue
            stalled = 0
            turn += 1
            speaker.last_spoke_at = len(room.messages)
            room.post(speaker.name, text)
            room.note_student(speaker.name)
            out(f"\n[{turn}] {speaker.name}: {text}")
            if not args.no_progress and turn % args.progress_every == 0:
                # `full_transcript()`, NOT `summary()` — the facilitator's rolling window
                # is the wrong input for "what has this room established", and using it
                # made objectives regress as their evidence scrolled out of view.
                before = set((progress[0] or {}).get("met") or [])
                progress[0] = ai_manager.assess_progress(
                    room.full_transcript(), chosen, previous=progress[0],
                    candidates=candidate_names(config))
                reading = progress[0]
                if reading:
                    gained = [m for m in reading["met"] if m not in before]
                    out(f"      \033[94m[objectives {len(reading['met'])}/4"
                        + (" — READY TO CLOSE" if reading["ready"] else "") + "]\033[0m")
                    for mid in gained:
                        quote = (reading.get("evidence") or {}).get(mid, "")
                        out(f"      \033[94m  + {mid}: \"{quote[:110]}\"\033[0m")
            if take_turn("actr" in text.lower(), False, 0.0):
                ended_at = turn
                out("      --- ACTR closed the session ---")
                break

        out("\n" + "=" * 100)
        if ended_at is not None:
            out(f"ENDED: ACTR emitted {ai_manager.END_MARKER} at student turn {ended_at}.")
        elif stalled >= stall_limit:
            out(f"DID NOT END: the room went quiet {stalled} times running and ACTR never "
                f"closed it. Live, this room would run until the debrief timer expired.")
        else:
            out(f"DID NOT END: hit the {args.turns}-turn cap with ACTR still going. "
                f"Raise --turns to see whether it ever closes.")
        out(f"asked {asked} times, spoke {spoke} ({spoke / asked:.0%})" if asked
            else "no turns taken")
        out(f"student messages per ACTR turn — {(asked / spoke) if spoke else 0:.1f} "
            f"(the prompt asks for 4-6)")
        out("agenda left: " + ", ".join(f"{s.name} {len(s.agenda)}" for s in order))
        if quiet_asks:
            out(f"awkward pauses: {quiet_asks} — ACTR spoke into {quiet_spoke}, "
                f"stayed silent through {quiet_asks - quiet_spoke}")
        else:
            out("awkward pauses: none — the room never went quiet")
        render_violations(out, violations)
        out("=" * 100)

        if not args.no_judge:
            judge_ending(out, room, chosen, config)
        # Rendered last so it includes the ending audit's own call.
        out("")
        meter.render(out)
        if args.name:
            out(f"\nsaved: {out.save(args.name, system)}")
        return

    for msg in messages:
        if msg.get("pause"):
            pending_pause = True
            continue

        sender = (msg.get("sender") or "").strip()
        text = (msg.get("text") or "").strip()
        ts = parse_ts(msg.get("timestamp"))

        # The outcome document opens the debrief. Everything before it is rounds 0-1,
        # which ACTR is never present for (`ExerciseState.facilitator_active`).
        if sender.startswith(OUTCOME_PREFIX):
            room.post(sender, text)
            in_debrief = True
            out(f"\n--- OUTCOME POSTED — debrief opens (turn {msg.get('turn')}) ---")
            prev_ts = ts
            open_debrief()
            opened = True
            continue

        if not in_debrief or sender in SYSTEM_SENDERS:
            room.post(sender, text)
            prev_ts = ts
            continue

        # ACTR's recorded turns are NOT replayed into the transcript — the whole point is
        # to see what it says instead. They are printed for comparison only.
        if sender == "ACTR":
            out(f"      \033[90mwas: {text}\033[0m")
            continue

        if not opened:
            out("\n--- debrief opens ---")
            open_debrief()
            opened = True

        room.post(sender, text)
        room.note_student(sender)
        out(f"\n[{msg.get('turn')}] {sender}: {text}")

        # Real rooms carry timestamps; a scripted series marks long gaps with `--- pause ---`.
        quiet = 0.0
        if ts and prev_ts:
            quiet = max(0.0, (ts - prev_ts).total_seconds())
        elif pending_pause:
            quiet = float(SILENCE_SECONDS + 6)
        prev_ts = ts

        spoke_now = take_turn("actr" in text.lower(), False, round(quiet, 1))
        if spoke_now:
            out("      --- ACTR closed the session ---")
            break
        pending_pause = False

    was = sum(1 for m in messages if (m.get("sender") or "") == "ACTR")
    out("\n" + "=" * 100)
    out(f"asked {asked} times, spoke {spoke} ({spoke / asked:.0%})" if asked
        else "no turns taken")
    if was:
        out(f"the recorded run spoke {was} times")
    out(f"student messages per ACTR turn — {(asked / spoke) if spoke else 0:.1f} "
        f"(the prompt asks for 4-6)")
    render_violations(out, violations)
    out("=" * 100)
    out("")
    meter.render(out)

    if args.name:
        out(f"\nsaved: {out.save(args.name, system)}")


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    src = ap.add_argument_group("what to run")
    src.add_argument("--room", help="room_id of a recorded room to replay")
    src.add_argument("--series", help="scripted fixture: a number (04), filename, or path")
    src.add_argument("--config", default=DEFAULT_CONFIG_ID,
                     help="config doc supplying the case pack when running a --series")
    src.add_argument("--list", action="store_true", help="list recorded rooms and series, then exit")

    knobs = ap.add_argument_group("what to vary")
    knobs.add_argument("--prompt", help="file whose contents replace FACILITATOR_PROMPT")
    knobs.add_argument("--model", help="override MANAGER_EXERCISE_MODEL, e.g. claude-opus-4-1")
    knobs.add_argument("--history", type=int, default=DEFAULT_HISTORY,
                       help="transcript messages shown per turn; 0 = the whole room")
    knobs.add_argument("--live", action="store_true",
                       help="students are played by a model and REACT to ACTR, keeping "
                            "their character, packet and agenda. Requires --series.")
    knobs.add_argument("--no-progress", action="store_true",
                       help="do not assess learning objectives; ACTR gets no sense of an "
                            "ending and runs until the turn cap, as it did before")
    knobs.add_argument("--progress-every", type=int, default=4,
                       help="reassess the objectives every N student turns")
    knobs.add_argument("--turns", type=int, default=70,
                       help="max student messages in --live mode; raise it for an "
                            "endurance run that tests whether ACTR ever closes")

    outp_pre = ap.add_argument_group("ending audit")
    outp_pre.add_argument("--no-judge", action="store_true",
                          help="skip the end-of-run audit against the ENDING conditions")

    outp = ap.add_argument_group("output")
    outp.add_argument("--name", help='name this run; saves runs/<date>_<slug>.txt')
    outp.add_argument("--show-prompt", action="store_true", help="print the assembled system prompt")
    outp.add_argument("--dry-run", action="store_true", help="assemble and print, make no model calls")
    args = ap.parse_args()

    if args.series:
        from bson import ObjectId
        name, hired, roster, messages, personas = load_series(args.series)
        config = connect()["config_collections"].find_one({"_id": ObjectId(args.config)})
        if not config:
            raise SystemExit(f"no config_collections doc for _id={args.config!r}")
        session = {"room_id": name, "roster": roster, "chosen_candidate": hired,
                   "solo_ballot": {"votes": {}}}
        mode = "live" if args.live else "scripted"
        replay(f"series {name} ({mode})", session, messages, config, args, personas)
        return

    if args.live:
        raise SystemExit("--live needs --series (a recorded room's students cannot be replayed live)")

    db = connect()
    if args.list or not args.room:
        list_rooms(db)
        print("\nseries:")
        for fn in sorted(os.listdir(SERIES_DIR)):
            if fn.endswith(".md") and fn != "README.md":
                print(f"  {fn}")
        if not args.room:
            print("\npick one with --room <room_id> or --series <nn>")
        return
    session, messages, config = load_room(db, args.room)
    replay(f"room {args.room}", session, messages, config, args)


if __name__ == "__main__":
    main()
