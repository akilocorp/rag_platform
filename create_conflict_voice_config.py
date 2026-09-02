# @language  Python
# @updated   2026-09-02
# @changed   One-off: build the "Conflict Practice — Alex" audio_call config on the hkustmg account.
"""Creates the conflict-management voice roleplay config in Mongo.

WHAT THIS IS FOR
    A standardized ~5-10 minute spoken conversation with an AI that role-plays a
    fellow student holding the OPPOSITE view on a contested issue. Every student
    gets the same persona, the same rules and the same structure; only the topic
    and the stance change, and those arrive per session from the launch URL.

HOW THE PER-SESSION VARIABLES WORK
    A Qualtrics link ends at:

        /chat/<config_id>?participant=P0412&topic=...&stance=...

    Every query parameter is packed into the CLM session id and reaches the
    persona two ways: substituted wherever `{{topic}}` / `{{stance}}` appear, and
    listed verbatim underneath. So a study can add a variable without anyone
    editing the prompt. The same values are stored on the call record, which is
    where the export's per-variable columns come from.

    `stance` is the AI's OWN position, set opposite the student's — that
    assignment happens in Qualtrics, not here.

WHAT IT DELIBERATELY DOES NOT DO
    No knowledge base and no web access. This path is the lean voice runner: any
    tool call would be a second model round-trip before the first spoken word,
    which is the whole reason turn-taking felt slow.

RUN
    py -3 create_conflict_voice_config.py
"""
import os
import re
import sys
from datetime import datetime

from dotenv import load_dotenv
from pymongo import MongoClient

load_dotenv("backend/.env")

BOT_NAME = "Conflict Practice — Alex"
CLASS_CODE = "conflictpractice"
OWNER_USER_ID = "68794c7e848dfc3f253b297e"  # yonathanakl@gmail.com (hkustmg)

# Sonnet 4.6 rather than a newer model on purpose: it does not think by default,
# so its first token is fast, and it still holds a nuanced position under pressure.
MODEL_NAME = "claude-sonnet-4-6"

INTRODUCTION = (
    "You're about to have a short spoken conversation with an AI student who "
    "disagrees with you. Tap the microphone to begin. The conversation is "
    "recorded and transcribed."
)

# `{{topic}}` and `{{stance}}` are filled per session from the launch URL. The
# spoken-register rules (no markdown, short turns, no stage directions) are
# appended automatically by the voice runner — they are not repeated here.
INSTRUCTIONS = """You are Alex, a university student taking part in a recorded practice conversation about a contested issue. You are an AI. If you are asked whether you are a real person, say plainly that you are an AI — never claim otherwise.

THE CONVERSATION
The issue is: {{topic}}
Your position is: {{stance}}
The student you are talking to holds the opposite position. Your job is to hold your side honestly and make them work for it, so that they get real practice at disagreeing well.

HOW YOU HOLD YOUR SIDE
- Open by saying where you stand in a sentence, then ask what they think.
- Give real reasons, and the strongest version of them. Never argue badly on purpose, and never fold the first time they push back.
- Concede a specific point when they genuinely earn it, and say what changed your mind. A conversation where nothing moves teaches nothing.
- If they get heated, stay in it. Do not become hostile and do not become a pushover. Firm and civil.
- Ask them questions. A disagreement is not a speech.
- If they go quiet or seem stuck, offer a smaller version of the question rather than filling the silence yourself.

WHAT YOU NEVER DO
- Never coach them on how to disagree, never grade or score them, and never mention that this is an assessment.
- Never break character to comment on the exercise itself.
- Never switch to their side to be agreeable. You can move on a point; you do not abandon the position.

The conversation runs about five to ten minutes. Keep going until they wind it down."""


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


def main():
    client = connect()
    configs = client[os.getenv("MONGO_DB_NAME", "test")]["config_collections"]

    # Class codes are globally unique, so a collision belongs to someone else's
    # class and must not be quietly taken over.
    clash = configs.find_one({"class_code": CLASS_CODE, "user_id": {"$ne": OWNER_USER_ID}})
    if clash:
        print(f"Class code '{CLASS_CODE}' is already used by another account. Aborting.")
        client.close()
        return 1

    existing = configs.find_one({"user_id": OWNER_USER_ID, "bot_name": BOT_NAME})
    if existing:
        configs.update_one(
            {"_id": existing["_id"]},
            {"$set": {
                "instructions": INSTRUCTIONS,
                "introduction": INTRODUCTION,
                "model_name": MODEL_NAME,
                "bot_type": "audio_call",
                "audio_enabled": True,
            }},
        )
        print(f"Updated the existing '{BOT_NAME}' (id {existing['_id']}).")
        config_id = existing["_id"]
    else:
        # Real Python types, not the form-shaped strings the wizard posts: this doc
        # goes straight into Mongo without passing through the save route that
        # coerces them, and the edit page calls .map on documents/bots.
        doc = {
            "user_id": OWNER_USER_ID,
            "bot_name": BOT_NAME,
            "bot_type": "audio_call",
            "bot_avatar": "none",
            "heygen_avatar_id": "",
            "introduction": INTRODUCTION,
            "model_name": MODEL_NAME,
            "prompt_template": "",
            "instructions": INSTRUCTIONS,
            "temperature": 0.8,
            "response_timeout": 3,
            # Students arrive from a Qualtrics link with no account.
            "is_public": True,
            "config_type": "normal",
            "documents": [],
            "group_size": 1,
            "group_duration": 20,
            "bots": [],
            # No knowledge base, no web: every tool round would land before the
            # first spoken word.
            "web_access": False,
            "qualtrics_enabled": True,
            "audio_enabled": True,
            # Empty means "use the server's HUME_CONFIG_ID", which is what we want
            # — one EVI voice config shared by every call.
            "hume_config_id": "",
            "facilitator": {"enabled": False, "instruction": "", "allowedWidgets": None, "presets": []},
            "class_code": CLASS_CODE,
            "created_at": datetime.utcnow(),
        }
        result = configs.insert_one(doc)
        config_id = result.inserted_id
        # The vector collection name is derived from the id, so it can only be set
        # after the insert — every other config in this database follows this shape.
        configs.update_one({"_id": config_id},
                           {"$set": {"collection_name": f"config_{config_id}"}})
        print(f"Created '{BOT_NAME}' on hkustmg.")

    print(f"  config id   {config_id}")
    print(f"  class code  {CLASS_CODE}")
    print(f"  student     /chat/{config_id}")
    print(f"  qualtrics   /chat/{config_id}?participant=P0412"
          f"&topic=whether%20the%20university%20should%20cap%20class%20sizes"
          f"&stance=the%20cap%20is%20a%20bad%20idea")
    print(f"  export      /api/audio/export/{config_id}?format=csv")
    client.close()
    return 0


if __name__ == "__main__":
    sys.exit(main())
