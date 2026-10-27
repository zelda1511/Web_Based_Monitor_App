import { Component, DestroyRef, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { ThemeMode } from './api';
import { Icon } from './icon';
import { SystemService } from './system.service';
import { ThemeService } from './theme.service';
import { UiHost } from './ui-host';

// The pages a clicked warning may open (the system side checks the same list; this is the second check).
export const WARNING_ROUTES = ['/disk', '/battery', '/updates', '/startup', '/cleanup', '/automation'];

@Component({
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon, UiHost],
  selector: 'app-root',
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  protected readonly theme = inject(ThemeService);
  protected readonly modes: { id: ThemeMode; label: string; icon: string }[] = [
    { id: 'light', label: 'Light', icon: 'sun' },
    { id: 'system', label: 'Match Windows', icon: 'monitor' },
    { id: 'dark', label: 'Dark', icon: 'moon' },
  ];

  constructor() {
    const router = inject(Router);
    const stop = inject(SystemService).onNavigate((route) => {
      if (WARNING_ROUTES.includes(route)) void router.navigateByUrl(route);
    });
    inject(DestroyRef).onDestroy(stop);
  }
}
