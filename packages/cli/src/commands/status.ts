/**
 * `vsa status` — per-vault overview (FR-52): reachability/claim state, device
 * presence, last synced edit, attachment/storage counts, and a REAL sync
 * snapshot (a `SyncClient` is started, reconciles, reports, disconnects — so
 * "pending/conflicts" reflect an actual cycle, not a cached guess).
 *
 * Scripting contract: exit code 0 always (a down worker shows as
 * `connected: false`, it does not fail the command); `--json` for machines.
 */

import type { VaultEntry } from '@vsa/node-runtime';
import type { StatusDoc } from '../http.js';
import { WorkerApi } from '../http.js';
import { formatBytes, relativeTime } from '../format.js';
import { oneShotSync } from '../sync.js';
import type { VsRuntime } from '../runtime.js';

export interface VaultStatusReport {
  id: string;
  name: string;
  url: string;
  reachable: boolean;
  claimed: boolean;
  connected: boolean;
  /** Human-readable reason whenever `connected` is false. */
  reason?: string;
  devices?: { total: number; online: number; offline: number; revoked: number };
  lastEdit?: { ts: number; deviceName: string; path: string } | null;
  attachments?: { count: number; bytes: number };
  storageBytes?: number;
  sync?: {
    state: string;
    pending: number;
    conflicts: number;
    trackedFiles: number;
    /** Present while the mass-delete quarantine holds (see core's guard). */
    massDeleteGuard?: { deletions: number; liveEntries: number };
  };
  error?: string;
}

export interface StatusReport {
  vaults: VaultStatusReport[];
  summary: { connected: number; total: number };
}

export async function runStatus(
  runtime: VsRuntime,
  vaults: readonly VaultEntry[],
  options?: { allowMassDelete?: boolean },
): Promise<StatusReport> {
  const reports = await Promise.all(
    vaults.map(async (vault): Promise<VaultStatusReport> => report(runtime, vault, options)),
  );
  return {
    vaults: reports,
    summary: {
      connected: reports.filter((r) => r.connected).length,
      total: reports.length,
    },
  };
}

async function report(
  runtime: VsRuntime,
  vault: VaultEntry,
  options?: { allowMassDelete?: boolean },
): Promise<VaultStatusReport> {
  const base: VaultStatusReport = {
    id: vault.id,
    name: vault.name,
    url: vault.url,
    reachable: false,
    claimed: false,
    connected: false,
  };
  const api = new WorkerApi({ baseUrl: vault.url, fetchImpl: runtime.fetchImpl, now: runtime.now });
  const health = await api.health();
  if (!health.reachable) {
    return {
      ...base,
      reason: `unreachable (${health.unreachableReason ?? 'unknown'})`,
      error: health.unreachableReason,
    };
  }
  if (!health.claimed) {
    return { ...base, reachable: true, claimed: false, reason: 'worker is not claimed' };
  }

  const token = runtime.configStore.getToken(vault.id);
  if (token === undefined) {
    return { ...base, reachable: true, claimed: true, reason: 'no device token — re-run `vsa link`' };
  }

  let status: StatusDoc;
  try {
    status = await api.status(token);
  } catch (error) {
    return {
      ...base,
      reachable: true,
      claimed: true,
      reason: error instanceof Error ? error.message : String(error),
      error: error instanceof Error ? error.message : String(error),
    };
  }

  // The live snapshot: reconcile now, report, disconnect.
  let sync: VaultStatusReport['sync'];
  let syncError: string | undefined;
  try {
    const result = await oneShotSync(vault, token, runtime, `cli:${vault.name}`, options);
    sync = {
      state: result.status.state,
      pending: result.status.pending,
      conflicts: result.status.conflicts.length,
      trackedFiles: result.trackedFiles,
      ...(result.status.massDeleteGuard !== undefined
        ? {
            massDeleteGuard: {
              deletions: result.status.massDeleteGuard.deletions,
              liveEntries: result.status.massDeleteGuard.liveEntries,
            },
          }
        : {}),
    };
  } catch (error) {
    syncError = error instanceof Error ? error.message : String(error);
  }

  const online = status.devices.filter((device) => device.online && !device.revoked);
  const deviceName = (deviceId: string): string =>
    status.devices.find((device) => device.id === deviceId)?.name ?? deviceId;

  return {
    ...base,
    reachable: true,
    claimed: true,
    connected: syncError === undefined && sync !== undefined,
    reason: syncError,
    devices: {
      total: status.devices.length,
      online: online.length,
      offline: status.devices.length - online.length,
      revoked: status.devices.filter((device) => device.revoked).length,
    },
    lastEdit:
      status.lastEdit === null
        ? null
        : { ts: status.lastEdit.ts, deviceName: deviceName(status.lastEdit.deviceId), path: status.lastEdit.path },
    attachments: status.attachments,
    storageBytes: status.storageBytes,
    sync,
  };
}

// --- rendering --------------------------------------------------------------------------

export function renderStatus(report: StatusReport, runtime: VsRuntime): void {
  const out = runtime.output;
  for (const vault of report.vaults) {
    out.log(`${vault.name}  ${vault.url}`);
    out.log(`  connected: ${vault.connected ? 'yes' : `no${vault.reason ? ` — ${vault.reason}` : ''}`}`);
    out.log(`  claimed:   ${vault.claimed ? 'yes' : 'no'}`);
    if (vault.devices !== undefined) {
      out.log(
        `  devices:   ${vault.devices.online} online, ${vault.devices.offline} offline` +
          (vault.devices.revoked > 0 ? `, ${vault.devices.revoked} revoked` : ''),
      );
    }
    if (vault.lastEdit !== undefined) {
      if (vault.lastEdit === null) {
        out.log('  last edit: none yet');
      } else {
        out.log(
          `  last edit: ${relativeTime(vault.lastEdit.ts, Date.now())} by ${vault.lastEdit.deviceName} — ${vault.lastEdit.path}`,
        );
      }
    }
    if (vault.attachments !== undefined) {
      out.log(`  attachments: ${vault.attachments.count} (${formatBytes(vault.attachments.bytes)})`);
      out.log(`  storage:     ${formatBytes(vault.storageBytes ?? 0)}`);
    }
    if (vault.sync !== undefined) {
      out.log(
        `  pending: ${vault.sync.pending}, conflicts: ${vault.sync.conflicts}, files tracked: ${vault.sync.trackedFiles}`,
      );
      if (vault.sync.massDeleteGuard !== undefined) {
        out.log(
          `  ⚠ mass-delete quarantine: ${vault.sync.massDeleteGuard.deletions} deletions blocked ` +
            `(of ${vault.sync.massDeleteGuard.liveEntries} tracked) — if intentional, re-run with --allow-mass-delete`,
        );
      }
    }
    out.log('');
  }
  const { connected, total } = report.summary;
  out.log(
    total === 0
      ? 'no vaults linked — run `vsa link <path>`'
      : total === connected
        ? `${total} ${total === 1 ? 'vault' : 'vaults'} connected`
        : `${connected}/${total} vaults connected`,
  );
}
