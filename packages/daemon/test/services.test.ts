/**
 * systemd/launchd unit generation (template content), command invocation via
 * an injectable fake exec, error mapping (linger hint), and FR-43 platform
 * gating (Windows refusal). Nothing real is executed; nothing writes outside
 * temp dirs.
 */

import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Exec, ExecResult } from '../src/services/service.js';
import {
  generateLaunchdPlist,
  launchdLogPaths,
  launchdPlistPath,
  LaunchdService,
  LAUNCHD_LABEL,
} from '../src/services/launchd.js';
import {
  generateSystemdUnit,
  SystemdService,
  SYSTEMD_SERVICE_NAME,
  SYSTEMD_UNIT_FILE,
  systemdUnitDir,
} from '../src/services/systemd.js';
import {
  selectServiceBackend,
  serviceKindFor,
  serviceLogsFor,
  serviceStatusFor,
} from '../src/services/index.js';

class FakeExec {
  readonly calls: Array<{ command: string; args: string[] }> = [];
  private results: ExecResult[] = [];
  private readonly defaultResult: ExecResult;

  constructor(defaultResult: ExecResult = { code: 0, stdout: '', stderr: '' }) {
    this.defaultResult = defaultResult;
  }

  queue(result: ExecResult): this {
    this.results.push(result);
    return this;
  }

  readonly exec: Exec = async (command, args) => {
    this.calls.push({ command, args: [...args] });
    return this.results.shift() ?? this.defaultResult;
  };
}

const NODE = '/usr/bin/node';
const ENTRY = '/opt/vsa/bin/vsa-daemon.js';

describe('systemd unit generation', () => {
  it('renders a user unit with node ExecStart, Restart=always, RestartSec=5', () => {
    const unit = generateSystemdUnit({ nodePath: NODE, daemonEntry: ENTRY });
    expect(unit).toContain('Description=VaultSync for Agents daemon');
    expect(unit).toContain(`ExecStart="${NODE}" "${ENTRY}" run`);
    expect(unit).toContain('Restart=always');
    expect(unit).toContain('RestartSec=5');
    expect(unit).toContain('WantedBy=default.target');
    expect(unit).toContain('After=network-online.target');
    expect(unit).not.toContain('[Install]\nWantedBy=multi-user.target');
  });

  it('honors a custom RestartSec', () => {
    expect(generateSystemdUnit({ nodePath: NODE, daemonEntry: ENTRY, restartSec: 10 })).toContain(
      'RestartSec=10',
    );
  });

  it('unit dir prefers $XDG_CONFIG_HOME', () => {
    const posix = (p: string): string => p.replaceAll('\\', '/');
    // Explicit '' counts as unset → home fallback. (Do NOT assert the home
    // branch for `undefined`: the impl then reads process.env.XDG_CONFIG_HOME,
    // which GitHub's ubuntu runners export — /home/runner/.config — and env
    // legitimately wins there.)
    expect(posix(systemdUnitDir('/home/jitu', ''))).toBe('/home/jitu/.config/systemd/user');
    expect(posix(systemdUnitDir('/home/jitu', '/home/jitu/xdg'))).toBe('/home/jitu/xdg/systemd/user');
  });
});

describe('systemd backend via fake exec', () => {
  it('install writes the unit and runs daemon-reload + enable', async () => {
    const home = await mkdtemp(join(tmpdir(), 'vsa-systemd-home-'));
    const fake = new FakeExec();
    const service = new SystemdService({
      home,
      xdgConfigHome: join(home, 'xdg'),
      nodePath: NODE,
      daemonEntry: ENTRY,
      exec: fake.exec,
      platform: 'linux',
    });

    await service.install();

    // The exact bytes on disk equal unitContent.
    const written = await readFile(service.unitPath, 'utf8');
    expect(written).toBe(service.unitContent);
    expect(written).toContain(`ExecStart="${NODE}" "${ENTRY}" run`);

    expect(fake.calls).toEqual([
      { command: 'systemctl', args: ['--user', 'daemon-reload'] },
      { command: 'systemctl', args: ['--user', 'enable', SYSTEMD_UNIT_FILE] },
    ]);
  });

  it('start/stop invoke systemctl --user with the unit', async () => {
    const fake = new FakeExec();
    const service = new SystemdService({ home: '/home/x', nodePath: NODE, daemonEntry: ENTRY, exec: fake.exec, platform: 'linux' });
    await service.start();
    await service.stop();
    expect(fake.calls).toEqual([
      { command: 'systemctl', args: ['--user', 'start', SYSTEMD_UNIT_FILE] },
      { command: 'systemctl', args: ['--user', 'stop', SYSTEMD_UNIT_FILE] },
    ]);
  });

  it('status maps is-enabled/is-active exit codes; missing unit reports not installed without exec', async () => {
    const fake = new FakeExec();
    fake.queue({ code: 0, stdout: 'enabled\n', stderr: '' });
    fake.queue({ code: 0, stdout: 'active\n', stderr: '' });
    const home = await mkdtemp(join(tmpdir(), 'vsa-systemd-status-'));
    const service = new SystemdService({
      home,
      xdgConfigHome: join(home, 'xdg'),
      exec: fake.exec,
      platform: 'linux',
    });
    await service.install(); // writes the unit file
    fake.calls.length = 0;
    fake.queue({ code: 0, stdout: 'enabled\n', stderr: '' });
    fake.queue({ code: 0, stdout: 'active\n', stderr: '' });

    const status = await service.status();
    expect(status).toMatchObject({ backend: 'systemd', installed: true, active: true });
    expect(status.detail).toContain('active');
    expect(fake.calls).toEqual([
      { command: 'systemctl', args: ['--user', 'is-enabled', SYSTEMD_UNIT_FILE] },
      { command: 'systemctl', args: ['--user', 'is-active', SYSTEMD_UNIT_FILE] },
    ]);

    const bare = new SystemdService({ home, xdgConfigHome: join(home, 'elsewhere'), exec: fake.exec, platform: 'linux' });
    const missing = await bare.status();
    expect(missing.installed).toBe(false);
    expect(missing.active).toBeNull();
  });

  it('logs tails journalctl --user -u vaultsyncforagents', async () => {
    const fake = new FakeExec({ code: 0, stdout: '{"level":"info"}\n', stderr: '' });
    const service = new SystemdService({ home: '/home/x', exec: fake.exec, platform: 'linux' });
    expect(await service.logs(50)).toContain('"level":"info"');
    expect(fake.calls[0]).toEqual({
      command: 'journalctl',
      args: ['--user', '--unit', SYSTEMD_SERVICE_NAME, '--no-pager', '-o', 'cat', '-n', '50'],
    });
  });

  it('maps a user-bus failure to the linger hint', async () => {
    const fake = new FakeExec();
    fake.queue({ code: 1, stdout: '', stderr: 'Failed to connect to bus: No medium found' });
    const service = new SystemdService({ home: '/home/x', exec: fake.exec, platform: 'linux' });
    await expect(service.start()).rejects.toThrow(/enable-linger/);
  });

  it('uninstall stops, disables, removes the unit, reloads', async () => {
    const home = await mkdtemp(join(tmpdir(), 'vsa-systemd-un-'));
    const fake = new FakeExec();
    const service = new SystemdService({
      home,
      xdgConfigHome: join(home, 'xdg'),
      exec: fake.exec,
      platform: 'linux',
    });
    await service.install();
    fake.calls.length = 0;

    await service.uninstall();
    expect(fake.calls.map((call) => call.args)).toEqual([
      ['--user', 'stop', SYSTEMD_UNIT_FILE],
      ['--user', 'disable', SYSTEMD_UNIT_FILE],
      ['--user', 'daemon-reload'],
    ]);
    await expect(readFile(service.unitPath, 'utf8')).rejects.toThrow();
  });
});

describe('launchd plist generation', () => {
  it('renders a user agent with ProgramArguments [node, entry, run], RunAtLoad, KeepAlive', () => {
    const { out, err } = launchdLogPaths('/Users/jitu');
    const plist = generateLaunchdPlist({ nodePath: NODE, daemonEntry: ENTRY, outLog: out, errLog: err });
    expect(plist).toContain('<!DOCTYPE plist');
    expect(plist).toContain(`<key>Label</key>`);
    expect(plist).toContain(`<string>${LAUNCHD_LABEL}</string>`);
    expect(plist).toContain(`<string>${NODE}</string>`);
    expect(plist).toContain(`<string>${ENTRY}</string>`);
    expect(plist).toContain('<string>run</string>');
    expect(plist).toContain('<key>RunAtLoad</key>');
    expect(plist).toContain('<key>KeepAlive</key>');
    expect(plist).toContain(`<string>${out}</string>`);
    expect(plist).toContain(`<string>${err}</string>`);
    expect(launchdPlistPath('/Users/jitu').replaceAll('\\', '/')).toBe(
      '/Users/jitu/Library/LaunchAgents/com.vaultsyncforagents.plist',
    );
  });

  it('XML-escapes paths', () => {
    const plist = generateLaunchdPlist({
      nodePath: NODE,
      daemonEntry: '/opt/a&b<c>/vsa-daemon.js',
      outLog: '/o.log',
      errLog: '/e.log',
    });
    expect(plist).toContain('/opt/a&amp;b&lt;c&gt;/vsa-daemon.js');
  });
});

describe('launchd backend via fake exec', () => {
  it('install writes the plist and loads it (replacing a previous load)', async () => {
    const home = await mkdtemp(join(tmpdir(), 'vsa-launchd-home-'));
    const fake = new FakeExec();
    const service = new LaunchdService({ home, nodePath: NODE, daemonEntry: ENTRY, exec: fake.exec, platform: 'darwin' });

    await service.install();
    expect((await readFile(service.unitPath, 'utf8')).startsWith('<?xml')).toBe(true);
    expect(fake.calls.map((call) => call.args[0])).toEqual(['unload', 'load']);
    expect(fake.calls[1]).toEqual({ command: 'launchctl', args: ['load', '-w', service.unitPath] });
  });

  it('status parses `launchctl list` PID output', async () => {
    const home = await mkdtemp(join(tmpdir(), 'vsa-launchd-status-'));
    const fake = new FakeExec();
    const service = new LaunchdService({ home, nodePath: NODE, daemonEntry: ENTRY, exec: fake.exec, platform: 'darwin' });
    await service.install();
    fake.calls.length = 0;

    fake.queue({ code: 0, stdout: '"12345\t0\tcom.vaultsyncforagents"\n', stderr: '' });
    expect(await service.status()).toMatchObject({ installed: true, active: true, backend: 'launchd' });

    fake.queue({ code: 0, stdout: '"-\t78\tcom.vaultsyncforagents"\n', stderr: '' });
    expect(await service.status()).toMatchObject({ active: false });

    fake.queue({ code: 1, stdout: '', stderr: 'Could not find job' });
    expect(await service.status()).toMatchObject({ installed: true, active: false });
  });

  it('stop/unload and uninstall remove the plist', async () => {
    const home = await mkdtemp(join(tmpdir(), 'vsa-launchd-un-'));
    const fake = new FakeExec();
    const service = new LaunchdService({ home, nodePath: NODE, daemonEntry: ENTRY, exec: fake.exec, platform: 'darwin' });
    await service.install();

    await service.stop();
    expect(fake.calls.at(-1)).toEqual({ command: 'launchctl', args: ['unload', '-w', service.unitPath] });

    await service.uninstall();
    await expect(readFile(service.unitPath, 'utf8')).rejects.toThrow();
  });

  it('logs tails the launchd out/err log files', async () => {
    const home = await mkdtemp(join(tmpdir(), 'vsa-launchd-logs-'));
    const { writeFile, mkdir } = await import('node:fs/promises');
    const logs = launchdLogPaths(home);
    await mkdir(join(home, 'Library', 'Logs', 'vaultsyncforagents'), { recursive: true });
    await writeFile(logs.out, 'line1\nline2\n', 'utf8');
    const service = new LaunchdService({ home, exec: new FakeExec().exec, platform: 'darwin' });
    const text = await service.logs(1);
    expect(text).toBe('line2');
  });
});

describe('platform gating (FR-43)', () => {
  it('selects systemd on linux, launchd on darwin', () => {
    expect(serviceKindFor('linux')).toBe('systemd');
    expect(serviceKindFor('darwin')).toBe('launchd');
    expect(serviceKindFor('win32')).toBe('unsupported');
    expect(serviceKindFor('freebsd')).toBe('unsupported');
  });

  it('REFUSES service management on Windows with the clear FR-43 message', async () => {
    const fake = new FakeExec();
    const service = new SystemdService({ home: '/home/x', exec: fake.exec, platform: 'win32' });
    for (const action of ['install', 'uninstall', 'start', 'stop'] as const) {
      await expect(service[action]()).rejects.toThrow(/not available on this platform in v1/);
    }
    expect(fake.calls).toHaveLength(0); // refused BEFORE shelling out

    const launchd = new LaunchdService({ home: '/Users/x', exec: fake.exec, platform: 'win32' });
    await expect(launchd.install()).rejects.toThrow(/Windows service support later/);
    // selectServiceBackend refuses synchronously.
    expect(() => selectServiceBackend({ platform: 'win32' })).toThrow(
      /service management is not available/,
    );
  });

  it('status/logs degrade to data instead of throwing on unsupported platforms', async () => {
    const status = await serviceStatusFor({ platform: 'win32' });
    expect(status.backend).toBe('none');
    expect(status.installed).toBe(false);
    expect(status.detail).toMatch(/run `vsa daemon run` in a terminal/);

    const logs = await serviceLogsFor({ platform: 'win32' }, 10);
    expect(logs).toMatch(/vsa daemon run/);
  });
});
