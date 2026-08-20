import { describe, expect, it } from 'vitest';

import { InMemoryStorageAdapter } from '../src/index.js';

function text(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function seeded(): InMemoryStorageAdapter {
  let tick = 1000;
  const adapter = new InMemoryStorageAdapter(
    { '/notes/a.md': 'alpha', '/notes/b.md': 'beta', 'attachments\\logo.png': new Uint8Array([0, 1, 2, 3]) },
    { now: () => (tick += 10) },
  );
  return adapter;
}

describe('InMemoryStorageAdapter — write/read/exists', () => {
  it('round-trips text and binary content, including nested dirs', async () => {
    const adapter = new InMemoryStorageAdapter();
    await adapter.writeFile('/notes/deep/sub/note.md', new TextEncoder().encode('hello'));
    const bytes = new Uint8Array(256);
    for (let i = 0; i < bytes.length; i++) bytes[i] = 255 - i;
    await adapter.writeFile('/attachments/blob.bin', bytes);

    expect(text(await adapter.readFile('/notes/deep/sub/note.md'))).toBe('hello');
    expect([...(await adapter.readFile('/attachments/blob.bin'))]).toEqual([...bytes]);
    expect(await adapter.exists('/notes/deep/sub/note.md')).toBe(true);
    expect(await adapter.exists('/notes/deep')).toBe(true); // implicit dirs exist
    expect(await adapter.exists('/notes/missing.md')).toBe(false);
    expect(await adapter.exists('/')).toBe(true);
  });

  it('normalizes paths on the way in', async () => {
    const adapter = new InMemoryStorageAdapter();
    await adapter.writeFile('notes\\win.md', new TextEncoder().encode('x'));
    expect(text(await adapter.readFile('/notes/win.md'))).toBe('x');
    expect(text(await adapter.readFile('notes\\win.md'))).toBe('x');
  });

  it('rejects invalid paths', async () => {
    const adapter = new InMemoryStorageAdapter();
    await expect(adapter.writeFile('../escape.md', new Uint8Array(0))).rejects.toThrow();
    await expect(adapter.writeFile('C:/abs.md', new Uint8Array(0))).rejects.toThrow();
  });

  it('readFile of a missing file throws', async () => {
    const adapter = new InMemoryStorageAdapter();
    await expect(adapter.readFile('/nope.md')).rejects.toThrow(/not found/i);
  });

  it('copies data in and out (no aliasing)', async () => {
    const adapter = new InMemoryStorageAdapter();
    const source = new Uint8Array([1, 2, 3]);
    await adapter.writeFile('/a.md', source);
    source[0] = 99; // caller mutates after write — must not leak in
    expect([...(await adapter.readFile('/a.md'))]).toEqual([1, 2, 3]);

    const read1 = await adapter.readFile('/a.md');
    read1[0] = 99; // caller mutates the returned buffer — must not leak in
    expect([...(await adapter.readFile('/a.md'))]).toEqual([1, 2, 3]);
  });
});

describe('InMemoryStorageAdapter — listFiles', () => {
  it('lists recursively, sorted, with size and mtime', async () => {
    const adapter = seeded();
    const files = await adapter.listFiles();
    expect(files.map((f) => f.path)).toEqual([
      '/attachments/logo.png',
      '/notes/a.md',
      '/notes/b.md',
    ]);
    expect(files[0]).toMatchObject({ size: 4 });
    expect(files[1]).toMatchObject({ size: 5 });
    expect(files[2]).toMatchObject({ size: 4 });
    expect(files[1]!.mtime).toBeGreaterThan(0);
  });

  it('update via writeFile refreshes size and mtime', async () => {
    let tick = 0;
    const adapter = new InMemoryStorageAdapter({}, { now: () => (tick += 100) });
    await adapter.writeFile('/x.md', new TextEncoder().encode('a'));
    const before = (await adapter.listFiles())[0]!;
    await adapter.writeFile('/x.md', new TextEncoder().encode('longer content'));
    const after = (await adapter.listFiles())[0]!;
    expect(after.size).toBe(new TextEncoder().encode('longer content').byteLength);
    expect(after.mtime).toBeGreaterThan(before.mtime);
  });
});

describe('InMemoryStorageAdapter — delete', () => {
  it('removes files and is idempotent', async () => {
    const adapter = seeded();
    await adapter.deleteFile('/notes/a.md');
    expect(await adapter.exists('/notes/a.md')).toBe(false);
    await expect(adapter.deleteFile('/notes/a.md')).resolves.toBeUndefined();
  });

  it('deleting a file keeps its (possibly empty) directory present', async () => {
    const adapter = new InMemoryStorageAdapter();
    await adapter.writeFile('/solo/only.md', new Uint8Array(0));
    await adapter.deleteFile('/solo/only.md');
    expect(await adapter.exists('/solo')).toBe(true);
  });
});

describe('InMemoryStorageAdapter — rename', () => {
  it('moves content and preserves mtime', async () => {
    const adapter = seeded();
    const before = (await adapter.listFiles()).find((f) => f.path === '/notes/a.md')!;
    await adapter.renameFile('/notes/a.md', '/renamed/a-moved.md');
    expect(await adapter.exists('/notes/a.md')).toBe(false);
    expect(text(await adapter.readFile('/renamed/a-moved.md'))).toBe('alpha');
    const after = (await adapter.listFiles()).find((f) => f.path === '/renamed/a-moved.md')!;
    expect(after.mtime).toBe(before.mtime);
  });

  it('throws when the source is missing', async () => {
    const adapter = new InMemoryStorageAdapter();
    await expect(adapter.renameFile('/nope.md', '/x.md')).rejects.toThrow(/not found/i);
  });

  it('overwrites an existing destination', async () => {
    const adapter = seeded();
    await adapter.renameFile('/notes/a.md', '/notes/b.md');
    expect(await adapter.exists('/notes/a.md')).toBe(false);
    expect(text(await adapter.readFile('/notes/b.md'))).toBe('alpha');
  });
});

describe('InMemoryStorageAdapter — ensureDir', () => {
  it('creates directories (and ancestors), idempotently', async () => {
    const adapter = new InMemoryStorageAdapter();
    await adapter.ensureDir('/empty/folder');
    expect(await adapter.exists('/empty/folder')).toBe(true);
    expect(await adapter.exists('/empty')).toBe(true);
    await expect(adapter.ensureDir('/empty/folder')).resolves.toBeUndefined();
    await expect(adapter.ensureDir('/')).resolves.toBeUndefined();
  });

  it('empty dirs are not listed by listFiles (files only)', async () => {
    const adapter = new InMemoryStorageAdapter();
    await adapter.ensureDir('/placeholder');
    expect(await adapter.listFiles()).toEqual([]);
  });
});

describe('InMemoryStorageAdapter — constructor seeding', () => {
  it('accepts strings and byte arrays with mixed path styles', async () => {
    const adapter = seeded();
    expect(text(await adapter.readFile('/notes/b.md'))).toBe('beta');
    expect([...(await adapter.readFile('/attachments/logo.png'))]).toEqual([0, 1, 2, 3]);
  });
});

describe('InMemoryStorageAdapter — interface completeness', () => {
  it('satisfies StorageAdapter', async () => {
    const adapter: InMemoryStorageAdapter = seeded();
    // Exercise every method once through the interface surface.
    await adapter.ensureDir('/d');
    await adapter.writeFile('/d/f.md', new Uint8Array([9]));
    expect(await adapter.exists('/d/f.md')).toBe(true);
    expect((await adapter.readFile('/d/f.md')).byteLength).toBe(1);
    await adapter.renameFile('/d/f.md', '/d/g.md');
    expect((await adapter.listFiles()).map((f) => f.path)).toContain('/d/g.md');
    await adapter.deleteFile('/d/g.md');
    expect(await adapter.exists('/d/g.md')).toBe(false);
  });
});
