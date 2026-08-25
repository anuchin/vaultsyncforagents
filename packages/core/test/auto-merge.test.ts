/**
 * Client-level concurrent-edit auto-merge + the ping-pong loop quarantine.
 * Two devices over the in-memory server; divergent edits to DIFFERENT
 * regions of the same note merge instead of forking conflict copies.
 */

import { describe, expect, it } from 'vitest';

import {
  InMemoryStorageAdapter,
  InMemorySyncServer,
  sha256Hex,
  SyncClient,
  type BlobStore,
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

interface Rig {
  server: InMemorySyncServer;
  a: Device;
  b: Device;
  settle: () => Promise<void>;
}
interface Device {
  client: SyncClient;
  storage: InMemoryStorageAdapter;
  scheduler: ManualScheduler;
  sent: Message[];
}

function rig(): Rig {
  let t = 100_000;
  const now = (): number => ++t;
  const server = new InMemorySyncServer({ now, vaultName: 'v' });
  const make = (id: string): Device => {
    server.register(id, id);
    const scheduler = new ManualScheduler();
    const storage = new InMemoryStorageAdapter({}, { now: () => ++t });
    const sent: Message[] = [];
    const client = new SyncClient({
      deviceId: id,
      deviceName: id,
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
      blobStore: makeBlobStore(),
      storage,
      now,
      schedule: scheduler.schedule,
    });
    return { client, storage, scheduler, sent };
  };
  const a = make('dev-a');
  const b = make('dev-b');
  const settle = async (): Promise<void> => {
    for (let round = 0; round < 4; round++) {
      await a.client.waitIdle();
      await b.client.waitIdle();
    }
  };
  return { server, a, b, settle };
}

describe('concurrent-edit auto-merge', () => {
  it('two devices editing different regions of one note converge with NO conflict copy', async () => {
    const r = rig();
    const note = '/notes/shared.md';
    const base = 'one\ntwo\nthree\nfour\nfive\n';
    await r.a.storage.writeFile(note, enc(base));
    await r.a.client.connect();
    await r.b.client.connect();
    await r.settle();

    // B edits silently (no cycle yet), then A edits and pushes first. B's
    // fan-out handler defers over local divergence → the next plan cycle
    // sees a genuine concurrent-edit conflict → auto-merge.
    await r.b.storage.writeFile(note, enc('ONE\ntwo\nthree\nfour\nfive\n'));
    await r.a.storage.writeFile(note, enc('one\ntwo\nthree\nfour\nFIVE\n'));
    await r.a.client.triggerSync();
    await r.settle(); // B defers A's head over its own edit
    await r.b.client.triggerSync();
    await r.settle();

    const merged = 'ONE\ntwo\nthree\nfour\nFIVE\n';
    // Both sides' edits live in the head, no conflict copy exists anywhere.
    expect(text(await r.b.storage.readFile(note))).toBe(merged);
    expect(text(await r.a.storage.readFile(note))).toBe(merged);
    const serverPaths = r.server.snapshot().files.map((f) => f.path);
    expect(serverPaths).toEqual([note]);
    // The head IS the merged content.
    const head = r.server.snapshot().files[0]!;
    expect(head.hash).toBe(await sha256Hex(enc(merged)));
    expect(r.b.client.status().conflicts).toEqual([]);
  });

  it('overlapping edits still fork a conflict copy (the safety net)', async () => {
    const r = rig();
    const note = '/notes/clash.md';
    const base = 'same line\n';
    await r.a.storage.writeFile(note, enc(base));
    await r.a.client.connect();
    await r.b.client.connect();
    await r.settle();

    await r.b.storage.writeFile(note, enc('B version\n'));
    await r.a.storage.writeFile(note, enc('A version\n'));
    await r.a.client.triggerSync();
    await r.settle();
    await r.b.client.triggerSync();
    await r.settle();

    // Both touched the only line: no merge — a conflict copy preserves the
    // loser, and one of the two versions is the head.
    const paths = r.server.snapshot().files.map((f) => f.path).sort();
    expect(paths).toHaveLength(2);
    expect(paths.some((p) => /conflict/.test(p))).toBe(true);
  });
});

describe('ping-pong loop quarantine', () => {
  it('an A→B→A content flip quarantines the path; pushes are withheld until it lapses', async () => {
    const r = rig();
    const note = '/notes/gen.md';
    const bodyA = 'generated-A\n';
    const bodyB = 'generated-B\n';
    await r.a.storage.writeFile(note, enc(bodyA));
    await r.a.client.connect();
    await r.settle();

    const flip = async (body: string): Promise<void> => {
      await r.a.storage.writeFile(note, enc(body));
      await r.a.client.triggerSync();
      await r.settle();
    };

    await flip(bodyB); // A→B
    await flip(bodyA); // B→A  ⇒ pattern complete — quarantine trips
    expect(r.a.client.status().loopSuspected).toEqual([note]);

    // The next flip's push is WITHHELD: the server head stays at A-content.
    await flip(bodyB);
    expect(r.a.client.status().loopSuspected).toEqual([note]);
    const head = r.server.snapshot().files[0]!;
    expect(head.hash).toBe(await sha256Hex(enc(bodyA)));
  });
});
