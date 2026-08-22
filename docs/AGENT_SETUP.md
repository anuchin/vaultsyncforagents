# Agent setup brief — VPS daemon

> A self-contained brief for an AI agent (Claude Code, OpenClaw, Hermes, custom
> scripts) running on a Linux VPS. Hand it over verbatim, plus the three
> operator inputs under [Prerequisites](#prerequisites). The full system
> picture: [ARCHITECTURE.md](../ARCHITECTURE.md).

## What you'll set up

The `vsa` CLI and the VaultSync for Agents daemon on this server, paired to the
operator's sync worker. The daemon keeps one vault directory continuously in
sync: plain files you can read and edit, with your changes propagating to every
device (and theirs reaching you) in seconds. It runs as a user-level systemd
service — no root.

## Prerequisites

- A Linux VPS with systemd, network access to the worker URL, and git.
- Node.js 22 or newer (`node --version`) — the verified baseline is the 22 LTS
  line (the full link/sync/daemon flow ran on 22.23.2).
- From the operator (ask for them if missing):
  1. **Worker URL** — `https://<name>.<account>.workers.dev`
  2. **Pairing code** — minted on the worker dashboard
     (*Devices → Pair new device*). One-time, expires after 10 minutes;
     if it is rejected, ask for a fresh one.
  3. **Vault path** — where the vault lives on this server, e.g. `/srv/vault`.

## Install

Run everything as the user the agents will work as — not root.

Install the published CLI from npm (no clone needed):

```sh
node --version                    # must report v22 or newer
npm i -g vaultsyncforagents       # provides the `vsa` command (bin alias: `vaultsyncforagents`)
vsa --version
```

If the package is not on npm yet (or you prefer tracking the source), install
from a clone instead; every `vsa` invocation below is then
`npm run vsa -- <command>` run from the repo root:

```sh
git clone https://github.com/anuchin/vaultsyncforagents.git ~/vaultsyncforagents
cd ~/vaultsyncforagents
npm install                       # workspace install: CLI, daemon, shared core
npm run vsa -- --version
```

> Convention below: commands are written as `npm run vsa -- <command>` (the
> from-source form). With the npm install, they are simply `vsa <command>`.

## Pair the vault

```sh
mkdir -p /srv/vault                                  # the operator's chosen path
cd ~/vaultsyncforagents
npm run vsa -- link /srv/vault \
  --url https://personal.example.workers.dev \
  --code AB12-CD34 \
  --name agent-vps
```

Pass `--url`, `--code`, and `--name` explicitly — non-interactive sessions
require them. What `link` does, so you can diagnose it:

- Probes `GET /health`. An unclaimed worker prints browser claim steps and
  exits — have the operator claim it first, then retry.
- Refuses if `/srv/vault` already holds another device's
  `.vaultsyncforagents/` state (one sync client per machine per vault).
  Override with `--force` only if the operator confirms the old device is gone.
- Exchanges the code for a long-lived device token. Machine registry:
  `~/.config/vaultsyncforagents/config.json`; token: `secrets.json` next to it
  (mode 0600). A `.vaultsyncforagents/` state dir is created inside the vault.
- Runs an initial sync immediately: existing local files are pushed, remote
  files are pulled into the directory.

## Run as a service

```sh
cd ~/vaultsyncforagents
npm run vsa -- daemon install       # user-level systemd unit; starts now and at every login
loginctl enable-linger $USER        # once, so the user service survives logout / runs at boot
npm run vsa -- daemon status        # service state + per-vault sync lines
npm run vsa -- daemon logs          # journalctl --user --unit vaultsyncforagents
```

- The unit is `~/.config/systemd/user/vaultsyncforagents.service`, driven via
  `systemctl --user`. Never use root.
- If `daemon install`/`start` cannot reach the systemd user bus (common over
  SSH), run the `enable-linger` line, log out and back in, and retry.
- Foreground alternative for debugging: `npm run vsa -- daemon run`.
- Stop / remove: `npm run vsa -- daemon stop` / `npm run vsa -- daemon uninstall`.

## Verify

```sh
curl -s https://personal.example.workers.dev/health
# {"ok":true,"claimed":true,"serverVersion":"0.1.0","protocolVersion":1}

cd ~/vaultsyncforagents
npm run vsa -- status               # per vault: connected?, last sync, pending, conflicts
npm run vsa -- doctor               # reachability, claim, server version, token, clock skew, storage
npm run vsa -- logs                 # last ~50 events from the worker's event log
```

`doctor` exits non-zero if any check fails — fix everything it flags before
declaring success. Clock skew matters (conflict timestamps depend on it): if it
warns past 60 s, sync the system clock (`chrony` or `systemd-timesyncd`).

## How syncing behaves on the server

- The vault is plain files. Local edits are detected (filesystem watching,
  ~300 ms debounce) and pushed; remote edits are written within seconds of
  being made anywhere.
- Deleted files are not gone immediately: local deletions move to `.trash/`
  before tombstoning, and remote deletes land in `.trash/` too. Recover from
  there, or through version history (every version of every file is kept).
- Never synced, at any depth: `.trash/`, `.DS_Store`, `Thumbs.db`,
  `.vaultsyncforagents/` (client state). `.obsidian/` is off by default
  (opt-in per vault). Do not expect files in those paths to propagate, and keep
  scratch state you do NOT want synced out of the vault entirely.
- One sync client per machine per vault: never link the same directory twice,
  and never point another client (e.g. the Obsidian plugin) at the same tree on
  this machine — two watchers double-commit every change.
- A concurrent edit on another device resolves to a winner plus a conflict copy
  (`Note (conflict …).md`); both contents survive.

## Recovery: snapshots

Snapshot the vault before risky bulk edits — mass renames, scripted rewrites,
large deletions:

```sh
npm run vsa -- snapshot create "before agent refactor"   # server-side; prints the id (s1, s2, …)
npm run vsa -- snapshot list                             # newest first
npm run vsa -- snapshot restore s3 --yes                 # revert the whole vault
```

- `<idOrName>` resolves by exact id, else by name; a repeated name picks the
  latest. `--yes` skips the confirmation prompt.
- Restore is server-side and history-preserving: every reverted file lands as
  a new version, nothing is deleted, and every device — including this one —
  converges on its next sync.
- One file only: `npm run vsa -- restore <file> [--version <id>]`.

## Safety notes

- The worker sees plaintext (it lives in the operator's own Cloudflare account
  — ARCHITECTURE.md §14). Treat everything in the vault as readable on the
  server side: no secrets, credentials, or keys in the vault.
- The pairing code is a one-time capability; the device token on this machine
  grants permanent sync access. The operator can revoke the device from the
  dashboard or `vsa devices revoke` — a revoked token stops syncing
  immediately.
- Avoid case-only renames: case-insensitive clients (Windows/macOS) collide
  with this Linux daemon (ARCHITECTURE.md §14).
