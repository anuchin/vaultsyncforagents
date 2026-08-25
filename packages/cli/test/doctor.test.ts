/**
 * `vsa doctor` (FR-56): check outcomes, clock-skew warning threshold, hints
 * (claim, re-pair, one-client rule), and the healthy/unhealthy verdict.
 */

import { describe, expect, it } from 'vitest';
import { writeDeviceMarker } from '@vsa/node-runtime';
import { LOCAL_INDEX_STATE_PATH } from '@vsa/core';
import { runDoctor, renderDoctor } from '../src/commands/doctor.js';
import { makeRig, seedVault } from './helpers.js';

describe('runDoctor', () => {
  it('a healthy linked vault passes every check', async () => {
    const rig = await makeRig();
    seedVault(rig);
    const reports = await runDoctor(rig.runtime, rig.configStore.load().vaults);
    expect(reports).toHaveLength(1);
    const report = reports[0]!;
    expect(report.healthy).toBe(true);
    // The full ordered list (local checks trail the remote ones):
    // disk space, watcher capacity, and local state are appended after the
    // one-client rule per the header comment's numbering.
    expect(report.checks.map((check) => check.name)).toEqual([
      'reachable',
      'claimed',
      'server version',
      'clock skew',
      'token',
      'storage',
      'state dir owner',
      'disk space',
      'watcher capacity',
      'local state',
    ]);
    const byName = Object.fromEntries(report.checks.map((check) => [check.name, check.status]));
    expect(byName['reachable']).toBe('ok');
    expect(byName['claimed']).toBe('ok');
    expect(byName['token']).toBe('ok');
    expect(byName['clock skew']).toBe('ok');
    expect(byName['server version']).toBe('ok');
    // The hello roundtrip (check 5) persists the index, so by the time the
    // local-state check runs it exists and parses.
    const localState = report.checks.find((check) => check.name === 'local state')!;
    expect(localState.status).toBe('ok');
    expect(localState.detail).toContain('persisted index parses');
    // The temp vault lives on a filesystem with plenty of free space.
    expect(report.checks.find((check) => check.name === 'disk space')?.status).toBe('ok');
    // inotify has no equivalent off Linux: 'skip' on Windows/macOS, 'ok' on
    // Linux (a one-directory temp vault is nowhere near the watch budget).
    expect(['ok', 'skip']).toContain(byName['watcher capacity']);
    expect(report.hints).toEqual([]);
  });

  it('unreachable worker fails with the reason', async () => {
    const rig = await makeRig({ fake: { unreachable: true } });
    seedVault(rig);
    const report = (await runDoctor(rig.runtime, rig.configStore.load().vaults))[0]!;
    expect(report.healthy).toBe(false);
    expect(report.checks.find((check) => check.name === 'reachable')?.status).toBe('fail');
    // No hello roundtrip ran, so the fresh temp vault has no persisted index
    // yet — that is 'ok', not a failure (first sync creates it).
    const localState = report.checks.find((check) => check.name === 'local state')!;
    expect(localState.status).toBe('ok');
    expect(localState.detail).toContain('no persisted index yet');
  });

  it('a corrupt persisted index fails local state and hints the quarantine resync', async () => {
    // The sync probe (a connect) would quarantine and rewrite a corrupt file,
    // so this rig keeps the worker unreachable — the local-state check then
    // parses the corrupt bytes itself, which is the crash it exists to name.
    const rig = await makeRig({ fake: { unreachable: true } });
    seedVault(rig);
    await rig.storage.writeFile(LOCAL_INDEX_STATE_PATH, new TextEncoder().encode('@@@ not json @@@'));
    const report = (await runDoctor(rig.runtime, rig.configStore.load().vaults))[0]!;
    const localState = report.checks.find((check) => check.name === 'local state')!;
    expect(localState.status).toBe('fail');
    expect(localState.detail).toMatch(/corrupt/);
    expect(report.healthy).toBe(false);
    expect(report.hints.join(' ')).toMatch(/quarantine the corrupt state file/i);
  });

  it('unclaimed worker fails and hints the claim flow', async () => {
    const rig = await makeRig({ fake: { claimed: false } });
    seedVault(rig);
    const report = (await runDoctor(rig.runtime, rig.configStore.load().vaults))[0]!;
    expect(report.healthy).toBe(false);
    expect(report.checks.find((check) => check.name === 'claimed')?.status).toBe('fail');
    expect(report.hints.join(' ')).toMatch(/claim/i);
  });

  it('clock skew over 60s is a warning, not a failure', async () => {
    const rig = await makeRig({ fake: { skewSeconds: 120 } });
    seedVault(rig);
    const report = (await runDoctor(rig.runtime, rig.configStore.load().vaults))[0]!;
    const skew = report.checks.find((check) => check.name === 'clock skew')!;
    expect(skew.status).toBe('warn');
    expect(skew.detail).toMatch(/-120s|120s/);
    expect(report.healthy).toBe(true); // warnings do not fail doctor
  });

  it('clock skew under 60s is fine', async () => {
    const rig = await makeRig({ fake: { skewSeconds: 10 } });
    seedVault(rig);
    const report = (await runDoctor(rig.runtime, rig.configStore.load().vaults))[0]!;
    expect(report.checks.find((check) => check.name === 'clock skew')?.status).toBe('ok');
    expect(report.healthy).toBe(true);
  });

  it('a newer server version warns (update the client) without failing doctor', async () => {
    const rig = await makeRig({ fake: { serverVersion: '99.0.0' } });
    seedVault(rig);
    const report = (await runDoctor(rig.runtime, rig.configStore.load().vaults))[0]!;
    const version = report.checks.find((check) => check.name === 'server version')!;
    expect(version.status).toBe('warn');
    expect(version.detail).toContain('99.0.0');
    expect(version.detail).toContain('update the client');
    expect(report.healthy).toBe(true); // warnings never fail doctor
  });

  it('a server below the minimum supported version fails doctor', async () => {
    const rig = await makeRig({ fake: { serverVersion: '0.0.9' } });
    seedVault(rig);
    const report = (await runDoctor(rig.runtime, rig.configStore.load().vaults))[0]!;
    const version = report.checks.find((check) => check.name === 'server version')!;
    expect(version.status).toBe('fail');
    expect(version.detail).toContain('older than the minimum supported');
    expect(version.detail).toContain('docs/UPGRADING.md');
    expect(report.healthy).toBe(false);
  });

  it('a legacy worker (no version reported) warns with the upgrade pointer', async () => {
    const rig = await makeRig({ fake: { serverVersion: null } });
    seedVault(rig);
    const report = (await runDoctor(rig.runtime, rig.configStore.load().vaults))[0]!;
    const version = report.checks.find((check) => check.name === 'server version')!;
    expect(version.status).toBe('warn');
    expect(version.detail).toMatch(/predates version reporting/);
    expect(report.healthy).toBe(true);
  });

  it('an unparseable server version warns (compatibility unknown) without failing doctor', async () => {
    // Wiring-level: /health's raw field reaches the shared compat policy —
    // a two-part version is not semver, and the verdict rides the check.
    const rig = await makeRig({ fake: { serverVersion: '0.2' } });
    seedVault(rig);
    const report = (await runDoctor(rig.runtime, rig.configStore.load().vaults))[0]!;
    const version = report.checks.find((check) => check.name === 'server version')!;
    expect(version.status).toBe('warn');
    expect(version.detail).toContain('"0.2"');
    expect(version.detail).toContain('not semver');
    expect(report.healthy).toBe(true); // warnings never fail doctor
  });

  it('an unreachable worker skips the version check (the reachable check fails)', async () => {
    const rig = await makeRig({ fake: { unreachable: true } });
    seedVault(rig);
    const report = (await runDoctor(rig.runtime, rig.configStore.load().vaults))[0]!;
    expect(report.checks.find((check) => check.name === 'server version')?.status).toBe('skip');
  });

  it('/api/status disagreeing with /health downgrades the version check to a warning', async () => {
    const rig = await makeRig({ fake: { statusServerVersion: '0.2.0' } });
    seedVault(rig);
    const report = (await runDoctor(rig.runtime, rig.configStore.load().vaults))[0]!;
    const version = report.checks.find((check) => check.name === 'server version')!;
    expect(version.status).toBe('warn');
    expect(version.detail).toContain('/api/status reports 0.2.0');
    expect(report.healthy).toBe(true);
  });

  it('a revoked token fails and hints re-pairing', async () => {
    const rig = await makeRig();
    seedVault(rig);
    rig.server.revoke('dev-1');
    const report = (await runDoctor(rig.runtime, rig.configStore.load().vaults))[0]!;
    expect(report.healthy).toBe(false);
    expect(report.checks.find((check) => check.name === 'token')?.status).toBe('fail');
    expect(report.hints.join(' ')).toMatch(/re-?pair/i);
  });

  it('a foreign device marker fails the state-dir check and hints the one-client rule', async () => {
    const rig = await makeRig();
    seedVault(rig);
    await writeDeviceMarker(rig.storage, {
      deviceId: 'dev-OTHER',
      deviceName: 'obsidian-plugin',
      url: 'https://vault.example',
      linkedAt: 1,
    });
    const report = (await runDoctor(rig.runtime, rig.configStore.load().vaults))[0]!;
    const owner = report.checks.find((check) => check.name === 'state dir owner')!;
    expect(owner.status).toBe('fail');
    expect(report.healthy).toBe(false);
    expect(report.hints.join(' ')).toMatch(/one client per machine per vault/i);
  });

  it('renders verdicts and the failing-vault summary', async () => {
    const rig = await makeRig({ fake: { unreachable: true } });
    seedVault(rig);
    const reports = await runDoctor(rig.runtime, rig.configStore.load().vaults);
    renderDoctor(reports, rig.runtime);
    expect(rig.output.text()).toContain('reachable');
    expect(rig.output.errors.join(' ')).toMatch(/1 vault\(s\) failed/i);
  });

  it('healthy render ends with the all-healthy line', async () => {
    const rig = await makeRig();
    seedVault(rig);
    const reports = await runDoctor(rig.runtime, rig.configStore.load().vaults);
    renderDoctor(reports, rig.runtime);
    expect(rig.output.lines.at(-1)).toMatch(/healthy/);
  });
});
