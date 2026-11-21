const fs = require('fs');
const os = require('os');
const path = require('path');
const { promisify } = require('util');
const execFile = promisify(require('child_process').execFile);
const { withLock } = require('./lock');
const { explainFailure } = require('./blocked');

// Lists updates, searches, shows details, and installs one package on request (installApp).
// winget has no JSON output for these, so its text tables are read by column position.
// shortcut: assumes winget's English table headers and "Key: value" lines; other display languages need a different reader.

const NOT_FOUND = [-1978335212, 2316632084]; // 0x8A150014 "no package found", signed and unsigned spellings

// How many terminal columns a character takes. winget pads its tables by this, so wide (CJK) characters need two.
function width(ch) {
  const c = ch.codePointAt(0);
  const wide =
    (c >= 0x1100 && c <= 0x115f) || (c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) || (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe6f) || (c >= 0xff00 && c <= 0xff60) || (c >= 0xffe0 && c <= 0xffe6) || (c >= 0x1f300 && c <= 0x1f64f) ||
    (c >= 0x1f900 && c <= 0x1f9ff) || (c >= 0x20000 && c <= 0x3fffd);
  return wide ? 2 : 1;
}

// Display column where each header word starts.
function columnStarts(header) {
  const starts = [];
  let x = 0;
  let prev = ' ';
  for (const ch of header) {
    if (ch !== ' ' && prev === ' ') starts.push(x);
    prev = ch;
    x += width(ch);
  }
  return starts;
}

function splitByColumns(line, starts) {
  const cells = starts.map(() => '');
  let x = 0;
  for (const ch of line) {
    let k = starts.length - 1;
    while (k > 0 && x < starts[k]) k--;
    cells[k] += ch;
    x += width(ch);
  }
  return cells.map((s) => s.trim());
}

function charAtColumn(line, col) {
  let x = 0;
  for (const ch of line) {
    if (x === col) return ch;
    x += width(ch);
  }
  return undefined;
}

// A table row has text in the second column and a space just before it. Footers like "10 upgrades available." do not.
const isRow = (line, starts) => charAtColumn(line, starts[1] - 1) === ' ' && !!charAtColumn(line, starts[1]) && charAtColumn(line, starts[1]) !== ' ';

function parseTables(text) {
  const lines = String(text ?? '').replace(/^﻿/, '').replace(/\r(?!\n)/g, '\n').split(/\r?\n/); // progress spinners end in a bare \r
  const tables = [];
  for (let i = 1; i < lines.length; i++) {
    if (!/^-{8,}\s*$/.test(lines[i])) continue;
    const starts = columnStarts(lines[i - 1]);
    if (starts.length < 3) continue;
    const rows = [];
    for (let j = i + 1; j < lines.length && lines[j].trim() && isRow(lines[j], starts); j++) rows.push(splitByColumns(lines[j], starts));
    tables.push(rows);
  }
  return tables;
}

function parseUpgrades(text) {
  return parseTables(text).flatMap((rows, k) =>
    rows
      .filter((r) => r[1] && r[3])
      .map((r) => ({ name: r[0], id: r[1], version: r[2], available: r[3], source: r[4] || null, explicit: k > 0 })),
  );
}

function parseSearch(text) {
  const [rows = []] = parseTables(text);
  const col = rows.map((r) => r[3]).filter(Boolean);
  const fourthIsSource = col.length > 0 && col.every((v) => /^(winget|msstore|winget-font)$/.test(v));
  return rows
    .filter((r) => r[0] && r[1])
    .map((r) => ({ name: r[0], id: r[1], version: r[2] || null, match: fourthIsSource ? null : r[3] || null }));
}

// Open source, free, or "check the price": a hint from the license text, not a promise.
function licenseHint(license) {
  const l = String(license ?? '');
  if (/trial|shareware|commercial|subscription|paid|\bpro\b/i.test(l)) return { kind: 'paid', label: 'May cost money' };
  if (/freeware/i.test(l)) return { kind: 'free', label: 'Freeware' };
  if (/\b(mit|gpl|lgpl|agpl|bsd|apache|mpl|isc|unlicense|cc0|epl|zlib|bsl-1\.0)\b/i.test(l)) return { kind: 'free', label: 'Open source' };
  if (/proprietary/i.test(l)) return { kind: 'unknown', label: 'Proprietary: check the price' };
  return { kind: 'unknown', label: 'License unclear: check the price' };
}

function parseDetails(text, id) {
  const lines = String(text ?? '').split(/\r?\n/);
  const out = { id, name: id, version: null, publisher: null, homepage: null, license: null, licenseUrl: null, description: null, installerType: null };
  const found = lines.find((l) => l.includes(`[${id}]`));
  if (found) out.name = found.replace(/^[^\s]+\s+/, '').replace(/\s*\[[^\]]*\]\s*$/, '') || id;
  const top = (key) => lines.find((l) => l.startsWith(`${key}:`))?.slice(key.length + 1).trim() || null;
  out.version = top('Version');
  out.publisher = top('Publisher');
  out.homepage = top('Homepage');
  out.license = top('License');
  out.licenseUrl = top('License Url');
  out.installerType = lines.find((l) => /^\s+Installer Type:/.test(l))?.split(':')[1].trim() || null;
  const d = lines.findIndex((l) => l.startsWith('Description:'));
  if (d >= 0) {
    const body = [];
    for (let i = d + 1; i < lines.length && /^\s/.test(lines[i]); i++) body.push(lines[i].trim());
    out.description = body.join(' ').replace(/\s+/g, ' ').trim().slice(0, 600) || null;
  }
  return { ...out, hint: licenseHint(out.license) };
}

// What the window may ask winget about: plain search words and package ids only, never anything that looks like an option.
const QUERY = /^[\p{L}\p{N}][\p{L}\p{N} ._+#-]{0,63}$/u;
const PACKAGE_ID = /^[A-Za-z0-9][A-Za-z0-9._+-]{0,127}$/;

// Runs winget and returns its exit code and output. Only a missing winget or a timeout throws.
async function exec(args, timeout) {
  try {
    const { stdout } = await execFile('winget.exe', [...args, '--disable-interactivity'], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, timeout, windowsHide: true });
    return { code: 0, stdout };
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error("winget is not available on this PC. Install 'App Installer' from the Microsoft Store.");
    if (e.killed) throw new Error('winget took too long to answer. Try again.');
    return { code: typeof e.code === 'number' ? e.code : -1, stdout: e.stdout || '' };
  }
}

async function run(args, timeout) {
  const { code, stdout } = await exec(args, timeout);
  if (code === 0) return stdout;
  if (NOT_FOUND.includes(code)) return ''; // "no package found" is an answer, not a failure
  throw new Error(`winget could not finish (${code}). Try again.`);
}

// The last update list, kept so an update started from the Updates page does not run `winget upgrade` (up to 2 minutes, on the
// network) a second time. The page's own list is always read fresh; only upgradeApp reuses a list younger than maxAgeMs.
function createListCache({ load, maxAgeMs = 10 * 60_000, now = Date.now }) {
  let saved = null; // { at, rows }
  return {
    async fresh() {
      const rows = await load();
      saved = { at: now(), rows };
      return rows;
    },
    async recent() {
      return saved && now() - saved.at < maxAgeMs ? saved.rows : this.fresh();
    },
    // an app that was just updated is no longer an update; the other rows stay valid
    drop(id) {
      if (saved) saved = { ...saved, rows: saved.rows.filter((u) => u.id !== id) };
    },
  };
}

const updateList = createListCache({ load: async () => parseUpgrades(await run(['upgrade'], 120000)) });
const listAppUpdates = () => updateList.fresh();

// `winget list`: what winget recognises as installed, by package id. The 4th column is "Available" only when some app has an update;
// otherwise it is "Source", which is told apart the same way parseSearch does.
function parseInstalled(text) {
  const [rows = []] = parseTables(text);
  const col = rows.map((r) => r[3]).filter(Boolean);
  const fourthIsSource = col.every((v) => /^(winget|msstore|winget-font)$/.test(v));
  return rows.filter((r) => r[0] && r[1]).map((r) => ({ name: r[0], id: r[1], version: r[2] || null, available: fourthIsSource ? null : r[3] || null }));
}

const listInstalled = async () => parseInstalled(await run(['list'], 120000));

async function searchApps(query) {
  const q = String(query ?? '').trim();
  if (!QUERY.test(q)) throw new Error('Type a few letters or digits of the app name.');
  return parseSearch(await run(['search', '--query', q, '--source', 'winget', '--count', '40'], 60000));
}

async function appDetails(id) {
  if (!PACKAGE_ID.test(String(id))) throw new Error('That is not a valid package id.');
  const text = await run(['show', '--id', id, '--exact', '--source', 'winget'], 60000);
  if (!text.trim()) throw new Error('winget has no package with that id.');
  return parseDetails(text, id);
}

const isInstalled = async (id) => (await exec(['list', '--id', id, '--exact'], 60000)).code === 0;

// The installed version of one package as winget lists it, or null.
function versionFromList(text, id) {
  const rows = parseTables(text)[0] ?? [];
  return rows.find((r) => r[1] === id)?.[2] || null;
}

// Why an update cannot be started from here (null = it can). `row` is the entry from winget's own upgrade list.
function whyNotUpgrade(row) {
  if (!row) return 'winget does not list an update for that app any more. Check again.';
  if (row.id === 'Microsoft.AppInstaller') return 'This is winget itself (App Installer). Updating it from inside winget would replace it while it is running; update it through the Microsoft Store.';
  if (row.explicit) return 'winget holds this update back (it is pinned, or must be named). Update it from a terminal.';
  if (row.source !== 'winget') return "This app updates from another source, such as the Microsoft Store, not winget's community catalogue.";
  return null;
}

// An update of a Windows Installer app first REMOVES the old version, and a silent winget run that is not elevated fails that
// step ("Error 1730: you must be an Administrator", seen live with PuTTY). So the whole upgrade runs elevated, behind one
// Windows permission prompt. The id and the output file name are checked here because they end up in a command line.
const SAFE_OUT = /^[A-Za-z]:\\[A-Za-z0-9_ .()~\\-]+$/; // "~" appears in short profile names such as C:\Users\JOHNDO~1
function elevatedCommand(verb, id, outFile) {
  if (!PACKAGE_ID.test(String(id))) throw new Error('That is not a valid package id.');
  if (!SAFE_OUT.test(outFile) || outFile.includes('..')) throw new Error('The temporary folder has characters that are not safe to use here.');
  return `/c winget.exe ${verb} --id ${id} --exact --source winget --silent --disable-interactivity > "${outFile}" 2>&1`;
}
const elevatedUpgradeCommand = (id, outFile) => elevatedCommand('upgrade', id, outFile);
const elevatedInstallCommand = (id, outFile) => elevatedCommand('install', id, outFile);

// Windows Installer packages (winget's "wix" and "msi") are installed for all users from a silent, non-elevated run only if Windows lets the
// installer service do it, which it does not (see the upgrade note above), so they run behind one permission prompt like upgrades. Other
// installer types (exe, Inno, NSIS, Burn, MSIX, portable) ask for rights themselves or need none.
const needsElevatedInstall = (installerType) => /^(wix|msi)$/i.test(String(installerType ?? ''));

const ELEVATED_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
try {
  # ProcessStartInfo, not Start-Process: a declined prompt then surfaces as a Win32Exception carrying the code 1223
  $psi = New-Object System.Diagnostics.ProcessStartInfo
  $psi.FileName = 'cmd.exe'
  $psi.Arguments = $env:WB_CMD
  $psi.Verb = 'runas'
  $psi.UseShellExecute = $true
  $p = [System.Diagnostics.Process]::Start($psi)
  $p.WaitForExit()
  'EXIT=' + $p.ExitCode
} catch {
  $e = $_.Exception
  while ($e.InnerException -and -not ($e -is [System.ComponentModel.Win32Exception])) { $e = $e.InnerException }
  if ($e -is [System.ComponentModel.Win32Exception]) { 'CODE=' + $e.NativeErrorCode }
  'ERROR=' + $_.Exception.Message
  exit 2
}
`;

// Runs one winget command line behind ONE Windows permission prompt and reports { declined, exitCode, output, error }. `build` makes the command
// from the name of the temporary output file; only the id and that file name (both checked there) ever reach the command line.
async function runElevated(build, what) {
  const outFile = path.join(os.tmpdir(), `webase-winget-${Date.now()}.txt`);
  const cmd = build(outFile);
  let run = '';
  try {
    run = (await execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ELEVATED_SCRIPT], { env: { ...process.env, WB_CMD: cmd }, timeout: 20 * 60 * 1000, windowsHide: true })).stdout;
  } catch (e) {
    run = String(e.stdout || '');
    if (!/CODE=|EXIT=/.test(run)) throw new Error(`Could not start the ${what}. ${String(e.stderr || e.message).split('\n')[0]}`);
  }
  let output = '';
  try {
    output = fs.readFileSync(outFile, 'utf8');
    fs.unlinkSync(outFile);
  } catch {
    // winget wrote nothing: the prompt was declined, or it never started
  }
  if (/CODE=1223\b/.test(run)) return { declined: true, exitCode: null, output };
  const exitCode = Number(/EXIT=(-?\d+)/.exec(run)?.[1] ?? NaN);
  if (Number.isNaN(exitCode)) return { declined: false, exitCode: null, output, error: (/ERROR=(.*)/.exec(run)?.[1] || '').trim() };
  return { declined: false, exitCode, output };
}

// `winget list --scope machine` succeeds (exit 0) only for an app installed for all users; only those need elevation.
const needsElevation = (machineListExitCode) => machineListExitCode === 0;

// Updates ONE app, and only one that winget's own list says has an update. Success is judged by the installed version changing.
async function upgradeApp(id) {
  if (!PACKAGE_ID.test(String(id))) throw new Error('That is not a valid package id.');
  return withLock(async () => {
    const startedAt = Date.now();
    const row = (await updateList.recent()).find((u) => u.id === id);
    const why = whyNotUpgrade(row);
    if (why) throw new Error(why);

    const base = { id, name: row.name, from: row.version, expected: row.available };
    const stopped = (message, exitCode = null) => ({ ...base, to: row.version, updated: false, exitCode, message });
    let exitCode;
    let output = '';

    if (needsElevation((await exec(['list', '--id', id, '--exact', '--scope', 'machine'], 60000)).code)) {
      // An all-users app: the whole upgrade runs behind one Windows permission prompt (see above).
      const r = await runElevated((outFile) => elevatedUpgradeCommand(id, outFile), 'update');
      if (r.declined) return stopped('The Windows permission prompt was declined, so nothing changed.');
      if (r.exitCode === null) return stopped(r.error || 'The update could not be started.');
      ({ exitCode, output } = r);
    } else {
      // A per-user app (including Store-style packages): no administrator rights are needed, and some installers refuse to
      // run elevated, so it runs as you.
      ({ code: exitCode, stdout: output } = await exec(['upgrade', '--id', id, '--exact', '--source', 'winget', '--silent'], 15 * 60 * 1000));
    }

    const now = versionFromList((await exec(['list', '--id', id, '--exact'], 60000)).stdout, id);
    const updated = now !== null && now !== row.version;
    if (updated) updateList.drop(id);
    return { ...base, to: now, updated, exitCode, message: updated ? null : await explainFailure(startedAt, installMessage(output, exitCode)) };
  });
}

// Windows Installer exit codes people actually meet, in plain words.
const INSTALLER_CODES = {
  1602: 'The install was cancelled. If a Windows permission prompt appeared, it was declined or timed out, so nothing changed.',
  1618: 'Another installation is already running. Try again when it has finished.',
  1925: 'Windows needs administrator permission for this install and it was not given.',
  1603: 'The installer reported a fatal error.',
};

function installMessage(output, code) {
  const text = String(output ?? '').replace(/\r(?!\n)/g, '\n');
  const installerCode = Number(/exit code:?\s*(-?\d+)/i.exec(text)?.[1]);
  if (INSTALLER_CODES[installerCode]) return INSTALLER_CODES[installerCode];
  const tail = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^[-\\|/\s█▒]+$/.test(l)).slice(-2).join(' ');
  return tail || `winget stopped with code ${code}.`;
}

// Installs one package from winget's community catalogue. Success is judged by whether winget then lists it as installed,
// not by the exit code alone.
async function installApp(id) {
  return withLock(async () => {
    const d = await appDetails(id); // checks the id is valid and really exists in the catalogue
    if (await isInstalled(id)) throw new Error(`${d.name} is already installed.`);
    const startedAt = Date.now();
    let code;
    let stdout;
    if (needsElevatedInstall(d.installerType)) {
      const r = await runElevated((outFile) => elevatedInstallCommand(id, outFile), 'install');
      if (r.declined) return { id, name: d.name, installed: false, exitCode: null, message: 'The Windows permission prompt was declined, so nothing was installed.' };
      if (r.exitCode === null) return { id, name: d.name, installed: false, exitCode: null, message: r.error || 'The install could not be started.' };
      ({ exitCode: code, output: stdout } = r);
    } else {
      ({ code, stdout } = await exec(['install', '--id', id, '--exact', '--source', 'winget', '--silent'], 10 * 60 * 1000));
    }
    const installed = await isInstalled(id);
    return { id, name: d.name, installed, exitCode: code, message: installed ? null : await explainFailure(startedAt, installMessage(stdout, code)) };
  });
}

module.exports = { createListCache, installApp, upgradeApp, elevatedUpgradeCommand, elevatedInstallCommand, needsElevatedInstall, needsElevation, whyNotUpgrade, versionFromList, installMessage, listAppUpdates, listInstalled, parseInstalled, searchApps, appDetails, parseUpgrades, parseSearch, parseDetails, parseTables, licenseHint, QUERY, PACKAGE_ID };
