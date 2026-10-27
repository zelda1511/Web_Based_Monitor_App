import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { AutoPatch, AutoState } from './api';
import { Automate } from './automate-button';
import { SystemService } from './system.service';
import { UiService } from './ui.service';

@Component({ imports: [Automate], template: `<app-automate feature="disk" /><app-automate feature="clean" />` })
class Host {}

const base = (master: boolean, over: object = {}): AutoState => ({
  settings: {
    version: 1, automation: master, tray: false, startWithWindows: false,
    warn: { disk: { on: false, percent: 10 }, battery: { on: false, low: 20, urgent: 10, health: 80 }, updates: { on: false }, startup: { on: false } },
    clean: { on: false, everyDays: 7, idleMinutes: 5, onlyOnAc: true }, quietUntil: 0, ...over,
  },
  status: { master, jobs: {} }, recent: [], loginItem: null, packaged: true, trayRunning: false,
});

// the system side's merge, reduced to what these tests need
const merge = (a: any, b: any): any => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b ?? {})) out[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(a[k] ?? {}, v) : v;
  return out;
};

function setup(master: boolean, over: Record<string, unknown> = {}, settingsOver: object = {}) {
  let state = base(master, merge({}, settingsOver));
  const calls: string[] = [];
  const patches: AutoPatch[] = [];
  const fake = {
    automation: async () => { calls.push('get'); return state; },
    setAutomation: async (p: AutoPatch) => {
      patches.push(p);
      state = { ...state, settings: merge(state.settings, p) };
      return state;
    },
    previewAutoClean: async () => ({ token: 'tok', targets: [{ label: 'Your temporary files', refused: null, items: 3, bytes: 5e6, keptRecent: 0 }] }),
    enableAutoClean: async (t: string) => { calls.push(`enable ${t}`); state = { ...state, settings: merge(state.settings, { clean: { on: true } }) }; return state; },
    ...over,
  };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ imports: [Host], providers: [{ provide: SystemService, useValue: fake }] });
  const fixture = TestBed.createComponent(Host);
  return { fixture, el: fixture.nativeElement as HTMLElement, ui: TestBed.inject(UiService), calls, patches };
}
const flush = async (fixture: { whenStable(): Promise<unknown>; detectChanges(): void }) => {
  fixture.detectChanges();
  await fixture.whenStable();
  await new Promise((r) => setTimeout(r, 0));
  fixture.detectChanges();
};
const buttons = (el: HTMLElement) => Array.from(el.querySelectorAll('button')).map((b) => (b.textContent ?? '').trim());

describe('"Automate this" button', () => {
  it('is not shown at all while the master switch is off', async () => {
    const { fixture, el } = setup(false);
    await flush(fixture);
    expect(buttons(el)).toEqual([]);
  });

  it('is shown while the master switch is on, and loads the state by itself', async () => {
    const { fixture, el, calls } = setup(true);
    await flush(fixture);
    expect(buttons(el)).toEqual(['Automate this', 'Automate this']);
    expect(calls.filter((c) => c === 'get').length).toBe(1);
  });

  it('turns on exactly that one warning, says what it will do, and then shows "Automated"', async () => {
    const { fixture, el, ui, patches } = setup(true);
    await flush(fixture);
    (el.querySelector('button[aria-label="Automate disk"]') as HTMLButtonElement).click();
    await flush(fixture);
    expect(patches).toEqual([{ warn: { disk: { on: true } } }]);
    expect(ui.toasts().at(-1)?.text).toContain('You will get a warning when a drive has less than the chosen share of free space.');
    expect(ui.toasts().at(-1)?.text).toContain('Change it on the Automation page.');
    expect(buttons(el)).toEqual(['Automated', 'Automate this']);
  });

  it('"Automated" switches it off again with one click', async () => {
    const { fixture, el, patches } = setup(true, {}, { warn: { disk: { on: true, percent: 10 }, battery: { on: false }, updates: { on: false }, startup: { on: false } } });
    await flush(fixture);
    expect(buttons(el)[0]).toBe('Automated');
    (el.querySelector('button[aria-label^="Automation is on for disk"]') as HTMLButtonElement).click();
    await flush(fixture);
    expect(patches).toEqual([{ warn: { disk: { on: false } } }]);
    expect(buttons(el)[0]).toBe('Automate this');
  });

  it('the cleaning button first shows what would be cleaned and asks; "No" turns nothing on, "Yes" sends the token', async () => {
    const a = setup(true);
    await flush(a.fixture);
    (a.el.querySelector('button[aria-label="Automate clean"]') as HTMLButtonElement).click();
    await flush(a.fixture);
    expect(a.ui.dialog()?.title).toBe('Clean old temporary files automatically?');
    expect(a.ui.dialog()?.items).toEqual(['Your temporary files: 3 items, 4.8 MB now']);
    a.ui.answer(false);
    await flush(a.fixture);
    expect(a.calls.some((c) => c.startsWith('enable'))).toBe(false);
    expect(buttons(a.el)[1]).toBe('Automate this');
    (a.el.querySelector('button[aria-label="Automate clean"]') as HTMLButtonElement).click();
    await flush(a.fixture);
    a.ui.answer(true);
    await flush(a.fixture);
    await flush(a.fixture);
    expect(a.calls).toContain('enable tok');
    expect(buttons(a.el)[1]).toBe('Automated');
    expect(a.ui.toasts().at(-1)?.text).toContain('Automatic cleaning is on');
  });

  it('a refusal from the system side (no recent preview) is shown, and nothing is turned on', async () => {
    const { fixture, el, ui } = setup(true, { enableAutoClean: async () => { throw new Error("Error invoking remote method 'auto:cleanEnable': Error: Look at what would be cleaned first, then confirm."); } });
    await flush(fixture);
    (el.querySelector('button[aria-label="Automate clean"]') as HTMLButtonElement).click();
    await flush(fixture);
    ui.answer(true);
    await flush(fixture);
    await flush(fixture);
    expect(ui.toasts().at(-1)?.text).toBe('Look at what would be cleaned first, then confirm.');
    expect(buttons(el)[1]).toBe('Automate this');
  });
});
