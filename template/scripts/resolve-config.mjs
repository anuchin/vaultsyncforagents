#!/usr/bin/env node
/**
 * Resolve the wrangler.jsonc placeholders for this deployment:
 *
 *   __WORKER_NAME__ → WORKER_NAME   (default: this repo's name)
 *   __R2_BUCKET__   → R2_BUCKET_NAME (default: vaultsync-<worker name>)
 *
 * Values come from the environment (set by .github/workflows/deploy.yml from
 * repo variables / the deploy button). Both are sanitized to the identifier
 * rules shared by Worker names and R2 bucket names: lowercase letters,
 * digits, hyphens; 3–63 chars.
 *
 * The resolved file is written to wrangler.resolved.jsonc and passed to
 * wrangler via --config, so the placeholder template stays untouched (it is
 * re-resolved on every deploy).
 */
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';

const sanitize = (value, fallback) => {
  const cleaned = String(value ?? fallback ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63)
    .replace(/-+$/g, '');
  if (cleaned.length < 3) {
    throw new Error(
      `resolved name "${cleaned}" is too short — set the WORKER_NAME repo variable`,
    );
  }
  return cleaned;
};

const repoName = process.env.REPO_NAME ?? 'vaultsyncforagents';
const workerName = sanitize(process.env.WORKER_NAME, repoName);
const bucketName = sanitize(process.env.R2_BUCKET_NAME, `vaultsync-${workerName}`);

let config = readFileSync('wrangler.jsonc', 'utf8');
config = config.replaceAll('__WORKER_NAME__', workerName).replaceAll('__R2_BUCKET__', bucketName);
writeFileSync('wrangler.resolved.jsonc', config);

console.log(`worker name: ${workerName}`);
console.log(`r2 bucket:   ${bucketName}`);
const leftovers = config.match(/__[A-Z0-9_]+__/g);
if (leftovers !== null) {
  console.warn(
    `note: unresolved placeholders remain: ${[...new Set(leftovers)].join(', ')} — ` +
      'check that this script knows about every placeholder in wrangler.jsonc',
  );
}

// Consumed by later workflow steps ($GITHUB_ENV).
const env = process.env.GITHUB_ENV;
if (env !== undefined && env !== '') {
  appendFileSync(env, `WORKER_NAME=${workerName}\nR2_BUCKET_NAME=${bucketName}\n`);
}
