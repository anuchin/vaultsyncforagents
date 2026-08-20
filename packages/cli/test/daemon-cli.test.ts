/**
 * `vsa daemon …` command wiring (FR-55): the commander tree dispatches to
 * `runDaemonCommand` over the injectable `DaemonControl` seam — service
 * actions, `status` rendering from the health snapshot, `run` foreground
 * lifecycle with the `--vault` global, JSON output, and error mapping
 * (ServiceError → CommandError). No real service manager ever runs.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  ServiceError,
  type DaemonHealth,
  type DaemonManagerOptions,
  type ServiceStatus,
} from '@vsa/daemon';
import { buildProgram } from '../src/cli.js';
import { renderDaemonResult } from '../src/commands/daemon.js';
import type { DaemonManagerLike } from '../src/commands/daemon.js';
import { CommandError } from '../src/runtime.js';
import type { VsRuntime } from '../src/runtime.js';
import { makeRig, OutputCapture } from './helpers.js';

const HEALTH: DaemonHealth = {
  running: true,
  startedAt: 1_735_100_000_000,
  pid: 4242,
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
    {
      vault: '/srv/vaults/work',
      name: 'work',
      url: 'https://work.example',
      state: 'disconnected',
      lastSyncAt: null,
      pending: 3,
      conflicts: 1,
      error: 'connection closed (code 1006)',
    },
  ],
};

const SERVICE_STATUS: ServiceStatus = {
  backend: 'systemd',
  installed: true,
  active: true,
  detail: 'vaultsyncforagents.service: active',
};

class FakeControl {
  readonly calls: string[] = [];
  installResult: { backend: string; unitPath: string } = {
    backend: 'systemd',
    unitPath: '/home/jitu/.config/systemd/user/vaultsyncforagents.service',
  };
  statusResult: ServiceStatus = SERVICE_STATUS;
  healthResult: DaemonHealth | null = HEALTH;
  logsText = 'line1\nline2';
  error: Error | null = null;
  receivedManagerOptions: DaemonManagerOptions | null = null;

  private failIfScripted(): void {
    if (this.error !== null) throw this.error;
  }

  async install(): Promise<{ backend: string; unitPath: string }> {
    this.calls.push('install');
    this.failIfScripted();
    return this.installResult;
  }

  async uninstall(): Promise<{ backend: string; unitPath: string }> {
    this.calls.push('uninstall');
    this.failIfScripted();
    return this.installResult;
  }

  async start(): Promise<{ backend: string }> {
    this.calls.push('start');
    this.failIfScripted();
    return { backend: 'systemd' };
  }

  async stop(): Promise<{ backend: string }> {
    this.calls.push('stop');
    this.failIfScripted();
    return { backend: 'systemd' };
  }

  async status(): Promise<ServiceStatus> {
    this.calls.push('status');
    return this.statusResult;
  }

  async logs(_service: unknown, tail: number): Promise<string> {
    this.calls.push(`logs:${tail}`);
    return this.logsText;
  }

  createManager(options: DaemonManagerOptions): DaemonManagerLike {
    this.calls.push('createManager');
    this.receivedManagerOptions = options;
    return {
      start: async () => {},
      stop: async () => {
        this.calls.push('managerStop');
      },
      health: () => ({ ...HEALTH, running: false }),
    };
  }

  entryPath: () => string = () => '/opt/vsa/bin/vsa-daemon.js';
  nodePath: () => string = () => '/usr/bin/node';
  healthSnapshotPath: (configPath: string) => string = (configPath) =>
    `${configPath}.dir/daemon-health.json`;
  readHealthSnapshot: (path: string) => DaemonHealth | null = () => this.healthResult;
}

async function run(programArgs: string[], control: FakeControl): Promise<OutputCapture> {
  const rig = await makeRig();
  const runtime: VsRuntime = { ...rig.runtime, daemonControl: control };
  const output = new OutputCapture();
  runtime.output = output;
  await buildProgram(runtime).parseAsync(programArgs, { from: 'user' });
  return output;
}

describe('vsa daemon <service-action>', () => {
  it('install prints the unit path and follow-up (no prompts)', async () => {
    const control = new FakeControl();
    const output = await run(['daemon', 'install'], control);
    expect(control.calls).toEqual(['install']);
    expect(output.text()).toContain(
      'Installed the systemd user service: /home/jitu/.config/systemd/user/vaultsyncforagents.service',
    );
    expect(output.text()).toContain('vsa daemon start|stop');
  });

  it('uninstall/start/stop dispatch through the control seam', async () => {
    for (const action of ['uninstall', 'start', 'stop'] as const) {
      const control = new FakeControl();
      await run(['daemon', action], control);
      expect(control.calls).toEqual([action]);
    }
  });

  it('maps ServiceError failures to CommandError (message includes the action)', async () => {
    const control = new FakeControl();
    control.error = new ServiceError('could not reach the systemd user bus');
    await expect(run(['daemon', 'start'], control)).rejects.toThrow(CommandError);
    await expect(run(['daemon', 'stop'], control)).rejects.toThrow(
      /vsa daemon stop.*systemd user bus/,
    );
  });

  it('JSON output serializes the service result', async () => {
    const control = new FakeControl();
    const output = await run(['--json', 'daemon', 'install'], control);
    const parsed = JSON.parse(output.lines[0]!) as { kind: string; backend: string };
    expect(parsed).toEqual({
      kind: 'install',
      backend: 'systemd',
      unitPath: '/home/jitu/.config/systemd/user/vaultsyncforagents.service',
    });
  });
});

describe('vsa daemon status', () => {
  it('renders the service line and one line set per vault from the health snapshot', async () => {
    const control = new FakeControl();
    const output = await run(['daemon', 'status'], control);
    const text = output.text();
    expect(control.calls).toEqual(['status']);
    expect(text).toContain('service: running');
    expect(text).toContain('daemon: running (pid 4242');
    expect(text).toContain('personal  /srv/vaults/personal');
    expect(text).toContain('state: live');
    expect(text).toContain('work  /srv/vaults/work');
    expect(text).toMatch(/state: disconnected/);
    expect(text).toContain('error: connection closed (code 1006)');
  });

  it('explains when no snapshot exists (not running) instead of failing', async () => {
    const control = new FakeControl();
    control.healthResult = null;
    control.statusResult = { backend: 'systemd', installed: false, active: null, detail: 'unit not found' };
    const output = await run(['daemon', 'status'], control);
    const text = output.text();
    expect(text).toContain('service: not installed');
    expect(text).toContain('no daemon health snapshot found');
    expect(text).toContain('`vsa daemon run`');
  });

  it('shows the unsupported-platform hint on Windows-shaped status', async () => {
    const control = new FakeControl();
    control.statusResult = {
      backend: 'none',
      installed: false,
      active: null,
      detail: 'service management is not available on this platform in v1 (FR-43 …)',
    };
    control.healthResult = null;
    const output = await run(['daemon', 'status'], control);
    expect(output.text()).toMatch(/service: unavailable/);
  });

  it('JSON output carries service + health verbatim', async () => {
    const control = new FakeControl();
    const output = await run(['--json', 'daemon', 'status'], control);
    const parsed = JSON.parse(output.lines[0]!) as { kind: string; health: DaemonHealth };
    expect(parsed.kind).toBe('status');
    expect(parsed.health?.vaults).toHaveLength(2);
  });
});

describe('vsa daemon logs', () => {
  it('tails through the control seam with -n', async () => {
    const control = new FakeControl();
    const output = await run(['daemon', 'logs', '-n', '20'], control);
    expect(control.calls).toEqual(['logs:20']);
    expect(output.text()).toBe('line1\nline2');
  });
  it('defaults to 100 lines', async () => {
    const control = new FakeControl();
    await run(['daemon', 'logs'], control);
    expect(control.calls).toEqual(['logs:100']);
  });
});

describe('vsa daemon run', () => {
  it('creates the manager with the config store, --vault filter, and health path; stops on SIGINT', async () => {
    const control = new FakeControl();
    const rig = await makeRig();
    const output = new OutputCapture();
    const runtime: VsRuntime = { ...rig.runtime, daemonControl: control };
    runtime.output = output;

    const onceSpy = vi.spyOn(process, 'once');
    try {
      const pending = buildProgram(runtime).parseAsync(
        ['--vault', '/srv/vaults/personal', 'daemon', 'run'],
        { from: 'user' },
      );
      // Wait for both signal registrations, then deliver SIGINT (graceful).
      const deadline = Date.now() + 5_000;
      while (onceSpy.mock.calls.length < 2 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(onceSpy.mock.calls.map(([signal]) => signal)).toEqual(['SIGINT', 'SIGTERM']);
      onceSpy.mock.calls[0]![1]();
      await pending;
    } finally {
      onceSpy.mockRestore();
    }

    expect(control.calls).toEqual(['createManager', 'managerStop']);
    expect(control.receivedManagerOptions).toMatchObject({
      vaultFilter: '/srv/vaults/personal',
      healthPath: expect.stringContaining('daemon-health.json'),
    });
    // The config store is the SAME one the CLI reads vaults from.
    expect((control.receivedManagerOptions as { configStore: unknown }).configStore).toBe(
      rig.runtime.configStore,
    );
    expect(output.text()).toContain('Daemon stopped gracefully.');
  });

  it('startup failures become CommandError', async () => {
    const control = new FakeControl();
    control.createManager = () => {
      throw new Error('no linked vault matches "/x"');
    };
    await expect(run(['daemon', 'run'], control)).rejects.toThrow(
      /failed to start the daemon: no linked vault matches/,
    );
  });
});

describe('renderDaemonResult', () => {
  it('run rendering lists the final per-vault states', async () => {
    const control = new FakeControl();
    void control;
    const rig = await makeRig();
    const output = new OutputCapture();
    rig.runtime.output = output;
    renderDaemonResult({ kind: 'run', health: { ...HEALTH, running: false } }, rig.runtime);
    expect(output.text()).toContain('Daemon stopped gracefully.');
    expect(output.text()).toContain('personal  /srv/vaults/personal');
  });
});
