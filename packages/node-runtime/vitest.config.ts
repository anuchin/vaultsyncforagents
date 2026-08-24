/**
 * Node-runtime test config — plain node pool (real `node:fs` against temp
 * dirs, injectable fetch/WebSocket fakes). Separate from the root config so
 * each workspace's suites run under their own pool settings.
 */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Source aliases for workspace deps: node_modules junctions do not
    // resolve on some drives (network-mapped/OneDrive volumes), and tests
    // must run regardless of how the checkout's links were created.
    alias: [
      {
        find: /^@vsa\/core$/,
        replacement: fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
