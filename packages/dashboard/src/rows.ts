/**
 * Pure view-model builders: server documents in, renderable row models out.
 * The DOM layer stays a dumb mapper, so table/list semantics live here where
 * they are trivially testable.
 */

import { absoluteTime, formatBytes, relativeTime } from './format.js';
import type { DeviceInfo, EventInfo, HistoryVersion, StatusDoc } from './types.js';

// --- devices -----------------------------------------------------------------------------

export type DeviceStatus = 'online' | 'offline' | 'revoked';

export interface DeviceRowModel {
  id: string;
  name: string;
  type: string;
  status: DeviceStatus;
  /** 'never' for devices that paired but never said hello. */
  lastSeen: string;
  /** Revoked devices cannot be revoked again. */
  canRevoke: boolean;
}

export function deviceStatus(device: DeviceInfo): DeviceStatus {
  if (device.revoked) return 'revoked';
  return device.online ? 'online' : 'offline';
}

export function deviceRows(devices: DeviceInfo[], now: number): DeviceRowModel[] {
  return devices.map((device) => ({
    id: device.id,
    name: device.name,
    type: device.type,
    status: deviceStatus(device),
    lastSeen: device.lastSeen === 0 ? 'never' : relativeTime(device.lastSeen, now),
    canRevoke: !device.revoked,
  }));
}

export function deviceCounts(devices: DeviceInfo[]): { total: number; online: number; offline: number } {
  let online = 0;
  let revoked = 0;
  for (const device of devices) {
    if (device.revoked) revoked++;
    else if (device.online) online++;
  }
  return { total: devices.length, online, offline: devices.length - online - revoked };
}

// --- events ------------------------------------------------------------------------------

export interface EventRowModel {
  kind: string;
  label: string;
  path: string | null;
  deviceName: string;
  time: string;
}

const EVENT_LABELS: Record<string, string> = {
  claimed: 'Vault claimed',
  device_paired: 'Device paired',
  device_revoked: 'Device revoked',
  passphrase_changed: 'Passphrase changed',
  change: 'Synced',
};

export function eventLabel(kind: string): string {
  return EVENT_LABELS[kind] ?? kind.charAt(0).toUpperCase() + kind.slice(1).replace(/_/g, ' ');
}

/** deviceId -> device name (for feeds that only carry ids). */
export function deviceNameMap(devices: DeviceInfo[]): Map<string, string> {
  return new Map(devices.map((device) => [device.id, device.name]));
}

export function eventRows(
  events: EventInfo[],
  names: Map<string, string>,
  now: number,
): EventRowModel[] {
  return events.map((event) => ({
    kind: event.kind,
    label: eventLabel(event.kind),
    path: event.path,
    deviceName:
      event.deviceId === null ? '—' : (names.get(event.deviceId) ?? 'unknown device'),
    time: relativeTime(event.ts, now),
  }));
}

// --- status summary ----------------------------------------------------------------------

export interface HealthBadgeModel {
  label: string;
  tone: 'ok' | 'error';
}

export function healthBadge(status: Pick<StatusDoc, 'health' | 'claimed'>): HealthBadgeModel {
  if (status.health === 'ok' && status.claimed) return { label: 'Engine OK', tone: 'ok' };
  return { label: 'Engine error', tone: 'error' };
}

// --- history / restore -------------------------------------------------------------------

export interface VersionRowModel {
  id: string;
  time: string;
  absolute: string;
  deviceName: string;
  kind: string;
  size: string;
  hash: string;
  current: boolean;
  /** Delete/folder versions have no content to download. */
  downloadable: boolean;
}

export function versionRows(
  versions: HistoryVersion[],
  names: Map<string, string>,
  now: number,
): VersionRowModel[] {
  return versions.map((version) => ({
    id: version.id,
    time: relativeTime(version.ts, now),
    absolute: absoluteTime(version.ts),
    deviceName: names.get(version.deviceId) ?? 'unknown device',
    kind: version.kind,
    size: formatBytes(version.size),
    hash: version.hash,
    current: version.current,
    downloadable: version.hash !== '' && version.kind !== 'delete',
  }));
}

// --- pairing -----------------------------------------------------------------------------

/** `obsidian://vaultsyncforagents/pair?url=<worker>&code=<code>` deep link (§3). */
export function pairDeepLink(workerOrigin: string, code: string): string {
  return `obsidian://vaultsyncforagents/pair?url=${encodeURIComponent(workerOrigin)}&code=${encodeURIComponent(code)}`;
}
