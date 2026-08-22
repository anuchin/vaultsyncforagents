/**
 * Blob HTTP routes (§5): streamed PUT with hash verification, GET roundtrip,
 * auth, size cap, and the WS↔HTTP interplay (upload -> commit by reference).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  WsClient,
  claim,
  enc,
  get,
  hashOf,
  hello,
  put,
  resetAll,
} from './helpers.js';

/** Mirrors the worker's BLOB_MAX_BYTES (100 MiB). */
const BLOB_CAP = 100 * 1024 * 1024;

beforeEach(async () => {
  await resetAll();
});

describe('blob routes', () => {
  it('PUT then GET is byte-identical, with immutable caching', async () => {
    const claimed = await claim();
    const bytes = enc('the quick brown fox');
    const hash = await hashOf(bytes);

    const putRes = await put(`/blob/${hash}`, bytes, { authorization: `Bearer ${claimed.token}` });
    expect(putRes.status).toBe(201);
    expect(await putRes.json()).toMatchObject({ ok: true, hash, size: bytes.byteLength });

    const getRes = await get(`/blob/${hash}`, { authorization: `Bearer ${claimed.token}` });
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get('content-type')).toBe('application/octet-stream');
    expect(getRes.headers.get('cache-control')).toContain('immutable');
    expect(new Uint8Array(await getRes.arrayBuffer())).toEqual(bytes);
  });

  it('binary attachments roundtrip byte-for-byte', async () => {
    const claimed = await claim();
    const bytes = new Uint8Array(4096);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 7) & 0xff;
    const hash = await hashOf(bytes);
    expect((await put(`/blob/${hash}`, bytes, { authorization: `Bearer ${claimed.token}` })).status).toBe(201);
    const res = await get(`/blob/${hash}`, { authorization: `Bearer ${claimed.token}` });
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it('a corrupted PUT (hash mismatch) -> 422 and the object is deleted', async () => {
    const claimed = await claim();
    const claimedHash = await hashOf(enc('what the client THINKS it is sending'));
    const actualBytes = enc('what actually arrives');
    const res = await put(`/blob/${claimedHash}`, actualBytes, { authorization: `Bearer ${claimed.token}` });
    expect(res.status).toBe(422);
    expect(await res.json()).toHaveProperty('error', 'content does not hash to the claimed hash');

    const getRes = await get(`/blob/${claimedHash}`, { authorization: `Bearer ${claimed.token}` });
    expect(getRes.status).toBe(404);
  });

  it('re-uploading an existing hash never overwrites the stored content (put-if-absent)', async () => {
    const claimed = await claim();
    const auth = { authorization: `Bearer ${claimed.token}` };
    const good = enc('the real content');
    const hash = await hashOf(good);
    expect((await put(`/blob/${hash}`, good, auth)).status).toBe(201);

    // Garbage under the SAME hash is redundant, not destructive: the stored
    // object IS the blob (CAS), so the upload is a no-op.
    const res = await put(`/blob/${hash}`, enc('garbage impostor'), auth);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, hash, size: good.byteLength });

    const getRes = await get(`/blob/${hash}`, auth);
    expect(new Uint8Array(await getRes.arrayBuffer())).toEqual(good);
  });

  it('blob routes require auth (device token or admin cookie)', async () => {
    await claim();
    const hash = await hashOf(enc('secret bytes'));
    expect((await put(`/blob/${hash}`, enc('secret bytes'))).status).toBe(401);
    expect((await get(`/blob/${hash}`)).status).toBe(401);
    // A malformed hash never reaches storage.
    expect((await get('/blob/not-a-hash', { authorization: 'Bearer x' })).status).toBe(400);
  });

  it('an uploaded blob backs a hash-only commit over the WS', async () => {
    const claimed = await claim();
    const bytes = enc('attachment by reference');
    const hash = await hashOf(bytes);
    await put(`/blob/${hash}`, bytes, { authorization: `Bearer ${claimed.token}` });

    const ws = await WsClient.connect();
    await hello(ws, claimed.token);
    const commitReply = ws.next((m) => m.type === 'commitAck' || m.type === 'error');
    ws.send({
      type: 'commit',
      path: '/attachments/ref.bin',
      parentVersion: null,
      hash,
      size: bytes.byteLength,
      kind: 'edit',
    });
    const ack = (await commitReply) as { type: string; version: string };
    expect(ack.type).toBe('commitAck');
    expect(ack.version).toBe('v1');

    // Another device fetches the content over HTTP.
    const res = await get(`/blob/${hash}`, { authorization: `Bearer ${claimed.token}` });
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
    ws.close();
  });

  it('rejects bodies over the 100 MB cap (413)', async () => {
    const claimed = await claim();
    const fakeHash = 'f'.repeat(64);
    // A known-length (FixedLengthStream) body just over the cap — service
    // bindings require known-length bodies, so the declared-oversize path is
    // what a binding-based client exercises; the worker rejects on the
    // declared length before streaming anything.
    const { readable, writable } = new FixedLengthStream(BLOB_CAP + 1);
    void writable.close().catch(() => {});
    const res = await put(`/blob/${fakeHash}`, readable, { authorization: `Bearer ${claimed.token}` });
    expect(res.status).toBe(413);
    const head = await get(`/blob/${fakeHash}`, { authorization: `Bearer ${claimed.token}` });
    expect(head.status).toBe(404);
  });
});
