<!-- @language Markdown  @updated 2026-08-03  @changed Humanizer copy pass: trimmed em dashes and AI-isms. -->

# Invite your students

Two ways to get students in: a **class link** (recommended) or a **direct link**.

## Class links

Give the Space a **class code** and students get a link that enrolls them and drops them in
the right place.

### Setting a class code

- **Manager Exercise** — on step 2 of the wizard.
- **Every other type** — turn on **Advanced** mode, then look for **Class Code** on step 4
  of the wizard, or under **Customize** after publishing.

Rules: 3–20 characters, letters, numbers and hyphens, and unique across the platform.
If someone already has it you'll see *"Class code already taken. Choose a different one."*
Course codes work well: `MGMT5110`, `ECON5200-B`.

### Sharing it

Click the **share icon** on the assistant's card to open **"Share to class"**, then **Copy
link**.

![The share modal](/guide-media/share-modal.png)

The link looks like:

```
https://yoursite.com/join/MGMT5110
```

### What the student sees

Already signed in: they're enrolled and taken straight to the bot, lab, or exercise.

Not signed in: a page reading **"You've been invited to join"** with the class name and
two buttons: **Create an Account** and **I already have an account**. Either way they end
up enrolled without typing the code anywhere.

## Direct links

If you don't want a class code, the same **Share to class** modal gives you a direct link
to the Space:

| Type | Direct link |
|---|---|
| Chat Bot | `/chat/<id>` |
| Video Analysis | `/video-upload/<id>` |
| Experiential Lab | `/experiential/c/<id>` |
| Manager Exercise | `/manager-exercise/<id>` |

> **A direct link to a Private Space fails for anyone not signed in.** If you're sharing a
> direct link with people who don't have accounts, set **Access Permissions** to **Public**
> on step 5, or under **Customize → Public Access**. Class links don't have this problem:
> they walk the student through signing in first.

## Message allowances for a class

Once a Space has a class code, **Customize** reveals two more fields:

- **Usage tier** — how many messages each student gets (your administrator defines the
  tiers).
- **Number of students** — your roster size.

Together these set a shared class pool: `messages per student × number of students`.
The line underneath shows the total. Students draw from the shared pool rather than their
personal allowance, so a few heavy users don't lock anyone out.

> These fields are edit-only. You can't set them while creating. Publish first, set a
> class code, then reopen **Customize** and they'll be there.

## Embedding in Qualtrics *(chat bots, Advanced, edit-only)*

Under **Customize**, turn on **Qualtrics embedding**, then click **Create Session — Get
Embed HTML**. You get a single HTML block to paste into a Qualtrics Text/Graphic question's
HTML view, with no separate JavaScript step.

Add these embedded-data fields to your survey flow so the transcript is captured:

- `transcript`
- `chat_status`
- `condition`

## Checklist before you send the link

1. Open the link yourself in a private window.
2. If it's Private, confirm you're prompted to sign in rather than shown an error.
3. Send one test message, or one test submission, end to end.
4. For a Manager Exercise, check you have enough breakout rooms for your class size. The
   setup step tells you the capacity.
