/**
 * VaultRoom — the Durable Object that is the single-writer sync authority for
 * one vault (ARCHITECTURE.md §1, §5, §6).
 *
 * All metadata lives in this object's SQLite storage (files, versions,
 * devices, events, pairing codes, blob bookkeeping, meta); all content lives
 * in R2 as content-addressed blobs. Arbitration itself is NOT implemented
 * here: `arbitrateCommit` is imported from `@vsa/core` — the same pure module
 * the in-memory test server wraps — so the real DO and the simulation provably
 * agree (core/test/simulation.test.ts is this file's contract).
 *
 * Sockets use the WebSocket **Hibernation API** (`ctx.acceptWebSocket` +
 * `webSocketMessage`/`webSocketClose` handlers): idle connections cost
 * nothing. Per-socket auth state rides `serializeAttachment`.
 *
 * Concurrency: one isolate per object; `runExclusive` chains every mutating
 * handler (HTTP and WS alike) through a single promise queue so
 * read-modify-write sequences (claim, commit arbitrate→persist, pairing-code
 * burn) are atomic even across `await` points. This is the DO-transaction
 * guard behind the first-writer-wins claim race (§14), made deterministic.
 */

import { DurableObject } from 'cloudflare:workers';
import { argon2id } from '@noble/hashes/argon2.js';
import {
  arbitrateCommit,
  base64ToBytes,
  bytesToBase64,
  INLINE_CONTENT_MAX_BYTES,
  normalizeVaultPath,
  parseMessage,
  pathSafetyViolation,
  planSnapshotRestore,
  ProtocolVersion,
  sha256Hex,
  snapshotHeadsOf,
  type ArbitrationFileState,
  type ArbitrationState,
  type ChangeMessage,
  type ChangePayload,
  type ClientMessage,
  type CommitMessage,
  type DeviceType,
  type HelloMessage,
  type ManifestEntry,
  type ServerMessage,
  type SnapshotCreateMessage,
  type SnapshotHeadRecord,
  type SnapshotRestoreMessage,
  type Version,
  type VersionKind,
} from '@vsa/core';
import { SERVER_VERSION } from './version.js';

// --- tunables ---------------------------------------------------------------------

/** Admin session cookie lifetime (FR-32, §3: 12 h). */
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;
/** Pairing code lifetime (FR-23, §3: 10 min, one-time). */
const PAIR_TTL_MS = 10 * 60 * 1000;
/** A device counts as online when seen within this window (FR-31). */
const ONLINE_WINDOW_MS = 2 * 60 * 1000;
/** Orphan blobs younger than this survive GC (in-flight uploads, §7). */
export const GC_GRACE_MS = 7 * 24 * 60 * 60 * 1000;
/** Blob size cap on the WS channel (the HTTP route enforces its own cap). */
const WS_BLOB_MAX_BYTES = 100 * 1024 * 1024;
/** Commit path cap, in UTF-16 code units, after normalization. */
const COMMIT_PATH_MAX_LENGTH = 1024;

/**
 * Per-IP throttle on the unauthenticated guessing surfaces — `POST /pair`
 * and `POST /admin/login` (§3, §14): at most 10 failures per client IP per
 * 15-minute window, then 429 + `Retry-After` until the window closes.
 */
const AUTH_FAILURE_LIMIT = 10;
const AUTH_FAILURE_WINDOW_MS = 15 * 60 * 1000;

/**
 * Events pruning policy (§6): the event log is a feed, not a ledger — drop
 * rows older than 30 days and everything beyond the newest 10,000 (whichever
 * prunes more). Versions are untouched: history is kept forever (FR-7).
 */
const EVENT_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
const EVENT_KEEP_MAX = 10_000;
/**
 * Opportunistic prune cadence: the hourly watermark rides `meta` (one
 * point-lookup per event write — cheaper than the INSERT it accompanies);
 * the weekly GC cron prunes unconditionally as the second net.
 */
const EVENT_PRUNE_MIN_INTERVAL_MS = 60 * 60 * 1000;

/** argon2id parameters (OWASP Password Storage Cheat Sheet: 19 MiB, t=2, p=1). */
const ARGON2_PARAMS = { t: 2, m: 19456, p: 1, dkLen: 32 } as const;

/** Alphabet for pairing codes — no I/L/O/0/1 (transcription-safe). */
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;
/**
 * Largest multiple of the alphabet size (31) that fits in a byte: bytes at or
 * above it are redrawn (rejection sampling), so every code character is
 * exactly uniform — `byte % 31` alone would favor the first 8 letters.
 */
const CODE_ALPHABET_CEILING = 248;

/** Admin passphrase minimum length (claim and passphrase-change). */
const PASSPHRASE_MIN_CHARS = 8;
/** Disconnect a socket after this many protocol violations (§14 abuse bound). */
const PROTOCOL_ERROR_LIMIT = 3;
/**
 * `meta` key for the session revocation floor (epoch ms): admin sessions
 * minted before it are dead. Logout bumps it (sign-out kills EVERY session),
 * and passphrase-change bumps it alongside the secret rotation.
 */
const SESSIONS_NOT_BEFORE_KEY = 'sessions_not_before';
/** Device display names: 1–30 chars, no control characters. */
const DEVICE_NAME_MAX_CHARS = 30;
/** Vault display name cap (claim). */
const VAULT_NAME_MAX_CHARS = 60;
/** Snapshot label cap (snapshotCreate). */
const SNAPSHOT_NAME_MAX_CHARS = 100;

// --- free-tier longevity (retention + quota) ---------------------------------------

/**
 * Quota defaults, tuned for the R2 free tier the self-hosting story rides on:
 * WARN at 8 GiB (80% of 10 GiB) so there is time to act, HARD at 10 GiB.
 * Advisory in v1 — surfaced on `/api/status` (dashboard, `vsa doctor`) but
 * never enforced by refusing commits (a vault that cannot sync is worse
 * than a vault over quota). Admin-tunable via `POST /admin/quota` (0 = off).
 */
export const QUOTA_WARN_DEFAULT_BYTES = 8 * 1024 ** 3;
export const QUOTA_HARD_DEFAULT_BYTES = 10 * 1024 ** 3;
/** Retention knob bounds (`POST /admin/retention`): 0 disables each. */
export const RETENTION_MAX_DAYS = 3650;
export const RETENTION_MAX_VERSIONS = 1000;
/**
 * Device-token rotation: a token older than this is re-issued in the
 * helloAck (`nextToken`); the previous token stays valid for the grace
 * window so a client that never noticed (crash mid-hand-off) still gets one
 * more successful connect to receive it again — rotation must never wedge
 * an honest device. Bounded credential life: a leaked token dies the next
 * time its device syncs past the interval.
 */
export const TOKEN_ROTATION_INTERVAL_MS = 90 * 24 * 60 * 60 * 1000;
export const TOKEN_ROTATION_GRACE_MS = 24 * 60 * 60 * 1000;

export const ADMIN_COOKIE_NAME = 'vsa_admin';
const CLIENT_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  'hello',
  'getManifest',
  'commit',
  'putBlob',
  'getBlob',
  'ping',
  'snapshotCreate',
  'snapshotRestore',
]);

/** R2 key for a content hash (§7). */
export function blobKey(hash: string): string {
  return `blobs/${hash}`;
}

const MANIFEST_COLUMNS =
  'SELECT path, current_version, deleted, is_folder, head_hash, head_size, head_clock_counter, head_clock_device, head_seq, updated_at';

// --- small helpers (pure, Web APIs only) ----------------------------------------------

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });
}

/** Timing-safe comparison for hex strings (token hashes, HMACs). */
function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function randomBytes(n: number): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(n));
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) out += byte.toString(16).padStart(2, '0');
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** 256-bit random value, base64url (device tokens, session secret). */
function randomToken64url(bytes = 32): string {
  return bytesToBase64(randomBytes(bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(value: string): Uint8Array {
  const b64 = value.replace(/-/g, '+').replace(/_/g, '/');
  return base64ToBytes(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
}

/** Normalize a user-entered pairing code: uppercase, strip dashes/space. */
function normalizeCode(code: string): string {
  return code.toUpperCase().replace(/[-\s]/g, '');
}

/**
 * Client IP of a forwarded request — the worker forwards `CF-Connecting-IP`
 * so the DO can throttle per IP; anything unattributable shares `'unknown'`.
 */
function clientIpOf(request: Request): string {
  return request.headers.get('cf-connecting-ip') ?? 'unknown';
}

async function hmacHex(secret: Uint8Array, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    secret as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return toHex(new Uint8Array(mac));
}

function isDeviceType(value: unknown): value is DeviceType {
  return value === 'desktop' || value === 'mobile' || value === 'daemon' || value === 'cli';
}

/** Valid device display name: 1–30 chars, no control characters. */
function isValidDeviceName(name: string): boolean {
  return (
    name.length >= 1 &&
    name.length <= DEVICE_NAME_MAX_CHARS &&
    !/[\u0000-\u001f\u007f]/.test(name)
  );
}

/** Bounded path echo for protocol-error messages (never echo unbounded input). */
function previewPath(path: string): string {
  return JSON.stringify(path).slice(0, 120);
}

// --- persisted shapes -------------------------------------------------------------------

interface DeviceRow {
  id: string;
  name: string;
  type: string;
  token_hash: string;
  created_at: number;
  last_seen: number;
  revoked: number;
  /** Migration 0003: rotation bookkeeping (0 / null on legacy rows). */
  token_issued_at: number;
  prev_token_hash: string | null;
  prev_token_expires_at: number;
}

interface PairRow {
  code_hash: string;
  device_name: string;
  device_type: string;
  expires_at: number;
  used: number;
  created_at: number;
}

/** Per-socket auth state (hibernation-safe attachment). */
interface SocketAttachment {
  deviceId: string | null;
  /** Protocol violations so far (disconnect at PROTOCOL_ERROR_LIMIT). */
  protocolErrors: number;
}

/**
 * One restore step's durable footprint, collected in phase 1 (pure) and
 * written in phase 2 of `handleSnapshotRestore`: the minted head version
 * (`versions` row + blob refcount), the path's new file state (`files` row),
 * and the change to record + fan out.
 */
interface SnapshotRestoreStep {
  version: Version;
  file: ArbitrationFileState;
  broadcast: ChangePayload;
  tombstone: boolean;
}

// --- the Durable Object --------------------------------------------------------------------

export class VaultRoom extends DurableObject<Env> {
  /** Serializes every mutating handler (see module doc). */
  private queueTail: Promise<unknown> = Promise.resolve();
  private schemaReady: Promise<void> | null = null;

  /**
   * Time seam: the wall clock unless pinned by tests (`setTimeForTests`) —
   * rate-limit windows, event ages, and conflict stamps stay deterministic
   * under test. Production always reads `Date.now()`.
   */
  private pinnedTime: number | null = null;

  /**
   * Per-IP auth-failure counters for the guessing surfaces (§3, §14). In
   * memory by design: isolate lifetime is the right scope, and every access
   * rides `runExclusive`, so increments are atomic.
   */
  private authFailures = new Map<string, { count: number; windowStart: number }>();

  // --- clock ------------------------------------------------------------------------------

  /** The DO's clock: the wall clock unless pinned for tests (see seam). */
  private now(): number {
    return this.pinnedTime ?? Date.now();
  }

  /** Test seam: pin the clock (or release it with `null`) inside the DO. */
  setTimeForTests(ms: number | null): void {
    this.pinnedTime = ms;
  }

  /** Test seam: drop in-memory auth-failure counters (`helpers.resetAll`). */
  clearAuthFailuresForTests(): void {
    this.authFailures.clear();
  }

  override async fetch(request: Request): Promise<Response> {
    await this.ensureSchema();
    const url = new URL(request.url);
    const path = url.pathname;

    if (request.method === 'GET' && (path === '/ws' || path === '/sync')) {
      return this.handleUpgrade(url);
    }
    return this.runExclusive(() => this.handleHttp(request, url, path));
  }

  // --- WebSocket upgrade ----------------------------------------------------------------

  private async handleUpgrade(url: URL): Promise<Response> {
    const token = url.searchParams.get('token');
    if (token !== null) {
      // Legacy pre-auth (clients ≤ 0.1.3 put the token in the URL; current
      // clients authenticate via the hello frame only). Kept so old deployed
      // clients keep failing fast on bad/revoked tokens with a clean 401
      // instead of an opaque WS close.
      const device = await this.lookupDeviceByToken(token);
      if (device === undefined || device.row.revoked === 1) {
        return json(401, { error: device !== undefined ? 'device revoked' : 'invalid token' });
      }
    }
    const pair = new WebSocketPair();
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ deviceId: null, protocolErrors: 0 } satisfies SocketAttachment);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  // --- WebSocket hibernation handlers -----------------------------------------------------

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    if (typeof message !== 'string') {
      this.failWs(ws, 'PROTOCOL', 'binary frames are not part of the protocol');
      return;
    }
    let parsed;
    try {
      parsed = parseMessage(message);
    } catch (error) {
      this.failWs(ws, 'PROTOCOL', error instanceof Error ? error.message : String(error));
      return;
    }
    if (!CLIENT_MESSAGE_TYPES.has(parsed.type)) {
      this.failWs(ws, 'PROTOCOL', `unexpected message type ${JSON.stringify(parsed.type)}`);
      return;
    }
    const clientMessage = parsed as ClientMessage;
    try {
      await this.runExclusive(() => this.handleClientMessage(ws, clientMessage));
    } catch (error) {
      this.failWs(ws, 'PROTOCOL', error instanceof Error ? error.message : String(error));
    }
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    const attachment = this.readAttachment(ws);
    if (attachment.deviceId !== null) {
      this.sql('UPDATE devices SET last_seen = ? WHERE id = ?', this.now(), attachment.deviceId);
    }
    try {
      ws.close(code, reason);
    } catch {
      // already closed
    }
  }

  override async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    try {
      ws.close(1011, error instanceof Error ? error.message.slice(0, 100) : 'error');
    } catch {
      // already closed
    }
  }

  // --- protocol message handling ------------------------------------------------------------

  private async handleClientMessage(ws: WebSocket, message: ClientMessage): Promise<void> {
    const attachment = this.readAttachment(ws);

    if (message.type === 'hello') {
      await this.handleHello(ws, message);
      return;
    }
    if (message.type === 'ping') {
      const reply: ServerMessage = { type: 'pong', ...(message.ts !== undefined ? { ts: message.ts } : {}) };
      this.safeSend(ws, reply);
      return;
    }
    if (attachment.deviceId === null) {
      this.failWs(ws, 'UNAUTHORIZED', 'say hello first');
      return;
    }
    // Heartbeat: every authenticated message refreshes lastSeen (FR-31).
    this.sql('UPDATE devices SET last_seen = ? WHERE id = ?', this.now(), attachment.deviceId);
    switch (message.type) {
      case 'getManifest':
        this.handleGetManifest(ws, message.since);
        return;
      case 'commit':
        await this.handleCommit(ws, attachment, message);
        return;
      case 'putBlob':
        await this.handlePutBlob(ws, message.hash, message.content);
        return;
      case 'getBlob':
        await this.handleGetBlob(ws, message.hash);
        return;
      case 'snapshotCreate':
        this.handleSnapshotCreate(ws, attachment, message);
        return;
      case 'snapshotRestore':
        this.handleSnapshotRestore(ws, attachment, message);
        return;
      default:
        this.failWs(
          ws,
          'PROTOCOL',
          `unexpected message type ${JSON.stringify((message as { type: string }).type)}`,
        );
    }
  }

  private async handleHello(ws: WebSocket, message: HelloMessage): Promise<void> {
    if (!(await this.isClaimed())) {
      this.failWs(ws, 'UNAUTHORIZED', 'worker is not claimed');
      return;
    }
    const device = await this.lookupDeviceByToken(message.token);
    if (device === undefined) {
      this.failWs(ws, 'UNAUTHORIZED', 'unknown token');
      return;
    }
    if (device.row.revoked === 1) {
      this.failWs(ws, 'REVOKED', 'device was revoked');
      return;
    }
    if (message.protocolVersion !== ProtocolVersion) {
      this.failWs(ws, 'PROTOCOL', `protocol version ${message.protocolVersion} not supported`);
      return;
    }
    const now = this.now();
    const { row, viaGrace } = device;
    ws.serializeAttachment({ deviceId: row.id, protocolErrors: 0 } satisfies SocketAttachment);
    this.sql('UPDATE devices SET last_seen = ? WHERE id = ?', now, row.id);

    // Token rotation: a device token older than the interval is re-issued on
    // hello — the ack carries `nextToken`, the client persists it, and the
    // old token survives only the grace window (see `lookupDeviceByToken`).
    // A leaked token therefore has a bounded life once the device syncs again.
    // A GRACE connect re-issues too: the client dialed with the previous
    // token (it missed the earlier hand-off), and the DO stores only hashes,
    // so a fresh mint is the only way to hand it a working credential.
    let nextToken: string | undefined;
    const issuedAt = row.token_issued_at > 0 ? row.token_issued_at : row.created_at;
    if (viaGrace || now - issuedAt > TOKEN_ROTATION_INTERVAL_MS) {
      nextToken = randomToken64url(32);
      this.sql(
        'UPDATE devices SET token_hash = ?, token_issued_at = ?, prev_token_hash = ?, prev_token_expires_at = ? WHERE id = ?',
        await sha256Hex(nextToken),
        now,
        viaGrace ? row.token_hash : row.token_hash, // same either way: the hash being replaced
        now + TOKEN_ROTATION_GRACE_MS,
        row.id,
      );
      this.appendEvent(now, row.id, 'device', null, JSON.stringify({ rotated: row.id }));
    }
    const vaultName = (await this.getMeta('vault_name')) ?? '';
    this.safeSend(ws, {
      type: 'helloAck',
      deviceId: row.id,
      vaultName,
      settings: {
        obsidianSync: (await this.getMeta('settings_obsidian_sync')) === '1',
        displayName: vaultName,
      },
      ...(nextToken !== undefined ? { nextToken } : {}),
      // Replay-window answer (§5/§6): the oldest change-event seq still
      // retained under the pruning policy (30 days / newest 10k). Clients
      // with `cursor + 1 >= oldestRetainedSeq` request a delta manifest
      // (`getManifest{since}`) instead of the full vault index; with a gap —
      // or on legacy servers that omit the field — they fall back to full.
      // No change events retained ⇒ "nothing servable" (`head + 1`), which
      // reads as servable only to a cursor already at the head.
      oldestRetainedSeq: await this.oldestRetainedSeq(),
      // Version reporting: lets clients assess skew (core compat.ts). The
      // field is optional on the wire; pre-0.1 servers simply omit it.
      serverVersion: SERVER_VERSION,
    });
    this.broadcastOthers(ws, { type: 'deviceSeen', deviceId: row.id, ts: now });
    // Catch-up replay (§5): everything the client missed since its cursor.
    // A first-ever connect (cursor 0) gets the full manifest instead.
    if (message.cursor > 0) {
      const rows = this.sql(
        'SELECT detail FROM events WHERE kind = ? AND seq > ? ORDER BY seq ASC',
        'change',
        message.cursor,
      ).toArray();
      for (const row of rows) {
        this.safeSend(ws, JSON.parse(row.detail as string) as ServerMessage);
      }
    }
  }

  private handleGetManifest(ws: WebSocket, since: number | undefined): void {
    const entries: Record<string, ManifestEntry> = {};
    const rows =
      since !== undefined
        ? this.sql(MANIFEST_COLUMNS + ' FROM files WHERE head_seq > ?', since).toArray()
        : this.sql(MANIFEST_COLUMNS + ' FROM files').toArray();
    for (const row of rows) {
      entries[row.path as string] = {
        path: row.path as string,
        version: row.current_version as string,
        hash: row.head_hash as string,
        size: row.head_size as number,
        deleted: (row.deleted as number) === 1,
        clock: { counter: row.head_clock_counter as number, deviceId: row.head_clock_device as string },
        ...(row.is_folder === 1 ? { isFolder: true } : {}),
        mtime: row.updated_at as number,
      };
    }
    this.safeSend(ws, { type: 'manifest', entries, cursor: this.globalSeq() });
  }

  private async handleCommit(
    ws: WebSocket,
    attachment: SocketAttachment,
    message: CommitMessage,
  ): Promise<void> {
    const deviceId = attachment.deviceId as string;
    const now = this.now();

    // 1. Validate the commit's shape before anything durable happens.
    const violation = this.commitShapeViolation(message);
    if (violation !== null) {
      this.failWs(ws, 'PROTOCOL', violation);
      return;
    }

    // 1b. Path safety (§14): never admit a NEW live path under an occupied
    //     fold key (case + canonical form). Its own error code — PATH_COLLIDES
    //     deliberately does NOT trip the protocol-error counter: a client
    //     retrying a legitimately-conflicting name is not a protocol
    //     violator, and disconnecting it would wedge honest retries.
    const arbitrationState = this.loadArbitrationState();
    const pathViolation = pathSafetyViolation(arbitrationState.files, {
      path: message.path,
      ...(message.fromPath !== undefined ? { fromPath: message.fromPath } : {}),
    });
    if (pathViolation !== null) {
      this.failWs(ws, pathViolation.code, pathViolation.message);
      return;
    }

    // 2. Validate the content claim (mirrors InMemorySyncServer exactly).
    const inlineBytes = await this.verifyCommitContent(ws, message);
    if (inlineBytes === null) return; // error already sent

    // 3. Arbitrate with the shared core brain.
    const state = arbitrationState;
    const devices = new Map<string, string>(
      this.sql('SELECT id, name FROM devices').toArray().map((r) => [r.id as string, r.name as string]),
    );
    let verdict;
    try {
      verdict = arbitrateCommit(
        state,
        {
          path: message.path,
          parentVersion: message.parentVersion,
          hash: message.hash,
          size: message.size,
          kind: message.kind,
          ...(message.fromPath !== undefined ? { fromPath: message.fromPath } : {}),
          ...(message.isFolder !== undefined ? { isFolder: message.isFolder } : {}),
        },
        deviceId,
        now,
        devices,
      );
    } catch (error) {
      this.failWs(ws, 'PROTOCOL', error instanceof Error ? error.message : String(error));
      return;
    }

    // 4. Persist metadata: new versions, changed files rows.
    this.persistVerdict(state, verdict.state);

    // 5. Content: inline bytes go to R2; every newly referenced hash gains a
    //    refcount (orphan uploads sit at refcount 0; GC handles them).
    if (inlineBytes !== undefined) {
      await this.env.BUCKET.put(blobKey(message.hash), inlineBytes);
    }
    for (const version of verdict.state.versions.values()) {
      if (!state.versions.has(version.id) && version.hash !== '') {
        this.bumpBlobRefcount(version.hash, version.size, now);
      }
    }

    // 6. Record change events + reply + fan-out (in-memory server semantics:
    //    conflict-copy events go to ALL sockets, including the committer).
    const outcome = verdict.outcome;
    const headChanged = outcome.result === 'applied' || outcome.winner.deviceId === deviceId;
    const primary = headChanged ? this.recordChange(outcome.broadcast, now) : undefined;
    const copy = outcome.conflictCopy !== undefined ? this.recordChange(outcome.conflictCopy, now) : undefined;

    if (outcome.result === 'applied') {
      this.safeSend(ws, {
        type: 'commitAck',
        version: outcome.newVersionId,
        clock: outcome.clock,
        seq: primary !== undefined ? primary.seq : this.globalSeq(),
      });
    } else {
      const winnerSeq = primary !== undefined ? primary.seq : this.headSeqOf(outcome.winner.path);
      this.safeSend(ws, {
        type: 'conflict',
        winner: outcome.winner,
        loserDisposition: outcome.loserDisposition,
        ...(winnerSeq !== undefined ? { seq: winnerSeq } : {}),
      });
    }
    if (primary !== undefined) this.broadcastOthers(ws, primary);
    if (copy !== undefined) this.broadcastAll(copy);
  }

  /**
   * Validate a commit's shape before anything durable touches it: paths must
   * be CANONICAL vault paths (`normalizeVaultPath(p) === p` — so the stored
   * key can never diverge from the form every client normalizes to) that fit
   * in 1024 code units, hash must be empty or lowercase sha256 hex, and size
   * (when present) an integer within the blob cap. Returns the first
   * violation's message, or `null` if well-formed.
   */
  private commitShapeViolation(message: CommitMessage): string | null {
    try {
      const path = normalizeVaultPath(message.path);
      if (message.path !== path) {
        return `commit path must be a canonical vault path, got ${previewPath(message.path)}`;
      }
      if (path.length > COMMIT_PATH_MAX_LENGTH) {
        return `commit path exceeds ${COMMIT_PATH_MAX_LENGTH} UTF-16 code units`;
      }
      if (message.fromPath !== undefined) {
        const fromPath = normalizeVaultPath(message.fromPath);
        if (message.fromPath !== fromPath) {
          return `commit fromPath must be a canonical vault path, got ${previewPath(message.fromPath)}`;
        }
        if (fromPath.length > COMMIT_PATH_MAX_LENGTH) {
          return `commit fromPath exceeds ${COMMIT_PATH_MAX_LENGTH} UTF-16 code units`;
        }
      }
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    const hash: unknown = message.hash;
    if (hash !== undefined && hash !== '' && !/^[0-9a-f]{64}$/.test(hash as string)) {
      return 'commit hash must be empty or lowercase sha256 hex';
    }
    const size: unknown = message.size;
    if (
      size !== undefined &&
      (typeof size !== 'number' || !Number.isInteger(size) || size < 0 || size > WS_BLOB_MAX_BYTES)
    ) {
      return `commit size must be an integer between 0 and ${WS_BLOB_MAX_BYTES}`;
    }
    return null;
  }

  /**
   * Validate a commit's content claim. Returns inline bytes (to store in R2),
   * `undefined` for content-less commits, or `null` after sending an error.
   */
  private async verifyCommitContent(
    ws: WebSocket,
    message: CommitMessage,
  ): Promise<Uint8Array | undefined | null> {
    if (message.kind === 'delete' || message.isFolder === true) return undefined;
    if (message.inline !== undefined) {
      let bytes: Uint8Array;
      try {
        bytes = base64ToBytes(message.inline);
      } catch (error) {
        this.failWs(ws, 'PROTOCOL', error instanceof Error ? error.message : String(error));
        return null;
      }
      if (bytes.byteLength > INLINE_CONTENT_MAX_BYTES) {
        this.failWs(ws, 'PROTOCOL', `inline content of ${bytes.byteLength} bytes exceeds the cap`);
        return null;
      }
      if (bytes.byteLength !== message.size) {
        this.failWs(ws, 'PROTOCOL', `size ${message.size} does not match inline content (${bytes.byteLength})`);
        return null;
      }
      if ((await sha256Hex(bytes)) !== message.hash) {
        this.failWs(ws, 'PROTOCOL', 'inline content does not hash to the claimed hash');
        return null;
      }
      return bytes;
    }
    // No inline content: the blob must already exist — trust the blobs table,
    // fall back to an R2 head check (trust + verify lazily; GC handles orphans).
    // The refcount itself is bumped in step 4 of the commit path, once per new
    // version that references the hash.
    const known = this.sql('SELECT hash FROM blobs WHERE hash = ?', message.hash).toArray();
    if (known.length > 0) return undefined;
    const r2obj = await this.env.BUCKET.head(blobKey(message.hash));
    if (r2obj === null) {
      this.failWs(ws, 'NOT_FOUND', `blob ${message.hash} was not uploaded before commit`);
      return null;
    }
    this.upsertBlob(message.hash, r2obj.size, this.now());
    return undefined;
  }

  private async handlePutBlob(ws: WebSocket, hash: string, content: string): Promise<void> {
    let bytes: Uint8Array;
    try {
      bytes = base64ToBytes(content);
    } catch (error) {
      this.failWs(ws, 'PROTOCOL', error instanceof Error ? error.message : String(error));
      return;
    }
    if (bytes.byteLength > WS_BLOB_MAX_BYTES) {
      this.failWs(ws, 'PROTOCOL', `blob of ${bytes.byteLength} bytes exceeds the WS cap; use PUT /blob/:hash`);
      return;
    }
    if ((await sha256Hex(bytes)) !== hash) {
      this.failWs(ws, 'PROTOCOL', `putBlob content does not hash to ${hash}`);
      return;
    }
    await this.env.BUCKET.put(blobKey(hash), bytes);
    this.upsertBlob(hash, bytes.byteLength, this.now());
    this.safeSend(ws, { type: 'blobAck', hash });
  }

  private async handleGetBlob(ws: WebSocket, hash: string): Promise<void> {
    const obj = await this.env.BUCKET.get(blobKey(hash));
    if (obj === null) {
      this.failWs(ws, 'NOT_FOUND', `no blob for ${hash}`);
      return;
    }
    this.safeSend(ws, {
      type: 'blob',
      hash,
      content: bytesToBase64(new Uint8Array(await obj.arrayBuffer())),
    });
  }

  // --- snapshots --------------------------------------------------------------------------

  /**
   * Capture every file head as a vault-level snapshot. The `files` table
   * carries each head's full state (content hash, size, tombstone flag,
   * folder flag, head kind), so no join with `versions` is needed to
   * reconstruct the head state exactly. No fan-out: snapshots are pull-based
   * (`GET /api/snapshots`); other devices learn nothing live.
   */
  private handleSnapshotCreate(
    ws: WebSocket,
    attachment: SocketAttachment,
    message: SnapshotCreateMessage,
  ): void {
    const now = this.now();
    const heads = snapshotHeadsOf(this.loadArbitrationFiles());
    const fileCount = Object.keys(heads).length;
    const count = this.sql('SELECT COUNT(*) AS n FROM snapshots').toArray()[0]?.n as number;
    // Safe under runExclusive: snapshot creation cannot interleave.
    const id = `s${(count ?? 0) + 1}`;
    const name = message.name ?? '';
    if (name.length > SNAPSHOT_NAME_MAX_CHARS) {
      this.failWs(ws, 'PROTOCOL', `snapshot name exceeds ${SNAPSHOT_NAME_MAX_CHARS} characters`);
      return;
    }
    this.sql(
      'INSERT INTO snapshots (id, name, ts, device_id, seq, file_count, heads) VALUES (?, ?, ?, ?, ?, ?, ?)',
      id,
      name,
      now,
      attachment.deviceId,
      this.globalSeq(),
      fileCount,
      JSON.stringify(heads),
    );
    this.appendEvent(now, attachment.deviceId, 'snapshot', null, JSON.stringify({ id, name }));
    this.safeSend(ws, {
      type: 'snapshotCreateAck',
      id,
      name,
      ts: now,
      seq: this.globalSeq(),
      fileCount,
    });
  }

  /**
   * Revert the whole vault to a snapshot: N synthetic fast-path commits (one
   * per diverged path — `planSnapshotRestore` parents each on the path's
   * CURRENT head, so arbitration is deterministic and conflict-free), applied
   * in TWO phases so a whole-vault restore is safe on the DO's single thread:
   *
   *   Phase 1 (pure, no SQL): arbitrate EVERY item against the threaded
   *   in-memory state and collect the verdicts' durable footprints. The
   *   fast-path invariant is validated for the whole plan here, so a throw —
   *   the defensive invariant, or a runtime CPU-limit kill mid-plan on a big
   *   vault — leaves ZERO durable effect: nothing persisted, no events, no
   *   fan-out. No client can ever observe a partial restore whose events
   *   replay for reconnecting clients while connected peers saw no fan-out.
   *
   *   Phase 2 (durable): persist exactly what each verdict touched (one
   *   `versions` row + one `files` row — O(1) per item, so the restore stays
   *   linear in diverged paths instead of quadratic in vault size), bump blob
   *   refcounts from the COLLECTED new versions only, then record + fan out
   *   each change exactly like a client commit (reconnecting clients replay
   *   those event rows).
   *
   * Every restore change fans out to OTHER sockets, so all connected clients
   * converge live; the restoring client re-syncs from a full manifest (it
   * never sees its own fan-out). History is append-only: restore lands NEW
   * versions and bumps blob refcounts; nothing is ever deleted.
   */
  private handleSnapshotRestore(
    ws: WebSocket,
    attachment: SocketAttachment,
    message: SnapshotRestoreMessage,
  ): void {
    const row = this.sql('SELECT heads FROM snapshots WHERE id = ?', message.id).toArray()[0];
    if (row === undefined) {
      this.failWs(ws, 'NOT_FOUND', `no snapshot ${message.id}`);
      return;
    }
    const heads = JSON.parse(row.heads as string) as Record<string, SnapshotHeadRecord>;
    const deviceId = attachment.deviceId as string;
    const now = this.now();
    const devices = new Map<string, string>(
      this.sql('SELECT id, name FROM devices').toArray().map((r) => [r.id as string, r.name as string]),
    );

    // Phase 1 — plan + arbitrate the whole restore in memory (no SQL).
    const steps: SnapshotRestoreStep[] = [];
    let state = this.loadArbitrationState();
    for (const item of planSnapshotRestore(state, heads)) {
      const verdict = arbitrateCommit(state, item.commit, deviceId, now, devices);
      if (verdict.outcome.result !== 'applied') {
        throw new Error(`snapshot restore for ${JSON.stringify(item.path)} left the fast path`);
      }
      // An applied fast-path verdict mints exactly one head version and moves
      // exactly that path's file row — its entire durable footprint. (Restore
      // commits are 'delete'/'restore' kinds only; renames never occur.)
      const version = verdict.state.versions.get(verdict.outcome.newVersionId);
      const file = version !== undefined ? verdict.state.files.get(version.path) : undefined;
      if (version === undefined || file === undefined || file.currentVersion !== version.id) {
        throw new Error(`snapshot restore for ${JSON.stringify(item.path)} minted no head version`);
      }
      steps.push({ version, file, broadcast: verdict.outcome.broadcast, tombstone: item.tombstone });
      state = verdict.state;
    }

    // Phase 2 — durable effects. Per-change event rows and fan-out semantics
    // match a client commit exactly: seqs are assigned in plan order and the
    // fan-out follows the ack.
    for (const step of steps) {
      this.insertVersionRow(step.version);
      this.upsertFileRow(step.version.path, step.file);
    }
    for (const step of steps) {
      if (step.version.hash !== '') this.bumpBlobRefcount(step.version.hash, step.version.size, now);
    }
    let restored = 0;
    let tombstoned = 0;
    let lastSeq = this.globalSeq();
    const changes: ChangeMessage[] = [];
    for (const step of steps) {
      const change = this.recordChange(step.broadcast, now);
      changes.push(change);
      lastSeq = change.seq;
      if (step.tombstone) tombstoned += 1;
      else restored += 1;
    }
    this.appendEvent(
      now,
      deviceId,
      'snapshot_restore',
      null,
      JSON.stringify({ id: message.id, restored, tombstoned }),
    );
    this.safeSend(ws, {
      type: 'snapshotRestoreAck',
      id: message.id,
      restored,
      tombstoned,
      seq: lastSeq,
    });
    for (const change of changes) this.broadcastOthers(ws, change);
  }

  // --- HTTP surface (called by the worker's router) -------------------------------------------

  private async handleHttp(request: Request, url: URL, path: string): Promise<Response> {
    if (request.method === 'GET' && path === '/internal/health') {
      const claimed = await this.isClaimed();
      return json(200, { claimed, vaultName: claimed ? await this.getMeta('vault_name') : null });
    }
    if (request.method === 'POST' && path === '/claim') return this.httpClaim(request);
    if (request.method === 'POST' && path === '/admin/login') return this.httpAdminLogin(request);
    if (request.method === 'POST' && path === '/admin/logout') return this.httpAdminLogout(request);
    if (request.method === 'POST' && path === '/admin/passphrase-change') {
      return this.httpAdminPassphraseChange(request);
    }
    if (request.method === 'POST' && path === '/admin/pair') return this.httpAdminPair(request);
    if (request.method === 'POST' && path === '/admin/revoke') return this.httpAdminRevoke(request);
    if (request.method === 'POST' && path === '/admin/retention') return this.httpAdminRetention(request);
    if (request.method === 'POST' && path === '/admin/quota') return this.httpAdminQuota(request);
    if (request.method === 'POST' && path === '/pair') return this.httpPair(request);
    if (request.method === 'PATCH' && path === '/device') return this.httpDeviceRename(request);
    if (request.method === 'GET' && path === '/api/status') return this.httpStatus(request);
    if (request.method === 'GET' && path === '/api/history') return this.httpHistory(request, url);
    if (request.method === 'GET' && path === '/api/snapshots') return this.httpSnapshots(request);
    if (request.method === 'GET' && path === '/backup') return this.httpBackup(request);
    if (request.method === 'POST' && path === '/internal/retention') return this.httpRetentionRun();
    if (request.method === 'POST' && path === '/internal/auth') return this.httpInternalAuth(request);
    if (request.method === 'POST' && path === '/internal/blob-uploaded') return this.httpBlobUploaded(request);
    if (request.method === 'GET' && path === '/internal/gc') return this.httpGcList();
    if (request.method === 'POST' && path === '/internal/gc-purge') return this.httpGcPurge(request);
    if (request.method === 'POST' && path === '/internal/events-prune') return this.httpEventsPrune();
    return json(404, { error: 'not found' });
  }

  /** First-writer-wins claim (FR-22). Runs inside `runExclusive` (race guard). */
  private async httpClaim(request: Request): Promise<Response> {
    const body = (await request.json().catch(() => null)) as
      | { passphrase?: unknown; vaultName?: unknown }
      | null;
    if (
      body === null ||
      typeof body.passphrase !== 'string' ||
      body.passphrase.length < PASSPHRASE_MIN_CHARS ||
      typeof body.vaultName !== 'string' ||
      body.vaultName.trim().length === 0 ||
      body.vaultName.trim().length > VAULT_NAME_MAX_CHARS
    ) {
      return json(400, {
        error: `passphrase (min ${PASSPHRASE_MIN_CHARS} chars) and vaultName (max ${VAULT_NAME_MAX_CHARS} chars) are required`,
      });
    }
    if (await this.isClaimed()) {
      return json(409, { error: 'this worker has already been claimed' });
    }

    const now = this.now();
    await this.setAdminPassphrase(body.passphrase);
    await this.setMeta('session_secret', randomToken64url(32));
    await this.setMeta('vault_name', body.vaultName.trim());
    await this.setMeta('settings_obsidian_sync', '0');
    await this.setMeta('claimed_at', String(now));
    // Claiming registers NO device: the claim page immediately mints the
    // first PAIRING CODE (seeded with the name/type its form collected) and
    // the device comes to exist only when a client redeems that code. An
    // eagerly-registered "first device" would orphan a row — the browser
    // cannot use a device token — and produce a phantom offline device.
    this.appendEvent(now, null, 'claimed', body.vaultName.trim(), null);
    return json(200, { ok: true, vaultName: body.vaultName.trim() });
  }

  private async httpAdminLogin(request: Request): Promise<Response> {
    const ip = clientIpOf(request);
    const throttled = this.authThrottle(ip);
    if (throttled !== null) return throttled;
    const body = (await request.json().catch(() => null)) as { passphrase?: unknown } | null;
    if (body === null || typeof body.passphrase !== 'string') {
      return json(400, { error: 'passphrase is required' });
    }
    if (!(await this.verifyAdminPassphrase(body.passphrase))) {
      this.noteAuthFailure(ip, this.now());
      return json(401, { error: 'invalid passphrase' });
    }
    this.authFailures.delete(ip);
    const { value, expiresAt } = await this.signSession();
    return json(200, { ok: true, cookie: value, expiresAt });
  }

  /**
   * `POST /admin/passphrase-change` — rotate the admin passphrase. Requires a
   * valid admin session; `current` is re-verified against the stored argon2
   * hash (the same constant-time path as login).
   *
   * Semantics:
   *  - wrong `current` → 401 and counts toward the SAME per-IP auth-failure
   *    budget as `/admin/login` and `/pair` (a stolen session cookie must not
   *    become an unlimited passphrase-guessing surface);
   *  - success clears that budget (same as a successful login);
   *  - the new hash REPLACES `admin_argon` and the session secret ROTATES, so
   *    every admin cookie issued before this moment dies instantly — and the
   *    revocation floor (`sessions_not_before`) rises to NOW as well, so
   *    revocation does not silently depend on the secret rotation alone; the
   *    acting admin gets a fresh cookie back and stays signed in;
   *  - `next` may equal `current` (simpler semantics): it is still a real
   *    rotation — fresh salt, fresh session secret;
   *  - device tokens are untouched: they authenticate against
   *    `devices.token_hash`, not the passphrase or the session secret, so
   *    paired devices keep syncing straight through a change.
   */
  private async httpAdminPassphraseChange(request: Request): Promise<Response> {
    if (!(await this.requireAdmin(request))) return json(401, { error: 'admin session required' });
    const ip = clientIpOf(request);
    const throttled = this.authThrottle(ip);
    if (throttled !== null) return throttled;
    const body = (await request.json().catch(() => null)) as
      | { current?: unknown; next?: unknown }
      | null;
    if (
      body === null ||
      typeof body.current !== 'string' ||
      typeof body.next !== 'string' ||
      body.next.length < PASSPHRASE_MIN_CHARS
    ) {
      return json(400, {
        error: `current and next passphrase (min ${PASSPHRASE_MIN_CHARS} chars) are required`,
      });
    }
    if (!(await this.verifyAdminPassphrase(body.current))) {
      // The error text names the CURRENT passphrase on purpose: the dashboard
      // must tell a wrong-`current` 401 (inline form error) apart from a
      // stale-session 401 (back to the login view) at the same status code.
      this.noteAuthFailure(ip, this.now());
      return json(401, { error: 'invalid current passphrase' });
    }
    this.authFailures.delete(ip);

    const now = this.now();
    await this.setAdminPassphrase(body.next);
    // Rotate the session secret (any cookie signed with the old one — other
    // admin tabs, a stolen copy — fails HMAC verification on its next use)
    // AND raise the revocation floor: mint-then-verify, two independent kills.
    await this.setMeta('session_secret', randomToken64url(32));
    await this.setMeta(SESSIONS_NOT_BEFORE_KEY, String(now));
    this.appendEvent(now, null, 'passphrase_changed', null, null);
    const { value, expiresAt } = await this.signSession();
    return json(200, { ok: true, cookie: value, expiresAt });
  }

  /**
   * `POST /admin/logout` — server-side revocation, not just cookie clearing:
   * a VALID session bumps the revocation floor, so every outstanding admin
   * cookie (other tabs, stolen copies) dies at once. Unauthenticated calls
   * are no-ops that still answer 200 — logout stays idempotent, and a caller
   * without a valid session has no floor to bump.
   */
  private async httpAdminLogout(request: Request): Promise<Response> {
    if (await this.requireAdmin(request)) {
      await this.setMeta(SESSIONS_NOT_BEFORE_KEY, String(this.now()));
    }
    return json(200, { ok: true });
  }

  private async httpAdminPair(request: Request): Promise<Response> {
    if (!(await this.requireAdmin(request))) return json(401, { error: 'admin session required' });
    const body = (await request.json().catch(() => null)) as
      | { deviceName?: unknown; deviceType?: unknown }
      | null;
    if (body === null || typeof body.deviceName !== 'string' || body.deviceName.trim().length === 0) {
      return json(400, { error: 'deviceName is required' });
    }
    const deviceName = body.deviceName.trim();
    if (!isValidDeviceName(deviceName)) {
      return json(400, {
        error: `deviceName must be 1-${DEVICE_NAME_MAX_CHARS} characters, without control characters`,
      });
    }
    const deviceType = isDeviceType(body.deviceType) ? body.deviceType : 'desktop';
    const now = this.now();
    // Mint an unambiguous one-time code, XXXX-XXXX (FR-23). Characters are
    // drawn with rejection sampling (see CODE_ALPHABET_CEILING) so the 31-way
    // choice is exactly uniform per byte.
    let code = '';
    let codeHash = '';
    for (;;) {
      let normalized = '';
      while (normalized.length < CODE_LENGTH) {
        for (const byte of randomBytes(CODE_LENGTH * 2)) {
          if (normalized.length >= CODE_LENGTH) break;
          if (byte < CODE_ALPHABET_CEILING) {
            normalized += CODE_ALPHABET[byte % CODE_ALPHABET.length]!;
          }
        }
      }
      codeHash = await sha256Hex(normalized);
      if (this.sql('SELECT code_hash FROM pairs WHERE code_hash = ?', codeHash).toArray().length === 0) {
        code = `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
        break;
      }
    }
    this.sql(
      'INSERT INTO pairs (code_hash, device_name, device_type, expires_at, used, created_at) VALUES (?, ?, ?, ?, 0, ?)',
      codeHash,
      deviceName,
      deviceType,
      now + PAIR_TTL_MS,
      now,
    );
    return json(200, { ok: true, code, expiresAt: now + PAIR_TTL_MS });
  }

  private async httpAdminRevoke(request: Request): Promise<Response> {
    if (!(await this.requireAdmin(request))) return json(401, { error: 'admin session required' });
    const body = (await request.json().catch(() => null)) as { deviceId?: unknown } | null;
    if (body === null || typeof body.deviceId !== 'string') {
      return json(400, { error: 'deviceId is required' });
    }
    const rows = this.sql('SELECT id FROM devices WHERE id = ?', body.deviceId).toArray();
    if (rows.length === 0) return json(404, { error: 'unknown device' });
    this.sql('UPDATE devices SET revoked = 1 WHERE id = ?', body.deviceId);
    this.appendEvent(this.now(), body.deviceId, 'device_revoked', body.deviceId, null);
    // Revocation kills the device's live sockets too — otherwise an already
    // connected client keeps full access. Close code 4003 distinguishes it
    // from transport failures (clients re-hello and fail with REVOKED).
    for (const ws of this.ctx.getWebSockets()) {
      if (this.readAttachment(ws).deviceId !== body.deviceId) continue;
      this.safeSend(ws, { type: 'error', code: 'REVOKED', message: 'device was revoked' });
      try {
        ws.close(4003, 'revoked');
      } catch {
        // already closed
      }
    }
    return json(200, { ok: true });
  }

  /** Redeem a pairing code for a long-lived device token (FR-23). */
  private async httpPair(request: Request): Promise<Response> {
    const ip = clientIpOf(request);
    const throttled = this.authThrottle(ip);
    if (throttled !== null) return throttled;
    const body = (await request.json().catch(() => null)) as
      | { code?: unknown; deviceName?: unknown; deviceType?: unknown }
      | null;
    if (
      body === null ||
      typeof body.code !== 'string' ||
      typeof body.deviceName !== 'string' ||
      body.deviceName.trim().length === 0
    ) {
      return json(400, { error: 'code and deviceName are required' });
    }
    const deviceName = body.deviceName.trim();
    if (!isValidDeviceName(deviceName)) {
      return json(400, {
        error: `deviceName must be 1-${DEVICE_NAME_MAX_CHARS} characters, without control characters`,
      });
    }
    if (!(await this.isClaimed())) {
      return json(421, { error: 'worker is not claimed' });
    }
    const now = this.now();
    const codeHash = await sha256Hex(normalizeCode(body.code));
    const rows = this.sql('SELECT * FROM pairs WHERE code_hash = ?', codeHash).toArray() as unknown as PairRow[];
    const pair = rows[0];
    if (pair === undefined || pair.used === 1 || pair.expires_at <= now) {
      // Invalid, expired, and reused codes are all failed guesses: they
      // count toward the per-IP budget BEFORE the response goes out.
      this.noteAuthFailure(ip, now);
      return json(401, { error: 'pairing code is invalid, expired, or already used' });
    }
    // Burn the code (one-time) and mint the device. The dashboard seeded the
    // code with the operator-entered name/type ("Pair new device" / the claim
    // form's "First device to pair") — that intent WINS over the client's
    // own name, which is only a fallback for codes minted without one. This
    // is what makes the dashboard forms' "shown in the device list" promise
    // true, and keeps one code → one correctly-named device.
    this.sql('UPDATE pairs SET used = 1 WHERE code_hash = ?', codeHash);
    const codeName =
      typeof pair.device_name === 'string' && pair.device_name.trim() !== ''
        ? pair.device_name.trim()
        : deviceName;
    const deviceType = isDeviceType(pair.device_type)
      ? pair.device_type
      : isDeviceType(body.deviceType)
        ? body.deviceType
        : 'desktop';
    const { token, deviceId } = await this.registerDevice(codeName, deviceType, now);
    this.appendEvent(now, deviceId, 'device_paired', codeName, null);
    this.authFailures.delete(ip);
    return json(200, { ok: true, token, deviceId });
  }

  /**
   * `PATCH /device` — device self-service rename (the plugin settings tab's
   * "Rename device" button). Device tokens ONLY: the Bearer token identifies
   * the one device being renamed (a `deviceId` in the body is ignored — the
   * token can never reach another device), and an admin session cookie is
   * deliberately not accepted here; admin-side renames would be a separate,
   * admin-scoped route.
   */
  private async httpDeviceRename(request: Request): Promise<Response> {
    const auth = await this.authenticateHttpRequest(request);
    if (!auth.ok || auth.kind !== 'device') {
      return json(401, { error: 'device token required (admin sessions cannot rename devices)' });
    }
    const body = (await request.json().catch(() => null)) as { name?: unknown } | null;
    const name = typeof body?.name === 'string' ? body.name.trim() : '';
    if (!isValidDeviceName(name)) {
      return json(400, {
        error: `name must be 1-${DEVICE_NAME_MAX_CHARS} characters, without control characters`,
      });
    }
    const now = this.now();
    const row = this.sql('SELECT name FROM devices WHERE id = ?', auth.deviceId).toArray()[0];
    const previous = row?.name as string | undefined;
    this.sql('UPDATE devices SET name = ?, last_seen = ? WHERE id = ?', name, now, auth.deviceId);
    this.appendEvent(
      now,
      auth.deviceId,
      'device_renamed',
      null,
      JSON.stringify({ from: previous ?? null, to: name }),
    );
    const device = this.sql('SELECT id, name, type FROM devices WHERE id = ?', auth.deviceId).toArray()[0];
    return json(200, {
      ok: true,
      device: { id: device?.id ?? auth.deviceId, name: device?.name ?? name, type: device?.type ?? 'desktop' },
    });
  }

  /** Status document for the dashboard/CLI (FR-31). */
  private async httpStatus(request: Request): Promise<Response> {
    const auth = await this.authenticateHttpRequest(request);
    if (!auth.ok) return json(401, { error: 'device token or admin session required' });
    const now = this.now();
    const vaultName = (await this.getMeta('vault_name')) ?? '';

    const devices = (
      this.sql('SELECT * FROM devices ORDER BY created_at ASC').toArray() as unknown as DeviceRow[]
    ).map((d) => ({
      id: d.id,
      name: d.name,
      type: d.type,
      lastSeen: d.last_seen,
      revoked: d.revoked === 1,
      online: d.revoked === 0 && now - d.last_seen < ONLINE_WINDOW_MS,
    }));

    const lastEditRow = this.sql(
      "SELECT ts, device_id, path FROM events WHERE kind = 'change' ORDER BY id DESC LIMIT 1",
    ).toArray()[0];
    const lastEdit =
      lastEditRow !== undefined
        ? {
            ts: lastEditRow.ts as number,
            deviceId: lastEditRow.device_id as string,
            path: lastEditRow.path as string,
          }
        : null;

    const attachmentRow = this.sql(
      "SELECT COUNT(*) AS count, COALESCE(SUM(head_size), 0) AS bytes FROM files WHERE deleted = 0 AND is_folder = 0 AND path NOT LIKE '%.md'",
    ).toArray()[0];
    const storageRow = this.sql('SELECT COALESCE(SUM(size), 0) AS bytes FROM blobs').toArray()[0];

    const recentEvents = this.sql(
      'SELECT seq, ts, device_id, kind, path FROM events ORDER BY id DESC LIMIT 50',
    )
      .toArray()
      .map((row) => ({
        seq: (row.seq as number | null) ?? null,
        ts: row.ts as number,
        deviceId: (row.device_id as string | null) ?? null,
        kind: row.kind as string,
        path: (row.path as string | null) ?? null,
      }));

    return json(200, {
      vaultName,
      claimed: true,
      health: 'ok',
      serverVersion: SERVER_VERSION,
      devices,
      lastEdit,
      attachments: { count: attachmentRow?.count ?? 0, bytes: attachmentRow?.bytes ?? 0 },
      storageBytes: storageRow?.bytes ?? 0,
      quota: await this.quotaState(Number(storageRow?.bytes ?? 0)),
      retention: {
        days: await this.intMeta('settings_retention_days', 0),
        versions: await this.intMeta('settings_retention_versions', 0),
      },
      recentEvents,
    });
  }

  /**
   * The advisory quota state for a storage byte total (see the constants'
   * doc): `off` when both knobs are 0, `warn` at/over warnBytes, `over` at/
   * over hardBytes, else `ok`. Pure metadata — surfaced, never enforced.
   */
  private async quotaState(storageBytes: number): Promise<{
    warnBytes: number;
    hardBytes: number;
    state: 'ok' | 'warn' | 'over' | 'off';
  }> {
    const warnBytes = await this.intMeta('settings_quota_warn_bytes', QUOTA_WARN_DEFAULT_BYTES);
    const hardBytes = await this.intMeta('settings_quota_hard_bytes', QUOTA_HARD_DEFAULT_BYTES);
    const state =
      warnBytes === 0 && hardBytes === 0
        ? 'off'
        : hardBytes !== 0 && storageBytes >= hardBytes
          ? 'over'
          : warnBytes !== 0 && storageBytes >= warnBytes
            ? 'warn'
            : 'ok';
    return { warnBytes, hardBytes, state };
  }

  /** `meta` integer read with a default (unset/invalid → `fallback`). */
  private async intMeta(key: string, fallback: number): Promise<number> {
    const raw = await this.getMeta(key);
    if (raw === null) return fallback;
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
  }

  /**
   * `POST /admin/quota` — advisory storage thresholds (bytes; 0 disables).
   * Values are clamped to [0, 1 TiB]; a hard threshold below the warn
   * threshold is accepted as-is (the stricter one simply fires first).
   */
  private async httpAdminQuota(request: Request): Promise<Response> {
    if (!(await this.requireAdmin(request))) return json(401, { error: 'admin session required' });
    const body = (await request.json().catch(() => null)) as
      | { warnBytes?: unknown; hardBytes?: unknown }
      | null;
    const clamp = (value: unknown): number | null => {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) return null;
      return Math.min(value, 1024 ** 4);
    };
    if (
      body === null ||
      (body.warnBytes === undefined && body.hardBytes === undefined) ||
      (body.warnBytes !== undefined && clamp(body.warnBytes) === null) ||
      (body.hardBytes !== undefined && clamp(body.hardBytes) === null)
    ) {
      return json(400, { error: 'warnBytes/hardBytes must be integer bytes (0 to disable)' });
    }
    if (body.warnBytes !== undefined) {
      await this.setMeta('settings_quota_warn_bytes', String(clamp(body.warnBytes)));
    }
    if (body.hardBytes !== undefined) {
      await this.setMeta('settings_quota_hard_bytes', String(clamp(body.hardBytes)));
    }
    return json(200, { ok: true, quota: await this.quotaState(await this.storageBytes()) });
  }

  /** Total bytes across all tracked blobs (quota input). */
  private async storageBytes(): Promise<number> {
    const row = this.sql('SELECT COALESCE(SUM(size), 0) AS bytes FROM blobs').toArray()[0];
    return (row?.bytes as number) ?? 0;
  }

  /**
   * `POST /admin/retention` — history bounding (the free-tier growth lever).
   * `days`: drop non-head versions older than N days. `versions`: keep at
   * most N non-head versions per path (newest win). Both default 0 = keep
   * forever (today's FR-7 behavior); each applies independently, and
   * snapshot-referenced versions are ALWAYS pinned (a snapshot that cannot
   * be restored would be a silent lie).
   */
  private async httpAdminRetention(request: Request): Promise<Response> {
    if (!(await this.requireAdmin(request))) return json(401, { error: 'admin session required' });
    const body = (await request.json().catch(() => null)) as
      | { days?: unknown; versions?: unknown }
      | null;
    const validDays =
      body?.days === undefined ? undefined : typeof body.days === 'number' && Number.isInteger(body.days) && body.days >= 0 && body.days <= RETENTION_MAX_DAYS;
    const validVersions =
      body?.versions === undefined
        ? undefined
        : typeof body.versions === 'number' &&
          Number.isInteger(body.versions) &&
          body.versions >= 0 &&
          body.versions <= RETENTION_MAX_VERSIONS;
    if (body === null || (validDays === false && validVersions === undefined) || (validVersions === false && validDays === undefined) || (validDays === false && validVersions === false)) {
      return json(400, {
        error: `days (0..${RETENTION_MAX_DAYS}) and versions (0..${RETENTION_MAX_VERSIONS}) must be integers; 0 disables`,
      });
    }
    if (validDays === true) await this.setMeta('settings_retention_days', String(body?.days));
    if (validVersions === true) await this.setMeta('settings_retention_versions', String(body?.versions));
    return json(200, {
      ok: true,
      retention: {
        days: await this.intMeta('settings_retention_days', 0),
        versions: await this.intMeta('settings_retention_versions', 0),
      },
    });
  }

  /**
   * `POST /internal/retention` — the weekly cron's history-compaction pass
   * (runs before GC so freed blobs are collected the same night). Inside
   * `runExclusive` (the DO's serialized queue): commits cannot interleave.
   *
   * Never deleted: every path's HEAD version, and every version id any
   * snapshot references (restorability is absolute). Each deletion drops
   * its blob refcount by one; the GC's confirm-then-purge pass is what
   * actually removes R2 objects, so a version re-referenced between here
   * and GC still wins.
   */
  private async httpRetentionRun(): Promise<Response> {
    const retentionDays = await this.intMeta('settings_retention_days', 0);
    const retentionVersions = await this.intMeta('settings_retention_versions', 0);
    if (retentionDays === 0 && retentionVersions === 0) {
      return json(200, { removed: 0, skipped: 'retention disabled' });
    }
    const cutoff = this.now() - retentionDays * 24 * 60 * 60 * 1000;

    // Protected ids: every head, plus everything snapshots point at.
    const protectedIds = new Set<string>();
    for (const row of this.sql('SELECT current_version FROM files').toArray()) {
      protectedIds.add(row.current_version as string);
    }
    for (const row of this.sql('SELECT heads FROM snapshots').toArray()) {
      // `heads` is a path → SnapshotHeadRecord map (snapshots.ts), not an array.
      const heads = JSON.parse(row.heads as string) as Record<string, { version?: string }>;
      for (const head of Object.values(heads)) {
        if (head.version !== undefined) protectedIds.add(head.version);
      }
    }

    // Per path (versions newest-first): age-doomed candidates drop by `days`;
    // of the REMAINING non-head versions, only the newest `versions` survive.
    const doomed: Array<{ id: string; hash: string }> = [];
    const paths = new Map<string, Array<{ id: string; hash: string; ts: number }>>();
    for (const row of this.sql(
      'SELECT path, id, hash, ts FROM versions ORDER BY path ASC, ts DESC, id DESC',
    ).toArray()) {
      const path = row.path as string;
      const list = paths.get(path) ?? [];
      list.push({ id: row.id as string, hash: row.hash as string, ts: row.ts as number });
      paths.set(path, list);
    }
    for (const versions of paths.values()) {
      let survivors = 0;
      for (const version of versions) {
        if (protectedIds.has(version.id)) continue; // heads + snapshot pins
        const expired = retentionDays !== 0 && version.ts < cutoff;
        if (expired || (retentionVersions !== 0 && survivors >= retentionVersions)) {
          doomed.push(version);
          continue;
        }
        survivors += 1;
      }
    }

    let refcountDrops = 0;
    for (const version of doomed) {
      this.sql('DELETE FROM versions WHERE id = ?', version.id);
      if (version.hash !== '') {
        this.sql('UPDATE blobs SET refcount = MAX(refcount - 1, 0) WHERE hash = ?', version.hash);
        refcountDrops += 1;
      }
    }
    return json(200, { removed: doomed.length, refcountDrops, retentionDays, retentionVersions });
  }

  /**
   * `GET /backup` — the trust escape hatch: the ENTIRE vault (heads, full
   * version history, every distinct blob) as one streamed NDJSON archive:
   *
   *   {"type":"meta",…}               vault name, generated-at, counts
   *   {"type":"file",…}               one per live/tombstoned head
   *   {"type":"version",…}            one per version row (the history)
   *   {"type":"blob","hash":…}        one per distinct content hash
   *   {"type":"blob-missing","hash":…} GC raced a blob away (rare; noted)
   *
   * All SQL is drained BEFORE the response returns (the DO's serialized
   * queue is held only for the fast metadata phase); the R2 stream then
   * reads outside the lock. Device token or admin session — it is the
   * owner's data by construction.
   */
  private async httpBackup(request: Request): Promise<Response> {
    const auth = await this.authenticateHttpRequest(request);
    if (!auth.ok) return json(401, { error: 'device token or admin session required' });

    const files = this.sql('SELECT * FROM files ORDER BY path ASC').toArray();
    const versions = this.sql(
      'SELECT id, path, hash, size, device_id, clock_counter, clock_device, ts, kind FROM versions ORDER BY path ASC, ts ASC, id ASC',
    ).toArray();
    const blobs = this.sql('SELECT hash, size FROM blobs ORDER BY hash ASC').toArray();
    const vaultName = (await this.getMeta('vault_name')) ?? '';
    const generated = this.now();

    const encoder = new TextEncoder();
    const line = (value: unknown): Uint8Array => encoder.encode(`${JSON.stringify(value)}\n`);
    const headerRows = [
      line({
        type: 'meta',
        format: 1,
        vaultName,
        generated,
        fileCount: files.length,
        versionCount: versions.length,
        blobCount: blobs.length,
      }),
      ...files.map((row) =>
        line({
          type: 'file',
          path: row.path,
          version: row.current_version,
          hash: row.head_hash,
          size: row.head_size,
          deleted: (row.deleted as number) === 1,
          isFolder: (row.is_folder as number) === 1,
        }),
      ),
      ...versions.map((row) =>
        line({
          type: 'version',
          path: row.path,
          id: row.id,
          hash: row.hash,
          size: row.size,
          deviceId: row.device_id,
          clock: { counter: row.clock_counter, deviceId: row.clock_device },
          ts: row.ts,
          kind: row.kind,
        }),
      ),
    ];

    const blobRows = blobs as Array<{ hash: string; size: number }>;
    const bucket = this.env.BUCKET;
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        // Header + version rows first (already in memory)…
        if (headerRows.length > 0) {
          controller.enqueue(headerRows.shift());
          return; // one chunk per pull keeps memory flat
        }
        const blob = blobRows.shift();
        if (blob === undefined) {
          controller.close();
          return;
        }
        const object = await bucket.get(blobKey(blob.hash)).catch(() => null);
        if (object === null) {
          controller.enqueue(line({ type: 'blob-missing', hash: blob.hash }));
          return;
        }
        const bytes = new Uint8Array(await object.arrayBuffer());
        controller.enqueue(
          line({
            type: 'blob',
            hash: blob.hash,
            size: bytes.byteLength,
            content: bytesToBase64(bytes),
          }),
        );
      },
    });

    return new Response(stream, {
      headers: {
        'content-type': 'application/x-ndjson; charset=utf-8',
        'content-disposition': `attachment; filename="vaultsync-backup.ndjson"`,
        'cache-control': 'no-store',
      },
    });
  }

  /**
   * Version chain for one path (FR-54: `vsa history` / `vsa restore`).
   * Read-only, newest-first, with the current head flagged. Device token or
   * admin session; restore is CLIENT-side (fetch the old blob, write, commit).
   */
  private async httpHistory(request: Request, url: URL): Promise<Response> {
    const auth = await this.authenticateHttpRequest(request);
    if (!auth.ok) return json(401, { error: 'device token or admin session required' });
    const path = url.searchParams.get('path');
    if (path === null || path.trim() === '' || !path.startsWith('/')) {
      return json(400, { error: 'query parameter path (absolute vault path) is required' });
    }

    const headRow = this.sql(
      'SELECT current_version, deleted FROM files WHERE path = ?',
      path,
    ).toArray()[0];
    const head =
      headRow === undefined
        ? null
        : { versionId: headRow.current_version as string, deleted: (headRow.deleted as number) === 1 };

    const versions = this.sql(
      `SELECT id, hash, size, device_id, clock_counter, clock_device, ts, kind
         FROM versions WHERE path = ? ORDER BY ts DESC, clock_counter DESC, id DESC`,
      path,
    ).toArray().map((row) => ({
      id: row.id as string,
      hash: row.hash as string,
      size: row.size as number,
      deviceId: row.device_id as string,
      clock: { counter: row.clock_counter as number, deviceId: row.clock_device as string },
      ts: row.ts as number,
      kind: row.kind as string,
      current: head !== null && head.versionId === (row.id as string),
    }));

    return json(200, { path, head, versions });
  }

  /**
   * `GET /api/snapshots` — vault-level snapshot list, newest-first
   * (`vsa snapshot list`, dashboards). Device token or admin session, like
   * `/api/status`.
   */
  private async httpSnapshots(request: Request): Promise<Response> {
    const auth = await this.authenticateHttpRequest(request);
    if (!auth.ok) return json(401, { error: 'device token or admin session required' });
    const snapshots = this.sql(
      'SELECT id, name, ts, device_id, seq, file_count FROM snapshots ORDER BY ts DESC, rowid DESC',
    )
      .toArray()
      .map((row) => ({
        id: row.id as string,
        name: row.name as string,
        ts: row.ts as number,
        deviceId: row.device_id as string,
        seq: row.seq as number,
        fileCount: row.file_count as number,
      }));
    return json(200, { snapshots });
  }

  /** Bearer/cookie check used by the worker for /blob and /api/status. */
  private async httpInternalAuth(request: Request): Promise<Response> {
    const auth = await this.authenticateHttpRequest(request);
    if (!auth.ok) return json(401, { error: 'unauthorized' });
    return json(200, {
      ok: true,
      kind: auth.kind,
      ...(auth.kind === 'device' ? { deviceId: auth.deviceId } : {}),
    });
  }

  private async httpBlobUploaded(request: Request): Promise<Response> {
    const body = (await request.json().catch(() => null)) as { hash?: unknown; size?: unknown } | null;
    if (body === null || typeof body.hash !== 'string' || typeof body.size !== 'number') {
      return json(400, { error: 'hash and size are required' });
    }
    this.upsertBlob(body.hash, body.size, this.now());
    return json(200, { ok: true });
  }

  /** Orphans: refcount 0 and older than the grace window (§7). */
  private httpGcList(): Response {
    const cutoff = this.now() - GC_GRACE_MS;
    const rows = this.sql('SELECT hash FROM blobs WHERE refcount = 0 AND first_seen_at < ?', cutoff).toArray();
    return json(200, { orphans: rows.map((r) => r.hash as string) });
  }

  /**
   * Drop the bookkeeping rows for GC-listed hashes — but only those whose
   * refcount is STILL 0 when the purge runs (inside `runExclusive`, so no
   * commit can interleave with the re-check). The caller deletes R2 content
   * for the confirmed `purged` list only: a commit that re-referenced a
   * listed orphan between listing and purge keeps both its row and its blob.
   */
  private async httpGcPurge(request: Request): Promise<Response> {
    const body = (await request.json().catch(() => null)) as { hashes?: unknown } | null;
    if (body === null || !Array.isArray(body.hashes)) {
      return json(400, { error: 'hashes array is required' });
    }
    const purged: string[] = [];
    for (const hash of body.hashes) {
      if (typeof hash !== 'string') continue;
      const row = this.sql('SELECT refcount FROM blobs WHERE hash = ?', hash).toArray()[0];
      if (row !== undefined && (row.refcount as number) === 0) {
        this.sql('DELETE FROM blobs WHERE hash = ?', hash);
        purged.push(hash);
      }
    }
    return json(200, { ok: true, purged });
  }

  /** Cron-driven events pruning (§6); the opportunistic path covers the gaps. */
  private httpEventsPrune(): Response {
    this.pruneEventsNow(this.now());
    return json(200, { ok: true });
  }

  // --- auth plumbing --------------------------------------------------------------------------

  /**
   * Per-IP failure budget check for the guessing surfaces (§3, §14). Returns
   * a 429 (with `Retry-After` seconds and a JSON error) once `ip` has hit the
   * limit inside the window, else `null` so the caller proceeds.
   */
  private authThrottle(ip: string): Response | null {
    const entry = this.authFailures.get(ip);
    if (entry === undefined) return null;
    const ts = this.now();
    if (ts - entry.windowStart >= AUTH_FAILURE_WINDOW_MS) {
      this.authFailures.delete(ip); // window closed: fresh budget
      return null;
    }
    if (entry.count < AUTH_FAILURE_LIMIT) return null;
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((entry.windowStart + AUTH_FAILURE_WINDOW_MS - ts) / 1000),
    );
    return new Response(JSON.stringify({ error: 'too many failed attempts from this address; retry later' }), {
      status: 429,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'retry-after': String(retryAfterSeconds),
      },
    });
  }

  /** Count a failed guess; a window that has closed starts a fresh one. */
  private noteAuthFailure(ip: string, ts: number): void {
    const entry = this.authFailures.get(ip);
    if (entry === undefined || ts - entry.windowStart >= AUTH_FAILURE_WINDOW_MS) {
      this.authFailures.set(ip, { count: 1, windowStart: ts });
      return;
    }
    entry.count += 1;
  }

  private async isClaimed(): Promise<boolean> {
    return (await this.getMeta('claimed_at')) !== null;
  }

  private async verifyAdminPassphrase(passphrase: string): Promise<boolean> {
    const raw = await this.getMeta('admin_argon');
    if (raw === null) return false;
    const record = JSON.parse(raw) as {
      salt: string;
      hash: string;
      params: { t: number; m: number; p: number; dkLen: number };
    };
    const candidate = toHex(
      argon2id(new TextEncoder().encode(passphrase), hexToBytes(record.salt), { ...record.params }),
    );
    return timingSafeEqualHex(candidate, record.hash);
  }

  /**
   * Hash `passphrase` with a fresh random salt and store the argon2 record —
   * the single write path shared by claim and passphrase-change.
   */
  private async setAdminPassphrase(passphrase: string): Promise<void> {
    const salt = randomBytes(16);
    const hashBytes = argon2id(new TextEncoder().encode(passphrase), salt, { ...ARGON2_PARAMS });
    await this.setMeta(
      'admin_argon',
      JSON.stringify({ algo: 'argon2id', salt: toHex(salt), hash: toHex(hashBytes), params: ARGON2_PARAMS }),
    );
  }

  /**
   * Mint an admin session: a random 128-bit session id plus the expiry,
   * MAC-ed together (`admin:<sessionId>:<expiresAt>`). The id makes every
   * session's cookie distinct; revocation rides the floor in requireAdmin,
   * checked against the implied issue time (`expiresAt − SESSION_TTL_MS`), so
   * the cookie stays fully self-describing with no server-side session state.
   */
  private async signSession(): Promise<{ value: string; expiresAt: number }> {
    const secretB64 = await this.getMeta('session_secret');
    if (secretB64 === null) throw new Error('worker is not claimed');
    const sessionId = randomToken64url(16);
    const expiresAt = this.now() + SESSION_TTL_MS;
    const mac = await hmacHex(base64UrlToBytes(secretB64), `admin:${sessionId}:${expiresAt}`);
    return { value: `${sessionId}.${expiresAt}.${mac}`, expiresAt };
  }

  /**
   * Valid admin session cookie on the request? (HMAC-SHA256, §3.)
   *
   * A cookie is dead when its expiry passed OR when it was minted before the
   * revocation floor (`meta.sessions_not_before`, epoch ms): `logout` bumps
   * the floor (sign-out kills EVERY outstanding session — other tabs, stolen
   * copies), and `passphrase-change` bumps it alongside the secret rotation.
   */
  private async requireAdmin(request: Request): Promise<boolean> {
    const cookie = request.headers.get('cookie');
    if (cookie === null) return false;
    const match = cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${ADMIN_COOKIE_NAME}=`));
    if (match === undefined) return false;
    const parts = match.slice(ADMIN_COOKIE_NAME.length + 1).split('.');
    if (parts.length !== 3) return false;
    const [sessionId, expiresRaw, mac] = parts as [string, string, string];
    if (!/^[A-Za-z0-9_-]{16,}$/.test(sessionId)) return false;
    const expiresAt = Number(expiresRaw);
    if (!Number.isFinite(expiresAt) || expiresAt <= this.now()) return false;
    const notBefore = Number((await this.getMeta(SESSIONS_NOT_BEFORE_KEY)) ?? '0');
    if (Number.isFinite(notBefore) && expiresAt - SESSION_TTL_MS < notBefore) return false;
    const secretB64 = await this.getMeta('session_secret');
    if (secretB64 === null) return false;
    const expected = await hmacHex(base64UrlToBytes(secretB64), `admin:${sessionId}:${expiresAt}`);
    return timingSafeEqualHex(mac, expected);
  }

  /** Device token (Bearer) or admin cookie — used by HTTP routes. */
  private async authenticateHttpRequest(
    request: Request,
  ): Promise<{ ok: false } | { ok: true; kind: 'admin' } | { ok: true; kind: 'device'; deviceId: string }> {
    const header = request.headers.get('authorization');
    if (header !== null && header.startsWith('Bearer ')) {
      const device = await this.lookupDeviceByToken(header.slice('Bearer '.length));
      if (device === undefined || device.row.revoked === 1) return { ok: false };
      return { ok: true, kind: 'device', deviceId: device.row.id };
    }
    if (await this.requireAdmin(request)) return { ok: true, kind: 'admin' };
    return { ok: false };
  }

  /** Token → device row (tokens are stored SHA-256-hashed only, §14). */
  private async lookupDeviceByToken(token: string): Promise<{ row: DeviceRow; viaGrace: boolean } | undefined> {
    const tokenHash = await sha256Hex(token);
    const rows = this.sql('SELECT * FROM devices WHERE token_hash = ?', tokenHash).toArray();
    if (rows.length > 0) return { row: rows[0] as unknown as DeviceRow, viaGrace: false };
    // Rotation grace: the PREVIOUS token stays valid for a bounded window so
    // a process that missed the helloAck hand-off (crash mid-cycle, an
    // unwired older client) survives to its next connect instead of wedging.
    const previous = this.sql(
      'SELECT * FROM devices WHERE prev_token_hash = ? AND prev_token_expires_at > ?',
      tokenHash,
      this.now(),
    ).toArray();
    return previous[0] !== undefined
      ? { row: previous[0] as unknown as DeviceRow, viaGrace: true }
      : undefined;
  }

  private async registerDevice(
    name: string,
    type: DeviceType,
    now: number,
  ): Promise<{ token: string; deviceId: string }> {
    const token = randomToken64url(32);
    const deviceId = `dev-${toHex(randomBytes(6))}`;
    // last_seen starts at 0: registration is not authenticated contact, so a
    // freshly paired device reads "offline" until its first hello/bearer use.
    this.sql(
      'INSERT INTO devices (id, name, type, token_hash, created_at, last_seen, revoked, token_issued_at, prev_token_expires_at) VALUES (?, ?, ?, ?, ?, 0, 0, ?, 0)',
      deviceId,
      name,
      type,
      await sha256Hex(token),
      now,
      now,
    );
    return { token, deviceId };
  }

  // --- arbitration state bridge -----------------------------------------------------------------

  /** Load `files` + `versions` as the pure arbitration state (§6 ↔ arbitrate.ts). */
  private loadArbitrationState(): ArbitrationState {
    const files = this.loadArbitrationFiles();
    const versions = new Map<string, Version>();
    for (const row of this.sql(
      'SELECT id, path, hash, size, device_id, clock_counter, clock_device, parent_id, ts, kind FROM versions',
    ).toArray()) {
      const id = row.id as string;
      versions.set(id, {
        id,
        path: row.path as string,
        hash: row.hash as string,
        size: row.size as number,
        deviceId: row.device_id as string,
        clock: { counter: row.clock_counter as number, deviceId: row.clock_device as string },
        parentVersion: (row.parent_id as string | null) ?? null,
        ts: row.ts as number,
        kind: row.kind as VersionKind,
      });
    }
    return { files, versions };
  }

  /** The `files` table alone as the arbitration file map (snapshot capture). */
  private loadArbitrationFiles(): Map<string, ArbitrationFileState> {
    const files = new Map<string, ArbitrationFileState>();
    for (const row of this.sql(
      `SELECT path, current_version, deleted, is_folder, head_hash, head_size,
              head_clock_counter, head_clock_device, head_kind, updated_at FROM files`,
    ).toArray()) {
      const path = row.path as string;
      const deviceId = row.head_clock_device as string;
      const head: Version = {
        id: row.current_version as string,
        path,
        hash: row.head_hash as string,
        size: row.head_size as number,
        deviceId,
        clock: { counter: row.head_clock_counter as number, deviceId },
        parentVersion: null,
        ts: row.updated_at as number,
        kind: row.head_kind as VersionKind,
      };
      files.set(path, {
        currentVersion: head.id,
        head,
        deleted: (row.deleted as number) === 1,
        ...(row.is_folder === 1 ? { isFolder: true } : {}),
      });
    }
    return files;
  }

  /** Diff the verdict's state against the pre-arbitration state and write it. */
  private persistVerdict(before: ArbitrationState, after: ArbitrationState): void {
    for (const [id, version] of after.versions) {
      if (before.versions.has(id)) continue;
      this.insertVersionRow(version);
    }
    for (const [path, state] of after.files) {
      const old = before.files.get(path);
      if (old !== undefined && old.currentVersion === state.currentVersion) continue;
      this.upsertFileRow(path, state);
    }
    for (const path of before.files.keys()) {
      if (!after.files.has(path)) this.sql('DELETE FROM files WHERE path = ?', path);
    }
  }

  /** Insert one `versions` row (seq 0 — head_seq assignment is recordChange's). */
  private insertVersionRow(version: Version): void {
    this.sql(
      `INSERT INTO versions (id, path, hash, size, device_id, clock_counter, clock_device, parent_id, ts, kind, seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      version.id,
      version.path,
      version.hash,
      version.size,
      version.deviceId,
      version.clock.counter,
      version.clock.deviceId,
      version.parentVersion,
      version.ts,
      version.kind,
    );
  }

  /**
   * Upsert one `files` row. head_seq is NOT overwritten on conflict (see
   * recordChange); a fresh row starts at 0 (invisible to delta manifests until
   * first recorded).
   */
  private upsertFileRow(path: string, state: ArbitrationFileState): void {
    this.sql(
      `INSERT INTO files (path, current_version, deleted, is_folder, updated_at, head_hash,
                          head_size, head_clock_counter, head_clock_device, head_kind, head_seq)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
       ON CONFLICT(path) DO UPDATE SET current_version = excluded.current_version,
         deleted = excluded.deleted, is_folder = excluded.is_folder,
         updated_at = excluded.updated_at, head_hash = excluded.head_hash,
         head_size = excluded.head_size, head_clock_counter = excluded.head_clock_counter,
         head_clock_device = excluded.head_clock_device, head_kind = excluded.head_kind`,
      path,
      state.currentVersion,
      state.deleted ? 1 : 0,
      state.isFolder === true ? 1 : 0,
      state.head.ts,
      state.head.hash,
      state.head.size,
      state.head.clock.counter,
      state.head.clock.deviceId,
      state.head.kind,
    );
  }

  /** Assign the next global seq to a change, persist its event, update head_seq. */
  private recordChange(payload: ChangePayload, ts: number): ChangeMessage {
    const seq = this.bumpGlobalSeq();
    const change: ChangeMessage = { type: 'change', seq, ...payload };
    this.sql(
      'INSERT INTO events (ts, device_id, kind, path, seq, detail) VALUES (?, ?, ?, ?, ?, ?)',
      ts,
      payload.device,
      'change',
      payload.path,
      seq,
      JSON.stringify(change),
    );
    this.maybePruneEvents();
    this.sql('UPDATE files SET head_seq = ? WHERE path = ?', seq, payload.path);
    if (payload.kind === 'rename' && payload.fromPath !== undefined) {
      this.sql('DELETE FROM files WHERE path = ?', payload.fromPath);
    }
    return change;
  }

  private headSeqOf(path: string): number | undefined {
    const row = this.sql('SELECT head_seq FROM files WHERE path = ?', path).toArray()[0];
    const seq = row?.head_seq as number | undefined;
    return seq === undefined || seq === 0 ? undefined : seq;
  }

  /**
   * Oldest change-event sequence number still retained (§6 pruning: 30 days
   * / newest 10k — `MIN(seq)` already reflects both arms). Non-change events
   * carry NULL seq and are excluded; with no change events left the answer
   * is "head + 1" (nothing servable below the head).
   */
  private async oldestRetainedSeq(): Promise<number> {
    const row = this.sql('SELECT MIN(seq) AS oldest FROM events WHERE seq IS NOT NULL').toArray()[0];
    const oldest = row?.oldest as number | null;
    return oldest ?? this.globalSeq() + 1;
  }

  // --- blob bookkeeping ---------------------------------------------------------------------------

  /** Record an uploaded-but-not-yet-referenced blob (refcount 0; GC candidate). */
  private upsertBlob(hash: string, size: number, ts: number): void {
    this.sql(
      `INSERT INTO blobs (hash, size, refcount, first_seen_at) VALUES (?, ?, 0, ?)
       ON CONFLICT(hash) DO NOTHING`,
      hash,
      size,
      ts,
    );
  }

  private bumpBlobRefcount(hash: string, size: number, ts: number): void {
    this.sql(
      `INSERT INTO blobs (hash, size, refcount, first_seen_at) VALUES (?, ?, 1, ?)
       ON CONFLICT(hash) DO UPDATE SET refcount = refcount + 1`,
      hash,
      size,
      ts,
    );
  }

  // --- events / meta -----------------------------------------------------------------------------

  private appendEvent(
    ts: number,
    deviceId: string | null,
    kind: string,
    path: string | null,
    detail: string | null,
  ): void {
    this.sql(
      'INSERT INTO events (ts, device_id, kind, path, seq, detail) VALUES (?, ?, ?, ?, NULL, ?)',
      ts,
      deviceId,
      kind,
      path,
      detail,
    );
    this.maybePruneEvents();
  }

  /**
   * Prune the event log now and stamp the watermark (§6). Policy: delete
   * rows older than 30 days AND everything beyond the newest 10,000 — a
   * single DELETE whose two arms simply union. `versions` is never touched:
   * history is kept forever by design (FR-7).
   */
  private pruneEventsNow(ts: number): void {
    this.sql(
      `INSERT INTO meta (key, value) VALUES ('events_last_prune', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      String(ts),
    );
    this.sql(
      'DELETE FROM events WHERE ts < ? OR id NOT IN (SELECT id FROM events ORDER BY id DESC LIMIT ?)',
      ts - EVENT_MAX_AGE_MS,
      EVENT_KEEP_MAX,
    );
  }

  /**
   * Opportunistic prune gate, checked on every event write: the hourly
   * watermark rides `meta` (one point-lookup, cheaper than the INSERT it
   * follows), so the log stays bounded even between weekly cron runs.
   */
  private maybePruneEvents(): void {
    const ts = this.now();
    const row = this.sql("SELECT value FROM meta WHERE key = 'events_last_prune'").toArray()[0];
    if (row !== undefined && ts - Number(row.value as string) < EVENT_PRUNE_MIN_INTERVAL_MS) return;
    this.pruneEventsNow(ts);
  }

  private async getMeta(key: string): Promise<string | null> {
    const row = this.sql('SELECT value FROM meta WHERE key = ?', key).toArray()[0];
    return (row?.value as string | undefined) ?? null;
  }

  private async setMeta(key: string, value: string): Promise<void> {
    this.sql(
      'INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      value,
    );
  }

  private globalSeq(): number {
    const row = this.sql("SELECT value FROM meta WHERE key = 'global_seq'").toArray()[0];
    return row === undefined ? 0 : Number(row.value as string);
  }

  private bumpGlobalSeq(): number {
    const seq = this.globalSeq() + 1;
    this.sql(
      `INSERT INTO meta (key, value) VALUES ('global_seq', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      String(seq),
    );
    return seq;
  }

  // --- socket plumbing ------------------------------------------------------------------------------

  private readAttachment(ws: WebSocket): SocketAttachment {
    try {
      const value = ws.deserializeAttachment();
      if (
        typeof value === 'object' &&
        value !== null &&
        (value.deviceId === null || typeof value.deviceId === 'string')
      ) {
        return {
          deviceId: value.deviceId,
          protocolErrors: typeof value.protocolErrors === 'number' ? value.protocolErrors : 0,
        };
      }
    } catch {
      // no attachment yet
    }
    return { deviceId: null, protocolErrors: 0 };
  }

  private safeSend(ws: WebSocket, message: ServerMessage): void {
    try {
      ws.send(JSON.stringify(message));
    } catch {
      // socket closed mid-flight; the close handler cleans up
    }
  }

  private broadcastOthers(sender: WebSocket, message: ServerMessage): void {
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === sender) continue;
      this.safeSend(ws, message);
    }
  }

  private broadcastAll(message: ServerMessage): void {
    for (const ws of this.ctx.getWebSockets()) {
      this.safeSend(ws, message);
    }
  }

  private failWs(
    ws: WebSocket,
    code: 'UNAUTHORIZED' | 'REVOKED' | 'NOT_FOUND' | 'PROTOCOL' | 'PATH_COLLIDES',
    message: string,
  ): void {
    this.safeSend(ws, { type: 'error', code, message });
    if (code === 'PROTOCOL') {
      // Count and disconnect: a socket that keeps violating the protocol is
      // broken or abusive — either way it may not linger (pre-auth included).
      const attachment = this.readAttachment(ws);
      const protocolErrors = attachment.protocolErrors + 1;
      ws.serializeAttachment({ ...attachment, protocolErrors } satisfies SocketAttachment);
      if (protocolErrors >= PROTOCOL_ERROR_LIMIT) {
        try {
          ws.close(1002, 'too many protocol violations');
        } catch {
          // already closed
        }
      }
      return;
    }
    if (code === 'UNAUTHORIZED' || code === 'REVOKED') {
      try {
        ws.close(1008, code);
      } catch {
        // already closed
      }
    }
  }

  // --- storage plumbing ------------------------------------------------------------------------------

  private sql(query: string, ...params: unknown[]) {
    return this.ctx.storage.sql.exec(query, ...params);
  }

  /** Chain `operation` onto the DO's exclusive queue (atomicity, see module doc). */
  private runExclusive<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queueTail.then(operation, operation);
    this.queueTail = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  /** Apply pending SQLite migrations (tracked in `meta`, idempotent DDL). */
  private ensureSchema(): Promise<void> {
    this.schemaReady ??= this.applyMigrations();
    return this.schemaReady;
  }

  private async applyMigrations(): Promise<void> {
    // Workerd's SQLite rejects writing PRAGMA user_version (SQLITE_AUTH), so
    // the applied schema version rides the `meta` table; the DDL itself is
    // idempotent (CREATE ... IF NOT EXISTS).
    const hasMeta =
      this.ctx.storage.sql
        .exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'meta'")
        .toArray().length > 0;
    let version = 0;
    if (hasMeta) {
      const row = this.ctx.storage.sql
        .exec("SELECT value FROM meta WHERE key = 'schema_version'")
        .toArray()[0];
      version = row === undefined ? 0 : Number(row.value as string);
    }
    if (version < 1) {
      this.ctx.storage.sql.exec(MIGRATION_1);
      this.ctx.storage.sql.exec(
        `INSERT INTO meta (key, value) VALUES ('schema_version', '1')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      );
    }
    if (version < 2) {
      this.ctx.storage.sql.exec(MIGRATION_2);
      this.ctx.storage.sql.exec(
        `INSERT INTO meta (key, value) VALUES ('schema_version', '2')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      );
    }
    if (version < 3) {
      // `ALTER TABLE ... ADD COLUMN` is not idempotent, and tests wipe the
      // `meta` rows between cases (resetAll) — so the version row reads 0
      // again while the columns already exist. Skip cleanly in that case.
      try {
        this.ctx.storage.sql.exec(MIGRATION_3);
      } catch (error) {
        if (!String(error).includes('duplicate column name')) throw error;
      }
      this.ctx.storage.sql.exec(
        `INSERT INTO meta (key, value) VALUES ('schema_version', '3')
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      );
    }
  }
}

/** Migration 0001 — the §6 tables, metadata only (never file content). */
const MIGRATION_1 = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS files (
  path TEXT PRIMARY KEY,
  current_version TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  is_folder INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  head_hash TEXT NOT NULL,
  head_size INTEGER NOT NULL,
  head_clock_counter INTEGER NOT NULL,
  head_clock_device TEXT NOT NULL,
  head_kind TEXT NOT NULL DEFAULT 'edit',
  head_seq INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_files_head_seq ON files(head_seq);
CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  hash TEXT NOT NULL,
  size INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  clock_counter INTEGER NOT NULL,
  clock_device TEXT NOT NULL,
  parent_id TEXT,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_versions_path ON versions(path);
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL DEFAULT 0,
  revoked INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  device_id TEXT,
  kind TEXT NOT NULL,
  path TEXT,
  seq INTEGER,
  detail TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_seq ON events(seq);
CREATE TABLE IF NOT EXISTS pairs (
  code_hash TEXT PRIMARY KEY,
  device_name TEXT NOT NULL,
  device_type TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS blobs (
  hash TEXT PRIMARY KEY,
  size INTEGER NOT NULL,
  refcount INTEGER NOT NULL DEFAULT 0,
  first_seen_at INTEGER NOT NULL
);
`;

/**
 * Migration 0002 — vault-level snapshots. `heads` is JSON
 * `Record<path, SnapshotHeadRecord>`: enough to reconstruct every head at the
 * snapshot moment exactly (versions and blobs are kept forever, so restore
 * always finds the content).
 */
const MIGRATION_2 = `
CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  ts INTEGER NOT NULL,
  device_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  file_count INTEGER NOT NULL,
  heads TEXT NOT NULL
);
`;

/**
 * Migration 0003 — device-token rotation bookkeeping. Legacy rows default
 * `token_issued_at = 0`, read as "issued at creation" (rotation anchors on
 * `created_at` then); the previous-hash columns are inert until the first
 * rotation fills them.
 */
const MIGRATION_3 = `
ALTER TABLE devices ADD COLUMN token_issued_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE devices ADD COLUMN prev_token_hash TEXT;
ALTER TABLE devices ADD COLUMN prev_token_expires_at INTEGER NOT NULL DEFAULT 0;
`;
