/**
 * `@vsa/core` public API.
 *
 * Deep module: consumers import from this entry point only. Nothing outside
 * `src/` should reach into individual modules — internal layout may change.
 */

export * from './adapters.js';
export * from './adapters/memory.js';
export * from './clock.js';
export * from './conflictnames.js';
export * from './engine.js';
export * from './errors.js';
export * from './hashing.js';
export * from './ignore.js';
export * from './localindex.js';
export * from './paths.js';
export * from './protocol.js';
export * from './resolve.js';
export * from './scan.js';
export * from './types.js';
