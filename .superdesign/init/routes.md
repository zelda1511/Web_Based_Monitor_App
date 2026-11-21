> Out of date (2026-11-21): the app now uses the "telemetry" look (top bar, side nav, green accent). See ../design-system.md and ../../CLAUDE.md for the current rules; this file describes the earlier rail, tabs and blue accent.

# Routes (hash routing under file://; do not change)
Five rail sections (from `SECTIONS` in app.ts): Overview(/), Apps(/software /updates /catalog /find), Monitor(/processes /startup /battery), Clean up(/cleanup /disk /backups), System(/drivers /blocked /automation).

### `src/app/app.routes.ts`
```ts
import { Routes } from '@angular/router';
import { Backups } from './backups/backups';
import { Automation } from './automation/automation';
import { Battery } from './battery/battery';
import { AppCatalog } from './catalog/catalog';
import { Blocked } from './blocked/blocked';
import { Cleanup } from './cleanup/cleanup';
import { Dashboard } from './dashboard/dashboard';
import { DiskSpace } from './disk/disk';
import { Drivers } from './drivers/drivers';
import { Find } from './find/find';
import { Processes } from './processes/processes';
import { Software } from './software/software';
import { Startup } from './startup/startup';
import { Updates } from './updates/updates';

export const routes: Routes = [
  { path: '', component: Dashboard },
  { path: 'software', component: Software },
  { path: 'updates', component: Updates },
  { path: 'catalog', component: AppCatalog },
  { path: 'find', component: Find },
  { path: 'processes', component: Processes },
  { path: 'startup', component: Startup },
  { path: 'cleanup', component: Cleanup },
  { path: 'disk', component: DiskSpace },
  { path: 'battery', component: Battery },
  { path: 'automation', component: Automation },
  { path: 'backups', component: Backups },
  { path: 'drivers', component: Drivers },
  { path: 'blocked', component: Blocked },
  { path: '**', redirectTo: '' },
];
```

