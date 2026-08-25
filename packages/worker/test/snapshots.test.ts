/**
 * Vault-level snapshots against the REAL Durable Object: snapshotCreate
 * captures every head, snapshotRestore reverts the vault as new versions
 * (kind 'restore' + re-tombstones) with full fan-out, refcount, and version
 * retention intact, plus the HTTP list surface and MIGRATION_2 idempotence.
 * The arbitration comes from `@vsa/core` — outcomes must match
 * core/test/snapshots.test.ts byte for byte.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  WsClient,
  adminLogin,
  b64,
  callRoom,
  claim,
  enc,
  get,
  hashOf,
  hello,
  mintPairingCode,
  pair,
  resetAll,
  roomSql,
} from './helpers.js';
import type { ChangeMessage, CommitAckMessage, ManifestMessage, ServerMessage } from '@vsa/core';

type SnapshotCreateAck = Extract<ServerMessage, { type: 'snapshotCreateAck' }>;
type SnapshotRestoreAck = Extract<ServerMessage, { type: 'snapshotRestoreAck' }>;

interface TwoDevices {
  desktop: { token: string; deviceId: string };
  mobile: { token: string; deviceId: string };
}

async function rig(): Promise<TwoDevices & { wsDesktop: WsClient; wsMobile: WsClient }> {
  const desktop = await claim({ passphrase: 'pppppppp', vaultName: 'personal', deviceName: 'Desktop' });
  const cookie = await adminLogin('pppppppp');
  const code = await mintPairingCode(cookie, 'Mobile', 'mobile');
  const mobile = await pair(code, 'Mobile', 'mobile');
  const wsDesktop = await WsClient.connect();
  const wsMobile = await WsClient.connect();
  await hello(wsDesktop, desktop.token);
  await hello(wsMobile, mobile.token);
  return { desktop, mobile, wsDesktop, wsMobile };
}

const manifestOf = async (ws: WsClient): Promise<ManifestMessage> =>
  (await (() => {
    const reply = ws.next((m) => m.type === 'manifest');
    ws.send({ type: 'getManifest' });
    return reply;
  })()) as ManifestMessage;

async function expectCommitAck(ws: WsClient, path: string, parent: string | null, content: string) {
  const bytes = enc(content);
  const hash = await hashOf(bytes);
  const reply = ws.next((m) => m.type === 'commitAck' || m.type === 'conflict' || m.type === 'error');
  ws.send({
    type: 'commit',
    path,
    parentVersion: parent,
    hash,
    size: bytes.byteLength,
    kind: 'edit',
    inline: b64(bytes),
  });
  const answer = (await reply) as CommitAckMessage;
  expect(answer.type, JSON.stringify(answer)).toBe('commitAck');
  return answer;
}

async function deleteCommit(ws: WsClient, path: string, parent: string, content: string) {
  const bytes = enc(content);
  const reply = ws.next((m) => m.type === 'commitAck' || m.type === 'error');
  ws.send({
    type: 'commit',
    path,
    parentVersion: parent,
    hash: await hashOf(bytes),
    size: bytes.byteLength,
    kind: 'delete',
  });
  const answer = await reply;
  expect(answer.type, JSON.stringify(answer)).toBe('commitAck');
}

beforeEach(async () => {
  await resetAll();
});

describe('snapshotCreate', () => {
  it('captures every head; ack carries id/name/ts/seq/fileCount; no fan-out, no change events', async () => {
    const { wsDesktop, wsMobile } = await rig();
    await expectCommitAck(wsDesktop, '/notes/one.md', null, 'one v1');
    await expectCommitAck(wsDesktop, '/notes/two.md', null, 'two v1');

    const reply = wsDesktop.next((m) => m.type === 'snapshotCreateAck' || m.type === 'error');
    wsDesktop.send({ type: 'snapshotCreate', name: 'before-agent' });
    const ack = (await reply) as SnapshotCreateAck;
    expect(ack).toMatchObject({ id: 's1', name: 'before-agent', fileCount: 2, seq: 2 });
    expect(typeof ack.ts).toBe('number');

    // Nothing live reached the other client beyond the two baseline change
    // fan-outs, and no change events were recorded for the snapshot itself.
    expect(wsMobile.messages.filter((m) => m.type === 'change')).toHaveLength(2);
    expect(wsMobile.messages.some((m) => m.type === 'snapshotCreateAck')).toBe(false);
    const rows = await roomSql<{ kind: string }>("SELECT kind FROM events WHERE kind = 'snapshot'");
    expect(rows).toHaveLength(1);

    // The snapshot row pinned the exact head state.
    const stored = await roomSql<{ id: string; name: string; heads: string }>(
      'SELECT id, name, heads FROM snapshots',
    );
    expect(stored).toHaveLength(1);
    const heads = JSON.parse(stored[0]!.heads) as Record<string, { version: string; deleted: boolean }>;
    expect(Object.keys(heads).sort()).toEqual(['/notes/one.md', '/notes/two.md']);
    expect(heads['/notes/one.md']!.version).toBe('v1');
  });

  it('unnamed snapshots store the empty string', async () => {
    const { wsDesktop } = await rig();
    const reply = wsDesktop.next((m) => m.type === 'snapshotCreateAck');
    wsDesktop.send({ type: 'snapshotCreate' });
    expect(await reply).toMatchObject({ id: 's1', name: '', fileCount: 0 });
  });
});

describe('snapshotRestore', () => {
  it('reverts edits, resurrects deletes, tombstones post-snapshot files — as new versions with fan-out', async () => {
    const { desktop, wsDesktop, wsMobile } = await rig();

    // Baseline: three files.
    await expectCommitAck(wsDesktop, '/notes/one.md', null, 'one v1');
    await expectCommitAck(wsDesktop, '/notes/two.md', null, 'two v1');
    await expectCommitAck(wsDesktop, '/notes/three.md', null, 'three v1');
    const oneV1Hash = await hashOf(enc('one v1'));

    const snapReply = wsDesktop.next((m) => m.type === 'snapshotCreateAck');
    wsDesktop.send({ type: 'snapshotCreate', name: 's' });
    const snap = (await snapReply) as SnapshotCreateAck;
    expect(snap.id).toBe('s1');

    // Diverge: edit one.md, add a new file, delete two.md.
    await expectCommitAck(wsDesktop, '/notes/one.md', 'v1', 'one v2 (bad)');
    await expectCommitAck(wsDesktop, '/notes/extra.md', null, 'extra');
    await deleteCommit(wsDesktop, '/notes/two.md', 'v2', 'two v1');

    const versionsBefore = (await roomSql<{ n: number }>('SELECT COUNT(*) AS n FROM versions'))[0]!.n;
    const blobRefcount = async (): Promise<number> =>
      (await roomSql<{ hash: string; refcount: number }>('SELECT hash, refcount FROM blobs')).find(
        (row) => row.hash === oneV1Hash,
      )!.refcount;
    const refcountBefore = await blobRefcount();

    const restoreReply = wsDesktop.next((m) => m.type === 'snapshotRestoreAck' || m.type === 'error');
    wsDesktop.send({ type: 'snapshotRestore', id: 's1' });
    const ack = (await restoreReply) as SnapshotRestoreAck;
    // one.md reverted + two.md resurrected = restored; extra.md = tombstoned.
    expect(ack).toMatchObject({ restored: 2, tombstoned: 1 });
    expect(ack.seq).toBe(9); // 3 baseline + 3 divergence + 3 restore changes

    // The OTHER client receives every restore change (seq-filtered past the
    // buffered baseline/divergence fan-outs): one.md restore, extra.md
    // tombstone, two.md resurrection.
    const changes: ChangeMessage[] = [];
    for (let i = 0; i < 3; i++) {
      changes.push((await wsMobile.next((m) => m.type === 'change' && m.seq > 6)) as ChangeMessage);
    }
    expect(changes.map((c) => `${c.path}:${c.kind}:${c.deleted ? 'del' : 'live'}`).sort()).toEqual([
      '/notes/extra.md:delete:del',
      '/notes/one.md:restore:live',
      '/notes/two.md:restore:live',
    ]);
    for (const change of changes) {
      expect(change.device).toBe(desktop.deviceId);
      expect(change.seq).toBeGreaterThan(6);
    }

    // The manifest on BOTH sockets shows exactly the snapshot state.
    for (const ws of [wsDesktop, wsMobile]) {
      const manifest = await manifestOf(ws);
      expect(manifest.entries['/notes/one.md']).toMatchObject({ hash: oneV1Hash, deleted: false });
      expect(manifest.entries['/notes/two.md']).toMatchObject({ deleted: false });
      expect(manifest.entries['/notes/three.md']).toMatchObject({ deleted: false, version: 'v3' });
      expect(manifest.entries['/notes/extra.md']).toMatchObject({ deleted: true });
      expect(manifest.cursor).toBe(9);
    }

    // New restore versions exist, no version row was deleted, refcounts grew.
    const kinds = await roomSql<{ kind: string; n: number }>(
      'SELECT kind, COUNT(*) AS n FROM versions GROUP BY kind',
    );
    const byKind = new Map(kinds.map((row) => [row.kind, row.n]));
    expect(byKind.get('restore')).toBe(2);
    expect(byKind.get('edit')).toBe(5); // 3 baseline + 2 divergence edits
    expect(byKind.get('delete')).toBe(2); // 1 divergence delete + 1 restore tombstone
    const versionsAfter = (await roomSql<{ n: number }>('SELECT COUNT(*) AS n FROM versions'))[0]!.n;
    expect(versionsAfter).toBe(versionsBefore + 3);
    expect(await blobRefcount()).toBe(refcountBefore + 1);
  });

  it('restoring an unchanged vault acks zeros; unknown ids error NOT_FOUND', async () => {
    const { wsDesktop } = await rig();
    await expectCommitAck(wsDesktop, '/notes/stable.md', null, 'stable');
    const snapReply = wsDesktop.next((m) => m.type === 'snapshotCreateAck');
    wsDesktop.send({ type: 'snapshotCreate' });
    await snapReply;

    const restoreReply = wsDesktop.next((m) => m.type === 'snapshotRestoreAck');
    wsDesktop.send({ type: 'snapshotRestore', id: 's1' });
    expect(await restoreReply).toMatchObject({ id: 's1', restored: 0, tombstoned: 0, seq: 1 });

    const errorReply = wsDesktop.next((m) => m.type === 'error');
    wsDesktop.send({ type: 'snapshotRestore', id: 's404' });
    expect(await errorReply).toMatchObject({ type: 'error', code: 'NOT_FOUND' });
  });

  it('a reconnecting client replays the restore changes from the events log', async () => {
    const { desktop, wsDesktop } = await rig();
    await expectCommitAck(wsDesktop, '/notes/one.md', null, 'one v1');
    const snapReply = wsDesktop.next((m) => m.type === 'snapshotCreateAck');
    wsDesktop.send({ type: 'snapshotCreate' });
    await snapReply;
    await expectCommitAck(wsDesktop, '/notes/one.md', 'v1', 'one v2');
    const restoreReply = wsDesktop.next((m) => m.type === 'snapshotRestoreAck');
    wsDesktop.send({ type: 'snapshotRestore', id: 's1' });
    await restoreReply;
    wsDesktop.close();

    // Cursor 2 (post-creation, pre-restore): only the restore change replays.
    const catchUp = await WsClient.connect();
    await hello(catchUp, desktop.token, 2);
    const replayed = (await catchUp.next((m) => m.type === 'change')) as ChangeMessage;
    expect(replayed.kind).toBe('restore');
    expect(replayed.hash).toBe(await hashOf(enc('one v1')));
    const manifest = await manifestOf(catchUp);
    expect(manifest.entries['/notes/one.md']!.hash).toBe(await hashOf(enc('one v1')));
  });

  it('folder placeholders round-trip: deleted folders restore with isFolder intact', async () => {
    const { wsDesktop } = await rig();

    // A folder placeholder (FR-10): hash '', size 0, isFolder.
    const folderAck = wsDesktop.next((m) => m.type === 'commitAck' || m.type === 'error');
    wsDesktop.send({
      type: 'commit',
      path: '/projects/empty',
      parentVersion: null,
      hash: '',
      size: 0,
      kind: 'edit',
      isFolder: true,
    });
    const created = (await folderAck) as CommitAckMessage;

    const snapReply = wsDesktop.next((m) => m.type === 'snapshotCreateAck');
    wsDesktop.send({ type: 'snapshotCreate', name: 'with-folder' });
    expect(await snapReply).toMatchObject({ id: 's1', fileCount: 1 });

    // Delete the folder — the tombstone carries isFolder (pipeline shape).
    const delReply = wsDesktop.next((m) => m.type === 'commitAck' || m.type === 'error');
    wsDesktop.send({
      type: 'commit',
      path: '/projects/empty',
      parentVersion: created.version,
      hash: '',
      size: 0,
      kind: 'delete',
      isFolder: true,
    });
    await delReply;
    expect((await manifestOf(wsDesktop)).entries['/projects/empty']).toMatchObject({ deleted: true });

    // Restore: the placeholder comes back, still a folder.
    const restoreReply = wsDesktop.next((m) => m.type === 'snapshotRestoreAck' || m.type === 'error');
    wsDesktop.send({ type: 'snapshotRestore', id: 's1' });
    expect(await restoreReply).toMatchObject({ restored: 1, tombstoned: 0 });
    const manifest = await manifestOf(wsDesktop);
    expect(manifest.entries['/projects/empty']).toMatchObject({
      deleted: false,
      isFolder: true,
      hash: '',
      size: 0,
    });
  });

  it('restoring an empty-vault snapshot tombstones everything added since', async () => {
    const { desktop, wsDesktop, wsMobile } = await rig();
    const snapReply = wsDesktop.next((m) => m.type === 'snapshotCreateAck');
    wsDesktop.send({ type: 'snapshotCreate', name: 'blank-slate' });
    expect(await snapReply).toMatchObject({ id: 's1', fileCount: 0 });

    await expectCommitAck(wsDesktop, '/notes/a.md', null, 'a');
    await expectCommitAck(wsDesktop, '/notes/b.md', null, 'b');
    await expectCommitAck(wsDesktop, '/attachments/c.bin', null, 'c');

    const restoreReply = wsDesktop.next((m) => m.type === 'snapshotRestoreAck' || m.type === 'error');
    wsDesktop.send({ type: 'snapshotRestore', id: 's1' });
    const ack = (await restoreReply) as SnapshotRestoreAck;
    expect(ack).toMatchObject({ restored: 0, tombstoned: 3 });
    expect(ack.seq).toBe(6); // 3 baseline changes + 3 restore tombstones

    const manifest = await manifestOf(wsDesktop);
    for (const path of ['/notes/a.md', '/notes/b.md', '/attachments/c.bin']) {
      expect(manifest.entries[path]).toMatchObject({ deleted: true });
    }

    // The live peer received every tombstone as a delete change.
    const changes: ChangeMessage[] = [];
    for (let i = 0; i < 3; i++) {
      changes.push((await wsMobile.next((m) => m.type === 'change' && m.seq > 3)) as ChangeMessage);
    }
    expect(changes.every((c) => c.kind === 'delete' && c.deleted)).toBe(true);
    expect(changes.map((c) => c.path).sort()).toEqual(['/attachments/c.bin', '/notes/a.md', '/notes/b.md']);
    for (const change of changes) expect(change.device).toBe(desktop.deviceId);
  });

  it('a phase-1 abort (arbitration throw) leaves zero durable effect', async () => {
    const { wsDesktop, wsMobile } = await rig();
    await expectCommitAck(wsDesktop, '/notes/one.md', null, 'one v1');
    await expectCommitAck(wsDesktop, '/notes/two.md', null, 'two v1');
    const snapReply = wsDesktop.next((m) => m.type === 'snapshotCreateAck');
    wsDesktop.send({ type: 'snapshotCreate', name: 's' });
    await snapReply;
    await expectCommitAck(wsDesktop, '/notes/one.md', 'v1', 'one v2 (bad)');
    await expectCommitAck(wsDesktop, '/notes/two.md', 'v2', 'two v2 (bad)');

    const versionsBefore = (await roomSql<{ n: number }>('SELECT COUNT(*) AS n FROM versions'))[0]!.n;
    const changesBefore =
      (await roomSql<{ n: number }>("SELECT COUNT(*) AS n FROM events WHERE kind = 'change'"))[0]!.n;

    // SQL surgery: one.md's chain pointer names a version that does not
    // exist, so the restore plan's first arbitration — pure, phase 1 —
    // throws before any durable effect can happen.
    await roomSql("UPDATE files SET current_version = 'v999' WHERE path = '/notes/one.md'");

    const errorReply = wsDesktop.next((m) => m.type === 'error');
    wsDesktop.send({ type: 'snapshotRestore', id: 's1' });
    expect(await errorReply).toMatchObject({ type: 'error', code: 'PROTOCOL' });

    // Zero durable effect: no version rows, no change events, no
    // snapshot_restore event, the (corrupt) files rows untouched, and no
    // fan-out beyond the baseline commits.
    expect((await roomSql<{ n: number }>('SELECT COUNT(*) AS n FROM versions'))[0]!.n).toBe(
      versionsBefore,
    );
    expect(
      (await roomSql<{ n: number }>("SELECT COUNT(*) AS n FROM events WHERE kind = 'change'"))[0]!.n,
    ).toBe(changesBefore);
    expect(
      (await roomSql<{ n: number }>("SELECT COUNT(*) AS n FROM events WHERE kind = 'snapshot_restore'"))[0]!
        .n,
    ).toBe(0);
    const one = await roomSql<{ current_version: string }>(
      "SELECT current_version FROM files WHERE path = '/notes/one.md'",
    );
    expect(one[0]!.current_version).toBe('v999');
    expect(wsMobile.messages.filter((m) => m.type === 'change')).toHaveLength(4);
  });
});

describe('GET /api/snapshots', () => {
  it('lists summaries newest-first with the device token; rejects without auth', async () => {
    const { desktop, wsDesktop } = await rig();
    await expectCommitAck(wsDesktop, '/notes/one.md', null, 'one v1');

    const first = wsDesktop.next((m) => m.type === 'snapshotCreateAck');
    wsDesktop.send({ type: 'snapshotCreate', name: 'older' });
    const firstAck = (await first) as SnapshotCreateAck;
    const second = wsDesktop.next((m) => m.type === 'snapshotCreateAck');
    wsDesktop.send({ type: 'snapshotCreate', name: 'newer' });
    const secondAck = (await second) as SnapshotCreateAck;
    expect(secondAck.ts).toBeGreaterThanOrEqual(firstAck.ts);

    const denied = await get('/api/snapshots');
    expect(denied.status).toBe(401);

    const res = await get('/api/snapshots', { authorization: `Bearer ${desktop.token}` });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      snapshots: Array<{ id: string; name: string; ts: number; deviceId: string; seq: number; fileCount: number }>;
    };
    expect(body.snapshots.map((s) => s.id)).toEqual(['s2', 's1']);
    expect(body.snapshots[0]).toMatchObject({
      name: 'newer',
      deviceId: desktop.deviceId,
      seq: 1,
      fileCount: 1,
    });
  });

  it('accepts the admin session cookie (the /api/status auth pattern)', async () => {
    const claimed = await claim({ passphrase: 'pppppppp', vaultName: 'personal', deviceName: 'Desktop' });
    const cookie = await adminLogin('pppppppp');
    const wsDesktop = await WsClient.connect();
    await hello(wsDesktop, claimed.token);
    const snapReply = wsDesktop.next((m) => m.type === 'snapshotCreateAck');
    wsDesktop.send({ type: 'snapshotCreate', name: 'via-cookie' });
    await snapReply;

    const adminRes = await get('/api/snapshots', { cookie });
    expect(adminRes.status).toBe(200);
    const body = (await adminRes.json()) as {
      snapshots: Array<{ id: string; name: string; deviceId: string; fileCount: number }>;
    };
    expect(body.snapshots).toHaveLength(1);
    expect(body.snapshots[0]).toMatchObject({
      id: 's1',
      name: 'via-cookie',
      deviceId: claimed.deviceId,
      fileCount: 0,
    });
  });
});

describe('MIGRATION_2 (snapshots table)', () => {
  it('schema version ends at 2 and re-running applyMigrations is harmless', async () => {
    const { wsDesktop } = await rig();

    // resetAll (beforeEach) wipes `meta`, and the DO caches its schema-ready
    // promise — so re-apply migrations explicitly, like a fresh isolate would.
    const version = async (): Promise<string> =>
      (await roomSql<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version'"))[0]!.value;
    const applyMigrations = (): Promise<void> =>
      callRoom((instance) => {
        (instance as unknown as { applyMigrations(): Promise<void> }).applyMigrations();
      });
    await applyMigrations();
    expect(await version()).toBe('3');

    const snapReply = wsDesktop.next((m) => m.type === 'snapshotCreateAck');
    wsDesktop.send({ type: 'snapshotCreate', name: 'keeper' });
    await snapReply;

    // Restart-safe: applying pending migrations again must not disturb data
    // (the ALTER-based migration 0003 skips cleanly over existing columns).
    await applyMigrations();
    expect(await version()).toBe('3');
    const rows = await roomSql<{ id: string; name: string }>('SELECT id, name FROM snapshots');
    expect(rows).toEqual([{ id: 's1', name: 'keeper' }]);
  });
});
