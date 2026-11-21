import { DatePipe, DecimalPipe } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { BatteryNow, Live, Overview } from '../api';
import { errorText, formatBytes, formatUptime } from '../format';
import { Icon } from '../icon';
import { SystemService } from '../system.service';

const MAX_SAMPLES = 60;
const POLL_MS = 2000;
const BATTERY_POLL_MS = 30000;
const W = 600;
const H = 180;
const LEFT = 36;
const RIGHT = W - 12;
const TOP = 10;
const BOTTOM = H - 20;
const STEP = (RIGHT - LEFT) / (MAX_SAMPLES - 1);

const yOf = (percent: number) => TOP + (1 - percent / 100) * (BOTTOM - TOP);

export interface Attention {
  id: string;
  level: 'danger' | 'warn';
  text: string;
  label: string;
  route: string;
}

interface Sample {
  t: number;
  cpu: number;
  ram: number;
}

@Component({
  imports: [DatePipe, DecimalPipe, Icon, RouterLink],
  selector: 'app-dashboard',
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard implements OnInit, OnDestroy {
  private readonly sys = inject(SystemService);
  private timer?: ReturnType<typeof setTimeout>;
  private batteryTimer?: ReturnType<typeof setTimeout>;
  private stopped = false;

  protected readonly fmt = formatBytes;
  protected readonly uptimeText = formatUptime;
  protected readonly view = { W, H, LEFT, RIGHT, TOP, BOTTOM };
  protected readonly ticks = [0, 50, 100].map((v) => ({ v, y: yOf(v) }));

  protected readonly overview = signal<Overview | null>(null);
  protected readonly live = signal<Live | null>(null);
  protected readonly history = signal<Sample[]>([]);
  protected readonly error = signal<string | null>(null);
  protected readonly hoverT = signal<number | null>(null);
  protected readonly battery = signal<BatteryNow | null>(null);

  protected readonly cpuNow = computed(() => this.history().at(-1)?.cpu);
  protected readonly ramNow = computed(() => this.history().at(-1)?.ram);

  // What needs a look, from data this page already reads (no extra scan). Updates are not checked here: that starts winget.
  protected readonly attention = computed<Attention[]>(() => {
    const out: Attention[] = [];
    for (const d of this.live()?.disks ?? []) {
      const pct = (d.used / d.size) * 100;
      if (pct >= 85) out.push({ id: 'disk-' + d.name, level: pct >= 95 ? 'danger' : 'warn', text: `Drive ${d.name} is ${Math.round(pct)}% full`, label: 'Free up space', route: '/disk' });
    }
    const b = this.battery();
    if (b?.present && b.health != null && b.health < 80) {
      out.push({ id: 'battery', level: 'warn', text: `Battery health is ${Math.round(b.health)}%`, label: 'See battery', route: '/battery' });
    }
    return out;
  });

  // Newest sample sits at the right edge; older ones step left.
  private readonly plot = computed(() => {
    const h = this.history();
    return h.map((s, i) => ({ t: s.t, x: RIGHT - (h.length - 1 - i) * STEP, cpuY: yOf(s.cpu), ramY: yOf(s.ram) }));
  });
  protected readonly cpuLine = computed(() => this.plot().map((p) => `${p.x},${p.cpuY}`).join(' '));
  protected readonly ramLine = computed(() => this.plot().map((p) => `${p.x},${p.ramY}`).join(' '));
  protected readonly last = computed(() => this.plot().at(-1));
  protected readonly hovered = computed(() => {
    const t = this.hoverT();
    const i = t == null ? -1 : this.history().findIndex((s) => s.t === t);
    return i < 0 ? null : { sample: this.history()[i], point: this.plot()[i] };
  });

  protected readonly parts = computed(() => {
    const o = this.overview();
    if (!o) return [];
    const fmt = formatBytes;
    return [
      { title: 'Processor', icon: 'cpu', lines: [o.cpu.name, `${o.cpu.cores} cores, ${o.cpu.threads} threads, ${o.cpu.ghz} GHz base`] },
      {
        title: 'Memory',
        icon: 'memory',
        lines: [`${fmt(o.ramTotal)} total`, ...o.ramModules.map((m) => `${fmt(m.size)} ${m.type ?? ''} ${m.mhz ? m.mhz + ' MHz' : ''}`.trim())],
      },
      {
        title: 'Graphics',
        icon: 'gpu',
        lines: o.gpus.length
          ? o.gpus.flatMap((g) => [g.model, `${fmt(g.vramMb * 1024 * 1024)} VRAM, driver ${g.driver}`])
          : ['No graphics card detected'],
      },
      { title: 'Storage', icon: 'disk', lines: o.disks.map((d) => `${d.name}, ${d.type}, ${fmt(d.size)}`) },
      { title: 'Motherboard', icon: 'board', lines: [o.board] },
      { title: 'Operating system', icon: 'os', lines: [`${o.os.name} ${o.os.release}`, o.os.arch] },
    ];
  });

  ngOnInit() {
    this.sys.overview().then((o) => this.overview.set(o), (e) => this.error.set(errorText(e)));
    this.poll();
    this.pollBattery();
  }

  ngOnDestroy() {
    this.stopped = true;
    clearTimeout(this.timer);
    clearTimeout(this.batteryTimer);
  }

  // Its own, slower poll (each read starts PowerShell). A PC without a battery is asked once, then never again.
  private async pollBattery() {
    try {
      const b = await this.sys.battery();
      this.battery.set(b);
      if (!b.present) return;
    } catch {
      // the card simply stays as it was; the next read tries again
    }
    if (!this.stopped) this.batteryTimer = setTimeout(() => this.pollBattery(), BATTERY_POLL_MS);
  }

  protected batteryLine(b: BatteryNow) {
    const state = { charging: 'Charging', discharging: 'On battery', full: 'Plugged in, full', plugged: 'Plugged in, not charging', unknown: 'State not reported' }[b.state ?? 'unknown'];
    return b.health != null ? `${state} · Health ${Math.round(b.health)}%` : state;
  }

  private async poll() {
    try {
      const l = await this.sys.live();
      this.live.set(l);
      this.history.update((h) => [...h, { t: Date.now(), cpu: l.cpu, ram: (l.ram.used / l.ram.total) * 100 }].slice(-MAX_SAMPLES));
      this.error.set(null);
    } catch (e) {
      this.error.set(errorText(e));
    }
    // Wait for each read to finish before scheduling the next, so slow reads never pile up.
    if (!this.stopped) this.timer = setTimeout(() => this.poll(), POLL_MS);
  }

  protected onMove(e: PointerEvent) {
    const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    const h = this.history();
    const i = Math.round(h.length - 1 - (RIGHT - x) / STEP);
    this.hoverT.set(i >= 0 && i < h.length ? h[i].t : null);
  }

  protected percentText(v: number | undefined) {
    return v == null ? '-' : `${Math.round(v)}%`;
  }

  protected severity(d: { used: number; size: number }) {
    const pct = (d.used / d.size) * 100;
    return pct >= 95 ? 'danger' : pct >= 85 ? 'warn' : '';
  }

  protected diskPct(d: { used: number; size: number }) {
    return Math.round((d.used / d.size) * 100);
  }
}
