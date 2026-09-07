# @language  Python
# @updated   2026-09-07
# @changed   New file: public registry API for Studio blocks, mirroring src/agentic/registry.py.
"""
Public registry API used by routes/studio_routes.py.

Importing this module triggers block discovery (via `blocks/__init__.py`),
which in turn imports every block file and runs its `@block` decorators.
"""
import logging
from typing import Any, Dict, List

from src.studio.blocks import base
from src.studio import blocks  # noqa: F401  side-effect: discovers all blocks

logger = logging.getLogger(__name__)


def get_block_specs() -> List[Dict[str, Any]]:
    """{type, label, icon, default_config} for every registered block — feeds the builder ribbon."""
    return [b["spec"] for b in base.BLOCKS.values()]


def validate_block_config(block_type: str, config: Dict[str, Any]) -> Dict[str, Any]:
    """Coerce/validate a block's config. Raises KeyError if block_type is unknown."""
    if block_type not in base.BLOCKS:
        raise KeyError(f"Unknown block type: {block_type}")
    return base.BLOCKS[block_type]["validate"](config or {})
