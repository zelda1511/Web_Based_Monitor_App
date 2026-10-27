const fs = require('fs');
const path = require('path');

// The app's settings: one small JSON file in the app's data folder. Every value is checked and falls back to a safe default; a file that
// cannot be read is kept as settings.json.bad and replaced by the defaults. The window can only change the keys listed in `patch`, and
// automatic cleaning can only be switched ON through the confirmed route in main.js (`internal`), never by a plain change from the window.
// `memory` is the automation's own notebook (what it has already warned about); the window never reads or writes it.

const int = (v, lo, hi, fallback) => (Number.isInteger(v) && v >= lo && v <= hi ? v : fallback);
const bool = (v, fallback) => (typeof v === 'boolean' ? v : fallback);
const one = (v, allowed, fallback) => (allowed.includes(v) ? v : fallback);
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const defaults = () => ({
  version: 1,
  automation: false, // the master switch: off means nothing runs
  tray: false, // keep running in the tray when the window is closed
  startWithWindows: false,
  warn: {
    disk: { on: false, percent: 10 },
    battery: { on: false, low: 20, urgent: 10, health: 80 },
    updates: { on: false },
    startup: { on: false },
  },
  clean: { on: false, everyDays: 7, idleMinutes: 5, onlyOnAc: true },
  quietUntil: 0, // warnings are paused until this time (milliseconds since 1970)
  memory: { startupBaseline: null, updatesSig: null, updatesAt: 0, healthWarnedAt: 0, warnedDisks: {}, batteryEpisode: { low: false, urgent: false }, cleanLastRun: 0 },
});

// Reads `input` over `base`: only known keys, only valid values; anything else keeps the base value.
function merge(base, input, { internal = false } = {}) {
  const i = isObject(input) ? input : {};
  const w = isObject(i.warn) ? i.warn : {};
  const d = isObject(w.disk) ? w.disk : {};
  const b = isObject(w.battery) ? w.battery : {};
  const c = isObject(i.clean) ? i.clean : {};
  const out = {
    version: 1,
    automation: bool(i.automation, base.automation),
    tray: bool(i.tray, base.tray),
    startWithWindows: bool(i.startWithWindows, base.startWithWindows),
    warn: {
      disk: { on: bool(d.on, base.warn.disk.on), percent: int(d.percent, 1, 90, base.warn.disk.percent) },
      battery: {
        on: bool(b.on, base.warn.battery.on),
        low: int(b.low, 5, 50, base.warn.battery.low),
        urgent: int(b.urgent, 3, 20, base.warn.battery.urgent),
        health: int(b.health, 50, 95, base.warn.battery.health),
      },
      updates: { on: bool(isObject(w.updates) ? w.updates.on : undefined, base.warn.updates.on) },
      startup: { on: bool(isObject(w.startup) ? w.startup.on : undefined, base.warn.startup.on) },
    },
    clean: {
      // switching cleaning ON is only possible through the confirmed route; switching it OFF is always allowed
      on: c.on === false ? false : c.on === true ? (internal ? true : base.clean.on) : base.clean.on,
      everyDays: one(c.everyDays, [1, 7, 30], base.clean.everyDays),
      idleMinutes: int(c.idleMinutes, 0, 60, base.clean.idleMinutes),
      onlyOnAc: bool(c.onlyOnAc, base.clean.onlyOnAc),
    },
    quietUntil: Number.isFinite(i.quietUntil) && i.quietUntil >= 0 ? Math.floor(i.quietUntil) : base.quietUntil,
    memory: base.memory,
  };
  if (out.warn.battery.urgent > out.warn.battery.low) out.warn.battery.urgent = out.warn.battery.low; // urgent can never be above low
  if (out.startWithWindows) out.tray = true; // starting hidden needs the tray
  return out;
}

// What the automation may remember between runs (checked, so a damaged file cannot confuse it).
function mergeMemory(base, input) {
  const m = isObject(input) ? input : {};
  const num = (v, fb) => (Number.isFinite(v) && v >= 0 ? v : fb);
  const list = (v) => (Array.isArray(v) && v.length <= 500 && v.every((x) => typeof x === 'string' && x.length < 400) ? v : null);
  const warned = {};
  if (isObject(m.warnedDisks)) for (const [k, v] of Object.entries(m.warnedDisks)) if (/^[A-Za-z0-9:\\/ _.-]{1,60}$/.test(k) && typeof v === 'boolean') warned[k] = v;
  const ep = isObject(m.batteryEpisode) ? m.batteryEpisode : {};
  return {
    startupBaseline: 'startupBaseline' in m ? list(m.startupBaseline) : base.startupBaseline,
    updatesSig: 'updatesSig' in m ? (typeof m.updatesSig === 'string' && m.updatesSig.length < 4000 ? m.updatesSig : null) : base.updatesSig,
    updatesAt: num(m.updatesAt, base.updatesAt),
    healthWarnedAt: num(m.healthWarnedAt, base.healthWarnedAt),
    warnedDisks: 'warnedDisks' in m ? warned : base.warnedDisks,
    batteryEpisode: 'batteryEpisode' in m ? { low: bool(ep.low, false), urgent: bool(ep.urgent, false) } : base.batteryEpisode,
    cleanLastRun: num(m.cleanLastRun, base.cleanLastRun),
  };
}

function createSettings({ file, fsApi = fs } = {}) {
  let current = defaults();

  function load() {
    try {
      const raw = JSON.parse(fsApi.readFileSync(file, 'utf8').replace(/^﻿/, ''));
      if (!isObject(raw)) throw new Error('not an object');
      current = merge(defaults(), raw, { internal: true });
      current.memory = mergeMemory(defaults().memory, raw.memory);
      current.quietUntil = merge(defaults(), raw).quietUntil;
    } catch (e) {
      if (e.code !== 'ENOENT') {
        try {
          fsApi.renameSync(file, `${file}.bad`); // keep the damaged file for a look, start from the defaults
        } catch {
          // nothing to keep
        }
      }
      current = defaults();
    }
    return pub();
  }

  function save() {
    try {
      fsApi.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      fsApi.writeFileSync(tmp, JSON.stringify(current, null, 2), 'utf8');
      fsApi.renameSync(tmp, file); // a half-written file is never the settings file
    } catch {
      // settings still hold in memory; the next change tries again
    }
  }

  const copy = (o) => JSON.parse(JSON.stringify(o));
  const get = () => copy(current);
  const pub = () => {
    const { memory, ...rest } = copy(current);
    return rest;
  };

  // A change from the window (or from main.js with `internal` for the confirmed cleaning switch). Returns the public settings.
  function patch(partial, opts = {}) {
    const before = current;
    current = merge(current, partial, opts);
    current.memory = before.memory;
    save();
    return pub();
  }

  // The automation's own notebook.
  function remember(partial) {
    current.memory = mergeMemory(current.memory, partial);
    save();
    return copy(current.memory);
  }

  return { load, get, pub, patch, remember };
}

module.exports = { createSettings, defaults, merge, mergeMemory };
