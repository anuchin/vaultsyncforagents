/**
 * `FakeVault` + `FakeDataAdapter` — an in-memory stand-in for Obsidian's
 * `Vault`/`DataAdapter` implementing exactly the surface
 * `ObsidianStorageAdapter` and `ObsidianWatchAdapter` touch. Cast to the
 * real types at the call sites (`as unknown as Vault` etc.) — the fake is
 * structurally faithful, not a subtype of the (huge) real interface.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

export const FIXED_MTIME = 1_700_000_000_000;

interface FakeStat {
  type: 'file' | 'folder';
  ctime: number;
  mtime: number;
  size: number;
}

export class FakeDataAdapter {
  /** adapter paths ('' implied root) → content. */
  readonly files = new Map<string, Uint8Array>();
  readonly folders = new Set<string>();
  /** When true, `rename` throws — exercises the atomic-write fallback. */
  failRename = false;
  /** Recorded mkdir calls (for asserting dir creation). */
  readonly mkdirs: string[] = [];
  /**
   * Optional wall clock for per-file mtimes. Unset (default): every file
   * reports `FIXED_MTIME` — the historical fake behavior existing tests rely
   * on. Set (tests that need a realistic stat sequence): `writeBinary` stamps
   * the file with `clock()` so successive writes are distinguishable by
   * mtime, like a real filesystem.
   */
  clock?: () => number;
  private readonly mtimes = new Map<string, number>();

  constructor(seed: Record<string, string> = {}) {
    for (const [path, content] of Object.entries(seed)) {
      this.files.set(path, new TextEncoder().encode(content));
      ensureDirs(this.folders, path);
    }
  }

  async exists(path: string): Promise<boolean> {
    if (path === '' || path === '/') return true;
    return this.files.has(path) || this.folders.has(path);
  }

  async mkdir(path: string): Promise<void> {
    this.mkdirs.push(path);
    this.folders.add(path);
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    const file = this.files.get(path);
    if (file === undefined) throw new Error(`no such file: ${path}`);
    return file.slice().buffer;
  }

  async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    this.files.set(path, new Uint8Array(data).slice());
    if (this.clock !== undefined) this.mtimes.set(path, this.clock());
    ensureDirs(this.folders, path);
  }

  async rename(from: string, to: string): Promise<void> {
    if (this.failRename) throw new Error('rename is not supported on this adapter');
    if (this.files.has(from)) {
      this.files.set(to, this.files.get(from)!);
      this.files.delete(from);
      // The mtime stamp follows the content (real renames preserve mtime).
      const stamp = this.mtimes.get(from);
      if (stamp !== undefined) {
        this.mtimes.set(to, stamp);
        this.mtimes.delete(from);
      }
      ensureDirs(this.folders, to);
      return;
    }
    if (this.folders.has(from)) {
      const descendants = [...this.files.keys()].filter((p) => p.startsWith(`${from}/`));
      for (const path of descendants) {
        this.files.set(`${to}${path.slice(from.length)}`, this.files.get(path)!);
        this.files.delete(path);
      }
      for (const folder of [...this.folders]) {
        if (folder === from || folder.startsWith(`${from}/`)) {
          this.folders.add(`${to}${folder.slice(from.length)}`);
          this.folders.delete(folder);
        }
      }
      this.folders.add(to);
      return;
    }
    throw new Error(`no such file or folder: ${from}`);
  }

  async remove(path: string): Promise<void> {
    if (!this.files.delete(path)) throw new Error(`no such file: ${path}`);
  }

  async stat(path: string): Promise<FakeStat | null> {
    const file = this.files.get(path);
    if (file !== undefined) {
      return {
        type: 'file',
        ctime: FIXED_MTIME,
        mtime: this.mtimes.get(path) ?? FIXED_MTIME,
        size: file.byteLength,
      };
    }
    if (path === '' || path === '/' || this.folders.has(path)) {
      return { type: 'folder', ctime: FIXED_MTIME, mtime: FIXED_MTIME, size: 0 };
    }
    return null;
  }

  async list(path: string): Promise<{ files: string[]; folders: string[] }> {
    // Real adapters see implicit parent dirs; materialize them for parity.
    for (const known of [...this.files.keys(), ...this.folders]) {
      ensureDirs(this.folders, known);
    }
    const prefix = path === '' || path === '/' ? '' : `${path}/`;
    const files: string[] = [];
    const folders: string[] = [];
    for (const candidate of this.files.keys()) {
      if (!candidate.startsWith(prefix)) continue;
      const rest = candidate.slice(prefix.length);
      if (rest === '' || rest.includes('/')) continue; // not a direct child file
      files.push(candidate);
    }
    for (const candidate of this.folders) {
      if (!candidate.startsWith(prefix)) continue;
      const rest = candidate.slice(prefix.length);
      if (rest === '' || rest.includes('/')) continue;
      folders.push(candidate);
    }
    files.sort();
    folders.sort();
    return { files, folders };
  }
}

function ensureDirs(folders: Set<string>, filePath: string): void {
  let current = '';
  for (const segment of filePath.split('/').slice(0, -1)) {
    current = current === '' ? segment : `${current}/${segment}`;
    folders.add(current);
  }
}

export interface FakeEventRef {
  name: string;
  fn: (...args: unknown[]) => unknown;
}

/** The vault event-emitter surface the watch adapter uses. */
export class FakeVault {
  readonly adapter = new FakeDataAdapter();
  readonly listeners: FakeEventRef[] = [];

  constructor(seed: Record<string, string> = {}) {
    for (const [path, content] of Object.entries(seed)) {
      this.adapter.files.set(path, new TextEncoder().encode(content));
      ensureDirs(this.adapter.folders, path);
    }
  }

  on(name: string, fn: (...args: unknown[]) => unknown): FakeEventRef {
    const ref = { name, fn };
    this.listeners.push(ref);
    return ref;
  }

  offref(ref: FakeEventRef): void {
    const index = this.listeners.indexOf(ref);
    if (index !== -1) this.listeners.splice(index, 1);
  }

  emit(name: string, ...args: unknown[]): void {
    for (const listener of [...this.listeners]) {
      if (listener.name === name) listener.fn(...args);
    }
  }

  get listenerNames(): string[] {
    return this.listeners.map((l) => l.name);
  }
}

/** The workspace surface the plugin touches (active-leaf-change). */
export class FakeWorkspace {
  private readonly listeners: FakeEventRef[] = [];

  on(name: string, fn: (...args: unknown[]) => unknown): FakeEventRef {
    const ref = { name, fn };
    this.listeners.push(ref);
    return ref;
  }

  offref(ref: FakeEventRef): void {
    const index = this.listeners.indexOf(ref);
    if (index !== -1) this.listeners.splice(index, 1);
  }

  emitActiveLeafChange(): void {
    for (const listener of [...this.listeners]) {
      if (listener.name === 'active-leaf-change') listener.fn(null);
    }
  }
}

/**
 * Build a fake `App` plus the handles tests need. Returns `{ app, vault,
 * workspace }` — cast `app` when passing to the plugin.
 */
export function makeFakeApp(vault = new FakeVault()): {
  app: unknown;
  vault: FakeVault;
  workspace: FakeWorkspace;
} {
  const workspace = new FakeWorkspace();
  return { app: { vault, workspace }, vault, workspace };
}
