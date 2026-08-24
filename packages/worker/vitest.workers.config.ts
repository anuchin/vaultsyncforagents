/**
 * Worker test config — runs on @cloudflare/vitest-pool-workers (real
 * workerd/Miniflare runtime: Durable Object + R2 + WebSockets), completely
 * separate from the root node-pool config that runs `@vsa/core`'s suites.
 *
 * Bindings (ROOM, BUCKET, ASSETS) come from wrangler.test.jsonc (the test
 * variant of wrangler.jsonc whose assets directory points at a committed
 * fixture instead of the built dashboard) via `wrangler.configPath`; `main`
 * registers this package's worker as the test isolate's main module so
 * `SELF` fetches and DO classes resolve against the real routing code.
 *
 * `isolatedStorage` is DISABLED on purpose: its per-test snapshot pop unlinks
 * the DO's sqlite file, and on Windows any test that performs concurrent DO
 * writes (the claim race!) deterministically hits EBUSY — workerd keeps a
 * second file handle that abortAllDurableObjects() does not release in time
 * (pool-workers 0.12.x). Instead every test file resets the DO tables and the
 * R2 bucket in `beforeEach` (`helpers.resetAll`), preserving fresh-worker
 * semantics without file juggling.
 */
import { fileURLToPath } from 'node:url';
import { defineWorkersConfig } from '@cloudflare/vitest-pool-workers/config';

export default defineWorkersConfig({
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
    poolOptions: {
      workers: {
        main: 'src/index.ts',
        wrangler: { configPath: './wrangler.test.jsonc' },
        miniflare: {
          compatibilityFlags: ['nodejs_compat'],
        },
        isolatedStorage: false,
        singleWorker: true,
      },
    },
  },
});
