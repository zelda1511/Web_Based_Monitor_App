> Out of date (2026-11-21): the app now uses the "telemetry" look (top bar, side nav, green accent). See ../design-system.md and ../../CLAUDE.md for the current rules; this file describes the earlier rail, tabs and blue accent.

# Page dependency trees
Angular pages: each has `<page>.html`, `<page>.ts` and often `<page>.scss`. All use the shared shell (layouts.md), shared classes (theme.md) and `app-icon` (components.md).

## /
Entry: `src/app/dashboard/dashboard.ts`
Dependencies:
- `src/app/dashboard/dashboard.html`
- `src/app/dashboard/dashboard.scss`
- `src/app/dashboard/dashboard.ts`
- `src/app/icon.ts`
- `src/app/ui.service.ts` (confirm dialog + toasts)
- `src/styles.scss`

## /software
Entry: `src/app/software/software.ts`
Dependencies:
- `src/app/software/software.html`
- `src/app/software/software.ts`
- `src/app/icon.ts`
- `src/app/ui.service.ts` (confirm dialog + toasts)
- `src/styles.scss`

## /updates
Entry: `src/app/updates/updates.ts`
Dependencies:
- `src/app/updates/updates.html`
- `src/app/updates/updates.ts`
- `src/app/icon.ts`
- `src/app/ui.service.ts` (confirm dialog + toasts)
- `src/styles.scss`

## /catalog
Entry: `src/app/catalog/catalog.ts`
Dependencies:
- `src/app/catalog/catalog.html`
- `src/app/catalog/catalog.scss`
- `src/app/catalog/catalog.ts`
- `src/app/icon.ts`
- `src/app/ui.service.ts` (confirm dialog + toasts)
- `src/styles.scss`

## /find
Entry: `src/app/find/find.ts`
Dependencies:
- `src/app/find/find.html`
- `src/app/find/find.ts`
- `src/app/icon.ts`
- `src/app/ui.service.ts` (confirm dialog + toasts)
- `src/styles.scss`

## /processes
Entry: `src/app/processes/processes.ts`
Dependencies:
- `src/app/processes/processes.html`
- `src/app/processes/processes.ts`
- `src/app/icon.ts`
- `src/app/ui.service.ts` (confirm dialog + toasts)
- `src/styles.scss`

## /startup
Entry: `src/app/startup/startup.ts`
Dependencies:
- `src/app/startup/startup.html`
- `src/app/startup/startup.ts`
- `src/app/icon.ts`
- `src/app/ui.service.ts` (confirm dialog + toasts)
- `src/styles.scss`

## /cleanup
Entry: `src/app/cleanup/cleanup.ts`
Dependencies:
- `src/app/cleanup/cleanup.html`
- `src/app/cleanup/cleanup.scss`
- `src/app/cleanup/cleanup.ts`
- `src/app/icon.ts`
- `src/app/ui.service.ts` (confirm dialog + toasts)
- `src/styles.scss`

## /disk
Entry: `src/app/disk/disk.ts`
Dependencies:
- `src/app/disk/disk.html`
- `src/app/disk/disk.scss`
- `src/app/disk/disk.ts`
- `src/app/icon.ts`
- `src/app/ui.service.ts` (confirm dialog + toasts)
- `src/styles.scss`

## /battery
Entry: `src/app/battery/battery.ts`
Dependencies:
- `src/app/battery/battery.html`
- `src/app/battery/battery.scss`
- `src/app/battery/battery.ts`
- `src/app/icon.ts`
- `src/app/ui.service.ts` (confirm dialog + toasts)
- `src/styles.scss`

## /automation
Entry: `src/app/automation/automation.ts`
Dependencies:
- `src/app/automation/automation.html`
- `src/app/automation/automation.scss`
- `src/app/automation/automation.ts`
- `src/app/icon.ts`
- `src/app/ui.service.ts` (confirm dialog + toasts)
- `src/styles.scss`

## /backups
Entry: `src/app/backups/backups.ts`
Dependencies:
- `src/app/backups/backups.html`
- `src/app/backups/backups.ts`
- `src/app/icon.ts`
- `src/app/ui.service.ts` (confirm dialog + toasts)
- `src/styles.scss`

## /drivers
Entry: `src/app/drivers/drivers.ts`
Dependencies:
- `src/app/drivers/drivers.html`
- `src/app/drivers/drivers.ts`
- `src/app/icon.ts`
- `src/app/ui.service.ts` (confirm dialog + toasts)
- `src/styles.scss`

## /blocked
Entry: `src/app/blocked/blocked.ts`
Dependencies:
- `src/app/blocked/blocked.html`
- `src/app/blocked/blocked.ts`
- `src/app/icon.ts`
- `src/app/ui.service.ts` (confirm dialog + toasts)
- `src/styles.scss`

