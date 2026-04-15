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

    def add_message(self, sender: str, text: str):
        """Add message to in-memory history and persist to MongoDB."""
        timestamp = datetime.now().isoformat()

        message = {
            "room_id": self.room_id,
            "sender": sender,
            "text": text,
            "timestamp": timestamp,
            "turn": len(self.messages) + 1
        }

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