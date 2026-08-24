/**
 * `vsa backup save|restore` — the trust escape hatch (free-tier longevity
 * pack): the ENTIRE vault — heads, full version history, every distinct
 * blob — as one streamed NDJSON archive, and an offline restore that works
 * with NO worker at all (heads materialize into a plain directory; history
 * lands in a sidecar manifest).
 *
 * The archive is line-oriented JSON (`application/x-ndjson`):
 *   {"type":"meta",…} / {"type":"file",…} / {"type":"version",…} /
 *   {"type":"blob","hash":…,"content":"base64"} / {"type":"blob-missing",…}
 * Every blob is sha256-verified on restore — the archive is self-validating.
 */

import { createWriteStream } from 'node:fs';
import { mkdir, readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { NodeStorageAdapter } from '@vsa/node-runtime';
import { sha256Hex } from '@vsa/core';
import { CommandError, requireSingleVault, type VsRuntime } from '../runtime.js';
import { WorkerApi } from '../http.js';

/** `20260824-145901` local time for default file names. */
function stamp(now: number): string {
  const d = new Date(now);
  const two = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}` +
    `-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`
  );
}

export interface BackupSaveResult {
  file: string;
  bytes: number;
  meta: {
    vaultName?: string;
    fileCount?: number;
    versionCount?: number;
    blobCount?: number;
  } | null;
  missingBlobs: number;
}

/**
 * `vsa backup save [--out <file>]` — stream `GET /backup` to disk. The
 * response body is consumed chunk by chunk (the archive can be large);
 * line tallies ride the same pass so the summary reflects what landed.
 */
export async function runBackupSave(
  runtime: VsRuntime,
  outPath: string | undefined,
  vaultRef: string | undefined,
): Promise<BackupSaveResult> {
  const vault = requireSingleVault(runtime, vaultRef);
  const token = runtime.configStore.getToken(vault.id);
  if (token === undefined) {
    throw new CommandError(`no device token for ${vault.name} — run \`vsa link\` first`);
  }
  const api = new WorkerApi({ baseUrl: vault.url, fetchImpl: runtime.fetchImpl, now: runtime.now });
  const response = await api.backup(token);
  if (response.status === 401) throw new CommandError('device token rejected — re-link this vault');
  if (!response.ok || response.body === null) {
    throw new CommandError(`backup failed: HTTP ${response.status}`);
  }
  const file = resolve(outPath ?? `vaultsync-backup-${vault.name}-${stamp(runtime.now())}.ndjson`);
  await mkdir(dirname(file), { recursive: true });

  let bytes = 0;
  let missingBlobs = 0;
  let headLine: string | null = null;
  let tail = '';
  const note = (text: string): void => {
    const lines = text.split('\n');
    lines[0] = tail + lines[0];
    tail = lines.pop() ?? '';
    for (const line of lines) {
      if (line === '') continue;
      if (headLine === null) headLine = line;
      if (line.includes('"type":"blob-missing"')) missingBlobs += 1;
    }
  };

  const source = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream);
  const output = createWriteStream(file);
  for await (const chunk of source) {
    const buffer = chunk as Buffer;
    bytes += buffer.byteLength;
    note(buffer.toString('utf8'));
    if (!output.write(buffer)) {
      await new Promise<void>((resolveWrite) => output.once('drain', () => resolveWrite()));
    }
  }
  note('\n');
  await new Promise<void>((resolveEnd, rejectEnd) => {
    output.end(() => resolveEnd());
    output.on('error', rejectEnd);
  });

  let meta: BackupSaveResult['meta'] = null;
  if (headLine !== null) {
    try {
      const parsed = JSON.parse(headLine) as BackupSaveResult['meta'] & { type?: string };
      if (parsed.type === 'meta') meta = parsed;
    } catch {
      // unreadable first line — counts stay unknown, the archive still exists
    }
  }
  return { file, bytes, meta, missingBlobs };
}

// --- restore -------------------------------------------------------------------------

export interface BackupRestoreResult {
  target: string;
  filesWritten: number;
  blobsVerified: number;
  versionsRecorded: number;
  tombstonesSkipped: number;
  missingBlobs: string[];
  manifest: string;
}

/**
 * `vsa backup restore <file> --into <dir>` — offline materialization. Every
 * live (non-tombstoned, non-folder) head is written into `dir` with its
 * verified content; the full version history is preserved next to it in
 * `backup-manifest.json` (machine-readable). A missing blob for a LIVE head
 * aborts — a silently incomplete restore would betray the whole point;
 * `blob-missing` rows for versions nobody needs are recorded, not fatal.
 */
export async function runBackupRestore(
  runtime: VsRuntime,
  file: string,
  targetDir: string,
): Promise<BackupRestoreResult> {
  const target = resolve(targetDir);
  const text = await readFile(resolve(file), 'utf8');
  const blobs = new Map<string, Uint8Array>();
  const files: Array<{ path: string; hash: string; deleted: boolean; isFolder: boolean }> = [];
  const versions: Array<Record<string, unknown>> = [];
  const missingBlobs: string[] = [];
  let meta: Record<string, unknown> | null = null;

  for (const line of text.split('\n')) {
    if (line.trim() === '') continue;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(line) as Record<string, unknown>;
    } catch {
      throw new CommandError(`corrupt backup line: ${line.slice(0, 120)}…`);
    }
    switch (parsed.type) {
      case 'meta':
        meta = parsed;
        break;
      case 'blob': {
        const bytes = base64ToBytes(String(parsed.content));
        const hash = await sha256Hex(bytes);
        if (hash !== parsed.hash) {
          throw new CommandError(
            `blob ${String(parsed.hash)} failed sha256 verification on restore — the archive is corrupt`,
          );
        }
        blobs.set(String(parsed.hash), bytes);
        break;
      }
      case 'blob-missing':
        missingBlobs.push(String(parsed.hash));
        break;
      case 'file':
        files.push({
          path: String(parsed.path),
          hash: String(parsed.hash),
          deleted: parsed.deleted === true,
          isFolder: parsed.isFolder === true,
        });
        break;
      case 'version':
        versions.push(parsed);
        break;
      default:
        break; // unknown future row — preserved verbatim in the manifest
    }
  }

  const storage = new NodeStorageAdapter({ root: target });
  let filesWritten = 0;
  let tombstonesSkipped = 0;
  for (const fileEntry of files) {
    if (fileEntry.deleted) {
      tombstonesSkipped += 1;
      continue;
    }
    if (fileEntry.isFolder) continue; // directories materialize with their files
    const bytes = blobs.get(fileEntry.hash);
    if (bytes === undefined) {
      throw new CommandError(
        `cannot restore ${fileEntry.path}: its blob is missing from the archive (GC raced the export) — re-run \`vsa backup save\` and retry`,
      );
    }
    await storage.writeFile(fileEntry.path, bytes);
    filesWritten += 1;
  }

  const manifestPath = join(target, 'backup-manifest.json');
  await storage.writeFile(
    '/backup-manifest.json',
    new TextEncoder().encode(`${JSON.stringify({ meta, files, versions, missingBlobs }, null, 2)}\n`),
  );

  runtime.output.log(`restored ${filesWritten} files into ${target}`);
  runtime.output.log(
    `history: ${versions.length} versions recorded in backup-manifest.json` +
      (tombstonesSkipped > 0 ? `; ${tombstonesSkipped} tombstones skipped` : ''),
  );
  return {
    target,
    filesWritten,
    blobsVerified: blobs.size,
    versionsRecorded: versions.length,
    tombstonesSkipped,
    missingBlobs,
    manifest: manifestPath,
  };
}

function base64ToBytes(value: string): Uint8Array {
  const buffer = Buffer.from(value, 'base64');
  return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
}
