import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readNdjson } from '../src/utils/readNdjson.js';

async function parse(chunks) {
  const stream = new ReadableStream({ start(controller) {
    chunks.forEach(chunk => controller.enqueue(chunk));
    controller.close();
  } });
  const reader = stream.getReader();
  const result = [];
  for await (const event of readNdjson(reader)) result.push(event);
  assert.equal(stream.locked, false);
  return result;
}
const events = [
  { type: 'delay_pending' }, { type: 'tool_use', id: 'search' },
  { type: 'tool_result', id: 'search', content: '结果' },
  { type: 'token', data: '你好，世界🌏' }, { type: 'done' },
];
const bytes = new TextEncoder().encode(events.map(JSON.stringify).join('\n') + '\n');
test('preserves all events for every possible two-chunk split', async () => {
  for (let i = 1; i < bytes.length; i++) {
    assert.deepEqual(await parse([bytes.slice(0, i), bytes.slice(i)]), events);
  }
});
test('handles byte-by-byte Unicode and batched delivery', async () => {
  assert.deepEqual(await parse([...bytes].map(byte => Uint8Array.of(byte))), events);
  assert.deepEqual(await parse([bytes]), events);
});
test('flushes final record without newline', async () => {
  assert.deepEqual(await parse([bytes.slice(0, -1)]), events);
});
test('malformed or truncated records raise instead of silently losing data', async () => {
  await assert.rejects(parse([new TextEncoder().encode('{"type":"tok')]), SyntaxError);
});
