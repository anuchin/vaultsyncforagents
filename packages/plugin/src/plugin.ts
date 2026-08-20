/**
 * `VaultSyncPlugin` — the Obsidian client (desktop + mobile).
 *
 * onload: load link identity → if linked, build `SyncClient` (core) over the
 * Obsidian adapters and run startup reconciliation (the sync-on-open
 * contract, FR-4/FR-5/FR-12), then enter live mode (vault events + periodic
 * rescan + focus rescan) with a status-bar indicator and jittered
 * exponential-backoff reconnect (capped at 60 s).
 *
 * A 1 Hz "supervision tick" drives everything time-based: it repaints the
 * status bar and notices `disconnected` → schedules one reconnect at a time.
 * All timers are owned here and torn down in `stopSync()`/`onunload`.
 */

import { Notice, Plugin } from 'obsidian';
import type { App, PluginManifest } from 'obsidian';
import { RevokedError, SyncClient, UnauthorizedError } from '@vsa/core';
import type { LogAdapter } from '@vsa/core';
import { ObsidianStorageAdapter } from './adapters/obsidian-storage.js';
import { ObsidianWatchAdapter, RescanScheduler } from './adapters/obsidian-watch.js';
import { HttpBlobStore } from './blobstore.js';
import {
  defaultDeviceName,
  detectDeviceType,
  isLinked,
  normalizePluginData,
  defaultPluginData,
  type VaultSyncPluginData,
} from './data.js';
import { pairOutcomeMessage, pairWithWorker } from './pairing.js';
import type { PairOutcome } from './pairing.js';
import { registerPairProtocolHandler } from './protocol-handler.js';
import { ReconnectSupervisor } from './reconnect.js';
import type { BackoffOptions } from './reconnect.js';
import { VaultSyncSettingTab } from './settings.js';
import { StatusBarIndicator } from './statusbar.js';
import { WebSocketTransport } from './transport.js';
import type { WebSocketFactory } from './transport.js';
import { normalizeWorkerUrl } from './workerapi.js';

/** The in-vault device marker shared with the daemon/CLI (FR-44 handshake). */
const DEVICE_MARKER_VAULT_PATH = '/.vaultsyncforagents/device.json';
const LOCAL_INDEX_VAULT_PATH = '/.vaultsyncforagents/state';
const SUPERVISION_TICK_MS = 1000;

/** Timer handles (number in the DOM, `Timeout` when Node types leak in). */
type TimerHandle = ReturnType<typeof setInterval>;

/** Injectable seams so unit tests need no real Obsidian/network. */
export interface PluginOverrides {
  fetchImpl?: typeof fetch;
  wsFactory?: WebSocketFactory;
  now?: () => number;
  /** Reconnect backoff knobs (tests inject a deterministic random). */
  reconnect?: BackoffOptions;
}

export class VaultSyncPlugin extends Plugin {
  data: VaultSyncPluginData = defaultPluginData();
  /** The live sync client (null while unlinked/stopped). */
  client: SyncClient | null = null;

  private readonly overrides: PluginOverrides;
  private watcher: ObsidianWatchAdapter | null = null;
  private rescan: RescanScheduler | null = null;
  private statusBar: StatusBarIndicator | null = null;
  private statusBarItem: HTMLElement | null = null;
  private tickHandle: TimerHandle | null = null;
  private reconnectTimer: TimerHandle | null = null;
  private supervisor = new ReconnectSupervisor();
  /** Set when the worker rejected the token — reconnecting cannot help. */
  private authFailed = false;
  private statusNote = '';
  private readonly syncLog: LogAdapter = {
    debug: (...args: unknown[]) => console.debug('[vsa]', ...args),
    info: (...args: unknown[]) => console.info('[vsa]', ...args),
    warn: (...args: unknown[]) => console.warn('[vsa]', ...args),
    error: (...args: unknown[]) => console.error('[vsa]', ...args),
  };

  constructor(app: App, manifest: PluginManifest, overrides: PluginOverrides = {}) {
    super(app, manifest);
    this.overrides = overrides;
  }

  private get now(): () => number {
    return this.overrides.now ?? (() => Date.now());
  }

  private get fetchImpl(): typeof fetch {
    return this.overrides.fetchImpl ?? fetch;
  }

  get linked(): boolean {
    return isLinked(this.data);
  }

  override async onload(): Promise<void> {
    this.data = normalizePluginData(await this.loadData());
    this.addSettingTab(new VaultSyncSettingTab(this.app, this));
    registerPairProtocolHandler(
      (action, handler) => this.registerObsidianProtocolHandler(action, handler),
      (link) => this.handlePairDeepLink(link.url, link.code),
    );
    // Cheap focus-driven rescan (FR-12): every note/app switch pokes the
    // scheduler, which coalesces into at most one cycle per debounce window.
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.rescan?.poke()));
    if (this.linked) await this.startSync();
  }

  override onunload(): void {
    this.stopSync();
  }

  // --- persistence -----------------------------------------------------------------

  async savePluginData(): Promise<void> {
    await this.saveData(this.data);
  }

  // --- pairing (settings tab + deep link) --------------------------------------------

  /** Pair from the settings form (fields already live in `this.data`). */
  async pairFromSettings(code: string): Promise<PairOutcome> {
    const deviceName = this.resolveDeviceName();
    const outcome = await pairWithWorker({
      url: this.data.url,
      code,
      deviceName,
      deviceType: detectDeviceType(),
      fetchImpl: this.fetchImpl,
    });
    await this.applyPairOutcome(outcome, deviceName);
    return outcome;
  }

  /** obsidian://vaultsyncforagents/pair?url=…&code=… (protocol-handler.ts). */
  private async handlePairDeepLink(url: string, code: string): Promise<void> {
    if (this.linked) {
      if (normalizeWorkerUrlSafe(url) === normalizeWorkerUrlSafe(this.data.url)) {
        new Notice('VaultSync: this vault is already paired with that worker.');
      } else {
        new Notice(
          'VaultSync: this vault is paired with a different worker. Unlink it in settings first.',
          10000,
        );
      }
      return;
    }
    const deviceName = this.resolveDeviceName();
    const outcome = await pairWithWorker({
      url,
      code,
      deviceName,
      deviceType: detectDeviceType(),
      fetchImpl: this.fetchImpl,
    });
    await this.applyPairOutcome(outcome, deviceName);
  }

  private async applyPairOutcome(outcome: PairOutcome, deviceName: string): Promise<void> {
    if (outcome.status !== 'paired') {
      new Notice(pairOutcomeMessage(outcome), 10000);
      return;
    }
    this.data.url = outcome.url;
    this.data.token = outcome.token;
    this.data.deviceId = outcome.deviceId;
    this.data.deviceName = deviceName;
    await this.savePluginData();
    await this.writeDeviceMarker();
    new Notice(pairOutcomeMessage(outcome));
    await this.startSync();
  }

  private resolveDeviceName(): string {
    const typed = this.data.deviceName.trim();
    return typed !== '' ? typed : defaultDeviceName();
  }

  /** Write the FR-44 marker the CLI/daemon read to detect double-clients. */
  private async writeDeviceMarker(): Promise<void> {
    if (!this.linked) return;
    const storage = new ObsidianStorageAdapter({ adapter: this.app.vault.adapter });
    const marker = {
      deviceId: this.data.deviceId,
      deviceName: this.resolveDeviceName(),
      url: this.data.url,
      linkedAt: this.now(),
    };
    try {
      await storage.writeFile(
        DEVICE_MARKER_VAULT_PATH,
        new TextEncoder().encode(`${JSON.stringify(marker, null, 2)}\n`),
      );
    } catch (error) {
      this.syncLog.warn('failed to write device marker', error);
    }
  }

  // --- sync lifecycle ------------------------------------------------------------------

  /** Build everything and run startup reconciliation (idempotent restart). */
  private async startSync(): Promise<void> {
    if (!this.linked) return;
    this.stopSync();

    const { url, token, deviceId } = this.data;
    const deviceName = this.resolveDeviceName();
    const storage = new ObsidianStorageAdapter({ adapter: this.app.vault.adapter });
    await this.warnIfForeignStateDir(storage);

    const client = new SyncClient({
      deviceId,
      deviceName,
      token,
      transport: () => new WebSocketTransport({ url, token, wsFactory: this.overrides.wsFactory }),
      blobStore: new HttpBlobStore({ baseUrl: url, token, fetchImpl: this.fetchImpl }),
      storage,
      settings: { obsidianSync: this.data.settings.obsidianSync },
      log: this.syncLog,
      now: this.now,
    });
    this.client = client;
    this.authFailed = false;
    this.statusNote = '';
    this.supervisor = new ReconnectSupervisor(this.overrides.reconnect ?? {});

    try {
      await client.connect(); // startup reconciliation → live mode
    } catch (error) {
      this.handleSyncError(error, 'startup sync failed');
    }

    // Live watching: vault events (debounced in core) + rescan hooks.
    this.watcher = new ObsidianWatchAdapter({ vault: this.app.vault });
    client.startWatching(this.watcher);
    this.rescan = new RescanScheduler({
      intervalMs: this.data.settings.rescanIntervalSec * 1000,
    });
    this.rescan.start(() => {
      void client.triggerSync().catch((error: unknown) => {
        this.handleSyncError(error, 'rescan failed');
      });
    });

    // Status bar + the 1 Hz supervision tick that repaints it and supervises
    // reconnection.
    const item = this.addStatusBarItem();
    this.statusBarItem = item;
    this.statusBar = new StatusBarIndicator(item);
    const tick = setInterval(() => this.onTick(), SUPERVISION_TICK_MS);
    this.tickHandle = tick;
    this.registerInterval(tick as unknown as number); // Obsidian clears this on unload
    this.onTick();
  }

  /** Tear down every timer, watcher, socket, and UI artifact. Idempotent. */
  private stopSync(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.tickHandle !== null) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
    this.rescan?.stop();
    this.rescan = null;
    this.client?.close(); // also stops the watcher
    this.client = null;
    this.watcher = null;
    this.statusBarItem?.remove();
    this.statusBarItem = null;
    this.statusBar = null;
  }

  // --- user actions ----------------------------------------------------------------------

  async syncNow(): Promise<void> {
    const client = this.client;
    if (client === null) {
      new Notice('VaultSync: not paired yet — add your worker URL and a pairing code in settings.');
      return;
    }
    try {
      await client.triggerSync();
      const status = client.status();
      new Notice(
        status.state === 'disconnected'
          ? 'VaultSync: offline — changes will sync when the worker is reachable.'
          : 'VaultSync: up to date.',
      );
    } catch (error) {
      this.handleSyncError(error, 'sync now failed');
      new Notice('VaultSync: sync failed — see the developer console for details.');
    }
  }

  async unlink(): Promise<void> {
    this.stopSync();
    // Clear local sync state (device marker + index) so a future client —
    // this plugin after a re-pair, the daemon, the CLI — starts clean
    // (FR-44: stale state would make it refuse or mis-sync).
    const storage = new ObsidianStorageAdapter({ adapter: this.app.vault.adapter });
    await storage.deleteFile(DEVICE_MARKER_VAULT_PATH);
    await storage.deleteFile(LOCAL_INDEX_VAULT_PATH);
    this.data = {
      ...defaultPluginData(),
      deviceName: this.data.deviceName,
      settings: this.data.settings,
    };
    await this.savePluginData();
    new Notice(
      'VaultSync: unlinked. Revoke this device from the worker dashboard if you are done with it.',
    );
  }

  async applyRescanInterval(seconds: number): Promise<void> {
    this.data.settings.rescanIntervalSec = Math.max(0, Math.floor(seconds));
    await this.savePluginData();
    this.rescan?.setIntervalMs(this.data.settings.rescanIntervalSec * 1000);
  }

  async applyObsidianSync(enabled: boolean): Promise<void> {
    this.data.settings.obsidianSync = enabled;
    await this.savePluginData();
    new Notice(
      enabled
        ? 'VaultSync: .obsidian/ will sync after the next reconnect (the worker\u2019s per-vault setting takes precedence).'
        : 'VaultSync: .obsidian/ will be excluded after the next reconnect.',
    );
  }

  // --- supervision --------------------------------------------------------------------------

  private onTick(): void {
    const client = this.client;
    if (client === null) return;
    const status = client.status();
    this.statusBar?.update(
      status,
      { url: this.data.url, deviceName: this.resolveDeviceName(), note: this.statusNote },
      this.now(),
    );
    if (this.authFailed) return; // token rejected: reconnecting cannot fix it
    const decision = this.supervisor.consider(status.state);
    if (decision.action === 'wait') return;
    this.supervisor.acknowledged();
    this.scheduleReconnect(decision.delayMs);
  }

  private scheduleReconnect(delayMs: number): void {
    if (this.reconnectTimer !== null) return; // one in flight, always
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      const client = this.client;
      if (client === null) {
        this.supervisor.settled();
        return;
      }
      client
        .reconnect()
        .then(
          () => {
            this.supervisor.settled();
          },
          (error: unknown) => {
            this.supervisor.settled();
            this.handleSyncError(error, 'reconnect failed');
          },
        )
        .catch(() => {}); // handleSyncError never throws; belt and braces
    }, delayMs);
  }

  /** Distinguish fatal auth failures from transient network trouble. */
  private handleSyncError(error: unknown, context: string): void {
    if (error instanceof RevokedError || error instanceof UnauthorizedError) {
      this.authFailed = true;
      this.statusNote = 'Device token rejected — unlink and re-pair with a fresh code.';
      this.syncLog.error(context, error);
      new Notice(
        'VaultSync: the worker rejected this device\u2019s token (revoked?). Unlink and re-pair from settings.',
        10000,
      );
      return;
    }
    this.syncLog.warn(context, error); // offline/protocol: backoff keeps retrying
  }

  /** FR-44: warn when the vault's state dir belongs to another client. */
  private async warnIfForeignStateDir(storage: ObsidianStorageAdapter): Promise<void> {
    let marker: { deviceId?: unknown; deviceName?: unknown; url?: unknown };
    try {
      const bytes = await storage.readFile(DEVICE_MARKER_VAULT_PATH);
      marker = JSON.parse(new TextDecoder().decode(bytes)) as typeof marker;
    } catch {
      return; // no marker (or unreadable) — nothing to warn about
    }
    if (
      typeof marker.deviceId === 'string' &&
      marker.deviceId !== this.data.deviceId
    ) {
      const name = typeof marker.deviceName === 'string' ? marker.deviceName : marker.deviceId;
      const where = typeof marker.url === 'string' ? marker.url : 'a worker';
      new Notice(
        `VaultSync: this vault already has sync state for device "${name}" (linked to ${where}). ` +
          'One sync client per machine per vault — running two double-commits every change. ' +
          'Unlink the other client (or clear .vaultsyncforagents/) if this is unexpected.',
        15000,
      );
    }
  }
}

function normalizeWorkerUrlSafe(input: string): string {
  try {
    return normalizeWorkerUrl(input);
  } catch {
    return input;
  }
}
