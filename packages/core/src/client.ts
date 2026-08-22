/**
 * `SyncClient` — the network-facing orchestrator (ARCHITECTURE.md §8).
 *
 * Composes the phase-1a/1b pieces into one loop per device:
 *
 *   startup:  loadLocalState (entries + persisted cursor) → hello/helloAck
 *             (server reports `oldestRetainedSeq`) → getManifest — a DELTA
 *             manifest (`since: syncedThrough`) merged over the index
 *             projection when the replay window is intact, else full →
 *             scanVault → computeSyncPlan → execute (pushes through a
 *             bounded-concurrency pipeline, pulls via applyPull with the
 *             injected blob store);
 *   live:     `change` messages materialize immediately when the target is
 *             clean, and defer to a full reconcile cycle when it is not — a
 *             remote change is NEVER written over locally-modified content
 *             without going through `computeSyncPlan`'s conflict logic;
 *   watcher:  `WatchAdapter` batches are debounced (~300 ms, injectable
 *             scheduler — no ambient timers in tests) into scan→plan→execute;
 *   reconnect: `onClose` flips to `'disconnected'`; `reconnect()` re-runs the
 *             whole startup reconciliation (backoff is the caller's job).
 *
 * Bulk phases report X/Y on `status().progress` (throttled via the injected
 * clock); the push phase keeps up to `pushConcurrency` commits in flight.
 *
 * All I/O crosses the adapter seams (`StorageAdapter`, `Transport`,
 * `BlobStore`, `LogAdapter`); the class itself is pure orchestration and runs
 * anywhere `core` runs — Workers tests included.
 */

import type { LogAdapter, StorageAdapter, WatchAdapter } from './adapters.js';
import { compareClocks } from './clock.js';
import { applyPull, loadLocalState, pruneParentOnDelete, removeDirIfVacant, type FetchBlob } from './engine.js';
import { NetworkError, ProtocolError, RevokedError, UnauthorizedError } from './errors.js';
import { sha256Hex } from './hashing.js';
import { isIgnored, type IgnoreSettings } from './ignore.js';
import {
  applyCommit,
  LOCAL_INDEX_STATE_PATH,
  removeEntry,
  serializeLocalIndex,
  type LocalIndex,
  type PersistedSyncState,
} from './localindex.js';
import { isWindowsUnsafePath } from './paths.js';
import {
  base64ToBytes,
  bytesToBase64,
  INLINE_CONTENT_MAX_BYTES,
  ProtocolVersion,
  validateChangeMessage,
  validateCommitAckMessage,
  validateConflictMessage,
  validateManifestMessage,
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
  type SnapshotCreateAckMessage,
  type SnapshotRestoreAckMessage,
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
import { recordHashedFiles, scanVault, type HashedFile } from './scan.js';
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
  /**
   * Bounded concurrency of the push pipeline: how many commits may be in
   * flight (sent, awaiting ack) at once. Default 8. Conflict arbitration is
   * server-side and PER PATH, and a cycle stages at most one commit per path,
   * so ordering across different files is irrelevant — see
   * `runPushPipeline` for the full argument.
   */
  pushConcurrency?: number;
  /**
   * Minimum wall-clock ms between `status().progress` updates during bulk
   * phases (default 50 — renderer coalescing; phase changes and completions
   * always emit). Tests pass 0 to observe every file.
   */
  progressThrottleMs?: number;
}

export type SyncClientState = 'idle' | 'connecting' | 'syncing' | 'live' | 'disconnected';

/** The bulk phase a running cycle is currently grinding through. */
export type SyncPhase = 'scanning' | 'pushing' | 'pulling';

/** X/Y progress of one bulk phase; present on `SyncClientStatus` mid-cycle only. */
export interface SyncProgress {
  phase: SyncPhase;
  done: number;
  total: number;
}

export interface SyncClientStatus {
  state: SyncClientState;
  /** Epoch ms of the last completed cycle, or null before the first. */
  lastSyncAt: number | null;
  /** Watcher/reconcile events queued behind the debounce window. */
  pending: number;
  /**
   * Conflicts observed by the most recent plan cycle (informational;
   * resolution is in the data). Replaced every cycle — a later cycle that
   * plans clean clears it, so a synced-quiet client reports 0.
   */
  conflicts: ConflictOp[];
  /**
   * Paths whose live index entry is INVISIBLE on this filesystem because
   * another synced file differs from it only by name case (a case-colliding
   * pair, creatable from a case-sensitive client — ARCHITECTURE §14). The
   * scan never pushes a deletion for them; they are surfaced here (and via a
   * `warn` log line per cycle) until a human renames one of the pair.
   * Replaced every cycle like `conflicts`; omitted when there are none.
   */
  caseCollisions?: string[];
  /**
   * Paths the most recent cycle SKIPPED because their names cannot be
   * materialized on Windows (reserved device names like `CON`/`NUL`/`COM1`,
   * or segments ending in `.`/` ` — see `paths.ts`). Local files with such
   * names are never pushed and remote heads at such paths are never applied;
   * a later version change at the path is attempted again. Surfaced here
   * (and via a `warn` log line) until a human renames the path; replaced
   * every cycle like `conflicts`. Omitted when there are none.
   */
  skippedPaths?: string[];
  /**
   * Server release version as reported by helloAck (null before the first
   * ack — and for legacy servers ≤ 0.1, which never send the field; see
   * `checkServerCompatibility` for the shared skew policy).
   */
  serverVersion: string | null;
  /**
   * Progress of the RUNNING cycle's current bulk phase (`vsa ⋯ 1234/5000`);
   * absent between cycles. Updates are throttled to `progressThrottleMs`.
   */
  progress?: SyncProgress;
}

/** Default in-flight commit cap (see `SyncClientOptions.pushConcurrency`). */
export const DEFAULT_PUSH_CONCURRENCY = 8;
/** Default progress coalescing window (see `SyncClientOptions.progressThrottleMs`). */
export const DEFAULT_PROGRESS_THROTTLE_MS = 50;

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
  /**
   * Storage mtime observed by THIS cycle's scan when it hashed the content
   * (`HashedFile.mtime` of the push source). Pinned onto the index entry when
   * the ack lands, so the entry's (hash, size, mtime) always describes ONE
   * consistent instant of the file — never a later stat paired with this
   * hash. That ordering is what lets the scan fast-path (mtime+size) skip
   * re-hashing safely: an edit landing between hash and ack changes the disk
   * stat, misses the fast path, and is re-hashed and pushed on the next scan.
   */
  mtime?: number;
}

// --- the client ---------------------------------------------------------------------

export class SyncClient {
  private readonly options: SyncClientOptions;
  private readonly log: LogAdapter;
  private readonly now: () => number;
  private readonly debounceMs: number;
  private readonly schedule: (fn: () => void, ms: number) => () => void;
  private readonly dialTransport: () => Transport;
  private readonly pushConcurrency: number;
  private readonly progressThrottleMs: number;

  private transport: Transport | null = null;
  private state: SyncClientState = 'idle';
  private index: LocalIndex = {};
  private cursor = 0;
  private lastSyncAt: number | null = null;
  private pending = 0;
  private conflicts: ConflictOp[] = [];
  private caseCollisions: string[] = [];
  private skippedPaths: string[] = [];
  private ignoreSettings: IgnoreSettings;
  private watchAdapter: WatchAdapter | null = null;
  private cancelDebounce: (() => void) | null = null;

  /**
   * Delta-manifest bookkeeping (persisted alongside the index, see
   * `PersistedSyncState`): `syncedThrough` — the manifest cursor of the last
   * fully-successful cycle, i.e. the seq through which the index is known
   * COMPLETE (null until one finishes); `needsFullManifest` — a remote change
   * was deferred over local divergence and must be resolved through a full
   * manifest's plan logic; `serverOldestRetainedSeq` — the helloAck's answer
   * to "is my replay window intact" (null for legacy servers ⇒ always full).
   */
  private syncedThrough: number | null = null;
  private needsFullManifest = false;
  private serverOldestRetainedSeq: number | null = null;
  /** Server release from helloAck; null until acked (legacy servers stay null). */
  private serverVersion: string | null = null;

  /** Current bulk-phase progress, cleared when a cycle settles. */
  private progress: SyncProgress | null = null;
  private lastProgressAt = 0;

  /** Serialized operation queue — exactly one async op runs at a time. */
  private tail: Promise<unknown> = Promise.resolve();
  private queuedOps = 0;
  /** Startup-time change flood is buffered; the full manifest subsumes it. */
  private buffering = false;
  private buffered: Message[] = [];
  /**
   * Outstanding request expectations, oldest first. Ops are serialized per
   * cycle EXCEPT the push pipeline, which keeps several commits in flight —
   * replies on the ordered WS arrive in send order, so matching the OLDEST
   * expectation that accepts a message pairs every reply with its request
   * (the DO arbitrates behind `runExclusive`, and the in-memory server
   * mirrors that, so the server never reorders replies either).
   */
  private expectations: Array<{
    matches: (message: Message) => boolean;
    resolve: (message: Message) => void;
    reject: (error: Error) => void;
  }> = [];
  /**
   * Serializes ACK APPLICATION across pipeline slots. Slots await replies
   * concurrently, but each reply folds into the SHARED `this.index`
   * (read-modify-write); chaining the folds keeps every apply atomic with
   * respect to the others. Order across different paths is irrelevant (one
   * commit per path per cycle, per-path server arbitration), so no ordering
   * guarantee is needed beyond mutual exclusion.
   */
  private ackChain: Promise<void> = Promise.resolve();

  constructor(options: SyncClientOptions) {
    this.options = options;
    this.log = options.log ?? defaultLog;
    this.now = options.now ?? (() => Date.now());
    this.debounceMs = options.debounceMs ?? 300;
    this.schedule = options.schedule ?? defaultSchedule;
    this.pushConcurrency = Math.max(1, options.pushConcurrency ?? DEFAULT_PUSH_CONCURRENCY);
    this.progressThrottleMs = Math.max(0, options.progressThrottleMs ?? DEFAULT_PROGRESS_THROTTLE_MS);
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
      ...(this.caseCollisions.length > 0 ? { caseCollisions: [...this.caseCollisions] } : {}),
      ...(this.skippedPaths.length > 0 ? { skippedPaths: [...this.skippedPaths] } : {}),
      serverVersion: this.serverVersion,
      ...(this.progress !== null ? { progress: { ...this.progress } } : {}),
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

    // Restore the index AND the sync-cursor bookkeeping (one atomic file):
    // the persisted cursor lets hello replay only what was missed, and
    // `syncedThrough` decides whether a delta manifest may be requested.
    // A state file that fails to parse or validate is moved aside (the
    // config-store recovery pattern) and the client resyncs from a FULL
    // manifest off a fresh index — one corrupt field must not wedge every
    // future startup.
    if (await this.safeStorageExists(LOCAL_INDEX_STATE_PATH)) {
      try {
        const loaded = await loadLocalState(this.options.storage);
        this.index = loaded.index;
        this.cursor = loaded.state.cursor;
        this.syncedThrough = loaded.state.syncedThrough;
        this.needsFullManifest = loaded.state.needsFullManifest;
      } catch (error) {
        try {
          await this.options.storage.renameFile(
            LOCAL_INDEX_STATE_PATH,
            `${LOCAL_INDEX_STATE_PATH}.corrupt.bak`,
          );
        } catch {
          // Could not move the bad file aside; the first persist below
          // overwrites it, so the client can still operate.
        }
        this.log.warn(
          'local index state is corrupt; quarantined to state.corrupt.bak and resyncing from a full manifest',
          error,
        );
        this.resetLocalState();
      }
    } else {
      this.resetLocalState();
    }
    this.serverOldestRetainedSeq = null;
    // Version skew is re-assessed per connection: reset before the ack so a
    // reconnect against a different (or legacy) server never reports a stale
    // version between the dial and the fresh helloAck.
    this.serverVersion = null;

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
    // The server's per-vault `obsidianSync` supersedes the local initial
    // value, but `extraIgnores` is a client-side concern — the worker never
    // sends it, so the locally configured patterns survive the handshake.
    this.ignoreSettings = {
      obsidianSync: helloAck.settings.obsidianSync,
      ...(this.ignoreSettings.extraIgnores !== undefined
        ? { extraIgnores: this.ignoreSettings.extraIgnores }
        : {}),
    };
    // Replay-window answer: with this, the client can tell whether every
    // event after its cursor was retained (delta-manifest eligibility).
    this.serverOldestRetainedSeq = helloAck.oldestRetainedSeq ?? null;
    this.serverVersion = helloAck.serverVersion ?? null;

    this.state = 'syncing';
    if (this.shouldRequestDeltaManifest()) {
      // DELTA MODE: apply the replayed changes BEFORE planning. The delta
      // manifest omits every head at or below the cursor — including heads
      // that no longer exist because the authority MIGRATED them (a rename
      // deletes the old row) — so the index projection must not carry those
      // paths anymore. The replayed rename (seq > cursor) materializes here
      // and removes the stale path, making the merged view identical to what
      // a full manifest would have said. (The ordered wire guarantees the
      // replay precedes the manifest reply; anything straggling stays
      // buffered and is dispatched after the cycle, as always.) A replayed
      // change that hits the divergence guard flips `needsFullManifest`,
      // and `fetchManifest` re-evaluates — falling back to full, as designed.
      const replay = this.buffered;
      this.buffered = [];
      for (const message of replay) {
        await this.dispatch(message);
      }
    }
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

  /** Fresh index + cursor bookkeeping: no prior knowledge, full manifest. */
  private resetLocalState(): void {
    this.index = {};
    this.cursor = 0;
    this.syncedThrough = null;
    this.needsFullManifest = false;
  }

  private onTransportClose(reason: { code?: number; reason?: string }): void {
    this.log.warn('transport closed', reason);
    this.state = 'disconnected';
    const expectations = this.expectations;
    this.expectations = [];
    for (const expectation of expectations) {
      expectation.reject(
        new NetworkError(`connection closed: ${reason.reason ?? reason.code ?? 'unknown'}`),
      );
    }
  }

  // --- message pump ----------------------------------------------------------------------

  private onTransportMessage = (message: Message): void => {
    // Oldest expectation that accepts this message. With the push pipeline
    // several commit expectations are outstanding at once; the ordered wire +
    // the server's serialized arbitration deliver replies in send order, so
    // first-match pairs each reply with its own request.
    const index = this.expectations.findIndex((expectation) => expectation.matches(message));
    if (index >= 0) {
      const expectation = this.expectations[index];
      this.expectations.splice(index, 1);
      if (expectation !== undefined) expectation.resolve(message);
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
      case 'snapshotCreateAck':
      case 'snapshotRestoreAck':
        // Replies arrive only against an outstanding expectation; a
        // spontaneous one is a protocol violation we log and drop.
        this.log.warn('unexpected server reply', message.type);
        return;
      default:
        this.log.warn('ignoring client-to-server message from server', message);
    }
  }

  private async handleChange(change: ChangeMessage): Promise<void> {
    validateChangeMessage(change);
    if (change.seq > this.cursor) this.cursor = change.seq;
    // Windows-unsafe paths can never be materialized here: skip the head
    // (diagnosed, not applied) instead of failing the handler every time.
    // Checked before the ignore rules — an unsyncable path is never ignored
    // silently.
    const unsafe = firstUnsafePath(
      change.fromPath !== undefined ? [change.path, change.fromPath] : [change.path],
    );
    if (unsafe !== undefined) {
      this.recordSkippedPath(unsafe);
      // The head is resolved — by skipping — so the completion watermark
      // advances with the feed like an applied change would.
      if (change.seq > (this.syncedThrough ?? 0)) this.syncedThrough = change.seq;
      return;
    }
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
      // The divergence must be resolved by a plan cycle that can SEE the
      // remote head — flag the next manifest full (delta manifests omit
      // heads at or below the cursor, which this change may be at).
      this.needsFullManifest = true;
      this.scheduleReconcile();
      return;
    }

    this.index = await this.applyPulls([this.pullOpFromChange(change)]);
    // This path's head is now materialized locally, so the completion
    // watermark advances with the (strictly ordered) feed. A change that
    // took the defer branch above never reaches this line, and its
    // `needsFullManifest` flag keeps delta mode off until a full-manifest
    // cycle resolves the divergence.
    if (change.seq > (this.syncedThrough ?? 0)) this.syncedThrough = change.seq;
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
  private async applyPulls(
    pulls: ReadonlyArray<PullOp>,
    progress?: { onProgress: (done: number, total: number) => void },
  ): Promise<LocalIndex> {
    // Pulls whose target path is Windows-unsafe would throw in the adapter
    // every cycle; they are skipped and diagnosed instead (a later version
    // change at the path is attempted again).
    const materializable: PullOp[] = [];
    for (const pull of pulls) {
      const unsafe = firstUnsafePath(pullTargets(pull));
      if (unsafe === undefined) {
        materializable.push(pull);
        continue;
      }
      this.recordSkippedPath(unsafe);
    }
    return applyPull(
      this.options.storage,
      this.index,
      { pushes: [], pulls: materializable, conflicts: [], folderPushes: [] },
      this.fetchBlob,
      {
        now: this.now(),
        // Keep the envelope's cursor bookkeeping intact across pull-side
        // persists (applyPull rewrites the whole state file).
        persistedState: this.persistedState(),
        ...(progress !== undefined ? { onProgress: progress.onProgress } : {}),
      },
    );
  }

  /** The envelope bookkeeping written whenever the client persists the index. */
  private persistedState(): PersistedSyncState {
    return {
      cursor: this.cursor,
      syncedThrough: this.syncedThrough,
      needsFullManifest: this.needsFullManifest,
    };
  }

  /**
   * Record a path the cycle could not sync because its name is
   * Windows-unsafe (`paths.ts`): surfaced on `status().skippedPaths` and
   * logged once per record until a human renames it. Deduped; replaced at
   * the start of every cycle.
   */
  private recordSkippedPath(path: string): void {
    if (this.skippedPaths.includes(path)) return;
    this.skippedPaths.push(path);
    this.log.warn(
      'skipping a Windows-unsafe path (reserved device name or trailing dot/space); rename it to sync',
      path,
    );
  }

  /**
   * Record one bulk-phase step on `status().progress`. Coalesced to at most
   * one update per `progressThrottleMs` (renderer churn), EXCEPT phase
   * changes and completions, which always emit so a phase is never missed
   * and `done/total` always lands on its final value.
   */
  private emitProgress(phase: SyncPhase, done: number, total: number): void {
    if (total === 0) return; // nothing to show for an empty phase
    const now = this.now();
    const complete = done >= total;
    const phaseChanged = this.progress?.phase !== phase;
    if (!complete && !phaseChanged && now - this.lastProgressAt < this.progressThrottleMs) return;
    this.lastProgressAt = now;
    this.progress = { phase, done, total };
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
    this.progress = null;
    this.skippedPaths = [];
    try {
      const manifest = await this.fetchManifest();
      const localChanges = await scanVault(
        this.options.storage,
        this.index,
        this.ignoreSettings,
        this.now(),
        {
          onProgress: (done, total) => this.emitProgress('scanning', done, total),
          // Sharpens the staleDirs rule: an empty dir over a tombstone THIS
          // device authored is a local recreation, not a deletion residue.
          thisDeviceId: this.options.deviceId,
        },
      );
      const plan = computeSyncPlan({
        localChanges,
        index: this.index,
        manifest,
        thisDeviceId: this.options.deviceId,
        thisDeviceName: this.options.deviceName,
        now: this.now(),
      });
      // Conflicts reflect the latest plan: entries for paths no longer
      // contested are dropped (a cycle that plans clean clears the list), so
      // a synced-quiet client reports 0 while still-contested paths stay
      // visible until a cycle actually resolves them.
      this.conflicts = [...plan.conflicts];
      // Case-collision diagnostics from the scan (never deletions — see
      // `SyncClientStatus.caseCollisions`): replaced every cycle so a
      // resolved collision disappears, an unresolved one stays visible.
      this.caseCollisions = [...(localChanges.caseCollisions ?? [])];
      if (this.caseCollisions.length > 0) {
        this.log.warn(
          'case-colliding file pair: these files differ only by name case and one is invisible on this filesystem; rename one of them',
          this.caseCollisions,
        );
      }
      // Windows-unsafe local names (never pushed — see `paths.ts`) surface
      // through the same diagnostics channel.
      for (const path of localChanges.unsafePaths ?? []) {
        this.recordSkippedPath(path);
      }

      // Stage push contents BEFORE pulls overwrite the working tree (a
      // conflict-copy push reads the loser content from the original path).
      const staged = await this.stagePushes(plan, localChanges.hashed);

      this.index = await this.applyPulls(plan.pulls, {
        onProgress: (done, total) => this.emitProgress('pulling', done, total),
      });

      // Push pipeline: up to `pushConcurrency` commits in flight; acks fold
      // into the index as they arrive (serialized through `ackChain`).
      // Blob uploads for >256KB files start inside their slot and overlap
      // with the OTHER slots' in-flight commits instead of serializing.
      const pushTotal = staged.length + plan.folderPushes.length;
      let pushDone = 0;
      const settlePush = (): void => {
        pushDone += 1;
        this.emitProgress('pushing', pushDone, pushTotal);
      };
      this.emitProgress('pushing', 0, pushTotal);
      await this.runPushPipeline(staged, settlePush);

      // Prune-on-delete (C), local side: every deletion that actually
      // committed this cycle (the index now tombstones it / migrated it away)
      // may have emptied its parent directory. Remove such directories —
      // BEFORE the placeholder pushes below, so an emptied directory is not
      // immediately re-pushed as an empty-folder placeholder.
      const emptiedDirs = new Set<string>();
      for (const commit of staged) {
        // The path that ceased to exist, IF its commit actually landed
        // (tombstoned in the index for deletes; migrated away for renames —
        // a delete that lost its race to a remote edit is not a deletion).
        let ceasedPath: string | undefined;
        if (commit.kind === 'delete' && commit.isFolder !== true) {
          if (this.index[commit.path]?.deletedAt !== undefined) ceasedPath = commit.path;
        } else if (commit.kind === 'rename' && commit.fromPath !== undefined) {
          if (!(commit.fromPath in this.index)) ceasedPath = commit.fromPath;
        }
        if (ceasedPath === undefined) continue;
        const pruned = await pruneParentOnDelete(this.options.storage, this.index, ceasedPath);
        if (pruned === undefined) continue;
        emptiedDirs.add(pruned.dir);
        const placeholder = this.index[pruned.dir];
        if (placeholder?.isFolder && placeholder.deletedAt === undefined) {
          // We just removed the directory a live placeholder still claims:
          // scan again so the placeholder is tombstoned and propagates.
          this.scheduleReconcile();
        }
      }

      // Stale-leftover cleanup (F-1): a tombstoned folder placeholder whose
      // EMPTY directory still exists on disk — the residue of a record-only
      // tombstone application (an adapter without `removeDir`, or a removal
      // that lost a race). The scan deliberately classifies these as
      // `staleDirs` instead of `emptyFolders`, so nothing below re-pushes
      // them as placeholders (that re-push resurrected deleted folders and
      // ping-ponged the deletion between devices). Retrying the removal here
      // converges storage onto the tombstone.
      for (const dir of localChanges.staleDirs ?? []) {
        await removeDirIfVacant(this.options.storage, this.index, dir);
      }

      const folderCommits: StagedCommit[] = [];
      for (const path of plan.folderPushes) {
        // Never resurrect a directory this cycle emptied (delete-derived
        // placeholders are suppressed even when removal itself was not
        // possible), nor push one that vanished since the scan.
        if (emptiedDirs.has(path)) continue;
        if (!(await this.storageExists(path))) continue;
        folderCommits.push({
          kind: 'edit',
          path,
          parentVersion: this.index[path]?.versionId ?? null,
          hash: '',
          size: 0,
          isFolder: true,
        });
      }
      await this.runPushPipeline(folderCommits, settlePush);

      // Cache the scan's hash observations (mtime) onto entries whose hash
      // still matches, so the next fast scan can skip those files. Runs
      // after pulls/pushes so freshly-acked entries benefit immediately;
      // `recordHashedFiles` skips anything the cycle changed underneath us.
      this.index = recordHashedFiles(this.index, localChanges.hashed);

      // The cycle finished clean: every pull of the manifest applied, every
      // staged commit acked. The index is now complete through the MANIFEST's
      // fetch-time cursor (deliberately not the later ack seqs — a concurrent
      // device's change can interleave and ride the post-cycle dispatch
      // queue), which is what makes the next delta manifest safe.
      if (this.manifestCursorOfCycle !== null && this.manifestCursorOfCycle > (this.syncedThrough ?? 0)) {
        this.syncedThrough = this.manifestCursorOfCycle;
      }
      this.manifestCursorOfCycle = null;
      this.needsFullManifest = false;

      this.lastSyncAt = this.now();
      this.pending = 0;
      if (!this.isDisconnected()) this.state = 'live';
    } catch (error) {
      this.manifestCursorOfCycle = null;
      this.log.error('sync cycle failed', error);
      if (!this.isDisconnected()) this.state = this.transport !== null ? 'live' : 'idle';
      throw error;
    } finally {
      this.progress = null;
    }
  }

  /**
   * The manifest's fetch-time cursor for the RUNNING cycle — the completion
   * watermark a successful cycle records into `syncedThrough` (see the
   * comment there). Null outside cycles.
   */
  private manifestCursorOfCycle: number | null = null;

  /**
   * Whether THIS cycle may request a delta manifest. All four gates must
   * hold (any failure ⇒ full manifest, today's behavior):
   *
   *  1. `cursor > 0` — a first-ever connect knows nothing; full manifest.
   *  2. `syncedThrough !== null` — some full-manifest cycle completed, so the
   *     index is COMPLETE through it; heads after it arrive via replay +
   *     delta. An interrupted initial sync never sets it ⇒ full manifest.
   *  3. `!needsFullManifest` — no deferred divergence awaits plan resolution.
   *  4. Replay window intact — helloAck reported `oldestRetainedSeq <=
   *     cursor + 1`, so every event after our cursor is still on the server.
   */
  private shouldRequestDeltaManifest(): boolean {
    return (
      this.cursor > 0 &&
      this.syncedThrough !== null &&
      !this.needsFullManifest &&
      this.serverOldestRetainedSeq !== null &&
      this.serverOldestRetainedSeq <= this.cursor + 1
    );
  }

  private async fetchManifest(): Promise<RemoteFile[]> {
    const transport = this.transport;
    if (transport === null) throw new NetworkError('not connected');
    const useDelta = this.shouldRequestDeltaManifest();
    const since = useDelta && this.syncedThrough !== null ? this.syncedThrough : undefined;
    const reply = await this.request<ManifestMessage | ServerErrorMessage>(
      (m) => m.type === 'manifest' || m.type === 'error',
      () => transport.send({ type: 'getManifest', ...(since !== undefined ? { since } : {}) }),
    );
    if (reply.type === 'error') throw this.toError(reply);
    validateManifestMessage(reply);
    if (reply.cursor > this.cursor) this.cursor = reply.cursor;
    this.manifestCursorOfCycle = reply.cursor;
    if (!useDelta) {
      return this.toRemoteFiles(Object.values(reply.entries));
    }
    // Delta: merge the changed heads over an INDEX PROJECTION of the full
    // manifest. computeSyncPlan needs the complete remote view — Phase B
    // treats an index path absent from the manifest as "migrated away" — and
    // eligibility guarantees the index already agrees with the server for
    // every path the delta omits (heads ≤ syncedThrough). Projecting entries
    // to their index state therefore reconstructs exactly what the full
    // manifest would have said, at O(changes) instead of O(vault).
    const merged = new Map<string, RemoteFile>();
    for (const [path, entry] of Object.entries(this.index)) {
      merged.set(path, {
        path,
        version: entry.versionId,
        hash: entry.hash,
        size: entry.size,
        deleted: entry.deletedAt !== undefined,
        clock: entry.clock,
        ...(entry.isFolder ? { isFolder: true } : {}),
        mtime: entry.mtime ?? 0,
      });
    }
    for (const [path, entry] of Object.entries(reply.entries)) {
      merged.set(path, { ...entry });
    }
    return this.toRemoteFiles([...merged.values()]);
  }

  /**
   * Project manifest-side entries to `RemoteFile`s, skipping Windows-unsafe
   * paths (diagnosed via `recordSkippedPath`, never handed to the planner —
   * materializing them is impossible, so planning them would only produce a
   * pull that fails every cycle).
   */
  private toRemoteFiles(entries: readonly RemoteFile[]): RemoteFile[] {
    const remote: RemoteFile[] = [];
    for (const entry of entries) {
      if (isWindowsUnsafePath(entry.path)) {
        this.recordSkippedPath(entry.path);
        continue;
      }
      remote.push({ ...entry });
    }
    return remote;
  }

  private async stagePushes(
    plan: SyncPlan,
    hashed: readonly HashedFile[],
  ): Promise<StagedCommit[]> {
    // A conflict-copy push carries content read from the *original* path.
    const copySources = new Map<string, string>();
    for (const conflict of plan.conflicts) {
      if (conflict.conflictCopyPath !== undefined) {
        copySources.set(conflict.conflictCopyPath, conflict.path);
      }
    }
    // Hash-time stats by path: pinning these onto the acked entries (below)
    // keeps the fast-path cache honest — see `StagedCommit.mtime`.
    const hashTimeMtime = new Map(hashed.map((observed) => [observed.path, observed.mtime]));

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
        // so this device must write its own copy itself. The copy lands at a
        // NEW path whose on-disk stat differs from the source's — no hash-time
        // stat to pin, the next scan records one.
        await this.options.storage.writeFile(push.path, bytes);
        staged.push({ ...this.toStaged(push), bytes });
        continue;
      }
      staged.push({
        ...this.toStaged(push),
        bytes,
        ...(hashTimeMtime.get(sourcePath) !== undefined
          ? { mtime: hashTimeMtime.get(sourcePath) }
          : {}),
      });
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
      ...(push.isFolder ? { isFolder: true } : {}),
    };
  }

  private async readLocal(path: string): Promise<Uint8Array | undefined> {
    try {
      return await this.options.storage.readFile(path);
    } catch {
      return undefined;
    }
  }

  /**
   * Send `commits` through a bounded-concurrency pipeline: up to
   * `pushConcurrency` commits in flight (sent, awaiting their server reply)
   * at once; each slot sends its next commit as soon as an earlier one is
   * settled.
   *
   * WHY PIPELINING IS SAFE (vs. a batch message): conflict arbitration is
   * SERVER-side and PER PATH (`arbitrateCommit` reads and writes exactly the
   * committed path's head), and a cycle stages at most ONE commit per path
   * (the scan buckets by path; renames consume both ends). So two in-flight
   * commits can never interact on the server, and reply ORDER across
   * different paths does not matter for the resulting state — only per-path
   * pairing of reply→commit matters, which the ordered WebSocket plus the
   * server's serialized arbitration guarantee (replies arrive in send order,
   * matched FIFO by `onTransportMessage`). A batch protocol message would
   * additionally couple blob-upload timing and error granularity for no
   * correctness gain, so protocol v1 stays unchanged.
   *
   * On the first failure, in-flight commits still settle (their acks are
   * applied — they are real heads) but no NEW commit starts; the error is
   * rethrown after all slots drain so the cycle fails exactly like the old
   * sequential loop did (unsent pushes simply retry next cycle).
   */
  private async runPushPipeline(
    commits: readonly StagedCommit[],
    onSettled: () => void,
  ): Promise<void> {
    if (commits.length === 0) return;
    let next = 0;
    let failure: Error | null = null;
    const slots = Math.min(this.pushConcurrency, commits.length);
    const worker = async (): Promise<void> => {
      while (next < commits.length) {
        if (failure !== null) return;
        const commit = commits[next++]!;
        try {
          await this.sendCommit(commit);
        } catch (error) {
          failure ??= error instanceof Error ? error : new Error(String(error));
          return;
        } finally {
          onSettled();
        }
      }
    };
    await Promise.all(Array.from({ length: slots }, worker));
    if (failure !== null) throw failure;
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

    // Attachments above the inline cap ride the blob store (FR-8). Inside a
    // pipeline slot this await overlaps with the OTHER slots' in-flight
    // commits — the upload no longer serializes ahead of every commit — and
    // still completes before ITS commit is sent (the server rejects a commit
    // whose blob has not arrived).
    if (commit.bytes !== undefined && commit.bytes.byteLength > INLINE_CONTENT_MAX_BYTES) {
      await this.uploadBlob(commit.hash, commit.bytes);
    }

    const reply = await this.request<CommitAckMessage | ConflictMessage | ServerErrorMessage>(
      (m) => m.type === 'commitAck' || m.type === 'conflict' || m.type === 'error',
      () => transport.send(message),
    );
    if (reply.type === 'error') throw this.toError(reply);
    if (reply.type === 'commitAck') {
      validateCommitAckMessage(reply);
    } else {
      validateConflictMessage(reply);
    }

    // Fold the reply into shared state behind the ack chain: concurrent
    // slots must not read-modify-write `this.index` at the same time.
    await this.serializeAckApplication(async () => {
      if (reply.type === 'commitAck') {
        if (reply.seq > this.cursor) this.cursor = reply.seq;
        this.applyAckToIndex(commit, reply.version, reply.clock);
        return;
      }
      await this.handleConflictReply(commit, reply);
    });
  }

  /** Chain one reply's index application after every previously-started one. */
  private serializeAckApplication(apply: () => Promise<void>): Promise<void> {
    const run = this.ackChain.then(apply, apply);
    this.ackChain = run.then(
      () => {},
      () => {},
    );
    return run;
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
    // `commit.mtime` is the stat observed at HASH time for this exact content
    // (threaded through `stagePushes`), never a stat taken at ack time — an
    // edit that landed between hashing and this ack changed the disk stat, so
    // the next scan misses the fast path and re-hashes/pushes the edit.
    this.index = applyCommit(this.index, {
      path: commit.path,
      versionId,
      hash: commit.hash,
      size: commit.size,
      clock,
      deleted,
      deletedAt: deleted ? this.now() : undefined,
      ...(commit.isFolder === true ? { isFolder: true } : {}),
      ...(commit.mtime !== undefined ? { mtime: commit.mtime } : {}),
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

  // --- snapshots -----------------------------------------------------------------------

  /**
   * Snapshot every file head on the authority (a whole-vault restore point).
   * Snapshots are not broadcast — other devices see nothing live.
   */
  async createSnapshot(name?: string): Promise<SnapshotCreateAckMessage> {
    const transport = this.transport;
    if (transport === null) throw new NetworkError('not connected');
    const reply = await this.request<SnapshotCreateAckMessage | ServerErrorMessage>(
      (m) => m.type === 'snapshotCreateAck' || m.type === 'error',
      () => transport.send({ type: 'snapshotCreate', ...(name !== undefined ? { name } : {}) }),
    );
    if (reply.type === 'error') throw this.toError(reply);
    return reply;
  }

  /**
   * Restore the whole vault to a snapshot. The server lands every reverted
   * head as a NEW version (history is never deleted) and fans the changes out
   * to OTHER sockets only — this device does not receive its own fan-out, so
   * the local index must re-converge from a FULL manifest: flag delta mode
   * off, then run a cycle inline (one-shot callers close the transport as
   * soon as this resolves, so a debounced cycle would never fire).
   */
  async restoreSnapshot(id: string): Promise<SnapshotRestoreAckMessage> {
    const transport = this.transport;
    if (transport === null) throw new NetworkError('not connected');
    const reply = await this.request<SnapshotRestoreAckMessage | ServerErrorMessage>(
      (m) => m.type === 'snapshotRestoreAck' || m.type === 'error',
      () => transport.send({ type: 'snapshotRestore', id }),
    );
    if (reply.type === 'error') throw this.toError(reply);
    this.needsFullManifest = true;
    await this.enqueue(() => this.runCycle());
    return reply;
  }

  // --- plumbing -------------------------------------------------------------------------------

  private request<T extends ServerMessage>(
    matches: (message: Message) => boolean,
    send: () => void,
  ): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const expectation: (typeof this.expectations)[number] = {
        matches: (message) => matches(message),
        resolve: (message) => resolve(message as T),
        reject,
      };
      this.expectations.push(expectation);
      try {
        send();
      } catch (error) {
        const index = this.expectations.indexOf(expectation);
        if (index >= 0) this.expectations.splice(index, 1);
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
    const snapshot = serializeLocalIndex(this.index, this.persistedState());
    void this.options.storage
      .writeFile(LOCAL_INDEX_STATE_PATH, new TextEncoder().encode(snapshot))
      .catch((error: unknown) => this.log.warn('failed to persist local index', error));
  }
}

// --- module-private type aliases ---------------------------------------------------------

type ServerErrorMessage = Extract<ServerMessage, { type: 'error' }>;

/** Every vault path a pull would touch on disk (both ends of a rename). */
function pullTargets(pull: PullOp): string[] {
  return pull.kind === 'rename' ? [pull.fromPath, pull.toPath] : [pull.path];
}

/** The first Windows-unsafe path among `paths`; undefined when all are safe. */
function firstUnsafePath(paths: readonly string[]): string | undefined {
  return paths.find((path) => isWindowsUnsafePath(path));
}
