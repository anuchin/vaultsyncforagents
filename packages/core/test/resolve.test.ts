import { describe, expect, it } from 'vitest';

import {
  computeSyncPlan,
  sha256Hex,
  type LocalChanges,
  type LocalIndex,
  type LocalIndexEntry,
  type LogicalClock,
  type RemoteFile,
  type SyncPlan,
  type SyncPlanInput,
} from '../src/index.js';

const NOW = Date.UTC(2026, 7, 20, 14, 23, 0); // → "2026-08-20 14-23"

const h = (content: string): Promise<string> => sha256Hex(content);

const clock = (counter: number, deviceId: string): LogicalClock => ({ counter, deviceId });

function entry(hash: string, versionId: string, size: number, c: LogicalClock): LocalIndexEntry {
  return { hash, size, versionId, clock: c };
}

function remote(
  path: string,
  opts: { hash: string; version: string; clock: LogicalClock; size?: number; deleted?: boolean },
): RemoteFile {
  return {
    path,
    version: opts.version,
    hash: opts.hash,
    size: opts.size ?? 5,
    deleted: opts.deleted ?? false,
    mtime: 0,
    clock: opts.clock,
  };
}

function noChanges(): LocalChanges {
  return { scannedAt: NOW, added: [], modified: [], deleted: [], renamed: [], emptyFolders: [] };
}

function makeInput(overrides: Partial<SyncPlanInput> = {}): SyncPlanInput {
  return {
    localChanges: noChanges(),
    index: {},
    manifest: [],
    thisDeviceId: 'dev-local',
    thisDeviceName: 'Laptop',
    now: NOW,
    ...overrides,
  };
}

const COPY = (path: string): string =>
  path.replace(/(\.[^./]+)$/, ' (conflict 2026-08-20 14-23 - from Laptop)$1');

describe('computeSyncPlan — local-only changes become pushes', () => {
  it('edit → PushOp with the index head as parentVersion', async () => {
    const hash = await h('new content');
    const plan = computeSyncPlan(
      makeInput({
        index: { '/notes/a.md': entry(await h('old'), 'v1', 3, clock(1, 'dev-A')) },
        manifest: [remote('/notes/a.md', { hash: await h('old'), version: 'v1', size: 3, clock: clock(1, 'dev-A') })],
        localChanges: {
          ...noChanges(),
          modified: [{ path: '/notes/a.md', hash, size: 11 }],
        },
      }),
    );
    expect(plan).toEqual({
      pushes: [{ kind: 'edit', path: '/notes/a.md', parentVersion: 'v1', hash, size: 11 }],
      pulls: [],
      conflicts: [],
      folderPushes: [],
    });
  });

  it('create → PushOp add with parentVersion null', async () => {
    const hash = await h('fresh');
    const plan = computeSyncPlan(
      makeInput({
        localChanges: { ...noChanges(), added: [{ path: '/new.md', hash, size: 5 }] },
      }),
    );
    expect(plan.pushes).toEqual([{ kind: 'add', path: '/new.md', parentVersion: null, hash, size: 5 }]);
  });

  it('delete → tombstone PushOp reusing the synced hash and version', async () => {
    const oldHash = await h('old');
    const plan = computeSyncPlan(
      makeInput({
        index: { '/notes/a.md': entry(oldHash, 'v1', 3, clock(1, 'dev-A')) },
        localChanges: {
          ...noChanges(),
          deleted: [{ path: '/notes/a.md', hash: oldHash, size: 3, versionId: 'v1' }],
        },
      }),
    );
    expect(plan.pushes).toEqual([
      { kind: 'delete', path: '/notes/a.md', parentVersion: 'v1', hash: oldHash, size: 3 },
    ]);
  });

  it('resurrect over a tombstone → restore PushOp building on the tombstone version', async () => {
    const hash = await h('back');
    const plan = computeSyncPlan(
      makeInput({
        index: { '/notes/z.md': { ...entry(hash, 'v5', 4, clock(2, 'dev-A')), deletedAt: 99 } },
        localChanges: { ...noChanges(), modified: [{ path: '/notes/z.md', hash, size: 4 }] },
      }),
    );
    expect(plan.pushes).toEqual([
      { kind: 'restore', path: '/notes/z.md', parentVersion: 'v5', hash, size: 4 },
    ]);
  });
});

describe('computeSyncPlan — remote-only changes become pulls', () => {
  const baseIndex = async (): Promise<LocalIndex> => ({
    '/notes/a.md': entry(await h('old'), 'v1', 3, clock(1, 'dev-A')),
  });

  it('edit → PullOp carrying version and clock', async () => {
    const newHash = await h('remote edit');
    const plan = computeSyncPlan(
      makeInput({
        index: await baseIndex(),
        manifest: [remote('/notes/a.md', { hash: newHash, version: 'v2', size: 11, clock: clock(2, 'dev-B') })],
      }),
    );
    expect(plan.pulls).toEqual([
      {
        kind: 'edit',
        path: '/notes/a.md',
        hash: newHash,
        size: 11,
        version: 'v2',
        clock: clock(2, 'dev-B'),
        deleted: false,
      },
    ]);
    expect(plan.pushes).toEqual([]);
  });

  it('create → add PullOp', async () => {
    const hash = await h('remote new');
    const plan = computeSyncPlan(
      makeInput({ manifest: [remote('/remote-new.md', { hash, version: 'v1', size: 10, clock: clock(1, 'dev-B') })] }),
    );
    expect(plan.pulls).toEqual([
      { kind: 'add', path: '/remote-new.md', hash, size: 10, version: 'v1', clock: clock(1, 'dev-B'), deleted: false },
    ]);
  });

  it('tombstone → delete PullOp', async () => {
    const hash = await h('old');
    const plan = computeSyncPlan(
      makeInput({
        index: await baseIndex(),
        manifest: [remote('/notes/a.md', { hash, version: 'v2', size: 3, clock: clock(2, 'dev-B'), deleted: true })],
      }),
    );
    expect(plan.pulls).toEqual([
      { kind: 'delete', path: '/notes/a.md', hash, size: 3, version: 'v2', clock: clock(2, 'dev-B'), deleted: true },
    ]);
    expect(plan.conflicts).toEqual([]); // local side unchanged ⇒ deletion simply applies
  });

  it('undelete → restore PullOp', async () => {
    const hash = await h('old');
    const plan = computeSyncPlan(
      makeInput({
        index: { '/notes/a.md': { ...entry(hash, 'v2', 3, clock(2, 'dev-B')), deletedAt: 100 } },
        manifest: [remote('/notes/a.md', { hash, version: 'v3', size: 3, clock: clock(3, 'dev-B') })],
      }),
    );
    expect(plan.pulls).toEqual([
      { kind: 'restore', path: '/notes/a.md', hash, size: 3, version: 'v3', clock: clock(3, 'dev-B'), deleted: false },
    ]);
  });

  it('version-id-only drift (same hash) still emits an edit pull for index catch-up', async () => {
    const hash = await h('same');
    const plan = computeSyncPlan(
      makeInput({
        index: { '/notes/a.md': entry(hash, 'v1', 4, clock(1, 'dev-A')) },
        manifest: [remote('/notes/a.md', { hash, version: 'v2', size: 4, clock: clock(2, 'dev-A') })],
      }),
    );
    expect(plan.pulls).toEqual([
      { kind: 'edit', path: '/notes/a.md', hash, size: 4, version: 'v2', clock: clock(2, 'dev-A'), deleted: false },
    ]);
  });

  it('remote tombstone for a path never known locally is ignored', async () => {
    const plan = computeSyncPlan(
      makeInput({
        manifest: [remote('/unknown.md', { hash: await h('x'), version: 'v1', clock: clock(1, 'dev-B'), deleted: true })],
      }),
    );
    expect(plan.pulls).toEqual([]);
  });
});

describe('computeSyncPlan — two devices edit the same note offline (FR-6)', () => {
  async function offlineEditFixture(thisDeviceId: string, remoteClock: LogicalClock) {
    const baseHash = await h('base');
    const localHash = await h('local edit');
    const remoteHash = await h('remote edit');
    return {
      index: { '/notes/todo.md': entry(baseHash, 'v1', 4, clock(1, 'dev-A')) } as LocalIndex,
      manifest: [remote('/notes/todo.md', { hash: remoteHash, version: 'v2', size: 11, clock: remoteClock })],
      localChanges: {
        ...noChanges(),
        modified: [{ path: '/notes/todo.md', hash: localHash, size: 10 }],
      },
      localHash,
      remoteHash,
      thisDeviceId,
    };
  }

  it('remote clock wins → pull remote content, preserve local via conflict-copy push', async () => {
    const f = await offlineEditFixture('dev-local', clock(5, 'dev-phone'));
    const plan = computeSyncPlan(
      makeInput({
        index: f.index,
        manifest: f.manifest,
        localChanges: f.localChanges,
        thisDeviceId: f.thisDeviceId,
      }),
    );
    expect(plan.pulls).toEqual([
      {
        kind: 'edit',
        path: '/notes/todo.md',
        hash: f.remoteHash,
        size: 11,
        version: 'v2',
        clock: clock(5, 'dev-phone'),
        deleted: false,
      },
    ]);
    // Loser preserved: local content pushed to the conflict-copy path,
    // building on the winning remote head (fast-path, must not re-conflict).
    expect(plan.pushes).toEqual([
      {
        kind: 'conflictCopy',
        path: COPY('/notes/todo.md'),
        parentVersion: 'v2',
        hash: f.localHash,
        size: 10,
      },
    ]);
    expect(plan.conflicts).toEqual([
      {
        path: '/notes/todo.md',
        reason: 'concurrent-edit',
        winner: 'remote',
        loserContent: 'local',
        conflictCopyPath: COPY('/notes/todo.md'),
        remote: {
          version: 'v2',
          hash: f.remoteHash,
          size: 11,
          deleted: false,
          clock: clock(5, 'dev-phone'),
        },
        localClock: clock(2, 'dev-local'),
      },
    ]);
  });

  it('local clock wins → push local content on the stale parent; server preserves the remote loser', async () => {
    // Local tentative clock {2, 'dev-local'} beats remote {2, 'dev-A'} on the
    // deviceId tiebreak.
    const f = await offlineEditFixture('dev-local', clock(2, 'dev-A'));
    const plan = computeSyncPlan(
      makeInput({
        index: f.index,
        manifest: f.manifest,
        localChanges: f.localChanges,
        thisDeviceId: f.thisDeviceId,
      }),
    );
    expect(plan.pulls).toEqual([]);
    // parentVersion is the stale index head on purpose: the DO must see the
    // divergence, arbitrate in our favor, and synthesize the remote loser's
    // conflict copy server-side.
    expect(plan.pushes).toEqual([
      { kind: 'edit', path: '/notes/todo.md', parentVersion: 'v1', hash: f.localHash, size: 10 },
    ]);
    expect(plan.conflicts).toEqual([
      expect.objectContaining({ winner: 'local', loserContent: 'remote', reason: 'concurrent-edit' }),
    ]);
  });

  it('exact counter tie → greater deviceId wins, both directions', async () => {
    // Local 'dev-Z' vs remote 'dev-A', both counter 2 → local wins.
    const localWins = await offlineEditFixture('dev-Z', clock(2, 'dev-A'));
    const planA = computeSyncPlan(
      makeInput({ index: localWins.index, manifest: localWins.manifest, localChanges: localWins.localChanges, thisDeviceId: 'dev-Z' }),
    );
    expect(planA.conflicts[0]).toMatchObject({ winner: 'local', loserContent: 'remote' });

    // Swap ids → remote wins.
    const remoteWins = await offlineEditFixture('dev-A', clock(2, 'dev-Z'));
    const planB = computeSyncPlan(
      makeInput({ index: remoteWins.index, manifest: remoteWins.manifest, localChanges: remoteWins.localChanges, thisDeviceId: 'dev-A' }),
    );
    expect(planB.conflicts[0]).toMatchObject({ winner: 'remote', loserContent: 'local' });
    expect(planB.pushes[0]).toMatchObject({ kind: 'conflictCopy' });
  });

  it('both-add race on a brand-new path → add-vs-add via clocks', async () => {
    const localHash = await h('mine');
    const remoteHash = await h('theirs');
    const plan = computeSyncPlan(
      makeInput({
        manifest: [remote('/new.md', { hash: remoteHash, version: 'v1', size: 5, clock: clock(1, 'dev-Z') })],
        localChanges: { ...noChanges(), added: [{ path: '/new.md', hash: localHash, size: 4 }] },
        thisDeviceId: 'dev-A', // loses the tie to dev-Z
      }),
    );
    expect(plan.pulls[0]).toMatchObject({ kind: 'add', hash: remoteHash });
    expect(plan.pushes[0]).toEqual({
      kind: 'conflictCopy',
      path: COPY('/new.md'),
      parentVersion: 'v1',
      hash: localHash,
      size: 4,
    });
    expect(plan.conflicts[0]).toMatchObject({ reason: 'add-vs-add', winner: 'remote', loserContent: 'local' });
  });
});

describe('computeSyncPlan — delete-vs-edit', () => {
  it('both delete → converge silently on the remote tombstone (no conflict)', async () => {
    const hash = await h('old');
    const plan = computeSyncPlan(
      makeInput({
        index: { '/notes/a.md': entry(hash, 'v1', 3, clock(1, 'dev-A')) },
        manifest: [remote('/notes/a.md', { hash, version: 'v2', size: 3, clock: clock(2, 'dev-B'), deleted: true })],
        localChanges: {
          ...noChanges(),
          deleted: [{ path: '/notes/a.md', hash, size: 3, versionId: 'v1' }],
        },
      }),
    );
    expect(plan.pulls).toEqual([
      { kind: 'delete', path: '/notes/a.md', hash, size: 3, version: 'v2', clock: clock(2, 'dev-B'), deleted: true },
    ]);
    expect(plan.pushes).toEqual([]);
    expect(plan.conflicts).toEqual([]);
  });

  it('local delete vs remote edit — remote wins → file recreated, no copy for a lost deletion', async () => {
    const remoteHash = await h('remote edit');
    const oldHash = await h('old');
    const plan = computeSyncPlan(
      makeInput({
        index: { '/notes/a.md': entry(oldHash, 'v1', 3, clock(1, 'dev-A')) },
        manifest: [remote('/notes/a.md', { hash: remoteHash, version: 'v2', size: 11, clock: clock(5, 'dev-B') })],
        localChanges: {
          ...noChanges(),
          deleted: [{ path: '/notes/a.md', hash: oldHash, size: 3, versionId: 'v1' }],
        },
      }),
    );
    expect(plan.pulls[0]).toMatchObject({ kind: 'edit', hash: remoteHash });
    expect(plan.pushes).toEqual([]); // a deletion has no content to preserve
    expect(plan.conflicts).toEqual([
      expect.objectContaining({ winner: 'remote', loserContent: 'none', reason: 'delete-vs-edit' }),
    ]);
  });

  it('local delete vs remote edit — local wins → tombstone push on the stale parent', async () => {
    const remoteHash = await h('remote edit');
    const oldHash = await h('old');
    const plan = computeSyncPlan(
      makeInput({
        index: { '/notes/a.md': entry(oldHash, 'v1', 3, clock(1, 'dev-A')) },
        manifest: [remote('/notes/a.md', { hash: remoteHash, version: 'v2', size: 11, clock: clock(2, 'dev-B') })],
        localChanges: {
          ...noChanges(),
          deleted: [{ path: '/notes/a.md', hash: oldHash, size: 3, versionId: 'v1' }],
        },
        thisDeviceId: 'dev-Z', // wins the counter tie
      }),
    );
    expect(plan.pulls).toEqual([]);
    expect(plan.pushes).toEqual([
      { kind: 'delete', path: '/notes/a.md', parentVersion: 'v1', hash: oldHash, size: 3 },
    ]);
    expect(plan.conflicts).toEqual([
      expect.objectContaining({ winner: 'local', loserContent: 'remote' }),
    ]);
  });

  it('local edit vs remote delete — remote wins → tombstone pulled, local content saved as conflict copy', async () => {
    const localHash = await h('local edit');
    const oldHash = await h('old');
    const plan = computeSyncPlan(
      makeInput({
        index: { '/notes/a.md': entry(oldHash, 'v1', 3, clock(1, 'dev-A')) },
        manifest: [remote('/notes/a.md', { hash: oldHash, version: 'v2', size: 3, clock: clock(5, 'dev-B'), deleted: true })],
        localChanges: {
          ...noChanges(),
          modified: [{ path: '/notes/a.md', hash: localHash, size: 10 }],
        },
      }),
    );
    expect(plan.pulls).toEqual([
      { kind: 'delete', path: '/notes/a.md', hash: oldHash, size: 3, version: 'v2', clock: clock(5, 'dev-B'), deleted: true },
    ]);
    expect(plan.pushes).toEqual([
      { kind: 'conflictCopy', path: COPY('/notes/a.md'), parentVersion: 'v2', hash: localHash, size: 10 },
    ]);
    expect(plan.conflicts).toEqual([
      expect.objectContaining({ winner: 'remote', loserContent: 'local', conflictCopyPath: COPY('/notes/a.md') }),
    ]);
  });

  it('local edit vs remote delete — local wins → edit push resurrects the path server-side', async () => {
    const localHash = await h('local edit');
    const oldHash = await h('old');
    const plan = computeSyncPlan(
      makeInput({
        index: { '/notes/a.md': entry(oldHash, 'v1', 3, clock(1, 'dev-A')) },
        manifest: [remote('/notes/a.md', { hash: oldHash, version: 'v2', size: 3, clock: clock(2, 'dev-B'), deleted: true })],
        localChanges: {
          ...noChanges(),
          modified: [{ path: '/notes/a.md', hash: localHash, size: 10 }],
        },
        thisDeviceId: 'dev-Z',
      }),
    );
    expect(plan.pulls).toEqual([]);
    expect(plan.pushes).toEqual([
      { kind: 'edit', path: '/notes/a.md', parentVersion: 'v1', hash: localHash, size: 10 },
    ]);
    expect(plan.conflicts).toEqual([
      expect.objectContaining({ winner: 'local', loserContent: 'none' }),
    ]);
  });
});

describe('computeSyncPlan — renames (FR-9)', () => {
  it('local rename, no remote change → single PushRenameOp', async () => {
    const hash = await h('moved');
    const plan = computeSyncPlan(
      makeInput({
        index: { '/notes/a.md': entry(hash, 'v1', 5, clock(1, 'dev-A')) },
        manifest: [remote('/notes/a.md', { hash, version: 'v1', size: 5, clock: clock(1, 'dev-A') })],
        localChanges: {
          ...noChanges(),
          renamed: [{ from: '/notes/a.md', to: '/notes/b.md', hash, size: 5 }],
        },
      }),
    );
    expect(plan.pushes).toEqual([
      { kind: 'rename', fromPath: '/notes/a.md', toPath: '/notes/b.md', parentVersion: 'v1', hash, size: 5 },
    ]);
    expect(plan.pulls).toEqual([]);
  });

  it('remote rename, no local change → PullRenameOp (from vanishes from the manifest)', async () => {
    const hash = await h('moved');
    const plan = computeSyncPlan(
      makeInput({
        index: { '/notes/a.md': entry(hash, 'v1', 5, clock(1, 'dev-A')) },
        manifest: [remote('/notes/b.md', { hash, version: 'v2', size: 5, clock: clock(2, 'dev-B') })],
      }),
    );
    expect(plan.pulls).toEqual([
      {
        kind: 'rename',
        fromPath: '/notes/a.md',
        toPath: '/notes/b.md',
        hash,
        size: 5,
        version: 'v2',
        clock: clock(2, 'dev-B'),
      },
    ]);
    expect(plan.pushes).toEqual([]);
  });

  it('remote rename prefers a same-directory target when two new paths share the hash', async () => {
    const hash = await h('twin');
    const plan = computeSyncPlan(
      makeInput({
        index: { '/dir1/a.md': entry(hash, 'v1', 4, clock(1, 'dev-A')) },
        manifest: [
          remote('/other/c.md', { hash, version: 'v2', size: 4, clock: clock(2, 'dev-B') }),
          remote('/dir1/b.md', { hash, version: 'v2', size: 4, clock: clock(2, 'dev-B') }),
        ],
      }),
    );
    expect(plan.pulls[0]).toMatchObject({ kind: 'rename', fromPath: '/dir1/a.md', toPath: '/dir1/b.md' });
  });

  it('remote rename + edit (hash changed) degrades to delete + add', async () => {
    const oldHash = await h('old');
    const newHash = await h('renamed and edited');
    const plan = computeSyncPlan(
      makeInput({
        index: { '/notes/a.md': entry(oldHash, 'v1', 3, clock(1, 'dev-A')) },
        manifest: [remote('/notes/b.md', { hash: newHash, version: 'v2', size: 18, clock: clock(2, 'dev-B') })],
      }),
    );
    expect(plan.pulls).toEqual([
      { kind: 'delete', path: '/notes/a.md', hash: oldHash, size: 3, version: '', clock: clock(1, 'dev-A'), deleted: true },
      { kind: 'add', path: '/notes/b.md', hash: newHash, size: 18, version: 'v2', clock: clock(2, 'dev-B'), deleted: false },
    ]);
  });

  it('local rename races a remote edit at the old path — remote wins: edit lands at `from`, rename content pushed at `to`', async () => {
    const movedHash = await h('moved');
    const editedHash = await h('remote edit');
    const plan = computeSyncPlan(
      makeInput({
        index: { '/notes/a.md': entry(movedHash, 'v1', 5, clock(1, 'dev-A')) },
        manifest: [remote('/notes/a.md', { hash: editedHash, version: 'v2', size: 11, clock: clock(5, 'dev-B') })],
        localChanges: {
          ...noChanges(),
          renamed: [{ from: '/notes/a.md', to: '/notes/b.md', hash: movedHash, size: 5 }],
        },
      }),
    );
    expect(plan.pulls).toEqual([
      { kind: 'edit', path: '/notes/a.md', hash: editedHash, size: 11, version: 'v2', clock: clock(5, 'dev-B'), deleted: false },
    ]);
    // The renamed content survives at the new path — no extra copy needed.
    expect(plan.pushes).toEqual([
      { kind: 'add', path: '/notes/b.md', parentVersion: null, hash: movedHash, size: 5 },
    ]);
    expect(plan.conflicts).toEqual([
      expect.objectContaining({ path: '/notes/a.md', reason: 'rename-race', winner: 'remote', loserContent: 'local' }),
    ]);
  });

  it('local rename races a remote edit at the old path — local clock wins: rename push carries the file', async () => {
    const movedHash = await h('moved');
    const editedHash = await h('remote edit');
    const plan = computeSyncPlan(
      makeInput({
        index: { '/notes/a.md': entry(movedHash, 'v1', 5, clock(1, 'dev-A')) },
        manifest: [remote('/notes/a.md', { hash: editedHash, version: 'v2', size: 11, clock: clock(2, 'dev-B') })],
        localChanges: {
          ...noChanges(),
          renamed: [{ from: '/notes/a.md', to: '/notes/b.md', hash: movedHash, size: 5 }],
        },
        thisDeviceId: 'dev-Z', // wins the counter-2 tie
      }),
    );
    expect(plan.pushes).toEqual([
      { kind: 'rename', fromPath: '/notes/a.md', toPath: '/notes/b.md', parentVersion: 'v1', hash: movedHash, size: 5 },
    ]);
    expect(plan.pulls).toEqual([]);
    expect(plan.conflicts).toEqual([
      expect.objectContaining({ reason: 'rename-race', winner: 'local', loserContent: 'remote' }),
    ]);
  });

  it('local rename races a remote delete at the old path: deletion stands at `from`, content survives at `to`', async () => {
    const hash = await h('moved');
    const plan = computeSyncPlan(
      makeInput({
        index: { '/notes/a.md': entry(hash, 'v1', 5, clock(1, 'dev-A')) },
        manifest: [remote('/notes/a.md', { hash, version: 'v2', size: 5, clock: clock(2, 'dev-B'), deleted: true })],
        localChanges: {
          ...noChanges(),
          renamed: [{ from: '/notes/a.md', to: '/notes/b.md', hash, size: 5 }],
        },
      }),
    );
    expect(plan.pulls).toEqual([
      { kind: 'delete', path: '/notes/a.md', hash, size: 5, version: 'v2', clock: clock(2, 'dev-B'), deleted: true },
    ]);
    expect(plan.pushes).toEqual([
      { kind: 'add', path: '/notes/b.md', parentVersion: null, hash, size: 5 },
    ]);
  });

  it('local rename onto a path the remote also created — remote wins: pull at `to`, local content to a conflict copy, old path tombstoned', async () => {
    const hash = await h('moved');
    const theirsHash = await h('theirs');
    const plan = computeSyncPlan(
      makeInput({
        index: { '/notes/a.md': entry(hash, 'v1', 5, clock(1, 'dev-A')) },
        manifest: [
          remote('/notes/b.md', { hash: theirsHash, version: 'v9', size: 6, clock: clock(2, 'dev-Z') }),
        ],
        localChanges: {
          ...noChanges(),
          renamed: [{ from: '/notes/a.md', to: '/notes/b.md', hash, size: 5 }],
        },
        thisDeviceId: 'dev-A', // loses the counter-2 tie
      }),
    );
    expect(plan.pulls).toEqual([
      // `from` vanished from the manifest (or is tombstoned) — deletion applies there.
      { kind: 'delete', path: '/notes/a.md', hash, size: 5, version: '', clock: clock(1, 'dev-A'), deleted: true },
      { kind: 'add', path: '/notes/b.md', hash: theirsHash, size: 6, version: 'v9', clock: clock(2, 'dev-Z'), deleted: false },
    ]);
    expect(plan.pushes).toEqual([
      { kind: 'conflictCopy', path: COPY('/notes/b.md'), parentVersion: 'v9', hash, size: 5 },
    ]);
    expect(plan.conflicts).toEqual([
      expect.objectContaining({ path: '/notes/b.md', reason: 'add-vs-add', winner: 'remote', loserContent: 'local' }),
    ]);
  });
});

describe('computeSyncPlan — plan shape & determinism', () => {
  it('identical inputs on both sides of the manifest still produce an empty plan', async () => {
    const hash = await h('stable');
    const plan = computeSyncPlan(
      makeInput({
        index: { '/notes/a.md': entry(hash, 'v1', 6, clock(1, 'dev-A')) },
        manifest: [remote('/notes/a.md', { hash, version: 'v1', size: 6, clock: clock(1, 'dev-A') })],
      }),
    );
    expect(plan).toEqual({ pushes: [], pulls: [], conflicts: [], folderPushes: [] });
  });

  it('empty folders pass through sorted as folderPushes (FR-10)', () => {
    const plan = computeSyncPlan(
      makeInput({ localChanges: { ...noChanges(), emptyFolders: ['/z', '/a/nested', '/a'] } }),
    );
    expect(plan.folderPushes).toEqual(['/a', '/a/nested', '/z']);
  });

  it('is pure and deterministic: same inputs → identical plan; manifest order irrelevant; inputs unmutated', async () => {
    const baseHash = await h('base');
    const localHash = await h('local');
    const remoteHash = await h('remote');
    const input = makeInput({
      index: {
        '/notes/x.md': entry(baseHash, 'v1', 4, clock(1, 'dev-A')),
        '/notes/y.md': entry(baseHash, 'v1', 4, clock(1, 'dev-A')),
      },
      manifest: [
        remote('/notes/x.md', { hash: remoteHash, version: 'v2', size: 6, clock: clock(9, 'dev-B') }),
        remote('/created.md', { hash: remoteHash, version: 'v1', size: 6, clock: clock(1, 'dev-B') }),
      ],
      localChanges: {
        ...noChanges(),
        modified: [{ path: '/notes/x.md', hash: localHash, size: 5 }],
        deleted: [{ path: '/notes/y.md', hash: baseHash, size: 4, versionId: 'v1' }],
        emptyFolders: ['/new-folder'],
      },
    });
    const snapshot = JSON.stringify(input);

    const first: SyncPlan = computeSyncPlan(input);
    const second: SyncPlan = computeSyncPlan(input);
    expect(second).toEqual(first);

    const shuffled = makeInput({ ...input, manifest: [...input.manifest].reverse() });
    expect(computeSyncPlan(shuffled)).toEqual(first);

    // Mixed plan shape: one conflict + one delete push + one add pull + folder.
    expect(first.pushes.map((p) => p.kind).sort()).toEqual(['conflictCopy', 'delete']);
    expect(first.pulls.map((p) => p.kind)).toEqual(['add', 'edit']);
    expect(first.conflicts).toHaveLength(1);
    expect(first.folderPushes).toEqual(['/new-folder']);

    expect(JSON.stringify(input)).toBe(snapshot); // inputs untouched
  });
});
