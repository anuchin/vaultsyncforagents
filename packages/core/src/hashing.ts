/**
 * Content hashing and compression — Web APIs only.
 *
 * `crypto.subtle` is available in Node 18+, Cloudflare Workers,
 * and Obsidian (Electron). `CompressionStream` likewise. No Node imports:
 * this module must run unchanged in every client (ARCHITECTURE.md §8).
 */

/** Hash of `bytes` as lowercase sha256 hex. Matches R2 blob keys `blobs/{sha256}`. */
export async function sha256Hex(bytes: Uint8Array | string): Promise<string> {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes;
  // `crypto` (not `globalThis.crypto`): the bare identifier resolves in every
  // target's types (DOM lib, Cloudflare workerd types, Node) — the qualified
  // form does not, because workers types declare it `const`, which never
  // merges into `typeof globalThis`.
  const digest = await crypto.subtle.digest('SHA-256', data as BufferSource);
  return toHex(new Uint8Array(digest));
}

/**
 * Whether gzip streams are available in this runtime. Older Obsidian mobile
 * webviews may lack `CompressionStream`; callers fall back to identity.
 */
export function supportsCompression(): boolean {
  return (
    typeof CompressionStream !== 'undefined' &&
    typeof DecompressionStream !== 'undefined'
  );
}

/**
 * Gzip `data`. Falls back to identity (returns input unchanged) when
 * `CompressionStream` is unavailable — call `supportsCompression()` first if
 * you must know which happened.
 */
export async function compress(data: Uint8Array): Promise<Uint8Array> {
  if (!supportsCompression()) return data;
  // `as BufferSource` (not `as BlobPart`): the name `BufferSource` resolves in
  // both DOM lib and workerd runtime types, and is a valid BlobPart in each.
  const stream = new Blob([data as BufferSource])
    .stream()
    .pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/**
 * Gunzip `data` produced by `compress` (in a runtime that had gzip support).
 * Falls back to identity when `DecompressionStream` is unavailable.
 */
export async function decompress(data: Uint8Array): Promise<Uint8Array> {
  if (!supportsCompression()) return data;
  const stream = new Blob([data as BufferSource])
    .stream()
    .pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function toHex(bytes: Uint8Array): string {
  let out = '';
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, '0');
  }
  return out;
}
