/**
 * Shared deploy facts — the single source of truth for *what* gets deployed
 * and *what it is called*, used by every provisioner: `vsa setup` (the CLI
 * terminal path) and the plugin's in-app setup wizard (both write the same
 * release bundle into the user's Cloudflare account). The deploy-button
 * template repo tracks the same release through its `VERSION` pin.
 *
 * Keeping the pin and the naming here means the CLI and the plugin cannot
 * drift onto different releases or different name shapes — the same class of
 * guarantee `compat.ts` gives the version-skew policy.
 *
 * Platform-portable by contract: constants and pure functions only, Web APIs
 * only — no Node imports (runs unchanged in Obsidian and Workers).
 */

/**
 * Release the CLI setup path and the plugin wizard deploy (see
 * template/VERSION for the deploy-button track). Bumped by the release
 * build pass together with `PINNED_BUNDLE_SHA256`.
 */
export const PINNED_RELEASE = 'v0.1.5';

/**
 * SHA-256 (hex) of the pinned release's `worker-bundle.zip`, baked in by the
 * release build pass (deterministic: local and CI builds hash identically —
 * verified for v0.1.3–v0.1.5). When empty, the download path falls back
 * to the release's `.sha256` sidecar (uploaded by release.yml) and finally
 * warns when neither is available (older releases).
 */
export const PINNED_BUNDLE_SHA256 = 'a346766111e6ad7b156c6efc5fa2543c83df4da85667e59d0934b5b847beb506';

/**
 * GitHub release artifact convention: the tag ships `worker-bundle.zip`
 * (`worker.js` + `dashboard/` — the layout `scripts/build-release.mjs`
 * produces and the template's CI asserts) plus a `worker-bundle.zip.sha256`
 * sidecar since v0.1.3, which the download path verifies when no digest is
 * pinned. Public release assets — downloadable without a GitHub account.
 */
export const RELEASE_BUNDLE_URL = `https://github.com/anuchin/vaultsyncforagents/releases/download/${PINNED_RELEASE}/worker-bundle.zip`;

/**
 * Must match `packages/worker/wrangler.jsonc` (and every provisioner's
 * generated config): the compatibility date the worker is deployed under.
 */
export const WORKER_COMPATIBILITY_DATE = '2026-08-01';

// --- worker topology (mirrors packages/worker/wrangler.jsonc) --------------------------------
//
// The provisioners must declare the same bindings wrangler does, whether via
// a generated wrangler.jsonc (CLI/template) or script-upload metadata (the
// plugin's REST deploy). These constants are that shared declaration.

/** Durable Object binding name (the sync authority, ARCHITECTURE.md §6). */
export const DO_BINDING = 'ROOM';
/** The single Durable Object class the worker exports. */
export const DO_CLASS = 'VaultRoom';
/** Migration tag of the (only, so far) SQLite class registration. */
export const DO_MIGRATION_TAG = '0001_initial';
/** R2 binding name (content-addressed blobs, ARCHITECTURE.md §5). */
export const R2_BINDING = 'BUCKET';
/** Static-assets binding name (the dashboard SPA, ARCHITECTURE.md §10). */
export const ASSETS_BINDING = 'ASSETS';
/** Assets routing: unknown GETs fall through to the SPA's index.html. */
export const ASSETS_NOT_FOUND_HANDLING = 'single-page-application';
/** Assets routing: the worker's fetch router stays the decision point. */
export const ASSETS_RUN_WORKER_FIRST = true;
/** Weekly orphan-blob GC, Mondays 03:00 UTC (ARCHITECTURE.md §7). */
export const GC_CRON = '0 3 * * 1';

// --- naming ----------------------------------------------------------------------------------

/** Slugify a vault name for worker/bucket identifiers (lowercase [a-z0-9-]). */
export function slugify(name: string): string {
  const slug = name
    .normalize('NFKD')
    // Strip combining marks left by the decomposition (Ü → u + marks).
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32)
    .replace(/-+$/g, '');
  return slug === '' ? 'vault' : slug;
}

/** Random 4-char [a-z0-9] suffix, e.g. `x7q2` (worker names are per-account; the suffix keeps two vaults apart). */
export function randomSuffix(random: () => number = Math.random): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let suffix = '';
  for (let i = 0; i < 4; i += 1) {
    suffix += alphabet[Math.floor(random() * alphabet.length)];
  }
  return suffix;
}

/** `personal` → `vaultsync-personal-x7q2` (worker and bucket share the name). */
export function deriveWorkerName(vaultName: string, suffix: string): string {
  return `vaultsync-${slugify(vaultName)}-${suffix}`;
}

/** The R2 bucket for a worker (setup convention: same name as the worker). */
export function deriveBucketName(workerName: string): string {
  return workerName;
}

// --- release-bundle size caps -----------------------------------------------------------------

/** Refuse bundle downloads above this size (100 MB). */
export const MAX_BUNDLE_DOWNLOAD_BYTES = 100 * 1024 * 1024;
/** Refuse any zip entry whose declared uncompressed size exceeds this (100 MB). */
export const MAX_ENTRY_UNCOMPRESSED_BYTES = 100 * 1024 * 1024;
/** Refuse archives whose declared uncompressed sizes sum above this (250 MB). */
export const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 250 * 1024 * 1024;

// --- zip-bomb gate (declared sizes, checked before inflating) ---------------------------------
//
// Dependency-free (DataView/TextDecoder only) so every consumer — the CLI's
// shell-out path and the plugin's in-app wizard — enforces the identical
// gate: fflate's unzip materializes every entry fully in memory, so a small
// archive lying about its sizes could otherwise exhaust the machine. Lying
// about the sizes is exactly what a bomb must do, which makes this the cheap
// place to stop it.

/** One central-directory entry's name and DECLARED uncompressed size. */
export interface ZipEntrySize {
  name: string;
  uncompressedSize: number;
}

/**
 * Walk the zip central directory and return each entry's declared
 * uncompressed size (zip64-aware) without decompressing anything. Structural
 * oddities are hard errors — the caller treats them like a corrupt archive.
 */
export function readZipDeclaredSizes(data: Uint8Array): ZipEntrySize[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const u16 = (offset: number) => view.getUint16(offset, true);
  const u32 = (offset: number) => view.getUint32(offset, true);

  // End of central directory: scan backwards over the possible zip comment
  // (up to 64 KiB) for its 0x06054b50 signature; the LAST hit wins.
  const eocdFloor = Math.max(0, data.length - (65_536 + 22));
  let eocd = -1;
  for (let i = data.length - 22; i >= eocdFloor; i -= 1) {
    if (u32(i) === 0x0605_4b50) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) throw new Error('invalid zip archive: no end-of-central-directory record');

  let entryCount = u16(eocd + 10);
  let cdOffset = u32(eocd + 16);
  // ZIP64 overflow markers redirect to the zip64 EOCD record.
  if (cdOffset === 0xffff_ffff || entryCount === 0xffff) {
    const zip64 = readZip64Directory(view, eocd, data.length);
    entryCount = zip64.entryCount;
    cdOffset = zip64.cdOffset;
  }
  if (cdOffset + 46 > data.length) {
    throw new Error('invalid zip archive: central directory offset out of bounds');
  }

  const entries: ZipEntrySize[] = [];
  const decoder = new TextDecoder();
  let offset = cdOffset;
  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > data.length) {
      throw new Error('invalid zip archive: truncated central directory');
    }
    if (u32(offset) !== 0x0201_4b50) {
      throw new Error('invalid zip archive: bad central-directory entry signature');
    }
    let uncompressedSize = u32(offset + 24);
    const nameLength = u16(offset + 28);
    const extraLength = u16(offset + 30);
    const commentLength = u16(offset + 32);
    const recordEnd = offset + 46 + nameLength + extraLength + commentLength;
    if (recordEnd > data.length) {
      throw new Error('invalid zip archive: truncated central directory');
    }
    if (uncompressedSize === 0xffff_ffff) {
      uncompressedSize = readZip64EntrySize(view, offset + 46 + nameLength, extraLength);
    }
    entries.push({
      name: decoder.decode(data.subarray(offset + 46, offset + 46 + nameLength)),
      uncompressedSize,
    });
    offset = recordEnd;
  }
  return entries;
}

/**
 * Zip-bomb gate: reject archives whose declared per-entry uncompressed size
 * exceeds the per-entry cap or whose declared sizes sum above the archive
 * cap — BEFORE a single entry is inflated.
 */
export function assertWithinZipCaps(data: Uint8Array): void {
  const entries = readZipDeclaredSizes(data);
  let total = 0;
  for (const entry of entries) {
    if (entry.uncompressedSize > MAX_ENTRY_UNCOMPRESSED_BYTES) {
      throw new Error(
        `refusing to extract ${entry.name}: declares ${formatDeployBytes(entry.uncompressedSize)} uncompressed, over the ${formatDeployBytes(MAX_ENTRY_UNCOMPRESSED_BYTES)} per-entry cap (possible zip bomb)`,
      );
    }
    total += entry.uncompressedSize;
  }
  if (total > MAX_ARCHIVE_UNCOMPRESSED_BYTES) {
    throw new Error(
      `refusing to extract the archive: entries declare ${formatDeployBytes(total)} uncompressed in total, over the ${formatDeployBytes(MAX_ARCHIVE_UNCOMPRESSED_BYTES)} cap (possible zip bomb)`,
    );
  }
}

/** Entry count + central-directory offset from the zip64 EOCD record. */
function readZip64Directory(
  view: DataView,
  eocd: number,
  dataLength: number,
): { entryCount: number; cdOffset: number } {
  // The zip64 EOCD locator sits immediately before the classic EOCD.
  const locator = eocd - 20;
  if (locator < 0 || view.getUint32(locator, true) !== 0x0706_4b50) {
    throw new Error('invalid zip archive: zip64 markers without a zip64 locator');
  }
  const zip64Offset = Number(view.getBigUint64(locator + 8, true));
  if (zip64Offset + 56 > dataLength || view.getUint32(zip64Offset, true) !== 0x0606_4b50) {
    throw new Error('invalid zip archive: zip64 end-of-central-directory record out of bounds');
  }
  return {
    entryCount: Number(view.getBigUint64(zip64Offset + 32, true)),
    cdOffset: Number(view.getBigUint64(zip64Offset + 48, true)),
  };
}

/**
 * Original (uncompressed) size from a ZIP64 extended-information extra
 * field. Reached only when the fixed header overflowed (0xFFFFFFFF), and in
 * that case the spec places the original size FIRST in the extra field —
 * the compressed-size/offset/disk fields follow only when they overflowed
 * too. Sizes past 2^53 lose Number precision; MAX_SAFE_INTEGER overflows
 * every cap, which is the correct verdict for such a claim.
 */
function readZip64EntrySize(view: DataView, extraOffset: number, extraLength: number): number {
  let cursor = extraOffset;
  const end = extraOffset + extraLength;
  while (cursor + 4 <= end) {
    const headerId = view.getUint16(cursor, true);
    const dataSize = view.getUint16(cursor + 2, true);
    if (headerId === 0x0001) {
      if (dataSize < 8 || cursor + 12 > end) {
        throw new Error('invalid zip archive: zip64 entry with a malformed extra field');
      }
      const size = Number(view.getBigUint64(cursor + 4, true));
      return Number.isSafeInteger(size) ? size : Number.MAX_SAFE_INTEGER;
    }
    cursor += 4 + dataSize;
  }
  throw new Error('invalid zip archive: entry claims zip64 sizes but carries no zip64 extra field');
}

/** `1.2 MB` / `3.4 KiB` / `512 bytes` — the gate's error-message formatter. */
function formatDeployBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} bytes`;
}
