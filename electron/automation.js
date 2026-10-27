const busy = require('./busy');

// The automation: a master switch, four warnings that only look, and the cleaning of old temp files. One timer ticks every 30 seconds; each
// job has its own interval and runs one at a time. Everything it needs from the system is handed in (so it can be tested with a fake clock
// and fake readers), and one job failing never stops the others. Nothing here runs while the master switch is off.

const TICK_MS = 30_000;
const JOB_TIMEOUT_MS = 3 * 60_000;
const DAY = 86_400_000;

const gb = (n) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`);
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('took too long')), ms).unref?.())]);

// identity of a startup entry: what it is, not whether it is switched on
const identity = (e) => `${e.scope}|${e.source}|${e.name}|${e.command}`.toLowerCase();

function createAutomation({ settings, notify, readers, cleaner, activity, ownEntry = () => false, log, now = Date.now, setTimer = setInterval, clearTimer = clearInterval }) {
  const state = {}; // per job: { nextAt, lastRunAt, lastOk, lastError, waiting, dead }
  let timer = null;
  let ticking = false;
  const get = () => settings.get();
  const remember = (m) => settings.remember(m);

  // ---- the four warnings ----

  async function diskJob(s) {
    const warned = { ...get().memory.warnedDisks };
    for (const d of await readers.disks()) {
      if (!d || !(d.size > 0)) continue;
      const freePct = ((d.size - d.used) / d.size) * 100;
      if (freePct < s.warn.disk.percent) {
        if (!warned[d.name]) {
          warned[d.name] = true;
          notify({ id: `disk:${d.name}`, title: `${d.name} is almost full`, body: `Only ${gb(d.size - d.used)} free (${Math.round(freePct)}%). Open Disk space to see what is using it.`, route: '/disk' });
        }
      } else if (freePct >= s.warn.disk.percent + 2) {
        delete warned[d.name]; // recovered: it may warn again if it fills up again
      }
    }
    remember({ warnedDisks: warned });
  }

  async function batteryJob(s, job) {
    const b = await readers.battery();
    if (!b || !b.present) {
      job.dead = true; // a PC without a battery is asked once, never again
      job.waiting = 'no battery';
      return;
    }
    const ep = { ...get().memory.batteryEpisode };
    const { low, urgent, health } = s.warn.battery;
    if (b.state === 'discharging' && typeof b.percent === 'number') {
      if (b.percent <= urgent && !ep.urgent) {
        ep.urgent = ep.low = true;
        notify({ id: 'battery:urgent', title: `Battery at ${b.percent}%`, body: 'Plug in the charger now.', route: '/battery' });
      } else if (b.percent <= low && !ep.low) {
        ep.low = true;
        notify({ id: 'battery:low', title: `Battery at ${b.percent}%`, body: 'Running on battery. Plug in the charger soon.', route: '/battery' });
      }
    } else if (b.acOnline === true || ['charging', 'full', 'plugged'].includes(b.state)) {
      ep.low = ep.urgent = false; // the charger is back: a new low battery warns again
    }
    remember({ batteryEpisode: ep });
    if (typeof b.health === 'number' && b.health < health && now() - get().memory.healthWarnedAt > 30 * DAY) {
      remember({ healthWarnedAt: now() });
      notify({ id: 'battery:health', title: `Battery health is ${Math.round(b.health)}%`, body: 'It holds noticeably less than when it was new. Open Battery for the details.', route: '/battery' });
    }
  }

  async function updatesJob() {
    const plain = (await readers.updates()).filter((u) => !u.explicit && u.source === 'winget' && u.id !== 'Microsoft.AppInstaller');
    if (!plain.length) {
      remember({ updatesSig: null });
      return;
    }
    const sig = plain.map((u) => `${u.id}@${u.available}`).sort().join(';');
    const m = get().memory;
    if (sig === m.updatesSig || now() - m.updatesAt < 20 * 3600_000) return; // the same list, or one warning a day at most
    const names = plain.slice(0, 3).map((u) => u.name);
    remember({ updatesSig: sig, updatesAt: now() });
    notify({
      id: 'updates', title: `${plain.length} app update${plain.length === 1 ? '' : 's'} waiting`,
      body: `${names.join(', ')}${plain.length > 3 ? `, and ${plain.length - 3} more` : ''}. Open App updates to choose.`, route: '/updates',
    });
  }

  async function startupJob() {
    const entries = (await readers.startup()).filter((e) => !ownEntry(e));
    const ids = [...new Set(entries.map(identity))];
    const baseline = get().memory.startupBaseline;
    if (baseline === null) {
      remember({ startupBaseline: ids }); // the first time it only records what is there, so there is no flood of warnings
      return;
    }
    const known = new Set(baseline);
    const fresh = entries.filter((e) => !known.has(identity(e)));
    remember({ startupBaseline: ids });
    if (fresh.length) {
      const names = [...new Set(fresh.map((e) => e.name))];
      notify({ id: 'startup', title: names.length === 1 ? `New startup program: ${names[0]}` : `${names.length} new startup programs`, body: `${names.slice(0, 3).join(', ')} will now start with Windows. Open Startup to keep or switch it off.`, route: '/startup' });
    }
  }

  // ---- the cleaning ----

  async function cleanJob(s, job) {
    job.waiting = null;
    const m = get().memory;
    if (m.cleanLastRun && now() - m.cleanLastRun < s.clean.everyDays * DAY) return; // not due yet
    if (s.clean.onlyOnAc && readers.onBattery()) { job.waiting = 'waiting for the charger'; return; }
    if (s.clean.idleMinutes > 0 && readers.idleSeconds() < s.clean.idleMinutes * 60) { job.waiting = 'waiting until you are away'; return; }
    const release = busy.acquire('automatic');
    if (!release) { job.waiting = 'another cleaning is running'; return; }
    job.waiting = null;
    try {
      const r = await cleaner.run(() => { const x = get(); return x.automation && x.clean.on; }); // checked again before every folder
      remember({ cleanLastRun: now() });
      activity.add({ kind: 'clean', freedBytes: r.freedBytes, removed: r.removed, failed: r.failed, reasons: r.reasons.join(', '), stopped: !!r.stopped, note: r.note ?? '' });
      if (r.freedBytes > 0) notify({ id: 'clean', title: 'Old temp files cleaned', body: `Freed ${gb(r.freedBytes)} (${r.removed} item${r.removed === 1 ? '' : 's'}).`, route: '/cleanup', record: false });
    } finally {
      release();
    }
  }

  const JOBS = [
    { id: 'disk', every: 5 * 60_000, first: 5_000, on: (s) => s.warn.disk.on, run: diskJob },
    { id: 'battery', every: 90_000, first: 5_000, on: (s) => s.warn.battery.on, run: batteryJob },
    { id: 'updates', every: DAY, first: 2 * 60_000, on: (s) => s.warn.updates.on, run: updatesJob },
    { id: 'startup', every: 30 * 60_000, first: 10_000, on: (s) => s.warn.startup.on, run: startupJob },
    { id: 'clean', every: 5 * 60_000, first: 10_000, on: (s) => s.clean.on, run: cleanJob },
  ];

  // One pass: runs every job that is switched on and due, one after another. Nothing at all while the master switch is off.
  async function tick() {
    if (ticking) return;
    ticking = true;
    try {
      const s = get();
      for (const job of JOBS) {
        const st = (state[job.id] ??= { nextAt: null, lastRunAt: null, lastOk: null, lastError: null, waiting: null, dead: false });
        if (!s.automation || !job.on(s)) {
          st.nextAt = null; // switched off: its schedule starts fresh when it is switched on again
          st.dead = false;
          st.waiting = null;
          continue;
        }
        if (st.dead) continue;
        if (st.nextAt === null) st.nextAt = now() + job.first;
        if (now() < st.nextAt) continue;
        try {
          await withTimeout(job.run(s, st), JOB_TIMEOUT_MS);
          st.lastOk = true;
          st.lastError = null;
        } catch (e) {
          st.lastOk = false;
          st.lastError = String(e?.message ?? e).slice(0, 200);
          log?.error?.(`automation:${job.id}`, e);
        }
        st.lastRunAt = now();
        st.nextAt = now() + job.every;
        if (!get().automation) break; // switched off while a job ran: stop here
      }
    } finally {
      ticking = false;
    }
  }

  function start() {
    if (timer) return;
    timer = setTimer(() => void tick(), TICK_MS);
    timer.unref?.();
    void tick();
  }

  function stop() {
    if (timer) clearTimer(timer);
    timer = null;
  }

  const status = () => ({
    master: get().automation,
    jobs: Object.fromEntries(JOBS.map((j) => [j.id, { ...(state[j.id] ?? { lastRunAt: null, lastOk: null, lastError: null, waiting: null, dead: false }), nextAt: undefined }])),
  });

  return { start, stop, tick, status, JOBS };
}

// The cleaner the app uses: the SAME scan and delete code as the Cleanup page, on the user-level folders only (never the Windows temp
// folder, which needs administrator rights), checking before every folder that automation is still switched on.
function makeCleaner({ defaultTargets, scanTarget, deleteTarget }) {
  const targets = () => defaultTargets().filter((t) => !t.needsAdmin);

  async function preview() {
    const out = [];
    for (const t of targets()) {
      const scan = await scanTarget(t);
      out.push({ label: t.label, refused: scan.refused ?? null, items: scan.items?.length ?? 0, bytes: scan.totalBytes ?? 0, keptRecent: scan.keptRecent ?? 0 });
    }
    return out;
  }

  async function run(shouldContinue) {
    const total = { freedBytes: 0, removed: 0, failed: 0, reasons: [], stopped: false, note: '' };
    const reasons = new Set();
    for (const t of targets()) {
      if (!shouldContinue()) { total.stopped = true; break; }
      try {
        const scan = await scanTarget(t);
        if (scan.refused) { total.note += `${t.label}: skipped (${scan.refused}). `; continue; }
        const r = await deleteTarget(scan);
        total.freedBytes += r.freedBytes;
        total.removed += r.removedItems;
        total.failed += r.failedItems;
        (r.reasons ?? []).forEach((x) => reasons.add(x));
      } catch (e) {
        total.failed++;
        total.note += `${t.label}: ${String(e?.message ?? e).slice(0, 80)}. `; // one folder failing does not stop the next
      }
    }
    total.reasons = [...reasons];
    return total;
  }

  return { preview, run };
}

module.exports = { createAutomation, makeCleaner, identity, TICK_MS };
