/**
 * `ObsidianStorageAdapter` — core's `StorageAdapter` over the Obsidian vault
 * `DataAdapter` (ARCHITECTURE §8 adapters: plugin implementation, desktop and
 * mobile alike).
 *
 * Path mapping: every path crossing the core seam is a POSIX-normalized vault
 * path (`/notes/a.md`, root `/`); the Obsidian adapter wants the same path
 * *without* the leading slash (`notes/a.md`), with `/` (or `''`) for the root.
 *
 * All writes go through the adapter (never `vault.modify` on the side), so
 * Obsidian's own file watching observes them like any external edit and open
 * editors refresh (FR-3). Writes are atomic-ish: content lands in a temp file
 * under `/.vaultsyncforagents/tmp/` (core ignores that whole subtree) and is
 * renamed onto the target; if renaming is unavailable (exotic mobile
 * adapters), we fall back to a direct write.
 */

import type { DataAdapter } from 'obsidian';
import type { FileStat, StorageAdapter } from '@vsa/core';
import { normalizeVaultPath } from '@vsa/core';

/** Directory (inside the vault) holding temp files during atomic writes. */
export const TEMP_DIR_VAULT_PATH = '/.vaultsyncforagents/tmp';

/** Stats Obsidian's `DataAdapter.stat` returns for a file. */
interface AdapterStat {
  size: number;
  mtime: number;
}

export interface ObsidianStorageAdapterOptions {
  adapter: DataAdapter;
  /**
   * Desktop and mobile Obsidian's `DataAdapter.rmdir` is fs.rm-based and
   * refuses EVERY directory (`ERR_FS_EISDIR`) — it cannot remove even an
   * empty folder, which silently degraded every folder-tombstone application
   * to record-only (the F-1 ping-pong). When provided, `removeDir` performs
   * the empty-folder removal through this callback instead — the plugin wires
   * it to `fileManager.trashFile` on the vault's TFolder, which works and
   * never destroys data (system trash; core pre-checks emptiness anyway).
   * Receives the ADAPTER path (no leading slash).
   */
  removeEmptyDir?: (adapterPath: string) => Promise<void>;
}

export class ObsidianStorageAdapter implements StorageAdapter {
  private readonly adapter: DataAdapter;
  private readonly removeEmptyDir?: (adapterPath: string) => Promise<void>;
  /**
   * Latched when a temp+rename attempt fails: every later write goes straight
   * to `writeBinary` instead of paying the failing-rename penalty again.
   */
  private tempRenameBroken = false;
  private tempCounter = 0;

  constructor(options: ObsidianStorageAdapterOptions) {
    this.adapter = options.adapter;
    this.removeEmptyDir = options.removeEmptyDir;
  }

  // --- path mapping ----------------------------------------------------------

  /** Vault path → adapter path (`/a/b.md` → `a/b.md`, `/` → `/`). */
  private toAdapterPath(vaultPath: string): string {
    const normalized = normalizeVaultPath(vaultPath);
    return normalized === '/' ? '/' : normalized.slice(1);
  }

  // --- StorageAdapter ---------------------------------------------------------

  async readFile(path: string): Promise<Uint8Array> {
    const buffer = await this.adapter.readBinary(this.toAdapterPath(path));
    return new Uint8Array(buffer);
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    const target = this.toAdapterPath(path);
    await this.ensureParentDirs(target);
    // Copy into a standalone ArrayBuffer: `bytes.buffer` may be a pooled
    // buffer larger than the view (core slices and reuses buffers).
    const buffer = new ArrayBuffer(data.byteLength);
    new Uint8Array(buffer).set(data);

    if (this.tempRenameBroken) {
      await this.adapter.writeBinary(target, buffer);
      return;
    }
    const temp = await this.tempPath();
    try {
      await this.adapter.writeBinary(temp, buffer);
      await this.adapter.rename(temp, target);
    } catch {
      // Clean up the orphaned temp (best effort — it lives in the ignored
      // state dir, so even a leak is invisible to sync), then fall back to
      // a direct, non-atomic write rather than failing the sync.
      await this.silentRemove(temp);
      this.tempRenameBroken = true;
      await this.adapter.writeBinary(target, buffer);
    }
  }

  async deleteFile(path: string): Promise<void> {
    const target = this.toAdapterPath(path);
    // Idempotent per the adapter contract.
    if (!(await this.adapter.exists(target))) return;
    try {
      await this.adapter.remove(target);
    } catch {
      // Lost a race with a concurrent delete — only surface if it survives.
      if (await this.adapter.exists(target)) throw new Error(`failed to delete ${target}`);
    }
  }

  async renameFile(from: string, to: string): Promise<void> {
    const fromPath = this.toAdapterPath(from);
    const toPath = this.toAdapterPath(to);
    await this.ensureParentDirs(toPath);
    await this.adapter.rename(fromPath, toPath);
  }

  async listFiles(): Promise<readonly FileStat[]> {
    const files: FileStat[] = [];
    await this.walkFiles('/', async (adapterPath) => {
      const stat = await this.statOrNull(adapterPath);
      if (stat === null) return; // vanished mid-walk
      files.push({
        path: `/${adapterPath}`,
        size: stat.size,
        mtime: stat.mtime,
      });
    });
    files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return files;
  }

  async listDirs(): Promise<readonly string[]> {
    const dirs: string[] = ['/'];
    await this.walkFolders('/', async (adapterPath) => {
      dirs.push(`/${adapterPath}`);
    });
    dirs.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return dirs;
  }

  async ensureDir(path: string): Promise<void> {
    const normalized = normalizeVaultPath(path);
    const segments = normalized === '/' ? [] : normalized.slice(1).split('/');
    let current = '';
    for (const segment of segments) {
      current = current === '' ? segment : `${current}/${segment}`;
      if (!(await this.adapter.exists(current))) await this.adapter.mkdir(current);
    }
  }

  /**
   * Remove an EMPTY directory (the `StorageAdapter.removeDir` contract).
   * Prefers the vault-API callback (`removeEmptyDir` — see the option's doc
   * for why `DataAdapter.rmdir` cannot do this); falls back to `rmdir` for
   * bare adapters (tests). Missing path ⇒ no-op (idempotent); the vault root
   * is never removable; a non-empty refusal propagates (core treats it as
   * record-only — never data loss).
   */
  async removeDir(path: string): Promise<void> {
    const normalized = normalizeVaultPath(path);
    if (normalized === '/') return; // never touch the vault root
    const target = this.toAdapterPath(normalized);
    // Idempotent per the adapter contract.
    if (!(await this.adapter.exists(target))) return;
    if (this.removeEmptyDir !== undefined) {
      await this.removeEmptyDir(target);
      return;
    }
    await this.adapter.rmdir(target, false);
  }

  async exists(path: string): Promise<boolean> {
    const normalized = normalizeVaultPath(path);
    if (normalized === '/') return true; // the vault root always exists
    try {
      return await this.adapter.exists(this.toAdapterPath(normalized));
    } catch {
      return false;
    }
  }

  // --- helpers ----------------------------------------------------------------

  private async statOrNull(adapterPath: string): Promise<AdapterStat | null> {
    try {
      const stat = await this.adapter.stat(adapterPath);
      if (stat === null || stat.type !== 'file') return null;
      return { size: stat.size, mtime: stat.mtime };
    } catch {
      return null;
    }
  }

  /** A unique temp path inside the (sync-ignored) client state dir. */
  private async tempPath(): Promise<string> {
    await this.ensureDir(TEMP_DIR_VAULT_PATH);
    this.tempCounter += 1;
    return `${TEMP_DIR_VAULT_PATH.slice(1)}/w-${Date.now().toString(36)}-${this.tempCounter}.tmp`;
  }

  private async silentRemove(adapterPath: string): Promise<void> {
    try {
      await this.adapter.remove(adapterPath);
    } catch {
      // best effort
    }
  }

  /** Create every ancestor directory of an adapter file path. */
  private async ensureParentDirs(adapterPath: string): Promise<void> {
    const slash = adapterPath.lastIndexOf('/');
    if (slash <= 0) return; // vault root — always exists
    const parent = adapterPath.slice(0, slash);
    await this.ensureDir(`/${parent}`);
  }

  /** Recursively visit every file under `dirAdapterPath` (adapter paths). */
  private async walkFiles(
    dirAdapterPath: string,
    visit: (adapterPath: string) => Promise<void>,
  ): Promise<void> {
    let listing;
    try {
      listing = await this.adapter.list(dirAdapterPath);
    } catch {
      return; // unreadable/missing — treat as empty
    }
    for (const file of listing.files) await visit(file);
    for (const folder of listing.folders) await this.walkFiles(folder, visit);
  }

  /** Recursively visit every folder under `dirAdapterPath` (adapter paths). */
  private async walkFolders(
    dirAdapterPath: string,
    visit: (adapterPath: string) => Promise<void>,
  ): Promise<void> {
    let listing;
    try {
      listing = await this.adapter.list(dirAdapterPath);
    } catch {
      return;
    }
    for (const folder of listing.folders) {
      await visit(folder);
      await this.walkFolders(folder, visit);
    }
  }
}
