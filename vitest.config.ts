/**
 * Root (node-pool) Vitest config — runs `@vsa/core`'s suites only.
 *
 * `@vsa/worker` (real Workers runtime), `@vsa/node-runtime`, and `@vsa/cli`
 * each own a config in their package, invoked by the root `test:*` scripts
 * (`test:worker`, `test:node-runtime`, `test:cli`). Restricting this config's
 * include pattern is what keeps the pools from swallowing each other's test
 * files.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/core/test/**/*.test.ts'],
  },
});
