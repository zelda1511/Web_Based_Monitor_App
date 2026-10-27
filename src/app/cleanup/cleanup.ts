import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { CleanupGroup } from '../api';
import { Automate } from '../automate-button';
import { errorText, formatAge, formatBytes } from '../format';
import { Icon } from '../icon';
import { SystemService } from '../system.service';
import { UiService } from '../ui.service';

@Component({
  imports: [Icon, Automate],
  selector: 'app-cleanup',
  templateUrl: './cleanup.html',
  styleUrl: './cleanup.scss',
})
export class Cleanup implements OnInit {
  private readonly sys = inject(SystemService);
  private readonly ui = inject(UiService);

  protected readonly fmt = formatBytes;
  protected readonly age = formatAge;
  protected readonly groups = signal<CleanupGroup[]>([]);
  protected readonly scanning = signal(true);
  protected readonly deleting = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly picked = signal<ReadonlySet<string>>(new Set());
  protected readonly open = signal<ReadonlySet<string>>(new Set());

  protected readonly pickedGroups = computed(() => this.groups().filter((g) => this.picked().has(g.id)));
  protected readonly pickedBytes = computed(() => this.pickedGroups().reduce((n, g) => n + g.totalBytes, 0));
  protected readonly pickedItems = computed(() => this.pickedGroups().reduce((n, g) => n + g.itemCount, 0));

  ngOnInit() {
    this.scan();
  }

  protected async scan() {
    this.scanning.set(true);
    try {
      this.groups.set(await this.sys.scanCleanup());
      this.error.set(null);
    } catch (e) {
      this.error.set(errorText(e));
    }
    this.picked.set(new Set()); // nothing is ticked after a scan: you choose what goes
    this.scanning.set(false);
  }

  protected pick(g: CleanupGroup) {
    this.picked.update((s) => {
      const next = new Set(s);
      if (!next.delete(g.id)) next.add(g.id);
      return next;
    });
  }

  protected toggleOpen(g: CleanupGroup) {
    this.open.update((s) => {
      const next = new Set(s);
      if (!next.delete(g.id)) next.add(g.id);
      return next;
    });
  }

  protected async remove() {
    const chosen = this.pickedGroups();
    const ok = await this.ui.confirm({
      title: `Delete ${formatBytes(this.pickedBytes())} of temporary files?`,
      body: `${this.pickedItems()} items will be deleted for good, not moved to the Recycle Bin. Files that are in use are skipped.`,
      items: chosen.map((g) => `${g.label}: ${formatBytes(g.totalBytes)}`),
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    this.deleting.set(true);
    try {
      const results = await this.sys.deleteCleanup(chosen.map((g) => g.id));
      const freed = results.reduce((n, r) => n + r.freedBytes, 0);
      const failed = results.reduce((n, r) => n + r.failedItems, 0);
      const reasons = [...new Set(results.flatMap((r) => r.reasons))].join(', ');
      if (failed) this.ui.toast(`Freed ${formatBytes(freed)}. ${failed} item${failed > 1 ? 's' : ''} could not be fully removed (${reasons}).`, 'info');
      else this.ui.toast(`Freed ${formatBytes(freed)}.`, 'success');
    } catch (e) {
      this.ui.toast(errorText(e), 'error');
    }
    this.deleting.set(false);
    await this.scan();
  }
}
