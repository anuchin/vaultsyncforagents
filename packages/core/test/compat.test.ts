/**
 * `compat.ts` — the shared server-version policy: parsing tolerance, the
 * verdict ladder (legacy / unparseable / newer / below-minimum / ok), and the
 * exact user-facing messages the plugin status note and `vsa doctor` render.
 */

import { describe, expect, it } from 'vitest';
import {
  checkServerCompatibility,
  MIN_SUPPORTED_SERVER_VERSION,
  parseSemVer,
} from '../src/compat.js';

describe('parseSemVer', () => {
  it('parses plain, v-prefixed, prerelease, and build forms identically', () => {
    expect(parseSemVer('0.1.0')).toEqual({ major: 0, minor: 1, patch: 0 });
    expect(parseSemVer('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseSemVer(' 1.2.3-beta.1 ')).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseSemVer('1.2.3+build.7')).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseSemVer('v2.0.0-rc.1+meta.2')).toEqual({ major: 2, minor: 0, patch: 0 });
  });

  it('rejects non-semver input', () => {
    for (const bad of ['', '0.1', '1.2.3.4', 'latest', '1.x.3', '1.2.3-']) {
      expect(parseSemVer(bad), bad).toBeNull();
    }
  });
});

describe('checkServerCompatibility', () => {
  it('null/undefined/empty server version → legacy warn pointing at UPGRADING', () => {
    for (const legacy of [null, undefined, '']) {
      const verdict = checkServerCompatibility('1.5.0', legacy);
      expect(verdict.level, String(legacy)).toBe('warn');
      expect(verdict.message).toMatch(/predates version reporting/);
      expect(verdict.message).toContain('docs/UPGRADING.md');
    }
  });

  it('unparseable server version → warn quoting the raw value', () => {
    const verdict = checkServerCompatibility('1.5.0', 'banana');
    expect(verdict.level).toBe('warn');
    expect(verdict.message).toContain('banana');
    expect(verdict.message).toContain('compatibility unknown');
  });

  it('server newer by MAJOR or MINOR → warn to update the client; patch gaps are ok', () => {
    expect(checkServerCompatibility('1.5.0', '2.0.0').level).toBe('warn');
    expect(checkServerCompatibility('1.5.0', '1.6.0').level).toBe('warn');
    expect(checkServerCompatibility('1.5.0', '1.5.9').level).toBe('ok');
    expect(checkServerCompatibility('1.5.0', '1.4.9').level).toBe('ok');
    const verdict = checkServerCompatibility('1.5.0', '1.6.0');
    expect(verdict.message).toContain('1.6.0');
    expect(verdict.message).toContain('1.5.0');
    expect(verdict.message).toContain('update the client when convenient');
  });

  it('an unparseable CLIENT version only skips the newer-server comparison', () => {
    // A dev build reporting "unknown" must not fabricate a warn from a server
    // that is otherwise perfectly fine.
    expect(checkServerCompatibility('unknown', '9.9.9').level).toBe('ok');
  });

  it(`server below ${MIN_SUPPORTED_SERVER_VERSION} → error with the update pointer`, () => {
    const verdict = checkServerCompatibility('1.5.0', '0.0.9');
    expect(verdict.level).toBe('error');
    expect(verdict.message).toContain('0.0.9');
    expect(verdict.message).toContain(MIN_SUPPORTED_SERVER_VERSION);
    expect(verdict.message).toContain('docs/UPGRADING.md');
    // The floor itself is fine.
    expect(checkServerCompatibility('1.5.0', MIN_SUPPORTED_SERVER_VERSION).level).toBe('ok');
  });

  it('matched versions (ignoring prerelease/build) → ok', () => {
    expect(checkServerCompatibility('0.1.0', '0.1.0').level).toBe('ok');
    expect(checkServerCompatibility('1.5.0', 'v1.5.0-rc.1').level).toBe('ok');
    const verdict = checkServerCompatibility('1.5.0', '1.5.0');
    expect(verdict.message).toContain('1.5.0');
  });
});
