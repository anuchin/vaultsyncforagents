/**
 * `vsa history` / `vsa restore` (FR-54) against the rig: rendering, the
 * "undo one edit" default, explicit --version, blob fetch + write + push,
 * and the failure shapes (missing blob, single version).
 */

import { describe, expect, it } from 'vitest';
import { sha256Hex } from '@vsa/core';
import { runHistory, renderHistory, runRestore, pickRestoreVersion } from '../src/commands/history.js';
import { CommandError } from '../src/runtime.js';
import { makeRig, seedVault, type HistoryDoc } from './helpers.js';

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);

async function docFixture(): Promise<HistoryDoc> {
  const v2 = await sha256Hex(enc('v2 content'));
  const v1 = await sha256Hex(enc('v1 content'));
  return {
    path: '/notes/a.md',
    head: { versionId: 'ver-2', deleted: false },
    versions: [
      { id: 'ver-2', hash: v2, size: 10, deviceId: 'dev-desktop', clock: { counter: 2, deviceId: 'dev-desktop' }, ts: 2000, kind: 'edit', current: true },
      { id: 'ver-1', hash: v1, size: 10, deviceId: 'dev-phone', clock: { counter: 1, deviceId: 'dev-phone' }, ts: 1000, kind: 'edit', current: false },
    ],
  };
}

describe('runHistory', () => {
  it('fetches and renders the version chain', async () => {
    const rig = await makeRig();
    seedVault(rig);
    rig.fake.state.historyDoc = await docFixture();

    const doc = await runHistory(rig.runtime, 'notes/a.md', undefined);
    expect(doc.path).toBe('/notes/a.md');
    expect(doc.versions).toHaveLength(2);

    renderHistory(doc, rig.runtime);
    const text = rig.output.text();
    expect(text).toContain('/notes/a.md — 2 version(s)');
    expect(text).toContain('(current)');
    expect(text).toContain('ver-1');
  });

  it('flags deleted heads in the header line', async () => {
    const rig = await makeRig();
    seedVault(rig);
    rig.fake.state.historyDoc = { path: '/x.md', head: { versionId: 'v', deleted: true }, versions: [] };
    const doc = await runHistory(rig.runtime, '/x.md', undefined);
    renderHistory(doc, rig.runtime);
    expect(rig.output.text()).toContain('[deleted]');
  });
});

describe('pickRestoreVersion', () => {
  it('defaults to the newest version with content different from the head', async () => {
    const doc = await docFixture();
    expect(pickRestoreVersion(doc).id).toBe('ver-1');
  });

  it('--version selects an explicit id', async () => {
    const doc = await docFixture();
    expect(pickRestoreVersion(doc, 'ver-2').id).toBe('ver-2');
  });

  it('errors on unknown ids and single-version files', async () => {
    const doc = await docFixture();
    expect(() => pickRestoreVersion(doc, 'nope')).toThrow(CommandError);
    expect(() => pickRestoreVersion(doc, undefined,)).toBeDefined();
    const single: HistoryDoc = {
      path: '/one.md',
      head: { versionId: 'only', deleted: false },
      versions: [
        { id: 'only', hash: 'a'.repeat(64), size: 1, deviceId: 'd', clock: { counter: 1, deviceId: 'd' }, ts: 1, kind: 'edit', current: true },
      ],
    };
    expect(() => pickRestoreVersion(single)).toThrow(/no older distinct version/i);
  });
});

describe('runRestore', () => {
  it('downloads the blob, writes the file, and pushes it through a sync cycle', async () => {
    const rig = await makeRig();
    seedVault(rig);
    const doc = await docFixture();
    rig.fake.state.historyDoc = doc;
    const oldBytes = enc('v1 content');
    rig.fake.state.blobs.set(doc.versions[1]!.hash, oldBytes);
    // Current content on disk matches the head version.
    await rig.storage.writeFile('/notes/a.md', enc('v2 content'));

    const result = await runRestore(rig.runtime, 'notes/a.md', undefined, undefined);
    expect(result.version.id).toBe('ver-1');
    expect(result.bytesWritten).toBe(oldBytes.byteLength);

    // The file on disk is now the restored content.
    expect(new TextDecoder().decode(await rig.storage.readFile('/notes/a.md'))).toBe('v1 content');
    // And the server received the restored content as a new head.
    const serverFile = rig.server.snapshot().files.find((file) => file.path === '/notes/a.md');
    expect(serverFile?.hash).toBe(doc.versions[1]!.hash);
  });

  it('--version restores an explicit version id', async () => {
    const rig = await makeRig();
    seedVault(rig);
    const doc = await docFixture();
    rig.fake.state.historyDoc = doc;
    rig.fake.state.blobs.set(doc.versions[0]!.hash, enc('v2 content'));
    await rig.storage.writeFile('/notes/a.md', enc('v1 content'));

    const result = await runRestore(rig.runtime, '/notes/a.md', 'ver-2', undefined);
    expect(result.version.id).toBe('ver-2');
    expect(new TextDecoder().decode(await rig.storage.readFile('/notes/a.md'))).toBe('v2 content');
  });

  it('fails cleanly when the blob has been garbage-collected', async () => {
    const rig = await makeRig();
    seedVault(rig);
    rig.fake.state.historyDoc = await docFixture();
    await rig.storage.writeFile('/notes/a.md', enc('v2 content'));
    await expect(runRestore(rig.runtime, '/notes/a.md', undefined, undefined)).rejects.toThrow(
      /no longer on the worker|garbage-collected/i,
    );
  });

  it('fails cleanly for files with no history', async () => {
    const rig = await makeRig();
    seedVault(rig);
    rig.fake.state.historyDoc = { path: '/none.md', head: null, versions: [] };
    await expect(runRestore(rig.runtime, '/none.md', undefined, undefined)).rejects.toThrow(
      /no recorded versions/i,
    );
  });
});
