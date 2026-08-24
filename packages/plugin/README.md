# VaultSync for Agents — Obsidian plugin

Self-hosted vault sync through **your own** Cloudflare Worker. Desktop and
mobile Obsidian keep the same files as your AI agents and scripts — no
third-party service in the middle.

- What it does (requirements): [../../REQUIREMENTS.md](../../REQUIREMENTS.md)
- How sync works (architecture): [../../ARCHITECTURE.md](../../ARCHITECTURE.md)

## Install

### With BRAT (recommended for beta)

1. Install **BRAT** (*Beta Reviewers Auto-update Tool*) from Obsidian's
   community plugins and enable it.
2. BRAT settings → **Add Beta plugin** → paste `anuchin/vaultsyncforagents`.
3. Enable **VaultSync for Agents** in *Settings → Community plugins*.

BRAT installs from this repo's latest
[GitHub release](https://github.com/anuchin/vaultsyncforagents/releases)
(`main.js` / `manifest.json` / `styles.css` assets) and offers the update
automatically when a new release ships — no file copying, no rebuilds.

### Manually from a release

1. From the latest [release](https://github.com/anuchin/vaultsyncforagents/releases),
   download the three assets: `main.js`, `manifest.json`, `styles.css`.
2. In your vault, create `.obsidian/plugins/vaultsyncforagents/` and copy the
   three files into it.
3. Restart Obsidian (or reload), then enable **VaultSync for Agents** in
   *Settings → Community plugins*.

### Building from source

```sh
npm install
npm run build --workspace @vsa/plugin   # produces main.js (+ manifest.json, styles.css)
```

Copy `main.js`, `manifest.json`, and `styles.css` into
`.obsidian/plugins/vaultsyncforagents/` as above.

## Pairing walkthrough

You need a claimed worker first. If you don't have one, the plugin can make
it — two ways, from *Settings → VaultSync for Agents*:

- **Set up a new worker…** (recommended) — the in-app wizard. Name the vault,
  paste a Cloudflare API token (the **Create token** button opens Cloudflare's
  token page — the *"Edit Cloudflare Workers"* template has exactly the right
  permissions), and the plugin deploys the released worker + R2 storage into
  your account directly over the Cloudflare API: no GitHub, no terminal, no
  wrangler. The token is used for that deploy only and never stored. Multi-account
  tokens get an account picker.
- **Deploy via Cloudflare** — the web fallback. Cloudflare's Deploy Button
  provisions the same worker from a GitHub template (requires a GitHub or
  GitLab account).

### 1. Claim the worker (once, in a browser)

Open your worker URL (e.g. `https://personal.yourname.workers.dev`). You'll get
the claim page: set an **admin passphrase** and name the vault. Until a worker
is claimed, every API call is refused — pairing will show a friendly hint
telling you exactly this instead of a cryptic error.

### 2. Pair this device (manual)

1. On the worker dashboard, create a pairing code:
   *Devices → Pair new device* (codes are one-time and expire after 10 minutes).
2. In Obsidian: *Settings → VaultSync for Agents*.
3. Fill **Worker URL** (e.g. `https://personal.yourname.workers.dev`) and,
   optionally, a **Device name** (shown in the dashboard's device list).
4. Paste the **Pairing code** and press **Pair this vault**.

On success you get a "Paired with …" notice, a status-bar indicator
(`vsa ✓`), and the first sync runs immediately.

### 3. Pair another device (deep link or QR)

The dashboard renders an `obsidian://` link (and a QR code of it) for each
pairing code. On desktop, click the link; on mobile, scan the QR or tap it in
your browser — Obsidian opens and the plugin pairs with **zero typing**:

```
obsidian://vaultsyncforagents/pair?url=<worker-url>&code=<pairing-code>
```

No data beyond `url` and `code` is carried; the code is one-time and expires
quickly, so a leaked link is worthless minutes later.

## Everyday use

- **Status bar** (desktop): `vsa ✓ 12s` = live, last sync 12s ago ·
  `vsa ⋯` = syncing · `vsa ⚠ conflicts` = conflict copies were written ·
  `vsa ✗ offline` = worker unreachable, retrying with backoff. Hover for
  details.
- **Sync now** (settings): force a full reconciliation cycle on demand.
- **Rescan interval** (settings): periodic full rescan — 30 s by default. This
  is what catches files edited *outside* Obsidian while it is open. `Off` keeps
  only vault-event-driven sync.
- **Sync .obsidian/ folder** (settings): off by default. Opt in per device to
  sync settings/plugins; `workspace.json` and caches are always excluded. The
  worker's per-vault setting takes precedence once connected.
- **Unlink** (settings): stops sync and clears this device's local sync state.
  Files already in the vault are untouched. Revoke the device from the
  dashboard when you're done with it.

## Mobile sync contract

Obsidian mobile is killed in the background like any app — the plugin does
**not** promise background sync. The contract is the same as Obsidian Sync:

- **Sync on open**: every reconciliation runs when the app starts or comes
  back to the foreground, pulling everything missed while you were away.
- **Live while foregrounded**: vault events sync as you edit; the periodic
  rescan (30 s default) and a focus-triggered rescan catch external edits.
- Pairing on mobile needs no typing: scan the dashboard QR / tap its
  `obsidian://` link.

## Troubleshooting

| Symptom | What it means / what to do |
|---|---|
| "not claimed yet" when pairing | The worker is deployed but unclaimed. Open the worker URL in a browser, set the admin passphrase, then pair. |
| "Pairing failed: pairing code rejected" | Codes are one-time, expire after 10 min, and come from the dashboard. Generate a fresh one and retry. |
| "Could not reach the worker" | Check the URL (a bare host is fine — `https://` is assumed), your network, and that the worker is deployed (`GET /health` should answer). |
| Status bar stuck `vsa ✗ offline` | The worker is unreachable or restarting. The plugin retries with capped, jittered backoff; it will catch up in one batch when reachable. |
| Notice: "worker rejected this device's token" | The device was revoked on the dashboard. Unlink in settings and pair again with a fresh code. |
| Notice: "vault already has sync state for device …" | Another client (daemon, CLI, second plugin instance) is syncing this vault. One sync client per machine per vault — stop the other one (FR-44). |
| Conflict files (`Note (conflict … - from Device).md`) | Two devices edited the same file concurrently. Both contents are kept: the winner plus a conflict copy — nothing is lost. Delete/remerge the copy at your leisure. |
| Edits from external tools are slow to appear | External edits made while Obsidian is *closed* sync on next app open; while open, they're caught by the periodic rescan — lower the interval if needed. |

## Development

```sh
npm run test --workspace @vsa/plugin        # vitest, no Obsidian required
npm run typecheck --workspace @vsa/plugin   # tsc --noEmit
npm run build --workspace @vsa/plugin       # esbuild → main.js (ES2018, CJS)
```

The test suite runs against a fake Obsidian module (`test/helpers/obsidian-mock.ts`)
and fake network seams — there is no real Obsidian in CI, by design. The plugin
code has no Node imports: everything platform-specific reaches `@vsa/core`
through the adapter seams (`obsidian-storage.ts`, `obsidian-watch.ts`).
