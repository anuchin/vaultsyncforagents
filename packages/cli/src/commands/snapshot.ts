/**
 * `vsa snapshot create|list|restore <idOrName>` — vault-level snapshots.
 *
 * Create/restore ride the sync channel (one-shot client connection, the
 * pattern of `vsa restore`); list rides `GET /api/snapshots`. Restore is
 * server-side and history-preserving: every reverted head lands as a NEW
 * version, nothing is deleted, and the restoring client re-converges from a
 * full manifest before the one-shot connection closes.
 */

import type { SnapshotSummary } from '@vsa/core';
import {
  NodeStorageAdapter,
  readDeviceMarker,
  type VaultEntry,
} from '@vsa/node-runtime';
import { CommandError, requireSingleVault, type VsRuntime } from '../runtime.js';
import { WorkerApi } from '../http.js';
import { formatDate } from '../format.js';
import { createVaultClient } from '../sync.js';

// --- create -------------------------------------------------------------------------------

export interface SnapshotCreateResult {
  vault: { id: string; name: string; url: string };
  id: string;
  name: string;
  ts: number;
  seq: number;
  fileCount: number;
}

export async function runSnapshotCreate(
  runtime: VsRuntime,
  name: string | undefined,
  vaultRef: string | undefined,
): Promise<SnapshotCreateResult> {
  const vault = requireSingleVault(runtime, vaultRef);
  const token = requiredToken(runtime, vault);
  const storage = new NodeStorageAdapter({ root: vault.id });
  const { client } = createVaultClient(vault, token, runtime, await deviceNameOf(storage, vault));
  try {
    await client.connect();
    const ack = await client.createSnapshot(name);
    return {
      vault: { id: vault.id, name: vault.name, url: vault.url },
      id: ack.id,
      name: ack.name,
      ts: ack.ts,
      seq: ack.seq,
      fileCount: ack.fileCount,
    };
  } finally {
    client.close();
  }
}

// --- list ---------------------------------------------------------------------------------

export interface SnapshotListReport {
  vault: { id: string; name: string; url: string };
  snapshots: SnapshotSummary[];
  error?: string;
}

export async function runSnapshotList(
  runtime: VsRuntime,
  vaultRef: string | undefined,
): Promise<SnapshotListReport> {
  const vault = requireSingleVault(runtime, vaultRef);
  const token = runtime.configStore.getToken(vault.id);
  if (token === undefined) {
    return {
      vault: { id: vault.id, name: vault.name, url: vault.url },
      snapshots: [],
      error: 'no device token — re-run `vsa link`',
    };
  }
  const api = new WorkerApi({ baseUrl: vault.url, fetchImpl: runtime.fetchImpl, now: runtime.now });
  const snapshots = await api.snapshots(token);
  return { vault: { id: vault.id, name: vault.name, url: vault.url }, snapshots };
}

export function renderSnapshotList(report: SnapshotListReport, runtime: VsRuntime): void {
  const out = runtime.output;
  out.log(`${report.vault.name}  ${report.vault.url}`);
  if (report.error !== undefined) {
    out.warn(`  ${report.error}`);
    return;
  }
  if (report.snapshots.length === 0) {
    out.log('  no snapshots — run `vsa snapshot create [name]`');
    return;
  }
  for (const snapshot of report.snapshots) {
    out.log(
      `  ${snapshot.id.padEnd(5)}  ${formatDate(snapshot.ts)}  ` +
        `${String(snapshot.fileCount).padStart(5)} file(s)  ` +
        `${snapshot.name === '' ? '(unnamed)' : snapshot.name}  ${snapshot.deviceId}`,
    );
  }
}

// --- restore ------------------------------------------------------------------------------

export interface SnapshotRestoreParams {
  /** Skip the interactive confirmation. */
  yes?: boolean;
}

export interface SnapshotRestoreResult {
  vault: { id: string; name: string; url: string };
  id: string;
  name: string;
  ts: number;
  restored: number;
  tombstoned: number;
  seq: number;
}

export async function runSnapshotRestore(
  runtime: VsRuntime,
  idOrName: string,
  params: SnapshotRestoreParams,
  vaultRef: string | undefined,
): Promise<SnapshotRestoreResult> {
  const vault = requireSingleVault(runtime, vaultRef);
  const token = requiredToken(runtime, vault);
  const api = new WorkerApi({ baseUrl: vault.url, fetchImpl: runtime.fetchImpl, now: runtime.now });
  const target = resolveSnapshotTarget(idOrName, await api.snapshots(token));

  if (params.yes !== true) {
    // Whole-vault revert is the most destructive op in the CLI: a runtime
    // without prompts (no TTY — scripts, agents, CI) must opt in explicitly
    // with --yes; interactive runtimes keep the confirm prompt.
    if (runtime.prompts === null) {
      throw new CommandError(
        'non-interactive run: snapshot restore reverts the whole vault — ' +
          're-run with --yes to confirm without a prompt',
      );
    }
    const confirmed = await runtime.prompts.confirm(
      `Restore vault ${vault.name} to snapshot ${target.id} ` +
        `(${target.name === '' ? 'unnamed' : target.name}, ${formatDate(target.ts)}, ` +
        `${target.fileCount} file(s))? Current heads become new versions; history is kept.`,
    );
    if (!confirmed) throw new CommandError('restore cancelled');
  }

  const storage = new NodeStorageAdapter({ root: vault.id });
  const { client } = createVaultClient(vault, token, runtime, await deviceNameOf(storage, vault));
  try {
    await client.connect();
    const ack = await client.restoreSnapshot(target.id);
    return {
      vault: { id: vault.id, name: vault.name, url: vault.url },
      id: ack.id,
      name: target.name,
      ts: target.ts,
      restored: ack.restored,
      tombstoned: ack.tombstoned,
      seq: ack.seq,
    };
  } finally {
    client.close();
  }
}

/**
 * Which snapshot `<idOrName>` means: an exact id, else a name — unique names
 * resolve directly, repeated names resolve to the latest by ts (the
 * confirmation prompt always shows which snapshot was picked).
 */
export function resolveSnapshotTarget(
  idOrName: string,
  snapshots: readonly SnapshotSummary[],
): SnapshotSummary {
  if (snapshots.length === 0) {
    throw new CommandError('this vault has no snapshots yet — run `vsa snapshot create [name]`');
  }
  const byId = snapshots.find((snapshot) => snapshot.id === idOrName);
  if (byId !== undefined) return byId;
  const byName = snapshots.filter((snapshot) => snapshot.name === idOrName);
  if (byName.length === 1) return byName[0]!;
  if (byName.length > 1) {
    return byName.reduce((latest, snapshot) => (snapshot.ts > latest.ts ? snapshot : latest));
  }
  throw new CommandError(
    `no snapshot matches ${JSON.stringify(idOrName)} — snapshots:\n` +
      snapshots
        .map((snapshot) => `  ${snapshot.id}  ${formatDate(snapshot.ts)}  ${snapshot.name === '' ? '(unnamed)' : snapshot.name}`)
        .join('\n'),
  );
}

// --- helpers ------------------------------------------------------------------------------

function requiredToken(runtime: VsRuntime, vault: VaultEntry): string {
  const token = runtime.configStore.getToken(vault.id);
  if (token === undefined) {
    throw new CommandError('no device token for this vault — re-run `vsa link`');
  }
  return token;
}

async function deviceNameOf(storage: NodeStorageAdapter, vault: VaultEntry): Promise<string> {
  const marker = await readDeviceMarker(storage);
  return marker?.deviceName ?? `cli:${vault.name}`;
}
