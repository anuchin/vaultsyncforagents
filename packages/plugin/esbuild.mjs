/**
 * Build script: bundle the plugin to `main.js` for Obsidian (desktop +
 * mobile). Target ES2018 for mobile webview compatibility; `obsidian` (and
 * `electron`, unused) stay external — Obsidian injects them at runtime.
 *
 * Output is CommonJS (`module.exports.default = VaultSyncPlugin`), the format
 * Obsidian's sample plugin and community guidelines use.
 */
import esbuild from 'esbuild';

const production = process.argv.includes('--production');

await esbuild.build({
  entryPoints: ['src/main.ts'],
  bundle: true,
  outfile: 'main.js',
  format: 'cjs',
  target: 'es2018',
  platform: 'browser',
  external: ['obsidian', 'electron'],
  sourcemap: production ? false : 'inline',
  minify: production,
  legalComments: 'none',
  logLevel: 'info',
  banner: {
    js: '/* VaultSync for Agents — self-hosted Obsidian vault sync. See manifest.json. */',
  },
});
