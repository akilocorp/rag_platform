# @language  Python
# @updated   2026-09-08
# @changed   New file: the Voice Conversation block — the first AI-powered (`is_ai=True`) Studio
#            block. A respondent talks to the platform's existing Hume EVI voice assistant instead
#            of typing; the frontend component owns the whole response UI (a real conversation isn't
#            a small widget attached to another block, unlike an instrument's RespondExtra). v1 reuses
#            the global Hume EVI config used elsewhere in the app rather than a per-project persona —
#            see VoiceConversationBlock.jsx's header for why that's deliberately deferred.
"""Voice Conversation — the respondent has a live spoken back-and-forth with an AI voice assistant."""
from src.studio.blocks.base import block

DEFAULT_PROMPT = "Have a spoken conversation with the AI."


@block(
    block_type="voice_conversation",
    label="Voice Conversation",
    icon="microphone",
    default_config={"question": DEFAULT_PROMPT, "required": False},
    is_ai=True,
)
def validate(config):
    return {
        "question": str(config.get("question") or DEFAULT_PROMPT),
        "required": bool(config.get("required", False)),
    }
