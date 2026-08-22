#!/usr/bin/env node
/**
 * `vaultsyncforagents` launcher — the package-name alias of `vsa`, so both
 * `npx vaultsyncforagents setup` and a globally installed `vsa` work. It
 * delegates to the same bin (same dist bundle, same dev fallback).
 */
await import('./vsa.js');
