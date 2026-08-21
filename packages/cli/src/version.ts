/**
 * The CLI's own version — the single source is this package's package.json.
 *
 * Read via `fs` (not a JSON import) so the same code works unchanged in all
 * three runtimes: vitest, the `vsa` bin running the TS sources through
 * Node's type-stripping + the ts-js-map resolve hook, and any future
 * bundled build. `@vsa/core`'s compat policy uses this as the client side of
 * the server-version assessment (`vsa doctor`).
 */

import { readFileSync } from 'node:fs';

/** Read `packages/cli/package.json`'s version; '0.1.0' if unreadable. */
function readCliVersion(): string {
  try {
    const pkg = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version?: unknown };
    return typeof pkg.version === 'string' && pkg.version !== '' ? pkg.version : '0.1.0';
  } catch {
    return '0.1.0';
  }
}

export const CLI_VERSION: string = readCliVersion();
