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
 * Pushes/conflicts/folder ops are the network phase's business; retry
 * queues are explicitly out of scope here.
 */

import type { StorageAdapter } from './adapters.js';
import { sha256Hex } from './hashing.js';
import {
  applyCommit,
  deserializeLocalIndex,
  LOCAL_INDEX_STATE_PATH,
  removeEntry,
  serializeLocalIndex,
  type LocalIndex,
} from './localindex.js';
import type { PullOp, SyncPlan } from './resolve.js';

/** Injected content transport: fetch the blob for a content hash. */
export type FetchBlob = (hash: string) => Promise<Uint8Array>;

export interface ApplyPullOptions {
  /** Epoch ms used for tombstone timestamps. Default: `Date.now()` — this
   *  function is I/O orchestration, not a pure function, but tests inject
   *  a fixed value for determinism. */
  now?: number;
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
  let working: LocalIndex = index;

  try {
    for (const pull of plan.pulls) {
      working = await applyOnePull(storage, working, pull, fetchBlob, now);
    }
  } catch (error) {
    try {
      await persistIndex(storage, working);
    } catch {
      // Persistence failure must not mask the original error; the caller
      // retries the whole cycle anyway.
    }
    throw error;
  }

  await persistIndex(storage, working);
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
    return applyCommit(removeEntry(index, pull.fromPath), {
      path: pull.toPath,
      versionId: pull.version,
      hash: pull.hash,
      size: pull.size,
      clock: pull.clock,
    });
  }

  if (pull.isFolder) {
    // Folder placeholders (FR-10): create the directory, record the entry.
    // Tombstoned placeholders record only — deleting a directory from storage
    // (and cascading to any files placed inside it) is a platform concern.
    if (!pull.deleted) await storage.ensureDir(pull.path);
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
    return applyCommit(index, {
      path: pull.path,
      versionId: pull.version,
      hash: pull.hash,
      size: pull.size,
      clock: pull.clock,
      deleted: true,
      deletedAt: now,
    });
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

async function persistIndex(storage: StorageAdapter, index: LocalIndex): Promise<void> {
  await storage.writeFile(
    LOCAL_INDEX_STATE_PATH,
    new TextEncoder().encode(serializeLocalIndex(index)),
  );
}

/**
 * Load the persisted index from storage (ARCHITECTURE §8 step 1). Throws
 * `ProtocolError` (via `deserializeLocalIndex`) on corrupt or future-schema
 * state — callers surface that instead of silently re-syncing from scratch.
 */
export async function loadLocalIndex(storage: StorageAdapter): Promise<LocalIndex> {
  const bytes = await storage.readFile(LOCAL_INDEX_STATE_PATH);
  return deserializeLocalIndex(new TextDecoder().decode(bytes));
}
