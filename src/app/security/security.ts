import { DatePipe } from '@angular/common';
import { Component, OnInit, inject, signal } from '@angular/core';
import { SecurityReport } from '../api';
import { errorText } from '../format';
import { Icon } from '../icon';
import { SystemService } from '../system.service';

// A read-only look at Windows' own protection (electron/security.js). It reads once when the page opens and again on "Check again";
// nothing is polled, and nothing is changed.
@Component({
  imports: [DatePipe, Icon],
  selector: 'app-security',
  templateUrl: './security.html',
})
export class Security implements OnInit {
  private readonly sys = inject(SystemService);

  protected readonly report = signal<SecurityReport | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  ngOnInit() {
    void this.load();
  }

  protected async load() {
    this.loading.set(true);
    try {
      this.report.set(await this.sys.security());
      this.error.set(null);
    } catch (e) {
      this.error.set(errorText(e));
    }
    this.loading.set(false);
  }

  protected statusText(s: 'ok' | 'warn' | 'info') {
    return s === 'ok' ? 'Fine' : s === 'warn' ? 'Look at this' : 'Note';
  }

  protected headline(r: SecurityReport) {
    const { ok, warn } = r.summary;
    if (warn === 0) return `${ok} of ${r.checks.length} checks are fine, and nothing needs a look.`;
    return `${warn} thing${warn === 1 ? '' : 's'} to look at, ${ok} fine.`;
  }
}
