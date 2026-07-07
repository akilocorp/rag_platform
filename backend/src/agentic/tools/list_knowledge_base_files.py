"""
list_knowledge_base_files — ground-truth file count for the knowledge base.

`search_knowledge_base` only returns the top-k passages (chunks) that match a
query, so the model can't reliably answer "how many files are there?" from it —
it ends up counting chunks or only the files that happened to match. This tool
reads the `user_files` collection directly (the same source the file panel
lists) and reports exact counts for two scopes:

  - Bot knowledge files: files attached to this bot's config.
  - The user's own uploaded files/folders: their personal library.

Folders live in a separate `user_folders` collection, so they don't inflate
the file count here.
"""
from flask import current_app

from .base import tool, ToolContext

INPUT_SCHEMA = {
    "type": "object",
    "properties": {},
}


@tool(
    name="list_knowledge_base_files",
    description=(
        "Report how many files are in the knowledge base, and optionally their names. "
        "Use this — NOT search_knowledge_base — whenever the user asks how many files "
        "exist, or to list their files. It covers two groups: this bot's knowledge "
        "files and the user's own uploaded files/folders. If the user only asks for a "
        "number, give the combined total. If they ask for a breakdown, report the two "
        "groups separately."
    ),
    input_schema=INPUT_SCHEMA,
)
def list_knowledge_base_files(inputs: dict, ctx: ToolContext) -> dict:
    files_col = current_app.config['MONGO_DB']['user_files']

    config_id_str = str(ctx.config_id)
    is_authenticated = bool(ctx.user_id and ctx.user_id != "anonymous")

    # Bot knowledge files: attached to this bot's config (shared across users).
    bot_files = sorted(
        d.get('filename') or d.get('source_url') or 'unknown'
        for d in files_col.find({"config_id": config_id_str}, {"filename": 1, "source_url": 1})
    )

    # The user's own uploads: their personal library (rows with no config_id).
    if is_authenticated:
        my_files = sorted(
            d.get('filename') or d.get('source_url') or 'unknown'
            for d in files_col.find(
                {"user_id": ctx.user_id, "config_id": {"$exists": False}},
                {"filename": 1, "source_url": 1},
            )
        )
    else:
        my_files = []

    total = len(bot_files) + len(my_files)

    def _listing(names):
        if not names:
            return "  (none)"
        return "\n".join(f"  {i}. {n}" for i, n in enumerate(names, 1))

    content = (
        f"Combined total: {total} file(s).\n\n"
        f"Bot knowledge files: {len(bot_files)}\n{_listing(bot_files)}\n\n"
        f"Your uploaded files/folders: {len(my_files)}\n{_listing(my_files)}\n\n"
        "If the user only asked for a number, answer with the combined total. "
        "If they asked for a breakdown, give the two counts separately."
    )
    return {"content": content}
