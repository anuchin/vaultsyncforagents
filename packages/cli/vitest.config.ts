/**
 * CLI test config — node pool. Every network seam (fetch, WebSocket factory,
 * config paths) is injectable, so suites run against fakes and temp dirs;
 * no real worker is needed.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
  },
});
