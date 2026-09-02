# @language  Python
# @updated   2026-09-02
# @changed   `sampling_kwargs` joins `accepts_temperature`. anthropic 1.x removed `temperature` from the
#            SDK method signatures outright, so passing it is now a TypeError on EVERY model rather than
#            a 400 on the newest ones — two different rules with one answer, which belongs in one place.
#            Prior: New module. `accepts_temperature` gates the sampling parameter that the newest
#            Anthropic models reject outright, so adding one to the config picker cannot 400 every chat.
"""Per-model capability checks shared by the chat paths.

Both routes that build a Claude client pass `temperature` unconditionally —
`chat_routes.py` (LangChain) and `agentic/agent_runner.py` (raw SDK). Anthropic
removed the sampling parameters on its newest models: `temperature`, `top_p`, and
`top_k` are no longer accepted and a request carrying one is rejected with a 400.

That turns a config-picker addition into an outage: a professor selects the model,
the config saves fine, and every message fails at request time. So the check lives
here rather than inline at either call site — one list, two importers, no drift.
"""

# Anthropic model families that reject `temperature`. Matched as a prefix against a
# lowercased model id, so a dated snapshot (`claude-opus-5-20260115`) is covered by
# the same entry as the bare alias. Sonnet 4.6 and Haiku 4.5 still accept it and are
# deliberately absent.
_NO_SAMPLING_PARAMS = (
    "claude-opus-5",
    "claude-opus-4-7",
    "claude-opus-4-8",
    "claude-sonnet-5",
    "claude-fable-5",
    "claude-mythos-5",
)


def accepts_temperature(model_name):
    """False when passing `temperature` to this model would be rejected.

    Unknown and non-Claude models return True — the caller's existing behaviour is
    the default, and this only ever removes a parameter we know is refused.
    """
    m = (model_name or "").strip().lower()
    return not m.startswith(_NO_SAMPLING_PARAMS)


def sampling_kwargs(model_name, temperature):
    """`temperature` as request kwargs for a raw-SDK call — `{}` when it must not be sent.

    Two separate rules meet here and both say "not as a keyword argument".

    The model may refuse it: the families in `_NO_SAMPLING_PARAMS` return a 400 for any
    request carrying `temperature`, which is what `accepts_temperature` decides.

    And the SDK no longer takes it: anthropic 1.x dropped `temperature` from
    `messages.create()` / `.stream()` / `.parse()`, so passing it raises TypeError on
    every model, the accepting ones included. That is not a 400 the caller can see — it
    is an exception thrown before any request is sent, and every call site here catches
    broadly, so it surfaced as a voice bot apologising and a test room where nobody
    spoke. Where the setting is still wanted it rides in `extra_body`, which the SDK
    merges into the request JSON untouched.
    """
    if temperature is None or not accepts_temperature(model_name):
        return {}
    try:
        return {"extra_body": {"temperature": float(temperature)}}
    except (TypeError, ValueError):
        return {}
