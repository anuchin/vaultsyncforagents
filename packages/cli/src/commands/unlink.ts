/**
 * `vsa unlink [path]` — remove a vault from this machine's config (FR-51).
 * Local files are NEVER touched: the vault keeps its content and its
 * `.vaultsyncforagents/` state dir (delete that manually only if you are sure
 * no client still needs it).
 */

import { resolve } from 'node:path';
import { CommandError, type VsRuntime } from '../runtime.js';

export interface UnlinkParams {
  path?: string;
}

export interface UnlinkResult {
  removed: boolean;
  vaultPath: string;
  name?: string;
}

export function runUnlink(runtime: VsRuntime, params: UnlinkParams): UnlinkResult {
  const store = runtime.configStore;
  const candidates = store.load().vaults;
  if (candidates.length === 0) {
    throw new CommandError('no vaults are linked on this machine');
  }

  let target;
  if (params.path !== undefined) {
    target = store.findVault(params.path);
    if (target === undefined) {
      throw new CommandError(`no linked vault matches ${resolve(params.path)}`);
    }
  } else if (candidates.length === 1) {
    target = candidates[0]!;
  } else {
    throw new CommandError(
      'multiple vaults are linked — pass the path:\n' +
        candidates.map((vault) => `  ${vault.name}  ${vault.id}`).join('\n'),
    );
  }

  const removed = store.removeVault(target.id);
  return { removed, vaultPath: target.id, name: target.name };
}
