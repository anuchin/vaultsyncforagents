/**
 * Weekly orphan-blob GC (§7): orphans past the grace window are deleted from
 * R2 by the cron; referenced blobs survive; fresh orphans survive (in-flight
 * upload protection).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { createExecutionContext, createScheduledController, env, waitOnExecutionContext } from 'cloudflare:test';
import worker from '../src/index.js';
import { blobKey } from '../src/room.js';
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
  roomInternal,
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

describe('GC survivor semantics (listing -> purge TOCTOU)', () => {
  it('a commit that re-references a listed orphan between listing and purge keeps its R2 object', async () => {
    const claimed = await claim();
    const auth = { authorization: `Bearer ${claimed.token}` };

    const survivorBytes = enc('re-referenced mid-GC');
    const survivorHash = await hashOf(survivorBytes);
    const orphanBytes = enc('truly abandoned');
    const orphanHash = await hashOf(orphanBytes);
    expect((await put(`/blob/${survivorHash}`, survivorBytes, auth)).status).toBe(201);
    expect((await put(`/blob/${orphanHash}`, orphanBytes, auth)).status).toBe(201);
    await roomSql(
      `UPDATE blobs SET first_seen_at = 1 WHERE hash IN ('${survivorHash}', '${orphanHash}')`,
    );

    // The cron's listing step: both look like aged orphans.
    const list = await roomInternal('/internal/gc');
    const orphans = ((await list.json()) as { orphans: string[] }).orphans.slice().sort();
    expect(orphans).toEqual([orphanHash, survivorHash].sort());

    // A commit lands between listing and purge and re-references one of them.
    const ws = await WsClient.connect();
    await hello(ws, claimed.token);
    const ack = ws.next((m) => m.type === 'commitAck' || m.type === 'error');
    ws.send({
      type: 'commit',
      path: '/notes/survivor.md',
      parentVersion: null,
      hash: survivorHash,
      size: survivorBytes.byteLength,
      kind: 'edit',
    });
    expect(await ack).toMatchObject({ type: 'commitAck' });
    ws.close();

    // The purge step re-checks refcounts inside the DO's queue and confirms
    // only the STILL-orphaned hash; R2 deletion follows the confirmed list.
    const purge = await roomInternal('/internal/gc-purge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ hashes: [orphanHash, survivorHash] }),
    });
    expect(((await purge.json()) as { purged: string[] }).purged).toEqual([orphanHash]);
    await env.BUCKET.delete(blobKey(orphanHash));

    expect((await get(`/blob/${survivorHash}`, auth)).status).toBe(200);
    expect(new Uint8Array(await (await get(`/blob/${survivorHash}`, auth)).arrayBuffer())).toEqual(
      survivorBytes,
    );
    expect((await get(`/blob/${orphanHash}`, auth)).status).toBe(404);
    expect(await blobRows()).toContainEqual({ hash: survivorHash, refcount: 1 });
  });
});

