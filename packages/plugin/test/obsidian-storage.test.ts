import { describe, expect, it } from 'vitest';
import { ObsidianStorageAdapter } from '../src/adapters/obsidian-storage.js';
import { FakeDataAdapter, FakeVault } from './helpers/fake-vault.js';
import type { DataAdapter } from 'obsidian';

function makeStorage(adapter: FakeDataAdapter): ObsidianStorageAdapter {
  return new ObsidianStorageAdapter({ adapter: adapter as unknown as DataAdapter });
}

const bytes = (...values: number[]) => new Uint8Array(values);

describe('ObsidianStorageAdapter', () => {
  it('round-trips file content through vault paths (binary-safe)', async () => {
    const adapter = new FakeDataAdapter();
    const storage = makeStorage(adapter);

    const content = new TextEncoder().encode('héllo ## markdown\n');
    await storage.writeFile('/notes/project/idea.md', content);
    await storage.writeFile('/bin.dat', bytes(0, 1, 2, 255, 0, 128));

    expect(new TextDecoder().decode(await storage.readFile('/notes/project/idea.md'))).toBe(
      'héllo ## markdown\n',
    );
    expect(Array.from(await storage.readFile('/bin.dat'))).toEqual([0, 1, 2, 255, 0, 128]);
  });

  it('reads files seeded through the vault adapter (path normalization)', async () => {
    const adapter = new FakeDataAdapter({ 'notes/todo.md': 'x' });
    const storage = makeStorage(adapter);
    expect(new TextDecoder().decode(await storage.readFile('notes/todo.md'))).toBe('x');
    await expect(storage.readFile('/missing.md')).rejects.toThrow();
  });

  it('exists() answers for files, folders, and the root', async () => {
    const adapter = new FakeDataAdapter({ 'a/b.md': 'x' });
    const storage = makeStorage(adapter);
    expect(await storage.exists('/a/b.md')).toBe(true);
    expect(await storage.exists('/a')).toBe(true);
    expect(await storage.exists('/')).toBe(true);
    expect(await storage.exists('/nope.md')).toBe(false);
  });

  it('writes atomically: temp file in the ignored state dir, renamed onto the target, no leftovers', async () => {
    const adapter = new FakeDataAdapter();
    const storage = makeStorage(adapter);

    await storage.writeFile('/notes/a.md', new TextEncoder().encode('v1'));
    await storage.writeFile('/notes/a.md', new TextEncoder().encode('v2'));

    expect(new TextDecoder().decode(await storage.readFile('/notes/a.md'))).toBe('v2');
    // No temp file leaked next to the target…
    expect([...adapter.files.keys()].filter((p) => p.includes('.tmp'))).toEqual([]);
    // …and the only temp artifacts live under .vaultsyncforagents/tmp.
    const temps = [...adapter.files.keys()].filter((p) => p.startsWith('.vaultsyncforagents/tmp/'));
    expect(temps).toEqual([]);
  });

  it('falls back to a direct write when the adapter cannot rename (atomic fallback)', async () => {
    const adapter = new FakeDataAdapter();
    adapter.failRename = true;
    const storage = makeStorage(adapter);

    await storage.writeFile('/note.md', new TextEncoder().encode('content'));
    expect(new TextDecoder().decode(await storage.readFile('/note.md'))).toBe('content');
    // Still no stray temp files.
    expect([...adapter.files.keys()].filter((p) => p.includes('.tmp'))).toEqual([]);
  });

  it('creates parent directories implicitly on write', async () => {
    const adapter = new FakeDataAdapter();
    const storage = makeStorage(adapter);
    await storage.writeFile('/deep/nested/dir/file.md', new TextEncoder().encode('x'));
    expect(adapter.folders.has('deep/nested/dir')).toBe(true);
    expect(await storage.exists('/deep/nested/dir/file.md')).toBe(true);
  });

  it('listFiles() lists the whole tree recursively, sorted, with size and mtime', async () => {
    const adapter = new FakeDataAdapter({
      'notes/b.md': 'bbbb',
      'notes/sub/a.md': 'aa',
      'z.md': 'z',
      '.obsidian/app.json': '{}',
    });
    const storage = makeStorage(adapter);
    const files = await storage.listFiles();

    expect(files.map((f) => f.path)).toEqual([
      '/.obsidian/app.json',
      '/notes/b.md',
      '/notes/sub/a.md',
      '/z.md',
    ]);
    expect(files[1]).toMatchObject({ path: '/notes/b.md', size: 4, mtime: 1_700_000_000_000 });
    expect(files[2]).toMatchObject({ path: '/notes/sub/a.md', size: 2 });
  });

  it('listDirs() includes the root, empty folders, and nested folders, sorted', async () => {
    const adapter = new FakeDataAdapter();
    adapter.folders.add('empty');
    adapter.folders.add('a/b');
    const storage = makeStorage(adapter);

    expect(await storage.listDirs()).toEqual(['/', '/a', '/a/b', '/empty']);
  });

  it('deleteFile() is idempotent for missing paths', async () => {
    const adapter = new FakeDataAdapter({ 'gone.md': 'x' });
    const storage = makeStorage(adapter);
    await storage.deleteFile('/gone.md');
    expect(await storage.exists('/gone.md')).toBe(false);
    await expect(storage.deleteFile('/gone.md')).resolves.toBeUndefined();
  });

  it('renameFile() moves a file and creates the destination directory', async () => {
    const adapter = new FakeDataAdapter({ 'a.md': 'body' });
    const storage = makeStorage(adapter);

    await storage.renameFile('/a.md', '/new-place/b.md');
    expect(await storage.exists('/a.md')).toBe(false);
    expect(new TextDecoder().decode(await storage.readFile('/new-place/b.md'))).toBe('body');
    expect(adapter.folders.has('new-place')).toBe(true);
  });

  it('ensureDir() creates every ancestor, idempotently', async () => {
    const adapter = new FakeDataAdapter();
    const storage = makeStorage(adapter);
    await storage.ensureDir('/x/y/z');
    expect(adapter.folders.has('x')).toBe(true);
    expect(adapter.folders.has('x/y')).toBe(true);
    expect(adapter.folders.has('x/y/z')).toBe(true);
    await storage.ensureDir('/x/y/z'); // idempotent, no throw
  });

  it('removeDir() removes an EMPTY directory through the vault adapter (rmdir, non-recursive)', async () => {
    const adapter = new FakeDataAdapter();
    const storage = makeStorage(adapter);
    await storage.ensureDir('/tempfolder');

    await storage.removeDir('/tempfolder');

    expect(adapter.rmdirs).toEqual(['tempfolder']);
    expect(adapter.folders.has('tempfolder')).toBe(false);
    expect(await storage.exists('/tempfolder')).toBe(false);
  });

  it('removeDir() prefers the vault-API callback (desktop DataAdapter.rmdir refuses EVERY dir with EISDIR)', async () => {
    const adapter = new FakeDataAdapter();
    const removedByVault: string[] = [];
    const storage = new ObsidianStorageAdapter({
      adapter: adapter as unknown as DataAdapter,
      removeEmptyDir: async (adapterPath) => {
        // Mirror what plugin.ts wires: trashFile moves the TFolder out via
        // the vault API — it is NOT an adapter rmdir call (that distinction
        // is the point of this assertion), so model the trash directly.
        adapter.folders.delete(adapterPath);
        removedByVault.push(adapterPath);
      },
    });
    await storage.ensureDir('/tempfolder');

    await storage.removeDir('/tempfolder');

    expect(removedByVault).toEqual(['tempfolder']); // adapter path (no leading slash)
    expect(adapter.rmdirs).toEqual([]); // rmdir never called directly
    expect(await storage.exists('/tempfolder')).toBe(false);
  });

  it('removeDir() propagates a callback refusal (record-only in core, never data loss)', async () => {
    const adapter = new FakeDataAdapter();
    const storage = new ObsidianStorageAdapter({
      adapter: adapter as unknown as DataAdapter,
      removeEmptyDir: async () => {
        throw new Error('vault refused');
      },
    });
    await storage.ensureDir('/stubborn');
    await expect(storage.removeDir('/stubborn')).rejects.toThrow(/vault refused/);
    expect(await storage.exists('/stubborn')).toBe(true);
  });

  it('removeDir() is idempotent for missing directories', async () => {
    const adapter = new FakeDataAdapter();
    const storage = makeStorage(adapter);
    await expect(storage.removeDir('/never-was')).resolves.toBeUndefined();
    await storage.ensureDir('/gone');
    await storage.removeDir('/gone');
    await expect(storage.removeDir('/gone')).resolves.toBeUndefined(); // second time: already gone
  });

  it('removeDir() refuses (throws) on a non-empty directory — never cascades', async () => {
    const adapter = new FakeDataAdapter();
    const storage = makeStorage(adapter);
    await storage.writeFile('/full/keep.md', new TextEncoder().encode('x'));

    await expect(storage.removeDir('/full')).rejects.toThrow(/not empty/);
    // Nothing was deleted by the refused removal.
    expect(await storage.exists('/full/keep.md')).toBe(true);
    expect(await storage.exists('/full')).toBe(true);
  });

  it('removeDir() never removes the vault root', async () => {
    const adapter = new FakeDataAdapter({ 'a.md': 'x' });
    const storage = makeStorage(adapter);
    await storage.removeDir('/');
    expect(adapter.rmdirs).toEqual([]);
    expect(await storage.exists('/a.md')).toBe(true);
  });

  it('works end-to-end for the core local-index state file', async () => {
    // The exact path core persists its index to must round-trip.
    const vault = new FakeVault();
    const storage = new ObsidianStorageAdapter({
      adapter: vault.adapter as unknown as DataAdapter,
    });
    const payload = new TextEncoder().encode('{"entries":{}}');
    await storage.writeFile('/.vaultsyncforagents/state', payload);
    expect(await storage.exists('/.vaultsyncforagents/state')).toBe(true);
    expect(new TextDecoder().decode(await storage.readFile('/.vaultsyncforagents/state'))).toBe(
      '{"entries":{}}',
    );
  });
});
