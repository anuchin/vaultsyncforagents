import { describe, expect, it } from 'vitest';

import { isIgnored } from '../src/index.js';

const SYNC_OFF = { obsidianSync: false };
const SYNC_ON = { obsidianSync: true };

describe('isIgnored — always-ignored entries', () => {
  it('ignores .trash anywhere in the tree', () => {
    expect(isIgnored('.trash/Note.md', SYNC_OFF)).toBe(true);
    expect(isIgnored('/.trash/deep/Note.md', SYNC_OFF)).toBe(true);
    expect(isIgnored('notes/.trash/x.md', SYNC_OFF)).toBe(true);
    expect(isIgnored('.trash', SYNC_OFF)).toBe(true);
  });

  it('ignores .DS_Store and Thumbs.db anywhere', () => {
    expect(isIgnored('.DS_Store', SYNC_OFF)).toBe(true);
    expect(isIgnored('attachments/.DS_Store', SYNC_OFF)).toBe(true);
    expect(isIgnored('Thumbs.db', SYNC_OFF)).toBe(true);
    expect(isIgnored('photos/Thumbs.db', SYNC_ON)).toBe(true);
  });

  it('ignores the client state dir .vaultsyncforagents/', () => {
    expect(isIgnored('.vaultsyncforagents/state', SYNC_OFF)).toBe(true);
    expect(isIgnored('/.vaultsyncforagents/state.db', SYNC_ON)).toBe(true);
  });

  it('matches case-insensitively (Windows/macOS filesystems)', () => {
    expect(isIgnored('.TRASH/x.md', SYNC_OFF)).toBe(true);
    expect(isIgnored('.Trash/x.md', SYNC_OFF)).toBe(true);
    expect(isIgnored('.ds_store', SYNC_OFF)).toBe(true);
    expect(isIgnored('thumbs.DB', SYNC_OFF)).toBe(true);
  });
});

describe('isIgnored — .obsidian/ policy (FR-11)', () => {
  it('ignores all of .obsidian/ when sync is off (the default)', () => {
    expect(isIgnored('.obsidian/app.json', SYNC_OFF)).toBe(true);
    expect(isIgnored('.obsidian/plugins/hotkeys/plugin.js', SYNC_OFF)).toBe(true);
    expect(isIgnored('.obsidian', SYNC_OFF)).toBe(true);
  });

  it('syncs regular .obsidian files when opted in', () => {
    expect(isIgnored('.obsidian/app.json', SYNC_ON)).toBe(false);
    expect(isIgnored('.obsidian/plugins/hotkeys/plugin.js', SYNC_ON)).toBe(false);
    expect(isIgnored('.obsidian/snippets/theme.css', SYNC_ON)).toBe(false);
  });

  it('still ignores volatile workspace files when opted in', () => {
    expect(isIgnored('.obsidian/workspace.json', SYNC_ON)).toBe(true);
    expect(isIgnored('.obsidian/workspace-mobile.json', SYNC_ON)).toBe(true);
    expect(isIgnored('.obsidian/workspace.json', SYNC_OFF)).toBe(true);
  });

  it('still ignores the cache dir when opted in', () => {
    expect(isIgnored('.obsidian/cache', SYNC_ON)).toBe(true);
    expect(isIgnored('.obsidian/cache/some-cache-file', SYNC_ON)).toBe(true);
    expect(isIgnored('.obsidian/cache/deep/x.json', SYNC_ON)).toBe(true);
  });
});

describe('isIgnored — ordinary content is never ignored', () => {
  it('keeps notes and attachments', () => {
    expect(isIgnored('notes/todo.md', SYNC_OFF)).toBe(false);
    expect(isIgnored('/notes/sub/deep note.md', SYNC_ON)).toBe(false);
    expect(isIgnored('attachments/img 2026.png', SYNC_OFF)).toBe(false);
    expect(isIgnored('trash-notes/keep.md', SYNC_OFF)).toBe(false); // prefix ≠ segment
    expect(isIgnored('my.obsidian/file.md', SYNC_OFF)).toBe(false); // not the real dir
  });

  it('does not ignore the vault root itself', () => {
    expect(isIgnored('/', SYNC_OFF)).toBe(false);
  });

  it('propagates invalid-path errors', () => {
    expect(() => isIgnored('../escape.md', SYNC_OFF)).toThrow();
  });
});
