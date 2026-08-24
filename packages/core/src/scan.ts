/**
 * Local change detection (ARCHITECTURE.md §8 step 3).
 *
 * `scanVault` walks the storage adapter, applies the shared ignore rules,
 * hashes non-ignored files (sha256 — same as blob addressing) and diffs
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
 *                  any file beneath them (FR-10);
 *   - `folderDeletions` — live folder placeholder entries whose directory
 *                  no longer exists in storage: the user deleted an empty
 *                  folder (or prune-on-delete removed it, `engine.ts`), and
 *                  the deletion must propagate as a folder tombstone. The
 *                  bucket is SEPARATE from `deleted` on purpose: folder
 *                  placeholders carry no content hash, must never enter
 *                  rename correlation, and resolve as placeholders
 *                  (`isFolder`) downstream. A placeholder that merely became
 *                  ignored (settings change) is NOT a deletion — it is
 *                  skipped, exactly like ignored files.
 *   - `staleDirs` — directories whose index entry is a TOMBSTONED folder
 *                  placeholder while an EMPTY directory still exists on disk
 *                  AND the tombstone was authored by ANOTHER device: the
 *                  residue of a record-only tombstone application (an adapter
 *                  without `removeDir`, or a removal that lost a race). The
 *                  leftover is CONSISTENT with the (remote) deletion, so it
 *                  must NOT resurrect as "local wins": re-pushing it as an
 *                  empty-folder placeholder would undo a deletion the user
 *                  made and ping-pong it between devices forever (observed
 *                  end-to-end: A deletes → B records-only → B re-pushes →
 *                  A re-pulls). The entry stays tombstoned; the client retries
 *                  `removeDir` for these dirs each cycle (client.ts). If the
 *                  tombstone was authored by THIS device, or content exists
 *                  beneath the directory, this is genuine local recreation:
 *                  the dir lands in `emptyFolders` instead, restoring the
 *                  placeholder — local wins is correct there.
 *   - `caseCollisions` — live index entries whose path folds (case-insensibly
 *                  AND canonically — `foldKeyForPath`) to the same key as a
 *                  file present on disk under a DIFFERENT name: the invisible
 *                  twin of a fold-colliding pair (ARCHITECTURE §14). NEVER
 *                  deleted — emitting a tombstone would destroy the twin on
 *                  the server and on case-sensitive peers. Listed disk files
 *                  are canonicalized to NFC before diffing (macOS's NFD and
 *                  a Windows file of the same name are ONE synchronized path),
 *                  and where two disk entries fold to one canonical path the
 *                  deterministic loser lands in this bucket too. Surfaced as
 *                  a diagnostic only; the collision stays unresolved until a
 *                  human renames, and the server independently refuses to
 *                  admit a second live path sharing the key (§14).
  *   - `unsafePaths` — files and directories whose names are Windows-unsafe
  *                  (reserved device names, trailing dot/space — `paths.ts`).
  *                  Like case collisions they are never pushed and never
  *                  treated as deletions; surfaced as a diagnostic only.
  *   - `symlinks` — symbolic links anywhere in the vault (adapters that can
  *                  detect them — `StorageAdapter.listSymlinks`). Links are
  *                  never followed (a link may escape the vault or loop), so
  *                  nothing they occlude can appear in `listFiles`: every
  *                  live index entry AT or BENEATH a link is protected from
  *                  deletion inference, exactly like an ignored path, until
  *                  a human removes the link. Surfaced as a diagnostic only.
  *
 * ## The mtime+size pre-filter (fast mode, the default)
 *
 * Re-hashing a 50k-file vault at every app-open is a real battery cost, so
 * fast mode skips hashing a file whose `size` AND `mtime` (from the storage
 * adapter's `FileStat`) exactly match its live index entry — the recorded
 * hash carries forward as unchanged. A file is hashed when it has no entry,
 * the entry is a tombstone or folder placeholder, the size differs, or the
 * mtime differs or is unknown (legacy state, pulls, first scan). Rename
 * correlation is unaffected: the destination path of a rename always looks
 * 'added', so it is always hashed — content-preserving moves still pair.
 *
 * The tradeoff: fast mode trusts the filesystem not to change content while
 * preserving both size and mtime. For verification (`vsa doctor`, periodic
 * integrity checks) pass `{ mode: 'full' }` to re-hash everything.
 *
 * The function takes `now` and the ignore settings as parameters (no hidden
 * clocks, no ambient config) and returns deterministically ordered results
 * (every bucket sorted by path; renames by `from`).
 */

import type { FileStat, StorageAdapter } from './adapters.js';
import { sha256Hex } from './hashing.js';
import { isIgnored, type IgnoreSettings } from './ignore.js';
import type { LocalIndex, LocalIndexEntry } from './localindex.js';
import { foldKeyForPath, isStrictlyBeneath, isWindowsUnsafePath, parentPath } from './paths.js';

/** Injectable content hash (the default is sha256, same as blob addressing). */
export type HashFn = (bytes: Uint8Array) => Promise<string>;

/** Options for `scanVault`. */
export interface ScanVaultOptions {
  /**
   * `'fast'` (default): files whose size+mtime exactly match their live index
   * entry skip re-hashing. `'full'`: hash everything regardless — integrity
   * verification (`vsa doctor`, periodic checks).
   */
  mode?: 'fast' | 'full';
  /** Content hash override (tests count/inspect hashing). Default: sha256Hex. */
  hash?: HashFn;
  /**
   * Bulk-scan progress: called once with (0, total) before the walk and once
   * per file afterwards (`done` counts hashed AND fast-path-skipped files).
   * Pure reporting — never affects the scan's decisions.
   */
  onProgress?: (done: number, total: number) => void;
  /**
   * This device's id, when the caller is a syncing client. Sharpens the
   * tombstoned-placeholder rule (`staleDirs`): an EMPTY directory over a
   * tombstoned placeholder is the record-only residue of a REMOTE deletion
   * (never resurrected), but over a tombstone THIS device authored it means
   * the user re-created the folder here — restore it (push the placeholder).
   * Omitted (or non-folder scans): only the content test decides.
   */
  thisDeviceId?: string;
}

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

/**
 * A live folder placeholder whose directory vanished from storage: the
 * deletion must propagate as a folder tombstone (kind `'delete'`,
 * `isFolder: true`). Carries the placeholder's version id so the tombstone
 * commit names its parent; hash/size are the placeholder constants
 * (`''`/`0`) and are re-derived downstream rather than carried.
 */
export interface FolderDeletionCandidate {
  path: string;
  /** Version id of the placeholder head the tombstone commit builds on. */
  versionId: string;
}

/**
 * A file this scan actually read and hashed, with the stat observed at hash
 * time. Feeds `recordHashedFiles` so the NEXT fast scan can skip these files
 * (the mtime cache on the index entry). Files skipped by the pre-filter are,
 * by definition, not hashed and do not appear here.
 */
export interface HashedFile {
  path: string;
  hash: string;
  size: number;
  /** Epoch ms — the storage stat at hash time (`FileStat.mtime`). */
  mtime: number;
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
  /**
   * Live folder placeholders whose directory no longer exists in storage —
   * folder deletions to push as tombstones (kind `'delete'`, `isFolder`).
   */
  folderDeletions: FolderDeletionCandidate[];
  /**
   * Directories whose index entry is a TOMBSTONED folder placeholder while an
   * EMPTY directory still exists on disk (record-only tombstone application —
   * see the module doc). Omitted (not merely empty) when there are none, so
   * whole-object comparisons of `LocalChanges` stay stable for clean scans.
   */
  staleDirs?: string[];
  /**
   * Live index paths whose file is invisible on this filesystem because
   * another file differs from them only by name case (a case-colliding pair,
   * creatable from a case-sensitive client — ARCHITECTURE §14). The scan
   * never emits a deletion for these (the twin on disk must not be destroyed
   * by a tombstone push); the client surfaces them as a diagnostic
   * (`SyncClientStatus.caseCollisions`). Omitted when there are none.
   */
  caseCollisions?: string[];
  /**
   * Files and directories present in storage whose names cannot be synced:
   * Windows-reserved device names (CON, NUL, COM1-9, …) or segments ending
   * in `.`/` ` (`paths.ts`). They are never pushed (a Windows peer could
   * not materialize them), never hashed, and never treated as deletions of
   * their index entries; surfaced as a diagnostic
   * (`SyncClientStatus.skippedPaths`) until a human renames them. Omitted
   * when there are none.
   */
  unsafePaths?: string[];
  /**
   * Symbolic links detected anywhere in the vault (never followed — see
   * `StorageAdapter.listSymlinks`). Live index entries AT or BENEATH a link
   * are invisible to this scan (the link's target never enters `listFiles`)
   * yet are NOT deletions: they are protected like ignored paths. Surfaced
   * as a diagnostic (`SyncClientStatus.symlinks`) until a human removes the
   * link. Omitted when there are none (or the adapter cannot detect links).
   */
  symlinks?: string[];
  /** Every file the scan hashed (fast mode's skipped files are absent), sorted by path. */
  hashed: HashedFile[];
}

/**
 * Scan the vault and diff it against the index.
 *
 * In fast mode (the default) a file whose size and mtime both exactly match
 * its live index entry is NOT re-hashed — the recorded hash carries forward
 * as unchanged (see the module doc for the tradeoff and the `full` escape
 * hatch).
 */
export async function scanVault(
  storage: StorageAdapter,
  index: LocalIndex,
  settings: IgnoreSettings,
  now: number,
  options: ScanVaultOptions = {},
): Promise<LocalChanges> {
  const hashFn = options.hash ?? sha256Hex;
  const mode = options.mode ?? 'fast';
  const onProgress = options.onProgress;
  const thisDeviceId = options.thisDeviceId;

  const files = await storage.listFiles();

  // Canonicalize every listed path to NFC (the system's canonical form —
  // `paths.ts`): a macOS client listing `Cafe\u0301.md` (NFD) and a Windows
  // client listing `Café.md` (NFC) are ONE synchronized path, so the two
  // vaults converge instead of forking byte-distinct twins. READS keep the
  // raw disk name (on case-sensitive filesystems the raw form is the only
  // one that opens); every keyed structure (index diffs, buckets) uses the
  // canonical form. Two disk entries folding to the SAME canonical path
  // (real on ext4, impossible on case- or normalization-insensitive fs) are
  // a fold collision: the deterministic first (by raw name) syncs, the rest
  // are surfaced as diagnostics — never merged, never silently chosen.
  type CanonFile = { rawPath: string; canon: string; size: number; mtime: number };
  const canonFiles: CanonFile[] = [];
  const canonSeen = new Map<string, string>(); // canon → first raw (sorted input)
  const foldCollisionTwins: string[] = [];
  for (const file of [...files].sort((a, b) => compareStrings(a.path, b.path))) {
    const canon = canonVaultPath(file.path);
    if (canonSeen.has(canon)) {
      foldCollisionTwins.push(file.path);
      continue;
    }
    canonSeen.set(canon, file.path);
    canonFiles.push({ rawPath: file.path, canon, size: file.size, mtime: file.mtime });
  }

  // Symlink policy (see `StorageAdapter.listSymlinks`): links are never
  // followed, so content beneath a link simply does not appear in `files` —
  // which the deletion pass below would otherwise misread as "the user
  // deleted everything under the link" (the classic mount/link-drop mass
  // delete). Entries at/beneath a link are skipped exactly like ignored
  // paths, and the link itself is surfaced as a diagnostic.
  const symlinkPaths = ((await storage.listSymlinks?.()) ?? []).filter(
    (path) => !isIgnored(path, settings),
  );
  const beneathSymlink =
    symlinkPaths.length === 0
      ? () => false
      : (path: string) =>
          symlinkPaths.some((link) => path === link || isStrictlyBeneath(path, link));

  // Windows-unsafe names never enter the diff (nor the directory
  // representation walk below): they cannot be pushed, and emitting a
  // deletion or placeholder for them would churn against a server that
  // rejects the path. They surface as diagnostics instead.
  const unsafePaths: string[] = [];
  const syncable: CanonFile[] = [];
  for (const file of canonFiles) {
    if (isWindowsUnsafePath(file.canon)) unsafePaths.push(file.canon);
    else syncable.push(file);
  }

  const kept: CanonFile[] = [];
  for (const file of syncable) {
    if (!isIgnored(file.canon, settings)) kept.push(file);
  }
  const keptPaths = new Set(kept.map((f) => f.canon));

  const added: ScanCandidate[] = [];
  const modified: ScanCandidate[] = [];
  const hashed: HashedFile[] = [];

  onProgress?.(0, kept.length);
  let scanned = 0;
  for (const file of kept) {
    const entry = index[file.canon];
    if (mode === 'fast' && statMatchesEntry(entry, file)) {
      scanned += 1;
      onProgress?.(scanned, kept.length);
      continue; // size+mtime unchanged since the recorded hash — trust it
    }
    // Reads use the RAW disk name (the only one that opens on a
    // case-sensitive fs); the hash is keyed under the CANONICAL path.
    const hash = await hashFn(await storage.readFile(file.rawPath));
    hashed.push({ path: file.canon, hash, size: file.size, mtime: file.mtime });
    scanned += 1;
    onProgress?.(scanned, kept.length);
    if (entry === undefined) {
      added.push({ path: file.canon, hash, size: file.size });
      continue;
    }
    if (entry.isFolder) {
      // A real file replaced a folder placeholder: treat as content change.
      modified.push({ path: file.canon, hash, size: file.size });
      continue;
    }
    // Tombstoned entry with the file back ⇒ modified (resurrect or
    // edit-of-deleted — both resolve the same way downstream).
    if (entry.deletedAt !== undefined || entry.hash !== hash) {
      modified.push({ path: file.canon, hash, size: file.size });
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
    if (beneathSymlink(path)) {
      // Hidden behind a symlink — its content was never listed; not a deletion.
      continue;
    }
    deleted.push({ path, hash: entry.hash, size: entry.size, versionId: entry.versionId });
  }

  // Directories canonicalize too (before the fold-collision split, which
  // consumes the twin list).
  const rawDirs = await storage.listDirs();
  const canonDirsSeen = new Set<string>();
  const syncableDirs: string[] = [];
  for (const dir of rawDirs) {
    const canon = canonVaultPath(dir);
    if (canonDirsSeen.has(canon)) {
      foldCollisionTwins.push(dir);
      continue;
    }
    canonDirsSeen.add(canon);
    if (isWindowsUnsafePath(canon)) unsafePaths.push(canon);
    else syncableDirs.push(canon);
  }

  const { renamed, deleted: unmatchedDeleted, added: unmatchedAdded } = detectRenames(deleted, added);
  const { deleted: safeDeleted, caseCollisions } = splitFoldCollisions(
    unmatchedDeleted,
    keptPaths,
    new Set([...unmatchedAdded.map((c) => c.path), ...modified.map((c) => c.path), ...renamed.map((r) => r.to)]),
    foldCollisionTwins,
  );
  const { emptyFolders, staleDirs } = detectEmptyFolders(
    index,
    settings,
    syncable.map((f) => f.canon),
    syncableDirs,
    thisDeviceId,
  );
  const folderDeletions = detectFolderDeletions(index, settings, syncableDirs, beneathSymlink);

  return {
    scannedAt: now,
    added: sortCandidates(unmatchedAdded),
    modified: sortCandidates(modified),
    deleted: [...safeDeleted].sort(byPath),
    renamed: [...renamed].sort((a, b) => byPath(a, b)),
    emptyFolders,
    folderDeletions,
    // Omitted when empty (not `[]`) — see the field's doc.
    ...(staleDirs.length > 0 ? { staleDirs } : {}),
    ...(caseCollisions.length > 0 ? { caseCollisions } : {}),
    ...(unsafePaths.length > 0 ? { unsafePaths: unsafePaths.sort(compareStrings) } : {}),
    ...(symlinkPaths.length > 0 ? { symlinks: [...symlinkPaths].sort(compareStrings) } : {}),
    hashed: [...hashed].sort(byPath),
  };
}

/**
 * Fold-collision guard (ARCHITECTURE §14): an unmatched deletion whose path
 * folds (case + canonical form — `foldKeyForPath`) to a file PRESENT on disk
 * under a different name is not a deletion the user made — it is the
 * invisible twin of a fold-colliding pair (creatable from a case-sensitive
 * client, e.g. the Linux daemon). This filesystem shows only one directory
 * entry for both, so emitting the delete would push a tombstone that
 * destroys the twin server-side and on every case-sensitive peer. Instead
 * the path is surfaced as a `caseCollisions` diagnostic (never a deletion
 * push); the collision itself stays unresolved until a human renames one of
 * the pair (and since the protocol revision, a NEW colliding path is refused
 * by the server outright — this guard covers legacy pairs and reports).
 *
 * Also appended: `twins` — the losing raw names of fold-canonicalization
 * (two disk entries mapping to one canonical path); same human-visible
 * disease (only one can sync), same treatment (report, never touch).
 *
 * The guard deliberately runs AFTER rename correlation and skips twins that
 * this scan reports as added/modified/renamed-to: a case-only (or canonical)
 * rename the user performed on THIS device produces exactly that
 * delete+twin-changed shape, and its decomposition into delete+add is the
 * documented, correct behavior (applyPull orders case-colliding pulls
 * delete-first, `resolve.ts`). Only a twin that is otherwise UNCHANGED —
 * meaning it is a genuinely separate remote file this disk can only show one
 * of — suppresses the deletion.
 */
function splitFoldCollisions(
  deleted: readonly DeletedCandidate[],
  keptPaths: ReadonlySet<string>,
  changedPaths: ReadonlySet<string>,
  twins: readonly string[],
): { deleted: DeletedCandidate[]; caseCollisions: string[] } {
  const keptByFold = new Map<string, string>();
  for (const path of keptPaths) keptByFold.set(foldKeyForPath(path), path);
  const safeDeleted: DeletedCandidate[] = [];
  const caseCollisions: string[] = [...twins];
  for (const candidate of deleted) {
    const twin = keptByFold.get(foldKeyForPath(candidate.path));
    if (twin !== undefined && !changedPaths.has(twin)) {
      caseCollisions.push(candidate.path);
      continue;
    }
    safeDeleted.push(candidate);
  }
  return {
    deleted: safeDeleted,
    caseCollisions: [...new Set(caseCollisions)].sort(compareStrings),
  };
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The scan's canonical form for a listed path: NFC. Whole-path normalization
 * is equivalent to segment-wise here (`/` is ASCII), and it never throws —
 * raw names come from disk, and canonicalization must not be able to fail.
 */
function canonVaultPath(path: string): string {
  return path.normalize('NFC');
}

/**
 * Whether the file's stat exactly matches its live index entry — the fast
 * mode pre-filter. Requires a known recorded `mtime` (legacy entries and
 * pull-written entries have none ⇒ hashed, then recorded) and never fires
 * for tombstones (a resurrect must always surface) or folder placeholders.
 */
function statMatchesEntry(
  entry: LocalIndexEntry | undefined,
  file: { size: number; mtime: number },
): boolean {
  return (
    entry !== undefined &&
    entry.deletedAt === undefined &&
    entry.isFolder !== true &&
    entry.mtime !== undefined &&
    entry.mtime === file.mtime &&
    entry.size === file.size
  );
}

/**
 * Record a scan's hash observations into the index: for every live file
 * entry whose content hash matches what the scan hashed, cache the observed
 * mtime so the next fast scan can skip re-hashing it.
 *
 * Pure: returns a new index (or the input when nothing changes), never
 * mutates. The hash-match guard keeps the cache honest — an entry whose
 * hash no longer reflects the observation (e.g. a pull overwrote the path
 * mid-cycle) is left untouched and simply gets re-hashed next scan.
 * Entries never demote: `deletedAt`/`isFolder` entries are never patched.
 */
export function recordHashedFiles(
  index: LocalIndex,
  hashed: readonly HashedFile[],
): LocalIndex {
  let next: Record<string, LocalIndexEntry> | undefined;
  for (const observed of hashed) {
    const entry = index[observed.path];
    if (entry === undefined || entry.isFolder || entry.deletedAt !== undefined) continue;
    if (entry.hash !== observed.hash) continue;
    if (entry.mtime === observed.mtime) continue;
    next ??= { ...index };
    next[observed.path] = { ...entry, mtime: observed.mtime };
  }
  return next ?? index;
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
 * them — plus the tombstoned-placeholder special cases that make the
 * empty-folder lifecycle deletion-safe:
 *
 *   - TOMBSTONED placeholder + content beneath → `emptyFolders`: the user
 *     recreated the folder; restoring the placeholder ("local wins") is
 *     correct. The recreated FILES beneath surface through `added`/`modified`
 *     independently.
 *   - TOMBSTONED placeholder + EMPTY dir on disk:
 *       · tombstone authored by ANOTHER device (or author unknown) →
 *         `staleDirs`: the record-only residue of a remote deletion,
 *         consistent with the tombstone — never resurrected (re-pushing it as
 *         an empty folder is what made a peer-side deletion ping-pong
 *         forever). The client retries `removeDir` on these dirs.
 *       · tombstone authored by THIS device (`thisDeviceId`) →
 *         `emptyFolders`: my own deletion, yet a dir exists here now — the
 *         user re-created it locally; restore the placeholder.
 *
 * A directory containing only ignored files is *not* empty — it is
 * represented by those files as far as the local machine is concerned.
 */
function detectEmptyFolders(
  index: LocalIndex,
  settings: IgnoreSettings,
  files: readonly string[],
  dirs: readonly string[],
  thisDeviceId?: string,
): { emptyFolders: string[]; staleDirs: string[] } {
  const representedDirs = new Set<string>();
  for (const filePath of files) {
    for (let dir = parentPath(filePath); dir !== '/'; dir = parentPath(dir)) {
      representedDirs.add(dir);
    }
  }

  const emptyFolders: string[] = [];
  const staleDirs: string[] = [];
  for (const dir of dirs) {
    if (dir === '/') continue;
    if (isIgnored(dir, settings)) continue;
    const entry = index[dir];
    if (entry?.isFolder && entry.deletedAt === undefined) continue; // live placeholder — already synced
    if (entry?.isFolder && entry.deletedAt !== undefined) {
      // Tombstoned placeholder whose directory still exists. Content beneath
      // ⇒ genuine recreation. Empty ⇒ stale leftover of a record-only
      // tombstone application — UNLESS this device authored the tombstone
      // itself, in which case a present dir can only be local recreation.
      if (representedDirs.has(dir) || entry.clock.deviceId === thisDeviceId) {
        emptyFolders.push(dir);
      } else {
        staleDirs.push(dir);
      }
      continue;
    }
    if (representedDirs.has(dir)) continue; // represented by its files
    emptyFolders.push(dir);
  }
  return {
    emptyFolders: emptyFolders.sort(),
    staleDirs: staleDirs.sort(),
  };
}

/**
 * Live folder placeholder entries whose directory no longer exists in
 * storage — the folder was deleted locally (directly, or by prune-on-delete
 * emptying it). Emits one `FolderDeletionCandidate` per placeholder so the
 * resolve/commit path pushes a folder tombstone; already-tombstoned
 * placeholders and placeholders that merely became ignored are skipped.
 */
function detectFolderDeletions(
  index: LocalIndex,
  settings: IgnoreSettings,
  dirs: readonly string[],
  beneathSymlink: (path: string) => boolean = () => false,
): FolderDeletionCandidate[] {
  const present = new Set(dirs);
  const folderDeletions: FolderDeletionCandidate[] = [];
  for (const [path, entry] of Object.entries(index)) {
    if (!entry.isFolder) continue; // files are handled by the `deleted` bucket
    if (entry.deletedAt !== undefined) continue; // already tombstoned
    if (present.has(path)) continue; // directory still exists — no deletion
    if (isIgnored(path, settings)) continue; // settings change, not a deletion
    if (beneathSymlink(path)) continue; // hidden behind a symlink — never listed
    folderDeletions.push({ path, versionId: entry.versionId });
  }
  return folderDeletions.sort(byPath);
}

function sortCandidates(candidates: ScanCandidate[]): ScanCandidate[] {
  return [...candidates].sort(byPath);
}

function byPath<T extends { path?: string; from?: string }>(a: T, b: T): number {
  const keyA = a.path ?? a.from ?? '';
  const keyB = b.path ?? b.from ?? '';
  return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
}
