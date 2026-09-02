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

## Config Reuse: simulation templates and copy/paste

Two separate features that both exist so a professor doesn't start from a blank config.
Neither is documented elsewhere in this file; both are covered end-to-end in the user
guide (`prof-chat-bot.md` and `prof-manage.md`).

### Simulation templates — wizard step 4, "Customize AI Behavior"

Defined in `frontend/src/data/simulationTemplates.js`. Rendered as a card grid under the
heading **"Start from a template"** `(optional)`, above the Instructions textarea.

| key | Card title | What it sets up |
|---|---|---|
| `hr_interview` | **HR Interview** | Practice behavioral interviews with a neutral HR evaluator |
| `sales_negotiation` | **Sales / Negotiation** | Pitch to a skeptical buyer and practice closing deals |
| `debate_partner` | **Debate Partner** | Defend any position against a rigorous opposing argument |
| `macro_shock` | **Macro Shock Simulator** | Reason through the downstream effects of an economic shock |
| `socratic_tutor` | **Socratic Tutor / TA** | Guide students to answers through questions, never giving them directly |

Applying one fills `instructions` and `temperature`, and fills `bot_name` / `introduction`
**only if those are still blank** — so it never clobbers something the professor typed. The
active card shows an `Active` pill, and a **"Write from scratch"** link clears the
selection. Available on both create and edit (edit renders it as a collapsible
**"▸ Apply a simulation template"**).

Not to be confused with the **quick templates** on `/responses/:id` (HR Interview,
Participation, Critical Thinking, Sales & Negotiation, Presentation Skills, Socratic
Dialogue) — those steer a grading analysis, not a bot's persona.

### Copy/paste an assistant between professor accounts

Transfers a whole assistant, including its knowledge base, to another professor — or
duplicates one of your own. Implemented in `ConfigList.jsx` + `config_routes.py`.

**Copy** — `Ctrl+C` on the hovered card, the clone icon, or right-click → Copy. Calls
`POST /config/{id}/copy`, which mints a `secrets.token_urlsafe(12)` token into
`config_transfers` with a **7-day** expiry (`CONFIG_TRANSFER_TTL_DAYS`, `config_routes.py:900`).
That collection carries a TTL index so Mongo reaps expired tokens, but reads still check
`expires_at` because the TTL monitor only sweeps about once a minute. The clipboard gets a
human-readable line carrying `actr-config:<token>` (`CLIPBOARD_PREFIX`, `ConfigList.jsx:48`),
so it survives being pasted into email or chat.

**Paste** — `Ctrl+V` anywhere on the list, the **Paste** button, or right-click → Paste.
Opens `PasteConfigModal` (name pre-filled `"<original> (copy)"`, optional class code).
`POST /config/paste/<token>` deep-copies the source doc minus `_COPY_EXCLUDED_FIELDS`,
reassigns `user_id`, mints a fresh `collection_name`, and clones the knowledge base — both
the file records and the vector chunks.

**Fields dropped on copy** (`_COPY_EXCLUDED_FIELDS`, `config_routes.py:907`) — and the
comment above it explains each: `_id`; `class_code` (globally unique, must be re-typed);
`usage_tier` / `student_count` / `usage_pool` (they describe the class that was copied, and
the new counter restarts at zero, so inheriting the label would lie); `is_playground` /
`is_personal` (singleton markers that would hijack `get_playground_config` and
`/student/personal-config`); and `upload_locked_until`.

**Student activity is never touched** — chat sessions, messages, group-chat messages,
video submissions and usage counters live in separate collections, and the copy only walks
the config doc plus its knowledge base.

If the browser blocks clipboard reads, the modal falls back to a manual paste box.

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

---

## 2026-08-03 Session: `/userguide` site + student account controls

### What shipped (commit `3f0c2d0` on `dev`)
A public, in-app user guide at **`/userguide`** — 18 task-oriented pages across three
tracks: professor (11), student (4), shared account basics (3).

**Architecture — `frontend/src/guide/` is a self-contained island:**
- `content.js` — the nav tree. Page bodies auto-load from `./pages/*.md` via
  `import.meta.glob(..., { query: '?raw', eager: true })`. Also owns `getNeighbours`
  (prev/next walks the flat reading order across track boundaries) and `searchPages`
  (plain substring match, title hits ranked above body hits — no index, no dependency).
- `GuideMarkdown.jsx` — **constructs its own `new Marked({ gfm: true, breaks: false })`.**
  This matters: `utils/markdown.js` calls `marked.use({ breaks: true })` on the shared
  singleton for chat, which would turn every wrapped line of guide prose into a `<br>`.
  Never switch the guide to the shared `marked`.
  Images are decorated *after* render (`decorateScreenshots`) rather than via a renderer
  override, so the code doesn't depend on which token signature the installed marked
  version hands to `renderer.image()`. A failed image is swapped for a dashed
  "Screenshot pending" slot naming the missing file.
  In-guide links are plain `<a>` inside `dangerouslySetInnerHTML`, so a click handler
  intercepts same-origin hrefs and routes them through `navigate()`.
- `GuideLayout.jsx` — sidebar, mobile `<select>` jump menu, search, prev/next, print.
- `pages/*.md` — content. **Editing the guide means editing markdown, not React.**
- `frontend/public/guide-media/*.png` — screenshots, referenced by plain path. Deliberately
  *not* `src/assets` + imports: dropping a PNG in needs no code change. Folder is named
  `guide-media`, not `userguide`, so it can't collide with the route in nginx `try_files`.
- `.guide-md` prose styles live at the bottom of `index.css`, beside `.chat-message-md`
  (which is serif and chat-tuned — the guide needed its own sans-serif doc styles).

**`MobileGate` in `App.jsx`** replaced the old top-of-`App` mobile block. It lives *inside*
the Router and reads `useLocation`, because the first version read
`window.location.pathname` at mount — which meant a phone user could click a link out of
the guide and land in the app unblocked. `/userguide` is the only path exempt from
`MobileBlockPage`.

**Student account controls (the other half of this commit).** `StudentDashboardPage` had
no account menu at all — a student could neither log out nor change their password from
anywhere in their session (`/change-password` existed but nothing they could see linked to
it). Mounting the existing `UserInfo` in the header fixed all of it at once; `UserInfo`
also gained a **User guide** entry that deep-links by role, and its username went
`gray-400 → gray-600` now that it renders on the light dashboard.

Entry points: navbar "Guide", account dropdown, and the student dashboard empty state.

### Ground truth from driving the live dev site
Screenshots were captured by driving `testfront.bitterlylab.com` over CDP
(`playwright-core` + `chromium.connectOverCDP`, scratch Chrome profile on port 9222). That
surfaced **two places where reading the source gave the wrong picture** — both now
corrected in the guide, and worth knowing before writing docs from source again:

- **`/responses/:id` does not open on a finished report.** The Analytics tab opens on a
  **"New Analysis"** card: quick templates (HR Interview, Participation, Critical Thinking,
  Sales & Negotiation, Presentation Skills, Socratic Dialogue), an optional grading-criteria
  box, and a **Generate Analysis** button (~8–15s for a handful of sessions). Class
  Overview / per-student scores only exist *after* you run it.
- **`/video-dashboard/:id` contents**, verified: Delivery View button; Upload link +
  Invite link with Copy; one card per scoring box showing the class average and an
  Excellent/Strong/Developing/Weak split; **Content Checks (Class Avg)**; a callout
  *"Most common weakness: X is the lowest-scoring box for the most students."*;
  **Class Analytics** (avg wpm, avg filler %); a per-student table (**names + emails —
  careful when screen-sharing**); and **AI Grading Analysis** with a free-text box +
  **Run Analysis**. There is **no** "first 8 seconds" metric, no Export PDF, no Past
  Analyses panel, and no Rescore button — earlier notes claiming those were wrong.

Wizard step headings all confirmed as documented: *"What do we call your Space?"* →
*"Pick the Base AI Model"* → *"Upload Knowledge Base"* → *"Customize AI Behavior"* →
*"Final Polish"*; and per type *"Define the Rubric"* / *"Generate the Lab"* / *"Setup"*.
Both Simple/Advanced toggle variants confirmed: full `Simple | Advanced` pill on
`/config_list`, compact `S ⚬ A` inside the wizard modal.

### Known traps the guide documents (still unfixed in code)
| Trap | Where |
|---|---|
| Wizard advertises 500 MB per file; the chat-sidebar file library rejects over **50 MB** | `ConfigPage.jsx` hint vs `user_files.py:103` |
| Manager Exercise: wizard passes with **2** candidate outcomes, backend demands **exactly 3** — fails at Publish after all the setup | `ConfigPage.jsx` step-3 validation vs `config_routes.py:208` |
| Experiential Lab's final button reads **"Next"**, not "Publish" (its last step is 3; only `step === 5` relabels) | `ConfigPage.jsx:1672` |
| `/admin` sits behind `ProfessorRoute`, not an admin guard — non-admins reach it and get an API 403 | `App.jsx` |
| Student dashboard UI says `N / 15 attempts`; backend caps `can_submit` at **5** | `StudentDashboardPage.jsx` vs `student_routes.py` |
| `/terms` and `/privacy` are linked from login + register but have **no routes** → 404 | `LoginPage.jsx`, `RegistrationPage.jsx` |
| Email verification is **never enforced** at login despite the docstring saying so | `auth.py:295-351` |

### Notes for the next session
- **5 of 24 screenshots are still placeholders**: `student-dashboard`, `video-results`,
  `me-review-case`, `experiential-dashboard`, `shock-world-player`. Reasons and what each
  needs are in `frontend/public/guide-media/README.md`. Missing files render as a dashed
  slot naming the expected filename, so nothing breaks.
- **No Experiential Lab config exists on the dev account** (the shared list shows zero
  "Open Sessions" spaces) — that's why two of the five are blocked.
- To add a guide page: drop `frontend/src/guide/pages/<id>.md` **and** add `{ id, title }`
  to the right track in `content.js`. A file without a nav entry is invisible; a nav entry
  without a file renders empty.
- The guide must stay callable logged-out — it must never hit `apiClient` or `/auth/me`.

---

## 2026-08-31 Session: exercise templates + the "What About Bob" investigation

### The idea
The manager exercise was one exercise with one flow and one vocabulary (a hiring
committee that reveals an outcome "six months later" and then debriefs). It is now
**one machine with templates**. A template owns two things and nothing else:

| | |
|---|---|
| `flow` | which optional phases exist — `{reveal, debrief}` |
| `lexicon` | the student-facing strings ("enter the hire" vs "name our suspect") |

`backend/src/managers/exercise_templates.py` is the registry. `hiring` is the
default and is byte-for-byte the old behaviour, so **every config that predates
this is unchanged** — `normalize()` maps a missing or unknown `template` to it.

Deliberately NOT a second `bot_type`: that would fork a 1400-line state machine and
a 1900-line player to change a dozen strings and skip two phases. The pedagogy is
identical (people hold different pieces and fail to pool them).

**Where the flags bite** (all in `exercise_state.py`):
- `resolve_collective` → `_enter_kiosk()` when `reveal`, else straight to `_enter_done()`.
- `_finish_kiosk` → `_enter_debrief()` when `debrief`, else `_enter_done()`.
- `_enter_done` only fires the `on_wrapup` hook when `debrief` — otherwise ACTR would
  appear for the first and only time on the last screen of an exercise it was kept out of.
- `resolve_collective` leaves `forecast_shown_for` **None** without a reveal. This is
  the one that matters: the snapshot derives `revealed` from that field, and
  `Transcript()` pins the outcome document above the messages on the done screen — so
  setting it would have handed every student the answer key.
- `flow()` is forced to `debrief: False` whenever `reveal` is False. The debrief opens
  on the outcome the room has just read; there is nothing to debrief without one.

The snapshot carries `template`, `lexicon` and `flow`. The client merges the lexicon
over a hardcoded hiring fallback (`LEXICON_FALLBACK` in `ManagerExercisePage.jsx`), so
a key the server hasn't sent keeps its old word rather than rendering blank.
Picker: a two-card toggle in `ConfigPage.jsx` and `EditConfigPage.jsx`, beside the
existing cards-vs-case toggle.

### The professor's class results page — `/manager-exercise/:configId/results`
`GET /api/manager-exercise/<config_id>/results` (owner-scoped). Every group's answer,
every student's **named** private pick and which role/case file they held, plus
class-wide percentages and how many groups matched the pack's answer key. Test rooms
(`_t`) are excluded — counting the professor's rehearsals into the class numbers
would quietly corrupt them.

Named private picks are exactly what `solo_spread()` refuses to send into a live room.
That is not a contradiction: naming them *in the room* is a different exercise; naming
them *to the professor after the class* is the debrief. Linked from the manager-exercise
block in `EditConfigPage`, next to the test-run panel.

### The case: "What About Bob" (config `6a954936486ab4fd5f8fee90`, hkustmg)
Built by `create_bob_investigation.py` from the three PDFs in `backend/uploads/`
(`What About Bob final.pdf`, `...#...`, `...@...`). Classic hidden-profile murder file.

- `template: investigation`, `student_view: case`, 3 seats, one **case file** each
  (~14 k chars of interview transcript, not credential cards).
- Roles are `Case File 1/2/3`; `case_pack.roles` binds a seat to a file on join order.
- Answer: **Mickey Malone**, `best_option_locked: True` so `case_pack.recompute` cannot
  overwrite it (its "most strengths, fewest concerns" rule is meaningless for suspects).
- The trap: every file carries the five depositions that make **Billy Prentice** look
  guilty. The three facts that clear him and convict Malone are split one per file —
  the wallet dumped by a *quiet* car at Eastwood at 7 a.m. (File 1), Malone rushing out
  of the café (File 2), and the 6:40 car being the killer *leaving* (File 3).
- Students never see the answer. `create_bob_investigation.py`'s docstring is the
  full solution; `candidate_summary` on the config is the same thing for the model.

### Simulator: students who half-remember
`exercise_sim.py` — a seat whose packet is a **case document** (not cards) now gets
`RECALL_BEHAVIOUR`: it read the file once, cannot look at it now, hedges on details and
surfaces things late. The text is deliberately **not** truncated to force this — deleting
evidence at random would decide the outcome by dice, and a failed run would say nothing
about whether the case pack works.
`DISCUSS_TURNS_NO_DEBRIEF = 36` (vs 6): when there is no round 2, round 1 *is* the
exercise. The run also ends cleanly at `done` instead of timing out for 60s waiting on
a debrief phase that is never coming.

### Running a test room without a browser
`run_bob_test.py <config_id>` builds a **minimal** Flask app (config + Mongo + socket
events only) and calls the same `start_test_run` launcher the HTTP route calls. It does
not import `backend/app.py`: that registers every blueprint, which drags in the document
loaders → nltk → sklearn, and a broken numpy/sklearn ABI in the local interpreter then
stops a run that touches none of it. Also resolves the Atlas SRV URI to a direct shard
list, since UDP 53 is blocked here.

### The test run (2026-08-31, room `..._tcb3e55`)
Three model students, one case file each, ~36 turns of round-1 discussion:

- **Every one of them privately picked Billy Prentice.** The trap works.
- The group answered **Mickey Malone**. Correct.
- The reasoning went the intended way and only through pooling: Ben (File 2) cleared
  Billy on timing, Cara (File 3) contradicted the crowbar story she did not have,
  Cara surfaced Malone's early phone call, Ben produced the waitress, and the group
  took apart Malone's alibi from there.
- The register held — "wait, my case didn't mention fingerprints on any crowbar",
  "you guys are mixing stuff up". They half-remember and correct each other, which is
  what `RECALL_BEHAVIOUR` is for.

### Notes for the next session
- `run_bob_test.py` and `create_bob_investigation.py` are one-off scripts at the repo
  root, alongside `create_mgmt5110_class.py` etc. Not wired into anything.
- The `investigation` template has no facilitator at all, so `facilitator_prompt.py`
  and `ai_manager` are never reached on that path.
- Nothing here is committed yet.
