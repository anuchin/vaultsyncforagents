/**
 * Vault-level snapshots against the in-memory authoritative server: create
 * captures every head; restore reverts the whole vault as NEW versions
 * (kind 'restore' / re-tombstones) and every client converges — the restorer
 * through a full-manifest cycle, live peers through fan-out, disconnected
 * peers through cursor replay, and a first-ever client through the manifest.
 */

import { describe, expect, it } from 'vitest';

import {
  emptyArbitrationState,
  InMemoryStorageAdapter,
  InMemorySyncServer,
  planSnapshotRestore,
  sha256Hex,
  SyncClient,
  type ArbitrationFileState,
  type ArbitrationState,
  type BlobStore,
  type FileChangeEvent,
  type Message,
  type SnapshotHeadRecord,
  type Transport,
  type Version,
} from '../src/index.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const text = (b: Uint8Array): string => new TextDecoder().decode(b);

// --- deterministic harness (simulation.test.ts pattern, plus an inbox) -----------------

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
  emit(events: FileChangeEvent[]): void {
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
  scheduler: ManualScheduler;
  watch: ManualWatch;
  /** Server → client messages on the live transport (fan-out assertions). */
  inbox: Message[];
  transports: Transport[];
  disconnect(): void;
}

async function makeRig() {
  let t = 1_000_000;
  const now = (): number => ++t;
  const server = new InMemorySyncServer({ now, vaultName: 'personal' });

  const makeDevice = (id: string, name: string): Device => {
    server.register(id, name, 'desktop');
    const scheduler = new ManualScheduler();
    const storage = new InMemoryStorageAdapter({}, { now });
    const blobStore = makeBlobStore();
    const inbox: Message[] = [];
    const transports: Transport[] = [];
    const client = new SyncClient({
      deviceId: id,
      deviceName: name,
      token: `tok-${id}`,
      transport: () => {
        const pair = server.connectPair(`tok-${id}`);
        const recording: Transport = {
          send: (message) => pair.client.send(message),
          onMessage: (cb) =>
            pair.client.onMessage((message) => {
              inbox.push(message);
              cb(message);
            }),
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
      scheduler,
      watch,
      inbox,
      transports,
      disconnect: () => transports[transports.length - 1]?.close(),
    };
  };

  const desktop = makeDevice('dev-desktop', 'Desktop');
  const mobile = makeDevice('dev-mobile', 'Mobile');
  const daemon = makeDevice('dev-daemon', 'Daemon');
  const tablet = makeDevice('dev-tablet', 'Tablet');

  const settle = async (...devices: ReadonlyArray<Device>): Promise<void> => {
    const all = devices.length > 0 ? devices : [desktop, mobile, daemon];
    for (let round = 0; round < 4; round++) {
      for (const device of all) await device.client.waitIdle();
    }
  };

  return { server, desktop, mobile, daemon, tablet, settle };
}

async function edit(device: Device, path: string, content: string): Promise<void> {
  await device.storage.writeFile(path, enc(content));
  device.watch.emit([{ kind: 'modify', path }]);
  device.scheduler.flush();
}

async function remove(device: Device, path: string): Promise<void> {
  await device.storage.deleteFile(path);
  device.watch.emit([{ kind: 'delete', path }]);
  device.scheduler.flush();
}

async function connectAll(...devices: ReadonlyArray<Device>): Promise<void> {
  for (const device of devices) {
    await device.client.connect();
    device.client.startWatching(device.watch);
  }
}

/** Visible vault contents (the local-index state file is not vault data). */
async function vaultState(device: Device): Promise<Record<string, string>> {
  const state: Record<string, string> = {};
  for (const file of await device.storage.listFiles()) {
    if (file.path.startsWith('/.vaultsyncforagents')) continue;
    state[file.path] = text(await device.storage.readFile(file.path));
  }
  return state;
}

const EXPECTED_SNAPSHOT_STATE: Record<string, string> = {
  '/notes/one.md': 'one v1',
  '/notes/two.md': 'two v1',
  '/notes/three.md': 'three v1',
};

// --- the scenario -----------------------------------------------------------------------

describe('vault snapshots: create + whole-vault restore converge every client', () => {
  it('edits, a delete, and a post-snapshot file all revert; no version is lost', async () => {
    const { server, desktop, mobile, daemon, tablet, settle } = await makeRig();

    // Baseline: three files synced everywhere; the daemon later reconnects
    // through cursor replay, the tablet is a first-ever client.
    await connectAll(desktop, mobile, daemon);
    await edit(desktop, '/notes/one.md', 'one v1');
    await edit(desktop, '/notes/two.md', 'two v1');
    await edit(desktop, '/notes/three.md', 'three v1');
    await settle();

    const created = await desktop.client.createSnapshot('before-agent');
    expect(created).toMatchObject({ id: 's1', name: 'before-agent', fileCount: 3, seq: 3 });

    // Diverge: two edits, one delete, one brand-new file — all via mobile.
    daemon.disconnect();
    await edit(mobile, '/notes/one.md', 'one v2 (bad agent edit)');
    await edit(mobile, '/notes/two.md', 'two v2 (bad agent edit)');
    await remove(mobile, '/notes/three.md');
    await edit(mobile, '/notes/post-snapshot.md', 'should vanish');
    await settle(desktop, mobile);
    expect(text(await desktop.storage.readFile('/notes/one.md'))).toBe('one v2 (bad agent edit)');
    expect(await desktop.storage.exists('/notes/three.md')).toBe(false);

    // Restore from the desktop: three content reverts (two edits + one
    // resurrection) and one new tombstone, all as fresh versions.
    const ack = await desktop.client.restoreSnapshot('s1');
    expect(ack).toMatchObject({ id: 's1', restored: 3, tombstoned: 1 });
    expect(ack.seq).toBe(11);
    await settle(desktop, mobile);

    // The live peer converged through fan-out — restore changes carry the
    // 'restore' kind, and the post-snapshot file's tombstone the delete kind.
    const kinds = mobile.inbox
      .filter((m): m is Extract<Message, { type: 'change' }> => m.type === 'change' && m.seq > 7)
      .map((m) => `${m.kind}${m.deleted ? ':deleted' : ''}`)
      .sort();
    expect(kinds).toEqual(['delete:deleted', 'restore', 'restore', 'restore']);

    // Both synced storages match the snapshot state byte-for-byte.
    expect(await vaultState(desktop)).toEqual(EXPECTED_SNAPSHOT_STATE);
    expect(await vaultState(mobile)).toEqual(EXPECTED_SNAPSHOT_STATE);

    // Index agreement on the reverted heads.
    const stableHash = await sha256Hex(enc('one v1'));
    for (const device of [desktop, mobile]) {
      const index = device.client.currentIndex();
      expect(index['/notes/one.md']).toMatchObject({ hash: stableHash });
      expect(index['/notes/post-snapshot.md']?.deletedAt).toBeDefined();
    }

    // The server kept every version: 3 initial + 4 divergence + 4 restore.
    expect(server.snapshot().versions).toBe(11);
    const heads = new Map(server.snapshot().files.map((file) => [file.path, file]));
    expect(heads.get('/notes/post-snapshot.md')?.deleted).toBe(true);
    expect(heads.get('/notes/three.md')?.deleted).toBe(false);

    // A disconnected client converges through cursor replay after reconnect…
    await daemon.client.reconnect();
    daemon.client.startWatching(daemon.watch);
    await settle(daemon);
    expect(await vaultState(daemon)).toEqual(EXPECTED_SNAPSHOT_STATE);

    // …and a first-ever client converges from the full manifest.
    await connectAll(tablet);
    await settle(tablet);
    expect(await vaultState(tablet)).toEqual(EXPECTED_SNAPSHOT_STATE);
    expect(tablet.client.currentIndex()['/notes/one.md']).toMatchObject({ hash: stableHash });
  });

  it('restoring an up-to-date vault is a clean no-op, unknown ids fail', async () => {
    const { server, desktop, mobile, settle } = await makeRig();
    await connectAll(desktop, mobile);
    await edit(desktop, '/notes/stable.md', 'stable');
    await settle();

    const created = await desktop.client.createSnapshot();
    expect(created).toMatchObject({ id: 's1', name: '', fileCount: 1 });

    const ack = await desktop.client.restoreSnapshot('s1');
    expect(ack).toMatchObject({ id: 's1', restored: 0, tombstoned: 0, seq: 1 });
    await settle(desktop, mobile);
    expect(await vaultState(mobile)).toEqual({ '/notes/stable.md': 'stable' });
    expect(server.snapshot().versions).toBe(1);

    await expect(desktop.client.restoreSnapshot('s404')).rejects.toThrow(/no snapshot s404/);
  });
});

// --- planner units ------------------------------------------------------------------------

describe('planSnapshotRestore (planner units)', () => {
  const version = (id: string, path: string, hash: string, size = hash.length): Version => ({
    id,
    path,
    hash,
    size,
    deviceId: 'dev-A',
    clock: { counter: 1, deviceId: 'dev-A' },
    parentVersion: null,
    ts: 1,
    kind: 'edit',
  });
  const file = (head: Version, deleted: boolean, isFolder = false): ArbitrationFileState => ({
    currentVersion: head.id,
    head,
    deleted,
    ...(isFolder ? { isFolder: true } : {}),
  });
  const stateOf = (path: string, head: Version, deleted = false, isFolder = false): ArbitrationState => {
    const state = emptyArbitrationState();
    state.files.set(path, file(head, deleted, isFolder));
    state.versions.set(head.id, head);
    return state;
  };

  it('a double tombstone with a different recorded hash is a no-op (delete→restore→re-delete)', () => {
    // Both deletes recorded different content (the re-delete tombstoned the
    // restored content, not the original), but the effective state — deleted,
    // non-folder — is equal, so no version is minted and no refcount churns.
    const state = stateOf('/x.md', version('v3', '/x.md', 'hash-of-the-re-delete', 44), true);
    const heads: Record<string, SnapshotHeadRecord> = {
      '/x.md': { version: 'v1', hash: 'hash-of-the-first-delete', size: 7, deleted: true, kind: 'delete' },
    };
    expect(planSnapshotRestore(state, heads)).toEqual([]);
  });

  it('folder-ness still distinguishes tombstones', () => {
    // Deleted both now and at the snapshot, but the snapshot recorded a folder
    // placeholder tombstone while the current tombstone is a plain file: the
    // effective states differ, so the restore re-tombstones as a folder.
    const state = stateOf('/x', version('v3', '/x', 'plain-tombstone-hash'), true);
    const heads: Record<string, SnapshotHeadRecord> = {
      '/x': { version: 'v1', hash: '', size: 0, deleted: true, kind: 'delete', isFolder: true },
    };
    const items = planSnapshotRestore(state, heads);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ path: '/x', tombstone: true });
    expect(items[0]!.commit).toMatchObject({ kind: 'delete', isFolder: true, hash: '' });
  });

  it('identical live heads skip; differing live heads plan a restore commit', () => {
    const identical = stateOf('/a.md', version('v1', '/a.md', 'h1'));
    expect(planSnapshotRestore(identical, { '/a.md': { version: 'v1', hash: 'h1', size: 2, deleted: false, kind: 'edit' } })).toEqual([]);

    const diverged = stateOf('/a.md', version('v2', '/a.md', 'h2'));
    const items = planSnapshotRestore(diverged, {
      '/a.md': { version: 'v1', hash: 'h1', size: 2, deleted: false, kind: 'edit' },
    });
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ path: '/a.md', tombstone: false });
    expect(items[0]!.commit).toMatchObject({ kind: 'restore', hash: 'h1', parentVersion: 'v2' });
  });
});
