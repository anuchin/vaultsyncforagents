/**
 * Protocol path safety (§14): NFC canonical form everywhere, and no two
 * live entries may share a fold key (NFC + case fold). The shared admission
 * gate (`pathSafetyViolation`) runs in BOTH servers; clients canonicalize at
 * the scan seam and never wedge on a refusal (skipped-path diagnostics).
 */

import { describe, expect, it } from 'vitest';

import {
  foldKeyForPath,
  InMemoryStorageAdapter,
  InMemorySyncServer,
  isNFCPath,
  normalizeVaultPath,
  pathSafetyViolation,
  scanVault,
  sha256Hex,
  SyncClient,
  type ArbitrationFileState,
  type BlobStore,
  type Message,
  type StorageAdapter,
  type Version,
} from '../src/index.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

/** NFC é vs NFD e+combining-acute — the canonical-equivalence pair. */
const NFC_E = '\u00e9';
const NFD_E = 'e\u0301';

function liveFile(path: string, counter = 1): [string, ArbitrationFileState] {
  const head: Version = {
    id: `v-${path}`,
    path,
    hash: `hash-${path}`,
    size: 1,
    deviceId: 'dev-a',
    clock: { counter, deviceId: 'dev-a' },
    parentVersion: null,
    ts: 0,
    kind: 'edit',
  };
  return [path, { currentVersion: head.id, head, deleted: false }];
}

describe('canonical form utilities', () => {
  it('normalizeVaultPath emits NFC for any input form', () => {
    expect(normalizeVaultPath(`/caf${NFD_E}.md`)).toBe(`/caf${NFC_E}.md`);
    expect(normalizeVaultPath(`/caf${NFC_E}.md`)).toBe(`/caf${NFC_E}.md`);
  });

  it('isNFCPath and foldKeyForPath agree on the two axes (form, case)', () => {
    expect(isNFCPath(`/caf${NFC_E}.md`)).toBe(true);
    expect(isNFCPath(`/caf${NFD_E}.md`)).toBe(false);
    expect(foldKeyForPath(`/caf${NFD_E}.md`)).toBe(foldKeyForPath(`/caf${NFC_E}.md`));
    expect(foldKeyForPath('/Notes/A.md')).toBe(foldKeyForPath('/notes/a.md'));
  });
});

describe('pathSafetyViolation (the admission gate)', () => {
  it('rejects non-NFC paths and fromPaths as PROTOCOL', () => {
    const files = new Map([liveFile('/a.md')]);
    expect(pathSafetyViolation(files, { path: `/caf${NFD_E}.md` })).toMatchObject({
      code: 'PROTOCOL',
    });
    expect(
      pathSafetyViolation(files, { path: '/new.md', fromPath: `/old${NFD_E}.md` }),
    ).toMatchObject({ code: 'PROTOCOL' });
  });

  it('refuses a NEW live path under an occupied fold key (case or canonical form)', () => {
    const files = new Map([liveFile('/notes/Note.md')]);
    const collision = pathSafetyViolation(files, { path: '/notes/NOTE.md' });
    expect(collision?.code).toBe('PATH_COLLIDES');
    expect(collision?.message).toContain('/notes/Note.md');
    expect(pathSafetyViolation(files, { path: `/caf${NFD_E}.md` })).toMatchObject({
      code: 'PROTOCOL',
    });

    const canon = new Map([liveFile(`/caf${NFC_E}.md`)]);
    expect(pathSafetyViolation(canon, { path: `/caf${NFD_E}.md` })).toMatchObject({
      code: 'PROTOCOL', // non-NFC form is caught first; the fold dimension is enforced for NFC inputs
    });
  });

  it('a case-only rename is exempt: the source row is skipped', () => {
    const files = new Map([liveFile('/notes/Note.md')]);
    expect(
      pathSafetyViolation(files, { path: '/notes/NOTE.md', fromPath: '/notes/Note.md' }),
    ).toBeNull();
  });

  it('edits to an existing live head flow even when a legacy twin exists', () => {
    // The exact legacy shape: both twins admitted before the gate.
    const files = new Map([liveFile('/notes/Note.md'), liveFile('/notes/NOTE.md', 2)]);
    expect(pathSafetyViolation(files, { path: '/notes/Note.md' })).toBeNull();
    expect(pathSafetyViolation(files, { path: '/notes/NOTE.md' })).toBeNull();
  });

  it('ignores tombstoned rows — a delete frees the fold key', () => {
    const [, deleted] = liveFile('/notes/Note.md');
    const files = new Map<string, ArbitrationFileState>([
      ['/notes/Note.md', { ...deleted, deleted: true }],
    ]);
    expect(pathSafetyViolation(files, { path: '/notes/NOTE.md' })).toBeNull();
  });

  it('blocks a tombstone RESTORE when a fold twin appeared meanwhile', () => {
    const [, original] = liveFile('/notes/Note.md');
    const files = new Map<string, ArbitrationFileState>([
      ['/notes/Note.md', { ...original, deleted: true }],
      liveFile('/notes/NOTE.md', 2),
    ]);
    expect(pathSafetyViolation(files, { path: '/notes/Note.md' })).toMatchObject({
      code: 'PATH_COLLIDES',
    });
  });
});

describe('scan seam — NFC canonicalization of listed names', () => {
  const SETTINGS = { obsidianSync: false };
  const NOW = 1_000_000;

  it('an NFD-listed file syncs under its NFC path (index keys are canonical)', async () => {
    const storage = new InMemoryStorageAdapter({ [`/caf${NFD_E}.md`]: 'coffee' });
    const changes = await scanVault(storage, {}, SETTINGS, NOW);
    expect(changes.added).toHaveLength(1);
    expect(changes.added[0]!.path).toBe(`/caf${NFC_E}.md`);
    expect(changes.added[0]!.hash).toBe(await sha256Hex(enc('coffee')));
  });

  it('two raw names folding to one canonical path: deterministic winner syncs, twin is a diagnostic', async () => {
    // A case- AND normalization-sensitive filesystem (ext4) really holds both
    // raw names. InMemoryStorageAdapter canonicalizes its keys (a feature),
    // so this uses a raw-bytes adapter that lists names exactly as stored.
    const rawFiles = new Map<string, Uint8Array>([
      [`/caf${NFD_E}.md`, enc('nfd content')],
      [`/caf${NFC_E}.md`, enc('nfc content')],
    ]);
    const storage: StorageAdapter = {
      readFile: async (path) => rawFiles.get(path) ?? (() => { throw new Error(`missing ${path}`); })(),
      writeFile: async (path, data) => {
        rawFiles.set(path, data);
      },
      deleteFile: async (path) => {
        rawFiles.delete(path);
      },
      renameFile: async (from, to) => {
        const bytes = rawFiles.get(from);
        if (bytes === undefined) throw new Error(`missing ${from}`);
        rawFiles.delete(from);
        rawFiles.set(to, bytes);
      },
      listFiles: async () =>
        [...rawFiles.entries()]
          .map(([path, bytes]) => ({ path, size: bytes.byteLength, mtime: 1 }))
          .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
      listDirs: async () => ['/'],
      ensureDir: async () => {},
      exists: async (path) => rawFiles.has(path),
    };
    const changes = await scanVault(storage, {}, SETTINGS, NOW);
    // Raw code-unit sort puts the NFD name first — it wins the canonical slot.
    expect(changes.added).toHaveLength(1);
    expect(changes.added[0]!.path).toBe(`/caf${NFC_E}.md`);
    expect(changes.added[0]!.hash).toBe(await sha256Hex(enc('nfd content')));
    // The losing raw twin (the NFC form) is surfaced, never merged.
    expect(changes.caseCollisions).toEqual([`/caf${NFC_E}.md`]);
  });
});

describe('client — a PATH_COLLIDES refusal never wedges the cycle', () => {
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

  it('drops the colliding push into skippedPaths; everything else still syncs', async () => {
    let t = 100_000;
    const now = (): number => ++t;
    const server = new InMemorySyncServer({ now, vaultName: 'v' });
    server.register('dev-a', 'Alpha');
    await server.seedLegacyFileForTests('/notes/Note.md', enc('legacy twin'), {
      deviceId: 'dev-a',
    });

    const scheduler = new ManualScheduler();
    const storage = new InMemoryStorageAdapter(
      { '/notes/NOTE.md': 'new twin', '/other.md': 'innocent file' },
      { now: () => ++t },
    );
    const sent: Message[] = [];
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

    await client.connect();
    await client.waitIdle();

    // The fold-colliding add was refused and diagnosed, not retried into a
    // wedge; the unrelated file landed; the legacy twin pulled intact.
    expect(client.status().skippedPaths).toContain('/notes/NOTE.md');
    expect(server.snapshot().files.map((f) => f.path)).toContain('/other.md');
    expect(server.snapshot().files.find((f) => f.path === '/notes/NOTE.md')).toBeUndefined();
    const index = client.currentIndex();
    expect(index['/notes/Note.md']).toBeDefined();
    expect(index['/other.md']).toBeDefined();

    // Repeated cycles stay stable: the refusal is idempotent, the socket lives.
    await client.triggerSync();
    await client.waitIdle();
    expect(client.status().state).toBe('live');
    expect(client.status().skippedPaths).toContain('/notes/NOTE.md');
    client.close();
  });
});
