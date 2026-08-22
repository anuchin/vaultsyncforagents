/**
 * `POST /admin/logout` — clears the admin session cookie (same attributes,
 * Max-Age=0) so "Sign out" actually ends the session, not just the view.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { adminLogin, claim, post, resetAll } from './helpers.js';

beforeEach(async () => {
  await resetAll();
});

describe('POST /admin/logout', () => {
  it('clears the admin cookie with the same attributes and Max-Age=0', async () => {
    await claim({ passphrase: 'pppp', vaultName: 'v' });
    const cookie = await adminLogin('pppp');
    const res = await post('/admin/logout', {}, { cookie });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toContain('vsa_admin=;');
    for (const attribute of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/', 'Max-Age=0']) {
      expect(setCookie).toContain(attribute);
    }
  });

  it('is idempotent without a session — still 200, still clears', async () => {
    await claim({ passphrase: 'pppp', vaultName: 'v' });
    const res = await post('/admin/logout', {});
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toContain('Max-Age=0');
  });
});
