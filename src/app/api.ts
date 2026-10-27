export type ThemeMode = 'light' | 'dark' | 'system';

export interface Overview {
  os: { name: string; release: string; arch: string };
  cpu: { name: string; cores: number; threads: number; ghz: number };
  ramTotal: number;
  ramModules: { size: number; type: string; mhz: number }[];
  gpus: { model: string; vramMb: number; driver: string }[];
  disks: { name: string; type: string; size: number }[];
  board: string;
}

export interface Live {
  cpu: number;
  ram: { used: number; total: number };
  disks: { name: string; used: number; size: number }[];
  uptime: number;
}

export interface InstallResult {
  id: string;
  name: string;
  installed: boolean;
  exitCode: number;
  message: string | null;
}

export interface UpgradeResult {
  id: string;
  name: string;
  from: string;
  to: string | null;
  expected: string;
  updated: boolean;
  exitCode: number;
  message: string | null;
}

export interface UninstallResult {
  name: string;
  removed: boolean;
  cancelled: boolean;
  exitCode: number | null;
  message: string | null;
}

export interface RemoveResult {
  backupDir: string | null;
  removed: number;
  failed: number;
  results: { path: string; kind: string; ok: boolean; error?: string }[];
}

export interface LeftoverItem {
  id: string;
  empty: boolean;
  tooBig: boolean;
  kind: 'folder' | 'file' | 'registry';
  path: string;
  confidence: 'high' | 'medium' | 'low';
  reason: string;
  sizeBytes: number | null;
  entries: string | null;
  hasLinks: boolean;
  allUsers: boolean;
  removable: boolean;
  whyNot: string | null;
}

export interface LeftoverScan {
  name: string;
  publisher: string | null;
  items: LeftoverItem[];
  keptInstalled: number;
  searchedFor: { names: string[]; publishers: string[] };
  placesChecked: number;
}

export interface InstalledApp {
  key: string;
  scope: 'user' | 'machine';
  canUninstall: boolean;
  name: string;
  version: string | null;
  publisher: string | null;
  installDate: string | null;
  sizeBytes: number | null;
  location: string | null;
}

export interface ProcessGroup {
  name: string;
  pids: number[];
  memBytes: number;
  cpu: number | null;
  title: string | null;
  protected: boolean;
}

export interface StartupEntry {
  id: string;
  name: string;
  command: string;
  scope: 'user' | 'machine';
  source: 'run' | 'run32' | 'folder';
  enabled: boolean;
}

export interface CleanupItem {
  name: string;
  isDir: boolean;
  sizeBytes: number;
  modifiedMs: number;
}

export interface CleanupGroup {
  id: string;
  label: string;
  path: string;
  lockedReason: 'admin' | 'unsafe' | null;
  itemCount: number;
  totalBytes: number;
  keptRecent: number;
  keptLinks: number;
  unreadable: number;
  topItems: CleanupItem[];
}

export interface CleanupResult {
  id: string;
  label: string;
  freedBytes: number;
  removedItems: number;
  failedItems: number;
  changedSince: number;
  reasons: string[];
}

export interface DriverRow {
  name: string;
  cls: string | null;
  provider: string | null;
  version: string | null;
  friendlyVersion: string | null;
  date: string | null;
  signed: boolean | null;
  microsoft: boolean;
  old: boolean;
}

export interface DriverProblem {
  name: string;
  code: number;
  cause: string;
}

export interface DriverList {
  drivers: DriverRow[];
  problems: DriverProblem[];
}

export interface BlockedRow {
  file: string;
  fileName: string | null;
  process: string | null;
  processName: string | null;
  kind: 'policy' | 'audit' | 'signing-level';
  count: number;
  first: string;
  last: string;
  needed: string | null;
  got: string | null;
  policy: string | null;
  product: string | null;
  description: string | null;
  company: string | null;
  version: string | null;
  publisher: string | null;
  signer?: string | null;
  signature: string | null;
  exists: boolean | null;
  reason: string;
}

export interface BlockedList {
  sac: { state: 'on' | 'evaluation' | 'off' | 'unknown'; label: string; text: string };
  rows: BlockedRow[];
  eventCount: number;
  oldest: string | null;
  checkedAt: number;
}

export interface BackupItem {
  index: number;
  kind: 'registry' | 'folder' | 'file';
  path: string;
  how: 'reg-export' | 'recycle-bin' | 'admin-empty-folder';
  canRestore: boolean;
  why: string | null;
  state: string;
}

export interface BackupRow {
  id: string;
  when: string | null;
  app: string | null;
  publisher: string | null;
  readable: boolean;
  items: BackupItem[];
}

export interface BackupList {
  backups: BackupRow[];
  checkedAt: number;
}

export interface RestoreResult {
  status: string;
  message: string;
}

export interface DriverInstallResult {
  id: string;
  status: string;
  message: string;
  rebootRequired: boolean;
  restorePoint: { sequence: number; description: string } | null;
  stillOffered: boolean | null;
}

export interface DriverUpdate {
  id: string | null;
  revision: number | null;
  title: string;
  manufacturer: string | null;
  model: string | null;
  cls: string | null;
  date: string | null;
  sizeBytes: number | null;
  downloaded: boolean;
}

export interface UpdateScan {
  updates: DriverUpdate[];
  checkedAt: number;
}

export interface AppUpdate {
  name: string;
  id: string;
  version: string;
  available: string;
  source: string | null;
  explicit: boolean;
}

export interface AppHit {
  name: string;
  id: string;
  version: string | null;
  match: string | null;
}

export interface AppDetails {
  id: string;
  name: string;
  version: string | null;
  publisher: string | null;
  homepage: string | null;
  license: string | null;
  licenseUrl: string | null;
  description: string | null;
  installerType: string | null;
  hint: { kind: 'free' | 'paid' | 'unknown'; label: string };
}

export interface DiskDrive {
  letter: string;
  used: number;
  size: number;
  free: number;
}

export interface DiskStart {
  key: string;
  label: string;
}

export interface DiskRow {
  id: string | null;
  name: string;
  kind: 'folder' | 'file' | 'link';
  bytes: number;
  files: number;
  share: number;
  denied: number;
  partial: boolean;
  note: string | null;
}

export interface DiskListing {
  id: string;
  path: string;
  trail: { id: string; label: string }[];
  total: number;
  rows: DiskRow[];
  rest: { count: number; bytes: number } | null;
  links: number;
  denied: number;
  partial: boolean;
  drive: { letter: string; used: number; size: number } | null;
  notCounted: number | null;
  tookMs: number;
}

export interface LargeFile {
  id: string;
  name: string;
  folder: string;
  bytes: number;
  modifiedMs: number;
  ageDays: number;
  whyNot: string | null;
}

export interface LargeScan {
  files: LargeFile[];
  matching: number;
  matchingBytes: number;
  scanned: { files: number; bytes: number; denied: number };
}

export interface TrashResult {
  results: { id: string; name: string; bytes: number; ok: boolean; already: boolean; error: string | null }[];
  moved: number;
  failed: number;
  freedBytes: number;
}

export interface BinRow {
  name: string;
  from: string;
  deleted: string | null;
  isFolder: boolean;
  drive: string;
  bytes: number;
}

export interface BinList {
  totals: { items: number; bytes: number };
  drives: { drive: string; items: number; bytes: number }[];
  shown: BinRow[];
  hidden: number;
  checkedAt: number;
}

export interface BinEmptyResult {
  status: 'emptied' | 'partial' | 'empty';
  freedBytes: number;
  remaining: number;
  message: string;
}

export interface CacheGroup {
  id: string;
  name: string;
  group: string;
  cost: string;
  running: boolean;
  note: string | null;
  bytes: number;
  partial: boolean;
  dirs: { label: string; bytes: number; partial: boolean }[];
}

export interface CacheClearResult {
  results: { id: string; name?: string; ok: boolean; error?: string; freedBytes?: number; leftBytes?: number; skipped?: number; reasons?: string[]; partial?: boolean }[];
  freedBytes: number;
  failed: number;
}

export interface CatalogApp {
  id: string;
  name: string;
  note: string;
  state: 'installed' | 'update' | 'missing';
  version: string | null;
  available: string | null;
}

export interface CatalogList {
  categories: { name: string; apps: CatalogApp[] }[];
  checkedAt: number;
}

export interface AppListSaved {
  saved: boolean;
  name?: string;
  count?: number;
}

export interface AppListRead {
  canceled: boolean;
  read?: number;
  known?: string[];
  unknown?: number;
}

export interface BatteryNow {
  present: boolean;
  count?: number;
  percent?: number | null;
  state?: 'charging' | 'discharging' | 'full' | 'plugged' | 'unknown';
  acOnline?: boolean | null;
  critical?: boolean;
  minutesLeft?: number | null;
  estimating?: boolean;
  relative?: boolean;
  powerW?: number | null;
  voltageV?: number | null;
  remainingMwh?: number | null;
  fullMwh?: number | null;
  designMwh?: number | null;
  cycles?: number | null;
  health?: number | null;
}

export interface BatteryHistoryRow {
  from: string;
  to: string;
  designMwh: number | null;
  fullMwh: number | null;
  health: number | null;
  cycles: number | null;
  activeBatteryMin: number | null;
  standbyBatteryMin: number | null;
  activeAcMin: number | null;
  standbyAcMin: number | null;
}

export interface BatteryReport {
  present: boolean;
  count?: number;
  scanTime?: string | null;
  relative?: boolean;
  battery?: { manufacturer: string | null; chemistry: string | null; designMwh: number | null; fullMwh: number | null; cycles: number | null; health: number | null };
  runtime?: { fullActiveMin: number | null; fullStandbyMin: number | null; designActiveMin: number | null; designStandbyMin: number | null } | null;
  history?: BatteryHistoryRow[];
}

export interface AutoSettings {
  version: number;
  automation: boolean;
  tray: boolean;
  startWithWindows: boolean;
  warn: {
    disk: { on: boolean; percent: number };
    battery: { on: boolean; low: number; urgent: number; health: number };
    updates: { on: boolean };
    startup: { on: boolean };
  };
  clean: { on: boolean; everyDays: number; idleMinutes: number; onlyOnAc: boolean };
  quietUntil: number;
}

export interface AutoJob {
  lastRunAt: number | null;
  lastOk: boolean | null;
  lastError: string | null;
  waiting: string | null;
  dead: boolean;
}

export interface ActivityEntry {
  at: number;
  kind: 'warning' | 'clean' | 'note';
  id?: string;
  title?: string;
  body?: string;
  route?: string;
  shown?: boolean;
  freedBytes?: number;
  removed?: number;
  failed?: number;
  reasons?: string;
  stopped?: boolean;
  note?: string;
}

export interface AutoState {
  settings: AutoSettings;
  status: { master: boolean; jobs: Record<string, AutoJob> };
  recent: ActivityEntry[];
  loginItem: boolean | null;
  packaged: boolean;
  trayRunning: boolean;
}

export type AutoPatch = {
  automation?: boolean;
  tray?: boolean;
  startWithWindows?: boolean;
  warn?: {
    disk?: { on?: boolean; percent?: number };
    battery?: { on?: boolean; low?: number; urgent?: number; health?: number };
    updates?: { on?: boolean };
    startup?: { on?: boolean };
  };
  clean?: { on?: boolean; everyDays?: number; idleMinutes?: number; onlyOnAc?: boolean };
  quietUntil?: number;
};

export interface CleanPreview {
  token: string;
  targets: { label: string; refused: string | null; items: number; bytes: number; keptRecent: number }[];
}

export interface EndResult {
  pid: number;
  ok: boolean;
  error?: string;
}

declare global {
  interface Window {
    api?: {
      getOverview(): Promise<Overview>;
      getLive(): Promise<Live>;
      getSoftware(): Promise<InstalledApp[]>;
      openAppFolder(key: string): Promise<string>;
      getProcesses(): Promise<ProcessGroup[]>;
      endTasks(pids: number[]): Promise<EndResult[]>;
      getStartup(): Promise<StartupEntry[]>;
      setStartup(id: string, enabled: boolean): Promise<StartupEntry[]>;
      scanCleanup(): Promise<CleanupGroup[]>;
      deleteCleanup(ids: string[]): Promise<CleanupResult[]>;
      getAppUpdates(): Promise<AppUpdate[]>;
      searchApps(query: string): Promise<AppHit[]>;
      getAppDetails(id: string): Promise<AppDetails>;
      installApp(id: string): Promise<InstallResult>;
      upgradeApp(id: string): Promise<UpgradeResult>;
      uninstallApp(key: string): Promise<UninstallResult>;
      listCatalog(): Promise<CatalogList>;
      installCatalogApp(id: string): Promise<InstallResult>;
      exportAppList(ids: string[]): Promise<AppListSaved>;
      importAppList(): Promise<AppListRead>;
      scanLeftovers(key: string): Promise<LeftoverScan>;
      scanLeftoversByName(name: string, publisher: string | null): Promise<LeftoverScan>;
      removeLeftovers(ids: string[]): Promise<RemoveResult>;
      revealLeftover(id: string): Promise<void>;
      openBackupFolder(): Promise<string>;
      getDrivers(): Promise<DriverList>;
      scanDriverUpdates(): Promise<UpdateScan>;
      installDriverUpdate(id: string): Promise<DriverInstallResult>;
      listBlocked(): Promise<BlockedList>;
      listBackups(): Promise<BackupList>;
      restoreBackupKey(id: string, index: number): Promise<RestoreResult>;
      restoreBackupFolder(id: string, index: number): Promise<RestoreResult>;
      deleteBackup(id: string): Promise<{ deleted: boolean }>;
      openBackup(id: string): Promise<string>;
      getAutomation(): Promise<AutoState>;
      setAutomation(patch: AutoPatch): Promise<AutoState>;
      testNotification(): Promise<'shown' | 'paused' | 'failed'>;
      quitApp(): Promise<void>;
      previewAutoClean(): Promise<CleanPreview>;
      enableAutoClean(token: string): Promise<AutoState>;
      onNavigate(cb: (route: string) => void): () => void;
      getBattery(): Promise<BatteryNow>;
      getBatteryReport(): Promise<BatteryReport>;
      getDiskDrives(): Promise<DiskDrive[]>;
      getDiskStarts(): Promise<DiskStart[]>;
      scanDiskStart(key: string): Promise<DiskListing>;
      scanDiskChild(id: string): Promise<DiskListing>;
      cancelDiskScan(): Promise<void>;
      revealDiskItem(id: string): Promise<void>;
      scanDownloads(minMb: number): Promise<LargeScan>;
      trashDownloads(ids: string[]): Promise<TrashResult>;
      revealDownload(id: string): Promise<void>;
      listRecycleBin(): Promise<BinList>;
      emptyRecycleBin(): Promise<BinEmptyResult>;
      scanCaches(): Promise<CacheGroup[]>;
      clearCaches(ids: string[]): Promise<CacheClearResult>;
      openDriverLink(key: string): Promise<void>;
      setTheme(mode: ThemeMode): Promise<void>;
    };
  }
}
