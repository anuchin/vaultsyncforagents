/**
 * `NodeStorageAdapter` — core's `StorageAdapter` over `node:fs/promises`
 * (ARCHITECTURE.md §8 adapters: daemon/CLI implementation).
 *
 * Path mapping: every path crossing the core seam is a POSIX-normalized
 * vault path (`/notes/a.md`, root `/`). Host paths are derived by joining
 * the vault root with the path segments via `path.join`, so Windows vault
 * roots (`Z:\vaults\personal`) work unchanged. The vault root itself is
 * resolved to an absolute path at construction.
 *
 * Writes are atomic (temp + fsync + rename — see `util.ts`) and create
 * parent directories on demand; deletes are idempotent per the adapter
 * contract.
 */

import type { FileStat, StorageAdapter } from '@vsa/core';
import { normalizeVaultPath } from '@vsa/core';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, rm, rmdir, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve, sep } from 'node:path';
import { writeFileAtomic } from './util.js';

export interface NodeStorageAdapterOptions {
  /**
   * Vault root directory. Relative paths are resolved against `process.cwd()`
   * at construction time (the CLI resolves user input before this point).
   */
  root: string;
}

/** `StorageAdapter` over a real directory tree. Safe for concurrent calls. */
export class NodeStorageAdapter implements StorageAdapter {
  readonly root: string;

  constructor(options: NodeStorageAdapterOptions | string = { root: process.cwd() }) {
    const root = typeof options === 'string' ? options : options.root;
    if (!isAbsolute(root)) {
      throw new Error(`vault root must be absolute, got ${JSON.stringify(root)}`);
    }
    this.root = resolve(root);
  }

  /** Host path for a vault path (the inverse of {@link toVaultPath}). */
  toHostPath(vaultPath: string): string {
    const normalized = normalizeVaultPath(vaultPath);
    if (normalized === '/') return this.root;
    const segments = normalized.slice(1).split('/');
    return join(this.root, ...segments);
  }

  /** Vault path for a host path inside the vault. Throws if outside the root. */
  toVaultPath(hostPath: string): string {
    const absolute = resolve(hostPath);
    const root = resolve(this.root);
    if (absolute === root) return '/';
    if (!absolute.startsWith(root + sep)) {
      throw new Error(`host path ${JSON.stringify(hostPath)} is outside the vault root ${root}`);
    }
    const segments = absolute
      .slice(root.length)
      .split(/[\\/]+/)
      .filter((segment) => segment !== '');
    return segments.length === 0 ? '/' : `/${segments.join('/')}`;
  }

  async readFile(path: string): Promise<Uint8Array> {
    const hostPath = await this.safeHostPath(path);
    // O_NOFOLLOW also closes the final-component link race where supported.
    const handle = await open(hostPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    try {
      await this.safeHostPath(path);
      return await handle.readFile();
    } finally {
      await handle.close();
    }
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    const hostPath = await this.safeHostPath(path);
    await writeFileAtomic(hostPath, data, async () => { await this.safeHostPath(path); });
  }

  async deleteFile(path: string): Promise<void> {
    // Idempotent by contract: `force` swallows ENOENT.
    await rm(await this.safeHostPath(path), { force: true });
  }

  async renameFile(from: string, to: string): Promise<void> {
    const fromHost = await this.safeHostPath(from);
    const toHost = await this.safeHostPath(to);
    await mkdir(dirnameOf(toHost), { recursive: true });
    await this.safeHostPath(from);
    await this.safeHostPath(to);
    await rename(fromHost, toHost);
  }

  async listFiles(): Promise<readonly FileStat[]> {
    const files: FileStat[] = [];
    await this.walk([], async (segments, kind, stats) => {
      if (kind !== 'file') return;
      files.push({
        path: `/${segments.join('/')}`,
        size: stats.size,
        mtime: Math.round(stats.mtimeMs),
      });
    });
    files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return files;
  }

  async listDirs(): Promise<readonly string[]> {
    const dirs: string[] = ['/'];
    await this.walk([], async (segments, kind) => {
      if (kind === 'dir') dirs.push(`/${segments.join('/')}`);
    });
    dirs.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
    return dirs;
  }

  async ensureDir(path: string): Promise<void> {
    await mkdir(await this.safeHostPath(path), { recursive: true });
    await this.safeHostPath(path);
  }

  /**
   * Remove an EMPTY directory (the `StorageAdapter.removeDir` contract):
   * `rmdir` removes empty directories only — a non-empty one fails with
   * ENOTEMPTY rather than cascading (core pre-checks emptiness and treats
   * the refusal as record-only). ENOENT is swallowed, making the removal
   * idempotent. (`fs.rm` with `recursive: false` is not usable here — it
   * refuses EVERY directory with EISDIR on Windows.)
   */
  async removeDir(path: string): Promise<void> {
    if (normalizeVaultPath(path) === '/') return;
    try {
      await rmdir(await this.safeHostPath(path));
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return;
      throw error;
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await stat(await this.safeHostPath(path));
      return true;
    } catch (error) {
      if (isMissing(error)) return false;
      throw error;
    }
  }

  /**
   * Depth-first walk of the vault, visiting every child of the root
   * recursively. `visit` receives the relative segments (raw names), the
   * kind, and file stats (only for `kind === 'file'`). An unavailable root or
   * unreadable subtree aborts the inventory: an incomplete scan must never
   * infer deletions. Children that vanish mid-walk are skipped. SYMLINKS are
   * never followed (a link may escape the vault or loop) and are collected
   * into `links` instead of visited.
   */
  private async walk(
    relativeSegments: readonly string[],
    visit: (
      segments: readonly string[],
      kind: 'dir' | 'file',
      stats: { size: number; mtimeMs: number },
    ) => Promise<void>,
    links?: string[],
  ): Promise<void> {
    const hostDir =
      relativeSegments.length === 0 ? this.root : join(this.root, ...relativeSegments);
    let entries;
    try {
      await this.safeHostPath(`/${relativeSegments.join('/')}`);
      entries = await readdir(hostDir, { withFileTypes: true });
    } catch (error) {
      if (relativeSegments.length > 0 && isMissing(error)) return;
      throw error;
    }
    for (const entry of entries) {
      const childSegments = [...relativeSegments, entry.name];
      const childPath = join(hostDir, entry.name);
      if (entry.isSymbolicLink()) {
        // Never followed: a link may point outside the vault (host content
        // must not leak into sync) or into a loop. Collected so scans can
        // protect occluded index entries and surface the link — see
        // `StorageAdapter.listSymlinks`.
        links?.push(`/${childSegments.join('/')}`);
        continue;
      }
      if (entry.isDirectory()) {
        await visit(childSegments, 'dir', { size: 0, mtimeMs: 0 });
        await this.walk(childSegments, visit, links);
      } else {
        await this.safeHostPath(`/${childSegments.join('/')}`);
        const stats = await stat(childPath).catch((error: unknown) => {
          if (isMissing(error)) return null;
          throw error;
        });
        if (stats === null) continue; // vanished mid-walk
        await visit(childSegments, 'file', { size: stats.size, mtimeMs: stats.mtimeMs });
      }
    }
  }

  /** Every symlink inside the vault, sorted (`StorageAdapter.listSymlinks`). */
  async listSymlinks(): Promise<readonly string[]> {
    const links: string[] = [];
    // The kind-specific visits are irrelevant here; the walk itself collects.
    await this.walk([], async () => {}, links);
    return links.sort();
  }

  /**
   * Reject links in the root or any existing component, including the leaf.
   * Lexical normalization alone does not stop a junction from escaping the
   * vault. Missing components are allowed for creates; operations recheck
   * after creating parents and immediately before replacing a file.
   */
  private async safeHostPath(vaultPath: string): Promise<string> {
    const normalized = normalizeVaultPath(vaultPath);
    const segments = normalized === '/' ? [] : normalized.slice(1).split('/');
    let hostPath = this.root;
    for (let index = 0; index <= segments.length; index++) {
      if (index > 0) hostPath = join(hostPath, segments[index - 1]!);
      let info;
      try {
        info = await lstat(hostPath);
      } catch (error) {
        if (isMissing(error)) break;
        throw error;
      }
      if (info.isSymbolicLink()) throw new Error(`refusing filesystem link in vault path: ${hostPath}`);
      if (index < segments.length && !info.isDirectory()) {
        throw new Error(`vault path ancestor is not a directory: ${hostPath}`);
      }
    }
    return this.toHostPath(normalized);
  }
}

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT';
}

function dirnameOf(hostPath: string): string {
  const slash = Math.max(hostPath.lastIndexOf('/'), hostPath.lastIndexOf('\\'));
  if (slash === -1) return '.';
  if (slash === 0) return hostPath.slice(0, 1);
  return hostPath.slice(0, slash);
}
