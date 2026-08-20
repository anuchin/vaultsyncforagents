/**
 * `vsa link` flows against the rig (FR-51, FR-44): happy path, unclaimed
 * worker instructions, bad pairing code, unreachable worker, one-client
 * guard (foreign state dir / already linked), and non-interactive flag
 * requirements.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readDeviceMarker, type VaultEntry } from '@vsa/node-runtime';
import { CommandError } from '../src/runtime.js';
import { runLink } from '../src/commands/link.js';
import { makeRig, WORKER_URL } from './helpers.js';

const enc = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('runLink', () => {
  it('happy path: pairs, persists config+secret+marker, runs the initial sync', async () => {
    const rig = await makeRig();
    await rig.storage.writeFile('/hello.md', enc('hello world'));

    const result = await runLink(rig.runtime, {
      path: rig.vaultDir,
      url: WORKER_URL,
      code: 'TEST-CODE',
      name: 'cli-box',
      force: false,
    });

    // Pairing result.
    expect(result.vault.deviceId).toBe('dev-1');
    expect(result.filesSynced).toBeGreaterThan(0);

    // Config + secrets.
    const vaults = rig.configStore.load().vaults;
    expect(vaults).toHaveLength(1);
    expect(vaults[0]).toMatchObject({ id: rig.vaultDir, url: WORKER_URL, name: 'personal' });
    expect(rig.configStore.getToken(rig.vaultDir)).toBe('tok-dev-1');
    const secretsRaw = JSON.parse(
      await readFile(join(rig.configDir, 'secrets.json'), 'utf8'),
    ) as Record<string, string>;
    expect(secretsRaw[rig.vaultDir]).toBe('tok-dev-1');

    // Device marker inside the vault (FR-44 seam).
    const marker = await readDeviceMarker(rig.storage);
    expect(marker).toMatchObject({ deviceId: 'dev-1', deviceName: 'cli-box', url: WORKER_URL });

    // The initial sync actually pushed the local file to the server.
    const files = rig.server.snapshot().files.map((file) => file.path);
    expect(files).toContain('/hello.md');
  });

  it('unclaimed worker: prints browser instructions and refuses to link', async () => {
    const rig = await makeRig({ fake: { claimed: false } });
    await expect(
      runLink(rig.runtime, { path: rig.vaultDir, url: WORKER_URL, code: 'X', name: 'n', force: false }),
    ).rejects.toThrow(/unclaimed.*browser|claim/i);
    expect(rig.output.text()).toContain('Open the URL in a browser');
    expect(rig.configStore.load().vaults).toHaveLength(0);
  });

  it('bad pairing code: friendly one-time/expiry message, nothing persisted', async () => {
    const rig = await makeRig();
    await expect(
      runLink(rig.runtime, { path: rig.vaultDir, url: WORKER_URL, code: 'WRONG', name: 'n', force: false }),
    ).rejects.toThrow(/pairing code rejected/i);
    expect(rig.configStore.load().vaults).toHaveLength(0);
    expect(rig.configStore.getToken(rig.vaultDir)).toBeUndefined();
  });

  it('unreachable worker: actionable network error', async () => {
    const rig = await makeRig({ fake: { unreachable: true } });
    await expect(
      runLink(rig.runtime, { path: rig.vaultDir, url: WORKER_URL, code: 'X', name: 'n', force: false }),
    ).rejects.toThrow(/could not reach the worker/i);
  });

  it('FR-44: refuses when the vault has another device\'s state dir, --force overrides', async () => {
    const rig = await makeRig();
    const { writeDeviceMarker } = await import('@vsa/node-runtime');
    await writeDeviceMarker(rig.storage, {
      deviceId: 'dev-OTHER',
      deviceName: 'obsidian-plugin',
      url: WORKER_URL,
      linkedAt: 1,
    });

    const refusal = runLink(rig.runtime, {
      path: rig.vaultDir,
      url: WORKER_URL,
      code: 'TEST-CODE',
      name: 'cli-box',
      force: false,
    });
    await expect(refusal).rejects.toThrow(/ONE client per machine per vault/i);
    expect(rig.configStore.load().vaults).toHaveLength(0);

    // --force proceeds and takes ownership of the marker.
    await runLink(rig.runtime, {
      path: rig.vaultDir,
      url: WORKER_URL,
      code: 'TEST-CODE',
      name: 'cli-box',
      force: true,
    });
    expect(await readDeviceMarker(rig.storage)).toMatchObject({ deviceId: 'dev-1' });
  });

  it('already linked on this machine: says so instead of silently double-pairing', async () => {
    const rig = await makeRig();
    const entry: VaultEntry = { id: rig.vaultDir, name: 'personal', url: WORKER_URL, deviceId: 'dev-1' };
    rig.configStore.upsertVault(entry);
    const { writeDeviceMarker } = await import('@vsa/node-runtime');
    await writeDeviceMarker(rig.storage, {
      deviceId: 'dev-1',
      deviceName: 'cli-box',
      url: WORKER_URL,
      linkedAt: 1,
    });

    await expect(
      runLink(rig.runtime, { path: rig.vaultDir, url: WORKER_URL, code: 'TEST-CODE', name: 'cli-box', force: false }),
    ).rejects.toThrow(/already linked/i);
  });

  it('non-interactive without --url: tells the caller to pass flags', async () => {
    const rig = await makeRig();
    rig.runtime.prompts = null;
    await expect(
      runLink(rig.runtime, { path: rig.vaultDir, code: 'TEST-CODE', force: false }),
    ).rejects.toThrow(/--url \/ --code/i);
  });

  it('interactive: prompts for URL and code when flags are absent', async () => {
    const rig = await makeRig();
    rig.prompts.script('https://vault.example').script('TEST-CODE');
    const result = await runLink(rig.runtime, { path: rig.vaultDir, force: false });
    expect(result.vault.url).toBe(WORKER_URL);
    expect(rig.prompts.asked.length).toBe(2);
  });

  it('rejects a path that is not a directory', async () => {
    const rig = await makeRig();
    await expect(
      runLink(rig.runtime, {
        path: join(rig.vaultDir, 'nope'),
        url: WORKER_URL,
        code: 'TEST-CODE',
        force: false,
      }),
    ).rejects.toThrow(/not a directory/i);
  });

  it('bad path arg surfaces as CommandError (type probe)', async () => {
    const rig = await makeRig();
    const error = await runLink(rig.runtime, { path: 'Z:\\definitely\\missing', force: false }).catch(
      (error: unknown) => error,
    );
    expect(error).toBeInstanceOf(CommandError);
  });
});
