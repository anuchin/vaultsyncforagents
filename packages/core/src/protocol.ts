/**
 * Typed WebSocket message definitions for the `/sync` channel
 * (ARCHITECTURE.md §5). All messages are JSON with a `type` discriminant.
 *
 * Two channels exist: this WS protocol (metadata + change feed) and plain
 * HTTPS blob routes (`GET/PUT /blob/:hash`) for content — referenced here
 * only via content hashes.
 */

import type { LogicalClock, Version, VersionKind, VaultSettings } from './types.js';
import { ProtocolError } from './errors.js';

/** Wire protocol version. Bump on breaking message-shape changes. */
export const ProtocolVersion = 1 as const;

/** Commits at or below this size may inline content (base64) on the WS. */
export const INLINE_CONTENT_MAX_BYTES = 256 * 1024;

/**
 * One entry of the manifest map (`{path → ManifestEntry}`). The entry is
 * self-describing: it carries its own `path` and the head's `clock` so the
 * client-side reconciliation (`resolve.ts`) can order remote state against
 * local state without any extra round-trips.
 */
export interface ManifestEntry {
  /** Normalized vault path this entry describes (mirrors the map key). */
  path: string;
  /** Version id of the entry's head. */
  version: string;
  /** sha256 hex of current content (`''` for folder placeholders). */
  hash: string;
  /** Content size in bytes (`0` for folder placeholders). */
  size: number;
  /** Tombstone flag. */
  deleted: boolean;
  /** Logical clock of the head — the ordering authority (§4). */
  clock: LogicalClock;
  /** True for empty-folder placeholder entries (FR-10). */
  isFolder?: boolean;
  /** Epoch ms of last update, display-only. */
  mtime: number;
}

// --- Client → Server -------------------------------------------------------

/** Auth + catch-up: token, protocol version, last seen DO sequence number. */
export interface HelloMessage {
  type: 'hello';
  token: string;
  protocolVersion: number;
  /** Last seen global sequence number; 0 for a first-ever connect. */
  cursor: number;
}

/** Request full (`since` omitted) or delta manifest. */
export interface GetManifestMessage {
  type: 'getManifest';
  since?: number;
}

/**
 * Commit a new version. If `inline` is set it carries the full content
 * base64-encoded (only allowed when `size <= INLINE_CONTENT_MAX_BYTES`);
 * otherwise the blob must already be uploaded (`putBlob` on this channel,
 * `PUT /blob/:hash` on the real worker).
 */
export interface CommitMessage {
  type: 'commit';
  path: string;
  /** Version id the commit builds on; server detects divergence → conflict. */
  parentVersion: string | null;
  hash: string;
  size: number;
  /** What kind of version this commits (mirrors `Version.kind`). */
  kind: VersionKind;
  inline?: string;
  /** Source path — required for `kind: 'rename'` (chain migration, FR-9). */
  fromPath?: string;
  /** True for empty-folder placeholder commits (FR-10; hash `''`, size 0). */
  isFolder?: boolean;
}

/** Keepalive. */
export interface PingMessage {
  type: 'ping';
  /** Client epoch ms; echoed back on `pong` for RTT / skew measurement. */
  ts?: number;
}

/**
 * Upload a content blob over the sync channel. Test doubles and small vaults
 * can use this directly; the real worker exposes the same operation as
 * `PUT /blob/:hash` (streamed). Idempotent: same hash ⇒ same content.
 */
export interface PutBlobMessage {
  type: 'putBlob';
  hash: string;
  /** Full content, base64-encoded. */
  content: string;
}

/** Fetch a content blob (the WS-inline path of §8 "fetch blob"). */
export interface GetBlobMessage {
  type: 'getBlob';
  hash: string;
}

/**
 * Snapshot every file head at a moment (a whole-vault restore point). The
 * server records the head state atomically; snapshots are never broadcast —
 * other devices learn nothing live, the list is pull-based.
 */
export interface SnapshotCreateMessage {
  type: 'snapshotCreate';
  /** Optional label; omitted/empty ⇒ unnamed. */
  name?: string;
}

/** Restore the whole vault to a snapshot (FR-7: as NEW versions — history is never deleted). */
export interface SnapshotRestoreMessage {
  type: 'snapshotRestore';
  /** Snapshot id (as returned by `snapshotCreateAck` / listed by the server). */
  id: string;
}

// --- Server → Client -------------------------------------------------------

/** Successful hello: this device's identity + vault-level info. */
export interface HelloAckMessage {
  type: 'helloAck';
  deviceId: string;
  vaultName: string;
  settings: VaultSettings;
  /**
   * Lowest change-event sequence number the server still retains (protocol
   * v1, pre-release; optional so older servers can be answered with a full
   * manifest). A client whose cursor satisfies
   * `oldestRetainedSeq <= cursor + 1` can request a delta manifest — every
   * event after its cursor is still replayable, so its index is guaranteed
   * to only miss heads with `head_seq > cursor`. Absent (or `> cursor + 1`)
   * ⇒ the client must fall back to a full manifest.
   */
  oldestRetainedSeq?: number;
  /**
   * The server's own release version (the worker's package version).
   * Optional because servers ≤ 0.1 predate version reporting and omit it —
   * clients treat absence as "legacy server" (see `compat.ts`), never as a
   * protocol failure.
   */
  serverVersion?: string;
}

/** Reply to `getManifest`: the (possibly delta) file index. */
export interface ManifestMessage {
  type: 'manifest';
  entries: Readonly<Record<string, ManifestEntry>>;
  /** Global sequence number this manifest reflects (cursor catch-up). */
  cursor: number;
}

/** Commit accepted as the new head. */
export interface CommitAckMessage {
  type: 'commitAck';
  /** Version id assigned by the authority. */
  version: string;
  /** Logical clock of the accepted version. */
  clock: LogicalClock;
  /** Global sequence number of the accepted head (cursor tracking). */
  seq: number;
}

/** What happened to the losing side of a concurrent edit (see disposition). */
export type ConflictLoserDisposition = 'conflictCopy';

/** Commit lost the race; the server's chosen winner stands. */
export interface ConflictMessage {
  type: 'conflict';
  /** The winning version (this commit or the concurrent one). */
  winner: Version;
  /** What the server did with the loser's content — never deleted. */
  loserDisposition: ConflictLoserDisposition;
  /** Global sequence number of the winning head, when it has one. */
  seq?: number;
}

/**
 * Fan-out payload shared by the change broadcast and the arbitration result.
 * Everything a client needs to materialize one head transition.
 */
export interface ChangePayload {
  path: string;
  /** Version id of the new head. */
  version: string;
  hash: string;
  size: number;
  deleted: boolean;
  /** Id of the device that committed. */
  device: string;
  /** Logical clock of the new head — clients use it to skip stale replays. */
  clock: LogicalClock;
  /** What kind of change this is (mirrors `Version.kind`). */
  kind: VersionKind;
  /** Source path — present when `kind: 'rename'`. */
  fromPath?: string;
  /** True for folder placeholder changes (FR-10). */
  isFolder?: boolean;
}

/** Fan-out broadcast to all *other* connected clients. */
export interface ChangeMessage extends ChangePayload {
  type: 'change';
  /** Global sequence number of this change (cursor tracking). */
  seq: number;
}

/** Reply to `putBlob`. */
export interface BlobAckMessage {
  type: 'blobAck';
  hash: string;
}

/** Reply to `getBlob`: the requested content. */
export interface BlobMessage {
  type: 'blob';
  hash: string;
  /** Full content, base64-encoded. */
  content: string;
}

/** Machine-readable codes carried by `error` messages (HTTP-equivalent). */
export type ServerErrorCode = 'UNAUTHORIZED' | 'REVOKED' | 'NOT_FOUND' | 'PROTOCOL';

/** Negative reply (auth failure, unknown blob, protocol violation, …). */
export interface ErrorMessage {
  type: 'error';
  code: ServerErrorCode;
  message: string;
}

/** Presence update for dashboards / `vsa status`. */
export interface DeviceSeenMessage {
  type: 'deviceSeen';
  deviceId: string;
  ts: number;
}

/** Keepalive reply. */
export interface PongMessage {
  type: 'pong';
  /** Echoes the `ping` ts when one was provided. */
  ts?: number;
}

/** Reply to `snapshotCreate`. */
export interface SnapshotCreateAckMessage {
  type: 'snapshotCreateAck';
  /** Id assigned by the authority (`s{n}`). */
  id: string;
  /** Echoes the stored name (`''` for unnamed snapshots). */
  name: string;
  /** Epoch ms of the snapshot. */
  ts: number;
  /** Global sequence number at creation (cursor bookkeeping). */
  seq: number;
  /** Number of file heads captured. */
  fileCount: number;
}

/** Reply to `snapshotRestore`. */
export interface SnapshotRestoreAckMessage {
  type: 'snapshotRestoreAck';
  id: string;
  /** Paths reverted to the snapshot's content (resurrected tombstones included). */
  restored: number;
  /** Paths newly tombstoned (live now, absent or deleted at the snapshot). */
  tombstoned: number;
  /** Global seq of the last restore change (current seq when nothing differed). */
  seq: number;
}

/** One vault-level snapshot as listed by the server (`GET /api/snapshots`). */
export interface SnapshotSummary {
  id: string;
  name: string;
  /** Epoch ms of creation. */
  ts: number;
  /** Device that created the snapshot. */
  deviceId: string;
  /** Global sequence number at creation. */
  seq: number;
  /** Number of file heads captured. */
  fileCount: number;
}

// --- Union + guards ---------------------------------------------------------

export type ClientMessage =
  | HelloMessage
  | GetManifestMessage
  | CommitMessage
  | PutBlobMessage
  | GetBlobMessage
  | PingMessage
  | SnapshotCreateMessage
  | SnapshotRestoreMessage;

export type ServerMessage =
  | HelloAckMessage
  | ManifestMessage
  | CommitAckMessage
  | ConflictMessage
  | ChangeMessage
  | DeviceSeenMessage
  | BlobAckMessage
  | BlobMessage
  | ErrorMessage
  | PongMessage
  | SnapshotCreateAckMessage
  | SnapshotRestoreAckMessage;

export type Message = ClientMessage | ServerMessage;

const CLIENT_TYPES: ReadonlySet<string> = new Set([
  'hello',
  'getManifest',
  'commit',
  'putBlob',
  'getBlob',
  'ping',
  'snapshotCreate',
  'snapshotRestore',
]);
const SERVER_TYPES: ReadonlySet<string> = new Set([
  'helloAck',
  'manifest',
  'commitAck',
  'conflict',
  'change',
  'deviceSeen',
  'blobAck',
  'blob',
  'error',
  'pong',
  'snapshotCreateAck',
  'snapshotRestoreAck',
]);

/**
 * Runtime shape check: a value is a `Message` iff it is an object whose
 * `type` is a known message type. Field-level validation happens where a
 * message is acted upon (later phases); the guard is deliberately cheap so
 * both WS ends can triage unknown/forward-compatible types.
 */
export function isMessage(value: unknown): value is Message {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { type?: unknown }).type === 'string' &&
    (CLIENT_TYPES.has((value as { type: string }).type) ||
      SERVER_TYPES.has((value as { type: string }).type))
  );
}

export function isClientMessage(value: unknown): value is ClientMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    CLIENT_TYPES.has((value as { type?: unknown }).type as string)
  );
}

export function isServerMessage(value: unknown): value is ServerMessage {
  return (
    typeof value === 'object' &&
    value !== null &&
    SERVER_TYPES.has((value as { type?: unknown }).type as string)
  );
}

/**
 * Parse a WS text frame into a typed `Message`.
 * Throws `ProtocolError` on non-JSON input or unknown message types.
 */
export function parseMessage(data: string): Message {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch (cause) {
    throw new ProtocolError(`Message is not valid JSON: ${String(data).slice(0, 200)}`, { cause });
  }
  if (!isMessage(parsed)) {
    throw new ProtocolError(
      `Unknown or malformed message type: ${JSON.stringify((parsed as { type?: unknown })?.type)}`,
    );
  }
  return parsed;
}

// --- wire encoding ------------------------------------------------------------
//
// `inline`/`content` fields carry raw bytes as base64. `btoa`/`atob` exist in
// every target runtime (Workers, Node 16+, Electron); chunking avoids
// exceeding argument-length limits on large attachments.

/** Encode bytes as base64. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}

/** Decode base64 to bytes. Throws `ProtocolError` on invalid input. */
export function base64ToBytes(encoded: string): Uint8Array {
  let binary: string;
  try {
    binary = atob(encoded);
  } catch (cause) {
    throw new ProtocolError('Base64 payload is not valid', { cause });
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
