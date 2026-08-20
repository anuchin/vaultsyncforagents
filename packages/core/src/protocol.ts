/**
 * Typed WebSocket message definitions for the `/sync` channel
 * (ARCHITECTURE.md §5). All messages are JSON with a `type` discriminant.
 *
 * Two channels exist: this WS protocol (metadata + change feed) and plain
 * HTTPS blob routes (`GET/PUT /blob/:hash`) for content — referenced here
 * only via content hashes.
 */

import type { LogicalClock, Version, VaultSettings } from './types.js';
import { ProtocolError } from './errors.js';

/** Wire protocol version. Bump on breaking message-shape changes. */
export const ProtocolVersion = 1 as const;

/** Commits at or below this size may inline content (base64) on the WS. */
export const INLINE_CONTENT_MAX_BYTES = 256 * 1024;

/** One entry of the manifest map (`{path → ManifestEntry}`). */
export interface ManifestEntry {
  /** Version id of the entry's head. */
  version: string;
  /** sha256 hex of current content. */
  hash: string;
  /** Content size in bytes. */
  size: number;
  /** Tombstone flag. */
  deleted: boolean;
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
 * otherwise the blob must already be uploaded via `PUT /blob/:hash`.
 */
export interface CommitMessage {
  type: 'commit';
  path: string;
  /** Version id the commit builds on; server detects divergence → conflict. */
  parentVersion: string | null;
  hash: string;
  size: number;
  inline?: string;
}

/** Keepalive. */
export interface PingMessage {
  type: 'ping';
  /** Client epoch ms; echoed back on `pong` for RTT / skew measurement. */
  ts?: number;
}

// --- Server → Client -------------------------------------------------------

/** Successful hello: this device's identity + vault-level info. */
export interface HelloAckMessage {
  type: 'helloAck';
  deviceId: string;
  vaultName: string;
  settings: VaultSettings;
}

/** Reply to `getManifest`: the (possibly delta) file index. */
export interface ManifestMessage {
  type: 'manifest';
  entries: Readonly<Record<string, ManifestEntry>>;
}

/** Commit accepted as the new head. */
export interface CommitAckMessage {
  type: 'commitAck';
  /** Version id assigned by the authority. */
  version: string;
  /** Logical clock of the accepted version. */
  clock: LogicalClock;
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
}

/** Fan-out broadcast to all *other* connected clients. */
export interface ChangeMessage {
  type: 'change';
  path: string;
  /** Version id of the new head. */
  version: string;
  hash: string;
  size: number;
  deleted: boolean;
  /** Id of the device that committed. */
  device: string;
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

// --- Union + guards ---------------------------------------------------------

export type ClientMessage =
  | HelloMessage
  | GetManifestMessage
  | CommitMessage
  | PingMessage;

export type ServerMessage =
  | HelloAckMessage
  | ManifestMessage
  | CommitAckMessage
  | ConflictMessage
  | ChangeMessage
  | DeviceSeenMessage
  | PongMessage;

export type Message = ClientMessage | ServerMessage;

const CLIENT_TYPES: ReadonlySet<string> = new Set(['hello', 'getManifest', 'commit', 'ping']);
const SERVER_TYPES: ReadonlySet<string> = new Set([
  'helloAck',
  'manifest',
  'commitAck',
  'conflict',
  'change',
  'deviceSeen',
  'pong',
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
