# @language  Python
# @updated   2026-08-07
# @changed   New module. `accepts_temperature` gates the sampling parameter that the newest Anthropic
#            models reject outright, so adding one to the config picker cannot 400 every chat.
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
