/**
 * `vsa devices` / `vsa devices revoke <nameOrId>` (FR-53).
 *
 * Listing rides on /api/status (device token). Revocation needs the admin
 * session: prompt for the admin passphrase (or `--passphrase` for scripts),
 * POST /admin/login, then POST /admin/revoke with the session cookie.
 */

import type { VaultEntry } from '@vsa/node-runtime';
import type { StatusDevice } from '../http.js';
import { WorkerApi } from '../http.js';
import { presence } from '../format.js';
import { CommandError, type VsRuntime } from '../runtime.js';

export interface DevicesReport {
  vault: { id: string; name: string; url: string };
  devices: StatusDevice[];
  error?: string;
}

export async function runDevices(
  runtime: VsRuntime,
  vaults: readonly VaultEntry[],
): Promise<DevicesReport[]> {
  return Promise.all(
    vaults.map(async (vault): Promise<DevicesReport> => {
      const api = new WorkerApi({
        baseUrl: vault.url,
        fetchImpl: runtime.fetchImpl,
        now: runtime.now,
      });
      const token = runtime.configStore.getToken(vault.id);
      if (token === undefined) {
        return {
          vault: { id: vault.id, name: vault.name, url: vault.url },
          devices: [],
          error: 'no device token — re-run `vsa link`',
        };
      }
      try {
        const status = await api.status(token);
        return {
          vault: { id: vault.id, name: vault.name, url: vault.url },
          devices: status.devices,
        };
      } catch (error) {
        return {
          vault: { id: vault.id, name: vault.name, url: vault.url },
          devices: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );
}

export function renderDevices(reports: readonly DevicesReport[], runtime: VsRuntime): void {
  const out = runtime.output;
  for (const report of reports) {
    out.log(`${report.vault.name}  ${report.vault.url}`);
    if (report.error !== undefined) {
      out.warn(`  ${report.error}`);
      continue;
    }
    if (report.devices.length === 0) {
      out.log('  no devices');
      continue;
    }
    const nameWidth = Math.max(...report.devices.map((device) => device.name.length), 4);
    for (const device of report.devices) {
      out.log(
        `  ${device.name.padEnd(nameWidth)}  ${device.type.padEnd(7)} ` +
          `${presence(device.lastSeen, device.online)}${device.revoked ? '  [revoked]' : ''}`,
      );
    }
  }
}

export interface RevokeParams {
  /** Device name or id, matched case-insensitively. */
  nameOrId: string;
  /** Admin passphrase (scripts); prompted interactively otherwise. */
  passphrase?: string;
  /** Skip the interactive confirmation. */
  yes?: boolean;
}

export async function runRevoke(
  runtime: VsRuntime,
  vault: VaultEntry,
  params: RevokeParams,
): Promise<{ deviceName: string; deviceId: string }> {
  const api = new WorkerApi({
    baseUrl: vault.url,
    fetchImpl: runtime.fetchImpl,
    now: runtime.now,
  });
  const token = runtime.configStore.getToken(vault.id);
  if (token === undefined) {
    throw new CommandError('no device token for this vault — re-run `vsa link`');
  }
  const status = await api.status(token);
  const target = status.devices.find(
    (device) =>
      device.id.toLowerCase() === params.nameOrId.toLowerCase() ||
      device.name.toLowerCase() === params.nameOrId.toLowerCase(),
  );
  if (target === undefined) {
    throw new CommandError(
      `no device named or id'd ${JSON.stringify(params.nameOrId)} on ${vault.name} — devices:\n` +
        status.devices.map((device) => `  ${device.name} (${device.type}, ${device.id})`).join('\n'),
    );
  }

  if (params.yes !== true && runtime.prompts !== null) {
    const confirmed = await runtime.prompts.confirm(
      `Revoke ${target.name} (${target.type}) from vault ${vault.name}? Other devices keep syncing.`,
    );
    if (!confirmed) throw new CommandError('revocation cancelled');
  }

  let passphrase = params.passphrase;
  if (passphrase === undefined) {
    if (runtime.prompts === null) {
      throw new CommandError('admin passphrase required — pass --passphrase (or run interactively)');
    }
    passphrase = await runtime.prompts.password(`Admin passphrase for ${api.origin}`);
  }

  const { cookie } = await api.adminLogin(passphrase);
  await api.adminRevoke(cookie, target.id);
  return { deviceName: target.name, deviceId: target.id };
}
