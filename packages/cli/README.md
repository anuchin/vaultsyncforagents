# `vsa` — VaultSync for Agents CLI

Command-line client for a self-hosted [VaultSync for Agents](../../README.md)
deployment: pair a local vault directory with your Cloudflare worker, check
status, manage devices, browse history, restore old versions, and diagnose
problems. Works on Windows, macOS, and Linux (FR-58).

The CLI speaks the exact same protocol as the Obsidian plugin and the VPS
daemon (`@vsa/daemon`, driven via `vsa daemon`) — one shared sync core
(`@vsa/core`) everywhere.

## Install

Node.js 22 or newer is the only prerequisite (verified on the 22 LTS line).
The package is self-contained — zero runtime dependencies, no system tar/unzip.

```sh
npx vaultsyncforagents setup    # one-shot: deploy a worker + R2 bucket into your Cloudflare account
npm i -g vaultsyncforagents     # or install for repeated use (provides `vsa` and `vaultsyncforagents`)
```

Inside the repo, run it through the workspace bin (Node 22.7+ for
`--experimental-transform-types`; `npm run build` bundles dist/ for publishing):

```sh
npm run vsa -- status
npm run vsa -- link ./my-vault --url https://personal.x.workers.dev --code AB12-CD34
```

## Quickstart

You need a deployed (but possibly unclaimed) worker — see the project README.
Then:

```sh
# 1. Link a vault directory to your worker (interactive: asks for URL + code)
vsa link ~/vaults/personal

#    Fully non-interactive (agents, scripts, CI):
vsa link ~/vaults/personal --url https://personal.x.workers.dev --code AB12-CD34 --name agent-vps
```

Linking against an **unclaimed** worker prints claim instructions instead of
failing mysteriously: open the worker URL in a browser, set the admin
passphrase, mint a pairing code on the dashboard, and re-run `vsa link`.

If the worker is **unreachable**, the CLI says so and checks nothing else.

After linking, an initial sync pass runs immediately — local files are pushed,
remote files are pulled into the directory.

## Commands

### `vsa status`

Per-vault overview across every linked vault: connected?, claim state,
devices online/offline, last synced edit (time, device, path), attachment
count and bytes, storage used, and pending/conflicts from a real
reconcile-now snapshot (the CLI connects, syncs, reports, disconnects).

```sh
vsa status
vsa status --json            # scripting-friendly; always exit code 0
vsa status --vault ~/vaults/personal
```

### `vsa link [path]` / `vsa unlink [path]`

```sh
vsa link [path] [--url <url>] [--code <code>] [--name <name>] [--force]
vsa unlink [path]
```

One sync client per machine per vault (FR-44): if the target directory already
contains a `.vaultsyncforagents/` state dir owned by a different device, link
refuses and explains why (two clients on one tree double-commit every
change). `--force` overrides when the old state is stale. `unlink` only
removes the machine registration — files on disk are never touched.

### `vsa devices` / `vsa devices revoke <nameOrId>`

```sh
vsa devices                              # name, type, online, last seen, revoked
vsa devices revoke "Old Laptop" --vault ~/vaults/personal
vsa devices revoke dev-ab12cd34 --passphrase 'admin-pass' --yes   # non-interactive
```

Revocation needs the worker admin passphrase (prompted, or `--passphrase`).
Revoked devices lose access immediately; other devices keep syncing.

### `vsa logs`

The last ~50 events from the worker's event log, newest first:

```sh
vsa logs
vsa logs --vault work --json
```

### `vsa history <file>` / `vsa restore <file>`

```sh
vsa history notes/plan.md                       # version chain, newest first
vsa history notes/plan.md --json
vsa restore notes/plan.md                       # undo one edit
vsa restore notes/plan.md --version ver-abc123  # explicit version id
```

Restore is client-side: the old content is downloaded from the worker's
content-addressed blob store, written into the vault, and pushed through a
normal sync cycle — every other device picks it up like any edit.

### `vsa doctor`

Diagnostics per vault — reachability, claim state, token validity (a real
hello roundtrip), clock skew (warns past 60 s), storage usage, and hints
(claim flow, re-pair after revocation, another client's state dir). Exits
non-zero if any check fails; `--json` for machines.

```sh
vsa doctor
vsa doctor --json
```

## Global flags

| Flag | Meaning |
|---|---|
| `--vault <id\|path>` | Scope the command to one linked vault |
| `--json` | Machine-readable output |
| `--config <path>` | Alternate machine config (`config.json` / `secrets.json` live together) |

## Where state lives

- Machine registry: `%APPDATA%\vaultsyncforagents\config.json` (Windows) or
  `~/.config/vaultsyncforagents/config.json` (Linux/macOS); `XDG_CONFIG_HOME`
  overrides everywhere.
- Device tokens: `secrets.json` next to it (chmod 0600, best-effort on
  Windows).
- Per-vault sync state: `.vaultsyncforagents/` inside the vault itself
  (ignored by sync; includes a `device.json` marker that powers the
  one-client-per-machine rule).

## Agents on a VPS

The CLI is the manual / scripted client today: run `vsa link` once per vault,
then invoke `vsa status` / `vsa restore` / `vsa doctor` on demand, or edit
files and run a one-shot sync via `vsa status` (its snapshot reconciles).

For continuous, watched syncing — a daemon that keeps the vault live for
OpenClaw / Hermes / Claude Code style agents — use `vsa daemon` (systemd on
Linux, launchd on macOS; see [docs/AGENT_SETUP.md](../../docs/AGENT_SETUP.md)).
The engine it runs is the same `@vsa/core` + `@vsa/node-runtime` the CLI
shares.

## Development

```sh
npm run test:cli        # unit tests (fake worker + in-memory sync server)
npm run typecheck
npm run build --workspace vaultsyncforagents   # esbuild-bundle dist/cli.js for publishing
```

Command logic lives in `src/commands/*` as plain functions over an injectable
`VsRuntime` (config store, fetch, transport factory, clock, output, prompts) —
`src/cli.ts` is a thin commander layer on top. The published package is the
esbuild bundle (`build.mjs`): one plain-JS file, zero runtime dependencies;
`bin/vsa.js` runs it when `dist/` exists and falls back to the TypeScript
sources otherwise.
