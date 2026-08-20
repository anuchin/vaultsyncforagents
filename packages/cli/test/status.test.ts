/**
 * `vsa status` (FR-52): per-vault report correctness, rendering, the
 * non-interactive/JSON contract, and failure modes (unreachable, rejected
 * token) that must NOT throw.
 */

import { describe, expect, it } from 'vitest';
import { runStatus, renderStatus } from '../src/commands/status.js';
import { makeRig, seedVault } from './helpers.js';

describe('runStatus', () => {
  it('reports a healthy linked vault with a real sync snapshot', async () => {
    const rig = await makeRig();
    await rig.storage.writeFile('/note.md', new TextEncoder().encode('content'));
    seedVault(rig);
    const previousNow = rig.runtime.now;
    void previousNow;

    const report = await runStatus(rig.runtime, rig.configStore.load().vaults);
    expect(report.vaults).toHaveLength(1);
    const vault = report.vaults[0]!;
    expect(vault.reachable).toBe(true);
    expect(vault.claimed).toBe(true);
    expect(vault.connected).toBe(true);
    expect(vault.devices).toEqual({ total: 2, online: 1, offline: 1, revoked: 0 });
    expect(vault.lastEdit).toMatchObject({ deviceName: 'MacBook', path: '/notes/plan.md' });
    expect(vault.attachments).toEqual({ count: 12, bytes: 4_500_000 });
    expect(vault.sync?.trackedFiles).toBeGreaterThan(0);
    expect(report.summary).toEqual({ connected: 1, total: 1 });

    // The snapshot pushed the local file through the in-memory server.
    expect(rig.server.snapshot().files.map((file) => file.path)).toContain('/note.md');
  });

  it('renders the human summary line "N vaults connected"', async () => {
    const rig = await makeRig();
    seedVault(rig);
    const report = await runStatus(rig.runtime, rig.configStore.load().vaults);
    renderStatus(report, rig.runtime);
    const text = rig.output.text();
    expect(text).toContain('connected: yes');
    expect(text).toContain('devices:   1 online, 1 offline');
    expect(text).toContain('last edit:');
    expect(text).toContain('/notes/plan.md');
    expect(text).toContain('attachments: 12');
    expect(text).toMatch(/1 vault connected/);
  });

  it('unreachable worker reports connected: false without throwing (scripting contract)', async () => {
    const rig = await makeRig({ fake: { unreachable: true } });
    seedVault(rig);
    const report = await runStatus(rig.runtime, rig.configStore.load().vaults);
    expect(report.vaults[0]!.connected).toBe(false);
    expect(report.vaults[0]!.reason).toMatch(/unreachable/);
    expect(report.summary).toEqual({ connected: 0, total: 1 });
    renderStatus(report, rig.runtime);
    expect(rig.output.text()).toContain('0/1 vaults connected');
  });

  it('rejected token (revoked) reports connected: false with a re-pair reason', async () => {
    const rig = await makeRig();
    seedVault(rig);
    rig.fake.state.acceptedTokens.clear();
    const report = await runStatus(rig.runtime, rig.configStore.load().vaults);
    expect(report.vaults[0]!.connected).toBe(false);
    expect(report.vaults[0]!.reason).toMatch(/re-pair/);
  });

  it('unclaimed worker reports the claim gap', async () => {
    const rig = await makeRig({ fake: { claimed: false } });
    seedVault(rig);
    const report = await runStatus(rig.runtime, rig.configStore.load().vaults);
    expect(report.vaults[0]!.reason).toMatch(/not claimed/);
  });

  it('missing token reports it and stays exit-code-0 shaped', async () => {
    const rig = await makeRig();
    seedVault(rig);
    rig.configStore.removeVault(rig.vaultDir);
    seedVault(rig); // entry back, but no token
    rig.configStore.setToken(rig.vaultDir, 'tok-dev-1');
    rig.configStore.removeVault(rig.vaultDir);
    // Re-add the entry with no secret present.
    rig.configStore.upsertVault({ id: rig.vaultDir, name: 'personal', url: 'https://vault.example', deviceId: 'dev-1' });
    const report = await runStatus(rig.runtime, rig.configStore.load().vaults);
    expect(report.vaults[0]!.reason).toMatch(/no device token/);
  });

  it('JSON output is a faithful serialization of the report', async () => {
    const rig = await makeRig();
    seedVault(rig);
    const report = await runStatus(rig.runtime, rig.configStore.load().vaults);
    const parsed = JSON.parse(JSON.stringify(report)) as typeof report;
    expect(parsed.summary.connected).toBe(1);
    expect(parsed.vaults[0]!.devices?.total).toBe(2);
  });
});
