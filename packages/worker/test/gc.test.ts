/**
 * Weekly orphan-blob GC (§7): orphans past the grace window are deleted from
 * R2 by the cron; referenced blobs survive; fresh orphans survive (in-flight
 * upload protection).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index.js';
import {
  WsClient,
  b64,
  claim,
  enc,
  get,
  hashOf,
  hello,
  put,
  resetAll,
  roomSql,
} from './helpers.js';

async function runCron(): Promise<void> {
  const controller = createScheduledController();
  const ctx = createExecutionContext();
  await worker.scheduled(controller, env, ctx);
  await waitOnExecutionContext(ctx);
}

const blobRows = (): Promise<Array<{ hash: string; refcount: number }>> =>
  roomSql('SELECT hash, refcount FROM blobs');

beforeEach(async () => {
  await resetAll();
});

describe('scheduled GC', () => {
  it('deletes aged orphans from R2, keeps referenced blobs and fresh orphans', async () => {
    const claimed = await claim();
    const auth = { authorization: `Bearer ${claimed.token}` };

    // Orphan: uploaded, never committed.
    const orphanBytes = enc('never committed');
    const orphanHash = await hashOf(orphanBytes);
    expect((await put(`/blob/${orphanHash}`, orphanBytes, auth)).status).toBe(201);

    // Referenced: uploaded AND committed.
    const keptBytes = enc('in use');
    const keptHash = await hashOf(keptBytes);
    expect((await put(`/blob/${keptHash}`, keptBytes, auth)).status).toBe(201);
    const ws = await WsClient.connect();
    await hello(ws, claimed.token);
    const ack = ws.next((m) => m.type === 'commitAck');
    ws.send({
      type: 'commit',
      path: '/notes/kept.md',
      parentVersion: null,
      hash: keptHash,
      size: keptBytes.byteLength,
      kind: 'edit',
      inline: b64(keptBytes),
    });
    expect(await ack).toMatchObject({ type: 'commitAck' });

    // Inline-committed content: also referenced (stored by the DO itself).
    const inlineBytes = enc('inline content');
    const inlineAck = ws.next((m) => m.type === 'commitAck');
    ws.send({
      type: 'commit',
      path: '/notes/inline.md',
      parentVersion: null,
      hash: await hashOf(inlineBytes),
      size: inlineBytes.byteLength,
      kind: 'edit',
      inline: b64(inlineBytes),
    });
    expect(await inlineAck).toMatchObject({ type: 'commitAck' });
    ws.close();

    // Refcounts before: orphan 0, referenced 1 each.
    expect(await blobRows()).toContainEqual({ hash: orphanHash, refcount: 0 });
    expect(await blobRows()).toContainEqual({ hash: keptHash, refcount: 1 });

    // Age ONLY the orphan past the 7-day grace window.
    await roomSql(`UPDATE blobs SET first_seen_at = 1 WHERE hash = '${orphanHash}'`);

    await runCron();

    // Orphan gone from R2 and the bookkeeping.
    expect((await get(`/blob/${orphanHash}`, auth)).status).toBe(404);
    const rows = await blobRows();
    expect(rows.find((r) => r.hash === orphanHash)).toBeUndefined();
    // Referenced blobs untouched.
    expect((await get(`/blob/${keptHash}`, auth)).status).toBe(200);
    expect((await get(`/blob/${await hashOf(inlineBytes)}`, auth)).status).toBe(200);
    expect(rows.find((r) => r.hash === keptHash)).toMatchObject({ refcount: 1 });
  });

  it('a fresh orphan (within grace) survives the cron', async () => {
    const claimed = await claim();
    const bytes = enc('recent upload');
    const hash = await hashOf(bytes);
    await put(`/blob/${hash}`, bytes, { authorization: `Bearer ${claimed.token}` });

    await runCron();

    expect((await get(`/blob/${hash}`, { authorization: `Bearer ${claimed.token}` })).status).toBe(200);
    expect(await blobRows()).toContainEqual({ hash, refcount: 0 });
  });
});

