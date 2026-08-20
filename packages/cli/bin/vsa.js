#!/usr/bin/env node
/**
 * `vsa` launcher.
 *
 * The workspace sources are TypeScript with `.js`-suffixed import specifiers
 * (NodeNext style) and use constructor parameter properties, which Node's
 * default strip-only mode rejects — so the first hop re-execs Node with
 * `--experimental-transform-types`, installs a tiny resolve hook mapping
 * failed `./x.js` resolutions to `./x.ts` siblings, and imports the CLI.
 * Publishing (a later phase) will replace this with a bundled plain-JS
 * build; the bin field is wired now so the workspace bin works day one.
 */
import { spawn } from 'node:child_process';

const hasTransform = process.execArgv.some((arg) => arg.includes('transform-types'));
if (!hasTransform) {
  const { fileURLToPath } = await import('node:url');
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
