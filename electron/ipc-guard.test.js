const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { isOwnFrame } = require('./ipc-guard');

const APP = pathToFileURL(path.join('C:', 'Program Files', 'Webase App', 'resources', 'app.asar', 'dist', 'index.html')).href;
// a frame is "the main frame" only when it is the same object, so each case builds its event around one object
const ok = (url) => { const f = { url }; return isOwnFrame({ sender: { mainFrame: f }, senderFrame: f }, APP); };

test('accepts the app page, with a route hash or a query string', () => {
  assert.equal(ok(APP), true);
  assert.equal(ok(`${APP}#/processes`), true);
  assert.equal(ok(`${APP}?x=1#/disk`), true);
});

test('refuses another file, another site and other schemes', () => {
  assert.equal(ok(APP.replace('index.html', 'other.html')), false);
  assert.equal(ok('https://example.com/index.html'), false);
  assert.equal(ok('file:///C:/Users/x/evil.html'), false);
  assert.equal(ok('about:blank'), false);
  assert.equal(ok('data:text/html,hi'), false);
  assert.equal(ok('not a url'), false);
});

test('refuses a sub-frame even on the right page, and a missing frame', () => {
  const top = { url: APP };
  const child = { url: APP };
  assert.equal(isOwnFrame({ sender: { mainFrame: top }, senderFrame: child }, APP), false);
  assert.equal(isOwnFrame({ sender: { mainFrame: top }, senderFrame: null }, APP), false);
  assert.equal(isOwnFrame({}, APP), false);
  assert.equal(isOwnFrame(undefined, APP), false);
});

test('a lookalike path with extra segments is refused', () => {
  assert.equal(ok(`${APP}/../evil.html`.replace('index.html/..', 'x')), false);
  assert.equal(ok(APP + '.evil'), false);
});
