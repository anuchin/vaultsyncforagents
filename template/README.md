# VaultSync for Agents — worker template

Deploy your own private Obsidian-vault sync engine (Worker + Durable Object + R2)
into **your** Cloudflare account. One worker per vault, free tier friendly,
no central server — [ARCHITECTURE.md](https://github.com/vaultsyncforagents/vaultsyncforagents/blob/main/ARCHITECTURE.md)
has the full picture.

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/vaultsyncforagents/vaultsyncforagents-template)

## Deploy to Cloudflare (one click)

1. Click the button above.
2. Authorize GitHub (this repo is cloned into your account) and Cloudflare
   (the deploy button configures the `CLOUDFLARE_API_TOKEN` and
   `CLOUDFLARE_ACCOUNT_ID` secrets for you).
3. Wait for the **Deploy vault worker** workflow to finish (a minute or two) —
   the workflow summary shows your worker's URL.

Prefer a terminal? Skip to [`vsa setup`](#cli-alternative-vsa-setup) below.

### What gets provisioned

| Resource | Name (default) | For |
|---|---|---|
| Worker | this repo's name (override with the `WORKER_NAME` repo variable) | sync server + dashboard |
| Durable Object (`VaultRoom`, SQLite) | created with the worker | single-writer sync authority (ARCHITECTURE.md §6) |
| R2 bucket | `vaultsync-<worker name>` (override with `R2_BUCKET_NAME`) | content-addressed blobs, every version kept |
| Cron trigger | Mondays 03:00 UTC | weekly orphan-blob garbage collection |

All four are declared in [`wrangler.jsonc`](./wrangler.jsonc); the workflow
resolves its `__WORKER_NAME__` / `__R2_BUCKET__` placeholders, creates the
bucket if missing, and deploys. Nothing else lands in your account.

### The release bundle (artifact convention)

The worker code is **not** in this repo. This template tracks a released
version of [VaultSyncforAgents](https://github.com/vaultsyncforagents/vaultsyncforagents)
(pinned in [`VERSION`](./VERSION)) and downloads that release's
`worker-bundle.zip` during CI:

```
worker-bundle.zip
├── worker.js       # bundled worker entry (ESM; exports VaultRoom)
└── dashboard/      # built dashboard SPA (served at / via the ASSETS binding)
```

Every monorepo release tag `vX.Y.Z` ships that zip as a release asset.

## API token permissions

If you set the secrets yourself instead of letting the deploy button do it,
create the token at **Cloudflare dashboard → My Profile → API Tokens →
Create Token → Custom**, scoped to your account, with:

- [ ] Account → **Workers Scripts** → **Edit** (deploy the worker, run its DO migration)
- [ ] Account → **Workers R2 Storage** → **Edit** (create the bucket)
- [ ] Account → **Account Settings** → **Read** (account lookup during deploy)

(That set is exactly what Cloudflare's built-in **"Edit Cloudflare Workers"**
token template grants — using the template is fine.) Store it as the repo
secret `CLOUDFLARE_API_TOKEN`, and put your account id in
`CLOUDFLARE_ACCOUNT_ID` (dashboard → Workers & Pages → right sidebar).

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

- Edit [`VERSION`](./VERSION) to the release tag you want (or dispatch the
  workflow with a `release` input for a one-off test) and push to `main` —
  the workflow re-downloads the bundle and redeploys. Config and data
  (DO storage + R2 blobs) are untouched.
- To roll your own build instead, replace the download step with a checkout
  of the monorepo and `wrangler deploy` from `packages/worker` — the
  bindings in this template match that config.

## CLI alternative: `vsa setup`

If you have Node 20+ and prefer the terminal, the [`vsa` CLI](https://github.com/vaultsyncforagents/vaultsyncforagents/tree/main/packages/cli)
does the same flow interactively (it can also reuse an existing
`wrangler login`):

```
npx vsa setup
```

It asks for the vault name, derives `vaultsync-<slug>-<suffix>` worker +
bucket names, authenticates (browser login or a pasted API token), downloads
the pinned release bundle, creates the bucket, deploys, and prints the claim
URL — then hands off to `vsa link`.

## Repo layout

```
wrangler.jsonc                    # bindings; __WORKER_NAME__/__R2_BUCKET__ placeholders
VERSION                           # pinned VaultSyncforAgents release tag
scripts/resolve-config.mjs        # placeholder → wrangler.resolved.jsonc (+ name sanitizing)
.github/workflows/deploy.yml      # download bundle → ensure bucket → deploy
```
