# Qualtrics Testing Guide

This guide verifies the JavaScript-only Qualtrics integration that saves chat transcripts via parent-controlled `postMessage` from the iframe.

## Prerequisites
- **Iframe host**: `https://app.bitterlylab.com` (or your dev host)
- **Files**:
  - Iframe HTML: `frontend/src/utils/testing files/iframe.html`
  - Parent script: `frontend/src/utils/testing files/paste.js`
- Enable debug logs during testing: in browser console run `window.RAG_DEBUG_ENABLED = true`.

## Setup (Two-Question Required)

Use one question to host the iframe and a separate hidden Text Entry question to store the transcript. Place the script only in the hidden question.

1) **Question A – Chat Host (Text/Graphic)**
   - Paste the iframe HTML from `frontend/src/utils/testing files/iframe.html` into the Question Text (HTML view).
   - Do NOT add JavaScript here.

2) **Question B – Hidden Storage (Text Entry)**
   - Advanced Question Options → Add JavaScript → paste the full contents of `frontend/src/utils/testing files/paste.js`.
   - Hide the question UI so respondents don’t see it:
   ```js
   Qualtrics.SurveyEngine.addOnReady(function () {
     this.hide();
   });
   ```
3) Keep both questions on the same page (no page break).
4) Result: Transcript saved into the hidden question response (and embedded data).

## Allowed Origins (Security)
In `paste.js`, update the `allowedOrigins` Set to include your iframe origin(s):
```js
const allowedOrigins = new Set([
  'https://app.bitterlylab.com',

]);
```
Notes:
- Protocol and port must match exactly (http vs https, 5173, etc.).
- No trailing slash.

## Test Steps (End-to-End)
1) Open the survey preview on the page with the chat.
2) Open two consoles:
   - Parent (Qualtrics page): right-click → Inspect → Console
   - Iframe: right-click inside iframe → Inspect frame → Console
3) Send a user message in the chat and wait for the AI response.
4) An explicit save is triggered automatically after each exchange. You can also run in the iframe console:
   ```js
   window.saveRAGChatToQualtrics({ includeRawData: true })
   ```
5) Proceed to the next page (optional) to ensure page lifecycle saves run.

## Expected Logs
From parent (Qualtrics) console:
- "📥 postMessage received …" (with origin info)
- "📨 Captured message …" (for `CHAT_MESSAGE`)
- "💾 Save request received from iframe" (for `SAVE_RAG_CHAT`)
- Success logs for writing to question and embedded data

From iframe console:
- Environment checks (isInIframe = true)
- "Posting SAVE_RAG_CHAT to parent …" with payload preview
- Any local backup logs when not in iframe

## Data Saved
- Hidden Text Entry question (Question B): formatted transcript
- Embedded Data fields (via `paste.js`):
  - `rag_chat_history`
  - `rag_message_count`
  - `rag_saved_at`
  - `rag_config_id`
  - `rag_chat_id`

## Clean Up for Production
- Keep `allowedOrigins` strict (only production origins).
- Disable verbose debug logs (set `window.RAG_DEBUG_ENABLED = false`).


