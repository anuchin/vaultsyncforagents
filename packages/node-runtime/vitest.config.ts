/**
 * Node-runtime test config — plain node pool (real `node:fs` against temp
 * dirs, injectable fetch/WebSocket fakes). Separate from the root config so
 * each workspace's suites run under their own pool settings.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
