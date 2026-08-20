/**
 * Root (node-pool) Vitest config — runs `@vsa/core`'s suites only.
 *
 * `@vsa/worker`'s tests run inside the real Workers runtime via its own
 * `packages/worker/vitest.workers.config.ts` (@cloudflare/vitest-pool-workers)
 * and are invoked by the root `test:worker` script. Restricting this config's
 * include pattern is what keeps the two pools from swallowing each other's
 * test files.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/core/test/**/*.test.ts'],
  },
});
