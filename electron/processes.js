const os = require('os');
const path = require('path');
const { createPsSession } = require('./ps-session');

const SCRIPT = String.raw`
$p = Get-Process -ErrorAction SilentlyContinue | Select-Object Id, ProcessName, CPU, WorkingSet64, MainWindowTitle
ConvertTo-Json -InputObject @($p) -Compress
`;

// Windows needs these to stay alive: ending them logs you out, freezes the desktop or breaks services.
const PROTECTED = new Set([
  'idle', 'system', 'registry', 'memory compression', 'secure system', 'smss', 'csrss', 'wininit', 'winlogon',
  'services', 'lsass', 'lsaiso', 'svchost', 'dwm', 'fontdrvhost', 'sihost', 'explorer', 'audiodg', 'spoolsv',
  'taskhostw', 'ctfmon', 'runtimebroker', 'searchhost', 'startmenuexperiencehost', 'shellexperiencehost',
  'textinputhost', 'wudfhost', 'conhost', 'dllhost',
]);
// This app's own processes (named "electron" in development).
const OWN = path.basename(process.execPath, '.exe').toLowerCase();

const isProtected = (name) => PROTECTED.has(name.toLowerCase()) || name.toLowerCase() === OWN;

// shortcut: memory is the sum of each process's working set, so shared pages count twice; upgrade if exact figures matter.
function groupProcesses(list) {
  const groups = new Map();
  for (const p of list) {
    const key = p.name.toLowerCase();
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { name: p.name, pids: [], memBytes: 0, cpu: null, title: null, protected: isProtected(p.name) }));
    g.pids.push(p.pid);
    g.memBytes += p.mem || 0;
    if (p.cpuPct != null) g.cpu = (g.cpu ?? 0) + p.cpuPct;
    if (!g.title && p.title) g.title = p.title;
  }
  return [...groups.values()];
}

// Returns why this pid must not be ended, or null if it is fine. `known` maps pid -> name from the last list.
function whyNotEnd(pid, known) {
  if (!Number.isInteger(pid) || pid <= 0) return 'Invalid process id';
  if (pid === process.pid) return 'This is the Webase app';
  const name = known.get(pid);
  if (!name) return 'The process list is out of date. Refresh and try again';
  if (isProtected(name)) return 'Protected Windows process';
  return null;
}

let prev = { at: 0, cpu: new Map() };
let known = new Map();

// One PowerShell kept for the page's 5-second refresh instead of a new one each time; it stops after a minute without a request.
const session = createPsSession({ script: SCRIPT, idleMs: 60_000, timeoutMs: 30_000 });

async function getProcesses({ read = session.run } = {}) {
  const stdout = await read();
  const raw = [].concat(JSON.parse(stdout.replace(/^﻿/, '')) ?? []).filter((r) => r && r.ProcessName);
  const now = Date.now();
  const secs = (now - prev.at) / 1000;
  const cores = os.cpus().length;
  const cpuNow = new Map();
  const list = raw.map((r) => {
    if (r.CPU != null) cpuNow.set(r.Id, r.CPU);
    const before = prev.cpu.get(r.Id);
    // CPU % needs two readings; the first list shows no CPU values.
    const cpuPct = prev.at && r.CPU != null && before != null ? Math.max(0, ((r.CPU - before) / secs / cores) * 100) : null;
    return { pid: r.Id, name: r.ProcessName, cpuPct, mem: r.WorkingSet64, title: r.MainWindowTitle || null };
  });
  prev = { at: now, cpu: cpuNow };
  known = new Map(list.map((p) => [p.pid, p.name]));
  return groupProcesses(list);
}

// shortcut: forced end (no "close window" first), so unsaved work is lost; the UI says so before asking.
async function endTasks(pids) {
  return [].concat(pids ?? []).slice(0, 500).map((pid) => {
    const why = whyNotEnd(pid, known);
    if (why) return { pid, ok: false, error: why };
    try {
      process.kill(pid);
      return { pid, ok: true };
    } catch (e) {
      const error = e.code === 'EPERM' ? 'Access denied (needs administrator)' : e.code === 'ESRCH' ? 'Already closed' : e.message;
      return { pid, ok: false, error };
    }
  });
}

module.exports = { stopSession: session.stop, getProcesses, endTasks, groupProcesses, whyNotEnd, isProtected };
