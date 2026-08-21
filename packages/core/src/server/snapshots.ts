/**
 * Vault-level snapshot planning (whole-vault, point-in-time restore).
 *
 * Like `arbitrate.ts`, this module is pure and storage-agnostic: both server
 * implementations (the Durable Object and the in-memory test double) build
 * snapshot heads and diff restore plans here, so the two provably agree.
 *
 * A restore is N synthetic commits, one per diverged path. Each commit
 * parents on the path's CURRENT head, so arbitration always takes the
 * fast path — no conflicts, no conflict copies, a deterministic overwrite.
 * Restored content references blobs that already exist: versions (and their
 * refcounted blobs) are kept forever, so a snapshot's content is always
 * recoverable byte-for-byte.
 */

import type { ArbitrationCommit, ArbitrationFileState, ArbitrationState } from './arbitrate.js';
import type { VersionKind } from '../types.js';

/**
 * One path's captured head state — the persisted `heads` JSON of a snapshot
 * row. Enough to reconstruct the head exactly (content hash, tombstone flag,
 * folder placeholder) without the version table.
 */
export interface SnapshotHeadRecord {
  version: string;
  hash: string;
  size: number;
  deleted: boolean;
  kind: VersionKind;
  isFolder?: boolean;
}

/**
 * Capture every current head as a snapshot's `heads` record. Takes only the
 * file map (the DO can answer from its `files` table without loading the
 * whole `versions` history).
 */
export function snapshotHeadsOf(
  files: ReadonlyMap<string, ArbitrationFileState>,
): Record<string, SnapshotHeadRecord> {
  const heads: Record<string, SnapshotHeadRecord> = {};
  for (const [path, file] of files) {
    heads[path] = {
      version: file.head.id,
      hash: file.head.hash,
      size: file.head.size,
      deleted: file.deleted,
      kind: file.head.kind,
      ...(file.isFolder === true ? { isFolder: true } : {}),
    };
  }
  return heads;
}

/** One diverged path in a restore plan. */
export interface SnapshotRestoreItem {
  path: string;
  /** Synthetic fast-path commit (see module doc). */
  commit: ArbitrationCommit;
  /** True when the snapshot's state for this path is a tombstone (or absence). */
  tombstone: boolean;
}

/**
 * Diff snapshot heads against the current state and plan the restore commits,
 * path-sorted for deterministic version-id minting. Paths whose effective head
 * state already matches the snapshot are skipped: same deleted flag and
 * folder-ness always, and — for live paths — the same hash/size. A
 * tombstone's recorded hash/size is bookkeeping (the content that particular
 * delete preserved), not effective state, so a path deleted both now and at
 * the snapshot is a match regardless of which delete recorded it
 * (delete→restore→re-delete chains).
 */
export function planSnapshotRestore(
  state: ArbitrationState,
  heads: Readonly<Record<string, SnapshotHeadRecord>>,
): SnapshotRestoreItem[] {
  const paths = new Set<string>([...Object.keys(heads), ...state.files.keys()]);
  const items: SnapshotRestoreItem[] = [];
  for (const path of [...paths].sort()) {
    const snap = heads[path];
    const current = state.files.get(path);

    if (snap === undefined) {
      // Created after the snapshot: live now → tombstone it (delete shape —
      // the hash/size of the content being deleted, like every client
      // delete). Already tombstoned or migrated away ⇒ matches the
      // snapshot's absence; nothing to do.
      if (current === undefined || current.deleted) continue;
      items.push({
        path,
        commit: {
          path,
          parentVersion: current.head.id,
          hash: current.head.hash,
          size: current.head.size,
          kind: 'delete',
        },
        tombstone: true,
      });
      continue;
    }

    if (current === undefined) {
      // Chain gone entirely (renamed away after the snapshot): invisible
      // both ways for a tombstone, resurrect the content otherwise.
      if (snap.deleted) continue;
      items.push({
        path,
        commit: {
          path,
          parentVersion: null,
          hash: snap.hash,
          size: snap.size,
          kind: 'restore',
          ...(snap.isFolder === true ? { isFolder: true } : {}),
        },
        tombstone: false,
      });
      continue;
    }

    const matchesSnapshot =
      current.deleted === snap.deleted &&
      // Tombstoned paths match on the flag alone: the recorded hash/size is
      // bookkeeping, not effective state (only folder-ness still matters).
      (current.deleted || (current.head.hash === snap.hash && current.head.size === snap.size)) &&
      (current.isFolder === true) === (snap.isFolder === true);
    if (matchesSnapshot) continue;

    if (snap.deleted) {
      // Live now, tombstoned at the snapshot: restore the tombstone (the
      // delete shape again — hash/size from the snapshot record, the content
      // that tombstone preserved).
      items.push({
        path,
        commit: {
          path,
          parentVersion: current.head.id,
          hash: snap.hash,
          size: snap.size,
          kind: 'delete',
          ...(snap.isFolder === true ? { isFolder: true } : {}),
        },
        tombstone: true,
      });
      continue;
    }

    items.push({
      path,
      commit: {
        path,
        parentVersion: current.head.id,
        hash: snap.hash,
        size: snap.size,
        kind: 'restore',
        ...(snap.isFolder === true ? { isFolder: true } : {}),
      },
      tombstone: false,
    });
  }
  return items;
}
