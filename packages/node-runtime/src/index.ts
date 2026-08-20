/**
 * `@vsa/node-runtime` public API.
 *
 * Node-side glue shared by the CLI (`vsa`) and the future daemon: the fs
 * storage adapter, the HTTP blob store, the WebSocket transport, machine
 * config/secrets storage, and the in-vault device marker. All Node-only code
 * lives behind this entry point — `@vsa/core` stays platform-clean.
 */

export * from './storage.js';
export * from './blobstore.js';
export * from './transport.js';
export * from './config.js';
export * from './device.js';
export * from './util.js';
