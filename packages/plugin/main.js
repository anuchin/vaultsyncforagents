/* VaultSync for Agents — self-hosted Obsidian vault sync. See manifest.json. */
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __defNormalProp = (obj, key, value) => key in obj ? __defProp(obj, key, { enumerable: true, configurable: true, writable: true, value }) : obj[key] = value;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);
var __publicField = (obj, key, value) => __defNormalProp(obj, typeof key !== "symbol" ? key + "" : key, value);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => VaultSyncPlugin
});
module.exports = __toCommonJS(main_exports);

// src/plugin.ts
var import_obsidian5 = require("obsidian");

// ../core/src/paths.ts
var InvalidVaultPathError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "InvalidVaultPathError";
  }
};
function normalizeVaultPath(input) {
  if (typeof input !== "string") {
    throw new InvalidVaultPathError(`Vault path must be a string, got ${typeof input}`);
  }
  if (input.includes("\0")) {
    throw new InvalidVaultPathError(`Vault path contains NUL byte: ${JSON.stringify(input)}`);
  }
  if (/^[a-zA-Z]:/.test(input)) {
    throw new InvalidVaultPathError(
      `Vault path must not be an absolute host path (drive letter): ${JSON.stringify(input)}`
    );
  }
  if (input.startsWith("\\\\")) {
    throw new InvalidVaultPathError(
      `Vault path must not be a UNC path: ${JSON.stringify(input)}`
    );
  }
  const converted = input.replace(/\\/g, "/");
  if (converted.startsWith("//")) {
    throw new InvalidVaultPathError(
      `Vault path must not start with "//" (UNC or protocol-style path): ${JSON.stringify(input)}`
    );
  }
  const segments = [];
  for (const segment of converted.split("/")) {
    if (segment === "" || segment === ".") continue;
    if (segment === "..") {
      if (segments.length === 0) {
        throw new InvalidVaultPathError(
          `Vault path escapes the vault root: ${JSON.stringify(input)}`
        );
      }
      segments.pop();
      continue;
    }
    if (isWindowsUnsafeSegment(segment)) {
      throw new InvalidVaultPathError(
        `Vault path segment is a Windows-reserved device name or ends with a dot/space: ${JSON.stringify(segment)}`
      );
    }
    segments.push(segment);
  }
  return segments.length === 0 ? "/" : `/${segments.join("/")}`;
}
function parentPath(path) {
  const normalized = normalizeVaultPath(path);
  if (normalized === "/") return "/";
  const lastSlash = normalized.lastIndexOf("/");
  return lastSlash === 0 ? "/" : normalized.slice(0, lastSlash);
}
function basename(path) {
  const normalized = normalizeVaultPath(path);
  if (normalized === "/") return "";
  return normalized.slice(normalized.lastIndexOf("/") + 1);
}
function isStrictlyBeneath(child, ancestor) {
  if (ancestor === "/") return child !== "/";
  return child.length > ancestor.length && child.startsWith(`${ancestor}/`);
}
var WINDOWS_RESERVED_BASE_NAMES = /* @__PURE__ */ new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9"
]);
function isWindowsUnsafeSegment(segment) {
  if (segment === "." || segment === "..") return false;
  if (segment.endsWith(".") || segment.endsWith(" ")) return true;
  const dot = segment.indexOf(".");
  const base = (dot === -1 ? segment : segment.slice(0, dot)).toLowerCase();
  return WINDOWS_RESERVED_BASE_NAMES.has(base);
}
function isWindowsUnsafePath(path) {
  return path.split("/").some((segment) => isWindowsUnsafeSegment(segment));
}

// ../core/src/clock.ts
function compareClocks(a, b) {
  if (a.counter !== b.counter) return a.counter > b.counter ? 1 : -1;
  if (a.deviceId !== b.deviceId) return a.deviceId > b.deviceId ? 1 : -1;
  return 0;
}
function nextClock(parent, deviceId) {
  var _a;
  return { counter: ((_a = parent == null ? void 0 : parent.counter) != null ? _a : 0) + 1, deviceId };
}

// ../core/src/hashing.ts
async function sha256Hex(bytes) {
  const data = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  const digest = await crypto.subtle.digest("SHA-256", data);
  return toHex(new Uint8Array(digest));
}
function toHex(bytes) {
  let out = "";
  for (const byte of bytes) {
    out += byte.toString(16).padStart(2, "0");
  }
  return out;
}

// ../core/src/errors.ts
var VaultSyncError = class extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = new.target.name;
  }
};
var UnauthorizedError = class extends VaultSyncError {
  constructor() {
    super(...arguments);
    __publicField(this, "code", "UNAUTHORIZED");
  }
};
var RevokedError = class extends VaultSyncError {
  constructor() {
    super(...arguments);
    __publicField(this, "code", "REVOKED");
  }
};
var ProtocolError = class extends VaultSyncError {
  constructor() {
    super(...arguments);
    __publicField(this, "code", "PROTOCOL");
  }
};
var NetworkError = class extends VaultSyncError {
  constructor() {
    super(...arguments);
    __publicField(this, "code", "NETWORK");
  }
};

// ../core/src/localindex.ts
var LOCAL_INDEX_SCHEMA_VERSION = 2;
var MIN_LOCAL_INDEX_SCHEMA_VERSION = 1;
var LOCAL_INDEX_STATE_PATH = "/.vaultsyncforagents/state";
function applyCommit(index, commit) {
  if (commit.deleted && commit.deletedAt === void 0) {
    throw new Error(
      `applyCommit: tombstone for ${JSON.stringify(commit.path)} requires deletedAt`
    );
  }
  const next = { ...index };
  const entry = {
    hash: commit.hash,
    size: commit.size,
    versionId: commit.versionId,
    clock: commit.clock
  };
  if (commit.deleted) entry.deletedAt = commit.deletedAt;
  if (commit.isFolder) entry.isFolder = true;
  if (commit.mtime !== void 0) entry.mtime = commit.mtime;
  next[commit.path] = entry;
  return next;
}
function removeEntry(index, path) {
  if (!(path in index)) return index;
  const next = { ...index };
  delete next[path];
  return next;
}
function serializeLocalIndex(index, state = {}) {
  const entries = {};
  for (const path of Object.keys(index).sort()) {
    entries[path] = index[path];
  }
  const envelope = {
    schemaVersion: LOCAL_INDEX_SCHEMA_VERSION,
    entries,
    ...state.cursor !== void 0 ? { cursor: state.cursor } : {},
    ...state.syncedThrough !== void 0 ? { syncedThrough: state.syncedThrough } : {},
    ...state.needsFullManifest !== void 0 ? { needsFullManifest: state.needsFullManifest } : {}
  };
  return JSON.stringify(envelope);
}
function deserializeLocalState(json) {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (cause) {
    throw new ProtocolError("Local index state is not valid JSON", { cause });
  }
  if (!isPlainObject(parsed)) {
    throw new ProtocolError("Local index state is not an object");
  }
  const index = deserializeLocalIndex(json);
  const rawCursor = parsed.cursor;
  const rawSyncedThrough = parsed.syncedThrough;
  const rawNeedsFull = parsed.needsFullManifest;
  if (rawCursor !== void 0 && (typeof rawCursor !== "number" || !Number.isInteger(rawCursor) || rawCursor < 0)) {
    throw new ProtocolError("Local index state: cursor must be a non-negative integer");
  }
  if (rawSyncedThrough !== void 0 && rawSyncedThrough !== null && (typeof rawSyncedThrough !== "number" || !Number.isInteger(rawSyncedThrough) || rawSyncedThrough < 0)) {
    throw new ProtocolError("Local index state: syncedThrough must be a non-negative integer or null");
  }
  if (rawNeedsFull !== void 0 && typeof rawNeedsFull !== "boolean") {
    throw new ProtocolError("Local index state: needsFullManifest must be a boolean when present");
  }
  return {
    index,
    state: {
      cursor: typeof rawCursor === "number" ? rawCursor : 0,
      syncedThrough: typeof rawSyncedThrough === "number" ? rawSyncedThrough : null,
      needsFullManifest: rawNeedsFull === true
    }
  };
}
function deserializeLocalIndex(json) {
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch (cause) {
    throw new ProtocolError("Local index state is not valid JSON", { cause });
  }
  if (!isPlainObject(parsed)) {
    throw new ProtocolError("Local index state is not an object");
  }
  const version = parsed.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version)) {
    throw new ProtocolError("Local index state is missing integer schemaVersion");
  }
  if (version < MIN_LOCAL_INDEX_SCHEMA_VERSION || version > LOCAL_INDEX_SCHEMA_VERSION) {
    throw new ProtocolError(
      `Local index schema version ${version} is not supported by this build (expected ${MIN_LOCAL_INDEX_SCHEMA_VERSION}..${LOCAL_INDEX_SCHEMA_VERSION}); a migration is required`
    );
  }
  const rawEntries = parsed.entries;
  if (!isPlainObject(rawEntries)) {
    throw new ProtocolError("Local index state is missing the entries object");
  }
  const entries = {};
  for (const [path, raw] of Object.entries(rawEntries)) {
    entries[path] = parseEntry(path, raw);
  }
  return entries;
}
function parseEntry(path, raw) {
  const where = `Local index entry ${JSON.stringify(path)}`;
  if (!isPlainObject(raw)) throw new ProtocolError(`${where} is not an object`);
  const { hash, size, versionId, clock, deletedAt, isFolder, mtime } = raw;
  if (typeof hash !== "string") throw new ProtocolError(`${where}: hash must be a string`);
  if (typeof versionId !== "string") {
    throw new ProtocolError(`${where}: versionId must be a string`);
  }
  if (typeof size !== "number" || !Number.isInteger(size) || size < 0) {
    throw new ProtocolError(`${where}: size must be a non-negative integer`);
  }
  if (!isPlainObject(clock) || typeof clock.counter !== "number" || typeof clock.deviceId !== "string") {
    throw new ProtocolError(`${where}: clock must be { counter: number, deviceId: string }`);
  }
  if (deletedAt !== void 0 && typeof deletedAt !== "number") {
    throw new ProtocolError(`${where}: deletedAt must be a number when present`);
  }
  if (isFolder !== void 0 && typeof isFolder !== "boolean") {
    throw new ProtocolError(`${where}: isFolder must be a boolean when present`);
  }
  if (mtime !== void 0 && (typeof mtime !== "number" || !Number.isFinite(mtime))) {
    throw new ProtocolError(`${where}: mtime must be a finite number when present`);
  }
  const entry = {
    hash,
    size,
    versionId,
    clock: { counter: clock.counter, deviceId: clock.deviceId }
  };
  if (deletedAt !== void 0) entry.deletedAt = deletedAt;
  if (isFolder !== void 0) entry.isFolder = isFolder;
  if (mtime !== void 0) entry.mtime = mtime;
  return entry;
}
function isPlainObject(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ../core/src/engine.ts
async function applyPull(storage, index, plan, fetchBlob, options = {}) {
  var _a;
  const now = (_a = options.now) != null ? _a : Date.now();
  const onProgress = options.onProgress;
  let working = index;
  onProgress == null ? void 0 : onProgress(0, plan.pulls.length);
  let done = 0;
  try {
    for (const pull of plan.pulls) {
      working = await applyOnePull(storage, working, pull, fetchBlob, now);
      done += 1;
      onProgress == null ? void 0 : onProgress(done, plan.pulls.length);
    }
  } catch (error) {
    try {
      await persistIndex(storage, working, options.persistedState);
    } catch (e) {
    }
    throw error;
  }
  await persistIndex(storage, working, options.persistedState);
  return working;
}
async function applyOnePull(storage, index, pull, fetchBlob, now) {
  if (pull.kind === "rename") {
    if (pull.isFolder === true) {
      await storage.ensureDir(pull.toPath);
      const moved2 = applyCommit(removeEntry(index, pull.fromPath), {
        path: pull.toPath,
        versionId: pull.version,
        hash: pull.hash,
        size: pull.size,
        clock: pull.clock,
        isFolder: true
      });
      await removeDirIfVacant(storage, moved2, pull.fromPath);
      return moved2;
    }
    if (await storage.exists(pull.fromPath)) {
      await storage.renameFile(pull.fromPath, pull.toPath);
    } else {
      await fetchVerified(storage, pull.toPath, pull.hash, fetchBlob);
    }
    const moved = applyCommit(removeEntry(index, pull.fromPath), {
      path: pull.toPath,
      versionId: pull.version,
      hash: pull.hash,
      size: pull.size,
      clock: pull.clock
    });
    await pruneParentOnDelete(storage, moved, pull.fromPath);
    return moved;
  }
  if (pull.isFolder) {
    if (pull.deleted) {
      await removeDirIfVacant(storage, index, pull.path);
    } else {
      await storage.ensureDir(pull.path);
    }
    return applyCommit(index, {
      path: pull.path,
      versionId: pull.version,
      hash: pull.hash,
      size: pull.size,
      clock: pull.clock,
      deleted: pull.deleted,
      deletedAt: pull.deleted ? now : void 0,
      isFolder: true
    });
  }
  if (pull.deleted) {
    await storage.deleteFile(pull.path);
    const tombstoned = applyCommit(index, {
      path: pull.path,
      versionId: pull.version,
      hash: pull.hash,
      size: pull.size,
      clock: pull.clock,
      deleted: true,
      deletedAt: now
    });
    await pruneParentOnDelete(storage, tombstoned, pull.path);
    return tombstoned;
  }
  const current = index[pull.path];
  if (current !== void 0 && current.deletedAt === void 0 && current.hash === pull.hash && await storage.exists(pull.path)) {
    return applyCommit(index, {
      path: pull.path,
      versionId: pull.version,
      hash: pull.hash,
      size: pull.size,
      clock: pull.clock
    });
  }
  await fetchVerified(storage, pull.path, pull.hash, fetchBlob);
  return applyCommit(index, {
    path: pull.path,
    versionId: pull.version,
    hash: pull.hash,
    size: pull.size,
    clock: pull.clock
  });
}
async function dirIsVacant(storage, index, dir) {
  if (dir === "/") return false;
  if (!await storage.exists(dir)) return false;
  for (const file of await storage.listFiles()) {
    if (isStrictlyBeneath(file.path, dir)) return false;
  }
  for (const child of await storage.listDirs()) {
    if (isStrictlyBeneath(child, dir)) return false;
  }
  for (const [path, entry] of Object.entries(index)) {
    if (entry.isFolder || entry.deletedAt !== void 0) continue;
    if (isStrictlyBeneath(path, dir)) return false;
  }
  return true;
}
async function removeDirIfVacant(storage, index, dir) {
  if (!await dirIsVacant(storage, index, dir)) return false;
  return removeVacantDir(storage, dir);
}
async function removeVacantDir(storage, dir) {
  if (storage.removeDir === void 0) return false;
  try {
    await storage.removeDir(dir);
    return true;
  } catch (e) {
    return false;
  }
}
async function pruneParentOnDelete(storage, index, deletedPath) {
  const dir = parentPath(deletedPath);
  if (!await dirIsVacant(storage, index, dir)) return void 0;
  return { dir, removed: await removeVacantDir(storage, dir) };
}
async function fetchVerified(storage, path, hash, fetchBlob) {
  const bytes = await fetchBlob(hash);
  const actual = await sha256Hex(bytes);
  if (actual !== hash) {
    throw new Error(
      `Blob hash mismatch for ${JSON.stringify(path)}: expected ${hash}, got ${actual}`
    );
  }
  await storage.writeFile(path, bytes);
}
async function persistIndex(storage, index, state = {}) {
  await storage.writeFile(
    LOCAL_INDEX_STATE_PATH,
    new TextEncoder().encode(serializeLocalIndex(index, state))
  );
}
async function loadLocalState(storage) {
  const bytes = await storage.readFile(LOCAL_INDEX_STATE_PATH);
  return deserializeLocalState(new TextDecoder().decode(bytes));
}

// ../core/src/ignore.ts
var ALWAYS_IGNORED_SEGMENTS = /* @__PURE__ */ new Set([
  ".trash",
  // local delete-recovery dir (FR-42)
  ".ds_store",
  ".vaultsyncforagents",
  // client state dir (local index) inside the vault
  "thumbs.db"
]);
var OBSIDIAN_VOLATILE_FILES = /* @__PURE__ */ new Set([
  ".obsidian/workspace.json",
  ".obsidian/workspace-mobile.json"
]);
function isIgnored(vaultPath, settings) {
  if (isWindowsUnsafePath(vaultPath)) return true;
  const normalized = normalizeVaultPath(vaultPath);
  if (normalized === "/") return false;
  const lower = normalized.slice(1).toLowerCase();
  const segments = lower.split("/");
  if (segments.some((segment) => ALWAYS_IGNORED_SEGMENTS.has(segment))) {
    return true;
  }
  if (segments[0] === ".obsidian") {
    if (!settings.obsidianSync) return true;
    if (OBSIDIAN_VOLATILE_FILES.has(lower)) return true;
    if (segments[1] === "cache") return true;
  }
  const extras = settings.extraIgnores;
  if (extras !== void 0 && extras.length > 0) {
    for (const pattern of extras) {
      const compiled = compileExtraIgnore(pattern);
      if (compiled !== null && matchesSegments(compiled, segments)) return true;
    }
  }
  return false;
}
function compileExtraIgnore(pattern) {
  let cleaned = pattern.trim().toLowerCase();
  while (cleaned.startsWith("/")) cleaned = cleaned.slice(1);
  while (cleaned.endsWith("/")) cleaned = cleaned.slice(0, -1);
  if (cleaned === "") return null;
  return { segments: cleaned.split("/"), anchored: cleaned.includes("/") };
}
function matchesSegments(pattern, path) {
  if (pattern.anchored) {
    return segmentsMatch(pattern.segments, path);
  }
  for (let start = 0; start < path.length; start++) {
    if (segmentsMatch(pattern.segments, path.slice(start))) return true;
  }
  return false;
}
function segmentsMatch(pattern, path) {
  if (pattern.length === 0) return path.length === 0;
  const head = pattern[0];
  const rest = pattern.slice(1);
  if (head === void 0) return path.length === 0;
  if (head === "**") {
    for (let skip = 0; skip <= path.length; skip++) {
      if (segmentsMatch(rest, path.slice(skip))) return true;
    }
    return false;
  }
  if (path.length === 0 || !segmentMatch(head, path[0])) return false;
  return segmentsMatch(rest, path.slice(1));
}
function segmentMatch(pattern, segment) {
  if (!pattern.includes("*")) return pattern === segment;
  const first = pattern.indexOf("*");
  const last = pattern.lastIndexOf("*");
  if (!segment.startsWith(pattern.slice(0, first))) return false;
  if (!segment.endsWith(pattern.slice(last + 1))) return false;
  let index = first;
  for (const middle of pattern.slice(first, last + 1).split("*").slice(1, -1)) {
    const found = segment.indexOf(middle, index);
    if (found === -1) return false;
    index = found + middle.length;
  }
  return true;
}

// ../core/src/protocol.ts
var ProtocolVersion = 1;
var INLINE_CONTENT_MAX_BYTES = 256 * 1024;
var CLIENT_TYPES = /* @__PURE__ */ new Set([
  "hello",
  "getManifest",
  "commit",
  "putBlob",
  "getBlob",
  "ping",
  "snapshotCreate",
  "snapshotRestore"
]);
var SERVER_TYPES = /* @__PURE__ */ new Set([
  "helloAck",
  "manifest",
  "commitAck",
  "conflict",
  "change",
  "deviceSeen",
  "blobAck",
  "blob",
  "error",
  "pong",
  "snapshotCreateAck",
  "snapshotRestoreAck"
]);
function isMessage(value) {
  return typeof value === "object" && value !== null && typeof value.type === "string" && (CLIENT_TYPES.has(value.type) || SERVER_TYPES.has(value.type));
}
function parseMessage(data) {
  let parsed;
  try {
    parsed = JSON.parse(data);
  } catch (cause) {
    throw new ProtocolError(`Message is not valid JSON: ${String(data).slice(0, 200)}`, { cause });
  }
  if (!isMessage(parsed)) {
    throw new ProtocolError(
      `Unknown or malformed message type: ${JSON.stringify(parsed == null ? void 0 : parsed.type)}`
    );
  }
  return parsed;
}
var VERSION_KINDS = /* @__PURE__ */ new Set([
  "edit",
  "rename",
  "delete",
  "conflictCopy",
  "restore"
]);
function isPlainObject2(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function expectNonEmptyString(value, where) {
  if (typeof value !== "string" || value === "") {
    throw new ProtocolError(`${where} must be a non-empty string`);
  }
}
function expectNonNegativeInteger(value, where) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
    throw new ProtocolError(`${where} must be a non-negative integer`);
  }
}
function expectClock(value, where) {
  if (!isPlainObject2(value) || typeof value.counter !== "number" || !Number.isInteger(value.counter) || value.counter <= 0 || typeof value.deviceId !== "string") {
    throw new ProtocolError(
      `${where} must be a clock { counter: positive integer, deviceId: string }`
    );
  }
}
function validateManifestEntry(entry) {
  if (!isPlainObject2(entry)) {
    throw new ProtocolError("Malformed server data: manifest entry is not an object");
  }
  const where = `manifest entry ${JSON.stringify(entry.path)}`;
  expectNonEmptyString(entry.path, `${where}: path`);
  expectNonEmptyString(entry.version, `${where}: version`);
  if (typeof entry.hash !== "string") {
    throw new ProtocolError(`${where}: hash must be a string`);
  }
  expectNonNegativeInteger(entry.size, `${where}: size`);
  if (typeof entry.deleted !== "boolean") {
    throw new ProtocolError(`${where}: deleted must be a boolean`);
  }
  expectClock(entry.clock, `${where}: clock`);
  if (entry.isFolder !== void 0 && typeof entry.isFolder !== "boolean") {
    throw new ProtocolError(`${where}: isFolder must be a boolean when present`);
  }
  if (entry.mtime !== void 0 && (typeof entry.mtime !== "number" || !Number.isFinite(entry.mtime))) {
    throw new ProtocolError(`${where}: mtime must be a finite number when present`);
  }
  return entry;
}
function validateManifestMessage(message) {
  expectNonNegativeInteger(message.cursor, "manifest cursor");
  for (const entry of Object.values(message.entries)) {
    validateManifestEntry(entry);
  }
}
function validateCommitAckMessage(message) {
  expectNonEmptyString(message.version, "commitAck.version");
  expectClock(message.clock, "commitAck.clock");
  expectNonNegativeInteger(message.seq, "commitAck.seq");
}
function validateChangeMessage(change) {
  const where = `change ${JSON.stringify(change.path)}`;
  expectNonEmptyString(change.path, `${where}: path`);
  expectNonEmptyString(change.version, `${where}: version`);
  if (typeof change.hash !== "string") {
    throw new ProtocolError(`${where}: hash must be a string`);
  }
  expectNonNegativeInteger(change.size, `${where}: size`);
  if (typeof change.deleted !== "boolean") {
    throw new ProtocolError(`${where}: deleted must be a boolean`);
  }
  if (typeof change.device !== "string") {
    throw new ProtocolError(`${where}: device must be a string`);
  }
  expectClock(change.clock, `${where}: clock`);
  if (!VERSION_KINDS.has(change.kind)) {
    throw new ProtocolError(`${where}: kind must be a VersionKind`);
  }
  if (change.fromPath !== void 0 && typeof change.fromPath !== "string") {
    throw new ProtocolError(`${where}: fromPath must be a string when present`);
  }
  if (change.isFolder !== void 0 && typeof change.isFolder !== "boolean") {
    throw new ProtocolError(`${where}: isFolder must be a boolean when present`);
  }
  expectNonNegativeInteger(change.seq, `${where}: seq`);
}
function validateConflictMessage(message) {
  const winner = message.winner;
  const where = `conflict winner ${JSON.stringify(winner.path)}`;
  expectNonEmptyString(winner.path, `${where}: path`);
  expectNonEmptyString(winner.id, `${where}: id`);
  if (typeof winner.hash !== "string") {
    throw new ProtocolError(`${where}: hash must be a string`);
  }
  expectNonNegativeInteger(winner.size, `${where}: size`);
  if (typeof winner.deviceId !== "string") {
    throw new ProtocolError(`${where}: deviceId must be a string`);
  }
  expectClock(winner.clock, `${where}: clock`);
  if (typeof winner.kind !== "string" || !VERSION_KINDS.has(winner.kind)) {
    throw new ProtocolError(`${where}: kind must be a VersionKind`);
  }
  if (winner.isFolder !== void 0 && typeof winner.isFolder !== "boolean") {
    throw new ProtocolError(`${where}: isFolder must be a boolean when present`);
  }
  if (message.seq !== void 0) {
    expectNonNegativeInteger(message.seq, "conflict.seq");
  }
}
function bytesToBase64(bytes) {
  let binary = "";
  const CHUNK = 32768;
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }
  return btoa(binary);
}
function base64ToBytes(encoded) {
  let binary;
  try {
    binary = atob(encoded);
  } catch (cause) {
    throw new ProtocolError("Base64 payload is not valid", { cause });
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// ../core/src/conflictnames.ts
var ILLEGAL_FILENAME_CHARS = /[<>:"/\\|?*]/g;
var CONTROL_CHARS = /[\x00-\x1f\x7f]/g;
var MAX_DEVICE_NAME_LENGTH = 30;
var FALLBACK_DEVICE_NAME = "unknown";
var MAX_COLLISION_SUFFIX = 999;
function sanitizeDeviceName(name) {
  let cleaned = name.replace(ILLEGAL_FILENAME_CHARS, "").replace(CONTROL_CHARS, "");
  cleaned = [...cleaned].slice(0, MAX_DEVICE_NAME_LENGTH).join("");
  cleaned = cleaned.trim().replace(/^[.\s]+|[.\s]+$/g, "");
  return cleaned.length === 0 ? FALLBACK_DEVICE_NAME : cleaned;
}
function conflictCopyPath(path, deviceName, now, exists = () => false) {
  const normalized = normalizeVaultPath(path);
  const dir = parentPath(normalized);
  const name = basename(normalized);
  const lastDot = name.lastIndexOf(".");
  const hasExtension = lastDot > 0;
  const stem = hasExtension ? name.slice(0, lastDot) : name;
  const extension = hasExtension ? name.slice(lastDot) : "";
  const suffix = ` (conflict ${formatConflictStamp(now)} - from ${sanitizeDeviceName(deviceName)})`;
  const join = (fileName) => dir === "/" ? `/${fileName}` : `${dir}/${fileName}`;
  let candidate = join(`${stem}${suffix}${extension}`);
  for (let n = 2; n <= MAX_COLLISION_SUFFIX; n++) {
    if (!exists(candidate)) return candidate;
    candidate = join(`${stem}${suffix} ${n}${extension}`);
  }
  throw new Error(
    `conflictCopyPath: more than ${MAX_COLLISION_SUFFIX} collisions for ${JSON.stringify(normalized)}`
  );
}
function formatConflictStamp(now) {
  const d = new Date(now);
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}-${pad(d.getUTCMinutes())}`;
}

// ../core/src/resolve.ts
var ZERO_CLOCK = { counter: 0, deviceId: "" };
function computeSyncPlan(input) {
  var _a, _b, _c, _d, _e, _f, _g, _h, _i, _j;
  const { localChanges, index, thisDeviceId, thisDeviceName, now } = input;
  const manifest = [...input.manifest].sort((a, b) => compareStrings(a.path, b.path));
  const manifestByPath = new Map(manifest.map((entry) => [entry.path, entry]));
  const pushes = [];
  const pulls = [];
  const conflicts = [];
  const localPaths = /* @__PURE__ */ new Set();
  for (const c of localChanges.added) localPaths.add(c.path);
  for (const c of localChanges.modified) localPaths.add(c.path);
  for (const d of localChanges.deleted) localPaths.add(d.path);
  for (const r of localChanges.renamed) {
    localPaths.add(r.from);
    localPaths.add(r.to);
  }
  for (const f of localChanges.folderDeletions) localPaths.add(f.path);
  const consumed = /* @__PURE__ */ new Set();
  const pathExists = (path) => path in index || manifestByPath.has(path);
  for (const rename of [...localChanges.renamed].sort((a, b) => compareStrings(a.from, b.from))) {
    const indexFrom = index[rename.from];
    const indexTo = index[rename.to];
    const remoteFrom = manifestByPath.get(rename.from);
    const remoteTo = manifestByPath.get(rename.to);
    const fromChanged = remoteFrom ? remoteEntryChanged(indexFrom, remoteFrom) : (indexFrom == null ? void 0 : indexFrom.deletedAt) === void 0;
    const toChanged = remoteTo ? remoteEntryChanged(indexTo, remoteTo) : false;
    if (!fromChanged && !toChanged) {
      pushes.push({
        kind: "rename",
        fromPath: rename.from,
        toPath: rename.to,
        parentVersion: (_a = indexFrom == null ? void 0 : indexFrom.versionId) != null ? _a : null,
        hash: rename.hash,
        size: rename.size
      });
      continue;
    }
    if (!fromChanged) {
      if (indexFrom && indexFrom.deletedAt === void 0) {
        pushes.push({
          kind: "delete",
          path: rename.from,
          parentVersion: indexFrom.versionId,
          hash: indexFrom.hash,
          size: indexFrom.size
        });
      }
    } else if (!remoteFrom || remoteFrom.deleted) {
      pulls.push(
        pullFile("delete", rename.from, {
          hash: (_c = (_b = remoteFrom == null ? void 0 : remoteFrom.hash) != null ? _b : indexFrom == null ? void 0 : indexFrom.hash) != null ? _c : rename.hash,
          size: (_e = (_d = remoteFrom == null ? void 0 : remoteFrom.size) != null ? _d : indexFrom == null ? void 0 : indexFrom.size) != null ? _e : rename.size,
          version: (_f = remoteFrom == null ? void 0 : remoteFrom.version) != null ? _f : "",
          clock: (_h = (_g = remoteFrom == null ? void 0 : remoteFrom.clock) != null ? _g : indexFrom == null ? void 0 : indexFrom.clock) != null ? _h : ZERO_CLOCK,
          deleted: true
        })
      );
    } else {
      const localClock = nextClock(indexFrom == null ? void 0 : indexFrom.clock, thisDeviceId);
      if (compareClocks(remoteFrom.clock, localClock) > 0) {
        pulls.push(pullFile("edit", rename.from, remoteFrom));
        conflicts.push({
          path: rename.from,
          reason: "rename-race",
          winner: "remote",
          // Local content is preserved by the rename itself (pushed at `to`).
          loserContent: "local",
          remote: remoteSummary(remoteFrom),
          localClock
        });
      } else {
        pushes.push({
          kind: "rename",
          fromPath: rename.from,
          toPath: rename.to,
          parentVersion: (_i = indexFrom == null ? void 0 : indexFrom.versionId) != null ? _i : null,
          hash: rename.hash,
          size: rename.size
        });
        conflicts.push({
          path: rename.from,
          reason: "rename-race",
          winner: "local",
          loserContent: "remote",
          remote: remoteSummary(remoteFrom),
          localClock
        });
        continue;
      }
    }
    if (!toChanged) {
      pushes.push({
        kind: (indexTo == null ? void 0 : indexTo.deletedAt) !== void 0 ? "restore" : "add",
        path: rename.to,
        parentVersion: (_j = indexTo == null ? void 0 : indexTo.versionId) != null ? _j : null,
        hash: rename.hash,
        size: rename.size
      });
    } else {
      resolveContestedPath(rename.to, indexTo, remoteTo, {
        path: rename.to,
        kind: (indexTo == null ? void 0 : indexTo.deletedAt) !== void 0 ? "restore" : "add",
        hash: rename.hash,
        size: rename.size
      });
    }
  }
  for (const from of Object.keys(index).filter((p) => {
    const entry = index[p];
    return entry.deletedAt === void 0 && !entry.isFolder;
  }).sort(compareStrings)) {
    if (localPaths.has(from) || consumed.has(from)) continue;
    if (manifestByPath.has(from)) continue;
    const entry = index[from];
    let best;
    let bestSameDir = false;
    for (const candidate of manifest) {
      if (candidate.deleted) continue;
      if (localPaths.has(candidate.path) || consumed.has(candidate.path)) continue;
      const known = index[candidate.path];
      if (known !== void 0 && known.deletedAt === void 0) continue;
      if (candidate.hash !== entry.hash) continue;
      const sameDir = parentPath(candidate.path) === parentPath(from);
      if (best === void 0) {
        best = candidate;
        bestSameDir = sameDir;
      } else if (sameDir && !bestSameDir) {
        best = candidate;
        bestSameDir = true;
      }
    }
    if (best) {
      pulls.push({
        kind: "rename",
        fromPath: from,
        toPath: best.path,
        hash: best.hash,
        size: best.size,
        version: best.version,
        clock: best.clock
      });
      consumed.add(from);
      consumed.add(best.path);
    } else {
      pulls.push(
        pullFile("delete", from, {
          hash: entry.hash,
          size: entry.size,
          version: "",
          clock: entry.clock,
          deleted: true
        })
      );
      consumed.add(from);
    }
  }
  for (const remote of manifest) {
    if (localPaths.has(remote.path) || consumed.has(remote.path)) continue;
    const entry = index[remote.path];
    if (!remoteEntryChanged(entry, remote)) continue;
    if (entry === void 0) {
      if (!remote.deleted) {
        pulls.push(pullFile("add", remote.path, remote));
        consumed.add(remote.path);
      }
      continue;
    }
    if (remote.deleted) {
      pulls.push(pullFile("delete", remote.path, remote));
    } else if (entry.deletedAt !== void 0) {
      pulls.push(pullFile("restore", remote.path, remote));
    } else {
      pulls.push(pullFile("edit", remote.path, remote));
    }
    consumed.add(remote.path);
  }
  const candidates = [
    ...localChanges.added.map((c) => ({ ...c, kind: "add" })),
    ...localChanges.modified.map((c) => {
      var _a2;
      return {
        ...c,
        kind: ((_a2 = index[c.path]) == null ? void 0 : _a2.deletedAt) !== void 0 ? "restore" : "edit"
      };
    }),
    ...localChanges.deleted.map((d) => ({ ...d, kind: "delete" })),
    // Folder placeholders whose directory vanished: tombstone pushes. They
    // carry no content (hash ''/size 0) and can never pair with an add, so
    // they join here rather than the `deleted` bucket (rename correlation,
    // conflict copies — neither applies to placeholders).
    ...localChanges.folderDeletions.map(
      (f) => ({
        path: f.path,
        kind: "delete",
        hash: "",
        size: 0,
        isFolder: true
      })
    )
  ].sort((a, b) => compareStrings(a.path, b.path));
  for (const candidate of candidates) {
    const entry = index[candidate.path];
    const remote = manifestByPath.get(candidate.path);
    const remoteChangedHere = remote !== void 0 && (entry !== void 0 ? remote.version !== entry.versionId : !remote.deleted);
    if (!remoteChangedHere) {
      pushLocal(candidate, entry);
    } else {
      resolveContestedPath(candidate.path, entry, remote, candidate);
    }
  }
  return {
    pushes: pushes.sort((a, b) => compareStrings(opPath(a), opPath(b))),
    pulls: pulls.sort(comparePullOps),
    conflicts: conflicts.sort((a, b) => compareStrings(a.path, b.path)),
    folderPushes: [...localChanges.emptyFolders].sort(compareStrings)
  };
  function pushLocal(candidate, entry) {
    var _a2, _b2, _c2, _d2;
    if (candidate.kind === "delete") {
      pushes.push({
        kind: "delete",
        path: candidate.path,
        parentVersion: (_a2 = entry == null ? void 0 : entry.versionId) != null ? _a2 : null,
        hash: (_b2 = entry == null ? void 0 : entry.hash) != null ? _b2 : candidate.hash,
        size: (_c2 = entry == null ? void 0 : entry.size) != null ? _c2 : candidate.size,
        ...candidate.isFolder ? { isFolder: true } : {}
      });
      return;
    }
    pushes.push({
      kind: candidate.kind,
      path: candidate.path,
      parentVersion: (_d2 = entry == null ? void 0 : entry.versionId) != null ? _d2 : null,
      hash: candidate.hash,
      size: candidate.size
    });
  }
  function resolveContestedPath(path, entry, remote, local) {
    var _a2, _b2, _c2, _d2, _e2;
    const localClock = nextClock(entry == null ? void 0 : entry.clock, thisDeviceId);
    const remoteWins = compareClocks(remote.clock, localClock) > 0;
    const summary = remoteSummary(remote);
    const reason = local.kind === "delete" || remote.deleted ? "delete-vs-edit" : entry === void 0 ? "add-vs-add" : "concurrent-edit";
    if (local.kind === "delete" && remote.deleted) {
      pulls.push(pullFile("delete", path, remote));
      return;
    }
    if (local.kind === "delete") {
      if (remoteWins) {
        pulls.push(pullFile("edit", path, remote));
        conflicts.push({
          path,
          reason,
          winner: "remote",
          loserContent: "none",
          remote: summary,
          localClock
        });
      } else {
        pushes.push({
          kind: "delete",
          path,
          parentVersion: (_a2 = entry == null ? void 0 : entry.versionId) != null ? _a2 : null,
          hash: (_b2 = entry == null ? void 0 : entry.hash) != null ? _b2 : local.hash,
          size: (_c2 = entry == null ? void 0 : entry.size) != null ? _c2 : local.size,
          ...local.isFolder ? { isFolder: true } : {}
        });
        conflicts.push({
          path,
          reason,
          winner: "local",
          loserContent: "remote",
          remote: summary,
          localClock
        });
      }
      return;
    }
    if (remote.deleted) {
      if (remoteWins) {
        pulls.push(pullFile("delete", path, remote));
        conflicts.push({
          path,
          reason,
          winner: "remote",
          loserContent: "local",
          conflictCopyPath: pushConflictCopy(path, local, remote),
          remote: summary,
          localClock
        });
      } else {
        pushes.push({
          kind: local.kind,
          path,
          parentVersion: (_d2 = entry == null ? void 0 : entry.versionId) != null ? _d2 : null,
          hash: local.hash,
          size: local.size
        });
        conflicts.push({
          path,
          reason,
          winner: "local",
          loserContent: "none",
          remote: summary,
          localClock
        });
      }
      return;
    }
    if (local.hash === remote.hash) {
      pulls.push(
        pullFile((entry == null ? void 0 : entry.deletedAt) !== void 0 ? "restore" : entry === void 0 ? "add" : "edit", path, remote)
      );
      return;
    }
    if (remoteWins) {
      pulls.push(
        pullFile((entry == null ? void 0 : entry.deletedAt) !== void 0 ? "restore" : entry === void 0 ? "add" : "edit", path, remote)
      );
      conflicts.push({
        path,
        reason,
        winner: "remote",
        loserContent: "local",
        conflictCopyPath: pushConflictCopy(path, local, remote),
        remote: summary,
        localClock
      });
    } else {
      pushes.push({
        kind: local.kind,
        path,
        // Deliberately the (stale) index parent: the DO must arbitrate and
        // synthesize the conflict copy for the losing remote content.
        parentVersion: (_e2 = entry == null ? void 0 : entry.versionId) != null ? _e2 : null,
        hash: local.hash,
        size: local.size
      });
      conflicts.push({
        path,
        reason,
        winner: "local",
        loserContent: "remote",
        remote: summary,
        localClock
      });
    }
  }
  function pushConflictCopy(path, local, remote) {
    if (local.hash === remote.hash) return void 0;
    const copyPath = conflictCopyPath(path, thisDeviceName, now, pathExists);
    pushes.push({
      kind: "conflictCopy",
      path: copyPath,
      // Build on the winning remote head: this push must fast-path.
      parentVersion: remote.version,
      hash: local.hash,
      size: local.size
    });
    return copyPath;
  }
}
function pullFile(kind, path, remote) {
  var _a;
  return {
    kind,
    path,
    hash: remote.hash,
    size: remote.size,
    version: remote.version,
    clock: remote.clock,
    deleted: (_a = remote.deleted) != null ? _a : kind === "delete",
    ...remote.isFolder ? { isFolder: true } : {}
  };
}
function remoteSummary(remote) {
  return {
    version: remote.version,
    hash: remote.hash,
    size: remote.size,
    deleted: remote.deleted,
    clock: remote.clock
  };
}
function remoteEntryChanged(entry, remote) {
  if (remote === void 0) return false;
  if (entry === void 0) return !remote.deleted;
  return remote.version !== entry.versionId;
}
function opPath(op) {
  return op.kind === "rename" ? op.toPath : op.path;
}
function comparePullOps(a, b) {
  const byExact = compareStrings(opPath(a), opPath(b));
  if (byExact === 0) return 0;
  if (opPath(a).toLowerCase() !== opPath(b).toLowerCase()) return byExact;
  const aDeletes = a.kind === "delete";
  const bDeletes = b.kind === "delete";
  if (aDeletes !== bDeletes) return aDeletes ? -1 : 1;
  return byExact;
}
function compareStrings(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ../core/src/scan.ts
async function scanVault(storage, index, settings, now, options = {}) {
  var _a, _b;
  const hashFn = (_a = options.hash) != null ? _a : sha256Hex;
  const mode = (_b = options.mode) != null ? _b : "fast";
  const onProgress = options.onProgress;
  const thisDeviceId = options.thisDeviceId;
  const files = await storage.listFiles();
  const unsafePaths = [];
  const syncable = [];
  for (const file of files) {
    if (isWindowsUnsafePath(file.path)) unsafePaths.push(file.path);
    else syncable.push(file);
  }
  const kept = [];
  for (const file of syncable) {
    if (!isIgnored(file.path, settings)) kept.push(file);
  }
  const keptPaths = new Set(kept.map((f) => f.path));
  const added = [];
  const modified = [];
  const hashed = [];
  onProgress == null ? void 0 : onProgress(0, kept.length);
  let scanned = 0;
  for (const file of kept) {
    const entry = index[file.path];
    if (mode === "fast" && statMatchesEntry(entry, file)) {
      scanned += 1;
      onProgress == null ? void 0 : onProgress(scanned, kept.length);
      continue;
    }
    const hash = await hashFn(await storage.readFile(file.path));
    hashed.push({ path: file.path, hash, size: file.size, mtime: file.mtime });
    scanned += 1;
    onProgress == null ? void 0 : onProgress(scanned, kept.length);
    if (entry === void 0) {
      added.push({ path: file.path, hash, size: file.size });
      continue;
    }
    if (entry.isFolder) {
      modified.push({ path: file.path, hash, size: file.size });
      continue;
    }
    if (entry.deletedAt !== void 0 || entry.hash !== hash) {
      modified.push({ path: file.path, hash, size: file.size });
    }
  }
  const deleted = [];
  for (const [path, entry] of Object.entries(index)) {
    if (entry.isFolder) continue;
    if (entry.deletedAt !== void 0) continue;
    if (keptPaths.has(path)) continue;
    if (isIgnored(path, settings)) {
      continue;
    }
    deleted.push({ path, hash: entry.hash, size: entry.size, versionId: entry.versionId });
  }
  const { renamed, deleted: unmatchedDeleted, added: unmatchedAdded } = detectRenames(deleted, added);
  const { deleted: safeDeleted, caseCollisions } = splitCaseCollisions(
    unmatchedDeleted,
    keptPaths,
    /* @__PURE__ */ new Set([...unmatchedAdded.map((c) => c.path), ...modified.map((c) => c.path), ...renamed.map((r) => r.to)])
  );
  const dirs = await storage.listDirs();
  const syncableDirs = [];
  for (const dir of dirs) {
    if (isWindowsUnsafePath(dir)) unsafePaths.push(dir);
    else syncableDirs.push(dir);
  }
  const { emptyFolders, staleDirs } = detectEmptyFolders(
    index,
    settings,
    syncable,
    syncableDirs,
    thisDeviceId
  );
  const folderDeletions = detectFolderDeletions(index, settings, syncableDirs);
  return {
    scannedAt: now,
    added: sortCandidates(unmatchedAdded),
    modified: sortCandidates(modified),
    deleted: [...safeDeleted].sort(byPath),
    renamed: [...renamed].sort((a, b) => byPath(a, b)),
    emptyFolders,
    folderDeletions,
    // Omitted when empty (not `[]`) — see the field's doc.
    ...staleDirs.length > 0 ? { staleDirs } : {},
    ...caseCollisions.length > 0 ? { caseCollisions } : {},
    ...unsafePaths.length > 0 ? { unsafePaths: unsafePaths.sort(compareStrings2) } : {},
    hashed: [...hashed].sort(byPath)
  };
}
function splitCaseCollisions(deleted, keptPaths, changedPaths) {
  const keptByLower = /* @__PURE__ */ new Map();
  for (const path of keptPaths) keptByLower.set(path.toLowerCase(), path);
  const safeDeleted = [];
  const caseCollisions = [];
  for (const candidate of deleted) {
    const twin = keptByLower.get(candidate.path.toLowerCase());
    if (twin !== void 0 && !changedPaths.has(twin)) {
      caseCollisions.push(candidate.path);
      continue;
    }
    safeDeleted.push(candidate);
  }
  return {
    deleted: safeDeleted,
    caseCollisions: caseCollisions.sort(compareStrings2)
  };
}
function compareStrings2(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}
function statMatchesEntry(entry, file) {
  return entry !== void 0 && entry.deletedAt === void 0 && entry.isFolder !== true && entry.mtime !== void 0 && entry.mtime === file.mtime && entry.size === file.size;
}
function recordHashedFiles(index, hashed) {
  let next;
  for (const observed of hashed) {
    const entry = index[observed.path];
    if (entry === void 0 || entry.isFolder || entry.deletedAt !== void 0) continue;
    if (entry.hash !== observed.hash) continue;
    if (entry.mtime === observed.mtime) continue;
    next != null ? next : next = { ...index };
    next[observed.path] = { ...entry, mtime: observed.mtime };
  }
  return next != null ? next : index;
}
function detectRenames(deleted, added) {
  var _a;
  const addsByHash = /* @__PURE__ */ new Map();
  for (const candidate of [...added].sort(byPath)) {
    const bucket = addsByHash.get(candidate.hash);
    if (bucket) bucket.push(candidate);
    else addsByHash.set(candidate.hash, [candidate]);
  }
  const usedAdds = /* @__PURE__ */ new Set();
  const renamed = [];
  const unmatchedDeleted = [];
  for (const deletion of [...deleted].sort(byPath)) {
    const candidates = (_a = addsByHash.get(deletion.hash)) != null ? _a : [];
    let fallback;
    let sameDir;
    for (const candidate of candidates) {
      if (usedAdds.has(candidate.path)) continue;
      if (parentPath(candidate.path) === parentPath(deletion.path)) {
        sameDir != null ? sameDir : sameDir = candidate;
      } else {
        fallback != null ? fallback : fallback = candidate;
      }
    }
    const match = sameDir != null ? sameDir : fallback;
    if (match) {
      usedAdds.add(match.path);
      renamed.push({ from: deletion.path, to: match.path, hash: deletion.hash, size: deletion.size });
    } else {
      unmatchedDeleted.push(deletion);
    }
  }
  return {
    renamed,
    deleted: unmatchedDeleted,
    added: added.filter((candidate) => !usedAdds.has(candidate.path))
  };
}
function detectEmptyFolders(index, settings, files, dirs, thisDeviceId) {
  const representedDirs = /* @__PURE__ */ new Set();
  for (const file of files) {
    for (let dir = parentPath(file.path); dir !== "/"; dir = parentPath(dir)) {
      representedDirs.add(dir);
    }
  }
  const emptyFolders = [];
  const staleDirs = [];
  for (const dir of dirs) {
    if (dir === "/") continue;
    if (isIgnored(dir, settings)) continue;
    const entry = index[dir];
    if ((entry == null ? void 0 : entry.isFolder) && entry.deletedAt === void 0) continue;
    if ((entry == null ? void 0 : entry.isFolder) && entry.deletedAt !== void 0) {
      if (representedDirs.has(dir) || entry.clock.deviceId === thisDeviceId) {
        emptyFolders.push(dir);
      } else {
        staleDirs.push(dir);
      }
      continue;
    }
    if (representedDirs.has(dir)) continue;
    emptyFolders.push(dir);
  }
  return {
    emptyFolders: emptyFolders.sort(),
    staleDirs: staleDirs.sort()
  };
}
function detectFolderDeletions(index, settings, dirs) {
  const present = new Set(dirs);
  const folderDeletions = [];
  for (const [path, entry] of Object.entries(index)) {
    if (!entry.isFolder) continue;
    if (entry.deletedAt !== void 0) continue;
    if (present.has(path)) continue;
    if (isIgnored(path, settings)) continue;
    folderDeletions.push({ path, versionId: entry.versionId });
  }
  return folderDeletions.sort(byPath);
}
function sortCandidates(candidates) {
  return [...candidates].sort(byPath);
}
function byPath(a, b) {
  var _a, _b, _c, _d;
  const keyA = (_b = (_a = a.path) != null ? _a : a.from) != null ? _b : "";
  const keyB = (_d = (_c = b.path) != null ? _c : b.from) != null ? _d : "";
  return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
}

// ../core/src/client.ts
var DEFAULT_PUSH_CONCURRENCY = 8;
var DEFAULT_PROGRESS_THROTTLE_MS = 50;
var defaultLog = {
  debug: () => {
  },
  info: () => {
  },
  warn: () => {
  },
  error: () => {
  }
};
var defaultSchedule = (fn, ms) => {
  const handle = globalThis.setTimeout(fn, ms);
  return () => globalThis.clearTimeout(handle);
};
var SyncClient = class {
  constructor(options) {
    __publicField(this, "options");
    __publicField(this, "log");
    __publicField(this, "now");
    __publicField(this, "debounceMs");
    __publicField(this, "schedule");
    __publicField(this, "dialTransport");
    __publicField(this, "pushConcurrency");
    __publicField(this, "progressThrottleMs");
    __publicField(this, "transport", null);
    __publicField(this, "state", "idle");
    __publicField(this, "index", {});
    __publicField(this, "cursor", 0);
    __publicField(this, "lastSyncAt", null);
    __publicField(this, "pending", 0);
    __publicField(this, "conflicts", []);
    __publicField(this, "caseCollisions", []);
    __publicField(this, "skippedPaths", []);
    __publicField(this, "ignoreSettings");
    __publicField(this, "watchAdapter", null);
    __publicField(this, "cancelDebounce", null);
    /**
     * Delta-manifest bookkeeping (persisted alongside the index, see
     * `PersistedSyncState`): `syncedThrough` — the manifest cursor of the last
     * fully-successful cycle, i.e. the seq through which the index is known
     * COMPLETE (null until one finishes); `needsFullManifest` — a remote change
     * was deferred over local divergence and must be resolved through a full
     * manifest's plan logic; `serverOldestRetainedSeq` — the helloAck's answer
     * to "is my replay window intact" (null for legacy servers ⇒ always full).
     */
    __publicField(this, "syncedThrough", null);
    __publicField(this, "needsFullManifest", false);
    __publicField(this, "serverOldestRetainedSeq", null);
    /** Server release from helloAck; null until acked (legacy servers stay null). */
    __publicField(this, "serverVersion", null);
    /** Current bulk-phase progress, cleared when a cycle settles. */
    __publicField(this, "progress", null);
    __publicField(this, "lastProgressAt", 0);
    /** Serialized operation queue — exactly one async op runs at a time. */
    __publicField(this, "tail", Promise.resolve());
    __publicField(this, "queuedOps", 0);
    /** Startup-time change flood is buffered; the full manifest subsumes it. */
    __publicField(this, "buffering", false);
    __publicField(this, "buffered", []);
    /**
     * Outstanding request expectations, oldest first. Ops are serialized per
     * cycle EXCEPT the push pipeline, which keeps several commits in flight —
     * replies on the ordered WS arrive in send order, so matching the OLDEST
     * expectation that accepts a message pairs every reply with its request
     * (the DO arbitrates behind `runExclusive`, and the in-memory server
     * mirrors that, so the server never reorders replies either).
     */
    __publicField(this, "expectations", []);
    /**
     * Serializes ACK APPLICATION across pipeline slots. Slots await replies
     * concurrently, but each reply folds into the SHARED `this.index`
     * (read-modify-write); chaining the folds keeps every apply atomic with
     * respect to the others. Order across different paths is irrelevant (one
     * commit per path per cycle, per-path server arbitration), so no ordering
     * guarantee is needed beyond mutual exclusion.
     */
    __publicField(this, "ackChain", Promise.resolve());
    // --- message pump ----------------------------------------------------------------------
    __publicField(this, "onTransportMessage", (message) => {
      const index = this.expectations.findIndex((expectation) => expectation.matches(message));
      if (index >= 0) {
        const expectation = this.expectations[index];
        this.expectations.splice(index, 1);
        if (expectation !== void 0) expectation.resolve(message);
        return;
      }
      if (this.buffering) {
        this.buffered.push(message);
        return;
      }
      this.enqueue(async () => {
        await this.dispatch(message);
      }).catch((error) => this.log.warn("change handler failed", error));
    });
    /**
     * The manifest's fetch-time cursor for the RUNNING cycle — the completion
     * watermark a successful cycle records into `syncedThrough` (see the
     * comment there). Null outside cycles.
     */
    __publicField(this, "manifestCursorOfCycle", null);
    __publicField(this, "fetchBlob", async (hash) => {
      if (hash === "") throw new ProtocolError("refusing to fetch content for an empty hash");
      const cached = await this.options.blobStore.get(hash);
      if (cached !== void 0) return cached;
      const bytes = await this.downloadBlob(hash);
      await this.options.blobStore.put(hash, bytes);
      return bytes;
    });
    var _a, _b, _c, _d, _e, _f, _g;
    this.options = options;
    this.log = (_a = options.log) != null ? _a : defaultLog;
    this.now = (_b = options.now) != null ? _b : (() => Date.now());
    this.debounceMs = (_c = options.debounceMs) != null ? _c : 300;
    this.schedule = (_d = options.schedule) != null ? _d : defaultSchedule;
    this.pushConcurrency = Math.max(1, (_e = options.pushConcurrency) != null ? _e : DEFAULT_PUSH_CONCURRENCY);
    this.progressThrottleMs = Math.max(0, (_f = options.progressThrottleMs) != null ? _f : DEFAULT_PROGRESS_THROTTLE_MS);
    this.dialTransport = typeof options.transport === "function" ? options.transport : () => options.transport;
    this.ignoreSettings = (_g = options.settings) != null ? _g : { obsidianSync: false };
  }
  // --- lifecycle ----------------------------------------------------------------------
  /** Run startup reconciliation and enter live mode. */
  async connect() {
    await this.enqueue(() => this.startup());
  }
  /** Re-dial and re-run the full startup reconciliation. */
  async reconnect() {
    await this.enqueue(async () => {
      var _a;
      (_a = this.transport) == null ? void 0 : _a.close();
      this.transport = null;
      await this.startup();
    });
  }
  close() {
    var _a, _b;
    this.stopWatching();
    (_a = this.cancelDebounce) == null ? void 0 : _a.call(this);
    this.cancelDebounce = null;
    (_b = this.transport) == null ? void 0 : _b.close();
    this.transport = null;
    this.state = "idle";
  }
  /** Begin debounced watching (ARCHITECTURE §8 live operation). */
  startWatching(watchAdapter) {
    this.stopWatching();
    this.watchAdapter = watchAdapter;
    watchAdapter.start((events) => this.onWatchEvents(events));
  }
  stopWatching() {
    var _a;
    (_a = this.watchAdapter) == null ? void 0 : _a.stop();
    this.watchAdapter = null;
  }
  /** Manual one-shot cycle (`vsa` one-shot, "sync now" buttons, tests). */
  async triggerSync() {
    await this.enqueue(() => this.runCycle());
  }
  /** Resolves when every queued operation has settled. */
  async waitIdle() {
    while (this.queuedOps > 0) await this.tail;
    await this.tail;
  }
  status() {
    return {
      state: this.state,
      lastSyncAt: this.lastSyncAt,
      pending: this.pending,
      conflicts: [...this.conflicts],
      ...this.caseCollisions.length > 0 ? { caseCollisions: [...this.caseCollisions] } : {},
      ...this.skippedPaths.length > 0 ? { skippedPaths: [...this.skippedPaths] } : {},
      serverVersion: this.serverVersion,
      ...this.progress !== null ? { progress: { ...this.progress } } : {}
    };
  }
  /** Read-only view of the local index (tests, `vsa status`). */
  currentIndex() {
    return { ...this.index };
  }
  /** Last seen server sequence number. */
  get cursorValue() {
    return this.cursor;
  }
  /** TS-safe state probe (assignments inside async flows defeat narrowing). */
  isDisconnected() {
    return this.state === "disconnected";
  }
  // --- startup -------------------------------------------------------------------------
  async startup() {
    var _a, _b;
    this.state = "connecting";
    this.buffering = true;
    this.buffered = [];
    if (await this.safeStorageExists(LOCAL_INDEX_STATE_PATH)) {
      try {
        const loaded = await loadLocalState(this.options.storage);
        this.index = loaded.index;
        this.cursor = loaded.state.cursor;
        this.syncedThrough = loaded.state.syncedThrough;
        this.needsFullManifest = loaded.state.needsFullManifest;
      } catch (error) {
        try {
          await this.options.storage.renameFile(
            LOCAL_INDEX_STATE_PATH,
            `${LOCAL_INDEX_STATE_PATH}.corrupt.bak`
          );
        } catch (e) {
        }
        this.log.warn(
          "local index state is corrupt; quarantined to state.corrupt.bak and resyncing from a full manifest",
          error
        );
        this.resetLocalState();
      }
    } else {
      this.resetLocalState();
    }
    this.serverOldestRetainedSeq = null;
    this.serverVersion = null;
    const transport = this.dialTransport();
    this.transport = transport;
    transport.onMessage((message) => this.onTransportMessage(message));
    transport.onClose((reason) => this.onTransportClose(reason));
    const helloAck = await this.request(
      (m) => m.type === "helloAck" || m.type === "error",
      () => transport.send({
        type: "hello",
        token: this.options.token,
        protocolVersion: ProtocolVersion,
        cursor: this.cursor
      })
    );
    if (helloAck.type === "error") throw this.toError(helloAck);
    this.ignoreSettings = {
      obsidianSync: helloAck.settings.obsidianSync,
      ...this.ignoreSettings.extraIgnores !== void 0 ? { extraIgnores: this.ignoreSettings.extraIgnores } : {}
    };
    this.serverOldestRetainedSeq = (_a = helloAck.oldestRetainedSeq) != null ? _a : null;
    this.serverVersion = (_b = helloAck.serverVersion) != null ? _b : null;
    this.state = "syncing";
    if (this.shouldRequestDeltaManifest()) {
      const replay = this.buffered;
      this.buffered = [];
      for (const message of replay) {
        await this.dispatch(message);
      }
    }
    await this.runCycle();
    this.buffering = false;
    const buffered = this.buffered;
    this.buffered = [];
    for (const message of buffered) {
      await this.dispatch(message);
    }
    if (!this.isDisconnected()) this.state = "live";
  }
  async safeStorageExists(path) {
    try {
      return await this.options.storage.exists(path);
    } catch (e) {
      return false;
    }
  }
  /** Fresh index + cursor bookkeeping: no prior knowledge, full manifest. */
  resetLocalState() {
    this.index = {};
    this.cursor = 0;
    this.syncedThrough = null;
    this.needsFullManifest = false;
  }
  onTransportClose(reason) {
    var _a, _b;
    this.log.warn("transport closed", reason);
    this.state = "disconnected";
    const expectations = this.expectations;
    this.expectations = [];
    for (const expectation of expectations) {
      expectation.reject(
        new NetworkError(`connection closed: ${(_b = (_a = reason.reason) != null ? _a : reason.code) != null ? _b : "unknown"}`)
      );
    }
  }
  async dispatch(message) {
    switch (message.type) {
      case "change":
        await this.handleChange(message);
        return;
      case "deviceSeen":
        return;
      // presence only; dashboards consume it
      case "pong":
        return;
      case "error":
        this.log.error("server error", message.code, message.message);
        return;
      case "helloAck":
      case "manifest":
      case "commitAck":
      case "conflict":
      case "blob":
      case "blobAck":
      case "snapshotCreateAck":
      case "snapshotRestoreAck":
        this.log.warn("unexpected server reply", message.type);
        return;
      default:
        this.log.warn("ignoring client-to-server message from server", message);
    }
  }
  async handleChange(change) {
    var _a, _b;
    validateChangeMessage(change);
    if (change.seq > this.cursor) this.cursor = change.seq;
    const unsafe = firstUnsafePath(
      change.fromPath !== void 0 ? [change.path, change.fromPath] : [change.path]
    );
    if (unsafe !== void 0) {
      this.recordSkippedPath(unsafe);
      if (change.seq > ((_a = this.syncedThrough) != null ? _a : 0)) this.syncedThrough = change.seq;
      return;
    }
    if (isIgnored(change.path, this.ignoreSettings)) return;
    if (change.fromPath !== void 0 && isIgnored(change.fromPath, this.ignoreSettings)) return;
    const entry = this.index[change.path];
    if (entry !== void 0) {
      if (entry.versionId === change.version) return;
      if (compareClocks(entry.clock, change.clock) >= 0) return;
    }
    if (!await this.changeIsSafe(change)) {
      this.log.info("deferring remote change over local divergence", change.path);
      this.needsFullManifest = true;
      this.scheduleReconcile();
      return;
    }
    this.index = await this.applyPulls([this.pullOpFromChange(change)]);
    if (change.seq > ((_b = this.syncedThrough) != null ? _b : 0)) this.syncedThrough = change.seq;
  }
  /**
   * A change may be applied directly only when the touched paths carry no
   * un-reconciled local content. Anything else must detour through a full
   * `computeSyncPlan` cycle (conflict logic, conflict copies).
   */
  async changeIsSafe(change) {
    if (change.isFolder === true) return true;
    if (change.kind === "rename" && change.fromPath !== void 0) {
      if (await this.pathHasLocalDivergence(change.fromPath)) return false;
      if (await this.storageExists(change.path)) {
        const entry = this.index[change.path];
        if (entry === void 0 || entry.deletedAt !== void 0) return false;
        const actual = await sha256Hex(await this.options.storage.readFile(change.path));
        if (actual !== entry.hash) return false;
      }
      return true;
    }
    return !await this.pathHasLocalDivergence(change.path);
  }
  async pathHasLocalDivergence(path) {
    const entry = this.index[path];
    if (entry == null ? void 0 : entry.isFolder) return false;
    if (!await this.storageExists(path)) return false;
    if (entry === void 0 || entry.deletedAt !== void 0) return true;
    const actual = await sha256Hex(await this.options.storage.readFile(path));
    return actual !== entry.hash;
  }
  async storageExists(path) {
    try {
      return await this.options.storage.exists(path);
    } catch (e) {
      return false;
    }
  }
  pullOpFromChange(change) {
    if (change.kind === "rename" && change.fromPath !== void 0) {
      return {
        kind: "rename",
        fromPath: change.fromPath,
        toPath: change.path,
        hash: change.hash,
        size: change.size,
        version: change.version,
        clock: change.clock,
        // A folder rename is a metadata move (hash ''); without the flag the
        // engine's rename branch would fetch content for the empty hash when
        // fromPath is already gone locally (true on the author) — the exact
        // wedge the empty-hash guard exists to catch.
        ...change.isFolder === true ? { isFolder: true } : {}
      };
    }
    const entry = this.index[change.path];
    const kind = change.deleted ? "delete" : entry === void 0 ? "add" : entry.deletedAt !== void 0 ? "restore" : "edit";
    return {
      kind,
      path: change.path,
      hash: change.hash,
      size: change.size,
      version: change.version,
      clock: change.clock,
      deleted: change.deleted,
      ...change.isFolder === true ? { isFolder: true } : {}
    };
  }
  /** Materialize pulls through the verified engine path; returns the new index. */
  async applyPulls(pulls, progress) {
    const materializable = [];
    for (const pull of pulls) {
      const unsafe = firstUnsafePath(pullTargets(pull));
      if (unsafe === void 0) {
        materializable.push(pull);
        continue;
      }
      this.recordSkippedPath(unsafe);
    }
    return applyPull(
      this.options.storage,
      this.index,
      { pushes: [], pulls: materializable, conflicts: [], folderPushes: [] },
      this.fetchBlob,
      {
        now: this.now(),
        // Keep the envelope's cursor bookkeeping intact across pull-side
        // persists (applyPull rewrites the whole state file).
        persistedState: this.persistedState(),
        ...progress !== void 0 ? { onProgress: progress.onProgress } : {}
      }
    );
  }
  /** The envelope bookkeeping written whenever the client persists the index. */
  persistedState() {
    return {
      cursor: this.cursor,
      syncedThrough: this.syncedThrough,
      needsFullManifest: this.needsFullManifest
    };
  }
  /**
   * Record a path the cycle could not sync because its name is
   * Windows-unsafe (`paths.ts`): surfaced on `status().skippedPaths` and
   * logged once per record until a human renames it. Deduped; replaced at
   * the start of every cycle.
   */
  recordSkippedPath(path) {
    if (this.skippedPaths.includes(path)) return;
    this.skippedPaths.push(path);
    this.log.warn(
      "skipping a Windows-unsafe path (reserved device name or trailing dot/space); rename it to sync",
      path
    );
  }
  /**
   * Record one bulk-phase step on `status().progress`. Coalesced to at most
   * one update per `progressThrottleMs` (renderer churn), EXCEPT phase
   * changes and completions, which always emit so a phase is never missed
   * and `done/total` always lands on its final value.
   */
  emitProgress(phase, done, total) {
    var _a;
    if (total === 0) return;
    const now = this.now();
    const complete = done >= total;
    const phaseChanged = ((_a = this.progress) == null ? void 0 : _a.phase) !== phase;
    if (!complete && !phaseChanged && now - this.lastProgressAt < this.progressThrottleMs) return;
    this.lastProgressAt = now;
    this.progress = { phase, done, total };
  }
  // --- watcher ------------------------------------------------------------------------------
  onWatchEvents(events) {
    const relevant = events.filter((event) => !isIgnored(event.path, this.ignoreSettings));
    if (relevant.length === 0) return;
    this.pending += relevant.length;
    this.scheduleReconcile();
  }
  /** Debounced scan→plan→execute (shared by watcher and deferred changes). */
  scheduleReconcile() {
    var _a;
    (_a = this.cancelDebounce) == null ? void 0 : _a.call(this);
    this.cancelDebounce = this.schedule(() => {
      this.cancelDebounce = null;
      this.enqueue(() => this.runCycle()).catch(
        (error) => this.log.warn("debounced sync cycle failed", error)
      );
    }, this.debounceMs);
  }
  // --- the sync cycle --------------------------------------------------------------------------
  async runCycle() {
    var _a, _b, _c, _d, _e, _f, _g;
    if (this.transport === null || this.isDisconnected()) return;
    this.state = "syncing";
    this.progress = null;
    this.skippedPaths = [];
    try {
      const manifest = await this.fetchManifest();
      const localChanges = await scanVault(
        this.options.storage,
        this.index,
        this.ignoreSettings,
        this.now(),
        {
          onProgress: (done, total) => this.emitProgress("scanning", done, total),
          // Sharpens the staleDirs rule: an empty dir over a tombstone THIS
          // device authored is a local recreation, not a deletion residue.
          thisDeviceId: this.options.deviceId
        }
      );
      const plan = computeSyncPlan({
        localChanges,
        index: this.index,
        manifest,
        thisDeviceId: this.options.deviceId,
        thisDeviceName: this.options.deviceName,
        now: this.now()
      });
      this.conflicts = [...plan.conflicts];
      this.caseCollisions = [...(_a = localChanges.caseCollisions) != null ? _a : []];
      if (this.caseCollisions.length > 0) {
        this.log.warn(
          "case-colliding file pair: these files differ only by name case and one is invisible on this filesystem; rename one of them",
          this.caseCollisions
        );
      }
      for (const path of (_b = localChanges.unsafePaths) != null ? _b : []) {
        this.recordSkippedPath(path);
      }
      const staged = await this.stagePushes(plan, localChanges.hashed);
      this.index = await this.applyPulls(plan.pulls, {
        onProgress: (done, total) => this.emitProgress("pulling", done, total)
      });
      const pushTotal = staged.length + plan.folderPushes.length;
      let pushDone = 0;
      const settlePush = () => {
        pushDone += 1;
        this.emitProgress("pushing", pushDone, pushTotal);
      };
      this.emitProgress("pushing", 0, pushTotal);
      await this.runPushPipeline(staged, settlePush);
      const emptiedDirs = /* @__PURE__ */ new Set();
      for (const commit of staged) {
        let ceasedPath;
        if (commit.kind === "delete" && commit.isFolder !== true) {
          if (((_c = this.index[commit.path]) == null ? void 0 : _c.deletedAt) !== void 0) ceasedPath = commit.path;
        } else if (commit.kind === "rename" && commit.fromPath !== void 0) {
          if (!(commit.fromPath in this.index)) ceasedPath = commit.fromPath;
        }
        if (ceasedPath === void 0) continue;
        const pruned = await pruneParentOnDelete(this.options.storage, this.index, ceasedPath);
        if (pruned === void 0) continue;
        emptiedDirs.add(pruned.dir);
        const placeholder = this.index[pruned.dir];
        if ((placeholder == null ? void 0 : placeholder.isFolder) && placeholder.deletedAt === void 0) {
          this.scheduleReconcile();
        }
      }
      for (const dir of (_d = localChanges.staleDirs) != null ? _d : []) {
        await removeDirIfVacant(this.options.storage, this.index, dir);
      }
      const folderCommits = [];
      for (const path of plan.folderPushes) {
        if (emptiedDirs.has(path)) continue;
        if (!await this.storageExists(path)) continue;
        folderCommits.push({
          kind: "edit",
          path,
          parentVersion: (_f = (_e = this.index[path]) == null ? void 0 : _e.versionId) != null ? _f : null,
          hash: "",
          size: 0,
          isFolder: true
        });
      }
      await this.runPushPipeline(folderCommits, settlePush);
      this.index = recordHashedFiles(this.index, localChanges.hashed);
      if (this.manifestCursorOfCycle !== null && this.manifestCursorOfCycle > ((_g = this.syncedThrough) != null ? _g : 0)) {
        this.syncedThrough = this.manifestCursorOfCycle;
      }
      this.manifestCursorOfCycle = null;
      this.needsFullManifest = false;
      this.lastSyncAt = this.now();
      this.pending = 0;
      if (!this.isDisconnected()) this.state = "live";
    } catch (error) {
      this.manifestCursorOfCycle = null;
      this.log.error("sync cycle failed", error);
      if (!this.isDisconnected()) this.state = this.transport !== null ? "live" : "idle";
      throw error;
    } finally {
      this.progress = null;
    }
  }
  /**
   * Whether THIS cycle may request a delta manifest. All four gates must
   * hold (any failure ⇒ full manifest, today's behavior):
   *
   *  1. `cursor > 0` — a first-ever connect knows nothing; full manifest.
   *  2. `syncedThrough !== null` — some full-manifest cycle completed, so the
   *     index is COMPLETE through it; heads after it arrive via replay +
   *     delta. An interrupted initial sync never sets it ⇒ full manifest.
   *  3. `!needsFullManifest` — no deferred divergence awaits plan resolution.
   *  4. Replay window intact — helloAck reported `oldestRetainedSeq <=
   *     cursor + 1`, so every event after our cursor is still on the server.
   */
  shouldRequestDeltaManifest() {
    return this.cursor > 0 && this.syncedThrough !== null && !this.needsFullManifest && this.serverOldestRetainedSeq !== null && this.serverOldestRetainedSeq <= this.cursor + 1;
  }
  async fetchManifest() {
    var _a;
    const transport = this.transport;
    if (transport === null) throw new NetworkError("not connected");
    const useDelta = this.shouldRequestDeltaManifest();
    const since = useDelta && this.syncedThrough !== null ? this.syncedThrough : void 0;
    const reply = await this.request(
      (m) => m.type === "manifest" || m.type === "error",
      () => transport.send({ type: "getManifest", ...since !== void 0 ? { since } : {} })
    );
    if (reply.type === "error") throw this.toError(reply);
    validateManifestMessage(reply);
    if (reply.cursor > this.cursor) this.cursor = reply.cursor;
    this.manifestCursorOfCycle = reply.cursor;
    if (!useDelta) {
      return this.toRemoteFiles(Object.values(reply.entries));
    }
    const merged = /* @__PURE__ */ new Map();
    for (const [path, entry] of Object.entries(this.index)) {
      merged.set(path, {
        path,
        version: entry.versionId,
        hash: entry.hash,
        size: entry.size,
        deleted: entry.deletedAt !== void 0,
        clock: entry.clock,
        ...entry.isFolder ? { isFolder: true } : {},
        mtime: (_a = entry.mtime) != null ? _a : 0
      });
    }
    for (const [path, entry] of Object.entries(reply.entries)) {
      merged.set(path, { ...entry });
    }
    return this.toRemoteFiles([...merged.values()]);
  }
  /**
   * Project manifest-side entries to `RemoteFile`s, skipping Windows-unsafe
   * paths (diagnosed via `recordSkippedPath`, never handed to the planner —
   * materializing them is impossible, so planning them would only produce a
   * pull that fails every cycle).
   */
  toRemoteFiles(entries) {
    const remote = [];
    for (const entry of entries) {
      if (isWindowsUnsafePath(entry.path)) {
        this.recordSkippedPath(entry.path);
        continue;
      }
      remote.push({ ...entry });
    }
    return remote;
  }
  async stagePushes(plan, hashed) {
    var _a;
    const copySources = /* @__PURE__ */ new Map();
    for (const conflict of plan.conflicts) {
      if (conflict.conflictCopyPath !== void 0) {
        copySources.set(conflict.conflictCopyPath, conflict.path);
      }
    }
    const hashTimeMtime = new Map(hashed.map((observed) => [observed.path, observed.mtime]));
    const staged = [];
    for (const push of plan.pushes) {
      if (push.kind === "delete" || push.kind === "rename") {
        staged.push(this.toStaged(push));
        continue;
      }
      const sourcePath = push.kind === "conflictCopy" ? (_a = copySources.get(push.path)) != null ? _a : push.path : push.path;
      const bytes = await this.readLocal(sourcePath);
      if (bytes === void 0) {
        this.log.warn("push source vanished since scan; deferring", push.path);
        this.scheduleReconcile();
        continue;
      }
      const hash = await sha256Hex(bytes);
      if (hash !== push.hash || bytes.byteLength !== push.size) {
        this.log.warn("local content drifted since scan; deferring push", push.path);
        this.scheduleReconcile();
        continue;
      }
      if (push.kind === "conflictCopy") {
        await this.options.storage.writeFile(push.path, bytes);
        staged.push({ ...this.toStaged(push), bytes });
        continue;
      }
      staged.push({
        ...this.toStaged(push),
        bytes,
        ...hashTimeMtime.get(sourcePath) !== void 0 ? { mtime: hashTimeMtime.get(sourcePath) } : {}
      });
    }
    return staged;
  }
  toStaged(push) {
    if (push.kind === "rename") {
      return {
        kind: "rename",
        path: push.toPath,
        parentVersion: push.parentVersion,
        hash: push.hash,
        size: push.size,
        fromPath: push.fromPath
      };
    }
    return {
      kind: push.kind === "add" ? "edit" : push.kind,
      path: push.path,
      parentVersion: push.parentVersion,
      hash: push.hash,
      size: push.size,
      ...push.isFolder ? { isFolder: true } : {}
    };
  }
  async readLocal(path) {
    try {
      return await this.options.storage.readFile(path);
    } catch (e) {
      return void 0;
    }
  }
  /**
   * Send `commits` through a bounded-concurrency pipeline: up to
   * `pushConcurrency` commits in flight (sent, awaiting their server reply)
   * at once; each slot sends its next commit as soon as an earlier one is
   * settled.
   *
   * WHY PIPELINING IS SAFE (vs. a batch message): conflict arbitration is
   * SERVER-side and PER PATH (`arbitrateCommit` reads and writes exactly the
   * committed path's head), and a cycle stages at most ONE commit per path
   * (the scan buckets by path; renames consume both ends). So two in-flight
   * commits can never interact on the server, and reply ORDER across
   * different paths does not matter for the resulting state — only per-path
   * pairing of reply→commit matters, which the ordered WebSocket plus the
   * server's serialized arbitration guarantee (replies arrive in send order,
   * matched FIFO by `onTransportMessage`). A batch protocol message would
   * additionally couple blob-upload timing and error granularity for no
   * correctness gain, so protocol v1 stays unchanged.
   *
   * On the first failure, in-flight commits still settle (their acks are
   * applied — they are real heads) but no NEW commit starts; the error is
   * rethrown after all slots drain so the cycle fails exactly like the old
   * sequential loop did (unsent pushes simply retry next cycle).
   */
  async runPushPipeline(commits, onSettled) {
    if (commits.length === 0) return;
    let next = 0;
    let failure = null;
    const slots = Math.min(this.pushConcurrency, commits.length);
    const worker = async () => {
      while (next < commits.length) {
        if (failure !== null) return;
        const commit = commits[next++];
        try {
          await this.sendCommit(commit);
        } catch (error) {
          failure != null ? failure : failure = error instanceof Error ? error : new Error(String(error));
          return;
        } finally {
          onSettled();
        }
      }
    };
    await Promise.all(Array.from({ length: slots }, worker));
    if (failure !== null) throw failure;
  }
  async sendCommit(commit) {
    const transport = this.transport;
    if (transport === null) throw new NetworkError("not connected");
    const message = {
      type: "commit",
      path: commit.path,
      parentVersion: commit.parentVersion,
      hash: commit.hash,
      size: commit.size,
      kind: commit.kind,
      ...commit.fromPath !== void 0 ? { fromPath: commit.fromPath } : {},
      ...commit.isFolder === true ? { isFolder: true } : {},
      ...commit.bytes !== void 0 && commit.bytes.byteLength <= INLINE_CONTENT_MAX_BYTES ? { inline: bytesToBase64(commit.bytes) } : {}
    };
    if (commit.bytes !== void 0 && commit.bytes.byteLength > INLINE_CONTENT_MAX_BYTES) {
      await this.uploadBlob(commit.hash, commit.bytes);
    }
    const reply = await this.request(
      (m) => m.type === "commitAck" || m.type === "conflict" || m.type === "error",
      () => transport.send(message)
    );
    if (reply.type === "error") throw this.toError(reply);
    if (reply.type === "commitAck") {
      validateCommitAckMessage(reply);
    } else {
      validateConflictMessage(reply);
    }
    await this.serializeAckApplication(async () => {
      if (reply.type === "commitAck") {
        if (reply.seq > this.cursor) this.cursor = reply.seq;
        this.applyAckToIndex(commit, reply.version, reply.clock);
        return;
      }
      await this.handleConflictReply(commit, reply);
    });
  }
  /** Chain one reply's index application after every previously-started one. */
  serializeAckApplication(apply) {
    const run = this.ackChain.then(apply, apply);
    this.ackChain = run.then(
      () => {
      },
      () => {
      }
    );
    return run;
  }
  applyAckToIndex(commit, versionId, clock) {
    const deleted = commit.kind === "delete";
    if (commit.kind === "rename" && commit.fromPath !== void 0) {
      this.index = applyCommit(removeEntry(this.index, commit.fromPath), {
        path: commit.path,
        versionId,
        hash: commit.hash,
        size: commit.size,
        clock,
        // A folder rename acks folder metadata at the destination, exactly
        // like every other ack kind (the entry must not lose its flag).
        ...commit.isFolder === true ? { isFolder: true } : {}
      });
      return;
    }
    this.index = applyCommit(this.index, {
      path: commit.path,
      versionId,
      hash: commit.hash,
      size: commit.size,
      clock,
      deleted,
      deletedAt: deleted ? this.now() : void 0,
      ...commit.isFolder === true ? { isFolder: true } : {},
      ...commit.mtime !== void 0 ? { mtime: commit.mtime } : {}
    });
  }
  async handleConflictReply(commit, reply) {
    if (reply.seq !== void 0 && reply.seq > this.cursor) this.cursor = reply.seq;
    const weWon = reply.winner.deviceId === this.options.deviceId && reply.winner.hash === commit.hash;
    if (weWon) {
      this.applyAckToIndex(commit, reply.winner.id, reply.winner.clock);
      return;
    }
    if (commit.kind !== "delete" && commit.kind !== "rename" && commit.isFolder !== true) {
      const local = await this.readLocal(commit.path);
      if (local !== void 0 && await sha256Hex(local) !== commit.hash) {
        this.scheduleReconcile();
        return;
      }
    }
    if (commit.kind === "rename" && commit.fromPath !== void 0) {
      this.index = applyCommit(this.index, {
        path: reply.winner.path,
        versionId: reply.winner.id,
        hash: reply.winner.hash,
        size: reply.winner.size,
        clock: reply.winner.clock,
        ...reply.winner.isFolder === true ? { isFolder: true } : {}
      });
      return;
    }
    this.index = await this.applyPulls([this.winnerAsPull(reply.winner)]);
  }
  /**
   * Turn an arbitrated winner version into a pull op (content ops only).
   * `isFolder` rides along when the server sent it (older servers omit the
   * flag): a folder-placeholder winner must materialize as an `ensureDir`, not
   * as a content fetch for its empty hash — which the blob guard refuses,
   * wedging every future cycle on the same conflict.
   */
  winnerAsPull(winner) {
    const entry = this.index[winner.path];
    const deleted = winner.kind === "delete";
    const kind = deleted ? "delete" : entry === void 0 ? "add" : entry.deletedAt !== void 0 ? "restore" : "edit";
    return {
      kind,
      path: winner.path,
      hash: winner.hash,
      size: winner.size,
      version: winner.id,
      clock: winner.clock,
      deleted,
      ...winner.isFolder === true ? { isFolder: true } : {}
    };
  }
  async uploadBlob(hash, bytes) {
    const transport = this.transport;
    if (transport === null) throw new NetworkError("not connected");
    const reply = await this.request(
      (m) => m.type === "blobAck" || m.type === "error",
      () => transport.send({ type: "putBlob", hash, content: bytesToBase64(bytes) })
    );
    if (reply.type === "error") throw this.toError(reply);
    await this.options.blobStore.put(hash, bytes);
  }
  async downloadBlob(hash) {
    const transport = this.transport;
    if (transport === null) throw new NetworkError("not connected");
    const reply = await this.request(
      (m) => m.type === "blob" && m.hash === hash || m.type === "error",
      () => transport.send({ type: "getBlob", hash })
    );
    if (reply.type === "error") throw this.toError(reply);
    const bytes = base64ToBytes(reply.content);
    if (await sha256Hex(bytes) !== hash) {
      throw new ProtocolError(`blob ${hash} failed verification on download`);
    }
    return bytes;
  }
  // --- snapshots -----------------------------------------------------------------------
  /**
   * Snapshot every file head on the authority (a whole-vault restore point).
   * Snapshots are not broadcast — other devices see nothing live.
   */
  async createSnapshot(name) {
    const transport = this.transport;
    if (transport === null) throw new NetworkError("not connected");
    const reply = await this.request(
      (m) => m.type === "snapshotCreateAck" || m.type === "error",
      () => transport.send({ type: "snapshotCreate", ...name !== void 0 ? { name } : {} })
    );
    if (reply.type === "error") throw this.toError(reply);
    return reply;
  }
  /**
   * Restore the whole vault to a snapshot. The server lands every reverted
   * head as a NEW version (history is never deleted) and fans the changes out
   * to OTHER sockets only — this device does not receive its own fan-out, so
   * the local index must re-converge from a FULL manifest: flag delta mode
   * off, then run a cycle inline (one-shot callers close the transport as
   * soon as this resolves, so a debounced cycle would never fire).
   */
  async restoreSnapshot(id) {
    const transport = this.transport;
    if (transport === null) throw new NetworkError("not connected");
    const reply = await this.request(
      (m) => m.type === "snapshotRestoreAck" || m.type === "error",
      () => transport.send({ type: "snapshotRestore", id })
    );
    if (reply.type === "error") throw this.toError(reply);
    this.needsFullManifest = true;
    await this.enqueue(() => this.runCycle());
    return reply;
  }
  // --- plumbing -------------------------------------------------------------------------------
  request(matches, send) {
    return new Promise((resolve, reject) => {
      const expectation = {
        matches: (message) => matches(message),
        resolve: (message) => resolve(message),
        reject
      };
      this.expectations.push(expectation);
      try {
        send();
      } catch (error) {
        const index = this.expectations.indexOf(expectation);
        if (index >= 0) this.expectations.splice(index, 1);
        reject(error instanceof Error ? error : new NetworkError(String(error)));
      }
    });
  }
  toError(message) {
    switch (message.code) {
      case "UNAUTHORIZED":
        return new UnauthorizedError(message.message);
      case "REVOKED":
        return new RevokedError(message.message);
      default:
        return new ProtocolError(message.message);
    }
  }
  enqueue(operation) {
    this.queuedOps += 1;
    const run = this.tail.then(operation, operation);
    const settled = run.then(
      () => {
        this.queuedOps -= 1;
        this.persistIndex();
      },
      (error) => {
        this.queuedOps -= 1;
        this.persistIndex();
        throw error;
      }
    );
    this.tail = settled.then(
      () => {
      },
      () => {
      }
    );
    return settled;
  }
  persistIndex() {
    const snapshot = serializeLocalIndex(this.index, this.persistedState());
    void this.options.storage.writeFile(LOCAL_INDEX_STATE_PATH, new TextEncoder().encode(snapshot)).catch((error) => this.log.warn("failed to persist local index", error));
  }
};
function pullTargets(pull) {
  return pull.kind === "rename" ? [pull.fromPath, pull.toPath] : [pull.path];
}
function firstUnsafePath(paths) {
  return paths.find((path) => isWindowsUnsafePath(path));
}

// ../core/src/compat.ts
var MIN_SUPPORTED_SERVER_VERSION = "0.1.0";
function parseSemVer(raw) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    raw.trim()
  );
  if (match === null) return null;
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) };
}
function compareSemVer(a, b) {
  if (a.major !== b.major) return a.major < b.major ? -1 : 1;
  if (a.minor !== b.minor) return a.minor < b.minor ? -1 : 1;
  if (a.patch !== b.patch) return a.patch < b.patch ? -1 : 1;
  return 0;
}
function checkServerCompatibility(clientVersion, serverVersion) {
  if (serverVersion === null || serverVersion === void 0 || serverVersion === "") {
    return {
      level: "warn",
      message: "sync server predates version reporting (\u2264 0.1) \u2014 consider updating it (docs/UPGRADING.md)"
    };
  }
  const server = parseSemVer(serverVersion);
  if (server === null) {
    return {
      level: "warn",
      message: `server version ${JSON.stringify(serverVersion)} is not semver \u2014 compatibility unknown`
    };
  }
  const client = parseSemVer(clientVersion);
  if (client !== null && (server.major > client.major || server.minor > client.minor)) {
    return {
      level: "warn",
      message: `server ${serverVersion} is newer than this client (${clientVersion}) \u2014 update the client when convenient`
    };
  }
  const minimum = parseSemVer(MIN_SUPPORTED_SERVER_VERSION);
  if (minimum !== null && compareSemVer(server, minimum) < 0) {
    return {
      level: "error",
      message: `server ${serverVersion} is older than the minimum supported (${MIN_SUPPORTED_SERVER_VERSION}) \u2014 update it: docs/UPGRADING.md`
    };
  }
  return { level: "ok", message: `server ${serverVersion} works with this client (${clientVersion})` };
}

// src/adapters/obsidian-storage.ts
var TEMP_DIR_VAULT_PATH = "/.vaultsyncforagents/tmp";
var ObsidianStorageAdapter = class {
  constructor(options) {
    __publicField(this, "adapter");
    __publicField(this, "removeEmptyDir");
    /**
     * Latched when a temp+rename attempt fails: every later write goes straight
     * to `writeBinary` instead of paying the failing-rename penalty again.
     */
    __publicField(this, "tempRenameBroken", false);
    __publicField(this, "tempCounter", 0);
    this.adapter = options.adapter;
    this.removeEmptyDir = options.removeEmptyDir;
  }
  // --- path mapping ----------------------------------------------------------
  /** Vault path → adapter path (`/a/b.md` → `a/b.md`, `/` → `/`). */
  toAdapterPath(vaultPath) {
    const normalized = normalizeVaultPath(vaultPath);
    return normalized === "/" ? "/" : normalized.slice(1);
  }
  // --- StorageAdapter ---------------------------------------------------------
  async readFile(path) {
    const buffer = await this.adapter.readBinary(this.toAdapterPath(path));
    return new Uint8Array(buffer);
  }
  async writeFile(path, data) {
    const target = this.toAdapterPath(path);
    await this.ensureParentDirs(target);
    const buffer = new ArrayBuffer(data.byteLength);
    new Uint8Array(buffer).set(data);
    if (this.tempRenameBroken) {
      await this.adapter.writeBinary(target, buffer);
      return;
    }
    const temp = await this.tempPath();
    try {
      await this.adapter.writeBinary(temp, buffer);
      await this.adapter.rename(temp, target);
    } catch (e) {
      await this.silentRemove(temp);
      this.tempRenameBroken = true;
      await this.adapter.writeBinary(target, buffer);
    }
  }
  async deleteFile(path) {
    const target = this.toAdapterPath(path);
    if (!await this.adapter.exists(target)) return;
    try {
      await this.adapter.remove(target);
    } catch (e) {
      if (await this.adapter.exists(target)) throw new Error(`failed to delete ${target}`);
    }
  }
  async renameFile(from, to) {
    const fromPath = this.toAdapterPath(from);
    const toPath = this.toAdapterPath(to);
    await this.ensureParentDirs(toPath);
    await this.adapter.rename(fromPath, toPath);
  }
  async listFiles() {
    const files = [];
    await this.walkFiles("/", async (adapterPath) => {
      const stat = await this.statOrNull(adapterPath);
      if (stat === null) return;
      files.push({
        path: `/${adapterPath}`,
        size: stat.size,
        mtime: stat.mtime
      });
    });
    files.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    return files;
  }
  async listDirs() {
    const dirs = ["/"];
    await this.walkFolders("/", async (adapterPath) => {
      dirs.push(`/${adapterPath}`);
    });
    dirs.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
    return dirs;
  }
  async ensureDir(path) {
    const normalized = normalizeVaultPath(path);
    const segments = normalized === "/" ? [] : normalized.slice(1).split("/");
    let current = "";
    for (const segment of segments) {
      current = current === "" ? segment : `${current}/${segment}`;
      if (!await this.adapter.exists(current)) await this.adapter.mkdir(current);
    }
  }
  /**
   * Remove an EMPTY directory (the `StorageAdapter.removeDir` contract).
   * Prefers the vault-API callback (`removeEmptyDir` — see the option's doc
   * for why `DataAdapter.rmdir` cannot do this); falls back to `rmdir` for
   * bare adapters (tests). Missing path ⇒ no-op (idempotent); the vault root
   * is never removable; a non-empty refusal propagates (core treats it as
   * record-only — never data loss).
   */
  async removeDir(path) {
    const normalized = normalizeVaultPath(path);
    if (normalized === "/") return;
    const target = this.toAdapterPath(normalized);
    if (!await this.adapter.exists(target)) return;
    if (this.removeEmptyDir !== void 0) {
      await this.removeEmptyDir(target);
      return;
    }
    await this.adapter.rmdir(target, false);
  }
  async exists(path) {
    const normalized = normalizeVaultPath(path);
    if (normalized === "/") return true;
    try {
      return await this.adapter.exists(this.toAdapterPath(normalized));
    } catch (e) {
      return false;
    }
  }
  // --- helpers ----------------------------------------------------------------
  async statOrNull(adapterPath) {
    try {
      const stat = await this.adapter.stat(adapterPath);
      if (stat === null || stat.type !== "file") return null;
      return { size: stat.size, mtime: stat.mtime };
    } catch (e) {
      return null;
    }
  }
  /** A unique temp path inside the (sync-ignored) client state dir. */
  async tempPath() {
    await this.ensureDir(TEMP_DIR_VAULT_PATH);
    this.tempCounter += 1;
    return `${TEMP_DIR_VAULT_PATH.slice(1)}/w-${Date.now().toString(36)}-${this.tempCounter}.tmp`;
  }
  async silentRemove(adapterPath) {
    try {
      await this.adapter.remove(adapterPath);
    } catch (e) {
    }
  }
  /** Create every ancestor directory of an adapter file path. */
  async ensureParentDirs(adapterPath) {
    const slash = adapterPath.lastIndexOf("/");
    if (slash <= 0) return;
    const parent = adapterPath.slice(0, slash);
    await this.ensureDir(`/${parent}`);
  }
  /** Recursively visit every file under `dirAdapterPath` (adapter paths). */
  async walkFiles(dirAdapterPath, visit) {
    let listing;
    try {
      listing = await this.adapter.list(dirAdapterPath);
    } catch (e) {
      return;
    }
    for (const file of listing.files) await visit(file);
    for (const folder of listing.folders) await this.walkFiles(folder, visit);
  }
  /** Recursively visit every folder under `dirAdapterPath` (adapter paths). */
  async walkFolders(dirAdapterPath, visit) {
    let listing;
    try {
      listing = await this.adapter.list(dirAdapterPath);
    } catch (e) {
      return;
    }
    for (const folder of listing.folders) {
      await visit(folder);
      await this.walkFolders(folder, visit);
    }
  }
};

// src/adapters/obsidian-watch.ts
var ObsidianWatchAdapter = class {
  constructor(options) {
    __publicField(this, "vault");
    __publicField(this, "refs", []);
    __publicField(this, "emit", null);
    this.vault = options.vault;
  }
  start(cb) {
    this.stop();
    this.emit = cb;
    this.refs = [
      this.vault.on("create", (file) => {
        this.forward({ kind: "add", path: vaultPathOf(file) });
      }),
      this.vault.on("modify", (file) => {
        this.forward({ kind: "modify", path: vaultPathOf(file) });
      }),
      this.vault.on("delete", (file) => {
        this.forward({ kind: "delete", path: vaultPathOf(file) });
      }),
      this.vault.on("rename", (file, oldPath) => {
        this.forward({ kind: "rename", path: `/${oldPath}`, toPath: vaultPathOf(file) });
      })
    ];
  }
  stop() {
    for (const ref of this.refs) this.vault.offref(ref);
    this.refs = [];
    this.emit = null;
  }
  forward(event) {
    var _a;
    (_a = this.emit) == null ? void 0 : _a.call(this, [event]);
  }
};
function vaultPathOf(file) {
  return file.path.startsWith("/") ? file.path : `/${file.path}`;
}
var RescanScheduler = class {
  constructor(options) {
    __publicField(this, "pokeDelayMs");
    __publicField(this, "setIntervalImpl");
    __publicField(this, "clearIntervalImpl");
    __publicField(this, "setTimeoutImpl");
    __publicField(this, "clearTimeoutImpl");
    __publicField(this, "run", null);
    __publicField(this, "intervalHandle", null);
    __publicField(this, "intervalMs");
    __publicField(this, "pokeHandle", null);
    var _a, _b, _c, _d, _e;
    this.intervalMs = options.intervalMs;
    this.pokeDelayMs = (_a = options.pokeDelayMs) != null ? _a : 3e3;
    this.setIntervalImpl = (_b = options.setIntervalImpl) != null ? _b : ((fn, ms) => setInterval(fn, ms));
    this.clearIntervalImpl = (_c = options.clearIntervalImpl) != null ? _c : ((handle) => clearInterval(handle));
    this.setTimeoutImpl = (_d = options.setTimeoutImpl) != null ? _d : ((fn, ms) => setTimeout(fn, ms));
    this.clearTimeoutImpl = (_e = options.clearTimeoutImpl) != null ? _e : ((handle) => clearTimeout(handle));
  }
  /** Begin periodic rescans; `run` must be safe to call at any time. */
  start(run) {
    this.stop();
    this.run = run;
    this.armInterval();
  }
  stop() {
    this.clearIntervalImplKeep();
    if (this.pokeHandle !== null) {
      this.clearTimeoutImpl(this.pokeHandle);
      this.pokeHandle = null;
    }
    this.run = null;
  }
  /** Change the periodic interval live (the settings-tab toggle). */
  setIntervalMs(ms) {
    this.intervalMs = ms;
    if (this.run !== null) {
      this.clearIntervalImplKeep();
      this.armInterval();
    }
  }
  /** A focus/app-switch signal (active-leaf-change): rescan soon, coalesced. */
  poke() {
    if (this.run === null) return;
    if (this.pokeHandle !== null) return;
    this.pokeHandle = this.setTimeoutImpl(() => {
      var _a;
      this.pokeHandle = null;
      (_a = this.run) == null ? void 0 : _a.call(this);
    }, this.pokeDelayMs);
  }
  get intervalMsValue() {
    return this.intervalMs;
  }
  armInterval() {
    if (this.intervalMs <= 0 || this.run === null) return;
    this.intervalHandle = this.setIntervalImpl(() => {
      var _a;
      return (_a = this.run) == null ? void 0 : _a.call(this);
    }, this.intervalMs);
  }
  clearIntervalImplKeep() {
    if (this.intervalHandle !== null) {
      this.clearIntervalImpl(this.intervalHandle);
      this.intervalHandle = null;
    }
  }
};

// src/blobstore.ts
var HttpBlobError = class extends Error {
  constructor(status, message) {
    super(message);
    __publicField(this, "status", status);
    this.name = "HttpBlobError";
  }
};
var HttpBlobStore = class {
  constructor(options) {
    __publicField(this, "base");
    __publicField(this, "token");
    __publicField(this, "doFetch");
    var _a;
    this.base = options.baseUrl.replace(/\/+$/, "");
    this.token = options.token;
    this.doFetch = (_a = options.fetchImpl) != null ? _a : globalThis.fetch.bind(globalThis);
  }
  /** GET /blob/:hash → bytes, or `undefined` on 404. */
  async get(hash) {
    const response = await this.doFetch(`${this.base}/blob/${hash}`, {
      headers: { authorization: `Bearer ${this.token}` }
    });
    if (response.status === 404) return void 0;
    if (!response.ok) {
      throw new HttpBlobError(response.status, await errorMessage(response, "fetch blob"));
    }
    return new Uint8Array(await response.arrayBuffer());
  }
  /** PUT /blob/:hash — idempotent per the CAS contract. */
  async put(hash, bytes) {
    const response = await this.doFetch(`${this.base}/blob/${hash}`, {
      method: "PUT",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/octet-stream"
      },
      body: bytes
    });
    if (!response.ok) {
      throw new HttpBlobError(response.status, await errorMessage(response, "store blob"));
    }
  }
};
async function errorMessage(response, what) {
  const detail = (await response.text().catch(() => "")).slice(0, 300);
  return detail === "" ? `failed to ${what}: HTTP ${response.status}` : `failed to ${what}: HTTP ${response.status}: ${detail}`;
}

// src/diagnostics.ts
var import_obsidian = require("obsidian");
var LEVEL_RANK = { debug: 10, info: 20, warn: 30, error: 40 };
var RING_CAPACITY = 20;
var ARG_MAX_CHARS = 300;
function createPluginLog(options = {}) {
  var _a, _b, _c;
  const capacity = (_a = options.capacity) != null ? _a : RING_CAPACITY;
  const now = (_b = options.now) != null ? _b : (() => Date.now());
  let level = (_c = options.level) != null ? _c : "info";
  let ring = [];
  const write = (severity, args) => {
    if (LEVEL_RANK[severity] < LEVEL_RANK[level]) return;
    const line = `${new Date(now()).toISOString()} [${severity}] ${args.map(fmt).join(" ")}`;
    ring.push(line);
    if (ring.length > capacity) ring = ring.slice(ring.length - capacity);
    const sink = severity === "error" ? console.error : severity === "warn" ? console.warn : console.log;
    sink("[vsa]", ...args);
  };
  return {
    debug: (...args) => write("debug", args),
    info: (...args) => write("info", args),
    warn: (...args) => write("warn", args),
    error: (...args) => write("error", args),
    setLevel(next) {
      level = next;
    },
    getLevel() {
      return level;
    },
    get debugEnabled() {
      return level === "debug";
    },
    recentLines() {
      return [...ring];
    }
  };
}
function fmt(value) {
  var _a;
  if (typeof value === "string") return truncate(value);
  if (value instanceof Error) return truncate(`${value.name}: ${value.message}`);
  try {
    return truncate((_a = JSON.stringify(value)) != null ? _a : String(value));
  } catch (e) {
    return String(value);
  }
}
function truncate(text) {
  return text.length <= ARG_MAX_CHARS ? text : `${text.slice(0, ARG_MAX_CHARS - 1)}\u2026`;
}
function describeMessage(message) {
  const bits = [message.type];
  if (message.fromPath !== void 0) bits.push(`${message.fromPath} \u2192`);
  if (message.path !== void 0) bits.push(message.path);
  if (message.hash !== void 0) bits.push(message.hash.slice(0, 12));
  if (message.seq !== void 0) bits.push(`seq ${message.seq}`);
  if (message.cursor !== void 0) bits.push(`cursor ${message.cursor}`);
  return bits.join(" ");
}
function withRoundTripLogging(transport, options) {
  const { log, shouldLog } = options;
  return {
    send: (message) => {
      if (shouldLog()) log.debug("\u2192", describeMessage(message));
      transport.send(message);
    },
    onMessage: (callback) => {
      transport.onMessage((message) => {
        if (shouldLog()) log.debug("\u2190", describeMessage(message));
        callback(message);
      });
    },
    onClose: (callback) => transport.onClose(callback),
    close: () => transport.close()
  };
}
var PROTOCOL_VERSION = ProtocolVersion;
function buildDiagnosticsBundle(input) {
  const status = input.clientStatus;
  const lines = [
    "VaultSync for Agents \u2014 diagnostics",
    `Plugin version: ${input.pluginVersion}`,
    `Protocol version: ${ProtocolVersion}`,
    `Device: ${input.deviceId || "(unassigned)"}${input.deviceName ? ` (${input.deviceName})` : ""}`,
    `Worker: ${input.workerUrl || "(not configured)"}`,
    `Pairing: ${input.paired ? "paired" : "not paired"}`,
    input.paused ? "Sync: paused" : status === null ? "Sync: not running" : `Sync: ${status.state}, last sync ${status.lastSyncAt === null ? "never" : `${Math.max(0, Date.now() - status.lastSyncAt)}ms ago`}, pending ${status.pending}, conflicts ${status.conflicts.length}`,
    `Platform: ${platformSummary()}`,
    `Recent log (last ${input.recentLogLines.length} lines):`
  ];
  if (input.recentLogLines.length === 0) {
    lines.push("  (no recorded log lines)");
  } else {
    for (const line of input.recentLogLines) lines.push(`  ${line}`);
  }
  return lines.join("\n");
}
function formatSupportBundleStamp(now) {
  const d = new Date(now);
  const two = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${two(d.getMonth() + 1)}${two(d.getDate())}-${two(d.getHours())}${two(d.getMinutes())}${two(d.getSeconds())}`;
}
var onOff = (value) => value ? "on" : "off";
function buildSupportBundle(input, now) {
  var _a, _b, _c, _d, _e;
  const status = input.clientStatus;
  const conflictPaths = (_c = (_b = (_a = input.recentConflicts) == null ? void 0 : _a.map((c) => c.path)) != null ? _b : status == null ? void 0 : status.conflicts.map((c) => c.path)) != null ? _c : [];
  const lines = [
    "# VaultSync for Agents \u2014 support bundle",
    "",
    `Generated: ${new Date(now).toISOString()}`,
    "",
    "## Versions",
    "",
    `- Plugin: ${input.pluginVersion}`,
    `- Protocol: ${ProtocolVersion}`,
    `- Server: ${(_d = input.serverVersion) != null ? _d : "unknown"}`,
    `- Platform: ${platformSummary()}`,
    "",
    "## Connection",
    "",
    `- Worker URL: ${input.workerUrl || "(not configured)"}`,
    `- Device ID: ${input.deviceId || "(unassigned)"}`,
    `- Device name: ${input.deviceName || "(default)"}`,
    `- Pairing: ${input.paired ? "paired" : "not paired"}`,
    `- Syncing: ${input.paused ? "paused" : "active"}`
  ];
  if (input.settings !== void 0) {
    const { settings } = input;
    const patterns = settings.ignorePatterns.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "");
    lines.push("", "## Settings", "", `- Rescan interval: ${settings.rescanIntervalSec === 0 ? "off" : `${settings.rescanIntervalSec} seconds`}`, `- Sync .obsidian/ folder: ${onOff(settings.obsidianSync)}`, `- Status bar indicator: ${settings.statusBarMode}`, `- Sync on startup: ${onOff(settings.syncOnStartup)}`, `- Diagnostics log level: ${settings.logLevel}`);
    if (patterns.length === 0) {
      lines.push("- Ignore patterns: (none)");
    } else {
      lines.push("- Ignore patterns:");
      for (const pattern of patterns) lines.push(`  ${pattern}`);
    }
  }
  lines.push("", "## Sync state", "");
  if (input.paused) lines.push("- State: paused");
  else if (status === null) lines.push("- State: not running");
  else lines.push(`- State: ${status.state}`);
  if (status !== null) {
    lines.push(
      `- Last sync: ${status.lastSyncAt === null ? "never" : new Date(status.lastSyncAt).toISOString()}`,
      `- Pending changes: ${status.pending}`,
      `- Conflicts: ${conflictPaths.length}`
    );
    for (const path of conflictPaths) lines.push(`  - ${path}`);
    const collisions = (_e = status.caseCollisions) != null ? _e : [];
    if (collisions.length > 0) {
      lines.push(`- Case-colliding paths (invisible twin on this filesystem): ${collisions.length}`);
      for (const path of collisions) lines.push(`  - ${path}`);
    }
    if (status.progress !== void 0) {
      lines.push(`- Progress: ${status.progress.phase} ${status.progress.done}/${status.progress.total}`);
    }
  }
  lines.push("", `## Recent log (last ${input.recentLogLines.length} lines)`, "");
  if (input.recentLogLines.length === 0) {
    lines.push("(no recorded log lines)");
  } else {
    lines.push("```text");
    lines.push(...input.recentLogLines);
    lines.push("```");
  }
  return `${lines.join("\n")}
`;
}
function platformSummary() {
  if (import_obsidian.Platform.isMobileApp) {
    const os = import_obsidian.Platform.isIosApp ? "iOS" : import_obsidian.Platform.isAndroidApp ? "Android" : "unknown OS";
    const factor = import_obsidian.Platform.isTablet ? "tablet" : import_obsidian.Platform.isPhone ? "phone" : "device";
    return `Obsidian mobile app (${os}, ${factor})`;
  }
  return "Obsidian desktop app";
}
async function copyToClipboard(text) {
  var _a;
  const clipboard = (_a = globalThis.navigator) == null ? void 0 : _a.clipboard;
  if ((clipboard == null ? void 0 : clipboard.writeText) === void 0) return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch (e) {
    return false;
  }
}
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = -1;
  do {
    value /= 1024;
    unit += 1;
  } while (value >= 1024 && unit < units.length - 1);
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

// src/data.ts
var import_obsidian2 = require("obsidian");
var DEFAULT_RESCAN_INTERVAL_SEC = 30;
var RESCAN_INTERVAL_CHOICES = [
  { value: 10, label: "Every 10 seconds" },
  { value: 30, label: "Every 30 seconds" },
  { value: 60, label: "Every minute" },
  { value: 300, label: "Every 5 minutes" },
  { value: 0, label: "Off (vault events only)" }
];
function defaultPluginData() {
  return {
    url: "",
    token: "",
    deviceId: "",
    deviceName: "",
    settings: {
      rescanIntervalSec: DEFAULT_RESCAN_INTERVAL_SEC,
      obsidianSync: false,
      statusBarMode: "detailed",
      syncOnStartup: true,
      logLevel: "info",
      ignorePatterns: ""
    }
  };
}
function normalizePluginData(raw) {
  var _a, _b, _c, _d, _e, _f;
  const base = defaultPluginData();
  if (typeof raw !== "object" || raw === null) return base;
  const source = raw;
  const statusBarMode = (_a = source.settings) == null ? void 0 : _a.statusBarMode;
  const logLevel = (_b = source.settings) == null ? void 0 : _b.logLevel;
  return {
    url: typeof source.url === "string" ? source.url : "",
    token: typeof source.token === "string" ? source.token : "",
    deviceId: typeof source.deviceId === "string" ? source.deviceId : "",
    deviceName: typeof source.deviceName === "string" ? source.deviceName : "",
    settings: {
      rescanIntervalSec: typeof ((_c = source.settings) == null ? void 0 : _c.rescanIntervalSec) === "number" && source.settings.rescanIntervalSec >= 0 ? Math.floor(source.settings.rescanIntervalSec) : DEFAULT_RESCAN_INTERVAL_SEC,
      obsidianSync: ((_d = source.settings) == null ? void 0 : _d.obsidianSync) === true,
      statusBarMode: statusBarMode === "compact" || statusBarMode === "hidden" ? statusBarMode : "detailed",
      syncOnStartup: ((_e = source.settings) == null ? void 0 : _e.syncOnStartup) !== false,
      logLevel: logLevel === "debug" || logLevel === "warn" ? logLevel : "info",
      ignorePatterns: typeof ((_f = source.settings) == null ? void 0 : _f.ignorePatterns) === "string" ? source.settings.ignorePatterns : ""
    }
  };
}
function parseIgnorePatterns(text) {
  return text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line !== "");
}
function isLinked(data) {
  return data.url !== "" && data.token !== "" && data.deviceId !== "";
}
function detectDeviceType() {
  return import_obsidian2.Platform.isMobileApp ? "mobile" : "desktop";
}
function defaultDeviceName() {
  if (import_obsidian2.Platform.isMobileApp) {
    if (import_obsidian2.Platform.isIosApp) return "iPhone/iPad";
    if (import_obsidian2.Platform.isAndroidApp) return "Android";
    return "Obsidian mobile";
  }
  return "Obsidian desktop";
}

// src/workerapi.ts
var WorkerApiError = class extends Error {
  constructor(message, status) {
    super(message);
    __publicField(this, "status", status);
    this.name = "WorkerApiError";
  }
};
var PairRejectedError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "PairRejectedError";
  }
};
var UnclaimedWorkerError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "UnclaimedWorkerError";
  }
};
function normalizeWorkerUrl(input) {
  let candidate = input.trim();
  if (candidate === "") throw new WorkerApiError("worker URL is empty");
  if (!/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(candidate)) candidate = `https://${candidate}`;
  let origin;
  try {
    origin = new URL(candidate).origin;
  } catch (e) {
    throw new WorkerApiError(`invalid worker URL: ${JSON.stringify(input)}`);
  }
  if (!origin.startsWith("http://") && !origin.startsWith("https://")) {
    throw new WorkerApiError(`worker URL must be http(s), got ${origin}`);
  }
  return origin;
}
async function fetchHealth(origin, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(`${origin}/health`);
  } catch (error) {
    return {
      reachable: false,
      claimed: false,
      reason: error instanceof Error ? error.message : String(error)
    };
  }
  if (!response.ok) {
    return { reachable: false, claimed: false, reason: `HTTP ${response.status}` };
  }
  const body = await response.json().catch(() => ({}));
  return { reachable: true, claimed: body.claimed === true };
}
async function requestPair(params) {
  let response;
  try {
    response = await params.fetchImpl(`${params.origin}/pair`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        code: params.code,
        deviceName: params.deviceName,
        deviceType: params.deviceType
      })
    });
  } catch (error) {
    throw new WorkerApiError(
      `could not reach the worker at ${params.origin}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  const detail = (await response.text().catch(() => "")).trim();
  if (response.status === 421) {
    throw new UnclaimedWorkerError("this worker has not been claimed yet");
  }
  if (response.status === 401 || response.status === 403) {
    throw new PairRejectedError(
      "pairing code rejected \u2014 codes are one-time, expire after 10 minutes, and come from the worker dashboard. Generate a fresh one and retry."
    );
  }
  if (!response.ok) {
    throw new WorkerApiError(
      `pairing failed: HTTP ${response.status} ${detail.slice(0, 200)}`.trim(),
      response.status
    );
  }
  let body;
  try {
    body = JSON.parse(detail);
  } catch (e) {
    throw new WorkerApiError("pairing reply was not JSON", response.status);
  }
  if (typeof body.token !== "string" || typeof body.deviceId !== "string") {
    throw new WorkerApiError("pairing reply was missing token/deviceId", response.status);
  }
  return { token: body.token, deviceId: body.deviceId };
}
async function renameDevice(params) {
  let response;
  try {
    response = await params.fetchImpl(`${params.origin}/device`, {
      method: "PATCH",
      headers: { "content-type": "application/json", authorization: `Bearer ${params.token}` },
      body: JSON.stringify({ name: params.name })
    });
  } catch (error) {
    return {
      ok: false,
      error: `could not reach the worker at ${params.origin}: ${error instanceof Error ? error.message : String(error)}`
    };
  }
  const detail = (await response.text().catch(() => "")).trim();
  if (response.status === 421) {
    return { ok: false, error: "this worker has not been claimed yet" };
  }
  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      error: "the worker rejected this device\u2019s token (revoked?) \u2014 unlink and re-pair with a fresh code."
    };
  }
  if (!response.ok) {
    let reason = `HTTP ${response.status}`;
    try {
      const parsed = JSON.parse(detail);
      if (typeof parsed.error === "string") reason = parsed.error;
    } catch (e) {
    }
    return { ok: false, error: reason };
  }
  let body;
  try {
    body = JSON.parse(detail);
  } catch (e) {
    return { ok: false, error: "rename reply was not JSON" };
  }
  const device = body.device;
  if (typeof (device == null ? void 0 : device.id) !== "string" || typeof device.name !== "string" || typeof device.type !== "string") {
    return { ok: false, error: "rename reply was missing the device document" };
  }
  return { ok: true, device: { id: device.id, name: device.name, type: device.type } };
}
async function fetchWorkerStatus(params) {
  let response;
  try {
    response = await params.fetchImpl(`${params.origin}/api/status`, {
      headers: { authorization: `Bearer ${params.token}` }
    });
  } catch (e) {
    return null;
  }
  if (!response.ok) return null;
  const body = await response.json().catch(() => null);
  if (body === null || typeof body.storageBytes !== "number" || typeof body.attachments !== "object") {
    return null;
  }
  return {
    vaultName: typeof body.vaultName === "string" ? body.vaultName : "",
    devices: Array.isArray(body.devices) ? body.devices : [],
    attachments: body.attachments,
    storageBytes: body.storageBytes,
    ...typeof body.serverVersion === "string" ? { serverVersion: body.serverVersion } : {}
  };
}

// src/pairing.ts
function unclaimedGuidance(url) {
  return [
    `The worker at ${url} is deployed but not claimed yet. Finish setup in a browser:`,
    "",
    `1. Open ${url}`,
    "2. Set the admin passphrase and name the vault (the claim page).",
    "3. On the dashboard, create a pairing code (Devices \u2192 Pair new device).",
    "4. Enter that code here (or click the obsidian:// link the dashboard shows) and pair."
  ].join("\n");
}
async function pairWithWorker(params) {
  var _a;
  let origin;
  try {
    origin = normalizeWorkerUrl(params.url);
  } catch (e) {
    return { status: "invalid-url", input: params.url };
  }
  const health = await fetchHealth(origin, params.fetchImpl);
  if (!health.reachable) {
    return {
      status: "unreachable",
      url: origin,
      reason: `${(_a = health.reason) != null ? _a : "unknown error"} \u2014 check the URL, your network, and that the worker is deployed.`
    };
  }
  if (!health.claimed) {
    return { status: "unclaimed", url: origin, guidance: unclaimedGuidance(origin) };
  }
  try {
    const credentials = await requestPair({
      origin,
      code: params.code,
      deviceName: params.deviceName,
      deviceType: params.deviceType,
      fetchImpl: params.fetchImpl
    });
    return { status: "paired", url: origin, ...credentials };
  } catch (error) {
    if (error instanceof UnclaimedWorkerError) {
      return { status: "unclaimed", url: origin, guidance: unclaimedGuidance(origin) };
    }
    if (error instanceof PairRejectedError) {
      return { status: "rejected", url: origin, reason: error.message };
    }
    const reason = error instanceof Error ? error.message : String(error);
    return { status: "rejected", url: origin, reason };
  }
}
function pairOutcomeMessage(outcome) {
  switch (outcome.status) {
    case "paired":
      return `Paired with ${outcome.url} \u2014 syncing now.`;
    case "unclaimed":
      return outcome.guidance;
    case "unreachable":
      return `Could not reach the worker: ${outcome.reason}`;
    case "rejected":
      return `Pairing failed: ${outcome.reason}`;
    case "invalid-url":
      return `That does not look like a worker URL: ${JSON.stringify(outcome.input)}`;
  }
}

// src/protocol-handler.ts
var import_obsidian3 = require("obsidian");
var PROTOCOL_ACTION = "vaultsyncforagents";
function parsePairDeepLink(params) {
  const url = paramText(params, "url");
  const code = paramText(params, "code");
  if (url === "" && code === "") {
    return { ok: false, error: "no pairing parameters" };
  }
  if (url === "") return { ok: false, error: "deep link is missing the worker URL (?url=\u2026)" };
  if (code === "") return { ok: false, error: "deep link is missing the pairing code (?code=\u2026)" };
  return { ok: true, link: { url, code } };
}
function paramText(params, key) {
  const value = params[key];
  if (typeof value === "number") return String(value);
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (trimmed.includes("%")) {
    try {
      return decodeURIComponent(trimmed);
    } catch (e) {
      return trimmed;
    }
  }
  return trimmed;
}
function registerPairProtocolHandler(register, onPair) {
  const handler = (params) => {
    const parsed = parsePairDeepLink(params);
    if (!parsed.ok) {
      if (parsed.error !== "no pairing parameters") {
        new import_obsidian3.Notice(`VaultSync deep link: ${parsed.error}`);
      }
      return;
    }
    void onPair(parsed.link).catch((error) => {
      console.error("[vsa] deep-link pairing failed", error);
      new import_obsidian3.Notice("VaultSync: pairing via link failed \u2014 see the console for details.");
    });
  };
  register(PROTOCOL_ACTION, handler);
  register(`${PROTOCOL_ACTION}/pair`, handler);
}

// src/reconnect.ts
var DEFAULT_RECONNECT_BASE_MS = 1e3;
var DEFAULT_RECONNECT_CAP_MS = 6e4;
function backoffDelayMs(attempt, options = {}) {
  var _a, _b, _c, _d;
  const base = (_a = options.baseMs) != null ? _a : DEFAULT_RECONNECT_BASE_MS;
  const cap = (_b = options.capMs) != null ? _b : DEFAULT_RECONNECT_CAP_MS;
  const jitter = (_c = options.jitter) != null ? _c : 0.3;
  const random = (_d = options.random) != null ? _d : Math.random;
  const exponential = Math.min(cap, base * 2 ** attempt);
  const factor = 1 + (random() * 2 - 1) * jitter;
  return Math.round(Math.min(cap, Math.max(250, exponential * factor)));
}
var ReconnectSupervisor = class {
  constructor(options = {}) {
    __publicField(this, "attempt", 0);
    __publicField(this, "scheduled", false);
    __publicField(this, "options");
    this.options = options;
  }
  /** Call each tick; on `reconnect`, follow up with `acknowledged()`. */
  consider(state) {
    if (state !== "disconnected") {
      this.attempt = 0;
      this.scheduled = false;
      return { action: "wait" };
    }
    if (this.scheduled) return { action: "wait" };
    return { action: "reconnect", delayMs: backoffDelayMs(this.attempt, this.options) };
  }
  /** Mark the returned reconnect as in flight (one at a time). */
  acknowledged() {
    this.attempt += 1;
    this.scheduled = true;
  }
  /** The in-flight reconnect settled (success or failure). */
  settled() {
    this.scheduled = false;
  }
  /** Completed reconnect attempts since the last healthy state. */
  get attempts() {
    return this.attempt;
  }
};

// src/settings.ts
var import_obsidian4 = require("obsidian");

// src/statusbar.ts
function formatSince(elapsedMs) {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1e3));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}
function statusLineFor(status, now, mode = "detailed", paused = false) {
  if (paused) return "vsa \u23F8";
  const compact = mode === "compact";
  switch (status.state) {
    case "connecting":
    case "syncing": {
      const progress = status.progress;
      if (progress !== void 0) return `vsa \u22EF ${progress.done}/${progress.total}`;
      return "vsa \u22EF";
    }
    case "disconnected":
      return compact ? "vsa \u2717" : "vsa \u2717 offline";
    case "live":
      if (status.conflicts.length > 0) {
        return compact ? "vsa \u26A0" : `vsa \u26A0 conflicts: ${status.conflicts.length}`;
      }
      if (status.lastSyncAt === null || compact) return "vsa \u2713";
      return `vsa \u2713 ${formatSince(now - status.lastSyncAt)}`;
    case "idle":
      return "vsa";
  }
}
function statusTooltipFor(status, context, now) {
  const stateLabel = {
    idle: "not running",
    connecting: "connecting\u2026",
    syncing: "syncing\u2026",
    live: "live",
    disconnected: "offline \u2014 reconnecting"
  };
  const headline = context.paused === true ? "paused" : stateLabel[status.state];
  const lines = [`VaultSync for Agents \u2014 ${headline}`];
  if (context.url !== "") lines.push(`Worker: ${context.url}`);
  if (context.deviceName !== "") lines.push(`Device: ${context.deviceName}`);
  lines.push(
    status.lastSyncAt === null ? "Last sync: never" : `Last sync: ${formatSince(now - status.lastSyncAt)} ago`
  );
  if (status.progress !== void 0) {
    lines.push(`Syncing: ${status.progress.done}/${status.progress.total} (${status.progress.phase})`);
  }
  lines.push(`Pending changes: ${status.pending}`);
  lines.push(`Conflicts: ${status.conflicts.length}`);
  if (status.conflicts.length > 0) {
    lines.push(`Conflict copies: ${status.conflicts.map((c) => c.path).join(", ")}`);
  }
  if (context.note !== void 0 && context.note !== "") lines.push(context.note);
  return lines.join("\n");
}
function statusClassFor(status) {
  if (status.state === "disconnected") return "vsa-error";
  if (status.conflicts.length > 0) return "vsa-warn";
  return "";
}
var _StatusBarIndicator = class _StatusBarIndicator {
  constructor(item) {
    __publicField(this, "item", item);
  }
  update(status, context, now) {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i;
    this.item.textContent = statusLineFor(status, now, (_a = context.mode) != null ? _a : "detailed", context.paused === true);
    (_c = (_b = this.item).addClass) == null ? void 0 : _c.call(_b, _StatusBarIndicator.BASE_CLASS);
    const modifier = statusClassFor(status);
    for (const cls of _StatusBarIndicator.MODIFIER_CLASSES) {
      if (cls === modifier) (_e = (_d = this.item).addClass) == null ? void 0 : _e.call(_d, cls);
      else (_g = (_f = this.item).removeClass) == null ? void 0 : _g.call(_f, cls);
    }
    (_i = (_h = this.item).setAttribute) == null ? void 0 : _i.call(_h, "title", statusTooltipFor(status, context, now));
  }
};
/** Always on — the base class styles.css targets. */
__publicField(_StatusBarIndicator, "BASE_CLASS", "vsa-status");
__publicField(_StatusBarIndicator, "MODIFIER_CLASSES", ["vsa-warn", "vsa-error"]);
var StatusBarIndicator = _StatusBarIndicator;

// src/settings.ts
var DEPLOY_URL = "https://deploy.workers.cloudflare.com/?url=https://github.com/anuchin/vaultsyncforagents-template";
var PROJECT_README_URL = "https://github.com/anuchin/vaultsyncforagents#readme";
function openDeployPage() {
  if (typeof window === "undefined") return;
  window.open(DEPLOY_URL, "_blank");
}
function openReadmePage() {
  if (typeof window === "undefined") return;
  window.open(PROJECT_README_URL, "_blank");
}
var ConfirmModal = class extends import_obsidian4.Modal {
  constructor(app, options) {
    super(app);
    __publicField(this, "options", options);
  }
  onOpen() {
    new import_obsidian4.Setting(this.contentEl).setName(this.options.title).setDesc(this.options.body);
    new import_obsidian4.Setting(this.contentEl).addButton(
      (button) => button.setButtonText("Cancel").onClick(() => this.close())
    );
    new import_obsidian4.Setting(this.contentEl).addButton(
      (button) => button.setCta().setButtonText(this.options.confirmText).onClick(async () => {
        this.close();
        await this.options.onConfirm();
      })
    );
  }
};
var VaultSyncSettingTab = class extends import_obsidian4.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    __publicField(this, "plugin");
    /** Pairing codes never touch disk — they are one-time, short-lived secrets. */
    __publicField(this, "pairingCode", "");
    /**
     * Linked-mode device-name draft: edits stage here (NOT in plugin data) so a
     * failed rename cannot leave the local name out of sync with the worker.
     */
    __publicField(this, "renameDraft", null);
    __publicField(this, "hintSetting", null);
    __publicField(this, "statusSetting", null);
    __publicField(this, "storageSetting", null);
    __publicField(this, "serverVersionSetting", null);
    __publicField(this, "refreshHandle", null);
    this.plugin = plugin;
  }
  display() {
    this.stopRefresh();
    const { containerEl } = this;
    containerEl.empty();
    this.hintSetting = null;
    this.statusSetting = null;
    this.storageSetting = null;
    this.serverVersionSetting = null;
    this.renameDraft = null;
    this.renderConnectionSection();
    this.renderSyncSection();
    this.renderAdvancedSection();
    this.renderAboutSection();
    this.startRefresh();
  }
  hide() {
    this.stopRefresh();
  }
  // --- sections -----------------------------------------------------------------
  heading(text) {
    new import_obsidian4.Setting(this.containerEl).setName(text).setHeading();
  }
  renderConnectionSection() {
    const { containerEl } = this;
    this.heading("Connection");
    new import_obsidian4.Setting(containerEl).setName("Worker URL").setDesc(
      'Your sync worker, e.g. https://personal.x.workers.dev. No worker yet? Use "Deploy your worker" below, open the URL in a browser, and claim it.'
    ).addText(
      (text) => text.setPlaceholder("https://personal.x.workers.dev").setValue(this.plugin.data.url).onChange(async (value) => {
        this.plugin.data.url = value.trim();
        await this.plugin.savePluginData();
      })
    );
    if (this.plugin.linked) {
      this.renderLinkedDeviceName();
      this.renderLinkedStatus();
    } else {
      this.renderPairingDeviceName();
      this.renderPairingSection();
    }
  }
  /** Unlinked: the name is a pairing-time default (applies at next pair). */
  renderPairingDeviceName() {
    new import_obsidian4.Setting(this.containerEl).setName("Device name").setDesc(`Shown in the worker dashboard's device list. Applies when (re)pairing.`).addText(
      (text) => text.setPlaceholder(defaultDeviceName()).setValue(this.plugin.data.deviceName).onChange(async (value) => {
        this.plugin.data.deviceName = value.trim();
        await this.plugin.savePluginData();
      })
    );
  }
  /** Linked: the field shows the current name; Rename pushes it to the worker. */
  renderLinkedDeviceName() {
    var _a;
    const current = (_a = this.renameDraft) != null ? _a : this.plugin.data.deviceName;
    new import_obsidian4.Setting(this.containerEl).setName("Device name").setDesc(
      'The worker dashboard shows this name. Edit it and press "Rename device" to update this device on the worker (1-30 characters).'
    ).addText(
      (text) => text.setPlaceholder(defaultDeviceName()).setValue(current).onChange((value) => {
        this.renameDraft = value;
      })
    ).addButton(
      (button) => button.setButtonText("Rename device").onClick(async () => {
        var _a2;
        button.setDisabled(true);
        try {
          const ok = await this.plugin.renameDevice((_a2 = this.renameDraft) != null ? _a2 : this.plugin.data.deviceName);
          if (ok) this.display();
        } finally {
          button.setDisabled(false);
        }
      })
    );
  }
  renderPairingSection() {
    const { containerEl } = this;
    new import_obsidian4.Setting(containerEl).setName("Pairing code").setDesc("From your worker dashboard: Devices \u2192 Pair new device. Codes are one-time and expire after 10 minutes.").addText(
      (text) => text.setPlaceholder("7F3K-Q9M2").onChange((value) => {
        this.pairingCode = value.trim();
      })
    );
    new import_obsidian4.Setting(containerEl).addButton(
      (button) => button.setCta().setButtonText("Pair this vault").onClick(async () => {
        button.setDisabled(true);
        try {
          const outcome = await this.plugin.pairFromSettings(this.pairingCode);
          this.showOutcome(outcome);
        } finally {
          button.setDisabled(false);
        }
      })
    );
    this.hintSetting = new import_obsidian4.Setting(containerEl).setName("Getting started").setClass("vsa-settings-hint").setDesc(
      [
        "1. Deploy your own worker with the button below (your Cloudflare account, preconfigured \u2014 no wrangler).",
        "2. Open the worker URL in a browser and set the admin passphrase (claim).",
        "3. Create a pairing code on the dashboard, paste it above, and pair.",
        "On a phone, scanning the dashboard QR or tapping its obsidian:// link pairs without typing."
      ].join("\n")
    ).addButton(
      (button) => button.setButtonText("Deploy your worker").onClick(() => openDeployPage())
    );
  }
  renderLinkedStatus() {
    const { containerEl } = this;
    this.statusSetting = new import_obsidian4.Setting(containerEl).setName("Status").setClass("vsa-status-readout").setDesc(this.statusText());
    new import_obsidian4.Setting(containerEl).addButton(
      (button) => button.setButtonText("Sync now").onClick(async () => {
        button.setDisabled(true);
        try {
          await this.plugin.syncNow();
        } finally {
          button.setDisabled(false);
          this.refreshStatus();
        }
      })
    );
    new import_obsidian4.Setting(containerEl).addButton(
      (button) => button.setButtonText("Unlink this vault").onClick(() => {
        new ConfirmModal(this.app, {
          title: "Unlink VaultSync?",
          body: "This stops syncing and clears this device\u2019s local sync state. Files already in the vault are untouched. The worker keeps this device in its registry \u2014 revoke it from the dashboard if you are done with it.",
          confirmText: "Unlink",
          onConfirm: async () => {
            await this.plugin.unlink();
            this.display();
          }
        }).open();
      })
    );
  }
  renderSyncSection() {
    const { containerEl } = this;
    const data = this.plugin.data;
    this.heading("Sync");
    if (this.plugin.linked) {
      new import_obsidian4.Setting(containerEl).setName("Rescan interval").setDesc(
        "Periodic full reconciliation \u2014 catches external edits while Obsidian is open and covers mobile background limits. Vault events and app-open sync always run."
      ).addDropdown((dropdown) => {
        for (const choice of RESCAN_INTERVAL_CHOICES) {
          dropdown.addOption(String(choice.value), choice.label);
        }
        dropdown.setValue(String(data.settings.rescanIntervalSec));
        dropdown.onChange(async (value) => {
          await this.plugin.applyRescanInterval(Number(value));
        });
      });
      new import_obsidian4.Setting(containerEl).setName("Sync .obsidian/ folder").setDesc(
        "Opt in to syncing .obsidian/ (settings and plugins), excluding workspace.json and caches. The worker\u2019s per-vault setting takes precedence once connected."
      ).addToggle(
        (toggle) => toggle.setValue(data.settings.obsidianSync).onChange(async (value) => {
          await this.plugin.applyObsidianSync(value);
        })
      );
      const paused = this.plugin.syncingPaused;
      new import_obsidian4.Setting(containerEl).setName(paused ? "Syncing paused" : "Pause syncing").setDesc(
        paused ? "Syncing is paused: the connection is down and vault changes stay local. Resume reconnects and runs a full catch-up sync." : "Temporarily stop syncing without unlinking \u2014 the transport disconnects and the watcher goes idle. Your link and local state are kept."
      ).addButton(
        (button) => button.setButtonText(paused ? "Resume syncing" : "Pause syncing").onClick(async () => {
          button.setDisabled(true);
          try {
            if (paused) await this.plugin.resumeSyncing();
            else this.plugin.pauseSyncing();
          } finally {
            this.display();
          }
        })
      );
    }
    new import_obsidian4.Setting(containerEl).setName("Sync on startup").setDesc(
      'ON (default): sync starts as soon as Obsidian opens. OFF: the plugin loads idle and the first "Sync now" press starts syncing (manual-only mode).'
    ).addToggle(
      (toggle) => toggle.setValue(data.settings.syncOnStartup).onChange(async (value) => {
        await this.plugin.applySyncOnStartup(value);
      })
    );
  }
  renderAdvancedSection() {
    const { containerEl } = this;
    const data = this.plugin.data;
    this.heading("Advanced");
    new import_obsidian4.Setting(containerEl).setName("Status bar indicator").setDesc(
      'Detailed: "vsa \u2713 12s" with state and age. Compact: just the symbol. Hidden: no status bar item at all.'
    ).addDropdown((dropdown) => {
      dropdown.addOption("detailed", "Detailed");
      dropdown.addOption("compact", "Compact");
      dropdown.addOption("hidden", "Hidden");
      dropdown.setValue(data.settings.statusBarMode);
      dropdown.onChange(async (value) => {
        await this.plugin.applyStatusBarMode(
          value === "compact" || value === "hidden" ? value : "detailed"
        );
      });
    });
    new import_obsidian4.Setting(containerEl).setName("Ignore patterns").setDesc(
      "One pattern per line, e.g. private/** or *.tmp. Glob-lite: * matches within one folder name, ** spans folders (dir/** skips the folder and everything in it); a pattern without / matches file names at any depth. Case-insensitive; applies on this device only; saving reconnects sync to apply them."
    ).addTextArea(
      (area) => area.setPlaceholder("private/**\n*.tmp").setValue(data.settings.ignorePatterns).onChange(async (value) => {
        await this.plugin.applyIgnorePatterns(value);
      })
    );
    new import_obsidian4.Setting(containerEl).setName("Diagnostics log level").setDesc(
      "info (default) records lifecycle events; debug additionally logs protocol round-trips (one short line per frame); warn keeps only warnings and errors."
    ).addDropdown((dropdown) => {
      dropdown.addOption("info", "info");
      dropdown.addOption("debug", "debug");
      dropdown.addOption("warn", "warn");
      dropdown.setValue(data.settings.logLevel);
      dropdown.onChange(async (value) => {
        const level = value === "debug" || value === "warn" ? value : "info";
        await this.plugin.applyLogLevel(level);
      });
    });
    new import_obsidian4.Setting(containerEl).setName("Copy diagnostics").setDesc(
      "Copies a bug-report bundle: plugin + protocol versions, device, worker URL, pairing state, a status snapshot, the platform, and the last 20 log lines."
    ).addButton(
      (button) => button.setButtonText("Copy diagnostics").onClick(async () => {
        button.setDisabled(true);
        try {
          await this.plugin.copyDiagnostics();
        } finally {
          button.setDisabled(false);
        }
      })
    );
    new import_obsidian4.Setting(containerEl).setName("Save support bundle").setDesc(
      "Writes a richer markdown diagnostic file (versions, settings, sync state, recent log) to .vaultsyncforagents/ in this vault \u2014 attach it to bug reports. It never contains note contents or the device token."
    ).addButton(
      (button) => button.setButtonText("Save support bundle").onClick(async () => {
        button.setDisabled(true);
        try {
          await this.plugin.saveSupportBundle();
        } finally {
          button.setDisabled(false);
        }
      })
    );
  }
  renderAboutSection() {
    const { containerEl } = this;
    this.heading("About");
    new import_obsidian4.Setting(containerEl).setName("Versions").setDesc(
      `Plugin ${this.plugin.manifest.version || "unknown"} \xB7 protocol v${PROTOCOL_VERSION} \xB7 ${this.plugin.platformSummary()}`
    );
    this.serverVersionSetting = new import_obsidian4.Setting(containerEl).setName("Server version").setDesc(this.serverVersionText());
    this.refreshServerVersion();
    this.storageSetting = new import_obsidian4.Setting(containerEl).setName("Vault storage").setDesc(this.plugin.linked ? "Checking the worker\u2026" : "Pair this vault to see storage usage.");
    if (this.plugin.linked) void this.refreshStorage();
    new import_obsidian4.Setting(containerEl).setName("Project home").setDesc(`Documentation and source: ${PROJECT_README_URL}`).addButton(
      (button) => button.setButtonText("Open README").onClick(() => openReadmePage())
    );
  }
  /** Fill the About storage line from /api/status (device-token auth). */
  async refreshStorage() {
    const summary = await this.plugin.fetchStorageSummary();
    const desc = summary === null ? "Storage usage is currently unavailable (the worker is unreachable)." : `Storage used: ${formatBytes(summary.storageBytes)} \xB7 ${summary.attachments.count} attachment${summary.attachments.count === 1 ? "" : "s"} (${formatBytes(summary.attachments.bytes)})` + (summary.devices.length > 0 ? ` \xB7 ${summary.devices.length} device${summary.devices.length === 1 ? "" : "s"}` : "");
    if (this.storageSetting !== null) this.storageSetting.setDesc(desc);
  }
  // --- status / feedback -----------------------------------------------------------
  statusText() {
    var _a;
    const data = this.plugin.data;
    const status = (_a = this.plugin.client) == null ? void 0 : _a.status();
    if (this.plugin.syncingPaused) {
      return [
        "State: paused",
        `Worker: ${data.url}`,
        "Vault changes stay local until you resume syncing."
      ].join("\n");
    }
    if (status === void 0) {
      return `Linked to ${data.url} (device ${data.deviceName || data.deviceId}).`;
    }
    const lastSync = status.lastSyncAt === null ? "never" : `${formatSince(Date.now() - status.lastSyncAt)} ago`;
    const state = status.state === "live" ? "connected" : status.state;
    const lines = [`State: ${state}`, `Worker: ${data.url}`, `Last sync: ${lastSync}`];
    if (status.progress !== void 0) {
      lines.push(`Syncing: ${status.progress.done}/${status.progress.total} (${status.progress.phase})`);
    }
    lines.push(
      `Pending changes: ${status.pending}`,
      `Conflicts: ${status.conflicts.length}${status.conflicts.length > 0 ? " (conflict copies were written into the vault)" : ""}`
    );
    return lines.join("\n");
  }
  refreshStatus() {
    var _a;
    (_a = this.statusSetting) == null ? void 0 : _a.setDesc(this.statusText());
    this.refreshServerVersion();
  }
  /**
   * The About section's server-version line: the helloAck-reported version
   * plus the compat verdict when it is not ok. `serverVersion` may lag the
   * verdict by a tick (the plugin assesses on its own 1 Hz supervision), so
   * the verdict message is authoritative when present.
   */
  serverVersionText() {
    var _a, _b;
    if (!this.plugin.linked) return "Pair this vault to see the worker version.";
    const status = (_a = this.plugin.client) == null ? void 0 : _a.status();
    const verdict = this.plugin.serverCompatibility;
    if (verdict !== null && verdict.level !== "ok") return verdict.message;
    const version = (_b = status == null ? void 0 : status.serverVersion) != null ? _b : null;
    return version === null ? "Unknown \u2014 the worker has not reported a version yet." : `Server ${version} \xB7 compatible with this plugin.`;
  }
  /** Repaint the server-version row (called by the 1 Hz refresh loop). */
  refreshServerVersion() {
    if (this.serverVersionSetting !== null) this.serverVersionSetting.setDesc(this.serverVersionText());
  }
  /** Pair feedback: success re-renders; failures land in the hint Setting. */
  showOutcome(outcome) {
    if (outcome.status === "paired") {
      new import_obsidian4.Notice(pairOutcomeMessage(outcome));
      this.display();
      return;
    }
    const message = pairOutcomeMessage(outcome);
    new import_obsidian4.Notice(message, 1e4);
    if (this.hintSetting !== null) this.hintSetting.setDesc(message);
  }
  // --- live refresh loop ------------------------------------------------------------
  /** Refresh the status readout ~1 Hz while the tab is open. */
  startRefresh() {
    this.stopRefresh();
    const handle = setInterval(() => this.refreshStatus(), 1e3);
    this.refreshHandle = handle;
    this.plugin.registerInterval(handle);
  }
  stopRefresh() {
    if (this.refreshHandle !== null) {
      clearInterval(this.refreshHandle);
      this.refreshHandle = null;
    }
  }
};

// src/transport.ts
function toWebSocketUrl(baseUrl, token, path = "/ws") {
  const url = new URL(baseUrl);
  if (url.protocol === "http:") url.protocol = "ws:";
  else if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new NetworkError(`worker URL must be http(s):// or ws(s)://, got ${url.protocol}`);
  }
  url.pathname = path;
  url.search = "";
  url.searchParams.set("token", token);
  return url.toString();
}
function defaultWebSocketFactory(url) {
  const websocket = globalThis.WebSocket;
  if (typeof websocket !== "function") {
    throw new NetworkError(
      "WebSocket is not available in this Obsidian build (it is built in on desktop and mobile; a very old app version or a stripped webview is the only known cause). Sync requires it."
    );
  }
  return new websocket(url);
}
var WebSocketTransport = class {
  constructor(options) {
    __publicField(this, "socket");
    __publicField(this, "messageCallback", null);
    __publicField(this, "closeCallback", null);
    __publicField(this, "open", false);
    __publicField(this, "closed", false);
    __publicField(this, "closeNotified", false);
    __publicField(this, "sendQueue", []);
    __publicField(this, "lastError");
    var _a, _b;
    const factory = (_a = options.wsFactory) != null ? _a : defaultWebSocketFactory;
    const url = toWebSocketUrl(options.url, options.token, (_b = options.path) != null ? _b : "/ws");
    this.socket = factory(url);
    this.socket.addEventListener("open", () => {
      this.open = true;
      const queued = [...this.sendQueue];
      this.sendQueue.length = 0;
      for (const frame of queued) this.socket.send(frame);
    });
    this.socket.addEventListener("message", (event) => {
      var _a2;
      if (typeof event.data !== "string") {
        this.fail({ code: 1003, reason: "binary frames are not part of the protocol" });
        return;
      }
      let message;
      try {
        message = parseMessage(event.data);
      } catch (error) {
        this.fail({ code: 1002, reason: error instanceof Error ? error.message : String(error) });
        return;
      }
      (_a2 = this.messageCallback) == null ? void 0 : _a2.call(this, message);
    });
    this.socket.addEventListener("error", (event) => {
      this.lastError = event instanceof Error ? event.message : event !== void 0 ? String(event) : "socket error";
    });
    this.socket.addEventListener("close", (event) => {
      this.finishClose({
        code: event.code,
        reason: event.reason !== void 0 && event.reason !== "" ? event.reason : this.lastError
      });
    });
  }
  send(message) {
    if (this.closed) throw new NetworkError("send on a closed transport");
    const frame = JSON.stringify(message);
    if (this.open) {
      this.socket.send(frame);
      return;
    }
    this.sendQueue.push(frame);
  }
  onMessage(callback) {
    this.messageCallback = callback;
  }
  onClose(callback) {
    this.closeCallback = callback;
  }
  close() {
    if (this.closed) return;
    this.closed = true;
    this.sendQueue.length = 0;
    try {
      this.socket.close(1e3, "closed by caller");
    } catch (e) {
    }
    this.finishClose({ code: 1e3, reason: "closed by caller" });
  }
  fail(reason) {
    var _a, _b;
    this.closed = true;
    try {
      this.socket.close((_a = reason.code) != null ? _a : 1002, (_b = reason.reason) != null ? _b : "");
    } catch (e) {
    }
    this.finishClose(reason);
  }
  finishClose(reason) {
    var _a;
    this.open = false;
    this.closed = true;
    if (this.closeNotified) return;
    this.closeNotified = true;
    (_a = this.closeCallback) == null ? void 0 : _a.call(this, reason);
  }
};

// src/plugin.ts
var DEVICE_MARKER_VAULT_PATH = "/.vaultsyncforagents/device.json";
var LOCAL_INDEX_VAULT_PATH = "/.vaultsyncforagents/state";
var SUPPORT_BUNDLE_DIR_VAULT_PATH = "/.vaultsyncforagents";
var SUPERVISION_TICK_MS = 1e3;
var VaultSyncPlugin = class extends import_obsidian5.Plugin {
  constructor(app, manifest, overrides = {}) {
    super(app, manifest);
    __publicField(this, "data", defaultPluginData());
    /** The live sync client (null while unlinked/stopped). */
    __publicField(this, "client", null);
    __publicField(this, "overrides");
    __publicField(this, "watcher", null);
    __publicField(this, "rescan", null);
    __publicField(this, "statusBar", null);
    __publicField(this, "statusBarItem", null);
    __publicField(this, "tickHandle", null);
    __publicField(this, "reconnectTimer", null);
    __publicField(this, "supervisor", new ReconnectSupervisor());
    /** Set when the worker rejected the token — reconnecting cannot help. */
    __publicField(this, "authFailed", false);
    __publicField(this, "statusNote", "");
    /**
     * Latest server-version verdict (core compat.ts), re-assessed by the
     * supervision tick after every helloAck; null before the first ack of a
     * sync session. Non-ok verdicts ride the status-bar tooltip; a Notice is
     * shown at most once per plugin session.
     */
    __publicField(this, "serverCompat", null);
    __publicField(this, "serverCompatNotified", false);
    /** Pause-syncing state (runtime only — a reload starts per syncOnStartup). */
    __publicField(this, "paused", false);
    /** The plugin's log: console mirror + bounded ring (Copy diagnostics). */
    __publicField(this, "syncLog", createPluginLog());
    this.overrides = overrides;
  }
  get now() {
    var _a;
    return (_a = this.overrides.now) != null ? _a : (() => Date.now());
  }
  get fetchImpl() {
    var _a;
    return (_a = this.overrides.fetchImpl) != null ? _a : globalThis.fetch.bind(globalThis);
  }
  get linked() {
    return isLinked(this.data);
  }
  async onload() {
    this.data = normalizePluginData(await this.loadData());
    this.syncLog.setLevel(this.data.settings.logLevel);
    this.addSettingTab(new VaultSyncSettingTab(this.app, this));
    registerPairProtocolHandler(
      (action, handler) => this.registerObsidianProtocolHandler(action, handler),
      (link) => this.handlePairDeepLink(link.url, link.code)
    );
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
      var _a;
      return (_a = this.rescan) == null ? void 0 : _a.poke();
    }));
    this.addCommand({
      id: "copy-diagnostics",
      name: "Copy diagnostics",
      callback: () => this.copyDiagnostics()
    });
    this.addCommand({
      id: "save-support-bundle",
      name: "Save support bundle",
      callback: () => this.saveSupportBundle()
    });
    if (this.linked && this.data.settings.syncOnStartup) await this.startSync();
  }
  onunload() {
    this.stopSync();
  }
  // --- persistence -----------------------------------------------------------------
  async savePluginData() {
    await this.saveData(this.data);
  }
  // --- pairing (settings tab + deep link) --------------------------------------------
  /** Pair from the settings form (fields already live in `this.data`). */
  async pairFromSettings(code) {
    const deviceName = this.resolveDeviceName();
    const outcome = await pairWithWorker({
      url: this.data.url,
      code,
      deviceName,
      deviceType: detectDeviceType(),
      fetchImpl: this.fetchImpl
    });
    await this.applyPairOutcome(outcome, deviceName);
    return outcome;
  }
  /**
   * obsidian://vaultsyncforagents/pair?url=…&code=… (protocol-handler.ts).
   * On an unlinked vault the link's origin is untrusted until the user
   * approves it — pairing would hand the whole vault to whatever host the
   * link carried — so it goes through a confirmation naming that exact URL.
   */
  async handlePairDeepLink(url, code) {
    if (this.linked) {
      if (normalizeWorkerUrlSafe(url) === normalizeWorkerUrlSafe(this.data.url)) {
        new import_obsidian5.Notice("VaultSync: this vault is already paired with that worker.");
      } else {
        new import_obsidian5.Notice(
          "VaultSync: this vault is paired with a different worker. Unlink it in settings first.",
          1e4
        );
      }
      return;
    }
    new ConfirmModal(this.app, {
      title: "Pair VaultSync?",
      body: `A pairing link asked Obsidian to pair this vault with the worker at:

${url}

Approving pairs this device and sends this vault\u2019s notes to that worker from then on. Only approve a link you opened from your own worker dashboard \u2014 any web page can craft one.`,
      confirmText: "Pair",
      onConfirm: () => this.pairFromDeepLink(url, code)
    }).open();
  }
  async pairFromDeepLink(url, code) {
    const deviceName = this.resolveDeviceName();
    const outcome = await pairWithWorker({
      url,
      code,
      deviceName,
      deviceType: detectDeviceType(),
      fetchImpl: this.fetchImpl
    });
    await this.applyPairOutcome(outcome, deviceName);
  }
  async applyPairOutcome(outcome, deviceName) {
    if (outcome.status !== "paired") {
      new import_obsidian5.Notice(pairOutcomeMessage(outcome), 1e4);
      return;
    }
    this.data.url = outcome.url;
    this.data.token = outcome.token;
    this.data.deviceId = outcome.deviceId;
    this.data.deviceName = deviceName;
    await this.savePluginData();
    await this.writeDeviceMarker();
    new import_obsidian5.Notice(pairOutcomeMessage(outcome));
    await this.startSync();
  }
  resolveDeviceName() {
    const typed = this.data.deviceName.trim();
    return typed !== "" ? typed : defaultDeviceName();
  }
  /**
   * The vault-backed storage adapter every sync surface uses. Wires the
   * empty-folder removal through `fileManager.trashFile` — Obsidian's
   * `DataAdapter.rmdir` refuses EVERY directory (`ERR_FS_EISDIR`), which
   * silently degraded folder-tombstone application to record-only (F-1).
   * Trash (not delete) because an empty folder is trivially recoverable.
   */
  createStorageAdapter() {
    return new ObsidianStorageAdapter({
      adapter: this.app.vault.adapter,
      removeEmptyDir: async (adapterPath) => {
        const folder = this.app.vault.getAbstractFileByPath(adapterPath);
        if (folder === null) return;
        await this.app.fileManager.trashFile(folder);
      }
    });
  }
  /** Write the FR-44 marker the CLI/daemon read to detect double-clients. */
  async writeDeviceMarker() {
    if (!this.linked) return;
    const storage = this.createStorageAdapter();
    const marker = {
      deviceId: this.data.deviceId,
      deviceName: this.resolveDeviceName(),
      url: this.data.url,
      linkedAt: this.now()
    };
    try {
      await storage.writeFile(
        DEVICE_MARKER_VAULT_PATH,
        new TextEncoder().encode(`${JSON.stringify(marker, null, 2)}
`)
      );
    } catch (error) {
      this.syncLog.warn("failed to write device marker", error);
    }
  }
  /**
   * `PATCH /device` — rename THIS device on the worker (the settings tab's
   * Rename button). Updates plugin data + the in-vault device marker (which
   * stores the name for the FR-44 double-client warning). Local state keeps
   * its previous name on failure.
   */
  async renameDevice(name) {
    if (!this.linked) {
      new import_obsidian5.Notice("VaultSync: pair this vault first \u2014 the name applies at pairing time.");
      return false;
    }
    const trimmed = name.trim();
    if (trimmed === "" || trimmed.length > 30 || /[\u0000-\u001f\u007f]/.test(trimmed)) {
      new import_obsidian5.Notice("VaultSync: device name must be 1-30 characters, without control characters.", 8e3);
      return false;
    }
    const outcome = await renameDevice({
      origin: this.data.url,
      token: this.data.token,
      name: trimmed,
      fetchImpl: this.fetchImpl
    });
    if (!outcome.ok) {
      new import_obsidian5.Notice(`VaultSync: renaming failed \u2014 ${outcome.error}`, 1e4);
      return false;
    }
    this.data.deviceName = outcome.device.name;
    await this.savePluginData();
    await this.writeDeviceMarker();
    new import_obsidian5.Notice(`VaultSync: device renamed to \u201C${outcome.device.name}\u201D.`);
    return true;
  }
  // --- sync lifecycle ------------------------------------------------------------------
  /** Build everything and run startup reconciliation (idempotent restart). */
  async startSync() {
    var _a;
    if (!this.linked) return;
    this.stopSync();
    const { url, token, deviceId } = this.data;
    const deviceName = this.resolveDeviceName();
    const storage = this.createStorageAdapter();
    await this.warnIfForeignStateDir(storage);
    const client = new SyncClient({
      deviceId,
      deviceName,
      token,
      transport: () => withRoundTripLogging(
        new WebSocketTransport({ url, token, wsFactory: this.overrides.wsFactory }),
        { log: this.syncLog, shouldLog: () => this.syncLog.debugEnabled }
      ),
      blobStore: new HttpBlobStore({ baseUrl: url, token, fetchImpl: this.fetchImpl }),
      storage,
      settings: {
        obsidianSync: this.data.settings.obsidianSync,
        extraIgnores: parseIgnorePatterns(this.data.settings.ignorePatterns)
      },
      log: this.syncLog,
      now: this.now
    });
    this.client = client;
    this.authFailed = false;
    this.statusNote = "";
    this.serverCompat = null;
    this.supervisor = new ReconnectSupervisor((_a = this.overrides.reconnect) != null ? _a : {});
    try {
      await client.connect();
    } catch (error) {
      this.handleSyncError(error, "startup sync failed");
    }
    this.watcher = new ObsidianWatchAdapter({ vault: this.app.vault });
    client.startWatching(this.watcher);
    this.rescan = new RescanScheduler({
      intervalMs: this.data.settings.rescanIntervalSec * 1e3
    });
    this.rescan.start(() => {
      void client.triggerSync().catch((error) => {
        this.handleSyncError(error, "rescan failed");
      });
    });
    this.mountStatusBar();
    const tick = setInterval(() => this.onTick(), SUPERVISION_TICK_MS);
    this.tickHandle = tick;
    this.registerInterval(tick);
    this.onTick();
  }
  /** (Re)mount the status-bar item per the current mode ('hidden' = none). */
  mountStatusBar() {
    var _a;
    (_a = this.statusBarItem) == null ? void 0 : _a.remove();
    this.statusBarItem = null;
    this.statusBar = null;
    if (this.client === null) return;
    if (this.data.settings.statusBarMode === "hidden") return;
    const item = this.addStatusBarItem();
    this.statusBarItem = item;
    this.statusBar = new StatusBarIndicator(item);
  }
  /** Tear down every timer, watcher, socket, and UI artifact. Idempotent. */
  stopSync() {
    var _a, _b, _c;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.tickHandle !== null) {
      clearInterval(this.tickHandle);
      this.tickHandle = null;
    }
    (_a = this.rescan) == null ? void 0 : _a.stop();
    this.rescan = null;
    (_b = this.client) == null ? void 0 : _b.close();
    this.client = null;
    this.watcher = null;
    (_c = this.statusBarItem) == null ? void 0 : _c.remove();
    this.statusBarItem = null;
    this.statusBar = null;
  }
  // --- user actions ----------------------------------------------------------------------
  async syncNow() {
    var _a;
    if (this.paused) {
      new import_obsidian5.Notice("VaultSync: syncing is paused \u2014 resume it in settings first.");
      return;
    }
    const client = this.client;
    if (client === null) {
      if (!this.linked) {
        new import_obsidian5.Notice("VaultSync: not paired yet \u2014 add your worker URL and a pairing code in settings.");
        return;
      }
      await this.startSync();
      const status = (_a = this.client) == null ? void 0 : _a.status();
      if (status !== void 0) {
        new import_obsidian5.Notice(
          status.state === "disconnected" ? "VaultSync: offline \u2014 changes will sync when the worker is reachable." : "VaultSync: up to date."
        );
      }
      return;
    }
    try {
      await client.triggerSync();
      const status = client.status();
      new import_obsidian5.Notice(
        status.state === "disconnected" ? "VaultSync: offline \u2014 changes will sync when the worker is reachable." : "VaultSync: up to date."
      );
    } catch (error) {
      this.handleSyncError(error, "sync now failed");
      new import_obsidian5.Notice("VaultSync: sync failed \u2014 see the developer console for details.");
    }
  }
  /** Pause: transport down + watcher/rescan idle, link and state kept. */
  pauseSyncing() {
    var _a, _b;
    if (!this.linked || this.paused) return;
    this.paused = true;
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.supervisor.settled();
    (_a = this.rescan) == null ? void 0 : _a.stop();
    this.rescan = null;
    (_b = this.client) == null ? void 0 : _b.close();
    this.onTick();
    new import_obsidian5.Notice("VaultSync: paused. New and changed files stay local until you resume.");
  }
  /** Resume: reconnect and run a full catch-up cycle (startup reconciliation). */
  async resumeSyncing() {
    if (!this.linked || !this.paused) return;
    this.paused = false;
    new import_obsidian5.Notice("VaultSync: resuming \u2014 running a full catch-up sync\u2026");
    await this.startSync();
  }
  /** Runtime pause state (the settings tab's button label + diagnostics). */
  get syncingPaused() {
    return this.paused;
  }
  async applyRescanInterval(seconds) {
    var _a;
    this.data.settings.rescanIntervalSec = Math.max(0, Math.floor(seconds));
    await this.savePluginData();
    (_a = this.rescan) == null ? void 0 : _a.setIntervalMs(this.data.settings.rescanIntervalSec * 1e3);
  }
  async applyObsidianSync(enabled) {
    this.data.settings.obsidianSync = enabled;
    await this.savePluginData();
    new import_obsidian5.Notice(
      enabled ? "VaultSync: .obsidian/ will sync after the next reconnect (the worker\u2019s per-vault setting takes precedence)." : "VaultSync: .obsidian/ will be excluded after the next reconnect."
    );
  }
  async applyStatusBarMode(mode) {
    this.data.settings.statusBarMode = mode;
    await this.savePluginData();
    this.mountStatusBar();
    this.onTick();
  }
  async applySyncOnStartup(enabled) {
    this.data.settings.syncOnStartup = enabled;
    await this.savePluginData();
    new import_obsidian5.Notice(
      enabled ? "VaultSync: syncing will start automatically the next time Obsidian opens." : "VaultSync: on the next launch this plugin stays idle until you press \u201CSync now\u201D."
    );
  }
  async applyLogLevel(level) {
    this.data.settings.logLevel = level;
    await this.savePluginData();
    this.syncLog.setLevel(level);
  }
  /**
   * New ignore patterns: persist, then restart the sync machinery while live
   * so the scan/watcher pick them up immediately (a paused session applies
   * them on resume — resume always rebuilds the client).
   */
  async applyIgnorePatterns(text) {
    this.data.settings.ignorePatterns = text;
    await this.savePluginData();
    if (this.client !== null && !this.paused) await this.startSync();
  }
  /** Storage/attachment summary for the About section (null = unavailable). */
  async fetchStorageSummary() {
    if (!this.linked) return null;
    return fetchWorkerStatus({
      origin: this.data.url,
      token: this.data.token,
      fetchImpl: this.fetchImpl
    });
  }
  /**
   * The shared snapshot behind "Copy diagnostics" and "Save support bundle".
   * Structurally redacted: the device token never enters (it lives only in
   * `this.data`), and conflicts contribute paths only — never file content.
   */
  collectDiagnosticsInput() {
    var _a, _b, _c;
    const status = (_b = (_a = this.client) == null ? void 0 : _a.status()) != null ? _b : null;
    return {
      pluginVersion: this.manifest.version || "unknown",
      deviceId: this.data.deviceId,
      deviceName: this.resolveDeviceName(),
      workerUrl: this.data.url,
      paired: this.linked,
      paused: this.paused,
      clientStatus: status,
      recentLogLines: this.syncLog.recentLines(),
      serverVersion: (_c = status == null ? void 0 : status.serverVersion) != null ? _c : null,
      settings: this.data.settings,
      recentConflicts: status === null ? [] : status.conflicts.map((conflict) => ({ path: conflict.path }))
    };
  }
  /** Copy the diagnostics bundle to the clipboard (fallback: console). */
  async copyDiagnostics() {
    const bundle = buildDiagnosticsBundle(this.collectDiagnosticsInput());
    const copied = await copyToClipboard(bundle);
    if (copied) {
      new import_obsidian5.Notice("VaultSync: diagnostics copied to the clipboard.");
      return;
    }
    console.info("[vsa] diagnostics (clipboard unavailable):\n" + bundle);
    new import_obsidian5.Notice("VaultSync: clipboard unavailable \u2014 diagnostics written to the developer console.", 1e4);
  }
  /**
   * Write the support bundle (markdown) into `.vaultsyncforagents/` in the
   * vault — the richer, attachable sibling of "Copy diagnostics".
   */
  async saveSupportBundle() {
    const now = this.now();
    const markdown = buildSupportBundle(this.collectDiagnosticsInput(), now);
    const fileName = `support-bundle-${formatSupportBundleStamp(now)}.md`;
    const vaultPath = `${SUPPORT_BUNDLE_DIR_VAULT_PATH}/${fileName}`;
    try {
      await this.createStorageAdapter().writeFile(vaultPath, new TextEncoder().encode(markdown));
      new import_obsidian5.Notice(`VaultSync: support bundle saved to ${vaultPath.slice(1)}.`);
    } catch (error) {
      this.syncLog.warn("failed to write support bundle", error);
      new import_obsidian5.Notice("VaultSync: could not write the support bundle \u2014 see the developer console.", 1e4);
    }
  }
  /** The platform line for the About/diagnostics readouts. */
  platformSummary() {
    return platformSummary();
  }
  async unlink() {
    this.stopSync();
    this.paused = false;
    const storage = this.createStorageAdapter();
    await storage.deleteFile(DEVICE_MARKER_VAULT_PATH);
    await storage.deleteFile(LOCAL_INDEX_VAULT_PATH);
    this.data = {
      ...defaultPluginData(),
      deviceName: this.data.deviceName,
      settings: this.data.settings
    };
    await this.savePluginData();
    new import_obsidian5.Notice(
      "VaultSync: unlinked. Revoke this device from the worker dashboard if you are done with it."
    );
  }
  // --- supervision --------------------------------------------------------------------------
  onTick() {
    var _a;
    const client = this.client;
    if (client === null) return;
    const status = client.status();
    this.assessServerVersion(status);
    (_a = this.statusBar) == null ? void 0 : _a.update(
      status,
      {
        url: this.data.url,
        deviceName: this.resolveDeviceName(),
        // Both notes can be live at once (an auth-failure note while the
        // server also reports version skew): concatenate instead of letting
        // either hide the other; empty parts drop out.
        note: [this.statusNote, this.serverCompatNote].filter((part) => part !== "").join(" \xB7 "),
        paused: this.paused,
        mode: this.data.settings.statusBarMode
      },
      this.now()
    );
    if (this.paused || this.authFailed) return;
    const decision = this.supervisor.consider(status.state);
    if (decision.action === "wait") return;
    this.supervisor.acknowledged();
    this.scheduleReconnect(decision.delayMs);
  }
  /**
   * Latest server-version verdict for the settings tab; null until the first
   * helloAck of the current sync session.
   */
  get serverCompatibility() {
    return this.serverCompat;
  }
  /** The verdict's tooltip line ('' when compatible — nothing to nag about). */
  get serverCompatNote() {
    return this.serverCompat !== null && this.serverCompat.level !== "ok" ? this.serverCompat.message : "";
  }
  /**
   * Version-skew assessment, run by the tick once the connection has acked
   * (states 'syncing'/'live' both follow the helloAck; pre-ack states read
   * serverVersion null for "not yet known" and must not produce a spurious
   * "legacy server" verdict). Never kills sync: the wire `ProtocolVersion`
   * check at hello remains the hard gate; a verdict is advisory.
   */
  assessServerVersion(status) {
    if (status.state !== "syncing" && status.state !== "live") return;
    const verdict = checkServerCompatibility(this.manifest.version || "unknown", status.serverVersion);
    this.serverCompat = verdict;
    if (verdict.level === "ok") return;
    if (this.serverCompatNotified) return;
    this.serverCompatNotified = true;
    new import_obsidian5.Notice(`VaultSync: ${verdict.message}`, 1e4);
  }
  scheduleReconnect(delayMs) {
    if (this.reconnectTimer !== null) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      const client = this.client;
      if (client === null) {
        this.supervisor.settled();
        return;
      }
      client.reconnect().then(
        () => {
          this.supervisor.settled();
        },
        (error) => {
          this.supervisor.settled();
          this.handleSyncError(error, "reconnect failed");
        }
      ).catch(() => {
      });
    }, delayMs);
  }
  /** Distinguish fatal auth failures from transient network trouble. */
  handleSyncError(error, context) {
    if (error instanceof RevokedError || error instanceof UnauthorizedError) {
      this.authFailed = true;
      this.statusNote = "Device token rejected \u2014 unlink and re-pair with a fresh code.";
      this.syncLog.error(context, error);
      new import_obsidian5.Notice(
        "VaultSync: the worker rejected this device\u2019s token (revoked?). Unlink and re-pair from settings.",
        1e4
      );
      return;
    }
    this.syncLog.warn(context, error);
  }
  /** FR-44: warn when the vault's state dir belongs to another client. */
  async warnIfForeignStateDir(storage) {
    let marker;
    try {
      const bytes = await storage.readFile(DEVICE_MARKER_VAULT_PATH);
      marker = JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
      return;
    }
    if (typeof marker.deviceId === "string" && marker.deviceId !== this.data.deviceId) {
      const name = typeof marker.deviceName === "string" ? marker.deviceName : marker.deviceId;
      const where = typeof marker.url === "string" ? marker.url : "a worker";
      new import_obsidian5.Notice(
        `VaultSync: this vault already has sync state for device "${name}" (linked to ${where}). One sync client per machine per vault \u2014 running two double-commits every change. Unlink the other client (or clear .vaultsyncforagents/) if this is unexpected.`,
        15e3
      );
    }
  }
};
function normalizeWorkerUrlSafe(input) {
  try {
    return normalizeWorkerUrl(input);
  } catch (e) {
    return input;
  }
}
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiLCAic3JjL3BsdWdpbi50cyIsICIuLi9jb3JlL3NyYy9wYXRocy50cyIsICIuLi9jb3JlL3NyYy9jbG9jay50cyIsICIuLi9jb3JlL3NyYy9oYXNoaW5nLnRzIiwgIi4uL2NvcmUvc3JjL2Vycm9ycy50cyIsICIuLi9jb3JlL3NyYy9sb2NhbGluZGV4LnRzIiwgIi4uL2NvcmUvc3JjL2VuZ2luZS50cyIsICIuLi9jb3JlL3NyYy9pZ25vcmUudHMiLCAiLi4vY29yZS9zcmMvcHJvdG9jb2wudHMiLCAiLi4vY29yZS9zcmMvY29uZmxpY3RuYW1lcy50cyIsICIuLi9jb3JlL3NyYy9yZXNvbHZlLnRzIiwgIi4uL2NvcmUvc3JjL3NjYW4udHMiLCAiLi4vY29yZS9zcmMvY2xpZW50LnRzIiwgIi4uL2NvcmUvc3JjL2NvbXBhdC50cyIsICJzcmMvYWRhcHRlcnMvb2JzaWRpYW4tc3RvcmFnZS50cyIsICJzcmMvYWRhcHRlcnMvb2JzaWRpYW4td2F0Y2gudHMiLCAic3JjL2Jsb2JzdG9yZS50cyIsICJzcmMvZGlhZ25vc3RpY3MudHMiLCAic3JjL2RhdGEudHMiLCAic3JjL3dvcmtlcmFwaS50cyIsICJzcmMvcGFpcmluZy50cyIsICJzcmMvcHJvdG9jb2wtaGFuZGxlci50cyIsICJzcmMvcmVjb25uZWN0LnRzIiwgInNyYy9zZXR0aW5ncy50cyIsICJzcmMvc3RhdHVzYmFyLnRzIiwgInNyYy90cmFuc3BvcnQudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8qKlxuICogUGx1Z2luIGVudHJ5IHBvaW50IFx1MjAxNCBPYnNpZGlhbiBsb2FkcyBgbWFpbi5qc2AgYW5kIGluc3RhbnRpYXRlcyB0aGUgZGVmYXVsdFxuICogZXhwb3J0LiBFdmVyeXRoaW5nIHJlYWwgbGl2ZXMgaW4gYHBsdWdpbi50c2AgKGFuZCBpdHMgbW9kdWxlcyk7IHRoaXMgZmlsZVxuICogb25seSByZS1leHBvcnRzLlxuICovXG5cbmV4cG9ydCB7IFZhdWx0U3luY1BsdWdpbiBhcyBkZWZhdWx0IH0gZnJvbSAnLi9wbHVnaW4uanMnO1xuIiwgIi8qKlxuICogYFZhdWx0U3luY1BsdWdpbmAgXHUyMDE0IHRoZSBPYnNpZGlhbiBjbGllbnQgKGRlc2t0b3AgKyBtb2JpbGUpLlxuICpcbiAqIG9ubG9hZDogbG9hZCBsaW5rIGlkZW50aXR5IFx1MjE5MiBpZiBsaW5rZWQsIGJ1aWxkIGBTeW5jQ2xpZW50YCAoY29yZSkgb3ZlciB0aGVcbiAqIE9ic2lkaWFuIGFkYXB0ZXJzIGFuZCBydW4gc3RhcnR1cCByZWNvbmNpbGlhdGlvbiAodGhlIHN5bmMtb24tb3BlblxuICogY29udHJhY3QsIEZSLTQvRlItNS9GUi0xMiksIHRoZW4gZW50ZXIgbGl2ZSBtb2RlICh2YXVsdCBldmVudHMgKyBwZXJpb2RpY1xuICogcmVzY2FuICsgZm9jdXMgcmVzY2FuKSB3aXRoIGEgc3RhdHVzLWJhciBpbmRpY2F0b3IgYW5kIGppdHRlcmVkXG4gKiBleHBvbmVudGlhbC1iYWNrb2ZmIHJlY29ubmVjdCAoY2FwcGVkIGF0IDYwIHMpLlxuICpcbiAqIEEgMSBIeiBcInN1cGVydmlzaW9uIHRpY2tcIiBkcml2ZXMgZXZlcnl0aGluZyB0aW1lLWJhc2VkOiBpdCByZXBhaW50cyB0aGVcbiAqIHN0YXR1cyBiYXIgYW5kIG5vdGljZXMgYGRpc2Nvbm5lY3RlZGAgXHUyMTkyIHNjaGVkdWxlcyBvbmUgcmVjb25uZWN0IGF0IGEgdGltZS5cbiAqIEFsbCB0aW1lcnMgYXJlIG93bmVkIGhlcmUgYW5kIHRvcm4gZG93biBpbiBgc3RvcFN5bmMoKWAvYG9udW5sb2FkYC5cbiAqL1xuXG5pbXBvcnQgeyBOb3RpY2UsIFBsdWdpbiB9IGZyb20gJ29ic2lkaWFuJztcbmltcG9ydCB0eXBlIHsgQXBwLCBQbHVnaW5NYW5pZmVzdCB9IGZyb20gJ29ic2lkaWFuJztcbmltcG9ydCB7XG4gIGNoZWNrU2VydmVyQ29tcGF0aWJpbGl0eSxcbiAgUmV2b2tlZEVycm9yLFxuICBTeW5jQ2xpZW50LFxuICBVbmF1dGhvcml6ZWRFcnJvcixcbiAgdHlwZSBDb21wYXRpYmlsaXR5VmVyZGljdCxcbiAgdHlwZSBTeW5jQ2xpZW50U3RhdHVzLFxufSBmcm9tICdAdnNhL2NvcmUnO1xuaW1wb3J0IHsgT2JzaWRpYW5TdG9yYWdlQWRhcHRlciB9IGZyb20gJy4vYWRhcHRlcnMvb2JzaWRpYW4tc3RvcmFnZS5qcyc7XG5pbXBvcnQgeyBPYnNpZGlhbldhdGNoQWRhcHRlciwgUmVzY2FuU2NoZWR1bGVyIH0gZnJvbSAnLi9hZGFwdGVycy9vYnNpZGlhbi13YXRjaC5qcyc7XG5pbXBvcnQgeyBIdHRwQmxvYlN0b3JlIH0gZnJvbSAnLi9ibG9ic3RvcmUuanMnO1xuaW1wb3J0IHtcbiAgYnVpbGREaWFnbm9zdGljc0J1bmRsZSxcbiAgYnVpbGRTdXBwb3J0QnVuZGxlLFxuICBjb3B5VG9DbGlwYm9hcmQsXG4gIGNyZWF0ZVBsdWdpbkxvZyxcbiAgZm9ybWF0U3VwcG9ydEJ1bmRsZVN0YW1wLFxuICBwbGF0Zm9ybVN1bW1hcnksXG4gIHdpdGhSb3VuZFRyaXBMb2dnaW5nLFxuICB0eXBlIERpYWdub3N0aWNzSW5wdXQsXG4gIHR5cGUgUGx1Z2luTG9nLFxufSBmcm9tICcuL2RpYWdub3N0aWNzLmpzJztcbmltcG9ydCB7XG4gIGRlZmF1bHREZXZpY2VOYW1lLFxuICBkZXRlY3REZXZpY2VUeXBlLFxuICBpc0xpbmtlZCxcbiAgbm9ybWFsaXplUGx1Z2luRGF0YSxcbiAgcGFyc2VJZ25vcmVQYXR0ZXJucyxcbiAgZGVmYXVsdFBsdWdpbkRhdGEsXG4gIHR5cGUgTG9nTGV2ZWwsXG4gIHR5cGUgVmF1bHRTeW5jUGx1Z2luRGF0YSxcbn0gZnJvbSAnLi9kYXRhLmpzJztcbmltcG9ydCB7IHBhaXJPdXRjb21lTWVzc2FnZSwgcGFpcldpdGhXb3JrZXIgfSBmcm9tICcuL3BhaXJpbmcuanMnO1xuaW1wb3J0IHR5cGUgeyBQYWlyT3V0Y29tZSB9IGZyb20gJy4vcGFpcmluZy5qcyc7XG5pbXBvcnQgeyByZWdpc3RlclBhaXJQcm90b2NvbEhhbmRsZXIgfSBmcm9tICcuL3Byb3RvY29sLWhhbmRsZXIuanMnO1xuaW1wb3J0IHsgUmVjb25uZWN0U3VwZXJ2aXNvciB9IGZyb20gJy4vcmVjb25uZWN0LmpzJztcbmltcG9ydCB0eXBlIHsgQmFja29mZk9wdGlvbnMgfSBmcm9tICcuL3JlY29ubmVjdC5qcyc7XG5pbXBvcnQgdHlwZSB7IFN0YXR1c0Jhck1vZGUgfSBmcm9tICcuL3N0YXR1c2Jhci5qcyc7XG5pbXBvcnQgeyBDb25maXJtTW9kYWwsIFZhdWx0U3luY1NldHRpbmdUYWIgfSBmcm9tICcuL3NldHRpbmdzLmpzJztcbmltcG9ydCB7IFN0YXR1c0JhckluZGljYXRvciB9IGZyb20gJy4vc3RhdHVzYmFyLmpzJztcbmltcG9ydCB7IFdlYlNvY2tldFRyYW5zcG9ydCB9IGZyb20gJy4vdHJhbnNwb3J0LmpzJztcbmltcG9ydCB0eXBlIHsgV2ViU29ja2V0RmFjdG9yeSB9IGZyb20gJy4vdHJhbnNwb3J0LmpzJztcbmltcG9ydCB7IGZldGNoV29ya2VyU3RhdHVzLCBub3JtYWxpemVXb3JrZXJVcmwsIHJlbmFtZURldmljZSB9IGZyb20gJy4vd29ya2VyYXBpLmpzJztcbmltcG9ydCB0eXBlIHsgV29ya2VyU3RhdHVzU3VtbWFyeSB9IGZyb20gJy4vd29ya2VyYXBpLmpzJztcblxuLyoqIFRoZSBpbi12YXVsdCBkZXZpY2UgbWFya2VyIHNoYXJlZCB3aXRoIHRoZSBkYWVtb24vQ0xJIChGUi00NCBoYW5kc2hha2UpLiAqL1xuY29uc3QgREVWSUNFX01BUktFUl9WQVVMVF9QQVRIID0gJy8udmF1bHRzeW5jZm9yYWdlbnRzL2RldmljZS5qc29uJztcbmNvbnN0IExPQ0FMX0lOREVYX1ZBVUxUX1BBVEggPSAnLy52YXVsdHN5bmNmb3JhZ2VudHMvc3RhdGUnO1xuLyoqIFdoZXJlIFwiU2F2ZSBzdXBwb3J0IGJ1bmRsZVwiIHdyaXRlcyBpdHMgZGlhZ25vc3RpYyBmaWxlLiAqL1xuY29uc3QgU1VQUE9SVF9CVU5ETEVfRElSX1ZBVUxUX1BBVEggPSAnLy52YXVsdHN5bmNmb3JhZ2VudHMnO1xuY29uc3QgU1VQRVJWSVNJT05fVElDS19NUyA9IDEwMDA7XG5cbi8qKiBUaW1lciBoYW5kbGVzIChudW1iZXIgaW4gdGhlIERPTSwgYFRpbWVvdXRgIHdoZW4gTm9kZSB0eXBlcyBsZWFrIGluKS4gKi9cbnR5cGUgVGltZXJIYW5kbGUgPSBSZXR1cm5UeXBlPHR5cGVvZiBzZXRJbnRlcnZhbD47XG5cbi8qKiBJbmplY3RhYmxlIHNlYW1zIHNvIHVuaXQgdGVzdHMgbmVlZCBubyByZWFsIE9ic2lkaWFuL25ldHdvcmsuICovXG5leHBvcnQgaW50ZXJmYWNlIFBsdWdpbk92ZXJyaWRlcyB7XG4gIGZldGNoSW1wbD86IHR5cGVvZiBmZXRjaDtcbiAgd3NGYWN0b3J5PzogV2ViU29ja2V0RmFjdG9yeTtcbiAgbm93PzogKCkgPT4gbnVtYmVyO1xuICAvKiogUmVjb25uZWN0IGJhY2tvZmYga25vYnMgKHRlc3RzIGluamVjdCBhIGRldGVybWluaXN0aWMgcmFuZG9tKS4gKi9cbiAgcmVjb25uZWN0PzogQmFja29mZk9wdGlvbnM7XG59XG5cbmV4cG9ydCBjbGFzcyBWYXVsdFN5bmNQbHVnaW4gZXh0ZW5kcyBQbHVnaW4ge1xuICBkYXRhOiBWYXVsdFN5bmNQbHVnaW5EYXRhID0gZGVmYXVsdFBsdWdpbkRhdGEoKTtcbiAgLyoqIFRoZSBsaXZlIHN5bmMgY2xpZW50IChudWxsIHdoaWxlIHVubGlua2VkL3N0b3BwZWQpLiAqL1xuICBjbGllbnQ6IFN5bmNDbGllbnQgfCBudWxsID0gbnVsbDtcblxuICBwcml2YXRlIHJlYWRvbmx5IG92ZXJyaWRlczogUGx1Z2luT3ZlcnJpZGVzO1xuICBwcml2YXRlIHdhdGNoZXI6IE9ic2lkaWFuV2F0Y2hBZGFwdGVyIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgcmVzY2FuOiBSZXNjYW5TY2hlZHVsZXIgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBzdGF0dXNCYXI6IFN0YXR1c0JhckluZGljYXRvciB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHN0YXR1c0Jhckl0ZW06IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgdGlja0hhbmRsZTogVGltZXJIYW5kbGUgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSByZWNvbm5lY3RUaW1lcjogVGltZXJIYW5kbGUgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBzdXBlcnZpc29yID0gbmV3IFJlY29ubmVjdFN1cGVydmlzb3IoKTtcbiAgLyoqIFNldCB3aGVuIHRoZSB3b3JrZXIgcmVqZWN0ZWQgdGhlIHRva2VuIFx1MjAxNCByZWNvbm5lY3RpbmcgY2Fubm90IGhlbHAuICovXG4gIHByaXZhdGUgYXV0aEZhaWxlZCA9IGZhbHNlO1xuICBwcml2YXRlIHN0YXR1c05vdGUgPSAnJztcbiAgLyoqXG4gICAqIExhdGVzdCBzZXJ2ZXItdmVyc2lvbiB2ZXJkaWN0IChjb3JlIGNvbXBhdC50cyksIHJlLWFzc2Vzc2VkIGJ5IHRoZVxuICAgKiBzdXBlcnZpc2lvbiB0aWNrIGFmdGVyIGV2ZXJ5IGhlbGxvQWNrOyBudWxsIGJlZm9yZSB0aGUgZmlyc3QgYWNrIG9mIGFcbiAgICogc3luYyBzZXNzaW9uLiBOb24tb2sgdmVyZGljdHMgcmlkZSB0aGUgc3RhdHVzLWJhciB0b29sdGlwOyBhIE5vdGljZSBpc1xuICAgKiBzaG93biBhdCBtb3N0IG9uY2UgcGVyIHBsdWdpbiBzZXNzaW9uLlxuICAgKi9cbiAgcHJpdmF0ZSBzZXJ2ZXJDb21wYXQ6IENvbXBhdGliaWxpdHlWZXJkaWN0IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgc2VydmVyQ29tcGF0Tm90aWZpZWQgPSBmYWxzZTtcbiAgLyoqIFBhdXNlLXN5bmNpbmcgc3RhdGUgKHJ1bnRpbWUgb25seSBcdTIwMTQgYSByZWxvYWQgc3RhcnRzIHBlciBzeW5jT25TdGFydHVwKS4gKi9cbiAgcHJpdmF0ZSBwYXVzZWQgPSBmYWxzZTtcbiAgLyoqIFRoZSBwbHVnaW4ncyBsb2c6IGNvbnNvbGUgbWlycm9yICsgYm91bmRlZCByaW5nIChDb3B5IGRpYWdub3N0aWNzKS4gKi9cbiAgcHJpdmF0ZSByZWFkb25seSBzeW5jTG9nOiBQbHVnaW5Mb2cgPSBjcmVhdGVQbHVnaW5Mb2coKTtcblxuICBjb25zdHJ1Y3RvcihhcHA6IEFwcCwgbWFuaWZlc3Q6IFBsdWdpbk1hbmlmZXN0LCBvdmVycmlkZXM6IFBsdWdpbk92ZXJyaWRlcyA9IHt9KSB7XG4gICAgc3VwZXIoYXBwLCBtYW5pZmVzdCk7XG4gICAgdGhpcy5vdmVycmlkZXMgPSBvdmVycmlkZXM7XG4gIH1cblxuICBwcml2YXRlIGdldCBub3coKTogKCkgPT4gbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy5vdmVycmlkZXMubm93ID8/ICgoKSA9PiBEYXRlLm5vdygpKTtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0IGZldGNoSW1wbCgpOiB0eXBlb2YgZmV0Y2gge1xuICAgIC8vIEJpbmQgYXQgdGhlIHNlYW06IGNvbnN1bWVycyAocGFpcmluZywgYEh0dHBCbG9iU3RvcmVgKSBpbnZva2UgdGhpcyBhcyBhXG4gICAgLy8gZGV0YWNoZWQgZnVuY3Rpb24sIGFuZCBhIGRldGFjaGVkIGBmZXRjaGAgdGhyb3dzXG4gICAgLy8gYFR5cGVFcnJvcjogRmFpbGVkIHRvIGV4ZWN1dGUgJ2ZldGNoJyBvbiAnV2luZG93JzogSWxsZWdhbCBpbnZvY2F0aW9uYFxuICAgIC8vIGluIENocm9taXVtIHJlbmRlcmVycyBcdTIwMTQgaS5lLiBpbiByZWFsIE9ic2lkaWFuIChkZXNrdG9wIGFuZCBtb2JpbGUpLlxuICAgIC8vIEJpbmRpbmcgdG8gdGhlIGdsb2JhbCBtYWtlcyB0aGUgZGVmYXVsdCBzYWZlIHRvIGNhbGwgYmFyZS5cbiAgICByZXR1cm4gdGhpcy5vdmVycmlkZXMuZmV0Y2hJbXBsID8/IGdsb2JhbFRoaXMuZmV0Y2guYmluZChnbG9iYWxUaGlzKTtcbiAgfVxuXG4gIGdldCBsaW5rZWQoKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGlzTGlua2VkKHRoaXMuZGF0YSk7XG4gIH1cblxuICBvdmVycmlkZSBhc3luYyBvbmxvYWQoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5kYXRhID0gbm9ybWFsaXplUGx1Z2luRGF0YShhd2FpdCB0aGlzLmxvYWREYXRhKCkpO1xuICAgIHRoaXMuc3luY0xvZy5zZXRMZXZlbCh0aGlzLmRhdGEuc2V0dGluZ3MubG9nTGV2ZWwpO1xuICAgIHRoaXMuYWRkU2V0dGluZ1RhYihuZXcgVmF1bHRTeW5jU2V0dGluZ1RhYih0aGlzLmFwcCwgdGhpcykpO1xuICAgIHJlZ2lzdGVyUGFpclByb3RvY29sSGFuZGxlcihcbiAgICAgIChhY3Rpb24sIGhhbmRsZXIpID0+IHRoaXMucmVnaXN0ZXJPYnNpZGlhblByb3RvY29sSGFuZGxlcihhY3Rpb24sIGhhbmRsZXIpLFxuICAgICAgKGxpbmspID0+IHRoaXMuaGFuZGxlUGFpckRlZXBMaW5rKGxpbmsudXJsLCBsaW5rLmNvZGUpLFxuICAgICk7XG4gICAgLy8gQ2hlYXAgZm9jdXMtZHJpdmVuIHJlc2NhbiAoRlItMTIpOiBldmVyeSBub3RlL2FwcCBzd2l0Y2ggcG9rZXMgdGhlXG4gICAgLy8gc2NoZWR1bGVyLCB3aGljaCBjb2FsZXNjZXMgaW50byBhdCBtb3N0IG9uZSBjeWNsZSBwZXIgZGVib3VuY2Ugd2luZG93LlxuICAgIHRoaXMucmVnaXN0ZXJFdmVudCh0aGlzLmFwcC53b3Jrc3BhY2Uub24oJ2FjdGl2ZS1sZWFmLWNoYW5nZScsICgpID0+IHRoaXMucmVzY2FuPy5wb2tlKCkpKTtcbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6ICdjb3B5LWRpYWdub3N0aWNzJyxcbiAgICAgIG5hbWU6ICdDb3B5IGRpYWdub3N0aWNzJyxcbiAgICAgIGNhbGxiYWNrOiAoKSA9PiB0aGlzLmNvcHlEaWFnbm9zdGljcygpLFxuICAgIH0pO1xuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogJ3NhdmUtc3VwcG9ydC1idW5kbGUnLFxuICAgICAgbmFtZTogJ1NhdmUgc3VwcG9ydCBidW5kbGUnLFxuICAgICAgY2FsbGJhY2s6ICgpID0+IHRoaXMuc2F2ZVN1cHBvcnRCdW5kbGUoKSxcbiAgICB9KTtcbiAgICAvLyBcIlN5bmMgb24gc3RhcnR1cFwiIE9GRiA9IG1hbnVhbC1vbmx5IG1vZGU6IGxvYWQgaWRsZTsgdGhlIGZpcnN0IFwiU3luY1xuICAgIC8vIG5vd1wiIHN0YXJ0cyB0aGUgbWFjaGluZXJ5ICh3YXRjaGVyIGluY2x1ZGVkKS5cbiAgICBpZiAodGhpcy5saW5rZWQgJiYgdGhpcy5kYXRhLnNldHRpbmdzLnN5bmNPblN0YXJ0dXApIGF3YWl0IHRoaXMuc3RhcnRTeW5jKCk7XG4gIH1cblxuICBvdmVycmlkZSBvbnVubG9hZCgpOiB2b2lkIHtcbiAgICB0aGlzLnN0b3BTeW5jKCk7XG4gIH1cblxuICAvLyAtLS0gcGVyc2lzdGVuY2UgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICBhc3luYyBzYXZlUGx1Z2luRGF0YSgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLnNhdmVEYXRhKHRoaXMuZGF0YSk7XG4gIH1cblxuICAvLyAtLS0gcGFpcmluZyAoc2V0dGluZ3MgdGFiICsgZGVlcCBsaW5rKSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIC8qKiBQYWlyIGZyb20gdGhlIHNldHRpbmdzIGZvcm0gKGZpZWxkcyBhbHJlYWR5IGxpdmUgaW4gYHRoaXMuZGF0YWApLiAqL1xuICBhc3luYyBwYWlyRnJvbVNldHRpbmdzKGNvZGU6IHN0cmluZyk6IFByb21pc2U8UGFpck91dGNvbWU+IHtcbiAgICBjb25zdCBkZXZpY2VOYW1lID0gdGhpcy5yZXNvbHZlRGV2aWNlTmFtZSgpO1xuICAgIGNvbnN0IG91dGNvbWUgPSBhd2FpdCBwYWlyV2l0aFdvcmtlcih7XG4gICAgICB1cmw6IHRoaXMuZGF0YS51cmwsXG4gICAgICBjb2RlLFxuICAgICAgZGV2aWNlTmFtZSxcbiAgICAgIGRldmljZVR5cGU6IGRldGVjdERldmljZVR5cGUoKSxcbiAgICAgIGZldGNoSW1wbDogdGhpcy5mZXRjaEltcGwsXG4gICAgfSk7XG4gICAgYXdhaXQgdGhpcy5hcHBseVBhaXJPdXRjb21lKG91dGNvbWUsIGRldmljZU5hbWUpO1xuICAgIHJldHVybiBvdXRjb21lO1xuICB9XG5cbiAgLyoqXG4gICAqIG9ic2lkaWFuOi8vdmF1bHRzeW5jZm9yYWdlbnRzL3BhaXI/dXJsPVx1MjAyNiZjb2RlPVx1MjAyNiAocHJvdG9jb2wtaGFuZGxlci50cykuXG4gICAqIE9uIGFuIHVubGlua2VkIHZhdWx0IHRoZSBsaW5rJ3Mgb3JpZ2luIGlzIHVudHJ1c3RlZCB1bnRpbCB0aGUgdXNlclxuICAgKiBhcHByb3ZlcyBpdCBcdTIwMTQgcGFpcmluZyB3b3VsZCBoYW5kIHRoZSB3aG9sZSB2YXVsdCB0byB3aGF0ZXZlciBob3N0IHRoZVxuICAgKiBsaW5rIGNhcnJpZWQgXHUyMDE0IHNvIGl0IGdvZXMgdGhyb3VnaCBhIGNvbmZpcm1hdGlvbiBuYW1pbmcgdGhhdCBleGFjdCBVUkwuXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIGhhbmRsZVBhaXJEZWVwTGluayh1cmw6IHN0cmluZywgY29kZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKHRoaXMubGlua2VkKSB7XG4gICAgICBpZiAobm9ybWFsaXplV29ya2VyVXJsU2FmZSh1cmwpID09PSBub3JtYWxpemVXb3JrZXJVcmxTYWZlKHRoaXMuZGF0YS51cmwpKSB7XG4gICAgICAgIG5ldyBOb3RpY2UoJ1ZhdWx0U3luYzogdGhpcyB2YXVsdCBpcyBhbHJlYWR5IHBhaXJlZCB3aXRoIHRoYXQgd29ya2VyLicpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbmV3IE5vdGljZShcbiAgICAgICAgICAnVmF1bHRTeW5jOiB0aGlzIHZhdWx0IGlzIHBhaXJlZCB3aXRoIGEgZGlmZmVyZW50IHdvcmtlci4gVW5saW5rIGl0IGluIHNldHRpbmdzIGZpcnN0LicsXG4gICAgICAgICAgMTAwMDAsXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIG5ldyBDb25maXJtTW9kYWwodGhpcy5hcHAsIHtcbiAgICAgIHRpdGxlOiAnUGFpciBWYXVsdFN5bmM/JyxcbiAgICAgIGJvZHk6XG4gICAgICAgIGBBIHBhaXJpbmcgbGluayBhc2tlZCBPYnNpZGlhbiB0byBwYWlyIHRoaXMgdmF1bHQgd2l0aCB0aGUgd29ya2VyIGF0OlxcblxcbiR7dXJsfVxcblxcbmAgK1xuICAgICAgICAnQXBwcm92aW5nIHBhaXJzIHRoaXMgZGV2aWNlIGFuZCBzZW5kcyB0aGlzIHZhdWx0XFx1MjAxOXMgbm90ZXMgdG8gdGhhdCB3b3JrZXIgZnJvbSB0aGVuIG9uLiAnICtcbiAgICAgICAgJ09ubHkgYXBwcm92ZSBhIGxpbmsgeW91IG9wZW5lZCBmcm9tIHlvdXIgb3duIHdvcmtlciBkYXNoYm9hcmQgXHUyMDE0IGFueSB3ZWIgcGFnZSBjYW4gY3JhZnQgb25lLicsXG4gICAgICBjb25maXJtVGV4dDogJ1BhaXInLFxuICAgICAgb25Db25maXJtOiAoKSA9PiB0aGlzLnBhaXJGcm9tRGVlcExpbmsodXJsLCBjb2RlKSxcbiAgICB9KS5vcGVuKCk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHBhaXJGcm9tRGVlcExpbmsodXJsOiBzdHJpbmcsIGNvZGU6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGRldmljZU5hbWUgPSB0aGlzLnJlc29sdmVEZXZpY2VOYW1lKCk7XG4gICAgY29uc3Qgb3V0Y29tZSA9IGF3YWl0IHBhaXJXaXRoV29ya2VyKHtcbiAgICAgIHVybCxcbiAgICAgIGNvZGUsXG4gICAgICBkZXZpY2VOYW1lLFxuICAgICAgZGV2aWNlVHlwZTogZGV0ZWN0RGV2aWNlVHlwZSgpLFxuICAgICAgZmV0Y2hJbXBsOiB0aGlzLmZldGNoSW1wbCxcbiAgICB9KTtcbiAgICBhd2FpdCB0aGlzLmFwcGx5UGFpck91dGNvbWUob3V0Y29tZSwgZGV2aWNlTmFtZSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGFwcGx5UGFpck91dGNvbWUob3V0Y29tZTogUGFpck91dGNvbWUsIGRldmljZU5hbWU6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmIChvdXRjb21lLnN0YXR1cyAhPT0gJ3BhaXJlZCcpIHtcbiAgICAgIG5ldyBOb3RpY2UocGFpck91dGNvbWVNZXNzYWdlKG91dGNvbWUpLCAxMDAwMCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRoaXMuZGF0YS51cmwgPSBvdXRjb21lLnVybDtcbiAgICB0aGlzLmRhdGEudG9rZW4gPSBvdXRjb21lLnRva2VuO1xuICAgIHRoaXMuZGF0YS5kZXZpY2VJZCA9IG91dGNvbWUuZGV2aWNlSWQ7XG4gICAgdGhpcy5kYXRhLmRldmljZU5hbWUgPSBkZXZpY2VOYW1lO1xuICAgIGF3YWl0IHRoaXMuc2F2ZVBsdWdpbkRhdGEoKTtcbiAgICBhd2FpdCB0aGlzLndyaXRlRGV2aWNlTWFya2VyKCk7XG4gICAgbmV3IE5vdGljZShwYWlyT3V0Y29tZU1lc3NhZ2Uob3V0Y29tZSkpO1xuICAgIGF3YWl0IHRoaXMuc3RhcnRTeW5jKCk7XG4gIH1cblxuICBwcml2YXRlIHJlc29sdmVEZXZpY2VOYW1lKCk6IHN0cmluZyB7XG4gICAgY29uc3QgdHlwZWQgPSB0aGlzLmRhdGEuZGV2aWNlTmFtZS50cmltKCk7XG4gICAgcmV0dXJuIHR5cGVkICE9PSAnJyA/IHR5cGVkIDogZGVmYXVsdERldmljZU5hbWUoKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBUaGUgdmF1bHQtYmFja2VkIHN0b3JhZ2UgYWRhcHRlciBldmVyeSBzeW5jIHN1cmZhY2UgdXNlcy4gV2lyZXMgdGhlXG4gICAqIGVtcHR5LWZvbGRlciByZW1vdmFsIHRocm91Z2ggYGZpbGVNYW5hZ2VyLnRyYXNoRmlsZWAgXHUyMDE0IE9ic2lkaWFuJ3NcbiAgICogYERhdGFBZGFwdGVyLnJtZGlyYCByZWZ1c2VzIEVWRVJZIGRpcmVjdG9yeSAoYEVSUl9GU19FSVNESVJgKSwgd2hpY2hcbiAgICogc2lsZW50bHkgZGVncmFkZWQgZm9sZGVyLXRvbWJzdG9uZSBhcHBsaWNhdGlvbiB0byByZWNvcmQtb25seSAoRi0xKS5cbiAgICogVHJhc2ggKG5vdCBkZWxldGUpIGJlY2F1c2UgYW4gZW1wdHkgZm9sZGVyIGlzIHRyaXZpYWxseSByZWNvdmVyYWJsZS5cbiAgICovXG4gIHByaXZhdGUgY3JlYXRlU3RvcmFnZUFkYXB0ZXIoKTogT2JzaWRpYW5TdG9yYWdlQWRhcHRlciB7XG4gICAgcmV0dXJuIG5ldyBPYnNpZGlhblN0b3JhZ2VBZGFwdGVyKHtcbiAgICAgIGFkYXB0ZXI6IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIsXG4gICAgICByZW1vdmVFbXB0eURpcjogYXN5bmMgKGFkYXB0ZXJQYXRoKSA9PiB7XG4gICAgICAgIGNvbnN0IGZvbGRlciA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChhZGFwdGVyUGF0aCk7XG4gICAgICAgIGlmIChmb2xkZXIgPT09IG51bGwpIHJldHVybjsgLy8gcmFjZWQgYXdheSAvIHRyZWUgbm90IGNhdWdodCB1cCBcdTIwMTQgaWRlbXBvdGVudFxuICAgICAgICBhd2FpdCB0aGlzLmFwcC5maWxlTWFuYWdlci50cmFzaEZpbGUoZm9sZGVyKTtcbiAgICAgIH0sXG4gICAgfSk7XG4gIH1cblxuICAvKiogV3JpdGUgdGhlIEZSLTQ0IG1hcmtlciB0aGUgQ0xJL2RhZW1vbiByZWFkIHRvIGRldGVjdCBkb3VibGUtY2xpZW50cy4gKi9cbiAgcHJpdmF0ZSBhc3luYyB3cml0ZURldmljZU1hcmtlcigpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIXRoaXMubGlua2VkKSByZXR1cm47XG4gICAgY29uc3Qgc3RvcmFnZSA9IHRoaXMuY3JlYXRlU3RvcmFnZUFkYXB0ZXIoKTtcbiAgICBjb25zdCBtYXJrZXIgPSB7XG4gICAgICBkZXZpY2VJZDogdGhpcy5kYXRhLmRldmljZUlkLFxuICAgICAgZGV2aWNlTmFtZTogdGhpcy5yZXNvbHZlRGV2aWNlTmFtZSgpLFxuICAgICAgdXJsOiB0aGlzLmRhdGEudXJsLFxuICAgICAgbGlua2VkQXQ6IHRoaXMubm93KCksXG4gICAgfTtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgc3RvcmFnZS53cml0ZUZpbGUoXG4gICAgICAgIERFVklDRV9NQVJLRVJfVkFVTFRfUEFUSCxcbiAgICAgICAgbmV3IFRleHRFbmNvZGVyKCkuZW5jb2RlKGAke0pTT04uc3RyaW5naWZ5KG1hcmtlciwgbnVsbCwgMil9XFxuYCksXG4gICAgICApO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLnN5bmNMb2cud2FybignZmFpbGVkIHRvIHdyaXRlIGRldmljZSBtYXJrZXInLCBlcnJvcik7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIGBQQVRDSCAvZGV2aWNlYCBcdTIwMTQgcmVuYW1lIFRISVMgZGV2aWNlIG9uIHRoZSB3b3JrZXIgKHRoZSBzZXR0aW5ncyB0YWInc1xuICAgKiBSZW5hbWUgYnV0dG9uKS4gVXBkYXRlcyBwbHVnaW4gZGF0YSArIHRoZSBpbi12YXVsdCBkZXZpY2UgbWFya2VyICh3aGljaFxuICAgKiBzdG9yZXMgdGhlIG5hbWUgZm9yIHRoZSBGUi00NCBkb3VibGUtY2xpZW50IHdhcm5pbmcpLiBMb2NhbCBzdGF0ZSBrZWVwc1xuICAgKiBpdHMgcHJldmlvdXMgbmFtZSBvbiBmYWlsdXJlLlxuICAgKi9cbiAgYXN5bmMgcmVuYW1lRGV2aWNlKG5hbWU6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIGlmICghdGhpcy5saW5rZWQpIHtcbiAgICAgIG5ldyBOb3RpY2UoJ1ZhdWx0U3luYzogcGFpciB0aGlzIHZhdWx0IGZpcnN0IFx1MjAxNCB0aGUgbmFtZSBhcHBsaWVzIGF0IHBhaXJpbmcgdGltZS4nKTtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgY29uc3QgdHJpbW1lZCA9IG5hbWUudHJpbSgpO1xuICAgIGlmICh0cmltbWVkID09PSAnJyB8fCB0cmltbWVkLmxlbmd0aCA+IDMwIHx8IC9bXFx1MDAwMC1cXHUwMDFmXFx1MDA3Zl0vLnRlc3QodHJpbW1lZCkpIHtcbiAgICAgIG5ldyBOb3RpY2UoJ1ZhdWx0U3luYzogZGV2aWNlIG5hbWUgbXVzdCBiZSAxLTMwIGNoYXJhY3RlcnMsIHdpdGhvdXQgY29udHJvbCBjaGFyYWN0ZXJzLicsIDgwMDApO1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICBjb25zdCBvdXRjb21lID0gYXdhaXQgcmVuYW1lRGV2aWNlKHtcbiAgICAgIG9yaWdpbjogdGhpcy5kYXRhLnVybCxcbiAgICAgIHRva2VuOiB0aGlzLmRhdGEudG9rZW4sXG4gICAgICBuYW1lOiB0cmltbWVkLFxuICAgICAgZmV0Y2hJbXBsOiB0aGlzLmZldGNoSW1wbCxcbiAgICB9KTtcbiAgICBpZiAoIW91dGNvbWUub2spIHtcbiAgICAgIG5ldyBOb3RpY2UoYFZhdWx0U3luYzogcmVuYW1pbmcgZmFpbGVkIFx1MjAxNCAke291dGNvbWUuZXJyb3J9YCwgMTAwMDApO1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICB0aGlzLmRhdGEuZGV2aWNlTmFtZSA9IG91dGNvbWUuZGV2aWNlLm5hbWU7XG4gICAgYXdhaXQgdGhpcy5zYXZlUGx1Z2luRGF0YSgpO1xuICAgIGF3YWl0IHRoaXMud3JpdGVEZXZpY2VNYXJrZXIoKTtcbiAgICBuZXcgTm90aWNlKGBWYXVsdFN5bmM6IGRldmljZSByZW5hbWVkIHRvIFx1MjAxQyR7b3V0Y29tZS5kZXZpY2UubmFtZX1cdTIwMUQuYCk7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICAvLyAtLS0gc3luYyBsaWZlY3ljbGUgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgLyoqIEJ1aWxkIGV2ZXJ5dGhpbmcgYW5kIHJ1biBzdGFydHVwIHJlY29uY2lsaWF0aW9uIChpZGVtcG90ZW50IHJlc3RhcnQpLiAqL1xuICBwcml2YXRlIGFzeW5jIHN0YXJ0U3luYygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIXRoaXMubGlua2VkKSByZXR1cm47XG4gICAgdGhpcy5zdG9wU3luYygpO1xuXG4gICAgY29uc3QgeyB1cmwsIHRva2VuLCBkZXZpY2VJZCB9ID0gdGhpcy5kYXRhO1xuICAgIGNvbnN0IGRldmljZU5hbWUgPSB0aGlzLnJlc29sdmVEZXZpY2VOYW1lKCk7XG4gICAgY29uc3Qgc3RvcmFnZSA9IHRoaXMuY3JlYXRlU3RvcmFnZUFkYXB0ZXIoKTtcbiAgICBhd2FpdCB0aGlzLndhcm5JZkZvcmVpZ25TdGF0ZURpcihzdG9yYWdlKTtcblxuICAgIGNvbnN0IGNsaWVudCA9IG5ldyBTeW5jQ2xpZW50KHtcbiAgICAgIGRldmljZUlkLFxuICAgICAgZGV2aWNlTmFtZSxcbiAgICAgIHRva2VuLFxuICAgICAgdHJhbnNwb3J0OiAoKSA9PlxuICAgICAgICB3aXRoUm91bmRUcmlwTG9nZ2luZyhcbiAgICAgICAgICBuZXcgV2ViU29ja2V0VHJhbnNwb3J0KHsgdXJsLCB0b2tlbiwgd3NGYWN0b3J5OiB0aGlzLm92ZXJyaWRlcy53c0ZhY3RvcnkgfSksXG4gICAgICAgICAgeyBsb2c6IHRoaXMuc3luY0xvZywgc2hvdWxkTG9nOiAoKSA9PiB0aGlzLnN5bmNMb2cuZGVidWdFbmFibGVkIH0sXG4gICAgICAgICksXG4gICAgICBibG9iU3RvcmU6IG5ldyBIdHRwQmxvYlN0b3JlKHsgYmFzZVVybDogdXJsLCB0b2tlbiwgZmV0Y2hJbXBsOiB0aGlzLmZldGNoSW1wbCB9KSxcbiAgICAgIHN0b3JhZ2UsXG4gICAgICBzZXR0aW5nczoge1xuICAgICAgICBvYnNpZGlhblN5bmM6IHRoaXMuZGF0YS5zZXR0aW5ncy5vYnNpZGlhblN5bmMsXG4gICAgICAgIGV4dHJhSWdub3JlczogcGFyc2VJZ25vcmVQYXR0ZXJucyh0aGlzLmRhdGEuc2V0dGluZ3MuaWdub3JlUGF0dGVybnMpLFxuICAgICAgfSxcbiAgICAgIGxvZzogdGhpcy5zeW5jTG9nLFxuICAgICAgbm93OiB0aGlzLm5vdyxcbiAgICB9KTtcbiAgICB0aGlzLmNsaWVudCA9IGNsaWVudDtcbiAgICB0aGlzLmF1dGhGYWlsZWQgPSBmYWxzZTtcbiAgICB0aGlzLnN0YXR1c05vdGUgPSAnJztcbiAgICB0aGlzLnNlcnZlckNvbXBhdCA9IG51bGw7IC8vIHJlLWFzc2Vzc2VkIGZyb20gdGhlIGZyZXNoIGhlbGxvQWNrXG4gICAgdGhpcy5zdXBlcnZpc29yID0gbmV3IFJlY29ubmVjdFN1cGVydmlzb3IodGhpcy5vdmVycmlkZXMucmVjb25uZWN0ID8/IHt9KTtcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBjbGllbnQuY29ubmVjdCgpOyAvLyBzdGFydHVwIHJlY29uY2lsaWF0aW9uIFx1MjE5MiBsaXZlIG1vZGVcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5oYW5kbGVTeW5jRXJyb3IoZXJyb3IsICdzdGFydHVwIHN5bmMgZmFpbGVkJyk7XG4gICAgfVxuXG4gICAgLy8gTGl2ZSB3YXRjaGluZzogdmF1bHQgZXZlbnRzIChkZWJvdW5jZWQgaW4gY29yZSkgKyByZXNjYW4gaG9va3MuXG4gICAgdGhpcy53YXRjaGVyID0gbmV3IE9ic2lkaWFuV2F0Y2hBZGFwdGVyKHsgdmF1bHQ6IHRoaXMuYXBwLnZhdWx0IH0pO1xuICAgIGNsaWVudC5zdGFydFdhdGNoaW5nKHRoaXMud2F0Y2hlcik7XG4gICAgdGhpcy5yZXNjYW4gPSBuZXcgUmVzY2FuU2NoZWR1bGVyKHtcbiAgICAgIGludGVydmFsTXM6IHRoaXMuZGF0YS5zZXR0aW5ncy5yZXNjYW5JbnRlcnZhbFNlYyAqIDEwMDAsXG4gICAgfSk7XG4gICAgdGhpcy5yZXNjYW4uc3RhcnQoKCkgPT4ge1xuICAgICAgdm9pZCBjbGllbnQudHJpZ2dlclN5bmMoKS5jYXRjaCgoZXJyb3I6IHVua25vd24pID0+IHtcbiAgICAgICAgdGhpcy5oYW5kbGVTeW5jRXJyb3IoZXJyb3IsICdyZXNjYW4gZmFpbGVkJyk7XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIC8vIFN0YXR1cyBiYXIgKHBlciB0aGUgc3RhdHVzQmFyTW9kZSBzZXR0aW5nKSArIHRoZSAxIEh6IHN1cGVydmlzaW9uIHRpY2tcbiAgICAvLyB0aGF0IHJlcGFpbnRzIGl0IGFuZCBzdXBlcnZpc2VzIHJlY29ubmVjdGlvbi5cbiAgICB0aGlzLm1vdW50U3RhdHVzQmFyKCk7XG4gICAgY29uc3QgdGljayA9IHNldEludGVydmFsKCgpID0+IHRoaXMub25UaWNrKCksIFNVUEVSVklTSU9OX1RJQ0tfTVMpO1xuICAgIHRoaXMudGlja0hhbmRsZSA9IHRpY2s7XG4gICAgdGhpcy5yZWdpc3RlckludGVydmFsKHRpY2sgYXMgdW5rbm93biBhcyBudW1iZXIpOyAvLyBPYnNpZGlhbiBjbGVhcnMgdGhpcyBvbiB1bmxvYWRcbiAgICB0aGlzLm9uVGljaygpO1xuICB9XG5cbiAgLyoqIChSZSltb3VudCB0aGUgc3RhdHVzLWJhciBpdGVtIHBlciB0aGUgY3VycmVudCBtb2RlICgnaGlkZGVuJyA9IG5vbmUpLiAqL1xuICBwcml2YXRlIG1vdW50U3RhdHVzQmFyKCk6IHZvaWQge1xuICAgIHRoaXMuc3RhdHVzQmFySXRlbT8ucmVtb3ZlKCk7XG4gICAgdGhpcy5zdGF0dXNCYXJJdGVtID0gbnVsbDtcbiAgICB0aGlzLnN0YXR1c0JhciA9IG51bGw7XG4gICAgaWYgKHRoaXMuY2xpZW50ID09PSBudWxsKSByZXR1cm47XG4gICAgaWYgKHRoaXMuZGF0YS5zZXR0aW5ncy5zdGF0dXNCYXJNb2RlID09PSAnaGlkZGVuJykgcmV0dXJuO1xuICAgIGNvbnN0IGl0ZW0gPSB0aGlzLmFkZFN0YXR1c0Jhckl0ZW0oKTtcbiAgICB0aGlzLnN0YXR1c0Jhckl0ZW0gPSBpdGVtO1xuICAgIHRoaXMuc3RhdHVzQmFyID0gbmV3IFN0YXR1c0JhckluZGljYXRvcihpdGVtKTtcbiAgfVxuXG4gIC8qKiBUZWFyIGRvd24gZXZlcnkgdGltZXIsIHdhdGNoZXIsIHNvY2tldCwgYW5kIFVJIGFydGlmYWN0LiBJZGVtcG90ZW50LiAqL1xuICBwcml2YXRlIHN0b3BTeW5jKCk6IHZvaWQge1xuICAgIGlmICh0aGlzLnJlY29ubmVjdFRpbWVyICE9PSBudWxsKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGhpcy5yZWNvbm5lY3RUaW1lcik7XG4gICAgICB0aGlzLnJlY29ubmVjdFRpbWVyID0gbnVsbDtcbiAgICB9XG4gICAgaWYgKHRoaXMudGlja0hhbmRsZSAhPT0gbnVsbCkge1xuICAgICAgY2xlYXJJbnRlcnZhbCh0aGlzLnRpY2tIYW5kbGUpO1xuICAgICAgdGhpcy50aWNrSGFuZGxlID0gbnVsbDtcbiAgICB9XG4gICAgdGhpcy5yZXNjYW4/LnN0b3AoKTtcbiAgICB0aGlzLnJlc2NhbiA9IG51bGw7XG4gICAgdGhpcy5jbGllbnQ/LmNsb3NlKCk7IC8vIGFsc28gc3RvcHMgdGhlIHdhdGNoZXJcbiAgICB0aGlzLmNsaWVudCA9IG51bGw7XG4gICAgdGhpcy53YXRjaGVyID0gbnVsbDtcbiAgICB0aGlzLnN0YXR1c0Jhckl0ZW0/LnJlbW92ZSgpO1xuICAgIHRoaXMuc3RhdHVzQmFySXRlbSA9IG51bGw7XG4gICAgdGhpcy5zdGF0dXNCYXIgPSBudWxsO1xuICB9XG5cbiAgLy8gLS0tIHVzZXIgYWN0aW9ucyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgYXN5bmMgc3luY05vdygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAodGhpcy5wYXVzZWQpIHtcbiAgICAgIG5ldyBOb3RpY2UoJ1ZhdWx0U3luYzogc3luY2luZyBpcyBwYXVzZWQgXHUyMDE0IHJlc3VtZSBpdCBpbiBzZXR0aW5ncyBmaXJzdC4nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgY2xpZW50ID0gdGhpcy5jbGllbnQ7XG4gICAgaWYgKGNsaWVudCA9PT0gbnVsbCkge1xuICAgICAgaWYgKCF0aGlzLmxpbmtlZCkge1xuICAgICAgICBuZXcgTm90aWNlKCdWYXVsdFN5bmM6IG5vdCBwYWlyZWQgeWV0IFx1MjAxNCBhZGQgeW91ciB3b3JrZXIgVVJMIGFuZCBhIHBhaXJpbmcgY29kZSBpbiBzZXR0aW5ncy4nKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgLy8gTWFudWFsLW9ubHkgbW9kZSAoXCJTeW5jIG9uIHN0YXJ0dXBcIiBPRkYpOiB0aGlzIGlzIHRoZSBmaXJzdCBzdGFydC5cbiAgICAgIGF3YWl0IHRoaXMuc3RhcnRTeW5jKCk7XG4gICAgICBjb25zdCBzdGF0dXMgPSB0aGlzLmNsaWVudD8uc3RhdHVzKCk7XG4gICAgICBpZiAoc3RhdHVzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgbmV3IE5vdGljZShcbiAgICAgICAgICBzdGF0dXMuc3RhdGUgPT09ICdkaXNjb25uZWN0ZWQnXG4gICAgICAgICAgICA/ICdWYXVsdFN5bmM6IG9mZmxpbmUgXHUyMDE0IGNoYW5nZXMgd2lsbCBzeW5jIHdoZW4gdGhlIHdvcmtlciBpcyByZWFjaGFibGUuJ1xuICAgICAgICAgICAgOiAnVmF1bHRTeW5jOiB1cCB0byBkYXRlLicsXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBjbGllbnQudHJpZ2dlclN5bmMoKTtcbiAgICAgIGNvbnN0IHN0YXR1cyA9IGNsaWVudC5zdGF0dXMoKTtcbiAgICAgIG5ldyBOb3RpY2UoXG4gICAgICAgIHN0YXR1cy5zdGF0ZSA9PT0gJ2Rpc2Nvbm5lY3RlZCdcbiAgICAgICAgICA/ICdWYXVsdFN5bmM6IG9mZmxpbmUgXHUyMDE0IGNoYW5nZXMgd2lsbCBzeW5jIHdoZW4gdGhlIHdvcmtlciBpcyByZWFjaGFibGUuJ1xuICAgICAgICAgIDogJ1ZhdWx0U3luYzogdXAgdG8gZGF0ZS4nLFxuICAgICAgKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5oYW5kbGVTeW5jRXJyb3IoZXJyb3IsICdzeW5jIG5vdyBmYWlsZWQnKTtcbiAgICAgIG5ldyBOb3RpY2UoJ1ZhdWx0U3luYzogc3luYyBmYWlsZWQgXHUyMDE0IHNlZSB0aGUgZGV2ZWxvcGVyIGNvbnNvbGUgZm9yIGRldGFpbHMuJyk7XG4gICAgfVxuICB9XG5cbiAgLyoqIFBhdXNlOiB0cmFuc3BvcnQgZG93biArIHdhdGNoZXIvcmVzY2FuIGlkbGUsIGxpbmsgYW5kIHN0YXRlIGtlcHQuICovXG4gIHBhdXNlU3luY2luZygpOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMubGlua2VkIHx8IHRoaXMucGF1c2VkKSByZXR1cm47XG4gICAgdGhpcy5wYXVzZWQgPSB0cnVlO1xuICAgIGlmICh0aGlzLnJlY29ubmVjdFRpbWVyICE9PSBudWxsKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGhpcy5yZWNvbm5lY3RUaW1lcik7XG4gICAgICB0aGlzLnJlY29ubmVjdFRpbWVyID0gbnVsbDtcbiAgICB9XG4gICAgdGhpcy5zdXBlcnZpc29yLnNldHRsZWQoKTtcbiAgICB0aGlzLnJlc2Nhbj8uc3RvcCgpO1xuICAgIHRoaXMucmVzY2FuID0gbnVsbDtcbiAgICB0aGlzLmNsaWVudD8uY2xvc2UoKTsgLy8gYWxzbyBzdG9wcyB0aGUgd2F0Y2hlcjsgc3RhdGUgXHUyMTkyIGlkbGVcbiAgICB0aGlzLm9uVGljaygpOyAvLyByZXBhaW50IFwidnNhIFx1MjNGOFwiXG4gICAgbmV3IE5vdGljZSgnVmF1bHRTeW5jOiBwYXVzZWQuIE5ldyBhbmQgY2hhbmdlZCBmaWxlcyBzdGF5IGxvY2FsIHVudGlsIHlvdSByZXN1bWUuJyk7XG4gIH1cblxuICAvKiogUmVzdW1lOiByZWNvbm5lY3QgYW5kIHJ1biBhIGZ1bGwgY2F0Y2gtdXAgY3ljbGUgKHN0YXJ0dXAgcmVjb25jaWxpYXRpb24pLiAqL1xuICBhc3luYyByZXN1bWVTeW5jaW5nKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghdGhpcy5saW5rZWQgfHwgIXRoaXMucGF1c2VkKSByZXR1cm47XG4gICAgdGhpcy5wYXVzZWQgPSBmYWxzZTtcbiAgICBuZXcgTm90aWNlKCdWYXVsdFN5bmM6IHJlc3VtaW5nIFx1MjAxNCBydW5uaW5nIGEgZnVsbCBjYXRjaC11cCBzeW5jXHUyMDI2Jyk7XG4gICAgYXdhaXQgdGhpcy5zdGFydFN5bmMoKTtcbiAgfVxuXG4gIC8qKiBSdW50aW1lIHBhdXNlIHN0YXRlICh0aGUgc2V0dGluZ3MgdGFiJ3MgYnV0dG9uIGxhYmVsICsgZGlhZ25vc3RpY3MpLiAqL1xuICBnZXQgc3luY2luZ1BhdXNlZCgpOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy5wYXVzZWQ7XG4gIH1cblxuICBhc3luYyBhcHBseVJlc2NhbkludGVydmFsKHNlY29uZHM6IG51bWJlcik6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuZGF0YS5zZXR0aW5ncy5yZXNjYW5JbnRlcnZhbFNlYyA9IE1hdGgubWF4KDAsIE1hdGguZmxvb3Ioc2Vjb25kcykpO1xuICAgIGF3YWl0IHRoaXMuc2F2ZVBsdWdpbkRhdGEoKTtcbiAgICB0aGlzLnJlc2Nhbj8uc2V0SW50ZXJ2YWxNcyh0aGlzLmRhdGEuc2V0dGluZ3MucmVzY2FuSW50ZXJ2YWxTZWMgKiAxMDAwKTtcbiAgfVxuXG4gIGFzeW5jIGFwcGx5T2JzaWRpYW5TeW5jKGVuYWJsZWQ6IGJvb2xlYW4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLmRhdGEuc2V0dGluZ3Mub2JzaWRpYW5TeW5jID0gZW5hYmxlZDtcbiAgICBhd2FpdCB0aGlzLnNhdmVQbHVnaW5EYXRhKCk7XG4gICAgbmV3IE5vdGljZShcbiAgICAgIGVuYWJsZWRcbiAgICAgICAgPyAnVmF1bHRTeW5jOiAub2JzaWRpYW4vIHdpbGwgc3luYyBhZnRlciB0aGUgbmV4dCByZWNvbm5lY3QgKHRoZSB3b3JrZXJcXHUyMDE5cyBwZXItdmF1bHQgc2V0dGluZyB0YWtlcyBwcmVjZWRlbmNlKS4nXG4gICAgICAgIDogJ1ZhdWx0U3luYzogLm9ic2lkaWFuLyB3aWxsIGJlIGV4Y2x1ZGVkIGFmdGVyIHRoZSBuZXh0IHJlY29ubmVjdC4nLFxuICAgICk7XG4gIH1cblxuICBhc3luYyBhcHBseVN0YXR1c0Jhck1vZGUobW9kZTogU3RhdHVzQmFyTW9kZSk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuZGF0YS5zZXR0aW5ncy5zdGF0dXNCYXJNb2RlID0gbW9kZTtcbiAgICBhd2FpdCB0aGlzLnNhdmVQbHVnaW5EYXRhKCk7XG4gICAgdGhpcy5tb3VudFN0YXR1c0JhcigpOyAvLyByZS1tb3VudHMgKG9yIHJlbW92ZXMpIHRoZSBpdGVtIHBlciB0aGUgbW9kZVxuICAgIHRoaXMub25UaWNrKCk7XG4gIH1cblxuICBhc3luYyBhcHBseVN5bmNPblN0YXJ0dXAoZW5hYmxlZDogYm9vbGVhbik6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuZGF0YS5zZXR0aW5ncy5zeW5jT25TdGFydHVwID0gZW5hYmxlZDtcbiAgICBhd2FpdCB0aGlzLnNhdmVQbHVnaW5EYXRhKCk7XG4gICAgbmV3IE5vdGljZShcbiAgICAgIGVuYWJsZWRcbiAgICAgICAgPyAnVmF1bHRTeW5jOiBzeW5jaW5nIHdpbGwgc3RhcnQgYXV0b21hdGljYWxseSB0aGUgbmV4dCB0aW1lIE9ic2lkaWFuIG9wZW5zLidcbiAgICAgICAgOiAnVmF1bHRTeW5jOiBvbiB0aGUgbmV4dCBsYXVuY2ggdGhpcyBwbHVnaW4gc3RheXMgaWRsZSB1bnRpbCB5b3UgcHJlc3MgXHUyMDFDU3luYyBub3dcdTIwMUQuJyxcbiAgICApO1xuICB9XG5cbiAgYXN5bmMgYXBwbHlMb2dMZXZlbChsZXZlbDogTG9nTGV2ZWwpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLmRhdGEuc2V0dGluZ3MubG9nTGV2ZWwgPSBsZXZlbDtcbiAgICBhd2FpdCB0aGlzLnNhdmVQbHVnaW5EYXRhKCk7XG4gICAgdGhpcy5zeW5jTG9nLnNldExldmVsKGxldmVsKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBOZXcgaWdub3JlIHBhdHRlcm5zOiBwZXJzaXN0LCB0aGVuIHJlc3RhcnQgdGhlIHN5bmMgbWFjaGluZXJ5IHdoaWxlIGxpdmVcbiAgICogc28gdGhlIHNjYW4vd2F0Y2hlciBwaWNrIHRoZW0gdXAgaW1tZWRpYXRlbHkgKGEgcGF1c2VkIHNlc3Npb24gYXBwbGllc1xuICAgKiB0aGVtIG9uIHJlc3VtZSBcdTIwMTQgcmVzdW1lIGFsd2F5cyByZWJ1aWxkcyB0aGUgY2xpZW50KS5cbiAgICovXG4gIGFzeW5jIGFwcGx5SWdub3JlUGF0dGVybnModGV4dDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5kYXRhLnNldHRpbmdzLmlnbm9yZVBhdHRlcm5zID0gdGV4dDtcbiAgICBhd2FpdCB0aGlzLnNhdmVQbHVnaW5EYXRhKCk7XG4gICAgaWYgKHRoaXMuY2xpZW50ICE9PSBudWxsICYmICF0aGlzLnBhdXNlZCkgYXdhaXQgdGhpcy5zdGFydFN5bmMoKTtcbiAgfVxuXG4gIC8qKiBTdG9yYWdlL2F0dGFjaG1lbnQgc3VtbWFyeSBmb3IgdGhlIEFib3V0IHNlY3Rpb24gKG51bGwgPSB1bmF2YWlsYWJsZSkuICovXG4gIGFzeW5jIGZldGNoU3RvcmFnZVN1bW1hcnkoKTogUHJvbWlzZTxXb3JrZXJTdGF0dXNTdW1tYXJ5IHwgbnVsbD4ge1xuICAgIGlmICghdGhpcy5saW5rZWQpIHJldHVybiBudWxsO1xuICAgIHJldHVybiBmZXRjaFdvcmtlclN0YXR1cyh7XG4gICAgICBvcmlnaW46IHRoaXMuZGF0YS51cmwsXG4gICAgICB0b2tlbjogdGhpcy5kYXRhLnRva2VuLFxuICAgICAgZmV0Y2hJbXBsOiB0aGlzLmZldGNoSW1wbCxcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBUaGUgc2hhcmVkIHNuYXBzaG90IGJlaGluZCBcIkNvcHkgZGlhZ25vc3RpY3NcIiBhbmQgXCJTYXZlIHN1cHBvcnQgYnVuZGxlXCIuXG4gICAqIFN0cnVjdHVyYWxseSByZWRhY3RlZDogdGhlIGRldmljZSB0b2tlbiBuZXZlciBlbnRlcnMgKGl0IGxpdmVzIG9ubHkgaW5cbiAgICogYHRoaXMuZGF0YWApLCBhbmQgY29uZmxpY3RzIGNvbnRyaWJ1dGUgcGF0aHMgb25seSBcdTIwMTQgbmV2ZXIgZmlsZSBjb250ZW50LlxuICAgKi9cbiAgcHJpdmF0ZSBjb2xsZWN0RGlhZ25vc3RpY3NJbnB1dCgpOiBEaWFnbm9zdGljc0lucHV0IHtcbiAgICBjb25zdCBzdGF0dXMgPSB0aGlzLmNsaWVudD8uc3RhdHVzKCkgPz8gbnVsbDtcbiAgICByZXR1cm4ge1xuICAgICAgcGx1Z2luVmVyc2lvbjogdGhpcy5tYW5pZmVzdC52ZXJzaW9uIHx8ICd1bmtub3duJyxcbiAgICAgIGRldmljZUlkOiB0aGlzLmRhdGEuZGV2aWNlSWQsXG4gICAgICBkZXZpY2VOYW1lOiB0aGlzLnJlc29sdmVEZXZpY2VOYW1lKCksXG4gICAgICB3b3JrZXJVcmw6IHRoaXMuZGF0YS51cmwsXG4gICAgICBwYWlyZWQ6IHRoaXMubGlua2VkLFxuICAgICAgcGF1c2VkOiB0aGlzLnBhdXNlZCxcbiAgICAgIGNsaWVudFN0YXR1czogc3RhdHVzLFxuICAgICAgcmVjZW50TG9nTGluZXM6IHRoaXMuc3luY0xvZy5yZWNlbnRMaW5lcygpLFxuICAgICAgc2VydmVyVmVyc2lvbjogc3RhdHVzPy5zZXJ2ZXJWZXJzaW9uID8/IG51bGwsXG4gICAgICBzZXR0aW5nczogdGhpcy5kYXRhLnNldHRpbmdzLFxuICAgICAgcmVjZW50Q29uZmxpY3RzOiBzdGF0dXMgPT09IG51bGwgPyBbXSA6IHN0YXR1cy5jb25mbGljdHMubWFwKChjb25mbGljdCkgPT4gKHsgcGF0aDogY29uZmxpY3QucGF0aCB9KSksXG4gICAgfTtcbiAgfVxuXG4gIC8qKiBDb3B5IHRoZSBkaWFnbm9zdGljcyBidW5kbGUgdG8gdGhlIGNsaXBib2FyZCAoZmFsbGJhY2s6IGNvbnNvbGUpLiAqL1xuICBhc3luYyBjb3B5RGlhZ25vc3RpY3MoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgYnVuZGxlID0gYnVpbGREaWFnbm9zdGljc0J1bmRsZSh0aGlzLmNvbGxlY3REaWFnbm9zdGljc0lucHV0KCkpO1xuICAgIGNvbnN0IGNvcGllZCA9IGF3YWl0IGNvcHlUb0NsaXBib2FyZChidW5kbGUpO1xuICAgIGlmIChjb3BpZWQpIHtcbiAgICAgIG5ldyBOb3RpY2UoJ1ZhdWx0U3luYzogZGlhZ25vc3RpY3MgY29waWVkIHRvIHRoZSBjbGlwYm9hcmQuJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnNvbGUuaW5mbygnW3ZzYV0gZGlhZ25vc3RpY3MgKGNsaXBib2FyZCB1bmF2YWlsYWJsZSk6XFxuJyArIGJ1bmRsZSk7XG4gICAgbmV3IE5vdGljZSgnVmF1bHRTeW5jOiBjbGlwYm9hcmQgdW5hdmFpbGFibGUgXHUyMDE0IGRpYWdub3N0aWNzIHdyaXR0ZW4gdG8gdGhlIGRldmVsb3BlciBjb25zb2xlLicsIDEwMDAwKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBXcml0ZSB0aGUgc3VwcG9ydCBidW5kbGUgKG1hcmtkb3duKSBpbnRvIGAudmF1bHRzeW5jZm9yYWdlbnRzL2AgaW4gdGhlXG4gICAqIHZhdWx0IFx1MjAxNCB0aGUgcmljaGVyLCBhdHRhY2hhYmxlIHNpYmxpbmcgb2YgXCJDb3B5IGRpYWdub3N0aWNzXCIuXG4gICAqL1xuICBhc3luYyBzYXZlU3VwcG9ydEJ1bmRsZSgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBub3cgPSB0aGlzLm5vdygpO1xuICAgIGNvbnN0IG1hcmtkb3duID0gYnVpbGRTdXBwb3J0QnVuZGxlKHRoaXMuY29sbGVjdERpYWdub3N0aWNzSW5wdXQoKSwgbm93KTtcbiAgICBjb25zdCBmaWxlTmFtZSA9IGBzdXBwb3J0LWJ1bmRsZS0ke2Zvcm1hdFN1cHBvcnRCdW5kbGVTdGFtcChub3cpfS5tZGA7XG4gICAgY29uc3QgdmF1bHRQYXRoID0gYCR7U1VQUE9SVF9CVU5ETEVfRElSX1ZBVUxUX1BBVEh9LyR7ZmlsZU5hbWV9YDtcbiAgICB0cnkge1xuICAgICAgLy8gVGhlIHN0b3JhZ2UgYWRhcHRlciBta2RpcnMgdGhlIHN0YXRlIGRpciBvbiBkZW1hbmQgKGl0IGNhbiBiZSBhYnNlbnRcbiAgICAgIC8vIGJlZm9yZSB0aGUgZmlyc3Qgc3luYykgYW5kIGZhbGxzIGJhY2sgdG8gYSBwbGFpbiB3cml0ZSB3aGVyZSB0aGVcbiAgICAgIC8vIGFkYXB0ZXIgY2Fubm90IHJlbmFtZS5cbiAgICAgIGF3YWl0IHRoaXMuY3JlYXRlU3RvcmFnZUFkYXB0ZXIoKS53cml0ZUZpbGUodmF1bHRQYXRoLCBuZXcgVGV4dEVuY29kZXIoKS5lbmNvZGUobWFya2Rvd24pKTtcbiAgICAgIG5ldyBOb3RpY2UoYFZhdWx0U3luYzogc3VwcG9ydCBidW5kbGUgc2F2ZWQgdG8gJHt2YXVsdFBhdGguc2xpY2UoMSl9LmApO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLnN5bmNMb2cud2FybignZmFpbGVkIHRvIHdyaXRlIHN1cHBvcnQgYnVuZGxlJywgZXJyb3IpO1xuICAgICAgbmV3IE5vdGljZSgnVmF1bHRTeW5jOiBjb3VsZCBub3Qgd3JpdGUgdGhlIHN1cHBvcnQgYnVuZGxlIFx1MjAxNCBzZWUgdGhlIGRldmVsb3BlciBjb25zb2xlLicsIDEwMDAwKTtcbiAgICB9XG4gIH1cblxuICAvKiogVGhlIHBsYXRmb3JtIGxpbmUgZm9yIHRoZSBBYm91dC9kaWFnbm9zdGljcyByZWFkb3V0cy4gKi9cbiAgcGxhdGZvcm1TdW1tYXJ5KCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHBsYXRmb3JtU3VtbWFyeSgpO1xuICB9XG5cbiAgYXN5bmMgdW5saW5rKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuc3RvcFN5bmMoKTtcbiAgICB0aGlzLnBhdXNlZCA9IGZhbHNlO1xuICAgIC8vIENsZWFyIGxvY2FsIHN5bmMgc3RhdGUgKGRldmljZSBtYXJrZXIgKyBpbmRleCkgc28gYSBmdXR1cmUgY2xpZW50IFx1MjAxNFxuICAgIC8vIHRoaXMgcGx1Z2luIGFmdGVyIGEgcmUtcGFpciwgdGhlIGRhZW1vbiwgdGhlIENMSSBcdTIwMTQgc3RhcnRzIGNsZWFuXG4gICAgLy8gKEZSLTQ0OiBzdGFsZSBzdGF0ZSB3b3VsZCBtYWtlIGl0IHJlZnVzZSBvciBtaXMtc3luYykuXG4gICAgY29uc3Qgc3RvcmFnZSA9IHRoaXMuY3JlYXRlU3RvcmFnZUFkYXB0ZXIoKTtcbiAgICBhd2FpdCBzdG9yYWdlLmRlbGV0ZUZpbGUoREVWSUNFX01BUktFUl9WQVVMVF9QQVRIKTtcbiAgICBhd2FpdCBzdG9yYWdlLmRlbGV0ZUZpbGUoTE9DQUxfSU5ERVhfVkFVTFRfUEFUSCk7XG4gICAgdGhpcy5kYXRhID0ge1xuICAgICAgLi4uZGVmYXVsdFBsdWdpbkRhdGEoKSxcbiAgICAgIGRldmljZU5hbWU6IHRoaXMuZGF0YS5kZXZpY2VOYW1lLFxuICAgICAgc2V0dGluZ3M6IHRoaXMuZGF0YS5zZXR0aW5ncyxcbiAgICB9O1xuICAgIGF3YWl0IHRoaXMuc2F2ZVBsdWdpbkRhdGEoKTtcbiAgICBuZXcgTm90aWNlKFxuICAgICAgJ1ZhdWx0U3luYzogdW5saW5rZWQuIFJldm9rZSB0aGlzIGRldmljZSBmcm9tIHRoZSB3b3JrZXIgZGFzaGJvYXJkIGlmIHlvdSBhcmUgZG9uZSB3aXRoIGl0LicsXG4gICAgKTtcbiAgfVxuXG4gIC8vIC0tLSBzdXBlcnZpc2lvbiAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIHByaXZhdGUgb25UaWNrKCk6IHZvaWQge1xuICAgIGNvbnN0IGNsaWVudCA9IHRoaXMuY2xpZW50O1xuICAgIGlmIChjbGllbnQgPT09IG51bGwpIHJldHVybjtcbiAgICBjb25zdCBzdGF0dXMgPSBjbGllbnQuc3RhdHVzKCk7XG4gICAgdGhpcy5hc3Nlc3NTZXJ2ZXJWZXJzaW9uKHN0YXR1cyk7XG4gICAgdGhpcy5zdGF0dXNCYXI/LnVwZGF0ZShcbiAgICAgIHN0YXR1cyxcbiAgICAgIHtcbiAgICAgICAgdXJsOiB0aGlzLmRhdGEudXJsLFxuICAgICAgICBkZXZpY2VOYW1lOiB0aGlzLnJlc29sdmVEZXZpY2VOYW1lKCksXG4gICAgICAgIC8vIEJvdGggbm90ZXMgY2FuIGJlIGxpdmUgYXQgb25jZSAoYW4gYXV0aC1mYWlsdXJlIG5vdGUgd2hpbGUgdGhlXG4gICAgICAgIC8vIHNlcnZlciBhbHNvIHJlcG9ydHMgdmVyc2lvbiBza2V3KTogY29uY2F0ZW5hdGUgaW5zdGVhZCBvZiBsZXR0aW5nXG4gICAgICAgIC8vIGVpdGhlciBoaWRlIHRoZSBvdGhlcjsgZW1wdHkgcGFydHMgZHJvcCBvdXQuXG4gICAgICAgIG5vdGU6IFt0aGlzLnN0YXR1c05vdGUsIHRoaXMuc2VydmVyQ29tcGF0Tm90ZV0uZmlsdGVyKChwYXJ0KSA9PiBwYXJ0ICE9PSAnJykuam9pbignIFx1MDBCNyAnKSxcbiAgICAgICAgcGF1c2VkOiB0aGlzLnBhdXNlZCxcbiAgICAgICAgbW9kZTogdGhpcy5kYXRhLnNldHRpbmdzLnN0YXR1c0Jhck1vZGUsXG4gICAgICB9LFxuICAgICAgdGhpcy5ub3coKSxcbiAgICApO1xuICAgIGlmICh0aGlzLnBhdXNlZCB8fCB0aGlzLmF1dGhGYWlsZWQpIHJldHVybjsgLy8gbm8gcmVjb25uZWN0IHdoaWxlIHBhdXNlZCAvIHRva2VuIHJlamVjdGVkXG4gICAgY29uc3QgZGVjaXNpb24gPSB0aGlzLnN1cGVydmlzb3IuY29uc2lkZXIoc3RhdHVzLnN0YXRlKTtcbiAgICBpZiAoZGVjaXNpb24uYWN0aW9uID09PSAnd2FpdCcpIHJldHVybjtcbiAgICB0aGlzLnN1cGVydmlzb3IuYWNrbm93bGVkZ2VkKCk7XG4gICAgdGhpcy5zY2hlZHVsZVJlY29ubmVjdChkZWNpc2lvbi5kZWxheU1zKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBMYXRlc3Qgc2VydmVyLXZlcnNpb24gdmVyZGljdCBmb3IgdGhlIHNldHRpbmdzIHRhYjsgbnVsbCB1bnRpbCB0aGUgZmlyc3RcbiAgICogaGVsbG9BY2sgb2YgdGhlIGN1cnJlbnQgc3luYyBzZXNzaW9uLlxuICAgKi9cbiAgZ2V0IHNlcnZlckNvbXBhdGliaWxpdHkoKTogQ29tcGF0aWJpbGl0eVZlcmRpY3QgfCBudWxsIHtcbiAgICByZXR1cm4gdGhpcy5zZXJ2ZXJDb21wYXQ7XG4gIH1cblxuICAvKiogVGhlIHZlcmRpY3QncyB0b29sdGlwIGxpbmUgKCcnIHdoZW4gY29tcGF0aWJsZSBcdTIwMTQgbm90aGluZyB0byBuYWcgYWJvdXQpLiAqL1xuICBwcml2YXRlIGdldCBzZXJ2ZXJDb21wYXROb3RlKCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHRoaXMuc2VydmVyQ29tcGF0ICE9PSBudWxsICYmIHRoaXMuc2VydmVyQ29tcGF0LmxldmVsICE9PSAnb2snXG4gICAgICA/IHRoaXMuc2VydmVyQ29tcGF0Lm1lc3NhZ2VcbiAgICAgIDogJyc7XG4gIH1cblxuICAvKipcbiAgICogVmVyc2lvbi1za2V3IGFzc2Vzc21lbnQsIHJ1biBieSB0aGUgdGljayBvbmNlIHRoZSBjb25uZWN0aW9uIGhhcyBhY2tlZFxuICAgKiAoc3RhdGVzICdzeW5jaW5nJy8nbGl2ZScgYm90aCBmb2xsb3cgdGhlIGhlbGxvQWNrOyBwcmUtYWNrIHN0YXRlcyByZWFkXG4gICAqIHNlcnZlclZlcnNpb24gbnVsbCBmb3IgXCJub3QgeWV0IGtub3duXCIgYW5kIG11c3Qgbm90IHByb2R1Y2UgYSBzcHVyaW91c1xuICAgKiBcImxlZ2FjeSBzZXJ2ZXJcIiB2ZXJkaWN0KS4gTmV2ZXIga2lsbHMgc3luYzogdGhlIHdpcmUgYFByb3RvY29sVmVyc2lvbmBcbiAgICogY2hlY2sgYXQgaGVsbG8gcmVtYWlucyB0aGUgaGFyZCBnYXRlOyBhIHZlcmRpY3QgaXMgYWR2aXNvcnkuXG4gICAqL1xuICBwcml2YXRlIGFzc2Vzc1NlcnZlclZlcnNpb24oc3RhdHVzOiBTeW5jQ2xpZW50U3RhdHVzKTogdm9pZCB7XG4gICAgaWYgKHN0YXR1cy5zdGF0ZSAhPT0gJ3N5bmNpbmcnICYmIHN0YXR1cy5zdGF0ZSAhPT0gJ2xpdmUnKSByZXR1cm47XG4gICAgY29uc3QgdmVyZGljdCA9IGNoZWNrU2VydmVyQ29tcGF0aWJpbGl0eSh0aGlzLm1hbmlmZXN0LnZlcnNpb24gfHwgJ3Vua25vd24nLCBzdGF0dXMuc2VydmVyVmVyc2lvbik7XG4gICAgdGhpcy5zZXJ2ZXJDb21wYXQgPSB2ZXJkaWN0O1xuICAgIGlmICh2ZXJkaWN0LmxldmVsID09PSAnb2snKSByZXR1cm47IC8vIGFsc28gY2xlYXJzIGFueSBzdGFsZSB0b29sdGlwIG5vdGVcbiAgICBpZiAodGhpcy5zZXJ2ZXJDb21wYXROb3RpZmllZCkgcmV0dXJuOyAvLyBvbmUgTm90aWNlIHBlciBwbHVnaW4gc2Vzc2lvblxuICAgIHRoaXMuc2VydmVyQ29tcGF0Tm90aWZpZWQgPSB0cnVlO1xuICAgIG5ldyBOb3RpY2UoYFZhdWx0U3luYzogJHt2ZXJkaWN0Lm1lc3NhZ2V9YCwgMTAwMDApO1xuICB9XG5cbiAgcHJpdmF0ZSBzY2hlZHVsZVJlY29ubmVjdChkZWxheU1zOiBudW1iZXIpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5yZWNvbm5lY3RUaW1lciAhPT0gbnVsbCkgcmV0dXJuOyAvLyBvbmUgaW4gZmxpZ2h0LCBhbHdheXNcbiAgICB0aGlzLnJlY29ubmVjdFRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICB0aGlzLnJlY29ubmVjdFRpbWVyID0gbnVsbDtcbiAgICAgIGNvbnN0IGNsaWVudCA9IHRoaXMuY2xpZW50O1xuICAgICAgaWYgKGNsaWVudCA9PT0gbnVsbCkge1xuICAgICAgICB0aGlzLnN1cGVydmlzb3Iuc2V0dGxlZCgpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBjbGllbnRcbiAgICAgICAgLnJlY29ubmVjdCgpXG4gICAgICAgIC50aGVuKFxuICAgICAgICAgICgpID0+IHtcbiAgICAgICAgICAgIHRoaXMuc3VwZXJ2aXNvci5zZXR0bGVkKCk7XG4gICAgICAgICAgfSxcbiAgICAgICAgICAoZXJyb3I6IHVua25vd24pID0+IHtcbiAgICAgICAgICAgIHRoaXMuc3VwZXJ2aXNvci5zZXR0bGVkKCk7XG4gICAgICAgICAgICB0aGlzLmhhbmRsZVN5bmNFcnJvcihlcnJvciwgJ3JlY29ubmVjdCBmYWlsZWQnKTtcbiAgICAgICAgICB9LFxuICAgICAgICApXG4gICAgICAgIC5jYXRjaCgoKSA9PiB7fSk7IC8vIGhhbmRsZVN5bmNFcnJvciBuZXZlciB0aHJvd3M7IGJlbHQgYW5kIGJyYWNlc1xuICAgIH0sIGRlbGF5TXMpO1xuICB9XG5cbiAgLyoqIERpc3Rpbmd1aXNoIGZhdGFsIGF1dGggZmFpbHVyZXMgZnJvbSB0cmFuc2llbnQgbmV0d29yayB0cm91YmxlLiAqL1xuICBwcml2YXRlIGhhbmRsZVN5bmNFcnJvcihlcnJvcjogdW5rbm93biwgY29udGV4dDogc3RyaW5nKTogdm9pZCB7XG4gICAgaWYgKGVycm9yIGluc3RhbmNlb2YgUmV2b2tlZEVycm9yIHx8IGVycm9yIGluc3RhbmNlb2YgVW5hdXRob3JpemVkRXJyb3IpIHtcbiAgICAgIHRoaXMuYXV0aEZhaWxlZCA9IHRydWU7XG4gICAgICB0aGlzLnN0YXR1c05vdGUgPSAnRGV2aWNlIHRva2VuIHJlamVjdGVkIFx1MjAxNCB1bmxpbmsgYW5kIHJlLXBhaXIgd2l0aCBhIGZyZXNoIGNvZGUuJztcbiAgICAgIHRoaXMuc3luY0xvZy5lcnJvcihjb250ZXh0LCBlcnJvcik7XG4gICAgICBuZXcgTm90aWNlKFxuICAgICAgICAnVmF1bHRTeW5jOiB0aGUgd29ya2VyIHJlamVjdGVkIHRoaXMgZGV2aWNlXFx1MjAxOXMgdG9rZW4gKHJldm9rZWQ/KS4gVW5saW5rIGFuZCByZS1wYWlyIGZyb20gc2V0dGluZ3MuJyxcbiAgICAgICAgMTAwMDAsXG4gICAgICApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLnN5bmNMb2cud2Fybihjb250ZXh0LCBlcnJvcik7IC8vIG9mZmxpbmUvcHJvdG9jb2w6IGJhY2tvZmYga2VlcHMgcmV0cnlpbmdcbiAgfVxuXG4gIC8qKiBGUi00NDogd2FybiB3aGVuIHRoZSB2YXVsdCdzIHN0YXRlIGRpciBiZWxvbmdzIHRvIGFub3RoZXIgY2xpZW50LiAqL1xuICBwcml2YXRlIGFzeW5jIHdhcm5JZkZvcmVpZ25TdGF0ZURpcihzdG9yYWdlOiBPYnNpZGlhblN0b3JhZ2VBZGFwdGVyKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgbGV0IG1hcmtlcjogeyBkZXZpY2VJZD86IHVua25vd247IGRldmljZU5hbWU/OiB1bmtub3duOyB1cmw/OiB1bmtub3duIH07XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGJ5dGVzID0gYXdhaXQgc3RvcmFnZS5yZWFkRmlsZShERVZJQ0VfTUFSS0VSX1ZBVUxUX1BBVEgpO1xuICAgICAgbWFya2VyID0gSlNPTi5wYXJzZShuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUoYnl0ZXMpKSBhcyB0eXBlb2YgbWFya2VyO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuOyAvLyBubyBtYXJrZXIgKG9yIHVucmVhZGFibGUpIFx1MjAxNCBub3RoaW5nIHRvIHdhcm4gYWJvdXRcbiAgICB9XG4gICAgaWYgKFxuICAgICAgdHlwZW9mIG1hcmtlci5kZXZpY2VJZCA9PT0gJ3N0cmluZycgJiZcbiAgICAgIG1hcmtlci5kZXZpY2VJZCAhPT0gdGhpcy5kYXRhLmRldmljZUlkXG4gICAgKSB7XG4gICAgICBjb25zdCBuYW1lID0gdHlwZW9mIG1hcmtlci5kZXZpY2VOYW1lID09PSAnc3RyaW5nJyA/IG1hcmtlci5kZXZpY2VOYW1lIDogbWFya2VyLmRldmljZUlkO1xuICAgICAgY29uc3Qgd2hlcmUgPSB0eXBlb2YgbWFya2VyLnVybCA9PT0gJ3N0cmluZycgPyBtYXJrZXIudXJsIDogJ2Egd29ya2VyJztcbiAgICAgIG5ldyBOb3RpY2UoXG4gICAgICAgIGBWYXVsdFN5bmM6IHRoaXMgdmF1bHQgYWxyZWFkeSBoYXMgc3luYyBzdGF0ZSBmb3IgZGV2aWNlIFwiJHtuYW1lfVwiIChsaW5rZWQgdG8gJHt3aGVyZX0pLiBgICtcbiAgICAgICAgICAnT25lIHN5bmMgY2xpZW50IHBlciBtYWNoaW5lIHBlciB2YXVsdCBcdTIwMTQgcnVubmluZyB0d28gZG91YmxlLWNvbW1pdHMgZXZlcnkgY2hhbmdlLiAnICtcbiAgICAgICAgICAnVW5saW5rIHRoZSBvdGhlciBjbGllbnQgKG9yIGNsZWFyIC52YXVsdHN5bmNmb3JhZ2VudHMvKSBpZiB0aGlzIGlzIHVuZXhwZWN0ZWQuJyxcbiAgICAgICAgMTUwMDAsXG4gICAgICApO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBub3JtYWxpemVXb3JrZXJVcmxTYWZlKGlucHV0OiBzdHJpbmcpOiBzdHJpbmcge1xuICB0cnkge1xuICAgIHJldHVybiBub3JtYWxpemVXb3JrZXJVcmwoaW5wdXQpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gaW5wdXQ7XG4gIH1cbn1cbiIsICIvKipcbiAqIFZhdWx0IHBhdGggdXRpbGl0aWVzLlxuICpcbiAqIFZhdWx0LWludGVybmFsIHBhdGhzIGFyZSBQT1NJWC1ub3JtYWxpemVkIHN0cmluZ3MgcmVsYXRpdmUgdG8gdGhlIHZhdWx0IHJvb3Q6XG4gKiAgIC0gYWx3YXlzIHN0YXJ0IHdpdGggYC9gIChgL2EvYi5tZGApOyB0aGUgdmF1bHQgcm9vdCBpdHNlbGYgaXMgYC9gXG4gKiAgIC0gc2VnbWVudHMgc2VwYXJhdGVkIGJ5IGAvYDsgbm8gdHJhaWxpbmcgc2xhc2gsIG5vIGAuYC9gLi5gIHNlZ21lbnRzLFxuICogICAgIG5vIGR1cGxpY2F0ZSBzbGFzaGVzXG4gKiAgIC0gbmV2ZXIgZXNjYXBlIHRoZSByb290OiBhbnkgYC4uYCB0aGF0IHdvdWxkIHBvcCBhYm92ZSBgL2AgaXMgcmVqZWN0ZWRcbiAqXG4gKiBCYWNrc2xhc2hlcyBhcmUgY29udmVydGVkIHRvIGAvYCAoV2luZG93cyBjYWxsZXJzIHJvdXRpbmVseSBoYW5kIHVzXG4gKiBgZGlyXFxmaWxlLm1kYCksIGJ1dCBhYnNvbHV0ZSBXaW5kb3dzIHBhdGhzIChkcml2ZSBsZXR0ZXJzIGxpa2UgYEM6L2AsIFVOQ1xuICogYFxcXFxzZXJ2ZXJcXHNoYXJlYCkgYXJlIHJlamVjdGVkIFx1MjAxNCBhIHZhdWx0IHBhdGggaXMgbmV2ZXIgYWJzb2x1dGUgaW4gdGhlIGhvc3RcbiAqIGZpbGVzeXN0ZW0gc2Vuc2UuXG4gKi9cblxuLyoqIEEgdmF1bHQtaW50ZXJuYWwsIFBPU0lYLW5vcm1hbGl6ZWQgcGF0aCBzdHJpbmcgKGUuZy4gYC9ub3Rlcy90b2RvLm1kYCkuICovXG5leHBvcnQgdHlwZSBWYXVsdFBhdGggPSBzdHJpbmc7XG5cbi8qKiBUaHJvd24gd2hlbiBhIHBhdGggY2Fubm90IGJlIGludGVycHJldGVkIGFzIGEgdmF1bHQtaW50ZXJuYWwgcGF0aC4gKi9cbmV4cG9ydCBjbGFzcyBJbnZhbGlkVmF1bHRQYXRoRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIGNvbnN0cnVjdG9yKG1lc3NhZ2U6IHN0cmluZykge1xuICAgIHN1cGVyKG1lc3NhZ2UpO1xuICAgIHRoaXMubmFtZSA9ICdJbnZhbGlkVmF1bHRQYXRoRXJyb3InO1xuICB9XG59XG5cbi8qKlxuICogTm9ybWFsaXplIGEgdXNlci0gb3IgcGxhdGZvcm0tc3VwcGxpZWQgcGF0aCBpbnRvIGNhbm9uaWNhbCB2YXVsdCBmb3JtLlxuICpcbiAqIEFjY2VwdGVkOiBgYS9iLm1kYCAocm9vdC1yZWxhdGl2ZSB3aXRob3V0IGxlYWRpbmcgc2xhc2gpLCBgL2EvYi5tZGAsXG4gKiBgYVxcYi5tZGAgKGJhY2tzbGFzaCBjb252ZXJzaW9uKSwgYGEvLi9iLm1kYCwgYGEvYi8uLi9jLm1kYCAoaW50ZXJpb3IgYC4uYFxuICogcmVzb2x2ZXMpLCBkdXBsaWNhdGUgc2xhc2hlcywgdHJhaWxpbmcgc2xhc2hlcy5cbiAqXG4gKiBSZWplY3RlZDogYC4uYCBlc2NhcGluZyB0aGUgcm9vdCAoYC8uLi9hYCwgYC9hLy4uLy4uYCksIGFic29sdXRlIFdpbmRvd3NcbiAqIGRyaXZlIHBhdGhzIChgQzovdmF1bHQvYS5tZGAsIGBDOlxcdmF1bHRcXGEubWRgKSwgVU5DIHBhdGhzIChgXFxcXHNydlxcc2hhcmVgKSxcbiAqIGxlYWRpbmcgYC8vYCwgTlVMIGJ5dGVzLCBhbmQgV2luZG93cy11bnNhZmUgc2VnbWVudHMgXHUyMDE0IHJlc2VydmVkIGRldmljZVxuICogbmFtZXMgKGBDT05gLCBgUFJOYCwgYEFVWGAsIGBOVUxgLCBgQ09NMWBcdTIwMTNgQ09NOWAsIGBMUFQxYFx1MjAxM2BMUFQ5YCwgYW55XG4gKiBleHRlbnNpb24sIGFueSBjYXNlKSBhbmQgc2VnbWVudHMgZW5kaW5nIGluIGAuYCBvciBgIGAuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVWYXVsdFBhdGgoaW5wdXQ6IHN0cmluZyk6IFZhdWx0UGF0aCB7XG4gIGlmICh0eXBlb2YgaW5wdXQgIT09ICdzdHJpbmcnKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRWYXVsdFBhdGhFcnJvcihgVmF1bHQgcGF0aCBtdXN0IGJlIGEgc3RyaW5nLCBnb3QgJHt0eXBlb2YgaW5wdXR9YCk7XG4gIH1cbiAgaWYgKGlucHV0LmluY2x1ZGVzKCdcXDAnKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkVmF1bHRQYXRoRXJyb3IoYFZhdWx0IHBhdGggY29udGFpbnMgTlVMIGJ5dGU6ICR7SlNPTi5zdHJpbmdpZnkoaW5wdXQpfWApO1xuICB9XG4gIGlmICgvXlthLXpBLVpdOi8udGVzdChpbnB1dCkpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZFZhdWx0UGF0aEVycm9yKFxuICAgICAgYFZhdWx0IHBhdGggbXVzdCBub3QgYmUgYW4gYWJzb2x1dGUgaG9zdCBwYXRoIChkcml2ZSBsZXR0ZXIpOiAke0pTT04uc3RyaW5naWZ5KGlucHV0KX1gLFxuICAgICk7XG4gIH1cbiAgaWYgKGlucHV0LnN0YXJ0c1dpdGgoJ1xcXFxcXFxcJykpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZFZhdWx0UGF0aEVycm9yKFxuICAgICAgYFZhdWx0IHBhdGggbXVzdCBub3QgYmUgYSBVTkMgcGF0aDogJHtKU09OLnN0cmluZ2lmeShpbnB1dCl9YCxcbiAgICApO1xuICB9XG5cbiAgY29uc3QgY29udmVydGVkID0gaW5wdXQucmVwbGFjZSgvXFxcXC9nLCAnLycpO1xuICBpZiAoY29udmVydGVkLnN0YXJ0c1dpdGgoJy8vJykpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZFZhdWx0UGF0aEVycm9yKFxuICAgICAgYFZhdWx0IHBhdGggbXVzdCBub3Qgc3RhcnQgd2l0aCBcIi8vXCIgKFVOQyBvciBwcm90b2NvbC1zdHlsZSBwYXRoKTogJHtKU09OLnN0cmluZ2lmeShpbnB1dCl9YCxcbiAgICApO1xuICB9XG5cbiAgY29uc3Qgc2VnbWVudHM6IHN0cmluZ1tdID0gW107XG4gIGZvciAoY29uc3Qgc2VnbWVudCBvZiBjb252ZXJ0ZWQuc3BsaXQoJy8nKSkge1xuICAgIGlmIChzZWdtZW50ID09PSAnJyB8fCBzZWdtZW50ID09PSAnLicpIGNvbnRpbnVlO1xuICAgIGlmIChzZWdtZW50ID09PSAnLi4nKSB7XG4gICAgICBpZiAoc2VnbWVudHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIHRocm93IG5ldyBJbnZhbGlkVmF1bHRQYXRoRXJyb3IoXG4gICAgICAgICAgYFZhdWx0IHBhdGggZXNjYXBlcyB0aGUgdmF1bHQgcm9vdDogJHtKU09OLnN0cmluZ2lmeShpbnB1dCl9YCxcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIHNlZ21lbnRzLnBvcCgpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChpc1dpbmRvd3NVbnNhZmVTZWdtZW50KHNlZ21lbnQpKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZFZhdWx0UGF0aEVycm9yKFxuICAgICAgICBgVmF1bHQgcGF0aCBzZWdtZW50IGlzIGEgV2luZG93cy1yZXNlcnZlZCBkZXZpY2UgbmFtZSBvciBlbmRzIHdpdGggYSBkb3Qvc3BhY2U6ICR7SlNPTi5zdHJpbmdpZnkoc2VnbWVudCl9YCxcbiAgICAgICk7XG4gICAgfVxuICAgIHNlZ21lbnRzLnB1c2goc2VnbWVudCk7XG4gIH1cbiAgcmV0dXJuIHNlZ21lbnRzLmxlbmd0aCA9PT0gMCA/ICcvJyA6IGAvJHtzZWdtZW50cy5qb2luKCcvJyl9YDtcbn1cblxuLyoqXG4gKiBKb2luIGEgYmFzZSB2YXVsdCBwYXRoIHdpdGggb25lIG9yIG1vcmUgcmVsYXRpdmUgcGF0aCBwYXJ0cy5cbiAqXG4gKiBFYWNoIHBhcnQgbXVzdCBiZSByZWxhdGl2ZSAobm8gbGVhZGluZyBgL2AgYWZ0ZXIgYmFja3NsYXNoIGNvbnZlcnNpb24pIGFuZFxuICogaXMgYXBwZW5kZWQgdG8gdGhlIGJhc2UgYmVmb3JlIG5vcm1hbGl6YXRpb247IGAuLmAgaW5zaWRlIHBhcnRzIG1heSBub3RcbiAqIGVzY2FwZSB0aGUgcmVzdWx0aW5nIHJvb3QuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBqb2luUGF0aChiYXNlOiBzdHJpbmcsIC4uLnBhcnRzOiByZWFkb25seSBzdHJpbmdbXSk6IFZhdWx0UGF0aCB7XG4gIGxldCBjb21iaW5lZCA9IG5vcm1hbGl6ZVZhdWx0UGF0aChiYXNlKTtcbiAgZm9yIChjb25zdCBwYXJ0IG9mIHBhcnRzKSB7XG4gICAgY29uc3QgY29udmVydGVkID0gcGFydC5yZXBsYWNlKC9cXFxcL2csICcvJyk7XG4gICAgaWYgKGNvbnZlcnRlZC5zdGFydHNXaXRoKCcvJykpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkVmF1bHRQYXRoRXJyb3IoXG4gICAgICAgIGBqb2luUGF0aCBwYXJ0cyBtdXN0IGJlIHJlbGF0aXZlLCBnb3QgJHtKU09OLnN0cmluZ2lmeShwYXJ0KX1gLFxuICAgICAgKTtcbiAgICB9XG4gICAgY29tYmluZWQgPSBgJHtjb21iaW5lZCA9PT0gJy8nID8gJycgOiBjb21iaW5lZH0vJHtjb252ZXJ0ZWR9YDtcbiAgfVxuICByZXR1cm4gbm9ybWFsaXplVmF1bHRQYXRoKGNvbWJpbmVkKTtcbn1cblxuLyoqXG4gKiBQYXJlbnQgZGlyZWN0b3J5IG9mIGEgdmF1bHQgcGF0aC4gVGhlIHBhcmVudCBvZiBgL2AgaXMgYC9gICh0aGUgcm9vdCBoYXMgbm9cbiAqIHBhcmVudCBhYm92ZSBpdCk7IHdhbGsgYHdoaWxlIChwICE9PSBwYXJlbnRQYXRoKHApKWAgc3R5bGUgbG9vcHMgdGVybWluYXRlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyZW50UGF0aChwYXRoOiBzdHJpbmcpOiBWYXVsdFBhdGgge1xuICBjb25zdCBub3JtYWxpemVkID0gbm9ybWFsaXplVmF1bHRQYXRoKHBhdGgpO1xuICBpZiAobm9ybWFsaXplZCA9PT0gJy8nKSByZXR1cm4gJy8nO1xuICBjb25zdCBsYXN0U2xhc2ggPSBub3JtYWxpemVkLmxhc3RJbmRleE9mKCcvJyk7XG4gIHJldHVybiBsYXN0U2xhc2ggPT09IDAgPyAnLycgOiBub3JtYWxpemVkLnNsaWNlKDAsIGxhc3RTbGFzaCk7XG59XG5cbi8qKlxuICogRmluYWwgcGF0aCBzZWdtZW50LiBgYmFzZW5hbWUoJy9hL2IubWQnKWAgXHUyMTkyIGBiLm1kYDsgYGJhc2VuYW1lKCcvJylgIFx1MjE5MiBgJydgLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYmFzZW5hbWUocGF0aDogc3RyaW5nKTogVmF1bHRQYXRoIHtcbiAgY29uc3Qgbm9ybWFsaXplZCA9IG5vcm1hbGl6ZVZhdWx0UGF0aChwYXRoKTtcbiAgaWYgKG5vcm1hbGl6ZWQgPT09ICcvJykgcmV0dXJuICcnO1xuICByZXR1cm4gbm9ybWFsaXplZC5zbGljZShub3JtYWxpemVkLmxhc3RJbmRleE9mKCcvJykgKyAxKTtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIGBjaGlsZGAgbmFtZXMgc29tZXRoaW5nIGF0IGxlYXN0IG9uZSBsZXZlbCBCRUxPVyBgYW5jZXN0b3JgXG4gKiAoYm90aCBub3JtYWxpemVkIHZhdWx0IHBhdGhzKS4gVGhlIHJvb3QgaXMgYW4gYW5jZXN0b3Igb2YgZXZlcnl0aGluZ1xuICogZXhjZXB0IGl0c2VsZjsgYSBwYXRoIGlzIG5ldmVyIHN0cmljdGx5IGJlbmVhdGggaXRzZWxmLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNTdHJpY3RseUJlbmVhdGgoY2hpbGQ6IHN0cmluZywgYW5jZXN0b3I6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBpZiAoYW5jZXN0b3IgPT09ICcvJykgcmV0dXJuIGNoaWxkICE9PSAnLyc7XG4gIHJldHVybiBjaGlsZC5sZW5ndGggPiBhbmNlc3Rvci5sZW5ndGggJiYgY2hpbGQuc3RhcnRzV2l0aChgJHthbmNlc3Rvcn0vYCk7XG59XG5cbi8vIC0tLSBXaW5kb3dzLXVuc2FmZSBuYW1lcyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFJlc2VydmVkIERPUyBkZXZpY2UgYmFzZSBuYW1lcyAobWF0Y2hlZCBjYXNlLWluc2Vuc2l0aXZlbHksIGFueSBleHRlbnNpb24pLiAqL1xuY29uc3QgV0lORE9XU19SRVNFUlZFRF9CQVNFX05BTUVTOiBSZWFkb25seVNldDxzdHJpbmc+ID0gbmV3IFNldChbXG4gICdjb24nLFxuICAncHJuJyxcbiAgJ2F1eCcsXG4gICdudWwnLFxuICAnY29tMScsXG4gICdjb20yJyxcbiAgJ2NvbTMnLFxuICAnY29tNCcsXG4gICdjb201JyxcbiAgJ2NvbTYnLFxuICAnY29tNycsXG4gICdjb204JyxcbiAgJ2NvbTknLFxuICAnbHB0MScsXG4gICdscHQyJyxcbiAgJ2xwdDMnLFxuICAnbHB0NCcsXG4gICdscHQ1JyxcbiAgJ2xwdDYnLFxuICAnbHB0NycsXG4gICdscHQ4JyxcbiAgJ2xwdDknLFxuXSk7XG5cbi8qKlxuICogV2hldGhlciBvbmUgcGF0aCBzZWdtZW50IGNhbiBuZXZlciBiZSBtYXRlcmlhbGl6ZWQgb24gV2luZG93czogYSByZXNlcnZlZFxuICogZGV2aWNlIGJhc2UgbmFtZSBcdTIwMTQgdGhlIHNlZ21lbnQgdXAgdG8gaXRzIGZpcnN0IGRvdCwgY2FzZS1pbnNlbnNpdGl2ZSwgc29cbiAqIGBDT05gLCBgbnVsLnR4dGAgYW5kIGBDT00zLnRhci5nemAgYWxsIG1hdGNoIFx1MjAxNCBvciBhIHRyYWlsaW5nIGRvdC9zcGFjZSxcbiAqIHdoaWNoIFdpbmRvd3Mgc3RyaXBzIHdoZW4gY3JlYXRpbmcgdGhlIGZpbGUgKHRoZSBvbi1kaXNrIG5hbWUgd291bGRcbiAqIHNpbGVudGx5IGRpZmZlciBmcm9tIHRoZSBzeW5jZWQgb25lKS5cbiAqL1xuZnVuY3Rpb24gaXNXaW5kb3dzVW5zYWZlU2VnbWVudChzZWdtZW50OiBzdHJpbmcpOiBib29sZWFuIHtcbiAgLy8gYC5gL2AuLmAgYXJlIG5vcm1hbGl6YXRpb24gdG9rZW5zLCBuZXZlciByZWFsIHNlZ21lbnQgbmFtZXM7IHRoZXkgYXJlXG4gIC8vIHJlc29sdmVkIChvciByZWplY3RlZCkgYnkgYG5vcm1hbGl6ZVZhdWx0UGF0aGAgaXRzZWxmLlxuICBpZiAoc2VnbWVudCA9PT0gJy4nIHx8IHNlZ21lbnQgPT09ICcuLicpIHJldHVybiBmYWxzZTtcbiAgaWYgKHNlZ21lbnQuZW5kc1dpdGgoJy4nKSB8fCBzZWdtZW50LmVuZHNXaXRoKCcgJykpIHJldHVybiB0cnVlO1xuICBjb25zdCBkb3QgPSBzZWdtZW50LmluZGV4T2YoJy4nKTtcbiAgY29uc3QgYmFzZSA9IChkb3QgPT09IC0xID8gc2VnbWVudCA6IHNlZ21lbnQuc2xpY2UoMCwgZG90KSkudG9Mb3dlckNhc2UoKTtcbiAgcmV0dXJuIFdJTkRPV1NfUkVTRVJWRURfQkFTRV9OQU1FUy5oYXMoYmFzZSk7XG59XG5cbi8qKlxuICogV2hldGhlciBhbnkgc2VnbWVudCBvZiBhIHZhdWx0IHBhdGggaXMgV2luZG93cy11bnNhZmUgKHNlZVxuICogYGlzV2luZG93c1Vuc2FmZVNlZ21lbnRgKS4gU3VjaCBwYXRocyBhcmUgcmVqZWN0ZWQgYnkgYG5vcm1hbGl6ZVZhdWx0UGF0aGBcbiAqIGFuZCBtdXN0IG5ldmVyIGJlIHB1c2hlZCBvciBwdWxsZWQ6IGEgV2luZG93cyBjbGllbnQgY2Fubm90IG1hdGVyaWFsaXplXG4gKiB0aGVtLCBzbyBhdHRlbXB0aW5nIHRoZSB3cml0ZSB3b3VsZCBmYWlsIGV2ZXJ5IHN5bmMgY3ljbGUuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1dpbmRvd3NVbnNhZmVQYXRoKHBhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gcGF0aC5zcGxpdCgnLycpLnNvbWUoKHNlZ21lbnQpID0+IGlzV2luZG93c1Vuc2FmZVNlZ21lbnQoc2VnbWVudCkpO1xufVxuIiwgIi8qKlxuICogTG9naWNhbCBjbG9jayBvcGVyYXRpb25zIChBUkNISVRFQ1RVUkUubWQgXHUwMEE3NCkuXG4gKlxuICogQ2xvY2tzIGFyZSBwZXItZmlsZSBtb25vdG9uaWMgY291bnRlcnMgb3duZWQgYnkgdGhlIHN5bmMgYXV0aG9yaXR5ICh0aGVcbiAqIER1cmFibGUgT2JqZWN0KS4gQSBjbG9jayBwYWlycyB0aGUgY291bnRlciB3aXRoIHRoZSBpZCBvZiB0aGUgZGV2aWNlIHRoYXRcbiAqIHByb2R1Y2VkIGl0LiBPcmRlcmluZyBpcyBmdWxseSBkZXRlcm1pbmlzdGljIG9uIGV2ZXJ5IGNsaWVudDpcbiAqXG4gKiAgIDEuIGhpZ2hlciBgY291bnRlcmAgd2lucztcbiAqICAgMi4gZXhhY3QgY291bnRlciB0aWUgXHUyMTkyIGxleGljb2dyYXBoaWNhbGx5IGdyZWF0ZXIgYGRldmljZUlkYCB3aW5zXG4gKiAgICAgIChwbGFpbiBKUyBzdHJpbmcgY29tcGFyaXNvbiwgaS5lLiBieSBVVEYtMTYgY29kZSB1bml0cyk7XG4gKiAgIDMuIGlkZW50aWNhbCBjb3VudGVyICphbmQqIGlkZW50aWNhbCBkZXZpY2VJZCBcdTIxOTIgdGhlIGNsb2NrcyBhcmUgZXF1YWwuXG4gKlxuICogV2FsbC1jbG9jayB0aW1lIG5ldmVyIHBhcnRpY2lwYXRlcyBpbiBvcmRlcmluZyAoZGlzcGxheS1vbmx5IHBlciBcdTAwQTc0KS5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IExvZ2ljYWxDbG9jayB9IGZyb20gJy4vdHlwZXMuanMnO1xuXG4vKiogUmVzdWx0IG9mIGBjb21wYXJlQ2xvY2tzYDogc2lnbiBvZiBgYWAgdnMgYGJgIChwb3NpdGl2ZSBcdTIxRDIgYGFgIHdpbnMpLiAqL1xuZXhwb3J0IHR5cGUgQ2xvY2tDb21wYXJpc29uID0gLTEgfCAwIHwgMTtcblxuLyoqXG4gKiBDb21wYXJlIHR3byBsb2dpY2FsIGNsb2Nrcy5cbiAqXG4gKiBSZXR1cm5zIGAxYCB3aGVuIGBhYCB3aW5zLCBgLTFgIHdoZW4gYGJgIHdpbnMsIGAwYCB3aGVuIHRoZSBjbG9ja3MgYXJlXG4gKiBpZGVudGljYWwgKHNhbWUgY291bnRlciAqYW5kKiBzYW1lIGRldmljZUlkIFx1MjAxNCBpbiBwcmFjdGljZSBvbmx5IHdoZW5cbiAqIGNvbXBhcmluZyBhIGNsb2NrIHdpdGggaXRzZWxmKS4gQ2FsbGVycyB0aGF0IG11c3QgcGljayBhIHNpZGUgb24gYDBgXG4gKiBzaG91bGQgZG8gc28gZXhwbGljaXRseSBhbmQgZG9jdW1lbnQgdGhlIGNob2ljZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvbXBhcmVDbG9ja3MoYTogTG9naWNhbENsb2NrLCBiOiBMb2dpY2FsQ2xvY2spOiBDbG9ja0NvbXBhcmlzb24ge1xuICBpZiAoYS5jb3VudGVyICE9PSBiLmNvdW50ZXIpIHJldHVybiBhLmNvdW50ZXIgPiBiLmNvdW50ZXIgPyAxIDogLTE7XG4gIGlmIChhLmRldmljZUlkICE9PSBiLmRldmljZUlkKSByZXR1cm4gYS5kZXZpY2VJZCA+IGIuZGV2aWNlSWQgPyAxIDogLTE7XG4gIHJldHVybiAwO1xufVxuXG4vKipcbiAqIFRoZSBjbG9jayBhIGNvbW1pdCBmcm9tIGBkZXZpY2VJZGAgd291bGQgcmVjZWl2ZSB3aGVuIGJ1aWxkaW5nIG9uIGBwYXJlbnRgXG4gKiAob3Igb24gbm90aGluZywgd2hlbiBgcGFyZW50YCBpcyBhYnNlbnQpOiBwYXJlbnQncyBjb3VudGVyICsgMS5cbiAqXG4gKiBUaGlzIGlzIHRoZSAqdGVudGF0aXZlKiBjbG9jayB1c2VkIGJ5IGNsaWVudC1zaWRlIGNvbmZsaWN0IHByZWRpY3Rpb25cbiAqIChgcmVzb2x2ZS50c2ApOiB0aGUgRE8gYXNzaWducyByZWFsIGNvdW50ZXJzIHdpdGggdGhlIHNhbWUgcnVsZSwgc28gdGhlXG4gKiBwcmVkaWN0aW9uIG1hdGNoZXMgdGhlIHNlcnZlcidzIGFyYml0cmF0aW9uIGFzIGxvbmcgYXMgYm90aCBzaWRlcyBidWlsZCBvblxuICogdGhlIHNhbWUgcGFyZW50LlxuICovXG5leHBvcnQgZnVuY3Rpb24gbmV4dENsb2NrKFxuICBwYXJlbnQ6IExvZ2ljYWxDbG9jayB8IG51bGwgfCB1bmRlZmluZWQsXG4gIGRldmljZUlkOiBzdHJpbmcsXG4pOiBMb2dpY2FsQ2xvY2sge1xuICByZXR1cm4geyBjb3VudGVyOiAocGFyZW50Py5jb3VudGVyID8/IDApICsgMSwgZGV2aWNlSWQgfTtcbn1cbiIsICIvKipcbiAqIENvbnRlbnQgaGFzaGluZyBhbmQgY29tcHJlc3Npb24gXHUyMDE0IFdlYiBBUElzIG9ubHkuXG4gKlxuICogYGNyeXB0by5zdWJ0bGVgIGlzIGF2YWlsYWJsZSBpbiBOb2RlIDE4KywgQ2xvdWRmbGFyZSBXb3JrZXJzLFxuICogYW5kIE9ic2lkaWFuIChFbGVjdHJvbikuIGBDb21wcmVzc2lvblN0cmVhbWAgbGlrZXdpc2UuIE5vIE5vZGUgaW1wb3J0czpcbiAqIHRoaXMgbW9kdWxlIG11c3QgcnVuIHVuY2hhbmdlZCBpbiBldmVyeSBjbGllbnQgKEFSQ0hJVEVDVFVSRS5tZCBcdTAwQTc4KS5cbiAqL1xuXG4vKiogSGFzaCBvZiBgYnl0ZXNgIGFzIGxvd2VyY2FzZSBzaGEyNTYgaGV4LiBNYXRjaGVzIFIyIGJsb2Iga2V5cyBgYmxvYnMve3NoYTI1Nn1gLiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHNoYTI1NkhleChieXRlczogVWludDhBcnJheSB8IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gIGNvbnN0IGRhdGEgPSB0eXBlb2YgYnl0ZXMgPT09ICdzdHJpbmcnID8gbmV3IFRleHRFbmNvZGVyKCkuZW5jb2RlKGJ5dGVzKSA6IGJ5dGVzO1xuICAvLyBgY3J5cHRvYCAobm90IGBnbG9iYWxUaGlzLmNyeXB0b2ApOiB0aGUgYmFyZSBpZGVudGlmaWVyIHJlc29sdmVzIGluIGV2ZXJ5XG4gIC8vIHRhcmdldCdzIHR5cGVzIChET00gbGliLCBDbG91ZGZsYXJlIHdvcmtlcmQgdHlwZXMsIE5vZGUpIFx1MjAxNCB0aGUgcXVhbGlmaWVkXG4gIC8vIGZvcm0gZG9lcyBub3QsIGJlY2F1c2Ugd29ya2VycyB0eXBlcyBkZWNsYXJlIGl0IGBjb25zdGAsIHdoaWNoIG5ldmVyXG4gIC8vIG1lcmdlcyBpbnRvIGB0eXBlb2YgZ2xvYmFsVGhpc2AuXG4gIGNvbnN0IGRpZ2VzdCA9IGF3YWl0IGNyeXB0by5zdWJ0bGUuZGlnZXN0KCdTSEEtMjU2JywgZGF0YSBhcyBCdWZmZXJTb3VyY2UpO1xuICByZXR1cm4gdG9IZXgobmV3IFVpbnQ4QXJyYXkoZGlnZXN0KSk7XG59XG5cbi8qKlxuICogV2hldGhlciBnemlwIHN0cmVhbXMgYXJlIGF2YWlsYWJsZSBpbiB0aGlzIHJ1bnRpbWUuIE9sZGVyIE9ic2lkaWFuIG1vYmlsZVxuICogd2Vidmlld3MgbWF5IGxhY2sgYENvbXByZXNzaW9uU3RyZWFtYDsgY2FsbGVycyBmYWxsIGJhY2sgdG8gaWRlbnRpdHkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdXBwb3J0c0NvbXByZXNzaW9uKCk6IGJvb2xlYW4ge1xuICByZXR1cm4gKFxuICAgIHR5cGVvZiBDb21wcmVzc2lvblN0cmVhbSAhPT0gJ3VuZGVmaW5lZCcgJiZcbiAgICB0eXBlb2YgRGVjb21wcmVzc2lvblN0cmVhbSAhPT0gJ3VuZGVmaW5lZCdcbiAgKTtcbn1cblxuLyoqXG4gKiBHemlwIGBkYXRhYC4gRmFsbHMgYmFjayB0byBpZGVudGl0eSAocmV0dXJucyBpbnB1dCB1bmNoYW5nZWQpIHdoZW5cbiAqIGBDb21wcmVzc2lvblN0cmVhbWAgaXMgdW5hdmFpbGFibGUgXHUyMDE0IGNhbGwgYHN1cHBvcnRzQ29tcHJlc3Npb24oKWAgZmlyc3QgaWZcbiAqIHlvdSBtdXN0IGtub3cgd2hpY2ggaGFwcGVuZWQuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjb21wcmVzcyhkYXRhOiBVaW50OEFycmF5KTogUHJvbWlzZTxVaW50OEFycmF5PiB7XG4gIGlmICghc3VwcG9ydHNDb21wcmVzc2lvbigpKSByZXR1cm4gZGF0YTtcbiAgLy8gYGFzIEJ1ZmZlclNvdXJjZWAgKG5vdCBgYXMgQmxvYlBhcnRgKTogdGhlIG5hbWUgYEJ1ZmZlclNvdXJjZWAgcmVzb2x2ZXMgaW5cbiAgLy8gYm90aCBET00gbGliIGFuZCB3b3JrZXJkIHJ1bnRpbWUgdHlwZXMsIGFuZCBpcyBhIHZhbGlkIEJsb2JQYXJ0IGluIGVhY2guXG4gIGNvbnN0IHN0cmVhbSA9IG5ldyBCbG9iKFtkYXRhIGFzIEJ1ZmZlclNvdXJjZV0pXG4gICAgLnN0cmVhbSgpXG4gICAgLnBpcGVUaHJvdWdoKG5ldyBDb21wcmVzc2lvblN0cmVhbSgnZ3ppcCcpKTtcbiAgcmV0dXJuIG5ldyBVaW50OEFycmF5KGF3YWl0IG5ldyBSZXNwb25zZShzdHJlYW0pLmFycmF5QnVmZmVyKCkpO1xufVxuXG4vKipcbiAqIEd1bnppcCBgZGF0YWAgcHJvZHVjZWQgYnkgYGNvbXByZXNzYCAoaW4gYSBydW50aW1lIHRoYXQgaGFkIGd6aXAgc3VwcG9ydCkuXG4gKiBGYWxscyBiYWNrIHRvIGlkZW50aXR5IHdoZW4gYERlY29tcHJlc3Npb25TdHJlYW1gIGlzIHVuYXZhaWxhYmxlLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZGVjb21wcmVzcyhkYXRhOiBVaW50OEFycmF5KTogUHJvbWlzZTxVaW50OEFycmF5PiB7XG4gIGlmICghc3VwcG9ydHNDb21wcmVzc2lvbigpKSByZXR1cm4gZGF0YTtcbiAgY29uc3Qgc3RyZWFtID0gbmV3IEJsb2IoW2RhdGEgYXMgQnVmZmVyU291cmNlXSlcbiAgICAuc3RyZWFtKClcbiAgICAucGlwZVRocm91Z2gobmV3IERlY29tcHJlc3Npb25TdHJlYW0oJ2d6aXAnKSk7XG4gIHJldHVybiBuZXcgVWludDhBcnJheShhd2FpdCBuZXcgUmVzcG9uc2Uoc3RyZWFtKS5hcnJheUJ1ZmZlcigpKTtcbn1cblxuZnVuY3Rpb24gdG9IZXgoYnl0ZXM6IFVpbnQ4QXJyYXkpOiBzdHJpbmcge1xuICBsZXQgb3V0ID0gJyc7XG4gIGZvciAoY29uc3QgYnl0ZSBvZiBieXRlcykge1xuICAgIG91dCArPSBieXRlLnRvU3RyaW5nKDE2KS5wYWRTdGFydCgyLCAnMCcpO1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG4iLCAiLyoqXG4gKiBUeXBlZCBlcnJvciBoaWVyYXJjaHkgc2hhcmVkIGJ5IGFsbCBjbGllbnRzIChwbHVnaW4sIGRhZW1vbiwgQ0xJKSBhbmQgdGhlXG4gKiB0ZXN0LXN1aXRlIHNlcnZlci4gRXJyb3JzIGNhcnJ5IGEgc3RhYmxlIG1hY2hpbmUtcmVhZGFibGUgYGNvZGVgLlxuICovXG5cbmV4cG9ydCB0eXBlIEVycm9yQ29kZSA9XG4gIHwgJ1VOQ0xBSU1FRCdcbiAgfCAnVU5BVVRIT1JJWkVEJ1xuICB8ICdSRVZPS0VEJ1xuICB8ICdDT05GTElDVCdcbiAgfCAnUFJPVE9DT0wnXG4gIHwgJ05FVFdPUksnO1xuXG4vKiogQmFzZSBjbGFzcyBmb3IgYWxsIFZhdWx0U3luYyBlcnJvcnMuICovXG5leHBvcnQgYWJzdHJhY3QgY2xhc3MgVmF1bHRTeW5jRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIGFic3RyYWN0IHJlYWRvbmx5IGNvZGU6IEVycm9yQ29kZTtcblxuICBjb25zdHJ1Y3RvcihtZXNzYWdlOiBzdHJpbmcsIG9wdGlvbnM/OiBFcnJvck9wdGlvbnMpIHtcbiAgICBzdXBlcihtZXNzYWdlLCBvcHRpb25zKTtcbiAgICB0aGlzLm5hbWUgPSBuZXcudGFyZ2V0Lm5hbWU7XG4gIH1cbn1cblxuLyoqIFdvcmtlciBleGlzdHMgYnV0IGhhcyBub3QgYmVlbiBjbGFpbWVkIHlldCAoSFRUUCA0MjEgb24gZXZlcnkgQVBJIGNhbGwpLiAqL1xuZXhwb3J0IGNsYXNzIFVuY2xhaW1lZEVycm9yIGV4dGVuZHMgVmF1bHRTeW5jRXJyb3Ige1xuICByZWFkb25seSBjb2RlID0gJ1VOQ0xBSU1FRCcgYXMgY29uc3Q7XG59XG5cbi8qKiBUb2tlbiBtaXNzaW5nLCBpbnZhbGlkLCBvciBub3QgYWNjZXB0ZWQgKEhUVFAgNDAxIGNsYXNzKS4gKi9cbmV4cG9ydCBjbGFzcyBVbmF1dGhvcml6ZWRFcnJvciBleHRlbmRzIFZhdWx0U3luY0Vycm9yIHtcbiAgcmVhZG9ubHkgY29kZSA9ICdVTkFVVEhPUklaRUQnIGFzIGNvbnN0O1xufVxuXG4vKiogVGhlIGRldmljZSB0b2tlbiB3YXMgcmV2b2tlZDsgdGhlIGRldmljZSBtdXN0IGJlIHJlLXBhaXJlZC4gKi9cbmV4cG9ydCBjbGFzcyBSZXZva2VkRXJyb3IgZXh0ZW5kcyBWYXVsdFN5bmNFcnJvciB7XG4gIHJlYWRvbmx5IGNvZGUgPSAnUkVWT0tFRCcgYXMgY29uc3Q7XG59XG5cbi8qKiBBIGNvbW1pdCByYWNlZCB3aXRoIGEgY29uY3VycmVudCBlZGl0OyB0aGUgc2VydmVyIGFyYml0cmF0ZWQgKHNlZSBcdTAwQTc0KS4gKi9cbmV4cG9ydCBjbGFzcyBDb25mbGljdEVycm9yIGV4dGVuZHMgVmF1bHRTeW5jRXJyb3Ige1xuICByZWFkb25seSBjb2RlID0gJ0NPTkZMSUNUJyBhcyBjb25zdDtcbn1cblxuLyoqIEEgcGVlciAob3IgbG9jYWwgYnVnKSB2aW9sYXRlZCB0aGUgcHJvdG9jb2w6IGJhZCBtZXNzYWdlIHNoYXBlLCBiYWQgdmVyc2lvbi4gKi9cbmV4cG9ydCBjbGFzcyBQcm90b2NvbEVycm9yIGV4dGVuZHMgVmF1bHRTeW5jRXJyb3Ige1xuICByZWFkb25seSBjb2RlID0gJ1BST1RPQ09MJyBhcyBjb25zdDtcbn1cblxuLyoqIFRyYW5zcG9ydC1sZXZlbCBmYWlsdXJlOiBzb2NrZXQgY2xvc2VkLCBmZXRjaCByZWZ1c2VkLCB0aW1lb3V0LiBSZXRyaWFibGUuICovXG5leHBvcnQgY2xhc3MgTmV0d29ya0Vycm9yIGV4dGVuZHMgVmF1bHRTeW5jRXJyb3Ige1xuICByZWFkb25seSBjb2RlID0gJ05FVFdPUksnIGFzIGNvbnN0O1xufVxuIiwgIi8qKlxuICogVGhlIGNsaWVudCdzIHBlcnNpc3RlZCBzeW5jIHN0YXRlIChBUkNISVRFQ1RVUkUubWQgXHUwMEE3OCBzdGVwIDEpLlxuICpcbiAqIEEgYExvY2FsSW5kZXhgIG1hcHMgZXZlcnkgdmF1bHQgcGF0aCB0aGlzIGNsaWVudCBoYXMgZXZlciBzeW5jZWQgdG8gdGhlXG4gKiBsYXN0IHZlcnNpb24gaXQgKmtub3dzKiB3YXMgYXV0aG9yaXRhdGl2ZTogY29udGVudCBoYXNoLCBzaXplLCB0aGVcbiAqIHNlcnZlci1hc3NpZ25lZCB2ZXJzaW9uIGlkLCBhbmQgdGhlIHZlcnNpb24ncyBsb2dpY2FsIGNsb2NrLiBFbnRyaWVzIHdpdGhcbiAqIGBkZWxldGVkQXRgIHNldCBhcmUgdG9tYnN0b25lcyBcdTIwMTQgdGhlIGZpbGUgd2FzIGRlbGV0ZWQgKGxvY2FsbHkgb3JcbiAqIHJlbW90ZWx5KSBidXQgdGhlIGVudHJ5IHN0YXlzIHNvIHRoZSBkZWxldGlvbiBpcyBub3QgcmVzdXJyZWN0ZWQgYnkgdGhlXG4gKiBuZXh0IHNjYW4gYW5kIHNvIHJlbmFtZSBjb3JyZWxhdGlvbiBrZWVwcyB3b3JraW5nLlxuICpcbiAqIFRoZSBpbmRleCBpcyBwZXJzaXN0ZWQgaW5zaWRlIHRoZSB2YXVsdCBhdCBgLy52YXVsdHN5bmNmb3JhZ2VudHMvc3RhdGVgXG4gKiAodGhhdCBkaXJlY3RvcnkgaXMgc3luYy1pZ25vcmVkLCBzZWUgYGlnbm9yZS50c2ApIHRocm91Z2ggdGhlIHN0b3JhZ2VcbiAqIGFkYXB0ZXIsIHdob3NlIGB3cml0ZUZpbGVgIGlzIGF0b21pYyAodGVtcCArIHJlbmFtZSkgYnkgY29udHJhY3QuXG4gKlxuICogQWxsIG9wZXJhdGlvbnMgYXJlIHB1cmU6IHRoZXkgcmV0dXJuIG5ldyBvYmplY3RzIGFuZCBuZXZlciBtdXRhdGUgaW5wdXRzLlxuICovXG5cbmltcG9ydCB0eXBlIHsgTG9naWNhbENsb2NrIH0gZnJvbSAnLi90eXBlcy5qcyc7XG5pbXBvcnQgeyBQcm90b2NvbEVycm9yIH0gZnJvbSAnLi9lcnJvcnMuanMnO1xuXG4vKipcbiAqIEN1cnJlbnQgb24tZGlzayBzY2hlbWEgdmVyc2lvbi4gQnVtcCArIGFkZCBtaWdyYXRpb24gb24gYnJlYWtpbmcgY2hhbmdlcy5cbiAqXG4gKiBIaXN0b3J5OlxuICogICAtIDEgXHUyMDE0IGluaXRpYWwgc2hhcGUgKGhhc2gvc2l6ZS92ZXJzaW9uSWQvY2xvY2svZGVsZXRlZEF0L2lzRm9sZGVyKS5cbiAqICAgLSAyIFx1MjAxNCBhZGRzIHRoZSBvcHRpb25hbCBgbXRpbWVgIGNhY2hlIGZpZWxkIHBlciBlbnRyeSAoc2NhbiBwcmUtZmlsdGVyLFxuICogICAgICAgICBzZWUgYHNjYW4udHNgKS4gR3JhY2VmdWwgbWlncmF0aW9uOiB2MSBlbnRyaWVzIHNpbXBseSBsYWNrIGBtdGltZWAsXG4gKiAgICAgICAgIHdoaWNoIHJlYWRzIGJhY2sgYXMgXCJ1bmtub3duXCIgXHUyMDE0IHRoZSBuZXh0IGZhc3Qgc2NhbiByZS1oYXNoZXMgdGhlXG4gKiAgICAgICAgIGZpbGUgYW5kIHJlY29yZHMgaXQuIE9sZCB2MSBzdGF0ZSBmaWxlcyBsb2FkIHdpdGhvdXQgZXJyb3IuXG4gKlxuICogVGhlIHYyIEVOVkVMT1BFIGFsc28gY2FycmllcyBvcHRpb25hbCBzeW5jLWN1cnNvciBib29ra2VlcGluZyAoYGN1cnNvcmAsXG4gKiBgc3luY2VkVGhyb3VnaGAsIGBuZWVkc0Z1bGxNYW5pZmVzdGAgXHUyMDE0IHNlZSBgUGVyc2lzdGVkU3luY1N0YXRlYCk7IGZpbGVzXG4gKiB3cml0dGVuIGJlZm9yZSBpdCBleGlzdGVkIHNpbXBseSBsYWNrIHRob3NlIGtleXMsIHdoaWNoIHJlYWQgYmFjayBhc1xuICogXCJubyBjdXJzb3Iga25vd2xlZGdlXCIgKGZ1bGwgbWFuaWZlc3Qgb24gdGhlIG5leHQgY29ubmVjdCkuIE5vIHZlcnNpb25cbiAqIGJ1bXA6IGJvdGggZGlyZWN0aW9ucyB0b2xlcmF0ZSB0aGUgbWlzc2luZyBmaWVsZHMuXG4gKi9cbmV4cG9ydCBjb25zdCBMT0NBTF9JTkRFWF9TQ0hFTUFfVkVSU0lPTiA9IDI7XG5cbi8qKiBPbGRlc3Qgb24tZGlzayBzY2hlbWEgdmVyc2lvbiB0aGlzIGJ1aWxkIGNhbiBzdGlsbCByZWFkLiAqL1xuZXhwb3J0IGNvbnN0IE1JTl9MT0NBTF9JTkRFWF9TQ0hFTUFfVkVSU0lPTiA9IDE7XG5cbi8qKiBWYXVsdCBwYXRoIHdoZXJlIHRoZSBjbGllbnQgcGVyc2lzdHMgaXRzIGxvY2FsIGluZGV4LiAqL1xuZXhwb3J0IGNvbnN0IExPQ0FMX0lOREVYX1NUQVRFX1BBVEggPSAnLy52YXVsdHN5bmNmb3JhZ2VudHMvc3RhdGUnO1xuXG4vKiogT25lIHBhdGgncyBsYXN0LWtub3duLXN5bmNlZCBzdGF0ZS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgTG9jYWxJbmRleEVudHJ5IHtcbiAgLyoqIHNoYTI1NiBoZXggb2YgdGhlIGNvbnRlbnQgYXQgYHZlcnNpb25JZGAuICovXG4gIGhhc2g6IHN0cmluZztcbiAgLyoqIENvbnRlbnQgc2l6ZSBpbiBieXRlcyAoYDBgIGZvciBmb2xkZXIgcGxhY2Vob2xkZXJzKS4gKi9cbiAgc2l6ZTogbnVtYmVyO1xuICAvKiogU2VydmVyLWFzc2lnbmVkIHZlcnNpb24gaWQgdGhpcyBlbnRyeSByZWZsZWN0cy4gKi9cbiAgdmVyc2lvbklkOiBzdHJpbmc7XG4gIC8qKiBMb2dpY2FsIGNsb2NrIG9mIGB2ZXJzaW9uSWRgIFx1MjAxNCB1c2VkIHRvIHByZWRpY3QgY29uZmxpY3Qgb3V0Y29tZXMuICovXG4gIGNsb2NrOiBMb2dpY2FsQ2xvY2s7XG4gIC8qKiBQcmVzZW50IFx1MjFEMiB0b21ic3RvbmU6IHRoZSBwYXRoIHdhcyBkZWxldGVkIGF0IHRoaXMgZXBvY2ggbXMuICovXG4gIGRlbGV0ZWRBdD86IG51bWJlcjtcbiAgLyoqXG4gICAqIFRydWUgZm9yIGVtcHR5LWZvbGRlciBwbGFjZWhvbGRlciBlbnRyaWVzIChGUi0xMCkuIEZvbGRlciBlbnRyaWVzIGNhcnJ5XG4gICAqIGBoYXNoOiAnJ2AsIGBzaXplOiAwYDsgdGhlIGNsb2NrIGlzIHRoYXQgb2YgdGhlIHBsYWNlaG9sZGVyJ3MgdmVyc2lvbi5cbiAgICovXG4gIGlzRm9sZGVyPzogYm9vbGVhbjtcbiAgLyoqXG4gICAqIFN0b3JhZ2UgbXRpbWUgKGVwb2NoIG1zKSBvYnNlcnZlZCB0aGUgbGFzdCB0aW1lIHRoaXMgZW50cnkncyBmaWxlIHdhc1xuICAgKiBoYXNoZWQgYnkgYSBzY2FuLiBBIHB1cmUgY2FjaGUgZm9yIHRoZSBzY2FuIHByZS1maWx0ZXIgKGBzY2FuLnRzYCk6XG4gICAqIG51bGxpc2ggKGFic2VudCwgZS5nLiBsZWdhY3kgdjEgc3RhdGUgb3IgZW50cmllcyB3cml0dGVuIGJ5IHB1bGxzKVxuICAgKiBtZWFucyBcInVua25vd25cIiBcdTIwMTQgdGhlIG5leHQgZmFzdCBzY2FuIGhhc2hlcyB0aGUgZmlsZSBhbmQgcmVjb3JkcyBpdCB2aWFcbiAgICogYHJlY29yZEhhc2hlZEZpbGVzYC4gTmV2ZXIgY29uc3VsdGVkIGZvciBzeW5jIGRlY2lzaW9ucy5cbiAgICovXG4gIG10aW1lPzogbnVtYmVyO1xufVxuXG4vKiogVGhlIHdob2xlIGluZGV4OiBub3JtYWxpemVkIHZhdWx0IHBhdGggXHUyMTkyIGVudHJ5LiBge31gIGlzIGEgdmFsaWQgZW1wdHkgaW5kZXguICovXG5leHBvcnQgdHlwZSBMb2NhbEluZGV4ID0gUmVhZG9ubHk8UmVjb3JkPHN0cmluZywgTG9jYWxJbmRleEVudHJ5Pj47XG5cbi8qKiBWZXJzaW9uZWQgc2VyaWFsaXphdGlvbiBlbnZlbG9wZSAoc2NoZW1hVmVyc2lvbiBlbmFibGVzIGZ1dHVyZSBtaWdyYXRpb24pLiAqL1xuZXhwb3J0IGludGVyZmFjZSBMb2NhbEluZGV4RW52ZWxvcGUge1xuICBzY2hlbWFWZXJzaW9uOiBudW1iZXI7XG4gIGVudHJpZXM6IFJlY29yZDxzdHJpbmcsIExvY2FsSW5kZXhFbnRyeT47XG4gIC8qKlxuICAgKiBFbnZlbG9wZS1sZXZlbCBzeW5jIGJvb2trZWVwaW5nIChvcHRpb25hbCBzbyB2MiBmaWxlcyB3cml0dGVuIGJlZm9yZSBpdFxuICAgKiBleGlzdGVkIHN0aWxsIGxvYWQ7IHVua25vd24gZmllbGRzIGFyZSB0b2xlcmF0ZWQgaW4gYm90aCBkaXJlY3Rpb25zKS5cbiAgICogU2VlIGBQZXJzaXN0ZWRTeW5jU3RhdGVgLlxuICAgKi9cbiAgY3Vyc29yPzogbnVtYmVyO1xuICBzeW5jZWRUaHJvdWdoPzogbnVtYmVyIHwgbnVsbDtcbiAgbmVlZHNGdWxsTWFuaWZlc3Q/OiBib29sZWFuO1xufVxuXG4vKipcbiAqIFN5bmMtY3Vyc29yIGJvb2trZWVwaW5nIHBlcnNpc3RlZCBhdG9taWNhbGx5IFdJVEggdGhlIGVudHJpZXMgKG9uZSBmaWxlLFxuICogb25lIHdyaXRlKSBzbyB0aGUgdHdvIGNhbiBuZXZlciBkaXNhZ3JlZSBhZnRlciBhIGNyYXNoLiBSZXN0b3JlZCBvblxuICogc3RhcnR1cCB0byBwb3dlciBkZWx0YS1tYW5pZmVzdCByZWNvbm5lY3RzLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFBlcnNpc3RlZFN5bmNTdGF0ZSB7XG4gIC8qKiBMYXN0IHNlZW4gc2VydmVyIHNlcXVlbmNlIG51bWJlciAoc2VudCBhcyBgaGVsbG8uY3Vyc29yYCkuICovXG4gIGN1cnNvcj86IG51bWJlcjtcbiAgLyoqXG4gICAqIFNlcXVlbmNlIHRocm91Z2ggd2hpY2ggdGhlIGluZGV4IGlzIGtub3duIENPTVBMRVRFOiB0aGUgbWFuaWZlc3QgY3Vyc29yXG4gICAqIG9mIHRoZSBsYXN0IHN5bmMgY3ljbGUgdGhhdCBmaW5pc2hlZCBzdWNjZXNzZnVsbHkuIEV2ZXJ5IGhlYWQgYXQgb3JcbiAgICogYmVsb3cgaXQgaXMgcmVmbGVjdGVkIGluIHRoZSBlbnRyaWVzIGFib3ZlLCBzbyBhIGxhdGVyIHJlY29ubmVjdCBvbmx5XG4gICAqIG5lZWRzIGhlYWRzIHdpdGggYGhlYWRfc2VxID4gc3luY2VkVGhyb3VnaGAgXHUyMDE0IHRoZSBkZWx0YS1tYW5pZmVzdCB3aW5kb3cuXG4gICAqIGBudWxsYC9hYnNlbnQgXHUyMUQyIG5vIGNvbXBsZXRlZCBjeWNsZSB5ZXQgKG9yIGFuIGludGVycnVwdGVkIG9uZSk6IHRoZSBuZXh0XG4gICAqIG1hbmlmZXN0IG11c3QgYmUgRlVMTC4gRGVsaWJlcmF0ZWx5IE5PVCBhZHZhbmNlZCB0byBjb21taXQtYWNrIHNlcXMgc2VlblxuICAgKiBtaWQtY3ljbGU6IGEgY2hhbmdlIGJyb2FkY2FzdCBmcm9tIGFub3RoZXIgZGV2aWNlIGNhbiBpbnRlcmxlYXZlIHdpdGhcbiAgICogb3VyIGFja3MgYW5kIGxhbmQgaW4gdGhlIHBvc3QtY3ljbGUgZGlzcGF0Y2ggcXVldWUsIHNvIG9ubHkgdGhlXG4gICAqIGZldGNoLXRpbWUgbWFuaWZlc3QgY3Vyc29yIGlzIGEgY29tcGxldGlvbiBndWFyYW50ZWUuXG4gICAqL1xuICBzeW5jZWRUaHJvdWdoPzogbnVtYmVyIHwgbnVsbDtcbiAgLyoqXG4gICAqIEEgcmVtb3RlIGNoYW5nZSB3YXMgZGVmZXJyZWQgb3ZlciBsb2NhbGx5LWRpdmVyZ2VkIGNvbnRlbnQgKGBoYW5kbGVDaGFuZ2VgXG4gICAqIGd1YXJkKSBhbmQgaGFzIG5vdCBiZWVuIHRocm91Z2ggYSBwbGFuIGN5Y2xlIHlldC4gVGhlIG5leHQgbWFuaWZlc3QgbXVzdFxuICAgKiBiZSBGVUxMIHNvIGBjb21wdXRlU3luY1BsYW5gIHNlZXMgdGhlIHJlbW90ZSBoZWFkIGFuZCByZXNvbHZlcyB0aGVcbiAgICogZGl2ZXJnZW5jZSB0aHJvdWdoIGl0cyBjb25mbGljdCBsb2dpYyBpbnN0ZWFkIG9mIGEgc3RhbGUtcGFyZW50IHB1c2guXG4gICAqL1xuICBuZWVkc0Z1bGxNYW5pZmVzdD86IGJvb2xlYW47XG59XG5cbi8qKiBPbmUgYXV0aG9yaXRhdGl2ZSBzdGF0ZSBjaGFuZ2UgdG8gZm9sZCBpbnRvIHRoZSBpbmRleC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgTG9jYWxJbmRleENvbW1pdCB7XG4gIHBhdGg6IHN0cmluZztcbiAgdmVyc2lvbklkOiBzdHJpbmc7XG4gIGhhc2g6IHN0cmluZztcbiAgc2l6ZTogbnVtYmVyO1xuICBjbG9jazogTG9naWNhbENsb2NrO1xuICAvKiogUHJlc2VudCBcdTIxRDIgdG9tYnN0b25lOiB0aGUgcGF0aCB3YXMgZGVsZXRlZCBhdCB0aGlzIGVwb2NoIG1zLiAqL1xuICBkZWxldGVkPzogYm9vbGVhbjtcbiAgLyoqIEVwb2NoIG1zIG9mIHRoZSBkZWxldGlvbiBcdTIwMTQgcmVxdWlyZWQgd2hlbiBgZGVsZXRlZGAgaXMgdHJ1ZS4gKi9cbiAgZGVsZXRlZEF0PzogbnVtYmVyO1xuICAvKiogVHJ1ZSB3aGVuIHRoaXMgY29tbWl0IHJlY29yZHMgYW4gZW1wdHktZm9sZGVyIHBsYWNlaG9sZGVyIChGUi0xMCkuICovXG4gIGlzRm9sZGVyPzogYm9vbGVhbjtcbiAgLyoqXG4gICAqIFN0b3JhZ2UgbXRpbWUgb2JzZXJ2ZWQgYXQgSEFTSCB0aW1lIGZvciB0aGlzIGV4YWN0IGNvbnRlbnQgXHUyMDE0IHBpbm5lZCBvbnRvXG4gICAqIHRoZSBlbnRyeSB3aGVuIHRoZSBjb21taXQgaXMgZm9sZGVkIChpLmUuIGF0IGNvbW1pdC1hY2sgdGltZSkuIFRocmVhZGluZ1xuICAgKiB0aGUgc3RhdCB0aGF0IGNvLW9jY3VycmVkIHdpdGggdGhlIGhhc2hlZCBieXRlcyAocmF0aGVyIHRoYW4gYW55XG4gICAqIGxhdGVyL2N1cnJlbnQgc3RhdCkgZ3VhcmFudGVlcyB0aGUgZmFzdC1wYXRoIGNhY2hlIGNhbiBuZXZlciBwYWlyIGFcbiAgICogZnJlc2hlciBzdGF0IHdpdGggdGhpcyBoYXNoLCB3aGljaCB3b3VsZCBoaWRlIGFuIGVkaXQgZnJvbSBldmVyeSBmdXR1cmVcbiAgICogc2NhbiAodGhlIHNpbGVudCBkcm9wcGVkLWVkaXQgY2xhc3MpLiBBYnNlbnQgXHUyMUQyIHVua25vd247IHRoZSBuZXh0IHNjYW5cbiAgICogcmUtaGFzaGVzIGFuZCByZWNvcmRzIHZpYSBgcmVjb3JkSGFzaGVkRmlsZXNgLlxuICAgKi9cbiAgbXRpbWU/OiBudW1iZXI7XG59XG5cbi8qKlxuICogRm9sZCBvbmUgY29tbWl0IGludG8gdGhlIGluZGV4LiBQdXJlOiByZXR1cm5zIGEgbmV3IGluZGV4LCBpbnB1dCB1bnRvdWNoZWQuXG4gKlxuICogQXBwbHlpbmcgYSBjb21taXQgZm9yIGEgcGF0aCByZXBsYWNlcyB0aGF0IHBhdGgncyBlbnRyeSB3aG9sZXNhbGUgKGEgY29tbWl0XG4gKiAqaXMqIHRoZSBuZXcgdHJ1dGggZm9yIHRoZSBwYXRoKTsgYGFwcGx5Q29tbWl0YCBuZXZlciBtZXJnZXMgZmllbGRzLlxuICogVG9tYnN0b25pbmcgKGBkZWxldGVkOiB0cnVlYCkgcmVxdWlyZXMgYGRlbGV0ZWRBdGAgYW5kIGtlZXBzIHRoZSBlbnRyeS5cbiAqXG4gKiBUbyBkcm9wIGFuIGVudHJ5IGVudGlyZWx5ICh0aGUgcGF0aCBtaWdyYXRlZCBhd2F5LCBlLmcuIGEgc3luY2VkIHJlbmFtZSlcbiAqIHVzZSBgcmVtb3ZlRW50cnlgIGluc3RlYWQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhcHBseUNvbW1pdChpbmRleDogTG9jYWxJbmRleCwgY29tbWl0OiBMb2NhbEluZGV4Q29tbWl0KTogTG9jYWxJbmRleCB7XG4gIGlmIChjb21taXQuZGVsZXRlZCAmJiBjb21taXQuZGVsZXRlZEF0ID09PSB1bmRlZmluZWQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBgYXBwbHlDb21taXQ6IHRvbWJzdG9uZSBmb3IgJHtKU09OLnN0cmluZ2lmeShjb21taXQucGF0aCl9IHJlcXVpcmVzIGRlbGV0ZWRBdGAsXG4gICAgKTtcbiAgfVxuICBjb25zdCBuZXh0OiBSZWNvcmQ8c3RyaW5nLCBMb2NhbEluZGV4RW50cnk+ID0geyAuLi5pbmRleCB9O1xuICBjb25zdCBlbnRyeTogTG9jYWxJbmRleEVudHJ5ID0ge1xuICAgIGhhc2g6IGNvbW1pdC5oYXNoLFxuICAgIHNpemU6IGNvbW1pdC5zaXplLFxuICAgIHZlcnNpb25JZDogY29tbWl0LnZlcnNpb25JZCxcbiAgICBjbG9jazogY29tbWl0LmNsb2NrLFxuICB9O1xuICBpZiAoY29tbWl0LmRlbGV0ZWQpIGVudHJ5LmRlbGV0ZWRBdCA9IGNvbW1pdC5kZWxldGVkQXQ7XG4gIGlmIChjb21taXQuaXNGb2xkZXIpIGVudHJ5LmlzRm9sZGVyID0gdHJ1ZTtcbiAgaWYgKGNvbW1pdC5tdGltZSAhPT0gdW5kZWZpbmVkKSBlbnRyeS5tdGltZSA9IGNvbW1pdC5tdGltZTtcbiAgbmV4dFtjb21taXQucGF0aF0gPSBlbnRyeTtcbiAgcmV0dXJuIG5leHQ7XG59XG5cbi8qKlxuICogUmVtb3ZlIGEgcGF0aCdzIGVudHJ5IGVudGlyZWx5IChubyB0b21ic3RvbmUpLiBVc2VkIHdoZW4gdGhlIGF1dGhvcml0eVxuICogbWlncmF0ZXMgYSBwYXRoJ3MgdmVyc2lvbiBjaGFpbiBlbHNld2hlcmUgXHUyMDE0IGkuZS4gYSBzeW5jZWQgcmVuYW1lOiB0aGUgb2xkXG4gKiBwYXRoIG11c3QgdmFuaXNoIGZyb20gdGhlIGluZGV4IGV4YWN0bHkgYXMgaXQgdmFuaXNoZWQgZnJvbSB0aGUgbWFuaWZlc3QuXG4gKiBQdXJlOyByZW1vdmluZyBhbiBhYnNlbnQgcGF0aCBpcyBhIG5vLW9wLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVtb3ZlRW50cnkoaW5kZXg6IExvY2FsSW5kZXgsIHBhdGg6IHN0cmluZyk6IExvY2FsSW5kZXgge1xuICBpZiAoIShwYXRoIGluIGluZGV4KSkgcmV0dXJuIGluZGV4O1xuICBjb25zdCBuZXh0OiBSZWNvcmQ8c3RyaW5nLCBMb2NhbEluZGV4RW50cnk+ID0geyAuLi5pbmRleCB9O1xuICBkZWxldGUgbmV4dFtwYXRoXTtcbiAgcmV0dXJuIG5leHQ7XG59XG5cbi8qKlxuICogU2VyaWFsaXplIHRvIGEgZGV0ZXJtaW5pc3RpYyBKU09OIHN0cmluZzogdmVyc2lvbmVkIGVudmVsb3BlLCBlbnRyaWVzXG4gKiBzb3J0ZWQgYnkgcGF0aCAoc28gaWRlbnRpY2FsIGluZGV4ZXMgc2VyaWFsaXplIGJ5dGUtaWRlbnRpY2FsbHkgYW5kIGRpZmZcbiAqIGNsZWFubHkgaW4gc3RhdGUtZGlyIGxpc3RpbmdzKS4gYHN0YXRlYCAob3B0aW9uYWwpIGNhcnJpZXMgdGhlIHN5bmMtY3Vyc29yXG4gKiBib29ra2VlcGluZyBwZXJzaXN0ZWQgYWxvbmdzaWRlIHRoZSBlbnRyaWVzIFx1MjAxNCBzZWUgYFBlcnNpc3RlZFN5bmNTdGF0ZWAuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXJpYWxpemVMb2NhbEluZGV4KGluZGV4OiBMb2NhbEluZGV4LCBzdGF0ZTogUGVyc2lzdGVkU3luY1N0YXRlID0ge30pOiBzdHJpbmcge1xuICBjb25zdCBlbnRyaWVzOiBSZWNvcmQ8c3RyaW5nLCBMb2NhbEluZGV4RW50cnk+ID0ge307XG4gIGZvciAoY29uc3QgcGF0aCBvZiBPYmplY3Qua2V5cyhpbmRleCkuc29ydCgpKSB7XG4gICAgZW50cmllc1twYXRoXSA9IGluZGV4W3BhdGhdIGFzIExvY2FsSW5kZXhFbnRyeTtcbiAgfVxuICBjb25zdCBlbnZlbG9wZTogTG9jYWxJbmRleEVudmVsb3BlID0ge1xuICAgIHNjaGVtYVZlcnNpb246IExPQ0FMX0lOREVYX1NDSEVNQV9WRVJTSU9OLFxuICAgIGVudHJpZXMsXG4gICAgLi4uKHN0YXRlLmN1cnNvciAhPT0gdW5kZWZpbmVkID8geyBjdXJzb3I6IHN0YXRlLmN1cnNvciB9IDoge30pLFxuICAgIC4uLihzdGF0ZS5zeW5jZWRUaHJvdWdoICE9PSB1bmRlZmluZWQgPyB7IHN5bmNlZFRocm91Z2g6IHN0YXRlLnN5bmNlZFRocm91Z2ggfSA6IHt9KSxcbiAgICAuLi4oc3RhdGUubmVlZHNGdWxsTWFuaWZlc3QgIT09IHVuZGVmaW5lZFxuICAgICAgPyB7IG5lZWRzRnVsbE1hbmlmZXN0OiBzdGF0ZS5uZWVkc0Z1bGxNYW5pZmVzdCB9XG4gICAgICA6IHt9KSxcbiAgfTtcbiAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KGVudmVsb3BlKTtcbn1cblxuLyoqIFRoZSBlbnRyaWVzIHBsdXMgdGhlIHN5bmMtY3Vyc29yIGJvb2trZWVwaW5nIG9mIGEgcGVyc2lzdGVkIHN0YXRlIGZpbGUuICovXG5leHBvcnQgaW50ZXJmYWNlIERlc2VyaWFsaXplZExvY2FsU3RhdGUge1xuICBpbmRleDogTG9jYWxJbmRleDtcbiAgLyoqIEVudmVsb3BlIGJvb2trZWVwaW5nOyBkZWZhdWx0cyBmb3IgZmlsZXMgd3JpdHRlbiBiZWZvcmUgaXQgZXhpc3RlZC4gKi9cbiAgc3RhdGU6IFJlcXVpcmVkPFBlcnNpc3RlZFN5bmNTdGF0ZT47XG59XG5cbi8qKlxuICogUGFyc2UgYSBzZXJpYWxpemVkIHN0YXRlIGZpbGUgSU5DTFVESU5HIGl0cyBlbnZlbG9wZSBib29ra2VlcGluZyAodGhlXG4gKiBjbGllbnQncyBzdGFydHVwIHBhdGgpLiBFbnRyeSB2YWxpZGF0aW9uIGlzIGlkZW50aWNhbCB0b1xuICogYGRlc2VyaWFsaXplTG9jYWxJbmRleGA7IHRoZSBleHRyYSBmaWVsZHMgZGVmYXVsdCB0byBcIm5vIGN1cnNvciBrbm93bGVkZ2VcIlxuICogKGBjdXJzb3I6IDBgLCBgc3luY2VkVGhyb3VnaDogbnVsbGAsIGBuZWVkc0Z1bGxNYW5pZmVzdDogZmFsc2VgKSBzbyB2MlxuICogZmlsZXMgd3JpdHRlbiBieSBvbGRlciBidWlsZHMgbG9hZCB1bmNoYW5nZWQgYW5kIHNpbXBseSByZWNvbm5lY3Qgd2l0aCBhXG4gKiBmdWxsIG1hbmlmZXN0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gZGVzZXJpYWxpemVMb2NhbFN0YXRlKGpzb246IHN0cmluZyk6IERlc2VyaWFsaXplZExvY2FsU3RhdGUge1xuICBsZXQgcGFyc2VkOiB1bmtub3duO1xuICB0cnkge1xuICAgIHBhcnNlZCA9IEpTT04ucGFyc2UoanNvbik7XG4gIH0gY2F0Y2ggKGNhdXNlKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoJ0xvY2FsIGluZGV4IHN0YXRlIGlzIG5vdCB2YWxpZCBKU09OJywgeyBjYXVzZSB9KTtcbiAgfVxuICBpZiAoIWlzUGxhaW5PYmplY3QocGFyc2VkKSkge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKCdMb2NhbCBpbmRleCBzdGF0ZSBpcyBub3QgYW4gb2JqZWN0Jyk7XG4gIH1cbiAgLy8gRW50cnktbGV2ZWwgdmFsaWRhdGlvbiBpcyBleGFjdGx5IGBkZXNlcmlhbGl6ZUxvY2FsSW5kZXhgJ3M7IHRoZSBjYWxsXG4gIC8vIGFsc28gZW5mb3JjZXMgdGhlIHNjaGVtYS12ZXJzaW9uIHdpbmRvdy5cbiAgY29uc3QgaW5kZXggPSBkZXNlcmlhbGl6ZUxvY2FsSW5kZXgoanNvbik7XG4gIGNvbnN0IHJhd0N1cnNvciA9IChwYXJzZWQgYXMgeyBjdXJzb3I/OiB1bmtub3duIH0pLmN1cnNvcjtcbiAgY29uc3QgcmF3U3luY2VkVGhyb3VnaCA9IChwYXJzZWQgYXMgeyBzeW5jZWRUaHJvdWdoPzogdW5rbm93biB9KS5zeW5jZWRUaHJvdWdoO1xuICBjb25zdCByYXdOZWVkc0Z1bGwgPSAocGFyc2VkIGFzIHsgbmVlZHNGdWxsTWFuaWZlc3Q/OiB1bmtub3duIH0pLm5lZWRzRnVsbE1hbmlmZXN0O1xuICBpZiAocmF3Q3Vyc29yICE9PSB1bmRlZmluZWQgJiYgKHR5cGVvZiByYXdDdXJzb3IgIT09ICdudW1iZXInIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKHJhd0N1cnNvcikgfHwgcmF3Q3Vyc29yIDwgMCkpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcignTG9jYWwgaW5kZXggc3RhdGU6IGN1cnNvciBtdXN0IGJlIGEgbm9uLW5lZ2F0aXZlIGludGVnZXInKTtcbiAgfVxuICBpZiAoXG4gICAgcmF3U3luY2VkVGhyb3VnaCAhPT0gdW5kZWZpbmVkICYmXG4gICAgcmF3U3luY2VkVGhyb3VnaCAhPT0gbnVsbCAmJlxuICAgICh0eXBlb2YgcmF3U3luY2VkVGhyb3VnaCAhPT0gJ251bWJlcicgfHwgIU51bWJlci5pc0ludGVnZXIocmF3U3luY2VkVGhyb3VnaCkgfHwgcmF3U3luY2VkVGhyb3VnaCA8IDApXG4gICkge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKCdMb2NhbCBpbmRleCBzdGF0ZTogc3luY2VkVGhyb3VnaCBtdXN0IGJlIGEgbm9uLW5lZ2F0aXZlIGludGVnZXIgb3IgbnVsbCcpO1xuICB9XG4gIGlmIChyYXdOZWVkc0Z1bGwgIT09IHVuZGVmaW5lZCAmJiB0eXBlb2YgcmF3TmVlZHNGdWxsICE9PSAnYm9vbGVhbicpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcignTG9jYWwgaW5kZXggc3RhdGU6IG5lZWRzRnVsbE1hbmlmZXN0IG11c3QgYmUgYSBib29sZWFuIHdoZW4gcHJlc2VudCcpO1xuICB9XG4gIHJldHVybiB7XG4gICAgaW5kZXgsXG4gICAgc3RhdGU6IHtcbiAgICAgIGN1cnNvcjogdHlwZW9mIHJhd0N1cnNvciA9PT0gJ251bWJlcicgPyByYXdDdXJzb3IgOiAwLFxuICAgICAgc3luY2VkVGhyb3VnaDogdHlwZW9mIHJhd1N5bmNlZFRocm91Z2ggPT09ICdudW1iZXInID8gcmF3U3luY2VkVGhyb3VnaCA6IG51bGwsXG4gICAgICBuZWVkc0Z1bGxNYW5pZmVzdDogcmF3TmVlZHNGdWxsID09PSB0cnVlLFxuICAgIH0sXG4gIH07XG59XG5cbi8qKlxuICogUGFyc2UgYSBzZXJpYWxpemVkIGluZGV4IGJhY2suIFRocm93cyBgUHJvdG9jb2xFcnJvcmAgb24gbm9uLUpTT04gaW5wdXQsXG4gKiBhIG1hbGZvcm1lZCBlbnZlbG9wZSwgZW50cmllcyB3aXRoIHdyb25nIGZpZWxkIHR5cGVzLCBvciBhIGBzY2hlbWFWZXJzaW9uYFxuICogb3V0c2lkZSB0aGUgc3VwcG9ydGVkIHJhbmdlIChvbGRlciB0aGFuIGBNSU5fTE9DQUxfSU5ERVhfU0NIRU1BX1ZFUlNJT05gXG4gKiBvciBuZXdlciB0aGFuIGBMT0NBTF9JTkRFWF9TQ0hFTUFfVkVSU0lPTmApIFx1MjAxNCBvbGRlciB2ZXJzaW9ucyAqd2l0aGluKiB0aGVcbiAqIHJhbmdlIGxvYWQgd2l0aG91dCBlcnJvciAodjEgZW50cmllcyBzaW1wbHkgZGVzZXJpYWxpemUgd2l0aCBgbXRpbWVgXG4gKiB1bmtub3duKS4gVW5rbm93biBleHRyYSBmaWVsZHMgYXJlIHRvbGVyYXRlZCBmb3IgZm9yd2FyZCBjb21wYXRpYmlsaXR5LlxuICovXG5leHBvcnQgZnVuY3Rpb24gZGVzZXJpYWxpemVMb2NhbEluZGV4KGpzb246IHN0cmluZyk6IExvY2FsSW5kZXgge1xuICBsZXQgcGFyc2VkOiB1bmtub3duO1xuICB0cnkge1xuICAgIHBhcnNlZCA9IEpTT04ucGFyc2UoanNvbik7XG4gIH0gY2F0Y2ggKGNhdXNlKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoJ0xvY2FsIGluZGV4IHN0YXRlIGlzIG5vdCB2YWxpZCBKU09OJywgeyBjYXVzZSB9KTtcbiAgfVxuICBpZiAoIWlzUGxhaW5PYmplY3QocGFyc2VkKSkge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKCdMb2NhbCBpbmRleCBzdGF0ZSBpcyBub3QgYW4gb2JqZWN0Jyk7XG4gIH1cbiAgY29uc3QgdmVyc2lvbiA9IHBhcnNlZC5zY2hlbWFWZXJzaW9uO1xuICBpZiAodHlwZW9mIHZlcnNpb24gIT09ICdudW1iZXInIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKHZlcnNpb24pKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoJ0xvY2FsIGluZGV4IHN0YXRlIGlzIG1pc3NpbmcgaW50ZWdlciBzY2hlbWFWZXJzaW9uJyk7XG4gIH1cbiAgaWYgKHZlcnNpb24gPCBNSU5fTE9DQUxfSU5ERVhfU0NIRU1BX1ZFUlNJT04gfHwgdmVyc2lvbiA+IExPQ0FMX0lOREVYX1NDSEVNQV9WRVJTSU9OKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoXG4gICAgICBgTG9jYWwgaW5kZXggc2NoZW1hIHZlcnNpb24gJHt2ZXJzaW9ufSBpcyBub3Qgc3VwcG9ydGVkIGJ5IHRoaXMgYnVpbGQgYCArXG4gICAgICAgIGAoZXhwZWN0ZWQgJHtNSU5fTE9DQUxfSU5ERVhfU0NIRU1BX1ZFUlNJT059Li4ke0xPQ0FMX0lOREVYX1NDSEVNQV9WRVJTSU9OfSk7IGAgK1xuICAgICAgICAnYSBtaWdyYXRpb24gaXMgcmVxdWlyZWQnLFxuICAgICk7XG4gIH1cbiAgY29uc3QgcmF3RW50cmllcyA9IHBhcnNlZC5lbnRyaWVzO1xuICBpZiAoIWlzUGxhaW5PYmplY3QocmF3RW50cmllcykpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcignTG9jYWwgaW5kZXggc3RhdGUgaXMgbWlzc2luZyB0aGUgZW50cmllcyBvYmplY3QnKTtcbiAgfVxuXG4gIGNvbnN0IGVudHJpZXM6IFJlY29yZDxzdHJpbmcsIExvY2FsSW5kZXhFbnRyeT4gPSB7fTtcbiAgZm9yIChjb25zdCBbcGF0aCwgcmF3XSBvZiBPYmplY3QuZW50cmllcyhyYXdFbnRyaWVzKSkge1xuICAgIGVudHJpZXNbcGF0aF0gPSBwYXJzZUVudHJ5KHBhdGgsIHJhdyk7XG4gIH1cbiAgcmV0dXJuIGVudHJpZXM7XG59XG5cbmZ1bmN0aW9uIHBhcnNlRW50cnkocGF0aDogc3RyaW5nLCByYXc6IHVua25vd24pOiBMb2NhbEluZGV4RW50cnkge1xuICBjb25zdCB3aGVyZSA9IGBMb2NhbCBpbmRleCBlbnRyeSAke0pTT04uc3RyaW5naWZ5KHBhdGgpfWA7XG4gIGlmICghaXNQbGFpbk9iamVjdChyYXcpKSB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgJHt3aGVyZX0gaXMgbm90IGFuIG9iamVjdGApO1xuICBjb25zdCB7IGhhc2gsIHNpemUsIHZlcnNpb25JZCwgY2xvY2ssIGRlbGV0ZWRBdCwgaXNGb2xkZXIsIG10aW1lIH0gPSByYXcgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIGlmICh0eXBlb2YgaGFzaCAhPT0gJ3N0cmluZycpIHRocm93IG5ldyBQcm90b2NvbEVycm9yKGAke3doZXJlfTogaGFzaCBtdXN0IGJlIGEgc3RyaW5nYCk7XG4gIGlmICh0eXBlb2YgdmVyc2lvbklkICE9PSAnc3RyaW5nJykge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKGAke3doZXJlfTogdmVyc2lvbklkIG11c3QgYmUgYSBzdHJpbmdgKTtcbiAgfVxuICBpZiAodHlwZW9mIHNpemUgIT09ICdudW1iZXInIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKHNpemUpIHx8IHNpemUgPCAwKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoYCR7d2hlcmV9OiBzaXplIG11c3QgYmUgYSBub24tbmVnYXRpdmUgaW50ZWdlcmApO1xuICB9XG4gIGlmICghaXNQbGFpbk9iamVjdChjbG9jaykgfHwgdHlwZW9mIGNsb2NrLmNvdW50ZXIgIT09ICdudW1iZXInIHx8IHR5cGVvZiBjbG9jay5kZXZpY2VJZCAhPT0gJ3N0cmluZycpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgJHt3aGVyZX06IGNsb2NrIG11c3QgYmUgeyBjb3VudGVyOiBudW1iZXIsIGRldmljZUlkOiBzdHJpbmcgfWApO1xuICB9XG4gIGlmIChkZWxldGVkQXQgIT09IHVuZGVmaW5lZCAmJiB0eXBlb2YgZGVsZXRlZEF0ICE9PSAnbnVtYmVyJykge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKGAke3doZXJlfTogZGVsZXRlZEF0IG11c3QgYmUgYSBudW1iZXIgd2hlbiBwcmVzZW50YCk7XG4gIH1cbiAgaWYgKGlzRm9sZGVyICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIGlzRm9sZGVyICE9PSAnYm9vbGVhbicpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgJHt3aGVyZX06IGlzRm9sZGVyIG11c3QgYmUgYSBib29sZWFuIHdoZW4gcHJlc2VudGApO1xuICB9XG4gIGlmIChtdGltZSAhPT0gdW5kZWZpbmVkICYmICh0eXBlb2YgbXRpbWUgIT09ICdudW1iZXInIHx8ICFOdW1iZXIuaXNGaW5pdGUobXRpbWUpKSkge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKGAke3doZXJlfTogbXRpbWUgbXVzdCBiZSBhIGZpbml0ZSBudW1iZXIgd2hlbiBwcmVzZW50YCk7XG4gIH1cbiAgY29uc3QgZW50cnk6IExvY2FsSW5kZXhFbnRyeSA9IHtcbiAgICBoYXNoLFxuICAgIHNpemUsXG4gICAgdmVyc2lvbklkLFxuICAgIGNsb2NrOiB7IGNvdW50ZXI6IGNsb2NrLmNvdW50ZXIgYXMgbnVtYmVyLCBkZXZpY2VJZDogY2xvY2suZGV2aWNlSWQgYXMgc3RyaW5nIH0sXG4gIH07XG4gIGlmIChkZWxldGVkQXQgIT09IHVuZGVmaW5lZCkgZW50cnkuZGVsZXRlZEF0ID0gZGVsZXRlZEF0IGFzIG51bWJlcjtcbiAgaWYgKGlzRm9sZGVyICE9PSB1bmRlZmluZWQpIGVudHJ5LmlzRm9sZGVyID0gaXNGb2xkZXIgYXMgYm9vbGVhbjtcbiAgaWYgKG10aW1lICE9PSB1bmRlZmluZWQpIGVudHJ5Lm10aW1lID0gbXRpbWUgYXMgbnVtYmVyO1xuICByZXR1cm4gZW50cnk7XG59XG5cbmZ1bmN0aW9uIGlzUGxhaW5PYmplY3QodmFsdWU6IHVua25vd24pOiB2YWx1ZSBpcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB7XG4gIHJldHVybiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIHZhbHVlICE9PSBudWxsICYmICFBcnJheS5pc0FycmF5KHZhbHVlKTtcbn1cbiIsICIvKipcclxuICogVGhpbiBwdWxsLXNpZGUgb3JjaGVzdHJhdGlvbiAoQVJDSElURUNUVVJFLm1kIFx1MDBBNzggc3RlcCA1KS4gTk9UIHRoZSBuZXR3b3JrXHJcbiAqIGNsaWVudDogYWxsIHRyYW5zcG9ydCBpcyBpbmplY3RlZCAoYGZldGNoQmxvYmApLCB3aGljaCB0aGUgbGF0ZXIgbmV0d29ya1xyXG4gKiBwaGFzZSBpbXBsZW1lbnRzIG92ZXIgYC9ibG9iLzpoYXNoYCBvciBXUy1pbmxpbmUgY29udGVudC5cclxuICpcclxuICogYGFwcGx5UHVsbGAgbWF0ZXJpYWxpemVzIGV2ZXJ5IGBQdWxsT3BgIG9mIGEgYFN5bmNQbGFuYCB0aHJvdWdoIHRoZVxyXG4gKiBzdG9yYWdlIGFkYXB0ZXIgYW5kIHVwZGF0ZXMgdGhlIGxvY2FsIGluZGV4IFx1MjAxNCBkdXJhYmx5IGFuZCBob25lc3RseTpcclxuICpcclxuICogICAtIGJsb2JzIGFyZSB2ZXJpZmllZCAoc2hhMjU2KSBiZWZvcmUgYmVpbmcgd3JpdHRlbjsgYSBtaXNtYXRjaCBhYm9ydHNcclxuICogICAgIHRoZSBwbGFuO1xyXG4gKiAgIC0gZWFjaCBpbmRleCBlbnRyeSBpcyByZWNvcmRlZCBvbmx5ICphZnRlciogaXRzIHN0b3JhZ2Ugd3JpdGUgc3VjY2VlZGVkLFxyXG4gKiAgICAgc28gYSBtaWQtcGxhbiBmYWlsdXJlIGxlYXZlcyB0aGUgaW5kZXggZGVzY3JpYmluZyBleGFjdGx5IHRoZSBmaWxlc1xyXG4gKiAgICAgdGhhdCBhY3R1YWxseSBsYW5kZWQgKEZSLTU6IG5vdGhpbmcgaXMgc2lsZW50bHkgbG9zdCBcdTIwMTQgdGhlIHVuc3luY2VkXHJcbiAqICAgICBwdWxscyBzaW1wbHkgcmVtYWluIGluIHRoZSBwbGFuIGFuZCBhcmUgcmV0cmllZCBieSB0aGUgY2FsbGVyKTtcclxuICogICAtIHRoZSBpbmRleCBpcyBwZXJzaXN0ZWQgdGhyb3VnaCB0aGUgYWRhcHRlcidzIGF0b21pYyBgd3JpdGVGaWxlYFxyXG4gKiAgICAgKHRlbXAgKyByZW5hbWUgcGVyIHRoZSBhZGFwdGVyIGNvbnRyYWN0KSBhdFxyXG4gKiAgICAgYC8udmF1bHRzeW5jZm9yYWdlbnRzL3N0YXRlYCwgaW5jbHVkaW5nIG9uIHRoZSBmYWlsdXJlIHBhdGguXHJcbiAqXHJcbiAqIEZvbGRlciBsaWZlY3ljbGUgKEZSLTEwIGFuZCBpdHMgZGVsZXRpb24gY291bnRlcnBhcnQpOlxyXG4gKlxyXG4gKiAgIC0gYXBwbHlpbmcgYSBSRU1PVEUgRk9MREVSIFRPTUJTVE9ORSByZW1vdmVzIHRoZSBsb2NhbCBkaXJlY3Rvcnkgd2hlblxyXG4gKiAgICAgaXQgZXhpc3RzIGFuZCBpcyBlbXB0eSAoYWRhcHRlciBgcmVtb3ZlRGlyYCk7IG5vbi1lbXB0eSBvciBtaXNzaW5nIFx1MjFEMlxyXG4gKiAgICAgcmVjb3JkIHRoZSB0b21ic3RvbmUgb25seSBcdTIwMTQgdGhlIGRpcmVjdG9yeSBjb252ZXJnZXMgbGF0ZXIsIGFuZCBhXHJcbiAqICAgICBub24tZW1wdHkgZGlyZWN0b3J5IGlzIG5ldmVyIGRlbGV0ZWQ7XHJcbiAqICAgLSBQUlVORS1PTi1ERUxFVEU6IGFwcGx5aW5nIGEgcmVtb3RlIGZpbGUgZGVsZXRpb24gKG9yIHJlbmFtZSBhd2F5KVxyXG4gKiAgICAgcmVtb3ZlcyB0aGUgZGVsZXRlZCBwYXRoJ3MgcGFyZW50IGRpcmVjdG9yeSB3aGVuIGl0IGlzIG5vdyBlbXB0eSBvblxyXG4gKiAgICAgZGlzayBhbmQgaG9sZHMgbm8gbGl2ZSBmaWxlIGVudHJpZXMgaW4gdGhlIGluZGV4IFx1MjAxNCB0aGlzIGlzIHdoYXQgc3RvcHNcclxuICogICAgIGFuIGVtcHRpZWQgZGlyZWN0b3J5IGZyb20gc2VsZi1yZXN1cnJlY3RpbmcgYXMgYW4gZW1wdHktZm9sZGVyXHJcbiAqICAgICBwbGFjZWhvbGRlciBvbiB0aGUgbmV4dCBzY2FuLiBFeGFjdGx5IE9ORSBsZXZlbCBwZXIgZGVsZXRpb246IHRoZVxyXG4gKiAgICAgaW1tZWRpYXRlIHBhcmVudCBvbmx5LCBuZXZlciBhIGNhc2NhZGUgKGEgY2hhaW4gb2YgZW1wdGllZFxyXG4gKiAgICAgZGlyZWN0b3JpZXMgY29udmVyZ2VzIG92ZXIgc3VjY2Vzc2l2ZSBjeWNsZXM7IHRoZSBzYWZldHkgaW52YXJpYW50IFx1MjAxNFxyXG4gKiAgICAgbmV2ZXIgZGVsZXRlIGEgbm9uLWVtcHR5IGRpcmVjdG9yeSwgbmV2ZXIgbG9zZSB1c2VyIGNvbnRlbnQgXHUyMDE0IGlzXHJcbiAqICAgICBjaGVja2VkIGJlZm9yZSBldmVyeSByZW1vdmFsKS5cclxuICpcclxuICogUHVzaGVzL2NvbmZsaWN0cy9mb2xkZXIgb3BzIGFyZSB0aGUgbmV0d29yayBwaGFzZSdzIGJ1c2luZXNzOyByZXRyeVxyXG4gKiBxdWV1ZXMgYXJlIGV4cGxpY2l0bHkgb3V0IG9mIHNjb3BlIGhlcmUuXHJcbiAqL1xyXG5cclxuaW1wb3J0IHR5cGUgeyBTdG9yYWdlQWRhcHRlciB9IGZyb20gJy4vYWRhcHRlcnMuanMnO1xyXG5pbXBvcnQgeyBzaGEyNTZIZXggfSBmcm9tICcuL2hhc2hpbmcuanMnO1xyXG5pbXBvcnQge1xyXG4gIGFwcGx5Q29tbWl0LFxyXG4gIGRlc2VyaWFsaXplTG9jYWxTdGF0ZSxcclxuICBMT0NBTF9JTkRFWF9TVEFURV9QQVRILFxyXG4gIHJlbW92ZUVudHJ5LFxyXG4gIHNlcmlhbGl6ZUxvY2FsSW5kZXgsXHJcbiAgdHlwZSBEZXNlcmlhbGl6ZWRMb2NhbFN0YXRlLFxyXG4gIHR5cGUgTG9jYWxJbmRleCxcclxuICB0eXBlIFBlcnNpc3RlZFN5bmNTdGF0ZSxcclxufSBmcm9tICcuL2xvY2FsaW5kZXguanMnO1xyXG5pbXBvcnQgeyBpc1N0cmljdGx5QmVuZWF0aCwgcGFyZW50UGF0aCB9IGZyb20gJy4vcGF0aHMuanMnO1xyXG5pbXBvcnQgdHlwZSB7IFB1bGxPcCwgU3luY1BsYW4gfSBmcm9tICcuL3Jlc29sdmUuanMnO1xyXG5cclxuLyoqIEluamVjdGVkIGNvbnRlbnQgdHJhbnNwb3J0OiBmZXRjaCB0aGUgYmxvYiBmb3IgYSBjb250ZW50IGhhc2guICovXHJcbmV4cG9ydCB0eXBlIEZldGNoQmxvYiA9IChoYXNoOiBzdHJpbmcpID0+IFByb21pc2U8VWludDhBcnJheT47XHJcblxyXG5leHBvcnQgaW50ZXJmYWNlIEFwcGx5UHVsbE9wdGlvbnMge1xyXG4gIC8qKiBFcG9jaCBtcyB1c2VkIGZvciB0b21ic3RvbmUgdGltZXN0YW1wcy4gRGVmYXVsdDogYERhdGUubm93KClgIFx1MjAxNCB0aGlzXHJcbiAgICogIGZ1bmN0aW9uIGlzIEkvTyBvcmNoZXN0cmF0aW9uLCBub3QgYSBwdXJlIGZ1bmN0aW9uLCBidXQgdGVzdHMgaW5qZWN0XHJcbiAgICogIGEgZml4ZWQgdmFsdWUgZm9yIGRldGVybWluaXNtLiAqL1xyXG4gIG5vdz86IG51bWJlcjtcclxuICAvKipcclxuICAgKiBCdWxrLXB1bGwgcHJvZ3Jlc3M6IGNhbGxlZCBvbmNlIHdpdGggKDAsIHRvdGFsKSB1cCBmcm9udCBhbmQgb25jZSBhZnRlclxyXG4gICAqIGVhY2ggcHVsbCBtYXRlcmlhbGl6ZXMuIFB1cmUgcmVwb3J0aW5nIFx1MjAxNCBuZXZlciBhZmZlY3RzIGFwcGxpY2F0aW9uLlxyXG4gICAqL1xyXG4gIG9uUHJvZ3Jlc3M/OiAoZG9uZTogbnVtYmVyLCB0b3RhbDogbnVtYmVyKSA9PiB2b2lkO1xyXG4gIC8qKlxyXG4gICAqIFN5bmMtY3Vyc29yIGJvb2trZWVwaW5nIHRvIHdyaXRlIGludG8gdGhlIHN0YXRlIGZpbGUncyBlbnZlbG9wZSB3aGVuZXZlclxyXG4gICAqIHRoaXMgY2FsbCBwZXJzaXN0cyB0aGUgaW5kZXguIFdpdGhvdXQgaXQgYSBwdWxsLXNpZGUgcGVyc2lzdCB3b3VsZCBzdHJpcFxyXG4gICAqIHRoZSBjbGllbnQncyBjdXJzb3Ivc3luY2VkVGhyb3VnaCBmaWVsZHMgZnJvbSBgLy52YXVsdHN5bmNmb3JhZ2VudHMvc3RhdGVgXHJcbiAgICogKHRoZSBlbnZlbG9wZSBpcyByZXdyaXR0ZW4gd2hvbGVzYWxlKS4gVGhlIGNsaWVudCBwYXNzZXMgaXRzIGN1cnJlbnRcclxuICAgKiB2YWx1ZXM7IGEgc25hcHNob3QgYSBtb21lbnQgc3RhbGUgaXMgaGFybWxlc3MgXHUyMDE0IHRoZSBuZXh0IHBlcnNpc3QgcmVmcmVzaGVzXHJcbiAgICogaXQsIGFuZCBhbiB1bmRlci1yZXBvcnRlZCBjdXJzb3Igb25seSB3aWRlbnMgdGhlIG5leHQgcmVwbGF5LlxyXG4gICAqL1xyXG4gIHBlcnNpc3RlZFN0YXRlPzogUGVyc2lzdGVkU3luY1N0YXRlO1xyXG59XHJcblxyXG4vKipcclxuICogQXBwbHkgYWxsIHB1bGxzIG9mIGBwbGFuYCBhbmQgcmV0dXJuIHRoZSB1cGRhdGVkIGluZGV4IChhbHNvIHBlcnNpc3RlZCB0b1xyXG4gKiB0aGUgYWRhcHRlciBhdCBgTE9DQUxfSU5ERVhfU1RBVEVfUEFUSGApLlxyXG4gKlxyXG4gKiBTdG9yYWdlIHdyaXRlcyBoYXBwZW4gaW4gcGxhbiBvcmRlci4gSWYgYW55IG9wIGZhaWxzLCB0aGUgaW5kZXggcmVmbGVjdGluZ1xyXG4gKiBldmVyeSBvcCB0aGF0IHN1Y2NlZWRlZCBzbyBmYXIgaXMgcGVyc2lzdGVkIGFuZCB0aGUgb3JpZ2luYWwgZXJyb3IgaXNcclxuICogcmV0aHJvd24gXHUyMDE0IHBhdGhzIHRoYXQgZmFpbGVkIGFyZSBhYnNlbnQgZnJvbSB0aGUgcmV0dXJuZWQvcGVyc2lzdGVkIGluZGV4LlxyXG4gKi9cclxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGFwcGx5UHVsbChcclxuICBzdG9yYWdlOiBTdG9yYWdlQWRhcHRlcixcclxuICBpbmRleDogTG9jYWxJbmRleCxcclxuICBwbGFuOiBTeW5jUGxhbixcclxuICBmZXRjaEJsb2I6IEZldGNoQmxvYixcclxuICBvcHRpb25zOiBBcHBseVB1bGxPcHRpb25zID0ge30sXHJcbik6IFByb21pc2U8TG9jYWxJbmRleD4ge1xyXG4gIGNvbnN0IG5vdyA9IG9wdGlvbnMubm93ID8/IERhdGUubm93KCk7XHJcbiAgY29uc3Qgb25Qcm9ncmVzcyA9IG9wdGlvbnMub25Qcm9ncmVzcztcclxuICBsZXQgd29ya2luZzogTG9jYWxJbmRleCA9IGluZGV4O1xyXG5cclxuICBvblByb2dyZXNzPy4oMCwgcGxhbi5wdWxscy5sZW5ndGgpO1xyXG4gIGxldCBkb25lID0gMDtcclxuICB0cnkge1xyXG4gICAgZm9yIChjb25zdCBwdWxsIG9mIHBsYW4ucHVsbHMpIHtcclxuICAgICAgd29ya2luZyA9IGF3YWl0IGFwcGx5T25lUHVsbChzdG9yYWdlLCB3b3JraW5nLCBwdWxsLCBmZXRjaEJsb2IsIG5vdyk7XHJcbiAgICAgIGRvbmUgKz0gMTtcclxuICAgICAgb25Qcm9ncmVzcz8uKGRvbmUsIHBsYW4ucHVsbHMubGVuZ3RoKTtcclxuICAgIH1cclxuICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgdHJ5IHtcclxuICAgICAgYXdhaXQgcGVyc2lzdEluZGV4KHN0b3JhZ2UsIHdvcmtpbmcsIG9wdGlvbnMucGVyc2lzdGVkU3RhdGUpO1xyXG4gICAgfSBjYXRjaCB7XHJcbiAgICAgIC8vIFBlcnNpc3RlbmNlIGZhaWx1cmUgbXVzdCBub3QgbWFzayB0aGUgb3JpZ2luYWwgZXJyb3I7IHRoZSBjYWxsZXJcclxuICAgICAgLy8gcmV0cmllcyB0aGUgd2hvbGUgY3ljbGUgYW55d2F5LlxyXG4gICAgfVxyXG4gICAgdGhyb3cgZXJyb3I7XHJcbiAgfVxyXG5cclxuICBhd2FpdCBwZXJzaXN0SW5kZXgoc3RvcmFnZSwgd29ya2luZywgb3B0aW9ucy5wZXJzaXN0ZWRTdGF0ZSk7XHJcbiAgcmV0dXJuIHdvcmtpbmc7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIGFwcGx5T25lUHVsbChcclxuICBzdG9yYWdlOiBTdG9yYWdlQWRhcHRlcixcclxuICBpbmRleDogTG9jYWxJbmRleCxcclxuICBwdWxsOiBQdWxsT3AsXHJcbiAgZmV0Y2hCbG9iOiBGZXRjaEJsb2IsXHJcbiAgbm93OiBudW1iZXIsXHJcbik6IFByb21pc2U8TG9jYWxJbmRleD4ge1xyXG4gIGlmIChwdWxsLmtpbmQgPT09ICdyZW5hbWUnKSB7XHJcbiAgICBpZiAocHVsbC5pc0ZvbGRlciA9PT0gdHJ1ZSkge1xyXG4gICAgICAvLyBGb2xkZXIgcmVuYW1lIChGUi0xMCk6IGEgbWV0YWRhdGEgbW92ZSBcdTIwMTQgdGhlIGhhc2ggaXMgdGhlXHJcbiAgICAgIC8vIHBsYWNlaG9sZGVyJ3MgYCcnYCBhbmQgbXVzdCBORVZFUiByZWFjaCBhIGNvbnRlbnQgZmV0Y2guIFRoZSByZW5hbWVcclxuICAgICAgLy8gYnJhbmNoIGJlbG93IHdvdWxkIGZldGNoIHdoZW4gYGZyb21QYXRoYCBpcyBnb25lIGxvY2FsbHkgKGFsd2F5cyB0cnVlXHJcbiAgICAgIC8vIG9uIHRoZSBhdXRob3IsIHdobyBhbHJlYWR5IG1vdmVkIHRoZSBkaXJlY3RvcnkpLCB0cmlwcGluZyB0aGVcclxuICAgICAgLy8gZW1wdHktaGFzaCBndWFyZCBhbmQgd2VkZ2luZyBldmVyeSBsYXRlciBjeWNsZS4gSW5zdGVhZDogbWF0ZXJpYWxpemVcclxuICAgICAgLy8gdGhlIGRlc3RpbmF0aW9uLCByZXRpcmUgdGhlIHNvdXJjZSBlbnRyeSwgYW5kIHJlbW92ZSB0aGUgc291cmNlXHJcbiAgICAgIC8vIGRpcmVjdG9yeSBvbmNlIGl0IGlzIHZhY2FudCAoY2hpbGRyZW4gbW92ZSB0aHJvdWdoIHRoZWlyIG93biBmaWxlXHJcbiAgICAgIC8vIG9wczsgYSBub24tZW1wdHkgZGlyZWN0b3J5IGlzIG5ldmVyIGRlbGV0ZWQgYW5kIGNvbnZlcmdlcyBsYXRlciBcdTIwMTRcclxuICAgICAgLy8gYHJlbmFtZUZpbGVgIGlzIGEgZmlsZS1vbmx5IGNvbnRyYWN0LCBzbyBubyBkaXJlY3RvcnkgcmVuYW1lIGlzXHJcbiAgICAgIC8vIGF0dGVtcHRlZCkuXHJcbiAgICAgIGF3YWl0IHN0b3JhZ2UuZW5zdXJlRGlyKHB1bGwudG9QYXRoKTtcclxuICAgICAgY29uc3QgbW92ZWQgPSBhcHBseUNvbW1pdChyZW1vdmVFbnRyeShpbmRleCwgcHVsbC5mcm9tUGF0aCksIHtcclxuICAgICAgICBwYXRoOiBwdWxsLnRvUGF0aCxcclxuICAgICAgICB2ZXJzaW9uSWQ6IHB1bGwudmVyc2lvbixcclxuICAgICAgICBoYXNoOiBwdWxsLmhhc2gsXHJcbiAgICAgICAgc2l6ZTogcHVsbC5zaXplLFxyXG4gICAgICAgIGNsb2NrOiBwdWxsLmNsb2NrLFxyXG4gICAgICAgIGlzRm9sZGVyOiB0cnVlLFxyXG4gICAgICB9KTtcclxuICAgICAgYXdhaXQgcmVtb3ZlRGlySWZWYWNhbnQoc3RvcmFnZSwgbW92ZWQsIHB1bGwuZnJvbVBhdGgpO1xyXG4gICAgICByZXR1cm4gbW92ZWQ7XHJcbiAgICB9XHJcbiAgICBpZiAoYXdhaXQgc3RvcmFnZS5leGlzdHMocHVsbC5mcm9tUGF0aCkpIHtcclxuICAgICAgYXdhaXQgc3RvcmFnZS5yZW5hbWVGaWxlKHB1bGwuZnJvbVBhdGgsIHB1bGwudG9QYXRoKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIC8vIE9sZCBwYXRoIG5ldmVyIG1hdGVyaWFsaXplZCBoZXJlIChvciBhbHJlYWR5IG1vdmVkKTogZmV0Y2ggY29udGVudC5cclxuICAgICAgLy8gQSBGSUxFIHJlbmFtZSBvbmx5IFx1MjAxNCBmb2xkZXIgcmVuYW1lcyBuZXZlciByZWFjaCB0aGlzIGJyYW5jaC5cclxuICAgICAgYXdhaXQgZmV0Y2hWZXJpZmllZChzdG9yYWdlLCBwdWxsLnRvUGF0aCwgcHVsbC5oYXNoLCBmZXRjaEJsb2IpO1xyXG4gICAgfVxyXG4gICAgY29uc3QgbW92ZWQgPSBhcHBseUNvbW1pdChyZW1vdmVFbnRyeShpbmRleCwgcHVsbC5mcm9tUGF0aCksIHtcclxuICAgICAgcGF0aDogcHVsbC50b1BhdGgsXHJcbiAgICAgIHZlcnNpb25JZDogcHVsbC52ZXJzaW9uLFxyXG4gICAgICBoYXNoOiBwdWxsLmhhc2gsXHJcbiAgICAgIHNpemU6IHB1bGwuc2l6ZSxcclxuICAgICAgY2xvY2s6IHB1bGwuY2xvY2ssXHJcbiAgICB9KTtcclxuICAgIC8vIFRoZSBsYXN0IGZpbGUgbWF5IGp1c3QgaGF2ZSBsZWZ0IGl0cyBvbGQgcGFyZW50IGRpcmVjdG9yeSAocHJ1bmUtb24tXHJcbiAgICAvLyBkZWxldGUgYXBwbGllcyB0byBtb3ZlcyB0b287IHRoZSByZW5hbWUgaXRzZWxmIGlzIHVudG91Y2hlZCkuXHJcbiAgICBhd2FpdCBwcnVuZVBhcmVudE9uRGVsZXRlKHN0b3JhZ2UsIG1vdmVkLCBwdWxsLmZyb21QYXRoKTtcclxuICAgIHJldHVybiBtb3ZlZDtcclxuICB9XHJcblxyXG4gIGlmIChwdWxsLmlzRm9sZGVyKSB7XHJcbiAgICAvLyBGb2xkZXIgcGxhY2Vob2xkZXJzIChGUi0xMCk6IGNyZWF0ZSB0aGUgZGlyZWN0b3J5LCByZWNvcmQgdGhlIGVudHJ5LlxyXG4gICAgLy8gQSBmb2xkZXIgVE9NQlNUT05FIGFkZGl0aW9uYWxseSByZW1vdmVzIHRoZSBsb2NhbCBkaXJlY3Rvcnkgd2hlbiBpdFxyXG4gICAgLy8gZXhpc3RzIGFuZCBpcyBlbXB0eTsgbm9uLWVtcHR5IG9yIG1pc3NpbmcgXHUyMUQyIHJlY29yZCBvbmx5IChjb252ZXJnZXNcclxuICAgIC8vIGxhdGVyIFx1MjAxNCBhIG5vbi1lbXB0eSBkaXJlY3RvcnkgaXMgbmV2ZXIgZGVsZXRlZCBoZXJlKS5cclxuICAgIGlmIChwdWxsLmRlbGV0ZWQpIHtcclxuICAgICAgYXdhaXQgcmVtb3ZlRGlySWZWYWNhbnQoc3RvcmFnZSwgaW5kZXgsIHB1bGwucGF0aCk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICBhd2FpdCBzdG9yYWdlLmVuc3VyZURpcihwdWxsLnBhdGgpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIGFwcGx5Q29tbWl0KGluZGV4LCB7XHJcbiAgICAgIHBhdGg6IHB1bGwucGF0aCxcclxuICAgICAgdmVyc2lvbklkOiBwdWxsLnZlcnNpb24sXHJcbiAgICAgIGhhc2g6IHB1bGwuaGFzaCxcclxuICAgICAgc2l6ZTogcHVsbC5zaXplLFxyXG4gICAgICBjbG9jazogcHVsbC5jbG9jayxcclxuICAgICAgZGVsZXRlZDogcHVsbC5kZWxldGVkLFxyXG4gICAgICBkZWxldGVkQXQ6IHB1bGwuZGVsZXRlZCA/IG5vdyA6IHVuZGVmaW5lZCxcclxuICAgICAgaXNGb2xkZXI6IHRydWUsXHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIGlmIChwdWxsLmRlbGV0ZWQpIHtcclxuICAgIC8vIElkZW1wb3RlbnQgcGVyIHRoZSBhZGFwdGVyIGNvbnRyYWN0OyBhIGxvY2FsIC50cmFzaCBjb3B5IGlzIGFcclxuICAgIC8vIHBsYXRmb3JtLWxheWVyIGNvbmNlcm4gKGRhZW1vbi9wbHVnaW4pLCBub3QgZW5naW5lIGxvZ2ljLlxyXG4gICAgYXdhaXQgc3RvcmFnZS5kZWxldGVGaWxlKHB1bGwucGF0aCk7XHJcbiAgICBjb25zdCB0b21ic3RvbmVkID0gYXBwbHlDb21taXQoaW5kZXgsIHtcclxuICAgICAgcGF0aDogcHVsbC5wYXRoLFxyXG4gICAgICB2ZXJzaW9uSWQ6IHB1bGwudmVyc2lvbixcclxuICAgICAgaGFzaDogcHVsbC5oYXNoLFxyXG4gICAgICBzaXplOiBwdWxsLnNpemUsXHJcbiAgICAgIGNsb2NrOiBwdWxsLmNsb2NrLFxyXG4gICAgICBkZWxldGVkOiB0cnVlLFxyXG4gICAgICBkZWxldGVkQXQ6IG5vdyxcclxuICAgIH0pO1xyXG4gICAgLy8gUHJ1bmUtb24tZGVsZXRlOiBhbiBlbXB0aWVkIHBhcmVudCBkaXJlY3RvcnkgbXVzdCBub3QgbGluZ2VyIGFuZFxyXG4gICAgLy8gcmUtc3VyZmFjZSBhcyBhbiBlbXB0eS1mb2xkZXIgcGxhY2Vob2xkZXIgb24gdGhlIG5leHQgc2Nhbi5cclxuICAgIGF3YWl0IHBydW5lUGFyZW50T25EZWxldGUoc3RvcmFnZSwgdG9tYnN0b25lZCwgcHVsbC5wYXRoKTtcclxuICAgIHJldHVybiB0b21ic3RvbmVkO1xyXG4gIH1cclxuXHJcbiAgY29uc3QgY3VycmVudCA9IGluZGV4W3B1bGwucGF0aF07XHJcbiAgaWYgKFxyXG4gICAgY3VycmVudCAhPT0gdW5kZWZpbmVkICYmXHJcbiAgICBjdXJyZW50LmRlbGV0ZWRBdCA9PT0gdW5kZWZpbmVkICYmXHJcbiAgICBjdXJyZW50Lmhhc2ggPT09IHB1bGwuaGFzaCAmJlxyXG4gICAgKGF3YWl0IHN0b3JhZ2UuZXhpc3RzKHB1bGwucGF0aCkpXHJcbiAgKSB7XHJcbiAgICAvLyBDb250ZW50IGFscmVhZHkgY29ycmVjdCBsb2NhbGx5IChlLmcuIHZlcnNpb24taWQgY2F0Y2gtdXAgYWZ0ZXIgYVxyXG4gICAgLy8gcmVuYW1lIGVsc2V3aGVyZSk6IHJlY29yZCB0aGUgYXV0aG9yaXRhdGl2ZSBoZWFkLCBza2lwIGZldGNoK3dyaXRlLlxyXG4gICAgLy8gVGhlIGV4aXN0ZW5jZSBjaGVjayBtYXR0ZXJzIHdoZW4gdGhlIGZpbGUgd2FzIGRlbGV0ZWQgbG9jYWxseSBzaW5jZSB0aGVcclxuICAgIC8vIGluZGV4IHdhcyBsYXN0IHdyaXR0ZW4gXHUyMDE0IHJlY3JlYXRpbmcgaXQgaXMgd2hhdCB0aGUgcHVsbCBkZW1hbmRzLlxyXG4gICAgcmV0dXJuIGFwcGx5Q29tbWl0KGluZGV4LCB7XHJcbiAgICAgIHBhdGg6IHB1bGwucGF0aCxcclxuICAgICAgdmVyc2lvbklkOiBwdWxsLnZlcnNpb24sXHJcbiAgICAgIGhhc2g6IHB1bGwuaGFzaCxcclxuICAgICAgc2l6ZTogcHVsbC5zaXplLFxyXG4gICAgICBjbG9jazogcHVsbC5jbG9jayxcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgYXdhaXQgZmV0Y2hWZXJpZmllZChzdG9yYWdlLCBwdWxsLnBhdGgsIHB1bGwuaGFzaCwgZmV0Y2hCbG9iKTtcclxuICByZXR1cm4gYXBwbHlDb21taXQoaW5kZXgsIHtcclxuICAgIHBhdGg6IHB1bGwucGF0aCxcclxuICAgIHZlcnNpb25JZDogcHVsbC52ZXJzaW9uLFxyXG4gICAgaGFzaDogcHVsbC5oYXNoLFxyXG4gICAgc2l6ZTogcHVsbC5zaXplLFxyXG4gICAgY2xvY2s6IHB1bGwuY2xvY2ssXHJcbiAgfSk7XHJcbn1cclxuXHJcbi8vIC0tLSBmb2xkZXIgbGlmZWN5Y2xlIGhlbHBlcnMgKEI6IHRvbWJzdG9uZS1hcHBseSwgQzogcHJ1bmUtb24tZGVsZXRlKSAtLS0tLS0tLVxyXG5cclxuLyoqIE91dGNvbWUgb2YgYSBwcnVuZSBhdHRlbXB0OiB0aGUgZGlyZWN0b3J5IGp1ZGdlZCBkZWxldGFibGUsIGFuZCB3aGV0aGVyIGl0IHdhcy4gKi9cclxuZXhwb3J0IGludGVyZmFjZSBQcnVuZWREaXIge1xyXG4gIC8qKiBUaGUgZGlyZWN0b3J5IHRoYXQgcXVhbGlmaWVkIGZvciByZW1vdmFsICh0aGUgZGVsZXRlZCBwYXRoJ3MgcGFyZW50KS4gKi9cclxuICBkaXI6IHN0cmluZztcclxuICAvKiogV2hldGhlciBgc3RvcmFnZS5yZW1vdmVEaXJgIGFjdHVhbGx5IHJlbW92ZWQgaXQgKGZhbHNlIHdoZW4gdGhlIGFkYXB0ZXJcclxuICAgKiAgbGFja3MgdGhlIGhvb2sgb3IgcmVmdXNlZCBcdTIwMTQgZWxpZ2liaWxpdHkgYWxvbmUgc3RpbGwgc3VwcHJlc3NlcyBhXHJcbiAgICogIHBsYWNlaG9sZGVyIHB1c2ggZm9yIGl0LCBgY2xpZW50LnRzYCkuICovXHJcbiAgcmVtb3ZlZDogYm9vbGVhbjtcclxufVxyXG5cclxuLyoqXHJcbiAqIFdoZXRoZXIgYGRpcmAgbWF5IGJlIGRlbGV0ZWQgd2l0aG91dCBsb3NpbmcgYW55dGhpbmc6IGl0IGV4aXN0cywgbm90aGluZ1xyXG4gKiAoZmlsZSBvciBkaXJlY3RvcnkpIGxpdmVzIGJlbmVhdGggaXQgaW4gc3RvcmFnZSwgYW5kIHRoZSBpbmRleCBob2xkcyBub1xyXG4gKiBsaXZlIGZpbGUgZW50cnkgYmVuZWF0aCBpdC4gVGhlIHJvb3QgaXMgbmV2ZXIgZGVsZXRhYmxlLiBUaGlzIGlzIHRoZVxyXG4gKiBuZXZlci1kZWxldGUtbm9uLWVtcHR5IC8gbmV2ZXItbG9zZS1jb250ZW50IGludmFyaWFudCBtYWRlIGV4cGxpY2l0IFx1MjAxNFxyXG4gKiBldmVyeSBkaXJlY3RvcnkgcmVtb3ZhbCBpbiBjb3JlIGdvZXMgdGhyb3VnaCBpdC5cclxuICovXHJcbmFzeW5jIGZ1bmN0aW9uIGRpcklzVmFjYW50KFxyXG4gIHN0b3JhZ2U6IFN0b3JhZ2VBZGFwdGVyLFxyXG4gIGluZGV4OiBMb2NhbEluZGV4LFxyXG4gIGRpcjogc3RyaW5nLFxyXG4pOiBQcm9taXNlPGJvb2xlYW4+IHtcclxuICBpZiAoZGlyID09PSAnLycpIHJldHVybiBmYWxzZTtcclxuICBpZiAoIShhd2FpdCBzdG9yYWdlLmV4aXN0cyhkaXIpKSkgcmV0dXJuIGZhbHNlO1xyXG4gIGZvciAoY29uc3QgZmlsZSBvZiBhd2FpdCBzdG9yYWdlLmxpc3RGaWxlcygpKSB7XHJcbiAgICBpZiAoaXNTdHJpY3RseUJlbmVhdGgoZmlsZS5wYXRoLCBkaXIpKSByZXR1cm4gZmFsc2U7XHJcbiAgfVxyXG4gIGZvciAoY29uc3QgY2hpbGQgb2YgYXdhaXQgc3RvcmFnZS5saXN0RGlycygpKSB7XHJcbiAgICBpZiAoaXNTdHJpY3RseUJlbmVhdGgoY2hpbGQsIGRpcikpIHJldHVybiBmYWxzZTtcclxuICB9XHJcbiAgZm9yIChjb25zdCBbcGF0aCwgZW50cnldIG9mIE9iamVjdC5lbnRyaWVzKGluZGV4KSkge1xyXG4gICAgaWYgKGVudHJ5LmlzRm9sZGVyIHx8IGVudHJ5LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkKSBjb250aW51ZTtcclxuICAgIGlmIChpc1N0cmljdGx5QmVuZWF0aChwYXRoLCBkaXIpKSByZXR1cm4gZmFsc2U7XHJcbiAgfVxyXG4gIHJldHVybiB0cnVlO1xyXG59XHJcblxyXG4vKiogUmVtb3ZlIGBkaXJgIHRocm91Z2ggdGhlIGFkYXB0ZXIgd2hlbiBpdCBpcyB2YWNhbnQuIE1pc3Npbmcvbm9uLWVtcHR5L3Vuc3VwcG9ydGVkIFx1MjFEMiBmYWxzZS4gKi9cclxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlbW92ZURpcklmVmFjYW50KFxyXG4gIHN0b3JhZ2U6IFN0b3JhZ2VBZGFwdGVyLFxyXG4gIGluZGV4OiBMb2NhbEluZGV4LFxyXG4gIGRpcjogc3RyaW5nLFxyXG4pOiBQcm9taXNlPGJvb2xlYW4+IHtcclxuICBpZiAoIShhd2FpdCBkaXJJc1ZhY2FudChzdG9yYWdlLCBpbmRleCwgZGlyKSkpIHJldHVybiBmYWxzZTtcclxuICByZXR1cm4gcmVtb3ZlVmFjYW50RGlyKHN0b3JhZ2UsIGRpcik7XHJcbn1cclxuXHJcbmFzeW5jIGZ1bmN0aW9uIHJlbW92ZVZhY2FudERpcihzdG9yYWdlOiBTdG9yYWdlQWRhcHRlciwgZGlyOiBzdHJpbmcpOiBQcm9taXNlPGJvb2xlYW4+IHtcclxuICBpZiAoc3RvcmFnZS5yZW1vdmVEaXIgPT09IHVuZGVmaW5lZCkgcmV0dXJuIGZhbHNlOyAvLyBwcmUtaG9vayBhZGFwdGVyczogcmVjb3JkLW9ubHlcclxuICB0cnkge1xyXG4gICAgYXdhaXQgc3RvcmFnZS5yZW1vdmVEaXIoZGlyKTtcclxuICAgIHJldHVybiB0cnVlO1xyXG4gIH0gY2F0Y2gge1xyXG4gICAgLy8gQSByZWZ1c2VkIG9yIHJhY2VkIHJlbW92YWwgaXMgcmVjb3JkLW9ubHksIG5ldmVyIGZhdGFsIGFuZCBuZXZlciBkYXRhXHJcbiAgICAvLyBsb3NzIFx1MjAxNCB0aGUgdG9tYnN0b25lIGlzIHN0aWxsIHJlY29yZGVkIGFuZCBzdGF0ZSBjb252ZXJnZXMgbGF0ZXIuXHJcbiAgICByZXR1cm4gZmFsc2U7XHJcbiAgfVxyXG59XHJcblxyXG4vKipcclxuICogUHJ1bmUtb24tZGVsZXRlIChDKTogYWZ0ZXIgYGRlbGV0ZWRQYXRoYCB3YXMgZGVsZXRlZCAob3IgcmVuYW1lZCBhd2F5KSxcclxuICogcmVtb3ZlIGl0cyBpbW1lZGlhdGUgcGFyZW50IGRpcmVjdG9yeSB3aGVuIGl0IGlzIG5vdyBlbXB0eSBvbiBkaXNrIGFuZFxyXG4gKiB1bnJlcHJlc2VudGVkIGJ5IGxpdmUgaW5kZXggZW50cmllcyBcdTIwMTQgZXhhY3RseSBPTkUgbGV2ZWwsIG5vIGNhc2NhZGUuXHJcbiAqXHJcbiAqIFJldHVybnMgdGhlIGBQcnVuZWREaXJgIHdoZW4gdGhlIHBhcmVudCBRVUFMSUZJRUQgZm9yIHJlbW92YWwgKHdoZXRoZXIgb3JcclxuICogbm90IHRoZSBhZGFwdGVyIGNvdWxkIHBlcmZvcm0gaXQgXHUyMDE0IGNhbGxlcnMgdXNlIGVsaWdpYmlsaXR5IHRvIHN1cHByZXNzIGFuXHJcbiAqIGVtcHR5LWZvbGRlciBwbGFjZWhvbGRlciBwdXNoIGZvciB0aGF0IGRpcmVjdG9yeSksIGB1bmRlZmluZWRgIHdoZW4gdGhlXHJcbiAqIHBhcmVudCB3YXMgbm90IGRlbGV0YWJsZSAobm9uLWVtcHR5LCBob2xkcyBsaXZlIGVudHJpZXMsIG1pc3NpbmcsIG9yIHJvb3QpLlxyXG4gKiBQdXJlIHdpdGggcmVzcGVjdCB0byB0aGUgaW5kZXg6IG5ldmVyIG11dGF0ZXMgaXQuXHJcbiAqL1xyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcHJ1bmVQYXJlbnRPbkRlbGV0ZShcclxuICBzdG9yYWdlOiBTdG9yYWdlQWRhcHRlcixcclxuICBpbmRleDogTG9jYWxJbmRleCxcclxuICBkZWxldGVkUGF0aDogc3RyaW5nLFxyXG4pOiBQcm9taXNlPFBydW5lZERpciB8IHVuZGVmaW5lZD4ge1xyXG4gIGNvbnN0IGRpciA9IHBhcmVudFBhdGgoZGVsZXRlZFBhdGgpO1xyXG4gIGlmICghKGF3YWl0IGRpcklzVmFjYW50KHN0b3JhZ2UsIGluZGV4LCBkaXIpKSkgcmV0dXJuIHVuZGVmaW5lZDtcclxuICByZXR1cm4geyBkaXIsIHJlbW92ZWQ6IGF3YWl0IHJlbW92ZVZhY2FudERpcihzdG9yYWdlLCBkaXIpIH07XHJcbn1cclxuXHJcbi8qKiBEb3dubG9hZCwgdmVyaWZ5LCBhbmQgd3JpdGUgb25lIGJsb2IuIEEgaGFzaCBtaXNtYXRjaCBhYm9ydHMgdGhlIHBsYW4uICovXHJcbmFzeW5jIGZ1bmN0aW9uIGZldGNoVmVyaWZpZWQoXHJcbiAgc3RvcmFnZTogU3RvcmFnZUFkYXB0ZXIsXHJcbiAgcGF0aDogc3RyaW5nLFxyXG4gIGhhc2g6IHN0cmluZyxcclxuICBmZXRjaEJsb2I6IEZldGNoQmxvYixcclxuKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgY29uc3QgYnl0ZXMgPSBhd2FpdCBmZXRjaEJsb2IoaGFzaCk7XHJcbiAgY29uc3QgYWN0dWFsID0gYXdhaXQgc2hhMjU2SGV4KGJ5dGVzKTtcclxuICBpZiAoYWN0dWFsICE9PSBoYXNoKSB7XHJcbiAgICB0aHJvdyBuZXcgRXJyb3IoXHJcbiAgICAgIGBCbG9iIGhhc2ggbWlzbWF0Y2ggZm9yICR7SlNPTi5zdHJpbmdpZnkocGF0aCl9OiBleHBlY3RlZCAke2hhc2h9LCBnb3QgJHthY3R1YWx9YCxcclxuICAgICk7XHJcbiAgfVxyXG4gIGF3YWl0IHN0b3JhZ2Uud3JpdGVGaWxlKHBhdGgsIGJ5dGVzKTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gcGVyc2lzdEluZGV4KFxyXG4gIHN0b3JhZ2U6IFN0b3JhZ2VBZGFwdGVyLFxyXG4gIGluZGV4OiBMb2NhbEluZGV4LFxyXG4gIHN0YXRlOiBQZXJzaXN0ZWRTeW5jU3RhdGUgPSB7fSxcclxuKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgYXdhaXQgc3RvcmFnZS53cml0ZUZpbGUoXHJcbiAgICBMT0NBTF9JTkRFWF9TVEFURV9QQVRILFxyXG4gICAgbmV3IFRleHRFbmNvZGVyKCkuZW5jb2RlKHNlcmlhbGl6ZUxvY2FsSW5kZXgoaW5kZXgsIHN0YXRlKSksXHJcbiAgKTtcclxufVxyXG5cclxuLyoqXHJcbiAqIExvYWQgdGhlIHBlcnNpc3RlZCBpbmRleCBBTkQgaXRzIHN5bmMtY3Vyc29yIGJvb2trZWVwaW5nICh0aGUgY2xpZW50J3NcclxuICogc3RhcnR1cCBwYXRoIFx1MjAxNCB0aGUgY3Vyc29yIHBvd2VycyBkZWx0YS1tYW5pZmVzdCByZWNvbm5lY3RzKS4gVGhyb3dzXHJcbiAqIGBQcm90b2NvbEVycm9yYCAodmlhIGBkZXNlcmlhbGl6ZUxvY2FsU3RhdGVgKSBvbiBjb3JydXB0IG9yIGZ1dHVyZS1zY2hlbWFcclxuICogc3RhdGU7IHRoZSBjbGllbnQgcmVjb3ZlcnMgYnkgcXVhcmFudGluaW5nIHRoZSBmaWxlIGFuZCByZXN5bmNpbmcgZnJvbSBhXHJcbiAqIGZ1bGwgbWFuaWZlc3QgKGBjbGllbnQudHNgIHN0YXJ0dXApLlxyXG4gKi9cclxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGxvYWRMb2NhbFN0YXRlKHN0b3JhZ2U6IFN0b3JhZ2VBZGFwdGVyKTogUHJvbWlzZTxEZXNlcmlhbGl6ZWRMb2NhbFN0YXRlPiB7XHJcbiAgY29uc3QgYnl0ZXMgPSBhd2FpdCBzdG9yYWdlLnJlYWRGaWxlKExPQ0FMX0lOREVYX1NUQVRFX1BBVEgpO1xyXG4gIHJldHVybiBkZXNlcmlhbGl6ZUxvY2FsU3RhdGUobmV3IFRleHREZWNvZGVyKCkuZGVjb2RlKGJ5dGVzKSk7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBMb2FkIHRoZSBwZXJzaXN0ZWQgaW5kZXggKEFSQ0hJVEVDVFVSRSBcdTAwQTc4IHN0ZXAgMSkuIFRocm93c1xyXG4gKiBgUHJvdG9jb2xFcnJvcmAgKHZpYSBgZGVzZXJpYWxpemVMb2NhbEluZGV4YCkgb24gY29ycnVwdCBvciBmdXR1cmUtc2NoZW1hXHJcbiAqIHN0YXRlIFx1MjAxNCBjYWxsZXJzIHN1cmZhY2UgdGhhdCBpbnN0ZWFkIG9mIHNpbGVudGx5IHJlLXN5bmNpbmcgZnJvbSBzY3JhdGNoLlxyXG4gKi9cclxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGxvYWRMb2NhbEluZGV4KHN0b3JhZ2U6IFN0b3JhZ2VBZGFwdGVyKTogUHJvbWlzZTxMb2NhbEluZGV4PiB7XHJcbiAgcmV0dXJuIChhd2FpdCBsb2FkTG9jYWxTdGF0ZShzdG9yYWdlKSkuaW5kZXg7XHJcbn1cclxuIiwgIi8qKlxuICogVmF1bHQgaWdub3JlIHJ1bGVzIChBUkNISVRFQ1RVUkUubWQgXHUwMEE3NCwgRlItMTEvRlItNDIpIFx1MjAxNCBzaGFyZWQgYnkgZXZlcnlcbiAqIGNsaWVudCBzbyBsb2NhbCBzY2Fucywgd2F0Y2hlcnMsIGFuZCBjb21taXQgcGF0aHMgYWdyZWUgYnl0ZS1mb3ItYnl0ZS5cbiAqXG4gKiBNYXRjaGluZyBpcyBzZWdtZW50LWJhc2VkIGFuZCBjYXNlLWluc2Vuc2l0aXZlICh0aGUgb3duZXIncyBwcmltYXJ5XG4gKiBwbGF0Zm9ybXMgXHUyMDE0IFdpbmRvd3MsIG1hY09TIFx1MjAxNCBoYXZlIGNhc2UtaW5zZW5zaXRpdmUgZmlsZXN5c3RlbXMsIHNvXG4gKiBgLlRyYXNoL2Zvby5tZGAgbXVzdCBub3Qgc25lYWsgcGFzdCB0aGUgYC50cmFzaC9gIHJ1bGUpLlxuICovXG5cbmltcG9ydCB7IGlzV2luZG93c1Vuc2FmZVBhdGgsIG5vcm1hbGl6ZVZhdWx0UGF0aCB9IGZyb20gJy4vcGF0aHMuanMnO1xuXG4vKiogU2V0dGluZ3Mgc3Vic2V0IGBpc0lnbm9yZWRgIG5lZWRzOyBgVmF1bHRTZXR0aW5nc2Agc2F0aXNmaWVzIGl0LiAqL1xuZXhwb3J0IGludGVyZmFjZSBJZ25vcmVTZXR0aW5ncyB7XG4gIG9ic2lkaWFuU3luYzogYm9vbGVhbjtcbiAgLyoqXG4gICAqIFVzZXItZGVmaW5lZCBleHRyYSBpZ25vcmUgcGF0dGVybnMgKGNsaWVudC1zaWRlIG9ubHkpLiBHbG9iLWxpdGUgc3ludGF4OlxuICAgKiBgKmAgbWF0Y2hlcyB3aXRoaW4gb25lIHBhdGggc2VnbWVudCwgYSB3aG9sZSBgKipgIHNlZ21lbnQgc3BhbnMgYW55XG4gICAqIG51bWJlciBvZiBzZWdtZW50cywgbWF0Y2hpbmcgaXMgY2FzZS1pbnNlbnNpdGl2ZS4gQSBwYXR0ZXJuIGNvbnRhaW5pbmdcbiAgICogYC9gIGlzIGFuY2hvcmVkIGF0IHRoZSB2YXVsdCByb290IChgcHJpdmF0ZS8qKmApOyBhIGJhcmUgcGF0dGVybiB3aXRob3V0XG4gICAqIGAvYCBtYXRjaGVzIGEgZmlsZSBOQU1FIGF0IGFueSBkZXB0aCAoYCoudG1wYCkuIEVtcHR5IGxpbmVzIGFyZSBpZ25vcmVkLlxuICAgKi9cbiAgZXh0cmFJZ25vcmVzPzogcmVhZG9ubHkgc3RyaW5nW107XG59XG5cbi8qKiBJZ25vcmVkIHdoZXJldmVyIHRoZXkgYXBwZWFyLCBhcyBhbnkgcGF0aCBzZWdtZW50IChkaXIgb3IgZmlsZSBuYW1lKS4gKi9cbmNvbnN0IEFMV0FZU19JR05PUkVEX1NFR01FTlRTOiBSZWFkb25seVNldDxzdHJpbmc+ID0gbmV3IFNldChbXG4gICcudHJhc2gnLCAvLyBsb2NhbCBkZWxldGUtcmVjb3ZlcnkgZGlyIChGUi00MilcbiAgJy5kc19zdG9yZScsXG4gICcudmF1bHRzeW5jZm9yYWdlbnRzJywgLy8gY2xpZW50IHN0YXRlIGRpciAobG9jYWwgaW5kZXgpIGluc2lkZSB0aGUgdmF1bHRcbiAgJ3RodW1icy5kYicsXG5dKTtcblxuLyoqIGAub2JzaWRpYW4vYCBmaWxlcyBleGNsdWRlZCBldmVuIHdoZW4gYC5vYnNpZGlhbi9gIHN5bmMgaXMgb3B0ZWQgaW4uICovXG5jb25zdCBPQlNJRElBTl9WT0xBVElMRV9GSUxFUzogUmVhZG9ubHlTZXQ8c3RyaW5nPiA9IG5ldyBTZXQoW1xuICAnLm9ic2lkaWFuL3dvcmtzcGFjZS5qc29uJyxcbiAgJy5vYnNpZGlhbi93b3Jrc3BhY2UtbW9iaWxlLmpzb24nLFxuXSk7XG5cbi8qKlxuICogV2hldGhlciBgdmF1bHRQYXRoYCBtdXN0IGJlIGV4Y2x1ZGVkIGZyb20gc3luYy5cbiAqXG4gKiBBbHdheXMgaWdub3JlZDogYC50cmFzaC9gLCBgLkRTX1N0b3JlYCwgYFRodW1icy5kYmAsIGAudmF1bHRzeW5jZm9yYWdlbnRzL2BcbiAqIChhbnkgZGVwdGgpLCBhbmQgV2luZG93cy11bnNhZmUgbmFtZXMgKHJlc2VydmVkIGRldmljZSBuYW1lcywgdHJhaWxpbmdcbiAqIGRvdC9zcGFjZSBcdTIwMTQgdGhleSBjYW4gbmV2ZXIgYmUgbWF0ZXJpYWxpemVkIG9uIGEgV2luZG93cyBwZWVyLCBzZWVcbiAqIGBwYXRocy50c2ApLiBgLm9ic2lkaWFuL2AgaXMgaWdub3JlZCBlbnRpcmVseSB3aGVuIGBzZXR0aW5ncy5vYnNpZGlhblN5bmNgXG4gKiBpcyBmYWxzZTsgd2hlbiB0cnVlLCBldmVyeXRoaW5nIHVuZGVyIGl0IHN5bmNzIGV4Y2VwdCBgd29ya3NwYWNlLmpzb25gLFxuICogYHdvcmtzcGFjZS1tb2JpbGUuanNvbmAsIGFuZCBgLm9ic2lkaWFuL2NhY2hlL2AuIEZpbmFsbHksIGV2ZXJ5IHBhdHRlcm4gaW5cbiAqIGBzZXR0aW5ncy5leHRyYUlnbm9yZXNgIGlzIG1hdGNoZWQgKGdsb2ItbGl0ZSBcdTIwMTQgc2VlIGBJZ25vcmVTZXR0aW5nc2ApLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNJZ25vcmVkKHZhdWx0UGF0aDogc3RyaW5nLCBzZXR0aW5nczogSWdub3JlU2V0dGluZ3MpOiBib29sZWFuIHtcbiAgaWYgKGlzV2luZG93c1Vuc2FmZVBhdGgodmF1bHRQYXRoKSkgcmV0dXJuIHRydWU7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVWYXVsdFBhdGgodmF1bHRQYXRoKTtcbiAgaWYgKG5vcm1hbGl6ZWQgPT09ICcvJykgcmV0dXJuIGZhbHNlO1xuXG4gIGNvbnN0IGxvd2VyID0gbm9ybWFsaXplZC5zbGljZSgxKS50b0xvd2VyQ2FzZSgpO1xuICBjb25zdCBzZWdtZW50cyA9IGxvd2VyLnNwbGl0KCcvJyk7XG5cbiAgaWYgKHNlZ21lbnRzLnNvbWUoKHNlZ21lbnQpID0+IEFMV0FZU19JR05PUkVEX1NFR01FTlRTLmhhcyhzZWdtZW50KSkpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIGlmIChzZWdtZW50c1swXSA9PT0gJy5vYnNpZGlhbicpIHtcbiAgICBpZiAoIXNldHRpbmdzLm9ic2lkaWFuU3luYykgcmV0dXJuIHRydWU7XG4gICAgaWYgKE9CU0lESUFOX1ZPTEFUSUxFX0ZJTEVTLmhhcyhsb3dlcikpIHJldHVybiB0cnVlO1xuICAgIGlmIChzZWdtZW50c1sxXSA9PT0gJ2NhY2hlJykgcmV0dXJuIHRydWU7IC8vIHRoZSBkaXIgaXRzZWxmIGFuZCBhbnl0aGluZyB1bmRlciBpdFxuICB9XG5cbiAgY29uc3QgZXh0cmFzID0gc2V0dGluZ3MuZXh0cmFJZ25vcmVzO1xuICBpZiAoZXh0cmFzICE9PSB1bmRlZmluZWQgJiYgZXh0cmFzLmxlbmd0aCA+IDApIHtcbiAgICBmb3IgKGNvbnN0IHBhdHRlcm4gb2YgZXh0cmFzKSB7XG4gICAgICBjb25zdCBjb21waWxlZCA9IGNvbXBpbGVFeHRyYUlnbm9yZShwYXR0ZXJuKTtcbiAgICAgIGlmIChjb21waWxlZCAhPT0gbnVsbCAmJiBtYXRjaGVzU2VnbWVudHMoY29tcGlsZWQsIHNlZ21lbnRzKSkgcmV0dXJuIHRydWU7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vLyAtLS0gZXh0cmEgaWdub3JlIHBhdHRlcm5zIChnbG9iLWxpdGUpIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogQSBjb21waWxlZCBleHRyYS1pZ25vcmUgcGF0dGVybjogbG93ZXJjYXNlZCwgYC9gLXNwbGl0IHNlZ21lbnRzLiAqL1xudHlwZSBDb21waWxlZFBhdHRlcm4gPSB7IHNlZ21lbnRzOiByZWFkb25seSBzdHJpbmdbXTsgYW5jaG9yZWQ6IGJvb2xlYW4gfTtcblxuLyoqXG4gKiBOb3JtYWxpemUgb25lIHVzZXIgcGF0dGVybiBpbnRvIG1hdGNoYWJsZSBzZWdtZW50cy4gUmV0dXJucyBgbnVsbGAgZm9yXG4gKiBibGFuayBwYXR0ZXJucyAodGhleSBjYW4gbmV2ZXIgbWF0Y2ggXHUyMDE0IGFuZCBtdXN0IG5vdCBiZWNvbWUgXCJpZ25vcmVcbiAqIGV2ZXJ5dGhpbmdcIiBieSBhY2NpZGVudCkuIEEgbGVhZGluZy90cmFpbGluZyBgL2AgaXMgdG9sZXJhdGVkIGFuZCBzdHJpcHBlZDtcbiAqIGBhbmNob3JlZGAgcmVjb3JkcyB3aGV0aGVyIHRoZSBwYXR0ZXJuIG5hbWVzIGEgcGF0aCAobWF0Y2hlZCBmcm9tIHRoZVxuICogdmF1bHQgcm9vdCkgb3IgYSBiYXJlIG5hbWUgKG1hdGNoZWQgYWdhaW5zdCBhbnkgc3VmZml4IG9mIHRoZSBwYXRoKS5cbiAqL1xuZnVuY3Rpb24gY29tcGlsZUV4dHJhSWdub3JlKHBhdHRlcm46IHN0cmluZyk6IENvbXBpbGVkUGF0dGVybiB8IG51bGwge1xuICBsZXQgY2xlYW5lZCA9IHBhdHRlcm4udHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gIHdoaWxlIChjbGVhbmVkLnN0YXJ0c1dpdGgoJy8nKSkgY2xlYW5lZCA9IGNsZWFuZWQuc2xpY2UoMSk7XG4gIHdoaWxlIChjbGVhbmVkLmVuZHNXaXRoKCcvJykpIGNsZWFuZWQgPSBjbGVhbmVkLnNsaWNlKDAsIC0xKTtcbiAgaWYgKGNsZWFuZWQgPT09ICcnKSByZXR1cm4gbnVsbDtcbiAgcmV0dXJuIHsgc2VnbWVudHM6IGNsZWFuZWQuc3BsaXQoJy8nKSwgYW5jaG9yZWQ6IGNsZWFuZWQuaW5jbHVkZXMoJy8nKSB9O1xufVxuXG4vKiogUGF0dGVybiB2cyBwYXRoIHNlZ21lbnRzOyBgYW5jaG9yZWRgIHBhdHRlcm5zIG1heSBhbHNvIHN0YXJ0IGRlZXBlci4gKi9cbmZ1bmN0aW9uIG1hdGNoZXNTZWdtZW50cyhwYXR0ZXJuOiBDb21waWxlZFBhdHRlcm4sIHBhdGg6IHJlYWRvbmx5IHN0cmluZ1tdKTogYm9vbGVhbiB7XG4gIGlmIChwYXR0ZXJuLmFuY2hvcmVkKSB7XG4gICAgcmV0dXJuIHNlZ21lbnRzTWF0Y2gocGF0dGVybi5zZWdtZW50cywgcGF0aCk7XG4gIH1cbiAgLy8gQmFyZSBuYW1lIHBhdHRlcm46IG1hdGNoIGFueSB0cmFpbGluZyBzZWdtZW50IHJ1biAoYCoudG1wYCBhdCBhbnkgZGVwdGgpLlxuICBmb3IgKGxldCBzdGFydCA9IDA7IHN0YXJ0IDwgcGF0aC5sZW5ndGg7IHN0YXJ0KyspIHtcbiAgICBpZiAoc2VnbWVudHNNYXRjaChwYXR0ZXJuLnNlZ21lbnRzLCBwYXRoLnNsaWNlKHN0YXJ0KSkpIHJldHVybiB0cnVlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqIEdsb2ItbGl0ZSBzZWdtZW50IG1hdGNoaW5nOiBgKmAgaW5zaWRlIGEgc2VnbWVudCwgYCoqYCBhcyBhIHdob2xlIHNlZ21lbnQuICovXG5mdW5jdGlvbiBzZWdtZW50c01hdGNoKHBhdHRlcm46IHJlYWRvbmx5IHN0cmluZ1tdLCBwYXRoOiByZWFkb25seSBzdHJpbmdbXSk6IGJvb2xlYW4ge1xuICBpZiAocGF0dGVybi5sZW5ndGggPT09IDApIHJldHVybiBwYXRoLmxlbmd0aCA9PT0gMDtcbiAgY29uc3QgaGVhZCA9IHBhdHRlcm5bMF07XG4gIGNvbnN0IHJlc3QgPSBwYXR0ZXJuLnNsaWNlKDEpO1xuICBpZiAoaGVhZCA9PT0gdW5kZWZpbmVkKSByZXR1cm4gcGF0aC5sZW5ndGggPT09IDA7XG4gIGlmIChoZWFkID09PSAnKionKSB7XG4gICAgLy8gYCoqYCBjb25zdW1lcyB6ZXJvIG9yIG1vcmUgcGF0aCBzZWdtZW50cy5cbiAgICBmb3IgKGxldCBza2lwID0gMDsgc2tpcCA8PSBwYXRoLmxlbmd0aDsgc2tpcCsrKSB7XG4gICAgICBpZiAoc2VnbWVudHNNYXRjaChyZXN0LCBwYXRoLnNsaWNlKHNraXApKSkgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICBpZiAocGF0aC5sZW5ndGggPT09IDAgfHwgIXNlZ21lbnRNYXRjaChoZWFkLCBwYXRoWzBdISkpIHJldHVybiBmYWxzZTtcbiAgcmV0dXJuIHNlZ21lbnRzTWF0Y2gocmVzdCwgcGF0aC5zbGljZSgxKSk7XG59XG5cbi8qKiBPbmUgc2VnbWVudDogbGl0ZXJhbCB0ZXh0IHdpdGggYCpgIHdpbGRjYXJkcyAoYW55IHJ1biB3aXRoaW4gdGhlIHNlZ21lbnQpLiAqL1xuZnVuY3Rpb24gc2VnbWVudE1hdGNoKHBhdHRlcm46IHN0cmluZywgc2VnbWVudDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIGlmICghcGF0dGVybi5pbmNsdWRlcygnKicpKSByZXR1cm4gcGF0dGVybiA9PT0gc2VnbWVudDtcbiAgY29uc3QgZmlyc3QgPSBwYXR0ZXJuLmluZGV4T2YoJyonKTtcbiAgY29uc3QgbGFzdCA9IHBhdHRlcm4ubGFzdEluZGV4T2YoJyonKTtcbiAgaWYgKCFzZWdtZW50LnN0YXJ0c1dpdGgocGF0dGVybi5zbGljZSgwLCBmaXJzdCkpKSByZXR1cm4gZmFsc2U7XG4gIGlmICghc2VnbWVudC5lbmRzV2l0aChwYXR0ZXJuLnNsaWNlKGxhc3QgKyAxKSkpIHJldHVybiBmYWxzZTtcbiAgbGV0IGluZGV4ID0gZmlyc3Q7XG4gIGZvciAoY29uc3QgbWlkZGxlIG9mIHBhdHRlcm4uc2xpY2UoZmlyc3QsIGxhc3QgKyAxKS5zcGxpdCgnKicpLnNsaWNlKDEsIC0xKSkge1xuICAgIGNvbnN0IGZvdW5kID0gc2VnbWVudC5pbmRleE9mKG1pZGRsZSwgaW5kZXgpO1xuICAgIGlmIChmb3VuZCA9PT0gLTEpIHJldHVybiBmYWxzZTtcbiAgICBpbmRleCA9IGZvdW5kICsgbWlkZGxlLmxlbmd0aDtcbiAgfVxuICByZXR1cm4gdHJ1ZTtcbn1cbiIsICIvKipcclxuICogVHlwZWQgV2ViU29ja2V0IG1lc3NhZ2UgZGVmaW5pdGlvbnMgZm9yIHRoZSBgL3N5bmNgIGNoYW5uZWxcclxuICogKEFSQ0hJVEVDVFVSRS5tZCBcdTAwQTc1KS4gQWxsIG1lc3NhZ2VzIGFyZSBKU09OIHdpdGggYSBgdHlwZWAgZGlzY3JpbWluYW50LlxyXG4gKlxyXG4gKiBUd28gY2hhbm5lbHMgZXhpc3Q6IHRoaXMgV1MgcHJvdG9jb2wgKG1ldGFkYXRhICsgY2hhbmdlIGZlZWQpIGFuZCBwbGFpblxyXG4gKiBIVFRQUyBibG9iIHJvdXRlcyAoYEdFVC9QVVQgL2Jsb2IvOmhhc2hgKSBmb3IgY29udGVudCBcdTIwMTQgcmVmZXJlbmNlZCBoZXJlXHJcbiAqIG9ubHkgdmlhIGNvbnRlbnQgaGFzaGVzLlxyXG4gKi9cclxuXHJcbmltcG9ydCB0eXBlIHsgTG9naWNhbENsb2NrLCBWZXJzaW9uLCBWZXJzaW9uS2luZCwgVmF1bHRTZXR0aW5ncyB9IGZyb20gJy4vdHlwZXMuanMnO1xyXG5pbXBvcnQgeyBQcm90b2NvbEVycm9yIH0gZnJvbSAnLi9lcnJvcnMuanMnO1xyXG5cclxuLyoqIFdpcmUgcHJvdG9jb2wgdmVyc2lvbi4gQnVtcCBvbiBicmVha2luZyBtZXNzYWdlLXNoYXBlIGNoYW5nZXMuICovXHJcbmV4cG9ydCBjb25zdCBQcm90b2NvbFZlcnNpb24gPSAxIGFzIGNvbnN0O1xyXG5cclxuLyoqIENvbW1pdHMgYXQgb3IgYmVsb3cgdGhpcyBzaXplIG1heSBpbmxpbmUgY29udGVudCAoYmFzZTY0KSBvbiB0aGUgV1MuICovXHJcbmV4cG9ydCBjb25zdCBJTkxJTkVfQ09OVEVOVF9NQVhfQllURVMgPSAyNTYgKiAxMDI0O1xyXG5cclxuLyoqXHJcbiAqIE9uZSBlbnRyeSBvZiB0aGUgbWFuaWZlc3QgbWFwIChge3BhdGggXHUyMTkyIE1hbmlmZXN0RW50cnl9YCkuIFRoZSBlbnRyeSBpc1xyXG4gKiBzZWxmLWRlc2NyaWJpbmc6IGl0IGNhcnJpZXMgaXRzIG93biBgcGF0aGAgYW5kIHRoZSBoZWFkJ3MgYGNsb2NrYCBzbyB0aGVcclxuICogY2xpZW50LXNpZGUgcmVjb25jaWxpYXRpb24gKGByZXNvbHZlLnRzYCkgY2FuIG9yZGVyIHJlbW90ZSBzdGF0ZSBhZ2FpbnN0XHJcbiAqIGxvY2FsIHN0YXRlIHdpdGhvdXQgYW55IGV4dHJhIHJvdW5kLXRyaXBzLlxyXG4gKi9cclxuZXhwb3J0IGludGVyZmFjZSBNYW5pZmVzdEVudHJ5IHtcclxuICAvKiogTm9ybWFsaXplZCB2YXVsdCBwYXRoIHRoaXMgZW50cnkgZGVzY3JpYmVzIChtaXJyb3JzIHRoZSBtYXAga2V5KS4gKi9cclxuICBwYXRoOiBzdHJpbmc7XHJcbiAgLyoqIFZlcnNpb24gaWQgb2YgdGhlIGVudHJ5J3MgaGVhZC4gKi9cclxuICB2ZXJzaW9uOiBzdHJpbmc7XHJcbiAgLyoqIHNoYTI1NiBoZXggb2YgY3VycmVudCBjb250ZW50IChgJydgIGZvciBmb2xkZXIgcGxhY2Vob2xkZXJzKS4gKi9cclxuICBoYXNoOiBzdHJpbmc7XHJcbiAgLyoqIENvbnRlbnQgc2l6ZSBpbiBieXRlcyAoYDBgIGZvciBmb2xkZXIgcGxhY2Vob2xkZXJzKS4gKi9cclxuICBzaXplOiBudW1iZXI7XHJcbiAgLyoqIFRvbWJzdG9uZSBmbGFnLiAqL1xyXG4gIGRlbGV0ZWQ6IGJvb2xlYW47XHJcbiAgLyoqIExvZ2ljYWwgY2xvY2sgb2YgdGhlIGhlYWQgXHUyMDE0IHRoZSBvcmRlcmluZyBhdXRob3JpdHkgKFx1MDBBNzQpLiAqL1xyXG4gIGNsb2NrOiBMb2dpY2FsQ2xvY2s7XHJcbiAgLyoqIFRydWUgZm9yIGVtcHR5LWZvbGRlciBwbGFjZWhvbGRlciBlbnRyaWVzIChGUi0xMCkuICovXHJcbiAgaXNGb2xkZXI/OiBib29sZWFuO1xyXG4gIC8qKiBFcG9jaCBtcyBvZiBsYXN0IHVwZGF0ZSwgZGlzcGxheS1vbmx5LiAqL1xyXG4gIG10aW1lOiBudW1iZXI7XHJcbn1cclxuXHJcbi8vIC0tLSBDbGllbnQgXHUyMTkyIFNlcnZlciAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblxyXG4vKiogQXV0aCArIGNhdGNoLXVwOiB0b2tlbiwgcHJvdG9jb2wgdmVyc2lvbiwgbGFzdCBzZWVuIERPIHNlcXVlbmNlIG51bWJlci4gKi9cclxuZXhwb3J0IGludGVyZmFjZSBIZWxsb01lc3NhZ2Uge1xyXG4gIHR5cGU6ICdoZWxsbyc7XHJcbiAgdG9rZW46IHN0cmluZztcclxuICBwcm90b2NvbFZlcnNpb246IG51bWJlcjtcclxuICAvKiogTGFzdCBzZWVuIGdsb2JhbCBzZXF1ZW5jZSBudW1iZXI7IDAgZm9yIGEgZmlyc3QtZXZlciBjb25uZWN0LiAqL1xyXG4gIGN1cnNvcjogbnVtYmVyO1xyXG59XHJcblxyXG4vKiogUmVxdWVzdCBmdWxsIChgc2luY2VgIG9taXR0ZWQpIG9yIGRlbHRhIG1hbmlmZXN0LiAqL1xyXG5leHBvcnQgaW50ZXJmYWNlIEdldE1hbmlmZXN0TWVzc2FnZSB7XHJcbiAgdHlwZTogJ2dldE1hbmlmZXN0JztcclxuICBzaW5jZT86IG51bWJlcjtcclxufVxyXG5cclxuLyoqXHJcbiAqIENvbW1pdCBhIG5ldyB2ZXJzaW9uLiBJZiBgaW5saW5lYCBpcyBzZXQgaXQgY2FycmllcyB0aGUgZnVsbCBjb250ZW50XHJcbiAqIGJhc2U2NC1lbmNvZGVkIChvbmx5IGFsbG93ZWQgd2hlbiBgc2l6ZSA8PSBJTkxJTkVfQ09OVEVOVF9NQVhfQllURVNgKTtcclxuICogb3RoZXJ3aXNlIHRoZSBibG9iIG11c3QgYWxyZWFkeSBiZSB1cGxvYWRlZCAoYHB1dEJsb2JgIG9uIHRoaXMgY2hhbm5lbCxcclxuICogYFBVVCAvYmxvYi86aGFzaGAgb24gdGhlIHJlYWwgd29ya2VyKS5cclxuICovXHJcbmV4cG9ydCBpbnRlcmZhY2UgQ29tbWl0TWVzc2FnZSB7XHJcbiAgdHlwZTogJ2NvbW1pdCc7XHJcbiAgcGF0aDogc3RyaW5nO1xyXG4gIC8qKiBWZXJzaW9uIGlkIHRoZSBjb21taXQgYnVpbGRzIG9uOyBzZXJ2ZXIgZGV0ZWN0cyBkaXZlcmdlbmNlIFx1MjE5MiBjb25mbGljdC4gKi9cclxuICBwYXJlbnRWZXJzaW9uOiBzdHJpbmcgfCBudWxsO1xyXG4gIGhhc2g6IHN0cmluZztcclxuICBzaXplOiBudW1iZXI7XHJcbiAgLyoqIFdoYXQga2luZCBvZiB2ZXJzaW9uIHRoaXMgY29tbWl0cyAobWlycm9ycyBgVmVyc2lvbi5raW5kYCkuICovXHJcbiAga2luZDogVmVyc2lvbktpbmQ7XHJcbiAgaW5saW5lPzogc3RyaW5nO1xyXG4gIC8qKiBTb3VyY2UgcGF0aCBcdTIwMTQgcmVxdWlyZWQgZm9yIGBraW5kOiAncmVuYW1lJ2AgKGNoYWluIG1pZ3JhdGlvbiwgRlItOSkuICovXHJcbiAgZnJvbVBhdGg/OiBzdHJpbmc7XHJcbiAgLyoqIFRydWUgZm9yIGVtcHR5LWZvbGRlciBwbGFjZWhvbGRlciBjb21taXRzIChGUi0xMDsgaGFzaCBgJydgLCBzaXplIDApLiAqL1xyXG4gIGlzRm9sZGVyPzogYm9vbGVhbjtcclxufVxyXG5cclxuLyoqIEtlZXBhbGl2ZS4gKi9cclxuZXhwb3J0IGludGVyZmFjZSBQaW5nTWVzc2FnZSB7XHJcbiAgdHlwZTogJ3BpbmcnO1xyXG4gIC8qKiBDbGllbnQgZXBvY2ggbXM7IGVjaG9lZCBiYWNrIG9uIGBwb25nYCBmb3IgUlRUIC8gc2tldyBtZWFzdXJlbWVudC4gKi9cclxuICB0cz86IG51bWJlcjtcclxufVxyXG5cclxuLyoqXHJcbiAqIFVwbG9hZCBhIGNvbnRlbnQgYmxvYiBvdmVyIHRoZSBzeW5jIGNoYW5uZWwuIFRlc3QgZG91YmxlcyBhbmQgc21hbGwgdmF1bHRzXHJcbiAqIGNhbiB1c2UgdGhpcyBkaXJlY3RseTsgdGhlIHJlYWwgd29ya2VyIGV4cG9zZXMgdGhlIHNhbWUgb3BlcmF0aW9uIGFzXHJcbiAqIGBQVVQgL2Jsb2IvOmhhc2hgIChzdHJlYW1lZCkuIElkZW1wb3RlbnQ6IHNhbWUgaGFzaCBcdTIxRDIgc2FtZSBjb250ZW50LlxyXG4gKi9cclxuZXhwb3J0IGludGVyZmFjZSBQdXRCbG9iTWVzc2FnZSB7XHJcbiAgdHlwZTogJ3B1dEJsb2InO1xyXG4gIGhhc2g6IHN0cmluZztcclxuICAvKiogRnVsbCBjb250ZW50LCBiYXNlNjQtZW5jb2RlZC4gKi9cclxuICBjb250ZW50OiBzdHJpbmc7XHJcbn1cclxuXHJcbi8qKiBGZXRjaCBhIGNvbnRlbnQgYmxvYiAodGhlIFdTLWlubGluZSBwYXRoIG9mIFx1MDBBNzggXCJmZXRjaCBibG9iXCIpLiAqL1xyXG5leHBvcnQgaW50ZXJmYWNlIEdldEJsb2JNZXNzYWdlIHtcclxuICB0eXBlOiAnZ2V0QmxvYic7XHJcbiAgaGFzaDogc3RyaW5nO1xyXG59XHJcblxyXG4vKipcclxuICogU25hcHNob3QgZXZlcnkgZmlsZSBoZWFkIGF0IGEgbW9tZW50IChhIHdob2xlLXZhdWx0IHJlc3RvcmUgcG9pbnQpLiBUaGVcclxuICogc2VydmVyIHJlY29yZHMgdGhlIGhlYWQgc3RhdGUgYXRvbWljYWxseTsgc25hcHNob3RzIGFyZSBuZXZlciBicm9hZGNhc3QgXHUyMDE0XHJcbiAqIG90aGVyIGRldmljZXMgbGVhcm4gbm90aGluZyBsaXZlLCB0aGUgbGlzdCBpcyBwdWxsLWJhc2VkLlxyXG4gKi9cclxuZXhwb3J0IGludGVyZmFjZSBTbmFwc2hvdENyZWF0ZU1lc3NhZ2Uge1xyXG4gIHR5cGU6ICdzbmFwc2hvdENyZWF0ZSc7XHJcbiAgLyoqIE9wdGlvbmFsIGxhYmVsOyBvbWl0dGVkL2VtcHR5IFx1MjFEMiB1bm5hbWVkLiAqL1xyXG4gIG5hbWU/OiBzdHJpbmc7XHJcbn1cclxuXHJcbi8qKiBSZXN0b3JlIHRoZSB3aG9sZSB2YXVsdCB0byBhIHNuYXBzaG90IChGUi03OiBhcyBORVcgdmVyc2lvbnMgXHUyMDE0IGhpc3RvcnkgaXMgbmV2ZXIgZGVsZXRlZCkuICovXHJcbmV4cG9ydCBpbnRlcmZhY2UgU25hcHNob3RSZXN0b3JlTWVzc2FnZSB7XHJcbiAgdHlwZTogJ3NuYXBzaG90UmVzdG9yZSc7XHJcbiAgLyoqIFNuYXBzaG90IGlkIChhcyByZXR1cm5lZCBieSBgc25hcHNob3RDcmVhdGVBY2tgIC8gbGlzdGVkIGJ5IHRoZSBzZXJ2ZXIpLiAqL1xyXG4gIGlkOiBzdHJpbmc7XHJcbn1cclxuXHJcbi8vIC0tLSBTZXJ2ZXIgXHUyMTkyIENsaWVudCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblxyXG4vKiogU3VjY2Vzc2Z1bCBoZWxsbzogdGhpcyBkZXZpY2UncyBpZGVudGl0eSArIHZhdWx0LWxldmVsIGluZm8uICovXHJcbmV4cG9ydCBpbnRlcmZhY2UgSGVsbG9BY2tNZXNzYWdlIHtcclxuICB0eXBlOiAnaGVsbG9BY2snO1xyXG4gIGRldmljZUlkOiBzdHJpbmc7XHJcbiAgdmF1bHROYW1lOiBzdHJpbmc7XHJcbiAgc2V0dGluZ3M6IFZhdWx0U2V0dGluZ3M7XHJcbiAgLyoqXHJcbiAgICogTG93ZXN0IGNoYW5nZS1ldmVudCBzZXF1ZW5jZSBudW1iZXIgdGhlIHNlcnZlciBzdGlsbCByZXRhaW5zIChwcm90b2NvbFxyXG4gICAqIHYxLCBwcmUtcmVsZWFzZTsgb3B0aW9uYWwgc28gb2xkZXIgc2VydmVycyBjYW4gYmUgYW5zd2VyZWQgd2l0aCBhIGZ1bGxcclxuICAgKiBtYW5pZmVzdCkuIEEgY2xpZW50IHdob3NlIGN1cnNvciBzYXRpc2ZpZXNcclxuICAgKiBgb2xkZXN0UmV0YWluZWRTZXEgPD0gY3Vyc29yICsgMWAgY2FuIHJlcXVlc3QgYSBkZWx0YSBtYW5pZmVzdCBcdTIwMTQgZXZlcnlcclxuICAgKiBldmVudCBhZnRlciBpdHMgY3Vyc29yIGlzIHN0aWxsIHJlcGxheWFibGUsIHNvIGl0cyBpbmRleCBpcyBndWFyYW50ZWVkXHJcbiAgICogdG8gb25seSBtaXNzIGhlYWRzIHdpdGggYGhlYWRfc2VxID4gY3Vyc29yYC4gQWJzZW50IChvciBgPiBjdXJzb3IgKyAxYClcclxuICAgKiBcdTIxRDIgdGhlIGNsaWVudCBtdXN0IGZhbGwgYmFjayB0byBhIGZ1bGwgbWFuaWZlc3QuXHJcbiAgICovXHJcbiAgb2xkZXN0UmV0YWluZWRTZXE/OiBudW1iZXI7XHJcbiAgLyoqXHJcbiAgICogVGhlIHNlcnZlcidzIG93biByZWxlYXNlIHZlcnNpb24gKHRoZSB3b3JrZXIncyBwYWNrYWdlIHZlcnNpb24pLlxyXG4gICAqIE9wdGlvbmFsIGJlY2F1c2Ugc2VydmVycyBcdTIyNjQgMC4xIHByZWRhdGUgdmVyc2lvbiByZXBvcnRpbmcgYW5kIG9taXQgaXQgXHUyMDE0XHJcbiAgICogY2xpZW50cyB0cmVhdCBhYnNlbmNlIGFzIFwibGVnYWN5IHNlcnZlclwiIChzZWUgYGNvbXBhdC50c2ApLCBuZXZlciBhcyBhXHJcbiAgICogcHJvdG9jb2wgZmFpbHVyZS5cclxuICAgKi9cclxuICBzZXJ2ZXJWZXJzaW9uPzogc3RyaW5nO1xyXG59XHJcblxyXG4vKiogUmVwbHkgdG8gYGdldE1hbmlmZXN0YDogdGhlIChwb3NzaWJseSBkZWx0YSkgZmlsZSBpbmRleC4gKi9cclxuZXhwb3J0IGludGVyZmFjZSBNYW5pZmVzdE1lc3NhZ2Uge1xyXG4gIHR5cGU6ICdtYW5pZmVzdCc7XHJcbiAgZW50cmllczogUmVhZG9ubHk8UmVjb3JkPHN0cmluZywgTWFuaWZlc3RFbnRyeT4+O1xyXG4gIC8qKiBHbG9iYWwgc2VxdWVuY2UgbnVtYmVyIHRoaXMgbWFuaWZlc3QgcmVmbGVjdHMgKGN1cnNvciBjYXRjaC11cCkuICovXHJcbiAgY3Vyc29yOiBudW1iZXI7XHJcbn1cclxuXHJcbi8qKiBDb21taXQgYWNjZXB0ZWQgYXMgdGhlIG5ldyBoZWFkLiAqL1xyXG5leHBvcnQgaW50ZXJmYWNlIENvbW1pdEFja01lc3NhZ2Uge1xyXG4gIHR5cGU6ICdjb21taXRBY2snO1xyXG4gIC8qKiBWZXJzaW9uIGlkIGFzc2lnbmVkIGJ5IHRoZSBhdXRob3JpdHkuICovXHJcbiAgdmVyc2lvbjogc3RyaW5nO1xyXG4gIC8qKiBMb2dpY2FsIGNsb2NrIG9mIHRoZSBhY2NlcHRlZCB2ZXJzaW9uLiAqL1xyXG4gIGNsb2NrOiBMb2dpY2FsQ2xvY2s7XHJcbiAgLyoqIEdsb2JhbCBzZXF1ZW5jZSBudW1iZXIgb2YgdGhlIGFjY2VwdGVkIGhlYWQgKGN1cnNvciB0cmFja2luZykuICovXHJcbiAgc2VxOiBudW1iZXI7XHJcbn1cclxuXHJcbi8qKiBXaGF0IGhhcHBlbmVkIHRvIHRoZSBsb3Npbmcgc2lkZSBvZiBhIGNvbmN1cnJlbnQgZWRpdCAoc2VlIGRpc3Bvc2l0aW9uKS4gKi9cclxuZXhwb3J0IHR5cGUgQ29uZmxpY3RMb3NlckRpc3Bvc2l0aW9uID0gJ2NvbmZsaWN0Q29weSc7XHJcblxyXG4vKipcclxuICogVGhlIHdpbm5pbmcgdmVyc2lvbiBvZiBhIGBjb25mbGljdGAgcmVwbHk6IGEgYFZlcnNpb25gIHBsdXMgdGhlIGhlYWQnc1xyXG4gKiBmb2xkZXIgZmxhZy4gYGlzRm9sZGVyYCBpcyBvcHRpb25hbCBvbiB0aGUgd2lyZSAob2xkZXIgc2VydmVycyBvbWl0IGl0KTtcclxuICogZm9sZGVyLXBsYWNlaG9sZGVyIHdpbm5lcnMgY2FycnkgYGhhc2g6ICcnYCAvIGBzaXplOiAwYCwgYW5kIHRoZSBmbGFnIGlzXHJcbiAqIHdoYXQgbGV0cyBhIGNsaWVudCBtYXRlcmlhbGl6ZSB0aGUgaGVhZCBhcyBmb2xkZXIgbWV0YWRhdGEgXHUyMDE0IGFuIGBlbnN1cmVEaXJgXHJcbiAqIFx1MjAxNCBpbnN0ZWFkIG9mIGF0dGVtcHRpbmcgYSBjb250ZW50IGZldGNoIGZvciB0aGUgZW1wdHkgaGFzaCAod2hpY2ggdGhlXHJcbiAqIGJsb2ItZmV0Y2ggZ3VhcmQgcmlnaHRseSByZWZ1c2VzKS5cclxuICovXHJcbmV4cG9ydCBpbnRlcmZhY2UgQ29uZmxpY3RXaW5uZXIgZXh0ZW5kcyBWZXJzaW9uIHtcclxuICAvKiogVHJ1ZSB3aGVuIHRoZSB3aW5uaW5nIGhlYWQgaXMgYSBmb2xkZXIgcGxhY2Vob2xkZXIgKEZSLTEwKS4gKi9cclxuICBpc0ZvbGRlcj86IGJvb2xlYW47XHJcbn1cclxuXHJcbi8qKiBDb21taXQgbG9zdCB0aGUgcmFjZTsgdGhlIHNlcnZlcidzIGNob3NlbiB3aW5uZXIgc3RhbmRzLiAqL1xyXG5leHBvcnQgaW50ZXJmYWNlIENvbmZsaWN0TWVzc2FnZSB7XHJcbiAgdHlwZTogJ2NvbmZsaWN0JztcclxuICAvKiogVGhlIHdpbm5pbmcgdmVyc2lvbiAodGhpcyBjb21taXQgb3IgdGhlIGNvbmN1cnJlbnQgb25lKS4gKi9cclxuICB3aW5uZXI6IENvbmZsaWN0V2lubmVyO1xyXG4gIC8qKiBXaGF0IHRoZSBzZXJ2ZXIgZGlkIHdpdGggdGhlIGxvc2VyJ3MgY29udGVudCBcdTIwMTQgbmV2ZXIgZGVsZXRlZC4gKi9cclxuICBsb3NlckRpc3Bvc2l0aW9uOiBDb25mbGljdExvc2VyRGlzcG9zaXRpb247XHJcbiAgLyoqIEdsb2JhbCBzZXF1ZW5jZSBudW1iZXIgb2YgdGhlIHdpbm5pbmcgaGVhZCwgd2hlbiBpdCBoYXMgb25lLiAqL1xyXG4gIHNlcT86IG51bWJlcjtcclxufVxyXG5cclxuLyoqXHJcbiAqIEZhbi1vdXQgcGF5bG9hZCBzaGFyZWQgYnkgdGhlIGNoYW5nZSBicm9hZGNhc3QgYW5kIHRoZSBhcmJpdHJhdGlvbiByZXN1bHQuXHJcbiAqIEV2ZXJ5dGhpbmcgYSBjbGllbnQgbmVlZHMgdG8gbWF0ZXJpYWxpemUgb25lIGhlYWQgdHJhbnNpdGlvbi5cclxuICovXHJcbmV4cG9ydCBpbnRlcmZhY2UgQ2hhbmdlUGF5bG9hZCB7XHJcbiAgcGF0aDogc3RyaW5nO1xyXG4gIC8qKiBWZXJzaW9uIGlkIG9mIHRoZSBuZXcgaGVhZC4gKi9cclxuICB2ZXJzaW9uOiBzdHJpbmc7XHJcbiAgaGFzaDogc3RyaW5nO1xyXG4gIHNpemU6IG51bWJlcjtcclxuICBkZWxldGVkOiBib29sZWFuO1xyXG4gIC8qKiBJZCBvZiB0aGUgZGV2aWNlIHRoYXQgY29tbWl0dGVkLiAqL1xyXG4gIGRldmljZTogc3RyaW5nO1xyXG4gIC8qKiBMb2dpY2FsIGNsb2NrIG9mIHRoZSBuZXcgaGVhZCBcdTIwMTQgY2xpZW50cyB1c2UgaXQgdG8gc2tpcCBzdGFsZSByZXBsYXlzLiAqL1xyXG4gIGNsb2NrOiBMb2dpY2FsQ2xvY2s7XHJcbiAgLyoqIFdoYXQga2luZCBvZiBjaGFuZ2UgdGhpcyBpcyAobWlycm9ycyBgVmVyc2lvbi5raW5kYCkuICovXHJcbiAga2luZDogVmVyc2lvbktpbmQ7XHJcbiAgLyoqIFNvdXJjZSBwYXRoIFx1MjAxNCBwcmVzZW50IHdoZW4gYGtpbmQ6ICdyZW5hbWUnYC4gKi9cclxuICBmcm9tUGF0aD86IHN0cmluZztcclxuICAvKiogVHJ1ZSBmb3IgZm9sZGVyIHBsYWNlaG9sZGVyIGNoYW5nZXMgKEZSLTEwKS4gKi9cclxuICBpc0ZvbGRlcj86IGJvb2xlYW47XHJcbn1cclxuXHJcbi8qKiBGYW4tb3V0IGJyb2FkY2FzdCB0byBhbGwgKm90aGVyKiBjb25uZWN0ZWQgY2xpZW50cy4gKi9cclxuZXhwb3J0IGludGVyZmFjZSBDaGFuZ2VNZXNzYWdlIGV4dGVuZHMgQ2hhbmdlUGF5bG9hZCB7XHJcbiAgdHlwZTogJ2NoYW5nZSc7XHJcbiAgLyoqIEdsb2JhbCBzZXF1ZW5jZSBudW1iZXIgb2YgdGhpcyBjaGFuZ2UgKGN1cnNvciB0cmFja2luZykuICovXHJcbiAgc2VxOiBudW1iZXI7XHJcbn1cclxuXHJcbi8qKiBSZXBseSB0byBgcHV0QmxvYmAuICovXHJcbmV4cG9ydCBpbnRlcmZhY2UgQmxvYkFja01lc3NhZ2Uge1xyXG4gIHR5cGU6ICdibG9iQWNrJztcclxuICBoYXNoOiBzdHJpbmc7XHJcbn1cclxuXHJcbi8qKiBSZXBseSB0byBgZ2V0QmxvYmA6IHRoZSByZXF1ZXN0ZWQgY29udGVudC4gKi9cclxuZXhwb3J0IGludGVyZmFjZSBCbG9iTWVzc2FnZSB7XHJcbiAgdHlwZTogJ2Jsb2InO1xyXG4gIGhhc2g6IHN0cmluZztcclxuICAvKiogRnVsbCBjb250ZW50LCBiYXNlNjQtZW5jb2RlZC4gKi9cclxuICBjb250ZW50OiBzdHJpbmc7XHJcbn1cclxuXHJcbi8qKiBNYWNoaW5lLXJlYWRhYmxlIGNvZGVzIGNhcnJpZWQgYnkgYGVycm9yYCBtZXNzYWdlcyAoSFRUUC1lcXVpdmFsZW50KS4gKi9cclxuZXhwb3J0IHR5cGUgU2VydmVyRXJyb3JDb2RlID0gJ1VOQVVUSE9SSVpFRCcgfCAnUkVWT0tFRCcgfCAnTk9UX0ZPVU5EJyB8ICdQUk9UT0NPTCc7XHJcblxyXG4vKiogTmVnYXRpdmUgcmVwbHkgKGF1dGggZmFpbHVyZSwgdW5rbm93biBibG9iLCBwcm90b2NvbCB2aW9sYXRpb24sIFx1MjAyNikuICovXHJcbmV4cG9ydCBpbnRlcmZhY2UgRXJyb3JNZXNzYWdlIHtcclxuICB0eXBlOiAnZXJyb3InO1xyXG4gIGNvZGU6IFNlcnZlckVycm9yQ29kZTtcclxuICBtZXNzYWdlOiBzdHJpbmc7XHJcbn1cclxuXHJcbi8qKiBQcmVzZW5jZSB1cGRhdGUgZm9yIGRhc2hib2FyZHMgLyBgdnNhIHN0YXR1c2AuICovXHJcbmV4cG9ydCBpbnRlcmZhY2UgRGV2aWNlU2Vlbk1lc3NhZ2Uge1xyXG4gIHR5cGU6ICdkZXZpY2VTZWVuJztcclxuICBkZXZpY2VJZDogc3RyaW5nO1xyXG4gIHRzOiBudW1iZXI7XHJcbn1cclxuXHJcbi8qKiBLZWVwYWxpdmUgcmVwbHkuICovXHJcbmV4cG9ydCBpbnRlcmZhY2UgUG9uZ01lc3NhZ2Uge1xyXG4gIHR5cGU6ICdwb25nJztcclxuICAvKiogRWNob2VzIHRoZSBgcGluZ2AgdHMgd2hlbiBvbmUgd2FzIHByb3ZpZGVkLiAqL1xyXG4gIHRzPzogbnVtYmVyO1xyXG59XHJcblxyXG4vKiogUmVwbHkgdG8gYHNuYXBzaG90Q3JlYXRlYC4gKi9cclxuZXhwb3J0IGludGVyZmFjZSBTbmFwc2hvdENyZWF0ZUFja01lc3NhZ2Uge1xyXG4gIHR5cGU6ICdzbmFwc2hvdENyZWF0ZUFjayc7XHJcbiAgLyoqIElkIGFzc2lnbmVkIGJ5IHRoZSBhdXRob3JpdHkgKGBze259YCkuICovXHJcbiAgaWQ6IHN0cmluZztcclxuICAvKiogRWNob2VzIHRoZSBzdG9yZWQgbmFtZSAoYCcnYCBmb3IgdW5uYW1lZCBzbmFwc2hvdHMpLiAqL1xyXG4gIG5hbWU6IHN0cmluZztcclxuICAvKiogRXBvY2ggbXMgb2YgdGhlIHNuYXBzaG90LiAqL1xyXG4gIHRzOiBudW1iZXI7XHJcbiAgLyoqIEdsb2JhbCBzZXF1ZW5jZSBudW1iZXIgYXQgY3JlYXRpb24gKGN1cnNvciBib29ra2VlcGluZykuICovXHJcbiAgc2VxOiBudW1iZXI7XHJcbiAgLyoqIE51bWJlciBvZiBmaWxlIGhlYWRzIGNhcHR1cmVkLiAqL1xyXG4gIGZpbGVDb3VudDogbnVtYmVyO1xyXG59XHJcblxyXG4vKiogUmVwbHkgdG8gYHNuYXBzaG90UmVzdG9yZWAuICovXHJcbmV4cG9ydCBpbnRlcmZhY2UgU25hcHNob3RSZXN0b3JlQWNrTWVzc2FnZSB7XHJcbiAgdHlwZTogJ3NuYXBzaG90UmVzdG9yZUFjayc7XHJcbiAgaWQ6IHN0cmluZztcclxuICAvKiogUGF0aHMgcmV2ZXJ0ZWQgdG8gdGhlIHNuYXBzaG90J3MgY29udGVudCAocmVzdXJyZWN0ZWQgdG9tYnN0b25lcyBpbmNsdWRlZCkuICovXHJcbiAgcmVzdG9yZWQ6IG51bWJlcjtcclxuICAvKiogUGF0aHMgbmV3bHkgdG9tYnN0b25lZCAobGl2ZSBub3csIGFic2VudCBvciBkZWxldGVkIGF0IHRoZSBzbmFwc2hvdCkuICovXHJcbiAgdG9tYnN0b25lZDogbnVtYmVyO1xyXG4gIC8qKiBHbG9iYWwgc2VxIG9mIHRoZSBsYXN0IHJlc3RvcmUgY2hhbmdlIChjdXJyZW50IHNlcSB3aGVuIG5vdGhpbmcgZGlmZmVyZWQpLiAqL1xyXG4gIHNlcTogbnVtYmVyO1xyXG59XHJcblxyXG4vKiogT25lIHZhdWx0LWxldmVsIHNuYXBzaG90IGFzIGxpc3RlZCBieSB0aGUgc2VydmVyIChgR0VUIC9hcGkvc25hcHNob3RzYCkuICovXHJcbmV4cG9ydCBpbnRlcmZhY2UgU25hcHNob3RTdW1tYXJ5IHtcclxuICBpZDogc3RyaW5nO1xyXG4gIG5hbWU6IHN0cmluZztcclxuICAvKiogRXBvY2ggbXMgb2YgY3JlYXRpb24uICovXHJcbiAgdHM6IG51bWJlcjtcclxuICAvKiogRGV2aWNlIHRoYXQgY3JlYXRlZCB0aGUgc25hcHNob3QuICovXHJcbiAgZGV2aWNlSWQ6IHN0cmluZztcclxuICAvKiogR2xvYmFsIHNlcXVlbmNlIG51bWJlciBhdCBjcmVhdGlvbi4gKi9cclxuICBzZXE6IG51bWJlcjtcclxuICAvKiogTnVtYmVyIG9mIGZpbGUgaGVhZHMgY2FwdHVyZWQuICovXHJcbiAgZmlsZUNvdW50OiBudW1iZXI7XHJcbn1cclxuXHJcbi8vIC0tLSBVbmlvbiArIGd1YXJkcyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHJcbmV4cG9ydCB0eXBlIENsaWVudE1lc3NhZ2UgPVxyXG4gIHwgSGVsbG9NZXNzYWdlXHJcbiAgfCBHZXRNYW5pZmVzdE1lc3NhZ2VcclxuICB8IENvbW1pdE1lc3NhZ2VcclxuICB8IFB1dEJsb2JNZXNzYWdlXHJcbiAgfCBHZXRCbG9iTWVzc2FnZVxyXG4gIHwgUGluZ01lc3NhZ2VcclxuICB8IFNuYXBzaG90Q3JlYXRlTWVzc2FnZVxyXG4gIHwgU25hcHNob3RSZXN0b3JlTWVzc2FnZTtcclxuXHJcbmV4cG9ydCB0eXBlIFNlcnZlck1lc3NhZ2UgPVxyXG4gIHwgSGVsbG9BY2tNZXNzYWdlXHJcbiAgfCBNYW5pZmVzdE1lc3NhZ2VcclxuICB8IENvbW1pdEFja01lc3NhZ2VcclxuICB8IENvbmZsaWN0TWVzc2FnZVxyXG4gIHwgQ2hhbmdlTWVzc2FnZVxyXG4gIHwgRGV2aWNlU2Vlbk1lc3NhZ2VcclxuICB8IEJsb2JBY2tNZXNzYWdlXHJcbiAgfCBCbG9iTWVzc2FnZVxyXG4gIHwgRXJyb3JNZXNzYWdlXHJcbiAgfCBQb25nTWVzc2FnZVxyXG4gIHwgU25hcHNob3RDcmVhdGVBY2tNZXNzYWdlXHJcbiAgfCBTbmFwc2hvdFJlc3RvcmVBY2tNZXNzYWdlO1xyXG5cclxuZXhwb3J0IHR5cGUgTWVzc2FnZSA9IENsaWVudE1lc3NhZ2UgfCBTZXJ2ZXJNZXNzYWdlO1xyXG5cclxuY29uc3QgQ0xJRU5UX1RZUEVTOiBSZWFkb25seVNldDxzdHJpbmc+ID0gbmV3IFNldChbXHJcbiAgJ2hlbGxvJyxcclxuICAnZ2V0TWFuaWZlc3QnLFxyXG4gICdjb21taXQnLFxyXG4gICdwdXRCbG9iJyxcclxuICAnZ2V0QmxvYicsXHJcbiAgJ3BpbmcnLFxyXG4gICdzbmFwc2hvdENyZWF0ZScsXHJcbiAgJ3NuYXBzaG90UmVzdG9yZScsXHJcbl0pO1xyXG5jb25zdCBTRVJWRVJfVFlQRVM6IFJlYWRvbmx5U2V0PHN0cmluZz4gPSBuZXcgU2V0KFtcclxuICAnaGVsbG9BY2snLFxyXG4gICdtYW5pZmVzdCcsXHJcbiAgJ2NvbW1pdEFjaycsXHJcbiAgJ2NvbmZsaWN0JyxcclxuICAnY2hhbmdlJyxcclxuICAnZGV2aWNlU2VlbicsXHJcbiAgJ2Jsb2JBY2snLFxyXG4gICdibG9iJyxcclxuICAnZXJyb3InLFxyXG4gICdwb25nJyxcclxuICAnc25hcHNob3RDcmVhdGVBY2snLFxyXG4gICdzbmFwc2hvdFJlc3RvcmVBY2snLFxyXG5dKTtcclxuXHJcbi8qKlxyXG4gKiBSdW50aW1lIHNoYXBlIGNoZWNrOiBhIHZhbHVlIGlzIGEgYE1lc3NhZ2VgIGlmZiBpdCBpcyBhbiBvYmplY3Qgd2hvc2VcclxuICogYHR5cGVgIGlzIGEga25vd24gbWVzc2FnZSB0eXBlLiBGaWVsZC1sZXZlbCB2YWxpZGF0aW9uIGhhcHBlbnMgd2hlcmUgYVxyXG4gKiBtZXNzYWdlIGlzIGFjdGVkIHVwb24gKGxhdGVyIHBoYXNlcyk7IHRoZSBndWFyZCBpcyBkZWxpYmVyYXRlbHkgY2hlYXAgc29cclxuICogYm90aCBXUyBlbmRzIGNhbiB0cmlhZ2UgdW5rbm93bi9mb3J3YXJkLWNvbXBhdGlibGUgdHlwZXMuXHJcbiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gaXNNZXNzYWdlKHZhbHVlOiB1bmtub3duKTogdmFsdWUgaXMgTWVzc2FnZSB7XHJcbiAgcmV0dXJuIChcclxuICAgIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiZcclxuICAgIHZhbHVlICE9PSBudWxsICYmXHJcbiAgICB0eXBlb2YgKHZhbHVlIGFzIHsgdHlwZT86IHVua25vd24gfSkudHlwZSA9PT0gJ3N0cmluZycgJiZcclxuICAgIChDTElFTlRfVFlQRVMuaGFzKCh2YWx1ZSBhcyB7IHR5cGU6IHN0cmluZyB9KS50eXBlKSB8fFxyXG4gICAgICBTRVJWRVJfVFlQRVMuaGFzKCh2YWx1ZSBhcyB7IHR5cGU6IHN0cmluZyB9KS50eXBlKSlcclxuICApO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gaXNDbGllbnRNZXNzYWdlKHZhbHVlOiB1bmtub3duKTogdmFsdWUgaXMgQ2xpZW50TWVzc2FnZSB7XHJcbiAgcmV0dXJuIChcclxuICAgIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiZcclxuICAgIHZhbHVlICE9PSBudWxsICYmXHJcbiAgICBDTElFTlRfVFlQRVMuaGFzKCh2YWx1ZSBhcyB7IHR5cGU/OiB1bmtub3duIH0pLnR5cGUgYXMgc3RyaW5nKVxyXG4gICk7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBpc1NlcnZlck1lc3NhZ2UodmFsdWU6IHVua25vd24pOiB2YWx1ZSBpcyBTZXJ2ZXJNZXNzYWdlIHtcclxuICByZXR1cm4gKFxyXG4gICAgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJlxyXG4gICAgdmFsdWUgIT09IG51bGwgJiZcclxuICAgIFNFUlZFUl9UWVBFUy5oYXMoKHZhbHVlIGFzIHsgdHlwZT86IHVua25vd24gfSkudHlwZSBhcyBzdHJpbmcpXHJcbiAgKTtcclxufVxyXG5cclxuLyoqXHJcbiAqIFBhcnNlIGEgV1MgdGV4dCBmcmFtZSBpbnRvIGEgdHlwZWQgYE1lc3NhZ2VgLlxyXG4gKiBUaHJvd3MgYFByb3RvY29sRXJyb3JgIG9uIG5vbi1KU09OIGlucHV0IG9yIHVua25vd24gbWVzc2FnZSB0eXBlcy5cclxuICovXHJcbmV4cG9ydCBmdW5jdGlvbiBwYXJzZU1lc3NhZ2UoZGF0YTogc3RyaW5nKTogTWVzc2FnZSB7XHJcbiAgbGV0IHBhcnNlZDogdW5rbm93bjtcclxuICB0cnkge1xyXG4gICAgcGFyc2VkID0gSlNPTi5wYXJzZShkYXRhKTtcclxuICB9IGNhdGNoIChjYXVzZSkge1xyXG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoYE1lc3NhZ2UgaXMgbm90IHZhbGlkIEpTT046ICR7U3RyaW5nKGRhdGEpLnNsaWNlKDAsIDIwMCl9YCwgeyBjYXVzZSB9KTtcclxuICB9XHJcbiAgaWYgKCFpc01lc3NhZ2UocGFyc2VkKSkge1xyXG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoXHJcbiAgICAgIGBVbmtub3duIG9yIG1hbGZvcm1lZCBtZXNzYWdlIHR5cGU6ICR7SlNPTi5zdHJpbmdpZnkoKHBhcnNlZCBhcyB7IHR5cGU/OiB1bmtub3duIH0pPy50eXBlKX1gLFxyXG4gICAgKTtcclxuICB9XHJcbiAgcmV0dXJuIHBhcnNlZDtcclxufVxyXG5cclxuLy8gLS0tIHNlcnZlci1kYXRhIGZpZWxkIHZhbGlkYXRpb24gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbi8vXHJcbi8vIGBpc01lc3NhZ2VgIHRyaWFnZXMgdGhlIGB0eXBlYCBkaXNjcmltaW5hbnQgb25seTsgdGhlc2UgdmFsaWRhdG9ycyBjaGVja1xyXG4vLyB0aGUgRklFTERTIG9mIHRoZSBzZXJ2ZXIgcGF5bG9hZHMgYSBjbGllbnQgZm9sZHMgaW50byBpdHMgcGVyc2lzdGVkIGxvY2FsXHJcbi8vIGluZGV4IChtYW5pZmVzdCBlbnRyaWVzLCBjb21taXQvY29uZmxpY3QgcmVwbGllcywgY2hhbmdlIGJyb2FkY2FzdHMpLiBPbmVcclxuLy8gbWFsZm9ybWVkIGZpZWxkIFx1MjAxNCBhIG1pc3NpbmcgdmVyc2lvbiBpZCwgYSBub24tbnVtZXJpYyBzaXplLCBhIGZyYWN0aW9uYWxcclxuLy8gY2xvY2sgY291bnRlciBcdTIwMTQgd291bGQgb3RoZXJ3aXNlIGJlIHBlcnNpc3RlZCB0byB0aGUgc3RhdGUgZmlsZSBhbmQgdGhlblxyXG4vLyBSRUpFQ1RFRCBieSBgZGVzZXJpYWxpemVMb2NhbFN0YXRlYCBvbiBldmVyeSBzdWJzZXF1ZW50IHN0YXJ0dXAuIENsaWVudHNcclxuLy8gdmFsaWRhdGUgYXQgdGhlIGluZ2VzdCBib3VuZGFyeSwgYmVmb3JlIGFueSBmaWVsZCBpcyBhcHBsaWVkOiB2aW9sYXRpb25zXHJcbi8vIHRocm93IGBQcm90b2NvbEVycm9yYCwgdGhlIG9mZmVuZGluZyBtZXNzYWdlIGlzIHJlamVjdGVkLCBub3RoaW5nIHBlcnNpc3RzLlxyXG5cclxuY29uc3QgVkVSU0lPTl9LSU5EUzogUmVhZG9ubHlTZXQ8c3RyaW5nPiA9IG5ldyBTZXQoW1xyXG4gICdlZGl0JyxcclxuICAncmVuYW1lJyxcclxuICAnZGVsZXRlJyxcclxuICAnY29uZmxpY3RDb3B5JyxcclxuICAncmVzdG9yZScsXHJcbl0pO1xyXG5cclxuZnVuY3Rpb24gaXNQbGFpbk9iamVjdCh2YWx1ZTogdW5rbm93bik6IHZhbHVlIGlzIFJlY29yZDxzdHJpbmcsIHVua25vd24+IHtcclxuICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiB2YWx1ZSAhPT0gbnVsbCAmJiAhQXJyYXkuaXNBcnJheSh2YWx1ZSk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGV4cGVjdE5vbkVtcHR5U3RyaW5nKHZhbHVlOiB1bmtub3duLCB3aGVyZTogc3RyaW5nKTogdm9pZCB7XHJcbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gJ3N0cmluZycgfHwgdmFsdWUgPT09ICcnKSB7XHJcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgJHt3aGVyZX0gbXVzdCBiZSBhIG5vbi1lbXB0eSBzdHJpbmdgKTtcclxuICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGV4cGVjdE5vbk5lZ2F0aXZlSW50ZWdlcih2YWx1ZTogdW5rbm93biwgd2hlcmU6IHN0cmluZyk6IHZvaWQge1xyXG4gIGlmICh0eXBlb2YgdmFsdWUgIT09ICdudW1iZXInIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKHZhbHVlKSB8fCB2YWx1ZSA8IDApIHtcclxuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKGAke3doZXJlfSBtdXN0IGJlIGEgbm9uLW5lZ2F0aXZlIGludGVnZXJgKTtcclxuICB9XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGV4cGVjdENsb2NrKHZhbHVlOiB1bmtub3duLCB3aGVyZTogc3RyaW5nKTogdm9pZCB7XHJcbiAgaWYgKFxyXG4gICAgIWlzUGxhaW5PYmplY3QodmFsdWUpIHx8XHJcbiAgICB0eXBlb2YgdmFsdWUuY291bnRlciAhPT0gJ251bWJlcicgfHxcclxuICAgICFOdW1iZXIuaXNJbnRlZ2VyKHZhbHVlLmNvdW50ZXIpIHx8XHJcbiAgICB2YWx1ZS5jb3VudGVyIDw9IDAgfHxcclxuICAgIHR5cGVvZiB2YWx1ZS5kZXZpY2VJZCAhPT0gJ3N0cmluZydcclxuICApIHtcclxuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKFxyXG4gICAgICBgJHt3aGVyZX0gbXVzdCBiZSBhIGNsb2NrIHsgY291bnRlcjogcG9zaXRpdmUgaW50ZWdlciwgZGV2aWNlSWQ6IHN0cmluZyB9YCxcclxuICAgICk7XHJcbiAgfVxyXG59XHJcblxyXG4vKipcclxuICogVmFsaWRhdGUgb25lIG1hbmlmZXN0IGVudHJ5J3MgZmllbGRzLiBSZXR1cm5zIHRoZSBlbnRyeSB1bmNoYW5nZWQ7IHRocm93c1xyXG4gKiBgUHJvdG9jb2xFcnJvcmAgb24gYSBmaWVsZCB0aGF0IGNvdWxkIG5vdCBzdXJ2aXZlIGEgcGVyc2lzdC9yZWxvYWQgY3ljbGVcclxuICogKGBsb2NhbGluZGV4LnRzYCByZS12YWxpZGF0ZXMgc3RyaWN0bHkgb24gbG9hZCkuXHJcbiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVNYW5pZmVzdEVudHJ5KGVudHJ5OiB1bmtub3duKTogTWFuaWZlc3RFbnRyeSB7XHJcbiAgaWYgKCFpc1BsYWluT2JqZWN0KGVudHJ5KSkge1xyXG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoJ01hbGZvcm1lZCBzZXJ2ZXIgZGF0YTogbWFuaWZlc3QgZW50cnkgaXMgbm90IGFuIG9iamVjdCcpO1xyXG4gIH1cclxuICBjb25zdCB3aGVyZSA9IGBtYW5pZmVzdCBlbnRyeSAke0pTT04uc3RyaW5naWZ5KGVudHJ5LnBhdGgpfWA7XHJcbiAgZXhwZWN0Tm9uRW1wdHlTdHJpbmcoZW50cnkucGF0aCwgYCR7d2hlcmV9OiBwYXRoYCk7XHJcbiAgZXhwZWN0Tm9uRW1wdHlTdHJpbmcoZW50cnkudmVyc2lvbiwgYCR7d2hlcmV9OiB2ZXJzaW9uYCk7XHJcbiAgaWYgKHR5cGVvZiBlbnRyeS5oYXNoICE9PSAnc3RyaW5nJykge1xyXG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoYCR7d2hlcmV9OiBoYXNoIG11c3QgYmUgYSBzdHJpbmdgKTtcclxuICB9XHJcbiAgZXhwZWN0Tm9uTmVnYXRpdmVJbnRlZ2VyKGVudHJ5LnNpemUsIGAke3doZXJlfTogc2l6ZWApO1xyXG4gIGlmICh0eXBlb2YgZW50cnkuZGVsZXRlZCAhPT0gJ2Jvb2xlYW4nKSB7XHJcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgJHt3aGVyZX06IGRlbGV0ZWQgbXVzdCBiZSBhIGJvb2xlYW5gKTtcclxuICB9XHJcbiAgZXhwZWN0Q2xvY2soZW50cnkuY2xvY2ssIGAke3doZXJlfTogY2xvY2tgKTtcclxuICBpZiAoZW50cnkuaXNGb2xkZXIgIT09IHVuZGVmaW5lZCAmJiB0eXBlb2YgZW50cnkuaXNGb2xkZXIgIT09ICdib29sZWFuJykge1xyXG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoYCR7d2hlcmV9OiBpc0ZvbGRlciBtdXN0IGJlIGEgYm9vbGVhbiB3aGVuIHByZXNlbnRgKTtcclxuICB9XHJcbiAgaWYgKGVudHJ5Lm10aW1lICE9PSB1bmRlZmluZWQgJiYgKHR5cGVvZiBlbnRyeS5tdGltZSAhPT0gJ251bWJlcicgfHwgIU51bWJlci5pc0Zpbml0ZShlbnRyeS5tdGltZSkpKSB7XHJcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgJHt3aGVyZX06IG10aW1lIG11c3QgYmUgYSBmaW5pdGUgbnVtYmVyIHdoZW4gcHJlc2VudGApO1xyXG4gIH1cclxuICByZXR1cm4gZW50cnkgYXMgdW5rbm93biBhcyBNYW5pZmVzdEVudHJ5O1xyXG59XHJcblxyXG4vKiogVmFsaWRhdGUgYSBgbWFuaWZlc3RgIHJlcGx5IChjdXJzb3IgKyBldmVyeSBlbnRyeSkgYmVmb3JlIGl0IGlzIHByb2plY3RlZC4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlTWFuaWZlc3RNZXNzYWdlKG1lc3NhZ2U6IE1hbmlmZXN0TWVzc2FnZSk6IHZvaWQge1xyXG4gIGV4cGVjdE5vbk5lZ2F0aXZlSW50ZWdlcihtZXNzYWdlLmN1cnNvciwgJ21hbmlmZXN0IGN1cnNvcicpO1xyXG4gIGZvciAoY29uc3QgZW50cnkgb2YgT2JqZWN0LnZhbHVlcyhtZXNzYWdlLmVudHJpZXMpKSB7XHJcbiAgICB2YWxpZGF0ZU1hbmlmZXN0RW50cnkoZW50cnkpO1xyXG4gIH1cclxufVxyXG5cclxuLyoqIFZhbGlkYXRlIGEgYGNvbW1pdEFja2AgYmVmb3JlIGl0cyB2ZXJzaW9uL2Nsb2NrIGFyZSBmb2xkZWQgaW50byB0aGUgaW5kZXguICovXHJcbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUNvbW1pdEFja01lc3NhZ2UobWVzc2FnZTogQ29tbWl0QWNrTWVzc2FnZSk6IHZvaWQge1xyXG4gIGV4cGVjdE5vbkVtcHR5U3RyaW5nKG1lc3NhZ2UudmVyc2lvbiwgJ2NvbW1pdEFjay52ZXJzaW9uJyk7XHJcbiAgZXhwZWN0Q2xvY2sobWVzc2FnZS5jbG9jaywgJ2NvbW1pdEFjay5jbG9jaycpO1xyXG4gIGV4cGVjdE5vbk5lZ2F0aXZlSW50ZWdlcihtZXNzYWdlLnNlcSwgJ2NvbW1pdEFjay5zZXEnKTtcclxufVxyXG5cclxuLyoqIFZhbGlkYXRlIGEgYGNoYW5nZWAgYnJvYWRjYXN0IGJlZm9yZSBpdCBpcyBhcHBsaWVkIG9yIHJlcGxheWVkLiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVDaGFuZ2VNZXNzYWdlKGNoYW5nZTogQ2hhbmdlTWVzc2FnZSk6IHZvaWQge1xyXG4gIGNvbnN0IHdoZXJlID0gYGNoYW5nZSAke0pTT04uc3RyaW5naWZ5KGNoYW5nZS5wYXRoKX1gO1xyXG4gIGV4cGVjdE5vbkVtcHR5U3RyaW5nKGNoYW5nZS5wYXRoLCBgJHt3aGVyZX06IHBhdGhgKTtcclxuICBleHBlY3ROb25FbXB0eVN0cmluZyhjaGFuZ2UudmVyc2lvbiwgYCR7d2hlcmV9OiB2ZXJzaW9uYCk7XHJcbiAgaWYgKHR5cGVvZiBjaGFuZ2UuaGFzaCAhPT0gJ3N0cmluZycpIHtcclxuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKGAke3doZXJlfTogaGFzaCBtdXN0IGJlIGEgc3RyaW5nYCk7XHJcbiAgfVxyXG4gIGV4cGVjdE5vbk5lZ2F0aXZlSW50ZWdlcihjaGFuZ2Uuc2l6ZSwgYCR7d2hlcmV9OiBzaXplYCk7XHJcbiAgaWYgKHR5cGVvZiBjaGFuZ2UuZGVsZXRlZCAhPT0gJ2Jvb2xlYW4nKSB7XHJcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgJHt3aGVyZX06IGRlbGV0ZWQgbXVzdCBiZSBhIGJvb2xlYW5gKTtcclxuICB9XHJcbiAgaWYgKHR5cGVvZiBjaGFuZ2UuZGV2aWNlICE9PSAnc3RyaW5nJykge1xyXG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoYCR7d2hlcmV9OiBkZXZpY2UgbXVzdCBiZSBhIHN0cmluZ2ApO1xyXG4gIH1cclxuICBleHBlY3RDbG9jayhjaGFuZ2UuY2xvY2ssIGAke3doZXJlfTogY2xvY2tgKTtcclxuICBpZiAoIVZFUlNJT05fS0lORFMuaGFzKGNoYW5nZS5raW5kKSkge1xyXG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoYCR7d2hlcmV9OiBraW5kIG11c3QgYmUgYSBWZXJzaW9uS2luZGApO1xyXG4gIH1cclxuICBpZiAoY2hhbmdlLmZyb21QYXRoICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIGNoYW5nZS5mcm9tUGF0aCAhPT0gJ3N0cmluZycpIHtcclxuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKGAke3doZXJlfTogZnJvbVBhdGggbXVzdCBiZSBhIHN0cmluZyB3aGVuIHByZXNlbnRgKTtcclxuICB9XHJcbiAgaWYgKGNoYW5nZS5pc0ZvbGRlciAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBjaGFuZ2UuaXNGb2xkZXIgIT09ICdib29sZWFuJykge1xyXG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoYCR7d2hlcmV9OiBpc0ZvbGRlciBtdXN0IGJlIGEgYm9vbGVhbiB3aGVuIHByZXNlbnRgKTtcclxuICB9XHJcbiAgZXhwZWN0Tm9uTmVnYXRpdmVJbnRlZ2VyKGNoYW5nZS5zZXEsIGAke3doZXJlfTogc2VxYCk7XHJcbn1cclxuXHJcbi8qKiBWYWxpZGF0ZSBhIGBjb25mbGljdGAgcmVwbHkncyB3aW5uZXIgYmVmb3JlIGl0IGlzIG1hdGVyaWFsaXplZCBvciByZWNvcmRlZC4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlQ29uZmxpY3RNZXNzYWdlKG1lc3NhZ2U6IENvbmZsaWN0TWVzc2FnZSk6IHZvaWQge1xyXG4gIGNvbnN0IHdpbm5lciA9IG1lc3NhZ2Uud2lubmVyIGFzIHtcclxuICAgIHBhdGg/OiB1bmtub3duO1xyXG4gICAgaWQ/OiB1bmtub3duO1xyXG4gICAgaGFzaD86IHVua25vd247XHJcbiAgICBzaXplPzogdW5rbm93bjtcclxuICAgIGRldmljZUlkPzogdW5rbm93bjtcclxuICAgIGNsb2NrPzogdW5rbm93bjtcclxuICAgIGtpbmQ/OiB1bmtub3duO1xyXG4gICAgaXNGb2xkZXI/OiB1bmtub3duO1xyXG4gIH07XHJcbiAgY29uc3Qgd2hlcmUgPSBgY29uZmxpY3Qgd2lubmVyICR7SlNPTi5zdHJpbmdpZnkod2lubmVyLnBhdGgpfWA7XHJcbiAgZXhwZWN0Tm9uRW1wdHlTdHJpbmcod2lubmVyLnBhdGgsIGAke3doZXJlfTogcGF0aGApO1xyXG4gIGV4cGVjdE5vbkVtcHR5U3RyaW5nKHdpbm5lci5pZCwgYCR7d2hlcmV9OiBpZGApO1xyXG4gIGlmICh0eXBlb2Ygd2lubmVyLmhhc2ggIT09ICdzdHJpbmcnKSB7XHJcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgJHt3aGVyZX06IGhhc2ggbXVzdCBiZSBhIHN0cmluZ2ApO1xyXG4gIH1cclxuICBleHBlY3ROb25OZWdhdGl2ZUludGVnZXIod2lubmVyLnNpemUsIGAke3doZXJlfTogc2l6ZWApO1xyXG4gIGlmICh0eXBlb2Ygd2lubmVyLmRldmljZUlkICE9PSAnc3RyaW5nJykge1xyXG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoYCR7d2hlcmV9OiBkZXZpY2VJZCBtdXN0IGJlIGEgc3RyaW5nYCk7XHJcbiAgfVxyXG4gIGV4cGVjdENsb2NrKHdpbm5lci5jbG9jaywgYCR7d2hlcmV9OiBjbG9ja2ApO1xyXG4gIGlmICh0eXBlb2Ygd2lubmVyLmtpbmQgIT09ICdzdHJpbmcnIHx8ICFWRVJTSU9OX0tJTkRTLmhhcyh3aW5uZXIua2luZCkpIHtcclxuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKGAke3doZXJlfToga2luZCBtdXN0IGJlIGEgVmVyc2lvbktpbmRgKTtcclxuICB9XHJcbiAgaWYgKHdpbm5lci5pc0ZvbGRlciAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiB3aW5uZXIuaXNGb2xkZXIgIT09ICdib29sZWFuJykge1xyXG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoYCR7d2hlcmV9OiBpc0ZvbGRlciBtdXN0IGJlIGEgYm9vbGVhbiB3aGVuIHByZXNlbnRgKTtcclxuICB9XHJcbiAgaWYgKG1lc3NhZ2Uuc2VxICE9PSB1bmRlZmluZWQpIHtcclxuICAgIGV4cGVjdE5vbk5lZ2F0aXZlSW50ZWdlcihtZXNzYWdlLnNlcSwgJ2NvbmZsaWN0LnNlcScpO1xyXG4gIH1cclxufVxyXG5cclxuLy8gLS0tIHdpcmUgZW5jb2RpbmcgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbi8vXHJcbi8vIGBpbmxpbmVgL2Bjb250ZW50YCBmaWVsZHMgY2FycnkgcmF3IGJ5dGVzIGFzIGJhc2U2NC4gYGJ0b2FgL2BhdG9iYCBleGlzdCBpblxyXG4vLyBldmVyeSB0YXJnZXQgcnVudGltZSAoV29ya2VycywgTm9kZSAxNissIEVsZWN0cm9uKTsgY2h1bmtpbmcgYXZvaWRzXHJcbi8vIGV4Y2VlZGluZyBhcmd1bWVudC1sZW5ndGggbGltaXRzIG9uIGxhcmdlIGF0dGFjaG1lbnRzLlxyXG5cclxuLyoqIEVuY29kZSBieXRlcyBhcyBiYXNlNjQuICovXHJcbmV4cG9ydCBmdW5jdGlvbiBieXRlc1RvQmFzZTY0KGJ5dGVzOiBVaW50OEFycmF5KTogc3RyaW5nIHtcclxuICBsZXQgYmluYXJ5ID0gJyc7XHJcbiAgY29uc3QgQ0hVTksgPSAweDgwMDA7XHJcbiAgZm9yIChsZXQgb2Zmc2V0ID0gMDsgb2Zmc2V0IDwgYnl0ZXMubGVuZ3RoOyBvZmZzZXQgKz0gQ0hVTkspIHtcclxuICAgIGJpbmFyeSArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKC4uLmJ5dGVzLnN1YmFycmF5KG9mZnNldCwgb2Zmc2V0ICsgQ0hVTkspKTtcclxuICB9XHJcbiAgcmV0dXJuIGJ0b2EoYmluYXJ5KTtcclxufVxyXG5cclxuLyoqIERlY29kZSBiYXNlNjQgdG8gYnl0ZXMuIFRocm93cyBgUHJvdG9jb2xFcnJvcmAgb24gaW52YWxpZCBpbnB1dC4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGJhc2U2NFRvQnl0ZXMoZW5jb2RlZDogc3RyaW5nKTogVWludDhBcnJheSB7XHJcbiAgbGV0IGJpbmFyeTogc3RyaW5nO1xyXG4gIHRyeSB7XHJcbiAgICBiaW5hcnkgPSBhdG9iKGVuY29kZWQpO1xyXG4gIH0gY2F0Y2ggKGNhdXNlKSB7XHJcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcignQmFzZTY0IHBheWxvYWQgaXMgbm90IHZhbGlkJywgeyBjYXVzZSB9KTtcclxuICB9XHJcbiAgY29uc3QgYnl0ZXMgPSBuZXcgVWludDhBcnJheShiaW5hcnkubGVuZ3RoKTtcclxuICBmb3IgKGxldCBpID0gMDsgaSA8IGJpbmFyeS5sZW5ndGg7IGkrKykgYnl0ZXNbaV0gPSBiaW5hcnkuY2hhckNvZGVBdChpKTtcclxuICByZXR1cm4gYnl0ZXM7XHJcbn1cclxuIiwgIi8qKlxuICogQ29uZmxpY3QtY29weSBmaWxlIG5hbWluZyAoQVJDSElURUNUVVJFLm1kIFx1MDBBNzQsIEZSLTYpLlxuICpcbiAqIFdoZW4gYSBkZXZpY2UgbG9zZXMgYSBjb25mbGljdCBidXQgaXRzIGNvbnRlbnQgbXVzdCBiZSBwcmVzZXJ2ZWQsIHRoZVxuICogY29udGVudCBpcyBjb21taXR0ZWQgdG8gYSBzaWJsaW5nIFwiY29uZmxpY3QgY29weVwiIHBhdGggc2hhcGVkIGxpa2U6XG4gKlxuICogICAgIE5vdGUgKGNvbmZsaWN0IDIwMjYtMDgtMjAgMTQtMjMgLSBmcm9tIFBob25lKS5tZFxuICogICAgIFx1MjUxNFx1MjUwMCBzdGVtIFx1MjUwMFx1MjUxOFx1MjUxNFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMCBVVEMgZGF0ZSArIEhILW1tIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUxOFx1MjUxNCBkZXZpY2UgXHUyNTE4XHUyNTE0ZXh0XHUyNTE4XG4gKlxuICogUnVsZXM6XG4gKiAgIC0gdGltZXN0YW1wIGlzIGFsd2F5cyBVVEMgKG5ldmVyIGEgbG9jYWwgdGltZXpvbmUpIHNvIGV2ZXJ5IGNsaWVudFxuICogICAgIGNvbXB1dGVzIHRoZSBpZGVudGljYWwgbmFtZSBmcm9tIHRoZSBzYW1lIGNvbW1pdCB0aW1lO1xuICogICAtIHRoZSBkZXZpY2UgbmFtZSBpcyBzYW5pdGl6ZWQgZm9yIGZpbGVzeXN0ZW0gc2FmZXR5IChzZWVcbiAqICAgICBgc2FuaXRpemVEZXZpY2VOYW1lYCk7XG4gKiAgIC0gdGhlIG9yaWdpbmFsIGV4dGVuc2lvbiBpcyBwcmVzZXJ2ZWQgKGxhc3QgZG90IGluIHRoZSBiYXNlbmFtZSwgYXMgbG9uZ1xuICogICAgIGFzIGl0IGlzIG5vdCB0aGUgZmlyc3QgY2hhcmFjdGVyIFx1MjAxNCBgLmdpdGlnbm9yZWAgaGFzIG5vIGV4dGVuc2lvbik7XG4gKiAgIC0gaWYgdGhlIGNhbmRpZGF0ZSBhbHJlYWR5IGV4aXN0cyAoaW4gdGhlIGxvY2FsIGluZGV4IG9yIHRoZSByZW1vdGVcbiAqICAgICBtYW5pZmVzdCBcdTIwMTQgdGhlIGNhbGxlciBzdXBwbGllcyB0aGUgYGV4aXN0c2AgcHJlZGljYXRlKSwgYCAyYCwgYCAzYCwgXHUyMDI2XG4gKiAgICAgaXMgYXBwZW5kZWQgYmVmb3JlIHRoZSBleHRlbnNpb24uXG4gKi9cblxuaW1wb3J0IHsgYmFzZW5hbWUsIG5vcm1hbGl6ZVZhdWx0UGF0aCwgcGFyZW50UGF0aCB9IGZyb20gJy4vcGF0aHMuanMnO1xuXG4vKiogQ2hhcmFjdGVycyBmb3JiaWRkZW4gb24gYXQgbGVhc3Qgb25lIHN1cHBvcnRlZCBwbGF0Zm9ybS4gKi9cbmNvbnN0IElMTEVHQUxfRklMRU5BTUVfQ0hBUlMgPSAvWzw+OlwiL1xcXFx8PypdL2c7XG4vKiogQzAgY29udHJvbHMgKyBERUwgXHUyMDE0IG5ldmVyIHZhbGlkIGluIGZpbGVuYW1lcy4gKi9cbmNvbnN0IENPTlRST0xfQ0hBUlMgPSAvW1xceDAwLVxceDFmXFx4N2ZdL2c7XG5cbi8qKiBNYXggbGVuZ3RoIChpbiBjb2RlIHBvaW50cykgb2YgYSBzYW5pdGl6ZWQgZGV2aWNlIG5hbWUuICovXG5jb25zdCBNQVhfREVWSUNFX05BTUVfTEVOR1RIID0gMzA7XG5cbi8qKiBGYWxsYmFjayB3aGVuIGEgZGV2aWNlIG5hbWUgc2FuaXRpemVzIHRvIG5vdGhpbmcuICovXG5jb25zdCBGQUxMQkFDS19ERVZJQ0VfTkFNRSA9ICd1bmtub3duJztcblxuLyoqIEhpZ2hlc3QgYCBOYCBzdWZmaXggdHJpZWQgYmVmb3JlIGdpdmluZyB1cC4gKi9cbmNvbnN0IE1BWF9DT0xMSVNJT05fU1VGRklYID0gOTk5O1xuXG4vKipcbiAqIFNhbml0aXplIGEgZGV2aWNlIG5hbWUgZm9yIHVzZSBpbnNpZGUgYSBmaWxlbmFtZTogc3RyaXAgYDw+OlwiL1xcXFx8PypgIGFuZFxuICogY29udHJvbCBjaGFyYWN0ZXJzLCB0cmltIHdoaXRlc3BhY2UgYW5kIGVkZ2UgZG90cyAoV2luZG93cyBzZWdtZW50cyBtYXlcbiAqIG5vdCBlbmQgd2l0aCBgLmAgb3Igd2hpdGVzcGFjZSksIHRydW5jYXRlIHRvIDMwIGNvZGUgcG9pbnRzIChuZXZlciBzcGxpdHNcbiAqIGEgc3Vycm9nYXRlIHBhaXIpLiBSZXR1cm5zIGAndW5rbm93bidgIHdoZW4gbm90aGluZyBzdXJ2aXZlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNhbml0aXplRGV2aWNlTmFtZShuYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICBsZXQgY2xlYW5lZCA9IG5hbWUucmVwbGFjZShJTExFR0FMX0ZJTEVOQU1FX0NIQVJTLCAnJykucmVwbGFjZShDT05UUk9MX0NIQVJTLCAnJyk7XG4gIGNsZWFuZWQgPSBbLi4uY2xlYW5lZF0uc2xpY2UoMCwgTUFYX0RFVklDRV9OQU1FX0xFTkdUSCkuam9pbignJyk7XG4gIGNsZWFuZWQgPSBjbGVhbmVkLnRyaW0oKS5yZXBsYWNlKC9eWy5cXHNdK3xbLlxcc10rJC9nLCAnJyk7XG4gIHJldHVybiBjbGVhbmVkLmxlbmd0aCA9PT0gMCA/IEZBTExCQUNLX0RFVklDRV9OQU1FIDogY2xlYW5lZDtcbn1cblxuLyoqXG4gKiBDb21wdXRlIHRoZSBjb25mbGljdC1jb3B5IHBhdGggZm9yIGBwYXRoYC5cbiAqXG4gKiBQdXJlIGFuZCBkZXRlcm1pbmlzdGljOiB0aGUgc2FtZSBgKHBhdGgsIGRldmljZU5hbWUsIG5vdywgZXhpc3RzKWAgYWx3YXlzXG4gKiB5aWVsZHMgdGhlIHNhbWUgcmVzdWx0LiBgbm93YCBpcyB0aGUgY29uZmxpY3QncyBlcG9jaC1tcyB0aW1lc3RhbXAgKHRoZVxuICogY2FsbGVyIHBhc3NlcyBpdCBpbiBcdTIwMTQgbm8gaGlkZGVuIGNsb2Nrcyk7IGBleGlzdHNgIGlzIGNvbnN1bHRlZCBmb3JcbiAqIGNvbGxpc2lvbiBhdm9pZGFuY2UgYW5kIHR5cGljYWxseSBjaGVja3MgdGhlIGxvY2FsIGluZGV4IHBsdXMgdGhlIHJlbW90ZVxuICogbWFuaWZlc3QuXG4gKlxuICogVGhyb3dzIHdoZW4gbW9yZSB0aGFuIGBNQVhfQ09MTElTSU9OX1NVRkZJWGAgbmFtZSBjb2xsaXNpb25zIG9jY3VyIChhXG4gKiBnZW51aW5lbHkgcGF0aG9sb2dpY2FsIHZhdWx0IHN0YXRlIHRoZSBjYWxsZXIgc2hvdWxkIHN1cmZhY2UsIG5vdCBwYXBlclxuICogb3ZlcikuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb25mbGljdENvcHlQYXRoKFxuICBwYXRoOiBzdHJpbmcsXG4gIGRldmljZU5hbWU6IHN0cmluZyxcbiAgbm93OiBudW1iZXIsXG4gIGV4aXN0czogKGNhbmRpZGF0ZVBhdGg6IHN0cmluZykgPT4gYm9vbGVhbiA9ICgpID0+IGZhbHNlLFxuKTogc3RyaW5nIHtcbiAgY29uc3Qgbm9ybWFsaXplZCA9IG5vcm1hbGl6ZVZhdWx0UGF0aChwYXRoKTtcbiAgY29uc3QgZGlyID0gcGFyZW50UGF0aChub3JtYWxpemVkKTtcbiAgY29uc3QgbmFtZSA9IGJhc2VuYW1lKG5vcm1hbGl6ZWQpO1xuXG4gIGNvbnN0IGxhc3REb3QgPSBuYW1lLmxhc3RJbmRleE9mKCcuJyk7XG4gIGNvbnN0IGhhc0V4dGVuc2lvbiA9IGxhc3REb3QgPiAwOyAvLyBhIGxlYWRpbmcgZG90IG1hcmtzIGEgZG90ZmlsZSwgbm90IGFuIGV4dGVuc2lvblxuICBjb25zdCBzdGVtID0gaGFzRXh0ZW5zaW9uID8gbmFtZS5zbGljZSgwLCBsYXN0RG90KSA6IG5hbWU7XG4gIGNvbnN0IGV4dGVuc2lvbiA9IGhhc0V4dGVuc2lvbiA/IG5hbWUuc2xpY2UobGFzdERvdCkgOiAnJztcblxuICBjb25zdCBzdWZmaXggPSBgIChjb25mbGljdCAke2Zvcm1hdENvbmZsaWN0U3RhbXAobm93KX0gLSBmcm9tICR7c2FuaXRpemVEZXZpY2VOYW1lKGRldmljZU5hbWUpfSlgO1xuICBjb25zdCBqb2luID0gKGZpbGVOYW1lOiBzdHJpbmcpOiBzdHJpbmcgPT4gKGRpciA9PT0gJy8nID8gYC8ke2ZpbGVOYW1lfWAgOiBgJHtkaXJ9LyR7ZmlsZU5hbWV9YCk7XG5cbiAgbGV0IGNhbmRpZGF0ZSA9IGpvaW4oYCR7c3RlbX0ke3N1ZmZpeH0ke2V4dGVuc2lvbn1gKTtcbiAgZm9yIChsZXQgbiA9IDI7IG4gPD0gTUFYX0NPTExJU0lPTl9TVUZGSVg7IG4rKykge1xuICAgIGlmICghZXhpc3RzKGNhbmRpZGF0ZSkpIHJldHVybiBjYW5kaWRhdGU7XG4gICAgY2FuZGlkYXRlID0gam9pbihgJHtzdGVtfSR7c3VmZml4fSAke259JHtleHRlbnNpb259YCk7XG4gIH1cbiAgdGhyb3cgbmV3IEVycm9yKFxuICAgIGBjb25mbGljdENvcHlQYXRoOiBtb3JlIHRoYW4gJHtNQVhfQ09MTElTSU9OX1NVRkZJWH0gY29sbGlzaW9ucyBmb3IgJHtKU09OLnN0cmluZ2lmeShub3JtYWxpemVkKX1gLFxuICApO1xufVxuXG4vKiogYDIwMjYtMDgtMjAgMTQtMjNgIFx1MjAxNCBVVEMgZGF0ZSwgc3BhY2UsIHplcm8tcGFkZGVkIEhILW1tLiBNaW51dGVzLCBub3Qgc2Vjb25kcy4gKi9cbmZ1bmN0aW9uIGZvcm1hdENvbmZsaWN0U3RhbXAobm93OiBudW1iZXIpOiBzdHJpbmcge1xuICBjb25zdCBkID0gbmV3IERhdGUobm93KTtcbiAgY29uc3QgcGFkID0gKG46IG51bWJlcik6IHN0cmluZyA9PiBTdHJpbmcobikucGFkU3RhcnQoMiwgJzAnKTtcbiAgcmV0dXJuIChcbiAgICBgJHtkLmdldFVUQ0Z1bGxZZWFyKCl9LSR7cGFkKGQuZ2V0VVRDTW9udGgoKSArIDEpfS0ke3BhZChkLmdldFVUQ0RhdGUoKSl9YCArXG4gICAgYCAke3BhZChkLmdldFVUQ0hvdXJzKCkpfS0ke3BhZChkLmdldFVUQ01pbnV0ZXMoKSl9YFxuICApO1xufVxuIiwgIi8qKlxyXG4gKiBUaHJlZS13YXkgcmVjb25jaWxpYXRpb24gKEFSQ0hJVEVDVFVSRS5tZCBcdTAwQTc4IHN0ZXAgNCkuXHJcbiAqXHJcbiAqIGBjb21wdXRlU3luY1BsYW5gIGlzIGEgUFVSRSwgREVURVJNSU5JU1RJQyBmdW5jdGlvbjogdGhlIHNhbWUgaW5wdXRzIGFsd2F5c1xyXG4gKiBwcm9kdWNlIHRoZSBzYW1lIHBsYW4gKG1hbmlmZXN0IGFuZCBjaGFuZ2UgYnVja2V0cyBhcmUgcmUtc29ydGVkXHJcbiAqIGludGVybmFsbHk7IGBub3dgIGlzIGEgcGFyYW1ldGVyLCBuZXZlciByZWFkIGZyb20gYSBjbG9jaykuIEl0IGNvbXBhcmVzXHJcbiAqIHRocmVlIHN0YXRlcyBmb3IgZXZlcnkgcGF0aDpcclxuICpcclxuICogICAtIHRoZSAqKmxvY2FsIGluZGV4KiogXHUyMDE0IHdoYXQgdGhpcyBkZXZpY2UgbGFzdCBrbmV3IGFzIGF1dGhvcml0YXRpdmVcclxuICogICAgICh0aGUgXCJjb21tb24gYW5jZXN0b3JcIiBvZiB0aGUgdGhyZWUtd2F5IG1lcmdlKTtcclxuICogICAtIHRoZSAqKmxvY2FsIGNoYW5nZXMqKiBcdTIwMTQgaG93IGxvY2FsIHN0b3JhZ2UgZGl2ZXJnZWQgZnJvbSB0aGUgaW5kZXhcclxuICogICAgIHdoaWxlIG9mZmxpbmUgKGBzY2FuLnRzYCBvdXRwdXQpO1xyXG4gKiAgIC0gdGhlICoqbWFuaWZlc3QqKiBcdTIwMTQgdGhlIGF1dGhvcml0eSdzIGN1cnJlbnQgaGVhZCBwZXIgcGF0aC5cclxuICpcclxuICogYW5kIGVtaXRzIGEgYFN5bmNQbGFuYCAoc2hhcGUgZG9jdW1lbnRlZCBvbiB0aGUgaW50ZXJmYWNlKTogb3BzIHRvIHB1c2gsXHJcbiAqIG9wcyB0byBwdWxsLCBjb25mbGljdCByZXNvbHV0aW9ucywgYW5kIGZvbGRlciBwbGFjZWhvbGRlcnMgdG8gcHVzaC5cclxuICpcclxuICogQ29uZmxpY3QgYXJiaXRyYXRpb24gbWlycm9ycyB0aGUgRE8ncyBydWxlIChcdTAwQTc0KTogd2lubmVyID0gaGlnaGVyIGxvZ2ljYWxcclxuICogY2xvY2s7IHRpZSBcdTIxOTIgZ3JlYXRlciBkZXZpY2VJZC4gVGhlIGxvY2FsIHNpZGUncyAqdGVudGF0aXZlKiBjbG9jayBpc1xyXG4gKiBgbmV4dENsb2NrKGluZGV4IGNsb2NrLCB0aGlzRGV2aWNlSWQpYCBcdTIwMTQgZXhhY3RseSB0aGUgY291bnRlciB0aGUgRE8gd291bGRcclxuICogYXNzaWduIGEgY29tbWl0IGJ1aWxkaW5nIG9uIHRoZSBzYW1lIHBhcmVudCwgc28gdGhlIGNsaWVudCdzIHByZWRpY3Rpb25cclxuICogbWF0Y2hlcyB0aGUgc2VydmVyJ3MgYXJiaXRyYXRpb24uIFdoZW4gdGhlIHJlbW90ZSBzaWRlIHdpbnMsIHRoZSBsb3NpbmdcclxuICogbG9jYWwgY29udGVudCBpcyBwcmVzZXJ2ZWQgYnkgcHVzaGluZyBpdCB0byBhIGNvbmZsaWN0LWNvcHkgcGF0aFxyXG4gKiAoYGNvbmZsaWN0bmFtZXMudHNgKTsgd2hlbiB0aGUgbG9jYWwgc2lkZSB3aW5zLCB0aGUgY2xpZW50IHNpbXBseSBjb21taXRzXHJcbiAqIHdpdGggaXRzIChub3cgc3RhbGUpIHBhcmVudCB2ZXJzaW9uIGFuZCBsZXRzIHRoZSBzZXJ2ZXIgYXJiaXRyYXRlIFx1MjAxNCB0aGVcclxuICogc2VydmVyIHN5bnRoZXNpemVzIGFueSBjb25mbGljdCBjb3B5IGZvciB0aGUgbG9zaW5nIHJlbW90ZSBjb250ZW50LCB3aGljaFxyXG4gKiBhcnJpdmVzIGxhdGVyIGFzIGFuIG9yZGluYXJ5IGNoYW5nZSBldmVudC5cclxuICovXHJcblxyXG5pbXBvcnQgeyBjb21wYXJlQ2xvY2tzLCBuZXh0Q2xvY2sgfSBmcm9tICcuL2Nsb2NrLmpzJztcclxuaW1wb3J0IHsgY29uZmxpY3RDb3B5UGF0aCB9IGZyb20gJy4vY29uZmxpY3RuYW1lcy5qcyc7XHJcbmltcG9ydCB0eXBlIHsgTG9jYWxJbmRleCwgTG9jYWxJbmRleEVudHJ5IH0gZnJvbSAnLi9sb2NhbGluZGV4LmpzJztcclxuaW1wb3J0IHsgcGFyZW50UGF0aCB9IGZyb20gJy4vcGF0aHMuanMnO1xyXG5pbXBvcnQgdHlwZSB7IE1hbmlmZXN0RW50cnkgfSBmcm9tICcuL3Byb3RvY29sLmpzJztcclxuaW1wb3J0IHR5cGUgeyBEZWxldGVkQ2FuZGlkYXRlLCBMb2NhbENoYW5nZXMsIFJlbmFtZUNhbmRpZGF0ZSwgU2NhbkNhbmRpZGF0ZSB9IGZyb20gJy4vc2Nhbi5qcyc7XHJcbmltcG9ydCB0eXBlIHsgTG9naWNhbENsb2NrIH0gZnJvbSAnLi90eXBlcy5qcyc7XHJcblxyXG4vKipcclxuICogQSBtYW5pZmVzdCBlbnRyeSBhcyByZWNvbmNpbGlhdGlvbiBjb25zdW1lcyBpdC4gU2luY2UgYE1hbmlmZXN0RW50cnlgIGdyZXdcclxuICogYHBhdGhgLCBgY2xvY2tgLCBhbmQgYGlzRm9sZGVyYCAocHJvdG9jb2wgdjEsIHByZS1yZWxlYXNlKSwgdGhpcyBpcyBub3cgdGhlXHJcbiAqIG1hbmlmZXN0IGVudHJ5IGl0c2VsZiBcdTIwMTQga2VwdCBhcyBhIG5hbWVkIGFsaWFzIHNvIGBjb21wdXRlU3luY1BsYW5gJ3MgaW5wdXRcclxuICogY29udHJhY3Qgc3RheXMgc2VsZi1kb2N1bWVudGluZy5cclxuICovXHJcbmV4cG9ydCB0eXBlIFJlbW90ZUZpbGUgPSBNYW5pZmVzdEVudHJ5O1xyXG5cclxuLyoqIElucHV0IHRvIGBjb21wdXRlU3luY1BsYW5gLiAqL1xyXG5leHBvcnQgaW50ZXJmYWNlIFN5bmNQbGFuSW5wdXQge1xyXG4gIGxvY2FsQ2hhbmdlczogTG9jYWxDaGFuZ2VzO1xyXG4gIGluZGV4OiBMb2NhbEluZGV4O1xyXG4gIG1hbmlmZXN0OiByZWFkb25seSBSZW1vdGVGaWxlW107XHJcbiAgdGhpc0RldmljZUlkOiBzdHJpbmc7XHJcbiAgLyoqIEh1bWFuLXJlYWRhYmxlIG5hbWUgb2YgdGhpcyBkZXZpY2UgXHUyMDE0IHVzZWQgaW4gY29uZmxpY3QtY29weSBmaWxlIG5hbWVzLiAqL1xyXG4gIHRoaXNEZXZpY2VOYW1lOiBzdHJpbmc7XHJcbiAgLyoqIEVwb2NoIG1zIHVzZWQgZm9yIGNvbmZsaWN0LWNvcHkgdGltZXN0YW1wcyAocGFzc2VkIGluIGZvciBkZXRlcm1pbmlzbSkuICovXHJcbiAgbm93OiBudW1iZXI7XHJcbn1cclxuXHJcbi8qKiBXaHkgYSBwYXRoIHdlbnQgdGhyb3VnaCBjb25mbGljdCByZXNvbHV0aW9uLiAqL1xyXG5leHBvcnQgdHlwZSBDb25mbGljdFJlYXNvbiA9ICdjb25jdXJyZW50LWVkaXQnIHwgJ2FkZC12cy1hZGQnIHwgJ2RlbGV0ZS12cy1lZGl0JyB8ICdyZW5hbWUtcmFjZSc7XHJcblxyXG4vKipcclxuICogQSBjb21taXQgdGhpcyBkZXZpY2Ugc2hvdWxkIHNlbmQgKHBheWxvYWQgb2YgYSBwcm90b2NvbCBgY29tbWl0YCBtZXNzYWdlKS5cclxuICpcclxuICogYHBhcmVudFZlcnNpb25gIHNlbWFudGljczpcclxuICogICAtIGxvY2FsLW9ubHkgY2hhbmdlcyBhbmQgbG9jYWwtd2lucyBjb25mbGljdHMgbmFtZSB0aGUgKmluZGV4KiBoZWFkIChvclxyXG4gKiAgICAgYG51bGxgIGZvciBicmFuZC1uZXcgcGF0aHMpIFx1MjAxNCBkZWxpYmVyYXRlbHkgc3RhbGUgd2hlbiBhIGNvbmZsaWN0IHdhc1xyXG4gKiAgICAgcHJlZGljdGVkLCBzbyB0aGUgRE8gYXJiaXRyYXRlcyBhbmQgcHJlc2VydmVzIHRoZSBsb3NpbmcgcmVtb3RlXHJcbiAqICAgICBjb250ZW50IHNlcnZlci1zaWRlO1xyXG4gKiAgIC0gY29uZmxpY3QtY29weSBwdXNoZXMgbmFtZSB0aGUgKnJlbW90ZSogaGVhZCAoZmFzdC1wYXRoOiB0aGV5IGJ1aWxkIG9uXHJcbiAqICAgICB0aGUgd2lubmVyIGFuZCBtdXN0IG5vdCByZS1jb25mbGljdCkuXHJcbiAqL1xyXG5leHBvcnQgaW50ZXJmYWNlIFB1c2hGaWxlT3Age1xyXG4gIGtpbmQ6ICdhZGQnIHwgJ2VkaXQnIHwgJ2RlbGV0ZScgfCAncmVzdG9yZScgfCAnY29uZmxpY3RDb3B5JztcclxuICBwYXRoOiBzdHJpbmc7XHJcbiAgcGFyZW50VmVyc2lvbjogc3RyaW5nIHwgbnVsbDtcclxuICAvKiogQ29udGVudCBoYXNoOyBkZWxldGUgb3BzIHJldXNlIHRoZSBkZWxldGVkIGNvbnRlbnQncyBoYXNoLiAqL1xyXG4gIGhhc2g6IHN0cmluZztcclxuICBzaXplOiBudW1iZXI7XHJcbiAgLyoqIFRydWUgZm9yIGZvbGRlci10b21ic3RvbmUgZGVsZXRlcyAoYGhhc2ggJydgLCBzaXplIDApIFx1MjAxNCBGUi0xMCBsaWZlY3ljbGUuICovXHJcbiAgaXNGb2xkZXI/OiBib29sZWFuO1xyXG59XHJcblxyXG4vKiogQSBsb2NhbCByZW5hbWUgdG8gY29tbWl0IGFzIG9uZSBjaGFpbiBtaWdyYXRpb24gKEZSLTkpLiAqL1xyXG5leHBvcnQgaW50ZXJmYWNlIFB1c2hSZW5hbWVPcCB7XHJcbiAga2luZDogJ3JlbmFtZSc7XHJcbiAgZnJvbVBhdGg6IHN0cmluZztcclxuICB0b1BhdGg6IHN0cmluZztcclxuICAvKiogVmVyc2lvbiBvZiB0aGUgYGZyb21QYXRoYCBoZWFkIHRoaXMgcmVuYW1lIGJ1aWxkcyBvbi4gKi9cclxuICBwYXJlbnRWZXJzaW9uOiBzdHJpbmcgfCBudWxsO1xyXG4gIGhhc2g6IHN0cmluZztcclxuICBzaXplOiBudW1iZXI7XHJcbn1cclxuXHJcbmV4cG9ydCB0eXBlIFB1c2hPcCA9IFB1c2hGaWxlT3AgfCBQdXNoUmVuYW1lT3A7XHJcblxyXG4vKiogUmVtb3RlIGNvbnRlbnQgdGhpcyBkZXZpY2Ugc2hvdWxkIGZldGNoIGFuZCBtYXRlcmlhbGl6ZSB2aWEgYGFwcGx5UHVsbGAuICovXHJcbmV4cG9ydCBpbnRlcmZhY2UgUHVsbEZpbGVPcCB7XHJcbiAga2luZDogJ2FkZCcgfCAnZWRpdCcgfCAnZGVsZXRlJyB8ICdyZXN0b3JlJztcclxuICBwYXRoOiBzdHJpbmc7XHJcbiAgaGFzaDogc3RyaW5nO1xyXG4gIHNpemU6IG51bWJlcjtcclxuICB2ZXJzaW9uOiBzdHJpbmc7XHJcbiAgY2xvY2s6IExvZ2ljYWxDbG9jaztcclxuICAvKiogVHJ1ZSBmb3IgdG9tYnN0b25lcyAoa2luZCBgJ2RlbGV0ZSdgKS4gKi9cclxuICBkZWxldGVkOiBib29sZWFuO1xyXG4gIC8qKiBUcnVlIGZvciBlbXB0eS1mb2xkZXIgcGxhY2Vob2xkZXIgcHVsbHMgKEZSLTEwKSBcdTIwMTQgbWF0ZXJpYWxpemUgd2l0aCBgZW5zdXJlRGlyYC4gKi9cclxuICBpc0ZvbGRlcj86IGJvb2xlYW47XHJcbn1cclxuXHJcbi8qKiBBIHJlbW90ZSByZW5hbWUgdG8gZm9sbG93IGxvY2FsbHkgKGRldGVjdGVkIGJ5IGhhc2ggY29ycmVsYXRpb24pLiAqL1xyXG5leHBvcnQgaW50ZXJmYWNlIFB1bGxSZW5hbWVPcCB7XHJcbiAga2luZDogJ3JlbmFtZSc7XHJcbiAgZnJvbVBhdGg6IHN0cmluZztcclxuICB0b1BhdGg6IHN0cmluZztcclxuICBoYXNoOiBzdHJpbmc7XHJcbiAgc2l6ZTogbnVtYmVyO1xyXG4gIHZlcnNpb246IHN0cmluZztcclxuICBjbG9jazogTG9naWNhbENsb2NrO1xyXG4gIC8qKlxyXG4gICAqIFRydWUgd2hlbiB0aGUgcmVuYW1lZCBoZWFkIGlzIGEgZm9sZGVyIHBsYWNlaG9sZGVyIChGUi0xMCk6IHRoZSBvcCBtb3Zlc1xyXG4gICAqIERJUkVDVE9SWSBtZXRhZGF0YSBvbmx5IFx1MjAxNCBgaGFzaGAgaXMgYCcnYCBhbmQgbXVzdCBuZXZlciByZWFjaCBhIGNvbnRlbnRcclxuICAgKiBmZXRjaCAoYGVuZ2luZS50c2ApLlxyXG4gICAqL1xyXG4gIGlzRm9sZGVyPzogYm9vbGVhbjtcclxufVxyXG5cclxuZXhwb3J0IHR5cGUgUHVsbE9wID0gUHVsbEZpbGVPcCB8IFB1bGxSZW5hbWVPcDtcclxuXHJcbi8qKlxyXG4gKiBPbmUgYXJiaXRyYXRlZCBjb25mbGljdC4gYGxvc2VyQ29udGVudGAgaXMgYCdub25lJ2Agd2hlbiB0aGUgbG9zaW5nIHNpZGVcclxuICogd2FzIGEgZGVsZXRpb24gKG5vdGhpbmcgdG8gcHJlc2VydmUpLiBXaGVuIHRoZSBsb2NhbCBjb250ZW50IGxvc3QgYW5kIGhhZFxyXG4gKiBjb250ZW50LCBgY29uZmxpY3RDb3B5UGF0aGAgbmFtZXMgd2hlcmUgdGhlIHBsYW4gcHJlc2VydmVzIGl0ICh0aGUgcHVzaFxyXG4gKiBpdHNlbGYgaXMgaW4gYFN5bmNQbGFuLnB1c2hlc2Agd2l0aCBraW5kIGAnY29uZmxpY3RDb3B5J2ApLlxyXG4gKi9cclxuZXhwb3J0IGludGVyZmFjZSBDb25mbGljdE9wIHtcclxuICBwYXRoOiBzdHJpbmc7XHJcbiAgcmVhc29uOiBDb25mbGljdFJlYXNvbjtcclxuICB3aW5uZXI6ICdsb2NhbCcgfCAncmVtb3RlJztcclxuICBsb3NlckNvbnRlbnQ6ICdsb2NhbCcgfCAncmVtb3RlJyB8ICdub25lJztcclxuICBjb25mbGljdENvcHlQYXRoPzogc3RyaW5nO1xyXG4gIHJlbW90ZTogeyB2ZXJzaW9uOiBzdHJpbmc7IGhhc2g6IHN0cmluZzsgc2l6ZTogbnVtYmVyOyBkZWxldGVkOiBib29sZWFuOyBjbG9jazogTG9naWNhbENsb2NrIH07XHJcbiAgLyoqIFRoZSB0ZW50YXRpdmUgY2xvY2sgdGhlIGxvY2FsIHNpZGUgd2FzIGFyYml0cmF0ZWQgd2l0aC4gKi9cclxuICBsb2NhbENsb2NrOiBMb2dpY2FsQ2xvY2s7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBUaGUgY29tcGxldGUgcmVjb25jaWxpYXRpb24gcmVzdWx0IGZvciBvbmUgc3luYyBjeWNsZS4gT3BzIGFyZSBzb3J0ZWQgYnlcclxuICogdGFyZ2V0IHBhdGggKHJlbmFtZXMgYnkgYHRvUGF0aGApOyB0aGUgc29sZSBleGNlcHRpb246IHdpdGhpbiBhIHBhaXIgb2ZcclxuICogcHVsbCB0YXJnZXRzIGRpZmZlcmluZyBvbmx5IGJ5IG5hbWUgY2FzZSwgZGVsZXRlcyBzb3J0IGJlZm9yZSB3cml0ZXMgKHNlZVxyXG4gKiBgY29tcGFyZVB1bGxPcHNgIFx1MjAxNCBjYXNlLWluc2Vuc2l0aXZlLWZpbGVzeXN0ZW0gc2FmZXR5KS4gRXZlcnkgYXJyYXkgbWF5IGJlXHJcbiAqIGVtcHR5LiBgcHVzaGVzYCBhbmRcclxuICogYHB1bGxzYCBhcmUgaW5kZXBlbmRlbnQgXHUyMDE0IGEgcGF0aCBhcHBlYXJzIGF0IG1vc3Qgb25jZSBpbiBlYWNoLiBQdXNoZXMgYXJlXHJcbiAqIE5PVCBhcHBsaWVkIHRvIHRoZSBsb2NhbCBpbmRleCB1bnRpbCB0aGUgc2VydmVyIGFja3MgdGhlbTsgcHVsbHMgYXJlXHJcbiAqIGFwcGxpZWQgYnkgYGFwcGx5UHVsbGAgKGBlbmdpbmUudHNgKS5cclxuICovXHJcbmV4cG9ydCBpbnRlcmZhY2UgU3luY1BsYW4ge1xyXG4gIC8qKiBDb21taXRzIHRvIHNlbmQsIGluIG9yZGVyLiAqL1xyXG4gIHB1c2hlczogUHVzaE9wW107XHJcbiAgLyoqIFJlbW90ZSBjaGFuZ2VzIHRvIG1hdGVyaWFsaXplLCBpbiBvcmRlci4gKi9cclxuICBwdWxsczogUHVsbE9wW107XHJcbiAgLyoqIENvbmZsaWN0cyB0aGF0IHdlcmUgYXJiaXRyYXRlZCAoaW5mb3JtYXRpb25hbDsgc2lkZSBlZmZlY3RzIGxpdmUgaW4gcHVzaGVzL3B1bGxzKS4gKi9cclxuICBjb25mbGljdHM6IENvbmZsaWN0T3BbXTtcclxuICAvKiogRW1wdHktZm9sZGVyIHBsYWNlaG9sZGVyIHBhdGhzIHRvIGNyZWF0ZSByZW1vdGVseSAoRlItMTApLiAqL1xyXG4gIGZvbGRlclB1c2hlczogc3RyaW5nW107XHJcbn1cclxuXHJcbi8qKiBJbnRlcm5hbDogYSBsb2NhbCBjYW5kaWRhdGUgKGFkZGVkL21vZGlmaWVkL2RlbGV0ZWQpIHVuaWZpZWQgZm9yIHJlc29sdXRpb24uICovXHJcbmludGVyZmFjZSBMb2NhbENhbmRpZGF0ZSB7XHJcbiAgcGF0aDogc3RyaW5nO1xyXG4gIGtpbmQ6ICdhZGQnIHwgJ2VkaXQnIHwgJ3Jlc3RvcmUnIHwgJ2RlbGV0ZSc7XHJcbiAgaGFzaDogc3RyaW5nO1xyXG4gIHNpemU6IG51bWJlcjtcclxuICAvKiogRm9sZGVyLXBsYWNlaG9sZGVyIGRlbGV0aW9ucyAoYHNjYW4uZm9sZGVyRGVsZXRpb25zYCkgcmVzb2x2ZSBhcyB0b21ic3RvbmVzLiAqL1xyXG4gIGlzRm9sZGVyPzogYm9vbGVhbjtcclxufVxyXG5cclxuY29uc3QgWkVST19DTE9DSzogTG9naWNhbENsb2NrID0geyBjb3VudGVyOiAwLCBkZXZpY2VJZDogJycgfTtcclxuXHJcbi8qKlxyXG4gKiBDb21wdXRlIHRoZSBzeW5jIHBsYW4uIFNlZSB0aGUgbW9kdWxlIGRvYyBmb3IgdGhlIG1vZGVsIGFuZCB0aGUgb3BcclxuICogc2VtYW50aWNzLiBUaHJvd3Mgbm90aGluZyBvbiBvcmRpbmFyeSBkaXZlcmdlbmNlIFx1MjAxNCBjb25mbGljdHMgYXJlIGRhdGEsXHJcbiAqIG5vdCBlcnJvcnMuXHJcbiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gY29tcHV0ZVN5bmNQbGFuKGlucHV0OiBTeW5jUGxhbklucHV0KTogU3luY1BsYW4ge1xyXG4gIGNvbnN0IHsgbG9jYWxDaGFuZ2VzLCBpbmRleCwgdGhpc0RldmljZUlkLCB0aGlzRGV2aWNlTmFtZSwgbm93IH0gPSBpbnB1dDtcclxuICBjb25zdCBtYW5pZmVzdCA9IFsuLi5pbnB1dC5tYW5pZmVzdF0uc29ydCgoYSwgYikgPT4gY29tcGFyZVN0cmluZ3MoYS5wYXRoLCBiLnBhdGgpKTtcclxuICBjb25zdCBtYW5pZmVzdEJ5UGF0aCA9IG5ldyBNYXAobWFuaWZlc3QubWFwKChlbnRyeSkgPT4gW2VudHJ5LnBhdGgsIGVudHJ5XSkpO1xyXG5cclxuICBjb25zdCBwdXNoZXM6IFB1c2hPcFtdID0gW107XHJcbiAgY29uc3QgcHVsbHM6IFB1bGxPcFtdID0gW107XHJcbiAgY29uc3QgY29uZmxpY3RzOiBDb25mbGljdE9wW10gPSBbXTtcclxuXHJcbiAgLy8gRXZlcnkgcGF0aCB0aGUgbG9jYWwgc2lkZSBkaXZlcmdlZCBvbiAoc2NhbiBidWNrZXRzICsgYm90aCBlbmRzIG9mIHJlbmFtZXMpLlxyXG4gIGNvbnN0IGxvY2FsUGF0aHMgPSBuZXcgU2V0PHN0cmluZz4oKTtcclxuICBmb3IgKGNvbnN0IGMgb2YgbG9jYWxDaGFuZ2VzLmFkZGVkKSBsb2NhbFBhdGhzLmFkZChjLnBhdGgpO1xyXG4gIGZvciAoY29uc3QgYyBvZiBsb2NhbENoYW5nZXMubW9kaWZpZWQpIGxvY2FsUGF0aHMuYWRkKGMucGF0aCk7XHJcbiAgZm9yIChjb25zdCBkIG9mIGxvY2FsQ2hhbmdlcy5kZWxldGVkKSBsb2NhbFBhdGhzLmFkZChkLnBhdGgpO1xyXG4gIGZvciAoY29uc3QgciBvZiBsb2NhbENoYW5nZXMucmVuYW1lZCkge1xyXG4gICAgbG9jYWxQYXRocy5hZGQoci5mcm9tKTtcclxuICAgIGxvY2FsUGF0aHMuYWRkKHIudG8pO1xyXG4gIH1cclxuICBmb3IgKGNvbnN0IGYgb2YgbG9jYWxDaGFuZ2VzLmZvbGRlckRlbGV0aW9ucykgbG9jYWxQYXRocy5hZGQoZi5wYXRoKTtcclxuXHJcbiAgLy8gUGF0aHMgYWxyZWFkeSBjb25zdW1lZCBieSBhbiBlYXJsaWVyIHBoYXNlIChyZW5hbWUgY29ycmVsYXRpb24gZXRjLikuXHJcbiAgY29uc3QgY29uc3VtZWQgPSBuZXcgU2V0PHN0cmluZz4oKTtcclxuXHJcbiAgY29uc3QgcGF0aEV4aXN0cyA9IChwYXRoOiBzdHJpbmcpOiBib29sZWFuID0+IHBhdGggaW4gaW5kZXggfHwgbWFuaWZlc3RCeVBhdGguaGFzKHBhdGgpO1xyXG5cclxuICAvLyAtLS0gUGhhc2UgQTogbG9jYWwgcmVuYW1lcyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAvLyBVbmNvbnRlc3RlZDogb25lIFB1c2hSZW5hbWVPcC4gQ29udGVzdGVkIChyZW1vdGUgY2hhbmdlZCBhdCBlaXRoZXIgZW5kKTpcclxuICAvLyBkZWNvbXBvc2UgXHUyMDE0IHRoZSBgZnJvbWAgc2lkZSBpcyByZXNvbHZlZCBvbiBpdHMgb3duICh1c3VhbGx5IHRvbWJzdG9uZWRcclxuICAvLyBvciBwdWxsZWQpLCB0aGUgcmVuYW1lZCBjb250ZW50IGlzIHBsYWNlZCBhdCBgdG9gIHRocm91Z2ggdGhlIGdlbmVyaWNcclxuICAvLyBjb250ZW50IG1hY2hpbmVyeS4gQ29udGVudCBpcyBuZXZlciBsb3N0IGVpdGhlciB3YXkuXHJcbiAgZm9yIChjb25zdCByZW5hbWUgb2YgWy4uLmxvY2FsQ2hhbmdlcy5yZW5hbWVkXS5zb3J0KChhLCBiKSA9PiBjb21wYXJlU3RyaW5ncyhhLmZyb20sIGIuZnJvbSkpKSB7XHJcbiAgICBjb25zdCBpbmRleEZyb20gPSBpbmRleFtyZW5hbWUuZnJvbV07XHJcbiAgICBjb25zdCBpbmRleFRvID0gaW5kZXhbcmVuYW1lLnRvXTtcclxuICAgIGNvbnN0IHJlbW90ZUZyb20gPSBtYW5pZmVzdEJ5UGF0aC5nZXQocmVuYW1lLmZyb20pO1xyXG4gICAgY29uc3QgcmVtb3RlVG8gPSBtYW5pZmVzdEJ5UGF0aC5nZXQocmVuYW1lLnRvKTtcclxuXHJcbiAgICBjb25zdCBmcm9tQ2hhbmdlZCA9IHJlbW90ZUZyb21cclxuICAgICAgPyByZW1vdGVFbnRyeUNoYW5nZWQoaW5kZXhGcm9tLCByZW1vdGVGcm9tKVxyXG4gICAgICA6IGluZGV4RnJvbT8uZGVsZXRlZEF0ID09PSB1bmRlZmluZWQ7IC8vIGFic2VudCByZW1vdGVseSArIGxpdmUgbG9jYWxseSBcdTIxRDIgY2hhbmdlZFxyXG4gICAgY29uc3QgdG9DaGFuZ2VkID0gcmVtb3RlVG9cclxuICAgICAgPyByZW1vdGVFbnRyeUNoYW5nZWQoaW5kZXhUbywgcmVtb3RlVG8pXHJcbiAgICAgIDogZmFsc2U7IC8vIGFic2VudCByZW1vdGVseSBcdTIxRDIgbm90aGluZyB0byByYWNlIGF0IGB0b2BcclxuXHJcbiAgICBpZiAoIWZyb21DaGFuZ2VkICYmICF0b0NoYW5nZWQpIHtcclxuICAgICAgcHVzaGVzLnB1c2goe1xyXG4gICAgICAgIGtpbmQ6ICdyZW5hbWUnLFxyXG4gICAgICAgIGZyb21QYXRoOiByZW5hbWUuZnJvbSxcclxuICAgICAgICB0b1BhdGg6IHJlbmFtZS50byxcclxuICAgICAgICBwYXJlbnRWZXJzaW9uOiBpbmRleEZyb20/LnZlcnNpb25JZCA/PyBudWxsLFxyXG4gICAgICAgIGhhc2g6IHJlbmFtZS5oYXNoLFxyXG4gICAgICAgIHNpemU6IHJlbmFtZS5zaXplLFxyXG4gICAgICB9KTtcclxuICAgICAgY29udGludWU7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gYGZyb21gIHNpZGUgb2YgYSBjb250ZXN0ZWQgcmVuYW1lOlxyXG4gICAgaWYgKCFmcm9tQ2hhbmdlZCkge1xyXG4gICAgICAvLyBOb3RoaW5nIHJlbW90ZSB0aGVyZSBcdTIwMTQgdGhlIG1vdmUgaXRzZWxmIHJlbW92ZXMgdGhlIG9sZCBwYXRoLlxyXG4gICAgICBpZiAoaW5kZXhGcm9tICYmIGluZGV4RnJvbS5kZWxldGVkQXQgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHB1c2hlcy5wdXNoKHtcclxuICAgICAgICAgIGtpbmQ6ICdkZWxldGUnLFxyXG4gICAgICAgICAgcGF0aDogcmVuYW1lLmZyb20sXHJcbiAgICAgICAgICBwYXJlbnRWZXJzaW9uOiBpbmRleEZyb20udmVyc2lvbklkLFxyXG4gICAgICAgICAgaGFzaDogaW5kZXhGcm9tLmhhc2gsXHJcbiAgICAgICAgICBzaXplOiBpbmRleEZyb20uc2l6ZSxcclxuICAgICAgICB9KTtcclxuICAgICAgfVxyXG4gICAgfSBlbHNlIGlmICghcmVtb3RlRnJvbSB8fCByZW1vdGVGcm9tLmRlbGV0ZWQpIHtcclxuICAgICAgLy8gUmVtb3RlIGRlbGV0ZWQgKG9yIG1pZ3JhdGVkIGF3YXkgZnJvbSkgYGZyb21gIFx1MjAxNCBkZWxldGlvbiBzdGFuZHMgZm9yXHJcbiAgICAgIC8vIHRoZSBvbGQgcGF0aDsgdGhlIHJlbmFtZWQgY29udGVudCBzdXJ2aXZlcyBhdCBgdG9gLlxyXG4gICAgICBwdWxscy5wdXNoKFxyXG4gICAgICAgIHB1bGxGaWxlKCdkZWxldGUnLCByZW5hbWUuZnJvbSwge1xyXG4gICAgICAgICAgaGFzaDogcmVtb3RlRnJvbT8uaGFzaCA/PyBpbmRleEZyb20/Lmhhc2ggPz8gcmVuYW1lLmhhc2gsXHJcbiAgICAgICAgICBzaXplOiByZW1vdGVGcm9tPy5zaXplID8/IGluZGV4RnJvbT8uc2l6ZSA/PyByZW5hbWUuc2l6ZSxcclxuICAgICAgICAgIHZlcnNpb246IHJlbW90ZUZyb20/LnZlcnNpb24gPz8gJycsXHJcbiAgICAgICAgICBjbG9jazogcmVtb3RlRnJvbT8uY2xvY2sgPz8gaW5kZXhGcm9tPy5jbG9jayA/PyBaRVJPX0NMT0NLLFxyXG4gICAgICAgICAgZGVsZXRlZDogdHJ1ZSxcclxuICAgICAgICB9KSxcclxuICAgICAgKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIC8vIFJlbW90ZSBlZGl0ZWQgYGZyb21gLiBUaGUgcmVtb3RlIGVkaXQga2VlcHMgdGhlIG9sZCBwYXRoOyB0aGUgbW92ZWRcclxuICAgICAgLy8gY29udGVudCBpcyBwbGFjZWQgYXQgYHRvYCBiZWxvdyBcdTIwMTQgYSByZW5hbWUtcmFjZSB0aGUgbG9jYWwgc2lkZVxyXG4gICAgICAvLyBjb25jZWRlcyB1bmxlc3MgaXRzIGNsb2NrIHdpbnMgdGhlIHJlbmFtZSBwdXNoLlxyXG4gICAgICBjb25zdCBsb2NhbENsb2NrID0gbmV4dENsb2NrKGluZGV4RnJvbT8uY2xvY2ssIHRoaXNEZXZpY2VJZCk7XHJcbiAgICAgIGlmIChjb21wYXJlQ2xvY2tzKHJlbW90ZUZyb20uY2xvY2ssIGxvY2FsQ2xvY2spID4gMCkge1xyXG4gICAgICAgIHB1bGxzLnB1c2gocHVsbEZpbGUoJ2VkaXQnLCByZW5hbWUuZnJvbSwgcmVtb3RlRnJvbSkpO1xyXG4gICAgICAgIGNvbmZsaWN0cy5wdXNoKHtcclxuICAgICAgICAgIHBhdGg6IHJlbmFtZS5mcm9tLFxyXG4gICAgICAgICAgcmVhc29uOiAncmVuYW1lLXJhY2UnLFxyXG4gICAgICAgICAgd2lubmVyOiAncmVtb3RlJyxcclxuICAgICAgICAgIC8vIExvY2FsIGNvbnRlbnQgaXMgcHJlc2VydmVkIGJ5IHRoZSByZW5hbWUgaXRzZWxmIChwdXNoZWQgYXQgYHRvYCkuXHJcbiAgICAgICAgICBsb3NlckNvbnRlbnQ6ICdsb2NhbCcsXHJcbiAgICAgICAgICByZW1vdGU6IHJlbW90ZVN1bW1hcnkocmVtb3RlRnJvbSksXHJcbiAgICAgICAgICBsb2NhbENsb2NrLFxyXG4gICAgICAgIH0pO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIHB1c2hlcy5wdXNoKHtcclxuICAgICAgICAgIGtpbmQ6ICdyZW5hbWUnLFxyXG4gICAgICAgICAgZnJvbVBhdGg6IHJlbmFtZS5mcm9tLFxyXG4gICAgICAgICAgdG9QYXRoOiByZW5hbWUudG8sXHJcbiAgICAgICAgICBwYXJlbnRWZXJzaW9uOiBpbmRleEZyb20/LnZlcnNpb25JZCA/PyBudWxsLFxyXG4gICAgICAgICAgaGFzaDogcmVuYW1lLmhhc2gsXHJcbiAgICAgICAgICBzaXplOiByZW5hbWUuc2l6ZSxcclxuICAgICAgICB9KTtcclxuICAgICAgICBjb25mbGljdHMucHVzaCh7XHJcbiAgICAgICAgICBwYXRoOiByZW5hbWUuZnJvbSxcclxuICAgICAgICAgIHJlYXNvbjogJ3JlbmFtZS1yYWNlJyxcclxuICAgICAgICAgIHdpbm5lcjogJ2xvY2FsJyxcclxuICAgICAgICAgIGxvc2VyQ29udGVudDogJ3JlbW90ZScsXHJcbiAgICAgICAgICByZW1vdGU6IHJlbW90ZVN1bW1hcnkocmVtb3RlRnJvbSksXHJcbiAgICAgICAgICBsb2NhbENsb2NrLFxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGNvbnRpbnVlOyAvLyB0aGUgcmVuYW1lIHB1c2ggY2FycmllcyB0aGUgY29udGVudDsgbm8gYHRvYCBvcCBuZWVkZWRcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIC8vIGB0b2Agc2lkZSBvZiBhIGNvbnRlc3RlZCByZW5hbWU6XHJcbiAgICBpZiAoIXRvQ2hhbmdlZCkge1xyXG4gICAgICBwdXNoZXMucHVzaCh7XHJcbiAgICAgICAga2luZDogaW5kZXhUbz8uZGVsZXRlZEF0ICE9PSB1bmRlZmluZWQgPyAncmVzdG9yZScgOiAnYWRkJyxcclxuICAgICAgICBwYXRoOiByZW5hbWUudG8sXHJcbiAgICAgICAgcGFyZW50VmVyc2lvbjogaW5kZXhUbz8udmVyc2lvbklkID8/IG51bGwsXHJcbiAgICAgICAgaGFzaDogcmVuYW1lLmhhc2gsXHJcbiAgICAgICAgc2l6ZTogcmVuYW1lLnNpemUsXHJcbiAgICAgIH0pO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgcmVzb2x2ZUNvbnRlc3RlZFBhdGgocmVuYW1lLnRvLCBpbmRleFRvLCByZW1vdGVUbyBhcyBSZW1vdGVGaWxlLCB7XHJcbiAgICAgICAgcGF0aDogcmVuYW1lLnRvLFxyXG4gICAgICAgIGtpbmQ6IGluZGV4VG8/LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkID8gJ3Jlc3RvcmUnIDogJ2FkZCcsXHJcbiAgICAgICAgaGFzaDogcmVuYW1lLmhhc2gsXHJcbiAgICAgICAgc2l6ZTogcmVuYW1lLnNpemUsXHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLy8gLS0tIFBoYXNlIEI6IHJlbW90ZSByZW5hbWVzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbiAgLy8gQSBwYXRoIGxpdmUgaW4gdGhlIGluZGV4IGJ1dCBBQlNFTlQgZnJvbSB0aGUgbWFuaWZlc3Qgd2FzIG1pZ3JhdGVkIGJ5IHRoZVxyXG4gIC8vIGF1dGhvcml0eSAodG9tYnN0b25lcyBhcHBlYXIgaW4gdGhlIG1hbmlmZXN0IHdpdGggZGVsZXRlZDp0cnVlIFx1MjAxNCBvbmx5IGFcclxuICAvLyByZW5hbWUgcmVtb3ZlcyBhIHBhdGgpLiBDb3JyZWxhdGUgYnkgY29udGVudCBoYXNoIGFnYWluc3QgbmV3IG1hbmlmZXN0XHJcbiAgLy8gcGF0aHMsIHNhbWUtcGFyZW50IHByZWZlcnJlZCwgc21hbGxlc3QgcGF0aCB3aXRoaW4gYSBwcmVmZXJlbmNlIGNsYXNzLlxyXG4gIGZvciAoY29uc3QgZnJvbSBvZiBPYmplY3Qua2V5cyhpbmRleClcclxuICAgIC5maWx0ZXIoKHApID0+IHtcclxuICAgICAgY29uc3QgZW50cnkgPSBpbmRleFtwXSBhcyBMb2NhbEluZGV4RW50cnk7XHJcbiAgICAgIHJldHVybiBlbnRyeS5kZWxldGVkQXQgPT09IHVuZGVmaW5lZCAmJiAhZW50cnkuaXNGb2xkZXI7XHJcbiAgICB9KVxyXG4gICAgLnNvcnQoY29tcGFyZVN0cmluZ3MpKSB7XHJcbiAgICBpZiAobG9jYWxQYXRocy5oYXMoZnJvbSkgfHwgY29uc3VtZWQuaGFzKGZyb20pKSBjb250aW51ZTtcclxuICAgIGlmIChtYW5pZmVzdEJ5UGF0aC5oYXMoZnJvbSkpIGNvbnRpbnVlOyAvLyBwcmVzZW50IChsaXZlIG9yIHRvbWJzdG9uZWQpIFx1MjFEMiBub3QgbWlncmF0ZWRcclxuICAgIGNvbnN0IGVudHJ5ID0gaW5kZXhbZnJvbV0gYXMgTG9jYWxJbmRleEVudHJ5O1xyXG5cclxuICAgIGxldCBiZXN0OiBSZW1vdGVGaWxlIHwgdW5kZWZpbmVkO1xyXG4gICAgbGV0IGJlc3RTYW1lRGlyID0gZmFsc2U7XHJcbiAgICBmb3IgKGNvbnN0IGNhbmRpZGF0ZSBvZiBtYW5pZmVzdCkge1xyXG4gICAgICBpZiAoY2FuZGlkYXRlLmRlbGV0ZWQpIGNvbnRpbnVlO1xyXG4gICAgICBpZiAobG9jYWxQYXRocy5oYXMoY2FuZGlkYXRlLnBhdGgpIHx8IGNvbnN1bWVkLmhhcyhjYW5kaWRhdGUucGF0aCkpIGNvbnRpbnVlO1xyXG4gICAgICBjb25zdCBrbm93biA9IGluZGV4W2NhbmRpZGF0ZS5wYXRoXTtcclxuICAgICAgaWYgKGtub3duICE9PSB1bmRlZmluZWQgJiYga25vd24uZGVsZXRlZEF0ID09PSB1bmRlZmluZWQpIGNvbnRpbnVlOyAvLyB0YXJnZXQgbm90IG5ld1xyXG4gICAgICBpZiAoY2FuZGlkYXRlLmhhc2ggIT09IGVudHJ5Lmhhc2gpIGNvbnRpbnVlO1xyXG4gICAgICBjb25zdCBzYW1lRGlyID0gcGFyZW50UGF0aChjYW5kaWRhdGUucGF0aCkgPT09IHBhcmVudFBhdGgoZnJvbSk7XHJcbiAgICAgIGlmIChiZXN0ID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICBiZXN0ID0gY2FuZGlkYXRlO1xyXG4gICAgICAgIGJlc3RTYW1lRGlyID0gc2FtZURpcjtcclxuICAgICAgfSBlbHNlIGlmIChzYW1lRGlyICYmICFiZXN0U2FtZURpcikge1xyXG4gICAgICAgIGJlc3QgPSBjYW5kaWRhdGU7XHJcbiAgICAgICAgYmVzdFNhbWVEaXIgPSB0cnVlO1xyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGJlc3QpIHtcclxuICAgICAgcHVsbHMucHVzaCh7XHJcbiAgICAgICAga2luZDogJ3JlbmFtZScsXHJcbiAgICAgICAgZnJvbVBhdGg6IGZyb20sXHJcbiAgICAgICAgdG9QYXRoOiBiZXN0LnBhdGgsXHJcbiAgICAgICAgaGFzaDogYmVzdC5oYXNoLFxyXG4gICAgICAgIHNpemU6IGJlc3Quc2l6ZSxcclxuICAgICAgICB2ZXJzaW9uOiBiZXN0LnZlcnNpb24sXHJcbiAgICAgICAgY2xvY2s6IGJlc3QuY2xvY2ssXHJcbiAgICAgIH0pO1xyXG4gICAgICBjb25zdW1lZC5hZGQoZnJvbSk7XHJcbiAgICAgIGNvbnN1bWVkLmFkZChiZXN0LnBhdGgpO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgLy8gQWJzZW50IHdpdGhvdXQgY29ycmVsYXRpb246IHRoZSBhdXRob3JpdHkgbm8gbG9uZ2VyIGtub3dzIHRoZSBwYXRoLlxyXG4gICAgICAvLyBUcmVhdCBhcyBhIHJlbW90ZSBkZWxldGUgd2l0aCB1bmtub3duIGhlYWQgdmVyc2lvbiAoJycgXHUyMDE0IHRoZSBuZXh0XHJcbiAgICAgIC8vIGZ1bGwgbWFuaWZlc3QgaGVhbHMgdGhlIHZlcnNpb24gaWQpLiBUaGlzIGFsc28gY292ZXJzIHJlbW90ZVxyXG4gICAgICAvLyByZW5hbWUrZWRpdCwgd2hpY2ggZ2VudWluZWx5IGlzIGRlbGV0ZSArIGFkZC5cclxuICAgICAgcHVsbHMucHVzaChcclxuICAgICAgICBwdWxsRmlsZSgnZGVsZXRlJywgZnJvbSwge1xyXG4gICAgICAgICAgaGFzaDogZW50cnkuaGFzaCxcclxuICAgICAgICAgIHNpemU6IGVudHJ5LnNpemUsXHJcbiAgICAgICAgICB2ZXJzaW9uOiAnJyxcclxuICAgICAgICAgIGNsb2NrOiBlbnRyeS5jbG9jayxcclxuICAgICAgICAgIGRlbGV0ZWQ6IHRydWUsXHJcbiAgICAgICAgfSksXHJcbiAgICAgICk7XHJcbiAgICAgIGNvbnN1bWVkLmFkZChmcm9tKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8vIC0tLSBQaGFzZSBDOiByZW1haW5pbmcgcmVtb3RlLW9ubHkgY2hhbmdlcyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gIGZvciAoY29uc3QgcmVtb3RlIG9mIG1hbmlmZXN0KSB7XHJcbiAgICBpZiAobG9jYWxQYXRocy5oYXMocmVtb3RlLnBhdGgpIHx8IGNvbnN1bWVkLmhhcyhyZW1vdGUucGF0aCkpIGNvbnRpbnVlO1xyXG4gICAgY29uc3QgZW50cnkgPSBpbmRleFtyZW1vdGUucGF0aF07XHJcbiAgICBpZiAoIXJlbW90ZUVudHJ5Q2hhbmdlZChlbnRyeSwgcmVtb3RlKSkgY29udGludWU7XHJcbiAgICBpZiAoZW50cnkgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICBpZiAoIXJlbW90ZS5kZWxldGVkKSB7XHJcbiAgICAgICAgcHVsbHMucHVzaChwdWxsRmlsZSgnYWRkJywgcmVtb3RlLnBhdGgsIHJlbW90ZSkpO1xyXG4gICAgICAgIGNvbnN1bWVkLmFkZChyZW1vdGUucGF0aCk7XHJcbiAgICAgIH1cclxuICAgICAgLy8gZGVsZXRlZCArIG5ldmVyIGtub3duIGxvY2FsbHkgXHUyMUQyIG5vdGhpbmcgdG8gZG9cclxuICAgICAgY29udGludWU7XHJcbiAgICB9XHJcbiAgICBpZiAocmVtb3RlLmRlbGV0ZWQpIHtcclxuICAgICAgcHVsbHMucHVzaChwdWxsRmlsZSgnZGVsZXRlJywgcmVtb3RlLnBhdGgsIHJlbW90ZSkpOyAvLyBpbmNsdWRlcyB0b21ic3RvbmVcdTIxOTJ0b21ic3RvbmUgdmVyc2lvbiBjYXRjaC11cFxyXG4gICAgfSBlbHNlIGlmIChlbnRyeS5kZWxldGVkQXQgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICBwdWxscy5wdXNoKHB1bGxGaWxlKCdyZXN0b3JlJywgcmVtb3RlLnBhdGgsIHJlbW90ZSkpO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgcHVsbHMucHVzaChwdWxsRmlsZSgnZWRpdCcsIHJlbW90ZS5wYXRoLCByZW1vdGUpKTtcclxuICAgIH1cclxuICAgIGNvbnN1bWVkLmFkZChyZW1vdGUucGF0aCk7XHJcbiAgfVxyXG5cclxuICAvLyAtLS0gUGhhc2UgRDogbG9jYWwgY2FuZGlkYXRlcyAobG9jYWwtb25seSBwdXNoZXMgKyBib3RoLWNoYW5nZWQpIC0tLS0tLS1cclxuICBjb25zdCBjYW5kaWRhdGVzOiBMb2NhbENhbmRpZGF0ZVtdID0gW1xyXG4gICAgLi4ubG9jYWxDaGFuZ2VzLmFkZGVkLm1hcCgoYykgPT4gKHsgLi4uYywga2luZDogJ2FkZCcgYXMgY29uc3QgfSkpLFxyXG4gICAgLi4ubG9jYWxDaGFuZ2VzLm1vZGlmaWVkLm1hcCgoYykgPT4gKHtcclxuICAgICAgLi4uYyxcclxuICAgICAga2luZDogaW5kZXhbYy5wYXRoXT8uZGVsZXRlZEF0ICE9PSB1bmRlZmluZWQgPyAoJ3Jlc3RvcmUnIGFzIGNvbnN0KSA6ICgnZWRpdCcgYXMgY29uc3QpLFxyXG4gICAgfSkpLFxyXG4gICAgLi4ubG9jYWxDaGFuZ2VzLmRlbGV0ZWQubWFwKChkKTogTG9jYWxDYW5kaWRhdGUgPT4gKHsgLi4uZCwga2luZDogJ2RlbGV0ZScgfSkpLFxyXG4gICAgLy8gRm9sZGVyIHBsYWNlaG9sZGVycyB3aG9zZSBkaXJlY3RvcnkgdmFuaXNoZWQ6IHRvbWJzdG9uZSBwdXNoZXMuIFRoZXlcclxuICAgIC8vIGNhcnJ5IG5vIGNvbnRlbnQgKGhhc2ggJycvc2l6ZSAwKSBhbmQgY2FuIG5ldmVyIHBhaXIgd2l0aCBhbiBhZGQsIHNvXHJcbiAgICAvLyB0aGV5IGpvaW4gaGVyZSByYXRoZXIgdGhhbiB0aGUgYGRlbGV0ZWRgIGJ1Y2tldCAocmVuYW1lIGNvcnJlbGF0aW9uLFxyXG4gICAgLy8gY29uZmxpY3QgY29waWVzIFx1MjAxNCBuZWl0aGVyIGFwcGxpZXMgdG8gcGxhY2Vob2xkZXJzKS5cclxuICAgIC4uLmxvY2FsQ2hhbmdlcy5mb2xkZXJEZWxldGlvbnMubWFwKFxyXG4gICAgICAoZik6IExvY2FsQ2FuZGlkYXRlID0+ICh7XHJcbiAgICAgICAgcGF0aDogZi5wYXRoLFxyXG4gICAgICAgIGtpbmQ6ICdkZWxldGUnLFxyXG4gICAgICAgIGhhc2g6ICcnLFxyXG4gICAgICAgIHNpemU6IDAsXHJcbiAgICAgICAgaXNGb2xkZXI6IHRydWUsXHJcbiAgICAgIH0pLFxyXG4gICAgKSxcclxuICBdLnNvcnQoKGEsIGIpID0+IGNvbXBhcmVTdHJpbmdzKGEucGF0aCwgYi5wYXRoKSk7XHJcblxyXG4gIGZvciAoY29uc3QgY2FuZGlkYXRlIG9mIGNhbmRpZGF0ZXMpIHtcclxuICAgIGNvbnN0IGVudHJ5ID0gaW5kZXhbY2FuZGlkYXRlLnBhdGhdO1xyXG4gICAgY29uc3QgcmVtb3RlID0gbWFuaWZlc3RCeVBhdGguZ2V0KGNhbmRpZGF0ZS5wYXRoKTtcclxuICAgIGNvbnN0IHJlbW90ZUNoYW5nZWRIZXJlID1cclxuICAgICAgcmVtb3RlICE9PSB1bmRlZmluZWQgJiYgKGVudHJ5ICE9PSB1bmRlZmluZWQgPyByZW1vdGUudmVyc2lvbiAhPT0gZW50cnkudmVyc2lvbklkIDogIXJlbW90ZS5kZWxldGVkKTtcclxuICAgIGlmICghcmVtb3RlQ2hhbmdlZEhlcmUpIHtcclxuICAgICAgcHVzaExvY2FsKGNhbmRpZGF0ZSwgZW50cnkpO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgcmVzb2x2ZUNvbnRlc3RlZFBhdGgoY2FuZGlkYXRlLnBhdGgsIGVudHJ5LCByZW1vdGUgYXMgUmVtb3RlRmlsZSwgY2FuZGlkYXRlKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHJldHVybiB7XHJcbiAgICBwdXNoZXM6IHB1c2hlcy5zb3J0KChhLCBiKSA9PiBjb21wYXJlU3RyaW5ncyhvcFBhdGgoYSksIG9wUGF0aChiKSkpLFxyXG4gICAgcHVsbHM6IHB1bGxzLnNvcnQoY29tcGFyZVB1bGxPcHMpLFxyXG4gICAgY29uZmxpY3RzOiBjb25mbGljdHMuc29ydCgoYSwgYikgPT4gY29tcGFyZVN0cmluZ3MoYS5wYXRoLCBiLnBhdGgpKSxcclxuICAgIGZvbGRlclB1c2hlczogWy4uLmxvY2FsQ2hhbmdlcy5lbXB0eUZvbGRlcnNdLnNvcnQoY29tcGFyZVN0cmluZ3MpLFxyXG4gIH07XHJcblxyXG4gIC8vIC0tLSBoZWxwZXJzIChjbG9zZSBvdmVyIHRoZSBhY2N1bXVsYXRvcnMpIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cclxuICBmdW5jdGlvbiBwdXNoTG9jYWwoY2FuZGlkYXRlOiBMb2NhbENhbmRpZGF0ZSwgZW50cnk6IExvY2FsSW5kZXhFbnRyeSB8IHVuZGVmaW5lZCk6IHZvaWQge1xyXG4gICAgaWYgKGNhbmRpZGF0ZS5raW5kID09PSAnZGVsZXRlJykge1xyXG4gICAgICBwdXNoZXMucHVzaCh7XHJcbiAgICAgICAga2luZDogJ2RlbGV0ZScsXHJcbiAgICAgICAgcGF0aDogY2FuZGlkYXRlLnBhdGgsXHJcbiAgICAgICAgcGFyZW50VmVyc2lvbjogZW50cnk/LnZlcnNpb25JZCA/PyBudWxsLFxyXG4gICAgICAgIGhhc2g6IGVudHJ5Py5oYXNoID8/IGNhbmRpZGF0ZS5oYXNoLFxyXG4gICAgICAgIHNpemU6IGVudHJ5Py5zaXplID8/IGNhbmRpZGF0ZS5zaXplLFxyXG4gICAgICAgIC4uLihjYW5kaWRhdGUuaXNGb2xkZXIgPyB7IGlzRm9sZGVyOiB0cnVlIH0gOiB7fSksXHJcbiAgICAgIH0pO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBwdXNoZXMucHVzaCh7XHJcbiAgICAgIGtpbmQ6IGNhbmRpZGF0ZS5raW5kLFxyXG4gICAgICBwYXRoOiBjYW5kaWRhdGUucGF0aCxcclxuICAgICAgcGFyZW50VmVyc2lvbjogZW50cnk/LnZlcnNpb25JZCA/PyBudWxsLFxyXG4gICAgICBoYXNoOiBjYW5kaWRhdGUuaGFzaCxcclxuICAgICAgc2l6ZTogY2FuZGlkYXRlLnNpemUsXHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEJvdGggc2lkZXMgY2hhbmdlZCBvbmUgcGF0aC4gQXJiaXRyYXRlIHBlciBcdTAwQTc0LiBMb2NhbCBkZWxldGlvbnMgbmV2ZXIgZ2V0XHJcbiAgICogYSBjb25mbGljdCBjb3B5IChubyBjb250ZW50IHRvIHByZXNlcnZlKTsgbG9jYWwgKmNvbnRlbnQqIHRoYXQgbG9zZXMgaXNcclxuICAgKiBwcmVzZXJ2ZWQgdmlhIGEgY29uZmxpY3QtY29weSBwdXNoLlxyXG4gICAqL1xyXG4gIGZ1bmN0aW9uIHJlc29sdmVDb250ZXN0ZWRQYXRoKFxyXG4gICAgcGF0aDogc3RyaW5nLFxyXG4gICAgZW50cnk6IExvY2FsSW5kZXhFbnRyeSB8IHVuZGVmaW5lZCxcclxuICAgIHJlbW90ZTogUmVtb3RlRmlsZSxcclxuICAgIGxvY2FsOiBMb2NhbENhbmRpZGF0ZSxcclxuICApOiB2b2lkIHtcclxuICAgIGNvbnN0IGxvY2FsQ2xvY2sgPSBuZXh0Q2xvY2soZW50cnk/LmNsb2NrLCB0aGlzRGV2aWNlSWQpO1xyXG4gICAgY29uc3QgcmVtb3RlV2lucyA9IGNvbXBhcmVDbG9ja3MocmVtb3RlLmNsb2NrLCBsb2NhbENsb2NrKSA+IDA7IC8vIDAgXHUyMUQyIGxvY2FsIChkb2N1bWVudGVkKVxyXG4gICAgY29uc3Qgc3VtbWFyeSA9IHJlbW90ZVN1bW1hcnkocmVtb3RlKTtcclxuICAgIGNvbnN0IHJlYXNvbjogQ29uZmxpY3RSZWFzb24gPVxyXG4gICAgICBsb2NhbC5raW5kID09PSAnZGVsZXRlJyB8fCByZW1vdGUuZGVsZXRlZFxyXG4gICAgICAgID8gJ2RlbGV0ZS12cy1lZGl0J1xyXG4gICAgICAgIDogZW50cnkgPT09IHVuZGVmaW5lZFxyXG4gICAgICAgICAgPyAnYWRkLXZzLWFkZCdcclxuICAgICAgICAgIDogJ2NvbmN1cnJlbnQtZWRpdCc7XHJcblxyXG4gICAgaWYgKGxvY2FsLmtpbmQgPT09ICdkZWxldGUnICYmIHJlbW90ZS5kZWxldGVkKSB7XHJcbiAgICAgIC8vIEJvdGggZGVsZXRlZCBcdTIwMTQgY29udmVyZ2Ugc2lsZW50bHkgb24gdGhlIHJlbW90ZSB0b21ic3RvbmUuXHJcbiAgICAgIHB1bGxzLnB1c2gocHVsbEZpbGUoJ2RlbGV0ZScsIHBhdGgsIHJlbW90ZSkpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGxvY2FsLmtpbmQgPT09ICdkZWxldGUnKSB7XHJcbiAgICAgIC8vIExvY2FsIGRlbGV0ZSB2cyByZW1vdGUgZWRpdC5cclxuICAgICAgaWYgKHJlbW90ZVdpbnMpIHtcclxuICAgICAgICBwdWxscy5wdXNoKHB1bGxGaWxlKCdlZGl0JywgcGF0aCwgcmVtb3RlKSk7IC8vIGZpbGUgaXMgcmVjcmVhdGVkXHJcbiAgICAgICAgY29uZmxpY3RzLnB1c2goe1xyXG4gICAgICAgICAgcGF0aCwgcmVhc29uLCB3aW5uZXI6ICdyZW1vdGUnLCBsb3NlckNvbnRlbnQ6ICdub25lJyxcclxuICAgICAgICAgIHJlbW90ZTogc3VtbWFyeSwgbG9jYWxDbG9jayxcclxuICAgICAgICB9KTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBwdXNoZXMucHVzaCh7XHJcbiAgICAgICAgICBraW5kOiAnZGVsZXRlJyxcclxuICAgICAgICAgIHBhdGgsXHJcbiAgICAgICAgICBwYXJlbnRWZXJzaW9uOiBlbnRyeT8udmVyc2lvbklkID8/IG51bGwsXHJcbiAgICAgICAgICBoYXNoOiBlbnRyeT8uaGFzaCA/PyBsb2NhbC5oYXNoLFxyXG4gICAgICAgICAgc2l6ZTogZW50cnk/LnNpemUgPz8gbG9jYWwuc2l6ZSxcclxuICAgICAgICAgIC4uLihsb2NhbC5pc0ZvbGRlciA/IHsgaXNGb2xkZXI6IHRydWUgfSA6IHt9KSxcclxuICAgICAgICB9KTtcclxuICAgICAgICBjb25mbGljdHMucHVzaCh7XHJcbiAgICAgICAgICBwYXRoLCByZWFzb24sIHdpbm5lcjogJ2xvY2FsJywgbG9zZXJDb250ZW50OiAncmVtb3RlJyxcclxuICAgICAgICAgIHJlbW90ZTogc3VtbWFyeSwgbG9jYWxDbG9jayxcclxuICAgICAgICB9KTtcclxuICAgICAgfVxyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHJlbW90ZS5kZWxldGVkKSB7XHJcbiAgICAgIC8vIExvY2FsIGVkaXQgdnMgcmVtb3RlIGRlbGV0ZS5cclxuICAgICAgaWYgKHJlbW90ZVdpbnMpIHtcclxuICAgICAgICBwdWxscy5wdXNoKHB1bGxGaWxlKCdkZWxldGUnLCBwYXRoLCByZW1vdGUpKTtcclxuICAgICAgICBjb25mbGljdHMucHVzaCh7XHJcbiAgICAgICAgICBwYXRoLCByZWFzb24sIHdpbm5lcjogJ3JlbW90ZScsIGxvc2VyQ29udGVudDogJ2xvY2FsJyxcclxuICAgICAgICAgIGNvbmZsaWN0Q29weVBhdGg6IHB1c2hDb25mbGljdENvcHkocGF0aCwgbG9jYWwsIHJlbW90ZSksXHJcbiAgICAgICAgICByZW1vdGU6IHN1bW1hcnksIGxvY2FsQ2xvY2ssXHJcbiAgICAgICAgfSk7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgcHVzaGVzLnB1c2goe1xyXG4gICAgICAgICAga2luZDogbG9jYWwua2luZCxcclxuICAgICAgICAgIHBhdGgsXHJcbiAgICAgICAgICBwYXJlbnRWZXJzaW9uOiBlbnRyeT8udmVyc2lvbklkID8/IG51bGwsXHJcbiAgICAgICAgICBoYXNoOiBsb2NhbC5oYXNoLFxyXG4gICAgICAgICAgc2l6ZTogbG9jYWwuc2l6ZSxcclxuICAgICAgICB9KTtcclxuICAgICAgICBjb25mbGljdHMucHVzaCh7XHJcbiAgICAgICAgICBwYXRoLCByZWFzb24sIHdpbm5lcjogJ2xvY2FsJywgbG9zZXJDb250ZW50OiAnbm9uZScsXHJcbiAgICAgICAgICByZW1vdGU6IHN1bW1hcnksIGxvY2FsQ2xvY2ssXHJcbiAgICAgICAgfSk7XHJcbiAgICAgIH1cclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIENvbmN1cnJlbnQgY29udGVudCAoZWRpdC12cy1lZGl0IG9yIGFkZC12cy1hZGQpLlxyXG4gICAgaWYgKGxvY2FsLmhhc2ggPT09IHJlbW90ZS5oYXNoKSB7XHJcbiAgICAgIC8vIEJ5dGUtaWRlbnRpY2FsIGNvbnRlbnQgb24gYm90aCBzaWRlcyAoYSBzZWNvbmQgZGV2aWNlIHBhaXJpbmcgb3ZlclxyXG4gICAgICAvLyBmaWxlcyBpdCBhbHJlYWR5IGhhcywgb3IgYm90aCBzaWRlcyBtYWtpbmcgdGhlIHNhbWUgZWRpdCk6IG5vdGhpbmdcclxuICAgICAgLy8gZGlzdGluY3QgdG8gcHJlc2VydmUsIHNvIG5vIGNvbmZsaWN0IHJlY29yZCBhbmQgbm8gY29weSBcdTIwMTQgY29udmVyZ2VcclxuICAgICAgLy8gc2lsZW50bHkgb24gdGhlIHJlbW90ZSBoZWFkIHJlZ2FyZGxlc3Mgb2YgY2xvY2sgb3JkZXIgKG1pcnJvcnMgdGhlXHJcbiAgICAgIC8vIHNlcnZlcidzIGFyYml0cmF0aW9uLCB3aGljaCBzeW50aGVzaXplcyBubyBjb3B5IGZvciBpZGVudGljYWwgY29udGVudCkuXHJcbiAgICAgIHB1bGxzLnB1c2goXHJcbiAgICAgICAgcHVsbEZpbGUoZW50cnk/LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkID8gJ3Jlc3RvcmUnIDogZW50cnkgPT09IHVuZGVmaW5lZCA/ICdhZGQnIDogJ2VkaXQnLCBwYXRoLCByZW1vdGUpLFxyXG4gICAgICApO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBpZiAocmVtb3RlV2lucykge1xyXG4gICAgICBwdWxscy5wdXNoKFxyXG4gICAgICAgIHB1bGxGaWxlKGVudHJ5Py5kZWxldGVkQXQgIT09IHVuZGVmaW5lZCA/ICdyZXN0b3JlJyA6IGVudHJ5ID09PSB1bmRlZmluZWQgPyAnYWRkJyA6ICdlZGl0JywgcGF0aCwgcmVtb3RlKSxcclxuICAgICAgKTtcclxuICAgICAgY29uZmxpY3RzLnB1c2goe1xyXG4gICAgICAgIHBhdGgsIHJlYXNvbiwgd2lubmVyOiAncmVtb3RlJywgbG9zZXJDb250ZW50OiAnbG9jYWwnLFxyXG4gICAgICAgIGNvbmZsaWN0Q29weVBhdGg6IHB1c2hDb25mbGljdENvcHkocGF0aCwgbG9jYWwsIHJlbW90ZSksXHJcbiAgICAgICAgcmVtb3RlOiBzdW1tYXJ5LCBsb2NhbENsb2NrLFxyXG4gICAgICB9KTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIHB1c2hlcy5wdXNoKHtcclxuICAgICAgICBraW5kOiBsb2NhbC5raW5kLFxyXG4gICAgICAgIHBhdGgsXHJcbiAgICAgICAgLy8gRGVsaWJlcmF0ZWx5IHRoZSAoc3RhbGUpIGluZGV4IHBhcmVudDogdGhlIERPIG11c3QgYXJiaXRyYXRlIGFuZFxyXG4gICAgICAgIC8vIHN5bnRoZXNpemUgdGhlIGNvbmZsaWN0IGNvcHkgZm9yIHRoZSBsb3NpbmcgcmVtb3RlIGNvbnRlbnQuXHJcbiAgICAgICAgcGFyZW50VmVyc2lvbjogZW50cnk/LnZlcnNpb25JZCA/PyBudWxsLFxyXG4gICAgICAgIGhhc2g6IGxvY2FsLmhhc2gsXHJcbiAgICAgICAgc2l6ZTogbG9jYWwuc2l6ZSxcclxuICAgICAgfSk7XHJcbiAgICAgIGNvbmZsaWN0cy5wdXNoKHtcclxuICAgICAgICBwYXRoLCByZWFzb24sIHdpbm5lcjogJ2xvY2FsJywgbG9zZXJDb250ZW50OiAncmVtb3RlJyxcclxuICAgICAgICByZW1vdGU6IHN1bW1hcnksIGxvY2FsQ2xvY2ssXHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogUHVzaCB0aGUgbG9zaW5nIGxvY2FsIGNvbnRlbnQgdG8gYSBjb25mbGljdC1jb3B5IHBhdGg7IHJldHVybnMgdGhlIHBhdGgsXHJcbiAgICogb3IgYHVuZGVmaW5lZGAgd2hlbiB0aGUgbG9zaW5nIGNvbnRlbnQgaXMgYnl0ZS1pZGVudGljYWwgdG8gdGhlIHdpbm5lcidzXHJcbiAgICogKGEgc2FtZS1jb250ZW50IHJhY2UgXHUyMDE0IG5vdGhpbmcgZGlzdGluY3QgdG8gcHJlc2VydmU7IG1hdGNoZXMgdGhlIHNlcnZlcidzXHJcbiAgICogYXJiaXRyYXRpb24sIHdoaWNoIGxpa2V3aXNlIHN5bnRoZXNpemVzIG5vIGNvcHkgZm9yIGlkZW50aWNhbCBjb250ZW50KS5cclxuICAgKi9cclxuICBmdW5jdGlvbiBwdXNoQ29uZmxpY3RDb3B5KHBhdGg6IHN0cmluZywgbG9jYWw6IExvY2FsQ2FuZGlkYXRlLCByZW1vdGU6IFJlbW90ZUZpbGUpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xyXG4gICAgaWYgKGxvY2FsLmhhc2ggPT09IHJlbW90ZS5oYXNoKSByZXR1cm4gdW5kZWZpbmVkO1xyXG4gICAgY29uc3QgY29weVBhdGggPSBjb25mbGljdENvcHlQYXRoKHBhdGgsIHRoaXNEZXZpY2VOYW1lLCBub3csIHBhdGhFeGlzdHMpO1xyXG4gICAgcHVzaGVzLnB1c2goe1xyXG4gICAgICBraW5kOiAnY29uZmxpY3RDb3B5JyxcclxuICAgICAgcGF0aDogY29weVBhdGgsXHJcbiAgICAgIC8vIEJ1aWxkIG9uIHRoZSB3aW5uaW5nIHJlbW90ZSBoZWFkOiB0aGlzIHB1c2ggbXVzdCBmYXN0LXBhdGguXHJcbiAgICAgIHBhcmVudFZlcnNpb246IHJlbW90ZS52ZXJzaW9uLFxyXG4gICAgICBoYXNoOiBsb2NhbC5oYXNoLFxyXG4gICAgICBzaXplOiBsb2NhbC5zaXplLFxyXG4gICAgfSk7XHJcbiAgICByZXR1cm4gY29weVBhdGg7XHJcbiAgfVxyXG59XHJcblxyXG4vLyAtLS0gbW9kdWxlLWxldmVsIGhlbHBlcnMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblxyXG5mdW5jdGlvbiBwdWxsRmlsZShcclxuICBraW5kOiBQdWxsRmlsZU9wWydraW5kJ10sXHJcbiAgcGF0aDogc3RyaW5nLFxyXG4gIHJlbW90ZTogUGljazxSZW1vdGVGaWxlLCAnaGFzaCcgfCAnc2l6ZScgfCAndmVyc2lvbicgfCAnY2xvY2snIHwgJ2lzRm9sZGVyJz4gJiB7XHJcbiAgICBkZWxldGVkPzogYm9vbGVhbjtcclxuICB9LFxyXG4pOiBQdWxsRmlsZU9wIHtcclxuICByZXR1cm4ge1xyXG4gICAga2luZCxcclxuICAgIHBhdGgsXHJcbiAgICBoYXNoOiByZW1vdGUuaGFzaCxcclxuICAgIHNpemU6IHJlbW90ZS5zaXplLFxyXG4gICAgdmVyc2lvbjogcmVtb3RlLnZlcnNpb24sXHJcbiAgICBjbG9jazogcmVtb3RlLmNsb2NrLFxyXG4gICAgZGVsZXRlZDogcmVtb3RlLmRlbGV0ZWQgPz8ga2luZCA9PT0gJ2RlbGV0ZScsXHJcbiAgICAuLi4ocmVtb3RlLmlzRm9sZGVyID8geyBpc0ZvbGRlcjogdHJ1ZSB9IDoge30pLFxyXG4gIH07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHJlbW90ZVN1bW1hcnkocmVtb3RlOiBSZW1vdGVGaWxlKTogQ29uZmxpY3RPcFsncmVtb3RlJ10ge1xyXG4gIHJldHVybiB7XHJcbiAgICB2ZXJzaW9uOiByZW1vdGUudmVyc2lvbixcclxuICAgIGhhc2g6IHJlbW90ZS5oYXNoLFxyXG4gICAgc2l6ZTogcmVtb3RlLnNpemUsXHJcbiAgICBkZWxldGVkOiByZW1vdGUuZGVsZXRlZCxcclxuICAgIGNsb2NrOiByZW1vdGUuY2xvY2ssXHJcbiAgfTtcclxufVxyXG5cclxuLyoqXHJcbiAqIFdoZXRoZXIgdGhlIHJlbW90ZSBoZWFkIGZvciBhIHBhdGggZGlmZmVycyBmcm9tIHdoYXQgdGhlIGluZGV4IHJlY29yZHMuXHJcbiAqIFZlcnNpb24gaWRzIGFyZSB0aGUgcHJpbWFyeSBzaWduYWwgKGNsaWVudCBhbmQgRE8gc2hhcmUgb25lIGlkIHNwYWNlKTtcclxuICogYSBwYXRoIGFic2VudCByZW1vdGVseSBjb3VudHMgYXMgY2hhbmdlZCBvbmx5IHdoaWxlIHRoZSBpbmRleCBzdGlsbCBob2xkc1xyXG4gKiBpdCBsaXZlIFx1MjAxNCBjYWxsZXJzIGRlY2lkZSB3aGF0IGFic2VuY2UgKm1lYW5zKiAocmVuYW1lIHZzIGRlbGV0ZSkuXHJcbiAqL1xyXG5mdW5jdGlvbiByZW1vdGVFbnRyeUNoYW5nZWQoXHJcbiAgZW50cnk6IExvY2FsSW5kZXhFbnRyeSB8IHVuZGVmaW5lZCxcclxuICByZW1vdGU6IFJlbW90ZUZpbGUgfCB1bmRlZmluZWQsXHJcbik6IGJvb2xlYW4ge1xyXG4gIGlmIChyZW1vdGUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIGZhbHNlO1xyXG4gIGlmIChlbnRyeSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gIXJlbW90ZS5kZWxldGVkO1xyXG4gIHJldHVybiByZW1vdGUudmVyc2lvbiAhPT0gZW50cnkudmVyc2lvbklkO1xyXG59XHJcblxyXG5mdW5jdGlvbiBvcFBhdGgob3A6IFB1c2hPcCB8IFB1bGxPcCk6IHN0cmluZyB7XHJcbiAgcmV0dXJuIG9wLmtpbmQgPT09ICdyZW5hbWUnID8gb3AudG9QYXRoIDogb3AucGF0aDtcclxufVxyXG5cclxuLyoqXHJcbiAqIERldGVybWluaXN0aWMgcHVsbCBvcmRlciAoYnkgdGFyZ2V0IHBhdGgpLCB3aXRoIE9ORSBjYXJ2ZS1vdXQgZm9yXHJcbiAqIGNhc2UtaW5zZW5zaXRpdmUgZmlsZXN5c3RlbXMgKFdpbmRvd3MsIG1hY09TKTogd2hlbiB0d28gcHVsbCB0YXJnZXRzXHJcbiAqIGRpZmZlciBvbmx5IGJ5IG5hbWUgY2FzZSBcdTIwMTQgZS5nLiBhIHJlbmFtZStlZGl0IHRoYXQgZGVjb21wb3NlZCBpbnRvXHJcbiAqIGBwdWxsIGFkZCAnL05PVEUubWQnYCArIGBwdWxsIGRlbGV0ZSAnL05vdGUubWQnYCBcdTIwMTQgdGhlIERFTEVURSBtdXN0IGFwcGx5XHJcbiAqIGZpcnN0LiBBcHBsaWVkIGFkZC1maXJzdCwgdGhlIGFkZCdzIGF0b21pYyB0ZW1wK3JlbmFtZSB3cml0ZSBwaHlzaWNhbGx5XHJcbiAqIHJlcGxhY2VzIHRoZSBvbGQtY2FzZSBmaWxlLCBhbmQgdGhlIHN1YnNlcXVlbnQgZGVsZXRlIHRoZW4gZmluZHMgYW5kXHJcbiAqIHJlbW92ZXMgdGhlIGp1c3Qtd3JpdHRlbiBmaWxlIChhZGFwdGVycyByZXNvbHZlIHBhdGhzIGNhc2UtaW5zZW5zaXRpdmVseSksXHJcbiAqIGxlYXZpbmcgZGlzayBlbXB0eSB3aGlsZSB0aGUgaW5kZXggaG9sZHMgdGhlIG5ldyBwYXRoIGxpdmUgXHUyMDE0IHRoZSBuZXh0IHNjYW5cclxuICogd291bGQgcHVzaCB0aGF0IHBoYW50b20gZGVsZXRpb24gdmF1bHQtd2lkZS4gRGVsZXRlLWZpcnN0IGlzIHNhZmUgb24gYm90aFxyXG4gKiBmaWxlc3lzdGVtIGNsYXNzZXM6IG9uIGEgY2FzZS1zZW5zaXRpdmUgYWRhcHRlciB0aGUgdHdvIHBhdGhzIGFyZSBkaXN0aW5jdFxyXG4gKiBmaWxlcywgc28gcmVsYXRpdmUgb3JkZXIgZG9lcyBub3QgbWF0dGVyOyBvbmx5IHRoZSBjYXNlLWNvbGxpZGluZyBwYWlyIGlzXHJcbiAqIHJlb3JkZXJlZCwgZXZlcnkgb3RoZXIgcGFpciBrZWVwcyB0aGUgZXhhY3QtcGF0aCBzb3J0LlxyXG4gKi9cclxuZnVuY3Rpb24gY29tcGFyZVB1bGxPcHMoYTogUHVsbE9wLCBiOiBQdWxsT3ApOiBudW1iZXIge1xyXG4gIGNvbnN0IGJ5RXhhY3QgPSBjb21wYXJlU3RyaW5ncyhvcFBhdGgoYSksIG9wUGF0aChiKSk7XHJcbiAgaWYgKGJ5RXhhY3QgPT09IDApIHJldHVybiAwO1xyXG4gIGlmIChvcFBhdGgoYSkudG9Mb3dlckNhc2UoKSAhPT0gb3BQYXRoKGIpLnRvTG93ZXJDYXNlKCkpIHJldHVybiBieUV4YWN0O1xyXG4gIC8vIENhc2UtY29sbGlkaW5nIHBhaXI6IGRlbGV0ZXMgYmVmb3JlIHdyaXRlcyAoYWRkL2VkaXQvcmVuYW1lL3Jlc3RvcmUpLlxyXG4gIGNvbnN0IGFEZWxldGVzID0gYS5raW5kID09PSAnZGVsZXRlJztcclxuICBjb25zdCBiRGVsZXRlcyA9IGIua2luZCA9PT0gJ2RlbGV0ZSc7XHJcbiAgaWYgKGFEZWxldGVzICE9PSBiRGVsZXRlcykgcmV0dXJuIGFEZWxldGVzID8gLTEgOiAxO1xyXG4gIHJldHVybiBieUV4YWN0O1xyXG59XHJcblxyXG5mdW5jdGlvbiBjb21wYXJlU3RyaW5ncyhhOiBzdHJpbmcsIGI6IHN0cmluZyk6IG51bWJlciB7XHJcbiAgcmV0dXJuIGEgPCBiID8gLTEgOiBhID4gYiA/IDEgOiAwO1xyXG59XHJcbiIsICIvKipcbiAqIExvY2FsIGNoYW5nZSBkZXRlY3Rpb24gKEFSQ0hJVEVDVFVSRS5tZCBcdTAwQTc4IHN0ZXAgMykuXG4gKlxuICogYHNjYW5WYXVsdGAgd2Fsa3MgdGhlIHN0b3JhZ2UgYWRhcHRlciwgYXBwbGllcyB0aGUgc2hhcmVkIGlnbm9yZSBydWxlcyxcbiAqIGhhc2hlcyBub24taWdub3JlZCBmaWxlcyAoc2hhMjU2IFx1MjAxNCBzYW1lIGFzIGJsb2IgYWRkcmVzc2luZykgYW5kIGRpZmZzXG4gKiB0aGUgcmVzdWx0IGFnYWluc3QgdGhlIGNsaWVudCdzIGBMb2NhbEluZGV4YC4gVGhlIGRpZmYgY2xhc3NpZmllczpcbiAqXG4gKiAgIC0gYGFkZGVkYCAgICBcdTIwMTQgZmlsZSBwcmVzZW50LCBwYXRoIHVua25vd24gdG8gdGhlIGluZGV4O1xuICogICAtIGBtb2RpZmllZGAgXHUyMDE0IGZpbGUgcHJlc2VudCwgY29udGVudCBoYXNoIGRpZmZlcnMgZnJvbSB0aGUgaW5kZXggZW50cnkuXG4gKiAgICAgICAgICAgICAgICAgIEEgZmlsZSB3aG9zZSBpbmRleCBlbnRyeSBpcyBhICp0b21ic3RvbmUqIGFsc28gbGFuZHMgaGVyZVxuICogICAgICAgICAgICAgICAgICAoZG9jdW1lbnRlZCBkZWNpc2lvbik6IHdoZXRoZXIgaXQgaXMgYW4gZWRpdC1vZi1kZWxldGVkXG4gKiAgICAgICAgICAgICAgICAgIG9yIGEgcHVyZSByZXN1cnJlY3QsIHRoZSByZXNvbHV0aW9uIGlzIGlkZW50aWNhbCBcdTIwMTQgbG9jYWxcbiAqICAgICAgICAgICAgICAgICAgY29udGVudCBleGlzdHMgdGhhdCB0aGUgaW5kZXggaGVhZCBkb2VzIG5vdCByZWZsZWN0O1xuICogICAtIGBkZWxldGVkYCAgXHUyMDE0IGluZGV4IGVudHJ5IGxpdmUsIGZpbGUgZ29uZTtcbiAqICAgLSBgcmVuYW1lZGAgIFx1MjAxNCBhIGRlbGV0ZSArIGFkZCBwYWlyICp3aXRoaW4gb25lIHNjYW4qIHdob3NlIGNvbnRlbnRcbiAqICAgICAgICAgICAgICAgICAgaGFzaGVzIG1hdGNoIChBUkNISVRFQ1RVUkUgXHUwMEE3NCByZW5hbWUgY29ycmVsYXRpb24pLiBBXG4gKiAgICAgICAgICAgICAgICAgIHJlbmFtZSB3aG9zZSBjb250ZW50IGFsc28gY2hhbmdlZCAocmVuYW1lICsgZWRpdCkgbm9cbiAqICAgICAgICAgICAgICAgICAgbG9uZ2VyIGNvcnJlbGF0ZXMgYW5kIGZhbGxzIGJhY2sgdG8gZGVsZXRlICsgYWRkIFx1MjAxNCB0aGF0XG4gKiAgICAgICAgICAgICAgICAgIGlzIHRoZSBkb2N1bWVudGVkLCBjb3JyZWN0IHYxIGJlaGF2aW9yO1xuICogICAtIGBlbXB0eUZvbGRlcnNgIFx1MjAxNCBkaXJlY3RvcmllcyBleGlzdGluZyBpbiBzdG9yYWdlIGJ1dCByZXByZXNlbnRlZFxuICogICAgICAgICAgICAgICAgICBuZWl0aGVyIGJ5IGEgbGl2ZSBmb2xkZXIgcGxhY2Vob2xkZXIgaW4gdGhlIGluZGV4IG5vciBieVxuICogICAgICAgICAgICAgICAgICBhbnkgZmlsZSBiZW5lYXRoIHRoZW0gKEZSLTEwKTtcbiAqICAgLSBgZm9sZGVyRGVsZXRpb25zYCBcdTIwMTQgbGl2ZSBmb2xkZXIgcGxhY2Vob2xkZXIgZW50cmllcyB3aG9zZSBkaXJlY3RvcnlcbiAqICAgICAgICAgICAgICAgICAgbm8gbG9uZ2VyIGV4aXN0cyBpbiBzdG9yYWdlOiB0aGUgdXNlciBkZWxldGVkIGFuIGVtcHR5XG4gKiAgICAgICAgICAgICAgICAgIGZvbGRlciAob3IgcHJ1bmUtb24tZGVsZXRlIHJlbW92ZWQgaXQsIGBlbmdpbmUudHNgKSwgYW5kXG4gKiAgICAgICAgICAgICAgICAgIHRoZSBkZWxldGlvbiBtdXN0IHByb3BhZ2F0ZSBhcyBhIGZvbGRlciB0b21ic3RvbmUuIFRoZVxuICogICAgICAgICAgICAgICAgICBidWNrZXQgaXMgU0VQQVJBVEUgZnJvbSBgZGVsZXRlZGAgb24gcHVycG9zZTogZm9sZGVyXG4gKiAgICAgICAgICAgICAgICAgIHBsYWNlaG9sZGVycyBjYXJyeSBubyBjb250ZW50IGhhc2gsIG11c3QgbmV2ZXIgZW50ZXJcbiAqICAgICAgICAgICAgICAgICAgcmVuYW1lIGNvcnJlbGF0aW9uLCBhbmQgcmVzb2x2ZSBhcyBwbGFjZWhvbGRlcnNcbiAqICAgICAgICAgICAgICAgICAgKGBpc0ZvbGRlcmApIGRvd25zdHJlYW0uIEEgcGxhY2Vob2xkZXIgdGhhdCBtZXJlbHkgYmVjYW1lXG4gKiAgICAgICAgICAgICAgICAgIGlnbm9yZWQgKHNldHRpbmdzIGNoYW5nZSkgaXMgTk9UIGEgZGVsZXRpb24gXHUyMDE0IGl0IGlzXG4gKiAgICAgICAgICAgICAgICAgIHNraXBwZWQsIGV4YWN0bHkgbGlrZSBpZ25vcmVkIGZpbGVzLlxuICogICAtIGBzdGFsZURpcnNgIFx1MjAxNCBkaXJlY3RvcmllcyB3aG9zZSBpbmRleCBlbnRyeSBpcyBhIFRPTUJTVE9ORUQgZm9sZGVyXG4gKiAgICAgICAgICAgICAgICAgIHBsYWNlaG9sZGVyIHdoaWxlIGFuIEVNUFRZIGRpcmVjdG9yeSBzdGlsbCBleGlzdHMgb24gZGlza1xuICogICAgICAgICAgICAgICAgICBBTkQgdGhlIHRvbWJzdG9uZSB3YXMgYXV0aG9yZWQgYnkgQU5PVEhFUiBkZXZpY2U6IHRoZVxuICogICAgICAgICAgICAgICAgICByZXNpZHVlIG9mIGEgcmVjb3JkLW9ubHkgdG9tYnN0b25lIGFwcGxpY2F0aW9uIChhbiBhZGFwdGVyXG4gKiAgICAgICAgICAgICAgICAgIHdpdGhvdXQgYHJlbW92ZURpcmAsIG9yIGEgcmVtb3ZhbCB0aGF0IGxvc3QgYSByYWNlKS4gVGhlXG4gKiAgICAgICAgICAgICAgICAgIGxlZnRvdmVyIGlzIENPTlNJU1RFTlQgd2l0aCB0aGUgKHJlbW90ZSkgZGVsZXRpb24sIHNvIGl0XG4gKiAgICAgICAgICAgICAgICAgIG11c3QgTk9UIHJlc3VycmVjdCBhcyBcImxvY2FsIHdpbnNcIjogcmUtcHVzaGluZyBpdCBhcyBhblxuICogICAgICAgICAgICAgICAgICBlbXB0eS1mb2xkZXIgcGxhY2Vob2xkZXIgd291bGQgdW5kbyBhIGRlbGV0aW9uIHRoZSB1c2VyXG4gKiAgICAgICAgICAgICAgICAgIG1hZGUgYW5kIHBpbmctcG9uZyBpdCBiZXR3ZWVuIGRldmljZXMgZm9yZXZlciAob2JzZXJ2ZWRcbiAqICAgICAgICAgICAgICAgICAgZW5kLXRvLWVuZDogQSBkZWxldGVzIFx1MjE5MiBCIHJlY29yZHMtb25seSBcdTIxOTIgQiByZS1wdXNoZXMgXHUyMTkyXG4gKiAgICAgICAgICAgICAgICAgIEEgcmUtcHVsbHMpLiBUaGUgZW50cnkgc3RheXMgdG9tYnN0b25lZDsgdGhlIGNsaWVudCByZXRyaWVzXG4gKiAgICAgICAgICAgICAgICAgIGByZW1vdmVEaXJgIGZvciB0aGVzZSBkaXJzIGVhY2ggY3ljbGUgKGNsaWVudC50cykuIElmIHRoZVxuICogICAgICAgICAgICAgICAgICB0b21ic3RvbmUgd2FzIGF1dGhvcmVkIGJ5IFRISVMgZGV2aWNlLCBvciBjb250ZW50IGV4aXN0c1xuICogICAgICAgICAgICAgICAgICBiZW5lYXRoIHRoZSBkaXJlY3RvcnksIHRoaXMgaXMgZ2VudWluZSBsb2NhbCByZWNyZWF0aW9uOlxuICogICAgICAgICAgICAgICAgICB0aGUgZGlyIGxhbmRzIGluIGBlbXB0eUZvbGRlcnNgIGluc3RlYWQsIHJlc3RvcmluZyB0aGVcbiAqICAgICAgICAgICAgICAgICAgcGxhY2Vob2xkZXIgXHUyMDE0IGxvY2FsIHdpbnMgaXMgY29ycmVjdCB0aGVyZS5cbiAqICAgLSBgY2FzZUNvbGxpc2lvbnNgIFx1MjAxNCBsaXZlIGluZGV4IGVudHJpZXMgd2hvc2UgcGF0aCBkaWZmZXJzIG9ubHkgYnkgY2FzZVxuICogICAgICAgICAgICAgICAgICBmcm9tIGEgZmlsZSBwcmVzZW50IG9uIGRpc2s6IHRoZSBpbnZpc2libGUgdHdpbiBvZiBhXG4gKiAgICAgICAgICAgICAgICAgIGNhc2UtY29sbGlkaW5nIHBhaXIgKEFSQ0hJVEVDVFVSRSBcdTAwQTcxNCkuIE5FVkVSIGRlbGV0ZWQgXHUyMDE0XG4gKiAgICAgICAgICAgICAgICAgIGVtaXR0aW5nIGEgdG9tYnN0b25lIHdvdWxkIGRlc3Ryb3kgdGhlIHR3aW4gb24gdGhlIHNlcnZlclxuICogICAgICAgICAgICAgICAgICBhbmQgb24gY2FzZS1zZW5zaXRpdmUgcGVlcnMuIFN1cmZhY2VkIGFzIGEgZGlhZ25vc3RpY1xuICogICAgICAgICAgICAgICAgICBvbmx5OyB0aGUgY29sbGlzaW9uIHN0YXlzIHVucmVzb2x2ZWQgYnkgZGVzaWduLlxuICogICAtIGB1bnNhZmVQYXRoc2AgXHUyMDE0IGZpbGVzIGFuZCBkaXJlY3RvcmllcyB3aG9zZSBuYW1lcyBhcmUgV2luZG93cy11bnNhZmVcbiAqICAgICAgICAgICAgICAgICAgKHJlc2VydmVkIGRldmljZSBuYW1lcywgdHJhaWxpbmcgZG90L3NwYWNlIFx1MjAxNCBgcGF0aHMudHNgKS5cbiAqICAgICAgICAgICAgICAgICAgTGlrZSBjYXNlIGNvbGxpc2lvbnMgdGhleSBhcmUgbmV2ZXIgcHVzaGVkIGFuZCBuZXZlclxuICogICAgICAgICAgICAgICAgICB0cmVhdGVkIGFzIGRlbGV0aW9uczsgc3VyZmFjZWQgYXMgYSBkaWFnbm9zdGljIG9ubHkuXG4gKlxuICogIyMgVGhlIG10aW1lK3NpemUgcHJlLWZpbHRlciAoZmFzdCBtb2RlLCB0aGUgZGVmYXVsdClcbiAqXG4gKiBSZS1oYXNoaW5nIGEgNTBrLWZpbGUgdmF1bHQgYXQgZXZlcnkgYXBwLW9wZW4gaXMgYSByZWFsIGJhdHRlcnkgY29zdCwgc29cbiAqIGZhc3QgbW9kZSBza2lwcyBoYXNoaW5nIGEgZmlsZSB3aG9zZSBgc2l6ZWAgQU5EIGBtdGltZWAgKGZyb20gdGhlIHN0b3JhZ2VcbiAqIGFkYXB0ZXIncyBgRmlsZVN0YXRgKSBleGFjdGx5IG1hdGNoIGl0cyBsaXZlIGluZGV4IGVudHJ5IFx1MjAxNCB0aGUgcmVjb3JkZWRcbiAqIGhhc2ggY2FycmllcyBmb3J3YXJkIGFzIHVuY2hhbmdlZC4gQSBmaWxlIGlzIGhhc2hlZCB3aGVuIGl0IGhhcyBubyBlbnRyeSxcbiAqIHRoZSBlbnRyeSBpcyBhIHRvbWJzdG9uZSBvciBmb2xkZXIgcGxhY2Vob2xkZXIsIHRoZSBzaXplIGRpZmZlcnMsIG9yIHRoZVxuICogbXRpbWUgZGlmZmVycyBvciBpcyB1bmtub3duIChsZWdhY3kgc3RhdGUsIHB1bGxzLCBmaXJzdCBzY2FuKS4gUmVuYW1lXG4gKiBjb3JyZWxhdGlvbiBpcyB1bmFmZmVjdGVkOiB0aGUgZGVzdGluYXRpb24gcGF0aCBvZiBhIHJlbmFtZSBhbHdheXMgbG9va3NcbiAqICdhZGRlZCcsIHNvIGl0IGlzIGFsd2F5cyBoYXNoZWQgXHUyMDE0IGNvbnRlbnQtcHJlc2VydmluZyBtb3ZlcyBzdGlsbCBwYWlyLlxuICpcbiAqIFRoZSB0cmFkZW9mZjogZmFzdCBtb2RlIHRydXN0cyB0aGUgZmlsZXN5c3RlbSBub3QgdG8gY2hhbmdlIGNvbnRlbnQgd2hpbGVcbiAqIHByZXNlcnZpbmcgYm90aCBzaXplIGFuZCBtdGltZS4gRm9yIHZlcmlmaWNhdGlvbiAoYHZzYSBkb2N0b3JgLCBwZXJpb2RpY1xuICogaW50ZWdyaXR5IGNoZWNrcykgcGFzcyBgeyBtb2RlOiAnZnVsbCcgfWAgdG8gcmUtaGFzaCBldmVyeXRoaW5nLlxuICpcbiAqIFRoZSBmdW5jdGlvbiB0YWtlcyBgbm93YCBhbmQgdGhlIGlnbm9yZSBzZXR0aW5ncyBhcyBwYXJhbWV0ZXJzIChubyBoaWRkZW5cbiAqIGNsb2Nrcywgbm8gYW1iaWVudCBjb25maWcpIGFuZCByZXR1cm5zIGRldGVybWluaXN0aWNhbGx5IG9yZGVyZWQgcmVzdWx0c1xuICogKGV2ZXJ5IGJ1Y2tldCBzb3J0ZWQgYnkgcGF0aDsgcmVuYW1lcyBieSBgZnJvbWApLlxuICovXG5cbmltcG9ydCB0eXBlIHsgRmlsZVN0YXQsIFN0b3JhZ2VBZGFwdGVyIH0gZnJvbSAnLi9hZGFwdGVycy5qcyc7XG5pbXBvcnQgeyBzaGEyNTZIZXggfSBmcm9tICcuL2hhc2hpbmcuanMnO1xuaW1wb3J0IHsgaXNJZ25vcmVkLCB0eXBlIElnbm9yZVNldHRpbmdzIH0gZnJvbSAnLi9pZ25vcmUuanMnO1xuaW1wb3J0IHR5cGUgeyBMb2NhbEluZGV4LCBMb2NhbEluZGV4RW50cnkgfSBmcm9tICcuL2xvY2FsaW5kZXguanMnO1xuaW1wb3J0IHsgaXNXaW5kb3dzVW5zYWZlUGF0aCwgcGFyZW50UGF0aCB9IGZyb20gJy4vcGF0aHMuanMnO1xuXG4vKiogSW5qZWN0YWJsZSBjb250ZW50IGhhc2ggKHRoZSBkZWZhdWx0IGlzIHNoYTI1Niwgc2FtZSBhcyBibG9iIGFkZHJlc3NpbmcpLiAqL1xuZXhwb3J0IHR5cGUgSGFzaEZuID0gKGJ5dGVzOiBVaW50OEFycmF5KSA9PiBQcm9taXNlPHN0cmluZz47XG5cbi8qKiBPcHRpb25zIGZvciBgc2NhblZhdWx0YC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU2NhblZhdWx0T3B0aW9ucyB7XG4gIC8qKlxuICAgKiBgJ2Zhc3QnYCAoZGVmYXVsdCk6IGZpbGVzIHdob3NlIHNpemUrbXRpbWUgZXhhY3RseSBtYXRjaCB0aGVpciBsaXZlIGluZGV4XG4gICAqIGVudHJ5IHNraXAgcmUtaGFzaGluZy4gYCdmdWxsJ2A6IGhhc2ggZXZlcnl0aGluZyByZWdhcmRsZXNzIFx1MjAxNCBpbnRlZ3JpdHlcbiAgICogdmVyaWZpY2F0aW9uIChgdnNhIGRvY3RvcmAsIHBlcmlvZGljIGNoZWNrcykuXG4gICAqL1xuICBtb2RlPzogJ2Zhc3QnIHwgJ2Z1bGwnO1xuICAvKiogQ29udGVudCBoYXNoIG92ZXJyaWRlICh0ZXN0cyBjb3VudC9pbnNwZWN0IGhhc2hpbmcpLiBEZWZhdWx0OiBzaGEyNTZIZXguICovXG4gIGhhc2g/OiBIYXNoRm47XG4gIC8qKlxuICAgKiBCdWxrLXNjYW4gcHJvZ3Jlc3M6IGNhbGxlZCBvbmNlIHdpdGggKDAsIHRvdGFsKSBiZWZvcmUgdGhlIHdhbGsgYW5kIG9uY2VcbiAgICogcGVyIGZpbGUgYWZ0ZXJ3YXJkcyAoYGRvbmVgIGNvdW50cyBoYXNoZWQgQU5EIGZhc3QtcGF0aC1za2lwcGVkIGZpbGVzKS5cbiAgICogUHVyZSByZXBvcnRpbmcgXHUyMDE0IG5ldmVyIGFmZmVjdHMgdGhlIHNjYW4ncyBkZWNpc2lvbnMuXG4gICAqL1xuICBvblByb2dyZXNzPzogKGRvbmU6IG51bWJlciwgdG90YWw6IG51bWJlcikgPT4gdm9pZDtcbiAgLyoqXG4gICAqIFRoaXMgZGV2aWNlJ3MgaWQsIHdoZW4gdGhlIGNhbGxlciBpcyBhIHN5bmNpbmcgY2xpZW50LiBTaGFycGVucyB0aGVcbiAgICogdG9tYnN0b25lZC1wbGFjZWhvbGRlciBydWxlIChgc3RhbGVEaXJzYCk6IGFuIEVNUFRZIGRpcmVjdG9yeSBvdmVyIGFcbiAgICogdG9tYnN0b25lZCBwbGFjZWhvbGRlciBpcyB0aGUgcmVjb3JkLW9ubHkgcmVzaWR1ZSBvZiBhIFJFTU9URSBkZWxldGlvblxuICAgKiAobmV2ZXIgcmVzdXJyZWN0ZWQpLCBidXQgb3ZlciBhIHRvbWJzdG9uZSBUSElTIGRldmljZSBhdXRob3JlZCBpdCBtZWFuc1xuICAgKiB0aGUgdXNlciByZS1jcmVhdGVkIHRoZSBmb2xkZXIgaGVyZSBcdTIwMTQgcmVzdG9yZSBpdCAocHVzaCB0aGUgcGxhY2Vob2xkZXIpLlxuICAgKiBPbWl0dGVkIChvciBub24tZm9sZGVyIHNjYW5zKTogb25seSB0aGUgY29udGVudCB0ZXN0IGRlY2lkZXMuXG4gICAqL1xuICB0aGlzRGV2aWNlSWQ/OiBzdHJpbmc7XG59XG5cbi8qKiBBIGxvY2FsIGNvbnRlbnQgY2hhbmdlIGZvciBhIHBhdGggdGhhdCBleGlzdHMgaW4gc3RvcmFnZS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU2NhbkNhbmRpZGF0ZSB7XG4gIHBhdGg6IHN0cmluZztcbiAgaGFzaDogc3RyaW5nO1xuICBzaXplOiBudW1iZXI7XG59XG5cbi8qKiBBIGxvY2FsIGRlbGV0aW9uOiBjYXJyaWVzIHRoZSBpbmRleCdzIHZlcnNpb24gc28gdGhlIHRvbWJzdG9uZSBjb21taXQgbmFtZXMgaXRzIHBhcmVudC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRGVsZXRlZENhbmRpZGF0ZSB7XG4gIHBhdGg6IHN0cmluZztcbiAgLyoqIEhhc2ggb2YgdGhlIGNvbnRlbnQgYXMgbGFzdCBzeW5jZWQgKHRvbWJzdG9uZXMgcmV1c2UgaXQpLiAqL1xuICBoYXNoOiBzdHJpbmc7XG4gIHNpemU6IG51bWJlcjtcbiAgLyoqIFZlcnNpb24gaWQgdGhlIGRlbGV0aW9uIGNvbW1pdCBidWlsZHMgb24uICovXG4gIHZlcnNpb25JZDogc3RyaW5nO1xufVxuXG4vKiogQSBkZXRlY3RlZCByZW5hbWU6IHNhbWUgY29udGVudCBoYXNoIG1vdmVkIGZyb20gYGZyb21gIHRvIGB0b2AuICovXG5leHBvcnQgaW50ZXJmYWNlIFJlbmFtZUNhbmRpZGF0ZSB7XG4gIGZyb206IHN0cmluZztcbiAgdG86IHN0cmluZztcbiAgaGFzaDogc3RyaW5nO1xuICBzaXplOiBudW1iZXI7XG59XG5cbi8qKlxuICogQSBsaXZlIGZvbGRlciBwbGFjZWhvbGRlciB3aG9zZSBkaXJlY3RvcnkgdmFuaXNoZWQgZnJvbSBzdG9yYWdlOiB0aGVcbiAqIGRlbGV0aW9uIG11c3QgcHJvcGFnYXRlIGFzIGEgZm9sZGVyIHRvbWJzdG9uZSAoa2luZCBgJ2RlbGV0ZSdgLFxuICogYGlzRm9sZGVyOiB0cnVlYCkuIENhcnJpZXMgdGhlIHBsYWNlaG9sZGVyJ3MgdmVyc2lvbiBpZCBzbyB0aGUgdG9tYnN0b25lXG4gKiBjb21taXQgbmFtZXMgaXRzIHBhcmVudDsgaGFzaC9zaXplIGFyZSB0aGUgcGxhY2Vob2xkZXIgY29uc3RhbnRzXG4gKiAoYCcnYC9gMGApIGFuZCBhcmUgcmUtZGVyaXZlZCBkb3duc3RyZWFtIHJhdGhlciB0aGFuIGNhcnJpZWQuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRm9sZGVyRGVsZXRpb25DYW5kaWRhdGUge1xuICBwYXRoOiBzdHJpbmc7XG4gIC8qKiBWZXJzaW9uIGlkIG9mIHRoZSBwbGFjZWhvbGRlciBoZWFkIHRoZSB0b21ic3RvbmUgY29tbWl0IGJ1aWxkcyBvbi4gKi9cbiAgdmVyc2lvbklkOiBzdHJpbmc7XG59XG5cbi8qKlxuICogQSBmaWxlIHRoaXMgc2NhbiBhY3R1YWxseSByZWFkIGFuZCBoYXNoZWQsIHdpdGggdGhlIHN0YXQgb2JzZXJ2ZWQgYXQgaGFzaFxuICogdGltZS4gRmVlZHMgYHJlY29yZEhhc2hlZEZpbGVzYCBzbyB0aGUgTkVYVCBmYXN0IHNjYW4gY2FuIHNraXAgdGhlc2UgZmlsZXNcbiAqICh0aGUgbXRpbWUgY2FjaGUgb24gdGhlIGluZGV4IGVudHJ5KS4gRmlsZXMgc2tpcHBlZCBieSB0aGUgcHJlLWZpbHRlciBhcmUsXG4gKiBieSBkZWZpbml0aW9uLCBub3QgaGFzaGVkIGFuZCBkbyBub3QgYXBwZWFyIGhlcmUuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSGFzaGVkRmlsZSB7XG4gIHBhdGg6IHN0cmluZztcbiAgaGFzaDogc3RyaW5nO1xuICBzaXplOiBudW1iZXI7XG4gIC8qKiBFcG9jaCBtcyBcdTIwMTQgdGhlIHN0b3JhZ2Ugc3RhdCBhdCBoYXNoIHRpbWUgKGBGaWxlU3RhdC5tdGltZWApLiAqL1xuICBtdGltZTogbnVtYmVyO1xufVxuXG4vKiogVGhlIGZ1bGwgcmVzdWx0IG9mIG9uZSBsb2NhbCBzY2FuLiBBbGwgYnVja2V0cyBzb3J0ZWQgYnkgcGF0aC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgTG9jYWxDaGFuZ2VzIHtcbiAgLyoqIFRoZSBgbm93YCBwYXNzZWQgaW4gXHUyMDE0IHdoZW4gdGhpcyBzY2FuIGNvbmNlcHR1YWxseSBoYXBwZW5lZC4gKi9cbiAgc2Nhbm5lZEF0OiBudW1iZXI7XG4gIGFkZGVkOiBTY2FuQ2FuZGlkYXRlW107XG4gIG1vZGlmaWVkOiBTY2FuQ2FuZGlkYXRlW107XG4gIGRlbGV0ZWQ6IERlbGV0ZWRDYW5kaWRhdGVbXTtcbiAgcmVuYW1lZDogUmVuYW1lQ2FuZGlkYXRlW107XG4gIC8qKiBFbXB0eS1mb2xkZXIgcGF0aHMgdG8gcHVzaCBhcyBwbGFjZWhvbGRlciBlbnRyaWVzIChGUi0xMCkuICovXG4gIGVtcHR5Rm9sZGVyczogc3RyaW5nW107XG4gIC8qKlxuICAgKiBMaXZlIGZvbGRlciBwbGFjZWhvbGRlcnMgd2hvc2UgZGlyZWN0b3J5IG5vIGxvbmdlciBleGlzdHMgaW4gc3RvcmFnZSBcdTIwMTRcbiAgICogZm9sZGVyIGRlbGV0aW9ucyB0byBwdXNoIGFzIHRvbWJzdG9uZXMgKGtpbmQgYCdkZWxldGUnYCwgYGlzRm9sZGVyYCkuXG4gICAqL1xuICBmb2xkZXJEZWxldGlvbnM6IEZvbGRlckRlbGV0aW9uQ2FuZGlkYXRlW107XG4gIC8qKlxuICAgKiBEaXJlY3RvcmllcyB3aG9zZSBpbmRleCBlbnRyeSBpcyBhIFRPTUJTVE9ORUQgZm9sZGVyIHBsYWNlaG9sZGVyIHdoaWxlIGFuXG4gICAqIEVNUFRZIGRpcmVjdG9yeSBzdGlsbCBleGlzdHMgb24gZGlzayAocmVjb3JkLW9ubHkgdG9tYnN0b25lIGFwcGxpY2F0aW9uIFx1MjAxNFxuICAgKiBzZWUgdGhlIG1vZHVsZSBkb2MpLiBPbWl0dGVkIChub3QgbWVyZWx5IGVtcHR5KSB3aGVuIHRoZXJlIGFyZSBub25lLCBzb1xuICAgKiB3aG9sZS1vYmplY3QgY29tcGFyaXNvbnMgb2YgYExvY2FsQ2hhbmdlc2Agc3RheSBzdGFibGUgZm9yIGNsZWFuIHNjYW5zLlxuICAgKi9cbiAgc3RhbGVEaXJzPzogc3RyaW5nW107XG4gIC8qKlxuICAgKiBMaXZlIGluZGV4IHBhdGhzIHdob3NlIGZpbGUgaXMgaW52aXNpYmxlIG9uIHRoaXMgZmlsZXN5c3RlbSBiZWNhdXNlXG4gICAqIGFub3RoZXIgZmlsZSBkaWZmZXJzIGZyb20gdGhlbSBvbmx5IGJ5IG5hbWUgY2FzZSAoYSBjYXNlLWNvbGxpZGluZyBwYWlyLFxuICAgKiBjcmVhdGFibGUgZnJvbSBhIGNhc2Utc2Vuc2l0aXZlIGNsaWVudCBcdTIwMTQgQVJDSElURUNUVVJFIFx1MDBBNzE0KS4gVGhlIHNjYW5cbiAgICogbmV2ZXIgZW1pdHMgYSBkZWxldGlvbiBmb3IgdGhlc2UgKHRoZSB0d2luIG9uIGRpc2sgbXVzdCBub3QgYmUgZGVzdHJveWVkXG4gICAqIGJ5IGEgdG9tYnN0b25lIHB1c2gpOyB0aGUgY2xpZW50IHN1cmZhY2VzIHRoZW0gYXMgYSBkaWFnbm9zdGljXG4gICAqIChgU3luY0NsaWVudFN0YXR1cy5jYXNlQ29sbGlzaW9uc2ApLiBPbWl0dGVkIHdoZW4gdGhlcmUgYXJlIG5vbmUuXG4gICAqL1xuICBjYXNlQ29sbGlzaW9ucz86IHN0cmluZ1tdO1xuICAvKipcbiAgICogRmlsZXMgYW5kIGRpcmVjdG9yaWVzIHByZXNlbnQgaW4gc3RvcmFnZSB3aG9zZSBuYW1lcyBjYW5ub3QgYmUgc3luY2VkOlxuICAgKiBXaW5kb3dzLXJlc2VydmVkIGRldmljZSBuYW1lcyAoQ09OLCBOVUwsIENPTTEtOSwgXHUyMDI2KSBvciBzZWdtZW50cyBlbmRpbmdcbiAgICogaW4gYC5gL2AgYCAoYHBhdGhzLnRzYCkuIFRoZXkgYXJlIG5ldmVyIHB1c2hlZCAoYSBXaW5kb3dzIHBlZXIgY291bGRcbiAgICogbm90IG1hdGVyaWFsaXplIHRoZW0pLCBuZXZlciBoYXNoZWQsIGFuZCBuZXZlciB0cmVhdGVkIGFzIGRlbGV0aW9ucyBvZlxuICAgKiB0aGVpciBpbmRleCBlbnRyaWVzOyBzdXJmYWNlZCBhcyBhIGRpYWdub3N0aWNcbiAgICogKGBTeW5jQ2xpZW50U3RhdHVzLnNraXBwZWRQYXRoc2ApIHVudGlsIGEgaHVtYW4gcmVuYW1lcyB0aGVtLiBPbWl0dGVkXG4gICAqIHdoZW4gdGhlcmUgYXJlIG5vbmUuXG4gICAqL1xuICB1bnNhZmVQYXRocz86IHN0cmluZ1tdO1xuICAvKiogRXZlcnkgZmlsZSB0aGUgc2NhbiBoYXNoZWQgKGZhc3QgbW9kZSdzIHNraXBwZWQgZmlsZXMgYXJlIGFic2VudCksIHNvcnRlZCBieSBwYXRoLiAqL1xuICBoYXNoZWQ6IEhhc2hlZEZpbGVbXTtcbn1cblxuLyoqXG4gKiBTY2FuIHRoZSB2YXVsdCBhbmQgZGlmZiBpdCBhZ2FpbnN0IHRoZSBpbmRleC5cbiAqXG4gKiBJbiBmYXN0IG1vZGUgKHRoZSBkZWZhdWx0KSBhIGZpbGUgd2hvc2Ugc2l6ZSBhbmQgbXRpbWUgYm90aCBleGFjdGx5IG1hdGNoXG4gKiBpdHMgbGl2ZSBpbmRleCBlbnRyeSBpcyBOT1QgcmUtaGFzaGVkIFx1MjAxNCB0aGUgcmVjb3JkZWQgaGFzaCBjYXJyaWVzIGZvcndhcmRcbiAqIGFzIHVuY2hhbmdlZCAoc2VlIHRoZSBtb2R1bGUgZG9jIGZvciB0aGUgdHJhZGVvZmYgYW5kIHRoZSBgZnVsbGAgZXNjYXBlXG4gKiBoYXRjaCkuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzY2FuVmF1bHQoXG4gIHN0b3JhZ2U6IFN0b3JhZ2VBZGFwdGVyLFxuICBpbmRleDogTG9jYWxJbmRleCxcbiAgc2V0dGluZ3M6IElnbm9yZVNldHRpbmdzLFxuICBub3c6IG51bWJlcixcbiAgb3B0aW9uczogU2NhblZhdWx0T3B0aW9ucyA9IHt9LFxuKTogUHJvbWlzZTxMb2NhbENoYW5nZXM+IHtcbiAgY29uc3QgaGFzaEZuID0gb3B0aW9ucy5oYXNoID8/IHNoYTI1NkhleDtcbiAgY29uc3QgbW9kZSA9IG9wdGlvbnMubW9kZSA/PyAnZmFzdCc7XG4gIGNvbnN0IG9uUHJvZ3Jlc3MgPSBvcHRpb25zLm9uUHJvZ3Jlc3M7XG4gIGNvbnN0IHRoaXNEZXZpY2VJZCA9IG9wdGlvbnMudGhpc0RldmljZUlkO1xuXG4gIGNvbnN0IGZpbGVzID0gYXdhaXQgc3RvcmFnZS5saXN0RmlsZXMoKTtcblxuICAvLyBXaW5kb3dzLXVuc2FmZSBuYW1lcyBuZXZlciBlbnRlciB0aGUgZGlmZiAobm9yIHRoZSBkaXJlY3RvcnlcbiAgLy8gcmVwcmVzZW50YXRpb24gd2FsayBiZWxvdyk6IHRoZXkgY2Fubm90IGJlIHB1c2hlZCwgYW5kIGVtaXR0aW5nIGFcbiAgLy8gZGVsZXRpb24gb3IgcGxhY2Vob2xkZXIgZm9yIHRoZW0gd291bGQgY2h1cm4gYWdhaW5zdCBhIHNlcnZlciB0aGF0XG4gIC8vIHJlamVjdHMgdGhlIHBhdGguIFRoZXkgc3VyZmFjZSBhcyBkaWFnbm9zdGljcyBpbnN0ZWFkLlxuICBjb25zdCB1bnNhZmVQYXRoczogc3RyaW5nW10gPSBbXTtcbiAgY29uc3Qgc3luY2FibGU6IEZpbGVTdGF0W10gPSBbXTtcbiAgZm9yIChjb25zdCBmaWxlIG9mIGZpbGVzKSB7XG4gICAgaWYgKGlzV2luZG93c1Vuc2FmZVBhdGgoZmlsZS5wYXRoKSkgdW5zYWZlUGF0aHMucHVzaChmaWxlLnBhdGgpO1xuICAgIGVsc2Ugc3luY2FibGUucHVzaChmaWxlKTtcbiAgfVxuXG4gIGNvbnN0IGtlcHQ6IEZpbGVTdGF0W10gPSBbXTtcbiAgZm9yIChjb25zdCBmaWxlIG9mIHN5bmNhYmxlKSB7XG4gICAgaWYgKCFpc0lnbm9yZWQoZmlsZS5wYXRoLCBzZXR0aW5ncykpIGtlcHQucHVzaChmaWxlKTtcbiAgfVxuICBjb25zdCBrZXB0UGF0aHMgPSBuZXcgU2V0KGtlcHQubWFwKChmKSA9PiBmLnBhdGgpKTtcblxuICBjb25zdCBhZGRlZDogU2NhbkNhbmRpZGF0ZVtdID0gW107XG4gIGNvbnN0IG1vZGlmaWVkOiBTY2FuQ2FuZGlkYXRlW10gPSBbXTtcbiAgY29uc3QgaGFzaGVkOiBIYXNoZWRGaWxlW10gPSBbXTtcblxuICBvblByb2dyZXNzPy4oMCwga2VwdC5sZW5ndGgpO1xuICBsZXQgc2Nhbm5lZCA9IDA7XG4gIGZvciAoY29uc3QgZmlsZSBvZiBrZXB0KSB7XG4gICAgY29uc3QgZW50cnkgPSBpbmRleFtmaWxlLnBhdGhdO1xuICAgIGlmIChtb2RlID09PSAnZmFzdCcgJiYgc3RhdE1hdGNoZXNFbnRyeShlbnRyeSwgZmlsZSkpIHtcbiAgICAgIHNjYW5uZWQgKz0gMTtcbiAgICAgIG9uUHJvZ3Jlc3M/LihzY2FubmVkLCBrZXB0Lmxlbmd0aCk7XG4gICAgICBjb250aW51ZTsgLy8gc2l6ZSttdGltZSB1bmNoYW5nZWQgc2luY2UgdGhlIHJlY29yZGVkIGhhc2ggXHUyMDE0IHRydXN0IGl0XG4gICAgfVxuICAgIGNvbnN0IGhhc2ggPSBhd2FpdCBoYXNoRm4oYXdhaXQgc3RvcmFnZS5yZWFkRmlsZShmaWxlLnBhdGgpKTtcbiAgICBoYXNoZWQucHVzaCh7IHBhdGg6IGZpbGUucGF0aCwgaGFzaCwgc2l6ZTogZmlsZS5zaXplLCBtdGltZTogZmlsZS5tdGltZSB9KTtcbiAgICBzY2FubmVkICs9IDE7XG4gICAgb25Qcm9ncmVzcz8uKHNjYW5uZWQsIGtlcHQubGVuZ3RoKTtcbiAgICBpZiAoZW50cnkgPT09IHVuZGVmaW5lZCkge1xuICAgICAgYWRkZWQucHVzaCh7IHBhdGg6IGZpbGUucGF0aCwgaGFzaCwgc2l6ZTogZmlsZS5zaXplIH0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChlbnRyeS5pc0ZvbGRlcikge1xuICAgICAgLy8gQSByZWFsIGZpbGUgcmVwbGFjZWQgYSBmb2xkZXIgcGxhY2Vob2xkZXI6IHRyZWF0IGFzIGNvbnRlbnQgY2hhbmdlLlxuICAgICAgbW9kaWZpZWQucHVzaCh7IHBhdGg6IGZpbGUucGF0aCwgaGFzaCwgc2l6ZTogZmlsZS5zaXplIH0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIC8vIFRvbWJzdG9uZWQgZW50cnkgd2l0aCB0aGUgZmlsZSBiYWNrIFx1MjFEMiBtb2RpZmllZCAocmVzdXJyZWN0IG9yXG4gICAgLy8gZWRpdC1vZi1kZWxldGVkIFx1MjAxNCBib3RoIHJlc29sdmUgdGhlIHNhbWUgd2F5IGRvd25zdHJlYW0pLlxuICAgIGlmIChlbnRyeS5kZWxldGVkQXQgIT09IHVuZGVmaW5lZCB8fCBlbnRyeS5oYXNoICE9PSBoYXNoKSB7XG4gICAgICBtb2RpZmllZC5wdXNoKHsgcGF0aDogZmlsZS5wYXRoLCBoYXNoLCBzaXplOiBmaWxlLnNpemUgfSk7XG4gICAgfVxuICB9XG5cbiAgY29uc3QgZGVsZXRlZDogRGVsZXRlZENhbmRpZGF0ZVtdID0gW107XG4gIGZvciAoY29uc3QgW3BhdGgsIGVudHJ5XSBvZiBPYmplY3QuZW50cmllcyhpbmRleCkpIHtcbiAgICBpZiAoZW50cnkuaXNGb2xkZXIpIGNvbnRpbnVlOyAvLyBmb2xkZXIgcGxhY2Vob2xkZXJzIG5ldmVyIHByb2R1Y2UgZmlsZSBkZWxldGlvbnNcbiAgICBpZiAoZW50cnkuZGVsZXRlZEF0ICE9PSB1bmRlZmluZWQpIGNvbnRpbnVlOyAvLyBhbHJlYWR5IHRvbWJzdG9uZWRcbiAgICBpZiAoa2VwdFBhdGhzLmhhcyhwYXRoKSkgY29udGludWU7XG4gICAgaWYgKGlzSWdub3JlZChwYXRoLCBzZXR0aW5ncykpIHtcbiAgICAgIC8vIFRoZSBwYXRoIGJlY2FtZSBpZ25vcmVkIChzZXR0aW5ncyBjaGFuZ2UpIFx1MjAxNCBub3QgYSBkZWxldGlvbi5cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBkZWxldGVkLnB1c2goeyBwYXRoLCBoYXNoOiBlbnRyeS5oYXNoLCBzaXplOiBlbnRyeS5zaXplLCB2ZXJzaW9uSWQ6IGVudHJ5LnZlcnNpb25JZCB9KTtcbiAgfVxuXG4gIGNvbnN0IHsgcmVuYW1lZCwgZGVsZXRlZDogdW5tYXRjaGVkRGVsZXRlZCwgYWRkZWQ6IHVubWF0Y2hlZEFkZGVkIH0gPSBkZXRlY3RSZW5hbWVzKGRlbGV0ZWQsIGFkZGVkKTtcbiAgY29uc3QgeyBkZWxldGVkOiBzYWZlRGVsZXRlZCwgY2FzZUNvbGxpc2lvbnMgfSA9IHNwbGl0Q2FzZUNvbGxpc2lvbnMoXG4gICAgdW5tYXRjaGVkRGVsZXRlZCxcbiAgICBrZXB0UGF0aHMsXG4gICAgbmV3IFNldChbLi4udW5tYXRjaGVkQWRkZWQubWFwKChjKSA9PiBjLnBhdGgpLCAuLi5tb2RpZmllZC5tYXAoKGMpID0+IGMucGF0aCksIC4uLnJlbmFtZWQubWFwKChyKSA9PiByLnRvKV0pLFxuICApO1xuICBjb25zdCBkaXJzID0gYXdhaXQgc3RvcmFnZS5saXN0RGlycygpO1xuICBjb25zdCBzeW5jYWJsZURpcnM6IHN0cmluZ1tdID0gW107XG4gIGZvciAoY29uc3QgZGlyIG9mIGRpcnMpIHtcbiAgICBpZiAoaXNXaW5kb3dzVW5zYWZlUGF0aChkaXIpKSB1bnNhZmVQYXRocy5wdXNoKGRpcik7XG4gICAgZWxzZSBzeW5jYWJsZURpcnMucHVzaChkaXIpO1xuICB9XG4gIGNvbnN0IHsgZW1wdHlGb2xkZXJzLCBzdGFsZURpcnMgfSA9IGRldGVjdEVtcHR5Rm9sZGVycyhcbiAgICBpbmRleCxcbiAgICBzZXR0aW5ncyxcbiAgICBzeW5jYWJsZSxcbiAgICBzeW5jYWJsZURpcnMsXG4gICAgdGhpc0RldmljZUlkLFxuICApO1xuICBjb25zdCBmb2xkZXJEZWxldGlvbnMgPSBkZXRlY3RGb2xkZXJEZWxldGlvbnMoaW5kZXgsIHNldHRpbmdzLCBzeW5jYWJsZURpcnMpO1xuXG4gIHJldHVybiB7XG4gICAgc2Nhbm5lZEF0OiBub3csXG4gICAgYWRkZWQ6IHNvcnRDYW5kaWRhdGVzKHVubWF0Y2hlZEFkZGVkKSxcbiAgICBtb2RpZmllZDogc29ydENhbmRpZGF0ZXMobW9kaWZpZWQpLFxuICAgIGRlbGV0ZWQ6IFsuLi5zYWZlRGVsZXRlZF0uc29ydChieVBhdGgpLFxuICAgIHJlbmFtZWQ6IFsuLi5yZW5hbWVkXS5zb3J0KChhLCBiKSA9PiBieVBhdGgoYSwgYikpLFxuICAgIGVtcHR5Rm9sZGVycyxcbiAgICBmb2xkZXJEZWxldGlvbnMsXG4gICAgLy8gT21pdHRlZCB3aGVuIGVtcHR5IChub3QgYFtdYCkgXHUyMDE0IHNlZSB0aGUgZmllbGQncyBkb2MuXG4gICAgLi4uKHN0YWxlRGlycy5sZW5ndGggPiAwID8geyBzdGFsZURpcnMgfSA6IHt9KSxcbiAgICAuLi4oY2FzZUNvbGxpc2lvbnMubGVuZ3RoID4gMCA/IHsgY2FzZUNvbGxpc2lvbnMgfSA6IHt9KSxcbiAgICAuLi4odW5zYWZlUGF0aHMubGVuZ3RoID4gMCA/IHsgdW5zYWZlUGF0aHM6IHVuc2FmZVBhdGhzLnNvcnQoY29tcGFyZVN0cmluZ3MpIH0gOiB7fSksXG4gICAgaGFzaGVkOiBbLi4uaGFzaGVkXS5zb3J0KGJ5UGF0aCksXG4gIH07XG59XG5cbi8qKlxuICogQ2FzZS1jb2xsaXNpb24gZ3VhcmQgKEFSQ0hJVEVDVFVSRSBcdTAwQTcxNCk6IGFuIHVubWF0Y2hlZCBkZWxldGlvbiB3aG9zZSBwYXRoXG4gKiBkaWZmZXJzIG9ubHkgYnkgY2FzZSBmcm9tIGEgZmlsZSBQUkVTRU5UIG9uIGRpc2sgaXMgbm90IGEgZGVsZXRpb24gdGhlIHVzZXJcbiAqIG1hZGUgXHUyMDE0IGl0IGlzIHRoZSBpbnZpc2libGUgdHdpbiBvZiBhIGNhc2UtY29sbGlkaW5nIHBhaXIgKGNyZWF0YWJsZSBmcm9tIGFcbiAqIGNhc2Utc2Vuc2l0aXZlIGNsaWVudCwgZS5nLiB0aGUgTGludXggZGFlbW9uKS4gVGhpcyBjYXNlLWluc2Vuc2l0aXZlXG4gKiBmaWxlc3lzdGVtIHNob3dzIG9ubHkgb25lIGRpcmVjdG9yeSBlbnRyeSBmb3IgYm90aCwgc28gZW1pdHRpbmcgdGhlIGRlbGV0ZVxuICogd291bGQgcHVzaCBhIHRvbWJzdG9uZSB0aGF0IGRlc3Ryb3lzIHRoZSB0d2luIHNlcnZlci1zaWRlIGFuZCBvbiBldmVyeVxuICogY2FzZS1zZW5zaXRpdmUgcGVlci4gSW5zdGVhZCB0aGUgcGF0aCBpcyBzdXJmYWNlZCBhcyBhIGBjYXNlQ29sbGlzaW9uc2BcbiAqIGRpYWdub3N0aWMgKG5ldmVyIGEgZGVsZXRpb24gcHVzaCk7IHRoZSBjb2xsaXNpb24gaXRzZWxmIHN0YXlzIHVucmVzb2x2ZWRcbiAqIHVudGlsIGEgaHVtYW4gcmVuYW1lcyBvbmUgb2YgdGhlIHBhaXIuXG4gKlxuICogVGhlIGd1YXJkIGRlbGliZXJhdGVseSBydW5zIEFGVEVSIHJlbmFtZSBjb3JyZWxhdGlvbiBhbmQgc2tpcHMgdHdpbnMgdGhhdFxuICogdGhpcyBzY2FuIHJlcG9ydHMgYXMgYWRkZWQvbW9kaWZpZWQvcmVuYW1lZC10bzogYSBjYXNlLW9ubHkgcmVuYW1lIChvclxuICogcmVuYW1lK2VkaXQpIHRoZSB1c2VyIHBlcmZvcm1lZCBvbiBUSElTIGRldmljZSBwcm9kdWNlcyBleGFjdGx5IHRoYXRcbiAqIGRlbGV0ZSt0d2luLWNoYW5nZWQgc2hhcGUsIGFuZCBpdHMgZGVjb21wb3NpdGlvbiBpbnRvIGRlbGV0ZSthZGQgaXMgdGhlXG4gKiBkb2N1bWVudGVkLCBjb3JyZWN0IGJlaGF2aW9yIChhcHBseVB1bGwgb3JkZXJzIGNhc2UtY29sbGlkaW5nIHB1bGxzXG4gKiBkZWxldGUtZmlyc3QsIGByZXNvbHZlLnRzYCkuIE9ubHkgYSB0d2luIHRoYXQgaXMgb3RoZXJ3aXNlIFVOQ0hBTkdFRCBcdTIwMTRcbiAqIG1lYW5pbmcgaXQgaXMgYSBnZW51aW5lbHkgc2VwYXJhdGUgcmVtb3RlIGZpbGUgdGhpcyBkaXNrIGNhbiBvbmx5IHNob3cgb25lXG4gKiBvZiBcdTIwMTQgc3VwcHJlc3NlcyB0aGUgZGVsZXRpb24uXG4gKi9cbmZ1bmN0aW9uIHNwbGl0Q2FzZUNvbGxpc2lvbnMoXG4gIGRlbGV0ZWQ6IHJlYWRvbmx5IERlbGV0ZWRDYW5kaWRhdGVbXSxcbiAga2VwdFBhdGhzOiBSZWFkb25seVNldDxzdHJpbmc+LFxuICBjaGFuZ2VkUGF0aHM6IFJlYWRvbmx5U2V0PHN0cmluZz4sXG4pOiB7IGRlbGV0ZWQ6IERlbGV0ZWRDYW5kaWRhdGVbXTsgY2FzZUNvbGxpc2lvbnM6IHN0cmluZ1tdIH0ge1xuICBjb25zdCBrZXB0QnlMb3dlciA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KCk7XG4gIGZvciAoY29uc3QgcGF0aCBvZiBrZXB0UGF0aHMpIGtlcHRCeUxvd2VyLnNldChwYXRoLnRvTG93ZXJDYXNlKCksIHBhdGgpO1xuICBjb25zdCBzYWZlRGVsZXRlZDogRGVsZXRlZENhbmRpZGF0ZVtdID0gW107XG4gIGNvbnN0IGNhc2VDb2xsaXNpb25zOiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGNhbmRpZGF0ZSBvZiBkZWxldGVkKSB7XG4gICAgY29uc3QgdHdpbiA9IGtlcHRCeUxvd2VyLmdldChjYW5kaWRhdGUucGF0aC50b0xvd2VyQ2FzZSgpKTtcbiAgICBpZiAodHdpbiAhPT0gdW5kZWZpbmVkICYmICFjaGFuZ2VkUGF0aHMuaGFzKHR3aW4pKSB7XG4gICAgICBjYXNlQ29sbGlzaW9ucy5wdXNoKGNhbmRpZGF0ZS5wYXRoKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBzYWZlRGVsZXRlZC5wdXNoKGNhbmRpZGF0ZSk7XG4gIH1cbiAgcmV0dXJuIHtcbiAgICBkZWxldGVkOiBzYWZlRGVsZXRlZCxcbiAgICBjYXNlQ29sbGlzaW9uczogY2FzZUNvbGxpc2lvbnMuc29ydChjb21wYXJlU3RyaW5ncyksXG4gIH07XG59XG5cbmZ1bmN0aW9uIGNvbXBhcmVTdHJpbmdzKGE6IHN0cmluZywgYjogc3RyaW5nKTogbnVtYmVyIHtcbiAgcmV0dXJuIGEgPCBiID8gLTEgOiBhID4gYiA/IDEgOiAwO1xufVxuXG4vKipcbiAqIFdoZXRoZXIgdGhlIGZpbGUncyBzdGF0IGV4YWN0bHkgbWF0Y2hlcyBpdHMgbGl2ZSBpbmRleCBlbnRyeSBcdTIwMTQgdGhlIGZhc3RcbiAqIG1vZGUgcHJlLWZpbHRlci4gUmVxdWlyZXMgYSBrbm93biByZWNvcmRlZCBgbXRpbWVgIChsZWdhY3kgZW50cmllcyBhbmRcbiAqIHB1bGwtd3JpdHRlbiBlbnRyaWVzIGhhdmUgbm9uZSBcdTIxRDIgaGFzaGVkLCB0aGVuIHJlY29yZGVkKSBhbmQgbmV2ZXIgZmlyZXNcbiAqIGZvciB0b21ic3RvbmVzIChhIHJlc3VycmVjdCBtdXN0IGFsd2F5cyBzdXJmYWNlKSBvciBmb2xkZXIgcGxhY2Vob2xkZXJzLlxuICovXG5mdW5jdGlvbiBzdGF0TWF0Y2hlc0VudHJ5KGVudHJ5OiBMb2NhbEluZGV4RW50cnkgfCB1bmRlZmluZWQsIGZpbGU6IEZpbGVTdGF0KTogYm9vbGVhbiB7XG4gIHJldHVybiAoXG4gICAgZW50cnkgIT09IHVuZGVmaW5lZCAmJlxuICAgIGVudHJ5LmRlbGV0ZWRBdCA9PT0gdW5kZWZpbmVkICYmXG4gICAgZW50cnkuaXNGb2xkZXIgIT09IHRydWUgJiZcbiAgICBlbnRyeS5tdGltZSAhPT0gdW5kZWZpbmVkICYmXG4gICAgZW50cnkubXRpbWUgPT09IGZpbGUubXRpbWUgJiZcbiAgICBlbnRyeS5zaXplID09PSBmaWxlLnNpemVcbiAgKTtcbn1cblxuLyoqXG4gKiBSZWNvcmQgYSBzY2FuJ3MgaGFzaCBvYnNlcnZhdGlvbnMgaW50byB0aGUgaW5kZXg6IGZvciBldmVyeSBsaXZlIGZpbGVcbiAqIGVudHJ5IHdob3NlIGNvbnRlbnQgaGFzaCBtYXRjaGVzIHdoYXQgdGhlIHNjYW4gaGFzaGVkLCBjYWNoZSB0aGUgb2JzZXJ2ZWRcbiAqIG10aW1lIHNvIHRoZSBuZXh0IGZhc3Qgc2NhbiBjYW4gc2tpcCByZS1oYXNoaW5nIGl0LlxuICpcbiAqIFB1cmU6IHJldHVybnMgYSBuZXcgaW5kZXggKG9yIHRoZSBpbnB1dCB3aGVuIG5vdGhpbmcgY2hhbmdlcyksIG5ldmVyXG4gKiBtdXRhdGVzLiBUaGUgaGFzaC1tYXRjaCBndWFyZCBrZWVwcyB0aGUgY2FjaGUgaG9uZXN0IFx1MjAxNCBhbiBlbnRyeSB3aG9zZVxuICogaGFzaCBubyBsb25nZXIgcmVmbGVjdHMgdGhlIG9ic2VydmF0aW9uIChlLmcuIGEgcHVsbCBvdmVyd3JvdGUgdGhlIHBhdGhcbiAqIG1pZC1jeWNsZSkgaXMgbGVmdCB1bnRvdWNoZWQgYW5kIHNpbXBseSBnZXRzIHJlLWhhc2hlZCBuZXh0IHNjYW4uXG4gKiBFbnRyaWVzIG5ldmVyIGRlbW90ZTogYGRlbGV0ZWRBdGAvYGlzRm9sZGVyYCBlbnRyaWVzIGFyZSBuZXZlciBwYXRjaGVkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVjb3JkSGFzaGVkRmlsZXMoXG4gIGluZGV4OiBMb2NhbEluZGV4LFxuICBoYXNoZWQ6IHJlYWRvbmx5IEhhc2hlZEZpbGVbXSxcbik6IExvY2FsSW5kZXgge1xuICBsZXQgbmV4dDogUmVjb3JkPHN0cmluZywgTG9jYWxJbmRleEVudHJ5PiB8IHVuZGVmaW5lZDtcbiAgZm9yIChjb25zdCBvYnNlcnZlZCBvZiBoYXNoZWQpIHtcbiAgICBjb25zdCBlbnRyeSA9IGluZGV4W29ic2VydmVkLnBhdGhdO1xuICAgIGlmIChlbnRyeSA9PT0gdW5kZWZpbmVkIHx8IGVudHJ5LmlzRm9sZGVyIHx8IGVudHJ5LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkKSBjb250aW51ZTtcbiAgICBpZiAoZW50cnkuaGFzaCAhPT0gb2JzZXJ2ZWQuaGFzaCkgY29udGludWU7XG4gICAgaWYgKGVudHJ5Lm10aW1lID09PSBvYnNlcnZlZC5tdGltZSkgY29udGludWU7XG4gICAgbmV4dCA/Pz0geyAuLi5pbmRleCB9O1xuICAgIG5leHRbb2JzZXJ2ZWQucGF0aF0gPSB7IC4uLmVudHJ5LCBtdGltZTogb2JzZXJ2ZWQubXRpbWUgfTtcbiAgfVxuICByZXR1cm4gbmV4dCA/PyBpbmRleDtcbn1cblxuLyoqXG4gKiBDb3JyZWxhdGUgZGVsZXRlICsgYWRkIHBhaXJzIGJ5IGNvbnRlbnQgaGFzaCAoQVJDSElURUNUVVJFIFx1MDBBNzQpLlxuICpcbiAqIE9uZS10by1vbmUgbWF0Y2hpbmcsIG1vc3QgZGV0ZXJtaW5pc3RpYyB3aW5zOiB3aGVuIHNldmVyYWwgdW5tYXRjaGVkIGFkZHNcbiAqIHNoYXJlIHRoZSBkZWxldGVkIHNpZGUncyBoYXNoLCBwcmVmZXIgYW4gYWRkIGluIHRoZSBzYW1lIHBhcmVudCBkaXJlY3Rvcnk7XG4gKiB3aXRoaW4gYSBwcmVmZXJlbmNlIGNsYXNzLCB0aGUgbGV4aWNvZ3JhcGhpY2FsbHkgc21hbGxlc3QgYHRvYCBwYXRoIHdpbnMuXG4gKiBNYXRjaGVkIHBhaXJzIGxlYXZlIHRoZSBkZWxldGUvYWRkIGJ1Y2tldHMgYW5kIGJlY29tZSBgcmVuYW1lZGAuXG4gKi9cbmZ1bmN0aW9uIGRldGVjdFJlbmFtZXMoXG4gIGRlbGV0ZWQ6IHJlYWRvbmx5IERlbGV0ZWRDYW5kaWRhdGVbXSxcbiAgYWRkZWQ6IHJlYWRvbmx5IFNjYW5DYW5kaWRhdGVbXSxcbik6IHtcbiAgcmVuYW1lZDogUmVuYW1lQ2FuZGlkYXRlW107XG4gIGRlbGV0ZWQ6IERlbGV0ZWRDYW5kaWRhdGVbXTtcbiAgYWRkZWQ6IFNjYW5DYW5kaWRhdGVbXTtcbn0ge1xuICBjb25zdCBhZGRzQnlIYXNoID0gbmV3IE1hcDxzdHJpbmcsIFNjYW5DYW5kaWRhdGVbXT4oKTtcbiAgZm9yIChjb25zdCBjYW5kaWRhdGUgb2YgWy4uLmFkZGVkXS5zb3J0KGJ5UGF0aCkpIHtcbiAgICBjb25zdCBidWNrZXQgPSBhZGRzQnlIYXNoLmdldChjYW5kaWRhdGUuaGFzaCk7XG4gICAgaWYgKGJ1Y2tldCkgYnVja2V0LnB1c2goY2FuZGlkYXRlKTtcbiAgICBlbHNlIGFkZHNCeUhhc2guc2V0KGNhbmRpZGF0ZS5oYXNoLCBbY2FuZGlkYXRlXSk7XG4gIH1cblxuICBjb25zdCB1c2VkQWRkcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBjb25zdCByZW5hbWVkOiBSZW5hbWVDYW5kaWRhdGVbXSA9IFtdO1xuICBjb25zdCB1bm1hdGNoZWREZWxldGVkOiBEZWxldGVkQ2FuZGlkYXRlW10gPSBbXTtcblxuICBmb3IgKGNvbnN0IGRlbGV0aW9uIG9mIFsuLi5kZWxldGVkXS5zb3J0KGJ5UGF0aCkpIHtcbiAgICBjb25zdCBjYW5kaWRhdGVzID0gYWRkc0J5SGFzaC5nZXQoZGVsZXRpb24uaGFzaCkgPz8gW107XG4gICAgbGV0IGZhbGxiYWNrOiBTY2FuQ2FuZGlkYXRlIHwgdW5kZWZpbmVkO1xuICAgIGxldCBzYW1lRGlyOiBTY2FuQ2FuZGlkYXRlIHwgdW5kZWZpbmVkO1xuICAgIGZvciAoY29uc3QgY2FuZGlkYXRlIG9mIGNhbmRpZGF0ZXMpIHtcbiAgICAgIGlmICh1c2VkQWRkcy5oYXMoY2FuZGlkYXRlLnBhdGgpKSBjb250aW51ZTtcbiAgICAgIGlmIChwYXJlbnRQYXRoKGNhbmRpZGF0ZS5wYXRoKSA9PT0gcGFyZW50UGF0aChkZWxldGlvbi5wYXRoKSkge1xuICAgICAgICBzYW1lRGlyID8/PSBjYW5kaWRhdGU7IC8vIHNvcnRlZCBcdTIxRDIgZmlyc3QgaXMgc21hbGxlc3RcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGZhbGxiYWNrID8/PSBjYW5kaWRhdGU7XG4gICAgICB9XG4gICAgfVxuICAgIGNvbnN0IG1hdGNoID0gc2FtZURpciA/PyBmYWxsYmFjaztcbiAgICBpZiAobWF0Y2gpIHtcbiAgICAgIHVzZWRBZGRzLmFkZChtYXRjaC5wYXRoKTtcbiAgICAgIHJlbmFtZWQucHVzaCh7IGZyb206IGRlbGV0aW9uLnBhdGgsIHRvOiBtYXRjaC5wYXRoLCBoYXNoOiBkZWxldGlvbi5oYXNoLCBzaXplOiBkZWxldGlvbi5zaXplIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICB1bm1hdGNoZWREZWxldGVkLnB1c2goZGVsZXRpb24pO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7XG4gICAgcmVuYW1lZCxcbiAgICBkZWxldGVkOiB1bm1hdGNoZWREZWxldGVkLFxuICAgIGFkZGVkOiBhZGRlZC5maWx0ZXIoKGNhbmRpZGF0ZSkgPT4gIXVzZWRBZGRzLmhhcyhjYW5kaWRhdGUucGF0aCkpLFxuICB9O1xufVxuXG4vKipcbiAqIERpcmVjdG9yaWVzIHRoYXQgZXhpc3QgaW4gc3RvcmFnZSBidXQgYXJlIHJlcHJlc2VudGVkIG5laXRoZXIgYnkgYSBsaXZlXG4gKiBmb2xkZXIgcGxhY2Vob2xkZXIgaW4gdGhlIGluZGV4IG5vciBieSBhbnkgZmlsZSAoaWdub3JlZCBvciBub3QpIGJlbmVhdGhcbiAqIHRoZW0gXHUyMDE0IHBsdXMgdGhlIHRvbWJzdG9uZWQtcGxhY2Vob2xkZXIgc3BlY2lhbCBjYXNlcyB0aGF0IG1ha2UgdGhlXG4gKiBlbXB0eS1mb2xkZXIgbGlmZWN5Y2xlIGRlbGV0aW9uLXNhZmU6XG4gKlxuICogICAtIFRPTUJTVE9ORUQgcGxhY2Vob2xkZXIgKyBjb250ZW50IGJlbmVhdGggXHUyMTkyIGBlbXB0eUZvbGRlcnNgOiB0aGUgdXNlclxuICogICAgIHJlY3JlYXRlZCB0aGUgZm9sZGVyOyByZXN0b3JpbmcgdGhlIHBsYWNlaG9sZGVyIChcImxvY2FsIHdpbnNcIikgaXNcbiAqICAgICBjb3JyZWN0LiBUaGUgcmVjcmVhdGVkIEZJTEVTIGJlbmVhdGggc3VyZmFjZSB0aHJvdWdoIGBhZGRlZGAvYG1vZGlmaWVkYFxuICogICAgIGluZGVwZW5kZW50bHkuXG4gKiAgIC0gVE9NQlNUT05FRCBwbGFjZWhvbGRlciArIEVNUFRZIGRpciBvbiBkaXNrOlxuICogICAgICAgXHUwMEI3IHRvbWJzdG9uZSBhdXRob3JlZCBieSBBTk9USEVSIGRldmljZSAob3IgYXV0aG9yIHVua25vd24pIFx1MjE5MlxuICogICAgICAgICBgc3RhbGVEaXJzYDogdGhlIHJlY29yZC1vbmx5IHJlc2lkdWUgb2YgYSByZW1vdGUgZGVsZXRpb24sXG4gKiAgICAgICAgIGNvbnNpc3RlbnQgd2l0aCB0aGUgdG9tYnN0b25lIFx1MjAxNCBuZXZlciByZXN1cnJlY3RlZCAocmUtcHVzaGluZyBpdCBhc1xuICogICAgICAgICBhbiBlbXB0eSBmb2xkZXIgaXMgd2hhdCBtYWRlIGEgcGVlci1zaWRlIGRlbGV0aW9uIHBpbmctcG9uZ1xuICogICAgICAgICBmb3JldmVyKS4gVGhlIGNsaWVudCByZXRyaWVzIGByZW1vdmVEaXJgIG9uIHRoZXNlIGRpcnMuXG4gKiAgICAgICBcdTAwQjcgdG9tYnN0b25lIGF1dGhvcmVkIGJ5IFRISVMgZGV2aWNlIChgdGhpc0RldmljZUlkYCkgXHUyMTkyXG4gKiAgICAgICAgIGBlbXB0eUZvbGRlcnNgOiBteSBvd24gZGVsZXRpb24sIHlldCBhIGRpciBleGlzdHMgaGVyZSBub3cgXHUyMDE0IHRoZVxuICogICAgICAgICB1c2VyIHJlLWNyZWF0ZWQgaXQgbG9jYWxseTsgcmVzdG9yZSB0aGUgcGxhY2Vob2xkZXIuXG4gKlxuICogQSBkaXJlY3RvcnkgY29udGFpbmluZyBvbmx5IGlnbm9yZWQgZmlsZXMgaXMgKm5vdCogZW1wdHkgXHUyMDE0IGl0IGlzXG4gKiByZXByZXNlbnRlZCBieSB0aG9zZSBmaWxlcyBhcyBmYXIgYXMgdGhlIGxvY2FsIG1hY2hpbmUgaXMgY29uY2VybmVkLlxuICovXG5mdW5jdGlvbiBkZXRlY3RFbXB0eUZvbGRlcnMoXG4gIGluZGV4OiBMb2NhbEluZGV4LFxuICBzZXR0aW5nczogSWdub3JlU2V0dGluZ3MsXG4gIGZpbGVzOiByZWFkb25seSBGaWxlU3RhdFtdLFxuICBkaXJzOiByZWFkb25seSBzdHJpbmdbXSxcbiAgdGhpc0RldmljZUlkPzogc3RyaW5nLFxuKTogeyBlbXB0eUZvbGRlcnM6IHN0cmluZ1tdOyBzdGFsZURpcnM6IHN0cmluZ1tdIH0ge1xuICBjb25zdCByZXByZXNlbnRlZERpcnMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgZm9yIChjb25zdCBmaWxlIG9mIGZpbGVzKSB7XG4gICAgZm9yIChsZXQgZGlyID0gcGFyZW50UGF0aChmaWxlLnBhdGgpOyBkaXIgIT09ICcvJzsgZGlyID0gcGFyZW50UGF0aChkaXIpKSB7XG4gICAgICByZXByZXNlbnRlZERpcnMuYWRkKGRpcik7XG4gICAgfVxuICB9XG5cbiAgY29uc3QgZW1wdHlGb2xkZXJzOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBzdGFsZURpcnM6IHN0cmluZ1tdID0gW107XG4gIGZvciAoY29uc3QgZGlyIG9mIGRpcnMpIHtcbiAgICBpZiAoZGlyID09PSAnLycpIGNvbnRpbnVlO1xuICAgIGlmIChpc0lnbm9yZWQoZGlyLCBzZXR0aW5ncykpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGVudHJ5ID0gaW5kZXhbZGlyXTtcbiAgICBpZiAoZW50cnk/LmlzRm9sZGVyICYmIGVudHJ5LmRlbGV0ZWRBdCA9PT0gdW5kZWZpbmVkKSBjb250aW51ZTsgLy8gbGl2ZSBwbGFjZWhvbGRlciBcdTIwMTQgYWxyZWFkeSBzeW5jZWRcbiAgICBpZiAoZW50cnk/LmlzRm9sZGVyICYmIGVudHJ5LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAvLyBUb21ic3RvbmVkIHBsYWNlaG9sZGVyIHdob3NlIGRpcmVjdG9yeSBzdGlsbCBleGlzdHMuIENvbnRlbnQgYmVuZWF0aFxuICAgICAgLy8gXHUyMUQyIGdlbnVpbmUgcmVjcmVhdGlvbi4gRW1wdHkgXHUyMUQyIHN0YWxlIGxlZnRvdmVyIG9mIGEgcmVjb3JkLW9ubHlcbiAgICAgIC8vIHRvbWJzdG9uZSBhcHBsaWNhdGlvbiBcdTIwMTQgVU5MRVNTIHRoaXMgZGV2aWNlIGF1dGhvcmVkIHRoZSB0b21ic3RvbmVcbiAgICAgIC8vIGl0c2VsZiwgaW4gd2hpY2ggY2FzZSBhIHByZXNlbnQgZGlyIGNhbiBvbmx5IGJlIGxvY2FsIHJlY3JlYXRpb24uXG4gICAgICBpZiAocmVwcmVzZW50ZWREaXJzLmhhcyhkaXIpIHx8IGVudHJ5LmNsb2NrLmRldmljZUlkID09PSB0aGlzRGV2aWNlSWQpIHtcbiAgICAgICAgZW1wdHlGb2xkZXJzLnB1c2goZGlyKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHN0YWxlRGlycy5wdXNoKGRpcik7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKHJlcHJlc2VudGVkRGlycy5oYXMoZGlyKSkgY29udGludWU7IC8vIHJlcHJlc2VudGVkIGJ5IGl0cyBmaWxlc1xuICAgIGVtcHR5Rm9sZGVycy5wdXNoKGRpcik7XG4gIH1cbiAgcmV0dXJuIHtcbiAgICBlbXB0eUZvbGRlcnM6IGVtcHR5Rm9sZGVycy5zb3J0KCksXG4gICAgc3RhbGVEaXJzOiBzdGFsZURpcnMuc29ydCgpLFxuICB9O1xufVxuXG4vKipcbiAqIExpdmUgZm9sZGVyIHBsYWNlaG9sZGVyIGVudHJpZXMgd2hvc2UgZGlyZWN0b3J5IG5vIGxvbmdlciBleGlzdHMgaW5cbiAqIHN0b3JhZ2UgXHUyMDE0IHRoZSBmb2xkZXIgd2FzIGRlbGV0ZWQgbG9jYWxseSAoZGlyZWN0bHksIG9yIGJ5IHBydW5lLW9uLWRlbGV0ZVxuICogZW1wdHlpbmcgaXQpLiBFbWl0cyBvbmUgYEZvbGRlckRlbGV0aW9uQ2FuZGlkYXRlYCBwZXIgcGxhY2Vob2xkZXIgc28gdGhlXG4gKiByZXNvbHZlL2NvbW1pdCBwYXRoIHB1c2hlcyBhIGZvbGRlciB0b21ic3RvbmU7IGFscmVhZHktdG9tYnN0b25lZFxuICogcGxhY2Vob2xkZXJzIGFuZCBwbGFjZWhvbGRlcnMgdGhhdCBtZXJlbHkgYmVjYW1lIGlnbm9yZWQgYXJlIHNraXBwZWQuXG4gKi9cbmZ1bmN0aW9uIGRldGVjdEZvbGRlckRlbGV0aW9ucyhcbiAgaW5kZXg6IExvY2FsSW5kZXgsXG4gIHNldHRpbmdzOiBJZ25vcmVTZXR0aW5ncyxcbiAgZGlyczogcmVhZG9ubHkgc3RyaW5nW10sXG4pOiBGb2xkZXJEZWxldGlvbkNhbmRpZGF0ZVtdIHtcbiAgY29uc3QgcHJlc2VudCA9IG5ldyBTZXQoZGlycyk7XG4gIGNvbnN0IGZvbGRlckRlbGV0aW9uczogRm9sZGVyRGVsZXRpb25DYW5kaWRhdGVbXSA9IFtdO1xuICBmb3IgKGNvbnN0IFtwYXRoLCBlbnRyeV0gb2YgT2JqZWN0LmVudHJpZXMoaW5kZXgpKSB7XG4gICAgaWYgKCFlbnRyeS5pc0ZvbGRlcikgY29udGludWU7IC8vIGZpbGVzIGFyZSBoYW5kbGVkIGJ5IHRoZSBgZGVsZXRlZGAgYnVja2V0XG4gICAgaWYgKGVudHJ5LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkKSBjb250aW51ZTsgLy8gYWxyZWFkeSB0b21ic3RvbmVkXG4gICAgaWYgKHByZXNlbnQuaGFzKHBhdGgpKSBjb250aW51ZTsgLy8gZGlyZWN0b3J5IHN0aWxsIGV4aXN0cyBcdTIwMTQgbm8gZGVsZXRpb25cbiAgICBpZiAoaXNJZ25vcmVkKHBhdGgsIHNldHRpbmdzKSkgY29udGludWU7IC8vIHNldHRpbmdzIGNoYW5nZSwgbm90IGEgZGVsZXRpb25cbiAgICBmb2xkZXJEZWxldGlvbnMucHVzaCh7IHBhdGgsIHZlcnNpb25JZDogZW50cnkudmVyc2lvbklkIH0pO1xuICB9XG4gIHJldHVybiBmb2xkZXJEZWxldGlvbnMuc29ydChieVBhdGgpO1xufVxuXG5mdW5jdGlvbiBzb3J0Q2FuZGlkYXRlcyhjYW5kaWRhdGVzOiBTY2FuQ2FuZGlkYXRlW10pOiBTY2FuQ2FuZGlkYXRlW10ge1xuICByZXR1cm4gWy4uLmNhbmRpZGF0ZXNdLnNvcnQoYnlQYXRoKTtcbn1cblxuZnVuY3Rpb24gYnlQYXRoPFQgZXh0ZW5kcyB7IHBhdGg/OiBzdHJpbmc7IGZyb20/OiBzdHJpbmcgfT4oYTogVCwgYjogVCk6IG51bWJlciB7XG4gIGNvbnN0IGtleUEgPSBhLnBhdGggPz8gYS5mcm9tID8/ICcnO1xuICBjb25zdCBrZXlCID0gYi5wYXRoID8/IGIuZnJvbSA/PyAnJztcbiAgcmV0dXJuIGtleUEgPCBrZXlCID8gLTEgOiBrZXlBID4ga2V5QiA/IDEgOiAwO1xufVxuIiwgIi8qKlxyXG4gKiBgU3luY0NsaWVudGAgXHUyMDE0IHRoZSBuZXR3b3JrLWZhY2luZyBvcmNoZXN0cmF0b3IgKEFSQ0hJVEVDVFVSRS5tZCBcdTAwQTc4KS5cclxuICpcclxuICogQ29tcG9zZXMgdGhlIHBoYXNlLTFhLzFiIHBpZWNlcyBpbnRvIG9uZSBsb29wIHBlciBkZXZpY2U6XHJcbiAqXHJcbiAqICAgc3RhcnR1cDogIGxvYWRMb2NhbFN0YXRlIChlbnRyaWVzICsgcGVyc2lzdGVkIGN1cnNvcikgXHUyMTkyIGhlbGxvL2hlbGxvQWNrXHJcbiAqICAgICAgICAgICAgIChzZXJ2ZXIgcmVwb3J0cyBgb2xkZXN0UmV0YWluZWRTZXFgKSBcdTIxOTIgZ2V0TWFuaWZlc3QgXHUyMDE0IGEgREVMVEFcclxuICogICAgICAgICAgICAgbWFuaWZlc3QgKGBzaW5jZTogc3luY2VkVGhyb3VnaGApIG1lcmdlZCBvdmVyIHRoZSBpbmRleFxyXG4gKiAgICAgICAgICAgICBwcm9qZWN0aW9uIHdoZW4gdGhlIHJlcGxheSB3aW5kb3cgaXMgaW50YWN0LCBlbHNlIGZ1bGwgXHUyMTkyXHJcbiAqICAgICAgICAgICAgIHNjYW5WYXVsdCBcdTIxOTIgY29tcHV0ZVN5bmNQbGFuIFx1MjE5MiBleGVjdXRlIChwdXNoZXMgdGhyb3VnaCBhXHJcbiAqICAgICAgICAgICAgIGJvdW5kZWQtY29uY3VycmVuY3kgcGlwZWxpbmUsIHB1bGxzIHZpYSBhcHBseVB1bGwgd2l0aCB0aGVcclxuICogICAgICAgICAgICAgaW5qZWN0ZWQgYmxvYiBzdG9yZSk7XHJcbiAqICAgbGl2ZTogICAgIGBjaGFuZ2VgIG1lc3NhZ2VzIG1hdGVyaWFsaXplIGltbWVkaWF0ZWx5IHdoZW4gdGhlIHRhcmdldCBpc1xyXG4gKiAgICAgICAgICAgICBjbGVhbiwgYW5kIGRlZmVyIHRvIGEgZnVsbCByZWNvbmNpbGUgY3ljbGUgd2hlbiBpdCBpcyBub3QgXHUyMDE0IGFcclxuICogICAgICAgICAgICAgcmVtb3RlIGNoYW5nZSBpcyBORVZFUiB3cml0dGVuIG92ZXIgbG9jYWxseS1tb2RpZmllZCBjb250ZW50XHJcbiAqICAgICAgICAgICAgIHdpdGhvdXQgZ29pbmcgdGhyb3VnaCBgY29tcHV0ZVN5bmNQbGFuYCdzIGNvbmZsaWN0IGxvZ2ljO1xyXG4gKiAgIHdhdGNoZXI6ICBgV2F0Y2hBZGFwdGVyYCBiYXRjaGVzIGFyZSBkZWJvdW5jZWQgKH4zMDAgbXMsIGluamVjdGFibGVcclxuICogICAgICAgICAgICAgc2NoZWR1bGVyIFx1MjAxNCBubyBhbWJpZW50IHRpbWVycyBpbiB0ZXN0cykgaW50byBzY2FuXHUyMTkycGxhblx1MjE5MmV4ZWN1dGU7XHJcbiAqICAgcmVjb25uZWN0OiBgb25DbG9zZWAgZmxpcHMgdG8gYCdkaXNjb25uZWN0ZWQnYDsgYHJlY29ubmVjdCgpYCByZS1ydW5zIHRoZVxyXG4gKiAgICAgICAgICAgICB3aG9sZSBzdGFydHVwIHJlY29uY2lsaWF0aW9uIChiYWNrb2ZmIGlzIHRoZSBjYWxsZXIncyBqb2IpLlxyXG4gKlxyXG4gKiBCdWxrIHBoYXNlcyByZXBvcnQgWC9ZIG9uIGBzdGF0dXMoKS5wcm9ncmVzc2AgKHRocm90dGxlZCB2aWEgdGhlIGluamVjdGVkXHJcbiAqIGNsb2NrKTsgdGhlIHB1c2ggcGhhc2Uga2VlcHMgdXAgdG8gYHB1c2hDb25jdXJyZW5jeWAgY29tbWl0cyBpbiBmbGlnaHQuXHJcbiAqXHJcbiAqIEFsbCBJL08gY3Jvc3NlcyB0aGUgYWRhcHRlciBzZWFtcyAoYFN0b3JhZ2VBZGFwdGVyYCwgYFRyYW5zcG9ydGAsXHJcbiAqIGBCbG9iU3RvcmVgLCBgTG9nQWRhcHRlcmApOyB0aGUgY2xhc3MgaXRzZWxmIGlzIHB1cmUgb3JjaGVzdHJhdGlvbiBhbmQgcnVuc1xyXG4gKiBhbnl3aGVyZSBgY29yZWAgcnVucyBcdTIwMTQgV29ya2VycyB0ZXN0cyBpbmNsdWRlZC5cclxuICovXHJcblxyXG5pbXBvcnQgdHlwZSB7IExvZ0FkYXB0ZXIsIFN0b3JhZ2VBZGFwdGVyLCBXYXRjaEFkYXB0ZXIgfSBmcm9tICcuL2FkYXB0ZXJzLmpzJztcclxuaW1wb3J0IHsgY29tcGFyZUNsb2NrcyB9IGZyb20gJy4vY2xvY2suanMnO1xyXG5pbXBvcnQgeyBhcHBseVB1bGwsIGxvYWRMb2NhbFN0YXRlLCBwcnVuZVBhcmVudE9uRGVsZXRlLCByZW1vdmVEaXJJZlZhY2FudCwgdHlwZSBGZXRjaEJsb2IgfSBmcm9tICcuL2VuZ2luZS5qcyc7XHJcbmltcG9ydCB7IE5ldHdvcmtFcnJvciwgUHJvdG9jb2xFcnJvciwgUmV2b2tlZEVycm9yLCBVbmF1dGhvcml6ZWRFcnJvciB9IGZyb20gJy4vZXJyb3JzLmpzJztcclxuaW1wb3J0IHsgc2hhMjU2SGV4IH0gZnJvbSAnLi9oYXNoaW5nLmpzJztcclxuaW1wb3J0IHsgaXNJZ25vcmVkLCB0eXBlIElnbm9yZVNldHRpbmdzIH0gZnJvbSAnLi9pZ25vcmUuanMnO1xyXG5pbXBvcnQge1xyXG4gIGFwcGx5Q29tbWl0LFxyXG4gIExPQ0FMX0lOREVYX1NUQVRFX1BBVEgsXHJcbiAgcmVtb3ZlRW50cnksXHJcbiAgc2VyaWFsaXplTG9jYWxJbmRleCxcclxuICB0eXBlIExvY2FsSW5kZXgsXHJcbiAgdHlwZSBQZXJzaXN0ZWRTeW5jU3RhdGUsXHJcbn0gZnJvbSAnLi9sb2NhbGluZGV4LmpzJztcclxuaW1wb3J0IHsgaXNXaW5kb3dzVW5zYWZlUGF0aCB9IGZyb20gJy4vcGF0aHMuanMnO1xyXG5pbXBvcnQge1xyXG4gIGJhc2U2NFRvQnl0ZXMsXHJcbiAgYnl0ZXNUb0Jhc2U2NCxcclxuICBJTkxJTkVfQ09OVEVOVF9NQVhfQllURVMsXHJcbiAgUHJvdG9jb2xWZXJzaW9uLFxyXG4gIHZhbGlkYXRlQ2hhbmdlTWVzc2FnZSxcclxuICB2YWxpZGF0ZUNvbW1pdEFja01lc3NhZ2UsXHJcbiAgdmFsaWRhdGVDb25mbGljdE1lc3NhZ2UsXHJcbiAgdmFsaWRhdGVNYW5pZmVzdE1lc3NhZ2UsXHJcbiAgdHlwZSBCbG9iQWNrTWVzc2FnZSxcclxuICB0eXBlIEJsb2JNZXNzYWdlLFxyXG4gIHR5cGUgQ2hhbmdlTWVzc2FnZSxcclxuICB0eXBlIENvbW1pdEFja01lc3NhZ2UsXHJcbiAgdHlwZSBDb21taXRNZXNzYWdlLFxyXG4gIHR5cGUgQ29uZmxpY3RNZXNzYWdlLFxyXG4gIHR5cGUgSGVsbG9BY2tNZXNzYWdlLFxyXG4gIHR5cGUgTWFuaWZlc3RNZXNzYWdlLFxyXG4gIHR5cGUgTWVzc2FnZSxcclxuICB0eXBlIFNlcnZlck1lc3NhZ2UsXHJcbiAgdHlwZSBTbmFwc2hvdENyZWF0ZUFja01lc3NhZ2UsXHJcbiAgdHlwZSBTbmFwc2hvdFJlc3RvcmVBY2tNZXNzYWdlLFxyXG59IGZyb20gJy4vcHJvdG9jb2wuanMnO1xyXG5pbXBvcnQge1xyXG4gIGNvbXB1dGVTeW5jUGxhbixcclxuICB0eXBlIENvbmZsaWN0T3AsXHJcbiAgdHlwZSBQdWxsRmlsZU9wLFxyXG4gIHR5cGUgUHVsbE9wLFxyXG4gIHR5cGUgUHVzaE9wLFxyXG4gIHR5cGUgUmVtb3RlRmlsZSxcclxuICB0eXBlIFN5bmNQbGFuLFxyXG59IGZyb20gJy4vcmVzb2x2ZS5qcyc7XHJcbmltcG9ydCB7IHJlY29yZEhhc2hlZEZpbGVzLCBzY2FuVmF1bHQsIHR5cGUgSGFzaGVkRmlsZSB9IGZyb20gJy4vc2Nhbi5qcyc7XHJcbmltcG9ydCB0eXBlIHsgVHJhbnNwb3J0IH0gZnJvbSAnLi90cmFuc3BvcnQuanMnO1xyXG5pbXBvcnQgdHlwZSB7IExvZ2ljYWxDbG9jayB9IGZyb20gJy4vdHlwZXMuanMnO1xyXG5cclxuLy8gLS0tIHB1YmxpYyBvcHRpb24vc3RhdHVzIHNoYXBlcyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cclxuLyoqIENsaWVudC1zaWRlIGNvbnRlbnQtYWRkcmVzc2VkIGJsb2IgY2FjaGUgKFIyIGNsaWVudCBpbiBwcm9kdWN0aW9uOyBhIE1hcCBpbiB0ZXN0cykuICovXHJcbmV4cG9ydCBpbnRlcmZhY2UgQmxvYlN0b3JlIHtcclxuICBnZXQoaGFzaDogc3RyaW5nKTogUHJvbWlzZTxVaW50OEFycmF5IHwgdW5kZWZpbmVkPjtcclxuICBwdXQoaGFzaDogc3RyaW5nLCBieXRlczogVWludDhBcnJheSk6IFByb21pc2U8dm9pZD47XHJcbn1cclxuXHJcbmV4cG9ydCBpbnRlcmZhY2UgU3luY0NsaWVudE9wdGlvbnMge1xyXG4gIGRldmljZUlkOiBzdHJpbmc7XHJcbiAgZGV2aWNlTmFtZTogc3RyaW5nO1xyXG4gIHRva2VuOiBzdHJpbmc7XHJcbiAgLyoqIEEgZmFjdG9yeSAocmVjb25uZWN0IGRpYWxzIGZyZXNoKSBvciBhIHNpbmdsZSByZXVzYWJsZSBpbnN0YW5jZS4gKi9cclxuICB0cmFuc3BvcnQ6ICgoKSA9PiBUcmFuc3BvcnQpIHwgVHJhbnNwb3J0O1xyXG4gIGJsb2JTdG9yZTogQmxvYlN0b3JlO1xyXG4gIHN0b3JhZ2U6IFN0b3JhZ2VBZGFwdGVyO1xyXG4gIGxvZz86IExvZ0FkYXB0ZXI7XHJcbiAgLyoqIEluaXRpYWwgaWdub3JlIHNldHRpbmdzOyBzdXBlcnNlZGVkIGJ5IGBoZWxsb0Fjay5zZXR0aW5nc2Agb24gY29ubmVjdC4gKi9cclxuICBzZXR0aW5ncz86IElnbm9yZVNldHRpbmdzO1xyXG4gIC8qKiBJbmplY3RhYmxlIGNsb2NrIChkZWZhdWx0IGBEYXRlLm5vd2ApLiAqL1xyXG4gIG5vdz86ICgpID0+IG51bWJlcjtcclxuICAvKiogV2F0Y2hlciBkZWJvdW5jZSB3aW5kb3cgaW4gbXMgKGRlZmF1bHQgMzAwKS4gKi9cclxuICBkZWJvdW5jZU1zPzogbnVtYmVyO1xyXG4gIC8qKlxyXG4gICAqIFNjaGVkdWxlcyB0aGUgZGVib3VuY2VkIHN5bmMgY3ljbGUuIERlZmF1bHQ6IGBzZXRUaW1lb3V0YC4gVGVzdHMgaW5qZWN0IGFcclxuICAgKiBtYW51YWwgcXVldWUgXHUyMDE0IHRoZSBjbGllbnQgbmV2ZXIgdG91Y2hlcyBhIHJlYWwgdGltZXIgYmVoaW5kIHRoaXMgc2VhbS5cclxuICAgKi9cclxuICBzY2hlZHVsZT86IChmbjogKCkgPT4gdm9pZCwgbXM6IG51bWJlcikgPT4gKCkgPT4gdm9pZDtcclxuICAvKipcclxuICAgKiBCb3VuZGVkIGNvbmN1cnJlbmN5IG9mIHRoZSBwdXNoIHBpcGVsaW5lOiBob3cgbWFueSBjb21taXRzIG1heSBiZSBpblxyXG4gICAqIGZsaWdodCAoc2VudCwgYXdhaXRpbmcgYWNrKSBhdCBvbmNlLiBEZWZhdWx0IDguIENvbmZsaWN0IGFyYml0cmF0aW9uIGlzXHJcbiAgICogc2VydmVyLXNpZGUgYW5kIFBFUiBQQVRILCBhbmQgYSBjeWNsZSBzdGFnZXMgYXQgbW9zdCBvbmUgY29tbWl0IHBlciBwYXRoLFxyXG4gICAqIHNvIG9yZGVyaW5nIGFjcm9zcyBkaWZmZXJlbnQgZmlsZXMgaXMgaXJyZWxldmFudCBcdTIwMTQgc2VlXHJcbiAgICogYHJ1blB1c2hQaXBlbGluZWAgZm9yIHRoZSBmdWxsIGFyZ3VtZW50LlxyXG4gICAqL1xyXG4gIHB1c2hDb25jdXJyZW5jeT86IG51bWJlcjtcclxuICAvKipcclxuICAgKiBNaW5pbXVtIHdhbGwtY2xvY2sgbXMgYmV0d2VlbiBgc3RhdHVzKCkucHJvZ3Jlc3NgIHVwZGF0ZXMgZHVyaW5nIGJ1bGtcclxuICAgKiBwaGFzZXMgKGRlZmF1bHQgNTAgXHUyMDE0IHJlbmRlcmVyIGNvYWxlc2Npbmc7IHBoYXNlIGNoYW5nZXMgYW5kIGNvbXBsZXRpb25zXHJcbiAgICogYWx3YXlzIGVtaXQpLiBUZXN0cyBwYXNzIDAgdG8gb2JzZXJ2ZSBldmVyeSBmaWxlLlxyXG4gICAqL1xyXG4gIHByb2dyZXNzVGhyb3R0bGVNcz86IG51bWJlcjtcclxufVxyXG5cclxuZXhwb3J0IHR5cGUgU3luY0NsaWVudFN0YXRlID0gJ2lkbGUnIHwgJ2Nvbm5lY3RpbmcnIHwgJ3N5bmNpbmcnIHwgJ2xpdmUnIHwgJ2Rpc2Nvbm5lY3RlZCc7XHJcblxyXG4vKiogVGhlIGJ1bGsgcGhhc2UgYSBydW5uaW5nIGN5Y2xlIGlzIGN1cnJlbnRseSBncmluZGluZyB0aHJvdWdoLiAqL1xyXG5leHBvcnQgdHlwZSBTeW5jUGhhc2UgPSAnc2Nhbm5pbmcnIHwgJ3B1c2hpbmcnIHwgJ3B1bGxpbmcnO1xyXG5cclxuLyoqIFgvWSBwcm9ncmVzcyBvZiBvbmUgYnVsayBwaGFzZTsgcHJlc2VudCBvbiBgU3luY0NsaWVudFN0YXR1c2AgbWlkLWN5Y2xlIG9ubHkuICovXHJcbmV4cG9ydCBpbnRlcmZhY2UgU3luY1Byb2dyZXNzIHtcclxuICBwaGFzZTogU3luY1BoYXNlO1xyXG4gIGRvbmU6IG51bWJlcjtcclxuICB0b3RhbDogbnVtYmVyO1xyXG59XHJcblxyXG5leHBvcnQgaW50ZXJmYWNlIFN5bmNDbGllbnRTdGF0dXMge1xyXG4gIHN0YXRlOiBTeW5jQ2xpZW50U3RhdGU7XHJcbiAgLyoqIEVwb2NoIG1zIG9mIHRoZSBsYXN0IGNvbXBsZXRlZCBjeWNsZSwgb3IgbnVsbCBiZWZvcmUgdGhlIGZpcnN0LiAqL1xyXG4gIGxhc3RTeW5jQXQ6IG51bWJlciB8IG51bGw7XHJcbiAgLyoqIFdhdGNoZXIvcmVjb25jaWxlIGV2ZW50cyBxdWV1ZWQgYmVoaW5kIHRoZSBkZWJvdW5jZSB3aW5kb3cuICovXHJcbiAgcGVuZGluZzogbnVtYmVyO1xyXG4gIC8qKlxyXG4gICAqIENvbmZsaWN0cyBvYnNlcnZlZCBieSB0aGUgbW9zdCByZWNlbnQgcGxhbiBjeWNsZSAoaW5mb3JtYXRpb25hbDtcclxuICAgKiByZXNvbHV0aW9uIGlzIGluIHRoZSBkYXRhKS4gUmVwbGFjZWQgZXZlcnkgY3ljbGUgXHUyMDE0IGEgbGF0ZXIgY3ljbGUgdGhhdFxyXG4gICAqIHBsYW5zIGNsZWFuIGNsZWFycyBpdCwgc28gYSBzeW5jZWQtcXVpZXQgY2xpZW50IHJlcG9ydHMgMC5cclxuICAgKi9cclxuICBjb25mbGljdHM6IENvbmZsaWN0T3BbXTtcclxuICAvKipcclxuICAgKiBQYXRocyB3aG9zZSBsaXZlIGluZGV4IGVudHJ5IGlzIElOVklTSUJMRSBvbiB0aGlzIGZpbGVzeXN0ZW0gYmVjYXVzZVxyXG4gICAqIGFub3RoZXIgc3luY2VkIGZpbGUgZGlmZmVycyBmcm9tIGl0IG9ubHkgYnkgbmFtZSBjYXNlIChhIGNhc2UtY29sbGlkaW5nXHJcbiAgICogcGFpciwgY3JlYXRhYmxlIGZyb20gYSBjYXNlLXNlbnNpdGl2ZSBjbGllbnQgXHUyMDE0IEFSQ0hJVEVDVFVSRSBcdTAwQTcxNCkuIFRoZVxyXG4gICAqIHNjYW4gbmV2ZXIgcHVzaGVzIGEgZGVsZXRpb24gZm9yIHRoZW07IHRoZXkgYXJlIHN1cmZhY2VkIGhlcmUgKGFuZCB2aWEgYVxyXG4gICAqIGB3YXJuYCBsb2cgbGluZSBwZXIgY3ljbGUpIHVudGlsIGEgaHVtYW4gcmVuYW1lcyBvbmUgb2YgdGhlIHBhaXIuXHJcbiAgICogUmVwbGFjZWQgZXZlcnkgY3ljbGUgbGlrZSBgY29uZmxpY3RzYDsgb21pdHRlZCB3aGVuIHRoZXJlIGFyZSBub25lLlxyXG4gICAqL1xyXG4gIGNhc2VDb2xsaXNpb25zPzogc3RyaW5nW107XHJcbiAgLyoqXHJcbiAgICogUGF0aHMgdGhlIG1vc3QgcmVjZW50IGN5Y2xlIFNLSVBQRUQgYmVjYXVzZSB0aGVpciBuYW1lcyBjYW5ub3QgYmVcclxuICAgKiBtYXRlcmlhbGl6ZWQgb24gV2luZG93cyAocmVzZXJ2ZWQgZGV2aWNlIG5hbWVzIGxpa2UgYENPTmAvYE5VTGAvYENPTTFgLFxyXG4gICAqIG9yIHNlZ21lbnRzIGVuZGluZyBpbiBgLmAvYCBgIFx1MjAxNCBzZWUgYHBhdGhzLnRzYCkuIExvY2FsIGZpbGVzIHdpdGggc3VjaFxyXG4gICAqIG5hbWVzIGFyZSBuZXZlciBwdXNoZWQgYW5kIHJlbW90ZSBoZWFkcyBhdCBzdWNoIHBhdGhzIGFyZSBuZXZlciBhcHBsaWVkO1xyXG4gICAqIGEgbGF0ZXIgdmVyc2lvbiBjaGFuZ2UgYXQgdGhlIHBhdGggaXMgYXR0ZW1wdGVkIGFnYWluLiBTdXJmYWNlZCBoZXJlXHJcbiAgICogKGFuZCB2aWEgYSBgd2FybmAgbG9nIGxpbmUpIHVudGlsIGEgaHVtYW4gcmVuYW1lcyB0aGUgcGF0aDsgcmVwbGFjZWRcclxuICAgKiBldmVyeSBjeWNsZSBsaWtlIGBjb25mbGljdHNgLiBPbWl0dGVkIHdoZW4gdGhlcmUgYXJlIG5vbmUuXHJcbiAgICovXHJcbiAgc2tpcHBlZFBhdGhzPzogc3RyaW5nW107XHJcbiAgLyoqXHJcbiAgICogU2VydmVyIHJlbGVhc2UgdmVyc2lvbiBhcyByZXBvcnRlZCBieSBoZWxsb0FjayAobnVsbCBiZWZvcmUgdGhlIGZpcnN0XHJcbiAgICogYWNrIFx1MjAxNCBhbmQgZm9yIGxlZ2FjeSBzZXJ2ZXJzIFx1MjI2NCAwLjEsIHdoaWNoIG5ldmVyIHNlbmQgdGhlIGZpZWxkOyBzZWVcclxuICAgKiBgY2hlY2tTZXJ2ZXJDb21wYXRpYmlsaXR5YCBmb3IgdGhlIHNoYXJlZCBza2V3IHBvbGljeSkuXHJcbiAgICovXHJcbiAgc2VydmVyVmVyc2lvbjogc3RyaW5nIHwgbnVsbDtcclxuICAvKipcclxuICAgKiBQcm9ncmVzcyBvZiB0aGUgUlVOTklORyBjeWNsZSdzIGN1cnJlbnQgYnVsayBwaGFzZSAoYHZzYSBcdTIyRUYgMTIzNC81MDAwYCk7XHJcbiAgICogYWJzZW50IGJldHdlZW4gY3ljbGVzLiBVcGRhdGVzIGFyZSB0aHJvdHRsZWQgdG8gYHByb2dyZXNzVGhyb3R0bGVNc2AuXHJcbiAgICovXHJcbiAgcHJvZ3Jlc3M/OiBTeW5jUHJvZ3Jlc3M7XHJcbn1cclxuXHJcbi8qKiBEZWZhdWx0IGluLWZsaWdodCBjb21taXQgY2FwIChzZWUgYFN5bmNDbGllbnRPcHRpb25zLnB1c2hDb25jdXJyZW5jeWApLiAqL1xyXG5leHBvcnQgY29uc3QgREVGQVVMVF9QVVNIX0NPTkNVUlJFTkNZID0gODtcclxuLyoqIERlZmF1bHQgcHJvZ3Jlc3MgY29hbGVzY2luZyB3aW5kb3cgKHNlZSBgU3luY0NsaWVudE9wdGlvbnMucHJvZ3Jlc3NUaHJvdHRsZU1zYCkuICovXHJcbmV4cG9ydCBjb25zdCBERUZBVUxUX1BST0dSRVNTX1RIUk9UVExFX01TID0gNTA7XHJcblxyXG5jb25zdCBkZWZhdWx0TG9nOiBMb2dBZGFwdGVyID0ge1xyXG4gIGRlYnVnOiAoKSA9PiB7fSxcclxuICBpbmZvOiAoKSA9PiB7fSxcclxuICB3YXJuOiAoKSA9PiB7fSxcclxuICBlcnJvcjogKCkgPT4ge30sXHJcbn07XHJcblxyXG5jb25zdCBkZWZhdWx0U2NoZWR1bGUgPSAoZm46ICgpID0+IHZvaWQsIG1zOiBudW1iZXIpOiAoKCkgPT4gdm9pZCkgPT4ge1xyXG4gIGNvbnN0IGhhbmRsZSA9IGdsb2JhbFRoaXMuc2V0VGltZW91dChmbiwgbXMpIGFzIHVua25vd24gYXMgbnVtYmVyO1xyXG4gIHJldHVybiAoKSA9PiBnbG9iYWxUaGlzLmNsZWFyVGltZW91dChoYW5kbGUpO1xyXG59O1xyXG5cclxuLyoqIEEgY29tbWl0IHByZXBhcmVkIGZvciB0aGUgd2lyZSAoYSBgUHVzaE9wYCArIGl0cyBzdGFnZWQgY29udGVudCkuICovXHJcbmludGVyZmFjZSBTdGFnZWRDb21taXQge1xyXG4gIGtpbmQ6IENvbW1pdE1lc3NhZ2VbJ2tpbmQnXTtcclxuICBwYXRoOiBzdHJpbmc7XHJcbiAgcGFyZW50VmVyc2lvbjogc3RyaW5nIHwgbnVsbDtcclxuICBoYXNoOiBzdHJpbmc7XHJcbiAgc2l6ZTogbnVtYmVyO1xyXG4gIGZyb21QYXRoPzogc3RyaW5nO1xyXG4gIGlzRm9sZGVyPzogYm9vbGVhbjtcclxuICBieXRlcz86IFVpbnQ4QXJyYXk7XHJcbiAgLyoqXHJcbiAgICogU3RvcmFnZSBtdGltZSBvYnNlcnZlZCBieSBUSElTIGN5Y2xlJ3Mgc2NhbiB3aGVuIGl0IGhhc2hlZCB0aGUgY29udGVudFxyXG4gICAqIChgSGFzaGVkRmlsZS5tdGltZWAgb2YgdGhlIHB1c2ggc291cmNlKS4gUGlubmVkIG9udG8gdGhlIGluZGV4IGVudHJ5IHdoZW5cclxuICAgKiB0aGUgYWNrIGxhbmRzLCBzbyB0aGUgZW50cnkncyAoaGFzaCwgc2l6ZSwgbXRpbWUpIGFsd2F5cyBkZXNjcmliZXMgT05FXHJcbiAgICogY29uc2lzdGVudCBpbnN0YW50IG9mIHRoZSBmaWxlIFx1MjAxNCBuZXZlciBhIGxhdGVyIHN0YXQgcGFpcmVkIHdpdGggdGhpc1xyXG4gICAqIGhhc2guIFRoYXQgb3JkZXJpbmcgaXMgd2hhdCBsZXRzIHRoZSBzY2FuIGZhc3QtcGF0aCAobXRpbWUrc2l6ZSkgc2tpcFxyXG4gICAqIHJlLWhhc2hpbmcgc2FmZWx5OiBhbiBlZGl0IGxhbmRpbmcgYmV0d2VlbiBoYXNoIGFuZCBhY2sgY2hhbmdlcyB0aGUgZGlza1xyXG4gICAqIHN0YXQsIG1pc3NlcyB0aGUgZmFzdCBwYXRoLCBhbmQgaXMgcmUtaGFzaGVkIGFuZCBwdXNoZWQgb24gdGhlIG5leHQgc2Nhbi5cclxuICAgKi9cclxuICBtdGltZT86IG51bWJlcjtcclxufVxyXG5cclxuLy8gLS0tIHRoZSBjbGllbnQgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblxyXG5leHBvcnQgY2xhc3MgU3luY0NsaWVudCB7XHJcbiAgcHJpdmF0ZSByZWFkb25seSBvcHRpb25zOiBTeW5jQ2xpZW50T3B0aW9ucztcclxuICBwcml2YXRlIHJlYWRvbmx5IGxvZzogTG9nQWRhcHRlcjtcclxuICBwcml2YXRlIHJlYWRvbmx5IG5vdzogKCkgPT4gbnVtYmVyO1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgZGVib3VuY2VNczogbnVtYmVyO1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgc2NoZWR1bGU6IChmbjogKCkgPT4gdm9pZCwgbXM6IG51bWJlcikgPT4gKCkgPT4gdm9pZDtcclxuICBwcml2YXRlIHJlYWRvbmx5IGRpYWxUcmFuc3BvcnQ6ICgpID0+IFRyYW5zcG9ydDtcclxuICBwcml2YXRlIHJlYWRvbmx5IHB1c2hDb25jdXJyZW5jeTogbnVtYmVyO1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgcHJvZ3Jlc3NUaHJvdHRsZU1zOiBudW1iZXI7XHJcblxyXG4gIHByaXZhdGUgdHJhbnNwb3J0OiBUcmFuc3BvcnQgfCBudWxsID0gbnVsbDtcclxuICBwcml2YXRlIHN0YXRlOiBTeW5jQ2xpZW50U3RhdGUgPSAnaWRsZSc7XHJcbiAgcHJpdmF0ZSBpbmRleDogTG9jYWxJbmRleCA9IHt9O1xyXG4gIHByaXZhdGUgY3Vyc29yID0gMDtcclxuICBwcml2YXRlIGxhc3RTeW5jQXQ6IG51bWJlciB8IG51bGwgPSBudWxsO1xyXG4gIHByaXZhdGUgcGVuZGluZyA9IDA7XHJcbiAgcHJpdmF0ZSBjb25mbGljdHM6IENvbmZsaWN0T3BbXSA9IFtdO1xyXG4gIHByaXZhdGUgY2FzZUNvbGxpc2lvbnM6IHN0cmluZ1tdID0gW107XHJcbiAgcHJpdmF0ZSBza2lwcGVkUGF0aHM6IHN0cmluZ1tdID0gW107XHJcbiAgcHJpdmF0ZSBpZ25vcmVTZXR0aW5nczogSWdub3JlU2V0dGluZ3M7XHJcbiAgcHJpdmF0ZSB3YXRjaEFkYXB0ZXI6IFdhdGNoQWRhcHRlciB8IG51bGwgPSBudWxsO1xyXG4gIHByaXZhdGUgY2FuY2VsRGVib3VuY2U6ICgoKSA9PiB2b2lkKSB8IG51bGwgPSBudWxsO1xyXG5cclxuICAvKipcclxuICAgKiBEZWx0YS1tYW5pZmVzdCBib29ra2VlcGluZyAocGVyc2lzdGVkIGFsb25nc2lkZSB0aGUgaW5kZXgsIHNlZVxyXG4gICAqIGBQZXJzaXN0ZWRTeW5jU3RhdGVgKTogYHN5bmNlZFRocm91Z2hgIFx1MjAxNCB0aGUgbWFuaWZlc3QgY3Vyc29yIG9mIHRoZSBsYXN0XHJcbiAgICogZnVsbHktc3VjY2Vzc2Z1bCBjeWNsZSwgaS5lLiB0aGUgc2VxIHRocm91Z2ggd2hpY2ggdGhlIGluZGV4IGlzIGtub3duXHJcbiAgICogQ09NUExFVEUgKG51bGwgdW50aWwgb25lIGZpbmlzaGVzKTsgYG5lZWRzRnVsbE1hbmlmZXN0YCBcdTIwMTQgYSByZW1vdGUgY2hhbmdlXHJcbiAgICogd2FzIGRlZmVycmVkIG92ZXIgbG9jYWwgZGl2ZXJnZW5jZSBhbmQgbXVzdCBiZSByZXNvbHZlZCB0aHJvdWdoIGEgZnVsbFxyXG4gICAqIG1hbmlmZXN0J3MgcGxhbiBsb2dpYzsgYHNlcnZlck9sZGVzdFJldGFpbmVkU2VxYCBcdTIwMTQgdGhlIGhlbGxvQWNrJ3MgYW5zd2VyXHJcbiAgICogdG8gXCJpcyBteSByZXBsYXkgd2luZG93IGludGFjdFwiIChudWxsIGZvciBsZWdhY3kgc2VydmVycyBcdTIxRDIgYWx3YXlzIGZ1bGwpLlxyXG4gICAqL1xyXG4gIHByaXZhdGUgc3luY2VkVGhyb3VnaDogbnVtYmVyIHwgbnVsbCA9IG51bGw7XHJcbiAgcHJpdmF0ZSBuZWVkc0Z1bGxNYW5pZmVzdCA9IGZhbHNlO1xyXG4gIHByaXZhdGUgc2VydmVyT2xkZXN0UmV0YWluZWRTZXE6IG51bWJlciB8IG51bGwgPSBudWxsO1xyXG4gIC8qKiBTZXJ2ZXIgcmVsZWFzZSBmcm9tIGhlbGxvQWNrOyBudWxsIHVudGlsIGFja2VkIChsZWdhY3kgc2VydmVycyBzdGF5IG51bGwpLiAqL1xyXG4gIHByaXZhdGUgc2VydmVyVmVyc2lvbjogc3RyaW5nIHwgbnVsbCA9IG51bGw7XHJcblxyXG4gIC8qKiBDdXJyZW50IGJ1bGstcGhhc2UgcHJvZ3Jlc3MsIGNsZWFyZWQgd2hlbiBhIGN5Y2xlIHNldHRsZXMuICovXHJcbiAgcHJpdmF0ZSBwcm9ncmVzczogU3luY1Byb2dyZXNzIHwgbnVsbCA9IG51bGw7XHJcbiAgcHJpdmF0ZSBsYXN0UHJvZ3Jlc3NBdCA9IDA7XHJcblxyXG4gIC8qKiBTZXJpYWxpemVkIG9wZXJhdGlvbiBxdWV1ZSBcdTIwMTQgZXhhY3RseSBvbmUgYXN5bmMgb3AgcnVucyBhdCBhIHRpbWUuICovXHJcbiAgcHJpdmF0ZSB0YWlsOiBQcm9taXNlPHVua25vd24+ID0gUHJvbWlzZS5yZXNvbHZlKCk7XHJcbiAgcHJpdmF0ZSBxdWV1ZWRPcHMgPSAwO1xyXG4gIC8qKiBTdGFydHVwLXRpbWUgY2hhbmdlIGZsb29kIGlzIGJ1ZmZlcmVkOyB0aGUgZnVsbCBtYW5pZmVzdCBzdWJzdW1lcyBpdC4gKi9cclxuICBwcml2YXRlIGJ1ZmZlcmluZyA9IGZhbHNlO1xyXG4gIHByaXZhdGUgYnVmZmVyZWQ6IE1lc3NhZ2VbXSA9IFtdO1xyXG4gIC8qKlxyXG4gICAqIE91dHN0YW5kaW5nIHJlcXVlc3QgZXhwZWN0YXRpb25zLCBvbGRlc3QgZmlyc3QuIE9wcyBhcmUgc2VyaWFsaXplZCBwZXJcclxuICAgKiBjeWNsZSBFWENFUFQgdGhlIHB1c2ggcGlwZWxpbmUsIHdoaWNoIGtlZXBzIHNldmVyYWwgY29tbWl0cyBpbiBmbGlnaHQgXHUyMDE0XHJcbiAgICogcmVwbGllcyBvbiB0aGUgb3JkZXJlZCBXUyBhcnJpdmUgaW4gc2VuZCBvcmRlciwgc28gbWF0Y2hpbmcgdGhlIE9MREVTVFxyXG4gICAqIGV4cGVjdGF0aW9uIHRoYXQgYWNjZXB0cyBhIG1lc3NhZ2UgcGFpcnMgZXZlcnkgcmVwbHkgd2l0aCBpdHMgcmVxdWVzdFxyXG4gICAqICh0aGUgRE8gYXJiaXRyYXRlcyBiZWhpbmQgYHJ1bkV4Y2x1c2l2ZWAsIGFuZCB0aGUgaW4tbWVtb3J5IHNlcnZlclxyXG4gICAqIG1pcnJvcnMgdGhhdCwgc28gdGhlIHNlcnZlciBuZXZlciByZW9yZGVycyByZXBsaWVzIGVpdGhlcikuXHJcbiAgICovXHJcbiAgcHJpdmF0ZSBleHBlY3RhdGlvbnM6IEFycmF5PHtcclxuICAgIG1hdGNoZXM6IChtZXNzYWdlOiBNZXNzYWdlKSA9PiBib29sZWFuO1xyXG4gICAgcmVzb2x2ZTogKG1lc3NhZ2U6IE1lc3NhZ2UpID0+IHZvaWQ7XHJcbiAgICByZWplY3Q6IChlcnJvcjogRXJyb3IpID0+IHZvaWQ7XHJcbiAgfT4gPSBbXTtcclxuICAvKipcclxuICAgKiBTZXJpYWxpemVzIEFDSyBBUFBMSUNBVElPTiBhY3Jvc3MgcGlwZWxpbmUgc2xvdHMuIFNsb3RzIGF3YWl0IHJlcGxpZXNcclxuICAgKiBjb25jdXJyZW50bHksIGJ1dCBlYWNoIHJlcGx5IGZvbGRzIGludG8gdGhlIFNIQVJFRCBgdGhpcy5pbmRleGBcclxuICAgKiAocmVhZC1tb2RpZnktd3JpdGUpOyBjaGFpbmluZyB0aGUgZm9sZHMga2VlcHMgZXZlcnkgYXBwbHkgYXRvbWljIHdpdGhcclxuICAgKiByZXNwZWN0IHRvIHRoZSBvdGhlcnMuIE9yZGVyIGFjcm9zcyBkaWZmZXJlbnQgcGF0aHMgaXMgaXJyZWxldmFudCAob25lXHJcbiAgICogY29tbWl0IHBlciBwYXRoIHBlciBjeWNsZSwgcGVyLXBhdGggc2VydmVyIGFyYml0cmF0aW9uKSwgc28gbm8gb3JkZXJpbmdcclxuICAgKiBndWFyYW50ZWUgaXMgbmVlZGVkIGJleW9uZCBtdXR1YWwgZXhjbHVzaW9uLlxyXG4gICAqL1xyXG4gIHByaXZhdGUgYWNrQ2hhaW46IFByb21pc2U8dm9pZD4gPSBQcm9taXNlLnJlc29sdmUoKTtcclxuXHJcbiAgY29uc3RydWN0b3Iob3B0aW9uczogU3luY0NsaWVudE9wdGlvbnMpIHtcclxuICAgIHRoaXMub3B0aW9ucyA9IG9wdGlvbnM7XHJcbiAgICB0aGlzLmxvZyA9IG9wdGlvbnMubG9nID8/IGRlZmF1bHRMb2c7XHJcbiAgICB0aGlzLm5vdyA9IG9wdGlvbnMubm93ID8/ICgoKSA9PiBEYXRlLm5vdygpKTtcclxuICAgIHRoaXMuZGVib3VuY2VNcyA9IG9wdGlvbnMuZGVib3VuY2VNcyA/PyAzMDA7XHJcbiAgICB0aGlzLnNjaGVkdWxlID0gb3B0aW9ucy5zY2hlZHVsZSA/PyBkZWZhdWx0U2NoZWR1bGU7XHJcbiAgICB0aGlzLnB1c2hDb25jdXJyZW5jeSA9IE1hdGgubWF4KDEsIG9wdGlvbnMucHVzaENvbmN1cnJlbmN5ID8/IERFRkFVTFRfUFVTSF9DT05DVVJSRU5DWSk7XHJcbiAgICB0aGlzLnByb2dyZXNzVGhyb3R0bGVNcyA9IE1hdGgubWF4KDAsIG9wdGlvbnMucHJvZ3Jlc3NUaHJvdHRsZU1zID8/IERFRkFVTFRfUFJPR1JFU1NfVEhST1RUTEVfTVMpO1xyXG4gICAgdGhpcy5kaWFsVHJhbnNwb3J0ID1cclxuICAgICAgdHlwZW9mIG9wdGlvbnMudHJhbnNwb3J0ID09PSAnZnVuY3Rpb24nXHJcbiAgICAgICAgPyBvcHRpb25zLnRyYW5zcG9ydFxyXG4gICAgICAgIDogKCkgPT4gb3B0aW9ucy50cmFuc3BvcnQgYXMgVHJhbnNwb3J0O1xyXG4gICAgdGhpcy5pZ25vcmVTZXR0aW5ncyA9IG9wdGlvbnMuc2V0dGluZ3MgPz8geyBvYnNpZGlhblN5bmM6IGZhbHNlIH07XHJcbiAgfVxyXG5cclxuICAvLyAtLS0gbGlmZWN5Y2xlIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHJcbiAgLyoqIFJ1biBzdGFydHVwIHJlY29uY2lsaWF0aW9uIGFuZCBlbnRlciBsaXZlIG1vZGUuICovXHJcbiAgYXN5bmMgY29ubmVjdCgpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGF3YWl0IHRoaXMuZW5xdWV1ZSgoKSA9PiB0aGlzLnN0YXJ0dXAoKSk7XHJcbiAgfVxyXG5cclxuICAvKiogUmUtZGlhbCBhbmQgcmUtcnVuIHRoZSBmdWxsIHN0YXJ0dXAgcmVjb25jaWxpYXRpb24uICovXHJcbiAgYXN5bmMgcmVjb25uZWN0KCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgYXdhaXQgdGhpcy5lbnF1ZXVlKGFzeW5jICgpID0+IHtcclxuICAgICAgdGhpcy50cmFuc3BvcnQ/LmNsb3NlKCk7XHJcbiAgICAgIHRoaXMudHJhbnNwb3J0ID0gbnVsbDtcclxuICAgICAgYXdhaXQgdGhpcy5zdGFydHVwKCk7XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIGNsb3NlKCk6IHZvaWQge1xyXG4gICAgdGhpcy5zdG9wV2F0Y2hpbmcoKTtcclxuICAgIHRoaXMuY2FuY2VsRGVib3VuY2U/LigpO1xyXG4gICAgdGhpcy5jYW5jZWxEZWJvdW5jZSA9IG51bGw7XHJcbiAgICB0aGlzLnRyYW5zcG9ydD8uY2xvc2UoKTtcclxuICAgIHRoaXMudHJhbnNwb3J0ID0gbnVsbDtcclxuICAgIHRoaXMuc3RhdGUgPSAnaWRsZSc7XHJcbiAgfVxyXG5cclxuICAvKiogQmVnaW4gZGVib3VuY2VkIHdhdGNoaW5nIChBUkNISVRFQ1RVUkUgXHUwMEE3OCBsaXZlIG9wZXJhdGlvbikuICovXHJcbiAgc3RhcnRXYXRjaGluZyh3YXRjaEFkYXB0ZXI6IFdhdGNoQWRhcHRlcik6IHZvaWQge1xyXG4gICAgdGhpcy5zdG9wV2F0Y2hpbmcoKTtcclxuICAgIHRoaXMud2F0Y2hBZGFwdGVyID0gd2F0Y2hBZGFwdGVyO1xyXG4gICAgd2F0Y2hBZGFwdGVyLnN0YXJ0KChldmVudHMpID0+IHRoaXMub25XYXRjaEV2ZW50cyhldmVudHMpKTtcclxuICB9XHJcblxyXG4gIHN0b3BXYXRjaGluZygpOiB2b2lkIHtcclxuICAgIHRoaXMud2F0Y2hBZGFwdGVyPy5zdG9wKCk7XHJcbiAgICB0aGlzLndhdGNoQWRhcHRlciA9IG51bGw7XHJcbiAgfVxyXG5cclxuICAvKiogTWFudWFsIG9uZS1zaG90IGN5Y2xlIChgdnNhYCBvbmUtc2hvdCwgXCJzeW5jIG5vd1wiIGJ1dHRvbnMsIHRlc3RzKS4gKi9cclxuICBhc3luYyB0cmlnZ2VyU3luYygpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGF3YWl0IHRoaXMuZW5xdWV1ZSgoKSA9PiB0aGlzLnJ1bkN5Y2xlKCkpO1xyXG4gIH1cclxuXHJcbiAgLyoqIFJlc29sdmVzIHdoZW4gZXZlcnkgcXVldWVkIG9wZXJhdGlvbiBoYXMgc2V0dGxlZC4gKi9cclxuICBhc3luYyB3YWl0SWRsZSgpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIHdoaWxlICh0aGlzLnF1ZXVlZE9wcyA+IDApIGF3YWl0IHRoaXMudGFpbDtcclxuICAgIGF3YWl0IHRoaXMudGFpbDtcclxuICB9XHJcblxyXG4gIHN0YXR1cygpOiBTeW5jQ2xpZW50U3RhdHVzIHtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIHN0YXRlOiB0aGlzLnN0YXRlLFxyXG4gICAgICBsYXN0U3luY0F0OiB0aGlzLmxhc3RTeW5jQXQsXHJcbiAgICAgIHBlbmRpbmc6IHRoaXMucGVuZGluZyxcclxuICAgICAgY29uZmxpY3RzOiBbLi4udGhpcy5jb25mbGljdHNdLFxyXG4gICAgICAuLi4odGhpcy5jYXNlQ29sbGlzaW9ucy5sZW5ndGggPiAwID8geyBjYXNlQ29sbGlzaW9uczogWy4uLnRoaXMuY2FzZUNvbGxpc2lvbnNdIH0gOiB7fSksXHJcbiAgICAgIC4uLih0aGlzLnNraXBwZWRQYXRocy5sZW5ndGggPiAwID8geyBza2lwcGVkUGF0aHM6IFsuLi50aGlzLnNraXBwZWRQYXRoc10gfSA6IHt9KSxcclxuICAgICAgc2VydmVyVmVyc2lvbjogdGhpcy5zZXJ2ZXJWZXJzaW9uLFxyXG4gICAgICAuLi4odGhpcy5wcm9ncmVzcyAhPT0gbnVsbCA/IHsgcHJvZ3Jlc3M6IHsgLi4udGhpcy5wcm9ncmVzcyB9IH0gOiB7fSksXHJcbiAgICB9O1xyXG4gIH1cclxuXHJcbiAgLyoqIFJlYWQtb25seSB2aWV3IG9mIHRoZSBsb2NhbCBpbmRleCAodGVzdHMsIGB2c2Egc3RhdHVzYCkuICovXHJcbiAgY3VycmVudEluZGV4KCk6IExvY2FsSW5kZXgge1xyXG4gICAgcmV0dXJuIHsgLi4udGhpcy5pbmRleCB9O1xyXG4gIH1cclxuXHJcbiAgLyoqIExhc3Qgc2VlbiBzZXJ2ZXIgc2VxdWVuY2UgbnVtYmVyLiAqL1xyXG4gIGdldCBjdXJzb3JWYWx1ZSgpOiBudW1iZXIge1xyXG4gICAgcmV0dXJuIHRoaXMuY3Vyc29yO1xyXG4gIH1cclxuXHJcbiAgLyoqIFRTLXNhZmUgc3RhdGUgcHJvYmUgKGFzc2lnbm1lbnRzIGluc2lkZSBhc3luYyBmbG93cyBkZWZlYXQgbmFycm93aW5nKS4gKi9cclxuICBwcml2YXRlIGlzRGlzY29ubmVjdGVkKCk6IGJvb2xlYW4ge1xyXG4gICAgcmV0dXJuIHRoaXMuc3RhdGUgPT09ICdkaXNjb25uZWN0ZWQnO1xyXG4gIH1cclxuXHJcbiAgLy8gLS0tIHN0YXJ0dXAgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHN0YXJ0dXAoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICB0aGlzLnN0YXRlID0gJ2Nvbm5lY3RpbmcnO1xyXG4gICAgdGhpcy5idWZmZXJpbmcgPSB0cnVlO1xyXG4gICAgdGhpcy5idWZmZXJlZCA9IFtdO1xyXG5cclxuICAgIC8vIFJlc3RvcmUgdGhlIGluZGV4IEFORCB0aGUgc3luYy1jdXJzb3IgYm9va2tlZXBpbmcgKG9uZSBhdG9taWMgZmlsZSk6XHJcbiAgICAvLyB0aGUgcGVyc2lzdGVkIGN1cnNvciBsZXRzIGhlbGxvIHJlcGxheSBvbmx5IHdoYXQgd2FzIG1pc3NlZCwgYW5kXHJcbiAgICAvLyBgc3luY2VkVGhyb3VnaGAgZGVjaWRlcyB3aGV0aGVyIGEgZGVsdGEgbWFuaWZlc3QgbWF5IGJlIHJlcXVlc3RlZC5cclxuICAgIC8vIEEgc3RhdGUgZmlsZSB0aGF0IGZhaWxzIHRvIHBhcnNlIG9yIHZhbGlkYXRlIGlzIG1vdmVkIGFzaWRlICh0aGVcclxuICAgIC8vIGNvbmZpZy1zdG9yZSByZWNvdmVyeSBwYXR0ZXJuKSBhbmQgdGhlIGNsaWVudCByZXN5bmNzIGZyb20gYSBGVUxMXHJcbiAgICAvLyBtYW5pZmVzdCBvZmYgYSBmcmVzaCBpbmRleCBcdTIwMTQgb25lIGNvcnJ1cHQgZmllbGQgbXVzdCBub3Qgd2VkZ2UgZXZlcnlcclxuICAgIC8vIGZ1dHVyZSBzdGFydHVwLlxyXG4gICAgaWYgKGF3YWl0IHRoaXMuc2FmZVN0b3JhZ2VFeGlzdHMoTE9DQUxfSU5ERVhfU1RBVEVfUEFUSCkpIHtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBjb25zdCBsb2FkZWQgPSBhd2FpdCBsb2FkTG9jYWxTdGF0ZSh0aGlzLm9wdGlvbnMuc3RvcmFnZSk7XHJcbiAgICAgICAgdGhpcy5pbmRleCA9IGxvYWRlZC5pbmRleDtcclxuICAgICAgICB0aGlzLmN1cnNvciA9IGxvYWRlZC5zdGF0ZS5jdXJzb3I7XHJcbiAgICAgICAgdGhpcy5zeW5jZWRUaHJvdWdoID0gbG9hZGVkLnN0YXRlLnN5bmNlZFRocm91Z2g7XHJcbiAgICAgICAgdGhpcy5uZWVkc0Z1bGxNYW5pZmVzdCA9IGxvYWRlZC5zdGF0ZS5uZWVkc0Z1bGxNYW5pZmVzdDtcclxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICB0cnkge1xyXG4gICAgICAgICAgYXdhaXQgdGhpcy5vcHRpb25zLnN0b3JhZ2UucmVuYW1lRmlsZShcclxuICAgICAgICAgICAgTE9DQUxfSU5ERVhfU1RBVEVfUEFUSCxcclxuICAgICAgICAgICAgYCR7TE9DQUxfSU5ERVhfU1RBVEVfUEFUSH0uY29ycnVwdC5iYWtgLFxyXG4gICAgICAgICAgKTtcclxuICAgICAgICB9IGNhdGNoIHtcclxuICAgICAgICAgIC8vIENvdWxkIG5vdCBtb3ZlIHRoZSBiYWQgZmlsZSBhc2lkZTsgdGhlIGZpcnN0IHBlcnNpc3QgYmVsb3dcclxuICAgICAgICAgIC8vIG92ZXJ3cml0ZXMgaXQsIHNvIHRoZSBjbGllbnQgY2FuIHN0aWxsIG9wZXJhdGUuXHJcbiAgICAgICAgfVxyXG4gICAgICAgIHRoaXMubG9nLndhcm4oXHJcbiAgICAgICAgICAnbG9jYWwgaW5kZXggc3RhdGUgaXMgY29ycnVwdDsgcXVhcmFudGluZWQgdG8gc3RhdGUuY29ycnVwdC5iYWsgYW5kIHJlc3luY2luZyBmcm9tIGEgZnVsbCBtYW5pZmVzdCcsXHJcbiAgICAgICAgICBlcnJvcixcclxuICAgICAgICApO1xyXG4gICAgICAgIHRoaXMucmVzZXRMb2NhbFN0YXRlKCk7XHJcbiAgICAgIH1cclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIHRoaXMucmVzZXRMb2NhbFN0YXRlKCk7XHJcbiAgICB9XHJcbiAgICB0aGlzLnNlcnZlck9sZGVzdFJldGFpbmVkU2VxID0gbnVsbDtcclxuICAgIC8vIFZlcnNpb24gc2tldyBpcyByZS1hc3Nlc3NlZCBwZXIgY29ubmVjdGlvbjogcmVzZXQgYmVmb3JlIHRoZSBhY2sgc28gYVxyXG4gICAgLy8gcmVjb25uZWN0IGFnYWluc3QgYSBkaWZmZXJlbnQgKG9yIGxlZ2FjeSkgc2VydmVyIG5ldmVyIHJlcG9ydHMgYSBzdGFsZVxyXG4gICAgLy8gdmVyc2lvbiBiZXR3ZWVuIHRoZSBkaWFsIGFuZCB0aGUgZnJlc2ggaGVsbG9BY2suXHJcbiAgICB0aGlzLnNlcnZlclZlcnNpb24gPSBudWxsO1xyXG5cclxuICAgIGNvbnN0IHRyYW5zcG9ydCA9IHRoaXMuZGlhbFRyYW5zcG9ydCgpO1xyXG4gICAgdGhpcy50cmFuc3BvcnQgPSB0cmFuc3BvcnQ7XHJcbiAgICB0cmFuc3BvcnQub25NZXNzYWdlKChtZXNzYWdlKSA9PiB0aGlzLm9uVHJhbnNwb3J0TWVzc2FnZShtZXNzYWdlKSk7XHJcbiAgICB0cmFuc3BvcnQub25DbG9zZSgocmVhc29uKSA9PiB0aGlzLm9uVHJhbnNwb3J0Q2xvc2UocmVhc29uKSk7XHJcblxyXG4gICAgY29uc3QgaGVsbG9BY2sgPSBhd2FpdCB0aGlzLnJlcXVlc3Q8SGVsbG9BY2tNZXNzYWdlIHwgU2VydmVyRXJyb3JNZXNzYWdlPihcclxuICAgICAgKG0pID0+IG0udHlwZSA9PT0gJ2hlbGxvQWNrJyB8fCBtLnR5cGUgPT09ICdlcnJvcicsXHJcbiAgICAgICgpID0+XHJcbiAgICAgICAgdHJhbnNwb3J0LnNlbmQoe1xyXG4gICAgICAgICAgdHlwZTogJ2hlbGxvJyxcclxuICAgICAgICAgIHRva2VuOiB0aGlzLm9wdGlvbnMudG9rZW4sXHJcbiAgICAgICAgICBwcm90b2NvbFZlcnNpb246IFByb3RvY29sVmVyc2lvbixcclxuICAgICAgICAgIGN1cnNvcjogdGhpcy5jdXJzb3IsXHJcbiAgICAgICAgfSksXHJcbiAgICApO1xyXG4gICAgaWYgKGhlbGxvQWNrLnR5cGUgPT09ICdlcnJvcicpIHRocm93IHRoaXMudG9FcnJvcihoZWxsb0Fjayk7XHJcbiAgICAvLyBUaGUgc2VydmVyJ3MgcGVyLXZhdWx0IGBvYnNpZGlhblN5bmNgIHN1cGVyc2VkZXMgdGhlIGxvY2FsIGluaXRpYWxcclxuICAgIC8vIHZhbHVlLCBidXQgYGV4dHJhSWdub3Jlc2AgaXMgYSBjbGllbnQtc2lkZSBjb25jZXJuIFx1MjAxNCB0aGUgd29ya2VyIG5ldmVyXHJcbiAgICAvLyBzZW5kcyBpdCwgc28gdGhlIGxvY2FsbHkgY29uZmlndXJlZCBwYXR0ZXJucyBzdXJ2aXZlIHRoZSBoYW5kc2hha2UuXHJcbiAgICB0aGlzLmlnbm9yZVNldHRpbmdzID0ge1xyXG4gICAgICBvYnNpZGlhblN5bmM6IGhlbGxvQWNrLnNldHRpbmdzLm9ic2lkaWFuU3luYyxcclxuICAgICAgLi4uKHRoaXMuaWdub3JlU2V0dGluZ3MuZXh0cmFJZ25vcmVzICE9PSB1bmRlZmluZWRcclxuICAgICAgICA/IHsgZXh0cmFJZ25vcmVzOiB0aGlzLmlnbm9yZVNldHRpbmdzLmV4dHJhSWdub3JlcyB9XHJcbiAgICAgICAgOiB7fSksXHJcbiAgICB9O1xyXG4gICAgLy8gUmVwbGF5LXdpbmRvdyBhbnN3ZXI6IHdpdGggdGhpcywgdGhlIGNsaWVudCBjYW4gdGVsbCB3aGV0aGVyIGV2ZXJ5XHJcbiAgICAvLyBldmVudCBhZnRlciBpdHMgY3Vyc29yIHdhcyByZXRhaW5lZCAoZGVsdGEtbWFuaWZlc3QgZWxpZ2liaWxpdHkpLlxyXG4gICAgdGhpcy5zZXJ2ZXJPbGRlc3RSZXRhaW5lZFNlcSA9IGhlbGxvQWNrLm9sZGVzdFJldGFpbmVkU2VxID8/IG51bGw7XHJcbiAgICB0aGlzLnNlcnZlclZlcnNpb24gPSBoZWxsb0Fjay5zZXJ2ZXJWZXJzaW9uID8/IG51bGw7XHJcblxyXG4gICAgdGhpcy5zdGF0ZSA9ICdzeW5jaW5nJztcclxuICAgIGlmICh0aGlzLnNob3VsZFJlcXVlc3REZWx0YU1hbmlmZXN0KCkpIHtcclxuICAgICAgLy8gREVMVEEgTU9ERTogYXBwbHkgdGhlIHJlcGxheWVkIGNoYW5nZXMgQkVGT1JFIHBsYW5uaW5nLiBUaGUgZGVsdGFcclxuICAgICAgLy8gbWFuaWZlc3Qgb21pdHMgZXZlcnkgaGVhZCBhdCBvciBiZWxvdyB0aGUgY3Vyc29yIFx1MjAxNCBpbmNsdWRpbmcgaGVhZHNcclxuICAgICAgLy8gdGhhdCBubyBsb25nZXIgZXhpc3QgYmVjYXVzZSB0aGUgYXV0aG9yaXR5IE1JR1JBVEVEIHRoZW0gKGEgcmVuYW1lXHJcbiAgICAgIC8vIGRlbGV0ZXMgdGhlIG9sZCByb3cpIFx1MjAxNCBzbyB0aGUgaW5kZXggcHJvamVjdGlvbiBtdXN0IG5vdCBjYXJyeSB0aG9zZVxyXG4gICAgICAvLyBwYXRocyBhbnltb3JlLiBUaGUgcmVwbGF5ZWQgcmVuYW1lIChzZXEgPiBjdXJzb3IpIG1hdGVyaWFsaXplcyBoZXJlXHJcbiAgICAgIC8vIGFuZCByZW1vdmVzIHRoZSBzdGFsZSBwYXRoLCBtYWtpbmcgdGhlIG1lcmdlZCB2aWV3IGlkZW50aWNhbCB0byB3aGF0XHJcbiAgICAgIC8vIGEgZnVsbCBtYW5pZmVzdCB3b3VsZCBoYXZlIHNhaWQuIChUaGUgb3JkZXJlZCB3aXJlIGd1YXJhbnRlZXMgdGhlXHJcbiAgICAgIC8vIHJlcGxheSBwcmVjZWRlcyB0aGUgbWFuaWZlc3QgcmVwbHk7IGFueXRoaW5nIHN0cmFnZ2xpbmcgc3RheXNcclxuICAgICAgLy8gYnVmZmVyZWQgYW5kIGlzIGRpc3BhdGNoZWQgYWZ0ZXIgdGhlIGN5Y2xlLCBhcyBhbHdheXMuKSBBIHJlcGxheWVkXHJcbiAgICAgIC8vIGNoYW5nZSB0aGF0IGhpdHMgdGhlIGRpdmVyZ2VuY2UgZ3VhcmQgZmxpcHMgYG5lZWRzRnVsbE1hbmlmZXN0YCxcclxuICAgICAgLy8gYW5kIGBmZXRjaE1hbmlmZXN0YCByZS1ldmFsdWF0ZXMgXHUyMDE0IGZhbGxpbmcgYmFjayB0byBmdWxsLCBhcyBkZXNpZ25lZC5cclxuICAgICAgY29uc3QgcmVwbGF5ID0gdGhpcy5idWZmZXJlZDtcclxuICAgICAgdGhpcy5idWZmZXJlZCA9IFtdO1xyXG4gICAgICBmb3IgKGNvbnN0IG1lc3NhZ2Ugb2YgcmVwbGF5KSB7XHJcbiAgICAgICAgYXdhaXQgdGhpcy5kaXNwYXRjaChtZXNzYWdlKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgYXdhaXQgdGhpcy5ydW5DeWNsZSgpO1xyXG5cclxuICAgIHRoaXMuYnVmZmVyaW5nID0gZmFsc2U7XHJcbiAgICBjb25zdCBidWZmZXJlZCA9IHRoaXMuYnVmZmVyZWQ7XHJcbiAgICB0aGlzLmJ1ZmZlcmVkID0gW107XHJcbiAgICBmb3IgKGNvbnN0IG1lc3NhZ2Ugb2YgYnVmZmVyZWQpIHtcclxuICAgICAgYXdhaXQgdGhpcy5kaXNwYXRjaChtZXNzYWdlKTtcclxuICAgIH1cclxuICAgIGlmICghdGhpcy5pc0Rpc2Nvbm5lY3RlZCgpKSB0aGlzLnN0YXRlID0gJ2xpdmUnO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBzYWZlU3RvcmFnZUV4aXN0cyhwYXRoOiBzdHJpbmcpOiBQcm9taXNlPGJvb2xlYW4+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLm9wdGlvbnMuc3RvcmFnZS5leGlzdHMocGF0aCk7XHJcbiAgICB9IGNhdGNoIHtcclxuICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqIEZyZXNoIGluZGV4ICsgY3Vyc29yIGJvb2trZWVwaW5nOiBubyBwcmlvciBrbm93bGVkZ2UsIGZ1bGwgbWFuaWZlc3QuICovXHJcbiAgcHJpdmF0ZSByZXNldExvY2FsU3RhdGUoKTogdm9pZCB7XHJcbiAgICB0aGlzLmluZGV4ID0ge307XHJcbiAgICB0aGlzLmN1cnNvciA9IDA7XHJcbiAgICB0aGlzLnN5bmNlZFRocm91Z2ggPSBudWxsO1xyXG4gICAgdGhpcy5uZWVkc0Z1bGxNYW5pZmVzdCA9IGZhbHNlO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBvblRyYW5zcG9ydENsb3NlKHJlYXNvbjogeyBjb2RlPzogbnVtYmVyOyByZWFzb24/OiBzdHJpbmcgfSk6IHZvaWQge1xyXG4gICAgdGhpcy5sb2cud2FybigndHJhbnNwb3J0IGNsb3NlZCcsIHJlYXNvbik7XHJcbiAgICB0aGlzLnN0YXRlID0gJ2Rpc2Nvbm5lY3RlZCc7XHJcbiAgICBjb25zdCBleHBlY3RhdGlvbnMgPSB0aGlzLmV4cGVjdGF0aW9ucztcclxuICAgIHRoaXMuZXhwZWN0YXRpb25zID0gW107XHJcbiAgICBmb3IgKGNvbnN0IGV4cGVjdGF0aW9uIG9mIGV4cGVjdGF0aW9ucykge1xyXG4gICAgICBleHBlY3RhdGlvbi5yZWplY3QoXHJcbiAgICAgICAgbmV3IE5ldHdvcmtFcnJvcihgY29ubmVjdGlvbiBjbG9zZWQ6ICR7cmVhc29uLnJlYXNvbiA/PyByZWFzb24uY29kZSA/PyAndW5rbm93bid9YCksXHJcbiAgICAgICk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvLyAtLS0gbWVzc2FnZSBwdW1wIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHJcbiAgcHJpdmF0ZSBvblRyYW5zcG9ydE1lc3NhZ2UgPSAobWVzc2FnZTogTWVzc2FnZSk6IHZvaWQgPT4ge1xyXG4gICAgLy8gT2xkZXN0IGV4cGVjdGF0aW9uIHRoYXQgYWNjZXB0cyB0aGlzIG1lc3NhZ2UuIFdpdGggdGhlIHB1c2ggcGlwZWxpbmVcclxuICAgIC8vIHNldmVyYWwgY29tbWl0IGV4cGVjdGF0aW9ucyBhcmUgb3V0c3RhbmRpbmcgYXQgb25jZTsgdGhlIG9yZGVyZWQgd2lyZSArXHJcbiAgICAvLyB0aGUgc2VydmVyJ3Mgc2VyaWFsaXplZCBhcmJpdHJhdGlvbiBkZWxpdmVyIHJlcGxpZXMgaW4gc2VuZCBvcmRlciwgc29cclxuICAgIC8vIGZpcnN0LW1hdGNoIHBhaXJzIGVhY2ggcmVwbHkgd2l0aCBpdHMgb3duIHJlcXVlc3QuXHJcbiAgICBjb25zdCBpbmRleCA9IHRoaXMuZXhwZWN0YXRpb25zLmZpbmRJbmRleCgoZXhwZWN0YXRpb24pID0+IGV4cGVjdGF0aW9uLm1hdGNoZXMobWVzc2FnZSkpO1xyXG4gICAgaWYgKGluZGV4ID49IDApIHtcclxuICAgICAgY29uc3QgZXhwZWN0YXRpb24gPSB0aGlzLmV4cGVjdGF0aW9uc1tpbmRleF07XHJcbiAgICAgIHRoaXMuZXhwZWN0YXRpb25zLnNwbGljZShpbmRleCwgMSk7XHJcbiAgICAgIGlmIChleHBlY3RhdGlvbiAhPT0gdW5kZWZpbmVkKSBleHBlY3RhdGlvbi5yZXNvbHZlKG1lc3NhZ2UpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBpZiAodGhpcy5idWZmZXJpbmcpIHtcclxuICAgICAgdGhpcy5idWZmZXJlZC5wdXNoKG1lc3NhZ2UpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICB0aGlzLmVucXVldWUoYXN5bmMgKCkgPT4ge1xyXG4gICAgICBhd2FpdCB0aGlzLmRpc3BhdGNoKG1lc3NhZ2UpO1xyXG4gICAgfSkuY2F0Y2goKGVycm9yOiB1bmtub3duKSA9PiB0aGlzLmxvZy53YXJuKCdjaGFuZ2UgaGFuZGxlciBmYWlsZWQnLCBlcnJvcikpO1xyXG4gIH07XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgZGlzcGF0Y2gobWVzc2FnZTogTWVzc2FnZSk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgc3dpdGNoIChtZXNzYWdlLnR5cGUpIHtcclxuICAgICAgY2FzZSAnY2hhbmdlJzpcclxuICAgICAgICBhd2FpdCB0aGlzLmhhbmRsZUNoYW5nZShtZXNzYWdlKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIGNhc2UgJ2RldmljZVNlZW4nOlxyXG4gICAgICAgIHJldHVybjsgLy8gcHJlc2VuY2Ugb25seTsgZGFzaGJvYXJkcyBjb25zdW1lIGl0XHJcbiAgICAgIGNhc2UgJ3BvbmcnOlxyXG4gICAgICAgIHJldHVybjtcclxuICAgICAgY2FzZSAnZXJyb3InOlxyXG4gICAgICAgIHRoaXMubG9nLmVycm9yKCdzZXJ2ZXIgZXJyb3InLCBtZXNzYWdlLmNvZGUsIG1lc3NhZ2UubWVzc2FnZSk7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgICBjYXNlICdoZWxsb0Fjayc6XHJcbiAgICAgIGNhc2UgJ21hbmlmZXN0JzpcclxuICAgICAgY2FzZSAnY29tbWl0QWNrJzpcclxuICAgICAgY2FzZSAnY29uZmxpY3QnOlxyXG4gICAgICBjYXNlICdibG9iJzpcclxuICAgICAgY2FzZSAnYmxvYkFjayc6XHJcbiAgICAgIGNhc2UgJ3NuYXBzaG90Q3JlYXRlQWNrJzpcclxuICAgICAgY2FzZSAnc25hcHNob3RSZXN0b3JlQWNrJzpcclxuICAgICAgICAvLyBSZXBsaWVzIGFycml2ZSBvbmx5IGFnYWluc3QgYW4gb3V0c3RhbmRpbmcgZXhwZWN0YXRpb247IGFcclxuICAgICAgICAvLyBzcG9udGFuZW91cyBvbmUgaXMgYSBwcm90b2NvbCB2aW9sYXRpb24gd2UgbG9nIGFuZCBkcm9wLlxyXG4gICAgICAgIHRoaXMubG9nLndhcm4oJ3VuZXhwZWN0ZWQgc2VydmVyIHJlcGx5JywgbWVzc2FnZS50eXBlKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIGRlZmF1bHQ6XHJcbiAgICAgICAgdGhpcy5sb2cud2FybignaWdub3JpbmcgY2xpZW50LXRvLXNlcnZlciBtZXNzYWdlIGZyb20gc2VydmVyJywgbWVzc2FnZSk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGhhbmRsZUNoYW5nZShjaGFuZ2U6IENoYW5nZU1lc3NhZ2UpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIHZhbGlkYXRlQ2hhbmdlTWVzc2FnZShjaGFuZ2UpO1xyXG4gICAgaWYgKGNoYW5nZS5zZXEgPiB0aGlzLmN1cnNvcikgdGhpcy5jdXJzb3IgPSBjaGFuZ2Uuc2VxO1xyXG4gICAgLy8gV2luZG93cy11bnNhZmUgcGF0aHMgY2FuIG5ldmVyIGJlIG1hdGVyaWFsaXplZCBoZXJlOiBza2lwIHRoZSBoZWFkXHJcbiAgICAvLyAoZGlhZ25vc2VkLCBub3QgYXBwbGllZCkgaW5zdGVhZCBvZiBmYWlsaW5nIHRoZSBoYW5kbGVyIGV2ZXJ5IHRpbWUuXHJcbiAgICAvLyBDaGVja2VkIGJlZm9yZSB0aGUgaWdub3JlIHJ1bGVzIFx1MjAxNCBhbiB1bnN5bmNhYmxlIHBhdGggaXMgbmV2ZXIgaWdub3JlZFxyXG4gICAgLy8gc2lsZW50bHkuXHJcbiAgICBjb25zdCB1bnNhZmUgPSBmaXJzdFVuc2FmZVBhdGgoXHJcbiAgICAgIGNoYW5nZS5mcm9tUGF0aCAhPT0gdW5kZWZpbmVkID8gW2NoYW5nZS5wYXRoLCBjaGFuZ2UuZnJvbVBhdGhdIDogW2NoYW5nZS5wYXRoXSxcclxuICAgICk7XHJcbiAgICBpZiAodW5zYWZlICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgdGhpcy5yZWNvcmRTa2lwcGVkUGF0aCh1bnNhZmUpO1xyXG4gICAgICAvLyBUaGUgaGVhZCBpcyByZXNvbHZlZCBcdTIwMTQgYnkgc2tpcHBpbmcgXHUyMDE0IHNvIHRoZSBjb21wbGV0aW9uIHdhdGVybWFya1xyXG4gICAgICAvLyBhZHZhbmNlcyB3aXRoIHRoZSBmZWVkIGxpa2UgYW4gYXBwbGllZCBjaGFuZ2Ugd291bGQuXHJcbiAgICAgIGlmIChjaGFuZ2Uuc2VxID4gKHRoaXMuc3luY2VkVGhyb3VnaCA/PyAwKSkgdGhpcy5zeW5jZWRUaHJvdWdoID0gY2hhbmdlLnNlcTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgaWYgKGlzSWdub3JlZChjaGFuZ2UucGF0aCwgdGhpcy5pZ25vcmVTZXR0aW5ncykpIHJldHVybjtcclxuICAgIGlmIChjaGFuZ2UuZnJvbVBhdGggIT09IHVuZGVmaW5lZCAmJiBpc0lnbm9yZWQoY2hhbmdlLmZyb21QYXRoLCB0aGlzLmlnbm9yZVNldHRpbmdzKSkgcmV0dXJuO1xyXG5cclxuICAgIC8vIFN0YWxlIHJlcGxheSAvIGR1cGxpY2F0ZSBmYW4tb3V0OiBwZXIgcGF0aCB0aGUgaGVhZCBjbG9jayBkb21pbmF0ZXNcclxuICAgIC8vIGV2ZXJ5IGVhcmxpZXIgdmVyc2lvbiwgc28gYW55dGhpbmcgXHUyMjY0IHRoZSByZWNvcmRlZCBjbG9jayBpcyBvbGQgbmV3cy5cclxuICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5pbmRleFtjaGFuZ2UucGF0aF07XHJcbiAgICBpZiAoZW50cnkgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICBpZiAoZW50cnkudmVyc2lvbklkID09PSBjaGFuZ2UudmVyc2lvbikgcmV0dXJuO1xyXG4gICAgICBpZiAoY29tcGFyZUNsb2NrcyhlbnRyeS5jbG9jaywgY2hhbmdlLmNsb2NrKSA+PSAwKSByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgLy8gVGhlIGd1YXJkOiBuZXZlciB3cml0ZSBhIHJlbW90ZSBjaGFuZ2Ugb3ZlciBsb2NhbGx5LWRpdmVyZ2VkIGNvbnRlbnQuXHJcbiAgICBpZiAoIShhd2FpdCB0aGlzLmNoYW5nZUlzU2FmZShjaGFuZ2UpKSkge1xyXG4gICAgICB0aGlzLmxvZy5pbmZvKCdkZWZlcnJpbmcgcmVtb3RlIGNoYW5nZSBvdmVyIGxvY2FsIGRpdmVyZ2VuY2UnLCBjaGFuZ2UucGF0aCk7XHJcbiAgICAgIC8vIFRoZSBkaXZlcmdlbmNlIG11c3QgYmUgcmVzb2x2ZWQgYnkgYSBwbGFuIGN5Y2xlIHRoYXQgY2FuIFNFRSB0aGVcclxuICAgICAgLy8gcmVtb3RlIGhlYWQgXHUyMDE0IGZsYWcgdGhlIG5leHQgbWFuaWZlc3QgZnVsbCAoZGVsdGEgbWFuaWZlc3RzIG9taXRcclxuICAgICAgLy8gaGVhZHMgYXQgb3IgYmVsb3cgdGhlIGN1cnNvciwgd2hpY2ggdGhpcyBjaGFuZ2UgbWF5IGJlIGF0KS5cclxuICAgICAgdGhpcy5uZWVkc0Z1bGxNYW5pZmVzdCA9IHRydWU7XHJcbiAgICAgIHRoaXMuc2NoZWR1bGVSZWNvbmNpbGUoKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIHRoaXMuaW5kZXggPSBhd2FpdCB0aGlzLmFwcGx5UHVsbHMoW3RoaXMucHVsbE9wRnJvbUNoYW5nZShjaGFuZ2UpXSk7XHJcbiAgICAvLyBUaGlzIHBhdGgncyBoZWFkIGlzIG5vdyBtYXRlcmlhbGl6ZWQgbG9jYWxseSwgc28gdGhlIGNvbXBsZXRpb25cclxuICAgIC8vIHdhdGVybWFyayBhZHZhbmNlcyB3aXRoIHRoZSAoc3RyaWN0bHkgb3JkZXJlZCkgZmVlZC4gQSBjaGFuZ2UgdGhhdFxyXG4gICAgLy8gdG9vayB0aGUgZGVmZXIgYnJhbmNoIGFib3ZlIG5ldmVyIHJlYWNoZXMgdGhpcyBsaW5lLCBhbmQgaXRzXHJcbiAgICAvLyBgbmVlZHNGdWxsTWFuaWZlc3RgIGZsYWcga2VlcHMgZGVsdGEgbW9kZSBvZmYgdW50aWwgYSBmdWxsLW1hbmlmZXN0XHJcbiAgICAvLyBjeWNsZSByZXNvbHZlcyB0aGUgZGl2ZXJnZW5jZS5cclxuICAgIGlmIChjaGFuZ2Uuc2VxID4gKHRoaXMuc3luY2VkVGhyb3VnaCA/PyAwKSkgdGhpcy5zeW5jZWRUaHJvdWdoID0gY2hhbmdlLnNlcTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEEgY2hhbmdlIG1heSBiZSBhcHBsaWVkIGRpcmVjdGx5IG9ubHkgd2hlbiB0aGUgdG91Y2hlZCBwYXRocyBjYXJyeSBub1xyXG4gICAqIHVuLXJlY29uY2lsZWQgbG9jYWwgY29udGVudC4gQW55dGhpbmcgZWxzZSBtdXN0IGRldG91ciB0aHJvdWdoIGEgZnVsbFxyXG4gICAqIGBjb21wdXRlU3luY1BsYW5gIGN5Y2xlIChjb25mbGljdCBsb2dpYywgY29uZmxpY3QgY29waWVzKS5cclxuICAgKi9cclxuICBwcml2YXRlIGFzeW5jIGNoYW5nZUlzU2FmZShjaGFuZ2U6IENoYW5nZU1lc3NhZ2UpOiBQcm9taXNlPGJvb2xlYW4+IHtcclxuICAgIGlmIChjaGFuZ2UuaXNGb2xkZXIgPT09IHRydWUpIHJldHVybiB0cnVlO1xyXG4gICAgaWYgKGNoYW5nZS5raW5kID09PSAncmVuYW1lJyAmJiBjaGFuZ2UuZnJvbVBhdGggIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICBpZiAoYXdhaXQgdGhpcy5wYXRoSGFzTG9jYWxEaXZlcmdlbmNlKGNoYW5nZS5mcm9tUGF0aCkpIHJldHVybiBmYWxzZTtcclxuICAgICAgaWYgKGF3YWl0IHRoaXMuc3RvcmFnZUV4aXN0cyhjaGFuZ2UucGF0aCkpIHtcclxuICAgICAgICBjb25zdCBlbnRyeSA9IHRoaXMuaW5kZXhbY2hhbmdlLnBhdGhdO1xyXG4gICAgICAgIGlmIChlbnRyeSA9PT0gdW5kZWZpbmVkIHx8IGVudHJ5LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkKSByZXR1cm4gZmFsc2U7XHJcbiAgICAgICAgY29uc3QgYWN0dWFsID0gYXdhaXQgc2hhMjU2SGV4KGF3YWl0IHRoaXMub3B0aW9ucy5zdG9yYWdlLnJlYWRGaWxlKGNoYW5nZS5wYXRoKSk7XHJcbiAgICAgICAgaWYgKGFjdHVhbCAhPT0gZW50cnkuaGFzaCkgcmV0dXJuIGZhbHNlO1xyXG4gICAgICB9XHJcbiAgICAgIHJldHVybiB0cnVlO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuICEoYXdhaXQgdGhpcy5wYXRoSGFzTG9jYWxEaXZlcmdlbmNlKGNoYW5nZS5wYXRoKSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHBhdGhIYXNMb2NhbERpdmVyZ2VuY2UocGF0aDogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XHJcbiAgICBjb25zdCBlbnRyeSA9IHRoaXMuaW5kZXhbcGF0aF07XHJcbiAgICBpZiAoZW50cnk/LmlzRm9sZGVyKSByZXR1cm4gZmFsc2U7XHJcbiAgICBpZiAoIShhd2FpdCB0aGlzLnN0b3JhZ2VFeGlzdHMocGF0aCkpKSByZXR1cm4gZmFsc2U7XHJcbiAgICBpZiAoZW50cnkgPT09IHVuZGVmaW5lZCB8fCBlbnRyeS5kZWxldGVkQXQgIT09IHVuZGVmaW5lZCkgcmV0dXJuIHRydWU7XHJcbiAgICBjb25zdCBhY3R1YWwgPSBhd2FpdCBzaGEyNTZIZXgoYXdhaXQgdGhpcy5vcHRpb25zLnN0b3JhZ2UucmVhZEZpbGUocGF0aCkpO1xyXG4gICAgcmV0dXJuIGFjdHVhbCAhPT0gZW50cnkuaGFzaDtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgc3RvcmFnZUV4aXN0cyhwYXRoOiBzdHJpbmcpOiBQcm9taXNlPGJvb2xlYW4+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLm9wdGlvbnMuc3RvcmFnZS5leGlzdHMocGF0aCk7XHJcbiAgICB9IGNhdGNoIHtcclxuICAgICAgcmV0dXJuIGZhbHNlO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBwdWxsT3BGcm9tQ2hhbmdlKGNoYW5nZTogQ2hhbmdlTWVzc2FnZSk6IFB1bGxPcCB7XHJcbiAgICBpZiAoY2hhbmdlLmtpbmQgPT09ICdyZW5hbWUnICYmIGNoYW5nZS5mcm9tUGF0aCAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAga2luZDogJ3JlbmFtZScsXHJcbiAgICAgICAgZnJvbVBhdGg6IGNoYW5nZS5mcm9tUGF0aCxcclxuICAgICAgICB0b1BhdGg6IGNoYW5nZS5wYXRoLFxyXG4gICAgICAgIGhhc2g6IGNoYW5nZS5oYXNoLFxyXG4gICAgICAgIHNpemU6IGNoYW5nZS5zaXplLFxyXG4gICAgICAgIHZlcnNpb246IGNoYW5nZS52ZXJzaW9uLFxyXG4gICAgICAgIGNsb2NrOiBjaGFuZ2UuY2xvY2ssXHJcbiAgICAgICAgLy8gQSBmb2xkZXIgcmVuYW1lIGlzIGEgbWV0YWRhdGEgbW92ZSAoaGFzaCAnJyk7IHdpdGhvdXQgdGhlIGZsYWcgdGhlXHJcbiAgICAgICAgLy8gZW5naW5lJ3MgcmVuYW1lIGJyYW5jaCB3b3VsZCBmZXRjaCBjb250ZW50IGZvciB0aGUgZW1wdHkgaGFzaCB3aGVuXHJcbiAgICAgICAgLy8gZnJvbVBhdGggaXMgYWxyZWFkeSBnb25lIGxvY2FsbHkgKHRydWUgb24gdGhlIGF1dGhvcikgXHUyMDE0IHRoZSBleGFjdFxyXG4gICAgICAgIC8vIHdlZGdlIHRoZSBlbXB0eS1oYXNoIGd1YXJkIGV4aXN0cyB0byBjYXRjaC5cclxuICAgICAgICAuLi4oY2hhbmdlLmlzRm9sZGVyID09PSB0cnVlID8geyBpc0ZvbGRlcjogdHJ1ZSB9IDoge30pLFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG4gICAgY29uc3QgZW50cnkgPSB0aGlzLmluZGV4W2NoYW5nZS5wYXRoXTtcclxuICAgIGNvbnN0IGtpbmQ6IFB1bGxGaWxlT3BbJ2tpbmQnXSA9IGNoYW5nZS5kZWxldGVkXHJcbiAgICAgID8gJ2RlbGV0ZSdcclxuICAgICAgOiBlbnRyeSA9PT0gdW5kZWZpbmVkXHJcbiAgICAgICAgPyAnYWRkJ1xyXG4gICAgICAgIDogZW50cnkuZGVsZXRlZEF0ICE9PSB1bmRlZmluZWRcclxuICAgICAgICAgID8gJ3Jlc3RvcmUnXHJcbiAgICAgICAgICA6ICdlZGl0JztcclxuICAgIHJldHVybiB7XHJcbiAgICAgIGtpbmQsXHJcbiAgICAgIHBhdGg6IGNoYW5nZS5wYXRoLFxyXG4gICAgICBoYXNoOiBjaGFuZ2UuaGFzaCxcclxuICAgICAgc2l6ZTogY2hhbmdlLnNpemUsXHJcbiAgICAgIHZlcnNpb246IGNoYW5nZS52ZXJzaW9uLFxyXG4gICAgICBjbG9jazogY2hhbmdlLmNsb2NrLFxyXG4gICAgICBkZWxldGVkOiBjaGFuZ2UuZGVsZXRlZCxcclxuICAgICAgLi4uKGNoYW5nZS5pc0ZvbGRlciA9PT0gdHJ1ZSA/IHsgaXNGb2xkZXI6IHRydWUgfSA6IHt9KSxcclxuICAgIH07XHJcbiAgfVxyXG5cclxuICAvKiogTWF0ZXJpYWxpemUgcHVsbHMgdGhyb3VnaCB0aGUgdmVyaWZpZWQgZW5naW5lIHBhdGg7IHJldHVybnMgdGhlIG5ldyBpbmRleC4gKi9cclxuICBwcml2YXRlIGFzeW5jIGFwcGx5UHVsbHMoXHJcbiAgICBwdWxsczogUmVhZG9ubHlBcnJheTxQdWxsT3A+LFxyXG4gICAgcHJvZ3Jlc3M/OiB7IG9uUHJvZ3Jlc3M6IChkb25lOiBudW1iZXIsIHRvdGFsOiBudW1iZXIpID0+IHZvaWQgfSxcclxuICApOiBQcm9taXNlPExvY2FsSW5kZXg+IHtcclxuICAgIC8vIFB1bGxzIHdob3NlIHRhcmdldCBwYXRoIGlzIFdpbmRvd3MtdW5zYWZlIHdvdWxkIHRocm93IGluIHRoZSBhZGFwdGVyXHJcbiAgICAvLyBldmVyeSBjeWNsZTsgdGhleSBhcmUgc2tpcHBlZCBhbmQgZGlhZ25vc2VkIGluc3RlYWQgKGEgbGF0ZXIgdmVyc2lvblxyXG4gICAgLy8gY2hhbmdlIGF0IHRoZSBwYXRoIGlzIGF0dGVtcHRlZCBhZ2FpbikuXHJcbiAgICBjb25zdCBtYXRlcmlhbGl6YWJsZTogUHVsbE9wW10gPSBbXTtcclxuICAgIGZvciAoY29uc3QgcHVsbCBvZiBwdWxscykge1xyXG4gICAgICBjb25zdCB1bnNhZmUgPSBmaXJzdFVuc2FmZVBhdGgocHVsbFRhcmdldHMocHVsbCkpO1xyXG4gICAgICBpZiAodW5zYWZlID09PSB1bmRlZmluZWQpIHtcclxuICAgICAgICBtYXRlcmlhbGl6YWJsZS5wdXNoKHB1bGwpO1xyXG4gICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICB9XHJcbiAgICAgIHRoaXMucmVjb3JkU2tpcHBlZFBhdGgodW5zYWZlKTtcclxuICAgIH1cclxuICAgIHJldHVybiBhcHBseVB1bGwoXHJcbiAgICAgIHRoaXMub3B0aW9ucy5zdG9yYWdlLFxyXG4gICAgICB0aGlzLmluZGV4LFxyXG4gICAgICB7IHB1c2hlczogW10sIHB1bGxzOiBtYXRlcmlhbGl6YWJsZSwgY29uZmxpY3RzOiBbXSwgZm9sZGVyUHVzaGVzOiBbXSB9LFxyXG4gICAgICB0aGlzLmZldGNoQmxvYixcclxuICAgICAge1xyXG4gICAgICAgIG5vdzogdGhpcy5ub3coKSxcclxuICAgICAgICAvLyBLZWVwIHRoZSBlbnZlbG9wZSdzIGN1cnNvciBib29ra2VlcGluZyBpbnRhY3QgYWNyb3NzIHB1bGwtc2lkZVxyXG4gICAgICAgIC8vIHBlcnNpc3RzIChhcHBseVB1bGwgcmV3cml0ZXMgdGhlIHdob2xlIHN0YXRlIGZpbGUpLlxyXG4gICAgICAgIHBlcnNpc3RlZFN0YXRlOiB0aGlzLnBlcnNpc3RlZFN0YXRlKCksXHJcbiAgICAgICAgLi4uKHByb2dyZXNzICE9PSB1bmRlZmluZWQgPyB7IG9uUHJvZ3Jlc3M6IHByb2dyZXNzLm9uUHJvZ3Jlc3MgfSA6IHt9KSxcclxuICAgICAgfSxcclxuICAgICk7XHJcbiAgfVxyXG5cclxuICAvKiogVGhlIGVudmVsb3BlIGJvb2trZWVwaW5nIHdyaXR0ZW4gd2hlbmV2ZXIgdGhlIGNsaWVudCBwZXJzaXN0cyB0aGUgaW5kZXguICovXHJcbiAgcHJpdmF0ZSBwZXJzaXN0ZWRTdGF0ZSgpOiBQZXJzaXN0ZWRTeW5jU3RhdGUge1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgY3Vyc29yOiB0aGlzLmN1cnNvcixcclxuICAgICAgc3luY2VkVGhyb3VnaDogdGhpcy5zeW5jZWRUaHJvdWdoLFxyXG4gICAgICBuZWVkc0Z1bGxNYW5pZmVzdDogdGhpcy5uZWVkc0Z1bGxNYW5pZmVzdCxcclxuICAgIH07XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBSZWNvcmQgYSBwYXRoIHRoZSBjeWNsZSBjb3VsZCBub3Qgc3luYyBiZWNhdXNlIGl0cyBuYW1lIGlzXHJcbiAgICogV2luZG93cy11bnNhZmUgKGBwYXRocy50c2ApOiBzdXJmYWNlZCBvbiBgc3RhdHVzKCkuc2tpcHBlZFBhdGhzYCBhbmRcclxuICAgKiBsb2dnZWQgb25jZSBwZXIgcmVjb3JkIHVudGlsIGEgaHVtYW4gcmVuYW1lcyBpdC4gRGVkdXBlZDsgcmVwbGFjZWQgYXRcclxuICAgKiB0aGUgc3RhcnQgb2YgZXZlcnkgY3ljbGUuXHJcbiAgICovXHJcbiAgcHJpdmF0ZSByZWNvcmRTa2lwcGVkUGF0aChwYXRoOiBzdHJpbmcpOiB2b2lkIHtcclxuICAgIGlmICh0aGlzLnNraXBwZWRQYXRocy5pbmNsdWRlcyhwYXRoKSkgcmV0dXJuO1xyXG4gICAgdGhpcy5za2lwcGVkUGF0aHMucHVzaChwYXRoKTtcclxuICAgIHRoaXMubG9nLndhcm4oXHJcbiAgICAgICdza2lwcGluZyBhIFdpbmRvd3MtdW5zYWZlIHBhdGggKHJlc2VydmVkIGRldmljZSBuYW1lIG9yIHRyYWlsaW5nIGRvdC9zcGFjZSk7IHJlbmFtZSBpdCB0byBzeW5jJyxcclxuICAgICAgcGF0aCxcclxuICAgICk7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBSZWNvcmQgb25lIGJ1bGstcGhhc2Ugc3RlcCBvbiBgc3RhdHVzKCkucHJvZ3Jlc3NgLiBDb2FsZXNjZWQgdG8gYXQgbW9zdFxyXG4gICAqIG9uZSB1cGRhdGUgcGVyIGBwcm9ncmVzc1Rocm90dGxlTXNgIChyZW5kZXJlciBjaHVybiksIEVYQ0VQVCBwaGFzZVxyXG4gICAqIGNoYW5nZXMgYW5kIGNvbXBsZXRpb25zLCB3aGljaCBhbHdheXMgZW1pdCBzbyBhIHBoYXNlIGlzIG5ldmVyIG1pc3NlZFxyXG4gICAqIGFuZCBgZG9uZS90b3RhbGAgYWx3YXlzIGxhbmRzIG9uIGl0cyBmaW5hbCB2YWx1ZS5cclxuICAgKi9cclxuICBwcml2YXRlIGVtaXRQcm9ncmVzcyhwaGFzZTogU3luY1BoYXNlLCBkb25lOiBudW1iZXIsIHRvdGFsOiBudW1iZXIpOiB2b2lkIHtcclxuICAgIGlmICh0b3RhbCA9PT0gMCkgcmV0dXJuOyAvLyBub3RoaW5nIHRvIHNob3cgZm9yIGFuIGVtcHR5IHBoYXNlXHJcbiAgICBjb25zdCBub3cgPSB0aGlzLm5vdygpO1xyXG4gICAgY29uc3QgY29tcGxldGUgPSBkb25lID49IHRvdGFsO1xyXG4gICAgY29uc3QgcGhhc2VDaGFuZ2VkID0gdGhpcy5wcm9ncmVzcz8ucGhhc2UgIT09IHBoYXNlO1xyXG4gICAgaWYgKCFjb21wbGV0ZSAmJiAhcGhhc2VDaGFuZ2VkICYmIG5vdyAtIHRoaXMubGFzdFByb2dyZXNzQXQgPCB0aGlzLnByb2dyZXNzVGhyb3R0bGVNcykgcmV0dXJuO1xyXG4gICAgdGhpcy5sYXN0UHJvZ3Jlc3NBdCA9IG5vdztcclxuICAgIHRoaXMucHJvZ3Jlc3MgPSB7IHBoYXNlLCBkb25lLCB0b3RhbCB9O1xyXG4gIH1cclxuXHJcbiAgLy8gLS0tIHdhdGNoZXIgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblxyXG4gIHByaXZhdGUgb25XYXRjaEV2ZW50cyhldmVudHM6IFJlYWRvbmx5QXJyYXk8eyBwYXRoOiBzdHJpbmcgfT4pOiB2b2lkIHtcclxuICAgIGNvbnN0IHJlbGV2YW50ID0gZXZlbnRzLmZpbHRlcigoZXZlbnQpID0+ICFpc0lnbm9yZWQoZXZlbnQucGF0aCwgdGhpcy5pZ25vcmVTZXR0aW5ncykpO1xyXG4gICAgaWYgKHJlbGV2YW50Lmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xyXG4gICAgdGhpcy5wZW5kaW5nICs9IHJlbGV2YW50Lmxlbmd0aDtcclxuICAgIHRoaXMuc2NoZWR1bGVSZWNvbmNpbGUoKTtcclxuICB9XHJcblxyXG4gIC8qKiBEZWJvdW5jZWQgc2Nhblx1MjE5MnBsYW5cdTIxOTJleGVjdXRlIChzaGFyZWQgYnkgd2F0Y2hlciBhbmQgZGVmZXJyZWQgY2hhbmdlcykuICovXHJcbiAgcHJpdmF0ZSBzY2hlZHVsZVJlY29uY2lsZSgpOiB2b2lkIHtcclxuICAgIHRoaXMuY2FuY2VsRGVib3VuY2U/LigpO1xyXG4gICAgdGhpcy5jYW5jZWxEZWJvdW5jZSA9IHRoaXMuc2NoZWR1bGUoKCkgPT4ge1xyXG4gICAgICB0aGlzLmNhbmNlbERlYm91bmNlID0gbnVsbDtcclxuICAgICAgdGhpcy5lbnF1ZXVlKCgpID0+IHRoaXMucnVuQ3ljbGUoKSkuY2F0Y2goKGVycm9yOiB1bmtub3duKSA9PlxyXG4gICAgICAgIHRoaXMubG9nLndhcm4oJ2RlYm91bmNlZCBzeW5jIGN5Y2xlIGZhaWxlZCcsIGVycm9yKSxcclxuICAgICAgKTtcclxuICAgIH0sIHRoaXMuZGVib3VuY2VNcyk7XHJcbiAgfVxyXG5cclxuICAvLyAtLS0gdGhlIHN5bmMgY3ljbGUgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBydW5DeWNsZSgpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGlmICh0aGlzLnRyYW5zcG9ydCA9PT0gbnVsbCB8fCB0aGlzLmlzRGlzY29ubmVjdGVkKCkpIHJldHVybjtcclxuICAgIHRoaXMuc3RhdGUgPSAnc3luY2luZyc7XHJcbiAgICB0aGlzLnByb2dyZXNzID0gbnVsbDtcclxuICAgIHRoaXMuc2tpcHBlZFBhdGhzID0gW107XHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCBtYW5pZmVzdCA9IGF3YWl0IHRoaXMuZmV0Y2hNYW5pZmVzdCgpO1xyXG4gICAgICBjb25zdCBsb2NhbENoYW5nZXMgPSBhd2FpdCBzY2FuVmF1bHQoXHJcbiAgICAgICAgdGhpcy5vcHRpb25zLnN0b3JhZ2UsXHJcbiAgICAgICAgdGhpcy5pbmRleCxcclxuICAgICAgICB0aGlzLmlnbm9yZVNldHRpbmdzLFxyXG4gICAgICAgIHRoaXMubm93KCksXHJcbiAgICAgICAge1xyXG4gICAgICAgICAgb25Qcm9ncmVzczogKGRvbmUsIHRvdGFsKSA9PiB0aGlzLmVtaXRQcm9ncmVzcygnc2Nhbm5pbmcnLCBkb25lLCB0b3RhbCksXHJcbiAgICAgICAgICAvLyBTaGFycGVucyB0aGUgc3RhbGVEaXJzIHJ1bGU6IGFuIGVtcHR5IGRpciBvdmVyIGEgdG9tYnN0b25lIFRISVNcclxuICAgICAgICAgIC8vIGRldmljZSBhdXRob3JlZCBpcyBhIGxvY2FsIHJlY3JlYXRpb24sIG5vdCBhIGRlbGV0aW9uIHJlc2lkdWUuXHJcbiAgICAgICAgICB0aGlzRGV2aWNlSWQ6IHRoaXMub3B0aW9ucy5kZXZpY2VJZCxcclxuICAgICAgICB9LFxyXG4gICAgICApO1xyXG4gICAgICBjb25zdCBwbGFuID0gY29tcHV0ZVN5bmNQbGFuKHtcclxuICAgICAgICBsb2NhbENoYW5nZXMsXHJcbiAgICAgICAgaW5kZXg6IHRoaXMuaW5kZXgsXHJcbiAgICAgICAgbWFuaWZlc3QsXHJcbiAgICAgICAgdGhpc0RldmljZUlkOiB0aGlzLm9wdGlvbnMuZGV2aWNlSWQsXHJcbiAgICAgICAgdGhpc0RldmljZU5hbWU6IHRoaXMub3B0aW9ucy5kZXZpY2VOYW1lLFxyXG4gICAgICAgIG5vdzogdGhpcy5ub3coKSxcclxuICAgICAgfSk7XHJcbiAgICAgIC8vIENvbmZsaWN0cyByZWZsZWN0IHRoZSBsYXRlc3QgcGxhbjogZW50cmllcyBmb3IgcGF0aHMgbm8gbG9uZ2VyXHJcbiAgICAgIC8vIGNvbnRlc3RlZCBhcmUgZHJvcHBlZCAoYSBjeWNsZSB0aGF0IHBsYW5zIGNsZWFuIGNsZWFycyB0aGUgbGlzdCksIHNvXHJcbiAgICAgIC8vIGEgc3luY2VkLXF1aWV0IGNsaWVudCByZXBvcnRzIDAgd2hpbGUgc3RpbGwtY29udGVzdGVkIHBhdGhzIHN0YXlcclxuICAgICAgLy8gdmlzaWJsZSB1bnRpbCBhIGN5Y2xlIGFjdHVhbGx5IHJlc29sdmVzIHRoZW0uXHJcbiAgICAgIHRoaXMuY29uZmxpY3RzID0gWy4uLnBsYW4uY29uZmxpY3RzXTtcclxuICAgICAgLy8gQ2FzZS1jb2xsaXNpb24gZGlhZ25vc3RpY3MgZnJvbSB0aGUgc2NhbiAobmV2ZXIgZGVsZXRpb25zIFx1MjAxNCBzZWVcclxuICAgICAgLy8gYFN5bmNDbGllbnRTdGF0dXMuY2FzZUNvbGxpc2lvbnNgKTogcmVwbGFjZWQgZXZlcnkgY3ljbGUgc28gYVxyXG4gICAgICAvLyByZXNvbHZlZCBjb2xsaXNpb24gZGlzYXBwZWFycywgYW4gdW5yZXNvbHZlZCBvbmUgc3RheXMgdmlzaWJsZS5cclxuICAgICAgdGhpcy5jYXNlQ29sbGlzaW9ucyA9IFsuLi4obG9jYWxDaGFuZ2VzLmNhc2VDb2xsaXNpb25zID8/IFtdKV07XHJcbiAgICAgIGlmICh0aGlzLmNhc2VDb2xsaXNpb25zLmxlbmd0aCA+IDApIHtcclxuICAgICAgICB0aGlzLmxvZy53YXJuKFxyXG4gICAgICAgICAgJ2Nhc2UtY29sbGlkaW5nIGZpbGUgcGFpcjogdGhlc2UgZmlsZXMgZGlmZmVyIG9ubHkgYnkgbmFtZSBjYXNlIGFuZCBvbmUgaXMgaW52aXNpYmxlIG9uIHRoaXMgZmlsZXN5c3RlbTsgcmVuYW1lIG9uZSBvZiB0aGVtJyxcclxuICAgICAgICAgIHRoaXMuY2FzZUNvbGxpc2lvbnMsXHJcbiAgICAgICAgKTtcclxuICAgICAgfVxyXG4gICAgICAvLyBXaW5kb3dzLXVuc2FmZSBsb2NhbCBuYW1lcyAobmV2ZXIgcHVzaGVkIFx1MjAxNCBzZWUgYHBhdGhzLnRzYCkgc3VyZmFjZVxyXG4gICAgICAvLyB0aHJvdWdoIHRoZSBzYW1lIGRpYWdub3N0aWNzIGNoYW5uZWwuXHJcbiAgICAgIGZvciAoY29uc3QgcGF0aCBvZiBsb2NhbENoYW5nZXMudW5zYWZlUGF0aHMgPz8gW10pIHtcclxuICAgICAgICB0aGlzLnJlY29yZFNraXBwZWRQYXRoKHBhdGgpO1xyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBTdGFnZSBwdXNoIGNvbnRlbnRzIEJFRk9SRSBwdWxscyBvdmVyd3JpdGUgdGhlIHdvcmtpbmcgdHJlZSAoYVxyXG4gICAgICAvLyBjb25mbGljdC1jb3B5IHB1c2ggcmVhZHMgdGhlIGxvc2VyIGNvbnRlbnQgZnJvbSB0aGUgb3JpZ2luYWwgcGF0aCkuXHJcbiAgICAgIGNvbnN0IHN0YWdlZCA9IGF3YWl0IHRoaXMuc3RhZ2VQdXNoZXMocGxhbiwgbG9jYWxDaGFuZ2VzLmhhc2hlZCk7XHJcblxyXG4gICAgICB0aGlzLmluZGV4ID0gYXdhaXQgdGhpcy5hcHBseVB1bGxzKHBsYW4ucHVsbHMsIHtcclxuICAgICAgICBvblByb2dyZXNzOiAoZG9uZSwgdG90YWwpID0+IHRoaXMuZW1pdFByb2dyZXNzKCdwdWxsaW5nJywgZG9uZSwgdG90YWwpLFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIC8vIFB1c2ggcGlwZWxpbmU6IHVwIHRvIGBwdXNoQ29uY3VycmVuY3lgIGNvbW1pdHMgaW4gZmxpZ2h0OyBhY2tzIGZvbGRcclxuICAgICAgLy8gaW50byB0aGUgaW5kZXggYXMgdGhleSBhcnJpdmUgKHNlcmlhbGl6ZWQgdGhyb3VnaCBgYWNrQ2hhaW5gKS5cclxuICAgICAgLy8gQmxvYiB1cGxvYWRzIGZvciA+MjU2S0IgZmlsZXMgc3RhcnQgaW5zaWRlIHRoZWlyIHNsb3QgYW5kIG92ZXJsYXBcclxuICAgICAgLy8gd2l0aCB0aGUgT1RIRVIgc2xvdHMnIGluLWZsaWdodCBjb21taXRzIGluc3RlYWQgb2Ygc2VyaWFsaXppbmcuXHJcbiAgICAgIGNvbnN0IHB1c2hUb3RhbCA9IHN0YWdlZC5sZW5ndGggKyBwbGFuLmZvbGRlclB1c2hlcy5sZW5ndGg7XHJcbiAgICAgIGxldCBwdXNoRG9uZSA9IDA7XHJcbiAgICAgIGNvbnN0IHNldHRsZVB1c2ggPSAoKTogdm9pZCA9PiB7XHJcbiAgICAgICAgcHVzaERvbmUgKz0gMTtcclxuICAgICAgICB0aGlzLmVtaXRQcm9ncmVzcygncHVzaGluZycsIHB1c2hEb25lLCBwdXNoVG90YWwpO1xyXG4gICAgICB9O1xyXG4gICAgICB0aGlzLmVtaXRQcm9ncmVzcygncHVzaGluZycsIDAsIHB1c2hUb3RhbCk7XHJcbiAgICAgIGF3YWl0IHRoaXMucnVuUHVzaFBpcGVsaW5lKHN0YWdlZCwgc2V0dGxlUHVzaCk7XHJcblxyXG4gICAgICAvLyBQcnVuZS1vbi1kZWxldGUgKEMpLCBsb2NhbCBzaWRlOiBldmVyeSBkZWxldGlvbiB0aGF0IGFjdHVhbGx5XHJcbiAgICAgIC8vIGNvbW1pdHRlZCB0aGlzIGN5Y2xlICh0aGUgaW5kZXggbm93IHRvbWJzdG9uZXMgaXQgLyBtaWdyYXRlZCBpdCBhd2F5KVxyXG4gICAgICAvLyBtYXkgaGF2ZSBlbXB0aWVkIGl0cyBwYXJlbnQgZGlyZWN0b3J5LiBSZW1vdmUgc3VjaCBkaXJlY3RvcmllcyBcdTIwMTRcclxuICAgICAgLy8gQkVGT1JFIHRoZSBwbGFjZWhvbGRlciBwdXNoZXMgYmVsb3csIHNvIGFuIGVtcHRpZWQgZGlyZWN0b3J5IGlzIG5vdFxyXG4gICAgICAvLyBpbW1lZGlhdGVseSByZS1wdXNoZWQgYXMgYW4gZW1wdHktZm9sZGVyIHBsYWNlaG9sZGVyLlxyXG4gICAgICBjb25zdCBlbXB0aWVkRGlycyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xyXG4gICAgICBmb3IgKGNvbnN0IGNvbW1pdCBvZiBzdGFnZWQpIHtcclxuICAgICAgICAvLyBUaGUgcGF0aCB0aGF0IGNlYXNlZCB0byBleGlzdCwgSUYgaXRzIGNvbW1pdCBhY3R1YWxseSBsYW5kZWRcclxuICAgICAgICAvLyAodG9tYnN0b25lZCBpbiB0aGUgaW5kZXggZm9yIGRlbGV0ZXM7IG1pZ3JhdGVkIGF3YXkgZm9yIHJlbmFtZXMgXHUyMDE0XHJcbiAgICAgICAgLy8gYSBkZWxldGUgdGhhdCBsb3N0IGl0cyByYWNlIHRvIGEgcmVtb3RlIGVkaXQgaXMgbm90IGEgZGVsZXRpb24pLlxyXG4gICAgICAgIGxldCBjZWFzZWRQYXRoOiBzdHJpbmcgfCB1bmRlZmluZWQ7XHJcbiAgICAgICAgaWYgKGNvbW1pdC5raW5kID09PSAnZGVsZXRlJyAmJiBjb21taXQuaXNGb2xkZXIgIT09IHRydWUpIHtcclxuICAgICAgICAgIGlmICh0aGlzLmluZGV4W2NvbW1pdC5wYXRoXT8uZGVsZXRlZEF0ICE9PSB1bmRlZmluZWQpIGNlYXNlZFBhdGggPSBjb21taXQucGF0aDtcclxuICAgICAgICB9IGVsc2UgaWYgKGNvbW1pdC5raW5kID09PSAncmVuYW1lJyAmJiBjb21taXQuZnJvbVBhdGggIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgaWYgKCEoY29tbWl0LmZyb21QYXRoIGluIHRoaXMuaW5kZXgpKSBjZWFzZWRQYXRoID0gY29tbWl0LmZyb21QYXRoO1xyXG4gICAgICAgIH1cclxuICAgICAgICBpZiAoY2Vhc2VkUGF0aCA9PT0gdW5kZWZpbmVkKSBjb250aW51ZTtcclxuICAgICAgICBjb25zdCBwcnVuZWQgPSBhd2FpdCBwcnVuZVBhcmVudE9uRGVsZXRlKHRoaXMub3B0aW9ucy5zdG9yYWdlLCB0aGlzLmluZGV4LCBjZWFzZWRQYXRoKTtcclxuICAgICAgICBpZiAocHJ1bmVkID09PSB1bmRlZmluZWQpIGNvbnRpbnVlO1xyXG4gICAgICAgIGVtcHRpZWREaXJzLmFkZChwcnVuZWQuZGlyKTtcclxuICAgICAgICBjb25zdCBwbGFjZWhvbGRlciA9IHRoaXMuaW5kZXhbcHJ1bmVkLmRpcl07XHJcbiAgICAgICAgaWYgKHBsYWNlaG9sZGVyPy5pc0ZvbGRlciAmJiBwbGFjZWhvbGRlci5kZWxldGVkQXQgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgICAgLy8gV2UganVzdCByZW1vdmVkIHRoZSBkaXJlY3RvcnkgYSBsaXZlIHBsYWNlaG9sZGVyIHN0aWxsIGNsYWltczpcclxuICAgICAgICAgIC8vIHNjYW4gYWdhaW4gc28gdGhlIHBsYWNlaG9sZGVyIGlzIHRvbWJzdG9uZWQgYW5kIHByb3BhZ2F0ZXMuXHJcbiAgICAgICAgICB0aGlzLnNjaGVkdWxlUmVjb25jaWxlKCk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcblxyXG4gICAgICAvLyBTdGFsZS1sZWZ0b3ZlciBjbGVhbnVwIChGLTEpOiBhIHRvbWJzdG9uZWQgZm9sZGVyIHBsYWNlaG9sZGVyIHdob3NlXHJcbiAgICAgIC8vIEVNUFRZIGRpcmVjdG9yeSBzdGlsbCBleGlzdHMgb24gZGlzayBcdTIwMTQgdGhlIHJlc2lkdWUgb2YgYSByZWNvcmQtb25seVxyXG4gICAgICAvLyB0b21ic3RvbmUgYXBwbGljYXRpb24gKGFuIGFkYXB0ZXIgd2l0aG91dCBgcmVtb3ZlRGlyYCwgb3IgYSByZW1vdmFsXHJcbiAgICAgIC8vIHRoYXQgbG9zdCBhIHJhY2UpLiBUaGUgc2NhbiBkZWxpYmVyYXRlbHkgY2xhc3NpZmllcyB0aGVzZSBhc1xyXG4gICAgICAvLyBgc3RhbGVEaXJzYCBpbnN0ZWFkIG9mIGBlbXB0eUZvbGRlcnNgLCBzbyBub3RoaW5nIGJlbG93IHJlLXB1c2hlc1xyXG4gICAgICAvLyB0aGVtIGFzIHBsYWNlaG9sZGVycyAodGhhdCByZS1wdXNoIHJlc3VycmVjdGVkIGRlbGV0ZWQgZm9sZGVycyBhbmRcclxuICAgICAgLy8gcGluZy1wb25nZWQgdGhlIGRlbGV0aW9uIGJldHdlZW4gZGV2aWNlcykuIFJldHJ5aW5nIHRoZSByZW1vdmFsIGhlcmVcclxuICAgICAgLy8gY29udmVyZ2VzIHN0b3JhZ2Ugb250byB0aGUgdG9tYnN0b25lLlxyXG4gICAgICBmb3IgKGNvbnN0IGRpciBvZiBsb2NhbENoYW5nZXMuc3RhbGVEaXJzID8/IFtdKSB7XHJcbiAgICAgICAgYXdhaXQgcmVtb3ZlRGlySWZWYWNhbnQodGhpcy5vcHRpb25zLnN0b3JhZ2UsIHRoaXMuaW5kZXgsIGRpcik7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnN0IGZvbGRlckNvbW1pdHM6IFN0YWdlZENvbW1pdFtdID0gW107XHJcbiAgICAgIGZvciAoY29uc3QgcGF0aCBvZiBwbGFuLmZvbGRlclB1c2hlcykge1xyXG4gICAgICAgIC8vIE5ldmVyIHJlc3VycmVjdCBhIGRpcmVjdG9yeSB0aGlzIGN5Y2xlIGVtcHRpZWQgKGRlbGV0ZS1kZXJpdmVkXHJcbiAgICAgICAgLy8gcGxhY2Vob2xkZXJzIGFyZSBzdXBwcmVzc2VkIGV2ZW4gd2hlbiByZW1vdmFsIGl0c2VsZiB3YXMgbm90XHJcbiAgICAgICAgLy8gcG9zc2libGUpLCBub3IgcHVzaCBvbmUgdGhhdCB2YW5pc2hlZCBzaW5jZSB0aGUgc2Nhbi5cclxuICAgICAgICBpZiAoZW1wdGllZERpcnMuaGFzKHBhdGgpKSBjb250aW51ZTtcclxuICAgICAgICBpZiAoIShhd2FpdCB0aGlzLnN0b3JhZ2VFeGlzdHMocGF0aCkpKSBjb250aW51ZTtcclxuICAgICAgICBmb2xkZXJDb21taXRzLnB1c2goe1xyXG4gICAgICAgICAga2luZDogJ2VkaXQnLFxyXG4gICAgICAgICAgcGF0aCxcclxuICAgICAgICAgIHBhcmVudFZlcnNpb246IHRoaXMuaW5kZXhbcGF0aF0/LnZlcnNpb25JZCA/PyBudWxsLFxyXG4gICAgICAgICAgaGFzaDogJycsXHJcbiAgICAgICAgICBzaXplOiAwLFxyXG4gICAgICAgICAgaXNGb2xkZXI6IHRydWUsXHJcbiAgICAgICAgfSk7XHJcbiAgICAgIH1cclxuICAgICAgYXdhaXQgdGhpcy5ydW5QdXNoUGlwZWxpbmUoZm9sZGVyQ29tbWl0cywgc2V0dGxlUHVzaCk7XHJcblxyXG4gICAgICAvLyBDYWNoZSB0aGUgc2NhbidzIGhhc2ggb2JzZXJ2YXRpb25zIChtdGltZSkgb250byBlbnRyaWVzIHdob3NlIGhhc2hcclxuICAgICAgLy8gc3RpbGwgbWF0Y2hlcywgc28gdGhlIG5leHQgZmFzdCBzY2FuIGNhbiBza2lwIHRob3NlIGZpbGVzLiBSdW5zXHJcbiAgICAgIC8vIGFmdGVyIHB1bGxzL3B1c2hlcyBzbyBmcmVzaGx5LWFja2VkIGVudHJpZXMgYmVuZWZpdCBpbW1lZGlhdGVseTtcclxuICAgICAgLy8gYHJlY29yZEhhc2hlZEZpbGVzYCBza2lwcyBhbnl0aGluZyB0aGUgY3ljbGUgY2hhbmdlZCB1bmRlcm5lYXRoIHVzLlxyXG4gICAgICB0aGlzLmluZGV4ID0gcmVjb3JkSGFzaGVkRmlsZXModGhpcy5pbmRleCwgbG9jYWxDaGFuZ2VzLmhhc2hlZCk7XHJcblxyXG4gICAgICAvLyBUaGUgY3ljbGUgZmluaXNoZWQgY2xlYW46IGV2ZXJ5IHB1bGwgb2YgdGhlIG1hbmlmZXN0IGFwcGxpZWQsIGV2ZXJ5XHJcbiAgICAgIC8vIHN0YWdlZCBjb21taXQgYWNrZWQuIFRoZSBpbmRleCBpcyBub3cgY29tcGxldGUgdGhyb3VnaCB0aGUgTUFOSUZFU1Qnc1xyXG4gICAgICAvLyBmZXRjaC10aW1lIGN1cnNvciAoZGVsaWJlcmF0ZWx5IG5vdCB0aGUgbGF0ZXIgYWNrIHNlcXMgXHUyMDE0IGEgY29uY3VycmVudFxyXG4gICAgICAvLyBkZXZpY2UncyBjaGFuZ2UgY2FuIGludGVybGVhdmUgYW5kIHJpZGUgdGhlIHBvc3QtY3ljbGUgZGlzcGF0Y2hcclxuICAgICAgLy8gcXVldWUpLCB3aGljaCBpcyB3aGF0IG1ha2VzIHRoZSBuZXh0IGRlbHRhIG1hbmlmZXN0IHNhZmUuXHJcbiAgICAgIGlmICh0aGlzLm1hbmlmZXN0Q3Vyc29yT2ZDeWNsZSAhPT0gbnVsbCAmJiB0aGlzLm1hbmlmZXN0Q3Vyc29yT2ZDeWNsZSA+ICh0aGlzLnN5bmNlZFRocm91Z2ggPz8gMCkpIHtcclxuICAgICAgICB0aGlzLnN5bmNlZFRocm91Z2ggPSB0aGlzLm1hbmlmZXN0Q3Vyc29yT2ZDeWNsZTtcclxuICAgICAgfVxyXG4gICAgICB0aGlzLm1hbmlmZXN0Q3Vyc29yT2ZDeWNsZSA9IG51bGw7XHJcbiAgICAgIHRoaXMubmVlZHNGdWxsTWFuaWZlc3QgPSBmYWxzZTtcclxuXHJcbiAgICAgIHRoaXMubGFzdFN5bmNBdCA9IHRoaXMubm93KCk7XHJcbiAgICAgIHRoaXMucGVuZGluZyA9IDA7XHJcbiAgICAgIGlmICghdGhpcy5pc0Rpc2Nvbm5lY3RlZCgpKSB0aGlzLnN0YXRlID0gJ2xpdmUnO1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgdGhpcy5tYW5pZmVzdEN1cnNvck9mQ3ljbGUgPSBudWxsO1xyXG4gICAgICB0aGlzLmxvZy5lcnJvcignc3luYyBjeWNsZSBmYWlsZWQnLCBlcnJvcik7XHJcbiAgICAgIGlmICghdGhpcy5pc0Rpc2Nvbm5lY3RlZCgpKSB0aGlzLnN0YXRlID0gdGhpcy50cmFuc3BvcnQgIT09IG51bGwgPyAnbGl2ZScgOiAnaWRsZSc7XHJcbiAgICAgIHRocm93IGVycm9yO1xyXG4gICAgfSBmaW5hbGx5IHtcclxuICAgICAgdGhpcy5wcm9ncmVzcyA9IG51bGw7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBUaGUgbWFuaWZlc3QncyBmZXRjaC10aW1lIGN1cnNvciBmb3IgdGhlIFJVTk5JTkcgY3ljbGUgXHUyMDE0IHRoZSBjb21wbGV0aW9uXHJcbiAgICogd2F0ZXJtYXJrIGEgc3VjY2Vzc2Z1bCBjeWNsZSByZWNvcmRzIGludG8gYHN5bmNlZFRocm91Z2hgIChzZWUgdGhlXHJcbiAgICogY29tbWVudCB0aGVyZSkuIE51bGwgb3V0c2lkZSBjeWNsZXMuXHJcbiAgICovXHJcbiAgcHJpdmF0ZSBtYW5pZmVzdEN1cnNvck9mQ3ljbGU6IG51bWJlciB8IG51bGwgPSBudWxsO1xyXG5cclxuICAvKipcclxuICAgKiBXaGV0aGVyIFRISVMgY3ljbGUgbWF5IHJlcXVlc3QgYSBkZWx0YSBtYW5pZmVzdC4gQWxsIGZvdXIgZ2F0ZXMgbXVzdFxyXG4gICAqIGhvbGQgKGFueSBmYWlsdXJlIFx1MjFEMiBmdWxsIG1hbmlmZXN0LCB0b2RheSdzIGJlaGF2aW9yKTpcclxuICAgKlxyXG4gICAqICAxLiBgY3Vyc29yID4gMGAgXHUyMDE0IGEgZmlyc3QtZXZlciBjb25uZWN0IGtub3dzIG5vdGhpbmc7IGZ1bGwgbWFuaWZlc3QuXHJcbiAgICogIDIuIGBzeW5jZWRUaHJvdWdoICE9PSBudWxsYCBcdTIwMTQgc29tZSBmdWxsLW1hbmlmZXN0IGN5Y2xlIGNvbXBsZXRlZCwgc28gdGhlXHJcbiAgICogICAgIGluZGV4IGlzIENPTVBMRVRFIHRocm91Z2ggaXQ7IGhlYWRzIGFmdGVyIGl0IGFycml2ZSB2aWEgcmVwbGF5ICtcclxuICAgKiAgICAgZGVsdGEuIEFuIGludGVycnVwdGVkIGluaXRpYWwgc3luYyBuZXZlciBzZXRzIGl0IFx1MjFEMiBmdWxsIG1hbmlmZXN0LlxyXG4gICAqICAzLiBgIW5lZWRzRnVsbE1hbmlmZXN0YCBcdTIwMTQgbm8gZGVmZXJyZWQgZGl2ZXJnZW5jZSBhd2FpdHMgcGxhbiByZXNvbHV0aW9uLlxyXG4gICAqICA0LiBSZXBsYXkgd2luZG93IGludGFjdCBcdTIwMTQgaGVsbG9BY2sgcmVwb3J0ZWQgYG9sZGVzdFJldGFpbmVkU2VxIDw9XHJcbiAgICogICAgIGN1cnNvciArIDFgLCBzbyBldmVyeSBldmVudCBhZnRlciBvdXIgY3Vyc29yIGlzIHN0aWxsIG9uIHRoZSBzZXJ2ZXIuXHJcbiAgICovXHJcbiAgcHJpdmF0ZSBzaG91bGRSZXF1ZXN0RGVsdGFNYW5pZmVzdCgpOiBib29sZWFuIHtcclxuICAgIHJldHVybiAoXHJcbiAgICAgIHRoaXMuY3Vyc29yID4gMCAmJlxyXG4gICAgICB0aGlzLnN5bmNlZFRocm91Z2ggIT09IG51bGwgJiZcclxuICAgICAgIXRoaXMubmVlZHNGdWxsTWFuaWZlc3QgJiZcclxuICAgICAgdGhpcy5zZXJ2ZXJPbGRlc3RSZXRhaW5lZFNlcSAhPT0gbnVsbCAmJlxyXG4gICAgICB0aGlzLnNlcnZlck9sZGVzdFJldGFpbmVkU2VxIDw9IHRoaXMuY3Vyc29yICsgMVxyXG4gICAgKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgZmV0Y2hNYW5pZmVzdCgpOiBQcm9taXNlPFJlbW90ZUZpbGVbXT4ge1xyXG4gICAgY29uc3QgdHJhbnNwb3J0ID0gdGhpcy50cmFuc3BvcnQ7XHJcbiAgICBpZiAodHJhbnNwb3J0ID09PSBudWxsKSB0aHJvdyBuZXcgTmV0d29ya0Vycm9yKCdub3QgY29ubmVjdGVkJyk7XHJcbiAgICBjb25zdCB1c2VEZWx0YSA9IHRoaXMuc2hvdWxkUmVxdWVzdERlbHRhTWFuaWZlc3QoKTtcclxuICAgIGNvbnN0IHNpbmNlID0gdXNlRGVsdGEgJiYgdGhpcy5zeW5jZWRUaHJvdWdoICE9PSBudWxsID8gdGhpcy5zeW5jZWRUaHJvdWdoIDogdW5kZWZpbmVkO1xyXG4gICAgY29uc3QgcmVwbHkgPSBhd2FpdCB0aGlzLnJlcXVlc3Q8TWFuaWZlc3RNZXNzYWdlIHwgU2VydmVyRXJyb3JNZXNzYWdlPihcclxuICAgICAgKG0pID0+IG0udHlwZSA9PT0gJ21hbmlmZXN0JyB8fCBtLnR5cGUgPT09ICdlcnJvcicsXHJcbiAgICAgICgpID0+IHRyYW5zcG9ydC5zZW5kKHsgdHlwZTogJ2dldE1hbmlmZXN0JywgLi4uKHNpbmNlICE9PSB1bmRlZmluZWQgPyB7IHNpbmNlIH0gOiB7fSkgfSksXHJcbiAgICApO1xyXG4gICAgaWYgKHJlcGx5LnR5cGUgPT09ICdlcnJvcicpIHRocm93IHRoaXMudG9FcnJvcihyZXBseSk7XHJcbiAgICB2YWxpZGF0ZU1hbmlmZXN0TWVzc2FnZShyZXBseSk7XHJcbiAgICBpZiAocmVwbHkuY3Vyc29yID4gdGhpcy5jdXJzb3IpIHRoaXMuY3Vyc29yID0gcmVwbHkuY3Vyc29yO1xyXG4gICAgdGhpcy5tYW5pZmVzdEN1cnNvck9mQ3ljbGUgPSByZXBseS5jdXJzb3I7XHJcbiAgICBpZiAoIXVzZURlbHRhKSB7XHJcbiAgICAgIHJldHVybiB0aGlzLnRvUmVtb3RlRmlsZXMoT2JqZWN0LnZhbHVlcyhyZXBseS5lbnRyaWVzKSk7XHJcbiAgICB9XHJcbiAgICAvLyBEZWx0YTogbWVyZ2UgdGhlIGNoYW5nZWQgaGVhZHMgb3ZlciBhbiBJTkRFWCBQUk9KRUNUSU9OIG9mIHRoZSBmdWxsXHJcbiAgICAvLyBtYW5pZmVzdC4gY29tcHV0ZVN5bmNQbGFuIG5lZWRzIHRoZSBjb21wbGV0ZSByZW1vdGUgdmlldyBcdTIwMTQgUGhhc2UgQlxyXG4gICAgLy8gdHJlYXRzIGFuIGluZGV4IHBhdGggYWJzZW50IGZyb20gdGhlIG1hbmlmZXN0IGFzIFwibWlncmF0ZWQgYXdheVwiIFx1MjAxNCBhbmRcclxuICAgIC8vIGVsaWdpYmlsaXR5IGd1YXJhbnRlZXMgdGhlIGluZGV4IGFscmVhZHkgYWdyZWVzIHdpdGggdGhlIHNlcnZlciBmb3JcclxuICAgIC8vIGV2ZXJ5IHBhdGggdGhlIGRlbHRhIG9taXRzIChoZWFkcyBcdTIyNjQgc3luY2VkVGhyb3VnaCkuIFByb2plY3RpbmcgZW50cmllc1xyXG4gICAgLy8gdG8gdGhlaXIgaW5kZXggc3RhdGUgdGhlcmVmb3JlIHJlY29uc3RydWN0cyBleGFjdGx5IHdoYXQgdGhlIGZ1bGxcclxuICAgIC8vIG1hbmlmZXN0IHdvdWxkIGhhdmUgc2FpZCwgYXQgTyhjaGFuZ2VzKSBpbnN0ZWFkIG9mIE8odmF1bHQpLlxyXG4gICAgY29uc3QgbWVyZ2VkID0gbmV3IE1hcDxzdHJpbmcsIFJlbW90ZUZpbGU+KCk7XHJcbiAgICBmb3IgKGNvbnN0IFtwYXRoLCBlbnRyeV0gb2YgT2JqZWN0LmVudHJpZXModGhpcy5pbmRleCkpIHtcclxuICAgICAgbWVyZ2VkLnNldChwYXRoLCB7XHJcbiAgICAgICAgcGF0aCxcclxuICAgICAgICB2ZXJzaW9uOiBlbnRyeS52ZXJzaW9uSWQsXHJcbiAgICAgICAgaGFzaDogZW50cnkuaGFzaCxcclxuICAgICAgICBzaXplOiBlbnRyeS5zaXplLFxyXG4gICAgICAgIGRlbGV0ZWQ6IGVudHJ5LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkLFxyXG4gICAgICAgIGNsb2NrOiBlbnRyeS5jbG9jayxcclxuICAgICAgICAuLi4oZW50cnkuaXNGb2xkZXIgPyB7IGlzRm9sZGVyOiB0cnVlIH0gOiB7fSksXHJcbiAgICAgICAgbXRpbWU6IGVudHJ5Lm10aW1lID8/IDAsXHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG4gICAgZm9yIChjb25zdCBbcGF0aCwgZW50cnldIG9mIE9iamVjdC5lbnRyaWVzKHJlcGx5LmVudHJpZXMpKSB7XHJcbiAgICAgIG1lcmdlZC5zZXQocGF0aCwgeyAuLi5lbnRyeSB9KTtcclxuICAgIH1cclxuICAgIHJldHVybiB0aGlzLnRvUmVtb3RlRmlsZXMoWy4uLm1lcmdlZC52YWx1ZXMoKV0pO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogUHJvamVjdCBtYW5pZmVzdC1zaWRlIGVudHJpZXMgdG8gYFJlbW90ZUZpbGVgcywgc2tpcHBpbmcgV2luZG93cy11bnNhZmVcclxuICAgKiBwYXRocyAoZGlhZ25vc2VkIHZpYSBgcmVjb3JkU2tpcHBlZFBhdGhgLCBuZXZlciBoYW5kZWQgdG8gdGhlIHBsYW5uZXIgXHUyMDE0XHJcbiAgICogbWF0ZXJpYWxpemluZyB0aGVtIGlzIGltcG9zc2libGUsIHNvIHBsYW5uaW5nIHRoZW0gd291bGQgb25seSBwcm9kdWNlIGFcclxuICAgKiBwdWxsIHRoYXQgZmFpbHMgZXZlcnkgY3ljbGUpLlxyXG4gICAqL1xyXG4gIHByaXZhdGUgdG9SZW1vdGVGaWxlcyhlbnRyaWVzOiByZWFkb25seSBSZW1vdGVGaWxlW10pOiBSZW1vdGVGaWxlW10ge1xyXG4gICAgY29uc3QgcmVtb3RlOiBSZW1vdGVGaWxlW10gPSBbXTtcclxuICAgIGZvciAoY29uc3QgZW50cnkgb2YgZW50cmllcykge1xyXG4gICAgICBpZiAoaXNXaW5kb3dzVW5zYWZlUGF0aChlbnRyeS5wYXRoKSkge1xyXG4gICAgICAgIHRoaXMucmVjb3JkU2tpcHBlZFBhdGgoZW50cnkucGF0aCk7XHJcbiAgICAgICAgY29udGludWU7XHJcbiAgICAgIH1cclxuICAgICAgcmVtb3RlLnB1c2goeyAuLi5lbnRyeSB9KTtcclxuICAgIH1cclxuICAgIHJldHVybiByZW1vdGU7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHN0YWdlUHVzaGVzKFxyXG4gICAgcGxhbjogU3luY1BsYW4sXHJcbiAgICBoYXNoZWQ6IHJlYWRvbmx5IEhhc2hlZEZpbGVbXSxcclxuICApOiBQcm9taXNlPFN0YWdlZENvbW1pdFtdPiB7XHJcbiAgICAvLyBBIGNvbmZsaWN0LWNvcHkgcHVzaCBjYXJyaWVzIGNvbnRlbnQgcmVhZCBmcm9tIHRoZSAqb3JpZ2luYWwqIHBhdGguXHJcbiAgICBjb25zdCBjb3B5U291cmNlcyA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KCk7XHJcbiAgICBmb3IgKGNvbnN0IGNvbmZsaWN0IG9mIHBsYW4uY29uZmxpY3RzKSB7XHJcbiAgICAgIGlmIChjb25mbGljdC5jb25mbGljdENvcHlQYXRoICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgICBjb3B5U291cmNlcy5zZXQoY29uZmxpY3QuY29uZmxpY3RDb3B5UGF0aCwgY29uZmxpY3QucGF0aCk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIC8vIEhhc2gtdGltZSBzdGF0cyBieSBwYXRoOiBwaW5uaW5nIHRoZXNlIG9udG8gdGhlIGFja2VkIGVudHJpZXMgKGJlbG93KVxyXG4gICAgLy8ga2VlcHMgdGhlIGZhc3QtcGF0aCBjYWNoZSBob25lc3QgXHUyMDE0IHNlZSBgU3RhZ2VkQ29tbWl0Lm10aW1lYC5cclxuICAgIGNvbnN0IGhhc2hUaW1lTXRpbWUgPSBuZXcgTWFwKGhhc2hlZC5tYXAoKG9ic2VydmVkKSA9PiBbb2JzZXJ2ZWQucGF0aCwgb2JzZXJ2ZWQubXRpbWVdKSk7XHJcblxyXG4gICAgY29uc3Qgc3RhZ2VkOiBTdGFnZWRDb21taXRbXSA9IFtdO1xyXG4gICAgZm9yIChjb25zdCBwdXNoIG9mIHBsYW4ucHVzaGVzKSB7XHJcbiAgICAgIGlmIChwdXNoLmtpbmQgPT09ICdkZWxldGUnIHx8IHB1c2gua2luZCA9PT0gJ3JlbmFtZScpIHtcclxuICAgICAgICBzdGFnZWQucHVzaCh0aGlzLnRvU3RhZ2VkKHB1c2gpKTtcclxuICAgICAgICBjb250aW51ZTtcclxuICAgICAgfVxyXG4gICAgICBjb25zdCBzb3VyY2VQYXRoID1cclxuICAgICAgICBwdXNoLmtpbmQgPT09ICdjb25mbGljdENvcHknID8gY29weVNvdXJjZXMuZ2V0KHB1c2gucGF0aCkgPz8gcHVzaC5wYXRoIDogcHVzaC5wYXRoO1xyXG4gICAgICBjb25zdCBieXRlcyA9IGF3YWl0IHRoaXMucmVhZExvY2FsKHNvdXJjZVBhdGgpO1xyXG4gICAgICBpZiAoYnl0ZXMgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIHRoaXMubG9nLndhcm4oJ3B1c2ggc291cmNlIHZhbmlzaGVkIHNpbmNlIHNjYW47IGRlZmVycmluZycsIHB1c2gucGF0aCk7XHJcbiAgICAgICAgdGhpcy5zY2hlZHVsZVJlY29uY2lsZSgpO1xyXG4gICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICB9XHJcbiAgICAgIGNvbnN0IGhhc2ggPSBhd2FpdCBzaGEyNTZIZXgoYnl0ZXMpO1xyXG4gICAgICBpZiAoaGFzaCAhPT0gcHVzaC5oYXNoIHx8IGJ5dGVzLmJ5dGVMZW5ndGggIT09IHB1c2guc2l6ZSkge1xyXG4gICAgICAgIHRoaXMubG9nLndhcm4oJ2xvY2FsIGNvbnRlbnQgZHJpZnRlZCBzaW5jZSBzY2FuOyBkZWZlcnJpbmcgcHVzaCcsIHB1c2gucGF0aCk7XHJcbiAgICAgICAgdGhpcy5zY2hlZHVsZVJlY29uY2lsZSgpO1xyXG4gICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICB9XHJcbiAgICAgIGlmIChwdXNoLmtpbmQgPT09ICdjb25mbGljdENvcHknKSB7XHJcbiAgICAgICAgLy8gTWF0ZXJpYWxpemUgdGhlIGNvcHkgbG9jYWxseSBOT1csIGJlZm9yZSB0aGUgcHVsbHMgb3ZlcndyaXRlIHRoZVxyXG4gICAgICAgIC8vIG9yaWdpbmFsOiB0aGUgc2VydmVyIGJyb2FkY2FzdHMgdGhlIGNvcHkgdG8gKm90aGVyKiBjbGllbnRzIG9ubHksXHJcbiAgICAgICAgLy8gc28gdGhpcyBkZXZpY2UgbXVzdCB3cml0ZSBpdHMgb3duIGNvcHkgaXRzZWxmLiBUaGUgY29weSBsYW5kcyBhdCBhXHJcbiAgICAgICAgLy8gTkVXIHBhdGggd2hvc2Ugb24tZGlzayBzdGF0IGRpZmZlcnMgZnJvbSB0aGUgc291cmNlJ3MgXHUyMDE0IG5vIGhhc2gtdGltZVxyXG4gICAgICAgIC8vIHN0YXQgdG8gcGluLCB0aGUgbmV4dCBzY2FuIHJlY29yZHMgb25lLlxyXG4gICAgICAgIGF3YWl0IHRoaXMub3B0aW9ucy5zdG9yYWdlLndyaXRlRmlsZShwdXNoLnBhdGgsIGJ5dGVzKTtcclxuICAgICAgICBzdGFnZWQucHVzaCh7IC4uLnRoaXMudG9TdGFnZWQocHVzaCksIGJ5dGVzIH0pO1xyXG4gICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICB9XHJcbiAgICAgIHN0YWdlZC5wdXNoKHtcclxuICAgICAgICAuLi50aGlzLnRvU3RhZ2VkKHB1c2gpLFxyXG4gICAgICAgIGJ5dGVzLFxyXG4gICAgICAgIC4uLihoYXNoVGltZU10aW1lLmdldChzb3VyY2VQYXRoKSAhPT0gdW5kZWZpbmVkXHJcbiAgICAgICAgICA/IHsgbXRpbWU6IGhhc2hUaW1lTXRpbWUuZ2V0KHNvdXJjZVBhdGgpIH1cclxuICAgICAgICAgIDoge30pLFxyXG4gICAgICB9KTtcclxuICAgIH1cclxuICAgIHJldHVybiBzdGFnZWQ7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHRvU3RhZ2VkKHB1c2g6IFB1c2hPcCk6IFN0YWdlZENvbW1pdCB7XHJcbiAgICBpZiAocHVzaC5raW5kID09PSAncmVuYW1lJykge1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIGtpbmQ6ICdyZW5hbWUnLFxyXG4gICAgICAgIHBhdGg6IHB1c2gudG9QYXRoLFxyXG4gICAgICAgIHBhcmVudFZlcnNpb246IHB1c2gucGFyZW50VmVyc2lvbixcclxuICAgICAgICBoYXNoOiBwdXNoLmhhc2gsXHJcbiAgICAgICAgc2l6ZTogcHVzaC5zaXplLFxyXG4gICAgICAgIGZyb21QYXRoOiBwdXNoLmZyb21QYXRoLFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHtcclxuICAgICAga2luZDogcHVzaC5raW5kID09PSAnYWRkJyA/ICdlZGl0JyA6IHB1c2gua2luZCxcclxuICAgICAgcGF0aDogcHVzaC5wYXRoLFxyXG4gICAgICBwYXJlbnRWZXJzaW9uOiBwdXNoLnBhcmVudFZlcnNpb24sXHJcbiAgICAgIGhhc2g6IHB1c2guaGFzaCxcclxuICAgICAgc2l6ZTogcHVzaC5zaXplLFxyXG4gICAgICAuLi4ocHVzaC5pc0ZvbGRlciA/IHsgaXNGb2xkZXI6IHRydWUgfSA6IHt9KSxcclxuICAgIH07XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHJlYWRMb2NhbChwYXRoOiBzdHJpbmcpOiBQcm9taXNlPFVpbnQ4QXJyYXkgfCB1bmRlZmluZWQ+IHtcclxuICAgIHRyeSB7XHJcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLm9wdGlvbnMuc3RvcmFnZS5yZWFkRmlsZShwYXRoKTtcclxuICAgIH0gY2F0Y2gge1xyXG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogU2VuZCBgY29tbWl0c2AgdGhyb3VnaCBhIGJvdW5kZWQtY29uY3VycmVuY3kgcGlwZWxpbmU6IHVwIHRvXHJcbiAgICogYHB1c2hDb25jdXJyZW5jeWAgY29tbWl0cyBpbiBmbGlnaHQgKHNlbnQsIGF3YWl0aW5nIHRoZWlyIHNlcnZlciByZXBseSlcclxuICAgKiBhdCBvbmNlOyBlYWNoIHNsb3Qgc2VuZHMgaXRzIG5leHQgY29tbWl0IGFzIHNvb24gYXMgYW4gZWFybGllciBvbmUgaXNcclxuICAgKiBzZXR0bGVkLlxyXG4gICAqXHJcbiAgICogV0hZIFBJUEVMSU5JTkcgSVMgU0FGRSAodnMuIGEgYmF0Y2ggbWVzc2FnZSk6IGNvbmZsaWN0IGFyYml0cmF0aW9uIGlzXHJcbiAgICogU0VSVkVSLXNpZGUgYW5kIFBFUiBQQVRIIChgYXJiaXRyYXRlQ29tbWl0YCByZWFkcyBhbmQgd3JpdGVzIGV4YWN0bHkgdGhlXHJcbiAgICogY29tbWl0dGVkIHBhdGgncyBoZWFkKSwgYW5kIGEgY3ljbGUgc3RhZ2VzIGF0IG1vc3QgT05FIGNvbW1pdCBwZXIgcGF0aFxyXG4gICAqICh0aGUgc2NhbiBidWNrZXRzIGJ5IHBhdGg7IHJlbmFtZXMgY29uc3VtZSBib3RoIGVuZHMpLiBTbyB0d28gaW4tZmxpZ2h0XHJcbiAgICogY29tbWl0cyBjYW4gbmV2ZXIgaW50ZXJhY3Qgb24gdGhlIHNlcnZlciwgYW5kIHJlcGx5IE9SREVSIGFjcm9zc1xyXG4gICAqIGRpZmZlcmVudCBwYXRocyBkb2VzIG5vdCBtYXR0ZXIgZm9yIHRoZSByZXN1bHRpbmcgc3RhdGUgXHUyMDE0IG9ubHkgcGVyLXBhdGhcclxuICAgKiBwYWlyaW5nIG9mIHJlcGx5XHUyMTkyY29tbWl0IG1hdHRlcnMsIHdoaWNoIHRoZSBvcmRlcmVkIFdlYlNvY2tldCBwbHVzIHRoZVxyXG4gICAqIHNlcnZlcidzIHNlcmlhbGl6ZWQgYXJiaXRyYXRpb24gZ3VhcmFudGVlIChyZXBsaWVzIGFycml2ZSBpbiBzZW5kIG9yZGVyLFxyXG4gICAqIG1hdGNoZWQgRklGTyBieSBgb25UcmFuc3BvcnRNZXNzYWdlYCkuIEEgYmF0Y2ggcHJvdG9jb2wgbWVzc2FnZSB3b3VsZFxyXG4gICAqIGFkZGl0aW9uYWxseSBjb3VwbGUgYmxvYi11cGxvYWQgdGltaW5nIGFuZCBlcnJvciBncmFudWxhcml0eSBmb3Igbm9cclxuICAgKiBjb3JyZWN0bmVzcyBnYWluLCBzbyBwcm90b2NvbCB2MSBzdGF5cyB1bmNoYW5nZWQuXHJcbiAgICpcclxuICAgKiBPbiB0aGUgZmlyc3QgZmFpbHVyZSwgaW4tZmxpZ2h0IGNvbW1pdHMgc3RpbGwgc2V0dGxlICh0aGVpciBhY2tzIGFyZVxyXG4gICAqIGFwcGxpZWQgXHUyMDE0IHRoZXkgYXJlIHJlYWwgaGVhZHMpIGJ1dCBubyBORVcgY29tbWl0IHN0YXJ0czsgdGhlIGVycm9yIGlzXHJcbiAgICogcmV0aHJvd24gYWZ0ZXIgYWxsIHNsb3RzIGRyYWluIHNvIHRoZSBjeWNsZSBmYWlscyBleGFjdGx5IGxpa2UgdGhlIG9sZFxyXG4gICAqIHNlcXVlbnRpYWwgbG9vcCBkaWQgKHVuc2VudCBwdXNoZXMgc2ltcGx5IHJldHJ5IG5leHQgY3ljbGUpLlxyXG4gICAqL1xyXG4gIHByaXZhdGUgYXN5bmMgcnVuUHVzaFBpcGVsaW5lKFxyXG4gICAgY29tbWl0czogcmVhZG9ubHkgU3RhZ2VkQ29tbWl0W10sXHJcbiAgICBvblNldHRsZWQ6ICgpID0+IHZvaWQsXHJcbiAgKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBpZiAoY29tbWl0cy5sZW5ndGggPT09IDApIHJldHVybjtcclxuICAgIGxldCBuZXh0ID0gMDtcclxuICAgIGxldCBmYWlsdXJlOiBFcnJvciB8IG51bGwgPSBudWxsO1xyXG4gICAgY29uc3Qgc2xvdHMgPSBNYXRoLm1pbih0aGlzLnB1c2hDb25jdXJyZW5jeSwgY29tbWl0cy5sZW5ndGgpO1xyXG4gICAgY29uc3Qgd29ya2VyID0gYXN5bmMgKCk6IFByb21pc2U8dm9pZD4gPT4ge1xyXG4gICAgICB3aGlsZSAobmV4dCA8IGNvbW1pdHMubGVuZ3RoKSB7XHJcbiAgICAgICAgaWYgKGZhaWx1cmUgIT09IG51bGwpIHJldHVybjtcclxuICAgICAgICBjb25zdCBjb21taXQgPSBjb21taXRzW25leHQrK10hO1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICBhd2FpdCB0aGlzLnNlbmRDb21taXQoY29tbWl0KTtcclxuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgICAgZmFpbHVyZSA/Pz0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpO1xyXG4gICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH0gZmluYWxseSB7XHJcbiAgICAgICAgICBvblNldHRsZWQoKTtcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgIH07XHJcbiAgICBhd2FpdCBQcm9taXNlLmFsbChBcnJheS5mcm9tKHsgbGVuZ3RoOiBzbG90cyB9LCB3b3JrZXIpKTtcclxuICAgIGlmIChmYWlsdXJlICE9PSBudWxsKSB0aHJvdyBmYWlsdXJlO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBzZW5kQ29tbWl0KGNvbW1pdDogU3RhZ2VkQ29tbWl0KTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zdCB0cmFuc3BvcnQgPSB0aGlzLnRyYW5zcG9ydDtcclxuICAgIGlmICh0cmFuc3BvcnQgPT09IG51bGwpIHRocm93IG5ldyBOZXR3b3JrRXJyb3IoJ25vdCBjb25uZWN0ZWQnKTtcclxuXHJcbiAgICBjb25zdCBtZXNzYWdlOiBDb21taXRNZXNzYWdlID0ge1xyXG4gICAgICB0eXBlOiAnY29tbWl0JyxcclxuICAgICAgcGF0aDogY29tbWl0LnBhdGgsXHJcbiAgICAgIHBhcmVudFZlcnNpb246IGNvbW1pdC5wYXJlbnRWZXJzaW9uLFxyXG4gICAgICBoYXNoOiBjb21taXQuaGFzaCxcclxuICAgICAgc2l6ZTogY29tbWl0LnNpemUsXHJcbiAgICAgIGtpbmQ6IGNvbW1pdC5raW5kLFxyXG4gICAgICAuLi4oY29tbWl0LmZyb21QYXRoICE9PSB1bmRlZmluZWQgPyB7IGZyb21QYXRoOiBjb21taXQuZnJvbVBhdGggfSA6IHt9KSxcclxuICAgICAgLi4uKGNvbW1pdC5pc0ZvbGRlciA9PT0gdHJ1ZSA/IHsgaXNGb2xkZXI6IHRydWUgfSA6IHt9KSxcclxuICAgICAgLi4uKGNvbW1pdC5ieXRlcyAhPT0gdW5kZWZpbmVkICYmIGNvbW1pdC5ieXRlcy5ieXRlTGVuZ3RoIDw9IElOTElORV9DT05URU5UX01BWF9CWVRFU1xyXG4gICAgICAgID8geyBpbmxpbmU6IGJ5dGVzVG9CYXNlNjQoY29tbWl0LmJ5dGVzKSB9XHJcbiAgICAgICAgOiB7fSksXHJcbiAgICB9O1xyXG5cclxuICAgIC8vIEF0dGFjaG1lbnRzIGFib3ZlIHRoZSBpbmxpbmUgY2FwIHJpZGUgdGhlIGJsb2Igc3RvcmUgKEZSLTgpLiBJbnNpZGUgYVxyXG4gICAgLy8gcGlwZWxpbmUgc2xvdCB0aGlzIGF3YWl0IG92ZXJsYXBzIHdpdGggdGhlIE9USEVSIHNsb3RzJyBpbi1mbGlnaHRcclxuICAgIC8vIGNvbW1pdHMgXHUyMDE0IHRoZSB1cGxvYWQgbm8gbG9uZ2VyIHNlcmlhbGl6ZXMgYWhlYWQgb2YgZXZlcnkgY29tbWl0IFx1MjAxNCBhbmRcclxuICAgIC8vIHN0aWxsIGNvbXBsZXRlcyBiZWZvcmUgSVRTIGNvbW1pdCBpcyBzZW50ICh0aGUgc2VydmVyIHJlamVjdHMgYSBjb21taXRcclxuICAgIC8vIHdob3NlIGJsb2IgaGFzIG5vdCBhcnJpdmVkKS5cclxuICAgIGlmIChjb21taXQuYnl0ZXMgIT09IHVuZGVmaW5lZCAmJiBjb21taXQuYnl0ZXMuYnl0ZUxlbmd0aCA+IElOTElORV9DT05URU5UX01BWF9CWVRFUykge1xyXG4gICAgICBhd2FpdCB0aGlzLnVwbG9hZEJsb2IoY29tbWl0Lmhhc2gsIGNvbW1pdC5ieXRlcyk7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgcmVwbHkgPSBhd2FpdCB0aGlzLnJlcXVlc3Q8Q29tbWl0QWNrTWVzc2FnZSB8IENvbmZsaWN0TWVzc2FnZSB8IFNlcnZlckVycm9yTWVzc2FnZT4oXHJcbiAgICAgIChtKSA9PiBtLnR5cGUgPT09ICdjb21taXRBY2snIHx8IG0udHlwZSA9PT0gJ2NvbmZsaWN0JyB8fCBtLnR5cGUgPT09ICdlcnJvcicsXHJcbiAgICAgICgpID0+IHRyYW5zcG9ydC5zZW5kKG1lc3NhZ2UpLFxyXG4gICAgKTtcclxuICAgIGlmIChyZXBseS50eXBlID09PSAnZXJyb3InKSB0aHJvdyB0aGlzLnRvRXJyb3IocmVwbHkpO1xyXG4gICAgaWYgKHJlcGx5LnR5cGUgPT09ICdjb21taXRBY2snKSB7XHJcbiAgICAgIHZhbGlkYXRlQ29tbWl0QWNrTWVzc2FnZShyZXBseSk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICB2YWxpZGF0ZUNvbmZsaWN0TWVzc2FnZShyZXBseSk7XHJcbiAgICB9XHJcblxyXG4gICAgLy8gRm9sZCB0aGUgcmVwbHkgaW50byBzaGFyZWQgc3RhdGUgYmVoaW5kIHRoZSBhY2sgY2hhaW46IGNvbmN1cnJlbnRcclxuICAgIC8vIHNsb3RzIG11c3Qgbm90IHJlYWQtbW9kaWZ5LXdyaXRlIGB0aGlzLmluZGV4YCBhdCB0aGUgc2FtZSB0aW1lLlxyXG4gICAgYXdhaXQgdGhpcy5zZXJpYWxpemVBY2tBcHBsaWNhdGlvbihhc3luYyAoKSA9PiB7XHJcbiAgICAgIGlmIChyZXBseS50eXBlID09PSAnY29tbWl0QWNrJykge1xyXG4gICAgICAgIGlmIChyZXBseS5zZXEgPiB0aGlzLmN1cnNvcikgdGhpcy5jdXJzb3IgPSByZXBseS5zZXE7XHJcbiAgICAgICAgdGhpcy5hcHBseUFja1RvSW5kZXgoY29tbWl0LCByZXBseS52ZXJzaW9uLCByZXBseS5jbG9jayk7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgICB9XHJcbiAgICAgIGF3YWl0IHRoaXMuaGFuZGxlQ29uZmxpY3RSZXBseShjb21taXQsIHJlcGx5KTtcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgLyoqIENoYWluIG9uZSByZXBseSdzIGluZGV4IGFwcGxpY2F0aW9uIGFmdGVyIGV2ZXJ5IHByZXZpb3VzbHktc3RhcnRlZCBvbmUuICovXHJcbiAgcHJpdmF0ZSBzZXJpYWxpemVBY2tBcHBsaWNhdGlvbihhcHBseTogKCkgPT4gUHJvbWlzZTx2b2lkPik6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgY29uc3QgcnVuID0gdGhpcy5hY2tDaGFpbi50aGVuKGFwcGx5LCBhcHBseSk7XHJcbiAgICB0aGlzLmFja0NoYWluID0gcnVuLnRoZW4oXHJcbiAgICAgICgpID0+IHt9LFxyXG4gICAgICAoKSA9PiB7fSxcclxuICAgICk7XHJcbiAgICByZXR1cm4gcnVuO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhcHBseUFja1RvSW5kZXgoY29tbWl0OiBTdGFnZWRDb21taXQsIHZlcnNpb25JZDogc3RyaW5nLCBjbG9jazogTG9naWNhbENsb2NrKTogdm9pZCB7XHJcbiAgICBjb25zdCBkZWxldGVkID0gY29tbWl0LmtpbmQgPT09ICdkZWxldGUnO1xyXG4gICAgaWYgKGNvbW1pdC5raW5kID09PSAncmVuYW1lJyAmJiBjb21taXQuZnJvbVBhdGggIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICB0aGlzLmluZGV4ID0gYXBwbHlDb21taXQocmVtb3ZlRW50cnkodGhpcy5pbmRleCwgY29tbWl0LmZyb21QYXRoKSwge1xyXG4gICAgICAgIHBhdGg6IGNvbW1pdC5wYXRoLFxyXG4gICAgICAgIHZlcnNpb25JZCxcclxuICAgICAgICBoYXNoOiBjb21taXQuaGFzaCxcclxuICAgICAgICBzaXplOiBjb21taXQuc2l6ZSxcclxuICAgICAgICBjbG9jayxcclxuICAgICAgICAvLyBBIGZvbGRlciByZW5hbWUgYWNrcyBmb2xkZXIgbWV0YWRhdGEgYXQgdGhlIGRlc3RpbmF0aW9uLCBleGFjdGx5XHJcbiAgICAgICAgLy8gbGlrZSBldmVyeSBvdGhlciBhY2sga2luZCAodGhlIGVudHJ5IG11c3Qgbm90IGxvc2UgaXRzIGZsYWcpLlxyXG4gICAgICAgIC4uLihjb21taXQuaXNGb2xkZXIgPT09IHRydWUgPyB7IGlzRm9sZGVyOiB0cnVlIH0gOiB7fSksXHJcbiAgICAgIH0pO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICAvLyBgY29tbWl0Lm10aW1lYCBpcyB0aGUgc3RhdCBvYnNlcnZlZCBhdCBIQVNIIHRpbWUgZm9yIHRoaXMgZXhhY3QgY29udGVudFxyXG4gICAgLy8gKHRocmVhZGVkIHRocm91Z2ggYHN0YWdlUHVzaGVzYCksIG5ldmVyIGEgc3RhdCB0YWtlbiBhdCBhY2sgdGltZSBcdTIwMTQgYW5cclxuICAgIC8vIGVkaXQgdGhhdCBsYW5kZWQgYmV0d2VlbiBoYXNoaW5nIGFuZCB0aGlzIGFjayBjaGFuZ2VkIHRoZSBkaXNrIHN0YXQsIHNvXHJcbiAgICAvLyB0aGUgbmV4dCBzY2FuIG1pc3NlcyB0aGUgZmFzdCBwYXRoIGFuZCByZS1oYXNoZXMvcHVzaGVzIHRoZSBlZGl0LlxyXG4gICAgdGhpcy5pbmRleCA9IGFwcGx5Q29tbWl0KHRoaXMuaW5kZXgsIHtcclxuICAgICAgcGF0aDogY29tbWl0LnBhdGgsXHJcbiAgICAgIHZlcnNpb25JZCxcclxuICAgICAgaGFzaDogY29tbWl0Lmhhc2gsXHJcbiAgICAgIHNpemU6IGNvbW1pdC5zaXplLFxyXG4gICAgICBjbG9jayxcclxuICAgICAgZGVsZXRlZCxcclxuICAgICAgZGVsZXRlZEF0OiBkZWxldGVkID8gdGhpcy5ub3coKSA6IHVuZGVmaW5lZCxcclxuICAgICAgLi4uKGNvbW1pdC5pc0ZvbGRlciA9PT0gdHJ1ZSA/IHsgaXNGb2xkZXI6IHRydWUgfSA6IHt9KSxcclxuICAgICAgLi4uKGNvbW1pdC5tdGltZSAhPT0gdW5kZWZpbmVkID8geyBtdGltZTogY29tbWl0Lm10aW1lIH0gOiB7fSksXHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgaGFuZGxlQ29uZmxpY3RSZXBseShcclxuICAgIGNvbW1pdDogU3RhZ2VkQ29tbWl0LFxyXG4gICAgcmVwbHk6IENvbmZsaWN0TWVzc2FnZSxcclxuICApOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGlmIChyZXBseS5zZXEgIT09IHVuZGVmaW5lZCAmJiByZXBseS5zZXEgPiB0aGlzLmN1cnNvcikgdGhpcy5jdXJzb3IgPSByZXBseS5zZXE7XHJcbiAgICBjb25zdCB3ZVdvbiA9XHJcbiAgICAgIHJlcGx5Lndpbm5lci5kZXZpY2VJZCA9PT0gdGhpcy5vcHRpb25zLmRldmljZUlkICYmIHJlcGx5Lndpbm5lci5oYXNoID09PSBjb21taXQuaGFzaDtcclxuICAgIGlmICh3ZVdvbikge1xyXG4gICAgICB0aGlzLmFwcGx5QWNrVG9JbmRleChjb21taXQsIHJlcGx5Lndpbm5lci5pZCwgcmVwbHkud2lubmVyLmNsb2NrKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIFdlIGxvc3QgdGhlIHJhY2UuIE1hdGVyaWFsaXplIHRoZSB3aW5uZXIgZGlyZWN0bHkgXHUyMDE0IHRoZSBzZXJ2ZXIgaGFzXHJcbiAgICAvLyBhbHJlYWR5IHByZXNlcnZlZCBvdXIgY29udGVudCBhcyBhIGNvbmZsaWN0IGNvcHkgKGlmIGl0IHdhcyBkaXN0aW5jdCkuXHJcbiAgICAvLyBPbmUgY2F2ZWF0OiBpZiB0aGUgd29ya2luZyB0cmVlIG1vdmVkIG9uIEFHQUlOIHNpbmNlIHdlIHN0YWdlZCB0aGlzXHJcbiAgICAvLyBjb21taXQsIGRvIG5vdCBjbG9iYmVyIGl0IGVpdGhlciBcdTIwMTQgaGFuZCB0aGUgd2hvbGUgdGhpbmcgdG8gYSBjeWNsZS5cclxuICAgIGlmIChjb21taXQua2luZCAhPT0gJ2RlbGV0ZScgJiYgY29tbWl0LmtpbmQgIT09ICdyZW5hbWUnICYmIGNvbW1pdC5pc0ZvbGRlciAhPT0gdHJ1ZSkge1xyXG4gICAgICBjb25zdCBsb2NhbCA9IGF3YWl0IHRoaXMucmVhZExvY2FsKGNvbW1pdC5wYXRoKTtcclxuICAgICAgaWYgKGxvY2FsICE9PSB1bmRlZmluZWQgJiYgKGF3YWl0IHNoYTI1NkhleChsb2NhbCkpICE9PSBjb21taXQuaGFzaCkge1xyXG4gICAgICAgIHRoaXMuc2NoZWR1bGVSZWNvbmNpbGUoKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBpZiAoY29tbWl0LmtpbmQgPT09ICdyZW5hbWUnICYmIGNvbW1pdC5mcm9tUGF0aCAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgIC8vIE91ciByZW5hbWUgbG9zdDogdGhlIGZpbGUgc3RheXMgd2hlcmUgdGhlIHdpbm5lciBrZWVwcyBpdDsgcmVjb3JkXHJcbiAgICAgIC8vIHRoZSB3aW5uZXIgaGVhZCBmb3IgdGhlIGRlc3RpbmF0aW9uICh0aGUgc291cmNlIHBhdGggaXMgdW50b3VjaGVkKS5cclxuICAgICAgLy8gQSBwbGFjZWhvbGRlciB3aW5uZXIgcmVjb3JkcyBmb2xkZXIgbWV0YWRhdGEgXHUyMDE0IG5ldmVyIGEgY29udGVudCBwdWxsLlxyXG4gICAgICB0aGlzLmluZGV4ID0gYXBwbHlDb21taXQodGhpcy5pbmRleCwge1xyXG4gICAgICAgIHBhdGg6IHJlcGx5Lndpbm5lci5wYXRoLFxyXG4gICAgICAgIHZlcnNpb25JZDogcmVwbHkud2lubmVyLmlkLFxyXG4gICAgICAgIGhhc2g6IHJlcGx5Lndpbm5lci5oYXNoLFxyXG4gICAgICAgIHNpemU6IHJlcGx5Lndpbm5lci5zaXplLFxyXG4gICAgICAgIGNsb2NrOiByZXBseS53aW5uZXIuY2xvY2ssXHJcbiAgICAgICAgLi4uKHJlcGx5Lndpbm5lci5pc0ZvbGRlciA9PT0gdHJ1ZSA/IHsgaXNGb2xkZXI6IHRydWUgfSA6IHt9KSxcclxuICAgICAgfSk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICB0aGlzLmluZGV4ID0gYXdhaXQgdGhpcy5hcHBseVB1bGxzKFt0aGlzLndpbm5lckFzUHVsbChyZXBseS53aW5uZXIpXSk7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBUdXJuIGFuIGFyYml0cmF0ZWQgd2lubmVyIHZlcnNpb24gaW50byBhIHB1bGwgb3AgKGNvbnRlbnQgb3BzIG9ubHkpLlxyXG4gICAqIGBpc0ZvbGRlcmAgcmlkZXMgYWxvbmcgd2hlbiB0aGUgc2VydmVyIHNlbnQgaXQgKG9sZGVyIHNlcnZlcnMgb21pdCB0aGVcclxuICAgKiBmbGFnKTogYSBmb2xkZXItcGxhY2Vob2xkZXIgd2lubmVyIG11c3QgbWF0ZXJpYWxpemUgYXMgYW4gYGVuc3VyZURpcmAsIG5vdFxyXG4gICAqIGFzIGEgY29udGVudCBmZXRjaCBmb3IgaXRzIGVtcHR5IGhhc2ggXHUyMDE0IHdoaWNoIHRoZSBibG9iIGd1YXJkIHJlZnVzZXMsXHJcbiAgICogd2VkZ2luZyBldmVyeSBmdXR1cmUgY3ljbGUgb24gdGhlIHNhbWUgY29uZmxpY3QuXHJcbiAgICovXHJcbiAgcHJpdmF0ZSB3aW5uZXJBc1B1bGwod2lubmVyOiB7XHJcbiAgICBwYXRoOiBzdHJpbmc7XHJcbiAgICBpZDogc3RyaW5nO1xyXG4gICAgaGFzaDogc3RyaW5nO1xyXG4gICAgc2l6ZTogbnVtYmVyO1xyXG4gICAgZGV2aWNlSWQ6IHN0cmluZztcclxuICAgIGNsb2NrOiBMb2dpY2FsQ2xvY2s7XHJcbiAgICBraW5kOiBDb21taXRNZXNzYWdlWydraW5kJ107XHJcbiAgICBpc0ZvbGRlcj86IGJvb2xlYW47XHJcbiAgfSk6IFB1bGxPcCB7XHJcbiAgICBjb25zdCBlbnRyeSA9IHRoaXMuaW5kZXhbd2lubmVyLnBhdGhdO1xyXG4gICAgY29uc3QgZGVsZXRlZCA9IHdpbm5lci5raW5kID09PSAnZGVsZXRlJztcclxuICAgIGNvbnN0IGtpbmQ6IFB1bGxGaWxlT3BbJ2tpbmQnXSA9IGRlbGV0ZWRcclxuICAgICAgPyAnZGVsZXRlJ1xyXG4gICAgICA6IGVudHJ5ID09PSB1bmRlZmluZWRcclxuICAgICAgICA/ICdhZGQnXHJcbiAgICAgICAgOiBlbnRyeS5kZWxldGVkQXQgIT09IHVuZGVmaW5lZFxyXG4gICAgICAgICAgPyAncmVzdG9yZSdcclxuICAgICAgICAgIDogJ2VkaXQnO1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAga2luZCxcclxuICAgICAgcGF0aDogd2lubmVyLnBhdGgsXHJcbiAgICAgIGhhc2g6IHdpbm5lci5oYXNoLFxyXG4gICAgICBzaXplOiB3aW5uZXIuc2l6ZSxcclxuICAgICAgdmVyc2lvbjogd2lubmVyLmlkLFxyXG4gICAgICBjbG9jazogd2lubmVyLmNsb2NrLFxyXG4gICAgICBkZWxldGVkLFxyXG4gICAgICAuLi4od2lubmVyLmlzRm9sZGVyID09PSB0cnVlID8geyBpc0ZvbGRlcjogdHJ1ZSB9IDoge30pLFxyXG4gICAgfTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgdXBsb2FkQmxvYihoYXNoOiBzdHJpbmcsIGJ5dGVzOiBVaW50OEFycmF5KTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zdCB0cmFuc3BvcnQgPSB0aGlzLnRyYW5zcG9ydDtcclxuICAgIGlmICh0cmFuc3BvcnQgPT09IG51bGwpIHRocm93IG5ldyBOZXR3b3JrRXJyb3IoJ25vdCBjb25uZWN0ZWQnKTtcclxuICAgIGNvbnN0IHJlcGx5ID0gYXdhaXQgdGhpcy5yZXF1ZXN0PEJsb2JBY2tNZXNzYWdlIHwgU2VydmVyRXJyb3JNZXNzYWdlPihcclxuICAgICAgKG0pID0+IG0udHlwZSA9PT0gJ2Jsb2JBY2snIHx8IG0udHlwZSA9PT0gJ2Vycm9yJyxcclxuICAgICAgKCkgPT4gdHJhbnNwb3J0LnNlbmQoeyB0eXBlOiAncHV0QmxvYicsIGhhc2gsIGNvbnRlbnQ6IGJ5dGVzVG9CYXNlNjQoYnl0ZXMpIH0pLFxyXG4gICAgKTtcclxuICAgIGlmIChyZXBseS50eXBlID09PSAnZXJyb3InKSB0aHJvdyB0aGlzLnRvRXJyb3IocmVwbHkpO1xyXG4gICAgYXdhaXQgdGhpcy5vcHRpb25zLmJsb2JTdG9yZS5wdXQoaGFzaCwgYnl0ZXMpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSByZWFkb25seSBmZXRjaEJsb2I6IEZldGNoQmxvYiA9IGFzeW5jIChoYXNoOiBzdHJpbmcpOiBQcm9taXNlPFVpbnQ4QXJyYXk+ID0+IHtcclxuICAgIGlmIChoYXNoID09PSAnJykgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoJ3JlZnVzaW5nIHRvIGZldGNoIGNvbnRlbnQgZm9yIGFuIGVtcHR5IGhhc2gnKTtcclxuICAgIGNvbnN0IGNhY2hlZCA9IGF3YWl0IHRoaXMub3B0aW9ucy5ibG9iU3RvcmUuZ2V0KGhhc2gpO1xyXG4gICAgaWYgKGNhY2hlZCAhPT0gdW5kZWZpbmVkKSByZXR1cm4gY2FjaGVkO1xyXG4gICAgY29uc3QgYnl0ZXMgPSBhd2FpdCB0aGlzLmRvd25sb2FkQmxvYihoYXNoKTtcclxuICAgIGF3YWl0IHRoaXMub3B0aW9ucy5ibG9iU3RvcmUucHV0KGhhc2gsIGJ5dGVzKTtcclxuICAgIHJldHVybiBieXRlcztcclxuICB9O1xyXG5cclxuICBwcml2YXRlIGFzeW5jIGRvd25sb2FkQmxvYihoYXNoOiBzdHJpbmcpOiBQcm9taXNlPFVpbnQ4QXJyYXk+IHtcclxuICAgIGNvbnN0IHRyYW5zcG9ydCA9IHRoaXMudHJhbnNwb3J0O1xyXG4gICAgaWYgKHRyYW5zcG9ydCA9PT0gbnVsbCkgdGhyb3cgbmV3IE5ldHdvcmtFcnJvcignbm90IGNvbm5lY3RlZCcpO1xyXG4gICAgY29uc3QgcmVwbHkgPSBhd2FpdCB0aGlzLnJlcXVlc3Q8QmxvYk1lc3NhZ2UgfCBTZXJ2ZXJFcnJvck1lc3NhZ2U+KFxyXG4gICAgICAobSkgPT4gKG0udHlwZSA9PT0gJ2Jsb2InICYmIG0uaGFzaCA9PT0gaGFzaCkgfHwgbS50eXBlID09PSAnZXJyb3InLFxyXG4gICAgICAoKSA9PiB0cmFuc3BvcnQuc2VuZCh7IHR5cGU6ICdnZXRCbG9iJywgaGFzaCB9KSxcclxuICAgICk7XHJcbiAgICBpZiAocmVwbHkudHlwZSA9PT0gJ2Vycm9yJykgdGhyb3cgdGhpcy50b0Vycm9yKHJlcGx5KTtcclxuICAgIGNvbnN0IGJ5dGVzID0gYmFzZTY0VG9CeXRlcyhyZXBseS5jb250ZW50KTtcclxuICAgIGlmICgoYXdhaXQgc2hhMjU2SGV4KGJ5dGVzKSkgIT09IGhhc2gpIHtcclxuICAgICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoYGJsb2IgJHtoYXNofSBmYWlsZWQgdmVyaWZpY2F0aW9uIG9uIGRvd25sb2FkYCk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gYnl0ZXM7XHJcbiAgfVxyXG5cclxuICAvLyAtLS0gc25hcHNob3RzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblxyXG4gIC8qKlxyXG4gICAqIFNuYXBzaG90IGV2ZXJ5IGZpbGUgaGVhZCBvbiB0aGUgYXV0aG9yaXR5IChhIHdob2xlLXZhdWx0IHJlc3RvcmUgcG9pbnQpLlxyXG4gICAqIFNuYXBzaG90cyBhcmUgbm90IGJyb2FkY2FzdCBcdTIwMTQgb3RoZXIgZGV2aWNlcyBzZWUgbm90aGluZyBsaXZlLlxyXG4gICAqL1xyXG4gIGFzeW5jIGNyZWF0ZVNuYXBzaG90KG5hbWU/OiBzdHJpbmcpOiBQcm9taXNlPFNuYXBzaG90Q3JlYXRlQWNrTWVzc2FnZT4ge1xyXG4gICAgY29uc3QgdHJhbnNwb3J0ID0gdGhpcy50cmFuc3BvcnQ7XHJcbiAgICBpZiAodHJhbnNwb3J0ID09PSBudWxsKSB0aHJvdyBuZXcgTmV0d29ya0Vycm9yKCdub3QgY29ubmVjdGVkJyk7XHJcbiAgICBjb25zdCByZXBseSA9IGF3YWl0IHRoaXMucmVxdWVzdDxTbmFwc2hvdENyZWF0ZUFja01lc3NhZ2UgfCBTZXJ2ZXJFcnJvck1lc3NhZ2U+KFxyXG4gICAgICAobSkgPT4gbS50eXBlID09PSAnc25hcHNob3RDcmVhdGVBY2snIHx8IG0udHlwZSA9PT0gJ2Vycm9yJyxcclxuICAgICAgKCkgPT4gdHJhbnNwb3J0LnNlbmQoeyB0eXBlOiAnc25hcHNob3RDcmVhdGUnLCAuLi4obmFtZSAhPT0gdW5kZWZpbmVkID8geyBuYW1lIH0gOiB7fSkgfSksXHJcbiAgICApO1xyXG4gICAgaWYgKHJlcGx5LnR5cGUgPT09ICdlcnJvcicpIHRocm93IHRoaXMudG9FcnJvcihyZXBseSk7XHJcbiAgICByZXR1cm4gcmVwbHk7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBSZXN0b3JlIHRoZSB3aG9sZSB2YXVsdCB0byBhIHNuYXBzaG90LiBUaGUgc2VydmVyIGxhbmRzIGV2ZXJ5IHJldmVydGVkXHJcbiAgICogaGVhZCBhcyBhIE5FVyB2ZXJzaW9uIChoaXN0b3J5IGlzIG5ldmVyIGRlbGV0ZWQpIGFuZCBmYW5zIHRoZSBjaGFuZ2VzIG91dFxyXG4gICAqIHRvIE9USEVSIHNvY2tldHMgb25seSBcdTIwMTQgdGhpcyBkZXZpY2UgZG9lcyBub3QgcmVjZWl2ZSBpdHMgb3duIGZhbi1vdXQsIHNvXHJcbiAgICogdGhlIGxvY2FsIGluZGV4IG11c3QgcmUtY29udmVyZ2UgZnJvbSBhIEZVTEwgbWFuaWZlc3Q6IGZsYWcgZGVsdGEgbW9kZVxyXG4gICAqIG9mZiwgdGhlbiBydW4gYSBjeWNsZSBpbmxpbmUgKG9uZS1zaG90IGNhbGxlcnMgY2xvc2UgdGhlIHRyYW5zcG9ydCBhc1xyXG4gICAqIHNvb24gYXMgdGhpcyByZXNvbHZlcywgc28gYSBkZWJvdW5jZWQgY3ljbGUgd291bGQgbmV2ZXIgZmlyZSkuXHJcbiAgICovXHJcbiAgYXN5bmMgcmVzdG9yZVNuYXBzaG90KGlkOiBzdHJpbmcpOiBQcm9taXNlPFNuYXBzaG90UmVzdG9yZUFja01lc3NhZ2U+IHtcclxuICAgIGNvbnN0IHRyYW5zcG9ydCA9IHRoaXMudHJhbnNwb3J0O1xyXG4gICAgaWYgKHRyYW5zcG9ydCA9PT0gbnVsbCkgdGhyb3cgbmV3IE5ldHdvcmtFcnJvcignbm90IGNvbm5lY3RlZCcpO1xyXG4gICAgY29uc3QgcmVwbHkgPSBhd2FpdCB0aGlzLnJlcXVlc3Q8U25hcHNob3RSZXN0b3JlQWNrTWVzc2FnZSB8IFNlcnZlckVycm9yTWVzc2FnZT4oXHJcbiAgICAgIChtKSA9PiBtLnR5cGUgPT09ICdzbmFwc2hvdFJlc3RvcmVBY2snIHx8IG0udHlwZSA9PT0gJ2Vycm9yJyxcclxuICAgICAgKCkgPT4gdHJhbnNwb3J0LnNlbmQoeyB0eXBlOiAnc25hcHNob3RSZXN0b3JlJywgaWQgfSksXHJcbiAgICApO1xyXG4gICAgaWYgKHJlcGx5LnR5cGUgPT09ICdlcnJvcicpIHRocm93IHRoaXMudG9FcnJvcihyZXBseSk7XHJcbiAgICB0aGlzLm5lZWRzRnVsbE1hbmlmZXN0ID0gdHJ1ZTtcclxuICAgIGF3YWl0IHRoaXMuZW5xdWV1ZSgoKSA9PiB0aGlzLnJ1bkN5Y2xlKCkpO1xyXG4gICAgcmV0dXJuIHJlcGx5O1xyXG4gIH1cclxuXHJcbiAgLy8gLS0tIHBsdW1iaW5nIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHJcbiAgcHJpdmF0ZSByZXF1ZXN0PFQgZXh0ZW5kcyBTZXJ2ZXJNZXNzYWdlPihcclxuICAgIG1hdGNoZXM6IChtZXNzYWdlOiBNZXNzYWdlKSA9PiBib29sZWFuLFxyXG4gICAgc2VuZDogKCkgPT4gdm9pZCxcclxuICApOiBQcm9taXNlPFQ+IHtcclxuICAgIHJldHVybiBuZXcgUHJvbWlzZTxUPigocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XHJcbiAgICAgIGNvbnN0IGV4cGVjdGF0aW9uOiAodHlwZW9mIHRoaXMuZXhwZWN0YXRpb25zKVtudW1iZXJdID0ge1xyXG4gICAgICAgIG1hdGNoZXM6IChtZXNzYWdlKSA9PiBtYXRjaGVzKG1lc3NhZ2UpLFxyXG4gICAgICAgIHJlc29sdmU6IChtZXNzYWdlKSA9PiByZXNvbHZlKG1lc3NhZ2UgYXMgVCksXHJcbiAgICAgICAgcmVqZWN0LFxyXG4gICAgICB9O1xyXG4gICAgICB0aGlzLmV4cGVjdGF0aW9ucy5wdXNoKGV4cGVjdGF0aW9uKTtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBzZW5kKCk7XHJcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgY29uc3QgaW5kZXggPSB0aGlzLmV4cGVjdGF0aW9ucy5pbmRleE9mKGV4cGVjdGF0aW9uKTtcclxuICAgICAgICBpZiAoaW5kZXggPj0gMCkgdGhpcy5leHBlY3RhdGlvbnMuc3BsaWNlKGluZGV4LCAxKTtcclxuICAgICAgICByZWplY3QoZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IE5ldHdvcmtFcnJvcihTdHJpbmcoZXJyb3IpKSk7XHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSB0b0Vycm9yKG1lc3NhZ2U6IFNlcnZlckVycm9yTWVzc2FnZSk6IEVycm9yIHtcclxuICAgIHN3aXRjaCAobWVzc2FnZS5jb2RlKSB7XHJcbiAgICAgIGNhc2UgJ1VOQVVUSE9SSVpFRCc6XHJcbiAgICAgICAgcmV0dXJuIG5ldyBVbmF1dGhvcml6ZWRFcnJvcihtZXNzYWdlLm1lc3NhZ2UpO1xyXG4gICAgICBjYXNlICdSRVZPS0VEJzpcclxuICAgICAgICByZXR1cm4gbmV3IFJldm9rZWRFcnJvcihtZXNzYWdlLm1lc3NhZ2UpO1xyXG4gICAgICBkZWZhdWx0OlxyXG4gICAgICAgIHJldHVybiBuZXcgUHJvdG9jb2xFcnJvcihtZXNzYWdlLm1lc3NhZ2UpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBlbnF1ZXVlKG9wZXJhdGlvbjogKCkgPT4gUHJvbWlzZTx2b2lkPik6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgdGhpcy5xdWV1ZWRPcHMgKz0gMTtcclxuICAgIGNvbnN0IHJ1biA9IHRoaXMudGFpbC50aGVuKG9wZXJhdGlvbiwgb3BlcmF0aW9uKTtcclxuICAgIGNvbnN0IHNldHRsZWQgPSBydW4udGhlbihcclxuICAgICAgKCkgPT4ge1xyXG4gICAgICAgIHRoaXMucXVldWVkT3BzIC09IDE7XHJcbiAgICAgICAgdGhpcy5wZXJzaXN0SW5kZXgoKTtcclxuICAgICAgfSxcclxuICAgICAgKGVycm9yOiB1bmtub3duKSA9PiB7XHJcbiAgICAgICAgdGhpcy5xdWV1ZWRPcHMgLT0gMTtcclxuICAgICAgICB0aGlzLnBlcnNpc3RJbmRleCgpO1xyXG4gICAgICAgIHRocm93IGVycm9yO1xyXG4gICAgICB9LFxyXG4gICAgKTtcclxuICAgIC8vIFN3YWxsb3cgcmVqZWN0aW9ucyBvbiB0aGUgc2hhcmVkIHRhaWwgKGluZGl2aWR1YWwgY2FsbGVycyBzZWUgdGhlbSB2aWFcclxuICAgIC8vIGBzZXR0bGVkYCk7IG9uZSBmYWlsZWQgb3AgbXVzdCBub3QgcG9pc29uIHRoZSBxdWV1ZS5cclxuICAgIHRoaXMudGFpbCA9IHNldHRsZWQudGhlbihcclxuICAgICAgKCkgPT4ge30sXHJcbiAgICAgICgpID0+IHt9LFxyXG4gICAgKTtcclxuICAgIHJldHVybiBzZXR0bGVkO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBwZXJzaXN0SW5kZXgoKTogdm9pZCB7XHJcbiAgICBjb25zdCBzbmFwc2hvdCA9IHNlcmlhbGl6ZUxvY2FsSW5kZXgodGhpcy5pbmRleCwgdGhpcy5wZXJzaXN0ZWRTdGF0ZSgpKTtcclxuICAgIHZvaWQgdGhpcy5vcHRpb25zLnN0b3JhZ2VcclxuICAgICAgLndyaXRlRmlsZShMT0NBTF9JTkRFWF9TVEFURV9QQVRILCBuZXcgVGV4dEVuY29kZXIoKS5lbmNvZGUoc25hcHNob3QpKVxyXG4gICAgICAuY2F0Y2goKGVycm9yOiB1bmtub3duKSA9PiB0aGlzLmxvZy53YXJuKCdmYWlsZWQgdG8gcGVyc2lzdCBsb2NhbCBpbmRleCcsIGVycm9yKSk7XHJcbiAgfVxyXG59XHJcblxyXG4vLyAtLS0gbW9kdWxlLXByaXZhdGUgdHlwZSBhbGlhc2VzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cclxudHlwZSBTZXJ2ZXJFcnJvck1lc3NhZ2UgPSBFeHRyYWN0PFNlcnZlck1lc3NhZ2UsIHsgdHlwZTogJ2Vycm9yJyB9PjtcclxuXHJcbi8qKiBFdmVyeSB2YXVsdCBwYXRoIGEgcHVsbCB3b3VsZCB0b3VjaCBvbiBkaXNrIChib3RoIGVuZHMgb2YgYSByZW5hbWUpLiAqL1xyXG5mdW5jdGlvbiBwdWxsVGFyZ2V0cyhwdWxsOiBQdWxsT3ApOiBzdHJpbmdbXSB7XHJcbiAgcmV0dXJuIHB1bGwua2luZCA9PT0gJ3JlbmFtZScgPyBbcHVsbC5mcm9tUGF0aCwgcHVsbC50b1BhdGhdIDogW3B1bGwucGF0aF07XHJcbn1cclxuXHJcbi8qKiBUaGUgZmlyc3QgV2luZG93cy11bnNhZmUgcGF0aCBhbW9uZyBgcGF0aHNgOyB1bmRlZmluZWQgd2hlbiBhbGwgYXJlIHNhZmUuICovXHJcbmZ1bmN0aW9uIGZpcnN0VW5zYWZlUGF0aChwYXRoczogcmVhZG9ubHkgc3RyaW5nW10pOiBzdHJpbmcgfCB1bmRlZmluZWQge1xyXG4gIHJldHVybiBwYXRocy5maW5kKChwYXRoKSA9PiBpc1dpbmRvd3NVbnNhZmVQYXRoKHBhdGgpKTtcclxufVxyXG4iLCAiLyoqXG4gKiBTZXJ2ZXIgY29tcGF0aWJpbGl0eSBwb2xpY3kgXHUyMDE0IHRoZSB2ZXJzaW9uLXNrZXcgY29tcGFuaW9uIHRvIHRoZSB3aXJlXG4gKiBwcm90b2NvbCBjaGVjay5cbiAqXG4gKiBTZWxmLWhvc3RlcnMgZGVwbG95IHRoZSB3b3JrZXIgZnJvbSBhIENsb3VkZmxhcmUgdGVtcGxhdGUgcGlubmVkIHRvIGFcbiAqIHJlbGVhc2Ugd2hpbGUgdGhlIHBsdWdpbi9DTEkvZGFlbW9uIHVwZGF0ZSBvbiB0aGVpciBvd24gc2NoZWR1bGVzLCBzb1xuICogdmVyc2lvbiBza2V3IGFjcm9zcyBjb21wb25lbnRzIGlzIGd1YXJhbnRlZWQuIFRoZSBXUyBoYW5kc2hha2UgYWxyZWFkeVxuICogZW5mb3JjZXMgYW4gRVhBQ1QgYFByb3RvY29sVmVyc2lvbmAgbWF0Y2ggKGhhcmQgZ2F0ZSwgcHJvdG9jb2wudHMpOyB0aGlzXG4gKiBtb2R1bGUgYW5zd2VycyB0aGUgc29mdGVyIHF1ZXN0aW9uIFwiaXMgdGhpcyByZXBvcnRlZCBzZXJ2ZXIgcmVsZWFzZVxuICogcmVhc29uYWJseSBtYXRjaGVkIHRvIHRoaXMgY2xpZW50P1wiIHdpdGggYSBwdXJlLCBkZXBlbmRlbmN5LWZyZWUgdmVyZGljdFxuICogZXZlcnkgVUkgY2FuIHNoYXJlICh0aGUgcGx1Z2luJ3Mgc3RhdHVzIG5vdGUvTm90aWNlLCBgdnNhIGRvY3RvcmApLlxuICpcbiAqIERlbGliZXJhdGVseSB0b2xlcmFudDogb25seSBhIHNlcnZlciBPTERFUiB0aGFuIHRoZSBzdXBwb3J0ZWQgZmxvb3IgaXMgYW5cbiAqIGVycm9yOyBuZXdlciBzZXJ2ZXJzIGFuZCB1bnBhcnNlYWJsZS9hYnNlbnQgdmVyc2lvbnMgYXJlIHdhcm5pbmdzLCBuZXZlclxuICogc3luYy1raWxsZXJzLlxuICovXG5cbi8qKlxuICogT2xkZXN0IHNlcnZlciByZWxlYXNlIHRoZSBjbGllbnRzIGNhbiBiZSBleHBlY3RlZCB0byB3b3JrIGFnYWluc3QuIFNlcnZlcnNcbiAqIGJlbG93IHRoaXMgYXJlIHJlcG9ydGVkIGFzIGVycm9ycyAoXCJ1cGRhdGUgdGhlIHdvcmtlclwiKS5cbiAqL1xuZXhwb3J0IGNvbnN0IE1JTl9TVVBQT1JURURfU0VSVkVSX1ZFUlNJT04gPSAnMC4xLjAnO1xuXG4vKiogT3V0Y29tZSBvZiBgY2hlY2tTZXJ2ZXJDb21wYXRpYmlsaXR5YC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ29tcGF0aWJpbGl0eVZlcmRpY3Qge1xuICAvKipcbiAgICogYG9rYCBcdTIwMTQgbm90aGluZyB0byBkbzsgYHdhcm5gIFx1MjAxNCB3b3JrcywgY29uc2lkZXIgdXBkYXRpbmcgYSBjb21wb25lbnQ7XG4gICAqIGBlcnJvcmAgXHUyMDE0IHRoZSBzZXJ2ZXIgaXMgYmVsb3cgdGhlIHN1cHBvcnRlZCBmbG9vci4gTmV2ZXIgYSBzeW5jLWtpbGxlcjpcbiAgICogdGhlIHdpcmUgYFByb3RvY29sVmVyc2lvbmAgY2hlY2sgcmVtYWlucyB0aGUgaGFyZCBnYXRlLlxuICAgKi9cbiAgbGV2ZWw6ICdvaycgfCAnd2FybicgfCAnZXJyb3InO1xuICAvKiogVXNlci1mYWNpbmcgc2VudGVuY2UgKGVtcHR5LWlzaCBmb3IgdGhlIGBva2AgY2FzZSkuICovXG4gIG1lc3NhZ2U6IHN0cmluZztcbn1cblxuLyoqIFRoZSBwYXJ0cyBvZiBhIHNlbXZlciBzdHJpbmcgdGhlIHBvbGljeSBjb21wYXJlcyAocHJlcmVsZWFzZS9idWlsZCBpZ25vcmVkKS4gKi9cbmludGVyZmFjZSBTZW1WZXIge1xuICBtYWpvcjogbnVtYmVyO1xuICBtaW5vcjogbnVtYmVyO1xuICBwYXRjaDogbnVtYmVyO1xufVxuXG4vKipcbiAqIGBtYWpvci5taW5vci5wYXRjaGAsIHRvbGVyYXRpbmcgYSBsZWFkaW5nIGB2YCwgYSBgLXByZXJlbGVhc2VgLCBhbmQgYVxuICogYCtidWlsZGAgc3VmZml4LiBBbnl0aGluZyBlbHNlIChpbmNsdWRpbmcgYDAuMWAtc3R5bGUgdHdvLXBhcnQgdmVyc2lvbnMpXG4gKiBwYXJzZXMgYXMgYG51bGxgIFx1MjAxNCB0aGUgcG9saWN5IHRoZW4gd2FybnMgd2l0aCB0aGUgcmF3IHZhbHVlIGluc3RlYWQgb2ZcbiAqIGd1ZXNzaW5nLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VTZW1WZXIocmF3OiBzdHJpbmcpOiBTZW1WZXIgfCBudWxsIHtcbiAgY29uc3QgbWF0Y2ggPSAvXnY/KFxcZCspXFwuKFxcZCspXFwuKFxcZCspKD86LVswLTlBLVphLXouLV0rKT8oPzpcXCtbMC05QS1aYS16Li1dKyk/JC8uZXhlYyhcbiAgICByYXcudHJpbSgpLFxuICApO1xuICBpZiAobWF0Y2ggPT09IG51bGwpIHJldHVybiBudWxsO1xuICByZXR1cm4geyBtYWpvcjogTnVtYmVyKG1hdGNoWzFdKSwgbWlub3I6IE51bWJlcihtYXRjaFsyXSksIHBhdGNoOiBOdW1iZXIobWF0Y2hbM10pIH07XG59XG5cbi8qKiBUaHJlZS13YXkgY29tcGFyZSBvbiBtYWpvciBcdTIxOTIgbWlub3IgXHUyMTkyIHBhdGNoIChwcmVyZWxlYXNlL2J1aWxkIGlnbm9yZWQpLiAqL1xuZnVuY3Rpb24gY29tcGFyZVNlbVZlcihhOiBTZW1WZXIsIGI6IFNlbVZlcik6IG51bWJlciB7XG4gIGlmIChhLm1ham9yICE9PSBiLm1ham9yKSByZXR1cm4gYS5tYWpvciA8IGIubWFqb3IgPyAtMSA6IDE7XG4gIGlmIChhLm1pbm9yICE9PSBiLm1pbm9yKSByZXR1cm4gYS5taW5vciA8IGIubWlub3IgPyAtMSA6IDE7XG4gIGlmIChhLnBhdGNoICE9PSBiLnBhdGNoKSByZXR1cm4gYS5wYXRjaCA8IGIucGF0Y2ggPyAtMSA6IDE7XG4gIHJldHVybiAwO1xufVxuXG4vKipcbiAqIEFzc2VzcyBhIHNlcnZlcidzIHJlcG9ydGVkIHJlbGVhc2UgYWdhaW5zdCB0aGlzIGNsaWVudCdzIHZlcnNpb24uXG4gKlxuICogIC0gYHNlcnZlclZlcnNpb25gIG51bGwvdW5kZWZpbmVkL2VtcHR5IFx1MjE5MiB0aGUgc2VydmVyIHByZWRhdGVzIHZlcnNpb25cbiAqICAgIHJlcG9ydGluZyAoXHUyMjY0IDAuMSBuZXZlciBzZW5kcyB0aGUgZmllbGQpOiB3YXJuIHdpdGggYW4gdXBncmFkZSBoaW50LlxuICogIC0gVW5wYXJzZWFibGUgc2VydmVyVmVyc2lvbiBcdTIxOTIgd2FybiwgcXVvdGluZyB0aGUgcmF3IHZhbHVlLlxuICogIC0gU2VydmVyIGEgTUFKT1Igb3IgTUlOT1IgYWhlYWQgb2YgdGhlIGNsaWVudCBcdTIxOTIgd2FybiAocGF0Y2ggZ2FwcyBhcmVcbiAqICAgIGZpbmUpOyB0aGUgcHJvdG9jb2wgY2hlY2sgYWxyZWFkeSBndWFyZHMgYWN0dWFsIGluY29tcGF0aWJpbGl0eS5cbiAqICAtIFNlcnZlciBiZWxvdyBgTUlOX1NVUFBPUlRFRF9TRVJWRVJfVkVSU0lPTmAgXHUyMTkyIGVycm9yLlxuICogIC0gT3RoZXJ3aXNlIFx1MjE5MiBvay5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNoZWNrU2VydmVyQ29tcGF0aWJpbGl0eShcbiAgY2xpZW50VmVyc2lvbjogc3RyaW5nLFxuICBzZXJ2ZXJWZXJzaW9uOiBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkLFxuKTogQ29tcGF0aWJpbGl0eVZlcmRpY3Qge1xuICBpZiAoc2VydmVyVmVyc2lvbiA9PT0gbnVsbCB8fCBzZXJ2ZXJWZXJzaW9uID09PSB1bmRlZmluZWQgfHwgc2VydmVyVmVyc2lvbiA9PT0gJycpIHtcbiAgICByZXR1cm4ge1xuICAgICAgbGV2ZWw6ICd3YXJuJyxcbiAgICAgIG1lc3NhZ2U6ICdzeW5jIHNlcnZlciBwcmVkYXRlcyB2ZXJzaW9uIHJlcG9ydGluZyAoXFx1MjI2NCAwLjEpIFxcdTIwMTQgY29uc2lkZXIgdXBkYXRpbmcgaXQgKGRvY3MvVVBHUkFESU5HLm1kKScsXG4gICAgfTtcbiAgfVxuICBjb25zdCBzZXJ2ZXIgPSBwYXJzZVNlbVZlcihzZXJ2ZXJWZXJzaW9uKTtcbiAgaWYgKHNlcnZlciA9PT0gbnVsbCkge1xuICAgIHJldHVybiB7XG4gICAgICBsZXZlbDogJ3dhcm4nLFxuICAgICAgbWVzc2FnZTogYHNlcnZlciB2ZXJzaW9uICR7SlNPTi5zdHJpbmdpZnkoc2VydmVyVmVyc2lvbil9IGlzIG5vdCBzZW12ZXIgXFx1MjAxNCBjb21wYXRpYmlsaXR5IHVua25vd25gLFxuICAgIH07XG4gIH1cbiAgLy8gQSBjbGllbnQgdmVyc2lvbiB3ZSBjYW5ub3QgcGFyc2UgKGRldiBidWlsZHMsIFwidW5rbm93blwiKSBzaW1wbHkgc2tpcHMgdGhlXG4gIC8vIG5ld2VyLXNlcnZlciBjb21wYXJpc29uIHJhdGhlciB0aGFuIGZhaWxpbmcgdGhlIHdob2xlIGFzc2Vzc21lbnQuXG4gIGNvbnN0IGNsaWVudCA9IHBhcnNlU2VtVmVyKGNsaWVudFZlcnNpb24pO1xuICBpZiAoY2xpZW50ICE9PSBudWxsICYmIChzZXJ2ZXIubWFqb3IgPiBjbGllbnQubWFqb3IgfHwgc2VydmVyLm1pbm9yID4gY2xpZW50Lm1pbm9yKSkge1xuICAgIHJldHVybiB7XG4gICAgICBsZXZlbDogJ3dhcm4nLFxuICAgICAgbWVzc2FnZTogYHNlcnZlciAke3NlcnZlclZlcnNpb259IGlzIG5ld2VyIHRoYW4gdGhpcyBjbGllbnQgKCR7Y2xpZW50VmVyc2lvbn0pIFxcdTIwMTQgdXBkYXRlIHRoZSBjbGllbnQgd2hlbiBjb252ZW5pZW50YCxcbiAgICB9O1xuICB9XG4gIGNvbnN0IG1pbmltdW0gPSBwYXJzZVNlbVZlcihNSU5fU1VQUE9SVEVEX1NFUlZFUl9WRVJTSU9OKTtcbiAgaWYgKG1pbmltdW0gIT09IG51bGwgJiYgY29tcGFyZVNlbVZlcihzZXJ2ZXIsIG1pbmltdW0pIDwgMCkge1xuICAgIHJldHVybiB7XG4gICAgICBsZXZlbDogJ2Vycm9yJyxcbiAgICAgIG1lc3NhZ2U6IGBzZXJ2ZXIgJHtzZXJ2ZXJWZXJzaW9ufSBpcyBvbGRlciB0aGFuIHRoZSBtaW5pbXVtIHN1cHBvcnRlZCAoJHtNSU5fU1VQUE9SVEVEX1NFUlZFUl9WRVJTSU9OfSkgXFx1MjAxNCB1cGRhdGUgaXQ6IGRvY3MvVVBHUkFESU5HLm1kYCxcbiAgICB9O1xuICB9XG4gIHJldHVybiB7IGxldmVsOiAnb2snLCBtZXNzYWdlOiBgc2VydmVyICR7c2VydmVyVmVyc2lvbn0gd29ya3Mgd2l0aCB0aGlzIGNsaWVudCAoJHtjbGllbnRWZXJzaW9ufSlgIH07XG59XG4iLCAiLyoqXG4gKiBgT2JzaWRpYW5TdG9yYWdlQWRhcHRlcmAgXHUyMDE0IGNvcmUncyBgU3RvcmFnZUFkYXB0ZXJgIG92ZXIgdGhlIE9ic2lkaWFuIHZhdWx0XG4gKiBgRGF0YUFkYXB0ZXJgIChBUkNISVRFQ1RVUkUgXHUwMEE3OCBhZGFwdGVyczogcGx1Z2luIGltcGxlbWVudGF0aW9uLCBkZXNrdG9wIGFuZFxuICogbW9iaWxlIGFsaWtlKS5cbiAqXG4gKiBQYXRoIG1hcHBpbmc6IGV2ZXJ5IHBhdGggY3Jvc3NpbmcgdGhlIGNvcmUgc2VhbSBpcyBhIFBPU0lYLW5vcm1hbGl6ZWQgdmF1bHRcbiAqIHBhdGggKGAvbm90ZXMvYS5tZGAsIHJvb3QgYC9gKTsgdGhlIE9ic2lkaWFuIGFkYXB0ZXIgd2FudHMgdGhlIHNhbWUgcGF0aFxuICogKndpdGhvdXQqIHRoZSBsZWFkaW5nIHNsYXNoIChgbm90ZXMvYS5tZGApLCB3aXRoIGAvYCAob3IgYCcnYCkgZm9yIHRoZSByb290LlxuICpcbiAqIEFsbCB3cml0ZXMgZ28gdGhyb3VnaCB0aGUgYWRhcHRlciAobmV2ZXIgYHZhdWx0Lm1vZGlmeWAgb24gdGhlIHNpZGUpLCBzb1xuICogT2JzaWRpYW4ncyBvd24gZmlsZSB3YXRjaGluZyBvYnNlcnZlcyB0aGVtIGxpa2UgYW55IGV4dGVybmFsIGVkaXQgYW5kIG9wZW5cbiAqIGVkaXRvcnMgcmVmcmVzaCAoRlItMykuIFdyaXRlcyBhcmUgYXRvbWljLWlzaDogY29udGVudCBsYW5kcyBpbiBhIHRlbXAgZmlsZVxuICogdW5kZXIgYC8udmF1bHRzeW5jZm9yYWdlbnRzL3RtcC9gIChjb3JlIGlnbm9yZXMgdGhhdCB3aG9sZSBzdWJ0cmVlKSBhbmQgaXNcbiAqIHJlbmFtZWQgb250byB0aGUgdGFyZ2V0OyBpZiByZW5hbWluZyBpcyB1bmF2YWlsYWJsZSAoZXhvdGljIG1vYmlsZVxuICogYWRhcHRlcnMpLCB3ZSBmYWxsIGJhY2sgdG8gYSBkaXJlY3Qgd3JpdGUuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBEYXRhQWRhcHRlciB9IGZyb20gJ29ic2lkaWFuJztcbmltcG9ydCB0eXBlIHsgRmlsZVN0YXQsIFN0b3JhZ2VBZGFwdGVyIH0gZnJvbSAnQHZzYS9jb3JlJztcbmltcG9ydCB7IG5vcm1hbGl6ZVZhdWx0UGF0aCB9IGZyb20gJ0B2c2EvY29yZSc7XG5cbi8qKiBEaXJlY3RvcnkgKGluc2lkZSB0aGUgdmF1bHQpIGhvbGRpbmcgdGVtcCBmaWxlcyBkdXJpbmcgYXRvbWljIHdyaXRlcy4gKi9cbmV4cG9ydCBjb25zdCBURU1QX0RJUl9WQVVMVF9QQVRIID0gJy8udmF1bHRzeW5jZm9yYWdlbnRzL3RtcCc7XG5cbi8qKiBTdGF0cyBPYnNpZGlhbidzIGBEYXRhQWRhcHRlci5zdGF0YCByZXR1cm5zIGZvciBhIGZpbGUuICovXG5pbnRlcmZhY2UgQWRhcHRlclN0YXQge1xuICBzaXplOiBudW1iZXI7XG4gIG10aW1lOiBudW1iZXI7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgT2JzaWRpYW5TdG9yYWdlQWRhcHRlck9wdGlvbnMge1xuICBhZGFwdGVyOiBEYXRhQWRhcHRlcjtcbiAgLyoqXG4gICAqIERlc2t0b3AgYW5kIG1vYmlsZSBPYnNpZGlhbidzIGBEYXRhQWRhcHRlci5ybWRpcmAgaXMgZnMucm0tYmFzZWQgYW5kXG4gICAqIHJlZnVzZXMgRVZFUlkgZGlyZWN0b3J5IChgRVJSX0ZTX0VJU0RJUmApIFx1MjAxNCBpdCBjYW5ub3QgcmVtb3ZlIGV2ZW4gYW5cbiAgICogZW1wdHkgZm9sZGVyLCB3aGljaCBzaWxlbnRseSBkZWdyYWRlZCBldmVyeSBmb2xkZXItdG9tYnN0b25lIGFwcGxpY2F0aW9uXG4gICAqIHRvIHJlY29yZC1vbmx5ICh0aGUgRi0xIHBpbmctcG9uZykuIFdoZW4gcHJvdmlkZWQsIGByZW1vdmVEaXJgIHBlcmZvcm1zXG4gICAqIHRoZSBlbXB0eS1mb2xkZXIgcmVtb3ZhbCB0aHJvdWdoIHRoaXMgY2FsbGJhY2sgaW5zdGVhZCBcdTIwMTQgdGhlIHBsdWdpbiB3aXJlc1xuICAgKiBpdCB0byBgZmlsZU1hbmFnZXIudHJhc2hGaWxlYCBvbiB0aGUgdmF1bHQncyBURm9sZGVyLCB3aGljaCB3b3JrcyBhbmRcbiAgICogbmV2ZXIgZGVzdHJveXMgZGF0YSAoc3lzdGVtIHRyYXNoOyBjb3JlIHByZS1jaGVja3MgZW1wdGluZXNzIGFueXdheSkuXG4gICAqIFJlY2VpdmVzIHRoZSBBREFQVEVSIHBhdGggKG5vIGxlYWRpbmcgc2xhc2gpLlxuICAgKi9cbiAgcmVtb3ZlRW1wdHlEaXI/OiAoYWRhcHRlclBhdGg6IHN0cmluZykgPT4gUHJvbWlzZTx2b2lkPjtcbn1cblxuZXhwb3J0IGNsYXNzIE9ic2lkaWFuU3RvcmFnZUFkYXB0ZXIgaW1wbGVtZW50cyBTdG9yYWdlQWRhcHRlciB7XG4gIHByaXZhdGUgcmVhZG9ubHkgYWRhcHRlcjogRGF0YUFkYXB0ZXI7XG4gIHByaXZhdGUgcmVhZG9ubHkgcmVtb3ZlRW1wdHlEaXI/OiAoYWRhcHRlclBhdGg6IHN0cmluZykgPT4gUHJvbWlzZTx2b2lkPjtcbiAgLyoqXG4gICAqIExhdGNoZWQgd2hlbiBhIHRlbXArcmVuYW1lIGF0dGVtcHQgZmFpbHM6IGV2ZXJ5IGxhdGVyIHdyaXRlIGdvZXMgc3RyYWlnaHRcbiAgICogdG8gYHdyaXRlQmluYXJ5YCBpbnN0ZWFkIG9mIHBheWluZyB0aGUgZmFpbGluZy1yZW5hbWUgcGVuYWx0eSBhZ2Fpbi5cbiAgICovXG4gIHByaXZhdGUgdGVtcFJlbmFtZUJyb2tlbiA9IGZhbHNlO1xuICBwcml2YXRlIHRlbXBDb3VudGVyID0gMDtcblxuICBjb25zdHJ1Y3RvcihvcHRpb25zOiBPYnNpZGlhblN0b3JhZ2VBZGFwdGVyT3B0aW9ucykge1xuICAgIHRoaXMuYWRhcHRlciA9IG9wdGlvbnMuYWRhcHRlcjtcbiAgICB0aGlzLnJlbW92ZUVtcHR5RGlyID0gb3B0aW9ucy5yZW1vdmVFbXB0eURpcjtcbiAgfVxuXG4gIC8vIC0tLSBwYXRoIG1hcHBpbmcgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIC8qKiBWYXVsdCBwYXRoIFx1MjE5MiBhZGFwdGVyIHBhdGggKGAvYS9iLm1kYCBcdTIxOTIgYGEvYi5tZGAsIGAvYCBcdTIxOTIgYC9gKS4gKi9cbiAgcHJpdmF0ZSB0b0FkYXB0ZXJQYXRoKHZhdWx0UGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBub3JtYWxpemVkID0gbm9ybWFsaXplVmF1bHRQYXRoKHZhdWx0UGF0aCk7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZWQgPT09ICcvJyA/ICcvJyA6IG5vcm1hbGl6ZWQuc2xpY2UoMSk7XG4gIH1cblxuICAvLyAtLS0gU3RvcmFnZUFkYXB0ZXIgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgYXN5bmMgcmVhZEZpbGUocGF0aDogc3RyaW5nKTogUHJvbWlzZTxVaW50OEFycmF5PiB7XG4gICAgY29uc3QgYnVmZmVyID0gYXdhaXQgdGhpcy5hZGFwdGVyLnJlYWRCaW5hcnkodGhpcy50b0FkYXB0ZXJQYXRoKHBhdGgpKTtcbiAgICByZXR1cm4gbmV3IFVpbnQ4QXJyYXkoYnVmZmVyKTtcbiAgfVxuXG4gIGFzeW5jIHdyaXRlRmlsZShwYXRoOiBzdHJpbmcsIGRhdGE6IFVpbnQ4QXJyYXkpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCB0YXJnZXQgPSB0aGlzLnRvQWRhcHRlclBhdGgocGF0aCk7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVQYXJlbnREaXJzKHRhcmdldCk7XG4gICAgLy8gQ29weSBpbnRvIGEgc3RhbmRhbG9uZSBBcnJheUJ1ZmZlcjogYGJ5dGVzLmJ1ZmZlcmAgbWF5IGJlIGEgcG9vbGVkXG4gICAgLy8gYnVmZmVyIGxhcmdlciB0aGFuIHRoZSB2aWV3IChjb3JlIHNsaWNlcyBhbmQgcmV1c2VzIGJ1ZmZlcnMpLlxuICAgIGNvbnN0IGJ1ZmZlciA9IG5ldyBBcnJheUJ1ZmZlcihkYXRhLmJ5dGVMZW5ndGgpO1xuICAgIG5ldyBVaW50OEFycmF5KGJ1ZmZlcikuc2V0KGRhdGEpO1xuXG4gICAgaWYgKHRoaXMudGVtcFJlbmFtZUJyb2tlbikge1xuICAgICAgYXdhaXQgdGhpcy5hZGFwdGVyLndyaXRlQmluYXJ5KHRhcmdldCwgYnVmZmVyKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgdGVtcCA9IGF3YWl0IHRoaXMudGVtcFBhdGgoKTtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5hZGFwdGVyLndyaXRlQmluYXJ5KHRlbXAsIGJ1ZmZlcik7XG4gICAgICBhd2FpdCB0aGlzLmFkYXB0ZXIucmVuYW1lKHRlbXAsIHRhcmdldCk7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBDbGVhbiB1cCB0aGUgb3JwaGFuZWQgdGVtcCAoYmVzdCBlZmZvcnQgXHUyMDE0IGl0IGxpdmVzIGluIHRoZSBpZ25vcmVkXG4gICAgICAvLyBzdGF0ZSBkaXIsIHNvIGV2ZW4gYSBsZWFrIGlzIGludmlzaWJsZSB0byBzeW5jKSwgdGhlbiBmYWxsIGJhY2sgdG9cbiAgICAgIC8vIGEgZGlyZWN0LCBub24tYXRvbWljIHdyaXRlIHJhdGhlciB0aGFuIGZhaWxpbmcgdGhlIHN5bmMuXG4gICAgICBhd2FpdCB0aGlzLnNpbGVudFJlbW92ZSh0ZW1wKTtcbiAgICAgIHRoaXMudGVtcFJlbmFtZUJyb2tlbiA9IHRydWU7XG4gICAgICBhd2FpdCB0aGlzLmFkYXB0ZXIud3JpdGVCaW5hcnkodGFyZ2V0LCBidWZmZXIpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGRlbGV0ZUZpbGUocGF0aDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgdGFyZ2V0ID0gdGhpcy50b0FkYXB0ZXJQYXRoKHBhdGgpO1xuICAgIC8vIElkZW1wb3RlbnQgcGVyIHRoZSBhZGFwdGVyIGNvbnRyYWN0LlxuICAgIGlmICghKGF3YWl0IHRoaXMuYWRhcHRlci5leGlzdHModGFyZ2V0KSkpIHJldHVybjtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5hZGFwdGVyLnJlbW92ZSh0YXJnZXQpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gTG9zdCBhIHJhY2Ugd2l0aCBhIGNvbmN1cnJlbnQgZGVsZXRlIFx1MjAxNCBvbmx5IHN1cmZhY2UgaWYgaXQgc3Vydml2ZXMuXG4gICAgICBpZiAoYXdhaXQgdGhpcy5hZGFwdGVyLmV4aXN0cyh0YXJnZXQpKSB0aHJvdyBuZXcgRXJyb3IoYGZhaWxlZCB0byBkZWxldGUgJHt0YXJnZXR9YCk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgcmVuYW1lRmlsZShmcm9tOiBzdHJpbmcsIHRvOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBmcm9tUGF0aCA9IHRoaXMudG9BZGFwdGVyUGF0aChmcm9tKTtcbiAgICBjb25zdCB0b1BhdGggPSB0aGlzLnRvQWRhcHRlclBhdGgodG8pO1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUGFyZW50RGlycyh0b1BhdGgpO1xuICAgIGF3YWl0IHRoaXMuYWRhcHRlci5yZW5hbWUoZnJvbVBhdGgsIHRvUGF0aCk7XG4gIH1cblxuICBhc3luYyBsaXN0RmlsZXMoKTogUHJvbWlzZTxyZWFkb25seSBGaWxlU3RhdFtdPiB7XG4gICAgY29uc3QgZmlsZXM6IEZpbGVTdGF0W10gPSBbXTtcbiAgICBhd2FpdCB0aGlzLndhbGtGaWxlcygnLycsIGFzeW5jIChhZGFwdGVyUGF0aCkgPT4ge1xuICAgICAgY29uc3Qgc3RhdCA9IGF3YWl0IHRoaXMuc3RhdE9yTnVsbChhZGFwdGVyUGF0aCk7XG4gICAgICBpZiAoc3RhdCA9PT0gbnVsbCkgcmV0dXJuOyAvLyB2YW5pc2hlZCBtaWQtd2Fsa1xuICAgICAgZmlsZXMucHVzaCh7XG4gICAgICAgIHBhdGg6IGAvJHthZGFwdGVyUGF0aH1gLFxuICAgICAgICBzaXplOiBzdGF0LnNpemUsXG4gICAgICAgIG10aW1lOiBzdGF0Lm10aW1lLFxuICAgICAgfSk7XG4gICAgfSk7XG4gICAgZmlsZXMuc29ydCgoYSwgYikgPT4gKGEucGF0aCA8IGIucGF0aCA/IC0xIDogYS5wYXRoID4gYi5wYXRoID8gMSA6IDApKTtcbiAgICByZXR1cm4gZmlsZXM7XG4gIH1cblxuICBhc3luYyBsaXN0RGlycygpOiBQcm9taXNlPHJlYWRvbmx5IHN0cmluZ1tdPiB7XG4gICAgY29uc3QgZGlyczogc3RyaW5nW10gPSBbJy8nXTtcbiAgICBhd2FpdCB0aGlzLndhbGtGb2xkZXJzKCcvJywgYXN5bmMgKGFkYXB0ZXJQYXRoKSA9PiB7XG4gICAgICBkaXJzLnB1c2goYC8ke2FkYXB0ZXJQYXRofWApO1xuICAgIH0pO1xuICAgIGRpcnMuc29ydCgoYSwgYikgPT4gKGEgPCBiID8gLTEgOiBhID4gYiA/IDEgOiAwKSk7XG4gICAgcmV0dXJuIGRpcnM7XG4gIH1cblxuICBhc3luYyBlbnN1cmVEaXIocGF0aDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IG5vcm1hbGl6ZVZhdWx0UGF0aChwYXRoKTtcbiAgICBjb25zdCBzZWdtZW50cyA9IG5vcm1hbGl6ZWQgPT09ICcvJyA/IFtdIDogbm9ybWFsaXplZC5zbGljZSgxKS5zcGxpdCgnLycpO1xuICAgIGxldCBjdXJyZW50ID0gJyc7XG4gICAgZm9yIChjb25zdCBzZWdtZW50IG9mIHNlZ21lbnRzKSB7XG4gICAgICBjdXJyZW50ID0gY3VycmVudCA9PT0gJycgPyBzZWdtZW50IDogYCR7Y3VycmVudH0vJHtzZWdtZW50fWA7XG4gICAgICBpZiAoIShhd2FpdCB0aGlzLmFkYXB0ZXIuZXhpc3RzKGN1cnJlbnQpKSkgYXdhaXQgdGhpcy5hZGFwdGVyLm1rZGlyKGN1cnJlbnQpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZW1vdmUgYW4gRU1QVFkgZGlyZWN0b3J5ICh0aGUgYFN0b3JhZ2VBZGFwdGVyLnJlbW92ZURpcmAgY29udHJhY3QpLlxuICAgKiBQcmVmZXJzIHRoZSB2YXVsdC1BUEkgY2FsbGJhY2sgKGByZW1vdmVFbXB0eURpcmAgXHUyMDE0IHNlZSB0aGUgb3B0aW9uJ3MgZG9jXG4gICAqIGZvciB3aHkgYERhdGFBZGFwdGVyLnJtZGlyYCBjYW5ub3QgZG8gdGhpcyk7IGZhbGxzIGJhY2sgdG8gYHJtZGlyYCBmb3JcbiAgICogYmFyZSBhZGFwdGVycyAodGVzdHMpLiBNaXNzaW5nIHBhdGggXHUyMUQyIG5vLW9wIChpZGVtcG90ZW50KTsgdGhlIHZhdWx0IHJvb3RcbiAgICogaXMgbmV2ZXIgcmVtb3ZhYmxlOyBhIG5vbi1lbXB0eSByZWZ1c2FsIHByb3BhZ2F0ZXMgKGNvcmUgdHJlYXRzIGl0IGFzXG4gICAqIHJlY29yZC1vbmx5IFx1MjAxNCBuZXZlciBkYXRhIGxvc3MpLlxuICAgKi9cbiAgYXN5bmMgcmVtb3ZlRGlyKHBhdGg6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVWYXVsdFBhdGgocGF0aCk7XG4gICAgaWYgKG5vcm1hbGl6ZWQgPT09ICcvJykgcmV0dXJuOyAvLyBuZXZlciB0b3VjaCB0aGUgdmF1bHQgcm9vdFxuICAgIGNvbnN0IHRhcmdldCA9IHRoaXMudG9BZGFwdGVyUGF0aChub3JtYWxpemVkKTtcbiAgICAvLyBJZGVtcG90ZW50IHBlciB0aGUgYWRhcHRlciBjb250cmFjdC5cbiAgICBpZiAoIShhd2FpdCB0aGlzLmFkYXB0ZXIuZXhpc3RzKHRhcmdldCkpKSByZXR1cm47XG4gICAgaWYgKHRoaXMucmVtb3ZlRW1wdHlEaXIgIT09IHVuZGVmaW5lZCkge1xuICAgICAgYXdhaXQgdGhpcy5yZW1vdmVFbXB0eURpcih0YXJnZXQpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBhd2FpdCB0aGlzLmFkYXB0ZXIucm1kaXIodGFyZ2V0LCBmYWxzZSk7XG4gIH1cblxuICBhc3luYyBleGlzdHMocGF0aDogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IG5vcm1hbGl6ZVZhdWx0UGF0aChwYXRoKTtcbiAgICBpZiAobm9ybWFsaXplZCA9PT0gJy8nKSByZXR1cm4gdHJ1ZTsgLy8gdGhlIHZhdWx0IHJvb3QgYWx3YXlzIGV4aXN0c1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5hZGFwdGVyLmV4aXN0cyh0aGlzLnRvQWRhcHRlclBhdGgobm9ybWFsaXplZCkpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIC8vIC0tLSBoZWxwZXJzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICBwcml2YXRlIGFzeW5jIHN0YXRPck51bGwoYWRhcHRlclBhdGg6IHN0cmluZyk6IFByb21pc2U8QWRhcHRlclN0YXQgfCBudWxsPiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHN0YXQgPSBhd2FpdCB0aGlzLmFkYXB0ZXIuc3RhdChhZGFwdGVyUGF0aCk7XG4gICAgICBpZiAoc3RhdCA9PT0gbnVsbCB8fCBzdGF0LnR5cGUgIT09ICdmaWxlJykgcmV0dXJuIG51bGw7XG4gICAgICByZXR1cm4geyBzaXplOiBzdGF0LnNpemUsIG10aW1lOiBzdGF0Lm10aW1lIH07XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gIH1cblxuICAvKiogQSB1bmlxdWUgdGVtcCBwYXRoIGluc2lkZSB0aGUgKHN5bmMtaWdub3JlZCkgY2xpZW50IHN0YXRlIGRpci4gKi9cbiAgcHJpdmF0ZSBhc3luYyB0ZW1wUGF0aCgpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlRGlyKFRFTVBfRElSX1ZBVUxUX1BBVEgpO1xuICAgIHRoaXMudGVtcENvdW50ZXIgKz0gMTtcbiAgICByZXR1cm4gYCR7VEVNUF9ESVJfVkFVTFRfUEFUSC5zbGljZSgxKX0vdy0ke0RhdGUubm93KCkudG9TdHJpbmcoMzYpfS0ke3RoaXMudGVtcENvdW50ZXJ9LnRtcGA7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHNpbGVudFJlbW92ZShhZGFwdGVyUGF0aDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuYWRhcHRlci5yZW1vdmUoYWRhcHRlclBhdGgpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gYmVzdCBlZmZvcnRcbiAgICB9XG4gIH1cblxuICAvKiogQ3JlYXRlIGV2ZXJ5IGFuY2VzdG9yIGRpcmVjdG9yeSBvZiBhbiBhZGFwdGVyIGZpbGUgcGF0aC4gKi9cbiAgcHJpdmF0ZSBhc3luYyBlbnN1cmVQYXJlbnREaXJzKGFkYXB0ZXJQYXRoOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBzbGFzaCA9IGFkYXB0ZXJQYXRoLmxhc3RJbmRleE9mKCcvJyk7XG4gICAgaWYgKHNsYXNoIDw9IDApIHJldHVybjsgLy8gdmF1bHQgcm9vdCBcdTIwMTQgYWx3YXlzIGV4aXN0c1xuICAgIGNvbnN0IHBhcmVudCA9IGFkYXB0ZXJQYXRoLnNsaWNlKDAsIHNsYXNoKTtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZURpcihgLyR7cGFyZW50fWApO1xuICB9XG5cbiAgLyoqIFJlY3Vyc2l2ZWx5IHZpc2l0IGV2ZXJ5IGZpbGUgdW5kZXIgYGRpckFkYXB0ZXJQYXRoYCAoYWRhcHRlciBwYXRocykuICovXG4gIHByaXZhdGUgYXN5bmMgd2Fsa0ZpbGVzKFxuICAgIGRpckFkYXB0ZXJQYXRoOiBzdHJpbmcsXG4gICAgdmlzaXQ6IChhZGFwdGVyUGF0aDogc3RyaW5nKSA9PiBQcm9taXNlPHZvaWQ+LFxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBsZXQgbGlzdGluZztcbiAgICB0cnkge1xuICAgICAgbGlzdGluZyA9IGF3YWl0IHRoaXMuYWRhcHRlci5saXN0KGRpckFkYXB0ZXJQYXRoKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybjsgLy8gdW5yZWFkYWJsZS9taXNzaW5nIFx1MjAxNCB0cmVhdCBhcyBlbXB0eVxuICAgIH1cbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgbGlzdGluZy5maWxlcykgYXdhaXQgdmlzaXQoZmlsZSk7XG4gICAgZm9yIChjb25zdCBmb2xkZXIgb2YgbGlzdGluZy5mb2xkZXJzKSBhd2FpdCB0aGlzLndhbGtGaWxlcyhmb2xkZXIsIHZpc2l0KTtcbiAgfVxuXG4gIC8qKiBSZWN1cnNpdmVseSB2aXNpdCBldmVyeSBmb2xkZXIgdW5kZXIgYGRpckFkYXB0ZXJQYXRoYCAoYWRhcHRlciBwYXRocykuICovXG4gIHByaXZhdGUgYXN5bmMgd2Fsa0ZvbGRlcnMoXG4gICAgZGlyQWRhcHRlclBhdGg6IHN0cmluZyxcbiAgICB2aXNpdDogKGFkYXB0ZXJQYXRoOiBzdHJpbmcpID0+IFByb21pc2U8dm9pZD4sXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGxldCBsaXN0aW5nO1xuICAgIHRyeSB7XG4gICAgICBsaXN0aW5nID0gYXdhaXQgdGhpcy5hZGFwdGVyLmxpc3QoZGlyQWRhcHRlclBhdGgpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBmb3IgKGNvbnN0IGZvbGRlciBvZiBsaXN0aW5nLmZvbGRlcnMpIHtcbiAgICAgIGF3YWl0IHZpc2l0KGZvbGRlcik7XG4gICAgICBhd2FpdCB0aGlzLndhbGtGb2xkZXJzKGZvbGRlciwgdmlzaXQpO1xuICAgIH1cbiAgfVxufVxuIiwgIi8qKlxuICogYE9ic2lkaWFuV2F0Y2hBZGFwdGVyYCArIGBSZXNjYW5TY2hlZHVsZXJgIFx1MjAxNCBjb3JlJ3MgYFdhdGNoQWRhcHRlcmAgb3ZlclxuICogT2JzaWRpYW4gdmF1bHQgZXZlbnRzIChBUkNISVRFQ1RVUkUgXHUwMEE3OCBhZGFwdGVycyksIHBsdXMgdGhlIHBlcmlvZGljIC9cbiAqIGZvY3VzLWRyaXZlbiByZWNvbmNpbGlhdGlvbiBob29rcyB0aGUgbW9iaWxlICYgZXh0ZXJuYWwtZWRpdCBzdG9yaWVzIG5lZWRcbiAqIChcdTAwQTc4IFwiTW9iaWxlXCIsIEZSLTUsIEZSLTEyKS5cbiAqXG4gKiBWYXVsdCBldmVudHMgY292ZXIgZXZlcnl0aGluZyBPYnNpZGlhbiBpdHNlbGYgb2JzZXJ2ZXMgXHUyMDE0IGluLWFwcCBlZGl0cyxcbiAqIGRyYWctZHJvcHMsIGFuZCBleHRlcm5hbCBlZGl0cyBtYWRlIHdoaWxlIE9ic2lkaWFuIGlzICpvcGVuKi4gRWRpdHMgbWFkZVxuICogd2hpbGUgT2JzaWRpYW4gd2FzIGNsb3NlZCBhcmUgcGlja2VkIHVwIGJ5IHRoZSBzdGFydHVwIHJlY29uY2lsaWF0aW9uIGFuZFxuICogYnkgdGhlIHBlcmlvZGljIHJlc2NhbiB3aXJlZCBoZXJlOlxuICpcbiAqICAgdmF1bHQgZXZlbnRzIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjVCQSBXYXRjaEFkYXB0ZXIuc3RhcnQoY2IpIFx1MjUwMFx1MjVCQSBTeW5jQ2xpZW50IGRlYm91bmNlZCBjeWNsZVxuICogICBzZXRJbnRlcnZhbCAoZGVmYXVsdCAzMHMpIFx1MjUwMFx1MjVCQSBSZXNjYW5TY2hlZHVsZXIgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNUJBIFN5bmNDbGllbnQudHJpZ2dlclN5bmMoKVxuICogICBhY3RpdmUtbGVhZi1jaGFuZ2UgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNUJBIFJlc2NhblNjaGVkdWxlci5wb2tlKCkgXHUyNTAwXHUyNTAwXHUyNUJBIChzaG9ydCBkZWJvdW5jZSwgdGhlbiBhIGN5Y2xlKVxuICovXG5cbmltcG9ydCB0eXBlIHsgRXZlbnRSZWYsIFRBYnN0cmFjdEZpbGUsIFZhdWx0IH0gZnJvbSAnb2JzaWRpYW4nO1xuaW1wb3J0IHR5cGUgeyBGaWxlQ2hhbmdlRXZlbnQsIFdhdGNoQWRhcHRlciB9IGZyb20gJ0B2c2EvY29yZSc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgT2JzaWRpYW5XYXRjaEFkYXB0ZXJPcHRpb25zIHtcbiAgdmF1bHQ6IFZhdWx0O1xufVxuXG5leHBvcnQgY2xhc3MgT2JzaWRpYW5XYXRjaEFkYXB0ZXIgaW1wbGVtZW50cyBXYXRjaEFkYXB0ZXIge1xuICBwcml2YXRlIHJlYWRvbmx5IHZhdWx0OiBWYXVsdDtcbiAgcHJpdmF0ZSByZWZzOiBFdmVudFJlZltdID0gW107XG4gIHByaXZhdGUgZW1pdDogKChldmVudHM6IHJlYWRvbmx5IEZpbGVDaGFuZ2VFdmVudFtdKSA9PiB2b2lkKSB8IG51bGwgPSBudWxsO1xuXG4gIGNvbnN0cnVjdG9yKG9wdGlvbnM6IE9ic2lkaWFuV2F0Y2hBZGFwdGVyT3B0aW9ucykge1xuICAgIHRoaXMudmF1bHQgPSBvcHRpb25zLnZhdWx0O1xuICB9XG5cbiAgc3RhcnQoY2I6IChldmVudHM6IHJlYWRvbmx5IEZpbGVDaGFuZ2VFdmVudFtdKSA9PiB2b2lkKTogdm9pZCB7XG4gICAgdGhpcy5zdG9wKCk7XG4gICAgdGhpcy5lbWl0ID0gY2I7XG4gICAgLy8gQm90aCBmaWxlcyBhbmQgZm9sZGVycyBhcmUgZm9yd2FyZGVkOiBmb2xkZXIgZXZlbnRzIChjcmVhdGUvcmVuYW1lL1xuICAgIC8vIGRlbGV0ZSkgdHJpZ2dlciB0aGUgcmVjb25jaWxpYXRpb24gc2NhbiB0aGF0IGRpc2NvdmVycyBlbXB0eS1mb2xkZXJcbiAgICAvLyBwbGFjZWhvbGRlciBjaGFuZ2VzIChGUi0xMCkuIFRoZSBlbmdpbmUgZmlsdGVycyBpZ25vcmVkIHBhdGhzIGl0c2VsZi5cbiAgICB0aGlzLnJlZnMgPSBbXG4gICAgICB0aGlzLnZhdWx0Lm9uKCdjcmVhdGUnLCAoZmlsZTogVEFic3RyYWN0RmlsZSkgPT4ge1xuICAgICAgICB0aGlzLmZvcndhcmQoeyBraW5kOiAnYWRkJywgcGF0aDogdmF1bHRQYXRoT2YoZmlsZSkgfSk7XG4gICAgICB9KSxcbiAgICAgIHRoaXMudmF1bHQub24oJ21vZGlmeScsIChmaWxlOiBUQWJzdHJhY3RGaWxlKSA9PiB7XG4gICAgICAgIHRoaXMuZm9yd2FyZCh7IGtpbmQ6ICdtb2RpZnknLCBwYXRoOiB2YXVsdFBhdGhPZihmaWxlKSB9KTtcbiAgICAgIH0pLFxuICAgICAgdGhpcy52YXVsdC5vbignZGVsZXRlJywgKGZpbGU6IFRBYnN0cmFjdEZpbGUpID0+IHtcbiAgICAgICAgdGhpcy5mb3J3YXJkKHsga2luZDogJ2RlbGV0ZScsIHBhdGg6IHZhdWx0UGF0aE9mKGZpbGUpIH0pO1xuICAgICAgfSksXG4gICAgICB0aGlzLnZhdWx0Lm9uKCdyZW5hbWUnLCAoZmlsZTogVEFic3RyYWN0RmlsZSwgb2xkUGF0aDogc3RyaW5nKSA9PiB7XG4gICAgICAgIC8vIGBvbGRQYXRoYCBcdTIxOTIgYGZpbGUucGF0aGA6IHRoZSBlbnRyeSBhdCBgcGF0aGAgbW92ZWQgdG8gYHRvUGF0aGAuXG4gICAgICAgIHRoaXMuZm9yd2FyZCh7IGtpbmQ6ICdyZW5hbWUnLCBwYXRoOiBgLyR7b2xkUGF0aH1gLCB0b1BhdGg6IHZhdWx0UGF0aE9mKGZpbGUpIH0pO1xuICAgICAgfSksXG4gICAgXTtcbiAgfVxuXG4gIHN0b3AoKTogdm9pZCB7XG4gICAgZm9yIChjb25zdCByZWYgb2YgdGhpcy5yZWZzKSB0aGlzLnZhdWx0Lm9mZnJlZihyZWYpO1xuICAgIHRoaXMucmVmcyA9IFtdO1xuICAgIHRoaXMuZW1pdCA9IG51bGw7XG4gIH1cblxuICBwcml2YXRlIGZvcndhcmQoZXZlbnQ6IEZpbGVDaGFuZ2VFdmVudCk6IHZvaWQge1xuICAgIHRoaXMuZW1pdD8uKFtldmVudF0pO1xuICB9XG59XG5cbi8qKiBWYXVsdCBldmVudCBwYXRoIChhZGFwdGVyLW5vcm1hbGl6ZWQsIG5vIGxlYWRpbmcgc2xhc2gpIFx1MjE5MiBjb3JlIHZhdWx0IHBhdGguICovXG5mdW5jdGlvbiB2YXVsdFBhdGhPZihmaWxlOiBUQWJzdHJhY3RGaWxlKTogc3RyaW5nIHtcbiAgcmV0dXJuIGZpbGUucGF0aC5zdGFydHNXaXRoKCcvJykgPyBmaWxlLnBhdGggOiBgLyR7ZmlsZS5wYXRofWA7XG59XG5cbi8vIC0tLSBSZXNjYW5TY2hlZHVsZXIgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBSZXNjYW5TY2hlZHVsZXJPcHRpb25zIHtcbiAgLyoqIFBlcmlvZCBiZXR3ZWVuIGZ1bGwgcmVzY2FucyBpbiBtczsgYDBgIGRpc2FibGVzIHRoZSBwZXJpb2RpYyB0aW1lci4gKi9cbiAgaW50ZXJ2YWxNczogbnVtYmVyO1xuICAvKiogRGVib3VuY2Ugd2luZG93IGZvciBgcG9rZSgpYCAoYWN0aXZlLWxlYWYtY2hhbmdlKSwgZGVmYXVsdCAzMDAwIG1zLiAqL1xuICBwb2tlRGVsYXlNcz86IG51bWJlcjtcbiAgLyoqIEluamVjdGFibGUgdGltZXIgc2VhbXMgKHRlc3RzIHVzZSBmYWtlIHRpbWVycyBhZ2FpbnN0IHRoZSBnbG9iYWxzKS4gKi9cbiAgc2V0SW50ZXJ2YWxJbXBsPzogKGZuOiAoKSA9PiB2b2lkLCBtczogbnVtYmVyKSA9PiB1bmtub3duO1xuICBjbGVhckludGVydmFsSW1wbD86IChoYW5kbGU6IHVua25vd24pID0+IHZvaWQ7XG4gIHNldFRpbWVvdXRJbXBsPzogKGZuOiAoKSA9PiB2b2lkLCBtczogbnVtYmVyKSA9PiB1bmtub3duO1xuICBjbGVhclRpbWVvdXRJbXBsPzogKGhhbmRsZTogdW5rbm93bikgPT4gdm9pZDtcbn1cblxuLyoqXG4gKiBEcml2ZXMgcGVyaW9kaWMgKyBmb2N1cy10cmlnZ2VyZWQgZnVsbCByZWNvbmNpbGlhdGlvbiBjeWNsZXMuIE5vdCBhXG4gKiBgV2F0Y2hBZGFwdGVyYCBpdHNlbGYgXHUyMDE0IGl0cyBgcnVuYCBjYWxsYmFjayBpcyB3aXJlZCB0b1xuICogYFN5bmNDbGllbnQudHJpZ2dlclN5bmMoKWAgYnkgdGhlIHBsdWdpbiAoYSByZXNjYW4gaXMgYSBmdWxsIGN5Y2xlLCBub3QgYVxuICogc2luZ2xlIGZpbGUgZXZlbnQpLlxuICovXG5leHBvcnQgY2xhc3MgUmVzY2FuU2NoZWR1bGVyIHtcbiAgcHJpdmF0ZSByZWFkb25seSBwb2tlRGVsYXlNczogbnVtYmVyO1xuICBwcml2YXRlIHJlYWRvbmx5IHNldEludGVydmFsSW1wbDogKGZuOiAoKSA9PiB2b2lkLCBtczogbnVtYmVyKSA9PiB1bmtub3duO1xuICBwcml2YXRlIHJlYWRvbmx5IGNsZWFySW50ZXJ2YWxJbXBsOiAoaGFuZGxlOiB1bmtub3duKSA9PiB2b2lkO1xuICBwcml2YXRlIHJlYWRvbmx5IHNldFRpbWVvdXRJbXBsOiAoZm46ICgpID0+IHZvaWQsIG1zOiBudW1iZXIpID0+IHVua25vd247XG4gIHByaXZhdGUgcmVhZG9ubHkgY2xlYXJUaW1lb3V0SW1wbDogKGhhbmRsZTogdW5rbm93bikgPT4gdm9pZDtcblxuICBwcml2YXRlIHJ1bjogKCgpID0+IHZvaWQpIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgaW50ZXJ2YWxIYW5kbGU6IHVua25vd24gPSBudWxsO1xuICBwcml2YXRlIGludGVydmFsTXM6IG51bWJlcjtcbiAgcHJpdmF0ZSBwb2tlSGFuZGxlOiB1bmtub3duID0gbnVsbDtcblxuICBjb25zdHJ1Y3RvcihvcHRpb25zOiBSZXNjYW5TY2hlZHVsZXJPcHRpb25zKSB7XG4gICAgdGhpcy5pbnRlcnZhbE1zID0gb3B0aW9ucy5pbnRlcnZhbE1zO1xuICAgIHRoaXMucG9rZURlbGF5TXMgPSBvcHRpb25zLnBva2VEZWxheU1zID8/IDMwMDA7XG4gICAgdGhpcy5zZXRJbnRlcnZhbEltcGwgPSBvcHRpb25zLnNldEludGVydmFsSW1wbCA/PyAoKGZuLCBtcykgPT4gc2V0SW50ZXJ2YWwoZm4sIG1zKSk7XG4gICAgdGhpcy5jbGVhckludGVydmFsSW1wbCA9IG9wdGlvbnMuY2xlYXJJbnRlcnZhbEltcGwgPz8gKChoYW5kbGUpID0+IGNsZWFySW50ZXJ2YWwoaGFuZGxlIGFzIG51bWJlcikpO1xuICAgIHRoaXMuc2V0VGltZW91dEltcGwgPSBvcHRpb25zLnNldFRpbWVvdXRJbXBsID8/ICgoZm4sIG1zKSA9PiBzZXRUaW1lb3V0KGZuLCBtcykpO1xuICAgIHRoaXMuY2xlYXJUaW1lb3V0SW1wbCA9IG9wdGlvbnMuY2xlYXJUaW1lb3V0SW1wbCA/PyAoKGhhbmRsZSkgPT4gY2xlYXJUaW1lb3V0KGhhbmRsZSBhcyBudW1iZXIpKTtcbiAgfVxuXG4gIC8qKiBCZWdpbiBwZXJpb2RpYyByZXNjYW5zOyBgcnVuYCBtdXN0IGJlIHNhZmUgdG8gY2FsbCBhdCBhbnkgdGltZS4gKi9cbiAgc3RhcnQocnVuOiAoKSA9PiB2b2lkKTogdm9pZCB7XG4gICAgdGhpcy5zdG9wKCk7XG4gICAgdGhpcy5ydW4gPSBydW47XG4gICAgdGhpcy5hcm1JbnRlcnZhbCgpO1xuICB9XG5cbiAgc3RvcCgpOiB2b2lkIHtcbiAgICB0aGlzLmNsZWFySW50ZXJ2YWxJbXBsS2VlcCgpO1xuICAgIGlmICh0aGlzLnBva2VIYW5kbGUgIT09IG51bGwpIHtcbiAgICAgIHRoaXMuY2xlYXJUaW1lb3V0SW1wbCh0aGlzLnBva2VIYW5kbGUpO1xuICAgICAgdGhpcy5wb2tlSGFuZGxlID0gbnVsbDtcbiAgICB9XG4gICAgdGhpcy5ydW4gPSBudWxsO1xuICB9XG5cbiAgLyoqIENoYW5nZSB0aGUgcGVyaW9kaWMgaW50ZXJ2YWwgbGl2ZSAodGhlIHNldHRpbmdzLXRhYiB0b2dnbGUpLiAqL1xuICBzZXRJbnRlcnZhbE1zKG1zOiBudW1iZXIpOiB2b2lkIHtcbiAgICB0aGlzLmludGVydmFsTXMgPSBtcztcbiAgICBpZiAodGhpcy5ydW4gIT09IG51bGwpIHtcbiAgICAgIHRoaXMuY2xlYXJJbnRlcnZhbEltcGxLZWVwKCk7XG4gICAgICB0aGlzLmFybUludGVydmFsKCk7XG4gICAgfVxuICB9XG5cbiAgLyoqIEEgZm9jdXMvYXBwLXN3aXRjaCBzaWduYWwgKGFjdGl2ZS1sZWFmLWNoYW5nZSk6IHJlc2NhbiBzb29uLCBjb2FsZXNjZWQuICovXG4gIHBva2UoKTogdm9pZCB7XG4gICAgaWYgKHRoaXMucnVuID09PSBudWxsKSByZXR1cm47XG4gICAgaWYgKHRoaXMucG9rZUhhbmRsZSAhPT0gbnVsbCkgcmV0dXJuOyAvLyBhbHJlYWR5IHNjaGVkdWxlZFxuICAgIHRoaXMucG9rZUhhbmRsZSA9IHRoaXMuc2V0VGltZW91dEltcGwoKCkgPT4ge1xuICAgICAgdGhpcy5wb2tlSGFuZGxlID0gbnVsbDtcbiAgICAgIHRoaXMucnVuPy4oKTtcbiAgICB9LCB0aGlzLnBva2VEZWxheU1zKTtcbiAgfVxuXG4gIGdldCBpbnRlcnZhbE1zVmFsdWUoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy5pbnRlcnZhbE1zO1xuICB9XG5cbiAgcHJpdmF0ZSBhcm1JbnRlcnZhbCgpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5pbnRlcnZhbE1zIDw9IDAgfHwgdGhpcy5ydW4gPT09IG51bGwpIHJldHVybjtcbiAgICB0aGlzLmludGVydmFsSGFuZGxlID0gdGhpcy5zZXRJbnRlcnZhbEltcGwoKCkgPT4gdGhpcy5ydW4/LigpLCB0aGlzLmludGVydmFsTXMpO1xuICB9XG5cbiAgcHJpdmF0ZSBjbGVhckludGVydmFsSW1wbEtlZXAoKTogdm9pZCB7XG4gICAgaWYgKHRoaXMuaW50ZXJ2YWxIYW5kbGUgIT09IG51bGwpIHtcbiAgICAgIHRoaXMuY2xlYXJJbnRlcnZhbEltcGwodGhpcy5pbnRlcnZhbEhhbmRsZSk7XG4gICAgICB0aGlzLmludGVydmFsSGFuZGxlID0gbnVsbDtcbiAgICB9XG4gIH1cbn1cbiIsICIvKipcbiAqIGBIdHRwQmxvYlN0b3JlYCBcdTIwMTQgY29yZSdzIGBCbG9iU3RvcmVgIGFnYWluc3QgdGhlIHdvcmtlcidzIGAvYmxvYi86aGFzaGBcbiAqIHJvdXRlcyAoQVJDSElURUNUVVJFIFx1MDBBNzUgSFRUUFMgcm91dGVzKSwgYXV0aGVudGljYXRlZCB3aXRoIHRoZSBkZXZpY2UgdG9rZW5cbiAqIGFzIGEgQmVhcmVyIGhlYWRlci4gQnVpbHQgb24gdGhlIGdsb2JhbCBgZmV0Y2hgIChPYnNpZGlhbiBkZXNrdG9wIGFuZFxuICogbW9iaWxlKSwgaW5qZWN0YWJsZSBmb3IgdGVzdHMuIFBsdWdpbi1sb2NhbCB0d2luIG9mIHRoZSBub2RlLXJ1bnRpbWUgb25lOlxuICogbm8gaW1wb3J0cyBmcm9tIGBAdnNhL25vZGUtcnVudGltZWAgKE5vZGUtb25seSBwYWNrYWdlKS5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IEJsb2JTdG9yZSB9IGZyb20gJ0B2c2EvY29yZSc7XG5cbi8qKiBOb24tMnh4IGJsb2Itcm91dGUgcmVwbHkuIGBzdGF0dXNgIGlzIHRoZSBIVFRQIHN0YXR1cyBjb2RlLiAqL1xuZXhwb3J0IGNsYXNzIEh0dHBCbG9iRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIGNvbnN0cnVjdG9yKFxuICAgIHJlYWRvbmx5IHN0YXR1czogbnVtYmVyLFxuICAgIG1lc3NhZ2U6IHN0cmluZyxcbiAgKSB7XG4gICAgc3VwZXIobWVzc2FnZSk7XG4gICAgdGhpcy5uYW1lID0gJ0h0dHBCbG9iRXJyb3InO1xuICB9XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgSHR0cEJsb2JTdG9yZU9wdGlvbnMge1xuICAvKiogV29ya2VyIG9yaWdpbiwgZS5nLiBgaHR0cHM6Ly9wZXJzb25hbC54LndvcmtlcnMuZGV2YC4gKi9cbiAgYmFzZVVybDogc3RyaW5nO1xuICAvKiogRGV2aWNlIHRva2VuIChCZWFyZXIpLiAqL1xuICB0b2tlbjogc3RyaW5nO1xuICAvKiogSW5qZWN0YWJsZSBmZXRjaCAodGVzdHMpLiBEZWZhdWx0cyB0byB0aGUgZ2xvYmFsLiAqL1xuICBmZXRjaEltcGw/OiB0eXBlb2YgZmV0Y2g7XG59XG5cbmV4cG9ydCBjbGFzcyBIdHRwQmxvYlN0b3JlIGltcGxlbWVudHMgQmxvYlN0b3JlIHtcbiAgcHJpdmF0ZSByZWFkb25seSBiYXNlOiBzdHJpbmc7XG4gIHByaXZhdGUgcmVhZG9ubHkgdG9rZW46IHN0cmluZztcbiAgcHJpdmF0ZSByZWFkb25seSBkb0ZldGNoOiB0eXBlb2YgZmV0Y2g7XG5cbiAgY29uc3RydWN0b3Iob3B0aW9uczogSHR0cEJsb2JTdG9yZU9wdGlvbnMpIHtcbiAgICB0aGlzLmJhc2UgPSBvcHRpb25zLmJhc2VVcmwucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG4gICAgdGhpcy50b2tlbiA9IG9wdGlvbnMudG9rZW47XG4gICAgLy8gQm91bmQgbGlrZSB0aGUgcGx1Z2luJ3MgYGZldGNoSW1wbGAgc2VhbTogdGhpcyBjbGFzcyBjYWxscyBgZG9GZXRjaGBcbiAgICAvLyBkZXRhY2hlZCwgYW5kIGEgYmFyZSBnbG9iYWwgYGZldGNoYCBpcyBhbiBpbGxlZ2FsIGludm9jYXRpb24gaW5cbiAgICAvLyBDaHJvbWl1bSByZW5kZXJlcnMgKHJlYWwgT2JzaWRpYW4pLlxuICAgIHRoaXMuZG9GZXRjaCA9IG9wdGlvbnMuZmV0Y2hJbXBsID8/IGdsb2JhbFRoaXMuZmV0Y2guYmluZChnbG9iYWxUaGlzKTtcbiAgfVxuXG4gIC8qKiBHRVQgL2Jsb2IvOmhhc2ggXHUyMTkyIGJ5dGVzLCBvciBgdW5kZWZpbmVkYCBvbiA0MDQuICovXG4gIGFzeW5jIGdldChoYXNoOiBzdHJpbmcpOiBQcm9taXNlPFVpbnQ4QXJyYXkgfCB1bmRlZmluZWQ+IHtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMuZG9GZXRjaChgJHt0aGlzLmJhc2V9L2Jsb2IvJHtoYXNofWAsIHtcbiAgICAgIGhlYWRlcnM6IHsgYXV0aG9yaXphdGlvbjogYEJlYXJlciAke3RoaXMudG9rZW59YCB9LFxuICAgIH0pO1xuICAgIGlmIChyZXNwb25zZS5zdGF0dXMgPT09IDQwNCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICBpZiAoIXJlc3BvbnNlLm9rKSB7XG4gICAgICB0aHJvdyBuZXcgSHR0cEJsb2JFcnJvcihyZXNwb25zZS5zdGF0dXMsIGF3YWl0IGVycm9yTWVzc2FnZShyZXNwb25zZSwgJ2ZldGNoIGJsb2InKSk7XG4gICAgfVxuICAgIHJldHVybiBuZXcgVWludDhBcnJheShhd2FpdCByZXNwb25zZS5hcnJheUJ1ZmZlcigpKTtcbiAgfVxuXG4gIC8qKiBQVVQgL2Jsb2IvOmhhc2ggXHUyMDE0IGlkZW1wb3RlbnQgcGVyIHRoZSBDQVMgY29udHJhY3QuICovXG4gIGFzeW5jIHB1dChoYXNoOiBzdHJpbmcsIGJ5dGVzOiBVaW50OEFycmF5KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLmRvRmV0Y2goYCR7dGhpcy5iYXNlfS9ibG9iLyR7aGFzaH1gLCB7XG4gICAgICBtZXRob2Q6ICdQVVQnLFxuICAgICAgaGVhZGVyczoge1xuICAgICAgICBhdXRob3JpemF0aW9uOiBgQmVhcmVyICR7dGhpcy50b2tlbn1gLFxuICAgICAgICAnY29udGVudC10eXBlJzogJ2FwcGxpY2F0aW9uL29jdGV0LXN0cmVhbScsXG4gICAgICB9LFxuICAgICAgYm9keTogYnl0ZXMgYXMgQm9keUluaXQsXG4gICAgfSk7XG4gICAgaWYgKCFyZXNwb25zZS5vaykge1xuICAgICAgdGhyb3cgbmV3IEh0dHBCbG9iRXJyb3IocmVzcG9uc2Uuc3RhdHVzLCBhd2FpdCBlcnJvck1lc3NhZ2UocmVzcG9uc2UsICdzdG9yZSBibG9iJykpO1xuICAgIH1cbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBlcnJvck1lc3NhZ2UocmVzcG9uc2U6IFJlc3BvbnNlLCB3aGF0OiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCBkZXRhaWwgPSAoYXdhaXQgcmVzcG9uc2UudGV4dCgpLmNhdGNoKCgpID0+ICcnKSkuc2xpY2UoMCwgMzAwKTtcbiAgcmV0dXJuIGRldGFpbCA9PT0gJydcbiAgICA/IGBmYWlsZWQgdG8gJHt3aGF0fTogSFRUUCAke3Jlc3BvbnNlLnN0YXR1c31gXG4gICAgOiBgZmFpbGVkIHRvICR7d2hhdH06IEhUVFAgJHtyZXNwb25zZS5zdGF0dXN9OiAke2RldGFpbH1gO1xufVxuIiwgIi8qKlxuICogRGlhZ25vc3RpY3MgKHRoZSBzZXR0aW5ncyB0YWIncyBcIkFkdmFuY2VkIFx1MjE5MiBEaWFnbm9zdGljc1wiKTogYSBib3VuZGVkIHJpbmdcbiAqIGJ1ZmZlciBvdmVyIHRoZSBwbHVnaW4ncyBsb2cgc3RyZWFtIHdpdGggYSB1c2VyLXNlbGVjdGFibGUgbWluaW11bSBsZXZlbCxcbiAqIGEgdHJhbnNwb3J0IHdyYXBwZXIgdGhhdCByZWNvcmRzIHByb3RvY29sIHJvdW5kLXRyaXBzIGF0IGRlYnVnIGxldmVsIChsb3dcbiAqIHZvbHVtZTogb25lIHNob3J0IGxpbmUgcGVyIGZyYW1lKSwgYW5kIHRoZSBcIkNvcHkgZGlhZ25vc3RpY3NcIiBidW5kbGUuXG4gKlxuICogVGhlIGJ1bmRsZSBpcyBhIHBsYWluLXRleHQgc25hcHNob3QgbWVhbnQgZm9yIGJ1ZyByZXBvcnRzOiB2ZXJzaW9ucyxcbiAqIGlkZW50aXR5LCB3b3JrZXIsIGEgY2xpZW50IHN0YXR1cyBzbmFwc2hvdCwgdGhlIHBsYXRmb3JtLCBhbmQgdGhlIGxhc3QgTlxuICogbG9nIGxpbmVzLiBgYnVpbGRTdXBwb3J0QnVuZGxlYCBpcyBpdHMgcmljaGVyIG1hcmtkb3duIHNpYmxpbmcgXHUyMDE0IHRoZSBmaWxlXG4gKiBhIFwic3luYyBhdGUgbXkgbm90ZVwiIHJlcG9ydCBhdHRhY2hlcy5cbiAqL1xuXG5pbXBvcnQgeyBQcm90b2NvbFZlcnNpb24gfSBmcm9tICdAdnNhL2NvcmUnO1xuaW1wb3J0IHR5cGUgeyBMb2dBZGFwdGVyLCBTeW5jQ2xpZW50U3RhdHVzLCBUcmFuc3BvcnQgfSBmcm9tICdAdnNhL2NvcmUnO1xuaW1wb3J0IHsgUGxhdGZvcm0gfSBmcm9tICdvYnNpZGlhbic7XG5pbXBvcnQgdHlwZSB7IExvZ0xldmVsLCBQbHVnaW5TeW5jU2V0dGluZ3MgfSBmcm9tICcuL2RhdGEuanMnO1xuXG4vKiogU2V2ZXJpdHkgcmFua2luZzsgYGVycm9yYCBhbHdheXMgb3V0cmFua3MgZXZlcnkgc2VsZWN0YWJsZSBsZXZlbC4gKi9cbmNvbnN0IExFVkVMX1JBTks6IFJlY29yZDxMb2dMZXZlbCB8ICdlcnJvcicsIG51bWJlcj4gPSB7IGRlYnVnOiAxMCwgaW5mbzogMjAsIHdhcm46IDMwLCBlcnJvcjogNDAgfTtcblxuLyoqIExvZyBsaW5lcyBrZXB0IGZvciB0aGUgZGlhZ25vc3RpY3MgYnVuZGxlICh0aGUgc3BlYydzIFwibGFzdCAyMFwiKS4gKi9cbmV4cG9ydCBjb25zdCBSSU5HX0NBUEFDSVRZID0gMjA7XG5cbi8qKiBNYXggY2hhcmFjdGVycyBvbmUgYXJndW1lbnQgY29udHJpYnV0ZXMgdG8gYSByaW5nIGxpbmUuICovXG5jb25zdCBBUkdfTUFYX0NIQVJTID0gMzAwO1xuXG4vKiogQSBgTG9nQWRhcHRlcmAgd2l0aCBhIGxldmVsIGdhdGUgYW5kIGEgYm91bmRlZCByaW5nIGJ1ZmZlciBhdHRhY2hlZC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUGx1Z2luTG9nIGV4dGVuZHMgTG9nQWRhcHRlciB7XG4gIC8qKiBDaGFuZ2UgdGhlIG1pbmltdW0gcmVjb3JkZWQgbGV2ZWwgYXQgcnVudGltZSAodGhlIHNldHRpbmdzIGRyb3Bkb3duKS4gKi9cbiAgc2V0TGV2ZWwobGV2ZWw6IExvZ0xldmVsKTogdm9pZDtcbiAgZ2V0TGV2ZWwoKTogTG9nTGV2ZWw7XG4gIC8qKiBXaGV0aGVyIGBkZWJ1Z2AgY2FsbHMgY3VycmVudGx5IHBhc3MgdGhlIGdhdGUgKHJvdW5kLXRyaXAgbG9nZ2luZyBob29rKS4gKi9cbiAgZ2V0IGRlYnVnRW5hYmxlZCgpOiBib29sZWFuO1xuICAvKiogVGhlIG1vc3QgcmVjZW50IGxpbmVzLCBvbGRlc3QgZmlyc3QgKGJvdW5kZWQgYnkgdGhlIGNhcGFjaXR5KS4gKi9cbiAgcmVjZW50TGluZXMoKTogc3RyaW5nW107XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUGx1Z2luTG9nT3B0aW9ucyB7XG4gIC8qKiBSaW5nIGNhcGFjaXR5IChkZWZhdWx0IDIwKS4gKi9cbiAgY2FwYWNpdHk/OiBudW1iZXI7XG4gIC8qKiBNaW5pbXVtIHJlY29yZGVkIGxldmVsIChkZWZhdWx0ICdpbmZvJykuICovXG4gIGxldmVsPzogTG9nTGV2ZWw7XG4gIC8qKiBUaW1lc3RhbXAgc2VhbSAoZGVmYXVsdCBgRGF0ZS5ub3dgKS4gKi9cbiAgbm93PzogKCkgPT4gbnVtYmVyO1xufVxuXG4vKiogQnVpbGQgdGhlIHBsdWdpbidzIGxvZyBhZGFwdGVyOiBjb25zb2xlIG1pcnJvciArIGJvdW5kZWQgcmluZyBidWZmZXIuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlUGx1Z2luTG9nKG9wdGlvbnM6IFBsdWdpbkxvZ09wdGlvbnMgPSB7fSk6IFBsdWdpbkxvZyB7XG4gIGNvbnN0IGNhcGFjaXR5ID0gb3B0aW9ucy5jYXBhY2l0eSA/PyBSSU5HX0NBUEFDSVRZO1xuICBjb25zdCBub3cgPSBvcHRpb25zLm5vdyA/PyAoKCkgPT4gRGF0ZS5ub3coKSk7XG4gIGxldCBsZXZlbDogTG9nTGV2ZWwgPSBvcHRpb25zLmxldmVsID8/ICdpbmZvJztcbiAgbGV0IHJpbmc6IHN0cmluZ1tdID0gW107XG5cbiAgY29uc3Qgd3JpdGUgPSAoc2V2ZXJpdHk6IExvZ0xldmVsIHwgJ2Vycm9yJywgYXJnczogcmVhZG9ubHkgdW5rbm93bltdKTogdm9pZCA9PiB7XG4gICAgaWYgKExFVkVMX1JBTktbc2V2ZXJpdHldIDwgTEVWRUxfUkFOS1tsZXZlbF0pIHJldHVybjtcbiAgICBjb25zdCBsaW5lID0gYCR7bmV3IERhdGUobm93KCkpLnRvSVNPU3RyaW5nKCl9IFske3NldmVyaXR5fV0gJHthcmdzLm1hcChmbXQpLmpvaW4oJyAnKX1gO1xuICAgIHJpbmcucHVzaChsaW5lKTtcbiAgICBpZiAocmluZy5sZW5ndGggPiBjYXBhY2l0eSkgcmluZyA9IHJpbmcuc2xpY2UocmluZy5sZW5ndGggLSBjYXBhY2l0eSk7XG4gICAgY29uc3Qgc2luayA9XG4gICAgICBzZXZlcml0eSA9PT0gJ2Vycm9yJyA/IGNvbnNvbGUuZXJyb3IgOiBzZXZlcml0eSA9PT0gJ3dhcm4nID8gY29uc29sZS53YXJuIDogY29uc29sZS5sb2c7XG4gICAgc2luaygnW3ZzYV0nLCAuLi5hcmdzKTtcbiAgfTtcblxuICByZXR1cm4ge1xuICAgIGRlYnVnOiAoLi4uYXJnczogdW5rbm93bltdKSA9PiB3cml0ZSgnZGVidWcnLCBhcmdzKSxcbiAgICBpbmZvOiAoLi4uYXJnczogdW5rbm93bltdKSA9PiB3cml0ZSgnaW5mbycsIGFyZ3MpLFxuICAgIHdhcm46ICguLi5hcmdzOiB1bmtub3duW10pID0+IHdyaXRlKCd3YXJuJywgYXJncyksXG4gICAgZXJyb3I6ICguLi5hcmdzOiB1bmtub3duW10pID0+IHdyaXRlKCdlcnJvcicsIGFyZ3MpLFxuICAgIHNldExldmVsKG5leHQ6IExvZ0xldmVsKTogdm9pZCB7XG4gICAgICBsZXZlbCA9IG5leHQ7XG4gICAgfSxcbiAgICBnZXRMZXZlbCgpOiBMb2dMZXZlbCB7XG4gICAgICByZXR1cm4gbGV2ZWw7XG4gICAgfSxcbiAgICBnZXQgZGVidWdFbmFibGVkKCk6IGJvb2xlYW4ge1xuICAgICAgcmV0dXJuIGxldmVsID09PSAnZGVidWcnO1xuICAgIH0sXG4gICAgcmVjZW50TGluZXMoKTogc3RyaW5nW10ge1xuICAgICAgcmV0dXJuIFsuLi5yaW5nXTtcbiAgICB9LFxuICB9O1xufVxuXG4vKiogT25lIGxvZyBhcmd1bWVudCBcdTIxOTIgY29tcGFjdCB0ZXh0IChzdHJpbmdzIHBhc3MgdGhyb3VnaCwgbG9uZyB2YWx1ZXMgdHJ1bmNhdGVkKS4gKi9cbmZ1bmN0aW9uIGZtdCh2YWx1ZTogdW5rbm93bik6IHN0cmluZyB7XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSByZXR1cm4gdHJ1bmNhdGUodmFsdWUpO1xuICBpZiAodmFsdWUgaW5zdGFuY2VvZiBFcnJvcikgcmV0dXJuIHRydW5jYXRlKGAke3ZhbHVlLm5hbWV9OiAke3ZhbHVlLm1lc3NhZ2V9YCk7XG4gIHRyeSB7XG4gICAgcmV0dXJuIHRydW5jYXRlKEpTT04uc3RyaW5naWZ5KHZhbHVlKSA/PyBTdHJpbmcodmFsdWUpKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIFN0cmluZyh2YWx1ZSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gdHJ1bmNhdGUodGV4dDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHRleHQubGVuZ3RoIDw9IEFSR19NQVhfQ0hBUlMgPyB0ZXh0IDogYCR7dGV4dC5zbGljZSgwLCBBUkdfTUFYX0NIQVJTIC0gMSl9XHUyMDI2YDtcbn1cblxuLy8gLS0tIHByb3RvY29sIHJvdW5kLXRyaXAgbG9nZ2luZyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIENvbXBhY3QsIGxvdy12b2x1bWUgZGVzY3JpcHRpb24gb2YgYSB3aXJlIGZyYW1lICh0eXBlICsgaWRlbnRpdHkga2V5cykuICovXG5leHBvcnQgZnVuY3Rpb24gZGVzY3JpYmVNZXNzYWdlKG1lc3NhZ2U6IHtcbiAgdHlwZTogc3RyaW5nO1xuICBwYXRoPzogc3RyaW5nO1xuICBoYXNoPzogc3RyaW5nO1xuICBmcm9tUGF0aD86IHN0cmluZztcbiAgY3Vyc29yPzogbnVtYmVyO1xuICBzZXE/OiBudW1iZXI7XG59KTogc3RyaW5nIHtcbiAgY29uc3QgYml0cyA9IFttZXNzYWdlLnR5cGVdO1xuICBpZiAobWVzc2FnZS5mcm9tUGF0aCAhPT0gdW5kZWZpbmVkKSBiaXRzLnB1c2goYCR7bWVzc2FnZS5mcm9tUGF0aH0gXHUyMTkyYCk7XG4gIGlmIChtZXNzYWdlLnBhdGggIT09IHVuZGVmaW5lZCkgYml0cy5wdXNoKG1lc3NhZ2UucGF0aCk7XG4gIGlmIChtZXNzYWdlLmhhc2ggIT09IHVuZGVmaW5lZCkgYml0cy5wdXNoKG1lc3NhZ2UuaGFzaC5zbGljZSgwLCAxMikpO1xuICBpZiAobWVzc2FnZS5zZXEgIT09IHVuZGVmaW5lZCkgYml0cy5wdXNoKGBzZXEgJHttZXNzYWdlLnNlcX1gKTtcbiAgaWYgKG1lc3NhZ2UuY3Vyc29yICE9PSB1bmRlZmluZWQpIGJpdHMucHVzaChgY3Vyc29yICR7bWVzc2FnZS5jdXJzb3J9YCk7XG4gIHJldHVybiBiaXRzLmpvaW4oJyAnKTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBSb3VuZFRyaXBMb2dnaW5nT3B0aW9ucyB7XG4gIGxvZzogTG9nQWRhcHRlcjtcbiAgLyoqIENoZWFwIHByZS1jaGVjayBzbyB0aGUgc3RyaW5nIGJ1aWxkaW5nIGlzIHNraXBwZWQgdW5sZXNzIGRlYnVnIGlzIG9uLiAqL1xuICBzaG91bGRMb2c6ICgpID0+IGJvb2xlYW47XG59XG5cbi8qKlxuICogV3JhcCBhIGBUcmFuc3BvcnRgIHNvIGV2ZXJ5IHNlbnQvcmVjZWl2ZWQgZnJhbWUgaXMgbG9nZ2VkIGF0IGRlYnVnIGxldmVsIFx1MjAxNFxuICogb25lIHNob3J0IGxpbmUgcGVyIGZyYW1lIChgZGVzY3JpYmVNZXNzYWdlYCksIG5vdGhpbmcgYXQgb3RoZXIgbGV2ZWxzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gd2l0aFJvdW5kVHJpcExvZ2dpbmcoXG4gIHRyYW5zcG9ydDogVHJhbnNwb3J0LFxuICBvcHRpb25zOiBSb3VuZFRyaXBMb2dnaW5nT3B0aW9ucyxcbik6IFRyYW5zcG9ydCB7XG4gIGNvbnN0IHsgbG9nLCBzaG91bGRMb2cgfSA9IG9wdGlvbnM7XG4gIHJldHVybiB7XG4gICAgc2VuZDogKG1lc3NhZ2UpID0+IHtcbiAgICAgIGlmIChzaG91bGRMb2coKSkgbG9nLmRlYnVnKCdcdTIxOTInLCBkZXNjcmliZU1lc3NhZ2UobWVzc2FnZSkpO1xuICAgICAgdHJhbnNwb3J0LnNlbmQobWVzc2FnZSk7XG4gICAgfSxcbiAgICBvbk1lc3NhZ2U6IChjYWxsYmFjaykgPT4ge1xuICAgICAgdHJhbnNwb3J0Lm9uTWVzc2FnZSgobWVzc2FnZSkgPT4ge1xuICAgICAgICBpZiAoc2hvdWxkTG9nKCkpIGxvZy5kZWJ1ZygnXHUyMTkwJywgZGVzY3JpYmVNZXNzYWdlKG1lc3NhZ2UpKTtcbiAgICAgICAgY2FsbGJhY2sobWVzc2FnZSk7XG4gICAgICB9KTtcbiAgICB9LFxuICAgIG9uQ2xvc2U6IChjYWxsYmFjaykgPT4gdHJhbnNwb3J0Lm9uQ2xvc2UoY2FsbGJhY2spLFxuICAgIGNsb3NlOiAoKSA9PiB0cmFuc3BvcnQuY2xvc2UoKSxcbiAgfTtcbn1cblxuLy8gLS0tIHRoZSBidW5kbGUgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBEaWFnbm9zdGljc0lucHV0IHtcbiAgcGx1Z2luVmVyc2lvbjogc3RyaW5nO1xuICBkZXZpY2VJZDogc3RyaW5nO1xuICBkZXZpY2VOYW1lOiBzdHJpbmc7XG4gIHdvcmtlclVybDogc3RyaW5nO1xuICBwYWlyZWQ6IGJvb2xlYW47XG4gIHBhdXNlZDogYm9vbGVhbjtcbiAgY2xpZW50U3RhdHVzOiBTeW5jQ2xpZW50U3RhdHVzIHwgbnVsbDtcbiAgcmVjZW50TG9nTGluZXM6IHJlYWRvbmx5IHN0cmluZ1tdO1xuICAvKiogV29ya2VyLXJlcG9ydGVkIHZlcnNpb24gKG51bGwgdW50aWwgYSBsYXRlciBjaGFuZ2UgcG9wdWxhdGVzIGl0KS4gKi9cbiAgc2VydmVyVmVyc2lvbj86IHN0cmluZyB8IG51bGw7XG4gIC8qKiBDbGllbnQtc2lkZSBzZXR0aW5ncyAobm9uZSBhcmUgc2VjcmV0IFx1MjAxNCBhbGwgZmllbGRzIHJlbmRlciB2ZXJiYXRpbSkuICovXG4gIHNldHRpbmdzPzogUGx1Z2luU3luY1NldHRpbmdzO1xuICAvKipcbiAgICogQ29uZmxpY3QgcGF0aHMgZm9yIHRoZSBzdXBwb3J0IGJ1bmRsZSwgZGVyaXZlZCBmcm9tXG4gICAqIGBjbGllbnRTdGF0dXMuY29uZmxpY3RzYCBcdTIwMTQgUEFUSFMgT05MWSwgbmV2ZXIgZmlsZSBjb250ZW50LlxuICAgKi9cbiAgcmVjZW50Q29uZmxpY3RzPzogQXJyYXk8eyBwYXRoOiBzdHJpbmcgfT47XG59XG5cbi8qKiBUaGUgcHJvdG9jb2wgdmVyc2lvbiBmcm9tIGNvcmUsIHN1cmZhY2VkIGZvciB0aGUgYnVuZGxlL0Fib3V0IHNlY3Rpb24uICovXG5leHBvcnQgY29uc3QgUFJPVE9DT0xfVkVSU0lPTiA9IFByb3RvY29sVmVyc2lvbjtcblxuLyoqIFRoZSBjb3B5YWJsZSBkaWFnbm9zdGljcyBidW5kbGUgKHBsYWluIHRleHQsIGJ1Zy1yZXBvcnQgZnJpZW5kbHkpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkRGlhZ25vc3RpY3NCdW5kbGUoaW5wdXQ6IERpYWdub3N0aWNzSW5wdXQpOiBzdHJpbmcge1xuICBjb25zdCBzdGF0dXMgPSBpbnB1dC5jbGllbnRTdGF0dXM7XG4gIGNvbnN0IGxpbmVzOiBzdHJpbmdbXSA9IFtcbiAgICAnVmF1bHRTeW5jIGZvciBBZ2VudHMgXHUyMDE0IGRpYWdub3N0aWNzJyxcbiAgICBgUGx1Z2luIHZlcnNpb246ICR7aW5wdXQucGx1Z2luVmVyc2lvbn1gLFxuICAgIGBQcm90b2NvbCB2ZXJzaW9uOiAke1Byb3RvY29sVmVyc2lvbn1gLFxuICAgIGBEZXZpY2U6ICR7aW5wdXQuZGV2aWNlSWQgfHwgJyh1bmFzc2lnbmVkKSd9JHtpbnB1dC5kZXZpY2VOYW1lID8gYCAoJHtpbnB1dC5kZXZpY2VOYW1lfSlgIDogJyd9YCxcbiAgICBgV29ya2VyOiAke2lucHV0LndvcmtlclVybCB8fCAnKG5vdCBjb25maWd1cmVkKSd9YCxcbiAgICBgUGFpcmluZzogJHtpbnB1dC5wYWlyZWQgPyAncGFpcmVkJyA6ICdub3QgcGFpcmVkJ31gLFxuICAgIGlucHV0LnBhdXNlZFxuICAgICAgPyAnU3luYzogcGF1c2VkJ1xuICAgICAgOiBzdGF0dXMgPT09IG51bGxcbiAgICAgICAgPyAnU3luYzogbm90IHJ1bm5pbmcnXG4gICAgICAgIDogYFN5bmM6ICR7c3RhdHVzLnN0YXRlfSwgbGFzdCBzeW5jICR7XG4gICAgICAgICAgICBzdGF0dXMubGFzdFN5bmNBdCA9PT0gbnVsbCA/ICduZXZlcicgOiBgJHtNYXRoLm1heCgwLCBEYXRlLm5vdygpIC0gc3RhdHVzLmxhc3RTeW5jQXQpfW1zIGFnb2BcbiAgICAgICAgICB9LCBwZW5kaW5nICR7c3RhdHVzLnBlbmRpbmd9LCBjb25mbGljdHMgJHtzdGF0dXMuY29uZmxpY3RzLmxlbmd0aH1gLFxuICAgIGBQbGF0Zm9ybTogJHtwbGF0Zm9ybVN1bW1hcnkoKX1gLFxuICAgIGBSZWNlbnQgbG9nIChsYXN0ICR7aW5wdXQucmVjZW50TG9nTGluZXMubGVuZ3RofSBsaW5lcyk6YCxcbiAgXTtcbiAgaWYgKGlucHV0LnJlY2VudExvZ0xpbmVzLmxlbmd0aCA9PT0gMCkge1xuICAgIGxpbmVzLnB1c2goJyAgKG5vIHJlY29yZGVkIGxvZyBsaW5lcyknKTtcbiAgfSBlbHNlIHtcbiAgICBmb3IgKGNvbnN0IGxpbmUgb2YgaW5wdXQucmVjZW50TG9nTGluZXMpIGxpbmVzLnB1c2goYCAgJHtsaW5lfWApO1xuICB9XG4gIHJldHVybiBsaW5lcy5qb2luKCdcXG4nKTtcbn1cblxuLyoqIEVwb2NoIG1zIFx1MjE5MiBgMjAyNjA4MjEtMTQzMDA1YCAobG9jYWwgdGltZSkgZm9yIHN1cHBvcnQtYnVuZGxlIGZpbGUgbmFtZXMuICovXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0U3VwcG9ydEJ1bmRsZVN0YW1wKG5vdzogbnVtYmVyKTogc3RyaW5nIHtcbiAgY29uc3QgZCA9IG5ldyBEYXRlKG5vdyk7XG4gIGNvbnN0IHR3byA9IChuOiBudW1iZXIpOiBzdHJpbmcgPT4gU3RyaW5nKG4pLnBhZFN0YXJ0KDIsICcwJyk7XG4gIHJldHVybiAoXG4gICAgYCR7ZC5nZXRGdWxsWWVhcigpfSR7dHdvKGQuZ2V0TW9udGgoKSArIDEpfSR7dHdvKGQuZ2V0RGF0ZSgpKX1gICtcbiAgICBgLSR7dHdvKGQuZ2V0SG91cnMoKSl9JHt0d28oZC5nZXRNaW51dGVzKCkpfSR7dHdvKGQuZ2V0U2Vjb25kcygpKX1gXG4gICk7XG59XG5cbmNvbnN0IG9uT2ZmID0gKHZhbHVlOiBib29sZWFuKTogc3RyaW5nID0+ICh2YWx1ZSA/ICdvbicgOiAnb2ZmJyk7XG5cbi8qKlxuICogVGhlIFwiU2F2ZSBzdXBwb3J0IGJ1bmRsZVwiIG1hcmtkb3duLiBSZWRhY3Rpb24gY29udHJhY3Q6IHRoZSBkZXZpY2UgdG9rZW5cbiAqIG5ldmVyIGFwcGVhcnMgKHRoZSBpbnB1dCBzdHJ1Y3R1cmFsbHkgY2Fubm90IGNhcnJ5IGl0KSwgYW5kIGZpbGVzXG4gKiBjb250cmlidXRlIHZhdWx0LXJlbGF0aXZlIFBBVEhTIE9OTFkgXHUyMDE0IG5ldmVyIGNvbnRlbnQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZFN1cHBvcnRCdW5kbGUoaW5wdXQ6IERpYWdub3N0aWNzSW5wdXQsIG5vdzogbnVtYmVyKTogc3RyaW5nIHtcbiAgY29uc3Qgc3RhdHVzID0gaW5wdXQuY2xpZW50U3RhdHVzO1xuICAvLyBDb25mbGljdHMgcmVuZGVyIGFzIHBhdGhzIG9ubHk7IGByZWNlbnRDb25mbGljdHNgIChwcmUtcmVkYWN0ZWQgYnkgdGhlXG4gIC8vIGNhbGxlcikgd2lucyB3aGVuIHByZXNlbnQsIGVsc2UgcGF0aHMgYXJlIGRlcml2ZWQgZnJvbSB0aGUgc3RhdHVzLlxuICBjb25zdCBjb25mbGljdFBhdGhzID1cbiAgICBpbnB1dC5yZWNlbnRDb25mbGljdHM/Lm1hcCgoYykgPT4gYy5wYXRoKSA/PyBzdGF0dXM/LmNvbmZsaWN0cy5tYXAoKGMpID0+IGMucGF0aCkgPz8gW107XG5cbiAgY29uc3QgbGluZXM6IHN0cmluZ1tdID0gW1xuICAgICcjIFZhdWx0U3luYyBmb3IgQWdlbnRzIFx1MjAxNCBzdXBwb3J0IGJ1bmRsZScsXG4gICAgJycsXG4gICAgYEdlbmVyYXRlZDogJHtuZXcgRGF0ZShub3cpLnRvSVNPU3RyaW5nKCl9YCxcbiAgICAnJyxcbiAgICAnIyMgVmVyc2lvbnMnLFxuICAgICcnLFxuICAgIGAtIFBsdWdpbjogJHtpbnB1dC5wbHVnaW5WZXJzaW9ufWAsXG4gICAgYC0gUHJvdG9jb2w6ICR7UHJvdG9jb2xWZXJzaW9ufWAsXG4gICAgYC0gU2VydmVyOiAke2lucHV0LnNlcnZlclZlcnNpb24gPz8gJ3Vua25vd24nfWAsXG4gICAgYC0gUGxhdGZvcm06ICR7cGxhdGZvcm1TdW1tYXJ5KCl9YCxcbiAgICAnJyxcbiAgICAnIyMgQ29ubmVjdGlvbicsXG4gICAgJycsXG4gICAgYC0gV29ya2VyIFVSTDogJHtpbnB1dC53b3JrZXJVcmwgfHwgJyhub3QgY29uZmlndXJlZCknfWAsXG4gICAgYC0gRGV2aWNlIElEOiAke2lucHV0LmRldmljZUlkIHx8ICcodW5hc3NpZ25lZCknfWAsXG4gICAgYC0gRGV2aWNlIG5hbWU6ICR7aW5wdXQuZGV2aWNlTmFtZSB8fCAnKGRlZmF1bHQpJ31gLFxuICAgIGAtIFBhaXJpbmc6ICR7aW5wdXQucGFpcmVkID8gJ3BhaXJlZCcgOiAnbm90IHBhaXJlZCd9YCxcbiAgICBgLSBTeW5jaW5nOiAke2lucHV0LnBhdXNlZCA/ICdwYXVzZWQnIDogJ2FjdGl2ZSd9YCxcbiAgXTtcblxuICBpZiAoaW5wdXQuc2V0dGluZ3MgIT09IHVuZGVmaW5lZCkge1xuICAgIGNvbnN0IHsgc2V0dGluZ3MgfSA9IGlucHV0O1xuICAgIGNvbnN0IHBhdHRlcm5zID0gc2V0dGluZ3MuaWdub3JlUGF0dGVybnNcbiAgICAgIC5zcGxpdCgvXFxyP1xcbi8pXG4gICAgICAubWFwKChsaW5lKSA9PiBsaW5lLnRyaW0oKSlcbiAgICAgIC5maWx0ZXIoKGxpbmUpID0+IGxpbmUgIT09ICcnKTtcbiAgICBsaW5lcy5wdXNoKCcnLCAnIyMgU2V0dGluZ3MnLCAnJywgYC0gUmVzY2FuIGludGVydmFsOiAke3NldHRpbmdzLnJlc2NhbkludGVydmFsU2VjID09PSAwID8gJ29mZicgOiBgJHtzZXR0aW5ncy5yZXNjYW5JbnRlcnZhbFNlY30gc2Vjb25kc2B9YCwgYC0gU3luYyAub2JzaWRpYW4vIGZvbGRlcjogJHtvbk9mZihzZXR0aW5ncy5vYnNpZGlhblN5bmMpfWAsIGAtIFN0YXR1cyBiYXIgaW5kaWNhdG9yOiAke3NldHRpbmdzLnN0YXR1c0Jhck1vZGV9YCwgYC0gU3luYyBvbiBzdGFydHVwOiAke29uT2ZmKHNldHRpbmdzLnN5bmNPblN0YXJ0dXApfWAsIGAtIERpYWdub3N0aWNzIGxvZyBsZXZlbDogJHtzZXR0aW5ncy5sb2dMZXZlbH1gKTtcbiAgICBpZiAocGF0dGVybnMubGVuZ3RoID09PSAwKSB7XG4gICAgICBsaW5lcy5wdXNoKCctIElnbm9yZSBwYXR0ZXJuczogKG5vbmUpJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGxpbmVzLnB1c2goJy0gSWdub3JlIHBhdHRlcm5zOicpO1xuICAgICAgZm9yIChjb25zdCBwYXR0ZXJuIG9mIHBhdHRlcm5zKSBsaW5lcy5wdXNoKGAgICR7cGF0dGVybn1gKTtcbiAgICB9XG4gIH1cblxuICBsaW5lcy5wdXNoKCcnLCAnIyMgU3luYyBzdGF0ZScsICcnKTtcbiAgaWYgKGlucHV0LnBhdXNlZCkgbGluZXMucHVzaCgnLSBTdGF0ZTogcGF1c2VkJyk7XG4gIGVsc2UgaWYgKHN0YXR1cyA9PT0gbnVsbCkgbGluZXMucHVzaCgnLSBTdGF0ZTogbm90IHJ1bm5pbmcnKTtcbiAgZWxzZSBsaW5lcy5wdXNoKGAtIFN0YXRlOiAke3N0YXR1cy5zdGF0ZX1gKTtcbiAgaWYgKHN0YXR1cyAhPT0gbnVsbCkge1xuICAgIGxpbmVzLnB1c2goXG4gICAgICBgLSBMYXN0IHN5bmM6ICR7c3RhdHVzLmxhc3RTeW5jQXQgPT09IG51bGwgPyAnbmV2ZXInIDogbmV3IERhdGUoc3RhdHVzLmxhc3RTeW5jQXQpLnRvSVNPU3RyaW5nKCl9YCxcbiAgICAgIGAtIFBlbmRpbmcgY2hhbmdlczogJHtzdGF0dXMucGVuZGluZ31gLFxuICAgICAgYC0gQ29uZmxpY3RzOiAke2NvbmZsaWN0UGF0aHMubGVuZ3RofWAsXG4gICAgKTtcbiAgICBmb3IgKGNvbnN0IHBhdGggb2YgY29uZmxpY3RQYXRocykgbGluZXMucHVzaChgICAtICR7cGF0aH1gKTtcbiAgICBjb25zdCBjb2xsaXNpb25zID0gc3RhdHVzLmNhc2VDb2xsaXNpb25zID8/IFtdO1xuICAgIGlmIChjb2xsaXNpb25zLmxlbmd0aCA+IDApIHtcbiAgICAgIGxpbmVzLnB1c2goYC0gQ2FzZS1jb2xsaWRpbmcgcGF0aHMgKGludmlzaWJsZSB0d2luIG9uIHRoaXMgZmlsZXN5c3RlbSk6ICR7Y29sbGlzaW9ucy5sZW5ndGh9YCk7XG4gICAgICBmb3IgKGNvbnN0IHBhdGggb2YgY29sbGlzaW9ucykgbGluZXMucHVzaChgICAtICR7cGF0aH1gKTtcbiAgICB9XG4gICAgaWYgKHN0YXR1cy5wcm9ncmVzcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBsaW5lcy5wdXNoKGAtIFByb2dyZXNzOiAke3N0YXR1cy5wcm9ncmVzcy5waGFzZX0gJHtzdGF0dXMucHJvZ3Jlc3MuZG9uZX0vJHtzdGF0dXMucHJvZ3Jlc3MudG90YWx9YCk7XG4gICAgfVxuICB9XG5cbiAgbGluZXMucHVzaCgnJywgYCMjIFJlY2VudCBsb2cgKGxhc3QgJHtpbnB1dC5yZWNlbnRMb2dMaW5lcy5sZW5ndGh9IGxpbmVzKWAsICcnKTtcbiAgaWYgKGlucHV0LnJlY2VudExvZ0xpbmVzLmxlbmd0aCA9PT0gMCkge1xuICAgIGxpbmVzLnB1c2goJyhubyByZWNvcmRlZCBsb2cgbGluZXMpJyk7XG4gIH0gZWxzZSB7XG4gICAgbGluZXMucHVzaCgnYGBgdGV4dCcpO1xuICAgIGxpbmVzLnB1c2goLi4uaW5wdXQucmVjZW50TG9nTGluZXMpO1xuICAgIGxpbmVzLnB1c2goJ2BgYCcpO1xuICB9XG4gIHJldHVybiBgJHtsaW5lcy5qb2luKCdcXG4nKX1cXG5gO1xufVxuXG4vKiogSHVtYW4gcGxhdGZvcm0gc3VtbWFyeSBmcm9tIGBQbGF0Zm9ybWAgKG1vYmlsZSB2cyBkZXNrdG9wLCBPUywgZm9ybSBmYWN0b3IpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBsYXRmb3JtU3VtbWFyeSgpOiBzdHJpbmcge1xuICBpZiAoUGxhdGZvcm0uaXNNb2JpbGVBcHApIHtcbiAgICBjb25zdCBvcyA9IFBsYXRmb3JtLmlzSW9zQXBwID8gJ2lPUycgOiBQbGF0Zm9ybS5pc0FuZHJvaWRBcHAgPyAnQW5kcm9pZCcgOiAndW5rbm93biBPUyc7XG4gICAgY29uc3QgZmFjdG9yID0gUGxhdGZvcm0uaXNUYWJsZXQgPyAndGFibGV0JyA6IFBsYXRmb3JtLmlzUGhvbmUgPyAncGhvbmUnIDogJ2RldmljZSc7XG4gICAgcmV0dXJuIGBPYnNpZGlhbiBtb2JpbGUgYXBwICgke29zfSwgJHtmYWN0b3J9KWA7XG4gIH1cbiAgcmV0dXJuICdPYnNpZGlhbiBkZXNrdG9wIGFwcCc7XG59XG5cbi8qKiBCZXN0LWVmZm9ydCBjbGlwYm9hcmQgd3JpdGU7IHJlc29sdmVzIGZhbHNlIHdoZXJlIHRoZSBjbGlwYm9hcmQgaXMgdW5hdmFpbGFibGUuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY29weVRvQ2xpcGJvYXJkKHRleHQ6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICBjb25zdCBjbGlwYm9hcmQgPSAoZ2xvYmFsVGhpcyBhcyB7IG5hdmlnYXRvcj86IHsgY2xpcGJvYXJkPzogeyB3cml0ZVRleHQ/KHQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4gfSB9IH0pXG4gICAgLm5hdmlnYXRvcj8uY2xpcGJvYXJkO1xuICBpZiAoY2xpcGJvYXJkPy53cml0ZVRleHQgPT09IHVuZGVmaW5lZCkgcmV0dXJuIGZhbHNlO1xuICB0cnkge1xuICAgIGF3YWl0IGNsaXBib2FyZC53cml0ZVRleHQodGV4dCk7XG4gICAgcmV0dXJuIHRydWU7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG4vKiogQnl0ZXMgXHUyMTkyIGh1bWFuIHRleHQgKGA3MzAgQmAsIGAxLjIgTUJgKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRCeXRlcyhieXRlczogbnVtYmVyKTogc3RyaW5nIHtcbiAgaWYgKGJ5dGVzIDwgMTAyNCkgcmV0dXJuIGAke2J5dGVzfSBCYDtcbiAgY29uc3QgdW5pdHMgPSBbJ0tCJywgJ01CJywgJ0dCJywgJ1RCJ107XG4gIGxldCB2YWx1ZSA9IGJ5dGVzO1xuICBsZXQgdW5pdCA9IC0xO1xuICBkbyB7XG4gICAgdmFsdWUgLz0gMTAyNDtcbiAgICB1bml0ICs9IDE7XG4gIH0gd2hpbGUgKHZhbHVlID49IDEwMjQgJiYgdW5pdCA8IHVuaXRzLmxlbmd0aCAtIDEpO1xuICByZXR1cm4gYCR7dmFsdWUgPj0gMTAwID8gTWF0aC5yb3VuZCh2YWx1ZSkgOiB2YWx1ZS50b0ZpeGVkKDEpfSAke3VuaXRzW3VuaXRdfWA7XG59XG4iLCAiLyoqXG4gKiBUaGUgcGx1Z2luJ3MgcGVyc2lzdGVkIHN0YXRlIChgZGF0YS5qc29uYCwgdmlhIGBQbHVnaW4ubG9hZERhdGEvc2F2ZURhdGFgKS5cbiAqXG4gKiBLZXB0IGRlbGliZXJhdGVseSBzbWFsbDogbGluayBpZGVudGl0eSAodXJsL3Rva2VuL2RldmljZUlkL2RldmljZU5hbWUpIHBsdXNcbiAqIHRoZSB0d28gY2xpZW50LXNpZGUgdG9nZ2xlcy4gVGhlIHRva2VuIGlzIHRoZSBkZXZpY2UncyBsb25nLWxpdmVkXG4gKiBjcmVkZW50aWFsIChBUkNISVRFQ1RVUkUgXHUwMEE3MykgXHUyMDE0IE9ic2lkaWFuIHN0b3JlcyBkYXRhLmpzb24gaW5zaWRlIHRoZSB2YXVsdCdzXG4gKiBgLm9ic2lkaWFuL3BsdWdpbnMvYCBkaXIsIHdoaWNoIHN5bmMgZXhjbHVkZXMsIHNvIGl0IG5ldmVyIGxlYXZlcyB0aGVcbiAqIG1hY2hpbmUgdGhyb3VnaCBzeW5jIGl0c2VsZi5cbiAqL1xuXG5pbXBvcnQgeyBQbGF0Zm9ybSB9IGZyb20gJ29ic2lkaWFuJztcbmltcG9ydCB0eXBlIHsgU3RhdHVzQmFyTW9kZSB9IGZyb20gJy4vc3RhdHVzYmFyLmpzJztcblxuLyoqIERpYWdub3N0aWNzIGxvZyBsZXZlbCAodGhlIFwiRGlhZ25vc3RpY3NcIiBzZXR0aW5ncyBkcm9wZG93bikuICovXG5leHBvcnQgdHlwZSBMb2dMZXZlbCA9ICdpbmZvJyB8ICdkZWJ1ZycgfCAnd2Fybic7XG5cbi8qKiBDbGllbnQtc2lkZSBzeW5jIGJlaGF2aW9yIHNldHRpbmdzICh0aGUgc2V0dGluZ3MtdGFiIHRvZ2dsZXMpLiAqL1xuZXhwb3J0IGludGVyZmFjZSBQbHVnaW5TeW5jU2V0dGluZ3Mge1xuICAvKipcbiAgICogUGVyaW9kaWMgZnVsbC1yZXNjYW4gaW50ZXJ2YWwgaW4gc2Vjb25kcyAoQVJDSElURUNUVVJFIFx1MDBBNzggbW9iaWxlIC9cbiAgICogZXh0ZXJuYWwgZWRpdHMpLiBgMGAgZGlzYWJsZXMgdGhlIHRpbWVyIFx1MjAxNCB2YXVsdCBldmVudHMgYW5kIGFwcC1vcGVuXG4gICAqIHJlY29uY2lsaWF0aW9uIHN0aWxsIHJ1bi5cbiAgICovXG4gIHJlc2NhbkludGVydmFsU2VjOiBudW1iZXI7XG4gIC8qKlxuICAgKiBPcHQgaW4gdG8gc3luY2luZyBgLm9ic2lkaWFuL2AgKEZSLTExKS4gVGhpcyBpcyB0aGUgY2xpZW50LXNpZGUgaW5pdGlhbFxuICAgKiBpZ25vcmUgc2V0dGluZzsgdGhlIHdvcmtlcidzIHBlci12YXVsdCBgVmF1bHRTZXR0aW5ncy5vYnNpZGlhblN5bmNgXG4gICAqIChkZWxpdmVyZWQgaW4gYGhlbGxvQWNrYCkgc3VwZXJzZWRlcyBpdCBvbmNlIGNvbm5lY3RlZC5cbiAgICovXG4gIG9ic2lkaWFuU3luYzogYm9vbGVhbjtcbiAgLyoqIFN0YXR1cy1iYXIgaW5kaWNhdG9yOiBmdWxsIHRleHQsIGEgY29tcGFjdCBzeW1ib2wsIG9yIG5vIGl0ZW0gYXQgYWxsLiAqL1xuICBzdGF0dXNCYXJNb2RlOiBTdGF0dXNCYXJNb2RlO1xuICAvKipcbiAgICogU3RhcnQgc3luY2luZyB3aGVuIE9ic2lkaWFuIGxvYWRzIChkZWZhdWx0KS4gT0ZGID0gbWFudWFsLW9ubHkgbW9kZTogdGhlXG4gICAqIHBsdWdpbiBsb2FkcyBpZGxlIGFuZCB0aGUgZmlyc3QgXCJTeW5jIG5vd1wiIHN0YXJ0cyBpdC5cbiAgICovXG4gIHN5bmNPblN0YXJ0dXA6IGJvb2xlYW47XG4gIC8qKiBEaWFnbm9zdGljcyBsb2cgbGV2ZWw7IGBkZWJ1Z2AgYWxzbyBsb2dzIHByb3RvY29sIHJvdW5kLXRyaXBzLiAqL1xuICBsb2dMZXZlbDogTG9nTGV2ZWw7XG4gIC8qKiBSYXcgaWdub3JlLXBhdHRlcm4gdGV4dCwgb25lIHBhdHRlcm4gcGVyIGxpbmUgKHNlZSBgcGFyc2VJZ25vcmVQYXR0ZXJuc2ApLiAqL1xuICBpZ25vcmVQYXR0ZXJuczogc3RyaW5nO1xufVxuXG4vKiogU2hhcGUgb2YgdGhlIHBsdWdpbidzIGBkYXRhLmpzb25gLiAqL1xuZXhwb3J0IGludGVyZmFjZSBWYXVsdFN5bmNQbHVnaW5EYXRhIHtcbiAgLyoqIFdvcmtlciBvcmlnaW4sIGUuZy4gYGh0dHBzOi8vcGVyc29uYWwueC53b3JrZXJzLmRldmAgKGVtcHR5IHByZS1wYWlyKS4gKi9cbiAgdXJsOiBzdHJpbmc7XG4gIC8qKiBMb25nLWxpdmVkIGRldmljZSB0b2tlbiAoZW1wdHkgcHJlLXBhaXIpLiAqL1xuICB0b2tlbjogc3RyaW5nO1xuICAvKiogRGV2aWNlIGlkIGFzc2lnbmVkIGJ5IHRoZSB3b3JrZXIgYXQgcGFpciB0aW1lLiAqL1xuICBkZXZpY2VJZDogc3RyaW5nO1xuICAvKiogSHVtYW4tcmVhZGFibGUgZGV2aWNlIG5hbWUgc2hvd24gaW4gdGhlIGRhc2hib2FyZCdzIGRldmljZSBsaXN0LiAqL1xuICBkZXZpY2VOYW1lOiBzdHJpbmc7XG4gIHNldHRpbmdzOiBQbHVnaW5TeW5jU2V0dGluZ3M7XG59XG5cbmV4cG9ydCBjb25zdCBERUZBVUxUX1JFU0NBTl9JTlRFUlZBTF9TRUMgPSAzMDtcblxuLyoqIENob2ljZXMgb2ZmZXJlZCBieSB0aGUgc2V0dGluZ3MgZHJvcGRvd246IHNlY29uZHMgXHUyMTkyIGxhYmVsLiAqL1xuZXhwb3J0IGNvbnN0IFJFU0NBTl9JTlRFUlZBTF9DSE9JQ0VTOiBSZWFkb25seUFycmF5PHsgdmFsdWU6IG51bWJlcjsgbGFiZWw6IHN0cmluZyB9PiA9IFtcbiAgeyB2YWx1ZTogMTAsIGxhYmVsOiAnRXZlcnkgMTAgc2Vjb25kcycgfSxcbiAgeyB2YWx1ZTogMzAsIGxhYmVsOiAnRXZlcnkgMzAgc2Vjb25kcycgfSxcbiAgeyB2YWx1ZTogNjAsIGxhYmVsOiAnRXZlcnkgbWludXRlJyB9LFxuICB7IHZhbHVlOiAzMDAsIGxhYmVsOiAnRXZlcnkgNSBtaW51dGVzJyB9LFxuICB7IHZhbHVlOiAwLCBsYWJlbDogJ09mZiAodmF1bHQgZXZlbnRzIG9ubHkpJyB9LFxuXTtcblxuZXhwb3J0IGZ1bmN0aW9uIGRlZmF1bHRQbHVnaW5EYXRhKCk6IFZhdWx0U3luY1BsdWdpbkRhdGEge1xuICByZXR1cm4ge1xuICAgIHVybDogJycsXG4gICAgdG9rZW46ICcnLFxuICAgIGRldmljZUlkOiAnJyxcbiAgICBkZXZpY2VOYW1lOiAnJyxcbiAgICBzZXR0aW5nczoge1xuICAgICAgcmVzY2FuSW50ZXJ2YWxTZWM6IERFRkFVTFRfUkVTQ0FOX0lOVEVSVkFMX1NFQyxcbiAgICAgIG9ic2lkaWFuU3luYzogZmFsc2UsXG4gICAgICBzdGF0dXNCYXJNb2RlOiAnZGV0YWlsZWQnLFxuICAgICAgc3luY09uU3RhcnR1cDogdHJ1ZSxcbiAgICAgIGxvZ0xldmVsOiAnaW5mbycsXG4gICAgICBpZ25vcmVQYXR0ZXJuczogJycsXG4gICAgfSxcbiAgfTtcbn1cblxuLyoqIENvZXJjZSB3aGF0ZXZlciBgbG9hZERhdGEoKWAgcmV0dXJuZWQgaW50byBhIHdlbGwtZm9ybWVkIG9iamVjdC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVQbHVnaW5EYXRhKHJhdzogdW5rbm93bik6IFZhdWx0U3luY1BsdWdpbkRhdGEge1xuICBjb25zdCBiYXNlID0gZGVmYXVsdFBsdWdpbkRhdGEoKTtcbiAgaWYgKHR5cGVvZiByYXcgIT09ICdvYmplY3QnIHx8IHJhdyA9PT0gbnVsbCkgcmV0dXJuIGJhc2U7XG4gIGNvbnN0IHNvdXJjZSA9IHJhdyBhcyBQYXJ0aWFsPFZhdWx0U3luY1BsdWdpbkRhdGE+ICYgeyBzZXR0aW5ncz86IFBhcnRpYWw8UGx1Z2luU3luY1NldHRpbmdzPiB9O1xuICBjb25zdCBzdGF0dXNCYXJNb2RlID0gc291cmNlLnNldHRpbmdzPy5zdGF0dXNCYXJNb2RlO1xuICBjb25zdCBsb2dMZXZlbCA9IHNvdXJjZS5zZXR0aW5ncz8ubG9nTGV2ZWw7XG4gIHJldHVybiB7XG4gICAgdXJsOiB0eXBlb2Ygc291cmNlLnVybCA9PT0gJ3N0cmluZycgPyBzb3VyY2UudXJsIDogJycsXG4gICAgdG9rZW46IHR5cGVvZiBzb3VyY2UudG9rZW4gPT09ICdzdHJpbmcnID8gc291cmNlLnRva2VuIDogJycsXG4gICAgZGV2aWNlSWQ6IHR5cGVvZiBzb3VyY2UuZGV2aWNlSWQgPT09ICdzdHJpbmcnID8gc291cmNlLmRldmljZUlkIDogJycsXG4gICAgZGV2aWNlTmFtZTogdHlwZW9mIHNvdXJjZS5kZXZpY2VOYW1lID09PSAnc3RyaW5nJyA/IHNvdXJjZS5kZXZpY2VOYW1lIDogJycsXG4gICAgc2V0dGluZ3M6IHtcbiAgICAgIHJlc2NhbkludGVydmFsU2VjOlxuICAgICAgICB0eXBlb2Ygc291cmNlLnNldHRpbmdzPy5yZXNjYW5JbnRlcnZhbFNlYyA9PT0gJ251bWJlcicgJiYgc291cmNlLnNldHRpbmdzLnJlc2NhbkludGVydmFsU2VjID49IDBcbiAgICAgICAgICA/IE1hdGguZmxvb3Ioc291cmNlLnNldHRpbmdzLnJlc2NhbkludGVydmFsU2VjKVxuICAgICAgICAgIDogREVGQVVMVF9SRVNDQU5fSU5URVJWQUxfU0VDLFxuICAgICAgb2JzaWRpYW5TeW5jOiBzb3VyY2Uuc2V0dGluZ3M/Lm9ic2lkaWFuU3luYyA9PT0gdHJ1ZSxcbiAgICAgIHN0YXR1c0Jhck1vZGU6XG4gICAgICAgIHN0YXR1c0Jhck1vZGUgPT09ICdjb21wYWN0JyB8fCBzdGF0dXNCYXJNb2RlID09PSAnaGlkZGVuJyA/IHN0YXR1c0Jhck1vZGUgOiAnZGV0YWlsZWQnLFxuICAgICAgc3luY09uU3RhcnR1cDogc291cmNlLnNldHRpbmdzPy5zeW5jT25TdGFydHVwICE9PSBmYWxzZSxcbiAgICAgIGxvZ0xldmVsOiBsb2dMZXZlbCA9PT0gJ2RlYnVnJyB8fCBsb2dMZXZlbCA9PT0gJ3dhcm4nID8gbG9nTGV2ZWwgOiAnaW5mbycsXG4gICAgICBpZ25vcmVQYXR0ZXJuczogdHlwZW9mIHNvdXJjZS5zZXR0aW5ncz8uaWdub3JlUGF0dGVybnMgPT09ICdzdHJpbmcnID8gc291cmNlLnNldHRpbmdzLmlnbm9yZVBhdHRlcm5zIDogJycsXG4gICAgfSxcbiAgfTtcbn1cblxuLyoqXG4gKiBJZ25vcmUtcGF0dGVybiB0ZXh0IFx1MjE5MiBwYXR0ZXJuIGxpc3Q6IG9uZSBwYXR0ZXJuIHBlciBsaW5lLCB0cmltbWVkLCBibGFua1xuICogbGluZXMgZHJvcHBlZC4gUHVyZSBcdTIwMTQgc2FmZSB0byBjYWxsIG9uIGV2ZXJ5IGBzdGFydFN5bmNgLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VJZ25vcmVQYXR0ZXJucyh0ZXh0OiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIHJldHVybiB0ZXh0XG4gICAgLnNwbGl0KC9cXHI/XFxuLylcbiAgICAubWFwKChsaW5lKSA9PiBsaW5lLnRyaW0oKSlcbiAgICAuZmlsdGVyKChsaW5lKSA9PiBsaW5lICE9PSAnJyk7XG59XG5cbi8qKiBBIHZhdWx0IGlzIGxpbmtlZCBpZmYgcGFpciBpZGVudGl0eSBpcyBjb21wbGV0ZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0xpbmtlZChkYXRhOiBWYXVsdFN5bmNQbHVnaW5EYXRhKTogYm9vbGVhbiB7XG4gIHJldHVybiBkYXRhLnVybCAhPT0gJycgJiYgZGF0YS50b2tlbiAhPT0gJycgJiYgZGF0YS5kZXZpY2VJZCAhPT0gJyc7XG59XG5cbi8qKiBEZXZpY2UgdHlwZSBmb3IgdGhlIHdvcmtlciByZWdpc3RyeSwgZnJvbSB0aGUgcGxhdGZvcm0gKEZSLTIzKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkZXRlY3REZXZpY2VUeXBlKCk6ICdkZXNrdG9wJyB8ICdtb2JpbGUnIHtcbiAgcmV0dXJuIFBsYXRmb3JtLmlzTW9iaWxlQXBwID8gJ21vYmlsZScgOiAnZGVza3RvcCc7XG59XG5cbi8qKiBEZWZhdWx0IGRldmljZSBuYW1lIHdoZW4gdGhlIHVzZXIgaGFzIG5vdCB0eXBlZCBvbmUuICovXG5leHBvcnQgZnVuY3Rpb24gZGVmYXVsdERldmljZU5hbWUoKTogc3RyaW5nIHtcbiAgaWYgKFBsYXRmb3JtLmlzTW9iaWxlQXBwKSB7XG4gICAgaWYgKFBsYXRmb3JtLmlzSW9zQXBwKSByZXR1cm4gJ2lQaG9uZS9pUGFkJztcbiAgICBpZiAoUGxhdGZvcm0uaXNBbmRyb2lkQXBwKSByZXR1cm4gJ0FuZHJvaWQnO1xuICAgIHJldHVybiAnT2JzaWRpYW4gbW9iaWxlJztcbiAgfVxuICByZXR1cm4gJ09ic2lkaWFuIGRlc2t0b3AnO1xufVxuIiwgIi8qKlxuICogTWluaW1hbCB0eXBlZCBjbGllbnQgZm9yIHRoZSB3b3JrZXIncyBIVFRQIHN1cmZhY2UgYXMgdGhlIHBsdWdpbiB1c2VzIGl0OlxuICogYEdFVCAvaGVhbHRoYCAoY2xhaW0tc3RhdGUgcHJvYmUgYmVmb3JlIHBhaXJpbmcpLCBgUE9TVCAvcGFpcmAgKHJlZGVlbSBhXG4gKiBwYWlyaW5nIGNvZGUsIEFSQ0hJVEVDVFVSRSBcdTAwQTczKSwgYFBBVENIIC9kZXZpY2VgIChkZXZpY2Ugc2VsZi1zZXJ2aWNlXG4gKiByZW5hbWUpLCBhbmQgYEdFVCAvYXBpL3N0YXR1c2AgKHN0b3JhZ2UvZGV2aWNlIHN1bW1hcnkgZm9yIEFib3V0KS4gQnVpbHRcbiAqIG9uIGFuIGluamVjdGFibGUgYGZldGNoYDsgZmFpbHVyZXMgbWFwIHRvIHR5cGVkIGVycm9ycyB3aXRoIGFjdGlvbmFibGVcbiAqIG1lc3NhZ2VzIHNvIHRoZSBzZXR0aW5ncyBVSSBhbmQgdGhlIGRlZXAtbGluayBoYW5kbGVyIG5ldmVyIHNlZSBhIHJhd1xuICogYFR5cGVFcnJvcjogRmFpbGVkIHRvIGZldGNoYC5cbiAqL1xuXG4vKiogQSB3b3JrZXIgY2FsbCBmYWlsZWQgKHVucmVhY2hhYmxlIG9yIHVuZXhwZWN0ZWQgSFRUUCkuICovXG5leHBvcnQgY2xhc3MgV29ya2VyQXBpRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIGNvbnN0cnVjdG9yKFxuICAgIG1lc3NhZ2U6IHN0cmluZyxcbiAgICByZWFkb25seSBzdGF0dXM/OiBudW1iZXIsXG4gICkge1xuICAgIHN1cGVyKG1lc3NhZ2UpO1xuICAgIHRoaXMubmFtZSA9ICdXb3JrZXJBcGlFcnJvcic7XG4gIH1cbn1cblxuLyoqIFRoZSBwYWlyaW5nIGNvZGUgd2FzIHJlamVjdGVkIChpbnZhbGlkIC8gZXhwaXJlZCAvIGFscmVhZHkgdXNlZCkuICovXG5leHBvcnQgY2xhc3MgUGFpclJlamVjdGVkRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIGNvbnN0cnVjdG9yKG1lc3NhZ2U6IHN0cmluZykge1xuICAgIHN1cGVyKG1lc3NhZ2UpO1xuICAgIHRoaXMubmFtZSA9ICdQYWlyUmVqZWN0ZWRFcnJvcic7XG4gIH1cbn1cblxuLyoqIFRoZSB3b3JrZXIgZXhpc3RzIGJ1dCBoYXMgbm90IGJlZW4gY2xhaW1lZCB5ZXQgKEhUVFAgNDIxIHNlbWFudGljcykuICovXG5leHBvcnQgY2xhc3MgVW5jbGFpbWVkV29ya2VyRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIGNvbnN0cnVjdG9yKG1lc3NhZ2U6IHN0cmluZykge1xuICAgIHN1cGVyKG1lc3NhZ2UpO1xuICAgIHRoaXMubmFtZSA9ICdVbmNsYWltZWRXb3JrZXJFcnJvcic7XG4gIH1cbn1cblxuZXhwb3J0IGludGVyZmFjZSBIZWFsdGhJbmZvIHtcbiAgcmVhY2hhYmxlOiBib29sZWFuO1xuICBjbGFpbWVkOiBib29sZWFuO1xuICAvKiogSHVtYW4tcmVhZGFibGUgcmVhc29uIHdoZW4gdGhlIHdvcmtlciBjb3VsZCBub3QgYmUgcmVhY2hlZC4gKi9cbiAgcmVhc29uPzogc3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFBhaXJDcmVkZW50aWFscyB7XG4gIHRva2VuOiBzdHJpbmc7XG4gIGRldmljZUlkOiBzdHJpbmc7XG59XG5cbi8qKlxuICogTm9ybWFsaXplIHVzZXIgaW5wdXQgaW50byBhIHdvcmtlciBvcmlnaW46IHRyaW1zLCB0b2xlcmF0ZXMgYSBtaXNzaW5nXG4gKiBzY2hlbWUgKGFzc3VtZXMgaHR0cHMpLCBhIHRyYWlsaW5nIHNsYXNoLCBhbmQgc3RyYXkgcGF0aCBjb21wb25lbnRzO1xuICogcmV0dXJucyBgaHR0cHM6Ly9ob3N0YCBzdHlsZSBvcmlnaW4uIFRocm93cyBgV29ya2VyQXBpRXJyb3JgIG9uIGdhcmJhZ2UuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVXb3JrZXJVcmwoaW5wdXQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGxldCBjYW5kaWRhdGUgPSBpbnB1dC50cmltKCk7XG4gIGlmIChjYW5kaWRhdGUgPT09ICcnKSB0aHJvdyBuZXcgV29ya2VyQXBpRXJyb3IoJ3dvcmtlciBVUkwgaXMgZW1wdHknKTtcbiAgaWYgKCEvXlthLXpBLVpdW2EtekEtWjAtOSsuLV0qOlxcL1xcLy8udGVzdChjYW5kaWRhdGUpKSBjYW5kaWRhdGUgPSBgaHR0cHM6Ly8ke2NhbmRpZGF0ZX1gO1xuICBsZXQgb3JpZ2luOiBzdHJpbmc7XG4gIHRyeSB7XG4gICAgb3JpZ2luID0gbmV3IFVSTChjYW5kaWRhdGUpLm9yaWdpbjtcbiAgfSBjYXRjaCB7XG4gICAgdGhyb3cgbmV3IFdvcmtlckFwaUVycm9yKGBpbnZhbGlkIHdvcmtlciBVUkw6ICR7SlNPTi5zdHJpbmdpZnkoaW5wdXQpfWApO1xuICB9XG4gIGlmICghb3JpZ2luLnN0YXJ0c1dpdGgoJ2h0dHA6Ly8nKSAmJiAhb3JpZ2luLnN0YXJ0c1dpdGgoJ2h0dHBzOi8vJykpIHtcbiAgICB0aHJvdyBuZXcgV29ya2VyQXBpRXJyb3IoYHdvcmtlciBVUkwgbXVzdCBiZSBodHRwKHMpLCBnb3QgJHtvcmlnaW59YCk7XG4gIH1cbiAgcmV0dXJuIG9yaWdpbjtcbn1cblxuLyoqIEdFVCAvaGVhbHRoIFx1MjAxNCBuZXZlciB0aHJvd3MgZm9yIHJlYWNoYWJpbGl0eTsgcmVwb3J0cyBjbGFpbSBzdGF0ZSBpbnN0ZWFkLiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGZldGNoSGVhbHRoKFxuICBvcmlnaW46IHN0cmluZyxcbiAgZmV0Y2hJbXBsOiB0eXBlb2YgZmV0Y2gsXG4pOiBQcm9taXNlPEhlYWx0aEluZm8+IHtcbiAgbGV0IHJlc3BvbnNlOiBSZXNwb25zZTtcbiAgdHJ5IHtcbiAgICByZXNwb25zZSA9IGF3YWl0IGZldGNoSW1wbChgJHtvcmlnaW59L2hlYWx0aGApO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIHJldHVybiB7XG4gICAgICByZWFjaGFibGU6IGZhbHNlLFxuICAgICAgY2xhaW1lZDogZmFsc2UsXG4gICAgICByZWFzb246IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKSxcbiAgICB9O1xuICB9XG4gIGlmICghcmVzcG9uc2Uub2spIHtcbiAgICByZXR1cm4geyByZWFjaGFibGU6IGZhbHNlLCBjbGFpbWVkOiBmYWxzZSwgcmVhc29uOiBgSFRUUCAke3Jlc3BvbnNlLnN0YXR1c31gIH07XG4gIH1cbiAgY29uc3QgYm9keSA9IChhd2FpdCByZXNwb25zZS5qc29uKCkuY2F0Y2goKCkgPT4gKHt9KSkpIGFzIHsgY2xhaW1lZD86IGJvb2xlYW4gfTtcbiAgcmV0dXJuIHsgcmVhY2hhYmxlOiB0cnVlLCBjbGFpbWVkOiBib2R5LmNsYWltZWQgPT09IHRydWUgfTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBQYWlyUmVxdWVzdFBhcmFtcyB7XG4gIG9yaWdpbjogc3RyaW5nO1xuICBjb2RlOiBzdHJpbmc7XG4gIGRldmljZU5hbWU6IHN0cmluZztcbiAgZGV2aWNlVHlwZTogJ2Rlc2t0b3AnIHwgJ21vYmlsZSc7XG4gIGZldGNoSW1wbDogdHlwZW9mIGZldGNoO1xufVxuXG4vKipcbiAqIFBPU1QgL3BhaXIgXHUyMDE0IHJlZGVlbSBhIG9uZS10aW1lIHBhaXJpbmcgY29kZSBmb3IgbG9uZy1saXZlZCBkZXZpY2VcbiAqIGNyZWRlbnRpYWxzLiBUaHJvd3MgYFBhaXJSZWplY3RlZEVycm9yYCAoYmFkIGNvZGUpLCBgVW5jbGFpbWVkV29ya2VyRXJyb3JgXG4gKiAoNDIxKSwgb3IgYFdvcmtlckFwaUVycm9yYCAodW5yZWFjaGFibGUgLyB1bmV4cGVjdGVkKS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlcXVlc3RQYWlyKHBhcmFtczogUGFpclJlcXVlc3RQYXJhbXMpOiBQcm9taXNlPFBhaXJDcmVkZW50aWFscz4ge1xuICBsZXQgcmVzcG9uc2U6IFJlc3BvbnNlO1xuICB0cnkge1xuICAgIHJlc3BvbnNlID0gYXdhaXQgcGFyYW1zLmZldGNoSW1wbChgJHtwYXJhbXMub3JpZ2lufS9wYWlyYCwge1xuICAgICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgICBoZWFkZXJzOiB7ICdjb250ZW50LXR5cGUnOiAnYXBwbGljYXRpb24vanNvbicgfSxcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgY29kZTogcGFyYW1zLmNvZGUsXG4gICAgICAgIGRldmljZU5hbWU6IHBhcmFtcy5kZXZpY2VOYW1lLFxuICAgICAgICBkZXZpY2VUeXBlOiBwYXJhbXMuZGV2aWNlVHlwZSxcbiAgICAgIH0pLFxuICAgIH0pO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIHRocm93IG5ldyBXb3JrZXJBcGlFcnJvcihcbiAgICAgIGBjb3VsZCBub3QgcmVhY2ggdGhlIHdvcmtlciBhdCAke3BhcmFtcy5vcmlnaW59OiAke1xuICAgICAgICBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcilcbiAgICAgIH1gLFxuICAgICk7XG4gIH1cbiAgLy8gUmVhZCB0aGUgYm9keSBvbmNlIChhIFJlc3BvbnNlIGJvZHkgaXMgc2luZ2xlLXVzZSkgYW5kIHBhcnNlIGZyb20gdGV4dC5cbiAgY29uc3QgZGV0YWlsID0gKGF3YWl0IHJlc3BvbnNlLnRleHQoKS5jYXRjaCgoKSA9PiAnJykpLnRyaW0oKTtcbiAgaWYgKHJlc3BvbnNlLnN0YXR1cyA9PT0gNDIxKSB7XG4gICAgdGhyb3cgbmV3IFVuY2xhaW1lZFdvcmtlckVycm9yKCd0aGlzIHdvcmtlciBoYXMgbm90IGJlZW4gY2xhaW1lZCB5ZXQnKTtcbiAgfVxuICBpZiAocmVzcG9uc2Uuc3RhdHVzID09PSA0MDEgfHwgcmVzcG9uc2Uuc3RhdHVzID09PSA0MDMpIHtcbiAgICB0aHJvdyBuZXcgUGFpclJlamVjdGVkRXJyb3IoXG4gICAgICAncGFpcmluZyBjb2RlIHJlamVjdGVkIFx1MjAxNCBjb2RlcyBhcmUgb25lLXRpbWUsIGV4cGlyZSBhZnRlciAxMCBtaW51dGVzLCBhbmQgY29tZSAnICtcbiAgICAgICAgJ2Zyb20gdGhlIHdvcmtlciBkYXNoYm9hcmQuIEdlbmVyYXRlIGEgZnJlc2ggb25lIGFuZCByZXRyeS4nLFxuICAgICk7XG4gIH1cbiAgaWYgKCFyZXNwb25zZS5vaykge1xuICAgIHRocm93IG5ldyBXb3JrZXJBcGlFcnJvcihcbiAgICAgIGBwYWlyaW5nIGZhaWxlZDogSFRUUCAke3Jlc3BvbnNlLnN0YXR1c30gJHtkZXRhaWwuc2xpY2UoMCwgMjAwKX1gLnRyaW0oKSxcbiAgICAgIHJlc3BvbnNlLnN0YXR1cyxcbiAgICApO1xuICB9XG4gIGxldCBib2R5OiB7IHRva2VuPzogdW5rbm93bjsgZGV2aWNlSWQ/OiB1bmtub3duIH07XG4gIHRyeSB7XG4gICAgYm9keSA9IEpTT04ucGFyc2UoZGV0YWlsKSBhcyB7IHRva2VuPzogdW5rbm93bjsgZGV2aWNlSWQ/OiB1bmtub3duIH07XG4gIH0gY2F0Y2gge1xuICAgIHRocm93IG5ldyBXb3JrZXJBcGlFcnJvcigncGFpcmluZyByZXBseSB3YXMgbm90IEpTT04nLCByZXNwb25zZS5zdGF0dXMpO1xuICB9XG4gIGlmICh0eXBlb2YgYm9keS50b2tlbiAhPT0gJ3N0cmluZycgfHwgdHlwZW9mIGJvZHkuZGV2aWNlSWQgIT09ICdzdHJpbmcnKSB7XG4gICAgdGhyb3cgbmV3IFdvcmtlckFwaUVycm9yKCdwYWlyaW5nIHJlcGx5IHdhcyBtaXNzaW5nIHRva2VuL2RldmljZUlkJywgcmVzcG9uc2Uuc3RhdHVzKTtcbiAgfVxuICByZXR1cm4geyB0b2tlbjogYm9keS50b2tlbiwgZGV2aWNlSWQ6IGJvZHkuZGV2aWNlSWQgfTtcbn1cblxuLy8gLS0tIGRldmljZSBzZWxmLXNlcnZpY2UgKFBBVENIIC9kZXZpY2UpIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBUaGUgZGV2aWNlIGRvY3VtZW50IHRoZSB3b3JrZXIgcmV0dXJucyBmcm9tIGBQQVRDSCAvZGV2aWNlYC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgV29ya2VyRGV2aWNlIHtcbiAgaWQ6IHN0cmluZztcbiAgbmFtZTogc3RyaW5nO1xuICB0eXBlOiBzdHJpbmc7XG59XG5cbmV4cG9ydCB0eXBlIFJlbmFtZU91dGNvbWUgPVxuICB8IHsgb2s6IHRydWU7IGRldmljZTogV29ya2VyRGV2aWNlIH1cbiAgfCB7IG9rOiBmYWxzZTsgZXJyb3I6IHN0cmluZyB9O1xuXG5leHBvcnQgaW50ZXJmYWNlIFJlbmFtZVBhcmFtcyB7XG4gIG9yaWdpbjogc3RyaW5nO1xuICAvKiogVGhlIGNhbGxpbmcgZGV2aWNlJ3Mgb3duIHRva2VuIFx1MjAxNCBpdCBjYW4gb25seSBldmVyIHJlbmFtZSBpdHNlbGYuICovXG4gIHRva2VuOiBzdHJpbmc7XG4gIG5hbWU6IHN0cmluZztcbiAgZmV0Y2hJbXBsOiB0eXBlb2YgZmV0Y2g7XG59XG5cbi8qKlxuICogYFBBVENIIC9kZXZpY2VgIFx1MjAxNCByZW5hbWUgVEhJUyBkZXZpY2Ugb24gdGhlIHdvcmtlciAoZGV2aWNlLXRva2VuXG4gKiBhdXRoZW50aWNhdGVkOyBuZXZlciB0aHJvd3M6IGZhaWx1cmVzIGNvbWUgYmFjayBhcyBge29rOmZhbHNlLCBlcnJvcn1gKS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlbmFtZURldmljZShwYXJhbXM6IFJlbmFtZVBhcmFtcyk6IFByb21pc2U8UmVuYW1lT3V0Y29tZT4ge1xuICBsZXQgcmVzcG9uc2U6IFJlc3BvbnNlO1xuICB0cnkge1xuICAgIHJlc3BvbnNlID0gYXdhaXQgcGFyYW1zLmZldGNoSW1wbChgJHtwYXJhbXMub3JpZ2lufS9kZXZpY2VgLCB7XG4gICAgICBtZXRob2Q6ICdQQVRDSCcsXG4gICAgICBoZWFkZXJzOiB7ICdjb250ZW50LXR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsIGF1dGhvcml6YXRpb246IGBCZWFyZXIgJHtwYXJhbXMudG9rZW59YCB9LFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBuYW1lOiBwYXJhbXMubmFtZSB9KSxcbiAgICB9KTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICByZXR1cm4ge1xuICAgICAgb2s6IGZhbHNlLFxuICAgICAgZXJyb3I6IGBjb3VsZCBub3QgcmVhY2ggdGhlIHdvcmtlciBhdCAke3BhcmFtcy5vcmlnaW59OiAke1xuICAgICAgICBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcilcbiAgICAgIH1gLFxuICAgIH07XG4gIH1cbiAgY29uc3QgZGV0YWlsID0gKGF3YWl0IHJlc3BvbnNlLnRleHQoKS5jYXRjaCgoKSA9PiAnJykpLnRyaW0oKTtcbiAgaWYgKHJlc3BvbnNlLnN0YXR1cyA9PT0gNDIxKSB7XG4gICAgcmV0dXJuIHsgb2s6IGZhbHNlLCBlcnJvcjogJ3RoaXMgd29ya2VyIGhhcyBub3QgYmVlbiBjbGFpbWVkIHlldCcgfTtcbiAgfVxuICBpZiAocmVzcG9uc2Uuc3RhdHVzID09PSA0MDEgfHwgcmVzcG9uc2Uuc3RhdHVzID09PSA0MDMpIHtcbiAgICByZXR1cm4ge1xuICAgICAgb2s6IGZhbHNlLFxuICAgICAgZXJyb3I6ICd0aGUgd29ya2VyIHJlamVjdGVkIHRoaXMgZGV2aWNlXFx1MjAxOXMgdG9rZW4gKHJldm9rZWQ/KSBcdTIwMTQgdW5saW5rIGFuZCByZS1wYWlyIHdpdGggYSBmcmVzaCBjb2RlLicsXG4gICAgfTtcbiAgfVxuICBpZiAoIXJlc3BvbnNlLm9rKSB7XG4gICAgbGV0IHJlYXNvbiA9IGBIVFRQICR7cmVzcG9uc2Uuc3RhdHVzfWA7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2UoZGV0YWlsKSBhcyB7IGVycm9yPzogdW5rbm93biB9O1xuICAgICAgaWYgKHR5cGVvZiBwYXJzZWQuZXJyb3IgPT09ICdzdHJpbmcnKSByZWFzb24gPSBwYXJzZWQuZXJyb3I7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBrZWVwIHRoZSBiYXJlIHN0YXR1c1xuICAgIH1cbiAgICByZXR1cm4geyBvazogZmFsc2UsIGVycm9yOiByZWFzb24gfTtcbiAgfVxuICBsZXQgYm9keTogeyBkZXZpY2U/OiB1bmtub3duIH07XG4gIHRyeSB7XG4gICAgYm9keSA9IEpTT04ucGFyc2UoZGV0YWlsKSBhcyB7IGRldmljZT86IHVua25vd24gfTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIHsgb2s6IGZhbHNlLCBlcnJvcjogJ3JlbmFtZSByZXBseSB3YXMgbm90IEpTT04nIH07XG4gIH1cbiAgY29uc3QgZGV2aWNlID0gYm9keS5kZXZpY2UgYXMgUGFydGlhbDxXb3JrZXJEZXZpY2U+IHwgdW5kZWZpbmVkO1xuICBpZiAoXG4gICAgdHlwZW9mIGRldmljZT8uaWQgIT09ICdzdHJpbmcnIHx8XG4gICAgdHlwZW9mIGRldmljZS5uYW1lICE9PSAnc3RyaW5nJyB8fFxuICAgIHR5cGVvZiBkZXZpY2UudHlwZSAhPT0gJ3N0cmluZydcbiAgKSB7XG4gICAgcmV0dXJuIHsgb2s6IGZhbHNlLCBlcnJvcjogJ3JlbmFtZSByZXBseSB3YXMgbWlzc2luZyB0aGUgZGV2aWNlIGRvY3VtZW50JyB9O1xuICB9XG4gIHJldHVybiB7IG9rOiB0cnVlLCBkZXZpY2U6IHsgaWQ6IGRldmljZS5pZCwgbmFtZTogZGV2aWNlLm5hbWUsIHR5cGU6IGRldmljZS50eXBlIH0gfTtcbn1cblxuLy8gLS0tIHdvcmtlciBzdGF0dXMgKEdFVCAvYXBpL3N0YXR1cywgZGV2aWNlIHRva2VuKSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogVGhlIHNsaWNlIG9mIGAvYXBpL3N0YXR1c2AgdGhlIHBsdWdpbidzIEFib3V0IHNlY3Rpb24gc2hvd3MuICovXG5leHBvcnQgaW50ZXJmYWNlIFdvcmtlclN0YXR1c1N1bW1hcnkge1xuICB2YXVsdE5hbWU6IHN0cmluZztcbiAgZGV2aWNlczogQXJyYXk8eyBpZDogc3RyaW5nOyBuYW1lOiBzdHJpbmc7IHR5cGU6IHN0cmluZzsgb25saW5lOiBib29sZWFuOyByZXZva2VkOiBib29sZWFuIH0+O1xuICBhdHRhY2htZW50czogeyBjb3VudDogbnVtYmVyOyBieXRlczogbnVtYmVyIH07XG4gIHN0b3JhZ2VCeXRlczogbnVtYmVyO1xuICAvKiogV29ya2VyLXJlcG9ydGVkIHJlbGVhc2UgdmVyc2lvbiAoYWJzZW50IG9uIHNlcnZlcnMgXHUyMjY0IDAuMSkuICovXG4gIHNlcnZlclZlcnNpb24/OiBzdHJpbmc7XG59XG5cbi8qKlxuICogYEdFVCAvYXBpL3N0YXR1c2Agd2l0aCB0aGUgZGV2aWNlIHRva2VuIFx1MjAxNCBzdG9yYWdlIHVzYWdlICsgZGV2aWNlIGxpc3QgZm9yXG4gKiB0aGUgQWJvdXQgc2VjdGlvbi4gUmVzb2x2ZXMgYG51bGxgIG9uIGFueSBmYWlsdXJlIChBYm91dCBzaG93cyBcInVua25vd25cIikuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBmZXRjaFdvcmtlclN0YXR1cyhwYXJhbXM6IHtcbiAgb3JpZ2luOiBzdHJpbmc7XG4gIHRva2VuOiBzdHJpbmc7XG4gIGZldGNoSW1wbDogdHlwZW9mIGZldGNoO1xufSk6IFByb21pc2U8V29ya2VyU3RhdHVzU3VtbWFyeSB8IG51bGw+IHtcbiAgbGV0IHJlc3BvbnNlOiBSZXNwb25zZTtcbiAgdHJ5IHtcbiAgICByZXNwb25zZSA9IGF3YWl0IHBhcmFtcy5mZXRjaEltcGwoYCR7cGFyYW1zLm9yaWdpbn0vYXBpL3N0YXR1c2AsIHtcbiAgICAgIGhlYWRlcnM6IHsgYXV0aG9yaXphdGlvbjogYEJlYXJlciAke3BhcmFtcy50b2tlbn1gIH0sXG4gICAgfSk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsO1xuICB9XG4gIGlmICghcmVzcG9uc2Uub2spIHJldHVybiBudWxsO1xuICBjb25zdCBib2R5ID0gKGF3YWl0IHJlc3BvbnNlLmpzb24oKS5jYXRjaCgoKSA9PiBudWxsKSkgYXMgUGFydGlhbDxXb3JrZXJTdGF0dXNTdW1tYXJ5PiB8IG51bGw7XG4gIGlmIChib2R5ID09PSBudWxsIHx8IHR5cGVvZiBib2R5LnN0b3JhZ2VCeXRlcyAhPT0gJ251bWJlcicgfHwgdHlwZW9mIGJvZHkuYXR0YWNobWVudHMgIT09ICdvYmplY3QnKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbiAgcmV0dXJuIHtcbiAgICB2YXVsdE5hbWU6IHR5cGVvZiBib2R5LnZhdWx0TmFtZSA9PT0gJ3N0cmluZycgPyBib2R5LnZhdWx0TmFtZSA6ICcnLFxuICAgIGRldmljZXM6IEFycmF5LmlzQXJyYXkoYm9keS5kZXZpY2VzKSA/IGJvZHkuZGV2aWNlcyA6IFtdLFxuICAgIGF0dGFjaG1lbnRzOiBib2R5LmF0dGFjaG1lbnRzLFxuICAgIHN0b3JhZ2VCeXRlczogYm9keS5zdG9yYWdlQnl0ZXMsXG4gICAgLi4uKHR5cGVvZiBib2R5LnNlcnZlclZlcnNpb24gPT09ICdzdHJpbmcnID8geyBzZXJ2ZXJWZXJzaW9uOiBib2R5LnNlcnZlclZlcnNpb24gfSA6IHt9KSxcbiAgfTtcbn1cbiIsICIvKipcbiAqIFRoZSBwYWlyIGZsb3cgc2hhcmVkIGJ5IHRoZSBzZXR0aW5ncyBmb3JtIGFuZCB0aGUgYG9ic2lkaWFuOi8vYCBkZWVwIGxpbmtcbiAqIChBUkNISVRFQ1RVUkUgXHUwMEE3Myk6IHByb2JlIGBHRVQgL2hlYWx0aGAgZmlyc3QgXHUyMDE0IGFuICp1bmNsYWltZWQqIHdvcmtlciBnZXRzXG4gKiBmcmllbmRseSBvbmJvYXJkaW5nIGd1aWRhbmNlIGluc3RlYWQgb2YgYSBjcnlwdGljIDQyMSBcdTIwMTQgdGhlbiBgUE9TVCAvcGFpcmBcbiAqIGFuZCBoYW5kIHRoZSBjcmVkZW50aWFscyBiYWNrIHRvIGJlIHBlcnNpc3RlZC5cbiAqL1xuXG5pbXBvcnQge1xuICBmZXRjaEhlYWx0aCxcbiAgbm9ybWFsaXplV29ya2VyVXJsLFxuICByZXF1ZXN0UGFpcixcbiAgUGFpclJlamVjdGVkRXJyb3IsXG4gIFVuY2xhaW1lZFdvcmtlckVycm9yLFxuICBXb3JrZXJBcGlFcnJvcixcbn0gZnJvbSAnLi93b3JrZXJhcGkuanMnO1xuXG5leHBvcnQgdHlwZSBQYWlyT3V0Y29tZSA9XG4gIHwgeyBzdGF0dXM6ICdwYWlyZWQnOyB1cmw6IHN0cmluZzsgdG9rZW46IHN0cmluZzsgZGV2aWNlSWQ6IHN0cmluZyB9XG4gIHwgeyBzdGF0dXM6ICd1bmNsYWltZWQnOyB1cmw6IHN0cmluZzsgZ3VpZGFuY2U6IHN0cmluZyB9XG4gIHwgeyBzdGF0dXM6ICd1bnJlYWNoYWJsZSc7IHVybDogc3RyaW5nOyByZWFzb246IHN0cmluZyB9XG4gIHwgeyBzdGF0dXM6ICdyZWplY3RlZCc7IHVybDogc3RyaW5nOyByZWFzb246IHN0cmluZyB9XG4gIHwgeyBzdGF0dXM6ICdpbnZhbGlkLXVybCc7IGlucHV0OiBzdHJpbmcgfTtcblxuZXhwb3J0IGludGVyZmFjZSBQYWlyRmxvd1BhcmFtcyB7XG4gIC8qKiBXb3JrZXIgVVJMIGFzIHR5cGVkIC8gZGVlcC1saW5rZWQgKHNjaGVtZWxlc3MgaXMgdG9sZXJhdGVkKS4gKi9cbiAgdXJsOiBzdHJpbmc7XG4gIC8qKiBPbmUtdGltZSBwYWlyaW5nIGNvZGUgZnJvbSB0aGUgd29ya2VyIGRhc2hib2FyZC4gKi9cbiAgY29kZTogc3RyaW5nO1xuICBkZXZpY2VOYW1lOiBzdHJpbmc7XG4gIGRldmljZVR5cGU6ICdkZXNrdG9wJyB8ICdtb2JpbGUnO1xuICBmZXRjaEltcGw6IHR5cGVvZiBmZXRjaDtcbn1cblxuLyoqIE9uYm9hcmRpbmcgdGV4dCBzaG93biB3aGVuIHRoZSB3b3JrZXIgaXMgZGVwbG95ZWQgYnV0IG5vdCBjbGFpbWVkLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHVuY2xhaW1lZEd1aWRhbmNlKHVybDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIFtcbiAgICBgVGhlIHdvcmtlciBhdCAke3VybH0gaXMgZGVwbG95ZWQgYnV0IG5vdCBjbGFpbWVkIHlldC4gRmluaXNoIHNldHVwIGluIGEgYnJvd3NlcjpgLFxuICAgICcnLFxuICAgIGAxLiBPcGVuICR7dXJsfWAsXG4gICAgJzIuIFNldCB0aGUgYWRtaW4gcGFzc3BocmFzZSBhbmQgbmFtZSB0aGUgdmF1bHQgKHRoZSBjbGFpbSBwYWdlKS4nLFxuICAgICczLiBPbiB0aGUgZGFzaGJvYXJkLCBjcmVhdGUgYSBwYWlyaW5nIGNvZGUgKERldmljZXMgXHUyMTkyIFBhaXIgbmV3IGRldmljZSkuJyxcbiAgICAnNC4gRW50ZXIgdGhhdCBjb2RlIGhlcmUgKG9yIGNsaWNrIHRoZSBvYnNpZGlhbjovLyBsaW5rIHRoZSBkYXNoYm9hcmQgc2hvd3MpIGFuZCBwYWlyLicsXG4gIF0uam9pbignXFxuJyk7XG59XG5cbi8qKlxuICogUnVuIHRoZSBwYWlyIGZsb3cuIE5ldmVyIHRocm93cyBcdTIwMTQgZXZlcnkgZmFpbHVyZSBtb2RlIGlzIGEgdHlwZWQgb3V0Y29tZSB0aGVcbiAqIFVJIGNhbiByZW5kZXIgKGFuZCB0aGUgZGVlcC1saW5rIGhhbmRsZXIgY2FuIHR1cm4gaW50byBhIE5vdGljZSkuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBwYWlyV2l0aFdvcmtlcihwYXJhbXM6IFBhaXJGbG93UGFyYW1zKTogUHJvbWlzZTxQYWlyT3V0Y29tZT4ge1xuICBsZXQgb3JpZ2luOiBzdHJpbmc7XG4gIHRyeSB7XG4gICAgb3JpZ2luID0gbm9ybWFsaXplV29ya2VyVXJsKHBhcmFtcy51cmwpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4geyBzdGF0dXM6ICdpbnZhbGlkLXVybCcsIGlucHV0OiBwYXJhbXMudXJsIH07XG4gIH1cblxuICBjb25zdCBoZWFsdGggPSBhd2FpdCBmZXRjaEhlYWx0aChvcmlnaW4sIHBhcmFtcy5mZXRjaEltcGwpO1xuICBpZiAoIWhlYWx0aC5yZWFjaGFibGUpIHtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdHVzOiAndW5yZWFjaGFibGUnLFxuICAgICAgdXJsOiBvcmlnaW4sXG4gICAgICByZWFzb246XG4gICAgICAgIGAke2hlYWx0aC5yZWFzb24gPz8gJ3Vua25vd24gZXJyb3InfSBcdTIwMTQgY2hlY2sgdGhlIFVSTCwgeW91ciBuZXR3b3JrLCBhbmQgdGhhdCB0aGUgYCArXG4gICAgICAgICd3b3JrZXIgaXMgZGVwbG95ZWQuJyxcbiAgICB9O1xuICB9XG4gIGlmICghaGVhbHRoLmNsYWltZWQpIHtcbiAgICByZXR1cm4geyBzdGF0dXM6ICd1bmNsYWltZWQnLCB1cmw6IG9yaWdpbiwgZ3VpZGFuY2U6IHVuY2xhaW1lZEd1aWRhbmNlKG9yaWdpbikgfTtcbiAgfVxuXG4gIHRyeSB7XG4gICAgY29uc3QgY3JlZGVudGlhbHMgPSBhd2FpdCByZXF1ZXN0UGFpcih7XG4gICAgICBvcmlnaW4sXG4gICAgICBjb2RlOiBwYXJhbXMuY29kZSxcbiAgICAgIGRldmljZU5hbWU6IHBhcmFtcy5kZXZpY2VOYW1lLFxuICAgICAgZGV2aWNlVHlwZTogcGFyYW1zLmRldmljZVR5cGUsXG4gICAgICBmZXRjaEltcGw6IHBhcmFtcy5mZXRjaEltcGwsXG4gICAgfSk7XG4gICAgcmV0dXJuIHsgc3RhdHVzOiAncGFpcmVkJywgdXJsOiBvcmlnaW4sIC4uLmNyZWRlbnRpYWxzIH07XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgaWYgKGVycm9yIGluc3RhbmNlb2YgVW5jbGFpbWVkV29ya2VyRXJyb3IpIHtcbiAgICAgIHJldHVybiB7IHN0YXR1czogJ3VuY2xhaW1lZCcsIHVybDogb3JpZ2luLCBndWlkYW5jZTogdW5jbGFpbWVkR3VpZGFuY2Uob3JpZ2luKSB9O1xuICAgIH1cbiAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBQYWlyUmVqZWN0ZWRFcnJvcikge1xuICAgICAgcmV0dXJuIHsgc3RhdHVzOiAncmVqZWN0ZWQnLCB1cmw6IG9yaWdpbiwgcmVhc29uOiBlcnJvci5tZXNzYWdlIH07XG4gICAgfVxuICAgIGNvbnN0IHJlYXNvbiA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKTtcbiAgICByZXR1cm4geyBzdGF0dXM6ICdyZWplY3RlZCcsIHVybDogb3JpZ2luLCByZWFzb24gfTtcbiAgfVxufVxuXG4vKiogUmVuZGVyIGFueSBvdXRjb21lIGFzIHVzZXItZmFjaW5nIHRleHQgKE5vdGljZXMsIGRlZXAtbGluayBmZWVkYmFjaykuICovXG5leHBvcnQgZnVuY3Rpb24gcGFpck91dGNvbWVNZXNzYWdlKG91dGNvbWU6IFBhaXJPdXRjb21lKTogc3RyaW5nIHtcbiAgc3dpdGNoIChvdXRjb21lLnN0YXR1cykge1xuICAgIGNhc2UgJ3BhaXJlZCc6XG4gICAgICByZXR1cm4gYFBhaXJlZCB3aXRoICR7b3V0Y29tZS51cmx9IFx1MjAxNCBzeW5jaW5nIG5vdy5gO1xuICAgIGNhc2UgJ3VuY2xhaW1lZCc6XG4gICAgICByZXR1cm4gb3V0Y29tZS5ndWlkYW5jZTtcbiAgICBjYXNlICd1bnJlYWNoYWJsZSc6XG4gICAgICByZXR1cm4gYENvdWxkIG5vdCByZWFjaCB0aGUgd29ya2VyOiAke291dGNvbWUucmVhc29ufWA7XG4gICAgY2FzZSAncmVqZWN0ZWQnOlxuICAgICAgcmV0dXJuIGBQYWlyaW5nIGZhaWxlZDogJHtvdXRjb21lLnJlYXNvbn1gO1xuICAgIGNhc2UgJ2ludmFsaWQtdXJsJzpcbiAgICAgIHJldHVybiBgVGhhdCBkb2VzIG5vdCBsb29rIGxpa2UgYSB3b3JrZXIgVVJMOiAke0pTT04uc3RyaW5naWZ5KG91dGNvbWUuaW5wdXQpfWA7XG4gIH1cbn1cbiIsICIvKipcbiAqIGBvYnNpZGlhbjovL3ZhdWx0c3luY2ZvcmFnZW50cy9wYWlyP3VybD08d29ya2VyPiZjb2RlPTxwYWlyaW5nPmAgZGVlcC1saW5rXG4gKiBoYW5kbGluZyAoQVJDSElURUNUVVJFIFx1MDBBNzMpOiB0aGUgZGFzaGJvYXJkIHJlbmRlcnMgdGhpcyBsaW5rIChhbmQgdGhlIFFSXG4gKiBlcXVpdmFsZW50KSBzbyBhIG5ldyBkZXZpY2UgcGFpcnMgd2l0aCB6ZXJvIHR5cGluZy5cbiAqXG4gKiBUaGUgaGFuZGxlciBpcyByZWdpc3RlcmVkIGZvciB0aGUgYWN0aW9uIGB2YXVsdHN5bmNmb3JhZ2VudHNgLiBPYnNpZGlhblxuICogYnVpbGRzIGRpZmZlciBzdWJ0bHkgaW4gaG93IHRoZSBgL3BhaXJgIHBhdGggc2VnbWVudCBvZiBhIHByb3RvY29sIFVSTCBpc1xuICogbWF0Y2hlZCwgc28gdGhlIHNhbWUgaGFuZGxlciBpcyByZWdpc3RlcmVkIGZvciBgdmF1bHRzeW5jZm9yYWdlbnRzL3BhaXJgXG4gKiB0b28gXHUyMDE0IHdoaWNoZXZlciBzcGVsbGluZyBhIGdpdmVuIGJ1aWxkIHJlc29sdmVzLCB0aGUgbGluayB3b3Jrcy4gV2hlblxuICogYHVybGAvYGNvZGVgIGFyZSBhYnNlbnQgdGhlIGludm9jYXRpb24gaXMgaWdub3JlZCAoYSBzdHJheSBwcm90b2NvbCBoaXRcbiAqIG11c3Qgbm90IHNwYW0gYSBOb3RpY2UpOyBhICptYWxmb3JtZWQqIHBhaXIgbGluayAob25lIG9mIHRoZSB0d28gcHJlc2VudClcbiAqIGdldHMgYW4gYWN0aW9uYWJsZSBlcnJvci5cbiAqL1xuXG5pbXBvcnQgeyBOb3RpY2UgfSBmcm9tICdvYnNpZGlhbic7XG5cbi8qKiBQcm90b2NvbCBhY3Rpb24gKHRoZSBgb2JzaWRpYW46Ly9gIFwiaG9zdFwiIHBhcnQpLiAqL1xuZXhwb3J0IGNvbnN0IFBST1RPQ09MX0FDVElPTiA9ICd2YXVsdHN5bmNmb3JhZ2VudHMnO1xuXG4vKiogSGFuZGxlciBzaGFwZSAoT2JzaWRpYW4gcGFzc2VzIGl0cyBkZWNvZGVkIHF1ZXJ5IHBhcmFtcykuICovXG5leHBvcnQgdHlwZSBQcm90b2NvbEhhbmRsZXIgPSAocGFyYW1zOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikgPT4gdm9pZDtcblxuLyoqIEhvdyBoYW5kbGVycyBnZXQgcmVnaXN0ZXJlZCBcdTIwMTQgYFBsdWdpbi5yZWdpc3Rlck9ic2lkaWFuUHJvdG9jb2xIYW5kbGVyYC4gKi9cbmV4cG9ydCB0eXBlIFByb3RvY29sUmVnaXN0cmFyID0gKGFjdGlvbjogc3RyaW5nLCBoYW5kbGVyOiBQcm90b2NvbEhhbmRsZXIpID0+IHZvaWQ7XG5cbi8qKiBQYXJzZWQgcGFpciBkZWVwIGxpbmsuICovXG5leHBvcnQgaW50ZXJmYWNlIFBhaXJEZWVwTGluayB7XG4gIHVybDogc3RyaW5nO1xuICBjb2RlOiBzdHJpbmc7XG59XG5cbmV4cG9ydCB0eXBlIERlZXBMaW5rUGFyc2VSZXN1bHQgPVxuICB8IHsgb2s6IHRydWU7IGxpbms6IFBhaXJEZWVwTGluayB9XG4gIHwgeyBvazogZmFsc2U7IGVycm9yOiBzdHJpbmcgfTtcblxuLyoqXG4gKiBFeHRyYWN0IGB7dXJsLCBjb2RlfWAgZnJvbSBPYnNpZGlhbidzIGRlY29kZWQgcXVlcnkgcGFyYW1zLiBWYWx1ZXMgYXJyaXZlXG4gKiBhcyBzdHJpbmdzICh1c3VhbGx5IGFscmVhZHkgZGVjb2RlZDsgYSBkb3VibGUtZW5jb2RlZCBgJXh4YCByZW1uYW50IGlzXG4gKiBkZWNvZGVkIG9uY2UgbW9yZSwgYmVzdCBlZmZvcnQpLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VQYWlyRGVlcExpbmsocGFyYW1zOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IERlZXBMaW5rUGFyc2VSZXN1bHQge1xuICBjb25zdCB1cmwgPSBwYXJhbVRleHQocGFyYW1zLCAndXJsJyk7XG4gIGNvbnN0IGNvZGUgPSBwYXJhbVRleHQocGFyYW1zLCAnY29kZScpO1xuICBpZiAodXJsID09PSAnJyAmJiBjb2RlID09PSAnJykge1xuICAgIHJldHVybiB7IG9rOiBmYWxzZSwgZXJyb3I6ICdubyBwYWlyaW5nIHBhcmFtZXRlcnMnIH07XG4gIH1cbiAgaWYgKHVybCA9PT0gJycpIHJldHVybiB7IG9rOiBmYWxzZSwgZXJyb3I6ICdkZWVwIGxpbmsgaXMgbWlzc2luZyB0aGUgd29ya2VyIFVSTCAoP3VybD1cdTIwMjYpJyB9O1xuICBpZiAoY29kZSA9PT0gJycpIHJldHVybiB7IG9rOiBmYWxzZSwgZXJyb3I6ICdkZWVwIGxpbmsgaXMgbWlzc2luZyB0aGUgcGFpcmluZyBjb2RlICg/Y29kZT1cdTIwMjYpJyB9O1xuICByZXR1cm4geyBvazogdHJ1ZSwgbGluazogeyB1cmwsIGNvZGUgfSB9O1xufVxuXG5mdW5jdGlvbiBwYXJhbVRleHQocGFyYW1zOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwga2V5OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCB2YWx1ZSA9IHBhcmFtc1trZXldO1xuICBpZiAodHlwZW9mIHZhbHVlID09PSAnbnVtYmVyJykgcmV0dXJuIFN0cmluZyh2YWx1ZSk7XG4gIGlmICh0eXBlb2YgdmFsdWUgIT09ICdzdHJpbmcnKSByZXR1cm4gJyc7XG4gIGNvbnN0IHRyaW1tZWQgPSB2YWx1ZS50cmltKCk7XG4gIC8vIE9ic2lkaWFuIGhhbmRzIG92ZXIgZGVjb2RlZCB2YWx1ZXM7IHRvbGVyYXRlIG9uZSBzdXJ2aXZpbmcgcm91bmQgb2ZcbiAgLy8gcGVyY2VudC1lbmNvZGluZyBmcm9tIG92ZXItZWFnZXIgbGluayBnZW5lcmF0b3JzLlxuICBpZiAodHJpbW1lZC5pbmNsdWRlcygnJScpKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBkZWNvZGVVUklDb21wb25lbnQodHJpbW1lZCk7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gdHJpbW1lZDtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHRyaW1tZWQ7XG59XG5cbi8qKlxuICogUmVnaXN0ZXIgdGhlIHBhaXIgZGVlcC1saW5rIGhhbmRsZXIgKGNhbGwgZnJvbSBgb25sb2FkYCB3aXRoIHRoZSBwbHVnaW4nc1xuICogb3duIHJlZ2lzdHJhcikuIGBvblBhaXJgIHJ1bnMgdGhlIHNoYXJlZCBwYWlyIGZsb3cgKHNldHRpbmdzICsgTm90aWNlc1xuICogbGl2ZSBpbiB0aGUgcGx1Z2luKTsgaXRzIGVycm9ycyBhcmUgbG9nZ2VkLCBuZXZlciBmYXRhbC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlZ2lzdGVyUGFpclByb3RvY29sSGFuZGxlcihcbiAgcmVnaXN0ZXI6IFByb3RvY29sUmVnaXN0cmFyLFxuICBvblBhaXI6IChsaW5rOiBQYWlyRGVlcExpbmspID0+IFByb21pc2U8dm9pZD4sXG4pOiB2b2lkIHtcbiAgY29uc3QgaGFuZGxlcjogUHJvdG9jb2xIYW5kbGVyID0gKHBhcmFtcykgPT4ge1xuICAgIGNvbnN0IHBhcnNlZCA9IHBhcnNlUGFpckRlZXBMaW5rKHBhcmFtcyk7XG4gICAgaWYgKCFwYXJzZWQub2spIHtcbiAgICAgIC8vIE1pc3NpbmcgYm90aCBcdTIxOTIgYSBiYXJlIG9ic2lkaWFuOi8vdmF1bHRzeW5jZm9yYWdlbnRzIGhpdDsgc3RheSBxdWlldC5cbiAgICAgIGlmIChwYXJzZWQuZXJyb3IgIT09ICdubyBwYWlyaW5nIHBhcmFtZXRlcnMnKSB7XG4gICAgICAgIG5ldyBOb3RpY2UoYFZhdWx0U3luYyBkZWVwIGxpbms6ICR7cGFyc2VkLmVycm9yfWApO1xuICAgICAgfVxuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB2b2lkIG9uUGFpcihwYXJzZWQubGluaykuY2F0Y2goKGVycm9yOiB1bmtub3duKSA9PiB7XG4gICAgICBjb25zb2xlLmVycm9yKCdbdnNhXSBkZWVwLWxpbmsgcGFpcmluZyBmYWlsZWQnLCBlcnJvcik7XG4gICAgICBuZXcgTm90aWNlKCdWYXVsdFN5bmM6IHBhaXJpbmcgdmlhIGxpbmsgZmFpbGVkIFx1MjAxNCBzZWUgdGhlIGNvbnNvbGUgZm9yIGRldGFpbHMuJyk7XG4gICAgfSk7XG4gIH07XG4gIHJlZ2lzdGVyKFBST1RPQ09MX0FDVElPTiwgaGFuZGxlcik7XG4gIC8vIFJlZ2lzdGVyIHRoZSBwYXRoLXNwZWxsZWQgYWN0aW9uIHRvbyAoYnVpbGQtZGVwZW5kZW50IG1hdGNoaW5nKS5cbiAgcmVnaXN0ZXIoYCR7UFJPVE9DT0xfQUNUSU9OfS9wYWlyYCwgaGFuZGxlcik7XG59XG4iLCAiLyoqXG4gKiBSZWNvbm5lY3QgcG9saWN5IChwbHVnaW4gc2NvcGUgaXRlbSAjNSk6IGV4cG9uZW50aWFsIGJhY2tvZmYgd2l0aCBqaXR0ZXIsXG4gKiBjYXBwZWQgYXQgNjAgcy4gVGhlIHBsdWdpbidzIDEgcyBzdXBlcnZpc2lvbiB0aWNrIGFza3MgdGhlIHN1cGVydmlzb3Igd2hhdFxuICogdG8gZG8gd2hlbmV2ZXIgdGhlIGNsaWVudCByZXBvcnRzIGBkaXNjb25uZWN0ZWRgOyBhIHNjaGVkdWxlZCByZWNvbm5lY3QgaXNcbiAqIGEgc2luZ2xlIGZsaWdodCBcdTIwMTQgbmV2ZXIgYSBzdGFjayBvZiByZXRyaWVzLlxuICovXG5cbmltcG9ydCB0eXBlIHsgU3luY0NsaWVudFN0YXRlIH0gZnJvbSAnQHZzYS9jb3JlJztcblxuZXhwb3J0IGludGVyZmFjZSBCYWNrb2ZmT3B0aW9ucyB7XG4gIC8qKiBGaXJzdCBhdHRlbXB0IGRlbGF5IChkZWZhdWx0IDEgcykuICovXG4gIGJhc2VNcz86IG51bWJlcjtcbiAgLyoqIENlaWxpbmcgKGRlZmF1bHQgNjAgcyBwZXIgdGhlIHBsdWdpbiBzcGVjKS4gKi9cbiAgY2FwTXM/OiBudW1iZXI7XG4gIC8qKiBKaXR0ZXIgZnJhY3Rpb24gYXJvdW5kIHRoZSBleHBvbmVudGlhbCB2YWx1ZSwgMFx1MjAxMzAuNSAoZGVmYXVsdCAwLjMpLiAqL1xuICBqaXR0ZXI/OiBudW1iZXI7XG4gIC8qKiBJbmplY3RhYmxlIHJhbmRvbW5lc3MgKHRlc3RzKS4gRGVmYXVsdCBgTWF0aC5yYW5kb21gLiAqL1xuICByYW5kb20/OiAoKSA9PiBudW1iZXI7XG59XG5cbmV4cG9ydCBjb25zdCBERUZBVUxUX1JFQ09OTkVDVF9CQVNFX01TID0gMTAwMDtcbmV4cG9ydCBjb25zdCBERUZBVUxUX1JFQ09OTkVDVF9DQVBfTVMgPSA2MF8wMDA7XG5cbi8qKlxuICogRGVsYXkgZm9yIGF0dGVtcHQgTiAoMC1iYXNlZCk6IGBtaW4oY2FwLCBiYXNlIFx1MDBCNyAyXmF0dGVtcHQpYCB3aXRoIHN5bW1ldHJpY1xuICogbXVsdGlwbGljYXRpdmUgaml0dGVyLCBmbG9vcmVkIGF0IDI1MCBtcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJhY2tvZmZEZWxheU1zKGF0dGVtcHQ6IG51bWJlciwgb3B0aW9uczogQmFja29mZk9wdGlvbnMgPSB7fSk6IG51bWJlciB7XG4gIGNvbnN0IGJhc2UgPSBvcHRpb25zLmJhc2VNcyA/PyBERUZBVUxUX1JFQ09OTkVDVF9CQVNFX01TO1xuICBjb25zdCBjYXAgPSBvcHRpb25zLmNhcE1zID8/IERFRkFVTFRfUkVDT05ORUNUX0NBUF9NUztcbiAgY29uc3Qgaml0dGVyID0gb3B0aW9ucy5qaXR0ZXIgPz8gMC4zO1xuICBjb25zdCByYW5kb20gPSBvcHRpb25zLnJhbmRvbSA/PyBNYXRoLnJhbmRvbTtcbiAgY29uc3QgZXhwb25lbnRpYWwgPSBNYXRoLm1pbihjYXAsIGJhc2UgKiAyICoqIGF0dGVtcHQpO1xuICBjb25zdCBmYWN0b3IgPSAxICsgKHJhbmRvbSgpICogMiAtIDEpICogaml0dGVyO1xuICByZXR1cm4gTWF0aC5yb3VuZChNYXRoLm1pbihjYXAsIE1hdGgubWF4KDI1MCwgZXhwb25lbnRpYWwgKiBmYWN0b3IpKSk7XG59XG5cbmV4cG9ydCB0eXBlIFJlY29ubmVjdERlY2lzaW9uID0geyBhY3Rpb246ICdyZWNvbm5lY3QnOyBkZWxheU1zOiBudW1iZXIgfSB8IHsgYWN0aW9uOiAnd2FpdCcgfTtcblxuLyoqXG4gKiBUcmFja3MgcmVjb25uZWN0IGF0dGVtcHRzIGFjcm9zcyB0aGUgc3VwZXJ2aXNpb24gdGljay4gTm9uLWRpc2Nvbm5lY3RlZFxuICogc3RhdGVzIHJlc2V0IHRoZSBiYWNrb2ZmIGxhZGRlciAoYSBzdWNjZXNzZnVsIGN5Y2xlIG1lYW5zIHRoZSBuZXR3b3JrIGlzXG4gKiBiYWNrKTsgYHNjaGVkdWxlZGAga2VlcHMgZXhhY3RseSBvbmUgcmVjb25uZWN0IGluIGZsaWdodC5cbiAqL1xuZXhwb3J0IGNsYXNzIFJlY29ubmVjdFN1cGVydmlzb3Ige1xuICBwcml2YXRlIGF0dGVtcHQgPSAwO1xuICBwcml2YXRlIHNjaGVkdWxlZCA9IGZhbHNlO1xuICBwcml2YXRlIHJlYWRvbmx5IG9wdGlvbnM6IEJhY2tvZmZPcHRpb25zO1xuXG4gIGNvbnN0cnVjdG9yKG9wdGlvbnM6IEJhY2tvZmZPcHRpb25zID0ge30pIHtcbiAgICB0aGlzLm9wdGlvbnMgPSBvcHRpb25zO1xuICB9XG5cbiAgLyoqIENhbGwgZWFjaCB0aWNrOyBvbiBgcmVjb25uZWN0YCwgZm9sbG93IHVwIHdpdGggYGFja25vd2xlZGdlZCgpYC4gKi9cbiAgY29uc2lkZXIoc3RhdGU6IFN5bmNDbGllbnRTdGF0ZSk6IFJlY29ubmVjdERlY2lzaW9uIHtcbiAgICBpZiAoc3RhdGUgIT09ICdkaXNjb25uZWN0ZWQnKSB7XG4gICAgICB0aGlzLmF0dGVtcHQgPSAwO1xuICAgICAgdGhpcy5zY2hlZHVsZWQgPSBmYWxzZTtcbiAgICAgIHJldHVybiB7IGFjdGlvbjogJ3dhaXQnIH07XG4gICAgfVxuICAgIGlmICh0aGlzLnNjaGVkdWxlZCkgcmV0dXJuIHsgYWN0aW9uOiAnd2FpdCcgfTtcbiAgICByZXR1cm4geyBhY3Rpb246ICdyZWNvbm5lY3QnLCBkZWxheU1zOiBiYWNrb2ZmRGVsYXlNcyh0aGlzLmF0dGVtcHQsIHRoaXMub3B0aW9ucykgfTtcbiAgfVxuXG4gIC8qKiBNYXJrIHRoZSByZXR1cm5lZCByZWNvbm5lY3QgYXMgaW4gZmxpZ2h0IChvbmUgYXQgYSB0aW1lKS4gKi9cbiAgYWNrbm93bGVkZ2VkKCk6IHZvaWQge1xuICAgIHRoaXMuYXR0ZW1wdCArPSAxO1xuICAgIHRoaXMuc2NoZWR1bGVkID0gdHJ1ZTtcbiAgfVxuXG4gIC8qKiBUaGUgaW4tZmxpZ2h0IHJlY29ubmVjdCBzZXR0bGVkIChzdWNjZXNzIG9yIGZhaWx1cmUpLiAqL1xuICBzZXR0bGVkKCk6IHZvaWQge1xuICAgIHRoaXMuc2NoZWR1bGVkID0gZmFsc2U7XG4gIH1cblxuICAvKiogQ29tcGxldGVkIHJlY29ubmVjdCBhdHRlbXB0cyBzaW5jZSB0aGUgbGFzdCBoZWFsdGh5IHN0YXRlLiAqL1xuICBnZXQgYXR0ZW1wdHMoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy5hdHRlbXB0O1xuICB9XG59XG4iLCAiLyoqXG4gKiBUaGUgc2V0dGluZ3MgdGFiIChwbHVnaW4gc2NvcGUgaXRlbSAjNiksIG9yZ2FuaXplZCBpbiBmb3VyIHNlY3Rpb25zOlxuICpcbiAqICAgQ29ubmVjdGlvbiBcdTIwMTQgd29ya2VyIFVSTCwgZGV2aWNlIG5hbWUgKHBhaXJpbmctdGltZSBPUiByZW5hbWUgd2hlblxuICogICAgICAgICAgICAgICAgbGlua2VkKSwgcGFpcmluZyBmb3JtIC8gc3RhdHVzIHJlYWRvdXQgKyBTeW5jIG5vdyArIHVubGlua1xuICogICBTeW5jICAgICAgIFx1MjAxNCByZXNjYW4gaW50ZXJ2YWwsIC5vYnNpZGlhbi8gdG9nZ2xlLCBwYXVzZS9yZXN1bWUsXG4gKiAgICAgICAgICAgICAgICBzeW5jLW9uLXN0YXJ0dXBcbiAqICAgQWR2YW5jZWQgICBcdTIwMTQgc3RhdHVzLWJhciBpbmRpY2F0b3IgbW9kZSwgaWdub3JlIHBhdHRlcm5zLCBkaWFnbm9zdGljc1xuICogICAgICAgICAgICAgICAgKGxvZyBsZXZlbCArIENvcHkgZGlhZ25vc3RpY3MgKyBTYXZlIHN1cHBvcnQgYnVuZGxlKVxuICogICBBYm91dCAgICAgIFx1MjAxNCB2ZXJzaW9ucywgc3RvcmFnZSB1c2FnZSwgcHJvamVjdCBSRUFETUUgbGlua1xuICpcbiAqIEFsbCBsb2dpYyBsaXZlcyBvbiBgVmF1bHRTeW5jUGx1Z2luYDsgdGhlIHRhYiBpcyBwcmVzZW50YXRpb24gcGx1cyB3aXJpbmcuXG4gKi9cblxuaW1wb3J0IHsgTW9kYWwsIE5vdGljZSwgUGx1Z2luU2V0dGluZ1RhYiwgU2V0dGluZyB9IGZyb20gJ29ic2lkaWFuJztcbmltcG9ydCB0eXBlIHsgQXBwIH0gZnJvbSAnb2JzaWRpYW4nO1xuaW1wb3J0IHtcbiAgZGVmYXVsdERldmljZU5hbWUsXG4gIFJFU0NBTl9JTlRFUlZBTF9DSE9JQ0VTLFxuICB0eXBlIExvZ0xldmVsLFxuICB0eXBlIFZhdWx0U3luY1BsdWdpbkRhdGEsXG59IGZyb20gJy4vZGF0YS5qcyc7XG5pbXBvcnQgdHlwZSB7IFBhaXJPdXRjb21lIH0gZnJvbSAnLi9wYWlyaW5nLmpzJztcbmltcG9ydCB7IHBhaXJPdXRjb21lTWVzc2FnZSB9IGZyb20gJy4vcGFpcmluZy5qcyc7XG5pbXBvcnQgeyBmb3JtYXRCeXRlcywgUFJPVE9DT0xfVkVSU0lPTiB9IGZyb20gJy4vZGlhZ25vc3RpY3MuanMnO1xuaW1wb3J0IHsgZm9ybWF0U2luY2UgfSBmcm9tICcuL3N0YXR1c2Jhci5qcyc7XG5pbXBvcnQgdHlwZSB7IFZhdWx0U3luY1BsdWdpbiB9IGZyb20gJy4vcGx1Z2luLmpzJztcblxuLyoqXG4gKiBDbG91ZGZsYXJlIERlcGxveSBCdXR0b24gdGFyZ2V0IChGUi0yMSk6IHByb3Zpc2lvbnMgYSBwcmVjb25maWd1cmVkIHdvcmtlclxuICogKyBEdXJhYmxlIE9iamVjdCArIFIyIGJ1Y2tldCBpbiB0aGUgdXNlcidzIG93biBhY2NvdW50IFx1MjAxNCBubyB3cmFuZ2xlciwgbm9cbiAqIG1hbnVhbCBjb25maWcuIFRoZSB0ZW1wbGF0ZSByZXBvIHBpbnMgYSByZWxlYXNlZCB3b3JrZXIgdmVyc2lvbi5cbiAqL1xuZXhwb3J0IGNvbnN0IERFUExPWV9VUkwgPVxuICAnaHR0cHM6Ly9kZXBsb3kud29ya2Vycy5jbG91ZGZsYXJlLmNvbS8/dXJsPScgK1xuICAnaHR0cHM6Ly9naXRodWIuY29tL2FudWNoaW4vdmF1bHRzeW5jZm9yYWdlbnRzLXRlbXBsYXRlJztcblxuLyoqIFRoZSBwcm9qZWN0IFJFQURNRSAodGhlIEFib3V0IHNlY3Rpb24ncyBsaW5rKS4gKi9cbmV4cG9ydCBjb25zdCBQUk9KRUNUX1JFQURNRV9VUkwgPSAnaHR0cHM6Ly9naXRodWIuY29tL2FudWNoaW4vdmF1bHRzeW5jZm9yYWdlbnRzI3JlYWRtZSc7XG5cbi8qKiBPcGVuIHRoZSBkZXBsb3kgcGFnZSBpbiB0aGUgc3lzdGVtIGJyb3dzZXIgKG5vLW9wIHdoZXJlIGB3aW5kb3dgIGlzIGFic2VudCkuICovXG5leHBvcnQgZnVuY3Rpb24gb3BlbkRlcGxveVBhZ2UoKTogdm9pZCB7XG4gIGlmICh0eXBlb2Ygd2luZG93ID09PSAndW5kZWZpbmVkJykgcmV0dXJuO1xuICB3aW5kb3cub3BlbihERVBMT1lfVVJMLCAnX2JsYW5rJyk7XG59XG5cbi8qKiBPcGVuIHRoZSBwcm9qZWN0IFJFQURNRSBpbiB0aGUgc3lzdGVtIGJyb3dzZXIgKG5vLW9wIHdpdGhvdXQgYHdpbmRvd2ApLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG9wZW5SZWFkbWVQYWdlKCk6IHZvaWQge1xuICBpZiAodHlwZW9mIHdpbmRvdyA9PT0gJ3VuZGVmaW5lZCcpIHJldHVybjtcbiAgd2luZG93Lm9wZW4oUFJPSkVDVF9SRUFETUVfVVJMLCAnX2JsYW5rJyk7XG59XG5cbi8qKiBTbWFsbCBjb25maXJtYXRpb24gZGlhbG9nICh0aGUgdW5saW5rIGJ1dHRvbidzIHNhZmV0eSBuZXQpLiAqL1xuZXhwb3J0IGNsYXNzIENvbmZpcm1Nb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgY29uc3RydWN0b3IoXG4gICAgYXBwOiBBcHAsXG4gICAgcHJpdmF0ZSByZWFkb25seSBvcHRpb25zOiB7XG4gICAgICB0aXRsZTogc3RyaW5nO1xuICAgICAgYm9keTogc3RyaW5nO1xuICAgICAgY29uZmlybVRleHQ6IHN0cmluZztcbiAgICAgIG9uQ29uZmlybTogKCkgPT4gdm9pZCB8IFByb21pc2U8dm9pZD47XG4gICAgfSxcbiAgKSB7XG4gICAgc3VwZXIoYXBwKTtcbiAgfVxuXG4gIG92ZXJyaWRlIG9uT3BlbigpOiB2b2lkIHtcbiAgICBuZXcgU2V0dGluZyh0aGlzLmNvbnRlbnRFbCkuc2V0TmFtZSh0aGlzLm9wdGlvbnMudGl0bGUpLnNldERlc2ModGhpcy5vcHRpb25zLmJvZHkpO1xuICAgIG5ldyBTZXR0aW5nKHRoaXMuY29udGVudEVsKS5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KCdDYW5jZWwnKS5vbkNsaWNrKCgpID0+IHRoaXMuY2xvc2UoKSksXG4gICAgKTtcbiAgICBuZXcgU2V0dGluZyh0aGlzLmNvbnRlbnRFbCkuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICBidXR0b25cbiAgICAgICAgLnNldEN0YSgpXG4gICAgICAgIC5zZXRCdXR0b25UZXh0KHRoaXMub3B0aW9ucy5jb25maXJtVGV4dClcbiAgICAgICAgLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICAgICAgICBhd2FpdCB0aGlzLm9wdGlvbnMub25Db25maXJtKCk7XG4gICAgICAgIH0pLFxuICAgICk7XG4gIH1cbn1cblxuZXhwb3J0IGNsYXNzIFZhdWx0U3luY1NldHRpbmdUYWIgZXh0ZW5kcyBQbHVnaW5TZXR0aW5nVGFiIHtcbiAgcHJpdmF0ZSByZWFkb25seSBwbHVnaW46IFZhdWx0U3luY1BsdWdpbjtcbiAgLyoqIFBhaXJpbmcgY29kZXMgbmV2ZXIgdG91Y2ggZGlzayBcdTIwMTQgdGhleSBhcmUgb25lLXRpbWUsIHNob3J0LWxpdmVkIHNlY3JldHMuICovXG4gIHByaXZhdGUgcGFpcmluZ0NvZGUgPSAnJztcbiAgLyoqXG4gICAqIExpbmtlZC1tb2RlIGRldmljZS1uYW1lIGRyYWZ0OiBlZGl0cyBzdGFnZSBoZXJlIChOT1QgaW4gcGx1Z2luIGRhdGEpIHNvIGFcbiAgICogZmFpbGVkIHJlbmFtZSBjYW5ub3QgbGVhdmUgdGhlIGxvY2FsIG5hbWUgb3V0IG9mIHN5bmMgd2l0aCB0aGUgd29ya2VyLlxuICAgKi9cbiAgcHJpdmF0ZSByZW5hbWVEcmFmdDogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgaGludFNldHRpbmc6IFNldHRpbmcgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBzdGF0dXNTZXR0aW5nOiBTZXR0aW5nIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgc3RvcmFnZVNldHRpbmc6IFNldHRpbmcgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBzZXJ2ZXJWZXJzaW9uU2V0dGluZzogU2V0dGluZyB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHJlZnJlc2hIYW5kbGU6IFJldHVyblR5cGU8dHlwZW9mIHNldEludGVydmFsPiB8IG51bGwgPSBudWxsO1xuXG4gIGNvbnN0cnVjdG9yKGFwcDogQXBwLCBwbHVnaW46IFZhdWx0U3luY1BsdWdpbikge1xuICAgIHN1cGVyKGFwcCwgcGx1Z2luKTtcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcbiAgfVxuXG4gIG92ZXJyaWRlIGRpc3BsYXkoKTogdm9pZCB7XG4gICAgdGhpcy5zdG9wUmVmcmVzaCgpO1xuICAgIGNvbnN0IHsgY29udGFpbmVyRWwgfSA9IHRoaXM7XG4gICAgY29udGFpbmVyRWwuZW1wdHkoKTtcbiAgICB0aGlzLmhpbnRTZXR0aW5nID0gbnVsbDtcbiAgICB0aGlzLnN0YXR1c1NldHRpbmcgPSBudWxsO1xuICAgIHRoaXMuc3RvcmFnZVNldHRpbmcgPSBudWxsO1xuICAgIHRoaXMuc2VydmVyVmVyc2lvblNldHRpbmcgPSBudWxsO1xuICAgIHRoaXMucmVuYW1lRHJhZnQgPSBudWxsO1xuXG4gICAgdGhpcy5yZW5kZXJDb25uZWN0aW9uU2VjdGlvbigpO1xuICAgIHRoaXMucmVuZGVyU3luY1NlY3Rpb24oKTtcbiAgICB0aGlzLnJlbmRlckFkdmFuY2VkU2VjdGlvbigpO1xuICAgIHRoaXMucmVuZGVyQWJvdXRTZWN0aW9uKCk7XG4gICAgdGhpcy5zdGFydFJlZnJlc2goKTtcbiAgfVxuXG4gIG92ZXJyaWRlIGhpZGUoKTogdm9pZCB7XG4gICAgdGhpcy5zdG9wUmVmcmVzaCgpO1xuICB9XG5cbiAgLy8gLS0tIHNlY3Rpb25zIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgcHJpdmF0ZSBoZWFkaW5nKHRleHQ6IHN0cmluZyk6IHZvaWQge1xuICAgIG5ldyBTZXR0aW5nKHRoaXMuY29udGFpbmVyRWwpLnNldE5hbWUodGV4dCkuc2V0SGVhZGluZygpO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJDb25uZWN0aW9uU2VjdGlvbigpOiB2b2lkIHtcbiAgICBjb25zdCB7IGNvbnRhaW5lckVsIH0gPSB0aGlzO1xuICAgIHRoaXMuaGVhZGluZygnQ29ubmVjdGlvbicpO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnV29ya2VyIFVSTCcpXG4gICAgICAuc2V0RGVzYyhcbiAgICAgICAgJ1lvdXIgc3luYyB3b3JrZXIsIGUuZy4gaHR0cHM6Ly9wZXJzb25hbC54LndvcmtlcnMuZGV2LiBObyB3b3JrZXIgeWV0PyBVc2UgXCJEZXBsb3kgeW91ciB3b3JrZXJcIiBiZWxvdywgb3BlbiB0aGUgVVJMIGluIGEgYnJvd3NlciwgYW5kIGNsYWltIGl0LicsXG4gICAgICApXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT5cbiAgICAgICAgdGV4dFxuICAgICAgICAgIC5zZXRQbGFjZWhvbGRlcignaHR0cHM6Ly9wZXJzb25hbC54LndvcmtlcnMuZGV2JylcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uZGF0YS51cmwpXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4uZGF0YS51cmwgPSB2YWx1ZS50cmltKCk7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlUGx1Z2luRGF0YSgpO1xuICAgICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIGlmICh0aGlzLnBsdWdpbi5saW5rZWQpIHtcbiAgICAgIHRoaXMucmVuZGVyTGlua2VkRGV2aWNlTmFtZSgpO1xuICAgICAgdGhpcy5yZW5kZXJMaW5rZWRTdGF0dXMoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5yZW5kZXJQYWlyaW5nRGV2aWNlTmFtZSgpO1xuICAgICAgdGhpcy5yZW5kZXJQYWlyaW5nU2VjdGlvbigpO1xuICAgIH1cbiAgfVxuXG4gIC8qKiBVbmxpbmtlZDogdGhlIG5hbWUgaXMgYSBwYWlyaW5nLXRpbWUgZGVmYXVsdCAoYXBwbGllcyBhdCBuZXh0IHBhaXIpLiAqL1xuICBwcml2YXRlIHJlbmRlclBhaXJpbmdEZXZpY2VOYW1lKCk6IHZvaWQge1xuICAgIG5ldyBTZXR0aW5nKHRoaXMuY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnRGV2aWNlIG5hbWUnKVxuICAgICAgLnNldERlc2MoYFNob3duIGluIHRoZSB3b3JrZXIgZGFzaGJvYXJkJ3MgZGV2aWNlIGxpc3QuIEFwcGxpZXMgd2hlbiAocmUpcGFpcmluZy5gKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHRcbiAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoZGVmYXVsdERldmljZU5hbWUoKSlcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uZGF0YS5kZXZpY2VOYW1lKVxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLmRhdGEuZGV2aWNlTmFtZSA9IHZhbHVlLnRyaW0oKTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVQbHVnaW5EYXRhKCk7XG4gICAgICAgICAgfSksXG4gICAgICApO1xuICB9XG5cbiAgLyoqIExpbmtlZDogdGhlIGZpZWxkIHNob3dzIHRoZSBjdXJyZW50IG5hbWU7IFJlbmFtZSBwdXNoZXMgaXQgdG8gdGhlIHdvcmtlci4gKi9cbiAgcHJpdmF0ZSByZW5kZXJMaW5rZWREZXZpY2VOYW1lKCk6IHZvaWQge1xuICAgIGNvbnN0IGN1cnJlbnQgPSB0aGlzLnJlbmFtZURyYWZ0ID8/IHRoaXMucGx1Z2luLmRhdGEuZGV2aWNlTmFtZTtcbiAgICBuZXcgU2V0dGluZyh0aGlzLmNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ0RldmljZSBuYW1lJylcbiAgICAgIC5zZXREZXNjKFxuICAgICAgICAnVGhlIHdvcmtlciBkYXNoYm9hcmQgc2hvd3MgdGhpcyBuYW1lLiBFZGl0IGl0IGFuZCBwcmVzcyBcIlJlbmFtZSBkZXZpY2VcIiB0byB1cGRhdGUgdGhpcyBkZXZpY2Ugb24gdGhlIHdvcmtlciAoMS0zMCBjaGFyYWN0ZXJzKS4nLFxuICAgICAgKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHRcbiAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoZGVmYXVsdERldmljZU5hbWUoKSlcbiAgICAgICAgICAuc2V0VmFsdWUoY3VycmVudClcbiAgICAgICAgICAub25DaGFuZ2UoKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnJlbmFtZURyYWZ0ID0gdmFsdWU7XG4gICAgICAgICAgfSksXG4gICAgICApXG4gICAgICAuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KCdSZW5hbWUgZGV2aWNlJykub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgYnV0dG9uLnNldERpc2FibGVkKHRydWUpO1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBvayA9IGF3YWl0IHRoaXMucGx1Z2luLnJlbmFtZURldmljZSh0aGlzLnJlbmFtZURyYWZ0ID8/IHRoaXMucGx1Z2luLmRhdGEuZGV2aWNlTmFtZSk7XG4gICAgICAgICAgICBpZiAob2spIHRoaXMuZGlzcGxheSgpOyAvLyByZS1yZW5kZXIgd2l0aCB0aGUgcGVyc2lzdGVkIG5hbWVcbiAgICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgICAgYnV0dG9uLnNldERpc2FibGVkKGZhbHNlKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pLFxuICAgICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyUGFpcmluZ1NlY3Rpb24oKTogdm9pZCB7XG4gICAgY29uc3QgeyBjb250YWluZXJFbCB9ID0gdGhpcztcbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdQYWlyaW5nIGNvZGUnKVxuICAgICAgLnNldERlc2MoJ0Zyb20geW91ciB3b3JrZXIgZGFzaGJvYXJkOiBEZXZpY2VzIFx1MjE5MiBQYWlyIG5ldyBkZXZpY2UuIENvZGVzIGFyZSBvbmUtdGltZSBhbmQgZXhwaXJlIGFmdGVyIDEwIG1pbnV0ZXMuJylcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PlxuICAgICAgICB0ZXh0XG4gICAgICAgICAgLnNldFBsYWNlaG9sZGVyKCc3RjNLLVE5TTInKVxuICAgICAgICAgIC5vbkNoYW5nZSgodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMucGFpcmluZ0NvZGUgPSB2YWx1ZS50cmltKCk7XG4gICAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgYnV0dG9uXG4gICAgICAgIC5zZXRDdGEoKVxuICAgICAgICAuc2V0QnV0dG9uVGV4dCgnUGFpciB0aGlzIHZhdWx0JylcbiAgICAgICAgLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGJ1dHRvbi5zZXREaXNhYmxlZCh0cnVlKTtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3Qgb3V0Y29tZSA9IGF3YWl0IHRoaXMucGx1Z2luLnBhaXJGcm9tU2V0dGluZ3ModGhpcy5wYWlyaW5nQ29kZSk7XG4gICAgICAgICAgICB0aGlzLnNob3dPdXRjb21lKG91dGNvbWUpO1xuICAgICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICBidXR0b24uc2V0RGlzYWJsZWQoZmFsc2UpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSksXG4gICAgKTtcblxuICAgIHRoaXMuaGludFNldHRpbmcgPSBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdHZXR0aW5nIHN0YXJ0ZWQnKVxuICAgICAgLnNldENsYXNzKCd2c2Etc2V0dGluZ3MtaGludCcpXG4gICAgICAuc2V0RGVzYyhcbiAgICAgICAgW1xuICAgICAgICAgICcxLiBEZXBsb3kgeW91ciBvd24gd29ya2VyIHdpdGggdGhlIGJ1dHRvbiBiZWxvdyAoeW91ciBDbG91ZGZsYXJlIGFjY291bnQsIHByZWNvbmZpZ3VyZWQgXHUyMDE0IG5vIHdyYW5nbGVyKS4nLFxuICAgICAgICAgICcyLiBPcGVuIHRoZSB3b3JrZXIgVVJMIGluIGEgYnJvd3NlciBhbmQgc2V0IHRoZSBhZG1pbiBwYXNzcGhyYXNlIChjbGFpbSkuJyxcbiAgICAgICAgICAnMy4gQ3JlYXRlIGEgcGFpcmluZyBjb2RlIG9uIHRoZSBkYXNoYm9hcmQsIHBhc3RlIGl0IGFib3ZlLCBhbmQgcGFpci4nLFxuICAgICAgICAgICdPbiBhIHBob25lLCBzY2FubmluZyB0aGUgZGFzaGJvYXJkIFFSIG9yIHRhcHBpbmcgaXRzIG9ic2lkaWFuOi8vIGxpbmsgcGFpcnMgd2l0aG91dCB0eXBpbmcuJyxcbiAgICAgICAgXS5qb2luKCdcXG4nKSxcbiAgICAgIClcbiAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoJ0RlcGxveSB5b3VyIHdvcmtlcicpLm9uQ2xpY2soKCkgPT4gb3BlbkRlcGxveVBhZ2UoKSksXG4gICAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJMaW5rZWRTdGF0dXMoKTogdm9pZCB7XG4gICAgY29uc3QgeyBjb250YWluZXJFbCB9ID0gdGhpcztcblxuICAgIHRoaXMuc3RhdHVzU2V0dGluZyA9IG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ1N0YXR1cycpXG4gICAgICAuc2V0Q2xhc3MoJ3ZzYS1zdGF0dXMtcmVhZG91dCcpXG4gICAgICAuc2V0RGVzYyh0aGlzLnN0YXR1c1RleHQoKSk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbCkuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICBidXR0b24uc2V0QnV0dG9uVGV4dCgnU3luYyBub3cnKS5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgYnV0dG9uLnNldERpc2FibGVkKHRydWUpO1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnN5bmNOb3coKTtcbiAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICBidXR0b24uc2V0RGlzYWJsZWQoZmFsc2UpO1xuICAgICAgICAgIHRoaXMucmVmcmVzaFN0YXR1cygpO1xuICAgICAgICB9XG4gICAgICB9KSxcbiAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoJ1VubGluayB0aGlzIHZhdWx0Jykub25DbGljaygoKSA9PiB7XG4gICAgICAgIG5ldyBDb25maXJtTW9kYWwodGhpcy5hcHAsIHtcbiAgICAgICAgICB0aXRsZTogJ1VubGluayBWYXVsdFN5bmM/JyxcbiAgICAgICAgICBib2R5OiAnVGhpcyBzdG9wcyBzeW5jaW5nIGFuZCBjbGVhcnMgdGhpcyBkZXZpY2VcXHUyMDE5cyBsb2NhbCBzeW5jIHN0YXRlLiBGaWxlcyBhbHJlYWR5IGluIHRoZSB2YXVsdCBhcmUgdW50b3VjaGVkLiBUaGUgd29ya2VyIGtlZXBzIHRoaXMgZGV2aWNlIGluIGl0cyByZWdpc3RyeSBcXHUyMDE0IHJldm9rZSBpdCBmcm9tIHRoZSBkYXNoYm9hcmQgaWYgeW91IGFyZSBkb25lIHdpdGggaXQuJyxcbiAgICAgICAgICBjb25maXJtVGV4dDogJ1VubGluaycsXG4gICAgICAgICAgb25Db25maXJtOiBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi51bmxpbmsoKTtcbiAgICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgICAgIH0sXG4gICAgICAgIH0pLm9wZW4oKTtcbiAgICAgIH0pLFxuICAgICk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlclN5bmNTZWN0aW9uKCk6IHZvaWQge1xuICAgIGNvbnN0IHsgY29udGFpbmVyRWwgfSA9IHRoaXM7XG4gICAgY29uc3QgZGF0YSA9IHRoaXMucGx1Z2luLmRhdGE7XG4gICAgdGhpcy5oZWFkaW5nKCdTeW5jJyk7XG5cbiAgICBpZiAodGhpcy5wbHVnaW4ubGlua2VkKSB7XG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUoJ1Jlc2NhbiBpbnRlcnZhbCcpXG4gICAgICAgIC5zZXREZXNjKFxuICAgICAgICAgICdQZXJpb2RpYyBmdWxsIHJlY29uY2lsaWF0aW9uIFx1MjAxNCBjYXRjaGVzIGV4dGVybmFsIGVkaXRzIHdoaWxlIE9ic2lkaWFuIGlzIG9wZW4gYW5kIGNvdmVycyBtb2JpbGUgYmFja2dyb3VuZCBsaW1pdHMuIFZhdWx0IGV2ZW50cyBhbmQgYXBwLW9wZW4gc3luYyBhbHdheXMgcnVuLicsXG4gICAgICAgIClcbiAgICAgICAgLmFkZERyb3Bkb3duKChkcm9wZG93bikgPT4ge1xuICAgICAgICAgIGZvciAoY29uc3QgY2hvaWNlIG9mIFJFU0NBTl9JTlRFUlZBTF9DSE9JQ0VTKSB7XG4gICAgICAgICAgICBkcm9wZG93bi5hZGRPcHRpb24oU3RyaW5nKGNob2ljZS52YWx1ZSksIGNob2ljZS5sYWJlbCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGRyb3Bkb3duLnNldFZhbHVlKFN0cmluZyhkYXRhLnNldHRpbmdzLnJlc2NhbkludGVydmFsU2VjKSk7XG4gICAgICAgICAgZHJvcGRvd24ub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5hcHBseVJlc2NhbkludGVydmFsKE51bWJlcih2YWx1ZSkpO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKCdTeW5jIC5vYnNpZGlhbi8gZm9sZGVyJylcbiAgICAgICAgLnNldERlc2MoXG4gICAgICAgICAgJ09wdCBpbiB0byBzeW5jaW5nIC5vYnNpZGlhbi8gKHNldHRpbmdzIGFuZCBwbHVnaW5zKSwgZXhjbHVkaW5nIHdvcmtzcGFjZS5qc29uIGFuZCBjYWNoZXMuICcgK1xuICAgICAgICAgICAgJ1RoZSB3b3JrZXJcXHUyMDE5cyBwZXItdmF1bHQgc2V0dGluZyB0YWtlcyBwcmVjZWRlbmNlIG9uY2UgY29ubmVjdGVkLicsXG4gICAgICAgIClcbiAgICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICAgIHRvZ2dsZS5zZXRWYWx1ZShkYXRhLnNldHRpbmdzLm9ic2lkaWFuU3luYykub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5hcHBseU9ic2lkaWFuU3luYyh2YWx1ZSk7XG4gICAgICAgICAgfSksXG4gICAgICAgICk7XG5cbiAgICAgIGNvbnN0IHBhdXNlZCA9IHRoaXMucGx1Z2luLnN5bmNpbmdQYXVzZWQ7XG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUocGF1c2VkID8gJ1N5bmNpbmcgcGF1c2VkJyA6ICdQYXVzZSBzeW5jaW5nJylcbiAgICAgICAgLnNldERlc2MoXG4gICAgICAgICAgcGF1c2VkXG4gICAgICAgICAgICA/ICdTeW5jaW5nIGlzIHBhdXNlZDogdGhlIGNvbm5lY3Rpb24gaXMgZG93biBhbmQgdmF1bHQgY2hhbmdlcyBzdGF5IGxvY2FsLiBSZXN1bWUgcmVjb25uZWN0cyBhbmQgcnVucyBhIGZ1bGwgY2F0Y2gtdXAgc3luYy4nXG4gICAgICAgICAgICA6ICdUZW1wb3JhcmlseSBzdG9wIHN5bmNpbmcgd2l0aG91dCB1bmxpbmtpbmcgXHUyMDE0IHRoZSB0cmFuc3BvcnQgZGlzY29ubmVjdHMgYW5kIHRoZSB3YXRjaGVyIGdvZXMgaWRsZS4gWW91ciBsaW5rIGFuZCBsb2NhbCBzdGF0ZSBhcmUga2VwdC4nLFxuICAgICAgICApXG4gICAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgICBidXR0b25cbiAgICAgICAgICAgIC5zZXRCdXR0b25UZXh0KHBhdXNlZCA/ICdSZXN1bWUgc3luY2luZycgOiAnUGF1c2Ugc3luY2luZycpXG4gICAgICAgICAgICAub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICAgIGJ1dHRvbi5zZXREaXNhYmxlZCh0cnVlKTtcbiAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBpZiAocGF1c2VkKSBhd2FpdCB0aGlzLnBsdWdpbi5yZXN1bWVTeW5jaW5nKCk7XG4gICAgICAgICAgICAgICAgZWxzZSB0aGlzLnBsdWdpbi5wYXVzZVN5bmNpbmcoKTtcbiAgICAgICAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICAgICAgICB0aGlzLmRpc3BsYXkoKTsgLy8gcmUtcmVuZGVyOiB0aGUgYnV0dG9uIChhbmQgbGFiZWwpIGZsaXBcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSksXG4gICAgICAgICk7XG4gICAgfVxuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnU3luYyBvbiBzdGFydHVwJylcbiAgICAgIC5zZXREZXNjKFxuICAgICAgICAnT04gKGRlZmF1bHQpOiBzeW5jIHN0YXJ0cyBhcyBzb29uIGFzIE9ic2lkaWFuIG9wZW5zLiBPRkY6IHRoZSBwbHVnaW4gbG9hZHMgaWRsZSBhbmQgdGhlIGZpcnN0IFwiU3luYyBub3dcIiBwcmVzcyBzdGFydHMgc3luY2luZyAobWFudWFsLW9ubHkgbW9kZSkuJyxcbiAgICAgIClcbiAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgdG9nZ2xlLnNldFZhbHVlKGRhdGEuc2V0dGluZ3Muc3luY09uU3RhcnR1cCkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uYXBwbHlTeW5jT25TdGFydHVwKHZhbHVlKTtcbiAgICAgICAgfSksXG4gICAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJBZHZhbmNlZFNlY3Rpb24oKTogdm9pZCB7XG4gICAgY29uc3QgeyBjb250YWluZXJFbCB9ID0gdGhpcztcbiAgICBjb25zdCBkYXRhID0gdGhpcy5wbHVnaW4uZGF0YTtcbiAgICB0aGlzLmhlYWRpbmcoJ0FkdmFuY2VkJyk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdTdGF0dXMgYmFyIGluZGljYXRvcicpXG4gICAgICAuc2V0RGVzYyhcbiAgICAgICAgJ0RldGFpbGVkOiBcInZzYSBcdTI3MTMgMTJzXCIgd2l0aCBzdGF0ZSBhbmQgYWdlLiBDb21wYWN0OiBqdXN0IHRoZSBzeW1ib2wuIEhpZGRlbjogbm8gc3RhdHVzIGJhciBpdGVtIGF0IGFsbC4nLFxuICAgICAgKVxuICAgICAgLmFkZERyb3Bkb3duKChkcm9wZG93bikgPT4ge1xuICAgICAgICBkcm9wZG93bi5hZGRPcHRpb24oJ2RldGFpbGVkJywgJ0RldGFpbGVkJyk7XG4gICAgICAgIGRyb3Bkb3duLmFkZE9wdGlvbignY29tcGFjdCcsICdDb21wYWN0Jyk7XG4gICAgICAgIGRyb3Bkb3duLmFkZE9wdGlvbignaGlkZGVuJywgJ0hpZGRlbicpO1xuICAgICAgICBkcm9wZG93bi5zZXRWYWx1ZShkYXRhLnNldHRpbmdzLnN0YXR1c0Jhck1vZGUpO1xuICAgICAgICBkcm9wZG93bi5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5hcHBseVN0YXR1c0Jhck1vZGUoXG4gICAgICAgICAgICB2YWx1ZSA9PT0gJ2NvbXBhY3QnIHx8IHZhbHVlID09PSAnaGlkZGVuJyA/IHZhbHVlIDogJ2RldGFpbGVkJyxcbiAgICAgICAgICApO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnSWdub3JlIHBhdHRlcm5zJylcbiAgICAgIC5zZXREZXNjKFxuICAgICAgICAnT25lIHBhdHRlcm4gcGVyIGxpbmUsIGUuZy4gcHJpdmF0ZS8qKiBvciAqLnRtcC4gR2xvYi1saXRlOiAqIG1hdGNoZXMgd2l0aGluIG9uZSBmb2xkZXIgbmFtZSwgKiogc3BhbnMgZm9sZGVycyAoZGlyLyoqIHNraXBzIHRoZSBmb2xkZXIgYW5kIGV2ZXJ5dGhpbmcgaW4gaXQpOyBhIHBhdHRlcm4gd2l0aG91dCAvIG1hdGNoZXMgZmlsZSBuYW1lcyBhdCBhbnkgZGVwdGguIENhc2UtaW5zZW5zaXRpdmU7IGFwcGxpZXMgb24gdGhpcyBkZXZpY2Ugb25seTsgc2F2aW5nIHJlY29ubmVjdHMgc3luYyB0byBhcHBseSB0aGVtLicsXG4gICAgICApXG4gICAgICAuYWRkVGV4dEFyZWEoKGFyZWEpID0+XG4gICAgICAgIGFyZWFcbiAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoJ3ByaXZhdGUvKipcXG4qLnRtcCcpXG4gICAgICAgICAgLnNldFZhbHVlKGRhdGEuc2V0dGluZ3MuaWdub3JlUGF0dGVybnMpXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uYXBwbHlJZ25vcmVQYXR0ZXJucyh2YWx1ZSk7XG4gICAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnRGlhZ25vc3RpY3MgbG9nIGxldmVsJylcbiAgICAgIC5zZXREZXNjKFxuICAgICAgICAnaW5mbyAoZGVmYXVsdCkgcmVjb3JkcyBsaWZlY3ljbGUgZXZlbnRzOyBkZWJ1ZyBhZGRpdGlvbmFsbHkgbG9ncyBwcm90b2NvbCByb3VuZC10cmlwcyAob25lIHNob3J0IGxpbmUgcGVyIGZyYW1lKTsgd2FybiBrZWVwcyBvbmx5IHdhcm5pbmdzIGFuZCBlcnJvcnMuJyxcbiAgICAgIClcbiAgICAgIC5hZGREcm9wZG93bigoZHJvcGRvd24pID0+IHtcbiAgICAgICAgZHJvcGRvd24uYWRkT3B0aW9uKCdpbmZvJywgJ2luZm8nKTtcbiAgICAgICAgZHJvcGRvd24uYWRkT3B0aW9uKCdkZWJ1ZycsICdkZWJ1ZycpO1xuICAgICAgICBkcm9wZG93bi5hZGRPcHRpb24oJ3dhcm4nLCAnd2FybicpO1xuICAgICAgICBkcm9wZG93bi5zZXRWYWx1ZShkYXRhLnNldHRpbmdzLmxvZ0xldmVsKTtcbiAgICAgICAgZHJvcGRvd24ub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgY29uc3QgbGV2ZWw6IExvZ0xldmVsID0gdmFsdWUgPT09ICdkZWJ1ZycgfHwgdmFsdWUgPT09ICd3YXJuJyA/IHZhbHVlIDogJ2luZm8nO1xuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLmFwcGx5TG9nTGV2ZWwobGV2ZWwpO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnQ29weSBkaWFnbm9zdGljcycpXG4gICAgICAuc2V0RGVzYyhcbiAgICAgICAgJ0NvcGllcyBhIGJ1Zy1yZXBvcnQgYnVuZGxlOiBwbHVnaW4gKyBwcm90b2NvbCB2ZXJzaW9ucywgZGV2aWNlLCB3b3JrZXIgVVJMLCBwYWlyaW5nIHN0YXRlLCBhIHN0YXR1cyBzbmFwc2hvdCwgdGhlIHBsYXRmb3JtLCBhbmQgdGhlIGxhc3QgMjAgbG9nIGxpbmVzLicsXG4gICAgICApXG4gICAgICAuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KCdDb3B5IGRpYWdub3N0aWNzJykub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgYnV0dG9uLnNldERpc2FibGVkKHRydWUpO1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5jb3B5RGlhZ25vc3RpY3MoKTtcbiAgICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgICAgYnV0dG9uLnNldERpc2FibGVkKGZhbHNlKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ1NhdmUgc3VwcG9ydCBidW5kbGUnKVxuICAgICAgLnNldERlc2MoXG4gICAgICAgICdXcml0ZXMgYSByaWNoZXIgbWFya2Rvd24gZGlhZ25vc3RpYyBmaWxlICh2ZXJzaW9ucywgc2V0dGluZ3MsIHN5bmMgc3RhdGUsIHJlY2VudCBsb2cpIHRvIC52YXVsdHN5bmNmb3JhZ2VudHMvIGluIHRoaXMgdmF1bHQgXHUyMDE0IGF0dGFjaCBpdCB0byBidWcgcmVwb3J0cy4gSXQgbmV2ZXIgY29udGFpbnMgbm90ZSBjb250ZW50cyBvciB0aGUgZGV2aWNlIHRva2VuLicsXG4gICAgICApXG4gICAgICAuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KCdTYXZlIHN1cHBvcnQgYnVuZGxlJykub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgYnV0dG9uLnNldERpc2FibGVkKHRydWUpO1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlU3VwcG9ydEJ1bmRsZSgpO1xuICAgICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICBidXR0b24uc2V0RGlzYWJsZWQoZmFsc2UpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSksXG4gICAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJBYm91dFNlY3Rpb24oKTogdm9pZCB7XG4gICAgY29uc3QgeyBjb250YWluZXJFbCB9ID0gdGhpcztcbiAgICB0aGlzLmhlYWRpbmcoJ0Fib3V0Jyk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdWZXJzaW9ucycpXG4gICAgICAuc2V0RGVzYyhcbiAgICAgICAgYFBsdWdpbiAke3RoaXMucGx1Z2luLm1hbmlmZXN0LnZlcnNpb24gfHwgJ3Vua25vd24nfSBcdTAwQjcgcHJvdG9jb2wgdiR7UFJPVE9DT0xfVkVSU0lPTn0gXHUwMEI3ICR7dGhpcy5wbHVnaW4ucGxhdGZvcm1TdW1tYXJ5KCl9YCxcbiAgICAgICk7XG5cbiAgICB0aGlzLnNlcnZlclZlcnNpb25TZXR0aW5nID0gbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnU2VydmVyIHZlcnNpb24nKVxuICAgICAgLnNldERlc2ModGhpcy5zZXJ2ZXJWZXJzaW9uVGV4dCgpKTtcbiAgICB0aGlzLnJlZnJlc2hTZXJ2ZXJWZXJzaW9uKCk7XG5cbiAgICB0aGlzLnN0b3JhZ2VTZXR0aW5nID0gbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnVmF1bHQgc3RvcmFnZScpXG4gICAgICAuc2V0RGVzYyh0aGlzLnBsdWdpbi5saW5rZWQgPyAnQ2hlY2tpbmcgdGhlIHdvcmtlclx1MjAyNicgOiAnUGFpciB0aGlzIHZhdWx0IHRvIHNlZSBzdG9yYWdlIHVzYWdlLicpO1xuICAgIGlmICh0aGlzLnBsdWdpbi5saW5rZWQpIHZvaWQgdGhpcy5yZWZyZXNoU3RvcmFnZSgpO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnUHJvamVjdCBob21lJylcbiAgICAgIC5zZXREZXNjKGBEb2N1bWVudGF0aW9uIGFuZCBzb3VyY2U6ICR7UFJPSkVDVF9SRUFETUVfVVJMfWApXG4gICAgICAuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KCdPcGVuIFJFQURNRScpLm9uQ2xpY2soKCkgPT4gb3BlblJlYWRtZVBhZ2UoKSksXG4gICAgICApO1xuICB9XG5cbiAgLyoqIEZpbGwgdGhlIEFib3V0IHN0b3JhZ2UgbGluZSBmcm9tIC9hcGkvc3RhdHVzIChkZXZpY2UtdG9rZW4gYXV0aCkuICovXG4gIHByaXZhdGUgYXN5bmMgcmVmcmVzaFN0b3JhZ2UoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgc3VtbWFyeSA9IGF3YWl0IHRoaXMucGx1Z2luLmZldGNoU3RvcmFnZVN1bW1hcnkoKTtcbiAgICBjb25zdCBkZXNjID1cbiAgICAgIHN1bW1hcnkgPT09IG51bGxcbiAgICAgICAgPyAnU3RvcmFnZSB1c2FnZSBpcyBjdXJyZW50bHkgdW5hdmFpbGFibGUgKHRoZSB3b3JrZXIgaXMgdW5yZWFjaGFibGUpLidcbiAgICAgICAgOiBgU3RvcmFnZSB1c2VkOiAke2Zvcm1hdEJ5dGVzKHN1bW1hcnkuc3RvcmFnZUJ5dGVzKX0gXHUwMEI3ICR7c3VtbWFyeS5hdHRhY2htZW50cy5jb3VudH0gYXR0YWNobWVudCR7XG4gICAgICAgICAgICBzdW1tYXJ5LmF0dGFjaG1lbnRzLmNvdW50ID09PSAxID8gJycgOiAncydcbiAgICAgICAgICB9ICgke2Zvcm1hdEJ5dGVzKHN1bW1hcnkuYXR0YWNobWVudHMuYnl0ZXMpfSlgICtcbiAgICAgICAgICAoc3VtbWFyeS5kZXZpY2VzLmxlbmd0aCA+IDBcbiAgICAgICAgICAgID8gYCBcdTAwQjcgJHtzdW1tYXJ5LmRldmljZXMubGVuZ3RofSBkZXZpY2Uke3N1bW1hcnkuZGV2aWNlcy5sZW5ndGggPT09IDEgPyAnJyA6ICdzJ31gXG4gICAgICAgICAgICA6ICcnKTtcbiAgICAvLyBUaGUgdGFiIG1heSBoYXZlIGJlZW4gY2xvc2VkL3JlLXJlbmRlcmVkIG1lYW53aGlsZTsgcGFpbnQgb25seSBpZiBsaXZlLlxuICAgIGlmICh0aGlzLnN0b3JhZ2VTZXR0aW5nICE9PSBudWxsKSB0aGlzLnN0b3JhZ2VTZXR0aW5nLnNldERlc2MoZGVzYyk7XG4gIH1cblxuICAvLyAtLS0gc3RhdHVzIC8gZmVlZGJhY2sgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICBwcml2YXRlIHN0YXR1c1RleHQoKTogc3RyaW5nIHtcbiAgICBjb25zdCBkYXRhOiBWYXVsdFN5bmNQbHVnaW5EYXRhID0gdGhpcy5wbHVnaW4uZGF0YTtcbiAgICBjb25zdCBzdGF0dXMgPSB0aGlzLnBsdWdpbi5jbGllbnQ/LnN0YXR1cygpO1xuICAgIGlmICh0aGlzLnBsdWdpbi5zeW5jaW5nUGF1c2VkKSB7XG4gICAgICByZXR1cm4gW1xuICAgICAgICAnU3RhdGU6IHBhdXNlZCcsXG4gICAgICAgIGBXb3JrZXI6ICR7ZGF0YS51cmx9YCxcbiAgICAgICAgJ1ZhdWx0IGNoYW5nZXMgc3RheSBsb2NhbCB1bnRpbCB5b3UgcmVzdW1lIHN5bmNpbmcuJyxcbiAgICAgIF0uam9pbignXFxuJyk7XG4gICAgfVxuICAgIGlmIChzdGF0dXMgPT09IHVuZGVmaW5lZCkge1xuICAgICAgcmV0dXJuIGBMaW5rZWQgdG8gJHtkYXRhLnVybH0gKGRldmljZSAke2RhdGEuZGV2aWNlTmFtZSB8fCBkYXRhLmRldmljZUlkfSkuYDtcbiAgICB9XG4gICAgY29uc3QgbGFzdFN5bmMgPVxuICAgICAgc3RhdHVzLmxhc3RTeW5jQXQgPT09IG51bGxcbiAgICAgICAgPyAnbmV2ZXInXG4gICAgICAgIDogYCR7Zm9ybWF0U2luY2UoRGF0ZS5ub3coKSAtIHN0YXR1cy5sYXN0U3luY0F0KX0gYWdvYDtcbiAgICBjb25zdCBzdGF0ZSA9IHN0YXR1cy5zdGF0ZSA9PT0gJ2xpdmUnID8gJ2Nvbm5lY3RlZCcgOiBzdGF0dXMuc3RhdGU7XG4gICAgY29uc3QgbGluZXMgPSBbYFN0YXRlOiAke3N0YXRlfWAsIGBXb3JrZXI6ICR7ZGF0YS51cmx9YCwgYExhc3Qgc3luYzogJHtsYXN0U3luY31gXTtcbiAgICAvLyBCdWxrLXBoYXNlIHByb2dyZXNzIFx1MjAxNCB0aGUgc2FtZSBYL1kgdGhlIHN0YXR1cyBiYXIgc2hvd3MgZHVyaW5nIGFcbiAgICAvLyBtdWx0aS1taW51dGUgaW5pdGlhbCBzeW5jLlxuICAgIGlmIChzdGF0dXMucHJvZ3Jlc3MgIT09IHVuZGVmaW5lZCkge1xuICAgICAgbGluZXMucHVzaChgU3luY2luZzogJHtzdGF0dXMucHJvZ3Jlc3MuZG9uZX0vJHtzdGF0dXMucHJvZ3Jlc3MudG90YWx9ICgke3N0YXR1cy5wcm9ncmVzcy5waGFzZX0pYCk7XG4gICAgfVxuICAgIGxpbmVzLnB1c2goXG4gICAgICBgUGVuZGluZyBjaGFuZ2VzOiAke3N0YXR1cy5wZW5kaW5nfWAsXG4gICAgICBgQ29uZmxpY3RzOiAke3N0YXR1cy5jb25mbGljdHMubGVuZ3RofSR7c3RhdHVzLmNvbmZsaWN0cy5sZW5ndGggPiAwID8gJyAoY29uZmxpY3QgY29waWVzIHdlcmUgd3JpdHRlbiBpbnRvIHRoZSB2YXVsdCknIDogJyd9YCxcbiAgICApO1xuICAgIHJldHVybiBsaW5lcy5qb2luKCdcXG4nKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVmcmVzaFN0YXR1cygpOiB2b2lkIHtcbiAgICB0aGlzLnN0YXR1c1NldHRpbmc/LnNldERlc2ModGhpcy5zdGF0dXNUZXh0KCkpO1xuICAgIHRoaXMucmVmcmVzaFNlcnZlclZlcnNpb24oKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBUaGUgQWJvdXQgc2VjdGlvbidzIHNlcnZlci12ZXJzaW9uIGxpbmU6IHRoZSBoZWxsb0Fjay1yZXBvcnRlZCB2ZXJzaW9uXG4gICAqIHBsdXMgdGhlIGNvbXBhdCB2ZXJkaWN0IHdoZW4gaXQgaXMgbm90IG9rLiBgc2VydmVyVmVyc2lvbmAgbWF5IGxhZyB0aGVcbiAgICogdmVyZGljdCBieSBhIHRpY2sgKHRoZSBwbHVnaW4gYXNzZXNzZXMgb24gaXRzIG93biAxIEh6IHN1cGVydmlzaW9uKSwgc29cbiAgICogdGhlIHZlcmRpY3QgbWVzc2FnZSBpcyBhdXRob3JpdGF0aXZlIHdoZW4gcHJlc2VudC5cbiAgICovXG4gIHByaXZhdGUgc2VydmVyVmVyc2lvblRleHQoKTogc3RyaW5nIHtcbiAgICBpZiAoIXRoaXMucGx1Z2luLmxpbmtlZCkgcmV0dXJuICdQYWlyIHRoaXMgdmF1bHQgdG8gc2VlIHRoZSB3b3JrZXIgdmVyc2lvbi4nO1xuICAgIGNvbnN0IHN0YXR1cyA9IHRoaXMucGx1Z2luLmNsaWVudD8uc3RhdHVzKCk7XG4gICAgY29uc3QgdmVyZGljdCA9IHRoaXMucGx1Z2luLnNlcnZlckNvbXBhdGliaWxpdHk7XG4gICAgaWYgKHZlcmRpY3QgIT09IG51bGwgJiYgdmVyZGljdC5sZXZlbCAhPT0gJ29rJykgcmV0dXJuIHZlcmRpY3QubWVzc2FnZTtcbiAgICBjb25zdCB2ZXJzaW9uID0gc3RhdHVzPy5zZXJ2ZXJWZXJzaW9uID8/IG51bGw7XG4gICAgcmV0dXJuIHZlcnNpb24gPT09IG51bGxcbiAgICAgID8gJ1Vua25vd24gXHUyMDE0IHRoZSB3b3JrZXIgaGFzIG5vdCByZXBvcnRlZCBhIHZlcnNpb24geWV0LidcbiAgICAgIDogYFNlcnZlciAke3ZlcnNpb259IFx1MDBCNyBjb21wYXRpYmxlIHdpdGggdGhpcyBwbHVnaW4uYDtcbiAgfVxuXG4gIC8qKiBSZXBhaW50IHRoZSBzZXJ2ZXItdmVyc2lvbiByb3cgKGNhbGxlZCBieSB0aGUgMSBIeiByZWZyZXNoIGxvb3ApLiAqL1xuICBwcml2YXRlIHJlZnJlc2hTZXJ2ZXJWZXJzaW9uKCk6IHZvaWQge1xuICAgIC8vIFRoZSB0YWIgbWF5IGhhdmUgYmVlbiBjbG9zZWQvcmUtcmVuZGVyZWQgbWVhbndoaWxlOyBwYWludCBvbmx5IGlmIGxpdmUuXG4gICAgaWYgKHRoaXMuc2VydmVyVmVyc2lvblNldHRpbmcgIT09IG51bGwpIHRoaXMuc2VydmVyVmVyc2lvblNldHRpbmcuc2V0RGVzYyh0aGlzLnNlcnZlclZlcnNpb25UZXh0KCkpO1xuICB9XG5cbiAgLyoqIFBhaXIgZmVlZGJhY2s6IHN1Y2Nlc3MgcmUtcmVuZGVyczsgZmFpbHVyZXMgbGFuZCBpbiB0aGUgaGludCBTZXR0aW5nLiAqL1xuICBwcml2YXRlIHNob3dPdXRjb21lKG91dGNvbWU6IFBhaXJPdXRjb21lKTogdm9pZCB7XG4gICAgaWYgKG91dGNvbWUuc3RhdHVzID09PSAncGFpcmVkJykge1xuICAgICAgbmV3IE5vdGljZShwYWlyT3V0Y29tZU1lc3NhZ2Uob3V0Y29tZSkpO1xuICAgICAgdGhpcy5kaXNwbGF5KCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IG1lc3NhZ2UgPSBwYWlyT3V0Y29tZU1lc3NhZ2Uob3V0Y29tZSk7XG4gICAgbmV3IE5vdGljZShtZXNzYWdlLCAxMDAwMCk7XG4gICAgaWYgKHRoaXMuaGludFNldHRpbmcgIT09IG51bGwpIHRoaXMuaGludFNldHRpbmcuc2V0RGVzYyhtZXNzYWdlKTtcbiAgfVxuXG4gIC8vIC0tLSBsaXZlIHJlZnJlc2ggbG9vcCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICAvKiogUmVmcmVzaCB0aGUgc3RhdHVzIHJlYWRvdXQgfjEgSHogd2hpbGUgdGhlIHRhYiBpcyBvcGVuLiAqL1xuICBwcml2YXRlIHN0YXJ0UmVmcmVzaCgpOiB2b2lkIHtcbiAgICB0aGlzLnN0b3BSZWZyZXNoKCk7XG4gICAgY29uc3QgaGFuZGxlID0gc2V0SW50ZXJ2YWwoKCkgPT4gdGhpcy5yZWZyZXNoU3RhdHVzKCksIDEwMDApO1xuICAgIHRoaXMucmVmcmVzaEhhbmRsZSA9IGhhbmRsZTtcbiAgICAvLyBPYnNpZGlhbiBjbGVhcnMgcmVnaXN0ZXJlZCBpbnRlcnZhbHMgd2hlbiB0aGUgcGx1Z2luIHVubG9hZHMgXHUyMDE0IG5vIGxlYWtcbiAgICAvLyBldmVuIGlmIHRoZSBzZXR0aW5ncyBtb2RhbCBpcyBmb3JjZS1jbG9zZWQuXG4gICAgdGhpcy5wbHVnaW4ucmVnaXN0ZXJJbnRlcnZhbChoYW5kbGUgYXMgdW5rbm93biBhcyBudW1iZXIpO1xuICB9XG5cbiAgcHJpdmF0ZSBzdG9wUmVmcmVzaCgpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5yZWZyZXNoSGFuZGxlICE9PSBudWxsKSB7XG4gICAgICBjbGVhckludGVydmFsKHRoaXMucmVmcmVzaEhhbmRsZSk7XG4gICAgICB0aGlzLnJlZnJlc2hIYW5kbGUgPSBudWxsO1xuICAgIH1cbiAgfVxufVxuIiwgIi8qKlxuICogU3RhdHVzLWJhciBpbmRpY2F0b3IgKHBsdWdpbiBzY29wZSBpdGVtICM1KTogYSBzbWFsbCBwYXNzaXZlIHZpZXcgb3ZlclxuICogYFN5bmNDbGllbnRTdGF0dXNgLCByZXBhaW50ZWQgYnkgdGhlIHBsdWdpbidzIDEgcyBzdXBlcnZpc2lvbiB0aWNrLlxuICpcbiAqICAgdnNhIFx1MjJFRiAgICAgICAgICAgICAgY29ubmVjdGluZyAvIHN5bmNpbmdcbiAqICAgdnNhIFx1MjJFRiAxMjM0LzUwMDAgICAgc3luY2luZywgYnVsayBwaGFzZSBwcm9ncmVzcyAoc2Nhbm5pbmcvcHVzaGluZy9wdWxsaW5nKVxuICogICB2c2EgXHUyNzEzIDEycyAgICAgICAgICBsaXZlLCBsYXN0IGNvbXBsZXRlZCBjeWNsZSAxMiBzIGFnb1xuICogICB2c2EgXHUyNkEwIGNvbmZsaWN0czogMiBjb25mbGljdHMgb2JzZXJ2ZWQgKGNvbmZsaWN0IGNvcGllcyBleGlzdCBpbiB0aGUgdmF1bHQpXG4gKiAgIHZzYSBcdTI3MTcgb2ZmbGluZSAgICAgIGRpc2Nvbm5lY3RlZCAocmVjb25uZWN0IGJhY2tvZmYgcnVubmluZylcbiAqICAgdnNhIFx1MjNGOCAgICAgICAgICAgICAgc3luY2luZyBwYXVzZWQgKHRoZSBQYXVzZSBzeW5jaW5nIHNldHRpbmcpXG4gKlxuICogQ29tcGFjdCBtb2RlIGRyb3BzIHRoZSB0cmFpbGluZyBkZXRhaWwgKFwidnNhIFx1MjcxMyAxMnNcIiBcdTIxOTIgXCJ2c2EgXHUyNzEzXCIsIGV0Yy4pO1xuICogSGlkZGVuIG1vZGUgcmVtb3ZlcyB0aGUgaXRlbSBlbnRpcmVseSAodGhlIHBsdWdpbiBuZXZlciBtb3VudHMgaXQpLlxuICpcbiAqIFRoZSB0b29sdGlwIGNhcnJpZXMgdGhlIGRldGFpbDogc3RhdGUsIHdvcmtlciBVUkwsIGRldmljZSwgbGFzdCBzeW5jLCBwZW5kaW5nLlxuICovXG5cbmltcG9ydCB0eXBlIHsgU3luY0NsaWVudFN0YXR1cyB9IGZyb20gJ0B2c2EvY29yZSc7XG5cbi8qKiBIb3cgdGhlIHN0YXR1cy1iYXIgaW5kaWNhdG9yIHJlbmRlcnMgKHRoZSBcIlN0YXR1cyBiYXIgaW5kaWNhdG9yXCIgc2V0dGluZykuICovXG5leHBvcnQgdHlwZSBTdGF0dXNCYXJNb2RlID0gJ2RldGFpbGVkJyB8ICdjb21wYWN0JyB8ICdoaWRkZW4nO1xuXG4vKiogVGhlIHNsaWNlIG9mIEhUTUxFbGVtZW50IHRoZSBpbmRpY2F0b3IgdG91Y2hlcyAodGVzdHMgcGFzcyBhIHBsYWluIG9iamVjdCkuICovXG5leHBvcnQgaW50ZXJmYWNlIFN0YXR1c0l0ZW1MaWtlIHtcbiAgdGV4dENvbnRlbnQ6IHN0cmluZztcbiAgYWRkQ2xhc3M/KGNsczogc3RyaW5nKTogdW5rbm93bjtcbiAgcmVtb3ZlQ2xhc3M/KGNsczogc3RyaW5nKTogdW5rbm93bjtcbiAgc2V0QXR0cmlidXRlPyhuYW1lOiBzdHJpbmcsIHZhbHVlOiBzdHJpbmcpOiB1bmtub3duO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFN0YXR1c0NvbnRleHQge1xuICB1cmw6IHN0cmluZztcbiAgZGV2aWNlTmFtZTogc3RyaW5nO1xuICAvKiogRXh0cmEgbGluZSAoZS5nLiBhbiBhdXRoIGZhaWx1cmUgbm90ZSkgYXBwZW5kZWQgdG8gdGhlIHRvb2x0aXAuICovXG4gIG5vdGU/OiBzdHJpbmc7XG4gIC8qKiBTeW5jaW5nIGlzIHBhdXNlZCAodGhlIFBhdXNlIHN5bmNpbmcgYnV0dG9uKSBcdTIwMTQgc2hvd3MgXCJ2c2EgXHUyM0Y4XCIuICovXG4gIHBhdXNlZD86IGJvb2xlYW47XG4gIC8qKiBJbmRpY2F0b3IgbW9kZSAodGhlIHBsdWdpbidzIHN0YXR1cyBiYXIgc2V0dGluZyk7IGRlZmF1bHQgZGV0YWlsZWQuICovXG4gIG1vZGU/OiBTdGF0dXNCYXJNb2RlO1xufVxuXG4vKiogYG5vdyAtIHNpbmNlYCwgZmxvb3JlZDogYDEyc2AsIGA1bWAsIGAzaGAgXHUyMDE0IGRpc3BsYXkgb25seS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRTaW5jZShlbGFwc2VkTXM6IG51bWJlcik6IHN0cmluZyB7XG4gIGNvbnN0IHNlY29uZHMgPSBNYXRoLm1heCgwLCBNYXRoLmZsb29yKGVsYXBzZWRNcyAvIDEwMDApKTtcbiAgaWYgKHNlY29uZHMgPCA2MCkgcmV0dXJuIGAke3NlY29uZHN9c2A7XG4gIGNvbnN0IG1pbnV0ZXMgPSBNYXRoLmZsb29yKHNlY29uZHMgLyA2MCk7XG4gIGlmIChtaW51dGVzIDwgNjApIHJldHVybiBgJHttaW51dGVzfW1gO1xuICByZXR1cm4gYCR7TWF0aC5mbG9vcihtaW51dGVzIC8gNjApfWhgO1xufVxuXG4vKipcbiAqIFRoZSBvbmUtbGluZSBzdGF0dXMgdGV4dCBmb3IgYSBjbGllbnQgc3RhdHVzIGF0IHRpbWUgYG5vd2AuIGBtb2RlYCBzaHJpbmtzXG4gKiB0aGUgbGluZSAoY29tcGFjdCBkcm9wcyB0aGUgdHJhaWxpbmcgZGV0YWlsKTsgYHBhdXNlZGAgd2lucyBvdmVyIGV2ZXJ5dGhpbmcuXG4gKlxuICogRHVyaW5nIGEgYnVsayBwaGFzZSAoYHN0YXR1cy5wcm9ncmVzc2AgXHUyMDE0IHNjYW5uaW5nL3B1c2hpbmcvcHVsbGluZyBvZiBhXG4gKiBtdWx0aS1taW51dGUgaW5pdGlhbCBzeW5jKSBib3RoIGRldGFpbCBsZXZlbHMgc2hvdyB0aGUgY291bnRzIFx1MjAxNFxuICogYHZzYSBcdTIyRUYgMTIzNC81MDAwYCBcdTIwMTQgYmVjYXVzZSB0aGF0IGlzIHRoZSBvbmUgdGhpbmcgYSB1c2VyIHdhaXRpbmcgb24gYSBiaWdcbiAqIHN5bmMgbmVlZHM7IGhpZGRlbiBtb2RlIHNob3dzIG5vdGhpbmcgKHRoZSBpdGVtIGlzIG5ldmVyIG1vdW50ZWQpLlxuICovXG5leHBvcnQgZnVuY3Rpb24gc3RhdHVzTGluZUZvcihcbiAgc3RhdHVzOiBTeW5jQ2xpZW50U3RhdHVzLFxuICBub3c6IG51bWJlcixcbiAgbW9kZTogU3RhdHVzQmFyTW9kZSA9ICdkZXRhaWxlZCcsXG4gIHBhdXNlZCA9IGZhbHNlLFxuKTogc3RyaW5nIHtcbiAgaWYgKHBhdXNlZCkgcmV0dXJuICd2c2EgXHUyM0Y4JztcbiAgY29uc3QgY29tcGFjdCA9IG1vZGUgPT09ICdjb21wYWN0JztcbiAgc3dpdGNoIChzdGF0dXMuc3RhdGUpIHtcbiAgICBjYXNlICdjb25uZWN0aW5nJzpcbiAgICBjYXNlICdzeW5jaW5nJzoge1xuICAgICAgY29uc3QgcHJvZ3Jlc3MgPSBzdGF0dXMucHJvZ3Jlc3M7XG4gICAgICBpZiAocHJvZ3Jlc3MgIT09IHVuZGVmaW5lZCkgcmV0dXJuIGB2c2EgXHUyMkVGICR7cHJvZ3Jlc3MuZG9uZX0vJHtwcm9ncmVzcy50b3RhbH1gO1xuICAgICAgcmV0dXJuICd2c2EgXHUyMkVGJztcbiAgICB9XG4gICAgY2FzZSAnZGlzY29ubmVjdGVkJzpcbiAgICAgIHJldHVybiBjb21wYWN0ID8gJ3ZzYSBcdTI3MTcnIDogJ3ZzYSBcdTI3MTcgb2ZmbGluZSc7XG4gICAgY2FzZSAnbGl2ZSc6XG4gICAgICBpZiAoc3RhdHVzLmNvbmZsaWN0cy5sZW5ndGggPiAwKSB7XG4gICAgICAgIHJldHVybiBjb21wYWN0ID8gJ3ZzYSBcdTI2QTAnIDogYHZzYSBcdTI2QTAgY29uZmxpY3RzOiAke3N0YXR1cy5jb25mbGljdHMubGVuZ3RofWA7XG4gICAgICB9XG4gICAgICBpZiAoc3RhdHVzLmxhc3RTeW5jQXQgPT09IG51bGwgfHwgY29tcGFjdCkgcmV0dXJuICd2c2EgXHUyNzEzJztcbiAgICAgIHJldHVybiBgdnNhIFx1MjcxMyAke2Zvcm1hdFNpbmNlKG5vdyAtIHN0YXR1cy5sYXN0U3luY0F0KX1gO1xuICAgIGNhc2UgJ2lkbGUnOlxuICAgICAgcmV0dXJuICd2c2EnO1xuICB9XG59XG5cbi8qKiBUb29sdGlwIGxpbmVzIChqb2luZWQgd2l0aCBgXFxuYCkuICovXG5leHBvcnQgZnVuY3Rpb24gc3RhdHVzVG9vbHRpcEZvcihzdGF0dXM6IFN5bmNDbGllbnRTdGF0dXMsIGNvbnRleHQ6IFN0YXR1c0NvbnRleHQsIG5vdzogbnVtYmVyKTogc3RyaW5nIHtcbiAgY29uc3Qgc3RhdGVMYWJlbDogUmVjb3JkPFN5bmNDbGllbnRTdGF0dXNbJ3N0YXRlJ10sIHN0cmluZz4gPSB7XG4gICAgaWRsZTogJ25vdCBydW5uaW5nJyxcbiAgICBjb25uZWN0aW5nOiAnY29ubmVjdGluZ1x1MjAyNicsXG4gICAgc3luY2luZzogJ3N5bmNpbmdcdTIwMjYnLFxuICAgIGxpdmU6ICdsaXZlJyxcbiAgICBkaXNjb25uZWN0ZWQ6ICdvZmZsaW5lIFx1MjAxNCByZWNvbm5lY3RpbmcnLFxuICB9O1xuICBjb25zdCBoZWFkbGluZSA9IGNvbnRleHQucGF1c2VkID09PSB0cnVlID8gJ3BhdXNlZCcgOiBzdGF0ZUxhYmVsW3N0YXR1cy5zdGF0ZV07XG4gIGNvbnN0IGxpbmVzID0gW2BWYXVsdFN5bmMgZm9yIEFnZW50cyBcdTIwMTQgJHtoZWFkbGluZX1gXTtcbiAgaWYgKGNvbnRleHQudXJsICE9PSAnJykgbGluZXMucHVzaChgV29ya2VyOiAke2NvbnRleHQudXJsfWApO1xuICBpZiAoY29udGV4dC5kZXZpY2VOYW1lICE9PSAnJykgbGluZXMucHVzaChgRGV2aWNlOiAke2NvbnRleHQuZGV2aWNlTmFtZX1gKTtcbiAgbGluZXMucHVzaChcbiAgICBzdGF0dXMubGFzdFN5bmNBdCA9PT0gbnVsbFxuICAgICAgPyAnTGFzdCBzeW5jOiBuZXZlcidcbiAgICAgIDogYExhc3Qgc3luYzogJHtmb3JtYXRTaW5jZShub3cgLSBzdGF0dXMubGFzdFN5bmNBdCl9IGFnb2AsXG4gICk7XG4gIGlmIChzdGF0dXMucHJvZ3Jlc3MgIT09IHVuZGVmaW5lZCkge1xuICAgIGxpbmVzLnB1c2goYFN5bmNpbmc6ICR7c3RhdHVzLnByb2dyZXNzLmRvbmV9LyR7c3RhdHVzLnByb2dyZXNzLnRvdGFsfSAoJHtzdGF0dXMucHJvZ3Jlc3MucGhhc2V9KWApO1xuICB9XG4gIGxpbmVzLnB1c2goYFBlbmRpbmcgY2hhbmdlczogJHtzdGF0dXMucGVuZGluZ31gKTtcbiAgbGluZXMucHVzaChgQ29uZmxpY3RzOiAke3N0YXR1cy5jb25mbGljdHMubGVuZ3RofWApO1xuICBpZiAoc3RhdHVzLmNvbmZsaWN0cy5sZW5ndGggPiAwKSB7XG4gICAgbGluZXMucHVzaChgQ29uZmxpY3QgY29waWVzOiAke3N0YXR1cy5jb25mbGljdHMubWFwKChjKSA9PiBjLnBhdGgpLmpvaW4oJywgJyl9YCk7XG4gIH1cbiAgaWYgKGNvbnRleHQubm90ZSAhPT0gdW5kZWZpbmVkICYmIGNvbnRleHQubm90ZSAhPT0gJycpIGxpbmVzLnB1c2goY29udGV4dC5ub3RlKTtcbiAgcmV0dXJuIGxpbmVzLmpvaW4oJ1xcbicpO1xufVxuXG4vKiogQ1NTIG1vZGlmaWVyIGZvciB0aGUgaW5kaWNhdG9yICh0aW50ZWQgd2FybmluZy9lcnJvciBzdGF0ZXMpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN0YXR1c0NsYXNzRm9yKHN0YXR1czogU3luY0NsaWVudFN0YXR1cyk6IHN0cmluZyB7XG4gIGlmIChzdGF0dXMuc3RhdGUgPT09ICdkaXNjb25uZWN0ZWQnKSByZXR1cm4gJ3ZzYS1lcnJvcic7XG4gIGlmIChzdGF0dXMuY29uZmxpY3RzLmxlbmd0aCA+IDApIHJldHVybiAndnNhLXdhcm4nO1xuICByZXR1cm4gJyc7XG59XG5cbi8qKlxuICogUGFpbnRzIG9uZSBzdGF0dXMtYmFyIGl0ZW0uIFBhc3NpdmU6IHRoZSBwbHVnaW4gY2FsbHMgYHVwZGF0ZSgpYCBmcm9tIGl0c1xuICogc3VwZXJ2aXNpb24gdGljayBcdTIwMTQgbm8gdGltZXJzIG9mIGl0cyBvd24gdG8gbGVhay5cbiAqL1xuZXhwb3J0IGNsYXNzIFN0YXR1c0JhckluZGljYXRvciB7XG4gIC8qKiBBbHdheXMgb24gXHUyMDE0IHRoZSBiYXNlIGNsYXNzIHN0eWxlcy5jc3MgdGFyZ2V0cy4gKi9cbiAgcHJpdmF0ZSBzdGF0aWMgcmVhZG9ubHkgQkFTRV9DTEFTUyA9ICd2c2Etc3RhdHVzJztcbiAgcHJpdmF0ZSBzdGF0aWMgcmVhZG9ubHkgTU9ESUZJRVJfQ0xBU1NFUyA9IFsndnNhLXdhcm4nLCAndnNhLWVycm9yJ107XG5cbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBpdGVtOiBTdGF0dXNJdGVtTGlrZSkge31cblxuICB1cGRhdGUoc3RhdHVzOiBTeW5jQ2xpZW50U3RhdHVzLCBjb250ZXh0OiBTdGF0dXNDb250ZXh0LCBub3c6IG51bWJlcik6IHZvaWQge1xuICAgIHRoaXMuaXRlbS50ZXh0Q29udGVudCA9IHN0YXR1c0xpbmVGb3Ioc3RhdHVzLCBub3csIGNvbnRleHQubW9kZSA/PyAnZGV0YWlsZWQnLCBjb250ZXh0LnBhdXNlZCA9PT0gdHJ1ZSk7XG4gICAgdGhpcy5pdGVtLmFkZENsYXNzPy4oU3RhdHVzQmFySW5kaWNhdG9yLkJBU0VfQ0xBU1MpO1xuICAgIGNvbnN0IG1vZGlmaWVyID0gc3RhdHVzQ2xhc3NGb3Ioc3RhdHVzKTtcbiAgICBmb3IgKGNvbnN0IGNscyBvZiBTdGF0dXNCYXJJbmRpY2F0b3IuTU9ESUZJRVJfQ0xBU1NFUykge1xuICAgICAgaWYgKGNscyA9PT0gbW9kaWZpZXIpIHRoaXMuaXRlbS5hZGRDbGFzcz8uKGNscyk7XG4gICAgICBlbHNlIHRoaXMuaXRlbS5yZW1vdmVDbGFzcz8uKGNscyk7XG4gICAgfVxuICAgIHRoaXMuaXRlbS5zZXRBdHRyaWJ1dGU/LigndGl0bGUnLCBzdGF0dXNUb29sdGlwRm9yKHN0YXR1cywgY29udGV4dCwgbm93KSk7XG4gIH1cbn1cbiIsICIvKipcbiAqIGBXZWJTb2NrZXRUcmFuc3BvcnRgIFx1MjAxNCBjb3JlJ3MgYFRyYW5zcG9ydGAgb3ZlciB0aGUgZ2xvYmFsIGBXZWJTb2NrZXRgXG4gKiAocHJlc2VudCBpbiBPYnNpZGlhbiBkZXNrdG9wICphbmQqIG1vYmlsZTsgZmVhdHVyZS1jaGVja2VkIHdpdGggYSBjbGVhclxuICogZXJyb3IgZm9yIGV4b3RpYyBidWlsZHMpLlxuICpcbiAqIFRoaXMgbWlycm9ycyBgQHZzYS9ub2RlLXJ1bnRpbWVgJ3MgdHJhbnNwb3J0IG9uIHB1cnBvc2UgKHNhbWUgd2lyZSBmb3JtYXQ6XG4gKiBvbmUgSlNPTiB0ZXh0IGZyYW1lIHBlciBtZXNzYWdlLCBjb3JlJ3MgYHBhcnNlTWVzc2FnZWAgb24gcmVjZWl2ZSwgcXVldWVkXG4gKiBzZW5kcyBiZWZvcmUgb3BlbikgYnV0IHNoYXJlcyBubyBjb2RlIHdpdGggaXQgXHUyMDE0IGBAdnNhL25vZGUtcnVudGltZWAgaXNcbiAqIE5vZGUtb25seSBhbmQgbXVzdCBuZXZlciBiZSBhIHBsdWdpbiBkZXBlbmRlbmN5LlxuICovXG5cbmltcG9ydCB7IE5ldHdvcmtFcnJvciwgcGFyc2VNZXNzYWdlIH0gZnJvbSAnQHZzYS9jb3JlJztcbmltcG9ydCB0eXBlIHsgQ2xvc2VSZWFzb24sIE1lc3NhZ2UsIFRyYW5zcG9ydCB9IGZyb20gJ0B2c2EvY29yZSc7XG5cbi8qKlxuICogVGhlIG1pbmltYWwgV2ViU29ja2V0IHN1cmZhY2UgdGhpcyB0cmFuc3BvcnQgbmVlZHMuIEluamVjdGFibGUgc28gdGVzdHNcbiAqIChhbmQgZXhvdGljIHJ1bnRpbWVzKSBjYW4gc3VwcGx5IGEgZmFrZTsgcHJvZHVjdGlvbiB1c2VzIHRoZSBnbG9iYWwuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgV2ViU29ja2V0TGlrZSB7XG4gIHNlbmQoZGF0YTogc3RyaW5nKTogdm9pZDtcbiAgY2xvc2UoY29kZT86IG51bWJlciwgcmVhc29uPzogc3RyaW5nKTogdm9pZDtcbiAgYWRkRXZlbnRMaXN0ZW5lcih0eXBlOiAnb3BlbicsIGxpc3RlbmVyOiAoKSA9PiB2b2lkKTogdm9pZDtcbiAgYWRkRXZlbnRMaXN0ZW5lcih0eXBlOiAnbWVzc2FnZScsIGxpc3RlbmVyOiAoZXZlbnQ6IHsgZGF0YTogdW5rbm93biB9KSA9PiB2b2lkKTogdm9pZDtcbiAgYWRkRXZlbnRMaXN0ZW5lcih0eXBlOiAnY2xvc2UnLCBsaXN0ZW5lcjogKGV2ZW50OiB7IGNvZGU/OiBudW1iZXI7IHJlYXNvbj86IHN0cmluZyB9KSA9PiB2b2lkKTogdm9pZDtcbiAgYWRkRXZlbnRMaXN0ZW5lcih0eXBlOiAnZXJyb3InLCBsaXN0ZW5lcjogKGV2ZW50OiB1bmtub3duKSA9PiB2b2lkKTogdm9pZDtcbn1cblxuZXhwb3J0IHR5cGUgV2ViU29ja2V0RmFjdG9yeSA9ICh1cmw6IHN0cmluZykgPT4gV2ViU29ja2V0TGlrZTtcblxuZXhwb3J0IGludGVyZmFjZSBXZWJTb2NrZXRUcmFuc3BvcnRPcHRpb25zIHtcbiAgLyoqIFdvcmtlciBvcmlnaW4gKGBodHRwczovL3BlcnNvbmFsLngud29ya2Vycy5kZXZgKSBvciBhIGB3cyhzKTovL2AgVVJMLiAqL1xuICB1cmw6IHN0cmluZztcbiAgLyoqIERldmljZSB0b2tlbiBcdTIwMTQgY2FycmllZCBpbiB0aGUgcXVlcnkgc3RyaW5nICh0aGUgd29ya2VyJ3MgcHJlLWF1dGggcGF0aCkuICovXG4gIHRva2VuOiBzdHJpbmc7XG4gIC8qKiBXUyBwYXRoIG9uIHRoZSB3b3JrZXIgKGRlZmF1bHQgYC93c2A7IGAvc3luY2AgaXMgZXF1aXZhbGVudCkuICovXG4gIHBhdGg/OiBzdHJpbmc7XG4gIC8qKiBJbmplY3RhYmxlIHNvY2tldCBmYWN0b3J5ICh0ZXN0cykuIERlZmF1bHQ6IHRoZSBnbG9iYWwgYFdlYlNvY2tldGAuICovXG4gIHdzRmFjdG9yeT86IFdlYlNvY2tldEZhY3Rvcnk7XG59XG5cbi8qKlxuICogQnVpbGQgdGhlIGF1dGhlbnRpY2F0ZWQgV1MgVVJMOiBgaHR0cHM6Ly94YCBcdTIxOTIgYHdzczovL3gvd3M/dG9rZW49XHUyMDI2YC5cbiAqIFRocm93cyBvbiBub24tSFRUUChTKS9XUyBzY2hlbWVzIG9yIHVucGFyc2FibGUgaW5wdXQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB0b1dlYlNvY2tldFVybChiYXNlVXJsOiBzdHJpbmcsIHRva2VuOiBzdHJpbmcsIHBhdGggPSAnL3dzJyk6IHN0cmluZyB7XG4gIGNvbnN0IHVybCA9IG5ldyBVUkwoYmFzZVVybCk7XG4gIGlmICh1cmwucHJvdG9jb2wgPT09ICdodHRwOicpIHVybC5wcm90b2NvbCA9ICd3czonO1xuICBlbHNlIGlmICh1cmwucHJvdG9jb2wgPT09ICdodHRwczonKSB1cmwucHJvdG9jb2wgPSAnd3NzOic7XG4gIGVsc2UgaWYgKHVybC5wcm90b2NvbCAhPT0gJ3dzOicgJiYgdXJsLnByb3RvY29sICE9PSAnd3NzOicpIHtcbiAgICB0aHJvdyBuZXcgTmV0d29ya0Vycm9yKGB3b3JrZXIgVVJMIG11c3QgYmUgaHR0cChzKTovLyBvciB3cyhzKTovLywgZ290ICR7dXJsLnByb3RvY29sfWApO1xuICB9XG4gIHVybC5wYXRobmFtZSA9IHBhdGg7XG4gIHVybC5zZWFyY2ggPSAnJztcbiAgdXJsLnNlYXJjaFBhcmFtcy5zZXQoJ3Rva2VuJywgdG9rZW4pO1xuICByZXR1cm4gdXJsLnRvU3RyaW5nKCk7XG59XG5cbmZ1bmN0aW9uIGRlZmF1bHRXZWJTb2NrZXRGYWN0b3J5KHVybDogc3RyaW5nKTogV2ViU29ja2V0TGlrZSB7XG4gIGNvbnN0IHdlYnNvY2tldCA9IChnbG9iYWxUaGlzIGFzIHsgV2ViU29ja2V0PzogdW5rbm93biB9KS5XZWJTb2NrZXQ7XG4gIGlmICh0eXBlb2Ygd2Vic29ja2V0ICE9PSAnZnVuY3Rpb24nKSB7XG4gICAgdGhyb3cgbmV3IE5ldHdvcmtFcnJvcihcbiAgICAgICdXZWJTb2NrZXQgaXMgbm90IGF2YWlsYWJsZSBpbiB0aGlzIE9ic2lkaWFuIGJ1aWxkIChpdCBpcyBidWlsdCBpbiBvbiBkZXNrdG9wIGFuZCAnICtcbiAgICAgICAgJ21vYmlsZTsgYSB2ZXJ5IG9sZCBhcHAgdmVyc2lvbiBvciBhIHN0cmlwcGVkIHdlYnZpZXcgaXMgdGhlIG9ubHkga25vd24gY2F1c2UpLiAnICtcbiAgICAgICAgJ1N5bmMgcmVxdWlyZXMgaXQuJyxcbiAgICApO1xuICB9XG4gIHJldHVybiBuZXcgKHdlYnNvY2tldCBhcyBuZXcgKHVybDogc3RyaW5nKSA9PiBXZWJTb2NrZXRMaWtlKSh1cmwpO1xufVxuXG5leHBvcnQgY2xhc3MgV2ViU29ja2V0VHJhbnNwb3J0IGltcGxlbWVudHMgVHJhbnNwb3J0IHtcbiAgcHJpdmF0ZSByZWFkb25seSBzb2NrZXQ6IFdlYlNvY2tldExpa2U7XG4gIHByaXZhdGUgbWVzc2FnZUNhbGxiYWNrOiAoKG1lc3NhZ2U6IE1lc3NhZ2UpID0+IHZvaWQpIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgY2xvc2VDYWxsYmFjazogKChyZWFzb246IENsb3NlUmVhc29uKSA9PiB2b2lkKSB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIG9wZW4gPSBmYWxzZTtcbiAgcHJpdmF0ZSBjbG9zZWQgPSBmYWxzZTtcbiAgcHJpdmF0ZSBjbG9zZU5vdGlmaWVkID0gZmFsc2U7XG4gIHByaXZhdGUgcmVhZG9ubHkgc2VuZFF1ZXVlOiBzdHJpbmdbXSA9IFtdO1xuICBwcml2YXRlIGxhc3RFcnJvcjogc3RyaW5nIHwgdW5kZWZpbmVkO1xuXG4gIGNvbnN0cnVjdG9yKG9wdGlvbnM6IFdlYlNvY2tldFRyYW5zcG9ydE9wdGlvbnMpIHtcbiAgICBjb25zdCBmYWN0b3J5ID0gb3B0aW9ucy53c0ZhY3RvcnkgPz8gZGVmYXVsdFdlYlNvY2tldEZhY3Rvcnk7XG4gICAgY29uc3QgdXJsID0gdG9XZWJTb2NrZXRVcmwob3B0aW9ucy51cmwsIG9wdGlvbnMudG9rZW4sIG9wdGlvbnMucGF0aCA/PyAnL3dzJyk7XG4gICAgdGhpcy5zb2NrZXQgPSBmYWN0b3J5KHVybCk7XG5cbiAgICB0aGlzLnNvY2tldC5hZGRFdmVudExpc3RlbmVyKCdvcGVuJywgKCkgPT4ge1xuICAgICAgdGhpcy5vcGVuID0gdHJ1ZTtcbiAgICAgIGNvbnN0IHF1ZXVlZCA9IFsuLi50aGlzLnNlbmRRdWV1ZV07XG4gICAgICB0aGlzLnNlbmRRdWV1ZS5sZW5ndGggPSAwO1xuICAgICAgZm9yIChjb25zdCBmcmFtZSBvZiBxdWV1ZWQpIHRoaXMuc29ja2V0LnNlbmQoZnJhbWUpO1xuICAgIH0pO1xuXG4gICAgdGhpcy5zb2NrZXQuYWRkRXZlbnRMaXN0ZW5lcignbWVzc2FnZScsIChldmVudCkgPT4ge1xuICAgICAgaWYgKHR5cGVvZiBldmVudC5kYXRhICE9PSAnc3RyaW5nJykge1xuICAgICAgICB0aGlzLmZhaWwoeyBjb2RlOiAxMDAzLCByZWFzb246ICdiaW5hcnkgZnJhbWVzIGFyZSBub3QgcGFydCBvZiB0aGUgcHJvdG9jb2wnIH0pO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBsZXQgbWVzc2FnZTogTWVzc2FnZTtcbiAgICAgIHRyeSB7XG4gICAgICAgIG1lc3NhZ2UgPSBwYXJzZU1lc3NhZ2UoZXZlbnQuZGF0YSk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICB0aGlzLmZhaWwoeyBjb2RlOiAxMDAyLCByZWFzb246IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKSB9KTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgdGhpcy5tZXNzYWdlQ2FsbGJhY2s/LihtZXNzYWdlKTtcbiAgICB9KTtcblxuICAgIHRoaXMuc29ja2V0LmFkZEV2ZW50TGlzdGVuZXIoJ2Vycm9yJywgKGV2ZW50KSA9PiB7XG4gICAgICB0aGlzLmxhc3RFcnJvciA9XG4gICAgICAgIGV2ZW50IGluc3RhbmNlb2YgRXJyb3IgPyBldmVudC5tZXNzYWdlIDogZXZlbnQgIT09IHVuZGVmaW5lZCA/IFN0cmluZyhldmVudCkgOiAnc29ja2V0IGVycm9yJztcbiAgICB9KTtcblxuICAgIHRoaXMuc29ja2V0LmFkZEV2ZW50TGlzdGVuZXIoJ2Nsb3NlJywgKGV2ZW50KSA9PiB7XG4gICAgICB0aGlzLmZpbmlzaENsb3NlKHtcbiAgICAgICAgY29kZTogZXZlbnQuY29kZSxcbiAgICAgICAgcmVhc29uOiBldmVudC5yZWFzb24gIT09IHVuZGVmaW5lZCAmJiBldmVudC5yZWFzb24gIT09ICcnID8gZXZlbnQucmVhc29uIDogdGhpcy5sYXN0RXJyb3IsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgfVxuXG4gIHNlbmQobWVzc2FnZTogTWVzc2FnZSk6IHZvaWQge1xuICAgIGlmICh0aGlzLmNsb3NlZCkgdGhyb3cgbmV3IE5ldHdvcmtFcnJvcignc2VuZCBvbiBhIGNsb3NlZCB0cmFuc3BvcnQnKTtcbiAgICBjb25zdCBmcmFtZSA9IEpTT04uc3RyaW5naWZ5KG1lc3NhZ2UpO1xuICAgIGlmICh0aGlzLm9wZW4pIHtcbiAgICAgIHRoaXMuc29ja2V0LnNlbmQoZnJhbWUpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLnNlbmRRdWV1ZS5wdXNoKGZyYW1lKTtcbiAgfVxuXG4gIG9uTWVzc2FnZShjYWxsYmFjazogKG1lc3NhZ2U6IE1lc3NhZ2UpID0+IHZvaWQpOiB2b2lkIHtcbiAgICB0aGlzLm1lc3NhZ2VDYWxsYmFjayA9IGNhbGxiYWNrO1xuICB9XG5cbiAgb25DbG9zZShjYWxsYmFjazogKHJlYXNvbjogQ2xvc2VSZWFzb24pID0+IHZvaWQpOiB2b2lkIHtcbiAgICB0aGlzLmNsb3NlQ2FsbGJhY2sgPSBjYWxsYmFjaztcbiAgfVxuXG4gIGNsb3NlKCk6IHZvaWQge1xuICAgIGlmICh0aGlzLmNsb3NlZCkgcmV0dXJuO1xuICAgIHRoaXMuY2xvc2VkID0gdHJ1ZTtcbiAgICB0aGlzLnNlbmRRdWV1ZS5sZW5ndGggPSAwO1xuICAgIHRyeSB7XG4gICAgICB0aGlzLnNvY2tldC5jbG9zZSgxMDAwLCAnY2xvc2VkIGJ5IGNhbGxlcicpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gYWxyZWFkeSBkZWFkIFx1MjAxNCB0aGUgY2xvc2UgZXZlbnQgbWF5IG5ldmVyIGFycml2ZVxuICAgIH1cbiAgICAvLyBOb3RpZnkgZXZlbiBpZiB0aGUgc29ja2V0IG5ldmVyIGVtaXRzICdjbG9zZScgKGZhaWxlZCBkaWFsKS5cbiAgICB0aGlzLmZpbmlzaENsb3NlKHsgY29kZTogMTAwMCwgcmVhc29uOiAnY2xvc2VkIGJ5IGNhbGxlcicgfSk7XG4gIH1cblxuICBwcml2YXRlIGZhaWwocmVhc29uOiBDbG9zZVJlYXNvbik6IHZvaWQge1xuICAgIHRoaXMuY2xvc2VkID0gdHJ1ZTtcbiAgICB0cnkge1xuICAgICAgdGhpcy5zb2NrZXQuY2xvc2UocmVhc29uLmNvZGUgPz8gMTAwMiwgcmVhc29uLnJlYXNvbiA/PyAnJyk7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBhbHJlYWR5IGNsb3NlZFxuICAgIH1cbiAgICB0aGlzLmZpbmlzaENsb3NlKHJlYXNvbik7XG4gIH1cblxuICBwcml2YXRlIGZpbmlzaENsb3NlKHJlYXNvbjogQ2xvc2VSZWFzb24pOiB2b2lkIHtcbiAgICB0aGlzLm9wZW4gPSBmYWxzZTtcbiAgICB0aGlzLmNsb3NlZCA9IHRydWU7XG4gICAgaWYgKHRoaXMuY2xvc2VOb3RpZmllZCkgcmV0dXJuO1xuICAgIHRoaXMuY2xvc2VOb3RpZmllZCA9IHRydWU7XG4gICAgdGhpcy5jbG9zZUNhbGxiYWNrPy4ocmVhc29uKTtcbiAgfVxufVxuIl0sCiAgIm1h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Q3ZFLFdBQUssYUFBYTtBQUNsQixXQUFLLGFBQWE7QUFDbEIsV0FBSyxRQUFRLE1BQU0sU0FBUyxLQUFLO0FBQ2pDLFVBQUk7QUFBQSxRQUNGO0FBQUEsUUFDQTtBQUFBLE1BQ0Y7QUFDQTtBQUFBLElBQ0Y7QUFDQSxTQUFLLFFBQVEsS0FBSyxTQUFTLEtBQUs7QUFBQSxFQUNsQztBQUFBO0FBQUEsRUFHQSxNQUFjLHNCQUFzQixTQUFnRDtBQUNsRixRQUFJO0FBQ0osUUFBSTtBQUNGLFlBQU0sUUFBUSxNQUFNLFFBQVEsU0FBUyx3QkFBd0I7QUFDN0QsZUFBUyxLQUFLLE1BQU0sSUFBSSxZQUFZLEVBQUUsT0FBTyxLQUFLLENBQUM7QUFBQSxJQUNyRCxTQUFRO0FBQ047QUFBQSxJQUNGO0FBQ0EsUUFDRSxPQUFPLE9BQU8sYUFBYSxZQUMzQixPQUFPLGFBQWEsS0FBSyxLQUFLLFVBQzlCO0FBQ0EsWUFBTSxPQUFPLE9BQU8sT0FBTyxlQUFlLFdBQVcsT0FBTyxhQUFhLE9BQU87QUFDaEYsWUFBTSxRQUFRLE9BQU8sT0FBTyxRQUFRLFdBQVcsT0FBTyxNQUFNO0FBQzVELFVBQUk7QUFBQSxRQUNGLDREQUE0RCxJQUFJLGdCQUFnQixLQUFLO0FBQUEsUUFHckY7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFDRjtBQUVBLFNBQVMsdUJBQXVCLE9BQXVCO0FBQ3JELE1BQUk7QUFDRixXQUFPLG1CQUFtQixLQUFLO0FBQUEsRUFDakMsU0FBUTtBQUNOLFdBQU87QUFBQSxFQUNUO0FBQ0Y7IiwKICAibmFtZXMiOiBbImltcG9ydF9vYnNpZGlhbiIsICJtb3ZlZCIsICJpc1BsYWluT2JqZWN0IiwgIl9hIiwgIl9iIiwgIl9jIiwgIl9kIiwgIl9lIiwgImNvbXBhcmVTdHJpbmdzIiwgImltcG9ydF9vYnNpZGlhbiIsICJpbXBvcnRfb2JzaWRpYW4iLCAiaW1wb3J0X29ic2lkaWFuIiwgIl9hIiwgIl9hIl0KfQo=
