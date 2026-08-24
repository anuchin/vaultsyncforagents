# VaultSync for Agents — worker template

Deploy your own private Obsidian-vault sync engine (Worker + Durable Object + R2)
into **your** Cloudflare account. One worker per vault, free tier friendly,
no central server — [ARCHITECTURE.md](https://github.com/anuchin/vaultsyncforagents/blob/main/ARCHITECTURE.md)
has the full picture.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/anuchin/vaultsyncforagents-template)

> **Note on the repo location:** the deploy button needs a real, public repo,
> so this template currently lives under the maintainer's personal account
> (`anuchin`) rather than a project org. Moving it to a real org later is a
> one-line change: replace `github.com/anuchin/` with the org URL in this
> README, in `scripts/prepare-deploy.mjs` (the bundle-download URL), and in
> the plugin's `DEPLOY_URL` constant — then update the deploy button URL.

## Deploy to Cloudflare (one click)

1. Click the button above.
2. Connect your GitHub account and Cloudflare. Cloudflare clones this repo
   into your account (you pick the name — it also names your worker) and
   asks for the one resource the worker needs: an R2 bucket (create one,
   the default name is fine).
3. **Deploy** — Cloudflare's Workers Builds runs this repo's `npm run
   deploy`, which fetches the pinned release bundle (digest-verified),
   extracts it, resolves the worker/bucket names, creates the bucket if
   needed, and deploys. A minute later your worker's URL is live.

Leave "Protect with Cloudflare Access" **off** — the Obsidian plugin, CLI,
and daemon authenticate with their own device tokens and cannot pass
through Cloudflare Access.

Prefer no GitHub at all? The Obsidian plugin's **Set up a new worker…**
wizard deploys the same bundle from inside Obsidian (API token in, claim
URL out), or use [`vsa setup`](#cli-alternative-vsa-setup) in a terminal.

### What gets provisioned

| Resource | Name (default) | For |
|---|---|---|
| Worker | your repo's name (the deploy form lets you change it) | sync server + dashboard |
| Durable Object (`VaultRoom`, SQLite) | created with the worker | single-writer sync authority (ARCHITECTURE.md §6) |
| R2 bucket | the bucket you pick in the deploy form (default `vaultsync-<worker name>`) | content-addressed blobs, every version kept |
| Cron trigger | Mondays 03:00 UTC | weekly orphan-blob garbage collection |

All four are declared in [`wrangler.jsonc`](./wrangler.jsonc); the deploy
command resolves the `__WORKER_NAME__` / `__R2_BUCKET__` placeholders,
creates the bucket if missing, and deploys. Nothing else lands in your
account — no repo secrets, no API tokens stored anywhere.

### The release bundle (artifact convention)

The worker code is **not** in this repo. This template tracks a released
version of [VaultSyncforAgents](https://github.com/anuchin/vaultsyncforagents)
(pinned in [`VERSION`](./VERSION)). The deploy command downloads that
release's `worker-bundle.zip`, verifies it against its `.sha256` sidecar,
and extracts it:

```
worker-bundle.zip
├── worker.js       # bundled worker entry (ESM; exports VaultRoom)
└── dashboard/      # built dashboard SPA (served at / via the ASSETS binding)
```

Every monorepo release tag `vX.Y.Z` ships that zip as a release asset.

## After the deploy: claim + pair

1. **Open the worker URL** (`https://<worker-name>.<your-subdomain>.workers.dev`).
2. **Claim it:** set an admin passphrase and name the vault. Until then every
   API call returns `421 unclaimed` — the worker is yours the moment you claim
   it (first writer wins).
3. **Pair devices:** on the dashboard, *Devices → Pair new device* gives you a
   one-time pairing code (10-minute TTL) with a QR code:
   - Obsidian plugin: paste URL + code in settings, scan the QR, or click the
     `obsidian://` deep link — click-through, no typing.
   - CLI / daemon on a server: `vsa link --url <worker-url> --code <CODE>`.

## Updating to a new release

Edit [`VERSION`](./VERSION) to the release tag you want and push to `main` —
Workers Builds reruns the deploy command against the new bundle. Config and
data (DO storage + R2 blobs) are untouched.

## CLI alternative: `vsa setup`

If you have Node 20+ and prefer the terminal, the [`vsa` CLI](https://github.com/anuchin/vaultsyncforagents/tree/main/packages/cli)
does the same flow interactively (it can also reuse an existing
`wrangler login`):

```
npx vaultsyncforagents setup
```

It asks for the vault name, derives `vaultsync-<slug>-<suffix>` worker +
bucket names, authenticates (browser login or a pasted API token), downloads
the pinned release bundle, creates the bucket, deploys, and prints the claim
URL — then hands off to `vsa link`.

## Repo layout

```
wrangler.jsonc                    # bindings; __WORKER_NAME__/__R2_BUCKET__ placeholders
VERSION                           # pinned VaultSyncforAgents release tag
package.json                      # the `deploy` command Workers Builds runs
scripts/prepare-deploy.mjs        # fetch+verify+extract bundle → resolve names → ensure bucket
```
