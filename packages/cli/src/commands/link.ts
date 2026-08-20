/**
 * `vsa link [path]` — pair this machine's vault with a worker (FR-51) and run
 * an initial sync pass.
 *
 * Flow: resolve vault dir → GET /health (unclaimed → friendly claim
 * instructions) → FR-44 one-client guard against the vault's existing
 * `.vaultsyncforagents/` state dir → POST /pair → persist config + secret +
 * device marker → one-shot sync. Every input can arrive as a flag (agents,
 * CI) or an interactive prompt (humans).
 */

import { existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { hostname, userInfo } from 'node:os';
import {
  NodeStorageAdapter,
  readDeviceMarker,
  writeDeviceMarker,
  type VaultEntry,
} from '@vsa/node-runtime';
import { CommandError, type VsRuntime } from '../runtime.js';
import { WorkerApi } from '../http.js';
import { oneShotSync } from '../sync.js';

export interface LinkParams {
  /** Vault directory (default: cwd). */
  path?: string;
  /** Worker URL (`--url`), prompted when missing. */
  url?: string;
  /** Pairing code (`--code`), prompted when missing. */
  code?: string;
  /** Device name (`--name`); default `<user>@<hostname>`. */
  name?: string;
  /** Override the FR-44 refusal when the vault already has a foreign state dir. */
  force: boolean;
  /** Skip the initial sync pass (tests / diagnostics). */
  noSync?: boolean;
}

export interface LinkResult {
  vault: VaultEntry;
  filesSynced: number;
  conflicts: number;
}

export async function runLink(runtime: VsRuntime, params: LinkParams): Promise<LinkResult> {
  const vaultPath = resolve(params.path ?? process.cwd());
  if (!existsSync(vaultPath) || !statSync(vaultPath).isDirectory()) {
    throw new CommandError(`vault path is not a directory: ${vaultPath}`);
  }

  const store = runtime.configStore;
  const existing = store.findVault(vaultPath);
  const storage = new NodeStorageAdapter({ root: vaultPath });
  const marker = await readDeviceMarker(storage);

  // FR-44: one sync client per machine per vault.
  if (marker !== null && !params.force) {
    const sameDevice = existing !== undefined && existing.deviceId === marker.deviceId;
    if (sameDevice) {
      throw new CommandError(
        `${vaultPath} is already linked on this machine (device ${marker.deviceName}).\n` +
          '  To re-pair with a fresh code, run `vsa link --force`.',
      );
    }
    throw new CommandError(
      `${vaultPath} already contains sync state for device ${JSON.stringify(marker.deviceName)} ` +
        `(${marker.deviceId}), linked to ${marker.url}.\n` +
        '  VaultSync for Agents allows ONE client per machine per vault: two clients watching the\n' +
        '  same directory double-commit every change and race each other.\n' +
        '  If the old state is stale (that device is gone), re-run `vsa link --force`.',
    );
  }

  const url = params.url ?? (await promptRequired(runtime, 'Worker URL (e.g. https://personal.x.workers.dev)'));
  const code =
    params.code ?? (await promptRequired(runtime, 'Pairing code (from the worker dashboard)'));
  const deviceName = params.name ?? defaultDeviceName();
  if (deviceName.trim() === '') {
    throw new CommandError('device name must not be empty (pass --name)');
  }

  const api = new WorkerApi({ baseUrl: url, fetchImpl: runtime.fetchImpl, now: runtime.now });
  const health = await api.health();
  if (!health.reachable) {
    throw new CommandError(
      `could not reach the worker at ${api.origin} (${health.unreachableReason ?? 'unknown error'}).\n` +
        '  Check the URL, your network, and that the worker is deployed.',
    );
  }
  if (!health.claimed) {
    runtime.output.log(`The worker at ${api.origin} is deployed but not claimed yet.`);
    runtime.output.log('');
    runtime.output.log('1. Open the URL in a browser.');
    runtime.output.log('2. Set the admin passphrase and name the vault (the claim page).');
    runtime.output.log('3. On the dashboard, create a pairing code (Devices → Pair new device).');
    runtime.output.log('4. Re-run:  vsa link ${vaultPath} --url ${api.origin} --code <CODE>');
    throw new CommandError('worker is unclaimed — finish claiming in the browser first');
  }

  let pairResult: { token: string; deviceId: string };
  try {
    pairResult = await api.pair(code, deviceName, 'cli');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/HTTP 40[13]/.test(message)) {
      throw new CommandError(
        'pairing code rejected — codes are one-time, expire after 10 minutes, and come from the worker dashboard. ' +
          'Generate a fresh one and retry.',
      );
    }
    throw error;
  }

  const vaultName = await fetchVaultName(api, pairResult.token, vaultPath);
  const entry: VaultEntry = { id: vaultPath, name: vaultName, url: api.origin, deviceId: pairResult.deviceId };
  store.upsertVault(entry);
  store.setToken(vaultPath, pairResult.token);
  await writeDeviceMarker(storage, {
    deviceId: pairResult.deviceId,
    deviceName,
    url: api.origin,
    linkedAt: runtime.now(),
  });

  let filesSynced = 0;
  let conflicts = 0;
  if (params.noSync !== true) {
    const result = await oneShotSync(entry, pairResult.token, runtime, deviceName);
    filesSynced = result.trackedFiles;
    conflicts = result.status.conflicts.length;
  }
  return { vault: entry, filesSynced, conflicts };
}

export function defaultDeviceName(): string {
  let user = 'user';
  try {
    user = userInfo().username;
  } catch {
    // userInfo can throw in odd environments; keep the fallback
  }
  return `${user}@${hostname()}`.toLowerCase();
}

async function fetchVaultName(api: WorkerApi, token: string, vaultPath: string): Promise<string> {
  try {
    const status = await api.status(token);
    if (typeof status.vaultName === 'string' && status.vaultName !== '') return status.vaultName;
  } catch {
    // Non-fatal: fall back to the directory name.
  }
  return vaultPath.split(/[\\/]/).filter(Boolean).pop() ?? vaultPath;
}

async function promptRequired(runtime: VsRuntime, message: string): Promise<string> {
  if (runtime.prompts === null) {
    throw new CommandError(
      `${message}: required in non-interactive mode — pass it as a flag (--url / --code).`,
    );
  }
  const answer = await runtime.prompts.text(message);
  if (answer === '') throw new CommandError(`${message}: value required`);
  return answer;
}
