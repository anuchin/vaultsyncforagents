/**
 * The plugin's persisted state (`data.json`, via `Plugin.loadData/saveData`).
 *
 * Kept deliberately small: link identity (url/token/deviceId/deviceName) plus
 * the two client-side toggles. The token is the device's long-lived
 * credential (ARCHITECTURE §3) — Obsidian stores data.json inside the vault's
 * `.obsidian/plugins/` dir, which sync excludes, so it never leaves the
 * machine through sync itself.
 */

import { Platform } from 'obsidian';

/** Client-side sync behavior settings (the settings-tab toggles). */
export interface PluginSyncSettings {
  /**
   * Periodic full-rescan interval in seconds (ARCHITECTURE §8 mobile /
   * external edits). `0` disables the timer — vault events and app-open
   * reconciliation still run.
   */
  rescanIntervalSec: number;
  /**
   * Opt in to syncing `.obsidian/` (FR-11). This is the client-side initial
   * ignore setting; the worker's per-vault `VaultSettings.obsidianSync`
   * (delivered in `helloAck`) supersedes it once connected.
   */
  obsidianSync: boolean;
}

/** Shape of the plugin's `data.json`. */
export interface VaultSyncPluginData {
  /** Worker origin, e.g. `https://personal.x.workers.dev` (empty pre-pair). */
  url: string;
  /** Long-lived device token (empty pre-pair). */
  token: string;
  /** Device id assigned by the worker at pair time. */
  deviceId: string;
  /** Human-readable device name shown in the dashboard's device list. */
  deviceName: string;
  settings: PluginSyncSettings;
}

export const DEFAULT_RESCAN_INTERVAL_SEC = 30;

/** Choices offered by the settings dropdown: seconds → label. */
export const RESCAN_INTERVAL_CHOICES: ReadonlyArray<{ value: number; label: string }> = [
  { value: 10, label: 'Every 10 seconds' },
  { value: 30, label: 'Every 30 seconds' },
  { value: 60, label: 'Every minute' },
  { value: 300, label: 'Every 5 minutes' },
  { value: 0, label: 'Off (vault events only)' },
];

export function defaultPluginData(): VaultSyncPluginData {
  return {
    url: '',
    token: '',
    deviceId: '',
    deviceName: '',
    settings: {
      rescanIntervalSec: DEFAULT_RESCAN_INTERVAL_SEC,
      obsidianSync: false,
    },
  };
}

/** Coerce whatever `loadData()` returned into a well-formed object. */
export function normalizePluginData(raw: unknown): VaultSyncPluginData {
  const base = defaultPluginData();
  if (typeof raw !== 'object' || raw === null) return base;
  const source = raw as Partial<VaultSyncPluginData> & { settings?: Partial<PluginSyncSettings> };
  return {
    url: typeof source.url === 'string' ? source.url : '',
    token: typeof source.token === 'string' ? source.token : '',
    deviceId: typeof source.deviceId === 'string' ? source.deviceId : '',
    deviceName: typeof source.deviceName === 'string' ? source.deviceName : '',
    settings: {
      rescanIntervalSec:
        typeof source.settings?.rescanIntervalSec === 'number' && source.settings.rescanIntervalSec >= 0
          ? Math.floor(source.settings.rescanIntervalSec)
          : DEFAULT_RESCAN_INTERVAL_SEC,
      obsidianSync: source.settings?.obsidianSync === true,
    },
  };
}

/** A vault is linked iff pair identity is complete. */
export function isLinked(data: VaultSyncPluginData): boolean {
  return data.url !== '' && data.token !== '' && data.deviceId !== '';
}

/** Device type for the worker registry, from the platform (FR-23). */
export function detectDeviceType(): 'desktop' | 'mobile' {
  return Platform.isMobileApp ? 'mobile' : 'desktop';
}

/** Default device name when the user has not typed one. */
export function defaultDeviceName(): string {
  if (Platform.isMobileApp) {
    if (Platform.isIosApp) return 'iPhone/iPad';
    if (Platform.isAndroidApp) return 'Android';
    return 'Obsidian mobile';
  }
  return 'Obsidian desktop';
}
