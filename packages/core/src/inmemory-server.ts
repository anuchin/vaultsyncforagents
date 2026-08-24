/**
 * A minimal in-memory authoritative sync server for tests and future
 * cross-checks against the real Durable Object.
 *
 * This is a TEST DOUBLE, not production code: it wraps the same pure
 * `server/arbitrate.ts` module the real DO will import, plus an in-memory
 * blob store and a simplified device registry (register → token,
 * authenticate by token). Everything else — SQLite persistence, R2, pairing
 * codes, hibernation — is deliberately absent. If the real worker ever
 * disagrees with a simulation, the bug is in the glue, not the arbitration.
 */

import type { DeviceType, VaultSettings, Version } from './types.js';
import {
  arbitrateCommit,
  emptyArbitrationState,
  pathSafetyViolation,
  type ArbitrationState,
} from './server/arbitrate.js';
import {
  planSnapshotRestore,
  snapshotHeadsOf,
  type SnapshotHeadRecord,
} from './server/snapshots.js';
import { ProtocolError } from './errors.js';
import { MessageBus, type MemoryTransport } from './transport.js';
import {
  base64ToBytes,
  bytesToBase64,
  INLINE_CONTENT_MAX_BYTES,
  ProtocolVersion,
  type ChangeMessage,
  type ClientMessage,
  type CommitMessage,
  type ManifestEntry,
  type ServerErrorCode,
  type ServerMessage,
  type SnapshotCreateMessage,
  type SnapshotRestoreMessage,
} from './protocol.js';
import { sha256Hex } from './hashing.js';

export interface InMemorySyncServerOptions {
  /** Injectable clock; default `Date.now`. Tests inject a monotonic counter. */
  now?: () => number;
  vaultName?: string;
  settings?: VaultSettings;
}

interface RegisteredDevice {
  deviceId: string;
  name: string;
  type: DeviceType;
  token: string;
  revoked: boolean;
  lastSeen: number;
}

interface Connection {
  deviceId: string | null;
}

/** A stored vault-level snapshot (the DO's `snapshots` row). */
interface StoredSnapshot {
  id: string;
  name: string;
  ts: number;
  deviceId: string;
  seq: number;
  heads: Record<string, SnapshotHeadRecord>;
}

/**
 * The authoritative server side of the protocol over a `MessageBus`.
 * Deterministic: all state transitions are driven by message order and the
 * injected clock — no ambient timers, no randomness (tokens derive from the
 * device id).
 */
export class InMemorySyncServer {
  private readonly devices = new Map<string, RegisteredDevice>();
  private readonly tokens = new Map<string, string>(); // token → deviceId
  private readonly state: ArbitrationState = emptyArbitrationState();
  /** Content-addressed blob store (the R2 stand-in). */
  readonly blobs = new Map<string, Uint8Array>();
  /** path → global sequence number of its current head. */
  private readonly headSeq = new Map<string, number>();
  /** Change log in sequence order (cursor replay). */
  private log: ChangeMessage[] = [];
  private seq = 0;
  /** Vault-level snapshots, oldest first. */
  private readonly snapshots: StoredSnapshot[] = [];
  private readonly connections = new Map<MemoryTransport, Connection>();
  private readonly bus = new MessageBus();
  private readonly now: () => number;
  /**
   * Serializes the ASYNC continuations (commit / putBlob / getBlob) FIFO.
   * The real Durable Object chains every handler through `runExclusive`, so
   * ITS replies always arrive in send order — the client's push pipeline
   * relies on that pairing of reply→commit. Concurrent async handlers here
   * (each awaiting `crypto.subtle` inside content verification) could
   * otherwise interleave and reorder replies. Synchronous handlers (hello,
   * ping, getManifest, errors) still run — and reply — inside the caller's
   * tick, exactly like the un-chained original. Null ⇒ nothing pending.
   */
  private queueTail: Promise<void> | null = null;
  readonly settings: VaultSettings;
  readonly vaultName: string;

  constructor(options: InMemorySyncServerOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.vaultName = options.vaultName ?? 'test-vault';
    this.settings = options.settings ?? { obsidianSync: false, displayName: this.vaultName };
  }

  // --- device registry ---------------------------------------------------------

  /** Register a device; returns its (deterministic) long-lived token. */
  register(deviceId: string, name: string, type: DeviceType = 'desktop'): string {
    const token = `tok-${deviceId}`;
    const device: RegisteredDevice = { deviceId, name, type, token, revoked: false, lastSeen: 0 };
    this.devices.set(deviceId, device);
    this.tokens.set(token, deviceId);
    return token;
  }

  revoke(deviceId: string): void {
    const device = this.devices.get(deviceId);
    if (device) device.revoked = true;
  }

  // --- connections ---------------------------------------------------------------

  /**
   * Create a connected client/server transport pair. The server side is
   * authenticated when the client sends `hello` with the same token.
   */
  connectPair(token: string): { client: MemoryTransport; server: MemoryTransport } {
    const pair = this.bus.connectPair();
    this.connections.set(pair.server, { deviceId: null });
    pair.server.onClose(() => this.connections.delete(pair.server));
    pair.server.onMessage((message) => {
      // Synchronous prefix runs in the caller's tick; an async remainder
      // (content hashing, arbitration) is chained FIFO behind any pending
      // one — the in-memory mirror of the DO's `runExclusive` (field doc).
      const rest = this.handle(pair.server, token, message as ClientMessage);
      if (rest === undefined) return;
      const run = this.queueTail === null ? rest() : this.queueTail.then(rest, rest);
      this.queueTail = run;
      void run.catch(() => {}).then(() => {
        if (this.queueTail === run) this.queueTail = null; // drain back to idle
      });
    });
    return pair;
  }

  /**
   * Test-only events pruning: drop replay-log entries with `seq < beforeSeq`,
   * exactly like the worker's 30-days/newest-10k policy prunes its `events`
   * table. After this, `helloAck.oldestRetainedSeq` rises and clients with an
   * older cursor must fall back to a full manifest.
   */
  /**
   * Test-only: seed a live file head + its blob DIRECTLY, bypassing protocol
   * admission (path safety §14). Manufactures the state of a LEGACY vault —
   * one whose colliding or non-canonical paths predate the gate, which the
   * gate deliberately keeps syncable (edits to existing heads flow). No
   * change event is recorded: seeds surface through full manifests (fresh
   * connects), mirroring a vault that existed before this server watched.
   */
  async seedLegacyFileForTests(
    path: string,
    content: Uint8Array,
    options?: { deviceId?: string },
  ): Promise<void> {
    const deviceId = options?.deviceId ?? 'dev-legacy';
    const hash = await sha256Hex(content);
    this.blobs.set(hash, content);
    const id = `v${this.state.versions.size + 1}`;
    const counter = ++this.seq; // above any future commit's parent counter
    const version: Version = {
      id,
      path,
      hash,
      size: content.byteLength,
      deviceId,
      clock: { counter, deviceId },
      parentVersion: null,
      ts: this.now(),
      kind: 'edit',
    };
    this.state.versions.set(id, version);
    this.state.files.set(path, { currentVersion: id, head: version, deleted: false });
  }

  pruneEventsForTests(beforeSeq: number): void {
    while (this.log.length > 0 && this.log[0]!.seq < beforeSeq) this.log.shift();
  }

  /** Test-only direct storage access (seeding / assertions). */
  // (intentionally none — tests drive everything through the protocol)

  // --- message handling --------------------------------------------------------

  /**
   * Handle one client message. Everything up to the first await runs
   * SYNCHRONOUSLY (auth, hello/ping/getManifest replies, errors) — the
   * caller's tick sees those replies immediately, as with a real socket.
   * Returns the async remainder as a thunk for the caller to chain (or
   * `undefined` when the message was fully handled synchronously).
   */
  private handle(
    server: MemoryTransport,
    token: string,
    message: ClientMessage,
  ): (() => Promise<void>) | undefined {
    const connection = this.connections.get(server);
    if (connection === undefined) return undefined;
    try {
      switch (message.type) {
        case 'hello':
          this.handleHello(server, token, connection, message.token, message.protocolVersion, message.cursor);
          return undefined;
        case 'ping':
          this.reply(server, { type: 'pong', ...(message.ts !== undefined ? { ts: message.ts } : {}) });
          return undefined;
        default:
          break;
      }
      if (connection.deviceId === null) {
        this.fail(server, 'UNAUTHORIZED', 'say hello first');
        return undefined;
      }
      switch (message.type) {
        case 'getManifest':
          this.handleGetManifest(server, message.since);
          return undefined;
        case 'putBlob':
          return () =>
            this.handlePutBlob(server, message.hash, message.content).catch(
              (error: unknown) =>
                this.fail(server, 'PROTOCOL', error instanceof Error ? error.message : String(error)),
            );
        case 'getBlob':
          this.handleGetBlob(server, message.hash); // synchronous map lookup
          return undefined;
        case 'commit':
          return () =>
            this.handleCommit(server, connection.deviceId as string, message).catch(
              (error: unknown) =>
                this.fail(server, 'PROTOCOL', error instanceof Error ? error.message : String(error)),
            );
        case 'snapshotCreate':
          this.handleSnapshotCreate(server, connection.deviceId as string, message);
          return undefined;
        case 'snapshotRestore':
          this.handleSnapshotRestore(server, connection.deviceId as string, message);
          return undefined;
        default:
          this.fail(server, 'PROTOCOL', `unexpected message type ${JSON.stringify((message as { type: string }).type)}`);
          return undefined;
      }
    } catch (error) {
      this.fail(server, 'PROTOCOL', error instanceof Error ? error.message : String(error));
      return undefined;
    }
  }

  private handleHello(
    server: MemoryTransport,
    token: string,
    connection: Connection,
    claimedToken: string,
    protocolVersion: number,
    cursor: number,
  ): void {
    if (claimedToken !== token || !this.tokens.has(claimedToken)) {
      this.fail(server, 'UNAUTHORIZED', 'unknown token');
      return;
    }
    const deviceId = this.tokens.get(claimedToken) as string;
    const device = this.devices.get(deviceId);
    if (device === undefined) {
      this.fail(server, 'UNAUTHORIZED', 'unknown device');
      return;
    }
    if (device.revoked) {
      this.fail(server, 'REVOKED', 'device was revoked');
      return;
    }
    if (protocolVersion !== ProtocolVersion) {
      this.fail(server, 'PROTOCOL', `protocol version ${protocolVersion} not supported`);
      return;
    }
    connection.deviceId = deviceId;
    device.lastSeen = this.now();
    this.reply(server, {
      type: 'helloAck',
      deviceId,
      vaultName: this.vaultName,
      settings: this.settings,
      // Replay-window answer (protocol v1, pre-release): the seq of the
      // oldest retained change event — the log's first entry, or "nothing
      // retained" (`seq + 1`) once pruned/empty. A client cursor C is
      // servable iff this is ≤ C + 1.
      oldestRetainedSeq: this.log.length > 0 ? this.log[0]!.seq : this.seq + 1,
    });
    this.broadcastOthers(server, { type: 'deviceSeen', deviceId, ts: device.lastSeen });
    // Catch-up replay (§5): everything the client missed since its cursor.
    // A first-ever connect (cursor 0) gets the full manifest instead.
    if (cursor > 0) {
      for (const change of this.log) {
        if (change.seq > cursor) this.reply(server, change);
      }
    }
  }

  private handleGetManifest(server: MemoryTransport, since: number | undefined): void {
    const entries: Record<string, ManifestEntry> = {};
    for (const [path, file] of this.state.files) {
      if (since !== undefined && (this.headSeq.get(path) ?? 0) <= since) continue;
      entries[path] = {
        path,
        version: file.head.id,
        hash: file.head.hash,
        size: file.head.size,
        deleted: file.deleted,
        clock: file.head.clock,
        ...(file.isFolder ? { isFolder: true } : {}),
        mtime: file.head.ts,
      };
    }
    this.reply(server, { type: 'manifest', entries, cursor: this.seq });
  }

  private async handlePutBlob(server: MemoryTransport, hash: string, content: string): Promise<void> {
    const bytes = base64ToBytes(content);
    if ((await sha256Hex(bytes)) !== hash) {
      this.fail(server, 'PROTOCOL', `putBlob content does not hash to ${hash}`);
      return;
    }
    this.blobs.set(hash, bytes); // idempotent: same hash ⇒ same content
    this.reply(server, { type: 'blobAck', hash });
  }

  private handleGetBlob(server: MemoryTransport, hash: string): void {
    const bytes = this.blobs.get(hash);
    if (bytes === undefined) {
      this.fail(server, 'NOT_FOUND', `no blob for ${hash}`);
      return;
    }
    this.reply(server, { type: 'blob', hash, content: bytesToBase64(bytes) });
  }

  private async handleCommit(server: MemoryTransport, deviceId: string, message: CommitMessage): Promise<void> {
    const device = this.devices.get(deviceId);
    if (device) device.lastSeen = this.now();
    const content = await this.verifyCommitContent(server, message);
    if (content === null) return; // error already sent

    // Path safety (§14): NFC canonical form always; no NEW live path under an
    // occupied fold key. Same gate the DO room runs, byte for byte.
    const violation = pathSafetyViolation(this.state.files, {
      path: message.path,
      ...(message.fromPath !== undefined ? { fromPath: message.fromPath } : {}),
    });
    if (violation !== null) {
      this.fail(server, violation.code, violation.message);
      return;
    }

    const verdict = arbitrateCommit(
      this.state,
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
      this.now(),
      new Map([...this.devices].map(([id, d]) => [id, d.name])),
    );
    this.state.files = verdict.state.files;
    this.state.versions = verdict.state.versions;
    if (content !== undefined) this.blobs.set(message.hash, content);

    const outcome = verdict.outcome;
    const headChanged = outcome.result === 'applied' || outcome.winner.deviceId === deviceId;
    const primary = headChanged ? this.record(outcome.broadcast) : undefined;
    const copy = outcome.conflictCopy !== undefined ? this.record(outcome.conflictCopy) : undefined;

    if (outcome.result === 'applied') {
      this.reply(server, {
        type: 'commitAck',
        version: outcome.newVersionId,
        clock: outcome.clock,
        seq: primary?.seq ?? this.seq,
      });
    } else {
      const winnerSeq = primary?.seq ?? this.headSeq.get(outcome.winner.path);
      this.reply(server, {
        type: 'conflict',
        winner: outcome.winner,
        loserDisposition: outcome.loserDisposition,
        ...(winnerSeq !== undefined ? { seq: winnerSeq } : {}),
      });
    }
    if (primary !== undefined) this.broadcastOthers(server, primary);
    // The conflict copy is new to everyone — including the committer.
    if (copy !== undefined) this.broadcastAll(copy);
  }

  /**
   * Validate the commit's content claim. Returns the bytes (to store in the
   * CAS blob map), `undefined` for content-less commits (deletes, folders),
   * or `null` after sending an error.
   */
  private async verifyCommitContent(
    server: MemoryTransport,
    message: CommitMessage,
  ): Promise<Uint8Array | undefined | null> {
    if (message.kind === 'delete' || message.isFolder === true) return undefined;
    if (message.inline !== undefined) {
      const bytes = base64ToBytes(message.inline);
      if (bytes.byteLength > INLINE_CONTENT_MAX_BYTES) {
        this.fail(server, 'PROTOCOL', `inline content of ${bytes.byteLength} bytes exceeds the cap`);
        return null;
      }
      if (bytes.byteLength !== message.size) {
        this.fail(server, 'PROTOCOL', `size ${message.size} does not match inline content (${bytes.byteLength})`);
        return null;
      }
      if ((await sha256Hex(bytes)) !== message.hash) {
        this.fail(server, 'PROTOCOL', 'inline content does not hash to the claimed hash');
        return null;
      }
      return bytes;
    }
    if (!this.blobs.has(message.hash)) {
      this.fail(server, 'NOT_FOUND', `blob ${message.hash} was not uploaded before commit`);
      return null;
    }
    return undefined;
  }

  // --- snapshots ---------------------------------------------------------------

  /** Snapshot semantics mirror the DO exactly: capture, no fan-out. */
  private handleSnapshotCreate(
    server: MemoryTransport,
    deviceId: string,
    message: SnapshotCreateMessage,
  ): void {
    const heads = snapshotHeadsOf(this.state.files);
    const snapshot: StoredSnapshot = {
      id: `s${this.snapshots.length + 1}`,
      name: message.name ?? '',
      ts: this.now(),
      deviceId,
      seq: this.seq,
      heads,
    };
    this.snapshots.push(snapshot);
    this.reply(server, {
      type: 'snapshotCreateAck',
      id: snapshot.id,
      name: snapshot.name,
      ts: snapshot.ts,
      seq: snapshot.seq,
      fileCount: Object.keys(heads).length,
    });
  }

  /**
   * Restore = N synthetic fast-path commits (see `server/snapshots.ts`),
   * each recorded in the replay log and fanned out so every connected client
   * converges live; reconnecting clients converge through cursor replay.
   */
  private handleSnapshotRestore(
    server: MemoryTransport,
    deviceId: string,
    message: SnapshotRestoreMessage,
  ): void {
    const snapshot = this.snapshots.find((entry) => entry.id === message.id);
    if (snapshot === undefined) {
      this.fail(server, 'NOT_FOUND', `no snapshot ${message.id}`);
      return;
    }
    const now = this.now();
    let restored = 0;
    let tombstoned = 0;
    let lastSeq = this.seq;
    const changes: ChangeMessage[] = [];
    for (const item of planSnapshotRestore(this.state, snapshot.heads)) {
      const verdict = arbitrateCommit(this.state, item.commit, deviceId, now);
      if (verdict.outcome.result !== 'applied') {
        throw new ProtocolError(
          `snapshot restore for ${JSON.stringify(item.path)} left the fast path`,
        );
      }
      this.state.files = verdict.state.files;
      this.state.versions = verdict.state.versions;
      const change = this.record(verdict.outcome.broadcast);
      changes.push(change);
      lastSeq = change.seq;
      if (item.tombstone) tombstoned += 1;
      else restored += 1;
    }
    this.reply(server, {
      type: 'snapshotRestoreAck',
      id: message.id,
      restored,
      tombstoned,
      seq: lastSeq,
    });
    for (const change of changes) this.broadcastOthers(server, change);
  }

  // --- plumbing ------------------------------------------------------------------

  /** Assign the next sequence number and append to the replay log. */
  private record(payload: Omit<ChangeMessage, 'type' | 'seq'>): ChangeMessage {
    const change = this.makeChange(payload);
    this.log.push(change);
    return change;
  }

  private makeChange(payload: Omit<ChangeMessage, 'type' | 'seq'>): ChangeMessage {
    const seq = ++this.seq;
    this.headSeq.set(payload.path, seq);
    if (payload.kind === 'rename' && payload.fromPath !== undefined) {
      this.headSeq.delete(payload.fromPath);
    }
    return { type: 'change', seq, ...payload };
  }

  private reply(server: MemoryTransport, message: ServerMessage): void {
    server.send(message);
  }

  private broadcastOthers(sender: MemoryTransport, message: ServerMessage): void {
    for (const [transport] of this.connections) {
      if (transport !== sender && transport.isOpen) transport.send(message);
    }
  }

  private broadcastAll(message: ServerMessage): void {
    for (const [transport] of this.connections) {
      if (transport.isOpen) transport.send(message);
    }
  }

  private fail(server: MemoryTransport, code: ServerErrorCode, message: string): void {
    this.reply(server, { type: 'error', code, message });
    if (code === 'UNAUTHORIZED' || code === 'REVOKED') server.close({ code: 1008, reason: code });
  }

  // --- introspection (tests) -------------------------------------------------------

  /** Serializable snapshot for assertions. */
  snapshot(): {
    files: Array<{ path: string; version: string; hash: string; deleted: boolean; isFolder: boolean; clock: { counter: number; deviceId: string } }>;
    versions: number;
    blobHashes: string[];
    seq: number;
  } {
    const files = [...this.state.files.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([path, file]) => ({
        path,
        version: file.head.id,
        hash: file.head.hash,
        deleted: file.deleted,
        isFolder: file.isFolder === true,
        clock: { counter: file.head.clock.counter, deviceId: file.head.clock.deviceId },
      }));
    return {
      files,
      versions: this.state.versions.size,
      blobHashes: [...this.blobs.keys()].sort(),
      seq: this.seq,
    };
  }
}
