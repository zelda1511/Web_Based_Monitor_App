import { Injectable, computed, inject, signal } from '@angular/core';
import { AutoPatch, AutoState } from './api';
import { errorText, formatBytes } from './format';
import { SystemService } from './system.service';
import { UiService } from './ui.service';

export type Feature = 'disk' | 'battery' | 'updates' | 'startup' | 'clean';

// What each "Automate this" button does, in plain words (the same text is the toast after pressing it).
export const FEATURE_TEXT: Record<Feature, { name: string; does: string }> = {
  disk: { name: 'low disk space', does: 'You will get a warning when a drive has less than the chosen share of free space.' },
  battery: { name: 'battery', does: 'You will get a warning when the battery runs low on battery power, and once when its health falls under the chosen level.' },
  updates: { name: 'waiting updates', does: 'Once a day the app checks for app updates and warns you when there are new ones. It never installs anything by itself.' },
  startup: { name: 'new startup programs', does: 'You will get a warning when a new program adds itself to Windows startup.' },
  clean: { name: 'cleaning old temp files', does: 'Old temporary files are cleaned automatically.' },
};

// The automation's state, shared by the Automation page and the small "Automate this" buttons on the other pages.
@Injectable({ providedIn: 'root' })
export class AutomationService {
  private readonly sys = inject(SystemService);
  private readonly ui = inject(UiService);

  readonly state = signal<AutoState | null>(null);
  readonly error = signal<string | null>(null);
  readonly master = computed(() => this.state()?.settings.automation === true);

  private loading: Promise<void> | null = null;

  // Several buttons on one page ask at once; they share one look.
  load(): Promise<void> {
    this.loading ??= (async () => {
      try {
        this.state.set(await this.sys.automation());
        this.error.set(null);
      } catch (e) {
        this.error.set(errorText(e)); // outside Electron the state simply stays empty
      } finally {
        this.loading = null;
      }
    })();
    return this.loading;
  }

  async set(patch: AutoPatch) {
    try {
      this.state.set(await this.sys.setAutomation(patch));
      this.error.set(null);
    } catch (e) {
      this.ui.toast(errorText(e), 'error');
    }
  }

  on(feature: Feature): boolean {
    const s = this.state()?.settings;
    if (!s) return false;
    return feature === 'clean' ? s.clean.on : s.warn[feature].on;
  }

  // Switching cleaning ON shows what would be cleaned right now and the rules, and only a "yes" to that turns it on.
  async enableClean(): Promise<boolean> {
    try {
      const p = await this.sys.previewAutoClean();
      const lines = p.targets.map((t) => (t.refused ? `${t.label}: skipped (${t.refused})` : `${t.label}: ${t.items} item${t.items === 1 ? '' : 's'}, ${formatBytes(t.bytes)} now`));
      const total = p.targets.reduce((n, t) => n + t.bytes, 0);
      const s = this.state()?.settings.clean;
      const days = s?.everyDays ?? 7;
      const when = [
        ...((s?.idleMinutes ?? 5) > 0 ? [`you have been away from the PC for ${s?.idleMinutes ?? 5} minutes`] : []),
        ...((s?.onlyOnAc ?? true) ? ['the PC is on the charger'] : []),
      ];
      const ok = await this.ui.confirm({
        title: 'Clean old temporary files automatically?',
        body: `Right now this would clean ${formatBytes(total)}. From now on, every ${days === 1 ? 'day' : `${days} days`}, while the app is running${when.length ? ` and ${when.join(' and ')}` : ''}, the same cleaning as the Cleanup page runs by itself: only your own temp folders, only files untouched for 7 days, files in use are skipped. Windows' own temp folder is never touched. Each run is listed on the Automation page, and you can switch it off at any time.`,
        items: lines,
        confirmLabel: 'Turn on automatic cleaning',
      });
      if (!ok) return false;
      this.state.set(await this.sys.enableAutoClean(p.token));
      return true;
    } catch (e) {
      this.ui.toast(errorText(e), 'error');
      return false;
    }
  }

  async turnOn(feature: Feature) {
    if (feature === 'clean') {
      if (await this.enableClean()) this.ui.toast('Automatic cleaning is on. See the Automation page for the settings and the log.', 'success');
      return;
    }
    await this.set({ warn: { [feature]: { on: true } } });
    if (this.on(feature)) this.ui.toast(`${FEATURE_TEXT[feature].does} Change it on the Automation page.`, 'success');
  }

  async turnOff(feature: Feature) {
    await this.set(feature === 'clean' ? { clean: { on: false } } : { warn: { [feature]: { on: false } } });
  }
}
