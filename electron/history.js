const fs = require('fs');
const path = require('path');

// Performance history: while it is switched on, CPU and memory are sampled every 10 seconds (two cheap reads, no process started) and
// kept for a day: 10-second samples for the last hour, one-minute averages for the last 24 hours. When the CPU stays high for two
// samples in a row, the busiest programs at that moment are written down too, so "why was it slow at 14:30?" has an answer.
// Everything stays on this PC in one small JSON file; the window only reads it. Off by default (see settings.js, `history`).

const SAMPLE_MS = 10_000;
const FINE_KEEP = 360; // one hour of 10-second samples
const COARSE_KEEP = 1440; // 24 hours of one-minute averages
const EVENTS_KEEP = 30;
const HIGH_CPU = 85; // percent
const EVENT_GAP_MS = 5 * 60_000; // at most one busy-moment note every 5 minutes
const SAVE_EVERY_MS = 5 * 60_000;
const DAY_MS = 24 * 3600_000;

const num = (v, lo, hi) => (Number.isFinite(v) && v >= lo && v <= hi ? v : null);
const round1 = (v) => Math.round(v * 10) / 10;

function createHistory({ file, readSample, topPrograms, isOn, now = Date.now, fsApi = fs } = {}) {
  let fine = []; // { t, cpu, ram }
  let coarse = []; // { t (start of the minute), cpu, ram, cpuMax }
  let events = []; // { t, cpu, top: [{ name, cpu, memBytes }] }
  let bucket = null; // the minute being filled: { t, n, cpu, ram, cpuMax }
  let highRun = 0;
  let lastEventAt = 0;
  let lastSaveAt = 0;
  let lastReadAt = -Infinity; // when the program list was last read: a CPU share needs a recent earlier reading
  let timer = null;
  let busy = false;

  // ---- keeping it on disk (checked on the way in: a damaged file cannot break the page) ----
  function load() {
    try {
      const raw = JSON.parse(fsApi.readFileSync(file, 'utf8').replace(/^﻿/, ''));
      const t0 = now() - DAY_MS;
      const pt = (p) => num(p?.t, t0, now() + 60_000) !== null && num(p.cpu, 0, 100) !== null && num(p.ram, 0, 100) !== null;
      fine = (Array.isArray(raw.fine) ? raw.fine : []).filter(pt).map((p) => ({ t: p.t, cpu: p.cpu, ram: p.ram })).slice(-FINE_KEEP);
      coarse = (Array.isArray(raw.coarse) ? raw.coarse : []).filter((p) => pt(p) && num(p.cpuMax, 0, 100) !== null).map((p) => ({ t: p.t, cpu: p.cpu, ram: p.ram, cpuMax: p.cpuMax })).slice(-COARSE_KEEP);
      events = (Array.isArray(raw.events) ? raw.events : [])
        .filter((e) => num(e?.t, t0, now() + 60_000) !== null && num(e.cpu, 0, 100) !== null && Array.isArray(e.top))
        .map((e) => ({
          t: e.t,
          cpu: e.cpu,
          top: e.top.slice(0, 5).filter((p) => typeof p?.name === 'string').map((p) => ({ name: p.name.slice(0, 80), cpu: num(p.cpu, 0, 10000), memBytes: num(p.memBytes, 0, 1e13) })),
        }))
        .slice(-EVENTS_KEEP);
    } catch {
      fine = []; coarse = []; events = [];
    }
  }

  function save() {
    lastSaveAt = now();
    try {
      fsApi.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fsApi.writeFileSync(tmp, JSON.stringify({ version: 1, fine, coarse, events }), 'utf8');
      fsApi.renameSync(tmp, file); // a half-written file is never the history file
    } catch {
      // the history still holds in memory; the next save tries again
    }
  }

  // ---- one sample ----
  function closeBucket() {
    if (!bucket) return;
    coarse.push({ t: bucket.t, cpu: round1(bucket.cpu / bucket.n), ram: round1(bucket.ram / bucket.n), cpuMax: round1(bucket.cpuMax) });
    if (coarse.length > COARSE_KEEP) coarse = coarse.slice(-COARSE_KEEP);
    bucket = null;
  }

  async function tick() {
    if (busy || !isOn()) return;
    busy = true;
    try {
      const s = await readSample();
      const cpu = num(s?.cpu, 0, 100);
      const ram = num(s?.ram, 0, 100);
      if (cpu === null || ram === null) return;
      const t = now();
      fine.push({ t, cpu: round1(cpu), ram: round1(ram) });
      if (fine.length > FINE_KEEP) fine = fine.slice(-FINE_KEEP);

      const minute = Math.floor(t / 60_000) * 60_000;
      if (bucket && bucket.t !== minute) closeBucket();
      bucket ??= { t: minute, n: 0, cpu: 0, ram: 0, cpuMax: 0 };
      bucket.n += 1; bucket.cpu += cpu; bucket.ram += ram; bucket.cpuMax = Math.max(bucket.cpuMax, cpu);

      // A busy moment: the first high sample only warms the program reader up (a CPU share needs two readings); the second one is written down.
      highRun = cpu >= HIGH_CPU ? highRun + 1 : 0;
      if (highRun >= 1 && topPrograms && t - lastEventAt >= EVENT_GAP_MS) {
        try {
          const warm = t - lastReadAt < 3 * SAMPLE_MS; // an earlier reading from the last few samples exists
          const top = await topPrograms();
          lastReadAt = t;
          if (highRun >= 2 && warm && Array.isArray(top) && top.length) {
            events.push({ t, cpu: round1(cpu), top: top.slice(0, 5).map((p) => ({ name: String(p.name).slice(0, 80), cpu: p.cpu == null ? null : round1(p.cpu), memBytes: p.memBytes ?? null })) });
            if (events.length > EVENTS_KEEP) events = events.slice(-EVENTS_KEEP);
            lastEventAt = t;
            save();
          }
        } catch {
          // the list of programs is a bonus; the numbers are the history
        }
      }
      if (t - lastSaveAt >= SAVE_EVERY_MS) save();
    } catch {
      // a failed read is a gap in the graph, never an error
    } finally {
      busy = false;
    }
  }

  // What the page shows. '1h' is the 10-second samples; '24h' is the one-minute averages plus the minute still being filled.
  function get(range = '1h') {
    const t0 = now() - (range === '24h' ? DAY_MS : 3600_000);
    const points = range === '24h'
      ? [...coarse, ...(bucket ? [{ t: bucket.t, cpu: round1(bucket.cpu / bucket.n), ram: round1(bucket.ram / bucket.n), cpuMax: round1(bucket.cpuMax) }] : [])].filter((p) => p.t >= t0)
      : fine.filter((p) => p.t >= t0);
    return { on: isOn(), range: range === '24h' ? '24h' : '1h', points, events: events.filter((e) => e.t >= t0).reverse(), sampleMs: SAMPLE_MS };
  }

  function start() {
    load();
    timer ??= setInterval(() => void tick(), SAMPLE_MS);
    timer.unref?.();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    if (fine.length || events.length) save();
  }

  // erase everything recorded (the page offers this next to the switch)
  function clear() {
    fine = []; coarse = []; events = []; bucket = null; highRun = 0;
    try { fsApi.rmSync(file, { force: true }); } catch { /* nothing to remove */ }
  }

  return { start, stop, tick, get, clear, load, save };
}

module.exports = { createHistory, SAMPLE_MS, FINE_KEEP, COARSE_KEEP, EVENTS_KEEP, HIGH_CPU, EVENT_GAP_MS };
