/**
 * `vsa unlink` (FR-51) and the thin commander layer (`buildProgram`): file
 * preservation semantics, error shapes, and flag wiring through parseAsync.
 */

import { describe, expect, it } from 'vitest';
import { readDeviceMarker } from '@vsa/node-runtime';
import { runUnlink } from '../src/commands/unlink.js';
import { CommandError } from '../src/runtime.js';
import { buildProgram } from '../src/cli.js';
import { makeRig, seedVault } from './helpers.js';

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('runUnlink', () => {
  it('removes the config entry and token, keeps files and state dir', async () => {
    const rig = await makeRig();
    await rig.link();
    await rig.storage.writeFile('/keep.md', enc('keep me'));

    const result = runUnlink(rig.runtime, { path: rig.vaultDir });
    expect(result.removed).toBe(true);
    expect(result.name).toBe('personal');

    expect(rig.configStore.load().vaults).toHaveLength(0);
    expect(rig.configStore.getToken(rig.vaultDir)).toBeUndefined();
    // Files untouched; state dir untouched.
    expect(new TextDecoder().decode(await rig.storage.readFile('/keep.md'))).toBe('keep me');
    expect(await readDeviceMarker(rig.storage)).not.toBeNull();
  });

  it('with several vaults linked, a path (or --vault) is required', async () => {
    const rig = await makeRig();
    seedVault(rig);
    const rig2 = await makeRig();
    void rig2;
    // Second vault entry in the same config store.
    rig.configStore.upsertVault({
      id: 'Z:\\other\\vault',
      name: 'work',
      url: 'https://work.example',
      deviceId: 'dev-2',
    });
    expect(() => runUnlink(rig.runtime, {})).toThrow(/multiple vaults are linked/i);
    expect(() => runUnlink(rig.runtime, { path: rig.vaultDir })).not.toThrow();
  });

  it('unlinking when nothing is linked is a clean error', async () => {
    const rig = await makeRig();
    expect(() => runUnlink(rig.runtime, {})).toThrow(/no vaults are linked/i);
  });
});

describe('buildProgram (thin commander layer)', () => {
  it('wires `status --json` end-to-end through parseAsync', async () => {
    const rig = await makeRig();
    seedVault(rig);
    const program = buildProgram(rig.runtime);
    await program.parseAsync(['status', '--json'], { from: 'user' });
    const printed = rig.output.lines.join('\n');
    const parsed = JSON.parse(printed) as { summary: { connected: number } };
    expect(parsed.summary.connected).toBe(1);
  });

  it('wires `link` flags and prints the human summary', async () => {
    const rig = await makeRig();
    const program = buildProgram(rig.runtime);
    await program.parseAsync(
      ['link', rig.vaultDir, '--url', 'https://vault.example', '--code', 'TEST-CODE', '--name', 'cli-box'],
      { from: 'user' },
    );
    expect(rig.output.text()).toContain('Linked personal');
    expect(rig.configStore.load().vaults).toHaveLength(1);
  });

  it('command errors propagate for the caller to map to exit codes', async () => {
    const rig = await makeRig();
    seedVault(rig);
    const program = buildProgram(rig.runtime);
    await expect(
      program.parseAsync(['history', '/notes/a.md', '--vault', 'Z:\\missing'], { from: 'user' }),
    ).rejects.toBeInstanceOf(CommandError);
  });

  it('doctor sets a non-zero exit code when checks fail', async () => {
    const rig = await makeRig({ fake: { unreachable: true } });
    seedVault(rig);
    const program = buildProgram(rig.runtime);
    const before = process.exitCode;
    try {
      await program.parseAsync(['doctor'], { from: 'user' });
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = before;
    }
  });
});
