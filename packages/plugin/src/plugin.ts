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
import {
  checkServerCompatibility,
  RevokedError,
  SyncClient,
  UnauthorizedError,
  type CompatibilityVerdict,
  type SyncClientStatus,
} from '@vsa/core';
import { ObsidianStorageAdapter } from './adapters/obsidian-storage.js';
import { ObsidianWatchAdapter, RescanScheduler } from './adapters/obsidian-watch.js';
import { HttpBlobStore } from './blobstore.js';
import {
  buildDiagnosticsBundle,
  buildSupportBundle,
  copyToClipboard,
  createPluginLog,
  formatSupportBundleStamp,
  platformSummary,
  withRoundTripLogging,
  type DiagnosticsInput,
  type PluginLog,
} from './diagnostics.js';
import {
  defaultDeviceName,
  detectDeviceType,
  isLinked,
  normalizePluginData,
  parseIgnorePatterns,
  defaultPluginData,
  type LogLevel,
  type VaultSyncPluginData,
} from './data.js';
import { pairOutcomeMessage, pairWithWorker } from './pairing.js';
import type { PairOutcome } from './pairing.js';
import { registerPairProtocolHandler } from './protocol-handler.js';
import { ReconnectSupervisor } from './reconnect.js';
import type { BackoffOptions } from './reconnect.js';
import type { StatusBarMode } from './statusbar.js';
import { ConfirmModal, VaultSyncSettingTab } from './settings.js';
import { StatusBarIndicator } from './statusbar.js';
import { WebSocketTransport } from './transport.js';
import type { WebSocketFactory } from './transport.js';
import { fetchWorkerStatus, normalizeWorkerUrl, renameDevice } from './workerapi.js';
import type { WorkerStatusSummary } from './workerapi.js';

/** The in-vault device marker shared with the daemon/CLI (FR-44 handshake). */
const DEVICE_MARKER_VAULT_PATH = '/.vaultsyncforagents/device.json';
const LOCAL_INDEX_VAULT_PATH = '/.vaultsyncforagents/state';
/** Where "Save support bundle" writes its diagnostic file. */
const SUPPORT_BUNDLE_DIR_VAULT_PATH = '/.vaultsyncforagents';
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
  /**
   * Latest server-version verdict (core compat.ts), re-assessed by the
   * supervision tick after every helloAck; null before the first ack of a
   * sync session. Non-ok verdicts ride the status-bar tooltip; a Notice is
   * shown at most once per plugin session.
   */
  private serverCompat: CompatibilityVerdict | null = null;
  private serverCompatNotified = false;
  /** Pause-syncing state (runtime only — a reload starts per syncOnStartup). */
  private paused = false;
  /** The plugin's log: console mirror + bounded ring (Copy diagnostics). */
  private readonly syncLog: PluginLog = createPluginLog();

  constructor(app: App, manifest: PluginManifest, overrides: PluginOverrides = {}) {
    super(app, manifest);
    this.overrides = overrides;
  }

  private get now(): () => number {
    return this.overrides.now ?? (() => Date.now());
  }

  private get fetchImpl(): typeof fetch {
    // Bind at the seam: consumers (pairing, `HttpBlobStore`) invoke this as a
    // detached function, and a detached `fetch` throws
    // `TypeError: Failed to execute 'fetch' on 'Window': Illegal invocation`
    // in Chromium renderers — i.e. in real Obsidian (desktop and mobile).
    // Binding to the global makes the default safe to call bare.
    return this.overrides.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  get linked(): boolean {
    return isLinked(this.data);
  }

  override async onload(): Promise<void> {
    this.data = normalizePluginData(await this.loadData());
    this.syncLog.setLevel(this.data.settings.logLevel);
    this.addSettingTab(new VaultSyncSettingTab(this.app, this));
    registerPairProtocolHandler(
      (action, handler) => this.registerObsidianProtocolHandler(action, handler),
      (link) => this.handlePairDeepLink(link.url, link.code),
    );
    // Cheap focus-driven rescan (FR-12): every note/app switch pokes the
    // scheduler, which coalesces into at most one cycle per debounce window.
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.rescan?.poke()));
    this.addCommand({
      id: 'copy-diagnostics',
      name: 'Copy diagnostics',
      callback: () => this.copyDiagnostics(),
    });
    this.addCommand({
      id: 'save-support-bundle',
      name: 'Save support bundle',
      callback: () => this.saveSupportBundle(),
    });
    // "Sync on startup" OFF = manual-only mode: load idle; the first "Sync
    // now" starts the machinery (watcher included).
    if (this.linked && this.data.settings.syncOnStartup) await this.startSync();
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

  /**
   * obsidian://vaultsyncforagents/pair?url=…&code=… (protocol-handler.ts).
   * On an unlinked vault the link's origin is untrusted until the user
   * approves it — pairing would hand the whole vault to whatever host the
   * link carried — so it goes through a confirmation naming that exact URL.
   */
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
    new ConfirmModal(this.app, {
      title: 'Pair VaultSync?',
      body:
        `A pairing link asked Obsidian to pair this vault with the worker at:\n\n${url}\n\n` +
        'Approving pairs this device and sends this vault\u2019s notes to that worker from then on. ' +
        'Only approve a link you opened from your own worker dashboard — any web page can craft one.',
      confirmText: 'Pair',
      onConfirm: () => this.pairFromDeepLink(url, code),
    }).open();
  }

  private async pairFromDeepLink(url: string, code: string): Promise<void> {
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

  /**
   * The vault-backed storage adapter every sync surface uses. Wires the
   * empty-folder removal through `fileManager.trashFile` — Obsidian's
   * `DataAdapter.rmdir` refuses EVERY directory (`ERR_FS_EISDIR`), which
   * silently degraded folder-tombstone application to record-only (F-1).
   * Trash (not delete) because an empty folder is trivially recoverable.
   */
  private createStorageAdapter(): ObsidianStorageAdapter {
    return new ObsidianStorageAdapter({
      adapter: this.app.vault.adapter,
      removeEmptyDir: async (adapterPath) => {
        const folder = this.app.vault.getAbstractFileByPath(adapterPath);
        if (folder === null) return; // raced away / tree not caught up — idempotent
        await this.app.fileManager.trashFile(folder);
      },
    });
  }

  /** Write the FR-44 marker the CLI/daemon read to detect double-clients. */
  private async writeDeviceMarker(): Promise<void> {
    if (!this.linked) return;
    const storage = this.createStorageAdapter();
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

  /**
   * `PATCH /device` — rename THIS device on the worker (the settings tab's
   * Rename button). Updates plugin data + the in-vault device marker (which
   * stores the name for the FR-44 double-client warning). Local state keeps
   * its previous name on failure.
   */
  async renameDevice(name: string): Promise<boolean> {
    if (!this.linked) {
      new Notice('VaultSync: pair this vault first — the name applies at pairing time.');
      return false;
    }
    const trimmed = name.trim();
    if (trimmed === '' || trimmed.length > 30 || /[\u0000-\u001f\u007f]/.test(trimmed)) {
      new Notice('VaultSync: device name must be 1-30 characters, without control characters.', 8000);
      return false;
    }
    const outcome = await renameDevice({
      origin: this.data.url,
      token: this.data.token,
      name: trimmed,
      fetchImpl: this.fetchImpl,
    });
    if (!outcome.ok) {
      new Notice(`VaultSync: renaming failed — ${outcome.error}`, 10000);
      return false;
    }
    this.data.deviceName = outcome.device.name;
    await this.savePluginData();
    await this.writeDeviceMarker();
    new Notice(`VaultSync: device renamed to “${outcome.device.name}”.`);
    return true;
  }

  // --- sync lifecycle ------------------------------------------------------------------

  /** Build everything and run startup reconciliation (idempotent restart). */
  private async startSync(): Promise<void> {
    if (!this.linked) return;
    this.stopSync();

    const { url, token, deviceId } = this.data;
    const deviceName = this.resolveDeviceName();
    const storage = this.createStorageAdapter();
    await this.warnIfForeignStateDir(storage);

    const client = new SyncClient({
      deviceId,
      deviceName,
      token,
      transport: () =>
        withRoundTripLogging(
          new WebSocketTransport({ url, wsFactory: this.overrides.wsFactory }),
          { log: this.syncLog, shouldLog: () => this.syncLog.debugEnabled },
        ),
      blobStore: new HttpBlobStore({ baseUrl: url, token, fetchImpl: this.fetchImpl }),
      storage,
      settings: {
        obsidianSync: this.data.settings.obsidianSync,
        extraIgnores: parseIgnorePatterns(this.data.settings.ignorePatterns),
      },
      log: this.syncLog,
      now: this.now,
    });
    this.client = client;
    this.authFailed = false;
    this.statusNote = '';
    this.serverCompat = null; // re-assessed from the fresh helloAck
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

    // Status bar (per the statusBarMode setting) + the 1 Hz supervision tick
    // that repaints it and supervises reconnection.
    this.mountStatusBar();
    const tick = setInterval(() => this.onTick(), SUPERVISION_TICK_MS);
    this.tickHandle = tick;
    this.registerInterval(tick as unknown as number); // Obsidian clears this on unload
    this.onTick();
  }

  /** (Re)mount the status-bar item per the current mode ('hidden' = none). */
  private mountStatusBar(): void {
    this.statusBarItem?.remove();
    this.statusBarItem = null;
    this.statusBar = null;
    if (this.client === null) return;
    if (this.data.settings.statusBarMode === 'hidden') return;
    const item = this.addStatusBarItem();
    this.statusBarItem = item;
    this.statusBar = new StatusBarIndicator(item);
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
    if (this.paused) {
      new Notice('VaultSync: syncing is paused — resume it in settings first.');
      return;
    }
    const client = this.client;
    if (client === null) {
      if (!this.linked) {
        new Notice('VaultSync: not paired yet — add your worker URL and a pairing code in settings.');
        return;
      }
      // Manual-only mode ("Sync on startup" OFF): this is the first start.
      await this.startSync();
      const status = this.client?.status();
      if (status !== undefined) {
        new Notice(
          status.state === 'disconnected'
            ? 'VaultSync: offline — changes will sync when the worker is reachable.'
            : 'VaultSync: up to date.',
        );
      }
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

  /** Pause: transport down + watcher/rescan idle, link and state kept. */
  pauseSyncing(): void {
    if (!this.linked || this.paused) return;
    this.paused = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.supervisor.settled();
    this.rescan?.stop();
    this.rescan = null;
    this.client?.close(); // also stops the watcher; state → idle
    this.onTick(); // repaint "vsa ⏸"
    new Notice('VaultSync: paused. New and changed files stay local until you resume.');
  }

  /** Resume: reconnect and run a full catch-up cycle (startup reconciliation). */
  async resumeSyncing(): Promise<void> {
    if (!this.linked || !this.paused) return;
    this.paused = false;
    new Notice('VaultSync: resuming — running a full catch-up sync…');
    await this.startSync();
  }

  /** Runtime pause state (the settings tab's button label + diagnostics). */
  get syncingPaused(): boolean {
    return this.paused;
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

  async applyStatusBarMode(mode: StatusBarMode): Promise<void> {
    this.data.settings.statusBarMode = mode;
    await this.savePluginData();
    this.mountStatusBar(); // re-mounts (or removes) the item per the mode
    this.onTick();
  }

  async applySyncOnStartup(enabled: boolean): Promise<void> {
    this.data.settings.syncOnStartup = enabled;
    await this.savePluginData();
    new Notice(
      enabled
        ? 'VaultSync: syncing will start automatically the next time Obsidian opens.'
        : 'VaultSync: on the next launch this plugin stays idle until you press “Sync now”.',
    );
  }

  async applyLogLevel(level: LogLevel): Promise<void> {
    this.data.settings.logLevel = level;
    await this.savePluginData();
    this.syncLog.setLevel(level);
  }

  /**
   * New ignore patterns: persist, then restart the sync machinery while live
   * so the scan/watcher pick them up immediately (a paused session applies
   * them on resume — resume always rebuilds the client).
   */
  async applyIgnorePatterns(text: string): Promise<void> {
    this.data.settings.ignorePatterns = text;
    await this.savePluginData();
    if (this.client !== null && !this.paused) await this.startSync();
  }

  /** Storage/attachment summary for the About section (null = unavailable). */
  async fetchStorageSummary(): Promise<WorkerStatusSummary | null> {
    if (!this.linked) return null;
    return fetchWorkerStatus({
      origin: this.data.url,
      token: this.data.token,
      fetchImpl: this.fetchImpl,
    });
  }

  /**
   * The shared snapshot behind "Copy diagnostics" and "Save support bundle".
   * Structurally redacted: the device token never enters (it lives only in
   * `this.data`), and conflicts contribute paths only — never file content.
   */
  private collectDiagnosticsInput(): DiagnosticsInput {
    const status = this.client?.status() ?? null;
    return {
      pluginVersion: this.manifest.version || 'unknown',
      deviceId: this.data.deviceId,
      deviceName: this.resolveDeviceName(),
      workerUrl: this.data.url,
      paired: this.linked,
      paused: this.paused,
      clientStatus: status,
      recentLogLines: this.syncLog.recentLines(),
      serverVersion: status?.serverVersion ?? null,
      settings: this.data.settings,
      recentConflicts: status === null ? [] : status.conflicts.map((conflict) => ({ path: conflict.path })),
    };
  }

  /** Copy the diagnostics bundle to the clipboard (fallback: console). */
  async copyDiagnostics(): Promise<void> {
    const bundle = buildDiagnosticsBundle(this.collectDiagnosticsInput());
    const copied = await copyToClipboard(bundle);
    if (copied) {
      new Notice('VaultSync: diagnostics copied to the clipboard.');
      return;
    }
    console.info('[vsa] diagnostics (clipboard unavailable):\n' + bundle);
    new Notice('VaultSync: clipboard unavailable — diagnostics written to the developer console.', 10000);
  }

  /**
   * Write the support bundle (markdown) into `.vaultsyncforagents/` in the
   * vault — the richer, attachable sibling of "Copy diagnostics".
   */
  async saveSupportBundle(): Promise<void> {
    const now = this.now();
    const markdown = buildSupportBundle(this.collectDiagnosticsInput(), now);
    const fileName = `support-bundle-${formatSupportBundleStamp(now)}.md`;
    const vaultPath = `${SUPPORT_BUNDLE_DIR_VAULT_PATH}/${fileName}`;
    try {
      // The storage adapter mkdirs the state dir on demand (it can be absent
      // before the first sync) and falls back to a plain write where the
      // adapter cannot rename.
      await this.createStorageAdapter().writeFile(vaultPath, new TextEncoder().encode(markdown));
      new Notice(`VaultSync: support bundle saved to ${vaultPath.slice(1)}.`);
    } catch (error) {
      this.syncLog.warn('failed to write support bundle', error);
      new Notice('VaultSync: could not write the support bundle — see the developer console.', 10000);
    }
  }

  /** The platform line for the About/diagnostics readouts. */
  platformSummary(): string {
    return platformSummary();
  }

  async unlink(): Promise<void> {
    this.stopSync();
    this.paused = false;
    // Clear local sync state (device marker + index) so a future client —
    // this plugin after a re-pair, the daemon, the CLI — starts clean
    // (FR-44: stale state would make it refuse or mis-sync).
    const storage = this.createStorageAdapter();
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

  // --- supervision --------------------------------------------------------------------------

  private onTick(): void {
    const client = this.client;
    if (client === null) return;
    const status = client.status();
    this.assessServerVersion(status);
    this.statusBar?.update(
      status,
      {
        url: this.data.url,
        deviceName: this.resolveDeviceName(),
        // Both notes can be live at once (an auth-failure note while the
        // server also reports version skew): concatenate instead of letting
        // either hide the other; empty parts drop out.
        note: [this.statusNote, this.serverCompatNote].filter((part) => part !== '').join(' · '),
        paused: this.paused,
        mode: this.data.settings.statusBarMode,
      },
      this.now(),
    );
    if (this.paused || this.authFailed) return; // no reconnect while paused / token rejected
    const decision = this.supervisor.consider(status.state);
    if (decision.action === 'wait') return;
    this.supervisor.acknowledged();
    this.scheduleReconnect(decision.delayMs);
  }

  /**
   * Latest server-version verdict for the settings tab; null until the first
   * helloAck of the current sync session.
   */
  get serverCompatibility(): CompatibilityVerdict | null {
    return this.serverCompat;
  }

  /** The verdict's tooltip line ('' when compatible — nothing to nag about). */
  private get serverCompatNote(): string {
    return this.serverCompat !== null && this.serverCompat.level !== 'ok'
      ? this.serverCompat.message
      : '';
  }

  /**
   * Version-skew assessment, run by the tick once the connection has acked
   * (states 'syncing'/'live' both follow the helloAck; pre-ack states read
   * serverVersion null for "not yet known" and must not produce a spurious
   * "legacy server" verdict). Never kills sync: the wire `ProtocolVersion`
   * check at hello remains the hard gate; a verdict is advisory.
   */
  private assessServerVersion(status: SyncClientStatus): void {
    if (status.state !== 'syncing' && status.state !== 'live') return;
    const verdict = checkServerCompatibility(this.manifest.version || 'unknown', status.serverVersion);
    this.serverCompat = verdict;
    if (verdict.level === 'ok') return; // also clears any stale tooltip note
    if (this.serverCompatNotified) return; // one Notice per plugin session
    this.serverCompatNotified = true;
    new Notice(`VaultSync: ${verdict.message}`, 10000);
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
