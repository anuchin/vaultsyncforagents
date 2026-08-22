/**
 * The pure-JS zip extraction behind `vsa setup` (src/cloudflare.ts
 * `extractZip` — fflate, no system tar/unzip): the release-bundle layout
 * (worker.js + dashboard/**), nested directories, directory-marker entries,
 * binary payloads, zip-slip refusal, corrupt/missing archives, and the
 * zip-bomb gate (declared central-directory sizes checked before anything is
 * inflated). The zips are built in-memory with fflate itself, so no system
 * tool is ever needed here either — proving the published package's
 * extraction is self-contained.
 */

import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
  createCloudflareControl,
  MAX_ARCHIVE_UNCOMPRESSED_BYTES,
  MAX_ENTRY_UNCOMPRESSED_BYTES,
} from '../src/cloudflare.js';

/** Zip the release-bundle layout: worker.js + dashboard/** (+ a directory marker). */
function bundleZip(): Uint8Array {
  return zipSync({
    'worker.js': strToU8('export { VaultRoom };\n'),
    'dashboard/': new Uint8Array(0),
    'dashboard/index.html': strToU8('<!doctype html><title>dashboard</title>'),
    'dashboard/assets/app.js': new Uint8Array([0, 1, 2, 254, 255]),
  });
}

describe('extractZip (pure JS, no system tools)', () => {
  it('extracts the release-bundle layout: worker.js + dashboard/** with nested dirs', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vsa-unzip-'));
    const zipPath = join(dir, 'worker-bundle.zip');
    await writeFile(zipPath, bundleZip());

    const control = createCloudflareControl({ exec: async () => ({ code: 127, stdout: '', stderr: 'no system tools' }) });
    const result = await control.extractZip(zipPath, join(dir, 'dist'));

    expect(result.code).toBe(0);
    expect(result.stderr).toBe('');
    const dist = join(dir, 'dist');
    expect(await readFile(join(dist, 'worker.js'), 'utf8')).toBe('export { VaultRoom };\n');
    expect(await readFile(join(dist, 'dashboard/index.html'), 'utf8')).toContain('dashboard');
    expect(new Uint8Array(await readFile(join(dist, 'dashboard/assets/app.js')))).toEqual(
      new Uint8Array([0, 1, 2, 254, 255]),
    );
    // The directory marker did not become a file.
    expect((await readdir(join(dist, 'dashboard'))).sort()).toEqual(['assets', 'index.html']);
  });

  it('overwrites existing files (re-running setup in the same directory)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vsa-unzip-'));
    const zipPath = join(dir, 'worker-bundle.zip');
    await writeFile(zipPath, zipSync({ 'worker.js': strToU8('new') }));
    const dist = join(dir, 'dist');
    await mkdir(join(dist), { recursive: true });
    await writeFile(join(dist, 'worker.js'), 'old stale bytes');

    const result = await createCloudflareControl().extractZip(zipPath, dist);

    expect(result.code).toBe(0);
    expect(await readFile(join(dist, 'worker.js'), 'utf8')).toBe('new');
  });

  it('refuses entries that escape the destination (zip-slip)', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vsa-unzip-'));
    const zipPath = join(dir, 'worker-bundle.zip');
    await writeFile(zipPath, zipSync({ '../evil.txt': strToU8('nope') }));

    const result = await createCloudflareControl().extractZip(zipPath, join(dir, 'dist'));

    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/escapes/);
    const parent = await readdir(dir);
    expect(parent).not.toContain('evil.txt');
  });

  it('corrupt archive: code 1 with the parse error, never a crash', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vsa-unzip-'));
    const zipPath = join(dir, 'worker-bundle.zip');
    await writeFile(zipPath, new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));

    const result = await createCloudflareControl().extractZip(zipPath, join(dir, 'dist'));

    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/invalid zip archive/);
  });

  it('missing archive: code 1 with the filesystem error', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vsa-unzip-'));
    const result = await createCloudflareControl().extractZip(
      join(dir, 'nope.zip'),
      join(dir, 'dist'),
    );
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/nope\.zip/);
  });
});

// --- zip-bomb gate ----------------------------------------------------------------------------

/**
 * Overwrite one central-directory entry's DECLARED uncompressed size in an
 * otherwise valid fflate zip — the archive a bomb ships: tiny on the wire,
 * huge in the directory. Only the 4 size bytes are patched; the entry's real
 * compressed payload stays 4 bytes, so a gate that rejects without inflating
 * costs nothing, while one that inflates first would have to allocate.
 */
function withDeclaredUncompressedSize(zip: Uint8Array, entryIndex: number, size: number): Uint8Array {
  const copy = new Uint8Array(zip);
  const view = new DataView(copy.buffer, copy.byteOffset, copy.byteLength);
  let found = 0;
  for (let i = 0; i + 4 <= copy.length; i += 1) {
    if (view.getUint32(i, true) === 0x0201_4b50) {
      if (found === entryIndex) {
        view.setUint32(i + 24, size, true); // uncompressedSize field
        return copy;
      }
      found += 1;
    }
  }
  throw new Error(`central-directory entry ${entryIndex} not found`);
}

describe('extractZip: zip-bomb gate (declared sizes, pre-inflation)', () => {
  it('rejects an entry declaring a huge uncompressed size without inflating it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vsa-unzip-'));
    const zipPath = join(dir, 'worker-bundle.zip');
    // 200 MB fits the u32 central-directory field and dwarfs the 100 MB cap.
    await writeFile(
      zipPath,
      withDeclaredUncompressedSize(
        zipSync({ 'worker.js': strToU8('tiny') }),
        0,
        200 * 1024 * 1024,
      ),
    );

    const result = await createCloudflareControl().extractZip(zipPath, join(dir, 'dist'));

    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/refusing to extract worker\.js: declares 200\.0 MB uncompressed/);
    expect(result.stderr).toMatch(/per-entry cap \(possible zip bomb\)/);
    // Nothing was written — the gate fired before extraction.
    expect(await readdir(join(dir, 'dist')).catch(() => ['(absent)'])).toEqual(['(absent)']);
  });

  it('rejects an aggregate over the 250 MB cap even when every entry is under the per-entry cap', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vsa-unzip-'));
    const zipPath = join(dir, 'worker-bundle.zip');
    const threeEntries = zipSync({
      'worker.js': strToU8('tiny'),
      'dashboard/index.html': strToU8('tiny'),
      'dashboard/assets/app.js': strToU8('tiny'),
    });
    // 3 × 90 MB = 270 MB declared: each legal alone, together a bomb.
    const perEntry = Math.floor(MAX_ARCHIVE_UNCOMPRESSED_BYTES / 3) + (10 * 1024 * 1024);
    expect(perEntry).toBeLessThanOrEqual(MAX_ENTRY_UNCOMPRESSED_BYTES);
    let patched: Uint8Array = threeEntries;
    for (let entry = 0; entry < 3; entry += 1) {
      patched = withDeclaredUncompressedSize(patched, entry, perEntry);
    }
    await writeFile(zipPath, patched);

    const result = await createCloudflareControl().extractZip(zipPath, join(dir, 'dist'));

    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/refusing to extract the archive: entries declare/);
    expect(result.stderr).toMatch(/in total, over the 250\.0 MB cap/);
  });

  it('a zip64 size claim without a zip64 extra field is refused as corrupt', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'vsa-unzip-'));
    const zipPath = join(dir, 'worker-bundle.zip');
    // 0xFFFFFFFF = "size lives in the zip64 extra field" — which this zip lacks.
    await writeFile(
      zipPath,
      withDeclaredUncompressedSize(zipSync({ 'worker.js': strToU8('tiny') }), 0, 0xffffffff),
    );

    const result = await createCloudflareControl().extractZip(zipPath, join(dir, 'dist'));

    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/zip64 sizes but carries no zip64 extra field/);
  });
});
