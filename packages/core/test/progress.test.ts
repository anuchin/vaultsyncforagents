/**
 * Bulk-phase progress reporting (`SyncClientStatus.progress`).
 *
 * A cycle reports X/Y for its scanning → pulling → pushing phases, throttled
 * by the injectable clock (phase changes and completions always emit). The
 * tests drive one cycle through both gates — a message gate (holds server
 * replies) and a storage-read gate (holds scan reads) — so every phase
 * transition is observed deterministically.
 */

import { describe, expect, it } from 'vitest';

import {
  InMemoryStorageAdapter,
  InMemorySyncServer,
  SyncClient,
  type BlobStore,
  type FileStat,
  type Message,
  type StorageAdapter,
  type SyncProgress,
  type Transport,
} from '../src/index.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

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

/** Holds server→client replies until flushed (client→server is instant). */
class ReplyGate {
  private held: Message[] = [];
  private receiver: ((message: Message) => void) | null = null;
  readonly tap = (message: Message): void => {
    this.held.push(message);
  };
  attach(receiver: (message: Message) => void): void {
    this.receiver = receiver;
  }
  get size(): number {
    return this.held.length;
  }
  flush(n = Infinity): number {
    const batch = this.held.splice(0, n);
    for (const message of batch) this.receiver?.(message);
    return batch.length;
  }
}

/** Storage wrapper that can hold `readFile` calls (the scan's per-file step). */
function gateReads(inner: StorageAdapter): StorageAdapter & {
  hold(): void;
  /** Let exactly `n` held reads proceed; the gate STAYS closed for new ones. */
  release(n?: number): void;
  /** Open the gate and let everything through. */
  releaseAll(): void;
  pending(): number;
} {
  let holding = false;
  const waiters: Array<() => void> = [];
  return {
    readFile: async (path) => {
      if (holding) await new Promise<void>((resolve) => waiters.push(resolve));
      return inner.readFile(path);
    },
    writeFile: (path, data) => inner.writeFile(path, data),
    deleteFile: (path) => inner.deleteFile(path),
    renameFile: (from, to) => inner.renameFile(from, to),
    listFiles: (): Promise<readonly FileStat[]> => inner.listFiles(),
    listDirs: () => inner.listDirs(),
    ensureDir: (path) => inner.ensureDir(path),
    exists: (path) => inner.exists(path),
    hold(): void {
      holding = true;
    },
    release(n = 1): void {
      for (let i = 0; i < n; i++) waiters.shift()?.();
    },
    releaseAll(): void {
      holding = false;
      for (const waiter of waiters.splice(0)) waiter();
    },
    pending(): number {
      return waiters.length;
    },
  };
}

const sleep0 = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Deliver exactly one held reply, WAITING for it to arrive first — the
 * server produces replies asynchronously (content hashing), so a flush
 * issued the moment a request is sent can legitimately find an empty gate.
 */
async function flushOne(gate: ReplyGate, label: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (gate.size === 0) {
    await sleep0();
    if (Date.now() > deadline) throw new Error(`no reply arrived to flush for ${label}`);
  }
  gate.flush(1);
}

/** Run `promise` to completion, flushing held replies as needed. */
async function drain(gate: ReplyGate, promise: Promise<unknown>): Promise<void> {
  let settled = false;
  void promise.catch(() => {}).finally(() => {
    settled = true;
  });
  while (!settled) {
    gate.flush();
    await sleep0();
  }
  await promise;
}

async function waitFor(condition: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    await sleep0();
    if (condition()) return;
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
  }
}

interface Rig {
  client: SyncClient;
  storage: ReturnType<typeof gateReads>;
  gate: ReplyGate;
}

describe('SyncClientStatus.progress — phase sequence through a controlled cycle', () => {
  it('reports scanning X/Y, pulling X/Y, pushing X/Y in order, then clears', async () => {
    let t = 1;
    const server = new InMemorySyncServer({ now: () => 500_000 + t++, vaultName: 'v' });
    server.register('dev-alice', 'Alice');

    // Alice seeds two files (inline content → served from the server CAS).
    const aliceStorage = new InMemoryStorageAdapter({}, { now: () => 1 });
    const alice = new SyncClient({
      deviceId: 'dev-alice',
      deviceName: 'Alice',
      token: 'tok-dev-alice',
      transport: () => server.connectPair('tok-dev-alice').client,
      blobStore: makeBlobStore(),
      storage: aliceStorage,
      now: () => 2,
      schedule: () => () => {},
    });
    await aliceStorage.writeFile('/notes/a.md', enc('alpha'));
    await aliceStorage.writeFile('/notes/b.md', enc('bravo'));
    await alice.connect();
    await alice.waitIdle();

    // Bob connects with three local files of his own: his first cycle has
    // 2 pulls AND 3 pushes. progressThrottleMs: 0 → every file emits.
    server.register('dev-bob', 'Bob');
    const bobGate = new ReplyGate();
    const bobStorage = gateReads(new InMemoryStorageAdapter({}, { now: () => 3 }));
    const sent: Message[] = [];
    const bob = new SyncClient({
      deviceId: 'dev-bob',
      deviceName: 'Bob',
      token: 'tok-dev-bob',
      transport: (): Transport => {
        const pair = server.connectPair('tok-dev-bob');
        return {
          send: (message) => {
            sent.push(message);
            pair.client.send(message);
          },
          onMessage: (cb) => {
            bobGate.attach(cb);
            pair.client.onMessage(bobGate.tap);
          },
          onClose: (cb) => pair.client.onClose(cb),
          close: () => pair.client.close(),
        };
      },
      blobStore: makeBlobStore(),
      storage: bobStorage,
      now: () => 4,
      schedule: () => () => {},
      progressThrottleMs: 0,
    });
    await bobStorage.writeFile('/notes/c1.md', enc('charlie'));
    await bobStorage.writeFile('/notes/c2.md', enc('delta'));
    await bobStorage.writeFile('/notes/c3.md', enc('echo'));

    const progressAt = (): SyncProgress | undefined => bob.status().progress;

    // Run startup to completion, flushing only what the gates require.
    let settled = false;
    const startup = bob.connect().finally(() => {
      settled = true;
    });

    // helloAck, then the manifest → the cycle starts scanning.
    await waitFor(() => bobGate.size >= 1, 'helloAck');
    bobGate.flush();
    await waitFor(() => bobGate.size >= 1, 'manifest reply');
    bobGate.flush();

    // SCANNING: hold every read, so each per-file count PERSISTS while the
    // next read waits — fully deterministic stepping (remote files are not
    // on Bob's disk yet, so the scan sees exactly his 3 local files).
    bobStorage.hold();
    await waitFor(() => bobStorage.pending() === 1, 'first scan read held');
    expect(progressAt()).toEqual({ phase: 'scanning', done: 0, total: 3 });
    for (const done of [1, 2]) {
      bobStorage.release(1);
      await waitFor(
        () => progressAt()?.phase === 'scanning' && progressAt()?.done === done,
        `scanning ${done}/3`,
      );
      expect(progressAt()).toEqual({ phase: 'scanning', done, total: 3 });
    }
    bobStorage.releaseAll(); // open the gate: the scan (and cycle) proceeds

    // PULLING: announced before the content fetches, which suspend on the
    // held reply gate — one flush materializes exactly one pull.
    await waitFor(() => progressAt()?.phase === 'pulling', 'pulling phase');
    expect(progressAt()).toEqual({ phase: 'pulling', done: 0, total: 2 });
    await flushOne(bobGate, 'first getBlob reply');
    await waitFor(() => progressAt()?.phase === 'pulling' && progressAt()?.done === 1, 'pull 1/2');
    expect(progressAt()).toEqual({ phase: 'pulling', done: 1, total: 2 });
    await flushOne(bobGate, 'second getBlob reply');

    // PUSHING: announced at pipeline start; every ack is held, so each
    // settled commit is observable one flush at a time.
    await waitFor(() => progressAt()?.phase === 'pushing', 'pushing phase');
    expect(progressAt()).toEqual({ phase: 'pushing', done: 0, total: 3 });
    expect(sent.filter((m) => m.type === 'commit')).toHaveLength(3);
    for (const done of [1, 2]) {
      await flushOne(bobGate, `push ${done}/3`);
      await waitFor(
        () => progressAt()?.phase === 'pushing' && progressAt()?.done === done,
        `pushing ${done}/3`,
      );
      expect(progressAt()).toEqual({ phase: 'pushing', done, total: 3 });
    }

    // Final ack: the cycle completes and clears the progress in the same
    // breath (nothing suspends after the last settle) — assert the clearing.
    await flushOne(bobGate, 'final ack');
    await waitFor(() => settled, 'startup complete');
    await startup;
    expect(bob.status().state).toBe('live');
    expect(progressAt()).toBeUndefined();
    expect(textOf(await bobStorage.readFile('/notes/a.md'))).toBe('alpha');
    expect(textOf(await bobStorage.readFile('/notes/c1.md'))).toBe('charlie');
  }, 20_000);

  it('throttles mid-phase updates to the injectable clock; phase changes always emit', async () => {
    let t = 1;
    let clock = 1_000_000;
    const server = new InMemorySyncServer({ now: () => 800_000 + t++, vaultName: 'v' });
    server.register('dev-solo', 'Solo');
    const gate = new ReplyGate();
    const sent: Message[] = [];
    const soloStorage = new InMemoryStorageAdapter({}, { now: () => 9 });
    const solo = new SyncClient({
      deviceId: 'dev-solo',
      deviceName: 'Solo',
      token: 'tok-dev-solo',
      transport: () => {
        const pair = server.connectPair('tok-dev-solo');
        return {
          send: (message) => {
            sent.push(message);
            pair.client.send(message);
          },
          onMessage: (cb) => {
            gate.attach(cb);
            pair.client.onMessage(gate.tap);
          },
          onClose: (cb) => pair.client.onClose(cb),
          close: () => pair.client.close(),
        };
      },
      blobStore: makeBlobStore(),
      storage: soloStorage,
      now: () => clock,
      schedule: () => () => {},
      // default progressThrottleMs (50)
    });
    await drain(gate, solo.connect());
    await solo.waitIdle();

    for (const name of ['r1', 'r2', 'r3']) {
      await soloStorage.writeFile(`/notes/${name}.md`, enc(`content ${name}`));
    }

    let settled = false;
    const cycle = solo.triggerSync().finally(() => {
      settled = true;
    });
    while (gate.size === 0) await sleep0();
    gate.flush(1); // manifest
    // Saturation: all three commits in flight, acks held.
    await waitFor(() => sent.filter((m) => m.type === 'commit').length === 3, '3 commits in flight');
    const pushingPhase = (): SyncProgress | undefined =>
      solo.status().progress?.phase === 'pushing' ? solo.status().progress : undefined;
    await waitFor(() => pushingPhase()?.done === 0, 'pushing announced');
    expect(pushingPhase()).toEqual({ phase: 'pushing', done: 0, total: 3 });

    // Ack #1 settles within the SAME clock reading → coalesced away.
    await flushOne(gate, 'ack 1');
    await waitFor(() => solo.currentIndex()['/notes/r1.md'] !== undefined, 'ack 1 applied');
    expect(pushingPhase()).toEqual({ phase: 'pushing', done: 0, total: 3 }); // throttled

    // Advance the injected clock past the throttle window → next update shows.
    clock += 100;
    await flushOne(gate, 'ack 2');
    await waitFor(() => pushingPhase()?.done === 2, 'ack 2 visible after clock advance');
    expect(pushingPhase()).toEqual({ phase: 'pushing', done: 2, total: 3 });

    // Final ack: the completion emission and the cycle's progress-clearing
    // happen in the same microtask chain (nothing suspends after the last
    // settle), so the observable end state is "settled + cleared".
    await flushOne(gate, 'final ack');
    await waitFor(() => settled, 'cycle complete');
    await cycle;
    expect(solo.status().progress).toBeUndefined();
  }, 20_000);
});

function textOf(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}
