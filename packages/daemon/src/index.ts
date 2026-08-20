/**
 * `@vsa/daemon` public API.
 *
 * Deep module: consumers (the `vsa daemon` commands and the standalone
 * `vsa-daemon` bin) import from this entry point only. Composition of the
 * node-runtime adapters, the chokidar watcher, the FR-42 trash guard, the
 * reconnect/backoff supervisor, and the systemd/launchd installers all live
 * behind it.
 */

export * from './daemon.js';
export * from './entry.js';
export * from './trash.js';
export * from './watcher.js';
export * from './services/index.js';
export * from './main.js';
