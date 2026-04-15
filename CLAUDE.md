# RAG Platform — CLAUDE.md

## Project Overview
Configurable chatbot research platform. Professors set persona, system prompt, and model. Supports 1:1 chat and group chat. Embedded into Qualtrics surveys via iframe + postMessage.

## Stack
- **Frontend**: React + Vite + TailwindCSS, served via nginx in Docker
- **Backend**: Flask + Flask-SocketIO, Python
- **DB**: MongoDB Atlas (LangChain MongoDBChatMessageHistory + custom collections)
- **Deployment**: AWS (testfront.bitterlylab.com), Docker Compose

---

## Key Collections (MongoDB)
| Collection | Purpose |
|---|---|
| `chat_histories` | 1:1 chat messages (LangChain format) |
| `chat_session_metadata` | Session ownership (user_id, config_id) |
| `group_chat_messages` | Group chat messages (persisted, room_id scoped) |
| `config_collections` | Bot configurations |
| `vector_collection` | RAG embeddings |
| `bug_reports` | Bug reports submitted via /api/report |

---

## Architecture Notes

### 1:1 Chat (`/chat/:configId/:chatId`)
- Streaming via fetch + NDJSON (`/api/chat/:configId/:chatId`)
- History loaded from MongoDB on `chatId` change
- Qualtrics integration: postMessage to parent window for transcript capture

### Group Chat (`/group/:configId`)
- Socket.IO for real-time messaging
- Messages persisted to `group_chat_messages` collection
- User identity resolved in priority order: JWT user_id → Qualtrics responseId → localStorage random ID
- `context_manager.py` loads history from MongoDB on first room access, persists each new message

### Qualtrics Integration
- `qualtricsIntegration.js` runs inside the iframe, sends `CHAT_MESSAGE` postMessages to parent
- `paste.js` runs in the Qualtrics parent page, listens for messages and saves transcript on page submit
- `ChatPage.jsx` uses `qualtricsSentCountRef` to track which messages have been sent to parent (fixes bug where only AI messages were sent)

---

## In-Progress: Group Chat Matching System

### Goal
When a user opens a group chat, instead of joining immediately, they enter a **matchmaking queue**. Once enough users are queued (determined by `group_size` in the config), they are matched into a unique room together.

### Config field
`group_size` (int, default 2) — stored in `config_collections` per bot config.

### What's done
- **`match_manager.py`** — fully rewritten with queue + matching logic:
  - `join_queue(config_id, uid, group_size)` → returns `(room_id, matched_uids)` when queue fills, else `(None, None)`
  - `leave_queue(uid)` → removes from queue on disconnect
  - `queue_position(config_id, uid)` → 1-based position for UI display
  - `get_room_for_user(uid)` → returns matched room_id
  - Matched room IDs are unique: `{config_id}_{random8chars}`

### What's TODO
- **`group_chat_sockets.py`** — replace `join_group_chat` event with `join_queue` / `leave_queue` events. Emit `match_found` (with `room_id`) to each matched user. Use matched `room_id` (not `config_id`) as the Socket.IO room for `send_message`.
- **`GroupChatPage.jsx`** — add a waiting screen UI, listen for `match_found` event, then transition into the chat.

---

## Recent Fixes (this session)
- Fixed Qualtrics only capturing AI messages (not user messages) — `qualtricsSentCountRef` in `ChatPage.jsx`
- Fixed Socket.IO CORS error on AWS — changed client URL from `localhost:5000` to `"/"`, added `/socket.io/` proxy block to `nginx.conf`
- Tightened group chat bot orchestration — bots now stay silent on off-topic messages instead of always replying
- Added MongoDB persistence for group chat messages
- Persistent user identity in group chat across refreshes
