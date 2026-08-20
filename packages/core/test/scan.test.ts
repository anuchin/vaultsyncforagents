import { describe, expect, it } from 'vitest';

import {
  InMemoryStorageAdapter,
  isIgnored,
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

  it('re-reports a folder whose placeholder was tombstoned (re-created folder)', async () => {
    const storage = new InMemoryStorageAdapter({ '/notes/a.md': 'alpha' });
    await storage.ensureDir('/back-again');
    const index = await indexFrom({
      '/notes/a.md': { content: 'alpha' },
      '/back-again': { content: '', isFolder: true, deletedAt: 5 },
    });

    const changes = await scanVault(storage, index, SETTINGS, NOW);
    expect(changes.emptyFolders).toEqual(['/back-again']);
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
