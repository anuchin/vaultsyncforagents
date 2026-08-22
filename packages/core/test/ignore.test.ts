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

  it('NEVER syncs plugin data.json — plugin credentials — even when opted in', () => {
    // This plugin's own device token lives in
    // `.obsidian/plugins/vaultsyncforagents/data.json`; other plugins keep
    // their secrets the same place. None of that may travel through sync.
    expect(isIgnored('.obsidian/plugins/vaultsyncforagents/data.json', SYNC_ON)).toBe(true);
    expect(isIgnored('.obsidian/plugins/any-plugin/data.json', SYNC_ON)).toBe(true);
    expect(isIgnored('.obsidian/plugins/nested/plugin/data.json', SYNC_ON)).toBe(true);
    expect(isIgnored('.obsidian/Plugins/Some-Plugin/Data.json', SYNC_ON)).toBe(true);
    // Plugin code and other files still sync under the opt-in…
    expect(isIgnored('.obsidian/plugins/hotkeys/main.js', SYNC_ON)).toBe(false);
    // …and a stray data.json directly under plugins/ is not a plugin config.
    expect(isIgnored('.obsidian/plugins/data.json', SYNC_ON)).toBe(false);
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

describe('isIgnored — extraIgnores patterns (glob-lite)', () => {
  const withExtras = (patterns: readonly string[]) => ({
    obsidianSync: false,
    extraIgnores: patterns,
  });

  it('dir/** excludes a folder and everything beneath it', () => {
    const settings = withExtras(['private/**']);
    expect(isIgnored('private/secret.md', settings)).toBe(true);
    expect(isIgnored('/private/deep/nested/x.md', settings)).toBe(true);
    expect(isIgnored('private', settings)).toBe(true); // the folder itself
    expect(isIgnored('private/notes', settings)).toBe(true);
  });

  it('a bare name pattern matches file names at any depth', () => {
    const settings = withExtras(['*.tmp']);
    expect(isIgnored('scratch.tmp', settings)).toBe(true);
    expect(isIgnored('notes/deep/draft.tmp', settings)).toBe(true);
    expect(isIgnored('scratch.tmpx', settings)).toBe(false); // must anchor the name
    expect(isIgnored('tmp', settings)).toBe(false); // literal 'tmp' alone
  });

  it('patterns containing / are anchored at the vault root', () => {
    const settings = withExtras(['notes/*.md']);
    expect(isIgnored('notes/a.md', settings)).toBe(true);
    expect(isIgnored('deep/notes/a.md', settings)).toBe(false); // only the root notes/
    expect(isIgnored('notes/sub/a.md', settings)).toBe(false); // * stays in one segment
  });

  it('** spans segments anywhere in the pattern', () => {
    const drafts = withExtras(['**/drafts/*.md']);
    expect(isIgnored('drafts/a.md', drafts)).toBe(true);
    expect(isIgnored('projects/x/drafts/a.md', drafts)).toBe(true);
    expect(isIgnored('projects/x/notes/a.md', drafts)).toBe(false);

    const mid = withExtras(['a/**/b.md']);
    expect(isIgnored('a/b.md', mid)).toBe(true); // ** may consume zero segments
    expect(isIgnored('a/x/y/b.md', mid)).toBe(true);
    expect(isIgnored('x/a/b.md', mid)).toBe(false); // anchored
  });

  it('matches case-insensitively and tolerates slashes and blanks', () => {
    const settings = withExtras(['  Private/**  ', '', '   ', '/Drafts/*.MD']);
    expect(isIgnored('/PRIVATE/secret.md', settings)).toBe(true);
    expect(isIgnored('drafts/Note.md', settings)).toBe(true);
  });

  it('combines with the built-in rules (either can exclude)', () => {
    const settings = { obsidianSync: true, extraIgnores: ['secrets/**'] };
    expect(isIgnored('.obsidian/workspace.json', settings)).toBe(true); // built-in wins
    expect(isIgnored('secrets/key.txt', settings)).toBe(true); // extra wins
    expect(isIgnored('notes/plain.md', settings)).toBe(false);
  });

  it('an empty or absent list changes nothing', () => {
    expect(isIgnored('private/x.md', withExtras([]))).toBe(false);
    expect(isIgnored('private/x.md', SYNC_OFF)).toBe(false);
  });
});
