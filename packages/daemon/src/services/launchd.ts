/**
 * launchd agent (FR-43, macOS): generates
 * `~/Library/LaunchAgents/com.vaultsyncforagents.plist` and drives it with
 * `launchctl load/unload` — user-level, no root. Logs land in
 * `~/Library/Logs/vaultsyncforagents/{out,err}.log` and are tailed by
 * `logs()`.
 */

import { existsSync } from 'node:fs';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { readFile } from 'node:fs/promises';
import {
  defaultExec,
  refuseServiceAction,
  runServiceCommand,
  type Exec,
  type ServiceBackend,
  type ServiceStatus,
} from './service.js';
import { daemonEntryPath } from '../entry.js';

export const LAUNCHD_LABEL = 'com.vaultsyncforagents';

export interface LaunchdServiceOptions {
  /** Home dir override (tests); default `homedir()`. */
  home?: string;
  /** Node binary (default `process.execPath`). */
  nodePath?: string;
  /** Daemon entry script (default: this package's bin). */
  daemonEntry?: string;
  /** Injectable command runner (tests). */
  exec?: Exec;
  /** Platform gate (tests); default `process.platform`. */
  platform?: string;
}

export function launchdPlistPath(home: string = homedir()): string {
  return join(home, 'Library', 'LaunchAgents', `${LAUNCHD_LABEL}.plist`);
}

export function launchdLogPaths(home: string = homedir()): { out: string; err: string } {
  const dir = join(home, 'Library', 'Logs', 'vaultsyncforagents');
  return { out: join(dir, 'out.log'), err: join(dir, 'err.log') };
}

export interface LaunchdPlistParams {
  nodePath: string;
  daemonEntry: string;
  label?: string;
  outLog: string;
  errLog: string;
}

/** Pure plist generator — the exact bytes `install()` writes. */
export function generateLaunchdPlist(params: LaunchdPlistParams): string {
  const label = params.label ?? LAUNCHD_LABEL;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '<dict>',
    `  <key>Label</key>`,
    `  <string>${xmlEscape(label)}</string>`,
    '  <key>ProgramArguments</key>',
    '  <array>',
    `    <string>${xmlEscape(params.nodePath)}</string>`,
    `    <string>${xmlEscape(params.daemonEntry)}</string>`,
    '    <string>run</string>',
    '  </array>',
    '  <key>RunAtLoad</key>',
    '  <true/>',
    '  <key>KeepAlive</key>',
    '  <true/>',
    '  <key>StandardOutPath</key>',
    `  <string>${xmlEscape(params.outLog)}</string>`,
    '  <key>StandardErrorPath</key>',
    `  <string>${xmlEscape(params.errLog)}</string>`,
    '</dict>',
    '</plist>',
    '',
  ].join('\n');
}

export class LaunchdService implements ServiceBackend {
  readonly backend = 'launchd' as const;
  readonly unitPath: string;
  readonly unitContent: string;

  private readonly exec: Exec;
  private readonly platform: string;
  private readonly home: string;

  constructor(options: LaunchdServiceOptions = {}) {
    this.exec = options.exec ?? defaultExec;
    this.platform = options.platform ?? process.platform;
    this.home = options.home ?? homedir();
    this.unitPath = launchdPlistPath(this.home);
    const logs = launchdLogPaths(this.home);
    this.unitContent = generateLaunchdPlist({
      nodePath: options.nodePath ?? process.execPath,
      daemonEntry: options.daemonEntry ?? daemonEntryPath(),
      outLog: logs.out,
      errLog: logs.err,
    });
  }

  async install(): Promise<void> {
    refuseServiceAction(this.platform, 'install');
    await mkdir(dirname(this.unitPath), { recursive: true });
    await mkdir(dirname(launchdLogPaths(this.home).out), { recursive: true });
    await writeFile(this.unitPath, this.unitContent, 'utf8');
    // Replace any previously-loaded instance, then load the fresh plist.
    await this.exec('launchctl', ['unload', '-w', this.unitPath]);
    await runServiceCommand(
      this.exec,
      'launchctl',
      ['load', '-w', this.unitPath],
      'loading the agent',
    );
  }

  async uninstall(): Promise<void> {
    refuseServiceAction(this.platform, 'uninstall');
    await runServiceCommand(
      this.exec,
      'launchctl',
      ['unload', '-w', this.unitPath],
      'unloading the agent',
    );
    await rm(this.unitPath, { force: true });
  }

  async start(): Promise<void> {
    refuseServiceAction(this.platform, 'start');
    await runServiceCommand(
      this.exec,
      'launchctl',
      ['load', '-w', this.unitPath],
      'starting the agent',
    );
  }

  async stop(): Promise<void> {
    refuseServiceAction(this.platform, 'stop');
    await runServiceCommand(
      this.exec,
      'launchctl',
      ['unload', '-w', this.unitPath],
      'stopping the agent',
    );
  }

  async status(): Promise<ServiceStatus> {
    refuseServiceAction(this.platform, 'status');
    const installed = existsSync(this.unitPath);
    if (!installed) {
      return { backend: 'launchd', installed: false, active: null, detail: `agent not found at ${this.unitPath}` };
    }
    // `launchctl list <label>` prints `"<PID>\t<status>\t<label>"` (quoted)
    // when loaded; non-zero exit = not loaded.
    const listed = await this.exec('launchctl', ['list', LAUNCHD_LABEL]);
    if (listed.code !== 0) {
      return {
        backend: 'launchd',
        installed: true,
        active: false,
        detail: `${LAUNCHD_LABEL} is installed but not loaded (${this.unitPath})`,
      };
    }
    const line = (listed.stdout.trim().split('\n')[0] ?? '').replace(/^"|"$/g, '');
    const pid = line.split('\t')[0] ?? '';
    const running = pid !== '' && pid !== '-' && /^\d+$/.test(pid);
    return {
      backend: 'launchd',
      installed: true,
      active: running,
      detail: running
        ? `${LAUNCHD_LABEL} is running (pid ${pid})`
        : `${LAUNCHD_LABEL} is loaded but not running (last exit ${pid === '-' ? 'unknown' : pid})`,
    };
  }

  async logs(tailLines = 100): Promise<string> {
    refuseServiceAction(this.platform, 'logs');
    const { out, err } = launchdLogPaths(this.home);
    const [outText, errText] = await Promise.all([
      readLogTail(out, tailLines),
      readLogTail(err, tailLines),
    ]);
    const parts: string[] = [];
    if (outText !== '') parts.push(outText);
    if (errText !== '') parts.push(errText);
    if (parts.length === 0) {
      return `no daemon logs yet (watching ${out} and ${err})`;
    }
    return parts.join('\n');
  }
}

function xmlEscape(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function readLogTail(path: string, tailLines: number): Promise<string> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return '';
  }
  const lines = text.trimEnd().split('\n');
  return lines.slice(Math.max(0, lines.length - tailLines)).join('\n');
}
