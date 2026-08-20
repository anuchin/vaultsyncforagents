/**
 * Per-device client state inside the vault (FR-44).
 *
 * Core keeps its sync index at `/.vaultsyncforagents/state` (ignored by
 * sync). This module adds a tiny sibling marker, `device.json`, identifying
 * WHICH device owns that state dir — that is what makes the one-client rule
 * checkable: `vsa link` (and `vsa doctor`) can see that the state dir in
 * this vault belongs to a different device and refuse (or hint) instead of
 * letting two clients double-commit the same tree.
 */

import type { StorageAdapter } from '@vsa/core';
import { TextEncoder } from 'node:util';

/** Directory (inside the vault) holding client-local sync state. */
export const STATE_DIR_PATH = '/.vaultsyncforagents';

/** Device marker inside {@link STATE_DIR_PATH}; owned by node-runtime clients. */
export const DEVICE_MARKER_PATH = `${STATE_DIR_PATH}/device.json`;

export interface DeviceMarker {
  deviceId: string;
  deviceName: string;
  url: string;
  /** Epoch ms of the link that wrote this marker. */
  linkedAt: number;
}

export async function readDeviceMarker(
  storage: StorageAdapter,
): Promise<DeviceMarker | null> {
  let bytes: Uint8Array;
  try {
    bytes = await storage.readFile(DEVICE_MARKER_PATH);
  } catch {
    return null;
  }
  try {
    return parseDeviceMarker(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    // Present but unreadable: treat as a foreign/legacy state dir — the
    // caller's conservative "state dir exists" logic still applies.
    return null;
  }
}

export async function writeDeviceMarker(
  storage: StorageAdapter,
  marker: DeviceMarker,
): Promise<void> {
  await storage.writeFile(
    DEVICE_MARKER_PATH,
    new TextEncoder().encode(JSON.stringify(marker, null, 2) + '\n'),
  );
}

function parseDeviceMarker(value: unknown): DeviceMarker {
  if (typeof value !== 'object' || value === null) throw new Error('not an object');
  const { deviceId, deviceName, url, linkedAt } = value as Record<string, unknown>;
  if (typeof deviceId !== 'string' || typeof deviceName !== 'string' || typeof url !== 'string') {
    throw new Error('marker needs string deviceId, deviceName, url');
  }
  return {
    deviceId,
    deviceName,
    url,
    linkedAt: typeof linkedAt === 'number' ? linkedAt : 0,
  };
}
