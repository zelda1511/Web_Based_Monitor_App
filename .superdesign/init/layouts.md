> Out of date (2026-11-21): the app now uses the "telemetry" look (top bar, side nav, green accent). See ../design-system.md and ../../CLAUDE.md for the current rules; this file describes the earlier rail, tabs and blue accent.

# App shell
A 68 px icon rail with 5 sections; the open section's pages are tabs in a top bar; Light / Match Windows / Dark switch at the right of the bar; a Ctrl+K "Go to page" palette. Content is a router outlet.

### `src/app/app.html`
```html
<div class="shell">
  <aside class="rail">
    <div class="brand" title="Webase System Monitor">
      <span class="logo"><app-icon name="processes" /></span>
      <span class="visually-hidden">Webase System Monitor</span>
    </div>

    <nav class="sections" aria-label="Sections">
      @for (s of sections; track s.id) {
        <a [routerLink]="target(s)" [class.active]="current().id === s.id" [attr.aria-current]="current().id === s.id ? 'true' : null">
          <app-icon [name]="s.icon" />
          <span>{{ s.label }}</span>
        </a>
      }
    </nav>
  </aside>

  <div class="workspace">
    <header class="bar">
      <nav class="tabs" [attr.aria-label]="current().label + ' pages'">
        @for (p of current().pages; track p.path) {
          <a [routerLink]="p.path" routerLinkActive="active" ariaCurrentWhenActive="page" [routerLinkActiveOptions]="{ exact: true }">{{ p.label }}</a>
        }
      </nav>

      <button type="button" class="jump" (click)="palette().toggle()" aria-label="Go to page (Ctrl+K)" title="Go to page (Ctrl+K)">
        <app-icon name="search" /><span>Go to page</span><kbd>Ctrl K</kbd>
      </button>

      <div class="appearance">
        <span class="visually-hidden" id="theme-label">Appearance</span>
        <div class="theme" role="group" aria-labelledby="theme-label">
          @for (m of modes; track m.id) {
            <button type="button" [attr.aria-pressed]="theme.mode() === m.id" [attr.aria-label]="m.label" [title]="m.label" (click)="theme.set(m.id)">
              <app-icon [name]="m.icon" />
            </button>
          }
        </div>
      </div>
    </header>

    <main>
      <router-outlet />
    </main>
  </div>
</div>
<app-ui-host />
<app-palette [items]="paletteItems" />
```

### `src/app/app.ts`
```ts
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
```

### `src/app/app.scss`
```scss
.shell {
  display: flex;
  height: 100vh;
}

// A narrow rail with the five sections; the pages of the open section are the tabs in the bar above the content.
.rail {
  display: flex;
  flex: none;
  flex-direction: column;
  align-items: center;
  width: 68px;
  padding: 10px 6px;
  background: var(--rail-bg);
  border-right: 1px solid var(--bs-border-color);
}

.brand {
  display: grid;
  place-items: center;
  padding: 2px 0 12px;
}

.logo {
  display: grid;
  place-items: center;
  width: 32px;
  height: 32px;
  color: var(--on-accent);
  background: var(--accent);
  border-radius: var(--r-card);
}

.sections {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 100%;

  a {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 8px 2px 7px;
    font-size: 0.7rem;
    font-weight: 500;
    line-height: 1.1;
    color: var(--bs-secondary-color);
    text-decoration: none;
    border-radius: var(--r-card);
    transition: background-color 120ms ease, color 120ms ease;

    &:active {
      background: var(--surface-2);
    }

    // Open section: accent icon, strong label, a short accent bar at the edge. No motion: the rail is used all day.
    &.active {
      font-weight: 650;
      color: var(--bs-body-color);
      background: var(--surface-2);

      &::before {
        position: absolute;
        top: 50%;
        left: -6px;
        width: 3px;
        height: 22px;
        content: '';
        background: var(--accent);
        border-radius: 0 99px 99px 0;
        transform: translateY(-50%);
      }

      .icon {
        color: var(--accent);
      }
    }
  }
}

@media (hover: hover) and (pointer: fine) {
  .sections a:not(.active):hover {
    color: var(--bs-body-color);
    background: color-mix(in srgb, var(--bs-body-color) 7%, transparent);
  }
}

.workspace {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
}

.bar {
  display: flex;
  flex: none;
  align-items: stretch;
  justify-content: space-between;
  gap: 1rem;
  min-height: 40px;
  padding: 0 14px 0 8px;
  border-bottom: 1px solid var(--bs-border-color);
}

.tabs {
  display: flex;
  min-width: 0;

  a {
    position: relative;
    display: flex;
    flex: none;
    align-items: center;
    padding: 0 0.9rem;
    font-weight: 500;
    color: var(--bs-secondary-color);
    white-space: nowrap;
    text-decoration: none;
    transition: color 120ms ease;

    &.active {
      font-weight: 650;
      color: var(--bs-body-color);

      &::after {
        position: absolute;
        right: 0.6rem;
        bottom: -1px;
        left: 0.6rem;
        height: 2px;
        content: '';
        background: var(--accent);
        border-radius: 2px 2px 0 0;
      }
    }
  }
}

@media (hover: hover) and (pointer: fine) {
  .tabs a:not(.active):hover {
    color: var(--bs-body-color);
  }
}

.jump {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  margin-right: 8px;
  padding: 3px 8px;
  color: var(--bs-secondary-color);
  background: var(--surface-2);
  border: 0;
  border-radius: var(--r-ctl);

  &:hover { color: var(--bs-body-color); }

  kbd {
    padding: 0 4px;
    color: inherit;
    background: none;
    border: 1px solid var(--bs-border-color);
    border-radius: var(--r-ctl);
    font-size: 0.6875rem;
  }
}

.appearance {
  display: flex;
  align-items: center;
}

.theme {
  display: flex;
  gap: 1px;
  padding: 2px;
  background: var(--surface-2);
  border-radius: var(--r-ctl);

  button {
    display: grid;
    place-items: center;
    width: 28px;
    height: 24px;
    color: var(--bs-secondary-color);
    background: transparent;
    border: 0;
    border-radius: 3px;
    transition: background-color 150ms ease, color 150ms ease, transform 160ms var(--ease-out);

    &:active {
      transform: scale(0.96);
    }

    &[aria-pressed='true'] {
      color: var(--bs-body-color);
      background: var(--surface);
      box-shadow: 0 1px 2px rgb(0 0 0 / 0.2);
    }
  }
}

main {
  flex: 1;
  min-height: 0;
  padding: 16px 20px 32px;
  overflow: auto;
}
```

### `src/app/palette.ts`
```ts
import { Component, ElementRef, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { Icon } from './icon';

export interface PaletteItem {
  path: string;
  label: string;
  group: string;
}

// Pages the palette can open; App builds them from SECTIONS (this file must not import app.ts: that is a cycle).
export const toPaletteItems = (sections: { label: string; pages: { path: string; label: string }[] }[]): PaletteItem[] =>
  sections.flatMap((s) => s.pages.map((p) => ({ path: p.path, label: p.label, group: s.label })));

// Case-insensitive match on page or section name; every typed word must appear.
export function filterPalette(items: PaletteItem[], query: string): PaletteItem[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return items.filter((i) => words.every((w) => `${i.label} ${i.group}`.toLowerCase().includes(w)));
}

// Ctrl+K quick switcher. Opens a page only; it never runs an action.
@Component({
  selector: 'app-palette',
  imports: [Icon],
  styleUrl: './palette.scss',
  template: `
    @if (open()) {
      <dialog #dlg class="pal" aria-label="Go to page" (cancel)="$event.preventDefault(); close()" (click)="onBackdrop($event)">
        <div class="pal-input">
          <app-icon name="search" />
          <input
            #box
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls="pal-list"
            [attr.aria-activedescendant]="results().length ? 'pal-' + active() : null"
            placeholder="Go to a page..."
            autocomplete="off"
            spellcheck="false"
            [value]="query()"
            (input)="onInput($any($event.target).value)"
            (keydown)="onKey($event)"
          />
        </div>
        <ul id="pal-list" role="listbox">
          @for (r of results(); track r.path; let i = $index) {
            <li role="option" [id]="'pal-' + i" [class.on]="i === active()" [attr.aria-selected]="i === active()" (mouseenter)="active.set(i)" (click)="go(r)">
              <span>{{ r.label }}</span>
              <small>{{ r.group }}</small>
            </li>
          } @empty {
            <li class="none">No page matches</li>
          }
        </ul>
      </dialog>
    }
  `,
})
export class Palette {
  private readonly router = inject(Router);
  private readonly dlg = viewChild<ElementRef<HTMLDialogElement>>('dlg');
  private readonly box = viewChild<ElementRef<HTMLInputElement>>('box');

  readonly items = input.required<PaletteItem[]>();
  readonly open = signal(false);
  protected readonly query = signal('');
  protected readonly active = signal(0);
  protected readonly results = computed(() => filterPalette(this.items(), this.query()));

  constructor() {
    effect(() => {
      const d = this.dlg()?.nativeElement;
      if (d && !d.open) d.showModal();
      this.box()?.nativeElement.focus();
    });
  }

  private opener: Element | null = null;

  toggle() {
    if (this.open()) return this.close();
    this.opener = document.activeElement;
    this.query.set('');
    this.active.set(0);
    this.open.set(true);
  }

  protected close() {
    this.open.set(false);
    (this.opener as HTMLElement | null)?.focus?.();
  }

  protected onInput(v: string) {
    this.query.set(v);
    this.active.set(0);
  }

  protected onKey(e: KeyboardEvent) {
    const n = this.results().length;
    if (e.key === 'ArrowDown' && n) this.active.set((this.active() + 1) % n);
    else if (e.key === 'ArrowUp' && n) this.active.set((this.active() + n - 1) % n);
    else if (e.key === 'Enter') {
      const r = this.results()[this.active()];
      if (r) this.go(r);
    } else return;
    e.preventDefault();
  }

  protected onBackdrop(e: MouseEvent) {
    if (e.target === this.dlg()?.nativeElement) this.close();
  }

  protected go(r: PaletteItem) {
    this.close();
    void this.router.navigateByUrl(r.path);
  }
}
```

### `src/app/palette.scss`
```scss
.pal {
  width: min(480px, calc(100vw - 32px));
  margin: 12vh auto auto;
  padding: 0;
  color: var(--bs-body-color);
  background: var(--surface);
  border: 1px solid var(--bs-border-color);
  border-radius: var(--r-dlg);

  &::backdrop {
    background: rgb(0 0 0 / 0.35);
  }
}

.pal-input {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 12px;
  border-bottom: 1px solid var(--bs-border-color);

  input {
    flex: 1;
    padding: 12px 0;
    color: inherit;
    background: none;
    border: 0;
    outline: 0;
    font-size: 0.9375rem;
  }
}

ul {
  max-height: 320px;
  margin: 0;
  padding: 4px;
  overflow-y: auto;
  list-style: none;
}

li {
  display: flex;
  justify-content: space-between;
  padding: 7px 10px;
  border-radius: var(--r-ctl);
  cursor: pointer;

  &.on {
    color: var(--accent-ink);
    background: var(--accent-soft);
  }

  small {
    color: var(--bs-secondary-color);
  }

  &.none {
    color: var(--bs-secondary-color);
    cursor: default;
  }
}
```

