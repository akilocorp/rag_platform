from datetime import datetime
from typing import Dict, List

class MatchManager:
    """Simplified: Manages active drop-in rooms and online members."""

    def __init__(self):
        self.active_rooms: Dict[str, Dict] = {} # room_id -> room_data
        self.user_to_room: Dict[str, str] = {}  # uid -> room_id

    def create_room(self, room_id: str, members: List[str] = None):
        """Initializes a room or adds members to an existing one."""
        if room_id not in self.active_rooms:
            self.active_rooms[room_id] = {
                "members": [],
                "created_at": datetime.now()
            }
        
        if members:
            for uid in members:
                if uid not in self.active_rooms[room_id]["members"]:
                    self.active_rooms[room_id]["members"].append(uid)
                self.user_to_room[uid] = room_id
                
        return room_id

    def remove_user(self, uid: str):
        """Removes a user from their active room."""
        room_id = self.user_to_room.get(uid)
        if room_id and room_id in self.active_rooms:
            if uid in self.active_rooms[room_id]["members"]:
                self.active_rooms[room_id]["members"].remove(uid)
            del self.user_to_room[uid]

# Global Instance
match_manager = MatchManager()