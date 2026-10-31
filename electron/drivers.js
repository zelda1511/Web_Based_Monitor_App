const { promisify } = require('util');
const execFile = promisify(require('child_process').execFile);

// Everything here only reads. Nothing downloads or installs a driver.

// The window asks to open one of these by key; it never supplies a URL.
const LINKS = {
  nvidia: 'https://www.nvidia.com/Download/index.aspx',
  amd: 'https://www.amd.com/en/support/download/drivers.html',
  intel: 'https://www.intel.com/content/www/us/en/download-center/home.html',
  'optional-updates': 'ms-settings:windowsupdate-optionalupdates',
  'app-control': 'windowsdefender://appbrowser', // Windows Security > App & browser control (where Smart App Control is)
};

const LIST_SCRIPT = String.raw`
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$ents = @(Get-CimInstance Win32_PnPEntity)
$byId = @{}
foreach ($e in $ents) { if ($e.DeviceID) { $byId[[string]$e.DeviceID] = $e } }
$d = Get-CimInstance Win32_PnPSignedDriver | Where-Object { $_.DeviceName } | ForEach-Object {
  $e = $byId[[string]$_.DeviceID]
  [pscustomobject]@{
    name = $_.DeviceName; cls = $_.DeviceClass; provider = $_.DriverProviderName; manufacturer = $_.Manufacturer
    version = $_.DriverVersion; signed = $_.IsSigned
    date = if ($_.DriverDate) { $_.DriverDate.ToUniversalTime().ToString('yyyy-MM-dd') } else { $null }
    deviceId = $_.DeviceID
    hardwareIds = if ($e -and $e.HardwareID) { @($e.HardwareID) } else { @() }
  }
}
$p = $ents | Where-Object { $_.ConfigManagerErrorCode -gt 0 } | ForEach-Object {
  [pscustomobject]@{ name = $_.Name; code = [int]$_.ConfigManagerErrorCode; cls = $_.PNPClass }
}
ConvertTo-Json -InputObject @{ drivers = @($d); problems = @($p) } -Compress -Depth 4
`;

// Searches Windows Update for driver updates that are not installed. A search only; it does not download anything.
const UPDATE_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$session = New-Object -ComObject Microsoft.Update.Session
$result = $session.CreateUpdateSearcher().Search("IsInstalled=0 and Type='Driver'")
$u = foreach ($x in $result.Updates) {
  [pscustomobject]@{
    id = $x.Identity.UpdateID; revision = [int]$x.Identity.RevisionNumber
    title = $x.Title; manufacturer = $x.DriverManufacturer; model = $x.DriverModel; cls = $x.DriverClass; hardwareId = $x.DriverHardwareID
    date = if ($x.DriverVerDate) { ([datetime]$x.DriverVerDate).ToString('yyyy-MM-dd') } else { $null }
    sizeBytes = [int64]$x.MaxDownloadSize; downloaded = [bool]$x.IsDownloaded
  }
}
ConvertTo-Json -InputObject @{ resultCode = [int]$result.ResultCode; updates = @($u) } -Compress -Depth 4
`;

const PROBLEMS = {
  1: 'Not set up correctly', 10: 'Cannot start', 12: 'No free resources', 14: 'Needs a restart', 18: 'Drivers need reinstalling',
  19: 'Registry problem', 22: 'Turned off', 24: 'Not present or not working', 28: 'No driver installed', 31: 'Not working properly',
  37: 'Driver failed to start', 39: 'Driver corrupted or missing', 40: 'Missing registry information', 41: 'Windows cannot load the driver',
  43: 'Stopped by Windows after reporting a problem', 45: 'Not connected', 48: 'Driver blocked from starting', 52: 'Windows cannot verify the driver signature',
};

const YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;
const OLD_YEARS = 3;

// NVIDIA's own version (e.g. 562.01) is the last five digits of Windows' version (32.0.15.6201).
function nvidiaVersion(version) {
  const m = /^\d+\.\d+\.(\d+)\.(\d+)$/.exec(version || '');
  if (!m) return null;
  const digits = (m[1] + m[2]).slice(-5);
  return digits.length === 5 ? `${digits.slice(0, 3)}.${digits.slice(3)}` : null;
}

// Hardware or software component? The first part of a device's instance id (PCI, USB, ACPI, SWD...) says who made the device
// appear, which is more reliable than its class: "Nahimic VAD" is class MEDIA but a software device, and "NVIDIA Platform
// Controllers" is class SOFTWAREDEVICE but sits on the ACPI bus. The class only decides for a bus not listed here.
const SOFTWARE_BUSES = new Set(['root', 'sw', 'swd', 'swc']); // virtual and software-made devices (a {GUID} bus too)
const HARDWARE_BUSES = new Set(['pci', 'usb', 'acpi', 'acpi_hal', 'acp', 'hdaudio', 'hid', 'display', 'scsi', 'uefi', 'ide', 'nvme', 'sd', 'sdbus', 'usbstor']); // 'bth*' too
const SOFTWARE_CLASSES = new Set(['softwaredevice', 'softwarecomponent', 'audioprocessingobject', 'audioendpoint', 'printqueue', 'volume', 'volumesnapshot', 'extension']);
const KINDS = {
  display: 'Graphics', monitor: 'Monitor', net: 'Network', media: 'Audio', bluetooth: 'Bluetooth', usb: 'USB', usbdevice: 'USB',
  hidclass: 'Input', keyboard: 'Input', mouse: 'Input', scsiadapter: 'Storage', diskdrive: 'Storage', hdc: 'Storage', cdrom: 'Storage',
  camera: 'Camera', image: 'Camera', firmware: 'Firmware', battery: 'Battery',
  system: 'Chipset and system', processor: 'Chipset and system', securitydevices: 'Chipset and system', ucm: 'Chipset and system', computer: 'Chipset and system',
};

function busOf(deviceId) {
  return String(deviceId || '').split('\\')[0].toLowerCase();
}

function classify(deviceId, cls) {
  const bus = busOf(deviceId);
  const c = String(cls || '').toLowerCase();
  let hardware;
  if (!bus) hardware = !!c && !SOFTWARE_CLASSES.has(c); // no instance id: the class is all there is, and no class means nothing to go on
  else if (SOFTWARE_BUSES.has(bus) || bus.startsWith('{')) hardware = false;
  else if (HARDWARE_BUSES.has(bus) || bus.startsWith('bth')) hardware = true;
  else hardware = !SOFTWARE_CLASSES.has(c);
  if (!hardware) return { hardware, kind: 'Software component' };
  if (bus.startsWith('bth')) return { hardware, kind: 'Bluetooth' };
  if (bus === 'hdaudio' || bus === 'acp') return { hardware, kind: 'Audio' };
  return { hardware, kind: KINDS[c] ?? (bus === 'uefi' ? 'Firmware' : 'Other hardware') };
}

// Makers whose own driver page the app can open (LINKS keys). Nothing here knows whether a newer driver exists there.
function vendorOf(provider) {
  const p = String(provider || '');
  if (/nvidia/i.test(p)) return 'nvidia';
  if (/advanced micro|\bamd\b|ati technologies/i.test(p)) return 'amd';
  if (/\bintel\b/i.test(p)) return 'intel';
  return null;
}

const hardwareIdList = (raw) => [].concat(raw ?? []).filter((h) => typeof h === 'string').map((h) => h.trim().toLowerCase().slice(0, 200)).filter(Boolean).slice(0, 40);

function parseDrivers(raw, now = Date.now()) {
  return [].concat(raw ?? [])
    .filter((d) => d && d.name)
    .map((d) => {
      const provider = d.provider || d.manufacturer || null;
      const microsoft = /^microsoft/i.test(provider || '');
      const ageMs = d.date ? now - Date.parse(d.date) : null;
      return {
        name: d.name,
        cls: d.cls || null,
        provider,
        version: d.version || null,
        friendlyVersion: /nvidia/i.test(provider || '') && d.cls === 'DISPLAY' ? nvidiaVersion(d.version) : null,
        date: d.date || null,
        signed: typeof d.signed === 'boolean' ? d.signed : null, // unknown stays unknown, so it is not flagged
        microsoft,
        // Old is only a hint: a stable driver can be years old and fine. Windows' own inbox drivers are not flagged.
        old: !microsoft && ageMs != null && ageMs > OLD_YEARS * YEAR_MS,
        ...classify(d.deviceId, d.cls),
        vendor: vendorOf(provider),
        deviceId: typeof d.deviceId === 'string' && d.deviceId ? d.deviceId : null,
        hardwareIds: hardwareIdList(d.hardwareIds), // main process only: listDrivers() does not send them to the window
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function parseProblems(raw) {
  return [].concat(raw ?? [])
    .filter((p) => p && p.name)
    .map((p) => ({ name: p.name, code: p.code, cause: PROBLEMS[p.code] || `Error code ${p.code}` }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function parseUpdates(raw) {
  return [].concat(raw ?? [])
    .filter((u) => u && u.title)
    .map((u) => ({
      id: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(u.id ?? '') ? String(u.id).toLowerCase() : null, // only an update with a real id can be installed
      revision: Number.isInteger(u.revision) && u.revision >= 0 ? u.revision : null,
      title: u.title,
      manufacturer: u.manufacturer || null,
      model: u.model || null,
      cls: u.cls || null,
      hardwareId: typeof u.hardwareId === 'string' && u.hardwareId.trim() ? u.hardwareId.trim().toLowerCase().slice(0, 200) : null, // the device this driver is for
      date: u.date || null,
      sizeBytes: u.sizeBytes > 0 ? u.sizeBytes : null,
      downloaded: !!u.downloaded,
    }))
    .sort((a, b) => a.title.localeCompare(b.title));
}

const run = (script, timeout) =>
  execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { maxBuffer: 16 * 1024 * 1024, timeout, windowsHide: true });
const json = (stdout) => JSON.parse(stdout.replace(/^﻿/, ''));

async function readDrivers() {
  const { stdout } = await run(LIST_SCRIPT, 60000);
  const data = json(stdout);
  return { drivers: parseDrivers(data.drivers), problems: parseProblems(data.problems) };
}

async function listDrivers() {
  const { drivers, problems } = await readDrivers();
  return { drivers: drivers.map(({ hardwareIds, ...row }) => row), problems };
}

// Which installed devices is each update for? Only an exact match of the update's hardware id with one of the device's own hardware ids
// counts (case aside). Compatible ids are left out on purpose: a generic one such as PCI\CC_0C05 would put "update available" on every
// device of that kind. No guessing from names either: an update that matches nothing stays in the update list and is installed from there.
function matchUpdates(drivers, updates) {
  const devices = new Map(); // hardware id -> device ids that have it
  for (const d of drivers) {
    if (!d.deviceId) continue;
    for (const h of d.hardwareIds ?? []) {
      if (!devices.has(h)) devices.set(h, new Set());
      devices.get(h).add(d.deviceId);
    }
  }
  return updates.map((u) => ({ ...u, deviceIds: u.hardwareId ? [...(devices.get(u.hardwareId) ?? [])] : [] }));
}

async function scanDriverUpdates() {
  let stdout;
  try {
    ({ stdout } = await run(UPDATE_SCRIPT, 180000));
  } catch (e) {
    const detail = String(e.stderr || e.message);
    if (/0x80072EE7|0x80072EFD|0x80072EE2|0x8024402C|0x80072F8F/i.test(detail)) throw new Error('Could not reach Windows Update. Check your internet connection and try again.');
    throw new Error(`The Windows Update search failed. ${detail.split('\n').find((l) => l.trim()) || ''}`.trim());
  }
  const data = json(stdout);
  if (data.resultCode !== 2) throw new Error('The Windows Update search did not finish. Try again.');
  return { updates: parseUpdates(data.updates), checkedAt: Date.now() };
}

// What the Drivers page asks for: the Windows Update search, with each update tied to the installed devices it is for. The list read
// runs at the same time; if it fails the updates still come back, just without any device attached.
async function checkDriverUpdates(d = {}) {
  const [scan, list] = await Promise.all([(d.scan ?? scanDriverUpdates)(), (d.read ?? readDrivers)().catch(() => null)]);
  return { ...scan, updates: matchUpdates(list?.drivers ?? [], scan.updates) };
}

module.exports = { listDrivers, readDrivers, scanDriverUpdates, checkDriverUpdates, matchUpdates, classify, vendorOf, parseDrivers, parseProblems, parseUpdates, nvidiaVersion, LINKS };
