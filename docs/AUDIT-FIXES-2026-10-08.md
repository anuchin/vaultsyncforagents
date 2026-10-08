# Audit fixes and verification

Date: 2026-10-08 (Asia/Calcutta). This follows [the original audit](AUDIT-2026-10-07.md)
of checkout `2a667be`. Changes are local and uncommitted.

This report records the fix-only phase. The later, separately authorized real
deployment is documented in [the ZeroKelvin setup report](ZEROKELVIN-SYNC-SETUP-2026-10-08.md).
A subsequent daemon disconnect exposed callback replacement in the production
transport wiring. Its fix, failing-then-passing regression, 65 daemon tests,
140 CLI tests, and live reconnect verification are documented in
[the VPS operations report](VPS-APP-REMOVAL-2026-10-08.md).

## Resolved findings

| Finding | Change | Verification |
|---|---|---|
| Incomplete inventories inferred deletions | Node and Obsidian enumeration/stat errors propagate. An unavailable Node vault root aborts the scan; confirmed missing child entries remain supported. | Fault injection for subtree EACCES, stat EIO, and missing roots. |
| Daemon lost symlink protection | TrashGuardStorage forwards listSymlinks. | A real junction remains visible through the wrapper and tracked files beneath it are not deletion candidates. |
| Operations followed links outside the vault | Node operations check the root and every existing vault-path component, reject links/junctions, and validate both rename paths. Atomic writes recheck before parent creation and replacement; temporary files use exclusive creation. Reads use O_NOFOLLOW where available and recheck after opening. | Real Windows junction tests for reads, writes, deletion, renames, directory operations, existence checks, root replacement, and an incoming core pull; outside content stays intact. |
| Failed trash reads still deleted files | Only ENOENT is treated as an already-missing file. Other safety-read errors abort deletion. | An injected EACCES leaves the original bytes intact. Existing safety-copy failure tests also pass. |
| Remote empty directories remained on the daemon | TrashGuardStorage forwards removeDir. | The production daemon composition removes a remotely deleted empty folder and prunes a parent after remote deletion of its last file. |
| Local empty-directory changes did not sync | addDir/unlinkDir events trigger reconciliation. | Real watcher tests and daemon integration tests create/delete an empty folder without editing a file. |

The client's remote-change divergence guard also propagates existence-check
errors instead of treating them as absence. A regression confirms a local
unsynced edit survives an EACCES during a remote update.

## Dependency and test-tool updates

- Vitest and its V8 coverage provider now use 4.1.11. The Worker tests migrated
  to `@cloudflare/vitest-plugin` 1.3.7 and Wrangler 4.148.0; the runtime no longer
  falls back from the configured 2026-08-01 compatibility date.
- Esbuild was updated. Root overrides select patched Moment, Sharp, and
  source-map-js versions where upstream tooling still pins affected versions.
  The lockfile was regenerated and checked with `npm ci --ignore-scripts`.
- Obsidian production sources retain their browser-only type configuration;
  a separate test tsconfig supplies Node types for the test harness.
- `npm audit --json` reports **zero vulnerabilities**, including development
  dependencies, as of this verification.

The coverage tool upgrade exposed gaps against the existing gate. Tests now
cover ZIP64 declared-size validation and malformed/bomb archives, snapshot
restoration of missing files/folders, unsolicited protocol replies, rejected
uploads, corrupt downloads, persistence failures, and default debounce cleanup.
Coverage thresholds were kept unchanged.

## Verification results

All seven suites passed on this Windows PC:

| Suite | Passing tests |
|---|---:|
| Core | 439 |
| Node runtime | 62 |
| CLI | 140 |
| Worker (real workerd, DO, R2, WebSockets) | 136 |
| Daemon | 64 |
| Dashboard | 63 |
| Obsidian plugin | 225 |
| Total | **1,129** |

Every workspace passes type checking. Core coverage passes the existing gate:
93.79% statements, 87.06% branches, 97.45% functions, and 95.33% lines.
Dashboard, plugin production, and CLI builds pass. The built CLI's help command
works. Wrangler's Worker build passes with `deploy --dry-run`; no deployment
was performed. The tracked plugin `main.js` was rebuilt from the fixed sources.

Logs and local evidence are under the ignored `dist/` directory, including
`fix-coverage-final.log`, `fix-typecheck-final.log`, `fix-node-final.log`,
`fix-daemon-final.log`, `fix-worker-final.log`, `fix-*-build.log`, and
`audit-fixed-final.json`. The original audit probes describe pre-fix behavior;
the permanent regression suites now verify the corrected behavior.

## Scope and remaining limits

No real-vault content, device pairing, installed Obsidian plugins, VPS services,
or Cloudflare deployments were changed. Continuous synchronization of ZeroKelvin
has not been activated. Tests used temporary vaults and local test services.

Path-component checks address existing links and ordinary replacement cases.
Portable Node filesystem APIs do not guarantee an atomic directory ancestry
check against a hostile process swapping parent directories concurrently.
The daemon should run with filesystem permissions appropriate to its vault.

The existing design still uses Cloudflare as the sync authority, requires
Obsidian to be running for its plugin to synchronize, and does not provide
end-to-end encryption or a continuous mobile background-sync guarantee.
Those design characteristics were not changed by the bug fixes.
