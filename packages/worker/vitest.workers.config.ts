/**
 * Worker test config — runs on @cloudflare/vitest-plugin (real
 * workerd/Miniflare runtime: Durable Object + R2 + WebSockets), completely
 * separate from the root node-pool config that runs `@vsa/core`'s suites.
 *
 * Bindings (ROOM, BUCKET, ASSETS) come from wrangler.test.jsonc (the test
 * variant of wrangler.jsonc whose assets directory points at a committed
 * fixture instead of the built dashboard) via `wrangler.configPath`; `main`
 * registers this package's worker as the test isolate's main module so
 * `SELF` fetches and DO classes resolve against the real routing code.
 *
 * One shared runtime avoids unlinking open SQLite files on Windows. Every
 * test resets the DO tables and R2 bucket in `beforeEach` (`helpers.resetAll`),
 * preserving fresh-worker semantics without file juggling.
 */
import { fileURLToPath } from 'node:url';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [cloudflareTest({
    main: 'src/index.ts',
    wrangler: { configPath: './wrangler.test.jsonc' },
    miniflare: { compatibilityFlags: ['nodejs_compat'] },
  })],
  resolve: {
    // Source aliases for workspace deps: node_modules junctions do not
    // resolve on some drives (network-mapped/OneDrive volumes), and tests
    // must run regardless of how the checkout's links were created.
    alias: [
      {
        find: /^@vsa\/core$/,
        // `.href`: the DOM/workerd `URL` type union does not satisfy
        // fileURLToPath's parameter typing in this package's tsconfig mix.
        replacement: fileURLToPath(new URL('../core/src/index.ts', import.meta.url).href),
      },
    ],
  },
  test: {
    include: ['test/**/*.test.ts'],
    // Generous per-test budget: the auth tests run real argon2 derivations
    // (19 MiB each — the throttling suites alone do 10+), and on slow
    // single-core machines a single login/verification can take seconds,
    // blowing the 5 s default long before any logic is wrong.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // resetAll() provides per-test cleanup without unlinking open SQLite
    // files on Windows. Keep one shared runtime, as in the previous pool.
    maxWorkers: 1,
    isolate: false,
    fileParallelism: false,
  },
});
