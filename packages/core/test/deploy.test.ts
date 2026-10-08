/**
 * `core/src/deploy.ts` — the shared deploy facts: naming (slug/suffix/
 * derivation), the release pin wiring, and the dependency-free zip-bomb
 * gate (declared sizes read straight from a built archive).
 */

import { describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import {
  MAX_ARCHIVE_UNCOMPRESSED_BYTES,
  MAX_BUNDLE_DOWNLOAD_BYTES,
  MAX_ENTRY_UNCOMPRESSED_BYTES,
  PINNED_BUNDLE_SHA256,
  PINNED_RELEASE,
  RELEASE_BUNDLE_URL,
  assertWithinZipCaps,
  deriveBucketName,
  deriveWorkerName,
  randomSuffix,
  readZipDeclaredSizes,
  slugify,
} from '../src/deploy.js';

describe('naming', () => {
  it('slugify: lowercase, collapse separators, trim, cap at 32', () => {
    expect(slugify('Personal Notes')).toBe('personal-notes');
    expect(slugify('  My *Vault* #2!! ')).toBe('my-vault-2');
    expect(slugify('Ünïcode Äccepts')).toBe('unicode-accepts');
    expect(slugify('a'.repeat(50))).toHaveLength(32);
    expect(slugify('---')).toBe('vault'); // never empty
    expect(slugify('')).toBe('vault');
  });

  it('randomSuffix: 4 chars from the unambiguous alphabet', () => {
    let seed = 42;
    const random = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    const suffix = randomSuffix(random);
    expect(suffix).toMatch(/^[abcdefghjkmnpqrstuvwxyz23456789]{4}$/);
  });

  it('deriveWorkerName / deriveBucketName', () => {
    expect(deriveWorkerName('Personal', 'x7q2')).toBe('vaultsync-personal-x7q2');
    expect(deriveBucketName('vaultsync-personal-x7q2')).toBe('vaultsync-personal-x7q2');
  });
});

describe('release pin', () => {
  it('the bundle URL carries the pinned release tag', () => {
    expect(RELEASE_BUNDLE_URL).toBe(
      `https://github.com/anuchin/vaultsyncforagents/releases/download/${PINNED_RELEASE}/worker-bundle.zip`,
    );
  });

  it('the pinned digest is a 64-hex sha256', () => {
    expect(PINNED_BUNDLE_SHA256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('size caps are the documented magnitudes', () => {
    expect(MAX_BUNDLE_DOWNLOAD_BYTES).toBe(100 * 1024 * 1024);
    expect(MAX_ENTRY_UNCOMPRESSED_BYTES).toBe(100 * 1024 * 1024);
    expect(MAX_ARCHIVE_UNCOMPRESSED_BYTES).toBe(250 * 1024 * 1024);
  });
});

describe('readZipDeclaredSizes / assertWithinZipCaps', () => {
  // A central-directory-only fixture exercises declared-size validation
  // without allocating or inflating the claimed (potentially huge) payload.
  function directory(entries: Array<{ size: number; extra?: Uint8Array }>, zip64 = false): Uint8Array {
    const directorySize = entries.reduce((sum, entry) => sum + 47 + (entry.extra?.length ?? 0), 0);
    const data = new Uint8Array(directorySize + (zip64 ? 76 : 0) + 22);
    const view = new DataView(data.buffer);
    let offset = 0;
    for (const entry of entries) {
      view.setUint32(offset, 0x0201_4b50, true);
      view.setUint32(offset + 24, entry.size, true);
      view.setUint16(offset + 28, 1, true);
      view.setUint16(offset + 30, entry.extra?.length ?? 0, true);
      data[offset + 46] = 120; // x
      if (entry.extra) data.set(entry.extra, offset + 47);
      offset += 47 + (entry.extra?.length ?? 0);
    }
    if (zip64) {
      view.setUint32(offset, 0x0606_4b50, true);
      view.setBigUint64(offset + 32, BigInt(entries.length), true);
      view.setBigUint64(offset + 48, 0n, true);
      view.setUint32(offset + 56, 0x0706_4b50, true);
      view.setBigUint64(offset + 64, BigInt(offset), true);
      offset += 76;
    }
    view.setUint32(offset, 0x0605_4b50, true);
    view.setUint16(offset + 10, zip64 ? 0xffff : entries.length, true);
    view.setUint32(offset + 16, zip64 ? 0xffff_ffff : 0, true);
    return data;
  }

  function sizeExtra(size: bigint): Uint8Array {
    const extra = new Uint8Array(12);
    const view = new DataView(extra.buffer);
    view.setUint16(0, 1, true);
    view.setUint16(2, 8, true);
    view.setBigUint64(4, size, true);
    return extra;
  }

  it('reads ZIP64 directory counts and entry sizes', () => {
    expect(readZipDeclaredSizes(directory([{ size: 0xffff_ffff, extra: sizeExtra(7n) }], true)))
      .toEqual([{ name: 'x', uncompressedSize: 7 }]);
  });

  it('rejects ZIP64 bomb sizes including values above safe integer precision', () => {
    for (const size of [BigInt(MAX_ENTRY_UNCOMPRESSED_BYTES + 1), 2n ** 60n]) {
      const zip = directory([{ size: 0xffff_ffff, extra: sizeExtra(size) }], true);
      expect(() => assertWithinZipCaps(zip)).toThrow(/per-entry cap/);
    }
  });

  it('rejects the total archive cap even when each entry is within its cap', () => {
    expect(() => assertWithinZipCaps(directory([
      { size: MAX_ENTRY_UNCOMPRESSED_BYTES },
      { size: MAX_ENTRY_UNCOMPRESSED_BYTES },
      { size: MAX_ENTRY_UNCOMPRESSED_BYTES },
    ]))).toThrow(/in total/);
  });

  it('skips unrelated extra fields before the ZIP64 size field', () => {
    const extra = new Uint8Array(16);
    new DataView(extra.buffer).setUint16(0, 0x9999, true);
    extra.set(sizeExtra(42n), 4);
    expect(readZipDeclaredSizes(directory([{ size: 0xffff_ffff, extra }])))
      .toEqual([{ name: 'x', uncompressedSize: 42 }]);
  });

  it.each([
    ['missing size', new Uint8Array(0), /no zip64 extra field/],
    ['short size', new Uint8Array([1, 0, 4, 0, 0, 0, 0, 0]), /malformed extra field/],
    ['truncated size', new Uint8Array([1, 0, 8, 0]), /malformed extra field/],
  ])('rejects a ZIP64 entry with %s', (_label, extra, error) => {
    expect(() => readZipDeclaredSizes(directory([{ size: 0xffff_ffff, extra }]))).toThrow(error);
  });

  it.each([
    ['missing locator', (view: DataView, end: number) => view.setUint32(end - 20, 0, true), /without a zip64 locator/],
    ['out-of-bounds record', (view: DataView, end: number) => view.setBigUint64(end - 12, 99999n, true), /out of bounds/],
    ['invalid record signature', (view: DataView) => view.setUint32(47, 0, true), /out of bounds/],
  ])('rejects a ZIP64 directory with %s', (_label, corrupt, error) => {
    const zip = directory([{ size: 1 }], true);
    corrupt(new DataView(zip.buffer), zip.length - 22);
    expect(() => readZipDeclaredSizes(zip)).toThrow(error);
  });

  it('rejects overflow markers in an archive too short for a locator', () => {
    const zip = new Uint8Array(22);
    const view = new DataView(zip.buffer);
    view.setUint32(0, 0x0605_4b50, true);
    view.setUint16(10, 0xffff, true);
    expect(() => readZipDeclaredSizes(zip)).toThrow(/without a zip64 locator/);
  });

  it.each([
    ['bad offset', (view: DataView, end: number) => view.setUint32(end + 16, 99999, true), /offset out of bounds/],
    ['bad entry signature', (view: DataView) => view.setUint32(0, 0, true), /bad central-directory entry signature/],
    ['truncated fixed record', (view: DataView, end: number) => view.setUint16(end + 10, 2, true), /truncated central directory/],
    ['truncated variable record', (view: DataView) => view.setUint16(28, 65535, true), /truncated central directory/],
  ])('rejects a corrupt central directory with %s', (_label, corrupt, error) => {
    const zip = directory([{ size: 1 }]);
    corrupt(new DataView(zip.buffer), zip.length - 22);
    expect(() => readZipDeclaredSizes(zip)).toThrow(error);
  });

  it('reads names and declared sizes from a real archive', () => {
    const zip = zipSync({
      'worker.js': strToU8('export { VaultRoom };\n'),
      'dashboard/': new Uint8Array(0),
      'dashboard/index.html': strToU8('<!doctype html>'),
      'dashboard/assets/app.js': new Uint8Array([1, 2, 3]),
    });
    const entries = readZipDeclaredSizes(zip).filter((e) => !e.name.endsWith('/'));
    expect(entries).toEqual([
      { name: 'worker.js', uncompressedSize: 22 },
      { name: 'dashboard/index.html', uncompressedSize: 15 },
      { name: 'dashboard/assets/app.js', uncompressedSize: 3 },
    ]);
    expect(() => assertWithinZipCaps(zip)).not.toThrow();
  });

  it('rejects a lying central directory (declared bomb) before inflating', () => {
    const zip = zipSync({ 'worker.js': strToU8('x') });
    // Patch the central directory's first entry uncompressed size (offset
    // +24 in the 46-byte fixed record) to claim 1 GB.
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    let eocd = -1;
    for (let i = zip.length - 22; i >= 0; i -= 1) {
      if (view.getUint32(i, true) === 0x0605_4b50) {
        eocd = i;
        break;
      }
    }
    expect(eocd).toBeGreaterThan(0);
    const cd = view.getUint32(eocd + 16, true);
    view.setUint32(cd + 24, 0x4000_0000, true);
    expect(() => assertWithinZipCaps(zip)).toThrow(/zip bomb/);
  });

  it('rejects garbage as a zip', () => {
    expect(() => readZipDeclaredSizes(strToU8('not a zip'))).toThrow(/invalid zip archive/);
  });
});
