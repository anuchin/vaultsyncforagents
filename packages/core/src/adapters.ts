/**
 * The portability seam (ARCHITECTURE.md §8).
 *
 * Everything above this line in `core` is pure TypeScript + Web APIs.
 * Platform capabilities — filesystem, watching, logging — reach the engine
 * only through these interfaces:
 *
 * - Obsidian plugin: vault-adapter implementations
 * - daemon/CLI: Node fs + chokidar implementations
 * - tests: `adapters/memory.ts` + temp-dir implementations
 *
 * Contract: all paths crossing this seam are vault-internal POSIX paths
 * (see `paths.ts`), never host-absolute paths.
 */

/** Emitted by a `WatchAdapter`, batched by the engine after debouncing. */
export interface FileChangeEvent {
  kind: 'add' | 'modify' | 'delete' | 'rename';
  /** Vault path of the changed entry. */
  path: string;
  /** Destination path — only for `kind: 'rename'`. */
  toPath?: string;
}

/** A file (never a directory) as returned by `StorageAdapter.listFiles`. */
export interface FileStat {
  path: string;
  /** Content size in bytes. */
  size: number;
  /** Epoch ms of last modification (display/heuristic only). */
  mtime: number;
}

/** Platform filesystem access. Implementations must be safe to call concurrently. */
export interface StorageAdapter {
  /** Read a file's full content. Throws if missing. */
  readFile(path: string): Promise<Uint8Array>;
  /** Write a file atomically (temp + rename), creating parent dirs as needed. */
  writeFile(path: string, data: Uint8Array): Promise<void>;
  /**
   * Delete a file. Idempotent: deleting a missing path is not an error —
   * sync code must not have to pre-check existence.
   */
  deleteFile(path: string): Promise<void>;
  /** Move/rename a file. Throws if `from` is missing; may overwrite `to`. */
  renameFile(from: string, to: string): Promise<void>;
  /** Recursive listing of every file under the vault root, sorted by path. */
  listFiles(): Promise<readonly FileStat[]>;
  /**
   * Recursive listing of every directory currently present under the vault
   * root — including the root itself and empty folders — sorted by path.
   * This is how scans discover empty-folder placeholder candidates (FR-10);
   * `listFiles` cannot see them since it lists files only.
   */
  listDirs(): Promise<readonly string[]>;
  /** Create a directory (and ancestors); idempotent. */
  ensureDir(path: string): Promise<void>;
  /** Whether a file or directory exists at `path`. */
  exists(path: string): Promise<boolean>;
}

/** Platform file-watching. Implementations batch raw events; the engine debounces. */
export interface WatchAdapter {
  start(cb: (events: readonly FileChangeEvent[]) => void): void;
  stop(): void;
}

/** Platform logging. No required formatting; `details` are structured extras. */
export interface LogAdapter {
  debug(message: string, ...details: unknown[]): void;
  info(message: string, ...details: unknown[]): void;
  warn(message: string, ...details: unknown[]): void;
  error(message: string, ...details: unknown[]): void;
}
