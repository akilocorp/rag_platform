#!/usr/bin/env python3
# @language  Python
# @updated   2026-09-22
# @changed   New file: the containerised sweep. Provisions its OWN throwaway configs, drives the
#            cohorts through `client.py`, writes the percentiles to `loadtest_runs` for the admin
#            panel, and deletes everything it made.
"""Run a manager-exercise load sweep from inside Docker and record the result.

WHY IT BUILDS ITS OWN CONFIGS
    Pairing is one-way: once `investigation_pool.pair()` has run for a config, the
    pool is frozen and later arrivals are seated as latecomers into the existing
    rooms. A sweep therefore cannot reuse one config across cohort sizes — the 20
    would land inside the 10's rooms. So each cohort gets a disposable config of
    its own, built here, marked `is_loadtest: True`, and deleted at the end.

    That is also the safety property. This never touches a class anyone teaches:
    it does not read, pair, or write to any config it did not create.

WHAT IT CANNOT MEASURE FROM IN HERE
    It runs on the same host as the server it is testing, so the generator's
    threads compete with the server's for CPU. Treat the numbers as a floor — the
    real ceiling is higher than what this reports, and the shape of the curve
    across cohort sizes is worth more than any single figure.

    `async_mode='threading'` on the Werkzeug dev server means one OS thread per
    student plus one per room, all in a single process that CANNOT be scaled to
    more workers while `match_manager` and `investigation_pool` are in-memory.
    See client.py's module docstring.

USAGE (on the dev box)
    compose -f docker-compose.remote.dev.yml --profile loadtest run --rm loadtest
    compose -f docker-compose.remote.dev.yml --profile loadtest run --rm loadtest \\
        --sizes 10,20 --through discuss
"""
import argparse
import os
import sys
import time
import uuid
from datetime import datetime, timezone

sys.path.insert(0, "/app")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import pymongo                                             # noqa: E402

from client import pair_now, run_cohort                    # noqa: E402

# Marks everything this script creates. One field, checked by the cleanup and by
# nothing else, so a stray row can always be found and removed by hand.
MARKER = "is_loadtest"

# The owner id stamped on every throwaway config, and the identity the pairing
# token carries. Deliberately NOT a real account and not even an ObjectId: the
# only thing that authorizes pairing is `config.user_id == jwt identity`
# (`_load_owned_config` compares those two strings and looks up no user), so
# creating a user document here would write to the user collection for nothing.
LOADTEST_UID = "loadtest-runner"


def db():
    uri = os.environ["MONGO_URI"]
    return pymongo.MongoClient(uri, serverSelectionTimeoutMS=10000)[os.environ["MONGO_DB_NAME"]]


def mint_token(user_id):
    """A real access token for the synthetic professor.

    Built through the app's own `create_access_token` rather than hand-rolled with
    PyJWT, so it carries whatever claims and expiry the app currently expects — a
    hand-rolled token would pass today and start failing the day those change.
    """
    from flask import Flask
    from flask_jwt_extended import JWTManager, create_access_token
    app = Flask(__name__)
    app.config["JWT_SECRET_KEY"] = os.environ["JWT_SECRET_KEY"]
    JWTManager(app)
    with app.app_context():
        return create_access_token(identity=str(user_id),
                                   additional_claims={"role": "professor"})


def make_config(database, owner_id, size):
    """One disposable manager exercise sized for this cohort.

    Deliberately synthetic rather than a clone of a real class: a clone would
    carry a class_code (globally unique) and somebody's case pack, and the point
    is that this run is reproducible and owes nothing to whatever is in the
    database that week.

    `num_students` is the cohort size and the group size stays 3, so N students
    produce roughly N/3 rooms — which is where the per-room timer threads come
    from, and the reason the curve bends rather than scaling flat.
    """
    roles = ["Logistics Manager", "Operations Manager", "Marketing Manager"]
    names = ["Candidate A", "Candidate B", "Candidate C"]
    options = [{
        "name": n,
        "per_role": {r: {"strengths": [f"{r} sees strength {i+1} in {n}."],
                         "concerns": [f"{r} notes a concern about {n}."],
                         "neutral": []} for i, r in enumerate(roles)},
    } for n in names]

    doc = {
        "bot_name": f"__loadtest__ {size} students",
        "bot_type": "manager_exercise",
        "user_id": str(owner_id),
        "model_name": "claude-haiku-4-5-20251001",
        "is_public": False,
        MARKER: True,
        "manager_exercise": {
            "template": "hiring",
            "student_view": "cards",
            "num_students": max(2, size),
            "investigation_group_size": 3,
            "investigation_group_size_max": 4,
            # Round 0's budget is generous because the harness staggers its votes;
            # every other window is short so a cohort finishes in minutes.
            "general_info_minutes": 0.2, "review_minutes": 0.2, "solo_minutes": 3,
            "discuss_minutes": 3, "choose_minutes": 1, "debrief_minutes": 2,
            "reading_minutes": 1, "final_call_seconds": 20,
            "candidates": [{"name": n} for n in names],
            "case_pack": {
                "case_name": "Load test",
                "roles": roles,
                "options": options,
                "general_info": "A synthetic exercise used only for load testing.",
                "answer_key": {"best_option": names[0]},
            },
        },
    }
    return str(database["config_collections"].insert_one(doc).inserted_id)


def cleanup(database):
    """Delete every artefact this script has ever made, from any run.

    Keyed on the marker rather than on ids held in memory, so a run that was
    killed half way still gets swept by the next one — the failure mode otherwise
    is fake rooms accumulating quietly in a database nobody audits.
    """
    cfg_ids = [str(d["_id"]) for d in
               database["config_collections"].find({MARKER: True}, {"_id": 1})]
    removed = {"configs": 0, "sessions": 0, "messages": 0}
    if cfg_ids:
        for cid in cfg_ids:
            q = {"room_id": {"$regex": f"^{cid}_"}}
            removed["messages"] += database["group_chat_messages"].delete_many(q).deleted_count
            removed["sessions"] += database["manager_exercise_sessions"].delete_many(q).deleted_count
        removed["configs"] = database["config_collections"].delete_many(
            {MARKER: True}).deleted_count
    return removed


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--target", default=os.environ.get("LOADTEST_TARGET", "http://backend:5000"))
    ap.add_argument("--sizes", default=os.environ.get("LOADTEST_SIZES", "10,20,30,40,50"))
    ap.add_argument("--through", default="discuss", choices=["pair", "discuss", "debrief"])
    ap.add_argument("--ramp", type=float, default=0.2)
    ap.add_argument("--keep", action="store_true", help="skip cleanup (for debugging a run)")
    args = ap.parse_args()

    sizes = [int(x) for x in args.sizes.split(",") if x.strip()]
    database = db()
    run_id = uuid.uuid4().hex[:12]
    started = datetime.now(timezone.utc)

    print(f"\n  load sweep {run_id} -> {args.target}")
    print(f"  sizes {sizes} · through '{args.through}'")
    swept = cleanup(database)
    print(f"  swept leftovers: {swept}")

    token = mint_token(LOADTEST_UID)
    cohorts = []

    for size in sizes:
        cfg_id = make_config(database, LOADTEST_UID, size)
        print(f"\n  --- {size} students (config {cfg_id}) ---")
        try:
            timings, wall = run_cohort(
                args.target, cfg_id, size, through=args.through, ramp=args.ramp,
                on_ready=lambda c=cfg_id: pair_now(args.target, c, token),
            )
            timings.report(size, wall)
            cohorts.append({
                "students": size, "config_id": cfg_id,
                "wall_seconds": round(wall, 1),
                "stages": timings.summary(),
                "failures": [{"uid": u, "error": e} for u, e in timings.errors[:25]],
                "failure_count": len(timings.errors),
            })
        except Exception as e:                              # noqa: BLE001
            print(f"  cohort {size} blew up: {type(e).__name__}: {e}")
            cohorts.append({"students": size, "config_id": cfg_id,
                            "error": f"{type(e).__name__}: {str(e)[:200]}",
                            "failure_count": size, "stages": {}})
        time.sleep(3)

    # Persisted before cleanup: the results are the only thing worth keeping, and
    # a cleanup that fails must not take them down with it.
    database["loadtest_runs"].insert_one({
        "run_id": run_id,
        "started_at": started,
        "finished_at": datetime.now(timezone.utc),
        "target": args.target,
        "through": args.through,
        "sizes": sizes,
        "cohorts": cohorts,
        # Recorded with the numbers because they are what the numbers mean. A
        # reading taken under `threading` on the dev server is not comparable to
        # one taken after a move to eventlet, and nothing else would say so.
        "server": {"async_mode": "threading", "server": "werkzeug-dev", "workers": 1},
    })
    print(f"\n  recorded run {run_id} in loadtest_runs")

    if not args.keep:
        print(f"  cleanup: {cleanup(database)}")


if __name__ == "__main__":
    main()
