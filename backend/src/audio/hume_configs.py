# @language  Python
# @updated   2026-09-28
# @changed   A bot whose stored Hume config 404s (deleted, or from another Hume account) now gets a fresh
#            config instead of a save warning; a missing HUME_CONFIG_ID template reports which .env
#            setting to check; env values tolerate surrounding quotes.
#            Prior: New module. Per-bot Hume EVI configs, created and re-versioned from Actr so a professor
#            picks a voice in the bot form instead of building a config on platform.hume.ai and
#            pasting its id. Also serves the voice library and short spoken previews for the picker.
"""
Per-bot Hume EVI configs.

Every Audio Call bot gets its own EVI config on Hume, created the first time the
bot is saved with a voice and re-versioned whenever that voice changes. The bot
document keeps two fields:

  hume_voice      {"id", "name", "provider"} — what the professor picked
  hume_config_id  the EVI config the call connects with

A new config is a COPY of the server's shared `HUME_CONFIG_ID` config with only
the voice swapped. That copy is the point: the shared config carries the custom
language model URL (our `/api/audio/clm/chat/completions` bridge — without it
Hume answers with its own model and the bot's persona is gone), plus the
timeouts and turn-taking settings calls were tuned on. Change those on the
shared config and new bots inherit them; existing bots keep what they were
created with until their voice is next changed.

`HUME_CONFIG_ID` stays the fallback for any bot with no config of its own.
"""
import logging
import os
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

import requests

logger = logging.getLogger(__name__)

HUME_API = "https://api.hume.ai/v0"
TIMEOUT_SECS = 15

# Fields copied from the shared config onto a new one. Everything that shapes a
# call except the voice (swapped) and the name (per bot). `prompt` is left out
# on purpose: the CLM bridge builds the system prompt from the bot itself.
_CLONED_FIELDS = (
    "evi_version", "language_model", "ellm_model", "event_messages", "timeouts",
    "nudges", "turn_detection", "interruption", "tools", "builtin_tools", "webhooks",
)

VOICE_PROVIDERS = ("HUME_AI", "CUSTOM_VOICE")

# What a voice says when previewed. Fixed server-side so the preview endpoint
# cannot be used as a free text-to-speech service.
PREVIEW_TEXT = "Hi there, thanks for joining the call. This is what I'll sound like when we talk."

_VOICES_TTL_SECS = 3600
_voices_cache: Dict[str, Any] = {"at": 0.0, "voices": []}
_PREVIEW_CACHE_MAX = 200
_preview_cache: Dict[str, bytes] = {}
_lock = threading.Lock()


class HumeError(Exception):
    """A Hume API call failed. The message is safe to show a professor.

    `status` is Hume's HTTP status when it answered, so callers can tell a
    missing config (404) from an outage.
    """

    def __init__(self, message: str, status: Optional[int] = None):
        super().__init__(message)
        self.status = status


def _env(name: str) -> str:
    # Tolerate quotes left around a value by whatever loaded the .env file.
    return (os.getenv(name) or "").strip().strip('"\'').strip()


def _headers() -> Dict[str, str]:
    api_key = os.getenv("HUME_API_KEY")
    if not api_key:
        raise HumeError("Hume is not configured on this server")
    return {"X-Hume-Api-Key": api_key, "Content-Type": "application/json"}


def _request(method: str, path: str, **kwargs) -> requests.Response:
    try:
        resp = requests.request(method, f"{HUME_API}{path}", headers=_headers(),
                                timeout=TIMEOUT_SECS, **kwargs)
    except requests.RequestException as e:
        logger.error("Hume %s %s failed: %s", method, path, e)
        raise HumeError("Could not reach Hume") from e
    if resp.status_code >= 400:
        logger.error("Hume %s %s -> %s: %s", method, path, resp.status_code, resp.text[:500])
        raise HumeError(f"Hume rejected the request ({resp.status_code})", resp.status_code)
    return resp


# --- Voice library ---------------------------------------------------------

def _voice_summary(v: Dict[str, Any]) -> Dict[str, Any]:
    tags = v.get("tags") or {}
    first = lambda key: (tags.get(key) or [None])[0]
    return {
        "id": v.get("id"),
        "name": v.get("name"),
        "provider": v.get("provider"),
        "gender": first("GENDER"),
        "age": first("AGE"),
        "language": first("LANGUAGE"),
        # Most voices carry a broad accent then a narrower one ("American",
        # "Southern", "Texas"); the picker shows them all.
        "accents": tags.get("ACCENT") or [],
    }


def list_voices() -> List[Dict[str, Any]]:
    """Hume's shared voice library plus this account's custom voices, cached for an hour."""
    with _lock:
        if _voices_cache["voices"] and time.time() - _voices_cache["at"] < _VOICES_TTL_SECS:
            return _voices_cache["voices"]

    voices: List[Dict[str, Any]] = []
    for provider in VOICE_PROVIDERS:
        page = 0
        while True:
            data = _request("GET", "/tts/voices", params={
                "provider": provider, "page_size": 100, "page_number": page,
            }).json()
            voices.extend(_voice_summary(v) for v in data.get("voices_page") or [])
            page += 1
            if page >= (data.get("total_pages") or 0):
                break

    # Custom voices first — an account that made its own voice most likely wants it —
    # then English ones, since that is the language the bots speak.
    voices.sort(key=lambda v: (v["provider"] != "CUSTOM_VOICE", v["language"] != "English",
                               (v["name"] or "").lower()))
    with _lock:
        _voices_cache.update(at=time.time(), voices=voices)
    return voices


def find_voice(voice_id: str, provider: str) -> Optional[Dict[str, Any]]:
    return next((v for v in list_voices()
                 if v["id"] == voice_id and v["provider"] == provider), None)


def preview_voice(voice_id: str, provider: str) -> bytes:
    """A few seconds of the voice reading PREVIEW_TEXT, as mp3. Cached per voice."""
    key = f"{provider}:{voice_id}"
    with _lock:
        if key in _preview_cache:
            return _preview_cache[key]

    audio = _request("POST", "/tts/file", json={
        "utterances": [{"text": PREVIEW_TEXT, "voice": {"id": voice_id, "provider": provider}}],
        "format": {"type": "mp3"},
    }).content

    with _lock:
        if len(_preview_cache) >= _PREVIEW_CACHE_MAX:
            _preview_cache.pop(next(iter(_preview_cache)))
        _preview_cache[key] = audio
    return audio


def normalize_voice(raw: Any) -> Optional[Dict[str, str]]:
    """Validate a picked voice against the library. None when absent or unknown."""
    if not isinstance(raw, dict):
        return None
    voice_id = str(raw.get("id") or "").strip()
    provider = str(raw.get("provider") or "HUME_AI").strip()
    if not voice_id or provider not in VOICE_PROVIDERS:
        return None
    match = find_voice(voice_id, provider)
    if not match:
        return None
    return {"id": match["id"], "name": match["name"], "provider": match["provider"]}


# --- EVI configs -----------------------------------------------------------

def _latest_version(config_id: str) -> Dict[str, Any]:
    data = _request("GET", f"/evi/configs/{config_id}", params={
        "page_size": 1, "restrict_to_most_recent": "true",
    }).json()
    page = data.get("configs_page") or []
    if not page:
        raise HumeError("Hume config not found", 404)
    return page[0]


def _settings_from(config: Dict[str, Any], voice: Dict[str, str]) -> Dict[str, Any]:
    body = {k: config[k] for k in _CLONED_FIELDS if config.get(k) is not None}
    body["voice"] = {"id": voice["id"], "provider": voice["provider"]}
    return body


def _config_name(bot_name: str, bot_id: str) -> str:
    # Hume config names are per account and shown in its dashboard; the bot id
    # keeps them unique and traceable back to the bot.
    label = " ".join((bot_name or "bot").split())[:60]
    return f"Actr · {label} · {bot_id}"


def create_config(bot_name: str, bot_id: str, voice: Dict[str, str]) -> str:
    """New EVI config for a bot: the shared config with `voice` swapped in. Returns its id."""
    base_id = _env("HUME_CONFIG_ID")
    if not base_id:
        raise HumeError("HUME_CONFIG_ID is not set on this server")
    try:
        base = _latest_version(base_id)
    except HumeError as e:
        if e.status != 404:
            raise
        # The key works (voices load) but the template config is not on its
        # account — a server .env problem, so say which setting to check.
        raise HumeError(f"the server's HUME_CONFIG_ID ({base_id}) was not found on this "
                        "Hume account — check HUME_CONFIG_ID and HUME_API_KEY in backend/.env", 404)
    body = _settings_from(base, voice)
    body["name"] = _config_name(bot_name, bot_id)
    created = _request("POST", "/evi/configs", json=body).json()
    logger.info("Hume config created | bot=%s hume=%s voice=%s", bot_id, created.get("id"), voice["name"])
    return created["id"]


def set_config_voice(config_id: str, voice: Dict[str, str]) -> None:
    """Save a new version of an existing config with a different voice.

    Hume versions configs rather than editing them; a call that connects without
    a version gets the latest, so the new voice applies from the next call on.
    """
    body = _settings_from(_latest_version(config_id), voice)
    body["version_description"] = f"Voice changed to {voice['name']} from Actr"
    _request("POST", f"/evi/configs/{config_id}", json=body)
    logger.info("Hume config re-versioned | hume=%s voice=%s", config_id, voice["name"])


def sync_bot_voice(bot: Dict[str, Any], bot_id: str, voice: Optional[Dict[str, str]]) -> Tuple[Dict[str, Any], Optional[str]]:
    """Bring a bot's Hume config in line with the voice picked for it.

    Returns `(fields_to_set, warning)`. `fields_to_set` is empty when nothing
    changed. A Hume failure never blocks saving the bot — the warning says the
    voice did not apply, and calls keep using whatever config they had.
    """
    if not voice:
        return {}, None
    existing_id = (bot.get("hume_config_id") or "").strip()
    # A bot that had the shared config pasted in by hand must not re-version it —
    # that would change the voice of every bot falling back to it.
    if existing_id == _env("HUME_CONFIG_ID"):
        existing_id = ""
    current = bot.get("hume_voice") or {}
    if existing_id and current.get("id") == voice["id"] and current.get("provider") == voice["provider"]:
        return {}, None
    try:
        if existing_id:
            try:
                set_config_voice(existing_id, voice)
                return {"hume_voice": voice}, None
            except HumeError as e:
                if e.status != 404:
                    raise
                # The stored config is gone from this Hume account (deleted, or
                # pasted in from another account) — replace it with a fresh one.
                logger.warning("Bot %s: Hume config %s not found, creating a new one", bot_id, existing_id)
        new_id = create_config(bot.get("bot_name") or "", bot_id, voice)
        return {"hume_voice": voice, "hume_config_id": new_id}, None
    except (HumeError, KeyError) as e:
        logger.error("Voice sync failed for bot %s: %s", bot_id, e)
        return {}, f"The bot was saved, but its voice could not be set on Hume: {e}"
