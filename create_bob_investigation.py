# @language  Python
# @updated   2026-08-31
# @changed   One-off: build the "What About Bob" investigation exercise on the hkustmg account from
#            the three case-file PDFs in backend/uploads.
"""Creates the 'What About Bob' manager-exercise config in Mongo.

WHAT THIS CASE IS
    A hidden-profile murder file. Robert Guion is dead; three people each read a
    DIFFERENT version of the investigation file, name a suspect alone, then have to
    agree on one as a group. Every version carries the same five core interviews.
    What differs is the last third, and that is where the answer lives:

      Case File 1  Dave Daniels — a wallet dumped behind the Quick Shop at 7 a.m.,
                   money gone but the credit cards thrown away, and a QUIET car
                   heard leaving. Billy Prentice's car has a loud muffler; Malone
                   puts himself "across from Eastwood" at exactly that time.
      Case File 2  Millie Smith and Rick Rooney — Malone at the café 6:30-6:45, two
                   coffees fast, big tip, gone without waiting for the bill; on the
                   course "around 7:00, as usual".
      Case File 3  Marion Guion's follow-up — nobody could have driven UP without
                   her seeing them (so the 6:40 car was the killer LEAVING), Eddie
                   Sullivan is deaf without his hearing aid and doesn't wear it at
                   work, and Billy's gambling is real but two years old.

    Read alone, every version points at Billy Prentice: fingerprints on the crowbar,
    gambling debts, lied about being there, fled the scene. That is the trap. Pooled,
    Billy arrives at 7:00 — after a death the coroner puts at 6:30-7:00 and Marion
    times at 6:40 — and the wallet was dumped by a quiet car at the one place Malone
    volunteered he was standing. Malone had the motive on paper: Guion's own memo
    threatens to tell his customers and every other dealer about MM Auto Parts.

    The answer is MICKEY MALONE.

WHY THE ANSWER IS NEVER SHOWN TO STUDENTS
    This config runs the `investigation` template: no outcome reveal, no debrief.
    The room commits to a name and stops. The professor reads every group's answer,
    every individual's private pick and which file they held on
    /manager-exercise/<id>/results, and runs the debrief from there.

Idempotent: skips if a config with the same bot_name already exists on the account.
Re-run with --force to replace the existing one's manager_exercise sub-object.
"""
import os
import re
import sys
from datetime import datetime

import fitz  # PyMuPDF
from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("backend/.env")

BOT_NAME = "What About Bob"
CLASS_CODE = "whataboutbob"
OWNER_USER_ID = "68794c7e848dfc3f253b297e"  # yonathanakl@gmail.com (hkustmg)

# The three case files, in the order their roles are handed out (join order).
CASE_FILES = [
    ("Case File 1", "backend/uploads/What About Bob final.pdf"),
    ("Case File 2", "backend/uploads/What About Bob# final.pdf"),
    ("Case File 3", "backend/uploads/What About Bob@ final.pdf"),
]

# Everyone named in the depositions who could plausibly have done it. Sue Sullivan
# is on the list although she is never interviewed — she is the one the wife points
# at, which is exactly the kind of accusation a group has to weigh.
SUSPECTS = [
    "Mickey Malone",
    "Billy Prentice",
    "Eddie Sullivan",
    "Marion Guion",
    "Sue Sullivan",
]
ANSWER = "Mickey Malone"


# --------------------------------------------------------------------------- #
# PDF → case file text
# --------------------------------------------------------------------------- #
# Speaker labels as the depositions write them. Matched so each turn becomes one
# paragraph ("Lt. M: ...") instead of a label stranded on its own line, which the
# student-facing brief parser would render as a section heading.
_SPEAKER = re.compile(
    r"^(Lt\.?\s*M\.?|M\.?\s*G\.?|Ed\s*S\.?|M\.?\s*M\.?|B\.?\s*P\.?"
    r"|S\.?\s*N\.?|R\.?\s*R\.?|M\.?\s*S\.?|D\.?\s*D\.?)\s*:\s*(.*)$", re.I)

# The memo is identical in all three files and the PDF sets it in a layout PyMuPDF
# interleaves badly, so it is written out here rather than extracted.
_MEMO = [
    "MEMO - Guion Lincoln/Mercury, from the desk of Robert Guion",
    "Mickey,",
    "I am very upset about the substandard parts that I have been receiving from you. "
    "I know we've had our problems in the past, but I never thought you would go this far. "
    "I am a man of integrity and will not tolerate such maneuvering from business colleagues. "
    "Needless to say, I will have to notify my customers and other dealers about the quality "
    "of MM auto parts.",
    "Robert Guion",
]


def _heading(block):
    """Collapse an "Excerpts from / Lt. Moody's Interview with X" block to one line.

    Kept under 70 characters and free of terminal punctuation, because that is what
    the student-facing brief parser treats as a section heading — a longer one would
    render as body prose and the file would lose its structure.
    """
    h = re.sub(r"\s+", " ", block).strip()
    h = re.sub(r"^Excerpts from\s*", "", h, flags=re.I)
    kind = ("FOLLOW-UP INTERVIEW" if re.search(r"follow-?up", h, re.I)
            else "FINAL INTERVIEW" if re.search(r"final interview", h, re.I)
            else "INTERVIEW")
    m = re.search(r"interview\s*(?:with)?\s*(.*)$", h, re.I)
    who = re.sub(r"^with\s+", "", (m.group(1) if m else h).strip(" ,"), flags=re.I)
    who = re.sub(r"\s*\([^)]*\)\s*", " ", who)      # drop the "(M.G.)" initials
    who = re.sub(r"\s+", " ", who).strip(" ,")
    label = "%s - %s" % (kind, who)
    return label[:67].rstrip(" ,") if len(label) > 70 else label


def case_text(path):
    """One case file as clean prose: page 4 to the end, the interviews and the memo.

    Pages 1-3 are dropped deliberately. They are the task instructions, the
    hand-in slip for the individual answer, and the newspaper article — all three
    identical across the versions, and all three already live in `general_info`,
    which every student sees on the shared premise screen.
    """
    doc = fitz.open(path)
    raw = "\n\n".join(doc[i].get_text() for i in range(3, len(doc)))
    raw = re.sub(r"[ \t]+", " ", raw)
    chunks = [c.strip() for c in re.split(r"\n\s*\n", raw) if c.strip()]

    # A page break can leave "Excerpts from" alone in its own chunk; rejoin it with
    # the header lines that follow before anything else looks at it.
    merged = []
    for c in chunks:
        if merged and re.fullmatch(r"Excerpts from", merged[-1].strip(), re.I):
            merged[-1] += "\n" + c
        else:
            merged.append(c)

    out = []
    for c in merged:
        if re.match(r"^Excerpts from", c, re.I):
            out.append(_heading(c))
            continue
        if re.match(r"^GUION LINCOLN", c, re.I):
            out.extend(_MEMO)       # the memo always closes the file
            break
        lines = [l.strip() for l in c.split("\n") if l.strip()]
        if not lines:
            continue
        m = _SPEAKER.match(lines[0])
        if m:
            label = re.sub(r"\s+", " ", m.group(1)).strip()
            body = " ".join([m.group(2).strip()] + lines[1:]).strip()
            out.append("%s: %s" % (label, body) if body else label)
        else:
            joined = " ".join(lines)
            # A page break can split one answer in two. Re-join when the previous
            # block does not close a sentence.
            if out and not re.search(r"[.!?:”\"']$", out[-1]):
                out[-1] += " " + joined
            else:
                out.append(joined)
    return "\n\n".join(out)


# --------------------------------------------------------------------------- #
# The shared brief — what every student reads before opening their own file
# --------------------------------------------------------------------------- #
GENERAL_INFO = """The Case of Robert Guion

Robert Guion has been murdered. In the pages that follow there are several depositions from relevant parties and potential suspects in the murder. Your task is to determine, to the best of your ability, the most likely suspect in the murder of Robert Guion. First, make that judgment on your own. Then, with your team, you must come to agreement on the most likely suspect.

Please note - you will not be able to view these materials in the team meeting.

FROM THE VALLEY SENTINEL - Local businessman murdered

Robert Guion, a prominent local business man, was found dead behind his Crestview home this morning. Detective Lt. Mark Moody of the Hilltown precinct reported that Mr. Guion had apparently been assaulted when leaving his home to play golf early this morning. He was struck on the head over the left eye and fell down a flight of stairs leading from a second story deck at the rear of the house.

The preliminary coroner's report concluded that death was caused by injuries sustained from the fall and not from the blow to the head. The report estimated that Mr. Guion's death occurred between 6:30 and 7:00 a.m. Lt. Moody would neither confirm nor deny rumors that Mr. Guion had been robbed. "We're following all leads. That's all I have to say for now," said Lt. Moody."""


# --------------------------------------------------------------------------- #
# The answer key — never sent to a student client
# --------------------------------------------------------------------------- #
CANDIDATE_SUMMARY = """ANSWER KEY - The Case of Robert Guion. The killer is Mickey Malone.

THE TRAP
Every case file carries the same five core depositions, and read alone every one of them points at Billy Prentice: he lied about being there, he has gambling debts, he borrowed money from the victim two days before, his fingerprints are on the crowbar, and he fled the scene. That is the shared, salient, wrong answer. The evidence that clears Billy and convicts Malone is split three ways, so no single reader holds it.

THE TIMELINE
Death is 6:30-7:00 a.m. (coroner). Marion hears her husband on the phone about 6:00, then a shout, a groan and a fall at 6:40, then a car on the gravel. Eddie Sullivan arrives at 6:00 to work on the barn, 200-300 yards from the house, and his crowbar disappears from beside his truck in the carport. Billy arrives at about 7:00 - Eddie hears his loud muffler - which is AFTER the killing. Billy moved the crowbar earlier and that is why his prints are on it.

WHAT EACH FILE HOLDS
Case File 1 - Dave Daniels finds Guion's wallet beside the dumpster behind his Quick Shop at 7 a.m. The money is gone but three credit cards were thrown in the dumpster, so the robbery is staged, not real. He hears a car pull up and speed away and says it ran QUIETLY - Billy's car has a loud muffler. The Quick Shop is in the Eastwood Shopping Center.
Case File 2 - Millie Smith puts Malone in the cafe at 6:30-6:45, two coffees drunk fast, a big tip, up and gone without waiting for his bill. Rick Rooney has him on the golf course around 7:00 as usual.
Case File 3 - Marion's follow-up: nobody could have driven UP the drive without her seeing them, so the car she heard at 6:40 was the killer LEAVING. Eddie Sullivan is very hard of hearing and does not wear his aid at work, which is why he heard nothing from the barn. Billy's gambling is real but the racetrack sighting is two years old.

THE LINK EVERY FILE SHARES
Malone's own statement, in all three files: he left home at 6:20-6:30, drove the fifteen minutes to the Crestview turnoff - where Guion lives - then claims he turned back and stopped "at a coffee shop across from Eastwood on 160th". He volunteers that he was standing at the exact shopping center where the wallet was dumped, at the hour it was dumped, driving a car that runs quietly. His motive is in the file every student holds: Guion's memo threatening to tell his customers and every other dealer that MM Auto Parts ships substandard goods, which would end Malone's business.

WHY NOT THE OTHERS
Billy Prentice - arrived at 7:00, after the death; prints on the crowbar explained by moving it off the garage door; the loud muffler rules him out of the wallet drop.
Eddie Sullivan - reported the body himself, was at the barn out of earshot, and his own tool was taken from beside his truck.
Marion Guion - was in the house, heard the fall from the bedroom, and called the ambulance.
Sue Sullivan - the affair gives a motive and she may have made the 6:00 phone call, but nothing places her at the house and nothing connects her to the wallet."""

# One per suspect. This template never reveals them to a room — they exist so the
# case has a reviewed answer key and so the results page can mark a group right or
# wrong. Read them as "what the pooled file actually supports", not as an epilogue.
VERDICTS = {
    "Mickey Malone": ("success", """Correct. Malone is the only suspect the pooled file convicts.

He put himself at the Crestview turnoff at the time of the killing and then at the Eastwood Shopping Center at 7 a.m. - the place and the hour Guion's wallet was dumped - in a car Dave Daniels describes as running quietly. The wallet was emptied of cash and the credit cards thrown in the dumpster, which is a robbery staged to look like a robbery. Millie Smith has him in the cafe drinking two coffees fast and leaving without waiting for his bill.

His motive is in the file every student was given: Guion's memo threatening to tell his customers and every other dealer about the quality of MM Auto Parts."""),
    "Billy Prentice": ("failure", """The trap, and the answer most individuals give.

Billy lied, ran, gambles and left his prints on the crowbar - which is exactly why every version of the file makes him look guilty. But Eddie Sullivan heard his loud muffler at about 7:00, and the coroner puts the death between 6:30 and 7:00, with Marion timing the fall at 6:40. He arrived after it happened. His prints are on the crowbar because he moved it away from the garage door to get the mower out. And the car heard leaving the wallet behind the Quick Shop ran quietly, which Billy's does not."""),
    "Eddie Sullivan": ("failure", """Not supported.

Sullivan found the body and raised the alarm himself. He was working on the barn 200-300 yards from the house and is very hard of hearing without the aid he does not wear at work, which is why he heard nothing. The crowbar is his, but it was taken from beside his truck in the carport while he was down at the barn - that is the theft, not the alibi."""),
    "Marion Guion": ("failure", """Not supported.

She was in the house, heard the shout, the groan and the fall from the bedroom at about 6:40, and called the ambulance when Sullivan came to the patio door. Nothing places her outside, and nothing connects her to the wallet dumped across town at 7 a.m."""),
    "Sue Sullivan": ("failure", """Motive without evidence.

The affair is real and she may well be the early Saturday caller. But she is never interviewed, nothing places her at the house that morning, and nothing links her to the staged robbery. A group that lands here has found a reason to suspect someone and stopped looking for evidence."""),
}


# --------------------------------------------------------------------------- #
# Mongo
# --------------------------------------------------------------------------- #
def connect():
    """Atlas, preferring the SRV URI and falling back to the direct shard list.

    Some networks (campus DNS blocking UDP 53 for dnspython) time out on the SRV
    lookup `mongodb+srv://` needs; plain A records still resolve through the OS.
    """
    uri = os.getenv("MONGO_URI", "")
    try:
        c = MongoClient(uri, serverSelectionTimeoutMS=8000)
        c.admin.command("ping")
        return c
    except Exception:
        m = re.match(r"mongodb\+srv://([^@]+)@([^/?]+)", uri)
        creds, host = m.groups()
        cluster, tail = host.split(".", 1)
        shards = ",".join(f"{cluster}-shard-00-0{i}.{tail}:27017" for i in range(3))
        direct = (f"mongodb://{creds}@{shards}/?tls=true&authSource=admin"
                  f"&replicaSet=atlas-95br9m-shard-0")
        c = MongoClient(direct, serverSelectionTimeoutMS=20000)
        c.admin.command("ping")
        return c


def build_manager_exercise():
    """The whole `manager_exercise` sub-object, matching what the wizard would save."""
    packets = [{"role": role, "text": case_text(path), "file_id": ""}
               for role, path in CASE_FILES]

    candidates = [{
        "name": name,
        "forecast_text": VERDICTS[name][1],
        "forecast_file_id": "",
    } for name in SUSPECTS]

    # Hand-authored rather than model-extracted. The extractor reads a case as
    # "strengths and concerns per candidate", which is the right shape for a hiring
    # shortlist and the wrong one for a murder file — there is no sense in which a
    # suspect has strengths. What the pack is actually needed for here is the ROLES
    # (they bind each seat to one case file) and a locked answer key.
    pack = {
        "case_name": "The Case of Robert Guion",
        "roles": [role for role, _ in CASE_FILES],
        "options": [{
            "name": name,
            "per_role": {},
            "stated_strengths": None,
            "stated_concerns": None,
            "distinct_strengths": 0,
            "distinct_concerns": 0,
            "merges": [],
            "collapse_pairs": [],
            "outcome_verdict": VERDICTS[name][0],
            "outcome_summary": VERDICTS[name][1].split("\n\n")[0],
            "reconvene_reason": "",
        } for name in SUSPECTS],
        "answer_key": {
            "best_option": ANSWER,
            # Locked so `case_pack.recompute` never overwrites it. Its tally rule is
            # "most distinct strengths, fewest concerns", which is meaningless here
            # and would silently name whichever suspect happens to sort first.
            "best_option_locked": True,
            "mechanism": (
                "Every file carries the five depositions that make Billy Prentice look guilty "
                "(he lied, he ran, he gambles, his prints are on the crowbar), so that answer is "
                "shared, salient and wrong. The three facts that clear him and convict Malone are "
                "split one per file: the wallet dumped by a quiet car at Eastwood at 7 a.m. (File 1), "
                "Malone rushing out of the cafe (File 2), and the 6:40 car being the killer leaving "
                "rather than arriving (File 3). No single reader can get there."
            ),
            "tension_pairs": [],
        },
        "general_info": GENERAL_INFO,
        "collapse_rule": "",
        "criterion": "Which suspect the pooled evidence actually supports.",
        "warnings": [],
    }

    return {
        # No reveal, no debrief: the room ends on its own answer. See
        # backend/src/managers/exercise_templates.py.
        "template": "investigation",
        "num_students": 3,          # one seat per case file
        "num_rooms": 12,
        "discuss_minutes": 20,
        "choose_minutes": 3,
        "final_call_seconds": 30,
        "debrief_minutes": 20,      # unused on this template; kept for the schema
        # Files, not cards: each seat reads its whole case document.
        "student_view": "case",
        "role_packets": packets,
        "class_preset": "",
        "learning_outcome": (
            "Groups pool the evidence they hold in common and stop, so they convict the "
            "obvious suspect instead of the one the whole file convicts."
        ),
        "learning_points": [],
        "facilitator_prompt_override": "",
        "general_info": {"file_id": "", "text": GENERAL_INFO},
        "candidate_summary": {"file_id": "", "text": CANDIDATE_SUMMARY},
        "candidates": candidates,
        "case_pack": pack,
    }


def main():
    force = "--force" in sys.argv
    client = connect()
    db = client[os.getenv("MONGO_DB_NAME")]
    configs = db["config_collections"]

    me = build_manager_exercise()
    for p in me["role_packets"]:
        print(f"  {p['role']}: {len(p['text']):,} chars")

    existing = configs.find_one({"user_id": OWNER_USER_ID, "bot_name": BOT_NAME})
    if existing and not force:
        print(f"\n'{BOT_NAME}' already exists (id {existing['_id']}). Re-run with --force to replace it.")
        client.close()
        return
    if existing:
        configs.update_one(
            {"_id": existing["_id"]},
            {"$set": {"manager_exercise": me, "group_size": me["num_students"]}},
        )
        print(f"\nReplaced the case on '{BOT_NAME}' (id {existing['_id']}).")
        client.close()
        return

    doc = {
        "user_id": OWNER_USER_ID,
        "bot_name": BOT_NAME,
        "bot_type": "manager_exercise",
        "bot_avatar": "none",
        "heygen_avatar_id": "",
        "introduction": "",
        "model_name": "claude-sonnet-4-6",
        "prompt_template": "",
        "temperature": "0.7",
        "response_timeout": "3",
        "is_public": "True",
        "config_type": "normal",
        "documents": "[]",
        # Forced to num_students by the same invariant the save route enforces.
        "group_size": me["num_students"],
        "group_duration": "20",
        "bots": "[]",
        "web_access": "False",
        "qualtrics_enabled": "False",
        "audio_enabled": "False",
        "hume_config_id": "",
        "facilitator": {"enabled": False, "instruction": "", "allowedWidgets": None, "presets": []},
        "instructions": "Investigation: hidden-profile case file, no reveal and no debrief.",
        "class_code": CLASS_CODE,
        "manager_exercise": me,
        "created_at": datetime.utcnow(),
    }
    result = configs.insert_one(doc)
    # The vector collection name is derived from the id, so it can only be set after
    # the insert — every other config in this database follows the same shape.
    configs.update_one({"_id": result.inserted_id},
                       {"$set": {"collection_name": f"config_{result.inserted_id}"}})

    print(f"\nCreated '{BOT_NAME}' on hkustmg.")
    print(f"  config id   {result.inserted_id}")
    print(f"  class code  {CLASS_CODE}")
    print(f"  students    /manager-exercise/{result.inserted_id}")
    print(f"  results     /manager-exercise/{result.inserted_id}/results")
    client.close()


if __name__ == "__main__":
    main()
