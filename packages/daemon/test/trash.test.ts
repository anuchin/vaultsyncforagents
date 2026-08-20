/**
 * FR-42 remote-delete trash behavior (with the documented deviation):
 * differing local content is rescued to `/.trash/<UTC-timestamp>-<basename>`,
 * identical-to-index content is deleted without a redundant copy, unknown
 * state conservatively copies, and the safety copy failure aborts the delete.
 */

import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  applyCommit,
  serializeLocalIndex,
  sha256Hex,
  LOCAL_INDEX_STATE_PATH,
  type LocalIndex,
} from '@vsa/core';
import { NodeStorageAdapter } from '@vsa/node-runtime';
import { TrashGuardStorage, TRASH_DIR_PATH, formatTrashTimestamp } from '../src/trash.js';

const FIXED_NOW = Date.UTC(2026, 7, 20, 14, 23, 15, 123); // 2026-08-20T14:23:15.123Z

async function makeVault(seed: { path: string; content: string }[] = []): Promise<{
  trash: TrashGuardStorage;
  raw: NodeStorageAdapter;
  index(index: LocalIndex): Promise<void>;
}> {
  const root = await mkdtemp(join(tmpdir(), 'vsa-daemon-trash-'));
  const raw = new NodeStorageAdapter({ root });
  const trash = new TrashGuardStorage({ storage: raw, now: () => FIXED_NOW });
  for (const file of seed) {
    await raw.writeFile(file.path, new TextEncoder().encode(file.content));
  }
  return {
    trash,
    raw,
    async index(index) {
      await raw.writeFile(
        LOCAL_INDEX_STATE_PATH,
        new TextEncoder().encode(serializeLocalIndex(index)),
      );
    },
  };
}

async function hashOf(content: string): Promise<string> {
  return sha256Hex(new TextEncoder().encode(content));
}

async function trashEntries(raw: NodeStorageAdapter): Promise<string[]> {
  try {
    return (await readdir(join(raw.root, '.trash'))).sort();
  } catch {
    return [];
  }
}

function entry(hash: string): Parameters<typeof applyCommit>[1] {
  return {
    path: '/note.md',
    versionId: 'v1',
    hash,
    size: 3,
    clock: { counter: 1, deviceId: 'dev-other' },
  };
}

describe('TrashGuardStorage.deleteFile (remote-delete path)', () => {
  it('rescues diverged local content to .trash/<timestamp>-<basename> before deleting', async () => {
    const synced = 'v1\n';
    const vault = await makeVault([{ path: '/note.md', content: synced }]);
    await vault.index(applyCommit({}, entry(await hashOf(synced))));
    // An agent edits locally; before that edit syncs, a remote tombstone arrives.
    await vault.raw.writeFile('/note.md', new TextEncoder().encode('unsynced agent edit'));

    await vault.trash.deleteFile('/note.md');

    const expected = `${formatTrashTimestamp(FIXED_NOW)}-note.md`;
    expect(await trashEntries(vault.raw)).toEqual([expected]);
    const rescued = await vault.raw.readFile(`${TRASH_DIR_PATH}/${expected}`);
    expect(new TextDecoder().decode(rescued)).toBe('unsynced agent edit');
    await expect(vault.raw.readFile('/note.md')).rejects.toThrow();
  });

  it('deletes WITHOUT a .trash copy when local content is identical to the last-synced hash', async () => {
    const synced = 'v1\n';
    const vault = await makeVault([{ path: '/note.md', content: synced }]);
    await vault.index(applyCommit({}, entry(await hashOf(synced))));

    await vault.trash.deleteFile('/note.md');

    expect(await trashEntries(vault.raw)).toEqual([]);
    await expect(vault.raw.readFile('/note.md')).rejects.toThrow();
  });

  it('copies conservatively when there is no readable local index', async () => {
    const vault = await makeVault([{ path: '/note.md', content: 'unknown state' }]);
    await vault.trash.deleteFile('/note.md');
    const entries = await trashEntries(vault.raw);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatch(/-note\.md$/);
  });

  it('copies when the index entry is itself a tombstone (local file over a tombstone)', async () => {
    const content = 'recreated';
    const vault = await makeVault([{ path: '/note.md', content }]);
    await vault.index(
      applyCommit(
        {},
        { ...entry(await hashOf('old')), deleted: true, deletedAt: FIXED_NOW - 1000 },
      ),
    );
    await vault.trash.deleteFile('/note.md');
    expect(await trashEntries(vault.raw)).toHaveLength(1);
  });

  it('is idempotent for missing files (no trash, no error)', async () => {
    const vault = await makeVault();
    await expect(vault.trash.deleteFile('/gone.md')).resolves.toBeUndefined();
    expect(await trashEntries(vault.raw)).toEqual([]);
  });

  it('never trashes the sync state file itself', async () => {
    const vault = await makeVault();
    await vault.raw.writeFile(LOCAL_INDEX_STATE_PATH, new TextEncoder().encode('{}'));
    await vault.trash.deleteFile(LOCAL_INDEX_STATE_PATH);
    expect(await trashEntries(vault.raw)).toEqual([]);
  });

  it('suffixes -2, -3… on same-timestamp basename collisions', async () => {
    const vault = await makeVault([
      { path: '/a/note.md', content: 'one' },
      { path: '/b/note.md', content: 'two' },
    ]);
    await vault.trash.deleteFile('/a/note.md');
    await vault.trash.deleteFile('/b/note.md');

    const stamp = formatTrashTimestamp(FIXED_NOW);
    expect(await trashEntries(vault.raw)).toEqual([`${stamp}-note.md`, `${stamp}-note.md-2`]);
    expect(new TextDecoder().decode(await readFile(join(vault.raw.root, '.trash', `${stamp}-note.md`)))).toBe('one');
    expect(
      new TextDecoder().decode(await readFile(join(vault.raw.root, '.trash', `${stamp}-note.md-2`))),
    ).toBe('two');
  });
});

describe('formatTrashTimestamp', () => {
  it('renders a sortable UTC stamp', () => {
    expect(formatTrashTimestamp(FIXED_NOW)).toBe('20260820T142315.123Z');
  });
});
