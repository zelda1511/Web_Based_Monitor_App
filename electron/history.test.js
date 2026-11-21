const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHistory, FINE_KEEP, COARSE_KEEP, EVENT_GAP_MS, SAMPLE_MS } = require('./history');

const tmp = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'webase-hist-')), 'history.json');

function rig(over = {}) {
  let t = 1_700_000_000_000; // fixed clock, moved by hand
  let sample = { cpu: 10, ram: 50 };
  let on = true;
  const h = createHistory({
    file: over.file ?? tmp(),
    now: () => t,
    isOn: () => on,
    readSample: async () => (over.fail ? Promise.reject(new Error('x')) : sample),
    topPrograms: over.topPrograms ?? (async () => [{ name: 'busy.exe', cpu: 70, memBytes: 1000 }, { name: 'other.exe', cpu: 9, memBytes: 5 }]),
  });
  return { h, advance: (ms) => (t += ms), set: (s) => (sample = s), off: () => (on = false), on: () => (on = true), now: () => t };
}

test('records nothing while switched off, and starts when switched on', async () => {
  const r = rig();
  r.off();
  await r.h.tick();
  assert.equal(r.h.get('1h').points.length, 0);
  assert.equal(r.h.get('1h').on, false);
  r.on();
  await r.h.tick();
  assert.equal(r.h.get('1h').points.length, 1);
});

test('keeps 10-second samples for an hour and drops older ones', async () => {
  const r = rig();
  for (let i = 0; i < FINE_KEEP + 20; i++) { await r.h.tick(); r.advance(SAMPLE_MS); }
  assert.equal(r.h.get('1h').points.length, FINE_KEEP);
  r.advance(3600_000 + 1);
  assert.equal(r.h.get('1h').points.length, 0, 'old samples fall out of the one-hour view');
});

test('averages each minute into the 24-hour view, with the minute still open', async () => {
  const r = rig();
  r.advance(60_000 - (r.now() % 60_000)); // start of a minute
  r.set({ cpu: 20, ram: 40 }); await r.h.tick(); r.advance(SAMPLE_MS);
  r.set({ cpu: 60, ram: 60 }); await r.h.tick(); r.advance(SAMPLE_MS);
  const open = r.h.get('24h').points;
  assert.equal(open.length, 1);
  assert.deepEqual([open[0].cpu, open[0].ram, open[0].cpuMax], [40, 50, 60]);
  r.advance(60_000); r.set({ cpu: 10, ram: 50 }); await r.h.tick(); // a new minute closes the first
  const p = r.h.get('24h').points;
  assert.equal(p.length, 2);
  assert.equal(p[0].cpu, 40);
});

test('never keeps more than a day of minutes', async () => {
  const r = rig();
  for (let i = 0; i < COARSE_KEEP + 50; i++) { await r.h.tick(); r.advance(60_000); }
  assert.ok(r.h.get('24h').points.length <= COARSE_KEEP + 1);
});

test('a high CPU for two samples in a row writes down the busiest programs; one blip does not', async () => {
  const r = rig();
  r.set({ cpu: 95, ram: 50 }); await r.h.tick(); r.advance(SAMPLE_MS);
  r.set({ cpu: 10, ram: 50 }); await r.h.tick(); r.advance(SAMPLE_MS);
  assert.equal(r.h.get('1h').events.length, 0, 'a single high sample is only a blip');
  r.set({ cpu: 90, ram: 50 }); await r.h.tick(); r.advance(SAMPLE_MS);
  r.set({ cpu: 92, ram: 50 }); await r.h.tick();
  const ev = r.h.get('1h').events;
  assert.equal(ev.length, 1);
  assert.equal(ev[0].top[0].name, 'busy.exe');
  assert.equal(ev[0].cpu, 92);
});

test('busy-moment notes are at most one per five minutes', async () => {
  const r = rig();
  for (let i = 0; i < 6; i++) { r.set({ cpu: 95, ram: 50 }); await r.h.tick(); r.advance(SAMPLE_MS); }
  assert.equal(r.h.get('1h').events.length, 1);
  r.advance(EVENT_GAP_MS);
  for (let i = 0; i < 3; i++) { await r.h.tick(); r.advance(SAMPLE_MS); }
  assert.equal(r.h.get('1h').events.length, 2);
});

test('a failing program list or sample reader leaves the numbers and breaks nothing', async () => {
  const r = rig({ topPrograms: async () => { throw new Error('boom'); } });
  r.set({ cpu: 99, ram: 10 });
  for (let i = 0; i < 3; i++) { await r.h.tick(); r.advance(SAMPLE_MS); }
  assert.equal(r.h.get('1h').points.length, 3);
  assert.equal(r.h.get('1h').events.length, 0);
  const bad = rig({ fail: true });
  await assert.doesNotReject(bad.h.tick());
  assert.equal(bad.h.get('1h').points.length, 0);
});

test('out-of-range readings are ignored', async () => {
  const r = rig();
  r.set({ cpu: NaN, ram: 50 }); await r.h.tick();
  r.set({ cpu: 150, ram: 50 }); await r.h.tick();
  r.set({ cpu: 5, ram: -1 }); await r.h.tick();
  assert.equal(r.h.get('1h').points.length, 0);
});

test('saved to disk, read back on start, and a damaged file starts empty', async () => {
  const file = tmp();
  const a = rig({ file });
  await a.h.tick(); a.advance(SAMPLE_MS); await a.h.tick();
  a.h.stop();
  assert.ok(fs.existsSync(file));
  const b = createHistory({ file, now: a.now, isOn: () => true, readSample: async () => ({ cpu: 1, ram: 1 }) });
  b.load();
  assert.equal(b.get('1h').points.length, 2);
  fs.writeFileSync(file, '{ not json');
  b.load();
  assert.equal(b.get('1h').points.length, 0);
  fs.writeFileSync(file, JSON.stringify({ fine: [{ t: a.now(), cpu: 'x', ram: 1 }, { t: a.now(), cpu: 5, ram: 5 }], events: [{ t: a.now(), cpu: 99, top: [{ name: 'x'.repeat(500), cpu: 1 }, 7] }] }));
  b.load();
  assert.equal(b.get('1h').points.length, 1, 'bad rows are dropped');
  assert.equal(b.get('1h').events[0].top[0].name.length, 80, 'long names are cut');
  assert.equal(b.get('1h').events[0].top.length, 1, 'rows that are not programs are dropped');
});

test('clear erases the memory and the file', async () => {
  const file = tmp();
  const r = rig({ file });
  await r.h.tick();
  r.h.save();
  assert.ok(fs.existsSync(file));
  r.h.clear();
  assert.equal(r.h.get('1h').points.length, 0);
  assert.equal(fs.existsSync(file), false);
});
