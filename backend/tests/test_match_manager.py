"""
Unit tests for MatchManager (backend/src/managers/match_manager.py).
Run with:  pytest backend/tests/test_match_manager.py -v
"""
import sys, os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from src.managers.match_manager import MatchManager


def make_mm():
    """Fresh MatchManager for each test."""
    return MatchManager()


# --------------------------------------------------------------------------
# join_queue — basic matching
# --------------------------------------------------------------------------

def test_no_match_until_group_full():
    mm = make_mm()
    room, uids = mm.join_queue("cfg1", "userA", group_size=2)
    assert room is None and uids is None


def test_match_fires_when_group_full():
    mm = make_mm()
    mm.join_queue("cfg1", "userA", group_size=2)
    room, uids = mm.join_queue("cfg1", "userB", group_size=2)

    assert room is not None
    assert room.startswith("cfg1_")
    assert set(uids) == {"userA", "userB"}


def test_matched_users_are_tracked_in_room():
    mm = make_mm()
    mm.join_queue("cfg1", "userA", group_size=2)
    room, _ = mm.join_queue("cfg1", "userB", group_size=2)

    assert mm.get_room_for_user("userA") == room
    assert mm.get_room_for_user("userB") == room


def test_remainder_stays_in_queue():
    """With group_size=2 and 3 users, the 3rd should stay queued."""
    mm = make_mm()
    mm.join_queue("cfg1", "u1", group_size=2)
    mm.join_queue("cfg1", "u2", group_size=2)  # match fires for u1+u2
    mm.join_queue("cfg1", "u3", group_size=2)  # u3 waits

    assert mm.queue_position("cfg1", "u3") == 1


def test_group_size_three():
    mm = make_mm()
    mm.join_queue("cfg1", "u1", group_size=3)
    mm.join_queue("cfg1", "u2", group_size=3)
    room, uids = mm.join_queue("cfg1", "u3", group_size=3)

    assert room is not None
    assert set(uids) == {"u1", "u2", "u3"}


# --------------------------------------------------------------------------
# leave_queue
# --------------------------------------------------------------------------

def test_leave_queue_removes_user():
    mm = make_mm()
    mm.join_queue("cfg1", "userA", group_size=3)
    mm.leave_queue("userA")

    assert mm.queue_position("cfg1", "userA") == -1


def test_leave_queue_prevents_spurious_match():
    """After userA leaves, userB+userC should not match userA."""
    mm = make_mm()
    mm.join_queue("cfg1", "userA", group_size=2)
    mm.leave_queue("userA")

    room, uids = mm.join_queue("cfg1", "userB", group_size=2)
    assert room is None  # still only 1 user in queue


def test_leave_queue_idempotent():
    """Calling leave_queue on a user not in any queue should not raise."""
    mm = make_mm()
    mm.leave_queue("ghost")  # should not raise


# --------------------------------------------------------------------------
# queue_position
# --------------------------------------------------------------------------

def test_queue_position_correct_order():
    mm = make_mm()
    mm.join_queue("cfg1", "first", group_size=5)
    mm.join_queue("cfg1", "second", group_size=5)
    mm.join_queue("cfg1", "third", group_size=5)

    assert mm.queue_position("cfg1", "first") == 1
    assert mm.queue_position("cfg1", "second") == 2
    assert mm.queue_position("cfg1", "third") == 3


def test_queue_position_returns_minus_one_if_not_queued():
    mm = make_mm()
    assert mm.queue_position("cfg1", "nobody") == -1


# --------------------------------------------------------------------------
# duplicate user
# --------------------------------------------------------------------------

def test_duplicate_join_does_not_add_twice():
    mm = make_mm()
    mm.join_queue("cfg1", "userA", group_size=3)
    mm.join_queue("cfg1", "userA", group_size=3)  # rejoin same user

    assert mm.queue_position("cfg1", "userA") == 1
    assert len(mm.queues.get("cfg1", [])) == 1


# --------------------------------------------------------------------------
# multi-config isolation
# --------------------------------------------------------------------------

def test_different_configs_dont_cross_match():
    mm = make_mm()
    mm.join_queue("cfgA", "userA", group_size=2)
    room, uids = mm.join_queue("cfgB", "userB", group_size=2)

    # Different configs — should not match
    assert room is None


# --------------------------------------------------------------------------
# room management
# --------------------------------------------------------------------------

def test_get_room_members():
    mm = make_mm()
    mm.join_queue("cfg1", "u1", group_size=2)
    room, _ = mm.join_queue("cfg1", "u2", group_size=2)

    assert set(mm.get_room_members(room)) == {"u1", "u2"}


def test_remove_user_from_room():
    mm = make_mm()
    mm.join_queue("cfg1", "u1", group_size=2)
    room, _ = mm.join_queue("cfg1", "u2", group_size=2)

    mm.remove_user("u1")
    assert mm.get_room_for_user("u1") is None
    assert "u1" not in mm.get_room_members(room)


def test_room_ids_are_unique():
    """Two separate matches for the same config should get different room IDs."""
    mm = make_mm()
    mm.join_queue("cfg1", "u1", group_size=2)
    room1, _ = mm.join_queue("cfg1", "u2", group_size=2)

    mm.join_queue("cfg1", "u3", group_size=2)
    room2, _ = mm.join_queue("cfg1", "u4", group_size=2)

    assert room1 != room2
