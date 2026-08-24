import { describe, expect, it } from 'vitest';

import {
  InMemoryStorageAdapter,
  isIgnored,
  recordHashedFiles,
  sha256Hex,
  scanVault,
  type LocalIndex,
  type LocalIndexEntry,
} from '../src/index.js';

const SETTINGS = { obsidianSync: false };
const NOW = 1_000_000;

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

/** Build an index whose hashes/size match the given contents. */
async function indexFrom(
  spec: Record<string, { content: string; versionId?: string; deletedAt?: number; isFolder?: boolean }>,
): Promise<LocalIndex> {
  const index: Record<string, LocalIndexEntry> = {};
  for (const [path, e] of Object.entries(spec)) {
    if (e.isFolder) {
      index[path] = {
        hash: '',
        size: 0,
        versionId: e.versionId ?? `v-${path}`,
        clock: { counter: 1, deviceId: 'dev' },
        isFolder: true,
        ...(e.deletedAt !== undefined ? { deletedAt: e.deletedAt } : {}),
      };
      continue;
    }
    index[path] = {
      hash: await sha256Hex(e.content),
      size: enc(e.content).byteLength,
      versionId: e.versionId ?? `v-${path}`,
      clock: { counter: 1, deviceId: 'dev' },
      ...(e.deletedAt !== undefined ? { deletedAt: e.deletedAt } : {}),
    };
  }
  return index;
}

/** Index that exactly matches a storage snapshot (the "clean" baseline). */
async function cleanIndex(storage: InMemoryStorageAdapter): Promise<LocalIndex> {
  const spec: Record<string, { content: string }> = {};
  for (const f of await storage.listFiles()) {
    if (isIgnored(f.path, SETTINGS)) continue;
    spec[f.path] = { content: new TextDecoder().decode(await storage.readFile(f.path)) };
  }
  return indexFrom(spec);
}

/** Counting hash seam: records how many files a scan actually hashed. */
function countingHash(): { hash: (bytes: Uint8Array) => Promise<string>; count: () => number } {
  let calls = 0;
  return {
    hash: (bytes) => {
      calls += 1;
      return sha256Hex(bytes);
    },
    count: () => calls,
  };
}

/** The `hashed` observations a fresh (legacy, mtime-less) scan of `storage` produces. */
async function hashedObservations(storage: InMemoryStorageAdapter) {
  const observations = [];
  for (const f of await storage.listFiles()) {
    if (isIgnored(f.path, SETTINGS)) continue;
    observations.push({
      path: f.path,
      hash: await sha256Hex(await storage.readFile(f.path)),
      size: f.size,
      mtime: f.mtime,
    });
  }
  return observations.sort((a, b) => (a.path < b.path ? -1 : 1));
}

describe('scanVault — clean vault', () => {
  it('reports no changes when storage matches the index exactly', async () => {
    const storage = new InMemoryStorageAdapter({
      '/notes/a.md': 'alpha',
      '/notes/sub/b.md': 'beta',
      'attachments\\logo.png': new Uint8Array([1, 2, 3]),
    });
    const index = await cleanIndex(storage);

    const changes = await scanVault(storage, index, SETTINGS, NOW);
    expect(changes).toEqual({
      scannedAt: NOW,
      added: [],
      modified: [],
      deleted: [],
      renamed: [],
      emptyFolders: [],
      folderDeletions: [],
      // The clean index is legacy-style (no mtime): fast mode still hashed
      // every file to establish the stat cache — and found them all unchanged.
      hashed: await hashedObservations(storage),
    });
  });

  it('does not report tombstoned index entries whose files are gone', async () => {
    const storage = new InMemoryStorageAdapter({ '/gone.md': 'x' });
    const index = await indexFrom({ '/gone.md': { content: 'x', deletedAt: 5 } });
    await storage.deleteFile('/gone.md');

    const changes = await scanVault(storage, index, SETTINGS, NOW);
    expect(changes.deleted).toEqual([]);
    expect(changes.modified).toEqual([]);
  });
});

describe('scanVault — edits and creates', () => {
  it('detects a modified file with the new hash and size', async () => {
    const storage = new InMemoryStorageAdapter({ '/notes/a.md': 'alpha', '/notes/b.md': 'beta' });
    const index = await cleanIndex(storage);
    await storage.writeFile('/notes/a.md', enc('alpha — now longer'));

    const changes = await scanVault(storage, index, SETTINGS, NOW);
    expect(changes.modified).toEqual([
      {
        path: '/notes/a.md',
        hash: await sha256Hex('alpha — now longer'),
        size: enc('alpha — now longer').byteLength,
      },
    ]);
    expect(changes.added).toEqual([]);
  });

  it('detects a created file', async () => {
    const storage = new InMemoryStorageAdapter({ '/notes/a.md': 'alpha' });
    const index = await cleanIndex(storage);
    await storage.writeFile('/notes/new.md', enc('fresh'));

    const changes = await scanVault(storage, index, SETTINGS, NOW);
    expect(changes.added).toEqual([{ path: '/notes/new.md', hash: await sha256Hex('fresh'), size: 5 }]);
  });

  it('reports a file resurrected over a tombstone as modified (documented)', async () => {
    // Resurrect with the SAME content as the tombstone: still a local change
    // (an undelete) — never silently dropped.
    const storage = new InMemoryStorageAdapter({});
    const index = await indexFrom({ '/notes/undone.md': { content: 'same', deletedAt: 7 } });
    await storage.writeFile('/notes/undone.md', enc('same'));

    const changes = await scanVault(storage, index, SETTINGS, NOW);
    expect(changes.modified).toEqual([
      { path: '/notes/undone.md', hash: await sha256Hex('same'), size: 4 },
    ]);
  });
});

describe('scanVault — deletions', () => {
  it('detects a deleted file and carries its synced version id', async () => {
    const storage = new InMemoryStorageAdapter({ '/notes/a.md': 'alpha', '/keep.md': 'k' });
    const index = await indexFrom({ '/notes/a.md': { content: 'alpha', versionId: 'v7' }, '/keep.md': { content: 'k' } });
    await storage.deleteFile('/notes/a.md');

    const changes = await scanVault(storage, index, SETTINGS, NOW);
    expect(changes.deleted).toEqual([
      { path: '/notes/a.md', hash: await sha256Hex('alpha'), size: 5, versionId: 'v7' },
    ]);
  });

  it('does not report deletion for a path that only became ignored', async () => {
    const storage = new InMemoryStorageAdapter({ '/keep.md': 'k' });
    const index = await indexFrom({ '.obsidian/app.json': { content: '{}' }, '/keep.md': { content: 'k' } });
    // obsidianSync=false ⇒ the indexed .obsidian file is now ignored, not deleted.

    const changes = await scanVault(storage, index, SETTINGS, NOW);
    expect(changes.deleted).toEqual([]);
  });
});

describe('scanVault — rename detection', () => {
  it('correlates a same-directory rename into one renamed pair', async () => {
    const storage = new InMemoryStorageAdapter({ '/notes/a.md': 'alpha', '/notes/b.md': 'beta' });
    const index = await cleanIndex(storage);
    await storage.renameFile('/notes/a.md', '/notes/a-renamed.md');

    const changes = await scanVault(storage, index, SETTINGS, NOW);
    expect(changes.renamed).toEqual([
      { from: '/notes/a.md', to: '/notes/a-renamed.md', hash: await sha256Hex('alpha'), size: 5 },
    ]);
    expect(changes.deleted).toEqual([]);
    expect(changes.added).toEqual([]);
  });

  it('correlates a cross-directory move (rename across dirs)', async () => {
    const storage = new InMemoryStorageAdapter({ '/notes/a.md': 'alpha' });
    const index = await cleanIndex(storage);
    await storage.renameFile('/notes/a.md', '/archive/a.md');

    const changes = await scanVault(storage, index, SETTINGS, NOW);
    expect(changes.renamed).toEqual([
      { from: '/notes/a.md', to: '/archive/a.md', hash: await sha256Hex('alpha'), size: 5 },
    ]);
  });

  it('falls back to delete+add when the content changed during the rename (documented)', async () => {
    const storage = new InMemoryStorageAdapter({ '/notes/a.md': 'alpha' });
    const index = await cleanIndex(storage);
    await storage.renameFile('/notes/a.md', '/notes/b.md');
    await storage.writeFile('/notes/b.md', enc('beta'));

    const changes = await scanVault(storage, index, SETTINGS, NOW);
    expect(changes.renamed).toEqual([]);
    expect(changes.deleted.map((d) => d.path)).toEqual(['/notes/a.md']);
    expect(changes.added.map((a) => a.path)).toEqual(['/notes/b.md']);
    expect(changes.added[0]).toMatchObject({ hash: await sha256Hex('beta') });
  });

  it('prefers same-parent-dir matches when an identical file exists in two dirs', async () => {
    // Two files with identical content in different dirs; one is deleted,
    // one added — the add in the SAME dir as the delete wins the pairing…
    // except here the add is in another dir, so check the preference both ways.
    const content = 'twin';
    const storage = new InMemoryStorageAdapter({
      '/dir1/twin.md': content,
      '/dir2/twin.md': content,
    });
    const index = await cleanIndex(storage);
    // Move dir1/twin.md to dir1/twin-copy.md; dir2/twin.md stays.
    await storage.renameFile('/dir1/twin.md', '/dir1/twin-copy.md');

    const changes = await scanVault(storage, index, SETTINGS, NOW);
    expect(changes.renamed).toEqual([
      { from: '/dir1/twin.md', to: '/dir1/twin-copy.md', hash: await sha256Hex(content), size: 4 },
    ]);
  });

  it('uses a deterministic smallest-path tie-break when no same-dir match exists', async () => {
    const content = 'twin';
    const storage = new InMemoryStorageAdapter({ '/src/twin.md': content });
    const index = await cleanIndex(storage);
    await storage.deleteFile('/src/twin.md');
    await storage.writeFile('/z-dir/twin.md', enc(content));
    await storage.writeFile('/a-dir/twin.md', enc(content));

    const changes = await scanVault(storage, index, SETTINGS, NOW);
    expect(changes.renamed).toEqual([
      { from: '/src/twin.md', to: '/a-dir/twin.md', hash: await sha256Hex(content), size: 4 },
    ]);
    // The unmatched add remains an add.
    expect(changes.added.map((a) => a.path)).toEqual(['/z-dir/twin.md']);
  });

  it('pairs multiple identical files one-to-one', async () => {
    const content = 'dup';
    const storage = new InMemoryStorageAdapter({
      '/x/one.md': content,
      '/x/two.md': content,
    });
    const index = await cleanIndex(storage);
    await storage.renameFile('/x/one.md', '/y/1.md');
    await storage.renameFile('/x/two.md', '/y/2.md');

    const changes = await scanVault(storage, index, SETTINGS, NOW);
    expect(changes.renamed.length).toBe(2);
    expect(changes.renamed.map((r) => r.from).sort()).toEqual(['/x/one.md', '/x/two.md']);
    expect(changes.renamed.map((r) => r.to).sort()).toEqual(['/y/1.md', '/y/2.md']);
    // Sorted by `from`.
    expect(changes.renamed[0]).toMatchObject({ from: '/x/one.md' });
    expect(changes.deleted).toEqual([]);
    expect(changes.added).toEqual([]);
  });
});

describe('scanVault — ignore rules', () => {
  it('skips ignored files in every bucket', async () => {
    const storage = new InMemoryStorageAdapter({
      '/notes/a.md': 'alpha',
      '/.trash/deleted.md': 'gone',
      '/.obsidian/workspace.json': '{}',
      '/.vaultsyncforagents/state': '{}',
    });
    // The index knows the ignored paths (e.g. a settings change made them
    // ignored after they had synced) — they must not surface as changes.
    const index = await indexFrom({
      '/notes/a.md': { content: 'alpha' },
      '/.trash/deleted.md': { content: 'gone' },
    });
    await storage.writeFile('/.trash/added-later.md', enc('x')); // ignored add
    await storage.deleteFile('/.trash/deleted.md'); // ignored delete (guarded)

    const changes = await scanVault(storage, index, SETTINGS, NOW);
    expect(changes.added).toEqual([]);
    expect(changes.deleted).toEqual([]);
    expect(changes.modified).toEqual([]);
    // Dirs holding only ignored files are not empty-folder candidates either.
    expect(changes.emptyFolders).toEqual([]);
  });

  it('includes .obsidian files when opted in, except the volatile ones', async () => {
    const settings = { obsidianSync: true };
    const storage = new InMemoryStorageAdapter({
      '/.obsidian/app.json': '{}',
      '/.obsidian/workspace.json': 'volatile',
      '/.obsidian/cache/idx': 'x',
    });
    const index = await indexFrom({});

    const changes = await scanVault(storage, index, settings, NOW);
    expect(changes.added.map((a) => a.path)).toEqual(['/.obsidian/app.json']);
  });
});

describe('scanVault — empty folders (FR-10)', () => {
  it('reports empty directories missing from the index', async () => {
    const storage = new InMemoryStorageAdapter({ '/notes/a.md': 'alpha' });
    await storage.ensureDir('/empty-folder');
    await storage.ensureDir('/nested/empty'); // creates /nested too
    const index = await cleanIndex(storage);

    const changes = await scanVault(storage, index, SETTINGS, NOW);
    // Every dir in an empty chain needs its own placeholder.
    expect(changes.emptyFolders).toEqual(['/empty-folder', '/nested', '/nested/empty']);
  });

  it('skips folders already represented by a live placeholder entry', async () => {
    const storage = new InMemoryStorageAdapter({ '/notes/a.md': 'alpha' });
    await storage.ensureDir('/placeholder');
    const index = { ...(await cleanIndex(storage)), ...(await indexFrom({ '/placeholder': { content: '', isFolder: true } })) };

    const changes = await scanVault(storage, index, SETTINGS, NOW);
    expect(changes.emptyFolders).toEqual([]);
  });

  it('treats a REMOTE-tombstoned placeholder with an EMPTY dir on disk as a stale leftover, never a resurrection', async () => {
    // F-1 ping-pong shape: a remote folder tombstone was applied record-only
    // (adapter without removeDir / raced removal), leaving the empty dir on
    // disk over a tombstoned entry authored by the OTHER device. The leftover
    // is CONSISTENT with that deletion — it must not surface as an
    // empty-folder placeholder ("local wins"), which would resurrect the
    // deleted folder on the deleting peer and ping-pong forever.
    const storage = new InMemoryStorageAdapter({ '/notes/a.md': 'alpha' });
    await storage.ensureDir('/tempfolder');
    const index = await indexFrom({
      '/notes/a.md': { content: 'alpha' },
      '/tempfolder': { content: '', isFolder: true, deletedAt: 5 }, // authored by 'dev' ≠ local
    });

    const changes = await scanVault(storage, index, SETTINGS, NOW, { thisDeviceId: 'dev-local' });
    expect(changes.emptyFolders).toEqual([]);
    expect(changes.staleDirs).toEqual(['/tempfolder']);
    // Nothing else moved: no folder deletion (already tombstoned), no file change.
    expect(changes.folderDeletions).toEqual([]);
    expect(changes.added).toEqual([]);
    expect(changes.modified).toEqual([]);
    expect(changes.deleted).toEqual([]);
  });

  it('restores a placeholder over an OWN-tombstoned entry when the user re-created the EMPTY folder', async () => {
    // The deleting device itself: its own tombstone + a dir present again can
    // only mean local recreation — restoring ("local wins") is correct even
    // though the dir is empty.
    const storage = new InMemoryStorageAdapter({ '/notes/a.md': 'alpha' });
    await storage.ensureDir('/back-again');
    const index = await indexFrom({
      '/notes/a.md': { content: 'alpha' },
      '/back-again': { content: '', isFolder: true, deletedAt: 5 }, // authored by 'dev'
    });

    const changes = await scanVault(storage, index, SETTINGS, NOW, { thisDeviceId: 'dev' });
    expect(changes.staleDirs).toBeUndefined(); // omitted when empty
    expect(changes.emptyFolders).toEqual(['/back-again']);
  });

  it('restores a tombstoned placeholder when content was recreated beneath (local wins)', async () => {
    // The non-empty branch: the user genuinely recreated the folder after the
    // deletion, so the placeholder must be restored (it lands back in
    // `emptyFolders` → folderPushes) while the recreated FILES surface as adds.
    const storage = new InMemoryStorageAdapter({ '/notes/a.md': 'alpha' });
    await storage.ensureDir('/back-again');
    await storage.writeFile('/back-again/keep.md', enc('real content'));
    const index = await indexFrom({
      '/notes/a.md': { content: 'alpha' },
      '/back-again': { content: '', isFolder: true, deletedAt: 5 },
    });

    const changes = await scanVault(storage, index, SETTINGS, NOW, { thisDeviceId: 'dev-local' });
    expect(changes.staleDirs).toBeUndefined(); // omitted when empty
    expect(changes.emptyFolders).toEqual(['/back-again']);
    expect(changes.added).toEqual([
      { path: '/back-again/keep.md', hash: await sha256Hex('real content'), size: 12 },
    ]);
  });

  it('never reports the root, non-empty folders, ignored dirs, or dirs holding only ignored files', async () => {
    const storage = new InMemoryStorageAdapter({ '/notes/a.md': 'alpha' });
    await storage.ensureDir('/notes/full'); // will hold a file below
    await storage.writeFile('/notes/full/file.md', enc('x'));
    await storage.ensureDir('/.obsidian'); // ignored dir (obsidianSync off)
    await storage.ensureDir('/only-junk'); // holds only an ignored file
    await storage.writeFile('/only-junk/.DS_Store', enc('j'));
    const index = await cleanIndex(storage);

    const changes = await scanVault(storage, index, SETTINGS, NOW);
    expect(changes.emptyFolders).toEqual([]);
  });

  it('treats a folder whose only file was deleted in this same scan as empty', async () => {
    const storage = new InMemoryStorageAdapter({ '/solo/only.md': 'x' });
    const index = await cleanIndex(storage);
    await storage.deleteFile('/solo/only.md');

    const changes = await scanVault(storage, index, SETTINGS, NOW);
    expect(changes.deleted.map((d) => d.path)).toEqual(['/solo/only.md']);
    expect(changes.emptyFolders).toEqual(['/solo']);
    expect(changes.folderDeletions).toEqual([]); // no placeholder indexed ⇒ nothing to tombstone
  });
});

describe('scanVault — folder placeholder deletions (F5)', () => {
  it('reports a live placeholder whose directory vanished as a folder deletion', async () => {
    const storage = new InMemoryStorageAdapter({ '/notes/a.md': 'alpha' });
    await storage.ensureDir('/gone-folder');
    const index = await indexFrom({
      '/notes/a.md': { content: 'alpha' },
      '/gone-folder': { content: '', isFolder: true, versionId: 'v9' },
    });
    await storage.removeDir('/gone-folder');

    const changes = await scanVault(storage, index, SETTINGS, NOW);
    expect(changes.folderDeletions).toEqual([{ path: '/gone-folder', versionId: 'v9' }]);
    // Folder deletions never leak into the file buckets.
    expect(changes.deleted).toEqual([]);
    expect(changes.emptyFolders).toEqual([]);
    expect(changes.modified).toEqual([]);
  });

  it('does not report placeholders whose directory still exists', async () => {
    const storage = new InMemoryStorageAdapter({ '/notes/a.md': 'alpha' });
    await storage.ensureDir('/still-here');
    const index = await indexFrom({
      '/notes/a.md': { content: 'alpha' },
      '/still-here': { content: '', isFolder: true },
    });

    const changes = await scanVault(storage, index, SETTINGS, NOW);
    expect(changes.folderDeletions).toEqual([]);
    expect(changes.emptyFolders).toEqual([]); // represented by the live placeholder
  });

  it('skips already-tombstoned placeholders and paths that only became ignored', async () => {
    const storage = new InMemoryStorageAdapter({ '/keep.md': 'k' });
    const index = await indexFrom({
      '/keep.md': { content: 'k' },
      '/buried': { content: '', isFolder: true, deletedAt: 5 }, // already tombstoned
      '.obsidian/plugins': { content: '', isFolder: true }, // ignored (obsidianSync off)
    });

    const changes = await scanVault(storage, index, SETTINGS, NOW);
    expect(changes.folderDeletions).toEqual([]);
  });

  it('reports several vanished placeholders deterministically sorted by path', async () => {
    const storage = new InMemoryStorageAdapter({});
    const index = await indexFrom({
      '/z-dir': { content: '', isFolder: true, versionId: 'vz' },
      '/a-dir': { content: '', isFolder: true, versionId: 'va' },
    });

    const changes = await scanVault(storage, index, SETTINGS, NOW);
    expect(changes.folderDeletions).toEqual([
      { path: '/a-dir', versionId: 'va' },
      { path: '/z-dir', versionId: 'vz' },
    ]);
  });
});

describe('scanVault — determinism', () => {
  it('returns every bucket sorted by path and stamps scannedAt', async () => {
    const storage = new InMemoryStorageAdapter({ '/b.md': 'b', '/a.md': 'a', '/c.md': 'c' });
    const index = await cleanIndex(storage);
    await storage.writeFile('/z-new.md', enc('z'));
    await storage.writeFile('/m-new.md', enc('m'));
    await storage.deleteFile('/b.md');

    const changes = await scanVault(storage, index, SETTINGS, 424242);
    expect(changes.scannedAt).toBe(424242);
    expect(changes.added.map((a) => a.path)).toEqual(['/m-new.md', '/z-new.md']);
    expect(changes.deleted.map((d) => d.path)).toEqual(['/b.md']);

    const again = await scanVault(storage, index, SETTINGS, 424242);
    expect(again).toEqual(changes);
  });
});

describe('scanVault — mtime+size pre-filter (fast mode)', () => {
  /** Deterministic ticking storage clock (the adapter's injectable `now`). */
  const tickingClock = (): { now: () => number } => {
    let tick = 1000;
    return { now: () => (tick += 10) };
  };

  /**
   * The client loop under test: scan → record observations → scan again.
   * `recordHashedFiles` is what `SyncClient.runCycle` folds into the index
   * after a cycle, so this is the on-disk state the NEXT app-open sees.
   */
  async function scanAndRecord(
    storage: InMemoryStorageAdapter,
    index: LocalIndex,
    hashed: (bytes: Uint8Array) => Promise<string>,
  ): Promise<{ changes: Awaited<ReturnType<typeof scanVault>>; index: LocalIndex }> {
    const changes = await scanVault(storage, index, SETTINGS, NOW, { hash: hashed });
    return { changes, index: recordHashedFiles(index, changes.hashed) };
  }

  it('an unchanged vault (stat-cached index) hashes ZERO files', async () => {
    const storage = new InMemoryStorageAdapter({ '/a.md': 'a', '/notes/b.md': 'b' });
    const counter = countingHash();
    const first = await scanAndRecord(storage, await cleanIndex(storage), counter.hash);
    expect(counter.count()).toBe(2); // legacy index: mtime unknown ⇒ hash all

    const secondCounter = countingHash();
    const second = await scanVault(storage, first.index, SETTINGS, NOW, { hash: secondCounter.hash });
    expect(secondCounter.count()).toBe(0);
    expect(second.hashed).toEqual([]);
    expect(second.added).toEqual([]);
    expect(second.modified).toEqual([]);
    expect(second.deleted).toEqual([]);
  });

  it('a mtime-only touch rehashes exactly that file and finds it unchanged', async () => {
    const storage = new InMemoryStorageAdapter({ '/a.md': 'aa', '/b.md': 'bb' }, tickingClock());
    const counter = countingHash();
    const { index } = await scanAndRecord(storage, await cleanIndex(storage), counter.hash);

    // Same content, new write ⇒ new mtime (size unchanged).
    await storage.writeFile('/a.md', enc('aa'));
    const touchCounter = countingHash();
    const changes = await scanVault(storage, index, SETTINGS, NOW, { hash: touchCounter.hash });
    expect(touchCounter.count()).toBe(1);
    expect(changes.hashed.map((h) => h.path)).toEqual(['/a.md']);
    expect(changes.modified).toEqual([]); // content identical ⇒ not a change

    // Recording the fresh observation re-caches the touched mtime.
    const third = countingHash();
    await scanVault(storage, recordHashedFiles(index, changes.hashed), SETTINGS, NOW, { hash: third.hash });
    expect(third.count()).toBe(0);
  });

  it('a size change rehashes exactly that file and reports it modified', async () => {
    const storage = new InMemoryStorageAdapter({ '/a.md': 'aa', '/b.md': 'bb' }, tickingClock());
    const { index } = await scanAndRecord(storage, await cleanIndex(storage), countingHash().hash);

    await storage.writeFile('/a.md', enc('aaa'));
    const counter = countingHash();
    const changes = await scanVault(storage, index, SETTINGS, NOW, { hash: counter.hash });
    expect(counter.count()).toBe(1);
    expect(changes.hashed.map((h) => h.path)).toEqual(['/a.md']);
    expect(changes.modified).toEqual([
      { path: '/a.md', hash: await sha256Hex('aaa'), size: 3 },
    ]);
  });

  it('legacy index without mtime: first scan hashes all, records, second scan hashes none', async () => {
    const storage = new InMemoryStorageAdapter({ '/a.md': 'a', '/b.md': 'b', '/sub/c.md': 'c' });
    const legacy = await cleanIndex(storage); // no mtime anywhere
    for (const entry of Object.values(legacy)) expect(entry.mtime).toBeUndefined();

    const first = countingHash();
    const one = await scanVault(storage, legacy, SETTINGS, NOW, { hash: first.hash });
    expect(first.count()).toBe(3);
    expect(one.hashed.map((h) => h.path)).toEqual(['/a.md', '/b.md', '/sub/c.md']);

    const recorded = recordHashedFiles(legacy, one.hashed);
    for (const [path, entry] of Object.entries(recorded)) {
      expect(entry.mtime).toBe((await storage.listFiles()).find((f) => f.path === path)!.mtime);
    }

    const second = countingHash();
    await scanVault(storage, recorded, SETTINGS, NOW, { hash: second.hash });
    expect(second.count()).toBe(0);
  });

  it('full mode rehashes everything regardless of a matching stat cache', async () => {
    const storage = new InMemoryStorageAdapter({ '/a.md': 'a', '/b.md': 'b' });
    const { index } = await scanAndRecord(storage, await cleanIndex(storage), countingHash().hash);

    const counter = countingHash();
    const changes = await scanVault(storage, index, SETTINGS, NOW, { mode: 'full', hash: counter.hash });
    expect(counter.count()).toBe(2); // full: the stat cache is ignored
    expect(changes.hashed.map((h) => h.path)).toEqual(['/a.md', '/b.md']);
    // ...but an honest vault still reports no changes.
    expect(changes.modified).toEqual([]);
    expect(changes.added).toEqual([]);
  });

  it('documents the tradeoff: fast mode trusts size+mtime, full mode verifies content', async () => {
    // The index entry's recorded hash is WRONG for the file on disk (content
    // changed behind the filesystem's back without touching size or mtime —
    // simulated by mutating the recorded hash expectation).
    const storage = new InMemoryStorageAdapter({ '/a.md': 'aaaa' });
    const index = await cleanIndex(storage);
    const stat = (await storage.listFiles())[0]!;
    const lied: LocalIndex = {
      '/a.md': { ...index['/a.md']!, hash: await sha256Hex('bbbb'), size: stat.size, mtime: stat.mtime },
    };

    // Fast mode: size and mtime match ⇒ trusts the stat, skips the hash,
    // and the drift goes unnoticed. This is the documented cost of fast
    // mode; nothing asserts it as correct — the full-mode run below is the
    // verification that surfaces the drift.
    const fast = countingHash();
    const fastChanges = await scanVault(storage, lied, SETTINGS, NOW, { hash: fast.hash });
    expect(fast.count()).toBe(0);
    expect(fastChanges.modified).toEqual([]);

    // Full mode exists precisely for this: rehash everything, detect it.
    const full = countingHash();
    const fullChanges = await scanVault(storage, lied, SETTINGS, NOW, { mode: 'full', hash: full.hash });
    expect(full.count()).toBe(1);
    expect(fullChanges.modified).toEqual([
      { path: '/a.md', hash: await sha256Hex('aaaa'), size: 4 },
    ]);
  });

  it('never stat-skips tombstones or folder placeholders (resurrects always surface)', async () => {
    // Frozen clock: the resurrect rewrite lands on the SAME mtime the entry
    // recorded — the adversarial case the tombstone guard must survive.
    const storage = new InMemoryStorageAdapter({ '/gone.md': 'x' }, { now: () => 5000 });
    const legacy = await cleanIndex(storage);
    const index: LocalIndex = {
      '/gone.md': { ...legacy['/gone.md']!, deletedAt: 5, mtime: (await storage.listFiles())[0]!.mtime },
    };
    await storage.deleteFile('/gone.md');
    await storage.writeFile('/gone.md', enc('x')); // resurrect, mtime identical to the record

    const counter = countingHash();
    const changes = await scanVault(storage, index, SETTINGS, NOW, { hash: counter.hash });
    expect(counter.count()).toBe(1);
    expect(changes.modified).toEqual([{ path: '/gone.md', hash: await sha256Hex('x'), size: 1 }]);
  });

  it('a rename still hashes the file at its new path (correlation needs the hash)', async () => {
    const storage = new InMemoryStorageAdapter({ '/a.md': 'alpha' });
    const { index } = await scanAndRecord(storage, await cleanIndex(storage), countingHash().hash);
    await storage.renameFile('/a.md', '/moved.md');

    const counter = countingHash();
    const changes = await scanVault(storage, index, SETTINGS, NOW, { hash: counter.hash });
    expect(counter.count()).toBe(1); // /moved.md looks added ⇒ hashed; /a.md is gone
    expect(changes.renamed).toEqual([
      { from: '/a.md', to: '/moved.md', hash: await sha256Hex('alpha'), size: 5 },
    ]);
  });
});

describe('recordHashedFiles', () => {
  it('caches the observed mtime only on entries whose hash still matches', async () => {
    const storage = new InMemoryStorageAdapter({ '/a.md': 'a', '/b.md': 'b' });
    const index = await cleanIndex(storage);
    const stats = await storage.listFiles();
    const observations = [
      { path: '/a.md', hash: index['/a.md']!.hash, size: 1, mtime: stats.find((f) => f.path === '/a.md')!.mtime },
      // hash drifts from the entry (e.g. a pull overwrote the path mid-cycle)
      { path: '/b.md', hash: await sha256Hex('not-what-the-entry-says'), size: 1, mtime: 999 },
    ];

    const next = recordHashedFiles(index, observations);
    expect(next['/a.md']!.mtime).toBe(stats.find((f) => f.path === '/a.md')!.mtime);
    expect(next['/b.md']!.mtime).toBeUndefined(); // untouched — hash mismatch
    expect(next['/b.md']!.hash).toBe(index['/b.md']!.hash);
  });

  it('skips tombstones and folder placeholders, and is pure', async () => {
    const storage = new InMemoryStorageAdapter({ '/a.md': 'a' });
    const index: LocalIndex = {
      '/a.md': { hash: await sha256Hex('a'), size: 1, versionId: 'v', clock: { counter: 1, deviceId: 'dev' }, deletedAt: 7 },
      '/empty': { hash: '', size: 0, versionId: 'vf', clock: { counter: 1, deviceId: 'dev' }, isFolder: true },
    };
    const before = JSON.stringify(index);
    const next = recordHashedFiles(index, [
      { path: '/a.md', hash: await sha256Hex('a'), size: 1, mtime: 42 },
      { path: '/empty', hash: '', size: 0, mtime: 42 },
    ]);
    expect(next['/a.md']!.mtime).toBeUndefined();
    expect(next['/empty']!.mtime).toBeUndefined();
    expect(JSON.stringify(index)).toBe(before); // input never mutated
  });
});

describe('scanVault — symlink policy', () => {
  /** An adapter view that reports `links` from the optional symlink seam. */
  function withSymlinks(
    storage: InMemoryStorageAdapter,
    links: readonly string[],
  ): InMemoryStorageAdapter {
    return new Proxy(storage, {
      get(target, prop, receiver) {
        if (prop === 'listSymlinks') return async () => links;
        return Reflect.get(target, prop, receiver);
      },
    });
  }

  it('surfaces detected links, sorted; ignored link paths stay hidden', async () => {
    const storage = withSymlinks(
      new InMemoryStorageAdapter({ '/a.md': 'a' }),
      ['/z-link', '/media', '/.trash/ignored-link'],
    );
    const changes = await scanVault(storage, {}, SETTINGS, NOW);
    expect(changes.symlinks).toEqual(['/media', '/z-link']); // .trash link filtered
  });

  it('omits the bucket entirely when the adapter cannot detect links', async () => {
    const storage = new InMemoryStorageAdapter({ '/a.md': 'a' });
    const changes = await scanVault(storage, {}, SETTINGS, NOW);
    expect('symlinks' in changes).toBe(false);
  });

  it('protects live file entries beneath a symlinked dir from deletion inference', async () => {
    // The link occludes /media from listFiles: without protection every
    // entry beneath it would look user-deleted (the mount-drop shape).
    const storage = withSymlinks(new InMemoryStorageAdapter({ '/keep.md': 'k' }), ['/media']);
    const index = await indexFrom({
      '/media/a.md': { content: 'a' },
      '/media/deep/b.md': { content: 'b' },
      '/keep.md': { content: 'k' },
    });
    const changes = await scanVault(storage, index, SETTINGS, NOW);
    expect(changes.deleted).toEqual([]);
    expect(changes.symlinks).toEqual(['/media']);
  });

  it('protects a file entry AT the exact link path (link points at a file)', async () => {
    const storage = withSymlinks(new InMemoryStorageAdapter({}), ['/report.pdf']);
    const index = await indexFrom({ '/report.pdf': { content: 'pdf' } });
    const changes = await scanVault(storage, index, SETTINGS, NOW);
    expect(changes.deleted).toEqual([]);
    expect(changes.symlinks).toEqual(['/report.pdf']);
  });

  it('still infers deletions for entries NOT beneath a link', async () => {
    const storage = withSymlinks(new InMemoryStorageAdapter({}), ['/media']);
    const index = await indexFrom({
      '/media/a.md': { content: 'a' },
      '/gone.md': { content: 'g' },
    });
    const changes = await scanVault(storage, index, SETTINGS, NOW);
    expect(changes.deleted.map((d) => d.path)).toEqual(['/gone.md']);
  });

  it('protects folder placeholders beneath a link from folder-deletion inference', async () => {
    const storage = withSymlinks(new InMemoryStorageAdapter({}), ['/media']);
    const index = await indexFrom({
      '/media': { content: '', isFolder: true },
      '/media/a.md': { content: 'a' },
    });
    const changes = await scanVault(storage, index, SETTINGS, NOW);
    expect(changes.folderDeletions).toEqual([]);
  });
});
