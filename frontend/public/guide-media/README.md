<!-- @language Markdown  @updated 2026-08-03  @changed Marked the 19 captured shots; listed the 5 outstanding with what each still needs. -->

# Guide screenshots

**Status: 19 of 24 captured.** The five outstanding ones are listed at the bottom — each
needs either a different login or data that doesn't exist yet on the dev site.

Drop PNGs here using the exact filenames below. They're served straight from
`/guide-media/<name>.png` — no build step, no imports, no code change needed. Add a file
and it appears on the next page load.

Any filename referenced by a guide page but not present here renders as a dashed
**"Screenshot pending"** slot naming the file it wants, so the guide itself is the live
checklist.

**Capture tips:** browser at ~1440px wide, no personal data on screen, crop to the relevant
panel rather than the whole desktop.

## Checklist

| File | What to capture |
|---|---|
| `config-list.png` | `/config_list` with a few assistants, grid view |
| `config-mode-toggle.png` | The `S ⚬ A` pill, close crop |
| `wizard-step1-types.png` | "What do we call your Space?" showing all 4 type tiles |
| `wizard-step2-models.png` | "Pick the Base AI Model" |
| `wizard-step3-files.png` | "Upload Knowledge Base" dropzone |
| `wizard-step4-behavior.png` | "Customize AI Behavior" including the templates |
| `wizard-step5-polish.png` | "Final Polish" with Access Permissions |
| `video-rubric-editor.png` | "Define the Rubric" with a couple of scoring boxes filled in |
| `lab-generator.png` | "Generate the Lab" with the method dropdown visible (Advanced mode) |
| `me-setup.png` | Manager Exercise step 2, "Setup" |
| `me-review-case.png` | Manager Exercise step 4, the tally table |
| `share-modal.png` | The "Share to class" modal |
| `files-panel.png` | Chat sidebar file library with the add menu open |
| `responses-page.png` | `/responses/<id>`, analytics tab |
| `video-dashboard.png` | `/video-dashboard/<id>`, class analytics |
| `experiential-dashboard.png` | `/experiential-dashboard/<id>`, session list |
| `account-dropdown.png` | The username dropdown, open |
| `register-page.png` | `/register` showing the "I am a" toggle |
| `join-page.png` | `/join/<code>` while logged out |
| `student-dashboard.png` | "My Assignments" with at least one card |
| `video-upload.png` | The student upload form |
| `video-results.png` | A student results page with dimension cards |
| `shock-world-player.png` | A Shock World question with the "Why?" input open |
| `me-student-lobby.png` | The breakout group picker with occupancy counts |

## Still outstanding (5)

| File | What it still needs |
|---|---|
| `student-dashboard.png` | A **student** login — the dev captures were all done from a professor account |
| `video-results.png` | The dashboard has no per-student results link until an analysis has been run; needs one scored submission opened from a student's own results email |
| `me-review-case.png` | Three case documents uploaded and **Analyse the case** run — that writes to the database and costs an LLM call, so it was left alone |
| `experiential-dashboard.png` | No Experiential Lab exists on the account yet (the shared list has 0 "Open Sessions" spaces) |
| `shock-world-player.png` | Same — needs a published Shock World lab and a live tutor session |

Until these land, those four pages show the dashed placeholder, which is harmless.
