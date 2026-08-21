/**
 * `/api/status` (FR-30..FR-32): shape after real activity — devices with
 * online state, lastEdit, attachments, storageBytes, recentEvents.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  WsClient,
  adminLogin,
  b64,
  claim,
  enc,
  get,
  hashOf,
  hello,
  mintPairingCode,
  pair,
  resetAll,
} from './helpers.js';
import { SERVER_VERSION } from '../src/version.js';

interface StatusShape {
  vaultName: string;
  claimed: boolean;
  health: string;
  serverVersion?: string;
  devices: Array<{
    id: string;
    name: string;
    type: string;
    lastSeen: number;
    revoked: boolean;
    online: boolean;
  }>;
  lastEdit: { ts: number; deviceId: string; path: string } | null;
  attachments: { count: number; bytes: number };
  storageBytes: number;
  recentEvents: Array<{ seq: number | null; ts: number; deviceId: string | null; kind: string; path: string | null }>;
}

beforeEach(async () => {
  await resetAll();
});

describe('GET /api/status', () => {
  it('reflects devices, lastEdit, attachments and events after activity', async () => {
    const claimed = await claim({ passphrase: 'pppp', vaultName: 'personal', deviceName: 'Desktop' });
    const cookie = await adminLogin('pppp');
    const code = await mintPairingCode(cookie, 'Mobile', 'mobile');
    const mobile = await pair(code, 'Mobile', 'mobile');

    // Real activity: two devices connect, one commits a note and an attachment.
    const wsDesktop = await WsClient.connect();
    await hello(wsDesktop, claimed.token);
    const wsMobile = await WsClient.connect();
    await hello(wsMobile, mobile.token);

    const note = enc('just a note');
    const ackNote = wsDesktop.next((m) => m.type === 'commitAck');
    wsDesktop.send({
      type: 'commit',
      path: '/notes/a.md',
      parentVersion: null,
      hash: await hashOf(note),
      size: note.byteLength,
      kind: 'edit',
      inline: b64(note),
    });
    await ackNote;

    const bin = new Uint8Array([0, 1, 2, 250, 254, 255]);
    const ackBin = wsDesktop.next((m) => m.type === 'commitAck');
    wsDesktop.send({
      type: 'commit',
      path: '/attachments/logo.bin',
      parentVersion: null,
      hash: await hashOf(bin),
      size: bin.byteLength,
      kind: 'edit',
      inline: b64(bin),
    });
    await ackBin;
    await wsMobile.next((m) => m.type === 'change' && m.path === '/attachments/logo.bin');

    // Device-token auth path.
    const res = await get('/api/status', { authorization: `Bearer ${mobile.token}` });
    expect(res.status).toBe(200);
    const status = (await res.json()) as StatusShape;

    expect(status.vaultName).toBe('personal');
    expect(status.claimed).toBe(true);
    expect(status.health).toBe('ok');
    expect(status.serverVersion).toBe(SERVER_VERSION);

    expect(status.devices).toHaveLength(2);
    const byName = Object.fromEntries(status.devices.map((d) => [d.name, d]));
    const desktopEntry = byName['Desktop'];
    const mobileEntry = byName['Mobile'];
    expect(desktopEntry).toBeDefined();
    expect(mobileEntry).toBeDefined();
    expect(desktopEntry!).toMatchObject({ id: claimed.deviceId, type: 'desktop', revoked: false, online: true });
    expect(mobileEntry!).toMatchObject({ id: mobile.deviceId, type: 'mobile', revoked: false, online: true });
    expect(desktopEntry!.lastSeen).toBeGreaterThan(0);

    // Last synced edit: the attachment commit (most recent change event).
    expect(status.lastEdit).toEqual({
      ts: expect.any(Number) as number,
      deviceId: claimed.deviceId,
      path: '/attachments/logo.bin',
    });

    // Attachments: the .bin counts (the .md does not).
    expect(status.attachments).toEqual({ count: 1, bytes: bin.byteLength });

    // Storage: both blobs are tracked (deduped by hash).
    expect(status.storageBytes).toBeGreaterThanOrEqual(note.byteLength + bin.byteLength);

    // Event feed: claim + pair + 2 changes, newest first, capped fields.
    const kinds = status.recentEvents.map((e) => e.kind);
    expect(kinds).toContain('claimed');
    expect(kinds).toContain('device_paired');
    expect(kinds.filter((k) => k === 'change')).toHaveLength(2);
    expect(status.recentEvents[0]).toMatchObject({ kind: 'change', path: '/attachments/logo.bin' });

    // Admin-cookie auth path sees the same document.
    const adminRes = await get('/api/status', { cookie });
    expect(adminRes.status).toBe(200);
    expect(((await adminRes.json()) as StatusShape).devices).toHaveLength(2);

    wsDesktop.close();
    wsMobile.close();
  });

  it('reports a fresh vault with lastEdit null and empty counters', async () => {
    const claimed = await claim({ vaultName: 'empty-vault' });
    const res = await get('/api/status', { authorization: `Bearer ${claimed.token}` });
    const status = (await res.json()) as StatusShape;
    expect(status.lastEdit).toBeNull();
    expect(status.attachments).toEqual({ count: 0, bytes: 0 });
    expect(status.storageBytes).toBe(0);
    expect(status.recentEvents.map((e) => e.kind)).toEqual(['claimed']);
    expect(status.devices).toHaveLength(1);
    // The claiming device has not said hello on the WS yet -> offline.
    expect(status.devices[0]!.online).toBe(false);
  });
});
