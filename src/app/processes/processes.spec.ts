import { TestBed } from '@angular/core/testing';
import { ProcessGroup } from '../api';
import { SystemService } from '../system.service';
import { Processes } from './processes';

const GB = 1024 ** 3;
const MB = 1024 ** 2;
const group = (
  name: string,
  pids: number[],
  memBytes: number,
  cpu: number | null,
  over: Partial<ProcessGroup> = {},
): ProcessGroup =>
  ({ name, pids, memBytes, cpu, title: null, protected: false, ...over }) as ProcessGroup;

const GROUPS = [
  group('brave', [1, 2, 3], 3 * GB, 2.1),
  group('node', [4, 5], 200 * MB, 0.4),
  group('MsMpEng', [6], 100 * MB, null),
  group('svchost', [7, 8], 50 * MB, 1, { protected: true }),
];

async function start() {
  TestBed.configureTestingModule({
    imports: [Processes],
    providers: [{ provide: SystemService, useValue: { processes: () => Promise.resolve(GROUPS) } }],
  });
  const fixture = TestBed.createComponent(Processes);
  await fixture.whenStable();
  fixture.detectChanges();
  return { fixture, el: fixture.nativeElement as HTMLElement };
}

describe('Processes', () => {
  it('counts every program above the table, even the Windows ones that are hidden', async () => {
    const { fixture, el } = await start();
    const stats = Array.from(el.querySelectorAll('.strip .stat')).map((s) =>
      s.textContent?.replace(/\s+/g, ' ').trim(),
    );
    expect(stats[0]).toBe('Programs4');
    expect(stats[1]).toBe('Processes8');
    expect(stats[2]).toContain('4%'); // 2.1 + 0.4 + 1 = 3.5 (the hidden svchost counts; MsMpEng has no reading), shown rounded
    expect(stats[3]).toContain('Shared pages count twice');
    fixture.destroy();
  });

  it('draws each memory bar against the biggest row, amber from 1 GB', async () => {
    const { fixture, el } = await start();
    const bars = Array.from(el.querySelectorAll<HTMLElement>('.membar > i'));
    expect(bars.length).toBe(3); // svchost is protected and hidden
    expect(bars[0].style.width).toBe('100%');
    expect(bars[0].classList.contains('big')).toBe(true);
    expect(parseFloat(bars[1].style.width)).toBeCloseTo((200 / 3072) * 100, 1);
    expect(bars[1].classList.contains('big')).toBe(false);
    fixture.destroy();
  });

  it('shows no CPU figure in the strip when no program has a reading', async () => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      imports: [Processes],
      providers: [
        {
          provide: SystemService,
          useValue: { processes: () => Promise.resolve([group('a', [1], MB, null)]) },
        },
      ],
    });
    const fixture = TestBed.createComponent(Processes);
    await fixture.whenStable();
    fixture.detectChanges();
    expect(
      (fixture.nativeElement as HTMLElement).querySelectorAll('.strip .stat')[2].textContent,
    ).toContain('-');
    fixture.destroy();
  });
});
