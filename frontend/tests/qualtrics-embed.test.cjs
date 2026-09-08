const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const saved = {};
let onSubmit;
let onMessage;
const windowMock = {
  ACTRLabsQualtrics: { embedOrigin: 'https://app.actrlab.com' },
  addEventListener(type, handler) {
    if (type === 'message') onMessage = handler;
  },
};
const context = {
  window: windowMock,
  console,
  Qualtrics: {
    SurveyEngine: {
      setEmbeddedData(key, value) { saved[key] = value; },
      addOnPageSubmit(handler) { onSubmit = handler; },
    },
  },
};

const source = fs.readFileSync(
  path.join(__dirname, '..', 'public', 'qualtrics-embed.js'),
  'utf8',
);
vm.runInNewContext(source, context);

assert.equal(saved.chat_status, 'started');
onMessage({
  origin: 'https://evil.example',
  data: { type: 'CHAT_MESSAGE', sender: 'user', content: 'ignored' },
});
assert.equal(saved.transcript, '');

onMessage({
  origin: 'https://app.actrlab.com',
  data: {
    type: 'CHAT_MESSAGE', sender: 'user', content: 'Hello',
    timestamp: '2026-09-08T00:00:00.000Z',
  },
});
assert.equal(saved.chat_status, 'in_progress');
assert.match(saved.transcript, /User: Hello/);

onSubmit();
assert.equal(saved.chat_status, 'completed');
console.log('Qualtrics hosted bridge checks passed');
