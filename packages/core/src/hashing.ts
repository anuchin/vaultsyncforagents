/**
 * Content hashing and compression — Web APIs only.
 *
 * `globalThis.crypto.subtle` is available in Node 18+, Cloudflare Workers,
 * and Obsidian (Electron). `CompressionStream` likewise. No Node imports:
 * this module must run unchanged in every client (ARCHITECTURE.md §8).
 */

/** Hash of `bytes` as lowercase sha256 hex. Matches R2 blob keys `blobs/{sha256}`. */
export async function sha256Hex(bytes: Uint8Array | string): Promise<string> {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data as BufferSource);
  return toHex(new Uint8Array(digest));
}

/**
 * Whether gzip streams are available in this runtime. Older Obsidian mobile
 * webviews may lack `CompressionStream`; callers fall back to identity.
 */
export function supportsCompression(): boolean {
  return (
    typeof globalThis.CompressionStream !== 'undefined' &&
    typeof globalThis.DecompressionStream !== 'undefined'
  );
}

/**
 * Gzip `data`. Falls back to identity (returns input unchanged) when
 * `CompressionStream` is unavailable — call `supportsCompression()` first if
 * you must know which happened.
 */
export async function compress(data: Uint8Array): Promise<Uint8Array> {
  if (!supportsCompression()) return data;
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new globalThis.CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Gunzip `data` produced by `compress` (in a runtime that had gzip support).
 * Falls back to identity when `DecompressionStream` is unavailable.
 */
export async function decompress(data: Uint8Array): Promise<Uint8Array> {
  if (!supportsCompression()) return data;
  const stream = new Blob([data as BlobPart])
    .stream()
    .pipeThrough(new globalThis.DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}
