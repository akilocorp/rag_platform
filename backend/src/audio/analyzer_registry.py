"""
Audio analyzer plugin registry.

Drop a module that calls `@analyzer("name")` on a function with signature
    (audio_bytes: bytes | None, transcript: str) -> dict
and `run_all(...)` will fan out to it after every audio turn. Errors in any
single analyzer are logged and swallowed — the rest of the registry still
runs and gets persisted into `audio_sessions.analyzer_results[name]`.

Note: Hume EVI prosody scores are NOT routed through here. Those are first
class fields on the audio session doc. This registry is for *future* analyzers
(confidence, fear, sentiment, tonality, etc.).
"""
import logging
from typing import Any, Callable, Dict, Optional

logger = logging.getLogger(__name__)

# name -> callable
ANALYZERS: Dict[str, Callable[[Optional[bytes], str], Dict[str, Any]]] = {}


def analyzer(name: str):
    """Register a function as an audio analyzer plugin."""
    def wrap(fn: Callable[[Optional[bytes], str], Dict[str, Any]]):
        if name in ANALYZERS:
            raise ValueError(
                f"Analyzer name collision: '{name}' is already registered by "
                f"{ANALYZERS[name].__module__}"
            )
        ANALYZERS[name] = fn
        return fn
    return wrap


def run_all(audio_bytes: Optional[bytes], transcript: str) -> Dict[str, Dict[str, Any]]:
    """Run every registered analyzer and return {name: result}.

    Per-analyzer exceptions are logged and skipped — they don't kill the turn
    persistence flow.
    """
    results: Dict[str, Dict[str, Any]] = {}
    for name, fn in ANALYZERS.items():
        try:
            out = fn(audio_bytes, transcript)
            if isinstance(out, dict):
                results[name] = out
        except Exception as e:
            logger.error("Analyzer %r failed: %s", name, e, exc_info=True)
    return results
