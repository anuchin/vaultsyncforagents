/**
 * The client's persisted sync state (ARCHITECTURE.md §8 step 1).
 *
 * A `LocalIndex` maps every vault path this client has ever synced to the
 * last version it *knows* was authoritative: content hash, size, the
 * server-assigned version id, and the version's logical clock. Entries with
 * `deletedAt` set are tombstones — the file was deleted (locally or
 * remotely) but the entry stays so the deletion is not resurrected by the
 * next scan and so rename correlation keeps working.
 *
 * The index is persisted inside the vault at `/.vaultsyncforagents/state`
 * (that directory is sync-ignored, see `ignore.ts`) through the storage
 * adapter, whose `writeFile` is atomic (temp + rename) by contract.
 *
 * All operations are pure: they return new objects and never mutate inputs.
 */

import type { LogicalClock } from './types.js';
import { ProtocolError } from './errors.js';

/** Current on-disk schema version. Bump + add migration on breaking changes. */
export const LOCAL_INDEX_SCHEMA_VERSION = 1;

/** Vault path where the client persists its local index. */
export const LOCAL_INDEX_STATE_PATH = '/.vaultsyncforagents/state';

/** One path's last-known-synced state. */
export interface LocalIndexEntry {
  /** sha256 hex of the content at `versionId`. */
  hash: string;
  /** Content size in bytes (`0` for folder placeholders). */
  size: number;
  /** Server-assigned version id this entry reflects. */
  versionId: string;
  /** Logical clock of `versionId` — used to predict conflict outcomes. */
  clock: LogicalClock;
  /** Present ⇒ tombstone: the path was deleted at this epoch ms. */
  deletedAt?: number;
  /**
   * True for empty-folder placeholder entries (FR-10). Folder entries carry
   * `hash: ''`, `size: 0`; the clock is that of the placeholder's version.
   */
  isFolder?: boolean;
}

/** The whole index: normalized vault path → entry. `{}` is a valid empty index. */
export type LocalIndex = Readonly<Record<string, LocalIndexEntry>>;

/** Versioned serialization envelope (schemaVersion enables future migration). */
export interface LocalIndexEnvelope {
  schemaVersion: number;
  entries: Record<string, LocalIndexEntry>;
}

/** One authoritative state change to fold into the index. */
export interface LocalIndexCommit {
  path: string;
  versionId: string;
  hash: string;
  size: number;
  clock: LogicalClock;
  /** Tombstone the entry instead of marking it live. */
  deleted?: boolean;
  /** Epoch ms of the deletion — required when `deleted` is true. */
  deletedAt?: number;
  /** True when this commit records an empty-folder placeholder (FR-10). */
  isFolder?: boolean;
}

/**
 * Fold one commit into the index. Pure: returns a new index, input untouched.
 *
 * Applying a commit for a path replaces that path's entry wholesale (a commit
 * *is* the new truth for the path); `applyCommit` never merges fields.
 * Tombstoning (`deleted: true`) requires `deletedAt` and keeps the entry.
 *
 * To drop an entry entirely (the path migrated away, e.g. a synced rename)
 * use `removeEntry` instead.
 */
export function applyCommit(index: LocalIndex, commit: LocalIndexCommit): LocalIndex {
  if (commit.deleted && commit.deletedAt === undefined) {
    throw new Error(
      `applyCommit: tombstone for ${JSON.stringify(commit.path)} requires deletedAt`,
    );
  }
  const next: Record<string, LocalIndexEntry> = { ...index };
  const entry: LocalIndexEntry = {
    hash: commit.hash,
    size: commit.size,
    versionId: commit.versionId,
    clock: commit.clock,
  };
  if (commit.deleted) entry.deletedAt = commit.deletedAt;
  if (commit.isFolder) entry.isFolder = true;
  next[commit.path] = entry;
  return next;
}

/**
 * Remove a path's entry entirely (no tombstone). Used when the authority
 * migrates a path's version chain elsewhere — i.e. a synced rename: the old
 * path must vanish from the index exactly as it vanished from the manifest.
 * Pure; removing an absent path is a no-op.
 */
export function removeEntry(index: LocalIndex, path: string): LocalIndex {
  if (!(path in index)) return index;
  const next: Record<string, LocalIndexEntry> = { ...index };
  delete next[path];
  return next;
}

/**
 * Serialize to a deterministic JSON string: versioned envelope, entries
 * sorted by path (so identical indexes serialize byte-identically and diff
 * cleanly in state-dir listings).
 */
export function serializeLocalIndex(index: LocalIndex): string {
  const entries: Record<string, LocalIndexEntry> = {};
  for (const path of Object.keys(index).sort()) {
    entries[path] = index[path] as LocalIndexEntry;
  }
  const envelope: LocalIndexEnvelope = {
    schemaVersion: LOCAL_INDEX_SCHEMA_VERSION,
    entries,
  };
  return JSON.stringify(envelope);
}

/**
 * Parse a serialized index back. Throws `ProtocolError` on non-JSON input,
 * a malformed envelope, entries with wrong field types, or a `schemaVersion`
 * this build does not understand (older or newer). Unknown extra fields are
 * tolerated for forward compatibility.
 */
export function deserializeLocalIndex(json: string): LocalIndex {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (cause) {
    throw new ProtocolError('Local index state is not valid JSON', { cause });
  }
  if (!isPlainObject(parsed)) {
    throw new ProtocolError('Local index state is not an object');
  }
  const version = parsed.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version)) {
    throw new ProtocolError('Local index state is missing integer schemaVersion');
  }
  if (version !== LOCAL_INDEX_SCHEMA_VERSION) {
    throw new ProtocolError(
      `Local index schema version ${version} is not supported by this build ` +
        `(expected ${LOCAL_INDEX_SCHEMA_VERSION}); a migration is required`,
    );
  }
  const rawEntries = parsed.entries;
  if (!isPlainObject(rawEntries)) {
    throw new ProtocolError('Local index state is missing the entries object');
  }

  const entries: Record<string, LocalIndexEntry> = {};
  for (const [path, raw] of Object.entries(rawEntries)) {
    entries[path] = parseEntry(path, raw);
  }
  return entries;
}

function parseEntry(path: string, raw: unknown): LocalIndexEntry {
  const where = `Local index entry ${JSON.stringify(path)}`;
  if (!isPlainObject(raw)) throw new ProtocolError(`${where} is not an object`);
  const { hash, size, versionId, clock, deletedAt, isFolder } = raw as Record<string, unknown>;
  if (typeof hash !== 'string') throw new ProtocolError(`${where}: hash must be a string`);
  if (typeof versionId !== 'string') {
    throw new ProtocolError(`${where}: versionId must be a string`);
  }
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 0) {
    throw new ProtocolError(`${where}: size must be a non-negative integer`);
  }
  if (!isPlainObject(clock) || typeof clock.counter !== 'number' || typeof clock.deviceId !== 'string') {
    throw new ProtocolError(`${where}: clock must be { counter: number, deviceId: string }`);
  }
  if (deletedAt !== undefined && typeof deletedAt !== 'number') {
    throw new ProtocolError(`${where}: deletedAt must be a number when present`);
  }
  if (isFolder !== undefined && typeof isFolder !== 'boolean') {
    throw new ProtocolError(`${where}: isFolder must be a boolean when present`);
  }
  const entry: LocalIndexEntry = {
    hash,
    size,
    versionId,
    clock: { counter: clock.counter as number, deviceId: clock.deviceId as string },
  };
  if (deletedAt !== undefined) entry.deletedAt = deletedAt as number;
  if (isFolder !== undefined) entry.isFolder = isFolder as boolean;
  return entry;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
