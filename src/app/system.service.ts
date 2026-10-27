import { Injectable } from '@angular/core';
import { AutoPatch } from './api';

@Injectable({ providedIn: 'root' })
export class SystemService {
  // async, so a missing Electron bridge comes back as a rejected promise the pages already handle.
  private async api() {
    if (!window.api) throw new Error('System data is only available inside the Electron window. Start it with npm start.');
    return window.api;
  }

  async overview() {
    return (await this.api()).getOverview();
  }

  async live() {
    return (await this.api()).getLive();
  }

  async software() {
    return (await this.api()).getSoftware();
  }

  async openAppFolder(key: string) {
    return (await this.api()).openAppFolder(key);
  }

  async processes() {
    return (await this.api()).getProcesses();
  }

  async endTasks(pids: number[]) {
    return (await this.api()).endTasks(pids);
  }

  async scanCleanup() {
    return (await this.api()).scanCleanup();
  }

  async deleteCleanup(ids: string[]) {
    return (await this.api()).deleteCleanup(ids);
  }

  async appUpdates() {
    return (await this.api()).getAppUpdates();
  }

  async searchApps(query: string) {
    return (await this.api()).searchApps(query);
  }

  async appDetails(id: string) {
    return (await this.api()).getAppDetails(id);
  }

  async installApp(id: string) {
    return (await this.api()).installApp(id);
  }

  async upgradeApp(id: string) {
    return (await this.api()).upgradeApp(id);
  }

  async uninstallApp(key: string) {
    return (await this.api()).uninstallApp(key);
  }

  async catalog() {
    return (await this.api()).listCatalog();
  }

  async installCatalogApp(id: string) {
    return (await this.api()).installCatalogApp(id);
  }

  async exportAppList(ids: string[]) {
    return (await this.api()).exportAppList(ids);
  }

  async importAppList() {
    return (await this.api()).importAppList();
  }

  async scanLeftovers(key: string) {
    return (await this.api()).scanLeftovers(key);
  }

  async scanLeftoversByName(name: string, publisher: string | null) {
    return (await this.api()).scanLeftoversByName(name, publisher);
  }

  async removeLeftovers(ids: string[]) {
    return (await this.api()).removeLeftovers(ids);
  }

  async revealLeftover(id: string) {
    return (await this.api()).revealLeftover(id);
  }

  async openBackupFolder() {
    return (await this.api()).openBackupFolder();
  }

  async drivers() {
    return (await this.api()).getDrivers();
  }

  async scanDriverUpdates() {
    return (await this.api()).scanDriverUpdates();
  }

  async listBlocked() {
    return (await this.api()).listBlocked();
  }

  async listBackups() {
    return (await this.api()).listBackups();
  }

  async restoreBackupKey(id: string, index: number) {
    return (await this.api()).restoreBackupKey(id, index);
  }

  async restoreBackupFolder(id: string, index: number) {
    return (await this.api()).restoreBackupFolder(id, index);
  }

  async deleteBackup(id: string) {
    return (await this.api()).deleteBackup(id);
  }

  async openBackup(id: string) {
    return (await this.api()).openBackup(id);
  }

  async automation() {
    return (await this.api()).getAutomation();
  }

  async setAutomation(patch: AutoPatch) {
    return (await this.api()).setAutomation(patch);
  }

  async testNotification() {
    return (await this.api()).testNotification();
  }

  async quitApp() {
    return (await this.api()).quitApp();
  }

  async previewAutoClean() {
    return (await this.api()).previewAutoClean();
  }

  async enableAutoClean(token: string) {
    return (await this.api()).enableAutoClean(token);
  }

  // a clicked warning asks the window to open a page; returns the function that stops listening (nothing outside Electron)
  onNavigate(cb: (route: string) => void): () => void {
    return window.api?.onNavigate(cb) ?? (() => undefined);
  }

  async battery() {
    return (await this.api()).getBattery();
  }

  async batteryReport() {
    return (await this.api()).getBatteryReport();
  }

  async diskDrives() {
    return (await this.api()).getDiskDrives();
  }

  async diskStarts() {
    return (await this.api()).getDiskStarts();
  }

  async scanDiskStart(key: string) {
    return (await this.api()).scanDiskStart(key);
  }

  async scanDiskChild(id: string) {
    return (await this.api()).scanDiskChild(id);
  }

  async cancelDiskScan() {
    return (await this.api()).cancelDiskScan();
  }

  async revealDiskItem(id: string) {
    return (await this.api()).revealDiskItem(id);
  }

  async scanDownloads(minMb: number) {
    return (await this.api()).scanDownloads(minMb);
  }

  async trashDownloads(ids: string[]) {
    return (await this.api()).trashDownloads(ids);
  }

  async revealDownload(id: string) {
    return (await this.api()).revealDownload(id);
  }

  async listRecycleBin() {
    return (await this.api()).listRecycleBin();
  }

  async emptyRecycleBin() {
    return (await this.api()).emptyRecycleBin();
  }

  async scanCaches() {
    return (await this.api()).scanCaches();
  }

  async clearCaches(ids: string[]) {
    return (await this.api()).clearCaches(ids);
  }

  async installDriverUpdate(id: string) {
    return (await this.api()).installDriverUpdate(id);
  }

  async openDriverLink(key: string) {
    return (await this.api()).openDriverLink(key);
  }

  async startup() {
    return (await this.api()).getStartup();
  }

  async setStartup(id: string, enabled: boolean) {
    return (await this.api()).setStartup(id, enabled);
  }
}
