import { mkdtemp, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyPull, scanVault, sha256Hex, type LocalIndex } from '@vsa/core';
import { NodeStorageAdapter } from '../src/storage.js';

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof fs>();
  return { ...actual, readdir: vi.fn(actual.readdir), stat: vi.fn(actual.stat) };
});
afterEach(() => vi.clearAllMocks());
const bytes = new TextEncoder().encode('keep');
const index: LocalIndex = {
  '/blocked/keep.md': { hash: 'a'.repeat(64), size: 4, versionId: 'v1', clock: { counter: 1, deviceId: 'other' } },
};

describe('storage scan safety', () => {
  it('aborts an unreadable subtree instead of inferring deletions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vsa-scan-safety-'));
    const blocked = join(root, 'blocked');
    await mkdir(blocked);
    await writeFile(join(blocked, 'keep.md'), bytes);
    const real = await vi.importActual<typeof fs>('node:fs/promises');
    vi.mocked(fs.readdir).mockImplementation(async (...args: Parameters<typeof fs.readdir>) => {
      if (args[0] === blocked) throw Object.assign(new Error('permission denied'), { code: 'EACCES' });
      return real.readdir(...args);
    });
    try {
      await expect(scanVault(new NodeStorageAdapter(root), index, { obsidianSync: false }, 0)).rejects.toThrow('permission denied');
    } finally { vi.mocked(fs.readdir).mockImplementation(real.readdir); }
  });

  it('aborts a stat error instead of dropping an existing file from the inventory', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vsa-stat-safety-'));
    await writeFile(join(root, 'keep.md'), bytes);
    vi.mocked(fs.stat).mockRejectedValueOnce(Object.assign(new Error('I/O failure'), { code: 'EIO' }));
    await expect(new NodeStorageAdapter(root).listFiles()).rejects.toThrow('I/O failure');
  });

  it('refuses a missing root rather than returning an empty scan', async () => {
    const root = join(await mkdtemp(join(tmpdir(), 'vsa-missing-safety-')), 'missing');
    await expect(scanVault(new NodeStorageAdapter(root), index, { obsidianSync: false }, 0)).rejects.toThrow();
  });

  it('propagates an existence-check I/O error instead of reporting absence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vsa-exists-safety-'));
    await writeFile(join(root, 'keep.md'), bytes);
    vi.mocked(fs.stat).mockRejectedValueOnce(Object.assign(new Error('I/O failure'), { code: 'EIO' }));
    await expect(new NodeStorageAdapter(root).exists('/keep.md')).rejects.toThrow('I/O failure');
  });
});

describe('storage path containment', () => {
  it('blocks an incoming remote pull through a junction', async () => {
    const base = await mkdtemp(join(tmpdir(), 'vsa-pull-containment-'));
    const root = join(base, 'vault');
    const outside = join(base, 'outside');
    await mkdir(root);
    await mkdir(outside);
    await symlink(outside, join(root, 'linked'), 'junction');
    await expect(applyPull(new NodeStorageAdapter(root), {}, {
      pushes: [], conflicts: [], folderPushes: [],
      pulls: [{ kind: 'add', path: '/linked/remote.md', hash: await sha256Hex(bytes), size: bytes.length, version: 'v1', clock: { counter: 1, deviceId: 'remote' }, deleted: false }],
    }, async () => bytes, { now: 0 })).rejects.toThrow(/link/i);
    expect(await fs.readdir(outside)).toEqual([]);
  });

  it('refuses a vault root that was replaced by a junction', async () => {
    const base = await mkdtemp(join(tmpdir(), 'vsa-root-containment-'));
    const root = join(base, 'vault');
    const outside = join(base, 'outside');
    const storage = new NodeStorageAdapter(root);
    await mkdir(outside);
    await symlink(outside, root, 'junction');
    await expect(storage.listFiles()).rejects.toThrow(/link/i);
    await expect(storage.writeFile('/remote.md', bytes)).rejects.toThrow(/link/i);
    expect(await fs.readdir(outside)).toEqual([]);
  });

  it('rejects every operation through a directory junction, leaving outside bytes intact', async () => {
    const base = await mkdtemp(join(tmpdir(), 'vsa-containment-'));
    const root = join(base, 'vault');
    const outside = join(base, 'outside');
    await mkdir(root); await mkdir(outside);
    await writeFile(join(outside, 'keep.md'), bytes);
    await symlink(outside, join(root, 'linked'), 'junction');
    const storage = new NodeStorageAdapter(root);
    await writeFile(join(root, 'local.md'), bytes);
    for (const operation of [
      () => storage.readFile('/linked/keep.md'),
      () => storage.writeFile('/linked/new.md', bytes),
      () => storage.deleteFile('/linked/keep.md'),
      () => storage.renameFile('/linked/keep.md', '/stolen.md'),
      () => storage.renameFile('/local.md', '/linked/moved.md'),
      () => storage.ensureDir('/linked/new-dir'),
      () => storage.removeDir('/linked'),
      () => storage.exists('/linked/keep.md'),
    ]) await expect(operation()).rejects.toThrow(/link/i);
    expect(await readFile(join(outside, 'keep.md'))).toEqual(Buffer.from(bytes));
    expect(await fs.readdir(outside)).toEqual(['keep.md']);
    expect(await storage.exists('/local.md')).toBe(true);
  });
});
