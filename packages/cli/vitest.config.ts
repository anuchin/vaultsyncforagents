/**
 * CLI test config — node pool. Every network seam (fetch, WebSocket factory,
 * config paths) is injectable, so suites run against fakes and temp dirs;
 * no real worker is needed.
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
      {
        find: /^@vsa\/daemon$/,
        replacement: fileURLToPath(new URL('../daemon/src/index.ts', import.meta.url)),
      },
      {
        find: /^@vsa\/node-runtime$/,
        replacement: fileURLToPath(new URL('../node-runtime/src/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    include: ['test/**/*.test.ts'],
  },
});
