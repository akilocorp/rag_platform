<!-- @language Markdown  @updated 2026-08-03  @changed New page: professor troubleshooting, including the known wizard traps. -->

# Troubleshooting

## Building a Space

**"A field this guide mentions isn't on my screen."**
You're in Simple mode. Flip the **`S ⚬ A`** toggle to Advanced. Class codes, the model
picker, response-style sliders and the facilitator prompt editor all live behind it.

**"The wizard jumped back a step when I changed the mode."**
Expected. Advanced mode adds a step that Simple doesn't have, so switching mid-wizard drops
you to the nearest earlier valid step. Nothing you typed is lost — hidden fields still
submit.

**"My Manager Exercise failed when I clicked Publish."**
You almost certainly have two candidate outcome documents. **Exactly three are required.**
The wizard lets you past step 3 with two, but the server rejects it at the end. Add the
third and republish.

**"My Experiential Lab has no Publish button."**
The last button says **Next**, because this type only has two steps and the label only
changes on step five. Clicking **Next** on step 2 does publish it.

**"Generate lab timed out."**
Wait a few seconds and reload before regenerating — it often completed anyway. Generation
takes 30–60 seconds normally.

**"It won't let me save the lab."**
*"Generate the lab before saving"* — you need to click **Generate lab** at least once.

## Files

**"My file didn't upload and there was no error."**
Unsupported extensions are skipped silently. Only **TXT, MD, PDF, DOCX, PPTX** are
accepted.

**"It rejected a file for being too large, but the wizard said 500 MB."**
The file library in the chat sidebar caps at **50 MB**, the wizard at 500 MB. Upload large
files through the wizard, or split them.

**"The assistant doesn't seem to know about a file I just added."**
Check it's finished ingesting — a file shows *"Preparing your file"* → *"Indexing extracted
text"* while it works and isn't searchable until that clears. Scanned PDFs take longest.

## Students getting in

**"My student says the link doesn't work."**
If you shared a **direct** link, the Space is probably Private. Either set it to **Public**
(step 5, or **Customize → Public Access**), or give it a class code and share the
`/join/CODE` link instead — that one handles sign-in for them.

**"Class code already taken."**
Codes are unique across the entire platform, not just your account. Add your section or
year: `MGMT5110-B`, `ECON5200-2026`.

**"My student can't find the assignment on their dashboard."**
The student dashboard lists Spaces they're enrolled in via a class code. Without a class
code there's nothing to list — send them the direct link, or add a code.

**"I can't find Usage tier / Number of students."**
They only appear once the Space has a class code, and only under **Customize** — not in the
creation wizard. Publish, set a class code, then reopen Customize.

## Access and accounts

**"Access Denied on the admin page."**
The admin panel is reachable by any professor account but only works for administrators.
If you need admin rights, ask whoever runs your installation.

**"Terms of Service / Privacy Policy links go to a 404."**
Known — those pages haven't been published yet.

**"A student says they never verified their email."**
It doesn't block them. Email verification is not enforced at sign-in; they'll see an amber
banner on their dashboard but can use everything. If they can't log in, the cause is the
password, not verification.

## Results

**"I changed the rubric but the scores didn't move."**
Rubric edits apply to **new** submissions. Use **Rescore** on the video dashboard to
re-grade what's already there.

**"A student's video failed to process."**
They can resubmit — the upload page keeps a history with `Scored` / `Failed` / `Processing`
status per attempt.

## Still stuck

Use **Report a Bug** in the header of your assistant list. Include the Space name and what
you clicked just before it went wrong.
