/**
 * `DaemonManager` — one Node process, many vaults (FR-40, ARCHITECTURE §9).
 *
 * The daemon serves EXACTLY the vaults the CLI linked on this machine (the
 * `@vsa/node-runtime` `ConfigStore` is the single registry; `vsa link` is how
 * a vault joins, `--vault` narrows which ones run). For each vault it
 * composes the phase-1 pieces the way the CLI does (`sync.ts`), plus the two
 * daemon-only adapters: `NodeWatchAdapter` (chokidar, FR-41) and
 * `TrashGuardStorage` (FR-42 safe deletes).
 *
 * Per-vault lifecycle (`VaultSession`):
 *   start → SyncClient.connect() (startup reconciliation) → live with the
 *   watcher attached; on failure or an unexpected transport close, reconnect
 *   with exponential backoff + jitter (cap 60 s, injectable for tests).
 *
 * Status aggregation: `health()` snapshots every vault —
 * `{vault, state, lastSyncAt, pending, conflicts, error?}` — and, when a
 * `healthPath` is configured, the snapshot is written there periodically so
 * `vsa daemon status` can report a running daemon without IPC.
 *
 * Graceful shutdown (`stop()`, wired to SIGINT/SIGTERM by the run entries):
 * cancel pending retries → stop watchers → `waitIdle()` so an in-flight
 * cycle finishes (its index persist included) → close sockets. Idempotent.
 *
 * All construction seams (`createClient`, `createSession`, `schedule`,
 * `now`, `random`) are injectable; the daemon's tests run without a network,
 * chokidar, or real timers.
 */

import { existsSync, readFileSync, statSync } from 'node:fs';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import {
  SyncClient,
  type LogAdapter,
  type WatchAdapter,
  type ConflictOp,
} from '@vsa/core';
import type { Transport } from '@vsa/core';
import {
  ConfigStore,
  HttpBlobStore,
  NodeStorageAdapter,
  WebSocketTransport,
  writeFileAtomicSync,
  type VaultEntry,
} from '@vsa/node-runtime';
import { NodeWatchAdapter } from './watcher.js';
import { TrashGuardStorage } from './trash.js';

// --- backoff -----------------------------------------------------------------------------

export interface BackoffOptions {
  /** Delay before the first retry (default 1000 ms). */
  initialMs: number;
  /** Ceiling after exponential growth (default 60 000 ms). */
  maxMs: number;
  /** ± fraction applied as jitter (default 0.25 → 0.75×..1.25×). */
  jitterRatio: number;
}

export const DEFAULT_BACKOFF: BackoffOptions = { initialMs: 1000, maxMs: 60_000, jitterRatio: 0.25 };

/**
 * Exponential backoff with multiplicative jitter:
 * `min(maxMs, initialMs·2^attempt)` scaled by `1−r .. 1+r`. Bounded attempt
 * exponent avoids 2^Infinity on pathological loop counts.
 */
export function backoffDelay(
  attempt: number,
  options: BackoffOptions = DEFAULT_BACKOFF,
  random: () => number = Math.random,
): number {
  const exponent = Math.min(attempt, 20);
  const base = Math.min(options.maxMs, options.initialMs * 2 ** exponent);
  const jitter = 1 - options.jitterRatio + 2 * options.jitterRatio * random();
  return Math.max(0, Math.round(base * jitter));
}

// --- the client seam ---------------------------------------------------------------------

/** The `SyncClient` surface a session drives (core's class satisfies this). */
export interface SyncClientLike {
  connect(): Promise<void>;
  reconnect(): Promise<void>;
  close(): void;
  waitIdle(): Promise<void>;
  status(): {
    state: 'idle' | 'connecting' | 'syncing' | 'live' | 'disconnected';
    lastSyncAt: number | null;
    pending: number;
    conflicts: ReadonlyArray<ConflictOp>;
  };
  startWatching?(adapter: WatchAdapter): void;
}

/** Everything a vault needs to run; the default factory wires the real stack. */
export interface ClientBundle {
  client: SyncClientLike;
  watcher: WatchAdapter | null;
  /** Registers a callback fired on an unexpected connection drop. */
  onDrop(callback: (reason: string) => void): void;
}

export type ClientFactory = (
  vault: VaultEntry,
  token: string,
  log: LogAdapter,
  deviceName?: string,
) => ClientBundle;

/**
 * Integration-test overrides for {@link createNodeClientBundle}: swap the
 * WebSocket dial and/or the HTTP blob store (e.g. for core's
 * `InMemorySyncServer` transport pairs and a Map blob cache) while keeping
 * every other adapter production-real.
 */
export interface NodeClientBundleOverrides {
  dial?: () => Transport;
  blobStore?: import('@vsa/core').BlobStore;
}

/**
 * The production stack per vault: NodeStorageAdapter (wrapped by the FR-42
 * trash guard) + HttpBlobStore + WebSocketTransport (dialed fresh per
 * connect; drops are surfaced to the session for backoff) + chokidar watcher.
 */
export function createNodeClientBundle(
  vault: VaultEntry,
  token: string,
  log: LogAdapter,
  deviceName = defaultDaemonDeviceName(),
  overrides: NodeClientBundleOverrides = {},
): ClientBundle {
  const nodeStorage = new NodeStorageAdapter({ root: vault.id });
  const storage = new TrashGuardStorage({ storage: nodeStorage, log });
  const blobStore = overrides.blobStore ?? new HttpBlobStore({ baseUrl: vault.url, token });
  const dropHandlers: Array<(reason: string) => void> = [];

  const dial = overrides.dial ??
    ((): Transport => {
      const transport = new WebSocketTransport({ url: vault.url });
      transport.onClose((reason) => {
        if (reason.code === 1000 && reason.reason === 'closed by caller') return; // our own close
        const detail = reason.reason !== undefined && reason.reason !== ''
          ? reason.reason
          : `connection closed (code ${reason.code ?? '?'})`;
        for (const handler of [...dropHandlers]) handler(detail);
      });
      return transport;
    });

  const client = new SyncClient({
    deviceId: vault.deviceId,
    deviceName,
    token,
    transport: dial,
    blobStore,
    storage,
    log,
  });

  const watcher = new NodeWatchAdapter({
    storage: nodeStorage,
    onWatcherError: (error) => log.warn('watcher error', error),
  });

  return {
    client,
    watcher,
    onDrop(callback) {
      dropHandlers.push(callback);
    },
  };
}

export function defaultDaemonDeviceName(): string {
  return `daemon@${hostname()}`.toLowerCase();
}

// --- one vault's supervised lifecycle -----------------------------------------------------

export type VaultDaemonState =
  | 'stopped'
  | 'starting'
  | 'connecting'
  | 'syncing'
  | 'live'
  | 'disconnected'
  | 'error';

export interface VaultDaemonStatus {
  /** Vault id — the absolute vault directory (the registry key). */
  vault: string;
  name: string;
  url: string;
  state: VaultDaemonState;
  lastSyncAt: number | null;
  pending: number;
  conflicts: number;
  error?: string;
}

export interface VaultSessionDeps {
  vault: VaultEntry;
  token: string;
  client: SyncClientLike;
  watcher: WatchAdapter | null;
  onDrop(callback: (reason: string) => void): void;
  log: LogAdapter;
  now(): number;
  schedule(fn: () => void, ms: number): () => void;
  backoff: BackoffOptions;
  random(): number;
}

/**
 * One vault under supervision: connect, watch, reconnect-with-backoff,
 * graceful stop. Network failures never throw out of `start()` — the session
 * retries until stopped; the last error rides on `status()`.
 */
export class VaultSession {
  private readonly deps: VaultSessionDeps;
  private phase: 'stopped' | 'starting' | 'connecting' | 'live' | 'disconnected' = 'stopped';
  private stopped = false;
  private busy = false;
  private attempt = 0;
  private lastError: string | undefined;
  private cancelRetry: (() => void) | null = null;

  constructor(deps: VaultSessionDeps) {
    this.deps = deps;
    deps.onDrop((reason) => this.handleDrop(reason));
  }

  async start(): Promise<void> {
    if (this.phase !== 'stopped') return;
    this.stopped = false;
    this.phase = 'starting';
    await this.connect();
  }

  async stop(): Promise<void> {
    if (this.phase === 'stopped') return;
    this.stopped = true;
    this.cancelRetry?.();
    this.cancelRetry = null;
    this.deps.watcher?.stop();
    this.phase = 'stopped';
    try {
      // Flush an in-flight cycle (its index persist included) before closing.
      await this.deps.client.waitIdle();
    } catch (error) {
      this.deps.log.warn('waitIdle during shutdown failed', error);
    }
    this.deps.client.close();
  }

  status(): VaultDaemonStatus {
    const inner = this.deps.client.status();
    const state: VaultDaemonState =
      this.phase === 'stopped'
        ? 'stopped'
        : this.phase === 'connecting' || this.phase === 'starting'
          ? 'connecting'
          : this.phase === 'disconnected'
            ? 'disconnected'
            : inner.state === 'disconnected'
              ? 'disconnected'
              : inner.state === 'syncing'
                ? 'syncing' // transient cycle progress surfaces
                : 'live'; // 'live' (and 'idle'/'connecting' instants) under supervision
    return {
      vault: this.deps.vault.id,
      name: this.deps.vault.name,
      url: this.deps.vault.url,
      state,
      lastSyncAt: inner.lastSyncAt,
      pending: inner.pending,
      conflicts: inner.conflicts.length,
      ...(this.lastError !== undefined ? { error: this.lastError } : {}),
    };
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    this.phase = 'connecting';
    this.busy = true;
    try {
      await this.deps.client.connect();
      this.attempt = 0;
      this.lastError = undefined;
      this.phase = 'live';
      if (this.deps.watcher !== null && this.deps.client.startWatching !== undefined) {
        this.deps.client.startWatching(this.deps.watcher);
      }
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.phase = 'disconnected';
      this.scheduleReconnect();
    } finally {
      this.busy = false;
    }
  }

  private handleDrop(reason: string): void {
    // While connect()/reconnect() is in flight its own catch path owns the
    // retry; a close event then is the same failure, not a second one.
    if (this.stopped || this.busy) return;
    if (this.phase === 'disconnected' || this.phase === 'stopped') return;
    this.lastError = reason;
    this.phase = 'disconnected';
    void this.reconnect();
  }

  private async reconnect(): Promise<void> {
    if (this.stopped) return;
    this.phase = 'connecting';
    this.busy = true;
    try {
      await this.deps.client.reconnect();
      this.attempt = 0;
      this.lastError = undefined;
      this.phase = 'live';
    } catch (error) {
      this.lastError = error instanceof Error ? error.message : String(error);
      this.phase = 'disconnected';
      this.scheduleReconnect();
    } finally {
      this.busy = false;
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    const delay = backoffDelay(this.attempt, this.deps.backoff, this.deps.random);
    this.attempt += 1;
    this.cancelRetry?.();
    this.cancelRetry = this.deps.schedule(() => {
      this.cancelRetry = null;
      void this.reconnect();
    }, delay);
  }
}

// --- the manager --------------------------------------------------------------------------

export interface DaemonHealth {
  running: boolean;
  startedAt: number;
  pid: number;
  vaults: VaultDaemonStatus[];
}

export interface VaultSessionLike {
  start(): Promise<void>;
  stop(): Promise<void>;
  status(): VaultDaemonStatus;
}

export interface DaemonManagerOptions {
  /** The SAME machine config the CLI uses (vaults join via `vsa link`). */
  configStore: ConfigStore;
  /** Restrict to one vault (id or path, matched like `vsa --vault`). */
  vaultFilter?: string;
  /** Device name for conflict-copy naming (default `daemon@<host>`). */
  deviceName?: string;
  log?: LogAdapter;
  now?: () => number;
  schedule?: (fn: () => void, ms: number) => () => void;
  backoff?: Partial<BackoffOptions>;
  /** Periodic health snapshot destination (e.g. `<configDir>/daemon-health.json`). */
  healthPath?: string;
  /** Snapshot period in ms (default 5000; needs `healthPath`). */
  healthIntervalMs?: number;
  /** Injectable session factory (tests). */
  createSession?: (deps: VaultSessionDeps) => VaultSessionLike;
  /** Injectable client bundle factory (tests). */
  createClient?: ClientFactory;
}

/** Default snapshot filename inside the machine config dir. */
export const DAEMON_HEALTH_FILE_NAME = 'daemon-health.json';

/**
 * Snapshot path next to the machine config (`<configDir>/daemon-health.json`).
 * Accepts anything shaped like a `ConfigStore` (tests, the CLI seam).
 */
export function daemonHealthPathFor(config: { configPath: string }): string {
  return join(dirname(config.configPath), DAEMON_HEALTH_FILE_NAME);
}

/** Read + loosely validate a health snapshot; `null` when absent/corrupt. */
export function readDaemonHealthSnapshot(path: string): DaemonHealth | null {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return null;
  }
  try {
    const value = JSON.parse(text) as Partial<DaemonHealth>;
    if (typeof value !== 'object' || value === null) return null;
    if (typeof value.running !== 'boolean' || !Array.isArray(value.vaults)) return null;
    return value as DaemonHealth;
  } catch {
    return null;
  }
}

export class DaemonManager {
  private readonly configStore: ConfigStore;
  private readonly vaultFilter: string | undefined;
  private readonly deviceName: string;
  private readonly log: LogAdapter;
  private readonly now: () => number;
  private readonly schedule: (fn: () => void, ms: number) => () => void;
  private readonly backoff: BackoffOptions;
  private readonly healthPath: string | undefined;
  private readonly healthIntervalMs: number;
  private readonly createClient: ClientFactory;
  private readonly createSession: (deps: VaultSessionDeps) => VaultSessionLike;

  private sessions: Array<{ vault: VaultEntry; session: VaultSessionLike }> = [];
  private unstarted: VaultDaemonStatus[] = [];
  private running = false;
  private startedAt = 0;
  private cancelHealthTick: (() => void) | null = null;

  constructor(options: DaemonManagerOptions) {
    this.configStore = options.configStore;
    this.vaultFilter = options.vaultFilter;
    this.deviceName = options.deviceName ?? defaultDaemonDeviceName();
    this.log = options.log ?? { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
    this.now = options.now ?? (() => Date.now());
    this.schedule = options.schedule ?? defaultSchedule;
    this.backoff = { ...DEFAULT_BACKOFF, ...options.backoff };
    this.healthPath = options.healthPath;
    this.healthIntervalMs = options.healthIntervalMs ?? 5_000;
    this.createClient = options.createClient ?? createNodeClientBundle;
    this.createSession = options.createSession ?? ((deps) => new VaultSession(deps));
  }

  /** Start every selected vault. Resolves once sessions are launched (each
   *  then lives its own connect/backoff loop; first connects continue in the
   *  background so one dead worker never delays the other vaults). */
  async start(): Promise<void> {
    if (this.running) return;
    const vaults = this.selectVaults();
    this.running = true;
    this.startedAt = this.now();

    for (const vault of vaults) {
      const guardError = this.startupGuard(vault);
      if (guardError !== undefined) {
        this.unstarted.push({
          vault: vault.id,
          name: vault.name,
          url: vault.url,
          state: 'error',
          lastSyncAt: null,
          pending: 0,
          conflicts: 0,
          error: guardError,
        });
        this.log.error('vault not started', vault.id, guardError);
        continue;
      }
      const token = this.configStore.getToken(vault.id) as string;
      const bundle = this.createClient(vault, token, this.log, this.deviceName);
      const session = this.createSession({
        vault,
        token,
        client: bundle.client,
        watcher: bundle.watcher,
        onDrop: bundle.onDrop,
        log: this.log,
        now: this.now,
        schedule: this.schedule,
        backoff: this.backoff,
        random: Math.random,
      });
      this.sessions.push({ vault, session });
    }

    await Promise.all(this.sessions.map(({ session }) => session.start()));
    this.log.info(
      'daemon started',
      `${this.sessions.length} vault(s) running` +
        (this.unstarted.length > 0 ? `, ${this.unstarted.length} failed startup guards` : ''),
    );
    this.writeHealthSnapshot();
    this.startHealthTicker();
  }

  /** Graceful shutdown: flush in-flight cycles, close sockets, drop watchers. */
  async stop(): Promise<void> {
    if (!this.running) return;
    this.running = false;
    this.cancelHealthTick?.();
    this.cancelHealthTick = null;
    const sessions = this.sessions;
    await Promise.all(sessions.map(({ session }) => session.stop()));
    // Final snapshot BEFORE dropping the sessions: it reports running=false
    // with each vault's last-known (stopped) state.
    this.writeHealthSnapshot();
    this.sessions = [];
    this.log.info('daemon stopped');
  }

  health(): DaemonHealth {
    return {
      running: this.running,
      startedAt: this.startedAt,
      pid: process.pid,
      vaults: [
        ...this.sessions.map(({ session }) => session.status()),
        ...this.unstarted.map((status) => ({ ...status, state: 'error' as const })),
      ].sort((a, b) => (a.vault < b.vault ? -1 : a.vault > b.vault ? 1 : 0)),
    };
  }

  private selectVaults(): VaultEntry[] {
    const vaults = this.configStore.load().vaults;
    if (this.vaultFilter === undefined) return vaults;
    const found = this.configStore.findVault(this.vaultFilter);
    if (found === undefined) {
      throw new Error(
        `no linked vault matches ${JSON.stringify(this.vaultFilter)} — linked vaults:\n` +
          (vaults.length === 0
            ? '  (none — run `vsa link` first)'
            : vaults.map((vault) => `  ${vault.name}  ${vault.id}`).join('\n')),
      );
    }
    return [found];
  }

  /**
   * Startup safety: a missing vault directory must never become a session —
   * an empty scan over a absent root would tombstone the whole vault
   * remotely. A missing token means the vault cannot authenticate.
   */
  private startupGuard(vault: VaultEntry): string | undefined {
    if (!existsSync(vault.id) || !statSync(vault.id).isDirectory()) {
      return `vault directory does not exist: ${vault.id} — refusing to sync (an empty scan would delete the vault remotely)`;
    }
    if (this.configStore.getToken(vault.id) === undefined) {
      return 'no device token for this vault — run `vsa link` again to re-pair';
    }
    return undefined;
  }

  private startHealthTicker(): void {
    if (this.healthPath === undefined || this.healthIntervalMs <= 0) return;
    const tick = (): void => {
      this.writeHealthSnapshot();
      this.cancelHealthTick = this.schedule(tick, this.healthIntervalMs);
    };
    this.cancelHealthTick = this.schedule(tick, this.healthIntervalMs);
  }

  private writeHealthSnapshot(): void {
    if (this.healthPath === undefined) return;
    try {
      writeFileAtomicSync(this.healthPath, JSON.stringify(this.health(), null, 2) + '\n');
    } catch (error) {
      this.log.warn('failed to write health snapshot', this.healthPath, error);
    }
  }
}

const defaultSchedule = (fn: () => void, ms: number): (() => void) => {
  const handle = setTimeout(fn, ms) as unknown as number;
  return () => clearTimeout(handle);
};
