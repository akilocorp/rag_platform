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


def test_progress_arrives_before_generation_finishes_and_before_sleep():
    trace = []
    def source():
        for event in [
            {'type': 'tool_use', 'id': 'search'},
            {'type': 'token', 'data': 'before'},
            {'type': 'tool_result', 'id': 'search'},
            {'type': 'widget_pending'},
            {'type': 'facilitator', 'id': 'widget', 'widget': 'chart'},
            {'type': 'token', 'data': 'after'},
            {'type': 'widget_failed'},
            {'type': 'facilitator_pending'},
            {'type': 'done'},
        ]:
            yield json.dumps(event) + '\n'
        trace.append('source_finished')
    stream = delay_ndjson_stream(source(), {
        'enabled': True, 'mode': 'fixed', 'min_seconds': 5,
    }, sleep=lambda _: trace.append('sleep'))
    for record in stream:
        trace.append(json.loads(record)['type'])
    assert trace == [
        'delay_pending', 'tool_use', 'tool_result', 'widget_pending',
        'widget_failed', 'facilitator_pending', 'source_finished', 'sleep',
        'token', 'facilitator', 'token', 'done',
    ]


def test_error_discards_partial_reply_without_sleeping_and_closes_source():
    sleeps = []
    closed = []
    def source():
        try:
            yield json.dumps({'type': 'token', 'data': 'unfinished'}) + '\n'
            yield json.dumps({'type': 'error', 'data': 'retry'}) + '\n'
            raise AssertionError('Must stop consuming after an error')
        finally:
            closed.append(True)
    output = list(delay_ndjson_stream(source(), {'enabled': True}, sleep=sleeps.append))
    assert [json.loads(record)['type'] for record in output] == ['delay_pending', 'error']
    assert sleeps == []
    assert closed == [True]


def test_disabled_preserves_original_stream():
    source = ['{"type":"token","data":"hello"}\n', '{"type":"done"}\n']
    sleeps = []
    assert list(delay_ndjson_stream(iter(source), {'enabled': False}, sleep=sleeps.append)) == source
    assert sleeps == []


def test_progress_only_does_not_add_delay():
    sleeps = []
    source = [json.dumps({'type': 'tool_result'}) + '\n', json.dumps({'type': 'done'}) + '\n']
    output = list(delay_ndjson_stream(iter(source), {'enabled': True}, sleep=sleeps.append))
    assert [json.loads(record)['type'] for record in output] == ['delay_pending', 'tool_result', 'done']
    assert sleeps == []


def test_flask_stream_forwards_progress_before_real_delay():
    import time
    from flask import Flask, Response, request, stream_with_context

    app = Flask(__name__)
    closed = []
    @app.get('/test-stream')
    def route():
        @stream_with_context
        def source():
            try:
                yield json.dumps({'type': 'tool_use', 'id': request.args['id']}) + '\n'
                yield json.dumps({'type': 'token', 'data': '你好'}) + '\n'
                yield json.dumps({'type': 'done'}) + '\n'
            finally:
                closed.append(True)
        return Response(delay_ndjson_stream(source(), {
            'enabled': True, 'mode': 'fixed', 'min_seconds': 0.05,
        }), mimetype='application/x-ndjson')

    response = app.test_client().get('/test-stream?id=search', buffered=False)
    events = iter(response.response)
    assert json.loads(next(events))['type'] == 'delay_pending'
    assert json.loads(next(events)) == {'type': 'tool_use', 'id': 'search'}
    started = time.monotonic()
    assert json.loads(next(events)) == {'type': 'token', 'data': '你好'}
    assert time.monotonic() - started >= 0.045
    assert json.loads(next(events))['type'] == 'done'
    assert list(events) == []
    response.close()
    assert closed == [True]


def test_disconnect_during_progress_closes_source():
    closed = []
    def source():
        try:
            yield json.dumps({'type': 'tool_use'}) + '\n'
            raise AssertionError('Disconnected client must not continue generating')
        finally:
            closed.append(True)
    stream = delay_ndjson_stream(source(), {'enabled': True})
    next(stream)
    next(stream)
    stream.close()
    assert closed == [True]


def test_upstream_exception_does_not_release_partial_reply_or_sleep():
    sleeps = []
    def source():
        yield json.dumps({'type': 'token', 'data': 'partial'}) + '\n'
        raise RuntimeError('connection lost')
    output = []
    try:
        for record in delay_ndjson_stream(source(), {'enabled': True}, sleep=sleeps.append):
            output.append(json.loads(record)['type'])
    except RuntimeError:
        pass
    else:
        raise AssertionError('Upstream failure must propagate')
    assert output == ['delay_pending']
    assert sleeps == []


def test_disconnect_after_initial_event_closes_unconsumed_source():
    class Source:
        closed = False
        def __iter__(self):
            raise AssertionError('Source should not be consumed yet')
        def close(self):
            self.closed = True
    source = Source()
    stream = delay_ndjson_stream(source, {'enabled': True})
    assert json.loads(next(stream))['type'] == 'delay_pending'
    stream.close()
    assert source.closed
