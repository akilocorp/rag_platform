<!-- @language Markdown  @updated 2026-08-19  @changed New page: the Widgets section, with a live playable demo of each widget type. -->

# Widgets

## What is a widget?

A widget is an interactive piece of UI the bot can drop into a reply instead of only
text — a quiz question, a chart, a flip-card deck. Turned on through the **Facilitator**
toggle in [Create a Chat Bot](/userguide/prof-chat-bot), step 4, it's the difference
between a bot that only talks *at* a student and one that gives them something to *do*:
answer a question, read a graph, flip through terms, build a map. That's the whole point —
a wall of text is easy to skim past; an interactive element makes a student stop and
engage with the material for a few extra seconds, which is where most learning happens.

You don't place widgets yourself. You describe, in plain language, when they should
appear — *"After explaining a concept, offer a multiple-choice question to check it
landed"* — and the bot decides, per reply, whether one fits.

Every widget below is **live** — the same component students see in a real chat, fed
made-up example data. Try them.

## Multiple choice

**Interactive.** A single-select question. The student's pick is sent back into the
conversation as their next message, so the bot can react to it — confirm a correct answer,
correct a wrong one, or just move on.

<div data-guide-widget="multiple_choice"></div>

## Chart

**Display-only.** A line or bar chart of one or more numeric series. Good for anything
that changes over time or across categories — revenue by quarter, a population curve, a
comparison across groups.

<div data-guide-widget="chart"></div>

## Flashcards

**Display-only.** A deck of flip cards, one at a time, for active recall — term on the
front, answer on the back. The student clicks through at their own pace.

<div data-guide-widget="flashcard"></div>

## Timeline

**Display-only.** An ordered sequence of steps, stages, or events. Useful for processes,
historical sequences, or anything with a "first this, then this" shape.

<div data-guide-widget="timeline"></div>

## Comparison table

**Display-only.** A side-by-side grid — options, approaches, tradeoffs — lined up column
by column instead of buried in prose.

<div data-guide-widget="comparison_table"></div>

## Mind map

**Interactive.** A central idea with concept tiles scattered around it. The student drags
threads to connect tiles to the center (or to each other), then checks their map against
an answer key. A result summary — score, what was missed — is sent back to the bot.

<div data-guide-widget="mind_map"></div>

## Impact map

**Interactive.** A world map shaded by the role each country plays in a scenario's ripple
effects — where it started, who's affected and how. Clicking a highlighted country asks
the bot to elaborate on that country's role.

<div data-guide-widget="impact_map"></div>

## Turning widgets on

Widgets aren't on by default for a new bot. In the wizard, step 4 ("Customize AI
Behavior"), switch on **Facilitator (interactive UI)** and tell it — in the **"What should
the facilitator do?"** box — when to use one:

```
When the reply describes a quantity changing across periods, show it as a
chart of that trajectory. After explaining a concept, offer a multiple-choice
question to check it landed.
```

Leave it off if you just want a plain conversation. See
[Create a Chat Bot](/userguide/prof-chat-bot) for the rest of that step.
