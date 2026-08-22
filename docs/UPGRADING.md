# Upgrading

> Which parts move, how to check what you're running, and in what order to
> update them. How it all works: [ARCHITECTURE.md](../ARCHITECTURE.md).

## The moving parts

| Part | Where it lives | How it updates |
|---|---|---|
| Sync worker (+ Durable Object, R2) | Your Cloudflare account, deployed from your copy of the `vaultsyncforagents-template` repo or `vsa setup` | Edit the template's `VERSION` → push; its workflow redeploys |
| Obsidian plugin | Every desktop/mobile machine with the vault open | Obsidian's plugin updater (community directory; manual before listing) |
| CLI + daemon | Every server/machine with a vault linked | `npm i -g vaultsyncforagents@latest` (or re-pull the source clone) |

## What you're running

- **Worker:** `curl https://<worker-url>/health` →
  `{"ok":true,"claimed":true,"serverVersion":"0.1.0","protocolVersion":1}`.
  Dev builds report `0.1.0-dev`; servers from releases ≤ 0.1 report no
  `serverVersion` at all.
- **Plugin:** Settings → VaultSync for Agents → About — the *Versions* row
  (plugin + protocol) and the *Server version* row.
- **CLI:** `vsa --version`.
- **All at once, per vault:** `vsa doctor` — its `server version` check applies
  the shared compat policy below and confirms `/health` and `/api/status`
  report the same version.

## Compatibility policy

The only hard gate is the wire protocol: the WS hello must match the server's
`protocolVersion` exactly, or the connection is refused. Every release-level
verdict is advisory (`@vsa/core`, `compat.ts`; floor
`MIN_SUPPORTED_SERVER_VERSION = 0.1.0`):

| Situation | Verdict |
|---|---|
| Same major/minor as the client (any patch gap, either direction) | ok |
| Server reports no version | warn — "predates version reporting (≤ 0.1)"; update the worker |
| Server a major or minor ahead of the client | warn — update the client when convenient |
| Server version not semver | warn — compatibility unknown |
| Server older than 0.1.0 | error — update the worker |

Where verdicts surface: the plugin shows a Notice (at most once per session)
and a note in the status-bar tooltip; `vsa doctor` reports a `server version`
check that fails the whole command only on the error verdict. Warnings never
stop sync.

## Updating the worker

Your worker is deployed from your copy of the deploy-button template repo,
pinned to a release tag in its `VERSION` file. To move to release `vX.Y.Z`:

1. Edit `VERSION` in the template repo to `vX.Y.Z`, commit, push to `main`.
2. The *Deploy vault worker* workflow downloads that release's
   `worker-bundle.zip` from GitHub Releases and redeploys. That's it.

For a one-off test, run the workflow manually (Actions → *Deploy vault worker*
→ *Run workflow*) with the `release` input set to a tag; blank means "use
`VERSION`".

- Data is untouched: Durable Object storage and R2 blobs survive every
  redeploy — the template ships code only.
- New vaults (not updates): `vsa setup` performs the same pinned-release
  deploy interactively.

## Updating the plugin

Once listed in the Obsidian community directory, updates arrive through
Obsidian's plugin updater. Until then, replace the plugin's files under
`.obsidian/plugins/vaultsyncforagents/` with a fresh build from the repo.

## Updating the CLI + daemon

Installed from npm (`npm i -g vaultsyncforagents`):

```sh
npm i -g vaultsyncforagents@latest
vsa daemon stop
vsa daemon start
```

(The systemd unit's `ExecStart` points at the installed CLI, so upgrading the
package and restarting is the whole update — no reinstall. Machines that only
use the CLI skip the daemon lines.)

Installed from a source clone instead:

```sh
cd ~/vaultsyncforagents                     # your clone
git pull
npm install
npm run vsa -- daemon stop
npm run vsa -- daemon start
```

The systemd unit's `ExecStart` points at the daemon entry inside the clone, so
a pull + restart is the whole update — no reinstall. Machines that only use
the CLI skip the daemon lines.

## Recommended order

**worker → CLI/daemon → plugin.**

Protocol changes are additive: new message types and optional fields. An older
client against a newer server is unaffected (the new fields are optional on the
wire); a newer client against an older server keeps syncing but its new
commands fail (e.g. a ≤ 0.1 worker has no snapshots). Updating the worker first
means every client can adopt new features the moment it updates.

## Before any update: snapshot

```sh
npm run vsa -- snapshot create "before update to vX.Y.Z"
```

A belt-and-braces rollback point: if an update misbehaves,
`vsa snapshot restore <idOrName>` reverts the whole vault without deleting
history (see [AGENT_SETUP.md](./AGENT_SETUP.md), *Recovery*).
