# Qualtrics Embedding Guide

## Current flow (recommended)

ACTRLabs generates two small blocks. The iframe belongs in the question HTML;
the loader belongs in Qualtrics' supported Question JavaScript editor. The full
bridge is hosted at `/qualtrics-embed.js`, so future fixes are deployed once on
ACTRLabs rather than copied into every survey.

1. Open the assistant in **Edit Assistant** → turn on **Qualtrics embedding**.
2. Click **Get Qualtrics embed code**.
3. Copy the iframe into a Text/Graphic question's HTML view.
4. In Qualtrics: **Survey Flow → Add a New Element → Embedded Data**, add fields:
   - `transcript`
   - `chat_status`
   - `condition` (only if your survey uses conditions/branching — this widget doesn't
     write to it, it just needs to exist so it shows up in the export)
5. Open that question's JavaScript editor and paste the generated loader. The
   loader downloads the maintained bridge from ACTRLabs. No hidden question is needed.

### How it works
- Each participant is identified automatically via `${e://Field/ResponseID}`, baked into
  the iframe `src` by Qualtrics' own piped-text substitution.
- The hosted bridge runs through Qualtrics' supported JavaScript lifecycle and listens for `postMessage`
  events from the chat iframe:
  - `CHAT_MESSAGE` — appended to the running transcript, written to the `transcript`
    embedded data field, `chat_status` flips to `in_progress`.
  - On `Qualtrics.SurveyEngine.addOnPageSubmit` (i.e. when the chat "ends" and the
    participant moves to the next page), `chat_status` is set to `completed`.
- All chat logic (streaming, RAG, model calls) lives on the backend / in the iframe's
  page (`ChatPage.jsx`). Qualtrics only keeps the iframe and the small hosted-script loader.
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
