/**
 * The standalone entry (`vsa-daemon`): argument parsing, `run` foreground
 * lifecycle (manager wiring, structured logs, graceful signal shutdown),
 * service actions through the injectable seams, and status rendering.
 */

import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigStore } from '@vsa/node-runtime';
import type { Exec } from '../src/services/service.js';
import {
  daemonHealthPathFor,
  DaemonManager,
  type DaemonManagerOptions,
  type DaemonHealth,
} from '../src/daemon.js';
import {
  daemonMain,
  parseDaemonArgs,
  structuredLogAdapter,
  type MainOutput,
} from '../src/main.js';

class OutputCapture implements MainOutput {
  readonly lines: string[] = [];
  readonly warnings: string[] = [];
  readonly errors: string[] = [];
  log(text?: string): void {
    this.lines.push(text ?? '');
  }
  warn(text?: string): void {
    this.warnings.push(text ?? '');
  }
  error(text?: string): void {
    this.errors.push(text ?? '');
  }
}

class FakeManager {
  started = false;
  stopped = false;
  readonly healthValue: DaemonHealth;
  receivedOptions: DaemonManagerOptions | null = null;

  constructor(healthValue: DaemonHealth = {
    running: true,
    startedAt: 1_735_100_000_000,
    pid: 4242,
    vaults: [],
  }) {
    this.healthValue = healthValue;
  }

  async start(): Promise<void> {
    this.started = true;
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.healthValue.running = false;
  }

  health(): DaemonHealth {
    return this.healthValue;
  }
}

describe('parseDaemonArgs', () => {
  it('parses run with --vault and --config', () => {
    expect(parseDaemonArgs(['run', '--vault', '/v/a', '--config', '/tmp/c.json'])).toEqual({
      action: 'run',
      vault: '/v/a',
      config: '/tmp/c.json',
      tail: 100,
    });
  });

  it('parses logs with -n', () => {
    expect(parseDaemonArgs(['logs', '-n', '20'])).toEqual({ action: 'logs', vault: undefined, config: undefined, tail: 20 });
  });

  it('rejects unknown actions, dangling flags, and bad tails', () => {
    expect(parseDaemonArgs([])).toMatchObject({ error: expect.stringMatching(/usage/) });
    expect(parseDaemonArgs(['dance'])).toMatchObject({ error: expect.stringMatching(/unknown action/) });
    expect(parseDaemonArgs(['run', '--vault'])).toMatchObject({ error: expect.stringMatching(/unexpected argument/) });
    expect(parseDaemonArgs(['logs', '-n', 'x'])).toMatchObject({ error: expect.stringMatching(/--tail/) });
  });
});

describe('structuredLogAdapter', () => {
  it('emits one JSON object per line with ts/level/msg', () => {
    const lines: string[] = [];
    const log = structuredLogAdapter((line) => lines.push(line), () => 1_735_100_000_000);
    log.info('vault session', '/vaults/a', 'live');
    log.error('boom', new Error('x'));
    const first = JSON.parse(lines[0]!) as Record<string, unknown>;
    expect(first).toMatchObject({
      ts: '2024-12-25T04:13:20.000Z',
      level: 'info',
      msg: 'vault session',
      details: ['/vaults/a', 'live'],
    });
    const second = JSON.parse(lines[1]!) as { level: string; details: unknown[] };
    expect(second.level).toBe('error');
    expect(JSON.stringify(second.details)).toContain('"message":"x"');
  });
});

describe('daemonMain', () => {
  it('run: wires config store + vault filter, starts, and stops gracefully on SIGTERM', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'vsa-main-run-'));
    const configStore = new ConfigStore({ configPath: join(configDir, 'config.json') });
    const output = new OutputCapture();
    const manager = new FakeManager();
    const signalListeners: Array<() => void> = [];

    const pending = daemonMain(['run', '--vault', '/v/a'], {
      configStore,
      output,
      createManager: (options) => {
        manager.receivedOptions = options;
        return manager as unknown as DaemonManager;
      },
      onSignal: (_signal, listener) => {
        signalListeners.push(listener);
      },
    });

    // Wait for both signal registrations, then deliver SIGTERM.
    const deadline = Date.now() + 5_000;
    while (signalListeners.length < 2 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(signalListeners).toHaveLength(2);
    signalListeners[1]!(); // SIGTERM

    const code = await pending;

    expect(code).toBe(0);
    expect(manager.started).toBe(true);
    expect(manager.stopped).toBe(true);
    expect(manager.receivedOptions).toMatchObject({
      configStore,
      vaultFilter: '/v/a',
      healthPath: daemonHealthPathFor(configStore),
    });
    expect(signalListeners).toHaveLength(2);

    // Structured JSON log lines reached stdout.
    const logged = output.lines.filter((line) => line.startsWith('{'));
    expect(logged.length).toBeGreaterThan(0);
    expect(JSON.parse(logged[0]!)).toHaveProperty('ts');
  });

  it('run: startup failure exits 2 with the error on stderr', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'vsa-main-fail-'));
    const output = new OutputCapture();
    const code = await daemonMain(['run'], {
      configStore: new ConfigStore({ configPath: join(configDir, 'config.json') }),
      output,
      createManager: () => {
        throw new Error('no vaults match');
      },
    });
    expect(code).toBe(2);
    expect(output.errors[0]).toMatch(/failed to start the daemon: no vaults match/);
  });

  it('install on linux shells out through the service backend', async () => {
    const calls: Array<{ command: string; args: string[] }> = [];
    const exec: Exec = async (command, args) => {
      calls.push({ command, args: [...args] });
      return { code: 0, stdout: '', stderr: '' };
    };
    const home = await mkdtemp(join(tmpdir(), 'vsa-main-install-'));
    const output = new OutputCapture();
    const code = await daemonMain(['install'], {
      platform: 'linux',
      output,
      service: { home, xdgConfigHome: join(home, 'xdg'), exec },
    });
    expect(code).toBe(0);
    expect(calls.map((call) => call.command)).toEqual(['systemctl', 'systemctl']);
    expect(output.lines.join('\n')).toMatch(/Installed systemd unit/);
  });

  it('install on Windows is REFUSED with the clear message (FR-43), no crash', async () => {
    const output = new OutputCapture();
    const code = await daemonMain(['install'], { platform: 'win32', output });
    expect(code).toBe(1);
    expect(output.errors[0]).toMatch(/service management is not available on this platform in v1/);
    expect(output.errors[0]).toMatch(/vsa daemon run/);
  });

  it('status renders the service line and per-vault snapshot lines', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'vsa-main-status-'));
    const configStore = new ConfigStore({ configPath: join(configDir, 'config.json') });
    // Pre-write a health snapshot where status expects it.
    await writeFile(
      daemonHealthPathFor(configStore),
      JSON.stringify({
        running: true,
        startedAt: 1_735_100_000_000,
        pid: 99,
        vaults: [
          {
            vault: '/srv/vaults/personal',
            name: 'personal',
            url: 'https://personal.example',
            state: 'live',
            lastSyncAt: 1_735_099_900_000,
            pending: 0,
            conflicts: 0,
          },
        ],
      }),
      'utf8',
    );
    const exec: Exec = async () => ({ code: 0, stdout: 'active\n', stderr: '' });
    const home = await mkdtemp(join(tmpdir(), 'vsa-main-status-home-'));
    // status() checks the unit file on disk: pre-install it.
    const unitDir = join(home, 'xdg', 'systemd', 'user');
    await mkdir(unitDir, { recursive: true });
    await writeFile(join(unitDir, 'vaultsyncforagents.service'), '[Unit]\n', 'utf8');
    const output = new OutputCapture();

    const code = await daemonMain(['status'], {
      platform: 'linux',
      configStore,
      output,
      service: { home, xdgConfigHome: join(home, 'xdg'), exec },
    });

    expect(code).toBe(0);
    const text = output.lines.join('\n');
    expect(text).toMatch(/service: running/);
    expect(text).toContain('personal  /srv/vaults/personal');
    expect(text).toMatch(/state: live/);
    expect(text).toMatch(/pending: 0\s+conflicts: 0/);
  });

  it('status on Windows degrades to the FR-43 hint instead of failing', async () => {
    const configDir = await mkdtemp(join(tmpdir(), 'vsa-main-win-'));
    const output = new OutputCapture();
    const code = await daemonMain(['status'], {
      platform: 'win32',
      configStore: new ConfigStore({ configPath: join(configDir, 'config.json') }),
      output,
    });
    expect(code).toBe(0);
    expect(output.lines.join('\n')).toMatch(/service: unavailable/);
  });

  it('usage errors exit 1', async () => {
    const output = new OutputCapture();
    expect(await daemonMain(['dance'], { output })).toBe(1);
    expect(output.errors[0]).toMatch(/unknown action/);
  });
});
