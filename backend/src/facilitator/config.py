"""
Normalizer for the per-bot `facilitator` config block, shared by the create and
edit routes so the persisted shape is consistent regardless of entry point.

Shape: { enabled: bool, instruction: str, allowedWidgets: [str] | None, presets: [dict] }
"""
import json


def normalize_config(raw):
    """Coerce a raw facilitator value (dict, JSON string, or missing) into the
    canonical persisted shape. Always returns a dict — a disabled block by default."""
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except (ValueError, TypeError):
            raw = None
    if not isinstance(raw, dict):
        return {"enabled": False, "instruction": "", "allowedWidgets": None, "presets": []}

    instruction = raw.get("instruction")
    allowed = raw.get("allowedWidgets")
    presets = raw.get("presets")
    return {
        "enabled": bool(raw.get("enabled")),
        "instruction": instruction.strip() if isinstance(instruction, str) else "",
        "allowedWidgets": [str(w) for w in allowed if str(w).strip()] if isinstance(allowed, list) else None,
        "presets": [p for p in presets if isinstance(p, dict)] if isinstance(presets, list) else [],
    }
