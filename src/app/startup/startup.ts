import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { StartupEntry } from '../api';
import { Automate } from '../automate-button';
import { avatarHue, errorText } from '../format';
import { Icon } from '../icon';
import { SystemService } from '../system.service';
import { UiService } from '../ui.service';

@Component({
  imports: [Icon, Automate],
  selector: 'app-startup',
  templateUrl: './startup.html',
})
export class Startup implements OnInit {
  private readonly sys = inject(SystemService);
  private readonly ui = inject(UiService);

  protected readonly hue = avatarHue;
  protected readonly entries = signal<StartupEntry[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);
  protected readonly busyId = signal<string | null>(null);
  protected readonly onCount = computed(() => this.entries().filter((e) => e.enabled).length);

  ngOnInit() {
    this.load();
  }

  protected async load() {
    this.loading.set(true);
    try {
      this.entries.set(await this.sys.startup());
      this.error.set(null);
    } catch (e) {
      this.error.set(errorText(e));
    }
    this.loading.set(false);
  }

  protected async toggle(entry: StartupEntry, event: Event) {
    const input = event.target as HTMLInputElement;
    const want = input.checked;
    this.busyId.set(entry.id);
    try {
      this.entries.set(await this.sys.setStartup(entry.id, want));
      this.ui.toast(want ? `${entry.name} will start with Windows.` : `${entry.name} will no longer start with Windows.`, 'success');
    } catch (e) {
      input.checked = !want; // put the switch back: nothing changed
      this.ui.toast(errorText(e), 'error');
    }
    this.busyId.set(null);
  }
}
