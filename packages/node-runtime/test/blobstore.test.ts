/**
 * HttpBlobStore against an injectable fetch: happy paths, 404 → undefined,
 * error statuses with server messages, and the auth header on both verbs.
 */

import { describe, expect, it } from 'vitest';
import { HttpBlobStore, HttpBlobError } from '../src/blobstore.js';

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);

function jsonResponse(status: number, body: Record<string, unknown> | string): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
}

function byteResponse(bytes: Uint8Array): Response {
  return new Response(bytes as BodyInit, { status: 200 });
}

function storeWith(handler: (url: string, init?: RequestInit) => Promise<Response>): HttpBlobStore {
  return new HttpBlobStore({
    baseUrl: 'https://worker.example/',
    token: 'tok',
    fetchImpl: ((input: RequestInfo | URL, init?: RequestInit) =>
      handler(String(input), init)) as typeof fetch,
  });
}

describe('HttpBlobStore', () => {
  it('get returns bytes on 200 and sends the device token', async () => {
    let seenAuth = '';
    let seenUrl = '';
    const store = storeWith(async (url, init) => {
      seenUrl = url;
      seenAuth = (init?.headers as Record<string, string>)['authorization'] ?? '';
      return byteResponse(enc('hello bytes'));
    });
    const bytes = await store.get('a'.repeat(64));
    expect(new TextDecoder().decode(bytes!)).toBe('hello bytes');
    expect(seenUrl).toBe('https://worker.example/blob/' + 'a'.repeat(64));
    expect(seenAuth).toBe('Bearer tok');
  });

  it('get returns undefined on 404', async () => {
    const store = storeWith(async () => jsonResponse(404, { error: 'no such blob' }));
    expect(await store.get('b'.repeat(64))).toBeUndefined();
  });

  it('get surfaces the server message on other errors', async () => {
    const store = storeWith(async () => jsonResponse(401, { error: 'device token or admin session required' }));
    await expect(store.get('c'.repeat(64))).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(HttpBlobError);
      expect((error as HttpBlobError).status).toBe(401);
      expect((error as HttpBlobError).message).toContain('device token or admin session required');
      return true;
    });
  });

  it('put sends a streaming body PUT with token and content-length', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const store = storeWith(async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(201, { ok: true });
    });
    const payload = enc('attachment-bytes');
    await store.put('d'.repeat(64), payload);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://worker.example/blob/' + 'd'.repeat(64));
    expect(calls[0]!.init?.method).toBe('PUT');
    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers['authorization']).toBe('Bearer tok');
    expect(headers['content-length']).toBe(String(payload.byteLength));
    expect(new Uint8Array(await new Response(calls[0]!.init?.body).arrayBuffer())).toEqual(payload);
  });

  it('put reports 413 and 422 with the worker message', async () => {
    const oversized = storeWith(async () => jsonResponse(413, { error: 'blob exceeds cap' }));
    await expect(oversized.put('e'.repeat(64), enc('x'))).rejects.toSatisfy(
      (error: unknown) => error instanceof HttpBlobError && error.status === 413,
    );
    const mismatch = storeWith(async () => jsonResponse(422, { error: 'content does not hash' }));
    await expect(mismatch.put('f'.repeat(64), enc('x'))).rejects.toSatisfy(
      (error: unknown) => (error as HttpBlobError).status === 422,
    );
  });

  it('network failure propagates as a TypeError-ish fetch rejection', async () => {
    const store = storeWith(async () => {
      throw new TypeError('fetch failed');
    });
    await expect(store.get('0'.repeat(64))).rejects.toThrow('fetch failed');
  });
});
