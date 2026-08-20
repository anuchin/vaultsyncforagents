/**
 * `vsa history <file>` / `vsa restore <file> [--version <id>]` (FR-54).
 *
 * History reads the worker's /api/history version chain. Restore is
 * CLIENT-side by design: fetch the old blob via /blob/:hash, write it into
 * the vault, then run a one-shot sync cycle — the normal commit path pushes
 * the restored content to every device. (The new version arrives as an
 * `edit` commit; the protocol's `restore` kind is reserved for a later core
 * feature — see the phase report.)
 */

import { normalizeVaultPath } from '@vsa/core';
import { HttpBlobStore, NodeStorageAdapter, type VaultEntry } from '@vsa/node-runtime';
import { CommandError, requireSingleVault, type VsRuntime } from '../runtime.js';
import type { HistoryDoc, HistoryVersion } from '../http.js';
import { WorkerApi } from '../http.js';
import { formatBytes, formatDate } from '../format.js';
import { oneShotSync } from '../sync.js';
import { readDeviceMarker } from '@vsa/node-runtime';

export async function runHistory(
  runtime: VsRuntime,
  file: string,
  vaultRef: string | undefined,
): Promise<HistoryDoc> {
  const vault = requireSingleVault(runtime, vaultRef);
  const token = requiredToken(runtime, vault);
  const path = normalizeVaultPath(file);
  const api = new WorkerApi({ baseUrl: vault.url, fetchImpl: runtime.fetchImpl, now: runtime.now });
  return api.history(token, path);
}

export function renderHistory(doc: HistoryDoc, runtime: VsRuntime): void {
  const out = runtime.output;
  out.log(`${doc.path} — ${doc.versions.length} version(s)${doc.head?.deleted ? '  [deleted]' : ''}`);
  if (doc.versions.length === 0) return;
  for (const version of doc.versions) {
    out.log(
      `  ${formatDate(version.ts)}  ${version.kind.padEnd(12)} ` +
        `${String(formatBytes(version.size)).padStart(9)}  ${version.hash.slice(0, 8)}  ${version.id}` +
        (version.current ? '  (current)' : ''),
    );
  }
}

export interface RestoreResult {
  vault: VaultEntry;
  path: string;
  version: HistoryVersion;
  bytesWritten: number;
}

export async function runRestore(
  runtime: VsRuntime,
  file: string,
  versionId: string | undefined,
  vaultRef: string | undefined,
): Promise<RestoreResult> {
  const vault = requireSingleVault(runtime, vaultRef);
  const token = requiredToken(runtime, vault);
  const path = normalizeVaultPath(file);
  const api = new WorkerApi({ baseUrl: vault.url, fetchImpl: runtime.fetchImpl, now: runtime.now });
  const doc = await api.history(token, path);

  const target = pickRestoreVersion(doc, versionId);
  const blobs = new HttpBlobStore({ baseUrl: vault.url, token, fetchImpl: runtime.fetchImpl });
  const bytes = await blobs.get(target.hash);
  if (bytes === undefined) {
    throw new CommandError(
      `the blob for version ${target.id} is no longer on the worker (garbage-collected) — older history may still be recoverable from another device`,
    );
  }

  const storage = new NodeStorageAdapter({ root: vault.id });
  await storage.writeFile(path, bytes);

  // Push through the normal commit path: reconcile, commit, disconnect.
  const deviceName = await deviceNameOf(storage, vault);
  await oneShotSync(vault, token, runtime, deviceName);

  return { vault, path, version: target, bytesWritten: bytes.byteLength };
}

/**
 * Which version to restore: the explicit `--version`, else "undo one edit" —
 * the most recent version whose content differs from the current head
 * (deletes never restore as deletes).
 */
export function pickRestoreVersion(doc: HistoryDoc, versionId?: string): HistoryVersion {
  if (doc.versions.length === 0) {
    throw new CommandError(`${doc.path} has no recorded versions`);
  }
  if (versionId !== undefined) {
    const exact = doc.versions.find((version) => version.id === versionId);
    if (exact === undefined) {
      throw new CommandError(
        `version ${versionId} not found for ${doc.path} — run \`vsa history\` to list ids`,
      );
    }
    return exact;
  }
  const head = doc.versions.find((version) => version.current);
  const candidates = doc.versions.filter(
    (version) => !version.current && version.kind !== 'delete' && version.hash !== head?.hash,
  );
  const target = candidates[0];
  if (target === undefined) {
    throw new CommandError(
      `${doc.path} has no older distinct version to restore (pass --version <id> to force)`,
    );
  }
  return target;
}

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
