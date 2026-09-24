"""Per-bot response delay configuration and streaming wrapper."""

import json
import random
import time


DEFAULT_RESPONSE_DELAY = {
    "enabled": False,
    "mode": "length_based",
    "min_seconds": 5.0,
    "max_seconds": 20.0,
    "chars_per_second": 40.0,
}


def normalize_response_delay(value):
    """Return a safe, bounded response-delay configuration."""
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, ValueError):
            value = {}
    if not isinstance(value, dict):
        value = {}

    def number(name, default, minimum, maximum):
        try:
            parsed = float(value.get(name, default))
        except (TypeError, ValueError):
            parsed = default
        return max(minimum, min(parsed, maximum))

    minimum = number("min_seconds", 5.0, 0.0, 60.0)
    maximum = number("max_seconds", 20.0, minimum, 60.0)
    mode = value.get("mode", "length_based")
    if mode not in {"fixed", "random", "length_based"}:
        mode = "length_based"

    return {
        "enabled": bool(value.get("enabled", False)),
        "mode": mode,
        "min_seconds": minimum,
        "max_seconds": maximum,
        "chars_per_second": number("chars_per_second", 40.0, 1.0, 1000.0),
    }


def calculate_response_delay(config, response_text, random_uniform=random.uniform):
    """Calculate the configured delay for one completed assistant response."""
    config = normalize_response_delay(config)
    if not config["enabled"] or not response_text:
        return 0.0
    if config["mode"] == "fixed":
        return config["min_seconds"]
    if config["mode"] == "random":
        return random_uniform(config["min_seconds"], config["max_seconds"])

    delay = config["min_seconds"] + len(response_text) / config["chars_per_second"]
    return min(delay, config["max_seconds"])


def delay_ndjson_stream(stream, config, sleep=time.sleep):
    """Delay reply content, while forwarding progress and failures immediately.

    Producers emit complete NDJSON records. Content-bearing widgets stay with
    their surrounding tokens to preserve the frontend's inline render order.
    Completion is deferred too, so clients cannot finish before the reply.
    """
    config = normalize_response_delay(config)
    if not config["enabled"]:
        yield from stream
        return

    yield json.dumps({"type": "delay_pending"}) + "\n"
    buffered = []
    response_parts = []
    try:
        for chunk in stream:
            for line in chunk.splitlines():
                if not line.strip():
                    continue
                record = line + "\n"
                event = json.loads(line)
                event_type = event.get("type")
                if event_type == "error":
                    yield record
                    return  # Do not reveal a failed partial reply or sleep.
                if event_type in {"token", "facilitator", "done"}:
                    buffered.append(record)
                    if event_type == "token" and event.get("data"):
                        response_parts.append(str(event["data"]))
                else:
                    yield record

        delay = calculate_response_delay(config, "".join(response_parts))
        if delay:
            sleep(delay)
        yield from buffered
    finally:
        close = getattr(stream, "close", None)
        if close:
            close()
