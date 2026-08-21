/**
 * The worker's own release version, reported on every useful surface
 * (helloAck, GET /health, GET /api/status) so clients can assess version
 * skew (core `compat.ts`).
 *
 * Release builds substitute the identifier via esbuild `define`
 * (scripts/build-release.mjs reads the root package.json). The `typeof`
 * guard keeps the SAME source running under `wrangler dev` and vitest, where
 * nothing injects the constant: `typeof` on an undeclared identifier is
 * safe, so the fallback wins there.
 */

declare const __VSA_SERVER_VERSION__: string | undefined;

/**
 * Injected at release build time (scripts/build-release.mjs); the
 * `-dev` fallback covers wrangler dev/vitest.
 */
export const SERVER_VERSION: string =
  typeof __VSA_SERVER_VERSION__ !== 'undefined' ? __VSA_SERVER_VERSION__ : '0.1.0-dev';
