from datetime import datetime
from typing import Dict, List, Optional, Tuple
from uuid import uuid4

class MatchManager:
    """
    Manages a per-config matchmaking queue and active matched rooms.

    Flow:
      1. User joins → join_queue(config_id, uid, group_size)
      2. When enough users are queued → a unique room_id is created and
         returned along with the list of matched uids.
      3. Callers (socket handlers) must emit 'match_found' to each matched
         uid so they can join the room via Socket.IO.
      4. On disconnect → leave_queue(uid) cleans up gracefully.
    """

    def __init__(self):
        # room_id → { members, config_id, created_at }
        self.active_rooms: Dict[str, Dict] = {}
        # uid → room_id  (for users already inside a matched room)
        self.user_to_room: Dict[str, str] = {}
        # config_id → [uid, ...]  (waiting queue per config)
        self.queues: Dict[str, List[str]] = {}
        # uid → config_id  (so we can remove from the right queue on disconnect)
        self.user_to_queue: Dict[str, str] = {}

    # ------------------------------------------------------------------
    # QUEUE MANAGEMENT
    # ------------------------------------------------------------------

    def join_queue(self, config_id: str, uid: str, group_size: int) -> Tuple[Optional[str], Optional[List[str]]]:
        """
        Add uid to the waiting queue for config_id.

        Returns:
            (room_id, [matched_uids])  if a full group formed, else (None, None).
        """
        # Drop any stale queue/room membership first
        self.leave_queue(uid)

        queue = self.queues.setdefault(config_id, [])
        if uid not in queue:
            queue.append(uid)
        self.user_to_queue[uid] = config_id

        # Check if we have a full group
        if len(queue) >= group_size:
            matched_uids = queue[:group_size]
            self.queues[config_id] = queue[group_size:]  # leave remainder waiting

            room_id = f"{config_id}_{uuid4().hex[:8]}"
            self.active_rooms[room_id] = {
                "members": list(matched_uids),
                "config_id": config_id,
                "created_at": datetime.now()
            }
            for u in matched_uids:
                self.user_to_room[u] = room_id
                self.user_to_queue.pop(u, None)

            return room_id, matched_uids

        return None, None

    def leave_queue(self, uid: str):
        """Remove uid from whatever queue they are currently waiting in."""
        config_id = self.user_to_queue.pop(uid, None)
        if config_id and config_id in self.queues:
            try:
                self.queues[config_id].remove(uid)
            except ValueError:
                pass

    def queue_position(self, config_id: str, uid: str) -> int:
        """1-based position in queue, or -1 if not queued."""
        queue = self.queues.get(config_id, [])
        try:
            return queue.index(uid) + 1
        except ValueError:
            return -1

    # ------------------------------------------------------------------
    # ROOM MANAGEMENT
    # ------------------------------------------------------------------

    def get_room_for_user(self, uid: str) -> Optional[str]:
        """Return the room_id the user is currently matched into, if any."""
        return self.user_to_room.get(uid)

    def remove_user(self, uid: str):
        """Remove a user from their active matched room."""
        room_id = self.user_to_room.pop(uid, None)
        if room_id and room_id in self.active_rooms:
            members = self.active_rooms[room_id]["members"]
            if uid in members:
                members.remove(uid)

    def get_room_members(self, room_id: str) -> List[str]:
        return self.active_rooms.get(room_id, {}).get("members", [])


# Global singleton
match_manager = MatchManager()
