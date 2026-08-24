/**
 * `src/bundle.ts` — the wizard's release-bundle acquisition: integrity
 * ladder (pinned digest → sidecar → warn), size caps, and the bundle layout
 * split (worker.js + dashboard/**). All against a faked network and real
 * zips built in-memory with fflate.
 */

import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
  BundleDownloadError,
  BundleFormatError,
  downloadWorkerBundle,
  extractBundle,
} from '../src/bundle.js';

const URL_ = 'https://github.com/anuchin/vaultsyncforagents/releases/download/v0.1.4/worker-bundle.zip';

/** The release-bundle layout: worker.js + dashboard/** (+ a directory marker). */
function bundleZip(): Uint8Array {
  return zipSync({
    'worker.js': strToU8('export { VaultRoom };\n'),
    'dashboard/': new Uint8Array(0),
    'dashboard/index.html': strToU8('<!doctype html><title>dashboard</title>'),
    'dashboard/assets/app.js': new Uint8Array([0, 1, 2, 254, 255]),
  });
}

const sha = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** fetch fake: exact-URL routing; unrouted URLs are 404s (the sidecar case). */
function fakeFetch(routes: Record<string, Response>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    const response = routes[url];
    if (response !== undefined) return response;
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
}

const jsonResponse = (body: Uint8Array): Response =>
  new Response(body as unknown as BodyInit, { status: 200, headers: { 'content-length': String(body.byteLength) } });

describe('downloadWorkerBundle', () => {
  it('accepts a body matching the pinned digest', async () => {
    const zip = bundleZip();
    const bytes = await downloadWorkerBundle(URL_, {
      fetchImpl: fakeFetch({ [URL_]: jsonResponse(zip) }),
      pinnedSha256: sha(zip),
    });
    expect(bytes.byteLength).toBe(zip.byteLength);
  });

  it('hard-fails on a digest mismatch', async () => {
    const zip = bundleZip();
    await expect(
      downloadWorkerBundle(URL_, {
        fetchImpl: fakeFetch({ [URL_]: jsonResponse(zip) }),
        pinnedSha256: '0'.repeat(64),
      }),
    ).rejects.toThrow(BundleDownloadError);
    await expect(
      downloadWorkerBundle(URL_, {
        fetchImpl: fakeFetch({ [URL_]: jsonResponse(zip) }),
        pinnedSha256: '0'.repeat(64),
      }),
    ).rejects.toThrow(/integrity check FAILED/);
  });

  it('falls back to the .sha256 sidecar when no digest is pinned', async () => {
    const zip = bundleZip();
    const bytes = await downloadWorkerBundle(URL_, {
      fetchImpl: fakeFetch({
        [URL_]: jsonResponse(zip),
        [`${URL_}.sha256`]: new Response(`${sha(zip)}  worker-bundle.zip\n`, { status: 200 }),
      }),
      pinnedSha256: '',
    });
    expect(bytes.byteLength).toBe(zip.byteLength);
  });

  it('warns and proceeds when neither pin nor sidecar exists (legacy release)', async () => {
    const zip = bundleZip();
    const warn = vi.fn();
    const bytes = await downloadWorkerBundle(URL_, {
      fetchImpl: fakeFetch({ [URL_]: jsonResponse(zip) }),
      pinnedSha256: '',
      warn,
    });
    expect(bytes.byteLength).toBe(zip.byteLength);
    expect(warn).toHaveBeenCalledWith(expect.stringMatching(/no integrity check available/));
  });

  it('refuses oversized bodies', async () => {
    const zip = bundleZip();
    await expect(
      downloadWorkerBundle(URL_, {
        fetchImpl: fakeFetch({ [URL_]: jsonResponse(zip) }),
        pinnedSha256: sha(zip),
        maxBytes: 10,
      }),
    ).rejects.toThrow(/refusing to download/);
  });

  it('surfaces HTTP failures', async () => {
    await expect(
      downloadWorkerBundle(URL_, { fetchImpl: fakeFetch({}), pinnedSha256: '' }),
    ).rejects.toThrow(/HTTP 404/);
  });
});

describe('extractBundle', () => {
  it('splits worker.js from dashboard assets', async () => {
    const contents = await extractBundle(bundleZip());
    expect(new TextDecoder().decode(contents.workerJs)).toBe('export { VaultRoom };\n');
    expect([...contents.assets.keys()].sort()).toEqual(['assets/app.js', 'index.html']);
    expect(contents.assets.get('index.html')).toEqual(strToU8('<!doctype html><title>dashboard</title>'));
  });

  it('rejects a zip without worker.js', async () => {
    const zip = zipSync({ 'dashboard/index.html': strToU8('<html>') });
    await expect(extractBundle(zip)).rejects.toThrow(BundleFormatError);
  });

  it('rejects a zip without dashboard/index.html', async () => {
    const zip = zipSync({ 'worker.js': strToU8('export {}') });
    await expect(extractBundle(zip)).rejects.toThrow(/missing dashboard\/index.html/);
  });

  it('runs the zip-bomb gate before inflating', async () => {
    const zip = zipSync({ 'worker.js': strToU8('x') });
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    let eocd = -1;
    for (let i = zip.length - 22; i >= 0; i -= 1) {
      if (view.getUint32(i, true) === 0x0605_4b50) {
        eocd = i;
        break;
      }
    }
    const cd = view.getUint32(eocd + 16, true);
    view.setUint32(cd + 24, 0x7fff_ffff, true);
    await expect(extractBundle(zip)).rejects.toThrow(/zip bomb/);
  });
});
