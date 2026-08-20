/**
 * Dashboard unit tests — pure logic only (state machine, formatters, row
 * builders), so the plain node pool is enough; no jsdom needed. The DOM
 * mounting layer is kept deliberately thin.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
