# Qualtrics Embedding Guide

## Current flow (recommended)

No manual JavaScript editing in Qualtrics required — everything is generated for you.

1. Open the assistant in **Edit Assistant** → turn on **Qualtrics embedding**.
2. Click **Create Session — Get Embed HTML**. This calls `/qualtrics-parent-snippet.js`
   (source: `frontend/public/qualtrics-parent-snippet.js`) client-side, bakes in the
   assistant's `config_id` and your app's origin, and combines it with a single
   `<iframe>` pointing at `https://app.bitterlylab.com/chat/<configId>`.
3. Click **Copy HTML**.
4. In Qualtrics: **Survey Flow → Add a New Element → Embedded Data**, add fields:
   - `transcript`
   - `chat_status`
   - `condition` (only if your survey uses conditions/branching — this widget doesn't
     write to it, it just needs to exist so it shows up in the export)
5. Add a **Text/Graphic** question, switch to the HTML view, and paste the copied block.
   That's it — no "Advanced JavaScript" question option, no hidden storage question.

### How it works
- Each participant is identified automatically via `${e://Field/ResponseID}`, baked into
  the iframe `src` by Qualtrics' own piped-text substitution.
- The inlined `<script>` runs as a normal part of the question's HTML (Qualtrics'
  `SurveyEngine.js` is already loaded on the page by then) and listens for `postMessage`
  events from the chat iframe:
  - `CHAT_MESSAGE` — appended to the running transcript, written to the `transcript`
    embedded data field, `chat_status` flips to `in_progress`.
  - On `Qualtrics.SurveyEngine.addOnPageSubmit` (i.e. when the chat "ends" and the
    participant moves to the next page), `chat_status` is set to `completed`.
- All chat logic (streaming, RAG, model calls) lives on the backend / in the iframe's
  page (`ChatPage.jsx`) — nothing needs to change in Qualtrics beyond the one pasted block.
- Origin check: the snippet only accepts `postMessage`s from the exact origin baked in
  at generation time (your app's origin), so a stray postMessage from elsewhere in the
  survey page is ignored.

### Multiple assistants / re-generating
Re-open the modal any time to get a fresh copy — it always reflects the current
`config_id` and your current app origin, so it's safe to regenerate after moving
environments (e.g. dev → prod).

---

## Legacy flow (manual, two-question setup)

The original setup — kept for existing surveys built against it, and as a fallback for
themes where inline `<script>` tags in question HTML don't execute. Do not use for new
surveys; prefer the flow above.

- **Files**: `frontend/src/utils/testing files/iframe.html` + `frontend/src/utils/testing files/paste.js`
- Requires **two** questions: one Text/Graphic question hosting the iframe, and a
  separate **hidden** Text Entry question with `paste.js` pasted into
  **Advanced Question Options → Add JavaScript**.
- `paste.js` hardcodes `configId` and an `allowedOrigins` allowlist — both must be
  edited by hand for each new assistant/environment.
- Writes to legacy embedded data field names: `rag_chat_transcript`, `rag_message_count`,
  `rag_config_id`, `rag_response_id`, `rag_saved_at` (plus a DOM write into the hidden
  question itself).
- Debugging: `window.RAG_DEBUG_ENABLED = true` in the browser console enables verbose logs
  from both the parent (Qualtrics) and iframe consoles.

See git history of this file for the full legacy step-by-step if you need it.
