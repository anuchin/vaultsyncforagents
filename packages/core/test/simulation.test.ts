/**
 * Multi-client simulation (ARCHITECTURE.md §12 CI: "core gets in-memory
 * adapter tests + two-client simulation" — this is three clients).
 *
 * Three devices — desktop, mobile, daemon — against the in-memory
 * authoritative server, all driven deterministically:
 *   - injected monotonic clocks (client, server, storage mtimes);
 *   - synchronous message delivery (MessageBus default);
 *   - a manual scheduler for the ~300 ms watcher debounce (no real timers).
 *
 * These tests are the contract the real Cloudflare Worker must satisfy: the
 * Durable Object will import the same `server/arbitrate.ts` the in-memory
 * server wraps, so convergence here is convergence there.
 */

import { describe, expect, it } from 'vitest';

import {
  InMemoryStorageAdapter,
  InMemorySyncServer,
  isIgnored,
  SyncClient,
  type BlobStore,
  type FileChangeEvent,
  type Message,
  type StorageAdapter,
  type Transport,
} from '../src/index.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const text = (b: Uint8Array): string => new TextDecoder().decode(b);

// --- deterministic harness ------------------------------------------------------

/** Capturable debounce scheduler: nothing runs until the test flushes. */
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
  get pending(): number {
    return this.queue.filter((entry) => !entry.cancelled).length;
  }
}

/** Watch adapter double the test fires by hand. */
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
  name: string;
  client: SyncClient;
  storage: InMemoryStorageAdapter;
  blobStore: BlobStore & { map: Map<string, Uint8Array> };
  scheduler: ManualScheduler;
  watch: ManualWatch;
  sent: Message[];
  /** Live client-side transports (most recent last) for disconnect drills. */
  transports: Transport[];
  disconnect(): void;
}

/** Storage wrapper that records calls (rename assertions). */
function spyStorage(inner: StorageAdapter): StorageAdapter & { renamed: Array<[string, string]> } {
  const renamed: Array<[string, string]> = [];
  return {
    renamed,
    readFile: (p) => inner.readFile(p),
    writeFile: (p, d) => inner.writeFile(p, d),
    deleteFile: (p) => inner.deleteFile(p),
    renameFile: (from, to) => {
      renamed.push([from, to]);
      return inner.renameFile(from, to);
    },
    listFiles: () => inner.listFiles(),
    listDirs: () => inner.listDirs(),
    ensureDir: (p) => inner.ensureDir(p),
    exists: (p) => inner.exists(p),
  };
}

async function makeRig(): Promise<{
  server: InMemorySyncServer;
  desktop: Device;
  mobile: Device;
  daemon: Device;
  settle: (...devices: Device[]) => Promise<void>;
}> {
  let t = 1_000_000;
  const now = (): number => ++t;
  const server = new InMemorySyncServer({ now, vaultName: 'personal' });

  const makeDevice = (id: string, name: string): Device => {
    server.register(id, name, id === 'dev-daemon' ? 'daemon' : id === 'dev-mobile' ? 'mobile' : 'desktop');
    const scheduler = new ManualScheduler();
    const storage = new InMemoryStorageAdapter({}, { now });
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
      debounceMs: 300,
      schedule: scheduler.schedule,
    });
    const watch = new ManualWatch();
    return {
      id,
      name,
      client,
      storage,
      blobStore,
      scheduler,
      watch,
      sent,
      transports,
      disconnect: () => transports[transports.length - 1]?.close(),
    };
  };

  const desktop = makeDevice('dev-desktop', 'Desktop');
  const mobile = makeDevice('dev-mobile', 'Mobile');
  const daemon = makeDevice('dev-daemon', 'Daemon');

  const settle = async (...devices: ReadonlyArray<Device>): Promise<void> => {
    const all = devices.length > 0 ? devices : [desktop, mobile, daemon];
    for (let round = 0; round < 4; round++) {
      for (const device of all) await device.client.waitIdle();
    }
  };

  return { server, desktop, mobile, daemon, settle };
}

/** Simulate a user edit on a connected device: write + watcher event + debounce. */
async function edit(device: Device, path: string, content: string | Uint8Array): Promise<void> {
  await device.storage.writeFile(path, typeof content === 'string' ? enc(content) : content);
  device.watch.emit([{ kind: 'modify', path }]);
  device.scheduler.flush();
}

async function connectAll(...devices: ReadonlyArray<Device>): Promise<void> {
  for (const device of devices) {
    await device.client.connect();
    device.client.startWatching(device.watch);
  }
}

const conflictCopies = (files: ReadonlyArray<{ path: string }>): string[] =>
  files.map((f) => f.path).filter((p) => / \(conflict /.test(p));

// --- the scenarios ----------------------------------------------------------------

describe('simulation — scenario (a): edit converges to every device within a tick', () => {
  it('A edits a note → B and C materialize identical content and index state', async () => {
    const { desktop, mobile, daemon, settle } = await makeRig();
    await connectAll(desktop, mobile, daemon);

    await edit(desktop, '/notes/shared.md', 'first version');
    await settle();

    for (const device of [desktop, mobile, daemon]) {
      expect(text(await device.storage.readFile('/notes/shared.md'))).toBe('first version');
      expect(device.client.currentIndex()['/notes/shared.md']).toBeDefined();
    }
    // One head on the server, and every client's index agrees with it.
    // (`entry.mtime` is a per-device scan cache — the editor recorded its
    // local stat, pullers have not scanned since their write — so agreement
    // is asserted on the sync fields: hash, size, versionId, clock.)
    const entry = desktop.client.currentIndex()['/notes/shared.md'];
    const agreesWithHead = (other: typeof entry): void => {
      expect(other).toMatchObject({
        hash: entry?.hash,
        size: entry?.size,
        versionId: entry?.versionId,
        clock: entry?.clock,
      });
    };
    agreesWithHead(mobile.client.currentIndex()['/notes/shared.md']);
    agreesWithHead(daemon.client.currentIndex()['/notes/shared.md']);
    expect(conflictCopies(await desktop.storage.listFiles())).toEqual([]);
    for (const device of [desktop, mobile, daemon]) {
      expect(device.client.status().state).toBe('live');
      expect(device.client.status().conflicts).toEqual([]);
    }
  });

  it('edits from different devices interleave cleanly (no phantom pushes)', async () => {
    const { desktop, mobile, daemon, settle } = await makeRig();
    await connectAll(desktop, mobile, daemon);

    await edit(desktop, '/notes/shared.md', 'base');
    await settle();
    await edit(mobile, '/notes/shared.md', 'mobile follow-up');
    await settle();
    await edit(daemon, '/notes/daemon.md', 'daemon note');
    await settle();

    for (const device of [desktop, mobile, daemon]) {
      expect(text(await device.storage.readFile('/notes/shared.md'))).toBe('mobile follow-up');
      expect(text(await device.storage.readFile('/notes/daemon.md'))).toBe('daemon note');
      expect(device.client.status().conflicts).toEqual([]);
      expect(conflictCopies(await device.storage.listFiles())).toEqual([]);
    }
  });
});

describe('simulation — scenario (b): offline edits race → exactly one conflict copy everywhere', () => {
  it('desktop and mobile edit offline; on reconnect one copy lands on all devices, winner identical', async () => {
    const { server, desktop, mobile, daemon, settle } = await makeRig();
    await connectAll(desktop, mobile, daemon);

    await edit(desktop, '/notes/note.md', 'base');
    await settle();

    // Both editors go offline (the daemon stays connected throughout).
    desktop.disconnect();
    mobile.disconnect();
    await settle();

    // Offline edits — storage only, no watcher, no network.
    await desktop.storage.writeFile('/notes/note.md', enc('desktop edit'));
    await mobile.storage.writeFile('/notes/note.md', enc('mobile edit'));

    // Desktop reconnects first: no divergence yet → fast-path commit.
    await desktop.client.reconnect();
    await settle();
    expect(text(await desktop.storage.readFile('/notes/note.md'))).toBe('desktop edit');
    expect(text(await daemon.storage.readFile('/notes/note.md'))).toBe('desktop edit');

    // Mobile reconnects: predicted conflict, stale-parent push, server arbitration.
    await mobile.client.reconnect();
    await settle(desktop, mobile, daemon);

    // 'dev-mobile' > 'dev-desktop' wins the counter-2 tie → mobile's edit is
    // the winner everywhere; desktop's edit survives as THE one conflict copy.
    const winner = 'mobile edit';
    const loser = 'desktop edit';
    for (const device of [desktop, mobile, daemon]) {
      const files = await device.storage.listFiles();
      expect(text(await device.storage.readFile('/notes/note.md'))).toBe(winner);
      const copies = conflictCopies(files);
      expect(copies).toHaveLength(1);
      expect(copies[0]).toMatch(/\/notes\/note \(conflict [^)]+ - from Desktop\)\.md$/);
      expect(text(await device.storage.readFile(copies[0]!))).toBe(loser);
    }

    // The winner head is identical in every index (sync fields; mtime is a
    // per-device scan cache), and the server agrees.
    const head = desktop.client.currentIndex()['/notes/note.md'];
    const agreesWithHead = (other: typeof head): void => {
      expect(other).toMatchObject({
        hash: head?.hash,
        size: head?.size,
        versionId: head?.versionId,
        clock: head?.clock,
      });
    };
    agreesWithHead(mobile.client.currentIndex()['/notes/note.md']);
    agreesWithHead(daemon.client.currentIndex()['/notes/note.md']);
    const serverFile = server.snapshot().files.find((f) => f.path === '/notes/note.md');
    expect(serverFile?.clock).toEqual(head?.clock);

    // Both racers observed the conflict; the daemon (uninvolved) did not.
    expect(desktop.client.status().conflicts.length + mobile.client.status().conflicts.length).toBeGreaterThan(0);
    expect(daemon.client.status().conflicts).toEqual([]);
  });

  it('the mirror ordering (mobile reconnects first) converges to the same shape', async () => {
    const { desktop, mobile, daemon, settle } = await makeRig();
    await connectAll(desktop, mobile, daemon);
    await edit(desktop, '/notes/note.md', 'base');
    await settle();
    desktop.disconnect();
    mobile.disconnect();
    await desktop.storage.writeFile('/notes/note.md', enc('desktop edit'));
    await mobile.storage.writeFile('/notes/note.md', enc('mobile edit'));

    await mobile.client.reconnect(); // mobile fast-paths this time
    await settle();
    await desktop.client.reconnect(); // desktop is now the stale one — client-side copy
    await settle(desktop, mobile, daemon);

    for (const device of [desktop, mobile, daemon]) {
      expect(text(await device.storage.readFile('/notes/note.md'))).toBe('mobile edit');
      const copies = conflictCopies(await device.storage.listFiles());
      expect(copies).toHaveLength(1);
      expect(copies[0]).toMatch(/- from Desktop\)\.md$/);
      expect(text(await device.storage.readFile(copies[0]!))).toBe('desktop edit');
    }
  });
});

describe('simulation — scenario (c): delete propagates as a tombstone', () => {
  it('delete on A removes the file on B and tombstones both indexes; .trash is out of scope', async () => {
    const { server, desktop, mobile, settle } = await makeRig();
    await connectAll(desktop, mobile);

    await edit(desktop, '/notes/doomed.md', 'soon gone');
    await settle();

    // User deletes the file on desktop.
    await desktop.storage.deleteFile('/notes/doomed.md');
    desktop.watch.emit([{ kind: 'delete', path: '/notes/doomed.md' }]);
    desktop.scheduler.flush();
    await settle();

    expect(await mobile.storage.exists('/notes/doomed.md')).toBe(false);
    const mobileEntry = mobile.client.currentIndex()['/notes/doomed.md'];
    expect(mobileEntry).toBeDefined();
    expect(mobileEntry?.deletedAt).toBeDefined();
    expect(desktop.client.currentIndex()['/notes/doomed.md']?.deletedAt).toBeDefined();
    expect(server.snapshot().files.find((f) => f.path === '/notes/doomed.md')?.deleted).toBe(true);
    // No conflict copies for deletions.
    expect(conflictCopies(await mobile.storage.listFiles())).toEqual([]);
  });
});

describe('simulation — scenario (d): rename travels as a rename', () => {
  it('rename on A → storage.renameFile on B, content preserved, index migrated', async () => {
    const rig = await makeRig();
    await connectAll(rig.desktop, rig.mobile);
    // Re-seat mobile's live client on a spying storage adapter so the test
    // can assert the rename used renameFile (not delete+write).
    const mobileSpy = spyStorage(rig.mobile.storage);
    rig.mobile.client.close();
    const client = new SyncClient({
      deviceId: 'dev-mobile',
      deviceName: 'Mobile',
      token: 'tok-dev-mobile',
      transport: () => rig.server.connectPair('tok-dev-mobile').client,
      blobStore: rig.mobile.blobStore,
      storage: mobileSpy,
      now: () => 1,
      schedule: rig.mobile.scheduler.schedule,
    });
    await client.connect();
    const settle = async (): Promise<void> => {
      for (let i = 0; i < 4; i++) {
        await rig.desktop.client.waitIdle();
        await client.waitIdle();
      }
    };

    await edit(rig.desktop, '/notes/old.md', 'content that moves');
    await settle();

    // Rename on desktop (a delete+add pair in one scan → correlated by hash).
    await rig.desktop.storage.renameFile('/notes/old.md', '/notes/new.md');
    rig.desktop.watch.emit([
      { kind: 'delete', path: '/notes/old.md' },
      { kind: 'add', path: '/notes/new.md' },
    ]);
    rig.desktop.scheduler.flush();
    await settle();

    expect(mobileSpy.renamed).toContainEqual(['/notes/old.md', '/notes/new.md']);
    expect(text(await mobileSpy.readFile('/notes/new.md'))).toBe('content that moves');
    expect(await mobileSpy.exists('/notes/old.md')).toBe(false);
    const index = client.currentIndex();
    expect(index['/notes/old.md']).toBeUndefined(); // migrated, not tombstoned
    expect(index['/notes/new.md']).toBeDefined();
    expect(rig.server.snapshot().files.map((f) => f.path)).toEqual(['/notes/new.md']);
  });
});

describe('simulation — scenario (e): fresh device pairs late → byte-for-byte vault', () => {
  it('full initial sync reproduces files, contents, and folders exactly', async () => {
    const { server, desktop, mobile, settle } = await makeRig();
    await connectAll(desktop, mobile);

    // Rich vault: nested notes, a binary attachment, an empty folder, a
    // file that gets deleted (tombstone), and a folder with only one file.
    await edit(desktop, '/notes/a.md', 'note a');
    await settle();
    await edit(desktop, '/notes/sub/deep/b.md', 'deep note');
    await settle();
    await edit(desktop, '/attachments/logo.bin', new Uint8Array([0, 1, 2, 250, 254, 255]));
    await settle();
    await desktop.storage.ensureDir('/projects/empty');
    desktop.watch.emit([]);
    await desktop.client.triggerSync(); // push the empty-folder placeholder
    await settle();
    await edit(desktop, '/notes/gone.md', 'short lived');
    await settle();
    await desktop.storage.deleteFile('/notes/gone.md');
    desktop.watch.emit([{ kind: 'delete', path: '/notes/gone.md' }]);
    desktop.scheduler.flush();
    await settle();

    // A brand-new device pairs NOW.
    let t = 5_000_000;
    const lateStorage = new InMemoryStorageAdapter({}, { now: () => t++ });
    const lateBlobs = makeBlobStore();
    const late = new SyncClient({
      deviceId: 'dev-late',
      deviceName: 'Late',
      token: server.register('dev-late', 'Late', 'cli'),
      transport: () => server.connectPair('tok-dev-late').client,
      blobStore: lateBlobs,
      storage: lateStorage,
      now: () => t++,
      schedule: new ManualScheduler().schedule,
    });
    await late.connect();
    await late.waitIdle();
    await settle();

    // Byte-for-byte: same files, same contents, same directories (each
    // device's own sync-state file is vault-ignored and excluded).
    const ignore = { obsidianSync: false };
    const expectedFiles = (await desktop.storage.listFiles()).filter((f) => !isIgnored(f.path, ignore));
    const actualFiles = (await lateStorage.listFiles()).filter((f) => !isIgnored(f.path, ignore));
    expect(actualFiles.map((f) => f.path)).toEqual(expectedFiles.map((f) => f.path));
    for (const file of expectedFiles) {
      expect(await lateStorage.readFile(file.path)).toEqual(await desktop.storage.readFile(file.path));
    }
    expect(await lateStorage.listDirs()).toEqual(await desktop.storage.listDirs());
    expect(await lateStorage.exists('/projects/empty')).toBe(true); // FR-10 placeholder materialized
    // The tombstoned file does not resurrect on the fresh device (a tombstone
    // for a never-known path is deliberately not recorded — resolve.ts §C).
    expect(await lateStorage.exists('/notes/gone.md')).toBe(false);
    expect(late.currentIndex()['/notes/gone.md']).toBeUndefined();
    expect(late.status().state).toBe('live');
  });
});

describe('simulation — scenario (f): large attachments ride the blob store', () => {
  it('a >256KB attachment commits by hash (putBlob first, no inline) and arrives intact', async () => {
    const { server, desktop, mobile, settle } = await makeRig();
    await connectAll(desktop, mobile);

    const big = new Uint8Array(300 * 1024);
    for (let i = 0; i < big.length; i++) big[i] = (i * 31 + 7) & 0xff;
    await edit(desktop, '/attachments/big.bin', big);
    await settle();

    // The commit referenced the hash; the bytes went via the blob channel.
    const commits = desktop.sent.filter(
      (m) => m.type === 'commit' && m.path === '/attachments/big.bin',
    );
    expect(commits).toHaveLength(1);
    expect((commits[0] as { inline?: string }).inline).toBeUndefined();
    expect(desktop.sent.some((m) => m.type === 'putBlob')).toBe(true);

    // Content converged byte-for-byte through the blob path.
    expect(await mobile.storage.readFile('/attachments/big.bin')).toEqual(big);

    // Both blob caches and the server CAS store hold the hash.
    const hash = desktop.client.currentIndex()['/attachments/big.bin']?.hash;
    expect(hash).toBeDefined();
    expect(desktop.blobStore.map.has(hash!)).toBe(true); // uploaded
    expect(mobile.blobStore.map.has(hash!)).toBe(true); // downloaded + cached
    expect(server.blobs.get(hash!)).toEqual(big);
  });
});

describe('simulation — reconnection and status', () => {
  it('disconnect flips status to disconnected; reconnect re-runs reconciliation', async () => {
    const { desktop, mobile, settle } = await makeRig();
    await connectAll(desktop, mobile);

    await edit(desktop, '/notes/x.md', 'v1');
    await settle();
    expect(desktop.client.status().lastSyncAt).not.toBeNull();

    desktop.disconnect();
    expect(desktop.client.status().state).toBe('disconnected');

    // Mobile edits while desktop is away.
    await edit(mobile, '/notes/x.md', 'v2 while away');
    await settle(mobile);
    expect(desktop.client.status().state).toBe('disconnected');

    await desktop.client.reconnect();
    await settle();
    expect(desktop.client.status().state).toBe('live');
    expect(text(await desktop.storage.readFile('/notes/x.md'))).toBe('v2 while away');
  });

  it('watcher debounce batches bursts into one cycle; pending is visible in status', async () => {
    const { desktop, mobile, settle } = await makeRig();
    await connectAll(desktop, mobile);

    // A burst of edits: only the last content matters, one commit per path.
    await desktop.storage.writeFile('/notes/burst.md', enc('one'));
    desktop.watch.emit([{ kind: 'modify', path: '/notes/burst.md' }]);
    expect(desktop.client.status().pending).toBe(1);
    expect(desktop.scheduler.pending).toBe(1);
    await desktop.storage.writeFile('/notes/burst.md', enc('two'));
    desktop.watch.emit([{ kind: 'modify', path: '/notes/burst.md' }]);
    await desktop.storage.writeFile('/notes/other.md', enc('other'));
    desktop.watch.emit([{ kind: 'add', path: '/notes/other.md' }]);
    expect(desktop.client.status().pending).toBe(3);
    // Debounce reset: still exactly one scheduled cycle.
    expect(desktop.scheduler.pending).toBe(1);

    desktop.scheduler.flush();
    await settle();

    expect(text(await mobile.storage.readFile('/notes/burst.md'))).toBe('two');
    expect(text(await mobile.storage.readFile('/notes/other.md'))).toBeDefined();
    expect(desktop.client.status().pending).toBe(0);
    const commits = desktop.sent.filter((m) => m.type === 'commit');
    expect(commits.filter((m) => m.path === '/notes/burst.md')).toHaveLength(1);
  });
});

// --- F-1 regression: the empty-folder tombstone ping-pong --------------------------------

/**
 * Storage double WITHOUT the optional `removeDir` hook — exactly the shape
 * the real Obsidian plugin adapter had when the E2E finding was recorded
 * (record-only tombstone application leaves the empty dir on disk).
 */
function withoutRemoveDir(inner: StorageAdapter): StorageAdapter {
  return {
    readFile: (p) => inner.readFile(p),
    writeFile: (p, d) => inner.writeFile(p, d),
    deleteFile: (p) => inner.deleteFile(p),
    renameFile: (from, to) => inner.renameFile(from, to),
    listFiles: () => inner.listFiles(),
    listDirs: () => inner.listDirs(),
    ensureDir: (p) => inner.ensureDir(p),
    exists: (p) => inner.exists(p),
  };
}

const FOLDER = '/tempfolder';

/** Create an empty folder on a device (dirs produce no watcher events — a scan discovers them). */
async function createEmptyFolder(device: Device): Promise<void> {
  await device.storage.ensureDir(FOLDER);
  await device.client.triggerSync();
}

/** Delete an empty folder on a device through the watcher path. */
async function deleteEmptyFolder(device: Device): Promise<void> {
  await device.storage.removeDir(FOLDER);
  device.watch.emit([{ kind: 'delete', path: FOLDER }]);
  device.scheduler.flush();
}

/** Commits `client` sent for the ping-ponged folder after `marker`. */
function commitsFor(sent: ReadonlyArray<Message>, marker: number): Message[] {
  return sent
    .slice(marker)
    .filter((m) => m.type === 'commit' && (m as { path?: string }).path === FOLDER);
}

/**
 * Re-seat a device on a fresh client whose sends keep flowing into the
 * device's recorded `sent` log (same pattern as the rig's transport factory).
 */
function recordingTransport(
  server: InMemorySyncServer,
  sent: Message[],
): () => Transport {
  return () => {
    const pair = server.connectPair('tok-dev-mobile');
    return {
      send: (message) => {
        sent.push(message);
        pair.client.send(message);
      },
      onMessage: (cb) => pair.client.onMessage(cb),
      onClose: (cb) => pair.client.onClose(cb),
      close: () => pair.client.close(),
    };
  };
}

describe('simulation — scenario (g): empty-folder deletion never ping-pongs (F-1)', () => {
  it('A deletes an empty folder → B applies AND removes its dir → B pushes NOTHING → A stays deleted', async () => {
    const { server, desktop: a, mobile: b, settle } = await makeRig();
    await connectAll(a, b);

    // Placeholder created on A propagates to B as a directory.
    await createEmptyFolder(a);
    await settle();
    expect(await b.storage.exists(FOLDER)).toBe(true);
    expect(b.client.currentIndex()[FOLDER]?.isFolder).toBe(true);

    const marker = b.sent.length; // everything B sends from here on is suspect

    // A deletes the empty folder (the E2E used fileManager.trashFile).
    await deleteEmptyFolder(a);
    await settle();

    // The tombstone reached B and REMOVED B's local empty dir (adapter removeDir).
    expect(await a.storage.exists(FOLDER)).toBe(false);
    expect(await b.storage.exists(FOLDER)).toBe(false);
    expect(b.client.currentIndex()[FOLDER]?.deletedAt).toBeDefined();
    expect(a.client.currentIndex()[FOLDER]?.deletedAt).toBeDefined();

    // Several more full cycles on both sides: B's scans must push NOTHING…
    await b.client.triggerSync();
    await a.client.triggerSync();
    await settle();
    expect(commitsFor(b.sent, marker)).toEqual([]);

    // …and history shows no edit-after-delete: the head is still A's delete.
    const head = server.snapshot().files.find((f) => f.path === FOLDER);
    expect(head?.deleted).toBe(true);
    expect(head?.clock.deviceId).toBe('dev-desktop'); // authored by the DELETING side
  });

  it('the exact E2E shape: B lacks removeDir → record-only apply, dir lingers, STILL no re-push and A never re-pulls', async () => {
    const rig = await makeRig();
    const { server, desktop: a, settle } = rig;
    const b = rig.mobile;
    await connectAll(a, b);
    await createEmptyFolder(a);
    await settle();
    expect(await b.storage.exists(FOLDER)).toBe(true);

    // Re-seat B on a removeDir-less storage adapter (persisted state carries over).
    b.client.close();
    let t = 8_000_000;
    const stripped = new SyncClient({
      deviceId: 'dev-mobile',
      deviceName: 'Mobile',
      token: 'tok-dev-mobile',
      transport: recordingTransport(server, b.sent),
      blobStore: b.blobStore,
      storage: withoutRemoveDir(b.storage),
      now: () => ++t,
      schedule: b.scheduler.schedule,
    });
    await stripped.connect();
    stripped.startWatching(b.watch);
    const settleBoth = async (): Promise<void> => {
      for (let round = 0; round < 4; round++) {
        await a.client.waitIdle();
        await stripped.waitIdle();
      }
    };
    await settleBoth();

    const marker = b.sent.length;
    await deleteEmptyFolder(a); // A deletes; B is connected via the stripped client
    await settleBoth();

    // Record-only application: B's index is tombstoned but its dir lingers.
    expect(stripped.currentIndex()[FOLDER]?.deletedAt).toBeDefined();
    expect(await b.storage.exists(FOLDER)).toBe(true);

    // Repeated scan cycles on B (the old build re-pushed the placeholder HERE):
    // the stale-leftover rule keeps the entry tombstoned and pushes nothing.
    await stripped.triggerSync();
    await stripped.triggerSync();
    await settleBoth();
    expect(commitsFor(b.sent, marker)).toEqual([]);

    // The head is untouched (still A's delete), and A NEVER re-pulls its own
    // deletion back — the deleting side stays deleted across extra cycles.
    const head = server.snapshot().files.find((f) => f.path === FOLDER);
    expect(head?.deleted).toBe(true);
    expect(head?.clock.deviceId).toBe('dev-desktop');
    await a.client.triggerSync();
    await settleBoth();
    expect(await a.storage.exists(FOLDER)).toBe(false);
  });

  it('stale-leftover cleanup: a later cycle retries removeDir on the lingering empty dir (still pushing nothing)', async () => {
    const rig = await makeRig();
    const { server, desktop: a } = rig;
    const b = rig.mobile;
    await connectAll(a, b);
    await createEmptyFolder(a);
    for (let round = 0; round < 4; round++) {
      await a.client.waitIdle();
      await b.client.waitIdle();
    }

    // B goes record-only (no removeDir), receives the tombstone, dir lingers.
    b.client.close();
    let t = 8_500_000;
    const stripped = new SyncClient({
      deviceId: 'dev-mobile',
      deviceName: 'Mobile',
      token: 'tok-dev-mobile',
      transport: recordingTransport(server, b.sent),
      blobStore: b.blobStore,
      storage: withoutRemoveDir(b.storage),
      now: () => ++t,
      schedule: b.scheduler.schedule,
    });
    await stripped.connect();
    stripped.startWatching(b.watch);
    const deleteMarker = b.sent.length;
    await deleteEmptyFolder(a);
    for (let round = 0; round < 4; round++) {
      await a.client.waitIdle();
      await stripped.waitIdle();
    }
    expect(stripped.currentIndex()[FOLDER]?.deletedAt).toBeDefined();
    expect(await b.storage.exists(FOLDER)).toBe(true);
    expect(commitsFor(b.sent, deleteMarker)).toEqual([]);

    // Re-seat B with the FULL adapter (removeDir available): the next cycle
    // classifies the leftover as stale and retries the removal — converging
    // storage onto the tombstone without ever re-pushing the placeholder.
    stripped.close();
    const healed = new SyncClient({
      deviceId: 'dev-mobile',
      deviceName: 'Mobile',
      token: 'tok-dev-mobile',
      transport: recordingTransport(server, b.sent),
      blobStore: b.blobStore,
      storage: b.storage,
      now: () => ++t,
      schedule: b.scheduler.schedule,
    });
    await healed.connect();
    await healed.triggerSync();
    for (let round = 0; round < 4; round++) {
      await a.client.waitIdle();
      await healed.waitIdle();
    }

    expect(await b.storage.exists(FOLDER)).toBe(false); // retried removal landed
    expect(commitsFor(b.sent, deleteMarker)).toEqual([]); // …and still no re-push
    const head = server.snapshot().files.find((f) => f.path === FOLDER);
    expect(head?.deleted).toBe(true);
  });
});
