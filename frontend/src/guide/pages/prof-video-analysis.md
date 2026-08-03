<!-- @language Markdown  @updated 2026-08-03  @changed New page: Video Analysis setup and the rubric editor. -->

# Create a Video Analysis

Students upload a video; it's transcribed, analysed for delivery and body language, and
scored against a rubric you define. Each scoring box produces **a score out of 10 plus a
written paragraph** explaining it.

**Steps:** 3 — this type skips the model picker and the knowledge base.

## Step 1 — Name and type

Give it a name, then choose **Video Analysis** (*"Upload & Score"*). Click **Next**.

## Step 2 — "Define the Rubric"

![The rubric editor](/guide-media/video-rubric-editor.png)

### The fastest route: drop in your rubric

At the top is a dropzone: **"Drop your rubric or metrics document here"**. Give it the
marking guide you already have — `docx`, `pdf`, `txt` or `md` — and it builds the scoring
boxes, content checks and grading prompt for you.

It also fills in the assistant's name and introduction if you haven't typed them yet. You
then review and edit everything below, which is far quicker than starting from blank.

### Assignment Type — required

| Preset | What it's tuned for |
|---|---|
| **Elevator Pitch** | A 60–90 second pitch, graded on project competence, competence, confidence and passion, plus 13 delivery fundamentals |
| **Research Defense** | An academic defense, weighted towards content rigor, evidence and structure |

This is the only required field on this step. Everything below is Advanced-only.

### Scoring Boxes *(Advanced)*

Each box is **scored out of 10 with a short written rationale**. Add one per dimension you
care about. The defaults are **Confidence**, **Competence** and **Passion**.

For each box you give a **name** and a **description of what it measures**. The description
is doing real work — it's how the evaluator decides which signals (posture, gaze, voice,
transcript) to draw on. Be concrete:

> **Confidence** — How composed and assured the speaker appears: steady gaze, grounded
> posture, controlled gestures, a steady voice.

Vague descriptions ("how good they are") produce vague scores.

### Grading Prompt *(Advanced)*

Your grading philosophy — how strict to be and what matters most. This steers the final
evaluator across every box and check.

```
You are a strict pitch-competition judge. Reward specificity and evidence
over enthusiasm. A pitch that is polished but says nothing concrete should
not score above 6.
```

### Content Checks *(Advanced)*

Things that must appear **in what the student says**, checked against the transcript. Each
has a label and a description of what satisfies it.

| Label | What satisfies this check |
|---|---|
| Opening hook | The first 10 seconds pose a problem or a surprising fact |
| Market size | A specific, sourced figure for the addressable market |
| The ask | A clear statement of what they want from the audience |

### Class Code *(Advanced)*

Optional, and worth setting for a real class — it's what puts the assignment on students'
dashboards. See [Invite your students](/userguide/prof-invite).

## Step 3 — "Final Polish"

Set the **Introduction Message** students see on the upload page, and choose **Public** or
**Private** access. Click **Publish**.

You land on the **Video Analysis Dashboard**.

## What students do

They open the upload page, enter their name and email, and drop in a video (**MP4, MOV,
WEBM, M4V, up to 1 GB**). Processing takes about **2–4 minutes** and shows live progress —
*"Analyzing your delivery & speech…"*, *"Grading your pitch…"* — with a pitch tip carousel
while they wait. They get a private results link by email.

## What you get

On **`/video-dashboard/:id`** — reachable via **Open Dashboard** on the card:

- Your **Upload link** and **Invite link**, ready to copy
- A card per scoring box with the class average and an *Excellent / Strong / Developing /
  Weak* split
- **Content Checks (Class Avg)** across the cohort
- A callout naming the box that is lowest-scoring for the most students
- **Class Analytics** — average speaking pace and filler-word rate
- A per-student table with each student's score in every box, plus an overall
- **AI Grading Analysis** — a free-text box and **Run Analysis**, to re-evaluate everything
  against a new question

More in [Read the results](/userguide/prof-results).

> **Changing the rubric later** applies to new submissions. To re-evaluate what's already
> in, use **Run Analysis** at the bottom of the dashboard.
