# Testable manager-exercise conversation series

Five scripted rooms for the HKL Solutions hidden-profile case. Each file is a fixed
sequence of **student messages only** — ACTR's turns are deliberately absent, because ACTR
is the thing under test. The replay harness (`tests/sim/replay.py`) feeds the student
lines in order and asks the facilitator after each one, exactly as production does.

## Why student-only

Scripting ACTR's replies would make the file a transcript of a conversation that already
happened. Scripting only the students makes it a **fixture**: the same stimulus, delivered
identically, every run — so a prompt edit or a model swap is the only thing that changed.
The cost is that these students cannot react to a facilitator that behaves differently, so
the early turns of a run are the trustworthy ones and late divergence is ACTR responding to
a conversation that never took place.

## The case, in one table

Distinct counts are what the criterion actually rewards: **most distinct strengths, fewest
distinct concerns**. Items describing the same behaviour collapse to one no matter how many
roles report them.

| Candidate | Distinct S / C | Outcome | Why it fools people |
|---|---|---|---|
| **Jacky Chan** | **8 / 1** | success | His 8 strengths are split three ways — nobody sees more than 3 — while his single concern sits in *every* packet. Looks merely adequate to each reader alone. |
| John Law | 5 / 2 | failure | All 5 strengths appear in all 3 packets, so he looks strong to everyone. Two of his concerns are the same passivity worded twice, and they collapse to one. |
| Jet Li | 5 / 3 | failure | His 3 concerns sit one-per-role, so no reader sees more than one problem. |

Roles: **Logistics Manager**, **Marketing Manager**, **Operations Manager**.

Two tension pairs the case pack marks as *surface it, do not resolve it*: John Law's
"demanding but fair" (strength) against "micromanages" (concern) — one behaviour, two
framings; and Jet Li's "annoys senior leaders by pushing after a decision is settled".

## The five series

| File | Hired | Outcome | Students | Primarily tests |
|---|---|---|---|---|
| `01_jacky_success_genuine.md` | Jacky Chan | success | 3 good | SUCCESS track; never naming the best option even when they picked it |
| `02_john_law_failure_collapse.md` | John Law | failure | 3 good | FAILURE track; the collapse pair; one candidate at a time |
| `03_jet_li_failure_hidden_info.md` | Jet Li | failure | 3 good | Pooling concerns held by exactly one person each; not revealing who holds what |
| `04_john_law_delinquent.md` | John Law | failure | 2 good + 1 delinquent | Fabricated facts, off-scope drift, answer extraction, case-pack leakage |
| `05_jet_li_staller.md` | Jet Li | failure | 2 good + 1 staller | Stalling, repeat-looping, refusing to do their counting for them |

## File format

Each file has four sections. Only `## Transcript` is machine-read; the rest is for the
person reading the diff.

- **Setup** — who is in the room, which role each holds, what was hired.
- **Ground truth** — what each student legitimately holds, so you can tell a real
  recollection from an invented one at a glance.
- **What this tests** — a checklist of pass/fail behaviours, each tied to a line of the
  facilitator prompt or the case pack.
- **Transcript** — `Name: text`, one message per line, in order. Blank lines and `>` notes
  are ignored by the parser. A line of `--- pause ---` means a long gap, so the harness can
  raise the silence flag the live room would have raised.

## Reading a run

Watch for the failure that matters most: **a facilitator that states case-pack content**.
In the real room this came from (`6a71a7b307a26aa36d80613b_g8`), ACTR told a student
"micromanage… came up in what you knew about him" when it had not, then had to ask which
role they held. Series 04 reproduces the conditions that produced it.
