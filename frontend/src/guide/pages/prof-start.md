<!-- @language Markdown  @updated 2026-08-03  @changed New page: professor getting-started tour of /config_list. -->

# Getting started

After signing in you land on **`/config_list`** — your assistant list. Everything you build
lives here.

![The assistant list](/guide-media/config-list.png)

## What's on the screen

**The sidebar** groups your work:

- **All Assistants**, **Text-based**, **Video-based** — each shows a count.
- A **Private / Shared** toggle above them. It filters by access permission, and
  **Private is selected by default** — so if an assistant seems to have vanished, check
  whether you're looking at the other tab.

**The header row** has the view controls and two buttons:

- **New Assistant** (orange) — opens the creation wizard.
- **Paste** — pastes an assistant someone copied and sent you. See
  [Manage your assistants](/userguide/prof-manage).

**Each card** shows the assistant's name, its model, and its class code as an orange chip
if it has one. Along the bottom: **Customize** (the gear) and a primary button whose label
depends on the type — *Chat Now*, *Open Dashboard*, *Open Sessions*, or *Open Exercise*.

## Simple and Advanced mode

Look for the small **`S ⚬ A`** toggle. This is the single most useful control on the page,
and it's worth understanding before you build anything.

![The Simple / Advanced toggle](/guide-media/config-mode-toggle.png)

- **Simple** (the default) hides advanced fields *and skips a whole wizard step*. A plain
  chat bot takes four steps instead of five — you never see the model picker, and you get
  a sensible default model.
- **Advanced** reveals the model picker, response-style sliders, the pedagogical-method
  dropdown, per-agent settings, class codes on most types, and the facilitator prompt
  editor.

Two things to know:

1. The setting is **stored per device, not per account**. Switching to your laptop puts
   you back in Simple mode.
2. **Switching mid-wizard can remove the step you're standing on.** If you flip to Simple
   while on the model picker, you're moved back to the nearest earlier step. Nothing you
   typed is lost — fields you filled in Advanced mode still submit even when hidden.

> Start in Simple mode for your first assistant. Turn on Advanced when you actually need
> something it hides — most of this guide notes when that is.

## Your first assistant, in one minute

1. Click **New Assistant**.
2. Give it a name and leave the type on **Chat Bot**.
3. Skip the file upload for now — click **Next**.
4. Write a sentence or two under **Instructions** describing how it should behave.
5. Click **Next**, then **Publish**.

You'll be dropped straight into a chat with it. That's the whole loop; everything else is
refinement.

## Where to go next

- [Key ideas](/userguide/prof-concepts) — what the four Space Types are and how to pick one
- [Create a Chat Bot](/userguide/prof-chat-bot) — the full wizard, step by step
- [Invite your students](/userguide/prof-invite) — class codes and share links
