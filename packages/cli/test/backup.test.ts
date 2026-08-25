/**
 * `vsa backup restore` — offline materialization of an NDJSON archive:
 * verified blobs, live heads written, tombstones skipped, missing blob for
 * a live head aborts loudly (a silently incomplete restore is the one thing
 * an escape hatch must never do).
 */

import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sha256Hex } from '@vsa/core';
import { runBackupRestore } from '../src/commands/backup.js';
import { OutputCapture } from './helpers.js';
import { CommandError, type VsRuntime } from '../src/runtime.js';

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);
const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

function fakeRuntime(): VsRuntime {
  return { output: new OutputCapture() } as unknown as VsRuntime;
}

async function tempFile(name: string, content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'vsa-backup-'));
  const file = join(dir, name);
  await writeFile(file, content, 'utf8');
  return file;
}

describe('runBackupRestore', () => {
  it('materializes live heads with verified content, skips tombstones, records history', async () => {
    const one = enc('note one body');
    const img = new Uint8Array([0, 1, 2, 255]);
    const archive = [
      JSON.stringify({ type: 'meta', format: 1, vaultName: 'personal', generated: 1 }),
      JSON.stringify({ type: 'blob', hash: await sha256Hex(one), content: b64(one) }),
      JSON.stringify({ type: 'blob', hash: await sha256Hex(img), content: b64(img) }),
      JSON.stringify({
        type: 'file',
        path: '/notes/one.md',
        hash: await sha256Hex(one),
        deleted: false,
        isFolder: false,
      }),
      JSON.stringify({ type: 'file', path: '/gone.md', hash: 'h-two', deleted: true, isFolder: false }),
      JSON.stringify({
        type: 'file',
        path: '/img.bin',
        hash: await sha256Hex(img),
        deleted: false,
        isFolder: false,
      }),
      JSON.stringify({
        type: 'version',
        path: '/notes/one.md',
        id: 'v1',
        hash: await sha256Hex(one),
      }),
    ].join('\n');
    const file = await tempFile('backup.ndjson', `${archive}\n`);
    const target = await mkdtemp(join(tmpdir(), 'vsa-restore-'));

    const result = await runBackupRestore(fakeRuntime(), file, target);

    expect(result.filesWritten).toBe(2);
    expect(result.tombstonesSkipped).toBe(1);
    expect(result.versionsRecorded).toBe(1);
    expect(new TextDecoder().decode(await readFile(join(target, 'notes/one.md')))).toBe('note one body');
    expect(Array.from(await readFile(join(target, 'img.bin')))).toEqual([0, 1, 2, 255]);
    const manifest = JSON.parse(await readFile(join(target, 'backup-manifest.json'), 'utf8')) as {
      versions: unknown[];
      meta: { vaultName: string };
    };
    expect(manifest.versions).toHaveLength(1);
    expect(manifest.meta.vaultName).toBe('personal');
  });

  it('aborts when a LIVE head’s blob is missing from the archive', async () => {
    const archive = [
      JSON.stringify({ type: 'meta', format: 1 }),
      JSON.stringify({ type: 'file', path: '/needs.md', hash: 'h-absent', deleted: false, isFolder: false }),
      JSON.stringify({ type: 'blob-missing', hash: 'h-absent' }),
    ].join('\n');
    const file = await tempFile('missing.ndjson', `${archive}\n`);
    const target = await mkdtemp(join(tmpdir(), 'vsa-restore-'));

    await expect(runBackupRestore(fakeRuntime(), file, target)).rejects.toThrow(/missing from the archive/);
  });

  it('rejects a corrupt line outright', async () => {
    const file = await tempFile('corrupt.ndjson', '{"type":"meta"\nnot-json\n');
    await expect(
      runBackupRestore(fakeRuntime(), file, await mkdtemp(join(tmpdir(), 'vsa-restore-'))),
    ).rejects.toThrow(CommandError);
  });
});
