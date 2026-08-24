/**
 * Free-tier longevity pack on the real DO: version retention (the weekly
 * cron's history compaction), the advisory quota, and the /backup escape
 * hatch — heads + history + blobs as one streamed NDJSON archive.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import type { CommitAckMessage, ServerMessage } from '@vsa/core';
import {
  adminLogin,
  b64,
  claim,
  enc,
  hashOf,
  hello,
  post,
  request,
  resetAll,
  roomInternal,
  setRoomTime,
  WsClient,
} from './helpers.js';

async function commitInline(
  ws: WsClient,
  path: string,
  parent: string | null,
  content: string,
): Promise<CommitAckMessage> {
  const bytes = enc(content);
  const reply = ws.next((m) => m.type === 'commitAck' || m.type === 'error');
  ws.send({
    type: 'commit',
    path,
    parentVersion: parent,
    hash: await hashOf(bytes),
    size: bytes.byteLength,
    kind: 'edit',
    inline: b64(bytes),
  });
  const answer = (await reply) as CommitAckMessage;
  expect(answer.type, JSON.stringify(answer)).toBe('commitAck');
  return answer;
}

beforeEach(async () => {
  await resetAll();
});

describe('retention', () => {
  it('drops aged non-head versions, keeps heads and snapshot pins, drops refcounts', async () => {
    const { token } = await claim({ passphrase: 'pppppppp', vaultName: 'personal' });
    const ws = await WsClient.connect();
    await hello(ws, token);

    // t0: v1 and v2 exist; the snapshot pins v2 (the head at capture time).
    const first = await commitInline(ws, '/a.md', null, 'v1');
    const second = await commitInline(ws, '/a.md', first.version, 'v2');
    const snapReply = ws.next((m) => m.type === 'snapshotCreateAck');
    ws.send({ type: 'snapshotCreate', name: 'pin' });
    expect((await snapReply).type).toBe('snapshotCreateAck');

    // +100d: v3 becomes the head; v1/v2 are now ancient history.
    setRoomTime(Date.now() + 100 * 24 * 60 * 60 * 1000);
    const third = await commitInline(ws, '/a.md', second.version, 'v3');

    const cookie = await adminLogin('pppppppp');
    const set = await post('/admin/retention', { days: 30 }, { cookie });
    expect(set.status).toBe(200);

    const run = await roomInternal('/internal/retention', { method: 'POST' });
    expect(run.status).toBe(200);
    const body = (await run.json()) as { removed: number };
    // v1: aged, not pinned → gone. v2: aged, but the snapshot points at it.
    // v3: the head. Exactly one removal.
    expect(body.removed).toBe(1);

    const history = await request('GET', '/api/history?path=/a.md', {
      authorization: `Bearer ${token}`,
    });
    const historyBody = (await history.json()) as { versions: Array<{ id: string }> };
    expect(historyBody.versions.map((v) => v.id).sort()).toEqual(
      [second.version, third.version].sort(),
    );
    ws.close();
  });

  it('is a no-op while disabled (default), and the cap keeps the newest N per path', async () => {
    const { token } = await claim({ passphrase: 'pppppppp', vaultName: 'personal' });
    const ws = await WsClient.connect();
    await hello(ws, token);

    const first = await commitInline(ws, '/b.md', null, 'one');
    const second = await commitInline(ws, '/b.md', first.version, 'two');
    await commitInline(ws, '/b.md', second.version, 'three');

    const idle = await roomInternal('/internal/retention', { method: 'POST' });
    expect(((await idle.json()) as { removed: number }).removed).toBe(0);

    const cookie = await adminLogin('pppppppp');
    await post('/admin/retention', { versions: 1 }, { cookie });
    const run = await roomInternal('/internal/retention', { method: 'POST' });
    const body = (await run.json()) as { removed: number };
    // Cap 1 non-head version: v1 goes, v2 stays, v3 is the head.
    expect(body.removed).toBe(1);
    ws.close();
  });
});

describe('quota', () => {
  it('status carries the advisory state; admin can retune or disable it', async () => {
    const { token } = await claim({ passphrase: 'pppppppp', vaultName: 'personal' });
    const cookie = await adminLogin('pppppppp');

    const before = await request('GET', '/api/status', { cookie });
    const beforeBody = (await before.json()) as {
      quota: { state: string; warnBytes: number; hardBytes: number };
      retention: { days: number; versions: number };
    };
    expect(beforeBody.quota.state).toBe('ok'); // empty vault, defaults armed
    expect(beforeBody.retention).toEqual({ days: 0, versions: 0 });

    // Thresholds at 1 byte, then store one blob: instantly over.
    await post('/admin/quota', { warnBytes: 1, hardBytes: 1 }, { cookie });
    const ws = await WsClient.connect();
    await hello(ws, token);
    await commitInline(ws, '/tiny.md', null, 'x');
    ws.close();
    const after = await request('GET', '/api/status', { cookie });
    expect(((await after.json()) as { quota: { state: string } }).quota.state).toBe('over');

    // Disable entirely.
    await post('/admin/quota', { warnBytes: 0, hardBytes: 0 }, { cookie });
    const off = await request('GET', '/api/status', { cookie });
    expect(((await off.json()) as { quota: { state: string } }).quota.state).toBe('off');
  });
});

describe('backup', () => {
  it('streams heads, history, and verified blobs as NDJSON (device token)', async () => {
    const { token } = await claim({ passphrase: 'pppppppp', vaultName: 'personal' });
    const ws = await WsClient.connect();
    await hello(ws, token);
    const first = await commitInline(ws, '/notes/a.md', null, 'content one');
    await commitInline(ws, '/notes/a.md', first.version, 'content two');
    ws.close();

    const response = await request('GET', '/backup', { authorization: `Bearer ${token}` });
    expect(response.status).toBe(200);
    const text = await response.text();
    const rows = text
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    const types = rows.map((row) => row.type);
    expect(types[0]).toBe('meta');
    expect(types.filter((t) => t === 'file')).toHaveLength(1);
    expect(types.filter((t) => t === 'version')).toHaveLength(2);
    expect(types.filter((t) => t === 'blob')).toHaveLength(2);
    const meta = rows[0] as { vaultName: string };
    expect(meta.vaultName).toBe('personal');
  });

  it('requires auth', async () => {
    await claim({ passphrase: 'pppppppp', vaultName: 'personal' });
    const response = await request('GET', '/backup');
    expect(response.status).toBe(401);
  });
});
