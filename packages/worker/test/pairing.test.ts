/**
 * Pairing lifecycle (FR-23, §3): code mint -> redeem -> WS hello with the
 * minted token -> expiry / reuse / revocation / bad-token rejection.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  WsClient,
  adminLogin,
  claim,
  get,
  hello,
  mintPairingCode,
  pair,
  post,
  resetAll,
  roomSql,
} from './helpers.js';

beforeEach(async () => {
  await resetAll();
});

describe('pairing', () => {
  it('mints a XXXX-XXXX code (stored hashed) and redeems it for a working device token', async () => {
    const claimed = await claim({ passphrase: 'pppppppp', vaultName: 'v' });
    const cookie = await adminLogin('pppppppp');
    const code = await mintPairingCode(cookie, 'Pixel', 'mobile');
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);

    // Only the SHA-256 of the normalized code is stored (claim()'s own
    // redeemed row may also be present — assert the minted one specifically).
    const rows = await roomSql<{ code_hash: string; device_name: string; used: number }>(
      "SELECT code_hash, device_name, used FROM pairs WHERE device_name = 'Pixel'",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.device_name).toBe('Pixel');
    expect(rows[0]!.code_hash).not.toContain(code);
    expect(rows[0]!.code_hash).toMatch(/^[0-9a-f]{64}$/);

    const { token, deviceId } = await pair(code, 'Pixel', 'mobile');
    expect(deviceId).toMatch(/^dev-[0-9a-f]{12}$/);
    expect(token).toMatch(/^[A-Za-z0-9_-]{40,}$/);

    // The token authenticates a real WS hello.
    const ws = await WsClient.connect();
    const ack = await hello(ws, token);
    expect(ack).toMatchObject({ type: 'helloAck', deviceId, vaultName: 'v' });
    ws.close();

    // Redeeming accepted the dashed form the dashboard shows and the bare
    // form a user might type (normalization).
    const code2 = await mintPairingCode(cookie, 'Bare', 'cli');
    const bare = await pair(code2.replace('-', ''), 'Bare', 'cli');
    expect(bare.deviceId).toMatch(/^dev-/);
  });

  it('rejects an expired code with a clear error', async () => {
    const claimed = await claim({ passphrase: 'pppppppp', vaultName: 'v' });
    void claimed;
    const cookie = await adminLogin('pppppppp');
    const code = await mintPairingCode(cookie, 'Late', 'desktop');
    // Fast-forward past the 10-minute TTL directly in the DO.
    await roomSql('UPDATE pairs SET expires_at = 1');
    const res = await post('/pair', { code, deviceName: 'Late', deviceType: 'desktop' });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe(
      'pairing code is invalid, expired, or already used',
    );
  });

  it('burns the code on use — a second redeem is rejected', async () => {
    const claimed = await claim({ passphrase: 'pppppppp', vaultName: 'v' });
    void claimed;
    const cookie = await adminLogin('pppppppp');
    const code = await mintPairingCode(cookie, 'OneShot', 'daemon');
    const first = await post('/pair', { code, deviceName: 'OneShot', deviceType: 'daemon' });
    expect(first.status).toBe(200);
    const second = await post('/pair', { code, deviceName: 'OneShot again', deviceType: 'daemon' });
    expect(second.status).toBe(401);
    const used = await roomSql<{ used: number }>('SELECT used FROM pairs');
    expect(used[0]!.used).toBe(1);
  });

  it('rejects a garbage code', async () => {
    await claim({ passphrase: 'pppppppp', vaultName: 'v' });
    const res = await post('/pair', { code: 'ZZZZ-ZZZZ', deviceName: 'X', deviceType: 'cli' });
    expect(res.status).toBe(401);
  });

  it('a revoked device is rejected everywhere (WS hello + HTTP)', async () => {
    const claimed = await claim({ passphrase: 'pppppppp', vaultName: 'v' });
    const cookie = await adminLogin('pppppppp');
    const code = await mintPairingCode(cookie, 'Gone', 'desktop');
    const { token, deviceId } = await pair(code, 'Gone', 'desktop');

    // Works before revocation.
    expect((await get('/api/status', { authorization: `Bearer ${token}` })).status).toBe(200);

    const revoke = await post('/admin/revoke', { deviceId }, { cookie });
    expect(revoke.status).toBe(200);

    // HTTP: 401.
    expect((await get('/api/status', { authorization: `Bearer ${token}` })).status).toBe(401);
    expect((await get('/blob/' + '0'.repeat(64), { authorization: `Bearer ${token}` })).status).toBe(401);

    // WS: error REVOKED + close.
    const ws = await WsClient.connect();
    const reply = await hello(ws, token);
    expect(reply).toMatchObject({ type: 'error', code: 'REVOKED' });
    await ws.waitClosed();
    ws.close();
    void claimed;
  });

  it('revoking a device kills its LIVE socket (close 4003 revoked); other devices keep syncing', async () => {
    const claimed = await claim({ passphrase: 'pppppppp', vaultName: 'v' });
    const cookie = await adminLogin('pppppppp');
    const code = await mintPairingCode(cookie, 'Doomed', 'desktop');
    const { token, deviceId } = await pair(code, 'Doomed', 'desktop');

    const wsDoomed = await WsClient.connect();
    await hello(wsDoomed, token);
    const wsAdmin = await WsClient.connect();
    await hello(wsAdmin, claimed.token);

    const revoke = await post('/admin/revoke', { deviceId }, { cookie });
    expect(revoke.status).toBe(200);

    // The revoked device learns why, then the socket dies with 4003 'revoked'.
    const error = await wsDoomed.next((m) => m.type === 'error');
    expect(error).toMatchObject({ type: 'error', code: 'REVOKED' });
    await wsDoomed.waitClosed();
    expect(wsDoomed.closeCode).toBe(4003);
    expect(wsDoomed.closeReason).toBe('revoked');

    // The admin's live socket is untouched and still answers.
    const pong = wsAdmin.next((m) => m.type === 'pong');
    wsAdmin.send({ type: 'ping' });
    expect(await pong).toEqual({ type: 'pong' });
    wsAdmin.close();
  });

  it('WS hello with an unknown token is rejected and the socket closed', async () => {
    await claim({ passphrase: 'pppppppp', vaultName: 'v' });
    const ws = await WsClient.connect();
    const reply = await hello(ws, 'not-a-real-token');
    expect(reply).toMatchObject({ type: 'error', code: 'UNAUTHORIZED' });
    await ws.waitClosed();
    ws.close();
  });

  it('messages before hello are rejected', async () => {
    await claim({ passphrase: 'pppppppp', vaultName: 'v' });
    const ws = await WsClient.connect();
    ws.send({ type: 'getManifest' });
    const reply = await ws.next((m) => m.type === 'error');
    expect(reply).toMatchObject({ type: 'error', code: 'UNAUTHORIZED', message: 'say hello first' });
    await ws.waitClosed();
    ws.close();
  });
});
