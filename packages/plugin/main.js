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
    if (segments[1] === "plugins" && segments.length >= 4 && segments[segments.length - 1] === "data.json") {
      return true;
    }
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
function isLocalHost(url) {
  const host = url.hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1";
}
function toWebSocketUrl(baseUrl, path = "/ws") {
  const url = new URL(baseUrl);
  if (url.protocol === "http:") url.protocol = "ws:";
  else if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol !== "ws:" && url.protocol !== "wss:") {
    throw new NetworkError(`worker URL must be http(s):// or ws(s)://, got ${url.protocol}`);
  }
  if (url.protocol === "ws:" && !isLocalHost(url)) {
    throw new NetworkError(
      "worker URL must use https:// \u2014 cleartext http/ws is only allowed for localhost"
    );
  }
  url.pathname = path;
  url.search = "";
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
    const url = toWebSocketUrl(options.url, (_b = options.path) != null ? _b : "/ws");
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
        new WebSocketTransport({ url, wsFactory: this.overrides.wsFactory }),
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiLCAic3JjL3BsdWdpbi50cyIsICIuLi9jb3JlL3NyYy9wYXRocy50cyIsICIuLi9jb3JlL3NyYy9jbG9jay50cyIsICIuLi9jb3JlL3NyYy9oYXNoaW5nLnRzIiwgIi4uL2NvcmUvc3JjL2Vycm9ycy50cyIsICIuLi9jb3JlL3NyYy9sb2NhbGluZGV4LnRzIiwgIi4uL2NvcmUvc3JjL2VuZ2luZS50cyIsICIuLi9jb3JlL3NyYy9pZ25vcmUudHMiLCAiLi4vY29yZS9zcmMvcHJvdG9jb2wudHMiLCAiLi4vY29yZS9zcmMvY29uZmxpY3RuYW1lcy50cyIsICIuLi9jb3JlL3NyYy9yZXNvbHZlLnRzIiwgIi4uL2NvcmUvc3JjL3NjYW4udHMiLCAiLi4vY29yZS9zcmMvY2xpZW50LnRzIiwgIi4uL2NvcmUvc3JjL2NvbXBhdC50cyIsICJzcmMvYWRhcHRlcnMvb2JzaWRpYW4tc3RvcmFnZS50cyIsICJzcmMvYWRhcHRlcnMvb2JzaWRpYW4td2F0Y2gudHMiLCAic3JjL2Jsb2JzdG9yZS50cyIsICJzcmMvZGlhZ25vc3RpY3MudHMiLCAic3JjL2RhdGEudHMiLCAic3JjL3dvcmtlcmFwaS50cyIsICJzcmMvcGFpcmluZy50cyIsICJzcmMvcHJvdG9jb2wtaGFuZGxlci50cyIsICJzcmMvcmVjb25uZWN0LnRzIiwgInNyYy9zZXR0aW5ncy50cyIsICJzcmMvc3RhdHVzYmFyLnRzIiwgInNyYy90cmFuc3BvcnQudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8qKlxuICogUGx1Z2luIGVudHJ5IHBvaW50IFx1MjAxNCBPYnNpZGlhbiBsb2FkcyBgbWFpbi5qc2AgYW5kIGluc3RhbnRpYXRlcyB0aGUgZGVmYXVsdFxuICogZXhwb3J0LiBFdmVyeXRoaW5nIHJlYWwgbGl2ZXMgaW4gYHBsdWdpbi50c2AgKGFuZCBpdHMgbW9kdWxlcyk7IHRoaXMgZmlsZVxuICogb25seSByZS1leHBvcnRzLlxuICovXG5cbmV4cG9ydCB7IFZhdWx0U3luY1BsdWdpbiBhcyBkZWZhdWx0IH0gZnJvbSAnLi9wbHVnaW4uanMnO1xuIiwgIi8qKlxuICogYFZhdWx0U3luY1BsdWdpbmAgXHUyMDE0IHRoZSBPYnNpZGlhbiBjbGllbnQgKGRlc2t0b3AgKyBtb2JpbGUpLlxuICpcbiAqIG9ubG9hZDogbG9hZCBsaW5rIGlkZW50aXR5IFx1MjE5MiBpZiBsaW5rZWQsIGJ1aWxkIGBTeW5jQ2xpZW50YCAoY29yZSkgb3ZlciB0aGVcbiAqIE9ic2lkaWFuIGFkYXB0ZXJzIGFuZCBydW4gc3RhcnR1cCByZWNvbmNpbGlhdGlvbiAodGhlIHN5bmMtb24tb3BlblxuICogY29udHJhY3QsIEZSLTQvRlItNS9GUi0xMiksIHRoZW4gZW50ZXIgbGl2ZSBtb2RlICh2YXVsdCBldmVudHMgKyBwZXJpb2RpY1xuICogcmVzY2FuICsgZm9jdXMgcmVzY2FuKSB3aXRoIGEgc3RhdHVzLWJhciBpbmRpY2F0b3IgYW5kIGppdHRlcmVkXG4gKiBleHBvbmVudGlhbC1iYWNrb2ZmIHJlY29ubmVjdCAoY2FwcGVkIGF0IDYwIHMpLlxuICpcbiAqIEEgMSBIeiBcInN1cGVydmlzaW9uIHRpY2tcIiBkcml2ZXMgZXZlcnl0aGluZyB0aW1lLWJhc2VkOiBpdCByZXBhaW50cyB0aGVcbiAqIHN0YXR1cyBiYXIgYW5kIG5vdGljZXMgYGRpc2Nvbm5lY3RlZGAgXHUyMTkyIHNjaGVkdWxlcyBvbmUgcmVjb25uZWN0IGF0IGEgdGltZS5cbiAqIEFsbCB0aW1lcnMgYXJlIG93bmVkIGhlcmUgYW5kIHRvcm4gZG93biBpbiBgc3RvcFN5bmMoKWAvYG9udW5sb2FkYC5cbiAqL1xuXG5pbXBvcnQgeyBOb3RpY2UsIFBsdWdpbiB9IGZyb20gJ29ic2lkaWFuJztcbmltcG9ydCB0eXBlIHsgQXBwLCBQbHVnaW5NYW5pZmVzdCB9IGZyb20gJ29ic2lkaWFuJztcbmltcG9ydCB7XG4gIGNoZWNrU2VydmVyQ29tcGF0aWJpbGl0eSxcbiAgUmV2b2tlZEVycm9yLFxuICBTeW5jQ2xpZW50LFxuICBVbmF1dGhvcml6ZWRFcnJvcixcbiAgdHlwZSBDb21wYXRpYmlsaXR5VmVyZGljdCxcbiAgdHlwZSBTeW5jQ2xpZW50U3RhdHVzLFxufSBmcm9tICdAdnNhL2NvcmUnO1xuaW1wb3J0IHsgT2JzaWRpYW5TdG9yYWdlQWRhcHRlciB9IGZyb20gJy4vYWRhcHRlcnMvb2JzaWRpYW4tc3RvcmFnZS5qcyc7XG5pbXBvcnQgeyBPYnNpZGlhbldhdGNoQWRhcHRlciwgUmVzY2FuU2NoZWR1bGVyIH0gZnJvbSAnLi9hZGFwdGVycy9vYnNpZGlhbi13YXRjaC5qcyc7XG5pbXBvcnQgeyBIdHRwQmxvYlN0b3JlIH0gZnJvbSAnLi9ibG9ic3RvcmUuanMnO1xuaW1wb3J0IHtcbiAgYnVpbGREaWFnbm9zdGljc0J1bmRsZSxcbiAgYnVpbGRTdXBwb3J0QnVuZGxlLFxuICBjb3B5VG9DbGlwYm9hcmQsXG4gIGNyZWF0ZVBsdWdpbkxvZyxcbiAgZm9ybWF0U3VwcG9ydEJ1bmRsZVN0YW1wLFxuICBwbGF0Zm9ybVN1bW1hcnksXG4gIHdpdGhSb3VuZFRyaXBMb2dnaW5nLFxuICB0eXBlIERpYWdub3N0aWNzSW5wdXQsXG4gIHR5cGUgUGx1Z2luTG9nLFxufSBmcm9tICcuL2RpYWdub3N0aWNzLmpzJztcbmltcG9ydCB7XG4gIGRlZmF1bHREZXZpY2VOYW1lLFxuICBkZXRlY3REZXZpY2VUeXBlLFxuICBpc0xpbmtlZCxcbiAgbm9ybWFsaXplUGx1Z2luRGF0YSxcbiAgcGFyc2VJZ25vcmVQYXR0ZXJucyxcbiAgZGVmYXVsdFBsdWdpbkRhdGEsXG4gIHR5cGUgTG9nTGV2ZWwsXG4gIHR5cGUgVmF1bHRTeW5jUGx1Z2luRGF0YSxcbn0gZnJvbSAnLi9kYXRhLmpzJztcbmltcG9ydCB7IHBhaXJPdXRjb21lTWVzc2FnZSwgcGFpcldpdGhXb3JrZXIgfSBmcm9tICcuL3BhaXJpbmcuanMnO1xuaW1wb3J0IHR5cGUgeyBQYWlyT3V0Y29tZSB9IGZyb20gJy4vcGFpcmluZy5qcyc7XG5pbXBvcnQgeyByZWdpc3RlclBhaXJQcm90b2NvbEhhbmRsZXIgfSBmcm9tICcuL3Byb3RvY29sLWhhbmRsZXIuanMnO1xuaW1wb3J0IHsgUmVjb25uZWN0U3VwZXJ2aXNvciB9IGZyb20gJy4vcmVjb25uZWN0LmpzJztcbmltcG9ydCB0eXBlIHsgQmFja29mZk9wdGlvbnMgfSBmcm9tICcuL3JlY29ubmVjdC5qcyc7XG5pbXBvcnQgdHlwZSB7IFN0YXR1c0Jhck1vZGUgfSBmcm9tICcuL3N0YXR1c2Jhci5qcyc7XG5pbXBvcnQgeyBDb25maXJtTW9kYWwsIFZhdWx0U3luY1NldHRpbmdUYWIgfSBmcm9tICcuL3NldHRpbmdzLmpzJztcbmltcG9ydCB7IFN0YXR1c0JhckluZGljYXRvciB9IGZyb20gJy4vc3RhdHVzYmFyLmpzJztcbmltcG9ydCB7IFdlYlNvY2tldFRyYW5zcG9ydCB9IGZyb20gJy4vdHJhbnNwb3J0LmpzJztcbmltcG9ydCB0eXBlIHsgV2ViU29ja2V0RmFjdG9yeSB9IGZyb20gJy4vdHJhbnNwb3J0LmpzJztcbmltcG9ydCB7IGZldGNoV29ya2VyU3RhdHVzLCBub3JtYWxpemVXb3JrZXJVcmwsIHJlbmFtZURldmljZSB9IGZyb20gJy4vd29ya2VyYXBpLmpzJztcbmltcG9ydCB0eXBlIHsgV29ya2VyU3RhdHVzU3VtbWFyeSB9IGZyb20gJy4vd29ya2VyYXBpLmpzJztcblxuLyoqIFRoZSBpbi12YXVsdCBkZXZpY2UgbWFya2VyIHNoYXJlZCB3aXRoIHRoZSBkYWVtb24vQ0xJIChGUi00NCBoYW5kc2hha2UpLiAqL1xuY29uc3QgREVWSUNFX01BUktFUl9WQVVMVF9QQVRIID0gJy8udmF1bHRzeW5jZm9yYWdlbnRzL2RldmljZS5qc29uJztcbmNvbnN0IExPQ0FMX0lOREVYX1ZBVUxUX1BBVEggPSAnLy52YXVsdHN5bmNmb3JhZ2VudHMvc3RhdGUnO1xuLyoqIFdoZXJlIFwiU2F2ZSBzdXBwb3J0IGJ1bmRsZVwiIHdyaXRlcyBpdHMgZGlhZ25vc3RpYyBmaWxlLiAqL1xuY29uc3QgU1VQUE9SVF9CVU5ETEVfRElSX1ZBVUxUX1BBVEggPSAnLy52YXVsdHN5bmNmb3JhZ2VudHMnO1xuY29uc3QgU1VQRVJWSVNJT05fVElDS19NUyA9IDEwMDA7XG5cbi8qKiBUaW1lciBoYW5kbGVzIChudW1iZXIgaW4gdGhlIERPTSwgYFRpbWVvdXRgIHdoZW4gTm9kZSB0eXBlcyBsZWFrIGluKS4gKi9cbnR5cGUgVGltZXJIYW5kbGUgPSBSZXR1cm5UeXBlPHR5cGVvZiBzZXRJbnRlcnZhbD47XG5cbi8qKiBJbmplY3RhYmxlIHNlYW1zIHNvIHVuaXQgdGVzdHMgbmVlZCBubyByZWFsIE9ic2lkaWFuL25ldHdvcmsuICovXG5leHBvcnQgaW50ZXJmYWNlIFBsdWdpbk92ZXJyaWRlcyB7XG4gIGZldGNoSW1wbD86IHR5cGVvZiBmZXRjaDtcbiAgd3NGYWN0b3J5PzogV2ViU29ja2V0RmFjdG9yeTtcbiAgbm93PzogKCkgPT4gbnVtYmVyO1xuICAvKiogUmVjb25uZWN0IGJhY2tvZmYga25vYnMgKHRlc3RzIGluamVjdCBhIGRldGVybWluaXN0aWMgcmFuZG9tKS4gKi9cbiAgcmVjb25uZWN0PzogQmFja29mZk9wdGlvbnM7XG59XG5cbmV4cG9ydCBjbGFzcyBWYXVsdFN5bmNQbHVnaW4gZXh0ZW5kcyBQbHVnaW4ge1xuICBkYXRhOiBWYXVsdFN5bmNQbHVnaW5EYXRhID0gZGVmYXVsdFBsdWdpbkRhdGEoKTtcbiAgLyoqIFRoZSBsaXZlIHN5bmMgY2xpZW50IChudWxsIHdoaWxlIHVubGlua2VkL3N0b3BwZWQpLiAqL1xuICBjbGllbnQ6IFN5bmNDbGllbnQgfCBudWxsID0gbnVsbDtcblxuICBwcml2YXRlIHJlYWRvbmx5IG92ZXJyaWRlczogUGx1Z2luT3ZlcnJpZGVzO1xuICBwcml2YXRlIHdhdGNoZXI6IE9ic2lkaWFuV2F0Y2hBZGFwdGVyIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgcmVzY2FuOiBSZXNjYW5TY2hlZHVsZXIgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBzdGF0dXNCYXI6IFN0YXR1c0JhckluZGljYXRvciB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHN0YXR1c0Jhckl0ZW06IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgdGlja0hhbmRsZTogVGltZXJIYW5kbGUgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSByZWNvbm5lY3RUaW1lcjogVGltZXJIYW5kbGUgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBzdXBlcnZpc29yID0gbmV3IFJlY29ubmVjdFN1cGVydmlzb3IoKTtcbiAgLyoqIFNldCB3aGVuIHRoZSB3b3JrZXIgcmVqZWN0ZWQgdGhlIHRva2VuIFx1MjAxNCByZWNvbm5lY3RpbmcgY2Fubm90IGhlbHAuICovXG4gIHByaXZhdGUgYXV0aEZhaWxlZCA9IGZhbHNlO1xuICBwcml2YXRlIHN0YXR1c05vdGUgPSAnJztcbiAgLyoqXG4gICAqIExhdGVzdCBzZXJ2ZXItdmVyc2lvbiB2ZXJkaWN0IChjb3JlIGNvbXBhdC50cyksIHJlLWFzc2Vzc2VkIGJ5IHRoZVxuICAgKiBzdXBlcnZpc2lvbiB0aWNrIGFmdGVyIGV2ZXJ5IGhlbGxvQWNrOyBudWxsIGJlZm9yZSB0aGUgZmlyc3QgYWNrIG9mIGFcbiAgICogc3luYyBzZXNzaW9uLiBOb24tb2sgdmVyZGljdHMgcmlkZSB0aGUgc3RhdHVzLWJhciB0b29sdGlwOyBhIE5vdGljZSBpc1xuICAgKiBzaG93biBhdCBtb3N0IG9uY2UgcGVyIHBsdWdpbiBzZXNzaW9uLlxuICAgKi9cbiAgcHJpdmF0ZSBzZXJ2ZXJDb21wYXQ6IENvbXBhdGliaWxpdHlWZXJkaWN0IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgc2VydmVyQ29tcGF0Tm90aWZpZWQgPSBmYWxzZTtcbiAgLyoqIFBhdXNlLXN5bmNpbmcgc3RhdGUgKHJ1bnRpbWUgb25seSBcdTIwMTQgYSByZWxvYWQgc3RhcnRzIHBlciBzeW5jT25TdGFydHVwKS4gKi9cbiAgcHJpdmF0ZSBwYXVzZWQgPSBmYWxzZTtcbiAgLyoqIFRoZSBwbHVnaW4ncyBsb2c6IGNvbnNvbGUgbWlycm9yICsgYm91bmRlZCByaW5nIChDb3B5IGRpYWdub3N0aWNzKS4gKi9cbiAgcHJpdmF0ZSByZWFkb25seSBzeW5jTG9nOiBQbHVnaW5Mb2cgPSBjcmVhdGVQbHVnaW5Mb2coKTtcblxuICBjb25zdHJ1Y3RvcihhcHA6IEFwcCwgbWFuaWZlc3Q6IFBsdWdpbk1hbmlmZXN0LCBvdmVycmlkZXM6IFBsdWdpbk92ZXJyaWRlcyA9IHt9KSB7XG4gICAgc3VwZXIoYXBwLCBtYW5pZmVzdCk7XG4gICAgdGhpcy5vdmVycmlkZXMgPSBvdmVycmlkZXM7XG4gIH1cblxuICBwcml2YXRlIGdldCBub3coKTogKCkgPT4gbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy5vdmVycmlkZXMubm93ID8/ICgoKSA9PiBEYXRlLm5vdygpKTtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0IGZldGNoSW1wbCgpOiB0eXBlb2YgZmV0Y2gge1xuICAgIC8vIEJpbmQgYXQgdGhlIHNlYW06IGNvbnN1bWVycyAocGFpcmluZywgYEh0dHBCbG9iU3RvcmVgKSBpbnZva2UgdGhpcyBhcyBhXG4gICAgLy8gZGV0YWNoZWQgZnVuY3Rpb24sIGFuZCBhIGRldGFjaGVkIGBmZXRjaGAgdGhyb3dzXG4gICAgLy8gYFR5cGVFcnJvcjogRmFpbGVkIHRvIGV4ZWN1dGUgJ2ZldGNoJyBvbiAnV2luZG93JzogSWxsZWdhbCBpbnZvY2F0aW9uYFxuICAgIC8vIGluIENocm9taXVtIHJlbmRlcmVycyBcdTIwMTQgaS5lLiBpbiByZWFsIE9ic2lkaWFuIChkZXNrdG9wIGFuZCBtb2JpbGUpLlxuICAgIC8vIEJpbmRpbmcgdG8gdGhlIGdsb2JhbCBtYWtlcyB0aGUgZGVmYXVsdCBzYWZlIHRvIGNhbGwgYmFyZS5cbiAgICByZXR1cm4gdGhpcy5vdmVycmlkZXMuZmV0Y2hJbXBsID8/IGdsb2JhbFRoaXMuZmV0Y2guYmluZChnbG9iYWxUaGlzKTtcbiAgfVxuXG4gIGdldCBsaW5rZWQoKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGlzTGlua2VkKHRoaXMuZGF0YSk7XG4gIH1cblxuICBvdmVycmlkZSBhc3luYyBvbmxvYWQoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5kYXRhID0gbm9ybWFsaXplUGx1Z2luRGF0YShhd2FpdCB0aGlzLmxvYWREYXRhKCkpO1xuICAgIHRoaXMuc3luY0xvZy5zZXRMZXZlbCh0aGlzLmRhdGEuc2V0dGluZ3MubG9nTGV2ZWwpO1xuICAgIHRoaXMuYWRkU2V0dGluZ1RhYihuZXcgVmF1bHRTeW5jU2V0dGluZ1RhYih0aGlzLmFwcCwgdGhpcykpO1xuICAgIHJlZ2lzdGVyUGFpclByb3RvY29sSGFuZGxlcihcbiAgICAgIChhY3Rpb24sIGhhbmRsZXIpID0+IHRoaXMucmVnaXN0ZXJPYnNpZGlhblByb3RvY29sSGFuZGxlcihhY3Rpb24sIGhhbmRsZXIpLFxuICAgICAgKGxpbmspID0+IHRoaXMuaGFuZGxlUGFpckRlZXBMaW5rKGxpbmsudXJsLCBsaW5rLmNvZGUpLFxuICAgICk7XG4gICAgLy8gQ2hlYXAgZm9jdXMtZHJpdmVuIHJlc2NhbiAoRlItMTIpOiBldmVyeSBub3RlL2FwcCBzd2l0Y2ggcG9rZXMgdGhlXG4gICAgLy8gc2NoZWR1bGVyLCB3aGljaCBjb2FsZXNjZXMgaW50byBhdCBtb3N0IG9uZSBjeWNsZSBwZXIgZGVib3VuY2Ugd2luZG93LlxuICAgIHRoaXMucmVnaXN0ZXJFdmVudCh0aGlzLmFwcC53b3Jrc3BhY2Uub24oJ2FjdGl2ZS1sZWFmLWNoYW5nZScsICgpID0+IHRoaXMucmVzY2FuPy5wb2tlKCkpKTtcbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6ICdjb3B5LWRpYWdub3N0aWNzJyxcbiAgICAgIG5hbWU6ICdDb3B5IGRpYWdub3N0aWNzJyxcbiAgICAgIGNhbGxiYWNrOiAoKSA9PiB0aGlzLmNvcHlEaWFnbm9zdGljcygpLFxuICAgIH0pO1xuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogJ3NhdmUtc3VwcG9ydC1idW5kbGUnLFxuICAgICAgbmFtZTogJ1NhdmUgc3VwcG9ydCBidW5kbGUnLFxuICAgICAgY2FsbGJhY2s6ICgpID0+IHRoaXMuc2F2ZVN1cHBvcnRCdW5kbGUoKSxcbiAgICB9KTtcbiAgICAvLyBcIlN5bmMgb24gc3RhcnR1cFwiIE9GRiA9IG1hbnVhbC1vbmx5IG1vZGU6IGxvYWQgaWRsZTsgdGhlIGZpcnN0IFwiU3luY1xuICAgIC8vIG5vd1wiIHN0YXJ0cyB0aGUgbWFjaGluZXJ5ICh3YXRjaGVyIGluY2x1ZGVkKS5cbiAgICBpZiAodGhpcy5saW5rZWQgJiYgdGhpcy5kYXRhLnNldHRpbmdzLnN5bmNPblN0YXJ0dXApIGF3YWl0IHRoaXMuc3RhcnRTeW5jKCk7XG4gIH1cblxuICBvdmVycmlkZSBvbnVubG9hZCgpOiB2b2lkIHtcbiAgICB0aGlzLnN0b3BTeW5jKCk7XG4gIH1cblxuICAvLyAtLS0gcGVyc2lzdGVuY2UgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICBhc3luYyBzYXZlUGx1Z2luRGF0YSgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLnNhdmVEYXRhKHRoaXMuZGF0YSk7XG4gIH1cblxuICAvLyAtLS0gcGFpcmluZyAoc2V0dGluZ3MgdGFiICsgZGVlcCBsaW5rKSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIC8qKiBQYWlyIGZyb20gdGhlIHNldHRpbmdzIGZvcm0gKGZpZWxkcyBhbHJlYWR5IGxpdmUgaW4gYHRoaXMuZGF0YWApLiAqL1xuICBhc3luYyBwYWlyRnJvbVNldHRpbmdzKGNvZGU6IHN0cmluZyk6IFByb21pc2U8UGFpck91dGNvbWU+IHtcbiAgICBjb25zdCBkZXZpY2VOYW1lID0gdGhpcy5yZXNvbHZlRGV2aWNlTmFtZSgpO1xuICAgIGNvbnN0IG91dGNvbWUgPSBhd2FpdCBwYWlyV2l0aFdvcmtlcih7XG4gICAgICB1cmw6IHRoaXMuZGF0YS51cmwsXG4gICAgICBjb2RlLFxuICAgICAgZGV2aWNlTmFtZSxcbiAgICAgIGRldmljZVR5cGU6IGRldGVjdERldmljZVR5cGUoKSxcbiAgICAgIGZldGNoSW1wbDogdGhpcy5mZXRjaEltcGwsXG4gICAgfSk7XG4gICAgYXdhaXQgdGhpcy5hcHBseVBhaXJPdXRjb21lKG91dGNvbWUsIGRldmljZU5hbWUpO1xuICAgIHJldHVybiBvdXRjb21lO1xuICB9XG5cbiAgLyoqXG4gICAqIG9ic2lkaWFuOi8vdmF1bHRzeW5jZm9yYWdlbnRzL3BhaXI/dXJsPVx1MjAyNiZjb2RlPVx1MjAyNiAocHJvdG9jb2wtaGFuZGxlci50cykuXG4gICAqIE9uIGFuIHVubGlua2VkIHZhdWx0IHRoZSBsaW5rJ3Mgb3JpZ2luIGlzIHVudHJ1c3RlZCB1bnRpbCB0aGUgdXNlclxuICAgKiBhcHByb3ZlcyBpdCBcdTIwMTQgcGFpcmluZyB3b3VsZCBoYW5kIHRoZSB3aG9sZSB2YXVsdCB0byB3aGF0ZXZlciBob3N0IHRoZVxuICAgKiBsaW5rIGNhcnJpZWQgXHUyMDE0IHNvIGl0IGdvZXMgdGhyb3VnaCBhIGNvbmZpcm1hdGlvbiBuYW1pbmcgdGhhdCBleGFjdCBVUkwuXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIGhhbmRsZVBhaXJEZWVwTGluayh1cmw6IHN0cmluZywgY29kZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKHRoaXMubGlua2VkKSB7XG4gICAgICBpZiAobm9ybWFsaXplV29ya2VyVXJsU2FmZSh1cmwpID09PSBub3JtYWxpemVXb3JrZXJVcmxTYWZlKHRoaXMuZGF0YS51cmwpKSB7XG4gICAgICAgIG5ldyBOb3RpY2UoJ1ZhdWx0U3luYzogdGhpcyB2YXVsdCBpcyBhbHJlYWR5IHBhaXJlZCB3aXRoIHRoYXQgd29ya2VyLicpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbmV3IE5vdGljZShcbiAgICAgICAgICAnVmF1bHRTeW5jOiB0aGlzIHZhdWx0IGlzIHBhaXJlZCB3aXRoIGEgZGlmZmVyZW50IHdvcmtlci4gVW5saW5rIGl0IGluIHNldHRpbmdzIGZpcnN0LicsXG4gICAgICAgICAgMTAwMDAsXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIG5ldyBDb25maXJtTW9kYWwodGhpcy5hcHAsIHtcbiAgICAgIHRpdGxlOiAnUGFpciBWYXVsdFN5bmM/JyxcbiAgICAgIGJvZHk6XG4gICAgICAgIGBBIHBhaXJpbmcgbGluayBhc2tlZCBPYnNpZGlhbiB0byBwYWlyIHRoaXMgdmF1bHQgd2l0aCB0aGUgd29ya2VyIGF0OlxcblxcbiR7dXJsfVxcblxcbmAgK1xuICAgICAgICAnQXBwcm92aW5nIHBhaXJzIHRoaXMgZGV2aWNlIGFuZCBzZW5kcyB0aGlzIHZhdWx0XFx1MjAxOXMgbm90ZXMgdG8gdGhhdCB3b3JrZXIgZnJvbSB0aGVuIG9uLiAnICtcbiAgICAgICAgJ09ubHkgYXBwcm92ZSBhIGxpbmsgeW91IG9wZW5lZCBmcm9tIHlvdXIgb3duIHdvcmtlciBkYXNoYm9hcmQgXHUyMDE0IGFueSB3ZWIgcGFnZSBjYW4gY3JhZnQgb25lLicsXG4gICAgICBjb25maXJtVGV4dDogJ1BhaXInLFxuICAgICAgb25Db25maXJtOiAoKSA9PiB0aGlzLnBhaXJGcm9tRGVlcExpbmsodXJsLCBjb2RlKSxcbiAgICB9KS5vcGVuKCk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHBhaXJGcm9tRGVlcExpbmsodXJsOiBzdHJpbmcsIGNvZGU6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGRldmljZU5hbWUgPSB0aGlzLnJlc29sdmVEZXZpY2VOYW1lKCk7XG4gICAgY29uc3Qgb3V0Y29tZSA9IGF3YWl0IHBhaXJXaXRoV29ya2VyKHtcbiAgICAgIHVybCxcbiAgICAgIGNvZGUsXG4gICAgICBkZXZpY2VOYW1lLFxuICAgICAgZGV2aWNlVHlwZTogZGV0ZWN0RGV2aWNlVHlwZSgpLFxuICAgICAgZmV0Y2hJbXBsOiB0aGlzLmZldGNoSW1wbCxcbiAgICB9KTtcbiAgICBhd2FpdCB0aGlzLmFwcGx5UGFpck91dGNvbWUob3V0Y29tZSwgZGV2aWNlTmFtZSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGFwcGx5UGFpck91dGNvbWUob3V0Y29tZTogUGFpck91dGNvbWUsIGRldmljZU5hbWU6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmIChvdXRjb21lLnN0YXR1cyAhPT0gJ3BhaXJlZCcpIHtcbiAgICAgIG5ldyBOb3RpY2UocGFpck91dGNvbWVNZXNzYWdlKG91dGNvbWUpLCAxMDAwMCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRoaXMuZGF0YS51cmwgPSBvdXRjb21lLnVybDtcbiAgICB0aGlzLmRhdGEudG9rZW4gPSBvdXRjb21lLnRva2VuO1xuICAgIHRoaXMuZGF0YS5kZXZpY2VJZCA9IG91dGNvbWUuZGV2aWNlSWQ7XG4gICAgdGhpcy5kYXRhLmRldmljZU5hbWUgPSBkZXZpY2VOYW1lO1xuICAgIGF3YWl0IHRoaXMuc2F2ZVBsdWdpbkRhdGEoKTtcbiAgICBhd2FpdCB0aGlzLndyaXRlRGV2aWNlTWFya2VyKCk7XG4gICAgbmV3IE5vdGljZShwYWlyT3V0Y29tZU1lc3NhZ2Uob3V0Y29tZSkpO1xuICAgIGF3YWl0IHRoaXMuc3RhcnRTeW5jKCk7XG4gIH1cblxuICBwcml2YXRlIHJlc29sdmVEZXZpY2VOYW1lKCk6IHN0cmluZyB7XG4gICAgY29uc3QgdHlwZWQgPSB0aGlzLmRhdGEuZGV2aWNlTmFtZS50cmltKCk7XG4gICAgcmV0dXJuIHR5cGVkICE9PSAnJyA/IHR5cGVkIDogZGVmYXVsdERldmljZU5hbWUoKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBUaGUgdmF1bHQtYmFja2VkIHN0b3JhZ2UgYWRhcHRlciBldmVyeSBzeW5jIHN1cmZhY2UgdXNlcy4gV2lyZXMgdGhlXG4gICAqIGVtcHR5LWZvbGRlciByZW1vdmFsIHRocm91Z2ggYGZpbGVNYW5hZ2VyLnRyYXNoRmlsZWAgXHUyMDE0IE9ic2lkaWFuJ3NcbiAgICogYERhdGFBZGFwdGVyLnJtZGlyYCByZWZ1c2VzIEVWRVJZIGRpcmVjdG9yeSAoYEVSUl9GU19FSVNESVJgKSwgd2hpY2hcbiAgICogc2lsZW50bHkgZGVncmFkZWQgZm9sZGVyLXRvbWJzdG9uZSBhcHBsaWNhdGlvbiB0byByZWNvcmQtb25seSAoRi0xKS5cbiAgICogVHJhc2ggKG5vdCBkZWxldGUpIGJlY2F1c2UgYW4gZW1wdHkgZm9sZGVyIGlzIHRyaXZpYWxseSByZWNvdmVyYWJsZS5cbiAgICovXG4gIHByaXZhdGUgY3JlYXRlU3RvcmFnZUFkYXB0ZXIoKTogT2JzaWRpYW5TdG9yYWdlQWRhcHRlciB7XG4gICAgcmV0dXJuIG5ldyBPYnNpZGlhblN0b3JhZ2VBZGFwdGVyKHtcbiAgICAgIGFkYXB0ZXI6IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIsXG4gICAgICByZW1vdmVFbXB0eURpcjogYXN5bmMgKGFkYXB0ZXJQYXRoKSA9PiB7XG4gICAgICAgIGNvbnN0IGZvbGRlciA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChhZGFwdGVyUGF0aCk7XG4gICAgICAgIGlmIChmb2xkZXIgPT09IG51bGwpIHJldHVybjsgLy8gcmFjZWQgYXdheSAvIHRyZWUgbm90IGNhdWdodCB1cCBcdTIwMTQgaWRlbXBvdGVudFxuICAgICAgICBhd2FpdCB0aGlzLmFwcC5maWxlTWFuYWdlci50cmFzaEZpbGUoZm9sZGVyKTtcbiAgICAgIH0sXG4gICAgfSk7XG4gIH1cblxuICAvKiogV3JpdGUgdGhlIEZSLTQ0IG1hcmtlciB0aGUgQ0xJL2RhZW1vbiByZWFkIHRvIGRldGVjdCBkb3VibGUtY2xpZW50cy4gKi9cbiAgcHJpdmF0ZSBhc3luYyB3cml0ZURldmljZU1hcmtlcigpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIXRoaXMubGlua2VkKSByZXR1cm47XG4gICAgY29uc3Qgc3RvcmFnZSA9IHRoaXMuY3JlYXRlU3RvcmFnZUFkYXB0ZXIoKTtcbiAgICBjb25zdCBtYXJrZXIgPSB7XG4gICAgICBkZXZpY2VJZDogdGhpcy5kYXRhLmRldmljZUlkLFxuICAgICAgZGV2aWNlTmFtZTogdGhpcy5yZXNvbHZlRGV2aWNlTmFtZSgpLFxuICAgICAgdXJsOiB0aGlzLmRhdGEudXJsLFxuICAgICAgbGlua2VkQXQ6IHRoaXMubm93KCksXG4gICAgfTtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgc3RvcmFnZS53cml0ZUZpbGUoXG4gICAgICAgIERFVklDRV9NQVJLRVJfVkFVTFRfUEFUSCxcbiAgICAgICAgbmV3IFRleHRFbmNvZGVyKCkuZW5jb2RlKGAke0pTT04uc3RyaW5naWZ5KG1hcmtlciwgbnVsbCwgMil9XFxuYCksXG4gICAgICApO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLnN5bmNMb2cud2FybignZmFpbGVkIHRvIHdyaXRlIGRldmljZSBtYXJrZXInLCBlcnJvcik7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIGBQQVRDSCAvZGV2aWNlYCBcdTIwMTQgcmVuYW1lIFRISVMgZGV2aWNlIG9uIHRoZSB3b3JrZXIgKHRoZSBzZXR0aW5ncyB0YWInc1xuICAgKiBSZW5hbWUgYnV0dG9uKS4gVXBkYXRlcyBwbHVnaW4gZGF0YSArIHRoZSBpbi12YXVsdCBkZXZpY2UgbWFya2VyICh3aGljaFxuICAgKiBzdG9yZXMgdGhlIG5hbWUgZm9yIHRoZSBGUi00NCBkb3VibGUtY2xpZW50IHdhcm5pbmcpLiBMb2NhbCBzdGF0ZSBrZWVwc1xuICAgKiBpdHMgcHJldmlvdXMgbmFtZSBvbiBmYWlsdXJlLlxuICAgKi9cbiAgYXN5bmMgcmVuYW1lRGV2aWNlKG5hbWU6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIGlmICghdGhpcy5saW5rZWQpIHtcbiAgICAgIG5ldyBOb3RpY2UoJ1ZhdWx0U3luYzogcGFpciB0aGlzIHZhdWx0IGZpcnN0IFx1MjAxNCB0aGUgbmFtZSBhcHBsaWVzIGF0IHBhaXJpbmcgdGltZS4nKTtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgY29uc3QgdHJpbW1lZCA9IG5hbWUudHJpbSgpO1xuICAgIGlmICh0cmltbWVkID09PSAnJyB8fCB0cmltbWVkLmxlbmd0aCA+IDMwIHx8IC9bXFx1MDAwMC1cXHUwMDFmXFx1MDA3Zl0vLnRlc3QodHJpbW1lZCkpIHtcbiAgICAgIG5ldyBOb3RpY2UoJ1ZhdWx0U3luYzogZGV2aWNlIG5hbWUgbXVzdCBiZSAxLTMwIGNoYXJhY3RlcnMsIHdpdGhvdXQgY29udHJvbCBjaGFyYWN0ZXJzLicsIDgwMDApO1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICBjb25zdCBvdXRjb21lID0gYXdhaXQgcmVuYW1lRGV2aWNlKHtcbiAgICAgIG9yaWdpbjogdGhpcy5kYXRhLnVybCxcbiAgICAgIHRva2VuOiB0aGlzLmRhdGEudG9rZW4sXG4gICAgICBuYW1lOiB0cmltbWVkLFxuICAgICAgZmV0Y2hJbXBsOiB0aGlzLmZldGNoSW1wbCxcbiAgICB9KTtcbiAgICBpZiAoIW91dGNvbWUub2spIHtcbiAgICAgIG5ldyBOb3RpY2UoYFZhdWx0U3luYzogcmVuYW1pbmcgZmFpbGVkIFx1MjAxNCAke291dGNvbWUuZXJyb3J9YCwgMTAwMDApO1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICB0aGlzLmRhdGEuZGV2aWNlTmFtZSA9IG91dGNvbWUuZGV2aWNlLm5hbWU7XG4gICAgYXdhaXQgdGhpcy5zYXZlUGx1Z2luRGF0YSgpO1xuICAgIGF3YWl0IHRoaXMud3JpdGVEZXZpY2VNYXJrZXIoKTtcbiAgICBuZXcgTm90aWNlKGBWYXVsdFN5bmM6IGRldmljZSByZW5hbWVkIHRvIFx1MjAxQyR7b3V0Y29tZS5kZXZpY2UubmFtZX1cdTIwMUQuYCk7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICAvLyAtLS0gc3luYyBsaWZlY3ljbGUgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgLyoqIEJ1aWxkIGV2ZXJ5dGhpbmcgYW5kIHJ1biBzdGFydHVwIHJlY29uY2lsaWF0aW9uIChpZGVtcG90ZW50IHJlc3RhcnQpLiAqL1xuICBwcml2YXRlIGFzeW5jIHN0YXJ0U3luYygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIXRoaXMubGlua2VkKSByZXR1cm47XG4gICAgdGhpcy5zdG9wU3luYygpO1xuXG4gICAgY29uc3QgeyB1cmwsIHRva2VuLCBkZXZpY2VJZCB9ID0gdGhpcy5kYXRhO1xuICAgIGNvbnN0IGRldmljZU5hbWUgPSB0aGlzLnJlc29sdmVEZXZpY2VOYW1lKCk7XG4gICAgY29uc3Qgc3RvcmFnZSA9IHRoaXMuY3JlYXRlU3RvcmFnZUFkYXB0ZXIoKTtcbiAgICBhd2FpdCB0aGlzLndhcm5JZkZvcmVpZ25TdGF0ZURpcihzdG9yYWdlKTtcblxuICAgIGNvbnN0IGNsaWVudCA9IG5ldyBTeW5jQ2xpZW50KHtcbiAgICAgIGRldmljZUlkLFxuICAgICAgZGV2aWNlTmFtZSxcbiAgICAgIHRva2VuLFxuICAgICAgdHJhbnNwb3J0OiAoKSA9PlxuICAgICAgICB3aXRoUm91bmRUcmlwTG9nZ2luZyhcbiAgICAgICAgICBuZXcgV2ViU29ja2V0VHJhbnNwb3J0KHsgdXJsLCB3c0ZhY3Rvcnk6IHRoaXMub3ZlcnJpZGVzLndzRmFjdG9yeSB9KSxcbiAgICAgICAgICB7IGxvZzogdGhpcy5zeW5jTG9nLCBzaG91bGRMb2c6ICgpID0+IHRoaXMuc3luY0xvZy5kZWJ1Z0VuYWJsZWQgfSxcbiAgICAgICAgKSxcbiAgICAgIGJsb2JTdG9yZTogbmV3IEh0dHBCbG9iU3RvcmUoeyBiYXNlVXJsOiB1cmwsIHRva2VuLCBmZXRjaEltcGw6IHRoaXMuZmV0Y2hJbXBsIH0pLFxuICAgICAgc3RvcmFnZSxcbiAgICAgIHNldHRpbmdzOiB7XG4gICAgICAgIG9ic2lkaWFuU3luYzogdGhpcy5kYXRhLnNldHRpbmdzLm9ic2lkaWFuU3luYyxcbiAgICAgICAgZXh0cmFJZ25vcmVzOiBwYXJzZUlnbm9yZVBhdHRlcm5zKHRoaXMuZGF0YS5zZXR0aW5ncy5pZ25vcmVQYXR0ZXJucyksXG4gICAgICB9LFxuICAgICAgbG9nOiB0aGlzLnN5bmNMb2csXG4gICAgICBub3c6IHRoaXMubm93LFxuICAgIH0pO1xuICAgIHRoaXMuY2xpZW50ID0gY2xpZW50O1xuICAgIHRoaXMuYXV0aEZhaWxlZCA9IGZhbHNlO1xuICAgIHRoaXMuc3RhdHVzTm90ZSA9ICcnO1xuICAgIHRoaXMuc2VydmVyQ29tcGF0ID0gbnVsbDsgLy8gcmUtYXNzZXNzZWQgZnJvbSB0aGUgZnJlc2ggaGVsbG9BY2tcbiAgICB0aGlzLnN1cGVydmlzb3IgPSBuZXcgUmVjb25uZWN0U3VwZXJ2aXNvcih0aGlzLm92ZXJyaWRlcy5yZWNvbm5lY3QgPz8ge30pO1xuXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGNsaWVudC5jb25uZWN0KCk7IC8vIHN0YXJ0dXAgcmVjb25jaWxpYXRpb24gXHUyMTkyIGxpdmUgbW9kZVxuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmhhbmRsZVN5bmNFcnJvcihlcnJvciwgJ3N0YXJ0dXAgc3luYyBmYWlsZWQnKTtcbiAgICB9XG5cbiAgICAvLyBMaXZlIHdhdGNoaW5nOiB2YXVsdCBldmVudHMgKGRlYm91bmNlZCBpbiBjb3JlKSArIHJlc2NhbiBob29rcy5cbiAgICB0aGlzLndhdGNoZXIgPSBuZXcgT2JzaWRpYW5XYXRjaEFkYXB0ZXIoeyB2YXVsdDogdGhpcy5hcHAudmF1bHQgfSk7XG4gICAgY2xpZW50LnN0YXJ0V2F0Y2hpbmcodGhpcy53YXRjaGVyKTtcbiAgICB0aGlzLnJlc2NhbiA9IG5ldyBSZXNjYW5TY2hlZHVsZXIoe1xuICAgICAgaW50ZXJ2YWxNczogdGhpcy5kYXRhLnNldHRpbmdzLnJlc2NhbkludGVydmFsU2VjICogMTAwMCxcbiAgICB9KTtcbiAgICB0aGlzLnJlc2Nhbi5zdGFydCgoKSA9PiB7XG4gICAgICB2b2lkIGNsaWVudC50cmlnZ2VyU3luYygpLmNhdGNoKChlcnJvcjogdW5rbm93bikgPT4ge1xuICAgICAgICB0aGlzLmhhbmRsZVN5bmNFcnJvcihlcnJvciwgJ3Jlc2NhbiBmYWlsZWQnKTtcbiAgICAgIH0pO1xuICAgIH0pO1xuXG4gICAgLy8gU3RhdHVzIGJhciAocGVyIHRoZSBzdGF0dXNCYXJNb2RlIHNldHRpbmcpICsgdGhlIDEgSHogc3VwZXJ2aXNpb24gdGlja1xuICAgIC8vIHRoYXQgcmVwYWludHMgaXQgYW5kIHN1cGVydmlzZXMgcmVjb25uZWN0aW9uLlxuICAgIHRoaXMubW91bnRTdGF0dXNCYXIoKTtcbiAgICBjb25zdCB0aWNrID0gc2V0SW50ZXJ2YWwoKCkgPT4gdGhpcy5vblRpY2soKSwgU1VQRVJWSVNJT05fVElDS19NUyk7XG4gICAgdGhpcy50aWNrSGFuZGxlID0gdGljaztcbiAgICB0aGlzLnJlZ2lzdGVySW50ZXJ2YWwodGljayBhcyB1bmtub3duIGFzIG51bWJlcik7IC8vIE9ic2lkaWFuIGNsZWFycyB0aGlzIG9uIHVubG9hZFxuICAgIHRoaXMub25UaWNrKCk7XG4gIH1cblxuICAvKiogKFJlKW1vdW50IHRoZSBzdGF0dXMtYmFyIGl0ZW0gcGVyIHRoZSBjdXJyZW50IG1vZGUgKCdoaWRkZW4nID0gbm9uZSkuICovXG4gIHByaXZhdGUgbW91bnRTdGF0dXNCYXIoKTogdm9pZCB7XG4gICAgdGhpcy5zdGF0dXNCYXJJdGVtPy5yZW1vdmUoKTtcbiAgICB0aGlzLnN0YXR1c0Jhckl0ZW0gPSBudWxsO1xuICAgIHRoaXMuc3RhdHVzQmFyID0gbnVsbDtcbiAgICBpZiAodGhpcy5jbGllbnQgPT09IG51bGwpIHJldHVybjtcbiAgICBpZiAodGhpcy5kYXRhLnNldHRpbmdzLnN0YXR1c0Jhck1vZGUgPT09ICdoaWRkZW4nKSByZXR1cm47XG4gICAgY29uc3QgaXRlbSA9IHRoaXMuYWRkU3RhdHVzQmFySXRlbSgpO1xuICAgIHRoaXMuc3RhdHVzQmFySXRlbSA9IGl0ZW07XG4gICAgdGhpcy5zdGF0dXNCYXIgPSBuZXcgU3RhdHVzQmFySW5kaWNhdG9yKGl0ZW0pO1xuICB9XG5cbiAgLyoqIFRlYXIgZG93biBldmVyeSB0aW1lciwgd2F0Y2hlciwgc29ja2V0LCBhbmQgVUkgYXJ0aWZhY3QuIElkZW1wb3RlbnQuICovXG4gIHByaXZhdGUgc3RvcFN5bmMoKTogdm9pZCB7XG4gICAgaWYgKHRoaXMucmVjb25uZWN0VGltZXIgIT09IG51bGwpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aGlzLnJlY29ubmVjdFRpbWVyKTtcbiAgICAgIHRoaXMucmVjb25uZWN0VGltZXIgPSBudWxsO1xuICAgIH1cbiAgICBpZiAodGhpcy50aWNrSGFuZGxlICE9PSBudWxsKSB7XG4gICAgICBjbGVhckludGVydmFsKHRoaXMudGlja0hhbmRsZSk7XG4gICAgICB0aGlzLnRpY2tIYW5kbGUgPSBudWxsO1xuICAgIH1cbiAgICB0aGlzLnJlc2Nhbj8uc3RvcCgpO1xuICAgIHRoaXMucmVzY2FuID0gbnVsbDtcbiAgICB0aGlzLmNsaWVudD8uY2xvc2UoKTsgLy8gYWxzbyBzdG9wcyB0aGUgd2F0Y2hlclxuICAgIHRoaXMuY2xpZW50ID0gbnVsbDtcbiAgICB0aGlzLndhdGNoZXIgPSBudWxsO1xuICAgIHRoaXMuc3RhdHVzQmFySXRlbT8ucmVtb3ZlKCk7XG4gICAgdGhpcy5zdGF0dXNCYXJJdGVtID0gbnVsbDtcbiAgICB0aGlzLnN0YXR1c0JhciA9IG51bGw7XG4gIH1cblxuICAvLyAtLS0gdXNlciBhY3Rpb25zIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICBhc3luYyBzeW5jTm93KCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICh0aGlzLnBhdXNlZCkge1xuICAgICAgbmV3IE5vdGljZSgnVmF1bHRTeW5jOiBzeW5jaW5nIGlzIHBhdXNlZCBcdTIwMTQgcmVzdW1lIGl0IGluIHNldHRpbmdzIGZpcnN0LicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBjbGllbnQgPSB0aGlzLmNsaWVudDtcbiAgICBpZiAoY2xpZW50ID09PSBudWxsKSB7XG4gICAgICBpZiAoIXRoaXMubGlua2VkKSB7XG4gICAgICAgIG5ldyBOb3RpY2UoJ1ZhdWx0U3luYzogbm90IHBhaXJlZCB5ZXQgXHUyMDE0IGFkZCB5b3VyIHdvcmtlciBVUkwgYW5kIGEgcGFpcmluZyBjb2RlIGluIHNldHRpbmdzLicpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICAvLyBNYW51YWwtb25seSBtb2RlIChcIlN5bmMgb24gc3RhcnR1cFwiIE9GRik6IHRoaXMgaXMgdGhlIGZpcnN0IHN0YXJ0LlxuICAgICAgYXdhaXQgdGhpcy5zdGFydFN5bmMoKTtcbiAgICAgIGNvbnN0IHN0YXR1cyA9IHRoaXMuY2xpZW50Py5zdGF0dXMoKTtcbiAgICAgIGlmIChzdGF0dXMgIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBuZXcgTm90aWNlKFxuICAgICAgICAgIHN0YXR1cy5zdGF0ZSA9PT0gJ2Rpc2Nvbm5lY3RlZCdcbiAgICAgICAgICAgID8gJ1ZhdWx0U3luYzogb2ZmbGluZSBcdTIwMTQgY2hhbmdlcyB3aWxsIHN5bmMgd2hlbiB0aGUgd29ya2VyIGlzIHJlYWNoYWJsZS4nXG4gICAgICAgICAgICA6ICdWYXVsdFN5bmM6IHVwIHRvIGRhdGUuJyxcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IGNsaWVudC50cmlnZ2VyU3luYygpO1xuICAgICAgY29uc3Qgc3RhdHVzID0gY2xpZW50LnN0YXR1cygpO1xuICAgICAgbmV3IE5vdGljZShcbiAgICAgICAgc3RhdHVzLnN0YXRlID09PSAnZGlzY29ubmVjdGVkJ1xuICAgICAgICAgID8gJ1ZhdWx0U3luYzogb2ZmbGluZSBcdTIwMTQgY2hhbmdlcyB3aWxsIHN5bmMgd2hlbiB0aGUgd29ya2VyIGlzIHJlYWNoYWJsZS4nXG4gICAgICAgICAgOiAnVmF1bHRTeW5jOiB1cCB0byBkYXRlLicsXG4gICAgICApO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLmhhbmRsZVN5bmNFcnJvcihlcnJvciwgJ3N5bmMgbm93IGZhaWxlZCcpO1xuICAgICAgbmV3IE5vdGljZSgnVmF1bHRTeW5jOiBzeW5jIGZhaWxlZCBcdTIwMTQgc2VlIHRoZSBkZXZlbG9wZXIgY29uc29sZSBmb3IgZGV0YWlscy4nKTtcbiAgICB9XG4gIH1cblxuICAvKiogUGF1c2U6IHRyYW5zcG9ydCBkb3duICsgd2F0Y2hlci9yZXNjYW4gaWRsZSwgbGluayBhbmQgc3RhdGUga2VwdC4gKi9cbiAgcGF1c2VTeW5jaW5nKCk6IHZvaWQge1xuICAgIGlmICghdGhpcy5saW5rZWQgfHwgdGhpcy5wYXVzZWQpIHJldHVybjtcbiAgICB0aGlzLnBhdXNlZCA9IHRydWU7XG4gICAgaWYgKHRoaXMucmVjb25uZWN0VGltZXIgIT09IG51bGwpIHtcbiAgICAgIGNsZWFyVGltZW91dCh0aGlzLnJlY29ubmVjdFRpbWVyKTtcbiAgICAgIHRoaXMucmVjb25uZWN0VGltZXIgPSBudWxsO1xuICAgIH1cbiAgICB0aGlzLnN1cGVydmlzb3Iuc2V0dGxlZCgpO1xuICAgIHRoaXMucmVzY2FuPy5zdG9wKCk7XG4gICAgdGhpcy5yZXNjYW4gPSBudWxsO1xuICAgIHRoaXMuY2xpZW50Py5jbG9zZSgpOyAvLyBhbHNvIHN0b3BzIHRoZSB3YXRjaGVyOyBzdGF0ZSBcdTIxOTIgaWRsZVxuICAgIHRoaXMub25UaWNrKCk7IC8vIHJlcGFpbnQgXCJ2c2EgXHUyM0Y4XCJcbiAgICBuZXcgTm90aWNlKCdWYXVsdFN5bmM6IHBhdXNlZC4gTmV3IGFuZCBjaGFuZ2VkIGZpbGVzIHN0YXkgbG9jYWwgdW50aWwgeW91IHJlc3VtZS4nKTtcbiAgfVxuXG4gIC8qKiBSZXN1bWU6IHJlY29ubmVjdCBhbmQgcnVuIGEgZnVsbCBjYXRjaC11cCBjeWNsZSAoc3RhcnR1cCByZWNvbmNpbGlhdGlvbikuICovXG4gIGFzeW5jIHJlc3VtZVN5bmNpbmcoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCF0aGlzLmxpbmtlZCB8fCAhdGhpcy5wYXVzZWQpIHJldHVybjtcbiAgICB0aGlzLnBhdXNlZCA9IGZhbHNlO1xuICAgIG5ldyBOb3RpY2UoJ1ZhdWx0U3luYzogcmVzdW1pbmcgXHUyMDE0IHJ1bm5pbmcgYSBmdWxsIGNhdGNoLXVwIHN5bmNcdTIwMjYnKTtcbiAgICBhd2FpdCB0aGlzLnN0YXJ0U3luYygpO1xuICB9XG5cbiAgLyoqIFJ1bnRpbWUgcGF1c2Ugc3RhdGUgKHRoZSBzZXR0aW5ncyB0YWIncyBidXR0b24gbGFiZWwgKyBkaWFnbm9zdGljcykuICovXG4gIGdldCBzeW5jaW5nUGF1c2VkKCk6IGJvb2xlYW4ge1xuICAgIHJldHVybiB0aGlzLnBhdXNlZDtcbiAgfVxuXG4gIGFzeW5jIGFwcGx5UmVzY2FuSW50ZXJ2YWwoc2Vjb25kczogbnVtYmVyKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5kYXRhLnNldHRpbmdzLnJlc2NhbkludGVydmFsU2VjID0gTWF0aC5tYXgoMCwgTWF0aC5mbG9vcihzZWNvbmRzKSk7XG4gICAgYXdhaXQgdGhpcy5zYXZlUGx1Z2luRGF0YSgpO1xuICAgIHRoaXMucmVzY2FuPy5zZXRJbnRlcnZhbE1zKHRoaXMuZGF0YS5zZXR0aW5ncy5yZXNjYW5JbnRlcnZhbFNlYyAqIDEwMDApO1xuICB9XG5cbiAgYXN5bmMgYXBwbHlPYnNpZGlhblN5bmMoZW5hYmxlZDogYm9vbGVhbik6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuZGF0YS5zZXR0aW5ncy5vYnNpZGlhblN5bmMgPSBlbmFibGVkO1xuICAgIGF3YWl0IHRoaXMuc2F2ZVBsdWdpbkRhdGEoKTtcbiAgICBuZXcgTm90aWNlKFxuICAgICAgZW5hYmxlZFxuICAgICAgICA/ICdWYXVsdFN5bmM6IC5vYnNpZGlhbi8gd2lsbCBzeW5jIGFmdGVyIHRoZSBuZXh0IHJlY29ubmVjdCAodGhlIHdvcmtlclxcdTIwMTlzIHBlci12YXVsdCBzZXR0aW5nIHRha2VzIHByZWNlZGVuY2UpLidcbiAgICAgICAgOiAnVmF1bHRTeW5jOiAub2JzaWRpYW4vIHdpbGwgYmUgZXhjbHVkZWQgYWZ0ZXIgdGhlIG5leHQgcmVjb25uZWN0LicsXG4gICAgKTtcbiAgfVxuXG4gIGFzeW5jIGFwcGx5U3RhdHVzQmFyTW9kZShtb2RlOiBTdGF0dXNCYXJNb2RlKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5kYXRhLnNldHRpbmdzLnN0YXR1c0Jhck1vZGUgPSBtb2RlO1xuICAgIGF3YWl0IHRoaXMuc2F2ZVBsdWdpbkRhdGEoKTtcbiAgICB0aGlzLm1vdW50U3RhdHVzQmFyKCk7IC8vIHJlLW1vdW50cyAob3IgcmVtb3ZlcykgdGhlIGl0ZW0gcGVyIHRoZSBtb2RlXG4gICAgdGhpcy5vblRpY2soKTtcbiAgfVxuXG4gIGFzeW5jIGFwcGx5U3luY09uU3RhcnR1cChlbmFibGVkOiBib29sZWFuKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5kYXRhLnNldHRpbmdzLnN5bmNPblN0YXJ0dXAgPSBlbmFibGVkO1xuICAgIGF3YWl0IHRoaXMuc2F2ZVBsdWdpbkRhdGEoKTtcbiAgICBuZXcgTm90aWNlKFxuICAgICAgZW5hYmxlZFxuICAgICAgICA/ICdWYXVsdFN5bmM6IHN5bmNpbmcgd2lsbCBzdGFydCBhdXRvbWF0aWNhbGx5IHRoZSBuZXh0IHRpbWUgT2JzaWRpYW4gb3BlbnMuJ1xuICAgICAgICA6ICdWYXVsdFN5bmM6IG9uIHRoZSBuZXh0IGxhdW5jaCB0aGlzIHBsdWdpbiBzdGF5cyBpZGxlIHVudGlsIHlvdSBwcmVzcyBcdTIwMUNTeW5jIG5vd1x1MjAxRC4nLFxuICAgICk7XG4gIH1cblxuICBhc3luYyBhcHBseUxvZ0xldmVsKGxldmVsOiBMb2dMZXZlbCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuZGF0YS5zZXR0aW5ncy5sb2dMZXZlbCA9IGxldmVsO1xuICAgIGF3YWl0IHRoaXMuc2F2ZVBsdWdpbkRhdGEoKTtcbiAgICB0aGlzLnN5bmNMb2cuc2V0TGV2ZWwobGV2ZWwpO1xuICB9XG5cbiAgLyoqXG4gICAqIE5ldyBpZ25vcmUgcGF0dGVybnM6IHBlcnNpc3QsIHRoZW4gcmVzdGFydCB0aGUgc3luYyBtYWNoaW5lcnkgd2hpbGUgbGl2ZVxuICAgKiBzbyB0aGUgc2Nhbi93YXRjaGVyIHBpY2sgdGhlbSB1cCBpbW1lZGlhdGVseSAoYSBwYXVzZWQgc2Vzc2lvbiBhcHBsaWVzXG4gICAqIHRoZW0gb24gcmVzdW1lIFx1MjAxNCByZXN1bWUgYWx3YXlzIHJlYnVpbGRzIHRoZSBjbGllbnQpLlxuICAgKi9cbiAgYXN5bmMgYXBwbHlJZ25vcmVQYXR0ZXJucyh0ZXh0OiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLmRhdGEuc2V0dGluZ3MuaWdub3JlUGF0dGVybnMgPSB0ZXh0O1xuICAgIGF3YWl0IHRoaXMuc2F2ZVBsdWdpbkRhdGEoKTtcbiAgICBpZiAodGhpcy5jbGllbnQgIT09IG51bGwgJiYgIXRoaXMucGF1c2VkKSBhd2FpdCB0aGlzLnN0YXJ0U3luYygpO1xuICB9XG5cbiAgLyoqIFN0b3JhZ2UvYXR0YWNobWVudCBzdW1tYXJ5IGZvciB0aGUgQWJvdXQgc2VjdGlvbiAobnVsbCA9IHVuYXZhaWxhYmxlKS4gKi9cbiAgYXN5bmMgZmV0Y2hTdG9yYWdlU3VtbWFyeSgpOiBQcm9taXNlPFdvcmtlclN0YXR1c1N1bW1hcnkgfCBudWxsPiB7XG4gICAgaWYgKCF0aGlzLmxpbmtlZCkgcmV0dXJuIG51bGw7XG4gICAgcmV0dXJuIGZldGNoV29ya2VyU3RhdHVzKHtcbiAgICAgIG9yaWdpbjogdGhpcy5kYXRhLnVybCxcbiAgICAgIHRva2VuOiB0aGlzLmRhdGEudG9rZW4sXG4gICAgICBmZXRjaEltcGw6IHRoaXMuZmV0Y2hJbXBsLFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIFRoZSBzaGFyZWQgc25hcHNob3QgYmVoaW5kIFwiQ29weSBkaWFnbm9zdGljc1wiIGFuZCBcIlNhdmUgc3VwcG9ydCBidW5kbGVcIi5cbiAgICogU3RydWN0dXJhbGx5IHJlZGFjdGVkOiB0aGUgZGV2aWNlIHRva2VuIG5ldmVyIGVudGVycyAoaXQgbGl2ZXMgb25seSBpblxuICAgKiBgdGhpcy5kYXRhYCksIGFuZCBjb25mbGljdHMgY29udHJpYnV0ZSBwYXRocyBvbmx5IFx1MjAxNCBuZXZlciBmaWxlIGNvbnRlbnQuXG4gICAqL1xuICBwcml2YXRlIGNvbGxlY3REaWFnbm9zdGljc0lucHV0KCk6IERpYWdub3N0aWNzSW5wdXQge1xuICAgIGNvbnN0IHN0YXR1cyA9IHRoaXMuY2xpZW50Py5zdGF0dXMoKSA/PyBudWxsO1xuICAgIHJldHVybiB7XG4gICAgICBwbHVnaW5WZXJzaW9uOiB0aGlzLm1hbmlmZXN0LnZlcnNpb24gfHwgJ3Vua25vd24nLFxuICAgICAgZGV2aWNlSWQ6IHRoaXMuZGF0YS5kZXZpY2VJZCxcbiAgICAgIGRldmljZU5hbWU6IHRoaXMucmVzb2x2ZURldmljZU5hbWUoKSxcbiAgICAgIHdvcmtlclVybDogdGhpcy5kYXRhLnVybCxcbiAgICAgIHBhaXJlZDogdGhpcy5saW5rZWQsXG4gICAgICBwYXVzZWQ6IHRoaXMucGF1c2VkLFxuICAgICAgY2xpZW50U3RhdHVzOiBzdGF0dXMsXG4gICAgICByZWNlbnRMb2dMaW5lczogdGhpcy5zeW5jTG9nLnJlY2VudExpbmVzKCksXG4gICAgICBzZXJ2ZXJWZXJzaW9uOiBzdGF0dXM/LnNlcnZlclZlcnNpb24gPz8gbnVsbCxcbiAgICAgIHNldHRpbmdzOiB0aGlzLmRhdGEuc2V0dGluZ3MsXG4gICAgICByZWNlbnRDb25mbGljdHM6IHN0YXR1cyA9PT0gbnVsbCA/IFtdIDogc3RhdHVzLmNvbmZsaWN0cy5tYXAoKGNvbmZsaWN0KSA9PiAoeyBwYXRoOiBjb25mbGljdC5wYXRoIH0pKSxcbiAgICB9O1xuICB9XG5cbiAgLyoqIENvcHkgdGhlIGRpYWdub3N0aWNzIGJ1bmRsZSB0byB0aGUgY2xpcGJvYXJkIChmYWxsYmFjazogY29uc29sZSkuICovXG4gIGFzeW5jIGNvcHlEaWFnbm9zdGljcygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBidW5kbGUgPSBidWlsZERpYWdub3N0aWNzQnVuZGxlKHRoaXMuY29sbGVjdERpYWdub3N0aWNzSW5wdXQoKSk7XG4gICAgY29uc3QgY29waWVkID0gYXdhaXQgY29weVRvQ2xpcGJvYXJkKGJ1bmRsZSk7XG4gICAgaWYgKGNvcGllZCkge1xuICAgICAgbmV3IE5vdGljZSgnVmF1bHRTeW5jOiBkaWFnbm9zdGljcyBjb3BpZWQgdG8gdGhlIGNsaXBib2FyZC4nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc29sZS5pbmZvKCdbdnNhXSBkaWFnbm9zdGljcyAoY2xpcGJvYXJkIHVuYXZhaWxhYmxlKTpcXG4nICsgYnVuZGxlKTtcbiAgICBuZXcgTm90aWNlKCdWYXVsdFN5bmM6IGNsaXBib2FyZCB1bmF2YWlsYWJsZSBcdTIwMTQgZGlhZ25vc3RpY3Mgd3JpdHRlbiB0byB0aGUgZGV2ZWxvcGVyIGNvbnNvbGUuJywgMTAwMDApO1xuICB9XG5cbiAgLyoqXG4gICAqIFdyaXRlIHRoZSBzdXBwb3J0IGJ1bmRsZSAobWFya2Rvd24pIGludG8gYC52YXVsdHN5bmNmb3JhZ2VudHMvYCBpbiB0aGVcbiAgICogdmF1bHQgXHUyMDE0IHRoZSByaWNoZXIsIGF0dGFjaGFibGUgc2libGluZyBvZiBcIkNvcHkgZGlhZ25vc3RpY3NcIi5cbiAgICovXG4gIGFzeW5jIHNhdmVTdXBwb3J0QnVuZGxlKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG5vdyA9IHRoaXMubm93KCk7XG4gICAgY29uc3QgbWFya2Rvd24gPSBidWlsZFN1cHBvcnRCdW5kbGUodGhpcy5jb2xsZWN0RGlhZ25vc3RpY3NJbnB1dCgpLCBub3cpO1xuICAgIGNvbnN0IGZpbGVOYW1lID0gYHN1cHBvcnQtYnVuZGxlLSR7Zm9ybWF0U3VwcG9ydEJ1bmRsZVN0YW1wKG5vdyl9Lm1kYDtcbiAgICBjb25zdCB2YXVsdFBhdGggPSBgJHtTVVBQT1JUX0JVTkRMRV9ESVJfVkFVTFRfUEFUSH0vJHtmaWxlTmFtZX1gO1xuICAgIHRyeSB7XG4gICAgICAvLyBUaGUgc3RvcmFnZSBhZGFwdGVyIG1rZGlycyB0aGUgc3RhdGUgZGlyIG9uIGRlbWFuZCAoaXQgY2FuIGJlIGFic2VudFxuICAgICAgLy8gYmVmb3JlIHRoZSBmaXJzdCBzeW5jKSBhbmQgZmFsbHMgYmFjayB0byBhIHBsYWluIHdyaXRlIHdoZXJlIHRoZVxuICAgICAgLy8gYWRhcHRlciBjYW5ub3QgcmVuYW1lLlxuICAgICAgYXdhaXQgdGhpcy5jcmVhdGVTdG9yYWdlQWRhcHRlcigpLndyaXRlRmlsZSh2YXVsdFBhdGgsIG5ldyBUZXh0RW5jb2RlcigpLmVuY29kZShtYXJrZG93bikpO1xuICAgICAgbmV3IE5vdGljZShgVmF1bHRTeW5jOiBzdXBwb3J0IGJ1bmRsZSBzYXZlZCB0byAke3ZhdWx0UGF0aC5zbGljZSgxKX0uYCk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuc3luY0xvZy53YXJuKCdmYWlsZWQgdG8gd3JpdGUgc3VwcG9ydCBidW5kbGUnLCBlcnJvcik7XG4gICAgICBuZXcgTm90aWNlKCdWYXVsdFN5bmM6IGNvdWxkIG5vdCB3cml0ZSB0aGUgc3VwcG9ydCBidW5kbGUgXHUyMDE0IHNlZSB0aGUgZGV2ZWxvcGVyIGNvbnNvbGUuJywgMTAwMDApO1xuICAgIH1cbiAgfVxuXG4gIC8qKiBUaGUgcGxhdGZvcm0gbGluZSBmb3IgdGhlIEFib3V0L2RpYWdub3N0aWNzIHJlYWRvdXRzLiAqL1xuICBwbGF0Zm9ybVN1bW1hcnkoKTogc3RyaW5nIHtcbiAgICByZXR1cm4gcGxhdGZvcm1TdW1tYXJ5KCk7XG4gIH1cblxuICBhc3luYyB1bmxpbmsoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5zdG9wU3luYygpO1xuICAgIHRoaXMucGF1c2VkID0gZmFsc2U7XG4gICAgLy8gQ2xlYXIgbG9jYWwgc3luYyBzdGF0ZSAoZGV2aWNlIG1hcmtlciArIGluZGV4KSBzbyBhIGZ1dHVyZSBjbGllbnQgXHUyMDE0XG4gICAgLy8gdGhpcyBwbHVnaW4gYWZ0ZXIgYSByZS1wYWlyLCB0aGUgZGFlbW9uLCB0aGUgQ0xJIFx1MjAxNCBzdGFydHMgY2xlYW5cbiAgICAvLyAoRlItNDQ6IHN0YWxlIHN0YXRlIHdvdWxkIG1ha2UgaXQgcmVmdXNlIG9yIG1pcy1zeW5jKS5cbiAgICBjb25zdCBzdG9yYWdlID0gdGhpcy5jcmVhdGVTdG9yYWdlQWRhcHRlcigpO1xuICAgIGF3YWl0IHN0b3JhZ2UuZGVsZXRlRmlsZShERVZJQ0VfTUFSS0VSX1ZBVUxUX1BBVEgpO1xuICAgIGF3YWl0IHN0b3JhZ2UuZGVsZXRlRmlsZShMT0NBTF9JTkRFWF9WQVVMVF9QQVRIKTtcbiAgICB0aGlzLmRhdGEgPSB7XG4gICAgICAuLi5kZWZhdWx0UGx1Z2luRGF0YSgpLFxuICAgICAgZGV2aWNlTmFtZTogdGhpcy5kYXRhLmRldmljZU5hbWUsXG4gICAgICBzZXR0aW5nczogdGhpcy5kYXRhLnNldHRpbmdzLFxuICAgIH07XG4gICAgYXdhaXQgdGhpcy5zYXZlUGx1Z2luRGF0YSgpO1xuICAgIG5ldyBOb3RpY2UoXG4gICAgICAnVmF1bHRTeW5jOiB1bmxpbmtlZC4gUmV2b2tlIHRoaXMgZGV2aWNlIGZyb20gdGhlIHdvcmtlciBkYXNoYm9hcmQgaWYgeW91IGFyZSBkb25lIHdpdGggaXQuJyxcbiAgICApO1xuICB9XG5cbiAgLy8gLS0tIHN1cGVydmlzaW9uIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgcHJpdmF0ZSBvblRpY2soKTogdm9pZCB7XG4gICAgY29uc3QgY2xpZW50ID0gdGhpcy5jbGllbnQ7XG4gICAgaWYgKGNsaWVudCA9PT0gbnVsbCkgcmV0dXJuO1xuICAgIGNvbnN0IHN0YXR1cyA9IGNsaWVudC5zdGF0dXMoKTtcbiAgICB0aGlzLmFzc2Vzc1NlcnZlclZlcnNpb24oc3RhdHVzKTtcbiAgICB0aGlzLnN0YXR1c0Jhcj8udXBkYXRlKFxuICAgICAgc3RhdHVzLFxuICAgICAge1xuICAgICAgICB1cmw6IHRoaXMuZGF0YS51cmwsXG4gICAgICAgIGRldmljZU5hbWU6IHRoaXMucmVzb2x2ZURldmljZU5hbWUoKSxcbiAgICAgICAgLy8gQm90aCBub3RlcyBjYW4gYmUgbGl2ZSBhdCBvbmNlIChhbiBhdXRoLWZhaWx1cmUgbm90ZSB3aGlsZSB0aGVcbiAgICAgICAgLy8gc2VydmVyIGFsc28gcmVwb3J0cyB2ZXJzaW9uIHNrZXcpOiBjb25jYXRlbmF0ZSBpbnN0ZWFkIG9mIGxldHRpbmdcbiAgICAgICAgLy8gZWl0aGVyIGhpZGUgdGhlIG90aGVyOyBlbXB0eSBwYXJ0cyBkcm9wIG91dC5cbiAgICAgICAgbm90ZTogW3RoaXMuc3RhdHVzTm90ZSwgdGhpcy5zZXJ2ZXJDb21wYXROb3RlXS5maWx0ZXIoKHBhcnQpID0+IHBhcnQgIT09ICcnKS5qb2luKCcgXHUwMEI3ICcpLFxuICAgICAgICBwYXVzZWQ6IHRoaXMucGF1c2VkLFxuICAgICAgICBtb2RlOiB0aGlzLmRhdGEuc2V0dGluZ3Muc3RhdHVzQmFyTW9kZSxcbiAgICAgIH0sXG4gICAgICB0aGlzLm5vdygpLFxuICAgICk7XG4gICAgaWYgKHRoaXMucGF1c2VkIHx8IHRoaXMuYXV0aEZhaWxlZCkgcmV0dXJuOyAvLyBubyByZWNvbm5lY3Qgd2hpbGUgcGF1c2VkIC8gdG9rZW4gcmVqZWN0ZWRcbiAgICBjb25zdCBkZWNpc2lvbiA9IHRoaXMuc3VwZXJ2aXNvci5jb25zaWRlcihzdGF0dXMuc3RhdGUpO1xuICAgIGlmIChkZWNpc2lvbi5hY3Rpb24gPT09ICd3YWl0JykgcmV0dXJuO1xuICAgIHRoaXMuc3VwZXJ2aXNvci5hY2tub3dsZWRnZWQoKTtcbiAgICB0aGlzLnNjaGVkdWxlUmVjb25uZWN0KGRlY2lzaW9uLmRlbGF5TXMpO1xuICB9XG5cbiAgLyoqXG4gICAqIExhdGVzdCBzZXJ2ZXItdmVyc2lvbiB2ZXJkaWN0IGZvciB0aGUgc2V0dGluZ3MgdGFiOyBudWxsIHVudGlsIHRoZSBmaXJzdFxuICAgKiBoZWxsb0FjayBvZiB0aGUgY3VycmVudCBzeW5jIHNlc3Npb24uXG4gICAqL1xuICBnZXQgc2VydmVyQ29tcGF0aWJpbGl0eSgpOiBDb21wYXRpYmlsaXR5VmVyZGljdCB8IG51bGwge1xuICAgIHJldHVybiB0aGlzLnNlcnZlckNvbXBhdDtcbiAgfVxuXG4gIC8qKiBUaGUgdmVyZGljdCdzIHRvb2x0aXAgbGluZSAoJycgd2hlbiBjb21wYXRpYmxlIFx1MjAxNCBub3RoaW5nIHRvIG5hZyBhYm91dCkuICovXG4gIHByaXZhdGUgZ2V0IHNlcnZlckNvbXBhdE5vdGUoKTogc3RyaW5nIHtcbiAgICByZXR1cm4gdGhpcy5zZXJ2ZXJDb21wYXQgIT09IG51bGwgJiYgdGhpcy5zZXJ2ZXJDb21wYXQubGV2ZWwgIT09ICdvaydcbiAgICAgID8gdGhpcy5zZXJ2ZXJDb21wYXQubWVzc2FnZVxuICAgICAgOiAnJztcbiAgfVxuXG4gIC8qKlxuICAgKiBWZXJzaW9uLXNrZXcgYXNzZXNzbWVudCwgcnVuIGJ5IHRoZSB0aWNrIG9uY2UgdGhlIGNvbm5lY3Rpb24gaGFzIGFja2VkXG4gICAqIChzdGF0ZXMgJ3N5bmNpbmcnLydsaXZlJyBib3RoIGZvbGxvdyB0aGUgaGVsbG9BY2s7IHByZS1hY2sgc3RhdGVzIHJlYWRcbiAgICogc2VydmVyVmVyc2lvbiBudWxsIGZvciBcIm5vdCB5ZXQga25vd25cIiBhbmQgbXVzdCBub3QgcHJvZHVjZSBhIHNwdXJpb3VzXG4gICAqIFwibGVnYWN5IHNlcnZlclwiIHZlcmRpY3QpLiBOZXZlciBraWxscyBzeW5jOiB0aGUgd2lyZSBgUHJvdG9jb2xWZXJzaW9uYFxuICAgKiBjaGVjayBhdCBoZWxsbyByZW1haW5zIHRoZSBoYXJkIGdhdGU7IGEgdmVyZGljdCBpcyBhZHZpc29yeS5cbiAgICovXG4gIHByaXZhdGUgYXNzZXNzU2VydmVyVmVyc2lvbihzdGF0dXM6IFN5bmNDbGllbnRTdGF0dXMpOiB2b2lkIHtcbiAgICBpZiAoc3RhdHVzLnN0YXRlICE9PSAnc3luY2luZycgJiYgc3RhdHVzLnN0YXRlICE9PSAnbGl2ZScpIHJldHVybjtcbiAgICBjb25zdCB2ZXJkaWN0ID0gY2hlY2tTZXJ2ZXJDb21wYXRpYmlsaXR5KHRoaXMubWFuaWZlc3QudmVyc2lvbiB8fCAndW5rbm93bicsIHN0YXR1cy5zZXJ2ZXJWZXJzaW9uKTtcbiAgICB0aGlzLnNlcnZlckNvbXBhdCA9IHZlcmRpY3Q7XG4gICAgaWYgKHZlcmRpY3QubGV2ZWwgPT09ICdvaycpIHJldHVybjsgLy8gYWxzbyBjbGVhcnMgYW55IHN0YWxlIHRvb2x0aXAgbm90ZVxuICAgIGlmICh0aGlzLnNlcnZlckNvbXBhdE5vdGlmaWVkKSByZXR1cm47IC8vIG9uZSBOb3RpY2UgcGVyIHBsdWdpbiBzZXNzaW9uXG4gICAgdGhpcy5zZXJ2ZXJDb21wYXROb3RpZmllZCA9IHRydWU7XG4gICAgbmV3IE5vdGljZShgVmF1bHRTeW5jOiAke3ZlcmRpY3QubWVzc2FnZX1gLCAxMDAwMCk7XG4gIH1cblxuICBwcml2YXRlIHNjaGVkdWxlUmVjb25uZWN0KGRlbGF5TXM6IG51bWJlcik6IHZvaWQge1xuICAgIGlmICh0aGlzLnJlY29ubmVjdFRpbWVyICE9PSBudWxsKSByZXR1cm47IC8vIG9uZSBpbiBmbGlnaHQsIGFsd2F5c1xuICAgIHRoaXMucmVjb25uZWN0VGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRoaXMucmVjb25uZWN0VGltZXIgPSBudWxsO1xuICAgICAgY29uc3QgY2xpZW50ID0gdGhpcy5jbGllbnQ7XG4gICAgICBpZiAoY2xpZW50ID09PSBudWxsKSB7XG4gICAgICAgIHRoaXMuc3VwZXJ2aXNvci5zZXR0bGVkKCk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGNsaWVudFxuICAgICAgICAucmVjb25uZWN0KClcbiAgICAgICAgLnRoZW4oXG4gICAgICAgICAgKCkgPT4ge1xuICAgICAgICAgICAgdGhpcy5zdXBlcnZpc29yLnNldHRsZWQoKTtcbiAgICAgICAgICB9LFxuICAgICAgICAgIChlcnJvcjogdW5rbm93bikgPT4ge1xuICAgICAgICAgICAgdGhpcy5zdXBlcnZpc29yLnNldHRsZWQoKTtcbiAgICAgICAgICAgIHRoaXMuaGFuZGxlU3luY0Vycm9yKGVycm9yLCAncmVjb25uZWN0IGZhaWxlZCcpO1xuICAgICAgICAgIH0sXG4gICAgICAgIClcbiAgICAgICAgLmNhdGNoKCgpID0+IHt9KTsgLy8gaGFuZGxlU3luY0Vycm9yIG5ldmVyIHRocm93czsgYmVsdCBhbmQgYnJhY2VzXG4gICAgfSwgZGVsYXlNcyk7XG4gIH1cblxuICAvKiogRGlzdGluZ3Vpc2ggZmF0YWwgYXV0aCBmYWlsdXJlcyBmcm9tIHRyYW5zaWVudCBuZXR3b3JrIHRyb3VibGUuICovXG4gIHByaXZhdGUgaGFuZGxlU3luY0Vycm9yKGVycm9yOiB1bmtub3duLCBjb250ZXh0OiBzdHJpbmcpOiB2b2lkIHtcbiAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBSZXZva2VkRXJyb3IgfHwgZXJyb3IgaW5zdGFuY2VvZiBVbmF1dGhvcml6ZWRFcnJvcikge1xuICAgICAgdGhpcy5hdXRoRmFpbGVkID0gdHJ1ZTtcbiAgICAgIHRoaXMuc3RhdHVzTm90ZSA9ICdEZXZpY2UgdG9rZW4gcmVqZWN0ZWQgXHUyMDE0IHVubGluayBhbmQgcmUtcGFpciB3aXRoIGEgZnJlc2ggY29kZS4nO1xuICAgICAgdGhpcy5zeW5jTG9nLmVycm9yKGNvbnRleHQsIGVycm9yKTtcbiAgICAgIG5ldyBOb3RpY2UoXG4gICAgICAgICdWYXVsdFN5bmM6IHRoZSB3b3JrZXIgcmVqZWN0ZWQgdGhpcyBkZXZpY2VcXHUyMDE5cyB0b2tlbiAocmV2b2tlZD8pLiBVbmxpbmsgYW5kIHJlLXBhaXIgZnJvbSBzZXR0aW5ncy4nLFxuICAgICAgICAxMDAwMCxcbiAgICAgICk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRoaXMuc3luY0xvZy53YXJuKGNvbnRleHQsIGVycm9yKTsgLy8gb2ZmbGluZS9wcm90b2NvbDogYmFja29mZiBrZWVwcyByZXRyeWluZ1xuICB9XG5cbiAgLyoqIEZSLTQ0OiB3YXJuIHdoZW4gdGhlIHZhdWx0J3Mgc3RhdGUgZGlyIGJlbG9uZ3MgdG8gYW5vdGhlciBjbGllbnQuICovXG4gIHByaXZhdGUgYXN5bmMgd2FybklmRm9yZWlnblN0YXRlRGlyKHN0b3JhZ2U6IE9ic2lkaWFuU3RvcmFnZUFkYXB0ZXIpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBsZXQgbWFya2VyOiB7IGRldmljZUlkPzogdW5rbm93bjsgZGV2aWNlTmFtZT86IHVua25vd247IHVybD86IHVua25vd24gfTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgYnl0ZXMgPSBhd2FpdCBzdG9yYWdlLnJlYWRGaWxlKERFVklDRV9NQVJLRVJfVkFVTFRfUEFUSCk7XG4gICAgICBtYXJrZXIgPSBKU09OLnBhcnNlKG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShieXRlcykpIGFzIHR5cGVvZiBtYXJrZXI7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm47IC8vIG5vIG1hcmtlciAob3IgdW5yZWFkYWJsZSkgXHUyMDE0IG5vdGhpbmcgdG8gd2FybiBhYm91dFxuICAgIH1cbiAgICBpZiAoXG4gICAgICB0eXBlb2YgbWFya2VyLmRldmljZUlkID09PSAnc3RyaW5nJyAmJlxuICAgICAgbWFya2VyLmRldmljZUlkICE9PSB0aGlzLmRhdGEuZGV2aWNlSWRcbiAgICApIHtcbiAgICAgIGNvbnN0IG5hbWUgPSB0eXBlb2YgbWFya2VyLmRldmljZU5hbWUgPT09ICdzdHJpbmcnID8gbWFya2VyLmRldmljZU5hbWUgOiBtYXJrZXIuZGV2aWNlSWQ7XG4gICAgICBjb25zdCB3aGVyZSA9IHR5cGVvZiBtYXJrZXIudXJsID09PSAnc3RyaW5nJyA/IG1hcmtlci51cmwgOiAnYSB3b3JrZXInO1xuICAgICAgbmV3IE5vdGljZShcbiAgICAgICAgYFZhdWx0U3luYzogdGhpcyB2YXVsdCBhbHJlYWR5IGhhcyBzeW5jIHN0YXRlIGZvciBkZXZpY2UgXCIke25hbWV9XCIgKGxpbmtlZCB0byAke3doZXJlfSkuIGAgK1xuICAgICAgICAgICdPbmUgc3luYyBjbGllbnQgcGVyIG1hY2hpbmUgcGVyIHZhdWx0IFx1MjAxNCBydW5uaW5nIHR3byBkb3VibGUtY29tbWl0cyBldmVyeSBjaGFuZ2UuICcgK1xuICAgICAgICAgICdVbmxpbmsgdGhlIG90aGVyIGNsaWVudCAob3IgY2xlYXIgLnZhdWx0c3luY2ZvcmFnZW50cy8pIGlmIHRoaXMgaXMgdW5leHBlY3RlZC4nLFxuICAgICAgICAxNTAwMCxcbiAgICAgICk7XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZVdvcmtlclVybFNhZmUoaW5wdXQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZVdvcmtlclVybChpbnB1dCk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBpbnB1dDtcbiAgfVxufVxuIiwgIi8qKlxuICogVmF1bHQgcGF0aCB1dGlsaXRpZXMuXG4gKlxuICogVmF1bHQtaW50ZXJuYWwgcGF0aHMgYXJlIFBPU0lYLW5vcm1hbGl6ZWQgc3RyaW5ncyByZWxhdGl2ZSB0byB0aGUgdmF1bHQgcm9vdDpcbiAqICAgLSBhbHdheXMgc3RhcnQgd2l0aCBgL2AgKGAvYS9iLm1kYCk7IHRoZSB2YXVsdCByb290IGl0c2VsZiBpcyBgL2BcbiAqICAgLSBzZWdtZW50cyBzZXBhcmF0ZWQgYnkgYC9gOyBubyB0cmFpbGluZyBzbGFzaCwgbm8gYC5gL2AuLmAgc2VnbWVudHMsXG4gKiAgICAgbm8gZHVwbGljYXRlIHNsYXNoZXNcbiAqICAgLSBuZXZlciBlc2NhcGUgdGhlIHJvb3Q6IGFueSBgLi5gIHRoYXQgd291bGQgcG9wIGFib3ZlIGAvYCBpcyByZWplY3RlZFxuICpcbiAqIEJhY2tzbGFzaGVzIGFyZSBjb252ZXJ0ZWQgdG8gYC9gIChXaW5kb3dzIGNhbGxlcnMgcm91dGluZWx5IGhhbmQgdXNcbiAqIGBkaXJcXGZpbGUubWRgKSwgYnV0IGFic29sdXRlIFdpbmRvd3MgcGF0aHMgKGRyaXZlIGxldHRlcnMgbGlrZSBgQzovYCwgVU5DXG4gKiBgXFxcXHNlcnZlclxcc2hhcmVgKSBhcmUgcmVqZWN0ZWQgXHUyMDE0IGEgdmF1bHQgcGF0aCBpcyBuZXZlciBhYnNvbHV0ZSBpbiB0aGUgaG9zdFxuICogZmlsZXN5c3RlbSBzZW5zZS5cbiAqL1xuXG4vKiogQSB2YXVsdC1pbnRlcm5hbCwgUE9TSVgtbm9ybWFsaXplZCBwYXRoIHN0cmluZyAoZS5nLiBgL25vdGVzL3RvZG8ubWRgKS4gKi9cbmV4cG9ydCB0eXBlIFZhdWx0UGF0aCA9IHN0cmluZztcblxuLyoqIFRocm93biB3aGVuIGEgcGF0aCBjYW5ub3QgYmUgaW50ZXJwcmV0ZWQgYXMgYSB2YXVsdC1pbnRlcm5hbCBwYXRoLiAqL1xuZXhwb3J0IGNsYXNzIEludmFsaWRWYXVsdFBhdGhFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgY29uc3RydWN0b3IobWVzc2FnZTogc3RyaW5nKSB7XG4gICAgc3VwZXIobWVzc2FnZSk7XG4gICAgdGhpcy5uYW1lID0gJ0ludmFsaWRWYXVsdFBhdGhFcnJvcic7XG4gIH1cbn1cblxuLyoqXG4gKiBOb3JtYWxpemUgYSB1c2VyLSBvciBwbGF0Zm9ybS1zdXBwbGllZCBwYXRoIGludG8gY2Fub25pY2FsIHZhdWx0IGZvcm0uXG4gKlxuICogQWNjZXB0ZWQ6IGBhL2IubWRgIChyb290LXJlbGF0aXZlIHdpdGhvdXQgbGVhZGluZyBzbGFzaCksIGAvYS9iLm1kYCxcbiAqIGBhXFxiLm1kYCAoYmFja3NsYXNoIGNvbnZlcnNpb24pLCBgYS8uL2IubWRgLCBgYS9iLy4uL2MubWRgIChpbnRlcmlvciBgLi5gXG4gKiByZXNvbHZlcyksIGR1cGxpY2F0ZSBzbGFzaGVzLCB0cmFpbGluZyBzbGFzaGVzLlxuICpcbiAqIFJlamVjdGVkOiBgLi5gIGVzY2FwaW5nIHRoZSByb290IChgLy4uL2FgLCBgL2EvLi4vLi5gKSwgYWJzb2x1dGUgV2luZG93c1xuICogZHJpdmUgcGF0aHMgKGBDOi92YXVsdC9hLm1kYCwgYEM6XFx2YXVsdFxcYS5tZGApLCBVTkMgcGF0aHMgKGBcXFxcc3J2XFxzaGFyZWApLFxuICogbGVhZGluZyBgLy9gLCBOVUwgYnl0ZXMsIGFuZCBXaW5kb3dzLXVuc2FmZSBzZWdtZW50cyBcdTIwMTQgcmVzZXJ2ZWQgZGV2aWNlXG4gKiBuYW1lcyAoYENPTmAsIGBQUk5gLCBgQVVYYCwgYE5VTGAsIGBDT00xYFx1MjAxM2BDT005YCwgYExQVDFgXHUyMDEzYExQVDlgLCBhbnlcbiAqIGV4dGVuc2lvbiwgYW55IGNhc2UpIGFuZCBzZWdtZW50cyBlbmRpbmcgaW4gYC5gIG9yIGAgYC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZVZhdWx0UGF0aChpbnB1dDogc3RyaW5nKTogVmF1bHRQYXRoIHtcbiAgaWYgKHR5cGVvZiBpbnB1dCAhPT0gJ3N0cmluZycpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZFZhdWx0UGF0aEVycm9yKGBWYXVsdCBwYXRoIG11c3QgYmUgYSBzdHJpbmcsIGdvdCAke3R5cGVvZiBpbnB1dH1gKTtcbiAgfVxuICBpZiAoaW5wdXQuaW5jbHVkZXMoJ1xcMCcpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRWYXVsdFBhdGhFcnJvcihgVmF1bHQgcGF0aCBjb250YWlucyBOVUwgYnl0ZTogJHtKU09OLnN0cmluZ2lmeShpbnB1dCl9YCk7XG4gIH1cbiAgaWYgKC9eW2EtekEtWl06Ly50ZXN0KGlucHV0KSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkVmF1bHRQYXRoRXJyb3IoXG4gICAgICBgVmF1bHQgcGF0aCBtdXN0IG5vdCBiZSBhbiBhYnNvbHV0ZSBob3N0IHBhdGggKGRyaXZlIGxldHRlcik6ICR7SlNPTi5zdHJpbmdpZnkoaW5wdXQpfWAsXG4gICAgKTtcbiAgfVxuICBpZiAoaW5wdXQuc3RhcnRzV2l0aCgnXFxcXFxcXFwnKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkVmF1bHRQYXRoRXJyb3IoXG4gICAgICBgVmF1bHQgcGF0aCBtdXN0IG5vdCBiZSBhIFVOQyBwYXRoOiAke0pTT04uc3RyaW5naWZ5KGlucHV0KX1gLFxuICAgICk7XG4gIH1cblxuICBjb25zdCBjb252ZXJ0ZWQgPSBpbnB1dC5yZXBsYWNlKC9cXFxcL2csICcvJyk7XG4gIGlmIChjb252ZXJ0ZWQuc3RhcnRzV2l0aCgnLy8nKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkVmF1bHRQYXRoRXJyb3IoXG4gICAgICBgVmF1bHQgcGF0aCBtdXN0IG5vdCBzdGFydCB3aXRoIFwiLy9cIiAoVU5DIG9yIHByb3RvY29sLXN0eWxlIHBhdGgpOiAke0pTT04uc3RyaW5naWZ5KGlucHV0KX1gLFxuICAgICk7XG4gIH1cblxuICBjb25zdCBzZWdtZW50czogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChjb25zdCBzZWdtZW50IG9mIGNvbnZlcnRlZC5zcGxpdCgnLycpKSB7XG4gICAgaWYgKHNlZ21lbnQgPT09ICcnIHx8IHNlZ21lbnQgPT09ICcuJykgY29udGludWU7XG4gICAgaWYgKHNlZ21lbnQgPT09ICcuLicpIHtcbiAgICAgIGlmIChzZWdtZW50cy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IEludmFsaWRWYXVsdFBhdGhFcnJvcihcbiAgICAgICAgICBgVmF1bHQgcGF0aCBlc2NhcGVzIHRoZSB2YXVsdCByb290OiAke0pTT04uc3RyaW5naWZ5KGlucHV0KX1gLFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgc2VnbWVudHMucG9wKCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGlzV2luZG93c1Vuc2FmZVNlZ21lbnQoc2VnbWVudCkpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkVmF1bHRQYXRoRXJyb3IoXG4gICAgICAgIGBWYXVsdCBwYXRoIHNlZ21lbnQgaXMgYSBXaW5kb3dzLXJlc2VydmVkIGRldmljZSBuYW1lIG9yIGVuZHMgd2l0aCBhIGRvdC9zcGFjZTogJHtKU09OLnN0cmluZ2lmeShzZWdtZW50KX1gLFxuICAgICAgKTtcbiAgICB9XG4gICAgc2VnbWVudHMucHVzaChzZWdtZW50KTtcbiAgfVxuICByZXR1cm4gc2VnbWVudHMubGVuZ3RoID09PSAwID8gJy8nIDogYC8ke3NlZ21lbnRzLmpvaW4oJy8nKX1gO1xufVxuXG4vKipcbiAqIEpvaW4gYSBiYXNlIHZhdWx0IHBhdGggd2l0aCBvbmUgb3IgbW9yZSByZWxhdGl2ZSBwYXRoIHBhcnRzLlxuICpcbiAqIEVhY2ggcGFydCBtdXN0IGJlIHJlbGF0aXZlIChubyBsZWFkaW5nIGAvYCBhZnRlciBiYWNrc2xhc2ggY29udmVyc2lvbikgYW5kXG4gKiBpcyBhcHBlbmRlZCB0byB0aGUgYmFzZSBiZWZvcmUgbm9ybWFsaXphdGlvbjsgYC4uYCBpbnNpZGUgcGFydHMgbWF5IG5vdFxuICogZXNjYXBlIHRoZSByZXN1bHRpbmcgcm9vdC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGpvaW5QYXRoKGJhc2U6IHN0cmluZywgLi4ucGFydHM6IHJlYWRvbmx5IHN0cmluZ1tdKTogVmF1bHRQYXRoIHtcbiAgbGV0IGNvbWJpbmVkID0gbm9ybWFsaXplVmF1bHRQYXRoKGJhc2UpO1xuICBmb3IgKGNvbnN0IHBhcnQgb2YgcGFydHMpIHtcbiAgICBjb25zdCBjb252ZXJ0ZWQgPSBwYXJ0LnJlcGxhY2UoL1xcXFwvZywgJy8nKTtcbiAgICBpZiAoY29udmVydGVkLnN0YXJ0c1dpdGgoJy8nKSkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRWYXVsdFBhdGhFcnJvcihcbiAgICAgICAgYGpvaW5QYXRoIHBhcnRzIG11c3QgYmUgcmVsYXRpdmUsIGdvdCAke0pTT04uc3RyaW5naWZ5KHBhcnQpfWAsXG4gICAgICApO1xuICAgIH1cbiAgICBjb21iaW5lZCA9IGAke2NvbWJpbmVkID09PSAnLycgPyAnJyA6IGNvbWJpbmVkfS8ke2NvbnZlcnRlZH1gO1xuICB9XG4gIHJldHVybiBub3JtYWxpemVWYXVsdFBhdGgoY29tYmluZWQpO1xufVxuXG4vKipcbiAqIFBhcmVudCBkaXJlY3Rvcnkgb2YgYSB2YXVsdCBwYXRoLiBUaGUgcGFyZW50IG9mIGAvYCBpcyBgL2AgKHRoZSByb290IGhhcyBub1xuICogcGFyZW50IGFib3ZlIGl0KTsgd2FsayBgd2hpbGUgKHAgIT09IHBhcmVudFBhdGgocCkpYCBzdHlsZSBsb29wcyB0ZXJtaW5hdGUuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJlbnRQYXRoKHBhdGg6IHN0cmluZyk6IFZhdWx0UGF0aCB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVWYXVsdFBhdGgocGF0aCk7XG4gIGlmIChub3JtYWxpemVkID09PSAnLycpIHJldHVybiAnLyc7XG4gIGNvbnN0IGxhc3RTbGFzaCA9IG5vcm1hbGl6ZWQubGFzdEluZGV4T2YoJy8nKTtcbiAgcmV0dXJuIGxhc3RTbGFzaCA9PT0gMCA/ICcvJyA6IG5vcm1hbGl6ZWQuc2xpY2UoMCwgbGFzdFNsYXNoKTtcbn1cblxuLyoqXG4gKiBGaW5hbCBwYXRoIHNlZ21lbnQuIGBiYXNlbmFtZSgnL2EvYi5tZCcpYCBcdTIxOTIgYGIubWRgOyBgYmFzZW5hbWUoJy8nKWAgXHUyMTkyIGAnJ2AuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBiYXNlbmFtZShwYXRoOiBzdHJpbmcpOiBWYXVsdFBhdGgge1xuICBjb25zdCBub3JtYWxpemVkID0gbm9ybWFsaXplVmF1bHRQYXRoKHBhdGgpO1xuICBpZiAobm9ybWFsaXplZCA9PT0gJy8nKSByZXR1cm4gJyc7XG4gIHJldHVybiBub3JtYWxpemVkLnNsaWNlKG5vcm1hbGl6ZWQubGFzdEluZGV4T2YoJy8nKSArIDEpO1xufVxuXG4vKipcbiAqIFdoZXRoZXIgYGNoaWxkYCBuYW1lcyBzb21ldGhpbmcgYXQgbGVhc3Qgb25lIGxldmVsIEJFTE9XIGBhbmNlc3RvcmBcbiAqIChib3RoIG5vcm1hbGl6ZWQgdmF1bHQgcGF0aHMpLiBUaGUgcm9vdCBpcyBhbiBhbmNlc3RvciBvZiBldmVyeXRoaW5nXG4gKiBleGNlcHQgaXRzZWxmOyBhIHBhdGggaXMgbmV2ZXIgc3RyaWN0bHkgYmVuZWF0aCBpdHNlbGYuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1N0cmljdGx5QmVuZWF0aChjaGlsZDogc3RyaW5nLCBhbmNlc3Rvcjogc3RyaW5nKTogYm9vbGVhbiB7XG4gIGlmIChhbmNlc3RvciA9PT0gJy8nKSByZXR1cm4gY2hpbGQgIT09ICcvJztcbiAgcmV0dXJuIGNoaWxkLmxlbmd0aCA+IGFuY2VzdG9yLmxlbmd0aCAmJiBjaGlsZC5zdGFydHNXaXRoKGAke2FuY2VzdG9yfS9gKTtcbn1cblxuLy8gLS0tIFdpbmRvd3MtdW5zYWZlIG5hbWVzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogUmVzZXJ2ZWQgRE9TIGRldmljZSBiYXNlIG5hbWVzIChtYXRjaGVkIGNhc2UtaW5zZW5zaXRpdmVseSwgYW55IGV4dGVuc2lvbikuICovXG5jb25zdCBXSU5ET1dTX1JFU0VSVkVEX0JBU0VfTkFNRVM6IFJlYWRvbmx5U2V0PHN0cmluZz4gPSBuZXcgU2V0KFtcbiAgJ2NvbicsXG4gICdwcm4nLFxuICAnYXV4JyxcbiAgJ251bCcsXG4gICdjb20xJyxcbiAgJ2NvbTInLFxuICAnY29tMycsXG4gICdjb200JyxcbiAgJ2NvbTUnLFxuICAnY29tNicsXG4gICdjb203JyxcbiAgJ2NvbTgnLFxuICAnY29tOScsXG4gICdscHQxJyxcbiAgJ2xwdDInLFxuICAnbHB0MycsXG4gICdscHQ0JyxcbiAgJ2xwdDUnLFxuICAnbHB0NicsXG4gICdscHQ3JyxcbiAgJ2xwdDgnLFxuICAnbHB0OScsXG5dKTtcblxuLyoqXG4gKiBXaGV0aGVyIG9uZSBwYXRoIHNlZ21lbnQgY2FuIG5ldmVyIGJlIG1hdGVyaWFsaXplZCBvbiBXaW5kb3dzOiBhIHJlc2VydmVkXG4gKiBkZXZpY2UgYmFzZSBuYW1lIFx1MjAxNCB0aGUgc2VnbWVudCB1cCB0byBpdHMgZmlyc3QgZG90LCBjYXNlLWluc2Vuc2l0aXZlLCBzb1xuICogYENPTmAsIGBudWwudHh0YCBhbmQgYENPTTMudGFyLmd6YCBhbGwgbWF0Y2ggXHUyMDE0IG9yIGEgdHJhaWxpbmcgZG90L3NwYWNlLFxuICogd2hpY2ggV2luZG93cyBzdHJpcHMgd2hlbiBjcmVhdGluZyB0aGUgZmlsZSAodGhlIG9uLWRpc2sgbmFtZSB3b3VsZFxuICogc2lsZW50bHkgZGlmZmVyIGZyb20gdGhlIHN5bmNlZCBvbmUpLlxuICovXG5mdW5jdGlvbiBpc1dpbmRvd3NVbnNhZmVTZWdtZW50KHNlZ21lbnQ6IHN0cmluZyk6IGJvb2xlYW4ge1xuICAvLyBgLmAvYC4uYCBhcmUgbm9ybWFsaXphdGlvbiB0b2tlbnMsIG5ldmVyIHJlYWwgc2VnbWVudCBuYW1lczsgdGhleSBhcmVcbiAgLy8gcmVzb2x2ZWQgKG9yIHJlamVjdGVkKSBieSBgbm9ybWFsaXplVmF1bHRQYXRoYCBpdHNlbGYuXG4gIGlmIChzZWdtZW50ID09PSAnLicgfHwgc2VnbWVudCA9PT0gJy4uJykgcmV0dXJuIGZhbHNlO1xuICBpZiAoc2VnbWVudC5lbmRzV2l0aCgnLicpIHx8IHNlZ21lbnQuZW5kc1dpdGgoJyAnKSkgcmV0dXJuIHRydWU7XG4gIGNvbnN0IGRvdCA9IHNlZ21lbnQuaW5kZXhPZignLicpO1xuICBjb25zdCBiYXNlID0gKGRvdCA9PT0gLTEgPyBzZWdtZW50IDogc2VnbWVudC5zbGljZSgwLCBkb3QpKS50b0xvd2VyQ2FzZSgpO1xuICByZXR1cm4gV0lORE9XU19SRVNFUlZFRF9CQVNFX05BTUVTLmhhcyhiYXNlKTtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIGFueSBzZWdtZW50IG9mIGEgdmF1bHQgcGF0aCBpcyBXaW5kb3dzLXVuc2FmZSAoc2VlXG4gKiBgaXNXaW5kb3dzVW5zYWZlU2VnbWVudGApLiBTdWNoIHBhdGhzIGFyZSByZWplY3RlZCBieSBgbm9ybWFsaXplVmF1bHRQYXRoYFxuICogYW5kIG11c3QgbmV2ZXIgYmUgcHVzaGVkIG9yIHB1bGxlZDogYSBXaW5kb3dzIGNsaWVudCBjYW5ub3QgbWF0ZXJpYWxpemVcbiAqIHRoZW0sIHNvIGF0dGVtcHRpbmcgdGhlIHdyaXRlIHdvdWxkIGZhaWwgZXZlcnkgc3luYyBjeWNsZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzV2luZG93c1Vuc2FmZVBhdGgocGF0aDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIHJldHVybiBwYXRoLnNwbGl0KCcvJykuc29tZSgoc2VnbWVudCkgPT4gaXNXaW5kb3dzVW5zYWZlU2VnbWVudChzZWdtZW50KSk7XG59XG4iLCAiLyoqXG4gKiBMb2dpY2FsIGNsb2NrIG9wZXJhdGlvbnMgKEFSQ0hJVEVDVFVSRS5tZCBcdTAwQTc0KS5cbiAqXG4gKiBDbG9ja3MgYXJlIHBlci1maWxlIG1vbm90b25pYyBjb3VudGVycyBvd25lZCBieSB0aGUgc3luYyBhdXRob3JpdHkgKHRoZVxuICogRHVyYWJsZSBPYmplY3QpLiBBIGNsb2NrIHBhaXJzIHRoZSBjb3VudGVyIHdpdGggdGhlIGlkIG9mIHRoZSBkZXZpY2UgdGhhdFxuICogcHJvZHVjZWQgaXQuIE9yZGVyaW5nIGlzIGZ1bGx5IGRldGVybWluaXN0aWMgb24gZXZlcnkgY2xpZW50OlxuICpcbiAqICAgMS4gaGlnaGVyIGBjb3VudGVyYCB3aW5zO1xuICogICAyLiBleGFjdCBjb3VudGVyIHRpZSBcdTIxOTIgbGV4aWNvZ3JhcGhpY2FsbHkgZ3JlYXRlciBgZGV2aWNlSWRgIHdpbnNcbiAqICAgICAgKHBsYWluIEpTIHN0cmluZyBjb21wYXJpc29uLCBpLmUuIGJ5IFVURi0xNiBjb2RlIHVuaXRzKTtcbiAqICAgMy4gaWRlbnRpY2FsIGNvdW50ZXIgKmFuZCogaWRlbnRpY2FsIGRldmljZUlkIFx1MjE5MiB0aGUgY2xvY2tzIGFyZSBlcXVhbC5cbiAqXG4gKiBXYWxsLWNsb2NrIHRpbWUgbmV2ZXIgcGFydGljaXBhdGVzIGluIG9yZGVyaW5nIChkaXNwbGF5LW9ubHkgcGVyIFx1MDBBNzQpLlxuICovXG5cbmltcG9ydCB0eXBlIHsgTG9naWNhbENsb2NrIH0gZnJvbSAnLi90eXBlcy5qcyc7XG5cbi8qKiBSZXN1bHQgb2YgYGNvbXBhcmVDbG9ja3NgOiBzaWduIG9mIGBhYCB2cyBgYmAgKHBvc2l0aXZlIFx1MjFEMiBgYWAgd2lucykuICovXG5leHBvcnQgdHlwZSBDbG9ja0NvbXBhcmlzb24gPSAtMSB8IDAgfCAxO1xuXG4vKipcbiAqIENvbXBhcmUgdHdvIGxvZ2ljYWwgY2xvY2tzLlxuICpcbiAqIFJldHVybnMgYDFgIHdoZW4gYGFgIHdpbnMsIGAtMWAgd2hlbiBgYmAgd2lucywgYDBgIHdoZW4gdGhlIGNsb2NrcyBhcmVcbiAqIGlkZW50aWNhbCAoc2FtZSBjb3VudGVyICphbmQqIHNhbWUgZGV2aWNlSWQgXHUyMDE0IGluIHByYWN0aWNlIG9ubHkgd2hlblxuICogY29tcGFyaW5nIGEgY2xvY2sgd2l0aCBpdHNlbGYpLiBDYWxsZXJzIHRoYXQgbXVzdCBwaWNrIGEgc2lkZSBvbiBgMGBcbiAqIHNob3VsZCBkbyBzbyBleHBsaWNpdGx5IGFuZCBkb2N1bWVudCB0aGUgY2hvaWNlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY29tcGFyZUNsb2NrcyhhOiBMb2dpY2FsQ2xvY2ssIGI6IExvZ2ljYWxDbG9jayk6IENsb2NrQ29tcGFyaXNvbiB7XG4gIGlmIChhLmNvdW50ZXIgIT09IGIuY291bnRlcikgcmV0dXJuIGEuY291bnRlciA+IGIuY291bnRlciA/IDEgOiAtMTtcbiAgaWYgKGEuZGV2aWNlSWQgIT09IGIuZGV2aWNlSWQpIHJldHVybiBhLmRldmljZUlkID4gYi5kZXZpY2VJZCA/IDEgOiAtMTtcbiAgcmV0dXJuIDA7XG59XG5cbi8qKlxuICogVGhlIGNsb2NrIGEgY29tbWl0IGZyb20gYGRldmljZUlkYCB3b3VsZCByZWNlaXZlIHdoZW4gYnVpbGRpbmcgb24gYHBhcmVudGBcbiAqIChvciBvbiBub3RoaW5nLCB3aGVuIGBwYXJlbnRgIGlzIGFic2VudCk6IHBhcmVudCdzIGNvdW50ZXIgKyAxLlxuICpcbiAqIFRoaXMgaXMgdGhlICp0ZW50YXRpdmUqIGNsb2NrIHVzZWQgYnkgY2xpZW50LXNpZGUgY29uZmxpY3QgcHJlZGljdGlvblxuICogKGByZXNvbHZlLnRzYCk6IHRoZSBETyBhc3NpZ25zIHJlYWwgY291bnRlcnMgd2l0aCB0aGUgc2FtZSBydWxlLCBzbyB0aGVcbiAqIHByZWRpY3Rpb24gbWF0Y2hlcyB0aGUgc2VydmVyJ3MgYXJiaXRyYXRpb24gYXMgbG9uZyBhcyBib3RoIHNpZGVzIGJ1aWxkIG9uXG4gKiB0aGUgc2FtZSBwYXJlbnQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBuZXh0Q2xvY2soXG4gIHBhcmVudDogTG9naWNhbENsb2NrIHwgbnVsbCB8IHVuZGVmaW5lZCxcbiAgZGV2aWNlSWQ6IHN0cmluZyxcbik6IExvZ2ljYWxDbG9jayB7XG4gIHJldHVybiB7IGNvdW50ZXI6IChwYXJlbnQ/LmNvdW50ZXIgPz8gMCkgKyAxLCBkZXZpY2VJZCB9O1xufVxuIiwgIi8qKlxuICogQ29udGVudCBoYXNoaW5nIGFuZCBjb21wcmVzc2lvbiBcdTIwMTQgV2ViIEFQSXMgb25seS5cbiAqXG4gKiBgY3J5cHRvLnN1YnRsZWAgaXMgYXZhaWxhYmxlIGluIE5vZGUgMTgrLCBDbG91ZGZsYXJlIFdvcmtlcnMsXG4gKiBhbmQgT2JzaWRpYW4gKEVsZWN0cm9uKS4gYENvbXByZXNzaW9uU3RyZWFtYCBsaWtld2lzZS4gTm8gTm9kZSBpbXBvcnRzOlxuICogdGhpcyBtb2R1bGUgbXVzdCBydW4gdW5jaGFuZ2VkIGluIGV2ZXJ5IGNsaWVudCAoQVJDSElURUNUVVJFLm1kIFx1MDBBNzgpLlxuICovXG5cbi8qKiBIYXNoIG9mIGBieXRlc2AgYXMgbG93ZXJjYXNlIHNoYTI1NiBoZXguIE1hdGNoZXMgUjIgYmxvYiBrZXlzIGBibG9icy97c2hhMjU2fWAuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc2hhMjU2SGV4KGJ5dGVzOiBVaW50OEFycmF5IHwgc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgZGF0YSA9IHR5cGVvZiBieXRlcyA9PT0gJ3N0cmluZycgPyBuZXcgVGV4dEVuY29kZXIoKS5lbmNvZGUoYnl0ZXMpIDogYnl0ZXM7XG4gIC8vIGBjcnlwdG9gIChub3QgYGdsb2JhbFRoaXMuY3J5cHRvYCk6IHRoZSBiYXJlIGlkZW50aWZpZXIgcmVzb2x2ZXMgaW4gZXZlcnlcbiAgLy8gdGFyZ2V0J3MgdHlwZXMgKERPTSBsaWIsIENsb3VkZmxhcmUgd29ya2VyZCB0eXBlcywgTm9kZSkgXHUyMDE0IHRoZSBxdWFsaWZpZWRcbiAgLy8gZm9ybSBkb2VzIG5vdCwgYmVjYXVzZSB3b3JrZXJzIHR5cGVzIGRlY2xhcmUgaXQgYGNvbnN0YCwgd2hpY2ggbmV2ZXJcbiAgLy8gbWVyZ2VzIGludG8gYHR5cGVvZiBnbG9iYWxUaGlzYC5cbiAgY29uc3QgZGlnZXN0ID0gYXdhaXQgY3J5cHRvLnN1YnRsZS5kaWdlc3QoJ1NIQS0yNTYnLCBkYXRhIGFzIEJ1ZmZlclNvdXJjZSk7XG4gIHJldHVybiB0b0hleChuZXcgVWludDhBcnJheShkaWdlc3QpKTtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIGd6aXAgc3RyZWFtcyBhcmUgYXZhaWxhYmxlIGluIHRoaXMgcnVudGltZS4gT2xkZXIgT2JzaWRpYW4gbW9iaWxlXG4gKiB3ZWJ2aWV3cyBtYXkgbGFjayBgQ29tcHJlc3Npb25TdHJlYW1gOyBjYWxsZXJzIGZhbGwgYmFjayB0byBpZGVudGl0eS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN1cHBvcnRzQ29tcHJlc3Npb24oKTogYm9vbGVhbiB7XG4gIHJldHVybiAoXG4gICAgdHlwZW9mIENvbXByZXNzaW9uU3RyZWFtICE9PSAndW5kZWZpbmVkJyAmJlxuICAgIHR5cGVvZiBEZWNvbXByZXNzaW9uU3RyZWFtICE9PSAndW5kZWZpbmVkJ1xuICApO1xufVxuXG4vKipcbiAqIEd6aXAgYGRhdGFgLiBGYWxscyBiYWNrIHRvIGlkZW50aXR5IChyZXR1cm5zIGlucHV0IHVuY2hhbmdlZCkgd2hlblxuICogYENvbXByZXNzaW9uU3RyZWFtYCBpcyB1bmF2YWlsYWJsZSBcdTIwMTQgY2FsbCBgc3VwcG9ydHNDb21wcmVzc2lvbigpYCBmaXJzdCBpZlxuICogeW91IG11c3Qga25vdyB3aGljaCBoYXBwZW5lZC5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNvbXByZXNzKGRhdGE6IFVpbnQ4QXJyYXkpOiBQcm9taXNlPFVpbnQ4QXJyYXk+IHtcbiAgaWYgKCFzdXBwb3J0c0NvbXByZXNzaW9uKCkpIHJldHVybiBkYXRhO1xuICAvLyBgYXMgQnVmZmVyU291cmNlYCAobm90IGBhcyBCbG9iUGFydGApOiB0aGUgbmFtZSBgQnVmZmVyU291cmNlYCByZXNvbHZlcyBpblxuICAvLyBib3RoIERPTSBsaWIgYW5kIHdvcmtlcmQgcnVudGltZSB0eXBlcywgYW5kIGlzIGEgdmFsaWQgQmxvYlBhcnQgaW4gZWFjaC5cbiAgY29uc3Qgc3RyZWFtID0gbmV3IEJsb2IoW2RhdGEgYXMgQnVmZmVyU291cmNlXSlcbiAgICAuc3RyZWFtKClcbiAgICAucGlwZVRocm91Z2gobmV3IENvbXByZXNzaW9uU3RyZWFtKCdnemlwJykpO1xuICByZXR1cm4gbmV3IFVpbnQ4QXJyYXkoYXdhaXQgbmV3IFJlc3BvbnNlKHN0cmVhbSkuYXJyYXlCdWZmZXIoKSk7XG59XG5cbi8qKlxuICogR3VuemlwIGBkYXRhYCBwcm9kdWNlZCBieSBgY29tcHJlc3NgIChpbiBhIHJ1bnRpbWUgdGhhdCBoYWQgZ3ppcCBzdXBwb3J0KS5cbiAqIEZhbGxzIGJhY2sgdG8gaWRlbnRpdHkgd2hlbiBgRGVjb21wcmVzc2lvblN0cmVhbWAgaXMgdW5hdmFpbGFibGUuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBkZWNvbXByZXNzKGRhdGE6IFVpbnQ4QXJyYXkpOiBQcm9taXNlPFVpbnQ4QXJyYXk+IHtcbiAgaWYgKCFzdXBwb3J0c0NvbXByZXNzaW9uKCkpIHJldHVybiBkYXRhO1xuICBjb25zdCBzdHJlYW0gPSBuZXcgQmxvYihbZGF0YSBhcyBCdWZmZXJTb3VyY2VdKVxuICAgIC5zdHJlYW0oKVxuICAgIC5waXBlVGhyb3VnaChuZXcgRGVjb21wcmVzc2lvblN0cmVhbSgnZ3ppcCcpKTtcbiAgcmV0dXJuIG5ldyBVaW50OEFycmF5KGF3YWl0IG5ldyBSZXNwb25zZShzdHJlYW0pLmFycmF5QnVmZmVyKCkpO1xufVxuXG5mdW5jdGlvbiB0b0hleChieXRlczogVWludDhBcnJheSk6IHN0cmluZyB7XG4gIGxldCBvdXQgPSAnJztcbiAgZm9yIChjb25zdCBieXRlIG9mIGJ5dGVzKSB7XG4gICAgb3V0ICs9IGJ5dGUudG9TdHJpbmcoMTYpLnBhZFN0YXJ0KDIsICcwJyk7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cbiIsICIvKipcbiAqIFR5cGVkIGVycm9yIGhpZXJhcmNoeSBzaGFyZWQgYnkgYWxsIGNsaWVudHMgKHBsdWdpbiwgZGFlbW9uLCBDTEkpIGFuZCB0aGVcbiAqIHRlc3Qtc3VpdGUgc2VydmVyLiBFcnJvcnMgY2FycnkgYSBzdGFibGUgbWFjaGluZS1yZWFkYWJsZSBgY29kZWAuXG4gKi9cblxuZXhwb3J0IHR5cGUgRXJyb3JDb2RlID1cbiAgfCAnVU5DTEFJTUVEJ1xuICB8ICdVTkFVVEhPUklaRUQnXG4gIHwgJ1JFVk9LRUQnXG4gIHwgJ0NPTkZMSUNUJ1xuICB8ICdQUk9UT0NPTCdcbiAgfCAnTkVUV09SSyc7XG5cbi8qKiBCYXNlIGNsYXNzIGZvciBhbGwgVmF1bHRTeW5jIGVycm9ycy4gKi9cbmV4cG9ydCBhYnN0cmFjdCBjbGFzcyBWYXVsdFN5bmNFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgYWJzdHJhY3QgcmVhZG9ubHkgY29kZTogRXJyb3JDb2RlO1xuXG4gIGNvbnN0cnVjdG9yKG1lc3NhZ2U6IHN0cmluZywgb3B0aW9ucz86IEVycm9yT3B0aW9ucykge1xuICAgIHN1cGVyKG1lc3NhZ2UsIG9wdGlvbnMpO1xuICAgIHRoaXMubmFtZSA9IG5ldy50YXJnZXQubmFtZTtcbiAgfVxufVxuXG4vKiogV29ya2VyIGV4aXN0cyBidXQgaGFzIG5vdCBiZWVuIGNsYWltZWQgeWV0IChIVFRQIDQyMSBvbiBldmVyeSBBUEkgY2FsbCkuICovXG5leHBvcnQgY2xhc3MgVW5jbGFpbWVkRXJyb3IgZXh0ZW5kcyBWYXVsdFN5bmNFcnJvciB7XG4gIHJlYWRvbmx5IGNvZGUgPSAnVU5DTEFJTUVEJyBhcyBjb25zdDtcbn1cblxuLyoqIFRva2VuIG1pc3NpbmcsIGludmFsaWQsIG9yIG5vdCBhY2NlcHRlZCAoSFRUUCA0MDEgY2xhc3MpLiAqL1xuZXhwb3J0IGNsYXNzIFVuYXV0aG9yaXplZEVycm9yIGV4dGVuZHMgVmF1bHRTeW5jRXJyb3Ige1xuICByZWFkb25seSBjb2RlID0gJ1VOQVVUSE9SSVpFRCcgYXMgY29uc3Q7XG59XG5cbi8qKiBUaGUgZGV2aWNlIHRva2VuIHdhcyByZXZva2VkOyB0aGUgZGV2aWNlIG11c3QgYmUgcmUtcGFpcmVkLiAqL1xuZXhwb3J0IGNsYXNzIFJldm9rZWRFcnJvciBleHRlbmRzIFZhdWx0U3luY0Vycm9yIHtcbiAgcmVhZG9ubHkgY29kZSA9ICdSRVZPS0VEJyBhcyBjb25zdDtcbn1cblxuLyoqIEEgY29tbWl0IHJhY2VkIHdpdGggYSBjb25jdXJyZW50IGVkaXQ7IHRoZSBzZXJ2ZXIgYXJiaXRyYXRlZCAoc2VlIFx1MDBBNzQpLiAqL1xuZXhwb3J0IGNsYXNzIENvbmZsaWN0RXJyb3IgZXh0ZW5kcyBWYXVsdFN5bmNFcnJvciB7XG4gIHJlYWRvbmx5IGNvZGUgPSAnQ09ORkxJQ1QnIGFzIGNvbnN0O1xufVxuXG4vKiogQSBwZWVyIChvciBsb2NhbCBidWcpIHZpb2xhdGVkIHRoZSBwcm90b2NvbDogYmFkIG1lc3NhZ2Ugc2hhcGUsIGJhZCB2ZXJzaW9uLiAqL1xuZXhwb3J0IGNsYXNzIFByb3RvY29sRXJyb3IgZXh0ZW5kcyBWYXVsdFN5bmNFcnJvciB7XG4gIHJlYWRvbmx5IGNvZGUgPSAnUFJPVE9DT0wnIGFzIGNvbnN0O1xufVxuXG4vKiogVHJhbnNwb3J0LWxldmVsIGZhaWx1cmU6IHNvY2tldCBjbG9zZWQsIGZldGNoIHJlZnVzZWQsIHRpbWVvdXQuIFJldHJpYWJsZS4gKi9cbmV4cG9ydCBjbGFzcyBOZXR3b3JrRXJyb3IgZXh0ZW5kcyBWYXVsdFN5bmNFcnJvciB7XG4gIHJlYWRvbmx5IGNvZGUgPSAnTkVUV09SSycgYXMgY29uc3Q7XG59XG4iLCAiLyoqXG4gKiBUaGUgY2xpZW50J3MgcGVyc2lzdGVkIHN5bmMgc3RhdGUgKEFSQ0hJVEVDVFVSRS5tZCBcdTAwQTc4IHN0ZXAgMSkuXG4gKlxuICogQSBgTG9jYWxJbmRleGAgbWFwcyBldmVyeSB2YXVsdCBwYXRoIHRoaXMgY2xpZW50IGhhcyBldmVyIHN5bmNlZCB0byB0aGVcbiAqIGxhc3QgdmVyc2lvbiBpdCAqa25vd3MqIHdhcyBhdXRob3JpdGF0aXZlOiBjb250ZW50IGhhc2gsIHNpemUsIHRoZVxuICogc2VydmVyLWFzc2lnbmVkIHZlcnNpb24gaWQsIGFuZCB0aGUgdmVyc2lvbidzIGxvZ2ljYWwgY2xvY2suIEVudHJpZXMgd2l0aFxuICogYGRlbGV0ZWRBdGAgc2V0IGFyZSB0b21ic3RvbmVzIFx1MjAxNCB0aGUgZmlsZSB3YXMgZGVsZXRlZCAobG9jYWxseSBvclxuICogcmVtb3RlbHkpIGJ1dCB0aGUgZW50cnkgc3RheXMgc28gdGhlIGRlbGV0aW9uIGlzIG5vdCByZXN1cnJlY3RlZCBieSB0aGVcbiAqIG5leHQgc2NhbiBhbmQgc28gcmVuYW1lIGNvcnJlbGF0aW9uIGtlZXBzIHdvcmtpbmcuXG4gKlxuICogVGhlIGluZGV4IGlzIHBlcnNpc3RlZCBpbnNpZGUgdGhlIHZhdWx0IGF0IGAvLnZhdWx0c3luY2ZvcmFnZW50cy9zdGF0ZWBcbiAqICh0aGF0IGRpcmVjdG9yeSBpcyBzeW5jLWlnbm9yZWQsIHNlZSBgaWdub3JlLnRzYCkgdGhyb3VnaCB0aGUgc3RvcmFnZVxuICogYWRhcHRlciwgd2hvc2UgYHdyaXRlRmlsZWAgaXMgYXRvbWljICh0ZW1wICsgcmVuYW1lKSBieSBjb250cmFjdC5cbiAqXG4gKiBBbGwgb3BlcmF0aW9ucyBhcmUgcHVyZTogdGhleSByZXR1cm4gbmV3IG9iamVjdHMgYW5kIG5ldmVyIG11dGF0ZSBpbnB1dHMuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBMb2dpY2FsQ2xvY2sgfSBmcm9tICcuL3R5cGVzLmpzJztcbmltcG9ydCB7IFByb3RvY29sRXJyb3IgfSBmcm9tICcuL2Vycm9ycy5qcyc7XG5cbi8qKlxuICogQ3VycmVudCBvbi1kaXNrIHNjaGVtYSB2ZXJzaW9uLiBCdW1wICsgYWRkIG1pZ3JhdGlvbiBvbiBicmVha2luZyBjaGFuZ2VzLlxuICpcbiAqIEhpc3Rvcnk6XG4gKiAgIC0gMSBcdTIwMTQgaW5pdGlhbCBzaGFwZSAoaGFzaC9zaXplL3ZlcnNpb25JZC9jbG9jay9kZWxldGVkQXQvaXNGb2xkZXIpLlxuICogICAtIDIgXHUyMDE0IGFkZHMgdGhlIG9wdGlvbmFsIGBtdGltZWAgY2FjaGUgZmllbGQgcGVyIGVudHJ5IChzY2FuIHByZS1maWx0ZXIsXG4gKiAgICAgICAgIHNlZSBgc2Nhbi50c2ApLiBHcmFjZWZ1bCBtaWdyYXRpb246IHYxIGVudHJpZXMgc2ltcGx5IGxhY2sgYG10aW1lYCxcbiAqICAgICAgICAgd2hpY2ggcmVhZHMgYmFjayBhcyBcInVua25vd25cIiBcdTIwMTQgdGhlIG5leHQgZmFzdCBzY2FuIHJlLWhhc2hlcyB0aGVcbiAqICAgICAgICAgZmlsZSBhbmQgcmVjb3JkcyBpdC4gT2xkIHYxIHN0YXRlIGZpbGVzIGxvYWQgd2l0aG91dCBlcnJvci5cbiAqXG4gKiBUaGUgdjIgRU5WRUxPUEUgYWxzbyBjYXJyaWVzIG9wdGlvbmFsIHN5bmMtY3Vyc29yIGJvb2trZWVwaW5nIChgY3Vyc29yYCxcbiAqIGBzeW5jZWRUaHJvdWdoYCwgYG5lZWRzRnVsbE1hbmlmZXN0YCBcdTIwMTQgc2VlIGBQZXJzaXN0ZWRTeW5jU3RhdGVgKTsgZmlsZXNcbiAqIHdyaXR0ZW4gYmVmb3JlIGl0IGV4aXN0ZWQgc2ltcGx5IGxhY2sgdGhvc2Uga2V5cywgd2hpY2ggcmVhZCBiYWNrIGFzXG4gKiBcIm5vIGN1cnNvciBrbm93bGVkZ2VcIiAoZnVsbCBtYW5pZmVzdCBvbiB0aGUgbmV4dCBjb25uZWN0KS4gTm8gdmVyc2lvblxuICogYnVtcDogYm90aCBkaXJlY3Rpb25zIHRvbGVyYXRlIHRoZSBtaXNzaW5nIGZpZWxkcy5cbiAqL1xuZXhwb3J0IGNvbnN0IExPQ0FMX0lOREVYX1NDSEVNQV9WRVJTSU9OID0gMjtcblxuLyoqIE9sZGVzdCBvbi1kaXNrIHNjaGVtYSB2ZXJzaW9uIHRoaXMgYnVpbGQgY2FuIHN0aWxsIHJlYWQuICovXG5leHBvcnQgY29uc3QgTUlOX0xPQ0FMX0lOREVYX1NDSEVNQV9WRVJTSU9OID0gMTtcblxuLyoqIFZhdWx0IHBhdGggd2hlcmUgdGhlIGNsaWVudCBwZXJzaXN0cyBpdHMgbG9jYWwgaW5kZXguICovXG5leHBvcnQgY29uc3QgTE9DQUxfSU5ERVhfU1RBVEVfUEFUSCA9ICcvLnZhdWx0c3luY2ZvcmFnZW50cy9zdGF0ZSc7XG5cbi8qKiBPbmUgcGF0aCdzIGxhc3Qta25vd24tc3luY2VkIHN0YXRlLiAqL1xuZXhwb3J0IGludGVyZmFjZSBMb2NhbEluZGV4RW50cnkge1xuICAvKiogc2hhMjU2IGhleCBvZiB0aGUgY29udGVudCBhdCBgdmVyc2lvbklkYC4gKi9cbiAgaGFzaDogc3RyaW5nO1xuICAvKiogQ29udGVudCBzaXplIGluIGJ5dGVzIChgMGAgZm9yIGZvbGRlciBwbGFjZWhvbGRlcnMpLiAqL1xuICBzaXplOiBudW1iZXI7XG4gIC8qKiBTZXJ2ZXItYXNzaWduZWQgdmVyc2lvbiBpZCB0aGlzIGVudHJ5IHJlZmxlY3RzLiAqL1xuICB2ZXJzaW9uSWQ6IHN0cmluZztcbiAgLyoqIExvZ2ljYWwgY2xvY2sgb2YgYHZlcnNpb25JZGAgXHUyMDE0IHVzZWQgdG8gcHJlZGljdCBjb25mbGljdCBvdXRjb21lcy4gKi9cbiAgY2xvY2s6IExvZ2ljYWxDbG9jaztcbiAgLyoqIFByZXNlbnQgXHUyMUQyIHRvbWJzdG9uZTogdGhlIHBhdGggd2FzIGRlbGV0ZWQgYXQgdGhpcyBlcG9jaCBtcy4gKi9cbiAgZGVsZXRlZEF0PzogbnVtYmVyO1xuICAvKipcbiAgICogVHJ1ZSBmb3IgZW1wdHktZm9sZGVyIHBsYWNlaG9sZGVyIGVudHJpZXMgKEZSLTEwKS4gRm9sZGVyIGVudHJpZXMgY2FycnlcbiAgICogYGhhc2g6ICcnYCwgYHNpemU6IDBgOyB0aGUgY2xvY2sgaXMgdGhhdCBvZiB0aGUgcGxhY2Vob2xkZXIncyB2ZXJzaW9uLlxuICAgKi9cbiAgaXNGb2xkZXI/OiBib29sZWFuO1xuICAvKipcbiAgICogU3RvcmFnZSBtdGltZSAoZXBvY2ggbXMpIG9ic2VydmVkIHRoZSBsYXN0IHRpbWUgdGhpcyBlbnRyeSdzIGZpbGUgd2FzXG4gICAqIGhhc2hlZCBieSBhIHNjYW4uIEEgcHVyZSBjYWNoZSBmb3IgdGhlIHNjYW4gcHJlLWZpbHRlciAoYHNjYW4udHNgKTpcbiAgICogbnVsbGlzaCAoYWJzZW50LCBlLmcuIGxlZ2FjeSB2MSBzdGF0ZSBvciBlbnRyaWVzIHdyaXR0ZW4gYnkgcHVsbHMpXG4gICAqIG1lYW5zIFwidW5rbm93blwiIFx1MjAxNCB0aGUgbmV4dCBmYXN0IHNjYW4gaGFzaGVzIHRoZSBmaWxlIGFuZCByZWNvcmRzIGl0IHZpYVxuICAgKiBgcmVjb3JkSGFzaGVkRmlsZXNgLiBOZXZlciBjb25zdWx0ZWQgZm9yIHN5bmMgZGVjaXNpb25zLlxuICAgKi9cbiAgbXRpbWU/OiBudW1iZXI7XG59XG5cbi8qKiBUaGUgd2hvbGUgaW5kZXg6IG5vcm1hbGl6ZWQgdmF1bHQgcGF0aCBcdTIxOTIgZW50cnkuIGB7fWAgaXMgYSB2YWxpZCBlbXB0eSBpbmRleC4gKi9cbmV4cG9ydCB0eXBlIExvY2FsSW5kZXggPSBSZWFkb25seTxSZWNvcmQ8c3RyaW5nLCBMb2NhbEluZGV4RW50cnk+PjtcblxuLyoqIFZlcnNpb25lZCBzZXJpYWxpemF0aW9uIGVudmVsb3BlIChzY2hlbWFWZXJzaW9uIGVuYWJsZXMgZnV0dXJlIG1pZ3JhdGlvbikuICovXG5leHBvcnQgaW50ZXJmYWNlIExvY2FsSW5kZXhFbnZlbG9wZSB7XG4gIHNjaGVtYVZlcnNpb246IG51bWJlcjtcbiAgZW50cmllczogUmVjb3JkPHN0cmluZywgTG9jYWxJbmRleEVudHJ5PjtcbiAgLyoqXG4gICAqIEVudmVsb3BlLWxldmVsIHN5bmMgYm9va2tlZXBpbmcgKG9wdGlvbmFsIHNvIHYyIGZpbGVzIHdyaXR0ZW4gYmVmb3JlIGl0XG4gICAqIGV4aXN0ZWQgc3RpbGwgbG9hZDsgdW5rbm93biBmaWVsZHMgYXJlIHRvbGVyYXRlZCBpbiBib3RoIGRpcmVjdGlvbnMpLlxuICAgKiBTZWUgYFBlcnNpc3RlZFN5bmNTdGF0ZWAuXG4gICAqL1xuICBjdXJzb3I/OiBudW1iZXI7XG4gIHN5bmNlZFRocm91Z2g/OiBudW1iZXIgfCBudWxsO1xuICBuZWVkc0Z1bGxNYW5pZmVzdD86IGJvb2xlYW47XG59XG5cbi8qKlxuICogU3luYy1jdXJzb3IgYm9va2tlZXBpbmcgcGVyc2lzdGVkIGF0b21pY2FsbHkgV0lUSCB0aGUgZW50cmllcyAob25lIGZpbGUsXG4gKiBvbmUgd3JpdGUpIHNvIHRoZSB0d28gY2FuIG5ldmVyIGRpc2FncmVlIGFmdGVyIGEgY3Jhc2guIFJlc3RvcmVkIG9uXG4gKiBzdGFydHVwIHRvIHBvd2VyIGRlbHRhLW1hbmlmZXN0IHJlY29ubmVjdHMuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUGVyc2lzdGVkU3luY1N0YXRlIHtcbiAgLyoqIExhc3Qgc2VlbiBzZXJ2ZXIgc2VxdWVuY2UgbnVtYmVyIChzZW50IGFzIGBoZWxsby5jdXJzb3JgKS4gKi9cbiAgY3Vyc29yPzogbnVtYmVyO1xuICAvKipcbiAgICogU2VxdWVuY2UgdGhyb3VnaCB3aGljaCB0aGUgaW5kZXggaXMga25vd24gQ09NUExFVEU6IHRoZSBtYW5pZmVzdCBjdXJzb3JcbiAgICogb2YgdGhlIGxhc3Qgc3luYyBjeWNsZSB0aGF0IGZpbmlzaGVkIHN1Y2Nlc3NmdWxseS4gRXZlcnkgaGVhZCBhdCBvclxuICAgKiBiZWxvdyBpdCBpcyByZWZsZWN0ZWQgaW4gdGhlIGVudHJpZXMgYWJvdmUsIHNvIGEgbGF0ZXIgcmVjb25uZWN0IG9ubHlcbiAgICogbmVlZHMgaGVhZHMgd2l0aCBgaGVhZF9zZXEgPiBzeW5jZWRUaHJvdWdoYCBcdTIwMTQgdGhlIGRlbHRhLW1hbmlmZXN0IHdpbmRvdy5cbiAgICogYG51bGxgL2Fic2VudCBcdTIxRDIgbm8gY29tcGxldGVkIGN5Y2xlIHlldCAob3IgYW4gaW50ZXJydXB0ZWQgb25lKTogdGhlIG5leHRcbiAgICogbWFuaWZlc3QgbXVzdCBiZSBGVUxMLiBEZWxpYmVyYXRlbHkgTk9UIGFkdmFuY2VkIHRvIGNvbW1pdC1hY2sgc2VxcyBzZWVuXG4gICAqIG1pZC1jeWNsZTogYSBjaGFuZ2UgYnJvYWRjYXN0IGZyb20gYW5vdGhlciBkZXZpY2UgY2FuIGludGVybGVhdmUgd2l0aFxuICAgKiBvdXIgYWNrcyBhbmQgbGFuZCBpbiB0aGUgcG9zdC1jeWNsZSBkaXNwYXRjaCBxdWV1ZSwgc28gb25seSB0aGVcbiAgICogZmV0Y2gtdGltZSBtYW5pZmVzdCBjdXJzb3IgaXMgYSBjb21wbGV0aW9uIGd1YXJhbnRlZS5cbiAgICovXG4gIHN5bmNlZFRocm91Z2g/OiBudW1iZXIgfCBudWxsO1xuICAvKipcbiAgICogQSByZW1vdGUgY2hhbmdlIHdhcyBkZWZlcnJlZCBvdmVyIGxvY2FsbHktZGl2ZXJnZWQgY29udGVudCAoYGhhbmRsZUNoYW5nZWBcbiAgICogZ3VhcmQpIGFuZCBoYXMgbm90IGJlZW4gdGhyb3VnaCBhIHBsYW4gY3ljbGUgeWV0LiBUaGUgbmV4dCBtYW5pZmVzdCBtdXN0XG4gICAqIGJlIEZVTEwgc28gYGNvbXB1dGVTeW5jUGxhbmAgc2VlcyB0aGUgcmVtb3RlIGhlYWQgYW5kIHJlc29sdmVzIHRoZVxuICAgKiBkaXZlcmdlbmNlIHRocm91Z2ggaXRzIGNvbmZsaWN0IGxvZ2ljIGluc3RlYWQgb2YgYSBzdGFsZS1wYXJlbnQgcHVzaC5cbiAgICovXG4gIG5lZWRzRnVsbE1hbmlmZXN0PzogYm9vbGVhbjtcbn1cblxuLyoqIE9uZSBhdXRob3JpdGF0aXZlIHN0YXRlIGNoYW5nZSB0byBmb2xkIGludG8gdGhlIGluZGV4LiAqL1xuZXhwb3J0IGludGVyZmFjZSBMb2NhbEluZGV4Q29tbWl0IHtcbiAgcGF0aDogc3RyaW5nO1xuICB2ZXJzaW9uSWQ6IHN0cmluZztcbiAgaGFzaDogc3RyaW5nO1xuICBzaXplOiBudW1iZXI7XG4gIGNsb2NrOiBMb2dpY2FsQ2xvY2s7XG4gIC8qKiBQcmVzZW50IFx1MjFEMiB0b21ic3RvbmU6IHRoZSBwYXRoIHdhcyBkZWxldGVkIGF0IHRoaXMgZXBvY2ggbXMuICovXG4gIGRlbGV0ZWQ/OiBib29sZWFuO1xuICAvKiogRXBvY2ggbXMgb2YgdGhlIGRlbGV0aW9uIFx1MjAxNCByZXF1aXJlZCB3aGVuIGBkZWxldGVkYCBpcyB0cnVlLiAqL1xuICBkZWxldGVkQXQ/OiBudW1iZXI7XG4gIC8qKiBUcnVlIHdoZW4gdGhpcyBjb21taXQgcmVjb3JkcyBhbiBlbXB0eS1mb2xkZXIgcGxhY2Vob2xkZXIgKEZSLTEwKS4gKi9cbiAgaXNGb2xkZXI/OiBib29sZWFuO1xuICAvKipcbiAgICogU3RvcmFnZSBtdGltZSBvYnNlcnZlZCBhdCBIQVNIIHRpbWUgZm9yIHRoaXMgZXhhY3QgY29udGVudCBcdTIwMTQgcGlubmVkIG9udG9cbiAgICogdGhlIGVudHJ5IHdoZW4gdGhlIGNvbW1pdCBpcyBmb2xkZWQgKGkuZS4gYXQgY29tbWl0LWFjayB0aW1lKS4gVGhyZWFkaW5nXG4gICAqIHRoZSBzdGF0IHRoYXQgY28tb2NjdXJyZWQgd2l0aCB0aGUgaGFzaGVkIGJ5dGVzIChyYXRoZXIgdGhhbiBhbnlcbiAgICogbGF0ZXIvY3VycmVudCBzdGF0KSBndWFyYW50ZWVzIHRoZSBmYXN0LXBhdGggY2FjaGUgY2FuIG5ldmVyIHBhaXIgYVxuICAgKiBmcmVzaGVyIHN0YXQgd2l0aCB0aGlzIGhhc2gsIHdoaWNoIHdvdWxkIGhpZGUgYW4gZWRpdCBmcm9tIGV2ZXJ5IGZ1dHVyZVxuICAgKiBzY2FuICh0aGUgc2lsZW50IGRyb3BwZWQtZWRpdCBjbGFzcykuIEFic2VudCBcdTIxRDIgdW5rbm93bjsgdGhlIG5leHQgc2NhblxuICAgKiByZS1oYXNoZXMgYW5kIHJlY29yZHMgdmlhIGByZWNvcmRIYXNoZWRGaWxlc2AuXG4gICAqL1xuICBtdGltZT86IG51bWJlcjtcbn1cblxuLyoqXG4gKiBGb2xkIG9uZSBjb21taXQgaW50byB0aGUgaW5kZXguIFB1cmU6IHJldHVybnMgYSBuZXcgaW5kZXgsIGlucHV0IHVudG91Y2hlZC5cbiAqXG4gKiBBcHBseWluZyBhIGNvbW1pdCBmb3IgYSBwYXRoIHJlcGxhY2VzIHRoYXQgcGF0aCdzIGVudHJ5IHdob2xlc2FsZSAoYSBjb21taXRcbiAqICppcyogdGhlIG5ldyB0cnV0aCBmb3IgdGhlIHBhdGgpOyBgYXBwbHlDb21taXRgIG5ldmVyIG1lcmdlcyBmaWVsZHMuXG4gKiBUb21ic3RvbmluZyAoYGRlbGV0ZWQ6IHRydWVgKSByZXF1aXJlcyBgZGVsZXRlZEF0YCBhbmQga2VlcHMgdGhlIGVudHJ5LlxuICpcbiAqIFRvIGRyb3AgYW4gZW50cnkgZW50aXJlbHkgKHRoZSBwYXRoIG1pZ3JhdGVkIGF3YXksIGUuZy4gYSBzeW5jZWQgcmVuYW1lKVxuICogdXNlIGByZW1vdmVFbnRyeWAgaW5zdGVhZC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5Q29tbWl0KGluZGV4OiBMb2NhbEluZGV4LCBjb21taXQ6IExvY2FsSW5kZXhDb21taXQpOiBMb2NhbEluZGV4IHtcbiAgaWYgKGNvbW1pdC5kZWxldGVkICYmIGNvbW1pdC5kZWxldGVkQXQgPT09IHVuZGVmaW5lZCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIGBhcHBseUNvbW1pdDogdG9tYnN0b25lIGZvciAke0pTT04uc3RyaW5naWZ5KGNvbW1pdC5wYXRoKX0gcmVxdWlyZXMgZGVsZXRlZEF0YCxcbiAgICApO1xuICB9XG4gIGNvbnN0IG5leHQ6IFJlY29yZDxzdHJpbmcsIExvY2FsSW5kZXhFbnRyeT4gPSB7IC4uLmluZGV4IH07XG4gIGNvbnN0IGVudHJ5OiBMb2NhbEluZGV4RW50cnkgPSB7XG4gICAgaGFzaDogY29tbWl0Lmhhc2gsXG4gICAgc2l6ZTogY29tbWl0LnNpemUsXG4gICAgdmVyc2lvbklkOiBjb21taXQudmVyc2lvbklkLFxuICAgIGNsb2NrOiBjb21taXQuY2xvY2ssXG4gIH07XG4gIGlmIChjb21taXQuZGVsZXRlZCkgZW50cnkuZGVsZXRlZEF0ID0gY29tbWl0LmRlbGV0ZWRBdDtcbiAgaWYgKGNvbW1pdC5pc0ZvbGRlcikgZW50cnkuaXNGb2xkZXIgPSB0cnVlO1xuICBpZiAoY29tbWl0Lm10aW1lICE9PSB1bmRlZmluZWQpIGVudHJ5Lm10aW1lID0gY29tbWl0Lm10aW1lO1xuICBuZXh0W2NvbW1pdC5wYXRoXSA9IGVudHJ5O1xuICByZXR1cm4gbmV4dDtcbn1cblxuLyoqXG4gKiBSZW1vdmUgYSBwYXRoJ3MgZW50cnkgZW50aXJlbHkgKG5vIHRvbWJzdG9uZSkuIFVzZWQgd2hlbiB0aGUgYXV0aG9yaXR5XG4gKiBtaWdyYXRlcyBhIHBhdGgncyB2ZXJzaW9uIGNoYWluIGVsc2V3aGVyZSBcdTIwMTQgaS5lLiBhIHN5bmNlZCByZW5hbWU6IHRoZSBvbGRcbiAqIHBhdGggbXVzdCB2YW5pc2ggZnJvbSB0aGUgaW5kZXggZXhhY3RseSBhcyBpdCB2YW5pc2hlZCBmcm9tIHRoZSBtYW5pZmVzdC5cbiAqIFB1cmU7IHJlbW92aW5nIGFuIGFic2VudCBwYXRoIGlzIGEgbm8tb3AuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZW1vdmVFbnRyeShpbmRleDogTG9jYWxJbmRleCwgcGF0aDogc3RyaW5nKTogTG9jYWxJbmRleCB7XG4gIGlmICghKHBhdGggaW4gaW5kZXgpKSByZXR1cm4gaW5kZXg7XG4gIGNvbnN0IG5leHQ6IFJlY29yZDxzdHJpbmcsIExvY2FsSW5kZXhFbnRyeT4gPSB7IC4uLmluZGV4IH07XG4gIGRlbGV0ZSBuZXh0W3BhdGhdO1xuICByZXR1cm4gbmV4dDtcbn1cblxuLyoqXG4gKiBTZXJpYWxpemUgdG8gYSBkZXRlcm1pbmlzdGljIEpTT04gc3RyaW5nOiB2ZXJzaW9uZWQgZW52ZWxvcGUsIGVudHJpZXNcbiAqIHNvcnRlZCBieSBwYXRoIChzbyBpZGVudGljYWwgaW5kZXhlcyBzZXJpYWxpemUgYnl0ZS1pZGVudGljYWxseSBhbmQgZGlmZlxuICogY2xlYW5seSBpbiBzdGF0ZS1kaXIgbGlzdGluZ3MpLiBgc3RhdGVgIChvcHRpb25hbCkgY2FycmllcyB0aGUgc3luYy1jdXJzb3JcbiAqIGJvb2trZWVwaW5nIHBlcnNpc3RlZCBhbG9uZ3NpZGUgdGhlIGVudHJpZXMgXHUyMDE0IHNlZSBgUGVyc2lzdGVkU3luY1N0YXRlYC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNlcmlhbGl6ZUxvY2FsSW5kZXgoaW5kZXg6IExvY2FsSW5kZXgsIHN0YXRlOiBQZXJzaXN0ZWRTeW5jU3RhdGUgPSB7fSk6IHN0cmluZyB7XG4gIGNvbnN0IGVudHJpZXM6IFJlY29yZDxzdHJpbmcsIExvY2FsSW5kZXhFbnRyeT4gPSB7fTtcbiAgZm9yIChjb25zdCBwYXRoIG9mIE9iamVjdC5rZXlzKGluZGV4KS5zb3J0KCkpIHtcbiAgICBlbnRyaWVzW3BhdGhdID0gaW5kZXhbcGF0aF0gYXMgTG9jYWxJbmRleEVudHJ5O1xuICB9XG4gIGNvbnN0IGVudmVsb3BlOiBMb2NhbEluZGV4RW52ZWxvcGUgPSB7XG4gICAgc2NoZW1hVmVyc2lvbjogTE9DQUxfSU5ERVhfU0NIRU1BX1ZFUlNJT04sXG4gICAgZW50cmllcyxcbiAgICAuLi4oc3RhdGUuY3Vyc29yICE9PSB1bmRlZmluZWQgPyB7IGN1cnNvcjogc3RhdGUuY3Vyc29yIH0gOiB7fSksXG4gICAgLi4uKHN0YXRlLnN5bmNlZFRocm91Z2ggIT09IHVuZGVmaW5lZCA/IHsgc3luY2VkVGhyb3VnaDogc3RhdGUuc3luY2VkVGhyb3VnaCB9IDoge30pLFxuICAgIC4uLihzdGF0ZS5uZWVkc0Z1bGxNYW5pZmVzdCAhPT0gdW5kZWZpbmVkXG4gICAgICA/IHsgbmVlZHNGdWxsTWFuaWZlc3Q6IHN0YXRlLm5lZWRzRnVsbE1hbmlmZXN0IH1cbiAgICAgIDoge30pLFxuICB9O1xuICByZXR1cm4gSlNPTi5zdHJpbmdpZnkoZW52ZWxvcGUpO1xufVxuXG4vKiogVGhlIGVudHJpZXMgcGx1cyB0aGUgc3luYy1jdXJzb3IgYm9va2tlZXBpbmcgb2YgYSBwZXJzaXN0ZWQgc3RhdGUgZmlsZS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRGVzZXJpYWxpemVkTG9jYWxTdGF0ZSB7XG4gIGluZGV4OiBMb2NhbEluZGV4O1xuICAvKiogRW52ZWxvcGUgYm9va2tlZXBpbmc7IGRlZmF1bHRzIGZvciBmaWxlcyB3cml0dGVuIGJlZm9yZSBpdCBleGlzdGVkLiAqL1xuICBzdGF0ZTogUmVxdWlyZWQ8UGVyc2lzdGVkU3luY1N0YXRlPjtcbn1cblxuLyoqXG4gKiBQYXJzZSBhIHNlcmlhbGl6ZWQgc3RhdGUgZmlsZSBJTkNMVURJTkcgaXRzIGVudmVsb3BlIGJvb2trZWVwaW5nICh0aGVcbiAqIGNsaWVudCdzIHN0YXJ0dXAgcGF0aCkuIEVudHJ5IHZhbGlkYXRpb24gaXMgaWRlbnRpY2FsIHRvXG4gKiBgZGVzZXJpYWxpemVMb2NhbEluZGV4YDsgdGhlIGV4dHJhIGZpZWxkcyBkZWZhdWx0IHRvIFwibm8gY3Vyc29yIGtub3dsZWRnZVwiXG4gKiAoYGN1cnNvcjogMGAsIGBzeW5jZWRUaHJvdWdoOiBudWxsYCwgYG5lZWRzRnVsbE1hbmlmZXN0OiBmYWxzZWApIHNvIHYyXG4gKiBmaWxlcyB3cml0dGVuIGJ5IG9sZGVyIGJ1aWxkcyBsb2FkIHVuY2hhbmdlZCBhbmQgc2ltcGx5IHJlY29ubmVjdCB3aXRoIGFcbiAqIGZ1bGwgbWFuaWZlc3QuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkZXNlcmlhbGl6ZUxvY2FsU3RhdGUoanNvbjogc3RyaW5nKTogRGVzZXJpYWxpemVkTG9jYWxTdGF0ZSB7XG4gIGxldCBwYXJzZWQ6IHVua25vd247XG4gIHRyeSB7XG4gICAgcGFyc2VkID0gSlNPTi5wYXJzZShqc29uKTtcbiAgfSBjYXRjaCAoY2F1c2UpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcignTG9jYWwgaW5kZXggc3RhdGUgaXMgbm90IHZhbGlkIEpTT04nLCB7IGNhdXNlIH0pO1xuICB9XG4gIGlmICghaXNQbGFpbk9iamVjdChwYXJzZWQpKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoJ0xvY2FsIGluZGV4IHN0YXRlIGlzIG5vdCBhbiBvYmplY3QnKTtcbiAgfVxuICAvLyBFbnRyeS1sZXZlbCB2YWxpZGF0aW9uIGlzIGV4YWN0bHkgYGRlc2VyaWFsaXplTG9jYWxJbmRleGAnczsgdGhlIGNhbGxcbiAgLy8gYWxzbyBlbmZvcmNlcyB0aGUgc2NoZW1hLXZlcnNpb24gd2luZG93LlxuICBjb25zdCBpbmRleCA9IGRlc2VyaWFsaXplTG9jYWxJbmRleChqc29uKTtcbiAgY29uc3QgcmF3Q3Vyc29yID0gKHBhcnNlZCBhcyB7IGN1cnNvcj86IHVua25vd24gfSkuY3Vyc29yO1xuICBjb25zdCByYXdTeW5jZWRUaHJvdWdoID0gKHBhcnNlZCBhcyB7IHN5bmNlZFRocm91Z2g/OiB1bmtub3duIH0pLnN5bmNlZFRocm91Z2g7XG4gIGNvbnN0IHJhd05lZWRzRnVsbCA9IChwYXJzZWQgYXMgeyBuZWVkc0Z1bGxNYW5pZmVzdD86IHVua25vd24gfSkubmVlZHNGdWxsTWFuaWZlc3Q7XG4gIGlmIChyYXdDdXJzb3IgIT09IHVuZGVmaW5lZCAmJiAodHlwZW9mIHJhd0N1cnNvciAhPT0gJ251bWJlcicgfHwgIU51bWJlci5pc0ludGVnZXIocmF3Q3Vyc29yKSB8fCByYXdDdXJzb3IgPCAwKSkge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKCdMb2NhbCBpbmRleCBzdGF0ZTogY3Vyc29yIG11c3QgYmUgYSBub24tbmVnYXRpdmUgaW50ZWdlcicpO1xuICB9XG4gIGlmIChcbiAgICByYXdTeW5jZWRUaHJvdWdoICE9PSB1bmRlZmluZWQgJiZcbiAgICByYXdTeW5jZWRUaHJvdWdoICE9PSBudWxsICYmXG4gICAgKHR5cGVvZiByYXdTeW5jZWRUaHJvdWdoICE9PSAnbnVtYmVyJyB8fCAhTnVtYmVyLmlzSW50ZWdlcihyYXdTeW5jZWRUaHJvdWdoKSB8fCByYXdTeW5jZWRUaHJvdWdoIDwgMClcbiAgKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoJ0xvY2FsIGluZGV4IHN0YXRlOiBzeW5jZWRUaHJvdWdoIG11c3QgYmUgYSBub24tbmVnYXRpdmUgaW50ZWdlciBvciBudWxsJyk7XG4gIH1cbiAgaWYgKHJhd05lZWRzRnVsbCAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiByYXdOZWVkc0Z1bGwgIT09ICdib29sZWFuJykge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKCdMb2NhbCBpbmRleCBzdGF0ZTogbmVlZHNGdWxsTWFuaWZlc3QgbXVzdCBiZSBhIGJvb2xlYW4gd2hlbiBwcmVzZW50Jyk7XG4gIH1cbiAgcmV0dXJuIHtcbiAgICBpbmRleCxcbiAgICBzdGF0ZToge1xuICAgICAgY3Vyc29yOiB0eXBlb2YgcmF3Q3Vyc29yID09PSAnbnVtYmVyJyA/IHJhd0N1cnNvciA6IDAsXG4gICAgICBzeW5jZWRUaHJvdWdoOiB0eXBlb2YgcmF3U3luY2VkVGhyb3VnaCA9PT0gJ251bWJlcicgPyByYXdTeW5jZWRUaHJvdWdoIDogbnVsbCxcbiAgICAgIG5lZWRzRnVsbE1hbmlmZXN0OiByYXdOZWVkc0Z1bGwgPT09IHRydWUsXG4gICAgfSxcbiAgfTtcbn1cblxuLyoqXG4gKiBQYXJzZSBhIHNlcmlhbGl6ZWQgaW5kZXggYmFjay4gVGhyb3dzIGBQcm90b2NvbEVycm9yYCBvbiBub24tSlNPTiBpbnB1dCxcbiAqIGEgbWFsZm9ybWVkIGVudmVsb3BlLCBlbnRyaWVzIHdpdGggd3JvbmcgZmllbGQgdHlwZXMsIG9yIGEgYHNjaGVtYVZlcnNpb25gXG4gKiBvdXRzaWRlIHRoZSBzdXBwb3J0ZWQgcmFuZ2UgKG9sZGVyIHRoYW4gYE1JTl9MT0NBTF9JTkRFWF9TQ0hFTUFfVkVSU0lPTmBcbiAqIG9yIG5ld2VyIHRoYW4gYExPQ0FMX0lOREVYX1NDSEVNQV9WRVJTSU9OYCkgXHUyMDE0IG9sZGVyIHZlcnNpb25zICp3aXRoaW4qIHRoZVxuICogcmFuZ2UgbG9hZCB3aXRob3V0IGVycm9yICh2MSBlbnRyaWVzIHNpbXBseSBkZXNlcmlhbGl6ZSB3aXRoIGBtdGltZWBcbiAqIHVua25vd24pLiBVbmtub3duIGV4dHJhIGZpZWxkcyBhcmUgdG9sZXJhdGVkIGZvciBmb3J3YXJkIGNvbXBhdGliaWxpdHkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkZXNlcmlhbGl6ZUxvY2FsSW5kZXgoanNvbjogc3RyaW5nKTogTG9jYWxJbmRleCB7XG4gIGxldCBwYXJzZWQ6IHVua25vd247XG4gIHRyeSB7XG4gICAgcGFyc2VkID0gSlNPTi5wYXJzZShqc29uKTtcbiAgfSBjYXRjaCAoY2F1c2UpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcignTG9jYWwgaW5kZXggc3RhdGUgaXMgbm90IHZhbGlkIEpTT04nLCB7IGNhdXNlIH0pO1xuICB9XG4gIGlmICghaXNQbGFpbk9iamVjdChwYXJzZWQpKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoJ0xvY2FsIGluZGV4IHN0YXRlIGlzIG5vdCBhbiBvYmplY3QnKTtcbiAgfVxuICBjb25zdCB2ZXJzaW9uID0gcGFyc2VkLnNjaGVtYVZlcnNpb247XG4gIGlmICh0eXBlb2YgdmVyc2lvbiAhPT0gJ251bWJlcicgfHwgIU51bWJlci5pc0ludGVnZXIodmVyc2lvbikpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcignTG9jYWwgaW5kZXggc3RhdGUgaXMgbWlzc2luZyBpbnRlZ2VyIHNjaGVtYVZlcnNpb24nKTtcbiAgfVxuICBpZiAodmVyc2lvbiA8IE1JTl9MT0NBTF9JTkRFWF9TQ0hFTUFfVkVSU0lPTiB8fCB2ZXJzaW9uID4gTE9DQUxfSU5ERVhfU0NIRU1BX1ZFUlNJT04pIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihcbiAgICAgIGBMb2NhbCBpbmRleCBzY2hlbWEgdmVyc2lvbiAke3ZlcnNpb259IGlzIG5vdCBzdXBwb3J0ZWQgYnkgdGhpcyBidWlsZCBgICtcbiAgICAgICAgYChleHBlY3RlZCAke01JTl9MT0NBTF9JTkRFWF9TQ0hFTUFfVkVSU0lPTn0uLiR7TE9DQUxfSU5ERVhfU0NIRU1BX1ZFUlNJT059KTsgYCArXG4gICAgICAgICdhIG1pZ3JhdGlvbiBpcyByZXF1aXJlZCcsXG4gICAgKTtcbiAgfVxuICBjb25zdCByYXdFbnRyaWVzID0gcGFyc2VkLmVudHJpZXM7XG4gIGlmICghaXNQbGFpbk9iamVjdChyYXdFbnRyaWVzKSkge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKCdMb2NhbCBpbmRleCBzdGF0ZSBpcyBtaXNzaW5nIHRoZSBlbnRyaWVzIG9iamVjdCcpO1xuICB9XG5cbiAgY29uc3QgZW50cmllczogUmVjb3JkPHN0cmluZywgTG9jYWxJbmRleEVudHJ5PiA9IHt9O1xuICBmb3IgKGNvbnN0IFtwYXRoLCByYXddIG9mIE9iamVjdC5lbnRyaWVzKHJhd0VudHJpZXMpKSB7XG4gICAgZW50cmllc1twYXRoXSA9IHBhcnNlRW50cnkocGF0aCwgcmF3KTtcbiAgfVxuICByZXR1cm4gZW50cmllcztcbn1cblxuZnVuY3Rpb24gcGFyc2VFbnRyeShwYXRoOiBzdHJpbmcsIHJhdzogdW5rbm93bik6IExvY2FsSW5kZXhFbnRyeSB7XG4gIGNvbnN0IHdoZXJlID0gYExvY2FsIGluZGV4IGVudHJ5ICR7SlNPTi5zdHJpbmdpZnkocGF0aCl9YDtcbiAgaWYgKCFpc1BsYWluT2JqZWN0KHJhdykpIHRocm93IG5ldyBQcm90b2NvbEVycm9yKGAke3doZXJlfSBpcyBub3QgYW4gb2JqZWN0YCk7XG4gIGNvbnN0IHsgaGFzaCwgc2l6ZSwgdmVyc2lvbklkLCBjbG9jaywgZGVsZXRlZEF0LCBpc0ZvbGRlciwgbXRpbWUgfSA9IHJhdyBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgaWYgKHR5cGVvZiBoYXNoICE9PSAnc3RyaW5nJykgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoYCR7d2hlcmV9OiBoYXNoIG11c3QgYmUgYSBzdHJpbmdgKTtcbiAgaWYgKHR5cGVvZiB2ZXJzaW9uSWQgIT09ICdzdHJpbmcnKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoYCR7d2hlcmV9OiB2ZXJzaW9uSWQgbXVzdCBiZSBhIHN0cmluZ2ApO1xuICB9XG4gIGlmICh0eXBlb2Ygc2l6ZSAhPT0gJ251bWJlcicgfHwgIU51bWJlci5pc0ludGVnZXIoc2l6ZSkgfHwgc2l6ZSA8IDApIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgJHt3aGVyZX06IHNpemUgbXVzdCBiZSBhIG5vbi1uZWdhdGl2ZSBpbnRlZ2VyYCk7XG4gIH1cbiAgaWYgKCFpc1BsYWluT2JqZWN0KGNsb2NrKSB8fCB0eXBlb2YgY2xvY2suY291bnRlciAhPT0gJ251bWJlcicgfHwgdHlwZW9mIGNsb2NrLmRldmljZUlkICE9PSAnc3RyaW5nJykge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKGAke3doZXJlfTogY2xvY2sgbXVzdCBiZSB7IGNvdW50ZXI6IG51bWJlciwgZGV2aWNlSWQ6IHN0cmluZyB9YCk7XG4gIH1cbiAgaWYgKGRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBkZWxldGVkQXQgIT09ICdudW1iZXInKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoYCR7d2hlcmV9OiBkZWxldGVkQXQgbXVzdCBiZSBhIG51bWJlciB3aGVuIHByZXNlbnRgKTtcbiAgfVxuICBpZiAoaXNGb2xkZXIgIT09IHVuZGVmaW5lZCAmJiB0eXBlb2YgaXNGb2xkZXIgIT09ICdib29sZWFuJykge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKGAke3doZXJlfTogaXNGb2xkZXIgbXVzdCBiZSBhIGJvb2xlYW4gd2hlbiBwcmVzZW50YCk7XG4gIH1cbiAgaWYgKG10aW1lICE9PSB1bmRlZmluZWQgJiYgKHR5cGVvZiBtdGltZSAhPT0gJ251bWJlcicgfHwgIU51bWJlci5pc0Zpbml0ZShtdGltZSkpKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoYCR7d2hlcmV9OiBtdGltZSBtdXN0IGJlIGEgZmluaXRlIG51bWJlciB3aGVuIHByZXNlbnRgKTtcbiAgfVxuICBjb25zdCBlbnRyeTogTG9jYWxJbmRleEVudHJ5ID0ge1xuICAgIGhhc2gsXG4gICAgc2l6ZSxcbiAgICB2ZXJzaW9uSWQsXG4gICAgY2xvY2s6IHsgY291bnRlcjogY2xvY2suY291bnRlciBhcyBudW1iZXIsIGRldmljZUlkOiBjbG9jay5kZXZpY2VJZCBhcyBzdHJpbmcgfSxcbiAgfTtcbiAgaWYgKGRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkKSBlbnRyeS5kZWxldGVkQXQgPSBkZWxldGVkQXQgYXMgbnVtYmVyO1xuICBpZiAoaXNGb2xkZXIgIT09IHVuZGVmaW5lZCkgZW50cnkuaXNGb2xkZXIgPSBpc0ZvbGRlciBhcyBib29sZWFuO1xuICBpZiAobXRpbWUgIT09IHVuZGVmaW5lZCkgZW50cnkubXRpbWUgPSBtdGltZSBhcyBudW1iZXI7XG4gIHJldHVybiBlbnRyeTtcbn1cblxuZnVuY3Rpb24gaXNQbGFpbk9iamVjdCh2YWx1ZTogdW5rbm93bik6IHZhbHVlIGlzIFJlY29yZDxzdHJpbmcsIHVua25vd24+IHtcbiAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiYgdmFsdWUgIT09IG51bGwgJiYgIUFycmF5LmlzQXJyYXkodmFsdWUpO1xufVxuIiwgIi8qKlxyXG4gKiBUaGluIHB1bGwtc2lkZSBvcmNoZXN0cmF0aW9uIChBUkNISVRFQ1RVUkUubWQgXHUwMEE3OCBzdGVwIDUpLiBOT1QgdGhlIG5ldHdvcmtcclxuICogY2xpZW50OiBhbGwgdHJhbnNwb3J0IGlzIGluamVjdGVkIChgZmV0Y2hCbG9iYCksIHdoaWNoIHRoZSBsYXRlciBuZXR3b3JrXHJcbiAqIHBoYXNlIGltcGxlbWVudHMgb3ZlciBgL2Jsb2IvOmhhc2hgIG9yIFdTLWlubGluZSBjb250ZW50LlxyXG4gKlxyXG4gKiBgYXBwbHlQdWxsYCBtYXRlcmlhbGl6ZXMgZXZlcnkgYFB1bGxPcGAgb2YgYSBgU3luY1BsYW5gIHRocm91Z2ggdGhlXHJcbiAqIHN0b3JhZ2UgYWRhcHRlciBhbmQgdXBkYXRlcyB0aGUgbG9jYWwgaW5kZXggXHUyMDE0IGR1cmFibHkgYW5kIGhvbmVzdGx5OlxyXG4gKlxyXG4gKiAgIC0gYmxvYnMgYXJlIHZlcmlmaWVkIChzaGEyNTYpIGJlZm9yZSBiZWluZyB3cml0dGVuOyBhIG1pc21hdGNoIGFib3J0c1xyXG4gKiAgICAgdGhlIHBsYW47XHJcbiAqICAgLSBlYWNoIGluZGV4IGVudHJ5IGlzIHJlY29yZGVkIG9ubHkgKmFmdGVyKiBpdHMgc3RvcmFnZSB3cml0ZSBzdWNjZWVkZWQsXHJcbiAqICAgICBzbyBhIG1pZC1wbGFuIGZhaWx1cmUgbGVhdmVzIHRoZSBpbmRleCBkZXNjcmliaW5nIGV4YWN0bHkgdGhlIGZpbGVzXHJcbiAqICAgICB0aGF0IGFjdHVhbGx5IGxhbmRlZCAoRlItNTogbm90aGluZyBpcyBzaWxlbnRseSBsb3N0IFx1MjAxNCB0aGUgdW5zeW5jZWRcclxuICogICAgIHB1bGxzIHNpbXBseSByZW1haW4gaW4gdGhlIHBsYW4gYW5kIGFyZSByZXRyaWVkIGJ5IHRoZSBjYWxsZXIpO1xyXG4gKiAgIC0gdGhlIGluZGV4IGlzIHBlcnNpc3RlZCB0aHJvdWdoIHRoZSBhZGFwdGVyJ3MgYXRvbWljIGB3cml0ZUZpbGVgXHJcbiAqICAgICAodGVtcCArIHJlbmFtZSBwZXIgdGhlIGFkYXB0ZXIgY29udHJhY3QpIGF0XHJcbiAqICAgICBgLy52YXVsdHN5bmNmb3JhZ2VudHMvc3RhdGVgLCBpbmNsdWRpbmcgb24gdGhlIGZhaWx1cmUgcGF0aC5cclxuICpcclxuICogRm9sZGVyIGxpZmVjeWNsZSAoRlItMTAgYW5kIGl0cyBkZWxldGlvbiBjb3VudGVycGFydCk6XHJcbiAqXHJcbiAqICAgLSBhcHBseWluZyBhIFJFTU9URSBGT0xERVIgVE9NQlNUT05FIHJlbW92ZXMgdGhlIGxvY2FsIGRpcmVjdG9yeSB3aGVuXHJcbiAqICAgICBpdCBleGlzdHMgYW5kIGlzIGVtcHR5IChhZGFwdGVyIGByZW1vdmVEaXJgKTsgbm9uLWVtcHR5IG9yIG1pc3NpbmcgXHUyMUQyXHJcbiAqICAgICByZWNvcmQgdGhlIHRvbWJzdG9uZSBvbmx5IFx1MjAxNCB0aGUgZGlyZWN0b3J5IGNvbnZlcmdlcyBsYXRlciwgYW5kIGFcclxuICogICAgIG5vbi1lbXB0eSBkaXJlY3RvcnkgaXMgbmV2ZXIgZGVsZXRlZDtcclxuICogICAtIFBSVU5FLU9OLURFTEVURTogYXBwbHlpbmcgYSByZW1vdGUgZmlsZSBkZWxldGlvbiAob3IgcmVuYW1lIGF3YXkpXHJcbiAqICAgICByZW1vdmVzIHRoZSBkZWxldGVkIHBhdGgncyBwYXJlbnQgZGlyZWN0b3J5IHdoZW4gaXQgaXMgbm93IGVtcHR5IG9uXHJcbiAqICAgICBkaXNrIGFuZCBob2xkcyBubyBsaXZlIGZpbGUgZW50cmllcyBpbiB0aGUgaW5kZXggXHUyMDE0IHRoaXMgaXMgd2hhdCBzdG9wc1xyXG4gKiAgICAgYW4gZW1wdGllZCBkaXJlY3RvcnkgZnJvbSBzZWxmLXJlc3VycmVjdGluZyBhcyBhbiBlbXB0eS1mb2xkZXJcclxuICogICAgIHBsYWNlaG9sZGVyIG9uIHRoZSBuZXh0IHNjYW4uIEV4YWN0bHkgT05FIGxldmVsIHBlciBkZWxldGlvbjogdGhlXHJcbiAqICAgICBpbW1lZGlhdGUgcGFyZW50IG9ubHksIG5ldmVyIGEgY2FzY2FkZSAoYSBjaGFpbiBvZiBlbXB0aWVkXHJcbiAqICAgICBkaXJlY3RvcmllcyBjb252ZXJnZXMgb3ZlciBzdWNjZXNzaXZlIGN5Y2xlczsgdGhlIHNhZmV0eSBpbnZhcmlhbnQgXHUyMDE0XHJcbiAqICAgICBuZXZlciBkZWxldGUgYSBub24tZW1wdHkgZGlyZWN0b3J5LCBuZXZlciBsb3NlIHVzZXIgY29udGVudCBcdTIwMTQgaXNcclxuICogICAgIGNoZWNrZWQgYmVmb3JlIGV2ZXJ5IHJlbW92YWwpLlxyXG4gKlxyXG4gKiBQdXNoZXMvY29uZmxpY3RzL2ZvbGRlciBvcHMgYXJlIHRoZSBuZXR3b3JrIHBoYXNlJ3MgYnVzaW5lc3M7IHJldHJ5XHJcbiAqIHF1ZXVlcyBhcmUgZXhwbGljaXRseSBvdXQgb2Ygc2NvcGUgaGVyZS5cclxuICovXHJcblxyXG5pbXBvcnQgdHlwZSB7IFN0b3JhZ2VBZGFwdGVyIH0gZnJvbSAnLi9hZGFwdGVycy5qcyc7XHJcbmltcG9ydCB7IHNoYTI1NkhleCB9IGZyb20gJy4vaGFzaGluZy5qcyc7XHJcbmltcG9ydCB7XHJcbiAgYXBwbHlDb21taXQsXHJcbiAgZGVzZXJpYWxpemVMb2NhbFN0YXRlLFxyXG4gIExPQ0FMX0lOREVYX1NUQVRFX1BBVEgsXHJcbiAgcmVtb3ZlRW50cnksXHJcbiAgc2VyaWFsaXplTG9jYWxJbmRleCxcclxuICB0eXBlIERlc2VyaWFsaXplZExvY2FsU3RhdGUsXHJcbiAgdHlwZSBMb2NhbEluZGV4LFxyXG4gIHR5cGUgUGVyc2lzdGVkU3luY1N0YXRlLFxyXG59IGZyb20gJy4vbG9jYWxpbmRleC5qcyc7XHJcbmltcG9ydCB7IGlzU3RyaWN0bHlCZW5lYXRoLCBwYXJlbnRQYXRoIH0gZnJvbSAnLi9wYXRocy5qcyc7XHJcbmltcG9ydCB0eXBlIHsgUHVsbE9wLCBTeW5jUGxhbiB9IGZyb20gJy4vcmVzb2x2ZS5qcyc7XHJcblxyXG4vKiogSW5qZWN0ZWQgY29udGVudCB0cmFuc3BvcnQ6IGZldGNoIHRoZSBibG9iIGZvciBhIGNvbnRlbnQgaGFzaC4gKi9cclxuZXhwb3J0IHR5cGUgRmV0Y2hCbG9iID0gKGhhc2g6IHN0cmluZykgPT4gUHJvbWlzZTxVaW50OEFycmF5PjtcclxuXHJcbmV4cG9ydCBpbnRlcmZhY2UgQXBwbHlQdWxsT3B0aW9ucyB7XHJcbiAgLyoqIEVwb2NoIG1zIHVzZWQgZm9yIHRvbWJzdG9uZSB0aW1lc3RhbXBzLiBEZWZhdWx0OiBgRGF0ZS5ub3coKWAgXHUyMDE0IHRoaXNcclxuICAgKiAgZnVuY3Rpb24gaXMgSS9PIG9yY2hlc3RyYXRpb24sIG5vdCBhIHB1cmUgZnVuY3Rpb24sIGJ1dCB0ZXN0cyBpbmplY3RcclxuICAgKiAgYSBmaXhlZCB2YWx1ZSBmb3IgZGV0ZXJtaW5pc20uICovXHJcbiAgbm93PzogbnVtYmVyO1xyXG4gIC8qKlxyXG4gICAqIEJ1bGstcHVsbCBwcm9ncmVzczogY2FsbGVkIG9uY2Ugd2l0aCAoMCwgdG90YWwpIHVwIGZyb250IGFuZCBvbmNlIGFmdGVyXHJcbiAgICogZWFjaCBwdWxsIG1hdGVyaWFsaXplcy4gUHVyZSByZXBvcnRpbmcgXHUyMDE0IG5ldmVyIGFmZmVjdHMgYXBwbGljYXRpb24uXHJcbiAgICovXHJcbiAgb25Qcm9ncmVzcz86IChkb25lOiBudW1iZXIsIHRvdGFsOiBudW1iZXIpID0+IHZvaWQ7XHJcbiAgLyoqXHJcbiAgICogU3luYy1jdXJzb3IgYm9va2tlZXBpbmcgdG8gd3JpdGUgaW50byB0aGUgc3RhdGUgZmlsZSdzIGVudmVsb3BlIHdoZW5ldmVyXHJcbiAgICogdGhpcyBjYWxsIHBlcnNpc3RzIHRoZSBpbmRleC4gV2l0aG91dCBpdCBhIHB1bGwtc2lkZSBwZXJzaXN0IHdvdWxkIHN0cmlwXHJcbiAgICogdGhlIGNsaWVudCdzIGN1cnNvci9zeW5jZWRUaHJvdWdoIGZpZWxkcyBmcm9tIGAvLnZhdWx0c3luY2ZvcmFnZW50cy9zdGF0ZWBcclxuICAgKiAodGhlIGVudmVsb3BlIGlzIHJld3JpdHRlbiB3aG9sZXNhbGUpLiBUaGUgY2xpZW50IHBhc3NlcyBpdHMgY3VycmVudFxyXG4gICAqIHZhbHVlczsgYSBzbmFwc2hvdCBhIG1vbWVudCBzdGFsZSBpcyBoYXJtbGVzcyBcdTIwMTQgdGhlIG5leHQgcGVyc2lzdCByZWZyZXNoZXNcclxuICAgKiBpdCwgYW5kIGFuIHVuZGVyLXJlcG9ydGVkIGN1cnNvciBvbmx5IHdpZGVucyB0aGUgbmV4dCByZXBsYXkuXHJcbiAgICovXHJcbiAgcGVyc2lzdGVkU3RhdGU/OiBQZXJzaXN0ZWRTeW5jU3RhdGU7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBBcHBseSBhbGwgcHVsbHMgb2YgYHBsYW5gIGFuZCByZXR1cm4gdGhlIHVwZGF0ZWQgaW5kZXggKGFsc28gcGVyc2lzdGVkIHRvXHJcbiAqIHRoZSBhZGFwdGVyIGF0IGBMT0NBTF9JTkRFWF9TVEFURV9QQVRIYCkuXHJcbiAqXHJcbiAqIFN0b3JhZ2Ugd3JpdGVzIGhhcHBlbiBpbiBwbGFuIG9yZGVyLiBJZiBhbnkgb3AgZmFpbHMsIHRoZSBpbmRleCByZWZsZWN0aW5nXHJcbiAqIGV2ZXJ5IG9wIHRoYXQgc3VjY2VlZGVkIHNvIGZhciBpcyBwZXJzaXN0ZWQgYW5kIHRoZSBvcmlnaW5hbCBlcnJvciBpc1xyXG4gKiByZXRocm93biBcdTIwMTQgcGF0aHMgdGhhdCBmYWlsZWQgYXJlIGFic2VudCBmcm9tIHRoZSByZXR1cm5lZC9wZXJzaXN0ZWQgaW5kZXguXHJcbiAqL1xyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gYXBwbHlQdWxsKFxyXG4gIHN0b3JhZ2U6IFN0b3JhZ2VBZGFwdGVyLFxyXG4gIGluZGV4OiBMb2NhbEluZGV4LFxyXG4gIHBsYW46IFN5bmNQbGFuLFxyXG4gIGZldGNoQmxvYjogRmV0Y2hCbG9iLFxyXG4gIG9wdGlvbnM6IEFwcGx5UHVsbE9wdGlvbnMgPSB7fSxcclxuKTogUHJvbWlzZTxMb2NhbEluZGV4PiB7XHJcbiAgY29uc3Qgbm93ID0gb3B0aW9ucy5ub3cgPz8gRGF0ZS5ub3coKTtcclxuICBjb25zdCBvblByb2dyZXNzID0gb3B0aW9ucy5vblByb2dyZXNzO1xyXG4gIGxldCB3b3JraW5nOiBMb2NhbEluZGV4ID0gaW5kZXg7XHJcblxyXG4gIG9uUHJvZ3Jlc3M/LigwLCBwbGFuLnB1bGxzLmxlbmd0aCk7XHJcbiAgbGV0IGRvbmUgPSAwO1xyXG4gIHRyeSB7XHJcbiAgICBmb3IgKGNvbnN0IHB1bGwgb2YgcGxhbi5wdWxscykge1xyXG4gICAgICB3b3JraW5nID0gYXdhaXQgYXBwbHlPbmVQdWxsKHN0b3JhZ2UsIHdvcmtpbmcsIHB1bGwsIGZldGNoQmxvYiwgbm93KTtcclxuICAgICAgZG9uZSArPSAxO1xyXG4gICAgICBvblByb2dyZXNzPy4oZG9uZSwgcGxhbi5wdWxscy5sZW5ndGgpO1xyXG4gICAgfVxyXG4gIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICB0cnkge1xyXG4gICAgICBhd2FpdCBwZXJzaXN0SW5kZXgoc3RvcmFnZSwgd29ya2luZywgb3B0aW9ucy5wZXJzaXN0ZWRTdGF0ZSk7XHJcbiAgICB9IGNhdGNoIHtcclxuICAgICAgLy8gUGVyc2lzdGVuY2UgZmFpbHVyZSBtdXN0IG5vdCBtYXNrIHRoZSBvcmlnaW5hbCBlcnJvcjsgdGhlIGNhbGxlclxyXG4gICAgICAvLyByZXRyaWVzIHRoZSB3aG9sZSBjeWNsZSBhbnl3YXkuXHJcbiAgICB9XHJcbiAgICB0aHJvdyBlcnJvcjtcclxuICB9XHJcblxyXG4gIGF3YWl0IHBlcnNpc3RJbmRleChzdG9yYWdlLCB3b3JraW5nLCBvcHRpb25zLnBlcnNpc3RlZFN0YXRlKTtcclxuICByZXR1cm4gd29ya2luZztcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gYXBwbHlPbmVQdWxsKFxyXG4gIHN0b3JhZ2U6IFN0b3JhZ2VBZGFwdGVyLFxyXG4gIGluZGV4OiBMb2NhbEluZGV4LFxyXG4gIHB1bGw6IFB1bGxPcCxcclxuICBmZXRjaEJsb2I6IEZldGNoQmxvYixcclxuICBub3c6IG51bWJlcixcclxuKTogUHJvbWlzZTxMb2NhbEluZGV4PiB7XHJcbiAgaWYgKHB1bGwua2luZCA9PT0gJ3JlbmFtZScpIHtcclxuICAgIGlmIChwdWxsLmlzRm9sZGVyID09PSB0cnVlKSB7XHJcbiAgICAgIC8vIEZvbGRlciByZW5hbWUgKEZSLTEwKTogYSBtZXRhZGF0YSBtb3ZlIFx1MjAxNCB0aGUgaGFzaCBpcyB0aGVcclxuICAgICAgLy8gcGxhY2Vob2xkZXIncyBgJydgIGFuZCBtdXN0IE5FVkVSIHJlYWNoIGEgY29udGVudCBmZXRjaC4gVGhlIHJlbmFtZVxyXG4gICAgICAvLyBicmFuY2ggYmVsb3cgd291bGQgZmV0Y2ggd2hlbiBgZnJvbVBhdGhgIGlzIGdvbmUgbG9jYWxseSAoYWx3YXlzIHRydWVcclxuICAgICAgLy8gb24gdGhlIGF1dGhvciwgd2hvIGFscmVhZHkgbW92ZWQgdGhlIGRpcmVjdG9yeSksIHRyaXBwaW5nIHRoZVxyXG4gICAgICAvLyBlbXB0eS1oYXNoIGd1YXJkIGFuZCB3ZWRnaW5nIGV2ZXJ5IGxhdGVyIGN5Y2xlLiBJbnN0ZWFkOiBtYXRlcmlhbGl6ZVxyXG4gICAgICAvLyB0aGUgZGVzdGluYXRpb24sIHJldGlyZSB0aGUgc291cmNlIGVudHJ5LCBhbmQgcmVtb3ZlIHRoZSBzb3VyY2VcclxuICAgICAgLy8gZGlyZWN0b3J5IG9uY2UgaXQgaXMgdmFjYW50IChjaGlsZHJlbiBtb3ZlIHRocm91Z2ggdGhlaXIgb3duIGZpbGVcclxuICAgICAgLy8gb3BzOyBhIG5vbi1lbXB0eSBkaXJlY3RvcnkgaXMgbmV2ZXIgZGVsZXRlZCBhbmQgY29udmVyZ2VzIGxhdGVyIFx1MjAxNFxyXG4gICAgICAvLyBgcmVuYW1lRmlsZWAgaXMgYSBmaWxlLW9ubHkgY29udHJhY3QsIHNvIG5vIGRpcmVjdG9yeSByZW5hbWUgaXNcclxuICAgICAgLy8gYXR0ZW1wdGVkKS5cclxuICAgICAgYXdhaXQgc3RvcmFnZS5lbnN1cmVEaXIocHVsbC50b1BhdGgpO1xyXG4gICAgICBjb25zdCBtb3ZlZCA9IGFwcGx5Q29tbWl0KHJlbW92ZUVudHJ5KGluZGV4LCBwdWxsLmZyb21QYXRoKSwge1xyXG4gICAgICAgIHBhdGg6IHB1bGwudG9QYXRoLFxyXG4gICAgICAgIHZlcnNpb25JZDogcHVsbC52ZXJzaW9uLFxyXG4gICAgICAgIGhhc2g6IHB1bGwuaGFzaCxcclxuICAgICAgICBzaXplOiBwdWxsLnNpemUsXHJcbiAgICAgICAgY2xvY2s6IHB1bGwuY2xvY2ssXHJcbiAgICAgICAgaXNGb2xkZXI6IHRydWUsXHJcbiAgICAgIH0pO1xyXG4gICAgICBhd2FpdCByZW1vdmVEaXJJZlZhY2FudChzdG9yYWdlLCBtb3ZlZCwgcHVsbC5mcm9tUGF0aCk7XHJcbiAgICAgIHJldHVybiBtb3ZlZDtcclxuICAgIH1cclxuICAgIGlmIChhd2FpdCBzdG9yYWdlLmV4aXN0cyhwdWxsLmZyb21QYXRoKSkge1xyXG4gICAgICBhd2FpdCBzdG9yYWdlLnJlbmFtZUZpbGUocHVsbC5mcm9tUGF0aCwgcHVsbC50b1BhdGgpO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgLy8gT2xkIHBhdGggbmV2ZXIgbWF0ZXJpYWxpemVkIGhlcmUgKG9yIGFscmVhZHkgbW92ZWQpOiBmZXRjaCBjb250ZW50LlxyXG4gICAgICAvLyBBIEZJTEUgcmVuYW1lIG9ubHkgXHUyMDE0IGZvbGRlciByZW5hbWVzIG5ldmVyIHJlYWNoIHRoaXMgYnJhbmNoLlxyXG4gICAgICBhd2FpdCBmZXRjaFZlcmlmaWVkKHN0b3JhZ2UsIHB1bGwudG9QYXRoLCBwdWxsLmhhc2gsIGZldGNoQmxvYik7XHJcbiAgICB9XHJcbiAgICBjb25zdCBtb3ZlZCA9IGFwcGx5Q29tbWl0KHJlbW92ZUVudHJ5KGluZGV4LCBwdWxsLmZyb21QYXRoKSwge1xyXG4gICAgICBwYXRoOiBwdWxsLnRvUGF0aCxcclxuICAgICAgdmVyc2lvbklkOiBwdWxsLnZlcnNpb24sXHJcbiAgICAgIGhhc2g6IHB1bGwuaGFzaCxcclxuICAgICAgc2l6ZTogcHVsbC5zaXplLFxyXG4gICAgICBjbG9jazogcHVsbC5jbG9jayxcclxuICAgIH0pO1xyXG4gICAgLy8gVGhlIGxhc3QgZmlsZSBtYXkganVzdCBoYXZlIGxlZnQgaXRzIG9sZCBwYXJlbnQgZGlyZWN0b3J5IChwcnVuZS1vbi1cclxuICAgIC8vIGRlbGV0ZSBhcHBsaWVzIHRvIG1vdmVzIHRvbzsgdGhlIHJlbmFtZSBpdHNlbGYgaXMgdW50b3VjaGVkKS5cclxuICAgIGF3YWl0IHBydW5lUGFyZW50T25EZWxldGUoc3RvcmFnZSwgbW92ZWQsIHB1bGwuZnJvbVBhdGgpO1xyXG4gICAgcmV0dXJuIG1vdmVkO1xyXG4gIH1cclxuXHJcbiAgaWYgKHB1bGwuaXNGb2xkZXIpIHtcclxuICAgIC8vIEZvbGRlciBwbGFjZWhvbGRlcnMgKEZSLTEwKTogY3JlYXRlIHRoZSBkaXJlY3RvcnksIHJlY29yZCB0aGUgZW50cnkuXHJcbiAgICAvLyBBIGZvbGRlciBUT01CU1RPTkUgYWRkaXRpb25hbGx5IHJlbW92ZXMgdGhlIGxvY2FsIGRpcmVjdG9yeSB3aGVuIGl0XHJcbiAgICAvLyBleGlzdHMgYW5kIGlzIGVtcHR5OyBub24tZW1wdHkgb3IgbWlzc2luZyBcdTIxRDIgcmVjb3JkIG9ubHkgKGNvbnZlcmdlc1xyXG4gICAgLy8gbGF0ZXIgXHUyMDE0IGEgbm9uLWVtcHR5IGRpcmVjdG9yeSBpcyBuZXZlciBkZWxldGVkIGhlcmUpLlxyXG4gICAgaWYgKHB1bGwuZGVsZXRlZCkge1xyXG4gICAgICBhd2FpdCByZW1vdmVEaXJJZlZhY2FudChzdG9yYWdlLCBpbmRleCwgcHVsbC5wYXRoKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIGF3YWl0IHN0b3JhZ2UuZW5zdXJlRGlyKHB1bGwucGF0aCk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gYXBwbHlDb21taXQoaW5kZXgsIHtcclxuICAgICAgcGF0aDogcHVsbC5wYXRoLFxyXG4gICAgICB2ZXJzaW9uSWQ6IHB1bGwudmVyc2lvbixcclxuICAgICAgaGFzaDogcHVsbC5oYXNoLFxyXG4gICAgICBzaXplOiBwdWxsLnNpemUsXHJcbiAgICAgIGNsb2NrOiBwdWxsLmNsb2NrLFxyXG4gICAgICBkZWxldGVkOiBwdWxsLmRlbGV0ZWQsXHJcbiAgICAgIGRlbGV0ZWRBdDogcHVsbC5kZWxldGVkID8gbm93IDogdW5kZWZpbmVkLFxyXG4gICAgICBpc0ZvbGRlcjogdHJ1ZSxcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgaWYgKHB1bGwuZGVsZXRlZCkge1xyXG4gICAgLy8gSWRlbXBvdGVudCBwZXIgdGhlIGFkYXB0ZXIgY29udHJhY3Q7IGEgbG9jYWwgLnRyYXNoIGNvcHkgaXMgYVxyXG4gICAgLy8gcGxhdGZvcm0tbGF5ZXIgY29uY2VybiAoZGFlbW9uL3BsdWdpbiksIG5vdCBlbmdpbmUgbG9naWMuXHJcbiAgICBhd2FpdCBzdG9yYWdlLmRlbGV0ZUZpbGUocHVsbC5wYXRoKTtcclxuICAgIGNvbnN0IHRvbWJzdG9uZWQgPSBhcHBseUNvbW1pdChpbmRleCwge1xyXG4gICAgICBwYXRoOiBwdWxsLnBhdGgsXHJcbiAgICAgIHZlcnNpb25JZDogcHVsbC52ZXJzaW9uLFxyXG4gICAgICBoYXNoOiBwdWxsLmhhc2gsXHJcbiAgICAgIHNpemU6IHB1bGwuc2l6ZSxcclxuICAgICAgY2xvY2s6IHB1bGwuY2xvY2ssXHJcbiAgICAgIGRlbGV0ZWQ6IHRydWUsXHJcbiAgICAgIGRlbGV0ZWRBdDogbm93LFxyXG4gICAgfSk7XHJcbiAgICAvLyBQcnVuZS1vbi1kZWxldGU6IGFuIGVtcHRpZWQgcGFyZW50IGRpcmVjdG9yeSBtdXN0IG5vdCBsaW5nZXIgYW5kXHJcbiAgICAvLyByZS1zdXJmYWNlIGFzIGFuIGVtcHR5LWZvbGRlciBwbGFjZWhvbGRlciBvbiB0aGUgbmV4dCBzY2FuLlxyXG4gICAgYXdhaXQgcHJ1bmVQYXJlbnRPbkRlbGV0ZShzdG9yYWdlLCB0b21ic3RvbmVkLCBwdWxsLnBhdGgpO1xyXG4gICAgcmV0dXJuIHRvbWJzdG9uZWQ7XHJcbiAgfVxyXG5cclxuICBjb25zdCBjdXJyZW50ID0gaW5kZXhbcHVsbC5wYXRoXTtcclxuICBpZiAoXHJcbiAgICBjdXJyZW50ICE9PSB1bmRlZmluZWQgJiZcclxuICAgIGN1cnJlbnQuZGVsZXRlZEF0ID09PSB1bmRlZmluZWQgJiZcclxuICAgIGN1cnJlbnQuaGFzaCA9PT0gcHVsbC5oYXNoICYmXHJcbiAgICAoYXdhaXQgc3RvcmFnZS5leGlzdHMocHVsbC5wYXRoKSlcclxuICApIHtcclxuICAgIC8vIENvbnRlbnQgYWxyZWFkeSBjb3JyZWN0IGxvY2FsbHkgKGUuZy4gdmVyc2lvbi1pZCBjYXRjaC11cCBhZnRlciBhXHJcbiAgICAvLyByZW5hbWUgZWxzZXdoZXJlKTogcmVjb3JkIHRoZSBhdXRob3JpdGF0aXZlIGhlYWQsIHNraXAgZmV0Y2grd3JpdGUuXHJcbiAgICAvLyBUaGUgZXhpc3RlbmNlIGNoZWNrIG1hdHRlcnMgd2hlbiB0aGUgZmlsZSB3YXMgZGVsZXRlZCBsb2NhbGx5IHNpbmNlIHRoZVxyXG4gICAgLy8gaW5kZXggd2FzIGxhc3Qgd3JpdHRlbiBcdTIwMTQgcmVjcmVhdGluZyBpdCBpcyB3aGF0IHRoZSBwdWxsIGRlbWFuZHMuXHJcbiAgICByZXR1cm4gYXBwbHlDb21taXQoaW5kZXgsIHtcclxuICAgICAgcGF0aDogcHVsbC5wYXRoLFxyXG4gICAgICB2ZXJzaW9uSWQ6IHB1bGwudmVyc2lvbixcclxuICAgICAgaGFzaDogcHVsbC5oYXNoLFxyXG4gICAgICBzaXplOiBwdWxsLnNpemUsXHJcbiAgICAgIGNsb2NrOiBwdWxsLmNsb2NrLFxyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBhd2FpdCBmZXRjaFZlcmlmaWVkKHN0b3JhZ2UsIHB1bGwucGF0aCwgcHVsbC5oYXNoLCBmZXRjaEJsb2IpO1xyXG4gIHJldHVybiBhcHBseUNvbW1pdChpbmRleCwge1xyXG4gICAgcGF0aDogcHVsbC5wYXRoLFxyXG4gICAgdmVyc2lvbklkOiBwdWxsLnZlcnNpb24sXHJcbiAgICBoYXNoOiBwdWxsLmhhc2gsXHJcbiAgICBzaXplOiBwdWxsLnNpemUsXHJcbiAgICBjbG9jazogcHVsbC5jbG9jayxcclxuICB9KTtcclxufVxyXG5cclxuLy8gLS0tIGZvbGRlciBsaWZlY3ljbGUgaGVscGVycyAoQjogdG9tYnN0b25lLWFwcGx5LCBDOiBwcnVuZS1vbi1kZWxldGUpIC0tLS0tLS0tXHJcblxyXG4vKiogT3V0Y29tZSBvZiBhIHBydW5lIGF0dGVtcHQ6IHRoZSBkaXJlY3RvcnkganVkZ2VkIGRlbGV0YWJsZSwgYW5kIHdoZXRoZXIgaXQgd2FzLiAqL1xyXG5leHBvcnQgaW50ZXJmYWNlIFBydW5lZERpciB7XHJcbiAgLyoqIFRoZSBkaXJlY3RvcnkgdGhhdCBxdWFsaWZpZWQgZm9yIHJlbW92YWwgKHRoZSBkZWxldGVkIHBhdGgncyBwYXJlbnQpLiAqL1xyXG4gIGRpcjogc3RyaW5nO1xyXG4gIC8qKiBXaGV0aGVyIGBzdG9yYWdlLnJlbW92ZURpcmAgYWN0dWFsbHkgcmVtb3ZlZCBpdCAoZmFsc2Ugd2hlbiB0aGUgYWRhcHRlclxyXG4gICAqICBsYWNrcyB0aGUgaG9vayBvciByZWZ1c2VkIFx1MjAxNCBlbGlnaWJpbGl0eSBhbG9uZSBzdGlsbCBzdXBwcmVzc2VzIGFcclxuICAgKiAgcGxhY2Vob2xkZXIgcHVzaCBmb3IgaXQsIGBjbGllbnQudHNgKS4gKi9cclxuICByZW1vdmVkOiBib29sZWFuO1xyXG59XHJcblxyXG4vKipcclxuICogV2hldGhlciBgZGlyYCBtYXkgYmUgZGVsZXRlZCB3aXRob3V0IGxvc2luZyBhbnl0aGluZzogaXQgZXhpc3RzLCBub3RoaW5nXHJcbiAqIChmaWxlIG9yIGRpcmVjdG9yeSkgbGl2ZXMgYmVuZWF0aCBpdCBpbiBzdG9yYWdlLCBhbmQgdGhlIGluZGV4IGhvbGRzIG5vXHJcbiAqIGxpdmUgZmlsZSBlbnRyeSBiZW5lYXRoIGl0LiBUaGUgcm9vdCBpcyBuZXZlciBkZWxldGFibGUuIFRoaXMgaXMgdGhlXHJcbiAqIG5ldmVyLWRlbGV0ZS1ub24tZW1wdHkgLyBuZXZlci1sb3NlLWNvbnRlbnQgaW52YXJpYW50IG1hZGUgZXhwbGljaXQgXHUyMDE0XHJcbiAqIGV2ZXJ5IGRpcmVjdG9yeSByZW1vdmFsIGluIGNvcmUgZ29lcyB0aHJvdWdoIGl0LlxyXG4gKi9cclxuYXN5bmMgZnVuY3Rpb24gZGlySXNWYWNhbnQoXHJcbiAgc3RvcmFnZTogU3RvcmFnZUFkYXB0ZXIsXHJcbiAgaW5kZXg6IExvY2FsSW5kZXgsXHJcbiAgZGlyOiBzdHJpbmcsXHJcbik6IFByb21pc2U8Ym9vbGVhbj4ge1xyXG4gIGlmIChkaXIgPT09ICcvJykgcmV0dXJuIGZhbHNlO1xyXG4gIGlmICghKGF3YWl0IHN0b3JhZ2UuZXhpc3RzKGRpcikpKSByZXR1cm4gZmFsc2U7XHJcbiAgZm9yIChjb25zdCBmaWxlIG9mIGF3YWl0IHN0b3JhZ2UubGlzdEZpbGVzKCkpIHtcclxuICAgIGlmIChpc1N0cmljdGx5QmVuZWF0aChmaWxlLnBhdGgsIGRpcikpIHJldHVybiBmYWxzZTtcclxuICB9XHJcbiAgZm9yIChjb25zdCBjaGlsZCBvZiBhd2FpdCBzdG9yYWdlLmxpc3REaXJzKCkpIHtcclxuICAgIGlmIChpc1N0cmljdGx5QmVuZWF0aChjaGlsZCwgZGlyKSkgcmV0dXJuIGZhbHNlO1xyXG4gIH1cclxuICBmb3IgKGNvbnN0IFtwYXRoLCBlbnRyeV0gb2YgT2JqZWN0LmVudHJpZXMoaW5kZXgpKSB7XHJcbiAgICBpZiAoZW50cnkuaXNGb2xkZXIgfHwgZW50cnkuZGVsZXRlZEF0ICE9PSB1bmRlZmluZWQpIGNvbnRpbnVlO1xyXG4gICAgaWYgKGlzU3RyaWN0bHlCZW5lYXRoKHBhdGgsIGRpcikpIHJldHVybiBmYWxzZTtcclxuICB9XHJcbiAgcmV0dXJuIHRydWU7XHJcbn1cclxuXHJcbi8qKiBSZW1vdmUgYGRpcmAgdGhyb3VnaCB0aGUgYWRhcHRlciB3aGVuIGl0IGlzIHZhY2FudC4gTWlzc2luZy9ub24tZW1wdHkvdW5zdXBwb3J0ZWQgXHUyMUQyIGZhbHNlLiAqL1xyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVtb3ZlRGlySWZWYWNhbnQoXHJcbiAgc3RvcmFnZTogU3RvcmFnZUFkYXB0ZXIsXHJcbiAgaW5kZXg6IExvY2FsSW5kZXgsXHJcbiAgZGlyOiBzdHJpbmcsXHJcbik6IFByb21pc2U8Ym9vbGVhbj4ge1xyXG4gIGlmICghKGF3YWl0IGRpcklzVmFjYW50KHN0b3JhZ2UsIGluZGV4LCBkaXIpKSkgcmV0dXJuIGZhbHNlO1xyXG4gIHJldHVybiByZW1vdmVWYWNhbnREaXIoc3RvcmFnZSwgZGlyKTtcclxufVxyXG5cclxuYXN5bmMgZnVuY3Rpb24gcmVtb3ZlVmFjYW50RGlyKHN0b3JhZ2U6IFN0b3JhZ2VBZGFwdGVyLCBkaXI6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xyXG4gIGlmIChzdG9yYWdlLnJlbW92ZURpciA9PT0gdW5kZWZpbmVkKSByZXR1cm4gZmFsc2U7IC8vIHByZS1ob29rIGFkYXB0ZXJzOiByZWNvcmQtb25seVxyXG4gIHRyeSB7XHJcbiAgICBhd2FpdCBzdG9yYWdlLnJlbW92ZURpcihkaXIpO1xyXG4gICAgcmV0dXJuIHRydWU7XHJcbiAgfSBjYXRjaCB7XHJcbiAgICAvLyBBIHJlZnVzZWQgb3IgcmFjZWQgcmVtb3ZhbCBpcyByZWNvcmQtb25seSwgbmV2ZXIgZmF0YWwgYW5kIG5ldmVyIGRhdGFcclxuICAgIC8vIGxvc3MgXHUyMDE0IHRoZSB0b21ic3RvbmUgaXMgc3RpbGwgcmVjb3JkZWQgYW5kIHN0YXRlIGNvbnZlcmdlcyBsYXRlci5cclxuICAgIHJldHVybiBmYWxzZTtcclxuICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBQcnVuZS1vbi1kZWxldGUgKEMpOiBhZnRlciBgZGVsZXRlZFBhdGhgIHdhcyBkZWxldGVkIChvciByZW5hbWVkIGF3YXkpLFxyXG4gKiByZW1vdmUgaXRzIGltbWVkaWF0ZSBwYXJlbnQgZGlyZWN0b3J5IHdoZW4gaXQgaXMgbm93IGVtcHR5IG9uIGRpc2sgYW5kXHJcbiAqIHVucmVwcmVzZW50ZWQgYnkgbGl2ZSBpbmRleCBlbnRyaWVzIFx1MjAxNCBleGFjdGx5IE9ORSBsZXZlbCwgbm8gY2FzY2FkZS5cclxuICpcclxuICogUmV0dXJucyB0aGUgYFBydW5lZERpcmAgd2hlbiB0aGUgcGFyZW50IFFVQUxJRklFRCBmb3IgcmVtb3ZhbCAod2hldGhlciBvclxyXG4gKiBub3QgdGhlIGFkYXB0ZXIgY291bGQgcGVyZm9ybSBpdCBcdTIwMTQgY2FsbGVycyB1c2UgZWxpZ2liaWxpdHkgdG8gc3VwcHJlc3MgYW5cclxuICogZW1wdHktZm9sZGVyIHBsYWNlaG9sZGVyIHB1c2ggZm9yIHRoYXQgZGlyZWN0b3J5KSwgYHVuZGVmaW5lZGAgd2hlbiB0aGVcclxuICogcGFyZW50IHdhcyBub3QgZGVsZXRhYmxlIChub24tZW1wdHksIGhvbGRzIGxpdmUgZW50cmllcywgbWlzc2luZywgb3Igcm9vdCkuXHJcbiAqIFB1cmUgd2l0aCByZXNwZWN0IHRvIHRoZSBpbmRleDogbmV2ZXIgbXV0YXRlcyBpdC5cclxuICovXHJcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBwcnVuZVBhcmVudE9uRGVsZXRlKFxyXG4gIHN0b3JhZ2U6IFN0b3JhZ2VBZGFwdGVyLFxyXG4gIGluZGV4OiBMb2NhbEluZGV4LFxyXG4gIGRlbGV0ZWRQYXRoOiBzdHJpbmcsXHJcbik6IFByb21pc2U8UHJ1bmVkRGlyIHwgdW5kZWZpbmVkPiB7XHJcbiAgY29uc3QgZGlyID0gcGFyZW50UGF0aChkZWxldGVkUGF0aCk7XHJcbiAgaWYgKCEoYXdhaXQgZGlySXNWYWNhbnQoc3RvcmFnZSwgaW5kZXgsIGRpcikpKSByZXR1cm4gdW5kZWZpbmVkO1xyXG4gIHJldHVybiB7IGRpciwgcmVtb3ZlZDogYXdhaXQgcmVtb3ZlVmFjYW50RGlyKHN0b3JhZ2UsIGRpcikgfTtcclxufVxyXG5cclxuLyoqIERvd25sb2FkLCB2ZXJpZnksIGFuZCB3cml0ZSBvbmUgYmxvYi4gQSBoYXNoIG1pc21hdGNoIGFib3J0cyB0aGUgcGxhbi4gKi9cclxuYXN5bmMgZnVuY3Rpb24gZmV0Y2hWZXJpZmllZChcclxuICBzdG9yYWdlOiBTdG9yYWdlQWRhcHRlcixcclxuICBwYXRoOiBzdHJpbmcsXHJcbiAgaGFzaDogc3RyaW5nLFxyXG4gIGZldGNoQmxvYjogRmV0Y2hCbG9iLFxyXG4pOiBQcm9taXNlPHZvaWQ+IHtcclxuICBjb25zdCBieXRlcyA9IGF3YWl0IGZldGNoQmxvYihoYXNoKTtcclxuICBjb25zdCBhY3R1YWwgPSBhd2FpdCBzaGEyNTZIZXgoYnl0ZXMpO1xyXG4gIGlmIChhY3R1YWwgIT09IGhhc2gpIHtcclxuICAgIHRocm93IG5ldyBFcnJvcihcclxuICAgICAgYEJsb2IgaGFzaCBtaXNtYXRjaCBmb3IgJHtKU09OLnN0cmluZ2lmeShwYXRoKX06IGV4cGVjdGVkICR7aGFzaH0sIGdvdCAke2FjdHVhbH1gLFxyXG4gICAgKTtcclxuICB9XHJcbiAgYXdhaXQgc3RvcmFnZS53cml0ZUZpbGUocGF0aCwgYnl0ZXMpO1xyXG59XHJcblxyXG5hc3luYyBmdW5jdGlvbiBwZXJzaXN0SW5kZXgoXHJcbiAgc3RvcmFnZTogU3RvcmFnZUFkYXB0ZXIsXHJcbiAgaW5kZXg6IExvY2FsSW5kZXgsXHJcbiAgc3RhdGU6IFBlcnNpc3RlZFN5bmNTdGF0ZSA9IHt9LFxyXG4pOiBQcm9taXNlPHZvaWQ+IHtcclxuICBhd2FpdCBzdG9yYWdlLndyaXRlRmlsZShcclxuICAgIExPQ0FMX0lOREVYX1NUQVRFX1BBVEgsXHJcbiAgICBuZXcgVGV4dEVuY29kZXIoKS5lbmNvZGUoc2VyaWFsaXplTG9jYWxJbmRleChpbmRleCwgc3RhdGUpKSxcclxuICApO1xyXG59XHJcblxyXG4vKipcclxuICogTG9hZCB0aGUgcGVyc2lzdGVkIGluZGV4IEFORCBpdHMgc3luYy1jdXJzb3IgYm9va2tlZXBpbmcgKHRoZSBjbGllbnQnc1xyXG4gKiBzdGFydHVwIHBhdGggXHUyMDE0IHRoZSBjdXJzb3IgcG93ZXJzIGRlbHRhLW1hbmlmZXN0IHJlY29ubmVjdHMpLiBUaHJvd3NcclxuICogYFByb3RvY29sRXJyb3JgICh2aWEgYGRlc2VyaWFsaXplTG9jYWxTdGF0ZWApIG9uIGNvcnJ1cHQgb3IgZnV0dXJlLXNjaGVtYVxyXG4gKiBzdGF0ZTsgdGhlIGNsaWVudCByZWNvdmVycyBieSBxdWFyYW50aW5pbmcgdGhlIGZpbGUgYW5kIHJlc3luY2luZyBmcm9tIGFcclxuICogZnVsbCBtYW5pZmVzdCAoYGNsaWVudC50c2Agc3RhcnR1cCkuXHJcbiAqL1xyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbG9hZExvY2FsU3RhdGUoc3RvcmFnZTogU3RvcmFnZUFkYXB0ZXIpOiBQcm9taXNlPERlc2VyaWFsaXplZExvY2FsU3RhdGU+IHtcclxuICBjb25zdCBieXRlcyA9IGF3YWl0IHN0b3JhZ2UucmVhZEZpbGUoTE9DQUxfSU5ERVhfU1RBVEVfUEFUSCk7XHJcbiAgcmV0dXJuIGRlc2VyaWFsaXplTG9jYWxTdGF0ZShuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUoYnl0ZXMpKTtcclxufVxyXG5cclxuLyoqXHJcbiAqIExvYWQgdGhlIHBlcnNpc3RlZCBpbmRleCAoQVJDSElURUNUVVJFIFx1MDBBNzggc3RlcCAxKS4gVGhyb3dzXHJcbiAqIGBQcm90b2NvbEVycm9yYCAodmlhIGBkZXNlcmlhbGl6ZUxvY2FsSW5kZXhgKSBvbiBjb3JydXB0IG9yIGZ1dHVyZS1zY2hlbWFcclxuICogc3RhdGUgXHUyMDE0IGNhbGxlcnMgc3VyZmFjZSB0aGF0IGluc3RlYWQgb2Ygc2lsZW50bHkgcmUtc3luY2luZyBmcm9tIHNjcmF0Y2guXHJcbiAqL1xyXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbG9hZExvY2FsSW5kZXgoc3RvcmFnZTogU3RvcmFnZUFkYXB0ZXIpOiBQcm9taXNlPExvY2FsSW5kZXg+IHtcclxuICByZXR1cm4gKGF3YWl0IGxvYWRMb2NhbFN0YXRlKHN0b3JhZ2UpKS5pbmRleDtcclxufVxyXG4iLCAiLyoqXG4gKiBWYXVsdCBpZ25vcmUgcnVsZXMgKEFSQ0hJVEVDVFVSRS5tZCBcdTAwQTc0LCBGUi0xMS9GUi00MikgXHUyMDE0IHNoYXJlZCBieSBldmVyeVxuICogY2xpZW50IHNvIGxvY2FsIHNjYW5zLCB3YXRjaGVycywgYW5kIGNvbW1pdCBwYXRocyBhZ3JlZSBieXRlLWZvci1ieXRlLlxuICpcbiAqIE1hdGNoaW5nIGlzIHNlZ21lbnQtYmFzZWQgYW5kIGNhc2UtaW5zZW5zaXRpdmUgKHRoZSBvd25lcidzIHByaW1hcnlcbiAqIHBsYXRmb3JtcyBcdTIwMTQgV2luZG93cywgbWFjT1MgXHUyMDE0IGhhdmUgY2FzZS1pbnNlbnNpdGl2ZSBmaWxlc3lzdGVtcywgc29cbiAqIGAuVHJhc2gvZm9vLm1kYCBtdXN0IG5vdCBzbmVhayBwYXN0IHRoZSBgLnRyYXNoL2AgcnVsZSkuXG4gKi9cblxuaW1wb3J0IHsgaXNXaW5kb3dzVW5zYWZlUGF0aCwgbm9ybWFsaXplVmF1bHRQYXRoIH0gZnJvbSAnLi9wYXRocy5qcyc7XG5cbi8qKiBTZXR0aW5ncyBzdWJzZXQgYGlzSWdub3JlZGAgbmVlZHM7IGBWYXVsdFNldHRpbmdzYCBzYXRpc2ZpZXMgaXQuICovXG5leHBvcnQgaW50ZXJmYWNlIElnbm9yZVNldHRpbmdzIHtcbiAgb2JzaWRpYW5TeW5jOiBib29sZWFuO1xuICAvKipcbiAgICogVXNlci1kZWZpbmVkIGV4dHJhIGlnbm9yZSBwYXR0ZXJucyAoY2xpZW50LXNpZGUgb25seSkuIEdsb2ItbGl0ZSBzeW50YXg6XG4gICAqIGAqYCBtYXRjaGVzIHdpdGhpbiBvbmUgcGF0aCBzZWdtZW50LCBhIHdob2xlIGAqKmAgc2VnbWVudCBzcGFucyBhbnlcbiAgICogbnVtYmVyIG9mIHNlZ21lbnRzLCBtYXRjaGluZyBpcyBjYXNlLWluc2Vuc2l0aXZlLiBBIHBhdHRlcm4gY29udGFpbmluZ1xuICAgKiBgL2AgaXMgYW5jaG9yZWQgYXQgdGhlIHZhdWx0IHJvb3QgKGBwcml2YXRlLyoqYCk7IGEgYmFyZSBwYXR0ZXJuIHdpdGhvdXRcbiAgICogYC9gIG1hdGNoZXMgYSBmaWxlIE5BTUUgYXQgYW55IGRlcHRoIChgKi50bXBgKS4gRW1wdHkgbGluZXMgYXJlIGlnbm9yZWQuXG4gICAqL1xuICBleHRyYUlnbm9yZXM/OiByZWFkb25seSBzdHJpbmdbXTtcbn1cblxuLyoqIElnbm9yZWQgd2hlcmV2ZXIgdGhleSBhcHBlYXIsIGFzIGFueSBwYXRoIHNlZ21lbnQgKGRpciBvciBmaWxlIG5hbWUpLiAqL1xuY29uc3QgQUxXQVlTX0lHTk9SRURfU0VHTUVOVFM6IFJlYWRvbmx5U2V0PHN0cmluZz4gPSBuZXcgU2V0KFtcbiAgJy50cmFzaCcsIC8vIGxvY2FsIGRlbGV0ZS1yZWNvdmVyeSBkaXIgKEZSLTQyKVxuICAnLmRzX3N0b3JlJyxcbiAgJy52YXVsdHN5bmNmb3JhZ2VudHMnLCAvLyBjbGllbnQgc3RhdGUgZGlyIChsb2NhbCBpbmRleCkgaW5zaWRlIHRoZSB2YXVsdFxuICAndGh1bWJzLmRiJyxcbl0pO1xuXG4vKiogYC5vYnNpZGlhbi9gIGZpbGVzIGV4Y2x1ZGVkIGV2ZW4gd2hlbiBgLm9ic2lkaWFuL2Agc3luYyBpcyBvcHRlZCBpbi4gKi9cbmNvbnN0IE9CU0lESUFOX1ZPTEFUSUxFX0ZJTEVTOiBSZWFkb25seVNldDxzdHJpbmc+ID0gbmV3IFNldChbXG4gICcub2JzaWRpYW4vd29ya3NwYWNlLmpzb24nLFxuICAnLm9ic2lkaWFuL3dvcmtzcGFjZS1tb2JpbGUuanNvbicsXG5dKTtcblxuLyoqXG4gKiBXaGV0aGVyIGB2YXVsdFBhdGhgIG11c3QgYmUgZXhjbHVkZWQgZnJvbSBzeW5jLlxuICpcbiAqIEFsd2F5cyBpZ25vcmVkOiBgLnRyYXNoL2AsIGAuRFNfU3RvcmVgLCBgVGh1bWJzLmRiYCwgYC52YXVsdHN5bmNmb3JhZ2VudHMvYFxuICogKGFueSBkZXB0aCksIGFuZCBXaW5kb3dzLXVuc2FmZSBuYW1lcyAocmVzZXJ2ZWQgZGV2aWNlIG5hbWVzLCB0cmFpbGluZ1xuICogZG90L3NwYWNlIFx1MjAxNCB0aGV5IGNhbiBuZXZlciBiZSBtYXRlcmlhbGl6ZWQgb24gYSBXaW5kb3dzIHBlZXIsIHNlZVxuICogYHBhdGhzLnRzYCkuIGAub2JzaWRpYW4vYCBpcyBpZ25vcmVkIGVudGlyZWx5IHdoZW4gYHNldHRpbmdzLm9ic2lkaWFuU3luY2BcbiAqIGlzIGZhbHNlOyB3aGVuIHRydWUsIGV2ZXJ5dGhpbmcgdW5kZXIgaXQgc3luY3MgZXhjZXB0IGB3b3Jrc3BhY2UuanNvbmAsXG4gKiBgd29ya3NwYWNlLW1vYmlsZS5qc29uYCwgYC5vYnNpZGlhbi9jYWNoZS9gLCBhbmQgZXZlcnkgcGx1Z2luJ3NcbiAqIGBkYXRhLmpzb25gIFx1MjAxNCBwbHVnaW4gY3JlZGVudGlhbHMgKHRoaXMgcGx1Z2luJ3Mgb3duIGRldmljZSB0b2tlbiBpbmNsdWRlZClcbiAqIG11c3QgbmV2ZXIgdHJhdmVsIHRocm91Z2ggc3luYywgd2hhdGV2ZXIgdGhlIG9wdC1pbi4gRmluYWxseSwgZXZlcnkgcGF0dGVyblxuICogaW4gYHNldHRpbmdzLmV4dHJhSWdub3Jlc2AgaXMgbWF0Y2hlZCAoZ2xvYi1saXRlIFx1MjAxNCBzZWUgYElnbm9yZVNldHRpbmdzYCkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0lnbm9yZWQodmF1bHRQYXRoOiBzdHJpbmcsIHNldHRpbmdzOiBJZ25vcmVTZXR0aW5ncyk6IGJvb2xlYW4ge1xuICBpZiAoaXNXaW5kb3dzVW5zYWZlUGF0aCh2YXVsdFBhdGgpKSByZXR1cm4gdHJ1ZTtcbiAgY29uc3Qgbm9ybWFsaXplZCA9IG5vcm1hbGl6ZVZhdWx0UGF0aCh2YXVsdFBhdGgpO1xuICBpZiAobm9ybWFsaXplZCA9PT0gJy8nKSByZXR1cm4gZmFsc2U7XG5cbiAgY29uc3QgbG93ZXIgPSBub3JtYWxpemVkLnNsaWNlKDEpLnRvTG93ZXJDYXNlKCk7XG4gIGNvbnN0IHNlZ21lbnRzID0gbG93ZXIuc3BsaXQoJy8nKTtcblxuICBpZiAoc2VnbWVudHMuc29tZSgoc2VnbWVudCkgPT4gQUxXQVlTX0lHTk9SRURfU0VHTUVOVFMuaGFzKHNlZ21lbnQpKSkge1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgaWYgKHNlZ21lbnRzWzBdID09PSAnLm9ic2lkaWFuJykge1xuICAgIGlmICghc2V0dGluZ3Mub2JzaWRpYW5TeW5jKSByZXR1cm4gdHJ1ZTtcbiAgICBpZiAoT0JTSURJQU5fVk9MQVRJTEVfRklMRVMuaGFzKGxvd2VyKSkgcmV0dXJuIHRydWU7XG4gICAgaWYgKHNlZ21lbnRzWzFdID09PSAnY2FjaGUnKSByZXR1cm4gdHJ1ZTsgLy8gdGhlIGRpciBpdHNlbGYgYW5kIGFueXRoaW5nIHVuZGVyIGl0XG4gICAgLy8gUGx1Z2luIGNyZWRlbnRpYWwgZmlsZXMgbmV2ZXIgc3luYywgZXZlbiB3aXRoIGAub2JzaWRpYW4vYCBvcHRlZCBpbjpcbiAgICAvLyBPYnNpZGlhbiBrZWVwcyBldmVyeSBwbHVnaW4ncyBzZXR0aW5ncy9zZWNyZXRzIGluIGA8cGx1Z2luPi9kYXRhLmpzb25gXG4gICAgLy8gKHRoaXMgcGx1Z2luJ3Mgb3duIGRldmljZSB0b2tlbiBpbmNsdWRlZCkgXHUyMDE0IGFuZCBhIHNlY29uZCBkZXZpY2UncyBjb3B5XG4gICAgLy8gd291bGQgY2xvYmJlciB0aGlzIG9uZSdzIHBhaXJpbmcgaWRlbnRpdHkgb24gYXJyaXZhbC5cbiAgICBpZiAoXG4gICAgICBzZWdtZW50c1sxXSA9PT0gJ3BsdWdpbnMnICYmXG4gICAgICBzZWdtZW50cy5sZW5ndGggPj0gNCAmJlxuICAgICAgc2VnbWVudHNbc2VnbWVudHMubGVuZ3RoIC0gMV0gPT09ICdkYXRhLmpzb24nXG4gICAgKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gIH1cblxuICBjb25zdCBleHRyYXMgPSBzZXR0aW5ncy5leHRyYUlnbm9yZXM7XG4gIGlmIChleHRyYXMgIT09IHVuZGVmaW5lZCAmJiBleHRyYXMubGVuZ3RoID4gMCkge1xuICAgIGZvciAoY29uc3QgcGF0dGVybiBvZiBleHRyYXMpIHtcbiAgICAgIGNvbnN0IGNvbXBpbGVkID0gY29tcGlsZUV4dHJhSWdub3JlKHBhdHRlcm4pO1xuICAgICAgaWYgKGNvbXBpbGVkICE9PSBudWxsICYmIG1hdGNoZXNTZWdtZW50cyhjb21waWxlZCwgc2VnbWVudHMpKSByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8vIC0tLSBleHRyYSBpZ25vcmUgcGF0dGVybnMgKGdsb2ItbGl0ZSkgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBBIGNvbXBpbGVkIGV4dHJhLWlnbm9yZSBwYXR0ZXJuOiBsb3dlcmNhc2VkLCBgL2Atc3BsaXQgc2VnbWVudHMuICovXG50eXBlIENvbXBpbGVkUGF0dGVybiA9IHsgc2VnbWVudHM6IHJlYWRvbmx5IHN0cmluZ1tdOyBhbmNob3JlZDogYm9vbGVhbiB9O1xuXG4vKipcbiAqIE5vcm1hbGl6ZSBvbmUgdXNlciBwYXR0ZXJuIGludG8gbWF0Y2hhYmxlIHNlZ21lbnRzLiBSZXR1cm5zIGBudWxsYCBmb3JcbiAqIGJsYW5rIHBhdHRlcm5zICh0aGV5IGNhbiBuZXZlciBtYXRjaCBcdTIwMTQgYW5kIG11c3Qgbm90IGJlY29tZSBcImlnbm9yZVxuICogZXZlcnl0aGluZ1wiIGJ5IGFjY2lkZW50KS4gQSBsZWFkaW5nL3RyYWlsaW5nIGAvYCBpcyB0b2xlcmF0ZWQgYW5kIHN0cmlwcGVkO1xuICogYGFuY2hvcmVkYCByZWNvcmRzIHdoZXRoZXIgdGhlIHBhdHRlcm4gbmFtZXMgYSBwYXRoIChtYXRjaGVkIGZyb20gdGhlXG4gKiB2YXVsdCByb290KSBvciBhIGJhcmUgbmFtZSAobWF0Y2hlZCBhZ2FpbnN0IGFueSBzdWZmaXggb2YgdGhlIHBhdGgpLlxuICovXG5mdW5jdGlvbiBjb21waWxlRXh0cmFJZ25vcmUocGF0dGVybjogc3RyaW5nKTogQ29tcGlsZWRQYXR0ZXJuIHwgbnVsbCB7XG4gIGxldCBjbGVhbmVkID0gcGF0dGVybi50cmltKCkudG9Mb3dlckNhc2UoKTtcbiAgd2hpbGUgKGNsZWFuZWQuc3RhcnRzV2l0aCgnLycpKSBjbGVhbmVkID0gY2xlYW5lZC5zbGljZSgxKTtcbiAgd2hpbGUgKGNsZWFuZWQuZW5kc1dpdGgoJy8nKSkgY2xlYW5lZCA9IGNsZWFuZWQuc2xpY2UoMCwgLTEpO1xuICBpZiAoY2xlYW5lZCA9PT0gJycpIHJldHVybiBudWxsO1xuICByZXR1cm4geyBzZWdtZW50czogY2xlYW5lZC5zcGxpdCgnLycpLCBhbmNob3JlZDogY2xlYW5lZC5pbmNsdWRlcygnLycpIH07XG59XG5cbi8qKiBQYXR0ZXJuIHZzIHBhdGggc2VnbWVudHM7IGBhbmNob3JlZGAgcGF0dGVybnMgbWF5IGFsc28gc3RhcnQgZGVlcGVyLiAqL1xuZnVuY3Rpb24gbWF0Y2hlc1NlZ21lbnRzKHBhdHRlcm46IENvbXBpbGVkUGF0dGVybiwgcGF0aDogcmVhZG9ubHkgc3RyaW5nW10pOiBib29sZWFuIHtcbiAgaWYgKHBhdHRlcm4uYW5jaG9yZWQpIHtcbiAgICByZXR1cm4gc2VnbWVudHNNYXRjaChwYXR0ZXJuLnNlZ21lbnRzLCBwYXRoKTtcbiAgfVxuICAvLyBCYXJlIG5hbWUgcGF0dGVybjogbWF0Y2ggYW55IHRyYWlsaW5nIHNlZ21lbnQgcnVuIChgKi50bXBgIGF0IGFueSBkZXB0aCkuXG4gIGZvciAobGV0IHN0YXJ0ID0gMDsgc3RhcnQgPCBwYXRoLmxlbmd0aDsgc3RhcnQrKykge1xuICAgIGlmIChzZWdtZW50c01hdGNoKHBhdHRlcm4uc2VnbWVudHMsIHBhdGguc2xpY2Uoc3RhcnQpKSkgcmV0dXJuIHRydWU7XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vKiogR2xvYi1saXRlIHNlZ21lbnQgbWF0Y2hpbmc6IGAqYCBpbnNpZGUgYSBzZWdtZW50LCBgKipgIGFzIGEgd2hvbGUgc2VnbWVudC4gKi9cbmZ1bmN0aW9uIHNlZ21lbnRzTWF0Y2gocGF0dGVybjogcmVhZG9ubHkgc3RyaW5nW10sIHBhdGg6IHJlYWRvbmx5IHN0cmluZ1tdKTogYm9vbGVhbiB7XG4gIGlmIChwYXR0ZXJuLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHBhdGgubGVuZ3RoID09PSAwO1xuICBjb25zdCBoZWFkID0gcGF0dGVyblswXTtcbiAgY29uc3QgcmVzdCA9IHBhdHRlcm4uc2xpY2UoMSk7XG4gIGlmIChoZWFkID09PSB1bmRlZmluZWQpIHJldHVybiBwYXRoLmxlbmd0aCA9PT0gMDtcbiAgaWYgKGhlYWQgPT09ICcqKicpIHtcbiAgICAvLyBgKipgIGNvbnN1bWVzIHplcm8gb3IgbW9yZSBwYXRoIHNlZ21lbnRzLlxuICAgIGZvciAobGV0IHNraXAgPSAwOyBza2lwIDw9IHBhdGgubGVuZ3RoOyBza2lwKyspIHtcbiAgICAgIGlmIChzZWdtZW50c01hdGNoKHJlc3QsIHBhdGguc2xpY2Uoc2tpcCkpKSByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIGlmIChwYXRoLmxlbmd0aCA9PT0gMCB8fCAhc2VnbWVudE1hdGNoKGhlYWQsIHBhdGhbMF0hKSkgcmV0dXJuIGZhbHNlO1xuICByZXR1cm4gc2VnbWVudHNNYXRjaChyZXN0LCBwYXRoLnNsaWNlKDEpKTtcbn1cblxuLyoqIE9uZSBzZWdtZW50OiBsaXRlcmFsIHRleHQgd2l0aCBgKmAgd2lsZGNhcmRzIChhbnkgcnVuIHdpdGhpbiB0aGUgc2VnbWVudCkuICovXG5mdW5jdGlvbiBzZWdtZW50TWF0Y2gocGF0dGVybjogc3RyaW5nLCBzZWdtZW50OiBzdHJpbmcpOiBib29sZWFuIHtcbiAgaWYgKCFwYXR0ZXJuLmluY2x1ZGVzKCcqJykpIHJldHVybiBwYXR0ZXJuID09PSBzZWdtZW50O1xuICBjb25zdCBmaXJzdCA9IHBhdHRlcm4uaW5kZXhPZignKicpO1xuICBjb25zdCBsYXN0ID0gcGF0dGVybi5sYXN0SW5kZXhPZignKicpO1xuICBpZiAoIXNlZ21lbnQuc3RhcnRzV2l0aChwYXR0ZXJuLnNsaWNlKDAsIGZpcnN0KSkpIHJldHVybiBmYWxzZTtcbiAgaWYgKCFzZWdtZW50LmVuZHNXaXRoKHBhdHRlcm4uc2xpY2UobGFzdCArIDEpKSkgcmV0dXJuIGZhbHNlO1xuICBsZXQgaW5kZXggPSBmaXJzdDtcbiAgZm9yIChjb25zdCBtaWRkbGUgb2YgcGF0dGVybi5zbGljZShmaXJzdCwgbGFzdCArIDEpLnNwbGl0KCcqJykuc2xpY2UoMSwgLTEpKSB7XG4gICAgY29uc3QgZm91bmQgPSBzZWdtZW50LmluZGV4T2YobWlkZGxlLCBpbmRleCk7XG4gICAgaWYgKGZvdW5kID09PSAtMSkgcmV0dXJuIGZhbHNlO1xuICAgIGluZGV4ID0gZm91bmQgKyBtaWRkbGUubGVuZ3RoO1xuICB9XG4gIHJldHVybiB0cnVlO1xufVxuIiwgIi8qKlxyXG4gKiBUeXBlZCBXZWJTb2NrZXQgbWVzc2FnZSBkZWZpbml0aW9ucyBmb3IgdGhlIGAvc3luY2AgY2hhbm5lbFxyXG4gKiAoQVJDSElURUNUVVJFLm1kIFx1MDBBNzUpLiBBbGwgbWVzc2FnZXMgYXJlIEpTT04gd2l0aCBhIGB0eXBlYCBkaXNjcmltaW5hbnQuXHJcbiAqXHJcbiAqIFR3byBjaGFubmVscyBleGlzdDogdGhpcyBXUyBwcm90b2NvbCAobWV0YWRhdGEgKyBjaGFuZ2UgZmVlZCkgYW5kIHBsYWluXHJcbiAqIEhUVFBTIGJsb2Igcm91dGVzIChgR0VUL1BVVCAvYmxvYi86aGFzaGApIGZvciBjb250ZW50IFx1MjAxNCByZWZlcmVuY2VkIGhlcmVcclxuICogb25seSB2aWEgY29udGVudCBoYXNoZXMuXHJcbiAqL1xyXG5cclxuaW1wb3J0IHR5cGUgeyBMb2dpY2FsQ2xvY2ssIFZlcnNpb24sIFZlcnNpb25LaW5kLCBWYXVsdFNldHRpbmdzIH0gZnJvbSAnLi90eXBlcy5qcyc7XHJcbmltcG9ydCB7IFByb3RvY29sRXJyb3IgfSBmcm9tICcuL2Vycm9ycy5qcyc7XHJcblxyXG4vKiogV2lyZSBwcm90b2NvbCB2ZXJzaW9uLiBCdW1wIG9uIGJyZWFraW5nIG1lc3NhZ2Utc2hhcGUgY2hhbmdlcy4gKi9cclxuZXhwb3J0IGNvbnN0IFByb3RvY29sVmVyc2lvbiA9IDEgYXMgY29uc3Q7XHJcblxyXG4vKiogQ29tbWl0cyBhdCBvciBiZWxvdyB0aGlzIHNpemUgbWF5IGlubGluZSBjb250ZW50IChiYXNlNjQpIG9uIHRoZSBXUy4gKi9cclxuZXhwb3J0IGNvbnN0IElOTElORV9DT05URU5UX01BWF9CWVRFUyA9IDI1NiAqIDEwMjQ7XHJcblxyXG4vKipcclxuICogT25lIGVudHJ5IG9mIHRoZSBtYW5pZmVzdCBtYXAgKGB7cGF0aCBcdTIxOTIgTWFuaWZlc3RFbnRyeX1gKS4gVGhlIGVudHJ5IGlzXHJcbiAqIHNlbGYtZGVzY3JpYmluZzogaXQgY2FycmllcyBpdHMgb3duIGBwYXRoYCBhbmQgdGhlIGhlYWQncyBgY2xvY2tgIHNvIHRoZVxyXG4gKiBjbGllbnQtc2lkZSByZWNvbmNpbGlhdGlvbiAoYHJlc29sdmUudHNgKSBjYW4gb3JkZXIgcmVtb3RlIHN0YXRlIGFnYWluc3RcclxuICogbG9jYWwgc3RhdGUgd2l0aG91dCBhbnkgZXh0cmEgcm91bmQtdHJpcHMuXHJcbiAqL1xyXG5leHBvcnQgaW50ZXJmYWNlIE1hbmlmZXN0RW50cnkge1xyXG4gIC8qKiBOb3JtYWxpemVkIHZhdWx0IHBhdGggdGhpcyBlbnRyeSBkZXNjcmliZXMgKG1pcnJvcnMgdGhlIG1hcCBrZXkpLiAqL1xyXG4gIHBhdGg6IHN0cmluZztcclxuICAvKiogVmVyc2lvbiBpZCBvZiB0aGUgZW50cnkncyBoZWFkLiAqL1xyXG4gIHZlcnNpb246IHN0cmluZztcclxuICAvKiogc2hhMjU2IGhleCBvZiBjdXJyZW50IGNvbnRlbnQgKGAnJ2AgZm9yIGZvbGRlciBwbGFjZWhvbGRlcnMpLiAqL1xyXG4gIGhhc2g6IHN0cmluZztcclxuICAvKiogQ29udGVudCBzaXplIGluIGJ5dGVzIChgMGAgZm9yIGZvbGRlciBwbGFjZWhvbGRlcnMpLiAqL1xyXG4gIHNpemU6IG51bWJlcjtcclxuICAvKiogVG9tYnN0b25lIGZsYWcuICovXHJcbiAgZGVsZXRlZDogYm9vbGVhbjtcclxuICAvKiogTG9naWNhbCBjbG9jayBvZiB0aGUgaGVhZCBcdTIwMTQgdGhlIG9yZGVyaW5nIGF1dGhvcml0eSAoXHUwMEE3NCkuICovXHJcbiAgY2xvY2s6IExvZ2ljYWxDbG9jaztcclxuICAvKiogVHJ1ZSBmb3IgZW1wdHktZm9sZGVyIHBsYWNlaG9sZGVyIGVudHJpZXMgKEZSLTEwKS4gKi9cclxuICBpc0ZvbGRlcj86IGJvb2xlYW47XHJcbiAgLyoqIEVwb2NoIG1zIG9mIGxhc3QgdXBkYXRlLCBkaXNwbGF5LW9ubHkuICovXHJcbiAgbXRpbWU6IG51bWJlcjtcclxufVxyXG5cclxuLy8gLS0tIENsaWVudCBcdTIxOTIgU2VydmVyIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHJcbi8qKiBBdXRoICsgY2F0Y2gtdXA6IHRva2VuLCBwcm90b2NvbCB2ZXJzaW9uLCBsYXN0IHNlZW4gRE8gc2VxdWVuY2UgbnVtYmVyLiAqL1xyXG5leHBvcnQgaW50ZXJmYWNlIEhlbGxvTWVzc2FnZSB7XHJcbiAgdHlwZTogJ2hlbGxvJztcclxuICB0b2tlbjogc3RyaW5nO1xyXG4gIHByb3RvY29sVmVyc2lvbjogbnVtYmVyO1xyXG4gIC8qKiBMYXN0IHNlZW4gZ2xvYmFsIHNlcXVlbmNlIG51bWJlcjsgMCBmb3IgYSBmaXJzdC1ldmVyIGNvbm5lY3QuICovXHJcbiAgY3Vyc29yOiBudW1iZXI7XHJcbn1cclxuXHJcbi8qKiBSZXF1ZXN0IGZ1bGwgKGBzaW5jZWAgb21pdHRlZCkgb3IgZGVsdGEgbWFuaWZlc3QuICovXHJcbmV4cG9ydCBpbnRlcmZhY2UgR2V0TWFuaWZlc3RNZXNzYWdlIHtcclxuICB0eXBlOiAnZ2V0TWFuaWZlc3QnO1xyXG4gIHNpbmNlPzogbnVtYmVyO1xyXG59XHJcblxyXG4vKipcclxuICogQ29tbWl0IGEgbmV3IHZlcnNpb24uIElmIGBpbmxpbmVgIGlzIHNldCBpdCBjYXJyaWVzIHRoZSBmdWxsIGNvbnRlbnRcclxuICogYmFzZTY0LWVuY29kZWQgKG9ubHkgYWxsb3dlZCB3aGVuIGBzaXplIDw9IElOTElORV9DT05URU5UX01BWF9CWVRFU2ApO1xyXG4gKiBvdGhlcndpc2UgdGhlIGJsb2IgbXVzdCBhbHJlYWR5IGJlIHVwbG9hZGVkIChgcHV0QmxvYmAgb24gdGhpcyBjaGFubmVsLFxyXG4gKiBgUFVUIC9ibG9iLzpoYXNoYCBvbiB0aGUgcmVhbCB3b3JrZXIpLlxyXG4gKi9cclxuZXhwb3J0IGludGVyZmFjZSBDb21taXRNZXNzYWdlIHtcclxuICB0eXBlOiAnY29tbWl0JztcclxuICBwYXRoOiBzdHJpbmc7XHJcbiAgLyoqIFZlcnNpb24gaWQgdGhlIGNvbW1pdCBidWlsZHMgb247IHNlcnZlciBkZXRlY3RzIGRpdmVyZ2VuY2UgXHUyMTkyIGNvbmZsaWN0LiAqL1xyXG4gIHBhcmVudFZlcnNpb246IHN0cmluZyB8IG51bGw7XHJcbiAgaGFzaDogc3RyaW5nO1xyXG4gIHNpemU6IG51bWJlcjtcclxuICAvKiogV2hhdCBraW5kIG9mIHZlcnNpb24gdGhpcyBjb21taXRzIChtaXJyb3JzIGBWZXJzaW9uLmtpbmRgKS4gKi9cclxuICBraW5kOiBWZXJzaW9uS2luZDtcclxuICBpbmxpbmU/OiBzdHJpbmc7XHJcbiAgLyoqIFNvdXJjZSBwYXRoIFx1MjAxNCByZXF1aXJlZCBmb3IgYGtpbmQ6ICdyZW5hbWUnYCAoY2hhaW4gbWlncmF0aW9uLCBGUi05KS4gKi9cclxuICBmcm9tUGF0aD86IHN0cmluZztcclxuICAvKiogVHJ1ZSBmb3IgZW1wdHktZm9sZGVyIHBsYWNlaG9sZGVyIGNvbW1pdHMgKEZSLTEwOyBoYXNoIGAnJ2AsIHNpemUgMCkuICovXHJcbiAgaXNGb2xkZXI/OiBib29sZWFuO1xyXG59XHJcblxyXG4vKiogS2VlcGFsaXZlLiAqL1xyXG5leHBvcnQgaW50ZXJmYWNlIFBpbmdNZXNzYWdlIHtcclxuICB0eXBlOiAncGluZyc7XHJcbiAgLyoqIENsaWVudCBlcG9jaCBtczsgZWNob2VkIGJhY2sgb24gYHBvbmdgIGZvciBSVFQgLyBza2V3IG1lYXN1cmVtZW50LiAqL1xyXG4gIHRzPzogbnVtYmVyO1xyXG59XHJcblxyXG4vKipcclxuICogVXBsb2FkIGEgY29udGVudCBibG9iIG92ZXIgdGhlIHN5bmMgY2hhbm5lbC4gVGVzdCBkb3VibGVzIGFuZCBzbWFsbCB2YXVsdHNcclxuICogY2FuIHVzZSB0aGlzIGRpcmVjdGx5OyB0aGUgcmVhbCB3b3JrZXIgZXhwb3NlcyB0aGUgc2FtZSBvcGVyYXRpb24gYXNcclxuICogYFBVVCAvYmxvYi86aGFzaGAgKHN0cmVhbWVkKS4gSWRlbXBvdGVudDogc2FtZSBoYXNoIFx1MjFEMiBzYW1lIGNvbnRlbnQuXHJcbiAqL1xyXG5leHBvcnQgaW50ZXJmYWNlIFB1dEJsb2JNZXNzYWdlIHtcclxuICB0eXBlOiAncHV0QmxvYic7XHJcbiAgaGFzaDogc3RyaW5nO1xyXG4gIC8qKiBGdWxsIGNvbnRlbnQsIGJhc2U2NC1lbmNvZGVkLiAqL1xyXG4gIGNvbnRlbnQ6IHN0cmluZztcclxufVxyXG5cclxuLyoqIEZldGNoIGEgY29udGVudCBibG9iICh0aGUgV1MtaW5saW5lIHBhdGggb2YgXHUwMEE3OCBcImZldGNoIGJsb2JcIikuICovXHJcbmV4cG9ydCBpbnRlcmZhY2UgR2V0QmxvYk1lc3NhZ2Uge1xyXG4gIHR5cGU6ICdnZXRCbG9iJztcclxuICBoYXNoOiBzdHJpbmc7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBTbmFwc2hvdCBldmVyeSBmaWxlIGhlYWQgYXQgYSBtb21lbnQgKGEgd2hvbGUtdmF1bHQgcmVzdG9yZSBwb2ludCkuIFRoZVxyXG4gKiBzZXJ2ZXIgcmVjb3JkcyB0aGUgaGVhZCBzdGF0ZSBhdG9taWNhbGx5OyBzbmFwc2hvdHMgYXJlIG5ldmVyIGJyb2FkY2FzdCBcdTIwMTRcclxuICogb3RoZXIgZGV2aWNlcyBsZWFybiBub3RoaW5nIGxpdmUsIHRoZSBsaXN0IGlzIHB1bGwtYmFzZWQuXHJcbiAqL1xyXG5leHBvcnQgaW50ZXJmYWNlIFNuYXBzaG90Q3JlYXRlTWVzc2FnZSB7XHJcbiAgdHlwZTogJ3NuYXBzaG90Q3JlYXRlJztcclxuICAvKiogT3B0aW9uYWwgbGFiZWw7IG9taXR0ZWQvZW1wdHkgXHUyMUQyIHVubmFtZWQuICovXHJcbiAgbmFtZT86IHN0cmluZztcclxufVxyXG5cclxuLyoqIFJlc3RvcmUgdGhlIHdob2xlIHZhdWx0IHRvIGEgc25hcHNob3QgKEZSLTc6IGFzIE5FVyB2ZXJzaW9ucyBcdTIwMTQgaGlzdG9yeSBpcyBuZXZlciBkZWxldGVkKS4gKi9cclxuZXhwb3J0IGludGVyZmFjZSBTbmFwc2hvdFJlc3RvcmVNZXNzYWdlIHtcclxuICB0eXBlOiAnc25hcHNob3RSZXN0b3JlJztcclxuICAvKiogU25hcHNob3QgaWQgKGFzIHJldHVybmVkIGJ5IGBzbmFwc2hvdENyZWF0ZUFja2AgLyBsaXN0ZWQgYnkgdGhlIHNlcnZlcikuICovXHJcbiAgaWQ6IHN0cmluZztcclxufVxyXG5cclxuLy8gLS0tIFNlcnZlciBcdTIxOTIgQ2xpZW50IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHJcbi8qKiBTdWNjZXNzZnVsIGhlbGxvOiB0aGlzIGRldmljZSdzIGlkZW50aXR5ICsgdmF1bHQtbGV2ZWwgaW5mby4gKi9cclxuZXhwb3J0IGludGVyZmFjZSBIZWxsb0Fja01lc3NhZ2Uge1xyXG4gIHR5cGU6ICdoZWxsb0Fjayc7XHJcbiAgZGV2aWNlSWQ6IHN0cmluZztcclxuICB2YXVsdE5hbWU6IHN0cmluZztcclxuICBzZXR0aW5nczogVmF1bHRTZXR0aW5ncztcclxuICAvKipcclxuICAgKiBMb3dlc3QgY2hhbmdlLWV2ZW50IHNlcXVlbmNlIG51bWJlciB0aGUgc2VydmVyIHN0aWxsIHJldGFpbnMgKHByb3RvY29sXHJcbiAgICogdjEsIHByZS1yZWxlYXNlOyBvcHRpb25hbCBzbyBvbGRlciBzZXJ2ZXJzIGNhbiBiZSBhbnN3ZXJlZCB3aXRoIGEgZnVsbFxyXG4gICAqIG1hbmlmZXN0KS4gQSBjbGllbnQgd2hvc2UgY3Vyc29yIHNhdGlzZmllc1xyXG4gICAqIGBvbGRlc3RSZXRhaW5lZFNlcSA8PSBjdXJzb3IgKyAxYCBjYW4gcmVxdWVzdCBhIGRlbHRhIG1hbmlmZXN0IFx1MjAxNCBldmVyeVxyXG4gICAqIGV2ZW50IGFmdGVyIGl0cyBjdXJzb3IgaXMgc3RpbGwgcmVwbGF5YWJsZSwgc28gaXRzIGluZGV4IGlzIGd1YXJhbnRlZWRcclxuICAgKiB0byBvbmx5IG1pc3MgaGVhZHMgd2l0aCBgaGVhZF9zZXEgPiBjdXJzb3JgLiBBYnNlbnQgKG9yIGA+IGN1cnNvciArIDFgKVxyXG4gICAqIFx1MjFEMiB0aGUgY2xpZW50IG11c3QgZmFsbCBiYWNrIHRvIGEgZnVsbCBtYW5pZmVzdC5cclxuICAgKi9cclxuICBvbGRlc3RSZXRhaW5lZFNlcT86IG51bWJlcjtcclxuICAvKipcclxuICAgKiBUaGUgc2VydmVyJ3Mgb3duIHJlbGVhc2UgdmVyc2lvbiAodGhlIHdvcmtlcidzIHBhY2thZ2UgdmVyc2lvbikuXHJcbiAgICogT3B0aW9uYWwgYmVjYXVzZSBzZXJ2ZXJzIFx1MjI2NCAwLjEgcHJlZGF0ZSB2ZXJzaW9uIHJlcG9ydGluZyBhbmQgb21pdCBpdCBcdTIwMTRcclxuICAgKiBjbGllbnRzIHRyZWF0IGFic2VuY2UgYXMgXCJsZWdhY3kgc2VydmVyXCIgKHNlZSBgY29tcGF0LnRzYCksIG5ldmVyIGFzIGFcclxuICAgKiBwcm90b2NvbCBmYWlsdXJlLlxyXG4gICAqL1xyXG4gIHNlcnZlclZlcnNpb24/OiBzdHJpbmc7XHJcbn1cclxuXHJcbi8qKiBSZXBseSB0byBgZ2V0TWFuaWZlc3RgOiB0aGUgKHBvc3NpYmx5IGRlbHRhKSBmaWxlIGluZGV4LiAqL1xyXG5leHBvcnQgaW50ZXJmYWNlIE1hbmlmZXN0TWVzc2FnZSB7XHJcbiAgdHlwZTogJ21hbmlmZXN0JztcclxuICBlbnRyaWVzOiBSZWFkb25seTxSZWNvcmQ8c3RyaW5nLCBNYW5pZmVzdEVudHJ5Pj47XHJcbiAgLyoqIEdsb2JhbCBzZXF1ZW5jZSBudW1iZXIgdGhpcyBtYW5pZmVzdCByZWZsZWN0cyAoY3Vyc29yIGNhdGNoLXVwKS4gKi9cclxuICBjdXJzb3I6IG51bWJlcjtcclxufVxyXG5cclxuLyoqIENvbW1pdCBhY2NlcHRlZCBhcyB0aGUgbmV3IGhlYWQuICovXHJcbmV4cG9ydCBpbnRlcmZhY2UgQ29tbWl0QWNrTWVzc2FnZSB7XHJcbiAgdHlwZTogJ2NvbW1pdEFjayc7XHJcbiAgLyoqIFZlcnNpb24gaWQgYXNzaWduZWQgYnkgdGhlIGF1dGhvcml0eS4gKi9cclxuICB2ZXJzaW9uOiBzdHJpbmc7XHJcbiAgLyoqIExvZ2ljYWwgY2xvY2sgb2YgdGhlIGFjY2VwdGVkIHZlcnNpb24uICovXHJcbiAgY2xvY2s6IExvZ2ljYWxDbG9jaztcclxuICAvKiogR2xvYmFsIHNlcXVlbmNlIG51bWJlciBvZiB0aGUgYWNjZXB0ZWQgaGVhZCAoY3Vyc29yIHRyYWNraW5nKS4gKi9cclxuICBzZXE6IG51bWJlcjtcclxufVxyXG5cclxuLyoqIFdoYXQgaGFwcGVuZWQgdG8gdGhlIGxvc2luZyBzaWRlIG9mIGEgY29uY3VycmVudCBlZGl0IChzZWUgZGlzcG9zaXRpb24pLiAqL1xyXG5leHBvcnQgdHlwZSBDb25mbGljdExvc2VyRGlzcG9zaXRpb24gPSAnY29uZmxpY3RDb3B5JztcclxuXHJcbi8qKlxyXG4gKiBUaGUgd2lubmluZyB2ZXJzaW9uIG9mIGEgYGNvbmZsaWN0YCByZXBseTogYSBgVmVyc2lvbmAgcGx1cyB0aGUgaGVhZCdzXHJcbiAqIGZvbGRlciBmbGFnLiBgaXNGb2xkZXJgIGlzIG9wdGlvbmFsIG9uIHRoZSB3aXJlIChvbGRlciBzZXJ2ZXJzIG9taXQgaXQpO1xyXG4gKiBmb2xkZXItcGxhY2Vob2xkZXIgd2lubmVycyBjYXJyeSBgaGFzaDogJydgIC8gYHNpemU6IDBgLCBhbmQgdGhlIGZsYWcgaXNcclxuICogd2hhdCBsZXRzIGEgY2xpZW50IG1hdGVyaWFsaXplIHRoZSBoZWFkIGFzIGZvbGRlciBtZXRhZGF0YSBcdTIwMTQgYW4gYGVuc3VyZURpcmBcclxuICogXHUyMDE0IGluc3RlYWQgb2YgYXR0ZW1wdGluZyBhIGNvbnRlbnQgZmV0Y2ggZm9yIHRoZSBlbXB0eSBoYXNoICh3aGljaCB0aGVcclxuICogYmxvYi1mZXRjaCBndWFyZCByaWdodGx5IHJlZnVzZXMpLlxyXG4gKi9cclxuZXhwb3J0IGludGVyZmFjZSBDb25mbGljdFdpbm5lciBleHRlbmRzIFZlcnNpb24ge1xyXG4gIC8qKiBUcnVlIHdoZW4gdGhlIHdpbm5pbmcgaGVhZCBpcyBhIGZvbGRlciBwbGFjZWhvbGRlciAoRlItMTApLiAqL1xyXG4gIGlzRm9sZGVyPzogYm9vbGVhbjtcclxufVxyXG5cclxuLyoqIENvbW1pdCBsb3N0IHRoZSByYWNlOyB0aGUgc2VydmVyJ3MgY2hvc2VuIHdpbm5lciBzdGFuZHMuICovXHJcbmV4cG9ydCBpbnRlcmZhY2UgQ29uZmxpY3RNZXNzYWdlIHtcclxuICB0eXBlOiAnY29uZmxpY3QnO1xyXG4gIC8qKiBUaGUgd2lubmluZyB2ZXJzaW9uICh0aGlzIGNvbW1pdCBvciB0aGUgY29uY3VycmVudCBvbmUpLiAqL1xyXG4gIHdpbm5lcjogQ29uZmxpY3RXaW5uZXI7XHJcbiAgLyoqIFdoYXQgdGhlIHNlcnZlciBkaWQgd2l0aCB0aGUgbG9zZXIncyBjb250ZW50IFx1MjAxNCBuZXZlciBkZWxldGVkLiAqL1xyXG4gIGxvc2VyRGlzcG9zaXRpb246IENvbmZsaWN0TG9zZXJEaXNwb3NpdGlvbjtcclxuICAvKiogR2xvYmFsIHNlcXVlbmNlIG51bWJlciBvZiB0aGUgd2lubmluZyBoZWFkLCB3aGVuIGl0IGhhcyBvbmUuICovXHJcbiAgc2VxPzogbnVtYmVyO1xyXG59XHJcblxyXG4vKipcclxuICogRmFuLW91dCBwYXlsb2FkIHNoYXJlZCBieSB0aGUgY2hhbmdlIGJyb2FkY2FzdCBhbmQgdGhlIGFyYml0cmF0aW9uIHJlc3VsdC5cclxuICogRXZlcnl0aGluZyBhIGNsaWVudCBuZWVkcyB0byBtYXRlcmlhbGl6ZSBvbmUgaGVhZCB0cmFuc2l0aW9uLlxyXG4gKi9cclxuZXhwb3J0IGludGVyZmFjZSBDaGFuZ2VQYXlsb2FkIHtcclxuICBwYXRoOiBzdHJpbmc7XHJcbiAgLyoqIFZlcnNpb24gaWQgb2YgdGhlIG5ldyBoZWFkLiAqL1xyXG4gIHZlcnNpb246IHN0cmluZztcclxuICBoYXNoOiBzdHJpbmc7XHJcbiAgc2l6ZTogbnVtYmVyO1xyXG4gIGRlbGV0ZWQ6IGJvb2xlYW47XHJcbiAgLyoqIElkIG9mIHRoZSBkZXZpY2UgdGhhdCBjb21taXR0ZWQuICovXHJcbiAgZGV2aWNlOiBzdHJpbmc7XHJcbiAgLyoqIExvZ2ljYWwgY2xvY2sgb2YgdGhlIG5ldyBoZWFkIFx1MjAxNCBjbGllbnRzIHVzZSBpdCB0byBza2lwIHN0YWxlIHJlcGxheXMuICovXHJcbiAgY2xvY2s6IExvZ2ljYWxDbG9jaztcclxuICAvKiogV2hhdCBraW5kIG9mIGNoYW5nZSB0aGlzIGlzIChtaXJyb3JzIGBWZXJzaW9uLmtpbmRgKS4gKi9cclxuICBraW5kOiBWZXJzaW9uS2luZDtcclxuICAvKiogU291cmNlIHBhdGggXHUyMDE0IHByZXNlbnQgd2hlbiBga2luZDogJ3JlbmFtZSdgLiAqL1xyXG4gIGZyb21QYXRoPzogc3RyaW5nO1xyXG4gIC8qKiBUcnVlIGZvciBmb2xkZXIgcGxhY2Vob2xkZXIgY2hhbmdlcyAoRlItMTApLiAqL1xyXG4gIGlzRm9sZGVyPzogYm9vbGVhbjtcclxufVxyXG5cclxuLyoqIEZhbi1vdXQgYnJvYWRjYXN0IHRvIGFsbCAqb3RoZXIqIGNvbm5lY3RlZCBjbGllbnRzLiAqL1xyXG5leHBvcnQgaW50ZXJmYWNlIENoYW5nZU1lc3NhZ2UgZXh0ZW5kcyBDaGFuZ2VQYXlsb2FkIHtcclxuICB0eXBlOiAnY2hhbmdlJztcclxuICAvKiogR2xvYmFsIHNlcXVlbmNlIG51bWJlciBvZiB0aGlzIGNoYW5nZSAoY3Vyc29yIHRyYWNraW5nKS4gKi9cclxuICBzZXE6IG51bWJlcjtcclxufVxyXG5cclxuLyoqIFJlcGx5IHRvIGBwdXRCbG9iYC4gKi9cclxuZXhwb3J0IGludGVyZmFjZSBCbG9iQWNrTWVzc2FnZSB7XHJcbiAgdHlwZTogJ2Jsb2JBY2snO1xyXG4gIGhhc2g6IHN0cmluZztcclxufVxyXG5cclxuLyoqIFJlcGx5IHRvIGBnZXRCbG9iYDogdGhlIHJlcXVlc3RlZCBjb250ZW50LiAqL1xyXG5leHBvcnQgaW50ZXJmYWNlIEJsb2JNZXNzYWdlIHtcclxuICB0eXBlOiAnYmxvYic7XHJcbiAgaGFzaDogc3RyaW5nO1xyXG4gIC8qKiBGdWxsIGNvbnRlbnQsIGJhc2U2NC1lbmNvZGVkLiAqL1xyXG4gIGNvbnRlbnQ6IHN0cmluZztcclxufVxyXG5cclxuLyoqIE1hY2hpbmUtcmVhZGFibGUgY29kZXMgY2FycmllZCBieSBgZXJyb3JgIG1lc3NhZ2VzIChIVFRQLWVxdWl2YWxlbnQpLiAqL1xyXG5leHBvcnQgdHlwZSBTZXJ2ZXJFcnJvckNvZGUgPSAnVU5BVVRIT1JJWkVEJyB8ICdSRVZPS0VEJyB8ICdOT1RfRk9VTkQnIHwgJ1BST1RPQ09MJztcclxuXHJcbi8qKiBOZWdhdGl2ZSByZXBseSAoYXV0aCBmYWlsdXJlLCB1bmtub3duIGJsb2IsIHByb3RvY29sIHZpb2xhdGlvbiwgXHUyMDI2KS4gKi9cclxuZXhwb3J0IGludGVyZmFjZSBFcnJvck1lc3NhZ2Uge1xyXG4gIHR5cGU6ICdlcnJvcic7XHJcbiAgY29kZTogU2VydmVyRXJyb3JDb2RlO1xyXG4gIG1lc3NhZ2U6IHN0cmluZztcclxufVxyXG5cclxuLyoqIFByZXNlbmNlIHVwZGF0ZSBmb3IgZGFzaGJvYXJkcyAvIGB2c2Egc3RhdHVzYC4gKi9cclxuZXhwb3J0IGludGVyZmFjZSBEZXZpY2VTZWVuTWVzc2FnZSB7XHJcbiAgdHlwZTogJ2RldmljZVNlZW4nO1xyXG4gIGRldmljZUlkOiBzdHJpbmc7XHJcbiAgdHM6IG51bWJlcjtcclxufVxyXG5cclxuLyoqIEtlZXBhbGl2ZSByZXBseS4gKi9cclxuZXhwb3J0IGludGVyZmFjZSBQb25nTWVzc2FnZSB7XHJcbiAgdHlwZTogJ3BvbmcnO1xyXG4gIC8qKiBFY2hvZXMgdGhlIGBwaW5nYCB0cyB3aGVuIG9uZSB3YXMgcHJvdmlkZWQuICovXHJcbiAgdHM/OiBudW1iZXI7XHJcbn1cclxuXHJcbi8qKiBSZXBseSB0byBgc25hcHNob3RDcmVhdGVgLiAqL1xyXG5leHBvcnQgaW50ZXJmYWNlIFNuYXBzaG90Q3JlYXRlQWNrTWVzc2FnZSB7XHJcbiAgdHlwZTogJ3NuYXBzaG90Q3JlYXRlQWNrJztcclxuICAvKiogSWQgYXNzaWduZWQgYnkgdGhlIGF1dGhvcml0eSAoYHN7bn1gKS4gKi9cclxuICBpZDogc3RyaW5nO1xyXG4gIC8qKiBFY2hvZXMgdGhlIHN0b3JlZCBuYW1lIChgJydgIGZvciB1bm5hbWVkIHNuYXBzaG90cykuICovXHJcbiAgbmFtZTogc3RyaW5nO1xyXG4gIC8qKiBFcG9jaCBtcyBvZiB0aGUgc25hcHNob3QuICovXHJcbiAgdHM6IG51bWJlcjtcclxuICAvKiogR2xvYmFsIHNlcXVlbmNlIG51bWJlciBhdCBjcmVhdGlvbiAoY3Vyc29yIGJvb2trZWVwaW5nKS4gKi9cclxuICBzZXE6IG51bWJlcjtcclxuICAvKiogTnVtYmVyIG9mIGZpbGUgaGVhZHMgY2FwdHVyZWQuICovXHJcbiAgZmlsZUNvdW50OiBudW1iZXI7XHJcbn1cclxuXHJcbi8qKiBSZXBseSB0byBgc25hcHNob3RSZXN0b3JlYC4gKi9cclxuZXhwb3J0IGludGVyZmFjZSBTbmFwc2hvdFJlc3RvcmVBY2tNZXNzYWdlIHtcclxuICB0eXBlOiAnc25hcHNob3RSZXN0b3JlQWNrJztcclxuICBpZDogc3RyaW5nO1xyXG4gIC8qKiBQYXRocyByZXZlcnRlZCB0byB0aGUgc25hcHNob3QncyBjb250ZW50IChyZXN1cnJlY3RlZCB0b21ic3RvbmVzIGluY2x1ZGVkKS4gKi9cclxuICByZXN0b3JlZDogbnVtYmVyO1xyXG4gIC8qKiBQYXRocyBuZXdseSB0b21ic3RvbmVkIChsaXZlIG5vdywgYWJzZW50IG9yIGRlbGV0ZWQgYXQgdGhlIHNuYXBzaG90KS4gKi9cclxuICB0b21ic3RvbmVkOiBudW1iZXI7XHJcbiAgLyoqIEdsb2JhbCBzZXEgb2YgdGhlIGxhc3QgcmVzdG9yZSBjaGFuZ2UgKGN1cnJlbnQgc2VxIHdoZW4gbm90aGluZyBkaWZmZXJlZCkuICovXHJcbiAgc2VxOiBudW1iZXI7XHJcbn1cclxuXHJcbi8qKiBPbmUgdmF1bHQtbGV2ZWwgc25hcHNob3QgYXMgbGlzdGVkIGJ5IHRoZSBzZXJ2ZXIgKGBHRVQgL2FwaS9zbmFwc2hvdHNgKS4gKi9cclxuZXhwb3J0IGludGVyZmFjZSBTbmFwc2hvdFN1bW1hcnkge1xyXG4gIGlkOiBzdHJpbmc7XHJcbiAgbmFtZTogc3RyaW5nO1xyXG4gIC8qKiBFcG9jaCBtcyBvZiBjcmVhdGlvbi4gKi9cclxuICB0czogbnVtYmVyO1xyXG4gIC8qKiBEZXZpY2UgdGhhdCBjcmVhdGVkIHRoZSBzbmFwc2hvdC4gKi9cclxuICBkZXZpY2VJZDogc3RyaW5nO1xyXG4gIC8qKiBHbG9iYWwgc2VxdWVuY2UgbnVtYmVyIGF0IGNyZWF0aW9uLiAqL1xyXG4gIHNlcTogbnVtYmVyO1xyXG4gIC8qKiBOdW1iZXIgb2YgZmlsZSBoZWFkcyBjYXB0dXJlZC4gKi9cclxuICBmaWxlQ291bnQ6IG51bWJlcjtcclxufVxyXG5cclxuLy8gLS0tIFVuaW9uICsgZ3VhcmRzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cclxuZXhwb3J0IHR5cGUgQ2xpZW50TWVzc2FnZSA9XHJcbiAgfCBIZWxsb01lc3NhZ2VcclxuICB8IEdldE1hbmlmZXN0TWVzc2FnZVxyXG4gIHwgQ29tbWl0TWVzc2FnZVxyXG4gIHwgUHV0QmxvYk1lc3NhZ2VcclxuICB8IEdldEJsb2JNZXNzYWdlXHJcbiAgfCBQaW5nTWVzc2FnZVxyXG4gIHwgU25hcHNob3RDcmVhdGVNZXNzYWdlXHJcbiAgfCBTbmFwc2hvdFJlc3RvcmVNZXNzYWdlO1xyXG5cclxuZXhwb3J0IHR5cGUgU2VydmVyTWVzc2FnZSA9XHJcbiAgfCBIZWxsb0Fja01lc3NhZ2VcclxuICB8IE1hbmlmZXN0TWVzc2FnZVxyXG4gIHwgQ29tbWl0QWNrTWVzc2FnZVxyXG4gIHwgQ29uZmxpY3RNZXNzYWdlXHJcbiAgfCBDaGFuZ2VNZXNzYWdlXHJcbiAgfCBEZXZpY2VTZWVuTWVzc2FnZVxyXG4gIHwgQmxvYkFja01lc3NhZ2VcclxuICB8IEJsb2JNZXNzYWdlXHJcbiAgfCBFcnJvck1lc3NhZ2VcclxuICB8IFBvbmdNZXNzYWdlXHJcbiAgfCBTbmFwc2hvdENyZWF0ZUFja01lc3NhZ2VcclxuICB8IFNuYXBzaG90UmVzdG9yZUFja01lc3NhZ2U7XHJcblxyXG5leHBvcnQgdHlwZSBNZXNzYWdlID0gQ2xpZW50TWVzc2FnZSB8IFNlcnZlck1lc3NhZ2U7XHJcblxyXG5jb25zdCBDTElFTlRfVFlQRVM6IFJlYWRvbmx5U2V0PHN0cmluZz4gPSBuZXcgU2V0KFtcclxuICAnaGVsbG8nLFxyXG4gICdnZXRNYW5pZmVzdCcsXHJcbiAgJ2NvbW1pdCcsXHJcbiAgJ3B1dEJsb2InLFxyXG4gICdnZXRCbG9iJyxcclxuICAncGluZycsXHJcbiAgJ3NuYXBzaG90Q3JlYXRlJyxcclxuICAnc25hcHNob3RSZXN0b3JlJyxcclxuXSk7XHJcbmNvbnN0IFNFUlZFUl9UWVBFUzogUmVhZG9ubHlTZXQ8c3RyaW5nPiA9IG5ldyBTZXQoW1xyXG4gICdoZWxsb0FjaycsXHJcbiAgJ21hbmlmZXN0JyxcclxuICAnY29tbWl0QWNrJyxcclxuICAnY29uZmxpY3QnLFxyXG4gICdjaGFuZ2UnLFxyXG4gICdkZXZpY2VTZWVuJyxcclxuICAnYmxvYkFjaycsXHJcbiAgJ2Jsb2InLFxyXG4gICdlcnJvcicsXHJcbiAgJ3BvbmcnLFxyXG4gICdzbmFwc2hvdENyZWF0ZUFjaycsXHJcbiAgJ3NuYXBzaG90UmVzdG9yZUFjaycsXHJcbl0pO1xyXG5cclxuLyoqXHJcbiAqIFJ1bnRpbWUgc2hhcGUgY2hlY2s6IGEgdmFsdWUgaXMgYSBgTWVzc2FnZWAgaWZmIGl0IGlzIGFuIG9iamVjdCB3aG9zZVxyXG4gKiBgdHlwZWAgaXMgYSBrbm93biBtZXNzYWdlIHR5cGUuIEZpZWxkLWxldmVsIHZhbGlkYXRpb24gaGFwcGVucyB3aGVyZSBhXHJcbiAqIG1lc3NhZ2UgaXMgYWN0ZWQgdXBvbiAobGF0ZXIgcGhhc2VzKTsgdGhlIGd1YXJkIGlzIGRlbGliZXJhdGVseSBjaGVhcCBzb1xyXG4gKiBib3RoIFdTIGVuZHMgY2FuIHRyaWFnZSB1bmtub3duL2ZvcndhcmQtY29tcGF0aWJsZSB0eXBlcy5cclxuICovXHJcbmV4cG9ydCBmdW5jdGlvbiBpc01lc3NhZ2UodmFsdWU6IHVua25vd24pOiB2YWx1ZSBpcyBNZXNzYWdlIHtcclxuICByZXR1cm4gKFxyXG4gICAgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJlxyXG4gICAgdmFsdWUgIT09IG51bGwgJiZcclxuICAgIHR5cGVvZiAodmFsdWUgYXMgeyB0eXBlPzogdW5rbm93biB9KS50eXBlID09PSAnc3RyaW5nJyAmJlxyXG4gICAgKENMSUVOVF9UWVBFUy5oYXMoKHZhbHVlIGFzIHsgdHlwZTogc3RyaW5nIH0pLnR5cGUpIHx8XHJcbiAgICAgIFNFUlZFUl9UWVBFUy5oYXMoKHZhbHVlIGFzIHsgdHlwZTogc3RyaW5nIH0pLnR5cGUpKVxyXG4gICk7XHJcbn1cclxuXHJcbmV4cG9ydCBmdW5jdGlvbiBpc0NsaWVudE1lc3NhZ2UodmFsdWU6IHVua25vd24pOiB2YWx1ZSBpcyBDbGllbnRNZXNzYWdlIHtcclxuICByZXR1cm4gKFxyXG4gICAgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJlxyXG4gICAgdmFsdWUgIT09IG51bGwgJiZcclxuICAgIENMSUVOVF9UWVBFUy5oYXMoKHZhbHVlIGFzIHsgdHlwZT86IHVua25vd24gfSkudHlwZSBhcyBzdHJpbmcpXHJcbiAgKTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGlzU2VydmVyTWVzc2FnZSh2YWx1ZTogdW5rbm93bik6IHZhbHVlIGlzIFNlcnZlck1lc3NhZ2Uge1xyXG4gIHJldHVybiAoXHJcbiAgICB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmXHJcbiAgICB2YWx1ZSAhPT0gbnVsbCAmJlxyXG4gICAgU0VSVkVSX1RZUEVTLmhhcygodmFsdWUgYXMgeyB0eXBlPzogdW5rbm93biB9KS50eXBlIGFzIHN0cmluZylcclxuICApO1xyXG59XHJcblxyXG4vKipcclxuICogUGFyc2UgYSBXUyB0ZXh0IGZyYW1lIGludG8gYSB0eXBlZCBgTWVzc2FnZWAuXHJcbiAqIFRocm93cyBgUHJvdG9jb2xFcnJvcmAgb24gbm9uLUpTT04gaW5wdXQgb3IgdW5rbm93biBtZXNzYWdlIHR5cGVzLlxyXG4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlTWVzc2FnZShkYXRhOiBzdHJpbmcpOiBNZXNzYWdlIHtcclxuICBsZXQgcGFyc2VkOiB1bmtub3duO1xyXG4gIHRyeSB7XHJcbiAgICBwYXJzZWQgPSBKU09OLnBhcnNlKGRhdGEpO1xyXG4gIH0gY2F0Y2ggKGNhdXNlKSB7XHJcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgTWVzc2FnZSBpcyBub3QgdmFsaWQgSlNPTjogJHtTdHJpbmcoZGF0YSkuc2xpY2UoMCwgMjAwKX1gLCB7IGNhdXNlIH0pO1xyXG4gIH1cclxuICBpZiAoIWlzTWVzc2FnZShwYXJzZWQpKSB7XHJcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihcclxuICAgICAgYFVua25vd24gb3IgbWFsZm9ybWVkIG1lc3NhZ2UgdHlwZTogJHtKU09OLnN0cmluZ2lmeSgocGFyc2VkIGFzIHsgdHlwZT86IHVua25vd24gfSk/LnR5cGUpfWAsXHJcbiAgICApO1xyXG4gIH1cclxuICByZXR1cm4gcGFyc2VkO1xyXG59XHJcblxyXG4vLyAtLS0gc2VydmVyLWRhdGEgZmllbGQgdmFsaWRhdGlvbiAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuLy9cclxuLy8gYGlzTWVzc2FnZWAgdHJpYWdlcyB0aGUgYHR5cGVgIGRpc2NyaW1pbmFudCBvbmx5OyB0aGVzZSB2YWxpZGF0b3JzIGNoZWNrXHJcbi8vIHRoZSBGSUVMRFMgb2YgdGhlIHNlcnZlciBwYXlsb2FkcyBhIGNsaWVudCBmb2xkcyBpbnRvIGl0cyBwZXJzaXN0ZWQgbG9jYWxcclxuLy8gaW5kZXggKG1hbmlmZXN0IGVudHJpZXMsIGNvbW1pdC9jb25mbGljdCByZXBsaWVzLCBjaGFuZ2UgYnJvYWRjYXN0cykuIE9uZVxyXG4vLyBtYWxmb3JtZWQgZmllbGQgXHUyMDE0IGEgbWlzc2luZyB2ZXJzaW9uIGlkLCBhIG5vbi1udW1lcmljIHNpemUsIGEgZnJhY3Rpb25hbFxyXG4vLyBjbG9jayBjb3VudGVyIFx1MjAxNCB3b3VsZCBvdGhlcndpc2UgYmUgcGVyc2lzdGVkIHRvIHRoZSBzdGF0ZSBmaWxlIGFuZCB0aGVuXHJcbi8vIFJFSkVDVEVEIGJ5IGBkZXNlcmlhbGl6ZUxvY2FsU3RhdGVgIG9uIGV2ZXJ5IHN1YnNlcXVlbnQgc3RhcnR1cC4gQ2xpZW50c1xyXG4vLyB2YWxpZGF0ZSBhdCB0aGUgaW5nZXN0IGJvdW5kYXJ5LCBiZWZvcmUgYW55IGZpZWxkIGlzIGFwcGxpZWQ6IHZpb2xhdGlvbnNcclxuLy8gdGhyb3cgYFByb3RvY29sRXJyb3JgLCB0aGUgb2ZmZW5kaW5nIG1lc3NhZ2UgaXMgcmVqZWN0ZWQsIG5vdGhpbmcgcGVyc2lzdHMuXHJcblxyXG5jb25zdCBWRVJTSU9OX0tJTkRTOiBSZWFkb25seVNldDxzdHJpbmc+ID0gbmV3IFNldChbXHJcbiAgJ2VkaXQnLFxyXG4gICdyZW5hbWUnLFxyXG4gICdkZWxldGUnLFxyXG4gICdjb25mbGljdENvcHknLFxyXG4gICdyZXN0b3JlJyxcclxuXSk7XHJcblxyXG5mdW5jdGlvbiBpc1BsYWluT2JqZWN0KHZhbHVlOiB1bmtub3duKTogdmFsdWUgaXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4ge1xyXG4gIHJldHVybiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIHZhbHVlICE9PSBudWxsICYmICFBcnJheS5pc0FycmF5KHZhbHVlKTtcclxufVxyXG5cclxuZnVuY3Rpb24gZXhwZWN0Tm9uRW1wdHlTdHJpbmcodmFsdWU6IHVua25vd24sIHdoZXJlOiBzdHJpbmcpOiB2b2lkIHtcclxuICBpZiAodHlwZW9mIHZhbHVlICE9PSAnc3RyaW5nJyB8fCB2YWx1ZSA9PT0gJycpIHtcclxuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKGAke3doZXJlfSBtdXN0IGJlIGEgbm9uLWVtcHR5IHN0cmluZ2ApO1xyXG4gIH1cclxufVxyXG5cclxuZnVuY3Rpb24gZXhwZWN0Tm9uTmVnYXRpdmVJbnRlZ2VyKHZhbHVlOiB1bmtub3duLCB3aGVyZTogc3RyaW5nKTogdm9pZCB7XHJcbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gJ251bWJlcicgfHwgIU51bWJlci5pc0ludGVnZXIodmFsdWUpIHx8IHZhbHVlIDwgMCkge1xyXG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoYCR7d2hlcmV9IG11c3QgYmUgYSBub24tbmVnYXRpdmUgaW50ZWdlcmApO1xyXG4gIH1cclxufVxyXG5cclxuZnVuY3Rpb24gZXhwZWN0Q2xvY2sodmFsdWU6IHVua25vd24sIHdoZXJlOiBzdHJpbmcpOiB2b2lkIHtcclxuICBpZiAoXHJcbiAgICAhaXNQbGFpbk9iamVjdCh2YWx1ZSkgfHxcclxuICAgIHR5cGVvZiB2YWx1ZS5jb3VudGVyICE9PSAnbnVtYmVyJyB8fFxyXG4gICAgIU51bWJlci5pc0ludGVnZXIodmFsdWUuY291bnRlcikgfHxcclxuICAgIHZhbHVlLmNvdW50ZXIgPD0gMCB8fFxyXG4gICAgdHlwZW9mIHZhbHVlLmRldmljZUlkICE9PSAnc3RyaW5nJ1xyXG4gICkge1xyXG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoXHJcbiAgICAgIGAke3doZXJlfSBtdXN0IGJlIGEgY2xvY2sgeyBjb3VudGVyOiBwb3NpdGl2ZSBpbnRlZ2VyLCBkZXZpY2VJZDogc3RyaW5nIH1gLFxyXG4gICAgKTtcclxuICB9XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBWYWxpZGF0ZSBvbmUgbWFuaWZlc3QgZW50cnkncyBmaWVsZHMuIFJldHVybnMgdGhlIGVudHJ5IHVuY2hhbmdlZDsgdGhyb3dzXHJcbiAqIGBQcm90b2NvbEVycm9yYCBvbiBhIGZpZWxkIHRoYXQgY291bGQgbm90IHN1cnZpdmUgYSBwZXJzaXN0L3JlbG9hZCBjeWNsZVxyXG4gKiAoYGxvY2FsaW5kZXgudHNgIHJlLXZhbGlkYXRlcyBzdHJpY3RseSBvbiBsb2FkKS5cclxuICovXHJcbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZU1hbmlmZXN0RW50cnkoZW50cnk6IHVua25vd24pOiBNYW5pZmVzdEVudHJ5IHtcclxuICBpZiAoIWlzUGxhaW5PYmplY3QoZW50cnkpKSB7XHJcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcignTWFsZm9ybWVkIHNlcnZlciBkYXRhOiBtYW5pZmVzdCBlbnRyeSBpcyBub3QgYW4gb2JqZWN0Jyk7XHJcbiAgfVxyXG4gIGNvbnN0IHdoZXJlID0gYG1hbmlmZXN0IGVudHJ5ICR7SlNPTi5zdHJpbmdpZnkoZW50cnkucGF0aCl9YDtcclxuICBleHBlY3ROb25FbXB0eVN0cmluZyhlbnRyeS5wYXRoLCBgJHt3aGVyZX06IHBhdGhgKTtcclxuICBleHBlY3ROb25FbXB0eVN0cmluZyhlbnRyeS52ZXJzaW9uLCBgJHt3aGVyZX06IHZlcnNpb25gKTtcclxuICBpZiAodHlwZW9mIGVudHJ5Lmhhc2ggIT09ICdzdHJpbmcnKSB7XHJcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgJHt3aGVyZX06IGhhc2ggbXVzdCBiZSBhIHN0cmluZ2ApO1xyXG4gIH1cclxuICBleHBlY3ROb25OZWdhdGl2ZUludGVnZXIoZW50cnkuc2l6ZSwgYCR7d2hlcmV9OiBzaXplYCk7XHJcbiAgaWYgKHR5cGVvZiBlbnRyeS5kZWxldGVkICE9PSAnYm9vbGVhbicpIHtcclxuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKGAke3doZXJlfTogZGVsZXRlZCBtdXN0IGJlIGEgYm9vbGVhbmApO1xyXG4gIH1cclxuICBleHBlY3RDbG9jayhlbnRyeS5jbG9jaywgYCR7d2hlcmV9OiBjbG9ja2ApO1xyXG4gIGlmIChlbnRyeS5pc0ZvbGRlciAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBlbnRyeS5pc0ZvbGRlciAhPT0gJ2Jvb2xlYW4nKSB7XHJcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgJHt3aGVyZX06IGlzRm9sZGVyIG11c3QgYmUgYSBib29sZWFuIHdoZW4gcHJlc2VudGApO1xyXG4gIH1cclxuICBpZiAoZW50cnkubXRpbWUgIT09IHVuZGVmaW5lZCAmJiAodHlwZW9mIGVudHJ5Lm10aW1lICE9PSAnbnVtYmVyJyB8fCAhTnVtYmVyLmlzRmluaXRlKGVudHJ5Lm10aW1lKSkpIHtcclxuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKGAke3doZXJlfTogbXRpbWUgbXVzdCBiZSBhIGZpbml0ZSBudW1iZXIgd2hlbiBwcmVzZW50YCk7XHJcbiAgfVxyXG4gIHJldHVybiBlbnRyeSBhcyB1bmtub3duIGFzIE1hbmlmZXN0RW50cnk7XHJcbn1cclxuXHJcbi8qKiBWYWxpZGF0ZSBhIGBtYW5pZmVzdGAgcmVwbHkgKGN1cnNvciArIGV2ZXJ5IGVudHJ5KSBiZWZvcmUgaXQgaXMgcHJvamVjdGVkLiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVNYW5pZmVzdE1lc3NhZ2UobWVzc2FnZTogTWFuaWZlc3RNZXNzYWdlKTogdm9pZCB7XHJcbiAgZXhwZWN0Tm9uTmVnYXRpdmVJbnRlZ2VyKG1lc3NhZ2UuY3Vyc29yLCAnbWFuaWZlc3QgY3Vyc29yJyk7XHJcbiAgZm9yIChjb25zdCBlbnRyeSBvZiBPYmplY3QudmFsdWVzKG1lc3NhZ2UuZW50cmllcykpIHtcclxuICAgIHZhbGlkYXRlTWFuaWZlc3RFbnRyeShlbnRyeSk7XHJcbiAgfVxyXG59XHJcblxyXG4vKiogVmFsaWRhdGUgYSBgY29tbWl0QWNrYCBiZWZvcmUgaXRzIHZlcnNpb24vY2xvY2sgYXJlIGZvbGRlZCBpbnRvIHRoZSBpbmRleC4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlQ29tbWl0QWNrTWVzc2FnZShtZXNzYWdlOiBDb21taXRBY2tNZXNzYWdlKTogdm9pZCB7XHJcbiAgZXhwZWN0Tm9uRW1wdHlTdHJpbmcobWVzc2FnZS52ZXJzaW9uLCAnY29tbWl0QWNrLnZlcnNpb24nKTtcclxuICBleHBlY3RDbG9jayhtZXNzYWdlLmNsb2NrLCAnY29tbWl0QWNrLmNsb2NrJyk7XHJcbiAgZXhwZWN0Tm9uTmVnYXRpdmVJbnRlZ2VyKG1lc3NhZ2Uuc2VxLCAnY29tbWl0QWNrLnNlcScpO1xyXG59XHJcblxyXG4vKiogVmFsaWRhdGUgYSBgY2hhbmdlYCBicm9hZGNhc3QgYmVmb3JlIGl0IGlzIGFwcGxpZWQgb3IgcmVwbGF5ZWQuICovXHJcbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUNoYW5nZU1lc3NhZ2UoY2hhbmdlOiBDaGFuZ2VNZXNzYWdlKTogdm9pZCB7XHJcbiAgY29uc3Qgd2hlcmUgPSBgY2hhbmdlICR7SlNPTi5zdHJpbmdpZnkoY2hhbmdlLnBhdGgpfWA7XHJcbiAgZXhwZWN0Tm9uRW1wdHlTdHJpbmcoY2hhbmdlLnBhdGgsIGAke3doZXJlfTogcGF0aGApO1xyXG4gIGV4cGVjdE5vbkVtcHR5U3RyaW5nKGNoYW5nZS52ZXJzaW9uLCBgJHt3aGVyZX06IHZlcnNpb25gKTtcclxuICBpZiAodHlwZW9mIGNoYW5nZS5oYXNoICE9PSAnc3RyaW5nJykge1xyXG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoYCR7d2hlcmV9OiBoYXNoIG11c3QgYmUgYSBzdHJpbmdgKTtcclxuICB9XHJcbiAgZXhwZWN0Tm9uTmVnYXRpdmVJbnRlZ2VyKGNoYW5nZS5zaXplLCBgJHt3aGVyZX06IHNpemVgKTtcclxuICBpZiAodHlwZW9mIGNoYW5nZS5kZWxldGVkICE9PSAnYm9vbGVhbicpIHtcclxuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKGAke3doZXJlfTogZGVsZXRlZCBtdXN0IGJlIGEgYm9vbGVhbmApO1xyXG4gIH1cclxuICBpZiAodHlwZW9mIGNoYW5nZS5kZXZpY2UgIT09ICdzdHJpbmcnKSB7XHJcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgJHt3aGVyZX06IGRldmljZSBtdXN0IGJlIGEgc3RyaW5nYCk7XHJcbiAgfVxyXG4gIGV4cGVjdENsb2NrKGNoYW5nZS5jbG9jaywgYCR7d2hlcmV9OiBjbG9ja2ApO1xyXG4gIGlmICghVkVSU0lPTl9LSU5EUy5oYXMoY2hhbmdlLmtpbmQpKSB7XHJcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgJHt3aGVyZX06IGtpbmQgbXVzdCBiZSBhIFZlcnNpb25LaW5kYCk7XHJcbiAgfVxyXG4gIGlmIChjaGFuZ2UuZnJvbVBhdGggIT09IHVuZGVmaW5lZCAmJiB0eXBlb2YgY2hhbmdlLmZyb21QYXRoICE9PSAnc3RyaW5nJykge1xyXG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoYCR7d2hlcmV9OiBmcm9tUGF0aCBtdXN0IGJlIGEgc3RyaW5nIHdoZW4gcHJlc2VudGApO1xyXG4gIH1cclxuICBpZiAoY2hhbmdlLmlzRm9sZGVyICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIGNoYW5nZS5pc0ZvbGRlciAhPT0gJ2Jvb2xlYW4nKSB7XHJcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgJHt3aGVyZX06IGlzRm9sZGVyIG11c3QgYmUgYSBib29sZWFuIHdoZW4gcHJlc2VudGApO1xyXG4gIH1cclxuICBleHBlY3ROb25OZWdhdGl2ZUludGVnZXIoY2hhbmdlLnNlcSwgYCR7d2hlcmV9OiBzZXFgKTtcclxufVxyXG5cclxuLyoqIFZhbGlkYXRlIGEgYGNvbmZsaWN0YCByZXBseSdzIHdpbm5lciBiZWZvcmUgaXQgaXMgbWF0ZXJpYWxpemVkIG9yIHJlY29yZGVkLiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVDb25mbGljdE1lc3NhZ2UobWVzc2FnZTogQ29uZmxpY3RNZXNzYWdlKTogdm9pZCB7XHJcbiAgY29uc3Qgd2lubmVyID0gbWVzc2FnZS53aW5uZXIgYXMge1xyXG4gICAgcGF0aD86IHVua25vd247XHJcbiAgICBpZD86IHVua25vd247XHJcbiAgICBoYXNoPzogdW5rbm93bjtcclxuICAgIHNpemU/OiB1bmtub3duO1xyXG4gICAgZGV2aWNlSWQ/OiB1bmtub3duO1xyXG4gICAgY2xvY2s/OiB1bmtub3duO1xyXG4gICAga2luZD86IHVua25vd247XHJcbiAgICBpc0ZvbGRlcj86IHVua25vd247XHJcbiAgfTtcclxuICBjb25zdCB3aGVyZSA9IGBjb25mbGljdCB3aW5uZXIgJHtKU09OLnN0cmluZ2lmeSh3aW5uZXIucGF0aCl9YDtcclxuICBleHBlY3ROb25FbXB0eVN0cmluZyh3aW5uZXIucGF0aCwgYCR7d2hlcmV9OiBwYXRoYCk7XHJcbiAgZXhwZWN0Tm9uRW1wdHlTdHJpbmcod2lubmVyLmlkLCBgJHt3aGVyZX06IGlkYCk7XHJcbiAgaWYgKHR5cGVvZiB3aW5uZXIuaGFzaCAhPT0gJ3N0cmluZycpIHtcclxuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKGAke3doZXJlfTogaGFzaCBtdXN0IGJlIGEgc3RyaW5nYCk7XHJcbiAgfVxyXG4gIGV4cGVjdE5vbk5lZ2F0aXZlSW50ZWdlcih3aW5uZXIuc2l6ZSwgYCR7d2hlcmV9OiBzaXplYCk7XHJcbiAgaWYgKHR5cGVvZiB3aW5uZXIuZGV2aWNlSWQgIT09ICdzdHJpbmcnKSB7XHJcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgJHt3aGVyZX06IGRldmljZUlkIG11c3QgYmUgYSBzdHJpbmdgKTtcclxuICB9XHJcbiAgZXhwZWN0Q2xvY2sod2lubmVyLmNsb2NrLCBgJHt3aGVyZX06IGNsb2NrYCk7XHJcbiAgaWYgKHR5cGVvZiB3aW5uZXIua2luZCAhPT0gJ3N0cmluZycgfHwgIVZFUlNJT05fS0lORFMuaGFzKHdpbm5lci5raW5kKSkge1xyXG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoYCR7d2hlcmV9OiBraW5kIG11c3QgYmUgYSBWZXJzaW9uS2luZGApO1xyXG4gIH1cclxuICBpZiAod2lubmVyLmlzRm9sZGVyICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIHdpbm5lci5pc0ZvbGRlciAhPT0gJ2Jvb2xlYW4nKSB7XHJcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgJHt3aGVyZX06IGlzRm9sZGVyIG11c3QgYmUgYSBib29sZWFuIHdoZW4gcHJlc2VudGApO1xyXG4gIH1cclxuICBpZiAobWVzc2FnZS5zZXEgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgZXhwZWN0Tm9uTmVnYXRpdmVJbnRlZ2VyKG1lc3NhZ2Uuc2VxLCAnY29uZmxpY3Quc2VxJyk7XHJcbiAgfVxyXG59XHJcblxyXG4vLyAtLS0gd2lyZSBlbmNvZGluZyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuLy9cclxuLy8gYGlubGluZWAvYGNvbnRlbnRgIGZpZWxkcyBjYXJyeSByYXcgYnl0ZXMgYXMgYmFzZTY0LiBgYnRvYWAvYGF0b2JgIGV4aXN0IGluXHJcbi8vIGV2ZXJ5IHRhcmdldCBydW50aW1lIChXb3JrZXJzLCBOb2RlIDE2KywgRWxlY3Ryb24pOyBjaHVua2luZyBhdm9pZHNcclxuLy8gZXhjZWVkaW5nIGFyZ3VtZW50LWxlbmd0aCBsaW1pdHMgb24gbGFyZ2UgYXR0YWNobWVudHMuXHJcblxyXG4vKiogRW5jb2RlIGJ5dGVzIGFzIGJhc2U2NC4gKi9cclxuZXhwb3J0IGZ1bmN0aW9uIGJ5dGVzVG9CYXNlNjQoYnl0ZXM6IFVpbnQ4QXJyYXkpOiBzdHJpbmcge1xyXG4gIGxldCBiaW5hcnkgPSAnJztcclxuICBjb25zdCBDSFVOSyA9IDB4ODAwMDtcclxuICBmb3IgKGxldCBvZmZzZXQgPSAwOyBvZmZzZXQgPCBieXRlcy5sZW5ndGg7IG9mZnNldCArPSBDSFVOSykge1xyXG4gICAgYmluYXJ5ICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoLi4uYnl0ZXMuc3ViYXJyYXkob2Zmc2V0LCBvZmZzZXQgKyBDSFVOSykpO1xyXG4gIH1cclxuICByZXR1cm4gYnRvYShiaW5hcnkpO1xyXG59XHJcblxyXG4vKiogRGVjb2RlIGJhc2U2NCB0byBieXRlcy4gVGhyb3dzIGBQcm90b2NvbEVycm9yYCBvbiBpbnZhbGlkIGlucHV0LiAqL1xyXG5leHBvcnQgZnVuY3Rpb24gYmFzZTY0VG9CeXRlcyhlbmNvZGVkOiBzdHJpbmcpOiBVaW50OEFycmF5IHtcclxuICBsZXQgYmluYXJ5OiBzdHJpbmc7XHJcbiAgdHJ5IHtcclxuICAgIGJpbmFyeSA9IGF0b2IoZW5jb2RlZCk7XHJcbiAgfSBjYXRjaCAoY2F1c2UpIHtcclxuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKCdCYXNlNjQgcGF5bG9hZCBpcyBub3QgdmFsaWQnLCB7IGNhdXNlIH0pO1xyXG4gIH1cclxuICBjb25zdCBieXRlcyA9IG5ldyBVaW50OEFycmF5KGJpbmFyeS5sZW5ndGgpO1xyXG4gIGZvciAobGV0IGkgPSAwOyBpIDwgYmluYXJ5Lmxlbmd0aDsgaSsrKSBieXRlc1tpXSA9IGJpbmFyeS5jaGFyQ29kZUF0KGkpO1xyXG4gIHJldHVybiBieXRlcztcclxufVxyXG4iLCAiLyoqXG4gKiBDb25mbGljdC1jb3B5IGZpbGUgbmFtaW5nIChBUkNISVRFQ1RVUkUubWQgXHUwMEE3NCwgRlItNikuXG4gKlxuICogV2hlbiBhIGRldmljZSBsb3NlcyBhIGNvbmZsaWN0IGJ1dCBpdHMgY29udGVudCBtdXN0IGJlIHByZXNlcnZlZCwgdGhlXG4gKiBjb250ZW50IGlzIGNvbW1pdHRlZCB0byBhIHNpYmxpbmcgXCJjb25mbGljdCBjb3B5XCIgcGF0aCBzaGFwZWQgbGlrZTpcbiAqXG4gKiAgICAgTm90ZSAoY29uZmxpY3QgMjAyNi0wOC0yMCAxNC0yMyAtIGZyb20gUGhvbmUpLm1kXG4gKiAgICAgXHUyNTE0XHUyNTAwIHN0ZW0gXHUyNTAwXHUyNTE4XHUyNTE0XHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwIFVUQyBkYXRlICsgSEgtbW0gXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTE4XHUyNTE0IGRldmljZSBcdTI1MThcdTI1MTRleHRcdTI1MThcbiAqXG4gKiBSdWxlczpcbiAqICAgLSB0aW1lc3RhbXAgaXMgYWx3YXlzIFVUQyAobmV2ZXIgYSBsb2NhbCB0aW1lem9uZSkgc28gZXZlcnkgY2xpZW50XG4gKiAgICAgY29tcHV0ZXMgdGhlIGlkZW50aWNhbCBuYW1lIGZyb20gdGhlIHNhbWUgY29tbWl0IHRpbWU7XG4gKiAgIC0gdGhlIGRldmljZSBuYW1lIGlzIHNhbml0aXplZCBmb3IgZmlsZXN5c3RlbSBzYWZldHkgKHNlZVxuICogICAgIGBzYW5pdGl6ZURldmljZU5hbWVgKTtcbiAqICAgLSB0aGUgb3JpZ2luYWwgZXh0ZW5zaW9uIGlzIHByZXNlcnZlZCAobGFzdCBkb3QgaW4gdGhlIGJhc2VuYW1lLCBhcyBsb25nXG4gKiAgICAgYXMgaXQgaXMgbm90IHRoZSBmaXJzdCBjaGFyYWN0ZXIgXHUyMDE0IGAuZ2l0aWdub3JlYCBoYXMgbm8gZXh0ZW5zaW9uKTtcbiAqICAgLSBpZiB0aGUgY2FuZGlkYXRlIGFscmVhZHkgZXhpc3RzIChpbiB0aGUgbG9jYWwgaW5kZXggb3IgdGhlIHJlbW90ZVxuICogICAgIG1hbmlmZXN0IFx1MjAxNCB0aGUgY2FsbGVyIHN1cHBsaWVzIHRoZSBgZXhpc3RzYCBwcmVkaWNhdGUpLCBgIDJgLCBgIDNgLCBcdTIwMjZcbiAqICAgICBpcyBhcHBlbmRlZCBiZWZvcmUgdGhlIGV4dGVuc2lvbi5cbiAqL1xuXG5pbXBvcnQgeyBiYXNlbmFtZSwgbm9ybWFsaXplVmF1bHRQYXRoLCBwYXJlbnRQYXRoIH0gZnJvbSAnLi9wYXRocy5qcyc7XG5cbi8qKiBDaGFyYWN0ZXJzIGZvcmJpZGRlbiBvbiBhdCBsZWFzdCBvbmUgc3VwcG9ydGVkIHBsYXRmb3JtLiAqL1xuY29uc3QgSUxMRUdBTF9GSUxFTkFNRV9DSEFSUyA9IC9bPD46XCIvXFxcXHw/Kl0vZztcbi8qKiBDMCBjb250cm9scyArIERFTCBcdTIwMTQgbmV2ZXIgdmFsaWQgaW4gZmlsZW5hbWVzLiAqL1xuY29uc3QgQ09OVFJPTF9DSEFSUyA9IC9bXFx4MDAtXFx4MWZcXHg3Zl0vZztcblxuLyoqIE1heCBsZW5ndGggKGluIGNvZGUgcG9pbnRzKSBvZiBhIHNhbml0aXplZCBkZXZpY2UgbmFtZS4gKi9cbmNvbnN0IE1BWF9ERVZJQ0VfTkFNRV9MRU5HVEggPSAzMDtcblxuLyoqIEZhbGxiYWNrIHdoZW4gYSBkZXZpY2UgbmFtZSBzYW5pdGl6ZXMgdG8gbm90aGluZy4gKi9cbmNvbnN0IEZBTExCQUNLX0RFVklDRV9OQU1FID0gJ3Vua25vd24nO1xuXG4vKiogSGlnaGVzdCBgIE5gIHN1ZmZpeCB0cmllZCBiZWZvcmUgZ2l2aW5nIHVwLiAqL1xuY29uc3QgTUFYX0NPTExJU0lPTl9TVUZGSVggPSA5OTk7XG5cbi8qKlxuICogU2FuaXRpemUgYSBkZXZpY2UgbmFtZSBmb3IgdXNlIGluc2lkZSBhIGZpbGVuYW1lOiBzdHJpcCBgPD46XCIvXFxcXHw/KmAgYW5kXG4gKiBjb250cm9sIGNoYXJhY3RlcnMsIHRyaW0gd2hpdGVzcGFjZSBhbmQgZWRnZSBkb3RzIChXaW5kb3dzIHNlZ21lbnRzIG1heVxuICogbm90IGVuZCB3aXRoIGAuYCBvciB3aGl0ZXNwYWNlKSwgdHJ1bmNhdGUgdG8gMzAgY29kZSBwb2ludHMgKG5ldmVyIHNwbGl0c1xuICogYSBzdXJyb2dhdGUgcGFpcikuIFJldHVybnMgYCd1bmtub3duJ2Agd2hlbiBub3RoaW5nIHN1cnZpdmVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gc2FuaXRpemVEZXZpY2VOYW1lKG5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIGxldCBjbGVhbmVkID0gbmFtZS5yZXBsYWNlKElMTEVHQUxfRklMRU5BTUVfQ0hBUlMsICcnKS5yZXBsYWNlKENPTlRST0xfQ0hBUlMsICcnKTtcbiAgY2xlYW5lZCA9IFsuLi5jbGVhbmVkXS5zbGljZSgwLCBNQVhfREVWSUNFX05BTUVfTEVOR1RIKS5qb2luKCcnKTtcbiAgY2xlYW5lZCA9IGNsZWFuZWQudHJpbSgpLnJlcGxhY2UoL15bLlxcc10rfFsuXFxzXSskL2csICcnKTtcbiAgcmV0dXJuIGNsZWFuZWQubGVuZ3RoID09PSAwID8gRkFMTEJBQ0tfREVWSUNFX05BTUUgOiBjbGVhbmVkO1xufVxuXG4vKipcbiAqIENvbXB1dGUgdGhlIGNvbmZsaWN0LWNvcHkgcGF0aCBmb3IgYHBhdGhgLlxuICpcbiAqIFB1cmUgYW5kIGRldGVybWluaXN0aWM6IHRoZSBzYW1lIGAocGF0aCwgZGV2aWNlTmFtZSwgbm93LCBleGlzdHMpYCBhbHdheXNcbiAqIHlpZWxkcyB0aGUgc2FtZSByZXN1bHQuIGBub3dgIGlzIHRoZSBjb25mbGljdCdzIGVwb2NoLW1zIHRpbWVzdGFtcCAodGhlXG4gKiBjYWxsZXIgcGFzc2VzIGl0IGluIFx1MjAxNCBubyBoaWRkZW4gY2xvY2tzKTsgYGV4aXN0c2AgaXMgY29uc3VsdGVkIGZvclxuICogY29sbGlzaW9uIGF2b2lkYW5jZSBhbmQgdHlwaWNhbGx5IGNoZWNrcyB0aGUgbG9jYWwgaW5kZXggcGx1cyB0aGUgcmVtb3RlXG4gKiBtYW5pZmVzdC5cbiAqXG4gKiBUaHJvd3Mgd2hlbiBtb3JlIHRoYW4gYE1BWF9DT0xMSVNJT05fU1VGRklYYCBuYW1lIGNvbGxpc2lvbnMgb2NjdXIgKGFcbiAqIGdlbnVpbmVseSBwYXRob2xvZ2ljYWwgdmF1bHQgc3RhdGUgdGhlIGNhbGxlciBzaG91bGQgc3VyZmFjZSwgbm90IHBhcGVyXG4gKiBvdmVyKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvbmZsaWN0Q29weVBhdGgoXG4gIHBhdGg6IHN0cmluZyxcbiAgZGV2aWNlTmFtZTogc3RyaW5nLFxuICBub3c6IG51bWJlcixcbiAgZXhpc3RzOiAoY2FuZGlkYXRlUGF0aDogc3RyaW5nKSA9PiBib29sZWFuID0gKCkgPT4gZmFsc2UsXG4pOiBzdHJpbmcge1xuICBjb25zdCBub3JtYWxpemVkID0gbm9ybWFsaXplVmF1bHRQYXRoKHBhdGgpO1xuICBjb25zdCBkaXIgPSBwYXJlbnRQYXRoKG5vcm1hbGl6ZWQpO1xuICBjb25zdCBuYW1lID0gYmFzZW5hbWUobm9ybWFsaXplZCk7XG5cbiAgY29uc3QgbGFzdERvdCA9IG5hbWUubGFzdEluZGV4T2YoJy4nKTtcbiAgY29uc3QgaGFzRXh0ZW5zaW9uID0gbGFzdERvdCA+IDA7IC8vIGEgbGVhZGluZyBkb3QgbWFya3MgYSBkb3RmaWxlLCBub3QgYW4gZXh0ZW5zaW9uXG4gIGNvbnN0IHN0ZW0gPSBoYXNFeHRlbnNpb24gPyBuYW1lLnNsaWNlKDAsIGxhc3REb3QpIDogbmFtZTtcbiAgY29uc3QgZXh0ZW5zaW9uID0gaGFzRXh0ZW5zaW9uID8gbmFtZS5zbGljZShsYXN0RG90KSA6ICcnO1xuXG4gIGNvbnN0IHN1ZmZpeCA9IGAgKGNvbmZsaWN0ICR7Zm9ybWF0Q29uZmxpY3RTdGFtcChub3cpfSAtIGZyb20gJHtzYW5pdGl6ZURldmljZU5hbWUoZGV2aWNlTmFtZSl9KWA7XG4gIGNvbnN0IGpvaW4gPSAoZmlsZU5hbWU6IHN0cmluZyk6IHN0cmluZyA9PiAoZGlyID09PSAnLycgPyBgLyR7ZmlsZU5hbWV9YCA6IGAke2Rpcn0vJHtmaWxlTmFtZX1gKTtcblxuICBsZXQgY2FuZGlkYXRlID0gam9pbihgJHtzdGVtfSR7c3VmZml4fSR7ZXh0ZW5zaW9ufWApO1xuICBmb3IgKGxldCBuID0gMjsgbiA8PSBNQVhfQ09MTElTSU9OX1NVRkZJWDsgbisrKSB7XG4gICAgaWYgKCFleGlzdHMoY2FuZGlkYXRlKSkgcmV0dXJuIGNhbmRpZGF0ZTtcbiAgICBjYW5kaWRhdGUgPSBqb2luKGAke3N0ZW19JHtzdWZmaXh9ICR7bn0ke2V4dGVuc2lvbn1gKTtcbiAgfVxuICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgYGNvbmZsaWN0Q29weVBhdGg6IG1vcmUgdGhhbiAke01BWF9DT0xMSVNJT05fU1VGRklYfSBjb2xsaXNpb25zIGZvciAke0pTT04uc3RyaW5naWZ5KG5vcm1hbGl6ZWQpfWAsXG4gICk7XG59XG5cbi8qKiBgMjAyNi0wOC0yMCAxNC0yM2AgXHUyMDE0IFVUQyBkYXRlLCBzcGFjZSwgemVyby1wYWRkZWQgSEgtbW0uIE1pbnV0ZXMsIG5vdCBzZWNvbmRzLiAqL1xuZnVuY3Rpb24gZm9ybWF0Q29uZmxpY3RTdGFtcChub3c6IG51bWJlcik6IHN0cmluZyB7XG4gIGNvbnN0IGQgPSBuZXcgRGF0ZShub3cpO1xuICBjb25zdCBwYWQgPSAobjogbnVtYmVyKTogc3RyaW5nID0+IFN0cmluZyhuKS5wYWRTdGFydCgyLCAnMCcpO1xuICByZXR1cm4gKFxuICAgIGAke2QuZ2V0VVRDRnVsbFllYXIoKX0tJHtwYWQoZC5nZXRVVENNb250aCgpICsgMSl9LSR7cGFkKGQuZ2V0VVRDRGF0ZSgpKX1gICtcbiAgICBgICR7cGFkKGQuZ2V0VVRDSG91cnMoKSl9LSR7cGFkKGQuZ2V0VVRDTWludXRlcygpKX1gXG4gICk7XG59XG4iLCAiLyoqXHJcbiAqIFRocmVlLXdheSByZWNvbmNpbGlhdGlvbiAoQVJDSElURUNUVVJFLm1kIFx1MDBBNzggc3RlcCA0KS5cclxuICpcclxuICogYGNvbXB1dGVTeW5jUGxhbmAgaXMgYSBQVVJFLCBERVRFUk1JTklTVElDIGZ1bmN0aW9uOiB0aGUgc2FtZSBpbnB1dHMgYWx3YXlzXHJcbiAqIHByb2R1Y2UgdGhlIHNhbWUgcGxhbiAobWFuaWZlc3QgYW5kIGNoYW5nZSBidWNrZXRzIGFyZSByZS1zb3J0ZWRcclxuICogaW50ZXJuYWxseTsgYG5vd2AgaXMgYSBwYXJhbWV0ZXIsIG5ldmVyIHJlYWQgZnJvbSBhIGNsb2NrKS4gSXQgY29tcGFyZXNcclxuICogdGhyZWUgc3RhdGVzIGZvciBldmVyeSBwYXRoOlxyXG4gKlxyXG4gKiAgIC0gdGhlICoqbG9jYWwgaW5kZXgqKiBcdTIwMTQgd2hhdCB0aGlzIGRldmljZSBsYXN0IGtuZXcgYXMgYXV0aG9yaXRhdGl2ZVxyXG4gKiAgICAgKHRoZSBcImNvbW1vbiBhbmNlc3RvclwiIG9mIHRoZSB0aHJlZS13YXkgbWVyZ2UpO1xyXG4gKiAgIC0gdGhlICoqbG9jYWwgY2hhbmdlcyoqIFx1MjAxNCBob3cgbG9jYWwgc3RvcmFnZSBkaXZlcmdlZCBmcm9tIHRoZSBpbmRleFxyXG4gKiAgICAgd2hpbGUgb2ZmbGluZSAoYHNjYW4udHNgIG91dHB1dCk7XHJcbiAqICAgLSB0aGUgKiptYW5pZmVzdCoqIFx1MjAxNCB0aGUgYXV0aG9yaXR5J3MgY3VycmVudCBoZWFkIHBlciBwYXRoLlxyXG4gKlxyXG4gKiBhbmQgZW1pdHMgYSBgU3luY1BsYW5gIChzaGFwZSBkb2N1bWVudGVkIG9uIHRoZSBpbnRlcmZhY2UpOiBvcHMgdG8gcHVzaCxcclxuICogb3BzIHRvIHB1bGwsIGNvbmZsaWN0IHJlc29sdXRpb25zLCBhbmQgZm9sZGVyIHBsYWNlaG9sZGVycyB0byBwdXNoLlxyXG4gKlxyXG4gKiBDb25mbGljdCBhcmJpdHJhdGlvbiBtaXJyb3JzIHRoZSBETydzIHJ1bGUgKFx1MDBBNzQpOiB3aW5uZXIgPSBoaWdoZXIgbG9naWNhbFxyXG4gKiBjbG9jazsgdGllIFx1MjE5MiBncmVhdGVyIGRldmljZUlkLiBUaGUgbG9jYWwgc2lkZSdzICp0ZW50YXRpdmUqIGNsb2NrIGlzXHJcbiAqIGBuZXh0Q2xvY2soaW5kZXggY2xvY2ssIHRoaXNEZXZpY2VJZClgIFx1MjAxNCBleGFjdGx5IHRoZSBjb3VudGVyIHRoZSBETyB3b3VsZFxyXG4gKiBhc3NpZ24gYSBjb21taXQgYnVpbGRpbmcgb24gdGhlIHNhbWUgcGFyZW50LCBzbyB0aGUgY2xpZW50J3MgcHJlZGljdGlvblxyXG4gKiBtYXRjaGVzIHRoZSBzZXJ2ZXIncyBhcmJpdHJhdGlvbi4gV2hlbiB0aGUgcmVtb3RlIHNpZGUgd2lucywgdGhlIGxvc2luZ1xyXG4gKiBsb2NhbCBjb250ZW50IGlzIHByZXNlcnZlZCBieSBwdXNoaW5nIGl0IHRvIGEgY29uZmxpY3QtY29weSBwYXRoXHJcbiAqIChgY29uZmxpY3RuYW1lcy50c2ApOyB3aGVuIHRoZSBsb2NhbCBzaWRlIHdpbnMsIHRoZSBjbGllbnQgc2ltcGx5IGNvbW1pdHNcclxuICogd2l0aCBpdHMgKG5vdyBzdGFsZSkgcGFyZW50IHZlcnNpb24gYW5kIGxldHMgdGhlIHNlcnZlciBhcmJpdHJhdGUgXHUyMDE0IHRoZVxyXG4gKiBzZXJ2ZXIgc3ludGhlc2l6ZXMgYW55IGNvbmZsaWN0IGNvcHkgZm9yIHRoZSBsb3NpbmcgcmVtb3RlIGNvbnRlbnQsIHdoaWNoXHJcbiAqIGFycml2ZXMgbGF0ZXIgYXMgYW4gb3JkaW5hcnkgY2hhbmdlIGV2ZW50LlxyXG4gKi9cclxuXHJcbmltcG9ydCB7IGNvbXBhcmVDbG9ja3MsIG5leHRDbG9jayB9IGZyb20gJy4vY2xvY2suanMnO1xyXG5pbXBvcnQgeyBjb25mbGljdENvcHlQYXRoIH0gZnJvbSAnLi9jb25mbGljdG5hbWVzLmpzJztcclxuaW1wb3J0IHR5cGUgeyBMb2NhbEluZGV4LCBMb2NhbEluZGV4RW50cnkgfSBmcm9tICcuL2xvY2FsaW5kZXguanMnO1xyXG5pbXBvcnQgeyBwYXJlbnRQYXRoIH0gZnJvbSAnLi9wYXRocy5qcyc7XHJcbmltcG9ydCB0eXBlIHsgTWFuaWZlc3RFbnRyeSB9IGZyb20gJy4vcHJvdG9jb2wuanMnO1xyXG5pbXBvcnQgdHlwZSB7IERlbGV0ZWRDYW5kaWRhdGUsIExvY2FsQ2hhbmdlcywgUmVuYW1lQ2FuZGlkYXRlLCBTY2FuQ2FuZGlkYXRlIH0gZnJvbSAnLi9zY2FuLmpzJztcclxuaW1wb3J0IHR5cGUgeyBMb2dpY2FsQ2xvY2sgfSBmcm9tICcuL3R5cGVzLmpzJztcclxuXHJcbi8qKlxyXG4gKiBBIG1hbmlmZXN0IGVudHJ5IGFzIHJlY29uY2lsaWF0aW9uIGNvbnN1bWVzIGl0LiBTaW5jZSBgTWFuaWZlc3RFbnRyeWAgZ3Jld1xyXG4gKiBgcGF0aGAsIGBjbG9ja2AsIGFuZCBgaXNGb2xkZXJgIChwcm90b2NvbCB2MSwgcHJlLXJlbGVhc2UpLCB0aGlzIGlzIG5vdyB0aGVcclxuICogbWFuaWZlc3QgZW50cnkgaXRzZWxmIFx1MjAxNCBrZXB0IGFzIGEgbmFtZWQgYWxpYXMgc28gYGNvbXB1dGVTeW5jUGxhbmAncyBpbnB1dFxyXG4gKiBjb250cmFjdCBzdGF5cyBzZWxmLWRvY3VtZW50aW5nLlxyXG4gKi9cclxuZXhwb3J0IHR5cGUgUmVtb3RlRmlsZSA9IE1hbmlmZXN0RW50cnk7XHJcblxyXG4vKiogSW5wdXQgdG8gYGNvbXB1dGVTeW5jUGxhbmAuICovXHJcbmV4cG9ydCBpbnRlcmZhY2UgU3luY1BsYW5JbnB1dCB7XHJcbiAgbG9jYWxDaGFuZ2VzOiBMb2NhbENoYW5nZXM7XHJcbiAgaW5kZXg6IExvY2FsSW5kZXg7XHJcbiAgbWFuaWZlc3Q6IHJlYWRvbmx5IFJlbW90ZUZpbGVbXTtcclxuICB0aGlzRGV2aWNlSWQ6IHN0cmluZztcclxuICAvKiogSHVtYW4tcmVhZGFibGUgbmFtZSBvZiB0aGlzIGRldmljZSBcdTIwMTQgdXNlZCBpbiBjb25mbGljdC1jb3B5IGZpbGUgbmFtZXMuICovXHJcbiAgdGhpc0RldmljZU5hbWU6IHN0cmluZztcclxuICAvKiogRXBvY2ggbXMgdXNlZCBmb3IgY29uZmxpY3QtY29weSB0aW1lc3RhbXBzIChwYXNzZWQgaW4gZm9yIGRldGVybWluaXNtKS4gKi9cclxuICBub3c6IG51bWJlcjtcclxufVxyXG5cclxuLyoqIFdoeSBhIHBhdGggd2VudCB0aHJvdWdoIGNvbmZsaWN0IHJlc29sdXRpb24uICovXHJcbmV4cG9ydCB0eXBlIENvbmZsaWN0UmVhc29uID0gJ2NvbmN1cnJlbnQtZWRpdCcgfCAnYWRkLXZzLWFkZCcgfCAnZGVsZXRlLXZzLWVkaXQnIHwgJ3JlbmFtZS1yYWNlJztcclxuXHJcbi8qKlxyXG4gKiBBIGNvbW1pdCB0aGlzIGRldmljZSBzaG91bGQgc2VuZCAocGF5bG9hZCBvZiBhIHByb3RvY29sIGBjb21taXRgIG1lc3NhZ2UpLlxyXG4gKlxyXG4gKiBgcGFyZW50VmVyc2lvbmAgc2VtYW50aWNzOlxyXG4gKiAgIC0gbG9jYWwtb25seSBjaGFuZ2VzIGFuZCBsb2NhbC13aW5zIGNvbmZsaWN0cyBuYW1lIHRoZSAqaW5kZXgqIGhlYWQgKG9yXHJcbiAqICAgICBgbnVsbGAgZm9yIGJyYW5kLW5ldyBwYXRocykgXHUyMDE0IGRlbGliZXJhdGVseSBzdGFsZSB3aGVuIGEgY29uZmxpY3Qgd2FzXHJcbiAqICAgICBwcmVkaWN0ZWQsIHNvIHRoZSBETyBhcmJpdHJhdGVzIGFuZCBwcmVzZXJ2ZXMgdGhlIGxvc2luZyByZW1vdGVcclxuICogICAgIGNvbnRlbnQgc2VydmVyLXNpZGU7XHJcbiAqICAgLSBjb25mbGljdC1jb3B5IHB1c2hlcyBuYW1lIHRoZSAqcmVtb3RlKiBoZWFkIChmYXN0LXBhdGg6IHRoZXkgYnVpbGQgb25cclxuICogICAgIHRoZSB3aW5uZXIgYW5kIG11c3Qgbm90IHJlLWNvbmZsaWN0KS5cclxuICovXHJcbmV4cG9ydCBpbnRlcmZhY2UgUHVzaEZpbGVPcCB7XHJcbiAga2luZDogJ2FkZCcgfCAnZWRpdCcgfCAnZGVsZXRlJyB8ICdyZXN0b3JlJyB8ICdjb25mbGljdENvcHknO1xyXG4gIHBhdGg6IHN0cmluZztcclxuICBwYXJlbnRWZXJzaW9uOiBzdHJpbmcgfCBudWxsO1xyXG4gIC8qKiBDb250ZW50IGhhc2g7IGRlbGV0ZSBvcHMgcmV1c2UgdGhlIGRlbGV0ZWQgY29udGVudCdzIGhhc2guICovXHJcbiAgaGFzaDogc3RyaW5nO1xyXG4gIHNpemU6IG51bWJlcjtcclxuICAvKiogVHJ1ZSBmb3IgZm9sZGVyLXRvbWJzdG9uZSBkZWxldGVzIChgaGFzaCAnJ2AsIHNpemUgMCkgXHUyMDE0IEZSLTEwIGxpZmVjeWNsZS4gKi9cclxuICBpc0ZvbGRlcj86IGJvb2xlYW47XHJcbn1cclxuXHJcbi8qKiBBIGxvY2FsIHJlbmFtZSB0byBjb21taXQgYXMgb25lIGNoYWluIG1pZ3JhdGlvbiAoRlItOSkuICovXHJcbmV4cG9ydCBpbnRlcmZhY2UgUHVzaFJlbmFtZU9wIHtcclxuICBraW5kOiAncmVuYW1lJztcclxuICBmcm9tUGF0aDogc3RyaW5nO1xyXG4gIHRvUGF0aDogc3RyaW5nO1xyXG4gIC8qKiBWZXJzaW9uIG9mIHRoZSBgZnJvbVBhdGhgIGhlYWQgdGhpcyByZW5hbWUgYnVpbGRzIG9uLiAqL1xyXG4gIHBhcmVudFZlcnNpb246IHN0cmluZyB8IG51bGw7XHJcbiAgaGFzaDogc3RyaW5nO1xyXG4gIHNpemU6IG51bWJlcjtcclxufVxyXG5cclxuZXhwb3J0IHR5cGUgUHVzaE9wID0gUHVzaEZpbGVPcCB8IFB1c2hSZW5hbWVPcDtcclxuXHJcbi8qKiBSZW1vdGUgY29udGVudCB0aGlzIGRldmljZSBzaG91bGQgZmV0Y2ggYW5kIG1hdGVyaWFsaXplIHZpYSBgYXBwbHlQdWxsYC4gKi9cclxuZXhwb3J0IGludGVyZmFjZSBQdWxsRmlsZU9wIHtcclxuICBraW5kOiAnYWRkJyB8ICdlZGl0JyB8ICdkZWxldGUnIHwgJ3Jlc3RvcmUnO1xyXG4gIHBhdGg6IHN0cmluZztcclxuICBoYXNoOiBzdHJpbmc7XHJcbiAgc2l6ZTogbnVtYmVyO1xyXG4gIHZlcnNpb246IHN0cmluZztcclxuICBjbG9jazogTG9naWNhbENsb2NrO1xyXG4gIC8qKiBUcnVlIGZvciB0b21ic3RvbmVzIChraW5kIGAnZGVsZXRlJ2ApLiAqL1xyXG4gIGRlbGV0ZWQ6IGJvb2xlYW47XHJcbiAgLyoqIFRydWUgZm9yIGVtcHR5LWZvbGRlciBwbGFjZWhvbGRlciBwdWxscyAoRlItMTApIFx1MjAxNCBtYXRlcmlhbGl6ZSB3aXRoIGBlbnN1cmVEaXJgLiAqL1xyXG4gIGlzRm9sZGVyPzogYm9vbGVhbjtcclxufVxyXG5cclxuLyoqIEEgcmVtb3RlIHJlbmFtZSB0byBmb2xsb3cgbG9jYWxseSAoZGV0ZWN0ZWQgYnkgaGFzaCBjb3JyZWxhdGlvbikuICovXHJcbmV4cG9ydCBpbnRlcmZhY2UgUHVsbFJlbmFtZU9wIHtcclxuICBraW5kOiAncmVuYW1lJztcclxuICBmcm9tUGF0aDogc3RyaW5nO1xyXG4gIHRvUGF0aDogc3RyaW5nO1xyXG4gIGhhc2g6IHN0cmluZztcclxuICBzaXplOiBudW1iZXI7XHJcbiAgdmVyc2lvbjogc3RyaW5nO1xyXG4gIGNsb2NrOiBMb2dpY2FsQ2xvY2s7XHJcbiAgLyoqXHJcbiAgICogVHJ1ZSB3aGVuIHRoZSByZW5hbWVkIGhlYWQgaXMgYSBmb2xkZXIgcGxhY2Vob2xkZXIgKEZSLTEwKTogdGhlIG9wIG1vdmVzXHJcbiAgICogRElSRUNUT1JZIG1ldGFkYXRhIG9ubHkgXHUyMDE0IGBoYXNoYCBpcyBgJydgIGFuZCBtdXN0IG5ldmVyIHJlYWNoIGEgY29udGVudFxyXG4gICAqIGZldGNoIChgZW5naW5lLnRzYCkuXHJcbiAgICovXHJcbiAgaXNGb2xkZXI/OiBib29sZWFuO1xyXG59XHJcblxyXG5leHBvcnQgdHlwZSBQdWxsT3AgPSBQdWxsRmlsZU9wIHwgUHVsbFJlbmFtZU9wO1xyXG5cclxuLyoqXHJcbiAqIE9uZSBhcmJpdHJhdGVkIGNvbmZsaWN0LiBgbG9zZXJDb250ZW50YCBpcyBgJ25vbmUnYCB3aGVuIHRoZSBsb3Npbmcgc2lkZVxyXG4gKiB3YXMgYSBkZWxldGlvbiAobm90aGluZyB0byBwcmVzZXJ2ZSkuIFdoZW4gdGhlIGxvY2FsIGNvbnRlbnQgbG9zdCBhbmQgaGFkXHJcbiAqIGNvbnRlbnQsIGBjb25mbGljdENvcHlQYXRoYCBuYW1lcyB3aGVyZSB0aGUgcGxhbiBwcmVzZXJ2ZXMgaXQgKHRoZSBwdXNoXHJcbiAqIGl0c2VsZiBpcyBpbiBgU3luY1BsYW4ucHVzaGVzYCB3aXRoIGtpbmQgYCdjb25mbGljdENvcHknYCkuXHJcbiAqL1xyXG5leHBvcnQgaW50ZXJmYWNlIENvbmZsaWN0T3Age1xyXG4gIHBhdGg6IHN0cmluZztcclxuICByZWFzb246IENvbmZsaWN0UmVhc29uO1xyXG4gIHdpbm5lcjogJ2xvY2FsJyB8ICdyZW1vdGUnO1xyXG4gIGxvc2VyQ29udGVudDogJ2xvY2FsJyB8ICdyZW1vdGUnIHwgJ25vbmUnO1xyXG4gIGNvbmZsaWN0Q29weVBhdGg/OiBzdHJpbmc7XHJcbiAgcmVtb3RlOiB7IHZlcnNpb246IHN0cmluZzsgaGFzaDogc3RyaW5nOyBzaXplOiBudW1iZXI7IGRlbGV0ZWQ6IGJvb2xlYW47IGNsb2NrOiBMb2dpY2FsQ2xvY2sgfTtcclxuICAvKiogVGhlIHRlbnRhdGl2ZSBjbG9jayB0aGUgbG9jYWwgc2lkZSB3YXMgYXJiaXRyYXRlZCB3aXRoLiAqL1xyXG4gIGxvY2FsQ2xvY2s6IExvZ2ljYWxDbG9jaztcclxufVxyXG5cclxuLyoqXHJcbiAqIFRoZSBjb21wbGV0ZSByZWNvbmNpbGlhdGlvbiByZXN1bHQgZm9yIG9uZSBzeW5jIGN5Y2xlLiBPcHMgYXJlIHNvcnRlZCBieVxyXG4gKiB0YXJnZXQgcGF0aCAocmVuYW1lcyBieSBgdG9QYXRoYCk7IHRoZSBzb2xlIGV4Y2VwdGlvbjogd2l0aGluIGEgcGFpciBvZlxyXG4gKiBwdWxsIHRhcmdldHMgZGlmZmVyaW5nIG9ubHkgYnkgbmFtZSBjYXNlLCBkZWxldGVzIHNvcnQgYmVmb3JlIHdyaXRlcyAoc2VlXHJcbiAqIGBjb21wYXJlUHVsbE9wc2AgXHUyMDE0IGNhc2UtaW5zZW5zaXRpdmUtZmlsZXN5c3RlbSBzYWZldHkpLiBFdmVyeSBhcnJheSBtYXkgYmVcclxuICogZW1wdHkuIGBwdXNoZXNgIGFuZFxyXG4gKiBgcHVsbHNgIGFyZSBpbmRlcGVuZGVudCBcdTIwMTQgYSBwYXRoIGFwcGVhcnMgYXQgbW9zdCBvbmNlIGluIGVhY2guIFB1c2hlcyBhcmVcclxuICogTk9UIGFwcGxpZWQgdG8gdGhlIGxvY2FsIGluZGV4IHVudGlsIHRoZSBzZXJ2ZXIgYWNrcyB0aGVtOyBwdWxscyBhcmVcclxuICogYXBwbGllZCBieSBgYXBwbHlQdWxsYCAoYGVuZ2luZS50c2ApLlxyXG4gKi9cclxuZXhwb3J0IGludGVyZmFjZSBTeW5jUGxhbiB7XHJcbiAgLyoqIENvbW1pdHMgdG8gc2VuZCwgaW4gb3JkZXIuICovXHJcbiAgcHVzaGVzOiBQdXNoT3BbXTtcclxuICAvKiogUmVtb3RlIGNoYW5nZXMgdG8gbWF0ZXJpYWxpemUsIGluIG9yZGVyLiAqL1xyXG4gIHB1bGxzOiBQdWxsT3BbXTtcclxuICAvKiogQ29uZmxpY3RzIHRoYXQgd2VyZSBhcmJpdHJhdGVkIChpbmZvcm1hdGlvbmFsOyBzaWRlIGVmZmVjdHMgbGl2ZSBpbiBwdXNoZXMvcHVsbHMpLiAqL1xyXG4gIGNvbmZsaWN0czogQ29uZmxpY3RPcFtdO1xyXG4gIC8qKiBFbXB0eS1mb2xkZXIgcGxhY2Vob2xkZXIgcGF0aHMgdG8gY3JlYXRlIHJlbW90ZWx5IChGUi0xMCkuICovXHJcbiAgZm9sZGVyUHVzaGVzOiBzdHJpbmdbXTtcclxufVxyXG5cclxuLyoqIEludGVybmFsOiBhIGxvY2FsIGNhbmRpZGF0ZSAoYWRkZWQvbW9kaWZpZWQvZGVsZXRlZCkgdW5pZmllZCBmb3IgcmVzb2x1dGlvbi4gKi9cclxuaW50ZXJmYWNlIExvY2FsQ2FuZGlkYXRlIHtcclxuICBwYXRoOiBzdHJpbmc7XHJcbiAga2luZDogJ2FkZCcgfCAnZWRpdCcgfCAncmVzdG9yZScgfCAnZGVsZXRlJztcclxuICBoYXNoOiBzdHJpbmc7XHJcbiAgc2l6ZTogbnVtYmVyO1xyXG4gIC8qKiBGb2xkZXItcGxhY2Vob2xkZXIgZGVsZXRpb25zIChgc2Nhbi5mb2xkZXJEZWxldGlvbnNgKSByZXNvbHZlIGFzIHRvbWJzdG9uZXMuICovXHJcbiAgaXNGb2xkZXI/OiBib29sZWFuO1xyXG59XHJcblxyXG5jb25zdCBaRVJPX0NMT0NLOiBMb2dpY2FsQ2xvY2sgPSB7IGNvdW50ZXI6IDAsIGRldmljZUlkOiAnJyB9O1xyXG5cclxuLyoqXHJcbiAqIENvbXB1dGUgdGhlIHN5bmMgcGxhbi4gU2VlIHRoZSBtb2R1bGUgZG9jIGZvciB0aGUgbW9kZWwgYW5kIHRoZSBvcFxyXG4gKiBzZW1hbnRpY3MuIFRocm93cyBub3RoaW5nIG9uIG9yZGluYXJ5IGRpdmVyZ2VuY2UgXHUyMDE0IGNvbmZsaWN0cyBhcmUgZGF0YSxcclxuICogbm90IGVycm9ycy5cclxuICovXHJcbmV4cG9ydCBmdW5jdGlvbiBjb21wdXRlU3luY1BsYW4oaW5wdXQ6IFN5bmNQbGFuSW5wdXQpOiBTeW5jUGxhbiB7XHJcbiAgY29uc3QgeyBsb2NhbENoYW5nZXMsIGluZGV4LCB0aGlzRGV2aWNlSWQsIHRoaXNEZXZpY2VOYW1lLCBub3cgfSA9IGlucHV0O1xyXG4gIGNvbnN0IG1hbmlmZXN0ID0gWy4uLmlucHV0Lm1hbmlmZXN0XS5zb3J0KChhLCBiKSA9PiBjb21wYXJlU3RyaW5ncyhhLnBhdGgsIGIucGF0aCkpO1xyXG4gIGNvbnN0IG1hbmlmZXN0QnlQYXRoID0gbmV3IE1hcChtYW5pZmVzdC5tYXAoKGVudHJ5KSA9PiBbZW50cnkucGF0aCwgZW50cnldKSk7XHJcblxyXG4gIGNvbnN0IHB1c2hlczogUHVzaE9wW10gPSBbXTtcclxuICBjb25zdCBwdWxsczogUHVsbE9wW10gPSBbXTtcclxuICBjb25zdCBjb25mbGljdHM6IENvbmZsaWN0T3BbXSA9IFtdO1xyXG5cclxuICAvLyBFdmVyeSBwYXRoIHRoZSBsb2NhbCBzaWRlIGRpdmVyZ2VkIG9uIChzY2FuIGJ1Y2tldHMgKyBib3RoIGVuZHMgb2YgcmVuYW1lcykuXHJcbiAgY29uc3QgbG9jYWxQYXRocyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xyXG4gIGZvciAoY29uc3QgYyBvZiBsb2NhbENoYW5nZXMuYWRkZWQpIGxvY2FsUGF0aHMuYWRkKGMucGF0aCk7XHJcbiAgZm9yIChjb25zdCBjIG9mIGxvY2FsQ2hhbmdlcy5tb2RpZmllZCkgbG9jYWxQYXRocy5hZGQoYy5wYXRoKTtcclxuICBmb3IgKGNvbnN0IGQgb2YgbG9jYWxDaGFuZ2VzLmRlbGV0ZWQpIGxvY2FsUGF0aHMuYWRkKGQucGF0aCk7XHJcbiAgZm9yIChjb25zdCByIG9mIGxvY2FsQ2hhbmdlcy5yZW5hbWVkKSB7XHJcbiAgICBsb2NhbFBhdGhzLmFkZChyLmZyb20pO1xyXG4gICAgbG9jYWxQYXRocy5hZGQoci50byk7XHJcbiAgfVxyXG4gIGZvciAoY29uc3QgZiBvZiBsb2NhbENoYW5nZXMuZm9sZGVyRGVsZXRpb25zKSBsb2NhbFBhdGhzLmFkZChmLnBhdGgpO1xyXG5cclxuICAvLyBQYXRocyBhbHJlYWR5IGNvbnN1bWVkIGJ5IGFuIGVhcmxpZXIgcGhhc2UgKHJlbmFtZSBjb3JyZWxhdGlvbiBldGMuKS5cclxuICBjb25zdCBjb25zdW1lZCA9IG5ldyBTZXQ8c3RyaW5nPigpO1xyXG5cclxuICBjb25zdCBwYXRoRXhpc3RzID0gKHBhdGg6IHN0cmluZyk6IGJvb2xlYW4gPT4gcGF0aCBpbiBpbmRleCB8fCBtYW5pZmVzdEJ5UGF0aC5oYXMocGF0aCk7XHJcblxyXG4gIC8vIC0tLSBQaGFzZSBBOiBsb2NhbCByZW5hbWVzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG4gIC8vIFVuY29udGVzdGVkOiBvbmUgUHVzaFJlbmFtZU9wLiBDb250ZXN0ZWQgKHJlbW90ZSBjaGFuZ2VkIGF0IGVpdGhlciBlbmQpOlxyXG4gIC8vIGRlY29tcG9zZSBcdTIwMTQgdGhlIGBmcm9tYCBzaWRlIGlzIHJlc29sdmVkIG9uIGl0cyBvd24gKHVzdWFsbHkgdG9tYnN0b25lZFxyXG4gIC8vIG9yIHB1bGxlZCksIHRoZSByZW5hbWVkIGNvbnRlbnQgaXMgcGxhY2VkIGF0IGB0b2AgdGhyb3VnaCB0aGUgZ2VuZXJpY1xyXG4gIC8vIGNvbnRlbnQgbWFjaGluZXJ5LiBDb250ZW50IGlzIG5ldmVyIGxvc3QgZWl0aGVyIHdheS5cclxuICBmb3IgKGNvbnN0IHJlbmFtZSBvZiBbLi4ubG9jYWxDaGFuZ2VzLnJlbmFtZWRdLnNvcnQoKGEsIGIpID0+IGNvbXBhcmVTdHJpbmdzKGEuZnJvbSwgYi5mcm9tKSkpIHtcclxuICAgIGNvbnN0IGluZGV4RnJvbSA9IGluZGV4W3JlbmFtZS5mcm9tXTtcclxuICAgIGNvbnN0IGluZGV4VG8gPSBpbmRleFtyZW5hbWUudG9dO1xyXG4gICAgY29uc3QgcmVtb3RlRnJvbSA9IG1hbmlmZXN0QnlQYXRoLmdldChyZW5hbWUuZnJvbSk7XHJcbiAgICBjb25zdCByZW1vdGVUbyA9IG1hbmlmZXN0QnlQYXRoLmdldChyZW5hbWUudG8pO1xyXG5cclxuICAgIGNvbnN0IGZyb21DaGFuZ2VkID0gcmVtb3RlRnJvbVxyXG4gICAgICA/IHJlbW90ZUVudHJ5Q2hhbmdlZChpbmRleEZyb20sIHJlbW90ZUZyb20pXHJcbiAgICAgIDogaW5kZXhGcm9tPy5kZWxldGVkQXQgPT09IHVuZGVmaW5lZDsgLy8gYWJzZW50IHJlbW90ZWx5ICsgbGl2ZSBsb2NhbGx5IFx1MjFEMiBjaGFuZ2VkXHJcbiAgICBjb25zdCB0b0NoYW5nZWQgPSByZW1vdGVUb1xyXG4gICAgICA/IHJlbW90ZUVudHJ5Q2hhbmdlZChpbmRleFRvLCByZW1vdGVUbylcclxuICAgICAgOiBmYWxzZTsgLy8gYWJzZW50IHJlbW90ZWx5IFx1MjFEMiBub3RoaW5nIHRvIHJhY2UgYXQgYHRvYFxyXG5cclxuICAgIGlmICghZnJvbUNoYW5nZWQgJiYgIXRvQ2hhbmdlZCkge1xyXG4gICAgICBwdXNoZXMucHVzaCh7XHJcbiAgICAgICAga2luZDogJ3JlbmFtZScsXHJcbiAgICAgICAgZnJvbVBhdGg6IHJlbmFtZS5mcm9tLFxyXG4gICAgICAgIHRvUGF0aDogcmVuYW1lLnRvLFxyXG4gICAgICAgIHBhcmVudFZlcnNpb246IGluZGV4RnJvbT8udmVyc2lvbklkID8/IG51bGwsXHJcbiAgICAgICAgaGFzaDogcmVuYW1lLmhhc2gsXHJcbiAgICAgICAgc2l6ZTogcmVuYW1lLnNpemUsXHJcbiAgICAgIH0pO1xyXG4gICAgICBjb250aW51ZTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBgZnJvbWAgc2lkZSBvZiBhIGNvbnRlc3RlZCByZW5hbWU6XHJcbiAgICBpZiAoIWZyb21DaGFuZ2VkKSB7XHJcbiAgICAgIC8vIE5vdGhpbmcgcmVtb3RlIHRoZXJlIFx1MjAxNCB0aGUgbW92ZSBpdHNlbGYgcmVtb3ZlcyB0aGUgb2xkIHBhdGguXHJcbiAgICAgIGlmIChpbmRleEZyb20gJiYgaW5kZXhGcm9tLmRlbGV0ZWRBdCA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgcHVzaGVzLnB1c2goe1xyXG4gICAgICAgICAga2luZDogJ2RlbGV0ZScsXHJcbiAgICAgICAgICBwYXRoOiByZW5hbWUuZnJvbSxcclxuICAgICAgICAgIHBhcmVudFZlcnNpb246IGluZGV4RnJvbS52ZXJzaW9uSWQsXHJcbiAgICAgICAgICBoYXNoOiBpbmRleEZyb20uaGFzaCxcclxuICAgICAgICAgIHNpemU6IGluZGV4RnJvbS5zaXplLFxyXG4gICAgICAgIH0pO1xyXG4gICAgICB9XHJcbiAgICB9IGVsc2UgaWYgKCFyZW1vdGVGcm9tIHx8IHJlbW90ZUZyb20uZGVsZXRlZCkge1xyXG4gICAgICAvLyBSZW1vdGUgZGVsZXRlZCAob3IgbWlncmF0ZWQgYXdheSBmcm9tKSBgZnJvbWAgXHUyMDE0IGRlbGV0aW9uIHN0YW5kcyBmb3JcclxuICAgICAgLy8gdGhlIG9sZCBwYXRoOyB0aGUgcmVuYW1lZCBjb250ZW50IHN1cnZpdmVzIGF0IGB0b2AuXHJcbiAgICAgIHB1bGxzLnB1c2goXHJcbiAgICAgICAgcHVsbEZpbGUoJ2RlbGV0ZScsIHJlbmFtZS5mcm9tLCB7XHJcbiAgICAgICAgICBoYXNoOiByZW1vdGVGcm9tPy5oYXNoID8/IGluZGV4RnJvbT8uaGFzaCA/PyByZW5hbWUuaGFzaCxcclxuICAgICAgICAgIHNpemU6IHJlbW90ZUZyb20/LnNpemUgPz8gaW5kZXhGcm9tPy5zaXplID8/IHJlbmFtZS5zaXplLFxyXG4gICAgICAgICAgdmVyc2lvbjogcmVtb3RlRnJvbT8udmVyc2lvbiA/PyAnJyxcclxuICAgICAgICAgIGNsb2NrOiByZW1vdGVGcm9tPy5jbG9jayA/PyBpbmRleEZyb20/LmNsb2NrID8/IFpFUk9fQ0xPQ0ssXHJcbiAgICAgICAgICBkZWxldGVkOiB0cnVlLFxyXG4gICAgICAgIH0pLFxyXG4gICAgICApO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgLy8gUmVtb3RlIGVkaXRlZCBgZnJvbWAuIFRoZSByZW1vdGUgZWRpdCBrZWVwcyB0aGUgb2xkIHBhdGg7IHRoZSBtb3ZlZFxyXG4gICAgICAvLyBjb250ZW50IGlzIHBsYWNlZCBhdCBgdG9gIGJlbG93IFx1MjAxNCBhIHJlbmFtZS1yYWNlIHRoZSBsb2NhbCBzaWRlXHJcbiAgICAgIC8vIGNvbmNlZGVzIHVubGVzcyBpdHMgY2xvY2sgd2lucyB0aGUgcmVuYW1lIHB1c2guXHJcbiAgICAgIGNvbnN0IGxvY2FsQ2xvY2sgPSBuZXh0Q2xvY2soaW5kZXhGcm9tPy5jbG9jaywgdGhpc0RldmljZUlkKTtcclxuICAgICAgaWYgKGNvbXBhcmVDbG9ja3MocmVtb3RlRnJvbS5jbG9jaywgbG9jYWxDbG9jaykgPiAwKSB7XHJcbiAgICAgICAgcHVsbHMucHVzaChwdWxsRmlsZSgnZWRpdCcsIHJlbmFtZS5mcm9tLCByZW1vdGVGcm9tKSk7XHJcbiAgICAgICAgY29uZmxpY3RzLnB1c2goe1xyXG4gICAgICAgICAgcGF0aDogcmVuYW1lLmZyb20sXHJcbiAgICAgICAgICByZWFzb246ICdyZW5hbWUtcmFjZScsXHJcbiAgICAgICAgICB3aW5uZXI6ICdyZW1vdGUnLFxyXG4gICAgICAgICAgLy8gTG9jYWwgY29udGVudCBpcyBwcmVzZXJ2ZWQgYnkgdGhlIHJlbmFtZSBpdHNlbGYgKHB1c2hlZCBhdCBgdG9gKS5cclxuICAgICAgICAgIGxvc2VyQ29udGVudDogJ2xvY2FsJyxcclxuICAgICAgICAgIHJlbW90ZTogcmVtb3RlU3VtbWFyeShyZW1vdGVGcm9tKSxcclxuICAgICAgICAgIGxvY2FsQ2xvY2ssXHJcbiAgICAgICAgfSk7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgcHVzaGVzLnB1c2goe1xyXG4gICAgICAgICAga2luZDogJ3JlbmFtZScsXHJcbiAgICAgICAgICBmcm9tUGF0aDogcmVuYW1lLmZyb20sXHJcbiAgICAgICAgICB0b1BhdGg6IHJlbmFtZS50byxcclxuICAgICAgICAgIHBhcmVudFZlcnNpb246IGluZGV4RnJvbT8udmVyc2lvbklkID8/IG51bGwsXHJcbiAgICAgICAgICBoYXNoOiByZW5hbWUuaGFzaCxcclxuICAgICAgICAgIHNpemU6IHJlbmFtZS5zaXplLFxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGNvbmZsaWN0cy5wdXNoKHtcclxuICAgICAgICAgIHBhdGg6IHJlbmFtZS5mcm9tLFxyXG4gICAgICAgICAgcmVhc29uOiAncmVuYW1lLXJhY2UnLFxyXG4gICAgICAgICAgd2lubmVyOiAnbG9jYWwnLFxyXG4gICAgICAgICAgbG9zZXJDb250ZW50OiAncmVtb3RlJyxcclxuICAgICAgICAgIHJlbW90ZTogcmVtb3RlU3VtbWFyeShyZW1vdGVGcm9tKSxcclxuICAgICAgICAgIGxvY2FsQ2xvY2ssXHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgY29udGludWU7IC8vIHRoZSByZW5hbWUgcHVzaCBjYXJyaWVzIHRoZSBjb250ZW50OyBubyBgdG9gIG9wIG5lZWRlZFxyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgLy8gYHRvYCBzaWRlIG9mIGEgY29udGVzdGVkIHJlbmFtZTpcclxuICAgIGlmICghdG9DaGFuZ2VkKSB7XHJcbiAgICAgIHB1c2hlcy5wdXNoKHtcclxuICAgICAgICBraW5kOiBpbmRleFRvPy5kZWxldGVkQXQgIT09IHVuZGVmaW5lZCA/ICdyZXN0b3JlJyA6ICdhZGQnLFxyXG4gICAgICAgIHBhdGg6IHJlbmFtZS50byxcclxuICAgICAgICBwYXJlbnRWZXJzaW9uOiBpbmRleFRvPy52ZXJzaW9uSWQgPz8gbnVsbCxcclxuICAgICAgICBoYXNoOiByZW5hbWUuaGFzaCxcclxuICAgICAgICBzaXplOiByZW5hbWUuc2l6ZSxcclxuICAgICAgfSk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICByZXNvbHZlQ29udGVzdGVkUGF0aChyZW5hbWUudG8sIGluZGV4VG8sIHJlbW90ZVRvIGFzIFJlbW90ZUZpbGUsIHtcclxuICAgICAgICBwYXRoOiByZW5hbWUudG8sXHJcbiAgICAgICAga2luZDogaW5kZXhUbz8uZGVsZXRlZEF0ICE9PSB1bmRlZmluZWQgPyAncmVzdG9yZScgOiAnYWRkJyxcclxuICAgICAgICBoYXNoOiByZW5hbWUuaGFzaCxcclxuICAgICAgICBzaXplOiByZW5hbWUuc2l6ZSxcclxuICAgICAgfSk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvLyAtLS0gUGhhc2UgQjogcmVtb3RlIHJlbmFtZXMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuICAvLyBBIHBhdGggbGl2ZSBpbiB0aGUgaW5kZXggYnV0IEFCU0VOVCBmcm9tIHRoZSBtYW5pZmVzdCB3YXMgbWlncmF0ZWQgYnkgdGhlXHJcbiAgLy8gYXV0aG9yaXR5ICh0b21ic3RvbmVzIGFwcGVhciBpbiB0aGUgbWFuaWZlc3Qgd2l0aCBkZWxldGVkOnRydWUgXHUyMDE0IG9ubHkgYVxyXG4gIC8vIHJlbmFtZSByZW1vdmVzIGEgcGF0aCkuIENvcnJlbGF0ZSBieSBjb250ZW50IGhhc2ggYWdhaW5zdCBuZXcgbWFuaWZlc3RcclxuICAvLyBwYXRocywgc2FtZS1wYXJlbnQgcHJlZmVycmVkLCBzbWFsbGVzdCBwYXRoIHdpdGhpbiBhIHByZWZlcmVuY2UgY2xhc3MuXHJcbiAgZm9yIChjb25zdCBmcm9tIG9mIE9iamVjdC5rZXlzKGluZGV4KVxyXG4gICAgLmZpbHRlcigocCkgPT4ge1xyXG4gICAgICBjb25zdCBlbnRyeSA9IGluZGV4W3BdIGFzIExvY2FsSW5kZXhFbnRyeTtcclxuICAgICAgcmV0dXJuIGVudHJ5LmRlbGV0ZWRBdCA9PT0gdW5kZWZpbmVkICYmICFlbnRyeS5pc0ZvbGRlcjtcclxuICAgIH0pXHJcbiAgICAuc29ydChjb21wYXJlU3RyaW5ncykpIHtcclxuICAgIGlmIChsb2NhbFBhdGhzLmhhcyhmcm9tKSB8fCBjb25zdW1lZC5oYXMoZnJvbSkpIGNvbnRpbnVlO1xyXG4gICAgaWYgKG1hbmlmZXN0QnlQYXRoLmhhcyhmcm9tKSkgY29udGludWU7IC8vIHByZXNlbnQgKGxpdmUgb3IgdG9tYnN0b25lZCkgXHUyMUQyIG5vdCBtaWdyYXRlZFxyXG4gICAgY29uc3QgZW50cnkgPSBpbmRleFtmcm9tXSBhcyBMb2NhbEluZGV4RW50cnk7XHJcblxyXG4gICAgbGV0IGJlc3Q6IFJlbW90ZUZpbGUgfCB1bmRlZmluZWQ7XHJcbiAgICBsZXQgYmVzdFNhbWVEaXIgPSBmYWxzZTtcclxuICAgIGZvciAoY29uc3QgY2FuZGlkYXRlIG9mIG1hbmlmZXN0KSB7XHJcbiAgICAgIGlmIChjYW5kaWRhdGUuZGVsZXRlZCkgY29udGludWU7XHJcbiAgICAgIGlmIChsb2NhbFBhdGhzLmhhcyhjYW5kaWRhdGUucGF0aCkgfHwgY29uc3VtZWQuaGFzKGNhbmRpZGF0ZS5wYXRoKSkgY29udGludWU7XHJcbiAgICAgIGNvbnN0IGtub3duID0gaW5kZXhbY2FuZGlkYXRlLnBhdGhdO1xyXG4gICAgICBpZiAoa25vd24gIT09IHVuZGVmaW5lZCAmJiBrbm93bi5kZWxldGVkQXQgPT09IHVuZGVmaW5lZCkgY29udGludWU7IC8vIHRhcmdldCBub3QgbmV3XHJcbiAgICAgIGlmIChjYW5kaWRhdGUuaGFzaCAhPT0gZW50cnkuaGFzaCkgY29udGludWU7XHJcbiAgICAgIGNvbnN0IHNhbWVEaXIgPSBwYXJlbnRQYXRoKGNhbmRpZGF0ZS5wYXRoKSA9PT0gcGFyZW50UGF0aChmcm9tKTtcclxuICAgICAgaWYgKGJlc3QgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIGJlc3QgPSBjYW5kaWRhdGU7XHJcbiAgICAgICAgYmVzdFNhbWVEaXIgPSBzYW1lRGlyO1xyXG4gICAgICB9IGVsc2UgaWYgKHNhbWVEaXIgJiYgIWJlc3RTYW1lRGlyKSB7XHJcbiAgICAgICAgYmVzdCA9IGNhbmRpZGF0ZTtcclxuICAgICAgICBiZXN0U2FtZURpciA9IHRydWU7XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBpZiAoYmVzdCkge1xyXG4gICAgICBwdWxscy5wdXNoKHtcclxuICAgICAgICBraW5kOiAncmVuYW1lJyxcclxuICAgICAgICBmcm9tUGF0aDogZnJvbSxcclxuICAgICAgICB0b1BhdGg6IGJlc3QucGF0aCxcclxuICAgICAgICBoYXNoOiBiZXN0Lmhhc2gsXHJcbiAgICAgICAgc2l6ZTogYmVzdC5zaXplLFxyXG4gICAgICAgIHZlcnNpb246IGJlc3QudmVyc2lvbixcclxuICAgICAgICBjbG9jazogYmVzdC5jbG9jayxcclxuICAgICAgfSk7XHJcbiAgICAgIGNvbnN1bWVkLmFkZChmcm9tKTtcclxuICAgICAgY29uc3VtZWQuYWRkKGJlc3QucGF0aCk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICAvLyBBYnNlbnQgd2l0aG91dCBjb3JyZWxhdGlvbjogdGhlIGF1dGhvcml0eSBubyBsb25nZXIga25vd3MgdGhlIHBhdGguXHJcbiAgICAgIC8vIFRyZWF0IGFzIGEgcmVtb3RlIGRlbGV0ZSB3aXRoIHVua25vd24gaGVhZCB2ZXJzaW9uICgnJyBcdTIwMTQgdGhlIG5leHRcclxuICAgICAgLy8gZnVsbCBtYW5pZmVzdCBoZWFscyB0aGUgdmVyc2lvbiBpZCkuIFRoaXMgYWxzbyBjb3ZlcnMgcmVtb3RlXHJcbiAgICAgIC8vIHJlbmFtZStlZGl0LCB3aGljaCBnZW51aW5lbHkgaXMgZGVsZXRlICsgYWRkLlxyXG4gICAgICBwdWxscy5wdXNoKFxyXG4gICAgICAgIHB1bGxGaWxlKCdkZWxldGUnLCBmcm9tLCB7XHJcbiAgICAgICAgICBoYXNoOiBlbnRyeS5oYXNoLFxyXG4gICAgICAgICAgc2l6ZTogZW50cnkuc2l6ZSxcclxuICAgICAgICAgIHZlcnNpb246ICcnLFxyXG4gICAgICAgICAgY2xvY2s6IGVudHJ5LmNsb2NrLFxyXG4gICAgICAgICAgZGVsZXRlZDogdHJ1ZSxcclxuICAgICAgICB9KSxcclxuICAgICAgKTtcclxuICAgICAgY29uc3VtZWQuYWRkKGZyb20pO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgLy8gLS0tIFBoYXNlIEM6IHJlbWFpbmluZyByZW1vdGUtb25seSBjaGFuZ2VzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcbiAgZm9yIChjb25zdCByZW1vdGUgb2YgbWFuaWZlc3QpIHtcclxuICAgIGlmIChsb2NhbFBhdGhzLmhhcyhyZW1vdGUucGF0aCkgfHwgY29uc3VtZWQuaGFzKHJlbW90ZS5wYXRoKSkgY29udGludWU7XHJcbiAgICBjb25zdCBlbnRyeSA9IGluZGV4W3JlbW90ZS5wYXRoXTtcclxuICAgIGlmICghcmVtb3RlRW50cnlDaGFuZ2VkKGVudHJ5LCByZW1vdGUpKSBjb250aW51ZTtcclxuICAgIGlmIChlbnRyeSA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgIGlmICghcmVtb3RlLmRlbGV0ZWQpIHtcclxuICAgICAgICBwdWxscy5wdXNoKHB1bGxGaWxlKCdhZGQnLCByZW1vdGUucGF0aCwgcmVtb3RlKSk7XHJcbiAgICAgICAgY29uc3VtZWQuYWRkKHJlbW90ZS5wYXRoKTtcclxuICAgICAgfVxyXG4gICAgICAvLyBkZWxldGVkICsgbmV2ZXIga25vd24gbG9jYWxseSBcdTIxRDIgbm90aGluZyB0byBkb1xyXG4gICAgICBjb250aW51ZTtcclxuICAgIH1cclxuICAgIGlmIChyZW1vdGUuZGVsZXRlZCkge1xyXG4gICAgICBwdWxscy5wdXNoKHB1bGxGaWxlKCdkZWxldGUnLCByZW1vdGUucGF0aCwgcmVtb3RlKSk7IC8vIGluY2x1ZGVzIHRvbWJzdG9uZVx1MjE5MnRvbWJzdG9uZSB2ZXJzaW9uIGNhdGNoLXVwXHJcbiAgICB9IGVsc2UgaWYgKGVudHJ5LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgIHB1bGxzLnB1c2gocHVsbEZpbGUoJ3Jlc3RvcmUnLCByZW1vdGUucGF0aCwgcmVtb3RlKSk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICBwdWxscy5wdXNoKHB1bGxGaWxlKCdlZGl0JywgcmVtb3RlLnBhdGgsIHJlbW90ZSkpO1xyXG4gICAgfVxyXG4gICAgY29uc3VtZWQuYWRkKHJlbW90ZS5wYXRoKTtcclxuICB9XHJcblxyXG4gIC8vIC0tLSBQaGFzZSBEOiBsb2NhbCBjYW5kaWRhdGVzIChsb2NhbC1vbmx5IHB1c2hlcyArIGJvdGgtY2hhbmdlZCkgLS0tLS0tLVxyXG4gIGNvbnN0IGNhbmRpZGF0ZXM6IExvY2FsQ2FuZGlkYXRlW10gPSBbXHJcbiAgICAuLi5sb2NhbENoYW5nZXMuYWRkZWQubWFwKChjKSA9PiAoeyAuLi5jLCBraW5kOiAnYWRkJyBhcyBjb25zdCB9KSksXHJcbiAgICAuLi5sb2NhbENoYW5nZXMubW9kaWZpZWQubWFwKChjKSA9PiAoe1xyXG4gICAgICAuLi5jLFxyXG4gICAgICBraW5kOiBpbmRleFtjLnBhdGhdPy5kZWxldGVkQXQgIT09IHVuZGVmaW5lZCA/ICgncmVzdG9yZScgYXMgY29uc3QpIDogKCdlZGl0JyBhcyBjb25zdCksXHJcbiAgICB9KSksXHJcbiAgICAuLi5sb2NhbENoYW5nZXMuZGVsZXRlZC5tYXAoKGQpOiBMb2NhbENhbmRpZGF0ZSA9PiAoeyAuLi5kLCBraW5kOiAnZGVsZXRlJyB9KSksXHJcbiAgICAvLyBGb2xkZXIgcGxhY2Vob2xkZXJzIHdob3NlIGRpcmVjdG9yeSB2YW5pc2hlZDogdG9tYnN0b25lIHB1c2hlcy4gVGhleVxyXG4gICAgLy8gY2Fycnkgbm8gY29udGVudCAoaGFzaCAnJy9zaXplIDApIGFuZCBjYW4gbmV2ZXIgcGFpciB3aXRoIGFuIGFkZCwgc29cclxuICAgIC8vIHRoZXkgam9pbiBoZXJlIHJhdGhlciB0aGFuIHRoZSBgZGVsZXRlZGAgYnVja2V0IChyZW5hbWUgY29ycmVsYXRpb24sXHJcbiAgICAvLyBjb25mbGljdCBjb3BpZXMgXHUyMDE0IG5laXRoZXIgYXBwbGllcyB0byBwbGFjZWhvbGRlcnMpLlxyXG4gICAgLi4ubG9jYWxDaGFuZ2VzLmZvbGRlckRlbGV0aW9ucy5tYXAoXHJcbiAgICAgIChmKTogTG9jYWxDYW5kaWRhdGUgPT4gKHtcclxuICAgICAgICBwYXRoOiBmLnBhdGgsXHJcbiAgICAgICAga2luZDogJ2RlbGV0ZScsXHJcbiAgICAgICAgaGFzaDogJycsXHJcbiAgICAgICAgc2l6ZTogMCxcclxuICAgICAgICBpc0ZvbGRlcjogdHJ1ZSxcclxuICAgICAgfSksXHJcbiAgICApLFxyXG4gIF0uc29ydCgoYSwgYikgPT4gY29tcGFyZVN0cmluZ3MoYS5wYXRoLCBiLnBhdGgpKTtcclxuXHJcbiAgZm9yIChjb25zdCBjYW5kaWRhdGUgb2YgY2FuZGlkYXRlcykge1xyXG4gICAgY29uc3QgZW50cnkgPSBpbmRleFtjYW5kaWRhdGUucGF0aF07XHJcbiAgICBjb25zdCByZW1vdGUgPSBtYW5pZmVzdEJ5UGF0aC5nZXQoY2FuZGlkYXRlLnBhdGgpO1xyXG4gICAgY29uc3QgcmVtb3RlQ2hhbmdlZEhlcmUgPVxyXG4gICAgICByZW1vdGUgIT09IHVuZGVmaW5lZCAmJiAoZW50cnkgIT09IHVuZGVmaW5lZCA/IHJlbW90ZS52ZXJzaW9uICE9PSBlbnRyeS52ZXJzaW9uSWQgOiAhcmVtb3RlLmRlbGV0ZWQpO1xyXG4gICAgaWYgKCFyZW1vdGVDaGFuZ2VkSGVyZSkge1xyXG4gICAgICBwdXNoTG9jYWwoY2FuZGlkYXRlLCBlbnRyeSk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICByZXNvbHZlQ29udGVzdGVkUGF0aChjYW5kaWRhdGUucGF0aCwgZW50cnksIHJlbW90ZSBhcyBSZW1vdGVGaWxlLCBjYW5kaWRhdGUpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcmV0dXJuIHtcclxuICAgIHB1c2hlczogcHVzaGVzLnNvcnQoKGEsIGIpID0+IGNvbXBhcmVTdHJpbmdzKG9wUGF0aChhKSwgb3BQYXRoKGIpKSksXHJcbiAgICBwdWxsczogcHVsbHMuc29ydChjb21wYXJlUHVsbE9wcyksXHJcbiAgICBjb25mbGljdHM6IGNvbmZsaWN0cy5zb3J0KChhLCBiKSA9PiBjb21wYXJlU3RyaW5ncyhhLnBhdGgsIGIucGF0aCkpLFxyXG4gICAgZm9sZGVyUHVzaGVzOiBbLi4ubG9jYWxDaGFuZ2VzLmVtcHR5Rm9sZGVyc10uc29ydChjb21wYXJlU3RyaW5ncyksXHJcbiAgfTtcclxuXHJcbiAgLy8gLS0tIGhlbHBlcnMgKGNsb3NlIG92ZXIgdGhlIGFjY3VtdWxhdG9ycykgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblxyXG4gIGZ1bmN0aW9uIHB1c2hMb2NhbChjYW5kaWRhdGU6IExvY2FsQ2FuZGlkYXRlLCBlbnRyeTogTG9jYWxJbmRleEVudHJ5IHwgdW5kZWZpbmVkKTogdm9pZCB7XHJcbiAgICBpZiAoY2FuZGlkYXRlLmtpbmQgPT09ICdkZWxldGUnKSB7XHJcbiAgICAgIHB1c2hlcy5wdXNoKHtcclxuICAgICAgICBraW5kOiAnZGVsZXRlJyxcclxuICAgICAgICBwYXRoOiBjYW5kaWRhdGUucGF0aCxcclxuICAgICAgICBwYXJlbnRWZXJzaW9uOiBlbnRyeT8udmVyc2lvbklkID8/IG51bGwsXHJcbiAgICAgICAgaGFzaDogZW50cnk/Lmhhc2ggPz8gY2FuZGlkYXRlLmhhc2gsXHJcbiAgICAgICAgc2l6ZTogZW50cnk/LnNpemUgPz8gY2FuZGlkYXRlLnNpemUsXHJcbiAgICAgICAgLi4uKGNhbmRpZGF0ZS5pc0ZvbGRlciA/IHsgaXNGb2xkZXI6IHRydWUgfSA6IHt9KSxcclxuICAgICAgfSk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIHB1c2hlcy5wdXNoKHtcclxuICAgICAga2luZDogY2FuZGlkYXRlLmtpbmQsXHJcbiAgICAgIHBhdGg6IGNhbmRpZGF0ZS5wYXRoLFxyXG4gICAgICBwYXJlbnRWZXJzaW9uOiBlbnRyeT8udmVyc2lvbklkID8/IG51bGwsXHJcbiAgICAgIGhhc2g6IGNhbmRpZGF0ZS5oYXNoLFxyXG4gICAgICBzaXplOiBjYW5kaWRhdGUuc2l6ZSxcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQm90aCBzaWRlcyBjaGFuZ2VkIG9uZSBwYXRoLiBBcmJpdHJhdGUgcGVyIFx1MDBBNzQuIExvY2FsIGRlbGV0aW9ucyBuZXZlciBnZXRcclxuICAgKiBhIGNvbmZsaWN0IGNvcHkgKG5vIGNvbnRlbnQgdG8gcHJlc2VydmUpOyBsb2NhbCAqY29udGVudCogdGhhdCBsb3NlcyBpc1xyXG4gICAqIHByZXNlcnZlZCB2aWEgYSBjb25mbGljdC1jb3B5IHB1c2guXHJcbiAgICovXHJcbiAgZnVuY3Rpb24gcmVzb2x2ZUNvbnRlc3RlZFBhdGgoXHJcbiAgICBwYXRoOiBzdHJpbmcsXHJcbiAgICBlbnRyeTogTG9jYWxJbmRleEVudHJ5IHwgdW5kZWZpbmVkLFxyXG4gICAgcmVtb3RlOiBSZW1vdGVGaWxlLFxyXG4gICAgbG9jYWw6IExvY2FsQ2FuZGlkYXRlLFxyXG4gICk6IHZvaWQge1xyXG4gICAgY29uc3QgbG9jYWxDbG9jayA9IG5leHRDbG9jayhlbnRyeT8uY2xvY2ssIHRoaXNEZXZpY2VJZCk7XHJcbiAgICBjb25zdCByZW1vdGVXaW5zID0gY29tcGFyZUNsb2NrcyhyZW1vdGUuY2xvY2ssIGxvY2FsQ2xvY2spID4gMDsgLy8gMCBcdTIxRDIgbG9jYWwgKGRvY3VtZW50ZWQpXHJcbiAgICBjb25zdCBzdW1tYXJ5ID0gcmVtb3RlU3VtbWFyeShyZW1vdGUpO1xyXG4gICAgY29uc3QgcmVhc29uOiBDb25mbGljdFJlYXNvbiA9XHJcbiAgICAgIGxvY2FsLmtpbmQgPT09ICdkZWxldGUnIHx8IHJlbW90ZS5kZWxldGVkXHJcbiAgICAgICAgPyAnZGVsZXRlLXZzLWVkaXQnXHJcbiAgICAgICAgOiBlbnRyeSA9PT0gdW5kZWZpbmVkXHJcbiAgICAgICAgICA/ICdhZGQtdnMtYWRkJ1xyXG4gICAgICAgICAgOiAnY29uY3VycmVudC1lZGl0JztcclxuXHJcbiAgICBpZiAobG9jYWwua2luZCA9PT0gJ2RlbGV0ZScgJiYgcmVtb3RlLmRlbGV0ZWQpIHtcclxuICAgICAgLy8gQm90aCBkZWxldGVkIFx1MjAxNCBjb252ZXJnZSBzaWxlbnRseSBvbiB0aGUgcmVtb3RlIHRvbWJzdG9uZS5cclxuICAgICAgcHVsbHMucHVzaChwdWxsRmlsZSgnZGVsZXRlJywgcGF0aCwgcmVtb3RlKSk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBpZiAobG9jYWwua2luZCA9PT0gJ2RlbGV0ZScpIHtcclxuICAgICAgLy8gTG9jYWwgZGVsZXRlIHZzIHJlbW90ZSBlZGl0LlxyXG4gICAgICBpZiAocmVtb3RlV2lucykge1xyXG4gICAgICAgIHB1bGxzLnB1c2gocHVsbEZpbGUoJ2VkaXQnLCBwYXRoLCByZW1vdGUpKTsgLy8gZmlsZSBpcyByZWNyZWF0ZWRcclxuICAgICAgICBjb25mbGljdHMucHVzaCh7XHJcbiAgICAgICAgICBwYXRoLCByZWFzb24sIHdpbm5lcjogJ3JlbW90ZScsIGxvc2VyQ29udGVudDogJ25vbmUnLFxyXG4gICAgICAgICAgcmVtb3RlOiBzdW1tYXJ5LCBsb2NhbENsb2NrLFxyXG4gICAgICAgIH0pO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIHB1c2hlcy5wdXNoKHtcclxuICAgICAgICAgIGtpbmQ6ICdkZWxldGUnLFxyXG4gICAgICAgICAgcGF0aCxcclxuICAgICAgICAgIHBhcmVudFZlcnNpb246IGVudHJ5Py52ZXJzaW9uSWQgPz8gbnVsbCxcclxuICAgICAgICAgIGhhc2g6IGVudHJ5Py5oYXNoID8/IGxvY2FsLmhhc2gsXHJcbiAgICAgICAgICBzaXplOiBlbnRyeT8uc2l6ZSA/PyBsb2NhbC5zaXplLFxyXG4gICAgICAgICAgLi4uKGxvY2FsLmlzRm9sZGVyID8geyBpc0ZvbGRlcjogdHJ1ZSB9IDoge30pLFxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGNvbmZsaWN0cy5wdXNoKHtcclxuICAgICAgICAgIHBhdGgsIHJlYXNvbiwgd2lubmVyOiAnbG9jYWwnLCBsb3NlckNvbnRlbnQ6ICdyZW1vdGUnLFxyXG4gICAgICAgICAgcmVtb3RlOiBzdW1tYXJ5LCBsb2NhbENsb2NrLFxyXG4gICAgICAgIH0pO1xyXG4gICAgICB9XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBpZiAocmVtb3RlLmRlbGV0ZWQpIHtcclxuICAgICAgLy8gTG9jYWwgZWRpdCB2cyByZW1vdGUgZGVsZXRlLlxyXG4gICAgICBpZiAocmVtb3RlV2lucykge1xyXG4gICAgICAgIHB1bGxzLnB1c2gocHVsbEZpbGUoJ2RlbGV0ZScsIHBhdGgsIHJlbW90ZSkpO1xyXG4gICAgICAgIGNvbmZsaWN0cy5wdXNoKHtcclxuICAgICAgICAgIHBhdGgsIHJlYXNvbiwgd2lubmVyOiAncmVtb3RlJywgbG9zZXJDb250ZW50OiAnbG9jYWwnLFxyXG4gICAgICAgICAgY29uZmxpY3RDb3B5UGF0aDogcHVzaENvbmZsaWN0Q29weShwYXRoLCBsb2NhbCwgcmVtb3RlKSxcclxuICAgICAgICAgIHJlbW90ZTogc3VtbWFyeSwgbG9jYWxDbG9jayxcclxuICAgICAgICB9KTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBwdXNoZXMucHVzaCh7XHJcbiAgICAgICAgICBraW5kOiBsb2NhbC5raW5kLFxyXG4gICAgICAgICAgcGF0aCxcclxuICAgICAgICAgIHBhcmVudFZlcnNpb246IGVudHJ5Py52ZXJzaW9uSWQgPz8gbnVsbCxcclxuICAgICAgICAgIGhhc2g6IGxvY2FsLmhhc2gsXHJcbiAgICAgICAgICBzaXplOiBsb2NhbC5zaXplLFxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGNvbmZsaWN0cy5wdXNoKHtcclxuICAgICAgICAgIHBhdGgsIHJlYXNvbiwgd2lubmVyOiAnbG9jYWwnLCBsb3NlckNvbnRlbnQ6ICdub25lJyxcclxuICAgICAgICAgIHJlbW90ZTogc3VtbWFyeSwgbG9jYWxDbG9jayxcclxuICAgICAgICB9KTtcclxuICAgICAgfVxyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgLy8gQ29uY3VycmVudCBjb250ZW50IChlZGl0LXZzLWVkaXQgb3IgYWRkLXZzLWFkZCkuXHJcbiAgICBpZiAobG9jYWwuaGFzaCA9PT0gcmVtb3RlLmhhc2gpIHtcclxuICAgICAgLy8gQnl0ZS1pZGVudGljYWwgY29udGVudCBvbiBib3RoIHNpZGVzIChhIHNlY29uZCBkZXZpY2UgcGFpcmluZyBvdmVyXHJcbiAgICAgIC8vIGZpbGVzIGl0IGFscmVhZHkgaGFzLCBvciBib3RoIHNpZGVzIG1ha2luZyB0aGUgc2FtZSBlZGl0KTogbm90aGluZ1xyXG4gICAgICAvLyBkaXN0aW5jdCB0byBwcmVzZXJ2ZSwgc28gbm8gY29uZmxpY3QgcmVjb3JkIGFuZCBubyBjb3B5IFx1MjAxNCBjb252ZXJnZVxyXG4gICAgICAvLyBzaWxlbnRseSBvbiB0aGUgcmVtb3RlIGhlYWQgcmVnYXJkbGVzcyBvZiBjbG9jayBvcmRlciAobWlycm9ycyB0aGVcclxuICAgICAgLy8gc2VydmVyJ3MgYXJiaXRyYXRpb24sIHdoaWNoIHN5bnRoZXNpemVzIG5vIGNvcHkgZm9yIGlkZW50aWNhbCBjb250ZW50KS5cclxuICAgICAgcHVsbHMucHVzaChcclxuICAgICAgICBwdWxsRmlsZShlbnRyeT8uZGVsZXRlZEF0ICE9PSB1bmRlZmluZWQgPyAncmVzdG9yZScgOiBlbnRyeSA9PT0gdW5kZWZpbmVkID8gJ2FkZCcgOiAnZWRpdCcsIHBhdGgsIHJlbW90ZSksXHJcbiAgICAgICk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIGlmIChyZW1vdGVXaW5zKSB7XHJcbiAgICAgIHB1bGxzLnB1c2goXHJcbiAgICAgICAgcHVsbEZpbGUoZW50cnk/LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkID8gJ3Jlc3RvcmUnIDogZW50cnkgPT09IHVuZGVmaW5lZCA/ICdhZGQnIDogJ2VkaXQnLCBwYXRoLCByZW1vdGUpLFxyXG4gICAgICApO1xyXG4gICAgICBjb25mbGljdHMucHVzaCh7XHJcbiAgICAgICAgcGF0aCwgcmVhc29uLCB3aW5uZXI6ICdyZW1vdGUnLCBsb3NlckNvbnRlbnQ6ICdsb2NhbCcsXHJcbiAgICAgICAgY29uZmxpY3RDb3B5UGF0aDogcHVzaENvbmZsaWN0Q29weShwYXRoLCBsb2NhbCwgcmVtb3RlKSxcclxuICAgICAgICByZW1vdGU6IHN1bW1hcnksIGxvY2FsQ2xvY2ssXHJcbiAgICAgIH0pO1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgcHVzaGVzLnB1c2goe1xyXG4gICAgICAgIGtpbmQ6IGxvY2FsLmtpbmQsXHJcbiAgICAgICAgcGF0aCxcclxuICAgICAgICAvLyBEZWxpYmVyYXRlbHkgdGhlIChzdGFsZSkgaW5kZXggcGFyZW50OiB0aGUgRE8gbXVzdCBhcmJpdHJhdGUgYW5kXHJcbiAgICAgICAgLy8gc3ludGhlc2l6ZSB0aGUgY29uZmxpY3QgY29weSBmb3IgdGhlIGxvc2luZyByZW1vdGUgY29udGVudC5cclxuICAgICAgICBwYXJlbnRWZXJzaW9uOiBlbnRyeT8udmVyc2lvbklkID8/IG51bGwsXHJcbiAgICAgICAgaGFzaDogbG9jYWwuaGFzaCxcclxuICAgICAgICBzaXplOiBsb2NhbC5zaXplLFxyXG4gICAgICB9KTtcclxuICAgICAgY29uZmxpY3RzLnB1c2goe1xyXG4gICAgICAgIHBhdGgsIHJlYXNvbiwgd2lubmVyOiAnbG9jYWwnLCBsb3NlckNvbnRlbnQ6ICdyZW1vdGUnLFxyXG4gICAgICAgIHJlbW90ZTogc3VtbWFyeSwgbG9jYWxDbG9jayxcclxuICAgICAgfSk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBQdXNoIHRoZSBsb3NpbmcgbG9jYWwgY29udGVudCB0byBhIGNvbmZsaWN0LWNvcHkgcGF0aDsgcmV0dXJucyB0aGUgcGF0aCxcclxuICAgKiBvciBgdW5kZWZpbmVkYCB3aGVuIHRoZSBsb3NpbmcgY29udGVudCBpcyBieXRlLWlkZW50aWNhbCB0byB0aGUgd2lubmVyJ3NcclxuICAgKiAoYSBzYW1lLWNvbnRlbnQgcmFjZSBcdTIwMTQgbm90aGluZyBkaXN0aW5jdCB0byBwcmVzZXJ2ZTsgbWF0Y2hlcyB0aGUgc2VydmVyJ3NcclxuICAgKiBhcmJpdHJhdGlvbiwgd2hpY2ggbGlrZXdpc2Ugc3ludGhlc2l6ZXMgbm8gY29weSBmb3IgaWRlbnRpY2FsIGNvbnRlbnQpLlxyXG4gICAqL1xyXG4gIGZ1bmN0aW9uIHB1c2hDb25mbGljdENvcHkocGF0aDogc3RyaW5nLCBsb2NhbDogTG9jYWxDYW5kaWRhdGUsIHJlbW90ZTogUmVtb3RlRmlsZSk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XHJcbiAgICBpZiAobG9jYWwuaGFzaCA9PT0gcmVtb3RlLmhhc2gpIHJldHVybiB1bmRlZmluZWQ7XHJcbiAgICBjb25zdCBjb3B5UGF0aCA9IGNvbmZsaWN0Q29weVBhdGgocGF0aCwgdGhpc0RldmljZU5hbWUsIG5vdywgcGF0aEV4aXN0cyk7XHJcbiAgICBwdXNoZXMucHVzaCh7XHJcbiAgICAgIGtpbmQ6ICdjb25mbGljdENvcHknLFxyXG4gICAgICBwYXRoOiBjb3B5UGF0aCxcclxuICAgICAgLy8gQnVpbGQgb24gdGhlIHdpbm5pbmcgcmVtb3RlIGhlYWQ6IHRoaXMgcHVzaCBtdXN0IGZhc3QtcGF0aC5cclxuICAgICAgcGFyZW50VmVyc2lvbjogcmVtb3RlLnZlcnNpb24sXHJcbiAgICAgIGhhc2g6IGxvY2FsLmhhc2gsXHJcbiAgICAgIHNpemU6IGxvY2FsLnNpemUsXHJcbiAgICB9KTtcclxuICAgIHJldHVybiBjb3B5UGF0aDtcclxuICB9XHJcbn1cclxuXHJcbi8vIC0tLSBtb2R1bGUtbGV2ZWwgaGVscGVycyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHJcbmZ1bmN0aW9uIHB1bGxGaWxlKFxyXG4gIGtpbmQ6IFB1bGxGaWxlT3BbJ2tpbmQnXSxcclxuICBwYXRoOiBzdHJpbmcsXHJcbiAgcmVtb3RlOiBQaWNrPFJlbW90ZUZpbGUsICdoYXNoJyB8ICdzaXplJyB8ICd2ZXJzaW9uJyB8ICdjbG9jaycgfCAnaXNGb2xkZXInPiAmIHtcclxuICAgIGRlbGV0ZWQ/OiBib29sZWFuO1xyXG4gIH0sXHJcbik6IFB1bGxGaWxlT3Age1xyXG4gIHJldHVybiB7XHJcbiAgICBraW5kLFxyXG4gICAgcGF0aCxcclxuICAgIGhhc2g6IHJlbW90ZS5oYXNoLFxyXG4gICAgc2l6ZTogcmVtb3RlLnNpemUsXHJcbiAgICB2ZXJzaW9uOiByZW1vdGUudmVyc2lvbixcclxuICAgIGNsb2NrOiByZW1vdGUuY2xvY2ssXHJcbiAgICBkZWxldGVkOiByZW1vdGUuZGVsZXRlZCA/PyBraW5kID09PSAnZGVsZXRlJyxcclxuICAgIC4uLihyZW1vdGUuaXNGb2xkZXIgPyB7IGlzRm9sZGVyOiB0cnVlIH0gOiB7fSksXHJcbiAgfTtcclxufVxyXG5cclxuZnVuY3Rpb24gcmVtb3RlU3VtbWFyeShyZW1vdGU6IFJlbW90ZUZpbGUpOiBDb25mbGljdE9wWydyZW1vdGUnXSB7XHJcbiAgcmV0dXJuIHtcclxuICAgIHZlcnNpb246IHJlbW90ZS52ZXJzaW9uLFxyXG4gICAgaGFzaDogcmVtb3RlLmhhc2gsXHJcbiAgICBzaXplOiByZW1vdGUuc2l6ZSxcclxuICAgIGRlbGV0ZWQ6IHJlbW90ZS5kZWxldGVkLFxyXG4gICAgY2xvY2s6IHJlbW90ZS5jbG9jayxcclxuICB9O1xyXG59XHJcblxyXG4vKipcclxuICogV2hldGhlciB0aGUgcmVtb3RlIGhlYWQgZm9yIGEgcGF0aCBkaWZmZXJzIGZyb20gd2hhdCB0aGUgaW5kZXggcmVjb3Jkcy5cclxuICogVmVyc2lvbiBpZHMgYXJlIHRoZSBwcmltYXJ5IHNpZ25hbCAoY2xpZW50IGFuZCBETyBzaGFyZSBvbmUgaWQgc3BhY2UpO1xyXG4gKiBhIHBhdGggYWJzZW50IHJlbW90ZWx5IGNvdW50cyBhcyBjaGFuZ2VkIG9ubHkgd2hpbGUgdGhlIGluZGV4IHN0aWxsIGhvbGRzXHJcbiAqIGl0IGxpdmUgXHUyMDE0IGNhbGxlcnMgZGVjaWRlIHdoYXQgYWJzZW5jZSAqbWVhbnMqIChyZW5hbWUgdnMgZGVsZXRlKS5cclxuICovXHJcbmZ1bmN0aW9uIHJlbW90ZUVudHJ5Q2hhbmdlZChcclxuICBlbnRyeTogTG9jYWxJbmRleEVudHJ5IHwgdW5kZWZpbmVkLFxyXG4gIHJlbW90ZTogUmVtb3RlRmlsZSB8IHVuZGVmaW5lZCxcclxuKTogYm9vbGVhbiB7XHJcbiAgaWYgKHJlbW90ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gZmFsc2U7XHJcbiAgaWYgKGVudHJ5ID09PSB1bmRlZmluZWQpIHJldHVybiAhcmVtb3RlLmRlbGV0ZWQ7XHJcbiAgcmV0dXJuIHJlbW90ZS52ZXJzaW9uICE9PSBlbnRyeS52ZXJzaW9uSWQ7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIG9wUGF0aChvcDogUHVzaE9wIHwgUHVsbE9wKTogc3RyaW5nIHtcclxuICByZXR1cm4gb3Aua2luZCA9PT0gJ3JlbmFtZScgPyBvcC50b1BhdGggOiBvcC5wYXRoO1xyXG59XHJcblxyXG4vKipcclxuICogRGV0ZXJtaW5pc3RpYyBwdWxsIG9yZGVyIChieSB0YXJnZXQgcGF0aCksIHdpdGggT05FIGNhcnZlLW91dCBmb3JcclxuICogY2FzZS1pbnNlbnNpdGl2ZSBmaWxlc3lzdGVtcyAoV2luZG93cywgbWFjT1MpOiB3aGVuIHR3byBwdWxsIHRhcmdldHNcclxuICogZGlmZmVyIG9ubHkgYnkgbmFtZSBjYXNlIFx1MjAxNCBlLmcuIGEgcmVuYW1lK2VkaXQgdGhhdCBkZWNvbXBvc2VkIGludG9cclxuICogYHB1bGwgYWRkICcvTk9URS5tZCdgICsgYHB1bGwgZGVsZXRlICcvTm90ZS5tZCdgIFx1MjAxNCB0aGUgREVMRVRFIG11c3QgYXBwbHlcclxuICogZmlyc3QuIEFwcGxpZWQgYWRkLWZpcnN0LCB0aGUgYWRkJ3MgYXRvbWljIHRlbXArcmVuYW1lIHdyaXRlIHBoeXNpY2FsbHlcclxuICogcmVwbGFjZXMgdGhlIG9sZC1jYXNlIGZpbGUsIGFuZCB0aGUgc3Vic2VxdWVudCBkZWxldGUgdGhlbiBmaW5kcyBhbmRcclxuICogcmVtb3ZlcyB0aGUganVzdC13cml0dGVuIGZpbGUgKGFkYXB0ZXJzIHJlc29sdmUgcGF0aHMgY2FzZS1pbnNlbnNpdGl2ZWx5KSxcclxuICogbGVhdmluZyBkaXNrIGVtcHR5IHdoaWxlIHRoZSBpbmRleCBob2xkcyB0aGUgbmV3IHBhdGggbGl2ZSBcdTIwMTQgdGhlIG5leHQgc2NhblxyXG4gKiB3b3VsZCBwdXNoIHRoYXQgcGhhbnRvbSBkZWxldGlvbiB2YXVsdC13aWRlLiBEZWxldGUtZmlyc3QgaXMgc2FmZSBvbiBib3RoXHJcbiAqIGZpbGVzeXN0ZW0gY2xhc3Nlczogb24gYSBjYXNlLXNlbnNpdGl2ZSBhZGFwdGVyIHRoZSB0d28gcGF0aHMgYXJlIGRpc3RpbmN0XHJcbiAqIGZpbGVzLCBzbyByZWxhdGl2ZSBvcmRlciBkb2VzIG5vdCBtYXR0ZXI7IG9ubHkgdGhlIGNhc2UtY29sbGlkaW5nIHBhaXIgaXNcclxuICogcmVvcmRlcmVkLCBldmVyeSBvdGhlciBwYWlyIGtlZXBzIHRoZSBleGFjdC1wYXRoIHNvcnQuXHJcbiAqL1xyXG5mdW5jdGlvbiBjb21wYXJlUHVsbE9wcyhhOiBQdWxsT3AsIGI6IFB1bGxPcCk6IG51bWJlciB7XHJcbiAgY29uc3QgYnlFeGFjdCA9IGNvbXBhcmVTdHJpbmdzKG9wUGF0aChhKSwgb3BQYXRoKGIpKTtcclxuICBpZiAoYnlFeGFjdCA9PT0gMCkgcmV0dXJuIDA7XHJcbiAgaWYgKG9wUGF0aChhKS50b0xvd2VyQ2FzZSgpICE9PSBvcFBhdGgoYikudG9Mb3dlckNhc2UoKSkgcmV0dXJuIGJ5RXhhY3Q7XHJcbiAgLy8gQ2FzZS1jb2xsaWRpbmcgcGFpcjogZGVsZXRlcyBiZWZvcmUgd3JpdGVzIChhZGQvZWRpdC9yZW5hbWUvcmVzdG9yZSkuXHJcbiAgY29uc3QgYURlbGV0ZXMgPSBhLmtpbmQgPT09ICdkZWxldGUnO1xyXG4gIGNvbnN0IGJEZWxldGVzID0gYi5raW5kID09PSAnZGVsZXRlJztcclxuICBpZiAoYURlbGV0ZXMgIT09IGJEZWxldGVzKSByZXR1cm4gYURlbGV0ZXMgPyAtMSA6IDE7XHJcbiAgcmV0dXJuIGJ5RXhhY3Q7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGNvbXBhcmVTdHJpbmdzKGE6IHN0cmluZywgYjogc3RyaW5nKTogbnVtYmVyIHtcclxuICByZXR1cm4gYSA8IGIgPyAtMSA6IGEgPiBiID8gMSA6IDA7XHJcbn1cclxuIiwgIi8qKlxuICogTG9jYWwgY2hhbmdlIGRldGVjdGlvbiAoQVJDSElURUNUVVJFLm1kIFx1MDBBNzggc3RlcCAzKS5cbiAqXG4gKiBgc2NhblZhdWx0YCB3YWxrcyB0aGUgc3RvcmFnZSBhZGFwdGVyLCBhcHBsaWVzIHRoZSBzaGFyZWQgaWdub3JlIHJ1bGVzLFxuICogaGFzaGVzIG5vbi1pZ25vcmVkIGZpbGVzIChzaGEyNTYgXHUyMDE0IHNhbWUgYXMgYmxvYiBhZGRyZXNzaW5nKSBhbmQgZGlmZnNcbiAqIHRoZSByZXN1bHQgYWdhaW5zdCB0aGUgY2xpZW50J3MgYExvY2FsSW5kZXhgLiBUaGUgZGlmZiBjbGFzc2lmaWVzOlxuICpcbiAqICAgLSBgYWRkZWRgICAgIFx1MjAxNCBmaWxlIHByZXNlbnQsIHBhdGggdW5rbm93biB0byB0aGUgaW5kZXg7XG4gKiAgIC0gYG1vZGlmaWVkYCBcdTIwMTQgZmlsZSBwcmVzZW50LCBjb250ZW50IGhhc2ggZGlmZmVycyBmcm9tIHRoZSBpbmRleCBlbnRyeS5cbiAqICAgICAgICAgICAgICAgICAgQSBmaWxlIHdob3NlIGluZGV4IGVudHJ5IGlzIGEgKnRvbWJzdG9uZSogYWxzbyBsYW5kcyBoZXJlXG4gKiAgICAgICAgICAgICAgICAgIChkb2N1bWVudGVkIGRlY2lzaW9uKTogd2hldGhlciBpdCBpcyBhbiBlZGl0LW9mLWRlbGV0ZWRcbiAqICAgICAgICAgICAgICAgICAgb3IgYSBwdXJlIHJlc3VycmVjdCwgdGhlIHJlc29sdXRpb24gaXMgaWRlbnRpY2FsIFx1MjAxNCBsb2NhbFxuICogICAgICAgICAgICAgICAgICBjb250ZW50IGV4aXN0cyB0aGF0IHRoZSBpbmRleCBoZWFkIGRvZXMgbm90IHJlZmxlY3Q7XG4gKiAgIC0gYGRlbGV0ZWRgICBcdTIwMTQgaW5kZXggZW50cnkgbGl2ZSwgZmlsZSBnb25lO1xuICogICAtIGByZW5hbWVkYCAgXHUyMDE0IGEgZGVsZXRlICsgYWRkIHBhaXIgKndpdGhpbiBvbmUgc2Nhbiogd2hvc2UgY29udGVudFxuICogICAgICAgICAgICAgICAgICBoYXNoZXMgbWF0Y2ggKEFSQ0hJVEVDVFVSRSBcdTAwQTc0IHJlbmFtZSBjb3JyZWxhdGlvbikuIEFcbiAqICAgICAgICAgICAgICAgICAgcmVuYW1lIHdob3NlIGNvbnRlbnQgYWxzbyBjaGFuZ2VkIChyZW5hbWUgKyBlZGl0KSBub1xuICogICAgICAgICAgICAgICAgICBsb25nZXIgY29ycmVsYXRlcyBhbmQgZmFsbHMgYmFjayB0byBkZWxldGUgKyBhZGQgXHUyMDE0IHRoYXRcbiAqICAgICAgICAgICAgICAgICAgaXMgdGhlIGRvY3VtZW50ZWQsIGNvcnJlY3QgdjEgYmVoYXZpb3I7XG4gKiAgIC0gYGVtcHR5Rm9sZGVyc2AgXHUyMDE0IGRpcmVjdG9yaWVzIGV4aXN0aW5nIGluIHN0b3JhZ2UgYnV0IHJlcHJlc2VudGVkXG4gKiAgICAgICAgICAgICAgICAgIG5laXRoZXIgYnkgYSBsaXZlIGZvbGRlciBwbGFjZWhvbGRlciBpbiB0aGUgaW5kZXggbm9yIGJ5XG4gKiAgICAgICAgICAgICAgICAgIGFueSBmaWxlIGJlbmVhdGggdGhlbSAoRlItMTApO1xuICogICAtIGBmb2xkZXJEZWxldGlvbnNgIFx1MjAxNCBsaXZlIGZvbGRlciBwbGFjZWhvbGRlciBlbnRyaWVzIHdob3NlIGRpcmVjdG9yeVxuICogICAgICAgICAgICAgICAgICBubyBsb25nZXIgZXhpc3RzIGluIHN0b3JhZ2U6IHRoZSB1c2VyIGRlbGV0ZWQgYW4gZW1wdHlcbiAqICAgICAgICAgICAgICAgICAgZm9sZGVyIChvciBwcnVuZS1vbi1kZWxldGUgcmVtb3ZlZCBpdCwgYGVuZ2luZS50c2ApLCBhbmRcbiAqICAgICAgICAgICAgICAgICAgdGhlIGRlbGV0aW9uIG11c3QgcHJvcGFnYXRlIGFzIGEgZm9sZGVyIHRvbWJzdG9uZS4gVGhlXG4gKiAgICAgICAgICAgICAgICAgIGJ1Y2tldCBpcyBTRVBBUkFURSBmcm9tIGBkZWxldGVkYCBvbiBwdXJwb3NlOiBmb2xkZXJcbiAqICAgICAgICAgICAgICAgICAgcGxhY2Vob2xkZXJzIGNhcnJ5IG5vIGNvbnRlbnQgaGFzaCwgbXVzdCBuZXZlciBlbnRlclxuICogICAgICAgICAgICAgICAgICByZW5hbWUgY29ycmVsYXRpb24sIGFuZCByZXNvbHZlIGFzIHBsYWNlaG9sZGVyc1xuICogICAgICAgICAgICAgICAgICAoYGlzRm9sZGVyYCkgZG93bnN0cmVhbS4gQSBwbGFjZWhvbGRlciB0aGF0IG1lcmVseSBiZWNhbWVcbiAqICAgICAgICAgICAgICAgICAgaWdub3JlZCAoc2V0dGluZ3MgY2hhbmdlKSBpcyBOT1QgYSBkZWxldGlvbiBcdTIwMTQgaXQgaXNcbiAqICAgICAgICAgICAgICAgICAgc2tpcHBlZCwgZXhhY3RseSBsaWtlIGlnbm9yZWQgZmlsZXMuXG4gKiAgIC0gYHN0YWxlRGlyc2AgXHUyMDE0IGRpcmVjdG9yaWVzIHdob3NlIGluZGV4IGVudHJ5IGlzIGEgVE9NQlNUT05FRCBmb2xkZXJcbiAqICAgICAgICAgICAgICAgICAgcGxhY2Vob2xkZXIgd2hpbGUgYW4gRU1QVFkgZGlyZWN0b3J5IHN0aWxsIGV4aXN0cyBvbiBkaXNrXG4gKiAgICAgICAgICAgICAgICAgIEFORCB0aGUgdG9tYnN0b25lIHdhcyBhdXRob3JlZCBieSBBTk9USEVSIGRldmljZTogdGhlXG4gKiAgICAgICAgICAgICAgICAgIHJlc2lkdWUgb2YgYSByZWNvcmQtb25seSB0b21ic3RvbmUgYXBwbGljYXRpb24gKGFuIGFkYXB0ZXJcbiAqICAgICAgICAgICAgICAgICAgd2l0aG91dCBgcmVtb3ZlRGlyYCwgb3IgYSByZW1vdmFsIHRoYXQgbG9zdCBhIHJhY2UpLiBUaGVcbiAqICAgICAgICAgICAgICAgICAgbGVmdG92ZXIgaXMgQ09OU0lTVEVOVCB3aXRoIHRoZSAocmVtb3RlKSBkZWxldGlvbiwgc28gaXRcbiAqICAgICAgICAgICAgICAgICAgbXVzdCBOT1QgcmVzdXJyZWN0IGFzIFwibG9jYWwgd2luc1wiOiByZS1wdXNoaW5nIGl0IGFzIGFuXG4gKiAgICAgICAgICAgICAgICAgIGVtcHR5LWZvbGRlciBwbGFjZWhvbGRlciB3b3VsZCB1bmRvIGEgZGVsZXRpb24gdGhlIHVzZXJcbiAqICAgICAgICAgICAgICAgICAgbWFkZSBhbmQgcGluZy1wb25nIGl0IGJldHdlZW4gZGV2aWNlcyBmb3JldmVyIChvYnNlcnZlZFxuICogICAgICAgICAgICAgICAgICBlbmQtdG8tZW5kOiBBIGRlbGV0ZXMgXHUyMTkyIEIgcmVjb3Jkcy1vbmx5IFx1MjE5MiBCIHJlLXB1c2hlcyBcdTIxOTJcbiAqICAgICAgICAgICAgICAgICAgQSByZS1wdWxscykuIFRoZSBlbnRyeSBzdGF5cyB0b21ic3RvbmVkOyB0aGUgY2xpZW50IHJldHJpZXNcbiAqICAgICAgICAgICAgICAgICAgYHJlbW92ZURpcmAgZm9yIHRoZXNlIGRpcnMgZWFjaCBjeWNsZSAoY2xpZW50LnRzKS4gSWYgdGhlXG4gKiAgICAgICAgICAgICAgICAgIHRvbWJzdG9uZSB3YXMgYXV0aG9yZWQgYnkgVEhJUyBkZXZpY2UsIG9yIGNvbnRlbnQgZXhpc3RzXG4gKiAgICAgICAgICAgICAgICAgIGJlbmVhdGggdGhlIGRpcmVjdG9yeSwgdGhpcyBpcyBnZW51aW5lIGxvY2FsIHJlY3JlYXRpb246XG4gKiAgICAgICAgICAgICAgICAgIHRoZSBkaXIgbGFuZHMgaW4gYGVtcHR5Rm9sZGVyc2AgaW5zdGVhZCwgcmVzdG9yaW5nIHRoZVxuICogICAgICAgICAgICAgICAgICBwbGFjZWhvbGRlciBcdTIwMTQgbG9jYWwgd2lucyBpcyBjb3JyZWN0IHRoZXJlLlxuICogICAtIGBjYXNlQ29sbGlzaW9uc2AgXHUyMDE0IGxpdmUgaW5kZXggZW50cmllcyB3aG9zZSBwYXRoIGRpZmZlcnMgb25seSBieSBjYXNlXG4gKiAgICAgICAgICAgICAgICAgIGZyb20gYSBmaWxlIHByZXNlbnQgb24gZGlzazogdGhlIGludmlzaWJsZSB0d2luIG9mIGFcbiAqICAgICAgICAgICAgICAgICAgY2FzZS1jb2xsaWRpbmcgcGFpciAoQVJDSElURUNUVVJFIFx1MDBBNzE0KS4gTkVWRVIgZGVsZXRlZCBcdTIwMTRcbiAqICAgICAgICAgICAgICAgICAgZW1pdHRpbmcgYSB0b21ic3RvbmUgd291bGQgZGVzdHJveSB0aGUgdHdpbiBvbiB0aGUgc2VydmVyXG4gKiAgICAgICAgICAgICAgICAgIGFuZCBvbiBjYXNlLXNlbnNpdGl2ZSBwZWVycy4gU3VyZmFjZWQgYXMgYSBkaWFnbm9zdGljXG4gKiAgICAgICAgICAgICAgICAgIG9ubHk7IHRoZSBjb2xsaXNpb24gc3RheXMgdW5yZXNvbHZlZCBieSBkZXNpZ24uXG4gKiAgIC0gYHVuc2FmZVBhdGhzYCBcdTIwMTQgZmlsZXMgYW5kIGRpcmVjdG9yaWVzIHdob3NlIG5hbWVzIGFyZSBXaW5kb3dzLXVuc2FmZVxuICogICAgICAgICAgICAgICAgICAocmVzZXJ2ZWQgZGV2aWNlIG5hbWVzLCB0cmFpbGluZyBkb3Qvc3BhY2UgXHUyMDE0IGBwYXRocy50c2ApLlxuICogICAgICAgICAgICAgICAgICBMaWtlIGNhc2UgY29sbGlzaW9ucyB0aGV5IGFyZSBuZXZlciBwdXNoZWQgYW5kIG5ldmVyXG4gKiAgICAgICAgICAgICAgICAgIHRyZWF0ZWQgYXMgZGVsZXRpb25zOyBzdXJmYWNlZCBhcyBhIGRpYWdub3N0aWMgb25seS5cbiAqXG4gKiAjIyBUaGUgbXRpbWUrc2l6ZSBwcmUtZmlsdGVyIChmYXN0IG1vZGUsIHRoZSBkZWZhdWx0KVxuICpcbiAqIFJlLWhhc2hpbmcgYSA1MGstZmlsZSB2YXVsdCBhdCBldmVyeSBhcHAtb3BlbiBpcyBhIHJlYWwgYmF0dGVyeSBjb3N0LCBzb1xuICogZmFzdCBtb2RlIHNraXBzIGhhc2hpbmcgYSBmaWxlIHdob3NlIGBzaXplYCBBTkQgYG10aW1lYCAoZnJvbSB0aGUgc3RvcmFnZVxuICogYWRhcHRlcidzIGBGaWxlU3RhdGApIGV4YWN0bHkgbWF0Y2ggaXRzIGxpdmUgaW5kZXggZW50cnkgXHUyMDE0IHRoZSByZWNvcmRlZFxuICogaGFzaCBjYXJyaWVzIGZvcndhcmQgYXMgdW5jaGFuZ2VkLiBBIGZpbGUgaXMgaGFzaGVkIHdoZW4gaXQgaGFzIG5vIGVudHJ5LFxuICogdGhlIGVudHJ5IGlzIGEgdG9tYnN0b25lIG9yIGZvbGRlciBwbGFjZWhvbGRlciwgdGhlIHNpemUgZGlmZmVycywgb3IgdGhlXG4gKiBtdGltZSBkaWZmZXJzIG9yIGlzIHVua25vd24gKGxlZ2FjeSBzdGF0ZSwgcHVsbHMsIGZpcnN0IHNjYW4pLiBSZW5hbWVcbiAqIGNvcnJlbGF0aW9uIGlzIHVuYWZmZWN0ZWQ6IHRoZSBkZXN0aW5hdGlvbiBwYXRoIG9mIGEgcmVuYW1lIGFsd2F5cyBsb29rc1xuICogJ2FkZGVkJywgc28gaXQgaXMgYWx3YXlzIGhhc2hlZCBcdTIwMTQgY29udGVudC1wcmVzZXJ2aW5nIG1vdmVzIHN0aWxsIHBhaXIuXG4gKlxuICogVGhlIHRyYWRlb2ZmOiBmYXN0IG1vZGUgdHJ1c3RzIHRoZSBmaWxlc3lzdGVtIG5vdCB0byBjaGFuZ2UgY29udGVudCB3aGlsZVxuICogcHJlc2VydmluZyBib3RoIHNpemUgYW5kIG10aW1lLiBGb3IgdmVyaWZpY2F0aW9uIChgdnNhIGRvY3RvcmAsIHBlcmlvZGljXG4gKiBpbnRlZ3JpdHkgY2hlY2tzKSBwYXNzIGB7IG1vZGU6ICdmdWxsJyB9YCB0byByZS1oYXNoIGV2ZXJ5dGhpbmcuXG4gKlxuICogVGhlIGZ1bmN0aW9uIHRha2VzIGBub3dgIGFuZCB0aGUgaWdub3JlIHNldHRpbmdzIGFzIHBhcmFtZXRlcnMgKG5vIGhpZGRlblxuICogY2xvY2tzLCBubyBhbWJpZW50IGNvbmZpZykgYW5kIHJldHVybnMgZGV0ZXJtaW5pc3RpY2FsbHkgb3JkZXJlZCByZXN1bHRzXG4gKiAoZXZlcnkgYnVja2V0IHNvcnRlZCBieSBwYXRoOyByZW5hbWVzIGJ5IGBmcm9tYCkuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBGaWxlU3RhdCwgU3RvcmFnZUFkYXB0ZXIgfSBmcm9tICcuL2FkYXB0ZXJzLmpzJztcbmltcG9ydCB7IHNoYTI1NkhleCB9IGZyb20gJy4vaGFzaGluZy5qcyc7XG5pbXBvcnQgeyBpc0lnbm9yZWQsIHR5cGUgSWdub3JlU2V0dGluZ3MgfSBmcm9tICcuL2lnbm9yZS5qcyc7XG5pbXBvcnQgdHlwZSB7IExvY2FsSW5kZXgsIExvY2FsSW5kZXhFbnRyeSB9IGZyb20gJy4vbG9jYWxpbmRleC5qcyc7XG5pbXBvcnQgeyBpc1dpbmRvd3NVbnNhZmVQYXRoLCBwYXJlbnRQYXRoIH0gZnJvbSAnLi9wYXRocy5qcyc7XG5cbi8qKiBJbmplY3RhYmxlIGNvbnRlbnQgaGFzaCAodGhlIGRlZmF1bHQgaXMgc2hhMjU2LCBzYW1lIGFzIGJsb2IgYWRkcmVzc2luZykuICovXG5leHBvcnQgdHlwZSBIYXNoRm4gPSAoYnl0ZXM6IFVpbnQ4QXJyYXkpID0+IFByb21pc2U8c3RyaW5nPjtcblxuLyoqIE9wdGlvbnMgZm9yIGBzY2FuVmF1bHRgLiAqL1xuZXhwb3J0IGludGVyZmFjZSBTY2FuVmF1bHRPcHRpb25zIHtcbiAgLyoqXG4gICAqIGAnZmFzdCdgIChkZWZhdWx0KTogZmlsZXMgd2hvc2Ugc2l6ZSttdGltZSBleGFjdGx5IG1hdGNoIHRoZWlyIGxpdmUgaW5kZXhcbiAgICogZW50cnkgc2tpcCByZS1oYXNoaW5nLiBgJ2Z1bGwnYDogaGFzaCBldmVyeXRoaW5nIHJlZ2FyZGxlc3MgXHUyMDE0IGludGVncml0eVxuICAgKiB2ZXJpZmljYXRpb24gKGB2c2EgZG9jdG9yYCwgcGVyaW9kaWMgY2hlY2tzKS5cbiAgICovXG4gIG1vZGU/OiAnZmFzdCcgfCAnZnVsbCc7XG4gIC8qKiBDb250ZW50IGhhc2ggb3ZlcnJpZGUgKHRlc3RzIGNvdW50L2luc3BlY3QgaGFzaGluZykuIERlZmF1bHQ6IHNoYTI1NkhleC4gKi9cbiAgaGFzaD86IEhhc2hGbjtcbiAgLyoqXG4gICAqIEJ1bGstc2NhbiBwcm9ncmVzczogY2FsbGVkIG9uY2Ugd2l0aCAoMCwgdG90YWwpIGJlZm9yZSB0aGUgd2FsayBhbmQgb25jZVxuICAgKiBwZXIgZmlsZSBhZnRlcndhcmRzIChgZG9uZWAgY291bnRzIGhhc2hlZCBBTkQgZmFzdC1wYXRoLXNraXBwZWQgZmlsZXMpLlxuICAgKiBQdXJlIHJlcG9ydGluZyBcdTIwMTQgbmV2ZXIgYWZmZWN0cyB0aGUgc2NhbidzIGRlY2lzaW9ucy5cbiAgICovXG4gIG9uUHJvZ3Jlc3M/OiAoZG9uZTogbnVtYmVyLCB0b3RhbDogbnVtYmVyKSA9PiB2b2lkO1xuICAvKipcbiAgICogVGhpcyBkZXZpY2UncyBpZCwgd2hlbiB0aGUgY2FsbGVyIGlzIGEgc3luY2luZyBjbGllbnQuIFNoYXJwZW5zIHRoZVxuICAgKiB0b21ic3RvbmVkLXBsYWNlaG9sZGVyIHJ1bGUgKGBzdGFsZURpcnNgKTogYW4gRU1QVFkgZGlyZWN0b3J5IG92ZXIgYVxuICAgKiB0b21ic3RvbmVkIHBsYWNlaG9sZGVyIGlzIHRoZSByZWNvcmQtb25seSByZXNpZHVlIG9mIGEgUkVNT1RFIGRlbGV0aW9uXG4gICAqIChuZXZlciByZXN1cnJlY3RlZCksIGJ1dCBvdmVyIGEgdG9tYnN0b25lIFRISVMgZGV2aWNlIGF1dGhvcmVkIGl0IG1lYW5zXG4gICAqIHRoZSB1c2VyIHJlLWNyZWF0ZWQgdGhlIGZvbGRlciBoZXJlIFx1MjAxNCByZXN0b3JlIGl0IChwdXNoIHRoZSBwbGFjZWhvbGRlcikuXG4gICAqIE9taXR0ZWQgKG9yIG5vbi1mb2xkZXIgc2NhbnMpOiBvbmx5IHRoZSBjb250ZW50IHRlc3QgZGVjaWRlcy5cbiAgICovXG4gIHRoaXNEZXZpY2VJZD86IHN0cmluZztcbn1cblxuLyoqIEEgbG9jYWwgY29udGVudCBjaGFuZ2UgZm9yIGEgcGF0aCB0aGF0IGV4aXN0cyBpbiBzdG9yYWdlLiAqL1xuZXhwb3J0IGludGVyZmFjZSBTY2FuQ2FuZGlkYXRlIHtcbiAgcGF0aDogc3RyaW5nO1xuICBoYXNoOiBzdHJpbmc7XG4gIHNpemU6IG51bWJlcjtcbn1cblxuLyoqIEEgbG9jYWwgZGVsZXRpb246IGNhcnJpZXMgdGhlIGluZGV4J3MgdmVyc2lvbiBzbyB0aGUgdG9tYnN0b25lIGNvbW1pdCBuYW1lcyBpdHMgcGFyZW50LiAqL1xuZXhwb3J0IGludGVyZmFjZSBEZWxldGVkQ2FuZGlkYXRlIHtcbiAgcGF0aDogc3RyaW5nO1xuICAvKiogSGFzaCBvZiB0aGUgY29udGVudCBhcyBsYXN0IHN5bmNlZCAodG9tYnN0b25lcyByZXVzZSBpdCkuICovXG4gIGhhc2g6IHN0cmluZztcbiAgc2l6ZTogbnVtYmVyO1xuICAvKiogVmVyc2lvbiBpZCB0aGUgZGVsZXRpb24gY29tbWl0IGJ1aWxkcyBvbi4gKi9cbiAgdmVyc2lvbklkOiBzdHJpbmc7XG59XG5cbi8qKiBBIGRldGVjdGVkIHJlbmFtZTogc2FtZSBjb250ZW50IGhhc2ggbW92ZWQgZnJvbSBgZnJvbWAgdG8gYHRvYC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUmVuYW1lQ2FuZGlkYXRlIHtcbiAgZnJvbTogc3RyaW5nO1xuICB0bzogc3RyaW5nO1xuICBoYXNoOiBzdHJpbmc7XG4gIHNpemU6IG51bWJlcjtcbn1cblxuLyoqXG4gKiBBIGxpdmUgZm9sZGVyIHBsYWNlaG9sZGVyIHdob3NlIGRpcmVjdG9yeSB2YW5pc2hlZCBmcm9tIHN0b3JhZ2U6IHRoZVxuICogZGVsZXRpb24gbXVzdCBwcm9wYWdhdGUgYXMgYSBmb2xkZXIgdG9tYnN0b25lIChraW5kIGAnZGVsZXRlJ2AsXG4gKiBgaXNGb2xkZXI6IHRydWVgKS4gQ2FycmllcyB0aGUgcGxhY2Vob2xkZXIncyB2ZXJzaW9uIGlkIHNvIHRoZSB0b21ic3RvbmVcbiAqIGNvbW1pdCBuYW1lcyBpdHMgcGFyZW50OyBoYXNoL3NpemUgYXJlIHRoZSBwbGFjZWhvbGRlciBjb25zdGFudHNcbiAqIChgJydgL2AwYCkgYW5kIGFyZSByZS1kZXJpdmVkIGRvd25zdHJlYW0gcmF0aGVyIHRoYW4gY2FycmllZC5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBGb2xkZXJEZWxldGlvbkNhbmRpZGF0ZSB7XG4gIHBhdGg6IHN0cmluZztcbiAgLyoqIFZlcnNpb24gaWQgb2YgdGhlIHBsYWNlaG9sZGVyIGhlYWQgdGhlIHRvbWJzdG9uZSBjb21taXQgYnVpbGRzIG9uLiAqL1xuICB2ZXJzaW9uSWQ6IHN0cmluZztcbn1cblxuLyoqXG4gKiBBIGZpbGUgdGhpcyBzY2FuIGFjdHVhbGx5IHJlYWQgYW5kIGhhc2hlZCwgd2l0aCB0aGUgc3RhdCBvYnNlcnZlZCBhdCBoYXNoXG4gKiB0aW1lLiBGZWVkcyBgcmVjb3JkSGFzaGVkRmlsZXNgIHNvIHRoZSBORVhUIGZhc3Qgc2NhbiBjYW4gc2tpcCB0aGVzZSBmaWxlc1xuICogKHRoZSBtdGltZSBjYWNoZSBvbiB0aGUgaW5kZXggZW50cnkpLiBGaWxlcyBza2lwcGVkIGJ5IHRoZSBwcmUtZmlsdGVyIGFyZSxcbiAqIGJ5IGRlZmluaXRpb24sIG5vdCBoYXNoZWQgYW5kIGRvIG5vdCBhcHBlYXIgaGVyZS5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBIYXNoZWRGaWxlIHtcbiAgcGF0aDogc3RyaW5nO1xuICBoYXNoOiBzdHJpbmc7XG4gIHNpemU6IG51bWJlcjtcbiAgLyoqIEVwb2NoIG1zIFx1MjAxNCB0aGUgc3RvcmFnZSBzdGF0IGF0IGhhc2ggdGltZSAoYEZpbGVTdGF0Lm10aW1lYCkuICovXG4gIG10aW1lOiBudW1iZXI7XG59XG5cbi8qKiBUaGUgZnVsbCByZXN1bHQgb2Ygb25lIGxvY2FsIHNjYW4uIEFsbCBidWNrZXRzIHNvcnRlZCBieSBwYXRoLiAqL1xuZXhwb3J0IGludGVyZmFjZSBMb2NhbENoYW5nZXMge1xuICAvKiogVGhlIGBub3dgIHBhc3NlZCBpbiBcdTIwMTQgd2hlbiB0aGlzIHNjYW4gY29uY2VwdHVhbGx5IGhhcHBlbmVkLiAqL1xuICBzY2FubmVkQXQ6IG51bWJlcjtcbiAgYWRkZWQ6IFNjYW5DYW5kaWRhdGVbXTtcbiAgbW9kaWZpZWQ6IFNjYW5DYW5kaWRhdGVbXTtcbiAgZGVsZXRlZDogRGVsZXRlZENhbmRpZGF0ZVtdO1xuICByZW5hbWVkOiBSZW5hbWVDYW5kaWRhdGVbXTtcbiAgLyoqIEVtcHR5LWZvbGRlciBwYXRocyB0byBwdXNoIGFzIHBsYWNlaG9sZGVyIGVudHJpZXMgKEZSLTEwKS4gKi9cbiAgZW1wdHlGb2xkZXJzOiBzdHJpbmdbXTtcbiAgLyoqXG4gICAqIExpdmUgZm9sZGVyIHBsYWNlaG9sZGVycyB3aG9zZSBkaXJlY3Rvcnkgbm8gbG9uZ2VyIGV4aXN0cyBpbiBzdG9yYWdlIFx1MjAxNFxuICAgKiBmb2xkZXIgZGVsZXRpb25zIHRvIHB1c2ggYXMgdG9tYnN0b25lcyAoa2luZCBgJ2RlbGV0ZSdgLCBgaXNGb2xkZXJgKS5cbiAgICovXG4gIGZvbGRlckRlbGV0aW9uczogRm9sZGVyRGVsZXRpb25DYW5kaWRhdGVbXTtcbiAgLyoqXG4gICAqIERpcmVjdG9yaWVzIHdob3NlIGluZGV4IGVudHJ5IGlzIGEgVE9NQlNUT05FRCBmb2xkZXIgcGxhY2Vob2xkZXIgd2hpbGUgYW5cbiAgICogRU1QVFkgZGlyZWN0b3J5IHN0aWxsIGV4aXN0cyBvbiBkaXNrIChyZWNvcmQtb25seSB0b21ic3RvbmUgYXBwbGljYXRpb24gXHUyMDE0XG4gICAqIHNlZSB0aGUgbW9kdWxlIGRvYykuIE9taXR0ZWQgKG5vdCBtZXJlbHkgZW1wdHkpIHdoZW4gdGhlcmUgYXJlIG5vbmUsIHNvXG4gICAqIHdob2xlLW9iamVjdCBjb21wYXJpc29ucyBvZiBgTG9jYWxDaGFuZ2VzYCBzdGF5IHN0YWJsZSBmb3IgY2xlYW4gc2NhbnMuXG4gICAqL1xuICBzdGFsZURpcnM/OiBzdHJpbmdbXTtcbiAgLyoqXG4gICAqIExpdmUgaW5kZXggcGF0aHMgd2hvc2UgZmlsZSBpcyBpbnZpc2libGUgb24gdGhpcyBmaWxlc3lzdGVtIGJlY2F1c2VcbiAgICogYW5vdGhlciBmaWxlIGRpZmZlcnMgZnJvbSB0aGVtIG9ubHkgYnkgbmFtZSBjYXNlIChhIGNhc2UtY29sbGlkaW5nIHBhaXIsXG4gICAqIGNyZWF0YWJsZSBmcm9tIGEgY2FzZS1zZW5zaXRpdmUgY2xpZW50IFx1MjAxNCBBUkNISVRFQ1RVUkUgXHUwMEE3MTQpLiBUaGUgc2NhblxuICAgKiBuZXZlciBlbWl0cyBhIGRlbGV0aW9uIGZvciB0aGVzZSAodGhlIHR3aW4gb24gZGlzayBtdXN0IG5vdCBiZSBkZXN0cm95ZWRcbiAgICogYnkgYSB0b21ic3RvbmUgcHVzaCk7IHRoZSBjbGllbnQgc3VyZmFjZXMgdGhlbSBhcyBhIGRpYWdub3N0aWNcbiAgICogKGBTeW5jQ2xpZW50U3RhdHVzLmNhc2VDb2xsaXNpb25zYCkuIE9taXR0ZWQgd2hlbiB0aGVyZSBhcmUgbm9uZS5cbiAgICovXG4gIGNhc2VDb2xsaXNpb25zPzogc3RyaW5nW107XG4gIC8qKlxuICAgKiBGaWxlcyBhbmQgZGlyZWN0b3JpZXMgcHJlc2VudCBpbiBzdG9yYWdlIHdob3NlIG5hbWVzIGNhbm5vdCBiZSBzeW5jZWQ6XG4gICAqIFdpbmRvd3MtcmVzZXJ2ZWQgZGV2aWNlIG5hbWVzIChDT04sIE5VTCwgQ09NMS05LCBcdTIwMjYpIG9yIHNlZ21lbnRzIGVuZGluZ1xuICAgKiBpbiBgLmAvYCBgIChgcGF0aHMudHNgKS4gVGhleSBhcmUgbmV2ZXIgcHVzaGVkIChhIFdpbmRvd3MgcGVlciBjb3VsZFxuICAgKiBub3QgbWF0ZXJpYWxpemUgdGhlbSksIG5ldmVyIGhhc2hlZCwgYW5kIG5ldmVyIHRyZWF0ZWQgYXMgZGVsZXRpb25zIG9mXG4gICAqIHRoZWlyIGluZGV4IGVudHJpZXM7IHN1cmZhY2VkIGFzIGEgZGlhZ25vc3RpY1xuICAgKiAoYFN5bmNDbGllbnRTdGF0dXMuc2tpcHBlZFBhdGhzYCkgdW50aWwgYSBodW1hbiByZW5hbWVzIHRoZW0uIE9taXR0ZWRcbiAgICogd2hlbiB0aGVyZSBhcmUgbm9uZS5cbiAgICovXG4gIHVuc2FmZVBhdGhzPzogc3RyaW5nW107XG4gIC8qKiBFdmVyeSBmaWxlIHRoZSBzY2FuIGhhc2hlZCAoZmFzdCBtb2RlJ3Mgc2tpcHBlZCBmaWxlcyBhcmUgYWJzZW50KSwgc29ydGVkIGJ5IHBhdGguICovXG4gIGhhc2hlZDogSGFzaGVkRmlsZVtdO1xufVxuXG4vKipcbiAqIFNjYW4gdGhlIHZhdWx0IGFuZCBkaWZmIGl0IGFnYWluc3QgdGhlIGluZGV4LlxuICpcbiAqIEluIGZhc3QgbW9kZSAodGhlIGRlZmF1bHQpIGEgZmlsZSB3aG9zZSBzaXplIGFuZCBtdGltZSBib3RoIGV4YWN0bHkgbWF0Y2hcbiAqIGl0cyBsaXZlIGluZGV4IGVudHJ5IGlzIE5PVCByZS1oYXNoZWQgXHUyMDE0IHRoZSByZWNvcmRlZCBoYXNoIGNhcnJpZXMgZm9yd2FyZFxuICogYXMgdW5jaGFuZ2VkIChzZWUgdGhlIG1vZHVsZSBkb2MgZm9yIHRoZSB0cmFkZW9mZiBhbmQgdGhlIGBmdWxsYCBlc2NhcGVcbiAqIGhhdGNoKS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHNjYW5WYXVsdChcbiAgc3RvcmFnZTogU3RvcmFnZUFkYXB0ZXIsXG4gIGluZGV4OiBMb2NhbEluZGV4LFxuICBzZXR0aW5nczogSWdub3JlU2V0dGluZ3MsXG4gIG5vdzogbnVtYmVyLFxuICBvcHRpb25zOiBTY2FuVmF1bHRPcHRpb25zID0ge30sXG4pOiBQcm9taXNlPExvY2FsQ2hhbmdlcz4ge1xuICBjb25zdCBoYXNoRm4gPSBvcHRpb25zLmhhc2ggPz8gc2hhMjU2SGV4O1xuICBjb25zdCBtb2RlID0gb3B0aW9ucy5tb2RlID8/ICdmYXN0JztcbiAgY29uc3Qgb25Qcm9ncmVzcyA9IG9wdGlvbnMub25Qcm9ncmVzcztcbiAgY29uc3QgdGhpc0RldmljZUlkID0gb3B0aW9ucy50aGlzRGV2aWNlSWQ7XG5cbiAgY29uc3QgZmlsZXMgPSBhd2FpdCBzdG9yYWdlLmxpc3RGaWxlcygpO1xuXG4gIC8vIFdpbmRvd3MtdW5zYWZlIG5hbWVzIG5ldmVyIGVudGVyIHRoZSBkaWZmIChub3IgdGhlIGRpcmVjdG9yeVxuICAvLyByZXByZXNlbnRhdGlvbiB3YWxrIGJlbG93KTogdGhleSBjYW5ub3QgYmUgcHVzaGVkLCBhbmQgZW1pdHRpbmcgYVxuICAvLyBkZWxldGlvbiBvciBwbGFjZWhvbGRlciBmb3IgdGhlbSB3b3VsZCBjaHVybiBhZ2FpbnN0IGEgc2VydmVyIHRoYXRcbiAgLy8gcmVqZWN0cyB0aGUgcGF0aC4gVGhleSBzdXJmYWNlIGFzIGRpYWdub3N0aWNzIGluc3RlYWQuXG4gIGNvbnN0IHVuc2FmZVBhdGhzOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBzeW5jYWJsZTogRmlsZVN0YXRbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGZpbGUgb2YgZmlsZXMpIHtcbiAgICBpZiAoaXNXaW5kb3dzVW5zYWZlUGF0aChmaWxlLnBhdGgpKSB1bnNhZmVQYXRocy5wdXNoKGZpbGUucGF0aCk7XG4gICAgZWxzZSBzeW5jYWJsZS5wdXNoKGZpbGUpO1xuICB9XG5cbiAgY29uc3Qga2VwdDogRmlsZVN0YXRbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGZpbGUgb2Ygc3luY2FibGUpIHtcbiAgICBpZiAoIWlzSWdub3JlZChmaWxlLnBhdGgsIHNldHRpbmdzKSkga2VwdC5wdXNoKGZpbGUpO1xuICB9XG4gIGNvbnN0IGtlcHRQYXRocyA9IG5ldyBTZXQoa2VwdC5tYXAoKGYpID0+IGYucGF0aCkpO1xuXG4gIGNvbnN0IGFkZGVkOiBTY2FuQ2FuZGlkYXRlW10gPSBbXTtcbiAgY29uc3QgbW9kaWZpZWQ6IFNjYW5DYW5kaWRhdGVbXSA9IFtdO1xuICBjb25zdCBoYXNoZWQ6IEhhc2hlZEZpbGVbXSA9IFtdO1xuXG4gIG9uUHJvZ3Jlc3M/LigwLCBrZXB0Lmxlbmd0aCk7XG4gIGxldCBzY2FubmVkID0gMDtcbiAgZm9yIChjb25zdCBmaWxlIG9mIGtlcHQpIHtcbiAgICBjb25zdCBlbnRyeSA9IGluZGV4W2ZpbGUucGF0aF07XG4gICAgaWYgKG1vZGUgPT09ICdmYXN0JyAmJiBzdGF0TWF0Y2hlc0VudHJ5KGVudHJ5LCBmaWxlKSkge1xuICAgICAgc2Nhbm5lZCArPSAxO1xuICAgICAgb25Qcm9ncmVzcz8uKHNjYW5uZWQsIGtlcHQubGVuZ3RoKTtcbiAgICAgIGNvbnRpbnVlOyAvLyBzaXplK210aW1lIHVuY2hhbmdlZCBzaW5jZSB0aGUgcmVjb3JkZWQgaGFzaCBcdTIwMTQgdHJ1c3QgaXRcbiAgICB9XG4gICAgY29uc3QgaGFzaCA9IGF3YWl0IGhhc2hGbihhd2FpdCBzdG9yYWdlLnJlYWRGaWxlKGZpbGUucGF0aCkpO1xuICAgIGhhc2hlZC5wdXNoKHsgcGF0aDogZmlsZS5wYXRoLCBoYXNoLCBzaXplOiBmaWxlLnNpemUsIG10aW1lOiBmaWxlLm10aW1lIH0pO1xuICAgIHNjYW5uZWQgKz0gMTtcbiAgICBvblByb2dyZXNzPy4oc2Nhbm5lZCwga2VwdC5sZW5ndGgpO1xuICAgIGlmIChlbnRyeSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBhZGRlZC5wdXNoKHsgcGF0aDogZmlsZS5wYXRoLCBoYXNoLCBzaXplOiBmaWxlLnNpemUgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGVudHJ5LmlzRm9sZGVyKSB7XG4gICAgICAvLyBBIHJlYWwgZmlsZSByZXBsYWNlZCBhIGZvbGRlciBwbGFjZWhvbGRlcjogdHJlYXQgYXMgY29udGVudCBjaGFuZ2UuXG4gICAgICBtb2RpZmllZC5wdXNoKHsgcGF0aDogZmlsZS5wYXRoLCBoYXNoLCBzaXplOiBmaWxlLnNpemUgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgLy8gVG9tYnN0b25lZCBlbnRyeSB3aXRoIHRoZSBmaWxlIGJhY2sgXHUyMUQyIG1vZGlmaWVkIChyZXN1cnJlY3Qgb3JcbiAgICAvLyBlZGl0LW9mLWRlbGV0ZWQgXHUyMDE0IGJvdGggcmVzb2x2ZSB0aGUgc2FtZSB3YXkgZG93bnN0cmVhbSkuXG4gICAgaWYgKGVudHJ5LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkIHx8IGVudHJ5Lmhhc2ggIT09IGhhc2gpIHtcbiAgICAgIG1vZGlmaWVkLnB1c2goeyBwYXRoOiBmaWxlLnBhdGgsIGhhc2gsIHNpemU6IGZpbGUuc2l6ZSB9KTtcbiAgICB9XG4gIH1cblxuICBjb25zdCBkZWxldGVkOiBEZWxldGVkQ2FuZGlkYXRlW10gPSBbXTtcbiAgZm9yIChjb25zdCBbcGF0aCwgZW50cnldIG9mIE9iamVjdC5lbnRyaWVzKGluZGV4KSkge1xuICAgIGlmIChlbnRyeS5pc0ZvbGRlcikgY29udGludWU7IC8vIGZvbGRlciBwbGFjZWhvbGRlcnMgbmV2ZXIgcHJvZHVjZSBmaWxlIGRlbGV0aW9uc1xuICAgIGlmIChlbnRyeS5kZWxldGVkQXQgIT09IHVuZGVmaW5lZCkgY29udGludWU7IC8vIGFscmVhZHkgdG9tYnN0b25lZFxuICAgIGlmIChrZXB0UGF0aHMuaGFzKHBhdGgpKSBjb250aW51ZTtcbiAgICBpZiAoaXNJZ25vcmVkKHBhdGgsIHNldHRpbmdzKSkge1xuICAgICAgLy8gVGhlIHBhdGggYmVjYW1lIGlnbm9yZWQgKHNldHRpbmdzIGNoYW5nZSkgXHUyMDE0IG5vdCBhIGRlbGV0aW9uLlxuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGRlbGV0ZWQucHVzaCh7IHBhdGgsIGhhc2g6IGVudHJ5Lmhhc2gsIHNpemU6IGVudHJ5LnNpemUsIHZlcnNpb25JZDogZW50cnkudmVyc2lvbklkIH0pO1xuICB9XG5cbiAgY29uc3QgeyByZW5hbWVkLCBkZWxldGVkOiB1bm1hdGNoZWREZWxldGVkLCBhZGRlZDogdW5tYXRjaGVkQWRkZWQgfSA9IGRldGVjdFJlbmFtZXMoZGVsZXRlZCwgYWRkZWQpO1xuICBjb25zdCB7IGRlbGV0ZWQ6IHNhZmVEZWxldGVkLCBjYXNlQ29sbGlzaW9ucyB9ID0gc3BsaXRDYXNlQ29sbGlzaW9ucyhcbiAgICB1bm1hdGNoZWREZWxldGVkLFxuICAgIGtlcHRQYXRocyxcbiAgICBuZXcgU2V0KFsuLi51bm1hdGNoZWRBZGRlZC5tYXAoKGMpID0+IGMucGF0aCksIC4uLm1vZGlmaWVkLm1hcCgoYykgPT4gYy5wYXRoKSwgLi4ucmVuYW1lZC5tYXAoKHIpID0+IHIudG8pXSksXG4gICk7XG4gIGNvbnN0IGRpcnMgPSBhd2FpdCBzdG9yYWdlLmxpc3REaXJzKCk7XG4gIGNvbnN0IHN5bmNhYmxlRGlyczogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChjb25zdCBkaXIgb2YgZGlycykge1xuICAgIGlmIChpc1dpbmRvd3NVbnNhZmVQYXRoKGRpcikpIHVuc2FmZVBhdGhzLnB1c2goZGlyKTtcbiAgICBlbHNlIHN5bmNhYmxlRGlycy5wdXNoKGRpcik7XG4gIH1cbiAgY29uc3QgeyBlbXB0eUZvbGRlcnMsIHN0YWxlRGlycyB9ID0gZGV0ZWN0RW1wdHlGb2xkZXJzKFxuICAgIGluZGV4LFxuICAgIHNldHRpbmdzLFxuICAgIHN5bmNhYmxlLFxuICAgIHN5bmNhYmxlRGlycyxcbiAgICB0aGlzRGV2aWNlSWQsXG4gICk7XG4gIGNvbnN0IGZvbGRlckRlbGV0aW9ucyA9IGRldGVjdEZvbGRlckRlbGV0aW9ucyhpbmRleCwgc2V0dGluZ3MsIHN5bmNhYmxlRGlycyk7XG5cbiAgcmV0dXJuIHtcbiAgICBzY2FubmVkQXQ6IG5vdyxcbiAgICBhZGRlZDogc29ydENhbmRpZGF0ZXModW5tYXRjaGVkQWRkZWQpLFxuICAgIG1vZGlmaWVkOiBzb3J0Q2FuZGlkYXRlcyhtb2RpZmllZCksXG4gICAgZGVsZXRlZDogWy4uLnNhZmVEZWxldGVkXS5zb3J0KGJ5UGF0aCksXG4gICAgcmVuYW1lZDogWy4uLnJlbmFtZWRdLnNvcnQoKGEsIGIpID0+IGJ5UGF0aChhLCBiKSksXG4gICAgZW1wdHlGb2xkZXJzLFxuICAgIGZvbGRlckRlbGV0aW9ucyxcbiAgICAvLyBPbWl0dGVkIHdoZW4gZW1wdHkgKG5vdCBgW11gKSBcdTIwMTQgc2VlIHRoZSBmaWVsZCdzIGRvYy5cbiAgICAuLi4oc3RhbGVEaXJzLmxlbmd0aCA+IDAgPyB7IHN0YWxlRGlycyB9IDoge30pLFxuICAgIC4uLihjYXNlQ29sbGlzaW9ucy5sZW5ndGggPiAwID8geyBjYXNlQ29sbGlzaW9ucyB9IDoge30pLFxuICAgIC4uLih1bnNhZmVQYXRocy5sZW5ndGggPiAwID8geyB1bnNhZmVQYXRoczogdW5zYWZlUGF0aHMuc29ydChjb21wYXJlU3RyaW5ncykgfSA6IHt9KSxcbiAgICBoYXNoZWQ6IFsuLi5oYXNoZWRdLnNvcnQoYnlQYXRoKSxcbiAgfTtcbn1cblxuLyoqXG4gKiBDYXNlLWNvbGxpc2lvbiBndWFyZCAoQVJDSElURUNUVVJFIFx1MDBBNzE0KTogYW4gdW5tYXRjaGVkIGRlbGV0aW9uIHdob3NlIHBhdGhcbiAqIGRpZmZlcnMgb25seSBieSBjYXNlIGZyb20gYSBmaWxlIFBSRVNFTlQgb24gZGlzayBpcyBub3QgYSBkZWxldGlvbiB0aGUgdXNlclxuICogbWFkZSBcdTIwMTQgaXQgaXMgdGhlIGludmlzaWJsZSB0d2luIG9mIGEgY2FzZS1jb2xsaWRpbmcgcGFpciAoY3JlYXRhYmxlIGZyb20gYVxuICogY2FzZS1zZW5zaXRpdmUgY2xpZW50LCBlLmcuIHRoZSBMaW51eCBkYWVtb24pLiBUaGlzIGNhc2UtaW5zZW5zaXRpdmVcbiAqIGZpbGVzeXN0ZW0gc2hvd3Mgb25seSBvbmUgZGlyZWN0b3J5IGVudHJ5IGZvciBib3RoLCBzbyBlbWl0dGluZyB0aGUgZGVsZXRlXG4gKiB3b3VsZCBwdXNoIGEgdG9tYnN0b25lIHRoYXQgZGVzdHJveXMgdGhlIHR3aW4gc2VydmVyLXNpZGUgYW5kIG9uIGV2ZXJ5XG4gKiBjYXNlLXNlbnNpdGl2ZSBwZWVyLiBJbnN0ZWFkIHRoZSBwYXRoIGlzIHN1cmZhY2VkIGFzIGEgYGNhc2VDb2xsaXNpb25zYFxuICogZGlhZ25vc3RpYyAobmV2ZXIgYSBkZWxldGlvbiBwdXNoKTsgdGhlIGNvbGxpc2lvbiBpdHNlbGYgc3RheXMgdW5yZXNvbHZlZFxuICogdW50aWwgYSBodW1hbiByZW5hbWVzIG9uZSBvZiB0aGUgcGFpci5cbiAqXG4gKiBUaGUgZ3VhcmQgZGVsaWJlcmF0ZWx5IHJ1bnMgQUZURVIgcmVuYW1lIGNvcnJlbGF0aW9uIGFuZCBza2lwcyB0d2lucyB0aGF0XG4gKiB0aGlzIHNjYW4gcmVwb3J0cyBhcyBhZGRlZC9tb2RpZmllZC9yZW5hbWVkLXRvOiBhIGNhc2Utb25seSByZW5hbWUgKG9yXG4gKiByZW5hbWUrZWRpdCkgdGhlIHVzZXIgcGVyZm9ybWVkIG9uIFRISVMgZGV2aWNlIHByb2R1Y2VzIGV4YWN0bHkgdGhhdFxuICogZGVsZXRlK3R3aW4tY2hhbmdlZCBzaGFwZSwgYW5kIGl0cyBkZWNvbXBvc2l0aW9uIGludG8gZGVsZXRlK2FkZCBpcyB0aGVcbiAqIGRvY3VtZW50ZWQsIGNvcnJlY3QgYmVoYXZpb3IgKGFwcGx5UHVsbCBvcmRlcnMgY2FzZS1jb2xsaWRpbmcgcHVsbHNcbiAqIGRlbGV0ZS1maXJzdCwgYHJlc29sdmUudHNgKS4gT25seSBhIHR3aW4gdGhhdCBpcyBvdGhlcndpc2UgVU5DSEFOR0VEIFx1MjAxNFxuICogbWVhbmluZyBpdCBpcyBhIGdlbnVpbmVseSBzZXBhcmF0ZSByZW1vdGUgZmlsZSB0aGlzIGRpc2sgY2FuIG9ubHkgc2hvdyBvbmVcbiAqIG9mIFx1MjAxNCBzdXBwcmVzc2VzIHRoZSBkZWxldGlvbi5cbiAqL1xuZnVuY3Rpb24gc3BsaXRDYXNlQ29sbGlzaW9ucyhcbiAgZGVsZXRlZDogcmVhZG9ubHkgRGVsZXRlZENhbmRpZGF0ZVtdLFxuICBrZXB0UGF0aHM6IFJlYWRvbmx5U2V0PHN0cmluZz4sXG4gIGNoYW5nZWRQYXRoczogUmVhZG9ubHlTZXQ8c3RyaW5nPixcbik6IHsgZGVsZXRlZDogRGVsZXRlZENhbmRpZGF0ZVtdOyBjYXNlQ29sbGlzaW9uczogc3RyaW5nW10gfSB7XG4gIGNvbnN0IGtlcHRCeUxvd2VyID0gbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oKTtcbiAgZm9yIChjb25zdCBwYXRoIG9mIGtlcHRQYXRocykga2VwdEJ5TG93ZXIuc2V0KHBhdGgudG9Mb3dlckNhc2UoKSwgcGF0aCk7XG4gIGNvbnN0IHNhZmVEZWxldGVkOiBEZWxldGVkQ2FuZGlkYXRlW10gPSBbXTtcbiAgY29uc3QgY2FzZUNvbGxpc2lvbnM6IHN0cmluZ1tdID0gW107XG4gIGZvciAoY29uc3QgY2FuZGlkYXRlIG9mIGRlbGV0ZWQpIHtcbiAgICBjb25zdCB0d2luID0ga2VwdEJ5TG93ZXIuZ2V0KGNhbmRpZGF0ZS5wYXRoLnRvTG93ZXJDYXNlKCkpO1xuICAgIGlmICh0d2luICE9PSB1bmRlZmluZWQgJiYgIWNoYW5nZWRQYXRocy5oYXModHdpbikpIHtcbiAgICAgIGNhc2VDb2xsaXNpb25zLnB1c2goY2FuZGlkYXRlLnBhdGgpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIHNhZmVEZWxldGVkLnB1c2goY2FuZGlkYXRlKTtcbiAgfVxuICByZXR1cm4ge1xuICAgIGRlbGV0ZWQ6IHNhZmVEZWxldGVkLFxuICAgIGNhc2VDb2xsaXNpb25zOiBjYXNlQ29sbGlzaW9ucy5zb3J0KGNvbXBhcmVTdHJpbmdzKSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gY29tcGFyZVN0cmluZ3MoYTogc3RyaW5nLCBiOiBzdHJpbmcpOiBudW1iZXIge1xuICByZXR1cm4gYSA8IGIgPyAtMSA6IGEgPiBiID8gMSA6IDA7XG59XG5cbi8qKlxuICogV2hldGhlciB0aGUgZmlsZSdzIHN0YXQgZXhhY3RseSBtYXRjaGVzIGl0cyBsaXZlIGluZGV4IGVudHJ5IFx1MjAxNCB0aGUgZmFzdFxuICogbW9kZSBwcmUtZmlsdGVyLiBSZXF1aXJlcyBhIGtub3duIHJlY29yZGVkIGBtdGltZWAgKGxlZ2FjeSBlbnRyaWVzIGFuZFxuICogcHVsbC13cml0dGVuIGVudHJpZXMgaGF2ZSBub25lIFx1MjFEMiBoYXNoZWQsIHRoZW4gcmVjb3JkZWQpIGFuZCBuZXZlciBmaXJlc1xuICogZm9yIHRvbWJzdG9uZXMgKGEgcmVzdXJyZWN0IG11c3QgYWx3YXlzIHN1cmZhY2UpIG9yIGZvbGRlciBwbGFjZWhvbGRlcnMuXG4gKi9cbmZ1bmN0aW9uIHN0YXRNYXRjaGVzRW50cnkoZW50cnk6IExvY2FsSW5kZXhFbnRyeSB8IHVuZGVmaW5lZCwgZmlsZTogRmlsZVN0YXQpOiBib29sZWFuIHtcbiAgcmV0dXJuIChcbiAgICBlbnRyeSAhPT0gdW5kZWZpbmVkICYmXG4gICAgZW50cnkuZGVsZXRlZEF0ID09PSB1bmRlZmluZWQgJiZcbiAgICBlbnRyeS5pc0ZvbGRlciAhPT0gdHJ1ZSAmJlxuICAgIGVudHJ5Lm10aW1lICE9PSB1bmRlZmluZWQgJiZcbiAgICBlbnRyeS5tdGltZSA9PT0gZmlsZS5tdGltZSAmJlxuICAgIGVudHJ5LnNpemUgPT09IGZpbGUuc2l6ZVxuICApO1xufVxuXG4vKipcbiAqIFJlY29yZCBhIHNjYW4ncyBoYXNoIG9ic2VydmF0aW9ucyBpbnRvIHRoZSBpbmRleDogZm9yIGV2ZXJ5IGxpdmUgZmlsZVxuICogZW50cnkgd2hvc2UgY29udGVudCBoYXNoIG1hdGNoZXMgd2hhdCB0aGUgc2NhbiBoYXNoZWQsIGNhY2hlIHRoZSBvYnNlcnZlZFxuICogbXRpbWUgc28gdGhlIG5leHQgZmFzdCBzY2FuIGNhbiBza2lwIHJlLWhhc2hpbmcgaXQuXG4gKlxuICogUHVyZTogcmV0dXJucyBhIG5ldyBpbmRleCAob3IgdGhlIGlucHV0IHdoZW4gbm90aGluZyBjaGFuZ2VzKSwgbmV2ZXJcbiAqIG11dGF0ZXMuIFRoZSBoYXNoLW1hdGNoIGd1YXJkIGtlZXBzIHRoZSBjYWNoZSBob25lc3QgXHUyMDE0IGFuIGVudHJ5IHdob3NlXG4gKiBoYXNoIG5vIGxvbmdlciByZWZsZWN0cyB0aGUgb2JzZXJ2YXRpb24gKGUuZy4gYSBwdWxsIG92ZXJ3cm90ZSB0aGUgcGF0aFxuICogbWlkLWN5Y2xlKSBpcyBsZWZ0IHVudG91Y2hlZCBhbmQgc2ltcGx5IGdldHMgcmUtaGFzaGVkIG5leHQgc2Nhbi5cbiAqIEVudHJpZXMgbmV2ZXIgZGVtb3RlOiBgZGVsZXRlZEF0YC9gaXNGb2xkZXJgIGVudHJpZXMgYXJlIG5ldmVyIHBhdGNoZWQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZWNvcmRIYXNoZWRGaWxlcyhcbiAgaW5kZXg6IExvY2FsSW5kZXgsXG4gIGhhc2hlZDogcmVhZG9ubHkgSGFzaGVkRmlsZVtdLFxuKTogTG9jYWxJbmRleCB7XG4gIGxldCBuZXh0OiBSZWNvcmQ8c3RyaW5nLCBMb2NhbEluZGV4RW50cnk+IHwgdW5kZWZpbmVkO1xuICBmb3IgKGNvbnN0IG9ic2VydmVkIG9mIGhhc2hlZCkge1xuICAgIGNvbnN0IGVudHJ5ID0gaW5kZXhbb2JzZXJ2ZWQucGF0aF07XG4gICAgaWYgKGVudHJ5ID09PSB1bmRlZmluZWQgfHwgZW50cnkuaXNGb2xkZXIgfHwgZW50cnkuZGVsZXRlZEF0ICE9PSB1bmRlZmluZWQpIGNvbnRpbnVlO1xuICAgIGlmIChlbnRyeS5oYXNoICE9PSBvYnNlcnZlZC5oYXNoKSBjb250aW51ZTtcbiAgICBpZiAoZW50cnkubXRpbWUgPT09IG9ic2VydmVkLm10aW1lKSBjb250aW51ZTtcbiAgICBuZXh0ID8/PSB7IC4uLmluZGV4IH07XG4gICAgbmV4dFtvYnNlcnZlZC5wYXRoXSA9IHsgLi4uZW50cnksIG10aW1lOiBvYnNlcnZlZC5tdGltZSB9O1xuICB9XG4gIHJldHVybiBuZXh0ID8/IGluZGV4O1xufVxuXG4vKipcbiAqIENvcnJlbGF0ZSBkZWxldGUgKyBhZGQgcGFpcnMgYnkgY29udGVudCBoYXNoIChBUkNISVRFQ1RVUkUgXHUwMEE3NCkuXG4gKlxuICogT25lLXRvLW9uZSBtYXRjaGluZywgbW9zdCBkZXRlcm1pbmlzdGljIHdpbnM6IHdoZW4gc2V2ZXJhbCB1bm1hdGNoZWQgYWRkc1xuICogc2hhcmUgdGhlIGRlbGV0ZWQgc2lkZSdzIGhhc2gsIHByZWZlciBhbiBhZGQgaW4gdGhlIHNhbWUgcGFyZW50IGRpcmVjdG9yeTtcbiAqIHdpdGhpbiBhIHByZWZlcmVuY2UgY2xhc3MsIHRoZSBsZXhpY29ncmFwaGljYWxseSBzbWFsbGVzdCBgdG9gIHBhdGggd2lucy5cbiAqIE1hdGNoZWQgcGFpcnMgbGVhdmUgdGhlIGRlbGV0ZS9hZGQgYnVja2V0cyBhbmQgYmVjb21lIGByZW5hbWVkYC5cbiAqL1xuZnVuY3Rpb24gZGV0ZWN0UmVuYW1lcyhcbiAgZGVsZXRlZDogcmVhZG9ubHkgRGVsZXRlZENhbmRpZGF0ZVtdLFxuICBhZGRlZDogcmVhZG9ubHkgU2NhbkNhbmRpZGF0ZVtdLFxuKToge1xuICByZW5hbWVkOiBSZW5hbWVDYW5kaWRhdGVbXTtcbiAgZGVsZXRlZDogRGVsZXRlZENhbmRpZGF0ZVtdO1xuICBhZGRlZDogU2NhbkNhbmRpZGF0ZVtdO1xufSB7XG4gIGNvbnN0IGFkZHNCeUhhc2ggPSBuZXcgTWFwPHN0cmluZywgU2NhbkNhbmRpZGF0ZVtdPigpO1xuICBmb3IgKGNvbnN0IGNhbmRpZGF0ZSBvZiBbLi4uYWRkZWRdLnNvcnQoYnlQYXRoKSkge1xuICAgIGNvbnN0IGJ1Y2tldCA9IGFkZHNCeUhhc2guZ2V0KGNhbmRpZGF0ZS5oYXNoKTtcbiAgICBpZiAoYnVja2V0KSBidWNrZXQucHVzaChjYW5kaWRhdGUpO1xuICAgIGVsc2UgYWRkc0J5SGFzaC5zZXQoY2FuZGlkYXRlLmhhc2gsIFtjYW5kaWRhdGVdKTtcbiAgfVxuXG4gIGNvbnN0IHVzZWRBZGRzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGNvbnN0IHJlbmFtZWQ6IFJlbmFtZUNhbmRpZGF0ZVtdID0gW107XG4gIGNvbnN0IHVubWF0Y2hlZERlbGV0ZWQ6IERlbGV0ZWRDYW5kaWRhdGVbXSA9IFtdO1xuXG4gIGZvciAoY29uc3QgZGVsZXRpb24gb2YgWy4uLmRlbGV0ZWRdLnNvcnQoYnlQYXRoKSkge1xuICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBhZGRzQnlIYXNoLmdldChkZWxldGlvbi5oYXNoKSA/PyBbXTtcbiAgICBsZXQgZmFsbGJhY2s6IFNjYW5DYW5kaWRhdGUgfCB1bmRlZmluZWQ7XG4gICAgbGV0IHNhbWVEaXI6IFNjYW5DYW5kaWRhdGUgfCB1bmRlZmluZWQ7XG4gICAgZm9yIChjb25zdCBjYW5kaWRhdGUgb2YgY2FuZGlkYXRlcykge1xuICAgICAgaWYgKHVzZWRBZGRzLmhhcyhjYW5kaWRhdGUucGF0aCkpIGNvbnRpbnVlO1xuICAgICAgaWYgKHBhcmVudFBhdGgoY2FuZGlkYXRlLnBhdGgpID09PSBwYXJlbnRQYXRoKGRlbGV0aW9uLnBhdGgpKSB7XG4gICAgICAgIHNhbWVEaXIgPz89IGNhbmRpZGF0ZTsgLy8gc29ydGVkIFx1MjFEMiBmaXJzdCBpcyBzbWFsbGVzdFxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZmFsbGJhY2sgPz89IGNhbmRpZGF0ZTtcbiAgICAgIH1cbiAgICB9XG4gICAgY29uc3QgbWF0Y2ggPSBzYW1lRGlyID8/IGZhbGxiYWNrO1xuICAgIGlmIChtYXRjaCkge1xuICAgICAgdXNlZEFkZHMuYWRkKG1hdGNoLnBhdGgpO1xuICAgICAgcmVuYW1lZC5wdXNoKHsgZnJvbTogZGVsZXRpb24ucGF0aCwgdG86IG1hdGNoLnBhdGgsIGhhc2g6IGRlbGV0aW9uLmhhc2gsIHNpemU6IGRlbGV0aW9uLnNpemUgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHVubWF0Y2hlZERlbGV0ZWQucHVzaChkZWxldGlvbik7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHtcbiAgICByZW5hbWVkLFxuICAgIGRlbGV0ZWQ6IHVubWF0Y2hlZERlbGV0ZWQsXG4gICAgYWRkZWQ6IGFkZGVkLmZpbHRlcigoY2FuZGlkYXRlKSA9PiAhdXNlZEFkZHMuaGFzKGNhbmRpZGF0ZS5wYXRoKSksXG4gIH07XG59XG5cbi8qKlxuICogRGlyZWN0b3JpZXMgdGhhdCBleGlzdCBpbiBzdG9yYWdlIGJ1dCBhcmUgcmVwcmVzZW50ZWQgbmVpdGhlciBieSBhIGxpdmVcbiAqIGZvbGRlciBwbGFjZWhvbGRlciBpbiB0aGUgaW5kZXggbm9yIGJ5IGFueSBmaWxlIChpZ25vcmVkIG9yIG5vdCkgYmVuZWF0aFxuICogdGhlbSBcdTIwMTQgcGx1cyB0aGUgdG9tYnN0b25lZC1wbGFjZWhvbGRlciBzcGVjaWFsIGNhc2VzIHRoYXQgbWFrZSB0aGVcbiAqIGVtcHR5LWZvbGRlciBsaWZlY3ljbGUgZGVsZXRpb24tc2FmZTpcbiAqXG4gKiAgIC0gVE9NQlNUT05FRCBwbGFjZWhvbGRlciArIGNvbnRlbnQgYmVuZWF0aCBcdTIxOTIgYGVtcHR5Rm9sZGVyc2A6IHRoZSB1c2VyXG4gKiAgICAgcmVjcmVhdGVkIHRoZSBmb2xkZXI7IHJlc3RvcmluZyB0aGUgcGxhY2Vob2xkZXIgKFwibG9jYWwgd2luc1wiKSBpc1xuICogICAgIGNvcnJlY3QuIFRoZSByZWNyZWF0ZWQgRklMRVMgYmVuZWF0aCBzdXJmYWNlIHRocm91Z2ggYGFkZGVkYC9gbW9kaWZpZWRgXG4gKiAgICAgaW5kZXBlbmRlbnRseS5cbiAqICAgLSBUT01CU1RPTkVEIHBsYWNlaG9sZGVyICsgRU1QVFkgZGlyIG9uIGRpc2s6XG4gKiAgICAgICBcdTAwQjcgdG9tYnN0b25lIGF1dGhvcmVkIGJ5IEFOT1RIRVIgZGV2aWNlIChvciBhdXRob3IgdW5rbm93bikgXHUyMTkyXG4gKiAgICAgICAgIGBzdGFsZURpcnNgOiB0aGUgcmVjb3JkLW9ubHkgcmVzaWR1ZSBvZiBhIHJlbW90ZSBkZWxldGlvbixcbiAqICAgICAgICAgY29uc2lzdGVudCB3aXRoIHRoZSB0b21ic3RvbmUgXHUyMDE0IG5ldmVyIHJlc3VycmVjdGVkIChyZS1wdXNoaW5nIGl0IGFzXG4gKiAgICAgICAgIGFuIGVtcHR5IGZvbGRlciBpcyB3aGF0IG1hZGUgYSBwZWVyLXNpZGUgZGVsZXRpb24gcGluZy1wb25nXG4gKiAgICAgICAgIGZvcmV2ZXIpLiBUaGUgY2xpZW50IHJldHJpZXMgYHJlbW92ZURpcmAgb24gdGhlc2UgZGlycy5cbiAqICAgICAgIFx1MDBCNyB0b21ic3RvbmUgYXV0aG9yZWQgYnkgVEhJUyBkZXZpY2UgKGB0aGlzRGV2aWNlSWRgKSBcdTIxOTJcbiAqICAgICAgICAgYGVtcHR5Rm9sZGVyc2A6IG15IG93biBkZWxldGlvbiwgeWV0IGEgZGlyIGV4aXN0cyBoZXJlIG5vdyBcdTIwMTQgdGhlXG4gKiAgICAgICAgIHVzZXIgcmUtY3JlYXRlZCBpdCBsb2NhbGx5OyByZXN0b3JlIHRoZSBwbGFjZWhvbGRlci5cbiAqXG4gKiBBIGRpcmVjdG9yeSBjb250YWluaW5nIG9ubHkgaWdub3JlZCBmaWxlcyBpcyAqbm90KiBlbXB0eSBcdTIwMTQgaXQgaXNcbiAqIHJlcHJlc2VudGVkIGJ5IHRob3NlIGZpbGVzIGFzIGZhciBhcyB0aGUgbG9jYWwgbWFjaGluZSBpcyBjb25jZXJuZWQuXG4gKi9cbmZ1bmN0aW9uIGRldGVjdEVtcHR5Rm9sZGVycyhcbiAgaW5kZXg6IExvY2FsSW5kZXgsXG4gIHNldHRpbmdzOiBJZ25vcmVTZXR0aW5ncyxcbiAgZmlsZXM6IHJlYWRvbmx5IEZpbGVTdGF0W10sXG4gIGRpcnM6IHJlYWRvbmx5IHN0cmluZ1tdLFxuICB0aGlzRGV2aWNlSWQ/OiBzdHJpbmcsXG4pOiB7IGVtcHR5Rm9sZGVyczogc3RyaW5nW107IHN0YWxlRGlyczogc3RyaW5nW10gfSB7XG4gIGNvbnN0IHJlcHJlc2VudGVkRGlycyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBmb3IgKGNvbnN0IGZpbGUgb2YgZmlsZXMpIHtcbiAgICBmb3IgKGxldCBkaXIgPSBwYXJlbnRQYXRoKGZpbGUucGF0aCk7IGRpciAhPT0gJy8nOyBkaXIgPSBwYXJlbnRQYXRoKGRpcikpIHtcbiAgICAgIHJlcHJlc2VudGVkRGlycy5hZGQoZGlyKTtcbiAgICB9XG4gIH1cblxuICBjb25zdCBlbXB0eUZvbGRlcnM6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IHN0YWxlRGlyczogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChjb25zdCBkaXIgb2YgZGlycykge1xuICAgIGlmIChkaXIgPT09ICcvJykgY29udGludWU7XG4gICAgaWYgKGlzSWdub3JlZChkaXIsIHNldHRpbmdzKSkgY29udGludWU7XG4gICAgY29uc3QgZW50cnkgPSBpbmRleFtkaXJdO1xuICAgIGlmIChlbnRyeT8uaXNGb2xkZXIgJiYgZW50cnkuZGVsZXRlZEF0ID09PSB1bmRlZmluZWQpIGNvbnRpbnVlOyAvLyBsaXZlIHBsYWNlaG9sZGVyIFx1MjAxNCBhbHJlYWR5IHN5bmNlZFxuICAgIGlmIChlbnRyeT8uaXNGb2xkZXIgJiYgZW50cnkuZGVsZXRlZEF0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIC8vIFRvbWJzdG9uZWQgcGxhY2Vob2xkZXIgd2hvc2UgZGlyZWN0b3J5IHN0aWxsIGV4aXN0cy4gQ29udGVudCBiZW5lYXRoXG4gICAgICAvLyBcdTIxRDIgZ2VudWluZSByZWNyZWF0aW9uLiBFbXB0eSBcdTIxRDIgc3RhbGUgbGVmdG92ZXIgb2YgYSByZWNvcmQtb25seVxuICAgICAgLy8gdG9tYnN0b25lIGFwcGxpY2F0aW9uIFx1MjAxNCBVTkxFU1MgdGhpcyBkZXZpY2UgYXV0aG9yZWQgdGhlIHRvbWJzdG9uZVxuICAgICAgLy8gaXRzZWxmLCBpbiB3aGljaCBjYXNlIGEgcHJlc2VudCBkaXIgY2FuIG9ubHkgYmUgbG9jYWwgcmVjcmVhdGlvbi5cbiAgICAgIGlmIChyZXByZXNlbnRlZERpcnMuaGFzKGRpcikgfHwgZW50cnkuY2xvY2suZGV2aWNlSWQgPT09IHRoaXNEZXZpY2VJZCkge1xuICAgICAgICBlbXB0eUZvbGRlcnMucHVzaChkaXIpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc3RhbGVEaXJzLnB1c2goZGlyKTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAocmVwcmVzZW50ZWREaXJzLmhhcyhkaXIpKSBjb250aW51ZTsgLy8gcmVwcmVzZW50ZWQgYnkgaXRzIGZpbGVzXG4gICAgZW1wdHlGb2xkZXJzLnB1c2goZGlyKTtcbiAgfVxuICByZXR1cm4ge1xuICAgIGVtcHR5Rm9sZGVyczogZW1wdHlGb2xkZXJzLnNvcnQoKSxcbiAgICBzdGFsZURpcnM6IHN0YWxlRGlycy5zb3J0KCksXG4gIH07XG59XG5cbi8qKlxuICogTGl2ZSBmb2xkZXIgcGxhY2Vob2xkZXIgZW50cmllcyB3aG9zZSBkaXJlY3Rvcnkgbm8gbG9uZ2VyIGV4aXN0cyBpblxuICogc3RvcmFnZSBcdTIwMTQgdGhlIGZvbGRlciB3YXMgZGVsZXRlZCBsb2NhbGx5IChkaXJlY3RseSwgb3IgYnkgcHJ1bmUtb24tZGVsZXRlXG4gKiBlbXB0eWluZyBpdCkuIEVtaXRzIG9uZSBgRm9sZGVyRGVsZXRpb25DYW5kaWRhdGVgIHBlciBwbGFjZWhvbGRlciBzbyB0aGVcbiAqIHJlc29sdmUvY29tbWl0IHBhdGggcHVzaGVzIGEgZm9sZGVyIHRvbWJzdG9uZTsgYWxyZWFkeS10b21ic3RvbmVkXG4gKiBwbGFjZWhvbGRlcnMgYW5kIHBsYWNlaG9sZGVycyB0aGF0IG1lcmVseSBiZWNhbWUgaWdub3JlZCBhcmUgc2tpcHBlZC5cbiAqL1xuZnVuY3Rpb24gZGV0ZWN0Rm9sZGVyRGVsZXRpb25zKFxuICBpbmRleDogTG9jYWxJbmRleCxcbiAgc2V0dGluZ3M6IElnbm9yZVNldHRpbmdzLFxuICBkaXJzOiByZWFkb25seSBzdHJpbmdbXSxcbik6IEZvbGRlckRlbGV0aW9uQ2FuZGlkYXRlW10ge1xuICBjb25zdCBwcmVzZW50ID0gbmV3IFNldChkaXJzKTtcbiAgY29uc3QgZm9sZGVyRGVsZXRpb25zOiBGb2xkZXJEZWxldGlvbkNhbmRpZGF0ZVtdID0gW107XG4gIGZvciAoY29uc3QgW3BhdGgsIGVudHJ5XSBvZiBPYmplY3QuZW50cmllcyhpbmRleCkpIHtcbiAgICBpZiAoIWVudHJ5LmlzRm9sZGVyKSBjb250aW51ZTsgLy8gZmlsZXMgYXJlIGhhbmRsZWQgYnkgdGhlIGBkZWxldGVkYCBidWNrZXRcbiAgICBpZiAoZW50cnkuZGVsZXRlZEF0ICE9PSB1bmRlZmluZWQpIGNvbnRpbnVlOyAvLyBhbHJlYWR5IHRvbWJzdG9uZWRcbiAgICBpZiAocHJlc2VudC5oYXMocGF0aCkpIGNvbnRpbnVlOyAvLyBkaXJlY3Rvcnkgc3RpbGwgZXhpc3RzIFx1MjAxNCBubyBkZWxldGlvblxuICAgIGlmIChpc0lnbm9yZWQocGF0aCwgc2V0dGluZ3MpKSBjb250aW51ZTsgLy8gc2V0dGluZ3MgY2hhbmdlLCBub3QgYSBkZWxldGlvblxuICAgIGZvbGRlckRlbGV0aW9ucy5wdXNoKHsgcGF0aCwgdmVyc2lvbklkOiBlbnRyeS52ZXJzaW9uSWQgfSk7XG4gIH1cbiAgcmV0dXJuIGZvbGRlckRlbGV0aW9ucy5zb3J0KGJ5UGF0aCk7XG59XG5cbmZ1bmN0aW9uIHNvcnRDYW5kaWRhdGVzKGNhbmRpZGF0ZXM6IFNjYW5DYW5kaWRhdGVbXSk6IFNjYW5DYW5kaWRhdGVbXSB7XG4gIHJldHVybiBbLi4uY2FuZGlkYXRlc10uc29ydChieVBhdGgpO1xufVxuXG5mdW5jdGlvbiBieVBhdGg8VCBleHRlbmRzIHsgcGF0aD86IHN0cmluZzsgZnJvbT86IHN0cmluZyB9PihhOiBULCBiOiBUKTogbnVtYmVyIHtcbiAgY29uc3Qga2V5QSA9IGEucGF0aCA/PyBhLmZyb20gPz8gJyc7XG4gIGNvbnN0IGtleUIgPSBiLnBhdGggPz8gYi5mcm9tID8/ICcnO1xuICByZXR1cm4ga2V5QSA8IGtleUIgPyAtMSA6IGtleUEgPiBrZXlCID8gMSA6IDA7XG59XG4iLCAiLyoqXHJcbiAqIGBTeW5jQ2xpZW50YCBcdTIwMTQgdGhlIG5ldHdvcmstZmFjaW5nIG9yY2hlc3RyYXRvciAoQVJDSElURUNUVVJFLm1kIFx1MDBBNzgpLlxyXG4gKlxyXG4gKiBDb21wb3NlcyB0aGUgcGhhc2UtMWEvMWIgcGllY2VzIGludG8gb25lIGxvb3AgcGVyIGRldmljZTpcclxuICpcclxuICogICBzdGFydHVwOiAgbG9hZExvY2FsU3RhdGUgKGVudHJpZXMgKyBwZXJzaXN0ZWQgY3Vyc29yKSBcdTIxOTIgaGVsbG8vaGVsbG9BY2tcclxuICogICAgICAgICAgICAgKHNlcnZlciByZXBvcnRzIGBvbGRlc3RSZXRhaW5lZFNlcWApIFx1MjE5MiBnZXRNYW5pZmVzdCBcdTIwMTQgYSBERUxUQVxyXG4gKiAgICAgICAgICAgICBtYW5pZmVzdCAoYHNpbmNlOiBzeW5jZWRUaHJvdWdoYCkgbWVyZ2VkIG92ZXIgdGhlIGluZGV4XHJcbiAqICAgICAgICAgICAgIHByb2plY3Rpb24gd2hlbiB0aGUgcmVwbGF5IHdpbmRvdyBpcyBpbnRhY3QsIGVsc2UgZnVsbCBcdTIxOTJcclxuICogICAgICAgICAgICAgc2NhblZhdWx0IFx1MjE5MiBjb21wdXRlU3luY1BsYW4gXHUyMTkyIGV4ZWN1dGUgKHB1c2hlcyB0aHJvdWdoIGFcclxuICogICAgICAgICAgICAgYm91bmRlZC1jb25jdXJyZW5jeSBwaXBlbGluZSwgcHVsbHMgdmlhIGFwcGx5UHVsbCB3aXRoIHRoZVxyXG4gKiAgICAgICAgICAgICBpbmplY3RlZCBibG9iIHN0b3JlKTtcclxuICogICBsaXZlOiAgICAgYGNoYW5nZWAgbWVzc2FnZXMgbWF0ZXJpYWxpemUgaW1tZWRpYXRlbHkgd2hlbiB0aGUgdGFyZ2V0IGlzXHJcbiAqICAgICAgICAgICAgIGNsZWFuLCBhbmQgZGVmZXIgdG8gYSBmdWxsIHJlY29uY2lsZSBjeWNsZSB3aGVuIGl0IGlzIG5vdCBcdTIwMTQgYVxyXG4gKiAgICAgICAgICAgICByZW1vdGUgY2hhbmdlIGlzIE5FVkVSIHdyaXR0ZW4gb3ZlciBsb2NhbGx5LW1vZGlmaWVkIGNvbnRlbnRcclxuICogICAgICAgICAgICAgd2l0aG91dCBnb2luZyB0aHJvdWdoIGBjb21wdXRlU3luY1BsYW5gJ3MgY29uZmxpY3QgbG9naWM7XHJcbiAqICAgd2F0Y2hlcjogIGBXYXRjaEFkYXB0ZXJgIGJhdGNoZXMgYXJlIGRlYm91bmNlZCAofjMwMCBtcywgaW5qZWN0YWJsZVxyXG4gKiAgICAgICAgICAgICBzY2hlZHVsZXIgXHUyMDE0IG5vIGFtYmllbnQgdGltZXJzIGluIHRlc3RzKSBpbnRvIHNjYW5cdTIxOTJwbGFuXHUyMTkyZXhlY3V0ZTtcclxuICogICByZWNvbm5lY3Q6IGBvbkNsb3NlYCBmbGlwcyB0byBgJ2Rpc2Nvbm5lY3RlZCdgOyBgcmVjb25uZWN0KClgIHJlLXJ1bnMgdGhlXHJcbiAqICAgICAgICAgICAgIHdob2xlIHN0YXJ0dXAgcmVjb25jaWxpYXRpb24gKGJhY2tvZmYgaXMgdGhlIGNhbGxlcidzIGpvYikuXHJcbiAqXHJcbiAqIEJ1bGsgcGhhc2VzIHJlcG9ydCBYL1kgb24gYHN0YXR1cygpLnByb2dyZXNzYCAodGhyb3R0bGVkIHZpYSB0aGUgaW5qZWN0ZWRcclxuICogY2xvY2spOyB0aGUgcHVzaCBwaGFzZSBrZWVwcyB1cCB0byBgcHVzaENvbmN1cnJlbmN5YCBjb21taXRzIGluIGZsaWdodC5cclxuICpcclxuICogQWxsIEkvTyBjcm9zc2VzIHRoZSBhZGFwdGVyIHNlYW1zIChgU3RvcmFnZUFkYXB0ZXJgLCBgVHJhbnNwb3J0YCxcclxuICogYEJsb2JTdG9yZWAsIGBMb2dBZGFwdGVyYCk7IHRoZSBjbGFzcyBpdHNlbGYgaXMgcHVyZSBvcmNoZXN0cmF0aW9uIGFuZCBydW5zXHJcbiAqIGFueXdoZXJlIGBjb3JlYCBydW5zIFx1MjAxNCBXb3JrZXJzIHRlc3RzIGluY2x1ZGVkLlxyXG4gKi9cclxuXHJcbmltcG9ydCB0eXBlIHsgTG9nQWRhcHRlciwgU3RvcmFnZUFkYXB0ZXIsIFdhdGNoQWRhcHRlciB9IGZyb20gJy4vYWRhcHRlcnMuanMnO1xyXG5pbXBvcnQgeyBjb21wYXJlQ2xvY2tzIH0gZnJvbSAnLi9jbG9jay5qcyc7XHJcbmltcG9ydCB7IGFwcGx5UHVsbCwgbG9hZExvY2FsU3RhdGUsIHBydW5lUGFyZW50T25EZWxldGUsIHJlbW92ZURpcklmVmFjYW50LCB0eXBlIEZldGNoQmxvYiB9IGZyb20gJy4vZW5naW5lLmpzJztcclxuaW1wb3J0IHsgTmV0d29ya0Vycm9yLCBQcm90b2NvbEVycm9yLCBSZXZva2VkRXJyb3IsIFVuYXV0aG9yaXplZEVycm9yIH0gZnJvbSAnLi9lcnJvcnMuanMnO1xyXG5pbXBvcnQgeyBzaGEyNTZIZXggfSBmcm9tICcuL2hhc2hpbmcuanMnO1xyXG5pbXBvcnQgeyBpc0lnbm9yZWQsIHR5cGUgSWdub3JlU2V0dGluZ3MgfSBmcm9tICcuL2lnbm9yZS5qcyc7XHJcbmltcG9ydCB7XHJcbiAgYXBwbHlDb21taXQsXHJcbiAgTE9DQUxfSU5ERVhfU1RBVEVfUEFUSCxcclxuICByZW1vdmVFbnRyeSxcclxuICBzZXJpYWxpemVMb2NhbEluZGV4LFxyXG4gIHR5cGUgTG9jYWxJbmRleCxcclxuICB0eXBlIFBlcnNpc3RlZFN5bmNTdGF0ZSxcclxufSBmcm9tICcuL2xvY2FsaW5kZXguanMnO1xyXG5pbXBvcnQgeyBpc1dpbmRvd3NVbnNhZmVQYXRoIH0gZnJvbSAnLi9wYXRocy5qcyc7XHJcbmltcG9ydCB7XHJcbiAgYmFzZTY0VG9CeXRlcyxcclxuICBieXRlc1RvQmFzZTY0LFxyXG4gIElOTElORV9DT05URU5UX01BWF9CWVRFUyxcclxuICBQcm90b2NvbFZlcnNpb24sXHJcbiAgdmFsaWRhdGVDaGFuZ2VNZXNzYWdlLFxyXG4gIHZhbGlkYXRlQ29tbWl0QWNrTWVzc2FnZSxcclxuICB2YWxpZGF0ZUNvbmZsaWN0TWVzc2FnZSxcclxuICB2YWxpZGF0ZU1hbmlmZXN0TWVzc2FnZSxcclxuICB0eXBlIEJsb2JBY2tNZXNzYWdlLFxyXG4gIHR5cGUgQmxvYk1lc3NhZ2UsXHJcbiAgdHlwZSBDaGFuZ2VNZXNzYWdlLFxyXG4gIHR5cGUgQ29tbWl0QWNrTWVzc2FnZSxcclxuICB0eXBlIENvbW1pdE1lc3NhZ2UsXHJcbiAgdHlwZSBDb25mbGljdE1lc3NhZ2UsXHJcbiAgdHlwZSBIZWxsb0Fja01lc3NhZ2UsXHJcbiAgdHlwZSBNYW5pZmVzdE1lc3NhZ2UsXHJcbiAgdHlwZSBNZXNzYWdlLFxyXG4gIHR5cGUgU2VydmVyTWVzc2FnZSxcclxuICB0eXBlIFNuYXBzaG90Q3JlYXRlQWNrTWVzc2FnZSxcclxuICB0eXBlIFNuYXBzaG90UmVzdG9yZUFja01lc3NhZ2UsXHJcbn0gZnJvbSAnLi9wcm90b2NvbC5qcyc7XHJcbmltcG9ydCB7XHJcbiAgY29tcHV0ZVN5bmNQbGFuLFxyXG4gIHR5cGUgQ29uZmxpY3RPcCxcclxuICB0eXBlIFB1bGxGaWxlT3AsXHJcbiAgdHlwZSBQdWxsT3AsXHJcbiAgdHlwZSBQdXNoT3AsXHJcbiAgdHlwZSBSZW1vdGVGaWxlLFxyXG4gIHR5cGUgU3luY1BsYW4sXHJcbn0gZnJvbSAnLi9yZXNvbHZlLmpzJztcclxuaW1wb3J0IHsgcmVjb3JkSGFzaGVkRmlsZXMsIHNjYW5WYXVsdCwgdHlwZSBIYXNoZWRGaWxlIH0gZnJvbSAnLi9zY2FuLmpzJztcclxuaW1wb3J0IHR5cGUgeyBUcmFuc3BvcnQgfSBmcm9tICcuL3RyYW5zcG9ydC5qcyc7XHJcbmltcG9ydCB0eXBlIHsgTG9naWNhbENsb2NrIH0gZnJvbSAnLi90eXBlcy5qcyc7XHJcblxyXG4vLyAtLS0gcHVibGljIG9wdGlvbi9zdGF0dXMgc2hhcGVzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblxyXG4vKiogQ2xpZW50LXNpZGUgY29udGVudC1hZGRyZXNzZWQgYmxvYiBjYWNoZSAoUjIgY2xpZW50IGluIHByb2R1Y3Rpb247IGEgTWFwIGluIHRlc3RzKS4gKi9cclxuZXhwb3J0IGludGVyZmFjZSBCbG9iU3RvcmUge1xyXG4gIGdldChoYXNoOiBzdHJpbmcpOiBQcm9taXNlPFVpbnQ4QXJyYXkgfCB1bmRlZmluZWQ+O1xyXG4gIHB1dChoYXNoOiBzdHJpbmcsIGJ5dGVzOiBVaW50OEFycmF5KTogUHJvbWlzZTx2b2lkPjtcclxufVxyXG5cclxuZXhwb3J0IGludGVyZmFjZSBTeW5jQ2xpZW50T3B0aW9ucyB7XHJcbiAgZGV2aWNlSWQ6IHN0cmluZztcclxuICBkZXZpY2VOYW1lOiBzdHJpbmc7XHJcbiAgdG9rZW46IHN0cmluZztcclxuICAvKiogQSBmYWN0b3J5IChyZWNvbm5lY3QgZGlhbHMgZnJlc2gpIG9yIGEgc2luZ2xlIHJldXNhYmxlIGluc3RhbmNlLiAqL1xyXG4gIHRyYW5zcG9ydDogKCgpID0+IFRyYW5zcG9ydCkgfCBUcmFuc3BvcnQ7XHJcbiAgYmxvYlN0b3JlOiBCbG9iU3RvcmU7XHJcbiAgc3RvcmFnZTogU3RvcmFnZUFkYXB0ZXI7XHJcbiAgbG9nPzogTG9nQWRhcHRlcjtcclxuICAvKiogSW5pdGlhbCBpZ25vcmUgc2V0dGluZ3M7IHN1cGVyc2VkZWQgYnkgYGhlbGxvQWNrLnNldHRpbmdzYCBvbiBjb25uZWN0LiAqL1xyXG4gIHNldHRpbmdzPzogSWdub3JlU2V0dGluZ3M7XHJcbiAgLyoqIEluamVjdGFibGUgY2xvY2sgKGRlZmF1bHQgYERhdGUubm93YCkuICovXHJcbiAgbm93PzogKCkgPT4gbnVtYmVyO1xyXG4gIC8qKiBXYXRjaGVyIGRlYm91bmNlIHdpbmRvdyBpbiBtcyAoZGVmYXVsdCAzMDApLiAqL1xyXG4gIGRlYm91bmNlTXM/OiBudW1iZXI7XHJcbiAgLyoqXHJcbiAgICogU2NoZWR1bGVzIHRoZSBkZWJvdW5jZWQgc3luYyBjeWNsZS4gRGVmYXVsdDogYHNldFRpbWVvdXRgLiBUZXN0cyBpbmplY3QgYVxyXG4gICAqIG1hbnVhbCBxdWV1ZSBcdTIwMTQgdGhlIGNsaWVudCBuZXZlciB0b3VjaGVzIGEgcmVhbCB0aW1lciBiZWhpbmQgdGhpcyBzZWFtLlxyXG4gICAqL1xyXG4gIHNjaGVkdWxlPzogKGZuOiAoKSA9PiB2b2lkLCBtczogbnVtYmVyKSA9PiAoKSA9PiB2b2lkO1xyXG4gIC8qKlxyXG4gICAqIEJvdW5kZWQgY29uY3VycmVuY3kgb2YgdGhlIHB1c2ggcGlwZWxpbmU6IGhvdyBtYW55IGNvbW1pdHMgbWF5IGJlIGluXHJcbiAgICogZmxpZ2h0IChzZW50LCBhd2FpdGluZyBhY2spIGF0IG9uY2UuIERlZmF1bHQgOC4gQ29uZmxpY3QgYXJiaXRyYXRpb24gaXNcclxuICAgKiBzZXJ2ZXItc2lkZSBhbmQgUEVSIFBBVEgsIGFuZCBhIGN5Y2xlIHN0YWdlcyBhdCBtb3N0IG9uZSBjb21taXQgcGVyIHBhdGgsXHJcbiAgICogc28gb3JkZXJpbmcgYWNyb3NzIGRpZmZlcmVudCBmaWxlcyBpcyBpcnJlbGV2YW50IFx1MjAxNCBzZWVcclxuICAgKiBgcnVuUHVzaFBpcGVsaW5lYCBmb3IgdGhlIGZ1bGwgYXJndW1lbnQuXHJcbiAgICovXHJcbiAgcHVzaENvbmN1cnJlbmN5PzogbnVtYmVyO1xyXG4gIC8qKlxyXG4gICAqIE1pbmltdW0gd2FsbC1jbG9jayBtcyBiZXR3ZWVuIGBzdGF0dXMoKS5wcm9ncmVzc2AgdXBkYXRlcyBkdXJpbmcgYnVsa1xyXG4gICAqIHBoYXNlcyAoZGVmYXVsdCA1MCBcdTIwMTQgcmVuZGVyZXIgY29hbGVzY2luZzsgcGhhc2UgY2hhbmdlcyBhbmQgY29tcGxldGlvbnNcclxuICAgKiBhbHdheXMgZW1pdCkuIFRlc3RzIHBhc3MgMCB0byBvYnNlcnZlIGV2ZXJ5IGZpbGUuXHJcbiAgICovXHJcbiAgcHJvZ3Jlc3NUaHJvdHRsZU1zPzogbnVtYmVyO1xyXG59XHJcblxyXG5leHBvcnQgdHlwZSBTeW5jQ2xpZW50U3RhdGUgPSAnaWRsZScgfCAnY29ubmVjdGluZycgfCAnc3luY2luZycgfCAnbGl2ZScgfCAnZGlzY29ubmVjdGVkJztcclxuXHJcbi8qKiBUaGUgYnVsayBwaGFzZSBhIHJ1bm5pbmcgY3ljbGUgaXMgY3VycmVudGx5IGdyaW5kaW5nIHRocm91Z2guICovXHJcbmV4cG9ydCB0eXBlIFN5bmNQaGFzZSA9ICdzY2FubmluZycgfCAncHVzaGluZycgfCAncHVsbGluZyc7XHJcblxyXG4vKiogWC9ZIHByb2dyZXNzIG9mIG9uZSBidWxrIHBoYXNlOyBwcmVzZW50IG9uIGBTeW5jQ2xpZW50U3RhdHVzYCBtaWQtY3ljbGUgb25seS4gKi9cclxuZXhwb3J0IGludGVyZmFjZSBTeW5jUHJvZ3Jlc3Mge1xyXG4gIHBoYXNlOiBTeW5jUGhhc2U7XHJcbiAgZG9uZTogbnVtYmVyO1xyXG4gIHRvdGFsOiBudW1iZXI7XHJcbn1cclxuXHJcbmV4cG9ydCBpbnRlcmZhY2UgU3luY0NsaWVudFN0YXR1cyB7XHJcbiAgc3RhdGU6IFN5bmNDbGllbnRTdGF0ZTtcclxuICAvKiogRXBvY2ggbXMgb2YgdGhlIGxhc3QgY29tcGxldGVkIGN5Y2xlLCBvciBudWxsIGJlZm9yZSB0aGUgZmlyc3QuICovXHJcbiAgbGFzdFN5bmNBdDogbnVtYmVyIHwgbnVsbDtcclxuICAvKiogV2F0Y2hlci9yZWNvbmNpbGUgZXZlbnRzIHF1ZXVlZCBiZWhpbmQgdGhlIGRlYm91bmNlIHdpbmRvdy4gKi9cclxuICBwZW5kaW5nOiBudW1iZXI7XHJcbiAgLyoqXHJcbiAgICogQ29uZmxpY3RzIG9ic2VydmVkIGJ5IHRoZSBtb3N0IHJlY2VudCBwbGFuIGN5Y2xlIChpbmZvcm1hdGlvbmFsO1xyXG4gICAqIHJlc29sdXRpb24gaXMgaW4gdGhlIGRhdGEpLiBSZXBsYWNlZCBldmVyeSBjeWNsZSBcdTIwMTQgYSBsYXRlciBjeWNsZSB0aGF0XHJcbiAgICogcGxhbnMgY2xlYW4gY2xlYXJzIGl0LCBzbyBhIHN5bmNlZC1xdWlldCBjbGllbnQgcmVwb3J0cyAwLlxyXG4gICAqL1xyXG4gIGNvbmZsaWN0czogQ29uZmxpY3RPcFtdO1xyXG4gIC8qKlxyXG4gICAqIFBhdGhzIHdob3NlIGxpdmUgaW5kZXggZW50cnkgaXMgSU5WSVNJQkxFIG9uIHRoaXMgZmlsZXN5c3RlbSBiZWNhdXNlXHJcbiAgICogYW5vdGhlciBzeW5jZWQgZmlsZSBkaWZmZXJzIGZyb20gaXQgb25seSBieSBuYW1lIGNhc2UgKGEgY2FzZS1jb2xsaWRpbmdcclxuICAgKiBwYWlyLCBjcmVhdGFibGUgZnJvbSBhIGNhc2Utc2Vuc2l0aXZlIGNsaWVudCBcdTIwMTQgQVJDSElURUNUVVJFIFx1MDBBNzE0KS4gVGhlXHJcbiAgICogc2NhbiBuZXZlciBwdXNoZXMgYSBkZWxldGlvbiBmb3IgdGhlbTsgdGhleSBhcmUgc3VyZmFjZWQgaGVyZSAoYW5kIHZpYSBhXHJcbiAgICogYHdhcm5gIGxvZyBsaW5lIHBlciBjeWNsZSkgdW50aWwgYSBodW1hbiByZW5hbWVzIG9uZSBvZiB0aGUgcGFpci5cclxuICAgKiBSZXBsYWNlZCBldmVyeSBjeWNsZSBsaWtlIGBjb25mbGljdHNgOyBvbWl0dGVkIHdoZW4gdGhlcmUgYXJlIG5vbmUuXHJcbiAgICovXHJcbiAgY2FzZUNvbGxpc2lvbnM/OiBzdHJpbmdbXTtcclxuICAvKipcclxuICAgKiBQYXRocyB0aGUgbW9zdCByZWNlbnQgY3ljbGUgU0tJUFBFRCBiZWNhdXNlIHRoZWlyIG5hbWVzIGNhbm5vdCBiZVxyXG4gICAqIG1hdGVyaWFsaXplZCBvbiBXaW5kb3dzIChyZXNlcnZlZCBkZXZpY2UgbmFtZXMgbGlrZSBgQ09OYC9gTlVMYC9gQ09NMWAsXHJcbiAgICogb3Igc2VnbWVudHMgZW5kaW5nIGluIGAuYC9gIGAgXHUyMDE0IHNlZSBgcGF0aHMudHNgKS4gTG9jYWwgZmlsZXMgd2l0aCBzdWNoXHJcbiAgICogbmFtZXMgYXJlIG5ldmVyIHB1c2hlZCBhbmQgcmVtb3RlIGhlYWRzIGF0IHN1Y2ggcGF0aHMgYXJlIG5ldmVyIGFwcGxpZWQ7XHJcbiAgICogYSBsYXRlciB2ZXJzaW9uIGNoYW5nZSBhdCB0aGUgcGF0aCBpcyBhdHRlbXB0ZWQgYWdhaW4uIFN1cmZhY2VkIGhlcmVcclxuICAgKiAoYW5kIHZpYSBhIGB3YXJuYCBsb2cgbGluZSkgdW50aWwgYSBodW1hbiByZW5hbWVzIHRoZSBwYXRoOyByZXBsYWNlZFxyXG4gICAqIGV2ZXJ5IGN5Y2xlIGxpa2UgYGNvbmZsaWN0c2AuIE9taXR0ZWQgd2hlbiB0aGVyZSBhcmUgbm9uZS5cclxuICAgKi9cclxuICBza2lwcGVkUGF0aHM/OiBzdHJpbmdbXTtcclxuICAvKipcclxuICAgKiBTZXJ2ZXIgcmVsZWFzZSB2ZXJzaW9uIGFzIHJlcG9ydGVkIGJ5IGhlbGxvQWNrIChudWxsIGJlZm9yZSB0aGUgZmlyc3RcclxuICAgKiBhY2sgXHUyMDE0IGFuZCBmb3IgbGVnYWN5IHNlcnZlcnMgXHUyMjY0IDAuMSwgd2hpY2ggbmV2ZXIgc2VuZCB0aGUgZmllbGQ7IHNlZVxyXG4gICAqIGBjaGVja1NlcnZlckNvbXBhdGliaWxpdHlgIGZvciB0aGUgc2hhcmVkIHNrZXcgcG9saWN5KS5cclxuICAgKi9cclxuICBzZXJ2ZXJWZXJzaW9uOiBzdHJpbmcgfCBudWxsO1xyXG4gIC8qKlxyXG4gICAqIFByb2dyZXNzIG9mIHRoZSBSVU5OSU5HIGN5Y2xlJ3MgY3VycmVudCBidWxrIHBoYXNlIChgdnNhIFx1MjJFRiAxMjM0LzUwMDBgKTtcclxuICAgKiBhYnNlbnQgYmV0d2VlbiBjeWNsZXMuIFVwZGF0ZXMgYXJlIHRocm90dGxlZCB0byBgcHJvZ3Jlc3NUaHJvdHRsZU1zYC5cclxuICAgKi9cclxuICBwcm9ncmVzcz86IFN5bmNQcm9ncmVzcztcclxufVxyXG5cclxuLyoqIERlZmF1bHQgaW4tZmxpZ2h0IGNvbW1pdCBjYXAgKHNlZSBgU3luY0NsaWVudE9wdGlvbnMucHVzaENvbmN1cnJlbmN5YCkuICovXHJcbmV4cG9ydCBjb25zdCBERUZBVUxUX1BVU0hfQ09OQ1VSUkVOQ1kgPSA4O1xyXG4vKiogRGVmYXVsdCBwcm9ncmVzcyBjb2FsZXNjaW5nIHdpbmRvdyAoc2VlIGBTeW5jQ2xpZW50T3B0aW9ucy5wcm9ncmVzc1Rocm90dGxlTXNgKS4gKi9cclxuZXhwb3J0IGNvbnN0IERFRkFVTFRfUFJPR1JFU1NfVEhST1RUTEVfTVMgPSA1MDtcclxuXHJcbmNvbnN0IGRlZmF1bHRMb2c6IExvZ0FkYXB0ZXIgPSB7XHJcbiAgZGVidWc6ICgpID0+IHt9LFxyXG4gIGluZm86ICgpID0+IHt9LFxyXG4gIHdhcm46ICgpID0+IHt9LFxyXG4gIGVycm9yOiAoKSA9PiB7fSxcclxufTtcclxuXHJcbmNvbnN0IGRlZmF1bHRTY2hlZHVsZSA9IChmbjogKCkgPT4gdm9pZCwgbXM6IG51bWJlcik6ICgoKSA9PiB2b2lkKSA9PiB7XHJcbiAgY29uc3QgaGFuZGxlID0gZ2xvYmFsVGhpcy5zZXRUaW1lb3V0KGZuLCBtcykgYXMgdW5rbm93biBhcyBudW1iZXI7XHJcbiAgcmV0dXJuICgpID0+IGdsb2JhbFRoaXMuY2xlYXJUaW1lb3V0KGhhbmRsZSk7XHJcbn07XHJcblxyXG4vKiogQSBjb21taXQgcHJlcGFyZWQgZm9yIHRoZSB3aXJlIChhIGBQdXNoT3BgICsgaXRzIHN0YWdlZCBjb250ZW50KS4gKi9cclxuaW50ZXJmYWNlIFN0YWdlZENvbW1pdCB7XHJcbiAga2luZDogQ29tbWl0TWVzc2FnZVsna2luZCddO1xyXG4gIHBhdGg6IHN0cmluZztcclxuICBwYXJlbnRWZXJzaW9uOiBzdHJpbmcgfCBudWxsO1xyXG4gIGhhc2g6IHN0cmluZztcclxuICBzaXplOiBudW1iZXI7XHJcbiAgZnJvbVBhdGg/OiBzdHJpbmc7XHJcbiAgaXNGb2xkZXI/OiBib29sZWFuO1xyXG4gIGJ5dGVzPzogVWludDhBcnJheTtcclxuICAvKipcclxuICAgKiBTdG9yYWdlIG10aW1lIG9ic2VydmVkIGJ5IFRISVMgY3ljbGUncyBzY2FuIHdoZW4gaXQgaGFzaGVkIHRoZSBjb250ZW50XHJcbiAgICogKGBIYXNoZWRGaWxlLm10aW1lYCBvZiB0aGUgcHVzaCBzb3VyY2UpLiBQaW5uZWQgb250byB0aGUgaW5kZXggZW50cnkgd2hlblxyXG4gICAqIHRoZSBhY2sgbGFuZHMsIHNvIHRoZSBlbnRyeSdzIChoYXNoLCBzaXplLCBtdGltZSkgYWx3YXlzIGRlc2NyaWJlcyBPTkVcclxuICAgKiBjb25zaXN0ZW50IGluc3RhbnQgb2YgdGhlIGZpbGUgXHUyMDE0IG5ldmVyIGEgbGF0ZXIgc3RhdCBwYWlyZWQgd2l0aCB0aGlzXHJcbiAgICogaGFzaC4gVGhhdCBvcmRlcmluZyBpcyB3aGF0IGxldHMgdGhlIHNjYW4gZmFzdC1wYXRoIChtdGltZStzaXplKSBza2lwXHJcbiAgICogcmUtaGFzaGluZyBzYWZlbHk6IGFuIGVkaXQgbGFuZGluZyBiZXR3ZWVuIGhhc2ggYW5kIGFjayBjaGFuZ2VzIHRoZSBkaXNrXHJcbiAgICogc3RhdCwgbWlzc2VzIHRoZSBmYXN0IHBhdGgsIGFuZCBpcyByZS1oYXNoZWQgYW5kIHB1c2hlZCBvbiB0aGUgbmV4dCBzY2FuLlxyXG4gICAqL1xyXG4gIG10aW1lPzogbnVtYmVyO1xyXG59XHJcblxyXG4vLyAtLS0gdGhlIGNsaWVudCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHJcbmV4cG9ydCBjbGFzcyBTeW5jQ2xpZW50IHtcclxuICBwcml2YXRlIHJlYWRvbmx5IG9wdGlvbnM6IFN5bmNDbGllbnRPcHRpb25zO1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgbG9nOiBMb2dBZGFwdGVyO1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgbm93OiAoKSA9PiBudW1iZXI7XHJcbiAgcHJpdmF0ZSByZWFkb25seSBkZWJvdW5jZU1zOiBudW1iZXI7XHJcbiAgcHJpdmF0ZSByZWFkb25seSBzY2hlZHVsZTogKGZuOiAoKSA9PiB2b2lkLCBtczogbnVtYmVyKSA9PiAoKSA9PiB2b2lkO1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgZGlhbFRyYW5zcG9ydDogKCkgPT4gVHJhbnNwb3J0O1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgcHVzaENvbmN1cnJlbmN5OiBudW1iZXI7XHJcbiAgcHJpdmF0ZSByZWFkb25seSBwcm9ncmVzc1Rocm90dGxlTXM6IG51bWJlcjtcclxuXHJcbiAgcHJpdmF0ZSB0cmFuc3BvcnQ6IFRyYW5zcG9ydCB8IG51bGwgPSBudWxsO1xyXG4gIHByaXZhdGUgc3RhdGU6IFN5bmNDbGllbnRTdGF0ZSA9ICdpZGxlJztcclxuICBwcml2YXRlIGluZGV4OiBMb2NhbEluZGV4ID0ge307XHJcbiAgcHJpdmF0ZSBjdXJzb3IgPSAwO1xyXG4gIHByaXZhdGUgbGFzdFN5bmNBdDogbnVtYmVyIHwgbnVsbCA9IG51bGw7XHJcbiAgcHJpdmF0ZSBwZW5kaW5nID0gMDtcclxuICBwcml2YXRlIGNvbmZsaWN0czogQ29uZmxpY3RPcFtdID0gW107XHJcbiAgcHJpdmF0ZSBjYXNlQ29sbGlzaW9uczogc3RyaW5nW10gPSBbXTtcclxuICBwcml2YXRlIHNraXBwZWRQYXRoczogc3RyaW5nW10gPSBbXTtcclxuICBwcml2YXRlIGlnbm9yZVNldHRpbmdzOiBJZ25vcmVTZXR0aW5ncztcclxuICBwcml2YXRlIHdhdGNoQWRhcHRlcjogV2F0Y2hBZGFwdGVyIHwgbnVsbCA9IG51bGw7XHJcbiAgcHJpdmF0ZSBjYW5jZWxEZWJvdW5jZTogKCgpID0+IHZvaWQpIHwgbnVsbCA9IG51bGw7XHJcblxyXG4gIC8qKlxyXG4gICAqIERlbHRhLW1hbmlmZXN0IGJvb2trZWVwaW5nIChwZXJzaXN0ZWQgYWxvbmdzaWRlIHRoZSBpbmRleCwgc2VlXHJcbiAgICogYFBlcnNpc3RlZFN5bmNTdGF0ZWApOiBgc3luY2VkVGhyb3VnaGAgXHUyMDE0IHRoZSBtYW5pZmVzdCBjdXJzb3Igb2YgdGhlIGxhc3RcclxuICAgKiBmdWxseS1zdWNjZXNzZnVsIGN5Y2xlLCBpLmUuIHRoZSBzZXEgdGhyb3VnaCB3aGljaCB0aGUgaW5kZXggaXMga25vd25cclxuICAgKiBDT01QTEVURSAobnVsbCB1bnRpbCBvbmUgZmluaXNoZXMpOyBgbmVlZHNGdWxsTWFuaWZlc3RgIFx1MjAxNCBhIHJlbW90ZSBjaGFuZ2VcclxuICAgKiB3YXMgZGVmZXJyZWQgb3ZlciBsb2NhbCBkaXZlcmdlbmNlIGFuZCBtdXN0IGJlIHJlc29sdmVkIHRocm91Z2ggYSBmdWxsXHJcbiAgICogbWFuaWZlc3QncyBwbGFuIGxvZ2ljOyBgc2VydmVyT2xkZXN0UmV0YWluZWRTZXFgIFx1MjAxNCB0aGUgaGVsbG9BY2sncyBhbnN3ZXJcclxuICAgKiB0byBcImlzIG15IHJlcGxheSB3aW5kb3cgaW50YWN0XCIgKG51bGwgZm9yIGxlZ2FjeSBzZXJ2ZXJzIFx1MjFEMiBhbHdheXMgZnVsbCkuXHJcbiAgICovXHJcbiAgcHJpdmF0ZSBzeW5jZWRUaHJvdWdoOiBudW1iZXIgfCBudWxsID0gbnVsbDtcclxuICBwcml2YXRlIG5lZWRzRnVsbE1hbmlmZXN0ID0gZmFsc2U7XHJcbiAgcHJpdmF0ZSBzZXJ2ZXJPbGRlc3RSZXRhaW5lZFNlcTogbnVtYmVyIHwgbnVsbCA9IG51bGw7XHJcbiAgLyoqIFNlcnZlciByZWxlYXNlIGZyb20gaGVsbG9BY2s7IG51bGwgdW50aWwgYWNrZWQgKGxlZ2FjeSBzZXJ2ZXJzIHN0YXkgbnVsbCkuICovXHJcbiAgcHJpdmF0ZSBzZXJ2ZXJWZXJzaW9uOiBzdHJpbmcgfCBudWxsID0gbnVsbDtcclxuXHJcbiAgLyoqIEN1cnJlbnQgYnVsay1waGFzZSBwcm9ncmVzcywgY2xlYXJlZCB3aGVuIGEgY3ljbGUgc2V0dGxlcy4gKi9cclxuICBwcml2YXRlIHByb2dyZXNzOiBTeW5jUHJvZ3Jlc3MgfCBudWxsID0gbnVsbDtcclxuICBwcml2YXRlIGxhc3RQcm9ncmVzc0F0ID0gMDtcclxuXHJcbiAgLyoqIFNlcmlhbGl6ZWQgb3BlcmF0aW9uIHF1ZXVlIFx1MjAxNCBleGFjdGx5IG9uZSBhc3luYyBvcCBydW5zIGF0IGEgdGltZS4gKi9cclxuICBwcml2YXRlIHRhaWw6IFByb21pc2U8dW5rbm93bj4gPSBQcm9taXNlLnJlc29sdmUoKTtcclxuICBwcml2YXRlIHF1ZXVlZE9wcyA9IDA7XHJcbiAgLyoqIFN0YXJ0dXAtdGltZSBjaGFuZ2UgZmxvb2QgaXMgYnVmZmVyZWQ7IHRoZSBmdWxsIG1hbmlmZXN0IHN1YnN1bWVzIGl0LiAqL1xyXG4gIHByaXZhdGUgYnVmZmVyaW5nID0gZmFsc2U7XHJcbiAgcHJpdmF0ZSBidWZmZXJlZDogTWVzc2FnZVtdID0gW107XHJcbiAgLyoqXHJcbiAgICogT3V0c3RhbmRpbmcgcmVxdWVzdCBleHBlY3RhdGlvbnMsIG9sZGVzdCBmaXJzdC4gT3BzIGFyZSBzZXJpYWxpemVkIHBlclxyXG4gICAqIGN5Y2xlIEVYQ0VQVCB0aGUgcHVzaCBwaXBlbGluZSwgd2hpY2gga2VlcHMgc2V2ZXJhbCBjb21taXRzIGluIGZsaWdodCBcdTIwMTRcclxuICAgKiByZXBsaWVzIG9uIHRoZSBvcmRlcmVkIFdTIGFycml2ZSBpbiBzZW5kIG9yZGVyLCBzbyBtYXRjaGluZyB0aGUgT0xERVNUXHJcbiAgICogZXhwZWN0YXRpb24gdGhhdCBhY2NlcHRzIGEgbWVzc2FnZSBwYWlycyBldmVyeSByZXBseSB3aXRoIGl0cyByZXF1ZXN0XHJcbiAgICogKHRoZSBETyBhcmJpdHJhdGVzIGJlaGluZCBgcnVuRXhjbHVzaXZlYCwgYW5kIHRoZSBpbi1tZW1vcnkgc2VydmVyXHJcbiAgICogbWlycm9ycyB0aGF0LCBzbyB0aGUgc2VydmVyIG5ldmVyIHJlb3JkZXJzIHJlcGxpZXMgZWl0aGVyKS5cclxuICAgKi9cclxuICBwcml2YXRlIGV4cGVjdGF0aW9uczogQXJyYXk8e1xyXG4gICAgbWF0Y2hlczogKG1lc3NhZ2U6IE1lc3NhZ2UpID0+IGJvb2xlYW47XHJcbiAgICByZXNvbHZlOiAobWVzc2FnZTogTWVzc2FnZSkgPT4gdm9pZDtcclxuICAgIHJlamVjdDogKGVycm9yOiBFcnJvcikgPT4gdm9pZDtcclxuICB9PiA9IFtdO1xyXG4gIC8qKlxyXG4gICAqIFNlcmlhbGl6ZXMgQUNLIEFQUExJQ0FUSU9OIGFjcm9zcyBwaXBlbGluZSBzbG90cy4gU2xvdHMgYXdhaXQgcmVwbGllc1xyXG4gICAqIGNvbmN1cnJlbnRseSwgYnV0IGVhY2ggcmVwbHkgZm9sZHMgaW50byB0aGUgU0hBUkVEIGB0aGlzLmluZGV4YFxyXG4gICAqIChyZWFkLW1vZGlmeS13cml0ZSk7IGNoYWluaW5nIHRoZSBmb2xkcyBrZWVwcyBldmVyeSBhcHBseSBhdG9taWMgd2l0aFxyXG4gICAqIHJlc3BlY3QgdG8gdGhlIG90aGVycy4gT3JkZXIgYWNyb3NzIGRpZmZlcmVudCBwYXRocyBpcyBpcnJlbGV2YW50IChvbmVcclxuICAgKiBjb21taXQgcGVyIHBhdGggcGVyIGN5Y2xlLCBwZXItcGF0aCBzZXJ2ZXIgYXJiaXRyYXRpb24pLCBzbyBubyBvcmRlcmluZ1xyXG4gICAqIGd1YXJhbnRlZSBpcyBuZWVkZWQgYmV5b25kIG11dHVhbCBleGNsdXNpb24uXHJcbiAgICovXHJcbiAgcHJpdmF0ZSBhY2tDaGFpbjogUHJvbWlzZTx2b2lkPiA9IFByb21pc2UucmVzb2x2ZSgpO1xyXG5cclxuICBjb25zdHJ1Y3RvcihvcHRpb25zOiBTeW5jQ2xpZW50T3B0aW9ucykge1xyXG4gICAgdGhpcy5vcHRpb25zID0gb3B0aW9ucztcclxuICAgIHRoaXMubG9nID0gb3B0aW9ucy5sb2cgPz8gZGVmYXVsdExvZztcclxuICAgIHRoaXMubm93ID0gb3B0aW9ucy5ub3cgPz8gKCgpID0+IERhdGUubm93KCkpO1xyXG4gICAgdGhpcy5kZWJvdW5jZU1zID0gb3B0aW9ucy5kZWJvdW5jZU1zID8/IDMwMDtcclxuICAgIHRoaXMuc2NoZWR1bGUgPSBvcHRpb25zLnNjaGVkdWxlID8/IGRlZmF1bHRTY2hlZHVsZTtcclxuICAgIHRoaXMucHVzaENvbmN1cnJlbmN5ID0gTWF0aC5tYXgoMSwgb3B0aW9ucy5wdXNoQ29uY3VycmVuY3kgPz8gREVGQVVMVF9QVVNIX0NPTkNVUlJFTkNZKTtcclxuICAgIHRoaXMucHJvZ3Jlc3NUaHJvdHRsZU1zID0gTWF0aC5tYXgoMCwgb3B0aW9ucy5wcm9ncmVzc1Rocm90dGxlTXMgPz8gREVGQVVMVF9QUk9HUkVTU19USFJPVFRMRV9NUyk7XHJcbiAgICB0aGlzLmRpYWxUcmFuc3BvcnQgPVxyXG4gICAgICB0eXBlb2Ygb3B0aW9ucy50cmFuc3BvcnQgPT09ICdmdW5jdGlvbidcclxuICAgICAgICA/IG9wdGlvbnMudHJhbnNwb3J0XHJcbiAgICAgICAgOiAoKSA9PiBvcHRpb25zLnRyYW5zcG9ydCBhcyBUcmFuc3BvcnQ7XHJcbiAgICB0aGlzLmlnbm9yZVNldHRpbmdzID0gb3B0aW9ucy5zZXR0aW5ncyA/PyB7IG9ic2lkaWFuU3luYzogZmFsc2UgfTtcclxuICB9XHJcblxyXG4gIC8vIC0tLSBsaWZlY3ljbGUgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cclxuICAvKiogUnVuIHN0YXJ0dXAgcmVjb25jaWxpYXRpb24gYW5kIGVudGVyIGxpdmUgbW9kZS4gKi9cclxuICBhc3luYyBjb25uZWN0KCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgYXdhaXQgdGhpcy5lbnF1ZXVlKCgpID0+IHRoaXMuc3RhcnR1cCgpKTtcclxuICB9XHJcblxyXG4gIC8qKiBSZS1kaWFsIGFuZCByZS1ydW4gdGhlIGZ1bGwgc3RhcnR1cCByZWNvbmNpbGlhdGlvbi4gKi9cclxuICBhc3luYyByZWNvbm5lY3QoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBhd2FpdCB0aGlzLmVucXVldWUoYXN5bmMgKCkgPT4ge1xyXG4gICAgICB0aGlzLnRyYW5zcG9ydD8uY2xvc2UoKTtcclxuICAgICAgdGhpcy50cmFuc3BvcnQgPSBudWxsO1xyXG4gICAgICBhd2FpdCB0aGlzLnN0YXJ0dXAoKTtcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgY2xvc2UoKTogdm9pZCB7XHJcbiAgICB0aGlzLnN0b3BXYXRjaGluZygpO1xyXG4gICAgdGhpcy5jYW5jZWxEZWJvdW5jZT8uKCk7XHJcbiAgICB0aGlzLmNhbmNlbERlYm91bmNlID0gbnVsbDtcclxuICAgIHRoaXMudHJhbnNwb3J0Py5jbG9zZSgpO1xyXG4gICAgdGhpcy50cmFuc3BvcnQgPSBudWxsO1xyXG4gICAgdGhpcy5zdGF0ZSA9ICdpZGxlJztcclxuICB9XHJcblxyXG4gIC8qKiBCZWdpbiBkZWJvdW5jZWQgd2F0Y2hpbmcgKEFSQ0hJVEVDVFVSRSBcdTAwQTc4IGxpdmUgb3BlcmF0aW9uKS4gKi9cclxuICBzdGFydFdhdGNoaW5nKHdhdGNoQWRhcHRlcjogV2F0Y2hBZGFwdGVyKTogdm9pZCB7XHJcbiAgICB0aGlzLnN0b3BXYXRjaGluZygpO1xyXG4gICAgdGhpcy53YXRjaEFkYXB0ZXIgPSB3YXRjaEFkYXB0ZXI7XHJcbiAgICB3YXRjaEFkYXB0ZXIuc3RhcnQoKGV2ZW50cykgPT4gdGhpcy5vbldhdGNoRXZlbnRzKGV2ZW50cykpO1xyXG4gIH1cclxuXHJcbiAgc3RvcFdhdGNoaW5nKCk6IHZvaWQge1xyXG4gICAgdGhpcy53YXRjaEFkYXB0ZXI/LnN0b3AoKTtcclxuICAgIHRoaXMud2F0Y2hBZGFwdGVyID0gbnVsbDtcclxuICB9XHJcblxyXG4gIC8qKiBNYW51YWwgb25lLXNob3QgY3ljbGUgKGB2c2FgIG9uZS1zaG90LCBcInN5bmMgbm93XCIgYnV0dG9ucywgdGVzdHMpLiAqL1xyXG4gIGFzeW5jIHRyaWdnZXJTeW5jKCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgYXdhaXQgdGhpcy5lbnF1ZXVlKCgpID0+IHRoaXMucnVuQ3ljbGUoKSk7XHJcbiAgfVxyXG5cclxuICAvKiogUmVzb2x2ZXMgd2hlbiBldmVyeSBxdWV1ZWQgb3BlcmF0aW9uIGhhcyBzZXR0bGVkLiAqL1xyXG4gIGFzeW5jIHdhaXRJZGxlKCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgd2hpbGUgKHRoaXMucXVldWVkT3BzID4gMCkgYXdhaXQgdGhpcy50YWlsO1xyXG4gICAgYXdhaXQgdGhpcy50YWlsO1xyXG4gIH1cclxuXHJcbiAgc3RhdHVzKCk6IFN5bmNDbGllbnRTdGF0dXMge1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgc3RhdGU6IHRoaXMuc3RhdGUsXHJcbiAgICAgIGxhc3RTeW5jQXQ6IHRoaXMubGFzdFN5bmNBdCxcclxuICAgICAgcGVuZGluZzogdGhpcy5wZW5kaW5nLFxyXG4gICAgICBjb25mbGljdHM6IFsuLi50aGlzLmNvbmZsaWN0c10sXHJcbiAgICAgIC4uLih0aGlzLmNhc2VDb2xsaXNpb25zLmxlbmd0aCA+IDAgPyB7IGNhc2VDb2xsaXNpb25zOiBbLi4udGhpcy5jYXNlQ29sbGlzaW9uc10gfSA6IHt9KSxcclxuICAgICAgLi4uKHRoaXMuc2tpcHBlZFBhdGhzLmxlbmd0aCA+IDAgPyB7IHNraXBwZWRQYXRoczogWy4uLnRoaXMuc2tpcHBlZFBhdGhzXSB9IDoge30pLFxyXG4gICAgICBzZXJ2ZXJWZXJzaW9uOiB0aGlzLnNlcnZlclZlcnNpb24sXHJcbiAgICAgIC4uLih0aGlzLnByb2dyZXNzICE9PSBudWxsID8geyBwcm9ncmVzczogeyAuLi50aGlzLnByb2dyZXNzIH0gfSA6IHt9KSxcclxuICAgIH07XHJcbiAgfVxyXG5cclxuICAvKiogUmVhZC1vbmx5IHZpZXcgb2YgdGhlIGxvY2FsIGluZGV4ICh0ZXN0cywgYHZzYSBzdGF0dXNgKS4gKi9cclxuICBjdXJyZW50SW5kZXgoKTogTG9jYWxJbmRleCB7XHJcbiAgICByZXR1cm4geyAuLi50aGlzLmluZGV4IH07XHJcbiAgfVxyXG5cclxuICAvKiogTGFzdCBzZWVuIHNlcnZlciBzZXF1ZW5jZSBudW1iZXIuICovXHJcbiAgZ2V0IGN1cnNvclZhbHVlKCk6IG51bWJlciB7XHJcbiAgICByZXR1cm4gdGhpcy5jdXJzb3I7XHJcbiAgfVxyXG5cclxuICAvKiogVFMtc2FmZSBzdGF0ZSBwcm9iZSAoYXNzaWdubWVudHMgaW5zaWRlIGFzeW5jIGZsb3dzIGRlZmVhdCBuYXJyb3dpbmcpLiAqL1xyXG4gIHByaXZhdGUgaXNEaXNjb25uZWN0ZWQoKTogYm9vbGVhbiB7XHJcbiAgICByZXR1cm4gdGhpcy5zdGF0ZSA9PT0gJ2Rpc2Nvbm5lY3RlZCc7XHJcbiAgfVxyXG5cclxuICAvLyAtLS0gc3RhcnR1cCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblxyXG4gIHByaXZhdGUgYXN5bmMgc3RhcnR1cCgpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIHRoaXMuc3RhdGUgPSAnY29ubmVjdGluZyc7XHJcbiAgICB0aGlzLmJ1ZmZlcmluZyA9IHRydWU7XHJcbiAgICB0aGlzLmJ1ZmZlcmVkID0gW107XHJcblxyXG4gICAgLy8gUmVzdG9yZSB0aGUgaW5kZXggQU5EIHRoZSBzeW5jLWN1cnNvciBib29ra2VlcGluZyAob25lIGF0b21pYyBmaWxlKTpcclxuICAgIC8vIHRoZSBwZXJzaXN0ZWQgY3Vyc29yIGxldHMgaGVsbG8gcmVwbGF5IG9ubHkgd2hhdCB3YXMgbWlzc2VkLCBhbmRcclxuICAgIC8vIGBzeW5jZWRUaHJvdWdoYCBkZWNpZGVzIHdoZXRoZXIgYSBkZWx0YSBtYW5pZmVzdCBtYXkgYmUgcmVxdWVzdGVkLlxyXG4gICAgLy8gQSBzdGF0ZSBmaWxlIHRoYXQgZmFpbHMgdG8gcGFyc2Ugb3IgdmFsaWRhdGUgaXMgbW92ZWQgYXNpZGUgKHRoZVxyXG4gICAgLy8gY29uZmlnLXN0b3JlIHJlY292ZXJ5IHBhdHRlcm4pIGFuZCB0aGUgY2xpZW50IHJlc3luY3MgZnJvbSBhIEZVTExcclxuICAgIC8vIG1hbmlmZXN0IG9mZiBhIGZyZXNoIGluZGV4IFx1MjAxNCBvbmUgY29ycnVwdCBmaWVsZCBtdXN0IG5vdCB3ZWRnZSBldmVyeVxyXG4gICAgLy8gZnV0dXJlIHN0YXJ0dXAuXHJcbiAgICBpZiAoYXdhaXQgdGhpcy5zYWZlU3RvcmFnZUV4aXN0cyhMT0NBTF9JTkRFWF9TVEFURV9QQVRIKSkge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGNvbnN0IGxvYWRlZCA9IGF3YWl0IGxvYWRMb2NhbFN0YXRlKHRoaXMub3B0aW9ucy5zdG9yYWdlKTtcclxuICAgICAgICB0aGlzLmluZGV4ID0gbG9hZGVkLmluZGV4O1xyXG4gICAgICAgIHRoaXMuY3Vyc29yID0gbG9hZGVkLnN0YXRlLmN1cnNvcjtcclxuICAgICAgICB0aGlzLnN5bmNlZFRocm91Z2ggPSBsb2FkZWQuc3RhdGUuc3luY2VkVGhyb3VnaDtcclxuICAgICAgICB0aGlzLm5lZWRzRnVsbE1hbmlmZXN0ID0gbG9hZGVkLnN0YXRlLm5lZWRzRnVsbE1hbmlmZXN0O1xyXG4gICAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICAgIHRyeSB7XHJcbiAgICAgICAgICBhd2FpdCB0aGlzLm9wdGlvbnMuc3RvcmFnZS5yZW5hbWVGaWxlKFxyXG4gICAgICAgICAgICBMT0NBTF9JTkRFWF9TVEFURV9QQVRILFxyXG4gICAgICAgICAgICBgJHtMT0NBTF9JTkRFWF9TVEFURV9QQVRIfS5jb3JydXB0LmJha2AsXHJcbiAgICAgICAgICApO1xyXG4gICAgICAgIH0gY2F0Y2gge1xyXG4gICAgICAgICAgLy8gQ291bGQgbm90IG1vdmUgdGhlIGJhZCBmaWxlIGFzaWRlOyB0aGUgZmlyc3QgcGVyc2lzdCBiZWxvd1xyXG4gICAgICAgICAgLy8gb3ZlcndyaXRlcyBpdCwgc28gdGhlIGNsaWVudCBjYW4gc3RpbGwgb3BlcmF0ZS5cclxuICAgICAgICB9XHJcbiAgICAgICAgdGhpcy5sb2cud2FybihcclxuICAgICAgICAgICdsb2NhbCBpbmRleCBzdGF0ZSBpcyBjb3JydXB0OyBxdWFyYW50aW5lZCB0byBzdGF0ZS5jb3JydXB0LmJhayBhbmQgcmVzeW5jaW5nIGZyb20gYSBmdWxsIG1hbmlmZXN0JyxcclxuICAgICAgICAgIGVycm9yLFxyXG4gICAgICAgICk7XHJcbiAgICAgICAgdGhpcy5yZXNldExvY2FsU3RhdGUoKTtcclxuICAgICAgfVxyXG4gICAgfSBlbHNlIHtcclxuICAgICAgdGhpcy5yZXNldExvY2FsU3RhdGUoKTtcclxuICAgIH1cclxuICAgIHRoaXMuc2VydmVyT2xkZXN0UmV0YWluZWRTZXEgPSBudWxsO1xyXG4gICAgLy8gVmVyc2lvbiBza2V3IGlzIHJlLWFzc2Vzc2VkIHBlciBjb25uZWN0aW9uOiByZXNldCBiZWZvcmUgdGhlIGFjayBzbyBhXHJcbiAgICAvLyByZWNvbm5lY3QgYWdhaW5zdCBhIGRpZmZlcmVudCAob3IgbGVnYWN5KSBzZXJ2ZXIgbmV2ZXIgcmVwb3J0cyBhIHN0YWxlXHJcbiAgICAvLyB2ZXJzaW9uIGJldHdlZW4gdGhlIGRpYWwgYW5kIHRoZSBmcmVzaCBoZWxsb0Fjay5cclxuICAgIHRoaXMuc2VydmVyVmVyc2lvbiA9IG51bGw7XHJcblxyXG4gICAgY29uc3QgdHJhbnNwb3J0ID0gdGhpcy5kaWFsVHJhbnNwb3J0KCk7XHJcbiAgICB0aGlzLnRyYW5zcG9ydCA9IHRyYW5zcG9ydDtcclxuICAgIHRyYW5zcG9ydC5vbk1lc3NhZ2UoKG1lc3NhZ2UpID0+IHRoaXMub25UcmFuc3BvcnRNZXNzYWdlKG1lc3NhZ2UpKTtcclxuICAgIHRyYW5zcG9ydC5vbkNsb3NlKChyZWFzb24pID0+IHRoaXMub25UcmFuc3BvcnRDbG9zZShyZWFzb24pKTtcclxuXHJcbiAgICBjb25zdCBoZWxsb0FjayA9IGF3YWl0IHRoaXMucmVxdWVzdDxIZWxsb0Fja01lc3NhZ2UgfCBTZXJ2ZXJFcnJvck1lc3NhZ2U+KFxyXG4gICAgICAobSkgPT4gbS50eXBlID09PSAnaGVsbG9BY2snIHx8IG0udHlwZSA9PT0gJ2Vycm9yJyxcclxuICAgICAgKCkgPT5cclxuICAgICAgICB0cmFuc3BvcnQuc2VuZCh7XHJcbiAgICAgICAgICB0eXBlOiAnaGVsbG8nLFxyXG4gICAgICAgICAgdG9rZW46IHRoaXMub3B0aW9ucy50b2tlbixcclxuICAgICAgICAgIHByb3RvY29sVmVyc2lvbjogUHJvdG9jb2xWZXJzaW9uLFxyXG4gICAgICAgICAgY3Vyc29yOiB0aGlzLmN1cnNvcixcclxuICAgICAgICB9KSxcclxuICAgICk7XHJcbiAgICBpZiAoaGVsbG9BY2sudHlwZSA9PT0gJ2Vycm9yJykgdGhyb3cgdGhpcy50b0Vycm9yKGhlbGxvQWNrKTtcclxuICAgIC8vIFRoZSBzZXJ2ZXIncyBwZXItdmF1bHQgYG9ic2lkaWFuU3luY2Agc3VwZXJzZWRlcyB0aGUgbG9jYWwgaW5pdGlhbFxyXG4gICAgLy8gdmFsdWUsIGJ1dCBgZXh0cmFJZ25vcmVzYCBpcyBhIGNsaWVudC1zaWRlIGNvbmNlcm4gXHUyMDE0IHRoZSB3b3JrZXIgbmV2ZXJcclxuICAgIC8vIHNlbmRzIGl0LCBzbyB0aGUgbG9jYWxseSBjb25maWd1cmVkIHBhdHRlcm5zIHN1cnZpdmUgdGhlIGhhbmRzaGFrZS5cclxuICAgIHRoaXMuaWdub3JlU2V0dGluZ3MgPSB7XHJcbiAgICAgIG9ic2lkaWFuU3luYzogaGVsbG9BY2suc2V0dGluZ3Mub2JzaWRpYW5TeW5jLFxyXG4gICAgICAuLi4odGhpcy5pZ25vcmVTZXR0aW5ncy5leHRyYUlnbm9yZXMgIT09IHVuZGVmaW5lZFxyXG4gICAgICAgID8geyBleHRyYUlnbm9yZXM6IHRoaXMuaWdub3JlU2V0dGluZ3MuZXh0cmFJZ25vcmVzIH1cclxuICAgICAgICA6IHt9KSxcclxuICAgIH07XHJcbiAgICAvLyBSZXBsYXktd2luZG93IGFuc3dlcjogd2l0aCB0aGlzLCB0aGUgY2xpZW50IGNhbiB0ZWxsIHdoZXRoZXIgZXZlcnlcclxuICAgIC8vIGV2ZW50IGFmdGVyIGl0cyBjdXJzb3Igd2FzIHJldGFpbmVkIChkZWx0YS1tYW5pZmVzdCBlbGlnaWJpbGl0eSkuXHJcbiAgICB0aGlzLnNlcnZlck9sZGVzdFJldGFpbmVkU2VxID0gaGVsbG9BY2sub2xkZXN0UmV0YWluZWRTZXEgPz8gbnVsbDtcclxuICAgIHRoaXMuc2VydmVyVmVyc2lvbiA9IGhlbGxvQWNrLnNlcnZlclZlcnNpb24gPz8gbnVsbDtcclxuXHJcbiAgICB0aGlzLnN0YXRlID0gJ3N5bmNpbmcnO1xyXG4gICAgaWYgKHRoaXMuc2hvdWxkUmVxdWVzdERlbHRhTWFuaWZlc3QoKSkge1xyXG4gICAgICAvLyBERUxUQSBNT0RFOiBhcHBseSB0aGUgcmVwbGF5ZWQgY2hhbmdlcyBCRUZPUkUgcGxhbm5pbmcuIFRoZSBkZWx0YVxyXG4gICAgICAvLyBtYW5pZmVzdCBvbWl0cyBldmVyeSBoZWFkIGF0IG9yIGJlbG93IHRoZSBjdXJzb3IgXHUyMDE0IGluY2x1ZGluZyBoZWFkc1xyXG4gICAgICAvLyB0aGF0IG5vIGxvbmdlciBleGlzdCBiZWNhdXNlIHRoZSBhdXRob3JpdHkgTUlHUkFURUQgdGhlbSAoYSByZW5hbWVcclxuICAgICAgLy8gZGVsZXRlcyB0aGUgb2xkIHJvdykgXHUyMDE0IHNvIHRoZSBpbmRleCBwcm9qZWN0aW9uIG11c3Qgbm90IGNhcnJ5IHRob3NlXHJcbiAgICAgIC8vIHBhdGhzIGFueW1vcmUuIFRoZSByZXBsYXllZCByZW5hbWUgKHNlcSA+IGN1cnNvcikgbWF0ZXJpYWxpemVzIGhlcmVcclxuICAgICAgLy8gYW5kIHJlbW92ZXMgdGhlIHN0YWxlIHBhdGgsIG1ha2luZyB0aGUgbWVyZ2VkIHZpZXcgaWRlbnRpY2FsIHRvIHdoYXRcclxuICAgICAgLy8gYSBmdWxsIG1hbmlmZXN0IHdvdWxkIGhhdmUgc2FpZC4gKFRoZSBvcmRlcmVkIHdpcmUgZ3VhcmFudGVlcyB0aGVcclxuICAgICAgLy8gcmVwbGF5IHByZWNlZGVzIHRoZSBtYW5pZmVzdCByZXBseTsgYW55dGhpbmcgc3RyYWdnbGluZyBzdGF5c1xyXG4gICAgICAvLyBidWZmZXJlZCBhbmQgaXMgZGlzcGF0Y2hlZCBhZnRlciB0aGUgY3ljbGUsIGFzIGFsd2F5cy4pIEEgcmVwbGF5ZWRcclxuICAgICAgLy8gY2hhbmdlIHRoYXQgaGl0cyB0aGUgZGl2ZXJnZW5jZSBndWFyZCBmbGlwcyBgbmVlZHNGdWxsTWFuaWZlc3RgLFxyXG4gICAgICAvLyBhbmQgYGZldGNoTWFuaWZlc3RgIHJlLWV2YWx1YXRlcyBcdTIwMTQgZmFsbGluZyBiYWNrIHRvIGZ1bGwsIGFzIGRlc2lnbmVkLlxyXG4gICAgICBjb25zdCByZXBsYXkgPSB0aGlzLmJ1ZmZlcmVkO1xyXG4gICAgICB0aGlzLmJ1ZmZlcmVkID0gW107XHJcbiAgICAgIGZvciAoY29uc3QgbWVzc2FnZSBvZiByZXBsYXkpIHtcclxuICAgICAgICBhd2FpdCB0aGlzLmRpc3BhdGNoKG1lc3NhZ2UpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgICBhd2FpdCB0aGlzLnJ1bkN5Y2xlKCk7XHJcblxyXG4gICAgdGhpcy5idWZmZXJpbmcgPSBmYWxzZTtcclxuICAgIGNvbnN0IGJ1ZmZlcmVkID0gdGhpcy5idWZmZXJlZDtcclxuICAgIHRoaXMuYnVmZmVyZWQgPSBbXTtcclxuICAgIGZvciAoY29uc3QgbWVzc2FnZSBvZiBidWZmZXJlZCkge1xyXG4gICAgICBhd2FpdCB0aGlzLmRpc3BhdGNoKG1lc3NhZ2UpO1xyXG4gICAgfVxyXG4gICAgaWYgKCF0aGlzLmlzRGlzY29ubmVjdGVkKCkpIHRoaXMuc3RhdGUgPSAnbGl2ZSc7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHNhZmVTdG9yYWdlRXhpc3RzKHBhdGg6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMub3B0aW9ucy5zdG9yYWdlLmV4aXN0cyhwYXRoKTtcclxuICAgIH0gY2F0Y2gge1xyXG4gICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKiogRnJlc2ggaW5kZXggKyBjdXJzb3IgYm9va2tlZXBpbmc6IG5vIHByaW9yIGtub3dsZWRnZSwgZnVsbCBtYW5pZmVzdC4gKi9cclxuICBwcml2YXRlIHJlc2V0TG9jYWxTdGF0ZSgpOiB2b2lkIHtcclxuICAgIHRoaXMuaW5kZXggPSB7fTtcclxuICAgIHRoaXMuY3Vyc29yID0gMDtcclxuICAgIHRoaXMuc3luY2VkVGhyb3VnaCA9IG51bGw7XHJcbiAgICB0aGlzLm5lZWRzRnVsbE1hbmlmZXN0ID0gZmFsc2U7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIG9uVHJhbnNwb3J0Q2xvc2UocmVhc29uOiB7IGNvZGU/OiBudW1iZXI7IHJlYXNvbj86IHN0cmluZyB9KTogdm9pZCB7XHJcbiAgICB0aGlzLmxvZy53YXJuKCd0cmFuc3BvcnQgY2xvc2VkJywgcmVhc29uKTtcclxuICAgIHRoaXMuc3RhdGUgPSAnZGlzY29ubmVjdGVkJztcclxuICAgIGNvbnN0IGV4cGVjdGF0aW9ucyA9IHRoaXMuZXhwZWN0YXRpb25zO1xyXG4gICAgdGhpcy5leHBlY3RhdGlvbnMgPSBbXTtcclxuICAgIGZvciAoY29uc3QgZXhwZWN0YXRpb24gb2YgZXhwZWN0YXRpb25zKSB7XHJcbiAgICAgIGV4cGVjdGF0aW9uLnJlamVjdChcclxuICAgICAgICBuZXcgTmV0d29ya0Vycm9yKGBjb25uZWN0aW9uIGNsb3NlZDogJHtyZWFzb24ucmVhc29uID8/IHJlYXNvbi5jb2RlID8/ICd1bmtub3duJ31gKSxcclxuICAgICAgKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8vIC0tLSBtZXNzYWdlIHB1bXAgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cclxuICBwcml2YXRlIG9uVHJhbnNwb3J0TWVzc2FnZSA9IChtZXNzYWdlOiBNZXNzYWdlKTogdm9pZCA9PiB7XHJcbiAgICAvLyBPbGRlc3QgZXhwZWN0YXRpb24gdGhhdCBhY2NlcHRzIHRoaXMgbWVzc2FnZS4gV2l0aCB0aGUgcHVzaCBwaXBlbGluZVxyXG4gICAgLy8gc2V2ZXJhbCBjb21taXQgZXhwZWN0YXRpb25zIGFyZSBvdXRzdGFuZGluZyBhdCBvbmNlOyB0aGUgb3JkZXJlZCB3aXJlICtcclxuICAgIC8vIHRoZSBzZXJ2ZXIncyBzZXJpYWxpemVkIGFyYml0cmF0aW9uIGRlbGl2ZXIgcmVwbGllcyBpbiBzZW5kIG9yZGVyLCBzb1xyXG4gICAgLy8gZmlyc3QtbWF0Y2ggcGFpcnMgZWFjaCByZXBseSB3aXRoIGl0cyBvd24gcmVxdWVzdC5cclxuICAgIGNvbnN0IGluZGV4ID0gdGhpcy5leHBlY3RhdGlvbnMuZmluZEluZGV4KChleHBlY3RhdGlvbikgPT4gZXhwZWN0YXRpb24ubWF0Y2hlcyhtZXNzYWdlKSk7XHJcbiAgICBpZiAoaW5kZXggPj0gMCkge1xyXG4gICAgICBjb25zdCBleHBlY3RhdGlvbiA9IHRoaXMuZXhwZWN0YXRpb25zW2luZGV4XTtcclxuICAgICAgdGhpcy5leHBlY3RhdGlvbnMuc3BsaWNlKGluZGV4LCAxKTtcclxuICAgICAgaWYgKGV4cGVjdGF0aW9uICE9PSB1bmRlZmluZWQpIGV4cGVjdGF0aW9uLnJlc29sdmUobWVzc2FnZSk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIGlmICh0aGlzLmJ1ZmZlcmluZykge1xyXG4gICAgICB0aGlzLmJ1ZmZlcmVkLnB1c2gobWVzc2FnZSk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIHRoaXMuZW5xdWV1ZShhc3luYyAoKSA9PiB7XHJcbiAgICAgIGF3YWl0IHRoaXMuZGlzcGF0Y2gobWVzc2FnZSk7XHJcbiAgICB9KS5jYXRjaCgoZXJyb3I6IHVua25vd24pID0+IHRoaXMubG9nLndhcm4oJ2NoYW5nZSBoYW5kbGVyIGZhaWxlZCcsIGVycm9yKSk7XHJcbiAgfTtcclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBkaXNwYXRjaChtZXNzYWdlOiBNZXNzYWdlKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBzd2l0Y2ggKG1lc3NhZ2UudHlwZSkge1xyXG4gICAgICBjYXNlICdjaGFuZ2UnOlxyXG4gICAgICAgIGF3YWl0IHRoaXMuaGFuZGxlQ2hhbmdlKG1lc3NhZ2UpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgICAgY2FzZSAnZGV2aWNlU2Vlbic6XHJcbiAgICAgICAgcmV0dXJuOyAvLyBwcmVzZW5jZSBvbmx5OyBkYXNoYm9hcmRzIGNvbnN1bWUgaXRcclxuICAgICAgY2FzZSAncG9uZyc6XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgICBjYXNlICdlcnJvcic6XHJcbiAgICAgICAgdGhpcy5sb2cuZXJyb3IoJ3NlcnZlciBlcnJvcicsIG1lc3NhZ2UuY29kZSwgbWVzc2FnZS5tZXNzYWdlKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIGNhc2UgJ2hlbGxvQWNrJzpcclxuICAgICAgY2FzZSAnbWFuaWZlc3QnOlxyXG4gICAgICBjYXNlICdjb21taXRBY2snOlxyXG4gICAgICBjYXNlICdjb25mbGljdCc6XHJcbiAgICAgIGNhc2UgJ2Jsb2InOlxyXG4gICAgICBjYXNlICdibG9iQWNrJzpcclxuICAgICAgY2FzZSAnc25hcHNob3RDcmVhdGVBY2snOlxyXG4gICAgICBjYXNlICdzbmFwc2hvdFJlc3RvcmVBY2snOlxyXG4gICAgICAgIC8vIFJlcGxpZXMgYXJyaXZlIG9ubHkgYWdhaW5zdCBhbiBvdXRzdGFuZGluZyBleHBlY3RhdGlvbjsgYVxyXG4gICAgICAgIC8vIHNwb250YW5lb3VzIG9uZSBpcyBhIHByb3RvY29sIHZpb2xhdGlvbiB3ZSBsb2cgYW5kIGRyb3AuXHJcbiAgICAgICAgdGhpcy5sb2cud2FybigndW5leHBlY3RlZCBzZXJ2ZXIgcmVwbHknLCBtZXNzYWdlLnR5cGUpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgICAgZGVmYXVsdDpcclxuICAgICAgICB0aGlzLmxvZy53YXJuKCdpZ25vcmluZyBjbGllbnQtdG8tc2VydmVyIG1lc3NhZ2UgZnJvbSBzZXJ2ZXInLCBtZXNzYWdlKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgaGFuZGxlQ2hhbmdlKGNoYW5nZTogQ2hhbmdlTWVzc2FnZSk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgdmFsaWRhdGVDaGFuZ2VNZXNzYWdlKGNoYW5nZSk7XHJcbiAgICBpZiAoY2hhbmdlLnNlcSA+IHRoaXMuY3Vyc29yKSB0aGlzLmN1cnNvciA9IGNoYW5nZS5zZXE7XHJcbiAgICAvLyBXaW5kb3dzLXVuc2FmZSBwYXRocyBjYW4gbmV2ZXIgYmUgbWF0ZXJpYWxpemVkIGhlcmU6IHNraXAgdGhlIGhlYWRcclxuICAgIC8vIChkaWFnbm9zZWQsIG5vdCBhcHBsaWVkKSBpbnN0ZWFkIG9mIGZhaWxpbmcgdGhlIGhhbmRsZXIgZXZlcnkgdGltZS5cclxuICAgIC8vIENoZWNrZWQgYmVmb3JlIHRoZSBpZ25vcmUgcnVsZXMgXHUyMDE0IGFuIHVuc3luY2FibGUgcGF0aCBpcyBuZXZlciBpZ25vcmVkXHJcbiAgICAvLyBzaWxlbnRseS5cclxuICAgIGNvbnN0IHVuc2FmZSA9IGZpcnN0VW5zYWZlUGF0aChcclxuICAgICAgY2hhbmdlLmZyb21QYXRoICE9PSB1bmRlZmluZWQgPyBbY2hhbmdlLnBhdGgsIGNoYW5nZS5mcm9tUGF0aF0gOiBbY2hhbmdlLnBhdGhdLFxyXG4gICAgKTtcclxuICAgIGlmICh1bnNhZmUgIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICB0aGlzLnJlY29yZFNraXBwZWRQYXRoKHVuc2FmZSk7XHJcbiAgICAgIC8vIFRoZSBoZWFkIGlzIHJlc29sdmVkIFx1MjAxNCBieSBza2lwcGluZyBcdTIwMTQgc28gdGhlIGNvbXBsZXRpb24gd2F0ZXJtYXJrXHJcbiAgICAgIC8vIGFkdmFuY2VzIHdpdGggdGhlIGZlZWQgbGlrZSBhbiBhcHBsaWVkIGNoYW5nZSB3b3VsZC5cclxuICAgICAgaWYgKGNoYW5nZS5zZXEgPiAodGhpcy5zeW5jZWRUaHJvdWdoID8/IDApKSB0aGlzLnN5bmNlZFRocm91Z2ggPSBjaGFuZ2Uuc2VxO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBpZiAoaXNJZ25vcmVkKGNoYW5nZS5wYXRoLCB0aGlzLmlnbm9yZVNldHRpbmdzKSkgcmV0dXJuO1xyXG4gICAgaWYgKGNoYW5nZS5mcm9tUGF0aCAhPT0gdW5kZWZpbmVkICYmIGlzSWdub3JlZChjaGFuZ2UuZnJvbVBhdGgsIHRoaXMuaWdub3JlU2V0dGluZ3MpKSByZXR1cm47XHJcblxyXG4gICAgLy8gU3RhbGUgcmVwbGF5IC8gZHVwbGljYXRlIGZhbi1vdXQ6IHBlciBwYXRoIHRoZSBoZWFkIGNsb2NrIGRvbWluYXRlc1xyXG4gICAgLy8gZXZlcnkgZWFybGllciB2ZXJzaW9uLCBzbyBhbnl0aGluZyBcdTIyNjQgdGhlIHJlY29yZGVkIGNsb2NrIGlzIG9sZCBuZXdzLlxyXG4gICAgY29uc3QgZW50cnkgPSB0aGlzLmluZGV4W2NoYW5nZS5wYXRoXTtcclxuICAgIGlmIChlbnRyeSAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgIGlmIChlbnRyeS52ZXJzaW9uSWQgPT09IGNoYW5nZS52ZXJzaW9uKSByZXR1cm47XHJcbiAgICAgIGlmIChjb21wYXJlQ2xvY2tzKGVudHJ5LmNsb2NrLCBjaGFuZ2UuY2xvY2spID49IDApIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICAvLyBUaGUgZ3VhcmQ6IG5ldmVyIHdyaXRlIGEgcmVtb3RlIGNoYW5nZSBvdmVyIGxvY2FsbHktZGl2ZXJnZWQgY29udGVudC5cclxuICAgIGlmICghKGF3YWl0IHRoaXMuY2hhbmdlSXNTYWZlKGNoYW5nZSkpKSB7XHJcbiAgICAgIHRoaXMubG9nLmluZm8oJ2RlZmVycmluZyByZW1vdGUgY2hhbmdlIG92ZXIgbG9jYWwgZGl2ZXJnZW5jZScsIGNoYW5nZS5wYXRoKTtcclxuICAgICAgLy8gVGhlIGRpdmVyZ2VuY2UgbXVzdCBiZSByZXNvbHZlZCBieSBhIHBsYW4gY3ljbGUgdGhhdCBjYW4gU0VFIHRoZVxyXG4gICAgICAvLyByZW1vdGUgaGVhZCBcdTIwMTQgZmxhZyB0aGUgbmV4dCBtYW5pZmVzdCBmdWxsIChkZWx0YSBtYW5pZmVzdHMgb21pdFxyXG4gICAgICAvLyBoZWFkcyBhdCBvciBiZWxvdyB0aGUgY3Vyc29yLCB3aGljaCB0aGlzIGNoYW5nZSBtYXkgYmUgYXQpLlxyXG4gICAgICB0aGlzLm5lZWRzRnVsbE1hbmlmZXN0ID0gdHJ1ZTtcclxuICAgICAgdGhpcy5zY2hlZHVsZVJlY29uY2lsZSgpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgdGhpcy5pbmRleCA9IGF3YWl0IHRoaXMuYXBwbHlQdWxscyhbdGhpcy5wdWxsT3BGcm9tQ2hhbmdlKGNoYW5nZSldKTtcclxuICAgIC8vIFRoaXMgcGF0aCdzIGhlYWQgaXMgbm93IG1hdGVyaWFsaXplZCBsb2NhbGx5LCBzbyB0aGUgY29tcGxldGlvblxyXG4gICAgLy8gd2F0ZXJtYXJrIGFkdmFuY2VzIHdpdGggdGhlIChzdHJpY3RseSBvcmRlcmVkKSBmZWVkLiBBIGNoYW5nZSB0aGF0XHJcbiAgICAvLyB0b29rIHRoZSBkZWZlciBicmFuY2ggYWJvdmUgbmV2ZXIgcmVhY2hlcyB0aGlzIGxpbmUsIGFuZCBpdHNcclxuICAgIC8vIGBuZWVkc0Z1bGxNYW5pZmVzdGAgZmxhZyBrZWVwcyBkZWx0YSBtb2RlIG9mZiB1bnRpbCBhIGZ1bGwtbWFuaWZlc3RcclxuICAgIC8vIGN5Y2xlIHJlc29sdmVzIHRoZSBkaXZlcmdlbmNlLlxyXG4gICAgaWYgKGNoYW5nZS5zZXEgPiAodGhpcy5zeW5jZWRUaHJvdWdoID8/IDApKSB0aGlzLnN5bmNlZFRocm91Z2ggPSBjaGFuZ2Uuc2VxO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQSBjaGFuZ2UgbWF5IGJlIGFwcGxpZWQgZGlyZWN0bHkgb25seSB3aGVuIHRoZSB0b3VjaGVkIHBhdGhzIGNhcnJ5IG5vXHJcbiAgICogdW4tcmVjb25jaWxlZCBsb2NhbCBjb250ZW50LiBBbnl0aGluZyBlbHNlIG11c3QgZGV0b3VyIHRocm91Z2ggYSBmdWxsXHJcbiAgICogYGNvbXB1dGVTeW5jUGxhbmAgY3ljbGUgKGNvbmZsaWN0IGxvZ2ljLCBjb25mbGljdCBjb3BpZXMpLlxyXG4gICAqL1xyXG4gIHByaXZhdGUgYXN5bmMgY2hhbmdlSXNTYWZlKGNoYW5nZTogQ2hhbmdlTWVzc2FnZSk6IFByb21pc2U8Ym9vbGVhbj4ge1xyXG4gICAgaWYgKGNoYW5nZS5pc0ZvbGRlciA9PT0gdHJ1ZSkgcmV0dXJuIHRydWU7XHJcbiAgICBpZiAoY2hhbmdlLmtpbmQgPT09ICdyZW5hbWUnICYmIGNoYW5nZS5mcm9tUGF0aCAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgIGlmIChhd2FpdCB0aGlzLnBhdGhIYXNMb2NhbERpdmVyZ2VuY2UoY2hhbmdlLmZyb21QYXRoKSkgcmV0dXJuIGZhbHNlO1xyXG4gICAgICBpZiAoYXdhaXQgdGhpcy5zdG9yYWdlRXhpc3RzKGNoYW5nZS5wYXRoKSkge1xyXG4gICAgICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5pbmRleFtjaGFuZ2UucGF0aF07XHJcbiAgICAgICAgaWYgKGVudHJ5ID09PSB1bmRlZmluZWQgfHwgZW50cnkuZGVsZXRlZEF0ICE9PSB1bmRlZmluZWQpIHJldHVybiBmYWxzZTtcclxuICAgICAgICBjb25zdCBhY3R1YWwgPSBhd2FpdCBzaGEyNTZIZXgoYXdhaXQgdGhpcy5vcHRpb25zLnN0b3JhZ2UucmVhZEZpbGUoY2hhbmdlLnBhdGgpKTtcclxuICAgICAgICBpZiAoYWN0dWFsICE9PSBlbnRyeS5oYXNoKSByZXR1cm4gZmFsc2U7XHJcbiAgICAgIH1cclxuICAgICAgcmV0dXJuIHRydWU7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gIShhd2FpdCB0aGlzLnBhdGhIYXNMb2NhbERpdmVyZ2VuY2UoY2hhbmdlLnBhdGgpKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgcGF0aEhhc0xvY2FsRGl2ZXJnZW5jZShwYXRoOiBzdHJpbmcpOiBQcm9taXNlPGJvb2xlYW4+IHtcclxuICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5pbmRleFtwYXRoXTtcclxuICAgIGlmIChlbnRyeT8uaXNGb2xkZXIpIHJldHVybiBmYWxzZTtcclxuICAgIGlmICghKGF3YWl0IHRoaXMuc3RvcmFnZUV4aXN0cyhwYXRoKSkpIHJldHVybiBmYWxzZTtcclxuICAgIGlmIChlbnRyeSA9PT0gdW5kZWZpbmVkIHx8IGVudHJ5LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkKSByZXR1cm4gdHJ1ZTtcclxuICAgIGNvbnN0IGFjdHVhbCA9IGF3YWl0IHNoYTI1NkhleChhd2FpdCB0aGlzLm9wdGlvbnMuc3RvcmFnZS5yZWFkRmlsZShwYXRoKSk7XHJcbiAgICByZXR1cm4gYWN0dWFsICE9PSBlbnRyeS5oYXNoO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBzdG9yYWdlRXhpc3RzKHBhdGg6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMub3B0aW9ucy5zdG9yYWdlLmV4aXN0cyhwYXRoKTtcclxuICAgIH0gY2F0Y2gge1xyXG4gICAgICByZXR1cm4gZmFsc2U7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHB1bGxPcEZyb21DaGFuZ2UoY2hhbmdlOiBDaGFuZ2VNZXNzYWdlKTogUHVsbE9wIHtcclxuICAgIGlmIChjaGFuZ2Uua2luZCA9PT0gJ3JlbmFtZScgJiYgY2hhbmdlLmZyb21QYXRoICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBraW5kOiAncmVuYW1lJyxcclxuICAgICAgICBmcm9tUGF0aDogY2hhbmdlLmZyb21QYXRoLFxyXG4gICAgICAgIHRvUGF0aDogY2hhbmdlLnBhdGgsXHJcbiAgICAgICAgaGFzaDogY2hhbmdlLmhhc2gsXHJcbiAgICAgICAgc2l6ZTogY2hhbmdlLnNpemUsXHJcbiAgICAgICAgdmVyc2lvbjogY2hhbmdlLnZlcnNpb24sXHJcbiAgICAgICAgY2xvY2s6IGNoYW5nZS5jbG9jayxcclxuICAgICAgICAvLyBBIGZvbGRlciByZW5hbWUgaXMgYSBtZXRhZGF0YSBtb3ZlIChoYXNoICcnKTsgd2l0aG91dCB0aGUgZmxhZyB0aGVcclxuICAgICAgICAvLyBlbmdpbmUncyByZW5hbWUgYnJhbmNoIHdvdWxkIGZldGNoIGNvbnRlbnQgZm9yIHRoZSBlbXB0eSBoYXNoIHdoZW5cclxuICAgICAgICAvLyBmcm9tUGF0aCBpcyBhbHJlYWR5IGdvbmUgbG9jYWxseSAodHJ1ZSBvbiB0aGUgYXV0aG9yKSBcdTIwMTQgdGhlIGV4YWN0XHJcbiAgICAgICAgLy8gd2VkZ2UgdGhlIGVtcHR5LWhhc2ggZ3VhcmQgZXhpc3RzIHRvIGNhdGNoLlxyXG4gICAgICAgIC4uLihjaGFuZ2UuaXNGb2xkZXIgPT09IHRydWUgPyB7IGlzRm9sZGVyOiB0cnVlIH0gOiB7fSksXHJcbiAgICAgIH07XHJcbiAgICB9XHJcbiAgICBjb25zdCBlbnRyeSA9IHRoaXMuaW5kZXhbY2hhbmdlLnBhdGhdO1xyXG4gICAgY29uc3Qga2luZDogUHVsbEZpbGVPcFsna2luZCddID0gY2hhbmdlLmRlbGV0ZWRcclxuICAgICAgPyAnZGVsZXRlJ1xyXG4gICAgICA6IGVudHJ5ID09PSB1bmRlZmluZWRcclxuICAgICAgICA/ICdhZGQnXHJcbiAgICAgICAgOiBlbnRyeS5kZWxldGVkQXQgIT09IHVuZGVmaW5lZFxyXG4gICAgICAgICAgPyAncmVzdG9yZSdcclxuICAgICAgICAgIDogJ2VkaXQnO1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAga2luZCxcclxuICAgICAgcGF0aDogY2hhbmdlLnBhdGgsXHJcbiAgICAgIGhhc2g6IGNoYW5nZS5oYXNoLFxyXG4gICAgICBzaXplOiBjaGFuZ2Uuc2l6ZSxcclxuICAgICAgdmVyc2lvbjogY2hhbmdlLnZlcnNpb24sXHJcbiAgICAgIGNsb2NrOiBjaGFuZ2UuY2xvY2ssXHJcbiAgICAgIGRlbGV0ZWQ6IGNoYW5nZS5kZWxldGVkLFxyXG4gICAgICAuLi4oY2hhbmdlLmlzRm9sZGVyID09PSB0cnVlID8geyBpc0ZvbGRlcjogdHJ1ZSB9IDoge30pLFxyXG4gICAgfTtcclxuICB9XHJcblxyXG4gIC8qKiBNYXRlcmlhbGl6ZSBwdWxscyB0aHJvdWdoIHRoZSB2ZXJpZmllZCBlbmdpbmUgcGF0aDsgcmV0dXJucyB0aGUgbmV3IGluZGV4LiAqL1xyXG4gIHByaXZhdGUgYXN5bmMgYXBwbHlQdWxscyhcclxuICAgIHB1bGxzOiBSZWFkb25seUFycmF5PFB1bGxPcD4sXHJcbiAgICBwcm9ncmVzcz86IHsgb25Qcm9ncmVzczogKGRvbmU6IG51bWJlciwgdG90YWw6IG51bWJlcikgPT4gdm9pZCB9LFxyXG4gICk6IFByb21pc2U8TG9jYWxJbmRleD4ge1xyXG4gICAgLy8gUHVsbHMgd2hvc2UgdGFyZ2V0IHBhdGggaXMgV2luZG93cy11bnNhZmUgd291bGQgdGhyb3cgaW4gdGhlIGFkYXB0ZXJcclxuICAgIC8vIGV2ZXJ5IGN5Y2xlOyB0aGV5IGFyZSBza2lwcGVkIGFuZCBkaWFnbm9zZWQgaW5zdGVhZCAoYSBsYXRlciB2ZXJzaW9uXHJcbiAgICAvLyBjaGFuZ2UgYXQgdGhlIHBhdGggaXMgYXR0ZW1wdGVkIGFnYWluKS5cclxuICAgIGNvbnN0IG1hdGVyaWFsaXphYmxlOiBQdWxsT3BbXSA9IFtdO1xyXG4gICAgZm9yIChjb25zdCBwdWxsIG9mIHB1bGxzKSB7XHJcbiAgICAgIGNvbnN0IHVuc2FmZSA9IGZpcnN0VW5zYWZlUGF0aChwdWxsVGFyZ2V0cyhwdWxsKSk7XHJcbiAgICAgIGlmICh1bnNhZmUgPT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIG1hdGVyaWFsaXphYmxlLnB1c2gocHVsbCk7XHJcbiAgICAgICAgY29udGludWU7XHJcbiAgICAgIH1cclxuICAgICAgdGhpcy5yZWNvcmRTa2lwcGVkUGF0aCh1bnNhZmUpO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIGFwcGx5UHVsbChcclxuICAgICAgdGhpcy5vcHRpb25zLnN0b3JhZ2UsXHJcbiAgICAgIHRoaXMuaW5kZXgsXHJcbiAgICAgIHsgcHVzaGVzOiBbXSwgcHVsbHM6IG1hdGVyaWFsaXphYmxlLCBjb25mbGljdHM6IFtdLCBmb2xkZXJQdXNoZXM6IFtdIH0sXHJcbiAgICAgIHRoaXMuZmV0Y2hCbG9iLFxyXG4gICAgICB7XHJcbiAgICAgICAgbm93OiB0aGlzLm5vdygpLFxyXG4gICAgICAgIC8vIEtlZXAgdGhlIGVudmVsb3BlJ3MgY3Vyc29yIGJvb2trZWVwaW5nIGludGFjdCBhY3Jvc3MgcHVsbC1zaWRlXHJcbiAgICAgICAgLy8gcGVyc2lzdHMgKGFwcGx5UHVsbCByZXdyaXRlcyB0aGUgd2hvbGUgc3RhdGUgZmlsZSkuXHJcbiAgICAgICAgcGVyc2lzdGVkU3RhdGU6IHRoaXMucGVyc2lzdGVkU3RhdGUoKSxcclxuICAgICAgICAuLi4ocHJvZ3Jlc3MgIT09IHVuZGVmaW5lZCA/IHsgb25Qcm9ncmVzczogcHJvZ3Jlc3Mub25Qcm9ncmVzcyB9IDoge30pLFxyXG4gICAgICB9LFxyXG4gICAgKTtcclxuICB9XHJcblxyXG4gIC8qKiBUaGUgZW52ZWxvcGUgYm9va2tlZXBpbmcgd3JpdHRlbiB3aGVuZXZlciB0aGUgY2xpZW50IHBlcnNpc3RzIHRoZSBpbmRleC4gKi9cclxuICBwcml2YXRlIHBlcnNpc3RlZFN0YXRlKCk6IFBlcnNpc3RlZFN5bmNTdGF0ZSB7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBjdXJzb3I6IHRoaXMuY3Vyc29yLFxyXG4gICAgICBzeW5jZWRUaHJvdWdoOiB0aGlzLnN5bmNlZFRocm91Z2gsXHJcbiAgICAgIG5lZWRzRnVsbE1hbmlmZXN0OiB0aGlzLm5lZWRzRnVsbE1hbmlmZXN0LFxyXG4gICAgfTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFJlY29yZCBhIHBhdGggdGhlIGN5Y2xlIGNvdWxkIG5vdCBzeW5jIGJlY2F1c2UgaXRzIG5hbWUgaXNcclxuICAgKiBXaW5kb3dzLXVuc2FmZSAoYHBhdGhzLnRzYCk6IHN1cmZhY2VkIG9uIGBzdGF0dXMoKS5za2lwcGVkUGF0aHNgIGFuZFxyXG4gICAqIGxvZ2dlZCBvbmNlIHBlciByZWNvcmQgdW50aWwgYSBodW1hbiByZW5hbWVzIGl0LiBEZWR1cGVkOyByZXBsYWNlZCBhdFxyXG4gICAqIHRoZSBzdGFydCBvZiBldmVyeSBjeWNsZS5cclxuICAgKi9cclxuICBwcml2YXRlIHJlY29yZFNraXBwZWRQYXRoKHBhdGg6IHN0cmluZyk6IHZvaWQge1xyXG4gICAgaWYgKHRoaXMuc2tpcHBlZFBhdGhzLmluY2x1ZGVzKHBhdGgpKSByZXR1cm47XHJcbiAgICB0aGlzLnNraXBwZWRQYXRocy5wdXNoKHBhdGgpO1xyXG4gICAgdGhpcy5sb2cud2FybihcclxuICAgICAgJ3NraXBwaW5nIGEgV2luZG93cy11bnNhZmUgcGF0aCAocmVzZXJ2ZWQgZGV2aWNlIG5hbWUgb3IgdHJhaWxpbmcgZG90L3NwYWNlKTsgcmVuYW1lIGl0IHRvIHN5bmMnLFxyXG4gICAgICBwYXRoLFxyXG4gICAgKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFJlY29yZCBvbmUgYnVsay1waGFzZSBzdGVwIG9uIGBzdGF0dXMoKS5wcm9ncmVzc2AuIENvYWxlc2NlZCB0byBhdCBtb3N0XHJcbiAgICogb25lIHVwZGF0ZSBwZXIgYHByb2dyZXNzVGhyb3R0bGVNc2AgKHJlbmRlcmVyIGNodXJuKSwgRVhDRVBUIHBoYXNlXHJcbiAgICogY2hhbmdlcyBhbmQgY29tcGxldGlvbnMsIHdoaWNoIGFsd2F5cyBlbWl0IHNvIGEgcGhhc2UgaXMgbmV2ZXIgbWlzc2VkXHJcbiAgICogYW5kIGBkb25lL3RvdGFsYCBhbHdheXMgbGFuZHMgb24gaXRzIGZpbmFsIHZhbHVlLlxyXG4gICAqL1xyXG4gIHByaXZhdGUgZW1pdFByb2dyZXNzKHBoYXNlOiBTeW5jUGhhc2UsIGRvbmU6IG51bWJlciwgdG90YWw6IG51bWJlcik6IHZvaWQge1xyXG4gICAgaWYgKHRvdGFsID09PSAwKSByZXR1cm47IC8vIG5vdGhpbmcgdG8gc2hvdyBmb3IgYW4gZW1wdHkgcGhhc2VcclxuICAgIGNvbnN0IG5vdyA9IHRoaXMubm93KCk7XHJcbiAgICBjb25zdCBjb21wbGV0ZSA9IGRvbmUgPj0gdG90YWw7XHJcbiAgICBjb25zdCBwaGFzZUNoYW5nZWQgPSB0aGlzLnByb2dyZXNzPy5waGFzZSAhPT0gcGhhc2U7XHJcbiAgICBpZiAoIWNvbXBsZXRlICYmICFwaGFzZUNoYW5nZWQgJiYgbm93IC0gdGhpcy5sYXN0UHJvZ3Jlc3NBdCA8IHRoaXMucHJvZ3Jlc3NUaHJvdHRsZU1zKSByZXR1cm47XHJcbiAgICB0aGlzLmxhc3RQcm9ncmVzc0F0ID0gbm93O1xyXG4gICAgdGhpcy5wcm9ncmVzcyA9IHsgcGhhc2UsIGRvbmUsIHRvdGFsIH07XHJcbiAgfVxyXG5cclxuICAvLyAtLS0gd2F0Y2hlciAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHJcbiAgcHJpdmF0ZSBvbldhdGNoRXZlbnRzKGV2ZW50czogUmVhZG9ubHlBcnJheTx7IHBhdGg6IHN0cmluZyB9Pik6IHZvaWQge1xyXG4gICAgY29uc3QgcmVsZXZhbnQgPSBldmVudHMuZmlsdGVyKChldmVudCkgPT4gIWlzSWdub3JlZChldmVudC5wYXRoLCB0aGlzLmlnbm9yZVNldHRpbmdzKSk7XHJcbiAgICBpZiAocmVsZXZhbnQubGVuZ3RoID09PSAwKSByZXR1cm47XHJcbiAgICB0aGlzLnBlbmRpbmcgKz0gcmVsZXZhbnQubGVuZ3RoO1xyXG4gICAgdGhpcy5zY2hlZHVsZVJlY29uY2lsZSgpO1xyXG4gIH1cclxuXHJcbiAgLyoqIERlYm91bmNlZCBzY2FuXHUyMTkycGxhblx1MjE5MmV4ZWN1dGUgKHNoYXJlZCBieSB3YXRjaGVyIGFuZCBkZWZlcnJlZCBjaGFuZ2VzKS4gKi9cclxuICBwcml2YXRlIHNjaGVkdWxlUmVjb25jaWxlKCk6IHZvaWQge1xyXG4gICAgdGhpcy5jYW5jZWxEZWJvdW5jZT8uKCk7XHJcbiAgICB0aGlzLmNhbmNlbERlYm91bmNlID0gdGhpcy5zY2hlZHVsZSgoKSA9PiB7XHJcbiAgICAgIHRoaXMuY2FuY2VsRGVib3VuY2UgPSBudWxsO1xyXG4gICAgICB0aGlzLmVucXVldWUoKCkgPT4gdGhpcy5ydW5DeWNsZSgpKS5jYXRjaCgoZXJyb3I6IHVua25vd24pID0+XHJcbiAgICAgICAgdGhpcy5sb2cud2FybignZGVib3VuY2VkIHN5bmMgY3ljbGUgZmFpbGVkJywgZXJyb3IpLFxyXG4gICAgICApO1xyXG4gICAgfSwgdGhpcy5kZWJvdW5jZU1zKTtcclxuICB9XHJcblxyXG4gIC8vIC0tLSB0aGUgc3luYyBjeWNsZSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHJ1bkN5Y2xlKCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgaWYgKHRoaXMudHJhbnNwb3J0ID09PSBudWxsIHx8IHRoaXMuaXNEaXNjb25uZWN0ZWQoKSkgcmV0dXJuO1xyXG4gICAgdGhpcy5zdGF0ZSA9ICdzeW5jaW5nJztcclxuICAgIHRoaXMucHJvZ3Jlc3MgPSBudWxsO1xyXG4gICAgdGhpcy5za2lwcGVkUGF0aHMgPSBbXTtcclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IG1hbmlmZXN0ID0gYXdhaXQgdGhpcy5mZXRjaE1hbmlmZXN0KCk7XHJcbiAgICAgIGNvbnN0IGxvY2FsQ2hhbmdlcyA9IGF3YWl0IHNjYW5WYXVsdChcclxuICAgICAgICB0aGlzLm9wdGlvbnMuc3RvcmFnZSxcclxuICAgICAgICB0aGlzLmluZGV4LFxyXG4gICAgICAgIHRoaXMuaWdub3JlU2V0dGluZ3MsXHJcbiAgICAgICAgdGhpcy5ub3coKSxcclxuICAgICAgICB7XHJcbiAgICAgICAgICBvblByb2dyZXNzOiAoZG9uZSwgdG90YWwpID0+IHRoaXMuZW1pdFByb2dyZXNzKCdzY2FubmluZycsIGRvbmUsIHRvdGFsKSxcclxuICAgICAgICAgIC8vIFNoYXJwZW5zIHRoZSBzdGFsZURpcnMgcnVsZTogYW4gZW1wdHkgZGlyIG92ZXIgYSB0b21ic3RvbmUgVEhJU1xyXG4gICAgICAgICAgLy8gZGV2aWNlIGF1dGhvcmVkIGlzIGEgbG9jYWwgcmVjcmVhdGlvbiwgbm90IGEgZGVsZXRpb24gcmVzaWR1ZS5cclxuICAgICAgICAgIHRoaXNEZXZpY2VJZDogdGhpcy5vcHRpb25zLmRldmljZUlkLFxyXG4gICAgICAgIH0sXHJcbiAgICAgICk7XHJcbiAgICAgIGNvbnN0IHBsYW4gPSBjb21wdXRlU3luY1BsYW4oe1xyXG4gICAgICAgIGxvY2FsQ2hhbmdlcyxcclxuICAgICAgICBpbmRleDogdGhpcy5pbmRleCxcclxuICAgICAgICBtYW5pZmVzdCxcclxuICAgICAgICB0aGlzRGV2aWNlSWQ6IHRoaXMub3B0aW9ucy5kZXZpY2VJZCxcclxuICAgICAgICB0aGlzRGV2aWNlTmFtZTogdGhpcy5vcHRpb25zLmRldmljZU5hbWUsXHJcbiAgICAgICAgbm93OiB0aGlzLm5vdygpLFxyXG4gICAgICB9KTtcclxuICAgICAgLy8gQ29uZmxpY3RzIHJlZmxlY3QgdGhlIGxhdGVzdCBwbGFuOiBlbnRyaWVzIGZvciBwYXRocyBubyBsb25nZXJcclxuICAgICAgLy8gY29udGVzdGVkIGFyZSBkcm9wcGVkIChhIGN5Y2xlIHRoYXQgcGxhbnMgY2xlYW4gY2xlYXJzIHRoZSBsaXN0KSwgc29cclxuICAgICAgLy8gYSBzeW5jZWQtcXVpZXQgY2xpZW50IHJlcG9ydHMgMCB3aGlsZSBzdGlsbC1jb250ZXN0ZWQgcGF0aHMgc3RheVxyXG4gICAgICAvLyB2aXNpYmxlIHVudGlsIGEgY3ljbGUgYWN0dWFsbHkgcmVzb2x2ZXMgdGhlbS5cclxuICAgICAgdGhpcy5jb25mbGljdHMgPSBbLi4ucGxhbi5jb25mbGljdHNdO1xyXG4gICAgICAvLyBDYXNlLWNvbGxpc2lvbiBkaWFnbm9zdGljcyBmcm9tIHRoZSBzY2FuIChuZXZlciBkZWxldGlvbnMgXHUyMDE0IHNlZVxyXG4gICAgICAvLyBgU3luY0NsaWVudFN0YXR1cy5jYXNlQ29sbGlzaW9uc2ApOiByZXBsYWNlZCBldmVyeSBjeWNsZSBzbyBhXHJcbiAgICAgIC8vIHJlc29sdmVkIGNvbGxpc2lvbiBkaXNhcHBlYXJzLCBhbiB1bnJlc29sdmVkIG9uZSBzdGF5cyB2aXNpYmxlLlxyXG4gICAgICB0aGlzLmNhc2VDb2xsaXNpb25zID0gWy4uLihsb2NhbENoYW5nZXMuY2FzZUNvbGxpc2lvbnMgPz8gW10pXTtcclxuICAgICAgaWYgKHRoaXMuY2FzZUNvbGxpc2lvbnMubGVuZ3RoID4gMCkge1xyXG4gICAgICAgIHRoaXMubG9nLndhcm4oXHJcbiAgICAgICAgICAnY2FzZS1jb2xsaWRpbmcgZmlsZSBwYWlyOiB0aGVzZSBmaWxlcyBkaWZmZXIgb25seSBieSBuYW1lIGNhc2UgYW5kIG9uZSBpcyBpbnZpc2libGUgb24gdGhpcyBmaWxlc3lzdGVtOyByZW5hbWUgb25lIG9mIHRoZW0nLFxyXG4gICAgICAgICAgdGhpcy5jYXNlQ29sbGlzaW9ucyxcclxuICAgICAgICApO1xyXG4gICAgICB9XHJcbiAgICAgIC8vIFdpbmRvd3MtdW5zYWZlIGxvY2FsIG5hbWVzIChuZXZlciBwdXNoZWQgXHUyMDE0IHNlZSBgcGF0aHMudHNgKSBzdXJmYWNlXHJcbiAgICAgIC8vIHRocm91Z2ggdGhlIHNhbWUgZGlhZ25vc3RpY3MgY2hhbm5lbC5cclxuICAgICAgZm9yIChjb25zdCBwYXRoIG9mIGxvY2FsQ2hhbmdlcy51bnNhZmVQYXRocyA/PyBbXSkge1xyXG4gICAgICAgIHRoaXMucmVjb3JkU2tpcHBlZFBhdGgocGF0aCk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIFN0YWdlIHB1c2ggY29udGVudHMgQkVGT1JFIHB1bGxzIG92ZXJ3cml0ZSB0aGUgd29ya2luZyB0cmVlIChhXHJcbiAgICAgIC8vIGNvbmZsaWN0LWNvcHkgcHVzaCByZWFkcyB0aGUgbG9zZXIgY29udGVudCBmcm9tIHRoZSBvcmlnaW5hbCBwYXRoKS5cclxuICAgICAgY29uc3Qgc3RhZ2VkID0gYXdhaXQgdGhpcy5zdGFnZVB1c2hlcyhwbGFuLCBsb2NhbENoYW5nZXMuaGFzaGVkKTtcclxuXHJcbiAgICAgIHRoaXMuaW5kZXggPSBhd2FpdCB0aGlzLmFwcGx5UHVsbHMocGxhbi5wdWxscywge1xyXG4gICAgICAgIG9uUHJvZ3Jlc3M6IChkb25lLCB0b3RhbCkgPT4gdGhpcy5lbWl0UHJvZ3Jlc3MoJ3B1bGxpbmcnLCBkb25lLCB0b3RhbCksXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgLy8gUHVzaCBwaXBlbGluZTogdXAgdG8gYHB1c2hDb25jdXJyZW5jeWAgY29tbWl0cyBpbiBmbGlnaHQ7IGFja3MgZm9sZFxyXG4gICAgICAvLyBpbnRvIHRoZSBpbmRleCBhcyB0aGV5IGFycml2ZSAoc2VyaWFsaXplZCB0aHJvdWdoIGBhY2tDaGFpbmApLlxyXG4gICAgICAvLyBCbG9iIHVwbG9hZHMgZm9yID4yNTZLQiBmaWxlcyBzdGFydCBpbnNpZGUgdGhlaXIgc2xvdCBhbmQgb3ZlcmxhcFxyXG4gICAgICAvLyB3aXRoIHRoZSBPVEhFUiBzbG90cycgaW4tZmxpZ2h0IGNvbW1pdHMgaW5zdGVhZCBvZiBzZXJpYWxpemluZy5cclxuICAgICAgY29uc3QgcHVzaFRvdGFsID0gc3RhZ2VkLmxlbmd0aCArIHBsYW4uZm9sZGVyUHVzaGVzLmxlbmd0aDtcclxuICAgICAgbGV0IHB1c2hEb25lID0gMDtcclxuICAgICAgY29uc3Qgc2V0dGxlUHVzaCA9ICgpOiB2b2lkID0+IHtcclxuICAgICAgICBwdXNoRG9uZSArPSAxO1xyXG4gICAgICAgIHRoaXMuZW1pdFByb2dyZXNzKCdwdXNoaW5nJywgcHVzaERvbmUsIHB1c2hUb3RhbCk7XHJcbiAgICAgIH07XHJcbiAgICAgIHRoaXMuZW1pdFByb2dyZXNzKCdwdXNoaW5nJywgMCwgcHVzaFRvdGFsKTtcclxuICAgICAgYXdhaXQgdGhpcy5ydW5QdXNoUGlwZWxpbmUoc3RhZ2VkLCBzZXR0bGVQdXNoKTtcclxuXHJcbiAgICAgIC8vIFBydW5lLW9uLWRlbGV0ZSAoQyksIGxvY2FsIHNpZGU6IGV2ZXJ5IGRlbGV0aW9uIHRoYXQgYWN0dWFsbHlcclxuICAgICAgLy8gY29tbWl0dGVkIHRoaXMgY3ljbGUgKHRoZSBpbmRleCBub3cgdG9tYnN0b25lcyBpdCAvIG1pZ3JhdGVkIGl0IGF3YXkpXHJcbiAgICAgIC8vIG1heSBoYXZlIGVtcHRpZWQgaXRzIHBhcmVudCBkaXJlY3RvcnkuIFJlbW92ZSBzdWNoIGRpcmVjdG9yaWVzIFx1MjAxNFxyXG4gICAgICAvLyBCRUZPUkUgdGhlIHBsYWNlaG9sZGVyIHB1c2hlcyBiZWxvdywgc28gYW4gZW1wdGllZCBkaXJlY3RvcnkgaXMgbm90XHJcbiAgICAgIC8vIGltbWVkaWF0ZWx5IHJlLXB1c2hlZCBhcyBhbiBlbXB0eS1mb2xkZXIgcGxhY2Vob2xkZXIuXHJcbiAgICAgIGNvbnN0IGVtcHRpZWREaXJzID0gbmV3IFNldDxzdHJpbmc+KCk7XHJcbiAgICAgIGZvciAoY29uc3QgY29tbWl0IG9mIHN0YWdlZCkge1xyXG4gICAgICAgIC8vIFRoZSBwYXRoIHRoYXQgY2Vhc2VkIHRvIGV4aXN0LCBJRiBpdHMgY29tbWl0IGFjdHVhbGx5IGxhbmRlZFxyXG4gICAgICAgIC8vICh0b21ic3RvbmVkIGluIHRoZSBpbmRleCBmb3IgZGVsZXRlczsgbWlncmF0ZWQgYXdheSBmb3IgcmVuYW1lcyBcdTIwMTRcclxuICAgICAgICAvLyBhIGRlbGV0ZSB0aGF0IGxvc3QgaXRzIHJhY2UgdG8gYSByZW1vdGUgZWRpdCBpcyBub3QgYSBkZWxldGlvbikuXHJcbiAgICAgICAgbGV0IGNlYXNlZFBhdGg6IHN0cmluZyB8IHVuZGVmaW5lZDtcclxuICAgICAgICBpZiAoY29tbWl0LmtpbmQgPT09ICdkZWxldGUnICYmIGNvbW1pdC5pc0ZvbGRlciAhPT0gdHJ1ZSkge1xyXG4gICAgICAgICAgaWYgKHRoaXMuaW5kZXhbY29tbWl0LnBhdGhdPy5kZWxldGVkQXQgIT09IHVuZGVmaW5lZCkgY2Vhc2VkUGF0aCA9IGNvbW1pdC5wYXRoO1xyXG4gICAgICAgIH0gZWxzZSBpZiAoY29tbWl0LmtpbmQgPT09ICdyZW5hbWUnICYmIGNvbW1pdC5mcm9tUGF0aCAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICBpZiAoIShjb21taXQuZnJvbVBhdGggaW4gdGhpcy5pbmRleCkpIGNlYXNlZFBhdGggPSBjb21taXQuZnJvbVBhdGg7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGlmIChjZWFzZWRQYXRoID09PSB1bmRlZmluZWQpIGNvbnRpbnVlO1xyXG4gICAgICAgIGNvbnN0IHBydW5lZCA9IGF3YWl0IHBydW5lUGFyZW50T25EZWxldGUodGhpcy5vcHRpb25zLnN0b3JhZ2UsIHRoaXMuaW5kZXgsIGNlYXNlZFBhdGgpO1xyXG4gICAgICAgIGlmIChwcnVuZWQgPT09IHVuZGVmaW5lZCkgY29udGludWU7XHJcbiAgICAgICAgZW1wdGllZERpcnMuYWRkKHBydW5lZC5kaXIpO1xyXG4gICAgICAgIGNvbnN0IHBsYWNlaG9sZGVyID0gdGhpcy5pbmRleFtwcnVuZWQuZGlyXTtcclxuICAgICAgICBpZiAocGxhY2Vob2xkZXI/LmlzRm9sZGVyICYmIHBsYWNlaG9sZGVyLmRlbGV0ZWRBdCA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgICAvLyBXZSBqdXN0IHJlbW92ZWQgdGhlIGRpcmVjdG9yeSBhIGxpdmUgcGxhY2Vob2xkZXIgc3RpbGwgY2xhaW1zOlxyXG4gICAgICAgICAgLy8gc2NhbiBhZ2FpbiBzbyB0aGUgcGxhY2Vob2xkZXIgaXMgdG9tYnN0b25lZCBhbmQgcHJvcGFnYXRlcy5cclxuICAgICAgICAgIHRoaXMuc2NoZWR1bGVSZWNvbmNpbGUoKTtcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIC8vIFN0YWxlLWxlZnRvdmVyIGNsZWFudXAgKEYtMSk6IGEgdG9tYnN0b25lZCBmb2xkZXIgcGxhY2Vob2xkZXIgd2hvc2VcclxuICAgICAgLy8gRU1QVFkgZGlyZWN0b3J5IHN0aWxsIGV4aXN0cyBvbiBkaXNrIFx1MjAxNCB0aGUgcmVzaWR1ZSBvZiBhIHJlY29yZC1vbmx5XHJcbiAgICAgIC8vIHRvbWJzdG9uZSBhcHBsaWNhdGlvbiAoYW4gYWRhcHRlciB3aXRob3V0IGByZW1vdmVEaXJgLCBvciBhIHJlbW92YWxcclxuICAgICAgLy8gdGhhdCBsb3N0IGEgcmFjZSkuIFRoZSBzY2FuIGRlbGliZXJhdGVseSBjbGFzc2lmaWVzIHRoZXNlIGFzXHJcbiAgICAgIC8vIGBzdGFsZURpcnNgIGluc3RlYWQgb2YgYGVtcHR5Rm9sZGVyc2AsIHNvIG5vdGhpbmcgYmVsb3cgcmUtcHVzaGVzXHJcbiAgICAgIC8vIHRoZW0gYXMgcGxhY2Vob2xkZXJzICh0aGF0IHJlLXB1c2ggcmVzdXJyZWN0ZWQgZGVsZXRlZCBmb2xkZXJzIGFuZFxyXG4gICAgICAvLyBwaW5nLXBvbmdlZCB0aGUgZGVsZXRpb24gYmV0d2VlbiBkZXZpY2VzKS4gUmV0cnlpbmcgdGhlIHJlbW92YWwgaGVyZVxyXG4gICAgICAvLyBjb252ZXJnZXMgc3RvcmFnZSBvbnRvIHRoZSB0b21ic3RvbmUuXHJcbiAgICAgIGZvciAoY29uc3QgZGlyIG9mIGxvY2FsQ2hhbmdlcy5zdGFsZURpcnMgPz8gW10pIHtcclxuICAgICAgICBhd2FpdCByZW1vdmVEaXJJZlZhY2FudCh0aGlzLm9wdGlvbnMuc3RvcmFnZSwgdGhpcy5pbmRleCwgZGlyKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc3QgZm9sZGVyQ29tbWl0czogU3RhZ2VkQ29tbWl0W10gPSBbXTtcclxuICAgICAgZm9yIChjb25zdCBwYXRoIG9mIHBsYW4uZm9sZGVyUHVzaGVzKSB7XHJcbiAgICAgICAgLy8gTmV2ZXIgcmVzdXJyZWN0IGEgZGlyZWN0b3J5IHRoaXMgY3ljbGUgZW1wdGllZCAoZGVsZXRlLWRlcml2ZWRcclxuICAgICAgICAvLyBwbGFjZWhvbGRlcnMgYXJlIHN1cHByZXNzZWQgZXZlbiB3aGVuIHJlbW92YWwgaXRzZWxmIHdhcyBub3RcclxuICAgICAgICAvLyBwb3NzaWJsZSksIG5vciBwdXNoIG9uZSB0aGF0IHZhbmlzaGVkIHNpbmNlIHRoZSBzY2FuLlxyXG4gICAgICAgIGlmIChlbXB0aWVkRGlycy5oYXMocGF0aCkpIGNvbnRpbnVlO1xyXG4gICAgICAgIGlmICghKGF3YWl0IHRoaXMuc3RvcmFnZUV4aXN0cyhwYXRoKSkpIGNvbnRpbnVlO1xyXG4gICAgICAgIGZvbGRlckNvbW1pdHMucHVzaCh7XHJcbiAgICAgICAgICBraW5kOiAnZWRpdCcsXHJcbiAgICAgICAgICBwYXRoLFxyXG4gICAgICAgICAgcGFyZW50VmVyc2lvbjogdGhpcy5pbmRleFtwYXRoXT8udmVyc2lvbklkID8/IG51bGwsXHJcbiAgICAgICAgICBoYXNoOiAnJyxcclxuICAgICAgICAgIHNpemU6IDAsXHJcbiAgICAgICAgICBpc0ZvbGRlcjogdHJ1ZSxcclxuICAgICAgICB9KTtcclxuICAgICAgfVxyXG4gICAgICBhd2FpdCB0aGlzLnJ1blB1c2hQaXBlbGluZShmb2xkZXJDb21taXRzLCBzZXR0bGVQdXNoKTtcclxuXHJcbiAgICAgIC8vIENhY2hlIHRoZSBzY2FuJ3MgaGFzaCBvYnNlcnZhdGlvbnMgKG10aW1lKSBvbnRvIGVudHJpZXMgd2hvc2UgaGFzaFxyXG4gICAgICAvLyBzdGlsbCBtYXRjaGVzLCBzbyB0aGUgbmV4dCBmYXN0IHNjYW4gY2FuIHNraXAgdGhvc2UgZmlsZXMuIFJ1bnNcclxuICAgICAgLy8gYWZ0ZXIgcHVsbHMvcHVzaGVzIHNvIGZyZXNobHktYWNrZWQgZW50cmllcyBiZW5lZml0IGltbWVkaWF0ZWx5O1xyXG4gICAgICAvLyBgcmVjb3JkSGFzaGVkRmlsZXNgIHNraXBzIGFueXRoaW5nIHRoZSBjeWNsZSBjaGFuZ2VkIHVuZGVybmVhdGggdXMuXHJcbiAgICAgIHRoaXMuaW5kZXggPSByZWNvcmRIYXNoZWRGaWxlcyh0aGlzLmluZGV4LCBsb2NhbENoYW5nZXMuaGFzaGVkKTtcclxuXHJcbiAgICAgIC8vIFRoZSBjeWNsZSBmaW5pc2hlZCBjbGVhbjogZXZlcnkgcHVsbCBvZiB0aGUgbWFuaWZlc3QgYXBwbGllZCwgZXZlcnlcclxuICAgICAgLy8gc3RhZ2VkIGNvbW1pdCBhY2tlZC4gVGhlIGluZGV4IGlzIG5vdyBjb21wbGV0ZSB0aHJvdWdoIHRoZSBNQU5JRkVTVCdzXHJcbiAgICAgIC8vIGZldGNoLXRpbWUgY3Vyc29yIChkZWxpYmVyYXRlbHkgbm90IHRoZSBsYXRlciBhY2sgc2VxcyBcdTIwMTQgYSBjb25jdXJyZW50XHJcbiAgICAgIC8vIGRldmljZSdzIGNoYW5nZSBjYW4gaW50ZXJsZWF2ZSBhbmQgcmlkZSB0aGUgcG9zdC1jeWNsZSBkaXNwYXRjaFxyXG4gICAgICAvLyBxdWV1ZSksIHdoaWNoIGlzIHdoYXQgbWFrZXMgdGhlIG5leHQgZGVsdGEgbWFuaWZlc3Qgc2FmZS5cclxuICAgICAgaWYgKHRoaXMubWFuaWZlc3RDdXJzb3JPZkN5Y2xlICE9PSBudWxsICYmIHRoaXMubWFuaWZlc3RDdXJzb3JPZkN5Y2xlID4gKHRoaXMuc3luY2VkVGhyb3VnaCA/PyAwKSkge1xyXG4gICAgICAgIHRoaXMuc3luY2VkVGhyb3VnaCA9IHRoaXMubWFuaWZlc3RDdXJzb3JPZkN5Y2xlO1xyXG4gICAgICB9XHJcbiAgICAgIHRoaXMubWFuaWZlc3RDdXJzb3JPZkN5Y2xlID0gbnVsbDtcclxuICAgICAgdGhpcy5uZWVkc0Z1bGxNYW5pZmVzdCA9IGZhbHNlO1xyXG5cclxuICAgICAgdGhpcy5sYXN0U3luY0F0ID0gdGhpcy5ub3coKTtcclxuICAgICAgdGhpcy5wZW5kaW5nID0gMDtcclxuICAgICAgaWYgKCF0aGlzLmlzRGlzY29ubmVjdGVkKCkpIHRoaXMuc3RhdGUgPSAnbGl2ZSc7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICB0aGlzLm1hbmlmZXN0Q3Vyc29yT2ZDeWNsZSA9IG51bGw7XHJcbiAgICAgIHRoaXMubG9nLmVycm9yKCdzeW5jIGN5Y2xlIGZhaWxlZCcsIGVycm9yKTtcclxuICAgICAgaWYgKCF0aGlzLmlzRGlzY29ubmVjdGVkKCkpIHRoaXMuc3RhdGUgPSB0aGlzLnRyYW5zcG9ydCAhPT0gbnVsbCA/ICdsaXZlJyA6ICdpZGxlJztcclxuICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICB9IGZpbmFsbHkge1xyXG4gICAgICB0aGlzLnByb2dyZXNzID0gbnVsbDtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFRoZSBtYW5pZmVzdCdzIGZldGNoLXRpbWUgY3Vyc29yIGZvciB0aGUgUlVOTklORyBjeWNsZSBcdTIwMTQgdGhlIGNvbXBsZXRpb25cclxuICAgKiB3YXRlcm1hcmsgYSBzdWNjZXNzZnVsIGN5Y2xlIHJlY29yZHMgaW50byBgc3luY2VkVGhyb3VnaGAgKHNlZSB0aGVcclxuICAgKiBjb21tZW50IHRoZXJlKS4gTnVsbCBvdXRzaWRlIGN5Y2xlcy5cclxuICAgKi9cclxuICBwcml2YXRlIG1hbmlmZXN0Q3Vyc29yT2ZDeWNsZTogbnVtYmVyIHwgbnVsbCA9IG51bGw7XHJcblxyXG4gIC8qKlxyXG4gICAqIFdoZXRoZXIgVEhJUyBjeWNsZSBtYXkgcmVxdWVzdCBhIGRlbHRhIG1hbmlmZXN0LiBBbGwgZm91ciBnYXRlcyBtdXN0XHJcbiAgICogaG9sZCAoYW55IGZhaWx1cmUgXHUyMUQyIGZ1bGwgbWFuaWZlc3QsIHRvZGF5J3MgYmVoYXZpb3IpOlxyXG4gICAqXHJcbiAgICogIDEuIGBjdXJzb3IgPiAwYCBcdTIwMTQgYSBmaXJzdC1ldmVyIGNvbm5lY3Qga25vd3Mgbm90aGluZzsgZnVsbCBtYW5pZmVzdC5cclxuICAgKiAgMi4gYHN5bmNlZFRocm91Z2ggIT09IG51bGxgIFx1MjAxNCBzb21lIGZ1bGwtbWFuaWZlc3QgY3ljbGUgY29tcGxldGVkLCBzbyB0aGVcclxuICAgKiAgICAgaW5kZXggaXMgQ09NUExFVEUgdGhyb3VnaCBpdDsgaGVhZHMgYWZ0ZXIgaXQgYXJyaXZlIHZpYSByZXBsYXkgK1xyXG4gICAqICAgICBkZWx0YS4gQW4gaW50ZXJydXB0ZWQgaW5pdGlhbCBzeW5jIG5ldmVyIHNldHMgaXQgXHUyMUQyIGZ1bGwgbWFuaWZlc3QuXHJcbiAgICogIDMuIGAhbmVlZHNGdWxsTWFuaWZlc3RgIFx1MjAxNCBubyBkZWZlcnJlZCBkaXZlcmdlbmNlIGF3YWl0cyBwbGFuIHJlc29sdXRpb24uXHJcbiAgICogIDQuIFJlcGxheSB3aW5kb3cgaW50YWN0IFx1MjAxNCBoZWxsb0FjayByZXBvcnRlZCBgb2xkZXN0UmV0YWluZWRTZXEgPD1cclxuICAgKiAgICAgY3Vyc29yICsgMWAsIHNvIGV2ZXJ5IGV2ZW50IGFmdGVyIG91ciBjdXJzb3IgaXMgc3RpbGwgb24gdGhlIHNlcnZlci5cclxuICAgKi9cclxuICBwcml2YXRlIHNob3VsZFJlcXVlc3REZWx0YU1hbmlmZXN0KCk6IGJvb2xlYW4ge1xyXG4gICAgcmV0dXJuIChcclxuICAgICAgdGhpcy5jdXJzb3IgPiAwICYmXHJcbiAgICAgIHRoaXMuc3luY2VkVGhyb3VnaCAhPT0gbnVsbCAmJlxyXG4gICAgICAhdGhpcy5uZWVkc0Z1bGxNYW5pZmVzdCAmJlxyXG4gICAgICB0aGlzLnNlcnZlck9sZGVzdFJldGFpbmVkU2VxICE9PSBudWxsICYmXHJcbiAgICAgIHRoaXMuc2VydmVyT2xkZXN0UmV0YWluZWRTZXEgPD0gdGhpcy5jdXJzb3IgKyAxXHJcbiAgICApO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBmZXRjaE1hbmlmZXN0KCk6IFByb21pc2U8UmVtb3RlRmlsZVtdPiB7XHJcbiAgICBjb25zdCB0cmFuc3BvcnQgPSB0aGlzLnRyYW5zcG9ydDtcclxuICAgIGlmICh0cmFuc3BvcnQgPT09IG51bGwpIHRocm93IG5ldyBOZXR3b3JrRXJyb3IoJ25vdCBjb25uZWN0ZWQnKTtcclxuICAgIGNvbnN0IHVzZURlbHRhID0gdGhpcy5zaG91bGRSZXF1ZXN0RGVsdGFNYW5pZmVzdCgpO1xyXG4gICAgY29uc3Qgc2luY2UgPSB1c2VEZWx0YSAmJiB0aGlzLnN5bmNlZFRocm91Z2ggIT09IG51bGwgPyB0aGlzLnN5bmNlZFRocm91Z2ggOiB1bmRlZmluZWQ7XHJcbiAgICBjb25zdCByZXBseSA9IGF3YWl0IHRoaXMucmVxdWVzdDxNYW5pZmVzdE1lc3NhZ2UgfCBTZXJ2ZXJFcnJvck1lc3NhZ2U+KFxyXG4gICAgICAobSkgPT4gbS50eXBlID09PSAnbWFuaWZlc3QnIHx8IG0udHlwZSA9PT0gJ2Vycm9yJyxcclxuICAgICAgKCkgPT4gdHJhbnNwb3J0LnNlbmQoeyB0eXBlOiAnZ2V0TWFuaWZlc3QnLCAuLi4oc2luY2UgIT09IHVuZGVmaW5lZCA/IHsgc2luY2UgfSA6IHt9KSB9KSxcclxuICAgICk7XHJcbiAgICBpZiAocmVwbHkudHlwZSA9PT0gJ2Vycm9yJykgdGhyb3cgdGhpcy50b0Vycm9yKHJlcGx5KTtcclxuICAgIHZhbGlkYXRlTWFuaWZlc3RNZXNzYWdlKHJlcGx5KTtcclxuICAgIGlmIChyZXBseS5jdXJzb3IgPiB0aGlzLmN1cnNvcikgdGhpcy5jdXJzb3IgPSByZXBseS5jdXJzb3I7XHJcbiAgICB0aGlzLm1hbmlmZXN0Q3Vyc29yT2ZDeWNsZSA9IHJlcGx5LmN1cnNvcjtcclxuICAgIGlmICghdXNlRGVsdGEpIHtcclxuICAgICAgcmV0dXJuIHRoaXMudG9SZW1vdGVGaWxlcyhPYmplY3QudmFsdWVzKHJlcGx5LmVudHJpZXMpKTtcclxuICAgIH1cclxuICAgIC8vIERlbHRhOiBtZXJnZSB0aGUgY2hhbmdlZCBoZWFkcyBvdmVyIGFuIElOREVYIFBST0pFQ1RJT04gb2YgdGhlIGZ1bGxcclxuICAgIC8vIG1hbmlmZXN0LiBjb21wdXRlU3luY1BsYW4gbmVlZHMgdGhlIGNvbXBsZXRlIHJlbW90ZSB2aWV3IFx1MjAxNCBQaGFzZSBCXHJcbiAgICAvLyB0cmVhdHMgYW4gaW5kZXggcGF0aCBhYnNlbnQgZnJvbSB0aGUgbWFuaWZlc3QgYXMgXCJtaWdyYXRlZCBhd2F5XCIgXHUyMDE0IGFuZFxyXG4gICAgLy8gZWxpZ2liaWxpdHkgZ3VhcmFudGVlcyB0aGUgaW5kZXggYWxyZWFkeSBhZ3JlZXMgd2l0aCB0aGUgc2VydmVyIGZvclxyXG4gICAgLy8gZXZlcnkgcGF0aCB0aGUgZGVsdGEgb21pdHMgKGhlYWRzIFx1MjI2NCBzeW5jZWRUaHJvdWdoKS4gUHJvamVjdGluZyBlbnRyaWVzXHJcbiAgICAvLyB0byB0aGVpciBpbmRleCBzdGF0ZSB0aGVyZWZvcmUgcmVjb25zdHJ1Y3RzIGV4YWN0bHkgd2hhdCB0aGUgZnVsbFxyXG4gICAgLy8gbWFuaWZlc3Qgd291bGQgaGF2ZSBzYWlkLCBhdCBPKGNoYW5nZXMpIGluc3RlYWQgb2YgTyh2YXVsdCkuXHJcbiAgICBjb25zdCBtZXJnZWQgPSBuZXcgTWFwPHN0cmluZywgUmVtb3RlRmlsZT4oKTtcclxuICAgIGZvciAoY29uc3QgW3BhdGgsIGVudHJ5XSBvZiBPYmplY3QuZW50cmllcyh0aGlzLmluZGV4KSkge1xyXG4gICAgICBtZXJnZWQuc2V0KHBhdGgsIHtcclxuICAgICAgICBwYXRoLFxyXG4gICAgICAgIHZlcnNpb246IGVudHJ5LnZlcnNpb25JZCxcclxuICAgICAgICBoYXNoOiBlbnRyeS5oYXNoLFxyXG4gICAgICAgIHNpemU6IGVudHJ5LnNpemUsXHJcbiAgICAgICAgZGVsZXRlZDogZW50cnkuZGVsZXRlZEF0ICE9PSB1bmRlZmluZWQsXHJcbiAgICAgICAgY2xvY2s6IGVudHJ5LmNsb2NrLFxyXG4gICAgICAgIC4uLihlbnRyeS5pc0ZvbGRlciA/IHsgaXNGb2xkZXI6IHRydWUgfSA6IHt9KSxcclxuICAgICAgICBtdGltZTogZW50cnkubXRpbWUgPz8gMCxcclxuICAgICAgfSk7XHJcbiAgICB9XHJcbiAgICBmb3IgKGNvbnN0IFtwYXRoLCBlbnRyeV0gb2YgT2JqZWN0LmVudHJpZXMocmVwbHkuZW50cmllcykpIHtcclxuICAgICAgbWVyZ2VkLnNldChwYXRoLCB7IC4uLmVudHJ5IH0pO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHRoaXMudG9SZW1vdGVGaWxlcyhbLi4ubWVyZ2VkLnZhbHVlcygpXSk7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBQcm9qZWN0IG1hbmlmZXN0LXNpZGUgZW50cmllcyB0byBgUmVtb3RlRmlsZWBzLCBza2lwcGluZyBXaW5kb3dzLXVuc2FmZVxyXG4gICAqIHBhdGhzIChkaWFnbm9zZWQgdmlhIGByZWNvcmRTa2lwcGVkUGF0aGAsIG5ldmVyIGhhbmRlZCB0byB0aGUgcGxhbm5lciBcdTIwMTRcclxuICAgKiBtYXRlcmlhbGl6aW5nIHRoZW0gaXMgaW1wb3NzaWJsZSwgc28gcGxhbm5pbmcgdGhlbSB3b3VsZCBvbmx5IHByb2R1Y2UgYVxyXG4gICAqIHB1bGwgdGhhdCBmYWlscyBldmVyeSBjeWNsZSkuXHJcbiAgICovXHJcbiAgcHJpdmF0ZSB0b1JlbW90ZUZpbGVzKGVudHJpZXM6IHJlYWRvbmx5IFJlbW90ZUZpbGVbXSk6IFJlbW90ZUZpbGVbXSB7XHJcbiAgICBjb25zdCByZW1vdGU6IFJlbW90ZUZpbGVbXSA9IFtdO1xyXG4gICAgZm9yIChjb25zdCBlbnRyeSBvZiBlbnRyaWVzKSB7XHJcbiAgICAgIGlmIChpc1dpbmRvd3NVbnNhZmVQYXRoKGVudHJ5LnBhdGgpKSB7XHJcbiAgICAgICAgdGhpcy5yZWNvcmRTa2lwcGVkUGF0aChlbnRyeS5wYXRoKTtcclxuICAgICAgICBjb250aW51ZTtcclxuICAgICAgfVxyXG4gICAgICByZW1vdGUucHVzaCh7IC4uLmVudHJ5IH0pO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHJlbW90ZTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgc3RhZ2VQdXNoZXMoXHJcbiAgICBwbGFuOiBTeW5jUGxhbixcclxuICAgIGhhc2hlZDogcmVhZG9ubHkgSGFzaGVkRmlsZVtdLFxyXG4gICk6IFByb21pc2U8U3RhZ2VkQ29tbWl0W10+IHtcclxuICAgIC8vIEEgY29uZmxpY3QtY29weSBwdXNoIGNhcnJpZXMgY29udGVudCByZWFkIGZyb20gdGhlICpvcmlnaW5hbCogcGF0aC5cclxuICAgIGNvbnN0IGNvcHlTb3VyY2VzID0gbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oKTtcclxuICAgIGZvciAoY29uc3QgY29uZmxpY3Qgb2YgcGxhbi5jb25mbGljdHMpIHtcclxuICAgICAgaWYgKGNvbmZsaWN0LmNvbmZsaWN0Q29weVBhdGggIT09IHVuZGVmaW5lZCkge1xyXG4gICAgICAgIGNvcHlTb3VyY2VzLnNldChjb25mbGljdC5jb25mbGljdENvcHlQYXRoLCBjb25mbGljdC5wYXRoKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gICAgLy8gSGFzaC10aW1lIHN0YXRzIGJ5IHBhdGg6IHBpbm5pbmcgdGhlc2Ugb250byB0aGUgYWNrZWQgZW50cmllcyAoYmVsb3cpXHJcbiAgICAvLyBrZWVwcyB0aGUgZmFzdC1wYXRoIGNhY2hlIGhvbmVzdCBcdTIwMTQgc2VlIGBTdGFnZWRDb21taXQubXRpbWVgLlxyXG4gICAgY29uc3QgaGFzaFRpbWVNdGltZSA9IG5ldyBNYXAoaGFzaGVkLm1hcCgob2JzZXJ2ZWQpID0+IFtvYnNlcnZlZC5wYXRoLCBvYnNlcnZlZC5tdGltZV0pKTtcclxuXHJcbiAgICBjb25zdCBzdGFnZWQ6IFN0YWdlZENvbW1pdFtdID0gW107XHJcbiAgICBmb3IgKGNvbnN0IHB1c2ggb2YgcGxhbi5wdXNoZXMpIHtcclxuICAgICAgaWYgKHB1c2gua2luZCA9PT0gJ2RlbGV0ZScgfHwgcHVzaC5raW5kID09PSAncmVuYW1lJykge1xyXG4gICAgICAgIHN0YWdlZC5wdXNoKHRoaXMudG9TdGFnZWQocHVzaCkpO1xyXG4gICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICB9XHJcbiAgICAgIGNvbnN0IHNvdXJjZVBhdGggPVxyXG4gICAgICAgIHB1c2gua2luZCA9PT0gJ2NvbmZsaWN0Q29weScgPyBjb3B5U291cmNlcy5nZXQocHVzaC5wYXRoKSA/PyBwdXNoLnBhdGggOiBwdXNoLnBhdGg7XHJcbiAgICAgIGNvbnN0IGJ5dGVzID0gYXdhaXQgdGhpcy5yZWFkTG9jYWwoc291cmNlUGF0aCk7XHJcbiAgICAgIGlmIChieXRlcyA9PT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgICAgdGhpcy5sb2cud2FybigncHVzaCBzb3VyY2UgdmFuaXNoZWQgc2luY2Ugc2NhbjsgZGVmZXJyaW5nJywgcHVzaC5wYXRoKTtcclxuICAgICAgICB0aGlzLnNjaGVkdWxlUmVjb25jaWxlKCk7XHJcbiAgICAgICAgY29udGludWU7XHJcbiAgICAgIH1cclxuICAgICAgY29uc3QgaGFzaCA9IGF3YWl0IHNoYTI1NkhleChieXRlcyk7XHJcbiAgICAgIGlmIChoYXNoICE9PSBwdXNoLmhhc2ggfHwgYnl0ZXMuYnl0ZUxlbmd0aCAhPT0gcHVzaC5zaXplKSB7XHJcbiAgICAgICAgdGhpcy5sb2cud2FybignbG9jYWwgY29udGVudCBkcmlmdGVkIHNpbmNlIHNjYW47IGRlZmVycmluZyBwdXNoJywgcHVzaC5wYXRoKTtcclxuICAgICAgICB0aGlzLnNjaGVkdWxlUmVjb25jaWxlKCk7XHJcbiAgICAgICAgY29udGludWU7XHJcbiAgICAgIH1cclxuICAgICAgaWYgKHB1c2gua2luZCA9PT0gJ2NvbmZsaWN0Q29weScpIHtcclxuICAgICAgICAvLyBNYXRlcmlhbGl6ZSB0aGUgY29weSBsb2NhbGx5IE5PVywgYmVmb3JlIHRoZSBwdWxscyBvdmVyd3JpdGUgdGhlXHJcbiAgICAgICAgLy8gb3JpZ2luYWw6IHRoZSBzZXJ2ZXIgYnJvYWRjYXN0cyB0aGUgY29weSB0byAqb3RoZXIqIGNsaWVudHMgb25seSxcclxuICAgICAgICAvLyBzbyB0aGlzIGRldmljZSBtdXN0IHdyaXRlIGl0cyBvd24gY29weSBpdHNlbGYuIFRoZSBjb3B5IGxhbmRzIGF0IGFcclxuICAgICAgICAvLyBORVcgcGF0aCB3aG9zZSBvbi1kaXNrIHN0YXQgZGlmZmVycyBmcm9tIHRoZSBzb3VyY2UncyBcdTIwMTQgbm8gaGFzaC10aW1lXHJcbiAgICAgICAgLy8gc3RhdCB0byBwaW4sIHRoZSBuZXh0IHNjYW4gcmVjb3JkcyBvbmUuXHJcbiAgICAgICAgYXdhaXQgdGhpcy5vcHRpb25zLnN0b3JhZ2Uud3JpdGVGaWxlKHB1c2gucGF0aCwgYnl0ZXMpO1xyXG4gICAgICAgIHN0YWdlZC5wdXNoKHsgLi4udGhpcy50b1N0YWdlZChwdXNoKSwgYnl0ZXMgfSk7XHJcbiAgICAgICAgY29udGludWU7XHJcbiAgICAgIH1cclxuICAgICAgc3RhZ2VkLnB1c2goe1xyXG4gICAgICAgIC4uLnRoaXMudG9TdGFnZWQocHVzaCksXHJcbiAgICAgICAgYnl0ZXMsXHJcbiAgICAgICAgLi4uKGhhc2hUaW1lTXRpbWUuZ2V0KHNvdXJjZVBhdGgpICE9PSB1bmRlZmluZWRcclxuICAgICAgICAgID8geyBtdGltZTogaGFzaFRpbWVNdGltZS5nZXQoc291cmNlUGF0aCkgfVxyXG4gICAgICAgICAgOiB7fSksXHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG4gICAgcmV0dXJuIHN0YWdlZDtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgdG9TdGFnZWQocHVzaDogUHVzaE9wKTogU3RhZ2VkQ29tbWl0IHtcclxuICAgIGlmIChwdXNoLmtpbmQgPT09ICdyZW5hbWUnKSB7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAga2luZDogJ3JlbmFtZScsXHJcbiAgICAgICAgcGF0aDogcHVzaC50b1BhdGgsXHJcbiAgICAgICAgcGFyZW50VmVyc2lvbjogcHVzaC5wYXJlbnRWZXJzaW9uLFxyXG4gICAgICAgIGhhc2g6IHB1c2guaGFzaCxcclxuICAgICAgICBzaXplOiBwdXNoLnNpemUsXHJcbiAgICAgICAgZnJvbVBhdGg6IHB1c2guZnJvbVBhdGgsXHJcbiAgICAgIH07XHJcbiAgICB9XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBraW5kOiBwdXNoLmtpbmQgPT09ICdhZGQnID8gJ2VkaXQnIDogcHVzaC5raW5kLFxyXG4gICAgICBwYXRoOiBwdXNoLnBhdGgsXHJcbiAgICAgIHBhcmVudFZlcnNpb246IHB1c2gucGFyZW50VmVyc2lvbixcclxuICAgICAgaGFzaDogcHVzaC5oYXNoLFxyXG4gICAgICBzaXplOiBwdXNoLnNpemUsXHJcbiAgICAgIC4uLihwdXNoLmlzRm9sZGVyID8geyBpc0ZvbGRlcjogdHJ1ZSB9IDoge30pLFxyXG4gICAgfTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgcmVhZExvY2FsKHBhdGg6IHN0cmluZyk6IFByb21pc2U8VWludDhBcnJheSB8IHVuZGVmaW5lZD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMub3B0aW9ucy5zdG9yYWdlLnJlYWRGaWxlKHBhdGgpO1xyXG4gICAgfSBjYXRjaCB7XHJcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBTZW5kIGBjb21taXRzYCB0aHJvdWdoIGEgYm91bmRlZC1jb25jdXJyZW5jeSBwaXBlbGluZTogdXAgdG9cclxuICAgKiBgcHVzaENvbmN1cnJlbmN5YCBjb21taXRzIGluIGZsaWdodCAoc2VudCwgYXdhaXRpbmcgdGhlaXIgc2VydmVyIHJlcGx5KVxyXG4gICAqIGF0IG9uY2U7IGVhY2ggc2xvdCBzZW5kcyBpdHMgbmV4dCBjb21taXQgYXMgc29vbiBhcyBhbiBlYXJsaWVyIG9uZSBpc1xyXG4gICAqIHNldHRsZWQuXHJcbiAgICpcclxuICAgKiBXSFkgUElQRUxJTklORyBJUyBTQUZFICh2cy4gYSBiYXRjaCBtZXNzYWdlKTogY29uZmxpY3QgYXJiaXRyYXRpb24gaXNcclxuICAgKiBTRVJWRVItc2lkZSBhbmQgUEVSIFBBVEggKGBhcmJpdHJhdGVDb21taXRgIHJlYWRzIGFuZCB3cml0ZXMgZXhhY3RseSB0aGVcclxuICAgKiBjb21taXR0ZWQgcGF0aCdzIGhlYWQpLCBhbmQgYSBjeWNsZSBzdGFnZXMgYXQgbW9zdCBPTkUgY29tbWl0IHBlciBwYXRoXHJcbiAgICogKHRoZSBzY2FuIGJ1Y2tldHMgYnkgcGF0aDsgcmVuYW1lcyBjb25zdW1lIGJvdGggZW5kcykuIFNvIHR3byBpbi1mbGlnaHRcclxuICAgKiBjb21taXRzIGNhbiBuZXZlciBpbnRlcmFjdCBvbiB0aGUgc2VydmVyLCBhbmQgcmVwbHkgT1JERVIgYWNyb3NzXHJcbiAgICogZGlmZmVyZW50IHBhdGhzIGRvZXMgbm90IG1hdHRlciBmb3IgdGhlIHJlc3VsdGluZyBzdGF0ZSBcdTIwMTQgb25seSBwZXItcGF0aFxyXG4gICAqIHBhaXJpbmcgb2YgcmVwbHlcdTIxOTJjb21taXQgbWF0dGVycywgd2hpY2ggdGhlIG9yZGVyZWQgV2ViU29ja2V0IHBsdXMgdGhlXHJcbiAgICogc2VydmVyJ3Mgc2VyaWFsaXplZCBhcmJpdHJhdGlvbiBndWFyYW50ZWUgKHJlcGxpZXMgYXJyaXZlIGluIHNlbmQgb3JkZXIsXHJcbiAgICogbWF0Y2hlZCBGSUZPIGJ5IGBvblRyYW5zcG9ydE1lc3NhZ2VgKS4gQSBiYXRjaCBwcm90b2NvbCBtZXNzYWdlIHdvdWxkXHJcbiAgICogYWRkaXRpb25hbGx5IGNvdXBsZSBibG9iLXVwbG9hZCB0aW1pbmcgYW5kIGVycm9yIGdyYW51bGFyaXR5IGZvciBub1xyXG4gICAqIGNvcnJlY3RuZXNzIGdhaW4sIHNvIHByb3RvY29sIHYxIHN0YXlzIHVuY2hhbmdlZC5cclxuICAgKlxyXG4gICAqIE9uIHRoZSBmaXJzdCBmYWlsdXJlLCBpbi1mbGlnaHQgY29tbWl0cyBzdGlsbCBzZXR0bGUgKHRoZWlyIGFja3MgYXJlXHJcbiAgICogYXBwbGllZCBcdTIwMTQgdGhleSBhcmUgcmVhbCBoZWFkcykgYnV0IG5vIE5FVyBjb21taXQgc3RhcnRzOyB0aGUgZXJyb3IgaXNcclxuICAgKiByZXRocm93biBhZnRlciBhbGwgc2xvdHMgZHJhaW4gc28gdGhlIGN5Y2xlIGZhaWxzIGV4YWN0bHkgbGlrZSB0aGUgb2xkXHJcbiAgICogc2VxdWVudGlhbCBsb29wIGRpZCAodW5zZW50IHB1c2hlcyBzaW1wbHkgcmV0cnkgbmV4dCBjeWNsZSkuXHJcbiAgICovXHJcbiAgcHJpdmF0ZSBhc3luYyBydW5QdXNoUGlwZWxpbmUoXHJcbiAgICBjb21taXRzOiByZWFkb25seSBTdGFnZWRDb21taXRbXSxcclxuICAgIG9uU2V0dGxlZDogKCkgPT4gdm9pZCxcclxuICApOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGlmIChjb21taXRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xyXG4gICAgbGV0IG5leHQgPSAwO1xyXG4gICAgbGV0IGZhaWx1cmU6IEVycm9yIHwgbnVsbCA9IG51bGw7XHJcbiAgICBjb25zdCBzbG90cyA9IE1hdGgubWluKHRoaXMucHVzaENvbmN1cnJlbmN5LCBjb21taXRzLmxlbmd0aCk7XHJcbiAgICBjb25zdCB3b3JrZXIgPSBhc3luYyAoKTogUHJvbWlzZTx2b2lkPiA9PiB7XHJcbiAgICAgIHdoaWxlIChuZXh0IDwgY29tbWl0cy5sZW5ndGgpIHtcclxuICAgICAgICBpZiAoZmFpbHVyZSAhPT0gbnVsbCkgcmV0dXJuO1xyXG4gICAgICAgIGNvbnN0IGNvbW1pdCA9IGNvbW1pdHNbbmV4dCsrXSE7XHJcbiAgICAgICAgdHJ5IHtcclxuICAgICAgICAgIGF3YWl0IHRoaXMuc2VuZENvbW1pdChjb21taXQpO1xyXG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XHJcbiAgICAgICAgICBmYWlsdXJlID8/PSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgRXJyb3IoU3RyaW5nKGVycm9yKSk7XHJcbiAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfSBmaW5hbGx5IHtcclxuICAgICAgICAgIG9uU2V0dGxlZCgpO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgfTtcclxuICAgIGF3YWl0IFByb21pc2UuYWxsKEFycmF5LmZyb20oeyBsZW5ndGg6IHNsb3RzIH0sIHdvcmtlcikpO1xyXG4gICAgaWYgKGZhaWx1cmUgIT09IG51bGwpIHRocm93IGZhaWx1cmU7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHNlbmRDb21taXQoY29tbWl0OiBTdGFnZWRDb21taXQpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGNvbnN0IHRyYW5zcG9ydCA9IHRoaXMudHJhbnNwb3J0O1xyXG4gICAgaWYgKHRyYW5zcG9ydCA9PT0gbnVsbCkgdGhyb3cgbmV3IE5ldHdvcmtFcnJvcignbm90IGNvbm5lY3RlZCcpO1xyXG5cclxuICAgIGNvbnN0IG1lc3NhZ2U6IENvbW1pdE1lc3NhZ2UgPSB7XHJcbiAgICAgIHR5cGU6ICdjb21taXQnLFxyXG4gICAgICBwYXRoOiBjb21taXQucGF0aCxcclxuICAgICAgcGFyZW50VmVyc2lvbjogY29tbWl0LnBhcmVudFZlcnNpb24sXHJcbiAgICAgIGhhc2g6IGNvbW1pdC5oYXNoLFxyXG4gICAgICBzaXplOiBjb21taXQuc2l6ZSxcclxuICAgICAga2luZDogY29tbWl0LmtpbmQsXHJcbiAgICAgIC4uLihjb21taXQuZnJvbVBhdGggIT09IHVuZGVmaW5lZCA/IHsgZnJvbVBhdGg6IGNvbW1pdC5mcm9tUGF0aCB9IDoge30pLFxyXG4gICAgICAuLi4oY29tbWl0LmlzRm9sZGVyID09PSB0cnVlID8geyBpc0ZvbGRlcjogdHJ1ZSB9IDoge30pLFxyXG4gICAgICAuLi4oY29tbWl0LmJ5dGVzICE9PSB1bmRlZmluZWQgJiYgY29tbWl0LmJ5dGVzLmJ5dGVMZW5ndGggPD0gSU5MSU5FX0NPTlRFTlRfTUFYX0JZVEVTXHJcbiAgICAgICAgPyB7IGlubGluZTogYnl0ZXNUb0Jhc2U2NChjb21taXQuYnl0ZXMpIH1cclxuICAgICAgICA6IHt9KSxcclxuICAgIH07XHJcblxyXG4gICAgLy8gQXR0YWNobWVudHMgYWJvdmUgdGhlIGlubGluZSBjYXAgcmlkZSB0aGUgYmxvYiBzdG9yZSAoRlItOCkuIEluc2lkZSBhXHJcbiAgICAvLyBwaXBlbGluZSBzbG90IHRoaXMgYXdhaXQgb3ZlcmxhcHMgd2l0aCB0aGUgT1RIRVIgc2xvdHMnIGluLWZsaWdodFxyXG4gICAgLy8gY29tbWl0cyBcdTIwMTQgdGhlIHVwbG9hZCBubyBsb25nZXIgc2VyaWFsaXplcyBhaGVhZCBvZiBldmVyeSBjb21taXQgXHUyMDE0IGFuZFxyXG4gICAgLy8gc3RpbGwgY29tcGxldGVzIGJlZm9yZSBJVFMgY29tbWl0IGlzIHNlbnQgKHRoZSBzZXJ2ZXIgcmVqZWN0cyBhIGNvbW1pdFxyXG4gICAgLy8gd2hvc2UgYmxvYiBoYXMgbm90IGFycml2ZWQpLlxyXG4gICAgaWYgKGNvbW1pdC5ieXRlcyAhPT0gdW5kZWZpbmVkICYmIGNvbW1pdC5ieXRlcy5ieXRlTGVuZ3RoID4gSU5MSU5FX0NPTlRFTlRfTUFYX0JZVEVTKSB7XHJcbiAgICAgIGF3YWl0IHRoaXMudXBsb2FkQmxvYihjb21taXQuaGFzaCwgY29tbWl0LmJ5dGVzKTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCByZXBseSA9IGF3YWl0IHRoaXMucmVxdWVzdDxDb21taXRBY2tNZXNzYWdlIHwgQ29uZmxpY3RNZXNzYWdlIHwgU2VydmVyRXJyb3JNZXNzYWdlPihcclxuICAgICAgKG0pID0+IG0udHlwZSA9PT0gJ2NvbW1pdEFjaycgfHwgbS50eXBlID09PSAnY29uZmxpY3QnIHx8IG0udHlwZSA9PT0gJ2Vycm9yJyxcclxuICAgICAgKCkgPT4gdHJhbnNwb3J0LnNlbmQobWVzc2FnZSksXHJcbiAgICApO1xyXG4gICAgaWYgKHJlcGx5LnR5cGUgPT09ICdlcnJvcicpIHRocm93IHRoaXMudG9FcnJvcihyZXBseSk7XHJcbiAgICBpZiAocmVwbHkudHlwZSA9PT0gJ2NvbW1pdEFjaycpIHtcclxuICAgICAgdmFsaWRhdGVDb21taXRBY2tNZXNzYWdlKHJlcGx5KTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIHZhbGlkYXRlQ29uZmxpY3RNZXNzYWdlKHJlcGx5KTtcclxuICAgIH1cclxuXHJcbiAgICAvLyBGb2xkIHRoZSByZXBseSBpbnRvIHNoYXJlZCBzdGF0ZSBiZWhpbmQgdGhlIGFjayBjaGFpbjogY29uY3VycmVudFxyXG4gICAgLy8gc2xvdHMgbXVzdCBub3QgcmVhZC1tb2RpZnktd3JpdGUgYHRoaXMuaW5kZXhgIGF0IHRoZSBzYW1lIHRpbWUuXHJcbiAgICBhd2FpdCB0aGlzLnNlcmlhbGl6ZUFja0FwcGxpY2F0aW9uKGFzeW5jICgpID0+IHtcclxuICAgICAgaWYgKHJlcGx5LnR5cGUgPT09ICdjb21taXRBY2snKSB7XHJcbiAgICAgICAgaWYgKHJlcGx5LnNlcSA+IHRoaXMuY3Vyc29yKSB0aGlzLmN1cnNvciA9IHJlcGx5LnNlcTtcclxuICAgICAgICB0aGlzLmFwcGx5QWNrVG9JbmRleChjb21taXQsIHJlcGx5LnZlcnNpb24sIHJlcGx5LmNsb2NrKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuICAgICAgYXdhaXQgdGhpcy5oYW5kbGVDb25mbGljdFJlcGx5KGNvbW1pdCwgcmVwbHkpO1xyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICAvKiogQ2hhaW4gb25lIHJlcGx5J3MgaW5kZXggYXBwbGljYXRpb24gYWZ0ZXIgZXZlcnkgcHJldmlvdXNseS1zdGFydGVkIG9uZS4gKi9cclxuICBwcml2YXRlIHNlcmlhbGl6ZUFja0FwcGxpY2F0aW9uKGFwcGx5OiAoKSA9PiBQcm9taXNlPHZvaWQ+KTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zdCBydW4gPSB0aGlzLmFja0NoYWluLnRoZW4oYXBwbHksIGFwcGx5KTtcclxuICAgIHRoaXMuYWNrQ2hhaW4gPSBydW4udGhlbihcclxuICAgICAgKCkgPT4ge30sXHJcbiAgICAgICgpID0+IHt9LFxyXG4gICAgKTtcclxuICAgIHJldHVybiBydW47XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFwcGx5QWNrVG9JbmRleChjb21taXQ6IFN0YWdlZENvbW1pdCwgdmVyc2lvbklkOiBzdHJpbmcsIGNsb2NrOiBMb2dpY2FsQ2xvY2spOiB2b2lkIHtcclxuICAgIGNvbnN0IGRlbGV0ZWQgPSBjb21taXQua2luZCA9PT0gJ2RlbGV0ZSc7XHJcbiAgICBpZiAoY29tbWl0LmtpbmQgPT09ICdyZW5hbWUnICYmIGNvbW1pdC5mcm9tUGF0aCAhPT0gdW5kZWZpbmVkKSB7XHJcbiAgICAgIHRoaXMuaW5kZXggPSBhcHBseUNvbW1pdChyZW1vdmVFbnRyeSh0aGlzLmluZGV4LCBjb21taXQuZnJvbVBhdGgpLCB7XHJcbiAgICAgICAgcGF0aDogY29tbWl0LnBhdGgsXHJcbiAgICAgICAgdmVyc2lvbklkLFxyXG4gICAgICAgIGhhc2g6IGNvbW1pdC5oYXNoLFxyXG4gICAgICAgIHNpemU6IGNvbW1pdC5zaXplLFxyXG4gICAgICAgIGNsb2NrLFxyXG4gICAgICAgIC8vIEEgZm9sZGVyIHJlbmFtZSBhY2tzIGZvbGRlciBtZXRhZGF0YSBhdCB0aGUgZGVzdGluYXRpb24sIGV4YWN0bHlcclxuICAgICAgICAvLyBsaWtlIGV2ZXJ5IG90aGVyIGFjayBraW5kICh0aGUgZW50cnkgbXVzdCBub3QgbG9zZSBpdHMgZmxhZykuXHJcbiAgICAgICAgLi4uKGNvbW1pdC5pc0ZvbGRlciA9PT0gdHJ1ZSA/IHsgaXNGb2xkZXI6IHRydWUgfSA6IHt9KSxcclxuICAgICAgfSk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuICAgIC8vIGBjb21taXQubXRpbWVgIGlzIHRoZSBzdGF0IG9ic2VydmVkIGF0IEhBU0ggdGltZSBmb3IgdGhpcyBleGFjdCBjb250ZW50XHJcbiAgICAvLyAodGhyZWFkZWQgdGhyb3VnaCBgc3RhZ2VQdXNoZXNgKSwgbmV2ZXIgYSBzdGF0IHRha2VuIGF0IGFjayB0aW1lIFx1MjAxNCBhblxyXG4gICAgLy8gZWRpdCB0aGF0IGxhbmRlZCBiZXR3ZWVuIGhhc2hpbmcgYW5kIHRoaXMgYWNrIGNoYW5nZWQgdGhlIGRpc2sgc3RhdCwgc29cclxuICAgIC8vIHRoZSBuZXh0IHNjYW4gbWlzc2VzIHRoZSBmYXN0IHBhdGggYW5kIHJlLWhhc2hlcy9wdXNoZXMgdGhlIGVkaXQuXHJcbiAgICB0aGlzLmluZGV4ID0gYXBwbHlDb21taXQodGhpcy5pbmRleCwge1xyXG4gICAgICBwYXRoOiBjb21taXQucGF0aCxcclxuICAgICAgdmVyc2lvbklkLFxyXG4gICAgICBoYXNoOiBjb21taXQuaGFzaCxcclxuICAgICAgc2l6ZTogY29tbWl0LnNpemUsXHJcbiAgICAgIGNsb2NrLFxyXG4gICAgICBkZWxldGVkLFxyXG4gICAgICBkZWxldGVkQXQ6IGRlbGV0ZWQgPyB0aGlzLm5vdygpIDogdW5kZWZpbmVkLFxyXG4gICAgICAuLi4oY29tbWl0LmlzRm9sZGVyID09PSB0cnVlID8geyBpc0ZvbGRlcjogdHJ1ZSB9IDoge30pLFxyXG4gICAgICAuLi4oY29tbWl0Lm10aW1lICE9PSB1bmRlZmluZWQgPyB7IG10aW1lOiBjb21taXQubXRpbWUgfSA6IHt9KSxcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBoYW5kbGVDb25mbGljdFJlcGx5KFxyXG4gICAgY29tbWl0OiBTdGFnZWRDb21taXQsXHJcbiAgICByZXBseTogQ29uZmxpY3RNZXNzYWdlLFxyXG4gICk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgaWYgKHJlcGx5LnNlcSAhPT0gdW5kZWZpbmVkICYmIHJlcGx5LnNlcSA+IHRoaXMuY3Vyc29yKSB0aGlzLmN1cnNvciA9IHJlcGx5LnNlcTtcclxuICAgIGNvbnN0IHdlV29uID1cclxuICAgICAgcmVwbHkud2lubmVyLmRldmljZUlkID09PSB0aGlzLm9wdGlvbnMuZGV2aWNlSWQgJiYgcmVwbHkud2lubmVyLmhhc2ggPT09IGNvbW1pdC5oYXNoO1xyXG4gICAgaWYgKHdlV29uKSB7XHJcbiAgICAgIHRoaXMuYXBwbHlBY2tUb0luZGV4KGNvbW1pdCwgcmVwbHkud2lubmVyLmlkLCByZXBseS53aW5uZXIuY2xvY2spO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgLy8gV2UgbG9zdCB0aGUgcmFjZS4gTWF0ZXJpYWxpemUgdGhlIHdpbm5lciBkaXJlY3RseSBcdTIwMTQgdGhlIHNlcnZlciBoYXNcclxuICAgIC8vIGFscmVhZHkgcHJlc2VydmVkIG91ciBjb250ZW50IGFzIGEgY29uZmxpY3QgY29weSAoaWYgaXQgd2FzIGRpc3RpbmN0KS5cclxuICAgIC8vIE9uZSBjYXZlYXQ6IGlmIHRoZSB3b3JraW5nIHRyZWUgbW92ZWQgb24gQUdBSU4gc2luY2Ugd2Ugc3RhZ2VkIHRoaXNcclxuICAgIC8vIGNvbW1pdCwgZG8gbm90IGNsb2JiZXIgaXQgZWl0aGVyIFx1MjAxNCBoYW5kIHRoZSB3aG9sZSB0aGluZyB0byBhIGN5Y2xlLlxyXG4gICAgaWYgKGNvbW1pdC5raW5kICE9PSAnZGVsZXRlJyAmJiBjb21taXQua2luZCAhPT0gJ3JlbmFtZScgJiYgY29tbWl0LmlzRm9sZGVyICE9PSB0cnVlKSB7XHJcbiAgICAgIGNvbnN0IGxvY2FsID0gYXdhaXQgdGhpcy5yZWFkTG9jYWwoY29tbWl0LnBhdGgpO1xyXG4gICAgICBpZiAobG9jYWwgIT09IHVuZGVmaW5lZCAmJiAoYXdhaXQgc2hhMjU2SGV4KGxvY2FsKSkgIT09IGNvbW1pdC5oYXNoKSB7XHJcbiAgICAgICAgdGhpcy5zY2hlZHVsZVJlY29uY2lsZSgpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGlmIChjb21taXQua2luZCA9PT0gJ3JlbmFtZScgJiYgY29tbWl0LmZyb21QYXRoICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgLy8gT3VyIHJlbmFtZSBsb3N0OiB0aGUgZmlsZSBzdGF5cyB3aGVyZSB0aGUgd2lubmVyIGtlZXBzIGl0OyByZWNvcmRcclxuICAgICAgLy8gdGhlIHdpbm5lciBoZWFkIGZvciB0aGUgZGVzdGluYXRpb24gKHRoZSBzb3VyY2UgcGF0aCBpcyB1bnRvdWNoZWQpLlxyXG4gICAgICAvLyBBIHBsYWNlaG9sZGVyIHdpbm5lciByZWNvcmRzIGZvbGRlciBtZXRhZGF0YSBcdTIwMTQgbmV2ZXIgYSBjb250ZW50IHB1bGwuXHJcbiAgICAgIHRoaXMuaW5kZXggPSBhcHBseUNvbW1pdCh0aGlzLmluZGV4LCB7XHJcbiAgICAgICAgcGF0aDogcmVwbHkud2lubmVyLnBhdGgsXHJcbiAgICAgICAgdmVyc2lvbklkOiByZXBseS53aW5uZXIuaWQsXHJcbiAgICAgICAgaGFzaDogcmVwbHkud2lubmVyLmhhc2gsXHJcbiAgICAgICAgc2l6ZTogcmVwbHkud2lubmVyLnNpemUsXHJcbiAgICAgICAgY2xvY2s6IHJlcGx5Lndpbm5lci5jbG9jayxcclxuICAgICAgICAuLi4ocmVwbHkud2lubmVyLmlzRm9sZGVyID09PSB0cnVlID8geyBpc0ZvbGRlcjogdHJ1ZSB9IDoge30pLFxyXG4gICAgICB9KTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIHRoaXMuaW5kZXggPSBhd2FpdCB0aGlzLmFwcGx5UHVsbHMoW3RoaXMud2lubmVyQXNQdWxsKHJlcGx5Lndpbm5lcildKTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFR1cm4gYW4gYXJiaXRyYXRlZCB3aW5uZXIgdmVyc2lvbiBpbnRvIGEgcHVsbCBvcCAoY29udGVudCBvcHMgb25seSkuXHJcbiAgICogYGlzRm9sZGVyYCByaWRlcyBhbG9uZyB3aGVuIHRoZSBzZXJ2ZXIgc2VudCBpdCAob2xkZXIgc2VydmVycyBvbWl0IHRoZVxyXG4gICAqIGZsYWcpOiBhIGZvbGRlci1wbGFjZWhvbGRlciB3aW5uZXIgbXVzdCBtYXRlcmlhbGl6ZSBhcyBhbiBgZW5zdXJlRGlyYCwgbm90XHJcbiAgICogYXMgYSBjb250ZW50IGZldGNoIGZvciBpdHMgZW1wdHkgaGFzaCBcdTIwMTQgd2hpY2ggdGhlIGJsb2IgZ3VhcmQgcmVmdXNlcyxcclxuICAgKiB3ZWRnaW5nIGV2ZXJ5IGZ1dHVyZSBjeWNsZSBvbiB0aGUgc2FtZSBjb25mbGljdC5cclxuICAgKi9cclxuICBwcml2YXRlIHdpbm5lckFzUHVsbCh3aW5uZXI6IHtcclxuICAgIHBhdGg6IHN0cmluZztcclxuICAgIGlkOiBzdHJpbmc7XHJcbiAgICBoYXNoOiBzdHJpbmc7XHJcbiAgICBzaXplOiBudW1iZXI7XHJcbiAgICBkZXZpY2VJZDogc3RyaW5nO1xyXG4gICAgY2xvY2s6IExvZ2ljYWxDbG9jaztcclxuICAgIGtpbmQ6IENvbW1pdE1lc3NhZ2VbJ2tpbmQnXTtcclxuICAgIGlzRm9sZGVyPzogYm9vbGVhbjtcclxuICB9KTogUHVsbE9wIHtcclxuICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5pbmRleFt3aW5uZXIucGF0aF07XHJcbiAgICBjb25zdCBkZWxldGVkID0gd2lubmVyLmtpbmQgPT09ICdkZWxldGUnO1xyXG4gICAgY29uc3Qga2luZDogUHVsbEZpbGVPcFsna2luZCddID0gZGVsZXRlZFxyXG4gICAgICA/ICdkZWxldGUnXHJcbiAgICAgIDogZW50cnkgPT09IHVuZGVmaW5lZFxyXG4gICAgICAgID8gJ2FkZCdcclxuICAgICAgICA6IGVudHJ5LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkXHJcbiAgICAgICAgICA/ICdyZXN0b3JlJ1xyXG4gICAgICAgICAgOiAnZWRpdCc7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBraW5kLFxyXG4gICAgICBwYXRoOiB3aW5uZXIucGF0aCxcclxuICAgICAgaGFzaDogd2lubmVyLmhhc2gsXHJcbiAgICAgIHNpemU6IHdpbm5lci5zaXplLFxyXG4gICAgICB2ZXJzaW9uOiB3aW5uZXIuaWQsXHJcbiAgICAgIGNsb2NrOiB3aW5uZXIuY2xvY2ssXHJcbiAgICAgIGRlbGV0ZWQsXHJcbiAgICAgIC4uLih3aW5uZXIuaXNGb2xkZXIgPT09IHRydWUgPyB7IGlzRm9sZGVyOiB0cnVlIH0gOiB7fSksXHJcbiAgICB9O1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyB1cGxvYWRCbG9iKGhhc2g6IHN0cmluZywgYnl0ZXM6IFVpbnQ4QXJyYXkpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGNvbnN0IHRyYW5zcG9ydCA9IHRoaXMudHJhbnNwb3J0O1xyXG4gICAgaWYgKHRyYW5zcG9ydCA9PT0gbnVsbCkgdGhyb3cgbmV3IE5ldHdvcmtFcnJvcignbm90IGNvbm5lY3RlZCcpO1xyXG4gICAgY29uc3QgcmVwbHkgPSBhd2FpdCB0aGlzLnJlcXVlc3Q8QmxvYkFja01lc3NhZ2UgfCBTZXJ2ZXJFcnJvck1lc3NhZ2U+KFxyXG4gICAgICAobSkgPT4gbS50eXBlID09PSAnYmxvYkFjaycgfHwgbS50eXBlID09PSAnZXJyb3InLFxyXG4gICAgICAoKSA9PiB0cmFuc3BvcnQuc2VuZCh7IHR5cGU6ICdwdXRCbG9iJywgaGFzaCwgY29udGVudDogYnl0ZXNUb0Jhc2U2NChieXRlcykgfSksXHJcbiAgICApO1xyXG4gICAgaWYgKHJlcGx5LnR5cGUgPT09ICdlcnJvcicpIHRocm93IHRoaXMudG9FcnJvcihyZXBseSk7XHJcbiAgICBhd2FpdCB0aGlzLm9wdGlvbnMuYmxvYlN0b3JlLnB1dChoYXNoLCBieXRlcyk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHJlYWRvbmx5IGZldGNoQmxvYjogRmV0Y2hCbG9iID0gYXN5bmMgKGhhc2g6IHN0cmluZyk6IFByb21pc2U8VWludDhBcnJheT4gPT4ge1xyXG4gICAgaWYgKGhhc2ggPT09ICcnKSB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcigncmVmdXNpbmcgdG8gZmV0Y2ggY29udGVudCBmb3IgYW4gZW1wdHkgaGFzaCcpO1xyXG4gICAgY29uc3QgY2FjaGVkID0gYXdhaXQgdGhpcy5vcHRpb25zLmJsb2JTdG9yZS5nZXQoaGFzaCk7XHJcbiAgICBpZiAoY2FjaGVkICE9PSB1bmRlZmluZWQpIHJldHVybiBjYWNoZWQ7XHJcbiAgICBjb25zdCBieXRlcyA9IGF3YWl0IHRoaXMuZG93bmxvYWRCbG9iKGhhc2gpO1xyXG4gICAgYXdhaXQgdGhpcy5vcHRpb25zLmJsb2JTdG9yZS5wdXQoaGFzaCwgYnl0ZXMpO1xyXG4gICAgcmV0dXJuIGJ5dGVzO1xyXG4gIH07XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgZG93bmxvYWRCbG9iKGhhc2g6IHN0cmluZyk6IFByb21pc2U8VWludDhBcnJheT4ge1xyXG4gICAgY29uc3QgdHJhbnNwb3J0ID0gdGhpcy50cmFuc3BvcnQ7XHJcbiAgICBpZiAodHJhbnNwb3J0ID09PSBudWxsKSB0aHJvdyBuZXcgTmV0d29ya0Vycm9yKCdub3QgY29ubmVjdGVkJyk7XHJcbiAgICBjb25zdCByZXBseSA9IGF3YWl0IHRoaXMucmVxdWVzdDxCbG9iTWVzc2FnZSB8IFNlcnZlckVycm9yTWVzc2FnZT4oXHJcbiAgICAgIChtKSA9PiAobS50eXBlID09PSAnYmxvYicgJiYgbS5oYXNoID09PSBoYXNoKSB8fCBtLnR5cGUgPT09ICdlcnJvcicsXHJcbiAgICAgICgpID0+IHRyYW5zcG9ydC5zZW5kKHsgdHlwZTogJ2dldEJsb2InLCBoYXNoIH0pLFxyXG4gICAgKTtcclxuICAgIGlmIChyZXBseS50eXBlID09PSAnZXJyb3InKSB0aHJvdyB0aGlzLnRvRXJyb3IocmVwbHkpO1xyXG4gICAgY29uc3QgYnl0ZXMgPSBiYXNlNjRUb0J5dGVzKHJlcGx5LmNvbnRlbnQpO1xyXG4gICAgaWYgKChhd2FpdCBzaGEyNTZIZXgoYnl0ZXMpKSAhPT0gaGFzaCkge1xyXG4gICAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgYmxvYiAke2hhc2h9IGZhaWxlZCB2ZXJpZmljYXRpb24gb24gZG93bmxvYWRgKTtcclxuICAgIH1cclxuICAgIHJldHVybiBieXRlcztcclxuICB9XHJcblxyXG4gIC8vIC0tLSBzbmFwc2hvdHMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cclxuXHJcbiAgLyoqXHJcbiAgICogU25hcHNob3QgZXZlcnkgZmlsZSBoZWFkIG9uIHRoZSBhdXRob3JpdHkgKGEgd2hvbGUtdmF1bHQgcmVzdG9yZSBwb2ludCkuXHJcbiAgICogU25hcHNob3RzIGFyZSBub3QgYnJvYWRjYXN0IFx1MjAxNCBvdGhlciBkZXZpY2VzIHNlZSBub3RoaW5nIGxpdmUuXHJcbiAgICovXHJcbiAgYXN5bmMgY3JlYXRlU25hcHNob3QobmFtZT86IHN0cmluZyk6IFByb21pc2U8U25hcHNob3RDcmVhdGVBY2tNZXNzYWdlPiB7XHJcbiAgICBjb25zdCB0cmFuc3BvcnQgPSB0aGlzLnRyYW5zcG9ydDtcclxuICAgIGlmICh0cmFuc3BvcnQgPT09IG51bGwpIHRocm93IG5ldyBOZXR3b3JrRXJyb3IoJ25vdCBjb25uZWN0ZWQnKTtcclxuICAgIGNvbnN0IHJlcGx5ID0gYXdhaXQgdGhpcy5yZXF1ZXN0PFNuYXBzaG90Q3JlYXRlQWNrTWVzc2FnZSB8IFNlcnZlckVycm9yTWVzc2FnZT4oXHJcbiAgICAgIChtKSA9PiBtLnR5cGUgPT09ICdzbmFwc2hvdENyZWF0ZUFjaycgfHwgbS50eXBlID09PSAnZXJyb3InLFxyXG4gICAgICAoKSA9PiB0cmFuc3BvcnQuc2VuZCh7IHR5cGU6ICdzbmFwc2hvdENyZWF0ZScsIC4uLihuYW1lICE9PSB1bmRlZmluZWQgPyB7IG5hbWUgfSA6IHt9KSB9KSxcclxuICAgICk7XHJcbiAgICBpZiAocmVwbHkudHlwZSA9PT0gJ2Vycm9yJykgdGhyb3cgdGhpcy50b0Vycm9yKHJlcGx5KTtcclxuICAgIHJldHVybiByZXBseTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIFJlc3RvcmUgdGhlIHdob2xlIHZhdWx0IHRvIGEgc25hcHNob3QuIFRoZSBzZXJ2ZXIgbGFuZHMgZXZlcnkgcmV2ZXJ0ZWRcclxuICAgKiBoZWFkIGFzIGEgTkVXIHZlcnNpb24gKGhpc3RvcnkgaXMgbmV2ZXIgZGVsZXRlZCkgYW5kIGZhbnMgdGhlIGNoYW5nZXMgb3V0XHJcbiAgICogdG8gT1RIRVIgc29ja2V0cyBvbmx5IFx1MjAxNCB0aGlzIGRldmljZSBkb2VzIG5vdCByZWNlaXZlIGl0cyBvd24gZmFuLW91dCwgc29cclxuICAgKiB0aGUgbG9jYWwgaW5kZXggbXVzdCByZS1jb252ZXJnZSBmcm9tIGEgRlVMTCBtYW5pZmVzdDogZmxhZyBkZWx0YSBtb2RlXHJcbiAgICogb2ZmLCB0aGVuIHJ1biBhIGN5Y2xlIGlubGluZSAob25lLXNob3QgY2FsbGVycyBjbG9zZSB0aGUgdHJhbnNwb3J0IGFzXHJcbiAgICogc29vbiBhcyB0aGlzIHJlc29sdmVzLCBzbyBhIGRlYm91bmNlZCBjeWNsZSB3b3VsZCBuZXZlciBmaXJlKS5cclxuICAgKi9cclxuICBhc3luYyByZXN0b3JlU25hcHNob3QoaWQ6IHN0cmluZyk6IFByb21pc2U8U25hcHNob3RSZXN0b3JlQWNrTWVzc2FnZT4ge1xyXG4gICAgY29uc3QgdHJhbnNwb3J0ID0gdGhpcy50cmFuc3BvcnQ7XHJcbiAgICBpZiAodHJhbnNwb3J0ID09PSBudWxsKSB0aHJvdyBuZXcgTmV0d29ya0Vycm9yKCdub3QgY29ubmVjdGVkJyk7XHJcbiAgICBjb25zdCByZXBseSA9IGF3YWl0IHRoaXMucmVxdWVzdDxTbmFwc2hvdFJlc3RvcmVBY2tNZXNzYWdlIHwgU2VydmVyRXJyb3JNZXNzYWdlPihcclxuICAgICAgKG0pID0+IG0udHlwZSA9PT0gJ3NuYXBzaG90UmVzdG9yZUFjaycgfHwgbS50eXBlID09PSAnZXJyb3InLFxyXG4gICAgICAoKSA9PiB0cmFuc3BvcnQuc2VuZCh7IHR5cGU6ICdzbmFwc2hvdFJlc3RvcmUnLCBpZCB9KSxcclxuICAgICk7XHJcbiAgICBpZiAocmVwbHkudHlwZSA9PT0gJ2Vycm9yJykgdGhyb3cgdGhpcy50b0Vycm9yKHJlcGx5KTtcclxuICAgIHRoaXMubmVlZHNGdWxsTWFuaWZlc3QgPSB0cnVlO1xyXG4gICAgYXdhaXQgdGhpcy5lbnF1ZXVlKCgpID0+IHRoaXMucnVuQ3ljbGUoKSk7XHJcbiAgICByZXR1cm4gcmVwbHk7XHJcbiAgfVxyXG5cclxuICAvLyAtLS0gcGx1bWJpbmcgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxyXG5cclxuICBwcml2YXRlIHJlcXVlc3Q8VCBleHRlbmRzIFNlcnZlck1lc3NhZ2U+KFxyXG4gICAgbWF0Y2hlczogKG1lc3NhZ2U6IE1lc3NhZ2UpID0+IGJvb2xlYW4sXHJcbiAgICBzZW5kOiAoKSA9PiB2b2lkLFxyXG4gICk6IFByb21pc2U8VD4ge1xyXG4gICAgcmV0dXJuIG5ldyBQcm9taXNlPFQ+KChyZXNvbHZlLCByZWplY3QpID0+IHtcclxuICAgICAgY29uc3QgZXhwZWN0YXRpb246ICh0eXBlb2YgdGhpcy5leHBlY3RhdGlvbnMpW251bWJlcl0gPSB7XHJcbiAgICAgICAgbWF0Y2hlczogKG1lc3NhZ2UpID0+IG1hdGNoZXMobWVzc2FnZSksXHJcbiAgICAgICAgcmVzb2x2ZTogKG1lc3NhZ2UpID0+IHJlc29sdmUobWVzc2FnZSBhcyBUKSxcclxuICAgICAgICByZWplY3QsXHJcbiAgICAgIH07XHJcbiAgICAgIHRoaXMuZXhwZWN0YXRpb25zLnB1c2goZXhwZWN0YXRpb24pO1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIHNlbmQoKTtcclxuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgICBjb25zdCBpbmRleCA9IHRoaXMuZXhwZWN0YXRpb25zLmluZGV4T2YoZXhwZWN0YXRpb24pO1xyXG4gICAgICAgIGlmIChpbmRleCA+PSAwKSB0aGlzLmV4cGVjdGF0aW9ucy5zcGxpY2UoaW5kZXgsIDEpO1xyXG4gICAgICAgIHJlamVjdChlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgTmV0d29ya0Vycm9yKFN0cmluZyhlcnJvcikpKTtcclxuICAgICAgfVxyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHRvRXJyb3IobWVzc2FnZTogU2VydmVyRXJyb3JNZXNzYWdlKTogRXJyb3Ige1xyXG4gICAgc3dpdGNoIChtZXNzYWdlLmNvZGUpIHtcclxuICAgICAgY2FzZSAnVU5BVVRIT1JJWkVEJzpcclxuICAgICAgICByZXR1cm4gbmV3IFVuYXV0aG9yaXplZEVycm9yKG1lc3NhZ2UubWVzc2FnZSk7XHJcbiAgICAgIGNhc2UgJ1JFVk9LRUQnOlxyXG4gICAgICAgIHJldHVybiBuZXcgUmV2b2tlZEVycm9yKG1lc3NhZ2UubWVzc2FnZSk7XHJcbiAgICAgIGRlZmF1bHQ6XHJcbiAgICAgICAgcmV0dXJuIG5ldyBQcm90b2NvbEVycm9yKG1lc3NhZ2UubWVzc2FnZSk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGVucXVldWUob3BlcmF0aW9uOiAoKSA9PiBQcm9taXNlPHZvaWQ+KTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICB0aGlzLnF1ZXVlZE9wcyArPSAxO1xyXG4gICAgY29uc3QgcnVuID0gdGhpcy50YWlsLnRoZW4ob3BlcmF0aW9uLCBvcGVyYXRpb24pO1xyXG4gICAgY29uc3Qgc2V0dGxlZCA9IHJ1bi50aGVuKFxyXG4gICAgICAoKSA9PiB7XHJcbiAgICAgICAgdGhpcy5xdWV1ZWRPcHMgLT0gMTtcclxuICAgICAgICB0aGlzLnBlcnNpc3RJbmRleCgpO1xyXG4gICAgICB9LFxyXG4gICAgICAoZXJyb3I6IHVua25vd24pID0+IHtcclxuICAgICAgICB0aGlzLnF1ZXVlZE9wcyAtPSAxO1xyXG4gICAgICAgIHRoaXMucGVyc2lzdEluZGV4KCk7XHJcbiAgICAgICAgdGhyb3cgZXJyb3I7XHJcbiAgICAgIH0sXHJcbiAgICApO1xyXG4gICAgLy8gU3dhbGxvdyByZWplY3Rpb25zIG9uIHRoZSBzaGFyZWQgdGFpbCAoaW5kaXZpZHVhbCBjYWxsZXJzIHNlZSB0aGVtIHZpYVxyXG4gICAgLy8gYHNldHRsZWRgKTsgb25lIGZhaWxlZCBvcCBtdXN0IG5vdCBwb2lzb24gdGhlIHF1ZXVlLlxyXG4gICAgdGhpcy50YWlsID0gc2V0dGxlZC50aGVuKFxyXG4gICAgICAoKSA9PiB7fSxcclxuICAgICAgKCkgPT4ge30sXHJcbiAgICApO1xyXG4gICAgcmV0dXJuIHNldHRsZWQ7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHBlcnNpc3RJbmRleCgpOiB2b2lkIHtcclxuICAgIGNvbnN0IHNuYXBzaG90ID0gc2VyaWFsaXplTG9jYWxJbmRleCh0aGlzLmluZGV4LCB0aGlzLnBlcnNpc3RlZFN0YXRlKCkpO1xyXG4gICAgdm9pZCB0aGlzLm9wdGlvbnMuc3RvcmFnZVxyXG4gICAgICAud3JpdGVGaWxlKExPQ0FMX0lOREVYX1NUQVRFX1BBVEgsIG5ldyBUZXh0RW5jb2RlcigpLmVuY29kZShzbmFwc2hvdCkpXHJcbiAgICAgIC5jYXRjaCgoZXJyb3I6IHVua25vd24pID0+IHRoaXMubG9nLndhcm4oJ2ZhaWxlZCB0byBwZXJzaXN0IGxvY2FsIGluZGV4JywgZXJyb3IpKTtcclxuICB9XHJcbn1cclxuXHJcbi8vIC0tLSBtb2R1bGUtcHJpdmF0ZSB0eXBlIGFsaWFzZXMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXHJcblxyXG50eXBlIFNlcnZlckVycm9yTWVzc2FnZSA9IEV4dHJhY3Q8U2VydmVyTWVzc2FnZSwgeyB0eXBlOiAnZXJyb3InIH0+O1xyXG5cclxuLyoqIEV2ZXJ5IHZhdWx0IHBhdGggYSBwdWxsIHdvdWxkIHRvdWNoIG9uIGRpc2sgKGJvdGggZW5kcyBvZiBhIHJlbmFtZSkuICovXHJcbmZ1bmN0aW9uIHB1bGxUYXJnZXRzKHB1bGw6IFB1bGxPcCk6IHN0cmluZ1tdIHtcclxuICByZXR1cm4gcHVsbC5raW5kID09PSAncmVuYW1lJyA/IFtwdWxsLmZyb21QYXRoLCBwdWxsLnRvUGF0aF0gOiBbcHVsbC5wYXRoXTtcclxufVxyXG5cclxuLyoqIFRoZSBmaXJzdCBXaW5kb3dzLXVuc2FmZSBwYXRoIGFtb25nIGBwYXRoc2A7IHVuZGVmaW5lZCB3aGVuIGFsbCBhcmUgc2FmZS4gKi9cclxuZnVuY3Rpb24gZmlyc3RVbnNhZmVQYXRoKHBhdGhzOiByZWFkb25seSBzdHJpbmdbXSk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XHJcbiAgcmV0dXJuIHBhdGhzLmZpbmQoKHBhdGgpID0+IGlzV2luZG93c1Vuc2FmZVBhdGgocGF0aCkpO1xyXG59XHJcbiIsICIvKipcbiAqIFNlcnZlciBjb21wYXRpYmlsaXR5IHBvbGljeSBcdTIwMTQgdGhlIHZlcnNpb24tc2tldyBjb21wYW5pb24gdG8gdGhlIHdpcmVcbiAqIHByb3RvY29sIGNoZWNrLlxuICpcbiAqIFNlbGYtaG9zdGVycyBkZXBsb3kgdGhlIHdvcmtlciBmcm9tIGEgQ2xvdWRmbGFyZSB0ZW1wbGF0ZSBwaW5uZWQgdG8gYVxuICogcmVsZWFzZSB3aGlsZSB0aGUgcGx1Z2luL0NMSS9kYWVtb24gdXBkYXRlIG9uIHRoZWlyIG93biBzY2hlZHVsZXMsIHNvXG4gKiB2ZXJzaW9uIHNrZXcgYWNyb3NzIGNvbXBvbmVudHMgaXMgZ3VhcmFudGVlZC4gVGhlIFdTIGhhbmRzaGFrZSBhbHJlYWR5XG4gKiBlbmZvcmNlcyBhbiBFWEFDVCBgUHJvdG9jb2xWZXJzaW9uYCBtYXRjaCAoaGFyZCBnYXRlLCBwcm90b2NvbC50cyk7IHRoaXNcbiAqIG1vZHVsZSBhbnN3ZXJzIHRoZSBzb2Z0ZXIgcXVlc3Rpb24gXCJpcyB0aGlzIHJlcG9ydGVkIHNlcnZlciByZWxlYXNlXG4gKiByZWFzb25hYmx5IG1hdGNoZWQgdG8gdGhpcyBjbGllbnQ/XCIgd2l0aCBhIHB1cmUsIGRlcGVuZGVuY3ktZnJlZSB2ZXJkaWN0XG4gKiBldmVyeSBVSSBjYW4gc2hhcmUgKHRoZSBwbHVnaW4ncyBzdGF0dXMgbm90ZS9Ob3RpY2UsIGB2c2EgZG9jdG9yYCkuXG4gKlxuICogRGVsaWJlcmF0ZWx5IHRvbGVyYW50OiBvbmx5IGEgc2VydmVyIE9MREVSIHRoYW4gdGhlIHN1cHBvcnRlZCBmbG9vciBpcyBhblxuICogZXJyb3I7IG5ld2VyIHNlcnZlcnMgYW5kIHVucGFyc2VhYmxlL2Fic2VudCB2ZXJzaW9ucyBhcmUgd2FybmluZ3MsIG5ldmVyXG4gKiBzeW5jLWtpbGxlcnMuXG4gKi9cblxuLyoqXG4gKiBPbGRlc3Qgc2VydmVyIHJlbGVhc2UgdGhlIGNsaWVudHMgY2FuIGJlIGV4cGVjdGVkIHRvIHdvcmsgYWdhaW5zdC4gU2VydmVyc1xuICogYmVsb3cgdGhpcyBhcmUgcmVwb3J0ZWQgYXMgZXJyb3JzIChcInVwZGF0ZSB0aGUgd29ya2VyXCIpLlxuICovXG5leHBvcnQgY29uc3QgTUlOX1NVUFBPUlRFRF9TRVJWRVJfVkVSU0lPTiA9ICcwLjEuMCc7XG5cbi8qKiBPdXRjb21lIG9mIGBjaGVja1NlcnZlckNvbXBhdGliaWxpdHlgLiAqL1xuZXhwb3J0IGludGVyZmFjZSBDb21wYXRpYmlsaXR5VmVyZGljdCB7XG4gIC8qKlxuICAgKiBgb2tgIFx1MjAxNCBub3RoaW5nIHRvIGRvOyBgd2FybmAgXHUyMDE0IHdvcmtzLCBjb25zaWRlciB1cGRhdGluZyBhIGNvbXBvbmVudDtcbiAgICogYGVycm9yYCBcdTIwMTQgdGhlIHNlcnZlciBpcyBiZWxvdyB0aGUgc3VwcG9ydGVkIGZsb29yLiBOZXZlciBhIHN5bmMta2lsbGVyOlxuICAgKiB0aGUgd2lyZSBgUHJvdG9jb2xWZXJzaW9uYCBjaGVjayByZW1haW5zIHRoZSBoYXJkIGdhdGUuXG4gICAqL1xuICBsZXZlbDogJ29rJyB8ICd3YXJuJyB8ICdlcnJvcic7XG4gIC8qKiBVc2VyLWZhY2luZyBzZW50ZW5jZSAoZW1wdHktaXNoIGZvciB0aGUgYG9rYCBjYXNlKS4gKi9cbiAgbWVzc2FnZTogc3RyaW5nO1xufVxuXG4vKiogVGhlIHBhcnRzIG9mIGEgc2VtdmVyIHN0cmluZyB0aGUgcG9saWN5IGNvbXBhcmVzIChwcmVyZWxlYXNlL2J1aWxkIGlnbm9yZWQpLiAqL1xuaW50ZXJmYWNlIFNlbVZlciB7XG4gIG1ham9yOiBudW1iZXI7XG4gIG1pbm9yOiBudW1iZXI7XG4gIHBhdGNoOiBudW1iZXI7XG59XG5cbi8qKlxuICogYG1ham9yLm1pbm9yLnBhdGNoYCwgdG9sZXJhdGluZyBhIGxlYWRpbmcgYHZgLCBhIGAtcHJlcmVsZWFzZWAsIGFuZCBhXG4gKiBgK2J1aWxkYCBzdWZmaXguIEFueXRoaW5nIGVsc2UgKGluY2x1ZGluZyBgMC4xYC1zdHlsZSB0d28tcGFydCB2ZXJzaW9ucylcbiAqIHBhcnNlcyBhcyBgbnVsbGAgXHUyMDE0IHRoZSBwb2xpY3kgdGhlbiB3YXJucyB3aXRoIHRoZSByYXcgdmFsdWUgaW5zdGVhZCBvZlxuICogZ3Vlc3NpbmcuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZVNlbVZlcihyYXc6IHN0cmluZyk6IFNlbVZlciB8IG51bGwge1xuICBjb25zdCBtYXRjaCA9IC9edj8oXFxkKylcXC4oXFxkKylcXC4oXFxkKykoPzotWzAtOUEtWmEtei4tXSspPyg/OlxcK1swLTlBLVphLXouLV0rKT8kLy5leGVjKFxuICAgIHJhdy50cmltKCksXG4gICk7XG4gIGlmIChtYXRjaCA9PT0gbnVsbCkgcmV0dXJuIG51bGw7XG4gIHJldHVybiB7IG1ham9yOiBOdW1iZXIobWF0Y2hbMV0pLCBtaW5vcjogTnVtYmVyKG1hdGNoWzJdKSwgcGF0Y2g6IE51bWJlcihtYXRjaFszXSkgfTtcbn1cblxuLyoqIFRocmVlLXdheSBjb21wYXJlIG9uIG1ham9yIFx1MjE5MiBtaW5vciBcdTIxOTIgcGF0Y2ggKHByZXJlbGVhc2UvYnVpbGQgaWdub3JlZCkuICovXG5mdW5jdGlvbiBjb21wYXJlU2VtVmVyKGE6IFNlbVZlciwgYjogU2VtVmVyKTogbnVtYmVyIHtcbiAgaWYgKGEubWFqb3IgIT09IGIubWFqb3IpIHJldHVybiBhLm1ham9yIDwgYi5tYWpvciA/IC0xIDogMTtcbiAgaWYgKGEubWlub3IgIT09IGIubWlub3IpIHJldHVybiBhLm1pbm9yIDwgYi5taW5vciA/IC0xIDogMTtcbiAgaWYgKGEucGF0Y2ggIT09IGIucGF0Y2gpIHJldHVybiBhLnBhdGNoIDwgYi5wYXRjaCA/IC0xIDogMTtcbiAgcmV0dXJuIDA7XG59XG5cbi8qKlxuICogQXNzZXNzIGEgc2VydmVyJ3MgcmVwb3J0ZWQgcmVsZWFzZSBhZ2FpbnN0IHRoaXMgY2xpZW50J3MgdmVyc2lvbi5cbiAqXG4gKiAgLSBgc2VydmVyVmVyc2lvbmAgbnVsbC91bmRlZmluZWQvZW1wdHkgXHUyMTkyIHRoZSBzZXJ2ZXIgcHJlZGF0ZXMgdmVyc2lvblxuICogICAgcmVwb3J0aW5nIChcdTIyNjQgMC4xIG5ldmVyIHNlbmRzIHRoZSBmaWVsZCk6IHdhcm4gd2l0aCBhbiB1cGdyYWRlIGhpbnQuXG4gKiAgLSBVbnBhcnNlYWJsZSBzZXJ2ZXJWZXJzaW9uIFx1MjE5MiB3YXJuLCBxdW90aW5nIHRoZSByYXcgdmFsdWUuXG4gKiAgLSBTZXJ2ZXIgYSBNQUpPUiBvciBNSU5PUiBhaGVhZCBvZiB0aGUgY2xpZW50IFx1MjE5MiB3YXJuIChwYXRjaCBnYXBzIGFyZVxuICogICAgZmluZSk7IHRoZSBwcm90b2NvbCBjaGVjayBhbHJlYWR5IGd1YXJkcyBhY3R1YWwgaW5jb21wYXRpYmlsaXR5LlxuICogIC0gU2VydmVyIGJlbG93IGBNSU5fU1VQUE9SVEVEX1NFUlZFUl9WRVJTSU9OYCBcdTIxOTIgZXJyb3IuXG4gKiAgLSBPdGhlcndpc2UgXHUyMTkyIG9rLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY2hlY2tTZXJ2ZXJDb21wYXRpYmlsaXR5KFxuICBjbGllbnRWZXJzaW9uOiBzdHJpbmcsXG4gIHNlcnZlclZlcnNpb246IHN0cmluZyB8IG51bGwgfCB1bmRlZmluZWQsXG4pOiBDb21wYXRpYmlsaXR5VmVyZGljdCB7XG4gIGlmIChzZXJ2ZXJWZXJzaW9uID09PSBudWxsIHx8IHNlcnZlclZlcnNpb24gPT09IHVuZGVmaW5lZCB8fCBzZXJ2ZXJWZXJzaW9uID09PSAnJykge1xuICAgIHJldHVybiB7XG4gICAgICBsZXZlbDogJ3dhcm4nLFxuICAgICAgbWVzc2FnZTogJ3N5bmMgc2VydmVyIHByZWRhdGVzIHZlcnNpb24gcmVwb3J0aW5nIChcXHUyMjY0IDAuMSkgXFx1MjAxNCBjb25zaWRlciB1cGRhdGluZyBpdCAoZG9jcy9VUEdSQURJTkcubWQpJyxcbiAgICB9O1xuICB9XG4gIGNvbnN0IHNlcnZlciA9IHBhcnNlU2VtVmVyKHNlcnZlclZlcnNpb24pO1xuICBpZiAoc2VydmVyID09PSBudWxsKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGxldmVsOiAnd2FybicsXG4gICAgICBtZXNzYWdlOiBgc2VydmVyIHZlcnNpb24gJHtKU09OLnN0cmluZ2lmeShzZXJ2ZXJWZXJzaW9uKX0gaXMgbm90IHNlbXZlciBcXHUyMDE0IGNvbXBhdGliaWxpdHkgdW5rbm93bmAsXG4gICAgfTtcbiAgfVxuICAvLyBBIGNsaWVudCB2ZXJzaW9uIHdlIGNhbm5vdCBwYXJzZSAoZGV2IGJ1aWxkcywgXCJ1bmtub3duXCIpIHNpbXBseSBza2lwcyB0aGVcbiAgLy8gbmV3ZXItc2VydmVyIGNvbXBhcmlzb24gcmF0aGVyIHRoYW4gZmFpbGluZyB0aGUgd2hvbGUgYXNzZXNzbWVudC5cbiAgY29uc3QgY2xpZW50ID0gcGFyc2VTZW1WZXIoY2xpZW50VmVyc2lvbik7XG4gIGlmIChjbGllbnQgIT09IG51bGwgJiYgKHNlcnZlci5tYWpvciA+IGNsaWVudC5tYWpvciB8fCBzZXJ2ZXIubWlub3IgPiBjbGllbnQubWlub3IpKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGxldmVsOiAnd2FybicsXG4gICAgICBtZXNzYWdlOiBgc2VydmVyICR7c2VydmVyVmVyc2lvbn0gaXMgbmV3ZXIgdGhhbiB0aGlzIGNsaWVudCAoJHtjbGllbnRWZXJzaW9ufSkgXFx1MjAxNCB1cGRhdGUgdGhlIGNsaWVudCB3aGVuIGNvbnZlbmllbnRgLFxuICAgIH07XG4gIH1cbiAgY29uc3QgbWluaW11bSA9IHBhcnNlU2VtVmVyKE1JTl9TVVBQT1JURURfU0VSVkVSX1ZFUlNJT04pO1xuICBpZiAobWluaW11bSAhPT0gbnVsbCAmJiBjb21wYXJlU2VtVmVyKHNlcnZlciwgbWluaW11bSkgPCAwKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGxldmVsOiAnZXJyb3InLFxuICAgICAgbWVzc2FnZTogYHNlcnZlciAke3NlcnZlclZlcnNpb259IGlzIG9sZGVyIHRoYW4gdGhlIG1pbmltdW0gc3VwcG9ydGVkICgke01JTl9TVVBQT1JURURfU0VSVkVSX1ZFUlNJT059KSBcXHUyMDE0IHVwZGF0ZSBpdDogZG9jcy9VUEdSQURJTkcubWRgLFxuICAgIH07XG4gIH1cbiAgcmV0dXJuIHsgbGV2ZWw6ICdvaycsIG1lc3NhZ2U6IGBzZXJ2ZXIgJHtzZXJ2ZXJWZXJzaW9ufSB3b3JrcyB3aXRoIHRoaXMgY2xpZW50ICgke2NsaWVudFZlcnNpb259KWAgfTtcbn1cbiIsICIvKipcbiAqIGBPYnNpZGlhblN0b3JhZ2VBZGFwdGVyYCBcdTIwMTQgY29yZSdzIGBTdG9yYWdlQWRhcHRlcmAgb3ZlciB0aGUgT2JzaWRpYW4gdmF1bHRcbiAqIGBEYXRhQWRhcHRlcmAgKEFSQ0hJVEVDVFVSRSBcdTAwQTc4IGFkYXB0ZXJzOiBwbHVnaW4gaW1wbGVtZW50YXRpb24sIGRlc2t0b3AgYW5kXG4gKiBtb2JpbGUgYWxpa2UpLlxuICpcbiAqIFBhdGggbWFwcGluZzogZXZlcnkgcGF0aCBjcm9zc2luZyB0aGUgY29yZSBzZWFtIGlzIGEgUE9TSVgtbm9ybWFsaXplZCB2YXVsdFxuICogcGF0aCAoYC9ub3Rlcy9hLm1kYCwgcm9vdCBgL2ApOyB0aGUgT2JzaWRpYW4gYWRhcHRlciB3YW50cyB0aGUgc2FtZSBwYXRoXG4gKiAqd2l0aG91dCogdGhlIGxlYWRpbmcgc2xhc2ggKGBub3Rlcy9hLm1kYCksIHdpdGggYC9gIChvciBgJydgKSBmb3IgdGhlIHJvb3QuXG4gKlxuICogQWxsIHdyaXRlcyBnbyB0aHJvdWdoIHRoZSBhZGFwdGVyIChuZXZlciBgdmF1bHQubW9kaWZ5YCBvbiB0aGUgc2lkZSksIHNvXG4gKiBPYnNpZGlhbidzIG93biBmaWxlIHdhdGNoaW5nIG9ic2VydmVzIHRoZW0gbGlrZSBhbnkgZXh0ZXJuYWwgZWRpdCBhbmQgb3BlblxuICogZWRpdG9ycyByZWZyZXNoIChGUi0zKS4gV3JpdGVzIGFyZSBhdG9taWMtaXNoOiBjb250ZW50IGxhbmRzIGluIGEgdGVtcCBmaWxlXG4gKiB1bmRlciBgLy52YXVsdHN5bmNmb3JhZ2VudHMvdG1wL2AgKGNvcmUgaWdub3JlcyB0aGF0IHdob2xlIHN1YnRyZWUpIGFuZCBpc1xuICogcmVuYW1lZCBvbnRvIHRoZSB0YXJnZXQ7IGlmIHJlbmFtaW5nIGlzIHVuYXZhaWxhYmxlIChleG90aWMgbW9iaWxlXG4gKiBhZGFwdGVycyksIHdlIGZhbGwgYmFjayB0byBhIGRpcmVjdCB3cml0ZS5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IERhdGFBZGFwdGVyIH0gZnJvbSAnb2JzaWRpYW4nO1xuaW1wb3J0IHR5cGUgeyBGaWxlU3RhdCwgU3RvcmFnZUFkYXB0ZXIgfSBmcm9tICdAdnNhL2NvcmUnO1xuaW1wb3J0IHsgbm9ybWFsaXplVmF1bHRQYXRoIH0gZnJvbSAnQHZzYS9jb3JlJztcblxuLyoqIERpcmVjdG9yeSAoaW5zaWRlIHRoZSB2YXVsdCkgaG9sZGluZyB0ZW1wIGZpbGVzIGR1cmluZyBhdG9taWMgd3JpdGVzLiAqL1xuZXhwb3J0IGNvbnN0IFRFTVBfRElSX1ZBVUxUX1BBVEggPSAnLy52YXVsdHN5bmNmb3JhZ2VudHMvdG1wJztcblxuLyoqIFN0YXRzIE9ic2lkaWFuJ3MgYERhdGFBZGFwdGVyLnN0YXRgIHJldHVybnMgZm9yIGEgZmlsZS4gKi9cbmludGVyZmFjZSBBZGFwdGVyU3RhdCB7XG4gIHNpemU6IG51bWJlcjtcbiAgbXRpbWU6IG51bWJlcjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBPYnNpZGlhblN0b3JhZ2VBZGFwdGVyT3B0aW9ucyB7XG4gIGFkYXB0ZXI6IERhdGFBZGFwdGVyO1xuICAvKipcbiAgICogRGVza3RvcCBhbmQgbW9iaWxlIE9ic2lkaWFuJ3MgYERhdGFBZGFwdGVyLnJtZGlyYCBpcyBmcy5ybS1iYXNlZCBhbmRcbiAgICogcmVmdXNlcyBFVkVSWSBkaXJlY3RvcnkgKGBFUlJfRlNfRUlTRElSYCkgXHUyMDE0IGl0IGNhbm5vdCByZW1vdmUgZXZlbiBhblxuICAgKiBlbXB0eSBmb2xkZXIsIHdoaWNoIHNpbGVudGx5IGRlZ3JhZGVkIGV2ZXJ5IGZvbGRlci10b21ic3RvbmUgYXBwbGljYXRpb25cbiAgICogdG8gcmVjb3JkLW9ubHkgKHRoZSBGLTEgcGluZy1wb25nKS4gV2hlbiBwcm92aWRlZCwgYHJlbW92ZURpcmAgcGVyZm9ybXNcbiAgICogdGhlIGVtcHR5LWZvbGRlciByZW1vdmFsIHRocm91Z2ggdGhpcyBjYWxsYmFjayBpbnN0ZWFkIFx1MjAxNCB0aGUgcGx1Z2luIHdpcmVzXG4gICAqIGl0IHRvIGBmaWxlTWFuYWdlci50cmFzaEZpbGVgIG9uIHRoZSB2YXVsdCdzIFRGb2xkZXIsIHdoaWNoIHdvcmtzIGFuZFxuICAgKiBuZXZlciBkZXN0cm95cyBkYXRhIChzeXN0ZW0gdHJhc2g7IGNvcmUgcHJlLWNoZWNrcyBlbXB0aW5lc3MgYW55d2F5KS5cbiAgICogUmVjZWl2ZXMgdGhlIEFEQVBURVIgcGF0aCAobm8gbGVhZGluZyBzbGFzaCkuXG4gICAqL1xuICByZW1vdmVFbXB0eURpcj86IChhZGFwdGVyUGF0aDogc3RyaW5nKSA9PiBQcm9taXNlPHZvaWQ+O1xufVxuXG5leHBvcnQgY2xhc3MgT2JzaWRpYW5TdG9yYWdlQWRhcHRlciBpbXBsZW1lbnRzIFN0b3JhZ2VBZGFwdGVyIHtcbiAgcHJpdmF0ZSByZWFkb25seSBhZGFwdGVyOiBEYXRhQWRhcHRlcjtcbiAgcHJpdmF0ZSByZWFkb25seSByZW1vdmVFbXB0eURpcj86IChhZGFwdGVyUGF0aDogc3RyaW5nKSA9PiBQcm9taXNlPHZvaWQ+O1xuICAvKipcbiAgICogTGF0Y2hlZCB3aGVuIGEgdGVtcCtyZW5hbWUgYXR0ZW1wdCBmYWlsczogZXZlcnkgbGF0ZXIgd3JpdGUgZ29lcyBzdHJhaWdodFxuICAgKiB0byBgd3JpdGVCaW5hcnlgIGluc3RlYWQgb2YgcGF5aW5nIHRoZSBmYWlsaW5nLXJlbmFtZSBwZW5hbHR5IGFnYWluLlxuICAgKi9cbiAgcHJpdmF0ZSB0ZW1wUmVuYW1lQnJva2VuID0gZmFsc2U7XG4gIHByaXZhdGUgdGVtcENvdW50ZXIgPSAwO1xuXG4gIGNvbnN0cnVjdG9yKG9wdGlvbnM6IE9ic2lkaWFuU3RvcmFnZUFkYXB0ZXJPcHRpb25zKSB7XG4gICAgdGhpcy5hZGFwdGVyID0gb3B0aW9ucy5hZGFwdGVyO1xuICAgIHRoaXMucmVtb3ZlRW1wdHlEaXIgPSBvcHRpb25zLnJlbW92ZUVtcHR5RGlyO1xuICB9XG5cbiAgLy8gLS0tIHBhdGggbWFwcGluZyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgLyoqIFZhdWx0IHBhdGggXHUyMTkyIGFkYXB0ZXIgcGF0aCAoYC9hL2IubWRgIFx1MjE5MiBgYS9iLm1kYCwgYC9gIFx1MjE5MiBgL2ApLiAqL1xuICBwcml2YXRlIHRvQWRhcHRlclBhdGgodmF1bHRQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVWYXVsdFBhdGgodmF1bHRQYXRoKTtcbiAgICByZXR1cm4gbm9ybWFsaXplZCA9PT0gJy8nID8gJy8nIDogbm9ybWFsaXplZC5zbGljZSgxKTtcbiAgfVxuXG4gIC8vIC0tLSBTdG9yYWdlQWRhcHRlciAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICBhc3luYyByZWFkRmlsZShwYXRoOiBzdHJpbmcpOiBQcm9taXNlPFVpbnQ4QXJyYXk+IHtcbiAgICBjb25zdCBidWZmZXIgPSBhd2FpdCB0aGlzLmFkYXB0ZXIucmVhZEJpbmFyeSh0aGlzLnRvQWRhcHRlclBhdGgocGF0aCkpO1xuICAgIHJldHVybiBuZXcgVWludDhBcnJheShidWZmZXIpO1xuICB9XG5cbiAgYXN5bmMgd3JpdGVGaWxlKHBhdGg6IHN0cmluZywgZGF0YTogVWludDhBcnJheSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHRhcmdldCA9IHRoaXMudG9BZGFwdGVyUGF0aChwYXRoKTtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVBhcmVudERpcnModGFyZ2V0KTtcbiAgICAvLyBDb3B5IGludG8gYSBzdGFuZGFsb25lIEFycmF5QnVmZmVyOiBgYnl0ZXMuYnVmZmVyYCBtYXkgYmUgYSBwb29sZWRcbiAgICAvLyBidWZmZXIgbGFyZ2VyIHRoYW4gdGhlIHZpZXcgKGNvcmUgc2xpY2VzIGFuZCByZXVzZXMgYnVmZmVycykuXG4gICAgY29uc3QgYnVmZmVyID0gbmV3IEFycmF5QnVmZmVyKGRhdGEuYnl0ZUxlbmd0aCk7XG4gICAgbmV3IFVpbnQ4QXJyYXkoYnVmZmVyKS5zZXQoZGF0YSk7XG5cbiAgICBpZiAodGhpcy50ZW1wUmVuYW1lQnJva2VuKSB7XG4gICAgICBhd2FpdCB0aGlzLmFkYXB0ZXIud3JpdGVCaW5hcnkodGFyZ2V0LCBidWZmZXIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCB0ZW1wID0gYXdhaXQgdGhpcy50ZW1wUGF0aCgpO1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLmFkYXB0ZXIud3JpdGVCaW5hcnkodGVtcCwgYnVmZmVyKTtcbiAgICAgIGF3YWl0IHRoaXMuYWRhcHRlci5yZW5hbWUodGVtcCwgdGFyZ2V0KTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIENsZWFuIHVwIHRoZSBvcnBoYW5lZCB0ZW1wIChiZXN0IGVmZm9ydCBcdTIwMTQgaXQgbGl2ZXMgaW4gdGhlIGlnbm9yZWRcbiAgICAgIC8vIHN0YXRlIGRpciwgc28gZXZlbiBhIGxlYWsgaXMgaW52aXNpYmxlIHRvIHN5bmMpLCB0aGVuIGZhbGwgYmFjayB0b1xuICAgICAgLy8gYSBkaXJlY3QsIG5vbi1hdG9taWMgd3JpdGUgcmF0aGVyIHRoYW4gZmFpbGluZyB0aGUgc3luYy5cbiAgICAgIGF3YWl0IHRoaXMuc2lsZW50UmVtb3ZlKHRlbXApO1xuICAgICAgdGhpcy50ZW1wUmVuYW1lQnJva2VuID0gdHJ1ZTtcbiAgICAgIGF3YWl0IHRoaXMuYWRhcHRlci53cml0ZUJpbmFyeSh0YXJnZXQsIGJ1ZmZlcik7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgZGVsZXRlRmlsZShwYXRoOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCB0YXJnZXQgPSB0aGlzLnRvQWRhcHRlclBhdGgocGF0aCk7XG4gICAgLy8gSWRlbXBvdGVudCBwZXIgdGhlIGFkYXB0ZXIgY29udHJhY3QuXG4gICAgaWYgKCEoYXdhaXQgdGhpcy5hZGFwdGVyLmV4aXN0cyh0YXJnZXQpKSkgcmV0dXJuO1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLmFkYXB0ZXIucmVtb3ZlKHRhcmdldCk7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBMb3N0IGEgcmFjZSB3aXRoIGEgY29uY3VycmVudCBkZWxldGUgXHUyMDE0IG9ubHkgc3VyZmFjZSBpZiBpdCBzdXJ2aXZlcy5cbiAgICAgIGlmIChhd2FpdCB0aGlzLmFkYXB0ZXIuZXhpc3RzKHRhcmdldCkpIHRocm93IG5ldyBFcnJvcihgZmFpbGVkIHRvIGRlbGV0ZSAke3RhcmdldH1gKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyByZW5hbWVGaWxlKGZyb206IHN0cmluZywgdG86IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGZyb21QYXRoID0gdGhpcy50b0FkYXB0ZXJQYXRoKGZyb20pO1xuICAgIGNvbnN0IHRvUGF0aCA9IHRoaXMudG9BZGFwdGVyUGF0aCh0byk7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVQYXJlbnREaXJzKHRvUGF0aCk7XG4gICAgYXdhaXQgdGhpcy5hZGFwdGVyLnJlbmFtZShmcm9tUGF0aCwgdG9QYXRoKTtcbiAgfVxuXG4gIGFzeW5jIGxpc3RGaWxlcygpOiBQcm9taXNlPHJlYWRvbmx5IEZpbGVTdGF0W10+IHtcbiAgICBjb25zdCBmaWxlczogRmlsZVN0YXRbXSA9IFtdO1xuICAgIGF3YWl0IHRoaXMud2Fsa0ZpbGVzKCcvJywgYXN5bmMgKGFkYXB0ZXJQYXRoKSA9PiB7XG4gICAgICBjb25zdCBzdGF0ID0gYXdhaXQgdGhpcy5zdGF0T3JOdWxsKGFkYXB0ZXJQYXRoKTtcbiAgICAgIGlmIChzdGF0ID09PSBudWxsKSByZXR1cm47IC8vIHZhbmlzaGVkIG1pZC13YWxrXG4gICAgICBmaWxlcy5wdXNoKHtcbiAgICAgICAgcGF0aDogYC8ke2FkYXB0ZXJQYXRofWAsXG4gICAgICAgIHNpemU6IHN0YXQuc2l6ZSxcbiAgICAgICAgbXRpbWU6IHN0YXQubXRpbWUsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgICBmaWxlcy5zb3J0KChhLCBiKSA9PiAoYS5wYXRoIDwgYi5wYXRoID8gLTEgOiBhLnBhdGggPiBiLnBhdGggPyAxIDogMCkpO1xuICAgIHJldHVybiBmaWxlcztcbiAgfVxuXG4gIGFzeW5jIGxpc3REaXJzKCk6IFByb21pc2U8cmVhZG9ubHkgc3RyaW5nW10+IHtcbiAgICBjb25zdCBkaXJzOiBzdHJpbmdbXSA9IFsnLyddO1xuICAgIGF3YWl0IHRoaXMud2Fsa0ZvbGRlcnMoJy8nLCBhc3luYyAoYWRhcHRlclBhdGgpID0+IHtcbiAgICAgIGRpcnMucHVzaChgLyR7YWRhcHRlclBhdGh9YCk7XG4gICAgfSk7XG4gICAgZGlycy5zb3J0KChhLCBiKSA9PiAoYSA8IGIgPyAtMSA6IGEgPiBiID8gMSA6IDApKTtcbiAgICByZXR1cm4gZGlycztcbiAgfVxuXG4gIGFzeW5jIGVuc3VyZURpcihwYXRoOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBub3JtYWxpemVkID0gbm9ybWFsaXplVmF1bHRQYXRoKHBhdGgpO1xuICAgIGNvbnN0IHNlZ21lbnRzID0gbm9ybWFsaXplZCA9PT0gJy8nID8gW10gOiBub3JtYWxpemVkLnNsaWNlKDEpLnNwbGl0KCcvJyk7XG4gICAgbGV0IGN1cnJlbnQgPSAnJztcbiAgICBmb3IgKGNvbnN0IHNlZ21lbnQgb2Ygc2VnbWVudHMpIHtcbiAgICAgIGN1cnJlbnQgPSBjdXJyZW50ID09PSAnJyA/IHNlZ21lbnQgOiBgJHtjdXJyZW50fS8ke3NlZ21lbnR9YDtcbiAgICAgIGlmICghKGF3YWl0IHRoaXMuYWRhcHRlci5leGlzdHMoY3VycmVudCkpKSBhd2FpdCB0aGlzLmFkYXB0ZXIubWtkaXIoY3VycmVudCk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbW92ZSBhbiBFTVBUWSBkaXJlY3RvcnkgKHRoZSBgU3RvcmFnZUFkYXB0ZXIucmVtb3ZlRGlyYCBjb250cmFjdCkuXG4gICAqIFByZWZlcnMgdGhlIHZhdWx0LUFQSSBjYWxsYmFjayAoYHJlbW92ZUVtcHR5RGlyYCBcdTIwMTQgc2VlIHRoZSBvcHRpb24ncyBkb2NcbiAgICogZm9yIHdoeSBgRGF0YUFkYXB0ZXIucm1kaXJgIGNhbm5vdCBkbyB0aGlzKTsgZmFsbHMgYmFjayB0byBgcm1kaXJgIGZvclxuICAgKiBiYXJlIGFkYXB0ZXJzICh0ZXN0cykuIE1pc3NpbmcgcGF0aCBcdTIxRDIgbm8tb3AgKGlkZW1wb3RlbnQpOyB0aGUgdmF1bHQgcm9vdFxuICAgKiBpcyBuZXZlciByZW1vdmFibGU7IGEgbm9uLWVtcHR5IHJlZnVzYWwgcHJvcGFnYXRlcyAoY29yZSB0cmVhdHMgaXQgYXNcbiAgICogcmVjb3JkLW9ubHkgXHUyMDE0IG5ldmVyIGRhdGEgbG9zcykuXG4gICAqL1xuICBhc3luYyByZW1vdmVEaXIocGF0aDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IG5vcm1hbGl6ZVZhdWx0UGF0aChwYXRoKTtcbiAgICBpZiAobm9ybWFsaXplZCA9PT0gJy8nKSByZXR1cm47IC8vIG5ldmVyIHRvdWNoIHRoZSB2YXVsdCByb290XG4gICAgY29uc3QgdGFyZ2V0ID0gdGhpcy50b0FkYXB0ZXJQYXRoKG5vcm1hbGl6ZWQpO1xuICAgIC8vIElkZW1wb3RlbnQgcGVyIHRoZSBhZGFwdGVyIGNvbnRyYWN0LlxuICAgIGlmICghKGF3YWl0IHRoaXMuYWRhcHRlci5leGlzdHModGFyZ2V0KSkpIHJldHVybjtcbiAgICBpZiAodGhpcy5yZW1vdmVFbXB0eURpciAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBhd2FpdCB0aGlzLnJlbW92ZUVtcHR5RGlyKHRhcmdldCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGF3YWl0IHRoaXMuYWRhcHRlci5ybWRpcih0YXJnZXQsIGZhbHNlKTtcbiAgfVxuXG4gIGFzeW5jIGV4aXN0cyhwYXRoOiBzdHJpbmcpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBjb25zdCBub3JtYWxpemVkID0gbm9ybWFsaXplVmF1bHRQYXRoKHBhdGgpO1xuICAgIGlmIChub3JtYWxpemVkID09PSAnLycpIHJldHVybiB0cnVlOyAvLyB0aGUgdmF1bHQgcm9vdCBhbHdheXMgZXhpc3RzXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmFkYXB0ZXIuZXhpc3RzKHRoaXMudG9BZGFwdGVyUGF0aChub3JtYWxpemVkKSk7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICB9XG5cbiAgLy8gLS0tIGhlbHBlcnMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIHByaXZhdGUgYXN5bmMgc3RhdE9yTnVsbChhZGFwdGVyUGF0aDogc3RyaW5nKTogUHJvbWlzZTxBZGFwdGVyU3RhdCB8IG51bGw+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3Qgc3RhdCA9IGF3YWl0IHRoaXMuYWRhcHRlci5zdGF0KGFkYXB0ZXJQYXRoKTtcbiAgICAgIGlmIChzdGF0ID09PSBudWxsIHx8IHN0YXQudHlwZSAhPT0gJ2ZpbGUnKSByZXR1cm4gbnVsbDtcbiAgICAgIHJldHVybiB7IHNpemU6IHN0YXQuc2l6ZSwgbXRpbWU6IHN0YXQubXRpbWUgfTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgfVxuXG4gIC8qKiBBIHVuaXF1ZSB0ZW1wIHBhdGggaW5zaWRlIHRoZSAoc3luYy1pZ25vcmVkKSBjbGllbnQgc3RhdGUgZGlyLiAqL1xuICBwcml2YXRlIGFzeW5jIHRlbXBQYXRoKCk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVEaXIoVEVNUF9ESVJfVkFVTFRfUEFUSCk7XG4gICAgdGhpcy50ZW1wQ291bnRlciArPSAxO1xuICAgIHJldHVybiBgJHtURU1QX0RJUl9WQVVMVF9QQVRILnNsaWNlKDEpfS93LSR7RGF0ZS5ub3coKS50b1N0cmluZygzNil9LSR7dGhpcy50ZW1wQ291bnRlcn0udG1wYDtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgc2lsZW50UmVtb3ZlKGFkYXB0ZXJQYXRoOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5hZGFwdGVyLnJlbW92ZShhZGFwdGVyUGF0aCk7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBiZXN0IGVmZm9ydFxuICAgIH1cbiAgfVxuXG4gIC8qKiBDcmVhdGUgZXZlcnkgYW5jZXN0b3IgZGlyZWN0b3J5IG9mIGFuIGFkYXB0ZXIgZmlsZSBwYXRoLiAqL1xuICBwcml2YXRlIGFzeW5jIGVuc3VyZVBhcmVudERpcnMoYWRhcHRlclBhdGg6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHNsYXNoID0gYWRhcHRlclBhdGgubGFzdEluZGV4T2YoJy8nKTtcbiAgICBpZiAoc2xhc2ggPD0gMCkgcmV0dXJuOyAvLyB2YXVsdCByb290IFx1MjAxNCBhbHdheXMgZXhpc3RzXG4gICAgY29uc3QgcGFyZW50ID0gYWRhcHRlclBhdGguc2xpY2UoMCwgc2xhc2gpO1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlRGlyKGAvJHtwYXJlbnR9YCk7XG4gIH1cblxuICAvKiogUmVjdXJzaXZlbHkgdmlzaXQgZXZlcnkgZmlsZSB1bmRlciBgZGlyQWRhcHRlclBhdGhgIChhZGFwdGVyIHBhdGhzKS4gKi9cbiAgcHJpdmF0ZSBhc3luYyB3YWxrRmlsZXMoXG4gICAgZGlyQWRhcHRlclBhdGg6IHN0cmluZyxcbiAgICB2aXNpdDogKGFkYXB0ZXJQYXRoOiBzdHJpbmcpID0+IFByb21pc2U8dm9pZD4sXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGxldCBsaXN0aW5nO1xuICAgIHRyeSB7XG4gICAgICBsaXN0aW5nID0gYXdhaXQgdGhpcy5hZGFwdGVyLmxpc3QoZGlyQWRhcHRlclBhdGgpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuOyAvLyB1bnJlYWRhYmxlL21pc3NpbmcgXHUyMDE0IHRyZWF0IGFzIGVtcHR5XG4gICAgfVxuICAgIGZvciAoY29uc3QgZmlsZSBvZiBsaXN0aW5nLmZpbGVzKSBhd2FpdCB2aXNpdChmaWxlKTtcbiAgICBmb3IgKGNvbnN0IGZvbGRlciBvZiBsaXN0aW5nLmZvbGRlcnMpIGF3YWl0IHRoaXMud2Fsa0ZpbGVzKGZvbGRlciwgdmlzaXQpO1xuICB9XG5cbiAgLyoqIFJlY3Vyc2l2ZWx5IHZpc2l0IGV2ZXJ5IGZvbGRlciB1bmRlciBgZGlyQWRhcHRlclBhdGhgIChhZGFwdGVyIHBhdGhzKS4gKi9cbiAgcHJpdmF0ZSBhc3luYyB3YWxrRm9sZGVycyhcbiAgICBkaXJBZGFwdGVyUGF0aDogc3RyaW5nLFxuICAgIHZpc2l0OiAoYWRhcHRlclBhdGg6IHN0cmluZykgPT4gUHJvbWlzZTx2b2lkPixcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgbGV0IGxpc3Rpbmc7XG4gICAgdHJ5IHtcbiAgICAgIGxpc3RpbmcgPSBhd2FpdCB0aGlzLmFkYXB0ZXIubGlzdChkaXJBZGFwdGVyUGF0aCk7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGZvciAoY29uc3QgZm9sZGVyIG9mIGxpc3RpbmcuZm9sZGVycykge1xuICAgICAgYXdhaXQgdmlzaXQoZm9sZGVyKTtcbiAgICAgIGF3YWl0IHRoaXMud2Fsa0ZvbGRlcnMoZm9sZGVyLCB2aXNpdCk7XG4gICAgfVxuICB9XG59XG4iLCAiLyoqXG4gKiBgT2JzaWRpYW5XYXRjaEFkYXB0ZXJgICsgYFJlc2NhblNjaGVkdWxlcmAgXHUyMDE0IGNvcmUncyBgV2F0Y2hBZGFwdGVyYCBvdmVyXG4gKiBPYnNpZGlhbiB2YXVsdCBldmVudHMgKEFSQ0hJVEVDVFVSRSBcdTAwQTc4IGFkYXB0ZXJzKSwgcGx1cyB0aGUgcGVyaW9kaWMgL1xuICogZm9jdXMtZHJpdmVuIHJlY29uY2lsaWF0aW9uIGhvb2tzIHRoZSBtb2JpbGUgJiBleHRlcm5hbC1lZGl0IHN0b3JpZXMgbmVlZFxuICogKFx1MDBBNzggXCJNb2JpbGVcIiwgRlItNSwgRlItMTIpLlxuICpcbiAqIFZhdWx0IGV2ZW50cyBjb3ZlciBldmVyeXRoaW5nIE9ic2lkaWFuIGl0c2VsZiBvYnNlcnZlcyBcdTIwMTQgaW4tYXBwIGVkaXRzLFxuICogZHJhZy1kcm9wcywgYW5kIGV4dGVybmFsIGVkaXRzIG1hZGUgd2hpbGUgT2JzaWRpYW4gaXMgKm9wZW4qLiBFZGl0cyBtYWRlXG4gKiB3aGlsZSBPYnNpZGlhbiB3YXMgY2xvc2VkIGFyZSBwaWNrZWQgdXAgYnkgdGhlIHN0YXJ0dXAgcmVjb25jaWxpYXRpb24gYW5kXG4gKiBieSB0aGUgcGVyaW9kaWMgcmVzY2FuIHdpcmVkIGhlcmU6XG4gKlxuICogICB2YXVsdCBldmVudHMgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNUJBIFdhdGNoQWRhcHRlci5zdGFydChjYikgXHUyNTAwXHUyNUJBIFN5bmNDbGllbnQgZGVib3VuY2VkIGN5Y2xlXG4gKiAgIHNldEludGVydmFsIChkZWZhdWx0IDMwcykgXHUyNTAwXHUyNUJBIFJlc2NhblNjaGVkdWxlciBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1QkEgU3luY0NsaWVudC50cmlnZ2VyU3luYygpXG4gKiAgIGFjdGl2ZS1sZWFmLWNoYW5nZSBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1QkEgUmVzY2FuU2NoZWR1bGVyLnBva2UoKSBcdTI1MDBcdTI1MDBcdTI1QkEgKHNob3J0IGRlYm91bmNlLCB0aGVuIGEgY3ljbGUpXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBFdmVudFJlZiwgVEFic3RyYWN0RmlsZSwgVmF1bHQgfSBmcm9tICdvYnNpZGlhbic7XG5pbXBvcnQgdHlwZSB7IEZpbGVDaGFuZ2VFdmVudCwgV2F0Y2hBZGFwdGVyIH0gZnJvbSAnQHZzYS9jb3JlJztcblxuZXhwb3J0IGludGVyZmFjZSBPYnNpZGlhbldhdGNoQWRhcHRlck9wdGlvbnMge1xuICB2YXVsdDogVmF1bHQ7XG59XG5cbmV4cG9ydCBjbGFzcyBPYnNpZGlhbldhdGNoQWRhcHRlciBpbXBsZW1lbnRzIFdhdGNoQWRhcHRlciB7XG4gIHByaXZhdGUgcmVhZG9ubHkgdmF1bHQ6IFZhdWx0O1xuICBwcml2YXRlIHJlZnM6IEV2ZW50UmVmW10gPSBbXTtcbiAgcHJpdmF0ZSBlbWl0OiAoKGV2ZW50czogcmVhZG9ubHkgRmlsZUNoYW5nZUV2ZW50W10pID0+IHZvaWQpIHwgbnVsbCA9IG51bGw7XG5cbiAgY29uc3RydWN0b3Iob3B0aW9uczogT2JzaWRpYW5XYXRjaEFkYXB0ZXJPcHRpb25zKSB7XG4gICAgdGhpcy52YXVsdCA9IG9wdGlvbnMudmF1bHQ7XG4gIH1cblxuICBzdGFydChjYjogKGV2ZW50czogcmVhZG9ubHkgRmlsZUNoYW5nZUV2ZW50W10pID0+IHZvaWQpOiB2b2lkIHtcbiAgICB0aGlzLnN0b3AoKTtcbiAgICB0aGlzLmVtaXQgPSBjYjtcbiAgICAvLyBCb3RoIGZpbGVzIGFuZCBmb2xkZXJzIGFyZSBmb3J3YXJkZWQ6IGZvbGRlciBldmVudHMgKGNyZWF0ZS9yZW5hbWUvXG4gICAgLy8gZGVsZXRlKSB0cmlnZ2VyIHRoZSByZWNvbmNpbGlhdGlvbiBzY2FuIHRoYXQgZGlzY292ZXJzIGVtcHR5LWZvbGRlclxuICAgIC8vIHBsYWNlaG9sZGVyIGNoYW5nZXMgKEZSLTEwKS4gVGhlIGVuZ2luZSBmaWx0ZXJzIGlnbm9yZWQgcGF0aHMgaXRzZWxmLlxuICAgIHRoaXMucmVmcyA9IFtcbiAgICAgIHRoaXMudmF1bHQub24oJ2NyZWF0ZScsIChmaWxlOiBUQWJzdHJhY3RGaWxlKSA9PiB7XG4gICAgICAgIHRoaXMuZm9yd2FyZCh7IGtpbmQ6ICdhZGQnLCBwYXRoOiB2YXVsdFBhdGhPZihmaWxlKSB9KTtcbiAgICAgIH0pLFxuICAgICAgdGhpcy52YXVsdC5vbignbW9kaWZ5JywgKGZpbGU6IFRBYnN0cmFjdEZpbGUpID0+IHtcbiAgICAgICAgdGhpcy5mb3J3YXJkKHsga2luZDogJ21vZGlmeScsIHBhdGg6IHZhdWx0UGF0aE9mKGZpbGUpIH0pO1xuICAgICAgfSksXG4gICAgICB0aGlzLnZhdWx0Lm9uKCdkZWxldGUnLCAoZmlsZTogVEFic3RyYWN0RmlsZSkgPT4ge1xuICAgICAgICB0aGlzLmZvcndhcmQoeyBraW5kOiAnZGVsZXRlJywgcGF0aDogdmF1bHRQYXRoT2YoZmlsZSkgfSk7XG4gICAgICB9KSxcbiAgICAgIHRoaXMudmF1bHQub24oJ3JlbmFtZScsIChmaWxlOiBUQWJzdHJhY3RGaWxlLCBvbGRQYXRoOiBzdHJpbmcpID0+IHtcbiAgICAgICAgLy8gYG9sZFBhdGhgIFx1MjE5MiBgZmlsZS5wYXRoYDogdGhlIGVudHJ5IGF0IGBwYXRoYCBtb3ZlZCB0byBgdG9QYXRoYC5cbiAgICAgICAgdGhpcy5mb3J3YXJkKHsga2luZDogJ3JlbmFtZScsIHBhdGg6IGAvJHtvbGRQYXRofWAsIHRvUGF0aDogdmF1bHRQYXRoT2YoZmlsZSkgfSk7XG4gICAgICB9KSxcbiAgICBdO1xuICB9XG5cbiAgc3RvcCgpOiB2b2lkIHtcbiAgICBmb3IgKGNvbnN0IHJlZiBvZiB0aGlzLnJlZnMpIHRoaXMudmF1bHQub2ZmcmVmKHJlZik7XG4gICAgdGhpcy5yZWZzID0gW107XG4gICAgdGhpcy5lbWl0ID0gbnVsbDtcbiAgfVxuXG4gIHByaXZhdGUgZm9yd2FyZChldmVudDogRmlsZUNoYW5nZUV2ZW50KTogdm9pZCB7XG4gICAgdGhpcy5lbWl0Py4oW2V2ZW50XSk7XG4gIH1cbn1cblxuLyoqIFZhdWx0IGV2ZW50IHBhdGggKGFkYXB0ZXItbm9ybWFsaXplZCwgbm8gbGVhZGluZyBzbGFzaCkgXHUyMTkyIGNvcmUgdmF1bHQgcGF0aC4gKi9cbmZ1bmN0aW9uIHZhdWx0UGF0aE9mKGZpbGU6IFRBYnN0cmFjdEZpbGUpOiBzdHJpbmcge1xuICByZXR1cm4gZmlsZS5wYXRoLnN0YXJ0c1dpdGgoJy8nKSA/IGZpbGUucGF0aCA6IGAvJHtmaWxlLnBhdGh9YDtcbn1cblxuLy8gLS0tIFJlc2NhblNjaGVkdWxlciAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIFJlc2NhblNjaGVkdWxlck9wdGlvbnMge1xuICAvKiogUGVyaW9kIGJldHdlZW4gZnVsbCByZXNjYW5zIGluIG1zOyBgMGAgZGlzYWJsZXMgdGhlIHBlcmlvZGljIHRpbWVyLiAqL1xuICBpbnRlcnZhbE1zOiBudW1iZXI7XG4gIC8qKiBEZWJvdW5jZSB3aW5kb3cgZm9yIGBwb2tlKClgIChhY3RpdmUtbGVhZi1jaGFuZ2UpLCBkZWZhdWx0IDMwMDAgbXMuICovXG4gIHBva2VEZWxheU1zPzogbnVtYmVyO1xuICAvKiogSW5qZWN0YWJsZSB0aW1lciBzZWFtcyAodGVzdHMgdXNlIGZha2UgdGltZXJzIGFnYWluc3QgdGhlIGdsb2JhbHMpLiAqL1xuICBzZXRJbnRlcnZhbEltcGw/OiAoZm46ICgpID0+IHZvaWQsIG1zOiBudW1iZXIpID0+IHVua25vd247XG4gIGNsZWFySW50ZXJ2YWxJbXBsPzogKGhhbmRsZTogdW5rbm93bikgPT4gdm9pZDtcbiAgc2V0VGltZW91dEltcGw/OiAoZm46ICgpID0+IHZvaWQsIG1zOiBudW1iZXIpID0+IHVua25vd247XG4gIGNsZWFyVGltZW91dEltcGw/OiAoaGFuZGxlOiB1bmtub3duKSA9PiB2b2lkO1xufVxuXG4vKipcbiAqIERyaXZlcyBwZXJpb2RpYyArIGZvY3VzLXRyaWdnZXJlZCBmdWxsIHJlY29uY2lsaWF0aW9uIGN5Y2xlcy4gTm90IGFcbiAqIGBXYXRjaEFkYXB0ZXJgIGl0c2VsZiBcdTIwMTQgaXRzIGBydW5gIGNhbGxiYWNrIGlzIHdpcmVkIHRvXG4gKiBgU3luY0NsaWVudC50cmlnZ2VyU3luYygpYCBieSB0aGUgcGx1Z2luIChhIHJlc2NhbiBpcyBhIGZ1bGwgY3ljbGUsIG5vdCBhXG4gKiBzaW5nbGUgZmlsZSBldmVudCkuXG4gKi9cbmV4cG9ydCBjbGFzcyBSZXNjYW5TY2hlZHVsZXIge1xuICBwcml2YXRlIHJlYWRvbmx5IHBva2VEZWxheU1zOiBudW1iZXI7XG4gIHByaXZhdGUgcmVhZG9ubHkgc2V0SW50ZXJ2YWxJbXBsOiAoZm46ICgpID0+IHZvaWQsIG1zOiBudW1iZXIpID0+IHVua25vd247XG4gIHByaXZhdGUgcmVhZG9ubHkgY2xlYXJJbnRlcnZhbEltcGw6IChoYW5kbGU6IHVua25vd24pID0+IHZvaWQ7XG4gIHByaXZhdGUgcmVhZG9ubHkgc2V0VGltZW91dEltcGw6IChmbjogKCkgPT4gdm9pZCwgbXM6IG51bWJlcikgPT4gdW5rbm93bjtcbiAgcHJpdmF0ZSByZWFkb25seSBjbGVhclRpbWVvdXRJbXBsOiAoaGFuZGxlOiB1bmtub3duKSA9PiB2b2lkO1xuXG4gIHByaXZhdGUgcnVuOiAoKCkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBpbnRlcnZhbEhhbmRsZTogdW5rbm93biA9IG51bGw7XG4gIHByaXZhdGUgaW50ZXJ2YWxNczogbnVtYmVyO1xuICBwcml2YXRlIHBva2VIYW5kbGU6IHVua25vd24gPSBudWxsO1xuXG4gIGNvbnN0cnVjdG9yKG9wdGlvbnM6IFJlc2NhblNjaGVkdWxlck9wdGlvbnMpIHtcbiAgICB0aGlzLmludGVydmFsTXMgPSBvcHRpb25zLmludGVydmFsTXM7XG4gICAgdGhpcy5wb2tlRGVsYXlNcyA9IG9wdGlvbnMucG9rZURlbGF5TXMgPz8gMzAwMDtcbiAgICB0aGlzLnNldEludGVydmFsSW1wbCA9IG9wdGlvbnMuc2V0SW50ZXJ2YWxJbXBsID8/ICgoZm4sIG1zKSA9PiBzZXRJbnRlcnZhbChmbiwgbXMpKTtcbiAgICB0aGlzLmNsZWFySW50ZXJ2YWxJbXBsID0gb3B0aW9ucy5jbGVhckludGVydmFsSW1wbCA/PyAoKGhhbmRsZSkgPT4gY2xlYXJJbnRlcnZhbChoYW5kbGUgYXMgbnVtYmVyKSk7XG4gICAgdGhpcy5zZXRUaW1lb3V0SW1wbCA9IG9wdGlvbnMuc2V0VGltZW91dEltcGwgPz8gKChmbiwgbXMpID0+IHNldFRpbWVvdXQoZm4sIG1zKSk7XG4gICAgdGhpcy5jbGVhclRpbWVvdXRJbXBsID0gb3B0aW9ucy5jbGVhclRpbWVvdXRJbXBsID8/ICgoaGFuZGxlKSA9PiBjbGVhclRpbWVvdXQoaGFuZGxlIGFzIG51bWJlcikpO1xuICB9XG5cbiAgLyoqIEJlZ2luIHBlcmlvZGljIHJlc2NhbnM7IGBydW5gIG11c3QgYmUgc2FmZSB0byBjYWxsIGF0IGFueSB0aW1lLiAqL1xuICBzdGFydChydW46ICgpID0+IHZvaWQpOiB2b2lkIHtcbiAgICB0aGlzLnN0b3AoKTtcbiAgICB0aGlzLnJ1biA9IHJ1bjtcbiAgICB0aGlzLmFybUludGVydmFsKCk7XG4gIH1cblxuICBzdG9wKCk6IHZvaWQge1xuICAgIHRoaXMuY2xlYXJJbnRlcnZhbEltcGxLZWVwKCk7XG4gICAgaWYgKHRoaXMucG9rZUhhbmRsZSAhPT0gbnVsbCkge1xuICAgICAgdGhpcy5jbGVhclRpbWVvdXRJbXBsKHRoaXMucG9rZUhhbmRsZSk7XG4gICAgICB0aGlzLnBva2VIYW5kbGUgPSBudWxsO1xuICAgIH1cbiAgICB0aGlzLnJ1biA9IG51bGw7XG4gIH1cblxuICAvKiogQ2hhbmdlIHRoZSBwZXJpb2RpYyBpbnRlcnZhbCBsaXZlICh0aGUgc2V0dGluZ3MtdGFiIHRvZ2dsZSkuICovXG4gIHNldEludGVydmFsTXMobXM6IG51bWJlcik6IHZvaWQge1xuICAgIHRoaXMuaW50ZXJ2YWxNcyA9IG1zO1xuICAgIGlmICh0aGlzLnJ1biAhPT0gbnVsbCkge1xuICAgICAgdGhpcy5jbGVhckludGVydmFsSW1wbEtlZXAoKTtcbiAgICAgIHRoaXMuYXJtSW50ZXJ2YWwoKTtcbiAgICB9XG4gIH1cblxuICAvKiogQSBmb2N1cy9hcHAtc3dpdGNoIHNpZ25hbCAoYWN0aXZlLWxlYWYtY2hhbmdlKTogcmVzY2FuIHNvb24sIGNvYWxlc2NlZC4gKi9cbiAgcG9rZSgpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5ydW4gPT09IG51bGwpIHJldHVybjtcbiAgICBpZiAodGhpcy5wb2tlSGFuZGxlICE9PSBudWxsKSByZXR1cm47IC8vIGFscmVhZHkgc2NoZWR1bGVkXG4gICAgdGhpcy5wb2tlSGFuZGxlID0gdGhpcy5zZXRUaW1lb3V0SW1wbCgoKSA9PiB7XG4gICAgICB0aGlzLnBva2VIYW5kbGUgPSBudWxsO1xuICAgICAgdGhpcy5ydW4/LigpO1xuICAgIH0sIHRoaXMucG9rZURlbGF5TXMpO1xuICB9XG5cbiAgZ2V0IGludGVydmFsTXNWYWx1ZSgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLmludGVydmFsTXM7XG4gIH1cblxuICBwcml2YXRlIGFybUludGVydmFsKCk6IHZvaWQge1xuICAgIGlmICh0aGlzLmludGVydmFsTXMgPD0gMCB8fCB0aGlzLnJ1biA9PT0gbnVsbCkgcmV0dXJuO1xuICAgIHRoaXMuaW50ZXJ2YWxIYW5kbGUgPSB0aGlzLnNldEludGVydmFsSW1wbCgoKSA9PiB0aGlzLnJ1bj8uKCksIHRoaXMuaW50ZXJ2YWxNcyk7XG4gIH1cblxuICBwcml2YXRlIGNsZWFySW50ZXJ2YWxJbXBsS2VlcCgpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5pbnRlcnZhbEhhbmRsZSAhPT0gbnVsbCkge1xuICAgICAgdGhpcy5jbGVhckludGVydmFsSW1wbCh0aGlzLmludGVydmFsSGFuZGxlKTtcbiAgICAgIHRoaXMuaW50ZXJ2YWxIYW5kbGUgPSBudWxsO1xuICAgIH1cbiAgfVxufVxuIiwgIi8qKlxuICogYEh0dHBCbG9iU3RvcmVgIFx1MjAxNCBjb3JlJ3MgYEJsb2JTdG9yZWAgYWdhaW5zdCB0aGUgd29ya2VyJ3MgYC9ibG9iLzpoYXNoYFxuICogcm91dGVzIChBUkNISVRFQ1RVUkUgXHUwMEE3NSBIVFRQUyByb3V0ZXMpLCBhdXRoZW50aWNhdGVkIHdpdGggdGhlIGRldmljZSB0b2tlblxuICogYXMgYSBCZWFyZXIgaGVhZGVyLiBCdWlsdCBvbiB0aGUgZ2xvYmFsIGBmZXRjaGAgKE9ic2lkaWFuIGRlc2t0b3AgYW5kXG4gKiBtb2JpbGUpLCBpbmplY3RhYmxlIGZvciB0ZXN0cy4gUGx1Z2luLWxvY2FsIHR3aW4gb2YgdGhlIG5vZGUtcnVudGltZSBvbmU6XG4gKiBubyBpbXBvcnRzIGZyb20gYEB2c2Evbm9kZS1ydW50aW1lYCAoTm9kZS1vbmx5IHBhY2thZ2UpLlxuICovXG5cbmltcG9ydCB0eXBlIHsgQmxvYlN0b3JlIH0gZnJvbSAnQHZzYS9jb3JlJztcblxuLyoqIE5vbi0yeHggYmxvYi1yb3V0ZSByZXBseS4gYHN0YXR1c2AgaXMgdGhlIEhUVFAgc3RhdHVzIGNvZGUuICovXG5leHBvcnQgY2xhc3MgSHR0cEJsb2JFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgY29uc3RydWN0b3IoXG4gICAgcmVhZG9ubHkgc3RhdHVzOiBudW1iZXIsXG4gICAgbWVzc2FnZTogc3RyaW5nLFxuICApIHtcbiAgICBzdXBlcihtZXNzYWdlKTtcbiAgICB0aGlzLm5hbWUgPSAnSHR0cEJsb2JFcnJvcic7XG4gIH1cbn1cblxuZXhwb3J0IGludGVyZmFjZSBIdHRwQmxvYlN0b3JlT3B0aW9ucyB7XG4gIC8qKiBXb3JrZXIgb3JpZ2luLCBlLmcuIGBodHRwczovL3BlcnNvbmFsLngud29ya2Vycy5kZXZgLiAqL1xuICBiYXNlVXJsOiBzdHJpbmc7XG4gIC8qKiBEZXZpY2UgdG9rZW4gKEJlYXJlcikuICovXG4gIHRva2VuOiBzdHJpbmc7XG4gIC8qKiBJbmplY3RhYmxlIGZldGNoICh0ZXN0cykuIERlZmF1bHRzIHRvIHRoZSBnbG9iYWwuICovXG4gIGZldGNoSW1wbD86IHR5cGVvZiBmZXRjaDtcbn1cblxuZXhwb3J0IGNsYXNzIEh0dHBCbG9iU3RvcmUgaW1wbGVtZW50cyBCbG9iU3RvcmUge1xuICBwcml2YXRlIHJlYWRvbmx5IGJhc2U6IHN0cmluZztcbiAgcHJpdmF0ZSByZWFkb25seSB0b2tlbjogc3RyaW5nO1xuICBwcml2YXRlIHJlYWRvbmx5IGRvRmV0Y2g6IHR5cGVvZiBmZXRjaDtcblxuICBjb25zdHJ1Y3RvcihvcHRpb25zOiBIdHRwQmxvYlN0b3JlT3B0aW9ucykge1xuICAgIHRoaXMuYmFzZSA9IG9wdGlvbnMuYmFzZVVybC5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgICB0aGlzLnRva2VuID0gb3B0aW9ucy50b2tlbjtcbiAgICAvLyBCb3VuZCBsaWtlIHRoZSBwbHVnaW4ncyBgZmV0Y2hJbXBsYCBzZWFtOiB0aGlzIGNsYXNzIGNhbGxzIGBkb0ZldGNoYFxuICAgIC8vIGRldGFjaGVkLCBhbmQgYSBiYXJlIGdsb2JhbCBgZmV0Y2hgIGlzIGFuIGlsbGVnYWwgaW52b2NhdGlvbiBpblxuICAgIC8vIENocm9taXVtIHJlbmRlcmVycyAocmVhbCBPYnNpZGlhbikuXG4gICAgdGhpcy5kb0ZldGNoID0gb3B0aW9ucy5mZXRjaEltcGwgPz8gZ2xvYmFsVGhpcy5mZXRjaC5iaW5kKGdsb2JhbFRoaXMpO1xuICB9XG5cbiAgLyoqIEdFVCAvYmxvYi86aGFzaCBcdTIxOTIgYnl0ZXMsIG9yIGB1bmRlZmluZWRgIG9uIDQwNC4gKi9cbiAgYXN5bmMgZ2V0KGhhc2g6IHN0cmluZyk6IFByb21pc2U8VWludDhBcnJheSB8IHVuZGVmaW5lZD4ge1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5kb0ZldGNoKGAke3RoaXMuYmFzZX0vYmxvYi8ke2hhc2h9YCwge1xuICAgICAgaGVhZGVyczogeyBhdXRob3JpemF0aW9uOiBgQmVhcmVyICR7dGhpcy50b2tlbn1gIH0sXG4gICAgfSk7XG4gICAgaWYgKHJlc3BvbnNlLnN0YXR1cyA9PT0gNDA0KSByZXR1cm4gdW5kZWZpbmVkO1xuICAgIGlmICghcmVzcG9uc2Uub2spIHtcbiAgICAgIHRocm93IG5ldyBIdHRwQmxvYkVycm9yKHJlc3BvbnNlLnN0YXR1cywgYXdhaXQgZXJyb3JNZXNzYWdlKHJlc3BvbnNlLCAnZmV0Y2ggYmxvYicpKTtcbiAgICB9XG4gICAgcmV0dXJuIG5ldyBVaW50OEFycmF5KGF3YWl0IHJlc3BvbnNlLmFycmF5QnVmZmVyKCkpO1xuICB9XG5cbiAgLyoqIFBVVCAvYmxvYi86aGFzaCBcdTIwMTQgaWRlbXBvdGVudCBwZXIgdGhlIENBUyBjb250cmFjdC4gKi9cbiAgYXN5bmMgcHV0KGhhc2g6IHN0cmluZywgYnl0ZXM6IFVpbnQ4QXJyYXkpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMuZG9GZXRjaChgJHt0aGlzLmJhc2V9L2Jsb2IvJHtoYXNofWAsIHtcbiAgICAgIG1ldGhvZDogJ1BVVCcsXG4gICAgICBoZWFkZXJzOiB7XG4gICAgICAgIGF1dGhvcml6YXRpb246IGBCZWFyZXIgJHt0aGlzLnRva2VufWAsXG4gICAgICAgICdjb250ZW50LXR5cGUnOiAnYXBwbGljYXRpb24vb2N0ZXQtc3RyZWFtJyxcbiAgICAgIH0sXG4gICAgICBib2R5OiBieXRlcyBhcyBCb2R5SW5pdCxcbiAgICB9KTtcbiAgICBpZiAoIXJlc3BvbnNlLm9rKSB7XG4gICAgICB0aHJvdyBuZXcgSHR0cEJsb2JFcnJvcihyZXNwb25zZS5zdGF0dXMsIGF3YWl0IGVycm9yTWVzc2FnZShyZXNwb25zZSwgJ3N0b3JlIGJsb2InKSk7XG4gICAgfVxuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGVycm9yTWVzc2FnZShyZXNwb25zZTogUmVzcG9uc2UsIHdoYXQ6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gIGNvbnN0IGRldGFpbCA9IChhd2FpdCByZXNwb25zZS50ZXh0KCkuY2F0Y2goKCkgPT4gJycpKS5zbGljZSgwLCAzMDApO1xuICByZXR1cm4gZGV0YWlsID09PSAnJ1xuICAgID8gYGZhaWxlZCB0byAke3doYXR9OiBIVFRQICR7cmVzcG9uc2Uuc3RhdHVzfWBcbiAgICA6IGBmYWlsZWQgdG8gJHt3aGF0fTogSFRUUCAke3Jlc3BvbnNlLnN0YXR1c306ICR7ZGV0YWlsfWA7XG59XG4iLCAiLyoqXG4gKiBEaWFnbm9zdGljcyAodGhlIHNldHRpbmdzIHRhYidzIFwiQWR2YW5jZWQgXHUyMTkyIERpYWdub3N0aWNzXCIpOiBhIGJvdW5kZWQgcmluZ1xuICogYnVmZmVyIG92ZXIgdGhlIHBsdWdpbidzIGxvZyBzdHJlYW0gd2l0aCBhIHVzZXItc2VsZWN0YWJsZSBtaW5pbXVtIGxldmVsLFxuICogYSB0cmFuc3BvcnQgd3JhcHBlciB0aGF0IHJlY29yZHMgcHJvdG9jb2wgcm91bmQtdHJpcHMgYXQgZGVidWcgbGV2ZWwgKGxvd1xuICogdm9sdW1lOiBvbmUgc2hvcnQgbGluZSBwZXIgZnJhbWUpLCBhbmQgdGhlIFwiQ29weSBkaWFnbm9zdGljc1wiIGJ1bmRsZS5cbiAqXG4gKiBUaGUgYnVuZGxlIGlzIGEgcGxhaW4tdGV4dCBzbmFwc2hvdCBtZWFudCBmb3IgYnVnIHJlcG9ydHM6IHZlcnNpb25zLFxuICogaWRlbnRpdHksIHdvcmtlciwgYSBjbGllbnQgc3RhdHVzIHNuYXBzaG90LCB0aGUgcGxhdGZvcm0sIGFuZCB0aGUgbGFzdCBOXG4gKiBsb2cgbGluZXMuIGBidWlsZFN1cHBvcnRCdW5kbGVgIGlzIGl0cyByaWNoZXIgbWFya2Rvd24gc2libGluZyBcdTIwMTQgdGhlIGZpbGVcbiAqIGEgXCJzeW5jIGF0ZSBteSBub3RlXCIgcmVwb3J0IGF0dGFjaGVzLlxuICovXG5cbmltcG9ydCB7IFByb3RvY29sVmVyc2lvbiB9IGZyb20gJ0B2c2EvY29yZSc7XG5pbXBvcnQgdHlwZSB7IExvZ0FkYXB0ZXIsIFN5bmNDbGllbnRTdGF0dXMsIFRyYW5zcG9ydCB9IGZyb20gJ0B2c2EvY29yZSc7XG5pbXBvcnQgeyBQbGF0Zm9ybSB9IGZyb20gJ29ic2lkaWFuJztcbmltcG9ydCB0eXBlIHsgTG9nTGV2ZWwsIFBsdWdpblN5bmNTZXR0aW5ncyB9IGZyb20gJy4vZGF0YS5qcyc7XG5cbi8qKiBTZXZlcml0eSByYW5raW5nOyBgZXJyb3JgIGFsd2F5cyBvdXRyYW5rcyBldmVyeSBzZWxlY3RhYmxlIGxldmVsLiAqL1xuY29uc3QgTEVWRUxfUkFOSzogUmVjb3JkPExvZ0xldmVsIHwgJ2Vycm9yJywgbnVtYmVyPiA9IHsgZGVidWc6IDEwLCBpbmZvOiAyMCwgd2FybjogMzAsIGVycm9yOiA0MCB9O1xuXG4vKiogTG9nIGxpbmVzIGtlcHQgZm9yIHRoZSBkaWFnbm9zdGljcyBidW5kbGUgKHRoZSBzcGVjJ3MgXCJsYXN0IDIwXCIpLiAqL1xuZXhwb3J0IGNvbnN0IFJJTkdfQ0FQQUNJVFkgPSAyMDtcblxuLyoqIE1heCBjaGFyYWN0ZXJzIG9uZSBhcmd1bWVudCBjb250cmlidXRlcyB0byBhIHJpbmcgbGluZS4gKi9cbmNvbnN0IEFSR19NQVhfQ0hBUlMgPSAzMDA7XG5cbi8qKiBBIGBMb2dBZGFwdGVyYCB3aXRoIGEgbGV2ZWwgZ2F0ZSBhbmQgYSBib3VuZGVkIHJpbmcgYnVmZmVyIGF0dGFjaGVkLiAqL1xuZXhwb3J0IGludGVyZmFjZSBQbHVnaW5Mb2cgZXh0ZW5kcyBMb2dBZGFwdGVyIHtcbiAgLyoqIENoYW5nZSB0aGUgbWluaW11bSByZWNvcmRlZCBsZXZlbCBhdCBydW50aW1lICh0aGUgc2V0dGluZ3MgZHJvcGRvd24pLiAqL1xuICBzZXRMZXZlbChsZXZlbDogTG9nTGV2ZWwpOiB2b2lkO1xuICBnZXRMZXZlbCgpOiBMb2dMZXZlbDtcbiAgLyoqIFdoZXRoZXIgYGRlYnVnYCBjYWxscyBjdXJyZW50bHkgcGFzcyB0aGUgZ2F0ZSAocm91bmQtdHJpcCBsb2dnaW5nIGhvb2spLiAqL1xuICBnZXQgZGVidWdFbmFibGVkKCk6IGJvb2xlYW47XG4gIC8qKiBUaGUgbW9zdCByZWNlbnQgbGluZXMsIG9sZGVzdCBmaXJzdCAoYm91bmRlZCBieSB0aGUgY2FwYWNpdHkpLiAqL1xuICByZWNlbnRMaW5lcygpOiBzdHJpbmdbXTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBQbHVnaW5Mb2dPcHRpb25zIHtcbiAgLyoqIFJpbmcgY2FwYWNpdHkgKGRlZmF1bHQgMjApLiAqL1xuICBjYXBhY2l0eT86IG51bWJlcjtcbiAgLyoqIE1pbmltdW0gcmVjb3JkZWQgbGV2ZWwgKGRlZmF1bHQgJ2luZm8nKS4gKi9cbiAgbGV2ZWw/OiBMb2dMZXZlbDtcbiAgLyoqIFRpbWVzdGFtcCBzZWFtIChkZWZhdWx0IGBEYXRlLm5vd2ApLiAqL1xuICBub3c/OiAoKSA9PiBudW1iZXI7XG59XG5cbi8qKiBCdWlsZCB0aGUgcGx1Z2luJ3MgbG9nIGFkYXB0ZXI6IGNvbnNvbGUgbWlycm9yICsgYm91bmRlZCByaW5nIGJ1ZmZlci4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVQbHVnaW5Mb2cob3B0aW9uczogUGx1Z2luTG9nT3B0aW9ucyA9IHt9KTogUGx1Z2luTG9nIHtcbiAgY29uc3QgY2FwYWNpdHkgPSBvcHRpb25zLmNhcGFjaXR5ID8/IFJJTkdfQ0FQQUNJVFk7XG4gIGNvbnN0IG5vdyA9IG9wdGlvbnMubm93ID8/ICgoKSA9PiBEYXRlLm5vdygpKTtcbiAgbGV0IGxldmVsOiBMb2dMZXZlbCA9IG9wdGlvbnMubGV2ZWwgPz8gJ2luZm8nO1xuICBsZXQgcmluZzogc3RyaW5nW10gPSBbXTtcblxuICBjb25zdCB3cml0ZSA9IChzZXZlcml0eTogTG9nTGV2ZWwgfCAnZXJyb3InLCBhcmdzOiByZWFkb25seSB1bmtub3duW10pOiB2b2lkID0+IHtcbiAgICBpZiAoTEVWRUxfUkFOS1tzZXZlcml0eV0gPCBMRVZFTF9SQU5LW2xldmVsXSkgcmV0dXJuO1xuICAgIGNvbnN0IGxpbmUgPSBgJHtuZXcgRGF0ZShub3coKSkudG9JU09TdHJpbmcoKX0gWyR7c2V2ZXJpdHl9XSAke2FyZ3MubWFwKGZtdCkuam9pbignICcpfWA7XG4gICAgcmluZy5wdXNoKGxpbmUpO1xuICAgIGlmIChyaW5nLmxlbmd0aCA+IGNhcGFjaXR5KSByaW5nID0gcmluZy5zbGljZShyaW5nLmxlbmd0aCAtIGNhcGFjaXR5KTtcbiAgICBjb25zdCBzaW5rID1cbiAgICAgIHNldmVyaXR5ID09PSAnZXJyb3InID8gY29uc29sZS5lcnJvciA6IHNldmVyaXR5ID09PSAnd2FybicgPyBjb25zb2xlLndhcm4gOiBjb25zb2xlLmxvZztcbiAgICBzaW5rKCdbdnNhXScsIC4uLmFyZ3MpO1xuICB9O1xuXG4gIHJldHVybiB7XG4gICAgZGVidWc6ICguLi5hcmdzOiB1bmtub3duW10pID0+IHdyaXRlKCdkZWJ1ZycsIGFyZ3MpLFxuICAgIGluZm86ICguLi5hcmdzOiB1bmtub3duW10pID0+IHdyaXRlKCdpbmZvJywgYXJncyksXG4gICAgd2FybjogKC4uLmFyZ3M6IHVua25vd25bXSkgPT4gd3JpdGUoJ3dhcm4nLCBhcmdzKSxcbiAgICBlcnJvcjogKC4uLmFyZ3M6IHVua25vd25bXSkgPT4gd3JpdGUoJ2Vycm9yJywgYXJncyksXG4gICAgc2V0TGV2ZWwobmV4dDogTG9nTGV2ZWwpOiB2b2lkIHtcbiAgICAgIGxldmVsID0gbmV4dDtcbiAgICB9LFxuICAgIGdldExldmVsKCk6IExvZ0xldmVsIHtcbiAgICAgIHJldHVybiBsZXZlbDtcbiAgICB9LFxuICAgIGdldCBkZWJ1Z0VuYWJsZWQoKTogYm9vbGVhbiB7XG4gICAgICByZXR1cm4gbGV2ZWwgPT09ICdkZWJ1Zyc7XG4gICAgfSxcbiAgICByZWNlbnRMaW5lcygpOiBzdHJpbmdbXSB7XG4gICAgICByZXR1cm4gWy4uLnJpbmddO1xuICAgIH0sXG4gIH07XG59XG5cbi8qKiBPbmUgbG9nIGFyZ3VtZW50IFx1MjE5MiBjb21wYWN0IHRleHQgKHN0cmluZ3MgcGFzcyB0aHJvdWdoLCBsb25nIHZhbHVlcyB0cnVuY2F0ZWQpLiAqL1xuZnVuY3Rpb24gZm10KHZhbHVlOiB1bmtub3duKTogc3RyaW5nIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpIHJldHVybiB0cnVuY2F0ZSh2YWx1ZSk7XG4gIGlmICh2YWx1ZSBpbnN0YW5jZW9mIEVycm9yKSByZXR1cm4gdHJ1bmNhdGUoYCR7dmFsdWUubmFtZX06ICR7dmFsdWUubWVzc2FnZX1gKTtcbiAgdHJ5IHtcbiAgICByZXR1cm4gdHJ1bmNhdGUoSlNPTi5zdHJpbmdpZnkodmFsdWUpID8/IFN0cmluZyh2YWx1ZSkpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gU3RyaW5nKHZhbHVlKTtcbiAgfVxufVxuXG5mdW5jdGlvbiB0cnVuY2F0ZSh0ZXh0OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gdGV4dC5sZW5ndGggPD0gQVJHX01BWF9DSEFSUyA/IHRleHQgOiBgJHt0ZXh0LnNsaWNlKDAsIEFSR19NQVhfQ0hBUlMgLSAxKX1cdTIwMjZgO1xufVxuXG4vLyAtLS0gcHJvdG9jb2wgcm91bmQtdHJpcCBsb2dnaW5nIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogQ29tcGFjdCwgbG93LXZvbHVtZSBkZXNjcmlwdGlvbiBvZiBhIHdpcmUgZnJhbWUgKHR5cGUgKyBpZGVudGl0eSBrZXlzKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkZXNjcmliZU1lc3NhZ2UobWVzc2FnZToge1xuICB0eXBlOiBzdHJpbmc7XG4gIHBhdGg/OiBzdHJpbmc7XG4gIGhhc2g/OiBzdHJpbmc7XG4gIGZyb21QYXRoPzogc3RyaW5nO1xuICBjdXJzb3I/OiBudW1iZXI7XG4gIHNlcT86IG51bWJlcjtcbn0pOiBzdHJpbmcge1xuICBjb25zdCBiaXRzID0gW21lc3NhZ2UudHlwZV07XG4gIGlmIChtZXNzYWdlLmZyb21QYXRoICE9PSB1bmRlZmluZWQpIGJpdHMucHVzaChgJHttZXNzYWdlLmZyb21QYXRofSBcdTIxOTJgKTtcbiAgaWYgKG1lc3NhZ2UucGF0aCAhPT0gdW5kZWZpbmVkKSBiaXRzLnB1c2gobWVzc2FnZS5wYXRoKTtcbiAgaWYgKG1lc3NhZ2UuaGFzaCAhPT0gdW5kZWZpbmVkKSBiaXRzLnB1c2gobWVzc2FnZS5oYXNoLnNsaWNlKDAsIDEyKSk7XG4gIGlmIChtZXNzYWdlLnNlcSAhPT0gdW5kZWZpbmVkKSBiaXRzLnB1c2goYHNlcSAke21lc3NhZ2Uuc2VxfWApO1xuICBpZiAobWVzc2FnZS5jdXJzb3IgIT09IHVuZGVmaW5lZCkgYml0cy5wdXNoKGBjdXJzb3IgJHttZXNzYWdlLmN1cnNvcn1gKTtcbiAgcmV0dXJuIGJpdHMuam9pbignICcpO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFJvdW5kVHJpcExvZ2dpbmdPcHRpb25zIHtcbiAgbG9nOiBMb2dBZGFwdGVyO1xuICAvKiogQ2hlYXAgcHJlLWNoZWNrIHNvIHRoZSBzdHJpbmcgYnVpbGRpbmcgaXMgc2tpcHBlZCB1bmxlc3MgZGVidWcgaXMgb24uICovXG4gIHNob3VsZExvZzogKCkgPT4gYm9vbGVhbjtcbn1cblxuLyoqXG4gKiBXcmFwIGEgYFRyYW5zcG9ydGAgc28gZXZlcnkgc2VudC9yZWNlaXZlZCBmcmFtZSBpcyBsb2dnZWQgYXQgZGVidWcgbGV2ZWwgXHUyMDE0XG4gKiBvbmUgc2hvcnQgbGluZSBwZXIgZnJhbWUgKGBkZXNjcmliZU1lc3NhZ2VgKSwgbm90aGluZyBhdCBvdGhlciBsZXZlbHMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB3aXRoUm91bmRUcmlwTG9nZ2luZyhcbiAgdHJhbnNwb3J0OiBUcmFuc3BvcnQsXG4gIG9wdGlvbnM6IFJvdW5kVHJpcExvZ2dpbmdPcHRpb25zLFxuKTogVHJhbnNwb3J0IHtcbiAgY29uc3QgeyBsb2csIHNob3VsZExvZyB9ID0gb3B0aW9ucztcbiAgcmV0dXJuIHtcbiAgICBzZW5kOiAobWVzc2FnZSkgPT4ge1xuICAgICAgaWYgKHNob3VsZExvZygpKSBsb2cuZGVidWcoJ1x1MjE5MicsIGRlc2NyaWJlTWVzc2FnZShtZXNzYWdlKSk7XG4gICAgICB0cmFuc3BvcnQuc2VuZChtZXNzYWdlKTtcbiAgICB9LFxuICAgIG9uTWVzc2FnZTogKGNhbGxiYWNrKSA9PiB7XG4gICAgICB0cmFuc3BvcnQub25NZXNzYWdlKChtZXNzYWdlKSA9PiB7XG4gICAgICAgIGlmIChzaG91bGRMb2coKSkgbG9nLmRlYnVnKCdcdTIxOTAnLCBkZXNjcmliZU1lc3NhZ2UobWVzc2FnZSkpO1xuICAgICAgICBjYWxsYmFjayhtZXNzYWdlKTtcbiAgICAgIH0pO1xuICAgIH0sXG4gICAgb25DbG9zZTogKGNhbGxiYWNrKSA9PiB0cmFuc3BvcnQub25DbG9zZShjYWxsYmFjayksXG4gICAgY2xvc2U6ICgpID0+IHRyYW5zcG9ydC5jbG9zZSgpLFxuICB9O1xufVxuXG4vLyAtLS0gdGhlIGJ1bmRsZSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIERpYWdub3N0aWNzSW5wdXQge1xuICBwbHVnaW5WZXJzaW9uOiBzdHJpbmc7XG4gIGRldmljZUlkOiBzdHJpbmc7XG4gIGRldmljZU5hbWU6IHN0cmluZztcbiAgd29ya2VyVXJsOiBzdHJpbmc7XG4gIHBhaXJlZDogYm9vbGVhbjtcbiAgcGF1c2VkOiBib29sZWFuO1xuICBjbGllbnRTdGF0dXM6IFN5bmNDbGllbnRTdGF0dXMgfCBudWxsO1xuICByZWNlbnRMb2dMaW5lczogcmVhZG9ubHkgc3RyaW5nW107XG4gIC8qKiBXb3JrZXItcmVwb3J0ZWQgdmVyc2lvbiAobnVsbCB1bnRpbCBhIGxhdGVyIGNoYW5nZSBwb3B1bGF0ZXMgaXQpLiAqL1xuICBzZXJ2ZXJWZXJzaW9uPzogc3RyaW5nIHwgbnVsbDtcbiAgLyoqIENsaWVudC1zaWRlIHNldHRpbmdzIChub25lIGFyZSBzZWNyZXQgXHUyMDE0IGFsbCBmaWVsZHMgcmVuZGVyIHZlcmJhdGltKS4gKi9cbiAgc2V0dGluZ3M/OiBQbHVnaW5TeW5jU2V0dGluZ3M7XG4gIC8qKlxuICAgKiBDb25mbGljdCBwYXRocyBmb3IgdGhlIHN1cHBvcnQgYnVuZGxlLCBkZXJpdmVkIGZyb21cbiAgICogYGNsaWVudFN0YXR1cy5jb25mbGljdHNgIFx1MjAxNCBQQVRIUyBPTkxZLCBuZXZlciBmaWxlIGNvbnRlbnQuXG4gICAqL1xuICByZWNlbnRDb25mbGljdHM/OiBBcnJheTx7IHBhdGg6IHN0cmluZyB9Pjtcbn1cblxuLyoqIFRoZSBwcm90b2NvbCB2ZXJzaW9uIGZyb20gY29yZSwgc3VyZmFjZWQgZm9yIHRoZSBidW5kbGUvQWJvdXQgc2VjdGlvbi4gKi9cbmV4cG9ydCBjb25zdCBQUk9UT0NPTF9WRVJTSU9OID0gUHJvdG9jb2xWZXJzaW9uO1xuXG4vKiogVGhlIGNvcHlhYmxlIGRpYWdub3N0aWNzIGJ1bmRsZSAocGxhaW4gdGV4dCwgYnVnLXJlcG9ydCBmcmllbmRseSkuICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGREaWFnbm9zdGljc0J1bmRsZShpbnB1dDogRGlhZ25vc3RpY3NJbnB1dCk6IHN0cmluZyB7XG4gIGNvbnN0IHN0YXR1cyA9IGlucHV0LmNsaWVudFN0YXR1cztcbiAgY29uc3QgbGluZXM6IHN0cmluZ1tdID0gW1xuICAgICdWYXVsdFN5bmMgZm9yIEFnZW50cyBcdTIwMTQgZGlhZ25vc3RpY3MnLFxuICAgIGBQbHVnaW4gdmVyc2lvbjogJHtpbnB1dC5wbHVnaW5WZXJzaW9ufWAsXG4gICAgYFByb3RvY29sIHZlcnNpb246ICR7UHJvdG9jb2xWZXJzaW9ufWAsXG4gICAgYERldmljZTogJHtpbnB1dC5kZXZpY2VJZCB8fCAnKHVuYXNzaWduZWQpJ30ke2lucHV0LmRldmljZU5hbWUgPyBgICgke2lucHV0LmRldmljZU5hbWV9KWAgOiAnJ31gLFxuICAgIGBXb3JrZXI6ICR7aW5wdXQud29ya2VyVXJsIHx8ICcobm90IGNvbmZpZ3VyZWQpJ31gLFxuICAgIGBQYWlyaW5nOiAke2lucHV0LnBhaXJlZCA/ICdwYWlyZWQnIDogJ25vdCBwYWlyZWQnfWAsXG4gICAgaW5wdXQucGF1c2VkXG4gICAgICA/ICdTeW5jOiBwYXVzZWQnXG4gICAgICA6IHN0YXR1cyA9PT0gbnVsbFxuICAgICAgICA/ICdTeW5jOiBub3QgcnVubmluZydcbiAgICAgICAgOiBgU3luYzogJHtzdGF0dXMuc3RhdGV9LCBsYXN0IHN5bmMgJHtcbiAgICAgICAgICAgIHN0YXR1cy5sYXN0U3luY0F0ID09PSBudWxsID8gJ25ldmVyJyA6IGAke01hdGgubWF4KDAsIERhdGUubm93KCkgLSBzdGF0dXMubGFzdFN5bmNBdCl9bXMgYWdvYFxuICAgICAgICAgIH0sIHBlbmRpbmcgJHtzdGF0dXMucGVuZGluZ30sIGNvbmZsaWN0cyAke3N0YXR1cy5jb25mbGljdHMubGVuZ3RofWAsXG4gICAgYFBsYXRmb3JtOiAke3BsYXRmb3JtU3VtbWFyeSgpfWAsXG4gICAgYFJlY2VudCBsb2cgKGxhc3QgJHtpbnB1dC5yZWNlbnRMb2dMaW5lcy5sZW5ndGh9IGxpbmVzKTpgLFxuICBdO1xuICBpZiAoaW5wdXQucmVjZW50TG9nTGluZXMubGVuZ3RoID09PSAwKSB7XG4gICAgbGluZXMucHVzaCgnICAobm8gcmVjb3JkZWQgbG9nIGxpbmVzKScpO1xuICB9IGVsc2Uge1xuICAgIGZvciAoY29uc3QgbGluZSBvZiBpbnB1dC5yZWNlbnRMb2dMaW5lcykgbGluZXMucHVzaChgICAke2xpbmV9YCk7XG4gIH1cbiAgcmV0dXJuIGxpbmVzLmpvaW4oJ1xcbicpO1xufVxuXG4vKiogRXBvY2ggbXMgXHUyMTkyIGAyMDI2MDgyMS0xNDMwMDVgIChsb2NhbCB0aW1lKSBmb3Igc3VwcG9ydC1idW5kbGUgZmlsZSBuYW1lcy4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRTdXBwb3J0QnVuZGxlU3RhbXAobm93OiBudW1iZXIpOiBzdHJpbmcge1xuICBjb25zdCBkID0gbmV3IERhdGUobm93KTtcbiAgY29uc3QgdHdvID0gKG46IG51bWJlcik6IHN0cmluZyA9PiBTdHJpbmcobikucGFkU3RhcnQoMiwgJzAnKTtcbiAgcmV0dXJuIChcbiAgICBgJHtkLmdldEZ1bGxZZWFyKCl9JHt0d28oZC5nZXRNb250aCgpICsgMSl9JHt0d28oZC5nZXREYXRlKCkpfWAgK1xuICAgIGAtJHt0d28oZC5nZXRIb3VycygpKX0ke3R3byhkLmdldE1pbnV0ZXMoKSl9JHt0d28oZC5nZXRTZWNvbmRzKCkpfWBcbiAgKTtcbn1cblxuY29uc3Qgb25PZmYgPSAodmFsdWU6IGJvb2xlYW4pOiBzdHJpbmcgPT4gKHZhbHVlID8gJ29uJyA6ICdvZmYnKTtcblxuLyoqXG4gKiBUaGUgXCJTYXZlIHN1cHBvcnQgYnVuZGxlXCIgbWFya2Rvd24uIFJlZGFjdGlvbiBjb250cmFjdDogdGhlIGRldmljZSB0b2tlblxuICogbmV2ZXIgYXBwZWFycyAodGhlIGlucHV0IHN0cnVjdHVyYWxseSBjYW5ub3QgY2FycnkgaXQpLCBhbmQgZmlsZXNcbiAqIGNvbnRyaWJ1dGUgdmF1bHQtcmVsYXRpdmUgUEFUSFMgT05MWSBcdTIwMTQgbmV2ZXIgY29udGVudC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkU3VwcG9ydEJ1bmRsZShpbnB1dDogRGlhZ25vc3RpY3NJbnB1dCwgbm93OiBudW1iZXIpOiBzdHJpbmcge1xuICBjb25zdCBzdGF0dXMgPSBpbnB1dC5jbGllbnRTdGF0dXM7XG4gIC8vIENvbmZsaWN0cyByZW5kZXIgYXMgcGF0aHMgb25seTsgYHJlY2VudENvbmZsaWN0c2AgKHByZS1yZWRhY3RlZCBieSB0aGVcbiAgLy8gY2FsbGVyKSB3aW5zIHdoZW4gcHJlc2VudCwgZWxzZSBwYXRocyBhcmUgZGVyaXZlZCBmcm9tIHRoZSBzdGF0dXMuXG4gIGNvbnN0IGNvbmZsaWN0UGF0aHMgPVxuICAgIGlucHV0LnJlY2VudENvbmZsaWN0cz8ubWFwKChjKSA9PiBjLnBhdGgpID8/IHN0YXR1cz8uY29uZmxpY3RzLm1hcCgoYykgPT4gYy5wYXRoKSA/PyBbXTtcblxuICBjb25zdCBsaW5lczogc3RyaW5nW10gPSBbXG4gICAgJyMgVmF1bHRTeW5jIGZvciBBZ2VudHMgXHUyMDE0IHN1cHBvcnQgYnVuZGxlJyxcbiAgICAnJyxcbiAgICBgR2VuZXJhdGVkOiAke25ldyBEYXRlKG5vdykudG9JU09TdHJpbmcoKX1gLFxuICAgICcnLFxuICAgICcjIyBWZXJzaW9ucycsXG4gICAgJycsXG4gICAgYC0gUGx1Z2luOiAke2lucHV0LnBsdWdpblZlcnNpb259YCxcbiAgICBgLSBQcm90b2NvbDogJHtQcm90b2NvbFZlcnNpb259YCxcbiAgICBgLSBTZXJ2ZXI6ICR7aW5wdXQuc2VydmVyVmVyc2lvbiA/PyAndW5rbm93bid9YCxcbiAgICBgLSBQbGF0Zm9ybTogJHtwbGF0Zm9ybVN1bW1hcnkoKX1gLFxuICAgICcnLFxuICAgICcjIyBDb25uZWN0aW9uJyxcbiAgICAnJyxcbiAgICBgLSBXb3JrZXIgVVJMOiAke2lucHV0LndvcmtlclVybCB8fCAnKG5vdCBjb25maWd1cmVkKSd9YCxcbiAgICBgLSBEZXZpY2UgSUQ6ICR7aW5wdXQuZGV2aWNlSWQgfHwgJyh1bmFzc2lnbmVkKSd9YCxcbiAgICBgLSBEZXZpY2UgbmFtZTogJHtpbnB1dC5kZXZpY2VOYW1lIHx8ICcoZGVmYXVsdCknfWAsXG4gICAgYC0gUGFpcmluZzogJHtpbnB1dC5wYWlyZWQgPyAncGFpcmVkJyA6ICdub3QgcGFpcmVkJ31gLFxuICAgIGAtIFN5bmNpbmc6ICR7aW5wdXQucGF1c2VkID8gJ3BhdXNlZCcgOiAnYWN0aXZlJ31gLFxuICBdO1xuXG4gIGlmIChpbnB1dC5zZXR0aW5ncyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgY29uc3QgeyBzZXR0aW5ncyB9ID0gaW5wdXQ7XG4gICAgY29uc3QgcGF0dGVybnMgPSBzZXR0aW5ncy5pZ25vcmVQYXR0ZXJuc1xuICAgICAgLnNwbGl0KC9cXHI/XFxuLylcbiAgICAgIC5tYXAoKGxpbmUpID0+IGxpbmUudHJpbSgpKVxuICAgICAgLmZpbHRlcigobGluZSkgPT4gbGluZSAhPT0gJycpO1xuICAgIGxpbmVzLnB1c2goJycsICcjIyBTZXR0aW5ncycsICcnLCBgLSBSZXNjYW4gaW50ZXJ2YWw6ICR7c2V0dGluZ3MucmVzY2FuSW50ZXJ2YWxTZWMgPT09IDAgPyAnb2ZmJyA6IGAke3NldHRpbmdzLnJlc2NhbkludGVydmFsU2VjfSBzZWNvbmRzYH1gLCBgLSBTeW5jIC5vYnNpZGlhbi8gZm9sZGVyOiAke29uT2ZmKHNldHRpbmdzLm9ic2lkaWFuU3luYyl9YCwgYC0gU3RhdHVzIGJhciBpbmRpY2F0b3I6ICR7c2V0dGluZ3Muc3RhdHVzQmFyTW9kZX1gLCBgLSBTeW5jIG9uIHN0YXJ0dXA6ICR7b25PZmYoc2V0dGluZ3Muc3luY09uU3RhcnR1cCl9YCwgYC0gRGlhZ25vc3RpY3MgbG9nIGxldmVsOiAke3NldHRpbmdzLmxvZ0xldmVsfWApO1xuICAgIGlmIChwYXR0ZXJucy5sZW5ndGggPT09IDApIHtcbiAgICAgIGxpbmVzLnB1c2goJy0gSWdub3JlIHBhdHRlcm5zOiAobm9uZSknKTtcbiAgICB9IGVsc2Uge1xuICAgICAgbGluZXMucHVzaCgnLSBJZ25vcmUgcGF0dGVybnM6Jyk7XG4gICAgICBmb3IgKGNvbnN0IHBhdHRlcm4gb2YgcGF0dGVybnMpIGxpbmVzLnB1c2goYCAgJHtwYXR0ZXJufWApO1xuICAgIH1cbiAgfVxuXG4gIGxpbmVzLnB1c2goJycsICcjIyBTeW5jIHN0YXRlJywgJycpO1xuICBpZiAoaW5wdXQucGF1c2VkKSBsaW5lcy5wdXNoKCctIFN0YXRlOiBwYXVzZWQnKTtcbiAgZWxzZSBpZiAoc3RhdHVzID09PSBudWxsKSBsaW5lcy5wdXNoKCctIFN0YXRlOiBub3QgcnVubmluZycpO1xuICBlbHNlIGxpbmVzLnB1c2goYC0gU3RhdGU6ICR7c3RhdHVzLnN0YXRlfWApO1xuICBpZiAoc3RhdHVzICE9PSBudWxsKSB7XG4gICAgbGluZXMucHVzaChcbiAgICAgIGAtIExhc3Qgc3luYzogJHtzdGF0dXMubGFzdFN5bmNBdCA9PT0gbnVsbCA/ICduZXZlcicgOiBuZXcgRGF0ZShzdGF0dXMubGFzdFN5bmNBdCkudG9JU09TdHJpbmcoKX1gLFxuICAgICAgYC0gUGVuZGluZyBjaGFuZ2VzOiAke3N0YXR1cy5wZW5kaW5nfWAsXG4gICAgICBgLSBDb25mbGljdHM6ICR7Y29uZmxpY3RQYXRocy5sZW5ndGh9YCxcbiAgICApO1xuICAgIGZvciAoY29uc3QgcGF0aCBvZiBjb25mbGljdFBhdGhzKSBsaW5lcy5wdXNoKGAgIC0gJHtwYXRofWApO1xuICAgIGNvbnN0IGNvbGxpc2lvbnMgPSBzdGF0dXMuY2FzZUNvbGxpc2lvbnMgPz8gW107XG4gICAgaWYgKGNvbGxpc2lvbnMubGVuZ3RoID4gMCkge1xuICAgICAgbGluZXMucHVzaChgLSBDYXNlLWNvbGxpZGluZyBwYXRocyAoaW52aXNpYmxlIHR3aW4gb24gdGhpcyBmaWxlc3lzdGVtKTogJHtjb2xsaXNpb25zLmxlbmd0aH1gKTtcbiAgICAgIGZvciAoY29uc3QgcGF0aCBvZiBjb2xsaXNpb25zKSBsaW5lcy5wdXNoKGAgIC0gJHtwYXRofWApO1xuICAgIH1cbiAgICBpZiAoc3RhdHVzLnByb2dyZXNzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGxpbmVzLnB1c2goYC0gUHJvZ3Jlc3M6ICR7c3RhdHVzLnByb2dyZXNzLnBoYXNlfSAke3N0YXR1cy5wcm9ncmVzcy5kb25lfS8ke3N0YXR1cy5wcm9ncmVzcy50b3RhbH1gKTtcbiAgICB9XG4gIH1cblxuICBsaW5lcy5wdXNoKCcnLCBgIyMgUmVjZW50IGxvZyAobGFzdCAke2lucHV0LnJlY2VudExvZ0xpbmVzLmxlbmd0aH0gbGluZXMpYCwgJycpO1xuICBpZiAoaW5wdXQucmVjZW50TG9nTGluZXMubGVuZ3RoID09PSAwKSB7XG4gICAgbGluZXMucHVzaCgnKG5vIHJlY29yZGVkIGxvZyBsaW5lcyknKTtcbiAgfSBlbHNlIHtcbiAgICBsaW5lcy5wdXNoKCdgYGB0ZXh0Jyk7XG4gICAgbGluZXMucHVzaCguLi5pbnB1dC5yZWNlbnRMb2dMaW5lcyk7XG4gICAgbGluZXMucHVzaCgnYGBgJyk7XG4gIH1cbiAgcmV0dXJuIGAke2xpbmVzLmpvaW4oJ1xcbicpfVxcbmA7XG59XG5cbi8qKiBIdW1hbiBwbGF0Zm9ybSBzdW1tYXJ5IGZyb20gYFBsYXRmb3JtYCAobW9iaWxlIHZzIGRlc2t0b3AsIE9TLCBmb3JtIGZhY3RvcikuICovXG5leHBvcnQgZnVuY3Rpb24gcGxhdGZvcm1TdW1tYXJ5KCk6IHN0cmluZyB7XG4gIGlmIChQbGF0Zm9ybS5pc01vYmlsZUFwcCkge1xuICAgIGNvbnN0IG9zID0gUGxhdGZvcm0uaXNJb3NBcHAgPyAnaU9TJyA6IFBsYXRmb3JtLmlzQW5kcm9pZEFwcCA/ICdBbmRyb2lkJyA6ICd1bmtub3duIE9TJztcbiAgICBjb25zdCBmYWN0b3IgPSBQbGF0Zm9ybS5pc1RhYmxldCA/ICd0YWJsZXQnIDogUGxhdGZvcm0uaXNQaG9uZSA/ICdwaG9uZScgOiAnZGV2aWNlJztcbiAgICByZXR1cm4gYE9ic2lkaWFuIG1vYmlsZSBhcHAgKCR7b3N9LCAke2ZhY3Rvcn0pYDtcbiAgfVxuICByZXR1cm4gJ09ic2lkaWFuIGRlc2t0b3AgYXBwJztcbn1cblxuLyoqIEJlc3QtZWZmb3J0IGNsaXBib2FyZCB3cml0ZTsgcmVzb2x2ZXMgZmFsc2Ugd2hlcmUgdGhlIGNsaXBib2FyZCBpcyB1bmF2YWlsYWJsZS4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjb3B5VG9DbGlwYm9hcmQodGV4dDogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XG4gIGNvbnN0IGNsaXBib2FyZCA9IChnbG9iYWxUaGlzIGFzIHsgbmF2aWdhdG9yPzogeyBjbGlwYm9hcmQ/OiB7IHdyaXRlVGV4dD8odDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB9IH0gfSlcbiAgICAubmF2aWdhdG9yPy5jbGlwYm9hcmQ7XG4gIGlmIChjbGlwYm9hcmQ/LndyaXRlVGV4dCA9PT0gdW5kZWZpbmVkKSByZXR1cm4gZmFsc2U7XG4gIHRyeSB7XG4gICAgYXdhaXQgY2xpcGJvYXJkLndyaXRlVGV4dCh0ZXh0KTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbi8qKiBCeXRlcyBcdTIxOTIgaHVtYW4gdGV4dCAoYDczMCBCYCwgYDEuMiBNQmApLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdEJ5dGVzKGJ5dGVzOiBudW1iZXIpOiBzdHJpbmcge1xuICBpZiAoYnl0ZXMgPCAxMDI0KSByZXR1cm4gYCR7Ynl0ZXN9IEJgO1xuICBjb25zdCB1bml0cyA9IFsnS0InLCAnTUInLCAnR0InLCAnVEInXTtcbiAgbGV0IHZhbHVlID0gYnl0ZXM7XG4gIGxldCB1bml0ID0gLTE7XG4gIGRvIHtcbiAgICB2YWx1ZSAvPSAxMDI0O1xuICAgIHVuaXQgKz0gMTtcbiAgfSB3aGlsZSAodmFsdWUgPj0gMTAyNCAmJiB1bml0IDwgdW5pdHMubGVuZ3RoIC0gMSk7XG4gIHJldHVybiBgJHt2YWx1ZSA+PSAxMDAgPyBNYXRoLnJvdW5kKHZhbHVlKSA6IHZhbHVlLnRvRml4ZWQoMSl9ICR7dW5pdHNbdW5pdF19YDtcbn1cbiIsICIvKipcbiAqIFRoZSBwbHVnaW4ncyBwZXJzaXN0ZWQgc3RhdGUgKGBkYXRhLmpzb25gLCB2aWEgYFBsdWdpbi5sb2FkRGF0YS9zYXZlRGF0YWApLlxuICpcbiAqIEtlcHQgZGVsaWJlcmF0ZWx5IHNtYWxsOiBsaW5rIGlkZW50aXR5ICh1cmwvdG9rZW4vZGV2aWNlSWQvZGV2aWNlTmFtZSkgcGx1c1xuICogdGhlIHR3byBjbGllbnQtc2lkZSB0b2dnbGVzLiBUaGUgdG9rZW4gaXMgdGhlIGRldmljZSdzIGxvbmctbGl2ZWRcbiAqIGNyZWRlbnRpYWwgKEFSQ0hJVEVDVFVSRSBcdTAwQTczKSBcdTIwMTQgT2JzaWRpYW4gc3RvcmVzIGRhdGEuanNvbiBpbnNpZGUgdGhlIHZhdWx0J3NcbiAqIGAub2JzaWRpYW4vcGx1Z2lucy9gIGRpciwgd2hpY2ggc3luYyBleGNsdWRlcywgc28gaXQgbmV2ZXIgbGVhdmVzIHRoZVxuICogbWFjaGluZSB0aHJvdWdoIHN5bmMgaXRzZWxmLlxuICovXG5cbmltcG9ydCB7IFBsYXRmb3JtIH0gZnJvbSAnb2JzaWRpYW4nO1xuaW1wb3J0IHR5cGUgeyBTdGF0dXNCYXJNb2RlIH0gZnJvbSAnLi9zdGF0dXNiYXIuanMnO1xuXG4vKiogRGlhZ25vc3RpY3MgbG9nIGxldmVsICh0aGUgXCJEaWFnbm9zdGljc1wiIHNldHRpbmdzIGRyb3Bkb3duKS4gKi9cbmV4cG9ydCB0eXBlIExvZ0xldmVsID0gJ2luZm8nIHwgJ2RlYnVnJyB8ICd3YXJuJztcblxuLyoqIENsaWVudC1zaWRlIHN5bmMgYmVoYXZpb3Igc2V0dGluZ3MgKHRoZSBzZXR0aW5ncy10YWIgdG9nZ2xlcykuICovXG5leHBvcnQgaW50ZXJmYWNlIFBsdWdpblN5bmNTZXR0aW5ncyB7XG4gIC8qKlxuICAgKiBQZXJpb2RpYyBmdWxsLXJlc2NhbiBpbnRlcnZhbCBpbiBzZWNvbmRzIChBUkNISVRFQ1RVUkUgXHUwMEE3OCBtb2JpbGUgL1xuICAgKiBleHRlcm5hbCBlZGl0cykuIGAwYCBkaXNhYmxlcyB0aGUgdGltZXIgXHUyMDE0IHZhdWx0IGV2ZW50cyBhbmQgYXBwLW9wZW5cbiAgICogcmVjb25jaWxpYXRpb24gc3RpbGwgcnVuLlxuICAgKi9cbiAgcmVzY2FuSW50ZXJ2YWxTZWM6IG51bWJlcjtcbiAgLyoqXG4gICAqIE9wdCBpbiB0byBzeW5jaW5nIGAub2JzaWRpYW4vYCAoRlItMTEpLiBUaGlzIGlzIHRoZSBjbGllbnQtc2lkZSBpbml0aWFsXG4gICAqIGlnbm9yZSBzZXR0aW5nOyB0aGUgd29ya2VyJ3MgcGVyLXZhdWx0IGBWYXVsdFNldHRpbmdzLm9ic2lkaWFuU3luY2BcbiAgICogKGRlbGl2ZXJlZCBpbiBgaGVsbG9BY2tgKSBzdXBlcnNlZGVzIGl0IG9uY2UgY29ubmVjdGVkLlxuICAgKi9cbiAgb2JzaWRpYW5TeW5jOiBib29sZWFuO1xuICAvKiogU3RhdHVzLWJhciBpbmRpY2F0b3I6IGZ1bGwgdGV4dCwgYSBjb21wYWN0IHN5bWJvbCwgb3Igbm8gaXRlbSBhdCBhbGwuICovXG4gIHN0YXR1c0Jhck1vZGU6IFN0YXR1c0Jhck1vZGU7XG4gIC8qKlxuICAgKiBTdGFydCBzeW5jaW5nIHdoZW4gT2JzaWRpYW4gbG9hZHMgKGRlZmF1bHQpLiBPRkYgPSBtYW51YWwtb25seSBtb2RlOiB0aGVcbiAgICogcGx1Z2luIGxvYWRzIGlkbGUgYW5kIHRoZSBmaXJzdCBcIlN5bmMgbm93XCIgc3RhcnRzIGl0LlxuICAgKi9cbiAgc3luY09uU3RhcnR1cDogYm9vbGVhbjtcbiAgLyoqIERpYWdub3N0aWNzIGxvZyBsZXZlbDsgYGRlYnVnYCBhbHNvIGxvZ3MgcHJvdG9jb2wgcm91bmQtdHJpcHMuICovXG4gIGxvZ0xldmVsOiBMb2dMZXZlbDtcbiAgLyoqIFJhdyBpZ25vcmUtcGF0dGVybiB0ZXh0LCBvbmUgcGF0dGVybiBwZXIgbGluZSAoc2VlIGBwYXJzZUlnbm9yZVBhdHRlcm5zYCkuICovXG4gIGlnbm9yZVBhdHRlcm5zOiBzdHJpbmc7XG59XG5cbi8qKiBTaGFwZSBvZiB0aGUgcGx1Z2luJ3MgYGRhdGEuanNvbmAuICovXG5leHBvcnQgaW50ZXJmYWNlIFZhdWx0U3luY1BsdWdpbkRhdGEge1xuICAvKiogV29ya2VyIG9yaWdpbiwgZS5nLiBgaHR0cHM6Ly9wZXJzb25hbC54LndvcmtlcnMuZGV2YCAoZW1wdHkgcHJlLXBhaXIpLiAqL1xuICB1cmw6IHN0cmluZztcbiAgLyoqIExvbmctbGl2ZWQgZGV2aWNlIHRva2VuIChlbXB0eSBwcmUtcGFpcikuICovXG4gIHRva2VuOiBzdHJpbmc7XG4gIC8qKiBEZXZpY2UgaWQgYXNzaWduZWQgYnkgdGhlIHdvcmtlciBhdCBwYWlyIHRpbWUuICovXG4gIGRldmljZUlkOiBzdHJpbmc7XG4gIC8qKiBIdW1hbi1yZWFkYWJsZSBkZXZpY2UgbmFtZSBzaG93biBpbiB0aGUgZGFzaGJvYXJkJ3MgZGV2aWNlIGxpc3QuICovXG4gIGRldmljZU5hbWU6IHN0cmluZztcbiAgc2V0dGluZ3M6IFBsdWdpblN5bmNTZXR0aW5ncztcbn1cblxuZXhwb3J0IGNvbnN0IERFRkFVTFRfUkVTQ0FOX0lOVEVSVkFMX1NFQyA9IDMwO1xuXG4vKiogQ2hvaWNlcyBvZmZlcmVkIGJ5IHRoZSBzZXR0aW5ncyBkcm9wZG93bjogc2Vjb25kcyBcdTIxOTIgbGFiZWwuICovXG5leHBvcnQgY29uc3QgUkVTQ0FOX0lOVEVSVkFMX0NIT0lDRVM6IFJlYWRvbmx5QXJyYXk8eyB2YWx1ZTogbnVtYmVyOyBsYWJlbDogc3RyaW5nIH0+ID0gW1xuICB7IHZhbHVlOiAxMCwgbGFiZWw6ICdFdmVyeSAxMCBzZWNvbmRzJyB9LFxuICB7IHZhbHVlOiAzMCwgbGFiZWw6ICdFdmVyeSAzMCBzZWNvbmRzJyB9LFxuICB7IHZhbHVlOiA2MCwgbGFiZWw6ICdFdmVyeSBtaW51dGUnIH0sXG4gIHsgdmFsdWU6IDMwMCwgbGFiZWw6ICdFdmVyeSA1IG1pbnV0ZXMnIH0sXG4gIHsgdmFsdWU6IDAsIGxhYmVsOiAnT2ZmICh2YXVsdCBldmVudHMgb25seSknIH0sXG5dO1xuXG5leHBvcnQgZnVuY3Rpb24gZGVmYXVsdFBsdWdpbkRhdGEoKTogVmF1bHRTeW5jUGx1Z2luRGF0YSB7XG4gIHJldHVybiB7XG4gICAgdXJsOiAnJyxcbiAgICB0b2tlbjogJycsXG4gICAgZGV2aWNlSWQ6ICcnLFxuICAgIGRldmljZU5hbWU6ICcnLFxuICAgIHNldHRpbmdzOiB7XG4gICAgICByZXNjYW5JbnRlcnZhbFNlYzogREVGQVVMVF9SRVNDQU5fSU5URVJWQUxfU0VDLFxuICAgICAgb2JzaWRpYW5TeW5jOiBmYWxzZSxcbiAgICAgIHN0YXR1c0Jhck1vZGU6ICdkZXRhaWxlZCcsXG4gICAgICBzeW5jT25TdGFydHVwOiB0cnVlLFxuICAgICAgbG9nTGV2ZWw6ICdpbmZvJyxcbiAgICAgIGlnbm9yZVBhdHRlcm5zOiAnJyxcbiAgICB9LFxuICB9O1xufVxuXG4vKiogQ29lcmNlIHdoYXRldmVyIGBsb2FkRGF0YSgpYCByZXR1cm5lZCBpbnRvIGEgd2VsbC1mb3JtZWQgb2JqZWN0LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZVBsdWdpbkRhdGEocmF3OiB1bmtub3duKTogVmF1bHRTeW5jUGx1Z2luRGF0YSB7XG4gIGNvbnN0IGJhc2UgPSBkZWZhdWx0UGx1Z2luRGF0YSgpO1xuICBpZiAodHlwZW9mIHJhdyAhPT0gJ29iamVjdCcgfHwgcmF3ID09PSBudWxsKSByZXR1cm4gYmFzZTtcbiAgY29uc3Qgc291cmNlID0gcmF3IGFzIFBhcnRpYWw8VmF1bHRTeW5jUGx1Z2luRGF0YT4gJiB7IHNldHRpbmdzPzogUGFydGlhbDxQbHVnaW5TeW5jU2V0dGluZ3M+IH07XG4gIGNvbnN0IHN0YXR1c0Jhck1vZGUgPSBzb3VyY2Uuc2V0dGluZ3M/LnN0YXR1c0Jhck1vZGU7XG4gIGNvbnN0IGxvZ0xldmVsID0gc291cmNlLnNldHRpbmdzPy5sb2dMZXZlbDtcbiAgcmV0dXJuIHtcbiAgICB1cmw6IHR5cGVvZiBzb3VyY2UudXJsID09PSAnc3RyaW5nJyA/IHNvdXJjZS51cmwgOiAnJyxcbiAgICB0b2tlbjogdHlwZW9mIHNvdXJjZS50b2tlbiA9PT0gJ3N0cmluZycgPyBzb3VyY2UudG9rZW4gOiAnJyxcbiAgICBkZXZpY2VJZDogdHlwZW9mIHNvdXJjZS5kZXZpY2VJZCA9PT0gJ3N0cmluZycgPyBzb3VyY2UuZGV2aWNlSWQgOiAnJyxcbiAgICBkZXZpY2VOYW1lOiB0eXBlb2Ygc291cmNlLmRldmljZU5hbWUgPT09ICdzdHJpbmcnID8gc291cmNlLmRldmljZU5hbWUgOiAnJyxcbiAgICBzZXR0aW5nczoge1xuICAgICAgcmVzY2FuSW50ZXJ2YWxTZWM6XG4gICAgICAgIHR5cGVvZiBzb3VyY2Uuc2V0dGluZ3M/LnJlc2NhbkludGVydmFsU2VjID09PSAnbnVtYmVyJyAmJiBzb3VyY2Uuc2V0dGluZ3MucmVzY2FuSW50ZXJ2YWxTZWMgPj0gMFxuICAgICAgICAgID8gTWF0aC5mbG9vcihzb3VyY2Uuc2V0dGluZ3MucmVzY2FuSW50ZXJ2YWxTZWMpXG4gICAgICAgICAgOiBERUZBVUxUX1JFU0NBTl9JTlRFUlZBTF9TRUMsXG4gICAgICBvYnNpZGlhblN5bmM6IHNvdXJjZS5zZXR0aW5ncz8ub2JzaWRpYW5TeW5jID09PSB0cnVlLFxuICAgICAgc3RhdHVzQmFyTW9kZTpcbiAgICAgICAgc3RhdHVzQmFyTW9kZSA9PT0gJ2NvbXBhY3QnIHx8IHN0YXR1c0Jhck1vZGUgPT09ICdoaWRkZW4nID8gc3RhdHVzQmFyTW9kZSA6ICdkZXRhaWxlZCcsXG4gICAgICBzeW5jT25TdGFydHVwOiBzb3VyY2Uuc2V0dGluZ3M/LnN5bmNPblN0YXJ0dXAgIT09IGZhbHNlLFxuICAgICAgbG9nTGV2ZWw6IGxvZ0xldmVsID09PSAnZGVidWcnIHx8IGxvZ0xldmVsID09PSAnd2FybicgPyBsb2dMZXZlbCA6ICdpbmZvJyxcbiAgICAgIGlnbm9yZVBhdHRlcm5zOiB0eXBlb2Ygc291cmNlLnNldHRpbmdzPy5pZ25vcmVQYXR0ZXJucyA9PT0gJ3N0cmluZycgPyBzb3VyY2Uuc2V0dGluZ3MuaWdub3JlUGF0dGVybnMgOiAnJyxcbiAgICB9LFxuICB9O1xufVxuXG4vKipcbiAqIElnbm9yZS1wYXR0ZXJuIHRleHQgXHUyMTkyIHBhdHRlcm4gbGlzdDogb25lIHBhdHRlcm4gcGVyIGxpbmUsIHRyaW1tZWQsIGJsYW5rXG4gKiBsaW5lcyBkcm9wcGVkLiBQdXJlIFx1MjAxNCBzYWZlIHRvIGNhbGwgb24gZXZlcnkgYHN0YXJ0U3luY2AuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUlnbm9yZVBhdHRlcm5zKHRleHQ6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgcmV0dXJuIHRleHRcbiAgICAuc3BsaXQoL1xccj9cXG4vKVxuICAgIC5tYXAoKGxpbmUpID0+IGxpbmUudHJpbSgpKVxuICAgIC5maWx0ZXIoKGxpbmUpID0+IGxpbmUgIT09ICcnKTtcbn1cblxuLyoqIEEgdmF1bHQgaXMgbGlua2VkIGlmZiBwYWlyIGlkZW50aXR5IGlzIGNvbXBsZXRlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzTGlua2VkKGRhdGE6IFZhdWx0U3luY1BsdWdpbkRhdGEpOiBib29sZWFuIHtcbiAgcmV0dXJuIGRhdGEudXJsICE9PSAnJyAmJiBkYXRhLnRva2VuICE9PSAnJyAmJiBkYXRhLmRldmljZUlkICE9PSAnJztcbn1cblxuLyoqIERldmljZSB0eXBlIGZvciB0aGUgd29ya2VyIHJlZ2lzdHJ5LCBmcm9tIHRoZSBwbGF0Zm9ybSAoRlItMjMpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRldGVjdERldmljZVR5cGUoKTogJ2Rlc2t0b3AnIHwgJ21vYmlsZScge1xuICByZXR1cm4gUGxhdGZvcm0uaXNNb2JpbGVBcHAgPyAnbW9iaWxlJyA6ICdkZXNrdG9wJztcbn1cblxuLyoqIERlZmF1bHQgZGV2aWNlIG5hbWUgd2hlbiB0aGUgdXNlciBoYXMgbm90IHR5cGVkIG9uZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkZWZhdWx0RGV2aWNlTmFtZSgpOiBzdHJpbmcge1xuICBpZiAoUGxhdGZvcm0uaXNNb2JpbGVBcHApIHtcbiAgICBpZiAoUGxhdGZvcm0uaXNJb3NBcHApIHJldHVybiAnaVBob25lL2lQYWQnO1xuICAgIGlmIChQbGF0Zm9ybS5pc0FuZHJvaWRBcHApIHJldHVybiAnQW5kcm9pZCc7XG4gICAgcmV0dXJuICdPYnNpZGlhbiBtb2JpbGUnO1xuICB9XG4gIHJldHVybiAnT2JzaWRpYW4gZGVza3RvcCc7XG59XG4iLCAiLyoqXG4gKiBNaW5pbWFsIHR5cGVkIGNsaWVudCBmb3IgdGhlIHdvcmtlcidzIEhUVFAgc3VyZmFjZSBhcyB0aGUgcGx1Z2luIHVzZXMgaXQ6XG4gKiBgR0VUIC9oZWFsdGhgIChjbGFpbS1zdGF0ZSBwcm9iZSBiZWZvcmUgcGFpcmluZyksIGBQT1NUIC9wYWlyYCAocmVkZWVtIGFcbiAqIHBhaXJpbmcgY29kZSwgQVJDSElURUNUVVJFIFx1MDBBNzMpLCBgUEFUQ0ggL2RldmljZWAgKGRldmljZSBzZWxmLXNlcnZpY2VcbiAqIHJlbmFtZSksIGFuZCBgR0VUIC9hcGkvc3RhdHVzYCAoc3RvcmFnZS9kZXZpY2Ugc3VtbWFyeSBmb3IgQWJvdXQpLiBCdWlsdFxuICogb24gYW4gaW5qZWN0YWJsZSBgZmV0Y2hgOyBmYWlsdXJlcyBtYXAgdG8gdHlwZWQgZXJyb3JzIHdpdGggYWN0aW9uYWJsZVxuICogbWVzc2FnZXMgc28gdGhlIHNldHRpbmdzIFVJIGFuZCB0aGUgZGVlcC1saW5rIGhhbmRsZXIgbmV2ZXIgc2VlIGEgcmF3XG4gKiBgVHlwZUVycm9yOiBGYWlsZWQgdG8gZmV0Y2hgLlxuICovXG5cbi8qKiBBIHdvcmtlciBjYWxsIGZhaWxlZCAodW5yZWFjaGFibGUgb3IgdW5leHBlY3RlZCBIVFRQKS4gKi9cbmV4cG9ydCBjbGFzcyBXb3JrZXJBcGlFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgY29uc3RydWN0b3IoXG4gICAgbWVzc2FnZTogc3RyaW5nLFxuICAgIHJlYWRvbmx5IHN0YXR1cz86IG51bWJlcixcbiAgKSB7XG4gICAgc3VwZXIobWVzc2FnZSk7XG4gICAgdGhpcy5uYW1lID0gJ1dvcmtlckFwaUVycm9yJztcbiAgfVxufVxuXG4vKiogVGhlIHBhaXJpbmcgY29kZSB3YXMgcmVqZWN0ZWQgKGludmFsaWQgLyBleHBpcmVkIC8gYWxyZWFkeSB1c2VkKS4gKi9cbmV4cG9ydCBjbGFzcyBQYWlyUmVqZWN0ZWRFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgY29uc3RydWN0b3IobWVzc2FnZTogc3RyaW5nKSB7XG4gICAgc3VwZXIobWVzc2FnZSk7XG4gICAgdGhpcy5uYW1lID0gJ1BhaXJSZWplY3RlZEVycm9yJztcbiAgfVxufVxuXG4vKiogVGhlIHdvcmtlciBleGlzdHMgYnV0IGhhcyBub3QgYmVlbiBjbGFpbWVkIHlldCAoSFRUUCA0MjEgc2VtYW50aWNzKS4gKi9cbmV4cG9ydCBjbGFzcyBVbmNsYWltZWRXb3JrZXJFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgY29uc3RydWN0b3IobWVzc2FnZTogc3RyaW5nKSB7XG4gICAgc3VwZXIobWVzc2FnZSk7XG4gICAgdGhpcy5uYW1lID0gJ1VuY2xhaW1lZFdvcmtlckVycm9yJztcbiAgfVxufVxuXG5leHBvcnQgaW50ZXJmYWNlIEhlYWx0aEluZm8ge1xuICByZWFjaGFibGU6IGJvb2xlYW47XG4gIGNsYWltZWQ6IGJvb2xlYW47XG4gIC8qKiBIdW1hbi1yZWFkYWJsZSByZWFzb24gd2hlbiB0aGUgd29ya2VyIGNvdWxkIG5vdCBiZSByZWFjaGVkLiAqL1xuICByZWFzb24/OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUGFpckNyZWRlbnRpYWxzIHtcbiAgdG9rZW46IHN0cmluZztcbiAgZGV2aWNlSWQ6IHN0cmluZztcbn1cblxuLyoqXG4gKiBOb3JtYWxpemUgdXNlciBpbnB1dCBpbnRvIGEgd29ya2VyIG9yaWdpbjogdHJpbXMsIHRvbGVyYXRlcyBhIG1pc3NpbmdcbiAqIHNjaGVtZSAoYXNzdW1lcyBodHRwcyksIGEgdHJhaWxpbmcgc2xhc2gsIGFuZCBzdHJheSBwYXRoIGNvbXBvbmVudHM7XG4gKiByZXR1cm5zIGBodHRwczovL2hvc3RgIHN0eWxlIG9yaWdpbi4gVGhyb3dzIGBXb3JrZXJBcGlFcnJvcmAgb24gZ2FyYmFnZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZVdvcmtlclVybChpbnB1dDogc3RyaW5nKTogc3RyaW5nIHtcbiAgbGV0IGNhbmRpZGF0ZSA9IGlucHV0LnRyaW0oKTtcbiAgaWYgKGNhbmRpZGF0ZSA9PT0gJycpIHRocm93IG5ldyBXb3JrZXJBcGlFcnJvcignd29ya2VyIFVSTCBpcyBlbXB0eScpO1xuICBpZiAoIS9eW2EtekEtWl1bYS16QS1aMC05Ky4tXSo6XFwvXFwvLy50ZXN0KGNhbmRpZGF0ZSkpIGNhbmRpZGF0ZSA9IGBodHRwczovLyR7Y2FuZGlkYXRlfWA7XG4gIGxldCBvcmlnaW46IHN0cmluZztcbiAgdHJ5IHtcbiAgICBvcmlnaW4gPSBuZXcgVVJMKGNhbmRpZGF0ZSkub3JpZ2luO1xuICB9IGNhdGNoIHtcbiAgICB0aHJvdyBuZXcgV29ya2VyQXBpRXJyb3IoYGludmFsaWQgd29ya2VyIFVSTDogJHtKU09OLnN0cmluZ2lmeShpbnB1dCl9YCk7XG4gIH1cbiAgaWYgKCFvcmlnaW4uc3RhcnRzV2l0aCgnaHR0cDovLycpICYmICFvcmlnaW4uc3RhcnRzV2l0aCgnaHR0cHM6Ly8nKSkge1xuICAgIHRocm93IG5ldyBXb3JrZXJBcGlFcnJvcihgd29ya2VyIFVSTCBtdXN0IGJlIGh0dHAocyksIGdvdCAke29yaWdpbn1gKTtcbiAgfVxuICByZXR1cm4gb3JpZ2luO1xufVxuXG4vKiogR0VUIC9oZWFsdGggXHUyMDE0IG5ldmVyIHRocm93cyBmb3IgcmVhY2hhYmlsaXR5OyByZXBvcnRzIGNsYWltIHN0YXRlIGluc3RlYWQuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZmV0Y2hIZWFsdGgoXG4gIG9yaWdpbjogc3RyaW5nLFxuICBmZXRjaEltcGw6IHR5cGVvZiBmZXRjaCxcbik6IFByb21pc2U8SGVhbHRoSW5mbz4ge1xuICBsZXQgcmVzcG9uc2U6IFJlc3BvbnNlO1xuICB0cnkge1xuICAgIHJlc3BvbnNlID0gYXdhaXQgZmV0Y2hJbXBsKGAke29yaWdpbn0vaGVhbHRoYCk7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHJlYWNoYWJsZTogZmFsc2UsXG4gICAgICBjbGFpbWVkOiBmYWxzZSxcbiAgICAgIHJlYXNvbjogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpLFxuICAgIH07XG4gIH1cbiAgaWYgKCFyZXNwb25zZS5vaykge1xuICAgIHJldHVybiB7IHJlYWNoYWJsZTogZmFsc2UsIGNsYWltZWQ6IGZhbHNlLCByZWFzb246IGBIVFRQICR7cmVzcG9uc2Uuc3RhdHVzfWAgfTtcbiAgfVxuICBjb25zdCBib2R5ID0gKGF3YWl0IHJlc3BvbnNlLmpzb24oKS5jYXRjaCgoKSA9PiAoe30pKSkgYXMgeyBjbGFpbWVkPzogYm9vbGVhbiB9O1xuICByZXR1cm4geyByZWFjaGFibGU6IHRydWUsIGNsYWltZWQ6IGJvZHkuY2xhaW1lZCA9PT0gdHJ1ZSB9O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFBhaXJSZXF1ZXN0UGFyYW1zIHtcbiAgb3JpZ2luOiBzdHJpbmc7XG4gIGNvZGU6IHN0cmluZztcbiAgZGV2aWNlTmFtZTogc3RyaW5nO1xuICBkZXZpY2VUeXBlOiAnZGVza3RvcCcgfCAnbW9iaWxlJztcbiAgZmV0Y2hJbXBsOiB0eXBlb2YgZmV0Y2g7XG59XG5cbi8qKlxuICogUE9TVCAvcGFpciBcdTIwMTQgcmVkZWVtIGEgb25lLXRpbWUgcGFpcmluZyBjb2RlIGZvciBsb25nLWxpdmVkIGRldmljZVxuICogY3JlZGVudGlhbHMuIFRocm93cyBgUGFpclJlamVjdGVkRXJyb3JgIChiYWQgY29kZSksIGBVbmNsYWltZWRXb3JrZXJFcnJvcmBcbiAqICg0MjEpLCBvciBgV29ya2VyQXBpRXJyb3JgICh1bnJlYWNoYWJsZSAvIHVuZXhwZWN0ZWQpLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVxdWVzdFBhaXIocGFyYW1zOiBQYWlyUmVxdWVzdFBhcmFtcyk6IFByb21pc2U8UGFpckNyZWRlbnRpYWxzPiB7XG4gIGxldCByZXNwb25zZTogUmVzcG9uc2U7XG4gIHRyeSB7XG4gICAgcmVzcG9uc2UgPSBhd2FpdCBwYXJhbXMuZmV0Y2hJbXBsKGAke3BhcmFtcy5vcmlnaW59L3BhaXJgLCB7XG4gICAgICBtZXRob2Q6ICdQT1NUJyxcbiAgICAgIGhlYWRlcnM6IHsgJ2NvbnRlbnQtdHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyB9LFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBjb2RlOiBwYXJhbXMuY29kZSxcbiAgICAgICAgZGV2aWNlTmFtZTogcGFyYW1zLmRldmljZU5hbWUsXG4gICAgICAgIGRldmljZVR5cGU6IHBhcmFtcy5kZXZpY2VUeXBlLFxuICAgICAgfSksXG4gICAgfSk7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgdGhyb3cgbmV3IFdvcmtlckFwaUVycm9yKFxuICAgICAgYGNvdWxkIG5vdCByZWFjaCB0aGUgd29ya2VyIGF0ICR7cGFyYW1zLm9yaWdpbn06ICR7XG4gICAgICAgIGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKVxuICAgICAgfWAsXG4gICAgKTtcbiAgfVxuICAvLyBSZWFkIHRoZSBib2R5IG9uY2UgKGEgUmVzcG9uc2UgYm9keSBpcyBzaW5nbGUtdXNlKSBhbmQgcGFyc2UgZnJvbSB0ZXh0LlxuICBjb25zdCBkZXRhaWwgPSAoYXdhaXQgcmVzcG9uc2UudGV4dCgpLmNhdGNoKCgpID0+ICcnKSkudHJpbSgpO1xuICBpZiAocmVzcG9uc2Uuc3RhdHVzID09PSA0MjEpIHtcbiAgICB0aHJvdyBuZXcgVW5jbGFpbWVkV29ya2VyRXJyb3IoJ3RoaXMgd29ya2VyIGhhcyBub3QgYmVlbiBjbGFpbWVkIHlldCcpO1xuICB9XG4gIGlmIChyZXNwb25zZS5zdGF0dXMgPT09IDQwMSB8fCByZXNwb25zZS5zdGF0dXMgPT09IDQwMykge1xuICAgIHRocm93IG5ldyBQYWlyUmVqZWN0ZWRFcnJvcihcbiAgICAgICdwYWlyaW5nIGNvZGUgcmVqZWN0ZWQgXHUyMDE0IGNvZGVzIGFyZSBvbmUtdGltZSwgZXhwaXJlIGFmdGVyIDEwIG1pbnV0ZXMsIGFuZCBjb21lICcgK1xuICAgICAgICAnZnJvbSB0aGUgd29ya2VyIGRhc2hib2FyZC4gR2VuZXJhdGUgYSBmcmVzaCBvbmUgYW5kIHJldHJ5LicsXG4gICAgKTtcbiAgfVxuICBpZiAoIXJlc3BvbnNlLm9rKSB7XG4gICAgdGhyb3cgbmV3IFdvcmtlckFwaUVycm9yKFxuICAgICAgYHBhaXJpbmcgZmFpbGVkOiBIVFRQICR7cmVzcG9uc2Uuc3RhdHVzfSAke2RldGFpbC5zbGljZSgwLCAyMDApfWAudHJpbSgpLFxuICAgICAgcmVzcG9uc2Uuc3RhdHVzLFxuICAgICk7XG4gIH1cbiAgbGV0IGJvZHk6IHsgdG9rZW4/OiB1bmtub3duOyBkZXZpY2VJZD86IHVua25vd24gfTtcbiAgdHJ5IHtcbiAgICBib2R5ID0gSlNPTi5wYXJzZShkZXRhaWwpIGFzIHsgdG9rZW4/OiB1bmtub3duOyBkZXZpY2VJZD86IHVua25vd24gfTtcbiAgfSBjYXRjaCB7XG4gICAgdGhyb3cgbmV3IFdvcmtlckFwaUVycm9yKCdwYWlyaW5nIHJlcGx5IHdhcyBub3QgSlNPTicsIHJlc3BvbnNlLnN0YXR1cyk7XG4gIH1cbiAgaWYgKHR5cGVvZiBib2R5LnRva2VuICE9PSAnc3RyaW5nJyB8fCB0eXBlb2YgYm9keS5kZXZpY2VJZCAhPT0gJ3N0cmluZycpIHtcbiAgICB0aHJvdyBuZXcgV29ya2VyQXBpRXJyb3IoJ3BhaXJpbmcgcmVwbHkgd2FzIG1pc3NpbmcgdG9rZW4vZGV2aWNlSWQnLCByZXNwb25zZS5zdGF0dXMpO1xuICB9XG4gIHJldHVybiB7IHRva2VuOiBib2R5LnRva2VuLCBkZXZpY2VJZDogYm9keS5kZXZpY2VJZCB9O1xufVxuXG4vLyAtLS0gZGV2aWNlIHNlbGYtc2VydmljZSAoUEFUQ0ggL2RldmljZSkgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFRoZSBkZXZpY2UgZG9jdW1lbnQgdGhlIHdvcmtlciByZXR1cm5zIGZyb20gYFBBVENIIC9kZXZpY2VgLiAqL1xuZXhwb3J0IGludGVyZmFjZSBXb3JrZXJEZXZpY2Uge1xuICBpZDogc3RyaW5nO1xuICBuYW1lOiBzdHJpbmc7XG4gIHR5cGU6IHN0cmluZztcbn1cblxuZXhwb3J0IHR5cGUgUmVuYW1lT3V0Y29tZSA9XG4gIHwgeyBvazogdHJ1ZTsgZGV2aWNlOiBXb3JrZXJEZXZpY2UgfVxuICB8IHsgb2s6IGZhbHNlOyBlcnJvcjogc3RyaW5nIH07XG5cbmV4cG9ydCBpbnRlcmZhY2UgUmVuYW1lUGFyYW1zIHtcbiAgb3JpZ2luOiBzdHJpbmc7XG4gIC8qKiBUaGUgY2FsbGluZyBkZXZpY2UncyBvd24gdG9rZW4gXHUyMDE0IGl0IGNhbiBvbmx5IGV2ZXIgcmVuYW1lIGl0c2VsZi4gKi9cbiAgdG9rZW46IHN0cmluZztcbiAgbmFtZTogc3RyaW5nO1xuICBmZXRjaEltcGw6IHR5cGVvZiBmZXRjaDtcbn1cblxuLyoqXG4gKiBgUEFUQ0ggL2RldmljZWAgXHUyMDE0IHJlbmFtZSBUSElTIGRldmljZSBvbiB0aGUgd29ya2VyIChkZXZpY2UtdG9rZW5cbiAqIGF1dGhlbnRpY2F0ZWQ7IG5ldmVyIHRocm93czogZmFpbHVyZXMgY29tZSBiYWNrIGFzIGB7b2s6ZmFsc2UsIGVycm9yfWApLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVuYW1lRGV2aWNlKHBhcmFtczogUmVuYW1lUGFyYW1zKTogUHJvbWlzZTxSZW5hbWVPdXRjb21lPiB7XG4gIGxldCByZXNwb25zZTogUmVzcG9uc2U7XG4gIHRyeSB7XG4gICAgcmVzcG9uc2UgPSBhd2FpdCBwYXJhbXMuZmV0Y2hJbXBsKGAke3BhcmFtcy5vcmlnaW59L2RldmljZWAsIHtcbiAgICAgIG1ldGhvZDogJ1BBVENIJyxcbiAgICAgIGhlYWRlcnM6IHsgJ2NvbnRlbnQtdHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJywgYXV0aG9yaXphdGlvbjogYEJlYXJlciAke3BhcmFtcy50b2tlbn1gIH0sXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IG5hbWU6IHBhcmFtcy5uYW1lIH0pLFxuICAgIH0pO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIHJldHVybiB7XG4gICAgICBvazogZmFsc2UsXG4gICAgICBlcnJvcjogYGNvdWxkIG5vdCByZWFjaCB0aGUgd29ya2VyIGF0ICR7cGFyYW1zLm9yaWdpbn06ICR7XG4gICAgICAgIGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKVxuICAgICAgfWAsXG4gICAgfTtcbiAgfVxuICBjb25zdCBkZXRhaWwgPSAoYXdhaXQgcmVzcG9uc2UudGV4dCgpLmNhdGNoKCgpID0+ICcnKSkudHJpbSgpO1xuICBpZiAocmVzcG9uc2Uuc3RhdHVzID09PSA0MjEpIHtcbiAgICByZXR1cm4geyBvazogZmFsc2UsIGVycm9yOiAndGhpcyB3b3JrZXIgaGFzIG5vdCBiZWVuIGNsYWltZWQgeWV0JyB9O1xuICB9XG4gIGlmIChyZXNwb25zZS5zdGF0dXMgPT09IDQwMSB8fCByZXNwb25zZS5zdGF0dXMgPT09IDQwMykge1xuICAgIHJldHVybiB7XG4gICAgICBvazogZmFsc2UsXG4gICAgICBlcnJvcjogJ3RoZSB3b3JrZXIgcmVqZWN0ZWQgdGhpcyBkZXZpY2VcXHUyMDE5cyB0b2tlbiAocmV2b2tlZD8pIFx1MjAxNCB1bmxpbmsgYW5kIHJlLXBhaXIgd2l0aCBhIGZyZXNoIGNvZGUuJyxcbiAgICB9O1xuICB9XG4gIGlmICghcmVzcG9uc2Uub2spIHtcbiAgICBsZXQgcmVhc29uID0gYEhUVFAgJHtyZXNwb25zZS5zdGF0dXN9YDtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShkZXRhaWwpIGFzIHsgZXJyb3I/OiB1bmtub3duIH07XG4gICAgICBpZiAodHlwZW9mIHBhcnNlZC5lcnJvciA9PT0gJ3N0cmluZycpIHJlYXNvbiA9IHBhcnNlZC5lcnJvcjtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIGtlZXAgdGhlIGJhcmUgc3RhdHVzXG4gICAgfVxuICAgIHJldHVybiB7IG9rOiBmYWxzZSwgZXJyb3I6IHJlYXNvbiB9O1xuICB9XG4gIGxldCBib2R5OiB7IGRldmljZT86IHVua25vd24gfTtcbiAgdHJ5IHtcbiAgICBib2R5ID0gSlNPTi5wYXJzZShkZXRhaWwpIGFzIHsgZGV2aWNlPzogdW5rbm93biB9O1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4geyBvazogZmFsc2UsIGVycm9yOiAncmVuYW1lIHJlcGx5IHdhcyBub3QgSlNPTicgfTtcbiAgfVxuICBjb25zdCBkZXZpY2UgPSBib2R5LmRldmljZSBhcyBQYXJ0aWFsPFdvcmtlckRldmljZT4gfCB1bmRlZmluZWQ7XG4gIGlmIChcbiAgICB0eXBlb2YgZGV2aWNlPy5pZCAhPT0gJ3N0cmluZycgfHxcbiAgICB0eXBlb2YgZGV2aWNlLm5hbWUgIT09ICdzdHJpbmcnIHx8XG4gICAgdHlwZW9mIGRldmljZS50eXBlICE9PSAnc3RyaW5nJ1xuICApIHtcbiAgICByZXR1cm4geyBvazogZmFsc2UsIGVycm9yOiAncmVuYW1lIHJlcGx5IHdhcyBtaXNzaW5nIHRoZSBkZXZpY2UgZG9jdW1lbnQnIH07XG4gIH1cbiAgcmV0dXJuIHsgb2s6IHRydWUsIGRldmljZTogeyBpZDogZGV2aWNlLmlkLCBuYW1lOiBkZXZpY2UubmFtZSwgdHlwZTogZGV2aWNlLnR5cGUgfSB9O1xufVxuXG4vLyAtLS0gd29ya2VyIHN0YXR1cyAoR0VUIC9hcGkvc3RhdHVzLCBkZXZpY2UgdG9rZW4pIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBUaGUgc2xpY2Ugb2YgYC9hcGkvc3RhdHVzYCB0aGUgcGx1Z2luJ3MgQWJvdXQgc2VjdGlvbiBzaG93cy4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgV29ya2VyU3RhdHVzU3VtbWFyeSB7XG4gIHZhdWx0TmFtZTogc3RyaW5nO1xuICBkZXZpY2VzOiBBcnJheTx7IGlkOiBzdHJpbmc7IG5hbWU6IHN0cmluZzsgdHlwZTogc3RyaW5nOyBvbmxpbmU6IGJvb2xlYW47IHJldm9rZWQ6IGJvb2xlYW4gfT47XG4gIGF0dGFjaG1lbnRzOiB7IGNvdW50OiBudW1iZXI7IGJ5dGVzOiBudW1iZXIgfTtcbiAgc3RvcmFnZUJ5dGVzOiBudW1iZXI7XG4gIC8qKiBXb3JrZXItcmVwb3J0ZWQgcmVsZWFzZSB2ZXJzaW9uIChhYnNlbnQgb24gc2VydmVycyBcdTIyNjQgMC4xKS4gKi9cbiAgc2VydmVyVmVyc2lvbj86IHN0cmluZztcbn1cblxuLyoqXG4gKiBgR0VUIC9hcGkvc3RhdHVzYCB3aXRoIHRoZSBkZXZpY2UgdG9rZW4gXHUyMDE0IHN0b3JhZ2UgdXNhZ2UgKyBkZXZpY2UgbGlzdCBmb3JcbiAqIHRoZSBBYm91dCBzZWN0aW9uLiBSZXNvbHZlcyBgbnVsbGAgb24gYW55IGZhaWx1cmUgKEFib3V0IHNob3dzIFwidW5rbm93blwiKS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGZldGNoV29ya2VyU3RhdHVzKHBhcmFtczoge1xuICBvcmlnaW46IHN0cmluZztcbiAgdG9rZW46IHN0cmluZztcbiAgZmV0Y2hJbXBsOiB0eXBlb2YgZmV0Y2g7XG59KTogUHJvbWlzZTxXb3JrZXJTdGF0dXNTdW1tYXJ5IHwgbnVsbD4ge1xuICBsZXQgcmVzcG9uc2U6IFJlc3BvbnNlO1xuICB0cnkge1xuICAgIHJlc3BvbnNlID0gYXdhaXQgcGFyYW1zLmZldGNoSW1wbChgJHtwYXJhbXMub3JpZ2lufS9hcGkvc3RhdHVzYCwge1xuICAgICAgaGVhZGVyczogeyBhdXRob3JpemF0aW9uOiBgQmVhcmVyICR7cGFyYW1zLnRva2VufWAgfSxcbiAgICB9KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbiAgaWYgKCFyZXNwb25zZS5vaykgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGJvZHkgPSAoYXdhaXQgcmVzcG9uc2UuanNvbigpLmNhdGNoKCgpID0+IG51bGwpKSBhcyBQYXJ0aWFsPFdvcmtlclN0YXR1c1N1bW1hcnk+IHwgbnVsbDtcbiAgaWYgKGJvZHkgPT09IG51bGwgfHwgdHlwZW9mIGJvZHkuc3RvcmFnZUJ5dGVzICE9PSAnbnVtYmVyJyB8fCB0eXBlb2YgYm9keS5hdHRhY2htZW50cyAhPT0gJ29iamVjdCcpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuICByZXR1cm4ge1xuICAgIHZhdWx0TmFtZTogdHlwZW9mIGJvZHkudmF1bHROYW1lID09PSAnc3RyaW5nJyA/IGJvZHkudmF1bHROYW1lIDogJycsXG4gICAgZGV2aWNlczogQXJyYXkuaXNBcnJheShib2R5LmRldmljZXMpID8gYm9keS5kZXZpY2VzIDogW10sXG4gICAgYXR0YWNobWVudHM6IGJvZHkuYXR0YWNobWVudHMsXG4gICAgc3RvcmFnZUJ5dGVzOiBib2R5LnN0b3JhZ2VCeXRlcyxcbiAgICAuLi4odHlwZW9mIGJvZHkuc2VydmVyVmVyc2lvbiA9PT0gJ3N0cmluZycgPyB7IHNlcnZlclZlcnNpb246IGJvZHkuc2VydmVyVmVyc2lvbiB9IDoge30pLFxuICB9O1xufVxuIiwgIi8qKlxuICogVGhlIHBhaXIgZmxvdyBzaGFyZWQgYnkgdGhlIHNldHRpbmdzIGZvcm0gYW5kIHRoZSBgb2JzaWRpYW46Ly9gIGRlZXAgbGlua1xuICogKEFSQ0hJVEVDVFVSRSBcdTAwQTczKTogcHJvYmUgYEdFVCAvaGVhbHRoYCBmaXJzdCBcdTIwMTQgYW4gKnVuY2xhaW1lZCogd29ya2VyIGdldHNcbiAqIGZyaWVuZGx5IG9uYm9hcmRpbmcgZ3VpZGFuY2UgaW5zdGVhZCBvZiBhIGNyeXB0aWMgNDIxIFx1MjAxNCB0aGVuIGBQT1NUIC9wYWlyYFxuICogYW5kIGhhbmQgdGhlIGNyZWRlbnRpYWxzIGJhY2sgdG8gYmUgcGVyc2lzdGVkLlxuICovXG5cbmltcG9ydCB7XG4gIGZldGNoSGVhbHRoLFxuICBub3JtYWxpemVXb3JrZXJVcmwsXG4gIHJlcXVlc3RQYWlyLFxuICBQYWlyUmVqZWN0ZWRFcnJvcixcbiAgVW5jbGFpbWVkV29ya2VyRXJyb3IsXG4gIFdvcmtlckFwaUVycm9yLFxufSBmcm9tICcuL3dvcmtlcmFwaS5qcyc7XG5cbmV4cG9ydCB0eXBlIFBhaXJPdXRjb21lID1cbiAgfCB7IHN0YXR1czogJ3BhaXJlZCc7IHVybDogc3RyaW5nOyB0b2tlbjogc3RyaW5nOyBkZXZpY2VJZDogc3RyaW5nIH1cbiAgfCB7IHN0YXR1czogJ3VuY2xhaW1lZCc7IHVybDogc3RyaW5nOyBndWlkYW5jZTogc3RyaW5nIH1cbiAgfCB7IHN0YXR1czogJ3VucmVhY2hhYmxlJzsgdXJsOiBzdHJpbmc7IHJlYXNvbjogc3RyaW5nIH1cbiAgfCB7IHN0YXR1czogJ3JlamVjdGVkJzsgdXJsOiBzdHJpbmc7IHJlYXNvbjogc3RyaW5nIH1cbiAgfCB7IHN0YXR1czogJ2ludmFsaWQtdXJsJzsgaW5wdXQ6IHN0cmluZyB9O1xuXG5leHBvcnQgaW50ZXJmYWNlIFBhaXJGbG93UGFyYW1zIHtcbiAgLyoqIFdvcmtlciBVUkwgYXMgdHlwZWQgLyBkZWVwLWxpbmtlZCAoc2NoZW1lbGVzcyBpcyB0b2xlcmF0ZWQpLiAqL1xuICB1cmw6IHN0cmluZztcbiAgLyoqIE9uZS10aW1lIHBhaXJpbmcgY29kZSBmcm9tIHRoZSB3b3JrZXIgZGFzaGJvYXJkLiAqL1xuICBjb2RlOiBzdHJpbmc7XG4gIGRldmljZU5hbWU6IHN0cmluZztcbiAgZGV2aWNlVHlwZTogJ2Rlc2t0b3AnIHwgJ21vYmlsZSc7XG4gIGZldGNoSW1wbDogdHlwZW9mIGZldGNoO1xufVxuXG4vKiogT25ib2FyZGluZyB0ZXh0IHNob3duIHdoZW4gdGhlIHdvcmtlciBpcyBkZXBsb3llZCBidXQgbm90IGNsYWltZWQuICovXG5leHBvcnQgZnVuY3Rpb24gdW5jbGFpbWVkR3VpZGFuY2UodXJsOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gW1xuICAgIGBUaGUgd29ya2VyIGF0ICR7dXJsfSBpcyBkZXBsb3llZCBidXQgbm90IGNsYWltZWQgeWV0LiBGaW5pc2ggc2V0dXAgaW4gYSBicm93c2VyOmAsXG4gICAgJycsXG4gICAgYDEuIE9wZW4gJHt1cmx9YCxcbiAgICAnMi4gU2V0IHRoZSBhZG1pbiBwYXNzcGhyYXNlIGFuZCBuYW1lIHRoZSB2YXVsdCAodGhlIGNsYWltIHBhZ2UpLicsXG4gICAgJzMuIE9uIHRoZSBkYXNoYm9hcmQsIGNyZWF0ZSBhIHBhaXJpbmcgY29kZSAoRGV2aWNlcyBcdTIxOTIgUGFpciBuZXcgZGV2aWNlKS4nLFxuICAgICc0LiBFbnRlciB0aGF0IGNvZGUgaGVyZSAob3IgY2xpY2sgdGhlIG9ic2lkaWFuOi8vIGxpbmsgdGhlIGRhc2hib2FyZCBzaG93cykgYW5kIHBhaXIuJyxcbiAgXS5qb2luKCdcXG4nKTtcbn1cblxuLyoqXG4gKiBSdW4gdGhlIHBhaXIgZmxvdy4gTmV2ZXIgdGhyb3dzIFx1MjAxNCBldmVyeSBmYWlsdXJlIG1vZGUgaXMgYSB0eXBlZCBvdXRjb21lIHRoZVxuICogVUkgY2FuIHJlbmRlciAoYW5kIHRoZSBkZWVwLWxpbmsgaGFuZGxlciBjYW4gdHVybiBpbnRvIGEgTm90aWNlKS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHBhaXJXaXRoV29ya2VyKHBhcmFtczogUGFpckZsb3dQYXJhbXMpOiBQcm9taXNlPFBhaXJPdXRjb21lPiB7XG4gIGxldCBvcmlnaW46IHN0cmluZztcbiAgdHJ5IHtcbiAgICBvcmlnaW4gPSBub3JtYWxpemVXb3JrZXJVcmwocGFyYW1zLnVybCk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiB7IHN0YXR1czogJ2ludmFsaWQtdXJsJywgaW5wdXQ6IHBhcmFtcy51cmwgfTtcbiAgfVxuXG4gIGNvbnN0IGhlYWx0aCA9IGF3YWl0IGZldGNoSGVhbHRoKG9yaWdpbiwgcGFyYW1zLmZldGNoSW1wbCk7XG4gIGlmICghaGVhbHRoLnJlYWNoYWJsZSkge1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0dXM6ICd1bnJlYWNoYWJsZScsXG4gICAgICB1cmw6IG9yaWdpbixcbiAgICAgIHJlYXNvbjpcbiAgICAgICAgYCR7aGVhbHRoLnJlYXNvbiA/PyAndW5rbm93biBlcnJvcid9IFx1MjAxNCBjaGVjayB0aGUgVVJMLCB5b3VyIG5ldHdvcmssIGFuZCB0aGF0IHRoZSBgICtcbiAgICAgICAgJ3dvcmtlciBpcyBkZXBsb3llZC4nLFxuICAgIH07XG4gIH1cbiAgaWYgKCFoZWFsdGguY2xhaW1lZCkge1xuICAgIHJldHVybiB7IHN0YXR1czogJ3VuY2xhaW1lZCcsIHVybDogb3JpZ2luLCBndWlkYW5jZTogdW5jbGFpbWVkR3VpZGFuY2Uob3JpZ2luKSB9O1xuICB9XG5cbiAgdHJ5IHtcbiAgICBjb25zdCBjcmVkZW50aWFscyA9IGF3YWl0IHJlcXVlc3RQYWlyKHtcbiAgICAgIG9yaWdpbixcbiAgICAgIGNvZGU6IHBhcmFtcy5jb2RlLFxuICAgICAgZGV2aWNlTmFtZTogcGFyYW1zLmRldmljZU5hbWUsXG4gICAgICBkZXZpY2VUeXBlOiBwYXJhbXMuZGV2aWNlVHlwZSxcbiAgICAgIGZldGNoSW1wbDogcGFyYW1zLmZldGNoSW1wbCxcbiAgICB9KTtcbiAgICByZXR1cm4geyBzdGF0dXM6ICdwYWlyZWQnLCB1cmw6IG9yaWdpbiwgLi4uY3JlZGVudGlhbHMgfTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBVbmNsYWltZWRXb3JrZXJFcnJvcikge1xuICAgICAgcmV0dXJuIHsgc3RhdHVzOiAndW5jbGFpbWVkJywgdXJsOiBvcmlnaW4sIGd1aWRhbmNlOiB1bmNsYWltZWRHdWlkYW5jZShvcmlnaW4pIH07XG4gICAgfVxuICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIFBhaXJSZWplY3RlZEVycm9yKSB7XG4gICAgICByZXR1cm4geyBzdGF0dXM6ICdyZWplY3RlZCcsIHVybDogb3JpZ2luLCByZWFzb246IGVycm9yLm1lc3NhZ2UgfTtcbiAgICB9XG4gICAgY29uc3QgcmVhc29uID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpO1xuICAgIHJldHVybiB7IHN0YXR1czogJ3JlamVjdGVkJywgdXJsOiBvcmlnaW4sIHJlYXNvbiB9O1xuICB9XG59XG5cbi8qKiBSZW5kZXIgYW55IG91dGNvbWUgYXMgdXNlci1mYWNpbmcgdGV4dCAoTm90aWNlcywgZGVlcC1saW5rIGZlZWRiYWNrKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYWlyT3V0Y29tZU1lc3NhZ2Uob3V0Y29tZTogUGFpck91dGNvbWUpOiBzdHJpbmcge1xuICBzd2l0Y2ggKG91dGNvbWUuc3RhdHVzKSB7XG4gICAgY2FzZSAncGFpcmVkJzpcbiAgICAgIHJldHVybiBgUGFpcmVkIHdpdGggJHtvdXRjb21lLnVybH0gXHUyMDE0IHN5bmNpbmcgbm93LmA7XG4gICAgY2FzZSAndW5jbGFpbWVkJzpcbiAgICAgIHJldHVybiBvdXRjb21lLmd1aWRhbmNlO1xuICAgIGNhc2UgJ3VucmVhY2hhYmxlJzpcbiAgICAgIHJldHVybiBgQ291bGQgbm90IHJlYWNoIHRoZSB3b3JrZXI6ICR7b3V0Y29tZS5yZWFzb259YDtcbiAgICBjYXNlICdyZWplY3RlZCc6XG4gICAgICByZXR1cm4gYFBhaXJpbmcgZmFpbGVkOiAke291dGNvbWUucmVhc29ufWA7XG4gICAgY2FzZSAnaW52YWxpZC11cmwnOlxuICAgICAgcmV0dXJuIGBUaGF0IGRvZXMgbm90IGxvb2sgbGlrZSBhIHdvcmtlciBVUkw6ICR7SlNPTi5zdHJpbmdpZnkob3V0Y29tZS5pbnB1dCl9YDtcbiAgfVxufVxuIiwgIi8qKlxuICogYG9ic2lkaWFuOi8vdmF1bHRzeW5jZm9yYWdlbnRzL3BhaXI/dXJsPTx3b3JrZXI+JmNvZGU9PHBhaXJpbmc+YCBkZWVwLWxpbmtcbiAqIGhhbmRsaW5nIChBUkNISVRFQ1RVUkUgXHUwMEE3Myk6IHRoZSBkYXNoYm9hcmQgcmVuZGVycyB0aGlzIGxpbmsgKGFuZCB0aGUgUVJcbiAqIGVxdWl2YWxlbnQpIHNvIGEgbmV3IGRldmljZSBwYWlycyB3aXRoIHplcm8gdHlwaW5nLlxuICpcbiAqIFRoZSBoYW5kbGVyIGlzIHJlZ2lzdGVyZWQgZm9yIHRoZSBhY3Rpb24gYHZhdWx0c3luY2ZvcmFnZW50c2AuIE9ic2lkaWFuXG4gKiBidWlsZHMgZGlmZmVyIHN1YnRseSBpbiBob3cgdGhlIGAvcGFpcmAgcGF0aCBzZWdtZW50IG9mIGEgcHJvdG9jb2wgVVJMIGlzXG4gKiBtYXRjaGVkLCBzbyB0aGUgc2FtZSBoYW5kbGVyIGlzIHJlZ2lzdGVyZWQgZm9yIGB2YXVsdHN5bmNmb3JhZ2VudHMvcGFpcmBcbiAqIHRvbyBcdTIwMTQgd2hpY2hldmVyIHNwZWxsaW5nIGEgZ2l2ZW4gYnVpbGQgcmVzb2x2ZXMsIHRoZSBsaW5rIHdvcmtzLiBXaGVuXG4gKiBgdXJsYC9gY29kZWAgYXJlIGFic2VudCB0aGUgaW52b2NhdGlvbiBpcyBpZ25vcmVkIChhIHN0cmF5IHByb3RvY29sIGhpdFxuICogbXVzdCBub3Qgc3BhbSBhIE5vdGljZSk7IGEgKm1hbGZvcm1lZCogcGFpciBsaW5rIChvbmUgb2YgdGhlIHR3byBwcmVzZW50KVxuICogZ2V0cyBhbiBhY3Rpb25hYmxlIGVycm9yLlxuICovXG5cbmltcG9ydCB7IE5vdGljZSB9IGZyb20gJ29ic2lkaWFuJztcblxuLyoqIFByb3RvY29sIGFjdGlvbiAodGhlIGBvYnNpZGlhbjovL2AgXCJob3N0XCIgcGFydCkuICovXG5leHBvcnQgY29uc3QgUFJPVE9DT0xfQUNUSU9OID0gJ3ZhdWx0c3luY2ZvcmFnZW50cyc7XG5cbi8qKiBIYW5kbGVyIHNoYXBlIChPYnNpZGlhbiBwYXNzZXMgaXRzIGRlY29kZWQgcXVlcnkgcGFyYW1zKS4gKi9cbmV4cG9ydCB0eXBlIFByb3RvY29sSGFuZGxlciA9IChwYXJhbXM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSA9PiB2b2lkO1xuXG4vKiogSG93IGhhbmRsZXJzIGdldCByZWdpc3RlcmVkIFx1MjAxNCBgUGx1Z2luLnJlZ2lzdGVyT2JzaWRpYW5Qcm90b2NvbEhhbmRsZXJgLiAqL1xuZXhwb3J0IHR5cGUgUHJvdG9jb2xSZWdpc3RyYXIgPSAoYWN0aW9uOiBzdHJpbmcsIGhhbmRsZXI6IFByb3RvY29sSGFuZGxlcikgPT4gdm9pZDtcblxuLyoqIFBhcnNlZCBwYWlyIGRlZXAgbGluay4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUGFpckRlZXBMaW5rIHtcbiAgdXJsOiBzdHJpbmc7XG4gIGNvZGU6IHN0cmluZztcbn1cblxuZXhwb3J0IHR5cGUgRGVlcExpbmtQYXJzZVJlc3VsdCA9XG4gIHwgeyBvazogdHJ1ZTsgbGluazogUGFpckRlZXBMaW5rIH1cbiAgfCB7IG9rOiBmYWxzZTsgZXJyb3I6IHN0cmluZyB9O1xuXG4vKipcbiAqIEV4dHJhY3QgYHt1cmwsIGNvZGV9YCBmcm9tIE9ic2lkaWFuJ3MgZGVjb2RlZCBxdWVyeSBwYXJhbXMuIFZhbHVlcyBhcnJpdmVcbiAqIGFzIHN0cmluZ3MgKHVzdWFsbHkgYWxyZWFkeSBkZWNvZGVkOyBhIGRvdWJsZS1lbmNvZGVkIGAleHhgIHJlbW5hbnQgaXNcbiAqIGRlY29kZWQgb25jZSBtb3JlLCBiZXN0IGVmZm9ydCkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZVBhaXJEZWVwTGluayhwYXJhbXM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogRGVlcExpbmtQYXJzZVJlc3VsdCB7XG4gIGNvbnN0IHVybCA9IHBhcmFtVGV4dChwYXJhbXMsICd1cmwnKTtcbiAgY29uc3QgY29kZSA9IHBhcmFtVGV4dChwYXJhbXMsICdjb2RlJyk7XG4gIGlmICh1cmwgPT09ICcnICYmIGNvZGUgPT09ICcnKSB7XG4gICAgcmV0dXJuIHsgb2s6IGZhbHNlLCBlcnJvcjogJ25vIHBhaXJpbmcgcGFyYW1ldGVycycgfTtcbiAgfVxuICBpZiAodXJsID09PSAnJykgcmV0dXJuIHsgb2s6IGZhbHNlLCBlcnJvcjogJ2RlZXAgbGluayBpcyBtaXNzaW5nIHRoZSB3b3JrZXIgVVJMICg/dXJsPVx1MjAyNiknIH07XG4gIGlmIChjb2RlID09PSAnJykgcmV0dXJuIHsgb2s6IGZhbHNlLCBlcnJvcjogJ2RlZXAgbGluayBpcyBtaXNzaW5nIHRoZSBwYWlyaW5nIGNvZGUgKD9jb2RlPVx1MjAyNiknIH07XG4gIHJldHVybiB7IG9rOiB0cnVlLCBsaW5rOiB7IHVybCwgY29kZSB9IH07XG59XG5cbmZ1bmN0aW9uIHBhcmFtVGV4dChwYXJhbXM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBrZXk6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHZhbHVlID0gcGFyYW1zW2tleV07XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdudW1iZXInKSByZXR1cm4gU3RyaW5nKHZhbHVlKTtcbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gJ3N0cmluZycpIHJldHVybiAnJztcbiAgY29uc3QgdHJpbW1lZCA9IHZhbHVlLnRyaW0oKTtcbiAgLy8gT2JzaWRpYW4gaGFuZHMgb3ZlciBkZWNvZGVkIHZhbHVlczsgdG9sZXJhdGUgb25lIHN1cnZpdmluZyByb3VuZCBvZlxuICAvLyBwZXJjZW50LWVuY29kaW5nIGZyb20gb3Zlci1lYWdlciBsaW5rIGdlbmVyYXRvcnMuXG4gIGlmICh0cmltbWVkLmluY2x1ZGVzKCclJykpIHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGRlY29kZVVSSUNvbXBvbmVudCh0cmltbWVkKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiB0cmltbWVkO1xuICAgIH1cbiAgfVxuICByZXR1cm4gdHJpbW1lZDtcbn1cblxuLyoqXG4gKiBSZWdpc3RlciB0aGUgcGFpciBkZWVwLWxpbmsgaGFuZGxlciAoY2FsbCBmcm9tIGBvbmxvYWRgIHdpdGggdGhlIHBsdWdpbidzXG4gKiBvd24gcmVnaXN0cmFyKS4gYG9uUGFpcmAgcnVucyB0aGUgc2hhcmVkIHBhaXIgZmxvdyAoc2V0dGluZ3MgKyBOb3RpY2VzXG4gKiBsaXZlIGluIHRoZSBwbHVnaW4pOyBpdHMgZXJyb3JzIGFyZSBsb2dnZWQsIG5ldmVyIGZhdGFsLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVnaXN0ZXJQYWlyUHJvdG9jb2xIYW5kbGVyKFxuICByZWdpc3RlcjogUHJvdG9jb2xSZWdpc3RyYXIsXG4gIG9uUGFpcjogKGxpbms6IFBhaXJEZWVwTGluaykgPT4gUHJvbWlzZTx2b2lkPixcbik6IHZvaWQge1xuICBjb25zdCBoYW5kbGVyOiBQcm90b2NvbEhhbmRsZXIgPSAocGFyYW1zKSA9PiB7XG4gICAgY29uc3QgcGFyc2VkID0gcGFyc2VQYWlyRGVlcExpbmsocGFyYW1zKTtcbiAgICBpZiAoIXBhcnNlZC5vaykge1xuICAgICAgLy8gTWlzc2luZyBib3RoIFx1MjE5MiBhIGJhcmUgb2JzaWRpYW46Ly92YXVsdHN5bmNmb3JhZ2VudHMgaGl0OyBzdGF5IHF1aWV0LlxuICAgICAgaWYgKHBhcnNlZC5lcnJvciAhPT0gJ25vIHBhaXJpbmcgcGFyYW1ldGVycycpIHtcbiAgICAgICAgbmV3IE5vdGljZShgVmF1bHRTeW5jIGRlZXAgbGluazogJHtwYXJzZWQuZXJyb3J9YCk7XG4gICAgICB9XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHZvaWQgb25QYWlyKHBhcnNlZC5saW5rKS5jYXRjaCgoZXJyb3I6IHVua25vd24pID0+IHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ1t2c2FdIGRlZXAtbGluayBwYWlyaW5nIGZhaWxlZCcsIGVycm9yKTtcbiAgICAgIG5ldyBOb3RpY2UoJ1ZhdWx0U3luYzogcGFpcmluZyB2aWEgbGluayBmYWlsZWQgXHUyMDE0IHNlZSB0aGUgY29uc29sZSBmb3IgZGV0YWlscy4nKTtcbiAgICB9KTtcbiAgfTtcbiAgcmVnaXN0ZXIoUFJPVE9DT0xfQUNUSU9OLCBoYW5kbGVyKTtcbiAgLy8gUmVnaXN0ZXIgdGhlIHBhdGgtc3BlbGxlZCBhY3Rpb24gdG9vIChidWlsZC1kZXBlbmRlbnQgbWF0Y2hpbmcpLlxuICByZWdpc3RlcihgJHtQUk9UT0NPTF9BQ1RJT059L3BhaXJgLCBoYW5kbGVyKTtcbn1cbiIsICIvKipcbiAqIFJlY29ubmVjdCBwb2xpY3kgKHBsdWdpbiBzY29wZSBpdGVtICM1KTogZXhwb25lbnRpYWwgYmFja29mZiB3aXRoIGppdHRlcixcbiAqIGNhcHBlZCBhdCA2MCBzLiBUaGUgcGx1Z2luJ3MgMSBzIHN1cGVydmlzaW9uIHRpY2sgYXNrcyB0aGUgc3VwZXJ2aXNvciB3aGF0XG4gKiB0byBkbyB3aGVuZXZlciB0aGUgY2xpZW50IHJlcG9ydHMgYGRpc2Nvbm5lY3RlZGA7IGEgc2NoZWR1bGVkIHJlY29ubmVjdCBpc1xuICogYSBzaW5nbGUgZmxpZ2h0IFx1MjAxNCBuZXZlciBhIHN0YWNrIG9mIHJldHJpZXMuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBTeW5jQ2xpZW50U3RhdGUgfSBmcm9tICdAdnNhL2NvcmUnO1xuXG5leHBvcnQgaW50ZXJmYWNlIEJhY2tvZmZPcHRpb25zIHtcbiAgLyoqIEZpcnN0IGF0dGVtcHQgZGVsYXkgKGRlZmF1bHQgMSBzKS4gKi9cbiAgYmFzZU1zPzogbnVtYmVyO1xuICAvKiogQ2VpbGluZyAoZGVmYXVsdCA2MCBzIHBlciB0aGUgcGx1Z2luIHNwZWMpLiAqL1xuICBjYXBNcz86IG51bWJlcjtcbiAgLyoqIEppdHRlciBmcmFjdGlvbiBhcm91bmQgdGhlIGV4cG9uZW50aWFsIHZhbHVlLCAwXHUyMDEzMC41IChkZWZhdWx0IDAuMykuICovXG4gIGppdHRlcj86IG51bWJlcjtcbiAgLyoqIEluamVjdGFibGUgcmFuZG9tbmVzcyAodGVzdHMpLiBEZWZhdWx0IGBNYXRoLnJhbmRvbWAuICovXG4gIHJhbmRvbT86ICgpID0+IG51bWJlcjtcbn1cblxuZXhwb3J0IGNvbnN0IERFRkFVTFRfUkVDT05ORUNUX0JBU0VfTVMgPSAxMDAwO1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfUkVDT05ORUNUX0NBUF9NUyA9IDYwXzAwMDtcblxuLyoqXG4gKiBEZWxheSBmb3IgYXR0ZW1wdCBOICgwLWJhc2VkKTogYG1pbihjYXAsIGJhc2UgXHUwMEI3IDJeYXR0ZW1wdClgIHdpdGggc3ltbWV0cmljXG4gKiBtdWx0aXBsaWNhdGl2ZSBqaXR0ZXIsIGZsb29yZWQgYXQgMjUwIG1zLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYmFja29mZkRlbGF5TXMoYXR0ZW1wdDogbnVtYmVyLCBvcHRpb25zOiBCYWNrb2ZmT3B0aW9ucyA9IHt9KTogbnVtYmVyIHtcbiAgY29uc3QgYmFzZSA9IG9wdGlvbnMuYmFzZU1zID8/IERFRkFVTFRfUkVDT05ORUNUX0JBU0VfTVM7XG4gIGNvbnN0IGNhcCA9IG9wdGlvbnMuY2FwTXMgPz8gREVGQVVMVF9SRUNPTk5FQ1RfQ0FQX01TO1xuICBjb25zdCBqaXR0ZXIgPSBvcHRpb25zLmppdHRlciA/PyAwLjM7XG4gIGNvbnN0IHJhbmRvbSA9IG9wdGlvbnMucmFuZG9tID8/IE1hdGgucmFuZG9tO1xuICBjb25zdCBleHBvbmVudGlhbCA9IE1hdGgubWluKGNhcCwgYmFzZSAqIDIgKiogYXR0ZW1wdCk7XG4gIGNvbnN0IGZhY3RvciA9IDEgKyAocmFuZG9tKCkgKiAyIC0gMSkgKiBqaXR0ZXI7XG4gIHJldHVybiBNYXRoLnJvdW5kKE1hdGgubWluKGNhcCwgTWF0aC5tYXgoMjUwLCBleHBvbmVudGlhbCAqIGZhY3RvcikpKTtcbn1cblxuZXhwb3J0IHR5cGUgUmVjb25uZWN0RGVjaXNpb24gPSB7IGFjdGlvbjogJ3JlY29ubmVjdCc7IGRlbGF5TXM6IG51bWJlciB9IHwgeyBhY3Rpb246ICd3YWl0JyB9O1xuXG4vKipcbiAqIFRyYWNrcyByZWNvbm5lY3QgYXR0ZW1wdHMgYWNyb3NzIHRoZSBzdXBlcnZpc2lvbiB0aWNrLiBOb24tZGlzY29ubmVjdGVkXG4gKiBzdGF0ZXMgcmVzZXQgdGhlIGJhY2tvZmYgbGFkZGVyIChhIHN1Y2Nlc3NmdWwgY3ljbGUgbWVhbnMgdGhlIG5ldHdvcmsgaXNcbiAqIGJhY2spOyBgc2NoZWR1bGVkYCBrZWVwcyBleGFjdGx5IG9uZSByZWNvbm5lY3QgaW4gZmxpZ2h0LlxuICovXG5leHBvcnQgY2xhc3MgUmVjb25uZWN0U3VwZXJ2aXNvciB7XG4gIHByaXZhdGUgYXR0ZW1wdCA9IDA7XG4gIHByaXZhdGUgc2NoZWR1bGVkID0gZmFsc2U7XG4gIHByaXZhdGUgcmVhZG9ubHkgb3B0aW9uczogQmFja29mZk9wdGlvbnM7XG5cbiAgY29uc3RydWN0b3Iob3B0aW9uczogQmFja29mZk9wdGlvbnMgPSB7fSkge1xuICAgIHRoaXMub3B0aW9ucyA9IG9wdGlvbnM7XG4gIH1cblxuICAvKiogQ2FsbCBlYWNoIHRpY2s7IG9uIGByZWNvbm5lY3RgLCBmb2xsb3cgdXAgd2l0aCBgYWNrbm93bGVkZ2VkKClgLiAqL1xuICBjb25zaWRlcihzdGF0ZTogU3luY0NsaWVudFN0YXRlKTogUmVjb25uZWN0RGVjaXNpb24ge1xuICAgIGlmIChzdGF0ZSAhPT0gJ2Rpc2Nvbm5lY3RlZCcpIHtcbiAgICAgIHRoaXMuYXR0ZW1wdCA9IDA7XG4gICAgICB0aGlzLnNjaGVkdWxlZCA9IGZhbHNlO1xuICAgICAgcmV0dXJuIHsgYWN0aW9uOiAnd2FpdCcgfTtcbiAgICB9XG4gICAgaWYgKHRoaXMuc2NoZWR1bGVkKSByZXR1cm4geyBhY3Rpb246ICd3YWl0JyB9O1xuICAgIHJldHVybiB7IGFjdGlvbjogJ3JlY29ubmVjdCcsIGRlbGF5TXM6IGJhY2tvZmZEZWxheU1zKHRoaXMuYXR0ZW1wdCwgdGhpcy5vcHRpb25zKSB9O1xuICB9XG5cbiAgLyoqIE1hcmsgdGhlIHJldHVybmVkIHJlY29ubmVjdCBhcyBpbiBmbGlnaHQgKG9uZSBhdCBhIHRpbWUpLiAqL1xuICBhY2tub3dsZWRnZWQoKTogdm9pZCB7XG4gICAgdGhpcy5hdHRlbXB0ICs9IDE7XG4gICAgdGhpcy5zY2hlZHVsZWQgPSB0cnVlO1xuICB9XG5cbiAgLyoqIFRoZSBpbi1mbGlnaHQgcmVjb25uZWN0IHNldHRsZWQgKHN1Y2Nlc3Mgb3IgZmFpbHVyZSkuICovXG4gIHNldHRsZWQoKTogdm9pZCB7XG4gICAgdGhpcy5zY2hlZHVsZWQgPSBmYWxzZTtcbiAgfVxuXG4gIC8qKiBDb21wbGV0ZWQgcmVjb25uZWN0IGF0dGVtcHRzIHNpbmNlIHRoZSBsYXN0IGhlYWx0aHkgc3RhdGUuICovXG4gIGdldCBhdHRlbXB0cygpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLmF0dGVtcHQ7XG4gIH1cbn1cbiIsICIvKipcbiAqIFRoZSBzZXR0aW5ncyB0YWIgKHBsdWdpbiBzY29wZSBpdGVtICM2KSwgb3JnYW5pemVkIGluIGZvdXIgc2VjdGlvbnM6XG4gKlxuICogICBDb25uZWN0aW9uIFx1MjAxNCB3b3JrZXIgVVJMLCBkZXZpY2UgbmFtZSAocGFpcmluZy10aW1lIE9SIHJlbmFtZSB3aGVuXG4gKiAgICAgICAgICAgICAgICBsaW5rZWQpLCBwYWlyaW5nIGZvcm0gLyBzdGF0dXMgcmVhZG91dCArIFN5bmMgbm93ICsgdW5saW5rXG4gKiAgIFN5bmMgICAgICAgXHUyMDE0IHJlc2NhbiBpbnRlcnZhbCwgLm9ic2lkaWFuLyB0b2dnbGUsIHBhdXNlL3Jlc3VtZSxcbiAqICAgICAgICAgICAgICAgIHN5bmMtb24tc3RhcnR1cFxuICogICBBZHZhbmNlZCAgIFx1MjAxNCBzdGF0dXMtYmFyIGluZGljYXRvciBtb2RlLCBpZ25vcmUgcGF0dGVybnMsIGRpYWdub3N0aWNzXG4gKiAgICAgICAgICAgICAgICAobG9nIGxldmVsICsgQ29weSBkaWFnbm9zdGljcyArIFNhdmUgc3VwcG9ydCBidW5kbGUpXG4gKiAgIEFib3V0ICAgICAgXHUyMDE0IHZlcnNpb25zLCBzdG9yYWdlIHVzYWdlLCBwcm9qZWN0IFJFQURNRSBsaW5rXG4gKlxuICogQWxsIGxvZ2ljIGxpdmVzIG9uIGBWYXVsdFN5bmNQbHVnaW5gOyB0aGUgdGFiIGlzIHByZXNlbnRhdGlvbiBwbHVzIHdpcmluZy5cbiAqL1xuXG5pbXBvcnQgeyBNb2RhbCwgTm90aWNlLCBQbHVnaW5TZXR0aW5nVGFiLCBTZXR0aW5nIH0gZnJvbSAnb2JzaWRpYW4nO1xuaW1wb3J0IHR5cGUgeyBBcHAgfSBmcm9tICdvYnNpZGlhbic7XG5pbXBvcnQge1xuICBkZWZhdWx0RGV2aWNlTmFtZSxcbiAgUkVTQ0FOX0lOVEVSVkFMX0NIT0lDRVMsXG4gIHR5cGUgTG9nTGV2ZWwsXG4gIHR5cGUgVmF1bHRTeW5jUGx1Z2luRGF0YSxcbn0gZnJvbSAnLi9kYXRhLmpzJztcbmltcG9ydCB0eXBlIHsgUGFpck91dGNvbWUgfSBmcm9tICcuL3BhaXJpbmcuanMnO1xuaW1wb3J0IHsgcGFpck91dGNvbWVNZXNzYWdlIH0gZnJvbSAnLi9wYWlyaW5nLmpzJztcbmltcG9ydCB7IGZvcm1hdEJ5dGVzLCBQUk9UT0NPTF9WRVJTSU9OIH0gZnJvbSAnLi9kaWFnbm9zdGljcy5qcyc7XG5pbXBvcnQgeyBmb3JtYXRTaW5jZSB9IGZyb20gJy4vc3RhdHVzYmFyLmpzJztcbmltcG9ydCB0eXBlIHsgVmF1bHRTeW5jUGx1Z2luIH0gZnJvbSAnLi9wbHVnaW4uanMnO1xuXG4vKipcbiAqIENsb3VkZmxhcmUgRGVwbG95IEJ1dHRvbiB0YXJnZXQgKEZSLTIxKTogcHJvdmlzaW9ucyBhIHByZWNvbmZpZ3VyZWQgd29ya2VyXG4gKiArIER1cmFibGUgT2JqZWN0ICsgUjIgYnVja2V0IGluIHRoZSB1c2VyJ3Mgb3duIGFjY291bnQgXHUyMDE0IG5vIHdyYW5nbGVyLCBub1xuICogbWFudWFsIGNvbmZpZy4gVGhlIHRlbXBsYXRlIHJlcG8gcGlucyBhIHJlbGVhc2VkIHdvcmtlciB2ZXJzaW9uLlxuICovXG5leHBvcnQgY29uc3QgREVQTE9ZX1VSTCA9XG4gICdodHRwczovL2RlcGxveS53b3JrZXJzLmNsb3VkZmxhcmUuY29tLz91cmw9JyArXG4gICdodHRwczovL2dpdGh1Yi5jb20vYW51Y2hpbi92YXVsdHN5bmNmb3JhZ2VudHMtdGVtcGxhdGUnO1xuXG4vKiogVGhlIHByb2plY3QgUkVBRE1FICh0aGUgQWJvdXQgc2VjdGlvbidzIGxpbmspLiAqL1xuZXhwb3J0IGNvbnN0IFBST0pFQ1RfUkVBRE1FX1VSTCA9ICdodHRwczovL2dpdGh1Yi5jb20vYW51Y2hpbi92YXVsdHN5bmNmb3JhZ2VudHMjcmVhZG1lJztcblxuLyoqIE9wZW4gdGhlIGRlcGxveSBwYWdlIGluIHRoZSBzeXN0ZW0gYnJvd3NlciAobm8tb3Agd2hlcmUgYHdpbmRvd2AgaXMgYWJzZW50KS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBvcGVuRGVwbG95UGFnZSgpOiB2b2lkIHtcbiAgaWYgKHR5cGVvZiB3aW5kb3cgPT09ICd1bmRlZmluZWQnKSByZXR1cm47XG4gIHdpbmRvdy5vcGVuKERFUExPWV9VUkwsICdfYmxhbmsnKTtcbn1cblxuLyoqIE9wZW4gdGhlIHByb2plY3QgUkVBRE1FIGluIHRoZSBzeXN0ZW0gYnJvd3NlciAobm8tb3Agd2l0aG91dCBgd2luZG93YCkuICovXG5leHBvcnQgZnVuY3Rpb24gb3BlblJlYWRtZVBhZ2UoKTogdm9pZCB7XG4gIGlmICh0eXBlb2Ygd2luZG93ID09PSAndW5kZWZpbmVkJykgcmV0dXJuO1xuICB3aW5kb3cub3BlbihQUk9KRUNUX1JFQURNRV9VUkwsICdfYmxhbmsnKTtcbn1cblxuLyoqIFNtYWxsIGNvbmZpcm1hdGlvbiBkaWFsb2cgKHRoZSB1bmxpbmsgYnV0dG9uJ3Mgc2FmZXR5IG5ldCkuICovXG5leHBvcnQgY2xhc3MgQ29uZmlybU1vZGFsIGV4dGVuZHMgTW9kYWwge1xuICBjb25zdHJ1Y3RvcihcbiAgICBhcHA6IEFwcCxcbiAgICBwcml2YXRlIHJlYWRvbmx5IG9wdGlvbnM6IHtcbiAgICAgIHRpdGxlOiBzdHJpbmc7XG4gICAgICBib2R5OiBzdHJpbmc7XG4gICAgICBjb25maXJtVGV4dDogc3RyaW5nO1xuICAgICAgb25Db25maXJtOiAoKSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPjtcbiAgICB9LFxuICApIHtcbiAgICBzdXBlcihhcHApO1xuICB9XG5cbiAgb3ZlcnJpZGUgb25PcGVuKCk6IHZvaWQge1xuICAgIG5ldyBTZXR0aW5nKHRoaXMuY29udGVudEVsKS5zZXROYW1lKHRoaXMub3B0aW9ucy50aXRsZSkuc2V0RGVzYyh0aGlzLm9wdGlvbnMuYm9keSk7XG4gICAgbmV3IFNldHRpbmcodGhpcy5jb250ZW50RWwpLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoJ0NhbmNlbCcpLm9uQ2xpY2soKCkgPT4gdGhpcy5jbG9zZSgpKSxcbiAgICApO1xuICAgIG5ldyBTZXR0aW5nKHRoaXMuY29udGVudEVsKS5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgIGJ1dHRvblxuICAgICAgICAuc2V0Q3RhKClcbiAgICAgICAgLnNldEJ1dHRvblRleHQodGhpcy5vcHRpb25zLmNvbmZpcm1UZXh0KVxuICAgICAgICAub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgdGhpcy5jbG9zZSgpO1xuICAgICAgICAgIGF3YWl0IHRoaXMub3B0aW9ucy5vbkNvbmZpcm0oKTtcbiAgICAgICAgfSksXG4gICAgKTtcbiAgfVxufVxuXG5leHBvcnQgY2xhc3MgVmF1bHRTeW5jU2V0dGluZ1RhYiBleHRlbmRzIFBsdWdpblNldHRpbmdUYWIge1xuICBwcml2YXRlIHJlYWRvbmx5IHBsdWdpbjogVmF1bHRTeW5jUGx1Z2luO1xuICAvKiogUGFpcmluZyBjb2RlcyBuZXZlciB0b3VjaCBkaXNrIFx1MjAxNCB0aGV5IGFyZSBvbmUtdGltZSwgc2hvcnQtbGl2ZWQgc2VjcmV0cy4gKi9cbiAgcHJpdmF0ZSBwYWlyaW5nQ29kZSA9ICcnO1xuICAvKipcbiAgICogTGlua2VkLW1vZGUgZGV2aWNlLW5hbWUgZHJhZnQ6IGVkaXRzIHN0YWdlIGhlcmUgKE5PVCBpbiBwbHVnaW4gZGF0YSkgc28gYVxuICAgKiBmYWlsZWQgcmVuYW1lIGNhbm5vdCBsZWF2ZSB0aGUgbG9jYWwgbmFtZSBvdXQgb2Ygc3luYyB3aXRoIHRoZSB3b3JrZXIuXG4gICAqL1xuICBwcml2YXRlIHJlbmFtZURyYWZ0OiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBoaW50U2V0dGluZzogU2V0dGluZyB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHN0YXR1c1NldHRpbmc6IFNldHRpbmcgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBzdG9yYWdlU2V0dGluZzogU2V0dGluZyB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHNlcnZlclZlcnNpb25TZXR0aW5nOiBTZXR0aW5nIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgcmVmcmVzaEhhbmRsZTogUmV0dXJuVHlwZTx0eXBlb2Ygc2V0SW50ZXJ2YWw+IHwgbnVsbCA9IG51bGw7XG5cbiAgY29uc3RydWN0b3IoYXBwOiBBcHAsIHBsdWdpbjogVmF1bHRTeW5jUGx1Z2luKSB7XG4gICAgc3VwZXIoYXBwLCBwbHVnaW4pO1xuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xuICB9XG5cbiAgb3ZlcnJpZGUgZGlzcGxheSgpOiB2b2lkIHtcbiAgICB0aGlzLnN0b3BSZWZyZXNoKCk7XG4gICAgY29uc3QgeyBjb250YWluZXJFbCB9ID0gdGhpcztcbiAgICBjb250YWluZXJFbC5lbXB0eSgpO1xuICAgIHRoaXMuaGludFNldHRpbmcgPSBudWxsO1xuICAgIHRoaXMuc3RhdHVzU2V0dGluZyA9IG51bGw7XG4gICAgdGhpcy5zdG9yYWdlU2V0dGluZyA9IG51bGw7XG4gICAgdGhpcy5zZXJ2ZXJWZXJzaW9uU2V0dGluZyA9IG51bGw7XG4gICAgdGhpcy5yZW5hbWVEcmFmdCA9IG51bGw7XG5cbiAgICB0aGlzLnJlbmRlckNvbm5lY3Rpb25TZWN0aW9uKCk7XG4gICAgdGhpcy5yZW5kZXJTeW5jU2VjdGlvbigpO1xuICAgIHRoaXMucmVuZGVyQWR2YW5jZWRTZWN0aW9uKCk7XG4gICAgdGhpcy5yZW5kZXJBYm91dFNlY3Rpb24oKTtcbiAgICB0aGlzLnN0YXJ0UmVmcmVzaCgpO1xuICB9XG5cbiAgb3ZlcnJpZGUgaGlkZSgpOiB2b2lkIHtcbiAgICB0aGlzLnN0b3BSZWZyZXNoKCk7XG4gIH1cblxuICAvLyAtLS0gc2VjdGlvbnMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICBwcml2YXRlIGhlYWRpbmcodGV4dDogc3RyaW5nKTogdm9pZCB7XG4gICAgbmV3IFNldHRpbmcodGhpcy5jb250YWluZXJFbCkuc2V0TmFtZSh0ZXh0KS5zZXRIZWFkaW5nKCk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlckNvbm5lY3Rpb25TZWN0aW9uKCk6IHZvaWQge1xuICAgIGNvbnN0IHsgY29udGFpbmVyRWwgfSA9IHRoaXM7XG4gICAgdGhpcy5oZWFkaW5nKCdDb25uZWN0aW9uJyk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdXb3JrZXIgVVJMJylcbiAgICAgIC5zZXREZXNjKFxuICAgICAgICAnWW91ciBzeW5jIHdvcmtlciwgZS5nLiBodHRwczovL3BlcnNvbmFsLngud29ya2Vycy5kZXYuIE5vIHdvcmtlciB5ZXQ/IFVzZSBcIkRlcGxveSB5b3VyIHdvcmtlclwiIGJlbG93LCBvcGVuIHRoZSBVUkwgaW4gYSBicm93c2VyLCBhbmQgY2xhaW0gaXQuJyxcbiAgICAgIClcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PlxuICAgICAgICB0ZXh0XG4gICAgICAgICAgLnNldFBsYWNlaG9sZGVyKCdodHRwczovL3BlcnNvbmFsLngud29ya2Vycy5kZXYnKVxuICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5kYXRhLnVybClcbiAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5kYXRhLnVybCA9IHZhbHVlLnRyaW0oKTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVQbHVnaW5EYXRhKCk7XG4gICAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgaWYgKHRoaXMucGx1Z2luLmxpbmtlZCkge1xuICAgICAgdGhpcy5yZW5kZXJMaW5rZWREZXZpY2VOYW1lKCk7XG4gICAgICB0aGlzLnJlbmRlckxpbmtlZFN0YXR1cygpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnJlbmRlclBhaXJpbmdEZXZpY2VOYW1lKCk7XG4gICAgICB0aGlzLnJlbmRlclBhaXJpbmdTZWN0aW9uKCk7XG4gICAgfVxuICB9XG5cbiAgLyoqIFVubGlua2VkOiB0aGUgbmFtZSBpcyBhIHBhaXJpbmctdGltZSBkZWZhdWx0IChhcHBsaWVzIGF0IG5leHQgcGFpcikuICovXG4gIHByaXZhdGUgcmVuZGVyUGFpcmluZ0RldmljZU5hbWUoKTogdm9pZCB7XG4gICAgbmV3IFNldHRpbmcodGhpcy5jb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdEZXZpY2UgbmFtZScpXG4gICAgICAuc2V0RGVzYyhgU2hvd24gaW4gdGhlIHdvcmtlciBkYXNoYm9hcmQncyBkZXZpY2UgbGlzdC4gQXBwbGllcyB3aGVuIChyZSlwYWlyaW5nLmApXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT5cbiAgICAgICAgdGV4dFxuICAgICAgICAgIC5zZXRQbGFjZWhvbGRlcihkZWZhdWx0RGV2aWNlTmFtZSgpKVxuICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5kYXRhLmRldmljZU5hbWUpXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4uZGF0YS5kZXZpY2VOYW1lID0gdmFsdWUudHJpbSgpO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVBsdWdpbkRhdGEoKTtcbiAgICAgICAgICB9KSxcbiAgICAgICk7XG4gIH1cblxuICAvKiogTGlua2VkOiB0aGUgZmllbGQgc2hvd3MgdGhlIGN1cnJlbnQgbmFtZTsgUmVuYW1lIHB1c2hlcyBpdCB0byB0aGUgd29ya2VyLiAqL1xuICBwcml2YXRlIHJlbmRlckxpbmtlZERldmljZU5hbWUoKTogdm9pZCB7XG4gICAgY29uc3QgY3VycmVudCA9IHRoaXMucmVuYW1lRHJhZnQgPz8gdGhpcy5wbHVnaW4uZGF0YS5kZXZpY2VOYW1lO1xuICAgIG5ldyBTZXR0aW5nKHRoaXMuY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnRGV2aWNlIG5hbWUnKVxuICAgICAgLnNldERlc2MoXG4gICAgICAgICdUaGUgd29ya2VyIGRhc2hib2FyZCBzaG93cyB0aGlzIG5hbWUuIEVkaXQgaXQgYW5kIHByZXNzIFwiUmVuYW1lIGRldmljZVwiIHRvIHVwZGF0ZSB0aGlzIGRldmljZSBvbiB0aGUgd29ya2VyICgxLTMwIGNoYXJhY3RlcnMpLicsXG4gICAgICApXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT5cbiAgICAgICAgdGV4dFxuICAgICAgICAgIC5zZXRQbGFjZWhvbGRlcihkZWZhdWx0RGV2aWNlTmFtZSgpKVxuICAgICAgICAgIC5zZXRWYWx1ZShjdXJyZW50KVxuICAgICAgICAgIC5vbkNoYW5nZSgodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMucmVuYW1lRHJhZnQgPSB2YWx1ZTtcbiAgICAgICAgICB9KSxcbiAgICAgIClcbiAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoJ1JlbmFtZSBkZXZpY2UnKS5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICBidXR0b24uc2V0RGlzYWJsZWQodHJ1ZSk7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IG9rID0gYXdhaXQgdGhpcy5wbHVnaW4ucmVuYW1lRGV2aWNlKHRoaXMucmVuYW1lRHJhZnQgPz8gdGhpcy5wbHVnaW4uZGF0YS5kZXZpY2VOYW1lKTtcbiAgICAgICAgICAgIGlmIChvaykgdGhpcy5kaXNwbGF5KCk7IC8vIHJlLXJlbmRlciB3aXRoIHRoZSBwZXJzaXN0ZWQgbmFtZVxuICAgICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICBidXR0b24uc2V0RGlzYWJsZWQoZmFsc2UpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSksXG4gICAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJQYWlyaW5nU2VjdGlvbigpOiB2b2lkIHtcbiAgICBjb25zdCB7IGNvbnRhaW5lckVsIH0gPSB0aGlzO1xuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ1BhaXJpbmcgY29kZScpXG4gICAgICAuc2V0RGVzYygnRnJvbSB5b3VyIHdvcmtlciBkYXNoYm9hcmQ6IERldmljZXMgXHUyMTkyIFBhaXIgbmV3IGRldmljZS4gQ29kZXMgYXJlIG9uZS10aW1lIGFuZCBleHBpcmUgYWZ0ZXIgMTAgbWludXRlcy4nKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHRcbiAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoJzdGM0stUTlNMicpXG4gICAgICAgICAgLm9uQ2hhbmdlKCh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5wYWlyaW5nQ29kZSA9IHZhbHVlLnRyaW0oKTtcbiAgICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbCkuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICBidXR0b25cbiAgICAgICAgLnNldEN0YSgpXG4gICAgICAgIC5zZXRCdXR0b25UZXh0KCdQYWlyIHRoaXMgdmF1bHQnKVxuICAgICAgICAub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgYnV0dG9uLnNldERpc2FibGVkKHRydWUpO1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBvdXRjb21lID0gYXdhaXQgdGhpcy5wbHVnaW4ucGFpckZyb21TZXR0aW5ncyh0aGlzLnBhaXJpbmdDb2RlKTtcbiAgICAgICAgICAgIHRoaXMuc2hvd091dGNvbWUob3V0Y29tZSk7XG4gICAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICAgIGJ1dHRvbi5zZXREaXNhYmxlZChmYWxzZSk7XG4gICAgICAgICAgfVxuICAgICAgICB9KSxcbiAgICApO1xuXG4gICAgdGhpcy5oaW50U2V0dGluZyA9IG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ0dldHRpbmcgc3RhcnRlZCcpXG4gICAgICAuc2V0Q2xhc3MoJ3ZzYS1zZXR0aW5ncy1oaW50JylcbiAgICAgIC5zZXREZXNjKFxuICAgICAgICBbXG4gICAgICAgICAgJzEuIERlcGxveSB5b3VyIG93biB3b3JrZXIgd2l0aCB0aGUgYnV0dG9uIGJlbG93ICh5b3VyIENsb3VkZmxhcmUgYWNjb3VudCwgcHJlY29uZmlndXJlZCBcdTIwMTQgbm8gd3JhbmdsZXIpLicsXG4gICAgICAgICAgJzIuIE9wZW4gdGhlIHdvcmtlciBVUkwgaW4gYSBicm93c2VyIGFuZCBzZXQgdGhlIGFkbWluIHBhc3NwaHJhc2UgKGNsYWltKS4nLFxuICAgICAgICAgICczLiBDcmVhdGUgYSBwYWlyaW5nIGNvZGUgb24gdGhlIGRhc2hib2FyZCwgcGFzdGUgaXQgYWJvdmUsIGFuZCBwYWlyLicsXG4gICAgICAgICAgJ09uIGEgcGhvbmUsIHNjYW5uaW5nIHRoZSBkYXNoYm9hcmQgUVIgb3IgdGFwcGluZyBpdHMgb2JzaWRpYW46Ly8gbGluayBwYWlycyB3aXRob3V0IHR5cGluZy4nLFxuICAgICAgICBdLmpvaW4oJ1xcbicpLFxuICAgICAgKVxuICAgICAgLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgICBidXR0b24uc2V0QnV0dG9uVGV4dCgnRGVwbG95IHlvdXIgd29ya2VyJykub25DbGljaygoKSA9PiBvcGVuRGVwbG95UGFnZSgpKSxcbiAgICAgICk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlckxpbmtlZFN0YXR1cygpOiB2b2lkIHtcbiAgICBjb25zdCB7IGNvbnRhaW5lckVsIH0gPSB0aGlzO1xuXG4gICAgdGhpcy5zdGF0dXNTZXR0aW5nID0gbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnU3RhdHVzJylcbiAgICAgIC5zZXRDbGFzcygndnNhLXN0YXR1cy1yZWFkb3V0JylcbiAgICAgIC5zZXREZXNjKHRoaXMuc3RhdHVzVGV4dCgpKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKS5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KCdTeW5jIG5vdycpLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICBidXR0b24uc2V0RGlzYWJsZWQodHJ1ZSk7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc3luY05vdygpO1xuICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgIGJ1dHRvbi5zZXREaXNhYmxlZChmYWxzZSk7XG4gICAgICAgICAgdGhpcy5yZWZyZXNoU3RhdHVzKCk7XG4gICAgICAgIH1cbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbCkuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICBidXR0b24uc2V0QnV0dG9uVGV4dCgnVW5saW5rIHRoaXMgdmF1bHQnKS5vbkNsaWNrKCgpID0+IHtcbiAgICAgICAgbmV3IENvbmZpcm1Nb2RhbCh0aGlzLmFwcCwge1xuICAgICAgICAgIHRpdGxlOiAnVW5saW5rIFZhdWx0U3luYz8nLFxuICAgICAgICAgIGJvZHk6ICdUaGlzIHN0b3BzIHN5bmNpbmcgYW5kIGNsZWFycyB0aGlzIGRldmljZVxcdTIwMTlzIGxvY2FsIHN5bmMgc3RhdGUuIEZpbGVzIGFscmVhZHkgaW4gdGhlIHZhdWx0IGFyZSB1bnRvdWNoZWQuIFRoZSB3b3JrZXIga2VlcHMgdGhpcyBkZXZpY2UgaW4gaXRzIHJlZ2lzdHJ5IFxcdTIwMTQgcmV2b2tlIGl0IGZyb20gdGhlIGRhc2hib2FyZCBpZiB5b3UgYXJlIGRvbmUgd2l0aCBpdC4nLFxuICAgICAgICAgIGNvbmZpcm1UZXh0OiAnVW5saW5rJyxcbiAgICAgICAgICBvbkNvbmZpcm06IGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnVubGluaygpO1xuICAgICAgICAgICAgdGhpcy5kaXNwbGF5KCk7XG4gICAgICAgICAgfSxcbiAgICAgICAgfSkub3BlbigpO1xuICAgICAgfSksXG4gICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyU3luY1NlY3Rpb24oKTogdm9pZCB7XG4gICAgY29uc3QgeyBjb250YWluZXJFbCB9ID0gdGhpcztcbiAgICBjb25zdCBkYXRhID0gdGhpcy5wbHVnaW4uZGF0YTtcbiAgICB0aGlzLmhlYWRpbmcoJ1N5bmMnKTtcblxuICAgIGlmICh0aGlzLnBsdWdpbi5saW5rZWQpIHtcbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZSgnUmVzY2FuIGludGVydmFsJylcbiAgICAgICAgLnNldERlc2MoXG4gICAgICAgICAgJ1BlcmlvZGljIGZ1bGwgcmVjb25jaWxpYXRpb24gXHUyMDE0IGNhdGNoZXMgZXh0ZXJuYWwgZWRpdHMgd2hpbGUgT2JzaWRpYW4gaXMgb3BlbiBhbmQgY292ZXJzIG1vYmlsZSBiYWNrZ3JvdW5kIGxpbWl0cy4gVmF1bHQgZXZlbnRzIGFuZCBhcHAtb3BlbiBzeW5jIGFsd2F5cyBydW4uJyxcbiAgICAgICAgKVxuICAgICAgICAuYWRkRHJvcGRvd24oKGRyb3Bkb3duKSA9PiB7XG4gICAgICAgICAgZm9yIChjb25zdCBjaG9pY2Ugb2YgUkVTQ0FOX0lOVEVSVkFMX0NIT0lDRVMpIHtcbiAgICAgICAgICAgIGRyb3Bkb3duLmFkZE9wdGlvbihTdHJpbmcoY2hvaWNlLnZhbHVlKSwgY2hvaWNlLmxhYmVsKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgZHJvcGRvd24uc2V0VmFsdWUoU3RyaW5nKGRhdGEuc2V0dGluZ3MucmVzY2FuSW50ZXJ2YWxTZWMpKTtcbiAgICAgICAgICBkcm9wZG93bi5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLmFwcGx5UmVzY2FuSW50ZXJ2YWwoTnVtYmVyKHZhbHVlKSk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUoJ1N5bmMgLm9ic2lkaWFuLyBmb2xkZXInKVxuICAgICAgICAuc2V0RGVzYyhcbiAgICAgICAgICAnT3B0IGluIHRvIHN5bmNpbmcgLm9ic2lkaWFuLyAoc2V0dGluZ3MgYW5kIHBsdWdpbnMpLCBleGNsdWRpbmcgd29ya3NwYWNlLmpzb24gYW5kIGNhY2hlcy4gJyArXG4gICAgICAgICAgICAnVGhlIHdvcmtlclxcdTIwMTlzIHBlci12YXVsdCBzZXR0aW5nIHRha2VzIHByZWNlZGVuY2Ugb25jZSBjb25uZWN0ZWQuJyxcbiAgICAgICAgKVxuICAgICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgICAgdG9nZ2xlLnNldFZhbHVlKGRhdGEuc2V0dGluZ3Mub2JzaWRpYW5TeW5jKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLmFwcGx5T2JzaWRpYW5TeW5jKHZhbHVlKTtcbiAgICAgICAgICB9KSxcbiAgICAgICAgKTtcblxuICAgICAgY29uc3QgcGF1c2VkID0gdGhpcy5wbHVnaW4uc3luY2luZ1BhdXNlZDtcbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZShwYXVzZWQgPyAnU3luY2luZyBwYXVzZWQnIDogJ1BhdXNlIHN5bmNpbmcnKVxuICAgICAgICAuc2V0RGVzYyhcbiAgICAgICAgICBwYXVzZWRcbiAgICAgICAgICAgID8gJ1N5bmNpbmcgaXMgcGF1c2VkOiB0aGUgY29ubmVjdGlvbiBpcyBkb3duIGFuZCB2YXVsdCBjaGFuZ2VzIHN0YXkgbG9jYWwuIFJlc3VtZSByZWNvbm5lY3RzIGFuZCBydW5zIGEgZnVsbCBjYXRjaC11cCBzeW5jLidcbiAgICAgICAgICAgIDogJ1RlbXBvcmFyaWx5IHN0b3Agc3luY2luZyB3aXRob3V0IHVubGlua2luZyBcdTIwMTQgdGhlIHRyYW5zcG9ydCBkaXNjb25uZWN0cyBhbmQgdGhlIHdhdGNoZXIgZ29lcyBpZGxlLiBZb3VyIGxpbmsgYW5kIGxvY2FsIHN0YXRlIGFyZSBrZXB0LicsXG4gICAgICAgIClcbiAgICAgICAgLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgICAgIGJ1dHRvblxuICAgICAgICAgICAgLnNldEJ1dHRvblRleHQocGF1c2VkID8gJ1Jlc3VtZSBzeW5jaW5nJyA6ICdQYXVzZSBzeW5jaW5nJylcbiAgICAgICAgICAgIC5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgICAgYnV0dG9uLnNldERpc2FibGVkKHRydWUpO1xuICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGlmIChwYXVzZWQpIGF3YWl0IHRoaXMucGx1Z2luLnJlc3VtZVN5bmNpbmcoKTtcbiAgICAgICAgICAgICAgICBlbHNlIHRoaXMucGx1Z2luLnBhdXNlU3luY2luZygpO1xuICAgICAgICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgICAgICAgIHRoaXMuZGlzcGxheSgpOyAvLyByZS1yZW5kZXI6IHRoZSBidXR0b24gKGFuZCBsYWJlbCkgZmxpcFxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KSxcbiAgICAgICAgKTtcbiAgICB9XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdTeW5jIG9uIHN0YXJ0dXAnKVxuICAgICAgLnNldERlc2MoXG4gICAgICAgICdPTiAoZGVmYXVsdCk6IHN5bmMgc3RhcnRzIGFzIHNvb24gYXMgT2JzaWRpYW4gb3BlbnMuIE9GRjogdGhlIHBsdWdpbiBsb2FkcyBpZGxlIGFuZCB0aGUgZmlyc3QgXCJTeW5jIG5vd1wiIHByZXNzIHN0YXJ0cyBzeW5jaW5nIChtYW51YWwtb25seSBtb2RlKS4nLFxuICAgICAgKVxuICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICB0b2dnbGUuc2V0VmFsdWUoZGF0YS5zZXR0aW5ncy5zeW5jT25TdGFydHVwKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5hcHBseVN5bmNPblN0YXJ0dXAodmFsdWUpO1xuICAgICAgICB9KSxcbiAgICAgICk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlckFkdmFuY2VkU2VjdGlvbigpOiB2b2lkIHtcbiAgICBjb25zdCB7IGNvbnRhaW5lckVsIH0gPSB0aGlzO1xuICAgIGNvbnN0IGRhdGEgPSB0aGlzLnBsdWdpbi5kYXRhO1xuICAgIHRoaXMuaGVhZGluZygnQWR2YW5jZWQnKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ1N0YXR1cyBiYXIgaW5kaWNhdG9yJylcbiAgICAgIC5zZXREZXNjKFxuICAgICAgICAnRGV0YWlsZWQ6IFwidnNhIFx1MjcxMyAxMnNcIiB3aXRoIHN0YXRlIGFuZCBhZ2UuIENvbXBhY3Q6IGp1c3QgdGhlIHN5bWJvbC4gSGlkZGVuOiBubyBzdGF0dXMgYmFyIGl0ZW0gYXQgYWxsLicsXG4gICAgICApXG4gICAgICAuYWRkRHJvcGRvd24oKGRyb3Bkb3duKSA9PiB7XG4gICAgICAgIGRyb3Bkb3duLmFkZE9wdGlvbignZGV0YWlsZWQnLCAnRGV0YWlsZWQnKTtcbiAgICAgICAgZHJvcGRvd24uYWRkT3B0aW9uKCdjb21wYWN0JywgJ0NvbXBhY3QnKTtcbiAgICAgICAgZHJvcGRvd24uYWRkT3B0aW9uKCdoaWRkZW4nLCAnSGlkZGVuJyk7XG4gICAgICAgIGRyb3Bkb3duLnNldFZhbHVlKGRhdGEuc2V0dGluZ3Muc3RhdHVzQmFyTW9kZSk7XG4gICAgICAgIGRyb3Bkb3duLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLmFwcGx5U3RhdHVzQmFyTW9kZShcbiAgICAgICAgICAgIHZhbHVlID09PSAnY29tcGFjdCcgfHwgdmFsdWUgPT09ICdoaWRkZW4nID8gdmFsdWUgOiAnZGV0YWlsZWQnLFxuICAgICAgICAgICk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdJZ25vcmUgcGF0dGVybnMnKVxuICAgICAgLnNldERlc2MoXG4gICAgICAgICdPbmUgcGF0dGVybiBwZXIgbGluZSwgZS5nLiBwcml2YXRlLyoqIG9yICoudG1wLiBHbG9iLWxpdGU6ICogbWF0Y2hlcyB3aXRoaW4gb25lIGZvbGRlciBuYW1lLCAqKiBzcGFucyBmb2xkZXJzIChkaXIvKiogc2tpcHMgdGhlIGZvbGRlciBhbmQgZXZlcnl0aGluZyBpbiBpdCk7IGEgcGF0dGVybiB3aXRob3V0IC8gbWF0Y2hlcyBmaWxlIG5hbWVzIGF0IGFueSBkZXB0aC4gQ2FzZS1pbnNlbnNpdGl2ZTsgYXBwbGllcyBvbiB0aGlzIGRldmljZSBvbmx5OyBzYXZpbmcgcmVjb25uZWN0cyBzeW5jIHRvIGFwcGx5IHRoZW0uJyxcbiAgICAgIClcbiAgICAgIC5hZGRUZXh0QXJlYSgoYXJlYSkgPT5cbiAgICAgICAgYXJlYVxuICAgICAgICAgIC5zZXRQbGFjZWhvbGRlcigncHJpdmF0ZS8qKlxcbioudG1wJylcbiAgICAgICAgICAuc2V0VmFsdWUoZGF0YS5zZXR0aW5ncy5pZ25vcmVQYXR0ZXJucylcbiAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5hcHBseUlnbm9yZVBhdHRlcm5zKHZhbHVlKTtcbiAgICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdEaWFnbm9zdGljcyBsb2cgbGV2ZWwnKVxuICAgICAgLnNldERlc2MoXG4gICAgICAgICdpbmZvIChkZWZhdWx0KSByZWNvcmRzIGxpZmVjeWNsZSBldmVudHM7IGRlYnVnIGFkZGl0aW9uYWxseSBsb2dzIHByb3RvY29sIHJvdW5kLXRyaXBzIChvbmUgc2hvcnQgbGluZSBwZXIgZnJhbWUpOyB3YXJuIGtlZXBzIG9ubHkgd2FybmluZ3MgYW5kIGVycm9ycy4nLFxuICAgICAgKVxuICAgICAgLmFkZERyb3Bkb3duKChkcm9wZG93bikgPT4ge1xuICAgICAgICBkcm9wZG93bi5hZGRPcHRpb24oJ2luZm8nLCAnaW5mbycpO1xuICAgICAgICBkcm9wZG93bi5hZGRPcHRpb24oJ2RlYnVnJywgJ2RlYnVnJyk7XG4gICAgICAgIGRyb3Bkb3duLmFkZE9wdGlvbignd2FybicsICd3YXJuJyk7XG4gICAgICAgIGRyb3Bkb3duLnNldFZhbHVlKGRhdGEuc2V0dGluZ3MubG9nTGV2ZWwpO1xuICAgICAgICBkcm9wZG93bi5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICBjb25zdCBsZXZlbDogTG9nTGV2ZWwgPSB2YWx1ZSA9PT0gJ2RlYnVnJyB8fCB2YWx1ZSA9PT0gJ3dhcm4nID8gdmFsdWUgOiAnaW5mbyc7XG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uYXBwbHlMb2dMZXZlbChsZXZlbCk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdDb3B5IGRpYWdub3N0aWNzJylcbiAgICAgIC5zZXREZXNjKFxuICAgICAgICAnQ29waWVzIGEgYnVnLXJlcG9ydCBidW5kbGU6IHBsdWdpbiArIHByb3RvY29sIHZlcnNpb25zLCBkZXZpY2UsIHdvcmtlciBVUkwsIHBhaXJpbmcgc3RhdGUsIGEgc3RhdHVzIHNuYXBzaG90LCB0aGUgcGxhdGZvcm0sIGFuZCB0aGUgbGFzdCAyMCBsb2cgbGluZXMuJyxcbiAgICAgIClcbiAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoJ0NvcHkgZGlhZ25vc3RpY3MnKS5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICBidXR0b24uc2V0RGlzYWJsZWQodHJ1ZSk7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLmNvcHlEaWFnbm9zdGljcygpO1xuICAgICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICBidXR0b24uc2V0RGlzYWJsZWQoZmFsc2UpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnU2F2ZSBzdXBwb3J0IGJ1bmRsZScpXG4gICAgICAuc2V0RGVzYyhcbiAgICAgICAgJ1dyaXRlcyBhIHJpY2hlciBtYXJrZG93biBkaWFnbm9zdGljIGZpbGUgKHZlcnNpb25zLCBzZXR0aW5ncywgc3luYyBzdGF0ZSwgcmVjZW50IGxvZykgdG8gLnZhdWx0c3luY2ZvcmFnZW50cy8gaW4gdGhpcyB2YXVsdCBcdTIwMTQgYXR0YWNoIGl0IHRvIGJ1ZyByZXBvcnRzLiBJdCBuZXZlciBjb250YWlucyBub3RlIGNvbnRlbnRzIG9yIHRoZSBkZXZpY2UgdG9rZW4uJyxcbiAgICAgIClcbiAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoJ1NhdmUgc3VwcG9ydCBidW5kbGUnKS5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICBidXR0b24uc2V0RGlzYWJsZWQodHJ1ZSk7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTdXBwb3J0QnVuZGxlKCk7XG4gICAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICAgIGJ1dHRvbi5zZXREaXNhYmxlZChmYWxzZSk7XG4gICAgICAgICAgfVxuICAgICAgICB9KSxcbiAgICAgICk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlckFib3V0U2VjdGlvbigpOiB2b2lkIHtcbiAgICBjb25zdCB7IGNvbnRhaW5lckVsIH0gPSB0aGlzO1xuICAgIHRoaXMuaGVhZGluZygnQWJvdXQnKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ1ZlcnNpb25zJylcbiAgICAgIC5zZXREZXNjKFxuICAgICAgICBgUGx1Z2luICR7dGhpcy5wbHVnaW4ubWFuaWZlc3QudmVyc2lvbiB8fCAndW5rbm93bid9IFx1MDBCNyBwcm90b2NvbCB2JHtQUk9UT0NPTF9WRVJTSU9OfSBcdTAwQjcgJHt0aGlzLnBsdWdpbi5wbGF0Zm9ybVN1bW1hcnkoKX1gLFxuICAgICAgKTtcblxuICAgIHRoaXMuc2VydmVyVmVyc2lvblNldHRpbmcgPSBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdTZXJ2ZXIgdmVyc2lvbicpXG4gICAgICAuc2V0RGVzYyh0aGlzLnNlcnZlclZlcnNpb25UZXh0KCkpO1xuICAgIHRoaXMucmVmcmVzaFNlcnZlclZlcnNpb24oKTtcblxuICAgIHRoaXMuc3RvcmFnZVNldHRpbmcgPSBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdWYXVsdCBzdG9yYWdlJylcbiAgICAgIC5zZXREZXNjKHRoaXMucGx1Z2luLmxpbmtlZCA/ICdDaGVja2luZyB0aGUgd29ya2VyXHUyMDI2JyA6ICdQYWlyIHRoaXMgdmF1bHQgdG8gc2VlIHN0b3JhZ2UgdXNhZ2UuJyk7XG4gICAgaWYgKHRoaXMucGx1Z2luLmxpbmtlZCkgdm9pZCB0aGlzLnJlZnJlc2hTdG9yYWdlKCk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdQcm9qZWN0IGhvbWUnKVxuICAgICAgLnNldERlc2MoYERvY3VtZW50YXRpb24gYW5kIHNvdXJjZTogJHtQUk9KRUNUX1JFQURNRV9VUkx9YClcbiAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoJ09wZW4gUkVBRE1FJykub25DbGljaygoKSA9PiBvcGVuUmVhZG1lUGFnZSgpKSxcbiAgICAgICk7XG4gIH1cblxuICAvKiogRmlsbCB0aGUgQWJvdXQgc3RvcmFnZSBsaW5lIGZyb20gL2FwaS9zdGF0dXMgKGRldmljZS10b2tlbiBhdXRoKS4gKi9cbiAgcHJpdmF0ZSBhc3luYyByZWZyZXNoU3RvcmFnZSgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBzdW1tYXJ5ID0gYXdhaXQgdGhpcy5wbHVnaW4uZmV0Y2hTdG9yYWdlU3VtbWFyeSgpO1xuICAgIGNvbnN0IGRlc2MgPVxuICAgICAgc3VtbWFyeSA9PT0gbnVsbFxuICAgICAgICA/ICdTdG9yYWdlIHVzYWdlIGlzIGN1cnJlbnRseSB1bmF2YWlsYWJsZSAodGhlIHdvcmtlciBpcyB1bnJlYWNoYWJsZSkuJ1xuICAgICAgICA6IGBTdG9yYWdlIHVzZWQ6ICR7Zm9ybWF0Qnl0ZXMoc3VtbWFyeS5zdG9yYWdlQnl0ZXMpfSBcdTAwQjcgJHtzdW1tYXJ5LmF0dGFjaG1lbnRzLmNvdW50fSBhdHRhY2htZW50JHtcbiAgICAgICAgICAgIHN1bW1hcnkuYXR0YWNobWVudHMuY291bnQgPT09IDEgPyAnJyA6ICdzJ1xuICAgICAgICAgIH0gKCR7Zm9ybWF0Qnl0ZXMoc3VtbWFyeS5hdHRhY2htZW50cy5ieXRlcyl9KWAgK1xuICAgICAgICAgIChzdW1tYXJ5LmRldmljZXMubGVuZ3RoID4gMFxuICAgICAgICAgICAgPyBgIFx1MDBCNyAke3N1bW1hcnkuZGV2aWNlcy5sZW5ndGh9IGRldmljZSR7c3VtbWFyeS5kZXZpY2VzLmxlbmd0aCA9PT0gMSA/ICcnIDogJ3MnfWBcbiAgICAgICAgICAgIDogJycpO1xuICAgIC8vIFRoZSB0YWIgbWF5IGhhdmUgYmVlbiBjbG9zZWQvcmUtcmVuZGVyZWQgbWVhbndoaWxlOyBwYWludCBvbmx5IGlmIGxpdmUuXG4gICAgaWYgKHRoaXMuc3RvcmFnZVNldHRpbmcgIT09IG51bGwpIHRoaXMuc3RvcmFnZVNldHRpbmcuc2V0RGVzYyhkZXNjKTtcbiAgfVxuXG4gIC8vIC0tLSBzdGF0dXMgLyBmZWVkYmFjayAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIHByaXZhdGUgc3RhdHVzVGV4dCgpOiBzdHJpbmcge1xuICAgIGNvbnN0IGRhdGE6IFZhdWx0U3luY1BsdWdpbkRhdGEgPSB0aGlzLnBsdWdpbi5kYXRhO1xuICAgIGNvbnN0IHN0YXR1cyA9IHRoaXMucGx1Z2luLmNsaWVudD8uc3RhdHVzKCk7XG4gICAgaWYgKHRoaXMucGx1Z2luLnN5bmNpbmdQYXVzZWQpIHtcbiAgICAgIHJldHVybiBbXG4gICAgICAgICdTdGF0ZTogcGF1c2VkJyxcbiAgICAgICAgYFdvcmtlcjogJHtkYXRhLnVybH1gLFxuICAgICAgICAnVmF1bHQgY2hhbmdlcyBzdGF5IGxvY2FsIHVudGlsIHlvdSByZXN1bWUgc3luY2luZy4nLFxuICAgICAgXS5qb2luKCdcXG4nKTtcbiAgICB9XG4gICAgaWYgKHN0YXR1cyA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICByZXR1cm4gYExpbmtlZCB0byAke2RhdGEudXJsfSAoZGV2aWNlICR7ZGF0YS5kZXZpY2VOYW1lIHx8IGRhdGEuZGV2aWNlSWR9KS5gO1xuICAgIH1cbiAgICBjb25zdCBsYXN0U3luYyA9XG4gICAgICBzdGF0dXMubGFzdFN5bmNBdCA9PT0gbnVsbFxuICAgICAgICA/ICduZXZlcidcbiAgICAgICAgOiBgJHtmb3JtYXRTaW5jZShEYXRlLm5vdygpIC0gc3RhdHVzLmxhc3RTeW5jQXQpfSBhZ29gO1xuICAgIGNvbnN0IHN0YXRlID0gc3RhdHVzLnN0YXRlID09PSAnbGl2ZScgPyAnY29ubmVjdGVkJyA6IHN0YXR1cy5zdGF0ZTtcbiAgICBjb25zdCBsaW5lcyA9IFtgU3RhdGU6ICR7c3RhdGV9YCwgYFdvcmtlcjogJHtkYXRhLnVybH1gLCBgTGFzdCBzeW5jOiAke2xhc3RTeW5jfWBdO1xuICAgIC8vIEJ1bGstcGhhc2UgcHJvZ3Jlc3MgXHUyMDE0IHRoZSBzYW1lIFgvWSB0aGUgc3RhdHVzIGJhciBzaG93cyBkdXJpbmcgYVxuICAgIC8vIG11bHRpLW1pbnV0ZSBpbml0aWFsIHN5bmMuXG4gICAgaWYgKHN0YXR1cy5wcm9ncmVzcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBsaW5lcy5wdXNoKGBTeW5jaW5nOiAke3N0YXR1cy5wcm9ncmVzcy5kb25lfS8ke3N0YXR1cy5wcm9ncmVzcy50b3RhbH0gKCR7c3RhdHVzLnByb2dyZXNzLnBoYXNlfSlgKTtcbiAgICB9XG4gICAgbGluZXMucHVzaChcbiAgICAgIGBQZW5kaW5nIGNoYW5nZXM6ICR7c3RhdHVzLnBlbmRpbmd9YCxcbiAgICAgIGBDb25mbGljdHM6ICR7c3RhdHVzLmNvbmZsaWN0cy5sZW5ndGh9JHtzdGF0dXMuY29uZmxpY3RzLmxlbmd0aCA+IDAgPyAnIChjb25mbGljdCBjb3BpZXMgd2VyZSB3cml0dGVuIGludG8gdGhlIHZhdWx0KScgOiAnJ31gLFxuICAgICk7XG4gICAgcmV0dXJuIGxpbmVzLmpvaW4oJ1xcbicpO1xuICB9XG5cbiAgcHJpdmF0ZSByZWZyZXNoU3RhdHVzKCk6IHZvaWQge1xuICAgIHRoaXMuc3RhdHVzU2V0dGluZz8uc2V0RGVzYyh0aGlzLnN0YXR1c1RleHQoKSk7XG4gICAgdGhpcy5yZWZyZXNoU2VydmVyVmVyc2lvbigpO1xuICB9XG5cbiAgLyoqXG4gICAqIFRoZSBBYm91dCBzZWN0aW9uJ3Mgc2VydmVyLXZlcnNpb24gbGluZTogdGhlIGhlbGxvQWNrLXJlcG9ydGVkIHZlcnNpb25cbiAgICogcGx1cyB0aGUgY29tcGF0IHZlcmRpY3Qgd2hlbiBpdCBpcyBub3Qgb2suIGBzZXJ2ZXJWZXJzaW9uYCBtYXkgbGFnIHRoZVxuICAgKiB2ZXJkaWN0IGJ5IGEgdGljayAodGhlIHBsdWdpbiBhc3Nlc3NlcyBvbiBpdHMgb3duIDEgSHogc3VwZXJ2aXNpb24pLCBzb1xuICAgKiB0aGUgdmVyZGljdCBtZXNzYWdlIGlzIGF1dGhvcml0YXRpdmUgd2hlbiBwcmVzZW50LlxuICAgKi9cbiAgcHJpdmF0ZSBzZXJ2ZXJWZXJzaW9uVGV4dCgpOiBzdHJpbmcge1xuICAgIGlmICghdGhpcy5wbHVnaW4ubGlua2VkKSByZXR1cm4gJ1BhaXIgdGhpcyB2YXVsdCB0byBzZWUgdGhlIHdvcmtlciB2ZXJzaW9uLic7XG4gICAgY29uc3Qgc3RhdHVzID0gdGhpcy5wbHVnaW4uY2xpZW50Py5zdGF0dXMoKTtcbiAgICBjb25zdCB2ZXJkaWN0ID0gdGhpcy5wbHVnaW4uc2VydmVyQ29tcGF0aWJpbGl0eTtcbiAgICBpZiAodmVyZGljdCAhPT0gbnVsbCAmJiB2ZXJkaWN0LmxldmVsICE9PSAnb2snKSByZXR1cm4gdmVyZGljdC5tZXNzYWdlO1xuICAgIGNvbnN0IHZlcnNpb24gPSBzdGF0dXM/LnNlcnZlclZlcnNpb24gPz8gbnVsbDtcbiAgICByZXR1cm4gdmVyc2lvbiA9PT0gbnVsbFxuICAgICAgPyAnVW5rbm93biBcdTIwMTQgdGhlIHdvcmtlciBoYXMgbm90IHJlcG9ydGVkIGEgdmVyc2lvbiB5ZXQuJ1xuICAgICAgOiBgU2VydmVyICR7dmVyc2lvbn0gXHUwMEI3IGNvbXBhdGlibGUgd2l0aCB0aGlzIHBsdWdpbi5gO1xuICB9XG5cbiAgLyoqIFJlcGFpbnQgdGhlIHNlcnZlci12ZXJzaW9uIHJvdyAoY2FsbGVkIGJ5IHRoZSAxIEh6IHJlZnJlc2ggbG9vcCkuICovXG4gIHByaXZhdGUgcmVmcmVzaFNlcnZlclZlcnNpb24oKTogdm9pZCB7XG4gICAgLy8gVGhlIHRhYiBtYXkgaGF2ZSBiZWVuIGNsb3NlZC9yZS1yZW5kZXJlZCBtZWFud2hpbGU7IHBhaW50IG9ubHkgaWYgbGl2ZS5cbiAgICBpZiAodGhpcy5zZXJ2ZXJWZXJzaW9uU2V0dGluZyAhPT0gbnVsbCkgdGhpcy5zZXJ2ZXJWZXJzaW9uU2V0dGluZy5zZXREZXNjKHRoaXMuc2VydmVyVmVyc2lvblRleHQoKSk7XG4gIH1cblxuICAvKiogUGFpciBmZWVkYmFjazogc3VjY2VzcyByZS1yZW5kZXJzOyBmYWlsdXJlcyBsYW5kIGluIHRoZSBoaW50IFNldHRpbmcuICovXG4gIHByaXZhdGUgc2hvd091dGNvbWUob3V0Y29tZTogUGFpck91dGNvbWUpOiB2b2lkIHtcbiAgICBpZiAob3V0Y29tZS5zdGF0dXMgPT09ICdwYWlyZWQnKSB7XG4gICAgICBuZXcgTm90aWNlKHBhaXJPdXRjb21lTWVzc2FnZShvdXRjb21lKSk7XG4gICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgbWVzc2FnZSA9IHBhaXJPdXRjb21lTWVzc2FnZShvdXRjb21lKTtcbiAgICBuZXcgTm90aWNlKG1lc3NhZ2UsIDEwMDAwKTtcbiAgICBpZiAodGhpcy5oaW50U2V0dGluZyAhPT0gbnVsbCkgdGhpcy5oaW50U2V0dGluZy5zZXREZXNjKG1lc3NhZ2UpO1xuICB9XG5cbiAgLy8gLS0tIGxpdmUgcmVmcmVzaCBsb29wIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIC8qKiBSZWZyZXNoIHRoZSBzdGF0dXMgcmVhZG91dCB+MSBIeiB3aGlsZSB0aGUgdGFiIGlzIG9wZW4uICovXG4gIHByaXZhdGUgc3RhcnRSZWZyZXNoKCk6IHZvaWQge1xuICAgIHRoaXMuc3RvcFJlZnJlc2goKTtcbiAgICBjb25zdCBoYW5kbGUgPSBzZXRJbnRlcnZhbCgoKSA9PiB0aGlzLnJlZnJlc2hTdGF0dXMoKSwgMTAwMCk7XG4gICAgdGhpcy5yZWZyZXNoSGFuZGxlID0gaGFuZGxlO1xuICAgIC8vIE9ic2lkaWFuIGNsZWFycyByZWdpc3RlcmVkIGludGVydmFscyB3aGVuIHRoZSBwbHVnaW4gdW5sb2FkcyBcdTIwMTQgbm8gbGVha1xuICAgIC8vIGV2ZW4gaWYgdGhlIHNldHRpbmdzIG1vZGFsIGlzIGZvcmNlLWNsb3NlZC5cbiAgICB0aGlzLnBsdWdpbi5yZWdpc3RlckludGVydmFsKGhhbmRsZSBhcyB1bmtub3duIGFzIG51bWJlcik7XG4gIH1cblxuICBwcml2YXRlIHN0b3BSZWZyZXNoKCk6IHZvaWQge1xuICAgIGlmICh0aGlzLnJlZnJlc2hIYW5kbGUgIT09IG51bGwpIHtcbiAgICAgIGNsZWFySW50ZXJ2YWwodGhpcy5yZWZyZXNoSGFuZGxlKTtcbiAgICAgIHRoaXMucmVmcmVzaEhhbmRsZSA9IG51bGw7XG4gICAgfVxuICB9XG59XG4iLCAiLyoqXG4gKiBTdGF0dXMtYmFyIGluZGljYXRvciAocGx1Z2luIHNjb3BlIGl0ZW0gIzUpOiBhIHNtYWxsIHBhc3NpdmUgdmlldyBvdmVyXG4gKiBgU3luY0NsaWVudFN0YXR1c2AsIHJlcGFpbnRlZCBieSB0aGUgcGx1Z2luJ3MgMSBzIHN1cGVydmlzaW9uIHRpY2suXG4gKlxuICogICB2c2EgXHUyMkVGICAgICAgICAgICAgICBjb25uZWN0aW5nIC8gc3luY2luZ1xuICogICB2c2EgXHUyMkVGIDEyMzQvNTAwMCAgICBzeW5jaW5nLCBidWxrIHBoYXNlIHByb2dyZXNzIChzY2FubmluZy9wdXNoaW5nL3B1bGxpbmcpXG4gKiAgIHZzYSBcdTI3MTMgMTJzICAgICAgICAgIGxpdmUsIGxhc3QgY29tcGxldGVkIGN5Y2xlIDEyIHMgYWdvXG4gKiAgIHZzYSBcdTI2QTAgY29uZmxpY3RzOiAyIGNvbmZsaWN0cyBvYnNlcnZlZCAoY29uZmxpY3QgY29waWVzIGV4aXN0IGluIHRoZSB2YXVsdClcbiAqICAgdnNhIFx1MjcxNyBvZmZsaW5lICAgICAgZGlzY29ubmVjdGVkIChyZWNvbm5lY3QgYmFja29mZiBydW5uaW5nKVxuICogICB2c2EgXHUyM0Y4ICAgICAgICAgICAgICBzeW5jaW5nIHBhdXNlZCAodGhlIFBhdXNlIHN5bmNpbmcgc2V0dGluZylcbiAqXG4gKiBDb21wYWN0IG1vZGUgZHJvcHMgdGhlIHRyYWlsaW5nIGRldGFpbCAoXCJ2c2EgXHUyNzEzIDEyc1wiIFx1MjE5MiBcInZzYSBcdTI3MTNcIiwgZXRjLik7XG4gKiBIaWRkZW4gbW9kZSByZW1vdmVzIHRoZSBpdGVtIGVudGlyZWx5ICh0aGUgcGx1Z2luIG5ldmVyIG1vdW50cyBpdCkuXG4gKlxuICogVGhlIHRvb2x0aXAgY2FycmllcyB0aGUgZGV0YWlsOiBzdGF0ZSwgd29ya2VyIFVSTCwgZGV2aWNlLCBsYXN0IHN5bmMsIHBlbmRpbmcuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBTeW5jQ2xpZW50U3RhdHVzIH0gZnJvbSAnQHZzYS9jb3JlJztcblxuLyoqIEhvdyB0aGUgc3RhdHVzLWJhciBpbmRpY2F0b3IgcmVuZGVycyAodGhlIFwiU3RhdHVzIGJhciBpbmRpY2F0b3JcIiBzZXR0aW5nKS4gKi9cbmV4cG9ydCB0eXBlIFN0YXR1c0Jhck1vZGUgPSAnZGV0YWlsZWQnIHwgJ2NvbXBhY3QnIHwgJ2hpZGRlbic7XG5cbi8qKiBUaGUgc2xpY2Ugb2YgSFRNTEVsZW1lbnQgdGhlIGluZGljYXRvciB0b3VjaGVzICh0ZXN0cyBwYXNzIGEgcGxhaW4gb2JqZWN0KS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU3RhdHVzSXRlbUxpa2Uge1xuICB0ZXh0Q29udGVudDogc3RyaW5nO1xuICBhZGRDbGFzcz8oY2xzOiBzdHJpbmcpOiB1bmtub3duO1xuICByZW1vdmVDbGFzcz8oY2xzOiBzdHJpbmcpOiB1bmtub3duO1xuICBzZXRBdHRyaWJ1dGU/KG5hbWU6IHN0cmluZywgdmFsdWU6IHN0cmluZyk6IHVua25vd247XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgU3RhdHVzQ29udGV4dCB7XG4gIHVybDogc3RyaW5nO1xuICBkZXZpY2VOYW1lOiBzdHJpbmc7XG4gIC8qKiBFeHRyYSBsaW5lIChlLmcuIGFuIGF1dGggZmFpbHVyZSBub3RlKSBhcHBlbmRlZCB0byB0aGUgdG9vbHRpcC4gKi9cbiAgbm90ZT86IHN0cmluZztcbiAgLyoqIFN5bmNpbmcgaXMgcGF1c2VkICh0aGUgUGF1c2Ugc3luY2luZyBidXR0b24pIFx1MjAxNCBzaG93cyBcInZzYSBcdTIzRjhcIi4gKi9cbiAgcGF1c2VkPzogYm9vbGVhbjtcbiAgLyoqIEluZGljYXRvciBtb2RlICh0aGUgcGx1Z2luJ3Mgc3RhdHVzIGJhciBzZXR0aW5nKTsgZGVmYXVsdCBkZXRhaWxlZC4gKi9cbiAgbW9kZT86IFN0YXR1c0Jhck1vZGU7XG59XG5cbi8qKiBgbm93IC0gc2luY2VgLCBmbG9vcmVkOiBgMTJzYCwgYDVtYCwgYDNoYCBcdTIwMTQgZGlzcGxheSBvbmx5LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdFNpbmNlKGVsYXBzZWRNczogbnVtYmVyKTogc3RyaW5nIHtcbiAgY29uc3Qgc2Vjb25kcyA9IE1hdGgubWF4KDAsIE1hdGguZmxvb3IoZWxhcHNlZE1zIC8gMTAwMCkpO1xuICBpZiAoc2Vjb25kcyA8IDYwKSByZXR1cm4gYCR7c2Vjb25kc31zYDtcbiAgY29uc3QgbWludXRlcyA9IE1hdGguZmxvb3Ioc2Vjb25kcyAvIDYwKTtcbiAgaWYgKG1pbnV0ZXMgPCA2MCkgcmV0dXJuIGAke21pbnV0ZXN9bWA7XG4gIHJldHVybiBgJHtNYXRoLmZsb29yKG1pbnV0ZXMgLyA2MCl9aGA7XG59XG5cbi8qKlxuICogVGhlIG9uZS1saW5lIHN0YXR1cyB0ZXh0IGZvciBhIGNsaWVudCBzdGF0dXMgYXQgdGltZSBgbm93YC4gYG1vZGVgIHNocmlua3NcbiAqIHRoZSBsaW5lIChjb21wYWN0IGRyb3BzIHRoZSB0cmFpbGluZyBkZXRhaWwpOyBgcGF1c2VkYCB3aW5zIG92ZXIgZXZlcnl0aGluZy5cbiAqXG4gKiBEdXJpbmcgYSBidWxrIHBoYXNlIChgc3RhdHVzLnByb2dyZXNzYCBcdTIwMTQgc2Nhbm5pbmcvcHVzaGluZy9wdWxsaW5nIG9mIGFcbiAqIG11bHRpLW1pbnV0ZSBpbml0aWFsIHN5bmMpIGJvdGggZGV0YWlsIGxldmVscyBzaG93IHRoZSBjb3VudHMgXHUyMDE0XG4gKiBgdnNhIFx1MjJFRiAxMjM0LzUwMDBgIFx1MjAxNCBiZWNhdXNlIHRoYXQgaXMgdGhlIG9uZSB0aGluZyBhIHVzZXIgd2FpdGluZyBvbiBhIGJpZ1xuICogc3luYyBuZWVkczsgaGlkZGVuIG1vZGUgc2hvd3Mgbm90aGluZyAodGhlIGl0ZW0gaXMgbmV2ZXIgbW91bnRlZCkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdGF0dXNMaW5lRm9yKFxuICBzdGF0dXM6IFN5bmNDbGllbnRTdGF0dXMsXG4gIG5vdzogbnVtYmVyLFxuICBtb2RlOiBTdGF0dXNCYXJNb2RlID0gJ2RldGFpbGVkJyxcbiAgcGF1c2VkID0gZmFsc2UsXG4pOiBzdHJpbmcge1xuICBpZiAocGF1c2VkKSByZXR1cm4gJ3ZzYSBcdTIzRjgnO1xuICBjb25zdCBjb21wYWN0ID0gbW9kZSA9PT0gJ2NvbXBhY3QnO1xuICBzd2l0Y2ggKHN0YXR1cy5zdGF0ZSkge1xuICAgIGNhc2UgJ2Nvbm5lY3RpbmcnOlxuICAgIGNhc2UgJ3N5bmNpbmcnOiB7XG4gICAgICBjb25zdCBwcm9ncmVzcyA9IHN0YXR1cy5wcm9ncmVzcztcbiAgICAgIGlmIChwcm9ncmVzcyAhPT0gdW5kZWZpbmVkKSByZXR1cm4gYHZzYSBcdTIyRUYgJHtwcm9ncmVzcy5kb25lfS8ke3Byb2dyZXNzLnRvdGFsfWA7XG4gICAgICByZXR1cm4gJ3ZzYSBcdTIyRUYnO1xuICAgIH1cbiAgICBjYXNlICdkaXNjb25uZWN0ZWQnOlxuICAgICAgcmV0dXJuIGNvbXBhY3QgPyAndnNhIFx1MjcxNycgOiAndnNhIFx1MjcxNyBvZmZsaW5lJztcbiAgICBjYXNlICdsaXZlJzpcbiAgICAgIGlmIChzdGF0dXMuY29uZmxpY3RzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgcmV0dXJuIGNvbXBhY3QgPyAndnNhIFx1MjZBMCcgOiBgdnNhIFx1MjZBMCBjb25mbGljdHM6ICR7c3RhdHVzLmNvbmZsaWN0cy5sZW5ndGh9YDtcbiAgICAgIH1cbiAgICAgIGlmIChzdGF0dXMubGFzdFN5bmNBdCA9PT0gbnVsbCB8fCBjb21wYWN0KSByZXR1cm4gJ3ZzYSBcdTI3MTMnO1xuICAgICAgcmV0dXJuIGB2c2EgXHUyNzEzICR7Zm9ybWF0U2luY2Uobm93IC0gc3RhdHVzLmxhc3RTeW5jQXQpfWA7XG4gICAgY2FzZSAnaWRsZSc6XG4gICAgICByZXR1cm4gJ3ZzYSc7XG4gIH1cbn1cblxuLyoqIFRvb2x0aXAgbGluZXMgKGpvaW5lZCB3aXRoIGBcXG5gKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdGF0dXNUb29sdGlwRm9yKHN0YXR1czogU3luY0NsaWVudFN0YXR1cywgY29udGV4dDogU3RhdHVzQ29udGV4dCwgbm93OiBudW1iZXIpOiBzdHJpbmcge1xuICBjb25zdCBzdGF0ZUxhYmVsOiBSZWNvcmQ8U3luY0NsaWVudFN0YXR1c1snc3RhdGUnXSwgc3RyaW5nPiA9IHtcbiAgICBpZGxlOiAnbm90IHJ1bm5pbmcnLFxuICAgIGNvbm5lY3Rpbmc6ICdjb25uZWN0aW5nXHUyMDI2JyxcbiAgICBzeW5jaW5nOiAnc3luY2luZ1x1MjAyNicsXG4gICAgbGl2ZTogJ2xpdmUnLFxuICAgIGRpc2Nvbm5lY3RlZDogJ29mZmxpbmUgXHUyMDE0IHJlY29ubmVjdGluZycsXG4gIH07XG4gIGNvbnN0IGhlYWRsaW5lID0gY29udGV4dC5wYXVzZWQgPT09IHRydWUgPyAncGF1c2VkJyA6IHN0YXRlTGFiZWxbc3RhdHVzLnN0YXRlXTtcbiAgY29uc3QgbGluZXMgPSBbYFZhdWx0U3luYyBmb3IgQWdlbnRzIFx1MjAxNCAke2hlYWRsaW5lfWBdO1xuICBpZiAoY29udGV4dC51cmwgIT09ICcnKSBsaW5lcy5wdXNoKGBXb3JrZXI6ICR7Y29udGV4dC51cmx9YCk7XG4gIGlmIChjb250ZXh0LmRldmljZU5hbWUgIT09ICcnKSBsaW5lcy5wdXNoKGBEZXZpY2U6ICR7Y29udGV4dC5kZXZpY2VOYW1lfWApO1xuICBsaW5lcy5wdXNoKFxuICAgIHN0YXR1cy5sYXN0U3luY0F0ID09PSBudWxsXG4gICAgICA/ICdMYXN0IHN5bmM6IG5ldmVyJ1xuICAgICAgOiBgTGFzdCBzeW5jOiAke2Zvcm1hdFNpbmNlKG5vdyAtIHN0YXR1cy5sYXN0U3luY0F0KX0gYWdvYCxcbiAgKTtcbiAgaWYgKHN0YXR1cy5wcm9ncmVzcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgbGluZXMucHVzaChgU3luY2luZzogJHtzdGF0dXMucHJvZ3Jlc3MuZG9uZX0vJHtzdGF0dXMucHJvZ3Jlc3MudG90YWx9ICgke3N0YXR1cy5wcm9ncmVzcy5waGFzZX0pYCk7XG4gIH1cbiAgbGluZXMucHVzaChgUGVuZGluZyBjaGFuZ2VzOiAke3N0YXR1cy5wZW5kaW5nfWApO1xuICBsaW5lcy5wdXNoKGBDb25mbGljdHM6ICR7c3RhdHVzLmNvbmZsaWN0cy5sZW5ndGh9YCk7XG4gIGlmIChzdGF0dXMuY29uZmxpY3RzLmxlbmd0aCA+IDApIHtcbiAgICBsaW5lcy5wdXNoKGBDb25mbGljdCBjb3BpZXM6ICR7c3RhdHVzLmNvbmZsaWN0cy5tYXAoKGMpID0+IGMucGF0aCkuam9pbignLCAnKX1gKTtcbiAgfVxuICBpZiAoY29udGV4dC5ub3RlICE9PSB1bmRlZmluZWQgJiYgY29udGV4dC5ub3RlICE9PSAnJykgbGluZXMucHVzaChjb250ZXh0Lm5vdGUpO1xuICByZXR1cm4gbGluZXMuam9pbignXFxuJyk7XG59XG5cbi8qKiBDU1MgbW9kaWZpZXIgZm9yIHRoZSBpbmRpY2F0b3IgKHRpbnRlZCB3YXJuaW5nL2Vycm9yIHN0YXRlcykuICovXG5leHBvcnQgZnVuY3Rpb24gc3RhdHVzQ2xhc3NGb3Ioc3RhdHVzOiBTeW5jQ2xpZW50U3RhdHVzKTogc3RyaW5nIHtcbiAgaWYgKHN0YXR1cy5zdGF0ZSA9PT0gJ2Rpc2Nvbm5lY3RlZCcpIHJldHVybiAndnNhLWVycm9yJztcbiAgaWYgKHN0YXR1cy5jb25mbGljdHMubGVuZ3RoID4gMCkgcmV0dXJuICd2c2Etd2Fybic7XG4gIHJldHVybiAnJztcbn1cblxuLyoqXG4gKiBQYWludHMgb25lIHN0YXR1cy1iYXIgaXRlbS4gUGFzc2l2ZTogdGhlIHBsdWdpbiBjYWxscyBgdXBkYXRlKClgIGZyb20gaXRzXG4gKiBzdXBlcnZpc2lvbiB0aWNrIFx1MjAxNCBubyB0aW1lcnMgb2YgaXRzIG93biB0byBsZWFrLlxuICovXG5leHBvcnQgY2xhc3MgU3RhdHVzQmFySW5kaWNhdG9yIHtcbiAgLyoqIEFsd2F5cyBvbiBcdTIwMTQgdGhlIGJhc2UgY2xhc3Mgc3R5bGVzLmNzcyB0YXJnZXRzLiAqL1xuICBwcml2YXRlIHN0YXRpYyByZWFkb25seSBCQVNFX0NMQVNTID0gJ3ZzYS1zdGF0dXMnO1xuICBwcml2YXRlIHN0YXRpYyByZWFkb25seSBNT0RJRklFUl9DTEFTU0VTID0gWyd2c2Etd2FybicsICd2c2EtZXJyb3InXTtcblxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IGl0ZW06IFN0YXR1c0l0ZW1MaWtlKSB7fVxuXG4gIHVwZGF0ZShzdGF0dXM6IFN5bmNDbGllbnRTdGF0dXMsIGNvbnRleHQ6IFN0YXR1c0NvbnRleHQsIG5vdzogbnVtYmVyKTogdm9pZCB7XG4gICAgdGhpcy5pdGVtLnRleHRDb250ZW50ID0gc3RhdHVzTGluZUZvcihzdGF0dXMsIG5vdywgY29udGV4dC5tb2RlID8/ICdkZXRhaWxlZCcsIGNvbnRleHQucGF1c2VkID09PSB0cnVlKTtcbiAgICB0aGlzLml0ZW0uYWRkQ2xhc3M/LihTdGF0dXNCYXJJbmRpY2F0b3IuQkFTRV9DTEFTUyk7XG4gICAgY29uc3QgbW9kaWZpZXIgPSBzdGF0dXNDbGFzc0ZvcihzdGF0dXMpO1xuICAgIGZvciAoY29uc3QgY2xzIG9mIFN0YXR1c0JhckluZGljYXRvci5NT0RJRklFUl9DTEFTU0VTKSB7XG4gICAgICBpZiAoY2xzID09PSBtb2RpZmllcikgdGhpcy5pdGVtLmFkZENsYXNzPy4oY2xzKTtcbiAgICAgIGVsc2UgdGhpcy5pdGVtLnJlbW92ZUNsYXNzPy4oY2xzKTtcbiAgICB9XG4gICAgdGhpcy5pdGVtLnNldEF0dHJpYnV0ZT8uKCd0aXRsZScsIHN0YXR1c1Rvb2x0aXBGb3Ioc3RhdHVzLCBjb250ZXh0LCBub3cpKTtcbiAgfVxufVxuIiwgIi8qKlxuICogYFdlYlNvY2tldFRyYW5zcG9ydGAgXHUyMDE0IGNvcmUncyBgVHJhbnNwb3J0YCBvdmVyIHRoZSBnbG9iYWwgYFdlYlNvY2tldGBcbiAqIChwcmVzZW50IGluIE9ic2lkaWFuIGRlc2t0b3AgKmFuZCogbW9iaWxlOyBmZWF0dXJlLWNoZWNrZWQgd2l0aCBhIGNsZWFyXG4gKiBlcnJvciBmb3IgZXhvdGljIGJ1aWxkcykuXG4gKlxuICogVGhpcyBtaXJyb3JzIGBAdnNhL25vZGUtcnVudGltZWAncyB0cmFuc3BvcnQgb24gcHVycG9zZSAoc2FtZSB3aXJlIGZvcm1hdDpcbiAqIG9uZSBKU09OIHRleHQgZnJhbWUgcGVyIG1lc3NhZ2UsIGNvcmUncyBgcGFyc2VNZXNzYWdlYCBvbiByZWNlaXZlLCBxdWV1ZWRcbiAqIHNlbmRzIGJlZm9yZSBvcGVuKSBidXQgc2hhcmVzIG5vIGNvZGUgd2l0aCBpdCBcdTIwMTQgYEB2c2Evbm9kZS1ydW50aW1lYCBpc1xuICogTm9kZS1vbmx5IGFuZCBtdXN0IG5ldmVyIGJlIGEgcGx1Z2luIGRlcGVuZGVuY3kuXG4gKi9cblxuaW1wb3J0IHsgTmV0d29ya0Vycm9yLCBwYXJzZU1lc3NhZ2UgfSBmcm9tICdAdnNhL2NvcmUnO1xuaW1wb3J0IHR5cGUgeyBDbG9zZVJlYXNvbiwgTWVzc2FnZSwgVHJhbnNwb3J0IH0gZnJvbSAnQHZzYS9jb3JlJztcblxuLyoqXG4gKiBUaGUgbWluaW1hbCBXZWJTb2NrZXQgc3VyZmFjZSB0aGlzIHRyYW5zcG9ydCBuZWVkcy4gSW5qZWN0YWJsZSBzbyB0ZXN0c1xuICogKGFuZCBleG90aWMgcnVudGltZXMpIGNhbiBzdXBwbHkgYSBmYWtlOyBwcm9kdWN0aW9uIHVzZXMgdGhlIGdsb2JhbC5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBXZWJTb2NrZXRMaWtlIHtcbiAgc2VuZChkYXRhOiBzdHJpbmcpOiB2b2lkO1xuICBjbG9zZShjb2RlPzogbnVtYmVyLCByZWFzb24/OiBzdHJpbmcpOiB2b2lkO1xuICBhZGRFdmVudExpc3RlbmVyKHR5cGU6ICdvcGVuJywgbGlzdGVuZXI6ICgpID0+IHZvaWQpOiB2b2lkO1xuICBhZGRFdmVudExpc3RlbmVyKHR5cGU6ICdtZXNzYWdlJywgbGlzdGVuZXI6IChldmVudDogeyBkYXRhOiB1bmtub3duIH0pID0+IHZvaWQpOiB2b2lkO1xuICBhZGRFdmVudExpc3RlbmVyKHR5cGU6ICdjbG9zZScsIGxpc3RlbmVyOiAoZXZlbnQ6IHsgY29kZT86IG51bWJlcjsgcmVhc29uPzogc3RyaW5nIH0pID0+IHZvaWQpOiB2b2lkO1xuICBhZGRFdmVudExpc3RlbmVyKHR5cGU6ICdlcnJvcicsIGxpc3RlbmVyOiAoZXZlbnQ6IHVua25vd24pID0+IHZvaWQpOiB2b2lkO1xufVxuXG5leHBvcnQgdHlwZSBXZWJTb2NrZXRGYWN0b3J5ID0gKHVybDogc3RyaW5nKSA9PiBXZWJTb2NrZXRMaWtlO1xuXG5leHBvcnQgaW50ZXJmYWNlIFdlYlNvY2tldFRyYW5zcG9ydE9wdGlvbnMge1xuICAvKiogV29ya2VyIG9yaWdpbiAoYGh0dHBzOi8vcGVyc29uYWwueC53b3JrZXJzLmRldmApIG9yIGEgYHdzKHMpOi8vYCBVUkwuICovXG4gIHVybDogc3RyaW5nO1xuICAvKiogV1MgcGF0aCBvbiB0aGUgd29ya2VyIChkZWZhdWx0IGAvd3NgOyBgL3N5bmNgIGlzIGVxdWl2YWxlbnQpLiAqL1xuICBwYXRoPzogc3RyaW5nO1xuICAvKiogSW5qZWN0YWJsZSBzb2NrZXQgZmFjdG9yeSAodGVzdHMpLiBEZWZhdWx0OiB0aGUgZ2xvYmFsIGBXZWJTb2NrZXRgLiAqL1xuICB3c0ZhY3Rvcnk/OiBXZWJTb2NrZXRGYWN0b3J5O1xufVxuXG4vKiogTG9jYWxob3N0IG5hbWVzIGZvciB3aGljaCBjbGVhcnRleHQgYHdzOi8vYCBpcyB0b2xlcmF0ZWQgKGxvY2FsIGRldiBvbmx5KS4gKi9cbmZ1bmN0aW9uIGlzTG9jYWxIb3N0KHVybDogVVJMKTogYm9vbGVhbiB7XG4gIGNvbnN0IGhvc3QgPSB1cmwuaG9zdG5hbWUudG9Mb3dlckNhc2UoKTtcbiAgcmV0dXJuIGhvc3QgPT09ICdsb2NhbGhvc3QnIHx8IGhvc3QgPT09ICcxMjcuMC4wLjEnIHx8IGhvc3QgPT09ICdbOjoxXScgfHwgaG9zdCA9PT0gJzo6MSc7XG59XG5cbi8qKlxuICogQnVpbGQgdGhlIFdTIFVSTDogYGh0dHBzOi8veGAgXHUyMTkyIGB3c3M6Ly94L3dzYC4gVGhlIGRldmljZSB0b2tlbiBpc1xuICogZGVsaWJlcmF0ZWx5IE5PVCBjYXJyaWVkIGluIHRoZSBVUkwgXHUyMDE0IFVSTHMgbGFuZCBpbiByZXF1ZXN0IGxvZ3M7IHRoZSB0b2tlblxuICogcmlkZXMgdGhlIGBoZWxsb2AgZnJhbWUgb25seS4gQ2xlYXJ0ZXh0IGB3czovL2AgaXMgcmVmdXNlZCBleGNlcHQgZm9yXG4gKiBsb2NhbGhvc3QgKGxvY2FsIGRldik7IHRocm93cyBvbiBmb3JlaWduIHNjaGVtZXMgb3IgdW5wYXJzYWJsZSBpbnB1dC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHRvV2ViU29ja2V0VXJsKGJhc2VVcmw6IHN0cmluZywgcGF0aCA9ICcvd3MnKTogc3RyaW5nIHtcbiAgY29uc3QgdXJsID0gbmV3IFVSTChiYXNlVXJsKTtcbiAgaWYgKHVybC5wcm90b2NvbCA9PT0gJ2h0dHA6JykgdXJsLnByb3RvY29sID0gJ3dzOic7XG4gIGVsc2UgaWYgKHVybC5wcm90b2NvbCA9PT0gJ2h0dHBzOicpIHVybC5wcm90b2NvbCA9ICd3c3M6JztcbiAgZWxzZSBpZiAodXJsLnByb3RvY29sICE9PSAnd3M6JyAmJiB1cmwucHJvdG9jb2wgIT09ICd3c3M6Jykge1xuICAgIHRocm93IG5ldyBOZXR3b3JrRXJyb3IoYHdvcmtlciBVUkwgbXVzdCBiZSBodHRwKHMpOi8vIG9yIHdzKHMpOi8vLCBnb3QgJHt1cmwucHJvdG9jb2x9YCk7XG4gIH1cbiAgaWYgKHVybC5wcm90b2NvbCA9PT0gJ3dzOicgJiYgIWlzTG9jYWxIb3N0KHVybCkpIHtcbiAgICB0aHJvdyBuZXcgTmV0d29ya0Vycm9yKFxuICAgICAgJ3dvcmtlciBVUkwgbXVzdCB1c2UgaHR0cHM6Ly8gXHUyMDE0IGNsZWFydGV4dCBodHRwL3dzIGlzIG9ubHkgYWxsb3dlZCBmb3IgbG9jYWxob3N0JyxcbiAgICApO1xuICB9XG4gIHVybC5wYXRobmFtZSA9IHBhdGg7XG4gIHVybC5zZWFyY2ggPSAnJztcbiAgcmV0dXJuIHVybC50b1N0cmluZygpO1xufVxuXG5mdW5jdGlvbiBkZWZhdWx0V2ViU29ja2V0RmFjdG9yeSh1cmw6IHN0cmluZyk6IFdlYlNvY2tldExpa2Uge1xuICBjb25zdCB3ZWJzb2NrZXQgPSAoZ2xvYmFsVGhpcyBhcyB7IFdlYlNvY2tldD86IHVua25vd24gfSkuV2ViU29ja2V0O1xuICBpZiAodHlwZW9mIHdlYnNvY2tldCAhPT0gJ2Z1bmN0aW9uJykge1xuICAgIHRocm93IG5ldyBOZXR3b3JrRXJyb3IoXG4gICAgICAnV2ViU29ja2V0IGlzIG5vdCBhdmFpbGFibGUgaW4gdGhpcyBPYnNpZGlhbiBidWlsZCAoaXQgaXMgYnVpbHQgaW4gb24gZGVza3RvcCBhbmQgJyArXG4gICAgICAgICdtb2JpbGU7IGEgdmVyeSBvbGQgYXBwIHZlcnNpb24gb3IgYSBzdHJpcHBlZCB3ZWJ2aWV3IGlzIHRoZSBvbmx5IGtub3duIGNhdXNlKS4gJyArXG4gICAgICAgICdTeW5jIHJlcXVpcmVzIGl0LicsXG4gICAgKTtcbiAgfVxuICByZXR1cm4gbmV3ICh3ZWJzb2NrZXQgYXMgbmV3ICh1cmw6IHN0cmluZykgPT4gV2ViU29ja2V0TGlrZSkodXJsKTtcbn1cblxuZXhwb3J0IGNsYXNzIFdlYlNvY2tldFRyYW5zcG9ydCBpbXBsZW1lbnRzIFRyYW5zcG9ydCB7XG4gIHByaXZhdGUgcmVhZG9ubHkgc29ja2V0OiBXZWJTb2NrZXRMaWtlO1xuICBwcml2YXRlIG1lc3NhZ2VDYWxsYmFjazogKChtZXNzYWdlOiBNZXNzYWdlKSA9PiB2b2lkKSB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGNsb3NlQ2FsbGJhY2s6ICgocmVhc29uOiBDbG9zZVJlYXNvbikgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBvcGVuID0gZmFsc2U7XG4gIHByaXZhdGUgY2xvc2VkID0gZmFsc2U7XG4gIHByaXZhdGUgY2xvc2VOb3RpZmllZCA9IGZhbHNlO1xuICBwcml2YXRlIHJlYWRvbmx5IHNlbmRRdWV1ZTogc3RyaW5nW10gPSBbXTtcbiAgcHJpdmF0ZSBsYXN0RXJyb3I6IHN0cmluZyB8IHVuZGVmaW5lZDtcblxuICBjb25zdHJ1Y3RvcihvcHRpb25zOiBXZWJTb2NrZXRUcmFuc3BvcnRPcHRpb25zKSB7XG4gICAgY29uc3QgZmFjdG9yeSA9IG9wdGlvbnMud3NGYWN0b3J5ID8/IGRlZmF1bHRXZWJTb2NrZXRGYWN0b3J5O1xuICAgIGNvbnN0IHVybCA9IHRvV2ViU29ja2V0VXJsKG9wdGlvbnMudXJsLCBvcHRpb25zLnBhdGggPz8gJy93cycpO1xuICAgIHRoaXMuc29ja2V0ID0gZmFjdG9yeSh1cmwpO1xuXG4gICAgdGhpcy5zb2NrZXQuYWRkRXZlbnRMaXN0ZW5lcignb3BlbicsICgpID0+IHtcbiAgICAgIHRoaXMub3BlbiA9IHRydWU7XG4gICAgICBjb25zdCBxdWV1ZWQgPSBbLi4udGhpcy5zZW5kUXVldWVdO1xuICAgICAgdGhpcy5zZW5kUXVldWUubGVuZ3RoID0gMDtcbiAgICAgIGZvciAoY29uc3QgZnJhbWUgb2YgcXVldWVkKSB0aGlzLnNvY2tldC5zZW5kKGZyYW1lKTtcbiAgICB9KTtcblxuICAgIHRoaXMuc29ja2V0LmFkZEV2ZW50TGlzdGVuZXIoJ21lc3NhZ2UnLCAoZXZlbnQpID0+IHtcbiAgICAgIGlmICh0eXBlb2YgZXZlbnQuZGF0YSAhPT0gJ3N0cmluZycpIHtcbiAgICAgICAgdGhpcy5mYWlsKHsgY29kZTogMTAwMywgcmVhc29uOiAnYmluYXJ5IGZyYW1lcyBhcmUgbm90IHBhcnQgb2YgdGhlIHByb3RvY29sJyB9KTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgbGV0IG1lc3NhZ2U6IE1lc3NhZ2U7XG4gICAgICB0cnkge1xuICAgICAgICBtZXNzYWdlID0gcGFyc2VNZXNzYWdlKGV2ZW50LmRhdGEpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdGhpcy5mYWlsKHsgY29kZTogMTAwMiwgcmVhc29uOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcikgfSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHRoaXMubWVzc2FnZUNhbGxiYWNrPy4obWVzc2FnZSk7XG4gICAgfSk7XG5cbiAgICB0aGlzLnNvY2tldC5hZGRFdmVudExpc3RlbmVyKCdlcnJvcicsIChldmVudCkgPT4ge1xuICAgICAgdGhpcy5sYXN0RXJyb3IgPVxuICAgICAgICBldmVudCBpbnN0YW5jZW9mIEVycm9yID8gZXZlbnQubWVzc2FnZSA6IGV2ZW50ICE9PSB1bmRlZmluZWQgPyBTdHJpbmcoZXZlbnQpIDogJ3NvY2tldCBlcnJvcic7XG4gICAgfSk7XG5cbiAgICB0aGlzLnNvY2tldC5hZGRFdmVudExpc3RlbmVyKCdjbG9zZScsIChldmVudCkgPT4ge1xuICAgICAgdGhpcy5maW5pc2hDbG9zZSh7XG4gICAgICAgIGNvZGU6IGV2ZW50LmNvZGUsXG4gICAgICAgIHJlYXNvbjogZXZlbnQucmVhc29uICE9PSB1bmRlZmluZWQgJiYgZXZlbnQucmVhc29uICE9PSAnJyA/IGV2ZW50LnJlYXNvbiA6IHRoaXMubGFzdEVycm9yLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBzZW5kKG1lc3NhZ2U6IE1lc3NhZ2UpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5jbG9zZWQpIHRocm93IG5ldyBOZXR3b3JrRXJyb3IoJ3NlbmQgb24gYSBjbG9zZWQgdHJhbnNwb3J0Jyk7XG4gICAgY29uc3QgZnJhbWUgPSBKU09OLnN0cmluZ2lmeShtZXNzYWdlKTtcbiAgICBpZiAodGhpcy5vcGVuKSB7XG4gICAgICB0aGlzLnNvY2tldC5zZW5kKGZyYW1lKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5zZW5kUXVldWUucHVzaChmcmFtZSk7XG4gIH1cblxuICBvbk1lc3NhZ2UoY2FsbGJhY2s6IChtZXNzYWdlOiBNZXNzYWdlKSA9PiB2b2lkKTogdm9pZCB7XG4gICAgdGhpcy5tZXNzYWdlQ2FsbGJhY2sgPSBjYWxsYmFjaztcbiAgfVxuXG4gIG9uQ2xvc2UoY2FsbGJhY2s6IChyZWFzb246IENsb3NlUmVhc29uKSA9PiB2b2lkKTogdm9pZCB7XG4gICAgdGhpcy5jbG9zZUNhbGxiYWNrID0gY2FsbGJhY2s7XG4gIH1cblxuICBjbG9zZSgpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5jbG9zZWQpIHJldHVybjtcbiAgICB0aGlzLmNsb3NlZCA9IHRydWU7XG4gICAgdGhpcy5zZW5kUXVldWUubGVuZ3RoID0gMDtcbiAgICB0cnkge1xuICAgICAgdGhpcy5zb2NrZXQuY2xvc2UoMTAwMCwgJ2Nsb3NlZCBieSBjYWxsZXInKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIGFscmVhZHkgZGVhZCBcdTIwMTQgdGhlIGNsb3NlIGV2ZW50IG1heSBuZXZlciBhcnJpdmVcbiAgICB9XG4gICAgLy8gTm90aWZ5IGV2ZW4gaWYgdGhlIHNvY2tldCBuZXZlciBlbWl0cyAnY2xvc2UnIChmYWlsZWQgZGlhbCkuXG4gICAgdGhpcy5maW5pc2hDbG9zZSh7IGNvZGU6IDEwMDAsIHJlYXNvbjogJ2Nsb3NlZCBieSBjYWxsZXInIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBmYWlsKHJlYXNvbjogQ2xvc2VSZWFzb24pOiB2b2lkIHtcbiAgICB0aGlzLmNsb3NlZCA9IHRydWU7XG4gICAgdHJ5IHtcbiAgICAgIHRoaXMuc29ja2V0LmNsb3NlKHJlYXNvbi5jb2RlID8/IDEwMDIsIHJlYXNvbi5yZWFzb24gPz8gJycpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gYWxyZWFkeSBjbG9zZWRcbiAgICB9XG4gICAgdGhpcy5maW5pc2hDbG9zZShyZWFzb24pO1xuICB9XG5cbiAgcHJpdmF0ZSBmaW5pc2hDbG9zZShyZWFzb246IENsb3NlUmVhc29uKTogdm9pZCB7XG4gICAgdGhpcy5vcGVuID0gZmFsc2U7XG4gICAgdGhpcy5jbG9zZWQgPSB0cnVlO1xuICAgIGlmICh0aGlzLmNsb3NlTm90aWZpZWQpIHJldHVybjtcbiAgICB0aGlzLmNsb3NlTm90aWZpZWQgPSB0cnVlO1xuICAgIHRoaXMuY2xvc2VDYWxsYmFjaz8uKHJlYXNvbik7XG4gIH1cbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTs7O0FDY0EsSUFBQUEsbUJBQStCOzs7QUNLeEIsSUFBTSx3QkFBTixjQUFvQyxNQUFNO0FBQUEsRUFDL0MsWUFBWSxTQUFpQjtBQUMzQixVQUFNLE9BQU87QUFDYixTQUFLLE9BQU87QUFBQSxFQUNkO0FBQ0Y7QUFlTyxTQUFTLG1CQUFtQixPQUEwQjtBQUMzRCxNQUFJLE9BQU8sVUFBVSxVQUFVO0FBQzdCLFVBQU0sSUFBSSxzQkFBc0Isb0NBQW9DLE9BQU8sS0FBSyxFQUFFO0FBQUEsRUFDcEY7QUFDQSxNQUFJLE1BQU0sU0FBUyxJQUFJLEdBQUc7QUFDeEIsVUFBTSxJQUFJLHNCQUFzQixpQ0FBaUMsS0FBSyxVQUFVLEtBQUssQ0FBQyxFQUFFO0FBQUEsRUFDMUY7QUFDQSxNQUFJLGFBQWEsS0FBSyxLQUFLLEdBQUc7QUFDNUIsVUFBTSxJQUFJO0FBQUEsTUFDUixnRUFBZ0UsS0FBSyxVQUFVLEtBQUssQ0FBQztBQUFBLElBQ3ZGO0FBQUEsRUFDRjtBQUNBLE1BQUksTUFBTSxXQUFXLE1BQU0sR0FBRztBQUM1QixVQUFNLElBQUk7QUFBQSxNQUNSLHNDQUFzQyxLQUFLLFVBQVUsS0FBSyxDQUFDO0FBQUEsSUFDN0Q7QUFBQSxFQUNGO0FBRUEsUUFBTSxZQUFZLE1BQU0sUUFBUSxPQUFPLEdBQUc7QUFDMUMsTUFBSSxVQUFVLFdBQVcsSUFBSSxHQUFHO0FBQzlCLFVBQU0sSUFBSTtBQUFBLE1BQ1IscUVBQXFFLEtBQUssVUFBVSxLQUFLLENBQUM7QUFBQSxJQUM1RjtBQUFBLEVBQ0Y7QUFFQSxRQUFN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QkFBaUIsV0FBVyxNQUFNO0FBQ3JDLFdBQUssaUJBQWlCO0FBQ3RCLFlBQU0sU0FBUyxLQUFLO0FBQ3BCLFVBQUksV0FBVyxNQUFNO0FBQ25CLGFBQUssV0FBVyxRQUFRO0FBQ3hCO0FBQUEsTUFDRjtBQUNBLGFBQ0csVUFBVSxFQUNWO0FBQUEsUUFDQyxNQUFNO0FBQ0osZUFBSyxXQUFXLFFBQVE7QUFBQSxRQUMxQjtBQUFBLFFBQ0EsQ0FBQyxVQUFtQjtBQUNsQixlQUFLLFdBQVcsUUFBUTtBQUN4QixlQUFLLGdCQUFnQixPQUFPLGtCQUFrQjtBQUFBLFFBQ2hEO0FBQUEsTUFDRixFQUNDLE1BQU0sTUFBTTtBQUFBLE1BQUMsQ0FBQztBQUFBLElBQ25CLEdBQUcsT0FBTztBQUFBLEVBQ1o7QUFBQTtBQUFBLEVBR1EsZ0JBQWdCLE9BQWdCLFNBQXVCO0FBQzdELFFBQUksaUJBQWlCLGdCQUFnQixpQkFBaUIsbUJBQW1CO0FBQ3ZFLFdBQUssYUFBYTtBQUNsQixXQUFLLGFBQWE7QUFDbEIsV0FBSyxRQUFRLE1BQU0sU0FBUyxLQUFLO0FBQ2pDLFVBQUk7QUFBQSxRQUNGO0FBQUEsUUFDQTtBQUFBLE1BQ0Y7QUFDQTtBQUFBLElBQ0Y7QUFDQSxTQUFLLFFBQVEsS0FBSyxTQUFTLEtBQUs7QUFBQSxFQUNsQztBQUFBO0FBQUEsRUFHQSxNQUFjLHNCQUFzQixTQUFnRDtBQUNsRixRQUFJO0FBQ0osUUFBSTtBQUNGLFlBQU0sUUFBUSxNQUFNLFFBQVEsU0FBUyx3QkFBd0I7QUFDN0QsZUFBUyxLQUFLLE1BQU0sSUFBSSxZQUFZLEVBQUUsT0FBTyxLQUFLLENBQUM7QUFBQSxJQUNyRCxTQUFRO0FBQ047QUFBQSxJQUNGO0FBQ0EsUUFDRSxPQUFPLE9BQU8sYUFBYSxZQUMzQixPQUFPLGFBQWEsS0FBSyxLQUFLLFVBQzlCO0FBQ0EsWUFBTSxPQUFPLE9BQU8sT0FBTyxlQUFlLFdBQVcsT0FBTyxhQUFhLE9BQU87QUFDaEYsWUFBTSxRQUFRLE9BQU8sT0FBTyxRQUFRLFdBQVcsT0FBTyxNQUFNO0FBQzVELFVBQUk7QUFBQSxRQUNGLDREQUE0RCxJQUFJLGdCQUFnQixLQUFLO0FBQUEsUUFHckY7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFDRjtBQUVBLFNBQVMsdUJBQXVCLE9BQXVCO0FBQ3JELE1BQUk7QUFDRixXQUFPLG1CQUFtQixLQUFLO0FBQUEsRUFDakMsU0FBUTtBQUNOLFdBQU87QUFBQSxFQUNUO0FBQ0Y7IiwKICAibmFtZXMiOiBbImltcG9ydF9vYnNpZGlhbiIsICJtb3ZlZCIsICJpc1BsYWluT2JqZWN0IiwgIl9hIiwgIl9iIiwgIl9jIiwgIl9kIiwgIl9lIiwgImNvbXBhcmVTdHJpbmdzIiwgImltcG9ydF9vYnNpZGlhbiIsICJpbXBvcnRfb2JzaWRpYW4iLCAiaW1wb3J0X29ic2lkaWFuIiwgIl9hIiwgIl9hIl0KfQo=
