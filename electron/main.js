const { app, BrowserWindow, Menu, Notification, Tray, dialog, ipcMain, nativeImage, nativeTheme, powerMonitor, shell } = require('electron');
const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const { getOverview, getLive, getDisks } = require('./system');
const { listSoftware, folderOf } = require('./software');
const { getProcesses, endTasks } = require('./processes');
const { listStartup, setStartup } = require('./startup');
const { scanCleanup, deleteCleanup, defaultTargets, scanTarget, deleteTarget } = require('./cleanup');
const { listDrivers, scanDriverUpdates, LINKS } = require('./drivers');
const { listAppUpdates, searchApps, appDetails, installApp, upgradeApp } = require('./winget');
const { uninstallApp, getSnapshot } = require('./uninstall');
const { listCatalog, installFromCatalog, exportSelection, importSelection } = require('./catalog');
const { getBattery, batteryReport } = require('./battery');
const { scanLeftovers, manualSnapshot, stillInstalled, defaultRoots } = require('./leftovers');
const { removeLeftovers, assessItem, backupRoot } = require('./leftover-delete');
const { installDriverUpdate } = require('./driver-install');
const { listBackups, restoreKey, restoreFolder, deleteBackup, backupDir } = require('./backups');
const { listBlocked } = require('./blocked');
const disk = require('./disk');
const { scanLarge, trashLarge, annotate } = require('./downloads');
const { listBin, emptyBin } = require('./recyclebin');
const { discoverCaches, clearCaches } = require('./caches');
const { withLock, isBusy } = require('./lock');
const { createLogger, defaultDir } = require('./log');
const cleaning = require('./busy');
const { createSettings } = require('./settings');
const { createActivity } = require('./activity');
const { createNotifier, ROUTES } = require('./notify');
const { createAutomation, makeCleaner } = require('./automation');

// A test copy keeps its settings, single-instance lock and cache in its own folder, so it never touches (or is stopped by) your own copy.
if (process.env.WEBASE_DATA_DIR) app.setPath('userData', path.resolve(process.env.WEBASE_DATA_DIR));

// Errors go to %LOCALAPPDATA%\WebaseSystemMonitor\logs\app.log (channel and message only, never the request). 'uncaughtExceptionMonitor'
// only watches, so Electron still shows its own error box.
const log = createLogger();
process.on('uncaughtExceptionMonitor', (e) => log.crash('main process', e));
process.on('unhandledRejection', (e) => log.error('unhandled rejection', e));
app.on('render-process-gone', (_e, _wc, d) => log.crash('window process', `${d.reason} (code ${d.exitCode})`));
app.on('child-process-gone', (_e, d) => log.crash(`${d.type} process`, `${d.reason} (code ${d.exitCode})`));
const registerHandler = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, fn) =>
  registerHandler(channel, async (...args) => {
    try {
      return await fn(...args);
    } catch (e) {
      log.error(channel, e); // logged, then passed on to the window exactly as before
      throw e;
    }
  });

// The window can only call channels registered here; add new ones one at a time.
ipcMain.handle('hw:overview', getOverview);
ipcMain.handle('hw:live', getLive);
ipcMain.handle('sw:list', listSoftware);
ipcMain.handle('sw:openFolder', async (_e, key) => {
  const r = folderOf(key);
  return r.error ?? shell.openPath(r.dir); // '' on success, else an error message
});
ipcMain.handle('proc:list', getProcesses);
ipcMain.handle('proc:end', (_e, pids) => endTasks(pids));
ipcMain.handle('startup:list', listStartup);
ipcMain.handle('startup:set', (_e, id, enabled) => setStartup(id, enabled));
ipcMain.handle('clean:scan', () => scanCleanup());
ipcMain.handle('clean:delete', (_e, ids) => {
  const release = cleaning.acquire('manual'); // never together with the automatic cleaning
  if (!release) throw new Error('An automatic cleaning is running right now. Try again in a minute.');
  return deleteCleanup(ids).finally(release);
});
ipcMain.handle('apps:updates', listAppUpdates);
ipcMain.handle('apps:search', (_e, query) => searchApps(query));
ipcMain.handle('apps:details', (_e, id) => appDetails(id));
ipcMain.handle('apps:install', (_e, id) => installApp(id));
ipcMain.handle('apps:upgrade', (_e, id) => upgradeApp(id));
ipcMain.handle('sw:uninstall', (_e, key) => uninstallApp(key));
// App catalog: a fixed list of ids (catalog-data.js). The window names ids only; the list file is chosen in a system dialog and never leaves main.
const askFile = (open, options) => {
  const win = BrowserWindow.getFocusedWindow();
  return (open ? (win ? dialog.showOpenDialog(win, options) : dialog.showOpenDialog(options)) : win ? dialog.showSaveDialog(win, options) : dialog.showSaveDialog(options));
};
const JSON_FILTER = [{ name: 'App list (JSON)', extensions: ['json'] }];
ipcMain.handle('cat:list', () => listCatalog());
ipcMain.handle('cat:install', (_e, id) => installFromCatalog(id));
ipcMain.handle('cat:export', (_e, ids) => exportSelection(ids, { showSave: async (name) => { const r = await askFile(false, { title: 'Save app list', defaultPath: name, filters: JSON_FILTER }); return r.canceled ? null : r.filePath; } }));
ipcMain.handle('cat:import', () => importSelection({ showOpen: async () => { const r = await askFile(true, { title: 'Open app list', properties: ['openFile'], filters: JSON_FILTER }); return r.canceled ? null : r.filePaths[0]; } }));
// Only the latest scan can be acted on: removal names items by the ids it gave out.
let lastScan = null;
async function scan(snapshot) {
  const installed = await listSoftware(); // read fresh, so a program installed a moment ago is seen
  if (!snapshot.key) {
    // Typed-in name: refuse if that program is still installed, or its own data would be offered as "leftovers".
    const app = stillInstalled(snapshot.name, installed);
    if (app) throw new Error(`${app.name} still appears in your installed software. Uninstall it first; otherwise its own data would be listed as leftovers.`);
  }
  lastScan = await scanLeftovers(snapshot, { installed });
  const roots = defaultRoots();
  // Tell the window which items it may offer to remove (removal checks again) and which need administrator permission.
  lastScan.items = lastScan.items.map((i) => ({ ...i, ...assessItem(i, { ownKey: lastScan.ownKey, roots }) }));
  return lastScan;
}
ipcMain.handle('sw:leftovers', (_e, key) => {
  const snapshot = getSnapshot(key); // only for an app uninstalled from here: its details were saved just before removal
  if (!snapshot) throw new Error('Leftovers can only be scanned for an app uninstalled from this window in this session.');
  return scan(snapshot);
});
ipcMain.handle('left:scanName', (_e, name, publisher) => scan(manualSnapshot(name, publisher)));
ipcMain.handle('left:remove', (_e, ids) => {
  if (!lastScan) throw new Error('Scan for leftovers first.');
  return withLock(() => removeLeftovers(lastScan, ids, { trashItem: (p) => shell.trashItem(p) }));
});
ipcMain.handle('left:reveal', (_e, id) => {
  const item = lastScan?.items.find((i) => i.id === id && i.kind !== 'registry'); // only a file or folder from the latest scan
  if (!item) throw new Error('That item is not in the latest scan.');
  shell.showItemInFolder(item.path);
});
ipcMain.handle('blk:list', () => listBlocked()); // read-only: what Windows kept in its Code Integrity log
// Backups page: the window names a backup by its folder name and an item by its number; paths and files are resolved in backups.js.
ipcMain.handle('bak:list', () => listBackups());
ipcMain.handle('bak:restoreKey', (_e, id, index) => withLock(() => restoreKey(id, index)));
ipcMain.handle('bak:restoreFolder', (_e, id, index) => withLock(() => restoreFolder(id, index)));
ipcMain.handle('bak:delete', (_e, id) => withLock(() => deleteBackup(id)));
ipcMain.handle('bak:open', async (_e, id) => shell.openPath(await backupDir(id)));
ipcMain.handle('left:openBackups', async () => {
  await fs.mkdir(backupRoot(), { recursive: true });
  return shell.openPath(backupRoot());
});
// Disk space page. The window never sends a path: a scan starts at a named place, and rows are named by the ids main gave out.
ipcMain.handle('disk:drives', () => disk.drives());
ipcMain.handle('disk:starts', () => disk.startList());
ipcMain.handle('disk:scanStart', (_e, key) => disk.scanStart(key));
ipcMain.handle('disk:scanChild', (_e, id) => disk.scanChild(id));
ipcMain.handle('disk:cancel', () => disk.cancel());
ipcMain.handle('disk:reveal', (_e, id) => shell.showItemInFolder(disk.resolve(id)));
// Large files in Downloads: only files from the latest scan, by id, and only to the Recycle Bin.
let lastLarge = new Map(); // id -> { path, name, bytes, modifiedMs }
let largeSeq = 0; // ids never repeat, so an id from an older scan is refused instead of pointing at a different file
ipcMain.handle('dl:scan', async (_e, minMb) => {
  if (typeof minMb !== 'number' || !Number.isFinite(minMb) || minMb < 1 || minMb > 1_000_000) throw new Error('Choose a size of at least 1 MB.');
  const r = await scanLarge(app.getPath('downloads'), { minBytes: Math.round(minMb * 1048576) });
  const files = (await annotate(r.files)).map((f) => ({ ...f, id: String(++largeSeq) }));
  lastLarge = new Map(files.map((f) => [f.id, { path: f.path, name: f.name, bytes: f.bytes, modifiedMs: f.modifiedMs }]));
  return { ...r, files: files.map((f) => ({ id: f.id, name: f.name, folder: f.folder, bytes: f.bytes, modifiedMs: f.modifiedMs, ageDays: f.ageDays, whyNot: f.whyNot })) };
});
ipcMain.handle('dl:trash', (_e, ids) => {
  if (!Array.isArray(ids) || !ids.length || ids.length > 300 || !ids.every((i) => lastLarge.has(i))) throw new Error('Scan Downloads first, then choose from that list.');
  const items = [...new Set(ids)].map((i) => ({ id: i, ...lastLarge.get(i) }));
  return withLock(async () => {
    const r = await trashLarge(app.getPath('downloads'), items, { trashItem: (p) => shell.trashItem(p) });
    const byPath = new Map(items.map((i) => [i.path, i]));
    const results = r.results.map(({ path: p, bytes, ok, already, error }) => ({ id: byPath.get(p).id, name: byPath.get(p).name, bytes, ok, already: already ?? false, error: error ?? null }));
    results.filter((x) => x.ok).forEach((x) => lastLarge.delete(x.id)); // gone: the id is no longer valid
    return { results, moved: r.moved, failed: r.failed, freedBytes: r.freedBytes };
  });
});
ipcMain.handle('dl:reveal', (_e, id) => {
  const f = lastLarge.get(id);
  if (!f) throw new Error('That file is not in the latest scan.');
  shell.showItemInFolder(f.path);
});
ipcMain.handle('bin:list', () => listBin());
ipcMain.handle('bin:empty', () => withLock(() => emptyBin()));
ipcMain.handle('cache:scan', async () => (await discoverCaches()).map((g) => ({ ...g, dirs: g.dirs.map(({ label, bytes, partial }) => ({ label, bytes, partial })) }))); // labels only, no paths
ipcMain.handle('cache:clear', (_e, ids) => withLock(() => clearCaches(ids)));
ipcMain.handle('bat:now', () => getBattery()); // read-only: numbers and words only, no battery id or serial number
ipcMain.handle('bat:report', () => batteryReport());
ipcMain.handle('drv:list', listDrivers);
// Only an update the latest scan listed can be installed: the window names it by id, and the revision comes from this list.
let driverUpdates = new Map();
ipcMain.handle('drv:updates', async () => {
  const scan = await scanDriverUpdates();
  driverUpdates = new Map(scan.updates.filter((u) => u.id && u.revision !== null).map((u) => [u.id, u]));
  return scan;
});
ipcMain.handle('drv:install', (_e, id) => {
  const u = typeof id === 'string' ? driverUpdates.get(id.toLowerCase()) : null;
  if (!u) throw new Error('Check Windows Update first, then install from that list.');
  driverUpdates.delete(u.id); // one try per scan: check again before the next
  return withLock(() => installDriverUpdate({ id: u.id, revision: u.revision }));
});
ipcMain.handle('drv:open', (_e, key) => {
  if (!Object.hasOwn(LINKS, key)) throw new Error('Unknown link.'); // only addresses from the fixed list are ever opened
  return shell.openExternal(LINKS[key]);
});
ipcMain.handle('ui:setTheme', (_e, mode) => {
  // Also themes the window frame and makes prefers-color-scheme follow the choice.
  if (['light', 'dark', 'system'].includes(mode)) nativeTheme.themeSource = mode;
});

// ---- Automation: settings, the tray, warnings and the cleaning of old temp files (see PLAN.md, Phase 14) ----

const gotLock = app.requestSingleInstanceLock(); // a second copy hands over to the running one
if (!gotLock) app.quit();
const settings = createSettings({ file: path.join(app.getPath('userData'), 'settings.json') });
settings.load();
// with WEBASE_DATA_DIR (test copies) the activity list stays in that folder too, so a test never writes into the real one
const activity = createActivity({ file: path.join(process.env.WEBASE_DATA_DIR ? path.resolve(process.env.WEBASE_DATA_DIR) : defaultDir(), 'automation.jsonl') });
const autoCleaner = makeCleaner({ defaultTargets, scanTarget, deleteTarget });
const iconPath = path.join(__dirname, '../build/icon.png');
const INDEX = path.join(__dirname, '../dist/webase-app/browser/index.html');
let win = null;
let tray = null;
let quitting = false;
let automation = null;
let previewToken = null; // the cleaning can only be switched on after a preview was made (and confirmed in the window)

function createWindow(route) {
  win = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 960,
    minHeight: 600,
    show: false,
    autoHideMenuBar: true,
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  const mine = win;
  mine.once('ready-to-show', () => mine.show());
  mine.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mine.webContents.on('will-navigate', (e) => e.preventDefault());
  // Closing to the tray frees the window (and its memory). While an install or a cleaning is running the window is only hidden, so the work is not cut off.
  mine.on('close', (e) => {
    if (!quitting && settings.get().tray && (isBusy() || cleaning.heldBy())) {
      e.preventDefault();
      mine.hide();
    }
  });
  mine.on('closed', () => { if (win === mine) win = null; });
  // the page is created already pointing at the right route: a message sent before it has loaded would be lost
  mine.loadFile(INDEX, route && ROUTES.includes(route) ? { hash: route } : undefined);
}

// With WEBASE_DATA_DIR (test copies) a few lifecycle lines go to trace.log in that folder; nothing is traced otherwise.
const trace = process.env.WEBASE_DATA_DIR
  ? (m) => { try { require('fs').appendFileSync(path.join(path.resolve(process.env.WEBASE_DATA_DIR), 'trace.log'), `${new Date().toISOString()} ${m}\n`); } catch { /* tracing must never break the app */ } }
  : () => {};

function showWindow(route) {
  trace(`showWindow ${route ?? ''} window=${win && !win.isDestroyed() ? 'exists' : 'none'}`);
  if (win && !win.isDestroyed()) {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
    if (route && ROUTES.includes(route)) win.webContents.send('app:navigate', route);
    return;
  }
  createWindow(route);
}

const notifier = createNotifier({ Notification, getTray: () => tray, settings, activity, onOpen: (route) => showWindow(route), log, trace });

// A menu action: traced (test copies) and never allowed to throw into the main process.
const menuAction = (name, fn) => (item) => {
  trace(`tray menu: ${name}${item?.checked === undefined ? '' : ` checked=${item.checked}`}`);
  try { fn(item); } catch (e) { log.error(`tray menu ${name}`, e); }
};

function trayMenu() {
  const s = settings.get();
  const paused = Date.now() < s.quietUntil;
  return Menu.buildFromTemplate([
    { label: 'Open Webase System Monitor', click: menuAction('open', () => showWindow()) },
    { type: 'separator' },
    { label: 'Automation', type: 'checkbox', checked: s.automation, click: menuAction('automation', (item) => applyPatch({ automation: item.checked })) },
    { label: paused ? 'Resume warnings' : 'Pause warnings for 1 hour', click: menuAction(paused ? 'resume' : 'pause', () => applyPatch({ quietUntil: paused ? 0 : Date.now() + 3600_000 })) },
    { type: 'separator' },
    { label: 'Quit', click: menuAction('quit', () => { quitting = true; app.quit(); }) },
  ]);
}

function syncTray() {
  const s = settings.get();
  if (s.tray && !tray) {
    tray = new Tray(nativeImage.createFromPath(iconPath).resize({ width: 32, height: 32 }));
    tray.setToolTip('Webase System Monitor');
    tray.on('click', () => { trace('tray click'); showWindow(); });
    tray.on('right-click', () => trace('tray right-click'));
  } else if (!s.tray && tray) {
    tray.destroy();
    tray = null;
  }
  tray?.setContextMenu(trayMenu());
}

// Start with Windows: a value in the current user's Run key that starts this exe hidden in the tray. Only the packaged exe registers (a development run would
// register Electron itself). It is registered again at every start, so a moved folder is corrected as soon as the app is run from its new place.
const LOGIN = { path: process.execPath, args: ['--hidden'] };
const LOGIN_NAME = 'Webase System Monitor'; // the value's name in the Run key (without it Electron names it after its own default)

function syncLoginItem() {
  if (!app.isPackaged) return;
  const on = settings.get().startWithWindows;
  app.setLoginItemSettings({ openAtLogin: on, name: LOGIN_NAME, ...LOGIN });
}

// Windows only reports the entry when asked with the same path and arguments it was registered with.
function loginItemOn() {
  const s = app.getLoginItemSettings(LOGIN);
  return s.openAtLogin || (s.launchItems ?? []).some((i) => i.enabled !== false);
}

// One place where a change takes effect: stored, then the tray, the start-up entry and the menu follow.
function applyPatch(patch, opts) {
  settings.patch(patch, opts);
  syncTray();
  syncLoginItem();
  return currentAutomation();
}

function currentAutomation() {
  return {
    settings: settings.pub(),
    status: automation?.status() ?? { master: false, jobs: {} },
    recent: activity.recent(40),
    loginItem: app.isPackaged ? loginItemOn() : null,
    packaged: app.isPackaged,
    trayRunning: !!tray,
  };
}

ipcMain.handle('auto:get', () => currentAutomation());
ipcMain.handle('auto:set', (_e, patch) => {
  const p = patch && typeof patch === 'object' ? { ...patch } : {};
  if ('quietUntil' in p) p.quietUntil = Number.isFinite(p.quietUntil) ? Math.min(Math.max(0, p.quietUntil), Date.now() + 24 * 3600_000) : 0;
  return applyPatch(p); // only the allow-listed, checked keys take effect (settings.js); the cleaning cannot be switched on from here
});
ipcMain.handle('auto:test', () => notifier.notify({ id: 'test', title: 'Webase test notification', body: 'If you can read this, warnings will reach you.', route: '/automation' }));
ipcMain.handle('auto:cleanPreview', async () => {
  const targets = await autoCleaner.preview();
  previewToken = { id: crypto.randomUUID(), at: Date.now() };
  return { token: previewToken.id, targets };
});
ipcMain.handle('auto:cleanEnable', (_e, token) => {
  if (!previewToken || typeof token !== 'string' || token !== previewToken.id || Date.now() - previewToken.at > 10 * 60_000) throw new Error('Look at what would be cleaned first, then confirm.');
  previewToken = null;
  return applyPatch({ clean: { on: true } }, { internal: true });
});

// A way to quit that does not depend on the tray menu. It refuses while an install or a cleaning is running, so that work is not cut off.
ipcMain.handle('app:quit', () => {
  if (isBusy() || cleaning.heldBy()) throw new Error('An install or a cleaning is running. Wait for it to finish, then quit.');
  trace('quit asked from the window');
  quitting = true;
  app.quit();
});

app.on('second-instance', () => showWindow());
app.on('before-quit', () => { quitting = true; });

app.whenReady().then(() => {
  if (!gotLock) return;
  automation = createAutomation({
    settings,
    notify: notifier.notify,
    readers: {
      disks: getDisks,
      battery: getBattery,
      updates: listAppUpdates,
      startup: listStartup,
      onBattery: () => powerMonitor.isOnBatteryPower(),
      idleSeconds: () => powerMonitor.getSystemIdleTime(),
    },
    cleaner: autoCleaner,
    activity,
    ownEntry: (e) => /webase system monitor/i.test(`${e.name} ${e.command}`),
    log,
  });
  syncTray();
  syncLoginItem();
  automation.start();
  // started by Windows at sign-in (--hidden) with the tray on: no window until the tray icon or a warning is clicked
  if (!(process.argv.includes('--hidden') && settings.get().tray)) createWindow();
});

// In tray mode the app keeps running (watching) when the last window is closed.
app.on('window-all-closed', () => {
  if (!settings.get().tray || quitting) app.quit();
});
