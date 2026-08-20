# VaultSyncforAgents — Requirements

> What the project must do, in the owner's own terms. How it works lives in [ARCHITECTURE.md](./ARCHITECTURE.md).

## Vision

A personal, self-hosted sync engine for Obsidian vaults. Each vault gets its own Cloudflare Worker + R2 bucket, deployed in the user's own Cloudflare account. Every device — desktop Obsidian, phone Obsidian, and a VPS running AI agents — connects to that worker and stays in sync, with a status dashboard, a headless daemon, and a CLI.

The primary audience: people who run AI agents (OpenClaw, Hermes Agent, Claude Code, custom scripts) on a VPS and want their Obsidian vault live on that server, so agents can read, edit, create, and delete notes with changes propagating to all devices in seconds.

This is the successor to [remote-vault-for-agents](https://github.com/anuchin/remote-vault-for-agents) (v1: a headless YAOS client). v2 owns the entire stack — protocol, worker, plugin, daemon — and replaces both YAOS and RVA.

## Product components

| Component | What it is |
|---|---|
| Obsidian plugin | Client; install from community directory; drives deployment + pairing onboarding; syncs the vault |
| Cloudflare Worker (+ Durable Object, + R2) | Per-vault server: sync authority, device registry, blob storage, serves the dashboard |
| Dashboard | Status web app served by each user's own worker: engine health, devices, last edit synced, attachments |
| VPS daemon | Headless client; keeps vault directories on a server in sync so agents can work on plain files |
| CLI (`vsa`) | Setup, link, status, device management, history/restore, daemon control, diagnostics |

## Functional requirements

### Sync core

- **FR-1** — Bidirectional sync of vault content: markdown notes and attachments (images, PDFs, any binary).
- **FR-2** — Near-real-time propagation: an edit on any device reaches all other online devices in seconds.
- **FR-3** — Remote edits appear live in Obsidian editors that currently have the note open.
- **FR-4** — Graceful offline catch-up: after a device comes online (or Obsidian launches), all missed changes apply as a batch, without blocking the app.
- **FR-5** — External edits (files changed outside Obsidian while it was closed — other editors, scripts, local agents) are detected at next client start via index reconciliation and pushed. Nothing is ever silently lost.
- **FR-6** — Conflicts (two devices editing the same file concurrently) resolve to winner + a **conflict copy file** (Dropbox-style). Conflict policy is enforced server-side, per vault. *(No "agent mode" toggle in v1 — audience runs one agent; conflicts are rare.)*
- **FR-7** — Full version history for every file, plus trash/restore. Deleted files are recoverable.
- **FR-8** — Attachment storage is content-addressed and deduplicated (identical content stored once).
- **FR-9** — Renames and moves are detected and synced as renames (not delete+recreate) where possible.
- **FR-10** — Empty folders are synced (placeholder entries).
- **FR-11** — `.obsidian/` (settings/plugins) sync is **off by default**, opt-in per vault; volatile files (`workspace.json`, caches) always excluded.
- **FR-12** — Mobile behavior: sync on app open and while the app runs in the foreground (platforms kill background sockets — same contract as Obsidian Sync).

### Deployment & onboarding

- **FR-20** — Every user self-hosts: each vault gets its **own** Cloudflare Worker and R2 bucket in the user's own account (isolation per vault).
- **FR-21** — Onboarding starts from the plugin: a button takes the user to Cloudflare login with **preconfigured worker settings** (Deploy-to-Cloudflare template) — no manual wrangler config for non-technical users.
- **FR-22** — First-run **claim** is easy: after deploy the user lands on the worker's page, sets an admin passphrase, and the vault-to-worker claim is complete.
- **FR-23** — Devices join via short-lived **pairing codes** (shown as QR for mobile); each paired device gets a named identity with last-seen time, revocable from the dashboard or CLI.

### Dashboard

- **FR-30** — Served by the user's own worker (no second deployment required).
- **FR-31** — Shows: is the sync engine currently working (health), time of last synced edit, connected device count, offline device count (with last-seen), attachment count, storage used.
- **FR-32** — Authenticated with the admin passphrase set during claim.

### Daemon (VPS)

- **FR-40** — Headless service; keeps one or more local vault directories continuously synced with their workers, so AI agents and scripts can read/write plain `.md` files on the server.
- **FR-41** — Detects agent/script edits in near-real-time (filesystem watching) and pushes them.
- **FR-42** — Safe deletes: removed files go to a local `.trash/` recovery folder before tombstoning; remote deletes also land in `.trash/`.
- **FR-43** — Runs as a service: systemd (Linux, primary), launchd (macOS). Windows service support later.
- **FR-44** — One sync client per machine per vault (plugin and daemon must not both watch the same vault in v1; CLI warns).

### CLI (`vsa`)

- **FR-50** — `vsa setup` — deploy a new worker+R2 for a vault (interactive), prints claim URL.
- **FR-51** — `vsa link [path]` — pair this machine's vault to an existing worker (URL + pairing code); `vsa unlink`.
- **FR-52** — `vsa status` — all linked vaults: connected?, last sync, pending files, conflicts; how many vaults are connected.
- **FR-53** — `vsa devices` / `vsa devices revoke <name>` — device list and revocation.
- **FR-54** — `vsa history <file>` / `vsa restore <file> [--version]`.
- **FR-55** — `vsa daemon install|start|stop|status|logs`.
- **FR-56** — `vsa doctor` — connectivity, token validity, clock skew, R2 quota, hints.
- **FR-57** — `vsa logs` — recent sync events from the worker's event log.
- **FR-58** — CLI is fully cross-platform from day one (Windows, macOS, Linux).

## Non-functional requirements

- **NFR-1** — Free-tier friendly: the design targets Cloudflare's free plan (Workers, Durable Objects with SQLite, R2, Cron). Paid tiers should work identically; staying in free tier is a goal, not a hard requirement.
- **NFR-2** — Publishable: plugin submitted to the Obsidian community directory; npm packages for CLI/daemon; public template repo for the deploy button. Dogfooded by the author before release.
- **NFR-3** — Transport security v1: HTTPS/WSS only; worker sees plaintext (it lives in the user's own Cloudflare account). End-to-end encryption is a future add-on, not a v1 requirement, and must not require protocol redesign (content is already content-addressed blobs).
- **NFR-4** — TypeScript monorepo; one shared sync core used by plugin, daemon, and CLI.
- **NFR-5** — Agents are first-class writers: the engine is optimized for bulk, scripted, non-interactive edits (the documented failure mode of CRDT-based YAOS at scale).

## Non-goals (v1)

- CRDT / automatic text merging (LWW + conflict copies instead)
- Real-time collaborative editing
- Multi-user / team vaults
- End-to-end encryption
- Central multi-vault dashboard (per-worker dashboard only; aggregator later)
- Windows daemon service management (engine cross-platform; service install later)
- History-only "agent mode" conflicts (policy hook exists server-side; toggle later if needed)
- Interop with YAOS or migration tooling from YAOS vaults (copy files, fresh index)

## Naming

- Product: **VaultSyncforAgents** — display name "VaultSync for Agents"
- Obsidian plugin id: `vaultsyncforagents` (verified free)
- npm package: `vaultsyncforagents` (verified free)
- CLI binary: `vsa`
- Worker template repo: `vaultsyncforagents-template`
