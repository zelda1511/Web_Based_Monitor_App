import { provideRouter } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { afterEach, vi } from 'vitest';
import { BatteryNow } from '../api';
import { SystemService } from '../system.service';
import { Dashboard } from './dashboard';

const overview = { os: { name: 'Windows 11', release: '26100', arch: 'x64' }, cpu: { name: 'CPU', cores: 8, threads: 16, ghz: 3 }, ramTotal: 16e9, ramModules: [], gpus: [], disks: [], board: 'Board' };
const live = { cpu: 12, ram: { used: 8e9, total: 16e9 }, disks: [{ name: 'C:', used: 100, size: 400 }], uptime: 3600 };
const bat = (over: Partial<BatteryNow> = {}): BatteryNow => ({ present: true, percent: 100, state: 'full', health: 97.7, ...over });

function setup(battery: () => Promise<BatteryNow>, liveData: typeof live = live) {
  const calls = { battery: 0 };
  const fake = { overview: async () => overview, live: async () => liveData, battery: async () => { calls.battery++; return battery(); } };
  TestBed.resetTestingModule();
  TestBed.configureTestingModule({ imports: [Dashboard], providers: [{ provide: SystemService, useValue: fake }, provideRouter([])] });
  const fixture = TestBed.createComponent(Dashboard);
  return { fixture, el: fixture.nativeElement as HTMLElement, calls };
}
const flush = async (fixture: { whenStable(): Promise<unknown>; detectChanges(): void }) => {
  fixture.detectChanges();
  await fixture.whenStable();
  await new Promise((r) => setTimeout(r, 0));
  fixture.detectChanges();
};
// with fake timers a setTimeout-based wait would never end: let the fake clock run the pending work instead
const flushFake = async (fixture: { whenStable(): Promise<unknown>; detectChanges(): void }) => {
  fixture.detectChanges();
  await vi.advanceTimersByTimeAsync(0);
  await fixture.whenStable();
  fixture.detectChanges();
};
const labels = (el: HTMLElement) => Array.from(el.querySelectorAll('.stat-label')).map((l) => l.textContent?.trim());

afterEach(() => {
  vi.useRealTimers();
});

describe('Dashboard: battery card', () => {
  it('a laptop gets a Battery card with the charge, the state and the health, next to CPU, Memory and Uptime', async () => {
    const { fixture, el } = setup(async () => bat());
    await flush(fixture);
    expect(labels(el)).toEqual(['CPU', 'Memory', 'Uptime', 'Battery']);
    const card = Array.from(el.querySelectorAll('.stat')).find((s) => s.textContent?.includes('Battery'))!;
    expect(card.textContent).toContain('100%');
    expect(card.textContent).toContain('Plugged in, full · Health 98%');
    fixture.destroy();
  });

  it('says what the battery is doing: charging, on battery, plugged in but not charging; the health is left out when unknown', async () => {
    for (const [over, line] of [
      [{ state: 'charging' as const, percent: 40 }, 'Charging · Health 98%'],
      [{ state: 'discharging' as const, percent: 55, health: null }, 'On battery'],
      [{ state: 'plugged' as const, percent: 80 }, 'Plugged in, not charging · Health 98%'],
      [{ state: undefined, health: null }, 'State not reported'],
    ] as const) {
      const { fixture, el } = setup(async () => bat(over));
      await flush(fixture);
      expect(Array.from(el.querySelectorAll('.stat')).find((s) => s.textContent?.includes('Battery'))?.textContent).toContain(line);
      fixture.destroy();
    }
  });

  it('a desktop has no card and is asked about the battery only once, however long the page stays open', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { fixture, el, calls } = setup(async () => ({ present: false }));
    await flushFake(fixture);
    expect(labels(el)).toEqual(['CPU', 'Memory', 'Uptime']);
    await vi.advanceTimersByTimeAsync(120000);
    expect(calls.battery).toBe(1);
    fixture.destroy();
  });

  it('a laptop is read again every 30 seconds, and not any more once the page is closed', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const { fixture, calls } = setup(async () => bat());
    await flushFake(fixture);
    expect(calls.battery).toBe(1);
    await vi.advanceTimersByTimeAsync(30000);
    expect(calls.battery).toBe(2);
    await vi.advanceTimersByTimeAsync(60000);
    expect(calls.battery).toBe(4);
    fixture.destroy();
    await vi.advanceTimersByTimeAsync(120000);
    expect(calls.battery).toBe(4);
  });

  it('a failed read leaves the card as it was and tries again later', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let n = 0;
    const { fixture, el } = setup(async () => { if (n++ === 1) throw new Error('wmi busy'); return bat({ percent: n === 1 ? 90 : 80 }); });
    await flushFake(fixture);
    expect(el.textContent).toContain('90%');
    await vi.advanceTimersByTimeAsync(30000);
    fixture.detectChanges();
    expect(el.textContent).toContain('90%');
    expect(el.querySelector('.alert')).toBeNull();
    await vi.advanceTimersByTimeAsync(30000);
    fixture.detectChanges();
    expect(el.textContent).toContain('80%');
    fixture.destroy();
  });
});

describe('Dashboard: needs attention', () => {
  it('lists a drive that is 85% full or more and a worn battery, each with a link to the page that helps', async () => {
    const a = setup(async () => bat());
    await flush(a.fixture);
    expect(a.el.querySelector('.attention')).toBeNull(); // C: is 25% full, battery health 98%
    a.fixture.destroy();

    const b = setup(async () => bat({ health: 70 }), { ...live, disks: [{ name: 'C:', used: 91, size: 100 }] });
    await flush(b.fixture);
    const rows = Array.from(b.el.querySelectorAll('.attention li')).map((li) => li.textContent?.replace(/\s+/g, ' ').trim());
    expect(rows).toEqual(['Drive C: is 91% fullFree up space', 'Battery health is 70%See battery']);
    expect(Array.from(b.el.querySelectorAll('.attention a')).map((a) => a.getAttribute('href'))).toEqual(['/disk', '/battery']);
    b.fixture.destroy();
  });

  it('says all clear only after the battery has answered', async () => {
    let answer: (b: BatteryNow) => void = () => {};
    const { fixture, el } = setup(() => new Promise<BatteryNow>((r) => (answer = r)));
    await flush(fixture);
    expect(el.querySelector('.all-clear')).toBeNull();
    answer(bat());
    await flush(fixture);
    expect(el.querySelector('.all-clear')).not.toBeNull();
    fixture.destroy();
  });
});
