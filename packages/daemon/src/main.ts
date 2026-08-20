/**
 * Standalone `vsa-daemon` entry (bin/vsa-daemon.js). The CLI's
 * `vsa daemon …` subcommands drive the same library; this entry exists so a
 * VPS can run the daemon without the CLI installed (and so service units
 * have a stable ExecStart target).
 *
 *   vsa-daemon run [--vault <id|path>] [--config <path>]   foreground
 *   vsa-daemon install | uninstall | start | stop          service lifecycle
 *   vsa-daemon status [--config <path>]                    service + vaults
 *   vsa-daemon logs [-n <lines>]                           journalctl/log tail
 *
 * `run` emits structured JSON log lines to stdout (one per event) — the
 * service-friendly format agents can tail. Exit codes: 0 ok, 1 usage/service
 * failure, 2 startup error. Every dependency (platform, config store,
 * manager factory, signal registration, output) is injectable; `daemonMain`
 * returns the exit code instead of calling `process.exit` so tests (and the
 * CLI) can embed it.
 */

import type { LogAdapter } from '@vsa/core';
import { ConfigStore, type VaultEntry } from '@vsa/node-runtime';
import {
  daemonHealthPathFor,
  DaemonManager,
  readDaemonHealthSnapshot,
  type DaemonHealth,
  type DaemonManagerOptions,
} from './daemon.js';
import {
  selectServiceBackend,
  serviceKindFor,
  serviceLogsFor,
  serviceStatusFor,
  type ServiceOptions,
  type ServiceStatus,
} from './services/index.js';

export type DaemonAction = 'run' | 'install' | 'uninstall' | 'start' | 'stop' | 'status' | 'logs';

export interface ParsedDaemonArgs {
  action: DaemonAction;
  vault?: string;
  config?: string;
  tail: number;
}

export function parseDaemonArgs(argv: readonly string[]): ParsedDaemonArgs | { error: string } {
  const actions: DaemonAction[] = ['run', 'install', 'uninstall', 'start', 'stop', 'status', 'logs'];
  const [action, ...rest] = argv;
  if (action === undefined || action === '') {
    return { error: 'usage: vsa-daemon <run|install|uninstall|start|stop|status|logs> [options]' };
  }
  if (!actions.includes(action as DaemonAction)) {
    return { error: `unknown action ${JSON.stringify(action)} — expected one of: ${actions.join(', ')}` };
  }
  let vault: string | undefined;
  let config: string | undefined;
  let tail = 100;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i]!;
    const next = rest[i + 1];
    if (arg === '--vault' && next !== undefined) {
      vault = next;
      i++;
    } else if (arg === '--config' && next !== undefined) {
      config = next;
      i++;
    } else if ((arg === '-n' || arg === '--tail') && next !== undefined) {
      const parsed = Number(next);
      if (!Number.isInteger(parsed) || parsed <= 0) {
        return { error: `--tail must be a positive integer, got ${JSON.stringify(next)}` };
      }
      tail = parsed;
      i++;
    } else {
      return { error: `unexpected argument: ${arg}` };
    }
  }
  return { action: action as DaemonAction, vault, config, tail };
}

// --- output & logging ---------------------------------------------------------------------

export interface MainOutput {
  log(text?: string): void;
  warn(text?: string): void;
  error(text?: string): void;
}

const consoleOutput: MainOutput = {
  log: (text) => console.log(text),
  warn: (text) => console.warn(text),
  error: (text) => console.error(text),
};

/**
 * `LogAdapter` that writes one JSON object per line to `write` — structured,
 * tail-able, service-friendly (systemd/launchd capture stdout verbatim).
 */
export function structuredLogAdapter(
  write: (line: string) => void,
  now: () => number = () => Date.now(),
): LogAdapter {
  const emit = (level: string, message: string, details: readonly unknown[]): void => {
    write(
      JSON.stringify({
        ts: new Date(now()).toISOString(),
        level,
        msg: message,
        ...(details.length > 0 ? { details: details.map(safeDetail) } : {}),
      }),
    );
  };
  return {
    debug: (message, ...details) => emit('debug', message, details),
    info: (message, ...details) => emit('info', message, details),
    warn: (message, ...details) => emit('warn', message, details),
    error: (message, ...details) => emit('error', message, details),
  };
}

function safeDetail(value: unknown): unknown {
  if (value instanceof Error) return { name: value.name, message: value.message };
  try {
    JSON.stringify(value);
    return value;
  } catch {
    return String(value);
  }
}

// --- rendering ----------------------------------------------------------------------------

export function formatWhen(epochMs: number | null): string {
  if (epochMs === null) return 'never';
  return `${new Date(epochMs).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC')}`;
}

/** `name  path  state  last sync …  pending N  conflicts N  error` per vault. */
export function renderHealthLines(health: DaemonHealth): string[] {
  if (health.vaults.length === 0) {
    return ['no vaults are linked on this machine — run `vsa link <path>` first'];
  }
  return health.vaults.map((vault) => {
    const base =
      `${vault.name}  ${vault.vault}\n` +
      `  state: ${vault.state}   last sync: ${formatWhen(vault.lastSyncAt)}   ` +
      `pending: ${vault.pending}   conflicts: ${vault.conflicts}`;
    return vault.error === undefined ? base : `${base}\n  error: ${vault.error}`;
  });
}

export function renderServiceLine(status: ServiceStatus): string {
  if (status.backend === 'none') return `service: unavailable — ${status.detail}`;
  if (!status.installed) return `service: not installed (${status.detail})`;
  return `service: ${status.active === true ? 'running' : status.active === false ? 'stopped' : 'unknown'} — ${status.detail}`;
}

// --- the entry ----------------------------------------------------------------------------

export interface DaemonMainDeps {
  platform?: string;
  configStore?: ConfigStore;
  output?: MainOutput;
  /** Manager factory (tests). Default: the real `DaemonManager`. */
  createManager?: (options: DaemonManagerOptions) => DaemonManager;
  /** Options handed to the service backends (exec/home/platform overrides). */
  service?: ServiceOptions;
  /** Signal registration seam (tests); default `process.once`. */
  onSignal?: (signal: 'SIGINT' | 'SIGTERM', listener: () => void) => void;
  now?: () => number;
}

export async function daemonMain(
  argv: readonly string[],
  deps: DaemonMainDeps = {},
): Promise<number> {
  const output = deps.output ?? consoleOutput;
  const parsed = parseDaemonArgs(argv);
  if ('error' in parsed) {
    output.error(parsed.error);
    return 1;
  }

  const configStore =
    deps.configStore ??
    (parsed.config !== undefined
      ? new ConfigStore({ configPath: parsed.config })
      : ConfigStore.default());
  const platform = deps.platform ?? process.platform;

  try {
    switch (parsed.action) {
      case 'run':
        return await runForeground(parsed, { ...deps, output, configStore });
      case 'install': {
        const backend = selectServiceBackend({ ...(deps.service ?? {}), platform });
        await backend.install();
        output.log(`Installed ${backend.backend} unit: ${backend.unitPath}`);
        output.log(`Start it with: vsa-daemon start (or systemctl --user start vaultsyncforagents)`);
        return 0;
      }
      case 'uninstall': {
        const backend = selectServiceBackend({ ...(deps.service ?? {}), platform });
        await backend.uninstall();
        output.log(`Removed ${backend.backend} unit: ${backend.unitPath}`);
        return 0;
      }
      case 'start':
      case 'stop': {
        const backend = selectServiceBackend({ ...(deps.service ?? {}), platform });
        await (parsed.action === 'start' ? backend.start() : backend.stop());
        output.log(`${parsed.action === 'start' ? 'Started' : 'Stopped'} the vaultsyncforagents ${backend.backend} service`);
        return 0;
      }
      case 'status': {
        const status = await serviceStatusFor({ ...(deps.service ?? {}), platform });
        const health = readDaemonHealthSnapshot(daemonHealthPathFor(configStore));
        output.log(renderServiceLine(status));
        output.log('');
        if (health === null) {
          output.log('no daemon health snapshot found — is the daemon running?');
          output.log(status.active === true
            ? 'The service is active but has not written a snapshot yet (it writes every few seconds).'
            : 'Start it with: vsa-daemon start (or run it in the foreground: vsa-daemon run)');
        } else {
          output.log(`daemon: ${health.running ? `running (pid ${health.pid}, since ${formatWhen(health.startedAt)})` : 'stopped'}`);
          for (const line of renderHealthLines(health)) output.log(line);
        }
        return 0;
      }
      case 'logs': {
        output.log(await serviceLogsFor({ ...(deps.service ?? {}), platform }, parsed.tail));
        return 0;
      }
    }
  } catch (error) {
    output.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

async function runForeground(
  parsed: ParsedDaemonArgs,
  deps: Required<Pick<DaemonMainDeps, 'output' | 'configStore'>> & DaemonMainDeps,
): Promise<number> {
  const output = deps.output;
  const log = structuredLogAdapter((line) => output.log(line), deps.now);

  let manager: DaemonManager;
  try {
    manager =
      deps.createManager !== undefined
        ? deps.createManager({
            configStore: deps.configStore,
            vaultFilter: parsed.vault,
            log,
            healthPath: daemonHealthPathFor(deps.configStore),
          })
        : new DaemonManager({
            configStore: deps.configStore,
            vaultFilter: parsed.vault,
            log,
            healthPath: daemonHealthPathFor(deps.configStore),
          });
    await manager.start();
  } catch (error) {
    output.error(`failed to start the daemon: ${error instanceof Error ? error.message : String(error)}`);
    return 2;
  }

  for (const vault of manager.health().vaults) {
    log.info('vault session', vault.vault, vault.state);
  }

  const onSignal =
    deps.onSignal ??
    ((signal, listener) => {
      process.once(signal, listener);
    });

  await new Promise<void>((resolve) => {
    const shutdown = (): void => {
      log.info('shutdown signal received — flushing and stopping');
      void manager
        .stop()
        .catch((error: unknown) => log.error('stop failed', error))
        .then(() => resolve());
    };
    onSignal('SIGINT', shutdown);
    onSignal('SIGTERM', shutdown);
  });
  return 0;
}

/** bin/vsa-daemon.js entry point. */
export async function daemonMainProcess(argv: readonly string[]): Promise<void> {
  process.exitCode = await daemonMain(argv);
}

// Re-exported for the CLI's daemon command (single import surface).
export { serviceKindFor };
export type { ServiceStatus, VaultEntry };
