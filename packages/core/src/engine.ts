/**
 * Thin pull-side orchestration (ARCHITECTURE.md §8 step 5). NOT the network
 * client: all transport is injected (`fetchBlob`), which the later network
 * phase implements over `/blob/:hash` or WS-inline content.
 *
 * `applyPull` materializes every `PullOp` of a `SyncPlan` through the
 * storage adapter and updates the local index — durably and honestly:
 *
 *   - blobs are verified (sha256) before being written; a mismatch aborts
 *     the plan;
 *   - each index entry is recorded only *after* its storage write succeeded,
 *     so a mid-plan failure leaves the index describing exactly the files
 *     that actually landed (FR-5: nothing is silently lost — the unsynced
 *     pulls simply remain in the plan and are retried by the caller);
 *   - the index is persisted through the adapter's atomic `writeFile`
 *     (temp + rename per the adapter contract) at
 *     `/.vaultsyncforagents/state`, including on the failure path.
 *
 * Folder lifecycle (FR-10 and its deletion counterpart):
 *
 *   - applying a REMOTE FOLDER TOMBSTONE removes the local directory when
 *     it exists and is empty (adapter `removeDir`); non-empty or missing ⇒
 *     record the tombstone only — the directory converges later, and a
 *     non-empty directory is never deleted;
 *   - PRUNE-ON-DELETE: applying a remote file deletion (or rename away)
 *     removes the deleted path's parent directory when it is now empty on
 *     disk and holds no live file entries in the index — this is what stops
 *     an emptied directory from self-resurrecting as an empty-folder
 *     placeholder on the next scan. Exactly ONE level per deletion: the
 *     immediate parent only, never a cascade (a chain of emptied
 *     directories converges over successive cycles; the safety invariant —
 *     never delete a non-empty directory, never lose user content — is
 *     checked before every removal).
 *
 * Pushes/conflicts/folder ops are the network phase's business; retry
 * queues are explicitly out of scope here.
 */

import type { StorageAdapter } from './adapters.js';
import { sha256Hex } from './hashing.js';
import {
  applyCommit,
  deserializeLocalState,
  LOCAL_INDEX_STATE_PATH,
  removeEntry,
  serializeLocalIndex,
  type DeserializedLocalState,
  type LocalIndex,
  type PersistedSyncState,
} from './localindex.js';
import { isStrictlyBeneath, parentPath } from './paths.js';
import type { PullOp, SyncPlan } from './resolve.js';

/** Injected content transport: fetch the blob for a content hash. */
export type FetchBlob = (hash: string) => Promise<Uint8Array>;

export interface ApplyPullOptions {
  /** Epoch ms used for tombstone timestamps. Default: `Date.now()` — this
   *  function is I/O orchestration, not a pure function, but tests inject
   *  a fixed value for determinism. */
  now?: number;
  /**
   * Bulk-pull progress: called once with (0, total) up front and once after
   * each pull materializes. Pure reporting — never affects application.
   */
  onProgress?: (done: number, total: number) => void;
  /**
   * Sync-cursor bookkeeping to write into the state file's envelope whenever
   * this call persists the index. Without it a pull-side persist would strip
   * the client's cursor/syncedThrough fields from `/.vaultsyncforagents/state`
   * (the envelope is rewritten wholesale). The client passes its current
   * values; a snapshot a moment stale is harmless — the next persist refreshes
   * it, and an under-reported cursor only widens the next replay.
   */
  persistedState?: PersistedSyncState;
}

/**
 * Apply all pulls of `plan` and return the updated index (also persisted to
 * the adapter at `LOCAL_INDEX_STATE_PATH`).
 *
 * Storage writes happen in plan order. If any op fails, the index reflecting
 * every op that succeeded so far is persisted and the original error is
 * rethrown — paths that failed are absent from the returned/persisted index.
 */
export async function applyPull(
  storage: StorageAdapter,
  index: LocalIndex,
  plan: SyncPlan,
  fetchBlob: FetchBlob,
  options: ApplyPullOptions = {},
): Promise<LocalIndex> {
  const now = options.now ?? Date.now();
  const onProgress = options.onProgress;
  let working: LocalIndex = index;

  onProgress?.(0, plan.pulls.length);
  let done = 0;
  try {
    for (const pull of plan.pulls) {
      working = await applyOnePull(storage, working, pull, fetchBlob, now);
      done += 1;
      onProgress?.(done, plan.pulls.length);
    }
  } catch (error) {
    try {
      await persistIndex(storage, working, options.persistedState);
    } catch {
      // Persistence failure must not mask the original error; the caller
      // retries the whole cycle anyway.
    }
    throw error;
  }

  await persistIndex(storage, working, options.persistedState);
  return working;
}

async function applyOnePull(
  storage: StorageAdapter,
  index: LocalIndex,
  pull: PullOp,
  fetchBlob: FetchBlob,
  now: number,
): Promise<LocalIndex> {
  if (pull.kind === 'rename') {
    if (await storage.exists(pull.fromPath)) {
      await storage.renameFile(pull.fromPath, pull.toPath);
    } else {
      // Old path never materialized here (or already moved): fetch content.
      await fetchVerified(storage, pull.toPath, pull.hash, fetchBlob);
    }
    const moved = applyCommit(removeEntry(index, pull.fromPath), {
      path: pull.toPath,
      versionId: pull.version,
      hash: pull.hash,
      size: pull.size,
      clock: pull.clock,
    });
    // The last file may just have left its old parent directory (prune-on-
    // delete applies to moves too; the rename itself is untouched).
    await pruneParentOnDelete(storage, moved, pull.fromPath);
    return moved;
  }

  if (pull.isFolder) {
    // Folder placeholders (FR-10): create the directory, record the entry.
    // A folder TOMBSTONE additionally removes the local directory when it
    // exists and is empty; non-empty or missing ⇒ record only (converges
    // later — a non-empty directory is never deleted here).
    if (pull.deleted) {
      await removeDirIfVacant(storage, index, pull.path);
    } else {
      await storage.ensureDir(pull.path);
    }
    return applyCommit(index, {
      path: pull.path,
      versionId: pull.version,
      hash: pull.hash,
      size: pull.size,
      clock: pull.clock,
      deleted: pull.deleted,
      deletedAt: pull.deleted ? now : undefined,
      isFolder: true,
    });
  }

  if (pull.deleted) {
    // Idempotent per the adapter contract; a local .trash copy is a
    // platform-layer concern (daemon/plugin), not engine logic.
    await storage.deleteFile(pull.path);
    const tombstoned = applyCommit(index, {
      path: pull.path,
      versionId: pull.version,
      hash: pull.hash,
      size: pull.size,
      clock: pull.clock,
      deleted: true,
      deletedAt: now,
    });
    // Prune-on-delete: an emptied parent directory must not linger and
    // re-surface as an empty-folder placeholder on the next scan.
    await pruneParentOnDelete(storage, tombstoned, pull.path);
    return tombstoned;
  }

  const current = index[pull.path];
  if (
    current !== undefined &&
    current.deletedAt === undefined &&
    current.hash === pull.hash &&
    (await storage.exists(pull.path))
  ) {
    // Content already correct locally (e.g. version-id catch-up after a
    // rename elsewhere): record the authoritative head, skip fetch+write.
    // The existence check matters when the file was deleted locally since the
    // index was last written — recreating it is what the pull demands.
    return applyCommit(index, {
      path: pull.path,
      versionId: pull.version,
      hash: pull.hash,
      size: pull.size,
      clock: pull.clock,
    });
  }

  await fetchVerified(storage, pull.path, pull.hash, fetchBlob);
  return applyCommit(index, {
    path: pull.path,
    versionId: pull.version,
    hash: pull.hash,
    size: pull.size,
    clock: pull.clock,
  });
}

// --- folder lifecycle helpers (B: tombstone-apply, C: prune-on-delete) --------

/** Outcome of a prune attempt: the directory judged deletable, and whether it was. */
export interface PrunedDir {
  /** The directory that qualified for removal (the deleted path's parent). */
  dir: string;
  /** Whether `storage.removeDir` actually removed it (false when the adapter
   *  lacks the hook or refused — eligibility alone still suppresses a
   *  placeholder push for it, `client.ts`). */
  removed: boolean;
}

/**
 * Whether `dir` may be deleted without losing anything: it exists, nothing
 * (file or directory) lives beneath it in storage, and the index holds no
 * live file entry beneath it. The root is never deletable. This is the
 * never-delete-non-empty / never-lose-content invariant made explicit —
 * every directory removal in core goes through it.
 */
async function dirIsVacant(
  storage: StorageAdapter,
  index: LocalIndex,
  dir: string,
): Promise<boolean> {
  if (dir === '/') return false;
  if (!(await storage.exists(dir))) return false;
  for (const file of await storage.listFiles()) {
    if (isStrictlyBeneath(file.path, dir)) return false;
  }
  for (const child of await storage.listDirs()) {
    if (isStrictlyBeneath(child, dir)) return false;
  }
  for (const [path, entry] of Object.entries(index)) {
    if (entry.isFolder || entry.deletedAt !== undefined) continue;
    if (isStrictlyBeneath(path, dir)) return false;
  }
  return true;
}

/** Remove `dir` through the adapter when it is vacant. Missing/non-empty/unsupported ⇒ false. */
async function removeDirIfVacant(
  storage: StorageAdapter,
  index: LocalIndex,
  dir: string,
): Promise<boolean> {
  if (!(await dirIsVacant(storage, index, dir))) return false;
  return removeVacantDir(storage, dir);
}

async function removeVacantDir(storage: StorageAdapter, dir: string): Promise<boolean> {
  if (storage.removeDir === undefined) return false; // pre-hook adapters: record-only
  try {
    await storage.removeDir(dir);
    return true;
  } catch {
    // A refused or raced removal is record-only, never fatal and never data
    // loss — the tombstone is still recorded and state converges later.
    return false;
  }
}

/**
 * Prune-on-delete (C): after `deletedPath` was deleted (or renamed away),
 * remove its immediate parent directory when it is now empty on disk and
 * unrepresented by live index entries — exactly ONE level, no cascade.
 *
 * Returns the `PrunedDir` when the parent QUALIFIED for removal (whether or
 * not the adapter could perform it — callers use eligibility to suppress an
 * empty-folder placeholder push for that directory), `undefined` when the
 * parent was not deletable (non-empty, holds live entries, missing, or root).
 * Pure with respect to the index: never mutates it.
 */
export async function pruneParentOnDelete(
  storage: StorageAdapter,
  index: LocalIndex,
  deletedPath: string,
): Promise<PrunedDir | undefined> {
  const dir = parentPath(deletedPath);
  if (!(await dirIsVacant(storage, index, dir))) return undefined;
  return { dir, removed: await removeVacantDir(storage, dir) };
}

/** Download, verify, and write one blob. A hash mismatch aborts the plan. */
async function fetchVerified(
  storage: StorageAdapter,
  path: string,
  hash: string,
  fetchBlob: FetchBlob,
): Promise<void> {
  const bytes = await fetchBlob(hash);
  const actual = await sha256Hex(bytes);
  if (actual !== hash) {
    throw new Error(
      `Blob hash mismatch for ${JSON.stringify(path)}: expected ${hash}, got ${actual}`,
    );
  }
  await storage.writeFile(path, bytes);
}

async function persistIndex(
  storage: StorageAdapter,
  index: LocalIndex,
  state: PersistedSyncState = {},
): Promise<void> {
  await storage.writeFile(
    LOCAL_INDEX_STATE_PATH,
    new TextEncoder().encode(serializeLocalIndex(index, state)),
  );
}

/**
 * Load the persisted index AND its sync-cursor bookkeeping (the client's
 * startup path — the cursor powers delta-manifest reconnects). Throws
 * `ProtocolError` (via `deserializeLocalState`) on corrupt or future-schema
 * state — callers surface that instead of silently re-syncing from scratch.
 */
export async function loadLocalState(storage: StorageAdapter): Promise<DeserializedLocalState> {
  const bytes = await storage.readFile(LOCAL_INDEX_STATE_PATH);
  return deserializeLocalState(new TextDecoder().decode(bytes));
}

/**
 * Load the persisted index (ARCHITECTURE §8 step 1). Throws
 * `ProtocolError` (via `deserializeLocalIndex`) on corrupt or future-schema
 * state — callers surface that instead of silently re-syncing from scratch.
 */
export async function loadLocalIndex(storage: StorageAdapter): Promise<LocalIndex> {
  return (await loadLocalState(storage)).index;
}
