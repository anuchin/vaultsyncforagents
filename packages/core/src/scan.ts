/**
 * Local change detection (ARCHITECTURE.md §8 step 3).
 *
 * `scanVault` walks the storage adapter, applies the shared ignore rules,
 * hashes every non-ignored file (sha256 — same as blob addressing) and diffs
 * the result against the client's `LocalIndex`. The diff classifies:
 *
 *   - `added`    — file present, path unknown to the index;
 *   - `modified` — file present, content hash differs from the index entry.
 *                  A file whose index entry is a *tombstone* also lands here
 *                  (documented decision): whether it is an edit-of-deleted
 *                  or a pure resurrect, the resolution is identical — local
 *                  content exists that the index head does not reflect;
 *   - `deleted`  — index entry live, file gone;
 *   - `renamed`  — a delete + add pair *within one scan* whose content
 *                  hashes match (ARCHITECTURE §4 rename correlation). A
 *                  rename whose content also changed (rename + edit) no
 *                  longer correlates and falls back to delete + add — that
 *                  is the documented, correct v1 behavior;
 *   - `emptyFolders` — directories existing in storage but represented
 *                  neither by a live folder placeholder in the index nor by
 *                  any file beneath them (FR-10).
 *
 * The function takes `now` and the ignore settings as parameters (no hidden
 * clocks, no ambient config) and returns deterministically ordered results
 * (every bucket sorted by path; renames by `from`).
 */

import type { FileStat, StorageAdapter } from './adapters.js';
import { sha256Hex } from './hashing.js';
import { isIgnored, type IgnoreSettings } from './ignore.js';
import type { LocalIndex } from './localindex.js';
import { parentPath } from './paths.js';

/** A local content change for a path that exists in storage. */
export interface ScanCandidate {
  path: string;
  hash: string;
  size: number;
}

/** A local deletion: carries the index's version so the tombstone commit names its parent. */
export interface DeletedCandidate {
  path: string;
  /** Hash of the content as last synced (tombstones reuse it). */
  hash: string;
  size: number;
  /** Version id the deletion commit builds on. */
  versionId: string;
}

/** A detected rename: same content hash moved from `from` to `to`. */
export interface RenameCandidate {
  from: string;
  to: string;
  hash: string;
  size: number;
}

/** The full result of one local scan. All buckets sorted by path. */
export interface LocalChanges {
  /** The `now` passed in — when this scan conceptually happened. */
  scannedAt: number;
  added: ScanCandidate[];
  modified: ScanCandidate[];
  deleted: DeletedCandidate[];
  renamed: RenameCandidate[];
  /** Empty-folder paths to push as placeholder entries (FR-10). */
  emptyFolders: string[];
}

/**
 * Scan the vault and diff it against the index.
 *
 * Every non-ignored file is read and hashed on every scan in v1; using
 * size/mtime as a hash shortcut is a later optimization (correctness first:
 * external edits can preserve mtime).
 */
export async function scanVault(
  storage: StorageAdapter,
  index: LocalIndex,
  settings: IgnoreSettings,
  now: number,
): Promise<LocalChanges> {
  const files = await storage.listFiles();

  const kept: FileStat[] = [];
  for (const file of files) {
    if (!isIgnored(file.path, settings)) kept.push(file);
  }
  const keptPaths = new Set(kept.map((f) => f.path));

  const added: ScanCandidate[] = [];
  const modified: ScanCandidate[] = [];

  for (const file of kept) {
    const entry = index[file.path];
    const hash = await sha256Hex(await storage.readFile(file.path));
    if (entry === undefined) {
      added.push({ path: file.path, hash, size: file.size });
      continue;
    }
    if (entry.isFolder) {
      // A real file replaced a folder placeholder: treat as content change.
      modified.push({ path: file.path, hash, size: file.size });
      continue;
    }
    // Tombstoned entry with the file back ⇒ modified (resurrect or
    // edit-of-deleted — both resolve the same way downstream).
    if (entry.deletedAt !== undefined || entry.hash !== hash) {
      modified.push({ path: file.path, hash, size: file.size });
    }
  }

  const deleted: DeletedCandidate[] = [];
  for (const [path, entry] of Object.entries(index)) {
    if (entry.isFolder) continue; // folder placeholders never produce file deletions
    if (entry.deletedAt !== undefined) continue; // already tombstoned
    if (keptPaths.has(path)) continue;
    if (isIgnored(path, settings)) {
      // The path became ignored (settings change) — not a deletion.
      continue;
    }
    deleted.push({ path, hash: entry.hash, size: entry.size, versionId: entry.versionId });
  }

  const { renamed, deleted: unmatchedDeleted, added: unmatchedAdded } = detectRenames(deleted, added);
  const emptyFolders = await detectEmptyFolders(storage, index, settings, files);

  return {
    scannedAt: now,
    added: sortCandidates(unmatchedAdded),
    modified: sortCandidates(modified),
    deleted: [...unmatchedDeleted].sort(byPath),
    renamed: [...renamed].sort((a, b) => byPath(a, b)),
    emptyFolders,
  };
}

/**
 * Correlate delete + add pairs by content hash (ARCHITECTURE §4).
 *
 * One-to-one matching, most deterministic wins: when several unmatched adds
 * share the deleted side's hash, prefer an add in the same parent directory;
 * within a preference class, the lexicographically smallest `to` path wins.
 * Matched pairs leave the delete/add buckets and become `renamed`.
 */
function detectRenames(
  deleted: readonly DeletedCandidate[],
  added: readonly ScanCandidate[],
): {
  renamed: RenameCandidate[];
  deleted: DeletedCandidate[];
  added: ScanCandidate[];
} {
  const addsByHash = new Map<string, ScanCandidate[]>();
  for (const candidate of [...added].sort(byPath)) {
    const bucket = addsByHash.get(candidate.hash);
    if (bucket) bucket.push(candidate);
    else addsByHash.set(candidate.hash, [candidate]);
  }

  const usedAdds = new Set<string>();
  const renamed: RenameCandidate[] = [];
  const unmatchedDeleted: DeletedCandidate[] = [];

  for (const deletion of [...deleted].sort(byPath)) {
    const candidates = addsByHash.get(deletion.hash) ?? [];
    let fallback: ScanCandidate | undefined;
    let sameDir: ScanCandidate | undefined;
    for (const candidate of candidates) {
      if (usedAdds.has(candidate.path)) continue;
      if (parentPath(candidate.path) === parentPath(deletion.path)) {
        sameDir ??= candidate; // sorted ⇒ first is smallest
      } else {
        fallback ??= candidate;
      }
    }
    const match = sameDir ?? fallback;
    if (match) {
      usedAdds.add(match.path);
      renamed.push({ from: deletion.path, to: match.path, hash: deletion.hash, size: deletion.size });
    } else {
      unmatchedDeleted.push(deletion);
    }
  }

  return {
    renamed,
    deleted: unmatchedDeleted,
    added: added.filter((candidate) => !usedAdds.has(candidate.path)),
  };
}

/**
 * Directories that exist in storage but are represented neither by a live
 * folder placeholder in the index nor by any file (ignored or not) beneath
 * them. A directory containing only ignored files is therefore *not* empty —
 * it is represented by those files as far as the local machine is concerned.
 */
async function detectEmptyFolders(
  storage: StorageAdapter,
  index: LocalIndex,
  settings: IgnoreSettings,
  files: readonly FileStat[],
): Promise<string[]> {
  const representedDirs = new Set<string>();
  for (const file of files) {
    for (let dir = parentPath(file.path); dir !== '/'; dir = parentPath(dir)) {
      representedDirs.add(dir);
    }
  }

  const emptyFolders: string[] = [];
  for (const dir of await storage.listDirs()) {
    if (dir === '/') continue;
    if (representedDirs.has(dir)) continue;
    if (isIgnored(dir, settings)) continue;
    const entry = index[dir];
    if (entry?.isFolder && entry.deletedAt === undefined) continue; // already synced as placeholder
    emptyFolders.push(dir);
  }
  return emptyFolders.sort();
}

function sortCandidates(candidates: ScanCandidate[]): ScanCandidate[] {
  return [...candidates].sort(byPath);
}

function byPath<T extends { path?: string; from?: string }>(a: T, b: T): number {
  const keyA = a.path ?? a.from ?? '';
  const keyB = b.path ?? b.from ?? '';
  return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
}
