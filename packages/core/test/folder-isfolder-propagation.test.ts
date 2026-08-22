/**
 * The isFolder-propagation regression suite (real-Obsidian e2e, v0.1.3 run).
 *
 * Folder versions carry an empty content hash by design (FR-10 placeholders:
 * hash '', size 0; the worker skips blob verification for them). The flag
 * that distinguishes "folder metadata" from "content" was DROPPED on several
 * propagation paths, so a client could receive a folder head and treat it as
 * a content pull — tripping the (correct) empty-hash guard and wedging every
 * later cycle. Only the author/loser of an operation ever saw the broken
 * paths: receivers' fast-path broadcasts already carried the flag.
 *
 * These tests pin the fixed paths end-to-end through the real in-memory
 * server and its shared arbitration:
 *
 *   - a conflict whose WINNER is a folder placeholder materializes as an
 *     ensureDir, never a content fetch (the e2e wedge: the renaming client
 *     cycled on `refusing to fetch content for an empty hash` forever);
 *   - a folder RENAME broadcast (kind 'rename', isFolder) is applied as a
 *     metadata move on the author (fromPath already gone) AND on receivers
 *     (source directory retired once vacant);
 *   - a renamed folder placeholder materializes from a FULL manifest too;
 *   - a FILE rename whose fromPath is gone still fetches content by hash.
 *
 * Folder-rename commits are driven by a raw protocol socket: today's scan
 * cannot correlate directory moves, so no SyncClient emits them yet — but
 * the wire, the arbitration, and every receiving path must already be
 * correct (a folder rename that loses its flag corrupts the authority's own
 * files row — v0.1.3's `applyMigration` did exactly that).
 */

import { describe, expect, it } from 'vitest';

import {
  InMemoryStorageAdapter,
  InMemorySyncServer,
  LOCAL_INDEX_STATE_PATH,
  bytesToBase64,
  ProtocolVersion,
  serializeLocalIndex,
  sha256Hex,
  SyncClient,
  type BlobStore,
  type CommitMessage,
  type LogAdapter,
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
}

/** Log adapter that records warn/error lines for assertions. */
class CapturingLog {
  readonly problems: string[] = [];
  readonly adapter: LogAdapter = {
    debug: () => {},
    info: () => {},
    warn: (message, ...details) => {
      this.problems.push(`warn: ${message} ${details.map(String).join(' ')}`);
    },
    error: (message, ...details) => {
      this.problems.push(`error: ${message} ${details.map(String).join(' ')}`);
    },
  };
}

interface ClientRig {
  client: SyncClient;
  storage: InMemoryStorageAdapter;
  blobStore: BlobStore & { map: Map<string, Uint8Array> };
  scheduler: ManualScheduler;
  log: CapturingLog;
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
    const log = new CapturingLog();
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
      log: log.adapter,
      now: () => ++t,
      debounceMs: 250,
      schedule: scheduler.schedule,
    });
    return { client, storage, blobStore, scheduler, log, sent };
  };
  return { server, make };
}

/**
 * A raw protocol socket on the same server — commits folder operations no
 * SyncClient emits today. `dev-z` sorts above every test device id, so a
 * clock tie always lets the raw head win (deterministic conflicts).
 */
function rawDriver(server: InMemorySyncServer, deviceId = 'dev-z') {
  server.register(deviceId, 'Zed');
  const pair = server.connectPair(`tok-${deviceId}`);
  const pending: Array<{ accepts: (message: Message) => boolean; resolve: (message: Message) => void }> = [];
  pair.client.onMessage((message) => {
    const index = pending.findIndex((waiter) => waiter.accepts(message));
    if (index < 0) return;
    const [waiter] = pending.splice(index, 1);
    waiter!.resolve(message);
  });
  pair.client.send({
    type: 'hello',
    token: `tok-${deviceId}`,
    protocolVersion: ProtocolVersion,
    cursor: 0,
  });
  return {
    /** Send one commit; resolve on its ack/conflict/error reply. */
    async commit(over: Partial<CommitMessage> & { path: string }): Promise<Message> {
      const reply = new Promise<Message>((resolve) => {
        pending.push({
          accepts: (message) =>
            message.type === 'commitAck' || message.type === 'conflict' || message.type === 'error',
          resolve,
        });
      });
      pair.client.send({
        type: 'commit',
        parentVersion: null,
        hash: '',
        size: 0,
        kind: 'edit',
        ...over,
      } as CommitMessage);
      return reply;
    },
  };
}

async function settle(...rigs: ReadonlyArray<ClientRig>): Promise<void> {
  for (let round = 0; round < 4; round++) {
    for (const r of rigs) await r.client.waitIdle();
  }
}

describe('SyncClient — folder placeholder conflict winner (the e2e wedge)', () => {
  it('a conflict lost to a folder-placeholder head recreates the folder, fetches nothing, and the cycle completes', async () => {
    const { server, make } = rig();
    const a = make('dev-a', 'Alpha');
    await a.client.connect();

    // A live placeholder /f at v1 (seq 1), known to a only.
    await a.storage.ensureDir('/f');
    await a.client.triggerSync();
    await settle(a);
    expect(server.snapshot().files.find((f) => f.path === '/f')?.isFolder).toBe(true);

    // The authority advances the placeholder to v2 without b ever learning:
    // b's persisted cursor sits past both change events, and a delta manifest
    // (head_seq <= since) omits the path — exactly the stale-index state the
    // multi-run e2e left behind.
    const raw = rawDriver(server);
    const advanced = await raw.commit({
      path: '/f',
      parentVersion: 'v1',
      hash: '',
      size: 0,
      kind: 'edit',
      isFolder: true,
    });
    expect(advanced.type).toBe('commitAck');
    await settle(a); // a applies the placeholder edit broadcast

    const b = make('dev-b', 'Beta');
    await b.storage.writeFile(
      LOCAL_INDEX_STATE_PATH,
      enc(
        serializeLocalIndex(
          {
            '/f': {
              hash: '',
              size: 0,
              versionId: 'v1',
              clock: { counter: 1, deviceId: 'dev-a' },
              isFolder: true,
            },
          },
          { cursor: 2, syncedThrough: 2, needsFullManifest: false },
        ),
      ),
    );

    // b's scan sees a live placeholder whose directory is missing locally —
    // a folder deletion — and pushes a tombstone naming the stale v1. The
    // standing head v2 wins the tie (dev-z > dev-b); the reply's winner is a
    // folder placeholder. Before the fix this threw
    // `refusing to fetch content for an empty hash` on every single cycle.
    await expect(b.client.connect()).resolves.toBeUndefined();

    expect(await b.storage.exists('/f')).toBe(true);
    const bEntry = b.client.currentIndex()['/f'];
    expect(bEntry).toMatchObject({ versionId: 'v2', hash: '', isFolder: true });
    expect(bEntry?.deletedAt).toBeUndefined();
    // Folder metadata, never content: no blob round-trip, nothing cached.
    expect(b.sent.filter((m) => m.type === 'getBlob')).toEqual([]);
    expect(b.blobStore.map.size).toBe(0);
    expect(b.log.problems.filter((line) => /empty hash/i.test(line))).toEqual([]);

    // The wedge is gone: later cycles complete and push nothing further.
    const marker = b.sent.length;
    await expect(b.client.triggerSync()).resolves.toBeUndefined();
    expect(b.sent.slice(marker).filter((m) => m.type === 'commit')).toEqual([]);
  });
});

describe('SyncClient — folder rename propagation (isFolder on the wire)', () => {
  it('author (fromPath gone) and receiver (fromPath present) both materialize the renamed folder, no content fetch', async () => {
    const { server, make } = rig();
    const a = make('dev-a', 'Alpha');
    const b = make('dev-b', 'Beta');
    await a.client.connect();
    await b.client.connect();
    await settle(a, b);

    // Shared empty folder at v1.
    await a.storage.ensureDir('/old');
    await a.client.triggerSync();
    await settle(a, b);
    expect(b.client.currentIndex()['/old']?.isFolder).toBe(true);

    // The author renames the directory away locally (no cycle in between —
    // the broadcast must arrive while the index still holds the old head).
    await a.storage.removeDir('/old');

    const raw = rawDriver(server);
    const reply = await raw.commit({
      path: '/new',
      parentVersion: 'v1',
      kind: 'rename',
      fromPath: '/old',
      hash: '',
      size: 0,
      isFolder: true,
    });
    expect(reply.type).toBe('commitAck');
    await settle(a, b);

    // The author's own wedge: fromPath is gone, yet the move is metadata.
    expect(await a.storage.exists('/new')).toBe(true);
    expect(await a.storage.exists('/old')).toBe(false);
    expect(a.client.currentIndex()['/new']).toMatchObject({ versionId: 'v2', isFolder: true });
    expect('/old' in a.client.currentIndex()).toBe(false);
    expect(a.sent.filter((m) => m.type === 'getBlob')).toEqual([]);

    // The receiver retires the vacant source directory and gains the target.
    expect(await b.storage.exists('/new')).toBe(true);
    expect(await b.storage.exists('/old')).toBe(false);
    expect(b.client.currentIndex()['/new']).toMatchObject({ versionId: 'v2', isFolder: true });
    expect('/old' in b.client.currentIndex()).toBe(false);
    expect(b.sent.filter((m) => m.type === 'getBlob')).toEqual([]);

    // Converged at rest: repeated cycles on both sides stay clean and quiet.
    const markerA = a.sent.length;
    const markerB = b.sent.length;
    await expect(a.client.triggerSync()).resolves.toBeUndefined();
    await expect(b.client.triggerSync()).resolves.toBeUndefined();
    await settle(a, b);
    expect(a.sent.slice(markerA).filter((m) => m.type === 'commit')).toEqual([]);
    expect(b.sent.slice(markerB).filter((m) => m.type === 'commit')).toEqual([]);
  });

  it('a fresh client materializes the renamed placeholder from a FULL manifest; a later tombstone lands from one too', async () => {
    const { server, make } = rig();
    const a = make('dev-a', 'Alpha');
    await a.client.connect();
    await settle(a);

    await a.storage.ensureDir('/old');
    await a.client.triggerSync();
    await settle(a);

    const raw = rawDriver(server);
    expect(
      (await raw.commit({
        path: '/new',
        parentVersion: 'v1',
        kind: 'rename',
        fromPath: '/old',
        hash: '',
        size: 0,
        isFolder: true,
      })).type,
    ).toBe('commitAck');
    await settle(a);

    // Fresh device, full manifest: the placeholder arrives with its flag and
    // materializes as a directory (never a content pull for the empty hash).
    const c = make('dev-c', 'Gamma');
    await expect(c.client.connect()).resolves.toBeUndefined();
    expect(await c.storage.exists('/new')).toBe(true);
    expect(c.client.currentIndex()['/new']).toMatchObject({ isFolder: true, versionId: 'v2' });
    expect(c.sent.filter((m) => m.type === 'getBlob')).toEqual([]);

    // And the deletion side of the lifecycle from a manifest as well.
    expect(
      (await raw.commit({
        path: '/new',
        parentVersion: 'v2',
        kind: 'delete',
        hash: '',
        size: 0,
        isFolder: true,
      })).type,
    ).toBe('commitAck');
    await settle(a, c); // connected clients converge via the broadcast
    expect(await c.storage.exists('/new')).toBe(false);
    expect(c.client.currentIndex()['/new']?.deletedAt).toBeDefined();

    // A fresh client learns the tombstone from its full manifest: never
    // known live locally, so nothing materializes and nothing is fetched.
    const d = make('dev-d', 'Delta');
    await expect(d.client.connect()).resolves.toBeUndefined();
    expect(d.client.currentIndex()['/new']).toBeUndefined();
    expect(await d.storage.exists('/new')).toBe(false);
    expect(d.sent.filter((m) => m.type === 'getBlob')).toEqual([]);
  });
});

describe('SyncClient — file renames keep fetching content (unchanged)', () => {
  it('a file rename whose fromPath is gone locally still fetches the blob by hash', async () => {
    const { server, make } = rig();
    const a = make('dev-a', 'Alpha');
    await a.client.connect();
    await settle(a);

    const content = 'file content that must survive the move';
    const bytes = enc(content);
    const hash = await sha256Hex(bytes);
    const raw = rawDriver(server);
    expect(
      (await raw.commit({
        path: '/doc.md',
        hash,
        size: bytes.byteLength,
        kind: 'edit',
        inline: bytesToBase64(bytes),
      })).type,
    ).toBe('commitAck');
    await settle(a); // a pulls the broadcast and has /doc.md at v1

    // The source file vanishes locally before the rename broadcast arrives.
    await a.storage.deleteFile('/doc.md');

    expect(
      (await raw.commit({
        path: '/moved.md',
        parentVersion: 'v1',
        kind: 'rename',
        fromPath: '/doc.md',
        hash,
        size: bytes.byteLength,
      })).type,
    ).toBe('commitAck');
    await settle(a);

    // The file-rename fallback: fetch by hash, verify, write at the target.
    expect(a.sent.filter((m) => m.type === 'getBlob').length).toBeGreaterThanOrEqual(1);
    expect(text(await a.storage.readFile('/moved.md'))).toBe(content);
    expect(a.client.currentIndex()['/moved.md']).toMatchObject({ hash, versionId: 'v2' });
    expect('/doc.md' in a.client.currentIndex()).toBe(false);
  });
});
