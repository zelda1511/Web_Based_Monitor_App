import { Component, OnInit, inject, input } from '@angular/core';
import { AutomationService, Feature } from './automation.service';
import { Icon } from './icon';

// The small button on a page: shown only while the master Automation switch is on. "Automate this" turns on that one item with its defaults;
// when it is already on it shows that, and one click turns it off again.
@Component({
  imports: [Icon],
  selector: 'app-automate',
  template: `
    @if (auto.master()) {
      @if (auto.on(feature())) {
        <button type="button" class="btn btn-quiet btn-sm" title="Automated. Click to switch off" [attr.aria-label]="'Automation is on for ' + feature() + '. Switch it off'" (click)="auto.turnOff(feature())">
          <app-icon name="check" /> Automated
        </button>
      } @else {
        <button type="button" class="btn btn-quiet btn-sm" [attr.aria-label]="'Automate ' + feature()" (click)="auto.turnOn(feature())"><app-icon name="bell" /> Automate this</button>
      }
    }
  `,
})
export class Automate implements OnInit {
  protected readonly auto = inject(AutomationService);
  readonly feature = input.required<Feature>();

  ngOnInit() {
    if (!this.auto.state()) this.auto.load();
  }
}
