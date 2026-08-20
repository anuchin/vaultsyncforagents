/**
 * `vsa logs` (FR-57) — the last ~50 events per vault, straight from the
 * worker's event log via /api/status. `--vault` scopes to one vault.
 */

import type { VaultEntry } from '@vsa/node-runtime';
import type { StatusEvent } from '../http.js';
import { WorkerApi } from '../http.js';
import { formatDate } from '../format.js';
import { CommandError, type VsRuntime } from '../runtime.js';

export interface LogsReport {
  vault: { id: string; name: string; url: string };
  events: StatusEvent[];
  deviceNames: Record<string, string>;
  error?: string;
}

export async function runLogs(
  runtime: VsRuntime,
  vaults: readonly VaultEntry[],
): Promise<LogsReport[]> {
  return Promise.all(
    vaults.map(async (vault): Promise<LogsReport> => {
      const api = new WorkerApi({
        baseUrl: vault.url,
        fetchImpl: runtime.fetchImpl,
        now: runtime.now,
      });
      const token = runtime.configStore.getToken(vault.id);
      if (token === undefined) {
        return fail(vault, 'no device token — re-run `vsa link`');
      }
      try {
        const status = await api.status(token);
        const deviceNames: Record<string, string> = {};
        for (const device of status.devices) deviceNames[device.id] = device.name;
        return {
          vault: { id: vault.id, name: vault.name, url: vault.url },
          events: status.recentEvents,
          deviceNames,
        };
      } catch (error) {
        return fail(vault, error instanceof Error ? error.message : String(error));
      }
    }),
  );
}

function fail(vault: VaultEntry, error: string): LogsReport {
  return {
    vault: { id: vault.id, name: vault.name, url: vault.url },
    events: [],
    deviceNames: {},
    error,
  };
}

export function renderLogs(reports: readonly LogsReport[], runtime: VsRuntime): void {
  const out = runtime.output;
  const multiple = reports.length > 1;
  for (const report of reports) {
    if (multiple) out.log(`— ${report.vault.name} (${report.vault.url})`);
    if (report.error !== undefined) {
      out.warn(report.error);
      continue;
    }
    if (report.events.length === 0) {
      out.log('no events yet');
      continue;
    }
    for (const event of report.events) {
      const device =
        event.deviceId === null
          ? '—'
          : (report.deviceNames[event.deviceId] ?? event.deviceId);
      const seq = event.seq === null ? '' : ` seq=${event.seq}`;
      out.log(`${formatDate(event.ts)}  ${event.kind.padEnd(14)} ${device.padEnd(16)} ${event.path ?? ''}${seq}`);
    }
  }
}

export { CommandError };
