import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { BatteryNow, BatteryReport } from '../api';
import { Automate } from '../automate-button';
import { errorText, formatMinutes } from '../format';
import { Icon } from '../icon';
import { SystemService } from '../system.service';

const POLL_MS = 15000;

@Component({
  imports: [Icon, Automate],
  selector: 'app-battery',
  templateUrl: './battery.html',
  styleUrl: './battery.scss',
})
export class Battery implements OnInit {
  private readonly sys = inject(SystemService);
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;

  protected readonly minutes = formatMinutes;
  protected readonly now = signal<BatteryNow | null>(null);
  protected readonly report = signal<BatteryReport | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly reportError = signal<string | null>(null);
  protected readonly present = computed(() => this.now()?.present !== false);

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      this.stopped = true;
      clearTimeout(this.timer);
    });
  }

  ngOnInit() {
    this.refresh();
    this.poll();
  }

  // The live part, every 15 seconds while the page is open; each read finishes before the next is scheduled.
  private async poll() {
    if (this.stopped) return;
    this.timer = setTimeout(async () => {
      await this.readNow();
      this.poll();
    }, POLL_MS);
  }

  private async readNow() {
    try {
      this.now.set(await this.sys.battery());
      this.error.set(null);
    } catch (e) {
      this.error.set(errorText(e));
    }
  }

  protected async refresh() {
    this.loading.set(true);
    await this.readNow();
    if (this.now()?.present) {
      try {
        this.report.set(await this.sys.batteryReport());
        this.reportError.set(null);
      } catch (e) {
        this.reportError.set(errorText(e));
      }
    }
    this.loading.set(false);
  }

  protected wh(mwh: number | null | undefined) {
    return mwh == null ? '-' : `${(mwh / 1000).toFixed(1)} Wh`;
  }

  protected stateText(n: BatteryNow) {
    switch (n.state) {
      case 'charging':
        return n.powerW ? `Charging at ${n.powerW.toFixed(1)} W` : 'Charging';
      case 'discharging':
        return n.minutesLeft != null ? `On battery, about ${formatMinutes(n.minutesLeft)} left` : n.estimating ? 'On battery, estimating the time left...' : 'On battery';
      case 'full':
        return 'Plugged in, full';
      case 'plugged':
        return 'Plugged in, not charging';
      default:
        return 'State not reported';
    }
  }

  protected tone(health: number | null | undefined) {
    return health == null ? '' : health >= 80 ? 'good' : health >= 60 ? 'fair' : 'poor';
  }

  protected bar(health: number | null | undefined) {
    return health == null ? 0 : Math.min(100, Math.max(0, health));
  }

  // "2026-10-10T09:01:21" -> "10 Oct": the date as the report wrote it, never converted
  protected day(local: string) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(local);
    if (!m) return local;
    return `${Number(m[3])} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(m[2]) - 1]}`;
  }

  protected period(h: { from: string; to: string }) {
    const a = this.day(h.from);
    const b = this.day(h.to);
    return a === b ? a : `${a} to ${b}`;
  }
}
