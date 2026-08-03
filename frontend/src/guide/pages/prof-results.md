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

The header shows the assistant's name and a count like *"5 sessions · 1 identified
student"*, with **Export CSV** on the right. Two tabs: **Analytics** and **Sessions**.

### Analytics — you run it, it isn't automatic

The Analytics tab opens on a **New Analysis** card, not on a finished report. Scoring
happens when you ask for it:

1. Optionally pick a **quick template** — *HR Interview, Participation, Critical Thinking,
   Sales & Negotiation, Presentation Skills,* or *Socratic Dialogue*.
2. Optionally add **Grading criteria** — *"Describe how you want the AI to evaluate
   students…"*
3. Click **Generate Analysis**. It takes roughly 8–15 seconds for a handful of sessions.

You get a score per student plus a class summary, shaped by whatever criteria you gave it.
Run it again with different criteria whenever you want a different lens.

### Sessions

Lists the individual conversations. Open one to read the full transcript exactly as the
student saw it.

**Export CSV** gives you the raw data for your own analysis.

## Video Analysis — Dashboard

![The video dashboard](/guide-media/video-dashboard.png)

The richest of the three. It opens with the submission count and a **Delivery View**
button.

**At the top** — your **Upload link** and **Invite link**, each with a **Copy** button.
These are what you send students.

**Class averages per scoring box** — one card per box you defined, showing the class
average and how many students fell into each band: *Excellent / Strong / Developing /
Weak*. So a box reading `Passion 63 · Excellent 0 · Strong 1 · Developing 2` tells you at a
glance that nobody excelled and most are mid.

**Content Checks (Class Avg)** — each check you defined with its class average out of 10.
A check sitting at 4.0 while the rest are near 8 is the one your briefing didn't land.

**A plain-language callout** naming the weakest area:

> Most common weakness: Pace, Timing & Fluency is the lowest-scoring box for the most
> students.

That sentence is usually your next lecture.

**Class Analytics** — average speaking pace in words per minute, and average filler-word
percentage.

**A per-student table** — one row per student with their score in each box and an
**Overall**. Note this table shows student names and email addresses, so take care if
you're screen-sharing it in class.

**AI Grading Analysis** at the bottom — a free-text box (*"Describe what you want the AI to
evaluate"*) and a **Run Analysis** button. The results update the student cards above.
Useful when a pattern occurs to you after the fact.

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
