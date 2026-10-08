# VPS app removal

On 2026-10-08, the owner requested removal of OpenWebUI and Pocket TTS, then
CouchDB. Their Docker containers and exact images were stopped and removed.
OpenWebUI and CouchDB were also removed from the active
`/root/docker-compose/docker-compose.yml`, so a normal Compose startup will
not recreate them. The remaining service definitions were compared before and
after each edit and stayed unchanged.

## Data and recovery

Persistent data was preserved:

- OpenWebUI: `/root/docker-compose/openwebui/data`.
- Pocket TTS: uploaded voice files, source files, `hf_cache` and
  `pocket_tts_cache` Docker volumes. Its separate host Python installation
  was not uninstalled by this Docker image removal.
- CouchDB: original files at `/root/docker-compose/couchdb/data`.

Private configuration and container metadata backups are under:

- `/root/docker-compose/backups/removed-openwebui-pockettts-20261008-062014`.
- `/root/docker-compose/backups/removed-couchdb-20261008-062310`.

These directories have mode 0700, and the backup files containing configuration
or credentials have mode 0600. They are not part of the synced vault.

CouchDB was stopped before archiving its database. The archive passed gzip and
tar checks and was copied to
`Z:\Backups\CouchDB-before-removal-20261008.tar.gz`, with a matching SHA-256:
`5ac7307440998d81cdb77ea4f5f6b315fea7301add31a6c573e7143beca89d9c`.
Its size is 184,807,822 bytes. The same archive remains in the CouchDB backup
directory on the VPS. Original database files were retained as well.

Before removal, CouchDB served `obsidian.tatva.dev` and contained a database
named `obsidian`, with 22,674 documents and about 260 MB of database files.
The proxy recorded 465 requests identified as Obsidian in the preceding day,
mostly 404 responses. This identifies an older Obsidian endpoint, but does not
identify a particular currently connected device or vault. New ZeroKelvin sync
uses its separate Cloudflare Worker and has no CouchDB dependency.

Existing proxy/DNS records for `chat.tatva.dev`, `pocket.tatva.dev`, and
`obsidian.tatva.dev` were not edited. Their removed backends are unavailable.

## Space and validation

Available disk space rose from about 2.4 GB to 16.1 GB in the measured snapshots,
a gain of approximately 13.7 GB after preserving the database archive.
Disk usage went from 98% to 84% in the filesystem report.

The six other running containers stayed running: Immich server, database and
Redis; Nginx Proxy Manager; code-server; and Bifrost. Development caches and
user workspaces were not removed in this operation.

Redacted local reports are `dist/sync-operations/app-removal.json` and
`dist/sync-operations/couchdb-removal.json`.

## Sync reconnection correction

The final monitor check exposed an unrelated daemon disconnection logged at
11:40:52 IST, before the app removals. The Node transport uses setter callbacks;
the core's close callback replaced the daemon supervisor's callback. As a
result, a closed connection could remain disconnected without retrying.

The daemon now composes both notifications through a transport wrapper, first
updating the core and then notifying supervision. The production WebSocket
regression failed before the fix and passes afterward, including an edit through
the live watcher after reconnect and shutdown without a spurious reconnect.
All 65 daemon tests and 140 CLI tests pass; daemon and CLI type checks pass.

The CLI was rebuilt and installed on the VPS. Its SHA-256 is
`16dbbfbf885b43b29342051c7766ec71937da2c1bcd5086b50c68ab50d1872e6`.
The preceding bundle is retained at
`/opt/vaultsync-zerokelvin/dist/cli-before-reconnect-fix-20261008.js`.
A controlled drop of only the daemon's TCP connection verified automatic
reconnection with the same daemon process, zero pending changes and zero
conflicts. The sync authority and device credentials were unchanged.
The rebuilt daemon also passed the real PC/VPS creation, edit, deletion,
empty-folder and service-restart catch-up checks. The final read-only monitor
is healthy, and all 392 PC/VPS content files match. The PC's content still
matches all 392 original files in its pre-setup backup.
