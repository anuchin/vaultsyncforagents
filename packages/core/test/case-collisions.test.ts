/**
 * Case-colliding path pairs (ARCHITECTURE §14) — the two real-world bugs a
 * case-insensitive filesystem (Windows/macOS) can hit when a case-sensitive
 * peer (the Linux daemon) or a rename+edit decomposition puts two paths that
 * differ only by name case into play:
 *
 *  (a) rename+edit decomposes to `pull add` + `pull delete` of a
 *      case-colliding pair — applied add-first, the delete removes the
 *      just-written physical file (vault-wide data loss at head);
 *  (b) a genuine case-colliding PAIR server-side is visible as one directory
 *      entry here — the scan used to push a tombstone for the invisible
 *      twin, silently deleting it everywhere;
 *  (c) plain case-only renames must keep working (regression guard for the
 *      collision suppression in `scan.ts`);
 *  (d) case-sensitive adapters must be unaffected by the pull reordering.
 *
 * The case-insensitive client runs on `CaseInsensitiveStorage` — the same
 * semantics as `InMemoryStorageAdapter`, but keys resolve case-insensitively
 * and one physical entry serves both names (the Windows/macOS directory
 * entry behavior).
 */

import { describe, expect, it } from 'vitest';

import {
  applyPull,
  computeSyncPlan,
  InMemoryStorageAdapter,
  InMemorySyncServer,
  normalizeVaultPath,
  scanVault,
  sha256Hex,
  SyncClient,
  type BlobStore,
  type FileChangeEvent,
  type FileStat,
  type LocalIndex,
  type LocalIndexEntry,
  type Message,
  type StorageAdapter,
  type Transport,
} from '../src/index.js';

const SETTINGS = { obsidianSync: false };
const NOW = 1_000_000;
const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const text = (b: Uint8Array): string => new TextDecoder().decode(b);

// --- a case-insensitive storage adapter (the Windows/macOS simulation) --------

/**
 * `InMemoryStorageAdapter` semantics, keyed case-insensitively: at most ONE
 * physical entry per lowercased path, carrying the case of the LAST write
 * (exactly how a Windows/macOS directory behaves when `Note.md` is written
 * over `NOTE.md` or vice versa).
 */
class CaseInsensitiveStorage implements StorageAdapter {
  private readonly files = new Map<string, { path: string; data: Uint8Array; mtime: number }>();
  private readonly dirs = new Set<string>(['/']);
  private readonly now: () => number;

  constructor(now: () => number = () => NOW) {
    this.now = now;
  }

  async readFile(path: string): Promise<Uint8Array> {
    const entry = this.files.get(this.key(path));
    if (!entry) throw new Error(`File not found: ${normalizeVaultPath(path)}`);
    return entry.data.slice();
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    const key = this.key(path);
    this.recordDir(this.parent(key));
    this.files.set(key, { path: normalizeVaultPath(path), data: data.slice(), mtime: this.now() });
  }

  async deleteFile(path: string): Promise<void> {
    this.files.delete(this.key(path));
  }

  async renameFile(from: string, to: string): Promise<void> {
    const entry = this.files.get(this.key(from));
    if (!entry) throw new Error(`File not found: ${normalizeVaultPath(from)}`);
    this.files.delete(this.key(from));
    this.recordDir(this.parent(this.key(to)));
    this.files.set(this.key(to), { ...entry, path: normalizeVaultPath(to) });
  }

  async listFiles(): Promise<readonly FileStat[]> {
    return [...this.files.entries()]
      .map(([key, entry]) => ({
        path: entry.path,
        size: entry.data.byteLength,
        mtime: entry.mtime,
      }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  async listDirs(): Promise<readonly string[]> {
    return [...this.dirs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  async ensureDir(path: string): Promise<void> {
    this.recordDir(normalizeVaultPath(path).toLowerCase());
  }

  async removeDir(path: string): Promise<void> {
    const key = normalizeVaultPath(path).toLowerCase();
    if (this.files.has(key)) throw new Error(`Path is a file, not a directory: ${path}`);
    if (!this.dirs.has(key)) return;
    for (const file of this.files.keys()) {
      if (file !== '/' && file.startsWith(`${key}/`)) throw new Error(`Directory not empty: ${path}`);
    }
    this.dirs.delete(key);
  }

  async exists(path: string): Promise<boolean> {
    const key = this.key(path);
    return this.files.has(key) || this.dirs.has(key);
  }

  private key(path: string): string {
    return normalizeVaultPath(path).toLowerCase();
  }

  private parent(path: string): string {
    const cut = path.lastIndexOf('/');
    return cut <= 0 ? '/' : path.slice(0, cut);
  }

  private recordDir(dir: string): void {
    this.dirs.add('/');
    let current = '';
    for (const segment of dir.slice(1).split('/')) {
      current += `/${segment}`;
      this.dirs.add(current);
    }
  }
}

// --- deterministic client rig (two devices, one case-insensitive) --------------

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

class ManualWatch {
  private cb?: (events: readonly FileChangeEvent[]) => void;
  start(cb: (events: readonly FileChangeEvent[]) => void): void {
    this.cb = cb;
  }
  stop(): void {
    this.cb = undefined;
  }
  emit(events: readonly FileChangeEvent[]): void {
    this.cb?.(events);
  }
}

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

interface Device {
  id: string;
  client: SyncClient;
  storage: StorageAdapter;
  blobStore: BlobStore & { map: Map<string, Uint8Array> };
  scheduler: ManualScheduler;
  watch: ManualWatch;
  sent: Message[];
  transports: Transport[];
  disconnect(): void;
}

function makeDevice(
  server: InMemorySyncServer,
  id: string,
  name: string,
  storage: StorageAdapter,
  now: () => number,
): Device {
  server.register(id, name, id === 'dev-daemon' ? 'daemon' : 'desktop');
  const scheduler = new ManualScheduler();
  const blobStore = makeBlobStore();
  const sent: Message[] = [];
  const transports: Transport[] = [];
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
        onMessage: (cb) => pair.client.onMessage(cb),
        onClose: (cb) => pair.client.onClose(cb),
        close: () => pair.client.close(),
      };
      transports.push(recording);
      return recording;
    },
    blobStore,
    storage,
    now,
    schedule: scheduler.schedule,
  });
  const watch = new ManualWatch();
  return {
    id,
    client,
    storage,
    blobStore,
    scheduler,
    watch,
    sent,
    transports,
    disconnect: () => transports[transports.length - 1]?.close(),
  };
}

/** Desktop = case-sensitive (Linux-ish), mobile = case-insensitive (Windows/macOS). */
async function makeRig(): Promise<{
  server: InMemorySyncServer;
  desktop: Device;
  mobile: Device;
  settle: () => Promise<void>;
}> {
  let t = 1_000_000;
  const now = (): number => ++t;
  const server = new InMemorySyncServer({ now, vaultName: 'personal' });
  const desktop = makeDevice(server, 'dev-desktop', 'Desktop', new InMemoryStorageAdapter({}, { now }), now);
  const mobile = makeDevice(server, 'dev-mobile', 'Mobile', new CaseInsensitiveStorage(now), now);
  const settle = async (): Promise<void> => {
    for (let round = 0; round < 4; round++) {
      await desktop.client.waitIdle();
      await mobile.client.waitIdle();
    }
  };
  await desktop.client.connect();
  desktop.client.startWatching(desktop.watch);
  await mobile.client.connect();
  mobile.client.startWatching(mobile.watch);
  return { server, desktop, mobile, settle };
}

/** User edit on a connected device: write + watcher event + debounce flush. */
async function edit(device: Device, path: string, content: string | Uint8Array): Promise<void> {
  await device.storage.writeFile(path, typeof content === 'string' ? enc(content) : content);
  device.watch.emit([{ kind: 'modify', path }]);
  device.scheduler.flush();
}

// --- (a) rename+edit decomposes to delete+add — pull order must not lose data ---

describe('case collisions — (a) rename+edit pulled onto a case-insensitive client', () => {
  it('full-manifest cycle applies the case-pair delete BEFORE the add: no data loss, no deletion push', async () => {
    const { server, desktop, mobile, settle } = await makeRig();

    // Baseline: /notes/Note.md synced to both.
    await edit(desktop, '/notes/Note.md', 'v1 base content');
    await settle();
    expect(text(await mobile.storage.readFile('/notes/Note.md'))).toBe('v1 base content');

    // Mobile goes offline; desktop renames AND edits (correlation breaks:
    // delete+add of a case-colliding pair).
    mobile.disconnect();
    await desktop.storage.renameFile('/notes/Note.md', '/notes/NOTE.md');
    await edit(desktop, '/notes/NOTE.md', 'v2 renamed and edited');
    await settle();
    expect(server.snapshot().files.find((f) => f.path === '/notes/NOTE.md')?.deleted).toBe(false);
    expect(server.snapshot().files.find((f) => f.path === '/notes/Note.md')?.deleted).toBe(true);

    // Force mobile's reconnect through a FULL manifest (replay window
    // pruned) so the case-pair arrives as one plan: pull add NOTE.md +
    // pull delete Note.md — the exact ordering-critical shape.
    server.pruneEventsForTests(mobile.client.cursorValue + 2);
    await mobile.client.reconnect();
    await settle();

    // THE bug: applied add-first, the delete of /notes/Note.md found the
    // just-written physical file and removed it — disk ended EMPTY. Now the
    // delete applies first and the new head lands intact.
    const files = (await mobile.storage.listFiles()).map((f) => f.path);
    expect(files).toContain('/notes/NOTE.md');
    expect(files.filter((p) => p.toLowerCase() === '/notes/note.md')).toHaveLength(1);
    expect(text(await mobile.storage.readFile('/notes/NOTE.md'))).toBe('v2 renamed and edited');

    // No phantom deletion pushed back: extra cycles on mobile commit nothing
    // for either case of the path, and the server heads stay as they are.
    const marker = mobile.sent.length;
    await mobile.client.triggerSync();
    await mobile.client.triggerSync();
    await settle();
    const laterCommits = mobile.sent
      .slice(marker)
      .filter((m) => m.type === 'commit') as Array<{ path?: string; kind?: string }>;
    expect(laterCommits.filter((c) => (c.path ?? '').toLowerCase() === '/notes/note.md')).toEqual([]);
    expect(server.snapshot().files.find((f) => f.path === '/notes/NOTE.md')?.deleted).toBe(false);
    expect(mobile.client.status().caseCollisions).toBeUndefined(); // not a collision — a rename
  });
});

// --- (b) a true case-colliding pair: never a tombstone, diagnostic instead -----

describe('case collisions — (b) invisible twin is never deleted, diagnostic surfaced', () => {
  it('Linux-created Note.md + NOTE.md: Windows client pushes no tombstone, reports caseCollisions', async () => {
    const { server, desktop, mobile, settle } = await makeRig();

    // The case-sensitive desktop creates BOTH files (the "Linux daemon"
    // origin of a colliding pair). The live add of the second case is
    // DEFERRED by mobile's divergence guard (the case-insensitive `exists`
    // sees the twin), so a plan cycle — not the live path — materializes it.
    await edit(desktop, '/notes/Note.md', 'lowercase note');
    await settle();
    await edit(desktop, '/notes/NOTE.md', 'uppercase note');
    await settle();

    // Cycle 1 pulls the second head: mobile's index now holds both live
    // entries while its filesystem shows exactly one directory entry.
    const marker = mobile.sent.length;
    await mobile.client.triggerSync();
    await settle();
    const index = mobile.client.currentIndex();
    expect(index['/notes/Note.md']).toBeDefined();
    expect(index['/notes/NOTE.md']).toBeDefined();
    expect(
      (await mobile.storage.listFiles())
        .map((f) => f.path)
        .filter((p) => p !== '/.vaultsyncforagents/state'),
    ).toEqual(['/notes/NOTE.md']);
    expect(mobile.sent.slice(marker).filter((m) => m.type === 'commit')).toEqual([]);

    // THE bug: mobile's next scan saw /notes/Note.md "gone" and pushed a
    // tombstone that deleted it server-side and on the desktop. Now the
    // deletion is suppressed and surfaced as a diagnostic instead.
    await mobile.client.triggerSync();
    await settle();
    expect(mobile.client.status().caseCollisions).toEqual(['/notes/Note.md']);
    expect(mobile.sent.slice(marker).filter((m) => m.type === 'commit')).toEqual([]);

    // The twin survived everywhere: server head not tombstoned, desktop's
    // file still on disk — and repeated cycles keep pushing nothing.
    await mobile.client.triggerSync();
    await settle();
    expect(server.snapshot().files.find((f) => f.path === '/notes/Note.md')?.deleted).toBe(false);
    expect(text(await desktop.storage.readFile('/notes/Note.md'))).toBe('lowercase note');
    expect(mobile.sent.slice(marker).filter((m) => m.type === 'commit')).toEqual([]);
  });
});

// --- (c) plain case-only renames keep working (regression) ---------------------

describe('case collisions — (c) plain case-only rename still syncs as a rename', () => {
  it('case-only rename on the case-insensitive client travels as PushRenameOp and converges', async () => {
    const { server, desktop, mobile, settle } = await makeRig();

    await edit(desktop, '/notes/Note.md', 'stable content');
    await settle();

    // The user renames Note.md → NOTE.md on the case-insensitive client
    // (same content — correlation must pair them into one rename).
    await mobile.storage.renameFile('/notes/Note.md', '/notes/NOTE.md');
    mobile.watch.emit([
      { kind: 'delete', path: '/notes/Note.md' },
      { kind: 'add', path: '/notes/NOTE.md' },
    ]);
    mobile.scheduler.flush();
    await settle();

    // One rename commit (not delete+add), the server holds exactly the new
    // case, and the case-sensitive desktop converged to it.
    const renames = mobile.sent.filter(
      (m) => m.type === 'commit' && (m as { kind?: string }).kind === 'rename',
    );
    expect(renames).toHaveLength(1);
    expect(server.snapshot().files.map((f) => f.path)).toEqual(['/notes/NOTE.md']);
    expect(text(await desktop.storage.readFile('/notes/NOTE.md'))).toBe('stable content');
    expect(await desktop.storage.exists('/notes/Note.md')).toBe(false);
    expect(mobile.client.status().caseCollisions).toBeUndefined();
  });
});

// --- (d) case-sensitive adapters are unaffected by the ordering change ---------

describe('case collisions — (d) case-sensitive adapter unaffected', () => {
  it('delete+add of a case pair still lands both operations correctly, delete ordered first', async () => {
    const storage = new InMemoryStorageAdapter({ '/Note.md': 'old content' });
    const index: LocalIndex = {
      '/Note.md': {
        hash: await sha256Hex(enc('old content')),
        size: enc('old content').byteLength,
        versionId: 'v1',
        clock: { counter: 1, deviceId: 'dev-desktop' },
      },
    };
    const manifest = [
      {
        path: '/NOTE.md',
        version: 'v2',
        hash: await sha256Hex(enc('new content')),
        size: enc('new content').byteLength,
        clock: { counter: 2, deviceId: 'dev-desktop' },
        deleted: false,
        mtime: 0,
      },
      {
        path: '/Note.md',
        version: 'v3',
        hash: await sha256Hex(enc('old content')),
        size: enc('old content').byteLength,
        clock: { counter: 3, deviceId: 'dev-desktop' },
        deleted: true,
        mtime: 0,
      },
    ];

    const plan = computeSyncPlan({
      localChanges: {
        scannedAt: NOW,
        added: [],
        modified: [],
        deleted: [],
        renamed: [],
        emptyFolders: [],
        folderDeletions: [],
        hashed: [],
      },
      index,
      manifest,
      thisDeviceId: 'dev-mobile',
      thisDeviceName: 'Mobile',
      now: NOW,
    });

    // The case-colliding pair is reordered delete-first (ASCII alone would
    // put the add '/NOTE.md' before the delete '/Note.md').
    expect(plan.pulls.map((p) => (p.kind === 'rename' ? p.toPath : p.path))).toEqual([
      '/Note.md',
      '/NOTE.md',
    ]);
    expect(plan.pulls[0]).toMatchObject({ kind: 'delete', path: '/Note.md' });

    // On a case-sensitive adapter both paths are distinct files — the final
    // state is exactly the intended one.
    const next = await applyPull(storage, index, plan, async (hash) => {
      if (hash === plan.pulls[1]?.hash) return enc('new content');
      return enc('old content');
    }, { now: NOW });
    expect(await storage.exists('/Note.md')).toBe(false);
    expect(text(await storage.readFile('/NOTE.md'))).toBe('new content');
    expect(next['/NOTE.md']).toBeDefined();
    expect(next['/Note.md']?.deletedAt).toBeDefined();
  });
});

// --- scan-level unit tests for the collision suppression ------------------------

/** Index entry helpers matching the scan test bench style. */
async function entry(content: string, versionId: string): Promise<LocalIndexEntry> {
  return {
    hash: await sha256Hex(enc(content)),
    size: enc(content).byteLength,
    versionId,
    clock: { counter: 1, deviceId: 'dev-desktop' },
  };
}

describe('scanVault — case-collision suppression (unit)', () => {
  it('a live index entry with an unchanged on-disk case twin is a diagnostic, never a delete', async () => {
    const storage = new CaseInsensitiveStorage();
    await storage.writeFile('/NOTE.md', enc('uppercase note'));
    const index: LocalIndex = {
      '/Note.md': await entry('lowercase note', 'v-lower'),
      '/NOTE.md': await entry('uppercase note', 'v-upper'),
    };

    const changes = await scanVault(storage, index, SETTINGS, NOW);
    expect(changes.deleted).toEqual([]);
    expect(changes.added).toEqual([]);
    expect(changes.renamed).toEqual([]);
    expect(changes.caseCollisions).toEqual(['/Note.md']);
  });

  it('a rename+edit (twin changed in the same scan) is NOT suppressed: delete+add is correct', async () => {
    const storage = new CaseInsensitiveStorage();
    await storage.writeFile('/NOTE.md', enc('edited content'));
    const index: LocalIndex = { '/Note.md': await entry('old content', 'v1') };

    const changes = await scanVault(storage, index, SETTINGS, NOW);
    expect(changes.caseCollisions).toBeUndefined();
    expect(changes.added.map((c) => c.path)).toEqual(['/NOTE.md']);
    expect(changes.deleted.map((d) => d.path)).toEqual(['/Note.md']);
  });

  it('a plain case-only rename still correlates into a rename candidate (no suppression)', async () => {
    const storage = new CaseInsensitiveStorage();
    await storage.writeFile('/NOTE.md', enc('stable content'));
    const index: LocalIndex = { '/Note.md': await entry('stable content', 'v1') };

    const changes = await scanVault(storage, index, SETTINGS, NOW);
    expect(changes.caseCollisions).toBeUndefined();
    expect(changes.deleted).toEqual([]);
    expect(changes.renamed).toEqual([
      { from: '/Note.md', to: '/NOTE.md', hash: await sha256Hex(enc('stable content')), size: enc('stable content').byteLength },
    ]);
  });

  it('an ordinary deletion with no case twin still deletes', async () => {
    const storage = new CaseInsensitiveStorage();
    await storage.writeFile('/other.md', enc('unrelated'));
    const index: LocalIndex = {
      '/gone.md': await entry('gone content', 'v1'),
      '/other.md': await entry('unrelated', 'v2'),
    };

    const changes = await scanVault(storage, index, SETTINGS, NOW);
    expect(changes.caseCollisions).toBeUndefined();
    expect(changes.deleted.map((d) => d.path)).toEqual(['/gone.md']);
  });
});
