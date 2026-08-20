/**
 * NodeStorageAdapter against real temp directories (fs.mkdtemp). Covers the
 * full `StorageAdapter` contract the engine relies on: atomic overwrite,
 * nested creation, idempotent delete, sorted recursive listings, path
 * mapping both ways.
 */

import { describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
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
