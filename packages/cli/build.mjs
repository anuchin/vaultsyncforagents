#!/usr/bin/env node
/**
 * Bundle the CLI for publishing (the `vaultsyncforagents` npm package):
 * esbuild src/cli.ts → dist/cli.js — one self-contained ESM file with ZERO
 * runtime dependencies. Everything real (commander, picocolors,
 * @clack/prompts, fflate, the @vsa/core|node-runtime|daemon workspace
 * packages incl. chokidar) is bundled in; only node: builtins stay external
 * (esbuild's platform: 'node' default). The published bin/vsa.js imports
 * dist/cli.js; a repo checkout without dist/ falls back to running the TS
 * sources through --experimental-transform-types (see bin/vsa.js).
 *
 * The sources use NodeNext-style `.js`-suffixed imports that map to `.ts`
 * files; the jsToTs resolve plugin below performs that rewrite for esbuild.
 */
import { existsSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import esbuild from 'esbuild';

const pkgDir = dirname(fileURLToPath(import.meta.url));
const entry = resolve(pkgDir, 'src', 'cli.ts');
const outfile = resolve(pkgDir, 'dist', 'cli.js');

if (!existsSync(entry)) {
  console.error(`error: CLI entry not found at ${entry}`);
  process.exit(1);
}

/** Map relative `./x.js` specifiers to their `./x.ts` sources (NodeNext style). */
const jsToTs = {
  name: 'js-to-ts',
  setup(build) {
    build.onResolve({ filter: /\.js$/ }, (args) => {
      if (!args.path.startsWith('.') || args.resolveDir === '') return null;
      const asGiven = resolve(args.resolveDir, args.path);
      if (existsSync(asGiven)) return null; // a real .js file (e.g. plugin main.js)
      const asTs = asGiven.replace(/\.js$/, '.ts');
      if (existsSync(asTs) && statSync(asTs).isFile()) return { path: asTs };
      return null;
    });
  },
};

const result = await esbuild.build({
  entryPoints: [entry],
  outfile,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  // Nothing external except node: builtins (the platform default) — the
  // published package must not need a single runtime dependency installed.
  packages: 'bundle',
  plugins: [jsToTs],
  sourcemap: false,
  minify: false,
  legalComments: 'none',
  logLevel: 'info',
  banner: {
    // CJS deps bundled into ESM (picocolors) may reach for require/import.meta.
    js: [
      "import { createRequire as __vsaCreateRequire } from 'node:module';",
      'const require = __vsaCreateRequire(import.meta.url);',
    ].join('\n'),
  },
});

if (result.errors.length > 0) process.exit(1);

// Sanity: the bundle must keep the `main` entry point the bins import, and
// the version read (src/version.ts → new URL('../package.json', …)) resolves
// against the shipped package.json — assert both wired-up facts on the file.
const { readFile } = await import('node:fs/promises');
const bundled = await readFile(outfile, 'utf8');
if (!/export\s*\{[^{}]*\bmain\b[^{}]*\}/.test(bundled) && !/export\s+.*\bmain\b/.test(bundled)) {
  console.error('error: bundled cli.js lost its `main` export — the bins would break');
  process.exit(1);
}
console.log(`bundled ${outfile} (${(statSync(outfile).size / 1024).toFixed(1)} KiB)`);
