# @language  Python
# @updated   2026-09-08
# @changed   New file: the Piped Text instrument — Qualtrics' Piped Text. Pulls another block's
#            live answer into this block's own question text at render time. Entirely resolved
#            client-side (StudioRunnerPage's applyBehaviorInstruments, using already-loaded
#            `answers` state) — there's nothing to validate or compute server-side beyond which
#            block it points at, so no compute().
"""Piped Text — prefixes a block's question with another block's live answer."""
from src.studio.instruments.base import instrument


@instrument(
    instrument_type="piped_text",
    label="Piped Text",
    icon="link",
    kind="behavior",
    default_config={"source_block_id": ""},
    applies_to=None,
    needs_events=False,
)
def validate(config):
    return {"source_block_id": str(config.get("source_block_id") or "")}
