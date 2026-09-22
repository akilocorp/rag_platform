#!/usr/bin/env python3
# @language  Python
# @updated   2026-09-22
# @changed   New file: drive N real Socket.IO clients through a manager exercise to find where the
#            server gives out. Exists because `exercise_sim` runs INSIDE the server and so tests the
#            phase machine, not the thing that actually breaks under a class — sockets, threads and
#            the connection pool.
"""Load-test the manager exercise with N simultaneous students.

WHAT THIS MEASURES THAT exercise_sim DOES NOT
    `exercise_sim.py` plays students by calling `ExerciseState` methods in-process.
    That proves the pedagogy and the phase machine, and proves nothing about load:
    no sockets are opened, no threads are spawned per student, no JSON crosses a
    network. This opens a REAL Socket.IO connection per student and speaks the same
    events a browser speaks, so the thing under test is the server, not the logic.

WHY THE NUMBERS MATTER ON THIS PARTICULAR DEPLOYMENT
    `backend/app.py` runs `socketio.run(..., allow_unsafe_werkzeug=True)` with
    `async_mode='threading'`, and the Dockerfile's CMD is `python app.py`. So:

      * every connected student holds one OS THREAD, not a green thread;
      * every room's phase timer is another thread, waking once a second;
      * it is the Werkzeug development server, which is why that flag is needed.

    gunicorn is in requirements.txt but is not what runs. That is not simply an
    oversight to correct: `match_manager` and `investigation_pool` are in-process
    singletons, so a second worker would give half the class a different pairing
    pool. Single-process is currently load-bearing. Raising the ceiling means
    eventlet/gevent in ONE worker, or moving that state to Redis first.

COST
    Round 1 is free. `_facilitator_turn` is backgrounded on every student message
    but returns immediately unless `facilitator_active()` — which is round 2 only.
    So `--through discuss` makes no model calls at all. `--through debrief` calls
    ACTR once per student message and is the expensive, rate-limited path; run it
    at small N first.

USAGE
    pip install "python-socketio[client]" requests

    # 1. free run, no pairing needed if you pair by hand from the dashboard
    python loadtest_manager_exercise.py --url https://testfront.bitterlylab.com \\
        --config-id 6a97dfb5e48bdf0a0a639e77 --students 20

    # 2. auto-pair (professor JWT from localStorage.jwtToken in a logged-in tab)
    python loadtest_manager_exercise.py ... --students 50 --jwt eyJhbGci...

    # 3. sweep the sizes you actually care about. Reset the rooms between runs
    #    from the professor dashboard — pairing is one-way, and a pool that has
    #    already been paired seats the next run as latecomers into the old rooms.
    for n in 10 20 30 40 50; do
        python loadtest_manager_exercise.py ... --students $n
        read -p "reset the rooms on the dashboard, then press enter"
    done

RUN IT AGAINST DEV, NOT A LIVE CLASS. It seats real students in real rooms and
writes real messages to `group_chat_messages`.
"""
import argparse
import random
import sys
import threading
import time
import uuid

try:
    import requests
    import socketio
except ImportError:
    sys.exit("pip install 'python-socketio[client]' requests")


# Round-1 filler. Deliberately not model-generated: this measures the server, and a
# model call per message would make the client the bottleneck and bill you for it.
CHATTER = [
    "my sheet says he completed the leadership program",
    "mine doesn't have that at all",
    "wait who has the cfa one",
    "i had a concern about micromanaging",
    "hmm that's not in mine",
    "ok so we're leaning the same way?",
    "anyone got anything on the third one",
    "mine says 15 years at the company",
    "that contradicts what i have",
    "fine, i'll go with that",
]


class Timings:
    """Thread-safe collection of per-student durations, reported as percentiles.

    A mean hides exactly the failure this test exists to find: most students fine
    and four of them waiting nine seconds. p95 and max are the numbers that decide
    whether a class of this size works.
    """

    def __init__(self):
        self._lock = threading.Lock()
        self.marks = {}
        self.errors = []

    def record(self, name, seconds):
        with self._lock:
            self.marks.setdefault(name, []).append(seconds)

    def fail(self, uid, what):
        with self._lock:
            self.errors.append((uid, what))

    def summary(self):
        """Percentiles per stage, as plain data for Mongo and the admin UI."""
        out = {}
        for name, vals in self.marks.items():
            v = sorted(vals)
            out[name] = {
                "n": len(v),
                "p50": round(v[len(v) // 2], 3),
                "p95": round(v[min(len(v) - 1, int(len(v) * 0.95))], 3),
                "max": round(v[-1], 3),
            }
        return out

    def report(self, students, wall):
        print(f"\n{'='*66}")
        print(f"  {students} students · {wall:.1f}s wall clock")
        print(f"{'='*66}")
        print(f"  {'stage':22} {'n':>4} {'p50':>8} {'p95':>8} {'max':>8}")
        print(f"  {'-'*22} {'-'*4} {'-'*8} {'-'*8} {'-'*8}")
        for name in ("connect", "pool_ack", "match_found", "first_snapshot", "msg_rtt"):
            vals = sorted(self.marks.get(name, []))
            if not vals:
                continue
            p50 = vals[len(vals) // 2]
            p95 = vals[min(len(vals) - 1, int(len(vals) * 0.95))]
            print(f"  {name:22} {len(vals):>4} {p50:>7.2f}s {p95:>7.2f}s {vals[-1]:>7.2f}s")
        if self.errors:
            print(f"\n  {len(self.errors)} FAILURES")
            for uid, what in self.errors[:12]:
                print(f"    {uid}: {what}")
            if len(self.errors) > 12:
                print(f"    … and {len(self.errors) - 12} more")
        else:
            print("\n  no failures")
        print()


class VirtualStudent(threading.Thread):
    """One browser tab, as a thread: connect, queue, get paired, vote, talk.

    Speaks the same events `ManagerExercisePage.jsx` speaks, in the same order,
    because anything else would measure a path no real student takes. The uid is a
    fresh random one per run so repeat runs never collide on a seat.
    """

    def __init__(self, idx, url, config_id, timings, through, stop_evt):
        super().__init__(daemon=True)
        self.idx = idx
        self.uid = f"load-{uuid.uuid4().hex[:10]}"
        self.display = f"Load{idx:02d}"
        self.url, self.config_id = url, config_id
        self.t, self.through, self.stop = timings, through, stop_evt
        self.room_id = None
        self.phase = None
        self.sio = socketio.Client(reconnection=False, logger=False, engineio_logger=False)
        self._matched = threading.Event()
        self._snapshot = threading.Event()
        self._echo = threading.Event()
        self._sent_at = None
        self._t0 = None

    def _wire(self):
        """Bind the handlers. Each one closes a latch the run loop waits on, so the
        script blocks on real server events rather than on sleeps it invented."""

        @self.sio.on("pool_waiting")
        def _(_data=None):
            self.t.record("pool_ack", time.time() - self._t0)

        @self.sio.on("match_found")
        def _(data):
            self.room_id = data.get("room_id")
            self.t.record("match_found", time.time() - self._t0)
            self._matched.set()

        @self.sio.on("exercise_state")
        def _(data):
            if not self._snapshot.is_set():
                self.t.record("first_snapshot", time.time() - self._t0)
            self.phase = data.get("phase")
            # Read the ballot off the snapshot rather than hardcoding names, so this
            # runs against any config. The server validates the pick against this
            # same list, so an invented name would be silently rejected and the room
            # would hang waiting for a vote that never counted.
            names = [c.get("name") for c in (data.get("candidates") or []) if c.get("name")]
            if names:
                self._cands = names
            self._snapshot.set()

        @self.sio.on("phase_change")
        def _(data):
            self.phase = data.get("phase")

        # Round-trip is measured on our OWN message coming back off the broadcast:
        # that is the full path (client -> server -> persist -> fan out), which is
        # what a student perceives as lag.
        @self.sio.on("message")
        def _(data):
            if data.get("sender_uid") == self.uid and self._sent_at:
                self.t.record("msg_rtt", time.time() - self._sent_at)
                self._sent_at = None
                self._echo.set()

    def run(self):
        self._t0 = time.time()
        try:
            self._wire()
            self.sio.connect(self.url, socketio_path="/socket.io",
                             transports=["websocket"], wait_timeout=30)
            self.t.record("connect", time.time() - self._t0)

            self.sio.emit("join_investigation_pool", {
                "config_id": self.config_id, "uid": self.uid, "display_name": self.display,
            })

            # Wait for the professor (or --jwt) to pair the class. Long, because
            # this is a human step; the whole point is that it is not a hang.
            if not self._matched.wait(timeout=300):
                self.t.fail(self.uid, "never paired (no match_found within 300s)")
                return

            self.sio.emit("get_history", {
                "room_id": self.room_id, "uid": self.uid, "display_name": self.display,
            })
            if not self._snapshot.wait(timeout=60):
                self.t.fail(self.uid, "paired but no exercise_state snapshot")
                return

            self._round_zero()
            if self.through in ("discuss", "debrief"):
                self._talk()
        except Exception as e:                      # noqa: BLE001 — one seat dying is data
            self.t.fail(self.uid, f"{type(e).__name__}: {str(e)[:90]}")
        finally:
            try:
                self.sio.disconnect()
            except Exception:                       # noqa: BLE001
                pass

    def _round_zero(self):
        """Commit a private pick, the way a real student leaves the solo screen.

        Reads the candidate list off the snapshot rather than hardcoding names, so
        this works on any config. The room cannot reach round 1 until every seat
        has voted, so skipping this would stall the whole group.
        """
        for _ in range(60):
            if self.stop.is_set():
                return
            if self.phase in ("solo", "reading"):
                break
            time.sleep(1)
        # A small stagger: 50 clients voting in the same millisecond is a thundering
        # herd no class produces, and it measures a burst rather than a class.
        time.sleep(random.uniform(0.5, 4.0))
        pick = self._a_candidate()
        if not pick:
            return
        self.sio.emit("submit_solo_vote", {
            "room_id": self.room_id, "uid": self.uid, "candidate": pick,
        })

    def _a_candidate(self):
        """Spread picks across the ballot so round 0 produces a split, not a sweep.

        Indexed by seat rather than random: a deterministic spread makes two runs
        at the same N comparable, which is the whole point of a sweep.
        """
        cands = getattr(self, "_cands", None)
        if not cands:
            self.t.fail(self.uid, "snapshot carried no candidates")
            return ""
        return cands[self.idx % len(cands)]

    def _talk(self):
        """Send round-1 chatter at a human cadence and time each round trip."""
        deadline = time.time() + 120
        while time.time() < deadline and not self.stop.is_set():
            if self.phase not in ("discuss", "debrief"):
                time.sleep(1)
                continue
            self._echo.clear()
            self._sent_at = time.time()
            self.sio.emit("send_message", {
                "room_id": self.room_id, "uid": self.uid,
                "text": random.choice(CHATTER),
            })
            if not self._echo.wait(timeout=30):
                self.t.fail(self.uid, "message never echoed back within 30s")
                return
            time.sleep(random.uniform(4, 12))       # students type, then read


def pair_now(url, config_id, jwt):
    """Trigger the professor's pairing over HTTP, so a sweep needs no human."""
    r = requests.post(f"{url}/api/manager-exercise/{config_id}/pair",
                      headers={"Authorization": f"Bearer {jwt}"}, timeout=30)
    print(f"  pair -> {r.status_code} {r.text[:160]}")
    return r.ok


def run_cohort(url, config_id, students, through="discuss", ramp=0.25,
               on_ready=None, timeout=420):
    """Drive one cohort and return (Timings, wall_seconds).

    `on_ready` is called once every student is queued — the runner passes the
    pairing trigger, a human passes None and pairs from the dashboard. Splitting
    it out is what lets the same harness serve both without a branch inside it.
    """
    timings, stop = Timings(), threading.Event()
    seats = [VirtualStudent(i, url, config_id, timings, through, stop)
             for i in range(students)]
    t0 = time.time()
    for s in seats:
        s.start()
        time.sleep(ramp)
    if on_ready:
        time.sleep(5)                 # let the last arrival register in the pool
        on_ready()
    else:
        print("\n  >>> students queued. Pair them from the dashboard. <<<\n")
    try:
        for s in seats:
            s.join(timeout=timeout)
    except KeyboardInterrupt:
        stop.set()
    return timings, time.time() - t0
