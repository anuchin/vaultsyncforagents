/**
 * `POST /admin/logout` — clears the admin session cookie (same attributes,
 * Max-Age=0) AND revokes server-side: the DO bumps the session revocation
 * floor, so every outstanding admin cookie (other tabs, stolen copies) dies
 * at once — not just this browser's copy.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { adminLogin, claim, post, resetAll } from './helpers.js';

beforeEach(async () => {
  await resetAll();
});

describe('POST /admin/logout', () => {
  it('clears the admin cookie with the same attributes and Max-Age=0', async () => {
    await claim({ passphrase: 'pppppppp', vaultName: 'v' });
    const cookie = await adminLogin('pppppppp');
    const res = await post('/admin/logout', {}, { cookie });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('vsa_admin=;');
    for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=0']) {
      expect(setCookie).toContain(attribute);
    }
  });

  it('revokes every outstanding admin session server-side (the floor rises)', async () => {
    await claim({ passphrase: 'pppppppp', vaultName: 'v' });
    const cookie = await adminLogin('pppppppp');
    const otherTab = await adminLogin('pppppppp');
    expect((await post('/admin/pair', { deviceName: 'X' }, { cookie })).status).toBe(200);

    expect((await post('/admin/logout', {}, { cookie })).status).toBe(200);

    // BOTH pre-logout cookies are dead — not just the one that asked.
    expect((await post('/admin/pair', { deviceName: 'X' }, { cookie })).status).toBe(401);
    expect((await post('/admin/pair', { deviceName: 'X' }, { cookie: otherTab })).status).toBe(401);
    // The passphrase itself is untouched: a fresh login works immediately.
    expect((await post('/admin/login', { passphrase: 'pppppppp' })).status).toBe(200);
  });

  it('is idempotent without a session — still 200, still clears, floor untouched', async () => {
    await claim({ passphrase: 'pppppppp', vaultName: 'v' });
    const cookie = await adminLogin('pppppppp');
    // An unauthenticated logout must NOT revoke the real admin's session.
    expect((await post('/admin/logout', {})).status).toBe(200);
    expect((await post('/admin/pair', { deviceName: 'X' }, { cookie })).status).toBe(200);
  });
});
