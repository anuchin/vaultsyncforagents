/**
 * Sync glue: build a `SyncClient` (from `@vsa/core`) over the node-runtime
 * adapters for one configured vault, and run watcher-less one-shot cycles
 * (`vsa link`'s initial sync, `vsa status` snapshots, `vsa restore` pushes).
 */

import { SyncClient, type SyncClientStatus } from '@vsa/core';
import type { Transport } from '@vsa/core';
import {
  HttpBlobStore,
  NodeStorageAdapter,
  WebSocketTransport,
  type VaultEntry,
} from '@vsa/node-runtime';
import type { VsRuntime } from './runtime.js';

export interface VaultClient {
  client: SyncClient;
  storage: NodeStorageAdapter;
}

/** A connected-elsewhere-safe client factory: nothing dials until connect(). */
export function createVaultClient(
  vault: VaultEntry,
  token: string,
  runtime: VsRuntime,
  deviceName: string,
  options?: { allowMassDelete?: boolean },
): VaultClient {
  const storage = new NodeStorageAdapter({ root: vault.id });
  const blobStore = new HttpBlobStore({
    baseUrl: vault.url,
    token,
    fetchImpl: runtime.fetchImpl,
  });
  const dial = (): Transport =>
    runtime.transportFactory !== undefined
      ? runtime.transportFactory(vault, token)
      : new WebSocketTransport({ url: vault.url });
  const client = new SyncClient({
    deviceId: vault.deviceId,
    deviceName,
    token,
    transport: dial,
    blobStore,
    storage,
    now: runtime.now,
    // An armed one-shot is the CLI's confirmation gesture: THIS invocation's
    // cycle proceeds (the daemon's own guard still re-engages on its cycles).
    ...(options?.allowMassDelete === true ? { massDeleteGuard: { disabled: true } } : {}),
  });
  return { client, storage };
}

export interface OneShotResult {
  status: SyncClientStatus;
  /** Number of paths the local index tracks after the cycle. */
  trackedFiles: number;
}

/**
 * Connect (startup reconciliation IS the cycle), snapshot, disconnect.
 * Never leaves a socket open — CLI invocations are one-shot by contract.
 * `allowMassDelete` arms the deletion quarantine for THIS cycle (the user
 * typed the flag; the daemon's own cycles stay guarded).
 */
export async function oneShotSync(
  vault: VaultEntry,
  token: string,
  runtime: VsRuntime,
  deviceName: string,
  options?: { allowMassDelete?: boolean },
): Promise<OneShotResult> {
  const { client } = createVaultClient(vault, token, runtime, deviceName, options);
  try {
    await client.connect();
    const status = client.status();
    return { status, trackedFiles: Object.keys(client.currentIndex()).length };
  } finally {
    client.close();
  }
}
