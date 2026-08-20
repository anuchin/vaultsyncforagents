# VaultSync for Agents

Self-hosted sync engine for Obsidian vaults: one Cloudflare Worker + R2 bucket per
vault, shared sync core in every client (Obsidian plugin, VPS daemon, CLI).

- What the project must do: [REQUIREMENTS.md](./REQUIREMENTS.md)
- How it works: [ARCHITECTURE.md](./ARCHITECTURE.md)

## Repo layout

npm-workspaces monorepo. Packages live under `packages/`:

| Package | Purpose |
|---|---|
| `@vsa/core` | Shared sync engine foundation: paths, types, protocol, hashing, ignore rules, platform adapters |

(worker, plugin, daemon, cli, dashboard arrive in later phases.)

## Development

```sh
npm install       # install workspace deps
npm test          # run vitest across all workspaces
npm run typecheck # tsc --noEmit in every workspace
```

`@vsa/core` is platform-portable by contract: Web APIs only, no Node-specific
imports — it must run unchanged in Obsidian mobile and Cloudflare Workers.
Platform capabilities (fs, watchers, logging) reach the engine only through the
adapters in `core/src/adapters.ts`.
