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

---

## In-Progress: Agentic Upgrade (Claude tool-use loop)

### Goal
Upgrade the 1:1 chat from pure-RAG to agentic. By default the bot can call `search_knowledge_base` (existing RAG), `web_search` (Tavily), and `web_fetch` (trafilatura). User can paste URLs in the chat. Per-config opt-out via `web_access` toggle to revert to strict-RAG behavior.

### Architectural decisions (locked)
1. **Web search provider**: Tavily (`tavily-python`). Free 1k/month, then ~$8/1k. Returns extracted content per result, so end-to-end cheaper than Brave/SerpAPI which need separate fetches.
2. **History storage**: Retrofit existing `chat_histories` collection. AI messages from agentic turns get `data.additional_kwargs.tool_trace = [...]` (array of tool_use/tool_result blocks). Old messages without `tool_trace` render as before — fully backward-compatible.
3. **Models**: Claude only for v1 (raw `anthropic` SDK). Other providers (GPT/Gemini/Deepseek/Qwen) keep current LangChain path. Branch in `chat_routes.py`: `if config.get("web_access") and model_name.startswith("claude"): stream_agentic_response(...)` else existing path.
4. **PPT loader**: Light — `python-pptx` text-only. Walks slides, joins shape `text_frame` text per slide, one `Document` per slide.

### Tool registry pattern
Drop a file in `backend/src/agentic/tools/` to add a tool — no edits to `agent_runner.py` or any central registry.
- `tools/base.py`: `@tool` decorator, `ToolContext` dataclass
- `registry.py`: `pkgutil.iter_modules` auto-discovery + `get_tool_specs(config)` + `execute(name, inputs, ctx)`
- Each tool declares `enabled_when=lambda config: ...` so gating lives in the tool file, not the runner
- Name conflicts raise at import time
- All tools (incl. web_search/web_fetch) are client tools — no Anthropic server-tool special case

### Step status
- [x] **Step 1** — Config schema + UI toggle (commit `c96bf59`)
  - `web_access: bool` field on config doc, default `true`
  - Toggle in `ConfigPage.jsx` step 4 + `EditConfigPage.jsx` standard section (non-group only)
  - Backend POST `config_routes.py:258` and PUT `edit_config_routes.py:107` accept and persist the field
- [x] **Step 2** — Ingestion: PPT + URL
  - `python-pptx`, `trafilatura` in `requirements.txt`
  - `backend/src/utils/loaders/pptx_loader.py` — `SimplePPTXLoader`, one Doc per slide, `{slide_number, source}` metadata. Lazy `from pptx import Presentation` so missing dep doesn't break module import.
  - `backend/src/utils/web/fetch.py` — `fetch_url_as_documents(url)` + `UnsafeURLError`. Blocks private IPs / loopback / link-local / cloud metadata. Trafilatura imported lazily inside the function for the same reason.
  - `POST /api/files/url` in `user_files.py` — fetches URL, ingests via new `process_user_url_and_create_vectors` in `store_vector_stores.py`. Stored in `user_files` with `is_url: true`, `source_url`, no S3 round-trip (`storage_key: null`).
  - `ALLOWED_EXTENSIONS` updated in all 3 spots (`config_routes.py:18`, `edit_config_routes.py:15`, `user_files.py:35`) to include `pptx`.
  - Frontend: `FilesPanel.jsx` got a "Paste a URL" button below the dropzone (collapses to inline input). URL items render with `FiLink` icon and show source URL instead of size. `accept=".pdf,.txt,.md,.docx,.pptx"` everywhere (`FilesPanel`, `ChatPage` attach input, `ConfigPage` step 3, `EditConfigPage` knowledge base block).
  - Plumbing: `ChatPage.uploadUrl(url, folder)` → `SideBar` `onUploadUrl` prop → `FilesPanel`.
- [x] **Step 3** — Tool registry + 3 tools
  - `backend/src/agentic/tools/base.py` — `@tool` decorator, `ToolContext` dataclass, module-level `TOOLS` dict. Name collisions raise at import time.
  - `backend/src/agentic/tools/__init__.py` — auto-imports every sibling module via `pkgutil.iter_modules` so `@tool` decorators register on first import. **Drop a file = registered. No edits to existing files.**
  - `backend/src/agentic/registry.py` — public API: `get_tool_specs(config)`, `execute(name, inputs, ctx)`, `get_tool_names()`. Importing it triggers tool discovery.
  - `backend/src/agentic/tools/README.md` — dev guide with copy-paste template.
  - `tools/knowledge_base.py` — `search_knowledge_base`. Mirrors chat_routes filter logic exactly (variant A vs B, selected_file_ids vs full library, anonymous vs authenticated). Returns numbered passages `[1] file (slide N)\n<content>` for citation by index. Always enabled.
  - `tools/web_search.py` — `web_search` via Tavily. `enabled_when` gates on `config.web_access` AND `os.getenv("TAVILY_API_KEY")`. Lazy-imports `tavily-python`. Returns `[1] title — url\n<content>` per result.
  - `tools/web_fetch.py` — `web_fetch`. Wraps `utils/web/fetch.py:fetch_url_as_documents` (same safety check as URL ingestion). Caps return to 12k chars.
  - `requirements.txt` — added `tavily-python` and `anthropic` (anthropic SDK needed in Step 4).
  - **Setup needed before Step 4 testing**: add `TAVILY_API_KEY=...` to `backend/.env`. Without it, `web_search` is silently dropped from the tool list (`enabled_when` returns false) — no errors.
- [ ] **Step 4** — Agent runner (`backend/src/agentic/agent_runner.py`)
  - `stream_agentic_response(config, messages, ctx)` using `client.messages.stream(...)`
  - Loop: stream → on `tool_use` block, look up via `registry.execute()`, append `tool_result`, continue until `stop_reason == "end_turn"`
  - Emit NDJSON: existing `{type: "token"}` plus new `{type: "tool_use", name, input}` and `{type: "tool_result", name, summary}`
  - System prompt: user's `prompt_template` + tool-usage preamble. If `web_access=false` (and model is Claude → still uses agentic but only with KB tool? Decide: probably keep old LangChain path for `web_access=false` since it's already strict-RAG)
  - Prompt caching on system + tools block (`cache_control: {type: "ephemeral"}`)
- [ ] **Step 5** — Wire branch in `chat_routes.py:281`
  - Single `if config.get("web_access") and model_name.startswith("claude"): return stream_agentic_response(...)` at top of `chat()`
  - History adapter: convert Anthropic content blocks → `tool_trace` shape before persisting
- [ ] **Step 6** — Frontend status pills + replay
  - Extend stream parser in `ChatPage.jsx` for new event types
  - New `<ToolStatusPill>` component inside AI bubble: "🔎 Searched: *…*", "📄 Reading: *example.com*"
  - Citations footer at bottom of AI bubble (parse `[1]`, `[2]` markers)
  - URL paste detection in input → "🔗 will be fetched" chip
  - Replay: `ChatMessage` reads `tool_trace` from history and re-renders pills + citations on load
- [ ] **Step 7** — Safety constants (`backend/src/agentic/constants.py`)
  - `MAX_TOOL_USES = 8`, `WEB_SEARCH_MAX_USES = 5`
  - `BLOCKED_HOSTS = {"localhost", "127.0.0.1", "169.254.169.254", ...}` for `web_fetch`
  - Read `TAVILY_API_KEY` from env (add to `backend/.env`)
- [ ] **Step 8** — Rollout
  - Env var `AGENTIC_ENABLED=true` kill-switch wrapping the Step 5 branch
  - Dogfood on one bot, then flip default

### Notes for the next session
- `backend/.env` needs `TAVILY_API_KEY` before Step 3 testing
- Group chat is intentionally untouched — different code path (`group_chat_sockets.py`), agentic doesn't apply in v1
- For `web_access=false`: keep using existing LangChain path (it's already pure RAG). The agentic path is only for `web_access=true && model.startswith("claude")`.
- Anthropic model id used by configs: `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`. `model_name.startswith("claude")` covers both.
