# @language  Python
# @updated   2026-07-20
# @changed   Store optional sender_role/sender_seat on messages so the Manager Exercise renders
#            everyone (human + AI) by role name and hides which seats are AI. Prior: append_manager_message + grading/nudge helpers.
from datetime import datetime
from typing import List, Dict, Optional
from flask import current_app
from src.managers.bot_manager import room_bot_registry

class ConversationContext:
    MAX_MESSAGES_PER_ROOM = 1000

    def __init__(self, room_id: str):
        self.room_id = room_id
        self.messages: List[Dict] = []
        self.user_profiles: Dict[str, Dict] = {}
        self.last_activity = datetime.now()

    def _load_from_db(self):
        """Load persisted messages from MongoDB into memory on first access."""
        try:
            db = current_app.config['MONGO_DB']
            stored = list(
                db['group_chat_messages']
                .find({"room_id": self.room_id}, {"_id": 0})
                .sort("turn", 1)
                .limit(self.MAX_MESSAGES_PER_ROOM)
            )
            self.messages = stored
        except Exception as e:
            current_app.logger.error(f"Failed to load group chat history for {self.room_id}: {e}")

    def add_message(self, sender: str, text: str, sender_role: str = None, sender_seat: int = None):
        """Add message to in-memory history and persist to MongoDB.

        `sender` is the attribution key (uid, or "ai:<idx>" for an AI seat) — kept
        stable for the grader. For the Manager Exercise we also stamp an optional
        `sender_role` (the seat's role name, shown to clients instead of the raw
        uid/AI key) and `sender_seat` (used client-side to mark a viewer's OWN
        messages without ever revealing which seats are AI). Both default to None
        so the plain group-chat path stores exactly as before.
        """
        timestamp = datetime.now().isoformat()

        message = {
            "room_id": self.room_id,
            "sender": sender,
            "text": text,
            "timestamp": timestamp,
            "turn": len(self.messages) + 1
        }
        if sender_role is not None:
            message["sender_role"] = sender_role
        if sender_seat is not None:
            message["sender_seat"] = sender_seat

        # Sliding window — trim oldest in memory if over limit
        if len(self.messages) >= self.MAX_MESSAGES_PER_ROOM:
            self.messages.pop(0)
            for i, msg in enumerate(self.messages, 1):
                msg["turn"] = i
            message["turn"] = len(self.messages) + 1

        self.messages.append(message)
        self.last_activity = datetime.now()

        # Persist to MongoDB
        try:
            db = current_app.config['MONGO_DB']
            db['group_chat_messages'].insert_one(dict(message))
        except Exception as e:
            current_app.logger.error(f"Failed to persist group chat message for {self.room_id}: {e}")

        # Update user profiles for human senders
        active_bots_in_room = room_bot_registry.get(self.room_id, {}).keys()
        is_bot = sender in active_bots_in_room or "System" in sender

        if not is_bot:
            if sender not in self.user_profiles:
                self.user_profiles[sender] = {"message_count": 0, "total_chars": 0}
            profile = self.user_profiles[sender]
            profile["message_count"] += 1
            profile["total_chars"] += len(text)

    def get_context_summary(self, num_messages: int = 15) -> str:
        """Generates a summary for the AI bots."""
        if not self.messages:
            return "No messages yet."

        recent = self.messages[-num_messages:]
        context = f"**Total Turns**: {len(self.messages)}\n\n### Recent Messages:\n"

        for msg in recent:
            context += f"[{msg['turn']}] **{msg['sender']}**: {msg['text']}\n"

        return context

    # ------------------------------------------------------------------
    # Manager-Exercise helpers
    # ------------------------------------------------------------------
    # The Manager Exercise reuses this same room transcript (group_chat_messages)
    # for its discussion. The AI Manager and AI-filled seats speak into the room
    # under their *role name* (e.g. "Marketing Manager"), so their turns persist
    # exactly like a human's and replay/grade uniformly. These thin wrappers keep
    # the sockets layer from reaching into ConversationContext internals.

    def append_manager_message(self, sender_key: str, text: str, sender_role: str = None, sender_seat: int = None):
        """Persist + record an AI-seat turn into the room transcript.

        `sender_key` is the grader attribution key ("ai:<idx>"); `sender_role` is
        the seat's role name shown to clients (so the AI is indistinguishable from a
        human manager) and `sender_seat` its index. Thin wrapper over add_message so
        the sockets layer doesn't reach into ConversationContext internals.
        """
        self.add_message(sender_key, text, sender_role=sender_role, sender_seat=sender_seat)

    def transcript_for_grading(self) -> List[Dict]:
        """Flat [{sender, text}, ...] transcript for the LLM-judge grader.

        The grader keys off the raw `sender` (uid or role label), so we hand back
        the persisted senders verbatim rather than the display-summarized form.
        """
        return [
            {"sender": m.get("sender", ""), "text": m.get("text", "")}
            for m in self.messages
        ]

    def summary_for_nudge(self, num_messages: int = 12) -> str:
        """Compact recent-discussion summary fed to the AI Manager's nudge calls.

        Thin alias over get_context_summary with a discuss-sized window so the AI
        Manager sees enough of the room to nudge usefully without blowing tokens.
        """
        return self.get_context_summary(num_messages=num_messages)

# ==========================================
# GLOBAL MANAGER FUNCTIONS
# ==========================================
conversation_contexts: Dict[str, ConversationContext] = {}

def get_or_create_context(room_id: str) -> ConversationContext:
    if room_id not in conversation_contexts:
        ctx = ConversationContext(room_id)
        ctx._load_from_db()  # Restore history from MongoDB on first access
        conversation_contexts[room_id] = ctx
    else:
        conversation_contexts[room_id].last_activity = datetime.now()
    return conversation_contexts[room_id]

def get_context(room_id: str) -> Optional[ConversationContext]:
    return conversation_contexts.get(room_id)

def remove_context(room_id: str):
    if room_id in conversation_contexts:
        del conversation_contexts[room_id]