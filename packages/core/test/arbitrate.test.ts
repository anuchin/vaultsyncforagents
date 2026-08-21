import { describe, expect, it } from 'vitest';

import {
  arbitrateCommit,
  computeSyncPlan,
  emptyArbitrationState,
  ProtocolError,
  sha256Hex,
  type ArbitrationCommit,
  type ArbitrationState,
  type LocalChanges,
  type LocalIndex,
  type RemoteFile,
} from '../src/index.js';

const NOW = Date.UTC(2026, 7, 20, 14, 23, 0); // → conflict stamp "2026-08-20 14-23"

const h = (content: string): Promise<string> => sha256Hex(content);

/** device id → human name (conflict-copy naming). */
const DEVICES = new Map([
  ['dev-A', 'Alpha'],
  ['dev-B', 'Beta'],
  ['dev-L', 'Local'],
  ['dev-Z', 'Zed'],
]);

const COPY = (path: string, device: string): string =>
  path.replace(/(\.[^./]+)$/, ` (conflict 2026-08-20 14-23 - from ${device})$1`);

const commit = (over: Partial<ArbitrationCommit> & { path: string }): ArbitrationCommit => ({
  parentVersion: null,
  hash: '',
  size: 0,
  kind: 'edit',
  ...over,
});

/**
 * Seed a two-version history on `/notes/todo.md`: v1 by dev-A (content O),
 * then v2 by dev-B (content R) building on v1. The returned commit fixture
 * is an incoming edit by dev-L with content L building on the STALE v1.
 */
async function seededRace(): Promise<{
  state: ArbitrationState;
  staleCommit: ArbitrationCommit;
  hashO: string;
  hashR: string;
  hashL: string;
  v1: string;
  v2: string;
}> {
  const hashO = await h('base');
  const hashR = await h('remote edit');
  const hashL = await h('local edit');
  let state = emptyArbitrationState();
  const first = arbitrateCommit(
    state,
    commit({ path: '/notes/todo.md', hash: hashO, size: 4 }),
    'dev-A',
    NOW - 2000,
    DEVICES,
  );
  state = first.state;
  const second = arbitrateCommit(
    state,
    commit({ path: '/notes/todo.md', parentVersion: first.outcome.newVersionId, hash: hashR, size: 11 }),
    'dev-B',
    NOW - 1000,
    DEVICES,
  );
  state = second.state;
  return {
    state,
    staleCommit: commit({ path: '/notes/todo.md', parentVersion: first.outcome.newVersionId, hash: hashL, size: 10 }),
    hashO,
    hashR,
    hashL,
    v1: first.outcome.newVersionId,
    v2: second.outcome.newVersionId,
  };
}

describe('arbitrateCommit — fast path', () => {
  it('parent == head → applied with clock parent+1 on the committer', async () => {
    const f = await seededRace();
    const verdict = arbitrateCommit(
      f.state,
      commit({ path: '/notes/todo.md', parentVersion: f.v2, hash: f.hashL, size: 10 }),
      'dev-L',
      NOW,
      DEVICES,
    );
    expect(verdict.outcome.result).toBe('applied');
    expect(verdict.outcome.clock).toEqual({ counter: 3, deviceId: 'dev-L' });
    expect(verdict.outcome.newVersionId).toBe(verdict.outcome.winner.id);
    expect(verdict.outcome.broadcast).toMatchObject({
      path: '/notes/todo.md',
      hash: f.hashL,
      deleted: false,
      device: 'dev-L',
      clock: { counter: 3, deviceId: 'dev-L' },
      kind: 'edit',
    });
    expect(verdict.state.files.get('/notes/todo.md')?.head.id).toBe(verdict.outcome.winner.id);
    expect(verdict.outcome.conflictCopy).toBeUndefined();
  });

  it('first commit (parent null, unknown path) → applied with clock {1, committer}', () => {
    const verdict = arbitrateCommit(
      emptyArbitrationState(),
      commit({ path: '/new.md', hash: 'a'.repeat(64), size: 1 }),
      'dev-B',
      NOW,
      DEVICES,
    );
    expect(verdict.outcome.result).toBe('applied');
    expect(verdict.outcome.clock).toEqual({ counter: 1, deviceId: 'dev-B' });
  });

  it('delete commit fast-paths to a tombstone', async () => {
    const f = await seededRace();
    const verdict = arbitrateCommit(
      f.state,
      commit({ path: '/notes/todo.md', parentVersion: f.v2, hash: f.hashR, size: 11, kind: 'delete' }),
      'dev-L',
      NOW,
      DEVICES,
    );
    expect(verdict.outcome.result).toBe('applied');
    expect(verdict.outcome.broadcast.deleted).toBe(true);
    expect(verdict.state.files.get('/notes/todo.md')?.deleted).toBe(true);
  });

  it('folder placeholder commit records isFolder with empty hash', () => {
    const verdict = arbitrateCommit(
      emptyArbitrationState(),
      commit({ path: '/empty-dir', hash: '', size: 0, isFolder: true }),
      'dev-B',
      NOW,
      DEVICES,
    );
    expect(verdict.outcome.result).toBe('applied');
    expect(verdict.outcome.broadcast.isFolder).toBe(true);
    expect(verdict.state.files.get('/empty-dir')?.isFolder).toBe(true);
  });
});

describe('arbitrateCommit — concurrent edits (mirrors resolve.ts FR-6 cases)', () => {
  it('head clock wins → incoming preserved as a conflict copy (from the losing device)', async () => {
    // head v2 has clock {2, dev-B}… wait, that ties the tentative {2, dev-L} —
    // use a head further ahead so the counter decides.
    const f = await seededRace();
    // Bump the head to counter 5 (three more fast-path edits by dev-B).
    let state = f.state;
    let parent = f.v2;
    for (let i = 0; i < 3; i++) {
      const v = arbitrateCommit(
        state,
        commit({ path: '/notes/todo.md', parentVersion: parent, hash: await h(`r${i}`), size: 2 }),
        'dev-B',
        NOW - 500 + i,
        DEVICES,
      );
      state = v.state;
      parent = v.outcome.newVersionId;
    }
    const head = state.files.get('/notes/todo.md')?.head;

    const verdict = arbitrateCommit(state, f.staleCommit, 'dev-L', NOW, DEVICES);
    expect(verdict.outcome.result).toBe('conflict');
    expect(verdict.outcome.winner.id).toBe(head?.id); // standing head stands
    expect(verdict.outcome.conflictCopyPath).toBe(COPY('/notes/todo.md', 'Local'));
    expect(verdict.outcome.conflictCopy).toMatchObject({
      path: COPY('/notes/todo.md', 'Local'),
      hash: f.hashL,
      device: 'dev-L',
      kind: 'conflictCopy',
      deleted: false,
    });
    // The copy builds on the winner and beats it: parent=head, counter=head+1.
    const copyVersion = verdict.state.versions.get(verdict.outcome.conflictCopy?.version ?? '');
    expect(copyVersion).toMatchObject({
      parentVersion: head?.id,
      clock: { counter: (head?.clock.counter ?? 0) + 1, deviceId: 'dev-L' },
      kind: 'conflictCopy',
    });
    expect(verdict.state.files.get(COPY('/notes/todo.md', 'Local'))?.deleted).toBe(false);
  });

  it('counter tie → greater deviceId wins: incoming displaces the head, head content preserved', async () => {
    // Head v2 = {2, dev-B}; incoming tentative = {2, dev-L}; 'dev-L' > 'dev-B'.
    const f = await seededRace();
    const verdict = arbitrateCommit(f.state, f.staleCommit, 'dev-L', NOW, DEVICES);
    expect(verdict.outcome.result).toBe('conflict');
    expect(verdict.outcome.winner.deviceId).toBe('dev-L');
    expect(verdict.outcome.winner.clock).toEqual({ counter: 2, deviceId: 'dev-L' }); // the tentative clock, exactly as the client predicted
    expect(verdict.outcome.winner.parentVersion).toBe(f.v1); // history keeps the true parent
    expect(verdict.outcome.conflictCopyPath).toBe(COPY('/notes/todo.md', 'Beta'));
    expect(verdict.outcome.conflictCopy).toMatchObject({ hash: f.hashR, device: 'dev-B' });
    expect(verdict.state.files.get('/notes/todo.md')?.head.id).toBe(verdict.outcome.winner.id);
  });

  it('counter tie → greater deviceId wins in the other direction too', async () => {
    // Head v2 = {2, dev-Z}; incoming tentative = {2, dev-L}; 'dev-L' < 'dev-Z' → head wins.
    const hashO = await h('base');
    const hashZ = await h('zed edit');
    const hashL = await h('local edit');
    let state = emptyArbitrationState();
    const v1 = arbitrateCommit(state, commit({ path: '/n.md', hash: hashO, size: 4 }), 'dev-A', NOW - 2000, DEVICES);
    state = v1.state;
    const v2 = arbitrateCommit(
      state,
      commit({ path: '/n.md', parentVersion: v1.outcome.newVersionId, hash: hashZ, size: 4 }),
      'dev-Z',
      NOW - 1000,
      DEVICES,
    );
    state = v2.state;
    const verdict = arbitrateCommit(
      state,
      commit({ path: '/n.md', parentVersion: v1.outcome.newVersionId, hash: hashL, size: 4 }),
      'dev-L',
      NOW,
      DEVICES,
    );
    expect(verdict.outcome.result).toBe('conflict');
    expect(verdict.outcome.winner.deviceId).toBe('dev-Z');
    expect(verdict.outcome.conflictCopy).toMatchObject({ hash: hashL, device: 'dev-L' });
  });

  it('a no-op edit (hash unchanged since the ancestor) loses the race without a copy', async () => {
    const f = await seededRace();
    // Incoming re-commits the ANCESTOR content on the stale parent, by a
    // device that loses the counter-2 tie to the head's dev-B.
    const verdict = arbitrateCommit(
      f.state,
      commit({ path: '/notes/todo.md', parentVersion: f.v1, hash: f.hashO, size: 4 }),
      'dev-A',
      NOW,
      DEVICES,
    );
    expect(verdict.outcome.result).toBe('conflict');
    expect(verdict.outcome.winner.deviceId).toBe('dev-B');
    // The loser's content equals the common ancestor's → nothing to preserve.
    expect(verdict.outcome.conflictCopy).toBeUndefined();
    expect(verdict.outcome.conflictCopyPath).toBeUndefined();
  });

  it('a no-op edit that WINS the tie still preserves the displaced real edit', async () => {
    const f = await seededRace();
    const verdict = arbitrateCommit(
      f.state,
      commit({ path: '/notes/todo.md', parentVersion: f.v1, hash: f.hashO, size: 4 }),
      'dev-L', // {2, dev-L} beats {2, dev-B}
      NOW,
      DEVICES,
    );
    expect(verdict.outcome.winner.deviceId).toBe('dev-L');
    // The loser is the head's real edit (hash R ≠ ancestor O) → it gets a copy.
    expect(verdict.outcome.conflictCopy).toMatchObject({ hash: f.hashR, device: 'dev-B' });
  });

  it('a same-content race (loser hash == winner hash) synthesizes no copy', async () => {
    const f = await seededRace();
    const verdict = arbitrateCommit(
      f.state,
      commit({ path: '/notes/todo.md', parentVersion: f.v1, hash: f.hashR, size: 11 }),
      'dev-Z', // wins the {2, dev-Z} vs {2, dev-B} tie
      NOW,
      DEVICES,
    );
    expect(verdict.outcome.winner.deviceId).toBe('dev-Z');
    expect(verdict.outcome.conflictCopy).toBeUndefined(); // identical bytes — nothing distinct lost
  });
});

describe('arbitrateCommit — add-vs-add (mirrors resolve.ts)', () => {
  it('both create the same new path → clocks arbitrate, loser preserved', async () => {
    const hashA = await h('alpha creates');
    const hashL = await h('local creates');
    const seeded = arbitrateCommit(
      emptyArbitrationState(),
      commit({ path: '/new.md', hash: hashA, size: 5 }),
      'dev-A',
      NOW - 1000,
      DEVICES,
    );
    // Incoming add by dev-L: tentative {1, dev-L} vs head {1, dev-A} → dev-L wins.
    const verdict = arbitrateCommit(seeded.state, commit({ path: '/new.md', hash: hashL, size: 5 }), 'dev-L', NOW, DEVICES);
    expect(verdict.outcome.result).toBe('conflict');
    expect(verdict.outcome.winner.deviceId).toBe('dev-L');
    expect(verdict.outcome.conflictCopy).toMatchObject({ path: COPY('/new.md', 'Alpha'), hash: hashA, device: 'dev-A' });
  });
});

describe('arbitrateCommit — delete-vs-edit (mirrors resolve.ts)', () => {
  it('incoming delete beats a real edit → the edit content is preserved as a copy', async () => {
    const f = await seededRace();
    const verdict = arbitrateCommit(
      f.state,
      commit({ path: '/notes/todo.md', parentVersion: f.v1, hash: f.hashO, size: 4, kind: 'delete' }),
      'dev-L', // {2, dev-L} beats {2, dev-B}
      NOW,
      DEVICES,
    );
    expect(verdict.outcome.result).toBe('conflict');
    expect(verdict.outcome.winner.kind).toBe('delete');
    expect(verdict.state.files.get('/notes/todo.md')?.deleted).toBe(true);
    expect(verdict.outcome.conflictCopy).toMatchObject({
      path: COPY('/notes/todo.md', 'Beta'),
      hash: f.hashR,
      device: 'dev-B',
    });
  });

  it('incoming delete loses to the edit → no copy (a deletion has no content)', async () => {
    const f = await seededRace();
    const verdict = arbitrateCommit(
      f.state,
      commit({ path: '/notes/todo.md', parentVersion: f.v1, hash: f.hashO, size: 4, kind: 'delete' }),
      'dev-A', // {2, dev-A} loses the tie to {2, dev-B}
      NOW,
      DEVICES,
    );
    expect(verdict.outcome.result).toBe('conflict');
    expect(verdict.outcome.winner.deviceId).toBe('dev-B');
    expect(verdict.state.files.get('/notes/todo.md')?.deleted).toBe(false);
    expect(verdict.outcome.conflictCopy).toBeUndefined();
  });

  it('incoming edit beats a tombstone → resurrection, no copy for the deleted loser', async () => {
    // Fresh file: v1 by dev-Z; tombstone v2 {2, dev-B} building on v1; then a
    // stale edit by dev-L {2, dev-L} — which wins the device tiebreak.
    const hashO = await h('base');
    const hashL = await h('local edit');
    let state = emptyArbitrationState();
    const v1 = arbitrateCommit(state, commit({ path: '/n.md', hash: hashO, size: 4 }), 'dev-Z', NOW - 3000, DEVICES);
    state = v1.state;
    const tombstone = arbitrateCommit(
      state,
      commit({ path: '/n.md', parentVersion: v1.outcome.newVersionId, hash: hashO, size: 4, kind: 'delete' }),
      'dev-B',
      NOW - 2000,
      DEVICES,
    );
    expect(tombstone.outcome.result).toBe('applied');
    const verdict = arbitrateCommit(
      tombstone.state,
      commit({ path: '/n.md', parentVersion: v1.outcome.newVersionId, hash: hashL, size: 10 }),
      'dev-L',
      NOW,
      DEVICES,
    );
    expect(verdict.outcome.result).toBe('conflict');
    expect(verdict.outcome.winner.kind).toBe('edit');
    expect(verdict.state.files.get('/n.md')?.deleted).toBe(false);
    expect(verdict.outcome.conflictCopy).toBeUndefined();
  });

  it('both delete → converge on the clock winner, no copies either way', async () => {
    const f = await seededRace();
    const tombstoned = arbitrateCommit(
      f.state,
      commit({ path: '/notes/todo.md', parentVersion: f.v2, hash: f.hashR, size: 11, kind: 'delete' }),
      'dev-B',
      NOW - 500,
      DEVICES,
    );
    const verdict = arbitrateCommit(
      tombstoned.state,
      commit({ path: '/notes/todo.md', parentVersion: f.v1, hash: f.hashO, size: 4, kind: 'delete' }),
      'dev-L',
      NOW,
      DEVICES,
    );
    expect(verdict.outcome.result).toBe('conflict');
    expect(verdict.outcome.winner.kind).toBe('delete');
    expect(verdict.state.files.get('/notes/todo.md')?.deleted).toBe(true);
    expect(verdict.outcome.conflictCopy).toBeUndefined();
  });
});

describe('arbitrateCommit — double conflict in one minute (pins the ` 2` suffix)', () => {
  it('two sequential stale-parent losses, same path/device/minute → the second copy takes ` 2` via the exists callback', async () => {
    // Base v1 by dev-A, standing head v2 {2, dev-Z} — dev-Z beats dev-L on
    // the counter-2 device tiebreak, so every stale edit by dev-L loses.
    const hashO = await h('base');
    const hashR = await h('remote edit');
    const loss1Content = await h('local edit one');
    const loss2Content = await h('local edit two');
    const seeded = arbitrateCommit(
      emptyArbitrationState(),
      commit({ path: '/notes/todo.md', hash: hashO, size: 4 }),
      'dev-A',
      NOW - 3000,
      DEVICES,
    );
    const headed = arbitrateCommit(
      seeded.state,
      commit({ path: '/notes/todo.md', parentVersion: seeded.outcome.newVersionId, hash: hashR, size: 11 }),
      'dev-Z',
      NOW - 2000,
      DEVICES,
    );

    // First stale-parent loss by dev-L, stamped NOW.
    const loss1 = arbitrateCommit(
      headed.state,
      commit({ path: '/notes/todo.md', parentVersion: seeded.outcome.newVersionId, hash: loss1Content, size: 15 }),
      'dev-L',
      NOW,
      DEVICES,
    );
    expect(loss1.outcome.result).toBe('conflict');
    expect(loss1.outcome.conflictCopyPath).toBe(COPY('/notes/todo.md', 'Local'));

    // Second stale-parent loss: same path, same device, same minute. The
    // first copy already occupies the base name — the exists callback
    // (preserveLoser → conflictCopyPath) must walk to the ` 2` suffix.
    const loss2 = arbitrateCommit(
      loss1.state,
      commit({ path: '/notes/todo.md', parentVersion: seeded.outcome.newVersionId, hash: loss2Content, size: 15 }),
      'dev-L',
      NOW,
      DEVICES,
    );
    expect(loss2.outcome.result).toBe('conflict');
    expect(loss2.outcome.conflictCopyPath).toBe(COPY('/notes/todo.md', 'Local').replace(/\.md$/, ' 2.md'));

    // Both copies exist as distinct live files with their own content.
    expect(loss2.state.files.get(COPY('/notes/todo.md', 'Local'))?.head.hash).toBe(loss1Content);
    expect(loss2.state.files.get(`${COPY('/notes/todo.md', 'Local').slice(0, -3)} 2.md`)?.head.hash).toBe(loss2Content);
  });
});

describe('arbitrateCommit — renames (mirrors resolve.ts FR-9)', () => {
  async function seededFile(content: string): Promise<{ state: ArbitrationState; hash: string; v1: string }> {
    const hash = await h(content);
    const first = arbitrateCommit(
      emptyArbitrationState(),
      commit({ path: '/notes/a.md', hash, size: content.length }),
      'dev-A',
      NOW - 1000,
      DEVICES,
    );
    return { state: first.state, hash, v1: first.outcome.newVersionId };
  }

  it('parent == source head → one chain migration, broadcast carries fromPath', async () => {
    const f = await seededFile('moved');
    const verdict = arbitrateCommit(
      f.state,
      commit({ path: '/notes/b.md', parentVersion: f.v1, hash: f.hash, size: 5, kind: 'rename', fromPath: '/notes/a.md' }),
      'dev-L',
      NOW,
      DEVICES,
    );
    expect(verdict.outcome.result).toBe('applied');
    expect(verdict.outcome.winner.kind).toBe('rename');
    expect(verdict.outcome.clock).toEqual({ counter: 2, deviceId: 'dev-L' });
    expect(verdict.outcome.broadcast).toMatchObject({ path: '/notes/b.md', fromPath: '/notes/a.md', kind: 'rename' });
    expect(verdict.state.files.has('/notes/a.md')).toBe(false);
    expect(verdict.state.files.get('/notes/b.md')?.head.parentVersion).toBe(f.v1);
  });

  it('rename onto an occupied path, rename wins → occupant content preserved', async () => {
    const moved = await h('moved');
    const theirs = await h('theirs');
    const f = await seededFile('moved');
    // dev-Z creates /notes/b.md concurrently: clock {1, dev-Z}.
    const occupied = arbitrateCommit(f.state, commit({ path: '/notes/b.md', hash: theirs, size: 5 }), 'dev-Z', NOW - 500, DEVICES);
    const verdict = arbitrateCommit(
      occupied.state,
      commit({ path: '/notes/b.md', parentVersion: f.v1, hash: moved, size: 5, kind: 'rename', fromPath: '/notes/a.md' }),
      'dev-L', // rename tentative {2, dev-L} beats occupant {1, dev-Z}
      NOW,
      DEVICES,
    );
    expect(verdict.outcome.result).toBe('conflict');
    expect(verdict.outcome.winner.kind).toBe('rename');
    expect(verdict.state.files.has('/notes/a.md')).toBe(false);
    expect(verdict.outcome.conflictCopy).toMatchObject({ path: COPY('/notes/b.md', 'Zed'), hash: theirs });
  });

  it('rename loses to the occupant → source intact, no copy (content is safe at fromPath)', async () => {
    const moved = await h('moved');
    const theirs = await h('theirs');
    const f = await seededFile('moved');
    const occupied = arbitrateCommit(f.state, commit({ path: '/notes/b.md', hash: theirs, size: 5 }), 'dev-Z', NOW - 500, DEVICES);
    // Occupant at counter 3 beats the rename tentative {2, dev-A}.
    let state = occupied.state;
    let parent = occupied.outcome.newVersionId;
    for (let i = 0; i < 2; i++) {
      const v = arbitrateCommit(state, commit({ path: '/notes/b.md', parentVersion: parent, hash: await h(`z${i}`), size: 2 }), 'dev-Z', NOW - 400 + i, DEVICES);
      state = v.state;
      parent = v.outcome.newVersionId;
    }
    const verdict = arbitrateCommit(
      state,
      commit({ path: '/notes/b.md', parentVersion: f.v1, hash: moved, size: 5, kind: 'rename', fromPath: '/notes/a.md' }),
      'dev-A',
      NOW,
      DEVICES,
    );
    expect(verdict.outcome.result).toBe('conflict');
    expect(verdict.outcome.winner.deviceId).toBe('dev-Z');
    expect(verdict.state.files.has('/notes/a.md')).toBe(true); // untouched
    expect(verdict.state.files.get('/notes/b.md')?.head.deviceId).toBe('dev-Z');
    expect(verdict.outcome.conflictCopy).toBeUndefined();
  });
});

describe('arbitrateCommit — purity, determinism, validation', () => {
  it('is pure: identical inputs → identical verdicts; the input state is not mutated', async () => {
    const f = await seededRace();
    const before = JSON.stringify({
      files: [...f.state.files.entries()],
      versions: [...f.state.versions.entries()],
    });
    const a = arbitrateCommit(f.state, f.staleCommit, 'dev-L', NOW, DEVICES);
    const b = arbitrateCommit(f.state, f.staleCommit, 'dev-L', NOW, DEVICES);
    expect(JSON.stringify(b.outcome)).toBe(JSON.stringify(a.outcome));
    expect(b.state).toEqual(a.state);
    expect(
      JSON.stringify({ files: [...f.state.files.entries()], versions: [...f.state.versions.entries()] }),
    ).toBe(before);
  });

  it('rejects commits naming an unknown parent version', () => {
    expect(() =>
      arbitrateCommit(
        emptyArbitrationState(),
        commit({ path: '/x.md', parentVersion: 'nope', hash: 'a', size: 1 }),
        'dev-A',
        NOW,
        DEVICES,
      ),
    ).toThrow(ProtocolError);
  });

  it('rejects rename commits without fromPath', () => {
    expect(() =>
      arbitrateCommit(
        emptyArbitrationState(),
        commit({ path: '/x.md', parentVersion: null, hash: 'a', size: 1, kind: 'rename' }),
        'dev-A',
        NOW,
        DEVICES,
      ),
    ).toThrow(ProtocolError);
  });
});

describe('client/server arbitration agreement (the contract the real DO must satisfy)', () => {
  /**
   * Mirror one race through both engines:
   *  - the SERVER arbitrates the incoming commit against the standing head;
   *  - the CLIENT predicts the outcome with `computeSyncPlan` from the same
   *    common ancestor (its index) and the same manifest (the standing head).
   * Both must pick the same winner — that is what makes conflict copies
   * converge to exactly one file per race.
   */
  function mirrorEditRace(
    headClock: { counter: number; deviceId: string },
    localDevice: string,
  ): { serverIncomingWon: boolean; clientLocalWon: boolean } {
    const headVersion = 'v-head';
    const ancestorVersion = 'v-ancestor';
    const hashO = '0'.repeat(64);
    const hashR = 'r'.repeat(64);
    const hashL = 'l'.repeat(64);

    // Server: ancestor v1 {1, dev-A} → head with the given clock.
    let state = emptyArbitrationState();
    const ancestor = arbitrateCommit(
      state,
      commit({ path: '/n.md', hash: hashO, size: 1 }),
      'dev-A',
      NOW - 3000,
      DEVICES,
    );
    state = ancestor.state;
    const head = arbitrateCommit(
      state,
      commit({ path: '/n.md', parentVersion: ancestor.outcome.newVersionId, hash: hashR, size: 1 }),
      headClock.deviceId,
      NOW - 2000,
      DEVICES,
    );
    // Bend the head's clock to the scenario (counter > 1 ⇒ further history).
    const headState: ArbitrationState = {
      files: new Map(head.state.files),
      versions: new Map(head.state.versions),
    };
    const headEntry = headState.files.get('/n.md');
    if (headEntry !== undefined) {
      const bumped = { ...headEntry, head: { ...headEntry.head, clock: headClock } };
      headState.files.set('/n.md', bumped);
      headState.versions.set(bumped.head.id, bumped.head);
    }
    const server = arbitrateCommit(
      headState,
      commit({ path: '/n.md', parentVersion: ancestor.outcome.newVersionId, hash: hashL, size: 1 }),
      localDevice,
      NOW,
      DEVICES,
    );

    // Client: same ancestor as index, same head as manifest, same local edit.
    const index: LocalIndex = {
      '/n.md': { hash: hashO, size: 1, versionId: ancestorVersion, clock: { counter: 1, deviceId: 'dev-A' } },
    };
    const manifest: RemoteFile[] = [
      {
        path: '/n.md',
        version: headVersion,
        hash: hashR,
        size: 1,
        deleted: false,
        clock: headClock,
        mtime: 0,
      },
    ];
    const localChanges: LocalChanges = {
      scannedAt: NOW,
      added: [],
      modified: [{ path: '/n.md', hash: hashL, size: 1 }],
      deleted: [],
      renamed: [],
      emptyFolders: [],
      folderDeletions: [],
      hashed: [],
    };
    const plan = computeSyncPlan({
      localChanges,
      index,
      manifest,
      thisDeviceId: localDevice,
      thisDeviceName: 'Local',
      now: NOW,
    });

    return {
      serverIncomingWon: server.outcome.winner.deviceId === localDevice,
      clientLocalWon: plan.conflicts[0]?.winner === 'local',
    };
  }

  it('agrees for every counter/device combination of the standing head', () => {
    const devices = ['dev-A', 'dev-B', 'dev-L', 'dev-Z'];
    const counters = [1, 2, 3, 7];
    let cases = 0;
    for (const counter of counters) {
      for (const headDevice of devices) {
        for (const localDevice of devices) {
          if (localDevice === headDevice) continue; // same device ⇒ not a race
          const { serverIncomingWon, clientLocalWon } = mirrorEditRace(
            { counter, deviceId: headDevice },
            localDevice,
          );
          expect(serverIncomingWon, `head {${counter},${headDevice}} vs local ${localDevice}`).toBe(clientLocalWon);
          cases += 1;
        }
      }
    }
    expect(cases).toBeGreaterThan(40); // the sweep actually covered the grid
  });

  it('agrees on add-vs-add races too', () => {
    for (const [headDevice, localDevice] of [
      ['dev-A', 'dev-Z'],
      ['dev-Z', 'dev-A'],
      ['dev-B', 'dev-L'],
    ] as const) {
      const hashA = 'a'.repeat(64);
      const hashL = 'l'.repeat(64);
      const seeded = arbitrateCommit(
        emptyArbitrationState(),
        commit({ path: '/new.md', hash: hashA, size: 1 }),
        headDevice,
        NOW - 1000,
        DEVICES,
      );
      const server = arbitrateCommit(seeded.state, commit({ path: '/new.md', hash: hashL, size: 1 }), localDevice, NOW, DEVICES);

      const plan = computeSyncPlan({
        localChanges: {
          scannedAt: NOW,
          added: [{ path: '/new.md', hash: hashL, size: 1 }],
          modified: [],
          deleted: [],
          renamed: [],
          emptyFolders: [],
          folderDeletions: [],
          hashed: [],
        },
        index: {},
        manifest: [
          {
            path: '/new.md',
            version: seeded.outcome.newVersionId,
            hash: hashA,
            size: 1,
            deleted: false,
            clock: { counter: 1, deviceId: headDevice },
            mtime: 0,
          },
        ],
        thisDeviceId: localDevice,
        thisDeviceName: 'Local',
        now: NOW,
      });

      expect(server.outcome.winner.deviceId === localDevice).toBe(plan.conflicts[0]?.winner === 'local');
    }
  });
});
