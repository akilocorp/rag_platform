<!-- @language Markdown  @updated 2026-08-04  @changed Documented the three-round flow (private pick, unfacilitated group decision, facilitated debrief), the two timing windows, the cards-vs-case student view toggle and role packets, and the removal of grading. Prior: humanizer copy pass, trimmed em dashes and AI-isms. -->

# Create a Manager Exercise

A hidden-profile game. Groups of students each hold a different slice of the information
about three job candidates. No one has the full picture, and the right answer only appears
if the group pools what they know. Most groups don't, which is the lesson.

After they decide, they see how their hire actually worked out, and an AI facilitator runs
a timed debrief.

**Steps:** 5.

## Before you start

Have three documents ready:

1. **General Information** — what the role requires.
2. **Candidate Summary** — every role's private view of the candidates, side by side.
3. **One outcome document per candidate** — how that person actually performed if hired.

> **You need at least two candidates**, each with its own outcome document. Three is the
> usual shape and what the hidden-profile design is tuned for, but two will publish. Prepare
> the outcome documents before you start and you won't lose work at the last step.

## Step 1 — Name and type

Name it, choose **Manager Exercise** (*"Hidden-Profile Game"*), click **Next**. The model
is fixed to Claude for this type, so there's no model picker.

## Step 2 — "Setup"

![Manager Exercise setup](/guide-media/me-setup.png)

### Start from a saved case

If a case has been shared before, by you or a colleague, pick it here. It reuses the
documents *and* the approved answer key, so you skip the upload and the analysis entirely.
Jump straight to setting group size and rooms.

### Group & Timing

- **Students per group** (2–10, default 3) — the capacity of one breakout room, not a
  requirement. A group can start short-handed; the facilitator is told how many actually
  showed up. There are no AI players; every participant is a real student.
- **Breakout groups** (1–20, default 5) — how many rooms exist. The line underneath shows
  your total capacity: *"Room for up to 15 students."*
- **Round 1 — team discussion (minutes)** — how long the group has to talk before the ballot
  opens. Default 20. The clock starts on their **first message**, so reading time is free.
- **Round 2 — debrief (minutes)** — how long the facilitated debrief may run after the
  outcome is revealed. Default 20. This is a *backstop*: the facilitator normally closes the
  session itself once the group has worked out what they missed.

Round 0, the private decision, is untimed — it ends when everyone has committed.

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

### What each student reads

Two ways to give a student their confidential half of the case. Pick one here.

- **Filtered cards** (default) — a card per candidate showing just that role's strengths and
  concerns, pulled out of the Candidate Summary automatically. Nothing extra to upload, and
  it's what every exercise built before this option did.
- **Their own case** — each role reads the full packet you upload, as a case document.
  Closer to running the exercise on paper, and the student sees your wording rather than an
  extraction of it.

Choosing **Their own case** reveals **Add a role packet**. Upload one document per
confidential role. The role name is read from the document header and stays editable, and it
has to match the role the case pack assigns (matching ignores case and spacing). If a role
has no packet, that student quietly gets cards instead, so turning this on before the
uploads are in never leaves anyone staring at a blank screen.

A student only ever receives their **own** role's packet. The others are never sent to their
browser.

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

The exercise runs in **three rounds**, and the order is the pedagogy: they commit alone,
then as a group, and only then do they meet the facilitator.

1. **Lobby** — they pick a breakout room from cards showing live occupancy (*Group 1,
   Group 2…*, `2 / 3`). No queue.
2. **Waiting** — *"2 of 3 here. Start whenever your team is ready."* Anyone can press
   **Start with 2 people**.
3. **The case** — the shared narrative, then their own confidential material: either the
   **credential cards** or **their own case document**, depending on what you chose in step
   3. This is the hidden profile: each student sees a different slice.
4. **Round 0 — the private decision.** *"First, decide on your own."* Each student picks a
   candidate before speaking to anybody. **Nobody ever sees anyone else's private pick** —
   not the other students, not you, not the facilitator (it is told the anonymous spread,
   never who chose what). The group only opens once everyone has committed.
5. **Round 1 — the group decision.** *"Now you decide as a group."* They discuss, then a
   voting grid with a countdown; the room resolves on a majority. **The facilitator is not
   present for any of this.** That is deliberate: a group coached through pooling doesn't
   fall into the hidden-profile trap, and if they don't fall into it there is nothing to
   debrief.
6. **"Six months later"** — the outcome of their hire is revealed, good or bad.
7. **Round 2 — the debrief.** The AI facilitator joins for the first and only time and runs
   the discussion, taking turns properly rather than replying to every message. It works
   backwards from the outcome: what did each of you hold that never got said. There is **no
   second vote** — the group re-decides out loud, not on a ballot. **Every** group reaches
   this round, including the ones that hired the right person.
8. **Done** — each student sees their own private pick beside what the group did.

## Grading

There is none, by design. Nothing in this exercise is scored, and no scorecard is shown.
The debrief conversation is the assessment, and it belongs to the room.

## Customising the facilitator *(Advanced)*

Under **Customize**, an Advanced-only **"Facilitator instructions"** panel holds everything
the AI is told before a session. Leave it empty to run the standard prompt and pick up
future improvements automatically. Click **Load standard prompt** to make your own copy,
which then stays frozen exactly as you edited it.

If you do edit it, **keep the `<<CASE_PACK>>` marker**: that's where your case is injected.
`<<ROSTER>>`, `<<LEARNING_OBJECTIVES>>` and `<<GROUP_SIZE>>` are optional.
