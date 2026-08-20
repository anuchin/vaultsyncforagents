/**
 * Row-model tests — the rendering logic for devices, the event feed, the
 * health badge, version lists, and the pairing deep link (pure; no DOM).
 */
import { describe, expect, it } from 'vitest';
import {
  deviceCounts,
  deviceNameMap,
  deviceRows,
  eventLabel,
  eventRows,
  healthBadge,
  pairDeepLink,
  versionRows,
} from '../src/rows.js';
import type { DeviceInfo, EventInfo, HistoryVersion, StatusDoc } from '../src/types.js';

const NOW = Date.UTC(2026, 7, 20, 12, 0, 0);
const MIN = 60_000;

function device(partial: Partial<DeviceInfo> & { id: string; name: string }): DeviceInfo {
  return { type: 'desktop', lastSeen: NOW - MIN, revoked: false, online: true, ...partial };
}

describe('device rows (FR-31: online/offline + last-seen)', () => {
  const devices = [
    device({ id: 'dev-a', name: 'Desktop', lastSeen: NOW - 30_000, online: true }),
    device({ id: 'dev-b', name: 'Phone', type: 'mobile', lastSeen: NOW - 3 * 60 * MIN, online: false }),
    device({ id: 'dev-c', name: 'VPS', type: 'daemon', revoked: true, online: false }),
    device({ id: 'dev-d', name: 'Fresh', lastSeen: 0, online: false }),
  ];

  it('derives status with revoked winning over online', () => {
    const rows = deviceRows(devices, NOW);
    expect(rows.map((r) => r.status)).toEqual(['online', 'offline', 'revoked', 'offline']);
    expect(rows.map((r) => r.lastSeen)).toEqual(['30s ago', '3h ago', '1m ago', 'never']);
  });

  it('only non-revoked devices can be revoked', () => {
    const rows = deviceRows(devices, NOW);
    expect(rows.map((r) => r.canRevoke)).toEqual([true, true, false, true]);
  });

  it('counts online/offline excluding revoked from offline', () => {
    expect(deviceCounts(devices)).toEqual({ total: 4, online: 1, offline: 2 });
    expect(deviceCounts([])).toEqual({ total: 0, online: 0, offline: 0 });
  });

  it('maps device ids to names for id-only feeds', () => {
    const names = deviceNameMap(devices);
    expect(names.get('dev-b')).toBe('Phone');
    expect(names.get('nope')).toBeUndefined();
  });
});

describe('event rows (feed of last 50)', () => {
  const events: EventInfo[] = [
    { seq: 3, ts: NOW - 30_000, deviceId: 'dev-a', kind: 'change', path: '/notes/a.md' },
    { seq: null, ts: NOW - 5 * MIN, deviceId: null, kind: 'claimed', path: 'personal' },
    { seq: null, ts: NOW - 9 * MIN, deviceId: 'dev-x', kind: 'device_paired', path: null },
    { seq: null, ts: NOW - 22 * MIN, deviceId: 'dev-c', kind: 'mystery_kind', path: null },
  ];
  const names = new Map([
    ['dev-a', 'Desktop'],
    ['dev-c', 'VPS'],
  ]);

  it('labels known kinds and humanizes unknown ones', () => {
    expect(eventRows(events, names, NOW).map((r) => r.label)).toEqual([
      'Synced',
      'Vault claimed',
      'Device paired',
      'Mystery kind',
    ]);
    expect(eventLabel('device_revoked')).toBe('Device revoked');
  });

  it('resolves device names, degrades to placeholders', () => {
    const rows = eventRows(events, names, NOW);
    expect(rows[0]!.deviceName).toBe('Desktop');
    expect(rows[1]!.deviceName).toBe('—');
    expect(rows[2]!.deviceName).toBe('unknown device');
  });

  it('keeps paths and relative times', () => {
    const rows = eventRows(events, names, NOW);
    expect(rows[0]).toMatchObject({ path: '/notes/a.md', time: '30s ago' });
    expect(rows[2]!.path).toBeNull();
  });
});

describe('health badge (engine ok/error + claimed)', () => {
  it('ok requires both health ok and claimed', () => {
    expect(healthBadge({ health: 'ok', claimed: true } as Pick<StatusDoc, 'health' | 'claimed'>)).toEqual({
      label: 'Engine OK',
      tone: 'ok',
    });
    expect(healthBadge({ health: 'error', claimed: true })).toEqual({ label: 'Engine error', tone: 'error' });
    expect(healthBadge({ health: 'ok', claimed: false })).toEqual({ label: 'Engine error', tone: 'error' });
  });
});

describe('version rows (restore browsing)', () => {
  const versions: HistoryVersion[] = [
    { id: 'v2', hash: 'b'.repeat(64), size: 2048, deviceId: 'dev-a', clock: { counter: 2, deviceId: 'dev-a' }, ts: NOW - MIN, kind: 'edit', current: true },
    { id: 'v1', hash: 'a'.repeat(64), size: 1024, deviceId: 'dev-b', clock: { counter: 1, deviceId: 'dev-b' }, ts: NOW - 60 * MIN, kind: 'edit', current: false },
    { id: 'v0', hash: '', size: 0, deviceId: 'dev-b', clock: { counter: 0, deviceId: 'dev-b' }, ts: NOW - 90 * MIN, kind: 'delete', current: false },
  ];
  const names = new Map([
    ['dev-a', 'Desktop'],
    ['dev-b', 'Phone'],
  ]);

  it('maps every field the table shows', () => {
    const rows = versionRows(versions, names, NOW);
    expect(rows[0]).toMatchObject({
      id: 'v2',
      time: '1m ago',
      deviceName: 'Desktop',
      kind: 'edit',
      size: '2 KB',
      current: true,
      downloadable: true,
    });
    expect(rows[1]).toMatchObject({ deviceName: 'Phone', size: '1 KB', current: false });
  });

  it('delete versions are not downloadable', () => {
    const rows = versionRows(versions, names, NOW);
    expect(rows[2]!.downloadable).toBe(false);
  });
});

describe('pairDeepLink (obsidian:// handler, §3)', () => {
  it('encodes url and code', () => {
    expect(pairDeepLink('https://my.vault.workers.dev', '7F3K-Q9M2')).toBe(
      'obsidian://vaultsyncforagents/pair?url=https%3A%2F%2Fmy.vault.workers.dev&code=7F3K-Q9M2',
    );
  });

  it('encodes characters that would break the query string', () => {
    expect(pairDeepLink('https://x.dev/?a=1&b=2', 'AAAA-BBBB')).toContain(
      'url=https%3A%2F%2Fx.dev%2F%3Fa%3D1%26b%3D2',
    );
  });
});
