/**
 * Server compatibility policy — the version-skew companion to the wire
 * protocol check.
 *
 * Self-hosters deploy the worker from a Cloudflare template pinned to a
 * release while the plugin/CLI/daemon update on their own schedules, so
 * version skew across components is guaranteed. The WS handshake already
 * enforces an EXACT `ProtocolVersion` match (hard gate, protocol.ts); this
 * module answers the softer question "is this reported server release
 * reasonably matched to this client?" with a pure, dependency-free verdict
 * every UI can share (the plugin's status note/Notice, `vsa doctor`).
 *
 * Deliberately tolerant: only a server OLDER than the supported floor is an
 * error; newer servers and unparseable/absent versions are warnings, never
 * sync-killers.
 */

/**
 * Oldest server release the clients can be expected to work against. Servers
 * below this are reported as errors ("update the worker").
 */
export const MIN_SUPPORTED_SERVER_VERSION = '0.1.0';

/** Outcome of `checkServerCompatibility`. */
export interface CompatibilityVerdict {
  /**
   * `ok` — nothing to do; `warn` — works, consider updating a component;
   * `error` — the server is below the supported floor. Never a sync-killer:
   * the wire `ProtocolVersion` check remains the hard gate.
   */
  level: 'ok' | 'warn' | 'error';
  /** User-facing sentence (empty-ish for the `ok` case). */
  message: string;
}

/** The parts of a semver string the policy compares (prerelease/build ignored). */
interface SemVer {
  major: number;
  minor: number;
  patch: number;
}

/**
 * `major.minor.patch`, tolerating a leading `v`, a `-prerelease`, and a
 * `+build` suffix. Anything else (including `0.1`-style two-part versions)
 * parses as `null` — the policy then warns with the raw value instead of
 * guessing.
 */
export function parseSemVer(raw: string): SemVer | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    raw.trim(),
  );
  if (match === null) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}

/** Three-way compare on major → minor → patch (prerelease/build ignored). */
function compareSemVer(a: SemVer, b: SemVer): number {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return 0;
}

/**
 * Assess a server's reported release against this client's version.
 *
 *  - `serverVersion` null/undefined/empty → the server predates version
 *    reporting (≤ 0.1 never sends the field): warn with an upgrade hint.
 *  - Unparseable serverVersion → warn, quoting the raw value.
 *  - Server a MAJOR or MINOR ahead of the client → warn (patch gaps are
 *    fine); the protocol check already guards actual incompatibility.
 *  - Server below `MIN_SUPPORTED_SERVER_VERSION` → error.
 *  - Otherwise → ok.
 */
export function checkServerCompatibility(
  clientVersion: string,
  serverVersion: string | null | undefined,
): CompatibilityVerdict {
  if (serverVersion === null || serverVersion === undefined || serverVersion === '') {
    return {
      level: 'warn',
      message: 'sync server predates version reporting (\u2264 0.1) \u2014 consider updating it (docs/UPGRADING.md)',
    };
  }
  const server = parseSemVer(serverVersion);
  if (server === null) {
    return {
      level: 'warn',
      message: `server version ${JSON.stringify(serverVersion)} is not semver \u2014 compatibility unknown`,
    };
  }
  // A client version we cannot parse (dev builds, "unknown") simply skips the
  // newer-server comparison rather than failing the whole assessment.
  const client = parseSemVer(clientVersion);
  if (client !== null && (server.major > client.major || server.minor > client.minor)) {
    return {
      level: 'warn',
      message: `server ${serverVersion} is newer than this client (${clientVersion}) \u2014 update the client when convenient`,
    };
  }
  const minimum = parseSemVer(MIN_SUPPORTED_SERVER_VERSION);
  if (minimum !== null && compareSemVer(server, minimum) < 0) {
    return {
      level: 'error',
      message: `server ${serverVersion} is older than the minimum supported (${MIN_SUPPORTED_SERVER_VERSION}) \u2014 update it: docs/UPGRADING.md`,
    };
  }
  return { level: 'ok', message: `server ${serverVersion} works with this client (${clientVersion})` };
}
