const { promisify } = require('util');
const execFile = promisify(require('child_process').execFile);

// A read-only look at Windows' own protection: antivirus, firewall, disk encryption, Secure Boot, Smart App Control, UAC, pending restart and
// how recent the last Windows update is. Every fact is read without administrator rights (a read that would need them is shown as
// "could not read", never asked for), nothing is changed, and it runs only when the page opens or "Check again" is pressed.

const SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding $false
$av = @(Get-CimInstance -Namespace root/SecurityCenter2 -ClassName AntiVirusProduct | ForEach-Object { @{ name = [string]$_.displayName; state = [int]$_.productState } })
$mp = Get-MpComputerStatus | Select-Object AntivirusEnabled, RealTimeProtectionEnabled, AntivirusSignatureAge
$fw = @(Get-NetFirewallProfile | ForEach-Object { @{ name = [string]$_.Name; enabled = [bool]($_.Enabled -eq 'True' -or $_.Enabled -eq 1) } })
$bl = (New-Object -ComObject Shell.Application).NameSpace($env:SystemDrive + '\').Self.ExtendedProperty('System.Volume.BitLockerProtection')
$sb = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\SecureBoot\State').UEFISecureBootEnabled
$sac = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy').VerifiedAndReputablePolicyState
$uac = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System').EnableLUA
$reboot = (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired') -or (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending')
$hf = Get-HotFix | Where-Object { $_.InstalledOn } | Sort-Object InstalledOn -Descending | Select-Object -First 1
ConvertTo-Json -Compress -Depth 4 -InputObject @{ av = $av; mp = $mp; fw = $fw; bl = $bl; sb = $sb; sac = $sac; uac = $uac; reboot = $reboot; hotfix = $(if ($hf) { $hf.InstalledOn.ToString('yyyy-MM-dd') } else { $null }) }
`;

const STALE_DEFINITIONS_DAYS = 7;
const STALE_UPDATE_DAYS = 60;

// "ok" is fine, "warn" is worth a look, "info" is a fact that is not judged (or could not be read).
const check = (id, label, status, detail) => ({ id, label, status, detail });
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Security Center's productState: the digit at 0x1000 is 1 when the product is on (397568 = 0x61100 on, 393472 = 0x60100 off).
const avOn = (state) => isNum(state) && ((state >> 12) & 0xf) === 1;

function evaluate(raw, now = Date.now()) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const checks = [];

  // antivirus
  const mp = r.mp && typeof r.mp === 'object' ? r.mp : null;
  const others = (Array.isArray(r.av) ? r.av : []).filter((a) => a && typeof a.name === 'string' && !/windows defender|microsoft defender/i.test(a.name));
  const defenderOn = !!mp && mp.AntivirusEnabled === true && mp.RealTimeProtectionEnabled === true;
  const otherOn = others.find((a) => avOn(a.state));
  if (defenderOn) {
    const age = isNum(mp.AntivirusSignatureAge) ? mp.AntivirusSignatureAge : null;
    if (age !== null && age > STALE_DEFINITIONS_DAYS) checks.push(check('antivirus', 'Antivirus', 'warn', `Microsoft Defender is on, but its definitions are ${age} days old.`));
    else checks.push(check('antivirus', 'Antivirus', 'ok', `Microsoft Defender real-time protection is on${age === null ? '' : age === 0 ? ', definitions up to date today' : `, definitions ${age} day${age === 1 ? '' : 's'} old`}.`));
  } else if (otherOn) {
    checks.push(check('antivirus', 'Antivirus', 'ok', `${otherOn.name.slice(0, 80)} reports that it is on.`));
  } else if (mp || (Array.isArray(r.av) && r.av.length)) {
    checks.push(check('antivirus', 'Antivirus', 'warn', 'No antivirus is reporting real-time protection.'));
  } else {
    checks.push(check('antivirus', 'Antivirus', 'info', 'Windows did not report an antivirus product.'));
  }

  // firewall
  const fw = (Array.isArray(r.fw) ? r.fw : []).filter((p) => p && typeof p.name === 'string' && typeof p.enabled === 'boolean');
  if (!fw.length) checks.push(check('firewall', 'Firewall', 'info', 'Could not read the firewall profiles.'));
  else {
    const off = fw.filter((p) => !p.enabled).map((p) => p.name);
    checks.push(off.length ? check('firewall', 'Firewall', 'warn', `Off for the ${off.join(', ')} network profile${off.length > 1 ? 's' : ''}.`) : check('firewall', 'Firewall', 'ok', 'On for every network profile.'));
  }

  // disk encryption (the system drive)
  if (r.bl === 1) checks.push(check('bitlocker', 'Disk encryption', 'ok', 'BitLocker protection is on for the system drive.'));
  else if (r.bl === 0) checks.push(check('bitlocker', 'Disk encryption', 'warn', 'The system drive is not encrypted: anyone with the PC can read its files. Device encryption or BitLocker would protect it.'));
  else checks.push(check('bitlocker', 'Disk encryption', 'info', 'Could not read the BitLocker state without administrator rights.'));

  // Secure Boot
  if (r.sb === 1) checks.push(check('secureboot', 'Secure Boot', 'ok', 'On.'));
  else if (r.sb === 0) checks.push(check('secureboot', 'Secure Boot', 'warn', 'Off. The PC starts without checking that its boot files are trusted.'));
  else checks.push(check('secureboot', 'Secure Boot', 'info', 'Not reported (an older BIOS start, or not readable).'));

  // Smart App Control: a choice, not a fault
  if (r.sac === 1) checks.push(check('sac', 'Smart App Control', 'ok', 'On: Windows blocks unsigned or unknown apps.'));
  else if (r.sac === 2) checks.push(check('sac', 'Smart App Control', 'info', 'In evaluation mode: Windows is learning whether to turn it on.'));
  else if (r.sac === 0) checks.push(check('sac', 'Smart App Control', 'info', 'Off.'));
  else checks.push(check('sac', 'Smart App Control', 'info', 'Not available on this version of Windows.'));

  // User Account Control
  if (r.uac === 1) checks.push(check('uac', 'User Account Control', 'ok', 'On: changes that need administrator rights ask first.'));
  else if (r.uac === 0) checks.push(check('uac', 'User Account Control', 'warn', 'Off: programs can make administrator changes without asking.'));
  else checks.push(check('uac', 'User Account Control', 'info', 'Could not read the setting.'));

  // updates
  if (r.reboot === true) checks.push(check('restart', 'Restart pending', 'warn', 'Windows needs a restart to finish installing updates.'));
  else if (r.reboot === false) checks.push(check('restart', 'Restart pending', 'ok', 'No restart is waiting.'));
  else checks.push(check('restart', 'Restart pending', 'info', 'Could not read.'));

  const when = typeof r.hotfix === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.hotfix) ? Date.parse(`${r.hotfix}T00:00:00`) : NaN;
  if (Number.isNaN(when)) checks.push(check('updates', 'Windows updates', 'info', 'Windows did not list a recent update.'));
  else {
    const days = Math.max(0, Math.floor((now - when) / 86_400_000));
    checks.push(days > STALE_UPDATE_DAYS ? check('updates', 'Windows updates', 'warn', `The last update was installed ${days} days ago (${r.hotfix}).`) : check('updates', 'Windows updates', 'ok', `The last update was installed ${days === 0 ? 'today' : `${days} day${days === 1 ? '' : 's'} ago`} (${r.hotfix}).`));
  }

  const count = (s) => checks.filter((c) => c.status === s).length;
  return { checks, summary: { ok: count('ok'), warn: count('warn'), info: count('info') }, readAt: now };
}

let inFlight = null; // one read at a time

async function getSecurity(overrides = {}) {
  if (inFlight) return inFlight;
  const run = overrides.run ?? (async () => {
    const { stdout } = await execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', SCRIPT], { timeout: 60_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 });
    return JSON.parse(stdout.replace(/^﻿/, '').trim() || 'null');
  });
  inFlight = run()
    .then((raw) => evaluate(raw, overrides.now ?? Date.now()))
    .finally(() => { inFlight = null; });
  return inFlight;
}

module.exports = { getSecurity, evaluate, avOn, STALE_DEFINITIONS_DAYS, STALE_UPDATE_DAYS };
