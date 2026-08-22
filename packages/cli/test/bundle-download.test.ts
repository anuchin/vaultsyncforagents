/**
 * The release-bundle download path (src/cloudflare.ts `download` →
 * `downloadBundle`): integrity verification — a pinned SHA-256 hard-fails on
 * mismatch, the release's `.sha256` sidecar (sha256sum form, case-insensitive
 * hex) takes over when no digest is pinned, and older releases with neither
 * only warn — plus the download size cap (declared content-length refused
 * before a byte is read, streaming bodies aborted at the cap). All fetches
 * are fakes; no network.
 */

import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { strToU8 } from 'fflate';
import {
  createCloudflareControl,
  MAX_BUNDLE_DOWNLOAD_BYTES,
} from '../src/cloudflare.js';

const BUNDLE_URL =
  'https://github.com/anuchin/vaultsyncforagents/releases/download/v0.1.3/worker-bundle.zip';
const SIDECAR_URL = `${BUNDLE_URL}.sha256`;
const BUNDLE = strToU8('export { VaultRoom };\n');
const BUNDLE_SHA = createHash('sha256').update(BUNDLE).digest('hex');

/** fetch fake: exact-URL routing; unrouted URLs are 404s (the sidecar case). */
function fakeFetch(
  routes: Record<string, Response>,
  fetched: string[] = [],
): typeof fetch {
  return (async (input: RequestInfo | URL): Promise<Response> => {
    const url = String(input);
    fetched.push(url);
    const response = routes[url];
    return response ?? new Response('not found', { status: 404 });
  }) as typeof fetch;
}

describe('download: integrity verification', () => {
  it('pinned sha256 matching the bundle passes (and skips the sidecar fetch)', async () => {
    const fetched: string[] = [];
    const control = createCloudflareControl({
      fetchImpl: fakeFetch({ [BUNDLE_URL]: new Response(BUNDLE) }, fetched),
      bundleSha256: BUNDLE_SHA.toUpperCase(), // hex is case-insensitive
    });

    await expect(control.download(BUNDLE_URL)).resolves.toEqual(BUNDLE);
    expect(fetched).toEqual([BUNDLE_URL]);
  });

  it('pinned sha256 mismatching the bundle hard-fails', async () => {
    const control = createCloudflareControl({
      fetchImpl: fakeFetch({ [BUNDLE_URL]: new Response(BUNDLE) }),
      bundleSha256: createHash('sha256').update('tampered elsewhere').digest('hex'),
    });

    await expect(control.download(BUNDLE_URL)).rejects.toThrow(
      /integrity check FAILED.*pinned/s,
    );
  });

  it('unpinned: matching .sha256 sidecar passes (sha256sum form, uppercase hex ok)', async () => {
    const fetched: string[] = [];
    const control = createCloudflareControl({
      fetchImpl: fakeFetch(
        {
          [BUNDLE_URL]: new Response(BUNDLE),
          [SIDECAR_URL]: new Response(`${BUNDLE_SHA.toUpperCase()}  worker-bundle.zip\n`),
        },
        fetched,
      ),
    });

    await expect(control.download(BUNDLE_URL)).resolves.toEqual(BUNDLE);
    expect(fetched).toEqual([BUNDLE_URL, SIDECAR_URL]);
  });

  it('unpinned: mismatching .sha256 sidecar hard-fails', async () => {
    const control = createCloudflareControl({
      fetchImpl: fakeFetch({
        [BUNDLE_URL]: new Response(BUNDLE),
        [SIDECAR_URL]: new Response(`${'ab'.repeat(32)}  worker-bundle.zip\n`),
      }),
    });

    await expect(control.download(BUNDLE_URL)).rejects.toThrow(
      /integrity check FAILED.*release's/s,
    );
  });

  it('unpinned: a sidecar without a digest is refused, not ignored', async () => {
    const control = createCloudflareControl({
      fetchImpl: fakeFetch({
        [BUNDLE_URL]: new Response(BUNDLE),
        [SIDECAR_URL]: new Response('<html>error page</html>'),
      }),
    });

    await expect(control.download(BUNDLE_URL)).rejects.toThrow(/invalid \.sha256 sidecar/);
  });

  it('neither pin nor sidecar (older release): warns and proceeds', async () => {
    const warnings: string[] = [];
    const control = createCloudflareControl({
      fetchImpl: fakeFetch({ [BUNDLE_URL]: new Response(BUNDLE) }),
      warn: (message) => warnings.push(message),
    });

    await expect(control.download(BUNDLE_URL)).resolves.toEqual(BUNDLE);
    expect(warnings.join('\n')).toMatch(/no integrity check available.*proceeding unverified/s);
  });

  it('non-OK bundle response still surfaces the HTTP status', async () => {
    const control = createCloudflareControl({
      fetchImpl: fakeFetch({}),
    });

    await expect(control.download(BUNDLE_URL)).rejects.toThrow(/HTTP 404/);
  });
});

describe('download: size cap', () => {
  it('a declared content-length over the cap is refused before the body is read', async () => {
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(strToU8('x'));
        controller.close();
      },
    });
    const oversized = new Response(body, {
      headers: { 'content-length': String(MAX_BUNDLE_DOWNLOAD_BYTES + 1) },
    });
    const control = createCloudflareControl({
      fetchImpl: fakeFetch({ [BUNDLE_URL]: oversized }),
    });

    // The "declared" wording is the pre-read branch: a code path that had
    // touched the body would fail with the mid-stream abort wording instead
    // (or never fail at all) — undici pulls streams on its own schedule, so
    // the message is the reliable witness of which branch refused.
    await expect(control.download(BUNDLE_URL)).rejects.toThrow(/100\.0 MB declared, over the/);
  });

  it('a streaming body crossing the cap is aborted mid-flight', async () => {
    const warnings: string[] = [];
    let cancelled = false;
    const trickle = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 4; i += 1) controller.enqueue(strToU8('0123456789abcdef')); // 16 B each
      },
      cancel() {
        cancelled = true;
      },
    });
    const control = createCloudflareControl({
      fetchImpl: fakeFetch({ [BUNDLE_URL]: new Response(trickle) }),
      maxDownloadBytes: 32, // two chunks fit, the third crosses the line
      warn: (message) => warnings.push(message),
    });

    await expect(control.download(BUNDLE_URL)).rejects.toThrow(/passed the 32 bytes cap/);
    expect(cancelled).toBe(true);
    expect(warnings).toEqual([]); // a cap breach is a failure, never a warning
  });

  it('a body within the cap passes through untouched', async () => {
    const control = createCloudflareControl({
      fetchImpl: fakeFetch({ [BUNDLE_URL]: new Response(BUNDLE) }),
      maxDownloadBytes: 1024,
    });

    await expect(control.download(BUNDLE_URL)).resolves.toEqual(BUNDLE);
  });
});
