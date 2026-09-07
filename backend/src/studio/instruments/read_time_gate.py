# @language  Python
# @updated   2026-09-07
# @changed   New file: the Read-Time Gate instrument — a behavior instrument (changes what the
#            respondent can do, doesn't measure anything). Blocks Submit until `seconds` have
#            elapsed since the block was shown; entirely enforced client-side (StudioRunnerPage),
#            since there's nothing meaningful to compute server-side after the fact — a forged
#            client only fools the respondent's own data, same reasoning as the events trust note
#            in routes/studio_routes.py's submit_response.
#            `needs_events=True` even with no compute(): the runner needs a block's "shown"
#            timestamp locally to gate Submit, and that's the same tracking mechanism a
#            server-computed metric would use — needs_events means "track it," not "compute() uses it."
"""Read-Time Gate — the respondent must remain on the page `seconds` before submitting."""
from src.studio.instruments.base import instrument

DEFAULT_SECONDS = 5
MIN_SECONDS = 1
MAX_SECONDS = 120


@instrument(
    instrument_type="read_time_gate",
    label="Read-Time Gate",
    icon="hourglass",
    kind="behavior",
    default_config={"seconds": DEFAULT_SECONDS},
    applies_to=None,
    needs_events=True,
)
def validate(config):
    try:
        seconds = int(config.get("seconds", DEFAULT_SECONDS))
    except (TypeError, ValueError):
        seconds = DEFAULT_SECONDS
    return {"seconds": min(max(seconds, MIN_SECONDS), MAX_SECONDS)}
