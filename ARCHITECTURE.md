# VaultSyncforAgents — Architecture

> How the system works. What it must do lives in [REQUIREMENTS.md](./REQUIREMENTS.md).
> Status: design agreed in interview, 2026-08-20. Pre-implementation.

## 1. Overview

```
                        ┌────────────────────────────────────────────────┐
                        │            Cloudflare (user's account)         │
                        │                                                │
   obsidian:// ────────►│  Worker (one per vault)                        │
   deep link + QR       │  ├── GET /            → dashboard SPA          │
   after claim          │  ├── /blob/:hash      → R2 streaming routes    │
                        │  ├── WS /sync         → Durable Object "vault" │
   deploy button ──────►│  │     • file index (SQLite)                   │
   (preconfigured       │  │     • version history                        │
    template)           │  │     • device registry + tokens (hashed)      │
                        │  │     • event log, pairing codes, settings    │
                        │  │     • WebSocket fan-out to all clients      │
                        │  ├── R2 bucket: blobs/{sha256} (content-addressed,
                        │  │     deduplicated, every version kept)       │
                        │  └── Cron trigger: weekly orphan-blob GC       │
                        └───────┬───────────────┬───────────────┬────────┘
                                │ WS + HTTPS    │ WS + HTTPS    │ WS + HTTPS
                        ┌───────▼──────┐ ┌──────▼───────┐ ┌─────▼────────────┐
                        │ Obsidian     │ │ Obsidian     │ │ VPS daemon       │
                        │ plugin       │ │ plugin       │ │ (headless,       │
                        │ (desktop)    │ │ (mobile)     │ │  multi-vault)    │
                        └──────────────┘ └──────────────┘ └─────┬────────────┘
                                                                 │ plain files
                                                        ┌────────▼────────────┐
                                                        │ AI agents / scripts │
                                                        │ (OpenClaw, Hermes,  │
                                                        │  Claude Code, …)    │
                                                        └─────────────────────┘

  vsa CLI ── same protocol as any client; also drives deploy/claim/pairing/admin
```

Core idea: the **Durable Object is the single-writer sync authority** for a vault. All metadata lives in its SQLite storage; all content lives in R2 as content-addressed blobs; all clients (plugin, daemon, CLI) run one shared sync core and talk to the DO over a WebSocket, with blobs streamed over plain HTTPS routes.

Why this shape (vs alternatives considered — see §15 Decision log):

- **Single-writer authority** (the DO) eliminates lost-update races by construction.
- **Whole-file LWW + conflict copies** instead of CRDTs: YAOS's documented ceiling (~117 bytes per CRDT item in one monolithic Y.Doc, memory never reclaimed) is exactly amplified by agent/script bulk-writes — this design has no such ceiling; agents are the *primary* user, not the failure mode.
- **Content-addressed blobs** make version history nearly free, deduplicate identical content, and leave the door open for E2E encryption later (encrypt blob payloads, no protocol change).

## 2. Components

| Package | Runs where | Responsibility |
|---|---|---|
| `core` | everywhere (shared lib) | Sync engine: local index, reconciliation, version clocks, conflict detection, ignore rules, rename detection, protocol client, retry queues |
| `worker` | Cloudflare | DO (`VaultRoom`), blob routes, dashboard host, pairing/claim endpoints, GC cron |
| `plugin` | Obsidian desktop + mobile | Onboarding UI, settings, status indicator; uses `core` over Obsidian's vault adapter; `obsidian://` protocol handler |
| `daemon` | Linux/macOS VPS | Headless client over Node fs + chokidar; multi-vault; systemd/launchd units |
| `cli` | any dev machine | `vsa` — deploy (wrangler/API), link, status, devices, history/restore, daemon control, doctor, logs |
| `dashboard` | built into worker | SPA (framework of choice) served by the worker at `/`; claim page + status page |
| `vaultsyncforagents-template` | separate repo | Minimal worker template for the Cloudflare Deploy Button; pinned to a released worker version |

## 3. Identity, claim, and pairing

**Lifecycle of a worker:** `unclaimed → claimed`.

1. **Deploy.** User clicks "Create my sync worker" in the plugin → browser opens `https://deploy.workers.cloudflare.com/?url=https://github.com/anuchin/vaultsyncforagents-template` → Cloudflare login → approve. The template provisions worker + Durable Object class + R2 bucket + cron trigger with preconfigured settings (via the template's CI; wrangler provisions declared resources). The user never edits config.
2. **Claim.** Deploy finishes → user lands on `https://<their-worker>.workers.dev/` → the worker serves its claim page → user sets an **admin passphrase** (argon2 hash stored in DO `meta`) and names the vault. Until claimed, every API call returns `421 unclaimed`. Claiming also mints the first device pairing.
3. **Pair devices.** The dashboard (admin-authenticated) issues short-lived **pairing codes** (e.g. `7F3K-Q9M2`, 10-min TTL, one-time, stored hashed in DO). Each device enters URL + code once:
   - Plugin: settings form, or scans a QR (dashboard renders QR containing URL + code), or clicks an `obsidian://vaultsyncforagents/pair?...` deep link — the plugin registers an Obsidian protocol handler, so the whole flow can be click-through with zero typing.
   - CLI/daemon: `vsa link` prompts for both.
   Exchange returns a **long-lived device token** (random 256-bit), stored **hashed** server-side with device name/type/last-seen. Tokens are presented as a bearer header on HTTP and in the WS hello.
4. **Revoke.** Dashboard or `vsa devices revoke <name>` → DO marks the device revoked; subsequent calls with that token are rejected; other clients unaffected.

Admin authentication for the dashboard: passphrase → worker issues a signed session cookie (HMAC with a worker secret). One admin per worker; devices are the only other identity (this is single-user by design).

Guessing is throttled where trust is absent: `POST /pair` and `POST /admin/login` failures are budgeted per client IP (10 failures / 15 min → `429` + `Retry-After`); pairing codes are 40-bit one-time codes with a 10-min TTL.

## 4. Sync model

**Unit:** the file. Notes and attachments are both whole files; there is no delta sync in v1.

**Content:** every distinct file version is stored in R2 as `blobs/{sha256}` (text compressed with gzip before upload). Identical content across files/devices/versions deduplicates automatically.

**Versioning & LWW:** each file has a version chain in the DO. A commit names its parent version. If the parent is the current head → fast-path apply. If not (concurrent edit happened) → **conflict**:

- Winner = higher logical clock; tie broken by device id (stable, deterministic on every client).
- Loser content is **never deleted**: per the settled policy, a **conflict copy file** is synthesized server-side as a normal file event — `Note (conflict 2026-08-20 14-23 - from Phone).md` — so every client materializes it identically. Same-note/same-device/same-minute collisions get ` 2`…` 999` suffixes before the extension, synthesized server-side so all clients materialize identical names.
- Clocks are per-file monotonic versions maintained by the DO, with per-device counters for tie-breaking. Wall-clock time is display-only, never authoritative.

**Deletes:** tombstones in the index (files stay recoverable from history). The daemon moves locally-deleted files to `.trash/` before tombstoning (v1 pattern, carried from RVA); remote deletes land in clients' `.trash/` too.

**Renames/moves:** clients correlate delete+add pairs by content hash within a short window (v1 pattern) and commit an explicit rename op; the DO records it as one version-chain migration, not delete+create, so history follows the file.

**Folders:** empty folders sync as placeholder entries (explicit non-goal in YAOS; supported here).

**Ignore rules** (core, shared by all clients): `.trash/`, `.DS_Store`, sync-state dir (`.vaultsyncforagents/` inside the vault holds the client's local index), and the volatile `.obsidian/` files (see FR-11). Vault-scoped ignore extras configurable per vault.

**`.obsidian/`:** excluded by default; opt-in per vault syncs it except `workspace.json`, `workspace-mobile.json`, and cache directories.

**Client coexistence rule:** one sync client per machine per vault in v1. `vsa link` and the plugin detect another client's live state dir for the same vault and warn. (A lockfile handshake where the daemon yields to a running Obsidian is a planned enhancement, not v1.)

## 5. Protocol

Two channels to the worker, both token-authenticated:

**WebSocket (`/sync`, terminated in the DO)** — metadata and change feed, JSON messages:

| Direction | Message | Purpose |
|---|---|---|
| C→S | `hello {token, protocolVersion, cursor}` | auth + last-seen version sequence |
| S→C | `helloAck {deviceId, vaultName, settings, serverVersion}` or `421 unclaimed` / `401 revoked` | |
| C→S | `getManifest {since?}` | full or delta manifest: `{path → {version, hash, size, deleted, mtime}}` |
| C→S | `commit {path, parentVersion, hash, size, inline?}` | new version; content inline (base64) if ≤ **256 KB**, else client uploads the blob first via HTTP and references the hash |
| S→C | `commitAck {version, clock}` or `conflict {winner, loserDisposition}` | server is the sole arbiter |
| S→C | `change {path, version, hash, size, deleted, device}` | fan-out broadcast to all *other* connected clients |
| S→C | `deviceSeen {deviceId, ts}` etc. | presence for dashboard/`status` |
| C→S | `snapshotCreate {name?}` | whole-vault restore point: heads captured atomically server-side; no fan-out (list via `GET /api/snapshots`) |
| S→C | `snapshotCreateAck {id, name, ts, seq, fileCount}` | ids are `s1, s2, …` |
| C→S | `snapshotRestore {id}` | revert every head to the snapshot |
| S→C | `snapshotRestoreAck {id, restored, tombstoned, seq}` | restore = new fast-path versions, fanned out to other clients; history never deleted |
| C↔S | `ping/pong` | keepalive; DO hibernation between events |

**HTTPS routes (worker, streamed)** — content and admin:

- `GET/PUT /blob/:hash` — stream to/from R2; PUT is idempotent (same hash ⇒ same content) and verifies the streamed body actually hashes to `:hash` while it flows (DigestStream; mismatch → `422` and the stored object is evicted — R2-side checksums would catch a corrupted put as a second net); enforced size cap ~100 MB (Workers request limit; YAOS capped 10 MB — we're 10× that, chunked uploads later if demanded).
- `GET /health` — liveness + claimed state + `serverVersion`/`protocolVersion` (for `vsa doctor` and uptime checks).
- `GET /api/status` — dashboard/CLI data: engine health, devices with last-seen, last synced edit, attachment count, R2 bytes used, recent events.
- `GET /api/snapshots` — vault-level snapshot list, newest first (device token or admin session).
- Claim/pairing endpoints (`POST /claim`, `POST /pair`, admin session login).

**Catch-up:** every client persists a cursor (last seen DO sequence number). On connect, `hello {cursor}` → DO replays all changes since; a client offline for days simply receives a longer batch. First-ever connect does a full manifest exchange plus bulk blob download.

## 6. Durable Object storage (SQLite)

```sql
files    (id, path UNIQUE, current_version, deleted, updated_at)
versions (id, file_id, hash, size, device_id, clock, parent_id, ts, kind)
           -- kind: edit | rename | delete | conflict_copy | restore
devices  (id, name, type, token_hash, created_at, last_seen, revoked)
events   (seq, ts, device_id, kind, path, detail)   -- dashboard/`vsa logs` feed
pairs    (code_hash, expires_at, used)              -- pairing codes
blobs    (hash, size, refcount, last_gc_at)          -- GC bookkeeping
snapshots (id, name, ts, device_id, seq, file_count, heads)
           -- whole-vault restore points; heads JSON captured at creation (schema v2)
meta     (key, value)                                -- claim state, admin hash,
                                                     -- settings, global seq
```

The DO is the only writer; SQLite transactions make commit+conflict-check atomic. DO storage holds *metadata only* (a 100k-file vault is a few MB); content lives in R2. `events` is pruned — rows older than 30 days and beyond the newest 10,000, by the weekly GC cron plus opportunistically on writes — while `versions` is kept forever by design (FR-7: history is the product).

## 7. R2 layout & garbage collection

```
blobs/{sha256}        one object per unique content version, gzipped
```

Every version of every file is kept (FR-7) — CAS makes old versions cost nothing extra when content is unchanged. A weekly **Cron Trigger** on the worker asks the DO to enumerate unreferenced hashes (refcount 0, older than a grace period — handles in-flight uploads) and deletes them from R2. R2 free tier (10 GB) is the practical ceiling for users; the dashboard surfaces bytes used.

## 8. Client engine flows (`core`, shared)

**Startup reconciliation** (plugin launch, daemon start, `vsa` one-shot):

1. Load persisted local index (`.vaultsyncforagents/state` inside the vault — synced-ignored).
2. Connect WS (`hello {cursor}`); receive manifest delta since cursor.
3. Scan local tree; **mtime+size pre-filter** — files whose recorded size+mtime match the index skip re-hashing; legacy/unknown-mtime entries hash once (sha256 via WebCrypto, parallel) and then go fast; a full re-hash remains available for `vsa doctor`. Diff against local index → local changes made while the client was offline (including external edits made with Obsidian closed).
4. Three-way resolve against the manifest: local-only change → commit; remote-only change → fetch blob (WS inline or `/blob/:hash`) → write; both changed → conflict path (§4).
5. Writes go through the platform adapter (Obsidian `vault.modify` / Node fs with atomic write + fsync) — open editors refresh automatically.

**Live operation:** platform watcher events (Obsidian vault events / chokidar) → debounce (~300 ms) → hash → commit. Remote `change` messages → fetch → write → (Obsidian reloaded open editors; daemon just wrote a file agents can read). Small notes ride the WS; attachments stream over `/blob/:hash`. Failed blob ops queue with retry (RVA's retry-queue pattern).

**Mobile:** same core; no watcher while backgrounded — reconciliation runs on every app-open + periodic rescan on focus. Sync-on-open is the stated contract (same as Obsidian Sync).

**Adapters** (why `core` is portable): `StorageAdapter` (read/write/list/delete/atomic), `WatchAdapter` (events), `LogAdapter`. Plugin = Obsidian API adapters; daemon/CLI = Node fs + chokidar; tests = in-memory + temp dirs. No Node APIs above the adapter seam — this is what keeps one engine running in Obsidian mobile, the VPS, and a CLI.

## 9. Daemon

One Node process, all configured vaults:

```jsonc
// ~/.config/vaultsyncforagents/daemon.json
{ "vaults": [ { "path": "/home/jitu/vaults/personal", "url": "https://personal.x.workers.dev" } ] }
// tokens stored alongside, 0600, outside the vault
```

- File watching via chokidar; `.trash/` on delete; atomic state writes (v1 patterns).
- Service management: `vsa daemon install` writes a systemd unit (Linux) or launchd plist (macOS); `vsa daemon start|stop|status|logs` wraps it.
- Docs recommend pairing the daemon with per-vault ignore tweaks; engine is cross-platform so a Windows service wrapper arrives later without engine changes.

## 10. Dashboard

Built as an SPA, shipped **inside the worker** (asset binding or inline) and served at `/` — no second deployment, no CORS, no central dependency on the author.

- **Unclaimed state:** claim page (set admin passphrase, name vault) → immediately shows pairing code + QR + `obsidian://` deep link.
- **Claimed state:** admin login → status: engine health (DO reachable, recent error rate), devices (online/offline, last-seen — offline = not seen in N minutes), last synced edit (time, device, file), attachment count, storage used, recent events feed, restore UI (browse history/trash).
- A **central aggregator** Pages app for multi-vault overview is a future addition — pure client-side, zero protocol impact.

## 11. CLI (`vsa`)

```
vsa setup                 # interactive: Cloudflare auth → deploy worker+R2+DO+cron → print claim URL
vsa link [path]           # pair this machine's vault (URL + pairing code); warns on double-client
vsa unlink [path]
vsa status                # per vault: connected?, last sync, pending, conflicts; counts across vaults
vsa devices               # list per worker        |  vsa devices revoke <name>
vsa history <file>        # version list           |  vsa restore <file> [--version|--from-device]
vsa snapshot create [name] | list | restore <idOrName> [--yes]   # vault-level snapshots; restore is server-side
vsa daemon install|start|stop|status|logs
vsa doctor                # reachability, token validity, claim state, clock skew, server version, R2 usage, hints
vsa logs                  # recent events from the worker's event log
```

`setup` uses wrangler/Cloudflare API under the hood (OAuth flow, provisions resources) — the power-user path; the Deploy Button is the mainstream path. Cross-platform from day one (owner's desktop is Windows).

## 12. Repository layout & CI

```
vaultsyncforagents/            # monorepo (pnpm workspaces + turbo)
├── packages/
│   ├── core/                  # shared sync engine + protocol client
│   ├── worker/                # DO + routes + embedded dashboard build
│   ├── plugin/                # Obsidian plugin
│   ├── daemon/                # headless client + service installers
│   ├── cli/                   # `vsa`
│   └── dashboard/             # SPA source (build output embedded into worker)
├── manifest.json, main.js, styles.css   # CI-copied plugin artifacts (Obsidian
│                                         # submission requires these at repo root)
└── REQUIREMENTS.md / ARCHITECTURE.md / README / docs/

vaultsyncforagents-template/   # separate repo: deploy-button worker template,
                               # pinned to released worker versions
```

CI: typecheck + unit (vitest; `core` gets in-memory adapter tests + two-client simulation) + worker integration via Miniflare + build plugin → copy artifacts to root → GitHub Release (manifest/main.js/styles.css) for the community directory; publish `cli`/`daemon` to npm.

## 13. Cloudflare free-tier budget (goal, not hard requirement)

| Resource | Free allowance (approx., verify at build) | Expected personal-vault usage |
|---|---|---|
| Workers requests | 100k/day | well under (WS messages + blob routes) |
| DO requests | 100k/day | ditto; WS hibernation keeps idle cost zero |
| DO SQLite storage | ~5 GB | megabytes (metadata only) |
| R2 storage | 10 GB | the real ceiling — history + attachments; surfaced on dashboard |
| R2 ops | 1M Class A / 10M Class B / month | fine at personal scale |
| Cron triggers | free | 1/week |

Every user self-hosts in their own account, so load is inherently distributed.

## 14. Security model (v1)

- Transport: HTTPS/WSS everywhere. Worker sees plaintext — it lives in the user's own Cloudflare account; threat model excludes the account owner and treats Cloudflare as the host (same trust class as Obsidian Sync's relay, minus the vendor).
- Device tokens: 256-bit random, stored hashed (SHA-256) in DO; revocation is server-side instant. Pairing codes: one-time, 10-min TTL, hashed, admin-issued only.
- Guessing surfaces (`POST /pair`, `POST /admin/login`): failures throttled per client IP — 10 failures / 15 min → `429` + `Retry-After`. Codes are 40-bit one-time with a 10-min TTL.
- Path case-safety: plain case-only renames are SAFE — the scan correlates them by hash into a single rename op, and `applyPull` orders any decomposed case-colliding delete+add pull pair delete-first, so a case-insensitive filesystem (Windows/macOS) never destroys the just-written file. The remaining known limitation: two files differing only by name case can still be CREATED from a case-sensitive client (the Linux daemon) — never do that in one vault. If a case-insensitive client then meets such a pair, its filesystem shows only one of the two files; the scan never pushes a deletion for the invisible twin (which would destroy it server-side and on case-sensitive peers) and instead surfaces it as a diagnostic: `SyncClientStatus.caseCollisions`, a `warn` log line per cycle, and the plugin support bundle. The collision itself is not arbitrated — rename one of the pair to resolve it.
- Admin: argon2 passphrase hash in DO; signed session cookies.
- Abuse surface is small: unclaimed workers answer `421` on everything except the claim page; claim is a single passphrase set (first-writer-wins, race-guarded by the DO transaction).
- **E2E later:** encrypt blob payloads + optional filename obfuscation client-side; CAS dedup survives (bucket-scoped keys); dashboard is metadata-only by design, so it is unaffected. No protocol reshape required — this is why content is blobs end-to-end.

## 15. Decision log (from the design interview)

| # | Decision | Chosen | Rejected alternative & why |
|---|---|---|---|
| 1 | Worker topology | One worker + R2 per vault | Per-user multi-vault worker — more internal scoping, weaker isolation |
| 2 | Authority | Durable Object (SQLite) single-writer | D1 + polling — no push, harder consistency |
| 3 | Conflict model | Whole-file LWW + conflict copies | CRDT/Yjs — YAOS's memory ceiling; agent bulk-writes are the failure shape |
| 4 | Encryption | TLS-only v1, E2E-ready | E2E in v1 — key ceremony not worth it; dashboard is metadata-only anyway |
| 5 | Stack | TS monorepo, shared `core` | Rust daemon — engine implemented twice, drift bugs |
| 6 | YAOS interop | Clean break, own protocol | Speaking YAOS protocol — chained to their ceiling and schema |
| 7 | Onboarding | Plugin button → Deploy Button template → claim page → QR/`obsidian://` deep link | Manual wrangler setup — hostile to non-technical users |
| 8 | Dashboard home | Served by each user's worker | Central Pages app in v1 — second deploy, CORS, central dependency |
| 9 | `.obsidian/` | Off by default, opt-in, volatile files excluded | Always-on — surprise conflicts across machines |
| 10 | Conflict policy | Conflict copies only (no agent-mode toggle in v1); policy server-side per vault | Agent mode — audience runs one agent; conflicts rare; YAGNI |
| 11 | Repo shape | Monorepo + separate deploy-template repo | Separate plugin/daemon repos — shared-core version drift; RVA's split was forced by third-party status, not chosen |
| 12 | Naming | VaultSyncforAgents (`vsa`, plugin id `vaultsyncforagents`) | VaultRelay — already an Obsidian plugin |
| 13 | Client coexistence | One client per machine per vault (v1), warn on double-link | Plugin+daemon same vault — double-commit races; lockfile handshake later |
| 14 | Snapshot model | Heads-JSON captured at creation + restore as new fast-path versions | Time-travel by seq — `versions.seq` is dead (written 0) and events are pruned, so seq-based historical state is unrecoverable |

## 16. Build order (suggestion)

1. `core` engine + protocol on in-memory adapters (two-client simulation tests)
2. `worker` (DO + blob routes + claim/pairing) + `cli` link/status against local Miniflare
3. `plugin` (pairing UI, live sync, startup reconciliation)
4. `daemon` (chokidar, multi-vault, systemd)
5. `dashboard` (claim + status) embedded in worker
6. Template repo + deploy button + `vsa setup`
7. Dogfood days → community plugin submission → npm publish
