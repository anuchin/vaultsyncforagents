/**
 * `SyncClient` — the network-facing orchestrator (ARCHITECTURE.md §8).
 *
 * Composes the phase-1a/1b pieces into one loop per device:
 *
 *   startup:  loadLocalIndex → hello/helloAck → getManifest → scanVault →
 *             computeSyncPlan → execute (pushes inline-or-blob, pulls via
 *             applyPull with the injected blob store);
 *   live:     `change` messages materialize immediately when the target is
 *             clean, and defer to a full reconcile cycle when it is not — a
 *             remote change is NEVER written over locally-modified content
 *             without going through `computeSyncPlan`'s conflict logic;
 *   watcher:  `WatchAdapter` batches are debounced (~300 ms, injectable
 *             scheduler — no ambient timers in tests) into scan→plan→execute;
 *   reconnect: `onClose` flips to `'disconnected'`; `reconnect()` re-runs the
 *             whole startup reconciliation (backoff is the caller's job).
 *
 * All I/O crosses the adapter seams (`StorageAdapter`, `Transport`,
 * `BlobStore`, `LogAdapter`); the class itself is pure orchestration and runs
 * anywhere `core` runs — Workers tests included.
 */

import type { LogAdapter, StorageAdapter, WatchAdapter } from './adapters.js';
import { compareClocks } from './clock.js';
import { applyPull, loadLocalIndex, type FetchBlob } from './engine.js';
import { NetworkError, ProtocolError, RevokedError, UnauthorizedError } from './errors.js';
import { sha256Hex } from './hashing.js';
import { isIgnored, type IgnoreSettings } from './ignore.js';
import {
  applyCommit,
  LOCAL_INDEX_STATE_PATH,
  removeEntry,
  serializeLocalIndex,
  type LocalIndex,
} from './localindex.js';
import {
  base64ToBytes,
  bytesToBase64,
  INLINE_CONTENT_MAX_BYTES,
  ProtocolVersion,
  type BlobAckMessage,
  type BlobMessage,
  type ChangeMessage,
  type CommitAckMessage,
  type CommitMessage,
  type ConflictMessage,
  type HelloAckMessage,
  type ManifestMessage,
  type Message,
  type ServerMessage,
} from './protocol.js';
import {
  computeSyncPlan,
  type ConflictOp,
  type PullFileOp,
  type PullOp,
  type PushOp,
  type RemoteFile,
  type SyncPlan,
} from './resolve.js';
import { scanVault } from './scan.js';
import type { Transport } from './transport.js';
import type { LogicalClock } from './types.js';

// --- public option/status shapes --------------------------------------------------

/** Client-side content-addressed blob cache (R2 client in production; a Map in tests). */
export interface BlobStore {
  get(hash: string): Promise<Uint8Array | undefined>;
  put(hash: string, bytes: Uint8Array): Promise<void>;
}

export interface SyncClientOptions {
  deviceId: string;
  deviceName: string;
  token: string;
  /** A factory (reconnect dials fresh) or a single reusable instance. */
  transport: (() => Transport) | Transport;
  blobStore: BlobStore;
  storage: StorageAdapter;
  log?: LogAdapter;
  /** Initial ignore settings; superseded by `helloAck.settings` on connect. */
  settings?: IgnoreSettings;
  /** Injectable clock (default `Date.now`). */
  now?: () => number;
  /** Watcher debounce window in ms (default 300). */
  debounceMs?: number;
  /**
   * Schedules the debounced sync cycle. Default: `setTimeout`. Tests inject a
   * manual queue — the client never touches a real timer behind this seam.
   */
  schedule?: (fn: () => void, ms: number) => () => void;
}

export type SyncClientState = 'idle' | 'connecting' | 'syncing' | 'live' | 'disconnected';

export interface SyncClientStatus {
  state: SyncClientState;
  /** Epoch ms of the last completed cycle, or null before the first. */
  lastSyncAt: number | null;
  /** Watcher/reconcile events queued behind the debounce window. */
  pending: number;
  /** Conflicts observed by plan cycles (informational; resolution is in the data). */
  conflicts: ConflictOp[];
}

const defaultLog: LogAdapter = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const defaultSchedule = (fn: () => void, ms: number): (() => void) => {
  const handle = globalThis.setTimeout(fn, ms) as unknown as number;
  return () => globalThis.clearTimeout(handle);
};

/** A commit prepared for the wire (a `PushOp` + its staged content). */
interface StagedCommit {
  kind: CommitMessage['kind'];
  path: string;
  parentVersion: string | null;
  hash: string;
  size: number;
  fromPath?: string;
  isFolder?: boolean;
  bytes?: Uint8Array;
}

// --- the client ---------------------------------------------------------------------

export class SyncClient {
  private readonly options: SyncClientOptions;
  private readonly log: LogAdapter;
  private readonly now: () => number;
  private readonly debounceMs: number;
  private readonly schedule: (fn: () => void, ms: number) => () => void;
  private readonly dialTransport: () => Transport;

  private transport: Transport | null = null;
  private state: SyncClientState = 'idle';
  private index: LocalIndex = {};
  private cursor = 0;
  private lastSyncAt: number | null = null;
  private pending = 0;
  private conflicts: ConflictOp[] = [];
  private ignoreSettings: IgnoreSettings;
  private watchAdapter: WatchAdapter | null = null;
  private cancelDebounce: (() => void) | null = null;

  /** Serialized operation queue — exactly one async op runs at a time. */
  private tail: Promise<unknown> = Promise.resolve();
  private queuedOps = 0;
  /** Startup-time change flood is buffered; the full manifest subsumes it. */
  private buffering = false;
  private buffered: Message[] = [];
  /** Single outstanding request expectation (ops are serialized). */
  private expectation: {
    matches: (message: Message) => boolean;
    resolve: (message: Message) => void;
    reject: (error: Error) => void;
  } | null = null;

  constructor(options: SyncClientOptions) {
    this.options = options;
    this.log = options.log ?? defaultLog;
    this.now = options.now ?? (() => Date.now());
    this.debounceMs = options.debounceMs ?? 300;
    this.schedule = options.schedule ?? defaultSchedule;
    this.dialTransport =
      typeof options.transport === 'function'
        ? options.transport
        : () => options.transport as Transport;
    this.ignoreSettings = options.settings ?? { obsidianSync: false };
  }

  // --- lifecycle ----------------------------------------------------------------------

  /** Run startup reconciliation and enter live mode. */
  async connect(): Promise<void> {
    await this.enqueue(() => this.startup());
  }

  /** Re-dial and re-run the full startup reconciliation. */
  async reconnect(): Promise<void> {
    await this.enqueue(async () => {
      this.transport?.close();
      this.transport = null;
      await this.startup();
    });
  }

  close(): void {
    this.stopWatching();
    this.cancelDebounce?.();
    this.cancelDebounce = null;
    this.transport?.close();
    this.transport = null;
    this.state = 'idle';
  }

  /** Begin debounced watching (ARCHITECTURE §8 live operation). */
  startWatching(watchAdapter: WatchAdapter): void {
    this.stopWatching();
    this.watchAdapter = watchAdapter;
    watchAdapter.start((events) => this.onWatchEvents(events));
  }

  stopWatching(): void {
    this.watchAdapter?.stop();
    this.watchAdapter = null;
  }

  /** Manual one-shot cycle (`vsa` one-shot, "sync now" buttons, tests). */
  async triggerSync(): Promise<void> {
    await this.enqueue(() => this.runCycle());
  }

  /** Resolves when every queued operation has settled. */
  async waitIdle(): Promise<void> {
    while (this.queuedOps > 0) await this.tail;
    await this.tail;
  }

  status(): SyncClientStatus {
    return {
      state: this.state,
      lastSyncAt: this.lastSyncAt,
      pending: this.pending,
      conflicts: [...this.conflicts],
    };
  }

  /** Read-only view of the local index (tests, `vsa status`). */
  currentIndex(): LocalIndex {
    return { ...this.index };
  }

  /** Last seen server sequence number. */
  get cursorValue(): number {
    return this.cursor;
  }

  /** TS-safe state probe (assignments inside async flows defeat narrowing). */
  private isDisconnected(): boolean {
    return this.state === 'disconnected';
  }

  // --- startup -------------------------------------------------------------------------

  private async startup(): Promise<void> {
    this.state = 'connecting';
    this.buffering = true;
    this.buffered = [];

    this.index = (await this.safeStorageExists(LOCAL_INDEX_STATE_PATH))
      ? await loadLocalIndex(this.options.storage)
      : {};

    const transport = this.dialTransport();
    this.transport = transport;
    transport.onMessage((message) => this.onTransportMessage(message));
    transport.onClose((reason) => this.onTransportClose(reason));

    const helloAck = await this.request<HelloAckMessage | ServerErrorMessage>(
      (m) => m.type === 'helloAck' || m.type === 'error',
      () =>
        transport.send({
          type: 'hello',
          token: this.options.token,
          protocolVersion: ProtocolVersion,
          cursor: this.cursor,
        }),
    );
    if (helloAck.type === 'error') throw this.toError(helloAck);
    this.ignoreSettings = { obsidianSync: helloAck.settings.obsidianSync };

    this.state = 'syncing';
    await this.runCycle();

    this.buffering = false;
    const buffered = this.buffered;
    this.buffered = [];
    for (const message of buffered) {
      await this.dispatch(message);
    }
    if (!this.isDisconnected()) this.state = 'live';
  }

  private async safeStorageExists(path: string): Promise<boolean> {
    try {
      return await this.options.storage.exists(path);
    } catch {
      return false;
    }
  }

  private onTransportClose(reason: { code?: number; reason?: string }): void {
    this.log.warn('transport closed', reason);
    this.state = 'disconnected';
    const expectation = this.expectation;
    if (expectation !== null) {
      this.expectation = null;
      expectation.reject(
        new NetworkError(`connection closed: ${reason.reason ?? reason.code ?? 'unknown'}`),
      );
    }
  }

  // --- message pump ----------------------------------------------------------------------

  private onTransportMessage = (message: Message): void => {
    const expectation = this.expectation;
    if (expectation !== null && expectation.matches(message)) {
      this.expectation = null;
      expectation.resolve(message);
      return;
    }
    if (this.buffering) {
      this.buffered.push(message);
      return;
    }
    this.enqueue(async () => {
      await this.dispatch(message);
    }).catch((error: unknown) => this.log.warn('change handler failed', error));
  };

  private async dispatch(message: Message): Promise<void> {
    switch (message.type) {
      case 'change':
        await this.handleChange(message);
        return;
      case 'deviceSeen':
        return; // presence only; dashboards consume it
      case 'pong':
        return;
      case 'error':
        this.log.error('server error', message.code, message.message);
        return;
      case 'helloAck':
      case 'manifest':
      case 'commitAck':
      case 'conflict':
      case 'blob':
      case 'blobAck':
        // Replies arrive only against an outstanding expectation; a
        // spontaneous one is a protocol violation we log and drop.
        this.log.warn('unexpected server reply', message.type);
        return;
      default:
        this.log.warn('ignoring client-to-server message from server', message);
    }
  }

  private async handleChange(change: ChangeMessage): Promise<void> {
    if (change.seq > this.cursor) this.cursor = change.seq;
    if (isIgnored(change.path, this.ignoreSettings)) return;
    if (change.fromPath !== undefined && isIgnored(change.fromPath, this.ignoreSettings)) return;

    // Stale replay / duplicate fan-out: per path the head clock dominates
    // every earlier version, so anything ≤ the recorded clock is old news.
    const entry = this.index[change.path];
    if (entry !== undefined) {
      if (entry.versionId === change.version) return;
      if (compareClocks(entry.clock, change.clock) >= 0) return;
    }

    // The guard: never write a remote change over locally-diverged content.
    if (!(await this.changeIsSafe(change))) {
      this.log.info('deferring remote change over local divergence', change.path);
      this.scheduleReconcile();
      return;
    }

    this.index = await this.applyPulls([this.pullOpFromChange(change)]);
  }

  /**
   * A change may be applied directly only when the touched paths carry no
   * un-reconciled local content. Anything else must detour through a full
   * `computeSyncPlan` cycle (conflict logic, conflict copies).
   */
  private async changeIsSafe(change: ChangeMessage): Promise<boolean> {
    if (change.isFolder === true) return true;
    if (change.kind === 'rename' && change.fromPath !== undefined) {
      if (await this.pathHasLocalDivergence(change.fromPath)) return false;
      if (await this.storageExists(change.path)) {
        const entry = this.index[change.path];
        if (entry === undefined || entry.deletedAt !== undefined) return false;
        const actual = await sha256Hex(await this.options.storage.readFile(change.path));
        if (actual !== entry.hash) return false;
      }
      return true;
    }
    return !(await this.pathHasLocalDivergence(change.path));
  }

  private async pathHasLocalDivergence(path: string): Promise<boolean> {
    const entry = this.index[path];
    if (entry?.isFolder) return false;
    if (!(await this.storageExists(path))) return false;
    if (entry === undefined || entry.deletedAt !== undefined) return true;
    const actual = await sha256Hex(await this.options.storage.readFile(path));
    return actual !== entry.hash;
  }

  private async storageExists(path: string): Promise<boolean> {
    try {
      return await this.options.storage.exists(path);
    } catch {
      return false;
    }
  }

  private pullOpFromChange(change: ChangeMessage): PullOp {
    if (change.kind === 'rename' && change.fromPath !== undefined) {
      return {
        kind: 'rename',
        fromPath: change.fromPath,
        toPath: change.path,
        hash: change.hash,
        size: change.size,
        version: change.version,
        clock: change.clock,
      };
    }
    const entry = this.index[change.path];
    const kind: PullFileOp['kind'] = change.deleted
      ? 'delete'
      : entry === undefined
        ? 'add'
        : entry.deletedAt !== undefined
          ? 'restore'
          : 'edit';
    return {
      kind,
      path: change.path,
      hash: change.hash,
      size: change.size,
      version: change.version,
      clock: change.clock,
      deleted: change.deleted,
      ...(change.isFolder === true ? { isFolder: true } : {}),
    };
  }

  /** Materialize pulls through the verified engine path; returns the new index. */
  private async applyPulls(pulls: ReadonlyArray<PullOp>): Promise<LocalIndex> {
    return applyPull(
      this.options.storage,
      this.index,
      { pushes: [], pulls: [...pulls], conflicts: [], folderPushes: [] },
      this.fetchBlob,
      { now: this.now() },
    );
  }

  // --- watcher ------------------------------------------------------------------------------

  private onWatchEvents(events: ReadonlyArray<{ path: string }>): void {
    const relevant = events.filter((event) => !isIgnored(event.path, this.ignoreSettings));
    if (relevant.length === 0) return;
    this.pending += relevant.length;
    this.scheduleReconcile();
  }

  /** Debounced scan→plan→execute (shared by watcher and deferred changes). */
  private scheduleReconcile(): void {
    this.cancelDebounce?.();
    this.cancelDebounce = this.schedule(() => {
      this.cancelDebounce = null;
      this.enqueue(() => this.runCycle()).catch((error: unknown) =>
        this.log.warn('debounced sync cycle failed', error),
      );
    }, this.debounceMs);
  }

  // --- the sync cycle --------------------------------------------------------------------------

  private async runCycle(): Promise<void> {
    if (this.transport === null || this.isDisconnected()) return;
    this.state = 'syncing';
    try {
      const manifest = await this.fetchManifest();
      const localChanges = await scanVault(
        this.options.storage,
        this.index,
        this.ignoreSettings,
        this.now(),
      );
      const plan = computeSyncPlan({
        localChanges,
        index: this.index,
        manifest,
        thisDeviceId: this.options.deviceId,
        thisDeviceName: this.options.deviceName,
        now: this.now(),
      });
      this.conflicts = [...this.conflicts, ...plan.conflicts];

      // Stage push contents BEFORE pulls overwrite the working tree (a
      // conflict-copy push reads the loser content from the original path).
      const staged = await this.stagePushes(plan);

      this.index = await this.applyPulls(plan.pulls);

      for (const commit of staged) {
        await this.sendCommit(commit);
      }
      for (const path of plan.folderPushes) {
        await this.sendCommit({
          kind: 'edit',
          path,
          parentVersion: this.index[path]?.versionId ?? null,
          hash: '',
          size: 0,
          isFolder: true,
        });
      }

      this.lastSyncAt = this.now();
      this.pending = 0;
      if (!this.isDisconnected()) this.state = 'live';
    } catch (error) {
      this.log.error('sync cycle failed', error);
      if (!this.isDisconnected()) this.state = this.transport !== null ? 'live' : 'idle';
      throw error;
    }
  }

  private async fetchManifest(): Promise<RemoteFile[]> {
    const transport = this.transport;
    if (transport === null) throw new NetworkError('not connected');
    const reply = await this.request<ManifestMessage | ServerErrorMessage>(
      (m) => m.type === 'manifest' || m.type === 'error',
      () => transport.send({ type: 'getManifest' }),
    );
    if (reply.type === 'error') throw this.toError(reply);
    if (reply.cursor > this.cursor) this.cursor = reply.cursor;
    return Object.values(reply.entries).map((entry) => ({ ...entry }));
  }

  private async stagePushes(plan: SyncPlan): Promise<StagedCommit[]> {
    // A conflict-copy push carries content read from the *original* path.
    const copySources = new Map<string, string>();
    for (const conflict of plan.conflicts) {
      if (conflict.conflictCopyPath !== undefined) {
        copySources.set(conflict.conflictCopyPath, conflict.path);
      }
    }

    const staged: StagedCommit[] = [];
    for (const push of plan.pushes) {
      if (push.kind === 'delete' || push.kind === 'rename') {
        staged.push(this.toStaged(push));
        continue;
      }
      const sourcePath =
        push.kind === 'conflictCopy' ? copySources.get(push.path) ?? push.path : push.path;
      const bytes = await this.readLocal(sourcePath);
      if (bytes === undefined) {
        this.log.warn('push source vanished since scan; deferring', push.path);
        this.scheduleReconcile();
        continue;
      }
      const hash = await sha256Hex(bytes);
      if (hash !== push.hash || bytes.byteLength !== push.size) {
        this.log.warn('local content drifted since scan; deferring push', push.path);
        this.scheduleReconcile();
        continue;
      }
      if (push.kind === 'conflictCopy') {
        // Materialize the copy locally NOW, before the pulls overwrite the
        // original: the server broadcasts the copy to *other* clients only,
        // so this device must write its own copy itself.
        await this.options.storage.writeFile(push.path, bytes);
      }
      staged.push({ ...this.toStaged(push), bytes });
    }
    return staged;
  }

  private toStaged(push: PushOp): StagedCommit {
    if (push.kind === 'rename') {
      return {
        kind: 'rename',
        path: push.toPath,
        parentVersion: push.parentVersion,
        hash: push.hash,
        size: push.size,
        fromPath: push.fromPath,
      };
    }
    return {
      kind: push.kind === 'add' ? 'edit' : push.kind,
      path: push.path,
      parentVersion: push.parentVersion,
      hash: push.hash,
      size: push.size,
    };
  }

  private async readLocal(path: string): Promise<Uint8Array | undefined> {
    try {
      return await this.options.storage.readFile(path);
    } catch {
      return undefined;
    }
  }

  private async sendCommit(commit: StagedCommit): Promise<void> {
    const transport = this.transport;
    if (transport === null) throw new NetworkError('not connected');

    const message: CommitMessage = {
      type: 'commit',
      path: commit.path,
      parentVersion: commit.parentVersion,
      hash: commit.hash,
      size: commit.size,
      kind: commit.kind,
      ...(commit.fromPath !== undefined ? { fromPath: commit.fromPath } : {}),
      ...(commit.isFolder === true ? { isFolder: true } : {}),
      ...(commit.bytes !== undefined && commit.bytes.byteLength <= INLINE_CONTENT_MAX_BYTES
        ? { inline: bytesToBase64(commit.bytes) }
        : {}),
    };

    // Attachments above the inline cap ride the blob store (FR-8).
    if (commit.bytes !== undefined && commit.bytes.byteLength > INLINE_CONTENT_MAX_BYTES) {
      await this.uploadBlob(commit.hash, commit.bytes);
    }

    const reply = await this.request<CommitAckMessage | ConflictMessage | ServerErrorMessage>(
      (m) => m.type === 'commitAck' || m.type === 'conflict' || m.type === 'error',
      () => transport.send(message),
    );
    if (reply.type === 'error') throw this.toError(reply);

    if (reply.type === 'commitAck') {
      if (reply.seq > this.cursor) this.cursor = reply.seq;
      this.applyAckToIndex(commit, reply.version, reply.clock);
      return;
    }
    await this.handleConflictReply(commit, reply);
  }

  private applyAckToIndex(commit: StagedCommit, versionId: string, clock: LogicalClock): void {
    const deleted = commit.kind === 'delete';
    if (commit.kind === 'rename' && commit.fromPath !== undefined) {
      this.index = applyCommit(removeEntry(this.index, commit.fromPath), {
        path: commit.path,
        versionId,
        hash: commit.hash,
        size: commit.size,
        clock,
      });
      return;
    }
    this.index = applyCommit(this.index, {
      path: commit.path,
      versionId,
      hash: commit.hash,
      size: commit.size,
      clock,
      deleted,
      deletedAt: deleted ? this.now() : undefined,
      ...(commit.isFolder === true ? { isFolder: true } : {}),
    });
  }

  private async handleConflictReply(
    commit: StagedCommit,
    reply: ConflictMessage,
  ): Promise<void> {
    if (reply.seq !== undefined && reply.seq > this.cursor) this.cursor = reply.seq;
    const weWon =
      reply.winner.deviceId === this.options.deviceId && reply.winner.hash === commit.hash;
    if (weWon) {
      this.applyAckToIndex(commit, reply.winner.id, reply.winner.clock);
      return;
    }

    // We lost the race. Materialize the winner directly — the server has
    // already preserved our content as a conflict copy (if it was distinct).
    // One caveat: if the working tree moved on AGAIN since we staged this
    // commit, do not clobber it either — hand the whole thing to a cycle.
    if (commit.kind !== 'delete' && commit.kind !== 'rename' && commit.isFolder !== true) {
      const local = await this.readLocal(commit.path);
      if (local !== undefined && (await sha256Hex(local)) !== commit.hash) {
        this.scheduleReconcile();
        return;
      }
    }

    if (commit.kind === 'rename' && commit.fromPath !== undefined) {
      // Our rename lost: the file stays where the winner keeps it; record
      // the winner head for the destination (the source path is untouched).
      this.index = applyCommit(this.index, {
        path: reply.winner.path,
        versionId: reply.winner.id,
        hash: reply.winner.hash,
        size: reply.winner.size,
        clock: reply.winner.clock,
      });
      return;
    }

    this.index = await this.applyPulls([this.winnerAsPull(reply.winner)]);
  }

  /** Turn an arbitrated winner version into a pull op (content ops only). */
  private winnerAsPull(winner: {
    path: string;
    id: string;
    hash: string;
    size: number;
    deviceId: string;
    clock: LogicalClock;
    kind: CommitMessage['kind'];
  }): PullOp {
    const entry = this.index[winner.path];
    const deleted = winner.kind === 'delete';
    const kind: PullFileOp['kind'] = deleted
      ? 'delete'
      : entry === undefined
        ? 'add'
        : entry.deletedAt !== undefined
          ? 'restore'
          : 'edit';
    return {
      kind,
      path: winner.path,
      hash: winner.hash,
      size: winner.size,
      version: winner.id,
      clock: winner.clock,
      deleted,
    };
  }

  private async uploadBlob(hash: string, bytes: Uint8Array): Promise<void> {
    const transport = this.transport;
    if (transport === null) throw new NetworkError('not connected');
    const reply = await this.request<BlobAckMessage | ServerErrorMessage>(
      (m) => m.type === 'blobAck' || m.type === 'error',
      () => transport.send({ type: 'putBlob', hash, content: bytesToBase64(bytes) }),
    );
    if (reply.type === 'error') throw this.toError(reply);
    await this.options.blobStore.put(hash, bytes);
  }

  private readonly fetchBlob: FetchBlob = async (hash: string): Promise<Uint8Array> => {
    if (hash === '') throw new ProtocolError('refusing to fetch content for an empty hash');
    const cached = await this.options.blobStore.get(hash);
    if (cached !== undefined) return cached;
    const bytes = await this.downloadBlob(hash);
    await this.options.blobStore.put(hash, bytes);
    return bytes;
  };

  private async downloadBlob(hash: string): Promise<Uint8Array> {
    const transport = this.transport;
    if (transport === null) throw new NetworkError('not connected');
    const reply = await this.request<BlobMessage | ServerErrorMessage>(
      (m) => (m.type === 'blob' && m.hash === hash) || m.type === 'error',
      () => transport.send({ type: 'getBlob', hash }),
    );
    if (reply.type === 'error') throw this.toError(reply);
    const bytes = base64ToBytes(reply.content);
    if ((await sha256Hex(bytes)) !== hash) {
      throw new ProtocolError(`blob ${hash} failed verification on download`);
    }
    return bytes;
  }

  // --- plumbing -------------------------------------------------------------------------------

  private request<T extends ServerMessage>(
    matches: (message: Message) => boolean,
    send: () => void,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.expectation = {
        matches: (message) => matches(message),
        resolve: (message) => resolve(message as T),
        reject,
      };
      try {
        send();
      } catch (error) {
        this.expectation = null;
        reject(error instanceof Error ? error : new NetworkError(String(error)));
      }
    });
  }

  private toError(message: ServerErrorMessage): Error {
    switch (message.code) {
      case 'UNAUTHORIZED':
        return new UnauthorizedError(message.message);
      case 'REVOKED':
        return new RevokedError(message.message);
      default:
        return new ProtocolError(message.message);
    }
  }

  private enqueue(operation: () => Promise<void>): Promise<void> {
    this.queuedOps += 1;
    const run = this.tail.then(operation, operation);
    const settled = run.then(
      () => {
        this.queuedOps -= 1;
        this.persistIndex();
      },
      (error: unknown) => {
        this.queuedOps -= 1;
        this.persistIndex();
        throw error;
      },
    );
    // Swallow rejections on the shared tail (individual callers see them via
    // `settled`); one failed op must not poison the queue.
    this.tail = settled.then(
      () => {},
      () => {},
    );
    return settled;
  }

  private persistIndex(): void {
    const snapshot = serializeLocalIndex(this.index);
    void this.options.storage
      .writeFile(LOCAL_INDEX_STATE_PATH, new TextEncoder().encode(snapshot))
      .catch((error: unknown) => this.log.warn('failed to persist local index', error));
  }
}

// --- module-private type aliases ---------------------------------------------------------

type ServerErrorMessage = Extract<ServerMessage, { type: 'error' }>;
