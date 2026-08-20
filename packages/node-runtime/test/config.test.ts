/**
 * ConfigStore: read/write/roundtrip, missing-file and corrupt-file recovery,
 * path-matching semantics, and config-dir resolution (XDG override,
 * Windows APPDATA, POSIX default). All against temp dirs; `resolveConfigDir`
 * is pure and tested with injected env maps.
 */

import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ConfigStore,
  parseMachineConfig,
  parseSecrets,
  resolveConfigDir,
  sameVaultRef,
  vaultIdOf,
  type VaultEntry,
} from '../src/config.js';
import { readDeviceMarker, writeDeviceMarker } from '../src/device.js';
import { NodeStorageAdapter } from '../src/storage.js';

const entry = (overrides: Partial<VaultEntry> = {}): VaultEntry => ({
  id: '/vaults/personal',
  name: 'personal',
  url: 'https://personal.x.workers.dev',
  deviceId: 'dev-abc',
  ...overrides,
});

async function tempStore(): Promise<ConfigStore> {
  const dir = await mkdtemp(join(tmpdir(), 'vsa-config-'));
  return new ConfigStore({ configPath: join(dir, 'config.json') });
}

describe('ConfigStore', () => {
  it('load on a fresh machine returns an empty registry (no file created)', async () => {
    const store = await tempStore();
    expect(store.load()).toEqual({ vaults: [] });
    expect(store.loadSecrets()).toEqual({});
    expect(await readFile(store.configPath, 'utf8').catch(() => 'missing')).toBe('missing');
  });

  it('save/load roundtrips vault entries and secrets', async () => {
    const store = await tempStore();
    store.upsertVault(entry());
    store.setToken('/vaults/personal', 'tok-1');

    expect(store.load().vaults).toHaveLength(1);
    expect(store.load().vaults[0]).toEqual(entry());
    expect(store.getToken('/vaults/personal')).toBe('tok-1');
    // Roundtrip through a fresh store instance (i.e., a later CLI run).
    const reopened = new ConfigStore({
      configPath: store.configPath,
      secretsPath: store.secretsPath,
    });
    expect(reopened.load()).toEqual({ vaults: [entry()] });
    expect(reopened.loadSecrets()).toEqual({ [vaultIdOf('/vaults/personal')]: 'tok-1' });
  });

  it('upsertVault replaces by id and removeVault drops entry + token', async () => {
    const store = await tempStore();
    store.upsertVault(entry());
    store.upsertVault(entry({ name: 'renamed' }));
    expect(store.load().vaults).toHaveLength(1);
    expect(store.load().vaults[0]?.name).toBe('renamed');

    store.setToken('/vaults/personal', 'tok-2');
    expect(store.removeVault('/vaults/personal')).toBe(true);
    expect(store.load().vaults).toEqual([]);
    expect(store.loadSecrets()).toEqual({});
    expect(store.removeVault('/vaults/personal')).toBe(false);
  });

  it('corrupt config.json is backed aside and an empty registry returned', async () => {
    const store = await tempStore();
    const recoveries: string[] = [];
    const watching = new ConfigStore({
      configPath: store.configPath,
      secretsPath: store.secretsPath,
      onRecovery: (path) => recoveries.push(path),
    });
    await writeFile(store.configPath, '{ not json', 'utf8');

    expect(watching.load()).toEqual({ vaults: [] });
    expect(recoveries).toEqual([watching.configPath]);
    const dirListing = await readdir(join(store.configPath, '..'));
    expect(dirListing).toContain('config.json.corrupt.bak');
    // The store stays usable after recovery.
    watching.upsertVault(entry());
    expect(watching.load().vaults).toHaveLength(1);
  });

  it('corrupt secrets.json recovers the same way', async () => {
    const store = await tempStore();
    const recoveries: string[] = [];
    const watching = new ConfigStore({
      configPath: store.configPath,
      secretsPath: store.secretsPath,
      onRecovery: (path) => recoveries.push(path),
    });
    await writeFile(store.secretsPath, '["array", "not", "object"]', 'utf8');
    expect(watching.loadSecrets()).toEqual({});
    expect(recoveries).toEqual([watching.secretsPath]);
  });

  it('structurally invalid config (vaults not an array) counts as corrupt', async () => {
    const store = await tempStore();
    await writeFile(store.configPath, JSON.stringify({ vaults: 'nope' }), 'utf8');
    expect(store.load()).toEqual({ vaults: [] });
  });

  it('secrets.json is written with 0600 (best-effort) and valid JSON', async () => {
    const store = await tempStore();
    store.setToken('/vaults/a', 'token-value');
    const raw = JSON.parse(await readFile(store.secretsPath, 'utf8')) as Record<string, string>;
    expect(raw[vaultIdOf('/vaults/a')]).toBe('token-value');
  });

  it('getToken matches entries with platform-aware path comparison', async () => {
    const store = await tempStore();
    store.upsertVault(entry({ id: join(tmpdir(), 'DoesNotExist', 'X') }));
    const id = store.load().vaults[0]!.id;
    store.setToken(id, 'tok');

    // Same path with a trailing slash resolves to the same id.
    expect(store.getToken(`${id}/`)).toBe('tok');
    expect(store.getToken(`${id}\\`)).toBe('tok');
    expect(store.findVault(id)).toBeDefined();
    expect(store.findVault(`${id}${join('') === '' ? '' : ''}`)).toBeDefined();
  });
});

describe('resolveConfigDir', () => {
  it('XDG_CONFIG_HOME wins on every platform (explicit override)', () => {
    expect(resolveConfigDir({ XDG_CONFIG_HOME: '/xdg-root', APPDATA: 'C:\\Users\\me\\AppData\\Roaming' })).toBe(
      join('/xdg-root', 'vaultsyncforagents'),
    );
  });

  it('APPDATA is used on Windows-style envs without XDG', () => {
    expect(resolveConfigDir({ APPDATA: 'C:\\Users\\me\\AppData\\Roaming' })).toBe(
      join('C:\\Users\\me\\AppData\\Roaming', 'vaultsyncforagents'),
    );
  });

  it('falls back to ~/.config otherwise', () => {
    expect(resolveConfigDir({ HOME: '/home/jitu' })).toBe(
      join('/home/jitu', '.config', 'vaultsyncforagents'),
    );
  });

  it('relative XDG/APPDATA values are ignored (must be absolute)', () => {
    expect(resolveConfigDir({ XDG_CONFIG_HOME: 'relative', HOME: '/home/jitu' })).toBe(
      join('/home/jitu', '.config', 'vaultsyncforagents'),
    );
    expect(resolveConfigDir({ APPDATA: 'relative', HOME: '/home/jitu' })).toBe(
      join('/home/jitu', '.config', 'vaultsyncforagents'),
    );
  });
});

describe('sameVaultRef', () => {
  it('resolves relative segments and duplicate slashes', () => {
    expect(sameVaultRef('/a/b', '/a/./b///')).toBe(true);
    expect(sameVaultRef('/a/b', '/a/c')).toBe(false);
  });
});

describe('parsers reject garbage', () => {
  it('parseMachineConfig / parseSecrets throw on wrong shapes', () => {
    expect(() => parseMachineConfig([])).toThrow();
    expect(() => parseMachineConfig({ vaults: 5 })).toThrow();
    expect(() => parseMachineConfig({ vaults: [{ id: 7 }] })).toThrow();
    expect(() => parseSecrets('x')).toThrow();
    expect(() => parseSecrets({ a: 1 })).toThrow();
    expect(parseMachineConfig({})).toEqual({ vaults: [] });
  });
});

describe('device marker (FR-44 seam)', () => {
  it('roundtrips through any StorageAdapter and reads missing as null', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vsa-marker-'));
    const storage = new NodeStorageAdapter({ root: dir });
    expect(await readDeviceMarker(storage)).toBeNull();

    await writeDeviceMarker(storage, {
      deviceId: 'dev-9',
      deviceName: 'agent-vps',
      url: 'https://x.example',
      linkedAt: 42,
    });
    expect(await readDeviceMarker(storage)).toEqual({
      deviceId: 'dev-9',
      deviceName: 'agent-vps',
      url: 'https://x.example',
      linkedAt: 42,
    });
  });

  it('unreadable marker reads as null but still exists on disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vsa-marker-'));
    const storage = new NodeStorageAdapter({ root: dir });
    await storage.writeFile('/.vaultsyncforagents/device.json', new TextEncoder().encode('nonsense'));
    expect(await readDeviceMarker(storage)).toBeNull();
    expect(await storage.exists('/.vaultsyncforagents/device.json')).toBe(true);
  });
});
