import { TestBed } from '@angular/core/testing';
import { DriverInstallResult, DriverRow, DriverUpdate, UpdateScan } from '../api';
import { SystemService } from '../system.service';
import { UiService } from '../ui.service';
import { Drivers } from './drivers';

const ID = '3f2a1c9e-8b7d-4e6f-a1b2-c3d4e5f60718';
const AUDIO = 'HDAUDIO\\FUNC_01&VEN_10EC&DEV_0257\\5&1';
const GPU = 'PCI\\VEN_10DE&DEV_28A1\\4&1';
const I2C_A = 'ACPI\\AMDI0010\\0';
const I2C_B = 'ACPI\\AMDI0010\\1';
const EFFECTS = 'SWD\\DRIVERENUM\\1';

const row = (over: Partial<DriverRow>): DriverRow => ({
  name: 'Device', cls: 'SYSTEM', provider: 'Vendor', version: '1.0', friendlyVersion: null, date: '2026-01-01', signed: true, microsoft: false, old: false,
  hardware: true, kind: 'Chipset and system', vendor: null, deviceId: null, ...over,
});

const DRIVERS: DriverRow[] = [
  row({ name: 'Realtek High Definition Audio', cls: 'MEDIA', kind: 'Audio', provider: 'Realtek', deviceId: AUDIO }),
  row({ name: 'NVIDIA GeForce RTX 4050 Laptop GPU', cls: 'DISPLAY', kind: 'Graphics', provider: 'NVIDIA', vendor: 'nvidia', deviceId: GPU }),
  row({ name: 'AMD I2C Controller', provider: 'Advanced Micro Devices, Inc.', vendor: 'amd', deviceId: I2C_A }),
  row({ name: 'AMD I2C Controller', provider: 'Advanced Micro Devices, Inc.', vendor: 'amd', deviceId: I2C_B }),
  row({ name: 'Realtek Audio Effects Component', cls: 'AUDIOPROCESSINGOBJECT', kind: 'Software component', provider: 'Realtek', hardware: false, deviceId: EFFECTS }),
];

const update = (over: Partial<DriverUpdate>): DriverUpdate => ({
  id: ID, revision: 201, title: 'Realtek - Audio - 6.0.9', manufacturer: 'Realtek', model: null, cls: 'MEDIA', date: '2026-06-01', sizeBytes: 5_000_000, downloaded: false, deviceIds: [], ...over,
});

// A stand-in for the real bridge: Windows Update has no pending driver on the development PC, so the Update and Install buttons
// can only be exercised here.
function setup(result: Partial<DriverInstallResult> = {}, opts: { drivers?: DriverRow[]; updates?: DriverUpdate[] } = {}) {
  const calls: string[] = [];
  const opened: string[] = [];
  const counts = { list: 0 };
  let release: (r: DriverInstallResult) => void = () => undefined;
  const scan: UpdateScan = {
    checkedAt: Date.now(),
    updates: opts.updates ?? [
      update({ deviceIds: [AUDIO] }),
      update({ id: null, revision: null, title: 'An update without an id', manufacturer: null, cls: null, date: null, sizeBytes: null }),
    ],
  };
  const fake = {
    drivers: async () => {
      counts.list++;
      return { drivers: opts.drivers ?? DRIVERS, problems: [] };
    },
    scanDriverUpdates: async () => scan,
    openDriverLink: async (key: string) => {
      opened.push(key);
    },
    installDriverUpdate: (id: string) => {
      calls.push(id);
      return new Promise<DriverInstallResult>((resolve) => {
        release = (r) => resolve(r);
      });
    },
  };
  TestBed.configureTestingModule({ imports: [Drivers], providers: [{ provide: SystemService, useValue: fake }] });
  const fixture = TestBed.createComponent(Drivers);
  const el = fixture.nativeElement as HTMLElement;
  const ui = TestBed.inject(UiService);
  const finish = (extra: Partial<DriverInstallResult> = {}) =>
    release({ id: ID, status: 'installed', message: 'The driver was installed.', rebootRequired: false, restorePoint: null, stillOffered: false, ...result, ...extra });
  return { fixture, el, ui, calls, opened, counts, finish };
}

const flush = async (fixture: { whenStable(): Promise<unknown>; detectChanges(): void }) => {
  fixture.detectChanges();
  await fixture.whenStable();
  fixture.detectChanges();
};

const buttons = (el: HTMLElement) => Array.from(el.querySelectorAll('button'));
const check = async (fixture: { whenStable(): Promise<unknown>; detectChanges(): void }, el: HTMLElement) => {
  (buttons(el).find((b) => b.textContent?.includes('Check Windows Update')) as HTMLButtonElement).click();
  await flush(fixture);
};
// A row of the installed-drivers table (the update list above it has rows too, named by the update's title).
const rowOf = (el: HTMLElement, name: string) =>
  Array.from(el.querySelectorAll('tbody tr')).find((tr) => tr.querySelector('td')?.textContent?.includes(name)) as HTMLElement;
const rowsNamed = (el: HTMLElement, name: string) =>
  Array.from(el.querySelectorAll('tbody tr')).filter((tr) => tr.querySelector('td')?.textContent?.includes(name)) as HTMLElement[];

describe('Drivers: installing an update', () => {
  it('offers Install only for an update that has an id, and asks before doing anything', async () => {
    const { fixture, el, ui, calls } = setup();
    await flush(fixture);
    await check(fixture, el);

    const installs = buttons(el).filter((b) => b.getAttribute('aria-label')?.startsWith('Install '));
    expect(installs.length).toBe(1);
    expect(installs[0].getAttribute('aria-label')).toBe('Install Realtek - Audio - 6.0.9');

    installs[0].click();
    await flush(fixture);
    const d = ui.dialog();
    expect(d?.title).toBe('Install this driver?');
    expect(d?.body).toContain('Realtek - Audio - 6.0.9');
    expect(d?.body).toContain('System Restore point');
    expect(d?.body).toContain('installs nothing if that fails');
    expect(calls).toEqual([]); // nothing runs before the answer

    ui.answer(false);
    await flush(fixture);
    expect(calls).toEqual([]);
  });

  it('after a Yes it installs that update once, locks the buttons meanwhile, and reports a restart', async () => {
    const { fixture, el, ui, calls, finish } = setup({ rebootRequired: true });
    await flush(fixture);
    await check(fixture, el);
    (el.querySelector('button[aria-label^="Install "]') as HTMLButtonElement).click();
    await flush(fixture);
    ui.answer(true);
    await flush(fixture);

    expect(calls).toEqual([ID]);
    const busy = el.querySelector('button[aria-label^="Install "]') as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    expect(busy.textContent).toContain('Installing');

    finish();
    await flush(fixture);
    await flush(fixture);
    const text = ui.toasts().map((t) => t.text).join(' | ');
    expect(text).toContain('The driver was installed.');
    expect(text).toContain('Restart Windows');
    expect(calls).toEqual([ID]); // not run again by the rescan
  });

  it('a declined permission prompt is an info message, not an error', async () => {
    const { fixture, el, ui, finish } = setup();
    await flush(fixture);
    await check(fixture, el);
    (el.querySelector('button[aria-label^="Install "]') as HTMLButtonElement).click();
    await flush(fixture);
    ui.answer(true);
    await flush(fixture);
    finish({ status: 'declined', message: 'The Windows permission prompt was declined, so nothing changed.' });
    await flush(fixture);
    await flush(fixture);
    const last = ui.toasts().at(-1);
    expect(last?.text).toContain('declined');
    expect(last?.kind).toBe('info');
  });
});

describe('Drivers: hardware first', () => {
  it('shows hardware drivers by default, says how many software components are hidden, and shows them when asked', async () => {
    const { fixture, el } = setup();
    await flush(fixture);
    expect(rowOf(el, 'Realtek High Definition Audio')).toBeTruthy();
    expect(rowOf(el, 'Realtek Audio Effects Component')).toBeUndefined();
    expect(el.querySelector('.note')?.textContent).toContain('1 software component (audio effects and similar) hidden');

    const sw = Array.from(el.querySelectorAll('label')).find((l) => l.textContent?.includes('Hardware only'))?.querySelector('input') as HTMLInputElement;
    expect(sw.checked).toBe(true);
    sw.click();
    await flush(fixture);
    expect(rowOf(el, 'Realtek Audio Effects Component')).toBeTruthy();
    expect(el.querySelector('.note')?.textContent).not.toContain('hidden');
  });

  it('shows each row\'s kind in plain words', async () => {
    const { fixture, el } = setup();
    await flush(fixture);
    expect(rowOf(el, 'NVIDIA GeForce').querySelector('.sub')?.textContent?.trim()).toBe('Graphics');
    expect(rowOf(el, 'Realtek High Definition Audio').querySelector('.sub')?.textContent?.trim()).toBe('Audio');
  });
});

describe('Drivers: update state on each row', () => {
  it('says "Not checked" before the check, then marks the matched row and says "None offered" on the others, never "up to date"', async () => {
    const { fixture, el } = setup();
    await flush(fixture);
    expect(rowOf(el, 'AMD I2C Controller').textContent).toContain('Not checked');
    expect(el.textContent).not.toContain('Update available');

    await check(fixture, el);
    expect(rowOf(el, 'Realtek High Definition Audio').textContent).toContain('Update available');
    expect(rowOf(el, 'AMD I2C Controller').textContent).toContain('None offered');
    expect(rowOf(el, 'AMD I2C Controller').textContent).not.toContain('Update available');
    expect(el.textContent?.toLowerCase()).not.toContain('up to date');
    expect(el.textContent?.toLowerCase()).not.toContain('up-to-date');
  });

  it('the row\'s Update button asks first and then installs that update through the same flow', async () => {
    const { fixture, el, ui, calls, counts, finish } = setup();
    await flush(fixture);
    await check(fixture, el);

    const btn = rowOf(el, 'Realtek High Definition Audio').querySelector('button') as HTMLButtonElement;
    expect(btn.getAttribute('aria-label')).toBe('Update Realtek High Definition Audio');
    expect(rowOf(el, 'AMD I2C Controller').querySelector('button')).toBeNull(); // no button without an update
    btn.click();
    await flush(fixture);
    const d = ui.dialog();
    expect(d?.title).toBe('Install this driver?');
    expect(d?.body).toContain('Realtek - Audio - 6.0.9');
    expect(d?.body).toContain('System Restore point');
    expect(d?.body).not.toContain('firmware');
    expect(calls).toEqual([]);

    ui.answer(true);
    await flush(fixture);
    expect(calls).toEqual([ID]);
    const busy = rowOf(el, 'Realtek High Definition Audio').querySelector('button') as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    expect(busy.textContent).toContain('Updating');
    expect((el.querySelector('button[aria-label^="Install "]') as HTMLButtonElement).disabled).toBe(true);

    const before = counts.list;
    finish();
    await flush(fixture);
    await flush(fixture);
    expect(ui.toasts().map((t) => t.text).join(' | ')).toContain('The driver was installed.');
    expect(counts.list).toBeGreaterThan(before); // the list is read again so the row shows the new version
    expect(calls).toEqual([ID]);
  });

  it('one update for two devices is shown on both rows, and both buttons start the same update', async () => {
    const { fixture, el, ui, calls } = setup({}, { updates: [update({ title: 'AMD - System - 2.2.0.136', cls: 'System', deviceIds: [I2C_A, I2C_B] })] });
    await flush(fixture);
    await check(fixture, el);
    const rows = rowsNamed(el, 'AMD I2C Controller');
    expect(rows.length).toBe(2);
    expect(rows.every((r) => r.textContent?.includes('Update available'))).toBe(true);

    (rows[1].querySelector('button') as HTMLButtonElement).click();
    await flush(fixture);
    ui.answer(true);
    await flush(fixture);
    expect(calls).toEqual([ID]);
  });

  it('when Windows Update offers two for one device the newest is the one on the row', async () => {
    const older = update({ id: '11111111-1111-4111-8111-111111111111', title: 'Realtek - Audio - 6.0.1', date: '2025-01-01', deviceIds: [AUDIO] });
    const newer = update({ title: 'Realtek - Audio - 6.0.9', date: '2026-06-01', deviceIds: [AUDIO] });
    const { fixture, el, ui } = setup({}, { updates: [older, newer] });
    await flush(fixture);
    await check(fixture, el);
    (rowOf(el, 'Realtek High Definition Audio').querySelector('button') as HTMLButtonElement).click();
    await flush(fixture);
    expect(ui.dialog()?.body).toContain('Realtek - Audio - 6.0.9');
  });

  it('an update without an id is marked on its row but cannot be started from there', async () => {
    const { fixture, el } = setup({}, { updates: [update({ id: null, revision: null, deviceIds: [AUDIO] })] });
    await flush(fixture);
    await check(fixture, el);
    const r = rowOf(el, 'Realtek High Definition Audio');
    expect(r.textContent).toContain('Update available');
    expect(r.querySelector('button')).toBeNull();
  });

  it('a firmware update warns that a restore point cannot undo it', async () => {
    const { fixture, el, ui } = setup({}, { updates: [update({ title: 'Lenovo - Firmware - 1.2', cls: 'Firmware', deviceIds: [I2C_A] })] });
    await flush(fixture);
    await check(fixture, el);
    (rowsNamed(el, 'AMD I2C Controller')[0].querySelector('button') as HTMLButtonElement).click();
    await flush(fixture);
    expect(ui.dialog()?.body).toContain('firmware update');
    expect(ui.dialog()?.body).toContain('restore point cannot undo it');
  });

  it('a graphics row with no update from Windows Update gets the maker\'s page, with the plain limit, and other rows do not', async () => {
    const { fixture, el, opened } = setup();
    await flush(fixture);
    expect(rowOf(el, 'NVIDIA GeForce').querySelector('button')).toBeNull(); // nothing before the check

    await check(fixture, el);
    const gpu = rowOf(el, 'NVIDIA GeForce');
    expect(gpu.textContent).toContain('None offered');
    const link = gpu.querySelector('button') as HTMLButtonElement;
    expect(link.textContent).toContain("NVIDIA's driver page");
    expect(link.getAttribute('title')).toContain('cannot tell whether it has a newer driver');
    expect(el.querySelector('.note')?.textContent).toContain('this app cannot see what is newest there');
    expect(rowOf(el, 'AMD I2C Controller').querySelector('button')).toBeNull(); // not graphics

    link.click();
    await flush(fixture);
    expect(opened).toEqual(['nvidia']);
  });

  it('a graphics row that Windows Update does have a driver for shows the update, not the maker link', async () => {
    const { fixture, el } = setup({}, { updates: [update({ title: 'NVIDIA - Display - 32.0.15.6094', cls: 'Display', deviceIds: [GPU] })] });
    await flush(fixture);
    await check(fixture, el);
    const gpu = rowOf(el, 'NVIDIA GeForce');
    expect(gpu.textContent).toContain('Update available');
    expect(gpu.textContent).not.toContain("NVIDIA's driver page");
  });
});
