/**
 * `ObsidianWatchAdapter` + `RescanScheduler` — core's `WatchAdapter` over
 * Obsidian vault events (ARCHITECTURE §8 adapters), plus the periodic /
 * focus-driven reconciliation hooks the mobile & external-edit stories need
 * (§8 "Mobile", FR-5, FR-12).
 *
 * Vault events cover everything Obsidian itself observes — in-app edits,
 * drag-drops, and external edits made while Obsidian is *open*. Edits made
 * while Obsidian was closed are picked up by the startup reconciliation and
 * by the periodic rescan wired here:
 *
 *   vault events ──────────────► WatchAdapter.start(cb) ─► SyncClient debounced cycle
 *   setInterval (default 30s) ─► RescanScheduler ─────────► SyncClient.triggerSync()
 *   active-leaf-change ────────► RescanScheduler.poke() ──► (short debounce, then a cycle)
 */

import type { EventRef, TAbstractFile, Vault } from 'obsidian';
import type { FileChangeEvent, WatchAdapter } from '@vsa/core';

export interface ObsidianWatchAdapterOptions {
  vault: Vault;
}

export class ObsidianWatchAdapter implements WatchAdapter {
  private readonly vault: Vault;
  private refs: EventRef[] = [];
  private emit: ((events: readonly FileChangeEvent[]) => void) | null = null;

  constructor(options: ObsidianWatchAdapterOptions) {
    this.vault = options.vault;
  }

  start(cb: (events: readonly FileChangeEvent[]) => void): void {
    this.stop();
    this.emit = cb;
    // Both files and folders are forwarded: folder events (create/rename/
    // delete) trigger the reconciliation scan that discovers empty-folder
    // placeholder changes (FR-10). The engine filters ignored paths itself.
    this.refs = [
      this.vault.on('create', (file: TAbstractFile) => {
        this.forward({ kind: 'add', path: vaultPathOf(file) });
      }),
      this.vault.on('modify', (file: TAbstractFile) => {
        this.forward({ kind: 'modify', path: vaultPathOf(file) });
      }),
      this.vault.on('delete', (file: TAbstractFile) => {
        this.forward({ kind: 'delete', path: vaultPathOf(file) });
      }),
      this.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
        // `oldPath` → `file.path`: the entry at `path` moved to `toPath`.
        this.forward({ kind: 'rename', path: `/${oldPath}`, toPath: vaultPathOf(file) });
      }),
    ];
  }

  stop(): void {
    for (const ref of this.refs) this.vault.offref(ref);
    this.refs = [];
    this.emit = null;
  }

  private forward(event: FileChangeEvent): void {
    this.emit?.([event]);
  }
}

/** Vault event path (adapter-normalized, no leading slash) → core vault path. */
function vaultPathOf(file: TAbstractFile): string {
  return file.path.startsWith('/') ? file.path : `/${file.path}`;
}

// --- RescanScheduler -----------------------------------------------------------------

export interface RescanSchedulerOptions {
  /** Period between full rescans in ms; `0` disables the periodic timer. */
  intervalMs: number;
  /** Debounce window for `poke()` (active-leaf-change), default 3000 ms. */
  pokeDelayMs?: number;
  /** Injectable timer seams (tests use fake timers against the globals). */
  setIntervalImpl?: (fn: () => void, ms: number) => unknown;
  clearIntervalImpl?: (handle: unknown) => void;
  setTimeoutImpl?: (fn: () => void, ms: number) => unknown;
  clearTimeoutImpl?: (handle: unknown) => void;
}

/**
 * Drives periodic + focus-triggered full reconciliation cycles. Not a
 * `WatchAdapter` itself — its `run` callback is wired to
 * `SyncClient.triggerSync()` by the plugin (a rescan is a full cycle, not a
 * single file event).
 */
export class RescanScheduler {
  private readonly pokeDelayMs: number;
  private readonly setIntervalImpl: (fn: () => void, ms: number) => unknown;
  private readonly clearIntervalImpl: (handle: unknown) => void;
  private readonly setTimeoutImpl: (fn: () => void, ms: number) => unknown;
  private readonly clearTimeoutImpl: (handle: unknown) => void;

  private run: (() => void) | null = null;
  private intervalHandle: unknown = null;
  private intervalMs: number;
  private pokeHandle: unknown = null;

  constructor(options: RescanSchedulerOptions) {
    this.intervalMs = options.intervalMs;
    this.pokeDelayMs = options.pokeDelayMs ?? 3000;
    this.setIntervalImpl = options.setIntervalImpl ?? ((fn, ms) => setInterval(fn, ms));
    this.clearIntervalImpl = options.clearIntervalImpl ?? ((handle) => clearInterval(handle as number));
    this.setTimeoutImpl = options.setTimeoutImpl ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimeoutImpl = options.clearTimeoutImpl ?? ((handle) => clearTimeout(handle as number));
  }

  /** Begin periodic rescans; `run` must be safe to call at any time. */
  start(run: () => void): void {
    this.stop();
    this.run = run;
    this.armInterval();
  }

  stop(): void {
    this.clearIntervalImplKeep();
    if (this.pokeHandle !== null) {
      this.clearTimeoutImpl(this.pokeHandle);
      this.pokeHandle = null;
    }
    this.run = null;
  }

  /** Change the periodic interval live (the settings-tab toggle). */
  setIntervalMs(ms: number): void {
    this.intervalMs = ms;
    if (this.run !== null) {
      this.clearIntervalImplKeep();
      this.armInterval();
    }
  }

  /** A focus/app-switch signal (active-leaf-change): rescan soon, coalesced. */
  poke(): void {
    if (this.run === null) return;
    if (this.pokeHandle !== null) return; // already scheduled
    this.pokeHandle = this.setTimeoutImpl(() => {
      this.pokeHandle = null;
      this.run?.();
    }, this.pokeDelayMs);
  }

  get intervalMsValue(): number {
    return this.intervalMs;
  }

  private armInterval(): void {
    if (this.intervalMs <= 0 || this.run === null) return;
    this.intervalHandle = this.setIntervalImpl(() => this.run?.(), this.intervalMs);
  }

  private clearIntervalImplKeep(): void {
    if (this.intervalHandle !== null) {
      this.clearIntervalImpl(this.intervalHandle);
      this.intervalHandle = null;
    }
  }
}
