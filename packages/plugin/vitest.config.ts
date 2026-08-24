/**
 * Plugin test config — plain node pool. There is no real Obsidian here (or
 * anywhere in CI): the `obsidian` module is aliased to a minimal fake in
 * `test/helpers/obsidian-mock.ts`, and every platform seam the plugin uses
 * (fetch, WebSocket factory, timers) is injectable for tests.
 */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^obsidian$/,
        replacement: fileURLToPath(new URL('./test/helpers/obsidian-mock.ts', import.meta.url)),
      },
      // Source aliases for workspace deps — junctions do not resolve on
      // network-mapped/OneDrive drives (see node-runtime's config).
      {
        find: /^@vsa\/core$/,
        replacement: fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
