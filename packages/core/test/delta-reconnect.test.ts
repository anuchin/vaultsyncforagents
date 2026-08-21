/**
 * Delta-manifest reconnect (large-vault performance hardening).
 *
 * On connect the client presents its persisted cursor; the server answers
 * with `helloAck.oldestRetainedSeq` whether the replay window is still
 * intact. When it is — and the client's index is known complete through its
 * `syncedThrough` watermark — the cycle requests a DELTA manifest
 * (`getManifest{since}`) merged over an index projection instead of pulling
 * O(vault) entries on every app-open.
 *
 * The correctness gate: delta reconnect and full reconnect must produce
 * IDENTICAL index + storage state. The equivalence runs the same offline
 * scenario twice — once with retained events (delta), once with force-pruned
 * events (full) — and compares byte-for-byte.
 */

import { describe, expect, it } from 'vitest';

import {
  InMemoryStorageAdapter,
  InMemorySyncServer,
  isIgnored,
  serializeLocalIndex,
  SyncClient,
  type BlobStore,
  type LocalIndex,
  type LocalIndexEntry,
  type Message,
  type Transport,
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

/** Capturable debounce scheduler (no real timers). */
class ManualScheduler {
  private readonly queue: Array<{ fn: () => void; cancelled: boolean }> = [];
  readonly schedule = (fn: () => void): (() => void) => {
    const entry = { fn, cancelled: false };
    this.queue.push(entry);
    return () => {
      entry.cancelled = true;
    };
  };
  flush(): void {
    while (this.queue.length > 0) {
      const batch = this.queue.splice(0);
      for (const entry of batch) if (!entry.cancelled) entry.fn();
    }
  }
}

interface Rig {
  id: string;
  client: SyncClient;
  storage: InMemoryStorageAdapter;
  sent: Message[];
  scheduler: ManualScheduler;
  disconnect(): void;
}

async function makeRig(): Promise<{
  server: InMemorySyncServer;
  alice: Rig;
  bob: Rig;
  settle: (...devices: ReadonlyArray<Rig[]>) => Promise<void>;
}> {
  let t = 1_000_000;
  const server = new InMemorySyncServer({ now: () => ++t, vaultName: 'personal' });
  const makeDevice = (id: string, name: string): Rig => {
    server.register(id, name);
    const scheduler = new ManualScheduler();
    const storage = new InMemoryStorageAdapter({}, { now: () => ++t });
    const sent: Message[] = [];
    const transports: Array<{ close(): void }> = [];
    const client = new SyncClient({
      deviceId: id,
      deviceName: name,
      token: `tok-${id}`,
      transport: () => {
        const pair = server.connectPair(`tok-${id}`);
        const recording: Transport = {
          send: (message) => {
            sent.push(message);
            pair.client.send(message);
          },
          onMessage: (cb) => {
            pair.client.onMessage(cb);
          },
          onClose: (cb) => {
            pair.client.onClose(cb);
          },
          close: () => {
            pair.client.close();
          },
        };
        transports.push(recording);
        return recording;
      },
      blobStore: makeBlobStore(),
      storage,
      // Bob's clock is CONSTANT: tombstone `deletedAt` stamps come from the
      // client clock, and the equivalence assertion compares serialized
      // indexes across two runs that take different code paths (delta vs
      // full) — the stamp must not depend on how many clock reads happened.
      now: () => 5_000_000,
      debounceMs: 300,
      schedule: scheduler.schedule,
    });
    return { id, client, storage, sent, scheduler, disconnect: () => transports[transports.length - 1]?.close() };
  };
  const alice = makeDevice('dev-alice', 'Alice');
  const bob = makeDevice('dev-bob', 'Bob');
  const settle = async (...groups: ReadonlyArray<Rig[]>): Promise<void> => {
    const all = groups.length > 0 ? groups.flat() : [alice, bob];
    for (let round = 0; round < 4; round++) {
      for (const device of all) await device.client.waitIdle();
    }
  };
  return { server, alice, bob, settle };
}

/**
 * The shared offline scenario: both devices sync a base vault, Bob goes
 * offline, Alice edits/adds/deletes/renames. Returns after Alice's changes
 * are committed server-side while Bob is away.
 */
async function runUntilBobOffline(rig: Awaited<ReturnType<typeof makeRig>>): Promise<void> {
  const { alice, bob, settle } = rig;
  for (const device of [alice, bob]) {
    await device.client.connect();
  }
  await settle();

  // Base vault, visible to both.
  await alice.storage.writeFile('/notes/f1.md', enc('f1 v1'));
  await alice.storage.writeFile('/notes/f2.md', enc('f2 v1'));
  await alice.storage.writeFile('/notes/f3.md', enc('f3 v1'));
  await alice.storage.writeFile('/notes/f4.md', enc('f4 v1'));
  await alice.client.triggerSync();
  await settle();
  expect(bob.client.currentIndex()['/notes/f4.md']).toBeDefined();

  // Bob goes offline; Alice reworks the vault.
  bob.disconnect();
  await alice.storage.writeFile('/notes/f1.md', enc('f1 v2 — edited while bob away'));
  await alice.storage.deleteFile('/notes/f2.md');
  await alice.storage.renameFile('/notes/f3.md', '/notes/f3-renamed.md');
  await alice.storage.writeFile('/notes/f5.md', enc('f5 — brand new'));
  await alice.client.triggerSync();
  await settle([alice]);
}

/** Serializable snapshot of a device's post-reconnect state. */
async function snapshotOf(rig: Rig): Promise<{
  indexJson: string;
  files: Array<[string, string]>;
  dirs: string[];
}> {
  const ignore = { obsidianSync: false };
  const files: Array<[string, string]> = [];
  for (const file of (await rig.storage.listFiles()).filter((f) => !isIgnored(f.path, ignore))) {
    files.push([file.path, text(await rig.storage.readFile(file.path))]);
  }
  files.sort(([a], [b]) => (a < b ? -1 : 1));
  return {
    // `mtime` is the per-device scan cache (never consulted for sync
    // decisions — same exemption every convergence suite grants it): whether
    // an entry carries one depends on whether a scan ran after the write,
    // which legitimately differs between the delta path (replay materializes
    // pre-cycle, then the cycle scans) and the full path (pulls land
    // post-scan). Compare everything else byte-for-byte.
    indexJson: serializeLocalIndex(stripMtime(rig.client.currentIndex())),
    files,
    dirs: [...(await rig.storage.listDirs())].sort(),
  };
}

function stripMtime(index: LocalIndex): Record<string, LocalIndexEntry> {
  const out: Record<string, LocalIndexEntry> = {};
  for (const [path, entry] of Object.entries(index)) {
    const { mtime, ...rest } = entry;
    void mtime;
    out[path] = rest;
  }
  return out;
}

describe('delta-manifest reconnect', () => {
  it('delta reconnect and full (pruned-events) reconnect produce IDENTICAL state', async () => {
    const snapshots: Record<string, Awaited<ReturnType<typeof snapshotOf>>> = {};
    const manifestKinds: Record<string, 'delta' | 'full'> = {};

    for (const mode of ['delta', 'full'] as const) {
      const rig = await makeRig();
      await runUntilBobOffline(rig);
      const { server, bob } = rig;

      if (mode === 'full') {
        // Force-prune the replay window past Bob's cursor: the oldest
        // retained event is now cursor+2, so the cursor is NOT servable
        // (a genuine gap at cursor+1) and the client must go full.
        server.pruneEventsForTests(bob.client.cursorValue + 2);
      }

      await bob.client.reconnect();
      await rig.settle();

      const sinceRequests = bob.sent.filter(
        (m) => m.type === 'getManifest' && (m as { since?: number }).since !== undefined,
      );
      if (mode === 'delta') {
        expect(sinceRequests.length).toBeGreaterThan(0); // actually went delta
        manifestKinds[mode] = 'delta';
      } else {
        expect(sinceRequests).toHaveLength(0); // fell back to full
        manifestKinds[mode] = 'full';
      }

      snapshots[mode] = await snapshotOf(bob);
      // Converged to Alice's reworked vault either way.
      expect(text(await bob.storage.readFile('/notes/f1.md'))).toBe('f1 v2 — edited while bob away');
      expect(await bob.storage.exists('/notes/f2.md')).toBe(false);
      expect(await bob.storage.exists('/notes/f3.md')).toBe(false);
      expect(await bob.storage.exists('/notes/f3-renamed.md')).toBe(true);
      expect(text(await bob.storage.readFile('/notes/f5.md'))).toBe('f5 — brand new');
      expect(bob.client.status().conflicts).toEqual([]);
      expect(bob.client.status().state).toBe('live');
    }

    // THE GATE: identical index bytes, identical files+contents, identical dirs.
    expect(snapshots.delta!.indexJson).toBe(snapshots.full!.indexJson);
    expect(snapshots.delta!.files).toEqual(snapshots.full!.files);
    expect(snapshots.delta!.dirs).toEqual(snapshots.full!.dirs);
    expect(manifestKinds).toEqual({ delta: 'delta', full: 'full' });
  });

  it('app-open restart uses the persisted cursor and requests a delta manifest', async () => {
    const rig = await makeRig();
    await runUntilBobOffline(rig);
    const { server, bob } = rig;

    // "App restart": a fresh SyncClient over the SAME storage (which holds
    // /.vaultsyncforagents/state with the persisted cursor bookkeeping).
    const restartSent: Message[] = [];
    const restarted = new SyncClient({
      deviceId: 'dev-bob',
      deviceName: 'Bob',
      token: 'tok-dev-bob',
      transport: (): Transport => {
        const pair = server.connectPair('tok-dev-bob');
        return {
          send: (message) => {
            restartSent.push(message);
            pair.client.send(message);
          },
          onMessage: (cb) => {
            pair.client.onMessage(cb);
          },
          onClose: (cb) => {
            pair.client.onClose(cb);
          },
          close: () => {
            pair.client.close();
          },
        };
      },
      blobStore: makeBlobStore(),
      storage: bob.storage,
      now: () => 9_000_000,
      schedule: new ManualScheduler().schedule,
    });
    await restarted.connect();
    await restarted.waitIdle();

    // The persisted cursor made the app-open a DELTA fetch — O(changes),
    // not O(vault). (A first-ever connect has no syncedThrough and always
    // goes full; this client restored one from the state file.)
    const sinceRequests = restartSent.filter(
      (m) => m.type === 'getManifest' && (m as { since?: number }).since !== undefined,
    );
    expect(sinceRequests.length).toBeGreaterThan(0);

    // Behaviorally: full convergence from the persisted cursor.
    expect(text(await bob.storage.readFile('/notes/f1.md'))).toBe('f1 v2 — edited while bob away');
    expect(await bob.storage.exists('/notes/f3-renamed.md')).toBe(true);
    expect(await bob.storage.exists('/notes/f2.md')).toBe(false);
    expect(restarted.status().conflicts).toEqual([]);
    expect(restarted.status().state).toBe('live');

    // And the persisted envelope now carries the bookkeeping.
    const stateBytes = await bob.storage.readFile('/.vaultsyncforagents/state');
    const parsed = JSON.parse(new TextDecoder().decode(stateBytes)) as {
      cursor?: number;
      syncedThrough?: number | null;
    };
    expect(parsed.cursor).toBeGreaterThan(0);
    expect(parsed.syncedThrough).toBeGreaterThan(0);
  });

  it('a deferred divergence forces the next manifest full, then deltas again', async () => {
    const rig = await makeRig();
    const { alice, bob, settle } = rig;
    await alice.client.connect();
    await bob.client.connect();
    await settle();

    await alice.storage.writeFile('/notes/x.md', enc('base'));
    await alice.client.triggerSync();
    await settle();
    expect(bob.client.currentIndex()['/notes/x.md']).toBeDefined();

    // Bob diverges locally WITHOUT a watcher event (index stays stale).
    await bob.storage.writeFile('/notes/x.md', enc('bob diverged'));
    // Alice edits remotely; the broadcast hits Bob's guard → defer.
    await alice.storage.writeFile('/notes/x.md', enc('alice remote edit'));
    await alice.client.triggerSync();
    await settle([alice]);
    await bob.scheduler.flush(); // dispatch the buffered change → defer
    await bob.client.waitIdle();

    // The reconcile cycle must use a FULL manifest (the plan needs to see
    // the remote head to arbitrate the divergence properly).
    await bob.client.triggerSync();
    const fullDuringDivergence = bob.sent.filter((m) => m.type === 'getManifest').map(
      (m) => (m as { since?: number }).since,
    );
    expect(fullDuringDivergence.at(-1)).toBeUndefined();

    // Divergence resolved (conflict logic ran); the next cycle deltas again.
    await settle();
    await bob.client.triggerSync();
    const afterResolution = bob.sent.filter((m) => m.type === 'getManifest').map(
      (m) => (m as { since?: number }).since,
    );
    expect(afterResolution.at(-1)).toBeDefined();
    expect(bob.client.status().state).toBe('live');
  });
});
