/**
 * `vsa snapshot create|list|restore` against the rig: the one-shot create
 * flow (real in-memory sync server over the injected transport), the HTTP
 * list rendering, target resolution (id / unique name / latest name), and the
 * confirm-then-restore end-to-end path.
 */

import { describe, expect, it } from 'vitest';
import type { SnapshotSummary } from '@vsa/core';
import {
  renderSnapshotList,
  resolveSnapshotTarget,
  runSnapshotCreate,
  runSnapshotList,
  runSnapshotRestore,
} from '../src/commands/snapshot.js';
import { CommandError } from '../src/runtime.js';
import { makeRig, seedVault, WORKER_URL } from './helpers.js';

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);
const dec = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

const summary = (overrides: Partial<SnapshotSummary>): SnapshotSummary => ({
  id: 's1',
  name: '',
  ts: 1_735_100_000_000,
  deviceId: 'dev-1',
  seq: 3,
  fileCount: 2,
  ...overrides,
});

async function writeFiles(rig: Awaited<ReturnType<typeof makeRig>>, files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await rig.storage.writeFile(path, enc(content));
  }
}

describe('runSnapshotCreate', () => {
  it('connects one-shot, snapshots the synced heads, and reports id/name/fileCount', async () => {
    const rig = await makeRig();
    seedVault(rig);
    await writeFiles(rig, { '/notes/one.md': 'one', '/notes/two.md': 'two' });

    const result = await runSnapshotCreate(rig.runtime, 'pre-agent', undefined);
    expect(result.id).toBe('s1');
    expect(result.name).toBe('pre-agent');
    expect(result.fileCount).toBe(2);
    expect(result.vault.name).toBe('personal');
  });

  it('unnamed snapshots come back with an empty name', async () => {
    const rig = await makeRig();
    seedVault(rig);
    const result = await runSnapshotCreate(rig.runtime, undefined, undefined);
    expect(result).toMatchObject({ id: 's1', name: '', fileCount: 0 });
  });
});

describe('runSnapshotList + renderSnapshotList', () => {
  it('fetches /api/snapshots and renders the table newest-first', async () => {
    const rig = await makeRig();
    seedVault(rig);
    rig.fake.state.snapshotsDoc = [
      summary({ id: 's2', name: 'newer', ts: 2_000 }),
      summary({ id: 's1', name: 'older', ts: 1_000, fileCount: 12 }),
    ];

    const report = await runSnapshotList(rig.runtime, undefined);
    expect(report.snapshots.map((s) => s.id)).toEqual(['s2', 's1']);

    renderSnapshotList(report, rig.runtime);
    const out = rig.output.text();
    expect(out).toContain('s2');
    expect(out).toContain('newer');
    expect(out).toContain('older');
    expect(out).toContain('12 file(s)');
    expect(out).toContain('dev-1');
  });

  it('warns when the vault has no device token', async () => {
    const rig = await makeRig();
    rig.configStore.upsertVault({ id: rig.vaultDir, name: 'personal', url: WORKER_URL, deviceId: 'dev-1' });
    const report = await runSnapshotList(rig.runtime, undefined);
    expect(report.error).toMatch(/no device token/);
  });
});

describe('resolveSnapshotTarget', () => {
  const snapshots = [
    summary({ id: 's3', name: 'agent-run', ts: 3_000 }),
    summary({ id: 's2', name: 'agent-run', ts: 2_000 }),
    summary({ id: 's1', name: 'manual', ts: 1_000 }),
  ];

  it('exact id wins over names', () => {
    expect(resolveSnapshotTarget('s2', snapshots).id).toBe('s2');
  });

  it('a unique name resolves directly', () => {
    expect(resolveSnapshotTarget('manual', snapshots).id).toBe('s1');
  });

  it('a repeated name resolves to the latest by ts', () => {
    expect(resolveSnapshotTarget('agent-run', snapshots).id).toBe('s3');
  });

  it('no match lists the candidates; empty list says so', () => {
    expect(() => resolveSnapshotTarget('nope', snapshots)).toThrow(CommandError);
    expect(() => resolveSnapshotTarget('nope', snapshots)).toThrow(/s3.*agent-run/);
    expect(() => resolveSnapshotTarget('s1', [])).toThrow(/no snapshots yet/);
  });
});

describe('runSnapshotRestore', () => {
  it('confirms, restores by name, and re-converges the local vault', async () => {
    const rig = await makeRig();
    seedVault(rig);
    await writeFiles(rig, { '/notes/one.md': 'one v1', '/notes/two.md': 'two v1' });
    await runSnapshotCreate(rig.runtime, 'safe-point', undefined);

    // Diverge locally, sync (a create also runs a full cycle), then restore.
    await writeFiles(rig, { '/notes/one.md': 'one v2 (bad)', '/notes/extra.md': 'extra' });
    await runSnapshotCreate(rig.runtime, undefined, undefined);
    rig.fake.state.snapshotsDoc = [
      summary({ id: 's2', name: '' }),
      summary({ id: 's1', name: 'safe-point' }),
    ];

    rig.prompts.script(true);
    const result = await runSnapshotRestore(rig.runtime, 'safe-point', {}, undefined);
    expect(result).toMatchObject({ id: 's1', name: 'safe-point', restored: 1, tombstoned: 1 });
    expect(rig.prompts.asked[0]).toContain('Restore vault personal to snapshot s1');

    // The one-shot client re-converged from the full manifest before closing.
    expect(dec(await rig.storage.readFile('/notes/one.md'))).toBe('one v1');
    expect(await rig.storage.exists('/notes/extra.md')).toBe(false);
    expect(dec(await rig.storage.readFile('/notes/two.md'))).toBe('two v1');
  });

  it('--yes skips the prompt; a declined confirm cancels', async () => {
    const rig = await makeRig();
    seedVault(rig);
    await writeFiles(rig, { '/notes/one.md': 'one' });
    await runSnapshotCreate(rig.runtime, 'point', undefined);
    rig.fake.state.snapshotsDoc = [summary({ id: 's1', name: 'point' })];

    const result = await runSnapshotRestore(rig.runtime, 's1', { yes: true }, undefined);
    expect(result).toMatchObject({ id: 's1', restored: 0, tombstoned: 0 });
    expect(rig.prompts.asked).toHaveLength(0);

    rig.prompts.script(false);
    await expect(runSnapshotRestore(rig.runtime, 's1', {}, undefined)).rejects.toThrow(/cancelled/);
  });

  it('a non-interactive runtime without --yes refuses instead of restoring silently', async () => {
    const rig = await makeRig();
    seedVault(rig);
    await writeFiles(rig, { '/notes/one.md': 'one' });
    await runSnapshotCreate(rig.runtime, 'point', undefined);
    rig.fake.state.snapshotsDoc = [summary({ id: 's1', name: 'point' })];

    // Whole-vault revert is too destructive to run unconfirmed: no prompts
    // (no TTY) and no --yes must explain the flag, not proceed.
    rig.runtime.prompts = null;
    await expect(runSnapshotRestore(rig.runtime, 's1', {}, undefined)).rejects.toThrow(
      CommandError,
    );
    await expect(runSnapshotRestore(rig.runtime, 's1', {}, undefined)).rejects.toThrow(/--yes/);
    expect(rig.prompts.asked).toHaveLength(0);
    expect(rig.server.snapshot().versions).toBe(1); // nothing was restored

    // --yes still works without a prompt surface.
    await expect(runSnapshotRestore(rig.runtime, 's1', { yes: true }, undefined)).resolves.toMatchObject(
      { id: 's1', restored: 0, tombstoned: 0 },
    );
  });
});
