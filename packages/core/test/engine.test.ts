import { describe, expect, it } from 'vitest';

import {
  applyPull,
  deserializeLocalIndex,
  InMemoryStorageAdapter,
  loadLocalIndex,
  LOCAL_INDEX_STATE_PATH,
  sha256Hex,
  type FetchBlob,
  type LocalIndex,
  type LocalIndexEntry,
  type PullFileOp,
  type PullRenameOp,
  type StorageAdapter,
  type SyncPlan,
} from '../src/index.js';

const NOW = 555_000;
const clock = { counter: 2, deviceId: 'dev-remote' };

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const text = (b: Uint8Array): string => new TextDecoder().decode(b);

/** Blob store + counting fake transport. */
function blobTransport(blobs: Record<string, Uint8Array>): { fetchBlob: FetchBlob; calls: string[] } {
  const calls: string[] = [];
  const fetchBlob: FetchBlob = async (hash) => {
    calls.push(hash);
    const bytes = blobs[hash];
    if (!bytes) throw new Error(`no blob for ${hash}`);
    return bytes;
  };
  return { fetchBlob, calls };
}

function pullFile(op: Omit<PullFileOp, 'deleted'> & { deleted?: boolean }): PullFileOp {
  return { deleted: false, ...op };
}

function planOf(pulls: SyncPlan['pulls']): SyncPlan {
  return { pushes: [], pulls, conflicts: [], folderPushes: [] };
}

async function seededIndex(storage: InMemoryStorageAdapter): Promise<LocalIndex> {
  const index: Record<string, LocalIndexEntry> = {};
  for (const f of await storage.listFiles()) {
    const hash = await sha256Hex(await storage.readFile(f.path));
    index[f.path] = { hash, size: f.size, versionId: `v0-${f.path}`, clock: { counter: 1, deviceId: 'dev' } };
  }
  return index;
}

describe('applyPull — happy path', () => {
  it('applies add, edit, delete, and rename in one plan and persists the index', async () => {
    const storage = new InMemoryStorageAdapter({
      '/notes/a.md': 'old-a',
      '/notes/gone.md': 'gone',
      '/notes/mv.md': 'move me',
    });
    const index = await seededIndex(storage);

    const newContent = 'brand new';
    const editedContent = 'edited-a';
    const movedContent = 'move me';
    const hNew = await sha256Hex(newContent);
    const hEdited = await sha256Hex(editedContent);
    const hGone = await sha256Hex('gone');
    const hMoved = await sha256Hex(movedContent);

    const { fetchBlob } = blobTransport({
      [hNew]: enc(newContent),
      [hEdited]: enc(editedContent),
      [hMoved]: enc(movedContent),
    });

    const plan = planOf([
      pullFile({ kind: 'add', path: '/new.md', hash: hNew, size: 9, version: 'v-new', clock }),
      pullFile({ kind: 'edit', path: '/notes/a.md', hash: hEdited, size: 8, version: 'v-edit', clock }),
      pullFile({ kind: 'delete', path: '/notes/gone.md', hash: hGone, size: 4, version: 'v-del', clock, deleted: true }),
      {
        kind: 'rename',
        fromPath: '/notes/mv.md',
        toPath: '/archive/mv.md',
        hash: hMoved,
        size: 8,
        version: 'v-rn',
        clock,
      } satisfies PullRenameOp,
    ]);

    const next = await applyPull(storage, index, plan, fetchBlob, { now: NOW });

    // Storage materialized every op.
    expect(text(await storage.readFile('/new.md'))).toBe(newContent);
    expect(text(await storage.readFile('/notes/a.md'))).toBe(editedContent);
    expect(await storage.exists('/notes/gone.md')).toBe(false);
    expect(text(await storage.readFile('/archive/mv.md'))).toBe(movedContent);
    expect(await storage.exists('/notes/mv.md')).toBe(false);

    // Index reflects exactly the pulled heads.
    expect(next['/new.md']).toEqual({ hash: hNew, size: 9, versionId: 'v-new', clock });
    expect(next['/notes/a.md']).toEqual({ hash: hEdited, size: 8, versionId: 'v-edit', clock });
    expect(next['/notes/gone.md']).toEqual({
      hash: hGone,
      size: 4,
      versionId: 'v-del',
      clock,
      deletedAt: NOW,
    });
    expect(next['/archive/mv.md']).toEqual({ hash: hMoved, size: 8, versionId: 'v-rn', clock });
    expect('/notes/mv.md' in next).toBe(false); // rename migrates, no tombstone

    // Persisted atomically through the adapter at the state path.
    const persisted = deserializeLocalIndex(text(await storage.readFile(LOCAL_INDEX_STATE_PATH)));
    expect(persisted).toEqual(next);
    expect(await loadLocalIndex(storage)).toEqual(next);
  });

  it('uses the injected now for tombstone timestamps', async () => {
    const storage = new InMemoryStorageAdapter({ '/x.md': 'x' });
    const index = await seededIndex(storage);
    const hash = await sha256Hex('x');
    const { fetchBlob } = blobTransport({});

    const next = await applyPull(
      storage,
      index,
      planOf([pullFile({ kind: 'delete', path: '/x.md', hash, size: 1, version: 'v2', clock, deleted: true })]),
      fetchBlob,
      { now: 987654 },
    );
    expect(next['/x.md']).toMatchObject({ deletedAt: 987654 });
  });

  it('delete of an already-absent file is safe (idempotent adapters)', async () => {
    const storage = new InMemoryStorageAdapter({ '/keep.md': 'k' });
    const index = await seededIndex(storage);
    const hash = await sha256Hex('never was');
    const { fetchBlob } = blobTransport({});
    await storage.deleteFile('/keep.md');

    const next = await applyPull(
      storage,
      index,
      planOf([pullFile({ kind: 'delete', path: '/keep.md', hash, size: 9, version: 'v2', clock, deleted: true })]),
      fetchBlob,
      { now: NOW },
    );
    expect(next['/keep.md']).toMatchObject({ deletedAt: NOW });
  });
});

describe('applyPull — integrity', () => {
  it('rejects a blob whose content does not hash to the claimed hash', async () => {
    const storage = new InMemoryStorageAdapter({});
    const claimedHash = await sha256Hex('expected content');
    const { fetchBlob } = blobTransport({ [claimedHash]: enc('corrupted bytes') });

    await expect(
      applyPull(
        storage,
        {},
        planOf([pullFile({ kind: 'add', path: '/bad.md', hash: claimedHash, size: 9, version: 'v1', clock })]),
        fetchBlob,
        { now: NOW },
      ),
    ).rejects.toThrow(/hash mismatch/i);

    expect(await storage.exists('/bad.md')).toBe(false);
    // Persisted state exists but records nothing for the failed path.
    const persisted = await loadLocalIndex(storage);
    expect('/bad.md' in persisted).toBe(false);
  });

  it('mid-plan failure: index records successful writes only, never the failed one', async () => {
    const storage = new InMemoryStorageAdapter({});
    const goodContent = 'good';
    const goodHash = await sha256Hex(goodContent);
    const missingHash = await sha256Hex('never uploaded');
    const { fetchBlob } = blobTransport({ [goodHash]: enc(goodContent) });

    const plan = planOf([
      pullFile({ kind: 'add', path: '/ok.md', hash: goodHash, size: 4, version: 'v1', clock }),
      pullFile({ kind: 'add', path: '/fails.md', hash: missingHash, size: 9, version: 'v2', clock }),
      pullFile({ kind: 'add', path: '/never.md', hash: await sha256Hex('never reached'), size: 1, version: 'v3', clock }),
    ]);

    await expect(applyPull(storage, {}, plan, fetchBlob, { now: NOW })).rejects.toThrow(
      /no blob/,
    );

    // The successful write is durable; the failed one is nowhere.
    expect(text(await storage.readFile('/ok.md'))).toBe('good');
    expect(await storage.exists('/fails.md')).toBe(false);
    expect(await storage.exists('/never.md')).toBe(false);
    const persisted = await loadLocalIndex(storage);
    expect(Object.keys(persisted)).toEqual(['/ok.md']);
  });

  it('skip-write optimization: hash unchanged ⇒ no fetch, no rewrite, version still advances', async () => {
    const storage = new InMemoryStorageAdapter({ '/stable.md': 'stable' });
    const index = await seededIndex(storage);
    const hash = await sha256Hex('stable');
    const { fetchBlob, calls } = blobTransport({}); // empty store on purpose

    const next = await applyPull(
      storage,
      index,
      planOf([pullFile({ kind: 'edit', path: '/stable.md', hash, size: 6, version: 'v9', clock })]),
      fetchBlob,
      { now: NOW },
    );
    expect(calls).toEqual([]);
    expect(text(await storage.readFile('/stable.md'))).toBe('stable');
    expect(next['/stable.md']).toMatchObject({ hash, versionId: 'v9' });
    expect(next['/stable.md']?.deletedAt).toBeUndefined();
  });
});

describe('applyPull — renames', () => {
  it('moves the local file when the source exists', async () => {
    const content = 'mv';
    const hash = await sha256Hex(content);
    const storage = new InMemoryStorageAdapter({ '/a.md': content });
    const index = await seededIndex(storage);
    const { fetchBlob, calls } = blobTransport({ [hash]: enc(content) });

    const next = await applyPull(
      storage,
      index,
      planOf([{ kind: 'rename', fromPath: '/a.md', toPath: '/b/deep/c.md', hash, size: 2, version: 'v2', clock }]),
      fetchBlob,
      { now: NOW },
    );

    expect(calls).toEqual([]); // pure local move, no download
    expect(await storage.exists('/a.md')).toBe(false);
    expect(text(await storage.readFile('/b/deep/c.md'))).toBe(content);
    expect('/a.md' in next).toBe(false);
    expect(next['/b/deep/c.md']).toMatchObject({ hash, versionId: 'v2' });
  });

  it('falls back to fetching the blob when the source path is missing locally', async () => {
    const content = 'from elsewhere';
    const hash = await sha256Hex(content);
    const storage = new InMemoryStorageAdapter({});
    const index: LocalIndex = {
      '/a.md': { hash, size: 13, versionId: 'v1', clock: { counter: 1, deviceId: 'dev' } },
    };
    const { fetchBlob, calls } = blobTransport({ [hash]: enc(content) });

    const next = await applyPull(
      storage,
      index,
      planOf([{ kind: 'rename', fromPath: '/a.md', toPath: '/c.md', hash, size: 13, version: 'v2', clock }]),
      fetchBlob,
      { now: NOW },
    );

    expect(calls).toEqual([hash]);
    expect(text(await storage.readFile('/c.md'))).toBe(content);
    expect('/a.md' in next).toBe(false);
    expect(next['/c.md']).toMatchObject({ hash, versionId: 'v2' });
  });
});

describe('applyPull — empty plans', () => {
  it('persists the (unchanged) index and returns it', async () => {
    const storage = new InMemoryStorageAdapter({ '/a.md': 'a' });
    const index = await seededIndex(storage);
    const { fetchBlob } = blobTransport({});

    const next = await applyPull(storage, index, planOf([]), fetchBlob, { now: NOW });
    expect(next).toEqual(index);
    expect(await loadLocalIndex(storage)).toEqual(index);
  });
});

// --- folder lifecycle: tombstone application (B) + prune-on-delete (C) ----------------------
//
// These pin the REAL invocation path — applyPull → applyOnePull → removeDir —
// because the F-1/F-2 E2E failure (index tombstoned while the directory
// lingered forever) was invisible to tests that only asserted index state.

/** Seed a live folder placeholder entry (FR-10 constants: hash '', size 0). */
function placeholder(path: string, version = 'v1'): LocalIndexEntry {
  return { hash: '', size: 0, versionId: version, clock: { counter: 1, deviceId: 'dev-remote' }, isFolder: true };
}
/** Wrap `storage.removeDir` so every invocation is recorded (delegation preserved). */
function spyRemoveDir(storage: InMemoryStorageAdapter): { storage: InMemoryStorageAdapter; calls: string[] } {
  const calls: string[] = [];
  const inner = storage.removeDir.bind(storage);
  storage.removeDir = async (path: string): Promise<void> => {
    calls.push(path);
    await inner(path);
  };
  return { storage, calls };
}

/** The exact E2E failure shape: the deployed adapter's removeDir always threw. */
function withoutRemoveDir(storage: InMemoryStorageAdapter): StorageAdapter {
  return {
    readFile: (p) => storage.readFile(p),
    writeFile: (p, d) => storage.writeFile(p, d),
    deleteFile: (p) => storage.deleteFile(p),
    renameFile: (from, to) => storage.renameFile(from, to),
    listFiles: () => storage.listFiles(),
    listDirs: () => storage.listDirs(),
    ensureDir: (p) => storage.ensureDir(p),
    exists: (p) => storage.exists(p),
  };
}

function folderTombstonePull(path: string): PullFileOp {
  return {
    kind: 'delete',
    path,
    hash: '',
    size: 0,
    version: 'v2',
    clock: { counter: 2, deviceId: 'dev-remote' },
    deleted: true,
    isFolder: true,
  };
}

describe('applyPull — folder tombstone application (B)', () => {
  it('invokes adapter.removeDir with the tombstoned path and removes the local EMPTY directory', async () => {
    const plain = new InMemoryStorageAdapter({});
    await plain.ensureDir('/tempfolder');
    const { storage, calls } = spyRemoveDir(plain);
    const index: LocalIndex = { '/tempfolder': placeholder('/tempfolder') };
    const { fetchBlob } = blobTransport({});

    const next = await applyPull(storage, index, planOf([folderTombstonePull('/tempfolder')]), fetchBlob, {
      now: NOW,
    });

    // THE assertion the old suite never made: removeDir WAS called, with the
    // exact vault path, and the directory actually left the disk.
    expect(calls).toEqual(['/tempfolder']);
    expect(await storage.exists('/tempfolder')).toBe(false);
    expect(next['/tempfolder']).toEqual({
      hash: '',
      size: 0,
      versionId: 'v2',
      clock: { counter: 2, deviceId: 'dev-remote' },
      deletedAt: NOW,
      isFolder: true,
    });
  });

  it('never calls removeDir while content remains beneath the directory (record-only)', async () => {
    const plain = new InMemoryStorageAdapter({ '/tempfolder/keep.md': 'precious' });
    const { storage, calls } = spyRemoveDir(plain);
    const index: LocalIndex = {
      '/tempfolder': placeholder('/tempfolder'),
      '/tempfolder/keep.md': { hash: 'h', size: 8, versionId: 'v1', clock: { counter: 1, deviceId: 'dev' } },
    };
    const { fetchBlob } = blobTransport({});

    const next = await applyPull(storage, index, planOf([folderTombstonePull('/tempfolder')]), fetchBlob, {
      now: NOW,
    });

    expect(calls).toEqual([]); // non-empty ⇒ the hook is never even attempted
    expect(text(await storage.readFile('/tempfolder/keep.md'))).toBe('precious'); // never lose content
    expect(next['/tempfolder']?.deletedAt).toBe(NOW); // tombstone still recorded — converges later
  });

  it('records a tombstone for a directory that does not exist locally (no removal attempt)', async () => {
    const { storage, calls } = spyRemoveDir(new InMemoryStorageAdapter({}));
    const { fetchBlob } = blobTransport({});

    const next = await applyPull(storage, {}, planOf([folderTombstonePull('/never-synced')]), fetchBlob, {
      now: NOW,
    });

    expect(calls).toEqual([]);
    expect(await storage.exists('/never-synced')).toBe(false);
    expect(next['/never-synced']?.deletedAt).toBe(NOW);
  });

  it('skips removal gracefully when the adapter lacks the removeDir hook (record-only)', async () => {
    const inner = new InMemoryStorageAdapter({});
    await inner.ensureDir('/tempfolder');
    const storage = withoutRemoveDir(inner);
    const index: LocalIndex = { '/tempfolder': placeholder('/tempfolder') };
    const { fetchBlob } = blobTransport({});

    const next = await applyPull(storage, index, planOf([folderTombstonePull('/tempfolder')]), fetchBlob, {
      now: NOW,
    });

    expect(await inner.exists('/tempfolder')).toBe(true); // dir lingers — pre-hook adapter
    expect(next['/tempfolder']?.deletedAt).toBe(NOW); // …but the tombstone is honest
  });
});

describe('applyPull — prune-on-delete (C)', () => {
  it('removes the emptied parent of a deleted file — exactly ONE level, no cascade', async () => {
    const plain = new InMemoryStorageAdapter({ '/a/b/c/f.md': 'content' });
    const { storage, calls } = spyRemoveDir(plain);
    const index: LocalIndex = {
      '/a': placeholder('/a'),
      '/a/b': placeholder('/a/b'),
      '/a/b/c': placeholder('/a/b/c'),
      '/a/b/c/f.md': { hash: 'h', size: 7, versionId: 'v1', clock: { counter: 1, deviceId: 'dev' } },
    };
    const { fetchBlob } = blobTransport({});

    const next = await applyPull(
      storage,
      index,
      planOf([
        pullFile({
          kind: 'delete',
          path: '/a/b/c/f.md',
          hash: 'h',
          size: 7,
          version: 'v2',
          clock,
          deleted: true,
        }),
      ]),
      fetchBlob,
      { now: NOW },
    );

    expect(calls).toEqual(['/a/b/c']); // the immediate parent only
    expect(await storage.exists('/a/b/c')).toBe(false);
    expect(await storage.exists('/a/b')).toBe(true); // ancestors converge over successive cycles
    expect(await storage.exists('/a')).toBe(true);
    expect(next['/a/b/c/f.md']?.deletedAt).toBe(NOW);
  });

  it('leaves a parent that still holds content (removeDir never invoked)', async () => {
    const plain = new InMemoryStorageAdapter({ '/dir/a.md': 'a', '/dir/b.md': 'b' });
    const { storage, calls } = spyRemoveDir(plain);
    const index = await seededIndex(plain);
    const hA = index['/dir/a.md']!.hash;
    const { fetchBlob } = blobTransport({});

    const next = await applyPull(
      storage,
      index,
      planOf([
        pullFile({
          kind: 'delete',
          path: '/dir/a.md',
          hash: hA,
          size: 1,
          version: 'v2',
          clock,
          deleted: true,
        }),
      ]),
      fetchBlob,
      { now: NOW },
    );

    expect(calls).toEqual([]);
    expect(await storage.exists('/dir')).toBe(true);
    expect(text(await storage.readFile('/dir/b.md'))).toBe('b');
    expect(next['/dir/a.md']?.deletedAt).toBe(NOW);
  });

  it('never attempts a removal for a root-level deletion (parent is the vault root)', async () => {
    const plain = new InMemoryStorageAdapter({ '/root.md': 'root' });
    const { storage, calls } = spyRemoveDir(plain);
    const index = await seededIndex(plain);
    const { fetchBlob } = blobTransport({});

    await applyPull(
      storage,
      index,
      planOf([
        pullFile({
          kind: 'delete',
          path: '/root.md',
          hash: index['/root.md']!.hash,
          size: 4,
          version: 'v2',
          clock,
          deleted: true,
        }),
      ]),
      fetchBlob,
      { now: NOW },
    );

    expect(calls).toEqual([]); // '/' is never deletable
    expect(await storage.exists('/')).toBe(true);
  });
});
