import { Component, input } from '@angular/core';

// 24px line icons, drawn inline so there is no icon font to load.
@Component({
  selector: 'app-icon',
  host: { class: 'icon' },
  template: `
    <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      @switch (name()) {
        @case ('dashboard') {
          <rect x="3" y="3" width="7" height="9" rx="1.5" /><rect x="14" y="3" width="7" height="5" rx="1.5" />
          <rect x="14" y="12" width="7" height="9" rx="1.5" /><rect x="3" y="16" width="7" height="5" rx="1.5" />
        }
        @case ('software') {
          <rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M3 9.5h18" />
        }
        @case ('processes') {
          <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
        }
        @case ('power') {
          <path d="M12 2v10" /><path d="M18.4 6.6a9 9 0 1 1-12.77.04" />
        }
        @case ('download') {
          <path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" />
        }
        @case ('trash') {
          <path d="M3 6h18" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        }
        @case ('chevron') {
          <path d="m6 9 6 6 6-6" />
        }
        @case ('sun') {
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        }
        @case ('moon') {
          <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
        }
        @case ('monitor') {
          <rect x="2" y="3" width="20" height="14" rx="2" /><path d="M8 21h8M12 17v4" />
        }
        @case ('search') {
          <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
        }
        @case ('folder') {
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
        }
        @case ('x') {
          <path d="M18 6 6 18M6 6l12 12" />
        }
        @case ('refresh') {
          <path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M8 16H3v5" />
        }
        @case ('lock') {
          <rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V7a4 4 0 0 1 8 0v4" />
        }
        @case ('check') {
          <path d="M20 6 9 17l-5-5" />
        }
        @case ('alert') {
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" /><path d="M12 9v4M12 17h.01" />
        }
        @case ('info') {
          <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
        }
        @case ('cpu') {
          <rect x="4" y="4" width="16" height="16" rx="2" /><rect x="9" y="9" width="6" height="6" />
          <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 14h3M1 9h3M1 14h3" />
        }
        @case ('memory') {
          <rect x="2" y="7" width="20" height="10" rx="2" /><path d="M6 11v2M10 11v2M14 11v2M18 11v2" />
        }
        @case ('gpu') {
          <rect x="2" y="6" width="20" height="12" rx="2" /><circle cx="9" cy="12" r="3" /><path d="M16 10h3M16 14h3" />
        }
        @case ('disk') {
          <ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.7 3.6 3 8 3s8-1.3 8-3V5" /><path d="M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3" />
        }
        @case ('board') {
          <rect x="3" y="3" width="18" height="18" rx="2" /><rect x="8" y="8" width="8" height="8" rx="1" />
        }
        @case ('os') {
          <rect x="3" y="3" width="8" height="8" rx="1" /><rect x="13" y="3" width="8" height="8" rx="1" />
          <rect x="3" y="13" width="8" height="8" rx="1" /><rect x="13" y="13" width="8" height="8" rx="1" />
        }
        @case ('archive') {
          <rect x="3" y="4" width="18" height="5" rx="1" /><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9" /><path d="M10 13h4" />
        }
        @case ('shield') {
          <path d="M12 3 4 6v6c0 4.5 3.2 8 8 9 4.8-1 8-4.5 8-9V6z" /><path d="m9.5 9.5 5 5M14.5 9.5l-5 5" />
        }
        @case ('bell') {
          <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" />
        }
        @case ('battery') {
          <rect x="2" y="7" width="17" height="10" rx="2" /><path d="M22 10.5v3" /><path d="M6 10.5v3M10 10.5v3" />
        }
        @case ('package') {
          <path d="M21 8 12 3 3 8v8l9 5 9-5z" /><path d="m3 8 9 5 9-5" /><path d="M12 13v8" />
        }
        @case ('clock') {
          <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
        }
      }
    </svg>
  `,
})
export class Icon {
  readonly name = input.required<string>();
}
