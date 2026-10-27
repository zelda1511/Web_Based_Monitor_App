import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { AppUpdate } from '../api';
import { Automate } from '../automate-button';
import { avatarHue, errorText } from '../format';
import { SystemService } from '../system.service';
import { UiService } from '../ui.service';

interface Outcome {
  id: string;
  name: string;
  ok: boolean;
  message: string | null;
}

@Component({
  imports: [Automate],
  selector: 'app-updates',
  templateUrl: './updates.html',
})
export class Updates implements OnInit {
  private readonly sys = inject(SystemService);
  private readonly ui = inject(UiService);
  private stopAsked = false;

  protected readonly hue = avatarHue;
  protected readonly items = signal<AppUpdate[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly checkedAt = signal<number | null>(null);
  protected readonly updatingId = signal<string | null>(null); // the app being updated right now
  protected readonly heldBack = computed(() => this.items().filter((i) => i.explicit).length);
  protected readonly picked = signal<ReadonlySet<string>>(new Set());
  protected readonly batch = signal<{ index: number; total: number } | null>(null); // set while "Update selected" is running
  protected readonly outcomes = signal<Outcome[] | null>(null);
  protected readonly updatable = computed(() => this.items().filter((i) => this.canUpdate(i)));
  protected readonly chosen = computed(() => this.updatable().filter((i) => this.picked().has(i.id)));
  protected readonly busy = computed(() => this.updatingId() !== null || this.batch() !== null);

  constructor() {
    // Leaving the page must not leave a batch running with no progress and no Stop button: nothing new is started after this.
    inject(DestroyRef).onDestroy(() => (this.stopAsked = true));
  }

  ngOnInit() {
    this.load();
  }

  protected async load() {
    this.loading.set(true);
    try {
      this.items.set(await this.sys.appUpdates());
      this.checkedAt.set(Date.now());
      this.error.set(null);
    } catch (e) {
      this.error.set(errorText(e));
    }
    const still = new Set(this.updatable().map((i) => i.id));
    this.picked.update((s) => new Set([...s].filter((id) => still.has(id)))); // an app that was updated is no longer ticked
    this.loading.set(false);
  }

  // Only plain winget updates: held-back ones and ones from other sources are updated elsewhere.
  protected canUpdate(u: AppUpdate) {
    return !u.explicit && u.source === 'winget' && u.id !== 'Microsoft.AppInstaller';
  }

  protected tick(u: AppUpdate) {
    if (this.busy() || !this.canUpdate(u)) return;
    this.picked.update((s) => {
      const next = new Set(s);
      if (!next.delete(u.id)) next.add(u.id);
      return next;
    });
  }

  protected selectAll() {
    this.picked.set(new Set(this.updatable().map((i) => i.id)));
  }

  protected clearTicks() {
    this.picked.set(new Set());
  }

  protected stop() {
    this.stopAsked = true;
  }

  protected async update(u: AppUpdate) {
    const ok = await this.ui.confirm({
      title: `Update ${u.name}?`,
      body: `From ${u.version} to ${u.available}, from winget's community catalogue. Close ${u.name} first if it is open. Windows may ask for permission.`,
      confirmLabel: 'Update',
    });
    if (!ok) return;
    this.updatingId.set(u.id);
    this.ui.toast(`Updating ${u.name}. If Windows asks for permission, choose Yes. No prompt in sight? Look for a flashing shield in the taskbar.`, 'info');
    try {
      const r = await this.sys.upgradeApp(u.id);
      if (r.updated) this.ui.toast(`${u.name} is now version ${r.to}.`, 'success');
      else this.ui.toast(`${u.name} was not updated. ${r.message ?? ''}`.trim(), 'error');
    } catch (e) {
      this.ui.toast(errorText(e), 'error');
    }
    this.updatingId.set(null);
    await this.load();
  }

  // The ticked apps, one after another, each through the same single-app update (one permission prompt for an all-users app).
  protected async updateSelected() {
    const chosen = this.chosen();
    if (!chosen.length) return;
    const ok = await this.ui.confirm({
      title: `Update ${chosen.length} app${chosen.length === 1 ? '' : 's'}?`,
      body: "They update one after another from winget's community catalogue. Close them first if they are open. Windows may ask for permission for some: stay at the PC and choose Yes. You can stop after the one that is running.",
      items: chosen.map((u) => `${u.name}: ${u.version} to ${u.available}`),
      confirmLabel: 'Update',
    });
    if (!ok) return;
    this.stopAsked = false;
    this.outcomes.set(null);
    const done: Outcome[] = [];
    for (let i = 0; i < chosen.length; i++) {
      if (this.stopAsked) break;
      const u = chosen[i];
      this.batch.set({ index: i + 1, total: chosen.length });
      this.updatingId.set(u.id);
      try {
        const r = await this.sys.upgradeApp(u.id);
        done.push({ id: u.id, name: u.name, ok: r.updated, message: r.updated ? `now ${r.to}` : r.message });
      } catch (e) {
        done.push({ id: u.id, name: u.name, ok: false, message: errorText(e) });
      }
    }
    this.updatingId.set(null);
    this.batch.set(null);
    this.outcomes.set(done);
    const good = done.filter((d) => d.ok).length;
    const parts = [`${good} of ${chosen.length} updated.`];
    if (done.length - good) parts.push(`${done.length - good} did not update.`);
    if (chosen.length - done.length) parts.push(`Stopped: ${chosen.length - done.length} not started.`);
    this.ui.toast(parts.join(' '), good === chosen.length ? 'success' : 'info');
    await this.load();
  }

  protected timeOf(ms: number) {
    return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
}
