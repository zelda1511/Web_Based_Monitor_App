import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { HistoryData } from '../api';
import { SystemService } from '../system.service';
import { UiService } from '../ui.service';
import { History, lineSegments } from './history';

const NOW = Date.now();
const data = (over: Partial<HistoryData> = {}): HistoryData => ({
  on: true,
  range: '1h',
  sampleMs: 10_000,
  points: [
    { t: NOW - 30_000, cpu: 10, ram: 50 },
    { t: NOW - 20_000, cpu: 90, ram: 51 },
    { t: NOW - 10_000, cpu: 20, ram: 52 },
  ],
  events: [
    {
      t: NOW - 20_000,
      cpu: 90,
      top: [
        { name: 'busy', cpu: 70.4, memBytes: 100 },
        { name: 'other', cpu: null, memBytes: null },
      ],
    },
  ],
  ...over,
});

async function start(
  first: HistoryData,
  extra: Partial<Record<'history' | 'setAutomation' | 'clearHistory', unknown>> = {},
  confirm = true,
) {
  const sys = {
    history: vi.fn().mockResolvedValue(first),
    setAutomation: vi.fn().mockResolvedValue({}),
    clearHistory: vi.fn().mockResolvedValue(data({ points: [], events: [] })),
    ...extra,
  };
  const ui = { toast: vi.fn(), confirm: vi.fn().mockResolvedValue(confirm) };
  TestBed.configureTestingModule({
    imports: [History],
    providers: [
      { provide: SystemService, useValue: sys },
      { provide: UiService, useValue: ui },
    ],
  });
  const fixture = TestBed.createComponent(History);
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement, sys, ui };
}

describe('lineSegments', () => {
  const pt = (t: number) => ({ t, x: t / 1000, y: 5 });
  it('joins close points into one line', () => {
    expect(lineSegments([pt(0), pt(10_000), pt(20_000)], 35_000)).toEqual([
      '0.0,5.0 10.0,5.0 20.0,5.0',
    ]);
  });
  it('cuts the line where the recording has a hole, and drops a single stray point', () => {
    expect(
      lineSegments([pt(0), pt(10_000), pt(200_000), pt(210_000), pt(500_000)], 35_000),
    ).toEqual(['0.0,5.0 10.0,5.0', '200.0,5.0 210.0,5.0']);
  });
  it('gives nothing for no points', () => {
    expect(lineSegments([], 35_000)).toEqual([]);
  });
});

describe('History page', () => {
  it('says recording is off, with nothing recorded', async () => {
    const { el, fixture } = await start(data({ on: false, points: [], events: [] }));
    expect(el.textContent).toContain('Recording is off');
    expect(el.querySelector('svg')).toBeNull();
    fixture.destroy();
  });

  it('draws the lines and lists the busy moment with its programs', async () => {
    const { el, fixture } = await start(data());
    expect(el.querySelectorAll('polyline.line.cpu').length).toBe(1);
    expect(el.querySelectorAll('polyline.line.ram').length).toBe(1);
    const row = el.querySelector('tbody tr')!.textContent!;
    expect(row).toContain('90%');
    expect(row).toContain('busy 70%, other');
    fixture.destroy();
  });

  it('explains an empty busy-moments list', async () => {
    const { el, fixture } = await start(data({ events: [] }));
    expect(el.textContent).toContain('A moment is written down only when the CPU stays above 85%');
    fixture.destroy();
  });

  it('asks for the 24-hour range when it is picked', async () => {
    const { el, sys, fixture } = await start(data());
    expect(sys.history).toHaveBeenLastCalledWith('1h');
    (
      Array.from(el.querySelectorAll('.seg button')).find((b) =>
        /24/.test(b.textContent!),
      ) as HTMLButtonElement
    ).click();
    await fixture.whenStable();
    expect(sys.history).toHaveBeenLastCalledWith('24h');
    fixture.destroy();
  });

  it('switches recording on through the settings, and says so', async () => {
    const { el, sys, ui, fixture } = await start(data({ on: false, points: [], events: [] }));
    const sw = el.querySelector('input[role=switch]') as HTMLInputElement;
    sw.checked = true;
    sw.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    expect(sys.setAutomation).toHaveBeenCalledWith({ history: { on: true } });
    expect(ui.toast).toHaveBeenCalledWith(expect.stringContaining('Recording started'), 'success');
    fixture.destroy();
  });

  it('clears only after a confirmation, and not when it is declined', async () => {
    const yes = await start(data());
    (
      Array.from(yes.el.querySelectorAll('button')).find(
        (b) => b.textContent!.trim() === 'Clear',
      ) as HTMLButtonElement
    ).click();
    await yes.fixture.whenStable();
    expect(yes.ui.confirm).toHaveBeenCalledWith(expect.objectContaining({ danger: true }));
    expect(yes.sys.clearHistory).toHaveBeenCalled();
    yes.fixture.destroy();

    TestBed.resetTestingModule();
    const no = await start(data(), {}, false);
    (
      Array.from(no.el.querySelectorAll('button')).find(
        (b) => b.textContent!.trim() === 'Clear',
      ) as HTMLButtonElement
    ).click();
    await no.fixture.whenStable();
    expect(no.sys.clearHistory).not.toHaveBeenCalled();
    no.fixture.destroy();
  });

  it('shows an error from the system side', async () => {
    const { el, fixture } = await start(data(), {
      history: vi.fn().mockRejectedValue(new Error('nope')),
    });
    expect(el.querySelector('.alert-danger')?.textContent).toContain('nope');
    fixture.destroy();
  });
});
