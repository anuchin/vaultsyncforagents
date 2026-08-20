/**
 * Plugin entry point — Obsidian loads `main.js` and instantiates the default
 * export. Everything real lives in `plugin.ts` (and its modules); this file
 * only re-exports.
 */

export { VaultSyncPlugin as default } from './plugin.js';
