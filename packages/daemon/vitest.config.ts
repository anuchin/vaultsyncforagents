/**
 * Daemon test config — node pool. chokidar runs against real temp dirs; the
 * sync client, service backends (exec), schedulers, and clock are injectable
 * seams, so no network and no systemctl/launchctl is ever invoked.
 */
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    // Source aliases for workspace deps — junctions do not resolve on
    // network-mapped/OneDrive drives (see node-runtime's config).
    alias: [
      {
        find: /^@vsa\/core$/,
        replacement: fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
      },
      {
        find: /^@vsa\/node-runtime$/,
        replacement: fileURLToPath(new URL('../node-runtime/src/index.ts', import.meta.url)),
      },
    ],
  },
  test: {
    include: ['test/**/*.test.ts'],
    // Real chokidar runs in the watcher suite; FS-event latency (notably on
    // Windows) can exceed the 5s default.
    testTimeout: 20_000,
  },
});
