import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  compress,
  decompress,
  sha256Hex,
  supportsCompression,
} from '../src/index.js';

const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
const ABC_SHA256 = 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sha256Hex', () => {
  it('hashes the empty string to the known vector', async () => {
    expect(await sha256Hex('')).toBe(EMPTY_SHA256);
  });

  it('hashes "abc" to the known vector', async () => {
    expect(await sha256Hex('abc')).toBe(ABC_SHA256);
  });

  it('accepts bytes and agrees with the string form', async () => {
    expect(await sha256Hex(new Uint8Array([97, 98, 99]))).toBe(ABC_SHA256);
    expect(await sha256Hex(new Uint8Array([]))).toBe(EMPTY_SHA256);
  });

  it('produces lowercase 64-char hex for larger input', async () => {
    const input = 'the quick brown fox jumps over the lazy dog'.repeat(1000);
    const hex = await sha256Hex(input);
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
    // Consistent across runs (deterministic).
    expect(await sha256Hex(input)).toBe(hex);
  });

  it('encodes strings as UTF-8', async () => {
    // "√" is 3 UTF-8 bytes (0xE2 0x88 0x9A).
    expect(await sha256Hex('√')).toBe(await sha256Hex(new Uint8Array([0xe2, 0x88, 0x9a])));
  });
});

describe('compress / decompress', () => {
  it('reports support in Node 24', () => {
    expect(supportsCompression()).toBe(true);
  });

  it('round-trips text content', async () => {
    const original = new TextEncoder().encode('# Note\n'.repeat(500));
    const packed = await compress(original);
    expect(packed.byteLength).toBeLessThan(original.byteLength);
    const restored = await decompress(packed);
    expect([...restored]).toEqual([...original]);
  });

  it('round-trips arbitrary binary content', async () => {
    const original = new Uint8Array(4096);
    for (let i = 0; i < original.length; i++) original[i] = i % 251;
    const restored = await decompress(await compress(original));
    expect([...restored]).toEqual([...original]);
  });

  it('round-trips empty input', async () => {
    const restored = await decompress(await compress(new Uint8Array(0)));
    expect(restored.byteLength).toBe(0);
  });

  it('falls back to identity when CompressionStream is unavailable', async () => {
    vi.stubGlobal('CompressionStream', undefined);
    vi.stubGlobal('DecompressionStream', undefined);
    expect(supportsCompression()).toBe(false);

    const data = new Uint8Array([1, 2, 3, 4]);
    const packed = await compress(data);
    expect([...packed]).toEqual([1, 2, 3, 4]);
    const restored = await decompress(packed);
    expect([...restored]).toEqual([1, 2, 3, 4]);
  });
});
