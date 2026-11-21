const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseUpgrades, parseSearch, parseDetails, parseInstalled, licenseHint, installMessage, whyNotUpgrade, versionFromList, elevatedUpgradeCommand, elevatedInstallCommand, needsElevatedInstall, needsElevation, QUERY, PACKAGE_ID } = require('./winget');

// Real winget output, saved as-is (public package data).
const fixture = (name) => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

// Builds a table the way winget does: every column as wide as its longest cell, plus one space.
const table = (header, rows) => {
  const w = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)) + 1);
  const line = (cells) => cells.map((c, i) => c.padEnd(w[i])).join('').trimEnd();
  return [line(header), '-'.repeat(w.reduce((a, b) => a + b, 0) - 1), ...rows.map(line)].join('\n');
};
const UPGRADES = [
  table(['Name', 'Id', 'Version', 'Available', 'Source'], [
    ['7-Zip 26.04 (x64 edition)', '7zip.7zip', '26.04.00.0', '26.05', 'winget'],
    ['Visual Studio Build Tools 2026', 'Microsoft.VisualStudio.BuildTools', '18.10.3', '18.11.1', 'winget'],
    ['Windows Terminal', 'Microsoft.WindowsTerminal', '1.24.12741.0', '1.25.2733.0', 'winget'],
  ]),
  '3 upgrades available.',
  'The following packages have an upgrade available, but require explicit targeting for upgrade:',
  table(['Name', 'Id', 'Version', 'Available', 'Source'], [['Pinned App', 'Some.PinnedApp', '1.0', '2.0', 'winget']]),
  '1 package(s) have pins that prevent upgrade.',
  '',
].join('\n');

test('reads the upgrade table: columns by position, a one-space gap between columns, footers ignored', () => {
  const list = parseUpgrades(UPGRADES);
  assert.equal(list.length, 4);
  assert.deepEqual(list[0], { name: '7-Zip 26.04 (x64 edition)', id: '7zip.7zip', version: '26.04.00.0', available: '26.05', source: 'winget', explicit: false });
  assert.equal(list[1].name, 'Visual Studio Build Tools 2026'); // only one space before its Id
  assert.equal(list[1].id, 'Microsoft.VisualStudio.BuildTools');
  assert.equal(list[2].version, '1.24.12741.0');
  assert.equal(list[3].explicit, true, 'packages that need explicit targeting are marked');
});

test('reads the search table with wide (Chinese) names, where winget pads by display width', () => {
  const list = parseSearch(fixture('winget-search-wechat.txt'));
  assert.equal(list.length, 10);
  const wecom = list.find((x) => x.id === 'Tencent.WeCom');
  assert.deepEqual([wecom.name, wecom.version, wecom.match], ['企业微信', '5.0.13.6005', 'Tag: wechat']);
  assert.equal(list.find((x) => x.id === 'Tencent.WeixinDevTools').name, '微信开发者工具');
  assert.equal(list.find((x) => x.id === 'Tencent.WeChat.Universal').match, null);
  assert.equal(list.find((x) => x.id === 'Tencent.WeChat').match, 'ProductCode: wechat');
});

test('reads a search table where a name runs right up to the next column', () => {
  const list = parseSearch(fixture('winget-search-vlc.txt'));
  const nightly = list.find((x) => x.id === 'VideoLAN.VLC.Nightly');
  assert.deepEqual([nightly.name, nightly.version, nightly.match], ['VLC media player (Nightly)', '4.0.0.0-nightly20260509', null]);
  assert.equal(list[0].id, 'VideoLAN.VLC');
});

test('a search table whose last column is the source is not mistaken for a match column', () => {
  const text = 'Name  Id     Version Source\n-----------------------------\nApp   A.App  1.0     winget\n';
  assert.deepEqual(parseSearch(text), [{ name: 'App', id: 'A.App', version: '1.0', match: null }]);
});

test('progress spinner lines before the table are ignored; no results, empty and garbage give nothing', () => {
  const noisy = '   - \r   \\ \r   | \r' + UPGRADES;
  assert.equal(parseUpgrades(noisy).length, 4);
  for (const t of ['', null, undefined, 'No package found matching input criteria.\n', 'just text\n---------\nmore text']) {
    assert.deepEqual(parseUpgrades(t), []);
    assert.deepEqual(parseSearch(t), []);
  }
});

test('reads package details', () => {
  const d = parseDetails(fixture('winget-show-vlc.txt'), 'VideoLAN.VLC');
  assert.equal(d.name, 'VLC media player');
  assert.equal(d.publisher, 'VideoLAN');
  assert.equal(d.version, '3.0.24');
  assert.equal(d.license, 'GPL-2.0');
  assert.equal(d.homepage, 'https://www.videolan.org/vlc/');
  assert.equal(d.installerType, 'wix');
  assert.match(d.description, /^VLC is a free and open source/);
  assert.equal(d.hint.label, 'Open source');
});

test('the license hint separates open source, freeware and "check the price"', () => {
  assert.equal(licenseHint('MIT').label, 'Open source');
  assert.equal(licenseHint('GPL-2.0').label, 'Open source');
  assert.equal(licenseHint('Apache-2.0').label, 'Open source');
  assert.equal(licenseHint('BSL-1.0').label, 'Open source'); // Boost
  assert.notEqual(licenseHint('BSL-1.1').label, 'Open source'); // Business Source License: not open source
  assert.equal(licenseHint('Freeware').label, 'Freeware');
  assert.equal(licenseHint('Proprietary').kind, 'unknown');
  assert.equal(licenseHint('Commercial trial').kind, 'paid');
  assert.equal(licenseHint(null).kind, 'unknown');
});

test('a failed install is explained in plain words (real winget wording for code 1602)', () => {
  const real = 'Installer failed with exit code: 1602\nInstaller log is available at: C:\\Users\\x\\log.log\n';
  assert.match(installMessage(real, -1978334967), /cancelled.*permission prompt.*nothing changed/);
  assert.match(installMessage('Installer failed with exit code: 1618', 1), /Another installation/);
  assert.match(installMessage('Installer failed with exit code: 1925', 1), /administrator/);
  assert.equal(installMessage('Some other failure\n', 7), 'Some other failure'); // unknown: winget's own last line
  assert.equal(installMessage('', 7), 'winget stopped with code 7.');
  assert.equal(installMessage('   - \r   \\ \r', 7), 'winget stopped with code 7.'); // spinner noise only
});

test('reads the installed version of one package from winget list', () => {
  const list = table(['Name', 'Id', 'Version', 'Available', 'Source'], [['7-Zip 26.04 (x64 edition)', '7zip.7zip', '26.04.00.0', '26.05', 'winget'], ['Git', 'Git.Git', '2.55.0.5', '', 'winget']]);
  assert.equal(versionFromList(list, '7zip.7zip'), '26.04.00.0');
  assert.equal(versionFromList(list, 'Git.Git'), '2.55.0.5');
  assert.equal(versionFromList(list, 'Not.There'), null);
  assert.equal(versionFromList('No installed package found matching input criteria.', '7zip.7zip'), null);
  assert.equal(versionFromList('', 'x'), null);
});

test('only a plain winget update that winget itself lists can be started', () => {
  const row = { id: '7zip.7zip', name: '7-Zip', version: '1', available: '2', source: 'winget', explicit: false };
  assert.equal(whyNotUpgrade(row), null);
  assert.match(whyNotUpgrade(undefined), /does not list an update/);
  assert.match(whyNotUpgrade({ ...row, explicit: true }), /holds this update back/);
  assert.match(whyNotUpgrade({ ...row, source: 'msstore' }), /Microsoft Store/);
  assert.match(whyNotUpgrade({ ...row, source: null }), /another source/);
  assert.match(whyNotUpgrade({ ...row, id: 'Microsoft.AppInstaller' }), /winget itself/);
});

test('only all-users apps are updated through the permission prompt; per-user apps run as you', () => {
  assert.equal(needsElevation(0), true); // `winget list --scope machine` found it
  assert.equal(needsElevation(-1978335212), false); // not found for all users = a per-user (or Store-style) app
  assert.equal(needsElevation(1), false);
  assert.equal(needsElevation(undefined), false);
});

test('the elevated update command is built only from a valid package id and a safe output file', () => {
  const out = 'C:\\Users\\SWAPNI~1\\AppData\\Local\\Temp\\webase-upgrade-1.txt';
  assert.equal(elevatedUpgradeCommand('PuTTY.PuTTY', out), `/c winget.exe upgrade --id PuTTY.PuTTY --exact --source winget --silent --disable-interactivity > "${out}" 2>&1`);
  assert.equal(elevatedUpgradeCommand('7zip.7zip', 'C:\\Users\\a b\\AppData\\Local\\Temp\\x.txt').includes('"C:\\Users\\a b\\'), true); // a space in the profile name is fine
  for (const bad of ['', '-x', 'a b', 'a&calc', 'a|b', 'a>b', '$(x)', '..\\x', 'a"b', 'x'.repeat(130)]) assert.throws(() => elevatedUpgradeCommand(bad, out), /valid package id/, JSON.stringify(bad));
  for (const bad of ['C:\\Temp\\a&b.txt', 'C:\\Temp\\a"b.txt', 'C:\\Temp\\..\\x.txt', 'relative.txt', 'C:\\Temp\\a%PATH%.txt', 'C:\\Temp\\a^b.txt']) assert.throws(() => elevatedUpgradeCommand('PuTTY.PuTTY', bad), /not safe/, bad);
});

test('only plain search words and package ids get through to winget', () => {
  for (const ok of ['vlc', 'notepad++', '7-zip', 'café', 'visual studio code', 'a']) assert.ok(QUERY.test(ok), ok);
  for (const bad of ['', ' ', '-x', '--help', 'a;b', 'a|b', 'a&b', '$(x)', 'x'.repeat(70), '..\\x']) assert.ok(!QUERY.test(bad), JSON.stringify(bad));
  for (const ok of ['VideoLAN.VLC', '7zip.7zip', 'Notepad++.Notepad++', 'Git.Git']) assert.ok(PACKAGE_ID.test(ok), ok);
  for (const bad of ['', '-x', 'a b', '..\\x', 'a;b', 'x'.repeat(130)]) assert.ok(!PACKAGE_ID.test(bad), JSON.stringify(bad));
});

test('install commands: the same id and file checks as upgrades, and only the verb differs', () => {
  const out = 'C:\\Users\\a\\AppData\\Local\\Temp\\webase-winget-1.txt';
  assert.equal(elevatedInstallCommand('PuTTY.PuTTY', out), `/c winget.exe install --id PuTTY.PuTTY --exact --source winget --silent --disable-interactivity > "${out}" 2>&1`);
  for (const bad of ['', '-x', 'a b', 'a&calc', 'a|b', 'a>b', '$(x)', '..\\x', 'a"b']) assert.throws(() => elevatedInstallCommand(bad, out), /valid package id/, JSON.stringify(bad));
  for (const bad of ['C:\\Temp\\a&b.txt', 'C:\\Temp\\a"b.txt', 'C:\\Temp\\..\\x.txt', 'relative.txt']) assert.throws(() => elevatedInstallCommand('PuTTY.PuTTY', bad), /not safe/, bad);
});

test('Windows Installer packages install behind one permission prompt; every other installer type does not', () => {
  for (const t of ['wix', 'msi', 'WIX', 'Msi']) assert.equal(needsElevatedInstall(t), true, t);
  for (const t of ['exe', 'inno', 'nullsoft', 'burn', 'msix', 'portable', 'portable (zip)', 'zip', 'appx', '', null, undefined, 'wixx', 'wix (zip)']) assert.equal(needsElevatedInstall(t), false, String(t));
});

test('reads `winget list`: ids with versions, and a newer version when the Available column is there', () => {
  const withAvailable = [
    table(['Name', 'Id', 'Version', 'Available', 'Source'], [
      ['7-Zip 26.05 (x64 edition)', '7zip.7zip', '26.05.00.0', '', 'winget'],
      ['Android Studio', 'ARP\\Machine\\X64\\Android Studio', '2026.2', '', ''],
      ['Git', 'Git.Git', '2.50.0', '2.51.0', 'winget'],
    ]),
    '',
  ].join('\n');
  const a = parseInstalled(withAvailable);
  assert.deepEqual(a.map((r) => [r.id, r.version, r.available]), [['7zip.7zip', '26.05.00.0', null], ['ARP\\Machine\\X64\\Android Studio', '2026.2', null], ['Git.Git', '2.50.0', '2.51.0']]);
  const noAvailable = table(['Name', 'Id', 'Version', 'Source'], [
    ['7-Zip 26.05 (x64 edition)', '7zip.7zip', '26.05.00.0', 'winget'],
    ['Steam', 'Valve.Steam', '2.10', 'winget'],
    ['Android Studio', 'ARP\\Machine\\X64\\Android Studio', '2026.2', ''],
  ]);
  const b = parseInstalled(noAvailable);
  assert.deepEqual(b.map((r) => [r.id, r.version, r.available]), [['7zip.7zip', '26.05.00.0', null], ['Valve.Steam', '2.10', null], ['ARP\\Machine\\X64\\Android Studio', '2026.2', null]]);
  assert.deepEqual(parseInstalled(''), []);
  assert.deepEqual(parseInstalled('No installed package found matching input criteria.'), []);
});

test('update list cache: the page reads fresh, an update reuses a recent list, and an updated app leaves it', async () => {
  const { createListCache } = require('./winget');
  let t = 0;
  let loads = 0;
  const c = createListCache({ load: async () => (loads++, [{ id: 'A.a' }, { id: 'B.b' }]), maxAgeMs: 1000, now: () => t });
  assert.equal((await c.recent()).length, 2); // nothing saved yet: reads
  assert.equal(loads, 1);
  await c.recent();
  assert.equal(loads, 1); // reused
  await c.fresh();
  assert.equal(loads, 2); // the page always reads
  c.drop('A.a');
  assert.deepEqual(await c.recent(), [{ id: 'B.b' }]);
  t = 1000; // too old: reads again
  assert.equal((await c.recent()).length, 2);
  assert.equal(loads, 3);
});
