/**
 * In-memory `StorageAdapter` — the test bench and the substrate for the
 * two-client simulation tests of later phases.
 *
 * Files live in a `Map` keyed by normalized vault path, directories in a
 * `Set` (so `exists`/`ensureDir` behave for empty folders, FR-10). Writes
 * stage into a temp entry and then commit with rename semantics — within
 * one synchronous section, so no observer can see a half-written file.
 */

import type { FileStat, StorageAdapter } from '../adapters.js';
import { normalizeVaultPath, parentPath } from '../paths.js';

interface Entry {
  data: Uint8Array;
  mtime: number;
}

export interface InMemoryStorageOptions {
  /** Injectable clock for deterministic mtimes in tests. Default: Date.now. */
  now?: () => number;
}

export class InMemoryStorageAdapter implements StorageAdapter {
  private readonly files = new Map<string, Entry>();
  private readonly dirs = new Set<string>(['/']);
  private readonly now: () => number;
  private tmpCounter = 0;

  constructor(
    initial?: Readonly<Record<string, string | Uint8Array>>,
    options?: InMemoryStorageOptions,
  ) {
    this.now = options?.now ?? (() => Date.now());
    if (initial) {
      for (const [path, data] of Object.entries(initial)) {
        const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
        this.commit(normalizeVaultPath(path), { data: bytes.slice(), mtime: this.now() });
      }
    }
  }

  async readFile(path: string): Promise<Uint8Array> {
    const entry = this.files.get(this.key(path));
    if (!entry) {
      throw new Error(`File not found: ${normalizeVaultPath(path)}`);
    }
    return entry.data.slice();
  }

  async writeFile(path: string, data: Uint8Array): Promise<void> {
    const key = this.key(path);
    // Stage to temp first: a failure before the commit leaves the target untouched.
    const tmpKey = `__vsa_tmp__/${this.tmpCounter++}`;
    const staged: Entry = { data: data.slice(), mtime: this.now() };
    this.files.set(tmpKey, staged);
    this.commit(key, staged);
    this.files.delete(tmpKey);
  }

  async deleteFile(path: string): Promise<void> {
    this.files.delete(this.key(path));
  }

  async renameFile(from: string, to: string): Promise<void> {
    const fromKey = this.key(from);
    const entry = this.files.get(fromKey);
    if (!entry) {
      throw new Error(`File not found: ${normalizeVaultPath(from)}`);
    }
    this.files.delete(fromKey);
    this.commit(this.key(to), entry);
  }

  async listFiles(): Promise<readonly FileStat[]> {
    return [...this.files.entries()]
      .map(([path, entry]) => ({ path, size: entry.data.byteLength, mtime: entry.mtime }))
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  }

  async ensureDir(path: string): Promise<void> {
    this.recordDir(normalizeVaultPath(path));
  }

  async exists(path: string): Promise<boolean> {
    const key = normalizeVaultPath(path);
    return this.files.has(key) || this.dirs.has(key);
  }

  // --- internals -------------------------------------------------------------

  private key(path: string): string {
    return normalizeVaultPath(path);
  }

  /** Install an entry, registering ancestor directories. */
  private commit(key: string, entry: Entry): void {
    this.recordDir(parentPath(key));
    this.files.set(key, entry);
  }

  /** Register a directory and all of its ancestors. */
  private recordDir(dir: string): void {
    let current = '/';
    this.dirs.add(current);
    if (dir === '/') return;
    for (const segment of dir.slice(1).split('/')) {
      current = `${current === '/' ? '' : current}/${segment}`;
      this.dirs.add(current);
    }
  }
}
