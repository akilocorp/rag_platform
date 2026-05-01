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

## Group Chat Matching System

### Goal
When a user opens a group chat, instead of joining immediately, they enter a **matchmaking queue**. Once enough users are queued (determined by `group_size` in the config), they are matched into a unique room together. `group_size = 1` is a valid solo configuration (1 human + AIs) and bypasses the queue entirely.

### Config field
`group_size` (int, default 2, min 1) — stored in `config_collections` per bot config. UI sliders in `ConfigPage.jsx` and `EditConfigPage.jsx` allow 1–10; the label renders "Solo (1 user + AIs)" when set to 1.

### Backend (`backend/src/managers/match_manager.py`)
In-process singleton. Queue and room state are in-memory only — a backend restart wipes both.
- `join_queue(config_id, uid, group_size)` → `(room_id, matched_uids)` when the queue fills, else `(None, None)`. Remainder stays queued.
- `create_solo_room(config_id, uid)` → builds a 1-member room directly, no queue. Used for `group_size <= 1`.
- `leave_queue(uid)` → removes from waiting queue (no-op if already in a matched room).
- `queue_position(config_id, uid)` → 1-based position for UI.
- `get_room_for_user(uid)` → returns matched room_id (drives the reconnect short-circuit).
- Room IDs: `{config_id}_{8 hex chars}` so multiple groups from the same config don't collide.

### Sockets (`backend/routes/group_chat_sockets.py`)
- `join_queue {uid, config_id}` — registers `sid↔uid`, loads `group_size` from the config doc. Reconnect short-circuit: if user already has a room, re-emit `match_found` and return. Solo path: if `group_size <= 1`, call `create_solo_room` and emit `match_found` immediately. Otherwise enqueue → emit `queued {position}` to this socket, or `match_found {room_id}` to each matched user via their stored `sid`.
- `leave_queue {uid}` — explicit cancel (Cancel button on waiting screen). Falls back to `sid_to_uid` lookup if `uid` missing.
- `disconnect` — also calls `match_manager.leave_queue(uid)` so dropped clients are cleaned up automatically.
- `get_history {room_id}` — joins the Socket.IO room (this is when the user actually enters), replays persisted `group_chat_messages`.
- `send_message {room_id, uid, text}` — broadcasts to humans, kicks off `process_ai_logic` background task.

### Frontend (`frontend/src/pages/GroupChatPage.jsx`)
Three phases via `phase` state: `loading → waiting → chat`. `phaseRef` mirrors the state so socket closures see the current phase (prevents reconnects from re-queueing once you're in chat).
- On `connect` → emit `join_queue`. `queued` → show waiting screen with position chip. `match_found` → store `room_id`, emit `get_history`, transition to chat.
- Waiting screen has a "Leave queue" button → `handleCancelQueue` emits `leave_queue`, disconnects the socket, navigates to `/config_list`.
- Solo configs skip the waiting screen entirely because the backend emits `match_found` without ever emitting `queued`.

### Known limits
- Queue position is one-shot — when someone ahead leaves, the waiting users don't see their position update until another event refreshes them. Acceptable for now.
- All state is in-process; multi-worker deployment would need to move queues/rooms to Redis.

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
- [x] **Step 4** — Agent runner (`backend/src/agentic/agent_runner.py`)
  - `stream_agentic_response(config, user_input, history_messages, ctx)` — single entry point, generator yielding event dicts.
  - Event types: `{type: "token", data}`, `{type: "tool_use", id, name, input}`, `{type: "tool_result", id, name, content, is_error}`, `{type: "done", stop_reason, assistant_blocks}`. The `assistant_blocks` field is the full block sequence (text + tool_use + tool_result) for Step 5 to persist as `additional_kwargs.tool_trace`.
  - Loop: `client.messages.stream(...)` → stream text via `text_stream` → `get_final_message()` → if `stop_reason == "tool_use"`, execute tools via `registry.execute()`, append results, loop. Caps at `MAX_TOOL_ROUNDS = 8` per turn.
  - System prompt assembly: `bot_name` + `instructions` (or scrubbed `prompt_template` for legacy configs that only have the wrapped string) + auto-generated tool guidance based on enabled tools. Citation instruction included.
  - Prompt caching: `cache_control: {type: "ephemeral"}` on system block + last tool spec. Pays off on multi-turn chats.
  - Failure modes: missing `ANTHROPIC_API_KEY`, missing `anthropic` package, stream exception, max-rounds exhaustion — all yield a clean error message + `done` event without crashing the request.
  - Default `web_access=false` → existing LangChain path (Step 5 branch). This runner assumes Claude (Step 5 enforces).
- [x] **Step 5** — Wire branch in `chat_routes.py`
  - Branch added right after the auth check (around line 313): if `config.web_access` AND `model_name.lower().startswith("claude")` → `_generate_agentic(...)`. Otherwise falls through to the unchanged legacy `generate()` (LangChain RAG path).
  - Config projection extended (line 292) to include `web_access`, `bot_name`, `instructions` alongside the existing fields.
  - New `_load_anthropic_history(history_obj)` helper: converts LangChain HumanMessage/AIMessage → `[{role, content}, ...]` for the runner. **Only the rendered text** is fed back into Claude on follow-up turns — the `tool_trace` stays in MongoDB for frontend replay but isn't replayed into model context (saves tokens, avoids stale tool_use IDs that would 400 the API).
  - New `_generate_agentic(...)` generator: builds `ToolContext`, calls `stream_agentic_response`, forwards `token`/`tool_use`/`tool_result` events as NDJSON, captures the final assistant text + `assistant_blocks`, then persists `add_user_message(user_input)` + `AIMessage(content=text, additional_kwargs={"tool_trace": blocks})`. Skips persistence on `stop_reason == "error"` so error messages don't pollute history.
  - The `done` event sent to the client is stripped of `assistant_blocks` (large + redundant with the token stream).
  - `get_chat_history` endpoint (`/api/history/<id>`) already serializes via `message_to_dict` — `additional_kwargs.tool_trace` flows through automatically. Step 6 reads it on replay.
- [x] **Step 6** — Frontend status pills + replay
  - New `frontend/src/components/ToolStatusPill.jsx` — collapsed pill (icon + verb + input snippet), expandable to show truncated raw tool_result. Three known tools have icon/verb metadata; unknown tools fall back to a generic pill. Pending state shows spinner; error state turns red with a warning icon.
  - `ChatMessage` in `ChatPage.jsx` extended: pills render above text, sources footer below text. `ThinkingIndicator` only shows when there's no text AND no tool_calls AND `isTyping` (so once the first tool starts, the shimmer is replaced by the pill).
  - Stream parser in `handleMessageProcess` now handles `tool_use` (push new entry) and `tool_result` (find by id, fill `result` + `is_error`) events. Unknown event types ignored — legacy path unaffected.
  - History loader extracts `additional_kwargs.tool_trace` and rebuilds the `tool_calls` array via `extractToolCallsFromTrace` so replay shows pills in their done state.
  - Sources footer: `extractSources` parses `[N] title — url` lines from web_search results and includes the input URL from web_fetch. Deduped, hostname computed defensively. Renders as numbered chips that link out in a new tab.
  - URL chip above the input bar: when a Claude+web_access bot is selected and the user's draft contains http(s) URLs, a small "🔗 host — will be fetched" chip appears. UX hint only — the URL is just part of the message and the agent decides whether to call web_fetch.
- [x] **Step 7** — Safety constants (`backend/src/agentic/constants.py`)
  - `MAX_TOOL_ROUNDS = 8` — total model↔tool round-trips per turn (was inline in `agent_runner.py`, now centralized).
  - `DEFAULT_MAX_TOKENS = 2048` — Anthropic max_tokens per stream round.
  - `MAX_USES_PER_TOOL = {"web_search": 5, "web_fetch": 5}` — per-tool per-turn caps. Enforced in `agent_runner.py` *before* invoking `registry.execute` — over-budget calls return a synthetic `is_error: true` tool_result so the model can recover (typically gives up and synthesizes from what it has). Tools not listed → only `MAX_TOOL_ROUNDS` applies.
  - `BLOCKED_HOSTS` deliberately stays in `backend/src/utils/web/fetch.py` — that helper is shared by URL ingestion (non-agentic), so duplicating into `constants.py` would drift. Documented as a comment in `constants.py`.
  - `TAVILY_API_KEY` is in `backend/.env` (gitignored). `web_search` tool's `enabled_when` already gates on its presence — missing key just removes the tool from the spec list, no errors.
- [ ] **Step 8** — Rollout
  - Env var `AGENTIC_ENABLED=true` kill-switch wrapping the Step 5 branch
  - Dogfood on one bot, then flip default

### Notes for the next session
- `backend/.env` needs `TAVILY_API_KEY` before Step 3 testing
- Group chat is intentionally untouched — different code path (`group_chat_sockets.py`), agentic doesn't apply in v1
- For `web_access=false`: keep using existing LangChain path (it's already pure RAG). The agentic path is only for `web_access=true && model.startswith("claude")`.
- Anthropic model id used by configs: `claude-sonnet-4-6`, `claude-haiku-4-5-20251001`. `model_name.startswith("claude")` covers both.

---

## 2026-05-01 Session: PDF Ingestion Overhaul + UX Polish

### PDF ingestion: ocrmypdf → PyMuPDF + Claude Haiku image-block OCR
- **Removed** `ocrmypdf` Python wheel + tesseract/ghostscript/qpdf/pngquant/unpaper apt packages from `backend/Dockerfile`. (~200 MB image bloat gone.)
- `_extract_pdf_text_via_claude` in `backend/src/utils/vector_stores/store_vector_stores.py` now renders each PDF page to a 150-DPI JPEG (quality 75) via PyMuPDF (`pymupdf` wheel, ~20 MB, no system deps) and sends them as Anthropic image blocks. Cheaper + more predictable than the raw `document` block.
- Default model: `claude-haiku-4-5-20251001` (~3× cheaper than Sonnet, fine for OCR-style transcription).
- **Per-page filtering for mixed PDFs**: `extract_pdf_chunks_fast` returns `(chunks, page_count, image_only_pages)`. Upload route ingests text-layer chunks synchronously and dispatches the async worker with `page_indices=image_only_pages` so Claude only OCRs the scanned pages.
- **Anthropic Batch API for ≥40 pages**: `_claude_via_batch` in the same file submits a single-request batch and polls (5s for first minute, 15s after) with a 10-min hard timeout. 50% off list price. Below threshold, the live `messages.create` path keeps sub-30s latency for small uploads. Constants: `CLAUDE_BATCH_PAGE_THRESHOLD = 40`, `CLAUDE_BATCH_TIMEOUT_SECONDS = 600`.
- Async worker (`_run_async_pdf_ingest` in `backend/routes/user_files.py`) emits `upload_job_progress` events at OCR start and at the OCR→indexing transition. Soft-fails OCR errors when `is_mixed=True` (text-layer chunks already saved).

### Socket emit fix
- Old code in the worker did `from app import socketio` lazily, but `python app.py` runs the file as `__main__`, so the import re-loaded `app.py` as a fresh `app` module where `socketio.init_app(app)` never runs → emit() errored with `'NoneType' object has no attribute 'emit'`. Worker now reads `current_app.extensions['socketio']` inside the existing `app.app_context()` block — Flask-SocketIO registers itself there during `init_app`. Fix shipped in commit `b6ec4ac`.

### Frontend upload UX (`FilesPanel.jsx`, `ChatPage.jsx`)
- Stage-aware pending row: filename pulses, subtitle reads *"Preparing your file"* → *"Reading images in your PDF"* (or *"Reading N pages — this can take a few minutes"* for batch jobs) → *"Indexing extracted text"* → done. Bouncing dots after the label + a 2-segment progress indicator.
- **Chip filter**: file chips above the chat input only render when `vector_ingested === true`, so an in-progress upload doesn't show a half-baked breadcrumb.
- **Polling fallback**: `useEffect` polls `/api/files` every 30s while any file is `vector_ingested === false`. Recovers from missed `upload_job_done` socket events; drops anything the backend marked `ingest_status: 'failed'`.
- **`sessionUploads` sync**: `loadLibrary` patches `sessionUploads` against the fresh server state. Without this, polling-recovered completions stayed at `vector_ingested: false` in `sessionUploads` and the chip stayed hidden until the user reloaded (combined effect of `librarySelected` skipping anything in `sessionUploads`, and the `sessionUploads` block requiring ingested).

### Markdown formatting
- `frontend/src/index.css` got explicit font sizes for `h1` (1.5em) → `h6` (0.95em), `code` chip styling, fenced-block style, link colors, table borders, list-marker color. Tailwind preflight resets headings to 1em, so without this they were bold-but-flat.
- `_build_system_prompt` in `backend/src/agentic/agent_runner.py` appends a Markdown formatting nudge to Claude's system prompt (use `## headings`, `**bold**`, lists, code fences, tables — but stay plain for short replies).
- **Group chat AI replies** now render through the same `marked.parse` + KaTeX pipeline as the 1:1 chat (`GroupMessageBody` component in `GroupChatPage.jsx`). Was previously dumped as plain text.

### Chat layout
- Column dropped from `max-w-4xl` → no cap (`w-full`) on both `ChatPage.jsx` and `GroupChatPage.jsx`. Side breathing room comes from responsive padding on `<main>` / `<footer>`: `p-4 sm:p-6 lg:px-12 xl:px-20`. Bubble cap: `max-w-[88%]`.

### Group chat config flow
- Step 2 (model picker) is skipped on create (`ConfigPage.jsx`) when `bot_type === 'group_chat'`. Lobby AI defaults to `gpt-3.5-turbo`. Edit page already hid the same dropdown via `bot_type !== 'group_chat'` gate.
- Progress bar renders 4 segments `[1, 3, 4, 5]` for group chat instead of 5.

### Deploy efficiency (`backend/Dockerfile`, `frontend/Dockerfile`, `.github/workflows/deploy.yml`)
- Backend Dockerfile collapsed from a fake-multi-stage that ran `pip install` 3× into a single stage with one BuildKit-cached install (`# syntax=docker/dockerfile:1.4`, `RUN --mount=type=cache,target=/root/.cache/pip`). Wheels now persist across `requirements.txt` changes.
- Frontend `npm install` → `npm ci` with npm cache mount.
- `compose down` + `build` + `up` collapsed to `compose up -d --build --remove-orphans`.
- **Prune-before-build**: `sudo docker system prune -f && sudo docker builder prune -f` runs before each compose build to reap last deploy's dangling images. Prevents the "no space left on device" failure mode that took down the dev EC2 mid-deploy.

### Commit trail (newest first, all on `dev`)
| Commit | What |
|---|---|
| `bb5e653` | Group chat progress bar: 4 segments instead of 5 |
| `fc72342` | Group chat: skip lobby-AI picker, default to gpt-3.5-turbo |
| `3b82e30` | Add side breathing room: lg:px-12 xl:px-20 |
| `2d4c749` | Drop chat column max-width so bubbles reach the screen edges |
| `92a13b2` | Halve chat side gap: max-w-5xl → max-w-7xl |
| `96c247f` | Render markdown in group chat AI messages |
| `d95838e` | Widen chat column and bubble max-width for better spread |
| `624007e` | Better AI reply formatting: markdown styles + system prompt nudge |
| `afe47b1` | Sync sessionUploads with library refresh so post-ingest chip appears |
| `3371cc1` | Pending-upload UX: stage-aware progress, polling fallback, chip filters |
| `b6ec4ac` | Fix async-worker socket emits: read SocketIO from app.extensions |
| `d77dd32` | Trim deploy: single-stage Dockerfiles, BuildKit cache, prune-before-build |
| `f1ca0e8` | Replace ocrmypdf with PyMuPDF + Haiku image-block OCR |

### Notes for the next session
- Untracked files in working tree (NOT committed): `.claude/`, `add_bug.py`, `telegram credentials.txt` (secrets — should be `.gitignore`d and rotated), and pre-existing edit to `frontend/src/utils/testing files/paste.js`.
- The lobby-AI step skip is one-way: existing group chats keep whatever `model_name` they were saved with. To force-migrate them to `gpt-3.5-turbo`, the EditConfigPage submit handler would need a `if bot_type === 'group_chat': model_name = 'gpt-3.5-turbo'` line.
- **Group chat AI bots** still don't get the formatting nudge — that lives in `agent_runner.py`, which only the 1:1 agentic path uses. Group chat bots flow through `group_chat_sockets.py` / `context_manager.py`. If their replies need the same Markdown polish, the prompt change has to land there too.
- Step 8 of the agentic upgrade (rollout kill-switch + dogfood) is still open from the prior session.
