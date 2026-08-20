/**
 * `vsa` — VaultSync for Agents CLI (FR-50..FR-58).
 *
 * Thin commander layer: global flags (--vault, --json, --config), one
 * subcommand each, all logic delegated to `commands/*` over an injectable
 * `VsRuntime`. `vsa daemon …` (FR-55) delegates to `@vsa/daemon`; `setup` is
 * a later phase (FR-50) and intentionally absent.
 */

import { Command } from 'commander';
import pc from 'picocolors';
import { ConfigStore } from '@vsa/node-runtime';
import { runLink } from './commands/link.js';
import { runUnlink } from './commands/unlink.js';
import { runStatus, renderStatus } from './commands/status.js';
import { runDevices, renderDevices, runRevoke } from './commands/devices.js';
import { runLogs, renderLogs } from './commands/logs.js';
import { runHistory, renderHistory, runRestore } from './commands/history.js';
import { runDoctor, renderDoctor } from './commands/doctor.js';
import { renderDaemonResult, runDaemonCommand, type DaemonAction } from './commands/daemon.js';
import {
  ClackPromptUi,
  CommandError,
  isInteractive,
  requireSingleVault,
  selectVaults,
  type OutputWriter,
  type VsRuntime,
} from './runtime.js';

export interface GlobalOptions {
  vault?: string;
  json?: boolean;
  config?: string;
}

export function buildRuntime(options: GlobalOptions, output: OutputWriter): VsRuntime {
  const store =
    options.config !== undefined
      ? new ConfigStore({ configPath: options.config })
      : ConfigStore.default({
          onRecovery: (path, error) =>
            output.warn(
              `recovered a corrupt config file: ${path} moved to ${path}.corrupt.bak ` +
                `(${error instanceof Error ? error.message : String(error)})`,
            ),
        });
  return {
    configStore: store,
    fetchImpl: fetch,
    now: () => Date.now(),
    output,
    prompts: isInteractive() ? new ClackPromptUi() : null,
  };
}

export function buildProgram(runtime: VsRuntime): Command {
  const program = new Command();
  program
    .name('vsa')
    .description('VaultSync for Agents — self-hosted Obsidian vault sync')
    .version('0.1.0')
    .option('--vault <id|path>', 'scope the command to one linked vault')
    .option('--json', 'machine-readable JSON output')
    .option('--config <path>', 'alternate machine config path');

  const globals = (): GlobalOptions => {
    // Commander merges inherited options; subcommand-local ones win by name,
    // and the three globals are only ever declared at the root.
    const root = program.opts<GlobalOptions>();
    return { vault: root.vault, json: root.json, config: root.config };
  };

  program
    .command('link [path]')
    .description('pair this machine\'s vault with a worker (URL + pairing code)')
    .option('--url <url>', 'worker URL')
    .option('--code <code>', 'pairing code from the worker dashboard')
    .option('--name <name>', 'device name shown in the dashboard')
    .option('--force', 're-pair even if this vault is already linked here')
    .action(async (path, options: Record<string, unknown>) => {
      const merged: Record<string, unknown> = { ...globals(), ...options };
      const result = await runLink(runtime, {
        path,
        url: merged['url'] as string | undefined,
        code: merged['code'] as string | undefined,
        name: merged['name'] as string | undefined,
        force: merged['force'] === true,
      });
      if (merged['json'] === true) {
        runtime.output.log(
          JSON.stringify(
            {
              linked: true,
              vault: result.vault,
              filesSynced: result.filesSynced,
              conflicts: result.conflicts,
            },
            null,
            2,
          ),
        );
        return;
      }
      runtime.output.log(`Linked ${result.vault.name} at ${result.vault.id}`);
      runtime.output.log(
        `Initial sync complete — ${result.filesSynced} file(s) tracked` +
          (result.conflicts > 0 ? `, ${result.conflicts} conflict(s) resolved as copies` : ''),
      );
    });

  program
    .command('unlink [path]')
    .description('remove a vault from this machine (files on disk are kept)')
    .action((path) => {
      const result = runUnlink(runtime, { path: path ?? globals().vault });
      runtime.output.log(`Unlinked ${result.name ?? result.vaultPath}`);
      runtime.output.log(
        'Local files and the .vaultsyncforagents state dir were left in place; ' +
          'the vault simply no longer syncs from this machine.',
      );
    });

  program
    .command('status')
    .description('per-vault sync status across all linked vaults')
    .action(async () => {
      const options = globals();
      const report = await runStatus(runtime, selectVaults(runtime, options.vault));
      if (options.json === true) {
        runtime.output.log(JSON.stringify(report, null, 2));
        return;
      }
      renderStatus(report, runtime);
    });

  const devices = program
    .command('devices')
    .description('list devices per vault (name, type, online, last seen, revoked)');
  devices.action(async () => {
    const options = globals();
    const reports = await runDevices(runtime, selectVaults(runtime, options.vault));
    if (options.json === true) {
      runtime.output.log(JSON.stringify(reports, null, 2));
      return;
    }
    renderDevices(reports, runtime);
  });
  devices
    .command('revoke <nameOrId>')
    .description('revoke a device (requires the worker admin passphrase)')
    .option('--passphrase <passphrase>', 'admin passphrase (non-interactive use)')
    .option('--yes', 'skip the confirmation prompt')
    .action(async (nameOrId, options: Record<string, unknown>) => {
      const merged: Record<string, unknown> = { ...globals(), ...options };
      const vault = requireSingleVault(runtime, merged.vault as string | undefined);
      const result = await runRevoke(runtime, vault, {
        nameOrId,
        passphrase: merged['passphrase'] as string | undefined,
        yes: merged['yes'] === true,
      });
      runtime.output.log(`Revoked ${result.deviceName} (${result.deviceId})`);
    });

  program
    .command('logs')
    .description('recent sync events from the worker (last 50)')
    .action(async () => {
      const options = globals();
      const reports = await runLogs(runtime, selectVaults(runtime, options.vault));
      if (options.json === true) {
        runtime.output.log(JSON.stringify(reports, null, 2));
        return;
      }
      renderLogs(reports, runtime);
    });

  program
    .command('history <file>')
    .description('version history of one vault file (path relative to the vault root)')
    .action(async (file) => {
      const options = globals();
      const doc = await runHistory(runtime, file, options.vault);
      if (options.json === true) {
        runtime.output.log(JSON.stringify(doc, null, 2));
        return;
      }
      renderHistory(doc, runtime);
    });

  program
    .command('restore <file>')
    .description('restore an older version of a file and push it as a new version')
    .option('--version <id>', 'version id to restore (default: undo one edit)')
    .action(async (file, options: Record<string, unknown>) => {
      const merged: Record<string, unknown> = { ...globals(), ...options };
      const result = await runRestore(runtime, file, merged['version'] as string | undefined, merged.vault as string | undefined);
      runtime.output.log(
        `Restored ${result.path} to version ${result.version.id} ` +
          `(${result.bytesWritten} bytes, ${result.version.kind} from ${formatWhen(result.version.ts)})`,
      );
      runtime.output.log('Pushed via a sync cycle — other devices will pick it up.');
    });

  program
    .command('doctor')
    .description('diagnostics: reachability, claim state, token, clock skew, storage, hints')
    .action(async () => {
      const options = globals();
      const reports = await runDoctor(runtime, selectVaults(runtime, options.vault));
      if (options.json === true) {
        runtime.output.log(JSON.stringify(reports, null, 2));
      } else {
        renderDoctor(reports, runtime);
      }
      if (reports.some((report) => !report.healthy)) {
        process.exitCode = 1;
      }
    });

  // --- daemon (FR-55) ----------------------------------------------------------------------

  const daemonAction = async (action: DaemonAction, extra: Record<string, unknown> = {}): Promise<void> => {
    const options = globals();
    const merged: Record<string, unknown> = { vault: options.vault, ...extra };
    const result = await runDaemonCommand(runtime, action, {
      vault: merged['vault'] as string | undefined,
      tail: merged['tail'] as number | undefined,
    });
    if (options.json === true) {
      runtime.output.log(JSON.stringify(result, null, 2));
      return;
    }
    renderDaemonResult(result, runtime);
  };

  const daemon = program
    .command('daemon')
    .description('background sync service (FR-55): run, install, start/stop, status, logs');
  daemon
    .command('run')
    .description('run the daemon in the foreground (all linked vaults, or --vault)')
    .action(async () => {
      await daemonAction('run');
    });
  daemon
    .command('install')
    .description('install a user-level service (systemd on Linux, launchd on macOS; no root)')
    .action(async () => {
      await daemonAction('install');
    });
  daemon
    .command('uninstall')
    .description('stop and remove the user-level service')
    .action(async () => {
      await daemonAction('uninstall');
    });
  daemon
    .command('start')
    .description('start the installed daemon service')
    .action(async () => {
      await daemonAction('start');
    });
  daemon
    .command('stop')
    .description('stop the daemon service (in-flight sync cycles are flushed)')
    .action(async () => {
      await daemonAction('stop');
    });
  daemon
    .command('status')
    .description('service state + per-vault sync status of the running daemon')
    .action(async () => {
      await daemonAction('status');
    });
  daemon
    .command('logs')
    .description('tail daemon logs (journald on Linux, launchd log on macOS)')
    .option('-n, --tail <n>', 'number of lines to show', '100')
    .action(async (options: Record<string, unknown>) => {
      await daemonAction('logs', { tail: Number(options['tail']) });
    });

  return program;
}

function formatWhen(ts: number): string {
  return new Date(ts).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

// --- console output (colors where the terminal supports them) ---------------------------

export const consoleOutput: OutputWriter = {
  log: (text) => console.log(text),
  warn: (text) => console.warn(pc.yellow(`! ${text ?? ''}`)),
  error: (text) => console.error(pc.red(`× ${text ?? ''}`)),
};

/** Entry point for bin/vsa.js. Global --config is pre-scanned (it decides which config store the commands get). */
export async function main(argv: readonly string[]): Promise<void> {
  const configIndex = argv.indexOf('--config');
  const config =
    configIndex !== -1 && configIndex + 1 < argv.length
      ? (argv[configIndex + 1] as string)
      : undefined;
  const runtime = buildRuntime({ config }, consoleOutput);
  const program = buildProgram(runtime);
  try {
    await program.parseAsync(argv, { from: 'user' });
  } catch (error) {
    if (
      (error instanceof CommandError && error.message === 'cancelled') ||
      (error instanceof Error && error.name === 'CancelledError')
    ) {
      consoleOutput.warn('cancelled');
      return;
    }
    if (error instanceof CommandError) {
      consoleOutput.error(error.message);
      process.exitCode = 1;
      return;
    }
    consoleOutput.error(error instanceof Error ? `${error.stack ?? error.message}` : String(error));
    process.exitCode = 1;
  }
}
