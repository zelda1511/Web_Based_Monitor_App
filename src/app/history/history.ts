import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { HistoryData, HistoryEvent } from '../api';
import { errorText, formatBytes } from '../format';
import { SystemService } from '../system.service';
import { UiService } from '../ui.service';
import { whenVisible } from '../visible';

type Range = '1h' | '24h';

const W = 720;
const H = 220;
const LEFT = 36;
const RIGHT = W - 12;
const TOP = 10;
const BOTTOM = H - 22;
const SPAN: Record<Range, number> = { '1h': 3600_000, '24h': 24 * 3600_000 };
const GAP: Record<Range, number> = { '1h': 35_000, '24h': 3 * 60_000 }; // a longer silence than this breaks the line (the app was closed or recording was off)
const REFRESH_MS = 10_000;

const yOf = (percent: number) =>
  TOP + (1 - Math.min(100, Math.max(0, percent)) / 100) * (BOTTOM - TOP);

// Points joined into lines, but cut where the recording has a hole, so a closed app is not drawn as a smooth line.
export function lineSegments(
  points: { x: number; y: number; t: number }[],
  gapMs: number,
): string[] {
  const out: string[] = [];
  let run: string[] = [];
  let prev: number | null = null;
  for (const p of points) {
    if (prev !== null && p.t - prev > gapMs) {
      if (run.length > 1) out.push(run.join(' '));
      run = [];
    }
    run.push(`${p.x.toFixed(1)},${p.y.toFixed(1)}`);
    prev = p.t;
  }
  if (run.length > 1) out.push(run.join(' '));
  return out;
}

@Component({
  imports: [DatePipe, DecimalPipe],
  selector: 'app-history',
  templateUrl: './history.html',
  styleUrl: './history.scss',
})
export class History implements OnInit {
  private readonly sys = inject(SystemService);
  private readonly ui = inject(UiService);
  private readonly destroyRef = inject(DestroyRef);

  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;

  protected readonly fmt = formatBytes;
  protected readonly view = { W, H, LEFT, RIGHT, TOP, BOTTOM };
  protected readonly ticks = [0, 50, 100].map((v) => ({ v, y: yOf(v) }));
  protected readonly ranges: { id: Range; label: string }[] = [
    { id: '1h', label: 'Last hour' },
    { id: '24h', label: 'Last 24 hours' },
  ];

  protected readonly range = signal<Range>('1h');
  protected readonly data = signal<HistoryData | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly hoverT = signal<number | null>(null);
  private readonly asOf = signal(Date.now());

  private x(t: number) {
    const frac =
      (t - (this.asOf() - SPAN[this.data()?.range ?? this.range()])) /
      SPAN[this.data()?.range ?? this.range()];
    return LEFT + Math.min(1, Math.max(0, frac)) * (RIGHT - LEFT);
  }

  protected readonly plot = computed(() =>
    (this.data()?.points ?? []).map((p) => ({
      t: p.t,
      x: this.x(p.t),
      cpuY: yOf(p.cpu),
      ramY: yOf(p.ram),
      p,
    })),
  );
  protected readonly cpuLines = computed(() =>
    lineSegments(
      this.plot().map((q) => ({ t: q.t, x: q.x, y: q.cpuY })),
      GAP[this.data()?.range ?? this.range()],
    ),
  );
  protected readonly ramLines = computed(() =>
    lineSegments(
      this.plot().map((q) => ({ t: q.t, x: q.x, y: q.ramY })),
      GAP[this.data()?.range ?? this.range()],
    ),
  );
  protected readonly hovered = computed(() => {
    const t = this.hoverT();
    return t == null ? null : (this.plot().find((q) => q.t === t) ?? null);
  });
  protected readonly empty = computed(() => (this.data()?.points.length ?? 0) === 0);
  protected readonly startLabel = computed(() =>
    this.data()?.range === '24h' ? '24 h ago' : '1 h ago',
  );

  ngOnInit() {
    this.destroyRef.onDestroy(() => {
      this.stopped = true;
      clearTimeout(this.timer);
    });
    void this.loop();
  }

  private async loop() {
    await whenVisible(); // nothing is read while the window is hidden
    if (this.stopped) return;
    await this.refresh();
    if (!this.stopped) this.timer = setTimeout(() => void this.loop(), REFRESH_MS);
  }

  protected async refresh() {
    try {
      this.asOf.set(Date.now());
      this.data.set(await this.sys.history(this.range()));
      this.error.set(null);
    } catch (e) {
      this.error.set(errorText(e));
    }
  }

  protected async pick(r: Range) {
    if (this.range() === r) return;
    this.range.set(r);
    this.hoverT.set(null);
    await this.refresh();
  }

  protected async toggle(e: Event) {
    const on = (e.target as HTMLInputElement).checked;
    try {
      await this.sys.setAutomation({ history: { on } });
      this.ui.toast(
        on
          ? 'Recording started. A graph needs a few minutes of data.'
          : 'Recording stopped. What was recorded is kept until you clear it.',
        'success',
      );
    } catch (err) {
      this.ui.toast(errorText(err), 'error');
    }
    await this.refresh();
  }

  protected async clear() {
    const ok = await this.ui.confirm({
      title: 'Clear the history?',
      body: 'Everything recorded so far (the graph and the busy moments) is erased from this PC. Recording keeps going if it is switched on.',
      confirmLabel: 'Clear history',
      danger: true,
    });
    if (!ok) return;
    try {
      this.data.set(await this.sys.clearHistory());
    } catch (err) {
      this.ui.toast(errorText(err), 'error');
    }
  }

  protected onMove(e: PointerEvent) {
    const plot = this.plot();
    if (!plot.length) return;
    const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    let best = plot[0];
    for (const q of plot) if (Math.abs(q.x - x) < Math.abs(best.x - x)) best = q;
    this.hoverT.set(Math.abs(best.x - x) < 24 ? best.t : null);
  }

  protected programs(ev: HistoryEvent) {
    // programs under 1% are noise; keep at least the busiest one
    const shown = ev.top.filter((p) => p.cpu == null || p.cpu >= 1);
    return (shown.length ? shown : ev.top.slice(0, 1))
      .map((p) => `${p.name}${p.cpu == null ? '' : ' ' + Math.round(p.cpu) + '%'}`)
      .join(', ');
  }
}
