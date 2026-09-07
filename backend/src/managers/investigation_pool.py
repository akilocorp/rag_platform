# @language  Python
# @updated   2026-09-07
# @changed   New file: the professor-paired join pool for `investigation`-template manager exercises.
"""In-process pool of students waiting to be paired into an investigation room.

WHY THIS EXISTS
    Every other manager-exercise template is self-service: a student opens the
    config, sees a lobby of named breakout rooms, and picks one. `investigation`
    (`flow.prof_paired`, see `exercise_templates.py`) removes that screen on
    purpose — a student should not be choosing rooms or seeing who else is
    around, because the whole point is that a group is assembled BEHIND them and
    each seat is handed a different slice of the same case without ever being
    told so. This module is the headcount the professor watches and the
    partition that runs once they press pair.

THE GROUPING RULE
    Groups of 3 — one case file per seat. A remainder of 1 or 2 students is not
    left as its own short group; it is folded one-per-group into that many
    existing groups instead, so at most a couple of groups run at 4 (two seats
    sharing a case file) and nobody ever sits in a group of 1 or 2. See
    `partition_sizes`.

LATE ARRIVALS
    A student who joins after `pair()` has already run for this config is
    dropped straight into whichever existing group is still sitting at the base
    size of 3 (spread round-robin rather than piling every latecomer into the
    same group), which is exactly the remainder rule above applied one seat at a
    time. `ExerciseState.note_participant`'s existing role round-robin then
    assigns them the same case file as whoever holds seat 1 of that group — this
    module only decides WHICH room a student lands in, never which case file;
    that is `note_participant`'s job, unchanged.

WHY IN-PROCESS
    Same limitation as `match_manager.py`: this is per-worker memory, wiped by a
    restart. A student re-joins on reconnect and there is nothing to recover — a
    config not yet paired just starts its headcount over. Multi-worker deployment
    would need to move this to Redis, same as `match_manager`.
"""
import logging
import threading
import time
from typing import Callable, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# One case file per seat. Not configurable — the exercise is authored around
# exactly three case files (see `case_pack.roles`), and a group size the pack
# doesn't have documents for would just hand out duplicates from seat 1.
GROUP_SIZE = 3


class _ConfigPool:
    def __init__(self):
        # uid -> display name, insertion-ordered (plain dict preserves it). Only
        # students who have not yet been placed in a room.
        self.joined: Dict[str, str] = {}
        self.paired = False
        # room_id -> [uid, ...] in seating order, for every group `pair()` has
        # formed. Grows as late arrivals are added; `note_participant` derives
        # their role from their position in this same order.
        self.groups: Dict[str, List[str]] = {}
        # Students who backed out mid-exercise (see `quit`), newest first — read
        # by the professor's pairing panel so a quiet drop-out doesn't go unnoticed.
        self.quits: List[Dict] = []


_pools: Dict[str, _ConfigPool] = {}
_lock = threading.RLock()


def _pool(config_id: str) -> _ConfigPool:
    with _lock:
        return _pools.setdefault(config_id, _ConfigPool())


def partition_sizes(n: int) -> List[int]:
    """Group sizes for `n` students: chunks of `GROUP_SIZE`, any remainder folded
    one-per-group into that many groups instead of left as a short group.

    Fewer than `GROUP_SIZE` students total is the one case with nothing to fold
    into — a single group smaller than the base size is unavoidable there.
    """
    if n <= 0:
        return []
    if n < GROUP_SIZE:
        return [n]
    full, leftover = divmod(n, GROUP_SIZE)
    sizes = [GROUP_SIZE] * full
    for i in range(leftover):
        sizes[i % len(sizes)] += 1
    return sizes


def join(config_id: str, uid: str, name: Optional[str]) -> Tuple[str, Optional[str]]:
    """Record a student joining an investigation exercise.

    Returns `("waiting", None)` when added to the pool (pairing hasn't run yet),
    or `("assigned", room_id)` when pairing already ran and they were dropped
    straight into an existing group as a late arrival. Idempotent for a uid
    that's already waiting or already assigned.
    """
    p = _pool(config_id)
    with _lock:
        existing = room_for_uid(config_id, uid)
        if existing:
            return "assigned", existing
        if p.paired:
            room_id = _pick_group_for_latecomer(p)
            if room_id:
                p.groups[room_id].append(uid)
            return "assigned", room_id
        if uid not in p.joined:
            p.joined[uid] = name or uid
        return "waiting", None


def _pick_group_for_latecomer(p: _ConfigPool) -> Optional[str]:
    """The room a latecomer should join: the smallest existing group, ties broken
    on room id so repeated calls spread arrivals rather than piling onto one."""
    if not p.groups:
        return None
    return min(p.groups, key=lambda rid: (len(p.groups[rid]), rid))


def leave(config_id: str, uid: str):
    """Drop a student who left before pairing (closed the tab, picked a different
    exercise). A no-op once pairing has run — there is no lobby slot to free."""
    p = _pool(config_id)
    with _lock:
        if not p.paired:
            p.joined.pop(uid, None)


def room_for_uid(config_id: str, uid: str) -> Optional[str]:
    """Which room a student has already been placed in, or None if unplaced.

    The reconnect check: a student's own socket presence is not durable (a
    refresh drops it), but this mapping is, so a reload lands them back in their
    room instead of re-entering the pool or being treated as a fresh latecomer.
    """
    p = _pool(config_id)
    with _lock:
        for rid, members in p.groups.items():
            if uid in members:
                return rid
    return None


def status(config_id: str) -> Dict:
    """The professor's live view: who's waiting, whether pairing has run, and any
    quits — everything the pairing panel polls for."""
    p = _pool(config_id)
    with _lock:
        return {
            "joined": [{"uid": uid, "name": name} for uid, name in p.joined.items()],
            "count": len(p.joined),
            "paired": p.paired,
            "group_count": len(p.groups),
            "quits": list(p.quits),
        }


def pair(config_id: str, room_id_for: Callable[[int], str]) -> List[Dict]:
    """Freeze the current pool into groups. `room_id_for(index)` names each room
    (1-based) — the caller supplies this so room ids stay in the one scheme every
    other manager-exercise room uses (`_room_id_for` in group_chat_sockets.py).

    Idempotent: a config that has already paired returns its existing groups
    (including whatever late arrivals have joined since) instead of reshuffling
    students who may already be mid-exercise.

    Returns `[{"room_id": ..., "members": [{"uid", "name"}, ...]}, ...]` in the
    order groups were formed.
    """
    p = _pool(config_id)
    with _lock:
        if p.paired:
            return [
                {"room_id": rid, "members": [{"uid": u, "name": p.joined.get(u, u)} for u in members]}
                for rid, members in p.groups.items()
            ]
        uids = list(p.joined.keys())
        sizes = partition_sizes(len(uids))
        groups: List[Dict] = []
        cursor = 0
        for i, size in enumerate(sizes, start=1):
            room_id = room_id_for(i)
            members = uids[cursor:cursor + size]
            cursor += size
            p.groups[room_id] = list(members)
            groups.append({
                "room_id": room_id,
                "members": [{"uid": u, "name": p.joined.get(u, u)} for u in members],
            })
        p.paired = True
        logger.info(f"🔗 paired {len(uids)} student(s) into {len(groups)} group(s) for config {config_id}")
        return groups


def quit(config_id: str, uid: str, room_id: str, name: Optional[str] = None):
    """Record a student backing out mid-exercise, for the professor's panel.

    Does not touch the room or the roster — the exercise continues for whoever
    is left; this is purely a notification, kept here because it's already where
    the professor's pairing panel is polling.
    """
    p = _pool(config_id)
    with _lock:
        p.quits.insert(0, {
            "uid": uid,
            "name": name or p.joined.get(uid) or uid,
            "room_id": room_id,
            "at": time.time(),
        })
        # A diagnostic list, not a durable log — cap it so a config that runs for
        # terms on end doesn't grow this without bound.
        del p.quits[50:]


def reset(config_id: str):
    """Owner-only: wipe a config's pool back to empty, mirroring
    `reset_breakout_room`'s clean slate for the hiring lobby."""
    with _lock:
        _pools.pop(config_id, None)
