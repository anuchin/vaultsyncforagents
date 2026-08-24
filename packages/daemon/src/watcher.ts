/**
 * `NodeWatchAdapter` — core's `WatchAdapter` over chokidar (ARCHITECTURE.md
 * §8 adapters: "daemon/CLI = Node fs + chokidar"). This is the daemon's
 * platform lens on agent/script edits (FR-41): files written by anything on
 * the VPS become `FileChangeEvent`s the shared engine debounces into cycles.
 *
 * Event mapping (core's `FileChangeEvent` kinds):
 *   chokidar 'add'    → { kind: 'add' }
 *   chokidar 'change' → { kind: 'modify' }
 *   chokidar 'unlink' → { kind: 'delete' }
 *   'addDir'/'unlinkDir' → ignored: core discovers folder placeholders via
 *   `StorageAdapter.listDirs()` during the scan, and a removed directory
 *   always fires 'unlink' for every child file, which is what the engine
 *   needs. 'rename' is NOT synthesized: the engine's scan correlates
 *   delete+add pairs by content hash into explicit rename ops (FR-9), which
 *   is more reliable than FS rename hints across platforms.
 *
 * Noise suppression:
 *   - core's ignore rules (`isIgnored`) keep `.trash/`, `.vaultsyncforagents/`,
 *     `.obsidian/` (when not opted in) etc. out of the event stream — the
 *     daemon's own writes (remote pulls, trash copies, the state file) must
 *     not trigger feedback cycles;
 *   - the atomic-write temp files (`.<name>.tmp-<pid>-<hex>` from
 *     `writeFileAtomic`) are dropped so our own writes surface only as the
 *     final 'add'/'change' of the destination path.
 *
 * Batching: raw events are coalesced over a small window (default 200 ms;
 * `SyncClient` adds its own ~300 ms debounce on top) — one flushed array per
 * burst, one `FileChangeEvent` per path (the last kind seen wins). The
 * engine contract only requires "implementations batch raw events"; the
 * window is injectable so tests never wait on real timers.
 */

import { watch, type FSWatcher } from 'chokidar';
import { isIgnored, type FileChangeEvent, type IgnoreSettings, type WatchAdapter } from '@vsa/core';
import type { NodeStorageAdapter } from '@vsa/node-runtime';

export interface NodeWatchAdapterOptions {
  /** Storage adapter for the watched vault (path mapping + root). */
  storage: NodeStorageAdapter;
  /** Ignore settings mirrored from the client (default: `.obsidian/` off). */
  settings?: IgnoreSettings;
  /** awaitWriteFinish tuning (defaults: 500 ms stability, 100 ms poll). */
  awaitWriteFinish?: { stabilityThreshold: number; pollInterval: number };
  /** Event coalescing window in ms (default 200). */
  batchWindowMs?: number;
  /** Injectable scheduler (tests); default `setTimeout`. */
  schedule?: (fn: () => void, ms: number) => () => void;
  /** Reported (never thrown) on chokidar watcher errors. */
  onWatcherError?: (error: unknown) => void;
}

/** Temp suffix produced by `writeFileAtomic` (`.<base>.tmp-<pid>-<hex>`). */
const TEMP_FILE_PATTERN = /\.tmp-\d+-[0-9a-f]+$/;

const defaultSchedule = (fn: () => void, ms: number): (() => void) => {
  const handle = setTimeout(fn, ms) as unknown as number;
  return () => clearTimeout(handle);
};

export class NodeWatchAdapter implements WatchAdapter {
  private readonly storage: NodeStorageAdapter;
  private readonly settings: IgnoreSettings;
  private readonly awaitWriteFinish: { stabilityThreshold: number; pollInterval: number };
  private readonly batchWindowMs: number;
  private readonly schedule: (fn: () => void, ms: number) => () => void;
  private readonly onWatcherError: (error: unknown) => void;

  private watcher: FSWatcher | null = null;
  private callback: ((events: readonly FileChangeEvent[]) => void) | null = null;
  private pending: Map<string, FileChangeEvent> = new Map();
  private cancelFlush: (() => void) | null = null;

  constructor(options: NodeWatchAdapterOptions) {
    this.storage = options.storage;
    this.settings = options.settings ?? { obsidianSync: false };
    this.awaitWriteFinish = options.awaitWriteFinish ?? {
      stabilityThreshold: 500,
      pollInterval: 100,
    };
    this.batchWindowMs = options.batchWindowMs ?? 200;
    this.schedule = options.schedule ?? defaultSchedule;
    this.onWatcherError = options.onWatcherError ?? (() => {});
  }

  start(cb: (events: readonly FileChangeEvent[]) => void): void {
    if (this.watcher !== null) return; // start is idempotent (core calls it per watch)
    this.callback = cb;
    this.watcher = watch(this.storage.root, {
      ignoreInitial: false,
      persistent: true,
      // Never follow links: a symlink inside the vault may point outside it
      // (the target's churn must not trigger cycles for content the scan
      // refuses to see) or into a loop. The link itself is surfaced by the
      // scan's `symlinks` diagnostic instead.
      followSymlinks: false,
      ignored: (path: string) => this.isIgnoredHostPath(path),
      awaitWriteFinish: this.awaitWriteFinish,
    });
    this.watcher.on('add', (path: string) => this.record('add', path));
    this.watcher.on('change', (path: string) => this.record('modify', path));
    this.watcher.on('unlink', (path: string) => this.record('delete', path));
    this.watcher.on('error', (error: unknown) => this.onWatcherError(error));
  }

  stop(): void {
    // Flush whatever was being coalesced so a stop mid-burst loses nothing…
    this.flush();
    this.callback = null;
    this.cancelFlush?.();
    this.cancelFlush = null;
    const watcher = this.watcher;
    this.watcher = null;
    if (watcher !== null) void watcher.close().catch(() => {});
  }

  /** Whether a host path is filtered before it ever becomes an event. */
  isIgnoredHostPath(hostPath: string): boolean {
    const vaultPath = this.toVaultPathOrNull(hostPath);
    if (vaultPath === null) return true; // outside the root — nothing we sync
    // The watched root itself must NEVER be "ignored": chokidar prunes an
    // ignored watch root entirely (no events at all). Events for '/' are
    // dropped separately in record().
    if (vaultPath === '/') return false;
    if (isIgnored(vaultPath, this.settings)) return true;
    const base = vaultPath.slice(vaultPath.lastIndexOf('/') + 1);
    return TEMP_FILE_PATTERN.test(base);
  }

  private toVaultPathOrNull(hostPath: string): string | null {
    try {
      return this.storage.toVaultPath(hostPath);
    } catch {
      return null;
    }
  }

  private record(kind: FileChangeEvent['kind'], hostPath: string): void {
    if (this.callback === null) return;
    const vaultPath = this.toVaultPathOrNull(hostPath);
    if (vaultPath === null || vaultPath === '/') return;
    if (this.isIgnoredHostPath(hostPath)) return;
    // Last kind wins per path; Map preserves first-seen order.
    this.pending.set(vaultPath, { kind, path: vaultPath });
    if (this.cancelFlush === null) {
      this.cancelFlush = this.schedule(() => {
        this.cancelFlush = null;
        this.flush();
      }, this.batchWindowMs);
    }
  }

  private flush(): void {
    if (this.pending.size === 0 || this.callback === null) return;
    const events = [...this.pending.values()];
    this.pending.clear();
    this.callback(events);
  }
}
