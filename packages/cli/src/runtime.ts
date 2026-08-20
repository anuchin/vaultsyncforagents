/**
 * The CLI's injectable runtime seam.
 *
 * Command LOGIC lives in `commands/*.ts` as plain functions over a
 * `VsRuntime` — config store, fetch, transport factory, clock, output, and
 * prompts are all injected. `cli.ts` is a thin commander layer that builds a
 * Node runtime from `process` and dispatches; tests build fakes instead of a
 * real worker.
 */

import type { VaultEntry } from '@vsa/node-runtime';
import { ConfigStore } from '@vsa/node-runtime';
import type { Transport } from '@vsa/core';
import { resolve } from 'node:path';
import * as p from '@clack/prompts';

/** Console seam (tests capture; production colors via picocolors in cli.ts). */
export interface OutputWriter {
  log(text?: string): void;
  warn(text?: string): void;
  error(text?: string): void;
}

/** Interactive prompt seam; `null` means non-interactive (no TTY). */
export interface PromptUi {
  text(message: string, options?: { placeholder?: string; defaultValue?: string }): Promise<string>;
  password(message: string): Promise<string>;
  confirm(message: string): Promise<boolean>;
}

/** Thrown by command logic for expected, user-facing failures. */
export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandError';
  }
}

export interface VsRuntime {
  configStore: ConfigStore;
  fetchImpl: typeof fetch;
  /**
   * Overrides transport construction entirely (tests: an in-memory
   * `MessageBus` pair against `InMemorySyncServer`).
   */
  transportFactory?: (vault: VaultEntry, token: string) => Transport;
  now(): number;
  output: OutputWriter;
  /** `null` in non-interactive contexts — commands must degrade gracefully. */
  prompts: PromptUi | null;
  /**
   * Overrides the daemon module surface (`vsa daemon …` tests install fakes;
   * production delegates to `@vsa/daemon`). Type-only import: no runtime cycle.
   */
  daemonControl?: import('./commands/daemon.js').DaemonControl;
}

// --- clack-backed prompt UI --------------------------------------------------------------

class CancelledError extends CommandError {
  constructor() {
    super('cancelled');
    this.name = 'CancelledError';
  }
}

function unwrap<T>(value: T | symbol): T {
  if (p.isCancel(value)) throw new CancelledError();
  return value as T;
}

/** Prompts via @clack/prompts; only used when stdin is a TTY. */
export class ClackPromptUi implements PromptUi {
  async text(
    message: string,
    options: { placeholder?: string; defaultValue?: string } = {},
  ): Promise<string> {
    const answer = unwrap(
      await p.text({
        message,
        placeholder: options.placeholder,
        initialValue: options.defaultValue,
      }),
    );
    return answer.trim();
  }

  async password(message: string): Promise<string> {
    return unwrap(await p.password({ message }));
  }

  async confirm(message: string): Promise<boolean> {
    return unwrap(await p.confirm({ message }));
  }
}

export function isInteractive(): boolean {
  return Boolean(process.stdin.isTTY);
}

// --- vault selection ----------------------------------------------------------------------

/** All configured vaults, or the single one selected by `--vault <id|path>`. */
export function selectVaults(
  runtime: VsRuntime,
  vaultRef: string | undefined,
): VaultEntry[] {
  const vaults = runtime.configStore.load().vaults;
  if (vaultRef === undefined) return vaults;
  const found = vaults.find((vault) => sameId(vault.id, vaultRef));
  if (found === undefined) {
    throw new CommandError(
      `no linked vault matches ${JSON.stringify(vaultRef)} — linked vaults:\n` +
        (vaults.length === 0
          ? '  (none — run `vsa link` first)'
          : vaults.map((vault) => `  ${vault.name}  ${vault.id}`).join('\n')),
    );
  }
  return [found];
}

/** Exactly one vault: the `--vault` selection, or the only linked vault. */
export function requireSingleVault(
  runtime: VsRuntime,
  vaultRef: string | undefined,
): VaultEntry {
  const vaults = selectVaults(runtime, vaultRef);
  if (vaults.length === 0) {
    throw new CommandError('no vaults are linked on this machine — run `vsa link <path>` first');
  }
  if (vaults.length > 1) {
    throw new CommandError(
      'multiple vaults are linked — pass --vault <id|path>:\n' +
        vaults.map((vault) => `  ${vault.name}  ${vault.id}`).join('\n'),
    );
  }
  return vaults[0]!;
}

function sameId(a: string, b: string): boolean {
  const left = resolve(a);
  const right = resolve(b);
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}
