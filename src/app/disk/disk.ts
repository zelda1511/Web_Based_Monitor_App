import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { BinList, CacheGroup, DiskDrive, DiskListing, DiskRow, DiskStart, LargeFile, LargeScan } from '../api';
import { Automate } from '../automate-button';
import { errorText, formatAge, formatBytes } from '../format';
import { Icon } from '../icon';
import { SystemService } from '../system.service';
import { UiService } from '../ui.service';

type Tab = 'folders' | 'downloads' | 'bin' | 'caches';

const SHOWN_IN_DIALOG = 15;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

@Component({
  imports: [Icon, Automate],
  selector: 'app-disk',
  templateUrl: './disk.html',
  styleUrl: './disk.scss',
})
export class DiskSpace implements OnInit {
  private readonly sys = inject(SystemService);
  private readonly ui = inject(UiService);

  protected readonly fmt = formatBytes;
  protected readonly ageOf = formatAge;
  protected readonly tabs: { id: Tab; label: string }[] = [
    { id: 'folders', label: 'Folders' },
    { id: 'downloads', label: 'Large files in Downloads' },
    { id: 'bin', label: 'Recycle Bin' },
    { id: 'caches', label: 'Caches' },
  ];
  protected readonly sizes = [50, 100, 500, 1024]; // MB
  protected readonly tab = signal<Tab>('folders');

  // Folders: read-only
  protected readonly drives = signal<DiskDrive[]>([]);
  protected readonly starts = signal<DiskStart[]>([]);
  protected readonly listing = signal<DiskListing | null>(null);
  protected readonly scanning = signal(false);
  protected readonly foldersError = signal<string | null>(null);
  private seq = 0; // a scan that was replaced or stopped must not overwrite the newer one's result
  protected readonly places = computed(() => this.starts().filter((s) => !s.key.startsWith('drive:')));

  // Large files in Downloads
  protected readonly minMb = signal(100);
  protected readonly large = signal<LargeScan | null>(null);
  protected readonly dlLoading = signal(false);
  protected readonly dlError = signal<string | null>(null);
  protected readonly dlPicked = signal<ReadonlySet<string>>(new Set());
  protected readonly dlBusy = signal(false);
  protected readonly dlChosen = computed(() => (this.large()?.files ?? []).filter((f) => this.dlPicked().has(f.id)));
  protected readonly dlChosenBytes = computed(() => this.dlChosen().reduce((n, f) => n + f.bytes, 0));

  // Recycle Bin
  protected readonly bin = signal<BinList | null>(null);
  protected readonly binLoading = signal(false);
  protected readonly binError = signal<string | null>(null);
  protected readonly emptying = signal(false);

  // Browser caches
  protected readonly caches = signal<CacheGroup[] | null>(null);
  protected readonly cacheLoading = signal(false);
  protected readonly cacheError = signal<string | null>(null);
  protected readonly cachePicked = signal<ReadonlySet<string>>(new Set());
  protected readonly cacheBusy = signal(false);
  protected readonly cacheChosen = computed(() => (this.caches() ?? []).filter((g) => this.cachePicked().has(g.id)));
  protected readonly cacheChosenBytes = computed(() => this.cacheChosen().reduce((n, g) => n + g.bytes, 0));
  // in this order; a group with nothing in it is not shown
  protected readonly cacheCats = computed(() =>
    ['Browsers', 'Graphics', 'Developer tools', 'Apps']
      .map((name) => ({ name, items: (this.caches() ?? []).filter((g) => g.group === name) }))
      .filter((c) => c.items.length),
  );

  ngOnInit() {
    this.loadPlaces();
  }

  protected select(t: Tab) {
    this.tab.set(t);
    if (t === 'downloads' && !this.large() && !this.dlLoading()) this.scanDownloads();
    if (t === 'bin' && !this.bin() && !this.binLoading()) this.loadBin();
    if (t === 'caches' && !this.caches() && !this.cacheLoading()) this.loadCaches();
  }

  // ---- Folders ----

  private async loadPlaces() {
    try {
      const [drives, starts] = await Promise.all([this.sys.diskDrives(), this.sys.diskStarts()]);
      this.drives.set(drives);
      this.starts.set(starts);
    } catch (e) {
      this.foldersError.set(errorText(e));
    }
  }

  protected usedPct(d: DiskDrive) {
    return d.size > 0 ? Math.min(100, (d.used / d.size) * 100) : 0;
  }

  protected begin(key: string) {
    return this.run(() => this.sys.scanDiskStart(key));
  }

  protected openRow(r: DiskRow) {
    if (r.id && r.kind === 'folder') return this.run(() => this.sys.scanDiskChild(r.id!));
    return undefined;
  }

  protected goTo(id: string) {
    return this.run(() => this.sys.scanDiskChild(id));
  }

  private async run(start: () => Promise<DiskListing>) {
    const mine = ++this.seq;
    this.scanning.set(true);
    this.foldersError.set(null);
    try {
      const l = await start();
      if (mine === this.seq) this.listing.set(l);
    } catch (e) {
      if (mine === this.seq) this.foldersError.set(errorText(e));
    }
    if (mine === this.seq) this.scanning.set(false);
  }

  protected stop() {
    this.sys.cancelDiskScan().catch(() => undefined);
  }

  protected async show(r: DiskRow) {
    if (!r.id) return;
    try {
      await this.sys.revealDiskItem(r.id);
    } catch (e) {
      this.ui.toast(errorText(e), 'error');
    }
  }

  // ---- Large files in Downloads ----

  protected setMin(mb: number) {
    this.minMb.set(mb);
    return this.scanDownloads();
  }

  protected async scanDownloads() {
    this.dlLoading.set(true);
    try {
      this.large.set(await this.sys.scanDownloads(this.minMb()));
      this.dlError.set(null);
    } catch (e) {
      this.dlError.set(errorText(e));
    }
    this.dlPicked.set(new Set()); // nothing is ticked after a scan: you choose what goes
    this.dlLoading.set(false);
  }

  protected deletedOn(iso: string | null) {
    const t = iso ? Date.parse(iso) : NaN;
    return Number.isNaN(t) ? '' : new Date(t).toLocaleDateString([], { dateStyle: 'medium' });
  }

  protected tickFile(f: LargeFile) {
    if (f.whyNot) return; // the Recycle Bin would not keep it: the box is disabled
    this.dlPicked.update((s) => {
      const next = new Set(s);
      if (!next.delete(f.id)) next.add(f.id);
      return next;
    });
  }

  protected async showFile(f: LargeFile) {
    try {
      await this.sys.revealDownload(f.id);
    } catch (e) {
      this.ui.toast(errorText(e), 'error');
    }
  }

  protected async moveToBin() {
    const chosen = this.dlChosen();
    const shown = chosen.slice(0, SHOWN_IN_DIALOG).map((f) => `${f.name}: ${formatBytes(f.bytes)}`);
    if (chosen.length > shown.length) shown.push(`...and ${chosen.length - shown.length} more`);
    const ok = await this.ui.confirm({
      title: `Move ${plural(chosen.length, 'file')} (${formatBytes(this.dlChosenBytes())}) to the Recycle Bin?`,
      body: 'They are not deleted for good: you can put them back from the Recycle Bin until it is emptied. A file that changed since the scan, or that the Recycle Bin could not keep, is left where it is.',
      items: shown,
      confirmLabel: 'Move to Recycle Bin',
    });
    if (!ok) return;
    this.dlBusy.set(true);
    try {
      const r = await this.sys.trashDownloads(chosen.map((f) => f.id));
      const bad = r.results.find((x) => !x.ok);
      if (r.failed) this.ui.toast(`Moved ${plural(r.moved, 'file')} (${formatBytes(r.freedBytes)}). ${r.failed} left alone: ${bad?.name}: ${bad?.error}`, 'info');
      else this.ui.toast(`Moved ${plural(r.moved, 'file')} to the Recycle Bin (${formatBytes(r.freedBytes)}).`, 'success');
      this.bin.set(null); // what the Recycle Bin holds has changed
    } catch (e) {
      this.ui.toast(errorText(e), 'error');
    }
    this.dlBusy.set(false);
    await this.scanDownloads();
  }

  // ---- Recycle Bin ----

  protected async loadBin() {
    this.binLoading.set(true);
    try {
      this.bin.set(await this.sys.listRecycleBin());
      this.binError.set(null);
    } catch (e) {
      this.binError.set(errorText(e));
    }
    this.binLoading.set(false);
  }

  protected async emptyBin() {
    const b = this.bin();
    if (!b?.totals.items) return;
    const ok = await this.ui.confirm({
      title: `Permanently delete ${plural(b.totals.items, 'item')} (${formatBytes(b.totals.bytes)})?`,
      body: 'The Recycle Bin is emptied on every drive and nothing in it can be recovered afterwards. Only what you are looking at is emptied: if something new arrived in the meantime, nothing is deleted and you are asked to look again.',
      items: b.drives.map((d) => `Drive ${d.drive}: ${plural(d.items, 'item')}, ${formatBytes(d.bytes)}`),
      confirmLabel: 'Empty Recycle Bin',
      danger: true,
    });
    if (!ok) return;
    this.emptying.set(true);
    try {
      const r = await this.sys.emptyRecycleBin();
      this.ui.toast(r.status === 'empty' ? r.message : `${r.message} Freed ${formatBytes(r.freedBytes)}.`, r.status === 'partial' ? 'info' : 'success');
    } catch (e) {
      this.ui.toast(errorText(e), 'error');
    }
    this.emptying.set(false);
    await this.loadBin();
  }

  // ---- Browser caches ----

  protected async loadCaches() {
    this.cacheLoading.set(true);
    try {
      this.caches.set(await this.sys.scanCaches());
      this.cacheError.set(null);
    } catch (e) {
      this.cacheError.set(errorText(e));
    }
    this.cachePicked.set(new Set());
    this.cacheLoading.set(false);
  }

  protected tickCache(g: CacheGroup) {
    if (g.running) return;
    this.cachePicked.update((s) => {
      const next = new Set(s);
      if (!next.delete(g.id)) next.add(g.id);
      return next;
    });
  }

  protected async clearChosen() {
    const chosen = this.cacheChosen();
    const atLeast = chosen.some((g) => g.partial) ? 'at least ' : '';
    const browsers = chosen.some((g) => g.group === 'Browsers');
    const ok = await this.ui.confirm({
      title: `Clear ${plural(chosen.length, 'cache')} (${atLeast}${formatBytes(this.cacheChosenBytes())})?`,
      body: `Only temporary cache files are deleted, for good.${browsers ? ' Cookies, saved passwords, history, bookmarks and extensions are not touched.' : ''} Files in use are skipped. What each one costs is listed below.`,
      items: chosen.map((g) => `${g.name}: ${formatBytes(g.bytes)}. ${g.cost}`),
      confirmLabel: 'Clear cache',
      danger: true,
    });
    if (!ok) return;
    this.cacheBusy.set(true);
    try {
      const r = await this.sys.clearCaches(chosen.map((g) => g.id));
      const skipped = r.results.reduce((n, x) => n + (x.skipped ?? 0), 0);
      const bad = r.results.find((x) => !x.ok);
      const freed = `Freed ${r.results.some((x) => x.partial) ? 'at least ' : ''}${formatBytes(r.freedBytes)}.`;
      if (r.failed) this.ui.toast(`${freed} ${bad?.error ?? 'One was not cleared.'}`, 'info');
      else if (skipped) this.ui.toast(`${freed} ${plural(skipped, 'file')} in use ${skipped === 1 ? 'was' : 'were'} skipped.`, 'info');
      else this.ui.toast(freed, 'success');
    } catch (e) {
      this.ui.toast(errorText(e), 'error');
    }
    this.cacheBusy.set(false);
    await this.loadCaches();
  }
}
