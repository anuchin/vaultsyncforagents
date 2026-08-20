/**
 * Claim lifecycle (FR-20..FR-22, §3, §14): unclaimed gating, first-writer-wins
 * claim (race-guarded by the DO), health, admin login + session cookie.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  adminLogin,
  claim,
  get,
  mintPairingCode,
  post,
  request,
  resetAll,
} from './helpers.js';

beforeEach(async () => {
  await resetAll();
});

describe('unclaimed worker', () => {
  it('health answers 200 with claimed:false (doctor/uptime work pre-claim)', async () => {
    const res = await get('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, claimed: false });
  });

  it('API/sync/blob/pairing routes answer 421 (GET / serves the claim SPA)', async () => {
    for (const [method, path] of [
      ['GET', '/api/status'],
      ['POST', '/pair'],
      ['POST', '/admin/login'],
      ['GET', '/ws'],
      ['PUT', '/blob/' + 'a'.repeat(64)],
    ] as const) {
      const res = await request(method, path);
      expect(res.status, `${method} ${path}`).toBe(421);
      expect(await res.json()).toHaveProperty('error', 'unclaimed');
    }
    // The SPA itself is served while unclaimed (the claim page must be
    // reachable) — covered in detail by assets.test.ts.
    const spa = await get('/');
    expect(spa.status).toBe(200);
  });
});

describe('claim', () => {
  it('claims, registers the claiming device, and flips health', async () => {
    const before = await (await get('/health')).json();
    expect(before).toEqual({ ok: true, claimed: false });

    const res = await post('/claim', {
      passphrase: 'hunter22',
      vaultName: 'personal',
      deviceName: 'Laptop',
      deviceType: 'desktop',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; vaultName: string; deviceId: string; token: string };
    expect(body.ok).toBe(true);
    expect(body.vaultName).toBe('personal');
    expect(body.deviceId).toMatch(/^dev-[0-9a-f]{12}$/);
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{40,}$/); // 256-bit base64url

    const after = await (await get('/health')).json();
    expect(after).toEqual({ ok: true, claimed: true });
  });

  it('rejects a second claim with 409 (already claimed)', async () => {
    await claim({ passphrase: 'first-passphrase', vaultName: 'mine' });
    const res = await post('/claim', { passphrase: 'second-passphrase', vaultName: 'other' });
    expect(res.status).toBe(409);
    expect(await res.json()).toHaveProperty('error', 'this worker has already been claimed');
  });

  it('race: two concurrent claims -> exactly one wins', async () => {
    const [a, b] = await Promise.all([
      post('/claim', { passphrase: 'pass-one', vaultName: 'first' }),
      post('/claim', { passphrase: 'pass-two', vaultName: 'second' }),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);
    const health = (await (await get('/health')).json()) as { claimed: boolean };
    expect(health.claimed).toBe(true);
    // Only the winner's passphrase unlocks the admin login.
    const winner = a.status === 200 ? a : b;
    const loser = a.status === 200 ? b : a;
    const winnerPassphrase = winner === a ? 'pass-one' : 'pass-two';
    const loserPassphrase = loser === a ? 'pass-one' : 'pass-two';
    expect((await post('/admin/login', { passphrase: winnerPassphrase })).status).toBe(200);
    expect((await post('/admin/login', { passphrase: loserPassphrase })).status).toBe(401);
    // Let workerd settle the concurrent DO handles before Miniflare's
    // isolated-storage pop unlinks the sqlite file (Windows EBUSY otherwise).
    await new Promise((resolve) => setTimeout(resolve, 150));
  });

  it('validates the claim payload', async () => {
    const res = await post('/claim', { passphrase: '', vaultName: 'x' });
    expect(res.status).toBe(400);
  });
});

describe('admin session', () => {
  it('rejects a wrong passphrase', async () => {
    const claimed = await claim({ passphrase: 'right-one' });
    void claimed;
    const res = await post('/admin/login', { passphrase: 'wrong-one' });
    expect(res.status).toBe(401);
  });

  it('login sets a signed cookie that authorizes /admin/pair', async () => {
    const claimed = await claim({ passphrase: 'right-one' });
    const login = await post('/admin/login', { passphrase: 'right-one' });
    expect(login.status).toBe(200);
    const setCookie = login.headers.get('set-cookie');
    expect(setCookie).toMatch(/^vsa_admin=\d+\.[0-9a-f]{64};/);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Max-Age=43200');

    const cookie = setCookie!.split(';')[0]!;
    const pairRes = await post('/admin/pair', { deviceName: 'Pixel' }, { cookie });
    expect(pairRes.status).toBe(200);
    const code = ((await pairRes.json()) as { code: string }).code;
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    // And without the cookie: rejected.
    const noCookie = await post('/admin/pair', { deviceName: 'Pixel' });
    expect(noCookie.status).toBe(401);
    // A garbage cookie is rejected too.
    const garbage = await post('/admin/pair', { deviceName: 'Pixel' }, { cookie: 'vsa_admin=1.deadbeef' });
    expect(garbage.status).toBe(401);
  });

  it('the claiming device token authenticates /api/status', async () => {
    const claimed = await claim({ passphrase: 'right-one' });
    const res = await get('/api/status', { authorization: `Bearer ${claimed.token}` });
    expect(res.status).toBe(200);
    const status = (await res.json()) as { vaultName: string; devices: Array<{ id: string }> };
    expect(status.vaultName).toBe(claimed.vaultName);
    expect(status.devices.map((d) => d.id)).toContain(claimed.deviceId);
  });
});
