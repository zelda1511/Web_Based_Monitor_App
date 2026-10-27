const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createNotifier, ROUTES, KEEP_NOTIFICATIONS } = require('./notify');
const { createActivity, KEEP } = require('./activity');

const dirs = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'webase-notify-test-'));
  dirs.push(d);
  return path.join(d, 'automation.jsonl');
};
// `dirs` holds the folders this file made; each is removed only if its name says it is one of ours
test.after(() => dirs.forEach((d) => { if (path.basename(d).startsWith('webase-notify-test-')) fs.rmSync(d, { recursive: true, force: true }); }));

class FakeNotification {
  static supported = true;
  static made = [];
  static isSupported() { return FakeNotification.supported; }
  constructor(o) { this.o = o; this.handlers = {}; FakeNotification.made.push(this); }
  on(e, fn) { this.handlers[e] = fn; }
  show() { this.shown = true; if (FakeNotification.failShow) throw new Error('toast failed'); }
}
test.beforeEach(() => { FakeNotification.supported = true; FakeNotification.made = []; FakeNotification.failShow = false; });

const setup = (over = {}) => {
  const entries = [];
  const opened = [];
  const balloons = [];
  const errors = [];
  const n = createNotifier({
    Notification: FakeNotification, getTray: () => ({ displayBalloon: (b) => balloons.push(b) }), settings: { get: () => ({ quietUntil: over.quietUntil ?? 0 }) },
    activity: { add: (e) => entries.push(e) }, onOpen: (r) => opened.push(r), log: { error: (w, e) => errors.push([w, e.message]) }, now: () => 1000, ...over.deps,
  });
  return { n, entries, opened, balloons, errors };
};

test('a warning becomes a toast, is written to the activity list first, and clicking it opens its page', () => {
  const { n, entries, opened } = setup();
  assert.equal(n.notify({ id: 'disk:C:', title: 'C: is almost full', body: 'Only 10 GB free.', route: '/disk' }), 'shown');
  assert.deepEqual(FakeNotification.made.map((x) => [x.o.title, x.o.body, x.shown]), [['C: is almost full', 'Only 10 GB free.', true]]);
  assert.deepEqual(entries.map((e) => [e.kind, e.id, e.route, e.shown]), [['warning', 'disk:C:', '/disk', true]]);
  FakeNotification.made[0].handlers.click();
  assert.deepEqual(opened, ['/disk']);
});

test('the latest notifications are kept referenced, so a click minutes later is not lost to garbage collection', () => {
  const { n } = setup();
  assert.equal(n.heldCount(), 0);
  for (let i = 0; i < 14; i++) n.notify({ id: `d${i}`, title: 't', body: 'b', route: '/disk' });
  assert.equal(n.heldCount(), KEEP_NOTIFICATIONS);
  assert.equal(KEEP_NOTIFICATIONS, 10);
  // the oldest are let go, the newest are still reachable
  FakeNotification.made.slice(-1)[0].handlers.click();
});

test('a test copy can trace which events the toast delivered', () => {
  const lines = [];
  const { n } = setup({ deps: { trace: (m) => lines.push(m) } });
  n.notify({ id: 'disk:C:', title: 't', body: 'b', route: '/disk' });
  const h = FakeNotification.made[0].handlers;
  h.show(); h.click(); h.close(); h.failed({}, 'boom');
  assert.deepEqual(lines, ['show disk:C:', 'click disk:C:', 'close disk:C:', 'failed disk:C: boom']);
});

test('a notification that fails to show is not kept', () => {
  FakeNotification.failShow = true;
  const { n } = setup({ deps: { getTray: () => null } });
  n.notify({ id: 'a', title: 't', body: 'b', route: '/disk' });
  assert.equal(n.heldCount(), 0);
});

test('only routes from the fixed list can be opened; anything else goes to the Automation page', () => {
  const { n, opened } = setup();
  for (const bad of ['/software', '..\\x', 'http://evil', '', undefined, 5]) n.notify({ id: 'x', title: 't', body: 'b', route: bad });
  FakeNotification.made.forEach((x) => x.handlers.click());
  assert.deepEqual(opened, new Array(6).fill('/automation'));
  assert.ok(ROUTES.includes('/disk') && ROUTES.includes('/cleanup') && !ROUTES.includes('/software'));
});

test('while warnings are paused nothing is shown, but the warning is still in the list (marked not shown)', () => {
  const { n, entries } = setup({ quietUntil: 5000 });
  assert.equal(n.notify({ id: 'a', title: 't', body: 'b', route: '/disk' }), 'paused');
  assert.equal(FakeNotification.made.length, 0);
  assert.equal(entries[0].shown, false);
  const later = setup({ quietUntil: 999 });
  assert.equal(later.n.notify({ id: 'a', title: 't', body: 'b', route: '/disk' }), 'shown', 'the pause is over');
});

test('when toasts are not available the tray balloon is used; if the toast fails to show it falls back to the balloon too', () => {
  const a = setup();
  FakeNotification.supported = false;
  assert.equal(a.n.notify({ id: 'a', title: 'T', body: 'B', route: '/disk' }), 'shown');
  assert.deepEqual(a.balloons, [{ title: 'T', content: 'B', iconType: 'info' }]);
  FakeNotification.supported = true;
  FakeNotification.failShow = true;
  const b = setup();
  assert.equal(b.n.notify({ id: 'a', title: 'T', body: 'B', route: '/disk' }), 'shown');
  assert.equal(b.balloons.length, 1);
  assert.deepEqual(b.errors, [['notify', 'toast failed']]);
  const none = setup({ deps: { getTray: () => null } });
  FakeNotification.supported = false;
  assert.equal(none.n.notify({ id: 'a', title: 'T', body: 'B', route: '/disk' }), 'failed');
});

test('record: false leaves the activity list to the caller (a finished cleaning writes its own fuller line)', () => {
  const { n, entries } = setup();
  n.notify({ id: 'clean', title: 'Old temp files cleaned', body: 'Freed 1 GB', route: '/cleanup', record: false });
  assert.equal(entries.length, 0);
  assert.equal(FakeNotification.made.length, 1);
});

test('the activity list keeps one JSON line per event, newest first when read, text clipped, damaged lines skipped', () => {
  let t = 100;
  const file = tmp();
  const a = createActivity({ file, now: () => t++ });
  a.add({ kind: 'warning', title: 'one', body: 'x'.repeat(1000) });
  a.add({ kind: 'clean', freedBytes: 500, removed: 2 });
  fs.appendFileSync(file, 'this is not json\n[1]\nnull\n');
  a.add({ kind: 'note', title: 'last' });
  const r = a.recent(10);
  assert.deepEqual(r.map((e) => e.kind), ['note', 'clean', 'warning']);
  assert.equal(r[2].body.length, 300);
  assert.deepEqual([r[1].freedBytes, r[1].removed, r[1].at], [500, 2, 101]);
  assert.equal(a.recent(1).length, 1);
  assert.equal(createActivity({ file: path.join(path.dirname(file), 'missing.jsonl') }).recent().length, 0);
});

test('the activity list never grows without limit: it is cut back to the newest 200 lines', () => {
  const file = tmp();
  const a = createActivity({ file });
  for (let i = 0; i < KEEP + 80; i++) a.add({ kind: 'note', title: `n${i}` });
  const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
  assert.ok(lines.length <= KEEP + 50, `${lines.length} lines on disk`);
  const all = a.recent(KEEP);
  assert.equal(all.length, KEEP);
  assert.equal(all[0].title, `n${KEEP + 79}`);
  assert.equal(all.at(-1).title, `n${80}`);
});

test('a folder that cannot be written does not break the automation', () => {
  const a = createActivity({ file: path.join(tmp(), 'x', 'y.jsonl'), fsApi: { ...fs, mkdirSync: () => { throw new Error('read-only'); } } });
  assert.doesNotThrow(() => a.add({ kind: 'note' }));
  assert.deepEqual(a.recent(), []);
});
