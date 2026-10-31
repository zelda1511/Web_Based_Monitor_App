const test = require('node:test');
const assert = require('node:assert/strict');
const { parseDrivers, parseProblems, parseUpdates, nvidiaVersion, classify, vendorOf, matchUpdates, checkDriverUpdates, listDrivers, readDrivers, LINKS } = require('./drivers');

const NOW = Date.UTC(2026, 9, 25);
const d = (over) => ({ name: 'Device', cls: 'NET', provider: 'Realtek', manufacturer: 'Realtek', version: '1.0', date: '2026-01-01', signed: true, ...over });

test('converts the Windows driver version to the vendor version people know (NVIDIA)', () => {
  assert.equal(nvidiaVersion('32.0.15.6201'), '562.01');
  assert.equal(nvidiaVersion('31.0.15.4601'), '546.01');
  assert.equal(nvidiaVersion('32.0.16.2101'), '621.01');
  assert.equal(nvidiaVersion('weird'), null);
  assert.equal(nvidiaVersion(null), null);
  const [gpu] = parseDrivers([d({ name: 'GPU', cls: 'DISPLAY', provider: 'NVIDIA', version: '32.0.15.6201' })], NOW);
  assert.equal(gpu.friendlyVersion, '562.01');
  const [net] = parseDrivers([d({ provider: 'NVIDIA', cls: 'NET', version: '32.0.15.6201' })], NOW);
  assert.equal(net.friendlyVersion, null, 'only display drivers get the converted version');
});

test('flags unsigned and old third-party drivers, but not unknown signature or Microsoft inbox drivers', () => {
  const list = parseDrivers([
    d({ name: 'a-unsigned', signed: false }),
    d({ name: 'b-unknown', signed: null }),
    d({ name: 'c-old', date: '2020-01-01' }),
    d({ name: 'd-fresh', date: '2026-06-01' }),
    d({ name: 'e-ms-old', provider: 'Microsoft', date: '2006-06-21' }),
    d({ name: 'f-nodate', date: null }),
  ], NOW);
  const by = Object.fromEntries(list.map((x) => [x.name, x]));
  assert.equal(by['a-unsigned'].signed, false);
  assert.equal(by['b-unknown'].signed, null);
  assert.equal(by['c-old'].old, true);
  assert.equal(by['d-fresh'].old, false);
  assert.equal(by['e-ms-old'].old, false);
  assert.equal(by['e-ms-old'].microsoft, true);
  assert.equal(by['f-nodate'].old, false);
});

test('driver parsing tolerates one object, null, nameless rows, and falls back to the manufacturer', () => {
  assert.equal(parseDrivers(d({}), NOW).length, 1);
  assert.deepEqual(parseDrivers(null, NOW), []);
  assert.equal(parseDrivers([{ name: '' }, null], NOW).length, 0);
  assert.equal(parseDrivers([d({ provider: null, manufacturer: 'Lenovo' })], NOW)[0].provider, 'Lenovo');
});

test('problem codes become plain words, unknown codes keep their number', () => {
  const [a, b] = parseProblems([{ name: 'Z device', code: 28 }, { name: 'A device', code: 999 }]);
  assert.deepEqual([a.name, a.cause], ['A device', 'Error code 999']);
  assert.equal(b.cause, 'No driver installed');
  assert.deepEqual(parseProblems(null), []);
});

test('update rows are cleaned and sorted; empty input gives no updates', () => {
  const list = parseUpdates([
    { title: 'Zeta', manufacturer: 'X', sizeBytes: 0, downloaded: 0 },
    { title: 'Alpha', manufacturer: 'Y', sizeBytes: 2048, downloaded: true, date: '2026-05-01' },
    { title: '' },
  ]);
  assert.deepEqual(list.map((u) => u.title), ['Alpha', 'Zeta']);
  assert.equal(list[0].sizeBytes, 2048);
  assert.equal(list[1].sizeBytes, null);
  assert.equal(list[1].downloaded, false);
  assert.deepEqual(parseUpdates([]), []);
  assert.deepEqual(parseUpdates(null), []);
});

test('only known vendor pages and the Settings page can be opened', () => {
  assert.deepEqual(Object.keys(LINKS).sort(), ['amd', 'app-control', 'intel', 'nvidia', 'optional-updates']);
  const kinds = { 'optional-updates': /^ms-settings:/, 'app-control': /^windowsdefender:\/\/appbrowser$/ };
  for (const [key, url] of Object.entries(LINKS)) assert.match(url, kinds[key] ?? /^https:\/\/(www\.)?[a-z.]+\//, key);
});

// Real rows from a PC (device instance id, class), so the rules are tested against what Windows really reports.
test('hardware or software component: the bus in the instance id decides, the class only where the bus is unknown', () => {
  const real = [
    ['SWD\\DRIVERENUM\\{741A2100}#NAHIMIC_XVAD&6', 'MEDIA', false, 'a software device that says it is audio'],
    ['SWD\\DRIVERENUM\\{8A8F}#AISPEECH&1', 'AUDIOPROCESSINGOBJECT', false, 'AISpeech Audio Effects Component'],
    ['SWD\\DRIVERENUM\\{8A8F}#REALTEK&1', 'SOFTWARECOMPONENT', false, 'Realtek Audio Universal Service'],
    ['SWD\\MMDEVAPI\\{0.0.0.00000000}.{1}', 'AUDIOENDPOINT', false, 'Speakers'],
    ['SWD\\PRINTENUM\\{1}', 'PRINTQUEUE', false, 'Microsoft Print to PDF'],
    ['ROOT\\SYSTEM\\0001', 'SYSTEM', false, 'a virtual system device'],
    ['ROOT\\NET\\0000', 'NET', false, 'a virtual network adapter'],
    ['STORAGE\\VOLUME\\{1}#0', 'VOLUME', false, 'a volume: unknown bus, software class'],
    ['{742787E2-EA40-4366-8FB4-DE98EE777D7C}\\RTKFILTER0\\7&47D89BF&0&00', '', false, 'RtkFilter0: a GUID bus and no class'],
    ['ACPI\\AMDI0010\\0', 'SYSTEM', true, 'AMD I2C Controller'],
    ['ACPI\\NVDA0820\\NPCF', 'SOFTWAREDEVICE', true, 'NVIDIA Platform Controllers: class says software, the bus says hardware'],
    ['ACP\\DEVTYPE_0001&DEVREV_0000&VEN_1022&DEV_15E2\\5&BFDA5AA&0&01', '', true, 'ACP HDA Node: no class at all'],
    ['PCI\\VEN_10DE&DEV_28A1&SUBSYS_3C1017AA&REV_A1\\4&1', 'DISPLAY', true, 'NVIDIA GeForce'],
    ['PCI\\VEN_10EC&DEV_8852\\4&2', 'NET', true, 'Realtek WiFi'],
    ['HDAUDIO\\FUNC_01&VEN_10EC&DEV_0257\\5&1DA00EB3&0&0001', 'MEDIA', true, 'Realtek High Definition Audio'],
    ['USB\\VID_0BDA&PID_4853\\00E04C000001', 'BLUETOOTH', true, 'Realtek Bluetooth Adapter'],
    ['BTHENUM\\{0000110B}_VID&0001\\7&1', 'MEDIA', true, 'a Bluetooth headset'],
    ['UEFI\\RES_{3A1}\\0', 'FIRMWARE', true, 'System Firmware'],
    ['SCSI\\DISK&VEN_NVME\\5&1', 'DISKDRIVE', true, 'NVMe disk'],
    ['BUTTONCONVERTER\\NOTHING\\1', 'HIDCLASS', true, 'a bus nobody listed: not software, so shown with the hardware'],
  ];
  for (const [id, cls, hardware, why] of real) assert.equal(classify(id, cls).hardware, hardware, `${why} (${id})`);
});

test('without an instance id the class decides, and no class and no id is not called hardware', () => {
  assert.equal(classify(null, 'NET').hardware, true);
  assert.equal(classify(null, 'AUDIOPROCESSINGOBJECT').hardware, false);
  assert.equal(classify(null, '').hardware, false);
  assert.equal(classify(undefined, undefined).hardware, false);
});

test('hardware drivers get a plain kind, software components all share one', () => {
  const kind = (id, cls) => classify(id, cls).kind;
  assert.equal(kind('PCI\\x', 'DISPLAY'), 'Graphics');
  assert.equal(kind('PCI\\x', 'NET'), 'Network');
  assert.equal(kind('USB\\x', 'NET'), 'Network', 'a USB network adapter is a network adapter');
  assert.equal(kind('HDAUDIO\\x', 'MEDIA'), 'Audio');
  assert.equal(kind('ACP\\x', ''), 'Audio');
  assert.equal(kind('USB\\x', 'BLUETOOTH'), 'Bluetooth');
  assert.equal(kind('BTHENUM\\x', 'SYSTEM'), 'Bluetooth', 'the bus wins over a class that says SYSTEM');
  assert.equal(kind('ACPI\\x', 'SYSTEM'), 'Chipset and system');
  assert.equal(kind('PCI\\x', 'SCSIADAPTER'), 'Storage');
  assert.equal(kind('USB\\x', 'USB'), 'USB');
  assert.equal(kind('HID\\x', 'MOUSE'), 'Input');
  assert.equal(kind('UEFI\\x', 'FIRMWARE'), 'Firmware');
  assert.equal(kind('PCI\\x', 'SOMENEWCLASS'), 'Other hardware');
  assert.equal(kind('SWD\\x', 'MEDIA'), 'Software component');
});

test('parseDrivers adds the hardware flag, kind, maker page key, device id and lower-cased hardware ids', () => {
  const [apo, gpu] = parseDrivers([ // sorted by name
    d({ name: 'GPU', cls: 'DISPLAY', provider: 'NVIDIA', deviceId: 'PCI\\VEN_10DE&DEV_28A1\\4&1', hardwareIds: ['PCI\\VEN_10DE&DEV_28A1&SUBSYS_3C1017AA', ' ', 7, null] }),
    d({ name: 'APO', cls: 'AUDIOPROCESSINGOBJECT', provider: 'Realtek', deviceId: 'SWD\\DRIVERENUM\\1' }),
  ], NOW);
  assert.deepEqual([gpu.hardware, gpu.kind, gpu.vendor, gpu.deviceId], [true, 'Graphics', 'nvidia', 'PCI\\VEN_10DE&DEV_28A1\\4&1']);
  assert.deepEqual(gpu.hardwareIds, ['pci\\ven_10de&dev_28a1&subsys_3c1017aa']);
  assert.deepEqual([apo.hardware, apo.kind, apo.vendor, apo.hardwareIds], [false, 'Software component', null, []]);
  assert.equal(parseDrivers([d({ deviceId: '' })], NOW)[0].deviceId, null);
});

test('maker page keys: NVIDIA, AMD and Intel under their usual provider names, nothing for look-alikes', () => {
  assert.equal(vendorOf('NVIDIA Corporation'), 'nvidia');
  assert.equal(vendorOf('Advanced Micro Devices, Inc.'), 'amd');
  assert.equal(vendorOf('AMD'), 'amd');
  assert.equal(vendorOf('ATI Technologies Inc.'), 'amd');
  assert.equal(vendorOf('Intel Corporation'), 'intel');
  assert.equal(vendorOf('Intel(R) Corporation'), 'intel');
  assert.equal(vendorOf('Amdocs'), null);
  assert.equal(vendorOf('Intelligent Systems'), null);
  assert.equal(vendorOf('Realtek'), null);
  assert.equal(vendorOf(null), null);
  for (const key of ['nvidia', 'amd', 'intel']) assert.ok(Object.hasOwn(LINKS, key), `${key} has a link`);
});

test('an update row keeps the hardware id it is for, lower-cased, and null when there is none', () => {
  const [a, b, c] = parseUpdates([
    { title: 'A', hardwareId: ' PCI\\VEN_10DE&DEV_28A1 ' },
    { title: 'B', hardwareId: '' },
    { title: 'C' },
  ]);
  assert.equal(a.hardwareId, 'pci\\ven_10de&dev_28a1');
  assert.equal(b.hardwareId, null);
  assert.equal(c.hardwareId, null);
});

const dev = (deviceId, ...hardwareIds) => ({ deviceId, hardwareIds });
const upd = (title, hardwareId) => ({ id: null, revision: null, title, hardwareId });

test('an update is tied to the devices whose own hardware ids contain its hardware id, and to nothing else', () => {
  const drivers = [
    dev('ACPI\\AMDI0010\\0', 'acpi\\ven_amdi&dev_0010'),
    dev('ACPI\\AMDI0010\\1', 'acpi\\ven_amdi&dev_0010'), // the second AMD I2C Controller
    dev('PCI\\a', 'pci\\ven_1022&dev_790b&subsys_38b617aa&rev_71', 'pci\\ven_1022&dev_790b&subsys_38b617aa', 'pci\\ven_1022&dev_790b'),
    dev('PCI\\b', 'pci\\ven_1022&dev_15e2'),
    dev('SWD\\none'), // no hardware id at all
  ];
  const out = matchUpdates(drivers, [
    upd('both I2C', 'acpi\\ven_amdi&dev_0010'),
    upd('a less specific id of one device', 'pci\\ven_1022&dev_790b'),
    upd('a prefix of an id is not a match', 'pci\\ven_1022&dev_790'),
    upd('an id nobody has', 'pci\\ven_dead&dev_beef'),
    upd('no id at all', null),
  ]);
  assert.deepEqual(out.map((u) => u.deviceIds), [['ACPI\\AMDI0010\\0', 'ACPI\\AMDI0010\\1'], ['PCI\\a'], [], [], []]);
  assert.deepEqual(out.map((u) => u.title), ['both I2C', 'a less specific id of one device', 'a prefix of an id is not a match', 'an id nobody has', 'no id at all']);
});

test('only the update\'s own hardware id counts; a longer id on the device side does not stand in for a shorter one on the update side', () => {
  const out = matchUpdates([dev('PCI\\a', 'pci\\ven_1022&dev_790b&subsys_38b617aa&rev_71')], [upd('short', 'pci\\ven_1022&dev_790b')]);
  assert.deepEqual(out[0].deviceIds, [], 'the device would need to list that exact id itself');
});

test('matching copes with no drivers, no updates and rows without a device id', () => {
  assert.deepEqual(matchUpdates([], [upd('x', 'a')]).map((u) => u.deviceIds), [[]]);
  assert.deepEqual(matchUpdates([dev('A', 'a')], []), []);
  assert.deepEqual(matchUpdates([{ deviceId: null, hardwareIds: ['a'] }], [upd('x', 'a')])[0].deviceIds, []);
});

test('the update check returns the search result with devices attached, and still works when the driver list cannot be read', async () => {
  const scan = async () => ({ checkedAt: 123, updates: [upd('Realtek audio', 'hdaudio\\func_01&ven_10ec&dev_0257')] });
  const read = async () => ({ drivers: [dev('HDAUDIO\\1', 'hdaudio\\func_01&ven_10ec&dev_0257')], problems: [] });
  const ok = await checkDriverUpdates({ scan, read });
  assert.equal(ok.checkedAt, 123);
  assert.deepEqual(ok.updates[0].deviceIds, ['HDAUDIO\\1']);

  const failed = await checkDriverUpdates({ scan, read: async () => { throw new Error('PowerShell failed'); } });
  assert.deepEqual(failed.updates.map((u) => [u.title, u.deviceIds]), [['Realtek audio', []]]);

  await assert.rejects(checkDriverUpdates({ scan: async () => { throw new Error('offline'); }, read }), /offline/, 'a failed search is still an error');
});

test('the real driver list script runs here: every row says hardware or not, and the window never gets the hardware id lists', async () => {
  const [{ drivers }, forWindow] = await Promise.all([readDrivers(), listDrivers()]);
  assert.ok(drivers.length > 10, 'a Windows PC has more than a handful of drivers');
  assert.ok(drivers.every((x) => typeof x.hardware === 'boolean' && x.kind && Array.isArray(x.hardwareIds)));
  assert.ok(drivers.some((x) => x.deviceId && x.hardwareIds.length > 0), 'at least one device has hardware ids from its PnP entity');
  assert.ok(drivers.some((x) => x.hardware) && drivers.some((x) => !x.hardware), 'both kinds exist on a normal PC');
  assert.ok(forWindow.drivers.length > 10);
  assert.ok(forWindow.drivers.every((x) => !('hardwareIds' in x) && 'deviceId' in x));
});
