# VaultSync for Agents

VaultSync for Agents synchronizes one logical Obsidian vault between desktop and mobile Obsidian and
plain directory trees on servers. Notes edited by Obsidian, an ordinary editor, Git, a script, or an
AI agent (Claude Code, OpenClaw, Hermes, custom tooling) travel through a user-owned Cloudflare
deployment to every paired device within seconds. Each vault gets its own Worker with a Durable
Object as the sync authority and an R2 bucket for content; one shared sync core (`@vsa/core`) runs
inside every client — the Obsidian plugin, the headless VPS daemon, and the `vsa` CLI — and the
worker also serves the vault's status dashboard.

> **Status:** pre-release, dogfooding (`0.1.0`). All seven packages are implemented and unit-tested
> (`npm test` chains every suite), and the CDP-driven end-to-end harness in `scripts/e2e` has run
> bidirectional two-vault scenarios against real Obsidian and deployed workers, in both clean and
> hardened production builds, including large-vault runs. `worker-bundle.zip` releases (`v0.1.0` –
> `v0.1.2`) already feed the deploy-button template and `vsa setup`. Not yet done: Obsidian
> community-directory submission and npm publishing — see NFR-2 in [REQUIREMENTS.md](REQUIREMENTS.md).

## What is included

| Component                 | Purpose                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| `packages/core`           | Shared sync engine, runs everywhere: local index, reconciliation, version clocks, conflict detection, rename detection, ignore rules, protocol client, version-compat policy. Web APIs only. |
| `packages/worker`         | Cloudflare Worker: `VaultRoom` Durable Object (single-writer authority), blob routes, claim/pairing endpoints, dashboard host, weekly GC cron. |
| `packages/plugin`         | Obsidian plugin (desktop + mobile): pairing UI, live sync, status bar, settings, `obsidian://` deep links, support-bundle export.           |
| `packages/daemon`         | Headless client for servers: multi-vault filesystem watching, `.trash/` deletes, systemd/launchd service installers.                       |
| `packages/cli`            | `vsa`: link, status, devices, history/restore, snapshots, `setup` deploy, daemon control, `doctor`, `logs`. Windows, macOS, Linux.          |
| `packages/dashboard`      | Claim + status SPA, built into the worker's static assets — no second deployment.                                                          |
| `packages/node-runtime`   | Node glue shared by the CLI and daemon: fs storage adapter, HTTP blob store, WebSocket transport, machine config and token store.          |
| `template/`               | Source of the separate deploy-button repo: provisions worker + Durable Object + R2 + cron from a pinned release's `worker-bundle.zip`.     |

The Cloudflare footprint is designed for the free tier (Workers, Durable Objects with SQLite, R2,
one weekly cron) — see the budget math in [ARCHITECTURE.md](ARCHITECTURE.md) §13. Free-tier
operation is a goal, not a guarantee; the dashboard surfaces bytes used.

## How sync works

The model in brief ([ARCHITECTURE.md](ARCHITECTURE.md) §4 has the details):

- The Durable Object is the **single-writer sync authority** for a vault: all metadata lives in its
  SQLite storage, and every commit is conflict-checked and applied in one transaction.
- Whole-file last-writer-wins. A concurrent edit resolves to one winner plus a server-synthesized
  conflict copy (`Note (conflict … - from Phone).md`) — no content is ever dropped, and every client
  materializes the identical name.
- File content lives in R2 as content-addressed blobs (`blobs/{sha256}`), deduplicated: identical
  content is stored once, whatever file or version references it.
- Version history for every file is kept forever. Deletes are tombstones; any version of any file
  is restorable.
- Clients hold one WebSocket to the Durable Object. Commits fan out to other connected clients in
  seconds; offline devices catch up from a persisted cursor on reconnect. Notes under 256 KB ride
  the socket inline; attachments stream over HTTPS blob routes.

## Reliability and operations

- Vault snapshots (`vsa snapshot create [name] / list / restore <idOrName>`): one action captures a
  whole-vault restore point. Restore runs server-side, lands as new versions, and never deletes
  history.
- Version reporting and compat checks: the worker reports its version (`/health`, `helloAck`) and
  every client assesses it against the documented policy — advisory warnings in the plugin and
  `vsa doctor`; the only hard gate is the wire protocol at the hello handshake
  ([docs/UPGRADING.md](docs/UPGRADING.md)).
- Support bundle: one command in the plugin exports redacted diagnostics (versions, connection,
  settings, sync state, recent logs) to a file or the clipboard — never the device token, never
  file contents.
- [docs/AGENT_SETUP.md](docs/AGENT_SETUP.md) is a self-contained brief you can hand verbatim to an
  AI agent on a VPS: it installs, pairs, and verifies the daemon without supervision.

## Security boundary

VaultSync provides authenticated transport (HTTPS/WSS) and per-vault, per-device isolation. It does
**not** provide end-to-end encryption. The worker — deployed in your own Cloudflare account — can
read paths, note content, hashes, and attachments. Never put API tokens, recovery kits, or daemon
state inside a synchronized vault. Details: [ARCHITECTURE.md](ARCHITECTURE.md) §14.

## Install

Nothing is published to npm or the Obsidian community directory yet; everything below runs from
this repo today.

- **Obsidian plugin** — built from source. `npm run build --workspace @vsa/plugin` bundles `main.js`
  with esbuild; copy `main.js`, `manifest.json`, and `styles.css` into a vault's
  `.obsidian/plugins/vaultsyncforagents/`. Exact steps in
  [packages/plugin/README.md](packages/plugin/README.md).
- **Worker** — self-hosted, one per vault. The Cloudflare Deploy Button template provisions worker +
  Durable Object + R2 + cron in your own account, pinned to a released `worker-bundle.zip`;
  `vsa setup` does the same from the terminal. Details: [template/README.md](template/README.md).
- **CLI and daemon** — run from a clone: `npm run vsa -- <command>` (Node 24+). The
  `npm i -g vaultsyncforagents` shortcut is planned; publishing is not set up yet.

- [Install the Obsidian plugin](packages/plugin/README.md)
- [Deploy or update the worker](template/README.md)
- [Give a trusted agent the VPS installation brief](docs/AGENT_SETUP.md)
- [Check versions and update](docs/UPGRADING.md)

## Get started

For a new vault, the intended path:

1. Build and enable the plugin in Obsidian ([packages/plugin/README.md](packages/plugin/README.md)).
2. Deploy a worker into your Cloudflare account — the plugin's **Deploy your worker** button, the
   template's deploy button, or `vsa setup`.
3. Open the worker URL and claim it: set the admin passphrase and name the vault.
4. Pair devices from the dashboard (*Devices → Pair new device*): paste the code into plugin
   settings, scan the QR, or click the `obsidian://` deep link.
5. Optional: hand [docs/AGENT_SETUP.md](docs/AGENT_SETUP.md) to an agent on a VPS for the watched
   daemon.

## Local development

Requirements: Node.js 24 or newer and npm (workspaces). The `vsa` bin re-execs Node with
`--experimental-transform-types` to run the TypeScript sources directly; a bundled plain-JS build
replaces that when publishing happens.

```sh
npm install            # install workspace dependencies
npm test               # all seven suites: core, node-runtime, cli, worker, daemon, dashboard, plugin
npm run typecheck      # tsc --noEmit in every workspace
npm run test:worker    # one suite alone (test:core, test:cli, test:daemon, … likewise)
npm run vsa -- status  # run the CLI from source
```

`@vsa/core` is platform-portable by contract: Web APIs only, no Node-specific imports — it runs
unchanged in Obsidian mobile and Cloudflare Workers. Platform capabilities (fs, watchers, logging)
reach the engine only through the adapters in `core/src/adapters.ts`; `@vsa/node-runtime` and the
plugin supply the real ones.

## Repository layout

```text
packages/core/           Shared sync engine + protocol client (platform-portable)
packages/worker/         Cloudflare Worker: Durable Object, blob routes, claim/pairing, GC cron
packages/plugin/         Obsidian plugin (desktop + mobile)
packages/daemon/         Headless multi-vault daemon + systemd/launchd installers
packages/cli/            `vsa` command-line client
packages/dashboard/      Claim + status SPA, embedded into the worker
packages/node-runtime/   Node adapters and machine config shared by the CLI and daemon
template/                Deploy-button worker template (its own repo when published)
scripts/                 Release bundle builder and real-Obsidian e2e harness
docs/                    Agent setup brief and upgrading guide
REQUIREMENTS.md          What the project must do
ARCHITECTURE.md          How it works
```

Guides:

- [Requirements](REQUIREMENTS.md) — what the project must do: functional requirements, naming,
  non-goals.
- [Architecture](ARCHITECTURE.md) — how it works: protocol, storage model, security, free-tier
  budget.
- [Agent setup brief](docs/AGENT_SETUP.md) — install, pair, and verify the VPS daemon via an AI
  agent.
- [Upgrading](docs/UPGRADING.md) — version reporting, the compatibility policy, and update order.
