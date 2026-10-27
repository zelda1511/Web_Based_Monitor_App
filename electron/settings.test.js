const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createSettings, defaults, merge, mergeMemory } = require('./settings');

const dirs = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'webase-settings-test-'));
  dirs.push(d);
  return path.join(d, 'settings.json');
  // (the folder `d` is what gets removed afterwards, not its parent)
};
// Only the folders this file made (never a parent folder): each is checked by its name before it is removed.
test.after(() => dirs.forEach((d) => { if (path.basename(d).startsWith('webase-settings-test-')) fs.rmSync(d, { recursive: true, force: true }); }));

test('everything starts switched off, with safe values', () => {
  const d = defaults();
  assert.deepEqual([d.automation, d.tray, d.startWithWindows, d.clean.on], [false, false, false, false]);
  assert.deepEqual([d.warn.disk.on, d.warn.battery.on, d.warn.updates.on, d.warn.startup.on], [false, false, false, false]);
  assert.deepEqual([d.warn.disk.percent, d.warn.battery.low, d.warn.battery.urgent, d.warn.battery.health, d.clean.everyDays, d.clean.idleMinutes, d.clean.onlyOnAc], [10, 20, 10, 80, 7, 5, true]);
});

test('no file means the defaults; a saved change survives a restart; the file is written whole (no leftover temp file)', () => {
  const file = tmp();
  const a = createSettings({ file });
  assert.deepEqual(a.load(), (({ memory, ...r }) => r)(defaults()));
  a.patch({ automation: true, warn: { disk: { on: true, percent: 15 } } });
  const b = createSettings({ file });
  const s = b.load();
  assert.deepEqual([s.automation, s.warn.disk.on, s.warn.disk.percent, s.warn.battery.on], [true, true, 15, false]);
  assert.ok(!fs.existsSync(`${file}.tmp`));
  assert.ok(!('memory' in s), 'the window never gets the automation\'s notebook');
});

test('values are checked: wrong types, out-of-range numbers and unknown keys are ignored and the old value stays', () => {
  const s = createSettings({ file: tmp() });
  s.load();
  const r = s.patch({
    automation: 'yes', tray: 1, warn: { disk: { on: 'on', percent: 0 }, battery: { low: 99, urgent: -1, health: 3.5 }, updates: 'x', startup: { on: null } },
    clean: { everyDays: 3, idleMinutes: 'soon', onlyOnAc: 'no' }, quietUntil: 'later', hack: true, __proto__: { polluted: true },
  });
  assert.deepEqual(r, (({ memory, ...x }) => x)(defaults()));
  assert.ok(!('hack' in r) && ({}).polluted === undefined);
  const ok = s.patch({ warn: { disk: { percent: 90 }, battery: { low: 50, urgent: 3, health: 95 } }, clean: { everyDays: 30, idleMinutes: 0, onlyOnAc: false }, quietUntil: 1234.9 });
  assert.deepEqual([ok.warn.disk.percent, ok.warn.battery.low, ok.warn.battery.urgent, ok.warn.battery.health, ok.clean.everyDays, ok.clean.idleMinutes, ok.clean.onlyOnAc, ok.quietUntil], [90, 50, 3, 95, 30, 0, false, 1234]);
});

test('the urgent battery level can never be above the low level', () => {
  const s = createSettings({ file: tmp() });
  s.load();
  const r = s.patch({ warn: { battery: { low: 10, urgent: 20 } } });
  assert.deepEqual([r.warn.battery.low, r.warn.battery.urgent], [10, 10]);
});

test('automatic cleaning cannot be switched on by a plain change, only by the confirmed route; switching it off always works', () => {
  const s = createSettings({ file: tmp() });
  s.load();
  assert.equal(s.patch({ clean: { on: true } }).clean.on, false);
  assert.equal(s.patch({ clean: { on: true, everyDays: 30 } }).clean.on, false);
  assert.equal(s.patch({ clean: { on: true } }, { internal: true }).clean.on, true);
  assert.equal(s.patch({ automation: false }).clean.on, true, 'the master switch does not erase the choice');
  assert.equal(s.patch({ clean: { on: false } }).clean.on, false);
  assert.equal(createSettings({ file: tmp() }).load().clean.on, false);
});

test('start with Windows needs the tray, so it switches the tray on', () => {
  const s = createSettings({ file: tmp() });
  s.load();
  const r = s.patch({ startWithWindows: true });
  assert.deepEqual([r.startWithWindows, r.tray], [true, true]);
  assert.equal(s.patch({ startWithWindows: false }).tray, true, 'switching start-up off leaves the tray choice alone');
  assert.equal(s.patch({ tray: false }).tray, false);
});

test('the master switch off keeps every other choice', () => {
  const s = createSettings({ file: tmp() });
  s.load();
  s.patch({ automation: true, warn: { updates: { on: true }, disk: { on: true, percent: 20 } } });
  const off = s.patch({ automation: false });
  assert.deepEqual([off.automation, off.warn.updates.on, off.warn.disk.on, off.warn.disk.percent], [false, true, true, 20]);
  const on = s.patch({ automation: true });
  assert.deepEqual([on.warn.updates.on, on.warn.disk.percent], [true, 20]);
});

test('a damaged file is kept as .bad and replaced by the defaults; so are a file with the wrong shape and one with a byte-order mark', () => {
  for (const content of ['{ not json', '[1,2,3]', 'null', '']) {
    const file = tmp();
    fs.writeFileSync(file, content);
    const s = createSettings({ file }).load();
    assert.deepEqual(s, (({ memory, ...x }) => x)(defaults()), content);
    assert.ok(fs.existsSync(`${file}.bad`), `${content} is kept for a look`);
  }
  const file = tmp();
  fs.writeFileSync(file, '﻿' + JSON.stringify({ automation: true, warn: { disk: { on: true, percent: 5 } } }));
  const s = createSettings({ file }).load();
  assert.deepEqual([s.automation, s.warn.disk.percent], [true, 5]);
  assert.ok(!fs.existsSync(`${file}.bad`));
});

test('a file edited by hand is read value by value: good keys are kept, bad ones fall back to the defaults', () => {
  const file = tmp();
  fs.writeFileSync(file, JSON.stringify({ automation: true, tray: 'yes', warn: { disk: { on: true, percent: 999 }, battery: { low: 30 } }, clean: { on: true, everyDays: 7 } }));
  const s = createSettings({ file }).load();
  assert.deepEqual([s.automation, s.tray, s.warn.disk.on, s.warn.disk.percent, s.warn.battery.low, s.clean.on], [true, false, true, 10, 30, true], 'a saved cleaning choice survives a restart');
});

test('the notebook: valid entries are kept, bad ones dropped, and the window cannot reach it', () => {
  const s = createSettings({ file: tmp() });
  s.load();
  const m = s.remember({ startupBaseline: ['a|b|c|d'], updatesSig: 'x:1', updatesAt: 5, healthWarnedAt: 7, warnedDisks: { 'C:': true, '': true, 'D:': 'yes' }, batteryEpisode: { low: true, urgent: 3 }, cleanLastRun: 9, junk: 1 });
  assert.deepEqual(m, { startupBaseline: ['a|b|c|d'], updatesSig: 'x:1', updatesAt: 5, healthWarnedAt: 7, warnedDisks: { 'C:': true }, batteryEpisode: { low: true, urgent: false }, cleanLastRun: 9 });
  assert.deepEqual(s.remember({ updatesAt: -1, healthWarnedAt: 'x', startupBaseline: [1, 2] }).startupBaseline, null, 'a bad list becomes null (unknown), not a half list');
  assert.equal(s.remember({}).updatesAt, 5, 'bad numbers keep the old value');
  s.patch({ memory: { startupBaseline: ['hacked'] } });
  assert.deepEqual(s.get().memory.startupBaseline, null);
  assert.deepEqual(createSettings({ file: tmp() }).load().memory, undefined);
  assert.equal(mergeMemory(defaults().memory, { startupBaseline: new Array(501).fill('a') }).startupBaseline, null);
});

test('a notebook survives a restart', () => {
  const file = tmp();
  const a = createSettings({ file });
  a.load();
  a.remember({ updatesSig: 'sig', cleanLastRun: 42 });
  const b = createSettings({ file });
  b.load();
  assert.deepEqual([b.get().memory.updatesSig, b.get().memory.cleanLastRun], ['sig', 42]);
});

test('a folder that cannot be written does not break the app: the change still holds in memory', () => {
  const s = createSettings({ file: path.join(tmp(), 'sub', 'a', 'settings.json'), fsApi: { ...fs, mkdirSync: () => { throw new Error('read-only'); } } });
  s.load();
  assert.equal(s.patch({ automation: true }).automation, true);
});

test('merge never changes what it is given', () => {
  const base = defaults();
  const snapshot = JSON.stringify(base);
  merge(base, { automation: true, warn: { disk: { on: true } } });
  assert.equal(JSON.stringify(base), snapshot);
});
