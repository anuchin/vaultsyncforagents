#!/usr/bin/env node
/**
 * `vsa` launcher.
 *
 * Published installs (npm tarball) run the esbuild bundle: dist/cli.js is
 * self-contained plain JS with zero runtime dependencies, so nothing but
 * Node itself is needed. A repo checkout has no dist/ by default, so it
 * falls back to the dev launcher: re-exec Node with
 * `--experimental-transform-types`, install a tiny resolve hook mapping
 * failed `./x.js` resolutions to `./x.ts` siblings, and import the CLI
 * sources directly (`npm run build` in packages/cli produces the bundle).
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const bundledCli = new URL('../dist/cli.js', import.meta.url);

if (existsSync(fileURLToPath(bundledCli))) {
  const { main } = await import(bundledCli);
  await main(process.argv.slice(2));
} else {
  const hasTransform = process.execArgv.some((arg) => arg.includes('transform-types'));
  if (!hasTransform) {
    const self = fileURLToPath(import.meta.url);
    const child = spawn(
      process.execPath,
      [
        '--experimental-transform-types',
        '--disable-warning=ExperimentalWarning',
        self,
        ...process.argv.slice(2),
      ],
      { stdio: 'inherit', env: process.env },
    );
    child.on('error', (error) => {
      console.error(String(error));
      process.exit(1);
    });
    child.on('exit', (code) => process.exit(code ?? 0));
  } else {
    const { register } = await import('node:module');
    const { pathToFileURL } = await import('node:url');
    register(new URL('../tools/ts-js-map.mjs', import.meta.url), pathToFileURL('./'));
    const { main } = await import('../src/cli.ts');
    await main(process.argv.slice(2));
  }
}
