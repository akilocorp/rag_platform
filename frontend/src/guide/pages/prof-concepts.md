<!-- @language Markdown  @updated 2026-08-03  @changed Humanizer copy pass: trimmed em dashes and AI-isms. -->

# Key ideas

Five concepts explain most of the platform. Read this once and the rest of the guide will
make sense.

## Spaces

Everything you build is a **Space** (the cards on your assistant list are Spaces). A Space
bundles a name, a type, an AI model, your instructions, any uploaded documents, and the
settings for whichever exercise it runs.

The **Space Type** is chosen on step 1 and **cannot be changed afterwards**. If you pick
wrong, build a new one. Everything else is editable, but not this.

## The four Space Types

![Step 1 of the wizard, with all four Space Types](/guide-media/wizard-step1-types.png)

| Type | What it is | Best for |
|---|---|---|
| **Chat Bot** | A 1-on-1 text assistant that answers from your uploaded documents, and optionally the web | Study support, a Socratic tutor, interview or negotiation practice |
| **Video Analysis** | Students upload a video; it's scored against a rubric you define | Elevator pitches, research defenses, any spoken assessment |
| **Experiential Lab** | An AI-generated simulation, built from your lecture files, that students reason through | Teaching a mechanism: students predict, commit, then see what happens |
| **Manager Exercise** | A hidden-profile group decision game with a facilitated debrief | Showing a class how groups under-share information |

Each has its own walkthrough:
[Chat Bot](/userguide/prof-chat-bot) ·
[Video Analysis](/userguide/prof-video-analysis) ·
[Experiential Lab](/userguide/prof-experiential) ·
[Manager Exercise](/userguide/prof-manager-exercise)

> **The wizard has a different number of steps for each type.** Chat Bot has five (four in
> Simple mode), Video Analysis has three, Experiential Lab has two, Manager Exercise has
> five. The progress bar at the top always shows the right number, so trust it rather than
> counting to five.

## Knowledge base vs. web access

A **knowledge base** is the set of documents you upload. The assistant searches them to
answer questions, and cites which file each passage came from.

**Web access** is a separate toggle (*"Allow web search & URL access"*, on by default for
chat bots in Advanced mode). With it on, the assistant can also search the web and read
URLs students paste. Turn it **off** if you want answers restricted to your materials only.

See [Knowledge base & files](/userguide/prof-knowledge-base).

## Class codes

A **class code** turns a Space into a class. It's a short string like `MGMT5110`:
3 to 20 characters, letters, numbers and hyphens, and unique across the whole platform.

Give a Space a class code and you get a link like:

```
https://yoursite.com/join/MGMT5110
```

Students who open it are enrolled and dropped straight into the right place. Codes also
let you attach a shared message allowance for the class. See
[Invite your students](/userguide/prof-invite).

## Public vs. Private

The last step of the wizard sets **Access Permissions**:

- **Private — Login Required** (the default). Students must have an account.
- **Public — Link Access**. Anyone with the link can use it, no account needed.

This matters when you share a **direct link** rather than a class-code link: a direct link
to a Private Space shows an authentication error to anyone not signed in. Class-code links
always work, because they walk the student through signing in first.
