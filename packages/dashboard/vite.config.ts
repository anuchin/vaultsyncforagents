/**
 * Dashboard build config.
 *
 * Output goes to `dist/`, which the worker serves through its `[assets]`
 * binding (packages/worker/wrangler.jsonc). Always run `npm run
 * build:dashboard` (root) or the worker's `dev`/`deploy` scripts before
 * `wrangler dev` / `wrangler deploy` — the pipeline is documented there.
 *
 * `npm run dev` starts Vite's dev server and proxies the worker surface to a
 * locally running `wrangler dev` (override with VSA_WORKER_ORIGIN).
 */
import { defineConfig } from 'vite';

const workerOrigin = process.env.VSA_WORKER_ORIGIN ?? 'http://127.0.0.1:8787';

export default defineConfig({
  build: {
    outDir: 'dist',
    target: 'es2022',
    sourcemap: false,
  },
  server: {
    proxy: {
      '/health': workerOrigin,
      '/claim': workerOrigin,
      '/pair': workerOrigin,
      '/admin': workerOrigin,
      '/api': workerOrigin,
      '/blob': workerOrigin,
      '/ws': { target: workerOrigin.replace(/^http/, 'ws'), ws: true },
      '/sync': { target: workerOrigin.replace(/^http/, 'ws'), ws: true },
    },
  },
});
