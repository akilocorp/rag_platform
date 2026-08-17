# @language  Python
# @updated   2026-08-18
# @changed   add_message takes an optional `reasoning`, stored on the document only — ACTR's private
#            narration of why it took the turn. Never rendered into the transcript and never broadcast,
#            so it cannot leak to a student or back into the facilitator's own next prompt.
#            Prior: Quote-reply support: every message gets a stable `mid`; add_message accepts a `reply_to`
#            parent mid and stores a denormalized {mid, sender, snippet} so a quote survives the parent
#            being trimmed/deleted; _message_by_mid resolver + legacy-mid backfill on load; get_context_summary
#            annotates reply lines so the model sees thread structure.
#            Prior: Added recent_by_sender: pulls one sender's last N message texts from the transcript, so the
#            facilitator can be shown its own recent turns and told when it is repeating itself.
#            Prior: add_message accepts an optional sender_uid, stamped on the message so the Manager Exercise client marks a viewer's OWN messages by stable id (not a drift-prone display name). Prior: optional sender_role/sender_seat for role-name rendering.
import uuid
from datetime import datetime
from typing import List, Dict, Optional
from flask import current_app
from src.managers.bot_manager import room_bot_registry

# A quote-reply preview is truncated to this many chars so the transcript line and
# the client quote block stay one-line. The snippet is denormalized onto the child
# message (not looked up live) so it survives the parent being trimmed or deleted.
REPLY_SNIPPET_CHARS = 120

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
            # Messages written before quote-reply shipped have no `mid`. Synthesize a
            # deterministic one so they can still be *targeted* by a reply. It isn't
            # persisted back — it only needs to be stable within this loaded window.
            for m in stored:
                if not m.get("mid"):
                    m["mid"] = f"legacy:{m.get('turn')}"
            self.messages = stored
        except Exception as e:
            current_app.logger.error(f"Failed to load group chat history for {self.room_id}: {e}")

    def _message_by_mid(self, mid: str) -> Optional[Dict]:
        """Find a loaded message by its stable `mid` (None if absent/trimmed)."""
        if not mid:
            return None
        for m in self.messages:
            if m.get("mid") == mid:
                return m
        return None

    def _build_reply_preview(self, reply_to_mid: str) -> Optional[Dict]:
        """Resolve a parent mid into a self-contained quote preview.

        Denormalizes the parent's DISPLAY sender (role name in the Manager Exercise,
        else the raw sender key) and a one-line snippet, computed server-side so a
        spoofed client can't inject preview text. Returns None if the parent is gone.
        """
        parent = self._message_by_mid(reply_to_mid)
        if not parent:
            return None
        snippet = " ".join((parent.get("text") or "").split())
        if len(snippet) > REPLY_SNIPPET_CHARS:
            snippet = snippet[:REPLY_SNIPPET_CHARS - 1].rstrip() + "…"
        return {
            "mid": reply_to_mid,
            "sender": parent.get("sender_role") or parent.get("sender") or "",
            "snippet": snippet,
        }

    def add_message(self, sender: str, text: str, sender_role: str = None, sender_seat: int = None, sender_uid: str = None, reply_to: str = None, reasoning: str = None) -> Dict:
        """Add message to in-memory history and persist to MongoDB. Returns the stored dict.

        `sender` is the attribution key (uid, or "ai:<idx>" for an AI seat) — kept
        stable for the grader. For the Manager Exercise we also stamp an optional
        `sender_role` (the seat's role name, shown to clients instead of the raw
        uid/AI key) and `sender_seat` (used client-side to mark a viewer's OWN
        messages without ever revealing which seats are AI). Both default to None
        so the plain group-chat path stores exactly as before.

        `reply_to` is the parent message's `mid` when this is a quote-reply. It is
        resolved here into a denormalized preview object; an unresolvable parent just
        drops the reply (renders as a normal message). Returning the stored dict lets
        the socket layer echo the new `mid`/`reply_to` on its broadcast.

        `reasoning` is ACTR's private narration of why it took the turn, split off the
        reply by `ai_manager._split_markers`. It is stored on the document and nowhere
        else: `get_context_summary` renders only turn/sender/text, so it cannot leak
        back into the facilitator's own next prompt, and `_post` broadcasts only
        sender/text, so it never reaches a student. Kept for tuning — until now the
        only record of why ACTR spoke was the message it produced.
        """
        timestamp = datetime.now().isoformat()

        message = {
            "room_id": self.room_id,
            # Stable client-visible id, immune to the turn-renumbering trim below, so a
            # stored reply_to never silently re-points. Lives on the in-memory dict too,
            # so it's available for the live broadcast (not only after a reload).
            "mid": uuid.uuid4().hex,
            "sender": sender,
            "text": text,
            "timestamp": timestamp,
            "turn": len(self.messages) + 1
        }
        if sender_role is not None:
            message["sender_role"] = sender_role
        if sender_seat is not None:
            message["sender_seat"] = sender_seat
        # Stable per-uid key so the client marks a viewer's OWN messages by id, not by
        # a drift-prone display name. Only student posts carry it; ACTR posts pass None.
        if sender_uid is not None:
            message["sender_uid"] = sender_uid
        # Quote-reply: freeze a self-contained preview of the parent onto this message.
        if reply_to:
            preview = self._build_reply_preview(reply_to)
            if preview:
                message["reply_to"] = preview
        if reasoning:
            message["reasoning"] = reasoning

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

        return message

    def recent_by_sender(self, sender: str, limit: int = 4) -> List[str]:
        """The last `limit` message texts from one sender, oldest first.

        Used to hand ACTR its own recent turns so a repeated question can be detected
        against them. Reads the room transcript rather than any in-process counter, so
        it survives a restart mid-debrief for free.
        """
        texts = [m.get("text") or "" for m in self.messages if m.get("sender") == sender]
        return texts[-limit:]

    def get_context_summary(self, num_messages: int = 15) -> str:
        """Generates a summary for the AI bots."""
        if not self.messages:
            return "No messages yet."

        recent = self.messages[-num_messages:]
        context = f"**Total Turns**: {len(self.messages)}\n\n### Recent Messages:\n"

        for msg in recent:
            line = f"[{msg['turn']}] **{msg['sender']}**"
            # Surface quote-reply structure to the model so it understands what a
            # message is answering (and which student a reply is aimed at).
            rt = msg.get("reply_to")
            if rt and rt.get("snippet"):
                line += f' ↳re:"{rt["snippet"]}"'
            line += f": {msg['text']}\n"
            context += line

        return context

    # ------------------------------------------------------------------
    # Manager-Exercise helpers
    # ------------------------------------------------------------------
    # The Manager Exercise reuses this same room transcript (group_chat_messages)
    # for its discussion. The AI Manager and AI-filled seats speak into the room
    # under their *role name* (e.g. "Marketing Manager"), so their turns persist
    # exactly like a human's and replay/grade uniformly. These thin wrappers keep
    # the sockets layer from reaching into ConversationContext internals.

    def append_manager_message(self, sender_key: str, text: str, sender_role: str = None, sender_seat: int = None, reply_to: str = None) -> Dict:
        """Persist + record an AI-seat turn into the room transcript. Returns the stored dict.

        `sender_key` is the grader attribution key ("ai:<idx>"); `sender_role` is
        the seat's role name shown to clients (so the AI is indistinguishable from a
        human manager) and `sender_seat` its index. `reply_to` is a parent mid when
        the facilitator is answering one student. Thin wrapper over add_message so
        the sockets layer doesn't reach into ConversationContext internals.
        """
        return self.add_message(sender_key, text, sender_role=sender_role, sender_seat=sender_seat, reply_to=reply_to)

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