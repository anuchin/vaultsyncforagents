/**
 * Diagnostics (the settings tab's "Advanced → Diagnostics"): a bounded ring
 * buffer over the plugin's log stream with a user-selectable minimum level,
 * a transport wrapper that records protocol round-trips at debug level (low
 * volume: one short line per frame), and the "Copy diagnostics" bundle.
 *
 * The bundle is a plain-text snapshot meant for bug reports: versions,
 * identity, worker, a client status snapshot, the platform, and the last N
 * log lines. `buildSupportBundle` is its richer markdown sibling — the file
 * a "sync ate my note" report attaches.
 */

import { ProtocolVersion } from '@vsa/core';
import type { LogAdapter, SyncClientStatus, Transport } from '@vsa/core';
import { Platform } from 'obsidian';
import type { LogLevel, PluginSyncSettings } from './data.js';

/** Severity ranking; `error` always outranks every selectable level. */
const LEVEL_RANK: Record<LogLevel | 'error', number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Log lines kept for the diagnostics bundle (the spec's "last 20"). */
export const RING_CAPACITY = 20;

/** Max characters one argument contributes to a ring line. */
const ARG_MAX_CHARS = 300;

/** A `LogAdapter` with a level gate and a bounded ring buffer attached. */
export interface PluginLog extends LogAdapter {
  /** Change the minimum recorded level at runtime (the settings dropdown). */
  setLevel(level: LogLevel): void;
  getLevel(): LogLevel;
  /** Whether `debug` calls currently pass the gate (round-trip logging hook). */
  get debugEnabled(): boolean;
  /** The most recent lines, oldest first (bounded by the capacity). */
  recentLines(): string[];
}

export interface PluginLogOptions {
  /** Ring capacity (default 20). */
  capacity?: number;
  /** Minimum recorded level (default 'info'). */
  level?: LogLevel;
  /** Timestamp seam (default `Date.now`). */
  now?: () => number;
}

/** Build the plugin's log adapter: console mirror + bounded ring buffer. */
export function createPluginLog(options: PluginLogOptions = {}): PluginLog {
  const capacity = options.capacity ?? RING_CAPACITY;
  const now = options.now ?? (() => Date.now());
  let level: LogLevel = options.level ?? 'info';
  let ring: string[] = [];

  const write = (severity: LogLevel | 'error', args: readonly unknown[]): void => {
    if (LEVEL_RANK[severity] < LEVEL_RANK[level]) return;
    const line = `${new Date(now()).toISOString()} [${severity}] ${args.map(fmt).join(' ')}`;
    ring.push(line);
    if (ring.length > capacity) ring = ring.slice(ring.length - capacity);
    const sink =
      severity === 'error' ? console.error : severity === 'warn' ? console.warn : console.log;
    sink('[vsa]', ...args);
  };

  return {
    debug: (...args: unknown[]) => write('debug', args),
    info: (...args: unknown[]) => write('info', args),
    warn: (...args: unknown[]) => write('warn', args),
    error: (...args: unknown[]) => write('error', args),
    setLevel(next: LogLevel): void {
      level = next;
    },
    getLevel(): LogLevel {
      return level;
    },
    get debugEnabled(): boolean {
      return level === 'debug';
    },
    recentLines(): string[] {
      return [...ring];
    },
  };
}

/** One log argument → compact text (strings pass through, long values truncated). */
function fmt(value: unknown): string {
  if (typeof value === 'string') return truncate(value);
  if (value instanceof Error) return truncate(`${value.name}: ${value.message}`);
  try {
    return truncate(JSON.stringify(value) ?? String(value));
  } catch {
    return String(value);
  }
}

function truncate(text: string): string {
  return text.length <= ARG_MAX_CHARS ? text : `${text.slice(0, ARG_MAX_CHARS - 1)}…`;
}

// --- protocol round-trip logging ---------------------------------------------------

/** Compact, low-volume description of a wire frame (type + identity keys). */
export function describeMessage(message: {
  type: string;
  path?: string;
  hash?: string;
  fromPath?: string;
  cursor?: number;
  seq?: number;
}): string {
  const bits = [message.type];
  if (message.fromPath !== undefined) bits.push(`${message.fromPath} →`);
  if (message.path !== undefined) bits.push(message.path);
  if (message.hash !== undefined) bits.push(message.hash.slice(0, 12));
  if (message.seq !== undefined) bits.push(`seq ${message.seq}`);
  if (message.cursor !== undefined) bits.push(`cursor ${message.cursor}`);
  return bits.join(' ');
}

export interface RoundTripLoggingOptions {
  log: LogAdapter;
  /** Cheap pre-check so the string building is skipped unless debug is on. */
  shouldLog: () => boolean;
}

/**
 * Wrap a `Transport` so every sent/received frame is logged at debug level —
 * one short line per frame (`describeMessage`), nothing at other levels.
 */
export function withRoundTripLogging(
  transport: Transport,
  options: RoundTripLoggingOptions,
): Transport {
  const { log, shouldLog } = options;
  return {
    send: (message) => {
      if (shouldLog()) log.debug('→', describeMessage(message));
      transport.send(message);
    },
    onMessage: (callback) => {
      transport.onMessage((message) => {
        if (shouldLog()) log.debug('←', describeMessage(message));
        callback(message);
      });
    },
    onClose: (callback) => transport.onClose(callback),
    close: () => transport.close(),
  };
}

// --- the bundle --------------------------------------------------------------------

export interface DiagnosticsInput {
  pluginVersion: string;
  deviceId: string;
  deviceName: string;
  workerUrl: string;
  paired: boolean;
  paused: boolean;
  clientStatus: SyncClientStatus | null;
  recentLogLines: readonly string[];
  /** Worker-reported version (null until a later change populates it). */
  serverVersion?: string | null;
  /** Client-side settings (none are secret — all fields render verbatim). */
  settings?: PluginSyncSettings;
  /**
   * Conflict paths for the support bundle, derived from
   * `clientStatus.conflicts` — PATHS ONLY, never file content.
   */
  recentConflicts?: Array<{ path: string }>;
}

/** The protocol version from core, surfaced for the bundle/About section. */
export const PROTOCOL_VERSION = ProtocolVersion;

/** The copyable diagnostics bundle (plain text, bug-report friendly). */
export function buildDiagnosticsBundle(input: DiagnosticsInput): string {
  const status = input.clientStatus;
  const lines: string[] = [
    'VaultSync for Agents — diagnostics',
    `Plugin version: ${input.pluginVersion}`,
    `Protocol version: ${ProtocolVersion}`,
    `Device: ${input.deviceId || '(unassigned)'}${input.deviceName ? ` (${input.deviceName})` : ''}`,
    `Worker: ${input.workerUrl || '(not configured)'}`,
    `Pairing: ${input.paired ? 'paired' : 'not paired'}`,
    input.paused
      ? 'Sync: paused'
      : status === null
        ? 'Sync: not running'
        : `Sync: ${status.state}, last sync ${
            status.lastSyncAt === null ? 'never' : `${Math.max(0, Date.now() - status.lastSyncAt)}ms ago`
          }, pending ${status.pending}, conflicts ${status.conflicts.length}`,
    `Platform: ${platformSummary()}`,
    `Recent log (last ${input.recentLogLines.length} lines):`,
  ];
  if (input.recentLogLines.length === 0) {
    lines.push('  (no recorded log lines)');
  } else {
    for (const line of input.recentLogLines) lines.push(`  ${line}`);
  }
  return lines.join('\n');
}

/** Epoch ms → `20260821-143005` (local time) for support-bundle file names. */
export function formatSupportBundleStamp(now: number): string {
  const d = new Date(now);
  const two = (n: number): string => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}` +
    `-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`
  );
}

const onOff = (value: boolean): string => (value ? 'on' : 'off');

/**
 * The "Save support bundle" markdown. Redaction contract: the device token
 * never appears (the input structurally cannot carry it), and files
 * contribute vault-relative PATHS ONLY — never content.
 */
export function buildSupportBundle(input: DiagnosticsInput, now: number): string {
  const status = input.clientStatus;
  // Conflicts render as paths only; `recentConflicts` (pre-redacted by the
  // caller) wins when present, else paths are derived from the status.
  const conflictPaths =
    input.recentConflicts?.map((c) => c.path) ?? status?.conflicts.map((c) => c.path) ?? [];

  const lines: string[] = [
    '# VaultSync for Agents — support bundle',
    '',
    `Generated: ${new Date(now).toISOString()}`,
    '',
    '## Versions',
    '',
    `- Plugin: ${input.pluginVersion}`,
    `- Protocol: ${ProtocolVersion}`,
    `- Server: ${input.serverVersion ?? 'unknown'}`,
    `- Platform: ${platformSummary()}`,
    '',
    '## Connection',
    '',
    `- Worker URL: ${input.workerUrl || '(not configured)'}`,
    `- Device ID: ${input.deviceId || '(unassigned)'}`,
    `- Device name: ${input.deviceName || '(default)'}`,
    `- Pairing: ${input.paired ? 'paired' : 'not paired'}`,
    `- Syncing: ${input.paused ? 'paused' : 'active'}`,
  ];

  if (input.settings !== undefined) {
    const { settings } = input;
    const patterns = settings.ignorePatterns
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line !== '');
    lines.push('', '## Settings', '', `- Rescan interval: ${settings.rescanIntervalSec === 0 ? 'off' : `${settings.rescanIntervalSec} seconds`}`, `- Sync .obsidian/ folder: ${onOff(settings.obsidianSync)}`, `- Status bar indicator: ${settings.statusBarMode}`, `- Sync on startup: ${onOff(settings.syncOnStartup)}`, `- Diagnostics log level: ${settings.logLevel}`);
    if (patterns.length === 0) {
      lines.push('- Ignore patterns: (none)');
    } else {
      lines.push('- Ignore patterns:');
      for (const pattern of patterns) lines.push(`  ${pattern}`);
    }
  }

  lines.push('', '## Sync state', '');
  if (input.paused) lines.push('- State: paused');
  else if (status === null) lines.push('- State: not running');
  else lines.push(`- State: ${status.state}`);
  if (status !== null) {
    lines.push(
      `- Last sync: ${status.lastSyncAt === null ? 'never' : new Date(status.lastSyncAt).toISOString()}`,
      `- Pending changes: ${status.pending}`,
      `- Conflicts: ${conflictPaths.length}`,
    );
    for (const path of conflictPaths) lines.push(`  - ${path}`);
    if (status.progress !== undefined) {
      lines.push(`- Progress: ${status.progress.phase} ${status.progress.done}/${status.progress.total}`);
    }
  }

  lines.push('', `## Recent log (last ${input.recentLogLines.length} lines)`, '');
  if (input.recentLogLines.length === 0) {
    lines.push('(no recorded log lines)');
  } else {
    lines.push('```text');
    lines.push(...input.recentLogLines);
    lines.push('```');
  }
  return `${lines.join('\n')}\n`;
}

/** Human platform summary from `Platform` (mobile vs desktop, OS, form factor). */
export function platformSummary(): string {
  if (Platform.isMobileApp) {
    const os = Platform.isIosApp ? 'iOS' : Platform.isAndroidApp ? 'Android' : 'unknown OS';
    const factor = Platform.isTablet ? 'tablet' : Platform.isPhone ? 'phone' : 'device';
    return `Obsidian mobile app (${os}, ${factor})`;
  }
  return 'Obsidian desktop app';
}

/** Best-effort clipboard write; resolves false where the clipboard is unavailable. */
export async function copyToClipboard(text: string): Promise<boolean> {
  const clipboard = (globalThis as { navigator?: { clipboard?: { writeText?(t: string): Promise<void> } } })
    .navigator?.clipboard;
  if (clipboard?.writeText === undefined) return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

/** Bytes → human text (`730 B`, `1.2 MB`). */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit += 1;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}
