/**
 * Machine configuration (ARCHITECTURE.md §9): per-machine vault registry and
 * device-token secrets, stored OUTSIDE the vault.
 *
 *   <configDir>/config.json   { vaults: [{ id, name, url, deviceId }] }
 *   <configDir>/secrets.json  { [vaultId]: token }   (chmod 0600 best-effort)
 *
 * Config dir resolution (first match wins):
 *   1. `$XDG_CONFIG_HOME/vaultsyncforagents`           (explicit override, any OS)
 *   2. `%APPDATA%/vaultsyncforagents`                  (Windows default)
 *   3. `~/.config/vaultsyncforagents`                  (Linux/macOS default)
 *
 * A vault's `id` is its absolute path — one machine cannot register the same
 * directory twice, which is half of the one-client-per-machine rule (FR-44);
 * the other half is the per-device state marker inside the vault
 * (see `device.ts`).
 *
 * Corrupt-file recovery: an unparsable/invalid file is moved aside to
 * `<name>.corrupt.bak` and an empty registry is returned, so a stray byte
 * never wedges the CLI permanently. The caller learns via `onRecovery`.
 *
 * The store is synchronous on purpose: config files are tiny and read once at
 * CLI startup; the sync API keeps every caller free of pointless `await`s.
 */

import { readFileSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join, resolve } from 'node:path';
import { chmodOwnerOnlySync, writeFileAtomicSync } from './util.js';

export const CONFIG_DIR_NAME = 'vaultsyncforagents';
export const CONFIG_FILE_NAME = 'config.json';
export const SECRETS_FILE_NAME = 'secrets.json';

/** One linked vault in the machine registry. */
export interface VaultEntry {
  /** Absolute vault directory path — the registry key. */
  id: string;
  /** Display name (the worker's vault name at link time). */
  name: string;
  /** Worker origin, e.g. `https://personal.x.workers.dev`. */
  url: string;
  /** Device id minted at pairing. */
  deviceId: string;
}

export interface MachineConfig {
  vaults: VaultEntry[];
}

/** `{ [vaultId]: deviceToken }`. */
export type Secrets = Record<string, string>;

/** Resolve the machine config directory (see module doc for precedence). */
export function resolveConfigDir(env: Record<string, string | undefined> = process.env): string {
  const xdg = env['XDG_CONFIG_HOME'];
  if (xdg !== undefined && xdg !== '' && isAbsolute(xdg)) {
    return join(xdg, CONFIG_DIR_NAME);
  }
  const appData = env['APPDATA'];
  if (appData !== undefined && appData !== '' && isAbsolute(appData)) {
    return join(appData, CONFIG_DIR_NAME);
  }
  const home = env['HOME'] ?? homedir();
  return join(home, '.config', CONFIG_DIR_NAME);
}

/** Canonical vault id: the resolved absolute directory path. */
export function vaultIdOf(vaultPath: string): string {
  return resolve(vaultPath);
}

/** Case-insensitive on Windows, exact elsewhere — how vault ids are matched. */
export function sameVaultRef(a: string, b: string): boolean {
  const left = resolve(a);
  const right = resolve(b);
  return process.platform === 'win32'
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

export interface ConfigStoreOptions {
  /** Absolute path of config.json. */
  configPath: string;
  /** Absolute path of secrets.json (default: sibling of config.json). */
  secretsPath?: string;
  /** Notified whenever a corrupt file had to be moved aside. */
  onRecovery?: (filePath: string, error: unknown) => void;
}

export class ConfigStore {
  readonly configPath: string;
  readonly secretsPath: string;
  private readonly onRecovery: (filePath: string, error: unknown) => void;

  constructor(options: ConfigStoreOptions) {
    this.configPath = options.configPath;
    this.secretsPath =
      options.secretsPath ?? join(dirnameOf(options.configPath), SECRETS_FILE_NAME);
    this.onRecovery = options.onRecovery ?? (() => {});
  }

  /** Open the default store for this machine (XDG/APPDATA-aware). */
  static default(
    options: Omit<ConfigStoreOptions, 'configPath' | 'secretsPath'> = {},
  ): ConfigStore {
    const dir = resolveConfigDir();
    return new ConfigStore({
      configPath: join(dir, CONFIG_FILE_NAME),
      secretsPath: join(dir, SECRETS_FILE_NAME),
      ...options,
    });
  }

  /** Registry; `{ vaults: [] }` when the file is missing. */
  load(): MachineConfig {
    return this.readJson(this.configPath, parseMachineConfig, { vaults: [] });
  }

  save(config: MachineConfig): void {
    writeFileAtomicSync(this.configPath, JSON.stringify(config, null, 2) + '\n');
  }

  /** Secrets; `{}` when the file is missing. */
  loadSecrets(): Secrets {
    return this.readJson(this.secretsPath, parseSecrets, {});
  }

  saveSecrets(secrets: Secrets): void {
    writeFileAtomicSync(this.secretsPath, JSON.stringify(secrets, null, 2) + '\n');
    chmodOwnerOnlySync(this.secretsPath); // best-effort on Windows (util.ts)
  }

  /** Insert or replace a vault entry (keyed by id, platform-aware match). */
  upsertVault(entry: VaultEntry): void {
    const config = this.load();
    const vaults = config.vaults.filter((vault) => !sameVaultRef(vault.id, entry.id));
    vaults.push(entry);
    this.save({ vaults });
  }

  /** Registry lookup by id or path (`--vault`). */
  findVault(idOrPath: string): VaultEntry | undefined {
    return this.load().vaults.find((vault) => sameVaultRef(vault.id, idOrPath));
  }

  /** Remove a vault entry and its token. Returns whether anything was removed. */
  removeVault(vaultId: string): boolean {
    const config = this.load();
    const remaining = config.vaults.filter((vault) => !sameVaultRef(vault.id, vaultId));
    const entryRemoved = remaining.length !== config.vaults.length;
    if (entryRemoved) this.save({ vaults: remaining });

    const secrets = this.loadSecrets();
    const kept: Secrets = {};
    let secretRemoved = false;
    for (const [key, token] of Object.entries(secrets)) {
      if (sameVaultRef(key, vaultId)) {
        secretRemoved = true;
        continue;
      }
      kept[key] = token;
    }
    if (secretRemoved) this.saveSecrets(kept);
    return entryRemoved || secretRemoved;
  }

  setToken(vaultId: string, token: string): void {
    const secrets = this.loadSecrets();
    const kept: Secrets = {};
    for (const [key, value] of Object.entries(secrets)) {
      if (!sameVaultRef(key, vaultId)) kept[key] = value;
    }
    kept[vaultIdOf(vaultId)] = token;
    this.saveSecrets(kept);
  }

  /** Token for a vault (matched with platform-aware path comparison). */
  getToken(vaultId: string): string | undefined {
    const secrets = this.loadSecrets();
    for (const [key, token] of Object.entries(secrets)) {
      if (sameVaultRef(key, vaultId)) return token;
    }
    return undefined;
  }

  /**
   * Read + parse + validate a JSON file. Missing file and corrupt file both
   * yield `fallback`; a corrupt file is additionally moved aside to
   * `<path>.corrupt.bak` and reported through `onRecovery`.
   */
  private readJson<T>(filePath: string, parse: (value: unknown) => T, fallback: T): T {
    let text: string;
    try {
      text = readFileSync(filePath, 'utf8');
    } catch {
      return fallback; // missing file: nothing wrong, fresh machine
    }
    let value: unknown;
    try {
      value = JSON.parse(text);
      return parse(value);
    } catch (error) {
      this.recoverCorrupt(filePath, error);
      return fallback;
    }
  }

  private recoverCorrupt(filePath: string, error: unknown): void {
    try {
      renameSync(filePath, `${filePath}.corrupt.bak`);
    } catch {
      // Could not move the bad file aside; still return the fallback so the
      // CLI can operate (the next save overwrites the corrupt file).
    }
    this.onRecovery(filePath, error);
  }
}

// --- validation / parsing ---------------------------------------------------------------

export function parseMachineConfig(value: unknown): MachineConfig {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('config.json: expected an object');
  }
  const vaults = (value as { vaults?: unknown }).vaults;
  if (vaults === undefined) {
    // An empty object is a valid empty registry (a truncated-but-valid write
    // from an older version would carry `vaults` explicitly; `{}` ≙ fresh).
    return { vaults: [] };
  }
  if (!Array.isArray(vaults)) {
    throw new Error('config.json: "vaults" must be an array');
  }
  return {
    vaults: vaults.map((entry, index) => {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        throw new Error(`config.json: vaults[${index}] must be an object`);
      }
      const { id, name, url, deviceId } = entry as Record<string, unknown>;
      if (typeof id !== 'string' || id === '') {
        throw new Error(`config.json: vaults[${index}].id must be a non-empty string`);
      }
      if (typeof name !== 'string' || typeof url !== 'string' || typeof deviceId !== 'string') {
        throw new Error(`config.json: vaults[${index}] needs string name, url and deviceId`);
      }
      return { id, name, url, deviceId };
    }),
  };
}

export function parseSecrets(value: unknown): Secrets {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('secrets.json: expected an object');
  }
  const secrets: Secrets = {};
  for (const [key, token] of Object.entries(value as Record<string, unknown>)) {
    if (typeof token !== 'string') {
      throw new Error(`secrets.json: token for ${JSON.stringify(key)} must be a string`);
    }
    secrets[key] = token;
  }
  return secrets;
}

function dirnameOf(p: string): string {
  const slash = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  if (slash === -1) return '.';
  return slash === 0 ? p.slice(0, 1) : p.slice(0, slash);
}
