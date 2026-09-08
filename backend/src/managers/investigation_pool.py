# @language  Python
# @updated   2026-09-08
# @changed   Group size is now the professor's own two numbers instead of a hardcoded 3/4:
#            `partition_sizes`/`pair`/`join` all take `normal_size` + `max_size` (see
#            `manager_exercise.investigation_group_size` / `_max` in config_routes.py). Below
#            `normal_size` total, pairing does nothing at all — no group smaller than `normal_size`
#            is ever formed, so `pair()` (and `join()`'s latecomer path, capped at `max_size`) can now
#            leave students unplaced in the waiting pool instead of always placing everyone. That
#            means pairing is no longer one-shot: `pair()` drops its old "already paired, return the
#            existing groups" early return and instead partitions whatever is CURRENTLY waiting on
#            every call, appending any new groups it can form — a second "Start Pairing" click (or
#            enough latecomers accumulating) picks up where the last one left off. `paired` on the
#            pool is now "has pairing run at least once" (gates whether a new joiner waits or tries
#            an existing group), not "everyone is placed".
"""In-process pool of students waiting to be paired into an investigation room.

WHY THIS EXISTS
    Every other manager-exercise template is self-service: a student opens the
    config, sees a lobby of named breakout rooms, and picks one. `investigation`
    (`flow.prof_paired`, see `exercise_templates.py`) removes that screen on
    purpose — a student should not be choosing rooms or seeing who else is
    around, because the whole point is that a group is assembled BEHIND them and
    each seat is handed a different slice of the same case without ever being
    told so. This module is the headcount the professor watches and the
    partition that runs each time they press pair.

THE GROUPING RULE
    Two numbers, both the professor's own (`normal_size`, `max_size` — see
    `partition_sizes`): groups of `normal_size` are the goal, and a remainder
    is folded one-per-group into that many existing groups instead of left as
    its own short group, up to `max_size` per group. Below `normal_size`
    students waiting, pairing does nothing — a group smaller than the
    professor's own floor is never formed, full stop. A remainder that can't
    fit under `max_size` either (every group already at the cap) is left
    waiting too, for the next pairing pass.

LATE ARRIVALS
    A student who joins after `pair()` has run at least once for this config
    tries to drop straight into whichever existing group has room under
    `max_size` (the smallest first, so latecomers spread out rather than
    piling onto one) — the same remainder rule above, applied one seat at a
    time. If every group is already at `max_size`, they wait like anyone else,
    for either the next latecomer to open room elsewhere or the professor's
    next pairing pass. `ExerciseState.note_participant`'s existing role
    round-robin then assigns them a case file from their position in the
    group — this module only decides WHICH room a student lands in, never
    which case file; that is `note_participant`'s job, unchanged.

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


class _ConfigPool:
    def __init__(self):
        # uid -> display name, insertion-ordered (plain dict preserves it). Only
        # students who have not yet been placed in a room.
        self.joined: Dict[str, str] = {}
        # Whether `pair()` has run at least once — NOT "everyone is placed". A
        # config can be paired and still have students in `joined` (a remainder
        # that couldn't fit under `max_size`, or too few for another full group).
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


def partition_sizes(n: int, normal_size: int, max_size: int) -> List[int]:
    """Group sizes for `n` waiting students, built from the professor's own
    `normal_size` (the ideal) and `max_size` (how far a group may grow to
    absorb a remainder or a latecomer).

    Builds as many `normal_size` groups as `n` allows, then spreads any
    remainder one seat at a time, round-robin, into groups that still have
    room under `max_size`. The sizes returned may not add up to `n` — a
    remainder that can't be seated under `max_size`, or fewer than
    `normal_size` altogether, is left out entirely rather than ever forming a
    group smaller than `normal_size`. The caller (`pair`) leaves whatever
    wasn't placed in the waiting pool.
    """
    if n <= 0 or normal_size <= 0:
        return []
    max_size = max(max_size or normal_size, normal_size)
    full, remainder = divmod(n, normal_size)
    if full == 0:
        return []
    sizes = [normal_size] * full
    idx = 0
    while remainder > 0:
        placed = False
        for _ in range(len(sizes)):
            if sizes[idx] < max_size:
                sizes[idx] += 1
                remainder -= 1
                placed = True
                idx = (idx + 1) % len(sizes)
                break
            idx = (idx + 1) % len(sizes)
        if not placed:
            break  # every group is already at max_size — leave the rest waiting
    return sizes


def join(config_id: str, uid: str, name: Optional[str], max_size: int) -> Tuple[str, Optional[str]]:
    """Record a student joining an investigation exercise.

    Returns `("waiting", None)` when added to the pool, or `("assigned",
    room_id)` when dropped straight into an existing group with room under
    `max_size` (pairing has run at least once and some group isn't full).
    Idempotent for a uid that's already waiting or already assigned.
    """
    p = _pool(config_id)
    with _lock:
        existing = room_for_uid(config_id, uid)
        if existing:
            return "assigned", existing
        if p.paired:
            room_id = _pick_group_for_latecomer(p, max_size)
            if room_id:
                p.groups[room_id].append(uid)
                return "assigned", room_id
            # Pairing has happened, but nowhere has room right now — wait like
            # anyone else, for the next latecomer to free room elsewhere isn't a
            # thing (nobody leaves a group), so realistically for the next
            # pairing pass once enough have queued up.
        if uid not in p.joined:
            p.joined[uid] = name or uid
        return "waiting", None


def _pick_group_for_latecomer(p: _ConfigPool, max_size: int) -> Optional[str]:
    """The room a latecomer should join: the smallest existing group that still
    has room under `max_size`, ties broken on room id so repeated calls spread
    arrivals rather than piling onto one. None if every group is already full."""
    candidates = [rid for rid, members in p.groups.items() if len(members) < max_size]
    if not candidates:
        return None
    return min(candidates, key=lambda rid: (len(p.groups[rid]), rid))


def leave(config_id: str, uid: str):
    """Drop a student who left before being placed (closed the tab, picked a
    different exercise). A no-op for anyone already seated in a group."""
    p = _pool(config_id)
    with _lock:
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


def pair(config_id: str, room_id_for: Callable[[int], str], normal_size: int, max_size: int) -> List[Dict]:
    """Partition whatever is CURRENTLY waiting into new groups of `normal_size`
    (remainder folded in up to `max_size` — see `partition_sizes`), and append
    them to whatever groups already exist. `room_id_for(index)` names each new
    room (1-based, continuing from however many groups already exist) — the
    caller supplies this so room ids stay in the one scheme every other
    manager-exercise room uses (`_room_id_for` in group_chat_sockets.py).

    Re-runnable, not one-shot: fewer than `normal_size` waiting (or a remainder
    `partition_sizes` couldn't seat under `max_size`) simply forms nothing this
    time, leaving those students in the pool for the next call — which is what
    lets a second "Start Pairing" click (or enough latecomers accumulating)
    pick up where an earlier, partial pass left off. Only students actually
    placed are removed from the waiting pool.

    Returns the NEW groups formed this call (not the whole config's groups) as
    `[{"room_id": ..., "members": [{"uid", "name"}, ...]}, ...]`.
    """
    p = _pool(config_id)
    with _lock:
        uids = list(p.joined.keys())
        sizes = partition_sizes(len(uids), normal_size, max_size)
        if not sizes:
            p.paired = True  # even "nothing to do yet" counts as pairing having run
            return []
        groups: List[Dict] = []
        cursor = 0
        start_index = len(p.groups) + 1
        for i, size in enumerate(sizes):
            room_id = room_id_for(start_index + i)
            members = uids[cursor:cursor + size]
            cursor += size
            p.groups[room_id] = list(members)
            groups.append({
                "room_id": room_id,
                "members": [{"uid": u, "name": p.joined.get(u, u)} for u in members],
            })
        # Only the students actually placed leave the waiting pool — any
        # leftover past `cursor` stays for the next pairing pass.
        for u in uids[:cursor]:
            p.joined.pop(u, None)
        p.paired = True
        logger.info(f"🔗 paired {cursor} student(s) into {len(groups)} new group(s) for config {config_id} "
                    f"({len(uids) - cursor} left waiting)")
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
