/**
 * NodeStorageAdapter against real temp directories (fs.mkdtemp). Covers the
 * full `StorageAdapter` contract the engine relies on: atomic overwrite,
 * nested creation, idempotent delete, sorted recursive listings, path
 * mapping both ways.
 */

import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NodeStorageAdapter } from '../src/storage.js';
import { writeDeviceMarker } from '../src/device.js';

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);

async function tempRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'vsa-storage-'));
}

describe('NodeStorageAdapter', () => {
  it('requires an absolute root', () => {
    expect(() => new NodeStorageAdapter({ root: 'relative/path' })).toThrow(/absolute/);
  });

  it('writeFile creates nested dirs and readFile roundtrips bytes', async () => {
    const adapter = new NodeStorageAdapter({ root: await tempRoot() });
    await adapter.writeFile('/notes/deep/a.md', enc('hello'));
    await adapter.writeFile('/notes/deep/sub/b.md', new Uint8Array([0, 1, 254, 255]));

    expect(new TextDecoder().decode(await adapter.readFile('/notes/deep/a.md'))).toBe('hello');
    expect(Array.from(await adapter.readFile('/notes/deep/sub/b.md'))).toEqual([0, 1, 254, 255]);
  });

  it('writeFile overwrites atomically — no temp litter, readers never see partials', async () => {
    const root = await tempRoot();
    const adapter = new NodeStorageAdapter({ root });
    await adapter.writeFile('/a.md', enc('v1'));
    await adapter.writeFile('/a.md', enc('v2-longer'));

    expect(new TextDecoder().decode(await adapter.readFile('/a.md'))).toBe('v2-longer');
    const entries = await readdir(root);
    expect(entries).toEqual(['a.md']); // no .tmp-* left behind
  });

  it('writeFile on the vault root state path lands inside the vault', async () => {
    const root = await tempRoot();
    const adapter = new NodeStorageAdapter({ root });
    await writeDeviceMarker(adapter, {
      deviceId: 'dev-1',
      deviceName: 'cli',
      url: 'https://x.example',
      linkedAt: 123,
    });
    const raw = JSON.parse(
      new TextDecoder().decode(await readFile(join(root, '.vaultsyncforagents', 'device.json'))),
    ) as Record<string, unknown>;
    expect(raw['deviceId']).toBe('dev-1');
  });

  it('deleteFile is idempotent (missing path is not an error)', async () => {
    const adapter = new NodeStorageAdapter({ root: await tempRoot() });
    await adapter.writeFile('/gone.md', enc('x'));
    await adapter.deleteFile('/gone.md');
    await expect(adapter.deleteFile('/gone.md')).resolves.toBeUndefined();
    expect(await adapter.exists('/gone.md')).toBe(false);
  });

  it('renameFile moves across directories and throws when source is missing', async () => {
    const adapter = new NodeStorageAdapter({ root: await tempRoot() });
    await adapter.writeFile('/a/one.md', enc('content'));
    await adapter.renameFile('/a/one.md', '/b/c/two.md');
    expect(new TextDecoder().decode(await adapter.readFile('/b/c/two.md'))).toBe('content');
    await expect(adapter.renameFile('/missing.md', '/x.md')).rejects.toThrow();
  });

  it('listFiles lists recursively, sorted by path, with size and mtime', async () => {
    const root = await tempRoot();
    const adapter = new NodeStorageAdapter({ root });
    await adapter.writeFile('/b.md', enc('12345'));
    await adapter.writeFile('/a/one.md', enc('1'));
    await adapter.writeFile('/a/two.md', enc('12'));

    const files = await adapter.listFiles();
    expect(files.map((f) => f.path)).toEqual(['/a/one.md', '/a/two.md', '/b.md']);
    const b = files.find((f) => f.path === '/b.md');
    expect(b?.size).toBe(5);
    expect(typeof b?.mtime).toBe('number');
    expect(b?.mtime).toBeGreaterThan(0);
  });

  it('listDirs includes the root, nested dirs, and empty folders, sorted', async () => {
    const root = await tempRoot();
    const adapter = new NodeStorageAdapter({ root });
    await adapter.writeFile('/a/b/file.md', enc('x'));
    await mkdir(join(root, 'empty'), { recursive: true });

    expect(await adapter.listDirs()).toEqual(['/', '/a', '/a/b', '/empty']);
  });

  it('listFiles/listDirs on a missing root behave as an empty vault', async () => {
    const adapter = new NodeStorageAdapter({ root: join(await tempRoot(), 'never-created') });
    expect(await adapter.listFiles()).toEqual([]);
    expect(await adapter.listDirs()).toEqual(['/']);
  });

  it('ensureDir is idempotent and creates ancestors', async () => {
    const root = await tempRoot();
    const adapter = new NodeStorageAdapter({ root });
    await adapter.ensureDir('/x/y/z');
    await adapter.ensureDir('/x/y/z');
    expect(await adapter.exists('/x/y/z')).toBe(true);
    expect(await adapter.exists('/x/y')).toBe(true);
  });

  it('removeDir removes an EMPTY directory (fs level), leaving ancestors intact', async () => {
    const root = await tempRoot();
    const adapter = new NodeStorageAdapter({ root });
    await adapter.ensureDir('/a/tempfolder');

    await adapter.removeDir('/a/tempfolder');

    const stats = await stat(join(root, 'a'));
    expect(stats.isDirectory()).toBe(true); // parent survives
    expect(await adapter.exists('/a/tempfolder')).toBe(false);
    await expect(stat(join(root, 'a', 'tempfolder'))).rejects.toThrow();
  });

  it('removeDir is idempotent for missing directories', async () => {
    const adapter = new NodeStorageAdapter({ root: await tempRoot() });
    await expect(adapter.removeDir('/never-was')).resolves.toBeUndefined();
    await adapter.ensureDir('/gone');
    await adapter.removeDir('/gone');
    await expect(adapter.removeDir('/gone')).resolves.toBeUndefined(); // already gone
  });

  it('removeDir refuses a non-empty directory without deleting anything', async () => {
    const root = await tempRoot();
    const adapter = new NodeStorageAdapter({ root });
    await adapter.writeFile('/full/keep.md', enc('precious'));

    await expect(adapter.removeDir('/full')).rejects.toThrow();

    // Nothing cascaded: content and directory both survive the refusal.
    expect(new TextDecoder().decode(await readFile(join(root, 'full', 'keep.md')))).toBe('precious');
    expect(await adapter.exists('/full')).toBe(true);
  });

  it('exists distinguishes files, dirs, and missing paths', async () => {
    const adapter = new NodeStorageAdapter({ root: await tempRoot() });
    await adapter.writeFile('/f.md', enc('x'));
    expect(await adapter.exists('/f.md')).toBe(true);
    expect(await adapter.exists('/')).toBe(true);
    expect(await adapter.exists('/nope.md')).toBe(false);
  });

  it('toHostPath/toVaultPath map both directions; backslashes normalized', async () => {
    const adapter = new NodeStorageAdapter({ root: await tempRoot() });
    // Windows-style input to the vault-path seam is normalized by core.
    await adapter.writeFile('notes\\sub\\a.md', enc('x'));
    expect(await adapter.exists('/notes/sub/a.md')).toBe(true);
    expect(adapter.toHostPath('/notes/sub/a.md')).toBe(
      join(adapter.root, 'notes', 'sub', 'a.md'),
    );
    expect(adapter.toVaultPath(join(adapter.root, 'notes', 'sub', 'a.md'))).toBe(
      '/notes/sub/a.md',
    );
    expect(adapter.toVaultPath(adapter.root)).toBe('/');
    expect(() => adapter.toVaultPath(join(adapter.root, '..', 'outside.md'))).toThrow(/outside/);
  });

  it('concurrent writes to the same path all land atomically', async () => {
    const adapter = new NodeStorageAdapter({ root: await tempRoot() });
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => adapter.writeFile('/race.md', enc(`content-${i}`))),
    );
    const text = new TextDecoder().decode(await adapter.readFile('/race.md'));
    expect(text).toMatch(/^content-\d+$/);
    const litter = (await readdir(adapter.root)).filter((name) => name.includes('.tmp-'));
    expect(litter).toEqual([]);
  });
});

/**
 * Symlink creation needs privileges on some platforms (Windows without
 * developer mode allows directory JUNCTIONS but not file symlinks), so each
 * kind gets its own probe and its own skip gate.
 */
const linkCaps = await (async (): Promise<{ file: boolean; dir: boolean }> => {
  const probe = await mkdtemp(join(tmpdir(), 'vsa-link-probe-'));
  let file = false;
  let dir = false;
  try {
    await writeFile(join(probe, 'target.txt'), 'x');
    await symlink(join(probe, 'target.txt'), join(probe, 'link.txt'), 'file');
    file = true;
  } catch { /* privileged here */ }
  try {
    await mkdir(join(probe, 'target-dir'));
    await symlink(join(probe, 'target-dir'), join(probe, 'link-dir'), 'junction');
    dir = true;
  } catch { /* privileged here */ }
  return { file, dir };
})();

describe('NodeStorageAdapter — symlinks', () => {
  it.runIf(linkCaps.file)(
    'never follows a file symlink: excluded from listings, reported by listSymlinks',
    async () => {
      const root = await tempRoot();
      const outside = await tempRoot();
      await writeFile(join(outside, 'secret.md'), 'do not sync me');
      await symlink(join(outside, 'secret.md'), join(root, 'link.md'), 'file');
      await writeFile(join(root, 'real.md'), 'sync me');

      const adapter = new NodeStorageAdapter({ root });
      expect((await adapter.listFiles()).map((f) => f.path)).toEqual(['/real.md']);
      expect(await adapter.listSymlinks()).toEqual(['/link.md']);
    },
  );

  it.runIf(linkCaps.dir)(
    'never recurses into a directory symlink: outside content stays invisible',
    async () => {
      const root = await tempRoot();
      const outside = await tempRoot();
      await mkdir(join(outside, 'deep'));
      await writeFile(join(outside, 'deep', 'secret.md'), 'outside the vault');
      await symlink(outside, join(root, 'media'), 'junction');
      await writeFile(join(root, 'real.md'), 'inside the vault');

      const adapter = new NodeStorageAdapter({ root });
      const files = (await adapter.listFiles()).map((f) => f.path);
      expect(files).toEqual(['/real.md']);
      expect(await adapter.listDirs()).toEqual(['/']);
      expect(await adapter.listSymlinks()).toEqual(['/media']);
    },
  );

  it.runIf(linkCaps.dir)('a symlink loop cannot recurse forever', async () => {
    const root = await tempRoot();
    await symlink(root, join(root, 'loop'), 'junction');
    await writeFile(join(root, 'a.md'), 'x');

    const adapter = new NodeStorageAdapter({ root });
    expect((await adapter.listFiles()).map((f) => f.path)).toEqual(['/a.md']);
    expect(await adapter.listSymlinks()).toEqual(['/loop']);
  });
});
