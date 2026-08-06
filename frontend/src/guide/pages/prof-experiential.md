<!-- @language Markdown  @updated 2026-08-03  @changed Humanizer copy pass: trimmed em dashes and AI-isms. -->

# Create an Experiential Lab

An Experiential Lab is a simulation built from your lecture files. Students reason through
a scenario rather than reading about it. They commit to a prediction, then find out what
actually happens and why.

**Steps:** 2, the shortest of the four types.

## Step 1: Name, type, and your course materials

1. Name the Space.
2. Choose **Experiential Lab** (*"Scripted Simulation"*).
3. A **Course materials** block appears. Upload your lecture files here; the next step
   builds the lab out of them.

This upload is the whole point of step 1. A lab generated without materials will be
generic; one generated from your slides uses your notation, your examples, and your
sequence.

Click **Next**.

## Step 2: "Generate the Lab"

![The lab generator](/guide-media/lab-generator.png)

### Pedagogical method *(Advanced only)*

Three methods ship today. In Simple mode this is chosen for you.

| Method | What it does |
|---|---|
| **Economics (baseline → complications)** | A 3-layer macro spine: a baseline model, then two complications that each amplify a different variable |
| **Generic (any discipline)** | The same predict-and-reveal shape, discipline-agnostic, with a flexible 2–4 layers |
| **Shock World (Socratic shock immersion)** | Drops a student into a country hit by a shock; a tutor guides them to your end goal within a set reply budget, and scores their effort to learn |

The first two produce the same student experience: **predict → commit → reveal →
explain**. Shock World is a different thing entirely; see below.

### Lab design prompt

Describe the lab you want. Say what students already know, what you want to complicate,
which measures should move, and which lectures to ground it in.

```
Students know the basic IS-LM baseline from Lecture 4. Build a lab where an
oil price shock hits a small open economy. Layer 1: the baseline response.
Layer 2: add sticky wages. Layer 3: add a central bank that targets inflation.
Track output, inflation and the real exchange rate.
```

### Generate

Click **Generate lab**. This takes **30–60 seconds**; it's writing the whole lab. When it
finishes you get a green **"Lab ready — preview"** card, with a *grounded in lectures* chip
if it used your uploads.

> If it times out, wait a few seconds and check before regenerating. The message says as
> much, and the lab has often generated anyway.

Not right? Edit the prompt and click **Regenerate lab**.

### Narrow what it tests *(Advanced)*

After generating, a panel appears: **"What this lab tests — from your course"**, with
checkboxes per chapter and topic. Untick what you don't want covered and click
**Regenerate with these topics**.

### Shock World settings *(Advanced)*

If you chose Shock World, its own settings appear:

- **Countries students can pick** — a searchable multi-select. Each student picks one, and
  the shock is grounded in that country's actual conditions.
- **Reply budget (N)** — 1 to 12, default 4. The maximum exchanges the tutor gets to guide
  a student to your end goal. Students should reach it in fewer; the budget is the ceiling,
  not the target.
- **Course-only** — confine the tutor strictly to your uploaded material.
- **Minimum grade** — every completed run scores between this floor and 100.

### The Facilitator

The same toggle as on chat bots. After each reply the lab can offer a chart or a
multiple-choice question instead of only text. Optional.

## Publishing

> **The last button says "Next", not "Publish".** Because this type only has two steps, the
> button never relabels itself. Clicking **Next** on step 2 does publish the lab. This is
> a known cosmetic quirk, not a sign that something is missing.

You can't save until a lab has been generated; you'll see *"Generate the lab before
saving"*.

## What students see

**Predict-and-reveal labs** (Economics / Generic): read the scenario, set prediction dials,
**Commit prediction & reveal baseline**, then for each complication call *more / same /
less* and commit again. Each reveal shows a chart, a comparison table and a narrative.
They finish with a written synthesis and get a scorecard splitting **Prediction** (how many
calls were right) from **Synthesis** (graded against a rubric).

**Shock World**: pick a country, optionally ask for an analogy, then work through adaptive
multiple-choice questions, each answer followed by a **"Why?"** box. Asking for help
doesn't spend budget. It ends with a debrief scored out of 100 across **Engagement**
(35%), **Self-correction** (20%) and **Demonstrated understanding** (45%).

## Seeing their work

**Open Sessions** on the card, or **`/experiential-dashboard/:id`**, lists every student's
run with their score, and links to a full replay of each. See
[Read the results](/userguide/prof-results).
