const { spawn: nodeSpawn } = require('child_process');

// One PowerShell kept running for a read that repeats every few seconds (the Processes page). Starting powershell.exe costs about
// 300 ms and a burst of CPU each time; a kept session answers the same script in a few tens of ms.
// The script is fixed text from this file's caller, never data from the window. Each request writes one empty line to stdin; the
// session runs the script and prints its result followed by an end marker line. It exits by itself when stdin closes (the app quit),
// and is stopped after `idleMs` without a request so it does not sit in memory once the page is closed.

const END = '<<webase-end>>';
const ERR = '<<webase-error>>';

const loop = (body) => String.raw`
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$ErrorActionPreference = 'Continue'
while ($null -ne [Console]::In.ReadLine()) {
  try { $r = & { ${body} } | Out-String -Width 1000000 } catch { $r = '${ERR}' + $_.Exception.Message }
  [Console]::Out.WriteLine($r.TrimEnd())
  [Console]::Out.WriteLine('${END}')
  [Console]::Out.Flush()
}
`;

function createPsSession({ script, idleMs = 60_000, timeoutMs = 30_000, maxBytes = 16 * 1024 * 1024, spawn = nodeSpawn } = {}) {
  let child = null;
  let buf = '';
  let pending = null; // { resolve, reject, timer } for the one request in flight
  let queue = Promise.resolve();
  let idle = null;

  function stop() {
    clearTimeout(idle);
    if (!child) return;
    const c = child;
    child = null;
    buf = '';
    try { c.stdin.end(); } catch { /* already closed */ }
    try { c.kill(); } catch { /* already gone */ }
  }

  function fail(err) {
    const p = pending;
    pending = null;
    stop();
    if (p) { clearTimeout(p.timer); p.reject(err); }
  }

  function start() {
    const c = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', loop(script)], { windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
    child = c;
    c.stdout.setEncoding('utf8');
    c.stdout.on('data', (chunk) => {
      if (c !== child) return;
      buf += chunk;
      if (buf.length > maxBytes) return fail(new Error('PowerShell sent more output than expected.'));
      const at = buf.indexOf(`${END}`);
      if (at < 0 || !pending) return;
      const out = buf.slice(0, at).replace(/^﻿/, '').trim();
      buf = buf.slice(at + END.length).replace(/^\r?\n/, '');
      const p = pending;
      pending = null;
      clearTimeout(p.timer);
      if (out.startsWith(ERR)) p.reject(new Error(out.slice(ERR.length).trim() || 'PowerShell failed.'));
      else p.resolve(out);
    });
    c.on('error', (e) => { if (c === child) fail(e); });
    c.on('exit', (code) => { if (c === child) fail(new Error(`PowerShell stopped (exit code ${code}).`)); });
    c.stdin.on('error', () => { /* reported by 'exit' */ });
  }

  function once() {
    return new Promise((resolve, reject) => {
      clearTimeout(idle);
      if (!child) start();
      pending = {
        resolve,
        reject,
        timer: setTimeout(() => fail(new Error('PowerShell took too long to answer.')), timeoutMs),
      };
      child.stdin.write('\n');
    }).finally(() => {
      clearTimeout(idle);
      if (child) idle = setTimeout(stop, idleMs);
      idle?.unref?.();
    });
  }

  // Requests run one at a time, in order; a failed one leaves no session behind, so the next starts a fresh one.
  function run() {
    const r = queue.then(once, once);
    queue = r.catch(() => {});
    return r;
  }

  return { run, stop, running: () => !!child };
}

module.exports = { createPsSession, END, ERR, loop };
