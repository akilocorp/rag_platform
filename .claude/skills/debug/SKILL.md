---
name: debug
description: Use whenever creating, editing, or debugging ANY source file in this repo. Enforces two documentation standards on every file Claude touches — a file-header banner (language / last-updated date / what-changed tagline) and precise per-unit comments on each unique piece of functionality (widgets, functions, handlers that carry real logic) while skipping menial glue. Triggers on "debug", "fix this bug", "why is this broken", and any request that has Claude write or modify code.
version: 1.0.0
---

# debug — document-as-you-debug standard

This skill governs **how Claude leaves a file after touching it**. Its job is not only
to find and fix bugs, but to make sure that every file Claude creates or edits comes out
self-describing: a header banner at the top, and precise comments on each unit of real
functionality. Apply it to **every file you touch in this repo** — not only when the user
says the word "debug".

## The two standards (both are mandatory on every touched file)

### 1. File-header banner

The **first thing** in every file (after any shebang / required first-line pragma — see
"Placement" below) is a three-field banner, written in that file's native comment syntax:

- `@language` — the language / dialect the file is written in (e.g. `Python`,
  `JavaScript (React / JSX)`, `CSS`, `Bash`, `Dockerfile`, `YAML`).
- `@updated` — the date this file was last modified, ISO 8601 `YYYY-MM-DD`.
- `@changed` — a one-line tagline describing the most recent change (what you just did).

**On every edit you make to a file, refresh `@updated` to today's date and rewrite
`@changed` to describe the change you just made.** If a file has no banner yet, add one.
If it already has one, update it in place — never stack a second banner.

#### Banner syntax per language

```jsx
/**
 * @language  JavaScript (React / JSX)
 * @updated   2026-07-10
 * @changed   Added zoom + pan to the impact_map widget's viewBox.
 */
```
```python
# @language  Python
# @updated   2026-07-10
# @changed   Validate impact_map regions; reject all-neutral maps.
```
```css
/*
 * @language  CSS
 * @updated   2026-07-10
 * @changed   Added .fac-im-* hover states for impact-map countries.
 */
```
```bash
# @language  Bash
# @updated   2026-07-10
# @changed   Prune dangling images before compose build.
```

Match the comment style to the file: `#` for Python / Bash / YAML / Dockerfile,
`/* … */` or `/** … */` for JS / CSS / Java / C-family, `<!-- … -->` for HTML / XML /
Markdown, `--` for SQL / Lua. When unsure, use whatever comment form the rest of the file
already uses.

#### Placement rules

- If the file starts with a **shebang** (`#!/usr/bin/env python`) or a **required
  first-line pragma** (`# syntax=docker/dockerfile:1.4`, `'use client';`, a license
  header, `<!DOCTYPE html>`), the banner goes **immediately after** it — never before, or
  you break the file.
- Otherwise the banner is line 1.
- Exactly one banner per file.

### 2. Precise per-unit comments

Above **each unique unit of functionality**, write a short comment stating precisely what
that unit does — not how, but what it is responsible for. A "unit" is anything a reader
would treat as its own concept:

- a widget / component
- a function, method, hook, or class that carries real logic
- a distinct block of behavior (a projection, a reducer, a parser, a queue operation,
  a socket handler, a data transform)

**Compartmentalize**: each distinct functionality gets its own comment, even if several
sit in one file. The impact-map widget's `pathFor`, `bboxFor`, `clampView`,
`zoomToFeature`, and the drag handlers are five separate units → five comments.

#### Scope: what to skip

Do **not** comment menial glue that a competent reader understands at a glance:

- one-line event forwarders (`onClick={() => setOpen(true)}`), plain button clicks
- trivial getters / setters / passthrough props
- obvious variable assignments and imports
- boilerplate a framework requires

The test: *would a reader have to pause to work out what this does or why it exists?*
If yes → comment it. If it's self-evident plumbing → leave it clean.

#### Style

- One line where one line suffices; a short block for genuinely subtle logic.
- Say what the unit is responsible for and any non-obvious constraint
  (e.g. `// clamp pan so the map can't be dragged off-canvas`).
- Match the surrounding code's comment density and voice — this repo comments the *why*
  and the *contract*, not line-by-line narration. Don't over-comment.

## Debugging workflow

When the request is to fix a bug (not just edit), work in this order, then apply both
standards above to every file you change:

1. **Reproduce / locate** — read the failing code and trace the actual path. Confirm the
   real cause before editing; don't patch symptoms.
2. **Minimal fix** — change the smallest surface that resolves the root cause.
3. **Document the fix** — update the touched file's `@updated` + `@changed` banner, and
   add/refresh the per-unit comment on any unit whose behavior you changed. If the bug
   existed *because* a unit's behavior was non-obvious, that's a signal it needed a
   comment — add one.
4. **Verify** — build / lint / run whatever cheaply confirms the fix; report honestly if
   you couldn't verify.

## Checklist before you finish a file

- [ ] Banner present at the top (after any shebang/pragma), exactly one.
- [ ] `@language` correct for the file.
- [ ] `@updated` = today, `@changed` = what you just did.
- [ ] Every unique unit of functionality has a precise comment.
- [ ] Menial glue left uncommented (no noise).
- [ ] Comment density matches the rest of the file.
