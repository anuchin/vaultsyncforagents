/**
 * API layer tests — error classification (401/421/network) against a stubbed
 * global fetch, and the shape of the calls the SPA makes to the worker
 * (same-origin paths, JSON bodies, credentials).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError } from '../src/api.js';

const jsonResponse = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('api error classification', () => {
  it('maps 401 -> unauthorized (back to login)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(401, { error: 'admin session required' })));
    const error = await api.status().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).kind).toBe('unauthorized');
    expect((error as ApiError).status).toBe(401);
    expect((error as ApiError).message).toBe('admin session required');
  });

  it('maps 421 -> unclaimed (back to claim view)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(421, { error: 'unclaimed' })));
    const error = await api.status().catch((e: unknown) => e);
    expect((error as ApiError).kind).toBe('unclaimed');
  });

  it('maps fetch rejection -> network (offline banner, view unchanged)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new TypeError('Failed to fetch'))));
    const error = await api.status().catch((e: unknown) => e);
    expect((error as ApiError).kind).toBe('network');
    expect((error as ApiError).status).toBe(0);
  });

  it('other statuses stay http errors and surface the server message', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse(409, { error: 'this worker has already been claimed' })));
    const error = await api.claim({ passphrase: 'abcd', vaultName: 'v' }).catch((e: unknown) => e);
    expect((error as ApiError).kind).toBe('http');
    expect((error as ApiError).message).toContain('already been claimed');
  });

  it('tolerates non-JSON error bodies', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('<html>gateway</html>', { status: 502 })),
    );
    const error = await api.status().catch((e: unknown) => e);
    expect((error as ApiError).kind).toBe('http');
    expect((error as ApiError).message).toContain('502');
  });
});

describe('api call shapes', () => {
  /** Stub global fetch with a fixed responder; record calls as [input, init]. */
  function stubFetch(respond: () => Response | Promise<Response>): { calls: Array<[string, RequestInit]> } {
    const calls: Array<[string, RequestInit]> = [];
    vi.stubGlobal(
      'fetch',
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push([String(input), init ?? {}]);
        return await respond();
      }) as typeof fetch,
    );
    return { calls };
  }

  it('health hits the public endpoint and returns the claim state', async () => {
    const { calls } = stubFetch(() => jsonResponse(200, { ok: true, claimed: false }));
    const doc = await api.health();
    expect(doc).toEqual({ ok: true, claimed: false });
    expect(calls[0]![0]).toBe('/health');
    expect(calls[0]![1].method).toBeUndefined(); // plain GET
    expect(calls[0]![1].credentials).toBe('same-origin');
  });

  it('adminPair posts JSON and encodes nothing surprising', async () => {
    const { calls } = stubFetch(() => jsonResponse(200, { ok: true, code: '7F3K-Q9M2', expiresAt: 1 }));
    const doc = await api.adminPair('Pixel', 'mobile');
    expect(doc.code).toBe('7F3K-Q9M2');
    const [input, init] = calls[0]!;
    expect(input).toBe('/admin/pair');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ deviceName: 'Pixel', deviceType: 'mobile' });
  });

  it('adminLogout posts to the logout route with an empty body', async () => {
    const { calls } = stubFetch(() => jsonResponse(200, { ok: true }));
    await api.adminLogout();
    const [input, init] = calls[0]!;
    expect(input).toBe('/admin/logout');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({});
  });

  it('history URL-encodes the path query parameter', async () => {
    const { calls } = stubFetch(() => jsonResponse(200, { path: '/a b&c.md', head: null, versions: [] }));
    await api.history('/a b&c.md');
    expect(calls[0]![0]).toBe(`/api/history?path=${encodeURIComponent('/a b&c.md')}`);
  });
});
