<!-- @language Markdown  @updated 2026-08-03  @changed Humanizer copy pass: trimmed em dashes and AI-isms. -->

# Create a Chat Bot

A Chat Bot is a 1-on-1 text assistant. It answers from documents you upload, and unless
you turn it off, it can also search the web.

**Steps:** 4 in Simple mode, 5 in Advanced (Advanced adds the model picker).

Start by clicking **New Assistant** on your assistant list.

## Step 1: "What do we call your Space?"

![Step 1](/guide-media/wizard-step1-types.png)

- **Custom AI Name** — required. This is what students see. *e.g. "Physiology Study Group"*
- **Space Type** — leave it on **Chat Bot**.

Click **Next**.

## Step 2: "Pick the Base AI Model"

*Advanced mode only. In Simple mode this step doesn't appear and you get Claude Sonnet 4.6.*

![The model picker](/guide-media/wizard-step2-models.png)

| Model | Notes |
|---|---|
| **Claude Sonnet 4.6** | The default. Balanced quality and speed; a good choice unless you have a reason otherwise |
| **Claude Haiku 4.5** | Faster and cheaper; fine for straightforward Q&A |
| **Gemini 2.5 pro** | Advanced reasoning |
| **Gemini 2.5 flash** | Fast and accurate |
| **Deepseek Chat** | — |

> Web search and URL reading only work on **Claude** models. If you pick Gemini or
> Deepseek, the assistant answers from your uploaded documents alone regardless of the web
> access toggle.

## Step 3: "Upload Knowledge Base"

![The upload step](/guide-media/wizard-step3-files.png)

Drag files in or click to browse. Accepted: **TXT, DOCX, MD, PDF, PPTX**.

You can skip this entirely and add files later. The note under the dropzone says as much
(*"More files can be uploaded after publishing"*).

> **On file size:** this screen says 500 MB, but files added later through the chat sidebar
> are capped at **50 MB**. If you plan to add material after publishing, keep documents
> under 50 MB and you'll never hit the difference.

Scanned PDFs are fine. Pages without a text layer are read with OCR automatically. Large
scanned documents take a few minutes.

## Step 4: "Customize AI Behavior"

![Step 4](/guide-media/wizard-step4-behavior.png)

### Start from a template *(optional)*

Five presets fill in the instructions and tone for you:

| Template | What it does |
|---|---|
| **HR Interview** | Practice behavioral interviews with a neutral HR evaluator |
| **Sales / Negotiation** | Pitch to a skeptical buyer and practice closing |
| **Debate Partner** | Defend a position against rigorous opposition |
| **Macro Shock Simulator** | Reason through the downstream effects of an economic shock |
| **Socratic Tutor / TA** | Guide students to answers through questions, never giving them directly |

Picking one fills the Instructions box, which you can then edit. **Write from scratch**
clears it again.

### Instructions (required)

Describe how the bot should behave: its persona, what it should and shouldn't do, how long
its answers should be, what to do when it doesn't know something.

A useful shape:

```
You are a teaching assistant for an undergraduate macroeconomics course.

- Answer only from the uploaded lecture notes. If something isn't covered
  there, say so rather than guessing.
- Never give a final numeric answer outright — walk the student through the
  steps and let them finish it.
- Keep replies under 200 words unless asked to expand.
```

### The Advanced-only fields

- **Response style** — a slider from *Precise* to *Creative* (default 0.7, around
  "Conversational"). It changes how much the wording varies, **not** what the bot knows.
  Turn it down for consistent, repeatable answers.
- **Allow web search & URL access** — on by default. Turn it off to restrict the bot to
  your uploaded files.
- **Facilitator (interactive UI)** — see below.
- **Class Code** — optional. See [Invite your students](/userguide/prof-invite).

### The Facilitator

Switch this on and the bot can follow a reply with an interactive element instead of only
text: a multiple-choice question, a chart, flashcards, a timeline, a comparison table, a
mind map, or an impact map.

You control when, using the **"What should the facilitator do?"** box:

```
When the reply describes a quantity changing across periods, show it as a
chart of that trajectory. After explaining a concept, offer a multiple-choice
question to check it landed.
```

Leave it off if you just want a conversation.

## Step 5: "Final Polish"

![Step 5](/guide-media/wizard-step5-polish.png)

- **Bot Avatar** — the icon students see.
- **Introduction Message** — the bot's opening line. *e.g. "Welcome to the class!"*
- **Access Permissions** — **Private (Login Required)** by default, or **Public (Link
  Access)** to let anyone with the link in without an account.

Click **Publish**. You're taken straight into a chat with your new bot.

## After publishing

- Test it yourself first: click **Chat Now** on its card and try the questions you expect
  students to ask.
- To change anything, use **Customize** on the card. Everything is editable except the
  Space Type.
- To add a class code and a shared message pool, see
  [Invite your students](/userguide/prof-invite).
- To see what students asked, see [Read the results](/userguide/prof-results).
