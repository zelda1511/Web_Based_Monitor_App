import { Component, DestroyRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { filter, map } from 'rxjs';
import { ThemeMode } from './api';
import { Icon } from './icon';
import { Palette, toPaletteItems } from './palette';
import { SystemService } from './system.service';
import { ThemeService } from './theme.service';
import { UiHost } from './ui-host';

// The pages a clicked warning may open (the system side checks the same list; this is the second check).
export const WARNING_ROUTES = ['/disk', '/battery', '/updates', '/startup', '/cleanup', '/automation'];

export interface Section {
  id: string;
  label: string;
  icon: string;
  pages: { path: string; label: string }[];
}

// Five sections on the rail, the pages of the open section as tabs. Every page keeps its route and its label.
export const SECTIONS: Section[] = [
  { id: 'overview', label: 'Overview', icon: 'dashboard', pages: [{ path: '/', label: 'Dashboard' }] },
  {
    id: 'apps',
    label: 'Apps',
    icon: 'package',
    pages: [
      { path: '/software', label: 'Software' },
      { path: '/updates', label: 'App updates' },
      { path: '/catalog', label: 'App catalog' },
      { path: '/find', label: 'Find apps' },
    ],
  },
  {
    id: 'monitor',
    label: 'Monitor',
    icon: 'processes',
    pages: [
      { path: '/processes', label: 'Processes' },
      { path: '/startup', label: 'Startup' },
      { path: '/battery', label: 'Battery' },
    ],
  },
  {
    id: 'clean',
    label: 'Clean up',
    icon: 'trash',
    pages: [
      { path: '/cleanup', label: 'Cleanup' },
      { path: '/disk', label: 'Disk space' },
      { path: '/backups', label: 'Backups' },
    ],
  },
  {
    id: 'system',
    label: 'System',
    icon: 'board',
    pages: [
      { path: '/drivers', label: 'Drivers' },
      { path: '/blocked', label: 'Blocked' },
      { path: '/automation', label: 'Automation' },
    ],
  },
];

// Which section a route belongs to; an unknown route counts as the overview.
export function sectionOf(url: string): Section {
  const path = url.split(/[?#]/)[0] || '/';
  return SECTIONS.find((s) => s.pages.some((p) => p.path === path)) ?? SECTIONS[0];
}

@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, UiHost, Palette],
  host: { '(document:keydown)': 'onKey($event)' },
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  protected readonly theme = inject(ThemeService);
  protected readonly sections = SECTIONS;
  protected readonly modes: { id: ThemeMode; label: string; icon: string }[] = [
    { id: 'light', label: 'Light', icon: 'sun' },
    { id: 'system', label: 'Match Windows', icon: 'monitor' },
    { id: 'dark', label: 'Dark', icon: 'moon' },
  ];

  private readonly router = inject(Router);
  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e) => e instanceof NavigationEnd),
      map(() => this.router.url),
    ),
    { initialValue: this.router.url },
  );
  protected readonly current = computed(() => sectionOf(this.url()));
  // The page each section was last showing, so a click on the rail goes back to it.
  private readonly lastPage = signal<Record<string, string>>({});

  constructor() {
    effect(() => {
      const path = this.url().split(/[?#]/)[0] || '/';
      const id = this.current().id;
      untracked(() => this.lastPage.update((m) => ({ ...m, [id]: path })));
    });
    const stop = inject(SystemService).onNavigate((route) => {
      if (WARNING_ROUTES.includes(route)) void this.router.navigateByUrl(route);
    });
    inject(DestroyRef).onDestroy(stop);
  }

  protected readonly paletteItems = toPaletteItems(SECTIONS);
  protected readonly palette = viewChild.required(Palette);

  protected onKey(e: KeyboardEvent) {
    if ((e.ctrlKey || e.metaKey) && e.key?.toLowerCase() === 'k') {
      e.preventDefault();
      // A confirm dialog is a modal: never open the palette (and navigate) over a pending question. Its own dialog may close itself.
      if (!this.palette().open() && document.querySelector('dialog[open]')) return;
      this.palette().toggle();
    }
  }

  protected target(s: Section) {
    return this.lastPage()[s.id] ?? s.pages[0].path;
  }
}
