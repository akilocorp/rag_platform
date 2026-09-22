#!/usr/bin/env python3
# @language  Python
# @updated   2026-09-22
# @changed   Fixed the endpoint: auth_bp is mounted at /api/auth, so the first run 404'd every
#            request and reported a meaningless 0.02s. Added a preflight that proves the route
#            exists before seeding, and a --path flag.
"""Measure how long login takes when a class logs in at once.

WHY THIS IS A SEPARATE HARNESS FROM `runner.py`
    That one opens a Socket.IO connection per student and speaks exercise events.
    Login is plain HTTP on a different path with a different bottleneck, and the
    two share nothing but the percentile convention.

WHY IT MUST SEED REAL ACCOUNTS
    `auth.py:login` calls `User.find_by_email_or_username` first and only reaches
    bcrypt `if user`. Point this at usernames that do not exist and every request
    short-circuits before the expensive part, the numbers come back flat and fast,
    and you conclude login scales. It does not: bcrypt is the whole cost.

    So each run creates its own accounts, marked `is_loadtest: True`, and removes
    them at the end. Cleanup keys on that marker rather than on ids held in memory,
    so a half-killed run is swept by the next one. No account without the marker is
    ever read or written.

THE TWO ARMS, AND WHY THE BASELINE IS THE POINT
    Each cohort is measured twice:

      valid    a seeded account with the right password -> bcrypt runs
      unknown  an identifier that does not exist        -> returns before bcrypt

    `unknown` is the control. It pays the same network, Flask, threading and Mongo
    lookup costs and none of the hashing, so `valid - unknown` is what bcrypt costs
    under that much concurrency. A single `valid` number cannot tell you whether
    you are CPU-bound on hashing or just far from the server.

WHAT THE NUMBERS MEAN
    The Dockerfile runs `python app.py` -> `socketio.run(..., allow_unsafe_werkzeug
    =True)` with `async_mode='threading'`. One process, one thread per request, on
    the Werkzeug dev server. bcrypt is CPU-bound, so concurrent logins do not
    overlap: they queue for whatever vCPUs the instance has. Expect the p95 to grow
    roughly linearly with cohort size, and that growth is the finding.

    Run from inside the compose network, the generator shares a CPU with the server,
    so these are a floor. The shape across 10 -> 50 is worth more than any figure.

USAGE (on the dev box)
    compose -f docker-compose.remote.dev.yml --profile loadtest run --rm loadtest-login
    compose -f docker-compose.remote.dev.yml --profile loadtest run --rm loadtest-login \\
        --sizes 10,25 --keep
"""
import argparse
import os
import secrets
import sys
import threading
import time
import uuid
from datetime import datetime, timezone

sys.path.insert(0, "/app")

import bcrypt                                              # noqa: E402
import pymongo                                             # noqa: E402
import requests                                            # noqa: E402

# Marks every account this script creates. One field, checked by the cleanup and
# by nothing else, so a stray row can always be found and removed by hand.
MARKER = "is_loadtest"

# Flask-Bcrypt's default cost factor. No BCRYPT_LOG_ROUNDS is configured anywhere
# in the app, so this is what `generate_password_hash` used for every real account
# and it is what the seeded ones must use — seeding at a cheaper cost would make
# `check_password_hash` faster than production and understate the whole problem.
BCRYPT_ROUNDS = 12

# `auth_bp` is registered with url_prefix='/api/auth' (app.py), and the route
# inside it is '/login'. Spelled out here because the first run of this script
# used '/auth/login', got a 404 on every request, and reported a very fast and
# entirely meaningless 0.02s -- Flask answers an unrouted path without touching
# Mongo or bcrypt.
LOGIN_PATH = "/api/auth/login"


def db():
    """Same connection shape as runner.py: env only, no Flask app."""
    uri = os.environ["MONGO_URI"]
    return pymongo.MongoClient(uri, serverSelectionTimeoutMS=10000)[os.environ["MONGO_DB_NAME"]]


def users_collection_name():
    """Resolve the users collection the app actually reads.

    `app.py` takes it from `app.config["USER"]`, which is the `USER` key in
    backend/.env. That name also happens to be a standard shell variable, so a
    container that did not get the env_file would hand us "root" or "ubuntu" and we
    would seed accounts into a collection nothing reads. Anything that does not
    look like a collection name is rejected rather than guessed at.
    """
    name = os.environ.get("LOADTEST_USERS_COLLECTION") or os.environ.get("USER", "")
    if not name or "_" not in name:
        raise SystemExit(
            f"USER resolved to {name!r}, which is a shell username, not a collection.\n"
            "  Pass --users-collection, or run this with backend/.env loaded."
        )
    return name


def seed_accounts(database, collection_name, run_id, count, password):
    """Create `count` throwaway accounts sharing one password hash.

    The hash is computed ONCE and copied. Every account has the same password, so
    per-account salts would cost `count` bcrypt operations at seed time and change
    nothing about what the server does on login — it hashes the submitted password
    against whatever salt it finds, at the same cost either way.
    """
    pw_hash = bcrypt.hashpw(password.encode(), bcrypt.gensalt(BCRYPT_ROUNDS)).decode()
    docs = []
    for i in range(count):
        handle = f"loadtest_{run_id}_{i}"
        docs.append({
            "username": handle,
            "email": f"{handle}@loadtest.invalid",
            "password": pw_hash,
            "role": "professor",
            # Login does not enforce verification (see auth.py), but a half-built
            # account would still be the odd one out in any query run against this
            # collection later. Cheaper to look normal.
            "is_verified": True,
            "created_at": datetime.now(timezone.utc),
            MARKER: True,
        })
    database[collection_name].insert_many(docs)
    return [d["email"] for d in docs]


def cleanup(database, collection_name):
    """Delete every marked account, this run's or an earlier one's."""
    return database[collection_name].delete_many({MARKER: True}).deleted_count


def fire(target, path, identifier, password, barrier, out, lock):
    """One login attempt, released in lockstep with the rest of its cohort.

    The barrier is what makes this a concurrency measurement. Without it the
    threads start as the pool gets to them, the requests smear across a second,
    and the server never sees the burst that a class arriving at a deadline
    actually produces.
    """
    try:
        barrier.wait(timeout=60)
    except threading.BrokenBarrierError:
        return
    started = time.perf_counter()
    status, err = None, None
    try:
        resp = requests.post(
            f"{target}{path}",
            json={"username": identifier, "password": password},
            timeout=120,
        )
        status = resp.status_code
    except Exception as e:                                  # noqa: BLE001
        err = f"{type(e).__name__}: {str(e)[:120]}"
    elapsed = time.perf_counter() - started
    with lock:
        out.append({"seconds": elapsed, "status": status, "error": err})


def run_arm(target, path, identifiers, password, expect):
    """Fire one simultaneous burst and summarise it.

    `expect` is the status a correct server returns for this arm. Anything else is
    counted as a failure, because a 500 answered in 40ms would otherwise look like
    the fastest cohort in the sweep.
    """
    size = len(identifiers)
    barrier = threading.Barrier(size + 1)
    results, lock = [], threading.Lock()
    threads = [
        threading.Thread(
            target=fire, args=(target, path, ident, password, barrier, results, lock),
            daemon=True
        )
        for ident in identifiers
    ]
    for t in threads:
        t.start()

    wall_start = time.perf_counter()
    barrier.wait(timeout=60)          # releases all of them at once
    for t in threads:
        t.join(timeout=180)
    wall = time.perf_counter() - wall_start

    times = sorted(r["seconds"] for r in results)
    bad = [r for r in results if r["error"] or r["status"] != expect]
    if not times:
        return {"n": 0, "wall": round(wall, 2), "failures": size, "detail": ["no results"]}
    return {
        "n": len(times),
        "p50": round(times[len(times) // 2], 3),
        "p95": round(times[min(len(times) - 1, int(len(times) * 0.95))], 3),
        "max": round(times[-1], 3),
        "wall": round(wall, 2),
        "failures": len(bad),
        "detail": [f"status={r['status']} {r['error'] or ''}".strip() for r in bad[:8]],
    }


def preflight(target, path):
    """Prove the endpoint exists before seeding anything.

    One request, before the accounts are created. A wrong prefix otherwise costs
    a full sweep: Flask answers an unrouted path in microseconds without reaching
    Mongo or bcrypt, so every cohort comes back fast, both arms agree, and the
    bcrypt delta reads 0.00s -- which looks like a finding rather than a mistake.
    """
    try:
        resp = requests.post(f"{target}{path}",
                             json={"username": "preflight@loadtest.invalid", "password": "x"},
                             timeout=30)
    except Exception as e:                                  # noqa: BLE001
        raise SystemExit(f"  cannot reach {target}{path}: {type(e).__name__}: {e}")
    if resp.status_code == 404:
        raise SystemExit(
            f"  {target}{path} returned 404 - nothing is routed there.\n"
            "  Check the blueprint prefix in app.py and pass --path."
        )
    # Anything else means the route exists: 401 for an unknown user, 400 if the
    # handler ever starts rejecting this shape. Both reach the real code.
    print(f"  preflight {path} -> {resp.status_code} (route exists)")


def report(size, valid, unknown):
    """Print one cohort, with the bcrypt delta spelled out.

    p50/p95/max rather than a mean, for the reason runner.py already gives: the
    failure worth finding is four students waiting nine seconds while everyone
    else is fine, and a mean hides exactly that.
    """
    print(f"\n{'='*70}")
    print(f"  {size} simultaneous logins")
    print(f"{'='*70}")
    print(f"  {'arm':26} {'n':>4} {'p50':>8} {'p95':>8} {'max':>8}")
    print(f"  {'-'*26} {'-'*4} {'-'*8} {'-'*8} {'-'*8}")
    for label, arm in (("valid (bcrypt runs)", valid), ("unknown (no bcrypt)", unknown)):
        if arm.get("n"):
            print(f"  {label:26} {arm['n']:>4} {arm['p50']:>7.2f}s "
                  f"{arm['p95']:>7.2f}s {arm['max']:>7.2f}s")
    if valid.get("n") and unknown.get("n"):
        print(f"  {'-'*26} {'-'*4} {'-'*8} {'-'*8} {'-'*8}")
        print(f"  {'>> bcrypt cost':26} {'':>4} {valid['p50']-unknown['p50']:>7.2f}s "
              f"{valid['p95']-unknown['p95']:>7.2f}s {valid['max']-unknown['max']:>7.2f}s")
    for label, arm in (("valid", valid), ("unknown", unknown)):
        if arm["failures"]:
            print(f"\n  {arm['failures']} FAILURES in {label}")
            for d in arm["detail"]:
                print(f"    {d}")
    print()


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--target", default=os.environ.get("LOADTEST_TARGET", "http://backend:5000"))
    ap.add_argument("--sizes", default=os.environ.get("LOADTEST_SIZES", "10,25,50"))
    ap.add_argument("--path", default=os.environ.get("LOADTEST_LOGIN_PATH", LOGIN_PATH))
    ap.add_argument("--users-collection", default=None)
    ap.add_argument("--keep", action="store_true", help="skip cleanup (for debugging a run)")
    args = ap.parse_args()

    sizes = [int(x) for x in args.sizes.split(",") if x.strip()]
    database = db()
    collection = args.users_collection or users_collection_name()
    run_id = uuid.uuid4().hex[:8]
    password = secrets.token_urlsafe(16)
    started = datetime.now(timezone.utc)

    print(f"\n  login ramp {run_id} -> {args.target}")
    print(f"  sizes {sizes} · users collection '{collection}'")
    print(f"  swept leftovers: {cleanup(database, collection)}")

    preflight(args.target, args.path)

    # Seeded once at the largest cohort and reused. Login is stateless, so unlike
    # the exercise sweep there is nothing one-way to invalidate a later size.
    emails = seed_accounts(database, collection, run_id, max(sizes), password)
    print(f"  seeded {len(emails)} accounts\n")

    cohorts = []
    try:
        for size in sizes:
            valid = run_arm(args.target, args.path, emails[:size], password, expect=200)
            time.sleep(2)
            unknown = run_arm(
                args.target, args.path,
                [f"nobody_{run_id}_{i}@loadtest.invalid" for i in range(size)],
                password, expect=401,
            )
            report(size, valid, unknown)
            cohorts.append({"concurrency": size, "valid": valid, "unknown": unknown})
            time.sleep(3)
    finally:
        # Persisted before cleanup: the results are the only thing worth keeping,
        # and a cleanup that fails must not take them down with it.
        database["loadtest_runs"].insert_one({
            "run_id": run_id,
            "kind": "login",          # distinguishes these from the exercise sweeps
            "started_at": started,
            "finished_at": datetime.now(timezone.utc),
            "target": args.target,
            "path": args.path,
            "sizes": sizes,
            "cohorts": cohorts,
            "bcrypt_rounds": BCRYPT_ROUNDS,
            # Recorded with the numbers because they are what the numbers mean. A
            # reading taken on one Werkzeug process is not comparable to one taken
            # after a move to gunicorn, and nothing else in the row would say so.
            "server": {"async_mode": "threading", "server": "werkzeug-dev", "workers": 1},
        })
        print(f"  recorded run {run_id} in loadtest_runs")
        if args.keep:
            print(f"  --keep: {len(emails)} accounts left in '{collection}' (marked {MARKER})")
        else:
            print(f"  removed {cleanup(database, collection)} accounts")

    if len(cohorts) > 1:
        print(f"\n  shape (valid p95): " + "  ".join(
            f"{c['concurrency']}->{c['valid'].get('p95', '?')}s" for c in cohorts))
    print()
    return 0


if __name__ == "__main__":
    sys.exit(main())
