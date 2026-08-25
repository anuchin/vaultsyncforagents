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
    coverage: {
      provider: 'v8',
      // Only @vsa/core's source is under the gate; this config's test include
      // already restricts the run to packages/core/test.
      include: ['packages/core/src/**'],
      reporter: ['text'],
      // CI-enforced floor (run `npm run test:coverage`). Measured core
      // coverage: statements 93.9 / branches 88.53 / functions 97.06 / lines
      // 93.9 — thresholds sit a point or two below, rounded down, so the gate
      // passes today without being sensitive to small code shifts.
      thresholds: {
        statements: 92,
        branches: 87,
        functions: 96,
        lines: 92,
      },
    },
  },
});
