/**
 * Daemon test config — node pool. chokidar runs against real temp dirs; the
 * sync client, service backends (exec), schedulers, and clock are injectable
 * seams, so no network and no systemctl/launchctl is ever invoked.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Real chokidar runs in the watcher suite; FS-event latency (notably on
    // Windows) can exceed the 5s default.
    testTimeout: 20_000,
  },
});
