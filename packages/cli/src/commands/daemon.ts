/**
 * `vsa daemon …` (FR-55): run (foreground), install/uninstall/start/stop
 * (user-level systemd/launchd service), status (service + per-vault lines
 * from the running daemon's health snapshot), logs (journald/launchd tail,
 * or the foreground hint where no service backend exists).
 *
 * All logic delegates to `@vsa/daemon` over the `DaemonControl` seam, which
 * tests fake (the runtime injects one); production uses the real module.
 * `install` prompts for nothing — it uses the current user context (user
 * units, this machine's node + entry paths, the CLI's config store).
 */

import {
  DaemonManager,
  daemonEntryPath,
  daemonHealthPathFor,
  readDaemonHealthSnapshot,
  renderHealthLines,
  renderServiceLine,
  selectServiceBackend,
  serviceLogsFor,
  serviceStatusFor,
  ServiceError,
  structuredLogAdapter,
  type DaemonHealth,
  type DaemonManagerOptions,
  type ServiceOptions,
  type ServiceStatus,
} from '@vsa/daemon';
import { CommandError, type VsRuntime } from '../runtime.js';

export type DaemonAction = 'run' | 'install' | 'uninstall' | 'start' | 'stop' | 'status' | 'logs';

/** The manager surface the command drives (core's `DaemonManager` satisfies it). */
export interface DaemonManagerLike {
  start(): Promise<void>;
  stop(): Promise<void>;
  health(): DaemonHealth;
}

/** Injectable seam over `@vsa/daemon` (tests install fakes on the runtime). */
export interface DaemonControl {
  createManager(options: DaemonManagerOptions): DaemonManagerLike;
  install(service: ServiceOptions): Promise<{ backend: string; unitPath: string }>;
  uninstall(service: ServiceOptions): Promise<{ backend: string; unitPath: string }>;
  start(service: ServiceOptions): Promise<{ backend: string }>;
  stop(service: ServiceOptions): Promise<{ backend: string }>;
  status(service: ServiceOptions): Promise<ServiceStatus>;
  logs(service: ServiceOptions, tailLines: number): Promise<string>;
  entryPath(): string;
  nodePath(): string;
  healthSnapshotPath(configStoreConfigPath: string): string;
  readHealthSnapshot(path: string): DaemonHealth | null;
}

export const realDaemonControl: DaemonControl = {
  createManager(options) {
    return new DaemonManager(options);
  },
  async install(service) {
    const backend = selectServiceBackend(service);
    await backend.install();
    return { backend: backend.backend, unitPath: backend.unitPath };
  },
  async uninstall(service) {
    const backend = selectServiceBackend(service);
    await backend.uninstall();
    return { backend: backend.backend, unitPath: backend.unitPath };
  },
  async start(service) {
    const backend = selectServiceBackend(service);
    await backend.start();
    return { backend: backend.backend };
  },
  async stop(service) {
    const backend = selectServiceBackend(service);
    await backend.stop();
    return { backend: backend.backend };
  },
  status(service) {
    return serviceStatusFor(service);
  },
  logs(service, tailLines) {
    return serviceLogsFor(service, tailLines);
  },
  entryPath: () => daemonEntryPath(),
  nodePath: () => process.execPath,
  healthSnapshotPath: (configPath) => daemonHealthPathFor({ configPath }),
  readHealthSnapshot: (path) => readDaemonHealthSnapshot(path),
};

export interface DaemonCommandOptions {
  vault?: string;
  /** `logs` tail (default 100). */
  tail?: number;
}

export type DaemonResult =
  | { kind: 'run'; health: DaemonHealth }
  | { kind: 'install' | 'uninstall'; backend: string; unitPath: string }
  | { kind: 'start' | 'stop'; backend: string }
  | { kind: 'status'; service: ServiceStatus; health: DaemonHealth | null }
  | { kind: 'logs'; text: string };

/**
 * Run one daemon action. `run` blocks until SIGINT/SIGTERM (graceful stop).
 * Service failures surface as `CommandError` (exit 1, friendly message).
 */
export async function runDaemonCommand(
  runtime: VsRuntime,
  action: DaemonAction,
  options: DaemonCommandOptions = {},
  control: DaemonControl = runtime.daemonControl ?? realDaemonControl,
): Promise<DaemonResult> {
  switch (action) {
    case 'run':
      return runForeground(runtime, options, control);
    case 'install':
    case 'uninstall':
    case 'start':
    case 'stop': {
      const service: ServiceOptions = {};
      try {
        if (action === 'install') {
          const installed = await control.install(service);
          return { kind: 'install', backend: installed.backend, unitPath: installed.unitPath };
        }
        if (action === 'uninstall') {
          const removed = await control.uninstall(service);
          return { kind: 'uninstall', backend: removed.backend, unitPath: removed.unitPath };
        }
        if (action === 'start') {
          const started = await control.start(service);
          return { kind: 'start', backend: started.backend };
        }
        const stopped = await control.stop(service);
        return { kind: 'stop', backend: stopped.backend };
      } catch (error) {
        throw toCommandError(error, action);
      }
    }
    case 'status': {
      const service: ServiceOptions = {};
      const [serviceStatus, health] = await Promise.all([
        control.status(service).catch((error: unknown) => {
          throw toCommandError(error, 'status');
        }),
        Promise.resolve().then(() => {
          const snapshotPath = control.healthSnapshotPath(runtime.configStore.configPath);
          return control.readHealthSnapshot(snapshotPath);
        }),
      ]);
      return { kind: 'status', service: serviceStatus, health };
    }
    case 'logs': {
      const service: ServiceOptions = {};
      try {
        return { kind: 'logs', text: await control.logs(service, options.tail ?? 100) };
      } catch (error) {
        throw toCommandError(error, 'logs');
      }
    }
  }
}

async function runForeground(
  runtime: VsRuntime,
  options: DaemonCommandOptions,
  control: DaemonControl,
): Promise<DaemonResult> {
  let manager: DaemonManagerLike;
  try {
    manager = control.createManager({
      configStore: runtime.configStore,
      ...(options.vault !== undefined ? { vaultFilter: options.vault } : {}),
      healthPath: control.healthSnapshotPath(runtime.configStore.configPath),
      log: structuredLogAdapter((line) => runtime.output.log(line)),
    });
    await manager.start();
  } catch (error) {
    throw new CommandError(
      `failed to start the daemon: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  await new Promise<void>((resolve) => {
    const shutdown = (): void => {
      void manager
        .stop()
        .catch((error: unknown) =>
          runtime.output.warn(`shutdown flush failed: ${error instanceof Error ? error.message : String(error)}`),
        )
        .then(() => resolve());
    };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
  });
  return { kind: 'run', health: manager.health() };
}

function toCommandError(error: unknown, action: DaemonAction): CommandError {
  if (error instanceof CommandError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof ServiceError) {
    return new CommandError(`\`vsa daemon ${action}\`: ${message}`);
  }
  return new CommandError(message);
}

// --- rendering --------------------------------------------------------------------------------

export function renderDaemonResult(result: DaemonResult, runtime: VsRuntime): void {
  const out = runtime.output;
  switch (result.kind) {
    case 'run':
      out.log('Daemon stopped gracefully.');
      for (const line of renderHealthLines(result.health)) out.log(line);
      return;
    case 'install':
      out.log(`Installed the ${result.backend} user service: ${result.unitPath}`);
      out.log('The daemon starts now and at every login; start/stop it with `vsa daemon start|stop`.');
      return;
    case 'uninstall':
      out.log(`Removed the ${result.backend} user service: ${result.unitPath}`);
      return;
    case 'start':
      out.log(`Started the ${result.backend} daemon service.`);
      out.log('Per-vault status: vsa daemon status   |   logs: vsa daemon logs');
      return;
    case 'stop':
      out.log(`Stopped the ${result.backend} daemon service (in-flight sync cycles are flushed).`);
      return;
    case 'status':
      renderDaemonStatus(result, runtime);
      return;
    case 'logs':
      out.log(result.text);
      return;
  }
}

export function renderDaemonStatus(
  result: Extract<DaemonResult, { kind: 'status' }>,
  runtime: VsRuntime,
): void {
  const out = runtime.output;
  out.log(renderServiceLine(result.service));
  out.log('');
  if (result.health === null) {
    out.log('no daemon health snapshot found — is the daemon running?');
    if (result.service.active === true) {
      out.log('The service is active but has not written a snapshot yet (it writes every few seconds).');
    } else {
      out.log('Start it with `vsa daemon start`, or run it in the foreground: `vsa daemon run`.');
    }
    return;
  }
  out.log(
    result.health.running
      ? `daemon: running (pid ${result.health.pid}, since ${new Date(result.health.startedAt).toISOString()})`
      : 'daemon: stopped',
  );
  for (const line of renderHealthLines(result.health)) out.log(line);
}
