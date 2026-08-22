import { describe, expect, it } from 'vitest';

import {
  applyPull,
  InMemoryStorageAdapter,
  InMemorySyncServer,
  InvalidVaultPathError,
  ProtocolVersion,
  SyncClient,
  bytesToBase64,
  scanVault,
  sha256Hex,
  type BlobStore,
  type LogAdapter,
  type Message,
  type PullFileOp,
  type SyncPlan,
} from '../src/index.js';

const SETTINGS = { obsidianSync: false };
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

/** Log adapter that records warn lines for assertions. */
class CapturingLog {
  readonly warns: string[] = [];
  readonly adapter: LogAdapter = {
    debug: () => {},
    info: () => {},
    warn: (message, ...details) => {
      this.warns.push(`${message} ${details.map(String).join(' ')}`);
    },
    error: () => {},
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

function rig(): { server: InMemorySyncServer; make: (id: string, name: string, storage?: InMemoryStorageAdapter) => ClientRig } {
  let t = 100_000;
  const server = new InMemorySyncServer({ now: () => ++t, vaultName: 'v' });
  const make = (id: string, name: string, storage?: InMemoryStorageAdapter): ClientRig => {
    server.register(id, name);
    const scheduler = new ManualScheduler();
    const vault = storage ?? new InMemoryStorageAdapter({}, { now: () => ++t });
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
      storage: vault,
      log: log.adapter,
      now: () => ++t,
      debounceMs: 250,
      schedule: scheduler.schedule,
    });
    return { client, storage: vault, blobStore, scheduler, log, sent };
  };
  return { server, make };
}

async function settle(...rigs: ReadonlyArray<ClientRig>): Promise<void> {
  for (let round = 0; round < 4; round++) {
    for (const r of rigs) await r.client.waitIdle();
  }
}

/**
 * Commit a head directly through the protocol (no client involved), the way
 * a malicious or pre-validation worker publishes a Windows-unsafe path.
 */
async function seedServerHead(server: InMemorySyncServer, path: string, content: string): Promise<void> {
  const bytes = enc(content);
  const hash = await sha256Hex(bytes);
  server.register('dev-seed', 'Seeder');
  const pair = server.connectPair('tok-dev-seed');
  const settled = new Promise<void>((resolve, reject) => {
    pair.client.onMessage((message) => {
      if (message.type === 'commitAck') resolve();
      if (message.type === 'error') reject(new Error(message.message));
    });
  });
  pair.client.send({ type: 'hello', token: 'tok-dev-seed', protocolVersion: ProtocolVersion, cursor: 0 });
  pair.client.send({
    type: 'commit',
    path,
    parentVersion: null,
    hash,
    size: bytes.byteLength,
    kind: 'edit',
    inline: bytesToBase64(bytes),
  });
  await settled;
  pair.client.close();
}

/**
 * In-memory adapter that reports one extra pre-existing file: unsafe names
 * cannot be created through the adapter itself (it normalizes), so the
 * "pre-existing local file" scenario is injected at the listing boundary.
 */
class StorageWithUnsafeFile extends InMemoryStorageAdapter {
  constructor(private readonly unsafePath: string) {
    super();
  }
  override async listFiles(): Promise<Awaited<ReturnType<InMemoryStorageAdapter['listFiles']>>> {
    return [...(await super.listFiles()), { path: this.unsafePath, size: 3, mtime: 1 }];
  }
}

// --- engine ------------------------------------------------------------------------

describe('applyPull — Windows-unsafe targets', () => {
  it('refuses to write an unsafe path (the deterministic failure the client-side skip exists to avoid)', async () => {
    const storage = new InMemoryStorageAdapter();
    const bytes = enc('cannot land');
    const hash = await sha256Hex(bytes);
    const blobs: Record<string, Uint8Array> = { [hash]: bytes };
    const pull: PullFileOp = {
      kind: 'add',
      path: '/NUL',
      hash,
      size: bytes.byteLength,
      version: 'v1',
      clock: { counter: 1, deviceId: 'dev-seed' },
      deleted: false,
    };
    const plan: SyncPlan = { pushes: [], pulls: [pull], conflicts: [], folderPushes: [] };
    await expect(
      applyPull(
        storage,
        {},
        plan,
        async (h) => {
          const blob = blobs[h];
          if (blob === undefined) throw new Error(`no blob for ${h}`);
          return blob;
        },
        { now: 1_000 },
      ),
    ).rejects.toThrow(InvalidVaultPathError);
  });
});

// --- client: unsafe remote heads ----------------------------------------------------

describe('SyncClient — Windows-unsafe remote paths are skipped, not retried forever', () => {
  it('a manifest entry with an unsafe path is skipped with a diagnostic and every cycle completes', async () => {
    const { server, make } = rig();
    await seedServerHead(server, '/NUL', 'cannot land');
    await seedServerHead(server, '/notes/ok.md', 'fine');
    const a = make('dev-a', 'Alpha');
    await a.client.connect();

    // The cycle completed: state is live, the safe head landed, the unsafe
    // one did not — no fetch, no index entry, no write.
    expect(a.client.status().state).toBe('live');
    expect(a.client.status().skippedPaths).toEqual(['/NUL']);
    expect(text(await a.storage.readFile('/notes/ok.md'))).toBe('fine');
    expect((await a.storage.listFiles()).map((f) => f.path)).not.toContain('/NUL');
    expect(a.client.currentIndex()['/NUL']).toBeUndefined();
    expect(a.sent.filter((m) => m.type === 'getBlob')).toHaveLength(1); // only /notes/ok.md

    // Subsequent cycles still complete and never re-attempt the write. (The
    // skip list is replaced every cycle like `conflicts`/`caseCollisions`;
    // delta cycles no longer encounter the head, so visibility recurs with
    // the next full manifest — every startup.)
    await a.client.triggerSync();
    await a.client.triggerSync();
    expect(a.client.status().state).toBe('live');
    expect(a.sent.filter((m) => m.type === 'getBlob')).toHaveLength(1);
    expect((await a.storage.listFiles()).map((f) => f.path)).not.toContain('/NUL');
    expect(a.log.warns.some((line) => line.includes('/NUL'))).toBe(true);
  });

  it('a live change broadcast for an unsafe path is skipped and diagnosed without failing the handler', async () => {
    const { server, make } = rig();
    const a = make('dev-a', 'Alpha');
    await a.client.connect();
    await seedServerHead(server, '/notes/CON.md', 'nope');
    await settle(a);

    expect(a.client.status().state).toBe('live');
    expect(a.client.status().skippedPaths).toContain('/notes/CON.md');
    expect((await a.storage.listFiles()).map((f) => f.path)).not.toContain('/notes/CON.md');
    expect(a.client.currentIndex()['/notes/CON.md']).toBeUndefined();

    // The client keeps syncing: cycles complete over the poisoned head.
    await a.client.triggerSync();
    expect(a.client.status().state).toBe('live');
    expect((await a.storage.listFiles()).map((f) => f.path)).not.toContain('/notes/CON.md');
  });

  it('a deeper unsafe segment is skipped too (only the Windows-unsafe subset is affected)', async () => {
    const { server, make } = rig();
    await seedServerHead(server, '/notes/lpt7/report.', 'trailing dot');
    await seedServerHead(server, '/notes/ordinary.md', 'ordinary');
    const a = make('dev-a', 'Alpha');
    await a.client.connect();

    expect(a.client.status().state).toBe('live');
    expect(a.client.status().skippedPaths).toEqual(['/notes/lpt7/report.']);
    expect(text(await a.storage.readFile('/notes/ordinary.md'))).toBe('ordinary');
    expect((await a.storage.listFiles()).map((f) => f.path)).not.toContain('/notes/lpt7/report.');
  });
});

// --- client: unsafe local names ------------------------------------------------------

describe('SyncClient — pre-existing local files with unsafe names', () => {
  it('surfaces a warning diagnostic, never pushes the file, and completes every cycle', async () => {
    const { make } = rig();
    const b = make('dev-b', 'Beta', new StorageWithUnsafeFile('/CON'));
    await b.storage.writeFile('/notes/real.md', enc('real'));
    await b.client.connect();

    expect(b.client.status().state).toBe('live');
    expect(b.client.status().skippedPaths).toEqual(['/CON']);
    expect(b.sent.filter((m) => m.type === 'commit' && m.path === '/CON')).toEqual([]);
    const commits = b.sent.filter((m) => m.type === 'commit') as Array<{ path: string }>;
    expect(commits.map((c) => c.path)).toEqual(['/notes/real.md']);
    expect(b.log.warns.some((line) => line.includes('/CON'))).toBe(true);

    // Later cycles do not churn on the file.
    await b.client.triggerSync();
    expect(b.client.status().state).toBe('live');
    expect(b.sent.filter((m) => m.type === 'commit' && m.path === '/CON')).toEqual([]);
  });
});

// --- scan -----------------------------------------------------------------------------

describe('scanVault — Windows-unsafe names never enter the diff', () => {
  it('reports unsafe files as diagnostics: not hashed, not added, no deletion for their index entries', async () => {
    const storage = new StorageWithUnsafeFile('/CON');
    await storage.writeFile('/notes/ok.md', enc('ok'));
    const clock = { counter: 1, deviceId: 'dev' };
    const changes = await scanVault(
      storage,
      { '/CON': { hash: 'ab'.repeat(32), size: 3, versionId: 'v0', clock } },
      SETTINGS,
      1_000,
    );

    expect(changes.unsafePaths).toEqual(['/CON']);
    expect(changes.added.map((c) => c.path)).toEqual(['/notes/ok.md']);
    expect(changes.hashed.map((h) => h.path)).toEqual(['/notes/ok.md']); // /CON never read
    expect(changes.deleted).toEqual([]); // legacy index entry is not a deletion
  });

  it('reports unsafe directories as diagnostics and never plans a placeholder push for them', async () => {
    // Unsafe directory names cannot be created through the adapter (it
    // normalizes); inject one at the listing boundary.
    const stub = new (class extends InMemoryStorageAdapter {
      override async listDirs(): Promise<readonly string[]> {
        return [...(await super.listDirs()), '/aux'];
      }
    })();
    await stub.writeFile('/notes/ok.md', enc('ok'));
    const changes = await scanVault(stub, {}, SETTINGS, 1_000);

    expect(changes.unsafePaths).toEqual(['/aux']);
    expect(changes.emptyFolders).toEqual([]);
  });
});
