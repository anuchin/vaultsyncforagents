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
