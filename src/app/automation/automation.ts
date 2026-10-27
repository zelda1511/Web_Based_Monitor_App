import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { AutoPatch } from '../api';
import { AutomationService } from '../automation.service';
import { errorText, formatAge, formatBytes } from '../format';
import { Icon } from '../icon';
import { SystemService } from '../system.service';
import { UiService } from '../ui.service';

const REFRESH_MS = 20000;

@Component({
  imports: [Icon],
  selector: 'app-automation',
  templateUrl: './automation.html',
  styleUrl: './automation.scss',
})
export class Automation implements OnInit, OnDestroy {
  protected readonly auto = inject(AutomationService);
  private readonly sys = inject(SystemService);
  private readonly ui = inject(UiService);
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;

  protected readonly fmt = formatBytes;
  protected readonly ageOf = formatAge;
  protected readonly diskOptions = [5, 10, 15, 20, 30];
  protected readonly lowOptions = [10, 15, 20, 30];
  protected readonly healthOptions = [70, 75, 80, 85];
  protected readonly dayOptions = [1, 7, 30];
  protected readonly idleOptions = [0, 5, 15, 30];
  protected readonly testResult = signal<string | null>(null);
  protected readonly s = computed(() => this.auto.state()?.settings ?? null);
  protected readonly jobs = computed(() => this.auto.state()?.status.jobs ?? {});
  protected readonly recent = computed(() => this.auto.state()?.recent ?? []);
  protected readonly paused = computed(() => (this.s()?.quietUntil ?? 0) > Date.now());
  protected readonly lastClean = computed(() => this.recent().find((e) => e.kind === 'clean') ?? null);

  async ngOnInit() {
    await this.auto.load();
    this.refresh();
  }

  ngOnDestroy() {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  // the page looks again every 20 seconds so "last checked" and the activity list stay current
  private refresh() {
    if (this.stopped) return;
    this.timer = setTimeout(async () => {
      await this.auto.load();
      this.refresh();
    }, REFRESH_MS);
  }

  protected set(patch: AutoPatch) {
    return this.auto.set(patch);
  }

  protected pick(e: Event) {
    return Number((e.target as HTMLSelectElement).value);
  }

  // The switch has already flipped on screen; if the person said "Cancel" (or it was refused) nothing changed, so put it back.
  protected async toggleClean(box: HTMLInputElement) {
    if (box.checked) await this.auto.enableClean();
    else await this.auto.set({ clean: { on: false } });
    box.checked = this.auto.on('clean');
  }

  protected async test() {
    try {
      const r = await this.sys.testNotification();
      this.testResult.set(r === 'shown' ? 'Sent. If you can see it, warnings will reach you.' : r === 'paused' ? 'Warnings are paused, so it was only added to the list below.' : 'Windows would not show it. Warnings are still listed below.');
    } catch (e) {
      this.testResult.set(errorText(e));
    }
    await this.auto.load();
  }

  // closes the whole app (the system side refuses while an install or a cleaning is running, and says so)
  protected async quit() {
    try {
      await this.sys.quitApp();
    } catch (e) {
      this.ui.toast(errorText(e), 'error');
    }
  }

  protected pause() {
    return this.set({ quietUntil: this.paused() ? 0 : Date.now() + 3600_000 });
  }

  protected jobLine(id: string) {
    const j = this.jobs()[id];
    if (!j) return 'Not checked yet.';
    if (j.dead) return 'Not available on this PC.';
    if (j.waiting) return `Waiting: ${j.waiting}.`;
    if (j.lastError) return `The last check failed: ${j.lastError}`;
    return j.lastRunAt ? `Last checked ${formatAge(j.lastRunAt)}.` : 'Not checked yet.';
  }

  protected when(ms: number) {
    return new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
  }

  protected what(e: { kind: string; title?: string; body?: string; freedBytes?: number; removed?: number; failed?: number; reasons?: string; stopped?: boolean; note?: string }) {
    if (e.kind === 'clean') {
      const parts = [`Cleaned old temp files: ${formatBytes(e.freedBytes ?? 0)} freed, ${e.removed ?? 0} item${e.removed === 1 ? '' : 's'} removed`];
      if (e.failed) parts.push(`${e.failed} could not be removed${e.reasons ? ` (${e.reasons})` : ''}`);
      if (e.stopped) parts.push('stopped because automation was switched off');
      if (e.note) parts.push(e.note.trim());
      return parts.join('. ');
    }
    return `${e.title ?? ''}${e.body ? ': ' + e.body : ''}`;
  }
}
