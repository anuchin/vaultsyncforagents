/**
 * `vsa doctor` (FR-56) — per-vault diagnostics:
 *
 *   reachability    GET /health
 *   claim state     /health body
 *   server version  /health-reported version vs the shared compat policy
 *   token valid     a real WS hello roundtrip (SyncClient connect + disconnect)
 *   clock skew      local clock vs the worker's Date response header (warn >60s)
 *   storage         R2 bytes in use (via /api/status)
 *   hints           one-client rule (foreign state dir), claim, re-pair
 *
 * Exit code is non-zero iff any check FAILS (unreachable / unclaimed / server
 * below the supported floor / token invalid or revoked / foreign state dir).
 * Skew, and a newer-or-legacy server, are warnings, not failures.
 */

import type { VaultEntry } from '@vsa/node-runtime';
import {
  NodeStorageAdapter,
  readDeviceMarker,
  STATE_DIR_PATH,
} from '@vsa/node-runtime';
import { checkServerCompatibility, LOCAL_INDEX_STATE_PATH, RevokedError, UnauthorizedError } from '@vsa/core';
import { formatBytes, skewVerdict } from '../format.js';
import { WorkerApi } from '../http.js';
import { oneShotSync } from '../sync.js';
import type { VsRuntime } from '../runtime.js';
import { CLI_VERSION } from '../version.js';

export interface DoctorCheck {
  name: string;
  status: 'ok' | 'warn' | 'fail' | 'skip';
  detail: string;
}

export interface DoctorReport {
  id: string;
  name: string;
  url: string;
  checks: DoctorCheck[];
  hints: string[];
  healthy: boolean;
}

export async function runDoctor(
  runtime: VsRuntime,
  vaults: readonly VaultEntry[],
): Promise<DoctorReport[]> {
  return Promise.all(vaults.map(async (vault) => examine(runtime, vault)));
}

async function examine(runtime: VsRuntime, vault: VaultEntry): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const hints: string[] = [];
  const storage = new NodeStorageAdapter({ root: vault.id });
  const token = runtime.configStore.getToken(vault.id);
  const api = new WorkerApi({ baseUrl: vault.url, fetchImpl: runtime.fetchImpl, now: runtime.now });

  // 1. Reachability.
  const health = await api.health();
  checks.push({
    name: 'reachable',
    status: health.reachable ? 'ok' : 'fail',
    detail: health.reachable ? api.origin : health.unreachableReason ?? 'unreachable',
  });

  // 2. Claim state.
  if (health.reachable) {
    checks.push({
      name: 'claimed',
      status: health.claimed ? 'ok' : 'fail',
      detail: health.claimed ? 'yes' : 'worker is unclaimed',
    });
    if (!health.claimed) {
      hints.push(`open ${api.origin} in a browser and set the admin passphrase to claim this worker`);
    }
  }

  // 3. Server version vs this CLI (core's shared compat policy). Skew is a
  // warning; only a server below the supported floor fails. The check object
  // is held so the /api/status fetch below can confirm the two surfaces agree.
  const versionCheck: DoctorCheck = {
    name: 'server version',
    status: 'skip',
    detail: 'worker unreachable',
  };
  checks.push(versionCheck);
  if (health.reachable) {
    const verdict = checkServerCompatibility(CLI_VERSION, health.serverVersion);
    versionCheck.status = verdict.level === 'error' ? 'fail' : verdict.level;
    versionCheck.detail = verdict.message;
  }

  // 4. Clock skew (warn-only).
  if (health.reachable) {
    const { skewMs, warn } = skewVerdict(runtime.now(), health.serverDateMs);
    checks.push({
      name: 'clock skew',
      status: skewMs === null ? 'skip' : warn ? 'warn' : 'ok',
      detail:
        skewMs === null
          ? 'worker sent no Date header'
          : `${skewMs >= 0 ? '+' : ''}${Math.round(skewMs / 1000)}s vs worker${warn ? ' — more than 60s off; fix the local clock (conflict timestamps depend on it)' : ''}`,
    });
  }

  // 5. Token validity — a real hello roundtrip.
  let tokenOk = false;
  if (health.reachable && health.claimed) {
    if (token === undefined) {
      checks.push({
        name: 'token',
        status: 'fail',
        detail: 'no device token for this vault',
      });
      hints.push('re-run `vsa link` to pair this machine');
    } else {
      try {
        await oneShotSync(vault, token, runtime, `cli:${vault.name}`);
        tokenOk = true;
        checks.push({ name: 'token', status: 'ok', detail: 'hello roundtrip succeeded' });
      } catch (error) {
        if (error instanceof RevokedError) {
          checks.push({ name: 'token', status: 'fail', detail: 'device was revoked' });
          hints.push('this device was revoked — generate a new pairing code and re-pair with `vsa link --force`');
        } else if (error instanceof UnauthorizedError) {
          checks.push({ name: 'token', status: 'fail', detail: 'token rejected (invalid)' });
          hints.push('the stored token no longer matches the worker — re-run `vsa link --force`');
        } else {
          checks.push({
            name: 'token',
            status: 'warn',
            detail: `sync probe failed: ${error instanceof Error ? error.message : String(error)}`,
          });
        }
      }
    }
  }

  // 6. Storage usage (informational); also confirms /api/status and /health
  // report the SAME server version (they should never disagree).
  if (tokenOk && token !== undefined) {
    try {
      const status = await api.status(token);
      if (
        status.serverVersion != null &&
        health.serverVersion != null &&
        status.serverVersion !== health.serverVersion
      ) {
        // Never downgrade a compat failure to a warning.
        if (versionCheck.status !== 'fail') versionCheck.status = 'warn';
        versionCheck.detail += ` (but /api/status reports ${status.serverVersion})`;
      }
      const quota = status.quota;
      const quotaDetail =
        quota === undefined
          ? ''
          : quota.state === 'off'
            ? ' (quota alerts off)'
            : quota.state === 'over'
              ? ` — OVER the ${formatBytes(quota.hardBytes)} hard threshold: trim history (retention) or raise the quota in the dashboard`
              : quota.state === 'warn'
                ? ` — approaching the ${formatBytes(quota.hardBytes)} threshold (${formatBytes(quota.warnBytes)} warn mark)`
                : '';
      checks.push({
        name: 'storage',
        status: quota?.state === 'over' ? 'fail' : quota?.state === 'warn' ? 'warn' : 'ok',
        detail: `${formatBytes(status.storageBytes)} of blobs (${status.attachments.count} attachments, ${formatBytes(status.attachments.bytes)})${quotaDetail}`,
      });
    } catch {
      checks.push({ name: 'storage', status: 'skip', detail: 'status unavailable' });
    }
  }

  // 7. One-client-per-machine rule (FR-44).
  const marker = await readDeviceMarker(storage);
  if (marker !== null && marker.deviceId !== vault.deviceId) {
    checks.push({
      name: 'state dir owner',
      status: 'fail',
      detail: `.vaultsyncforagents belongs to device ${marker.deviceName} (${marker.deviceId})`,
    });
    hints.push(
      'another client owns this vault\'s sync state — one client per machine per vault; ' +
        'remove the other client or point this entry at a fresh directory',
    );
  } else {
    const statePresent = await storage.exists(LOCAL_INDEX_STATE_PATH).catch(() => false);
    const dirPresent = await storage.exists(STATE_DIR_PATH).catch(() => false);
    checks.push({
      name: 'state dir owner',
      status: marker !== null || !dirPresent ? 'ok' : 'warn',
      detail:
        marker !== null
          ? `this device (${marker.deviceName})`
          : statePresent || dirPresent
            ? 'state dir present without a device marker (older client?)'
            : 'no state dir yet (first sync will create it)',
    });
  }

  return {
    id: vault.id,
    name: vault.name,
    url: vault.url,
    checks,
    hints,
    healthy: checks.every((check) => check.status !== 'fail'),
  };
}

export function renderDoctor(reports: readonly DoctorReport[], runtime: VsRuntime): void {
  const out = runtime.output;
  for (const report of reports) {
    out.log(`${report.name}  ${report.url}`);
    for (const check of report.checks) {
      const mark =
        check.status === 'ok' ? '✔' : check.status === 'warn' ? '!' : check.status === 'fail' ? '×' : '-';
      out.log(`  ${mark} ${check.name.padEnd(14)} ${check.detail}`);
    }
    for (const hint of report.hints) out.warn(`  hint: ${hint}`);
    out.log('');
  }
  const failed = reports.filter((report) => !report.healthy);
  if (failed.length > 0) {
    out.error(`${failed.length} vault(s) failed checks: ${failed.map((f) => f.name).join(', ')}`);
  } else {
    out.log(`all ${reports.length} vault(s) healthy`);
  }
}
