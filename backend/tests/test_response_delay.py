import json

from src.services.response_delay import (
    calculate_response_delay,
    delay_ndjson_stream,
    normalize_response_delay,
)


def test_length_based_delay_is_capped():
    config = {
        "enabled": True,
        "mode": "length_based",
        "min_seconds": 5,
        "max_seconds": 20,
        "chars_per_second": 40,
    }
    assert calculate_response_delay(config, "x" * 200) == 10
    assert calculate_response_delay(config, "x" * 1000) == 20


def test_random_delay_uses_configured_range():
    config = {
        "enabled": True,
        "mode": "random",
        "min_seconds": 5,
        "max_seconds": 20,
    }
    assert calculate_response_delay(config, "reply", lambda low, high: (low + high) / 2) == 12.5


def test_normalize_accepts_edit_form_json_and_bounds_values():
    config = normalize_response_delay(json.dumps({
        "enabled": True,
        "mode": "length_based",
        "min_seconds": -2,
        "max_seconds": 100,
        "chars_per_second": 0,
    }))
    assert config == {
        "enabled": True,
        "mode": "length_based",
        "min_seconds": 0.0,
        "max_seconds": 60.0,
        "chars_per_second": 1.0,
    }


def test_delayed_stream_buffers_tokens_and_sleeps_once():
    sleeps = []
    source = iter([
        json.dumps({"type": "token", "data": "abcd"}) + "\n",
        json.dumps({"type": "done"}) + "\n",
    ])
    config = {
        "enabled": True,
        "mode": "length_based",
        "min_seconds": 5,
        "max_seconds": 20,
        "chars_per_second": 4,
    }

    output = list(delay_ndjson_stream(source, config, sleep=sleeps.append))

    assert json.loads(output[0]) == {"type": "delay_pending"}
    assert json.loads(output[1]) == {"type": "token", "data": "abcd"}
    assert json.loads(output[2]) == {"type": "done"}
    assert sleeps == [6.0]
