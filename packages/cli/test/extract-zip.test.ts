/**
 * The pure-JS zip extraction behind `vsa setup` (src/cloudflare.ts
 * `extractZip` — fflate, no system tar/unzip): the release-bundle layout
 * (worker.js + dashboard/**), nested directories, directory-marker entries,
 * binary payloads, zip-slip refusal, and corrupt/missing archives. The zips
 * are built in-memory with fflate itself, so no system tool is ever needed
 * here either — proving the published package's extraction is self-contained.
 */

import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { createCloudflareControl } from '../src/cloudflare.js';

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
