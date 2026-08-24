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
import { mkdir, readdir, readFile, rename, rm, rmdir, stat } from 'node:fs/promises';
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
    this.root = root;
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
    // Node Buffers ARE Uint8Arrays; copying would double every read's memory.
    return readFile(this.toHostPath(path));
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    await writeFileAtomic(this.toHostPath(path), data);
  }

  async deleteFile(path: string): Promise<void> {
    // Idempotent by contract: `force` swallows ENOENT.
    await rm(this.toHostPath(path), { force: true });
  }

  async renameFile(from: string, to: string): Promise<void> {
    const fromHost = this.toHostPath(from);
    const toHost = this.toHostPath(to);
    await mkdir(dirnameOf(toHost), { recursive: true });
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
    await mkdir(this.toHostPath(path), { recursive: true });
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
    try {
      await rmdir(this.toHostPath(path));
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') return;
      throw error;
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await stat(this.toHostPath(path));
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Depth-first walk of the vault, visiting every child of the root
   * recursively. `visit` receives the relative segments (raw names), the
   * kind, and file stats (only for `kind === 'file'`). A missing vault root
   * yields no visits — an empty vault, not an error. Entries that vanish
   * mid-walk are skipped. SYMLINKS are never followed (a link may escape
   * the vault or loop) and are collected into `links` instead of visited.
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
      entries = await readdir(hostDir, { withFileTypes: true });
    } catch {
      return; // vault root does not exist yet — an empty vault
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
        const stats = await stat(childPath).catch(() => null);
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
}

function dirnameOf(hostPath: string): string {
  const slash = Math.max(hostPath.lastIndexOf('/'), hostPath.lastIndexOf('\\'));
  if (slash === -1) return '.';
  if (slash === 0) return hostPath.slice(0, 1);
  return hostPath.slice(0, slash);
}
