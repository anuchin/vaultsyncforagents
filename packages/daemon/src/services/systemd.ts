/**
 * systemd user service (FR-43, Linux primary): generates
 * `~/.config/systemd/user/vaultsyncforagents.service` (ExecStart = node +
 * the daemon entry, Restart=always, RestartSec=5) and drives it through
 * `systemctl --user` — no root required. Unit generation is pure
 * (testable); every command goes through the injectable `Exec` seam.
 */

import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  defaultExec,
  refuseServiceAction,
  runServiceCommand,
  ServiceError,
  type Exec,
  type ServiceBackend,
  type ServiceStatus,
} from './service.js';
import { daemonEntryPath } from '../entry.js';

export const SYSTEMD_SERVICE_NAME = 'vaultsyncforagents';
export const SYSTEMD_UNIT_FILE = `${SYSTEMD_SERVICE_NAME}.service`;

export interface SystemdServiceOptions {
  /** Home dir override (tests); default `homedir()`. */
  home?: string;
  /** `$XDG_CONFIG_HOME` override; default `process.env.XDG_CONFIG_HOME`. */
  xdgConfigHome?: string;
  /** Node binary for ExecStart (default `process.execPath`). */
  nodePath?: string;
  /** Daemon entry script (default: this package's bin). */
  daemonEntry?: string;
  /** RestartSec seconds (default 5). */
  restartSec?: number;
  /** Injectable command runner (tests). */
  exec?: Exec;
  /** Platform gate (tests); default `process.platform`. */
  platform?: string;
}

/** `~/.config/systemd/user` honoring `$XDG_CONFIG_HOME`. */
export function systemdUnitDir(home: string = homedir(), xdgConfigHome?: string): string {
  const xdg = xdgConfigHome ?? process.env['XDG_CONFIG_HOME'];
  return xdg !== undefined && xdg !== '' ? join(xdg, 'systemd', 'user') : join(home, '.config', 'systemd', 'user');
}

export interface SystemdUnitParams {
  nodePath: string;
  daemonEntry: string;
  restartSec?: number;
}

/** Pure unit-file generator — the exact bytes `install()` writes. */
export function generateSystemdUnit(params: SystemdUnitParams): string {
  const restartSec = params.restartSec ?? 5;
  return [
    '[Unit]',
    'Description=VaultSync for Agents daemon (headless multi-vault sync)',
    'Documentation=https://github.com/anuchin/vaultsyncforagents',
    'After=network-online.target',
    'Wants=network-online.target',
    '',
    '[Service]',
    'Type=simple',
    `ExecStart="${params.nodePath}" "${params.daemonEntry}" run`,
    'Restart=always',
    `RestartSec=${restartSec}`,
    '',
    '[Install]',
    'WantedBy=default.target',
    '',
  ].join('\n');
}

export class SystemdService implements ServiceBackend {
  readonly backend = 'systemd' as const;
  readonly unitPath: string;
  readonly unitContent: string;

  private readonly exec: Exec;
  private readonly platform: string;
  private readonly nodePath: string;

  constructor(options: SystemdServiceOptions = {}) {
    this.exec = options.exec ?? defaultExec;
    this.platform = options.platform ?? process.platform;
    this.nodePath = options.nodePath ?? process.execPath;
    this.unitPath = join(
      systemdUnitDir(options.home, options.xdgConfigHome),
      SYSTEMD_UNIT_FILE,
    );
    this.unitContent = generateSystemdUnit({
      nodePath: this.nodePath,
      daemonEntry: options.daemonEntry ?? daemonEntryPath(),
      restartSec: options.restartSec,
    });
  }

  async install(): Promise<void> {
    refuseServiceAction(this.platform, 'install');
    await mkdir(dirname(this.unitPath), { recursive: true });
    await writeFile(this.unitPath, this.unitContent, 'utf8');
    await runServiceCommand(this.exec, 'systemctl', ['--user', 'daemon-reload'], 'installing the unit');
    await runServiceCommand(
      this.exec,
      'systemctl',
      ['--user', 'enable', SYSTEMD_UNIT_FILE],
      'enabling the unit',
    );
  }

  async uninstall(): Promise<void> {
    refuseServiceAction(this.platform, 'uninstall');
    await this.stopQuietly();
    await runServiceCommand(
      this.exec,
      'systemctl',
      ['--user', 'disable', SYSTEMD_UNIT_FILE],
      'disabling the unit',
    );
    await rm(this.unitPath, { force: true });
    await runServiceCommand(this.exec, 'systemctl', ['--user', 'daemon-reload'], 'uninstalling the unit');
  }

  async start(): Promise<void> {
    refuseServiceAction(this.platform, 'start');
    await runServiceCommand(
      this.exec,
      'systemctl',
      ['--user', 'start', SYSTEMD_UNIT_FILE],
      'starting the daemon',
    );
  }

  async stop(): Promise<void> {
    refuseServiceAction(this.platform, 'stop');
    await runServiceCommand(
      this.exec,
      'systemctl',
      ['--user', 'stop', SYSTEMD_UNIT_FILE],
      'stopping the daemon',
    );
  }

  async status(): Promise<ServiceStatus> {
    refuseServiceAction(this.platform, 'status');
    const installed = existsSync(this.unitPath);
    if (!installed) {
      return { backend: 'systemd', installed: false, active: null, detail: `unit not found at ${this.unitPath}` };
    }
    // is-enabled / is-active speak through exit codes; both non-zero states
    // are normal answers, not failures.
    const enabled = await this.exec('systemctl', ['--user', 'is-enabled', SYSTEMD_UNIT_FILE]);
    const active = await this.exec('systemctl', ['--user', 'is-active', SYSTEMD_UNIT_FILE]);
    const detail =
      `${SYSTEMD_UNIT_FILE}: ${firstLine(active.stdout) || exitWord(active.code)}, ` +
      `enabled: ${firstLine(enabled.stdout) || exitWord(enabled.code)} (${this.unitPath})`;
    return {
      backend: 'systemd',
      installed: true,
      active: active.code === 0,
      detail,
    };
  }

  async logs(tailLines = 100): Promise<string> {
    refuseServiceAction(this.platform, 'logs');
    const result = await runServiceCommand(
      this.exec,
      'journalctl',
      ['--user', '--unit', SYSTEMD_SERVICE_NAME, '--no-pager', '-o', 'cat', '-n', String(tailLines)],
      'reading daemon logs',
    );
    return result.stdout;
  }

  private async stopQuietly(): Promise<void> {
    // Uninstall stops first; "not loaded" is fine, real failures are not.
    const result = await this.exec('systemctl', ['--user', 'stop', SYSTEMD_UNIT_FILE]);
    if (result.code !== 0 && !/not loaded|Failed to stop/.test(result.stderr)) {
      throw new ServiceError(
        `uninstalling: \`systemctl --user stop ${SYSTEMD_UNIT_FILE}\` failed with exit code ${result.code}`,
        { command: `systemctl --user stop ${SYSTEMD_UNIT_FILE}`, exitCode: result.code, stderr: result.stderr },
      );
    }
  }
}

function firstLine(text: string): string {
  return text.trim().split('\n')[0] ?? '';
}

function exitWord(code: number): string {
  return code === 0 ? 'ok' : `exit ${code}`;
}
