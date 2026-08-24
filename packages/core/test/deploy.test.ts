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
