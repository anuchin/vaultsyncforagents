/**
 * `vsa devices` / `vsa devices revoke` / `vsa logs` (FR-53, FR-57).
 */

import { describe, expect, it } from 'vitest';
import { runDevices, renderDevices, runRevoke } from '../src/commands/devices.js';
import { runLogs, renderLogs } from '../src/commands/logs.js';
import { makeRig, seedVault } from './helpers.js';

describe('runDevices', () => {
  it('lists devices with presence and revoked markers', async () => {
    const rig = await makeRig();
    seedVault(rig);
    const reports = await runDevices(rig.runtime, rig.configStore.load().vaults);
    expect(reports).toHaveLength(1);
    expect(reports[0]!.devices.map((device) => device.name)).toEqual(['MacBook', 'Pixel']);
    renderDevices(reports, rig.runtime);
    const text = rig.output.text();
    expect(text).toContain('MacBook');
    expect(text).toContain('online');
    expect(text).toContain('Pixel');
    expect(text).toContain('never');
  });

  it('marks revoked devices', async () => {
    const rig = await makeRig();
    seedVault(rig);
    rig.fake.state.statusDoc.devices[1]!.revoked = true;
    const reports = await runDevices(rig.runtime, rig.configStore.load().vaults);
    renderDevices(reports, rig.runtime);
    expect(rig.output.text()).toContain('[revoked]');
  });

  it('surfaces auth errors per vault instead of throwing', async () => {
    const rig = await makeRig();
    seedVault(rig);
    rig.fake.state.acceptedTokens.clear();
    const reports = await runDevices(rig.runtime, rig.configStore.load().vaults);
    expect(reports[0]!.error).toMatch(/token.*rejected|re-pair/i);
  });
});

describe('runRevoke', () => {
  it('revokes by name using the admin session cookie', async () => {
    const rig = await makeRig();
    seedVault(rig);
    const vault = rig.configStore.load().vaults[0]!;

    const result = await runRevoke(rig.runtime, vault, {
      nameOrId: 'pixel',
      passphrase: 'correct-horse',
      yes: true,
    });
    expect(result).toEqual({ deviceName: 'Pixel', deviceId: 'dev-phone' });

    const login = rig.fake.calls.find((call) => call.path === '/admin/login');
    const revoke = rig.fake.calls.find((call) => call.path === '/admin/revoke');
    expect(login).toBeDefined();
    expect(revoke).toBeDefined();
  });

  it('revokes by device id too (case-insensitive)', async () => {
    const rig = await makeRig();
    seedVault(rig);
    const result = await runRevoke(rig.runtime, rig.configStore.load().vaults[0]!, {
      nameOrId: 'DEV-DESKTOP',
      passphrase: 'correct-horse',
      yes: true,
    });
    expect(result.deviceName).toBe('MacBook');
  });

  it('wrong passphrase is rejected cleanly', async () => {
    const rig = await makeRig();
    seedVault(rig);
    await expect(
      runRevoke(rig.runtime, rig.configStore.load().vaults[0]!, {
        nameOrId: 'Pixel',
        passphrase: 'nope',
        yes: true,
      }),
    ).rejects.toThrow(/passphrase rejected/i);
  });

  it('unknown device name lists the available devices', async () => {
    const rig = await makeRig();
    seedVault(rig);
    await expect(
      runRevoke(rig.runtime, rig.configStore.load().vaults[0]!, {
        nameOrId: 'typo-device',
        passphrase: 'correct-horse',
        yes: true,
      }),
    ).rejects.toThrow(/MacBook/);
  });

  it('prompts for the passphrase interactively; cancel path is a clean error', async () => {
    const rig = await makeRig();
    seedVault(rig);
    rig.prompts.script(false); // confirm → no
    await expect(
      runRevoke(rig.runtime, rig.configStore.load().vaults[0]!, { nameOrId: 'Pixel' }),
    ).rejects.toThrow(/cancelled/i);
  });
});

describe('runLogs', () => {
  it('formats the recent event feed with device names', async () => {
    const rig = await makeRig();
    seedVault(rig);
    const reports = await runLogs(rig.runtime, rig.configStore.load().vaults);
    expect(reports[0]!.events).toHaveLength(2);
    renderLogs(reports, rig.runtime);
    const text = rig.output.text();
    expect(text).toContain('change');
    expect(text).toContain('MacBook');
    expect(text).toContain('/notes/plan.md');
    expect(text).toContain('seq=7');
  });

  it('handles vaults with no events yet', async () => {
    const rig = await makeRig();
    seedVault(rig);
    rig.fake.state.statusDoc.recentEvents = [];
    const reports = await runLogs(rig.runtime, rig.configStore.load().vaults);
    renderLogs(reports, rig.runtime);
    expect(rig.output.text()).toContain('no events yet');
  });
});
