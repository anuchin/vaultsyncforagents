/**
 * Per-IP throttling of the unauthenticated guessing surfaces (§3, §14):
 * `POST /pair` and `POST /admin/login` budget 10 failures per client IP per
 * 15-minute window, then answer 429 + Retry-After. Success clears the
 * counter; a closed window starts a fresh budget (clock pinned via the DO's
 * time seam).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  adminLogin,
  claim,
  mintPairingCode,
  post,
  resetAll,
  roomSql,
  setRoomTime,
} from './helpers.js';

const IP = { 'cf-connecting-ip': '203.0.113.9' };
const OTHER_IP = { 'cf-connecting-ip': '198.51.100.4' };
const WINDOW_MS = 15 * 60 * 1000;

beforeEach(async () => {
  await resetAll();
});

async function wrongPairAttempts(n: number): Promise<void> {
  for (let i = 0; i < n; i++) {
    const res = await post('/pair', { code: 'ZZZZ-ZZZZ', deviceName: 'X' }, IP);
    expect(res.status, `wrong attempt ${i + 1}`).toBe(401);
  }
}

describe('rate limiting on POST /pair', () => {
  it('after 10 failed attempts the surface closes: 429 + Retry-After + error body', async () => {
    await claim({ passphrase: 'pppp', vaultName: 'v' });
    await wrongPairAttempts(10);

    const blocked = await post('/pair', { code: 'ZZZZ-ZZZZ', deviceName: 'X' }, IP);
    expect(blocked.status).toBe(429);
    const retryAfter = Number(blocked.headers.get('retry-after'));
    expect(Number.isFinite(retryAfter)).toBe(true);
    expect(retryAfter).toBeGreaterThan(0);
    expect(retryAfter).toBeLessThanOrEqual(900);
    expect(((await blocked.json()) as { error: string }).error).toMatch(/too many failed attempts/i);

    // Even the CORRECT code is refused while throttled (the guessing surface
    // is closed, not just wrong guesses).
    const cookie = await adminLogin('pppp');
    const code = await mintPairingCode(cookie, 'Late', 'desktop');
    expect((await post('/pair', { code, deviceName: 'Late' }, IP)).status).toBe(429);

    // Another IP has its own budget: the same correct code still redeems.
    expect((await post('/pair', { code, deviceName: 'Other' }, OTHER_IP)).status).toBe(200);
  });

  it('a correct code still succeeds before the cap and clears the counter', async () => {
    await claim({ passphrase: 'pppp', vaultName: 'v' });
    const cookie = await adminLogin('pppp');
    const code = await mintPairingCode(cookie, 'Real', 'desktop');

    await wrongPairAttempts(9); // one guess left in the budget
    expect((await post('/pair', { code, deviceName: 'Real' }, IP)).status).toBe(200);

    // Success cleared the counter: a full new budget of failures is served
    // 401 (not 429) before the surface closes again.
    await wrongPairAttempts(10);
    expect((await post('/pair', { code: 'ZZZZ-ZZZZ', deviceName: 'X' }, IP)).status).toBe(429);
  });

  it('expired and already-used codes count as failures too', async () => {
    await claim({ passphrase: 'pppp', vaultName: 'v' });
    const cookie = await adminLogin('pppp');

    // Expired: the 10th failure is an expired code, and it closes the door.
    const expired = await mintPairingCode(cookie, 'Late', 'desktop');
    await roomSql(`UPDATE pairs SET expires_at = 1 WHERE code_hash = (SELECT code_hash FROM pairs LIMIT 1)`);
    await wrongPairAttempts(9);
    expect((await post('/pair', { code: expired, deviceName: 'Late' }, IP)).status).toBe(401);
    expect((await post('/pair', { code: 'ZZZZ-ZZZZ', deviceName: 'X' }, IP)).status).toBe(429);

    // Reused: fresh budget (new IP), a code burned by a successful redeem.
    const oneShot = await mintPairingCode(cookie, 'OneShot', 'cli');
    expect((await post('/pair', { code: oneShot, deviceName: 'OneShot' }, OTHER_IP)).status).toBe(200);
    for (let i = 0; i < 9; i++) {
      expect((await post('/pair', { code: 'ZZZZ-ZZZZ', deviceName: 'X' }, OTHER_IP)).status).toBe(401);
    }
    expect((await post('/pair', { code: oneShot, deviceName: 'Again' }, OTHER_IP)).status).toBe(401);
    expect((await post('/pair', { code: 'ZZZZ-ZZZZ', deviceName: 'X' }, OTHER_IP)).status).toBe(429);
  });

  it('the counter resets once the 15-minute window closes (injected time)', async () => {
    await claim({ passphrase: 'pppp', vaultName: 'v' });
    const cookie = await adminLogin('pppp');
    await wrongPairAttempts(10);
    expect((await post('/pair', { code: 'ZZZZ-ZZZZ', deviceName: 'X' }, IP)).status).toBe(429);

    // Fast-forward past the window inside the DO.
    await setRoomTime(Date.now() + WINDOW_MS + 1000);

    // Wrong guess: 401 again (fresh budget), not 429…
    expect((await post('/pair', { code: 'ZZZZ-ZZZZ', deviceName: 'X' }, IP)).status).toBe(401);
    // …and a code minted under the pinned clock redeems cleanly.
    const code = await mintPairingCode(cookie, 'Fresh', 'mobile');
    expect((await post('/pair', { code, deviceName: 'Fresh' }, IP)).status).toBe(200);
  });
});

describe('rate limiting on POST /admin/login', () => {
  it('after 10 wrong passphrases: 429 + Retry-After; correct one works before the cap', async () => {
    await claim({ passphrase: 'right-one', vaultName: 'v' });

    for (let i = 0; i < 9; i++) {
      expect((await post('/admin/login', { passphrase: 'nope' }, IP)).status).toBe(401);
    }
    expect((await post('/admin/login', { passphrase: 'right-one' }, IP)).status).toBe(200);

    // Success cleared the counter: a fresh budget of 10 failures, then 429
    // even for the CORRECT passphrase while the window stands.
    for (let i = 0; i < 10; i++) {
      expect((await post('/admin/login', { passphrase: 'nope' }, IP)).status).toBe(401);
    }
    const blocked = await post('/admin/login', { passphrase: 'right-one' }, IP);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get('retry-after')).toMatch(/^\d+$/);
    expect(((await blocked.json()) as { error: string }).error).toMatch(/too many failed attempts/i);

    // A different IP still logs in.
    expect((await post('/admin/login', { passphrase: 'right-one' }, OTHER_IP)).status).toBe(200);
  });

  it('the counter resets once the 15-minute window closes (injected time)', async () => {
    await claim({ passphrase: 'right-one', vaultName: 'v' });
    for (let i = 0; i < 10; i++) {
      expect((await post('/admin/login', { passphrase: 'nope' }, IP)).status).toBe(401);
    }
    expect((await post('/admin/login', { passphrase: 'right-one' }, IP)).status).toBe(429);

    await setRoomTime(Date.now() + WINDOW_MS + 1000);
    expect((await post('/admin/login', { passphrase: 'right-one' }, IP)).status).toBe(200);
  });
});
