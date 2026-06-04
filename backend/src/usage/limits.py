"""Message-count usage limiting.

One "message" = one user turn that produced a model response. Counts are stored
in the `usage_counters` collection and incremented atomically so a shared class
pool stays correct when several students draw on it concurrently. Caps are read
live (from `usage_config` or the config's `usage_pool`) rather than snapshotted
on the counter, so admin re-pricing never retroactively moves a budget.
"""
import uuid
from datetime import datetime, timezone

from flask import current_app
from itsdangerous import URLSafeTimedSerializer, BadSignature
from pymongo import ReturnDocument

COUNTERS = "usage_counters"
CONFIG = "usage_config"

DEVICE_COOKIE = "dev_id"
DEVICE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365 * 5  # ~5 years (anon budget is lifetime)
_COOKIE_SALT = "device-id"

# Models a free/playground user is allowed to pick via model_override. Mirrors
# the frontend list in utils/modelNames.js + the ChatPage settings dropdown.
ALLOWED_MODELS = {
    "gpt-4o-mini", "gpt-4.1", "gpt-4-turbo", "gpt-4o", "gpt-5-nano",
    "claude-haiku-4-5-20251001", "claude-sonnet-4-6",
    "gemini-2.5-flash", "gemini-2.5-pro", "deepseek-chat",
}

DEFAULT_SETTINGS = {
    "_id": "settings",
    "anon_lifetime_cap": 10,
    "student_default_cap": 100,
    "professor_default_cap": 2000,
    "warn_threshold": 0.8,
    "tiers": [
        {"id": "small", "name": "Small (50 / student)", "messages_per_student": 50},
        {"id": "standard", "name": "Standard (150 / student)", "messages_per_student": 150},
        {"id": "large", "name": "Large (400 / student)", "messages_per_student": 400},
    ],
}


def _db():
    return current_app.config["MONGO_DB"]


# --- settings -------------------------------------------------------------

def get_settings():
    """Returns the singleton settings doc, seeding defaults on first read."""
    col = _db()[CONFIG]
    doc = col.find_one({"_id": "settings"})
    if not doc:
        col.update_one({"_id": "settings"}, {"$setOnInsert": DEFAULT_SETTINGS}, upsert=True)
        doc = col.find_one({"_id": "settings"})
    return doc


# --- identity helpers -----------------------------------------------------

def _serializer():
    return URLSafeTimedSerializer(current_app.config["SECRET_KEY"], salt=_COOKIE_SALT)


def get_or_set_device_id(request):
    """Returns (device_id, signed_cookie_value_or_None).

    A non-None second element means the caller must Set-Cookie it on the
    response (new device, or an invalid/forged cookie was replaced).
    """
    raw = request.cookies.get(DEVICE_COOKIE)
    if raw:
        try:
            return _serializer().loads(raw), None
        except BadSignature:
            pass
    device_id = uuid.uuid4().hex
    return device_id, _serializer().dumps(device_id)


def client_ip(request):
    """Real client IP. Prefers X-Forwarded-For first hop (set by nginx); falls
    back to remote_addr (which is also correct once ProxyFix is applied)."""
    xff = request.headers.get("X-Forwarded-For", "")
    if xff:
        first = xff.split(",")[0].strip()
        if first:
            return first
    return request.remote_addr or "unknown"


# --- identity resolution --------------------------------------------------

class Identity:
    """Which metered population a request belongs to + the counters to charge.

    entries is a list of (scope, key, cap) tuples. Anon has two (ip + device);
    everything else has one. An empty list means exempt (admins, owners).
    """

    def __init__(self, population, entries, cta=None):
        self.population = population
        self.entries = entries
        self.cta = cta


def resolve_identity(config_doc, user, ip, device_id):
    settings = get_settings()

    if user is None:
        cap = int(settings.get("anon_lifetime_cap", 10))
        return Identity(
            "anon",
            [("anon_ip", ip, cap), ("anon_device", device_id, cap)],
            cta="create_account",
        )

    role = user.get("role", "professor")
    if role == "admin":
        return Identity("exempt", [])

    class_code = config_doc.get("class_code")
    usage_pool = config_doc.get("usage_pool")
    enrolled = bool(class_code) and class_code in (user.get("classes") or [])
    if class_code and usage_pool is not None and enrolled:
        return Identity(
            "class_pool",
            [("class_pool", str(config_doc.get("_id")), int(usage_pool))],
            cta="contact_professor",
        )

    if role == "student":
        cap = int(settings.get("student_default_cap", 100))
        return Identity("student", [("student", str(user["_id"]), cap)], cta="create_account")

    if role == "professor":
        cap = int(settings.get("professor_default_cap", 2000))
        return Identity("professor", [("professor", str(user["_id"]), cap)], cta="generic")

    return Identity("exempt", [])


# --- counters -------------------------------------------------------------

def _read_count(scope, key):
    doc = _db()[COUNTERS].find_one({"scope": scope, "key": key}, {"count": 1})
    return int(doc["count"]) if doc and "count" in doc else 0


def _summarize(identity, counts):
    """counts: list of (cap, count). Returns the aggregated status payload."""
    if not identity.entries:
        return {"status": "ok", "remaining": None, "cap": None,
                "population": identity.population, "cta": identity.cta}
    threshold = float(get_settings().get("warn_threshold", 0.8))
    status = "ok"
    min_remaining = None
    cap_for_min = None
    for cap, count in counts:
        cap = int(cap)
        remaining = max(0, cap - count)
        if min_remaining is None or remaining < min_remaining:
            min_remaining, cap_for_min = remaining, cap
        if remaining <= 0:
            status = "blocked"
        elif status != "blocked" and cap > 0 and count >= cap * threshold:
            status = "warn"
    return {"status": status, "remaining": min_remaining, "cap": cap_for_min,
            "population": identity.population, "cta": identity.cta}


def check(identity):
    """Read-only pre-flight. Does not increment."""
    counts = [(cap, _read_count(scope, key)) for scope, key, cap in identity.entries]
    return _summarize(identity, counts)


def consume(identity, n=1):
    """Atomically charge n messages to every entry and return the new status."""
    if not identity.entries:
        return _summarize(identity, [])
    now = datetime.now(timezone.utc)
    col = _db()[COUNTERS]
    counts = []
    for scope, key, cap in identity.entries:
        doc = col.find_one_and_update(
            {"scope": scope, "key": key},
            {"$inc": {"count": n},
             "$setOnInsert": {"created_at": now},
             "$set": {"updated_at": now}},
            upsert=True,
            return_document=ReturnDocument.AFTER,
        )
        counts.append((cap, int(doc.get("count", n))))
    return _summarize(identity, counts)
