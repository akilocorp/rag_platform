# @language  Python
# @updated   2026-09-07
# @changed   New file: the Instructions block — plain content, not a question. Deliberately has
#            no `required` key: routes/studio_routes.py's response validation uses the presence
#            of `required` in a block's config as the signal for "this block expects an answer,"
#            so a rich_text block is automatically skipped rather than needing a special case.
"""Instructions — plain text content shown between/around questions. Captures no response."""
from src.studio.blocks.base import block


@block(
    block_type="rich_text",
    label="Instructions",
    icon="align-left",
    default_config={"content": "Add instructions or context here."},
)
def validate(config):
    return {
        "content": str(config.get("content") or ""),
    }
