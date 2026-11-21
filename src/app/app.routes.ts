import { Routes } from '@angular/router';
import { Dashboard } from './dashboard/dashboard';

// The overview opens first, so it is in the main bundle; every other page is its own chunk, loaded the first time it is opened.
export const routes: Routes = [
  { path: '', component: Dashboard },
  { path: 'software', loadComponent: () => import('./software/software').then((m) => m.Software) },
  { path: 'updates', loadComponent: () => import('./updates/updates').then((m) => m.Updates) },
  { path: 'catalog', loadComponent: () => import('./catalog/catalog').then((m) => m.AppCatalog) },
  { path: 'find', loadComponent: () => import('./find/find').then((m) => m.Find) },
  {
    path: 'processes',
    loadComponent: () => import('./processes/processes').then((m) => m.Processes),
  },
  { path: 'security', loadComponent: () => import('./security/security').then((m) => m.Security) },
  { path: 'history', loadComponent: () => import('./history/history').then((m) => m.History) },
  { path: 'startup', loadComponent: () => import('./startup/startup').then((m) => m.Startup) },
  { path: 'cleanup', loadComponent: () => import('./cleanup/cleanup').then((m) => m.Cleanup) },
  { path: 'disk', loadComponent: () => import('./disk/disk').then((m) => m.DiskSpace) },
  { path: 'battery', loadComponent: () => import('./battery/battery').then((m) => m.Battery) },
  {
    path: 'automation',
    loadComponent: () => import('./automation/automation').then((m) => m.Automation),
  },
  { path: 'backups', loadComponent: () => import('./backups/backups').then((m) => m.Backups) },
  { path: 'drivers', loadComponent: () => import('./drivers/drivers').then((m) => m.Drivers) },
  { path: 'blocked', loadComponent: () => import('./blocked/blocked').then((m) => m.Blocked) },
  { path: '**', redirectTo: '' },
];
