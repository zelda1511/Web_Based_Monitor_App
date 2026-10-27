const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSettings } = require('./settings');
const { createAutomation, makeCleaner, identity, TICK_MS } = require('./automation');
const busy = require('./busy');

const dirs = [];
test.after(() => dirs.forEach((d) => { if (path.basename(d).startsWith('webase-auto-test-')) fs.rmSync(d, { recursive: true, force: true }); }));
test.beforeEach(() => busy._reset());

const DAY = 86_400_000;
const drive = (name, freePct, size = 1000e9) => ({ name, size, used: size * (1 - freePct / 100) });
const batt = (over = {}) => ({ present: true, percent: 80, state: 'discharging', acOnline: false, health: 97.7, ...over });
const upd = (id, over = {}) => ({ name: id.split('.')[0], id, version: '1', available: '2', source: 'winget', explicit: false, ...over });
const entry = (name, over = {}) => ({ scope: 'user', source: 'run', name, command: `C:\\${name}.exe`, enabled: true, ...over });

// A little world: a settings file, a fake clock, fake readers, and a record of what was sent.
function world(patch = {}, data = {}) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'webase-auto-test-'));
  dirs.push(d);
  let t = 1_800_000_000_000;
  const settings = createSettings({ file: path.join(d, 'settings.json') });
  settings.load();
  settings.patch({ automation: true, ...patch });
  const w = {
    clock: { now: () => t, advance: (ms) => { t += ms; } },
    settings, sent: [], log: [], activity: [], calls: { disks: 0, battery: 0, updates: 0, startup: 0, clean: 0 },
    data: { disks: [drive('C:', 50)], battery: batt(), updates: [], startup: [], onBattery: false, idleSeconds: 99999, ...data },
    cleaner: { run: async () => { w.calls.clean++; return w.cleanResult ?? { freedBytes: 0, removed: 0, failed: 0, reasons: [], stopped: false, note: '' }; } },
    cleanResult: null,
  };
  w.readers = {
    disks: async () => { w.calls.disks++; if (w.data.disksError) throw new Error('wmi'); return w.data.disks; },
    battery: async () => { w.calls.battery++; return w.data.battery; },
    updates: async () => { w.calls.updates++; if (w.data.updatesError) throw new Error('winget missing'); return w.data.updates; },
    startup: async () => { w.calls.startup++; return w.data.startup; },
    onBattery: () => w.data.onBattery,
    idleSeconds: () => w.data.idleSeconds,
  };
  w.auto = createAutomation({
    settings, notify: (n) => { w.sent.push(n); return 'shown'; }, readers: w.readers, cleaner: w.cleaner, activity: { add: (e) => w.activity.push(e) },
    ownEntry: (e) => /webase system monitor/i.test(e.name), log: { error: (where, e) => w.log.push([where, String(e.message)]) }, now: w.clock.now,
  });
  // time passes in 30 second steps, one pass each, like the real timer
  w.pass = async (ms) => { for (let i = 0; i < ms / TICK_MS; i++) { w.clock.advance(TICK_MS); await w.auto.tick(); } };
  return w;
}

test('while the master switch is off nothing runs at all, whatever else is switched on', async () => {
  const w = world({ automation: false, warn: { disk: { on: true }, battery: { on: true }, updates: { on: true }, startup: { on: true } } });
  w.settings.patch({ clean: { on: true } }, { internal: true });
  w.data.disks = [drive('C:', 2)];
  await w.pass(10 * 60_000);
  assert.deepEqual(w.calls, { disks: 0, battery: 0, updates: 0, startup: 0, clean: 0 });
  assert.deepEqual(w.sent, []);
});

test('with the master switch on, only the items that are switched on run', async () => {
  const w = world({ warn: { disk: { on: true } } });
  await w.pass(10 * 60_000);
  assert.deepEqual(w.calls, { disks: 2, battery: 0, updates: 0, startup: 0, clean: 0 }, 'disk: first after 5 s, then every 5 minutes');
});

test('disk: one warning when a drive drops under the limit, none while it stays low, and a new one only after it recovered', async () => {
  const w = world({ warn: { disk: { on: true, percent: 10 } } });
  w.data.disks = [drive('C:', 9), drive('D:', 60)];
  await w.pass(60_000);
  assert.equal(w.sent.length, 1);
  assert.match(w.sent[0].title, /C: is almost full/);
  assert.match(w.sent[0].body, /Only 90\.0 GB free \(9%\)/);
  assert.equal(w.sent[0].route, '/disk');
  await w.pass(30 * 60_000);
  assert.equal(w.sent.length, 1, 'still low: no repeat');
  w.data.disks = [drive('C:', 11), drive('D:', 60)];
  await w.pass(10 * 60_000);
  w.data.disks = [drive('C:', 8), drive('D:', 60)];
  await w.pass(10 * 60_000);
  assert.equal(w.sent.length, 1, '11 % is not yet recovered (it needs the limit plus 2 points)');
  w.data.disks = [drive('C:', 13)];
  await w.pass(10 * 60_000);
  w.data.disks = [drive('C:', 5)];
  await w.pass(10 * 60_000);
  assert.equal(w.sent.length, 2, 'recovered above 12 %, then low again: a new warning');
  assert.equal(w.sent[1].id, 'disk:C:');
});

test('disk: exactly at the limit is not low, each drive is judged alone, and a damaged drive entry is skipped', async () => {
  const w = world({ warn: { disk: { on: true, percent: 10 } } });
  w.data.disks = [drive('C:', 10), { name: 'E:', size: 0, used: 0 }, null, drive('D:', 4)];
  await w.pass(60_000);
  assert.deepEqual(w.sent.map((n) => n.id), ['disk:D:']);
});

test('disk: the warned list survives a restart, so a restart does not warn again about a drive that is still low', async () => {
  const w = world({ warn: { disk: { on: true } } });
  w.data.disks = [drive('C:', 3)];
  await w.pass(60_000);
  assert.equal(w.sent.length, 1);
  const again = createAutomation({ settings: w.settings, notify: (n) => w.sent.push(n), readers: w.readers, cleaner: w.cleaner, activity: { add() {} }, now: w.clock.now });
  w.clock.advance(60_000);
  await again.tick();
  w.clock.advance(60_000);
  await again.tick();
  assert.equal(w.sent.length, 1);
});

test('a job that fails is recorded and does not stop the others', async () => {
  const w = world({ warn: { disk: { on: true }, battery: { on: true } } });
  w.data.disksError = true;
  w.data.battery = batt({ percent: 8 });
  await w.pass(60_000);
  assert.equal(w.auto.status().jobs.disk.lastOk, false);
  assert.match(w.auto.status().jobs.disk.lastError, /wmi/);
  assert.ok(w.log.some(([where]) => where === 'automation:disk'));
  assert.deepEqual(w.sent.map((n) => n.id), ['battery:urgent'], 'the battery warning still came');
});

test('battery: low and urgent each warn once per time on battery; the charger resets it; a PC without a battery is asked once', async () => {
  const w = world({ warn: { battery: { on: true, low: 20, urgent: 10 } } });
  for (const p of [30, 25, 19, 18, 15]) { w.data.battery = batt({ percent: p }); await w.pass(90_000); }
  assert.deepEqual(w.sent.map((n) => n.id), ['battery:low']);
  assert.match(w.sent[0].title, /Battery at 19%/);
  for (const p of [9, 8, 7]) { w.data.battery = batt({ percent: p }); await w.pass(90_000); }
  assert.deepEqual(w.sent.map((n) => n.id), ['battery:low', 'battery:urgent']);
  w.data.battery = batt({ percent: 8, state: 'charging', acOnline: true });
  await w.pass(90_000);
  w.data.battery = batt({ percent: 15 });
  await w.pass(90_000);
  assert.equal(w.sent.length, 3, 'plugged in and out again: low warns again');
  const none = world({ warn: { battery: { on: true } } }, { battery: { present: false } });
  await none.pass(30 * 60_000);
  assert.equal(none.calls.battery, 1);
  assert.equal(none.auto.status().jobs.battery.waiting, 'no battery');
});

test('battery: dropping straight to urgent gives one urgent warning, not two; on the charger there is never a low warning', async () => {
  const w = world({ warn: { battery: { on: true } } });
  w.data.battery = batt({ percent: 5 });
  await w.pass(5 * 90_000);
  assert.deepEqual(w.sent.map((n) => n.id), ['battery:urgent']);
  const ac = world({ warn: { battery: { on: true } } }, { battery: batt({ percent: 5, state: 'plugged', acOnline: true }) });
  await ac.pass(5 * 90_000);
  assert.deepEqual(ac.sent, []);
  const unknown = world({ warn: { battery: { on: true } } }, { battery: batt({ percent: null }) });
  await unknown.pass(3 * 90_000);
  assert.deepEqual(unknown.sent, []);
});

test('battery health: one warning when it falls under the limit, and not again for 30 days', async () => {
  const w = world({ warn: { battery: { on: true, health: 80 } } }, { battery: batt({ percent: 90, state: 'full', acOnline: true, health: 78.4 }) });
  await w.pass(3 * 90_000);
  assert.deepEqual(w.sent.map((n) => n.id), ['battery:health']);
  assert.match(w.sent[0].title, /Battery health is 78%/);
  w.clock.advance(29 * DAY);
  await w.pass(90_000);
  assert.equal(w.sent.length, 1);
  w.clock.advance(2 * DAY);
  await w.pass(90_000);
  assert.equal(w.sent.length, 2);
  const fine = world({ warn: { battery: { on: true, health: 80 } } }, { battery: batt({ health: 97, state: 'full', acOnline: true }) });
  await fine.pass(3 * 90_000);
  assert.deepEqual(fine.sent, []);
});

test('updates: checked a couple of minutes after it is switched on, then once a day; names up to three', async () => {
  const w = world({ warn: { updates: { on: true } } }, { updates: [upd('A.A'), upd('B.B'), upd('C.C'), upd('D.D'), upd('E.E')] });
  await w.pass(60_000);
  assert.equal(w.calls.updates, 0, 'not yet: the first check waits two minutes');
  await w.pass(90_000);
  assert.equal(w.calls.updates, 1);
  assert.equal(w.sent.length, 1);
  assert.match(w.sent[0].title, /5 app updates waiting/);
  assert.match(w.sent[0].body, /^A, B, C, and 2 more\./);
  assert.equal(w.sent[0].route, '/updates');
  await w.pass(10 * 3600_000);
  assert.equal(w.calls.updates, 1, 'not again until a day has passed');
});

test('updates: the same list never warns again; a changed list warns, but at most once a day; an empty list forgets the old one', async () => {
  const w = world({ warn: { updates: { on: true } } }, { updates: [upd('A.A')] });
  await w.pass(3 * 60_000);
  assert.equal(w.sent.length, 1);
  w.clock.advance(DAY);
  await w.pass(30_000 * 2);
  w.clock.advance(DAY);
  await w.pass(30_000 * 2);
  assert.equal(w.sent.length, 1, 'the same one update for days: silent');
  w.data.updates = [upd('A.A'), upd('B.B')];
  w.clock.advance(DAY);
  await w.pass(60_000);
  assert.equal(w.sent.length, 2, 'a new update appeared');
  assert.match(w.sent[1].title, /2 app updates waiting/);
  w.data.updates = [];
  w.clock.advance(DAY);
  await w.pass(60_000);
  w.data.updates = [upd('A.A'), upd('B.B')];
  w.clock.advance(DAY);
  await w.pass(60_000);
  assert.equal(w.sent.length, 3, 'after an empty check the same two are news again');
});

test('updates: only plain winget updates count (not held back, not from another source, not winget itself); a failing check says so quietly', async () => {
  const w = world({ warn: { updates: { on: true } } }, { updates: [upd('P.P', { explicit: true }), upd('S.S', { source: 'msstore' }), upd('Microsoft.AppInstaller')] });
  await w.pass(3 * 60_000);
  assert.deepEqual(w.sent, []);
  const bad = world({ warn: { updates: { on: true } } }, { updatesError: true });
  await bad.pass(3 * 60_000);
  assert.deepEqual(bad.sent, []);
  assert.equal(bad.auto.status().jobs.updates.lastOk, false);
});

test('startup: the first check only records what is there; a new program warns once; this app\'s own entry never does', async () => {
  const w = world({ warn: { startup: { on: true } } }, { startup: [entry('OneDrive'), entry('Steam')] });
  await w.pass(60_000);
  assert.deepEqual(w.sent, [], 'no flood on the first check');
  w.data.startup = [entry('OneDrive'), entry('Steam'), entry('Sneaky Updater')];
  await w.pass(30 * 60_000 + 30_000);
  assert.equal(w.sent.length, 1);
  assert.match(w.sent[0].title, /New startup program: Sneaky Updater/);
  assert.equal(w.sent[0].route, '/startup');
  await w.pass(2 * 3600_000);
  assert.equal(w.sent.length, 1, 'once only');
  w.data.startup = [...w.data.startup, entry('Webase System Monitor', { command: 'C:\\x\\Webase System Monitor.exe --hidden' })];
  await w.pass(35 * 60_000);
  assert.equal(w.sent.length, 1, 'turning on "start with Windows" does not warn about itself');
});

test('startup: switching an entry off and on again is not "new", but a second new program is named with the first', async () => {
  const w = world({ warn: { startup: { on: true } } }, { startup: [entry('A'), entry('B')] });
  await w.pass(60_000);
  w.data.startup = [entry('A', { enabled: false }), entry('B')];
  await w.pass(35 * 60_000);
  w.data.startup = [entry('A', { enabled: true }), entry('B')];
  await w.pass(35 * 60_000);
  assert.deepEqual(w.sent, []);
  w.data.startup = [entry('A'), entry('B'), entry('X'), entry('Y', { scope: 'machine' })];
  await w.pass(35 * 60_000);
  assert.equal(w.sent.length, 1);
  assert.match(w.sent[0].title, /2 new startup programs/);
  assert.equal(identity(entry('A')), identity(entry('A', { enabled: false })), 'identity ignores on and off');
  assert.notEqual(identity(entry('A')), identity(entry('A', { command: 'C:\\other.exe' })));
});

// ---- cleaning ----

const cleaning = (extra = {}, data = {}) => {
  const w = world({ ...extra }, data);
  w.settings.patch({ clean: { on: true } }, { internal: true });
  return w;
};

test('cleaning: runs when it is due and you are away and on the charger, then waits the chosen number of days', async () => {
  const w = cleaning();
  w.cleanResult = { freedBytes: 1.2e9, removed: 14, failed: 1, reasons: ['in use'], stopped: false, note: '' };
  await w.pass(60_000);
  assert.equal(w.calls.clean, 1);
  assert.equal(w.sent.length, 1);
  assert.match(w.sent[0].title, /Old temp files cleaned/);
  assert.match(w.sent[0].body, /Freed 1\.2 GB \(14 items\)/);
  assert.equal(w.sent[0].record, false);
  assert.deepEqual(w.activity.map((a) => [a.kind, a.freedBytes, a.removed, a.failed, a.reasons]), [['clean', 1.2e9, 14, 1, 'in use']]);
  await w.pass(6 * DAY);
  assert.equal(w.calls.clean, 1, 'not due for 7 days');
  await w.pass(1.1 * DAY);
  assert.equal(w.calls.clean, 2);
});

test('cleaning: the interval is the chosen one (1, 7 or 30 days)', async () => {
  for (const days of [1, 30]) {
    const w = cleaning({ clean: { everyDays: days } });
    await w.pass(60_000);
    await w.pass((days - 0.5) * DAY);
    assert.equal(w.calls.clean, 1, `${days} days: not yet`);
    await w.pass(0.6 * DAY);
    assert.equal(w.calls.clean, 2, `${days} days: due`);
  }
});

test('cleaning: waits while you are active or on battery, and says why; with the settings relaxed it runs', async () => {
  const w = cleaning({ clean: { idleMinutes: 5, onlyOnAc: true } }, { idleSeconds: 30, onBattery: false });
  await w.pass(2 * 60_000);
  assert.equal(w.calls.clean, 0);
  assert.equal(w.auto.status().jobs.clean.waiting, 'waiting until you are away');
  w.data.idleSeconds = 299;
  await w.pass(6 * 60_000);
  assert.equal(w.calls.clean, 0, 'four minutes 59 s is not five minutes');
  w.data.onBattery = true;
  w.data.idleSeconds = 600;
  await w.pass(6 * 60_000);
  assert.equal(w.calls.clean, 0);
  assert.equal(w.auto.status().jobs.clean.waiting, 'waiting for the charger');
  w.settings.patch({ clean: { onlyOnAc: false } });
  await w.pass(6 * 60_000);
  assert.equal(w.calls.clean, 1);
  assert.equal(w.auto.status().jobs.clean.waiting, null);
  const any = cleaning({ clean: { idleMinutes: 0 } }, { idleSeconds: 0 });
  await any.pass(60_000);
  assert.equal(any.calls.clean, 1, '0 minutes means any time');
});

test('cleaning: never while the Cleanup page (or another cleaning) is deleting; it tries again later', async () => {
  const w = cleaning();
  const release = busy.acquire('manual');
  await w.pass(10 * 60_000);
  assert.equal(w.calls.clean, 0);
  assert.equal(w.auto.status().jobs.clean.waiting, 'another cleaning is running');
  release();
  await w.pass(6 * 60_000);
  assert.equal(w.calls.clean, 1);
  assert.equal(busy.heldBy(), null, 'the turn is given back');
});

test('cleaning: the turn is given back even when the cleaning fails, and the failure is recorded without stopping later jobs', async () => {
  const w = cleaning({ warn: { disk: { on: true } } });
  w.cleaner.run = async () => { throw new Error('disk error'); };
  w.data.disks = [drive('C:', 2)];
  await w.pass(60_000);
  assert.equal(busy.heldBy(), null);
  assert.equal(w.auto.status().jobs.clean.lastOk, false);
  assert.deepEqual(w.sent.map((n) => n.id), ['disk:C:']);
  assert.equal(w.settings.get().memory.cleanLastRun, 0, 'a failed run is not counted as done');
});

test('cleaning: nothing freed means no notification, but the run is still recorded and counted', async () => {
  const w = cleaning();
  await w.pass(60_000);
  assert.equal(w.calls.clean, 1);
  assert.deepEqual(w.sent, []);
  assert.equal(w.activity.length, 1);
  assert.ok(w.settings.get().memory.cleanLastRun > 0);
});

test('cleaning: switched off in the middle of a run, the run is recorded as stopped, and nothing more runs afterwards', async () => {
  const w = world({ warn: { disk: { on: true } } });
  w.settings.patch({ clean: { on: true } }, { internal: true });
  w.cleaner.run = async () => { w.calls.clean++; w.settings.patch({ automation: false }); return { freedBytes: 5e6, removed: 1, failed: 0, reasons: [], stopped: true, note: '' }; };
  w.data.disks = [drive('C:', 1)];
  await w.pass(60_000);
  assert.equal(w.activity.at(-1).stopped, true);
  assert.equal(w.calls.clean, 1);
  const before = w.calls.disks;
  await w.pass(30 * 60_000);
  assert.equal(w.calls.disks, before, 'the master switch is off: not even a read');
  assert.equal(w.calls.clean, 1);
});

// ---- the real cleaner over the existing scan and delete ----

test('the cleaner takes only user-level folders, never the one that needs administrator rights, and asks again before every folder', async () => {
  const seen = [];
  const targets = [{ id: 'a', label: 'User temp', path: 'X', needsAdmin: false }, { id: 'w', label: 'Windows temp', path: 'W', needsAdmin: true }, { id: 'c', label: 'Crash dumps', path: 'Y', needsAdmin: false }];
  const c = makeCleaner({
    defaultTargets: () => targets,
    scanTarget: async (t) => { seen.push(`scan ${t.id}`); return { ...t, items: [{ name: 'x' }], totalBytes: 100, keptRecent: 2, refused: null }; },
    deleteTarget: async (s) => { seen.push(`delete ${s.id}`); return { freedBytes: 100, removedItems: 1, failedItems: 0, reasons: [] }; },
  });
  assert.deepEqual((await c.preview()).map((p) => [p.label, p.items, p.bytes, p.keptRecent]), [['User temp', 1, 100, 2], ['Crash dumps', 1, 100, 2]]);
  assert.ok(!JSON.stringify(await c.preview()).includes('Windows temp'));
  seen.length = 0;
  const all = await c.run(() => true);
  assert.deepEqual(seen, ['scan a', 'delete a', 'scan c', 'delete c']);
  assert.deepEqual([all.freedBytes, all.removed, all.failed, all.stopped], [200, 2, 0, false]);
  seen.length = 0;
  let n = 0;
  const part = await c.run(() => n++ < 1);
  assert.deepEqual(seen, ['scan a', 'delete a']);
  assert.equal(part.stopped, true);
  assert.equal(part.freedBytes, 100);
});

test('the cleaner skips a refused folder, and a folder that fails does not stop the next', async () => {
  const c = makeCleaner({
    defaultTargets: () => [{ id: 'a', label: 'A', needsAdmin: false }, { id: 'b', label: 'B', needsAdmin: false }, { id: 'c', label: 'C', needsAdmin: false }],
    scanTarget: async (t) => (t.id === 'a' ? { refused: 'not a folder named Temp', items: [], totalBytes: 0 } : t.id === 'b' ? (() => { throw new Error('access denied'); })() : { ...t, items: [{ name: 'x' }], totalBytes: 10, refused: null }),
    deleteTarget: async () => ({ freedBytes: 10, removedItems: 1, failedItems: 1, reasons: ['in use'] }),
  });
  const r = await c.run(() => true);
  assert.deepEqual([r.freedBytes, r.removed, r.failed, r.reasons], [10, 1, 2, ['in use']]);
  assert.match(r.note, /A: skipped \(not a folder named Temp\)/);
  assert.match(r.note, /B: access denied/);
});

test('the real scan and delete of the Cleanup page, on a throwaway Temp folder, through the automatic cleaner: old items go, recent ones stay', async () => {
  const { scanTarget, deleteTarget, MIN_AGE_MS } = require('./cleanup');
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'webase-auto-test-'));
  dirs.push(base);
  const root = path.join(base, 'Temp');
  fs.mkdirSync(root);
  const old = new Date(Date.now() - MIN_AGE_MS - 3 * DAY);
  fs.writeFileSync(path.join(root, 'old.bin'), Buffer.alloc(300));
  fs.utimesSync(path.join(root, 'old.bin'), old, old);
  fs.mkdirSync(path.join(root, 'olddir'));
  fs.writeFileSync(path.join(root, 'olddir', 'a.txt'), Buffer.alloc(200));
  fs.utimesSync(path.join(root, 'olddir', 'a.txt'), old, old);
  fs.utimesSync(path.join(root, 'olddir'), old, old);
  fs.writeFileSync(path.join(root, 'recent.bin'), Buffer.alloc(100));
  const c = makeCleaner({ defaultTargets: () => [{ id: 'user-temp', label: 'Your temporary files', path: root, needsAdmin: false }, { id: 'windows-temp', label: 'Windows temporary files', path: path.join(base, 'WinTemp'), needsAdmin: true }], scanTarget, deleteTarget });
  const p = await c.preview();
  assert.deepEqual([p.length, p[0].items, p[0].bytes, p[0].keptRecent], [1, 2, 500, 1]);
  const r = await c.run(() => true);
  assert.deepEqual([r.freedBytes, r.removed, r.failed], [500, 2, 0]);
  assert.deepEqual(fs.readdirSync(root), ['recent.bin']);
});

// ---- the timer ----

test('the timer ticks every 30 seconds, starts once, and stops', () => {
  const w = world();
  const made = [];
  const cleared = [];
  const a = createAutomation({ settings: w.settings, notify() {}, readers: w.readers, cleaner: w.cleaner, activity: { add() {} }, now: w.clock.now, setTimer: (fn, ms) => { const t = { fn, ms, unref() {} }; made.push(t); return t; }, clearTimer: (t) => cleared.push(t) });
  a.start();
  a.start();
  assert.deepEqual(made.map((t) => t.ms), [30_000]);
  a.stop();
  assert.equal(cleared.length, 1);
  a.stop();
  assert.equal(cleared.length, 1);
});

test('a job switched off and on again starts its schedule fresh, and its warnings are not lost by the switch', async () => {
  const w = world({ warn: { disk: { on: true } } });
  w.data.disks = [drive('C:', 3)];
  await w.pass(60_000);
  assert.equal(w.sent.length, 1);
  w.settings.patch({ warn: { disk: { on: false } } });
  await w.pass(10 * 60_000);
  const calls = w.calls.disks;
  w.settings.patch({ warn: { disk: { on: true } } });
  await w.pass(30_000);
  assert.equal(w.calls.disks, calls, 'the first read comes a few seconds after switching on, not at once');
  await w.pass(30_000);
  assert.equal(w.calls.disks, calls + 1);
  assert.equal(w.sent.length, 1, 'the drive is still low and was already warned about');
});
