<!-- @language Markdown  @updated 2026-08-03  @changed New page: the three results dashboards. -->

# Read the results

Each Space Type has its own results view, reached from the assistant's card.

| Type | Button on the card | Where it goes |
|---|---|---|
| Chat Bot | **Responses** | `/responses/<id>` |
| Video Analysis | **Dashboard** | `/video-dashboard/<id>` |
| Experiential Lab | **Sessions** | `/experiential-dashboard/<id>` |

## Chat Bot — Responses

![The responses page](/guide-media/responses-page.png)

Opens on the **analytics** tab:

- **Class Overview** — participation and volume across the cohort.
- **Top Performers**
- **All Students** — per-student breakdown.

The **Sessions** tab lists individual conversations. Open one to read the full transcript
exactly as the student saw it.

You can **download a CSV** for your own analysis.

## Video Analysis — Dashboard

![The video dashboard](/guide-media/video-dashboard.png)

The richest of the three.

**Across the class:**

- Average score on the **first 8 seconds** — the opening is where most pitches are won or
  lost, so it's tracked separately.
- **Content Checks (Class Avg)** — how many students hit each of your checks.
- **Common Strengths** and **Common Weaknesses**, including a plain statement of which box
  is the lowest-scoring for the most students. That line is usually your next lecture.

**Per student:** a table with their score, strengths, areas to improve, and
**Open full results →** for the complete breakdown — every scoring box with its /10 and its
written rationale, the body-language analysis, and the full transcript.

**Also here:**

- **Export PDF** for the whole class.
- **Past Analyses** — previous runs are kept.
- A free-text box: describe something else you want evaluated, and every student card
  updates against that question. Useful when a pattern occurs to you after the fact.
- **Rescore** — re-grade existing submissions after you've edited the rubric. Rubric edits
  otherwise apply only to new submissions.

There's also a **compare** view at `/video/compare/<id>` for putting submissions
side by side.

## Experiential Lab — Sessions

![The experiential dashboard](/guide-media/experiential-dashboard.png)

*"Professor view: every student's run for one experiential lab."*

A list of runs, each showing the student, when they ran it, and either an **In progress**
pill or their score out of 100. Click any row to **replay the entire session** — every
prediction, every answer, every piece of reasoning they typed, in order.

**Preview / play lab** at the top runs the lab yourself, which is the fastest way to check
it before you assign it.

Empty list? *"No one has run this lab yet."*

## Manager Exercise

Grades are broadcast to each group as a scorecard when their session completes:

- **Group outcome** — right first time, recovered in round 2, or neither.
- **Per-student participation** — whether each student took part, per round.
- **Per-student communication** — only if you set a grading rubric under
  **Customize → Grading rubric** (Advanced mode).

## A note on what's stored

Deleting a Space also deletes its chat sessions and messages. Export anything you need —
the Responses CSV, the video dashboard PDF — before you delete.
