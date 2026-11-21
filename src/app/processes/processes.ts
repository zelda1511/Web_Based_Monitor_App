import { DecimalPipe } from '@angular/common';
import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { ProcessGroup } from '../api';
import { avatarHue, compareValues, errorText, formatBytes } from '../format';
import { Icon } from '../icon';
import { SystemService } from '../system.service';
import { UiService } from '../ui.service';
import { whenVisible } from '../visible';

type SortKey = 'name' | 'count' | 'cpu' | 'memBytes';

const POLL_MS = 5000;

@Component({
  imports: [Icon, DecimalPipe],
  selector: 'app-processes',
  templateUrl: './processes.html',
})
export class Processes implements OnInit, OnDestroy {
  private readonly sys = inject(SystemService);
  private readonly ui = inject(UiService);
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private busy = false;

  protected readonly fmt = formatBytes;
  protected readonly hue = avatarHue;
  protected readonly columns: { key: SortKey; label: string; num?: boolean }[] = [
    { key: 'name', label: 'Name' },
    { key: 'count', label: 'Processes', num: true },
    { key: 'cpu', label: 'CPU', num: true },
    { key: 'memBytes', label: 'Memory', num: true },
  ];

  protected readonly groups = signal<ProcessGroup[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly query = signal('');
  protected readonly showSystem = signal(false);
  protected readonly sortKey = signal<SortKey>('memBytes');
  protected readonly sortDir = signal<1 | -1>(-1);

  protected readonly rows = computed(() => {
    const q = this.query().trim().toLowerCase();
    const k = this.sortKey();
    const dir = this.sortDir();
    const value = (g: ProcessGroup) => (k === 'count' ? g.pids.length : g[k]);
    return this.groups()
      .filter((g) => (this.showSystem() || !g.protected) && (!q || g.name.toLowerCase().includes(q) || g.title?.toLowerCase().includes(q)))
      .sort((a, b) => compareValues(value(a), value(b), dir));
  });

  // The strip above the table counts every program, whatever the search box says.
  protected readonly summary = computed(() => {
    const all = this.groups();
    const cpu = all.reduce<number | null>((t, g) => (g.cpu == null ? t : (t ?? 0) + g.cpu), null);
    return { programs: all.length, processes: all.reduce((t, g) => t + g.pids.length, 0), cpu, memBytes: all.reduce((t, g) => t + g.memBytes, 0) };
  });
  // Each memory bar is scaled to the biggest row on screen.
  protected readonly maxMem = computed(() => this.rows().reduce((m, g) => Math.max(m, g.memBytes), 1));
  // Over 1 GB turns the bar amber.
  protected readonly bigBytes = 1024 ** 3;

  ngOnInit() {
    this.poll();
  }

  ngOnDestroy() {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  private async poll() {
    await whenVisible(); // a hidden window starts no PowerShell
    if (this.stopped) return;
    await this.refresh();
    if (!this.stopped) this.timer = setTimeout(() => this.poll(), POLL_MS);
  }

  protected async refresh() {
    if (this.busy) return;
    this.busy = true;
    try {
      this.groups.set(await this.sys.processes());
      this.error.set(null);
    } catch (e) {
      this.error.set(errorText(e));
    }
    this.busy = false;
    this.loading.set(false);
  }

  protected sort(key: SortKey) {
    if (this.sortKey() === key) this.sortDir.update((d) => (d === 1 ? -1 : 1));
    else {
      this.sortKey.set(key);
      this.sortDir.set(key === 'name' ? 1 : -1);
    }
  }

  protected ariaSort(key: SortKey) {
    return this.sortKey() === key ? (this.sortDir() === 1 ? 'ascending' : 'descending') : 'none';
  }

  protected onSearch(e: Event) {
    this.query.set((e.target as HTMLInputElement).value);
  }

  protected onToggleSystem(e: Event) {
    this.showSystem.set((e.target as HTMLInputElement).checked);
  }

  protected async end(g: ProcessGroup) {
    const n = g.pids.length;
    const ok = await this.ui.confirm({
      title: `End ${g.name}?`,
      body: `${n > 1 ? `All ${n} ${g.name} processes` : `${g.name}`} will be closed at once. Anything unsaved in ${n > 1 ? 'them' : 'it'} is lost.`,
      confirmLabel: 'End task',
      danger: true,
    });
    if (!ok) return;
    try {
      const results = await this.sys.endTasks(g.pids);
      const done = results.filter((r) => r.ok).length;
      const problem = results.find((r) => !r.ok && r.error !== 'Already closed');
      if (!problem) this.ui.toast(`Ended ${g.name}.`, 'success');
      else this.ui.toast(`${done ? `Ended ${done} of ${n}. ` : ''}${g.name}: ${problem.error}.`, 'error');
    } catch (e) {
      this.ui.toast(errorText(e), 'error');
    }
    await this.refresh();
  }
}
