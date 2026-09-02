# @language  Python
# @updated   2026-08-31
# @changed   One-off: drive a manager-exercise test run in-process and print the transcript.
"""Run a model-played test room on a manager-exercise config, headless.

The professor's Test button does this over HTTP; this does the same thing without
a browser or a login, by building the real Flask app, registering the real socket
events and calling the same `start_test_run` launcher the route calls. The room is
real in every way that matters — real phase machine, real timers, real model
students, messages persisted to `group_chat_messages`.

    python run_bob_test.py <config_id> [--minutes N]

Prints the transcript as it arrives and the phase the room ends in.
"""
import os
import re
import sys
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend"))
os.chdir(os.path.join(os.path.dirname(os.path.abspath(__file__)), "backend"))

from bson import ObjectId  # noqa: E402

from flask import Flask  # noqa: E402
from flask_socketio import SocketIO  # noqa: E402
from pymongo import MongoClient  # noqa: E402

from routes.group_chat_sockets import register_socket_events, start_test_run  # noqa: E402
from src.managers import exercise_state as ex_state  # noqa: E402
from src.utils.config import load_secrets  # noqa: E402

socketio = SocketIO(cors_allowed_origins="*")


def create_app():
    """The smallest app the exercise machinery needs: config, Mongo, socket events.

    Deliberately NOT `backend.app.create_app`. That one registers every blueprint,
    which drags in the document loaders, which drag in nltk and sklearn — and a
    broken numpy/sklearn ABI in the local interpreter then stops a test run that
    touches none of it. Nothing below this line needs a single HTTP route.
    """
    app = Flask(__name__)
    app.config.from_mapping(load_secrets())
    # `mongodb+srv://` needs a DNS SRV lookup, which this network blocks (UDP 53).
    # Resolving the shard list by hand keeps every downstream `MongoClient(MONGO_URI)`
    # in the exercise machinery working, since they all read this one config value.
    app.config["MONGO_URI"] = _reachable_uri(app.config["MONGO_URI"])
    socketio.init_app(app, async_mode="threading")
    client = MongoClient(app.config["MONGO_URI"], serverSelectionTimeoutMS=20000)
    app.config["MONGO_DB"] = client[app.config["MONGO_DB_NAME"]]
    register_socket_events(socketio, app)
    return app


def _reachable_uri(uri):
    """The SRV URI if it resolves here, else the equivalent direct shard-list URI."""
    try:
        c = MongoClient(uri, serverSelectionTimeoutMS=8000)
        c.admin.command("ping")
        return uri
    except Exception:
        m = re.match(r"mongodb\+srv://([^@]+)@([^/?]+)", uri)
        if not m:
            return uri
        creds, host = m.groups()
        cluster, tail = host.split(".", 1)
        shards = ",".join(f"{cluster}-shard-00-0{i}.{tail}:27017" for i in range(3))
        return (f"mongodb://{creds}@{shards}/?tls=true&authSource=admin"
                f"&replicaSet=atlas-95br9m-shard-0")


def main():
    config_id = sys.argv[1] if len(sys.argv) > 1 else None
    if not config_id:
        print(__doc__)
        return
    minutes = 25
    if "--minutes" in sys.argv:
        minutes = int(sys.argv[sys.argv.index("--minutes") + 1])

    app = create_app()
    with app.app_context():
        db = app.config["MONGO_DB"]
        config_doc = db["config_collections"].find_one({"_id": ObjectId(config_id)})
        if not config_doc:
            print(f"No config {config_id}")
            return
        print(f"Config: {config_doc.get('bot_name')} "
              f"(template={(config_doc.get('manager_exercise') or {}).get('template')})")

        room_id = start_test_run(config_doc)
        print(f"Room: {room_id}\n" + "-" * 72)

        # Poll the persisted transcript rather than listening for emits: nothing is
        # connected to this SocketIO server, and the messages are written to Mongo
        # before every broadcast anyway.
        seen = 0
        deadline = time.time() + minutes * 60
        last_phase = None
        while time.time() < deadline:
            st = ex_state.get_exercise(room_id)
            phase = st.phase() if st else "?"
            if phase != last_phase:
                print(f"\n=== phase: {phase} ===")
                last_phase = phase
            msgs = list(db["group_chat_messages"]
                        .find({"room_id": room_id}, {"sender": 1, "text": 1, "turn": 1})
                        .sort("turn", 1))
            for m in msgs[seen:]:
                print(f"  {m.get('sender')}: {m.get('text')}")
            seen = len(msgs)
            if phase == "done":
                break
            socketio.sleep(3)

        st = ex_state.get_exercise(room_id)
        doc = db["manager_exercise_sessions"].find_one({"room_id": room_id}) or {}
        print("\n" + "-" * 72)
        print(f"final phase : {st.phase() if st else doc.get('phase')}")
        print(f"roster      : {[(e.get('name'), e.get('role')) for e in doc.get('roster') or []]}")
        print(f"solo picks  : {(doc.get('solo_ballot') or {}).get('votes')}")
        print(f"group answer: {doc.get('chosen_candidate')}")


if __name__ == "__main__":
    main()
