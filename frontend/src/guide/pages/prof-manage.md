<!-- @language Markdown  @updated 2026-08-03  @changed Humanizer copy pass: trimmed em dashes and AI-isms. -->

# Manage your assistants

## Editing

Click **Customize** (the gear) on any card. Unlike the wizard, this is a single scrolling
form rather than steps.

Almost everything is editable: name, model, instructions, avatar, introduction, access,
knowledge base, class code, and all the per-type settings.

> **The Space Type cannot be changed.** There's no type picker on the edit page, by design.
> A Chat Bot can never become a Video Analysis; build a new Space instead.

Remember the **Simple / Advanced** toggle applies here too. If a field this guide mentions
isn't on screen, switch to Advanced.

Changes save when you click **Save Changes**.

## Copying an assistant to another professor

Useful for handing a colleague a working setup, or duplicating one of your own.

**To copy:**

1. Hover the card and press **Ctrl+C**, or click the **clone icon**.
2. Your clipboard now holds a short message with a copy token in it. Send it to whoever
   needs it via email, chat, anything.

**To paste:**

1. Press **Ctrl+V** anywhere on the assistant list, or click the **Paste** button, or
   right-click and choose **Paste**.
2. Confirm the **Name** (pre-filled as *"(copy)"*) and optionally set a **Class code**.
3. Click **Create copy**.

### What comes across

**Copied:** every setting, and the whole knowledge base (files and their indexed content).

**Not copied:** student chats, responses, video submissions, usage counters, and the class
code. The original's class code stays with the original class, so the copy needs its own.

> Copy links expire. If you see *"This copy has expired or is no longer valid."*, ask for a
> fresh one.

If your browser blocks clipboard reading, the paste dialog falls back to a text box you can
paste into manually.

## Public and private

The **Private / Shared** toggle in the sidebar filters the list by access permission, and
**Private is selected by default**. An assistant you set to Public will appear to have
disappeared until you switch tabs.

## Deleting

Two routes:

- The **trash icon** on the card, with an inline *"Delete this assistant?"* confirm.
- **Customize → Delete Space** at the bottom, with a full confirmation modal.

### What deletion removes

Deleting cascades: the Space, its indexed documents, its chat sessions, and all the
messages in them. **It cannot be undone.**

Export first if you need the data: the Responses CSV, or the video dashboard's
**Export PDF**. See [Read the results](/userguide/prof-results).

## Saved cases (Manager Exercise)

Manager Exercise cases are saved separately from Spaces, so a case outlives the exercise
built on it. On step 2 of the wizard, each saved case has:

- A **share icon** — toggle between *"Shared with everyone"* and *"Private — only you"*.
- A **trash icon** to remove it.

Sharing a case lets colleagues build their own exercise on your documents and your approved
answer key, without re-uploading or re-analysing anything.
