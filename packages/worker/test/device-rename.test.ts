/**
 * `PATCH /device` — device self-service rename: the calling device's Bearer
 * token authorizes renaming ITSELF only; admin cookies are refused; names
 * are validated (1-30 chars, no control characters); revoked tokens 401; an
 * unclaimed worker gates the route with 421.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { SELF } from 'cloudflare:test';
import {
  adminLogin,
  claim,
  get,
  mintPairingCode,
  pair,
  resetAll,
  request,
  TEST_ORIGIN,
} from './helpers.js';

interface DeviceShape {
  id: string;
  name: string;
  type: string;
  lastSeen: number;
  revoked: boolean;
  online: boolean;
}

async function patch(
  path: string,
  body: unknown,
  headers?: Record<string, string>,
): Promise<Response> {
  return SELF.fetch(`${TEST_ORIGIN}${path}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', ...(headers ?? {}) },
    body: JSON.stringify(body),
  });
}

const bearer = (token: string): Record<string, string> => ({ authorization: `Bearer ${token}` });

beforeEach(async () => {
  await resetAll();
});

describe('PATCH /device', () => {
  it('renames the calling device and is reflected in /api/status + events', async () => {
    const claimed = await claim({ passphrase: 'pppp', vaultName: 'vault', deviceName: 'Desktop' });
    const cookie = await adminLogin('pppp');
    const code = await mintPairingCode(cookie, 'Old name', 'mobile');
    const mobile = await pair(code, 'Old name', 'mobile');

    const res = await patch('/device', { name: 'Pixel 9' }, bearer(mobile.token));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; device: DeviceShape };
    expect(body.ok).toBe(true);
    expect(body.device).toMatchObject({ id: mobile.deviceId, name: 'Pixel 9', type: 'mobile' });

    // The devices list (device-token auth) shows the new name.
    const status = (await (await get('/api/status', bearer(mobile.token))).json()) as {
      devices: DeviceShape[];
      recentEvents: Array<{ kind: string; deviceId: string | null }>;
    };
    const byId = Object.fromEntries(status.devices.map((d) => [d.id, d]));
    expect(byId[mobile.deviceId]!.name).toBe('Pixel 9');
    expect(byId[claimed.deviceId]!.name).toBe('Desktop'); // untouched

    // A device_renamed event was recorded for the renaming device.
    const renamed = status.recentEvents.find((e) => e.kind === 'device_renamed');
    expect(renamed).toMatchObject({ deviceId: mobile.deviceId });

    // Trims surrounding whitespace before storing.
    const trimmed = await patch('/device', { name: '  Pixel 9 Pro  ' }, bearer(mobile.token));
    expect(trimmed.status).toBe(200);
    expect(((await trimmed.json()) as { device: DeviceShape }).device.name).toBe('Pixel 9 Pro');
  });

  it('a device token can only rename itself — other devices are unreachable', async () => {
    await claim({ passphrase: 'pppp', vaultName: 'vault', deviceName: 'Desktop' });
    const cookie = await adminLogin('pppp');
    const codeA = await mintPairingCode(cookie, 'A', 'desktop');
    const a = await pair(codeA, 'A', 'desktop');
    const codeB = await mintPairingCode(cookie, 'B', 'desktop');
    const b = await pair(codeB, 'B', 'desktop');

    // Even naming another device's id in the body renames the CALLER only.
    const res = await patch(
      '/device',
      { name: 'Hijack', deviceId: b.deviceId },
      bearer(a.token),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { device: DeviceShape }).device.id).toBe(a.deviceId);

    const status = (await (await get('/api/status', bearer(b.token))).json()) as {
      devices: DeviceShape[];
    };
    const byId = Object.fromEntries(status.devices.map((d) => [d.id, d]));
    expect(byId[a.deviceId]!.name).toBe('Hijack');
    expect(byId[b.deviceId]!.name).toBe('B'); // unchanged
  });

  it('rejects invalid names with 400', async () => {
    const claimed = await claim({ passphrase: 'pppp', vaultName: 'vault' });
    const tooLong = 'x'.repeat(31);
    for (const name of ['', '   ', tooLong, 'bad\u0007name', 'line\nbreak']) {
      const res = await patch('/device', { name }, bearer(claimed.token));
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toContain('1-30');
    }
    // Non-string / missing / malformed bodies are 400 too.
    expect((await patch('/device', { name: 42 }, bearer(claimed.token))).status).toBe(400);
    expect((await patch('/device', {}, bearer(claimed.token))).status).toBe(400);
    // 30 chars is fine (the boundary).
    expect((await patch('/device', { name: 'y'.repeat(30) }, bearer(claimed.token))).status).toBe(200);
  });

  it('an admin session cookie does NOT authorize the route', async () => {
    const claimed = await claim({ passphrase: 'pppp', vaultName: 'vault', deviceName: 'Desktop' });
    const cookie = await adminLogin('pppp');
    const res = await patch('/device', { name: 'Via admin' }, { cookie });
    expect(res.status).toBe(401);
    // The claiming device's own token still works after the refusal.
    expect((await patch('/device', { name: 'Via token' }, bearer(claimed.token))).status).toBe(200);
  });

  it('a revoked token is rejected with 401', async () => {
    const claimed = await claim({ passphrase: 'pppp', vaultName: 'vault' });
    const cookie = await adminLogin('pppp');
    const code = await mintPairingCode(cookie, 'Doomed', 'desktop');
    const doomed = await pair(code, 'Doomed', 'desktop');
    const revoke = await SELF.fetch(`${TEST_ORIGIN}/admin/revoke`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ deviceId: doomed.deviceId }),
    });
    expect(revoke.status).toBe(200);

    const res = await patch('/device', { name: 'Ghost' }, bearer(doomed.token));
    expect(res.status).toBe(401);
    // An unrelated live token is unaffected by the revocation.
    expect((await patch('/device', { name: 'Fine' }, bearer(claimed.token))).status).toBe(200);
  });

  it('an unclaimed worker answers 421', async () => {
    const res = await patch('/device', { name: 'Nope' }, bearer('some-token'));
    expect(res.status).toBe(421);
    expect(((await res.json()) as { error: string }).error).toBe('unclaimed');
  });

  it('answers the plugin renderer preflight (CORS includes PATCH)', async () => {
    const res = await request('OPTIONS', '/device', {
      origin: 'app://obsidian.md',
      'access-control-request-method': 'PATCH',
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(res.headers.get('access-control-allow-methods')).toContain('PATCH');
  });
});
