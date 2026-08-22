/**
 * Three-way reconciliation (ARCHITECTURE.md §8 step 4).
 *
 * `computeSyncPlan` is a PURE, DETERMINISTIC function: the same inputs always
 * produce the same plan (manifest and change buckets are re-sorted
 * internally; `now` is a parameter, never read from a clock). It compares
 * three states for every path:
 *
 *   - the **local index** — what this device last knew as authoritative
 *     (the "common ancestor" of the three-way merge);
 *   - the **local changes** — how local storage diverged from the index
 *     while offline (`scan.ts` output);
 *   - the **manifest** — the authority's current head per path.
 *
 * and emits a `SyncPlan` (shape documented on the interface): ops to push,
 * ops to pull, conflict resolutions, and folder placeholders to push.
 *
 * Conflict arbitration mirrors the DO's rule (§4): winner = higher logical
 * clock; tie → greater deviceId. The local side's *tentative* clock is
 * `nextClock(index clock, thisDeviceId)` — exactly the counter the DO would
 * assign a commit building on the same parent, so the client's prediction
 * matches the server's arbitration. When the remote side wins, the losing
 * local content is preserved by pushing it to a conflict-copy path
 * (`conflictnames.ts`); when the local side wins, the client simply commits
 * with its (now stale) parent version and lets the server arbitrate — the
 * server synthesizes any conflict copy for the losing remote content, which
 * arrives later as an ordinary change event.
 */

import { compareClocks, nextClock } from './clock.js';
import { conflictCopyPath } from './conflictnames.js';
import type { LocalIndex, LocalIndexEntry } from './localindex.js';
import { parentPath } from './paths.js';
import type { ManifestEntry } from './protocol.js';
import type { DeletedCandidate, LocalChanges, RenameCandidate, ScanCandidate } from './scan.js';
import type { LogicalClock } from './types.js';

/**
 * A manifest entry as reconciliation consumes it. Since `ManifestEntry` grew
 * `path`, `clock`, and `isFolder` (protocol v1, pre-release), this is now the
 * manifest entry itself — kept as a named alias so `computeSyncPlan`'s input
 * contract stays self-documenting.
 */
export type RemoteFile = ManifestEntry;

/** Input to `computeSyncPlan`. */
export interface SyncPlanInput {
  localChanges: LocalChanges;
  index: LocalIndex;
  manifest: readonly RemoteFile[];
  thisDeviceId: string;
  /** Human-readable name of this device — used in conflict-copy file names. */
  thisDeviceName: string;
  /** Epoch ms used for conflict-copy timestamps (passed in for determinism). */
  now: number;
}

/** Why a path went through conflict resolution. */
export type ConflictReason = 'concurrent-edit' | 'add-vs-add' | 'delete-vs-edit' | 'rename-race';

/**
 * A commit this device should send (payload of a protocol `commit` message).
 *
 * `parentVersion` semantics:
 *   - local-only changes and local-wins conflicts name the *index* head (or
 *     `null` for brand-new paths) — deliberately stale when a conflict was
 *     predicted, so the DO arbitrates and preserves the losing remote
 *     content server-side;
 *   - conflict-copy pushes name the *remote* head (fast-path: they build on
 *     the winner and must not re-conflict).
 */
export interface PushFileOp {
  kind: 'add' | 'edit' | 'delete' | 'restore' | 'conflictCopy';
  path: string;
  parentVersion: string | null;
  /** Content hash; delete ops reuse the deleted content's hash. */
  hash: string;
  size: number;
  /** True for folder-tombstone deletes (`hash ''`, size 0) — FR-10 lifecycle. */
  isFolder?: boolean;
}

/** A local rename to commit as one chain migration (FR-9). */
export interface PushRenameOp {
  kind: 'rename';
  fromPath: string;
  toPath: string;
  /** Version of the `fromPath` head this rename builds on. */
  parentVersion: string | null;
  hash: string;
  size: number;
}

export type PushOp = PushFileOp | PushRenameOp;

/** Remote content this device should fetch and materialize via `applyPull`. */
export interface PullFileOp {
  kind: 'add' | 'edit' | 'delete' | 'restore';
  path: string;
  hash: string;
  size: number;
  version: string;
  clock: LogicalClock;
  /** True for tombstones (kind `'delete'`). */
  deleted: boolean;
  /** True for empty-folder placeholder pulls (FR-10) — materialize with `ensureDir`. */
  isFolder?: boolean;
}

/** A remote rename to follow locally (detected by hash correlation). */
export interface PullRenameOp {
  kind: 'rename';
  fromPath: string;
  toPath: string;
  hash: string;
  size: number;
  version: string;
  clock: LogicalClock;
}

export type PullOp = PullFileOp | PullRenameOp;

/**
 * One arbitrated conflict. `loserContent` is `'none'` when the losing side
 * was a deletion (nothing to preserve). When the local content lost and had
 * content, `conflictCopyPath` names where the plan preserves it (the push
 * itself is in `SyncPlan.pushes` with kind `'conflictCopy'`).
 */
export interface ConflictOp {
  path: string;
  reason: ConflictReason;
  winner: 'local' | 'remote';
  loserContent: 'local' | 'remote' | 'none';
  conflictCopyPath?: string;
  remote: { version: string; hash: string; size: number; deleted: boolean; clock: LogicalClock };
  /** The tentative clock the local side was arbitrated with. */
  localClock: LogicalClock;
}

/**
 * The complete reconciliation result for one sync cycle. Ops are sorted by
 * target path (renames by `toPath`); the sole exception: within a pair of
 * pull targets differing only by name case, deletes sort before writes (see
 * `comparePullOps` — case-insensitive-filesystem safety). Every array may be
 * empty. `pushes` and
 * `pulls` are independent — a path appears at most once in each. Pushes are
 * NOT applied to the local index until the server acks them; pulls are
 * applied by `applyPull` (`engine.ts`).
 */
export interface SyncPlan {
  /** Commits to send, in order. */
  pushes: PushOp[];
  /** Remote changes to materialize, in order. */
  pulls: PullOp[];
  /** Conflicts that were arbitrated (informational; side effects live in pushes/pulls). */
  conflicts: ConflictOp[];
  /** Empty-folder placeholder paths to create remotely (FR-10). */
  folderPushes: string[];
}

/** Internal: a local candidate (added/modified/deleted) unified for resolution. */
interface LocalCandidate {
  path: string;
  kind: 'add' | 'edit' | 'restore' | 'delete';
  hash: string;
  size: number;
  /** Folder-placeholder deletions (`scan.folderDeletions`) resolve as tombstones. */
  isFolder?: boolean;
}

const ZERO_CLOCK: LogicalClock = { counter: 0, deviceId: '' };

/**
 * Compute the sync plan. See the module doc for the model and the op
 * semantics. Throws nothing on ordinary divergence — conflicts are data,
 * not errors.
 */
export function computeSyncPlan(input: SyncPlanInput): SyncPlan {
  const { localChanges, index, thisDeviceId, thisDeviceName, now } = input;
  const manifest = [...input.manifest].sort((a, b) => compareStrings(a.path, b.path));
  const manifestByPath = new Map(manifest.map((entry) => [entry.path, entry]));

  const pushes: PushOp[] = [];
  const pulls: PullOp[] = [];
  const conflicts: ConflictOp[] = [];

  // Every path the local side diverged on (scan buckets + both ends of renames).
  const localPaths = new Set<string>();
  for (const c of localChanges.added) localPaths.add(c.path);
  for (const c of localChanges.modified) localPaths.add(c.path);
  for (const d of localChanges.deleted) localPaths.add(d.path);
  for (const r of localChanges.renamed) {
    localPaths.add(r.from);
    localPaths.add(r.to);
  }
  for (const f of localChanges.folderDeletions) localPaths.add(f.path);

  // Paths already consumed by an earlier phase (rename correlation etc.).
  const consumed = new Set<string>();

  const pathExists = (path: string): boolean => path in index || manifestByPath.has(path);

  // --- Phase A: local renames ---------------------------------------------
  // Uncontested: one PushRenameOp. Contested (remote changed at either end):
  // decompose — the `from` side is resolved on its own (usually tombstoned
  // or pulled), the renamed content is placed at `to` through the generic
  // content machinery. Content is never lost either way.
  for (const rename of [...localChanges.renamed].sort((a, b) => compareStrings(a.from, b.from))) {
    const indexFrom = index[rename.from];
    const indexTo = index[rename.to];
    const remoteFrom = manifestByPath.get(rename.from);
    const remoteTo = manifestByPath.get(rename.to);

    const fromChanged = remoteFrom
      ? remoteEntryChanged(indexFrom, remoteFrom)
      : indexFrom?.deletedAt === undefined; // absent remotely + live locally ⇒ changed
    const toChanged = remoteTo
      ? remoteEntryChanged(indexTo, remoteTo)
      : false; // absent remotely ⇒ nothing to race at `to`

    if (!fromChanged && !toChanged) {
      pushes.push({
        kind: 'rename',
        fromPath: rename.from,
        toPath: rename.to,
        parentVersion: indexFrom?.versionId ?? null,
        hash: rename.hash,
        size: rename.size,
      });
      continue;
    }

    // `from` side of a contested rename:
    if (!fromChanged) {
      // Nothing remote there — the move itself removes the old path.
      if (indexFrom && indexFrom.deletedAt === undefined) {
        pushes.push({
          kind: 'delete',
          path: rename.from,
          parentVersion: indexFrom.versionId,
          hash: indexFrom.hash,
          size: indexFrom.size,
        });
      }
    } else if (!remoteFrom || remoteFrom.deleted) {
      // Remote deleted (or migrated away from) `from` — deletion stands for
      // the old path; the renamed content survives at `to`.
      pulls.push(
        pullFile('delete', rename.from, {
          hash: remoteFrom?.hash ?? indexFrom?.hash ?? rename.hash,
          size: remoteFrom?.size ?? indexFrom?.size ?? rename.size,
          version: remoteFrom?.version ?? '',
          clock: remoteFrom?.clock ?? indexFrom?.clock ?? ZERO_CLOCK,
          deleted: true,
        }),
      );
    } else {
      // Remote edited `from`. The remote edit keeps the old path; the moved
      // content is placed at `to` below — a rename-race the local side
      // concedes unless its clock wins the rename push.
      const localClock = nextClock(indexFrom?.clock, thisDeviceId);
      if (compareClocks(remoteFrom.clock, localClock) > 0) {
        pulls.push(pullFile('edit', rename.from, remoteFrom));
        conflicts.push({
          path: rename.from,
          reason: 'rename-race',
          winner: 'remote',
          // Local content is preserved by the rename itself (pushed at `to`).
          loserContent: 'local',
          remote: remoteSummary(remoteFrom),
          localClock,
        });
      } else {
        pushes.push({
          kind: 'rename',
          fromPath: rename.from,
          toPath: rename.to,
          parentVersion: indexFrom?.versionId ?? null,
          hash: rename.hash,
          size: rename.size,
        });
        conflicts.push({
          path: rename.from,
          reason: 'rename-race',
          winner: 'local',
          loserContent: 'remote',
          remote: remoteSummary(remoteFrom),
          localClock,
        });
        continue; // the rename push carries the content; no `to` op needed
      }
    }

    // `to` side of a contested rename:
    if (!toChanged) {
      pushes.push({
        kind: indexTo?.deletedAt !== undefined ? 'restore' : 'add',
        path: rename.to,
        parentVersion: indexTo?.versionId ?? null,
        hash: rename.hash,
        size: rename.size,
      });
    } else {
      resolveContestedPath(rename.to, indexTo, remoteTo as RemoteFile, {
        path: rename.to,
        kind: indexTo?.deletedAt !== undefined ? 'restore' : 'add',
        hash: rename.hash,
        size: rename.size,
      });
    }
  }

  // --- Phase B: remote renames --------------------------------------------
  // A path live in the index but ABSENT from the manifest was migrated by the
  // authority (tombstones appear in the manifest with deleted:true — only a
  // rename removes a path). Correlate by content hash against new manifest
  // paths, same-parent preferred, smallest path within a preference class.
  for (const from of Object.keys(index)
    .filter((p) => {
      const entry = index[p] as LocalIndexEntry;
      return entry.deletedAt === undefined && !entry.isFolder;
    })
    .sort(compareStrings)) {
    if (localPaths.has(from) || consumed.has(from)) continue;
    if (manifestByPath.has(from)) continue; // present (live or tombstoned) ⇒ not migrated
    const entry = index[from] as LocalIndexEntry;

    let best: RemoteFile | undefined;
    let bestSameDir = false;
    for (const candidate of manifest) {
      if (candidate.deleted) continue;
      if (localPaths.has(candidate.path) || consumed.has(candidate.path)) continue;
      const known = index[candidate.path];
      if (known !== undefined && known.deletedAt === undefined) continue; // target not new
      if (candidate.hash !== entry.hash) continue;
      const sameDir = parentPath(candidate.path) === parentPath(from);
      if (best === undefined) {
        best = candidate;
        bestSameDir = sameDir;
      } else if (sameDir && !bestSameDir) {
        best = candidate;
        bestSameDir = true;
      }
    }

    if (best) {
      pulls.push({
        kind: 'rename',
        fromPath: from,
        toPath: best.path,
        hash: best.hash,
        size: best.size,
        version: best.version,
        clock: best.clock,
      });
      consumed.add(from);
      consumed.add(best.path);
    } else {
      // Absent without correlation: the authority no longer knows the path.
      // Treat as a remote delete with unknown head version ('' — the next
      // full manifest heals the version id). This also covers remote
      // rename+edit, which genuinely is delete + add.
      pulls.push(
        pullFile('delete', from, {
          hash: entry.hash,
          size: entry.size,
          version: '',
          clock: entry.clock,
          deleted: true,
        }),
      );
      consumed.add(from);
    }
  }

  // --- Phase C: remaining remote-only changes -----------------------------
  for (const remote of manifest) {
    if (localPaths.has(remote.path) || consumed.has(remote.path)) continue;
    const entry = index[remote.path];
    if (!remoteEntryChanged(entry, remote)) continue;
    if (entry === undefined) {
      if (!remote.deleted) {
        pulls.push(pullFile('add', remote.path, remote));
        consumed.add(remote.path);
      }
      // deleted + never known locally ⇒ nothing to do
      continue;
    }
    if (remote.deleted) {
      pulls.push(pullFile('delete', remote.path, remote)); // includes tombstone→tombstone version catch-up
    } else if (entry.deletedAt !== undefined) {
      pulls.push(pullFile('restore', remote.path, remote));
    } else {
      pulls.push(pullFile('edit', remote.path, remote));
    }
    consumed.add(remote.path);
  }

  // --- Phase D: local candidates (local-only pushes + both-changed) -------
  const candidates: LocalCandidate[] = [
    ...localChanges.added.map((c) => ({ ...c, kind: 'add' as const })),
    ...localChanges.modified.map((c) => ({
      ...c,
      kind: index[c.path]?.deletedAt !== undefined ? ('restore' as const) : ('edit' as const),
    })),
    ...localChanges.deleted.map((d): LocalCandidate => ({ ...d, kind: 'delete' })),
    // Folder placeholders whose directory vanished: tombstone pushes. They
    // carry no content (hash ''/size 0) and can never pair with an add, so
    // they join here rather than the `deleted` bucket (rename correlation,
    // conflict copies — neither applies to placeholders).
    ...localChanges.folderDeletions.map(
      (f): LocalCandidate => ({
        path: f.path,
        kind: 'delete',
        hash: '',
        size: 0,
        isFolder: true,
      }),
    ),
  ].sort((a, b) => compareStrings(a.path, b.path));

  for (const candidate of candidates) {
    const entry = index[candidate.path];
    const remote = manifestByPath.get(candidate.path);
    const remoteChangedHere =
      remote !== undefined && (entry !== undefined ? remote.version !== entry.versionId : !remote.deleted);
    if (!remoteChangedHere) {
      pushLocal(candidate, entry);
    } else {
      resolveContestedPath(candidate.path, entry, remote as RemoteFile, candidate);
    }
  }

  return {
    pushes: pushes.sort((a, b) => compareStrings(opPath(a), opPath(b))),
    pulls: pulls.sort(comparePullOps),
    conflicts: conflicts.sort((a, b) => compareStrings(a.path, b.path)),
    folderPushes: [...localChanges.emptyFolders].sort(compareStrings),
  };

  // --- helpers (close over the accumulators) ------------------------------

  function pushLocal(candidate: LocalCandidate, entry: LocalIndexEntry | undefined): void {
    if (candidate.kind === 'delete') {
      pushes.push({
        kind: 'delete',
        path: candidate.path,
        parentVersion: entry?.versionId ?? null,
        hash: entry?.hash ?? candidate.hash,
        size: entry?.size ?? candidate.size,
        ...(candidate.isFolder ? { isFolder: true } : {}),
      });
      return;
    }
    pushes.push({
      kind: candidate.kind,
      path: candidate.path,
      parentVersion: entry?.versionId ?? null,
      hash: candidate.hash,
      size: candidate.size,
    });
  }

  /**
   * Both sides changed one path. Arbitrate per §4. Local deletions never get
   * a conflict copy (no content to preserve); local *content* that loses is
   * preserved via a conflict-copy push.
   */
  function resolveContestedPath(
    path: string,
    entry: LocalIndexEntry | undefined,
    remote: RemoteFile,
    local: LocalCandidate,
  ): void {
    const localClock = nextClock(entry?.clock, thisDeviceId);
    const remoteWins = compareClocks(remote.clock, localClock) > 0; // 0 ⇒ local (documented)
    const summary = remoteSummary(remote);
    const reason: ConflictReason =
      local.kind === 'delete' || remote.deleted
        ? 'delete-vs-edit'
        : entry === undefined
          ? 'add-vs-add'
          : 'concurrent-edit';

    if (local.kind === 'delete' && remote.deleted) {
      // Both deleted — converge silently on the remote tombstone.
      pulls.push(pullFile('delete', path, remote));
      return;
    }

    if (local.kind === 'delete') {
      // Local delete vs remote edit.
      if (remoteWins) {
        pulls.push(pullFile('edit', path, remote)); // file is recreated
        conflicts.push({
          path, reason, winner: 'remote', loserContent: 'none',
          remote: summary, localClock,
        });
      } else {
        pushes.push({
          kind: 'delete',
          path,
          parentVersion: entry?.versionId ?? null,
          hash: entry?.hash ?? local.hash,
          size: entry?.size ?? local.size,
          ...(local.isFolder ? { isFolder: true } : {}),
        });
        conflicts.push({
          path, reason, winner: 'local', loserContent: 'remote',
          remote: summary, localClock,
        });
      }
      return;
    }

    if (remote.deleted) {
      // Local edit vs remote delete.
      if (remoteWins) {
        pulls.push(pullFile('delete', path, remote));
        conflicts.push({
          path, reason, winner: 'remote', loserContent: 'local',
          conflictCopyPath: pushConflictCopy(path, local, remote),
          remote: summary, localClock,
        });
      } else {
        pushes.push({
          kind: local.kind,
          path,
          parentVersion: entry?.versionId ?? null,
          hash: local.hash,
          size: local.size,
        });
        conflicts.push({
          path, reason, winner: 'local', loserContent: 'none',
          remote: summary, localClock,
        });
      }
      return;
    }

    // Concurrent content (edit-vs-edit or add-vs-add).
    if (local.hash === remote.hash) {
      // Byte-identical content on both sides (a second device pairing over
      // files it already has, or both sides making the same edit): nothing
      // distinct to preserve, so no conflict record and no copy — converge
      // silently on the remote head regardless of clock order (mirrors the
      // server's arbitration, which synthesizes no copy for identical content).
      pulls.push(
        pullFile(entry?.deletedAt !== undefined ? 'restore' : entry === undefined ? 'add' : 'edit', path, remote),
      );
      return;
    }
    if (remoteWins) {
      pulls.push(
        pullFile(entry?.deletedAt !== undefined ? 'restore' : entry === undefined ? 'add' : 'edit', path, remote),
      );
      conflicts.push({
        path, reason, winner: 'remote', loserContent: 'local',
        conflictCopyPath: pushConflictCopy(path, local, remote),
        remote: summary, localClock,
      });
    } else {
      pushes.push({
        kind: local.kind,
        path,
        // Deliberately the (stale) index parent: the DO must arbitrate and
        // synthesize the conflict copy for the losing remote content.
        parentVersion: entry?.versionId ?? null,
        hash: local.hash,
        size: local.size,
      });
      conflicts.push({
        path, reason, winner: 'local', loserContent: 'remote',
        remote: summary, localClock,
      });
    }
  }

  /**
   * Push the losing local content to a conflict-copy path; returns the path,
   * or `undefined` when the losing content is byte-identical to the winner's
   * (a same-content race — nothing distinct to preserve; matches the server's
   * arbitration, which likewise synthesizes no copy for identical content).
   */
  function pushConflictCopy(path: string, local: LocalCandidate, remote: RemoteFile): string | undefined {
    if (local.hash === remote.hash) return undefined;
    const copyPath = conflictCopyPath(path, thisDeviceName, now, pathExists);
    pushes.push({
      kind: 'conflictCopy',
      path: copyPath,
      // Build on the winning remote head: this push must fast-path.
      parentVersion: remote.version,
      hash: local.hash,
      size: local.size,
    });
    return copyPath;
  }
}

// --- module-level helpers ---------------------------------------------------

function pullFile(
  kind: PullFileOp['kind'],
  path: string,
  remote: Pick<RemoteFile, 'hash' | 'size' | 'version' | 'clock' | 'isFolder'> & {
    deleted?: boolean;
  },
): PullFileOp {
  return {
    kind,
    path,
    hash: remote.hash,
    size: remote.size,
    version: remote.version,
    clock: remote.clock,
    deleted: remote.deleted ?? kind === 'delete',
    ...(remote.isFolder ? { isFolder: true } : {}),
  };
}

function remoteSummary(remote: RemoteFile): ConflictOp['remote'] {
  return {
    version: remote.version,
    hash: remote.hash,
    size: remote.size,
    deleted: remote.deleted,
    clock: remote.clock,
  };
}

/**
 * Whether the remote head for a path differs from what the index records.
 * Version ids are the primary signal (client and DO share one id space);
 * a path absent remotely counts as changed only while the index still holds
 * it live — callers decide what absence *means* (rename vs delete).
 */
function remoteEntryChanged(
  entry: LocalIndexEntry | undefined,
  remote: RemoteFile | undefined,
): boolean {
  if (remote === undefined) return false;
  if (entry === undefined) return !remote.deleted;
  return remote.version !== entry.versionId;
}

function opPath(op: PushOp | PullOp): string {
  return op.kind === 'rename' ? op.toPath : op.path;
}

/**
 * Deterministic pull order (by target path), with ONE carve-out for
 * case-insensitive filesystems (Windows, macOS): when two pull targets
 * differ only by name case — e.g. a rename+edit that decomposed into
 * `pull add '/NOTE.md'` + `pull delete '/Note.md'` — the DELETE must apply
 * first. Applied add-first, the add's atomic temp+rename write physically
 * replaces the old-case file, and the subsequent delete then finds and
 * removes the just-written file (adapters resolve paths case-insensitively),
 * leaving disk empty while the index holds the new path live — the next scan
 * would push that phantom deletion vault-wide. Delete-first is safe on both
 * filesystem classes: on a case-sensitive adapter the two paths are distinct
 * files, so relative order does not matter; only the case-colliding pair is
 * reordered, every other pair keeps the exact-path sort.
 */
function comparePullOps(a: PullOp, b: PullOp): number {
  const byExact = compareStrings(opPath(a), opPath(b));
  if (byExact === 0) return 0;
  if (opPath(a).toLowerCase() !== opPath(b).toLowerCase()) return byExact;
  // Case-colliding pair: deletes before writes (add/edit/rename/restore).
  const aDeletes = a.kind === 'delete';
  const bDeletes = b.kind === 'delete';
  if (aDeletes !== bDeletes) return aDeletes ? -1 : 1;
  return byExact;
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
