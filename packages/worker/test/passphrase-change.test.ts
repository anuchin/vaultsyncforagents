/**
 * `POST /admin/passphrase-change` (§3): rotation semantics — `current` is
 * re-verified argon2-constant-time, the hash is replaced, and the session
 * secret ROTATES so every pre-existing admin cookie dies instantly while the
 * acting admin gets a fresh one. Wrong `current` shares the per-IP
 * auth-failure budget with `/admin/login` and `/pair`; success clears it.
 * Device tokens (`devices.token_hash`) are independent of both the
 * passphrase and the session secret, so paired devices keep syncing through
 * a rotation. Admin route: same-origin only, never any CORS headers.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  adminLogin,
  claim,
  get,
  hello,
  mintPairingCode,
  post,
  request,
  resetAll,
  WsClient,
} from './helpers.js';

const PLUGIN_ORIGIN = 'app://obsidian.md';
const IP = { 'cf-connecting-ip': '203.0.113.77' };
const OTHER_IP = { 'cf-connecting-ip': '198.51.100.9' };
const CORS_HEADER_NAMES = [
  'access-control-allow-origin',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'access-control-max-age',
];

function change(
  cookie: string,
  current: string,
  next: string,
  headers: Record<string, string> = {},
): Promise<Response> {
  return post('/admin/passphrase-change', { current, next }, { cookie, ...headers });
}

function cookieOf(res: Response): string {
  const setCookie = res.headers.get('set-cookie');
  expect(setCookie).not.toBeNull();
  return setCookie!.split(';')[0]!;
}

beforeEach(async () => {
  await resetAll();
});

describe('happy path', () => {
  it('changes the passphrase: old one fails login, new one works, fresh cookie issued', async () => {
    await claim({ passphrase: 'old-pass', vaultName: 'v' });
    const cookie = await adminLogin('old-pass');

    const res = await change(cookie, 'old-pass', 'new-pass');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; expiresAt: number };
    expect(body.ok).toBe(true);
    expect(body.expiresAt).toBeGreaterThan(Date.now());

    // The re-issued session is a normal 12 h admin cookie.
    const setCookie = res.headers.get('set-cookie')!;
    expect(setCookie).toMatch(/^vsa_admin=[A-Za-z0-9_-]+\.\d+\.[0-9a-f]{64};/);
    expect(setCookie).toContain('HttpOnly');
    expect(setCookie).toContain('Secure');
    expect(setCookie).toContain('SameSite=Lax');
    expect(setCookie).toContain('Max-Age=43200');

    // Only the rotated passphrase signs in any more…
    expect((await post('/admin/login', { passphrase: 'old-pass' })).status).toBe(401);
    expect((await post('/admin/login', { passphrase: 'new-pass' })).status).toBe(200);
    // …and the fresh cookie keeps authorizing the admin surface.
    expect((await post('/admin/pair', { deviceName: 'Pixel' }, { cookie: cookieOf(res) })).status).toBe(200);
  });

  it('records a passphrase_changed event in the status feed', async () => {
    await claim({ passphrase: 'old-pass', vaultName: 'v' });
    const cookie = await adminLogin('old-pass');
    const res = await change(cookie, 'old-pass', 'new-pass');
    const status = (await (await get('/api/status', { cookie: cookieOf(res) })).json()) as {
      recentEvents: Array<{ kind: string }>;
    };
    expect(status.recentEvents[0]!.kind).toBe('passphrase_changed');
  });

  it('changing to the SAME passphrase is allowed (still rotates salt + secret)', async () => {
    await claim({ passphrase: 'same-one', vaultName: 'v' });
    const before = await adminLogin('same-one');
    const res = await change(before, 'same-one', 'same-one');
    expect(res.status).toBe(200);
    // The pre-change cookie is dead even though the passphrase is unchanged…
    expect((await post('/admin/pair', { deviceName: 'X' }, { cookie: before })).status).toBe(401);
    // …and the passphrase itself still logs in.
    expect((await post('/admin/login', { passphrase: 'same-one' })).status).toBe(200);
  });
});

describe('auth + validation', () => {
  it('requires a valid admin session cookie', async () => {
    await claim({ passphrase: 'pppppppp', vaultName: 'v' });
    expect((await post('/admin/passphrase-change', { current: 'pppppppp', next: 'qqqqqqqq' })).status).toBe(401);
    expect((await change('vsa_admin=1.deadbeef', 'pppppppp', 'qqqqqqqq')).status).toBe(401);
  });

  it('rejects a wrong current passphrase with 401 and changes nothing', async () => {
    await claim({ passphrase: 'right-one', vaultName: 'v' });
    const cookie = await adminLogin('right-one');
    const res = await change(cookie, 'wrong-one', 'next-one');
    expect(res.status).toBe(401);
    expect(await res.json()).toHaveProperty('error', 'invalid current passphrase');
    // Nothing rotated: the old passphrase still logs in, the cookie still works.
    expect((await post('/admin/login', { passphrase: 'right-one' })).status).toBe(200);
    expect((await post('/admin/pair', { deviceName: 'X' }, { cookie })).status).toBe(200);
  });

  it('validates next like claim does (string, min 8 chars) without burning the budget', async () => {
    await claim({ passphrase: 'pppppppp', vaultName: 'v' });
    const cookie = await adminLogin('pppppppp');
    for (const body of [
      { current: 'pppppppp', next: 'abc' },
      { current: 'pppppppp', next: '' },
      { current: 'pppppppp', next: 42 },
      { current: 'pppppppp' },
      { next: 'qqqqqqqq' },
      {},
    ]) {
      const res = await post('/admin/passphrase-change', body, { cookie, ...IP });
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    // Malformed bodies never counted as failures: login from that IP is fine.
    expect((await post('/admin/login', { passphrase: 'pppppppp' }, IP)).status).toBe(200);
  });

  it('answers 421 while unclaimed', async () => {
    // Bodyless on purpose: the 421 gate answers before reading any body, and
    // leaving the request stream unread makes workerd log a spurious
    // "Can't read from request stream" info line (same on every admin route).
    const res = await request('POST', '/admin/passphrase-change');
    expect(res.status).toBe(421);
    expect(await res.json()).toHaveProperty('error', 'unclaimed');
  });
});

describe('session rotation', () => {
  it('kills EVERY pre-existing admin cookie, not just the acting one', async () => {
    await claim({ passphrase: 'alpha-pass', vaultName: 'v' });
    const tab1 = await adminLogin('alpha-pass');
    const tab2 = await adminLogin('alpha-pass');

    const res = await change(tab2, 'alpha-pass', 'beta-pass');
    expect(res.status).toBe(200);
    const fresh = cookieOf(res);

    for (const stale of [tab1, tab2]) {
      expect((await post('/admin/pair', { deviceName: 'X' }, { cookie: stale })).status).toBe(401);
      expect((await get('/api/status', { cookie: stale })).status).toBe(401);
    }
    expect((await post('/admin/pair', { deviceName: 'X' }, { cookie: fresh })).status).toBe(200);
    expect((await get('/api/status', { cookie: fresh })).status).toBe(200);
  });
});

describe('devices are untouched by a rotation', () => {
  it('paired devices keep syncing: Bearer status + WS hello still succeed', async () => {
    const claimed = await claim({ passphrase: 'old-pass', deviceName: 'Laptop' });
    const cookie = await adminLogin('old-pass');
    // A second device, paired via code like a real setup.
    const code = await mintPairingCode(cookie, 'Phone', 'mobile');
    const phone = (await (await post('/pair', { code, deviceName: 'Phone', deviceType: 'mobile' })).json()) as {
      token: string;
    };

    expect((await change(cookie, 'old-pass', 'new-pass')).status).toBe(200);

    for (const token of [claimed.token, phone.token]) {
      expect((await get('/api/status', { authorization: `Bearer ${token}` })).status).toBe(200);
      const ws = await WsClient.connect();
      const ack = await hello(ws, token);
      expect(ack.type, 'WS hello still succeeds after the rotation').toBe('helloAck');
      ws.close();
    }
  });
});

describe('throttling (shared per-IP budget with /admin/login and /pair)', () => {
  it('wrong-current failures count: 10 close the surface even for the CORRECT current', async () => {
    await claim({ passphrase: 'right-one', vaultName: 'v' });
    const cookie = await adminLogin('right-one');
    for (let i = 0; i < 10; i++) {
      const res = await change(cookie, 'nope', 'next-one', IP);
      expect(res.status, `attempt ${i + 1}`).toBe(401);
    }
    // Same IP: even the correct current is refused with 429 + Retry-After…
    const blocked = await change(cookie, 'right-one', 'next-one', IP);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toMatch(/^\d+$/);
    expect(((await blocked.json()) as { error: string }).error).toMatch(/too many failed attempts/i);
    // …the budget is SHARED: /admin/login from that IP is closed too…
    expect((await post('/admin/login', { passphrase: 'right-one' }, IP)).status).toBe(429);
    // …while another IP changes fine (before its own budget is touched).
    const otherCookie = await adminLogin('right-one');
    expect((await change(otherCookie, 'right-one', 'next-one', OTHER_IP)).status).toBe(200);
  });

  it('login failures and wrong-current failures share ONE budget', async () => {
    await claim({ passphrase: 'right-one', vaultName: 'v' });
    const cookie = await adminLogin('right-one');
    for (let i = 0; i < 9; i++) {
      expect((await post('/admin/login', { passphrase: 'nope' }, IP)).status).toBe(401);
    }
    // The 10th failure rides the passphrase-change surface.
    expect((await change(cookie, 'nope', 'next-one', IP)).status).toBe(401);
    expect((await post('/admin/login', { passphrase: 'right-one' }, IP)).status).toBe(429);
  });

  it('a successful change clears the budget (same semantics as login)', async () => {
    await claim({ passphrase: 'right-one', vaultName: 'v' });
    const cookie = await adminLogin('right-one');
    for (let i = 0; i < 5; i++) {
      expect((await change(cookie, 'nope', 'next-one', IP)).status).toBe(401);
    }
    expect((await change(cookie, 'right-one', 'new-pass', IP)).status).toBe(200);
    // Fresh budget: a full 10 wrong logins from that IP are plain 401s…
    for (let i = 0; i < 10; i++) {
      expect((await post('/admin/login', { passphrase: 'nope' }, IP)).status).toBe(401);
    }
    // …and only the 11th closes the surface.
    expect((await post('/admin/login', { passphrase: 'nope' }, IP)).status).toBe(429);
  });
});

describe('CORS: same-origin only (admin surface)', () => {
  it('responses carry no Access-Control-* headers, success and error alike', async () => {
    await claim({ passphrase: 'pppppppp', vaultName: 'v' });
    const cookie = await adminLogin('pppppppp');

    const ok = await change(cookie, 'pppppppp', 'qqqqqqqq', { origin: PLUGIN_ORIGIN });
    expect(ok.status).toBe(200);
    // Wrong current (with the fresh cookie — the old one just died).
    const bad = await change(cookieOf(ok), 'nope', 'rrrrrrrr', { origin: PLUGIN_ORIGIN });
    expect(bad.status).toBe(401);
    for (const res of [ok, bad]) {
      for (const name of CORS_HEADER_NAMES) {
        expect(res.headers.get(name), name).toBeNull();
      }
    }
  });

  it('no preflight is answered for this route', async () => {
    const res = await request('OPTIONS', '/admin/passphrase-change', {
      origin: PLUGIN_ORIGIN,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type',
    });
    expect(res.status).not.toBe(204); // falls through the router — no preflight
    for (const name of CORS_HEADER_NAMES) {
      expect(res.headers.get(name), name).toBeNull();
    }
  });
});
