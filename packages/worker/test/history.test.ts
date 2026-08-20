/**
 * GET /api/history (FR-54) — the read-only version-chain endpoint backing
 * `vsa history` / `vsa restore`. Auth (device token or admin session),
 * validation, ordering (newest first), head flagging, and delete tombstones
 * all against the real DO.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  adminLogin,
  b64,
  claim,
  enc,
  get,
  hashOf,
  hello,
  post,
  resetAll,
  WsClient,
} from './helpers.js';
import type { CommitAckMessage } from '@vsa/core';

interface HistoryVersion {
  id: string;
  hash: string;
  size: number;
  deviceId: string;
  clock: { counter: number; deviceId: string };
  ts: number;
  kind: string;
  current: boolean;
}

interface HistoryBody {
  path: string;
  head: { versionId: string; deleted: boolean } | null;
  versions: HistoryVersion[];
}

async function commitInline(
  ws: WsClient,
  path: string,
  parent: string | null,
  content: string,
  kind: 'edit' | 'delete' = 'edit',
): Promise<CommitAckMessage> {
  const bytes = enc(content);
  const hash = await hashOf(bytes);
  const reply = ws.next((m) => m.type === 'commitAck' || m.type === 'error');
  ws.send({
    type: 'commit',
    path,
    parentVersion: parent,
    hash,
    size: bytes.byteLength,
    kind,
    inline: b64(bytes),
  });
  const answer = (await reply) as CommitAckMessage;
  expect(answer.type, JSON.stringify(answer)).toBe('commitAck');
  return answer;
}

beforeEach(async () => {
  await resetAll();
});

describe('GET /api/history', () => {
  it('returns the full version chain newest-first with the head flagged', async () => {
    const { token, deviceId } = await claim({ passphrase: 'pppp', vaultName: 'personal' });
    const ws = await WsClient.connect();
    await hello(ws, token);

    const first = await commitInline(ws, '/notes/a.md', null, 'v1');
    const second = await commitInline(ws, '/notes/a.md', first.version, 'v2-longer');

    const res = await get(`/api/history?path=${encodeURIComponent('/notes/a.md')}`, {
      authorization: `Bearer ${token}`,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as HistoryBody;

    expect(body.path).toBe('/notes/a.md');
    expect(body.head).toEqual({ versionId: second.version, deleted: false });
    expect(body.versions).toHaveLength(2);
    expect(body.versions[0]).toMatchObject({
      id: second.version,
      hash: await hashOf(enc('v2-longer')),
      size: 9,
      deviceId,
      kind: 'edit',
      current: true,
    });
    expect(body.versions[1]).toMatchObject({ id: first.version, kind: 'edit', current: false });
    expect(body.versions[0]!.clock).toEqual({
      counter: expect.any(Number),
      deviceId: expect.any(String),
    });
    expect(body.versions[0]!.ts).toBeGreaterThanOrEqual(body.versions[1]!.ts);
  });

  it('includes delete tombstones and flags the deleted head', async () => {
    const { token } = await claim({ passphrase: 'pppp', vaultName: 'personal' });
    const ws = await WsClient.connect();
    await hello(ws, token);
    const first = await commitInline(ws, '/gone.md', null, 'content');
    await commitInline(ws, '/gone.md', first.version, 'content', 'delete');

    const res = await get(`/api/history?path=${encodeURIComponent('/gone.md')}`, {
      authorization: `Bearer ${token}`,
    });
    const body = (await res.json()) as HistoryBody;
    expect(body.head?.deleted).toBe(true);
    expect(body.versions.map((v) => v.kind)).toEqual(['delete', 'edit']);
    expect(body.versions[0]!.current).toBe(true);
  });

  it('accepts the admin session cookie as an alternative to a device token', async () => {
    const { token, passphrase } = await claim({ passphrase: 'pppp', vaultName: 'personal' });
    const ws = await WsClient.connect();
    await hello(ws, token);
    await commitInline(ws, '/a.md', null, 'x');

    const cookie = await adminLogin(passphrase);
    const res = await get(`/api/history?path=${encodeURIComponent('/a.md')}`, { cookie });
    expect(res.status).toBe(200);
    expect(((await res.json()) as HistoryBody).versions).toHaveLength(1);
  });

  it('requires auth: no token, garbage token, and revoked devices all 401', async () => {
    const { token, passphrase } = await claim({ passphrase: 'pppp', vaultName: 'personal' });
    const ws = await WsClient.connect();
    await hello(ws, token);
    await commitInline(ws, '/a.md', null, 'x');

    expect((await get(`/api/history?path=${encodeURIComponent('/a.md')}`)).status).toBe(401);
    expect(
      (await get(`/api/history?path=${encodeURIComponent('/a.md')}`, {
        authorization: 'Bearer not-a-token',
      })).status,
    ).toBe(401);

    // Revoke the only device, then retry with its (now dead) token.
    const cookie = await adminLogin(passphrase);
    const devices = (await (await get('/api/status', { cookie })).json()) as {
      devices: Array<{ id: string }>;
    };
    const revoke = await post('/admin/revoke', { deviceId: devices.devices[0]!.id }, { cookie });
    expect(revoke.status).toBe(200);
    expect(
      (await get(`/api/history?path=${encodeURIComponent('/a.md')}`, {
        authorization: `Bearer ${token}`,
      })).status,
    ).toBe(401);
  });

  it('rejects a missing or non-absolute path parameter with 400', async () => {
    const { token } = await claim({ passphrase: 'pppp', vaultName: 'personal' });
    const auth = { authorization: `Bearer ${token}` };
    expect((await get('/api/history', auth)).status).toBe(400);
    expect((await get('/api/history?path=', auth)).status).toBe(400);
    expect((await get('/api/history?path=notes/a.md', auth)).status).toBe(400);
  });

  it('returns an empty chain for an unknown path (not an error)', async () => {
    const { token } = await claim({ passphrase: 'pppp', vaultName: 'personal' });
    const res = await get(`/api/history?path=${encodeURIComponent('/never.md')}`, {
      authorization: `Bearer ${token}`,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as HistoryBody;
    expect(body.head).toBeNull();
    expect(body.versions).toEqual([]);
  });

  it('is gated on claim: an unclaimed worker answers 421', async () => {
    const res = await get(`/api/history?path=${encodeURIComponent('/a.md')}`);
    expect(res.status).toBe(421);
  });
});
