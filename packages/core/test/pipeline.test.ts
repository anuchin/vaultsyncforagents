/**
 * Pipelined pushes (large-vault performance hardening).
 *
 * The push phase of a cycle keeps up to `pushConcurrency` commits in flight
 * instead of awaiting each ack before the next send. These tests prove the
 * behavior deterministically over a GATED wire: client→server sends are
 * instant, but server→client replies are held until the test flushes them —
 * so "commits sent while zero replies delivered" is exactly the number of
 * commits in flight.
 *
 * The scale test pushes a synthetic 1,000-file vault and asserts completion
 * within a bounded number of scheduled waves: each wave can deliver at most
 * `pushConcurrency` acks (bounded concurrency) and one wave per batch is
 * enough (pipelining) — ≈ files/N + constant waves, not files.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  InMemoryStorageAdapter,
  InMemorySyncServer,
  SyncClient,
  type BlobStore,
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

/** Holds server→client deliveries until flushed; counts flush waves ("ticks"). */
class Gate {
  private held: Message[] = [];
  private receiver: ((message: Message) => void) | null = null;

  /** Registered as the transport's onMessage tap: hold instead of deliver. */
  readonly tap = (message: Message): void => {
    this.held.push(message);
  };

  attach(receiver: (message: Message) => void): void {
    this.receiver = receiver;
  }

  get heldCount(): number {
    return this.held.length;
  }

  /** Deliver the oldest n held messages; returns how many were delivered. */
  flush(n = Infinity): number {
    const batch = this.held.splice(0, n);
    for (const message of batch) this.receiver?.(message);
    return batch.length;
  }

  get size(): number {
    return this.held.length;
  }
}

interface DeviceRig {
  client: SyncClient;
  storage: InMemoryStorageAdapter;
  blobStore: BlobStore & { map: Map<string, Uint8Array> };
  sent: Message[];
  gate: Gate;
}

/** One gated device on `server`; other devices use instant delivery. */
function makeGatedDevice(
  server: InMemorySyncServer,
  id: string,
  name: string,
  options: { pushConcurrency?: number; progressThrottleMs?: number } = {},
): DeviceRig {
  server.register(id, name);
  const storage = new InMemoryStorageAdapter({}, { now: () => 1_000 });
  const blobStore = makeBlobStore();
  const sent: Message[] = [];
  const gate = new Gate();
  let t = 1;
  const client = new SyncClient({
    deviceId: id,
    deviceName: name,
    token: `tok-${id}`,
    transport: () => {
      const pair = server.connectPair(`tok-${id}`);
      return {
        send: (message) => {
          sent.push(message);
          pair.client.send(message); // instant to the server
        },
        onMessage: (cb) => {
          gate.attach(cb);
          pair.client.onMessage(gate.tap); // replies held until flushed
        },
        onClose: (cb) => pair.client.onClose(cb),
        close: () => pair.client.close(),
      };
    },
    blobStore,
    storage,
    now: () => 1_000 + t++,
    debounceMs: 250,
    schedule: () => () => {}, // watcher never fires in these tests
    ...(options.pushConcurrency !== undefined ? { pushConcurrency: options.pushConcurrency } : {}),
    ...(options.progressThrottleMs !== undefined
      ? { progressThrottleMs: options.progressThrottleMs }
      : {}),
  });
  return { client, storage, blobStore, sent, gate };
}

/** Run `promise` to completion, flushing held replies wave by wave. */
async function drain(rig: DeviceRig, promise: Promise<unknown>): Promise<void> {
  let settled = false;
  const done = promise.then(
    () => {},
    () => {},
  );
  void done.then(() => {
    settled = true;
  });
  for (;;) {
    rig.gate.flush();
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (settled) return;
  }
}

/**
 * Poll until `condition` holds WITHOUT ever flushing — used once the
 * pipeline is self-saturating (replies accumulate in the gate on their own),
 * so the observed mid-flight state can never be disturbed by a delivery.
 */
async function waitFor(condition: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (condition()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
  }
}

const sleep0 = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

type CommitMessage = Extract<Message, { type: 'commit' }>;
const commitsSent = (sent: ReadonlyArray<Message>): CommitMessage[] =>
  sent.filter((m): m is CommitMessage => m.type === 'commit');

describe('push pipeline — bounded concurrency', () => {
  it('keeps exactly N commits in flight; each delivered ack frees a slot', async () => {
    let t = 1;
    const server = new InMemorySyncServer({ now: () => t++, vaultName: 'v' });
    const a = makeGatedDevice(server, 'dev-a', 'Alpha', { pushConcurrency: 4 });

    // Connect (drain hello/manifest), then stage 10 local files.
    await drain(a, a.client.connect());
    expect(a.client.status().state).toBe('live');
    for (let i = 0; i < 10; i++) {
      await a.storage.writeFile(`/notes/f${String(i).padStart(2, '0')}.md`, enc(`content ${i}`));
    }

    let settled = false;
    const cycle = a.client.triggerSync().finally(() => {
      settled = true;
    });
    // Wave 1 is the manifest reply — the only delivery the cycle needs;
    // from here the pipeline saturates on its own and every ack piles up
    // in the gate untouched.
    while (a.gate.size === 0) await sleep0();
    a.gate.flush(1);
    await waitFor(
      () => commitsSent(a.sent).length === 4 && a.gate.size === 4,
      '4 commits in flight',
    );
    expect(settled).toBe(false);

    // Delivering ONE ack frees exactly ONE slot → exactly one new send.
    expect(a.gate.flush(1)).toBe(1);
    await waitFor(() => commitsSent(a.sent).length === 5, '5th commit send');

    // Drain the rest; all 10 land, none lost, cycle completes live.
    await drain(a, cycle);
    expect(commitsSent(a.sent)).toHaveLength(10);
    expect(settled).toBe(true);
    expect(a.client.status().state).toBe('live');
    expect(a.client.status().conflicts).toEqual([]);
    for (let i = 0; i < 10; i++) {
      const entry = a.client.currentIndex()[`/notes/f${String(i).padStart(2, '0')}.md`];
      expect(entry?.versionId).toMatch(/^v\d+$/);
    }
  });

  it('a >256KB upload overlaps with in-flight commits and precedes only its own commit', async () => {
    let t = 1;
    const server = new InMemorySyncServer({ now: () => t++, vaultName: 'v' });
    const a = makeGatedDevice(server, 'dev-a', 'Alpha');

    await drain(a, a.client.connect());
    const big = new Uint8Array(300 * 1024).fill(7);
    await a.storage.writeFile('/attachments/a-big.bin', big); // sorts first
    await a.storage.writeFile('/notes/b.md', enc('one'));
    await a.storage.writeFile('/notes/c.md', enc('two'));
    await a.storage.writeFile('/notes/d.md', enc('three'));

    const cycle = a.client.triggerSync();
    // Wave 1: the manifest. After it, the pipeline self-saturates: putBlob
    // plus the three small inline commits go out, all four replies held.
    while (a.gate.size === 0) await sleep0();
    a.gate.flush(1);
    await waitFor(() => a.gate.size === 4, 'blobAck + 3 commitAcks held');

    // The putBlob went out ALONGSIDE the small inline commits (overlap), and
    // the big file's own commit is withheld until its blobAck arrives.
    expect(a.sent.some((m) => m.type === 'putBlob')).toBe(true);
    const smallPaths = ['/notes/b.md', '/notes/c.md', '/notes/d.md'];
    for (const path of smallPaths) {
      expect(commitsSent(a.sent).some((m) => m.type === 'commit' && m.path === path)).toBe(true);
    }
    expect(commitsSent(a.sent).some((m) => m.path === '/attachments/a-big.bin')).toBe(false);

    // Slot 1 (big file, sorts first) sent its putBlob before any commit —
    // and flushing exactly ONE held reply (the FIFO blobAck) unblocks the
    // big file's own commit, proving reply→request pairing stayed aligned.
    const putBlobAt = a.sent.findIndex((m) => m.type === 'putBlob');
    expect(putBlobAt).toBeGreaterThan(0); // during this cycle, after hello
    expect(putBlobAt).toBeLessThan(a.sent.findIndex((m) => m.type === 'commit'));
    a.gate.flush(1); // the blobAck — the only delivery the big commit awaits
    await waitFor(
      () => commitsSent(a.sent).some((m) => m.path === '/attachments/a-big.bin'),
      'big commit send after blobAck',
    );

    await drain(a, cycle);
    const bigCommit = commitsSent(a.sent).find(
      (m) => m.type === 'commit' && m.path === '/attachments/a-big.bin',
    ) as Extract<Message, { type: 'commit' }>;
    expect(bigCommit.inline).toBeUndefined(); // rode the blob channel
    expect(server.blobs.get(bigCommit.hash)).toEqual(big);
    expect(a.client.status().state).toBe('live');
  });
});

describe('push pipeline — 1,000-file vault converges in ≈files/N waves', () => {
  it('pushes 1000 files within O(files/N) waves at concurrency 8, byte-identical on a fresh device', async () => {
    let t = 1;
    const server = new InMemorySyncServer({ now: () => t++, vaultName: 'big' });
    const desktop = makeGatedDevice(server, 'dev-desktop', 'Desktop');
    server.register('dev-mobile', 'Mobile');

    await drain(desktop, desktop.client.connect());

    // Synthetic vault: 1,000 unique small notes.
    for (let i = 0; i < 1000; i++) {
      await desktop.storage.writeFile(`/vault/note-${String(i).padStart(4, '0')}.md`, enc(`note ${i}`));
    }

    // Push through the gated wire, counting scheduled waves. Each wave may
    // deliver at most 8 acks (concurrency bound ⇒ ≥ ⌈1000/8⌉ = 125 waves),
    // and one wave per in-flight batch suffices (pipelining ⇒ far fewer
    // than the ~1000 waves a sequential commit-per-ack loop would need).
    let waves = 0;
    let settled = false;
    const cycle = desktop.client.triggerSync().finally(() => {
      settled = true;
    });
    while (!settled && waves < 5000) {
      waves += 1;
      desktop.gate.flush();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await cycle;

    expect(desktop.client.status().state).toBe('live');
    expect(desktop.client.status().conflicts).toEqual([]);
    // Two-sided proof: bounded AND pipelined. Lower bound — a wave can
    // deliver at most 8 acks, so ⌈1000/8⌉ = 125 waves are unavoidable
    // (concurrency is truly bounded). Upper bound — measured ≈ 2×files/N
    // + constant in this harness (subtle-digest completions straddle the
    // wave boundary), still O(files/N): a sequential commit-per-ack loop
    // would need ≥ 1000 waves (one ack per wave).
    expect(waves).toBeGreaterThanOrEqual(125);
    expect(waves).toBeLessThanOrEqual(350);

    // A brand-new device pulls the whole vault; everything converges
    // byte-for-byte with zero conflicts.
    const mobileStorage = new InMemoryStorageAdapter({}, { now: () => 2_000 });
    const mobile = new SyncClient({
      deviceId: 'dev-mobile',
      deviceName: 'Mobile',
      token: 'tok-dev-mobile',
      transport: () => server.connectPair('tok-dev-mobile').client,
      blobStore: makeBlobStore(),
      storage: mobileStorage,
      now: () => 2_000,
      schedule: () => () => {},
    });
    await mobile.connect();
    await mobile.waitIdle();

    const expected = (await desktop.storage.listFiles()).filter((f) => f.path.startsWith('/vault/'));
    const actual = (await mobileStorage.listFiles()).filter((f) => f.path.startsWith('/vault/'));
    expect(actual.map((f) => f.path)).toEqual(expected.map((f) => f.path));
    for (const file of expected) {
      expect(text(await mobileStorage.readFile(file.path))).toBe(
        text(await desktop.storage.readFile(file.path)),
      );
    }
    expect(mobile.status().conflicts).toEqual([]);
    const head = desktop.client.currentIndex()['/vault/note-0000.md'];
    expect(mobile.currentIndex()['/vault/note-0000.md']).toMatchObject({
      hash: head?.hash,
      versionId: head?.versionId,
      clock: head?.clock,
    });
  }, 60_000);
});
