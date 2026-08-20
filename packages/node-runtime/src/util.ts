/**
 * Small Node-side utilities shared by the storage adapter and the config
 * store: atomic file replacement (temp + fsync + rename) and best-effort
 * owner-only permissions.
 *
 * Windows notes: `fs.rename` replaces an existing destination on Windows
 * (MoveFileEx MOVEFILE_REPLACE_EXISTING semantics), so the temp+rename
 * pattern is a genuine atomic-overwrite on every supported platform.
 * `fs.chmod` 0600 is best-effort — Windows only honors the read-only bit.
 */

import {
  chmodSync,
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { chmod, mkdir, open, rename, unlink } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomBytes } from 'node:crypto';

/**
 * Write `data` to `filePath` atomically: write a sibling temp file, fsync it,
 * rename over the destination. Creates parent directories as needed.
 */
export async function writeFileAtomic(filePath: string, data: Uint8Array): Promise<void> {
  const temp = tempPathFor(filePath);
  await mkdir(dirname(filePath), { recursive: true });
  let handle: FileHandle | null = null;
  try {
    handle = await open(temp, 'w');
    await handle.writeFile(data);
    await handle.sync();
    await handle.close();
    handle = null;
    await renameWithRetry(temp, filePath);
  } catch (error) {
    if (handle !== null) await handle.close().catch(() => {});
    await unlink(temp).catch(() => {});
    throw error;
  }
}

/** Atomic write for small text files (machine config). */
export function writeFileAtomicSync(filePath: string, text: string): void {
  const temp = tempPathFor(filePath);
  try {
    mkdirSync(dirname(filePath), { recursive: true });
    const handle = openSync(temp, 'w');
    try {
      writeFileSync(handle, text, 'utf8');
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
    renameSyncWithRetry(temp, filePath);
  } catch (error) {
    try {
      unlinkSync(temp);
    } catch {
      // temp was never created
    }
    throw error;
  }
}

/**
 * `rename` is the atomic-replace primitive on every platform, but Windows
 * fails with EPERM when the destination is briefly held open by another
 * handle (antivirus, indexer, a concurrent atomic write to the same path —
 * graceful-fs exists for exactly this). Retry a few times with a short
 * backoff before giving up.
 */
const RENAME_RETRIES = 5;
const RENAME_BACKOFF_MS = 25;

export async function renameWithRetry(from: string, to: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = (error as { code?: string }).code;
      const retriable = code === 'EPERM' || code === 'EACCES' || code === 'ENOTEMPTY' || code === 'EBUSY';
      if (!retriable || attempt >= RENAME_RETRIES - 1) throw error;
      await sleep(RENAME_BACKOFF_MS * (attempt + 1));
    }
  }
}

export function renameSyncWithRetry(from: string, to: string): void {
  for (let attempt = 0; ; attempt++) {
    try {
      renameSync(from, to);
      return;
    } catch (error) {
      const code = (error as { code?: string }).code;
      const retriable = code === 'EPERM' || code === 'EACCES' || code === 'ENOTEMPTY' || code === 'EBUSY';
      if (!retriable || attempt >= RENAME_RETRIES - 1) throw error;
      sleepSync(RENAME_BACKOFF_MS * (attempt + 1));
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sleepSync(ms: number): void {
  // Atomics.wait is Node's only synchronous sleep (config writes are rare).
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Best-effort 0600 (owner-only). On Windows this only toggles the read-only bit. */
export async function chmodOwnerOnly(filePath: string): Promise<void> {
  try {
    await chmod(filePath, 0o600);
  } catch {
    // Windows FAT, some network mounts, and non-owners reject chmod — the
    // spec calls this best-effort, so failures are deliberately swallowed.
  }
}

/** Sync {@link chmodOwnerOnly}. */
export function chmodOwnerOnlySync(filePath: string): void {
  try {
    chmodSync(filePath, 0o600);
  } catch {
    // best-effort on Windows by design
  }
}

function tempPathFor(filePath: string): string {
  const base = filePath.split(/[\\/]/).pop() ?? 'file';
  return join(
    dirname(filePath),
    `.${base}.tmp-${process.pid}-${randomBytes(4).toString('hex')}`,
  );
}
