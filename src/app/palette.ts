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
