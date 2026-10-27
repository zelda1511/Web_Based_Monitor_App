import { TestBed } from '@angular/core/testing';
import { afterEach, vi } from 'vitest';
import { ActivityEntry, AutoPatch, AutoState } from '../api';
import { AutomationService } from '../automation.service';
import { SystemService } from '../system.service';
import { UiService } from '../ui.service';
import { Automation } from './automation';

const base = (): AutoState => ({
  settings: {
    version: 1, automation: false, tray: false, startWithWindows: false,
    warn: { disk: { on: false, percent: 10 }, battery: { on: false, low: 20, urgent: 10, health: 80 }, updates: { on: false }, startup: { on: false } },
    clean: { on: false, everyDays: 7, idleMinutes: 5, onlyOnAc: true }, quietUntil: 0,
  },
  status: { master: false, jobs: {} }, recent: [], loginItem: null, packaged: true, trayRunning: false,
});
// the system side's merge, reduced to what these tests need
const merge = (a: any, b: any): any => {
  const out = { ...a };
  for (const [k, v] of Object.entries(b ?? {})) out[k] = v && typeof v === 'object' && !Array.isArray(v) ? merge(a[k] ?? {}, v) : v;
  return out;
};

function setup(initial: Partial<AutoState> = {}, over: Record<string, unknown> = {}) {
  let state: AutoState = { ...base(), ...initial };
  const calls: string[] = [];
  const patches: AutoPatch[] = [];
  const fake = {
    automation: async () => { calls.push('get'); return JSON.parse(JSON.stringify(state)) as AutoState; },
    setAutomation: async (p: AutoPatch) => { calls.push('set'); patches.push(p); state = { ...state, settings: merge(state.settings, p) }; return JSON.parse(JSON.stringify(state)) as AutoState; },
    testNotification: async () => 'shown',
    previewAutoClean: async () => ({ token: 'tok', targets: [{ label: 'Your temporary files', refused: null, items: 12, bytes: 3e8, keptRecent: 4 }, { label: 'Crash dumps', refused: null, items: 0, bytes: 0, keptRecent: 0 }] }),
    enableAutoClean: async (t: string) => { calls.push(`enable ${t}`); state = { ...state, settings: merge(state.settings, { clean: { on: true } }) }; return JSON.parse(JSON.stringify(state)) as AutoState; },
    ...over,
  };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ imports: [Automation], providers: [{ provide: SystemService, useValue: fake }] });
  const fixture = TestBed.createComponent(Automation);
  return { fixture, el: fixture.nativeElement as HTMLElement, ui: TestBed.inject(UiService), calls, patches, auto: TestBed.inject(AutomationService) };
}

const flush = async (fixture: { whenStable(): Promise<unknown>; detectChanges(): void }) => {
  fixture.detectChanges();
  await fixture.whenStable();
  await new Promise((r) => setTimeout(r, 0));
  fixture.detectChanges();
};
const text = (el: HTMLElement) => {
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const parts: string[] = [];
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    const t = (n.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (t) parts.push(t);
  }
  return parts.join(' ');
};
const box = (el: HTMLElement, id: string) => el.querySelector(`#${id}`) as HTMLInputElement;
const button = (el: HTMLElement, label: string) => Array.from(el.querySelectorAll('button')).find((b) => (b.textContent ?? '').trim() === label) as HTMLButtonElement;
const pickValue = (el: HTMLElement, id: string, v: number) => {
  const s = box(el, id) as unknown as HTMLSelectElement;
  s.value = String(v);
  s.dispatchEvent(new Event('change'));
};

afterEach(() => vi.useRealTimers());

describe('Automation page', () => {
  it('starts with everything off and says nothing runs while the master switch is off', async () => {
    const { fixture, el } = setup();
    await flush(fixture);
    const t = text(el);
    expect(t).toContain('Automation is off');
    expect(t).toContain('Nothing runs, so there are no warnings and no cleaning. Your choices below are kept');
    for (const id of ['master', 'tray', 'startup', 'w-disk', 'w-bat', 'w-upd', 'w-start', 'clean']) expect(box(el, id).checked, id).toBe(false);
  });

  it('the master switch sends the change and then says what is running', async () => {
    const { fixture, el, patches } = setup();
    await flush(fixture);
    box(el, 'master').click();
    await flush(fixture);
    expect(patches).toEqual([{ automation: true }]);
    expect(text(el)).toContain('Automation is on');
    expect(text(el)).toContain('Pages with something to automate show an "Automate this" button');
  });

  it('the tray and start-with-Windows switches send their changes; start-up is unavailable in a development run, and a missing entry is said plainly', async () => {
    const a = setup();
    await flush(a.fixture);
    box(a.el, 'tray').click();
    box(a.el, 'startup').click();
    await flush(a.fixture);
    expect(a.patches).toEqual([{ tray: true }, { startWithWindows: true }]);
    expect(text(a.el)).toContain('shows on the Startup page');
    const dev = setup({ packaged: false });
    await flush(dev.fixture);
    expect(box(dev.el, 'startup').disabled).toBe(true);
    expect(text(dev.el)).toContain('only works in the extracted app');
    const missing = setup({ settings: { ...base().settings, tray: true, startWithWindows: true }, loginItem: false });
    await flush(missing.fixture);
    expect(text(missing.el)).toContain('Windows has no start-up entry for this app yet');
  });

  it('each warning has its own switch and its own choices', async () => {
    const { fixture, el, patches } = setup();
    await flush(fixture);
    box(el, 'w-disk').click();
    box(el, 'w-bat').click();
    box(el, 'w-upd').click();
    box(el, 'w-start').click();
    pickValue(el, 'w-disk-pct', 20);
    pickValue(el, 'w-bat-low', 30);
    pickValue(el, 'w-bat-health', 70);
    await flush(fixture);
    expect(patches).toEqual([
      { warn: { disk: { on: true } } }, { warn: { battery: { on: true } } }, { warn: { updates: { on: true } } }, { warn: { startup: { on: true } } },
      { warn: { disk: { percent: 20 } } }, { warn: { battery: { low: 30 } } }, { warn: { battery: { health: 70 } } },
    ]);
    expect(text(fixture.nativeElement)).toContain('Windows shows its own low-battery warning too, so you may see two.');
    expect(text(fixture.nativeElement)).toContain('it never installs anything by itself');
  });

  it('under each item it says when it last looked, what it is waiting for, or that the check failed', async () => {
    const { fixture, el } = setup({
      status: {
        master: true,
        jobs: {
          disk: { lastRunAt: Date.now() - 4 * 60000, lastOk: true, lastError: null, waiting: null, dead: false },
          battery: { lastRunAt: null, lastOk: null, lastError: null, waiting: 'no battery', dead: true },
          updates: { lastRunAt: Date.now(), lastOk: false, lastError: 'winget missing', waiting: null, dead: false },
          clean: { lastRunAt: null, lastOk: null, lastError: null, waiting: 'waiting until you are away', dead: false },
        },
      },
    });
    await flush(fixture);
    const t = text(el);
    expect(t).toContain('Last checked today');
    expect(t).toContain('Not available on this PC.');
    expect(t).toContain('The last check failed: winget missing');
    expect(t).toContain('Waiting: waiting until you are away.');
    expect(t).toContain('Not checked yet.');
  });

  it('turning cleaning on shows what would be cleaned right now and the rules; Cancel turns nothing on', async () => {
    const { fixture, el, ui, calls } = setup();
    await flush(fixture);
    box(el, 'clean').click();
    await flush(fixture);
    const d = ui.dialog();
    expect(d?.title).toBe('Clean old temporary files automatically?');
    expect(d?.items).toEqual(['Your temporary files: 12 items, 286 MB now', 'Crash dumps: 0 items, 0 B now']);
    expect(d?.body).toContain('Right now this would clean 286 MB');
    expect(d?.body).toContain('every 7 days, while the app is running and you have been away from the PC for 5 minutes and the PC is on the charger, the same cleaning');
    expect(d?.body).toContain("Windows' own temp folder is never touched");
    expect(d?.body).toContain('files in use are skipped');
    ui.answer(false);
    await flush(fixture);
    expect(calls.some((c) => c.startsWith('enable'))).toBe(false);
    expect(box(el, 'clean').checked).toBe(false);
  });

  it('the confirm text describes the chosen conditions, not fixed ones', async () => {
    const { fixture, el, ui } = setup({ settings: { ...base().settings, clean: { on: false, everyDays: 1, idleMinutes: 0, onlyOnAc: false } } });
    await flush(fixture);
    box(el, 'clean').click();
    await flush(fixture);
    expect(ui.dialog()?.body).toContain('every day, while the app is running, the same cleaning');
    ui.answer(false);
  });

  it('confirming sends the preview token and shows cleaning as on; switching it off needs no question', async () => {
    const { fixture, el, ui, calls, patches } = setup();
    await flush(fixture);
    box(el, 'clean').click();
    await flush(fixture);
    ui.answer(true);
    await flush(fixture);
    await flush(fixture);
    expect(calls).toContain('enable tok');
    expect(box(el, 'clean').checked).toBe(true);
    box(el, 'clean').click();
    await flush(fixture);
    expect(patches.at(-1)).toEqual({ clean: { on: false } });
    expect(ui.dialog()).toBeNull();
  });

  it('the cleaning choices (how often, how long away, only on the charger) are sent as they are chosen', async () => {
    const { fixture, el, patches } = setup();
    await flush(fixture);
    pickValue(el, 'c-days', 30);
    pickValue(el, 'c-idle', 0);
    box(el, 'c-ac').click();
    await flush(fixture);
    expect(patches).toEqual([{ clean: { everyDays: 30 } }, { clean: { idleMinutes: 0 } }, { clean: { onlyOnAc: false } }]);
    expect(text(el)).toContain('no time (any time)');
  });

  it('the last cleaning is shown under the switch, and in the activity list with what failed', async () => {
    const recent: ActivityEntry[] = [
      { at: Date.now() - 3600000, kind: 'clean', freedBytes: 1.2e9, removed: 14, failed: 2, reasons: 'in use' },
      { at: Date.now() - 7200000, kind: 'warning', id: 'disk:C:', title: 'C: is almost full', body: 'Only 10 GB free (9%).', shown: false },
    ];
    const { fixture, el } = setup({ recent, settings: { ...base().settings, clean: { ...base().settings.clean, on: true } } });
    await flush(fixture);
    const t = text(el);
    expect(t).toContain('Last run today: 1.1 GB freed.');
    expect(t).toContain('Cleaned old temp files: 1.1 GB freed, 14 items removed. 2 could not be removed (in use)');
    expect(t).toContain('C: is almost full: Only 10 GB free (9%).');
    expect(t).toContain('Not shown as a pop-up: warnings were paused.');
    expect(Array.from(el.querySelectorAll('tbody tr')).length).toBe(2);
  });

  it('an empty activity list says so, and a run that was stopped says why', async () => {
    const a = setup();
    await flush(a.fixture);
    expect(text(a.el)).toContain('Nothing yet. Warnings and cleanings are listed here, newest first.');
    const b = setup({ recent: [{ at: 1, kind: 'clean', freedBytes: 5, removed: 1, failed: 0, stopped: true }] });
    await flush(b.fixture);
    expect(text(b.el)).toContain('stopped because automation was switched off');
  });

  it('the test button says what happened, and the result survives for the person to read', async () => {
    for (const [result, words] of [['shown', 'Sent. If you can see it'], ['paused', 'Warnings are paused'], ['failed', 'Windows would not show it']]) {
      const { fixture, el } = setup({}, { testNotification: async () => result });
      await flush(fixture);
      button(el, 'Send a test notification').click();
      await flush(fixture);
      expect(text(el)).toContain(words);
    }
  });

  it('the quit button asks the system side to close the app; a refusal (an install is running) is shown, not hidden', async () => {
    let asked = 0;
    const a = setup({}, { quitApp: async () => { asked++; } });
    await flush(a.fixture);
    button(a.el, 'Quit Webase System Monitor').click();
    await flush(a.fixture);
    expect(asked).toBe(1);
    const b = setup({}, { quitApp: async () => { throw new Error("Error invoking remote method 'app:quit': Error: An install or a cleaning is running. Wait for it to finish, then quit."); } });
    await flush(b.fixture);
    button(b.el, 'Quit Webase System Monitor').click();
    await flush(b.fixture);
    expect(b.ui.toasts().at(-1)?.text).toBe('An install or a cleaning is running. Wait for it to finish, then quit.');
  });

  it('pausing warnings sets a time an hour ahead; when paused the button resumes them', async () => {
    const a = setup();
    await flush(a.fixture);
    const before = Date.now();
    button(a.el, 'Pause warnings for 1 hour').click();
    await flush(a.fixture);
    const sent = a.patches[0].quietUntil as number;
    expect(sent).toBeGreaterThanOrEqual(before + 3600000 - 50);
    expect(sent).toBeLessThanOrEqual(Date.now() + 3600000 + 50);
    expect(button(a.el, 'Resume warnings')).toBeTruthy();
    button(a.el, 'Resume warnings').click();
    await flush(a.fixture);
    expect(a.patches[1]).toEqual({ quietUntil: 0 });
  });

  it('the page looks again every 20 seconds until it is closed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { fixture, calls } = setup();
    fixture.detectChanges();
    await vi.advanceTimersByTimeAsync(0);
    await fixture.whenStable();
    expect(calls).toEqual(['get']);
    await vi.advanceTimersByTimeAsync(20000);
    expect(calls).toEqual(['get', 'get']);
    fixture.destroy();
    await vi.advanceTimersByTimeAsync(60000);
    expect(calls).toEqual(['get', 'get']);
  });

  it('outside the app, or when the system side fails, the page says so instead of staying empty', async () => {
    const { fixture, el } = setup({}, { automation: async () => { throw new Error("Error invoking remote method 'auto:get': Error: nope"); } });
    await flush(fixture);
    expect(el.querySelector('.alert')?.textContent).toBe('nope');
    expect(text(el)).not.toContain('Reading the automation settings');
  });
});
