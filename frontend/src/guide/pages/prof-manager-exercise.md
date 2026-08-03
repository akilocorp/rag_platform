<!-- @language Markdown  @updated 2026-08-03  @changed New page: Manager Exercise setup, case materials, and reviewing the answer key. -->

# Create a Manager Exercise

A hidden-profile game. Groups of students each hold a different slice of the information
about three job candidates. No one has the full picture, and the right answer only appears
if the group pools what they know. Most groups don't — which is the lesson.

After they decide, they see how their hire actually worked out, and an AI facilitator runs
a timed debrief.

**Steps:** 5.

## Before you start

Have three documents ready:

1. **General Information** — what the role requires.
2. **Candidate Summary** — every role's private view of the candidates, side by side.
3. **One outcome document per candidate** — how that person actually performed if hired.

> **You need exactly three candidates.** The wizard will let you move on with two, but
> publishing will fail at the last moment. Prepare all three outcome documents before you
> start and you'll avoid losing the work.

## Step 1 — Name and type

Name it, choose **Manager Exercise** (*"Hidden-Profile Game"*), click **Next**. The model
is fixed to Claude for this type, so there's no model picker.

## Step 2 — "Setup"

![Manager Exercise setup](/guide-media/me-setup.png)

### Start from a saved case

If a case has been shared before — by you or a colleague — pick it here. It reuses the
documents *and* the approved answer key, so you skip the upload and the analysis entirely.
Jump straight to setting group size and rooms.

### Group & Timing

- **Students per group** (2–10, default 3) — the capacity of one breakout room, not a
  requirement. A group can start short-handed; the facilitator is told how many actually
  showed up. There are no AI players — every participant is a real student.
- **Breakout groups** (1–20, default 5) — how many rooms exist. The line underneath shows
  your total capacity: *"Room for up to 15 students."*
- **Discussion window (minutes)** — how long the facilitated debrief runs after the outcome
  is revealed. Default 20.

### Learning

- **Class preset** — pre-written learning points the facilitator steers toward. Leave on
  *"— none —"* to rely on your own stated outcome.
- **What should they take away?** — the one thing you want them to leave with.

  > e.g. Groups under-share unique information and over-weight a concern everyone happens
  > to hold.

### Class code

Set one here. Students open `/join/YOURCODE`, sign in, and land straight in the breakout
lobby. The share link previews live underneath as you type.

## Step 3 — "Case Materials"

Upload the three document types. Word (`.docx`) and PDF only.

- **General Information** and **Candidate Summary** are single slots with **Upload** /
  **Replace** buttons. Once uploaded you'll see a character count confirming the text was
  extracted.
- **Candidate Outcomes** — click **Add a candidate outcome** once per candidate. The
  candidate's name is read out of the document header automatically; correct it if it
  guessed wrong.

These documents go to the AI only and are **never shown to a student**.

> Replacing any document clears the analysis on the next step, so the answer key can never
> describe files that are no longer loaded. Get the documents right before you analyse.

## Step 4 — "Review the case"

![Reviewing the case](/guide-media/me-review-case.png)

This is the most important screen in the whole exercise. **Do not skim it.**

Click **Analyse the case**. The AI reads your documents and works out who holds what, what
pools together, and which candidate the pooled evidence actually favours.

Then check its work:

- **The tally table** — Candidate / Strengths / Concerns / Outcome. The **Outcome** cell is
  a dropdown: `succeeded` or `failed`. Verify each one against your outcome documents; a
  misread verdict here breaks the reveal.
- **Warnings** — an amber *"Doesn't match the document"* box flags anything it wasn't sure
  about.
- **Counted as one item** — the AI merges wordings that describe the same fact. Untick
  anything that's really two separate facts; the count updates live. An incorrect merge
  silently removes an item from the tally.
- **Strongest candidate** — derived from the tally (most distinct strengths, fewest
  distinct concerns). Override it only if the analysis got it wrong. The facilitator never
  states this answer; it steers students until they count it themselves.

> **A wrong answer key is invisible once the exercise is running.** The facilitator will
> confidently steer thirty students toward the wrong candidate. Five minutes here saves the
> session.

### Save the case for reuse

Name it and click **Save case**. Choose **Shared** (anyone building a class can start from
it) or **Private** (only you). Next time, step 2's *"Start from a saved case"* picks it up
and skips all of this.

## Step 5 — "Final Polish"

Introduction message and access permissions, then **Publish**.

## What students experience

1. **Lobby** — they pick a breakout room from cards showing live occupancy (*Group 1,
   Group 2…*, `2 / 3`). No queue.
2. **Waiting** — *"2 of 3 here. Start whenever your team is ready."* Anyone can press
   **Start with 2 people**.
3. **The case** — the shared narrative, then their own **private credential cards**. This
   is the hidden profile: each student sees a different slice.
4. **The decision** — a voting grid with a countdown. The room resolves on a majority.
5. **"Six months later"** — the outcome of their hire is revealed, good or bad. If they got
   it wrong, a **Round 2** gives them a second try from the candidates they didn't pick.
6. **The debrief** — the AI facilitator runs the timed discussion, taking turns properly
   rather than replying to every message.
7. **Done** — a scorecard.

## Grading

- **Group outcome** — right first time, recovered in round 2, or neither. Deterministic.
- **Per-student participation** — whether they took part, in each round. Deterministic.
- **Per-student communication** — optional, judged against a rubric you can set under
  **Customize → Grading rubric** in Advanced mode.

## Customising the facilitator *(Advanced)*

Under **Customize**, an Advanced-only **"Facilitator instructions"** panel holds everything
the AI is told before a session. Leave it empty to run the standard prompt and pick up
future improvements automatically. Click **Load standard prompt** to make your own copy —
which then stays frozen exactly as you edited it.

If you do edit it, **keep the `<<CASE_PACK>>` marker** — that's where your case is injected.
`<<ROSTER>>`, `<<LEARNING_OBJECTIVES>>` and `<<GROUP_SIZE>>` are optional.
