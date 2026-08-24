/**
 * Wire shapes the dashboard consumes (packages/worker/src/index.ts + room.ts).
 * Kept in one types-only module so the pure logic (state/format/rows) stays
 * DOM-free and unit-testable without jsdom.
 */

/** `GET /health` */
export interface HealthDoc {
  ok: boolean;
  claimed: boolean;
}

/** Device entry inside `GET /api/status`. */
export interface DeviceInfo {
  id: string;
  name: string;
  type: string;
  lastSeen: number;
  revoked: boolean;
  online: boolean;
}

/** Most recent synced edit inside `GET /api/status`. */
export interface LastEdit {
  ts: number;
  deviceId: string;
  path: string;
}

/** Event-feed entry inside `GET /api/status` (last 50, newest first). */
export interface EventInfo {
  seq: number | null;
  ts: number;
  deviceId: string | null;
  kind: string;
  path: string | null;
}

/** `GET /api/status` (admin cookie or device bearer). */
export interface StatusDoc {
  vaultName: string;
  claimed: boolean;
  health: string;
  devices: DeviceInfo[];
  lastEdit: LastEdit | null;
  attachments: { count: number; bytes: number };
  storageBytes: number;
  recentEvents: EventInfo[];
}

/** One version inside `GET /api/history?path=` (newest first). */
export interface HistoryVersion {
  id: string;
  hash: string;
  size: number;
  deviceId: string;
  clock: { counter: number; deviceId: string };
  ts: number;
  kind: string;
  current: boolean;
}

/** `GET /api/history?path=` */
export interface HistoryDoc {
  path: string;
  head: { versionId: string; deleted: boolean } | null;
  versions: HistoryVersion[];
}

/** `POST /claim` */
export interface ClaimResult {
  ok: boolean;
  vaultName: string;
}

/** `POST /admin/pair` */
export interface PairCodeDoc {
  ok: boolean;
  code: string;
  expiresAt: number;
}

/** Device types the pairing UI offers (mirrors @vsa/core DeviceType). */
export const DEVICE_TYPES = ['desktop', 'mobile', 'daemon', 'cli'] as const;
export type DeviceTypeOption = (typeof DEVICE_TYPES)[number];

export function isDeviceTypeOption(value: string): value is DeviceTypeOption {
  return (DEVICE_TYPES as readonly string[]).includes(value);
}
