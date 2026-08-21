/**
 * Core domain types for the sync engine (ARCHITECTURE.md §4–§6).
 *
 * These are the in-memory shapes used by every client and mirrored by the
 * Durable Object's SQLite schema. Wall-clock timestamps (`ts`, `lastSeen`,
 * `updatedAt`) are display-only — ordering authority is the logical clock.
 */

/** Kind of change a version records. */
export type VersionKind = 'edit' | 'rename' | 'delete' | 'conflictCopy' | 'restore';

/** Where a client runs; drives UX and presence labels. */
export type DeviceType = 'desktop' | 'mobile' | 'daemon' | 'cli';

/**
 * Per-file logical clock, maintained by the sync authority.
 *
 * Winner selection: higher `counter` wins; ties broken by `deviceId`
 * (stable, deterministic on every client). Comparison logic is a later
 * phase — this type only fixes the shape now.
 */
export interface LogicalClock {
  /** Monotonic counter for the file (per-file version sequence). */
  counter: number;
  /** Tiebreak identity of the device that produced this counter value. */
  deviceId: string;
}

/** One committed version of a file (a row in the DO's `versions` table). */
export interface Version {
  /** Opaque server-assigned version id. */
  id: string;
  /** Vault path this version belongs to. */
  path: string;
  /** sha256 hex of the content (tombstones reuse the deleted content's hash). */
  hash: string;
  /** Content size in bytes. */
  size: number;
  /** Device that committed this version. */
  deviceId: string;
  /** Logical clock at commit time — the ordering authority. */
  clock: LogicalClock;
  /** Parent version id; `null` only for a file's first version. */
  parentVersion: string | null;
  /** Epoch ms, display-only. */
  ts: number;
  kind: VersionKind;
}

/** Current state of one path in the file index (DO `files` table). */
export interface FileEntry {
  /** Normalized vault path. */
  path: string;
  /** Version id of the current head. */
  currentVersion: string;
  /** Tombstone flag — deleted files stay recoverable from history. */
  deleted: boolean;
  /** Epoch ms of the last update, display-only. */
  updatedAt: number;
}

/** A paired device as tracked by the authority (DO `devices` table). */
export interface DeviceInfo {
  id: string;
  /** Human-chosen name ("MacBook", "Pixel", "agent-vps"). */
  name: string;
  type: DeviceType;
  /** Epoch ms of last authenticated contact. */
  lastSeen: number;
  /** Revoked devices are rejected on every subsequent call. */
  revoked: boolean;
}

/** Per-vault settings (DO `meta`, editable from dashboard/CLI). */
export interface VaultSettings {
  /** Whether `.obsidian/` participates in sync (off by default — FR-11). */
  obsidianSync: boolean;
  /** Display name chosen at claim time. */
  displayName: string;
  /**
   * Client-side extra ignore patterns (the plugin's "Ignore patterns"
   * setting). Deliberately NOT worker-authoritative: the server never sets
   * it in `helloAck`, and `SyncClient` preserves its own value across the
   * handshake supersede — ignores are a per-device concern.
   */
  extraIgnores?: readonly string[];
}
