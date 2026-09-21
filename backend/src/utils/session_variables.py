# @language  Python
# @updated   2026-09-18
# @changed   New module. Shared handling of per-session variables piped in from a survey —
#            sanitising the launch params, `{{placeholder}}` substitution, and the prompt
#            block that hands them to the model. Lifted out of `src/audio/voice_runner.py`
#            so the text chat and the voice chat treat them identically.
"""
Per-session variables: survey answers that reach the bot through the launch URL.

A study embeds an assistant with piped text in the iframe src —

    /chat/<config_id>?qualtricsId=${e://Field/ResponseID}
                     &top_issue=${q://QID2/ChoiceGroup/SelectedChoices}
                     &gun=${q://QID1/ChoiceGroup/SelectedAnswerRecode/1}

Qualtrics resolves `${...}` server-side, so by the time the page loads these are
ordinary query params. The frontend forwards every param it was launched with and
this module decides which are *content* (a value the persona may use) rather than
plumbing, then turns them into prompt text.

Two ways the model receives them, and both are deliberate:

  - substitution, for a professor who wrote `{{top_issue}}` into the persona;
  - a verbatim listing, for a study that passes values the professor never wrote a
    placeholder for. Without the listing, a survey could only reach a persona that
    had been written in advance to expect it.
"""

from typing import Any, Dict

# Params that steer the app rather than the persona. They arrive on the same query
# string as the survey's own fields, so they are stripped here — otherwise a
# response id lands in the prompt as if it were a study condition, and the bot has
# a chance of reading it back to the participant.
RESERVED_KEYS = {
    'qualtricsid', 'responseid',      # participant identity, already stored as qualtrics_id
    'studentemail', 'studentname',    # identity, already stored as student_email / student_label
    'chatid', 'model', 'token', 'debug',
}

# A launch URL is attacker-reachable (the participant can edit it), so the prompt's
# share of it is bounded. These caps are generous for a real study — a survey piping
# a dozen matrix rows fits comfortably — and stop a hand-edited URL from crowding out
# the professor's own instructions.
MAX_VARIABLES = 25
MAX_KEY_LENGTH = 40
MAX_VALUE_LENGTH = 400


def clean_session_variables(raw: Any) -> Dict[str, str]:
    """Filter a raw launch-param dict down to the values a persona may use.

    Drops reserved keys and empties, coerces everything to `str`, and truncates
    both sides. Anything that isn't a dict yields `{}` rather than raising — this
    runs on request input, and a malformed body should cost the turn its variables,
    not the turn itself.
    """
    if not isinstance(raw, dict):
        return {}
    cleaned: Dict[str, str] = {}
    for key, value in raw.items():
        if len(cleaned) >= MAX_VARIABLES:
            break
        key = str(key).strip()
        if not key or key.lower() in RESERVED_KEYS:
            continue
        value = str(value).strip()
        if not value:
            continue
        cleaned[key[:MAX_KEY_LENGTH]] = value[:MAX_VALUE_LENGTH]
    return cleaned


def apply_variables(text: str, variables: Dict[str, str]) -> str:
    """Substitute `{{key}}` placeholders in the persona with session variables.

    Unmatched placeholders are left exactly as written rather than blanked — a
    professor testing the link sees `{{stance}}` come back and knows the variable
    never arrived, which is far easier to diagnose than a persona that silently
    lost half its brief.
    """
    if not text or not variables:
        return text
    for key, value in variables.items():
        text = text.replace('{{' + key + '}}', str(value))
    return text


def session_variables_block(variables: Dict[str, str]) -> str:
    """The prompt section that lists this session's variables verbatim.

    Returned without surrounding whitespace so each caller can join it the way its
    own prompt is assembled. Empty string when there are no variables, so callers
    can concatenate unconditionally.
    """
    if not variables:
        return ""
    detail_lines = "\n".join(f"- {k}: {v}" for k, v in variables.items())
    return (
        "--- THIS SESSION ---\n"
        "These values were set for this specific conversation. Treat them as\n"
        "binding, and never read them out as a list or mention that you were\n"
        "given them.\n" + detail_lines
    )
