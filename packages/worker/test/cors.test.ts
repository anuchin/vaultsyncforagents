/**
 * CORS policy (src/index.ts module comment): the plugin-facing routes
 * (GET /health, POST /pair, PATCH /device, GET /api/status with the device
 * token, GET/PUT /blob/:hash) are reachable from the Obsidian plugin's
 * cross-origin renderer (`app://obsidian.md` desktop, `capacitor://` origins
 * mobile) — preflights answer 204 + the full header set in BOTH claim states,
 * and actual responses carry the same headers. Dashboard surface (/admin/*,
 * every OTHER /api/* route incl. /api/history, /claim, /ws) stays same-origin
 * only: no Access-Control-* headers, ever.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  adminLogin,
  claim,
  enc,
  get,
  hashOf,
  mintPairingCode,
  post,
  put,
  request,
  resetAll,
} from './helpers.js';
import { SERVER_VERSION } from '../src/version.js';

const PLUGIN_ORIGIN = 'app://obsidian.md';

/** The exact header set every plugin-facing response must carry. */
const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  // PATCH joined the set with the device self-rename route (`PATCH /device`).
  'access-control-allow-methods': 'GET, POST, PUT, PATCH, OPTIONS',
  'access-control-allow-headers': 'Authorization, Content-Type',
  'access-control-max-age': '86400',
};

function preflight(path: string, requestMethod = 'GET'): Promise<Response> {
  return request('OPTIONS', path, {
    origin: PLUGIN_ORIGIN,
    'access-control-request-method': requestMethod,
    'access-control-request-headers': 'authorization, content-type',
  });
}

function expectCorsHeaders(res: Response): void {
  for (const [name, value] of Object.entries(CORS_HEADERS)) {
    expect(res.headers.get(name), name).toBe(value);
  }
}

function expectNoCorsHeaders(res: Response): void {
  for (const name of Object.keys(CORS_HEADERS)) {
    expect(res.headers.get(name), name).toBeNull();
  }
}

beforeEach(async () => {
  await resetAll();
});

describe('plugin-facing routes: preflights (both claim states)', () => {
  it('OPTIONS on /health, /pair, /api/status and /blob/:hash answers 204 with the full header set (unclaimed)', async () => {
    for (const path of ['/health', '/pair', '/api/status', '/blob/' + 'a'.repeat(64)]) {
      const res = await preflight(path);
      expect(res.status, path).toBe(204);
      expectCorsHeaders(res);
    }
  });

  it('OPTIONS on /health, /pair, /api/status and /blob/:hash still answers 204 after claim', async () => {
    await claim({ passphrase: 'pppp' });
    for (const path of ['/health', '/pair', '/api/status', '/blob/' + 'b'.repeat(64)]) {
      const res = await preflight(path);
      expect(res.status, path).toBe(204);
      expectCorsHeaders(res);
    }
  });

  it('PUT /blob/:hash preflight is 204 while unclaimed AND after claim', async () => {
    const hash = await hashOf(enc('preflighted bytes'));
    const unclaimed = await preflight(`/blob/${hash}`, 'PUT');
    expect(unclaimed.status).toBe(204);
    expectCorsHeaders(unclaimed);

    await claim({ passphrase: 'pppp' });
    const claimed = await preflight(`/blob/${hash}`, 'PUT');
    expect(claimed.status).toBe(204);
    expectCorsHeaders(claimed);
  });
});

describe('plugin-facing routes: actual responses carry the headers', () => {
  it('GET /health with Origin: app://obsidian.md returns ACAO *', async () => {
    const res = await get('/health', { origin: PLUGIN_ORIGIN });
    expect(res.status).toBe(200);
    expectCorsHeaders(res);
    expect(await res.json()).toEqual({
      ok: true,
      claimed: false,
      serverVersion: SERVER_VERSION,
      protocolVersion: 1,
    });
  });

  it('POST /pair carries the headers (claimed worker, real pairing flow)', async () => {
    await claim({ passphrase: 'pppp' });
    const cookie = await adminLogin('pppp');
    const code = await mintPairingCode(cookie, 'Obsidian', 'plugin');
    const res = await post(
      '/pair',
      { code, deviceName: 'Obsidian', deviceType: 'plugin' },
      { origin: PLUGIN_ORIGIN },
    );
    expect(res.status).toBe(200);
    expectCorsHeaders(res);
  });

  it('PUT then GET /blob/:hash carry the headers alongside their normal ones', async () => {
    const claimed = await claim();
    const bytes = enc('plugin bytes');
    const hash = await hashOf(bytes);

    const putRes = await put(`/blob/${hash}`, bytes, {
      origin: PLUGIN_ORIGIN,
      authorization: `Bearer ${claimed.token}`,
    });
    expect(putRes.status).toBe(201);
    expectCorsHeaders(putRes);

    const getRes = await get(`/blob/${hash}`, {
      origin: PLUGIN_ORIGIN,
      authorization: `Bearer ${claimed.token}`,
    });
    expect(getRes.status).toBe(200);
    expectCorsHeaders(getRes);
    expect(getRes.headers.get('cache-control')).toContain('immutable');
    expect(new Uint8Array(await getRes.arrayBuffer())).toEqual(bytes);
  });

  it('GET /api/status with the device token carries the headers (the About section reads it cross-origin)', async () => {
    const claimed = await claim();
    const res = await get('/api/status', {
      origin: PLUGIN_ORIGIN,
      authorization: `Bearer ${claimed.token}`,
    });
    expect(res.status).toBe(200);
    expectCorsHeaders(res);
    const body = (await res.json()) as { storageBytes?: number };
    expect(typeof body.storageBytes).toBe('number');
  });

  it('the 421 unclaimed gate for /api/status is CORS-readable too', async () => {
    const res = await get('/api/status', { origin: PLUGIN_ORIGIN });
    expect(res.status).toBe(421);
    expectCorsHeaders(res);
  });

  it('unauthenticated plugin calls still get 401 WITH the headers (errors stay readable)', async () => {
    await claim();
    const hash = await hashOf(enc('locked bytes'));
    const putRes = await put(`/blob/${hash}`, enc('locked bytes'), { origin: PLUGIN_ORIGIN });
    expect(putRes.status).toBe(401);
    expectCorsHeaders(putRes);
  });

  it('the 421 unclaimed gate stays for non-preflight non-health calls (now CORS-readable)', async () => {
    const blob = await get('/blob/' + 'c'.repeat(64), { origin: PLUGIN_ORIGIN });
    expect(blob.status).toBe(421);
    expectCorsHeaders(blob);
    const pair = await post('/pair', { code: 'AAAA-AAAA', deviceName: 'X', deviceType: 'cli' }, {
      origin: PLUGIN_ORIGIN,
    });
    expect(pair.status).toBe(421);
    expectCorsHeaders(pair);
  });
});

describe('dashboard surface stays same-origin (no CORS headers)', () => {
  it('GET /api/history responses contain no Access-Control-* headers (only /api/status is plugin-CORS)', async () => {
    const claimed = await claim();
    const res = await get('/api/history?path=%2Fnote.md', {
      origin: PLUGIN_ORIGIN,
      authorization: `Bearer ${claimed.token}`,
    });
    expectNoCorsHeaders(res);
  });

  it('OPTIONS on /api/history and /ws do not get permissive CORS', async () => {
    await claim({ passphrase: 'pppp' });
    for (const path of ['/api/history', '/ws']) {
      const res = await preflight(path);
      expect(res.status, path).not.toBe(204); // falls through the router: no preflight there
      expectNoCorsHeaders(res);
    }
  });

  it('POST /admin/login responses contain no Access-Control-* headers', async () => {
    await claim({ passphrase: 'pppp' });
    const res = await post('/admin/login', { passphrase: 'pppp' }, { origin: PLUGIN_ORIGIN });
    expect(res.status).toBe(200);
    expectNoCorsHeaders(res);
  });

  it('POST /claim responses contain no Access-Control-* headers', async () => {
    const res = await post(
      '/claim',
      { passphrase: 'pppp', vaultName: 'v' },
      { origin: PLUGIN_ORIGIN },
    );
    expect(res.status).toBe(200);
    expectNoCorsHeaders(res);
  });

  it('OPTIONS on /admin/login does not get permissive CORS', async () => {
    await claim({ passphrase: 'pppp' });
    const res = await preflight('/admin/login', 'POST');
    expect(res.status).not.toBe(204); // falls through the router: no preflight there
    expectNoCorsHeaders(res);
  });
});
