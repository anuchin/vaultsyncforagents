/**
 * Release-bundle acquisition for the in-app setup wizard: download the
 * pinned `worker-bundle.zip` from the public GitHub release, verify its
 * integrity (pinned SHA-256 from `@vsa/core`, else the release's `.sha256`
 * sidecar), and split it into the two parts the deploy needs — `worker.js`
 * and the `dashboard/` static assets.
 *
 * Plugin-local twin of the CLI's download path (`cli/src/cloudflare.ts`):
 * Web APIs only (fetch, FormData, fflate), no Node imports, and every
 * outgoing call rides the same injectable-fetch seam the rest of the plugin
 * uses — unit tests fake the network, never the filesystem.
 *
 * Security posture mirrors the CLI exactly: the extracted worker.js is
 * deployed into the user's Cloudflare account, so a tampered or bomb
 * archive must never get that far — hard-fail on digest mismatch, refuse
 * oversized downloads, and gate declared zip sizes before inflating.
 */

import {
  PINNED_BUNDLE_SHA256,
  RELEASE_BUNDLE_URL,
  MAX_BUNDLE_DOWNLOAD_BYTES,
  assertWithinZipCaps,
  sha256Hex,
} from '@vsa/core';
import { unzip } from 'fflate';

/** Non-2xx or unreachable download. */
export class BundleDownloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BundleDownloadError';
  }
}

/** The zip is not a worker bundle (missing worker.js / dashboard). */
export class BundleFormatError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BundleFormatError';
  }
}

export interface DownloadBundleOptions {
  /** Injectable fetch (tests). Defaults to the global. */
  fetchImpl?: typeof fetch;
  /** SHA-256 override (tests); defaults to the pinned release digest. */
  pinnedSha256?: string;
  /** Sink for non-fatal notices (default: console.warn). */
  warn?: (message: string) => void;
  /** Refuse bodies above this many bytes (default: the core cap, 100 MB). */
  maxBytes?: number;
}

/**
 * Download the pinned release bundle with a size cap and integrity
 * verification — the same three-step contract as the CLI path: pinned digest
 * → `.sha256` sidecar → (legacy releases) warn and proceed.
 */
export async function downloadWorkerBundle(
  url: string = RELEASE_BUNDLE_URL,
  options: DownloadBundleOptions = {},
): Promise<Uint8Array> {
  const doFetch = options.fetchImpl ?? globalThis.fetch.bind(globalThis);
  const warn = options.warn ?? ((message: string) => console.warn(message));
  const maxBytes = options.maxBytes ?? MAX_BUNDLE_DOWNLOAD_BYTES;

  let response: Response;
  try {
    response = await doFetch(url);
  } catch (error) {
    throw new BundleDownloadError(
      `could not download the worker bundle from ${url} (${
        error instanceof Error ? error.message : String(error)
      })`,
    );
  }
  if (!response.ok) {
    throw new BundleDownloadError(
      `could not download the worker bundle from ${url} (HTTP ${response.status})`,
    );
  }

  const declared = Number(response.headers.get('content-length') ?? '0');
  if (declared > maxBytes) {
    throw new BundleDownloadError(
      `refusing to download the worker bundle from ${url}: ${declared} bytes declared, over the ${maxBytes} cap`,
    );
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > maxBytes) {
    throw new BundleDownloadError(
      `refusing to download the worker bundle from ${url}: body of ${bytes.byteLength} bytes exceeds the ${maxBytes} cap`,
    );
  }

  const actual = await sha256Hex(bytes);
  const pinned = (options.pinnedSha256 ?? PINNED_BUNDLE_SHA256).trim().toLowerCase();
  if (pinned !== '') {
    if (pinned !== actual) {
      throw new BundleDownloadError(
        `worker bundle integrity check FAILED for ${url}: sha256 ${actual} does not match the pinned ${pinned} — the download is corrupted or tampered with; refusing to deploy it`,
      );
    }
    return bytes;
  }

  // No pin baked in: the release's sidecar is the authority.
  let sidecar: Response | null = null;
  try {
    const probe = await doFetch(`${url}.sha256`);
    if (probe.ok) sidecar = probe;
  } catch {
    // unreachable sidecar — same as absent, handled below
  }
  if (sidecar === null) {
    warn(
      `no integrity check available for the worker bundle (${url} ships no .sha256 sidecar and no digest is pinned) — proceeding unverified`,
    );
    return bytes;
  }
  const expected = /[0-9a-fA-F]{64}/.exec(await sidecar.text())?.[0]?.toLowerCase() ?? null;
  if (expected === null) {
    throw new BundleDownloadError(
      `invalid .sha256 sidecar at ${url}.sha256 (no 64-hex digest found) — refusing to deploy`,
    );
  }
  if (expected !== actual) {
    throw new BundleDownloadError(
      `worker bundle integrity check FAILED for ${url}: sha256 ${actual} does not match the release's ${expected} — the download is corrupted or tampered with; refusing to deploy it`,
    );
  }
  return bytes;
}

/** The bundle's two deployable parts. */
export interface BundleContents {
  /** `worker.js` — the ESM entry exporting `VaultRoom`. */
  workerJs: Uint8Array;
  /** `dashboard/**` entries, keyed by zip path (forward slashes, no `dashboard/` prefix). */
  assets: Map<string, Uint8Array>;
}

/**
 * Split a verified bundle zip into worker.js + dashboard assets. The
 * zip-bomb gate (`@vsa/core`) runs before anything is inflated; layout
 * violations are `BundleFormatError`s with the entry name in the message.
 */
export async function extractBundle(zipBytes: Uint8Array): Promise<BundleContents> {
  assertWithinZipCaps(zipBytes);
  const entries = await new Promise<Map<string, Uint8Array>>((resolve, reject) => {
    unzip(zipBytes, (error, unzipped) => {
      if (error !== null) reject(new BundleFormatError(`invalid zip archive: ${error.message}`));
      else resolve(new Map(Object.entries(unzipped)));
    });
  });

  let workerJs: Uint8Array | undefined;
  const assets = new Map<string, Uint8Array>();
  for (const [name, bytes] of entries) {
    if (name === '' || name.endsWith('/')) continue; // directory marker
    if (name === 'worker.js') {
      workerJs = bytes;
      continue;
    }
    if (name.startsWith('dashboard/')) {
      const rel = name.slice('dashboard/'.length);
      // Defensive: skip traversal-shaped names (we never touch the
      // filesystem, but the path becomes an asset key served by the worker).
      if (rel.includes('..')) continue;
      assets.set(rel, bytes);
    }
  }

  if (workerJs === undefined) {
    throw new BundleFormatError('the worker bundle is missing worker.js');
  }
  if (!assets.has('index.html')) {
    throw new BundleFormatError('the worker bundle is missing dashboard/index.html');
  }
  return { workerJs, assets };
}
