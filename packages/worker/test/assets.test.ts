/**
 * Dashboard asset serving + claim-state gating (FR-30, §10, §14).
 *
 * The wrangler.test.jsonc assets binding points at test/fixtures/dashboard
 * (an index.html with the marker `vsa-dashboard-fixture` + one CSS asset) so
 * these tests exercise the real asset pipeline — router delegation to
 * ASSETS, content types, SPA fallback — without depending on a built
 * dashboard.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { claim, get, post, request, resetAll } from './helpers.js';

beforeEach(async () => {
  await resetAll();
});

describe('dashboard assets', () => {
  it('serves the SPA at / while UNCLAIMED (claim page reachable, §3)', async () => {
    const res = await get('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('vsa-dashboard-fixture');
  });

  it('serves a static asset with its content type', async () => {
    const res = await get('/assets/app.css');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/css');
    expect(await res.text()).toContain('vsa-fixture-css');
  });

  it('falls back to index.html for unknown SPA paths (single-page-application)', async () => {
    const res = await get('/some/deep/link');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('vsa-dashboard-fixture');
  });

  it('serves the SPA at / after claiming too', async () => {
    await claim({ passphrase: 'pppp', vaultName: 'personal' });
    const res = await get('/');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
    expect(await res.text()).toContain('vsa-dashboard-fixture');
  });

  it('unknown non-GET paths stay JSON 404s, not HTML', async () => {
    await claim({ passphrase: 'pppp', vaultName: 'personal' });
    const res = await request('POST', '/nope');
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
    expect(await res.json()).toHaveProperty('error', 'not found');
  });
});

describe('unclaimed gate vs. assets (§14)', () => {
  it('API routes still answer 421 while the SPA is served', async () => {
    // The SPA itself:
    expect((await get('/')).status).toBe(200);
    // The gated surface:
    const hash = 'a'.repeat(64);
    for (const [method, path] of [
      ['GET', '/api/status'],
      ['GET', `/api/history?path=${encodeURIComponent('/a.md')}`],
      ['GET', `/blob/${hash}`],
      ['PUT', `/blob/${hash}`],
      ['POST', '/admin/login'],
      ['POST', '/admin/pair'],
      ['POST', '/admin/revoke'],
      ['POST', '/pair'],
      ['GET', '/ws'],
      ['GET', '/sync'],
    ] as const) {
      const res = await request(method, path, { 'content-type': 'application/json' });
      expect(res.status, `${method} ${path}`).toBe(421);
      expect(await res.json()).toHaveProperty('error', 'unclaimed');
    }
  });

  it('health stays public and claim stays reachable while unclaimed', async () => {
    const health = await get('/health');
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true, claimed: false });

    const claimRes = await post('/claim', { passphrase: 'abcd', vaultName: 'v' });
    expect(claimRes.status).toBe(200);
  });

  it('the gate lifts exactly on the API surface after claiming', async () => {
    await claim({ passphrase: 'pppp', vaultName: 'personal' });
    // 421 -> 401 (auth now decides, not claim state):
    expect((await get('/api/status')).status).toBe(401);
    expect((await get('/blob/' + 'a'.repeat(64))).status).toBe(401);
    // GET /ws without an upgrade header is 426, not 421:
    expect((await get('/ws')).status).toBe(426);
    // And the SPA keeps serving:
    expect((await get('/')).status).toBe(200);
  });
});
