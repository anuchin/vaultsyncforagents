/**
 * Absolute path of the daemon's runnable entry (`bin/vsa-daemon.js`) — what
 * service units point `ExecStart`/`ProgramArguments` at. Standalone module
 * (no imports) so bin/main/services can use it without cycles.
 */

import { fileURLToPath } from 'node:url';

export function daemonEntryPath(): string {
  return fileURLToPath(new URL('../bin/vsa-daemon.js', import.meta.url));
}
