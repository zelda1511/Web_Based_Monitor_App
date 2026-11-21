// End-to-end smoke test: starts the real app (a test copy with its own data folder, so it never touches your settings or lock), visits
// every page in both themes, and fails on anything a person would notice: a console error (a blocked script or style shows up here too),
// a page that scrolls sideways, an empty heading, a control with no accessible name, a missing landmark, or a Dashboard that never got
// its data (which means the window could not call the system side).
//
// It only navigates and switches the theme. It clicks nothing else and changes no setting.
// Run `npm run test:e2e` (builds first). Needs the Windows desktop: it opens a real window.
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const electron = require(path.join(root, 'node_modules', 'electron'));
const ROUTES = ['', 'software', 'updates', 'catalog', 'find', 'processes', 'history', 'startup', 'battery', 'cleanup', 'disk', 'backups', 'drivers', 'blocked', 'security', 'automation'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const failures = [];
const fail = (where, what) => failures.push(`${where}: ${what}`);

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
    s.on('error', reject);
  });
}

// Runs in the page: names every visible control the way a screen reader would.
const AUDIT = `(() => {
  const visible = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const text = (e) => (e.textContent || '').replace(/\\s+/g, ' ').trim();
  const nameOf = (e) => {
    const lab = e.getAttribute('aria-labelledby');
    if (lab) return lab.split(/\\s+/).map((id) => text(document.getElementById(id) || document.createElement('i'))).join(' ').trim();
    return (e.getAttribute('aria-label') || '').trim() || (e.labels ? [...e.labels].map(text).join(' ').trim() : '') || text(e) || (e.getAttribute('title') || '').trim();
  };
  const bad = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=switch], [role=button], [role=combobox]')]
    .filter(visible).filter((e) => !nameOf(e)).map((e) => e.outerHTML.slice(0, 110));
  const ids = [...document.querySelectorAll('[id]')].map((e) => e.id);
  const dupes = [...new Set(ids.filter((v, i) => ids.indexOf(v) !== i))];
  const main = document.querySelector('main');
  return {
    heading: (document.querySelector('h1')?.textContent || '').trim(),
    bad, dupes,
    landmarks: { main: !!main, nav: !!document.querySelector('nav'), header: !!document.querySelector('header') },
    sideways: main ? main.scrollWidth - main.clientWidth : 0,
    pageSideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    bodyBg: getComputedStyle(document.body).backgroundColor,
  };
})()`;

async function main() {
  const port = await freePort();
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'webase-e2e-'));
  // WEBASE_E2E_EXE=release\win-unpacked\"Webase System Monitor.exe" runs the packed app instead of the development one.
  const exe = process.env.WEBASE_E2E_EXE ? path.resolve(process.env.WEBASE_E2E_EXE) : null;
  const flags = [`--remote-debugging-port=${port}`, '--disable-features=CalculateNativeWinOcclusion', '--disable-backgrounding-occluded-windows'];
  const child = spawn(exe ?? electron, exe ? flags : [root, ...flags], {
    env: { ...process.env, WEBASE_DATA_DIR: data },
    stdio: 'ignore',
  });
  const stop = () => { try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* already gone */ } };
  process.on('exit', stop);

  let target;
  for (let i = 0; i < 100 && !target; i++) {
    await sleep(200);
    try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => /index\.html/.test(t.url)); } catch { /* not up yet */ }
  }
  if (!target) throw new Error('The app window did not start (is another copy blocking, or is dist\\ missing? run npm run build first).');

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  let id = 0;
  const wait = new Map();
  let where = 'startup';
  ws.onmessage = (m) => {
    const d = JSON.parse(m.data);
    if (d.id && wait.has(d.id)) { wait.get(d.id)(d.result ?? { error: d.error }); wait.delete(d.id); }
    if (d.method === 'Runtime.exceptionThrown') fail(where, `uncaught: ${d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text}`);
    if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') fail(where, `console error: ${d.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 200)}`);
    if (d.method === 'Log.entryAdded' && d.params.entry.level === 'error') fail(where, `${d.params.entry.source} error: ${d.params.entry.text.slice(0, 200)} ${d.params.entry.url ?? ''}`);
  };
  const send = (method, params = {}) => new Promise((r) => { wait.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (expression) => (await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result?.value;
  await send('Runtime.enable'); await send('Log.enable'); await send('Page.enable');

  const theme = (t) => ev(`document.documentElement.setAttribute('data-bs-theme','${t}')`);
  const go = async (route) => { await ev(`location.hash = '#/${route}'`); await sleep(route === '' ? 4500 : 2200); };
  const audit = async (label, expectBg) => {
    where = label;
    const a = await ev(AUDIT);
    if (!a.heading) fail(label, 'the page has no heading');
    if (a.bad.length) fail(label, `${a.bad.length} control(s) with no accessible name: ${a.bad.slice(0, 3).join(' | ')}`);
    if (a.dupes.length) fail(label, `duplicate ids: ${a.dupes.join(', ')}`);
    if (!a.landmarks.main || !a.landmarks.nav || !a.landmarks.header) fail(label, `missing landmark(s): ${JSON.stringify(a.landmarks)}`);
    if (a.sideways > 1 || a.pageSideways > 1) fail(label, `scrolls sideways (main ${a.sideways}px, page ${a.pageSideways}px)`);
    if (expectBg && a.bodyBg !== expectBg) fail(label, `page background is ${a.bodyBg}, expected ${expectBg} (the stylesheet did not apply?)`);
    return a;
  };

  await send('Page.reload'); await sleep(3000);
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 780, deviceScaleFactor: 1, mobile: false });

  // 1. every page, both themes, default window
  const BG = { dark: 'rgb(10, 14, 19)', light: 'rgb(243, 245, 248)' };
  for (const t of ['dark', 'light']) {
    await theme(t);
    for (const r of ROUTES) {
      await go(r);
      await audit(`${t} /${r}`, BG[t]);
    }
  }

  // 2. the Dashboard really got data from the system side (the IPC guard let the call through)
  await theme('dark'); await go('');
  const cpu = await ev("document.querySelector('.stat-value')?.textContent?.trim()");
  if (!/^\d+%$/.test(cpu ?? '')) fail('dashboard data', `the CPU tile shows "${cpu}", not a percentage: the window could not read the system`);
  const spec = await ev("document.querySelectorAll('.spec').length");
  if (!(spec >= 4)) fail('dashboard data', `only ${spec} hardware rows: the overview did not load`);

  // 3. small windows: the minimum size and a 1080p laptop at 150% scale
  for (const [w, h, label] of [[960, 600, 'min 960x600'], [1280, 672, '150% laptop 1280x672']]) {
    await send('Emulation.setDeviceMetricsOverride', { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    for (const t of ['dark', 'light']) { await theme(t); for (const r of ['', 'software', 'processes', 'disk', 'automation']) { await go(r); await audit(`${label} ${t} /${r}`); } }
  }

  // 4. high contrast (forced colors): the page must still show where things are
  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 780, deviceScaleFactor: 1, mobile: false });
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] });
  for (const r of ['', 'processes', 'disk']) {
    await go(r);
    const hc = await ev(`(() => {
      const nav = document.querySelector('.section.active'); const s = nav && getComputedStyle(nav);
      const bar = document.querySelector('.meter > i, .membar > i'); const b = bar && getComputedStyle(bar); const p = bar && getComputedStyle(bar.parentElement);
      return { navMarked: !!s && (parseFloat(s.borderLeftWidth) >= 2 || parseFloat(s.outlineWidth) > 0),
               barVisible: !bar || (b.backgroundColor !== p.backgroundColor || parseFloat(b.borderTopWidth) > 0) };
    })()`);
    where = `high contrast /${r}`;
    if (!hc.navMarked) fail(where, 'the open section is not marked in forced-colors mode');
    if (!hc.barVisible) fail(where, 'a usage bar has no visible fill in forced-colors mode');
  }
  await send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'none' }] });

  // 5. keyboard: Tab reaches the skip link first, then the top bar, and every stop shows a focus ring
  await go('');
  await ev('document.activeElement && document.activeElement.blur(); document.body.focus()');
  const stops = [];
  for (let i = 0; i < 8; i++) {
    await send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    await send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
    stops.push(await ev(`(() => { const e = document.activeElement; if (!e || e === document.body) return null; const s = getComputedStyle(e);
      return { text: (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 30), ring: parseFloat(s.outlineWidth) > 0 && s.outlineStyle !== 'none' || s.boxShadow !== 'none' }; })()`));
  }
  where = 'keyboard';
  if (!stops[0] || !/skip/i.test(stops[0].text)) fail(where, `the first Tab stop is "${stops[0]?.text}", expected a "Skip to content" link`);
  stops.forEach((s, i) => { if (!s) fail(where, `Tab stop ${i + 1} landed on nothing`); else if (!s.ring) fail(where, `Tab stop ${i + 1} ("${s.text}") shows no focus ring`); });

  ws.close();
  stop();
  fs.rmSync(data, { recursive: true, force: true });
  const unique = [...new Set(failures)];
  if (unique.length) {
    console.error(`\nE2E FAILED, ${unique.length} problem(s):\n - ${unique.join('\n - ')}`);
    process.exit(1);
  }
  console.log(`E2E passed: ${ROUTES.length} pages in 2 themes, 2 small window sizes, forced colors and the keyboard walk.`);
}

main().catch((e) => { console.error('E2E could not run:', e.message); process.exit(2); });
