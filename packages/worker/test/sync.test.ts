/**
 * The WS sync protocol against the REAL Durable Object — the integration
 * counterpart of core's `simulation.test.ts`. Scenarios (a) and (b) are
 * ported from that suite (plus catch-up replay and validation edges); the
 * arbitration itself comes from `@vsa/core`, so outcomes must match the
 * simulation byte for byte.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  WsClient,
  adminLogin,
  b64,
  claim,
  dec,
  enc,
  hashOf,
  hello,
  mintPairingCode,
  pair,
  resetAll,
} from './helpers.js';
import type { ChangeMessage, CommitAckMessage, ConflictMessage, ManifestMessage } from '@vsa/core';

interface TwoDevices {
  desktop: { token: string; deviceId: string };
  mobile: { token: string; deviceId: string };
}

async function rig(): Promise<TwoDevices & { wsDesktop: WsClient; wsMobile: WsClient }> {
  const desktop = await claim({ passphrase: 'pppp', vaultName: 'personal', deviceName: 'Desktop' });
  const cookie = await adminLogin('pppp');
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
  ws.send(inlineCommitMessage(path, parent, bytes, hash));
  const answer = (await reply) as CommitAckMessage;
  expect(answer.type, JSON.stringify(answer)).toBe('commitAck');
  return answer;
}

// sha256 is async, so commits are prepared with their hash beforehand.
function inlineCommitMessage(path: string, parentVersion: string | null, bytes: Uint8Array, hash: string) {
  return {
    type: 'commit' as const,
    path,
    parentVersion,
    hash,
    size: bytes.byteLength,
    kind: 'edit' as const,
    inline: b64(bytes),
  };
}

const conflictCopies = (manifest: ManifestMessage): string[] =>
  Object.keys(manifest.entries).filter((p) => / \(conflict /.test(p));

beforeEach(async () => {
  await resetAll();
});

describe('scenario (a): an edit propagates to the other client', () => {
  it('hello -> helloAck carries identity and settings; empty manifest at cursor 0', async () => {
    const { desktop, wsDesktop } = await rig();
    // rig() already said hello; assert on the recorded ack.
    const ack = wsDesktop.messages.find((m) => m.type === 'helloAck');
    expect(ack).toMatchObject({
      type: 'helloAck',
      deviceId: desktop.deviceId,
      vaultName: 'personal',
      settings: { obsidianSync: false, displayName: 'personal' },
    });
    const manifest = await manifestOf(wsDesktop);
    expect(manifest.entries).toEqual({});
    expect(manifest.cursor).toBe(0);
  });

  it('inline commit fast-path -> commitAck, change fan-out to others only, manifest reflects it', async () => {
    const { desktop, mobile, wsDesktop, wsMobile } = await rig();
    const bytes = enc('first version');
    const ack = await expectCommitAck(wsDesktop, '/notes/shared.md', null, 'first version');
    expect(ack.version).toBe('v1');
    expect(ack.clock).toEqual({ counter: 1, deviceId: desktop.deviceId });
    expect(ack.seq).toBe(1);

    // The OTHER client receives the broadcast…
    const change = (await wsMobile.next((m) => m.type === 'change')) as ChangeMessage;
    expect(change).toMatchObject({
      type: 'change',
      seq: 1,
      path: '/notes/shared.md',
      version: 'v1',
      hash: await hashOf(bytes),
      size: bytes.byteLength,
      deleted: false,
      device: desktop.deviceId,
      clock: { counter: 1, deviceId: desktop.deviceId },
      kind: 'edit',
    });
    // …and the committer does NOT receive its own change.
    expect(wsDesktop.messages.some((m) => m.type === 'change')).toBe(false);

    // Presence: the second device's hello was broadcast to the first.
    expect(wsDesktop.messages.some((m) => m.type === 'deviceSeen' && m.deviceId === mobile.deviceId)).toBe(true);

    const manifest = await manifestOf(wsMobile);
    expect(Object.keys(manifest.entries)).toEqual(['/notes/shared.md']);
    expect(manifest.entries['/notes/shared.md']).toMatchObject({
      version: 'v1',
      hash: await hashOf(bytes),
      size: bytes.byteLength,
      deleted: false,
    });
    expect(manifest.cursor).toBe(1);

    // Inline content was persisted to the CAS: getBlob over the WS serves it.
    const blobReply = await (async () => {
      const reply = wsMobile.next((m) => m.type === 'blob' || m.type === 'error');
      wsMobile.send({ type: 'getBlob', hash: await hashOf(bytes) });
      return reply;
    })();
    expect(blobReply.type).toBe('blob');
    expect(dec(enc('first version'))).toBe('first version'); // sanity
    expect((blobReply as { content: string }).content).toBe(b64(bytes));

    // Ping/pong keeps the connection alive.
    const pong = await (async () => {
      const reply = wsDesktop.next((m) => m.type === 'pong');
      wsDesktop.send({ type: 'ping', ts: 4242 });
      return reply;
    })();
    expect(pong).toEqual({ type: 'pong', ts: 4242 });
  });
});

describe('scenario (b): offline edits race -> exactly one conflict copy everywhere', () => {
  it('stale-parent commit conflicts; loser content survives as THE conflict copy broadcast to all', async () => {
    const { desktop, mobile, wsDesktop, wsMobile } = await rig();

    // Common ancestor.
    const base = await expectCommitAck(wsDesktop, '/notes/note.md', null, 'base');
    expect(base.version).toBe('v1');

    // Desktop reconnects first in effect: fast-path on top of v1.
    const desktopEdit = enc('desktop edit');
    const desktopHash = await hashOf(desktopEdit);
    const ack2 = await expectCommitAck(wsDesktop, '/notes/note.md', 'v1', 'desktop edit');
    expect(ack2.version).toBe('v2');
    expect(ack2.clock).toEqual({ counter: 2, deviceId: desktop.deviceId });

    // Mobile (unaware of v2) commits on the stale parent v1.
    const mobileEdit = enc('mobile edit');
    const mobileHash = await hashOf(mobileEdit);
    const conflictPromise = wsMobile.next(
      (m) => m.type === 'conflict' || m.type === 'commitAck' || m.type === 'error',
    );
    wsMobile.send(inlineCommitMessage('/notes/note.md', 'v1', mobileEdit, mobileHash));
    const conflict = (await conflictPromise) as ConflictMessage;
    expect(conflict.type).toBe('conflict');
    expect(conflict.loserDisposition).toBe('conflictCopy');

    // Deterministic winner: tentative {2, mobile} vs standing {2, desktop} ->
    // greater deviceId wins (same rule the simulation exercises).
    const mobileWins = mobile.deviceId > desktop.deviceId;
    const winnerHash = mobileWins ? mobileHash : desktopHash;
    const loserHash = mobileWins ? desktopHash : mobileHash;
    const loserName = mobileWins ? 'Desktop' : 'Mobile';
    const loserWs = mobileWins ? wsDesktop : wsMobile;
    const winnerWs = mobileWins ? wsMobile : wsDesktop;

    expect(conflict.winner.hash).toBe(winnerHash);
    expect(conflict.winner.clock).toEqual({
      counter: 2,
      deviceId: mobileWins ? mobile.deviceId : desktop.deviceId,
    });
    // Seq bookkeeping mirrors the in-memory server: a displaced head records
    // a fresh seq for the new winner; a standing head keeps its old seq.
    const winnerSeq = mobileWins ? 3 : 2;
    const copySeq = mobileWins ? 4 : 3;
    expect(conflict.seq).toBe(winnerSeq);

    // If mobile won, the OTHER socket learns the new head via fan-out.
    if (mobileWins) {
      const change = (await wsDesktop.next((m) => m.type === 'change' && m.seq === 3)) as ChangeMessage;
      expect(change.hash).toBe(mobileHash);
    }

    // THE conflict copy is broadcast to ALL — including the committer.
    const copyChangeLoser = (await loserWs.next(
      (m) => m.type === 'change' && m.kind === 'conflictCopy',
    )) as ChangeMessage;
    const copyChangeWinner = (await winnerWs.next(
      (m) => m.type === 'change' && m.kind === 'conflictCopy',
    )) as ChangeMessage;
    expect(copyChangeLoser.path).toBe(copyChangeWinner.path);
    expect(copyChangeLoser.hash).toBe(loserHash);
    expect(copyChangeLoser.path).toMatch(
      new RegExp(`^/notes/note \\(conflict \\d{4}-\\d{2}-\\d{2} \\d{2}-\\d{2} - from ${loserName}\\)\\.md$`),
    );
    expect(copyChangeLoser.seq).toBe(copySeq);

    // The manifest shows exactly one head + one copy, winner content on top.
    const manifest = await manifestOf(wsMobile);
    expect(manifest.entries['/notes/note.md']!.hash).toBe(winnerHash);
    expect(manifest.entries['/notes/note.md']!.clock).toEqual(conflict.winner.clock);
    const copies = conflictCopies(manifest);
    expect(copies).toHaveLength(1);
    expect(manifest.entries[copies[0]!]!.hash).toBe(loserHash);
    expect(manifest.cursor).toBe(copySeq);
  });
});

describe('catch-up replay (§5)', () => {
  it('hello with a cursor replays every change since, and only those', async () => {
    const { desktop } = await rig();
    const ws1 = await WsClient.connect();
    await hello(ws1, desktop.token);
    await expectCommitAck(ws1, '/notes/a.md', null, 'a');
    await expectCommitAck(ws1, '/notes/b.md', null, 'b');
    ws1.close();

    // A client that saw seq 1 gets exactly seq 2 replayed.
    const catchUp = await WsClient.connect();
    await hello(catchUp, desktop.token, 1);
    const replayed = (await catchUp.next((m) => m.type === 'change')) as ChangeMessage;
    expect(replayed.seq).toBe(2);
    expect(replayed.path).toBe('/notes/b.md');
    expect(
      catchUp.messages.filter((m) => m.type === 'change').map((m) => (m as ChangeMessage).seq),
    ).toEqual([2]);

    // A first-ever connect (cursor 0) gets the full manifest instead.
    const fresh = await WsClient.connect();
    await hello(fresh, desktop.token, 0);
    expect(fresh.messages.some((m) => m.type === 'change')).toBe(false);
    const manifest = await manifestOf(fresh);
    expect(Object.keys(manifest.entries).sort()).toEqual(['/notes/a.md', '/notes/b.md']);
  });

  it('delta manifests return only entries newer than `since`', async () => {
    const { desktop } = await rig();
    const ws = await WsClient.connect();
    await hello(ws, desktop.token);
    await expectCommitAck(ws, '/x/one.md', null, 'one');
    await expectCommitAck(ws, '/x/two.md', null, 'two');
    const reply = ws.next((m) => m.type === 'manifest');
    ws.send({ type: 'getManifest', since: 1 });
    const delta = (await reply) as ManifestMessage;
    expect(Object.keys(delta.entries)).toEqual(['/x/two.md']);
  });
});

describe('commit validation and edge kinds', () => {
  it('rejects an inline size mismatch', async () => {
    const { wsDesktop } = await rig();
    const reply = wsDesktop.next((m) => m.type === 'error');
    wsDesktop.send({
      type: 'commit',
      path: '/bad.md',
      parentVersion: null,
      hash: await hashOf(enc('hello')),
      size: 999,
      kind: 'edit',
      inline: b64(enc('hello')),
    });
    expect(await reply).toMatchObject({ type: 'error', code: 'PROTOCOL' });
  });

  it('rejects a hash that does not match the inline content', async () => {
    const { wsDesktop } = await rig();
    const reply = wsDesktop.next((m) => m.type === 'error');
    wsDesktop.send({
      type: 'commit',
      path: '/bad.md',
      parentVersion: null,
      hash: await hashOf(enc('other')),
      size: 5,
      kind: 'edit',
      inline: b64(enc('hello')),
    });
    expect(await reply).toMatchObject({ type: 'error', code: 'PROTOCOL' });
  });

  it('rejects a commit whose blob was never uploaded', async () => {
    const { wsDesktop } = await rig();
    const missing = await hashOf(enc('never uploaded'));
    const reply = wsDesktop.next((m) => m.type === 'error');
    wsDesktop.send({
      type: 'commit',
      path: '/never.md',
      parentVersion: null,
      hash: missing,
      size: enc('never uploaded').byteLength,
      kind: 'edit',
    });
    const error = await reply;
    expect(error).toMatchObject({ type: 'error', code: 'NOT_FOUND' });
    expect((error as { message: string }).message).toContain(missing);
  });

  it('deletes propagate as tombstones (manifest deleted:true)', async () => {
    const { wsDesktop, wsMobile } = await rig();
    await expectCommitAck(wsDesktop, '/notes/doomed.md', null, 'soon gone');
    const reply = wsDesktop.next((m) => m.type === 'commitAck');
    wsDesktop.send({
      type: 'commit',
      path: '/notes/doomed.md',
      parentVersion: 'v1',
      hash: await hashOf(enc('soon gone')),
      size: enc('soon gone').byteLength,
      kind: 'delete',
    });
    const ack = (await reply) as CommitAckMessage;
    expect(ack.version).toBe('v2');
    const change = (await wsMobile.next((m) => m.type === 'change' && m.kind === 'delete')) as ChangeMessage;
    expect(change.deleted).toBe(true);
    const manifest = await manifestOf(wsDesktop);
    expect(manifest.entries['/notes/doomed.md']!.deleted).toBe(true);
    expect(manifest.entries['/notes/doomed.md']!.version).toBe('v2');
  });

  it('empty folders sync as placeholder entries (FR-10)', async () => {
    const { wsDesktop } = await rig();
    const reply = wsDesktop.next((m) => m.type === 'commitAck');
    wsDesktop.send({
      type: 'commit',
      path: '/projects/empty',
      parentVersion: null,
      hash: '',
      size: 0,
      kind: 'edit',
      isFolder: true,
    });
    expect(await reply).toMatchObject({ type: 'commitAck' });
    const manifest = await manifestOf(wsDesktop);
    expect(manifest.entries['/projects/empty']).toMatchObject({ isFolder: true, hash: '', size: 0 });
  });

  it('putBlob over the WS verifies the hash; a bad one is rejected', async () => {
    const { wsDesktop } = await rig();
    const bytes = enc('over the wire');
    const good = await hashOf(bytes);
    const bad = await hashOf(enc('different'));
    const badReply = wsDesktop.next((m) => m.type === 'error');
    wsDesktop.send({ type: 'putBlob', hash: bad, content: b64(bytes) });
    expect(await badReply).toMatchObject({ type: 'error', code: 'PROTOCOL' });

    const ack = wsDesktop.next((m) => m.type === 'blobAck');
    wsDesktop.send({ type: 'putBlob', hash: good, content: b64(bytes) });
    expect(await ack).toEqual({ type: 'blobAck', hash: good });

    // And a commit may now reference it without inline content.
    const commitReply = wsDesktop.next((m) => m.type === 'commitAck' || m.type === 'error');
    wsDesktop.send({
      type: 'commit',
      path: '/notes/blobs.md',
      parentVersion: null,
      hash: good,
      size: bytes.byteLength,
      kind: 'edit',
    });
    expect(await commitReply).toMatchObject({ type: 'commitAck', version: 'v1' });
  });
});
