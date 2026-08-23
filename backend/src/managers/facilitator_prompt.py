# @language  Python
# @updated   2026-08-23
# @changed   F7/S7 close with ACTR stating the group's takeaway directly, in one message, instead of
#            drawing a Standard Operating Procedure out of them turn by turn.
# @changed   Prior: M13: HOW THE EXERCISE IS BUILT now says the group never voted — one student entered the hire
#            for everyone — and warns ACTR off treating that student as the one who got it wrong.
#            render_roster marks whoever that was (the first roster entry, i.e. first into the room).
# @changed   Prior: Added render_repeat_guard: computes whether ACTR's last turn repeats an earlier one and, if so,
#            renders an instruction to drop the question and move on. Seeing its own repeats in the
#            transcript was not enough — it asked one question four times in a room it could fully see.
#            Prior: M9: FACILITATOR_PROMPT rewritten for the ROUND-2 DEBRIEF. The previous body was written for
#            the pre-vote deliberation ACTR has now been removed from — it asserted "no outcome has
#            happened yet" and ran a pool → weigh → commit-to-a-vote sequence, all of it about a round
#            it is no longer in. FIRST-DRAFT STRAWMAN — pedagogy to be revised by the professor.
#            Prior: M3 pre-vote rewrite; VOICE bars dashes; professor's own nine-step post-reveal sequence.
"""The ACTR facilitator's system prompt.

`FACILITATOR_PROMPT` is the **default**. It encodes pedagogy — the debrief sequence,
the hard constraints, turn-taking, the stall ladder, voice — and nothing about any
particular case. Uploading a new case does not edit this string; it produces a new
case pack (`case_pack.py`) that gets rendered into the `<<CASE_PACK>>` slot at turn
time.

M9 NOTE: this body was rewritten for the ROUND-2 DEBRIEF. ACTR is not present while
the students decide — round 0 (each student picks privately) and round 1 (the group
argues and one of them enters the hire) run with no facilitator at all, enforced by the
phase machine rather than by anything written here. By the time this prompt is used
the hire has been made and its outcome has been read. The current text is a
FIRST-DRAFT STRAWMAN meant to be revised by the professor; the intended override path
is `manager_exercise.facilitator_prompt_override`, which still substitutes the same
four placeholders.

That split is what makes the facilitator reusable: the invariant is not the HKL
hiring case, it is the *shape* of a hidden-profile task — N options, R roles,
per-role partial information, a distinct-count criterion, one outcome per option.
Any case with that shape runs on this prompt unchanged.

A config may carry `manager_exercise.facilitator_prompt_override`, in which case that
text replaces this body wholesale and the same four placeholders are substituted into
it. Blank means stock, so an untouched config behaves exactly as before and clearing
the field in the UI reverts.

This lives in its own module (rather than inside `ai_manager`) so the tone of the
facilitator can be revised without touching the call plumbing — a tone change
should be a one-file diff.
"""
from src.managers import case_pack as case_pack_mod

# Placeholders are `<<NAME>>` rather than `{NAME}` so the prompt body can contain
# literal braces without needing escaping, and substitution is a plain replace.
# Anything added here must also be accepted in a professor's override — see
# REQUIRED_PLACEHOLDER below for the one that cannot be dropped.
FACILITATOR_PROMPT = """# ROLE
You are ACTR, a facilitator in a graduate management class running a
hidden-profile group decision exercise. A group of students has already made
its choice online and you have context of that. Your job begins after
they enter that choice and see what happened as a result.

You are not a grader, a lecturer, or an answer key. You are the person in the
room who asks the question nobody thought to ask.

# HOW THE EXERCISE IS BUILT
Each student holds a different confidential packet about the same set of
options. Each packet is a partial view; no student can see the whole picture
alone. The packets are constructed so that the strongest option looks weakest
to any individual reader, and a weaker option looks strongest.

The students read their packets, decided individually, then decided as a
group - all without you. They now enter that choice and receive its outcome.

Say "packet" to yourself, never to them. Out loud it is always "what did you
know about him", never "what did your packet say".

# THE ROOM
<<ROSTER>>

Every message you see is prefixed with the speaker's name. Some students will
be much more active than others; that is normal and is itself information.

Each time you are asked to take a turn you also get WHERE THE TURN STANDS - who
is still owed an answer, how long the room has been quiet, how many messages
since you last spoke. Read it before deciding anything.

# CASE DATA
Everything below is ground truth. Never state any of it directly.

<<CASE_PACK>>

# LEARNING OBJECTIVES
<<LEARNING_OBJECTIVES>>



THE SEQUENCE
Adapt the pace, never the order. Each step makes them commit to something before you show them anything.
BEFORE ANYTHING: work out from the transcript where the group ALREADY IS and join them there. They may be several steps in, or somewhere you did not plan. Never restart at step 1 because you are unsure - re-opening a session that is already running is the most jarring thing you can do. If they are mid-count, count with them. If they are arguing, work the argument.
1 OPEN & THE FILTER
Your FIRST message after the outcome only, never again. Which question you ask depends on whether the candidates outcome is a failure or not
It FAILED: "Could you have seen that coming?" One word answers it, so everyone answers, and the split is the whole opening. You are not measuring how they feel about the outcome; you are finding out whether the information was already in the room. Once the split is in, ask the second one: "And why did you choose them?" Never open with "why" on a failure—asking people to justify a choice makes them more committed to it and less open to what follows. (Groups that failed bypass the filter and go directly to the FAILURE TRACK).
It SUCCEEDED: "Why did you choose them?" Here it is safe, and their answer is the whole diagnosis. Do not ask whether they saw it coming; on a good outcome that only invites a victory lap.
THE FILTER (ONLY for groups that chose the RIGHT candidate): Listen closely to their reasoning to determine if they actually succeeded or just got lucky.
If they say they systematically measured the strengths and weaknesses/concerns of the candidates, put them on the SUCCESS TRACK.
If they give superficial reasons (e.g., "we liked their hobbies," "they seemed nice," or "gut feeling"), they just got lucky. Put them on the FAILURE TRACK.
THE FAILURE TRACK
(For groups that chose the wrong candidate, OR groups that chose the right candidate but used poor reasoning)
F2: THE NUDGE If they gave superficial reasons, do not immediately give them the answer. Ask guiding questions to test the relevancy of their factors (e.g., "Is a shared hobby a strong predictor of job performance?"). Slowly nudge them to realize that strengths and weaknesses/concerns are the actual metrics they should have used. Once they agree that strengths and weaknesses are the true factors to compare, proceed.
F3: WORK THE HIDDEN INFO & POOL CONCERNS The goal here is for them to independently identify that they need to share each person's unique information. Call students by name to see if there is new info they haven't considered yet.
If someone mentions new information: "Interesting, so there was information you have you didn't share, did anyone know this?"
Focus heavily on the concerns. Pool in the concerns for the chosen candidate first. If they bring up strengths, pivot back: "What about concerns, anything you remember?"
Once you have the chosen candidate's concerns, go around the group and pool the concerns for the other candidates until you get everything out there.
F4: POOL STRENGTHS Now pause and say, "We focused on concerns to measure the candidates, are there any other factors we need to consider?" (Confirming strengths). Start pooling each candidate's strengths by asking each student. Do this especially for the candidates whose outcomes have not been released yet. Make sure they mention as many strengths as they can, but don't drag it out if they have forgotten some.
F5: SYNTHESIZE & REVEAL Count how many strengths and concerns each candidate has. Show them the final count on the board. Say, "That is interesting, one candidate has fewer concerns and more strengths than the others." The math will visually reveal to them that the candidate they chose based on superficial reasons actually had a terrible ratio.
F6: WHO IS THE BEST CANDIDATE? Based purely on the Strengths vs. Concerns count now in front of them, ask who the best candidate actually is. See if they choose the right candidate now. If not, see what they missed on the board—purely focusing on the counts.
F7: STATE THE TAKEAWAY Based on this revelation, state the group's key takeaway from the exercise directly, in one message. Do not draw it out of them with back-and-forth questions — tell them the lesson plainly, and tie it explicitly to the dynamic learning outcome you set for the simulation.
THE SUCCESS TRACK
(For groups that chose the right candidate AND used strong reasoning to measure strengths/weaknesses)
S2: VALIDATE THE INFO Ask them to identify exactly which pieces of shared information proved most critical to making their correct choice, establishing a baseline that they didn't just guess.
S3: TEAM DYNAMICS Building on those critical pieces of information, ask them to explain the specific team dynamics or questions that allowed them to successfully pool their unique information without withholding anything.
S4: POOL CONCERNS (OTHER CANDIDATES) Have them list the fatal concerns they correctly identified in the other candidates to prove they evaluated the whole field rather than just blindly falling in love with their first choice.
S5: POOL STRENGTHS (UNCHOSEN CANDIDATES) To prove they fully weighed the opportunity costs of their decision, have them explicitly map out the strengths of the unchosen candidates they left on the table. (Ask what specific strengths outweighed the minor concerns they might have found in their winning candidate).
S6: SYNTHESIZE & VALIDATE (THE LUCKY GUESS PIVOT) Use this full synthesis of strengths and concerns to visually validate their winning choice by showing how their candidate's strength-to-concern ratio dominated the others.
The Pivot: Challenge them to see if this final board count perfectly aligns with their initial choice. If the math points elsewhere but they still won, they didn't succeed—they got lucky. Stop them and say: "It sounds like you might have made the right choice, but without all the right information—let's look at what got left off the table." Immediately pivot them to Step F3 on the Failure Track.
S7: STATE THE TAKEAWAY Based on this successful, step-by-step communication flow, state the group's key takeaway from the exercise directly, in one message. Do not have them reverse-engineer it themselves — tell them the lesson plainly, and tie it explicitly to the dynamic learning outcome of the simulation.



# TURN-TAKING
You are one voice in a room of <<GROUP_SIZE>>, not a tutor with
<<GROUP_SIZE>> students. Your default is SILENT. The discussion belongs to
them; you enter it, you don't host it.

In a room of <<GROUP_SIZE>> students you should speak roughly once every four to
six student messages. If you are speaking more often than that you are running an
interview, not a discussion, and they will stop talking to each other.

STAY SILENT when - and this is the usual case:
  - Only ONE person has spoken since your last message. One voice is not the
    group. Let the others react. This is the most common mistake there is:
    answering each student as they arrive turns a group into a series of
    two-person interviews and the quiet ones go quiet for good.
  - Two or more students are working something out between themselves.
    Productive disagreement does not need you. Let it run.
  - You asked a question and only some have answered. Wait. Say nothing.
  - Your last message is still the most recent thing anyone is reacting to.
  - A student is visibly mid-thought.

SPEAK only when one of these is true:
  - A go-around you opened is complete - every named person has answered.
  - WHERE THE TURN STANDS says the room has gone quiet. Then you must speak.
  - Someone addresses you directly, or asks a factual question about the case.
  - The group is about to lock a decision without having pooled.

NEVER:
  - Acknowledge contributions one at a time. "Thanks Wei. Good, Priya. And
    Marco?" is the single most robotic thing you can do. If you opened a
    go-around, absorb all the answers and respond ONCE, to the pattern across
    them - not to each person as they arrive.
  - Post twice in a row.
  - Recap what was just said before asking your next question. They were
    there. Go straight to the question.
  - Praise each answer. Silence is a stronger signal that you are listening
    than acknowledgement is.
  - Turn this into an inventory exercise. Counting is the smallest part of it.
    What they PREDICT, and what they conclude when a prediction turns out
    wrong, is the exercise.

ADDRESSING THE ROOM:
  - Questions to everyone: "you three", "the group", no names.
  - Opening a go-around: name the order once, then be quiet until it finishes.
  - Use one person's name only when you want that person and nobody else.
  - Bringing in a quiet student: once, by name, lightly. Do not chase.

YOU ARE ASKED AFTER EVERY SINGLE STUDENT MESSAGE.
  Being asked is not a cue to speak - it is the room checking whether you have
  anything. Most of the time you do not. Reply with exactly the single word
  SILENT and nothing else, and no message is posted. A good session has far more
  SILENT than speech.




# VOICE
Warm, curious, direct. Genuinely interested rather than performing interest.
Comfortable with silence and with being disagreed with. Never congratulatory -
"that's the sentence" or "say more" beats praise. Dry humour is fine. No
emoji, no exclamation marks, no bullet-point lectures. Never break character to
explain that you are running an exercise.

Short questions. Most of yours should be a single sentence. A bare "Jet Li?" or
"Say both numbers." is a perfectly good turn when the group is mid-count.
Use names constantly - "Priya, why better?" not "why does someone think better?"
Ask for straight yes/no calls, rankings and predictions. They are far easier to
  answer than an open question, everyone answers them, and they force a position
  you can then put to the rest of the room. Never ask them to rate how they feel
  about something - a number about a feeling goes nowhere.

# ENDING
The session ends at step 13 and nowhere earlier: every option pooled, tallies
said aloud, the mechanism named in their own words, and a numbered procedure
written down that they could hand to another team. Do not summarize the lesson.
"""

# The one placeholder a professor's override cannot drop. Without it the facilitator
# runs blind — no tally, no roles, no outcomes — and every answer it gives is invented.
# The other three degrade into a vaguer but still functional prompt.
REQUIRED_PLACEHOLDER = "<<CASE_PACK>>"


def validate_prompt_override(text):
    """Return an error string for an unusable prompt override, or "" if it is fine.

    Called at config-save time so a professor finds out in the wizard rather than
    mid-class. Blank is valid and means "use the stock prompt".
    """
    body = (text or "").strip()
    if not body:
        return ""
    if REQUIRED_PLACEHOLDER not in body:
        return (
            f"The facilitator prompt must contain {REQUIRED_PLACEHOLDER} — without it the "
            "facilitator never sees the case and will make its answers up."
        )
    return ""


def render_roster(roster, group_size):
    """Render the live participant list for the THE ROOM block.

    Reports who is ACTUALLY present, not the configured group size. Those differ
    while people are still arriving, and a facilitator that says "three capable
    people" to a room holding one is talking about students who aren't there.
    """
    entries = [e for e in (roster or []) if (e or {}).get("name")]
    if not entries:
        return (
            "Nobody has been identified in this room yet. Address the group as a whole, "
            "never by name, and do not state how many people are present."
        )
    lines = [f"{len(entries)} student(s) are in this discussion:"]
    # M13: the first entry is the student who entered the hire for the group — the
    # roster is held in join order and the decider is whoever sat down first. Marked
    # here rather than passed in separately, so every caller gets it for free.
    lines.extend(
        f"  - {e['name']}" + ("   <- entered the hire for the group" if i == 0 else "")
        for i, e in enumerate(entries)
    )
    if group_size and len(entries) < group_size:
        lines.append(
            f"(the exercise is configured for {group_size}; the rest have not arrived. "
            "Work with who is here and do not refer to the absent ones.)"
        )
    return "\n".join(lines)


def render_turn_brief(ctx):
    """Render `ExerciseState.turn_context()` as the WHERE THE TURN STANDS block.

    These facts used to be gates. Stating them instead lets ACTR hold when a
    go-around is mid-flight and step in when one has plainly been abandoned —
    a distinction a blocking gate could only make with a timeout.
    """
    if not ctx:
        return "(nothing yet)"

    lines = []
    if ctx.get("silence"):
        lines.append(
            "- THE ROOM HAS GONE QUIET. A student spoke and nobody has followed for "
            "several seconds. Speak — this pause is now awkward and it is yours to break."
        )
    if ctx.get("addressed"):
        lines.append("- Someone has just addressed you by name. Answer them.")

    if ctx.get("go_around_open"):
        outstanding = ctx.get("outstanding") or []
        answered = ctx.get("answered") or []
        if outstanding:
            lines.append(
                f"- You asked everyone for an item. Still to answer: "
                f"{', '.join(outstanding)}. Already in: {', '.join(answered) or 'nobody'}."
            )
            lines.append(
                "  Normally: stay SILENT until they are all in. Speak anyway only if the "
                "room has clearly moved past it and waiting would stall the session — and "
                "then work with what you have without naming who is missing."
            )
        else:
            lines.append("- Everyone you asked has now answered. This is your moment to speak.")
    else:
        lines.append("- No go-around is open.")

    since = ctx.get("msgs_since_facilitator")
    lines.append(f"- Student messages since you last spoke: {since}.")
    if since == 0:
        lines.append("  You spoke most recently and nobody has replied yet. Stay SILENT.")

    quiet = ctx.get("seconds_since_last_message")
    if quiet is not None:
        lines.append(f"- Seconds since the last message: {quiet}.")
    return "\n".join(lines)


# How alike two ACTR turns must be to count as the same question asked twice. Jaccard
# over word sets — the same measure the case pack uses to pair rewordings. 0.5 catches a
# question re-asked behind a new preamble ("So X and Y — one concern or two?" vs "One
# concern or two — before we move on?") while leaving two genuinely different questions
# about the same candidate below the line. Overlap coefficient, NOT the case pack's
# Jaccard: a loop tightens as it goes, and the fourth ask is the shortest. Jaccard
# divides by the union, so the short restatement scored *lower* against the long
# original than the middle repeats did — it went quiet exactly where the loop was worst.
REPEAT_SIMILARITY = 0.6

# Below this many content words a question is too short to compare by overlap — a
# one-word set matching once scores 1.0 against anything. Short turns fall through to
# the verbatim list, which needs no threshold.
REPEAT_MIN_TOKENS = 4

# Dropped before comparing: they carry no topic and dominate short questions.
_REPEAT_STOPWORDS = frozenset(
    "a an and are as at be but by can could did do does for from had has have how in is "
    "it its of on or so that the them they this those to was were what when which who "
    "why with you your we us our i me my he she his her him not no yes if then than "
    "there here about before after again still just now".split()
)


def _repeat_tokens(text, drop=frozenset()):
    """Content-word set for repeat comparison: normalized, de-pluralized, stopped.

    Trailing-s stripping is what lets "one concern or two" match "two separate
    concerns" — the loop's own rephrasings differed by inflection as often as by
    wording. `drop` carries the roster's names: ACTR addresses people by name, so two
    unrelated go-arounds put to the same students otherwise overlap on the names alone
    and score as a repeat.
    """
    words = case_pack_mod._norm(text).split()
    return {
        (w[:-1] if len(w) > 3 and w.endswith("s") else w)
        for w in words
        if w not in _REPEAT_STOPWORDS and w not in drop
    }


def render_repeat_guard(recent_asks, names=None, go_around_open=False):
    """Show ACTR its own recent turns, and escalate when the latest repeats one.

    Two layers, because either alone was shown to fail. ACTR's own messages are
    already in the transcript it reads, but seeing them chronologically is not the
    same as being told they are repeats — in an observed room it asked one question
    four times across turns it could fully see. So the recent turns are ALWAYS listed
    under a heading that names the rule. On top of that, a mechanical overlap check
    escalates to a hard directive when the latest turn measurably restates an earlier
    one; when the measure misses a rephrasing, the verbatim list still does the work.

    The escalation is suppressed while a go-around is open. Putting the same question
    to the people who have not answered yet is how a go-around COMPLETES, and the turn
    brief already governs that — calling it a loop would break the legitimate case to
    fix the broken one.

    `recent_asks` is ACTR's own recent messages, oldest first; `names` the roster's
    display names. Returns "" when there is nothing worth showing, so the caller can
    drop the block entirely.
    """
    asks = [a.strip() for a in (recent_asks or []) if (a or "").strip()]
    if len(asks) < 2:
        return ""

    drop = {
        w
        for n in (names or [])
        for w in case_pack_mod._norm(n or "").split()
    }

    lines = [
        "TURNS YOU HAVE ALREADY TAKEN (most recent last). If the message you are about "
        "to write asks any of these again — in any wording — you are looping. Ask "
        "something else or move to the next step:"
    ]
    lines += [f"  - \"{a[:240]}\"" for a in asks]

    latest = _repeat_tokens(asks[-1], drop)
    repeats = 0
    if not go_around_open and len(latest) >= REPEAT_MIN_TOKENS:
        for prior in asks[:-1]:
            prior_tokens = _repeat_tokens(prior, drop)
            if len(prior_tokens) < REPEAT_MIN_TOKENS:
                continue
            shared = len(latest & prior_tokens)
            if shared / min(len(latest), len(prior_tokens)) >= REPEAT_SIMILARITY:
                repeats += 1

    if repeats:
        lines.append(
            f"\nYOU HAVE ALREADY ASKED THIS. Your last turn restates {repeats} of the "
            "above. It has not landed, and asking it again will not make it land. Do NOT "
            "ask it again and do NOT rephrase it. Take what the group has actually put on "
            "the table, say what that tells you, and move to the next step of the sequence."
        )
    return "\n".join(lines)


def build_facilitator_system(config, roster, group_size):
    """Assemble the facilitator system prompt for one room.

    `config` is the `manager_exercise` sub-object. Everything case-specific enters
    through the rendered case pack and the professor's learning points; the prompt
    body itself is never rewritten per case — but a professor may replace it
    wholesale via `facilitator_prompt_override`, which is substituted identically.

    Nothing here changes between messages in the same room — the per-turn brief
    goes in the user message instead — so the whole thing is one stable, cacheable
    prefix. That matters now that ACTR is asked after every single message.
    """
    cfg = config or {}
    body = (cfg.get("facilitator_prompt_override") or "").strip() or FACILITATOR_PROMPT
    pack_text = case_pack_mod.render_case_pack(cfg.get("case_pack"))

    objectives = (cfg.get("learning_points") or "").strip()
    outcome = (cfg.get("learning_outcome") or "").strip()
    if outcome:
        objectives = (objectives + "\n\nTHIS EXERCISE'S STATED OUTCOME:\n" + outcome).strip()
    if not objectives:
        objectives = (
            "No explicit objectives were configured. Default to the general lesson of a "
            "hidden-profile task: unique information goes unshared, and repeated concerns "
            "get over-weighted."
        )

    return (
        body
        .replace("<<ROSTER>>", render_roster(roster, group_size))
        .replace("<<CASE_PACK>>", pack_text)
        .replace("<<LEARNING_OBJECTIVES>>", objectives)
        .replace("<<GROUP_SIZE>>", str(group_size))
    )
