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
   - `actr_session_id` (optional — the ACTR session key, written as soon as the chat
     opens. It is the join key to ACTR's own transcript export, so declare it if you
     plan to merge the two datasets. An undeclared field is silently dropped.)
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
  - `ACTR_SESSION` — the chat's session id, sent once as soon as it exists (before
    any message, so a conversation the participant abandons without speaking still
    leaves a joinable row). Written to `actr_session_id`. The older
    `INIT_RAG_CONFIG` message carries the same id and is still accepted.
  - On `Qualtrics.SurveyEngine.addOnPageSubmit` (i.e. when the chat "ends" and the
    participant moves to the next page), `chat_status` is set to `completed`.
- All chat logic (streaming, RAG, model calls) lives on the backend / in the iframe's
  page (`ChatPage.jsx`) — nothing needs to change in Qualtrics beyond the one pasted block.
- Origin check: the snippet only accepts `postMessage`s from the exact origin baked in
  at generation time (your app's origin), so a stray postMessage from elsewhere in the
  survey page is ignored.

### Sending survey answers INTO the chat

The flow above is one-way (chat → Qualtrics). To go the other way — so the assistant
knows the participant's assigned condition or their earlier answers — use the
**"Send survey answers to the assistant"** box in the same embed modal.

List one field per line:

```
condition
top_issue=${q://QID2/ChoiceGroup/SelectedChoices}
gun=${q://QID1/ChoiceGroup/SelectedAnswerRecode/1}
```

A bare name is read as an Embedded Data field (`name=${e://Field/name}`); anything
containing `=` is passed through verbatim, so a question pipe copied out of Qualtrics'
own piped-text menu works unchanged. The generated HTML updates as you type — copy it
after filling the box in.

Each field becomes a **session variable**. The assistant receives it two ways:

- **Substituted** — write `{{top_issue}}` anywhere in the assistant's Instructions and
  it is replaced with the value for that participant. An unmatched placeholder is left
  as-is (you see `{{top_issue}}` come back), which is how you spot a pipe that didn't
  resolve.
- **Listed** — every value is also appended to the system prompt under a
  `--- THIS SESSION ---` heading, so a study can pass something the persona was never
  written to expect.

Where the values show up afterwards: as chips on each row of `/responses/<config_id>`,
and as one column per field in that page's CSV export, joined to the same session as
the transcript.

This is the same mechanism voice calls have always used (`src/audio/voice_runner.py`);
the shared implementation is `backend/src/utils/session_variables.py`.

**Constraints, all of them load-bearing:**

- **Earlier page only.** Piped text resolves when the embed page renders, so a question
  on the *same* page comes back empty and nothing answered after the chat can reach it.
- **Short, closed answers.** Qualtrics does not URL-encode piped text, so a free-text
  answer containing `&`, `#` or a newline will split the query string. Scale points,
  choice labels and condition names are safe; essays are not.
- **The participant can read it** — it is in the iframe URL. Fine for an assigned
  condition, wrong for anything you wouldn't show them.
- **Plumbing keys are ignored.** `qualtricsId`, `responseId`, `studentEmail`,
  `studentName`, `chatId`, `model`, `token` and `debug` never reach the prompt; the
  response id is already stored as the session's `qualtrics_id`. Caps: 25 variables,
  40-char keys, 400-char values.
- The field list is **not saved on the config** — it lives in the modal for as long as
  it is open. Re-typing it is only needed if you regenerate the embed code.

### Voice bots: what the model knows about time

A voice persona is often phased by the clock ("hold your position through roughly
minutes 3 to 6", "begin wrapping up around 8 minutes"). A language model has no clock
— it sees the transcript and nothing else — so the CLM bridge prepends a marker to
each incoming utterance:

```
[call clock: 3m20s elapsed - this is your turn 5]
```

It is model-only: never persisted, never spoken (the spoken-register guide in
`src/audio/voice_runner.py` tells the model to pace by it and not read it out). It
rides on the *user* message rather than the system prompt on purpose — the persona is
cached for the length of the call, and a value that changed every turn would
invalidate that cache on every turn.

Start times come from the call record's `started_at`, cached per process
(`_CALL_STARTS` in `routes/audio_clm.py`). If the session id can't be resolved the
elapsed clause is dropped and only the turn count is sent, rather than shipping a
clock that might be another participant's.

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
