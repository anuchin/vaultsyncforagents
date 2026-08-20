/**
 * FR-42 safe deletes — daemon side, with a DOCUMENTED DEVIATION from
 * ARCHITECTURE.md §4.
 *
 * Where deletes hit disk: core's `applyPull` removes a local file in exactly
 * one place — `StorageAdapter.deleteFile` (engine.ts: "a local .trash copy
 * is a platform-layer concern (daemon/plugin), not engine logic"). Only
 * REMOTE tombstones ever call it: a local delete (`rm` by an agent) finds
 * the file already gone and turns into a tombstone push, and remote renames
 * use `renameFile`. So decorating `deleteFile` here captures precisely the
 * remote-delete flow.
 *
 * Behavior (the phase-4b spec):
 *   - REMOTE delete + local file present with content that differs from the
 *     last-synced state → copy the local bytes to
 *     `/.trash/<UTC-timestamp>-<basename>` BEFORE deleting.
 *   - REMOTE delete + local file identical to the last-synced content →
 *     delete without a copy (the content is by definition in the server's
 *     version history — FR-7 — recoverable via `vsa restore`).
 *
 * DEVIATION (from "only if local content differs from incoming tombstone
 * hash"): the `StorageAdapter` seam does not carry the tombstone's hash, and
 * `@vsa/core` may not be modified for the daemon. We therefore compare the
 * local content's sha256 against the *persisted local index's* hash for the
 * path (read via core's own `loadLocalIndex` through this same adapter).
 * This is equivalent for the case that matters — unsynced local edits are
 * always rescued into `.trash/` — and stricter-safe in the remaining case:
 * when another device edited-then-deleted a file we held cleanly, the
 * literal rule would copy (local ≠ tombstone) but we do not, because that
 * exact content is still a kept server version (every version of every file
 * is retained, FR-7/FR-8). If the index is unreadable or the path unknown,
 * we copy (conservative).
 *
 * DEVIATION #2 (local deletes): ARCHITECTURE §4 also puts locally-deleted
 * files into `.trash/` before tombstoning, but by the time the engine sees
 * a local delete the bytes are already gone (the agent ran `rm`) — and the
 * server keeps every version anyway, so recovery goes through history
 * (`vsa restore <file>`) instead of a redundant local copy. Local deletes
 * tombstone directly; this is intentional.
 *
 * Failure policy: if the safety copy itself fails (disk full, permissions),
 * the error propagates — `applyPull` aborts the plan and retries later; we
 * never delete diverged content whose only copy the copy failure would
 * destroy.
 */

import {
  basename,
  isIgnored,
  loadLocalIndex,
  LOCAL_INDEX_STATE_PATH,
  sha256Hex,
  type IgnoreSettings,
  type LogAdapter,
  type StorageAdapter,
  type FileStat,
} from '@vsa/core';
import type { NodeStorageAdapter } from '@vsa/node-runtime';

export interface TrashGuardStorageOptions {
  /** The real Node storage adapter for the vault. */
  storage: NodeStorageAdapter;
  /** Ignore settings used to decide which paths never get a trash copy. */
  settings?: IgnoreSettings;
  /** Injectable clock (trash names are UTC timestamps). */
  now?: () => number;
  log?: LogAdapter;
}

/** `.trash/` vault dir (ignored by core's sync rules). */
export const TRASH_DIR_PATH = '/.trash';

export class TrashGuardStorage implements StorageAdapter {
  private readonly inner: NodeStorageAdapter;
  private readonly settings: IgnoreSettings;
  private readonly now: () => number;
  private readonly log: LogAdapter;

  constructor(options: TrashGuardStorageOptions) {
    this.inner = options.storage;
    this.settings = options.settings ?? { obsidianSync: false };
    this.now = options.now ?? (() => Date.now());
    this.log = options.log ?? { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };
  }

  // --- the decorated operation -----------------------------------------------------

  async deleteFile(path: string): Promise<void> {
    if (!this.isTrashCandidate(path)) {
      await this.inner.deleteFile(path);
      return;
    }

    let bytes: Uint8Array;
    try {
      bytes = await this.inner.readFile(path);
    } catch {
      await this.inner.deleteFile(path); // already gone: idempotent delete
      return;
    }

    const actual = await sha256Hex(bytes);
    if (!(await this.contentDiverged(path, actual))) {
      await this.inner.deleteFile(path);
      return;
    }

    const trashPath = await this.uniqueTrashPath(path);
    try {
      await this.inner.writeFile(trashPath, bytes);
    } catch (error) {
      this.log.error('failed to write .trash safety copy; aborting delete', path, error);
      throw error;
    }
    this.log.info('remote delete rescued diverged content to .trash', path, '→', trashPath);
    await this.inner.deleteFile(path);
  }

  /**
   * True when the on-disk content is NOT the last-synced content: unknown
   * path, unreadable index, tombstoned entry, or a hash mismatch. That is
   * exactly "the server does not provably hold these bytes".
   */
  private async contentDiverged(path: string, actualHash: string): Promise<boolean> {
    let index;
    try {
      index = await loadLocalIndex(this);
    } catch {
      return true; // no readable index: assume divergence, keep the bytes
    }
    const entry = index[path];
    if (entry === undefined) return true;
    if (entry.deletedAt !== undefined) return true; // local file over a tombstone
    return entry.hash !== actualHash;
  }

  /** `/.trash/<UTC-timestamp>-<basename>`, suffixed `-2`, `-3`, … on collision. */
  private async uniqueTrashPath(path: string): Promise<string> {
    const stamped = `${formatTrashTimestamp(this.now())}-${basename(path)}`;
    for (let n = 1; ; n++) {
      const candidate = n === 1 ? stamped : `${stamped}-${n}`;
      const trashPath = `${TRASH_DIR_PATH}/${candidate}`;
      if (!(await this.inner.exists(trashPath))) return trashPath;
    }
  }

  /** Sync-state, `.trash/` itself, and ignored paths never get copies. */
  private isTrashCandidate(path: string): boolean {
    if (path === LOCAL_INDEX_STATE_PATH) return false;
    if (isIgnored(path, this.settings)) return false;
    return true;
  }

  // --- pure delegation ---------------------------------------------------------------

  readFile(path: string): Promise<Uint8Array> {
    return this.inner.readFile(path);
  }

  writeFile(path: string, data: Uint8Array): Promise<void> {
    return this.inner.writeFile(path, data);
  }

  renameFile(from: string, to: string): Promise<void> {
    return this.inner.renameFile(from, to);
  }

  listFiles(): Promise<readonly FileStat[]> {
    return this.inner.listFiles();
  }

  listDirs(): Promise<readonly string[]> {
    return this.inner.listDirs();
  }

  ensureDir(path: string): Promise<void> {
    return this.inner.ensureDir(path);
  }

  exists(path: string): Promise<boolean> {
    return this.inner.exists(path);
  }
}

/** `20260820T142315.123Z` — sortable, filesystem-safe, UTC. */
export function formatTrashTimestamp(epochMs: number): string {
  const date = new Date(epochMs);
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0');
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}` +
    `.${pad(date.getUTCMilliseconds(), 3)}Z`
  );
}
