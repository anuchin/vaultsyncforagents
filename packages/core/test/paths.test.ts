import { describe, expect, it } from 'vitest';

import {
  InvalidVaultPathError,
  basename,
  joinPath,
  normalizeVaultPath,
  parentPath,
} from '../src/index.js';

describe('normalizeVaultPath', () => {
  it('adds the leading slash and keeps canonical form', () => {
    expect(normalizeVaultPath('a/b.md')).toBe('/a/b.md');
    expect(normalizeVaultPath('/a/b.md')).toBe('/a/b.md');
  });

  it('maps empty and bare-root inputs to "/"', () => {
    expect(normalizeVaultPath('')).toBe('/');
    expect(normalizeVaultPath('/')).toBe('/');
    expect(normalizeVaultPath('.')).toBe('/');
  });

  it('converts backslashes to slashes', () => {
    expect(normalizeVaultPath('notes\\todo.md')).toBe('/notes/todo.md');
    expect(normalizeVaultPath('\\notes\\todo.md')).toBe('/notes/todo.md');
    expect(normalizeVaultPath('a\\\\b\\c.md')).toBe('/a/b/c.md');
  });

  it('collapses duplicate and trailing slashes and "." segments', () => {
    expect(normalizeVaultPath('a//b///c.md/')).toBe('/a/b/c.md');
    expect(normalizeVaultPath('a/./b.md')).toBe('/a/b.md');
    expect(normalizeVaultPath('/./a.md')).toBe('/a.md');
  });

  it('resolves interior ".." without escaping', () => {
    expect(normalizeVaultPath('a/b/../c.md')).toBe('/a/c.md');
    expect(normalizeVaultPath('a/b/../..')).toBe('/');
  });

  it('rejects ".." escaping the root', () => {
    expect(() => normalizeVaultPath('..')).toThrow(InvalidVaultPathError);
    expect(() => normalizeVaultPath('/..')).toThrow(InvalidVaultPathError);
    expect(() => normalizeVaultPath('../a.md')).toThrow(InvalidVaultPathError);
    expect(() => normalizeVaultPath('/a/../..')).toThrow(InvalidVaultPathError);
  });

  it('rejects absolute Windows drive paths', () => {
    expect(() => normalizeVaultPath('C:/vault/a.md')).toThrow(InvalidVaultPathError);
    expect(() => normalizeVaultPath('C:\\vault\\a.md')).toThrow(InvalidVaultPathError);
    expect(() => normalizeVaultPath('z:\\vault')).toThrow(InvalidVaultPathError);
  });

  it('rejects UNC paths and leading "//"', () => {
    expect(() => normalizeVaultPath('\\\\server\\share\\a.md')).toThrow(InvalidVaultPathError);
    expect(() => normalizeVaultPath('//server/share/a.md')).toThrow(InvalidVaultPathError);
  });

  it('rejects NUL bytes', () => {
    expect(() => normalizeVaultPath('a\0b.md')).toThrow(InvalidVaultPathError);
  });

  it('is idempotent', () => {
    for (const input of ['a/b.md', '/a/./b/../c.md', 'x\\y\\z.md', '/deep/nest/']) {
      const once = normalizeVaultPath(input);
      expect(normalizeVaultPath(once)).toBe(once);
    }
  });
});

describe('joinPath', () => {
  it('joins base with parts and normalizes', () => {
    expect(joinPath('/', 'a.md')).toBe('/a.md');
    expect(joinPath('/notes', 'sub', 'b.md')).toBe('/notes/sub/b.md');
    expect(joinPath('notes', 'b.md')).toBe('/notes/b.md');
    expect(joinPath('/notes/', 'b.md')).toBe('/notes/b.md');
  });

  it('tolerates backslashes in parts', () => {
    expect(joinPath('/notes', 'sub\\b.md')).toBe('/notes/sub/b.md');
  });

  it('rejects absolute parts', () => {
    expect(() => joinPath('/a', '/b.md')).toThrow(InvalidVaultPathError);
    expect(() => joinPath('/a', '\\b.md')).toThrow(InvalidVaultPathError);
  });

  it('rejects traversal escaping the root', () => {
    expect(() => joinPath('/a', '..', '..', 'x.md')).toThrow(InvalidVaultPathError);
  });
});

describe('parentPath', () => {
  it('returns the containing directory', () => {
    expect(parentPath('/a/b.md')).toBe('/a');
    expect(parentPath('/a/b/c.md')).toBe('/a/b');
  });

  it('top-level files have the root as parent; the root is its own parent', () => {
    expect(parentPath('/a.md')).toBe('/');
    expect(parentPath('/a')).toBe('/');
    expect(parentPath('/')).toBe('/');
  });

  it('normalizes before deriving', () => {
    expect(parentPath('a\\b\\c.md')).toBe('/a/b');
    expect(parentPath('/a/b/../c.md')).toBe('/a');
    expect(parentPath('/a/b/..')).toBe('/');
  });
});

describe('basename', () => {
  it('returns the final segment', () => {
    expect(basename('/a/b.md')).toBe('b.md');
    expect(basename('a.md')).toBe('a.md');
    expect(basename('/deep/note name.md')).toBe('note name.md');
  });

  it('returns "" for the vault root', () => {
    expect(basename('/')).toBe('');
  });
});
