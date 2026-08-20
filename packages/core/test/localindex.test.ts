import { describe, expect, it } from 'vitest';

import {
  applyCommit,
  deserializeLocalIndex,
  LOCAL_INDEX_SCHEMA_VERSION,
  LOCAL_INDEX_STATE_PATH,
  ProtocolError,
  removeEntry,
  serializeLocalIndex,
  type LocalIndex,
} from '../src/index.js';

const clock = { counter: 2, deviceId: 'dev-a' };

function seeded(): LocalIndex {
  return {
    '/notes/b.md': { hash: 'bbb', size: 3, versionId: 'v2', clock },
    '/notes/a.md': { hash: 'aaa', size: 3, versionId: 'v1', clock },
  };
}

describe('applyCommit', () => {
  it('adds a new entry', () => {
    const next = applyCommit(seeded(), {
      path: '/new.md',
      versionId: 'v3',
      hash: 'ccc',
      size: 4,
      clock,
    });
    expect(next['/new.md']).toEqual({ hash: 'ccc', size: 4, versionId: 'v3', clock });
    expect(Object.keys(next)).toHaveLength(3);
  });

  it('replaces an existing entry wholesale (edit)', () => {
    const next = applyCommit(seeded(), {
      path: '/notes/a.md',
      versionId: 'v9',
      hash: 'zzz',
      size: 9,
      clock: { counter: 3, deviceId: 'dev-b' },
    });
    expect(next['/notes/a.md']).toEqual({
      hash: 'zzz',
      size: 9,
      versionId: 'v9',
      clock: { counter: 3, deviceId: 'dev-b' },
    });
  });

  it('tombstones with deletedAt and keeps the entry', () => {
    const next = applyCommit(seeded(), {
      path: '/notes/a.md',
      versionId: 'v4',
      hash: 'aaa',
      size: 3,
      clock,
      deleted: true,
      deletedAt: 123456,
    });
    expect(next['/notes/a.md']).toEqual({
      hash: 'aaa',
      size: 3,
      versionId: 'v4',
      clock,
      deletedAt: 123456,
    });
  });

  it('throws when tombstoning without deletedAt', () => {
    expect(() =>
      applyCommit(seeded(), { path: '/x.md', versionId: 'v', hash: 'h', size: 1, clock, deleted: true }),
    ).toThrow(/deletedAt/);
  });

  it('records folder placeholders (FR-10)', () => {
    const next = applyCommit(seeded(), {
      path: '/empty-dir',
      versionId: 'vf',
      hash: '',
      size: 0,
      clock,
      isFolder: true,
    });
    expect(next['/empty-dir']).toEqual({
      hash: '',
      size: 0,
      versionId: 'vf',
      clock,
      isFolder: true,
    });
  });

  it('is pure — the input index is never mutated', () => {
    const index = seeded();
    const snapshot = serializeLocalIndex(index);
    applyCommit(index, { path: '/new.md', versionId: 'v', hash: 'h', size: 1, clock });
    applyCommit(index, { path: '/notes/a.md', versionId: 'v', hash: 'h', size: 1, clock, deleted: true, deletedAt: 1 });
    expect(serializeLocalIndex(index)).toBe(snapshot);
  });
});

describe('removeEntry', () => {
  it('drops a path entirely (rename migration leaves no tombstone)', () => {
    const next = removeEntry(seeded(), '/notes/a.md');
    expect('/notes/a.md' in next).toBe(false);
    expect(next['/notes/b.md']).toBeDefined();
  });

  it('is a no-op for absent paths and never mutates the input', () => {
    const index = seeded();
    expect(removeEntry(index, '/missing.md')).toBe(index);
    expect(removeEntry(index, '/missing.md')).toEqual(index);
  });
});

describe('serializeLocalIndex / deserializeLocalIndex', () => {
  it('round-trips a full index including tombstones and folder entries', () => {
    const index: LocalIndex = {
      '/notes/z.md': { hash: 'z', size: 1, versionId: 'v1', clock },
      '/notes/a.md': { hash: 'a', size: 2, versionId: 'v2', clock, deletedAt: 99 },
      '/empty': { hash: '', size: 0, versionId: 'v3', clock, isFolder: true },
    };
    const parsed = deserializeLocalIndex(serializeLocalIndex(index));
    expect(parsed).toEqual(index);
  });

  it('wraps entries in a versioned envelope with schemaVersion', () => {
    const envelope = JSON.parse(serializeLocalIndex(seeded())) as {
      schemaVersion: number;
      entries: Record<string, unknown>;
    };
    expect(envelope.schemaVersion).toBe(LOCAL_INDEX_SCHEMA_VERSION);
    expect(Object.keys(envelope.entries)).toEqual(['/notes/a.md', '/notes/b.md']);
  });

  it('serializes deterministically: sorted keys, byte-identical repeats', () => {
    const a = serializeLocalIndex(seeded());
    const b = serializeLocalIndex({
      '/notes/a.md': { hash: 'aaa', size: 3, versionId: 'v1', clock },
      '/notes/b.md': { hash: 'bbb', size: 3, versionId: 'v2', clock },
    });
    expect(a).toBe(b);
    expect(a.indexOf('/notes/a.md')).toBeLessThan(a.indexOf('/notes/b.md'));
  });

  it('serializes the empty index', () => {
    expect(deserializeLocalIndex(serializeLocalIndex({}))).toEqual({});
  });

  it('throws ProtocolError on non-JSON input', () => {
    expect(() => deserializeLocalIndex('{nope')).toThrow(ProtocolError);
  });

  it('throws ProtocolError on a non-object root', () => {
    expect(() => deserializeLocalIndex('42')).toThrow(ProtocolError);
    expect(() => deserializeLocalIndex('null')).toThrow(ProtocolError);
  });

  it('throws ProtocolError on unsupported schema versions (old or future)', () => {
    const future = JSON.stringify({ schemaVersion: LOCAL_INDEX_SCHEMA_VERSION + 1, entries: {} });
    expect(() => deserializeLocalIndex(future)).toThrow(/not supported/);
    const past = JSON.stringify({ schemaVersion: 0, entries: {} });
    expect(() => deserializeLocalIndex(past)).toThrow(/not supported/);
  });

  it('throws ProtocolError on malformed entries', () => {
    const bad = (entries: unknown): string =>
      JSON.stringify({ schemaVersion: LOCAL_INDEX_SCHEMA_VERSION, entries });

    expect(() => deserializeLocalIndex(bad({ '/a.md': { hash: 1, size: 1, versionId: 'v', clock } }))).toThrow(ProtocolError);
    expect(() => deserializeLocalIndex(bad({ '/a.md': { hash: 'h', size: -1, versionId: 'v', clock } }))).toThrow(ProtocolError);
    expect(() => deserializeLocalIndex(bad({ '/a.md': { hash: 'h', size: 1, clock } }))).toThrow(ProtocolError);
    expect(() => deserializeLocalIndex(bad({ '/a.md': { hash: 'h', size: 1, versionId: 'v', clock: { counter: 'x', deviceId: 'd' } } }))).toThrow(ProtocolError);
    expect(() => deserializeLocalIndex(bad({ '/a.md': { hash: 'h', size: 1, versionId: 'v', clock, deletedAt: 'soon' } }))).toThrow(ProtocolError);
    expect(() => deserializeLocalIndex(bad(null))).toThrow(ProtocolError);
  });

  it('tolerates unknown extra fields (forward compatibility)', () => {
    const json = JSON.stringify({
      schemaVersion: LOCAL_INDEX_SCHEMA_VERSION,
      futureTopLevel: true,
      entries: {
        '/a.md': { hash: 'h', size: 1, versionId: 'v', clock, someFutureField: 'x' },
      },
    });
    expect(deserializeLocalIndex(json)).toEqual({
      '/a.md': { hash: 'h', size: 1, versionId: 'v', clock },
    });
  });
});

describe('constants', () => {
  it('LOCAL_INDEX_STATE_PATH lives inside the sync-ignored state dir', () => {
    expect(LOCAL_INDEX_STATE_PATH).toBe('/.vaultsyncforagents/state');
  });
});
