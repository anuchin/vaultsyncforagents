import { describe, expect, it, vi } from 'vitest';

import {
  InMemoryStorageAdapter,
  InMemorySyncServer,
  sha256Hex,
  SyncClient,
  type BlobStore,
  type FileChangeEvent,
  type Message,
} from '../src/index.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const text = (b: Uint8Array): string => new TextDecoder().decode(b);

function makeBlobStore(): BlobStore & { map: Map<string, Uint8Array> } {
  const map = new Map<string, Uint8Array>();
  return {
    map,
    get: async (hash) => map.get(hash),
    put: async (hash, bytes) => {
      map.set(hash, bytes);
    },
  };
}

/** Queue-everything scheduler with manual flush (no real timers). */
class ManualScheduler {
  readonly entries: Array<{ fn: () => void; ms: number; cancelled: boolean }> = [];
  readonly schedule = (fn: () => void, ms: number): (() => void) => {
    const entry = { fn, ms, cancelled: false };
    this.entries.push(entry);
    return () => {
      entry.cancelled = true;
    };
  };
  flush(): void {
    while (this.entries.length > 0) {
      const batch = this.entries.splice(0);
      for (const entry of batch) if (!entry.cancelled) entry.fn();
    }
  }
}

interface ClientRig {
  client: SyncClient;
  storage: InMemoryStorageAdapter;
  blobStore: BlobStore & { map: Map<string, Uint8Array> };
  scheduler: ManualScheduler;
  sent: Message[];
}

function rig(): { server: InMemorySyncServer; make: (id: string, name: string) => ClientRig } {
  let t = 100_000;
  const server = new InMemorySyncServer({ now: () => ++t, vaultName: 'v' });
  const make = (id: string, name: string): ClientRig => {
    server.register(id, name);
    const scheduler = new ManualScheduler();
    const storage = new InMemoryStorageAdapter({}, { now: () => ++t });
    const blobStore = makeBlobStore();
    const sent: Message[] = [];
    const client = new SyncClient({
      deviceId: id,
      deviceName: name,
      token: `tok-${id}`,
      transport: () => {
        const pair = server.connectPair(`tok-${id}`);
        return {
          send: (message) => {
            sent.push(message);
            pair.client.send(message);
          },
          onMessage: (cb) => pair.client.onMessage(cb),
          onClose: (cb) => pair.client.onClose(cb),
          close: () => pair.client.close(),
        };
      },
      blobStore,
      storage,
      now: () => ++t,
      debounceMs: 250,
      schedule: scheduler.schedule,
    });
    return { client, storage, blobStore, scheduler, sent };
  };
  return { server, make };
}

async function settle(...rigs: ReadonlyArray<ClientRig>): Promise<void> {
  for (let round = 0; round < 4; round++) {
    for (const r of rigs) await r.client.waitIdle();
  }
}

describe('SyncClient — startup and status', () => {
  it('connects, runs one reconciliation, and reports live with a timestamp', async () => {
    const { make } = rig();
    const a = make('dev-a', 'Alpha');
    expect(a.client.status().state).toBe('idle');
    await a.client.connect();
    const status = a.client.status();
    expect(status.state).toBe('live');
    expect(status.lastSyncAt).not.toBeNull();
    expect(status.pending).toBe(0);
    expect(status.conflicts).toEqual([]);
  });

  it('pushes a local file as an inline commit and records the acked head', async () => {
    const { make } = rig();
    const a = make('dev-a', 'Alpha');
    await a.storage.writeFile('/notes/new.md', enc('fresh'));
    await a.client.connect();

    const commits = a.sent.filter((m) => m.type === 'commit');
    expect(commits).toHaveLength(1);
    const commit = commits[0] as Extract<Message, { type: 'commit' }>;
    expect(commit.kind).toBe('edit');
    expect(commit.parentVersion).toBeNull();
    expect(atob(commit.inline ?? '')).toBe('fresh');

    const entry = a.client.currentIndex()['/notes/new.md'];
    expect(entry).toBeDefined();
    expect(entry?.clock).toEqual({ counter: 1, deviceId: 'dev-a' });
    expect(a.client.cursorValue).toBeGreaterThan(0);
    // The index is persisted in the vault (ignored by scans).
    expect(await a.storage.exists('/.vaultsyncforagents/state')).toBe(true);
  });

  it('never commits ignored paths', async () => {
    const { make } = rig();
    const a = make('dev-a', 'Alpha');
    await a.storage.writeFile('/.trash/deleted.md', enc('trash'));
    await a.storage.writeFile('.DS_Store'.replace('.DS_Store', '/.DS_Store'), enc('junk'));
    await a.client.connect();
    expect(a.sent.filter((m) => m.type === 'commit')).toHaveLength(0);
    expect(a.client.currentIndex()['/.trash/deleted.md']).toBeUndefined();
  });
});

describe('SyncClient — the local-modification guard', () => {
  it('defers a remote change over locally-modified content, then reconciles via conflict logic', async () => {
    const { make } = rig();
    const a = make('dev-a', 'Alpha');
    const b = make('dev-b', 'Beta');
    await a.client.connect();
    await b.client.connect();
    await settle(a, b);

    // Shared file at v1.
    await a.storage.writeFile('/notes/x.md', enc('base'));
    await a.client.triggerSync();
    await settle(a, b);
    expect(text(await b.storage.readFile('/notes/x.md'))).toBe('base');

    // B modifies locally (NO watcher event — like an external edit while idle).
    await b.storage.writeFile('/notes/x.md', enc('beta edit'));
    // A edits and syncs; B receives the change while diverged.
    await a.storage.writeFile('/notes/x.md', enc('alpha edit'));
    await a.client.triggerSync();
    await settle(a, b);

    // The guard held: B's diverged content was NOT clobbered by the pull…
    expect(text(await b.storage.readFile('/notes/x.md'))).toBe('beta edit');
    // …and a reconcile cycle was scheduled behind the debounce.
    expect(b.scheduler.entries.length).toBeGreaterThan(0);
    b.scheduler.flush();
    await settle(a, b);

    // After reconciliation: 'dev-b' > 'dev-a' on the counter-2 tie ⇒ B wins,
    // A's content survives as the single conflict copy (from Alpha).
    expect(text(await b.storage.readFile('/notes/x.md'))).toBe('beta edit');
    expect(text(await a.storage.readFile('/notes/x.md'))).toBe('beta edit');
    const copies = (await a.storage.listFiles())
      .map((f) => f.path)
      .filter((p) => / \(conflict /.test(p));
    expect(copies).toHaveLength(1);
    expect(text(await a.storage.readFile(copies[0]!))).toBe('alpha edit');
    expect(text(await b.storage.readFile(copies[0]!))).toBe('alpha edit');
    expect(b.client.status().conflicts.length).toBeGreaterThan(0);

    // Lifecycle: the record reflects the LATEST cycle — once a clean pass
    // completes over the converged state, the counter returns to 0.
    await b.client.triggerSync();
    await settle(a, b);
    expect(b.client.status().conflicts).toEqual([]);
  });

  it('applies a remote change immediately when the target is clean', async () => {
    const { make } = rig();
    const a = make('dev-a', 'Alpha');
    const b = make('dev-b', 'Beta');
    await a.client.connect();
    await b.client.connect();
    await settle(a, b);

    await a.storage.writeFile('/notes/clean.md', enc('v1'));
    await a.client.triggerSync();
    await settle(a, b);
    expect(text(await b.storage.readFile('/notes/clean.md'))).toBe('v1');
    expect(b.scheduler.entries.length).toBe(0); // no deferred reconcile
  });
});

describe('SyncClient — second device pairs over byte-identical local files', () => {
  it('fresh index + identical content → silent convergence: no conflicts, no copies, no commits', async () => {
    // The documented second-machine setup flow: the vault already exists on
    // disk, the local index is fresh (e.g. after unlink) — every file is an
    // add-vs-add race with byte-identical content that must resolve quietly.
    const { make } = rig();
    const a = make('dev-a', 'Alpha');
    await a.storage.writeFile('/notes/one.md', enc('shared note'));
    await a.storage.writeFile('/notes/two.md', enc('another note'));
    await a.client.connect();

    const b = make('dev-b', 'Beta');
    await b.storage.writeFile('/notes/one.md', enc('shared note')); // identical bytes
    await b.storage.writeFile('/notes/two.md', enc('another note'));
    await b.client.connect();
    await settle(a, b);

    expect(b.client.status().conflicts).toEqual([]);
    expect(b.sent.filter((m) => m.type === 'commit')).toEqual([]); // no add-vs-add churn
    for (const r of [a, b]) {
      expect((await r.storage.listFiles()).filter((f) => / \(conflict /.test(f.path))).toEqual([]);
    }
    expect(b.client.currentIndex()['/notes/one.md']).toMatchObject({
      hash: await sha256Hex('shared note'),
    });
  });
});

describe('SyncClient — watcher debounce', () => {
  it('passes the configured window to the scheduler and coalesces bursts', async () => {
    const { make } = rig();
    const a = make('dev-a', 'Alpha');
    await a.client.connect();

    const watch = {
      started: false,
      cb: undefined as undefined | ((events: readonly FileChangeEvent[]) => void),
      start(cb: (events: readonly FileChangeEvent[]) => void): void {
        this.cb = cb;
        this.started = true;
      },
      stop(): void {
        this.cb = undefined;
      },
      emit(events: readonly FileChangeEvent[]): void {
        this.cb?.(events);
      },
    };
    a.client.startWatching(watch);
    expect(watch.started).toBe(true);

    await a.storage.writeFile('/notes/d.md', enc('one'));
    watch.emit([{ kind: 'modify', path: '/notes/d.md' }]);
    expect(a.scheduler.entries.map((e) => e.ms)).toEqual([250]);
    await a.storage.writeFile('/notes/d.md', enc('two'));
    watch.emit([{ kind: 'modify', path: '/notes/d.md' }]);

    a.scheduler.flush();
    await settle(a);
    // One commit, carrying the latest content only.
    const commits = a.sent.filter((m) => m.type === 'commit');
    expect(commits).toHaveLength(1);
    const inline = (commits[0] as Extract<Message, { type: 'commit' }>).inline;
    expect(inline !== undefined ? atob(inline) : undefined).toBe('two');

    a.client.stopWatching();
    expect(watch.cb).toBeUndefined();
  });
});

describe('SyncClient — blob cache', () => {
  it('serves repeat pulls from the local cache without new getBlob round-trips', async () => {
    const { make } = rig();
    const a = make('dev-a', 'Alpha');
    const b = make('dev-b', 'Beta');
    await a.client.connect();
    await b.client.connect();
    await settle(a, b);

    await a.storage.writeFile('/notes/blobbed.md', enc('content'));
    await a.client.triggerSync();
    await settle(a, b);
    expect(text(await b.storage.readFile('/notes/blobbed.md'))).toBe('content');
    expect(b.sent.filter((m) => m.type === 'getBlob')).toHaveLength(1);
    expect(b.blobStore.map.size).toBe(1);

    // A new device pulls the same content — B does not re-fetch anything…
    await b.storage.deleteFile('/notes/blobbed.md'); // simulate a local loss
    await b.client.triggerSync(); // index still matches manifest ⇒ no re-pull
    await settle(a, b);
    expect(b.sent.filter((m) => m.type === 'getBlob')).toHaveLength(1); // unchanged
  });
});

describe('SyncClient — lifecycle', () => {
  it('waitIdle resolves immediately when nothing is queued', async () => {
    const { make } = rig();
    const a = make('dev-a', 'Alpha');
    await a.client.waitIdle();
    expect(a.client.status().state).toBe('idle');
  });

  it('connect() with a bad token rejects Unauthorized and the client stays disconnected', async () => {
    let t = 1;
    const server = new InMemorySyncServer({ now: () => t++ });
    server.register('dev-a', 'Alpha');
    const client = new SyncClient({
      deviceId: 'dev-a',
      deviceName: 'Alpha',
      token: 'wrong-token',
      transport: () => server.connectPair('tok-dev-a').client,
      blobStore: makeBlobStore(),
      storage: new InMemoryStorageAdapter(),
      now: () => t++,
      schedule: new ManualScheduler().schedule,
    });
    await expect(client.connect()).rejects.toThrow(/unknown token/i);
    expect(client.status().state).toBe('disconnected');
  });

  it('close() stops the watcher and returns the client to idle', async () => {
    const { make } = rig();
    const a = make('dev-a', 'Alpha');
    await a.client.connect();
    a.client.close();
    expect(a.client.status().state).toBe('idle');
  });
});

describe('SyncClient — dropped-edit hardening (edit between hash and ack)', () => {
  /**
   * Real-Obsidian E2E regression: an edit landing between a cycle's hash and
   * the commit's ack was once silently dropped — the index ended up recording
   * the file as synced with a stat that hid the edit from every later fast
   * scan. Deterministic interleave with a controlled stat sequence: hash at
   * t1 (mtime 1001) → edit lands at t2 (mtime 1002) → ack processed at t3.
   * The ack must pin the HASH-time stat (1001), so the next scan misses the
   * fast path, re-hashes the edit, and pushes it.
   */
  it('pins the hash-time mtime at ack; the next scan detects and pushes the edit', async () => {
    let t = 100_000;
    const server = new InMemorySyncServer({ now: () => ++t, vaultName: 'v' });
    server.register('dev-a', 'Alpha');

    let diskTime = 1000; // controlled stat sequence (t1=1001, t2=1002)
    const storage = new InMemoryStorageAdapter({}, { now: () => diskTime });
    const blobStore = makeBlobStore();
    const sent: Message[] = [];
    const heldAckFlushers: Array<() => void> = [];
    let gating = true;

    const client = new SyncClient({
      deviceId: 'dev-a',
      deviceName: 'Alpha',
      token: 'tok-dev-a',
      transport: () => {
        const pair = server.connectPair('tok-dev-a');
        return {
          send: (message) => {
            sent.push(message);
            pair.client.send(message);
          },
          onMessage: (cb) =>
            pair.client.onMessage((message) => {
              if (gating && message.type === 'commitAck') {
                heldAckFlushers.push(() => cb(message));
                return;
              }
              cb(message);
            }),
          onClose: (cb) => pair.client.onClose(cb),
          close: () => pair.client.close(),
        };
      },
      blobStore,
      storage,
      now: () => ++t,
      debounceMs: 250,
      schedule: new ManualScheduler().schedule,
    });

    let cycle1: Promise<void> = Promise.resolve();
    try {
      await client.connect(); // empty vault → live

      // t1 — create hashed with stat mtime=1001, commit sent, ack HELD.
      diskTime = 1001;
      await storage.writeFile('/race.md', enc('create content'));
      cycle1 = client.triggerSync();
      await vi.waitFor(() => expect(heldAckFlushers.length).toBe(1)); // ack in flight

      // t2 — the edit lands on disk while the ack is held.
      diskTime = 1002;
      await storage.writeFile('/race.md', enc('edited content — longer'));

      // t3 — release the ack; cycle 1 completes.
      gating = false;
      for (const flush of heldAckFlushers.splice(0)) flush();
      await cycle1;

      const hashOfCreate = await sha256Hex(enc('create content'));
      const entry = client.currentIndex()['/race.md'];
      expect(entry).toBeDefined();
      expect(entry!.hash).toBe(hashOfCreate);
      // The invariant: hash-time stat pinned at ack — never the current one.
      expect(entry!.mtime).toBe(1001);
      expect(entry!.mtime).not.toBe((await storage.listFiles()).find((f) => f.path === '/race.md')!.mtime);

      // The next scan detects the edit and pushes it.
      await client.triggerSync();
      const hashOfEdit = await sha256Hex(enc('edited content — longer'));
      const commits = sent.filter((m): m is Extract<Message, { type: 'commit' }> => m.type === 'commit');
      expect(commits).toHaveLength(2);
      expect(commits[1]!.hash).toBe(hashOfEdit);
      const finalEntry = client.currentIndex()['/race.md']!;
      expect(finalEntry.hash).toBe(hashOfEdit);
      expect(finalEntry.mtime).toBe(1002); // now honestly describing the pushed content
    } finally {
      // Drain the in-flight cycle (release any held ack) BEFORE closing, so a
      // failed assertion never leaves a cycle to trip over the closed socket.
      gating = false;
      for (const flush of heldAckFlushers.splice(0)) flush();
      await cycle1.catch(() => {});
      await client.waitIdle().catch(() => {});
      client.close();
    }
  });
});

// --- folder lifecycle through the LIVE change-application path ------------------------------
//
// The F-1/F-2 real-Obsidian E2E failed with index-tombstoned-but-dir-lingers
// (40s+ observation, both the folder-tombstone and prune-on-delete flows)
// while every unit test stayed green: nothing asserted that the client's
// change-application path (handleChange → applyPull → applyOnePull, and the
// cycle's prune loop) actually INVOKES adapter.removeDir. The deployed
// adapter's hook threw on every call and the engine's deliberate record-only
// fallback swallowed it silently. These tests enter where the plugin enters —
// the server's change fan-out and the watcher-driven cycle — and assert the
// hook itself: called with the right path, never on non-empty dirs, and
// skipped gracefully when the capability is absent.

/** Record every removeDir call on a rig's storage (delegation preserved). */
function spyRemoveDir(storage: InMemoryStorageAdapter): string[] {
  const calls: string[] = [];
  const inner = storage.removeDir.bind(storage);
  storage.removeDir = async (path: string): Promise<void> => {
    calls.push(path);
    await inner(path);
  };
  return calls;
}

describe('SyncClient — folder lifecycle via change application (removeDir invocation)', () => {
  it('remote folder tombstone: the receiving device invokes removeDir with the folder path and removes the directory', async () => {
    const { make } = rig();
    const a = make('dev-a', 'Alpha');
    const b = make('dev-b', 'Beta');
    await a.client.connect();
    await b.client.connect();
    await settle(a, b);

    // Empty folder created on A propagates as a placeholder to B (FR-10).
    await a.storage.ensureDir('/tempfolder');
    await a.client.triggerSync();
    await settle(a, b);
    expect(await b.storage.exists('/tempfolder')).toBe(true);
    expect(b.client.currentIndex()['/tempfolder']?.isFolder).toBe(true);

    const bCalls = spyRemoveDir(b.storage);
    const marker = b.sent.length;

    // A deletes the empty folder; B receives the tombstone as a live change.
    await a.storage.removeDir('/tempfolder');
    await a.client.triggerSync();
    await settle(a, b);

    // The assertion the E2E proved missing in the wild: the hook ran, with
    // the exact vault path, and the directory actually left B's disk.
    expect(bCalls).toEqual(['/tempfolder']);
    expect(await b.storage.exists('/tempfolder')).toBe(false);
    expect(b.client.currentIndex()['/tempfolder']?.deletedAt).toBeDefined();
    // No resurrection: B never re-pushes the deleted folder.
    expect(
      b.sent
        .slice(marker)
        .filter((m) => m.type === 'commit' && (m as { path?: string }).path === '/tempfolder'),
    ).toEqual([]);
  });

  it('prune-on-delete: a remote file deletion that empties a folder invokes removeDir on BOTH sides', async () => {
    const { make } = rig();
    const a = make('dev-a', 'Alpha');
    const b = make('dev-b', 'Beta');
    await a.client.connect();
    await b.client.connect();
    await settle(a, b);

    await a.storage.writeFile('/prunedir/keep.md', enc('content'));
    await a.client.triggerSync();
    await settle(a, b);
    expect(await b.storage.exists('/prunedir/keep.md')).toBe(true);

    const aCalls = spyRemoveDir(a.storage);
    const bCalls = spyRemoveDir(b.storage);

    await a.storage.deleteFile('/prunedir/keep.md');
    await a.client.triggerSync();
    await settle(a, b);

    // Deleter side (the cycle's prune-on-delete loop)…
    expect(aCalls).toEqual(['/prunedir']);
    expect(await a.storage.exists('/prunedir')).toBe(false);
    // …and receiving side (applyOnePull's delete branch) — the E2E's broken half.
    expect(bCalls).toEqual(['/prunedir']);
    expect(await b.storage.exists('/prunedir')).toBe(false);
    expect(await b.storage.exists('/prunedir/keep.md')).toBe(false);
    // The emptied folder was never re-pushed as a placeholder on either side.
    expect(a.client.currentIndex()['/prunedir']).toBeUndefined();
    expect(b.client.currentIndex()['/prunedir']).toBeUndefined();
  });

  it('non-empty parent: a remote file deletion never invokes removeDir', async () => {
    const { make } = rig();
    const a = make('dev-a', 'Alpha');
    const b = make('dev-b', 'Beta');
    await a.client.connect();
    await b.client.connect();
    await settle(a, b);

    await a.storage.writeFile('/full/a.md', enc('a'));
    await a.storage.writeFile('/full/b.md', enc('b'));
    await a.client.triggerSync();
    await settle(a, b);

    const bCalls = spyRemoveDir(b.storage);

    await a.storage.deleteFile('/full/a.md');
    await a.client.triggerSync();
    await settle(a, b);

    expect(bCalls).toEqual([]); // '/full' still holds b.md — the hook is never attempted
    expect(await b.storage.exists('/full')).toBe(true);
    expect(text(await b.storage.readFile('/full/b.md'))).toBe('b');
    expect(b.client.currentIndex()['/full/a.md']?.deletedAt).toBeDefined();
  });

  it('an adapter without the removeDir hook applies the tombstone record-only and never crashes', async () => {
    const { make } = rig();
    const a = make('dev-a', 'Alpha');
    const b = make('dev-b', 'Beta');
    await a.client.connect();
    await b.client.connect();
    await settle(a, b);

    await a.storage.ensureDir('/tempfolder');
    await a.client.triggerSync();
    await settle(a, b);
    expect(await b.storage.exists('/tempfolder')).toBe(true);

    // The pre-hook adapter shape (the deployed bundle's rmdir-only removeDir
    // was effectively this: unusable for directories on the real vault).
    (b.storage as unknown as { removeDir?: unknown }).removeDir = undefined;

    await a.storage.removeDir('/tempfolder');
    await a.client.triggerSync();
    await settle(a, b);

    // Record-only: no throw, index tombstoned, directory lingers.
    expect(await b.storage.exists('/tempfolder')).toBe(true);
    expect(b.client.currentIndex()['/tempfolder']?.deletedAt).toBeDefined();
    // The stale-leftover rule keeps B from re-pushing it (no resurrection);
    // the per-cycle removeDir retry degrades to a graceful no-op.
    await b.client.triggerSync();
    await settle(a, b);
    expect(
      b.sent.filter((m) => m.type === 'commit' && (m as { path?: string }).path === '/tempfolder'),
    ).toEqual([]);
  });
});

describe('SyncClient — server version reporting', () => {
  /** Minimal scripted server: hello → helloAck, getManifest → empty manifest. */
  function scriptedServerRig(ack: { serverVersion?: string }) {
    let listener: ((message: Message) => void) | null = null;
    const transport = {
      send: (message: Message) => {
        queueMicrotask(() => {
          if (message.type === 'hello') {
            listener?.({
              type: 'helloAck',
              deviceId: 'dev-a',
              vaultName: 'v',
              settings: { obsidianSync: false, displayName: 'v' },
              ...(ack.serverVersion !== undefined ? { serverVersion: ack.serverVersion } : {}),
            });
          } else if (message.type === 'getManifest') {
            listener?.({ type: 'manifest', entries: {}, cursor: 0 });
          }
        });
      },
      onMessage: (cb: (message: Message) => void) => {
        listener = cb;
      },
      onClose: (_cb: (reason: { code?: number; reason?: string }) => void) => {},
      close: () => {},
    };
    const client = new SyncClient({
      deviceId: 'dev-a',
      deviceName: 'Alpha',
      token: 'tok-a',
      transport: () => transport,
      blobStore: makeBlobStore(),
      storage: new InMemoryStorageAdapter({}, { now: () => 1 }),
      now: () => 1,
      schedule: () => () => {},
    });
    return { client, transport };
  }

  it('status() carries helloAck.serverVersion (null before connect and for legacy servers)', async () => {
    const { client } = scriptedServerRig({ serverVersion: '0.2.1' });
    expect(client.status().serverVersion).toBeNull();
    await client.connect();
    expect(client.status().state).toBe('live');
    expect(client.status().serverVersion).toBe('0.2.1');

    const legacy = scriptedServerRig({});
    await legacy.client.connect();
    expect(legacy.client.status().serverVersion).toBeNull();
  });

  it('a reconnect resets the version until the new helloAck arrives', async () => {
    const ack: { serverVersion?: string } = { serverVersion: '0.2.1' };
    const { client, transport } = scriptedServerRig(ack);
    await client.connect();
    expect(client.status().serverVersion).toBe('0.2.1');

    // Flip the server to legacy AND hold the helloAck: during the reconnect
    // window (post-dial, pre-ack) status must read null, not the stale 0.2.1.
    delete ack.serverVersion;
    let holdAck = true;
    const originalSend = transport.send.bind(transport);
    transport.send = (message: Message) => {
      if (message.type === 'hello' && holdAck) return; // dial happened, no ack yet
      originalSend(message);
    };
    const reconnecting = client.reconnect();
    // Generous microtask flush: startup runs (state load + dial) and then
    // blocks on the held helloAck — it can never complete past this point.
    for (let hop = 0; hop < 50; hop++) await Promise.resolve();
    expect(client.status().state).toBe('connecting');
    expect(client.status().serverVersion).toBeNull();

    holdAck = false;
    originalSend({ type: 'hello', token: 'tok-a', protocolVersion: 1, cursor: 0 } as Message);
    await reconnecting;
    expect(client.status().state).toBe('live');
    expect(client.status().serverVersion).toBeNull(); // legacy server: stays null
    client.close();
  });
});
