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
  parseMessage,
  ProtocolVersion,
  sha256Hex,
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
  type Version,
  type VersionKind,
} from '@vsa/core';

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

export const ADMIN_COOKIE_NAME = 'vsa_admin';
const CLIENT_MESSAGE_TYPES: ReadonlySet<string> = new Set([
  'hello',
  'getManifest',
  'commit',
  'putBlob',
  'getBlob',
  'ping',
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

// --- persisted shapes -------------------------------------------------------------------

interface DeviceRow {
  id: string;
  name: string;
  type: string;
  token_hash: string;
  created_at: number;
  last_seen: number;
  revoked: number;
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
      // Optional pre-auth: reject bad/revoked tokens before the 101 so plain
      // HTTP clients get a clean 401 instead of an opaque WS failure.
      const device = await this.lookupDeviceByToken(token);
      if (device === undefined || device.revoked === 1) {
        return json(401, { error: device !== undefined ? 'device revoked' : 'invalid token' });
      }
    }
    const pair = new WebSocketPair();
    const server = pair[1];
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ deviceId: null } satisfies SocketAttachment);
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
    if (device.revoked === 1) {
      this.failWs(ws, 'REVOKED', 'device was revoked');
      return;
    }
    if (message.protocolVersion !== ProtocolVersion) {
      this.failWs(ws, 'PROTOCOL', `protocol version ${message.protocolVersion} not supported`);
      return;
    }
    const now = this.now();
    ws.serializeAttachment({ deviceId: device.id } satisfies SocketAttachment);
    this.sql('UPDATE devices SET last_seen = ? WHERE id = ?', now, device.id);
    const vaultName = (await this.getMeta('vault_name')) ?? '';
    this.safeSend(ws, {
      type: 'helloAck',
      deviceId: device.id,
      vaultName,
      settings: {
        obsidianSync: (await this.getMeta('settings_obsidian_sync')) === '1',
        displayName: vaultName,
      },
      // Replay-window answer (§5/§6): the oldest change-event seq still
      // retained under the pruning policy (30 days / newest 10k). Clients
      // with `cursor + 1 >= oldestRetainedSeq` request a delta manifest
      // (`getManifest{since}`) instead of the full vault index; with a gap —
      // or on legacy servers that omit the field — they fall back to full.
      // No change events retained ⇒ "nothing servable" (`head + 1`), which
      // reads as servable only to a cursor already at the head.
      oldestRetainedSeq: await this.oldestRetainedSeq(),
    });
    this.broadcastOthers(ws, { type: 'deviceSeen', deviceId: device.id, ts: now });
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

    // 1. Validate the content claim (mirrors InMemorySyncServer exactly).
    const inlineBytes = await this.verifyCommitContent(ws, message);
    if (inlineBytes === null) return; // error already sent

    // 2. Arbitrate with the shared core brain.
    const state = this.loadArbitrationState();
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

    // 3. Persist metadata: new versions, changed files rows.
    this.persistVerdict(state, verdict.state);

    // 4. Content: inline bytes go to R2; every newly referenced hash gains a
    //    refcount (orphan uploads sit at refcount 0; GC handles them).
    if (inlineBytes !== undefined) {
      await this.env.BUCKET.put(blobKey(message.hash), inlineBytes);
    }
    for (const version of verdict.state.versions.values()) {
      if (!state.versions.has(version.id) && version.hash !== '') {
        this.bumpBlobRefcount(version.hash, version.size, now);
      }
    }

    // 5. Record change events + reply + fan-out (in-memory server semantics:
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

  // --- HTTP surface (called by the worker's router) -------------------------------------------

  private async handleHttp(request: Request, url: URL, path: string): Promise<Response> {
    if (request.method === 'GET' && path === '/internal/health') {
      const claimed = await this.isClaimed();
      return json(200, { claimed, vaultName: claimed ? await this.getMeta('vault_name') : null });
    }
    if (request.method === 'POST' && path === '/claim') return this.httpClaim(request);
    if (request.method === 'POST' && path === '/admin/login') return this.httpAdminLogin(request);
    if (request.method === 'POST' && path === '/admin/passphrase-change') {
      return this.httpAdminPassphraseChange(request);
    }
    if (request.method === 'POST' && path === '/admin/pair') return this.httpAdminPair(request);
    if (request.method === 'POST' && path === '/admin/revoke') return this.httpAdminRevoke(request);
    if (request.method === 'POST' && path === '/pair') return this.httpPair(request);
    if (request.method === 'PATCH' && path === '/device') return this.httpDeviceRename(request);
    if (request.method === 'GET' && path === '/api/status') return this.httpStatus(request);
    if (request.method === 'GET' && path === '/api/history') return this.httpHistory(request, url);
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
      | { passphrase?: unknown; vaultName?: unknown; deviceName?: unknown; deviceType?: unknown }
      | null;
    if (
      body === null ||
      typeof body.passphrase !== 'string' ||
      body.passphrase.length < 4 ||
      typeof body.vaultName !== 'string' ||
      body.vaultName.trim().length === 0
    ) {
      return json(400, { error: 'passphrase (min 4 chars) and vaultName are required' });
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

    // The claiming device is paired immediately (§3: "claiming also mints the
    // first device pairing") so the plugin/CLI can sync right after claiming.
    const deviceName =
      typeof body.deviceName === 'string' && body.deviceName.trim().length > 0
        ? body.deviceName.trim()
        : 'admin-device';
    const deviceType = isDeviceType(body.deviceType) ? body.deviceType : 'desktop';
    const { token, deviceId } = await this.registerDevice(deviceName, deviceType, now);
    this.appendEvent(now, deviceId, 'claimed', body.vaultName.trim(), null);
    return json(200, { ok: true, vaultName: body.vaultName.trim(), deviceId, token });
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
   *    every admin cookie issued before this moment dies instantly — the
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
      body.next.length < 4
    ) {
      return json(400, { error: 'current and next passphrase (min 4 chars) are required' });
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
    // Rotate the session secret: any cookie signed with the old one (other
    // admin tabs, a stolen copy) fails HMAC verification on its next use.
    await this.setMeta('session_secret', randomToken64url(32));
    this.appendEvent(now, null, 'passphrase_changed', null, null);
    const { value, expiresAt } = await this.signSession();
    return json(200, { ok: true, cookie: value, expiresAt });
  }

  private async httpAdminPair(request: Request): Promise<Response> {
    if (!(await this.requireAdmin(request))) return json(401, { error: 'admin session required' });
    const body = (await request.json().catch(() => null)) as
      | { deviceName?: unknown; deviceType?: unknown }
      | null;
    if (body === null || typeof body.deviceName !== 'string' || body.deviceName.trim().length === 0) {
      return json(400, { error: 'deviceName is required' });
    }
    const deviceType = isDeviceType(body.deviceType) ? body.deviceType : 'desktop';
    const now = this.now();
    // Mint an unambiguous one-time code, XXXX-XXXX (FR-23).
    let code = '';
    let codeHash = '';
    for (;;) {
      const raw = randomBytes(CODE_LENGTH);
      let normalized = '';
      for (const byte of raw) normalized += CODE_ALPHABET[byte % CODE_ALPHABET.length]!;
      codeHash = await sha256Hex(normalized);
      if (this.sql('SELECT code_hash FROM pairs WHERE code_hash = ?', codeHash).toArray().length === 0) {
        code = `${normalized.slice(0, 4)}-${normalized.slice(4)}`;
        break;
      }
    }
    this.sql(
      'INSERT INTO pairs (code_hash, device_name, device_type, expires_at, used, created_at) VALUES (?, ?, ?, ?, 0, ?)',
      codeHash,
      body.deviceName.trim(),
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
    // Burn the code (one-time) and mint the device.
    this.sql('UPDATE pairs SET used = 1 WHERE code_hash = ?', codeHash);
    const deviceType = isDeviceType(body.deviceType)
      ? body.deviceType
      : isDeviceType(pair.device_type)
        ? pair.device_type
        : 'desktop';
    const { token, deviceId } = await this.registerDevice(body.deviceName.trim(), deviceType, now);
    this.appendEvent(now, deviceId, 'device_paired', body.deviceName.trim(), null);
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
    if (name === '' || name.length > 30 || /[\u0000-\u001f\u007f]/.test(name)) {
      return json(400, { error: 'name must be 1-30 characters, without control characters' });
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
      devices,
      lastEdit,
      attachments: { count: attachmentRow?.count ?? 0, bytes: attachmentRow?.bytes ?? 0 },
      storageBytes: storageRow?.bytes ?? 0,
      recentEvents,
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

  private async httpGcPurge(request: Request): Promise<Response> {
    const body = (await request.json().catch(() => null)) as { hashes?: unknown } | null;
    if (body === null || !Array.isArray(body.hashes)) {
      return json(400, { error: 'hashes array is required' });
    }
    for (const hash of body.hashes) {
      if (typeof hash === 'string') {
        // The refcount guard means a concurrent commit's refcount bump wins.
        this.sql('DELETE FROM blobs WHERE hash = ? AND refcount = 0', hash);
      }
    }
    return json(200, { ok: true, purged: body.hashes.length });
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

  private async signSession(): Promise<{ value: string; expiresAt: number }> {
    const secretB64 = await this.getMeta('session_secret');
    if (secretB64 === null) throw new Error('worker is not claimed');
    const expiresAt = this.now() + SESSION_TTL_MS;
    const mac = await hmacHex(base64UrlToBytes(secretB64), `admin:${expiresAt}`);
    return { value: `${expiresAt}.${mac}`, expiresAt };
  }

  /** Valid admin session cookie on the request? (HMAC-SHA256, §3.) */
  private async requireAdmin(request: Request): Promise<boolean> {
    const cookie = request.headers.get('cookie');
    if (cookie === null) return false;
    const match = cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${ADMIN_COOKIE_NAME}=`));
    if (match === undefined) return false;
    const value = match.slice(ADMIN_COOKIE_NAME.length + 1);
    const dot = value.indexOf('.');
    if (dot <= 0) return false;
    const expiresAt = Number(value.slice(0, dot));
    const mac = value.slice(dot + 1);
    if (!Number.isFinite(expiresAt) || expiresAt <= this.now()) return false;
    const secretB64 = await this.getMeta('session_secret');
    if (secretB64 === null) return false;
    const expected = await hmacHex(base64UrlToBytes(secretB64), `admin:${expiresAt}`);
    return timingSafeEqualHex(mac, expected);
  }

  /** Device token (Bearer) or admin cookie — used by HTTP routes. */
  private async authenticateHttpRequest(
    request: Request,
  ): Promise<{ ok: false } | { ok: true; kind: 'admin' } | { ok: true; kind: 'device'; deviceId: string }> {
    const header = request.headers.get('authorization');
    if (header !== null && header.startsWith('Bearer ')) {
      const device = await this.lookupDeviceByToken(header.slice('Bearer '.length));
      if (device === undefined || device.revoked === 1) return { ok: false };
      return { ok: true, kind: 'device', deviceId: device.id };
    }
    if (await this.requireAdmin(request)) return { ok: true, kind: 'admin' };
    return { ok: false };
  }

  /** Token → device row (tokens are stored SHA-256-hashed only, §14). */
  private async lookupDeviceByToken(token: string): Promise<DeviceRow | undefined> {
    const tokenHash = await sha256Hex(token);
    const rows = this.sql('SELECT * FROM devices WHERE token_hash = ?', tokenHash).toArray();
    return rows[0] as unknown as DeviceRow | undefined;
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
      'INSERT INTO devices (id, name, type, token_hash, created_at, last_seen, revoked) VALUES (?, ?, ?, ?, ?, 0, 0)',
      deviceId,
      name,
      type,
      await sha256Hex(token),
      now,
    );
    return { token, deviceId };
  }

  // --- arbitration state bridge -----------------------------------------------------------------

  /** Load `files` + `versions` as the pure arbitration state (§6 ↔ arbitrate.ts). */
  private loadArbitrationState(): ArbitrationState {
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

  /** Diff the verdict's state against the pre-arbitration state and write it. */
  private persistVerdict(before: ArbitrationState, after: ArbitrationState): void {
    for (const [id, version] of after.versions) {
      if (before.versions.has(id)) continue;
      this.sql(
        `INSERT INTO versions (id, path, hash, size, device_id, clock_counter, clock_device, parent_id, ts, kind, seq)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
        id,
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
    for (const [path, state] of after.files) {
      const old = before.files.get(path);
      if (old !== undefined && old.currentVersion === state.currentVersion) continue;
      // head_seq is NOT overwritten on conflict (see recordChange); a fresh
      // row starts at 0 (invisible to delta manifests until first recorded).
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
    for (const path of before.files.keys()) {
      if (!after.files.has(path)) this.sql('DELETE FROM files WHERE path = ?', path);
    }
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
        return value as SocketAttachment;
      }
    } catch {
      // no attachment yet
    }
    return { deviceId: null };
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
    code: 'UNAUTHORIZED' | 'REVOKED' | 'NOT_FOUND' | 'PROTOCOL',
    message: string,
  ): void {
    this.safeSend(ws, { type: 'error', code, message });
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
