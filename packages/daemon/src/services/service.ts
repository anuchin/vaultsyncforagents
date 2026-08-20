/**
 * Service-management plumbing shared by the systemd and launchd backends
 * (FR-43): an injectable `Exec` seam (tests observe the exact `systemctl` /
 * `launchctl` invocations; production shells out via `child_process`), a
 * mapped `ServiceError`, the backend contract, and the Windows refusal.
 *
 * Everything runs at USER level — no root, no sudo: `systemctl --user` and
 * `launchctl` (LaunchAgents), per the architecture's "no root required".
 */

import { spawn } from 'node:child_process';

/** Result of one command invocation (exit status + captured output). */
export interface ExecResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Injectable process runner. Never throws — failures are `{code≠0}`. */
export type Exec = (command: string, args: readonly string[]) => Promise<ExecResult>;

export const defaultExec: Exec = (command, args) =>
  new Promise((resolve) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });
    child.on('error', (error: NodeJS.ErrnoException) => {
      resolve({
        code: typeof error.code === 'number' ? error.code : 127,
        stdout,
        stderr: stderr === '' ? `${command}: ${error.message}` : stderr,
      });
    });
    child.on('close', (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });

/** Expected, user-facing service-management failure (CLI maps to a message). */
export class ServiceError extends Error {
  readonly command?: string;
  readonly exitCode?: number;
  readonly stderr?: string;

  constructor(message: string, detail: { command?: string; exitCode?: number; stderr?: string } = {}) {
    super(message);
    this.name = 'ServiceError';
    this.command = detail.command;
    this.exitCode = detail.exitCode;
    this.stderr = detail.stderr;
  }
}

export interface ServiceStatus {
  /** `'none'` on platforms without a v1 backend (win32/unknown). */
  backend: 'systemd' | 'launchd' | 'none';
  installed: boolean;
  /** `null` when unknown; `false` when installed but not running. */
  active: boolean | null;
  detail: string;
}

export interface ServiceBackend {
  readonly backend: 'systemd' | 'launchd';
  /** Absolute path of the generated unit/plist. */
  readonly unitPath: string;
  /** The unit/plist content that install() writes (generation is pure). */
  readonly unitContent: string;
  install(): Promise<void>;
  uninstall(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Never throws on "not installed"; throws only on tool failure. */
  status(): Promise<ServiceStatus>;
  /** Last `tailLines` service log lines. */
  logs(tailLines?: number): Promise<string>;
}

/** The FR-43 Windows (and unknown-platform) refusal message. */
export const SERVICE_UNSUPPORTED_MESSAGE =
  'service management is not available on this platform in v1 (FR-43: systemd on Linux, ' +
  'launchd on macOS; Windows service support later). The sync engine itself is cross-platform — ' +
  'run `vsa daemon run` in a terminal (or a Task Scheduler / NSSM wrapper of your own) instead.';

/** Throw the platform refusal (win32/unknown) for a mutating service action. */
export function refuseServiceAction(platform: string, action: string): void {
  if (platform === 'linux' || platform === 'darwin') return;
  throw new ServiceError(
    `\`vsa daemon ${action}\`: ${SERVICE_UNSUPPORTED_MESSAGE} (platform: ${platform})`,
  );
}

/** `true` when the platform has a v1 service backend. */
export function isServicePlatform(platform: string): boolean {
  return platform === 'linux' || platform === 'darwin';
}

/**
 * Run a command, mapping a non-zero exit to a `ServiceError` with the most
 * useful diagnosis we can produce (tool missing vs. user-bus vs. plain failure).
 */
export async function runServiceCommand(
  exec: Exec,
  command: string,
  args: readonly string[],
  what: string,
): Promise<ExecResult> {
  const result = await exec(command, args);
  if (result.code === 0) return result;
  const invocation = `${command} ${args.join(' ')}`;
  const stderr = result.stderr.trim();
  if (result.code === 127 || /not found|ENOENT/i.test(stderr)) {
    throw new ServiceError(`${what}: ${command} is not available on this system`, {
      command: invocation,
      exitCode: result.code,
      stderr,
    });
  }
  if (/Failed to connect to bus|D-Bus/i.test(stderr)) {
    throw new ServiceError(
      `${what}: could not reach the systemd user bus. Over SSH there is no user session by ` +
        `default — run \`loginctl enable-linger $USER\` on the server (once), then retry from a ` +
        `fresh login.`,
      { command: invocation, exitCode: result.code, stderr },
    );
  }
  throw new ServiceError(
    `${what}: \`${invocation}\` failed with exit code ${result.code}` +
      (stderr !== '' ? `: ${stderr}` : ''),
    { command: invocation, exitCode: result.code, stderr },
  );
}
