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
        clock: change.clock
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
        clock
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
        clock: reply.winner.clock
      });
      return;
    }
    this.index = await this.applyPulls([this.winnerAsPull(reply.winner)]);
  }
  /** Turn an arbitrated winner version into a pull op (content ops only). */
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
      deleted
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiLCAic3JjL3BsdWdpbi50cyIsICIuLi9jb3JlL3NyYy9wYXRocy50cyIsICIuLi9jb3JlL3NyYy9jbG9jay50cyIsICIuLi9jb3JlL3NyYy9oYXNoaW5nLnRzIiwgIi4uL2NvcmUvc3JjL2Vycm9ycy50cyIsICIuLi9jb3JlL3NyYy9sb2NhbGluZGV4LnRzIiwgIi4uL2NvcmUvc3JjL2VuZ2luZS50cyIsICIuLi9jb3JlL3NyYy9pZ25vcmUudHMiLCAiLi4vY29yZS9zcmMvcHJvdG9jb2wudHMiLCAiLi4vY29yZS9zcmMvY29uZmxpY3RuYW1lcy50cyIsICIuLi9jb3JlL3NyYy9yZXNvbHZlLnRzIiwgIi4uL2NvcmUvc3JjL3NjYW4udHMiLCAiLi4vY29yZS9zcmMvY2xpZW50LnRzIiwgIi4uL2NvcmUvc3JjL2NvbXBhdC50cyIsICJzcmMvYWRhcHRlcnMvb2JzaWRpYW4tc3RvcmFnZS50cyIsICJzcmMvYWRhcHRlcnMvb2JzaWRpYW4td2F0Y2gudHMiLCAic3JjL2Jsb2JzdG9yZS50cyIsICJzcmMvZGlhZ25vc3RpY3MudHMiLCAic3JjL2RhdGEudHMiLCAic3JjL3dvcmtlcmFwaS50cyIsICJzcmMvcGFpcmluZy50cyIsICJzcmMvcHJvdG9jb2wtaGFuZGxlci50cyIsICJzcmMvcmVjb25uZWN0LnRzIiwgInNyYy9zZXR0aW5ncy50cyIsICJzcmMvc3RhdHVzYmFyLnRzIiwgInNyYy90cmFuc3BvcnQudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8qKlxuICogUGx1Z2luIGVudHJ5IHBvaW50IFx1MjAxNCBPYnNpZGlhbiBsb2FkcyBgbWFpbi5qc2AgYW5kIGluc3RhbnRpYXRlcyB0aGUgZGVmYXVsdFxuICogZXhwb3J0LiBFdmVyeXRoaW5nIHJlYWwgbGl2ZXMgaW4gYHBsdWdpbi50c2AgKGFuZCBpdHMgbW9kdWxlcyk7IHRoaXMgZmlsZVxuICogb25seSByZS1leHBvcnRzLlxuICovXG5cbmV4cG9ydCB7IFZhdWx0U3luY1BsdWdpbiBhcyBkZWZhdWx0IH0gZnJvbSAnLi9wbHVnaW4uanMnO1xuIiwgIi8qKlxuICogYFZhdWx0U3luY1BsdWdpbmAgXHUyMDE0IHRoZSBPYnNpZGlhbiBjbGllbnQgKGRlc2t0b3AgKyBtb2JpbGUpLlxuICpcbiAqIG9ubG9hZDogbG9hZCBsaW5rIGlkZW50aXR5IFx1MjE5MiBpZiBsaW5rZWQsIGJ1aWxkIGBTeW5jQ2xpZW50YCAoY29yZSkgb3ZlciB0aGVcbiAqIE9ic2lkaWFuIGFkYXB0ZXJzIGFuZCBydW4gc3RhcnR1cCByZWNvbmNpbGlhdGlvbiAodGhlIHN5bmMtb24tb3BlblxuICogY29udHJhY3QsIEZSLTQvRlItNS9GUi0xMiksIHRoZW4gZW50ZXIgbGl2ZSBtb2RlICh2YXVsdCBldmVudHMgKyBwZXJpb2RpY1xuICogcmVzY2FuICsgZm9jdXMgcmVzY2FuKSB3aXRoIGEgc3RhdHVzLWJhciBpbmRpY2F0b3IgYW5kIGppdHRlcmVkXG4gKiBleHBvbmVudGlhbC1iYWNrb2ZmIHJlY29ubmVjdCAoY2FwcGVkIGF0IDYwIHMpLlxuICpcbiAqIEEgMSBIeiBcInN1cGVydmlzaW9uIHRpY2tcIiBkcml2ZXMgZXZlcnl0aGluZyB0aW1lLWJhc2VkOiBpdCByZXBhaW50cyB0aGVcbiAqIHN0YXR1cyBiYXIgYW5kIG5vdGljZXMgYGRpc2Nvbm5lY3RlZGAgXHUyMTkyIHNjaGVkdWxlcyBvbmUgcmVjb25uZWN0IGF0IGEgdGltZS5cbiAqIEFsbCB0aW1lcnMgYXJlIG93bmVkIGhlcmUgYW5kIHRvcm4gZG93biBpbiBgc3RvcFN5bmMoKWAvYG9udW5sb2FkYC5cbiAqL1xuXG5pbXBvcnQgeyBOb3RpY2UsIFBsdWdpbiB9IGZyb20gJ29ic2lkaWFuJztcbmltcG9ydCB0eXBlIHsgQXBwLCBQbHVnaW5NYW5pZmVzdCB9IGZyb20gJ29ic2lkaWFuJztcbmltcG9ydCB7XG4gIGNoZWNrU2VydmVyQ29tcGF0aWJpbGl0eSxcbiAgUmV2b2tlZEVycm9yLFxuICBTeW5jQ2xpZW50LFxuICBVbmF1dGhvcml6ZWRFcnJvcixcbiAgdHlwZSBDb21wYXRpYmlsaXR5VmVyZGljdCxcbiAgdHlwZSBTeW5jQ2xpZW50U3RhdHVzLFxufSBmcm9tICdAdnNhL2NvcmUnO1xuaW1wb3J0IHsgT2JzaWRpYW5TdG9yYWdlQWRhcHRlciB9IGZyb20gJy4vYWRhcHRlcnMvb2JzaWRpYW4tc3RvcmFnZS5qcyc7XG5pbXBvcnQgeyBPYnNpZGlhbldhdGNoQWRhcHRlciwgUmVzY2FuU2NoZWR1bGVyIH0gZnJvbSAnLi9hZGFwdGVycy9vYnNpZGlhbi13YXRjaC5qcyc7XG5pbXBvcnQgeyBIdHRwQmxvYlN0b3JlIH0gZnJvbSAnLi9ibG9ic3RvcmUuanMnO1xuaW1wb3J0IHtcbiAgYnVpbGREaWFnbm9zdGljc0J1bmRsZSxcbiAgYnVpbGRTdXBwb3J0QnVuZGxlLFxuICBjb3B5VG9DbGlwYm9hcmQsXG4gIGNyZWF0ZVBsdWdpbkxvZyxcbiAgZm9ybWF0U3VwcG9ydEJ1bmRsZVN0YW1wLFxuICBwbGF0Zm9ybVN1bW1hcnksXG4gIHdpdGhSb3VuZFRyaXBMb2dnaW5nLFxuICB0eXBlIERpYWdub3N0aWNzSW5wdXQsXG4gIHR5cGUgUGx1Z2luTG9nLFxufSBmcm9tICcuL2RpYWdub3N0aWNzLmpzJztcbmltcG9ydCB7XG4gIGRlZmF1bHREZXZpY2VOYW1lLFxuICBkZXRlY3REZXZpY2VUeXBlLFxuICBpc0xpbmtlZCxcbiAgbm9ybWFsaXplUGx1Z2luRGF0YSxcbiAgcGFyc2VJZ25vcmVQYXR0ZXJucyxcbiAgZGVmYXVsdFBsdWdpbkRhdGEsXG4gIHR5cGUgTG9nTGV2ZWwsXG4gIHR5cGUgVmF1bHRTeW5jUGx1Z2luRGF0YSxcbn0gZnJvbSAnLi9kYXRhLmpzJztcbmltcG9ydCB7IHBhaXJPdXRjb21lTWVzc2FnZSwgcGFpcldpdGhXb3JrZXIgfSBmcm9tICcuL3BhaXJpbmcuanMnO1xuaW1wb3J0IHR5cGUgeyBQYWlyT3V0Y29tZSB9IGZyb20gJy4vcGFpcmluZy5qcyc7XG5pbXBvcnQgeyByZWdpc3RlclBhaXJQcm90b2NvbEhhbmRsZXIgfSBmcm9tICcuL3Byb3RvY29sLWhhbmRsZXIuanMnO1xuaW1wb3J0IHsgUmVjb25uZWN0U3VwZXJ2aXNvciB9IGZyb20gJy4vcmVjb25uZWN0LmpzJztcbmltcG9ydCB0eXBlIHsgQmFja29mZk9wdGlvbnMgfSBmcm9tICcuL3JlY29ubmVjdC5qcyc7XG5pbXBvcnQgdHlwZSB7IFN0YXR1c0Jhck1vZGUgfSBmcm9tICcuL3N0YXR1c2Jhci5qcyc7XG5pbXBvcnQgeyBDb25maXJtTW9kYWwsIFZhdWx0U3luY1NldHRpbmdUYWIgfSBmcm9tICcuL3NldHRpbmdzLmpzJztcbmltcG9ydCB7IFN0YXR1c0JhckluZGljYXRvciB9IGZyb20gJy4vc3RhdHVzYmFyLmpzJztcbmltcG9ydCB7IFdlYlNvY2tldFRyYW5zcG9ydCB9IGZyb20gJy4vdHJhbnNwb3J0LmpzJztcbmltcG9ydCB0eXBlIHsgV2ViU29ja2V0RmFjdG9yeSB9IGZyb20gJy4vdHJhbnNwb3J0LmpzJztcbmltcG9ydCB7IGZldGNoV29ya2VyU3RhdHVzLCBub3JtYWxpemVXb3JrZXJVcmwsIHJlbmFtZURldmljZSB9IGZyb20gJy4vd29ya2VyYXBpLmpzJztcbmltcG9ydCB0eXBlIHsgV29ya2VyU3RhdHVzU3VtbWFyeSB9IGZyb20gJy4vd29ya2VyYXBpLmpzJztcblxuLyoqIFRoZSBpbi12YXVsdCBkZXZpY2UgbWFya2VyIHNoYXJlZCB3aXRoIHRoZSBkYWVtb24vQ0xJIChGUi00NCBoYW5kc2hha2UpLiAqL1xuY29uc3QgREVWSUNFX01BUktFUl9WQVVMVF9QQVRIID0gJy8udmF1bHRzeW5jZm9yYWdlbnRzL2RldmljZS5qc29uJztcbmNvbnN0IExPQ0FMX0lOREVYX1ZBVUxUX1BBVEggPSAnLy52YXVsdHN5bmNmb3JhZ2VudHMvc3RhdGUnO1xuLyoqIFdoZXJlIFwiU2F2ZSBzdXBwb3J0IGJ1bmRsZVwiIHdyaXRlcyBpdHMgZGlhZ25vc3RpYyBmaWxlLiAqL1xuY29uc3QgU1VQUE9SVF9CVU5ETEVfRElSX1ZBVUxUX1BBVEggPSAnLy52YXVsdHN5bmNmb3JhZ2VudHMnO1xuY29uc3QgU1VQRVJWSVNJT05fVElDS19NUyA9IDEwMDA7XG5cbi8qKiBUaW1lciBoYW5kbGVzIChudW1iZXIgaW4gdGhlIERPTSwgYFRpbWVvdXRgIHdoZW4gTm9kZSB0eXBlcyBsZWFrIGluKS4gKi9cbnR5cGUgVGltZXJIYW5kbGUgPSBSZXR1cm5UeXBlPHR5cGVvZiBzZXRJbnRlcnZhbD47XG5cbi8qKiBJbmplY3RhYmxlIHNlYW1zIHNvIHVuaXQgdGVzdHMgbmVlZCBubyByZWFsIE9ic2lkaWFuL25ldHdvcmsuICovXG5leHBvcnQgaW50ZXJmYWNlIFBsdWdpbk92ZXJyaWRlcyB7XG4gIGZldGNoSW1wbD86IHR5cGVvZiBmZXRjaDtcbiAgd3NGYWN0b3J5PzogV2ViU29ja2V0RmFjdG9yeTtcbiAgbm93PzogKCkgPT4gbnVtYmVyO1xuICAvKiogUmVjb25uZWN0IGJhY2tvZmYga25vYnMgKHRlc3RzIGluamVjdCBhIGRldGVybWluaXN0aWMgcmFuZG9tKS4gKi9cbiAgcmVjb25uZWN0PzogQmFja29mZk9wdGlvbnM7XG59XG5cbmV4cG9ydCBjbGFzcyBWYXVsdFN5bmNQbHVnaW4gZXh0ZW5kcyBQbHVnaW4ge1xuICBkYXRhOiBWYXVsdFN5bmNQbHVnaW5EYXRhID0gZGVmYXVsdFBsdWdpbkRhdGEoKTtcbiAgLyoqIFRoZSBsaXZlIHN5bmMgY2xpZW50IChudWxsIHdoaWxlIHVubGlua2VkL3N0b3BwZWQpLiAqL1xuICBjbGllbnQ6IFN5bmNDbGllbnQgfCBudWxsID0gbnVsbDtcblxuICBwcml2YXRlIHJlYWRvbmx5IG92ZXJyaWRlczogUGx1Z2luT3ZlcnJpZGVzO1xuICBwcml2YXRlIHdhdGNoZXI6IE9ic2lkaWFuV2F0Y2hBZGFwdGVyIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgcmVzY2FuOiBSZXNjYW5TY2hlZHVsZXIgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBzdGF0dXNCYXI6IFN0YXR1c0JhckluZGljYXRvciB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHN0YXR1c0Jhckl0ZW06IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgdGlja0hhbmRsZTogVGltZXJIYW5kbGUgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSByZWNvbm5lY3RUaW1lcjogVGltZXJIYW5kbGUgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBzdXBlcnZpc29yID0gbmV3IFJlY29ubmVjdFN1cGVydmlzb3IoKTtcbiAgLyoqIFNldCB3aGVuIHRoZSB3b3JrZXIgcmVqZWN0ZWQgdGhlIHRva2VuIFx1MjAxNCByZWNvbm5lY3RpbmcgY2Fubm90IGhlbHAuICovXG4gIHByaXZhdGUgYXV0aEZhaWxlZCA9IGZhbHNlO1xuICBwcml2YXRlIHN0YXR1c05vdGUgPSAnJztcbiAgLyoqXG4gICAqIExhdGVzdCBzZXJ2ZXItdmVyc2lvbiB2ZXJkaWN0IChjb3JlIGNvbXBhdC50cyksIHJlLWFzc2Vzc2VkIGJ5IHRoZVxuICAgKiBzdXBlcnZpc2lvbiB0aWNrIGFmdGVyIGV2ZXJ5IGhlbGxvQWNrOyBudWxsIGJlZm9yZSB0aGUgZmlyc3QgYWNrIG9mIGFcbiAgICogc3luYyBzZXNzaW9uLiBOb24tb2sgdmVyZGljdHMgcmlkZSB0aGUgc3RhdHVzLWJhciB0b29sdGlwOyBhIE5vdGljZSBpc1xuICAgKiBzaG93biBhdCBtb3N0IG9uY2UgcGVyIHBsdWdpbiBzZXNzaW9uLlxuICAgKi9cbiAgcHJpdmF0ZSBzZXJ2ZXJDb21wYXQ6IENvbXBhdGliaWxpdHlWZXJkaWN0IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgc2VydmVyQ29tcGF0Tm90aWZpZWQgPSBmYWxzZTtcbiAgLyoqIFBhdXNlLXN5bmNpbmcgc3RhdGUgKHJ1bnRpbWUgb25seSBcdTIwMTQgYSByZWxvYWQgc3RhcnRzIHBlciBzeW5jT25TdGFydHVwKS4gKi9cbiAgcHJpdmF0ZSBwYXVzZWQgPSBmYWxzZTtcbiAgLyoqIFRoZSBwbHVnaW4ncyBsb2c6IGNvbnNvbGUgbWlycm9yICsgYm91bmRlZCByaW5nIChDb3B5IGRpYWdub3N0aWNzKS4gKi9cbiAgcHJpdmF0ZSByZWFkb25seSBzeW5jTG9nOiBQbHVnaW5Mb2cgPSBjcmVhdGVQbHVnaW5Mb2coKTtcblxuICBjb25zdHJ1Y3RvcihhcHA6IEFwcCwgbWFuaWZlc3Q6IFBsdWdpbk1hbmlmZXN0LCBvdmVycmlkZXM6IFBsdWdpbk92ZXJyaWRlcyA9IHt9KSB7XG4gICAgc3VwZXIoYXBwLCBtYW5pZmVzdCk7XG4gICAgdGhpcy5vdmVycmlkZXMgPSBvdmVycmlkZXM7XG4gIH1cblxuICBwcml2YXRlIGdldCBub3coKTogKCkgPT4gbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy5vdmVycmlkZXMubm93ID8/ICgoKSA9PiBEYXRlLm5vdygpKTtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0IGZldGNoSW1wbCgpOiB0eXBlb2YgZmV0Y2gge1xuICAgIC8vIEJpbmQgYXQgdGhlIHNlYW06IGNvbnN1bWVycyAocGFpcmluZywgYEh0dHBCbG9iU3RvcmVgKSBpbnZva2UgdGhpcyBhcyBhXG4gICAgLy8gZGV0YWNoZWQgZnVuY3Rpb24sIGFuZCBhIGRldGFjaGVkIGBmZXRjaGAgdGhyb3dzXG4gICAgLy8gYFR5cGVFcnJvcjogRmFpbGVkIHRvIGV4ZWN1dGUgJ2ZldGNoJyBvbiAnV2luZG93JzogSWxsZWdhbCBpbnZvY2F0aW9uYFxuICAgIC8vIGluIENocm9taXVtIHJlbmRlcmVycyBcdTIwMTQgaS5lLiBpbiByZWFsIE9ic2lkaWFuIChkZXNrdG9wIGFuZCBtb2JpbGUpLlxuICAgIC8vIEJpbmRpbmcgdG8gdGhlIGdsb2JhbCBtYWtlcyB0aGUgZGVmYXVsdCBzYWZlIHRvIGNhbGwgYmFyZS5cbiAgICByZXR1cm4gdGhpcy5vdmVycmlkZXMuZmV0Y2hJbXBsID8/IGdsb2JhbFRoaXMuZmV0Y2guYmluZChnbG9iYWxUaGlzKTtcbiAgfVxuXG4gIGdldCBsaW5rZWQoKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGlzTGlua2VkKHRoaXMuZGF0YSk7XG4gIH1cblxuICBvdmVycmlkZSBhc3luYyBvbmxvYWQoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5kYXRhID0gbm9ybWFsaXplUGx1Z2luRGF0YShhd2FpdCB0aGlzLmxvYWREYXRhKCkpO1xuICAgIHRoaXMuc3luY0xvZy5zZXRMZXZlbCh0aGlzLmRhdGEuc2V0dGluZ3MubG9nTGV2ZWwpO1xuICAgIHRoaXMuYWRkU2V0dGluZ1RhYihuZXcgVmF1bHRTeW5jU2V0dGluZ1RhYih0aGlzLmFwcCwgdGhpcykpO1xuICAgIHJlZ2lzdGVyUGFpclByb3RvY29sSGFuZGxlcihcbiAgICAgIChhY3Rpb24sIGhhbmRsZXIpID0+IHRoaXMucmVnaXN0ZXJPYnNpZGlhblByb3RvY29sSGFuZGxlcihhY3Rpb24sIGhhbmRsZXIpLFxuICAgICAgKGxpbmspID0+IHRoaXMuaGFuZGxlUGFpckRlZXBMaW5rKGxpbmsudXJsLCBsaW5rLmNvZGUpLFxuICAgICk7XG4gICAgLy8gQ2hlYXAgZm9jdXMtZHJpdmVuIHJlc2NhbiAoRlItMTIpOiBldmVyeSBub3RlL2FwcCBzd2l0Y2ggcG9rZXMgdGhlXG4gICAgLy8gc2NoZWR1bGVyLCB3aGljaCBjb2FsZXNjZXMgaW50byBhdCBtb3N0IG9uZSBjeWNsZSBwZXIgZGVib3VuY2Ugd2luZG93LlxuICAgIHRoaXMucmVnaXN0ZXJFdmVudCh0aGlzLmFwcC53b3Jrc3BhY2Uub24oJ2FjdGl2ZS1sZWFmLWNoYW5nZScsICgpID0+IHRoaXMucmVzY2FuPy5wb2tlKCkpKTtcbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6ICdjb3B5LWRpYWdub3N0aWNzJyxcbiAgICAgIG5hbWU6ICdDb3B5IGRpYWdub3N0aWNzJyxcbiAgICAgIGNhbGxiYWNrOiAoKSA9PiB0aGlzLmNvcHlEaWFnbm9zdGljcygpLFxuICAgIH0pO1xuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogJ3NhdmUtc3VwcG9ydC1idW5kbGUnLFxuICAgICAgbmFtZTogJ1NhdmUgc3VwcG9ydCBidW5kbGUnLFxuICAgICAgY2FsbGJhY2s6ICgpID0+IHRoaXMuc2F2ZVN1cHBvcnRCdW5kbGUoKSxcbiAgICB9KTtcbiAgICAvLyBcIlN5bmMgb24gc3RhcnR1cFwiIE9GRiA9IG1hbnVhbC1vbmx5IG1vZGU6IGxvYWQgaWRsZTsgdGhlIGZpcnN0IFwiU3luY1xuICAgIC8vIG5vd1wiIHN0YXJ0cyB0aGUgbWFjaGluZXJ5ICh3YXRjaGVyIGluY2x1ZGVkKS5cbiAgICBpZiAodGhpcy5saW5rZWQgJiYgdGhpcy5kYXRhLnNldHRpbmdzLnN5bmNPblN0YXJ0dXApIGF3YWl0IHRoaXMuc3RhcnRTeW5jKCk7XG4gIH1cblxuICBvdmVycmlkZSBvbnVubG9hZCgpOiB2b2lkIHtcbiAgICB0aGlzLnN0b3BTeW5jKCk7XG4gIH1cblxuICAvLyAtLS0gcGVyc2lzdGVuY2UgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICBhc3luYyBzYXZlUGx1Z2luRGF0YSgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLnNhdmVEYXRhKHRoaXMuZGF0YSk7XG4gIH1cblxuICAvLyAtLS0gcGFpcmluZyAoc2V0dGluZ3MgdGFiICsgZGVlcCBsaW5rKSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIC8qKiBQYWlyIGZyb20gdGhlIHNldHRpbmdzIGZvcm0gKGZpZWxkcyBhbHJlYWR5IGxpdmUgaW4gYHRoaXMuZGF0YWApLiAqL1xuICBhc3luYyBwYWlyRnJvbVNldHRpbmdzKGNvZGU6IHN0cmluZyk6IFByb21pc2U8UGFpck91dGNvbWU+IHtcbiAgICBjb25zdCBkZXZpY2VOYW1lID0gdGhpcy5yZXNvbHZlRGV2aWNlTmFtZSgpO1xuICAgIGNvbnN0IG91dGNvbWUgPSBhd2FpdCBwYWlyV2l0aFdvcmtlcih7XG4gICAgICB1cmw6IHRoaXMuZGF0YS51cmwsXG4gICAgICBjb2RlLFxuICAgICAgZGV2aWNlTmFtZSxcbiAgICAgIGRldmljZVR5cGU6IGRldGVjdERldmljZVR5cGUoKSxcbiAgICAgIGZldGNoSW1wbDogdGhpcy5mZXRjaEltcGwsXG4gICAgfSk7XG4gICAgYXdhaXQgdGhpcy5hcHBseVBhaXJPdXRjb21lKG91dGNvbWUsIGRldmljZU5hbWUpO1xuICAgIHJldHVybiBvdXRjb21lO1xuICB9XG5cbiAgLyoqXG4gICAqIG9ic2lkaWFuOi8vdmF1bHRzeW5jZm9yYWdlbnRzL3BhaXI/dXJsPVx1MjAyNiZjb2RlPVx1MjAyNiAocHJvdG9jb2wtaGFuZGxlci50cykuXG4gICAqIE9uIGFuIHVubGlua2VkIHZhdWx0IHRoZSBsaW5rJ3Mgb3JpZ2luIGlzIHVudHJ1c3RlZCB1bnRpbCB0aGUgdXNlclxuICAgKiBhcHByb3ZlcyBpdCBcdTIwMTQgcGFpcmluZyB3b3VsZCBoYW5kIHRoZSB3aG9sZSB2YXVsdCB0byB3aGF0ZXZlciBob3N0IHRoZVxuICAgKiBsaW5rIGNhcnJpZWQgXHUyMDE0IHNvIGl0IGdvZXMgdGhyb3VnaCBhIGNvbmZpcm1hdGlvbiBuYW1pbmcgdGhhdCBleGFjdCBVUkwuXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIGhhbmRsZVBhaXJEZWVwTGluayh1cmw6IHN0cmluZywgY29kZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKHRoaXMubGlua2VkKSB7XG4gICAgICBpZiAobm9ybWFsaXplV29ya2VyVXJsU2FmZSh1cmwpID09PSBub3JtYWxpemVXb3JrZXJVcmxTYWZlKHRoaXMuZGF0YS51cmwpKSB7XG4gICAgICAgIG5ldyBOb3RpY2UoJ1ZhdWx0U3luYzogdGhpcyB2YXVsdCBpcyBhbHJlYWR5IHBhaXJlZCB3aXRoIHRoYXQgd29ya2VyLicpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbmV3IE5vdGljZShcbiAgICAgICAgICAnVmF1bHRTeW5jOiB0aGlzIHZhdWx0IGlzIHBhaXJlZCB3aXRoIGEgZGlmZmVyZW50IHdvcmtlci4gVW5saW5rIGl0IGluIHNldHRpbmdzIGZpcnN0LicsXG4gICAgICAgICAgMTAwMDAsXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIG5ldyBDb25maXJtTW9kYWwodGhpcy5hcHAsIHtcbiAgICAgIHRpdGxlOiAnUGFpciBWYXVsdFN5bmM/JyxcbiAgICAgIGJvZHk6XG4gICAgICAgIGBBIHBhaXJpbmcgbGluayBhc2tlZCBPYnNpZGlhbiB0byBwYWlyIHRoaXMgdmF1bHQgd2l0aCB0aGUgd29ya2VyIGF0OlxcblxcbiR7dXJsfVxcblxcbmAgK1xuICAgICAgICAnQXBwcm92aW5nIHBhaXJzIHRoaXMgZGV2aWNlIGFuZCBzZW5kcyB0aGlzIHZhdWx0XFx1MjAxOXMgbm90ZXMgdG8gdGhhdCB3b3JrZXIgZnJvbSB0aGVuIG9uLiAnICtcbiAgICAgICAgJ09ubHkgYXBwcm92ZSBhIGxpbmsgeW91IG9wZW5lZCBmcm9tIHlvdXIgb3duIHdvcmtlciBkYXNoYm9hcmQgXHUyMDE0IGFueSB3ZWIgcGFnZSBjYW4gY3JhZnQgb25lLicsXG4gICAgICBjb25maXJtVGV4dDogJ1BhaXInLFxuICAgICAgb25Db25maXJtOiAoKSA9PiB0aGlzLnBhaXJGcm9tRGVlcExpbmsodXJsLCBjb2RlKSxcbiAgICB9KS5vcGVuKCk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHBhaXJGcm9tRGVlcExpbmsodXJsOiBzdHJpbmcsIGNvZGU6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGRldmljZU5hbWUgPSB0aGlzLnJlc29sdmVEZXZpY2VOYW1lKCk7XG4gICAgY29uc3Qgb3V0Y29tZSA9IGF3YWl0IHBhaXJXaXRoV29ya2VyKHtcbiAgICAgIHVybCxcbiAgICAgIGNvZGUsXG4gICAgICBkZXZpY2VOYW1lLFxuICAgICAgZGV2aWNlVHlwZTogZGV0ZWN0RGV2aWNlVHlwZSgpLFxuICAgICAgZmV0Y2hJbXBsOiB0aGlzLmZldGNoSW1wbCxcbiAgICB9KTtcbiAgICBhd2FpdCB0aGlzLmFwcGx5UGFpck91dGNvbWUob3V0Y29tZSwgZGV2aWNlTmFtZSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGFwcGx5UGFpck91dGNvbWUob3V0Y29tZTogUGFpck91dGNvbWUsIGRldmljZU5hbWU6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmIChvdXRjb21lLnN0YXR1cyAhPT0gJ3BhaXJlZCcpIHtcbiAgICAgIG5ldyBOb3RpY2UocGFpck91dGNvbWVNZXNzYWdlKG91dGNvbWUpLCAxMDAwMCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRoaXMuZGF0YS51cmwgPSBvdXRjb21lLnVybDtcbiAgICB0aGlzLmRhdGEudG9rZW4gPSBvdXRjb21lLnRva2VuO1xuICAgIHRoaXMuZGF0YS5kZXZpY2VJZCA9IG91dGNvbWUuZGV2aWNlSWQ7XG4gICAgdGhpcy5kYXRhLmRldmljZU5hbWUgPSBkZXZpY2VOYW1lO1xuICAgIGF3YWl0IHRoaXMuc2F2ZVBsdWdpbkRhdGEoKTtcbiAgICBhd2FpdCB0aGlzLndyaXRlRGV2aWNlTWFya2VyKCk7XG4gICAgbmV3IE5vdGljZShwYWlyT3V0Y29tZU1lc3NhZ2Uob3V0Y29tZSkpO1xuICAgIGF3YWl0IHRoaXMuc3RhcnRTeW5jKCk7XG4gIH1cblxuICBwcml2YXRlIHJlc29sdmVEZXZpY2VOYW1lKCk6IHN0cmluZyB7XG4gICAgY29uc3QgdHlwZWQgPSB0aGlzLmRhdGEuZGV2aWNlTmFtZS50cmltKCk7XG4gICAgcmV0dXJuIHR5cGVkICE9PSAnJyA/IHR5cGVkIDogZGVmYXVsdERldmljZU5hbWUoKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBUaGUgdmF1bHQtYmFja2VkIHN0b3JhZ2UgYWRhcHRlciBldmVyeSBzeW5jIHN1cmZhY2UgdXNlcy4gV2lyZXMgdGhlXG4gICAqIGVtcHR5LWZvbGRlciByZW1vdmFsIHRocm91Z2ggYGZpbGVNYW5hZ2VyLnRyYXNoRmlsZWAgXHUyMDE0IE9ic2lkaWFuJ3NcbiAgICogYERhdGFBZGFwdGVyLnJtZGlyYCByZWZ1c2VzIEVWRVJZIGRpcmVjdG9yeSAoYEVSUl9GU19FSVNESVJgKSwgd2hpY2hcbiAgICogc2lsZW50bHkgZGVncmFkZWQgZm9sZGVyLXRvbWJzdG9uZSBhcHBsaWNhdGlvbiB0byByZWNvcmQtb25seSAoRi0xKS5cbiAgICogVHJhc2ggKG5vdCBkZWxldGUpIGJlY2F1c2UgYW4gZW1wdHkgZm9sZGVyIGlzIHRyaXZpYWxseSByZWNvdmVyYWJsZS5cbiAgICovXG4gIHByaXZhdGUgY3JlYXRlU3RvcmFnZUFkYXB0ZXIoKTogT2JzaWRpYW5TdG9yYWdlQWRhcHRlciB7XG4gICAgcmV0dXJuIG5ldyBPYnNpZGlhblN0b3JhZ2VBZGFwdGVyKHtcbiAgICAgIGFkYXB0ZXI6IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIsXG4gICAgICByZW1vdmVFbXB0eURpcjogYXN5bmMgKGFkYXB0ZXJQYXRoKSA9PiB7XG4gICAgICAgIGNvbnN0IGZvbGRlciA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChhZGFwdGVyUGF0aCk7XG4gICAgICAgIGlmIChmb2xkZXIgPT09IG51bGwpIHJldHVybjsgLy8gcmFjZWQgYXdheSAvIHRyZWUgbm90IGNhdWdodCB1cCBcdTIwMTQgaWRlbXBvdGVudFxuICAgICAgICBhd2FpdCB0aGlzLmFwcC5maWxlTWFuYWdlci50cmFzaEZpbGUoZm9sZGVyKTtcbiAgICAgIH0sXG4gICAgfSk7XG4gIH1cblxuICAvKiogV3JpdGUgdGhlIEZSLTQ0IG1hcmtlciB0aGUgQ0xJL2RhZW1vbiByZWFkIHRvIGRldGVjdCBkb3VibGUtY2xpZW50cy4gKi9cbiAgcHJpdmF0ZSBhc3luYyB3cml0ZURldmljZU1hcmtlcigpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIXRoaXMubGlua2VkKSByZXR1cm47XG4gICAgY29uc3Qgc3RvcmFnZSA9IHRoaXMuY3JlYXRlU3RvcmFnZUFkYXB0ZXIoKTtcbiAgICBjb25zdCBtYXJrZXIgPSB7XG4gICAgICBkZXZpY2VJZDogdGhpcy5kYXRhLmRldmljZUlkLFxuICAgICAgZGV2aWNlTmFtZTogdGhpcy5yZXNvbHZlRGV2aWNlTmFtZSgpLFxuICAgICAgdXJsOiB0aGlzLmRhdGEudXJsLFxuICAgICAgbGlua2VkQXQ6IHRoaXMubm93KCksXG4gICAgfTtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgc3RvcmFnZS53cml0ZUZpbGUoXG4gICAgICAgIERFVklDRV9NQVJLRVJfVkFVTFRfUEFUSCxcbiAgICAgICAgbmV3IFRleHRFbmNvZGVyKCkuZW5jb2RlKGAke0pTT04uc3RyaW5naWZ5KG1hcmtlciwgbnVsbCwgMil9XFxuYCksXG4gICAgICApO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLnN5bmNMb2cud2FybignZmFpbGVkIHRvIHdyaXRlIGRldmljZSBtYXJrZXInLCBlcnJvcik7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIGBQQVRDSCAvZGV2aWNlYCBcdTIwMTQgcmVuYW1lIFRISVMgZGV2aWNlIG9uIHRoZSB3b3JrZXIgKHRoZSBzZXR0aW5ncyB0YWInc1xuICAgKiBSZW5hbWUgYnV0dG9uKS4gVXBkYXRlcyBwbHVnaW4gZGF0YSArIHRoZSBpbi12YXVsdCBkZXZpY2UgbWFya2VyICh3aGljaFxuICAgKiBzdG9yZXMgdGhlIG5hbWUgZm9yIHRoZSBGUi00NCBkb3VibGUtY2xpZW50IHdhcm5pbmcpLiBMb2NhbCBzdGF0ZSBrZWVwc1xuICAgKiBpdHMgcHJldmlvdXMgbmFtZSBvbiBmYWlsdXJlLlxuICAgKi9cbiAgYXN5bmMgcmVuYW1lRGV2aWNlKG5hbWU6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIGlmICghdGhpcy5saW5rZWQpIHtcbiAgICAgIG5ldyBOb3RpY2UoJ1ZhdWx0U3luYzogcGFpciB0aGlzIHZhdWx0IGZpcnN0IFx1MjAxNCB0aGUgbmFtZSBhcHBsaWVzIGF0IHBhaXJpbmcgdGltZS4nKTtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgY29uc3QgdHJpbW1lZCA9IG5hbWUudHJpbSgpO1xuICAgIGlmICh0cmltbWVkID09PSAnJyB8fCB0cmltbWVkLmxlbmd0aCA+IDMwIHx8IC9bXFx1MDAwMC1cXHUwMDFmXFx1MDA3Zl0vLnRlc3QodHJpbW1lZCkpIHtcbiAgICAgIG5ldyBOb3RpY2UoJ1ZhdWx0U3luYzogZGV2aWNlIG5hbWUgbXVzdCBiZSAxLTMwIGNoYXJhY3RlcnMsIHdpdGhvdXQgY29udHJvbCBjaGFyYWN0ZXJzLicsIDgwMDApO1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICBjb25zdCBvdXRjb21lID0gYXdhaXQgcmVuYW1lRGV2aWNlKHtcbiAgICAgIG9yaWdpbjogdGhpcy5kYXRhLnVybCxcbiAgICAgIHRva2VuOiB0aGlzLmRhdGEudG9rZW4sXG4gICAgICBuYW1lOiB0cmltbWVkLFxuICAgICAgZmV0Y2hJbXBsOiB0aGlzLmZldGNoSW1wbCxcbiAgICB9KTtcbiAgICBpZiAoIW91dGNvbWUub2spIHtcbiAgICAgIG5ldyBOb3RpY2UoYFZhdWx0U3luYzogcmVuYW1pbmcgZmFpbGVkIFx1MjAxNCAke291dGNvbWUuZXJyb3J9YCwgMTAwMDApO1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICB0aGlzLmRhdGEuZGV2aWNlTmFtZSA9IG91dGNvbWUuZGV2aWNlLm5hbWU7XG4gICAgYXdhaXQgdGhpcy5zYXZlUGx1Z2luRGF0YSgpO1xuICAgIGF3YWl0IHRoaXMud3JpdGVEZXZpY2VNYXJrZXIoKTtcbiAgICBuZXcgTm90aWNlKGBWYXVsdFN5bmM6IGRldmljZSByZW5hbWVkIHRvIFx1MjAxQyR7b3V0Y29tZS5kZXZpY2UubmFtZX1cdTIwMUQuYCk7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICAvLyAtLS0gc3luYyBsaWZlY3ljbGUgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgLyoqIEJ1aWxkIGV2ZXJ5dGhpbmcgYW5kIHJ1biBzdGFydHVwIHJlY29uY2lsaWF0aW9uIChpZGVtcG90ZW50IHJlc3RhcnQpLiAqL1xuICBwcml2YXRlIGFzeW5jIHN0YXJ0U3luYygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIXRoaXMubGlua2VkKSByZXR1cm47XG4gICAgdGhpcy5zdG9wU3luYygpO1xuXG4gICAgY29uc3QgeyB1cmwsIHRva2VuLCBkZXZpY2VJZCB9ID0gdGhpcy5kYXRhO1xuICAgIGNvbnN0IGRldmljZU5hbWUgPSB0aGlzLnJlc29sdmVEZXZpY2VOYW1lKCk7XG4gICAgY29uc3Qgc3RvcmFnZSA9IHRoaXMuY3JlYXRlU3RvcmFnZUFkYXB0ZXIoKTtcbiAgICBhd2FpdCB0aGlzLndhcm5JZkZvcmVpZ25TdGF0ZURpcihzdG9yYWdlKTtcblxuICAgIGNvbnN0IGNsaWVudCA9IG5ldyBTeW5jQ2xpZW50KHtcbiAgICAgIGRldmljZUlkLFxuICAgICAgZGV2aWNlTmFtZSxcbiAgICAgIHRva2VuLFxuICAgICAgdHJhbnNwb3J0OiAoKSA9PlxuICAgICAgICB3aXRoUm91bmRUcmlwTG9nZ2luZyhcbiAgICAgICAgICBuZXcgV2ViU29ja2V0VHJhbnNwb3J0KHsgdXJsLCB0b2tlbiwgd3NGYWN0b3J5OiB0aGlzLm92ZXJyaWRlcy53c0ZhY3RvcnkgfSksXG4gICAgICAgICAgeyBsb2c6IHRoaXMuc3luY0xvZywgc2hvdWxkTG9nOiAoKSA9PiB0aGlzLnN5bmNMb2cuZGVidWdFbmFibGVkIH0sXG4gICAgICAgICksXG4gICAgICBibG9iU3RvcmU6IG5ldyBIdHRwQmxvYlN0b3JlKHsgYmFzZVVybDogdXJsLCB0b2tlbiwgZmV0Y2hJbXBsOiB0aGlzLmZldGNoSW1wbCB9KSxcbiAgICAgIHN0b3JhZ2UsXG4gICAgICBzZXR0aW5nczoge1xuICAgICAgICBvYnNpZGlhblN5bmM6IHRoaXMuZGF0YS5zZXR0aW5ncy5vYnNpZGlhblN5bmMsXG4gICAgICAgIGV4dHJhSWdub3JlczogcGFyc2VJZ25vcmVQYXR0ZXJucyh0aGlzLmRhdGEuc2V0dGluZ3MuaWdub3JlUGF0dGVybnMpLFxuICAgICAgfSxcbiAgICAgIGxvZzogdGhpcy5zeW5jTG9nLFxuICAgICAgbm93OiB0aGlzLm5vdyxcbiAgICB9KTtcbiAgICB0aGlzLmNsaWVudCA9IGNsaWVudDtcbiAgICB0aGlzLmF1dGhGYWlsZWQgPSBmYWxzZTtcbiAgICB0aGlzLnN0YXR1c05vdGUgPSAnJztcbiAgICB0aGlzLnNlcnZlckNvbXBhdCA9IG51bGw7IC8vIHJlLWFzc2Vzc2VkIGZyb20gdGhlIGZyZXNoIGhlbGxvQWNrXG4gICAgdGhpcy5zdXBlcnZpc29yID0gbmV3IFJlY29ubmVjdFN1cGVydmlzb3IodGhpcy5vdmVycmlkZXMucmVjb25uZWN0ID8/IHt9KTtcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBjbGllbnQuY29ubmVjdCgpOyAvLyBzdGFydHVwIHJlY29uY2lsaWF0aW9uIFx1MjE5MiBsaXZlIG1vZGVcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5oYW5kbGVTeW5jRXJyb3IoZXJyb3IsICdzdGFydHVwIHN5bmMgZmFpbGVkJyk7XG4gICAgfVxuXG4gICAgLy8gTGl2ZSB3YXRjaGluZzogdmF1bHQgZXZlbnRzIChkZWJvdW5jZWQgaW4gY29yZSkgKyByZXNjYW4gaG9va3MuXG4gICAgdGhpcy53YXRjaGVyID0gbmV3IE9ic2lkaWFuV2F0Y2hBZGFwdGVyKHsgdmF1bHQ6IHRoaXMuYXBwLnZhdWx0IH0pO1xuICAgIGNsaWVudC5zdGFydFdhdGNoaW5nKHRoaXMud2F0Y2hlcik7XG4gICAgdGhpcy5yZXNjYW4gPSBuZXcgUmVzY2FuU2NoZWR1bGVyKHtcbiAgICAgIGludGVydmFsTXM6IHRoaXMuZGF0YS5zZXR0aW5ncy5yZXNjYW5JbnRlcnZhbFNlYyAqIDEwMDAsXG4gICAgfSk7XG4gICAgdGhpcy5yZXNjYW4uc3RhcnQoKCkgPT4ge1xuICAgICAgdm9pZCBjbGllbnQudHJpZ2dlclN5bmMoKS5jYXRjaCgoZXJyb3I6IHVua25vd24pID0+IHtcbiAgICAgICAgdGhpcy5oYW5kbGVTeW5jRXJyb3IoZXJyb3IsICdyZXNjYW4gZmFpbGVkJyk7XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIC8vIFN0YXR1cyBiYXIgKHBlciB0aGUgc3RhdHVzQmFyTW9kZSBzZXR0aW5nKSArIHRoZSAxIEh6IHN1cGVydmlzaW9uIHRpY2tcbiAgICAvLyB0aGF0IHJlcGFpbnRzIGl0IGFuZCBzdXBlcnZpc2VzIHJlY29ubmVjdGlvbi5cbiAgICB0aGlzLm1vdW50U3RhdHVzQmFyKCk7XG4gICAgY29uc3QgdGljayA9IHNldEludGVydmFsKCgpID0+IHRoaXMub25UaWNrKCksIFNVUEVSVklTSU9OX1RJQ0tfTVMpO1xuICAgIHRoaXMudGlja0hhbmRsZSA9IHRpY2s7XG4gICAgdGhpcy5yZWdpc3RlckludGVydmFsKHRpY2sgYXMgdW5rbm93biBhcyBudW1iZXIpOyAvLyBPYnNpZGlhbiBjbGVhcnMgdGhpcyBvbiB1bmxvYWRcbiAgICB0aGlzLm9uVGljaygpO1xuICB9XG5cbiAgLyoqIChSZSltb3VudCB0aGUgc3RhdHVzLWJhciBpdGVtIHBlciB0aGUgY3VycmVudCBtb2RlICgnaGlkZGVuJyA9IG5vbmUpLiAqL1xuICBwcml2YXRlIG1vdW50U3RhdHVzQmFyKCk6IHZvaWQge1xuICAgIHRoaXMuc3RhdHVzQmFySXRlbT8ucmVtb3ZlKCk7XG4gICAgdGhpcy5zdGF0dXNCYXJJdGVtID0gbnVsbDtcbiAgICB0aGlzLnN0YXR1c0JhciA9IG51bGw7XG4gICAgaWYgKHRoaXMuY2xpZW50ID09PSBudWxsKSByZXR1cm47XG4gICAgaWYgKHRoaXMuZGF0YS5zZXR0aW5ncy5zdGF0dXNCYXJNb2RlID09PSAnaGlkZGVuJykgcmV0dXJuO1xuICAgIGNvbnN0IGl0ZW0gPSB0aGlzLmFkZFN0YXR1c0Jhckl0ZW0oKTtcbiAgICB0aGlzLnN0YXR1c0Jhckl0ZW0gPSBpdGVtO1xuICAgIHRoaXMuc3RhdHVzQmFyID0gbmV3IFN0YXR1c0JhckluZGljYXRvcihpdGVtKTtcbiAgfVxuXG4gIC8qKiBUZWFyIGRvd24gZXZlcnkgdGltZXIsIHdhdGNoZXIsIHNvY2tldCwgYW5kIFVJIGFydGlmYWN0LiBJZGVtcG90ZW50LiAqL1xuICBwcml2YXRlIHN0b3BTeW5jKCk6IHZvaWQge1xuICAgIGlmICh0aGlzLnJlY29ubmVjdFRpbWVyICE9PSBudWxsKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGhpcy5yZWNvbm5lY3RUaW1lcik7XG4gICAgICB0aGlzLnJlY29ubmVjdFRpbWVyID0gbnVsbDtcbiAgICB9XG4gICAgaWYgKHRoaXMudGlja0hhbmRsZSAhPT0gbnVsbCkge1xuICAgICAgY2xlYXJJbnRlcnZhbCh0aGlzLnRpY2tIYW5kbGUpO1xuICAgICAgdGhpcy50aWNrSGFuZGxlID0gbnVsbDtcbiAgICB9XG4gICAgdGhpcy5yZXNjYW4/LnN0b3AoKTtcbiAgICB0aGlzLnJlc2NhbiA9IG51bGw7XG4gICAgdGhpcy5jbGllbnQ/LmNsb3NlKCk7IC8vIGFsc28gc3RvcHMgdGhlIHdhdGNoZXJcbiAgICB0aGlzLmNsaWVudCA9IG51bGw7XG4gICAgdGhpcy53YXRjaGVyID0gbnVsbDtcbiAgICB0aGlzLnN0YXR1c0Jhckl0ZW0/LnJlbW92ZSgpO1xuICAgIHRoaXMuc3RhdHVzQmFySXRlbSA9IG51bGw7XG4gICAgdGhpcy5zdGF0dXNCYXIgPSBudWxsO1xuICB9XG5cbiAgLy8gLS0tIHVzZXIgYWN0aW9ucyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgYXN5bmMgc3luY05vdygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAodGhpcy5wYXVzZWQpIHtcbiAgICAgIG5ldyBOb3RpY2UoJ1ZhdWx0U3luYzogc3luY2luZyBpcyBwYXVzZWQgXHUyMDE0IHJlc3VtZSBpdCBpbiBzZXR0aW5ncyBmaXJzdC4nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgY2xpZW50ID0gdGhpcy5jbGllbnQ7XG4gICAgaWYgKGNsaWVudCA9PT0gbnVsbCkge1xuICAgICAgaWYgKCF0aGlzLmxpbmtlZCkge1xuICAgICAgICBuZXcgTm90aWNlKCdWYXVsdFN5bmM6IG5vdCBwYWlyZWQgeWV0IFx1MjAxNCBhZGQgeW91ciB3b3JrZXIgVVJMIGFuZCBhIHBhaXJpbmcgY29kZSBpbiBzZXR0aW5ncy4nKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgLy8gTWFudWFsLW9ubHkgbW9kZSAoXCJTeW5jIG9uIHN0YXJ0dXBcIiBPRkYpOiB0aGlzIGlzIHRoZSBmaXJzdCBzdGFydC5cbiAgICAgIGF3YWl0IHRoaXMuc3RhcnRTeW5jKCk7XG4gICAgICBjb25zdCBzdGF0dXMgPSB0aGlzLmNsaWVudD8uc3RhdHVzKCk7XG4gICAgICBpZiAoc3RhdHVzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgbmV3IE5vdGljZShcbiAgICAgICAgICBzdGF0dXMuc3RhdGUgPT09ICdkaXNjb25uZWN0ZWQnXG4gICAgICAgICAgICA/ICdWYXVsdFN5bmM6IG9mZmxpbmUgXHUyMDE0IGNoYW5nZXMgd2lsbCBzeW5jIHdoZW4gdGhlIHdvcmtlciBpcyByZWFjaGFibGUuJ1xuICAgICAgICAgICAgOiAnVmF1bHRTeW5jOiB1cCB0byBkYXRlLicsXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBjbGllbnQudHJpZ2dlclN5bmMoKTtcbiAgICAgIGNvbnN0IHN0YXR1cyA9IGNsaWVudC5zdGF0dXMoKTtcbiAgICAgIG5ldyBOb3RpY2UoXG4gICAgICAgIHN0YXR1cy5zdGF0ZSA9PT0gJ2Rpc2Nvbm5lY3RlZCdcbiAgICAgICAgICA/ICdWYXVsdFN5bmM6IG9mZmxpbmUgXHUyMDE0IGNoYW5nZXMgd2lsbCBzeW5jIHdoZW4gdGhlIHdvcmtlciBpcyByZWFjaGFibGUuJ1xuICAgICAgICAgIDogJ1ZhdWx0U3luYzogdXAgdG8gZGF0ZS4nLFxuICAgICAgKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5oYW5kbGVTeW5jRXJyb3IoZXJyb3IsICdzeW5jIG5vdyBmYWlsZWQnKTtcbiAgICAgIG5ldyBOb3RpY2UoJ1ZhdWx0U3luYzogc3luYyBmYWlsZWQgXHUyMDE0IHNlZSB0aGUgZGV2ZWxvcGVyIGNvbnNvbGUgZm9yIGRldGFpbHMuJyk7XG4gICAgfVxuICB9XG5cbiAgLyoqIFBhdXNlOiB0cmFuc3BvcnQgZG93biArIHdhdGNoZXIvcmVzY2FuIGlkbGUsIGxpbmsgYW5kIHN0YXRlIGtlcHQuICovXG4gIHBhdXNlU3luY2luZygpOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMubGlua2VkIHx8IHRoaXMucGF1c2VkKSByZXR1cm47XG4gICAgdGhpcy5wYXVzZWQgPSB0cnVlO1xuICAgIGlmICh0aGlzLnJlY29ubmVjdFRpbWVyICE9PSBudWxsKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGhpcy5yZWNvbm5lY3RUaW1lcik7XG4gICAgICB0aGlzLnJlY29ubmVjdFRpbWVyID0gbnVsbDtcbiAgICB9XG4gICAgdGhpcy5zdXBlcnZpc29yLnNldHRsZWQoKTtcbiAgICB0aGlzLnJlc2Nhbj8uc3RvcCgpO1xuICAgIHRoaXMucmVzY2FuID0gbnVsbDtcbiAgICB0aGlzLmNsaWVudD8uY2xvc2UoKTsgLy8gYWxzbyBzdG9wcyB0aGUgd2F0Y2hlcjsgc3RhdGUgXHUyMTkyIGlkbGVcbiAgICB0aGlzLm9uVGljaygpOyAvLyByZXBhaW50IFwidnNhIFx1MjNGOFwiXG4gICAgbmV3IE5vdGljZSgnVmF1bHRTeW5jOiBwYXVzZWQuIE5ldyBhbmQgY2hhbmdlZCBmaWxlcyBzdGF5IGxvY2FsIHVudGlsIHlvdSByZXN1bWUuJyk7XG4gIH1cblxuICAvKiogUmVzdW1lOiByZWNvbm5lY3QgYW5kIHJ1biBhIGZ1bGwgY2F0Y2gtdXAgY3ljbGUgKHN0YXJ0dXAgcmVjb25jaWxpYXRpb24pLiAqL1xuICBhc3luYyByZXN1bWVTeW5jaW5nKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghdGhpcy5saW5rZWQgfHwgIXRoaXMucGF1c2VkKSByZXR1cm47XG4gICAgdGhpcy5wYXVzZWQgPSBmYWxzZTtcbiAgICBuZXcgTm90aWNlKCdWYXVsdFN5bmM6IHJlc3VtaW5nIFx1MjAxNCBydW5uaW5nIGEgZnVsbCBjYXRjaC11cCBzeW5jXHUyMDI2Jyk7XG4gICAgYXdhaXQgdGhpcy5zdGFydFN5bmMoKTtcbiAgfVxuXG4gIC8qKiBSdW50aW1lIHBhdXNlIHN0YXRlICh0aGUgc2V0dGluZ3MgdGFiJ3MgYnV0dG9uIGxhYmVsICsgZGlhZ25vc3RpY3MpLiAqL1xuICBnZXQgc3luY2luZ1BhdXNlZCgpOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy5wYXVzZWQ7XG4gIH1cblxuICBhc3luYyBhcHBseVJlc2NhbkludGVydmFsKHNlY29uZHM6IG51bWJlcik6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuZGF0YS5zZXR0aW5ncy5yZXNjYW5JbnRlcnZhbFNlYyA9IE1hdGgubWF4KDAsIE1hdGguZmxvb3Ioc2Vjb25kcykpO1xuICAgIGF3YWl0IHRoaXMuc2F2ZVBsdWdpbkRhdGEoKTtcbiAgICB0aGlzLnJlc2Nhbj8uc2V0SW50ZXJ2YWxNcyh0aGlzLmRhdGEuc2V0dGluZ3MucmVzY2FuSW50ZXJ2YWxTZWMgKiAxMDAwKTtcbiAgfVxuXG4gIGFzeW5jIGFwcGx5T2JzaWRpYW5TeW5jKGVuYWJsZWQ6IGJvb2xlYW4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLmRhdGEuc2V0dGluZ3Mub2JzaWRpYW5TeW5jID0gZW5hYmxlZDtcbiAgICBhd2FpdCB0aGlzLnNhdmVQbHVnaW5EYXRhKCk7XG4gICAgbmV3IE5vdGljZShcbiAgICAgIGVuYWJsZWRcbiAgICAgICAgPyAnVmF1bHRTeW5jOiAub2JzaWRpYW4vIHdpbGwgc3luYyBhZnRlciB0aGUgbmV4dCByZWNvbm5lY3QgKHRoZSB3b3JrZXJcXHUyMDE5cyBwZXItdmF1bHQgc2V0dGluZyB0YWtlcyBwcmVjZWRlbmNlKS4nXG4gICAgICAgIDogJ1ZhdWx0U3luYzogLm9ic2lkaWFuLyB3aWxsIGJlIGV4Y2x1ZGVkIGFmdGVyIHRoZSBuZXh0IHJlY29ubmVjdC4nLFxuICAgICk7XG4gIH1cblxuICBhc3luYyBhcHBseVN0YXR1c0Jhck1vZGUobW9kZTogU3RhdHVzQmFyTW9kZSk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuZGF0YS5zZXR0aW5ncy5zdGF0dXNCYXJNb2RlID0gbW9kZTtcbiAgICBhd2FpdCB0aGlzLnNhdmVQbHVnaW5EYXRhKCk7XG4gICAgdGhpcy5tb3VudFN0YXR1c0JhcigpOyAvLyByZS1tb3VudHMgKG9yIHJlbW92ZXMpIHRoZSBpdGVtIHBlciB0aGUgbW9kZVxuICAgIHRoaXMub25UaWNrKCk7XG4gIH1cblxuICBhc3luYyBhcHBseVN5bmNPblN0YXJ0dXAoZW5hYmxlZDogYm9vbGVhbik6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuZGF0YS5zZXR0aW5ncy5zeW5jT25TdGFydHVwID0gZW5hYmxlZDtcbiAgICBhd2FpdCB0aGlzLnNhdmVQbHVnaW5EYXRhKCk7XG4gICAgbmV3IE5vdGljZShcbiAgICAgIGVuYWJsZWRcbiAgICAgICAgPyAnVmF1bHRTeW5jOiBzeW5jaW5nIHdpbGwgc3RhcnQgYXV0b21hdGljYWxseSB0aGUgbmV4dCB0aW1lIE9ic2lkaWFuIG9wZW5zLidcbiAgICAgICAgOiAnVmF1bHRTeW5jOiBvbiB0aGUgbmV4dCBsYXVuY2ggdGhpcyBwbHVnaW4gc3RheXMgaWRsZSB1bnRpbCB5b3UgcHJlc3MgXHUyMDFDU3luYyBub3dcdTIwMUQuJyxcbiAgICApO1xuICB9XG5cbiAgYXN5bmMgYXBwbHlMb2dMZXZlbChsZXZlbDogTG9nTGV2ZWwpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLmRhdGEuc2V0dGluZ3MubG9nTGV2ZWwgPSBsZXZlbDtcbiAgICBhd2FpdCB0aGlzLnNhdmVQbHVnaW5EYXRhKCk7XG4gICAgdGhpcy5zeW5jTG9nLnNldExldmVsKGxldmVsKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBOZXcgaWdub3JlIHBhdHRlcm5zOiBwZXJzaXN0LCB0aGVuIHJlc3RhcnQgdGhlIHN5bmMgbWFjaGluZXJ5IHdoaWxlIGxpdmVcbiAgICogc28gdGhlIHNjYW4vd2F0Y2hlciBwaWNrIHRoZW0gdXAgaW1tZWRpYXRlbHkgKGEgcGF1c2VkIHNlc3Npb24gYXBwbGllc1xuICAgKiB0aGVtIG9uIHJlc3VtZSBcdTIwMTQgcmVzdW1lIGFsd2F5cyByZWJ1aWxkcyB0aGUgY2xpZW50KS5cbiAgICovXG4gIGFzeW5jIGFwcGx5SWdub3JlUGF0dGVybnModGV4dDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5kYXRhLnNldHRpbmdzLmlnbm9yZVBhdHRlcm5zID0gdGV4dDtcbiAgICBhd2FpdCB0aGlzLnNhdmVQbHVnaW5EYXRhKCk7XG4gICAgaWYgKHRoaXMuY2xpZW50ICE9PSBudWxsICYmICF0aGlzLnBhdXNlZCkgYXdhaXQgdGhpcy5zdGFydFN5bmMoKTtcbiAgfVxuXG4gIC8qKiBTdG9yYWdlL2F0dGFjaG1lbnQgc3VtbWFyeSBmb3IgdGhlIEFib3V0IHNlY3Rpb24gKG51bGwgPSB1bmF2YWlsYWJsZSkuICovXG4gIGFzeW5jIGZldGNoU3RvcmFnZVN1bW1hcnkoKTogUHJvbWlzZTxXb3JrZXJTdGF0dXNTdW1tYXJ5IHwgbnVsbD4ge1xuICAgIGlmICghdGhpcy5saW5rZWQpIHJldHVybiBudWxsO1xuICAgIHJldHVybiBmZXRjaFdvcmtlclN0YXR1cyh7XG4gICAgICBvcmlnaW46IHRoaXMuZGF0YS51cmwsXG4gICAgICB0b2tlbjogdGhpcy5kYXRhLnRva2VuLFxuICAgICAgZmV0Y2hJbXBsOiB0aGlzLmZldGNoSW1wbCxcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBUaGUgc2hhcmVkIHNuYXBzaG90IGJlaGluZCBcIkNvcHkgZGlhZ25vc3RpY3NcIiBhbmQgXCJTYXZlIHN1cHBvcnQgYnVuZGxlXCIuXG4gICAqIFN0cnVjdHVyYWxseSByZWRhY3RlZDogdGhlIGRldmljZSB0b2tlbiBuZXZlciBlbnRlcnMgKGl0IGxpdmVzIG9ubHkgaW5cbiAgICogYHRoaXMuZGF0YWApLCBhbmQgY29uZmxpY3RzIGNvbnRyaWJ1dGUgcGF0aHMgb25seSBcdTIwMTQgbmV2ZXIgZmlsZSBjb250ZW50LlxuICAgKi9cbiAgcHJpdmF0ZSBjb2xsZWN0RGlhZ25vc3RpY3NJbnB1dCgpOiBEaWFnbm9zdGljc0lucHV0IHtcbiAgICBjb25zdCBzdGF0dXMgPSB0aGlzLmNsaWVudD8uc3RhdHVzKCkgPz8gbnVsbDtcbiAgICByZXR1cm4ge1xuICAgICAgcGx1Z2luVmVyc2lvbjogdGhpcy5tYW5pZmVzdC52ZXJzaW9uIHx8ICd1bmtub3duJyxcbiAgICAgIGRldmljZUlkOiB0aGlzLmRhdGEuZGV2aWNlSWQsXG4gICAgICBkZXZpY2VOYW1lOiB0aGlzLnJlc29sdmVEZXZpY2VOYW1lKCksXG4gICAgICB3b3JrZXJVcmw6IHRoaXMuZGF0YS51cmwsXG4gICAgICBwYWlyZWQ6IHRoaXMubGlua2VkLFxuICAgICAgcGF1c2VkOiB0aGlzLnBhdXNlZCxcbiAgICAgIGNsaWVudFN0YXR1czogc3RhdHVzLFxuICAgICAgcmVjZW50TG9nTGluZXM6IHRoaXMuc3luY0xvZy5yZWNlbnRMaW5lcygpLFxuICAgICAgc2VydmVyVmVyc2lvbjogc3RhdHVzPy5zZXJ2ZXJWZXJzaW9uID8/IG51bGwsXG4gICAgICBzZXR0aW5nczogdGhpcy5kYXRhLnNldHRpbmdzLFxuICAgICAgcmVjZW50Q29uZmxpY3RzOiBzdGF0dXMgPT09IG51bGwgPyBbXSA6IHN0YXR1cy5jb25mbGljdHMubWFwKChjb25mbGljdCkgPT4gKHsgcGF0aDogY29uZmxpY3QucGF0aCB9KSksXG4gICAgfTtcbiAgfVxuXG4gIC8qKiBDb3B5IHRoZSBkaWFnbm9zdGljcyBidW5kbGUgdG8gdGhlIGNsaXBib2FyZCAoZmFsbGJhY2s6IGNvbnNvbGUpLiAqL1xuICBhc3luYyBjb3B5RGlhZ25vc3RpY3MoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgYnVuZGxlID0gYnVpbGREaWFnbm9zdGljc0J1bmRsZSh0aGlzLmNvbGxlY3REaWFnbm9zdGljc0lucHV0KCkpO1xuICAgIGNvbnN0IGNvcGllZCA9IGF3YWl0IGNvcHlUb0NsaXBib2FyZChidW5kbGUpO1xuICAgIGlmIChjb3BpZWQpIHtcbiAgICAgIG5ldyBOb3RpY2UoJ1ZhdWx0U3luYzogZGlhZ25vc3RpY3MgY29waWVkIHRvIHRoZSBjbGlwYm9hcmQuJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnNvbGUuaW5mbygnW3ZzYV0gZGlhZ25vc3RpY3MgKGNsaXBib2FyZCB1bmF2YWlsYWJsZSk6XFxuJyArIGJ1bmRsZSk7XG4gICAgbmV3IE5vdGljZSgnVmF1bHRTeW5jOiBjbGlwYm9hcmQgdW5hdmFpbGFibGUgXHUyMDE0IGRpYWdub3N0aWNzIHdyaXR0ZW4gdG8gdGhlIGRldmVsb3BlciBjb25zb2xlLicsIDEwMDAwKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBXcml0ZSB0aGUgc3VwcG9ydCBidW5kbGUgKG1hcmtkb3duKSBpbnRvIGAudmF1bHRzeW5jZm9yYWdlbnRzL2AgaW4gdGhlXG4gICAqIHZhdWx0IFx1MjAxNCB0aGUgcmljaGVyLCBhdHRhY2hhYmxlIHNpYmxpbmcgb2YgXCJDb3B5IGRpYWdub3N0aWNzXCIuXG4gICAqL1xuICBhc3luYyBzYXZlU3VwcG9ydEJ1bmRsZSgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBub3cgPSB0aGlzLm5vdygpO1xuICAgIGNvbnN0IG1hcmtkb3duID0gYnVpbGRTdXBwb3J0QnVuZGxlKHRoaXMuY29sbGVjdERpYWdub3N0aWNzSW5wdXQoKSwgbm93KTtcbiAgICBjb25zdCBmaWxlTmFtZSA9IGBzdXBwb3J0LWJ1bmRsZS0ke2Zvcm1hdFN1cHBvcnRCdW5kbGVTdGFtcChub3cpfS5tZGA7XG4gICAgY29uc3QgdmF1bHRQYXRoID0gYCR7U1VQUE9SVF9CVU5ETEVfRElSX1ZBVUxUX1BBVEh9LyR7ZmlsZU5hbWV9YDtcbiAgICB0cnkge1xuICAgICAgLy8gVGhlIHN0b3JhZ2UgYWRhcHRlciBta2RpcnMgdGhlIHN0YXRlIGRpciBvbiBkZW1hbmQgKGl0IGNhbiBiZSBhYnNlbnRcbiAgICAgIC8vIGJlZm9yZSB0aGUgZmlyc3Qgc3luYykgYW5kIGZhbGxzIGJhY2sgdG8gYSBwbGFpbiB3cml0ZSB3aGVyZSB0aGVcbiAgICAgIC8vIGFkYXB0ZXIgY2Fubm90IHJlbmFtZS5cbiAgICAgIGF3YWl0IHRoaXMuY3JlYXRlU3RvcmFnZUFkYXB0ZXIoKS53cml0ZUZpbGUodmF1bHRQYXRoLCBuZXcgVGV4dEVuY29kZXIoKS5lbmNvZGUobWFya2Rvd24pKTtcbiAgICAgIG5ldyBOb3RpY2UoYFZhdWx0U3luYzogc3VwcG9ydCBidW5kbGUgc2F2ZWQgdG8gJHt2YXVsdFBhdGguc2xpY2UoMSl9LmApO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLnN5bmNMb2cud2FybignZmFpbGVkIHRvIHdyaXRlIHN1cHBvcnQgYnVuZGxlJywgZXJyb3IpO1xuICAgICAgbmV3IE5vdGljZSgnVmF1bHRTeW5jOiBjb3VsZCBub3Qgd3JpdGUgdGhlIHN1cHBvcnQgYnVuZGxlIFx1MjAxNCBzZWUgdGhlIGRldmVsb3BlciBjb25zb2xlLicsIDEwMDAwKTtcbiAgICB9XG4gIH1cblxuICAvKiogVGhlIHBsYXRmb3JtIGxpbmUgZm9yIHRoZSBBYm91dC9kaWFnbm9zdGljcyByZWFkb3V0cy4gKi9cbiAgcGxhdGZvcm1TdW1tYXJ5KCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHBsYXRmb3JtU3VtbWFyeSgpO1xuICB9XG5cbiAgYXN5bmMgdW5saW5rKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuc3RvcFN5bmMoKTtcbiAgICB0aGlzLnBhdXNlZCA9IGZhbHNlO1xuICAgIC8vIENsZWFyIGxvY2FsIHN5bmMgc3RhdGUgKGRldmljZSBtYXJrZXIgKyBpbmRleCkgc28gYSBmdXR1cmUgY2xpZW50IFx1MjAxNFxuICAgIC8vIHRoaXMgcGx1Z2luIGFmdGVyIGEgcmUtcGFpciwgdGhlIGRhZW1vbiwgdGhlIENMSSBcdTIwMTQgc3RhcnRzIGNsZWFuXG4gICAgLy8gKEZSLTQ0OiBzdGFsZSBzdGF0ZSB3b3VsZCBtYWtlIGl0IHJlZnVzZSBvciBtaXMtc3luYykuXG4gICAgY29uc3Qgc3RvcmFnZSA9IHRoaXMuY3JlYXRlU3RvcmFnZUFkYXB0ZXIoKTtcbiAgICBhd2FpdCBzdG9yYWdlLmRlbGV0ZUZpbGUoREVWSUNFX01BUktFUl9WQVVMVF9QQVRIKTtcbiAgICBhd2FpdCBzdG9yYWdlLmRlbGV0ZUZpbGUoTE9DQUxfSU5ERVhfVkFVTFRfUEFUSCk7XG4gICAgdGhpcy5kYXRhID0ge1xuICAgICAgLi4uZGVmYXVsdFBsdWdpbkRhdGEoKSxcbiAgICAgIGRldmljZU5hbWU6IHRoaXMuZGF0YS5kZXZpY2VOYW1lLFxuICAgICAgc2V0dGluZ3M6IHRoaXMuZGF0YS5zZXR0aW5ncyxcbiAgICB9O1xuICAgIGF3YWl0IHRoaXMuc2F2ZVBsdWdpbkRhdGEoKTtcbiAgICBuZXcgTm90aWNlKFxuICAgICAgJ1ZhdWx0U3luYzogdW5saW5rZWQuIFJldm9rZSB0aGlzIGRldmljZSBmcm9tIHRoZSB3b3JrZXIgZGFzaGJvYXJkIGlmIHlvdSBhcmUgZG9uZSB3aXRoIGl0LicsXG4gICAgKTtcbiAgfVxuXG4gIC8vIC0tLSBzdXBlcnZpc2lvbiAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIHByaXZhdGUgb25UaWNrKCk6IHZvaWQge1xuICAgIGNvbnN0IGNsaWVudCA9IHRoaXMuY2xpZW50O1xuICAgIGlmIChjbGllbnQgPT09IG51bGwpIHJldHVybjtcbiAgICBjb25zdCBzdGF0dXMgPSBjbGllbnQuc3RhdHVzKCk7XG4gICAgdGhpcy5hc3Nlc3NTZXJ2ZXJWZXJzaW9uKHN0YXR1cyk7XG4gICAgdGhpcy5zdGF0dXNCYXI/LnVwZGF0ZShcbiAgICAgIHN0YXR1cyxcbiAgICAgIHtcbiAgICAgICAgdXJsOiB0aGlzLmRhdGEudXJsLFxuICAgICAgICBkZXZpY2VOYW1lOiB0aGlzLnJlc29sdmVEZXZpY2VOYW1lKCksXG4gICAgICAgIC8vIEJvdGggbm90ZXMgY2FuIGJlIGxpdmUgYXQgb25jZSAoYW4gYXV0aC1mYWlsdXJlIG5vdGUgd2hpbGUgdGhlXG4gICAgICAgIC8vIHNlcnZlciBhbHNvIHJlcG9ydHMgdmVyc2lvbiBza2V3KTogY29uY2F0ZW5hdGUgaW5zdGVhZCBvZiBsZXR0aW5nXG4gICAgICAgIC8vIGVpdGhlciBoaWRlIHRoZSBvdGhlcjsgZW1wdHkgcGFydHMgZHJvcCBvdXQuXG4gICAgICAgIG5vdGU6IFt0aGlzLnN0YXR1c05vdGUsIHRoaXMuc2VydmVyQ29tcGF0Tm90ZV0uZmlsdGVyKChwYXJ0KSA9PiBwYXJ0ICE9PSAnJykuam9pbignIFx1MDBCNyAnKSxcbiAgICAgICAgcGF1c2VkOiB0aGlzLnBhdXNlZCxcbiAgICAgICAgbW9kZTogdGhpcy5kYXRhLnNldHRpbmdzLnN0YXR1c0Jhck1vZGUsXG4gICAgICB9LFxuICAgICAgdGhpcy5ub3coKSxcbiAgICApO1xuICAgIGlmICh0aGlzLnBhdXNlZCB8fCB0aGlzLmF1dGhGYWlsZWQpIHJldHVybjsgLy8gbm8gcmVjb25uZWN0IHdoaWxlIHBhdXNlZCAvIHRva2VuIHJlamVjdGVkXG4gICAgY29uc3QgZGVjaXNpb24gPSB0aGlzLnN1cGVydmlzb3IuY29uc2lkZXIoc3RhdHVzLnN0YXRlKTtcbiAgICBpZiAoZGVjaXNpb24uYWN0aW9uID09PSAnd2FpdCcpIHJldHVybjtcbiAgICB0aGlzLnN1cGVydmlzb3IuYWNrbm93bGVkZ2VkKCk7XG4gICAgdGhpcy5zY2hlZHVsZVJlY29ubmVjdChkZWNpc2lvbi5kZWxheU1zKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBMYXRlc3Qgc2VydmVyLXZlcnNpb24gdmVyZGljdCBmb3IgdGhlIHNldHRpbmdzIHRhYjsgbnVsbCB1bnRpbCB0aGUgZmlyc3RcbiAgICogaGVsbG9BY2sgb2YgdGhlIGN1cnJlbnQgc3luYyBzZXNzaW9uLlxuICAgKi9cbiAgZ2V0IHNlcnZlckNvbXBhdGliaWxpdHkoKTogQ29tcGF0aWJpbGl0eVZlcmRpY3QgfCBudWxsIHtcbiAgICByZXR1cm4gdGhpcy5zZXJ2ZXJDb21wYXQ7XG4gIH1cblxuICAvKiogVGhlIHZlcmRpY3QncyB0b29sdGlwIGxpbmUgKCcnIHdoZW4gY29tcGF0aWJsZSBcdTIwMTQgbm90aGluZyB0byBuYWcgYWJvdXQpLiAqL1xuICBwcml2YXRlIGdldCBzZXJ2ZXJDb21wYXROb3RlKCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHRoaXMuc2VydmVyQ29tcGF0ICE9PSBudWxsICYmIHRoaXMuc2VydmVyQ29tcGF0LmxldmVsICE9PSAnb2snXG4gICAgICA/IHRoaXMuc2VydmVyQ29tcGF0Lm1lc3NhZ2VcbiAgICAgIDogJyc7XG4gIH1cblxuICAvKipcbiAgICogVmVyc2lvbi1za2V3IGFzc2Vzc21lbnQsIHJ1biBieSB0aGUgdGljayBvbmNlIHRoZSBjb25uZWN0aW9uIGhhcyBhY2tlZFxuICAgKiAoc3RhdGVzICdzeW5jaW5nJy8nbGl2ZScgYm90aCBmb2xsb3cgdGhlIGhlbGxvQWNrOyBwcmUtYWNrIHN0YXRlcyByZWFkXG4gICAqIHNlcnZlclZlcnNpb24gbnVsbCBmb3IgXCJub3QgeWV0IGtub3duXCIgYW5kIG11c3Qgbm90IHByb2R1Y2UgYSBzcHVyaW91c1xuICAgKiBcImxlZ2FjeSBzZXJ2ZXJcIiB2ZXJkaWN0KS4gTmV2ZXIga2lsbHMgc3luYzogdGhlIHdpcmUgYFByb3RvY29sVmVyc2lvbmBcbiAgICogY2hlY2sgYXQgaGVsbG8gcmVtYWlucyB0aGUgaGFyZCBnYXRlOyBhIHZlcmRpY3QgaXMgYWR2aXNvcnkuXG4gICAqL1xuICBwcml2YXRlIGFzc2Vzc1NlcnZlclZlcnNpb24oc3RhdHVzOiBTeW5jQ2xpZW50U3RhdHVzKTogdm9pZCB7XG4gICAgaWYgKHN0YXR1cy5zdGF0ZSAhPT0gJ3N5bmNpbmcnICYmIHN0YXR1cy5zdGF0ZSAhPT0gJ2xpdmUnKSByZXR1cm47XG4gICAgY29uc3QgdmVyZGljdCA9IGNoZWNrU2VydmVyQ29tcGF0aWJpbGl0eSh0aGlzLm1hbmlmZXN0LnZlcnNpb24gfHwgJ3Vua25vd24nLCBzdGF0dXMuc2VydmVyVmVyc2lvbik7XG4gICAgdGhpcy5zZXJ2ZXJDb21wYXQgPSB2ZXJkaWN0O1xuICAgIGlmICh2ZXJkaWN0LmxldmVsID09PSAnb2snKSByZXR1cm47IC8vIGFsc28gY2xlYXJzIGFueSBzdGFsZSB0b29sdGlwIG5vdGVcbiAgICBpZiAodGhpcy5zZXJ2ZXJDb21wYXROb3RpZmllZCkgcmV0dXJuOyAvLyBvbmUgTm90aWNlIHBlciBwbHVnaW4gc2Vzc2lvblxuICAgIHRoaXMuc2VydmVyQ29tcGF0Tm90aWZpZWQgPSB0cnVlO1xuICAgIG5ldyBOb3RpY2UoYFZhdWx0U3luYzogJHt2ZXJkaWN0Lm1lc3NhZ2V9YCwgMTAwMDApO1xuICB9XG5cbiAgcHJpdmF0ZSBzY2hlZHVsZVJlY29ubmVjdChkZWxheU1zOiBudW1iZXIpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5yZWNvbm5lY3RUaW1lciAhPT0gbnVsbCkgcmV0dXJuOyAvLyBvbmUgaW4gZmxpZ2h0LCBhbHdheXNcbiAgICB0aGlzLnJlY29ubmVjdFRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICB0aGlzLnJlY29ubmVjdFRpbWVyID0gbnVsbDtcbiAgICAgIGNvbnN0IGNsaWVudCA9IHRoaXMuY2xpZW50O1xuICAgICAgaWYgKGNsaWVudCA9PT0gbnVsbCkge1xuICAgICAgICB0aGlzLnN1cGVydmlzb3Iuc2V0dGxlZCgpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBjbGllbnRcbiAgICAgICAgLnJlY29ubmVjdCgpXG4gICAgICAgIC50aGVuKFxuICAgICAgICAgICgpID0+IHtcbiAgICAgICAgICAgIHRoaXMuc3VwZXJ2aXNvci5zZXR0bGVkKCk7XG4gICAgICAgICAgfSxcbiAgICAgICAgICAoZXJyb3I6IHVua25vd24pID0+IHtcbiAgICAgICAgICAgIHRoaXMuc3VwZXJ2aXNvci5zZXR0bGVkKCk7XG4gICAgICAgICAgICB0aGlzLmhhbmRsZVN5bmNFcnJvcihlcnJvciwgJ3JlY29ubmVjdCBmYWlsZWQnKTtcbiAgICAgICAgICB9LFxuICAgICAgICApXG4gICAgICAgIC5jYXRjaCgoKSA9PiB7fSk7IC8vIGhhbmRsZVN5bmNFcnJvciBuZXZlciB0aHJvd3M7IGJlbHQgYW5kIGJyYWNlc1xuICAgIH0sIGRlbGF5TXMpO1xuICB9XG5cbiAgLyoqIERpc3Rpbmd1aXNoIGZhdGFsIGF1dGggZmFpbHVyZXMgZnJvbSB0cmFuc2llbnQgbmV0d29yayB0cm91YmxlLiAqL1xuICBwcml2YXRlIGhhbmRsZVN5bmNFcnJvcihlcnJvcjogdW5rbm93biwgY29udGV4dDogc3RyaW5nKTogdm9pZCB7XG4gICAgaWYgKGVycm9yIGluc3RhbmNlb2YgUmV2b2tlZEVycm9yIHx8IGVycm9yIGluc3RhbmNlb2YgVW5hdXRob3JpemVkRXJyb3IpIHtcbiAgICAgIHRoaXMuYXV0aEZhaWxlZCA9IHRydWU7XG4gICAgICB0aGlzLnN0YXR1c05vdGUgPSAnRGV2aWNlIHRva2VuIHJlamVjdGVkIFx1MjAxNCB1bmxpbmsgYW5kIHJlLXBhaXIgd2l0aCBhIGZyZXNoIGNvZGUuJztcbiAgICAgIHRoaXMuc3luY0xvZy5lcnJvcihjb250ZXh0LCBlcnJvcik7XG4gICAgICBuZXcgTm90aWNlKFxuICAgICAgICAnVmF1bHRTeW5jOiB0aGUgd29ya2VyIHJlamVjdGVkIHRoaXMgZGV2aWNlXFx1MjAxOXMgdG9rZW4gKHJldm9rZWQ/KS4gVW5saW5rIGFuZCByZS1wYWlyIGZyb20gc2V0dGluZ3MuJyxcbiAgICAgICAgMTAwMDAsXG4gICAgICApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLnN5bmNMb2cud2Fybihjb250ZXh0LCBlcnJvcik7IC8vIG9mZmxpbmUvcHJvdG9jb2w6IGJhY2tvZmYga2VlcHMgcmV0cnlpbmdcbiAgfVxuXG4gIC8qKiBGUi00NDogd2FybiB3aGVuIHRoZSB2YXVsdCdzIHN0YXRlIGRpciBiZWxvbmdzIHRvIGFub3RoZXIgY2xpZW50LiAqL1xuICBwcml2YXRlIGFzeW5jIHdhcm5JZkZvcmVpZ25TdGF0ZURpcihzdG9yYWdlOiBPYnNpZGlhblN0b3JhZ2VBZGFwdGVyKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgbGV0IG1hcmtlcjogeyBkZXZpY2VJZD86IHVua25vd247IGRldmljZU5hbWU/OiB1bmtub3duOyB1cmw/OiB1bmtub3duIH07XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGJ5dGVzID0gYXdhaXQgc3RvcmFnZS5yZWFkRmlsZShERVZJQ0VfTUFSS0VSX1ZBVUxUX1BBVEgpO1xuICAgICAgbWFya2VyID0gSlNPTi5wYXJzZShuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUoYnl0ZXMpKSBhcyB0eXBlb2YgbWFya2VyO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuOyAvLyBubyBtYXJrZXIgKG9yIHVucmVhZGFibGUpIFx1MjAxNCBub3RoaW5nIHRvIHdhcm4gYWJvdXRcbiAgICB9XG4gICAgaWYgKFxuICAgICAgdHlwZW9mIG1hcmtlci5kZXZpY2VJZCA9PT0gJ3N0cmluZycgJiZcbiAgICAgIG1hcmtlci5kZXZpY2VJZCAhPT0gdGhpcy5kYXRhLmRldmljZUlkXG4gICAgKSB7XG4gICAgICBjb25zdCBuYW1lID0gdHlwZW9mIG1hcmtlci5kZXZpY2VOYW1lID09PSAnc3RyaW5nJyA/IG1hcmtlci5kZXZpY2VOYW1lIDogbWFya2VyLmRldmljZUlkO1xuICAgICAgY29uc3Qgd2hlcmUgPSB0eXBlb2YgbWFya2VyLnVybCA9PT0gJ3N0cmluZycgPyBtYXJrZXIudXJsIDogJ2Egd29ya2VyJztcbiAgICAgIG5ldyBOb3RpY2UoXG4gICAgICAgIGBWYXVsdFN5bmM6IHRoaXMgdmF1bHQgYWxyZWFkeSBoYXMgc3luYyBzdGF0ZSBmb3IgZGV2aWNlIFwiJHtuYW1lfVwiIChsaW5rZWQgdG8gJHt3aGVyZX0pLiBgICtcbiAgICAgICAgICAnT25lIHN5bmMgY2xpZW50IHBlciBtYWNoaW5lIHBlciB2YXVsdCBcdTIwMTQgcnVubmluZyB0d28gZG91YmxlLWNvbW1pdHMgZXZlcnkgY2hhbmdlLiAnICtcbiAgICAgICAgICAnVW5saW5rIHRoZSBvdGhlciBjbGllbnQgKG9yIGNsZWFyIC52YXVsdHN5bmNmb3JhZ2VudHMvKSBpZiB0aGlzIGlzIHVuZXhwZWN0ZWQuJyxcbiAgICAgICAgMTUwMDAsXG4gICAgICApO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBub3JtYWxpemVXb3JrZXJVcmxTYWZlKGlucHV0OiBzdHJpbmcpOiBzdHJpbmcge1xuICB0cnkge1xuICAgIHJldHVybiBub3JtYWxpemVXb3JrZXJVcmwoaW5wdXQpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gaW5wdXQ7XG4gIH1cbn1cbiIsICIvKipcbiAqIFZhdWx0IHBhdGggdXRpbGl0aWVzLlxuICpcbiAqIFZhdWx0LWludGVybmFsIHBhdGhzIGFyZSBQT1NJWC1ub3JtYWxpemVkIHN0cmluZ3MgcmVsYXRpdmUgdG8gdGhlIHZhdWx0IHJvb3Q6XG4gKiAgIC0gYWx3YXlzIHN0YXJ0IHdpdGggYC9gIChgL2EvYi5tZGApOyB0aGUgdmF1bHQgcm9vdCBpdHNlbGYgaXMgYC9gXG4gKiAgIC0gc2VnbWVudHMgc2VwYXJhdGVkIGJ5IGAvYDsgbm8gdHJhaWxpbmcgc2xhc2gsIG5vIGAuYC9gLi5gIHNlZ21lbnRzLFxuICogICAgIG5vIGR1cGxpY2F0ZSBzbGFzaGVzXG4gKiAgIC0gbmV2ZXIgZXNjYXBlIHRoZSByb290OiBhbnkgYC4uYCB0aGF0IHdvdWxkIHBvcCBhYm92ZSBgL2AgaXMgcmVqZWN0ZWRcbiAqXG4gKiBCYWNrc2xhc2hlcyBhcmUgY29udmVydGVkIHRvIGAvYCAoV2luZG93cyBjYWxsZXJzIHJvdXRpbmVseSBoYW5kIHVzXG4gKiBgZGlyXFxmaWxlLm1kYCksIGJ1dCBhYnNvbHV0ZSBXaW5kb3dzIHBhdGhzIChkcml2ZSBsZXR0ZXJzIGxpa2UgYEM6L2AsIFVOQ1xuICogYFxcXFxzZXJ2ZXJcXHNoYXJlYCkgYXJlIHJlamVjdGVkIFx1MjAxNCBhIHZhdWx0IHBhdGggaXMgbmV2ZXIgYWJzb2x1dGUgaW4gdGhlIGhvc3RcbiAqIGZpbGVzeXN0ZW0gc2Vuc2UuXG4gKi9cblxuLyoqIEEgdmF1bHQtaW50ZXJuYWwsIFBPU0lYLW5vcm1hbGl6ZWQgcGF0aCBzdHJpbmcgKGUuZy4gYC9ub3Rlcy90b2RvLm1kYCkuICovXG5leHBvcnQgdHlwZSBWYXVsdFBhdGggPSBzdHJpbmc7XG5cbi8qKiBUaHJvd24gd2hlbiBhIHBhdGggY2Fubm90IGJlIGludGVycHJldGVkIGFzIGEgdmF1bHQtaW50ZXJuYWwgcGF0aC4gKi9cbmV4cG9ydCBjbGFzcyBJbnZhbGlkVmF1bHRQYXRoRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIGNvbnN0cnVjdG9yKG1lc3NhZ2U6IHN0cmluZykge1xuICAgIHN1cGVyKG1lc3NhZ2UpO1xuICAgIHRoaXMubmFtZSA9ICdJbnZhbGlkVmF1bHRQYXRoRXJyb3InO1xuICB9XG59XG5cbi8qKlxuICogTm9ybWFsaXplIGEgdXNlci0gb3IgcGxhdGZvcm0tc3VwcGxpZWQgcGF0aCBpbnRvIGNhbm9uaWNhbCB2YXVsdCBmb3JtLlxuICpcbiAqIEFjY2VwdGVkOiBgYS9iLm1kYCAocm9vdC1yZWxhdGl2ZSB3aXRob3V0IGxlYWRpbmcgc2xhc2gpLCBgL2EvYi5tZGAsXG4gKiBgYVxcYi5tZGAgKGJhY2tzbGFzaCBjb252ZXJzaW9uKSwgYGEvLi9iLm1kYCwgYGEvYi8uLi9jLm1kYCAoaW50ZXJpb3IgYC4uYFxuICogcmVzb2x2ZXMpLCBkdXBsaWNhdGUgc2xhc2hlcywgdHJhaWxpbmcgc2xhc2hlcy5cbiAqXG4gKiBSZWplY3RlZDogYC4uYCBlc2NhcGluZyB0aGUgcm9vdCAoYC8uLi9hYCwgYC9hLy4uLy4uYCksIGFic29sdXRlIFdpbmRvd3NcbiAqIGRyaXZlIHBhdGhzIChgQzovdmF1bHQvYS5tZGAsIGBDOlxcdmF1bHRcXGEubWRgKSwgVU5DIHBhdGhzIChgXFxcXHNydlxcc2hhcmVgKSxcbiAqIGxlYWRpbmcgYC8vYCwgTlVMIGJ5dGVzLCBhbmQgV2luZG93cy11bnNhZmUgc2VnbWVudHMgXHUyMDE0IHJlc2VydmVkIGRldmljZVxuICogbmFtZXMgKGBDT05gLCBgUFJOYCwgYEFVWGAsIGBOVUxgLCBgQ09NMWBcdTIwMTNgQ09NOWAsIGBMUFQxYFx1MjAxM2BMUFQ5YCwgYW55XG4gKiBleHRlbnNpb24sIGFueSBjYXNlKSBhbmQgc2VnbWVudHMgZW5kaW5nIGluIGAuYCBvciBgIGAuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVWYXVsdFBhdGgoaW5wdXQ6IHN0cmluZyk6IFZhdWx0UGF0aCB7XG4gIGlmICh0eXBlb2YgaW5wdXQgIT09ICdzdHJpbmcnKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRWYXVsdFBhdGhFcnJvcihgVmF1bHQgcGF0aCBtdXN0IGJlIGEgc3RyaW5nLCBnb3QgJHt0eXBlb2YgaW5wdXR9YCk7XG4gIH1cbiAgaWYgKGlucHV0LmluY2x1ZGVzKCdcXDAnKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkVmF1bHRQYXRoRXJyb3IoYFZhdWx0IHBhdGggY29udGFpbnMgTlVMIGJ5dGU6ICR7SlNPTi5zdHJpbmdpZnkoaW5wdXQpfWApO1xuICB9XG4gIGlmICgvXlthLXpBLVpdOi8udGVzdChpbnB1dCkpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZFZhdWx0UGF0aEVycm9yKFxuICAgICAgYFZhdWx0IHBhdGggbXVzdCBub3QgYmUgYW4gYWJzb2x1dGUgaG9zdCBwYXRoIChkcml2ZSBsZXR0ZXIpOiAke0pTT04uc3RyaW5naWZ5KGlucHV0KX1gLFxuICAgICk7XG4gIH1cbiAgaWYgKGlucHV0LnN0YXJ0c1dpdGgoJ1xcXFxcXFxcJykpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZFZhdWx0UGF0aEVycm9yKFxuICAgICAgYFZhdWx0IHBhdGggbXVzdCBub3QgYmUgYSBVTkMgcGF0aDogJHtKU09OLnN0cmluZ2lmeShpbnB1dCl9YCxcbiAgICApO1xuICB9XG5cbiAgY29uc3QgY29udmVydGVkID0gaW5wdXQucmVwbGFjZSgvXFxcXC9nLCAnLycpO1xuICBpZiAoY29udmVydGVkLnN0YXJ0c1dpdGgoJy8vJykpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZFZhdWx0UGF0aEVycm9yKFxuICAgICAgYFZhdWx0IHBhdGggbXVzdCBub3Qgc3RhcnQgd2l0aCBcIi8vXCIgKFVOQyBvciBwcm90b2NvbC1zdHlsZSBwYXRoKTogJHtKU09OLnN0cmluZ2lmeShpbnB1dCl9YCxcbiAgICApO1xuICB9XG5cbiAgY29uc3Qgc2VnbWVudHM6IHN0cmluZ1tdID0gW107XG4gIGZvciAoY29uc3Qgc2VnbWVudCBvZiBjb252ZXJ0ZWQuc3BsaXQoJy8nKSkge1xuICAgIGlmIChzZWdtZW50ID09PSAnJyB8fCBzZWdtZW50ID09PSAnLicpIGNvbnRpbnVlO1xuICAgIGlmIChzZWdtZW50ID09PSAnLi4nKSB7XG4gICAgICBpZiAoc2VnbWVudHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIHRocm93IG5ldyBJbnZhbGlkVmF1bHRQYXRoRXJyb3IoXG4gICAgICAgICAgYFZhdWx0IHBhdGggZXNjYXBlcyB0aGUgdmF1bHQgcm9vdDogJHtKU09OLnN0cmluZ2lmeShpbnB1dCl9YCxcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIHNlZ21lbnRzLnBvcCgpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChpc1dpbmRvd3NVbnNhZmVTZWdtZW50KHNlZ21lbnQpKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZFZhdWx0UGF0aEVycm9yKFxuICAgICAgICBgVmF1bHQgcGF0aCBzZWdtZW50IGlzIGEgV2luZG93cy1yZXNlcnZlZCBkZXZpY2UgbmFtZSBvciBlbmRzIHdpdGggYSBkb3Qvc3BhY2U6ICR7SlNPTi5zdHJpbmdpZnkoc2VnbWVudCl9YCxcbiAgICAgICk7XG4gICAgfVxuICAgIHNlZ21lbnRzLnB1c2goc2VnbWVudCk7XG4gIH1cbiAgcmV0dXJuIHNlZ21lbnRzLmxlbmd0aCA9PT0gMCA/ICcvJyA6IGAvJHtzZWdtZW50cy5qb2luKCcvJyl9YDtcbn1cblxuLyoqXG4gKiBKb2luIGEgYmFzZSB2YXVsdCBwYXRoIHdpdGggb25lIG9yIG1vcmUgcmVsYXRpdmUgcGF0aCBwYXJ0cy5cbiAqXG4gKiBFYWNoIHBhcnQgbXVzdCBiZSByZWxhdGl2ZSAobm8gbGVhZGluZyBgL2AgYWZ0ZXIgYmFja3NsYXNoIGNvbnZlcnNpb24pIGFuZFxuICogaXMgYXBwZW5kZWQgdG8gdGhlIGJhc2UgYmVmb3JlIG5vcm1hbGl6YXRpb247IGAuLmAgaW5zaWRlIHBhcnRzIG1heSBub3RcbiAqIGVzY2FwZSB0aGUgcmVzdWx0aW5nIHJvb3QuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBqb2luUGF0aChiYXNlOiBzdHJpbmcsIC4uLnBhcnRzOiByZWFkb25seSBzdHJpbmdbXSk6IFZhdWx0UGF0aCB7XG4gIGxldCBjb21iaW5lZCA9IG5vcm1hbGl6ZVZhdWx0UGF0aChiYXNlKTtcbiAgZm9yIChjb25zdCBwYXJ0IG9mIHBhcnRzKSB7XG4gICAgY29uc3QgY29udmVydGVkID0gcGFydC5yZXBsYWNlKC9cXFxcL2csICcvJyk7XG4gICAgaWYgKGNvbnZlcnRlZC5zdGFydHNXaXRoKCcvJykpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkVmF1bHRQYXRoRXJyb3IoXG4gICAgICAgIGBqb2luUGF0aCBwYXJ0cyBtdXN0IGJlIHJlbGF0aXZlLCBnb3QgJHtKU09OLnN0cmluZ2lmeShwYXJ0KX1gLFxuICAgICAgKTtcbiAgICB9XG4gICAgY29tYmluZWQgPSBgJHtjb21iaW5lZCA9PT0gJy8nID8gJycgOiBjb21iaW5lZH0vJHtjb252ZXJ0ZWR9YDtcbiAgfVxuICByZXR1cm4gbm9ybWFsaXplVmF1bHRQYXRoKGNvbWJpbmVkKTtcbn1cblxuLyoqXG4gKiBQYXJlbnQgZGlyZWN0b3J5IG9mIGEgdmF1bHQgcGF0aC4gVGhlIHBhcmVudCBvZiBgL2AgaXMgYC9gICh0aGUgcm9vdCBoYXMgbm9cbiAqIHBhcmVudCBhYm92ZSBpdCk7IHdhbGsgYHdoaWxlIChwICE9PSBwYXJlbnRQYXRoKHApKWAgc3R5bGUgbG9vcHMgdGVybWluYXRlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyZW50UGF0aChwYXRoOiBzdHJpbmcpOiBWYXVsdFBhdGgge1xuICBjb25zdCBub3JtYWxpemVkID0gbm9ybWFsaXplVmF1bHRQYXRoKHBhdGgpO1xuICBpZiAobm9ybWFsaXplZCA9PT0gJy8nKSByZXR1cm4gJy8nO1xuICBjb25zdCBsYXN0U2xhc2ggPSBub3JtYWxpemVkLmxhc3RJbmRleE9mKCcvJyk7XG4gIHJldHVybiBsYXN0U2xhc2ggPT09IDAgPyAnLycgOiBub3JtYWxpemVkLnNsaWNlKDAsIGxhc3RTbGFzaCk7XG59XG5cbi8qKlxuICogRmluYWwgcGF0aCBzZWdtZW50LiBgYmFzZW5hbWUoJy9hL2IubWQnKWAgXHUyMTkyIGBiLm1kYDsgYGJhc2VuYW1lKCcvJylgIFx1MjE5MiBgJydgLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYmFzZW5hbWUocGF0aDogc3RyaW5nKTogVmF1bHRQYXRoIHtcbiAgY29uc3Qgbm9ybWFsaXplZCA9IG5vcm1hbGl6ZVZhdWx0UGF0aChwYXRoKTtcbiAgaWYgKG5vcm1hbGl6ZWQgPT09ICcvJykgcmV0dXJuICcnO1xuICByZXR1cm4gbm9ybWFsaXplZC5zbGljZShub3JtYWxpemVkLmxhc3RJbmRleE9mKCcvJykgKyAxKTtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIGBjaGlsZGAgbmFtZXMgc29tZXRoaW5nIGF0IGxlYXN0IG9uZSBsZXZlbCBCRUxPVyBgYW5jZXN0b3JgXG4gKiAoYm90aCBub3JtYWxpemVkIHZhdWx0IHBhdGhzKS4gVGhlIHJvb3QgaXMgYW4gYW5jZXN0b3Igb2YgZXZlcnl0aGluZ1xuICogZXhjZXB0IGl0c2VsZjsgYSBwYXRoIGlzIG5ldmVyIHN0cmljdGx5IGJlbmVhdGggaXRzZWxmLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNTdHJpY3RseUJlbmVhdGgoY2hpbGQ6IHN0cmluZywgYW5jZXN0b3I6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBpZiAoYW5jZXN0b3IgPT09ICcvJykgcmV0dXJuIGNoaWxkICE9PSAnLyc7XG4gIHJldHVybiBjaGlsZC5sZW5ndGggPiBhbmNlc3Rvci5sZW5ndGggJiYgY2hpbGQuc3RhcnRzV2l0aChgJHthbmNlc3Rvcn0vYCk7XG59XG5cbi8vIC0tLSBXaW5kb3dzLXVuc2FmZSBuYW1lcyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFJlc2VydmVkIERPUyBkZXZpY2UgYmFzZSBuYW1lcyAobWF0Y2hlZCBjYXNlLWluc2Vuc2l0aXZlbHksIGFueSBleHRlbnNpb24pLiAqL1xuY29uc3QgV0lORE9XU19SRVNFUlZFRF9CQVNFX05BTUVTOiBSZWFkb25seVNldDxzdHJpbmc+ID0gbmV3IFNldChbXG4gICdjb24nLFxuICAncHJuJyxcbiAgJ2F1eCcsXG4gICdudWwnLFxuICAnY29tMScsXG4gICdjb20yJyxcbiAgJ2NvbTMnLFxuICAnY29tNCcsXG4gICdjb201JyxcbiAgJ2NvbTYnLFxuICAnY29tNycsXG4gICdjb204JyxcbiAgJ2NvbTknLFxuICAnbHB0MScsXG4gICdscHQyJyxcbiAgJ2xwdDMnLFxuICAnbHB0NCcsXG4gICdscHQ1JyxcbiAgJ2xwdDYnLFxuICAnbHB0NycsXG4gICdscHQ4JyxcbiAgJ2xwdDknLFxuXSk7XG5cbi8qKlxuICogV2hldGhlciBvbmUgcGF0aCBzZWdtZW50IGNhbiBuZXZlciBiZSBtYXRlcmlhbGl6ZWQgb24gV2luZG93czogYSByZXNlcnZlZFxuICogZGV2aWNlIGJhc2UgbmFtZSBcdTIwMTQgdGhlIHNlZ21lbnQgdXAgdG8gaXRzIGZpcnN0IGRvdCwgY2FzZS1pbnNlbnNpdGl2ZSwgc29cbiAqIGBDT05gLCBgbnVsLnR4dGAgYW5kIGBDT00zLnRhci5nemAgYWxsIG1hdGNoIFx1MjAxNCBvciBhIHRyYWlsaW5nIGRvdC9zcGFjZSxcbiAqIHdoaWNoIFdpbmRvd3Mgc3RyaXBzIHdoZW4gY3JlYXRpbmcgdGhlIGZpbGUgKHRoZSBvbi1kaXNrIG5hbWUgd291bGRcbiAqIHNpbGVudGx5IGRpZmZlciBmcm9tIHRoZSBzeW5jZWQgb25lKS5cbiAqL1xuZnVuY3Rpb24gaXNXaW5kb3dzVW5zYWZlU2VnbWVudChzZWdtZW50OiBzdHJpbmcpOiBib29sZWFuIHtcbiAgLy8gYC5gL2AuLmAgYXJlIG5vcm1hbGl6YXRpb24gdG9rZW5zLCBuZXZlciByZWFsIHNlZ21lbnQgbmFtZXM7IHRoZXkgYXJlXG4gIC8vIHJlc29sdmVkIChvciByZWplY3RlZCkgYnkgYG5vcm1hbGl6ZVZhdWx0UGF0aGAgaXRzZWxmLlxuICBpZiAoc2VnbWVudCA9PT0gJy4nIHx8IHNlZ21lbnQgPT09ICcuLicpIHJldHVybiBmYWxzZTtcbiAgaWYgKHNlZ21lbnQuZW5kc1dpdGgoJy4nKSB8fCBzZWdtZW50LmVuZHNXaXRoKCcgJykpIHJldHVybiB0cnVlO1xuICBjb25zdCBkb3QgPSBzZWdtZW50LmluZGV4T2YoJy4nKTtcbiAgY29uc3QgYmFzZSA9IChkb3QgPT09IC0xID8gc2VnbWVudCA6IHNlZ21lbnQuc2xpY2UoMCwgZG90KSkudG9Mb3dlckNhc2UoKTtcbiAgcmV0dXJuIFdJTkRPV1NfUkVTRVJWRURfQkFTRV9OQU1FUy5oYXMoYmFzZSk7XG59XG5cbi8qKlxuICogV2hldGhlciBhbnkgc2VnbWVudCBvZiBhIHZhdWx0IHBhdGggaXMgV2luZG93cy11bnNhZmUgKHNlZVxuICogYGlzV2luZG93c1Vuc2FmZVNlZ21lbnRgKS4gU3VjaCBwYXRocyBhcmUgcmVqZWN0ZWQgYnkgYG5vcm1hbGl6ZVZhdWx0UGF0aGBcbiAqIGFuZCBtdXN0IG5ldmVyIGJlIHB1c2hlZCBvciBwdWxsZWQ6IGEgV2luZG93cyBjbGllbnQgY2Fubm90IG1hdGVyaWFsaXplXG4gKiB0aGVtLCBzbyBhdHRlbXB0aW5nIHRoZSB3cml0ZSB3b3VsZCBmYWlsIGV2ZXJ5IHN5bmMgY3ljbGUuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1dpbmRvd3NVbnNhZmVQYXRoKHBhdGg6IHN0cmluZyk6IGJvb2xlYW4ge1xuICByZXR1cm4gcGF0aC5zcGxpdCgnLycpLnNvbWUoKHNlZ21lbnQpID0+IGlzV2luZG93c1Vuc2FmZVNlZ21lbnQoc2VnbWVudCkpO1xufVxuIiwgIi8qKlxuICogTG9naWNhbCBjbG9jayBvcGVyYXRpb25zIChBUkNISVRFQ1RVUkUubWQgXHUwMEE3NCkuXG4gKlxuICogQ2xvY2tzIGFyZSBwZXItZmlsZSBtb25vdG9uaWMgY291bnRlcnMgb3duZWQgYnkgdGhlIHN5bmMgYXV0aG9yaXR5ICh0aGVcbiAqIER1cmFibGUgT2JqZWN0KS4gQSBjbG9jayBwYWlycyB0aGUgY291bnRlciB3aXRoIHRoZSBpZCBvZiB0aGUgZGV2aWNlIHRoYXRcbiAqIHByb2R1Y2VkIGl0LiBPcmRlcmluZyBpcyBmdWxseSBkZXRlcm1pbmlzdGljIG9uIGV2ZXJ5IGNsaWVudDpcbiAqXG4gKiAgIDEuIGhpZ2hlciBgY291bnRlcmAgd2lucztcbiAqICAgMi4gZXhhY3QgY291bnRlciB0aWUgXHUyMTkyIGxleGljb2dyYXBoaWNhbGx5IGdyZWF0ZXIgYGRldmljZUlkYCB3aW5zXG4gKiAgICAgIChwbGFpbiBKUyBzdHJpbmcgY29tcGFyaXNvbiwgaS5lLiBieSBVVEYtMTYgY29kZSB1bml0cyk7XG4gKiAgIDMuIGlkZW50aWNhbCBjb3VudGVyICphbmQqIGlkZW50aWNhbCBkZXZpY2VJZCBcdTIxOTIgdGhlIGNsb2NrcyBhcmUgZXF1YWwuXG4gKlxuICogV2FsbC1jbG9jayB0aW1lIG5ldmVyIHBhcnRpY2lwYXRlcyBpbiBvcmRlcmluZyAoZGlzcGxheS1vbmx5IHBlciBcdTAwQTc0KS5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IExvZ2ljYWxDbG9jayB9IGZyb20gJy4vdHlwZXMuanMnO1xuXG4vKiogUmVzdWx0IG9mIGBjb21wYXJlQ2xvY2tzYDogc2lnbiBvZiBgYWAgdnMgYGJgIChwb3NpdGl2ZSBcdTIxRDIgYGFgIHdpbnMpLiAqL1xuZXhwb3J0IHR5cGUgQ2xvY2tDb21wYXJpc29uID0gLTEgfCAwIHwgMTtcblxuLyoqXG4gKiBDb21wYXJlIHR3byBsb2dpY2FsIGNsb2Nrcy5cbiAqXG4gKiBSZXR1cm5zIGAxYCB3aGVuIGBhYCB3aW5zLCBgLTFgIHdoZW4gYGJgIHdpbnMsIGAwYCB3aGVuIHRoZSBjbG9ja3MgYXJlXG4gKiBpZGVudGljYWwgKHNhbWUgY291bnRlciAqYW5kKiBzYW1lIGRldmljZUlkIFx1MjAxNCBpbiBwcmFjdGljZSBvbmx5IHdoZW5cbiAqIGNvbXBhcmluZyBhIGNsb2NrIHdpdGggaXRzZWxmKS4gQ2FsbGVycyB0aGF0IG11c3QgcGljayBhIHNpZGUgb24gYDBgXG4gKiBzaG91bGQgZG8gc28gZXhwbGljaXRseSBhbmQgZG9jdW1lbnQgdGhlIGNob2ljZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvbXBhcmVDbG9ja3MoYTogTG9naWNhbENsb2NrLCBiOiBMb2dpY2FsQ2xvY2spOiBDbG9ja0NvbXBhcmlzb24ge1xuICBpZiAoYS5jb3VudGVyICE9PSBiLmNvdW50ZXIpIHJldHVybiBhLmNvdW50ZXIgPiBiLmNvdW50ZXIgPyAxIDogLTE7XG4gIGlmIChhLmRldmljZUlkICE9PSBiLmRldmljZUlkKSByZXR1cm4gYS5kZXZpY2VJZCA+IGIuZGV2aWNlSWQgPyAxIDogLTE7XG4gIHJldHVybiAwO1xufVxuXG4vKipcbiAqIFRoZSBjbG9jayBhIGNvbW1pdCBmcm9tIGBkZXZpY2VJZGAgd291bGQgcmVjZWl2ZSB3aGVuIGJ1aWxkaW5nIG9uIGBwYXJlbnRgXG4gKiAob3Igb24gbm90aGluZywgd2hlbiBgcGFyZW50YCBpcyBhYnNlbnQpOiBwYXJlbnQncyBjb3VudGVyICsgMS5cbiAqXG4gKiBUaGlzIGlzIHRoZSAqdGVudGF0aXZlKiBjbG9jayB1c2VkIGJ5IGNsaWVudC1zaWRlIGNvbmZsaWN0IHByZWRpY3Rpb25cbiAqIChgcmVzb2x2ZS50c2ApOiB0aGUgRE8gYXNzaWducyByZWFsIGNvdW50ZXJzIHdpdGggdGhlIHNhbWUgcnVsZSwgc28gdGhlXG4gKiBwcmVkaWN0aW9uIG1hdGNoZXMgdGhlIHNlcnZlcidzIGFyYml0cmF0aW9uIGFzIGxvbmcgYXMgYm90aCBzaWRlcyBidWlsZCBvblxuICogdGhlIHNhbWUgcGFyZW50LlxuICovXG5leHBvcnQgZnVuY3Rpb24gbmV4dENsb2NrKFxuICBwYXJlbnQ6IExvZ2ljYWxDbG9jayB8IG51bGwgfCB1bmRlZmluZWQsXG4gIGRldmljZUlkOiBzdHJpbmcsXG4pOiBMb2dpY2FsQ2xvY2sge1xuICByZXR1cm4geyBjb3VudGVyOiAocGFyZW50Py5jb3VudGVyID8/IDApICsgMSwgZGV2aWNlSWQgfTtcbn1cbiIsICIvKipcbiAqIENvbnRlbnQgaGFzaGluZyBhbmQgY29tcHJlc3Npb24gXHUyMDE0IFdlYiBBUElzIG9ubHkuXG4gKlxuICogYGNyeXB0by5zdWJ0bGVgIGlzIGF2YWlsYWJsZSBpbiBOb2RlIDE4KywgQ2xvdWRmbGFyZSBXb3JrZXJzLFxuICogYW5kIE9ic2lkaWFuIChFbGVjdHJvbikuIGBDb21wcmVzc2lvblN0cmVhbWAgbGlrZXdpc2UuIE5vIE5vZGUgaW1wb3J0czpcbiAqIHRoaXMgbW9kdWxlIG11c3QgcnVuIHVuY2hhbmdlZCBpbiBldmVyeSBjbGllbnQgKEFSQ0hJVEVDVFVSRS5tZCBcdTAwQTc4KS5cbiAqL1xuXG4vKiogSGFzaCBvZiBgYnl0ZXNgIGFzIGxvd2VyY2FzZSBzaGEyNTYgaGV4LiBNYXRjaGVzIFIyIGJsb2Iga2V5cyBgYmxvYnMve3NoYTI1Nn1gLiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHNoYTI1NkhleChieXRlczogVWludDhBcnJheSB8IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gIGNvbnN0IGRhdGEgPSB0eXBlb2YgYnl0ZXMgPT09ICdzdHJpbmcnID8gbmV3IFRleHRFbmNvZGVyKCkuZW5jb2RlKGJ5dGVzKSA6IGJ5dGVzO1xuICAvLyBgY3J5cHRvYCAobm90IGBnbG9iYWxUaGlzLmNyeXB0b2ApOiB0aGUgYmFyZSBpZGVudGlmaWVyIHJlc29sdmVzIGluIGV2ZXJ5XG4gIC8vIHRhcmdldCdzIHR5cGVzIChET00gbGliLCBDbG91ZGZsYXJlIHdvcmtlcmQgdHlwZXMsIE5vZGUpIFx1MjAxNCB0aGUgcXVhbGlmaWVkXG4gIC8vIGZvcm0gZG9lcyBub3QsIGJlY2F1c2Ugd29ya2VycyB0eXBlcyBkZWNsYXJlIGl0IGBjb25zdGAsIHdoaWNoIG5ldmVyXG4gIC8vIG1lcmdlcyBpbnRvIGB0eXBlb2YgZ2xvYmFsVGhpc2AuXG4gIGNvbnN0IGRpZ2VzdCA9IGF3YWl0IGNyeXB0by5zdWJ0bGUuZGlnZXN0KCdTSEEtMjU2JywgZGF0YSBhcyBCdWZmZXJTb3VyY2UpO1xuICByZXR1cm4gdG9IZXgobmV3IFVpbnQ4QXJyYXkoZGlnZXN0KSk7XG59XG5cbi8qKlxuICogV2hldGhlciBnemlwIHN0cmVhbXMgYXJlIGF2YWlsYWJsZSBpbiB0aGlzIHJ1bnRpbWUuIE9sZGVyIE9ic2lkaWFuIG1vYmlsZVxuICogd2Vidmlld3MgbWF5IGxhY2sgYENvbXByZXNzaW9uU3RyZWFtYDsgY2FsbGVycyBmYWxsIGJhY2sgdG8gaWRlbnRpdHkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdXBwb3J0c0NvbXByZXNzaW9uKCk6IGJvb2xlYW4ge1xuICByZXR1cm4gKFxuICAgIHR5cGVvZiBDb21wcmVzc2lvblN0cmVhbSAhPT0gJ3VuZGVmaW5lZCcgJiZcbiAgICB0eXBlb2YgRGVjb21wcmVzc2lvblN0cmVhbSAhPT0gJ3VuZGVmaW5lZCdcbiAgKTtcbn1cblxuLyoqXG4gKiBHemlwIGBkYXRhYC4gRmFsbHMgYmFjayB0byBpZGVudGl0eSAocmV0dXJucyBpbnB1dCB1bmNoYW5nZWQpIHdoZW5cbiAqIGBDb21wcmVzc2lvblN0cmVhbWAgaXMgdW5hdmFpbGFibGUgXHUyMDE0IGNhbGwgYHN1cHBvcnRzQ29tcHJlc3Npb24oKWAgZmlyc3QgaWZcbiAqIHlvdSBtdXN0IGtub3cgd2hpY2ggaGFwcGVuZWQuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjb21wcmVzcyhkYXRhOiBVaW50OEFycmF5KTogUHJvbWlzZTxVaW50OEFycmF5PiB7XG4gIGlmICghc3VwcG9ydHNDb21wcmVzc2lvbigpKSByZXR1cm4gZGF0YTtcbiAgLy8gYGFzIEJ1ZmZlclNvdXJjZWAgKG5vdCBgYXMgQmxvYlBhcnRgKTogdGhlIG5hbWUgYEJ1ZmZlclNvdXJjZWAgcmVzb2x2ZXMgaW5cbiAgLy8gYm90aCBET00gbGliIGFuZCB3b3JrZXJkIHJ1bnRpbWUgdHlwZXMsIGFuZCBpcyBhIHZhbGlkIEJsb2JQYXJ0IGluIGVhY2guXG4gIGNvbnN0IHN0cmVhbSA9IG5ldyBCbG9iKFtkYXRhIGFzIEJ1ZmZlclNvdXJjZV0pXG4gICAgLnN0cmVhbSgpXG4gICAgLnBpcGVUaHJvdWdoKG5ldyBDb21wcmVzc2lvblN0cmVhbSgnZ3ppcCcpKTtcbiAgcmV0dXJuIG5ldyBVaW50OEFycmF5KGF3YWl0IG5ldyBSZXNwb25zZShzdHJlYW0pLmFycmF5QnVmZmVyKCkpO1xufVxuXG4vKipcbiAqIEd1bnppcCBgZGF0YWAgcHJvZHVjZWQgYnkgYGNvbXByZXNzYCAoaW4gYSBydW50aW1lIHRoYXQgaGFkIGd6aXAgc3VwcG9ydCkuXG4gKiBGYWxscyBiYWNrIHRvIGlkZW50aXR5IHdoZW4gYERlY29tcHJlc3Npb25TdHJlYW1gIGlzIHVuYXZhaWxhYmxlLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZGVjb21wcmVzcyhkYXRhOiBVaW50OEFycmF5KTogUHJvbWlzZTxVaW50OEFycmF5PiB7XG4gIGlmICghc3VwcG9ydHNDb21wcmVzc2lvbigpKSByZXR1cm4gZGF0YTtcbiAgY29uc3Qgc3RyZWFtID0gbmV3IEJsb2IoW2RhdGEgYXMgQnVmZmVyU291cmNlXSlcbiAgICAuc3RyZWFtKClcbiAgICAucGlwZVRocm91Z2gobmV3IERlY29tcHJlc3Npb25TdHJlYW0oJ2d6aXAnKSk7XG4gIHJldHVybiBuZXcgVWludDhBcnJheShhd2FpdCBuZXcgUmVzcG9uc2Uoc3RyZWFtKS5hcnJheUJ1ZmZlcigpKTtcbn1cblxuZnVuY3Rpb24gdG9IZXgoYnl0ZXM6IFVpbnQ4QXJyYXkpOiBzdHJpbmcge1xuICBsZXQgb3V0ID0gJyc7XG4gIGZvciAoY29uc3QgYnl0ZSBvZiBieXRlcykge1xuICAgIG91dCArPSBieXRlLnRvU3RyaW5nKDE2KS5wYWRTdGFydCgyLCAnMCcpO1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG4iLCAiLyoqXG4gKiBUeXBlZCBlcnJvciBoaWVyYXJjaHkgc2hhcmVkIGJ5IGFsbCBjbGllbnRzIChwbHVnaW4sIGRhZW1vbiwgQ0xJKSBhbmQgdGhlXG4gKiB0ZXN0LXN1aXRlIHNlcnZlci4gRXJyb3JzIGNhcnJ5IGEgc3RhYmxlIG1hY2hpbmUtcmVhZGFibGUgYGNvZGVgLlxuICovXG5cbmV4cG9ydCB0eXBlIEVycm9yQ29kZSA9XG4gIHwgJ1VOQ0xBSU1FRCdcbiAgfCAnVU5BVVRIT1JJWkVEJ1xuICB8ICdSRVZPS0VEJ1xuICB8ICdDT05GTElDVCdcbiAgfCAnUFJPVE9DT0wnXG4gIHwgJ05FVFdPUksnO1xuXG4vKiogQmFzZSBjbGFzcyBmb3IgYWxsIFZhdWx0U3luYyBlcnJvcnMuICovXG5leHBvcnQgYWJzdHJhY3QgY2xhc3MgVmF1bHRTeW5jRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIGFic3RyYWN0IHJlYWRvbmx5IGNvZGU6IEVycm9yQ29kZTtcblxuICBjb25zdHJ1Y3RvcihtZXNzYWdlOiBzdHJpbmcsIG9wdGlvbnM/OiBFcnJvck9wdGlvbnMpIHtcbiAgICBzdXBlcihtZXNzYWdlLCBvcHRpb25zKTtcbiAgICB0aGlzLm5hbWUgPSBuZXcudGFyZ2V0Lm5hbWU7XG4gIH1cbn1cblxuLyoqIFdvcmtlciBleGlzdHMgYnV0IGhhcyBub3QgYmVlbiBjbGFpbWVkIHlldCAoSFRUUCA0MjEgb24gZXZlcnkgQVBJIGNhbGwpLiAqL1xuZXhwb3J0IGNsYXNzIFVuY2xhaW1lZEVycm9yIGV4dGVuZHMgVmF1bHRTeW5jRXJyb3Ige1xuICByZWFkb25seSBjb2RlID0gJ1VOQ0xBSU1FRCcgYXMgY29uc3Q7XG59XG5cbi8qKiBUb2tlbiBtaXNzaW5nLCBpbnZhbGlkLCBvciBub3QgYWNjZXB0ZWQgKEhUVFAgNDAxIGNsYXNzKS4gKi9cbmV4cG9ydCBjbGFzcyBVbmF1dGhvcml6ZWRFcnJvciBleHRlbmRzIFZhdWx0U3luY0Vycm9yIHtcbiAgcmVhZG9ubHkgY29kZSA9ICdVTkFVVEhPUklaRUQnIGFzIGNvbnN0O1xufVxuXG4vKiogVGhlIGRldmljZSB0b2tlbiB3YXMgcmV2b2tlZDsgdGhlIGRldmljZSBtdXN0IGJlIHJlLXBhaXJlZC4gKi9cbmV4cG9ydCBjbGFzcyBSZXZva2VkRXJyb3IgZXh0ZW5kcyBWYXVsdFN5bmNFcnJvciB7XG4gIHJlYWRvbmx5IGNvZGUgPSAnUkVWT0tFRCcgYXMgY29uc3Q7XG59XG5cbi8qKiBBIGNvbW1pdCByYWNlZCB3aXRoIGEgY29uY3VycmVudCBlZGl0OyB0aGUgc2VydmVyIGFyYml0cmF0ZWQgKHNlZSBcdTAwQTc0KS4gKi9cbmV4cG9ydCBjbGFzcyBDb25mbGljdEVycm9yIGV4dGVuZHMgVmF1bHRTeW5jRXJyb3Ige1xuICByZWFkb25seSBjb2RlID0gJ0NPTkZMSUNUJyBhcyBjb25zdDtcbn1cblxuLyoqIEEgcGVlciAob3IgbG9jYWwgYnVnKSB2aW9sYXRlZCB0aGUgcHJvdG9jb2w6IGJhZCBtZXNzYWdlIHNoYXBlLCBiYWQgdmVyc2lvbi4gKi9cbmV4cG9ydCBjbGFzcyBQcm90b2NvbEVycm9yIGV4dGVuZHMgVmF1bHRTeW5jRXJyb3Ige1xuICByZWFkb25seSBjb2RlID0gJ1BST1RPQ09MJyBhcyBjb25zdDtcbn1cblxuLyoqIFRyYW5zcG9ydC1sZXZlbCBmYWlsdXJlOiBzb2NrZXQgY2xvc2VkLCBmZXRjaCByZWZ1c2VkLCB0aW1lb3V0LiBSZXRyaWFibGUuICovXG5leHBvcnQgY2xhc3MgTmV0d29ya0Vycm9yIGV4dGVuZHMgVmF1bHRTeW5jRXJyb3Ige1xuICByZWFkb25seSBjb2RlID0gJ05FVFdPUksnIGFzIGNvbnN0O1xufVxuIiwgIi8qKlxuICogVGhlIGNsaWVudCdzIHBlcnNpc3RlZCBzeW5jIHN0YXRlIChBUkNISVRFQ1RVUkUubWQgXHUwMEE3OCBzdGVwIDEpLlxuICpcbiAqIEEgYExvY2FsSW5kZXhgIG1hcHMgZXZlcnkgdmF1bHQgcGF0aCB0aGlzIGNsaWVudCBoYXMgZXZlciBzeW5jZWQgdG8gdGhlXG4gKiBsYXN0IHZlcnNpb24gaXQgKmtub3dzKiB3YXMgYXV0aG9yaXRhdGl2ZTogY29udGVudCBoYXNoLCBzaXplLCB0aGVcbiAqIHNlcnZlci1hc3NpZ25lZCB2ZXJzaW9uIGlkLCBhbmQgdGhlIHZlcnNpb24ncyBsb2dpY2FsIGNsb2NrLiBFbnRyaWVzIHdpdGhcbiAqIGBkZWxldGVkQXRgIHNldCBhcmUgdG9tYnN0b25lcyBcdTIwMTQgdGhlIGZpbGUgd2FzIGRlbGV0ZWQgKGxvY2FsbHkgb3JcbiAqIHJlbW90ZWx5KSBidXQgdGhlIGVudHJ5IHN0YXlzIHNvIHRoZSBkZWxldGlvbiBpcyBub3QgcmVzdXJyZWN0ZWQgYnkgdGhlXG4gKiBuZXh0IHNjYW4gYW5kIHNvIHJlbmFtZSBjb3JyZWxhdGlvbiBrZWVwcyB3b3JraW5nLlxuICpcbiAqIFRoZSBpbmRleCBpcyBwZXJzaXN0ZWQgaW5zaWRlIHRoZSB2YXVsdCBhdCBgLy52YXVsdHN5bmNmb3JhZ2VudHMvc3RhdGVgXG4gKiAodGhhdCBkaXJlY3RvcnkgaXMgc3luYy1pZ25vcmVkLCBzZWUgYGlnbm9yZS50c2ApIHRocm91Z2ggdGhlIHN0b3JhZ2VcbiAqIGFkYXB0ZXIsIHdob3NlIGB3cml0ZUZpbGVgIGlzIGF0b21pYyAodGVtcCArIHJlbmFtZSkgYnkgY29udHJhY3QuXG4gKlxuICogQWxsIG9wZXJhdGlvbnMgYXJlIHB1cmU6IHRoZXkgcmV0dXJuIG5ldyBvYmplY3RzIGFuZCBuZXZlciBtdXRhdGUgaW5wdXRzLlxuICovXG5cbmltcG9ydCB0eXBlIHsgTG9naWNhbENsb2NrIH0gZnJvbSAnLi90eXBlcy5qcyc7XG5pbXBvcnQgeyBQcm90b2NvbEVycm9yIH0gZnJvbSAnLi9lcnJvcnMuanMnO1xuXG4vKipcbiAqIEN1cnJlbnQgb24tZGlzayBzY2hlbWEgdmVyc2lvbi4gQnVtcCArIGFkZCBtaWdyYXRpb24gb24gYnJlYWtpbmcgY2hhbmdlcy5cbiAqXG4gKiBIaXN0b3J5OlxuICogICAtIDEgXHUyMDE0IGluaXRpYWwgc2hhcGUgKGhhc2gvc2l6ZS92ZXJzaW9uSWQvY2xvY2svZGVsZXRlZEF0L2lzRm9sZGVyKS5cbiAqICAgLSAyIFx1MjAxNCBhZGRzIHRoZSBvcHRpb25hbCBgbXRpbWVgIGNhY2hlIGZpZWxkIHBlciBlbnRyeSAoc2NhbiBwcmUtZmlsdGVyLFxuICogICAgICAgICBzZWUgYHNjYW4udHNgKS4gR3JhY2VmdWwgbWlncmF0aW9uOiB2MSBlbnRyaWVzIHNpbXBseSBsYWNrIGBtdGltZWAsXG4gKiAgICAgICAgIHdoaWNoIHJlYWRzIGJhY2sgYXMgXCJ1bmtub3duXCIgXHUyMDE0IHRoZSBuZXh0IGZhc3Qgc2NhbiByZS1oYXNoZXMgdGhlXG4gKiAgICAgICAgIGZpbGUgYW5kIHJlY29yZHMgaXQuIE9sZCB2MSBzdGF0ZSBmaWxlcyBsb2FkIHdpdGhvdXQgZXJyb3IuXG4gKlxuICogVGhlIHYyIEVOVkVMT1BFIGFsc28gY2FycmllcyBvcHRpb25hbCBzeW5jLWN1cnNvciBib29ra2VlcGluZyAoYGN1cnNvcmAsXG4gKiBgc3luY2VkVGhyb3VnaGAsIGBuZWVkc0Z1bGxNYW5pZmVzdGAgXHUyMDE0IHNlZSBgUGVyc2lzdGVkU3luY1N0YXRlYCk7IGZpbGVzXG4gKiB3cml0dGVuIGJlZm9yZSBpdCBleGlzdGVkIHNpbXBseSBsYWNrIHRob3NlIGtleXMsIHdoaWNoIHJlYWQgYmFjayBhc1xuICogXCJubyBjdXJzb3Iga25vd2xlZGdlXCIgKGZ1bGwgbWFuaWZlc3Qgb24gdGhlIG5leHQgY29ubmVjdCkuIE5vIHZlcnNpb25cbiAqIGJ1bXA6IGJvdGggZGlyZWN0aW9ucyB0b2xlcmF0ZSB0aGUgbWlzc2luZyBmaWVsZHMuXG4gKi9cbmV4cG9ydCBjb25zdCBMT0NBTF9JTkRFWF9TQ0hFTUFfVkVSU0lPTiA9IDI7XG5cbi8qKiBPbGRlc3Qgb24tZGlzayBzY2hlbWEgdmVyc2lvbiB0aGlzIGJ1aWxkIGNhbiBzdGlsbCByZWFkLiAqL1xuZXhwb3J0IGNvbnN0IE1JTl9MT0NBTF9JTkRFWF9TQ0hFTUFfVkVSU0lPTiA9IDE7XG5cbi8qKiBWYXVsdCBwYXRoIHdoZXJlIHRoZSBjbGllbnQgcGVyc2lzdHMgaXRzIGxvY2FsIGluZGV4LiAqL1xuZXhwb3J0IGNvbnN0IExPQ0FMX0lOREVYX1NUQVRFX1BBVEggPSAnLy52YXVsdHN5bmNmb3JhZ2VudHMvc3RhdGUnO1xuXG4vKiogT25lIHBhdGgncyBsYXN0LWtub3duLXN5bmNlZCBzdGF0ZS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgTG9jYWxJbmRleEVudHJ5IHtcbiAgLyoqIHNoYTI1NiBoZXggb2YgdGhlIGNvbnRlbnQgYXQgYHZlcnNpb25JZGAuICovXG4gIGhhc2g6IHN0cmluZztcbiAgLyoqIENvbnRlbnQgc2l6ZSBpbiBieXRlcyAoYDBgIGZvciBmb2xkZXIgcGxhY2Vob2xkZXJzKS4gKi9cbiAgc2l6ZTogbnVtYmVyO1xuICAvKiogU2VydmVyLWFzc2lnbmVkIHZlcnNpb24gaWQgdGhpcyBlbnRyeSByZWZsZWN0cy4gKi9cbiAgdmVyc2lvbklkOiBzdHJpbmc7XG4gIC8qKiBMb2dpY2FsIGNsb2NrIG9mIGB2ZXJzaW9uSWRgIFx1MjAxNCB1c2VkIHRvIHByZWRpY3QgY29uZmxpY3Qgb3V0Y29tZXMuICovXG4gIGNsb2NrOiBMb2dpY2FsQ2xvY2s7XG4gIC8qKiBQcmVzZW50IFx1MjFEMiB0b21ic3RvbmU6IHRoZSBwYXRoIHdhcyBkZWxldGVkIGF0IHRoaXMgZXBvY2ggbXMuICovXG4gIGRlbGV0ZWRBdD86IG51bWJlcjtcbiAgLyoqXG4gICAqIFRydWUgZm9yIGVtcHR5LWZvbGRlciBwbGFjZWhvbGRlciBlbnRyaWVzIChGUi0xMCkuIEZvbGRlciBlbnRyaWVzIGNhcnJ5XG4gICAqIGBoYXNoOiAnJ2AsIGBzaXplOiAwYDsgdGhlIGNsb2NrIGlzIHRoYXQgb2YgdGhlIHBsYWNlaG9sZGVyJ3MgdmVyc2lvbi5cbiAgICovXG4gIGlzRm9sZGVyPzogYm9vbGVhbjtcbiAgLyoqXG4gICAqIFN0b3JhZ2UgbXRpbWUgKGVwb2NoIG1zKSBvYnNlcnZlZCB0aGUgbGFzdCB0aW1lIHRoaXMgZW50cnkncyBmaWxlIHdhc1xuICAgKiBoYXNoZWQgYnkgYSBzY2FuLiBBIHB1cmUgY2FjaGUgZm9yIHRoZSBzY2FuIHByZS1maWx0ZXIgKGBzY2FuLnRzYCk6XG4gICAqIG51bGxpc2ggKGFic2VudCwgZS5nLiBsZWdhY3kgdjEgc3RhdGUgb3IgZW50cmllcyB3cml0dGVuIGJ5IHB1bGxzKVxuICAgKiBtZWFucyBcInVua25vd25cIiBcdTIwMTQgdGhlIG5leHQgZmFzdCBzY2FuIGhhc2hlcyB0aGUgZmlsZSBhbmQgcmVjb3JkcyBpdCB2aWFcbiAgICogYHJlY29yZEhhc2hlZEZpbGVzYC4gTmV2ZXIgY29uc3VsdGVkIGZvciBzeW5jIGRlY2lzaW9ucy5cbiAgICovXG4gIG10aW1lPzogbnVtYmVyO1xufVxuXG4vKiogVGhlIHdob2xlIGluZGV4OiBub3JtYWxpemVkIHZhdWx0IHBhdGggXHUyMTkyIGVudHJ5LiBge31gIGlzIGEgdmFsaWQgZW1wdHkgaW5kZXguICovXG5leHBvcnQgdHlwZSBMb2NhbEluZGV4ID0gUmVhZG9ubHk8UmVjb3JkPHN0cmluZywgTG9jYWxJbmRleEVudHJ5Pj47XG5cbi8qKiBWZXJzaW9uZWQgc2VyaWFsaXphdGlvbiBlbnZlbG9wZSAoc2NoZW1hVmVyc2lvbiBlbmFibGVzIGZ1dHVyZSBtaWdyYXRpb24pLiAqL1xuZXhwb3J0IGludGVyZmFjZSBMb2NhbEluZGV4RW52ZWxvcGUge1xuICBzY2hlbWFWZXJzaW9uOiBudW1iZXI7XG4gIGVudHJpZXM6IFJlY29yZDxzdHJpbmcsIExvY2FsSW5kZXhFbnRyeT47XG4gIC8qKlxuICAgKiBFbnZlbG9wZS1sZXZlbCBzeW5jIGJvb2trZWVwaW5nIChvcHRpb25hbCBzbyB2MiBmaWxlcyB3cml0dGVuIGJlZm9yZSBpdFxuICAgKiBleGlzdGVkIHN0aWxsIGxvYWQ7IHVua25vd24gZmllbGRzIGFyZSB0b2xlcmF0ZWQgaW4gYm90aCBkaXJlY3Rpb25zKS5cbiAgICogU2VlIGBQZXJzaXN0ZWRTeW5jU3RhdGVgLlxuICAgKi9cbiAgY3Vyc29yPzogbnVtYmVyO1xuICBzeW5jZWRUaHJvdWdoPzogbnVtYmVyIHwgbnVsbDtcbiAgbmVlZHNGdWxsTWFuaWZlc3Q/OiBib29sZWFuO1xufVxuXG4vKipcbiAqIFN5bmMtY3Vyc29yIGJvb2trZWVwaW5nIHBlcnNpc3RlZCBhdG9taWNhbGx5IFdJVEggdGhlIGVudHJpZXMgKG9uZSBmaWxlLFxuICogb25lIHdyaXRlKSBzbyB0aGUgdHdvIGNhbiBuZXZlciBkaXNhZ3JlZSBhZnRlciBhIGNyYXNoLiBSZXN0b3JlZCBvblxuICogc3RhcnR1cCB0byBwb3dlciBkZWx0YS1tYW5pZmVzdCByZWNvbm5lY3RzLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFBlcnNpc3RlZFN5bmNTdGF0ZSB7XG4gIC8qKiBMYXN0IHNlZW4gc2VydmVyIHNlcXVlbmNlIG51bWJlciAoc2VudCBhcyBgaGVsbG8uY3Vyc29yYCkuICovXG4gIGN1cnNvcj86IG51bWJlcjtcbiAgLyoqXG4gICAqIFNlcXVlbmNlIHRocm91Z2ggd2hpY2ggdGhlIGluZGV4IGlzIGtub3duIENPTVBMRVRFOiB0aGUgbWFuaWZlc3QgY3Vyc29yXG4gICAqIG9mIHRoZSBsYXN0IHN5bmMgY3ljbGUgdGhhdCBmaW5pc2hlZCBzdWNjZXNzZnVsbHkuIEV2ZXJ5IGhlYWQgYXQgb3JcbiAgICogYmVsb3cgaXQgaXMgcmVmbGVjdGVkIGluIHRoZSBlbnRyaWVzIGFib3ZlLCBzbyBhIGxhdGVyIHJlY29ubmVjdCBvbmx5XG4gICAqIG5lZWRzIGhlYWRzIHdpdGggYGhlYWRfc2VxID4gc3luY2VkVGhyb3VnaGAgXHUyMDE0IHRoZSBkZWx0YS1tYW5pZmVzdCB3aW5kb3cuXG4gICAqIGBudWxsYC9hYnNlbnQgXHUyMUQyIG5vIGNvbXBsZXRlZCBjeWNsZSB5ZXQgKG9yIGFuIGludGVycnVwdGVkIG9uZSk6IHRoZSBuZXh0XG4gICAqIG1hbmlmZXN0IG11c3QgYmUgRlVMTC4gRGVsaWJlcmF0ZWx5IE5PVCBhZHZhbmNlZCB0byBjb21taXQtYWNrIHNlcXMgc2VlblxuICAgKiBtaWQtY3ljbGU6IGEgY2hhbmdlIGJyb2FkY2FzdCBmcm9tIGFub3RoZXIgZGV2aWNlIGNhbiBpbnRlcmxlYXZlIHdpdGhcbiAgICogb3VyIGFja3MgYW5kIGxhbmQgaW4gdGhlIHBvc3QtY3ljbGUgZGlzcGF0Y2ggcXVldWUsIHNvIG9ubHkgdGhlXG4gICAqIGZldGNoLXRpbWUgbWFuaWZlc3QgY3Vyc29yIGlzIGEgY29tcGxldGlvbiBndWFyYW50ZWUuXG4gICAqL1xuICBzeW5jZWRUaHJvdWdoPzogbnVtYmVyIHwgbnVsbDtcbiAgLyoqXG4gICAqIEEgcmVtb3RlIGNoYW5nZSB3YXMgZGVmZXJyZWQgb3ZlciBsb2NhbGx5LWRpdmVyZ2VkIGNvbnRlbnQgKGBoYW5kbGVDaGFuZ2VgXG4gICAqIGd1YXJkKSBhbmQgaGFzIG5vdCBiZWVuIHRocm91Z2ggYSBwbGFuIGN5Y2xlIHlldC4gVGhlIG5leHQgbWFuaWZlc3QgbXVzdFxuICAgKiBiZSBGVUxMIHNvIGBjb21wdXRlU3luY1BsYW5gIHNlZXMgdGhlIHJlbW90ZSBoZWFkIGFuZCByZXNvbHZlcyB0aGVcbiAgICogZGl2ZXJnZW5jZSB0aHJvdWdoIGl0cyBjb25mbGljdCBsb2dpYyBpbnN0ZWFkIG9mIGEgc3RhbGUtcGFyZW50IHB1c2guXG4gICAqL1xuICBuZWVkc0Z1bGxNYW5pZmVzdD86IGJvb2xlYW47XG59XG5cbi8qKiBPbmUgYXV0aG9yaXRhdGl2ZSBzdGF0ZSBjaGFuZ2UgdG8gZm9sZCBpbnRvIHRoZSBpbmRleC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgTG9jYWxJbmRleENvbW1pdCB7XG4gIHBhdGg6IHN0cmluZztcbiAgdmVyc2lvbklkOiBzdHJpbmc7XG4gIGhhc2g6IHN0cmluZztcbiAgc2l6ZTogbnVtYmVyO1xuICBjbG9jazogTG9naWNhbENsb2NrO1xuICAvKiogUHJlc2VudCBcdTIxRDIgdG9tYnN0b25lOiB0aGUgcGF0aCB3YXMgZGVsZXRlZCBhdCB0aGlzIGVwb2NoIG1zLiAqL1xuICBkZWxldGVkPzogYm9vbGVhbjtcbiAgLyoqIEVwb2NoIG1zIG9mIHRoZSBkZWxldGlvbiBcdTIwMTQgcmVxdWlyZWQgd2hlbiBgZGVsZXRlZGAgaXMgdHJ1ZS4gKi9cbiAgZGVsZXRlZEF0PzogbnVtYmVyO1xuICAvKiogVHJ1ZSB3aGVuIHRoaXMgY29tbWl0IHJlY29yZHMgYW4gZW1wdHktZm9sZGVyIHBsYWNlaG9sZGVyIChGUi0xMCkuICovXG4gIGlzRm9sZGVyPzogYm9vbGVhbjtcbiAgLyoqXG4gICAqIFN0b3JhZ2UgbXRpbWUgb2JzZXJ2ZWQgYXQgSEFTSCB0aW1lIGZvciB0aGlzIGV4YWN0IGNvbnRlbnQgXHUyMDE0IHBpbm5lZCBvbnRvXG4gICAqIHRoZSBlbnRyeSB3aGVuIHRoZSBjb21taXQgaXMgZm9sZGVkIChpLmUuIGF0IGNvbW1pdC1hY2sgdGltZSkuIFRocmVhZGluZ1xuICAgKiB0aGUgc3RhdCB0aGF0IGNvLW9jY3VycmVkIHdpdGggdGhlIGhhc2hlZCBieXRlcyAocmF0aGVyIHRoYW4gYW55XG4gICAqIGxhdGVyL2N1cnJlbnQgc3RhdCkgZ3VhcmFudGVlcyB0aGUgZmFzdC1wYXRoIGNhY2hlIGNhbiBuZXZlciBwYWlyIGFcbiAgICogZnJlc2hlciBzdGF0IHdpdGggdGhpcyBoYXNoLCB3aGljaCB3b3VsZCBoaWRlIGFuIGVkaXQgZnJvbSBldmVyeSBmdXR1cmVcbiAgICogc2NhbiAodGhlIHNpbGVudCBkcm9wcGVkLWVkaXQgY2xhc3MpLiBBYnNlbnQgXHUyMUQyIHVua25vd247IHRoZSBuZXh0IHNjYW5cbiAgICogcmUtaGFzaGVzIGFuZCByZWNvcmRzIHZpYSBgcmVjb3JkSGFzaGVkRmlsZXNgLlxuICAgKi9cbiAgbXRpbWU/OiBudW1iZXI7XG59XG5cbi8qKlxuICogRm9sZCBvbmUgY29tbWl0IGludG8gdGhlIGluZGV4LiBQdXJlOiByZXR1cm5zIGEgbmV3IGluZGV4LCBpbnB1dCB1bnRvdWNoZWQuXG4gKlxuICogQXBwbHlpbmcgYSBjb21taXQgZm9yIGEgcGF0aCByZXBsYWNlcyB0aGF0IHBhdGgncyBlbnRyeSB3aG9sZXNhbGUgKGEgY29tbWl0XG4gKiAqaXMqIHRoZSBuZXcgdHJ1dGggZm9yIHRoZSBwYXRoKTsgYGFwcGx5Q29tbWl0YCBuZXZlciBtZXJnZXMgZmllbGRzLlxuICogVG9tYnN0b25pbmcgKGBkZWxldGVkOiB0cnVlYCkgcmVxdWlyZXMgYGRlbGV0ZWRBdGAgYW5kIGtlZXBzIHRoZSBlbnRyeS5cbiAqXG4gKiBUbyBkcm9wIGFuIGVudHJ5IGVudGlyZWx5ICh0aGUgcGF0aCBtaWdyYXRlZCBhd2F5LCBlLmcuIGEgc3luY2VkIHJlbmFtZSlcbiAqIHVzZSBgcmVtb3ZlRW50cnlgIGluc3RlYWQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhcHBseUNvbW1pdChpbmRleDogTG9jYWxJbmRleCwgY29tbWl0OiBMb2NhbEluZGV4Q29tbWl0KTogTG9jYWxJbmRleCB7XG4gIGlmIChjb21taXQuZGVsZXRlZCAmJiBjb21taXQuZGVsZXRlZEF0ID09PSB1bmRlZmluZWQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBgYXBwbHlDb21taXQ6IHRvbWJzdG9uZSBmb3IgJHtKU09OLnN0cmluZ2lmeShjb21taXQucGF0aCl9IHJlcXVpcmVzIGRlbGV0ZWRBdGAsXG4gICAgKTtcbiAgfVxuICBjb25zdCBuZXh0OiBSZWNvcmQ8c3RyaW5nLCBMb2NhbEluZGV4RW50cnk+ID0geyAuLi5pbmRleCB9O1xuICBjb25zdCBlbnRyeTogTG9jYWxJbmRleEVudHJ5ID0ge1xuICAgIGhhc2g6IGNvbW1pdC5oYXNoLFxuICAgIHNpemU6IGNvbW1pdC5zaXplLFxuICAgIHZlcnNpb25JZDogY29tbWl0LnZlcnNpb25JZCxcbiAgICBjbG9jazogY29tbWl0LmNsb2NrLFxuICB9O1xuICBpZiAoY29tbWl0LmRlbGV0ZWQpIGVudHJ5LmRlbGV0ZWRBdCA9IGNvbW1pdC5kZWxldGVkQXQ7XG4gIGlmIChjb21taXQuaXNGb2xkZXIpIGVudHJ5LmlzRm9sZGVyID0gdHJ1ZTtcbiAgaWYgKGNvbW1pdC5tdGltZSAhPT0gdW5kZWZpbmVkKSBlbnRyeS5tdGltZSA9IGNvbW1pdC5tdGltZTtcbiAgbmV4dFtjb21taXQucGF0aF0gPSBlbnRyeTtcbiAgcmV0dXJuIG5leHQ7XG59XG5cbi8qKlxuICogUmVtb3ZlIGEgcGF0aCdzIGVudHJ5IGVudGlyZWx5IChubyB0b21ic3RvbmUpLiBVc2VkIHdoZW4gdGhlIGF1dGhvcml0eVxuICogbWlncmF0ZXMgYSBwYXRoJ3MgdmVyc2lvbiBjaGFpbiBlbHNld2hlcmUgXHUyMDE0IGkuZS4gYSBzeW5jZWQgcmVuYW1lOiB0aGUgb2xkXG4gKiBwYXRoIG11c3QgdmFuaXNoIGZyb20gdGhlIGluZGV4IGV4YWN0bHkgYXMgaXQgdmFuaXNoZWQgZnJvbSB0aGUgbWFuaWZlc3QuXG4gKiBQdXJlOyByZW1vdmluZyBhbiBhYnNlbnQgcGF0aCBpcyBhIG5vLW9wLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVtb3ZlRW50cnkoaW5kZXg6IExvY2FsSW5kZXgsIHBhdGg6IHN0cmluZyk6IExvY2FsSW5kZXgge1xuICBpZiAoIShwYXRoIGluIGluZGV4KSkgcmV0dXJuIGluZGV4O1xuICBjb25zdCBuZXh0OiBSZWNvcmQ8c3RyaW5nLCBMb2NhbEluZGV4RW50cnk+ID0geyAuLi5pbmRleCB9O1xuICBkZWxldGUgbmV4dFtwYXRoXTtcbiAgcmV0dXJuIG5leHQ7XG59XG5cbi8qKlxuICogU2VyaWFsaXplIHRvIGEgZGV0ZXJtaW5pc3RpYyBKU09OIHN0cmluZzogdmVyc2lvbmVkIGVudmVsb3BlLCBlbnRyaWVzXG4gKiBzb3J0ZWQgYnkgcGF0aCAoc28gaWRlbnRpY2FsIGluZGV4ZXMgc2VyaWFsaXplIGJ5dGUtaWRlbnRpY2FsbHkgYW5kIGRpZmZcbiAqIGNsZWFubHkgaW4gc3RhdGUtZGlyIGxpc3RpbmdzKS4gYHN0YXRlYCAob3B0aW9uYWwpIGNhcnJpZXMgdGhlIHN5bmMtY3Vyc29yXG4gKiBib29ra2VlcGluZyBwZXJzaXN0ZWQgYWxvbmdzaWRlIHRoZSBlbnRyaWVzIFx1MjAxNCBzZWUgYFBlcnNpc3RlZFN5bmNTdGF0ZWAuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXJpYWxpemVMb2NhbEluZGV4KGluZGV4OiBMb2NhbEluZGV4LCBzdGF0ZTogUGVyc2lzdGVkU3luY1N0YXRlID0ge30pOiBzdHJpbmcge1xuICBjb25zdCBlbnRyaWVzOiBSZWNvcmQ8c3RyaW5nLCBMb2NhbEluZGV4RW50cnk+ID0ge307XG4gIGZvciAoY29uc3QgcGF0aCBvZiBPYmplY3Qua2V5cyhpbmRleCkuc29ydCgpKSB7XG4gICAgZW50cmllc1twYXRoXSA9IGluZGV4W3BhdGhdIGFzIExvY2FsSW5kZXhFbnRyeTtcbiAgfVxuICBjb25zdCBlbnZlbG9wZTogTG9jYWxJbmRleEVudmVsb3BlID0ge1xuICAgIHNjaGVtYVZlcnNpb246IExPQ0FMX0lOREVYX1NDSEVNQV9WRVJTSU9OLFxuICAgIGVudHJpZXMsXG4gICAgLi4uKHN0YXRlLmN1cnNvciAhPT0gdW5kZWZpbmVkID8geyBjdXJzb3I6IHN0YXRlLmN1cnNvciB9IDoge30pLFxuICAgIC4uLihzdGF0ZS5zeW5jZWRUaHJvdWdoICE9PSB1bmRlZmluZWQgPyB7IHN5bmNlZFRocm91Z2g6IHN0YXRlLnN5bmNlZFRocm91Z2ggfSA6IHt9KSxcbiAgICAuLi4oc3RhdGUubmVlZHNGdWxsTWFuaWZlc3QgIT09IHVuZGVmaW5lZFxuICAgICAgPyB7IG5lZWRzRnVsbE1hbmlmZXN0OiBzdGF0ZS5uZWVkc0Z1bGxNYW5pZmVzdCB9XG4gICAgICA6IHt9KSxcbiAgfTtcbiAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KGVudmVsb3BlKTtcbn1cblxuLyoqIFRoZSBlbnRyaWVzIHBsdXMgdGhlIHN5bmMtY3Vyc29yIGJvb2trZWVwaW5nIG9mIGEgcGVyc2lzdGVkIHN0YXRlIGZpbGUuICovXG5leHBvcnQgaW50ZXJmYWNlIERlc2VyaWFsaXplZExvY2FsU3RhdGUge1xuICBpbmRleDogTG9jYWxJbmRleDtcbiAgLyoqIEVudmVsb3BlIGJvb2trZWVwaW5nOyBkZWZhdWx0cyBmb3IgZmlsZXMgd3JpdHRlbiBiZWZvcmUgaXQgZXhpc3RlZC4gKi9cbiAgc3RhdGU6IFJlcXVpcmVkPFBlcnNpc3RlZFN5bmNTdGF0ZT47XG59XG5cbi8qKlxuICogUGFyc2UgYSBzZXJpYWxpemVkIHN0YXRlIGZpbGUgSU5DTFVESU5HIGl0cyBlbnZlbG9wZSBib29ra2VlcGluZyAodGhlXG4gKiBjbGllbnQncyBzdGFydHVwIHBhdGgpLiBFbnRyeSB2YWxpZGF0aW9uIGlzIGlkZW50aWNhbCB0b1xuICogYGRlc2VyaWFsaXplTG9jYWxJbmRleGA7IHRoZSBleHRyYSBmaWVsZHMgZGVmYXVsdCB0byBcIm5vIGN1cnNvciBrbm93bGVkZ2VcIlxuICogKGBjdXJzb3I6IDBgLCBgc3luY2VkVGhyb3VnaDogbnVsbGAsIGBuZWVkc0Z1bGxNYW5pZmVzdDogZmFsc2VgKSBzbyB2MlxuICogZmlsZXMgd3JpdHRlbiBieSBvbGRlciBidWlsZHMgbG9hZCB1bmNoYW5nZWQgYW5kIHNpbXBseSByZWNvbm5lY3Qgd2l0aCBhXG4gKiBmdWxsIG1hbmlmZXN0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gZGVzZXJpYWxpemVMb2NhbFN0YXRlKGpzb246IHN0cmluZyk6IERlc2VyaWFsaXplZExvY2FsU3RhdGUge1xuICBsZXQgcGFyc2VkOiB1bmtub3duO1xuICB0cnkge1xuICAgIHBhcnNlZCA9IEpTT04ucGFyc2UoanNvbik7XG4gIH0gY2F0Y2ggKGNhdXNlKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoJ0xvY2FsIGluZGV4IHN0YXRlIGlzIG5vdCB2YWxpZCBKU09OJywgeyBjYXVzZSB9KTtcbiAgfVxuICBpZiAoIWlzUGxhaW5PYmplY3QocGFyc2VkKSkge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKCdMb2NhbCBpbmRleCBzdGF0ZSBpcyBub3QgYW4gb2JqZWN0Jyk7XG4gIH1cbiAgLy8gRW50cnktbGV2ZWwgdmFsaWRhdGlvbiBpcyBleGFjdGx5IGBkZXNlcmlhbGl6ZUxvY2FsSW5kZXhgJ3M7IHRoZSBjYWxsXG4gIC8vIGFsc28gZW5mb3JjZXMgdGhlIHNjaGVtYS12ZXJzaW9uIHdpbmRvdy5cbiAgY29uc3QgaW5kZXggPSBkZXNlcmlhbGl6ZUxvY2FsSW5kZXgoanNvbik7XG4gIGNvbnN0IHJhd0N1cnNvciA9IChwYXJzZWQgYXMgeyBjdXJzb3I/OiB1bmtub3duIH0pLmN1cnNvcjtcbiAgY29uc3QgcmF3U3luY2VkVGhyb3VnaCA9IChwYXJzZWQgYXMgeyBzeW5jZWRUaHJvdWdoPzogdW5rbm93biB9KS5zeW5jZWRUaHJvdWdoO1xuICBjb25zdCByYXdOZWVkc0Z1bGwgPSAocGFyc2VkIGFzIHsgbmVlZHNGdWxsTWFuaWZlc3Q/OiB1bmtub3duIH0pLm5lZWRzRnVsbE1hbmlmZXN0O1xuICBpZiAocmF3Q3Vyc29yICE9PSB1bmRlZmluZWQgJiYgKHR5cGVvZiByYXdDdXJzb3IgIT09ICdudW1iZXInIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKHJhd0N1cnNvcikgfHwgcmF3Q3Vyc29yIDwgMCkpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcignTG9jYWwgaW5kZXggc3RhdGU6IGN1cnNvciBtdXN0IGJlIGEgbm9uLW5lZ2F0aXZlIGludGVnZXInKTtcbiAgfVxuICBpZiAoXG4gICAgcmF3U3luY2VkVGhyb3VnaCAhPT0gdW5kZWZpbmVkICYmXG4gICAgcmF3U3luY2VkVGhyb3VnaCAhPT0gbnVsbCAmJlxuICAgICh0eXBlb2YgcmF3U3luY2VkVGhyb3VnaCAhPT0gJ251bWJlcicgfHwgIU51bWJlci5pc0ludGVnZXIocmF3U3luY2VkVGhyb3VnaCkgfHwgcmF3U3luY2VkVGhyb3VnaCA8IDApXG4gICkge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKCdMb2NhbCBpbmRleCBzdGF0ZTogc3luY2VkVGhyb3VnaCBtdXN0IGJlIGEgbm9uLW5lZ2F0aXZlIGludGVnZXIgb3IgbnVsbCcpO1xuICB9XG4gIGlmIChyYXdOZWVkc0Z1bGwgIT09IHVuZGVmaW5lZCAmJiB0eXBlb2YgcmF3TmVlZHNGdWxsICE9PSAnYm9vbGVhbicpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcignTG9jYWwgaW5kZXggc3RhdGU6IG5lZWRzRnVsbE1hbmlmZXN0IG11c3QgYmUgYSBib29sZWFuIHdoZW4gcHJlc2VudCcpO1xuICB9XG4gIHJldHVybiB7XG4gICAgaW5kZXgsXG4gICAgc3RhdGU6IHtcbiAgICAgIGN1cnNvcjogdHlwZW9mIHJhd0N1cnNvciA9PT0gJ251bWJlcicgPyByYXdDdXJzb3IgOiAwLFxuICAgICAgc3luY2VkVGhyb3VnaDogdHlwZW9mIHJhd1N5bmNlZFRocm91Z2ggPT09ICdudW1iZXInID8gcmF3U3luY2VkVGhyb3VnaCA6IG51bGwsXG4gICAgICBuZWVkc0Z1bGxNYW5pZmVzdDogcmF3TmVlZHNGdWxsID09PSB0cnVlLFxuICAgIH0sXG4gIH07XG59XG5cbi8qKlxuICogUGFyc2UgYSBzZXJpYWxpemVkIGluZGV4IGJhY2suIFRocm93cyBgUHJvdG9jb2xFcnJvcmAgb24gbm9uLUpTT04gaW5wdXQsXG4gKiBhIG1hbGZvcm1lZCBlbnZlbG9wZSwgZW50cmllcyB3aXRoIHdyb25nIGZpZWxkIHR5cGVzLCBvciBhIGBzY2hlbWFWZXJzaW9uYFxuICogb3V0c2lkZSB0aGUgc3VwcG9ydGVkIHJhbmdlIChvbGRlciB0aGFuIGBNSU5fTE9DQUxfSU5ERVhfU0NIRU1BX1ZFUlNJT05gXG4gKiBvciBuZXdlciB0aGFuIGBMT0NBTF9JTkRFWF9TQ0hFTUFfVkVSU0lPTmApIFx1MjAxNCBvbGRlciB2ZXJzaW9ucyAqd2l0aGluKiB0aGVcbiAqIHJhbmdlIGxvYWQgd2l0aG91dCBlcnJvciAodjEgZW50cmllcyBzaW1wbHkgZGVzZXJpYWxpemUgd2l0aCBgbXRpbWVgXG4gKiB1bmtub3duKS4gVW5rbm93biBleHRyYSBmaWVsZHMgYXJlIHRvbGVyYXRlZCBmb3IgZm9yd2FyZCBjb21wYXRpYmlsaXR5LlxuICovXG5leHBvcnQgZnVuY3Rpb24gZGVzZXJpYWxpemVMb2NhbEluZGV4KGpzb246IHN0cmluZyk6IExvY2FsSW5kZXgge1xuICBsZXQgcGFyc2VkOiB1bmtub3duO1xuICB0cnkge1xuICAgIHBhcnNlZCA9IEpTT04ucGFyc2UoanNvbik7XG4gIH0gY2F0Y2ggKGNhdXNlKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoJ0xvY2FsIGluZGV4IHN0YXRlIGlzIG5vdCB2YWxpZCBKU09OJywgeyBjYXVzZSB9KTtcbiAgfVxuICBpZiAoIWlzUGxhaW5PYmplY3QocGFyc2VkKSkge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKCdMb2NhbCBpbmRleCBzdGF0ZSBpcyBub3QgYW4gb2JqZWN0Jyk7XG4gIH1cbiAgY29uc3QgdmVyc2lvbiA9IHBhcnNlZC5zY2hlbWFWZXJzaW9uO1xuICBpZiAodHlwZW9mIHZlcnNpb24gIT09ICdudW1iZXInIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKHZlcnNpb24pKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoJ0xvY2FsIGluZGV4IHN0YXRlIGlzIG1pc3NpbmcgaW50ZWdlciBzY2hlbWFWZXJzaW9uJyk7XG4gIH1cbiAgaWYgKHZlcnNpb24gPCBNSU5fTE9DQUxfSU5ERVhfU0NIRU1BX1ZFUlNJT04gfHwgdmVyc2lvbiA+IExPQ0FMX0lOREVYX1NDSEVNQV9WRVJTSU9OKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoXG4gICAgICBgTG9jYWwgaW5kZXggc2NoZW1hIHZlcnNpb24gJHt2ZXJzaW9ufSBpcyBub3Qgc3VwcG9ydGVkIGJ5IHRoaXMgYnVpbGQgYCArXG4gICAgICAgIGAoZXhwZWN0ZWQgJHtNSU5fTE9DQUxfSU5ERVhfU0NIRU1BX1ZFUlNJT059Li4ke0xPQ0FMX0lOREVYX1NDSEVNQV9WRVJTSU9OfSk7IGAgK1xuICAgICAgICAnYSBtaWdyYXRpb24gaXMgcmVxdWlyZWQnLFxuICAgICk7XG4gIH1cbiAgY29uc3QgcmF3RW50cmllcyA9IHBhcnNlZC5lbnRyaWVzO1xuICBpZiAoIWlzUGxhaW5PYmplY3QocmF3RW50cmllcykpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcignTG9jYWwgaW5kZXggc3RhdGUgaXMgbWlzc2luZyB0aGUgZW50cmllcyBvYmplY3QnKTtcbiAgfVxuXG4gIGNvbnN0IGVudHJpZXM6IFJlY29yZDxzdHJpbmcsIExvY2FsSW5kZXhFbnRyeT4gPSB7fTtcbiAgZm9yIChjb25zdCBbcGF0aCwgcmF3XSBvZiBPYmplY3QuZW50cmllcyhyYXdFbnRyaWVzKSkge1xuICAgIGVudHJpZXNbcGF0aF0gPSBwYXJzZUVudHJ5KHBhdGgsIHJhdyk7XG4gIH1cbiAgcmV0dXJuIGVudHJpZXM7XG59XG5cbmZ1bmN0aW9uIHBhcnNlRW50cnkocGF0aDogc3RyaW5nLCByYXc6IHVua25vd24pOiBMb2NhbEluZGV4RW50cnkge1xuICBjb25zdCB3aGVyZSA9IGBMb2NhbCBpbmRleCBlbnRyeSAke0pTT04uc3RyaW5naWZ5KHBhdGgpfWA7XG4gIGlmICghaXNQbGFpbk9iamVjdChyYXcpKSB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgJHt3aGVyZX0gaXMgbm90IGFuIG9iamVjdGApO1xuICBjb25zdCB7IGhhc2gsIHNpemUsIHZlcnNpb25JZCwgY2xvY2ssIGRlbGV0ZWRBdCwgaXNGb2xkZXIsIG10aW1lIH0gPSByYXcgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIGlmICh0eXBlb2YgaGFzaCAhPT0gJ3N0cmluZycpIHRocm93IG5ldyBQcm90b2NvbEVycm9yKGAke3doZXJlfTogaGFzaCBtdXN0IGJlIGEgc3RyaW5nYCk7XG4gIGlmICh0eXBlb2YgdmVyc2lvbklkICE9PSAnc3RyaW5nJykge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKGAke3doZXJlfTogdmVyc2lvbklkIG11c3QgYmUgYSBzdHJpbmdgKTtcbiAgfVxuICBpZiAodHlwZW9mIHNpemUgIT09ICdudW1iZXInIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKHNpemUpIHx8IHNpemUgPCAwKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoYCR7d2hlcmV9OiBzaXplIG11c3QgYmUgYSBub24tbmVnYXRpdmUgaW50ZWdlcmApO1xuICB9XG4gIGlmICghaXNQbGFpbk9iamVjdChjbG9jaykgfHwgdHlwZW9mIGNsb2NrLmNvdW50ZXIgIT09ICdudW1iZXInIHx8IHR5cGVvZiBjbG9jay5kZXZpY2VJZCAhPT0gJ3N0cmluZycpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgJHt3aGVyZX06IGNsb2NrIG11c3QgYmUgeyBjb3VudGVyOiBudW1iZXIsIGRldmljZUlkOiBzdHJpbmcgfWApO1xuICB9XG4gIGlmIChkZWxldGVkQXQgIT09IHVuZGVmaW5lZCAmJiB0eXBlb2YgZGVsZXRlZEF0ICE9PSAnbnVtYmVyJykge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKGAke3doZXJlfTogZGVsZXRlZEF0IG11c3QgYmUgYSBudW1iZXIgd2hlbiBwcmVzZW50YCk7XG4gIH1cbiAgaWYgKGlzRm9sZGVyICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIGlzRm9sZGVyICE9PSAnYm9vbGVhbicpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgJHt3aGVyZX06IGlzRm9sZGVyIG11c3QgYmUgYSBib29sZWFuIHdoZW4gcHJlc2VudGApO1xuICB9XG4gIGlmIChtdGltZSAhPT0gdW5kZWZpbmVkICYmICh0eXBlb2YgbXRpbWUgIT09ICdudW1iZXInIHx8ICFOdW1iZXIuaXNGaW5pdGUobXRpbWUpKSkge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKGAke3doZXJlfTogbXRpbWUgbXVzdCBiZSBhIGZpbml0ZSBudW1iZXIgd2hlbiBwcmVzZW50YCk7XG4gIH1cbiAgY29uc3QgZW50cnk6IExvY2FsSW5kZXhFbnRyeSA9IHtcbiAgICBoYXNoLFxuICAgIHNpemUsXG4gICAgdmVyc2lvbklkLFxuICAgIGNsb2NrOiB7IGNvdW50ZXI6IGNsb2NrLmNvdW50ZXIgYXMgbnVtYmVyLCBkZXZpY2VJZDogY2xvY2suZGV2aWNlSWQgYXMgc3RyaW5nIH0sXG4gIH07XG4gIGlmIChkZWxldGVkQXQgIT09IHVuZGVmaW5lZCkgZW50cnkuZGVsZXRlZEF0ID0gZGVsZXRlZEF0IGFzIG51bWJlcjtcbiAgaWYgKGlzRm9sZGVyICE9PSB1bmRlZmluZWQpIGVudHJ5LmlzRm9sZGVyID0gaXNGb2xkZXIgYXMgYm9vbGVhbjtcbiAgaWYgKG10aW1lICE9PSB1bmRlZmluZWQpIGVudHJ5Lm10aW1lID0gbXRpbWUgYXMgbnVtYmVyO1xuICByZXR1cm4gZW50cnk7XG59XG5cbmZ1bmN0aW9uIGlzUGxhaW5PYmplY3QodmFsdWU6IHVua25vd24pOiB2YWx1ZSBpcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB7XG4gIHJldHVybiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIHZhbHVlICE9PSBudWxsICYmICFBcnJheS5pc0FycmF5KHZhbHVlKTtcbn1cbiIsICIvKipcbiAqIFRoaW4gcHVsbC1zaWRlIG9yY2hlc3RyYXRpb24gKEFSQ0hJVEVDVFVSRS5tZCBcdTAwQTc4IHN0ZXAgNSkuIE5PVCB0aGUgbmV0d29ya1xuICogY2xpZW50OiBhbGwgdHJhbnNwb3J0IGlzIGluamVjdGVkIChgZmV0Y2hCbG9iYCksIHdoaWNoIHRoZSBsYXRlciBuZXR3b3JrXG4gKiBwaGFzZSBpbXBsZW1lbnRzIG92ZXIgYC9ibG9iLzpoYXNoYCBvciBXUy1pbmxpbmUgY29udGVudC5cbiAqXG4gKiBgYXBwbHlQdWxsYCBtYXRlcmlhbGl6ZXMgZXZlcnkgYFB1bGxPcGAgb2YgYSBgU3luY1BsYW5gIHRocm91Z2ggdGhlXG4gKiBzdG9yYWdlIGFkYXB0ZXIgYW5kIHVwZGF0ZXMgdGhlIGxvY2FsIGluZGV4IFx1MjAxNCBkdXJhYmx5IGFuZCBob25lc3RseTpcbiAqXG4gKiAgIC0gYmxvYnMgYXJlIHZlcmlmaWVkIChzaGEyNTYpIGJlZm9yZSBiZWluZyB3cml0dGVuOyBhIG1pc21hdGNoIGFib3J0c1xuICogICAgIHRoZSBwbGFuO1xuICogICAtIGVhY2ggaW5kZXggZW50cnkgaXMgcmVjb3JkZWQgb25seSAqYWZ0ZXIqIGl0cyBzdG9yYWdlIHdyaXRlIHN1Y2NlZWRlZCxcbiAqICAgICBzbyBhIG1pZC1wbGFuIGZhaWx1cmUgbGVhdmVzIHRoZSBpbmRleCBkZXNjcmliaW5nIGV4YWN0bHkgdGhlIGZpbGVzXG4gKiAgICAgdGhhdCBhY3R1YWxseSBsYW5kZWQgKEZSLTU6IG5vdGhpbmcgaXMgc2lsZW50bHkgbG9zdCBcdTIwMTQgdGhlIHVuc3luY2VkXG4gKiAgICAgcHVsbHMgc2ltcGx5IHJlbWFpbiBpbiB0aGUgcGxhbiBhbmQgYXJlIHJldHJpZWQgYnkgdGhlIGNhbGxlcik7XG4gKiAgIC0gdGhlIGluZGV4IGlzIHBlcnNpc3RlZCB0aHJvdWdoIHRoZSBhZGFwdGVyJ3MgYXRvbWljIGB3cml0ZUZpbGVgXG4gKiAgICAgKHRlbXAgKyByZW5hbWUgcGVyIHRoZSBhZGFwdGVyIGNvbnRyYWN0KSBhdFxuICogICAgIGAvLnZhdWx0c3luY2ZvcmFnZW50cy9zdGF0ZWAsIGluY2x1ZGluZyBvbiB0aGUgZmFpbHVyZSBwYXRoLlxuICpcbiAqIEZvbGRlciBsaWZlY3ljbGUgKEZSLTEwIGFuZCBpdHMgZGVsZXRpb24gY291bnRlcnBhcnQpOlxuICpcbiAqICAgLSBhcHBseWluZyBhIFJFTU9URSBGT0xERVIgVE9NQlNUT05FIHJlbW92ZXMgdGhlIGxvY2FsIGRpcmVjdG9yeSB3aGVuXG4gKiAgICAgaXQgZXhpc3RzIGFuZCBpcyBlbXB0eSAoYWRhcHRlciBgcmVtb3ZlRGlyYCk7IG5vbi1lbXB0eSBvciBtaXNzaW5nIFx1MjFEMlxuICogICAgIHJlY29yZCB0aGUgdG9tYnN0b25lIG9ubHkgXHUyMDE0IHRoZSBkaXJlY3RvcnkgY29udmVyZ2VzIGxhdGVyLCBhbmQgYVxuICogICAgIG5vbi1lbXB0eSBkaXJlY3RvcnkgaXMgbmV2ZXIgZGVsZXRlZDtcbiAqICAgLSBQUlVORS1PTi1ERUxFVEU6IGFwcGx5aW5nIGEgcmVtb3RlIGZpbGUgZGVsZXRpb24gKG9yIHJlbmFtZSBhd2F5KVxuICogICAgIHJlbW92ZXMgdGhlIGRlbGV0ZWQgcGF0aCdzIHBhcmVudCBkaXJlY3Rvcnkgd2hlbiBpdCBpcyBub3cgZW1wdHkgb25cbiAqICAgICBkaXNrIGFuZCBob2xkcyBubyBsaXZlIGZpbGUgZW50cmllcyBpbiB0aGUgaW5kZXggXHUyMDE0IHRoaXMgaXMgd2hhdCBzdG9wc1xuICogICAgIGFuIGVtcHRpZWQgZGlyZWN0b3J5IGZyb20gc2VsZi1yZXN1cnJlY3RpbmcgYXMgYW4gZW1wdHktZm9sZGVyXG4gKiAgICAgcGxhY2Vob2xkZXIgb24gdGhlIG5leHQgc2Nhbi4gRXhhY3RseSBPTkUgbGV2ZWwgcGVyIGRlbGV0aW9uOiB0aGVcbiAqICAgICBpbW1lZGlhdGUgcGFyZW50IG9ubHksIG5ldmVyIGEgY2FzY2FkZSAoYSBjaGFpbiBvZiBlbXB0aWVkXG4gKiAgICAgZGlyZWN0b3JpZXMgY29udmVyZ2VzIG92ZXIgc3VjY2Vzc2l2ZSBjeWNsZXM7IHRoZSBzYWZldHkgaW52YXJpYW50IFx1MjAxNFxuICogICAgIG5ldmVyIGRlbGV0ZSBhIG5vbi1lbXB0eSBkaXJlY3RvcnksIG5ldmVyIGxvc2UgdXNlciBjb250ZW50IFx1MjAxNCBpc1xuICogICAgIGNoZWNrZWQgYmVmb3JlIGV2ZXJ5IHJlbW92YWwpLlxuICpcbiAqIFB1c2hlcy9jb25mbGljdHMvZm9sZGVyIG9wcyBhcmUgdGhlIG5ldHdvcmsgcGhhc2UncyBidXNpbmVzczsgcmV0cnlcbiAqIHF1ZXVlcyBhcmUgZXhwbGljaXRseSBvdXQgb2Ygc2NvcGUgaGVyZS5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IFN0b3JhZ2VBZGFwdGVyIH0gZnJvbSAnLi9hZGFwdGVycy5qcyc7XG5pbXBvcnQgeyBzaGEyNTZIZXggfSBmcm9tICcuL2hhc2hpbmcuanMnO1xuaW1wb3J0IHtcbiAgYXBwbHlDb21taXQsXG4gIGRlc2VyaWFsaXplTG9jYWxTdGF0ZSxcbiAgTE9DQUxfSU5ERVhfU1RBVEVfUEFUSCxcbiAgcmVtb3ZlRW50cnksXG4gIHNlcmlhbGl6ZUxvY2FsSW5kZXgsXG4gIHR5cGUgRGVzZXJpYWxpemVkTG9jYWxTdGF0ZSxcbiAgdHlwZSBMb2NhbEluZGV4LFxuICB0eXBlIFBlcnNpc3RlZFN5bmNTdGF0ZSxcbn0gZnJvbSAnLi9sb2NhbGluZGV4LmpzJztcbmltcG9ydCB7IGlzU3RyaWN0bHlCZW5lYXRoLCBwYXJlbnRQYXRoIH0gZnJvbSAnLi9wYXRocy5qcyc7XG5pbXBvcnQgdHlwZSB7IFB1bGxPcCwgU3luY1BsYW4gfSBmcm9tICcuL3Jlc29sdmUuanMnO1xuXG4vKiogSW5qZWN0ZWQgY29udGVudCB0cmFuc3BvcnQ6IGZldGNoIHRoZSBibG9iIGZvciBhIGNvbnRlbnQgaGFzaC4gKi9cbmV4cG9ydCB0eXBlIEZldGNoQmxvYiA9IChoYXNoOiBzdHJpbmcpID0+IFByb21pc2U8VWludDhBcnJheT47XG5cbmV4cG9ydCBpbnRlcmZhY2UgQXBwbHlQdWxsT3B0aW9ucyB7XG4gIC8qKiBFcG9jaCBtcyB1c2VkIGZvciB0b21ic3RvbmUgdGltZXN0YW1wcy4gRGVmYXVsdDogYERhdGUubm93KClgIFx1MjAxNCB0aGlzXG4gICAqICBmdW5jdGlvbiBpcyBJL08gb3JjaGVzdHJhdGlvbiwgbm90IGEgcHVyZSBmdW5jdGlvbiwgYnV0IHRlc3RzIGluamVjdFxuICAgKiAgYSBmaXhlZCB2YWx1ZSBmb3IgZGV0ZXJtaW5pc20uICovXG4gIG5vdz86IG51bWJlcjtcbiAgLyoqXG4gICAqIEJ1bGstcHVsbCBwcm9ncmVzczogY2FsbGVkIG9uY2Ugd2l0aCAoMCwgdG90YWwpIHVwIGZyb250IGFuZCBvbmNlIGFmdGVyXG4gICAqIGVhY2ggcHVsbCBtYXRlcmlhbGl6ZXMuIFB1cmUgcmVwb3J0aW5nIFx1MjAxNCBuZXZlciBhZmZlY3RzIGFwcGxpY2F0aW9uLlxuICAgKi9cbiAgb25Qcm9ncmVzcz86IChkb25lOiBudW1iZXIsIHRvdGFsOiBudW1iZXIpID0+IHZvaWQ7XG4gIC8qKlxuICAgKiBTeW5jLWN1cnNvciBib29ra2VlcGluZyB0byB3cml0ZSBpbnRvIHRoZSBzdGF0ZSBmaWxlJ3MgZW52ZWxvcGUgd2hlbmV2ZXJcbiAgICogdGhpcyBjYWxsIHBlcnNpc3RzIHRoZSBpbmRleC4gV2l0aG91dCBpdCBhIHB1bGwtc2lkZSBwZXJzaXN0IHdvdWxkIHN0cmlwXG4gICAqIHRoZSBjbGllbnQncyBjdXJzb3Ivc3luY2VkVGhyb3VnaCBmaWVsZHMgZnJvbSBgLy52YXVsdHN5bmNmb3JhZ2VudHMvc3RhdGVgXG4gICAqICh0aGUgZW52ZWxvcGUgaXMgcmV3cml0dGVuIHdob2xlc2FsZSkuIFRoZSBjbGllbnQgcGFzc2VzIGl0cyBjdXJyZW50XG4gICAqIHZhbHVlczsgYSBzbmFwc2hvdCBhIG1vbWVudCBzdGFsZSBpcyBoYXJtbGVzcyBcdTIwMTQgdGhlIG5leHQgcGVyc2lzdCByZWZyZXNoZXNcbiAgICogaXQsIGFuZCBhbiB1bmRlci1yZXBvcnRlZCBjdXJzb3Igb25seSB3aWRlbnMgdGhlIG5leHQgcmVwbGF5LlxuICAgKi9cbiAgcGVyc2lzdGVkU3RhdGU/OiBQZXJzaXN0ZWRTeW5jU3RhdGU7XG59XG5cbi8qKlxuICogQXBwbHkgYWxsIHB1bGxzIG9mIGBwbGFuYCBhbmQgcmV0dXJuIHRoZSB1cGRhdGVkIGluZGV4IChhbHNvIHBlcnNpc3RlZCB0b1xuICogdGhlIGFkYXB0ZXIgYXQgYExPQ0FMX0lOREVYX1NUQVRFX1BBVEhgKS5cbiAqXG4gKiBTdG9yYWdlIHdyaXRlcyBoYXBwZW4gaW4gcGxhbiBvcmRlci4gSWYgYW55IG9wIGZhaWxzLCB0aGUgaW5kZXggcmVmbGVjdGluZ1xuICogZXZlcnkgb3AgdGhhdCBzdWNjZWVkZWQgc28gZmFyIGlzIHBlcnNpc3RlZCBhbmQgdGhlIG9yaWdpbmFsIGVycm9yIGlzXG4gKiByZXRocm93biBcdTIwMTQgcGF0aHMgdGhhdCBmYWlsZWQgYXJlIGFic2VudCBmcm9tIHRoZSByZXR1cm5lZC9wZXJzaXN0ZWQgaW5kZXguXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBhcHBseVB1bGwoXG4gIHN0b3JhZ2U6IFN0b3JhZ2VBZGFwdGVyLFxuICBpbmRleDogTG9jYWxJbmRleCxcbiAgcGxhbjogU3luY1BsYW4sXG4gIGZldGNoQmxvYjogRmV0Y2hCbG9iLFxuICBvcHRpb25zOiBBcHBseVB1bGxPcHRpb25zID0ge30sXG4pOiBQcm9taXNlPExvY2FsSW5kZXg+IHtcbiAgY29uc3Qgbm93ID0gb3B0aW9ucy5ub3cgPz8gRGF0ZS5ub3coKTtcbiAgY29uc3Qgb25Qcm9ncmVzcyA9IG9wdGlvbnMub25Qcm9ncmVzcztcbiAgbGV0IHdvcmtpbmc6IExvY2FsSW5kZXggPSBpbmRleDtcblxuICBvblByb2dyZXNzPy4oMCwgcGxhbi5wdWxscy5sZW5ndGgpO1xuICBsZXQgZG9uZSA9IDA7XG4gIHRyeSB7XG4gICAgZm9yIChjb25zdCBwdWxsIG9mIHBsYW4ucHVsbHMpIHtcbiAgICAgIHdvcmtpbmcgPSBhd2FpdCBhcHBseU9uZVB1bGwoc3RvcmFnZSwgd29ya2luZywgcHVsbCwgZmV0Y2hCbG9iLCBub3cpO1xuICAgICAgZG9uZSArPSAxO1xuICAgICAgb25Qcm9ncmVzcz8uKGRvbmUsIHBsYW4ucHVsbHMubGVuZ3RoKTtcbiAgICB9XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHBlcnNpc3RJbmRleChzdG9yYWdlLCB3b3JraW5nLCBvcHRpb25zLnBlcnNpc3RlZFN0YXRlKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIFBlcnNpc3RlbmNlIGZhaWx1cmUgbXVzdCBub3QgbWFzayB0aGUgb3JpZ2luYWwgZXJyb3I7IHRoZSBjYWxsZXJcbiAgICAgIC8vIHJldHJpZXMgdGhlIHdob2xlIGN5Y2xlIGFueXdheS5cbiAgICB9XG4gICAgdGhyb3cgZXJyb3I7XG4gIH1cblxuICBhd2FpdCBwZXJzaXN0SW5kZXgoc3RvcmFnZSwgd29ya2luZywgb3B0aW9ucy5wZXJzaXN0ZWRTdGF0ZSk7XG4gIHJldHVybiB3b3JraW5nO1xufVxuXG5hc3luYyBmdW5jdGlvbiBhcHBseU9uZVB1bGwoXG4gIHN0b3JhZ2U6IFN0b3JhZ2VBZGFwdGVyLFxuICBpbmRleDogTG9jYWxJbmRleCxcbiAgcHVsbDogUHVsbE9wLFxuICBmZXRjaEJsb2I6IEZldGNoQmxvYixcbiAgbm93OiBudW1iZXIsXG4pOiBQcm9taXNlPExvY2FsSW5kZXg+IHtcbiAgaWYgKHB1bGwua2luZCA9PT0gJ3JlbmFtZScpIHtcbiAgICBpZiAoYXdhaXQgc3RvcmFnZS5leGlzdHMocHVsbC5mcm9tUGF0aCkpIHtcbiAgICAgIGF3YWl0IHN0b3JhZ2UucmVuYW1lRmlsZShwdWxsLmZyb21QYXRoLCBwdWxsLnRvUGF0aCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIE9sZCBwYXRoIG5ldmVyIG1hdGVyaWFsaXplZCBoZXJlIChvciBhbHJlYWR5IG1vdmVkKTogZmV0Y2ggY29udGVudC5cbiAgICAgIGF3YWl0IGZldGNoVmVyaWZpZWQoc3RvcmFnZSwgcHVsbC50b1BhdGgsIHB1bGwuaGFzaCwgZmV0Y2hCbG9iKTtcbiAgICB9XG4gICAgY29uc3QgbW92ZWQgPSBhcHBseUNvbW1pdChyZW1vdmVFbnRyeShpbmRleCwgcHVsbC5mcm9tUGF0aCksIHtcbiAgICAgIHBhdGg6IHB1bGwudG9QYXRoLFxuICAgICAgdmVyc2lvbklkOiBwdWxsLnZlcnNpb24sXG4gICAgICBoYXNoOiBwdWxsLmhhc2gsXG4gICAgICBzaXplOiBwdWxsLnNpemUsXG4gICAgICBjbG9jazogcHVsbC5jbG9jayxcbiAgICB9KTtcbiAgICAvLyBUaGUgbGFzdCBmaWxlIG1heSBqdXN0IGhhdmUgbGVmdCBpdHMgb2xkIHBhcmVudCBkaXJlY3RvcnkgKHBydW5lLW9uLVxuICAgIC8vIGRlbGV0ZSBhcHBsaWVzIHRvIG1vdmVzIHRvbzsgdGhlIHJlbmFtZSBpdHNlbGYgaXMgdW50b3VjaGVkKS5cbiAgICBhd2FpdCBwcnVuZVBhcmVudE9uRGVsZXRlKHN0b3JhZ2UsIG1vdmVkLCBwdWxsLmZyb21QYXRoKTtcbiAgICByZXR1cm4gbW92ZWQ7XG4gIH1cblxuICBpZiAocHVsbC5pc0ZvbGRlcikge1xuICAgIC8vIEZvbGRlciBwbGFjZWhvbGRlcnMgKEZSLTEwKTogY3JlYXRlIHRoZSBkaXJlY3RvcnksIHJlY29yZCB0aGUgZW50cnkuXG4gICAgLy8gQSBmb2xkZXIgVE9NQlNUT05FIGFkZGl0aW9uYWxseSByZW1vdmVzIHRoZSBsb2NhbCBkaXJlY3Rvcnkgd2hlbiBpdFxuICAgIC8vIGV4aXN0cyBhbmQgaXMgZW1wdHk7IG5vbi1lbXB0eSBvciBtaXNzaW5nIFx1MjFEMiByZWNvcmQgb25seSAoY29udmVyZ2VzXG4gICAgLy8gbGF0ZXIgXHUyMDE0IGEgbm9uLWVtcHR5IGRpcmVjdG9yeSBpcyBuZXZlciBkZWxldGVkIGhlcmUpLlxuICAgIGlmIChwdWxsLmRlbGV0ZWQpIHtcbiAgICAgIGF3YWl0IHJlbW92ZURpcklmVmFjYW50KHN0b3JhZ2UsIGluZGV4LCBwdWxsLnBhdGgpO1xuICAgIH0gZWxzZSB7XG4gICAgICBhd2FpdCBzdG9yYWdlLmVuc3VyZURpcihwdWxsLnBhdGgpO1xuICAgIH1cbiAgICByZXR1cm4gYXBwbHlDb21taXQoaW5kZXgsIHtcbiAgICAgIHBhdGg6IHB1bGwucGF0aCxcbiAgICAgIHZlcnNpb25JZDogcHVsbC52ZXJzaW9uLFxuICAgICAgaGFzaDogcHVsbC5oYXNoLFxuICAgICAgc2l6ZTogcHVsbC5zaXplLFxuICAgICAgY2xvY2s6IHB1bGwuY2xvY2ssXG4gICAgICBkZWxldGVkOiBwdWxsLmRlbGV0ZWQsXG4gICAgICBkZWxldGVkQXQ6IHB1bGwuZGVsZXRlZCA/IG5vdyA6IHVuZGVmaW5lZCxcbiAgICAgIGlzRm9sZGVyOiB0cnVlLFxuICAgIH0pO1xuICB9XG5cbiAgaWYgKHB1bGwuZGVsZXRlZCkge1xuICAgIC8vIElkZW1wb3RlbnQgcGVyIHRoZSBhZGFwdGVyIGNvbnRyYWN0OyBhIGxvY2FsIC50cmFzaCBjb3B5IGlzIGFcbiAgICAvLyBwbGF0Zm9ybS1sYXllciBjb25jZXJuIChkYWVtb24vcGx1Z2luKSwgbm90IGVuZ2luZSBsb2dpYy5cbiAgICBhd2FpdCBzdG9yYWdlLmRlbGV0ZUZpbGUocHVsbC5wYXRoKTtcbiAgICBjb25zdCB0b21ic3RvbmVkID0gYXBwbHlDb21taXQoaW5kZXgsIHtcbiAgICAgIHBhdGg6IHB1bGwucGF0aCxcbiAgICAgIHZlcnNpb25JZDogcHVsbC52ZXJzaW9uLFxuICAgICAgaGFzaDogcHVsbC5oYXNoLFxuICAgICAgc2l6ZTogcHVsbC5zaXplLFxuICAgICAgY2xvY2s6IHB1bGwuY2xvY2ssXG4gICAgICBkZWxldGVkOiB0cnVlLFxuICAgICAgZGVsZXRlZEF0OiBub3csXG4gICAgfSk7XG4gICAgLy8gUHJ1bmUtb24tZGVsZXRlOiBhbiBlbXB0aWVkIHBhcmVudCBkaXJlY3RvcnkgbXVzdCBub3QgbGluZ2VyIGFuZFxuICAgIC8vIHJlLXN1cmZhY2UgYXMgYW4gZW1wdHktZm9sZGVyIHBsYWNlaG9sZGVyIG9uIHRoZSBuZXh0IHNjYW4uXG4gICAgYXdhaXQgcHJ1bmVQYXJlbnRPbkRlbGV0ZShzdG9yYWdlLCB0b21ic3RvbmVkLCBwdWxsLnBhdGgpO1xuICAgIHJldHVybiB0b21ic3RvbmVkO1xuICB9XG5cbiAgY29uc3QgY3VycmVudCA9IGluZGV4W3B1bGwucGF0aF07XG4gIGlmIChcbiAgICBjdXJyZW50ICE9PSB1bmRlZmluZWQgJiZcbiAgICBjdXJyZW50LmRlbGV0ZWRBdCA9PT0gdW5kZWZpbmVkICYmXG4gICAgY3VycmVudC5oYXNoID09PSBwdWxsLmhhc2ggJiZcbiAgICAoYXdhaXQgc3RvcmFnZS5leGlzdHMocHVsbC5wYXRoKSlcbiAgKSB7XG4gICAgLy8gQ29udGVudCBhbHJlYWR5IGNvcnJlY3QgbG9jYWxseSAoZS5nLiB2ZXJzaW9uLWlkIGNhdGNoLXVwIGFmdGVyIGFcbiAgICAvLyByZW5hbWUgZWxzZXdoZXJlKTogcmVjb3JkIHRoZSBhdXRob3JpdGF0aXZlIGhlYWQsIHNraXAgZmV0Y2grd3JpdGUuXG4gICAgLy8gVGhlIGV4aXN0ZW5jZSBjaGVjayBtYXR0ZXJzIHdoZW4gdGhlIGZpbGUgd2FzIGRlbGV0ZWQgbG9jYWxseSBzaW5jZSB0aGVcbiAgICAvLyBpbmRleCB3YXMgbGFzdCB3cml0dGVuIFx1MjAxNCByZWNyZWF0aW5nIGl0IGlzIHdoYXQgdGhlIHB1bGwgZGVtYW5kcy5cbiAgICByZXR1cm4gYXBwbHlDb21taXQoaW5kZXgsIHtcbiAgICAgIHBhdGg6IHB1bGwucGF0aCxcbiAgICAgIHZlcnNpb25JZDogcHVsbC52ZXJzaW9uLFxuICAgICAgaGFzaDogcHVsbC5oYXNoLFxuICAgICAgc2l6ZTogcHVsbC5zaXplLFxuICAgICAgY2xvY2s6IHB1bGwuY2xvY2ssXG4gICAgfSk7XG4gIH1cblxuICBhd2FpdCBmZXRjaFZlcmlmaWVkKHN0b3JhZ2UsIHB1bGwucGF0aCwgcHVsbC5oYXNoLCBmZXRjaEJsb2IpO1xuICByZXR1cm4gYXBwbHlDb21taXQoaW5kZXgsIHtcbiAgICBwYXRoOiBwdWxsLnBhdGgsXG4gICAgdmVyc2lvbklkOiBwdWxsLnZlcnNpb24sXG4gICAgaGFzaDogcHVsbC5oYXNoLFxuICAgIHNpemU6IHB1bGwuc2l6ZSxcbiAgICBjbG9jazogcHVsbC5jbG9jayxcbiAgfSk7XG59XG5cbi8vIC0tLSBmb2xkZXIgbGlmZWN5Y2xlIGhlbHBlcnMgKEI6IHRvbWJzdG9uZS1hcHBseSwgQzogcHJ1bmUtb24tZGVsZXRlKSAtLS0tLS0tLVxuXG4vKiogT3V0Y29tZSBvZiBhIHBydW5lIGF0dGVtcHQ6IHRoZSBkaXJlY3RvcnkganVkZ2VkIGRlbGV0YWJsZSwgYW5kIHdoZXRoZXIgaXQgd2FzLiAqL1xuZXhwb3J0IGludGVyZmFjZSBQcnVuZWREaXIge1xuICAvKiogVGhlIGRpcmVjdG9yeSB0aGF0IHF1YWxpZmllZCBmb3IgcmVtb3ZhbCAodGhlIGRlbGV0ZWQgcGF0aCdzIHBhcmVudCkuICovXG4gIGRpcjogc3RyaW5nO1xuICAvKiogV2hldGhlciBgc3RvcmFnZS5yZW1vdmVEaXJgIGFjdHVhbGx5IHJlbW92ZWQgaXQgKGZhbHNlIHdoZW4gdGhlIGFkYXB0ZXJcbiAgICogIGxhY2tzIHRoZSBob29rIG9yIHJlZnVzZWQgXHUyMDE0IGVsaWdpYmlsaXR5IGFsb25lIHN0aWxsIHN1cHByZXNzZXMgYVxuICAgKiAgcGxhY2Vob2xkZXIgcHVzaCBmb3IgaXQsIGBjbGllbnQudHNgKS4gKi9cbiAgcmVtb3ZlZDogYm9vbGVhbjtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIGBkaXJgIG1heSBiZSBkZWxldGVkIHdpdGhvdXQgbG9zaW5nIGFueXRoaW5nOiBpdCBleGlzdHMsIG5vdGhpbmdcbiAqIChmaWxlIG9yIGRpcmVjdG9yeSkgbGl2ZXMgYmVuZWF0aCBpdCBpbiBzdG9yYWdlLCBhbmQgdGhlIGluZGV4IGhvbGRzIG5vXG4gKiBsaXZlIGZpbGUgZW50cnkgYmVuZWF0aCBpdC4gVGhlIHJvb3QgaXMgbmV2ZXIgZGVsZXRhYmxlLiBUaGlzIGlzIHRoZVxuICogbmV2ZXItZGVsZXRlLW5vbi1lbXB0eSAvIG5ldmVyLWxvc2UtY29udGVudCBpbnZhcmlhbnQgbWFkZSBleHBsaWNpdCBcdTIwMTRcbiAqIGV2ZXJ5IGRpcmVjdG9yeSByZW1vdmFsIGluIGNvcmUgZ29lcyB0aHJvdWdoIGl0LlxuICovXG5hc3luYyBmdW5jdGlvbiBkaXJJc1ZhY2FudChcbiAgc3RvcmFnZTogU3RvcmFnZUFkYXB0ZXIsXG4gIGluZGV4OiBMb2NhbEluZGV4LFxuICBkaXI6IHN0cmluZyxcbik6IFByb21pc2U8Ym9vbGVhbj4ge1xuICBpZiAoZGlyID09PSAnLycpIHJldHVybiBmYWxzZTtcbiAgaWYgKCEoYXdhaXQgc3RvcmFnZS5leGlzdHMoZGlyKSkpIHJldHVybiBmYWxzZTtcbiAgZm9yIChjb25zdCBmaWxlIG9mIGF3YWl0IHN0b3JhZ2UubGlzdEZpbGVzKCkpIHtcbiAgICBpZiAoaXNTdHJpY3RseUJlbmVhdGgoZmlsZS5wYXRoLCBkaXIpKSByZXR1cm4gZmFsc2U7XG4gIH1cbiAgZm9yIChjb25zdCBjaGlsZCBvZiBhd2FpdCBzdG9yYWdlLmxpc3REaXJzKCkpIHtcbiAgICBpZiAoaXNTdHJpY3RseUJlbmVhdGgoY2hpbGQsIGRpcikpIHJldHVybiBmYWxzZTtcbiAgfVxuICBmb3IgKGNvbnN0IFtwYXRoLCBlbnRyeV0gb2YgT2JqZWN0LmVudHJpZXMoaW5kZXgpKSB7XG4gICAgaWYgKGVudHJ5LmlzRm9sZGVyIHx8IGVudHJ5LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkKSBjb250aW51ZTtcbiAgICBpZiAoaXNTdHJpY3RseUJlbmVhdGgocGF0aCwgZGlyKSkgcmV0dXJuIGZhbHNlO1xuICB9XG4gIHJldHVybiB0cnVlO1xufVxuXG4vKiogUmVtb3ZlIGBkaXJgIHRocm91Z2ggdGhlIGFkYXB0ZXIgd2hlbiBpdCBpcyB2YWNhbnQuIE1pc3Npbmcvbm9uLWVtcHR5L3Vuc3VwcG9ydGVkIFx1MjFEMiBmYWxzZS4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZW1vdmVEaXJJZlZhY2FudChcbiAgc3RvcmFnZTogU3RvcmFnZUFkYXB0ZXIsXG4gIGluZGV4OiBMb2NhbEluZGV4LFxuICBkaXI6IHN0cmluZyxcbik6IFByb21pc2U8Ym9vbGVhbj4ge1xuICBpZiAoIShhd2FpdCBkaXJJc1ZhY2FudChzdG9yYWdlLCBpbmRleCwgZGlyKSkpIHJldHVybiBmYWxzZTtcbiAgcmV0dXJuIHJlbW92ZVZhY2FudERpcihzdG9yYWdlLCBkaXIpO1xufVxuXG5hc3luYyBmdW5jdGlvbiByZW1vdmVWYWNhbnREaXIoc3RvcmFnZTogU3RvcmFnZUFkYXB0ZXIsIGRpcjogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XG4gIGlmIChzdG9yYWdlLnJlbW92ZURpciA9PT0gdW5kZWZpbmVkKSByZXR1cm4gZmFsc2U7IC8vIHByZS1ob29rIGFkYXB0ZXJzOiByZWNvcmQtb25seVxuICB0cnkge1xuICAgIGF3YWl0IHN0b3JhZ2UucmVtb3ZlRGlyKGRpcik7XG4gICAgcmV0dXJuIHRydWU7XG4gIH0gY2F0Y2gge1xuICAgIC8vIEEgcmVmdXNlZCBvciByYWNlZCByZW1vdmFsIGlzIHJlY29yZC1vbmx5LCBuZXZlciBmYXRhbCBhbmQgbmV2ZXIgZGF0YVxuICAgIC8vIGxvc3MgXHUyMDE0IHRoZSB0b21ic3RvbmUgaXMgc3RpbGwgcmVjb3JkZWQgYW5kIHN0YXRlIGNvbnZlcmdlcyBsYXRlci5cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuLyoqXG4gKiBQcnVuZS1vbi1kZWxldGUgKEMpOiBhZnRlciBgZGVsZXRlZFBhdGhgIHdhcyBkZWxldGVkIChvciByZW5hbWVkIGF3YXkpLFxuICogcmVtb3ZlIGl0cyBpbW1lZGlhdGUgcGFyZW50IGRpcmVjdG9yeSB3aGVuIGl0IGlzIG5vdyBlbXB0eSBvbiBkaXNrIGFuZFxuICogdW5yZXByZXNlbnRlZCBieSBsaXZlIGluZGV4IGVudHJpZXMgXHUyMDE0IGV4YWN0bHkgT05FIGxldmVsLCBubyBjYXNjYWRlLlxuICpcbiAqIFJldHVybnMgdGhlIGBQcnVuZWREaXJgIHdoZW4gdGhlIHBhcmVudCBRVUFMSUZJRUQgZm9yIHJlbW92YWwgKHdoZXRoZXIgb3JcbiAqIG5vdCB0aGUgYWRhcHRlciBjb3VsZCBwZXJmb3JtIGl0IFx1MjAxNCBjYWxsZXJzIHVzZSBlbGlnaWJpbGl0eSB0byBzdXBwcmVzcyBhblxuICogZW1wdHktZm9sZGVyIHBsYWNlaG9sZGVyIHB1c2ggZm9yIHRoYXQgZGlyZWN0b3J5KSwgYHVuZGVmaW5lZGAgd2hlbiB0aGVcbiAqIHBhcmVudCB3YXMgbm90IGRlbGV0YWJsZSAobm9uLWVtcHR5LCBob2xkcyBsaXZlIGVudHJpZXMsIG1pc3NpbmcsIG9yIHJvb3QpLlxuICogUHVyZSB3aXRoIHJlc3BlY3QgdG8gdGhlIGluZGV4OiBuZXZlciBtdXRhdGVzIGl0LlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcHJ1bmVQYXJlbnRPbkRlbGV0ZShcbiAgc3RvcmFnZTogU3RvcmFnZUFkYXB0ZXIsXG4gIGluZGV4OiBMb2NhbEluZGV4LFxuICBkZWxldGVkUGF0aDogc3RyaW5nLFxuKTogUHJvbWlzZTxQcnVuZWREaXIgfCB1bmRlZmluZWQ+IHtcbiAgY29uc3QgZGlyID0gcGFyZW50UGF0aChkZWxldGVkUGF0aCk7XG4gIGlmICghKGF3YWl0IGRpcklzVmFjYW50KHN0b3JhZ2UsIGluZGV4LCBkaXIpKSkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgcmV0dXJuIHsgZGlyLCByZW1vdmVkOiBhd2FpdCByZW1vdmVWYWNhbnREaXIoc3RvcmFnZSwgZGlyKSB9O1xufVxuXG4vKiogRG93bmxvYWQsIHZlcmlmeSwgYW5kIHdyaXRlIG9uZSBibG9iLiBBIGhhc2ggbWlzbWF0Y2ggYWJvcnRzIHRoZSBwbGFuLiAqL1xuYXN5bmMgZnVuY3Rpb24gZmV0Y2hWZXJpZmllZChcbiAgc3RvcmFnZTogU3RvcmFnZUFkYXB0ZXIsXG4gIHBhdGg6IHN0cmluZyxcbiAgaGFzaDogc3RyaW5nLFxuICBmZXRjaEJsb2I6IEZldGNoQmxvYixcbik6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCBieXRlcyA9IGF3YWl0IGZldGNoQmxvYihoYXNoKTtcbiAgY29uc3QgYWN0dWFsID0gYXdhaXQgc2hhMjU2SGV4KGJ5dGVzKTtcbiAgaWYgKGFjdHVhbCAhPT0gaGFzaCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIGBCbG9iIGhhc2ggbWlzbWF0Y2ggZm9yICR7SlNPTi5zdHJpbmdpZnkocGF0aCl9OiBleHBlY3RlZCAke2hhc2h9LCBnb3QgJHthY3R1YWx9YCxcbiAgICApO1xuICB9XG4gIGF3YWl0IHN0b3JhZ2Uud3JpdGVGaWxlKHBhdGgsIGJ5dGVzKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcGVyc2lzdEluZGV4KFxuICBzdG9yYWdlOiBTdG9yYWdlQWRhcHRlcixcbiAgaW5kZXg6IExvY2FsSW5kZXgsXG4gIHN0YXRlOiBQZXJzaXN0ZWRTeW5jU3RhdGUgPSB7fSxcbik6IFByb21pc2U8dm9pZD4ge1xuICBhd2FpdCBzdG9yYWdlLndyaXRlRmlsZShcbiAgICBMT0NBTF9JTkRFWF9TVEFURV9QQVRILFxuICAgIG5ldyBUZXh0RW5jb2RlcigpLmVuY29kZShzZXJpYWxpemVMb2NhbEluZGV4KGluZGV4LCBzdGF0ZSkpLFxuICApO1xufVxuXG4vKipcbiAqIExvYWQgdGhlIHBlcnNpc3RlZCBpbmRleCBBTkQgaXRzIHN5bmMtY3Vyc29yIGJvb2trZWVwaW5nICh0aGUgY2xpZW50J3NcbiAqIHN0YXJ0dXAgcGF0aCBcdTIwMTQgdGhlIGN1cnNvciBwb3dlcnMgZGVsdGEtbWFuaWZlc3QgcmVjb25uZWN0cykuIFRocm93c1xuICogYFByb3RvY29sRXJyb3JgICh2aWEgYGRlc2VyaWFsaXplTG9jYWxTdGF0ZWApIG9uIGNvcnJ1cHQgb3IgZnV0dXJlLXNjaGVtYVxuICogc3RhdGU7IHRoZSBjbGllbnQgcmVjb3ZlcnMgYnkgcXVhcmFudGluaW5nIHRoZSBmaWxlIGFuZCByZXN5bmNpbmcgZnJvbSBhXG4gKiBmdWxsIG1hbmlmZXN0IChgY2xpZW50LnRzYCBzdGFydHVwKS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGxvYWRMb2NhbFN0YXRlKHN0b3JhZ2U6IFN0b3JhZ2VBZGFwdGVyKTogUHJvbWlzZTxEZXNlcmlhbGl6ZWRMb2NhbFN0YXRlPiB7XG4gIGNvbnN0IGJ5dGVzID0gYXdhaXQgc3RvcmFnZS5yZWFkRmlsZShMT0NBTF9JTkRFWF9TVEFURV9QQVRIKTtcbiAgcmV0dXJuIGRlc2VyaWFsaXplTG9jYWxTdGF0ZShuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUoYnl0ZXMpKTtcbn1cblxuLyoqXG4gKiBMb2FkIHRoZSBwZXJzaXN0ZWQgaW5kZXggKEFSQ0hJVEVDVFVSRSBcdTAwQTc4IHN0ZXAgMSkuIFRocm93c1xuICogYFByb3RvY29sRXJyb3JgICh2aWEgYGRlc2VyaWFsaXplTG9jYWxJbmRleGApIG9uIGNvcnJ1cHQgb3IgZnV0dXJlLXNjaGVtYVxuICogc3RhdGUgXHUyMDE0IGNhbGxlcnMgc3VyZmFjZSB0aGF0IGluc3RlYWQgb2Ygc2lsZW50bHkgcmUtc3luY2luZyBmcm9tIHNjcmF0Y2guXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBsb2FkTG9jYWxJbmRleChzdG9yYWdlOiBTdG9yYWdlQWRhcHRlcik6IFByb21pc2U8TG9jYWxJbmRleD4ge1xuICByZXR1cm4gKGF3YWl0IGxvYWRMb2NhbFN0YXRlKHN0b3JhZ2UpKS5pbmRleDtcbn1cbiIsICIvKipcbiAqIFZhdWx0IGlnbm9yZSBydWxlcyAoQVJDSElURUNUVVJFLm1kIFx1MDBBNzQsIEZSLTExL0ZSLTQyKSBcdTIwMTQgc2hhcmVkIGJ5IGV2ZXJ5XG4gKiBjbGllbnQgc28gbG9jYWwgc2NhbnMsIHdhdGNoZXJzLCBhbmQgY29tbWl0IHBhdGhzIGFncmVlIGJ5dGUtZm9yLWJ5dGUuXG4gKlxuICogTWF0Y2hpbmcgaXMgc2VnbWVudC1iYXNlZCBhbmQgY2FzZS1pbnNlbnNpdGl2ZSAodGhlIG93bmVyJ3MgcHJpbWFyeVxuICogcGxhdGZvcm1zIFx1MjAxNCBXaW5kb3dzLCBtYWNPUyBcdTIwMTQgaGF2ZSBjYXNlLWluc2Vuc2l0aXZlIGZpbGVzeXN0ZW1zLCBzb1xuICogYC5UcmFzaC9mb28ubWRgIG11c3Qgbm90IHNuZWFrIHBhc3QgdGhlIGAudHJhc2gvYCBydWxlKS5cbiAqL1xuXG5pbXBvcnQgeyBpc1dpbmRvd3NVbnNhZmVQYXRoLCBub3JtYWxpemVWYXVsdFBhdGggfSBmcm9tICcuL3BhdGhzLmpzJztcblxuLyoqIFNldHRpbmdzIHN1YnNldCBgaXNJZ25vcmVkYCBuZWVkczsgYFZhdWx0U2V0dGluZ3NgIHNhdGlzZmllcyBpdC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSWdub3JlU2V0dGluZ3Mge1xuICBvYnNpZGlhblN5bmM6IGJvb2xlYW47XG4gIC8qKlxuICAgKiBVc2VyLWRlZmluZWQgZXh0cmEgaWdub3JlIHBhdHRlcm5zIChjbGllbnQtc2lkZSBvbmx5KS4gR2xvYi1saXRlIHN5bnRheDpcbiAgICogYCpgIG1hdGNoZXMgd2l0aGluIG9uZSBwYXRoIHNlZ21lbnQsIGEgd2hvbGUgYCoqYCBzZWdtZW50IHNwYW5zIGFueVxuICAgKiBudW1iZXIgb2Ygc2VnbWVudHMsIG1hdGNoaW5nIGlzIGNhc2UtaW5zZW5zaXRpdmUuIEEgcGF0dGVybiBjb250YWluaW5nXG4gICAqIGAvYCBpcyBhbmNob3JlZCBhdCB0aGUgdmF1bHQgcm9vdCAoYHByaXZhdGUvKipgKTsgYSBiYXJlIHBhdHRlcm4gd2l0aG91dFxuICAgKiBgL2AgbWF0Y2hlcyBhIGZpbGUgTkFNRSBhdCBhbnkgZGVwdGggKGAqLnRtcGApLiBFbXB0eSBsaW5lcyBhcmUgaWdub3JlZC5cbiAgICovXG4gIGV4dHJhSWdub3Jlcz86IHJlYWRvbmx5IHN0cmluZ1tdO1xufVxuXG4vKiogSWdub3JlZCB3aGVyZXZlciB0aGV5IGFwcGVhciwgYXMgYW55IHBhdGggc2VnbWVudCAoZGlyIG9yIGZpbGUgbmFtZSkuICovXG5jb25zdCBBTFdBWVNfSUdOT1JFRF9TRUdNRU5UUzogUmVhZG9ubHlTZXQ8c3RyaW5nPiA9IG5ldyBTZXQoW1xuICAnLnRyYXNoJywgLy8gbG9jYWwgZGVsZXRlLXJlY292ZXJ5IGRpciAoRlItNDIpXG4gICcuZHNfc3RvcmUnLFxuICAnLnZhdWx0c3luY2ZvcmFnZW50cycsIC8vIGNsaWVudCBzdGF0ZSBkaXIgKGxvY2FsIGluZGV4KSBpbnNpZGUgdGhlIHZhdWx0XG4gICd0aHVtYnMuZGInLFxuXSk7XG5cbi8qKiBgLm9ic2lkaWFuL2AgZmlsZXMgZXhjbHVkZWQgZXZlbiB3aGVuIGAub2JzaWRpYW4vYCBzeW5jIGlzIG9wdGVkIGluLiAqL1xuY29uc3QgT0JTSURJQU5fVk9MQVRJTEVfRklMRVM6IFJlYWRvbmx5U2V0PHN0cmluZz4gPSBuZXcgU2V0KFtcbiAgJy5vYnNpZGlhbi93b3Jrc3BhY2UuanNvbicsXG4gICcub2JzaWRpYW4vd29ya3NwYWNlLW1vYmlsZS5qc29uJyxcbl0pO1xuXG4vKipcbiAqIFdoZXRoZXIgYHZhdWx0UGF0aGAgbXVzdCBiZSBleGNsdWRlZCBmcm9tIHN5bmMuXG4gKlxuICogQWx3YXlzIGlnbm9yZWQ6IGAudHJhc2gvYCwgYC5EU19TdG9yZWAsIGBUaHVtYnMuZGJgLCBgLnZhdWx0c3luY2ZvcmFnZW50cy9gXG4gKiAoYW55IGRlcHRoKSwgYW5kIFdpbmRvd3MtdW5zYWZlIG5hbWVzIChyZXNlcnZlZCBkZXZpY2UgbmFtZXMsIHRyYWlsaW5nXG4gKiBkb3Qvc3BhY2UgXHUyMDE0IHRoZXkgY2FuIG5ldmVyIGJlIG1hdGVyaWFsaXplZCBvbiBhIFdpbmRvd3MgcGVlciwgc2VlXG4gKiBgcGF0aHMudHNgKS4gYC5vYnNpZGlhbi9gIGlzIGlnbm9yZWQgZW50aXJlbHkgd2hlbiBgc2V0dGluZ3Mub2JzaWRpYW5TeW5jYFxuICogaXMgZmFsc2U7IHdoZW4gdHJ1ZSwgZXZlcnl0aGluZyB1bmRlciBpdCBzeW5jcyBleGNlcHQgYHdvcmtzcGFjZS5qc29uYCxcbiAqIGB3b3Jrc3BhY2UtbW9iaWxlLmpzb25gLCBhbmQgYC5vYnNpZGlhbi9jYWNoZS9gLiBGaW5hbGx5LCBldmVyeSBwYXR0ZXJuIGluXG4gKiBgc2V0dGluZ3MuZXh0cmFJZ25vcmVzYCBpcyBtYXRjaGVkIChnbG9iLWxpdGUgXHUyMDE0IHNlZSBgSWdub3JlU2V0dGluZ3NgKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzSWdub3JlZCh2YXVsdFBhdGg6IHN0cmluZywgc2V0dGluZ3M6IElnbm9yZVNldHRpbmdzKTogYm9vbGVhbiB7XG4gIGlmIChpc1dpbmRvd3NVbnNhZmVQYXRoKHZhdWx0UGF0aCkpIHJldHVybiB0cnVlO1xuICBjb25zdCBub3JtYWxpemVkID0gbm9ybWFsaXplVmF1bHRQYXRoKHZhdWx0UGF0aCk7XG4gIGlmIChub3JtYWxpemVkID09PSAnLycpIHJldHVybiBmYWxzZTtcblxuICBjb25zdCBsb3dlciA9IG5vcm1hbGl6ZWQuc2xpY2UoMSkudG9Mb3dlckNhc2UoKTtcbiAgY29uc3Qgc2VnbWVudHMgPSBsb3dlci5zcGxpdCgnLycpO1xuXG4gIGlmIChzZWdtZW50cy5zb21lKChzZWdtZW50KSA9PiBBTFdBWVNfSUdOT1JFRF9TRUdNRU5UUy5oYXMoc2VnbWVudCkpKSB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICBpZiAoc2VnbWVudHNbMF0gPT09ICcub2JzaWRpYW4nKSB7XG4gICAgaWYgKCFzZXR0aW5ncy5vYnNpZGlhblN5bmMpIHJldHVybiB0cnVlO1xuICAgIGlmIChPQlNJRElBTl9WT0xBVElMRV9GSUxFUy5oYXMobG93ZXIpKSByZXR1cm4gdHJ1ZTtcbiAgICBpZiAoc2VnbWVudHNbMV0gPT09ICdjYWNoZScpIHJldHVybiB0cnVlOyAvLyB0aGUgZGlyIGl0c2VsZiBhbmQgYW55dGhpbmcgdW5kZXIgaXRcbiAgfVxuXG4gIGNvbnN0IGV4dHJhcyA9IHNldHRpbmdzLmV4dHJhSWdub3JlcztcbiAgaWYgKGV4dHJhcyAhPT0gdW5kZWZpbmVkICYmIGV4dHJhcy5sZW5ndGggPiAwKSB7XG4gICAgZm9yIChjb25zdCBwYXR0ZXJuIG9mIGV4dHJhcykge1xuICAgICAgY29uc3QgY29tcGlsZWQgPSBjb21waWxlRXh0cmFJZ25vcmUocGF0dGVybik7XG4gICAgICBpZiAoY29tcGlsZWQgIT09IG51bGwgJiYgbWF0Y2hlc1NlZ21lbnRzKGNvbXBpbGVkLCBzZWdtZW50cykpIHJldHVybiB0cnVlO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBmYWxzZTtcbn1cblxuLy8gLS0tIGV4dHJhIGlnbm9yZSBwYXR0ZXJucyAoZ2xvYi1saXRlKSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIEEgY29tcGlsZWQgZXh0cmEtaWdub3JlIHBhdHRlcm46IGxvd2VyY2FzZWQsIGAvYC1zcGxpdCBzZWdtZW50cy4gKi9cbnR5cGUgQ29tcGlsZWRQYXR0ZXJuID0geyBzZWdtZW50czogcmVhZG9ubHkgc3RyaW5nW107IGFuY2hvcmVkOiBib29sZWFuIH07XG5cbi8qKlxuICogTm9ybWFsaXplIG9uZSB1c2VyIHBhdHRlcm4gaW50byBtYXRjaGFibGUgc2VnbWVudHMuIFJldHVybnMgYG51bGxgIGZvclxuICogYmxhbmsgcGF0dGVybnMgKHRoZXkgY2FuIG5ldmVyIG1hdGNoIFx1MjAxNCBhbmQgbXVzdCBub3QgYmVjb21lIFwiaWdub3JlXG4gKiBldmVyeXRoaW5nXCIgYnkgYWNjaWRlbnQpLiBBIGxlYWRpbmcvdHJhaWxpbmcgYC9gIGlzIHRvbGVyYXRlZCBhbmQgc3RyaXBwZWQ7XG4gKiBgYW5jaG9yZWRgIHJlY29yZHMgd2hldGhlciB0aGUgcGF0dGVybiBuYW1lcyBhIHBhdGggKG1hdGNoZWQgZnJvbSB0aGVcbiAqIHZhdWx0IHJvb3QpIG9yIGEgYmFyZSBuYW1lIChtYXRjaGVkIGFnYWluc3QgYW55IHN1ZmZpeCBvZiB0aGUgcGF0aCkuXG4gKi9cbmZ1bmN0aW9uIGNvbXBpbGVFeHRyYUlnbm9yZShwYXR0ZXJuOiBzdHJpbmcpOiBDb21waWxlZFBhdHRlcm4gfCBudWxsIHtcbiAgbGV0IGNsZWFuZWQgPSBwYXR0ZXJuLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICB3aGlsZSAoY2xlYW5lZC5zdGFydHNXaXRoKCcvJykpIGNsZWFuZWQgPSBjbGVhbmVkLnNsaWNlKDEpO1xuICB3aGlsZSAoY2xlYW5lZC5lbmRzV2l0aCgnLycpKSBjbGVhbmVkID0gY2xlYW5lZC5zbGljZSgwLCAtMSk7XG4gIGlmIChjbGVhbmVkID09PSAnJykgcmV0dXJuIG51bGw7XG4gIHJldHVybiB7IHNlZ21lbnRzOiBjbGVhbmVkLnNwbGl0KCcvJyksIGFuY2hvcmVkOiBjbGVhbmVkLmluY2x1ZGVzKCcvJykgfTtcbn1cblxuLyoqIFBhdHRlcm4gdnMgcGF0aCBzZWdtZW50czsgYGFuY2hvcmVkYCBwYXR0ZXJucyBtYXkgYWxzbyBzdGFydCBkZWVwZXIuICovXG5mdW5jdGlvbiBtYXRjaGVzU2VnbWVudHMocGF0dGVybjogQ29tcGlsZWRQYXR0ZXJuLCBwYXRoOiByZWFkb25seSBzdHJpbmdbXSk6IGJvb2xlYW4ge1xuICBpZiAocGF0dGVybi5hbmNob3JlZCkge1xuICAgIHJldHVybiBzZWdtZW50c01hdGNoKHBhdHRlcm4uc2VnbWVudHMsIHBhdGgpO1xuICB9XG4gIC8vIEJhcmUgbmFtZSBwYXR0ZXJuOiBtYXRjaCBhbnkgdHJhaWxpbmcgc2VnbWVudCBydW4gKGAqLnRtcGAgYXQgYW55IGRlcHRoKS5cbiAgZm9yIChsZXQgc3RhcnQgPSAwOyBzdGFydCA8IHBhdGgubGVuZ3RoOyBzdGFydCsrKSB7XG4gICAgaWYgKHNlZ21lbnRzTWF0Y2gocGF0dGVybi5zZWdtZW50cywgcGF0aC5zbGljZShzdGFydCkpKSByZXR1cm4gdHJ1ZTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKiBHbG9iLWxpdGUgc2VnbWVudCBtYXRjaGluZzogYCpgIGluc2lkZSBhIHNlZ21lbnQsIGAqKmAgYXMgYSB3aG9sZSBzZWdtZW50LiAqL1xuZnVuY3Rpb24gc2VnbWVudHNNYXRjaChwYXR0ZXJuOiByZWFkb25seSBzdHJpbmdbXSwgcGF0aDogcmVhZG9ubHkgc3RyaW5nW10pOiBib29sZWFuIHtcbiAgaWYgKHBhdHRlcm4ubGVuZ3RoID09PSAwKSByZXR1cm4gcGF0aC5sZW5ndGggPT09IDA7XG4gIGNvbnN0IGhlYWQgPSBwYXR0ZXJuWzBdO1xuICBjb25zdCByZXN0ID0gcGF0dGVybi5zbGljZSgxKTtcbiAgaWYgKGhlYWQgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHBhdGgubGVuZ3RoID09PSAwO1xuICBpZiAoaGVhZCA9PT0gJyoqJykge1xuICAgIC8vIGAqKmAgY29uc3VtZXMgemVybyBvciBtb3JlIHBhdGggc2VnbWVudHMuXG4gICAgZm9yIChsZXQgc2tpcCA9IDA7IHNraXAgPD0gcGF0aC5sZW5ndGg7IHNraXArKykge1xuICAgICAgaWYgKHNlZ21lbnRzTWF0Y2gocmVzdCwgcGF0aC5zbGljZShza2lwKSkpIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgaWYgKHBhdGgubGVuZ3RoID09PSAwIHx8ICFzZWdtZW50TWF0Y2goaGVhZCwgcGF0aFswXSEpKSByZXR1cm4gZmFsc2U7XG4gIHJldHVybiBzZWdtZW50c01hdGNoKHJlc3QsIHBhdGguc2xpY2UoMSkpO1xufVxuXG4vKiogT25lIHNlZ21lbnQ6IGxpdGVyYWwgdGV4dCB3aXRoIGAqYCB3aWxkY2FyZHMgKGFueSBydW4gd2l0aGluIHRoZSBzZWdtZW50KS4gKi9cbmZ1bmN0aW9uIHNlZ21lbnRNYXRjaChwYXR0ZXJuOiBzdHJpbmcsIHNlZ21lbnQ6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBpZiAoIXBhdHRlcm4uaW5jbHVkZXMoJyonKSkgcmV0dXJuIHBhdHRlcm4gPT09IHNlZ21lbnQ7XG4gIGNvbnN0IGZpcnN0ID0gcGF0dGVybi5pbmRleE9mKCcqJyk7XG4gIGNvbnN0IGxhc3QgPSBwYXR0ZXJuLmxhc3RJbmRleE9mKCcqJyk7XG4gIGlmICghc2VnbWVudC5zdGFydHNXaXRoKHBhdHRlcm4uc2xpY2UoMCwgZmlyc3QpKSkgcmV0dXJuIGZhbHNlO1xuICBpZiAoIXNlZ21lbnQuZW5kc1dpdGgocGF0dGVybi5zbGljZShsYXN0ICsgMSkpKSByZXR1cm4gZmFsc2U7XG4gIGxldCBpbmRleCA9IGZpcnN0O1xuICBmb3IgKGNvbnN0IG1pZGRsZSBvZiBwYXR0ZXJuLnNsaWNlKGZpcnN0LCBsYXN0ICsgMSkuc3BsaXQoJyonKS5zbGljZSgxLCAtMSkpIHtcbiAgICBjb25zdCBmb3VuZCA9IHNlZ21lbnQuaW5kZXhPZihtaWRkbGUsIGluZGV4KTtcbiAgICBpZiAoZm91bmQgPT09IC0xKSByZXR1cm4gZmFsc2U7XG4gICAgaW5kZXggPSBmb3VuZCArIG1pZGRsZS5sZW5ndGg7XG4gIH1cbiAgcmV0dXJuIHRydWU7XG59XG4iLCAiLyoqXG4gKiBUeXBlZCBXZWJTb2NrZXQgbWVzc2FnZSBkZWZpbml0aW9ucyBmb3IgdGhlIGAvc3luY2AgY2hhbm5lbFxuICogKEFSQ0hJVEVDVFVSRS5tZCBcdTAwQTc1KS4gQWxsIG1lc3NhZ2VzIGFyZSBKU09OIHdpdGggYSBgdHlwZWAgZGlzY3JpbWluYW50LlxuICpcbiAqIFR3byBjaGFubmVscyBleGlzdDogdGhpcyBXUyBwcm90b2NvbCAobWV0YWRhdGEgKyBjaGFuZ2UgZmVlZCkgYW5kIHBsYWluXG4gKiBIVFRQUyBibG9iIHJvdXRlcyAoYEdFVC9QVVQgL2Jsb2IvOmhhc2hgKSBmb3IgY29udGVudCBcdTIwMTQgcmVmZXJlbmNlZCBoZXJlXG4gKiBvbmx5IHZpYSBjb250ZW50IGhhc2hlcy5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IExvZ2ljYWxDbG9jaywgVmVyc2lvbiwgVmVyc2lvbktpbmQsIFZhdWx0U2V0dGluZ3MgfSBmcm9tICcuL3R5cGVzLmpzJztcbmltcG9ydCB7IFByb3RvY29sRXJyb3IgfSBmcm9tICcuL2Vycm9ycy5qcyc7XG5cbi8qKiBXaXJlIHByb3RvY29sIHZlcnNpb24uIEJ1bXAgb24gYnJlYWtpbmcgbWVzc2FnZS1zaGFwZSBjaGFuZ2VzLiAqL1xuZXhwb3J0IGNvbnN0IFByb3RvY29sVmVyc2lvbiA9IDEgYXMgY29uc3Q7XG5cbi8qKiBDb21taXRzIGF0IG9yIGJlbG93IHRoaXMgc2l6ZSBtYXkgaW5saW5lIGNvbnRlbnQgKGJhc2U2NCkgb24gdGhlIFdTLiAqL1xuZXhwb3J0IGNvbnN0IElOTElORV9DT05URU5UX01BWF9CWVRFUyA9IDI1NiAqIDEwMjQ7XG5cbi8qKlxuICogT25lIGVudHJ5IG9mIHRoZSBtYW5pZmVzdCBtYXAgKGB7cGF0aCBcdTIxOTIgTWFuaWZlc3RFbnRyeX1gKS4gVGhlIGVudHJ5IGlzXG4gKiBzZWxmLWRlc2NyaWJpbmc6IGl0IGNhcnJpZXMgaXRzIG93biBgcGF0aGAgYW5kIHRoZSBoZWFkJ3MgYGNsb2NrYCBzbyB0aGVcbiAqIGNsaWVudC1zaWRlIHJlY29uY2lsaWF0aW9uIChgcmVzb2x2ZS50c2ApIGNhbiBvcmRlciByZW1vdGUgc3RhdGUgYWdhaW5zdFxuICogbG9jYWwgc3RhdGUgd2l0aG91dCBhbnkgZXh0cmEgcm91bmQtdHJpcHMuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgTWFuaWZlc3RFbnRyeSB7XG4gIC8qKiBOb3JtYWxpemVkIHZhdWx0IHBhdGggdGhpcyBlbnRyeSBkZXNjcmliZXMgKG1pcnJvcnMgdGhlIG1hcCBrZXkpLiAqL1xuICBwYXRoOiBzdHJpbmc7XG4gIC8qKiBWZXJzaW9uIGlkIG9mIHRoZSBlbnRyeSdzIGhlYWQuICovXG4gIHZlcnNpb246IHN0cmluZztcbiAgLyoqIHNoYTI1NiBoZXggb2YgY3VycmVudCBjb250ZW50IChgJydgIGZvciBmb2xkZXIgcGxhY2Vob2xkZXJzKS4gKi9cbiAgaGFzaDogc3RyaW5nO1xuICAvKiogQ29udGVudCBzaXplIGluIGJ5dGVzIChgMGAgZm9yIGZvbGRlciBwbGFjZWhvbGRlcnMpLiAqL1xuICBzaXplOiBudW1iZXI7XG4gIC8qKiBUb21ic3RvbmUgZmxhZy4gKi9cbiAgZGVsZXRlZDogYm9vbGVhbjtcbiAgLyoqIExvZ2ljYWwgY2xvY2sgb2YgdGhlIGhlYWQgXHUyMDE0IHRoZSBvcmRlcmluZyBhdXRob3JpdHkgKFx1MDBBNzQpLiAqL1xuICBjbG9jazogTG9naWNhbENsb2NrO1xuICAvKiogVHJ1ZSBmb3IgZW1wdHktZm9sZGVyIHBsYWNlaG9sZGVyIGVudHJpZXMgKEZSLTEwKS4gKi9cbiAgaXNGb2xkZXI/OiBib29sZWFuO1xuICAvKiogRXBvY2ggbXMgb2YgbGFzdCB1cGRhdGUsIGRpc3BsYXktb25seS4gKi9cbiAgbXRpbWU6IG51bWJlcjtcbn1cblxuLy8gLS0tIENsaWVudCBcdTIxOTIgU2VydmVyIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIEF1dGggKyBjYXRjaC11cDogdG9rZW4sIHByb3RvY29sIHZlcnNpb24sIGxhc3Qgc2VlbiBETyBzZXF1ZW5jZSBudW1iZXIuICovXG5leHBvcnQgaW50ZXJmYWNlIEhlbGxvTWVzc2FnZSB7XG4gIHR5cGU6ICdoZWxsbyc7XG4gIHRva2VuOiBzdHJpbmc7XG4gIHByb3RvY29sVmVyc2lvbjogbnVtYmVyO1xuICAvKiogTGFzdCBzZWVuIGdsb2JhbCBzZXF1ZW5jZSBudW1iZXI7IDAgZm9yIGEgZmlyc3QtZXZlciBjb25uZWN0LiAqL1xuICBjdXJzb3I6IG51bWJlcjtcbn1cblxuLyoqIFJlcXVlc3QgZnVsbCAoYHNpbmNlYCBvbWl0dGVkKSBvciBkZWx0YSBtYW5pZmVzdC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgR2V0TWFuaWZlc3RNZXNzYWdlIHtcbiAgdHlwZTogJ2dldE1hbmlmZXN0JztcbiAgc2luY2U/OiBudW1iZXI7XG59XG5cbi8qKlxuICogQ29tbWl0IGEgbmV3IHZlcnNpb24uIElmIGBpbmxpbmVgIGlzIHNldCBpdCBjYXJyaWVzIHRoZSBmdWxsIGNvbnRlbnRcbiAqIGJhc2U2NC1lbmNvZGVkIChvbmx5IGFsbG93ZWQgd2hlbiBgc2l6ZSA8PSBJTkxJTkVfQ09OVEVOVF9NQVhfQllURVNgKTtcbiAqIG90aGVyd2lzZSB0aGUgYmxvYiBtdXN0IGFscmVhZHkgYmUgdXBsb2FkZWQgKGBwdXRCbG9iYCBvbiB0aGlzIGNoYW5uZWwsXG4gKiBgUFVUIC9ibG9iLzpoYXNoYCBvbiB0aGUgcmVhbCB3b3JrZXIpLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIENvbW1pdE1lc3NhZ2Uge1xuICB0eXBlOiAnY29tbWl0JztcbiAgcGF0aDogc3RyaW5nO1xuICAvKiogVmVyc2lvbiBpZCB0aGUgY29tbWl0IGJ1aWxkcyBvbjsgc2VydmVyIGRldGVjdHMgZGl2ZXJnZW5jZSBcdTIxOTIgY29uZmxpY3QuICovXG4gIHBhcmVudFZlcnNpb246IHN0cmluZyB8IG51bGw7XG4gIGhhc2g6IHN0cmluZztcbiAgc2l6ZTogbnVtYmVyO1xuICAvKiogV2hhdCBraW5kIG9mIHZlcnNpb24gdGhpcyBjb21taXRzIChtaXJyb3JzIGBWZXJzaW9uLmtpbmRgKS4gKi9cbiAga2luZDogVmVyc2lvbktpbmQ7XG4gIGlubGluZT86IHN0cmluZztcbiAgLyoqIFNvdXJjZSBwYXRoIFx1MjAxNCByZXF1aXJlZCBmb3IgYGtpbmQ6ICdyZW5hbWUnYCAoY2hhaW4gbWlncmF0aW9uLCBGUi05KS4gKi9cbiAgZnJvbVBhdGg/OiBzdHJpbmc7XG4gIC8qKiBUcnVlIGZvciBlbXB0eS1mb2xkZXIgcGxhY2Vob2xkZXIgY29tbWl0cyAoRlItMTA7IGhhc2ggYCcnYCwgc2l6ZSAwKS4gKi9cbiAgaXNGb2xkZXI/OiBib29sZWFuO1xufVxuXG4vKiogS2VlcGFsaXZlLiAqL1xuZXhwb3J0IGludGVyZmFjZSBQaW5nTWVzc2FnZSB7XG4gIHR5cGU6ICdwaW5nJztcbiAgLyoqIENsaWVudCBlcG9jaCBtczsgZWNob2VkIGJhY2sgb24gYHBvbmdgIGZvciBSVFQgLyBza2V3IG1lYXN1cmVtZW50LiAqL1xuICB0cz86IG51bWJlcjtcbn1cblxuLyoqXG4gKiBVcGxvYWQgYSBjb250ZW50IGJsb2Igb3ZlciB0aGUgc3luYyBjaGFubmVsLiBUZXN0IGRvdWJsZXMgYW5kIHNtYWxsIHZhdWx0c1xuICogY2FuIHVzZSB0aGlzIGRpcmVjdGx5OyB0aGUgcmVhbCB3b3JrZXIgZXhwb3NlcyB0aGUgc2FtZSBvcGVyYXRpb24gYXNcbiAqIGBQVVQgL2Jsb2IvOmhhc2hgIChzdHJlYW1lZCkuIElkZW1wb3RlbnQ6IHNhbWUgaGFzaCBcdTIxRDIgc2FtZSBjb250ZW50LlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFB1dEJsb2JNZXNzYWdlIHtcbiAgdHlwZTogJ3B1dEJsb2InO1xuICBoYXNoOiBzdHJpbmc7XG4gIC8qKiBGdWxsIGNvbnRlbnQsIGJhc2U2NC1lbmNvZGVkLiAqL1xuICBjb250ZW50OiBzdHJpbmc7XG59XG5cbi8qKiBGZXRjaCBhIGNvbnRlbnQgYmxvYiAodGhlIFdTLWlubGluZSBwYXRoIG9mIFx1MDBBNzggXCJmZXRjaCBibG9iXCIpLiAqL1xuZXhwb3J0IGludGVyZmFjZSBHZXRCbG9iTWVzc2FnZSB7XG4gIHR5cGU6ICdnZXRCbG9iJztcbiAgaGFzaDogc3RyaW5nO1xufVxuXG4vKipcbiAqIFNuYXBzaG90IGV2ZXJ5IGZpbGUgaGVhZCBhdCBhIG1vbWVudCAoYSB3aG9sZS12YXVsdCByZXN0b3JlIHBvaW50KS4gVGhlXG4gKiBzZXJ2ZXIgcmVjb3JkcyB0aGUgaGVhZCBzdGF0ZSBhdG9taWNhbGx5OyBzbmFwc2hvdHMgYXJlIG5ldmVyIGJyb2FkY2FzdCBcdTIwMTRcbiAqIG90aGVyIGRldmljZXMgbGVhcm4gbm90aGluZyBsaXZlLCB0aGUgbGlzdCBpcyBwdWxsLWJhc2VkLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFNuYXBzaG90Q3JlYXRlTWVzc2FnZSB7XG4gIHR5cGU6ICdzbmFwc2hvdENyZWF0ZSc7XG4gIC8qKiBPcHRpb25hbCBsYWJlbDsgb21pdHRlZC9lbXB0eSBcdTIxRDIgdW5uYW1lZC4gKi9cbiAgbmFtZT86IHN0cmluZztcbn1cblxuLyoqIFJlc3RvcmUgdGhlIHdob2xlIHZhdWx0IHRvIGEgc25hcHNob3QgKEZSLTc6IGFzIE5FVyB2ZXJzaW9ucyBcdTIwMTQgaGlzdG9yeSBpcyBuZXZlciBkZWxldGVkKS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU25hcHNob3RSZXN0b3JlTWVzc2FnZSB7XG4gIHR5cGU6ICdzbmFwc2hvdFJlc3RvcmUnO1xuICAvKiogU25hcHNob3QgaWQgKGFzIHJldHVybmVkIGJ5IGBzbmFwc2hvdENyZWF0ZUFja2AgLyBsaXN0ZWQgYnkgdGhlIHNlcnZlcikuICovXG4gIGlkOiBzdHJpbmc7XG59XG5cbi8vIC0tLSBTZXJ2ZXIgXHUyMTkyIENsaWVudCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBTdWNjZXNzZnVsIGhlbGxvOiB0aGlzIGRldmljZSdzIGlkZW50aXR5ICsgdmF1bHQtbGV2ZWwgaW5mby4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSGVsbG9BY2tNZXNzYWdlIHtcbiAgdHlwZTogJ2hlbGxvQWNrJztcbiAgZGV2aWNlSWQ6IHN0cmluZztcbiAgdmF1bHROYW1lOiBzdHJpbmc7XG4gIHNldHRpbmdzOiBWYXVsdFNldHRpbmdzO1xuICAvKipcbiAgICogTG93ZXN0IGNoYW5nZS1ldmVudCBzZXF1ZW5jZSBudW1iZXIgdGhlIHNlcnZlciBzdGlsbCByZXRhaW5zIChwcm90b2NvbFxuICAgKiB2MSwgcHJlLXJlbGVhc2U7IG9wdGlvbmFsIHNvIG9sZGVyIHNlcnZlcnMgY2FuIGJlIGFuc3dlcmVkIHdpdGggYSBmdWxsXG4gICAqIG1hbmlmZXN0KS4gQSBjbGllbnQgd2hvc2UgY3Vyc29yIHNhdGlzZmllc1xuICAgKiBgb2xkZXN0UmV0YWluZWRTZXEgPD0gY3Vyc29yICsgMWAgY2FuIHJlcXVlc3QgYSBkZWx0YSBtYW5pZmVzdCBcdTIwMTQgZXZlcnlcbiAgICogZXZlbnQgYWZ0ZXIgaXRzIGN1cnNvciBpcyBzdGlsbCByZXBsYXlhYmxlLCBzbyBpdHMgaW5kZXggaXMgZ3VhcmFudGVlZFxuICAgKiB0byBvbmx5IG1pc3MgaGVhZHMgd2l0aCBgaGVhZF9zZXEgPiBjdXJzb3JgLiBBYnNlbnQgKG9yIGA+IGN1cnNvciArIDFgKVxuICAgKiBcdTIxRDIgdGhlIGNsaWVudCBtdXN0IGZhbGwgYmFjayB0byBhIGZ1bGwgbWFuaWZlc3QuXG4gICAqL1xuICBvbGRlc3RSZXRhaW5lZFNlcT86IG51bWJlcjtcbiAgLyoqXG4gICAqIFRoZSBzZXJ2ZXIncyBvd24gcmVsZWFzZSB2ZXJzaW9uICh0aGUgd29ya2VyJ3MgcGFja2FnZSB2ZXJzaW9uKS5cbiAgICogT3B0aW9uYWwgYmVjYXVzZSBzZXJ2ZXJzIFx1MjI2NCAwLjEgcHJlZGF0ZSB2ZXJzaW9uIHJlcG9ydGluZyBhbmQgb21pdCBpdCBcdTIwMTRcbiAgICogY2xpZW50cyB0cmVhdCBhYnNlbmNlIGFzIFwibGVnYWN5IHNlcnZlclwiIChzZWUgYGNvbXBhdC50c2ApLCBuZXZlciBhcyBhXG4gICAqIHByb3RvY29sIGZhaWx1cmUuXG4gICAqL1xuICBzZXJ2ZXJWZXJzaW9uPzogc3RyaW5nO1xufVxuXG4vKiogUmVwbHkgdG8gYGdldE1hbmlmZXN0YDogdGhlIChwb3NzaWJseSBkZWx0YSkgZmlsZSBpbmRleC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgTWFuaWZlc3RNZXNzYWdlIHtcbiAgdHlwZTogJ21hbmlmZXN0JztcbiAgZW50cmllczogUmVhZG9ubHk8UmVjb3JkPHN0cmluZywgTWFuaWZlc3RFbnRyeT4+O1xuICAvKiogR2xvYmFsIHNlcXVlbmNlIG51bWJlciB0aGlzIG1hbmlmZXN0IHJlZmxlY3RzIChjdXJzb3IgY2F0Y2gtdXApLiAqL1xuICBjdXJzb3I6IG51bWJlcjtcbn1cblxuLyoqIENvbW1pdCBhY2NlcHRlZCBhcyB0aGUgbmV3IGhlYWQuICovXG5leHBvcnQgaW50ZXJmYWNlIENvbW1pdEFja01lc3NhZ2Uge1xuICB0eXBlOiAnY29tbWl0QWNrJztcbiAgLyoqIFZlcnNpb24gaWQgYXNzaWduZWQgYnkgdGhlIGF1dGhvcml0eS4gKi9cbiAgdmVyc2lvbjogc3RyaW5nO1xuICAvKiogTG9naWNhbCBjbG9jayBvZiB0aGUgYWNjZXB0ZWQgdmVyc2lvbi4gKi9cbiAgY2xvY2s6IExvZ2ljYWxDbG9jaztcbiAgLyoqIEdsb2JhbCBzZXF1ZW5jZSBudW1iZXIgb2YgdGhlIGFjY2VwdGVkIGhlYWQgKGN1cnNvciB0cmFja2luZykuICovXG4gIHNlcTogbnVtYmVyO1xufVxuXG4vKiogV2hhdCBoYXBwZW5lZCB0byB0aGUgbG9zaW5nIHNpZGUgb2YgYSBjb25jdXJyZW50IGVkaXQgKHNlZSBkaXNwb3NpdGlvbikuICovXG5leHBvcnQgdHlwZSBDb25mbGljdExvc2VyRGlzcG9zaXRpb24gPSAnY29uZmxpY3RDb3B5JztcblxuLyoqIENvbW1pdCBsb3N0IHRoZSByYWNlOyB0aGUgc2VydmVyJ3MgY2hvc2VuIHdpbm5lciBzdGFuZHMuICovXG5leHBvcnQgaW50ZXJmYWNlIENvbmZsaWN0TWVzc2FnZSB7XG4gIHR5cGU6ICdjb25mbGljdCc7XG4gIC8qKiBUaGUgd2lubmluZyB2ZXJzaW9uICh0aGlzIGNvbW1pdCBvciB0aGUgY29uY3VycmVudCBvbmUpLiAqL1xuICB3aW5uZXI6IFZlcnNpb247XG4gIC8qKiBXaGF0IHRoZSBzZXJ2ZXIgZGlkIHdpdGggdGhlIGxvc2VyJ3MgY29udGVudCBcdTIwMTQgbmV2ZXIgZGVsZXRlZC4gKi9cbiAgbG9zZXJEaXNwb3NpdGlvbjogQ29uZmxpY3RMb3NlckRpc3Bvc2l0aW9uO1xuICAvKiogR2xvYmFsIHNlcXVlbmNlIG51bWJlciBvZiB0aGUgd2lubmluZyBoZWFkLCB3aGVuIGl0IGhhcyBvbmUuICovXG4gIHNlcT86IG51bWJlcjtcbn1cblxuLyoqXG4gKiBGYW4tb3V0IHBheWxvYWQgc2hhcmVkIGJ5IHRoZSBjaGFuZ2UgYnJvYWRjYXN0IGFuZCB0aGUgYXJiaXRyYXRpb24gcmVzdWx0LlxuICogRXZlcnl0aGluZyBhIGNsaWVudCBuZWVkcyB0byBtYXRlcmlhbGl6ZSBvbmUgaGVhZCB0cmFuc2l0aW9uLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIENoYW5nZVBheWxvYWQge1xuICBwYXRoOiBzdHJpbmc7XG4gIC8qKiBWZXJzaW9uIGlkIG9mIHRoZSBuZXcgaGVhZC4gKi9cbiAgdmVyc2lvbjogc3RyaW5nO1xuICBoYXNoOiBzdHJpbmc7XG4gIHNpemU6IG51bWJlcjtcbiAgZGVsZXRlZDogYm9vbGVhbjtcbiAgLyoqIElkIG9mIHRoZSBkZXZpY2UgdGhhdCBjb21taXR0ZWQuICovXG4gIGRldmljZTogc3RyaW5nO1xuICAvKiogTG9naWNhbCBjbG9jayBvZiB0aGUgbmV3IGhlYWQgXHUyMDE0IGNsaWVudHMgdXNlIGl0IHRvIHNraXAgc3RhbGUgcmVwbGF5cy4gKi9cbiAgY2xvY2s6IExvZ2ljYWxDbG9jaztcbiAgLyoqIFdoYXQga2luZCBvZiBjaGFuZ2UgdGhpcyBpcyAobWlycm9ycyBgVmVyc2lvbi5raW5kYCkuICovXG4gIGtpbmQ6IFZlcnNpb25LaW5kO1xuICAvKiogU291cmNlIHBhdGggXHUyMDE0IHByZXNlbnQgd2hlbiBga2luZDogJ3JlbmFtZSdgLiAqL1xuICBmcm9tUGF0aD86IHN0cmluZztcbiAgLyoqIFRydWUgZm9yIGZvbGRlciBwbGFjZWhvbGRlciBjaGFuZ2VzIChGUi0xMCkuICovXG4gIGlzRm9sZGVyPzogYm9vbGVhbjtcbn1cblxuLyoqIEZhbi1vdXQgYnJvYWRjYXN0IHRvIGFsbCAqb3RoZXIqIGNvbm5lY3RlZCBjbGllbnRzLiAqL1xuZXhwb3J0IGludGVyZmFjZSBDaGFuZ2VNZXNzYWdlIGV4dGVuZHMgQ2hhbmdlUGF5bG9hZCB7XG4gIHR5cGU6ICdjaGFuZ2UnO1xuICAvKiogR2xvYmFsIHNlcXVlbmNlIG51bWJlciBvZiB0aGlzIGNoYW5nZSAoY3Vyc29yIHRyYWNraW5nKS4gKi9cbiAgc2VxOiBudW1iZXI7XG59XG5cbi8qKiBSZXBseSB0byBgcHV0QmxvYmAuICovXG5leHBvcnQgaW50ZXJmYWNlIEJsb2JBY2tNZXNzYWdlIHtcbiAgdHlwZTogJ2Jsb2JBY2snO1xuICBoYXNoOiBzdHJpbmc7XG59XG5cbi8qKiBSZXBseSB0byBgZ2V0QmxvYmA6IHRoZSByZXF1ZXN0ZWQgY29udGVudC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQmxvYk1lc3NhZ2Uge1xuICB0eXBlOiAnYmxvYic7XG4gIGhhc2g6IHN0cmluZztcbiAgLyoqIEZ1bGwgY29udGVudCwgYmFzZTY0LWVuY29kZWQuICovXG4gIGNvbnRlbnQ6IHN0cmluZztcbn1cblxuLyoqIE1hY2hpbmUtcmVhZGFibGUgY29kZXMgY2FycmllZCBieSBgZXJyb3JgIG1lc3NhZ2VzIChIVFRQLWVxdWl2YWxlbnQpLiAqL1xuZXhwb3J0IHR5cGUgU2VydmVyRXJyb3JDb2RlID0gJ1VOQVVUSE9SSVpFRCcgfCAnUkVWT0tFRCcgfCAnTk9UX0ZPVU5EJyB8ICdQUk9UT0NPTCc7XG5cbi8qKiBOZWdhdGl2ZSByZXBseSAoYXV0aCBmYWlsdXJlLCB1bmtub3duIGJsb2IsIHByb3RvY29sIHZpb2xhdGlvbiwgXHUyMDI2KS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRXJyb3JNZXNzYWdlIHtcbiAgdHlwZTogJ2Vycm9yJztcbiAgY29kZTogU2VydmVyRXJyb3JDb2RlO1xuICBtZXNzYWdlOiBzdHJpbmc7XG59XG5cbi8qKiBQcmVzZW5jZSB1cGRhdGUgZm9yIGRhc2hib2FyZHMgLyBgdnNhIHN0YXR1c2AuICovXG5leHBvcnQgaW50ZXJmYWNlIERldmljZVNlZW5NZXNzYWdlIHtcbiAgdHlwZTogJ2RldmljZVNlZW4nO1xuICBkZXZpY2VJZDogc3RyaW5nO1xuICB0czogbnVtYmVyO1xufVxuXG4vKiogS2VlcGFsaXZlIHJlcGx5LiAqL1xuZXhwb3J0IGludGVyZmFjZSBQb25nTWVzc2FnZSB7XG4gIHR5cGU6ICdwb25nJztcbiAgLyoqIEVjaG9lcyB0aGUgYHBpbmdgIHRzIHdoZW4gb25lIHdhcyBwcm92aWRlZC4gKi9cbiAgdHM/OiBudW1iZXI7XG59XG5cbi8qKiBSZXBseSB0byBgc25hcHNob3RDcmVhdGVgLiAqL1xuZXhwb3J0IGludGVyZmFjZSBTbmFwc2hvdENyZWF0ZUFja01lc3NhZ2Uge1xuICB0eXBlOiAnc25hcHNob3RDcmVhdGVBY2snO1xuICAvKiogSWQgYXNzaWduZWQgYnkgdGhlIGF1dGhvcml0eSAoYHN7bn1gKS4gKi9cbiAgaWQ6IHN0cmluZztcbiAgLyoqIEVjaG9lcyB0aGUgc3RvcmVkIG5hbWUgKGAnJ2AgZm9yIHVubmFtZWQgc25hcHNob3RzKS4gKi9cbiAgbmFtZTogc3RyaW5nO1xuICAvKiogRXBvY2ggbXMgb2YgdGhlIHNuYXBzaG90LiAqL1xuICB0czogbnVtYmVyO1xuICAvKiogR2xvYmFsIHNlcXVlbmNlIG51bWJlciBhdCBjcmVhdGlvbiAoY3Vyc29yIGJvb2trZWVwaW5nKS4gKi9cbiAgc2VxOiBudW1iZXI7XG4gIC8qKiBOdW1iZXIgb2YgZmlsZSBoZWFkcyBjYXB0dXJlZC4gKi9cbiAgZmlsZUNvdW50OiBudW1iZXI7XG59XG5cbi8qKiBSZXBseSB0byBgc25hcHNob3RSZXN0b3JlYC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU25hcHNob3RSZXN0b3JlQWNrTWVzc2FnZSB7XG4gIHR5cGU6ICdzbmFwc2hvdFJlc3RvcmVBY2snO1xuICBpZDogc3RyaW5nO1xuICAvKiogUGF0aHMgcmV2ZXJ0ZWQgdG8gdGhlIHNuYXBzaG90J3MgY29udGVudCAocmVzdXJyZWN0ZWQgdG9tYnN0b25lcyBpbmNsdWRlZCkuICovXG4gIHJlc3RvcmVkOiBudW1iZXI7XG4gIC8qKiBQYXRocyBuZXdseSB0b21ic3RvbmVkIChsaXZlIG5vdywgYWJzZW50IG9yIGRlbGV0ZWQgYXQgdGhlIHNuYXBzaG90KS4gKi9cbiAgdG9tYnN0b25lZDogbnVtYmVyO1xuICAvKiogR2xvYmFsIHNlcSBvZiB0aGUgbGFzdCByZXN0b3JlIGNoYW5nZSAoY3VycmVudCBzZXEgd2hlbiBub3RoaW5nIGRpZmZlcmVkKS4gKi9cbiAgc2VxOiBudW1iZXI7XG59XG5cbi8qKiBPbmUgdmF1bHQtbGV2ZWwgc25hcHNob3QgYXMgbGlzdGVkIGJ5IHRoZSBzZXJ2ZXIgKGBHRVQgL2FwaS9zbmFwc2hvdHNgKS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU25hcHNob3RTdW1tYXJ5IHtcbiAgaWQ6IHN0cmluZztcbiAgbmFtZTogc3RyaW5nO1xuICAvKiogRXBvY2ggbXMgb2YgY3JlYXRpb24uICovXG4gIHRzOiBudW1iZXI7XG4gIC8qKiBEZXZpY2UgdGhhdCBjcmVhdGVkIHRoZSBzbmFwc2hvdC4gKi9cbiAgZGV2aWNlSWQ6IHN0cmluZztcbiAgLyoqIEdsb2JhbCBzZXF1ZW5jZSBudW1iZXIgYXQgY3JlYXRpb24uICovXG4gIHNlcTogbnVtYmVyO1xuICAvKiogTnVtYmVyIG9mIGZpbGUgaGVhZHMgY2FwdHVyZWQuICovXG4gIGZpbGVDb3VudDogbnVtYmVyO1xufVxuXG4vLyAtLS0gVW5pb24gKyBndWFyZHMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCB0eXBlIENsaWVudE1lc3NhZ2UgPVxuICB8IEhlbGxvTWVzc2FnZVxuICB8IEdldE1hbmlmZXN0TWVzc2FnZVxuICB8IENvbW1pdE1lc3NhZ2VcbiAgfCBQdXRCbG9iTWVzc2FnZVxuICB8IEdldEJsb2JNZXNzYWdlXG4gIHwgUGluZ01lc3NhZ2VcbiAgfCBTbmFwc2hvdENyZWF0ZU1lc3NhZ2VcbiAgfCBTbmFwc2hvdFJlc3RvcmVNZXNzYWdlO1xuXG5leHBvcnQgdHlwZSBTZXJ2ZXJNZXNzYWdlID1cbiAgfCBIZWxsb0Fja01lc3NhZ2VcbiAgfCBNYW5pZmVzdE1lc3NhZ2VcbiAgfCBDb21taXRBY2tNZXNzYWdlXG4gIHwgQ29uZmxpY3RNZXNzYWdlXG4gIHwgQ2hhbmdlTWVzc2FnZVxuICB8IERldmljZVNlZW5NZXNzYWdlXG4gIHwgQmxvYkFja01lc3NhZ2VcbiAgfCBCbG9iTWVzc2FnZVxuICB8IEVycm9yTWVzc2FnZVxuICB8IFBvbmdNZXNzYWdlXG4gIHwgU25hcHNob3RDcmVhdGVBY2tNZXNzYWdlXG4gIHwgU25hcHNob3RSZXN0b3JlQWNrTWVzc2FnZTtcblxuZXhwb3J0IHR5cGUgTWVzc2FnZSA9IENsaWVudE1lc3NhZ2UgfCBTZXJ2ZXJNZXNzYWdlO1xuXG5jb25zdCBDTElFTlRfVFlQRVM6IFJlYWRvbmx5U2V0PHN0cmluZz4gPSBuZXcgU2V0KFtcbiAgJ2hlbGxvJyxcbiAgJ2dldE1hbmlmZXN0JyxcbiAgJ2NvbW1pdCcsXG4gICdwdXRCbG9iJyxcbiAgJ2dldEJsb2InLFxuICAncGluZycsXG4gICdzbmFwc2hvdENyZWF0ZScsXG4gICdzbmFwc2hvdFJlc3RvcmUnLFxuXSk7XG5jb25zdCBTRVJWRVJfVFlQRVM6IFJlYWRvbmx5U2V0PHN0cmluZz4gPSBuZXcgU2V0KFtcbiAgJ2hlbGxvQWNrJyxcbiAgJ21hbmlmZXN0JyxcbiAgJ2NvbW1pdEFjaycsXG4gICdjb25mbGljdCcsXG4gICdjaGFuZ2UnLFxuICAnZGV2aWNlU2VlbicsXG4gICdibG9iQWNrJyxcbiAgJ2Jsb2InLFxuICAnZXJyb3InLFxuICAncG9uZycsXG4gICdzbmFwc2hvdENyZWF0ZUFjaycsXG4gICdzbmFwc2hvdFJlc3RvcmVBY2snLFxuXSk7XG5cbi8qKlxuICogUnVudGltZSBzaGFwZSBjaGVjazogYSB2YWx1ZSBpcyBhIGBNZXNzYWdlYCBpZmYgaXQgaXMgYW4gb2JqZWN0IHdob3NlXG4gKiBgdHlwZWAgaXMgYSBrbm93biBtZXNzYWdlIHR5cGUuIEZpZWxkLWxldmVsIHZhbGlkYXRpb24gaGFwcGVucyB3aGVyZSBhXG4gKiBtZXNzYWdlIGlzIGFjdGVkIHVwb24gKGxhdGVyIHBoYXNlcyk7IHRoZSBndWFyZCBpcyBkZWxpYmVyYXRlbHkgY2hlYXAgc29cbiAqIGJvdGggV1MgZW5kcyBjYW4gdHJpYWdlIHVua25vd24vZm9yd2FyZC1jb21wYXRpYmxlIHR5cGVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNNZXNzYWdlKHZhbHVlOiB1bmtub3duKTogdmFsdWUgaXMgTWVzc2FnZSB7XG4gIHJldHVybiAoXG4gICAgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJlxuICAgIHZhbHVlICE9PSBudWxsICYmXG4gICAgdHlwZW9mICh2YWx1ZSBhcyB7IHR5cGU/OiB1bmtub3duIH0pLnR5cGUgPT09ICdzdHJpbmcnICYmXG4gICAgKENMSUVOVF9UWVBFUy5oYXMoKHZhbHVlIGFzIHsgdHlwZTogc3RyaW5nIH0pLnR5cGUpIHx8XG4gICAgICBTRVJWRVJfVFlQRVMuaGFzKCh2YWx1ZSBhcyB7IHR5cGU6IHN0cmluZyB9KS50eXBlKSlcbiAgKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGlzQ2xpZW50TWVzc2FnZSh2YWx1ZTogdW5rbm93bik6IHZhbHVlIGlzIENsaWVudE1lc3NhZ2Uge1xuICByZXR1cm4gKFxuICAgIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiZcbiAgICB2YWx1ZSAhPT0gbnVsbCAmJlxuICAgIENMSUVOVF9UWVBFUy5oYXMoKHZhbHVlIGFzIHsgdHlwZT86IHVua25vd24gfSkudHlwZSBhcyBzdHJpbmcpXG4gICk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc1NlcnZlck1lc3NhZ2UodmFsdWU6IHVua25vd24pOiB2YWx1ZSBpcyBTZXJ2ZXJNZXNzYWdlIHtcbiAgcmV0dXJuIChcbiAgICB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmXG4gICAgdmFsdWUgIT09IG51bGwgJiZcbiAgICBTRVJWRVJfVFlQRVMuaGFzKCh2YWx1ZSBhcyB7IHR5cGU/OiB1bmtub3duIH0pLnR5cGUgYXMgc3RyaW5nKVxuICApO1xufVxuXG4vKipcbiAqIFBhcnNlIGEgV1MgdGV4dCBmcmFtZSBpbnRvIGEgdHlwZWQgYE1lc3NhZ2VgLlxuICogVGhyb3dzIGBQcm90b2NvbEVycm9yYCBvbiBub24tSlNPTiBpbnB1dCBvciB1bmtub3duIG1lc3NhZ2UgdHlwZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZU1lc3NhZ2UoZGF0YTogc3RyaW5nKTogTWVzc2FnZSB7XG4gIGxldCBwYXJzZWQ6IHVua25vd247XG4gIHRyeSB7XG4gICAgcGFyc2VkID0gSlNPTi5wYXJzZShkYXRhKTtcbiAgfSBjYXRjaCAoY2F1c2UpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgTWVzc2FnZSBpcyBub3QgdmFsaWQgSlNPTjogJHtTdHJpbmcoZGF0YSkuc2xpY2UoMCwgMjAwKX1gLCB7IGNhdXNlIH0pO1xuICB9XG4gIGlmICghaXNNZXNzYWdlKHBhcnNlZCkpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihcbiAgICAgIGBVbmtub3duIG9yIG1hbGZvcm1lZCBtZXNzYWdlIHR5cGU6ICR7SlNPTi5zdHJpbmdpZnkoKHBhcnNlZCBhcyB7IHR5cGU/OiB1bmtub3duIH0pPy50eXBlKX1gLFxuICAgICk7XG4gIH1cbiAgcmV0dXJuIHBhcnNlZDtcbn1cblxuLy8gLS0tIHNlcnZlci1kYXRhIGZpZWxkIHZhbGlkYXRpb24gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vL1xuLy8gYGlzTWVzc2FnZWAgdHJpYWdlcyB0aGUgYHR5cGVgIGRpc2NyaW1pbmFudCBvbmx5OyB0aGVzZSB2YWxpZGF0b3JzIGNoZWNrXG4vLyB0aGUgRklFTERTIG9mIHRoZSBzZXJ2ZXIgcGF5bG9hZHMgYSBjbGllbnQgZm9sZHMgaW50byBpdHMgcGVyc2lzdGVkIGxvY2FsXG4vLyBpbmRleCAobWFuaWZlc3QgZW50cmllcywgY29tbWl0L2NvbmZsaWN0IHJlcGxpZXMsIGNoYW5nZSBicm9hZGNhc3RzKS4gT25lXG4vLyBtYWxmb3JtZWQgZmllbGQgXHUyMDE0IGEgbWlzc2luZyB2ZXJzaW9uIGlkLCBhIG5vbi1udW1lcmljIHNpemUsIGEgZnJhY3Rpb25hbFxuLy8gY2xvY2sgY291bnRlciBcdTIwMTQgd291bGQgb3RoZXJ3aXNlIGJlIHBlcnNpc3RlZCB0byB0aGUgc3RhdGUgZmlsZSBhbmQgdGhlblxuLy8gUkVKRUNURUQgYnkgYGRlc2VyaWFsaXplTG9jYWxTdGF0ZWAgb24gZXZlcnkgc3Vic2VxdWVudCBzdGFydHVwLiBDbGllbnRzXG4vLyB2YWxpZGF0ZSBhdCB0aGUgaW5nZXN0IGJvdW5kYXJ5LCBiZWZvcmUgYW55IGZpZWxkIGlzIGFwcGxpZWQ6IHZpb2xhdGlvbnNcbi8vIHRocm93IGBQcm90b2NvbEVycm9yYCwgdGhlIG9mZmVuZGluZyBtZXNzYWdlIGlzIHJlamVjdGVkLCBub3RoaW5nIHBlcnNpc3RzLlxuXG5jb25zdCBWRVJTSU9OX0tJTkRTOiBSZWFkb25seVNldDxzdHJpbmc+ID0gbmV3IFNldChbXG4gICdlZGl0JyxcbiAgJ3JlbmFtZScsXG4gICdkZWxldGUnLFxuICAnY29uZmxpY3RDb3B5JyxcbiAgJ3Jlc3RvcmUnLFxuXSk7XG5cbmZ1bmN0aW9uIGlzUGxhaW5PYmplY3QodmFsdWU6IHVua25vd24pOiB2YWx1ZSBpcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB7XG4gIHJldHVybiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIHZhbHVlICE9PSBudWxsICYmICFBcnJheS5pc0FycmF5KHZhbHVlKTtcbn1cblxuZnVuY3Rpb24gZXhwZWN0Tm9uRW1wdHlTdHJpbmcodmFsdWU6IHVua25vd24sIHdoZXJlOiBzdHJpbmcpOiB2b2lkIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gJ3N0cmluZycgfHwgdmFsdWUgPT09ICcnKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoYCR7d2hlcmV9IG11c3QgYmUgYSBub24tZW1wdHkgc3RyaW5nYCk7XG4gIH1cbn1cblxuZnVuY3Rpb24gZXhwZWN0Tm9uTmVnYXRpdmVJbnRlZ2VyKHZhbHVlOiB1bmtub3duLCB3aGVyZTogc3RyaW5nKTogdm9pZCB7XG4gIGlmICh0eXBlb2YgdmFsdWUgIT09ICdudW1iZXInIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKHZhbHVlKSB8fCB2YWx1ZSA8IDApIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgJHt3aGVyZX0gbXVzdCBiZSBhIG5vbi1uZWdhdGl2ZSBpbnRlZ2VyYCk7XG4gIH1cbn1cblxuZnVuY3Rpb24gZXhwZWN0Q2xvY2sodmFsdWU6IHVua25vd24sIHdoZXJlOiBzdHJpbmcpOiB2b2lkIHtcbiAgaWYgKFxuICAgICFpc1BsYWluT2JqZWN0KHZhbHVlKSB8fFxuICAgIHR5cGVvZiB2YWx1ZS5jb3VudGVyICE9PSAnbnVtYmVyJyB8fFxuICAgICFOdW1iZXIuaXNJbnRlZ2VyKHZhbHVlLmNvdW50ZXIpIHx8XG4gICAgdmFsdWUuY291bnRlciA8PSAwIHx8XG4gICAgdHlwZW9mIHZhbHVlLmRldmljZUlkICE9PSAnc3RyaW5nJ1xuICApIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihcbiAgICAgIGAke3doZXJlfSBtdXN0IGJlIGEgY2xvY2sgeyBjb3VudGVyOiBwb3NpdGl2ZSBpbnRlZ2VyLCBkZXZpY2VJZDogc3RyaW5nIH1gLFxuICAgICk7XG4gIH1cbn1cblxuLyoqXG4gKiBWYWxpZGF0ZSBvbmUgbWFuaWZlc3QgZW50cnkncyBmaWVsZHMuIFJldHVybnMgdGhlIGVudHJ5IHVuY2hhbmdlZDsgdGhyb3dzXG4gKiBgUHJvdG9jb2xFcnJvcmAgb24gYSBmaWVsZCB0aGF0IGNvdWxkIG5vdCBzdXJ2aXZlIGEgcGVyc2lzdC9yZWxvYWQgY3ljbGVcbiAqIChgbG9jYWxpbmRleC50c2AgcmUtdmFsaWRhdGVzIHN0cmljdGx5IG9uIGxvYWQpLlxuICovXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVNYW5pZmVzdEVudHJ5KGVudHJ5OiB1bmtub3duKTogTWFuaWZlc3RFbnRyeSB7XG4gIGlmICghaXNQbGFpbk9iamVjdChlbnRyeSkpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcignTWFsZm9ybWVkIHNlcnZlciBkYXRhOiBtYW5pZmVzdCBlbnRyeSBpcyBub3QgYW4gb2JqZWN0Jyk7XG4gIH1cbiAgY29uc3Qgd2hlcmUgPSBgbWFuaWZlc3QgZW50cnkgJHtKU09OLnN0cmluZ2lmeShlbnRyeS5wYXRoKX1gO1xuICBleHBlY3ROb25FbXB0eVN0cmluZyhlbnRyeS5wYXRoLCBgJHt3aGVyZX06IHBhdGhgKTtcbiAgZXhwZWN0Tm9uRW1wdHlTdHJpbmcoZW50cnkudmVyc2lvbiwgYCR7d2hlcmV9OiB2ZXJzaW9uYCk7XG4gIGlmICh0eXBlb2YgZW50cnkuaGFzaCAhPT0gJ3N0cmluZycpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgJHt3aGVyZX06IGhhc2ggbXVzdCBiZSBhIHN0cmluZ2ApO1xuICB9XG4gIGV4cGVjdE5vbk5lZ2F0aXZlSW50ZWdlcihlbnRyeS5zaXplLCBgJHt3aGVyZX06IHNpemVgKTtcbiAgaWYgKHR5cGVvZiBlbnRyeS5kZWxldGVkICE9PSAnYm9vbGVhbicpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgJHt3aGVyZX06IGRlbGV0ZWQgbXVzdCBiZSBhIGJvb2xlYW5gKTtcbiAgfVxuICBleHBlY3RDbG9jayhlbnRyeS5jbG9jaywgYCR7d2hlcmV9OiBjbG9ja2ApO1xuICBpZiAoZW50cnkuaXNGb2xkZXIgIT09IHVuZGVmaW5lZCAmJiB0eXBlb2YgZW50cnkuaXNGb2xkZXIgIT09ICdib29sZWFuJykge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKGAke3doZXJlfTogaXNGb2xkZXIgbXVzdCBiZSBhIGJvb2xlYW4gd2hlbiBwcmVzZW50YCk7XG4gIH1cbiAgaWYgKGVudHJ5Lm10aW1lICE9PSB1bmRlZmluZWQgJiYgKHR5cGVvZiBlbnRyeS5tdGltZSAhPT0gJ251bWJlcicgfHwgIU51bWJlci5pc0Zpbml0ZShlbnRyeS5tdGltZSkpKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoYCR7d2hlcmV9OiBtdGltZSBtdXN0IGJlIGEgZmluaXRlIG51bWJlciB3aGVuIHByZXNlbnRgKTtcbiAgfVxuICByZXR1cm4gZW50cnkgYXMgdW5rbm93biBhcyBNYW5pZmVzdEVudHJ5O1xufVxuXG4vKiogVmFsaWRhdGUgYSBgbWFuaWZlc3RgIHJlcGx5IChjdXJzb3IgKyBldmVyeSBlbnRyeSkgYmVmb3JlIGl0IGlzIHByb2plY3RlZC4gKi9cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZU1hbmlmZXN0TWVzc2FnZShtZXNzYWdlOiBNYW5pZmVzdE1lc3NhZ2UpOiB2b2lkIHtcbiAgZXhwZWN0Tm9uTmVnYXRpdmVJbnRlZ2VyKG1lc3NhZ2UuY3Vyc29yLCAnbWFuaWZlc3QgY3Vyc29yJyk7XG4gIGZvciAoY29uc3QgZW50cnkgb2YgT2JqZWN0LnZhbHVlcyhtZXNzYWdlLmVudHJpZXMpKSB7XG4gICAgdmFsaWRhdGVNYW5pZmVzdEVudHJ5KGVudHJ5KTtcbiAgfVxufVxuXG4vKiogVmFsaWRhdGUgYSBgY29tbWl0QWNrYCBiZWZvcmUgaXRzIHZlcnNpb24vY2xvY2sgYXJlIGZvbGRlZCBpbnRvIHRoZSBpbmRleC4gKi9cbmV4cG9ydCBmdW5jdGlvbiB2YWxpZGF0ZUNvbW1pdEFja01lc3NhZ2UobWVzc2FnZTogQ29tbWl0QWNrTWVzc2FnZSk6IHZvaWQge1xuICBleHBlY3ROb25FbXB0eVN0cmluZyhtZXNzYWdlLnZlcnNpb24sICdjb21taXRBY2sudmVyc2lvbicpO1xuICBleHBlY3RDbG9jayhtZXNzYWdlLmNsb2NrLCAnY29tbWl0QWNrLmNsb2NrJyk7XG4gIGV4cGVjdE5vbk5lZ2F0aXZlSW50ZWdlcihtZXNzYWdlLnNlcSwgJ2NvbW1pdEFjay5zZXEnKTtcbn1cblxuLyoqIFZhbGlkYXRlIGEgYGNoYW5nZWAgYnJvYWRjYXN0IGJlZm9yZSBpdCBpcyBhcHBsaWVkIG9yIHJlcGxheWVkLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHZhbGlkYXRlQ2hhbmdlTWVzc2FnZShjaGFuZ2U6IENoYW5nZU1lc3NhZ2UpOiB2b2lkIHtcbiAgY29uc3Qgd2hlcmUgPSBgY2hhbmdlICR7SlNPTi5zdHJpbmdpZnkoY2hhbmdlLnBhdGgpfWA7XG4gIGV4cGVjdE5vbkVtcHR5U3RyaW5nKGNoYW5nZS5wYXRoLCBgJHt3aGVyZX06IHBhdGhgKTtcbiAgZXhwZWN0Tm9uRW1wdHlTdHJpbmcoY2hhbmdlLnZlcnNpb24sIGAke3doZXJlfTogdmVyc2lvbmApO1xuICBpZiAodHlwZW9mIGNoYW5nZS5oYXNoICE9PSAnc3RyaW5nJykge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKGAke3doZXJlfTogaGFzaCBtdXN0IGJlIGEgc3RyaW5nYCk7XG4gIH1cbiAgZXhwZWN0Tm9uTmVnYXRpdmVJbnRlZ2VyKGNoYW5nZS5zaXplLCBgJHt3aGVyZX06IHNpemVgKTtcbiAgaWYgKHR5cGVvZiBjaGFuZ2UuZGVsZXRlZCAhPT0gJ2Jvb2xlYW4nKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoYCR7d2hlcmV9OiBkZWxldGVkIG11c3QgYmUgYSBib29sZWFuYCk7XG4gIH1cbiAgaWYgKHR5cGVvZiBjaGFuZ2UuZGV2aWNlICE9PSAnc3RyaW5nJykge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKGAke3doZXJlfTogZGV2aWNlIG11c3QgYmUgYSBzdHJpbmdgKTtcbiAgfVxuICBleHBlY3RDbG9jayhjaGFuZ2UuY2xvY2ssIGAke3doZXJlfTogY2xvY2tgKTtcbiAgaWYgKCFWRVJTSU9OX0tJTkRTLmhhcyhjaGFuZ2Uua2luZCkpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgJHt3aGVyZX06IGtpbmQgbXVzdCBiZSBhIFZlcnNpb25LaW5kYCk7XG4gIH1cbiAgaWYgKGNoYW5nZS5mcm9tUGF0aCAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBjaGFuZ2UuZnJvbVBhdGggIT09ICdzdHJpbmcnKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoYCR7d2hlcmV9OiBmcm9tUGF0aCBtdXN0IGJlIGEgc3RyaW5nIHdoZW4gcHJlc2VudGApO1xuICB9XG4gIGlmIChjaGFuZ2UuaXNGb2xkZXIgIT09IHVuZGVmaW5lZCAmJiB0eXBlb2YgY2hhbmdlLmlzRm9sZGVyICE9PSAnYm9vbGVhbicpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgJHt3aGVyZX06IGlzRm9sZGVyIG11c3QgYmUgYSBib29sZWFuIHdoZW4gcHJlc2VudGApO1xuICB9XG4gIGV4cGVjdE5vbk5lZ2F0aXZlSW50ZWdlcihjaGFuZ2Uuc2VxLCBgJHt3aGVyZX06IHNlcWApO1xufVxuXG4vKiogVmFsaWRhdGUgYSBgY29uZmxpY3RgIHJlcGx5J3Mgd2lubmVyIGJlZm9yZSBpdCBpcyBtYXRlcmlhbGl6ZWQgb3IgcmVjb3JkZWQuICovXG5leHBvcnQgZnVuY3Rpb24gdmFsaWRhdGVDb25mbGljdE1lc3NhZ2UobWVzc2FnZTogQ29uZmxpY3RNZXNzYWdlKTogdm9pZCB7XG4gIGNvbnN0IHdpbm5lciA9IG1lc3NhZ2Uud2lubmVyIGFzIHtcbiAgICBwYXRoPzogdW5rbm93bjtcbiAgICBpZD86IHVua25vd247XG4gICAgaGFzaD86IHVua25vd247XG4gICAgc2l6ZT86IHVua25vd247XG4gICAgZGV2aWNlSWQ/OiB1bmtub3duO1xuICAgIGNsb2NrPzogdW5rbm93bjtcbiAgICBraW5kPzogdW5rbm93bjtcbiAgfTtcbiAgY29uc3Qgd2hlcmUgPSBgY29uZmxpY3Qgd2lubmVyICR7SlNPTi5zdHJpbmdpZnkod2lubmVyLnBhdGgpfWA7XG4gIGV4cGVjdE5vbkVtcHR5U3RyaW5nKHdpbm5lci5wYXRoLCBgJHt3aGVyZX06IHBhdGhgKTtcbiAgZXhwZWN0Tm9uRW1wdHlTdHJpbmcod2lubmVyLmlkLCBgJHt3aGVyZX06IGlkYCk7XG4gIGlmICh0eXBlb2Ygd2lubmVyLmhhc2ggIT09ICdzdHJpbmcnKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoYCR7d2hlcmV9OiBoYXNoIG11c3QgYmUgYSBzdHJpbmdgKTtcbiAgfVxuICBleHBlY3ROb25OZWdhdGl2ZUludGVnZXIod2lubmVyLnNpemUsIGAke3doZXJlfTogc2l6ZWApO1xuICBpZiAodHlwZW9mIHdpbm5lci5kZXZpY2VJZCAhPT0gJ3N0cmluZycpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgJHt3aGVyZX06IGRldmljZUlkIG11c3QgYmUgYSBzdHJpbmdgKTtcbiAgfVxuICBleHBlY3RDbG9jayh3aW5uZXIuY2xvY2ssIGAke3doZXJlfTogY2xvY2tgKTtcbiAgaWYgKHR5cGVvZiB3aW5uZXIua2luZCAhPT0gJ3N0cmluZycgfHwgIVZFUlNJT05fS0lORFMuaGFzKHdpbm5lci5raW5kKSkge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKGAke3doZXJlfToga2luZCBtdXN0IGJlIGEgVmVyc2lvbktpbmRgKTtcbiAgfVxuICBpZiAobWVzc2FnZS5zZXEgIT09IHVuZGVmaW5lZCkge1xuICAgIGV4cGVjdE5vbk5lZ2F0aXZlSW50ZWdlcihtZXNzYWdlLnNlcSwgJ2NvbmZsaWN0LnNlcScpO1xuICB9XG59XG5cbi8vIC0tLSB3aXJlIGVuY29kaW5nIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuLy9cbi8vIGBpbmxpbmVgL2Bjb250ZW50YCBmaWVsZHMgY2FycnkgcmF3IGJ5dGVzIGFzIGJhc2U2NC4gYGJ0b2FgL2BhdG9iYCBleGlzdCBpblxuLy8gZXZlcnkgdGFyZ2V0IHJ1bnRpbWUgKFdvcmtlcnMsIE5vZGUgMTYrLCBFbGVjdHJvbik7IGNodW5raW5nIGF2b2lkc1xuLy8gZXhjZWVkaW5nIGFyZ3VtZW50LWxlbmd0aCBsaW1pdHMgb24gbGFyZ2UgYXR0YWNobWVudHMuXG5cbi8qKiBFbmNvZGUgYnl0ZXMgYXMgYmFzZTY0LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ5dGVzVG9CYXNlNjQoYnl0ZXM6IFVpbnQ4QXJyYXkpOiBzdHJpbmcge1xuICBsZXQgYmluYXJ5ID0gJyc7XG4gIGNvbnN0IENIVU5LID0gMHg4MDAwO1xuICBmb3IgKGxldCBvZmZzZXQgPSAwOyBvZmZzZXQgPCBieXRlcy5sZW5ndGg7IG9mZnNldCArPSBDSFVOSykge1xuICAgIGJpbmFyeSArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKC4uLmJ5dGVzLnN1YmFycmF5KG9mZnNldCwgb2Zmc2V0ICsgQ0hVTkspKTtcbiAgfVxuICByZXR1cm4gYnRvYShiaW5hcnkpO1xufVxuXG4vKiogRGVjb2RlIGJhc2U2NCB0byBieXRlcy4gVGhyb3dzIGBQcm90b2NvbEVycm9yYCBvbiBpbnZhbGlkIGlucHV0LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJhc2U2NFRvQnl0ZXMoZW5jb2RlZDogc3RyaW5nKTogVWludDhBcnJheSB7XG4gIGxldCBiaW5hcnk6IHN0cmluZztcbiAgdHJ5IHtcbiAgICBiaW5hcnkgPSBhdG9iKGVuY29kZWQpO1xuICB9IGNhdGNoIChjYXVzZSkge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKCdCYXNlNjQgcGF5bG9hZCBpcyBub3QgdmFsaWQnLCB7IGNhdXNlIH0pO1xuICB9XG4gIGNvbnN0IGJ5dGVzID0gbmV3IFVpbnQ4QXJyYXkoYmluYXJ5Lmxlbmd0aCk7XG4gIGZvciAobGV0IGkgPSAwOyBpIDwgYmluYXJ5Lmxlbmd0aDsgaSsrKSBieXRlc1tpXSA9IGJpbmFyeS5jaGFyQ29kZUF0KGkpO1xuICByZXR1cm4gYnl0ZXM7XG59XG4iLCAiLyoqXG4gKiBDb25mbGljdC1jb3B5IGZpbGUgbmFtaW5nIChBUkNISVRFQ1RVUkUubWQgXHUwMEE3NCwgRlItNikuXG4gKlxuICogV2hlbiBhIGRldmljZSBsb3NlcyBhIGNvbmZsaWN0IGJ1dCBpdHMgY29udGVudCBtdXN0IGJlIHByZXNlcnZlZCwgdGhlXG4gKiBjb250ZW50IGlzIGNvbW1pdHRlZCB0byBhIHNpYmxpbmcgXCJjb25mbGljdCBjb3B5XCIgcGF0aCBzaGFwZWQgbGlrZTpcbiAqXG4gKiAgICAgTm90ZSAoY29uZmxpY3QgMjAyNi0wOC0yMCAxNC0yMyAtIGZyb20gUGhvbmUpLm1kXG4gKiAgICAgXHUyNTE0XHUyNTAwIHN0ZW0gXHUyNTAwXHUyNTE4XHUyNTE0XHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwIFVUQyBkYXRlICsgSEgtbW0gXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTE4XHUyNTE0IGRldmljZSBcdTI1MThcdTI1MTRleHRcdTI1MThcbiAqXG4gKiBSdWxlczpcbiAqICAgLSB0aW1lc3RhbXAgaXMgYWx3YXlzIFVUQyAobmV2ZXIgYSBsb2NhbCB0aW1lem9uZSkgc28gZXZlcnkgY2xpZW50XG4gKiAgICAgY29tcHV0ZXMgdGhlIGlkZW50aWNhbCBuYW1lIGZyb20gdGhlIHNhbWUgY29tbWl0IHRpbWU7XG4gKiAgIC0gdGhlIGRldmljZSBuYW1lIGlzIHNhbml0aXplZCBmb3IgZmlsZXN5c3RlbSBzYWZldHkgKHNlZVxuICogICAgIGBzYW5pdGl6ZURldmljZU5hbWVgKTtcbiAqICAgLSB0aGUgb3JpZ2luYWwgZXh0ZW5zaW9uIGlzIHByZXNlcnZlZCAobGFzdCBkb3QgaW4gdGhlIGJhc2VuYW1lLCBhcyBsb25nXG4gKiAgICAgYXMgaXQgaXMgbm90IHRoZSBmaXJzdCBjaGFyYWN0ZXIgXHUyMDE0IGAuZ2l0aWdub3JlYCBoYXMgbm8gZXh0ZW5zaW9uKTtcbiAqICAgLSBpZiB0aGUgY2FuZGlkYXRlIGFscmVhZHkgZXhpc3RzIChpbiB0aGUgbG9jYWwgaW5kZXggb3IgdGhlIHJlbW90ZVxuICogICAgIG1hbmlmZXN0IFx1MjAxNCB0aGUgY2FsbGVyIHN1cHBsaWVzIHRoZSBgZXhpc3RzYCBwcmVkaWNhdGUpLCBgIDJgLCBgIDNgLCBcdTIwMjZcbiAqICAgICBpcyBhcHBlbmRlZCBiZWZvcmUgdGhlIGV4dGVuc2lvbi5cbiAqL1xuXG5pbXBvcnQgeyBiYXNlbmFtZSwgbm9ybWFsaXplVmF1bHRQYXRoLCBwYXJlbnRQYXRoIH0gZnJvbSAnLi9wYXRocy5qcyc7XG5cbi8qKiBDaGFyYWN0ZXJzIGZvcmJpZGRlbiBvbiBhdCBsZWFzdCBvbmUgc3VwcG9ydGVkIHBsYXRmb3JtLiAqL1xuY29uc3QgSUxMRUdBTF9GSUxFTkFNRV9DSEFSUyA9IC9bPD46XCIvXFxcXHw/Kl0vZztcbi8qKiBDMCBjb250cm9scyArIERFTCBcdTIwMTQgbmV2ZXIgdmFsaWQgaW4gZmlsZW5hbWVzLiAqL1xuY29uc3QgQ09OVFJPTF9DSEFSUyA9IC9bXFx4MDAtXFx4MWZcXHg3Zl0vZztcblxuLyoqIE1heCBsZW5ndGggKGluIGNvZGUgcG9pbnRzKSBvZiBhIHNhbml0aXplZCBkZXZpY2UgbmFtZS4gKi9cbmNvbnN0IE1BWF9ERVZJQ0VfTkFNRV9MRU5HVEggPSAzMDtcblxuLyoqIEZhbGxiYWNrIHdoZW4gYSBkZXZpY2UgbmFtZSBzYW5pdGl6ZXMgdG8gbm90aGluZy4gKi9cbmNvbnN0IEZBTExCQUNLX0RFVklDRV9OQU1FID0gJ3Vua25vd24nO1xuXG4vKiogSGlnaGVzdCBgIE5gIHN1ZmZpeCB0cmllZCBiZWZvcmUgZ2l2aW5nIHVwLiAqL1xuY29uc3QgTUFYX0NPTExJU0lPTl9TVUZGSVggPSA5OTk7XG5cbi8qKlxuICogU2FuaXRpemUgYSBkZXZpY2UgbmFtZSBmb3IgdXNlIGluc2lkZSBhIGZpbGVuYW1lOiBzdHJpcCBgPD46XCIvXFxcXHw/KmAgYW5kXG4gKiBjb250cm9sIGNoYXJhY3RlcnMsIHRyaW0gd2hpdGVzcGFjZSBhbmQgZWRnZSBkb3RzIChXaW5kb3dzIHNlZ21lbnRzIG1heVxuICogbm90IGVuZCB3aXRoIGAuYCBvciB3aGl0ZXNwYWNlKSwgdHJ1bmNhdGUgdG8gMzAgY29kZSBwb2ludHMgKG5ldmVyIHNwbGl0c1xuICogYSBzdXJyb2dhdGUgcGFpcikuIFJldHVybnMgYCd1bmtub3duJ2Agd2hlbiBub3RoaW5nIHN1cnZpdmVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gc2FuaXRpemVEZXZpY2VOYW1lKG5hbWU6IHN0cmluZyk6IHN0cmluZyB7XG4gIGxldCBjbGVhbmVkID0gbmFtZS5yZXBsYWNlKElMTEVHQUxfRklMRU5BTUVfQ0hBUlMsICcnKS5yZXBsYWNlKENPTlRST0xfQ0hBUlMsICcnKTtcbiAgY2xlYW5lZCA9IFsuLi5jbGVhbmVkXS5zbGljZSgwLCBNQVhfREVWSUNFX05BTUVfTEVOR1RIKS5qb2luKCcnKTtcbiAgY2xlYW5lZCA9IGNsZWFuZWQudHJpbSgpLnJlcGxhY2UoL15bLlxcc10rfFsuXFxzXSskL2csICcnKTtcbiAgcmV0dXJuIGNsZWFuZWQubGVuZ3RoID09PSAwID8gRkFMTEJBQ0tfREVWSUNFX05BTUUgOiBjbGVhbmVkO1xufVxuXG4vKipcbiAqIENvbXB1dGUgdGhlIGNvbmZsaWN0LWNvcHkgcGF0aCBmb3IgYHBhdGhgLlxuICpcbiAqIFB1cmUgYW5kIGRldGVybWluaXN0aWM6IHRoZSBzYW1lIGAocGF0aCwgZGV2aWNlTmFtZSwgbm93LCBleGlzdHMpYCBhbHdheXNcbiAqIHlpZWxkcyB0aGUgc2FtZSByZXN1bHQuIGBub3dgIGlzIHRoZSBjb25mbGljdCdzIGVwb2NoLW1zIHRpbWVzdGFtcCAodGhlXG4gKiBjYWxsZXIgcGFzc2VzIGl0IGluIFx1MjAxNCBubyBoaWRkZW4gY2xvY2tzKTsgYGV4aXN0c2AgaXMgY29uc3VsdGVkIGZvclxuICogY29sbGlzaW9uIGF2b2lkYW5jZSBhbmQgdHlwaWNhbGx5IGNoZWNrcyB0aGUgbG9jYWwgaW5kZXggcGx1cyB0aGUgcmVtb3RlXG4gKiBtYW5pZmVzdC5cbiAqXG4gKiBUaHJvd3Mgd2hlbiBtb3JlIHRoYW4gYE1BWF9DT0xMSVNJT05fU1VGRklYYCBuYW1lIGNvbGxpc2lvbnMgb2NjdXIgKGFcbiAqIGdlbnVpbmVseSBwYXRob2xvZ2ljYWwgdmF1bHQgc3RhdGUgdGhlIGNhbGxlciBzaG91bGQgc3VyZmFjZSwgbm90IHBhcGVyXG4gKiBvdmVyKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvbmZsaWN0Q29weVBhdGgoXG4gIHBhdGg6IHN0cmluZyxcbiAgZGV2aWNlTmFtZTogc3RyaW5nLFxuICBub3c6IG51bWJlcixcbiAgZXhpc3RzOiAoY2FuZGlkYXRlUGF0aDogc3RyaW5nKSA9PiBib29sZWFuID0gKCkgPT4gZmFsc2UsXG4pOiBzdHJpbmcge1xuICBjb25zdCBub3JtYWxpemVkID0gbm9ybWFsaXplVmF1bHRQYXRoKHBhdGgpO1xuICBjb25zdCBkaXIgPSBwYXJlbnRQYXRoKG5vcm1hbGl6ZWQpO1xuICBjb25zdCBuYW1lID0gYmFzZW5hbWUobm9ybWFsaXplZCk7XG5cbiAgY29uc3QgbGFzdERvdCA9IG5hbWUubGFzdEluZGV4T2YoJy4nKTtcbiAgY29uc3QgaGFzRXh0ZW5zaW9uID0gbGFzdERvdCA+IDA7IC8vIGEgbGVhZGluZyBkb3QgbWFya3MgYSBkb3RmaWxlLCBub3QgYW4gZXh0ZW5zaW9uXG4gIGNvbnN0IHN0ZW0gPSBoYXNFeHRlbnNpb24gPyBuYW1lLnNsaWNlKDAsIGxhc3REb3QpIDogbmFtZTtcbiAgY29uc3QgZXh0ZW5zaW9uID0gaGFzRXh0ZW5zaW9uID8gbmFtZS5zbGljZShsYXN0RG90KSA6ICcnO1xuXG4gIGNvbnN0IHN1ZmZpeCA9IGAgKGNvbmZsaWN0ICR7Zm9ybWF0Q29uZmxpY3RTdGFtcChub3cpfSAtIGZyb20gJHtzYW5pdGl6ZURldmljZU5hbWUoZGV2aWNlTmFtZSl9KWA7XG4gIGNvbnN0IGpvaW4gPSAoZmlsZU5hbWU6IHN0cmluZyk6IHN0cmluZyA9PiAoZGlyID09PSAnLycgPyBgLyR7ZmlsZU5hbWV9YCA6IGAke2Rpcn0vJHtmaWxlTmFtZX1gKTtcblxuICBsZXQgY2FuZGlkYXRlID0gam9pbihgJHtzdGVtfSR7c3VmZml4fSR7ZXh0ZW5zaW9ufWApO1xuICBmb3IgKGxldCBuID0gMjsgbiA8PSBNQVhfQ09MTElTSU9OX1NVRkZJWDsgbisrKSB7XG4gICAgaWYgKCFleGlzdHMoY2FuZGlkYXRlKSkgcmV0dXJuIGNhbmRpZGF0ZTtcbiAgICBjYW5kaWRhdGUgPSBqb2luKGAke3N0ZW19JHtzdWZmaXh9ICR7bn0ke2V4dGVuc2lvbn1gKTtcbiAgfVxuICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgYGNvbmZsaWN0Q29weVBhdGg6IG1vcmUgdGhhbiAke01BWF9DT0xMSVNJT05fU1VGRklYfSBjb2xsaXNpb25zIGZvciAke0pTT04uc3RyaW5naWZ5KG5vcm1hbGl6ZWQpfWAsXG4gICk7XG59XG5cbi8qKiBgMjAyNi0wOC0yMCAxNC0yM2AgXHUyMDE0IFVUQyBkYXRlLCBzcGFjZSwgemVyby1wYWRkZWQgSEgtbW0uIE1pbnV0ZXMsIG5vdCBzZWNvbmRzLiAqL1xuZnVuY3Rpb24gZm9ybWF0Q29uZmxpY3RTdGFtcChub3c6IG51bWJlcik6IHN0cmluZyB7XG4gIGNvbnN0IGQgPSBuZXcgRGF0ZShub3cpO1xuICBjb25zdCBwYWQgPSAobjogbnVtYmVyKTogc3RyaW5nID0+IFN0cmluZyhuKS5wYWRTdGFydCgyLCAnMCcpO1xuICByZXR1cm4gKFxuICAgIGAke2QuZ2V0VVRDRnVsbFllYXIoKX0tJHtwYWQoZC5nZXRVVENNb250aCgpICsgMSl9LSR7cGFkKGQuZ2V0VVRDRGF0ZSgpKX1gICtcbiAgICBgICR7cGFkKGQuZ2V0VVRDSG91cnMoKSl9LSR7cGFkKGQuZ2V0VVRDTWludXRlcygpKX1gXG4gICk7XG59XG4iLCAiLyoqXG4gKiBUaHJlZS13YXkgcmVjb25jaWxpYXRpb24gKEFSQ0hJVEVDVFVSRS5tZCBcdTAwQTc4IHN0ZXAgNCkuXG4gKlxuICogYGNvbXB1dGVTeW5jUGxhbmAgaXMgYSBQVVJFLCBERVRFUk1JTklTVElDIGZ1bmN0aW9uOiB0aGUgc2FtZSBpbnB1dHMgYWx3YXlzXG4gKiBwcm9kdWNlIHRoZSBzYW1lIHBsYW4gKG1hbmlmZXN0IGFuZCBjaGFuZ2UgYnVja2V0cyBhcmUgcmUtc29ydGVkXG4gKiBpbnRlcm5hbGx5OyBgbm93YCBpcyBhIHBhcmFtZXRlciwgbmV2ZXIgcmVhZCBmcm9tIGEgY2xvY2spLiBJdCBjb21wYXJlc1xuICogdGhyZWUgc3RhdGVzIGZvciBldmVyeSBwYXRoOlxuICpcbiAqICAgLSB0aGUgKipsb2NhbCBpbmRleCoqIFx1MjAxNCB3aGF0IHRoaXMgZGV2aWNlIGxhc3Qga25ldyBhcyBhdXRob3JpdGF0aXZlXG4gKiAgICAgKHRoZSBcImNvbW1vbiBhbmNlc3RvclwiIG9mIHRoZSB0aHJlZS13YXkgbWVyZ2UpO1xuICogICAtIHRoZSAqKmxvY2FsIGNoYW5nZXMqKiBcdTIwMTQgaG93IGxvY2FsIHN0b3JhZ2UgZGl2ZXJnZWQgZnJvbSB0aGUgaW5kZXhcbiAqICAgICB3aGlsZSBvZmZsaW5lIChgc2Nhbi50c2Agb3V0cHV0KTtcbiAqICAgLSB0aGUgKiptYW5pZmVzdCoqIFx1MjAxNCB0aGUgYXV0aG9yaXR5J3MgY3VycmVudCBoZWFkIHBlciBwYXRoLlxuICpcbiAqIGFuZCBlbWl0cyBhIGBTeW5jUGxhbmAgKHNoYXBlIGRvY3VtZW50ZWQgb24gdGhlIGludGVyZmFjZSk6IG9wcyB0byBwdXNoLFxuICogb3BzIHRvIHB1bGwsIGNvbmZsaWN0IHJlc29sdXRpb25zLCBhbmQgZm9sZGVyIHBsYWNlaG9sZGVycyB0byBwdXNoLlxuICpcbiAqIENvbmZsaWN0IGFyYml0cmF0aW9uIG1pcnJvcnMgdGhlIERPJ3MgcnVsZSAoXHUwMEE3NCk6IHdpbm5lciA9IGhpZ2hlciBsb2dpY2FsXG4gKiBjbG9jazsgdGllIFx1MjE5MiBncmVhdGVyIGRldmljZUlkLiBUaGUgbG9jYWwgc2lkZSdzICp0ZW50YXRpdmUqIGNsb2NrIGlzXG4gKiBgbmV4dENsb2NrKGluZGV4IGNsb2NrLCB0aGlzRGV2aWNlSWQpYCBcdTIwMTQgZXhhY3RseSB0aGUgY291bnRlciB0aGUgRE8gd291bGRcbiAqIGFzc2lnbiBhIGNvbW1pdCBidWlsZGluZyBvbiB0aGUgc2FtZSBwYXJlbnQsIHNvIHRoZSBjbGllbnQncyBwcmVkaWN0aW9uXG4gKiBtYXRjaGVzIHRoZSBzZXJ2ZXIncyBhcmJpdHJhdGlvbi4gV2hlbiB0aGUgcmVtb3RlIHNpZGUgd2lucywgdGhlIGxvc2luZ1xuICogbG9jYWwgY29udGVudCBpcyBwcmVzZXJ2ZWQgYnkgcHVzaGluZyBpdCB0byBhIGNvbmZsaWN0LWNvcHkgcGF0aFxuICogKGBjb25mbGljdG5hbWVzLnRzYCk7IHdoZW4gdGhlIGxvY2FsIHNpZGUgd2lucywgdGhlIGNsaWVudCBzaW1wbHkgY29tbWl0c1xuICogd2l0aCBpdHMgKG5vdyBzdGFsZSkgcGFyZW50IHZlcnNpb24gYW5kIGxldHMgdGhlIHNlcnZlciBhcmJpdHJhdGUgXHUyMDE0IHRoZVxuICogc2VydmVyIHN5bnRoZXNpemVzIGFueSBjb25mbGljdCBjb3B5IGZvciB0aGUgbG9zaW5nIHJlbW90ZSBjb250ZW50LCB3aGljaFxuICogYXJyaXZlcyBsYXRlciBhcyBhbiBvcmRpbmFyeSBjaGFuZ2UgZXZlbnQuXG4gKi9cblxuaW1wb3J0IHsgY29tcGFyZUNsb2NrcywgbmV4dENsb2NrIH0gZnJvbSAnLi9jbG9jay5qcyc7XG5pbXBvcnQgeyBjb25mbGljdENvcHlQYXRoIH0gZnJvbSAnLi9jb25mbGljdG5hbWVzLmpzJztcbmltcG9ydCB0eXBlIHsgTG9jYWxJbmRleCwgTG9jYWxJbmRleEVudHJ5IH0gZnJvbSAnLi9sb2NhbGluZGV4LmpzJztcbmltcG9ydCB7IHBhcmVudFBhdGggfSBmcm9tICcuL3BhdGhzLmpzJztcbmltcG9ydCB0eXBlIHsgTWFuaWZlc3RFbnRyeSB9IGZyb20gJy4vcHJvdG9jb2wuanMnO1xuaW1wb3J0IHR5cGUgeyBEZWxldGVkQ2FuZGlkYXRlLCBMb2NhbENoYW5nZXMsIFJlbmFtZUNhbmRpZGF0ZSwgU2NhbkNhbmRpZGF0ZSB9IGZyb20gJy4vc2Nhbi5qcyc7XG5pbXBvcnQgdHlwZSB7IExvZ2ljYWxDbG9jayB9IGZyb20gJy4vdHlwZXMuanMnO1xuXG4vKipcbiAqIEEgbWFuaWZlc3QgZW50cnkgYXMgcmVjb25jaWxpYXRpb24gY29uc3VtZXMgaXQuIFNpbmNlIGBNYW5pZmVzdEVudHJ5YCBncmV3XG4gKiBgcGF0aGAsIGBjbG9ja2AsIGFuZCBgaXNGb2xkZXJgIChwcm90b2NvbCB2MSwgcHJlLXJlbGVhc2UpLCB0aGlzIGlzIG5vdyB0aGVcbiAqIG1hbmlmZXN0IGVudHJ5IGl0c2VsZiBcdTIwMTQga2VwdCBhcyBhIG5hbWVkIGFsaWFzIHNvIGBjb21wdXRlU3luY1BsYW5gJ3MgaW5wdXRcbiAqIGNvbnRyYWN0IHN0YXlzIHNlbGYtZG9jdW1lbnRpbmcuXG4gKi9cbmV4cG9ydCB0eXBlIFJlbW90ZUZpbGUgPSBNYW5pZmVzdEVudHJ5O1xuXG4vKiogSW5wdXQgdG8gYGNvbXB1dGVTeW5jUGxhbmAuICovXG5leHBvcnQgaW50ZXJmYWNlIFN5bmNQbGFuSW5wdXQge1xuICBsb2NhbENoYW5nZXM6IExvY2FsQ2hhbmdlcztcbiAgaW5kZXg6IExvY2FsSW5kZXg7XG4gIG1hbmlmZXN0OiByZWFkb25seSBSZW1vdGVGaWxlW107XG4gIHRoaXNEZXZpY2VJZDogc3RyaW5nO1xuICAvKiogSHVtYW4tcmVhZGFibGUgbmFtZSBvZiB0aGlzIGRldmljZSBcdTIwMTQgdXNlZCBpbiBjb25mbGljdC1jb3B5IGZpbGUgbmFtZXMuICovXG4gIHRoaXNEZXZpY2VOYW1lOiBzdHJpbmc7XG4gIC8qKiBFcG9jaCBtcyB1c2VkIGZvciBjb25mbGljdC1jb3B5IHRpbWVzdGFtcHMgKHBhc3NlZCBpbiBmb3IgZGV0ZXJtaW5pc20pLiAqL1xuICBub3c6IG51bWJlcjtcbn1cblxuLyoqIFdoeSBhIHBhdGggd2VudCB0aHJvdWdoIGNvbmZsaWN0IHJlc29sdXRpb24uICovXG5leHBvcnQgdHlwZSBDb25mbGljdFJlYXNvbiA9ICdjb25jdXJyZW50LWVkaXQnIHwgJ2FkZC12cy1hZGQnIHwgJ2RlbGV0ZS12cy1lZGl0JyB8ICdyZW5hbWUtcmFjZSc7XG5cbi8qKlxuICogQSBjb21taXQgdGhpcyBkZXZpY2Ugc2hvdWxkIHNlbmQgKHBheWxvYWQgb2YgYSBwcm90b2NvbCBgY29tbWl0YCBtZXNzYWdlKS5cbiAqXG4gKiBgcGFyZW50VmVyc2lvbmAgc2VtYW50aWNzOlxuICogICAtIGxvY2FsLW9ubHkgY2hhbmdlcyBhbmQgbG9jYWwtd2lucyBjb25mbGljdHMgbmFtZSB0aGUgKmluZGV4KiBoZWFkIChvclxuICogICAgIGBudWxsYCBmb3IgYnJhbmQtbmV3IHBhdGhzKSBcdTIwMTQgZGVsaWJlcmF0ZWx5IHN0YWxlIHdoZW4gYSBjb25mbGljdCB3YXNcbiAqICAgICBwcmVkaWN0ZWQsIHNvIHRoZSBETyBhcmJpdHJhdGVzIGFuZCBwcmVzZXJ2ZXMgdGhlIGxvc2luZyByZW1vdGVcbiAqICAgICBjb250ZW50IHNlcnZlci1zaWRlO1xuICogICAtIGNvbmZsaWN0LWNvcHkgcHVzaGVzIG5hbWUgdGhlICpyZW1vdGUqIGhlYWQgKGZhc3QtcGF0aDogdGhleSBidWlsZCBvblxuICogICAgIHRoZSB3aW5uZXIgYW5kIG11c3Qgbm90IHJlLWNvbmZsaWN0KS5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBQdXNoRmlsZU9wIHtcbiAga2luZDogJ2FkZCcgfCAnZWRpdCcgfCAnZGVsZXRlJyB8ICdyZXN0b3JlJyB8ICdjb25mbGljdENvcHknO1xuICBwYXRoOiBzdHJpbmc7XG4gIHBhcmVudFZlcnNpb246IHN0cmluZyB8IG51bGw7XG4gIC8qKiBDb250ZW50IGhhc2g7IGRlbGV0ZSBvcHMgcmV1c2UgdGhlIGRlbGV0ZWQgY29udGVudCdzIGhhc2guICovXG4gIGhhc2g6IHN0cmluZztcbiAgc2l6ZTogbnVtYmVyO1xuICAvKiogVHJ1ZSBmb3IgZm9sZGVyLXRvbWJzdG9uZSBkZWxldGVzIChgaGFzaCAnJ2AsIHNpemUgMCkgXHUyMDE0IEZSLTEwIGxpZmVjeWNsZS4gKi9cbiAgaXNGb2xkZXI/OiBib29sZWFuO1xufVxuXG4vKiogQSBsb2NhbCByZW5hbWUgdG8gY29tbWl0IGFzIG9uZSBjaGFpbiBtaWdyYXRpb24gKEZSLTkpLiAqL1xuZXhwb3J0IGludGVyZmFjZSBQdXNoUmVuYW1lT3Age1xuICBraW5kOiAncmVuYW1lJztcbiAgZnJvbVBhdGg6IHN0cmluZztcbiAgdG9QYXRoOiBzdHJpbmc7XG4gIC8qKiBWZXJzaW9uIG9mIHRoZSBgZnJvbVBhdGhgIGhlYWQgdGhpcyByZW5hbWUgYnVpbGRzIG9uLiAqL1xuICBwYXJlbnRWZXJzaW9uOiBzdHJpbmcgfCBudWxsO1xuICBoYXNoOiBzdHJpbmc7XG4gIHNpemU6IG51bWJlcjtcbn1cblxuZXhwb3J0IHR5cGUgUHVzaE9wID0gUHVzaEZpbGVPcCB8IFB1c2hSZW5hbWVPcDtcblxuLyoqIFJlbW90ZSBjb250ZW50IHRoaXMgZGV2aWNlIHNob3VsZCBmZXRjaCBhbmQgbWF0ZXJpYWxpemUgdmlhIGBhcHBseVB1bGxgLiAqL1xuZXhwb3J0IGludGVyZmFjZSBQdWxsRmlsZU9wIHtcbiAga2luZDogJ2FkZCcgfCAnZWRpdCcgfCAnZGVsZXRlJyB8ICdyZXN0b3JlJztcbiAgcGF0aDogc3RyaW5nO1xuICBoYXNoOiBzdHJpbmc7XG4gIHNpemU6IG51bWJlcjtcbiAgdmVyc2lvbjogc3RyaW5nO1xuICBjbG9jazogTG9naWNhbENsb2NrO1xuICAvKiogVHJ1ZSBmb3IgdG9tYnN0b25lcyAoa2luZCBgJ2RlbGV0ZSdgKS4gKi9cbiAgZGVsZXRlZDogYm9vbGVhbjtcbiAgLyoqIFRydWUgZm9yIGVtcHR5LWZvbGRlciBwbGFjZWhvbGRlciBwdWxscyAoRlItMTApIFx1MjAxNCBtYXRlcmlhbGl6ZSB3aXRoIGBlbnN1cmVEaXJgLiAqL1xuICBpc0ZvbGRlcj86IGJvb2xlYW47XG59XG5cbi8qKiBBIHJlbW90ZSByZW5hbWUgdG8gZm9sbG93IGxvY2FsbHkgKGRldGVjdGVkIGJ5IGhhc2ggY29ycmVsYXRpb24pLiAqL1xuZXhwb3J0IGludGVyZmFjZSBQdWxsUmVuYW1lT3Age1xuICBraW5kOiAncmVuYW1lJztcbiAgZnJvbVBhdGg6IHN0cmluZztcbiAgdG9QYXRoOiBzdHJpbmc7XG4gIGhhc2g6IHN0cmluZztcbiAgc2l6ZTogbnVtYmVyO1xuICB2ZXJzaW9uOiBzdHJpbmc7XG4gIGNsb2NrOiBMb2dpY2FsQ2xvY2s7XG59XG5cbmV4cG9ydCB0eXBlIFB1bGxPcCA9IFB1bGxGaWxlT3AgfCBQdWxsUmVuYW1lT3A7XG5cbi8qKlxuICogT25lIGFyYml0cmF0ZWQgY29uZmxpY3QuIGBsb3NlckNvbnRlbnRgIGlzIGAnbm9uZSdgIHdoZW4gdGhlIGxvc2luZyBzaWRlXG4gKiB3YXMgYSBkZWxldGlvbiAobm90aGluZyB0byBwcmVzZXJ2ZSkuIFdoZW4gdGhlIGxvY2FsIGNvbnRlbnQgbG9zdCBhbmQgaGFkXG4gKiBjb250ZW50LCBgY29uZmxpY3RDb3B5UGF0aGAgbmFtZXMgd2hlcmUgdGhlIHBsYW4gcHJlc2VydmVzIGl0ICh0aGUgcHVzaFxuICogaXRzZWxmIGlzIGluIGBTeW5jUGxhbi5wdXNoZXNgIHdpdGgga2luZCBgJ2NvbmZsaWN0Q29weSdgKS5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBDb25mbGljdE9wIHtcbiAgcGF0aDogc3RyaW5nO1xuICByZWFzb246IENvbmZsaWN0UmVhc29uO1xuICB3aW5uZXI6ICdsb2NhbCcgfCAncmVtb3RlJztcbiAgbG9zZXJDb250ZW50OiAnbG9jYWwnIHwgJ3JlbW90ZScgfCAnbm9uZSc7XG4gIGNvbmZsaWN0Q29weVBhdGg/OiBzdHJpbmc7XG4gIHJlbW90ZTogeyB2ZXJzaW9uOiBzdHJpbmc7IGhhc2g6IHN0cmluZzsgc2l6ZTogbnVtYmVyOyBkZWxldGVkOiBib29sZWFuOyBjbG9jazogTG9naWNhbENsb2NrIH07XG4gIC8qKiBUaGUgdGVudGF0aXZlIGNsb2NrIHRoZSBsb2NhbCBzaWRlIHdhcyBhcmJpdHJhdGVkIHdpdGguICovXG4gIGxvY2FsQ2xvY2s6IExvZ2ljYWxDbG9jaztcbn1cblxuLyoqXG4gKiBUaGUgY29tcGxldGUgcmVjb25jaWxpYXRpb24gcmVzdWx0IGZvciBvbmUgc3luYyBjeWNsZS4gT3BzIGFyZSBzb3J0ZWQgYnlcbiAqIHRhcmdldCBwYXRoIChyZW5hbWVzIGJ5IGB0b1BhdGhgKTsgdGhlIHNvbGUgZXhjZXB0aW9uOiB3aXRoaW4gYSBwYWlyIG9mXG4gKiBwdWxsIHRhcmdldHMgZGlmZmVyaW5nIG9ubHkgYnkgbmFtZSBjYXNlLCBkZWxldGVzIHNvcnQgYmVmb3JlIHdyaXRlcyAoc2VlXG4gKiBgY29tcGFyZVB1bGxPcHNgIFx1MjAxNCBjYXNlLWluc2Vuc2l0aXZlLWZpbGVzeXN0ZW0gc2FmZXR5KS4gRXZlcnkgYXJyYXkgbWF5IGJlXG4gKiBlbXB0eS4gYHB1c2hlc2AgYW5kXG4gKiBgcHVsbHNgIGFyZSBpbmRlcGVuZGVudCBcdTIwMTQgYSBwYXRoIGFwcGVhcnMgYXQgbW9zdCBvbmNlIGluIGVhY2guIFB1c2hlcyBhcmVcbiAqIE5PVCBhcHBsaWVkIHRvIHRoZSBsb2NhbCBpbmRleCB1bnRpbCB0aGUgc2VydmVyIGFja3MgdGhlbTsgcHVsbHMgYXJlXG4gKiBhcHBsaWVkIGJ5IGBhcHBseVB1bGxgIChgZW5naW5lLnRzYCkuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU3luY1BsYW4ge1xuICAvKiogQ29tbWl0cyB0byBzZW5kLCBpbiBvcmRlci4gKi9cbiAgcHVzaGVzOiBQdXNoT3BbXTtcbiAgLyoqIFJlbW90ZSBjaGFuZ2VzIHRvIG1hdGVyaWFsaXplLCBpbiBvcmRlci4gKi9cbiAgcHVsbHM6IFB1bGxPcFtdO1xuICAvKiogQ29uZmxpY3RzIHRoYXQgd2VyZSBhcmJpdHJhdGVkIChpbmZvcm1hdGlvbmFsOyBzaWRlIGVmZmVjdHMgbGl2ZSBpbiBwdXNoZXMvcHVsbHMpLiAqL1xuICBjb25mbGljdHM6IENvbmZsaWN0T3BbXTtcbiAgLyoqIEVtcHR5LWZvbGRlciBwbGFjZWhvbGRlciBwYXRocyB0byBjcmVhdGUgcmVtb3RlbHkgKEZSLTEwKS4gKi9cbiAgZm9sZGVyUHVzaGVzOiBzdHJpbmdbXTtcbn1cblxuLyoqIEludGVybmFsOiBhIGxvY2FsIGNhbmRpZGF0ZSAoYWRkZWQvbW9kaWZpZWQvZGVsZXRlZCkgdW5pZmllZCBmb3IgcmVzb2x1dGlvbi4gKi9cbmludGVyZmFjZSBMb2NhbENhbmRpZGF0ZSB7XG4gIHBhdGg6IHN0cmluZztcbiAga2luZDogJ2FkZCcgfCAnZWRpdCcgfCAncmVzdG9yZScgfCAnZGVsZXRlJztcbiAgaGFzaDogc3RyaW5nO1xuICBzaXplOiBudW1iZXI7XG4gIC8qKiBGb2xkZXItcGxhY2Vob2xkZXIgZGVsZXRpb25zIChgc2Nhbi5mb2xkZXJEZWxldGlvbnNgKSByZXNvbHZlIGFzIHRvbWJzdG9uZXMuICovXG4gIGlzRm9sZGVyPzogYm9vbGVhbjtcbn1cblxuY29uc3QgWkVST19DTE9DSzogTG9naWNhbENsb2NrID0geyBjb3VudGVyOiAwLCBkZXZpY2VJZDogJycgfTtcblxuLyoqXG4gKiBDb21wdXRlIHRoZSBzeW5jIHBsYW4uIFNlZSB0aGUgbW9kdWxlIGRvYyBmb3IgdGhlIG1vZGVsIGFuZCB0aGUgb3BcbiAqIHNlbWFudGljcy4gVGhyb3dzIG5vdGhpbmcgb24gb3JkaW5hcnkgZGl2ZXJnZW5jZSBcdTIwMTQgY29uZmxpY3RzIGFyZSBkYXRhLFxuICogbm90IGVycm9ycy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvbXB1dGVTeW5jUGxhbihpbnB1dDogU3luY1BsYW5JbnB1dCk6IFN5bmNQbGFuIHtcbiAgY29uc3QgeyBsb2NhbENoYW5nZXMsIGluZGV4LCB0aGlzRGV2aWNlSWQsIHRoaXNEZXZpY2VOYW1lLCBub3cgfSA9IGlucHV0O1xuICBjb25zdCBtYW5pZmVzdCA9IFsuLi5pbnB1dC5tYW5pZmVzdF0uc29ydCgoYSwgYikgPT4gY29tcGFyZVN0cmluZ3MoYS5wYXRoLCBiLnBhdGgpKTtcbiAgY29uc3QgbWFuaWZlc3RCeVBhdGggPSBuZXcgTWFwKG1hbmlmZXN0Lm1hcCgoZW50cnkpID0+IFtlbnRyeS5wYXRoLCBlbnRyeV0pKTtcblxuICBjb25zdCBwdXNoZXM6IFB1c2hPcFtdID0gW107XG4gIGNvbnN0IHB1bGxzOiBQdWxsT3BbXSA9IFtdO1xuICBjb25zdCBjb25mbGljdHM6IENvbmZsaWN0T3BbXSA9IFtdO1xuXG4gIC8vIEV2ZXJ5IHBhdGggdGhlIGxvY2FsIHNpZGUgZGl2ZXJnZWQgb24gKHNjYW4gYnVja2V0cyArIGJvdGggZW5kcyBvZiByZW5hbWVzKS5cbiAgY29uc3QgbG9jYWxQYXRocyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBmb3IgKGNvbnN0IGMgb2YgbG9jYWxDaGFuZ2VzLmFkZGVkKSBsb2NhbFBhdGhzLmFkZChjLnBhdGgpO1xuICBmb3IgKGNvbnN0IGMgb2YgbG9jYWxDaGFuZ2VzLm1vZGlmaWVkKSBsb2NhbFBhdGhzLmFkZChjLnBhdGgpO1xuICBmb3IgKGNvbnN0IGQgb2YgbG9jYWxDaGFuZ2VzLmRlbGV0ZWQpIGxvY2FsUGF0aHMuYWRkKGQucGF0aCk7XG4gIGZvciAoY29uc3QgciBvZiBsb2NhbENoYW5nZXMucmVuYW1lZCkge1xuICAgIGxvY2FsUGF0aHMuYWRkKHIuZnJvbSk7XG4gICAgbG9jYWxQYXRocy5hZGQoci50byk7XG4gIH1cbiAgZm9yIChjb25zdCBmIG9mIGxvY2FsQ2hhbmdlcy5mb2xkZXJEZWxldGlvbnMpIGxvY2FsUGF0aHMuYWRkKGYucGF0aCk7XG5cbiAgLy8gUGF0aHMgYWxyZWFkeSBjb25zdW1lZCBieSBhbiBlYXJsaWVyIHBoYXNlIChyZW5hbWUgY29ycmVsYXRpb24gZXRjLikuXG4gIGNvbnN0IGNvbnN1bWVkID0gbmV3IFNldDxzdHJpbmc+KCk7XG5cbiAgY29uc3QgcGF0aEV4aXN0cyA9IChwYXRoOiBzdHJpbmcpOiBib29sZWFuID0+IHBhdGggaW4gaW5kZXggfHwgbWFuaWZlc3RCeVBhdGguaGFzKHBhdGgpO1xuXG4gIC8vIC0tLSBQaGFzZSBBOiBsb2NhbCByZW5hbWVzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAvLyBVbmNvbnRlc3RlZDogb25lIFB1c2hSZW5hbWVPcC4gQ29udGVzdGVkIChyZW1vdGUgY2hhbmdlZCBhdCBlaXRoZXIgZW5kKTpcbiAgLy8gZGVjb21wb3NlIFx1MjAxNCB0aGUgYGZyb21gIHNpZGUgaXMgcmVzb2x2ZWQgb24gaXRzIG93biAodXN1YWxseSB0b21ic3RvbmVkXG4gIC8vIG9yIHB1bGxlZCksIHRoZSByZW5hbWVkIGNvbnRlbnQgaXMgcGxhY2VkIGF0IGB0b2AgdGhyb3VnaCB0aGUgZ2VuZXJpY1xuICAvLyBjb250ZW50IG1hY2hpbmVyeS4gQ29udGVudCBpcyBuZXZlciBsb3N0IGVpdGhlciB3YXkuXG4gIGZvciAoY29uc3QgcmVuYW1lIG9mIFsuLi5sb2NhbENoYW5nZXMucmVuYW1lZF0uc29ydCgoYSwgYikgPT4gY29tcGFyZVN0cmluZ3MoYS5mcm9tLCBiLmZyb20pKSkge1xuICAgIGNvbnN0IGluZGV4RnJvbSA9IGluZGV4W3JlbmFtZS5mcm9tXTtcbiAgICBjb25zdCBpbmRleFRvID0gaW5kZXhbcmVuYW1lLnRvXTtcbiAgICBjb25zdCByZW1vdGVGcm9tID0gbWFuaWZlc3RCeVBhdGguZ2V0KHJlbmFtZS5mcm9tKTtcbiAgICBjb25zdCByZW1vdGVUbyA9IG1hbmlmZXN0QnlQYXRoLmdldChyZW5hbWUudG8pO1xuXG4gICAgY29uc3QgZnJvbUNoYW5nZWQgPSByZW1vdGVGcm9tXG4gICAgICA/IHJlbW90ZUVudHJ5Q2hhbmdlZChpbmRleEZyb20sIHJlbW90ZUZyb20pXG4gICAgICA6IGluZGV4RnJvbT8uZGVsZXRlZEF0ID09PSB1bmRlZmluZWQ7IC8vIGFic2VudCByZW1vdGVseSArIGxpdmUgbG9jYWxseSBcdTIxRDIgY2hhbmdlZFxuICAgIGNvbnN0IHRvQ2hhbmdlZCA9IHJlbW90ZVRvXG4gICAgICA/IHJlbW90ZUVudHJ5Q2hhbmdlZChpbmRleFRvLCByZW1vdGVUbylcbiAgICAgIDogZmFsc2U7IC8vIGFic2VudCByZW1vdGVseSBcdTIxRDIgbm90aGluZyB0byByYWNlIGF0IGB0b2BcblxuICAgIGlmICghZnJvbUNoYW5nZWQgJiYgIXRvQ2hhbmdlZCkge1xuICAgICAgcHVzaGVzLnB1c2goe1xuICAgICAgICBraW5kOiAncmVuYW1lJyxcbiAgICAgICAgZnJvbVBhdGg6IHJlbmFtZS5mcm9tLFxuICAgICAgICB0b1BhdGg6IHJlbmFtZS50byxcbiAgICAgICAgcGFyZW50VmVyc2lvbjogaW5kZXhGcm9tPy52ZXJzaW9uSWQgPz8gbnVsbCxcbiAgICAgICAgaGFzaDogcmVuYW1lLmhhc2gsXG4gICAgICAgIHNpemU6IHJlbmFtZS5zaXplLFxuICAgICAgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBgZnJvbWAgc2lkZSBvZiBhIGNvbnRlc3RlZCByZW5hbWU6XG4gICAgaWYgKCFmcm9tQ2hhbmdlZCkge1xuICAgICAgLy8gTm90aGluZyByZW1vdGUgdGhlcmUgXHUyMDE0IHRoZSBtb3ZlIGl0c2VsZiByZW1vdmVzIHRoZSBvbGQgcGF0aC5cbiAgICAgIGlmIChpbmRleEZyb20gJiYgaW5kZXhGcm9tLmRlbGV0ZWRBdCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHB1c2hlcy5wdXNoKHtcbiAgICAgICAgICBraW5kOiAnZGVsZXRlJyxcbiAgICAgICAgICBwYXRoOiByZW5hbWUuZnJvbSxcbiAgICAgICAgICBwYXJlbnRWZXJzaW9uOiBpbmRleEZyb20udmVyc2lvbklkLFxuICAgICAgICAgIGhhc2g6IGluZGV4RnJvbS5oYXNoLFxuICAgICAgICAgIHNpemU6IGluZGV4RnJvbS5zaXplLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKCFyZW1vdGVGcm9tIHx8IHJlbW90ZUZyb20uZGVsZXRlZCkge1xuICAgICAgLy8gUmVtb3RlIGRlbGV0ZWQgKG9yIG1pZ3JhdGVkIGF3YXkgZnJvbSkgYGZyb21gIFx1MjAxNCBkZWxldGlvbiBzdGFuZHMgZm9yXG4gICAgICAvLyB0aGUgb2xkIHBhdGg7IHRoZSByZW5hbWVkIGNvbnRlbnQgc3Vydml2ZXMgYXQgYHRvYC5cbiAgICAgIHB1bGxzLnB1c2goXG4gICAgICAgIHB1bGxGaWxlKCdkZWxldGUnLCByZW5hbWUuZnJvbSwge1xuICAgICAgICAgIGhhc2g6IHJlbW90ZUZyb20/Lmhhc2ggPz8gaW5kZXhGcm9tPy5oYXNoID8/IHJlbmFtZS5oYXNoLFxuICAgICAgICAgIHNpemU6IHJlbW90ZUZyb20/LnNpemUgPz8gaW5kZXhGcm9tPy5zaXplID8/IHJlbmFtZS5zaXplLFxuICAgICAgICAgIHZlcnNpb246IHJlbW90ZUZyb20/LnZlcnNpb24gPz8gJycsXG4gICAgICAgICAgY2xvY2s6IHJlbW90ZUZyb20/LmNsb2NrID8/IGluZGV4RnJvbT8uY2xvY2sgPz8gWkVST19DTE9DSyxcbiAgICAgICAgICBkZWxldGVkOiB0cnVlLFxuICAgICAgICB9KSxcbiAgICAgICk7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIFJlbW90ZSBlZGl0ZWQgYGZyb21gLiBUaGUgcmVtb3RlIGVkaXQga2VlcHMgdGhlIG9sZCBwYXRoOyB0aGUgbW92ZWRcbiAgICAgIC8vIGNvbnRlbnQgaXMgcGxhY2VkIGF0IGB0b2AgYmVsb3cgXHUyMDE0IGEgcmVuYW1lLXJhY2UgdGhlIGxvY2FsIHNpZGVcbiAgICAgIC8vIGNvbmNlZGVzIHVubGVzcyBpdHMgY2xvY2sgd2lucyB0aGUgcmVuYW1lIHB1c2guXG4gICAgICBjb25zdCBsb2NhbENsb2NrID0gbmV4dENsb2NrKGluZGV4RnJvbT8uY2xvY2ssIHRoaXNEZXZpY2VJZCk7XG4gICAgICBpZiAoY29tcGFyZUNsb2NrcyhyZW1vdGVGcm9tLmNsb2NrLCBsb2NhbENsb2NrKSA+IDApIHtcbiAgICAgICAgcHVsbHMucHVzaChwdWxsRmlsZSgnZWRpdCcsIHJlbmFtZS5mcm9tLCByZW1vdGVGcm9tKSk7XG4gICAgICAgIGNvbmZsaWN0cy5wdXNoKHtcbiAgICAgICAgICBwYXRoOiByZW5hbWUuZnJvbSxcbiAgICAgICAgICByZWFzb246ICdyZW5hbWUtcmFjZScsXG4gICAgICAgICAgd2lubmVyOiAncmVtb3RlJyxcbiAgICAgICAgICAvLyBMb2NhbCBjb250ZW50IGlzIHByZXNlcnZlZCBieSB0aGUgcmVuYW1lIGl0c2VsZiAocHVzaGVkIGF0IGB0b2ApLlxuICAgICAgICAgIGxvc2VyQ29udGVudDogJ2xvY2FsJyxcbiAgICAgICAgICByZW1vdGU6IHJlbW90ZVN1bW1hcnkocmVtb3RlRnJvbSksXG4gICAgICAgICAgbG9jYWxDbG9jayxcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBwdXNoZXMucHVzaCh7XG4gICAgICAgICAga2luZDogJ3JlbmFtZScsXG4gICAgICAgICAgZnJvbVBhdGg6IHJlbmFtZS5mcm9tLFxuICAgICAgICAgIHRvUGF0aDogcmVuYW1lLnRvLFxuICAgICAgICAgIHBhcmVudFZlcnNpb246IGluZGV4RnJvbT8udmVyc2lvbklkID8/IG51bGwsXG4gICAgICAgICAgaGFzaDogcmVuYW1lLmhhc2gsXG4gICAgICAgICAgc2l6ZTogcmVuYW1lLnNpemUsXG4gICAgICAgIH0pO1xuICAgICAgICBjb25mbGljdHMucHVzaCh7XG4gICAgICAgICAgcGF0aDogcmVuYW1lLmZyb20sXG4gICAgICAgICAgcmVhc29uOiAncmVuYW1lLXJhY2UnLFxuICAgICAgICAgIHdpbm5lcjogJ2xvY2FsJyxcbiAgICAgICAgICBsb3NlckNvbnRlbnQ6ICdyZW1vdGUnLFxuICAgICAgICAgIHJlbW90ZTogcmVtb3RlU3VtbWFyeShyZW1vdGVGcm9tKSxcbiAgICAgICAgICBsb2NhbENsb2NrLFxuICAgICAgICB9KTtcbiAgICAgICAgY29udGludWU7IC8vIHRoZSByZW5hbWUgcHVzaCBjYXJyaWVzIHRoZSBjb250ZW50OyBubyBgdG9gIG9wIG5lZWRlZFxuICAgICAgfVxuICAgIH1cblxuICAgIC8vIGB0b2Agc2lkZSBvZiBhIGNvbnRlc3RlZCByZW5hbWU6XG4gICAgaWYgKCF0b0NoYW5nZWQpIHtcbiAgICAgIHB1c2hlcy5wdXNoKHtcbiAgICAgICAga2luZDogaW5kZXhUbz8uZGVsZXRlZEF0ICE9PSB1bmRlZmluZWQgPyAncmVzdG9yZScgOiAnYWRkJyxcbiAgICAgICAgcGF0aDogcmVuYW1lLnRvLFxuICAgICAgICBwYXJlbnRWZXJzaW9uOiBpbmRleFRvPy52ZXJzaW9uSWQgPz8gbnVsbCxcbiAgICAgICAgaGFzaDogcmVuYW1lLmhhc2gsXG4gICAgICAgIHNpemU6IHJlbmFtZS5zaXplLFxuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlc29sdmVDb250ZXN0ZWRQYXRoKHJlbmFtZS50bywgaW5kZXhUbywgcmVtb3RlVG8gYXMgUmVtb3RlRmlsZSwge1xuICAgICAgICBwYXRoOiByZW5hbWUudG8sXG4gICAgICAgIGtpbmQ6IGluZGV4VG8/LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkID8gJ3Jlc3RvcmUnIDogJ2FkZCcsXG4gICAgICAgIGhhc2g6IHJlbmFtZS5oYXNoLFxuICAgICAgICBzaXplOiByZW5hbWUuc2l6ZSxcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIC8vIC0tLSBQaGFzZSBCOiByZW1vdGUgcmVuYW1lcyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAvLyBBIHBhdGggbGl2ZSBpbiB0aGUgaW5kZXggYnV0IEFCU0VOVCBmcm9tIHRoZSBtYW5pZmVzdCB3YXMgbWlncmF0ZWQgYnkgdGhlXG4gIC8vIGF1dGhvcml0eSAodG9tYnN0b25lcyBhcHBlYXIgaW4gdGhlIG1hbmlmZXN0IHdpdGggZGVsZXRlZDp0cnVlIFx1MjAxNCBvbmx5IGFcbiAgLy8gcmVuYW1lIHJlbW92ZXMgYSBwYXRoKS4gQ29ycmVsYXRlIGJ5IGNvbnRlbnQgaGFzaCBhZ2FpbnN0IG5ldyBtYW5pZmVzdFxuICAvLyBwYXRocywgc2FtZS1wYXJlbnQgcHJlZmVycmVkLCBzbWFsbGVzdCBwYXRoIHdpdGhpbiBhIHByZWZlcmVuY2UgY2xhc3MuXG4gIGZvciAoY29uc3QgZnJvbSBvZiBPYmplY3Qua2V5cyhpbmRleClcbiAgICAuZmlsdGVyKChwKSA9PiB7XG4gICAgICBjb25zdCBlbnRyeSA9IGluZGV4W3BdIGFzIExvY2FsSW5kZXhFbnRyeTtcbiAgICAgIHJldHVybiBlbnRyeS5kZWxldGVkQXQgPT09IHVuZGVmaW5lZCAmJiAhZW50cnkuaXNGb2xkZXI7XG4gICAgfSlcbiAgICAuc29ydChjb21wYXJlU3RyaW5ncykpIHtcbiAgICBpZiAobG9jYWxQYXRocy5oYXMoZnJvbSkgfHwgY29uc3VtZWQuaGFzKGZyb20pKSBjb250aW51ZTtcbiAgICBpZiAobWFuaWZlc3RCeVBhdGguaGFzKGZyb20pKSBjb250aW51ZTsgLy8gcHJlc2VudCAobGl2ZSBvciB0b21ic3RvbmVkKSBcdTIxRDIgbm90IG1pZ3JhdGVkXG4gICAgY29uc3QgZW50cnkgPSBpbmRleFtmcm9tXSBhcyBMb2NhbEluZGV4RW50cnk7XG5cbiAgICBsZXQgYmVzdDogUmVtb3RlRmlsZSB8IHVuZGVmaW5lZDtcbiAgICBsZXQgYmVzdFNhbWVEaXIgPSBmYWxzZTtcbiAgICBmb3IgKGNvbnN0IGNhbmRpZGF0ZSBvZiBtYW5pZmVzdCkge1xuICAgICAgaWYgKGNhbmRpZGF0ZS5kZWxldGVkKSBjb250aW51ZTtcbiAgICAgIGlmIChsb2NhbFBhdGhzLmhhcyhjYW5kaWRhdGUucGF0aCkgfHwgY29uc3VtZWQuaGFzKGNhbmRpZGF0ZS5wYXRoKSkgY29udGludWU7XG4gICAgICBjb25zdCBrbm93biA9IGluZGV4W2NhbmRpZGF0ZS5wYXRoXTtcbiAgICAgIGlmIChrbm93biAhPT0gdW5kZWZpbmVkICYmIGtub3duLmRlbGV0ZWRBdCA9PT0gdW5kZWZpbmVkKSBjb250aW51ZTsgLy8gdGFyZ2V0IG5vdCBuZXdcbiAgICAgIGlmIChjYW5kaWRhdGUuaGFzaCAhPT0gZW50cnkuaGFzaCkgY29udGludWU7XG4gICAgICBjb25zdCBzYW1lRGlyID0gcGFyZW50UGF0aChjYW5kaWRhdGUucGF0aCkgPT09IHBhcmVudFBhdGgoZnJvbSk7XG4gICAgICBpZiAoYmVzdCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGJlc3QgPSBjYW5kaWRhdGU7XG4gICAgICAgIGJlc3RTYW1lRGlyID0gc2FtZURpcjtcbiAgICAgIH0gZWxzZSBpZiAoc2FtZURpciAmJiAhYmVzdFNhbWVEaXIpIHtcbiAgICAgICAgYmVzdCA9IGNhbmRpZGF0ZTtcbiAgICAgICAgYmVzdFNhbWVEaXIgPSB0cnVlO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChiZXN0KSB7XG4gICAgICBwdWxscy5wdXNoKHtcbiAgICAgICAga2luZDogJ3JlbmFtZScsXG4gICAgICAgIGZyb21QYXRoOiBmcm9tLFxuICAgICAgICB0b1BhdGg6IGJlc3QucGF0aCxcbiAgICAgICAgaGFzaDogYmVzdC5oYXNoLFxuICAgICAgICBzaXplOiBiZXN0LnNpemUsXG4gICAgICAgIHZlcnNpb246IGJlc3QudmVyc2lvbixcbiAgICAgICAgY2xvY2s6IGJlc3QuY2xvY2ssXG4gICAgICB9KTtcbiAgICAgIGNvbnN1bWVkLmFkZChmcm9tKTtcbiAgICAgIGNvbnN1bWVkLmFkZChiZXN0LnBhdGgpO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBBYnNlbnQgd2l0aG91dCBjb3JyZWxhdGlvbjogdGhlIGF1dGhvcml0eSBubyBsb25nZXIga25vd3MgdGhlIHBhdGguXG4gICAgICAvLyBUcmVhdCBhcyBhIHJlbW90ZSBkZWxldGUgd2l0aCB1bmtub3duIGhlYWQgdmVyc2lvbiAoJycgXHUyMDE0IHRoZSBuZXh0XG4gICAgICAvLyBmdWxsIG1hbmlmZXN0IGhlYWxzIHRoZSB2ZXJzaW9uIGlkKS4gVGhpcyBhbHNvIGNvdmVycyByZW1vdGVcbiAgICAgIC8vIHJlbmFtZStlZGl0LCB3aGljaCBnZW51aW5lbHkgaXMgZGVsZXRlICsgYWRkLlxuICAgICAgcHVsbHMucHVzaChcbiAgICAgICAgcHVsbEZpbGUoJ2RlbGV0ZScsIGZyb20sIHtcbiAgICAgICAgICBoYXNoOiBlbnRyeS5oYXNoLFxuICAgICAgICAgIHNpemU6IGVudHJ5LnNpemUsXG4gICAgICAgICAgdmVyc2lvbjogJycsXG4gICAgICAgICAgY2xvY2s6IGVudHJ5LmNsb2NrLFxuICAgICAgICAgIGRlbGV0ZWQ6IHRydWUsXG4gICAgICAgIH0pLFxuICAgICAgKTtcbiAgICAgIGNvbnN1bWVkLmFkZChmcm9tKTtcbiAgICB9XG4gIH1cblxuICAvLyAtLS0gUGhhc2UgQzogcmVtYWluaW5nIHJlbW90ZS1vbmx5IGNoYW5nZXMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgZm9yIChjb25zdCByZW1vdGUgb2YgbWFuaWZlc3QpIHtcbiAgICBpZiAobG9jYWxQYXRocy5oYXMocmVtb3RlLnBhdGgpIHx8IGNvbnN1bWVkLmhhcyhyZW1vdGUucGF0aCkpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGVudHJ5ID0gaW5kZXhbcmVtb3RlLnBhdGhdO1xuICAgIGlmICghcmVtb3RlRW50cnlDaGFuZ2VkKGVudHJ5LCByZW1vdGUpKSBjb250aW51ZTtcbiAgICBpZiAoZW50cnkgPT09IHVuZGVmaW5lZCkge1xuICAgICAgaWYgKCFyZW1vdGUuZGVsZXRlZCkge1xuICAgICAgICBwdWxscy5wdXNoKHB1bGxGaWxlKCdhZGQnLCByZW1vdGUucGF0aCwgcmVtb3RlKSk7XG4gICAgICAgIGNvbnN1bWVkLmFkZChyZW1vdGUucGF0aCk7XG4gICAgICB9XG4gICAgICAvLyBkZWxldGVkICsgbmV2ZXIga25vd24gbG9jYWxseSBcdTIxRDIgbm90aGluZyB0byBkb1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChyZW1vdGUuZGVsZXRlZCkge1xuICAgICAgcHVsbHMucHVzaChwdWxsRmlsZSgnZGVsZXRlJywgcmVtb3RlLnBhdGgsIHJlbW90ZSkpOyAvLyBpbmNsdWRlcyB0b21ic3RvbmVcdTIxOTJ0b21ic3RvbmUgdmVyc2lvbiBjYXRjaC11cFxuICAgIH0gZWxzZSBpZiAoZW50cnkuZGVsZXRlZEF0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHB1bGxzLnB1c2gocHVsbEZpbGUoJ3Jlc3RvcmUnLCByZW1vdGUucGF0aCwgcmVtb3RlKSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHB1bGxzLnB1c2gocHVsbEZpbGUoJ2VkaXQnLCByZW1vdGUucGF0aCwgcmVtb3RlKSk7XG4gICAgfVxuICAgIGNvbnN1bWVkLmFkZChyZW1vdGUucGF0aCk7XG4gIH1cblxuICAvLyAtLS0gUGhhc2UgRDogbG9jYWwgY2FuZGlkYXRlcyAobG9jYWwtb25seSBwdXNoZXMgKyBib3RoLWNoYW5nZWQpIC0tLS0tLS1cbiAgY29uc3QgY2FuZGlkYXRlczogTG9jYWxDYW5kaWRhdGVbXSA9IFtcbiAgICAuLi5sb2NhbENoYW5nZXMuYWRkZWQubWFwKChjKSA9PiAoeyAuLi5jLCBraW5kOiAnYWRkJyBhcyBjb25zdCB9KSksXG4gICAgLi4ubG9jYWxDaGFuZ2VzLm1vZGlmaWVkLm1hcCgoYykgPT4gKHtcbiAgICAgIC4uLmMsXG4gICAgICBraW5kOiBpbmRleFtjLnBhdGhdPy5kZWxldGVkQXQgIT09IHVuZGVmaW5lZCA/ICgncmVzdG9yZScgYXMgY29uc3QpIDogKCdlZGl0JyBhcyBjb25zdCksXG4gICAgfSkpLFxuICAgIC4uLmxvY2FsQ2hhbmdlcy5kZWxldGVkLm1hcCgoZCk6IExvY2FsQ2FuZGlkYXRlID0+ICh7IC4uLmQsIGtpbmQ6ICdkZWxldGUnIH0pKSxcbiAgICAvLyBGb2xkZXIgcGxhY2Vob2xkZXJzIHdob3NlIGRpcmVjdG9yeSB2YW5pc2hlZDogdG9tYnN0b25lIHB1c2hlcy4gVGhleVxuICAgIC8vIGNhcnJ5IG5vIGNvbnRlbnQgKGhhc2ggJycvc2l6ZSAwKSBhbmQgY2FuIG5ldmVyIHBhaXIgd2l0aCBhbiBhZGQsIHNvXG4gICAgLy8gdGhleSBqb2luIGhlcmUgcmF0aGVyIHRoYW4gdGhlIGBkZWxldGVkYCBidWNrZXQgKHJlbmFtZSBjb3JyZWxhdGlvbixcbiAgICAvLyBjb25mbGljdCBjb3BpZXMgXHUyMDE0IG5laXRoZXIgYXBwbGllcyB0byBwbGFjZWhvbGRlcnMpLlxuICAgIC4uLmxvY2FsQ2hhbmdlcy5mb2xkZXJEZWxldGlvbnMubWFwKFxuICAgICAgKGYpOiBMb2NhbENhbmRpZGF0ZSA9PiAoe1xuICAgICAgICBwYXRoOiBmLnBhdGgsXG4gICAgICAgIGtpbmQ6ICdkZWxldGUnLFxuICAgICAgICBoYXNoOiAnJyxcbiAgICAgICAgc2l6ZTogMCxcbiAgICAgICAgaXNGb2xkZXI6IHRydWUsXG4gICAgICB9KSxcbiAgICApLFxuICBdLnNvcnQoKGEsIGIpID0+IGNvbXBhcmVTdHJpbmdzKGEucGF0aCwgYi5wYXRoKSk7XG5cbiAgZm9yIChjb25zdCBjYW5kaWRhdGUgb2YgY2FuZGlkYXRlcykge1xuICAgIGNvbnN0IGVudHJ5ID0gaW5kZXhbY2FuZGlkYXRlLnBhdGhdO1xuICAgIGNvbnN0IHJlbW90ZSA9IG1hbmlmZXN0QnlQYXRoLmdldChjYW5kaWRhdGUucGF0aCk7XG4gICAgY29uc3QgcmVtb3RlQ2hhbmdlZEhlcmUgPVxuICAgICAgcmVtb3RlICE9PSB1bmRlZmluZWQgJiYgKGVudHJ5ICE9PSB1bmRlZmluZWQgPyByZW1vdGUudmVyc2lvbiAhPT0gZW50cnkudmVyc2lvbklkIDogIXJlbW90ZS5kZWxldGVkKTtcbiAgICBpZiAoIXJlbW90ZUNoYW5nZWRIZXJlKSB7XG4gICAgICBwdXNoTG9jYWwoY2FuZGlkYXRlLCBlbnRyeSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlc29sdmVDb250ZXN0ZWRQYXRoKGNhbmRpZGF0ZS5wYXRoLCBlbnRyeSwgcmVtb3RlIGFzIFJlbW90ZUZpbGUsIGNhbmRpZGF0ZSk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBwdXNoZXM6IHB1c2hlcy5zb3J0KChhLCBiKSA9PiBjb21wYXJlU3RyaW5ncyhvcFBhdGgoYSksIG9wUGF0aChiKSkpLFxuICAgIHB1bGxzOiBwdWxscy5zb3J0KGNvbXBhcmVQdWxsT3BzKSxcbiAgICBjb25mbGljdHM6IGNvbmZsaWN0cy5zb3J0KChhLCBiKSA9PiBjb21wYXJlU3RyaW5ncyhhLnBhdGgsIGIucGF0aCkpLFxuICAgIGZvbGRlclB1c2hlczogWy4uLmxvY2FsQ2hhbmdlcy5lbXB0eUZvbGRlcnNdLnNvcnQoY29tcGFyZVN0cmluZ3MpLFxuICB9O1xuXG4gIC8vIC0tLSBoZWxwZXJzIChjbG9zZSBvdmVyIHRoZSBhY2N1bXVsYXRvcnMpIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIGZ1bmN0aW9uIHB1c2hMb2NhbChjYW5kaWRhdGU6IExvY2FsQ2FuZGlkYXRlLCBlbnRyeTogTG9jYWxJbmRleEVudHJ5IHwgdW5kZWZpbmVkKTogdm9pZCB7XG4gICAgaWYgKGNhbmRpZGF0ZS5raW5kID09PSAnZGVsZXRlJykge1xuICAgICAgcHVzaGVzLnB1c2goe1xuICAgICAgICBraW5kOiAnZGVsZXRlJyxcbiAgICAgICAgcGF0aDogY2FuZGlkYXRlLnBhdGgsXG4gICAgICAgIHBhcmVudFZlcnNpb246IGVudHJ5Py52ZXJzaW9uSWQgPz8gbnVsbCxcbiAgICAgICAgaGFzaDogZW50cnk/Lmhhc2ggPz8gY2FuZGlkYXRlLmhhc2gsXG4gICAgICAgIHNpemU6IGVudHJ5Py5zaXplID8/IGNhbmRpZGF0ZS5zaXplLFxuICAgICAgICAuLi4oY2FuZGlkYXRlLmlzRm9sZGVyID8geyBpc0ZvbGRlcjogdHJ1ZSB9IDoge30pLFxuICAgICAgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHB1c2hlcy5wdXNoKHtcbiAgICAgIGtpbmQ6IGNhbmRpZGF0ZS5raW5kLFxuICAgICAgcGF0aDogY2FuZGlkYXRlLnBhdGgsXG4gICAgICBwYXJlbnRWZXJzaW9uOiBlbnRyeT8udmVyc2lvbklkID8/IG51bGwsXG4gICAgICBoYXNoOiBjYW5kaWRhdGUuaGFzaCxcbiAgICAgIHNpemU6IGNhbmRpZGF0ZS5zaXplLFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIEJvdGggc2lkZXMgY2hhbmdlZCBvbmUgcGF0aC4gQXJiaXRyYXRlIHBlciBcdTAwQTc0LiBMb2NhbCBkZWxldGlvbnMgbmV2ZXIgZ2V0XG4gICAqIGEgY29uZmxpY3QgY29weSAobm8gY29udGVudCB0byBwcmVzZXJ2ZSk7IGxvY2FsICpjb250ZW50KiB0aGF0IGxvc2VzIGlzXG4gICAqIHByZXNlcnZlZCB2aWEgYSBjb25mbGljdC1jb3B5IHB1c2guXG4gICAqL1xuICBmdW5jdGlvbiByZXNvbHZlQ29udGVzdGVkUGF0aChcbiAgICBwYXRoOiBzdHJpbmcsXG4gICAgZW50cnk6IExvY2FsSW5kZXhFbnRyeSB8IHVuZGVmaW5lZCxcbiAgICByZW1vdGU6IFJlbW90ZUZpbGUsXG4gICAgbG9jYWw6IExvY2FsQ2FuZGlkYXRlLFxuICApOiB2b2lkIHtcbiAgICBjb25zdCBsb2NhbENsb2NrID0gbmV4dENsb2NrKGVudHJ5Py5jbG9jaywgdGhpc0RldmljZUlkKTtcbiAgICBjb25zdCByZW1vdGVXaW5zID0gY29tcGFyZUNsb2NrcyhyZW1vdGUuY2xvY2ssIGxvY2FsQ2xvY2spID4gMDsgLy8gMCBcdTIxRDIgbG9jYWwgKGRvY3VtZW50ZWQpXG4gICAgY29uc3Qgc3VtbWFyeSA9IHJlbW90ZVN1bW1hcnkocmVtb3RlKTtcbiAgICBjb25zdCByZWFzb246IENvbmZsaWN0UmVhc29uID1cbiAgICAgIGxvY2FsLmtpbmQgPT09ICdkZWxldGUnIHx8IHJlbW90ZS5kZWxldGVkXG4gICAgICAgID8gJ2RlbGV0ZS12cy1lZGl0J1xuICAgICAgICA6IGVudHJ5ID09PSB1bmRlZmluZWRcbiAgICAgICAgICA/ICdhZGQtdnMtYWRkJ1xuICAgICAgICAgIDogJ2NvbmN1cnJlbnQtZWRpdCc7XG5cbiAgICBpZiAobG9jYWwua2luZCA9PT0gJ2RlbGV0ZScgJiYgcmVtb3RlLmRlbGV0ZWQpIHtcbiAgICAgIC8vIEJvdGggZGVsZXRlZCBcdTIwMTQgY29udmVyZ2Ugc2lsZW50bHkgb24gdGhlIHJlbW90ZSB0b21ic3RvbmUuXG4gICAgICBwdWxscy5wdXNoKHB1bGxGaWxlKCdkZWxldGUnLCBwYXRoLCByZW1vdGUpKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAobG9jYWwua2luZCA9PT0gJ2RlbGV0ZScpIHtcbiAgICAgIC8vIExvY2FsIGRlbGV0ZSB2cyByZW1vdGUgZWRpdC5cbiAgICAgIGlmIChyZW1vdGVXaW5zKSB7XG4gICAgICAgIHB1bGxzLnB1c2gocHVsbEZpbGUoJ2VkaXQnLCBwYXRoLCByZW1vdGUpKTsgLy8gZmlsZSBpcyByZWNyZWF0ZWRcbiAgICAgICAgY29uZmxpY3RzLnB1c2goe1xuICAgICAgICAgIHBhdGgsIHJlYXNvbiwgd2lubmVyOiAncmVtb3RlJywgbG9zZXJDb250ZW50OiAnbm9uZScsXG4gICAgICAgICAgcmVtb3RlOiBzdW1tYXJ5LCBsb2NhbENsb2NrLFxuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHB1c2hlcy5wdXNoKHtcbiAgICAgICAgICBraW5kOiAnZGVsZXRlJyxcbiAgICAgICAgICBwYXRoLFxuICAgICAgICAgIHBhcmVudFZlcnNpb246IGVudHJ5Py52ZXJzaW9uSWQgPz8gbnVsbCxcbiAgICAgICAgICBoYXNoOiBlbnRyeT8uaGFzaCA/PyBsb2NhbC5oYXNoLFxuICAgICAgICAgIHNpemU6IGVudHJ5Py5zaXplID8/IGxvY2FsLnNpemUsXG4gICAgICAgICAgLi4uKGxvY2FsLmlzRm9sZGVyID8geyBpc0ZvbGRlcjogdHJ1ZSB9IDoge30pLFxuICAgICAgICB9KTtcbiAgICAgICAgY29uZmxpY3RzLnB1c2goe1xuICAgICAgICAgIHBhdGgsIHJlYXNvbiwgd2lubmVyOiAnbG9jYWwnLCBsb3NlckNvbnRlbnQ6ICdyZW1vdGUnLFxuICAgICAgICAgIHJlbW90ZTogc3VtbWFyeSwgbG9jYWxDbG9jayxcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKHJlbW90ZS5kZWxldGVkKSB7XG4gICAgICAvLyBMb2NhbCBlZGl0IHZzIHJlbW90ZSBkZWxldGUuXG4gICAgICBpZiAocmVtb3RlV2lucykge1xuICAgICAgICBwdWxscy5wdXNoKHB1bGxGaWxlKCdkZWxldGUnLCBwYXRoLCByZW1vdGUpKTtcbiAgICAgICAgY29uZmxpY3RzLnB1c2goe1xuICAgICAgICAgIHBhdGgsIHJlYXNvbiwgd2lubmVyOiAncmVtb3RlJywgbG9zZXJDb250ZW50OiAnbG9jYWwnLFxuICAgICAgICAgIGNvbmZsaWN0Q29weVBhdGg6IHB1c2hDb25mbGljdENvcHkocGF0aCwgbG9jYWwsIHJlbW90ZSksXG4gICAgICAgICAgcmVtb3RlOiBzdW1tYXJ5LCBsb2NhbENsb2NrLFxuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHB1c2hlcy5wdXNoKHtcbiAgICAgICAgICBraW5kOiBsb2NhbC5raW5kLFxuICAgICAgICAgIHBhdGgsXG4gICAgICAgICAgcGFyZW50VmVyc2lvbjogZW50cnk/LnZlcnNpb25JZCA/PyBudWxsLFxuICAgICAgICAgIGhhc2g6IGxvY2FsLmhhc2gsXG4gICAgICAgICAgc2l6ZTogbG9jYWwuc2l6ZSxcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbmZsaWN0cy5wdXNoKHtcbiAgICAgICAgICBwYXRoLCByZWFzb24sIHdpbm5lcjogJ2xvY2FsJywgbG9zZXJDb250ZW50OiAnbm9uZScsXG4gICAgICAgICAgcmVtb3RlOiBzdW1tYXJ5LCBsb2NhbENsb2NrLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBDb25jdXJyZW50IGNvbnRlbnQgKGVkaXQtdnMtZWRpdCBvciBhZGQtdnMtYWRkKS5cbiAgICBpZiAobG9jYWwuaGFzaCA9PT0gcmVtb3RlLmhhc2gpIHtcbiAgICAgIC8vIEJ5dGUtaWRlbnRpY2FsIGNvbnRlbnQgb24gYm90aCBzaWRlcyAoYSBzZWNvbmQgZGV2aWNlIHBhaXJpbmcgb3ZlclxuICAgICAgLy8gZmlsZXMgaXQgYWxyZWFkeSBoYXMsIG9yIGJvdGggc2lkZXMgbWFraW5nIHRoZSBzYW1lIGVkaXQpOiBub3RoaW5nXG4gICAgICAvLyBkaXN0aW5jdCB0byBwcmVzZXJ2ZSwgc28gbm8gY29uZmxpY3QgcmVjb3JkIGFuZCBubyBjb3B5IFx1MjAxNCBjb252ZXJnZVxuICAgICAgLy8gc2lsZW50bHkgb24gdGhlIHJlbW90ZSBoZWFkIHJlZ2FyZGxlc3Mgb2YgY2xvY2sgb3JkZXIgKG1pcnJvcnMgdGhlXG4gICAgICAvLyBzZXJ2ZXIncyBhcmJpdHJhdGlvbiwgd2hpY2ggc3ludGhlc2l6ZXMgbm8gY29weSBmb3IgaWRlbnRpY2FsIGNvbnRlbnQpLlxuICAgICAgcHVsbHMucHVzaChcbiAgICAgICAgcHVsbEZpbGUoZW50cnk/LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkID8gJ3Jlc3RvcmUnIDogZW50cnkgPT09IHVuZGVmaW5lZCA/ICdhZGQnIDogJ2VkaXQnLCBwYXRoLCByZW1vdGUpLFxuICAgICAgKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKHJlbW90ZVdpbnMpIHtcbiAgICAgIHB1bGxzLnB1c2goXG4gICAgICAgIHB1bGxGaWxlKGVudHJ5Py5kZWxldGVkQXQgIT09IHVuZGVmaW5lZCA/ICdyZXN0b3JlJyA6IGVudHJ5ID09PSB1bmRlZmluZWQgPyAnYWRkJyA6ICdlZGl0JywgcGF0aCwgcmVtb3RlKSxcbiAgICAgICk7XG4gICAgICBjb25mbGljdHMucHVzaCh7XG4gICAgICAgIHBhdGgsIHJlYXNvbiwgd2lubmVyOiAncmVtb3RlJywgbG9zZXJDb250ZW50OiAnbG9jYWwnLFxuICAgICAgICBjb25mbGljdENvcHlQYXRoOiBwdXNoQ29uZmxpY3RDb3B5KHBhdGgsIGxvY2FsLCByZW1vdGUpLFxuICAgICAgICByZW1vdGU6IHN1bW1hcnksIGxvY2FsQ2xvY2ssXG4gICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgcHVzaGVzLnB1c2goe1xuICAgICAgICBraW5kOiBsb2NhbC5raW5kLFxuICAgICAgICBwYXRoLFxuICAgICAgICAvLyBEZWxpYmVyYXRlbHkgdGhlIChzdGFsZSkgaW5kZXggcGFyZW50OiB0aGUgRE8gbXVzdCBhcmJpdHJhdGUgYW5kXG4gICAgICAgIC8vIHN5bnRoZXNpemUgdGhlIGNvbmZsaWN0IGNvcHkgZm9yIHRoZSBsb3NpbmcgcmVtb3RlIGNvbnRlbnQuXG4gICAgICAgIHBhcmVudFZlcnNpb246IGVudHJ5Py52ZXJzaW9uSWQgPz8gbnVsbCxcbiAgICAgICAgaGFzaDogbG9jYWwuaGFzaCxcbiAgICAgICAgc2l6ZTogbG9jYWwuc2l6ZSxcbiAgICAgIH0pO1xuICAgICAgY29uZmxpY3RzLnB1c2goe1xuICAgICAgICBwYXRoLCByZWFzb24sIHdpbm5lcjogJ2xvY2FsJywgbG9zZXJDb250ZW50OiAncmVtb3RlJyxcbiAgICAgICAgcmVtb3RlOiBzdW1tYXJ5LCBsb2NhbENsb2NrLFxuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFB1c2ggdGhlIGxvc2luZyBsb2NhbCBjb250ZW50IHRvIGEgY29uZmxpY3QtY29weSBwYXRoOyByZXR1cm5zIHRoZSBwYXRoLFxuICAgKiBvciBgdW5kZWZpbmVkYCB3aGVuIHRoZSBsb3NpbmcgY29udGVudCBpcyBieXRlLWlkZW50aWNhbCB0byB0aGUgd2lubmVyJ3NcbiAgICogKGEgc2FtZS1jb250ZW50IHJhY2UgXHUyMDE0IG5vdGhpbmcgZGlzdGluY3QgdG8gcHJlc2VydmU7IG1hdGNoZXMgdGhlIHNlcnZlcidzXG4gICAqIGFyYml0cmF0aW9uLCB3aGljaCBsaWtld2lzZSBzeW50aGVzaXplcyBubyBjb3B5IGZvciBpZGVudGljYWwgY29udGVudCkuXG4gICAqL1xuICBmdW5jdGlvbiBwdXNoQ29uZmxpY3RDb3B5KHBhdGg6IHN0cmluZywgbG9jYWw6IExvY2FsQ2FuZGlkYXRlLCByZW1vdGU6IFJlbW90ZUZpbGUpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIGlmIChsb2NhbC5oYXNoID09PSByZW1vdGUuaGFzaCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICBjb25zdCBjb3B5UGF0aCA9IGNvbmZsaWN0Q29weVBhdGgocGF0aCwgdGhpc0RldmljZU5hbWUsIG5vdywgcGF0aEV4aXN0cyk7XG4gICAgcHVzaGVzLnB1c2goe1xuICAgICAga2luZDogJ2NvbmZsaWN0Q29weScsXG4gICAgICBwYXRoOiBjb3B5UGF0aCxcbiAgICAgIC8vIEJ1aWxkIG9uIHRoZSB3aW5uaW5nIHJlbW90ZSBoZWFkOiB0aGlzIHB1c2ggbXVzdCBmYXN0LXBhdGguXG4gICAgICBwYXJlbnRWZXJzaW9uOiByZW1vdGUudmVyc2lvbixcbiAgICAgIGhhc2g6IGxvY2FsLmhhc2gsXG4gICAgICBzaXplOiBsb2NhbC5zaXplLFxuICAgIH0pO1xuICAgIHJldHVybiBjb3B5UGF0aDtcbiAgfVxufVxuXG4vLyAtLS0gbW9kdWxlLWxldmVsIGhlbHBlcnMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmZ1bmN0aW9uIHB1bGxGaWxlKFxuICBraW5kOiBQdWxsRmlsZU9wWydraW5kJ10sXG4gIHBhdGg6IHN0cmluZyxcbiAgcmVtb3RlOiBQaWNrPFJlbW90ZUZpbGUsICdoYXNoJyB8ICdzaXplJyB8ICd2ZXJzaW9uJyB8ICdjbG9jaycgfCAnaXNGb2xkZXInPiAmIHtcbiAgICBkZWxldGVkPzogYm9vbGVhbjtcbiAgfSxcbik6IFB1bGxGaWxlT3Age1xuICByZXR1cm4ge1xuICAgIGtpbmQsXG4gICAgcGF0aCxcbiAgICBoYXNoOiByZW1vdGUuaGFzaCxcbiAgICBzaXplOiByZW1vdGUuc2l6ZSxcbiAgICB2ZXJzaW9uOiByZW1vdGUudmVyc2lvbixcbiAgICBjbG9jazogcmVtb3RlLmNsb2NrLFxuICAgIGRlbGV0ZWQ6IHJlbW90ZS5kZWxldGVkID8/IGtpbmQgPT09ICdkZWxldGUnLFxuICAgIC4uLihyZW1vdGUuaXNGb2xkZXIgPyB7IGlzRm9sZGVyOiB0cnVlIH0gOiB7fSksXG4gIH07XG59XG5cbmZ1bmN0aW9uIHJlbW90ZVN1bW1hcnkocmVtb3RlOiBSZW1vdGVGaWxlKTogQ29uZmxpY3RPcFsncmVtb3RlJ10ge1xuICByZXR1cm4ge1xuICAgIHZlcnNpb246IHJlbW90ZS52ZXJzaW9uLFxuICAgIGhhc2g6IHJlbW90ZS5oYXNoLFxuICAgIHNpemU6IHJlbW90ZS5zaXplLFxuICAgIGRlbGV0ZWQ6IHJlbW90ZS5kZWxldGVkLFxuICAgIGNsb2NrOiByZW1vdGUuY2xvY2ssXG4gIH07XG59XG5cbi8qKlxuICogV2hldGhlciB0aGUgcmVtb3RlIGhlYWQgZm9yIGEgcGF0aCBkaWZmZXJzIGZyb20gd2hhdCB0aGUgaW5kZXggcmVjb3Jkcy5cbiAqIFZlcnNpb24gaWRzIGFyZSB0aGUgcHJpbWFyeSBzaWduYWwgKGNsaWVudCBhbmQgRE8gc2hhcmUgb25lIGlkIHNwYWNlKTtcbiAqIGEgcGF0aCBhYnNlbnQgcmVtb3RlbHkgY291bnRzIGFzIGNoYW5nZWQgb25seSB3aGlsZSB0aGUgaW5kZXggc3RpbGwgaG9sZHNcbiAqIGl0IGxpdmUgXHUyMDE0IGNhbGxlcnMgZGVjaWRlIHdoYXQgYWJzZW5jZSAqbWVhbnMqIChyZW5hbWUgdnMgZGVsZXRlKS5cbiAqL1xuZnVuY3Rpb24gcmVtb3RlRW50cnlDaGFuZ2VkKFxuICBlbnRyeTogTG9jYWxJbmRleEVudHJ5IHwgdW5kZWZpbmVkLFxuICByZW1vdGU6IFJlbW90ZUZpbGUgfCB1bmRlZmluZWQsXG4pOiBib29sZWFuIHtcbiAgaWYgKHJlbW90ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gZmFsc2U7XG4gIGlmIChlbnRyeSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gIXJlbW90ZS5kZWxldGVkO1xuICByZXR1cm4gcmVtb3RlLnZlcnNpb24gIT09IGVudHJ5LnZlcnNpb25JZDtcbn1cblxuZnVuY3Rpb24gb3BQYXRoKG9wOiBQdXNoT3AgfCBQdWxsT3ApOiBzdHJpbmcge1xuICByZXR1cm4gb3Aua2luZCA9PT0gJ3JlbmFtZScgPyBvcC50b1BhdGggOiBvcC5wYXRoO1xufVxuXG4vKipcbiAqIERldGVybWluaXN0aWMgcHVsbCBvcmRlciAoYnkgdGFyZ2V0IHBhdGgpLCB3aXRoIE9ORSBjYXJ2ZS1vdXQgZm9yXG4gKiBjYXNlLWluc2Vuc2l0aXZlIGZpbGVzeXN0ZW1zIChXaW5kb3dzLCBtYWNPUyk6IHdoZW4gdHdvIHB1bGwgdGFyZ2V0c1xuICogZGlmZmVyIG9ubHkgYnkgbmFtZSBjYXNlIFx1MjAxNCBlLmcuIGEgcmVuYW1lK2VkaXQgdGhhdCBkZWNvbXBvc2VkIGludG9cbiAqIGBwdWxsIGFkZCAnL05PVEUubWQnYCArIGBwdWxsIGRlbGV0ZSAnL05vdGUubWQnYCBcdTIwMTQgdGhlIERFTEVURSBtdXN0IGFwcGx5XG4gKiBmaXJzdC4gQXBwbGllZCBhZGQtZmlyc3QsIHRoZSBhZGQncyBhdG9taWMgdGVtcCtyZW5hbWUgd3JpdGUgcGh5c2ljYWxseVxuICogcmVwbGFjZXMgdGhlIG9sZC1jYXNlIGZpbGUsIGFuZCB0aGUgc3Vic2VxdWVudCBkZWxldGUgdGhlbiBmaW5kcyBhbmRcbiAqIHJlbW92ZXMgdGhlIGp1c3Qtd3JpdHRlbiBmaWxlIChhZGFwdGVycyByZXNvbHZlIHBhdGhzIGNhc2UtaW5zZW5zaXRpdmVseSksXG4gKiBsZWF2aW5nIGRpc2sgZW1wdHkgd2hpbGUgdGhlIGluZGV4IGhvbGRzIHRoZSBuZXcgcGF0aCBsaXZlIFx1MjAxNCB0aGUgbmV4dCBzY2FuXG4gKiB3b3VsZCBwdXNoIHRoYXQgcGhhbnRvbSBkZWxldGlvbiB2YXVsdC13aWRlLiBEZWxldGUtZmlyc3QgaXMgc2FmZSBvbiBib3RoXG4gKiBmaWxlc3lzdGVtIGNsYXNzZXM6IG9uIGEgY2FzZS1zZW5zaXRpdmUgYWRhcHRlciB0aGUgdHdvIHBhdGhzIGFyZSBkaXN0aW5jdFxuICogZmlsZXMsIHNvIHJlbGF0aXZlIG9yZGVyIGRvZXMgbm90IG1hdHRlcjsgb25seSB0aGUgY2FzZS1jb2xsaWRpbmcgcGFpciBpc1xuICogcmVvcmRlcmVkLCBldmVyeSBvdGhlciBwYWlyIGtlZXBzIHRoZSBleGFjdC1wYXRoIHNvcnQuXG4gKi9cbmZ1bmN0aW9uIGNvbXBhcmVQdWxsT3BzKGE6IFB1bGxPcCwgYjogUHVsbE9wKTogbnVtYmVyIHtcbiAgY29uc3QgYnlFeGFjdCA9IGNvbXBhcmVTdHJpbmdzKG9wUGF0aChhKSwgb3BQYXRoKGIpKTtcbiAgaWYgKGJ5RXhhY3QgPT09IDApIHJldHVybiAwO1xuICBpZiAob3BQYXRoKGEpLnRvTG93ZXJDYXNlKCkgIT09IG9wUGF0aChiKS50b0xvd2VyQ2FzZSgpKSByZXR1cm4gYnlFeGFjdDtcbiAgLy8gQ2FzZS1jb2xsaWRpbmcgcGFpcjogZGVsZXRlcyBiZWZvcmUgd3JpdGVzIChhZGQvZWRpdC9yZW5hbWUvcmVzdG9yZSkuXG4gIGNvbnN0IGFEZWxldGVzID0gYS5raW5kID09PSAnZGVsZXRlJztcbiAgY29uc3QgYkRlbGV0ZXMgPSBiLmtpbmQgPT09ICdkZWxldGUnO1xuICBpZiAoYURlbGV0ZXMgIT09IGJEZWxldGVzKSByZXR1cm4gYURlbGV0ZXMgPyAtMSA6IDE7XG4gIHJldHVybiBieUV4YWN0O1xufVxuXG5mdW5jdGlvbiBjb21wYXJlU3RyaW5ncyhhOiBzdHJpbmcsIGI6IHN0cmluZyk6IG51bWJlciB7XG4gIHJldHVybiBhIDwgYiA/IC0xIDogYSA+IGIgPyAxIDogMDtcbn1cbiIsICIvKipcbiAqIExvY2FsIGNoYW5nZSBkZXRlY3Rpb24gKEFSQ0hJVEVDVFVSRS5tZCBcdTAwQTc4IHN0ZXAgMykuXG4gKlxuICogYHNjYW5WYXVsdGAgd2Fsa3MgdGhlIHN0b3JhZ2UgYWRhcHRlciwgYXBwbGllcyB0aGUgc2hhcmVkIGlnbm9yZSBydWxlcyxcbiAqIGhhc2hlcyBub24taWdub3JlZCBmaWxlcyAoc2hhMjU2IFx1MjAxNCBzYW1lIGFzIGJsb2IgYWRkcmVzc2luZykgYW5kIGRpZmZzXG4gKiB0aGUgcmVzdWx0IGFnYWluc3QgdGhlIGNsaWVudCdzIGBMb2NhbEluZGV4YC4gVGhlIGRpZmYgY2xhc3NpZmllczpcbiAqXG4gKiAgIC0gYGFkZGVkYCAgICBcdTIwMTQgZmlsZSBwcmVzZW50LCBwYXRoIHVua25vd24gdG8gdGhlIGluZGV4O1xuICogICAtIGBtb2RpZmllZGAgXHUyMDE0IGZpbGUgcHJlc2VudCwgY29udGVudCBoYXNoIGRpZmZlcnMgZnJvbSB0aGUgaW5kZXggZW50cnkuXG4gKiAgICAgICAgICAgICAgICAgIEEgZmlsZSB3aG9zZSBpbmRleCBlbnRyeSBpcyBhICp0b21ic3RvbmUqIGFsc28gbGFuZHMgaGVyZVxuICogICAgICAgICAgICAgICAgICAoZG9jdW1lbnRlZCBkZWNpc2lvbik6IHdoZXRoZXIgaXQgaXMgYW4gZWRpdC1vZi1kZWxldGVkXG4gKiAgICAgICAgICAgICAgICAgIG9yIGEgcHVyZSByZXN1cnJlY3QsIHRoZSByZXNvbHV0aW9uIGlzIGlkZW50aWNhbCBcdTIwMTQgbG9jYWxcbiAqICAgICAgICAgICAgICAgICAgY29udGVudCBleGlzdHMgdGhhdCB0aGUgaW5kZXggaGVhZCBkb2VzIG5vdCByZWZsZWN0O1xuICogICAtIGBkZWxldGVkYCAgXHUyMDE0IGluZGV4IGVudHJ5IGxpdmUsIGZpbGUgZ29uZTtcbiAqICAgLSBgcmVuYW1lZGAgIFx1MjAxNCBhIGRlbGV0ZSArIGFkZCBwYWlyICp3aXRoaW4gb25lIHNjYW4qIHdob3NlIGNvbnRlbnRcbiAqICAgICAgICAgICAgICAgICAgaGFzaGVzIG1hdGNoIChBUkNISVRFQ1RVUkUgXHUwMEE3NCByZW5hbWUgY29ycmVsYXRpb24pLiBBXG4gKiAgICAgICAgICAgICAgICAgIHJlbmFtZSB3aG9zZSBjb250ZW50IGFsc28gY2hhbmdlZCAocmVuYW1lICsgZWRpdCkgbm9cbiAqICAgICAgICAgICAgICAgICAgbG9uZ2VyIGNvcnJlbGF0ZXMgYW5kIGZhbGxzIGJhY2sgdG8gZGVsZXRlICsgYWRkIFx1MjAxNCB0aGF0XG4gKiAgICAgICAgICAgICAgICAgIGlzIHRoZSBkb2N1bWVudGVkLCBjb3JyZWN0IHYxIGJlaGF2aW9yO1xuICogICAtIGBlbXB0eUZvbGRlcnNgIFx1MjAxNCBkaXJlY3RvcmllcyBleGlzdGluZyBpbiBzdG9yYWdlIGJ1dCByZXByZXNlbnRlZFxuICogICAgICAgICAgICAgICAgICBuZWl0aGVyIGJ5IGEgbGl2ZSBmb2xkZXIgcGxhY2Vob2xkZXIgaW4gdGhlIGluZGV4IG5vciBieVxuICogICAgICAgICAgICAgICAgICBhbnkgZmlsZSBiZW5lYXRoIHRoZW0gKEZSLTEwKTtcbiAqICAgLSBgZm9sZGVyRGVsZXRpb25zYCBcdTIwMTQgbGl2ZSBmb2xkZXIgcGxhY2Vob2xkZXIgZW50cmllcyB3aG9zZSBkaXJlY3RvcnlcbiAqICAgICAgICAgICAgICAgICAgbm8gbG9uZ2VyIGV4aXN0cyBpbiBzdG9yYWdlOiB0aGUgdXNlciBkZWxldGVkIGFuIGVtcHR5XG4gKiAgICAgICAgICAgICAgICAgIGZvbGRlciAob3IgcHJ1bmUtb24tZGVsZXRlIHJlbW92ZWQgaXQsIGBlbmdpbmUudHNgKSwgYW5kXG4gKiAgICAgICAgICAgICAgICAgIHRoZSBkZWxldGlvbiBtdXN0IHByb3BhZ2F0ZSBhcyBhIGZvbGRlciB0b21ic3RvbmUuIFRoZVxuICogICAgICAgICAgICAgICAgICBidWNrZXQgaXMgU0VQQVJBVEUgZnJvbSBgZGVsZXRlZGAgb24gcHVycG9zZTogZm9sZGVyXG4gKiAgICAgICAgICAgICAgICAgIHBsYWNlaG9sZGVycyBjYXJyeSBubyBjb250ZW50IGhhc2gsIG11c3QgbmV2ZXIgZW50ZXJcbiAqICAgICAgICAgICAgICAgICAgcmVuYW1lIGNvcnJlbGF0aW9uLCBhbmQgcmVzb2x2ZSBhcyBwbGFjZWhvbGRlcnNcbiAqICAgICAgICAgICAgICAgICAgKGBpc0ZvbGRlcmApIGRvd25zdHJlYW0uIEEgcGxhY2Vob2xkZXIgdGhhdCBtZXJlbHkgYmVjYW1lXG4gKiAgICAgICAgICAgICAgICAgIGlnbm9yZWQgKHNldHRpbmdzIGNoYW5nZSkgaXMgTk9UIGEgZGVsZXRpb24gXHUyMDE0IGl0IGlzXG4gKiAgICAgICAgICAgICAgICAgIHNraXBwZWQsIGV4YWN0bHkgbGlrZSBpZ25vcmVkIGZpbGVzLlxuICogICAtIGBzdGFsZURpcnNgIFx1MjAxNCBkaXJlY3RvcmllcyB3aG9zZSBpbmRleCBlbnRyeSBpcyBhIFRPTUJTVE9ORUQgZm9sZGVyXG4gKiAgICAgICAgICAgICAgICAgIHBsYWNlaG9sZGVyIHdoaWxlIGFuIEVNUFRZIGRpcmVjdG9yeSBzdGlsbCBleGlzdHMgb24gZGlza1xuICogICAgICAgICAgICAgICAgICBBTkQgdGhlIHRvbWJzdG9uZSB3YXMgYXV0aG9yZWQgYnkgQU5PVEhFUiBkZXZpY2U6IHRoZVxuICogICAgICAgICAgICAgICAgICByZXNpZHVlIG9mIGEgcmVjb3JkLW9ubHkgdG9tYnN0b25lIGFwcGxpY2F0aW9uIChhbiBhZGFwdGVyXG4gKiAgICAgICAgICAgICAgICAgIHdpdGhvdXQgYHJlbW92ZURpcmAsIG9yIGEgcmVtb3ZhbCB0aGF0IGxvc3QgYSByYWNlKS4gVGhlXG4gKiAgICAgICAgICAgICAgICAgIGxlZnRvdmVyIGlzIENPTlNJU1RFTlQgd2l0aCB0aGUgKHJlbW90ZSkgZGVsZXRpb24sIHNvIGl0XG4gKiAgICAgICAgICAgICAgICAgIG11c3QgTk9UIHJlc3VycmVjdCBhcyBcImxvY2FsIHdpbnNcIjogcmUtcHVzaGluZyBpdCBhcyBhblxuICogICAgICAgICAgICAgICAgICBlbXB0eS1mb2xkZXIgcGxhY2Vob2xkZXIgd291bGQgdW5kbyBhIGRlbGV0aW9uIHRoZSB1c2VyXG4gKiAgICAgICAgICAgICAgICAgIG1hZGUgYW5kIHBpbmctcG9uZyBpdCBiZXR3ZWVuIGRldmljZXMgZm9yZXZlciAob2JzZXJ2ZWRcbiAqICAgICAgICAgICAgICAgICAgZW5kLXRvLWVuZDogQSBkZWxldGVzIFx1MjE5MiBCIHJlY29yZHMtb25seSBcdTIxOTIgQiByZS1wdXNoZXMgXHUyMTkyXG4gKiAgICAgICAgICAgICAgICAgIEEgcmUtcHVsbHMpLiBUaGUgZW50cnkgc3RheXMgdG9tYnN0b25lZDsgdGhlIGNsaWVudCByZXRyaWVzXG4gKiAgICAgICAgICAgICAgICAgIGByZW1vdmVEaXJgIGZvciB0aGVzZSBkaXJzIGVhY2ggY3ljbGUgKGNsaWVudC50cykuIElmIHRoZVxuICogICAgICAgICAgICAgICAgICB0b21ic3RvbmUgd2FzIGF1dGhvcmVkIGJ5IFRISVMgZGV2aWNlLCBvciBjb250ZW50IGV4aXN0c1xuICogICAgICAgICAgICAgICAgICBiZW5lYXRoIHRoZSBkaXJlY3RvcnksIHRoaXMgaXMgZ2VudWluZSBsb2NhbCByZWNyZWF0aW9uOlxuICogICAgICAgICAgICAgICAgICB0aGUgZGlyIGxhbmRzIGluIGBlbXB0eUZvbGRlcnNgIGluc3RlYWQsIHJlc3RvcmluZyB0aGVcbiAqICAgICAgICAgICAgICAgICAgcGxhY2Vob2xkZXIgXHUyMDE0IGxvY2FsIHdpbnMgaXMgY29ycmVjdCB0aGVyZS5cbiAqICAgLSBgY2FzZUNvbGxpc2lvbnNgIFx1MjAxNCBsaXZlIGluZGV4IGVudHJpZXMgd2hvc2UgcGF0aCBkaWZmZXJzIG9ubHkgYnkgY2FzZVxuICogICAgICAgICAgICAgICAgICBmcm9tIGEgZmlsZSBwcmVzZW50IG9uIGRpc2s6IHRoZSBpbnZpc2libGUgdHdpbiBvZiBhXG4gKiAgICAgICAgICAgICAgICAgIGNhc2UtY29sbGlkaW5nIHBhaXIgKEFSQ0hJVEVDVFVSRSBcdTAwQTcxNCkuIE5FVkVSIGRlbGV0ZWQgXHUyMDE0XG4gKiAgICAgICAgICAgICAgICAgIGVtaXR0aW5nIGEgdG9tYnN0b25lIHdvdWxkIGRlc3Ryb3kgdGhlIHR3aW4gb24gdGhlIHNlcnZlclxuICogICAgICAgICAgICAgICAgICBhbmQgb24gY2FzZS1zZW5zaXRpdmUgcGVlcnMuIFN1cmZhY2VkIGFzIGEgZGlhZ25vc3RpY1xuICogICAgICAgICAgICAgICAgICBvbmx5OyB0aGUgY29sbGlzaW9uIHN0YXlzIHVucmVzb2x2ZWQgYnkgZGVzaWduLlxuICogICAtIGB1bnNhZmVQYXRoc2AgXHUyMDE0IGZpbGVzIGFuZCBkaXJlY3RvcmllcyB3aG9zZSBuYW1lcyBhcmUgV2luZG93cy11bnNhZmVcbiAqICAgICAgICAgICAgICAgICAgKHJlc2VydmVkIGRldmljZSBuYW1lcywgdHJhaWxpbmcgZG90L3NwYWNlIFx1MjAxNCBgcGF0aHMudHNgKS5cbiAqICAgICAgICAgICAgICAgICAgTGlrZSBjYXNlIGNvbGxpc2lvbnMgdGhleSBhcmUgbmV2ZXIgcHVzaGVkIGFuZCBuZXZlclxuICogICAgICAgICAgICAgICAgICB0cmVhdGVkIGFzIGRlbGV0aW9uczsgc3VyZmFjZWQgYXMgYSBkaWFnbm9zdGljIG9ubHkuXG4gKlxuICogIyMgVGhlIG10aW1lK3NpemUgcHJlLWZpbHRlciAoZmFzdCBtb2RlLCB0aGUgZGVmYXVsdClcbiAqXG4gKiBSZS1oYXNoaW5nIGEgNTBrLWZpbGUgdmF1bHQgYXQgZXZlcnkgYXBwLW9wZW4gaXMgYSByZWFsIGJhdHRlcnkgY29zdCwgc29cbiAqIGZhc3QgbW9kZSBza2lwcyBoYXNoaW5nIGEgZmlsZSB3aG9zZSBgc2l6ZWAgQU5EIGBtdGltZWAgKGZyb20gdGhlIHN0b3JhZ2VcbiAqIGFkYXB0ZXIncyBgRmlsZVN0YXRgKSBleGFjdGx5IG1hdGNoIGl0cyBsaXZlIGluZGV4IGVudHJ5IFx1MjAxNCB0aGUgcmVjb3JkZWRcbiAqIGhhc2ggY2FycmllcyBmb3J3YXJkIGFzIHVuY2hhbmdlZC4gQSBmaWxlIGlzIGhhc2hlZCB3aGVuIGl0IGhhcyBubyBlbnRyeSxcbiAqIHRoZSBlbnRyeSBpcyBhIHRvbWJzdG9uZSBvciBmb2xkZXIgcGxhY2Vob2xkZXIsIHRoZSBzaXplIGRpZmZlcnMsIG9yIHRoZVxuICogbXRpbWUgZGlmZmVycyBvciBpcyB1bmtub3duIChsZWdhY3kgc3RhdGUsIHB1bGxzLCBmaXJzdCBzY2FuKS4gUmVuYW1lXG4gKiBjb3JyZWxhdGlvbiBpcyB1bmFmZmVjdGVkOiB0aGUgZGVzdGluYXRpb24gcGF0aCBvZiBhIHJlbmFtZSBhbHdheXMgbG9va3NcbiAqICdhZGRlZCcsIHNvIGl0IGlzIGFsd2F5cyBoYXNoZWQgXHUyMDE0IGNvbnRlbnQtcHJlc2VydmluZyBtb3ZlcyBzdGlsbCBwYWlyLlxuICpcbiAqIFRoZSB0cmFkZW9mZjogZmFzdCBtb2RlIHRydXN0cyB0aGUgZmlsZXN5c3RlbSBub3QgdG8gY2hhbmdlIGNvbnRlbnQgd2hpbGVcbiAqIHByZXNlcnZpbmcgYm90aCBzaXplIGFuZCBtdGltZS4gRm9yIHZlcmlmaWNhdGlvbiAoYHZzYSBkb2N0b3JgLCBwZXJpb2RpY1xuICogaW50ZWdyaXR5IGNoZWNrcykgcGFzcyBgeyBtb2RlOiAnZnVsbCcgfWAgdG8gcmUtaGFzaCBldmVyeXRoaW5nLlxuICpcbiAqIFRoZSBmdW5jdGlvbiB0YWtlcyBgbm93YCBhbmQgdGhlIGlnbm9yZSBzZXR0aW5ncyBhcyBwYXJhbWV0ZXJzIChubyBoaWRkZW5cbiAqIGNsb2Nrcywgbm8gYW1iaWVudCBjb25maWcpIGFuZCByZXR1cm5zIGRldGVybWluaXN0aWNhbGx5IG9yZGVyZWQgcmVzdWx0c1xuICogKGV2ZXJ5IGJ1Y2tldCBzb3J0ZWQgYnkgcGF0aDsgcmVuYW1lcyBieSBgZnJvbWApLlxuICovXG5cbmltcG9ydCB0eXBlIHsgRmlsZVN0YXQsIFN0b3JhZ2VBZGFwdGVyIH0gZnJvbSAnLi9hZGFwdGVycy5qcyc7XG5pbXBvcnQgeyBzaGEyNTZIZXggfSBmcm9tICcuL2hhc2hpbmcuanMnO1xuaW1wb3J0IHsgaXNJZ25vcmVkLCB0eXBlIElnbm9yZVNldHRpbmdzIH0gZnJvbSAnLi9pZ25vcmUuanMnO1xuaW1wb3J0IHR5cGUgeyBMb2NhbEluZGV4LCBMb2NhbEluZGV4RW50cnkgfSBmcm9tICcuL2xvY2FsaW5kZXguanMnO1xuaW1wb3J0IHsgaXNXaW5kb3dzVW5zYWZlUGF0aCwgcGFyZW50UGF0aCB9IGZyb20gJy4vcGF0aHMuanMnO1xuXG4vKiogSW5qZWN0YWJsZSBjb250ZW50IGhhc2ggKHRoZSBkZWZhdWx0IGlzIHNoYTI1Niwgc2FtZSBhcyBibG9iIGFkZHJlc3NpbmcpLiAqL1xuZXhwb3J0IHR5cGUgSGFzaEZuID0gKGJ5dGVzOiBVaW50OEFycmF5KSA9PiBQcm9taXNlPHN0cmluZz47XG5cbi8qKiBPcHRpb25zIGZvciBgc2NhblZhdWx0YC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU2NhblZhdWx0T3B0aW9ucyB7XG4gIC8qKlxuICAgKiBgJ2Zhc3QnYCAoZGVmYXVsdCk6IGZpbGVzIHdob3NlIHNpemUrbXRpbWUgZXhhY3RseSBtYXRjaCB0aGVpciBsaXZlIGluZGV4XG4gICAqIGVudHJ5IHNraXAgcmUtaGFzaGluZy4gYCdmdWxsJ2A6IGhhc2ggZXZlcnl0aGluZyByZWdhcmRsZXNzIFx1MjAxNCBpbnRlZ3JpdHlcbiAgICogdmVyaWZpY2F0aW9uIChgdnNhIGRvY3RvcmAsIHBlcmlvZGljIGNoZWNrcykuXG4gICAqL1xuICBtb2RlPzogJ2Zhc3QnIHwgJ2Z1bGwnO1xuICAvKiogQ29udGVudCBoYXNoIG92ZXJyaWRlICh0ZXN0cyBjb3VudC9pbnNwZWN0IGhhc2hpbmcpLiBEZWZhdWx0OiBzaGEyNTZIZXguICovXG4gIGhhc2g/OiBIYXNoRm47XG4gIC8qKlxuICAgKiBCdWxrLXNjYW4gcHJvZ3Jlc3M6IGNhbGxlZCBvbmNlIHdpdGggKDAsIHRvdGFsKSBiZWZvcmUgdGhlIHdhbGsgYW5kIG9uY2VcbiAgICogcGVyIGZpbGUgYWZ0ZXJ3YXJkcyAoYGRvbmVgIGNvdW50cyBoYXNoZWQgQU5EIGZhc3QtcGF0aC1za2lwcGVkIGZpbGVzKS5cbiAgICogUHVyZSByZXBvcnRpbmcgXHUyMDE0IG5ldmVyIGFmZmVjdHMgdGhlIHNjYW4ncyBkZWNpc2lvbnMuXG4gICAqL1xuICBvblByb2dyZXNzPzogKGRvbmU6IG51bWJlciwgdG90YWw6IG51bWJlcikgPT4gdm9pZDtcbiAgLyoqXG4gICAqIFRoaXMgZGV2aWNlJ3MgaWQsIHdoZW4gdGhlIGNhbGxlciBpcyBhIHN5bmNpbmcgY2xpZW50LiBTaGFycGVucyB0aGVcbiAgICogdG9tYnN0b25lZC1wbGFjZWhvbGRlciBydWxlIChgc3RhbGVEaXJzYCk6IGFuIEVNUFRZIGRpcmVjdG9yeSBvdmVyIGFcbiAgICogdG9tYnN0b25lZCBwbGFjZWhvbGRlciBpcyB0aGUgcmVjb3JkLW9ubHkgcmVzaWR1ZSBvZiBhIFJFTU9URSBkZWxldGlvblxuICAgKiAobmV2ZXIgcmVzdXJyZWN0ZWQpLCBidXQgb3ZlciBhIHRvbWJzdG9uZSBUSElTIGRldmljZSBhdXRob3JlZCBpdCBtZWFuc1xuICAgKiB0aGUgdXNlciByZS1jcmVhdGVkIHRoZSBmb2xkZXIgaGVyZSBcdTIwMTQgcmVzdG9yZSBpdCAocHVzaCB0aGUgcGxhY2Vob2xkZXIpLlxuICAgKiBPbWl0dGVkIChvciBub24tZm9sZGVyIHNjYW5zKTogb25seSB0aGUgY29udGVudCB0ZXN0IGRlY2lkZXMuXG4gICAqL1xuICB0aGlzRGV2aWNlSWQ/OiBzdHJpbmc7XG59XG5cbi8qKiBBIGxvY2FsIGNvbnRlbnQgY2hhbmdlIGZvciBhIHBhdGggdGhhdCBleGlzdHMgaW4gc3RvcmFnZS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU2NhbkNhbmRpZGF0ZSB7XG4gIHBhdGg6IHN0cmluZztcbiAgaGFzaDogc3RyaW5nO1xuICBzaXplOiBudW1iZXI7XG59XG5cbi8qKiBBIGxvY2FsIGRlbGV0aW9uOiBjYXJyaWVzIHRoZSBpbmRleCdzIHZlcnNpb24gc28gdGhlIHRvbWJzdG9uZSBjb21taXQgbmFtZXMgaXRzIHBhcmVudC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRGVsZXRlZENhbmRpZGF0ZSB7XG4gIHBhdGg6IHN0cmluZztcbiAgLyoqIEhhc2ggb2YgdGhlIGNvbnRlbnQgYXMgbGFzdCBzeW5jZWQgKHRvbWJzdG9uZXMgcmV1c2UgaXQpLiAqL1xuICBoYXNoOiBzdHJpbmc7XG4gIHNpemU6IG51bWJlcjtcbiAgLyoqIFZlcnNpb24gaWQgdGhlIGRlbGV0aW9uIGNvbW1pdCBidWlsZHMgb24uICovXG4gIHZlcnNpb25JZDogc3RyaW5nO1xufVxuXG4vKiogQSBkZXRlY3RlZCByZW5hbWU6IHNhbWUgY29udGVudCBoYXNoIG1vdmVkIGZyb20gYGZyb21gIHRvIGB0b2AuICovXG5leHBvcnQgaW50ZXJmYWNlIFJlbmFtZUNhbmRpZGF0ZSB7XG4gIGZyb206IHN0cmluZztcbiAgdG86IHN0cmluZztcbiAgaGFzaDogc3RyaW5nO1xuICBzaXplOiBudW1iZXI7XG59XG5cbi8qKlxuICogQSBsaXZlIGZvbGRlciBwbGFjZWhvbGRlciB3aG9zZSBkaXJlY3RvcnkgdmFuaXNoZWQgZnJvbSBzdG9yYWdlOiB0aGVcbiAqIGRlbGV0aW9uIG11c3QgcHJvcGFnYXRlIGFzIGEgZm9sZGVyIHRvbWJzdG9uZSAoa2luZCBgJ2RlbGV0ZSdgLFxuICogYGlzRm9sZGVyOiB0cnVlYCkuIENhcnJpZXMgdGhlIHBsYWNlaG9sZGVyJ3MgdmVyc2lvbiBpZCBzbyB0aGUgdG9tYnN0b25lXG4gKiBjb21taXQgbmFtZXMgaXRzIHBhcmVudDsgaGFzaC9zaXplIGFyZSB0aGUgcGxhY2Vob2xkZXIgY29uc3RhbnRzXG4gKiAoYCcnYC9gMGApIGFuZCBhcmUgcmUtZGVyaXZlZCBkb3duc3RyZWFtIHJhdGhlciB0aGFuIGNhcnJpZWQuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRm9sZGVyRGVsZXRpb25DYW5kaWRhdGUge1xuICBwYXRoOiBzdHJpbmc7XG4gIC8qKiBWZXJzaW9uIGlkIG9mIHRoZSBwbGFjZWhvbGRlciBoZWFkIHRoZSB0b21ic3RvbmUgY29tbWl0IGJ1aWxkcyBvbi4gKi9cbiAgdmVyc2lvbklkOiBzdHJpbmc7XG59XG5cbi8qKlxuICogQSBmaWxlIHRoaXMgc2NhbiBhY3R1YWxseSByZWFkIGFuZCBoYXNoZWQsIHdpdGggdGhlIHN0YXQgb2JzZXJ2ZWQgYXQgaGFzaFxuICogdGltZS4gRmVlZHMgYHJlY29yZEhhc2hlZEZpbGVzYCBzbyB0aGUgTkVYVCBmYXN0IHNjYW4gY2FuIHNraXAgdGhlc2UgZmlsZXNcbiAqICh0aGUgbXRpbWUgY2FjaGUgb24gdGhlIGluZGV4IGVudHJ5KS4gRmlsZXMgc2tpcHBlZCBieSB0aGUgcHJlLWZpbHRlciBhcmUsXG4gKiBieSBkZWZpbml0aW9uLCBub3QgaGFzaGVkIGFuZCBkbyBub3QgYXBwZWFyIGhlcmUuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSGFzaGVkRmlsZSB7XG4gIHBhdGg6IHN0cmluZztcbiAgaGFzaDogc3RyaW5nO1xuICBzaXplOiBudW1iZXI7XG4gIC8qKiBFcG9jaCBtcyBcdTIwMTQgdGhlIHN0b3JhZ2Ugc3RhdCBhdCBoYXNoIHRpbWUgKGBGaWxlU3RhdC5tdGltZWApLiAqL1xuICBtdGltZTogbnVtYmVyO1xufVxuXG4vKiogVGhlIGZ1bGwgcmVzdWx0IG9mIG9uZSBsb2NhbCBzY2FuLiBBbGwgYnVja2V0cyBzb3J0ZWQgYnkgcGF0aC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgTG9jYWxDaGFuZ2VzIHtcbiAgLyoqIFRoZSBgbm93YCBwYXNzZWQgaW4gXHUyMDE0IHdoZW4gdGhpcyBzY2FuIGNvbmNlcHR1YWxseSBoYXBwZW5lZC4gKi9cbiAgc2Nhbm5lZEF0OiBudW1iZXI7XG4gIGFkZGVkOiBTY2FuQ2FuZGlkYXRlW107XG4gIG1vZGlmaWVkOiBTY2FuQ2FuZGlkYXRlW107XG4gIGRlbGV0ZWQ6IERlbGV0ZWRDYW5kaWRhdGVbXTtcbiAgcmVuYW1lZDogUmVuYW1lQ2FuZGlkYXRlW107XG4gIC8qKiBFbXB0eS1mb2xkZXIgcGF0aHMgdG8gcHVzaCBhcyBwbGFjZWhvbGRlciBlbnRyaWVzIChGUi0xMCkuICovXG4gIGVtcHR5Rm9sZGVyczogc3RyaW5nW107XG4gIC8qKlxuICAgKiBMaXZlIGZvbGRlciBwbGFjZWhvbGRlcnMgd2hvc2UgZGlyZWN0b3J5IG5vIGxvbmdlciBleGlzdHMgaW4gc3RvcmFnZSBcdTIwMTRcbiAgICogZm9sZGVyIGRlbGV0aW9ucyB0byBwdXNoIGFzIHRvbWJzdG9uZXMgKGtpbmQgYCdkZWxldGUnYCwgYGlzRm9sZGVyYCkuXG4gICAqL1xuICBmb2xkZXJEZWxldGlvbnM6IEZvbGRlckRlbGV0aW9uQ2FuZGlkYXRlW107XG4gIC8qKlxuICAgKiBEaXJlY3RvcmllcyB3aG9zZSBpbmRleCBlbnRyeSBpcyBhIFRPTUJTVE9ORUQgZm9sZGVyIHBsYWNlaG9sZGVyIHdoaWxlIGFuXG4gICAqIEVNUFRZIGRpcmVjdG9yeSBzdGlsbCBleGlzdHMgb24gZGlzayAocmVjb3JkLW9ubHkgdG9tYnN0b25lIGFwcGxpY2F0aW9uIFx1MjAxNFxuICAgKiBzZWUgdGhlIG1vZHVsZSBkb2MpLiBPbWl0dGVkIChub3QgbWVyZWx5IGVtcHR5KSB3aGVuIHRoZXJlIGFyZSBub25lLCBzb1xuICAgKiB3aG9sZS1vYmplY3QgY29tcGFyaXNvbnMgb2YgYExvY2FsQ2hhbmdlc2Agc3RheSBzdGFibGUgZm9yIGNsZWFuIHNjYW5zLlxuICAgKi9cbiAgc3RhbGVEaXJzPzogc3RyaW5nW107XG4gIC8qKlxuICAgKiBMaXZlIGluZGV4IHBhdGhzIHdob3NlIGZpbGUgaXMgaW52aXNpYmxlIG9uIHRoaXMgZmlsZXN5c3RlbSBiZWNhdXNlXG4gICAqIGFub3RoZXIgZmlsZSBkaWZmZXJzIGZyb20gdGhlbSBvbmx5IGJ5IG5hbWUgY2FzZSAoYSBjYXNlLWNvbGxpZGluZyBwYWlyLFxuICAgKiBjcmVhdGFibGUgZnJvbSBhIGNhc2Utc2Vuc2l0aXZlIGNsaWVudCBcdTIwMTQgQVJDSElURUNUVVJFIFx1MDBBNzE0KS4gVGhlIHNjYW5cbiAgICogbmV2ZXIgZW1pdHMgYSBkZWxldGlvbiBmb3IgdGhlc2UgKHRoZSB0d2luIG9uIGRpc2sgbXVzdCBub3QgYmUgZGVzdHJveWVkXG4gICAqIGJ5IGEgdG9tYnN0b25lIHB1c2gpOyB0aGUgY2xpZW50IHN1cmZhY2VzIHRoZW0gYXMgYSBkaWFnbm9zdGljXG4gICAqIChgU3luY0NsaWVudFN0YXR1cy5jYXNlQ29sbGlzaW9uc2ApLiBPbWl0dGVkIHdoZW4gdGhlcmUgYXJlIG5vbmUuXG4gICAqL1xuICBjYXNlQ29sbGlzaW9ucz86IHN0cmluZ1tdO1xuICAvKipcbiAgICogRmlsZXMgYW5kIGRpcmVjdG9yaWVzIHByZXNlbnQgaW4gc3RvcmFnZSB3aG9zZSBuYW1lcyBjYW5ub3QgYmUgc3luY2VkOlxuICAgKiBXaW5kb3dzLXJlc2VydmVkIGRldmljZSBuYW1lcyAoQ09OLCBOVUwsIENPTTEtOSwgXHUyMDI2KSBvciBzZWdtZW50cyBlbmRpbmdcbiAgICogaW4gYC5gL2AgYCAoYHBhdGhzLnRzYCkuIFRoZXkgYXJlIG5ldmVyIHB1c2hlZCAoYSBXaW5kb3dzIHBlZXIgY291bGRcbiAgICogbm90IG1hdGVyaWFsaXplIHRoZW0pLCBuZXZlciBoYXNoZWQsIGFuZCBuZXZlciB0cmVhdGVkIGFzIGRlbGV0aW9ucyBvZlxuICAgKiB0aGVpciBpbmRleCBlbnRyaWVzOyBzdXJmYWNlZCBhcyBhIGRpYWdub3N0aWNcbiAgICogKGBTeW5jQ2xpZW50U3RhdHVzLnNraXBwZWRQYXRoc2ApIHVudGlsIGEgaHVtYW4gcmVuYW1lcyB0aGVtLiBPbWl0dGVkXG4gICAqIHdoZW4gdGhlcmUgYXJlIG5vbmUuXG4gICAqL1xuICB1bnNhZmVQYXRocz86IHN0cmluZ1tdO1xuICAvKiogRXZlcnkgZmlsZSB0aGUgc2NhbiBoYXNoZWQgKGZhc3QgbW9kZSdzIHNraXBwZWQgZmlsZXMgYXJlIGFic2VudCksIHNvcnRlZCBieSBwYXRoLiAqL1xuICBoYXNoZWQ6IEhhc2hlZEZpbGVbXTtcbn1cblxuLyoqXG4gKiBTY2FuIHRoZSB2YXVsdCBhbmQgZGlmZiBpdCBhZ2FpbnN0IHRoZSBpbmRleC5cbiAqXG4gKiBJbiBmYXN0IG1vZGUgKHRoZSBkZWZhdWx0KSBhIGZpbGUgd2hvc2Ugc2l6ZSBhbmQgbXRpbWUgYm90aCBleGFjdGx5IG1hdGNoXG4gKiBpdHMgbGl2ZSBpbmRleCBlbnRyeSBpcyBOT1QgcmUtaGFzaGVkIFx1MjAxNCB0aGUgcmVjb3JkZWQgaGFzaCBjYXJyaWVzIGZvcndhcmRcbiAqIGFzIHVuY2hhbmdlZCAoc2VlIHRoZSBtb2R1bGUgZG9jIGZvciB0aGUgdHJhZGVvZmYgYW5kIHRoZSBgZnVsbGAgZXNjYXBlXG4gKiBoYXRjaCkuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzY2FuVmF1bHQoXG4gIHN0b3JhZ2U6IFN0b3JhZ2VBZGFwdGVyLFxuICBpbmRleDogTG9jYWxJbmRleCxcbiAgc2V0dGluZ3M6IElnbm9yZVNldHRpbmdzLFxuICBub3c6IG51bWJlcixcbiAgb3B0aW9uczogU2NhblZhdWx0T3B0aW9ucyA9IHt9LFxuKTogUHJvbWlzZTxMb2NhbENoYW5nZXM+IHtcbiAgY29uc3QgaGFzaEZuID0gb3B0aW9ucy5oYXNoID8/IHNoYTI1NkhleDtcbiAgY29uc3QgbW9kZSA9IG9wdGlvbnMubW9kZSA/PyAnZmFzdCc7XG4gIGNvbnN0IG9uUHJvZ3Jlc3MgPSBvcHRpb25zLm9uUHJvZ3Jlc3M7XG4gIGNvbnN0IHRoaXNEZXZpY2VJZCA9IG9wdGlvbnMudGhpc0RldmljZUlkO1xuXG4gIGNvbnN0IGZpbGVzID0gYXdhaXQgc3RvcmFnZS5saXN0RmlsZXMoKTtcblxuICAvLyBXaW5kb3dzLXVuc2FmZSBuYW1lcyBuZXZlciBlbnRlciB0aGUgZGlmZiAobm9yIHRoZSBkaXJlY3RvcnlcbiAgLy8gcmVwcmVzZW50YXRpb24gd2FsayBiZWxvdyk6IHRoZXkgY2Fubm90IGJlIHB1c2hlZCwgYW5kIGVtaXR0aW5nIGFcbiAgLy8gZGVsZXRpb24gb3IgcGxhY2Vob2xkZXIgZm9yIHRoZW0gd291bGQgY2h1cm4gYWdhaW5zdCBhIHNlcnZlciB0aGF0XG4gIC8vIHJlamVjdHMgdGhlIHBhdGguIFRoZXkgc3VyZmFjZSBhcyBkaWFnbm9zdGljcyBpbnN0ZWFkLlxuICBjb25zdCB1bnNhZmVQYXRoczogc3RyaW5nW10gPSBbXTtcbiAgY29uc3Qgc3luY2FibGU6IEZpbGVTdGF0W10gPSBbXTtcbiAgZm9yIChjb25zdCBmaWxlIG9mIGZpbGVzKSB7XG4gICAgaWYgKGlzV2luZG93c1Vuc2FmZVBhdGgoZmlsZS5wYXRoKSkgdW5zYWZlUGF0aHMucHVzaChmaWxlLnBhdGgpO1xuICAgIGVsc2Ugc3luY2FibGUucHVzaChmaWxlKTtcbiAgfVxuXG4gIGNvbnN0IGtlcHQ6IEZpbGVTdGF0W10gPSBbXTtcbiAgZm9yIChjb25zdCBmaWxlIG9mIHN5bmNhYmxlKSB7XG4gICAgaWYgKCFpc0lnbm9yZWQoZmlsZS5wYXRoLCBzZXR0aW5ncykpIGtlcHQucHVzaChmaWxlKTtcbiAgfVxuICBjb25zdCBrZXB0UGF0aHMgPSBuZXcgU2V0KGtlcHQubWFwKChmKSA9PiBmLnBhdGgpKTtcblxuICBjb25zdCBhZGRlZDogU2NhbkNhbmRpZGF0ZVtdID0gW107XG4gIGNvbnN0IG1vZGlmaWVkOiBTY2FuQ2FuZGlkYXRlW10gPSBbXTtcbiAgY29uc3QgaGFzaGVkOiBIYXNoZWRGaWxlW10gPSBbXTtcblxuICBvblByb2dyZXNzPy4oMCwga2VwdC5sZW5ndGgpO1xuICBsZXQgc2Nhbm5lZCA9IDA7XG4gIGZvciAoY29uc3QgZmlsZSBvZiBrZXB0KSB7XG4gICAgY29uc3QgZW50cnkgPSBpbmRleFtmaWxlLnBhdGhdO1xuICAgIGlmIChtb2RlID09PSAnZmFzdCcgJiYgc3RhdE1hdGNoZXNFbnRyeShlbnRyeSwgZmlsZSkpIHtcbiAgICAgIHNjYW5uZWQgKz0gMTtcbiAgICAgIG9uUHJvZ3Jlc3M/LihzY2FubmVkLCBrZXB0Lmxlbmd0aCk7XG4gICAgICBjb250aW51ZTsgLy8gc2l6ZSttdGltZSB1bmNoYW5nZWQgc2luY2UgdGhlIHJlY29yZGVkIGhhc2ggXHUyMDE0IHRydXN0IGl0XG4gICAgfVxuICAgIGNvbnN0IGhhc2ggPSBhd2FpdCBoYXNoRm4oYXdhaXQgc3RvcmFnZS5yZWFkRmlsZShmaWxlLnBhdGgpKTtcbiAgICBoYXNoZWQucHVzaCh7IHBhdGg6IGZpbGUucGF0aCwgaGFzaCwgc2l6ZTogZmlsZS5zaXplLCBtdGltZTogZmlsZS5tdGltZSB9KTtcbiAgICBzY2FubmVkICs9IDE7XG4gICAgb25Qcm9ncmVzcz8uKHNjYW5uZWQsIGtlcHQubGVuZ3RoKTtcbiAgICBpZiAoZW50cnkgPT09IHVuZGVmaW5lZCkge1xuICAgICAgYWRkZWQucHVzaCh7IHBhdGg6IGZpbGUucGF0aCwgaGFzaCwgc2l6ZTogZmlsZS5zaXplIH0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChlbnRyeS5pc0ZvbGRlcikge1xuICAgICAgLy8gQSByZWFsIGZpbGUgcmVwbGFjZWQgYSBmb2xkZXIgcGxhY2Vob2xkZXI6IHRyZWF0IGFzIGNvbnRlbnQgY2hhbmdlLlxuICAgICAgbW9kaWZpZWQucHVzaCh7IHBhdGg6IGZpbGUucGF0aCwgaGFzaCwgc2l6ZTogZmlsZS5zaXplIH0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIC8vIFRvbWJzdG9uZWQgZW50cnkgd2l0aCB0aGUgZmlsZSBiYWNrIFx1MjFEMiBtb2RpZmllZCAocmVzdXJyZWN0IG9yXG4gICAgLy8gZWRpdC1vZi1kZWxldGVkIFx1MjAxNCBib3RoIHJlc29sdmUgdGhlIHNhbWUgd2F5IGRvd25zdHJlYW0pLlxuICAgIGlmIChlbnRyeS5kZWxldGVkQXQgIT09IHVuZGVmaW5lZCB8fCBlbnRyeS5oYXNoICE9PSBoYXNoKSB7XG4gICAgICBtb2RpZmllZC5wdXNoKHsgcGF0aDogZmlsZS5wYXRoLCBoYXNoLCBzaXplOiBmaWxlLnNpemUgfSk7XG4gICAgfVxuICB9XG5cbiAgY29uc3QgZGVsZXRlZDogRGVsZXRlZENhbmRpZGF0ZVtdID0gW107XG4gIGZvciAoY29uc3QgW3BhdGgsIGVudHJ5XSBvZiBPYmplY3QuZW50cmllcyhpbmRleCkpIHtcbiAgICBpZiAoZW50cnkuaXNGb2xkZXIpIGNvbnRpbnVlOyAvLyBmb2xkZXIgcGxhY2Vob2xkZXJzIG5ldmVyIHByb2R1Y2UgZmlsZSBkZWxldGlvbnNcbiAgICBpZiAoZW50cnkuZGVsZXRlZEF0ICE9PSB1bmRlZmluZWQpIGNvbnRpbnVlOyAvLyBhbHJlYWR5IHRvbWJzdG9uZWRcbiAgICBpZiAoa2VwdFBhdGhzLmhhcyhwYXRoKSkgY29udGludWU7XG4gICAgaWYgKGlzSWdub3JlZChwYXRoLCBzZXR0aW5ncykpIHtcbiAgICAgIC8vIFRoZSBwYXRoIGJlY2FtZSBpZ25vcmVkIChzZXR0aW5ncyBjaGFuZ2UpIFx1MjAxNCBub3QgYSBkZWxldGlvbi5cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBkZWxldGVkLnB1c2goeyBwYXRoLCBoYXNoOiBlbnRyeS5oYXNoLCBzaXplOiBlbnRyeS5zaXplLCB2ZXJzaW9uSWQ6IGVudHJ5LnZlcnNpb25JZCB9KTtcbiAgfVxuXG4gIGNvbnN0IHsgcmVuYW1lZCwgZGVsZXRlZDogdW5tYXRjaGVkRGVsZXRlZCwgYWRkZWQ6IHVubWF0Y2hlZEFkZGVkIH0gPSBkZXRlY3RSZW5hbWVzKGRlbGV0ZWQsIGFkZGVkKTtcbiAgY29uc3QgeyBkZWxldGVkOiBzYWZlRGVsZXRlZCwgY2FzZUNvbGxpc2lvbnMgfSA9IHNwbGl0Q2FzZUNvbGxpc2lvbnMoXG4gICAgdW5tYXRjaGVkRGVsZXRlZCxcbiAgICBrZXB0UGF0aHMsXG4gICAgbmV3IFNldChbLi4udW5tYXRjaGVkQWRkZWQubWFwKChjKSA9PiBjLnBhdGgpLCAuLi5tb2RpZmllZC5tYXAoKGMpID0+IGMucGF0aCksIC4uLnJlbmFtZWQubWFwKChyKSA9PiByLnRvKV0pLFxuICApO1xuICBjb25zdCBkaXJzID0gYXdhaXQgc3RvcmFnZS5saXN0RGlycygpO1xuICBjb25zdCBzeW5jYWJsZURpcnM6IHN0cmluZ1tdID0gW107XG4gIGZvciAoY29uc3QgZGlyIG9mIGRpcnMpIHtcbiAgICBpZiAoaXNXaW5kb3dzVW5zYWZlUGF0aChkaXIpKSB1bnNhZmVQYXRocy5wdXNoKGRpcik7XG4gICAgZWxzZSBzeW5jYWJsZURpcnMucHVzaChkaXIpO1xuICB9XG4gIGNvbnN0IHsgZW1wdHlGb2xkZXJzLCBzdGFsZURpcnMgfSA9IGRldGVjdEVtcHR5Rm9sZGVycyhcbiAgICBpbmRleCxcbiAgICBzZXR0aW5ncyxcbiAgICBzeW5jYWJsZSxcbiAgICBzeW5jYWJsZURpcnMsXG4gICAgdGhpc0RldmljZUlkLFxuICApO1xuICBjb25zdCBmb2xkZXJEZWxldGlvbnMgPSBkZXRlY3RGb2xkZXJEZWxldGlvbnMoaW5kZXgsIHNldHRpbmdzLCBzeW5jYWJsZURpcnMpO1xuXG4gIHJldHVybiB7XG4gICAgc2Nhbm5lZEF0OiBub3csXG4gICAgYWRkZWQ6IHNvcnRDYW5kaWRhdGVzKHVubWF0Y2hlZEFkZGVkKSxcbiAgICBtb2RpZmllZDogc29ydENhbmRpZGF0ZXMobW9kaWZpZWQpLFxuICAgIGRlbGV0ZWQ6IFsuLi5zYWZlRGVsZXRlZF0uc29ydChieVBhdGgpLFxuICAgIHJlbmFtZWQ6IFsuLi5yZW5hbWVkXS5zb3J0KChhLCBiKSA9PiBieVBhdGgoYSwgYikpLFxuICAgIGVtcHR5Rm9sZGVycyxcbiAgICBmb2xkZXJEZWxldGlvbnMsXG4gICAgLy8gT21pdHRlZCB3aGVuIGVtcHR5IChub3QgYFtdYCkgXHUyMDE0IHNlZSB0aGUgZmllbGQncyBkb2MuXG4gICAgLi4uKHN0YWxlRGlycy5sZW5ndGggPiAwID8geyBzdGFsZURpcnMgfSA6IHt9KSxcbiAgICAuLi4oY2FzZUNvbGxpc2lvbnMubGVuZ3RoID4gMCA/IHsgY2FzZUNvbGxpc2lvbnMgfSA6IHt9KSxcbiAgICAuLi4odW5zYWZlUGF0aHMubGVuZ3RoID4gMCA/IHsgdW5zYWZlUGF0aHM6IHVuc2FmZVBhdGhzLnNvcnQoY29tcGFyZVN0cmluZ3MpIH0gOiB7fSksXG4gICAgaGFzaGVkOiBbLi4uaGFzaGVkXS5zb3J0KGJ5UGF0aCksXG4gIH07XG59XG5cbi8qKlxuICogQ2FzZS1jb2xsaXNpb24gZ3VhcmQgKEFSQ0hJVEVDVFVSRSBcdTAwQTcxNCk6IGFuIHVubWF0Y2hlZCBkZWxldGlvbiB3aG9zZSBwYXRoXG4gKiBkaWZmZXJzIG9ubHkgYnkgY2FzZSBmcm9tIGEgZmlsZSBQUkVTRU5UIG9uIGRpc2sgaXMgbm90IGEgZGVsZXRpb24gdGhlIHVzZXJcbiAqIG1hZGUgXHUyMDE0IGl0IGlzIHRoZSBpbnZpc2libGUgdHdpbiBvZiBhIGNhc2UtY29sbGlkaW5nIHBhaXIgKGNyZWF0YWJsZSBmcm9tIGFcbiAqIGNhc2Utc2Vuc2l0aXZlIGNsaWVudCwgZS5nLiB0aGUgTGludXggZGFlbW9uKS4gVGhpcyBjYXNlLWluc2Vuc2l0aXZlXG4gKiBmaWxlc3lzdGVtIHNob3dzIG9ubHkgb25lIGRpcmVjdG9yeSBlbnRyeSBmb3IgYm90aCwgc28gZW1pdHRpbmcgdGhlIGRlbGV0ZVxuICogd291bGQgcHVzaCBhIHRvbWJzdG9uZSB0aGF0IGRlc3Ryb3lzIHRoZSB0d2luIHNlcnZlci1zaWRlIGFuZCBvbiBldmVyeVxuICogY2FzZS1zZW5zaXRpdmUgcGVlci4gSW5zdGVhZCB0aGUgcGF0aCBpcyBzdXJmYWNlZCBhcyBhIGBjYXNlQ29sbGlzaW9uc2BcbiAqIGRpYWdub3N0aWMgKG5ldmVyIGEgZGVsZXRpb24gcHVzaCk7IHRoZSBjb2xsaXNpb24gaXRzZWxmIHN0YXlzIHVucmVzb2x2ZWRcbiAqIHVudGlsIGEgaHVtYW4gcmVuYW1lcyBvbmUgb2YgdGhlIHBhaXIuXG4gKlxuICogVGhlIGd1YXJkIGRlbGliZXJhdGVseSBydW5zIEFGVEVSIHJlbmFtZSBjb3JyZWxhdGlvbiBhbmQgc2tpcHMgdHdpbnMgdGhhdFxuICogdGhpcyBzY2FuIHJlcG9ydHMgYXMgYWRkZWQvbW9kaWZpZWQvcmVuYW1lZC10bzogYSBjYXNlLW9ubHkgcmVuYW1lIChvclxuICogcmVuYW1lK2VkaXQpIHRoZSB1c2VyIHBlcmZvcm1lZCBvbiBUSElTIGRldmljZSBwcm9kdWNlcyBleGFjdGx5IHRoYXRcbiAqIGRlbGV0ZSt0d2luLWNoYW5nZWQgc2hhcGUsIGFuZCBpdHMgZGVjb21wb3NpdGlvbiBpbnRvIGRlbGV0ZSthZGQgaXMgdGhlXG4gKiBkb2N1bWVudGVkLCBjb3JyZWN0IGJlaGF2aW9yIChhcHBseVB1bGwgb3JkZXJzIGNhc2UtY29sbGlkaW5nIHB1bGxzXG4gKiBkZWxldGUtZmlyc3QsIGByZXNvbHZlLnRzYCkuIE9ubHkgYSB0d2luIHRoYXQgaXMgb3RoZXJ3aXNlIFVOQ0hBTkdFRCBcdTIwMTRcbiAqIG1lYW5pbmcgaXQgaXMgYSBnZW51aW5lbHkgc2VwYXJhdGUgcmVtb3RlIGZpbGUgdGhpcyBkaXNrIGNhbiBvbmx5IHNob3cgb25lXG4gKiBvZiBcdTIwMTQgc3VwcHJlc3NlcyB0aGUgZGVsZXRpb24uXG4gKi9cbmZ1bmN0aW9uIHNwbGl0Q2FzZUNvbGxpc2lvbnMoXG4gIGRlbGV0ZWQ6IHJlYWRvbmx5IERlbGV0ZWRDYW5kaWRhdGVbXSxcbiAga2VwdFBhdGhzOiBSZWFkb25seVNldDxzdHJpbmc+LFxuICBjaGFuZ2VkUGF0aHM6IFJlYWRvbmx5U2V0PHN0cmluZz4sXG4pOiB7IGRlbGV0ZWQ6IERlbGV0ZWRDYW5kaWRhdGVbXTsgY2FzZUNvbGxpc2lvbnM6IHN0cmluZ1tdIH0ge1xuICBjb25zdCBrZXB0QnlMb3dlciA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KCk7XG4gIGZvciAoY29uc3QgcGF0aCBvZiBrZXB0UGF0aHMpIGtlcHRCeUxvd2VyLnNldChwYXRoLnRvTG93ZXJDYXNlKCksIHBhdGgpO1xuICBjb25zdCBzYWZlRGVsZXRlZDogRGVsZXRlZENhbmRpZGF0ZVtdID0gW107XG4gIGNvbnN0IGNhc2VDb2xsaXNpb25zOiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGNhbmRpZGF0ZSBvZiBkZWxldGVkKSB7XG4gICAgY29uc3QgdHdpbiA9IGtlcHRCeUxvd2VyLmdldChjYW5kaWRhdGUucGF0aC50b0xvd2VyQ2FzZSgpKTtcbiAgICBpZiAodHdpbiAhPT0gdW5kZWZpbmVkICYmICFjaGFuZ2VkUGF0aHMuaGFzKHR3aW4pKSB7XG4gICAgICBjYXNlQ29sbGlzaW9ucy5wdXNoKGNhbmRpZGF0ZS5wYXRoKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBzYWZlRGVsZXRlZC5wdXNoKGNhbmRpZGF0ZSk7XG4gIH1cbiAgcmV0dXJuIHtcbiAgICBkZWxldGVkOiBzYWZlRGVsZXRlZCxcbiAgICBjYXNlQ29sbGlzaW9uczogY2FzZUNvbGxpc2lvbnMuc29ydChjb21wYXJlU3RyaW5ncyksXG4gIH07XG59XG5cbmZ1bmN0aW9uIGNvbXBhcmVTdHJpbmdzKGE6IHN0cmluZywgYjogc3RyaW5nKTogbnVtYmVyIHtcbiAgcmV0dXJuIGEgPCBiID8gLTEgOiBhID4gYiA/IDEgOiAwO1xufVxuXG4vKipcbiAqIFdoZXRoZXIgdGhlIGZpbGUncyBzdGF0IGV4YWN0bHkgbWF0Y2hlcyBpdHMgbGl2ZSBpbmRleCBlbnRyeSBcdTIwMTQgdGhlIGZhc3RcbiAqIG1vZGUgcHJlLWZpbHRlci4gUmVxdWlyZXMgYSBrbm93biByZWNvcmRlZCBgbXRpbWVgIChsZWdhY3kgZW50cmllcyBhbmRcbiAqIHB1bGwtd3JpdHRlbiBlbnRyaWVzIGhhdmUgbm9uZSBcdTIxRDIgaGFzaGVkLCB0aGVuIHJlY29yZGVkKSBhbmQgbmV2ZXIgZmlyZXNcbiAqIGZvciB0b21ic3RvbmVzIChhIHJlc3VycmVjdCBtdXN0IGFsd2F5cyBzdXJmYWNlKSBvciBmb2xkZXIgcGxhY2Vob2xkZXJzLlxuICovXG5mdW5jdGlvbiBzdGF0TWF0Y2hlc0VudHJ5KGVudHJ5OiBMb2NhbEluZGV4RW50cnkgfCB1bmRlZmluZWQsIGZpbGU6IEZpbGVTdGF0KTogYm9vbGVhbiB7XG4gIHJldHVybiAoXG4gICAgZW50cnkgIT09IHVuZGVmaW5lZCAmJlxuICAgIGVudHJ5LmRlbGV0ZWRBdCA9PT0gdW5kZWZpbmVkICYmXG4gICAgZW50cnkuaXNGb2xkZXIgIT09IHRydWUgJiZcbiAgICBlbnRyeS5tdGltZSAhPT0gdW5kZWZpbmVkICYmXG4gICAgZW50cnkubXRpbWUgPT09IGZpbGUubXRpbWUgJiZcbiAgICBlbnRyeS5zaXplID09PSBmaWxlLnNpemVcbiAgKTtcbn1cblxuLyoqXG4gKiBSZWNvcmQgYSBzY2FuJ3MgaGFzaCBvYnNlcnZhdGlvbnMgaW50byB0aGUgaW5kZXg6IGZvciBldmVyeSBsaXZlIGZpbGVcbiAqIGVudHJ5IHdob3NlIGNvbnRlbnQgaGFzaCBtYXRjaGVzIHdoYXQgdGhlIHNjYW4gaGFzaGVkLCBjYWNoZSB0aGUgb2JzZXJ2ZWRcbiAqIG10aW1lIHNvIHRoZSBuZXh0IGZhc3Qgc2NhbiBjYW4gc2tpcCByZS1oYXNoaW5nIGl0LlxuICpcbiAqIFB1cmU6IHJldHVybnMgYSBuZXcgaW5kZXggKG9yIHRoZSBpbnB1dCB3aGVuIG5vdGhpbmcgY2hhbmdlcyksIG5ldmVyXG4gKiBtdXRhdGVzLiBUaGUgaGFzaC1tYXRjaCBndWFyZCBrZWVwcyB0aGUgY2FjaGUgaG9uZXN0IFx1MjAxNCBhbiBlbnRyeSB3aG9zZVxuICogaGFzaCBubyBsb25nZXIgcmVmbGVjdHMgdGhlIG9ic2VydmF0aW9uIChlLmcuIGEgcHVsbCBvdmVyd3JvdGUgdGhlIHBhdGhcbiAqIG1pZC1jeWNsZSkgaXMgbGVmdCB1bnRvdWNoZWQgYW5kIHNpbXBseSBnZXRzIHJlLWhhc2hlZCBuZXh0IHNjYW4uXG4gKiBFbnRyaWVzIG5ldmVyIGRlbW90ZTogYGRlbGV0ZWRBdGAvYGlzRm9sZGVyYCBlbnRyaWVzIGFyZSBuZXZlciBwYXRjaGVkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVjb3JkSGFzaGVkRmlsZXMoXG4gIGluZGV4OiBMb2NhbEluZGV4LFxuICBoYXNoZWQ6IHJlYWRvbmx5IEhhc2hlZEZpbGVbXSxcbik6IExvY2FsSW5kZXgge1xuICBsZXQgbmV4dDogUmVjb3JkPHN0cmluZywgTG9jYWxJbmRleEVudHJ5PiB8IHVuZGVmaW5lZDtcbiAgZm9yIChjb25zdCBvYnNlcnZlZCBvZiBoYXNoZWQpIHtcbiAgICBjb25zdCBlbnRyeSA9IGluZGV4W29ic2VydmVkLnBhdGhdO1xuICAgIGlmIChlbnRyeSA9PT0gdW5kZWZpbmVkIHx8IGVudHJ5LmlzRm9sZGVyIHx8IGVudHJ5LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkKSBjb250aW51ZTtcbiAgICBpZiAoZW50cnkuaGFzaCAhPT0gb2JzZXJ2ZWQuaGFzaCkgY29udGludWU7XG4gICAgaWYgKGVudHJ5Lm10aW1lID09PSBvYnNlcnZlZC5tdGltZSkgY29udGludWU7XG4gICAgbmV4dCA/Pz0geyAuLi5pbmRleCB9O1xuICAgIG5leHRbb2JzZXJ2ZWQucGF0aF0gPSB7IC4uLmVudHJ5LCBtdGltZTogb2JzZXJ2ZWQubXRpbWUgfTtcbiAgfVxuICByZXR1cm4gbmV4dCA/PyBpbmRleDtcbn1cblxuLyoqXG4gKiBDb3JyZWxhdGUgZGVsZXRlICsgYWRkIHBhaXJzIGJ5IGNvbnRlbnQgaGFzaCAoQVJDSElURUNUVVJFIFx1MDBBNzQpLlxuICpcbiAqIE9uZS10by1vbmUgbWF0Y2hpbmcsIG1vc3QgZGV0ZXJtaW5pc3RpYyB3aW5zOiB3aGVuIHNldmVyYWwgdW5tYXRjaGVkIGFkZHNcbiAqIHNoYXJlIHRoZSBkZWxldGVkIHNpZGUncyBoYXNoLCBwcmVmZXIgYW4gYWRkIGluIHRoZSBzYW1lIHBhcmVudCBkaXJlY3Rvcnk7XG4gKiB3aXRoaW4gYSBwcmVmZXJlbmNlIGNsYXNzLCB0aGUgbGV4aWNvZ3JhcGhpY2FsbHkgc21hbGxlc3QgYHRvYCBwYXRoIHdpbnMuXG4gKiBNYXRjaGVkIHBhaXJzIGxlYXZlIHRoZSBkZWxldGUvYWRkIGJ1Y2tldHMgYW5kIGJlY29tZSBgcmVuYW1lZGAuXG4gKi9cbmZ1bmN0aW9uIGRldGVjdFJlbmFtZXMoXG4gIGRlbGV0ZWQ6IHJlYWRvbmx5IERlbGV0ZWRDYW5kaWRhdGVbXSxcbiAgYWRkZWQ6IHJlYWRvbmx5IFNjYW5DYW5kaWRhdGVbXSxcbik6IHtcbiAgcmVuYW1lZDogUmVuYW1lQ2FuZGlkYXRlW107XG4gIGRlbGV0ZWQ6IERlbGV0ZWRDYW5kaWRhdGVbXTtcbiAgYWRkZWQ6IFNjYW5DYW5kaWRhdGVbXTtcbn0ge1xuICBjb25zdCBhZGRzQnlIYXNoID0gbmV3IE1hcDxzdHJpbmcsIFNjYW5DYW5kaWRhdGVbXT4oKTtcbiAgZm9yIChjb25zdCBjYW5kaWRhdGUgb2YgWy4uLmFkZGVkXS5zb3J0KGJ5UGF0aCkpIHtcbiAgICBjb25zdCBidWNrZXQgPSBhZGRzQnlIYXNoLmdldChjYW5kaWRhdGUuaGFzaCk7XG4gICAgaWYgKGJ1Y2tldCkgYnVja2V0LnB1c2goY2FuZGlkYXRlKTtcbiAgICBlbHNlIGFkZHNCeUhhc2guc2V0KGNhbmRpZGF0ZS5oYXNoLCBbY2FuZGlkYXRlXSk7XG4gIH1cblxuICBjb25zdCB1c2VkQWRkcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBjb25zdCByZW5hbWVkOiBSZW5hbWVDYW5kaWRhdGVbXSA9IFtdO1xuICBjb25zdCB1bm1hdGNoZWREZWxldGVkOiBEZWxldGVkQ2FuZGlkYXRlW10gPSBbXTtcblxuICBmb3IgKGNvbnN0IGRlbGV0aW9uIG9mIFsuLi5kZWxldGVkXS5zb3J0KGJ5UGF0aCkpIHtcbiAgICBjb25zdCBjYW5kaWRhdGVzID0gYWRkc0J5SGFzaC5nZXQoZGVsZXRpb24uaGFzaCkgPz8gW107XG4gICAgbGV0IGZhbGxiYWNrOiBTY2FuQ2FuZGlkYXRlIHwgdW5kZWZpbmVkO1xuICAgIGxldCBzYW1lRGlyOiBTY2FuQ2FuZGlkYXRlIHwgdW5kZWZpbmVkO1xuICAgIGZvciAoY29uc3QgY2FuZGlkYXRlIG9mIGNhbmRpZGF0ZXMpIHtcbiAgICAgIGlmICh1c2VkQWRkcy5oYXMoY2FuZGlkYXRlLnBhdGgpKSBjb250aW51ZTtcbiAgICAgIGlmIChwYXJlbnRQYXRoKGNhbmRpZGF0ZS5wYXRoKSA9PT0gcGFyZW50UGF0aChkZWxldGlvbi5wYXRoKSkge1xuICAgICAgICBzYW1lRGlyID8/PSBjYW5kaWRhdGU7IC8vIHNvcnRlZCBcdTIxRDIgZmlyc3QgaXMgc21hbGxlc3RcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGZhbGxiYWNrID8/PSBjYW5kaWRhdGU7XG4gICAgICB9XG4gICAgfVxuICAgIGNvbnN0IG1hdGNoID0gc2FtZURpciA/PyBmYWxsYmFjaztcbiAgICBpZiAobWF0Y2gpIHtcbiAgICAgIHVzZWRBZGRzLmFkZChtYXRjaC5wYXRoKTtcbiAgICAgIHJlbmFtZWQucHVzaCh7IGZyb206IGRlbGV0aW9uLnBhdGgsIHRvOiBtYXRjaC5wYXRoLCBoYXNoOiBkZWxldGlvbi5oYXNoLCBzaXplOiBkZWxldGlvbi5zaXplIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICB1bm1hdGNoZWREZWxldGVkLnB1c2goZGVsZXRpb24pO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7XG4gICAgcmVuYW1lZCxcbiAgICBkZWxldGVkOiB1bm1hdGNoZWREZWxldGVkLFxuICAgIGFkZGVkOiBhZGRlZC5maWx0ZXIoKGNhbmRpZGF0ZSkgPT4gIXVzZWRBZGRzLmhhcyhjYW5kaWRhdGUucGF0aCkpLFxuICB9O1xufVxuXG4vKipcbiAqIERpcmVjdG9yaWVzIHRoYXQgZXhpc3QgaW4gc3RvcmFnZSBidXQgYXJlIHJlcHJlc2VudGVkIG5laXRoZXIgYnkgYSBsaXZlXG4gKiBmb2xkZXIgcGxhY2Vob2xkZXIgaW4gdGhlIGluZGV4IG5vciBieSBhbnkgZmlsZSAoaWdub3JlZCBvciBub3QpIGJlbmVhdGhcbiAqIHRoZW0gXHUyMDE0IHBsdXMgdGhlIHRvbWJzdG9uZWQtcGxhY2Vob2xkZXIgc3BlY2lhbCBjYXNlcyB0aGF0IG1ha2UgdGhlXG4gKiBlbXB0eS1mb2xkZXIgbGlmZWN5Y2xlIGRlbGV0aW9uLXNhZmU6XG4gKlxuICogICAtIFRPTUJTVE9ORUQgcGxhY2Vob2xkZXIgKyBjb250ZW50IGJlbmVhdGggXHUyMTkyIGBlbXB0eUZvbGRlcnNgOiB0aGUgdXNlclxuICogICAgIHJlY3JlYXRlZCB0aGUgZm9sZGVyOyByZXN0b3JpbmcgdGhlIHBsYWNlaG9sZGVyIChcImxvY2FsIHdpbnNcIikgaXNcbiAqICAgICBjb3JyZWN0LiBUaGUgcmVjcmVhdGVkIEZJTEVTIGJlbmVhdGggc3VyZmFjZSB0aHJvdWdoIGBhZGRlZGAvYG1vZGlmaWVkYFxuICogICAgIGluZGVwZW5kZW50bHkuXG4gKiAgIC0gVE9NQlNUT05FRCBwbGFjZWhvbGRlciArIEVNUFRZIGRpciBvbiBkaXNrOlxuICogICAgICAgXHUwMEI3IHRvbWJzdG9uZSBhdXRob3JlZCBieSBBTk9USEVSIGRldmljZSAob3IgYXV0aG9yIHVua25vd24pIFx1MjE5MlxuICogICAgICAgICBgc3RhbGVEaXJzYDogdGhlIHJlY29yZC1vbmx5IHJlc2lkdWUgb2YgYSByZW1vdGUgZGVsZXRpb24sXG4gKiAgICAgICAgIGNvbnNpc3RlbnQgd2l0aCB0aGUgdG9tYnN0b25lIFx1MjAxNCBuZXZlciByZXN1cnJlY3RlZCAocmUtcHVzaGluZyBpdCBhc1xuICogICAgICAgICBhbiBlbXB0eSBmb2xkZXIgaXMgd2hhdCBtYWRlIGEgcGVlci1zaWRlIGRlbGV0aW9uIHBpbmctcG9uZ1xuICogICAgICAgICBmb3JldmVyKS4gVGhlIGNsaWVudCByZXRyaWVzIGByZW1vdmVEaXJgIG9uIHRoZXNlIGRpcnMuXG4gKiAgICAgICBcdTAwQjcgdG9tYnN0b25lIGF1dGhvcmVkIGJ5IFRISVMgZGV2aWNlIChgdGhpc0RldmljZUlkYCkgXHUyMTkyXG4gKiAgICAgICAgIGBlbXB0eUZvbGRlcnNgOiBteSBvd24gZGVsZXRpb24sIHlldCBhIGRpciBleGlzdHMgaGVyZSBub3cgXHUyMDE0IHRoZVxuICogICAgICAgICB1c2VyIHJlLWNyZWF0ZWQgaXQgbG9jYWxseTsgcmVzdG9yZSB0aGUgcGxhY2Vob2xkZXIuXG4gKlxuICogQSBkaXJlY3RvcnkgY29udGFpbmluZyBvbmx5IGlnbm9yZWQgZmlsZXMgaXMgKm5vdCogZW1wdHkgXHUyMDE0IGl0IGlzXG4gKiByZXByZXNlbnRlZCBieSB0aG9zZSBmaWxlcyBhcyBmYXIgYXMgdGhlIGxvY2FsIG1hY2hpbmUgaXMgY29uY2VybmVkLlxuICovXG5mdW5jdGlvbiBkZXRlY3RFbXB0eUZvbGRlcnMoXG4gIGluZGV4OiBMb2NhbEluZGV4LFxuICBzZXR0aW5nczogSWdub3JlU2V0dGluZ3MsXG4gIGZpbGVzOiByZWFkb25seSBGaWxlU3RhdFtdLFxuICBkaXJzOiByZWFkb25seSBzdHJpbmdbXSxcbiAgdGhpc0RldmljZUlkPzogc3RyaW5nLFxuKTogeyBlbXB0eUZvbGRlcnM6IHN0cmluZ1tdOyBzdGFsZURpcnM6IHN0cmluZ1tdIH0ge1xuICBjb25zdCByZXByZXNlbnRlZERpcnMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgZm9yIChjb25zdCBmaWxlIG9mIGZpbGVzKSB7XG4gICAgZm9yIChsZXQgZGlyID0gcGFyZW50UGF0aChmaWxlLnBhdGgpOyBkaXIgIT09ICcvJzsgZGlyID0gcGFyZW50UGF0aChkaXIpKSB7XG4gICAgICByZXByZXNlbnRlZERpcnMuYWRkKGRpcik7XG4gICAgfVxuICB9XG5cbiAgY29uc3QgZW1wdHlGb2xkZXJzOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBzdGFsZURpcnM6IHN0cmluZ1tdID0gW107XG4gIGZvciAoY29uc3QgZGlyIG9mIGRpcnMpIHtcbiAgICBpZiAoZGlyID09PSAnLycpIGNvbnRpbnVlO1xuICAgIGlmIChpc0lnbm9yZWQoZGlyLCBzZXR0aW5ncykpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGVudHJ5ID0gaW5kZXhbZGlyXTtcbiAgICBpZiAoZW50cnk/LmlzRm9sZGVyICYmIGVudHJ5LmRlbGV0ZWRBdCA9PT0gdW5kZWZpbmVkKSBjb250aW51ZTsgLy8gbGl2ZSBwbGFjZWhvbGRlciBcdTIwMTQgYWxyZWFkeSBzeW5jZWRcbiAgICBpZiAoZW50cnk/LmlzRm9sZGVyICYmIGVudHJ5LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAvLyBUb21ic3RvbmVkIHBsYWNlaG9sZGVyIHdob3NlIGRpcmVjdG9yeSBzdGlsbCBleGlzdHMuIENvbnRlbnQgYmVuZWF0aFxuICAgICAgLy8gXHUyMUQyIGdlbnVpbmUgcmVjcmVhdGlvbi4gRW1wdHkgXHUyMUQyIHN0YWxlIGxlZnRvdmVyIG9mIGEgcmVjb3JkLW9ubHlcbiAgICAgIC8vIHRvbWJzdG9uZSBhcHBsaWNhdGlvbiBcdTIwMTQgVU5MRVNTIHRoaXMgZGV2aWNlIGF1dGhvcmVkIHRoZSB0b21ic3RvbmVcbiAgICAgIC8vIGl0c2VsZiwgaW4gd2hpY2ggY2FzZSBhIHByZXNlbnQgZGlyIGNhbiBvbmx5IGJlIGxvY2FsIHJlY3JlYXRpb24uXG4gICAgICBpZiAocmVwcmVzZW50ZWREaXJzLmhhcyhkaXIpIHx8IGVudHJ5LmNsb2NrLmRldmljZUlkID09PSB0aGlzRGV2aWNlSWQpIHtcbiAgICAgICAgZW1wdHlGb2xkZXJzLnB1c2goZGlyKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHN0YWxlRGlycy5wdXNoKGRpcik7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKHJlcHJlc2VudGVkRGlycy5oYXMoZGlyKSkgY29udGludWU7IC8vIHJlcHJlc2VudGVkIGJ5IGl0cyBmaWxlc1xuICAgIGVtcHR5Rm9sZGVycy5wdXNoKGRpcik7XG4gIH1cbiAgcmV0dXJuIHtcbiAgICBlbXB0eUZvbGRlcnM6IGVtcHR5Rm9sZGVycy5zb3J0KCksXG4gICAgc3RhbGVEaXJzOiBzdGFsZURpcnMuc29ydCgpLFxuICB9O1xufVxuXG4vKipcbiAqIExpdmUgZm9sZGVyIHBsYWNlaG9sZGVyIGVudHJpZXMgd2hvc2UgZGlyZWN0b3J5IG5vIGxvbmdlciBleGlzdHMgaW5cbiAqIHN0b3JhZ2UgXHUyMDE0IHRoZSBmb2xkZXIgd2FzIGRlbGV0ZWQgbG9jYWxseSAoZGlyZWN0bHksIG9yIGJ5IHBydW5lLW9uLWRlbGV0ZVxuICogZW1wdHlpbmcgaXQpLiBFbWl0cyBvbmUgYEZvbGRlckRlbGV0aW9uQ2FuZGlkYXRlYCBwZXIgcGxhY2Vob2xkZXIgc28gdGhlXG4gKiByZXNvbHZlL2NvbW1pdCBwYXRoIHB1c2hlcyBhIGZvbGRlciB0b21ic3RvbmU7IGFscmVhZHktdG9tYnN0b25lZFxuICogcGxhY2Vob2xkZXJzIGFuZCBwbGFjZWhvbGRlcnMgdGhhdCBtZXJlbHkgYmVjYW1lIGlnbm9yZWQgYXJlIHNraXBwZWQuXG4gKi9cbmZ1bmN0aW9uIGRldGVjdEZvbGRlckRlbGV0aW9ucyhcbiAgaW5kZXg6IExvY2FsSW5kZXgsXG4gIHNldHRpbmdzOiBJZ25vcmVTZXR0aW5ncyxcbiAgZGlyczogcmVhZG9ubHkgc3RyaW5nW10sXG4pOiBGb2xkZXJEZWxldGlvbkNhbmRpZGF0ZVtdIHtcbiAgY29uc3QgcHJlc2VudCA9IG5ldyBTZXQoZGlycyk7XG4gIGNvbnN0IGZvbGRlckRlbGV0aW9uczogRm9sZGVyRGVsZXRpb25DYW5kaWRhdGVbXSA9IFtdO1xuICBmb3IgKGNvbnN0IFtwYXRoLCBlbnRyeV0gb2YgT2JqZWN0LmVudHJpZXMoaW5kZXgpKSB7XG4gICAgaWYgKCFlbnRyeS5pc0ZvbGRlcikgY29udGludWU7IC8vIGZpbGVzIGFyZSBoYW5kbGVkIGJ5IHRoZSBgZGVsZXRlZGAgYnVja2V0XG4gICAgaWYgKGVudHJ5LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkKSBjb250aW51ZTsgLy8gYWxyZWFkeSB0b21ic3RvbmVkXG4gICAgaWYgKHByZXNlbnQuaGFzKHBhdGgpKSBjb250aW51ZTsgLy8gZGlyZWN0b3J5IHN0aWxsIGV4aXN0cyBcdTIwMTQgbm8gZGVsZXRpb25cbiAgICBpZiAoaXNJZ25vcmVkKHBhdGgsIHNldHRpbmdzKSkgY29udGludWU7IC8vIHNldHRpbmdzIGNoYW5nZSwgbm90IGEgZGVsZXRpb25cbiAgICBmb2xkZXJEZWxldGlvbnMucHVzaCh7IHBhdGgsIHZlcnNpb25JZDogZW50cnkudmVyc2lvbklkIH0pO1xuICB9XG4gIHJldHVybiBmb2xkZXJEZWxldGlvbnMuc29ydChieVBhdGgpO1xufVxuXG5mdW5jdGlvbiBzb3J0Q2FuZGlkYXRlcyhjYW5kaWRhdGVzOiBTY2FuQ2FuZGlkYXRlW10pOiBTY2FuQ2FuZGlkYXRlW10ge1xuICByZXR1cm4gWy4uLmNhbmRpZGF0ZXNdLnNvcnQoYnlQYXRoKTtcbn1cblxuZnVuY3Rpb24gYnlQYXRoPFQgZXh0ZW5kcyB7IHBhdGg/OiBzdHJpbmc7IGZyb20/OiBzdHJpbmcgfT4oYTogVCwgYjogVCk6IG51bWJlciB7XG4gIGNvbnN0IGtleUEgPSBhLnBhdGggPz8gYS5mcm9tID8/ICcnO1xuICBjb25zdCBrZXlCID0gYi5wYXRoID8/IGIuZnJvbSA/PyAnJztcbiAgcmV0dXJuIGtleUEgPCBrZXlCID8gLTEgOiBrZXlBID4ga2V5QiA/IDEgOiAwO1xufVxuIiwgIi8qKlxuICogYFN5bmNDbGllbnRgIFx1MjAxNCB0aGUgbmV0d29yay1mYWNpbmcgb3JjaGVzdHJhdG9yIChBUkNISVRFQ1RVUkUubWQgXHUwMEE3OCkuXG4gKlxuICogQ29tcG9zZXMgdGhlIHBoYXNlLTFhLzFiIHBpZWNlcyBpbnRvIG9uZSBsb29wIHBlciBkZXZpY2U6XG4gKlxuICogICBzdGFydHVwOiAgbG9hZExvY2FsU3RhdGUgKGVudHJpZXMgKyBwZXJzaXN0ZWQgY3Vyc29yKSBcdTIxOTIgaGVsbG8vaGVsbG9BY2tcbiAqICAgICAgICAgICAgIChzZXJ2ZXIgcmVwb3J0cyBgb2xkZXN0UmV0YWluZWRTZXFgKSBcdTIxOTIgZ2V0TWFuaWZlc3QgXHUyMDE0IGEgREVMVEFcbiAqICAgICAgICAgICAgIG1hbmlmZXN0IChgc2luY2U6IHN5bmNlZFRocm91Z2hgKSBtZXJnZWQgb3ZlciB0aGUgaW5kZXhcbiAqICAgICAgICAgICAgIHByb2plY3Rpb24gd2hlbiB0aGUgcmVwbGF5IHdpbmRvdyBpcyBpbnRhY3QsIGVsc2UgZnVsbCBcdTIxOTJcbiAqICAgICAgICAgICAgIHNjYW5WYXVsdCBcdTIxOTIgY29tcHV0ZVN5bmNQbGFuIFx1MjE5MiBleGVjdXRlIChwdXNoZXMgdGhyb3VnaCBhXG4gKiAgICAgICAgICAgICBib3VuZGVkLWNvbmN1cnJlbmN5IHBpcGVsaW5lLCBwdWxscyB2aWEgYXBwbHlQdWxsIHdpdGggdGhlXG4gKiAgICAgICAgICAgICBpbmplY3RlZCBibG9iIHN0b3JlKTtcbiAqICAgbGl2ZTogICAgIGBjaGFuZ2VgIG1lc3NhZ2VzIG1hdGVyaWFsaXplIGltbWVkaWF0ZWx5IHdoZW4gdGhlIHRhcmdldCBpc1xuICogICAgICAgICAgICAgY2xlYW4sIGFuZCBkZWZlciB0byBhIGZ1bGwgcmVjb25jaWxlIGN5Y2xlIHdoZW4gaXQgaXMgbm90IFx1MjAxNCBhXG4gKiAgICAgICAgICAgICByZW1vdGUgY2hhbmdlIGlzIE5FVkVSIHdyaXR0ZW4gb3ZlciBsb2NhbGx5LW1vZGlmaWVkIGNvbnRlbnRcbiAqICAgICAgICAgICAgIHdpdGhvdXQgZ29pbmcgdGhyb3VnaCBgY29tcHV0ZVN5bmNQbGFuYCdzIGNvbmZsaWN0IGxvZ2ljO1xuICogICB3YXRjaGVyOiAgYFdhdGNoQWRhcHRlcmAgYmF0Y2hlcyBhcmUgZGVib3VuY2VkICh+MzAwIG1zLCBpbmplY3RhYmxlXG4gKiAgICAgICAgICAgICBzY2hlZHVsZXIgXHUyMDE0IG5vIGFtYmllbnQgdGltZXJzIGluIHRlc3RzKSBpbnRvIHNjYW5cdTIxOTJwbGFuXHUyMTkyZXhlY3V0ZTtcbiAqICAgcmVjb25uZWN0OiBgb25DbG9zZWAgZmxpcHMgdG8gYCdkaXNjb25uZWN0ZWQnYDsgYHJlY29ubmVjdCgpYCByZS1ydW5zIHRoZVxuICogICAgICAgICAgICAgd2hvbGUgc3RhcnR1cCByZWNvbmNpbGlhdGlvbiAoYmFja29mZiBpcyB0aGUgY2FsbGVyJ3Mgam9iKS5cbiAqXG4gKiBCdWxrIHBoYXNlcyByZXBvcnQgWC9ZIG9uIGBzdGF0dXMoKS5wcm9ncmVzc2AgKHRocm90dGxlZCB2aWEgdGhlIGluamVjdGVkXG4gKiBjbG9jayk7IHRoZSBwdXNoIHBoYXNlIGtlZXBzIHVwIHRvIGBwdXNoQ29uY3VycmVuY3lgIGNvbW1pdHMgaW4gZmxpZ2h0LlxuICpcbiAqIEFsbCBJL08gY3Jvc3NlcyB0aGUgYWRhcHRlciBzZWFtcyAoYFN0b3JhZ2VBZGFwdGVyYCwgYFRyYW5zcG9ydGAsXG4gKiBgQmxvYlN0b3JlYCwgYExvZ0FkYXB0ZXJgKTsgdGhlIGNsYXNzIGl0c2VsZiBpcyBwdXJlIG9yY2hlc3RyYXRpb24gYW5kIHJ1bnNcbiAqIGFueXdoZXJlIGBjb3JlYCBydW5zIFx1MjAxNCBXb3JrZXJzIHRlc3RzIGluY2x1ZGVkLlxuICovXG5cbmltcG9ydCB0eXBlIHsgTG9nQWRhcHRlciwgU3RvcmFnZUFkYXB0ZXIsIFdhdGNoQWRhcHRlciB9IGZyb20gJy4vYWRhcHRlcnMuanMnO1xuaW1wb3J0IHsgY29tcGFyZUNsb2NrcyB9IGZyb20gJy4vY2xvY2suanMnO1xuaW1wb3J0IHsgYXBwbHlQdWxsLCBsb2FkTG9jYWxTdGF0ZSwgcHJ1bmVQYXJlbnRPbkRlbGV0ZSwgcmVtb3ZlRGlySWZWYWNhbnQsIHR5cGUgRmV0Y2hCbG9iIH0gZnJvbSAnLi9lbmdpbmUuanMnO1xuaW1wb3J0IHsgTmV0d29ya0Vycm9yLCBQcm90b2NvbEVycm9yLCBSZXZva2VkRXJyb3IsIFVuYXV0aG9yaXplZEVycm9yIH0gZnJvbSAnLi9lcnJvcnMuanMnO1xuaW1wb3J0IHsgc2hhMjU2SGV4IH0gZnJvbSAnLi9oYXNoaW5nLmpzJztcbmltcG9ydCB7IGlzSWdub3JlZCwgdHlwZSBJZ25vcmVTZXR0aW5ncyB9IGZyb20gJy4vaWdub3JlLmpzJztcbmltcG9ydCB7XG4gIGFwcGx5Q29tbWl0LFxuICBMT0NBTF9JTkRFWF9TVEFURV9QQVRILFxuICByZW1vdmVFbnRyeSxcbiAgc2VyaWFsaXplTG9jYWxJbmRleCxcbiAgdHlwZSBMb2NhbEluZGV4LFxuICB0eXBlIFBlcnNpc3RlZFN5bmNTdGF0ZSxcbn0gZnJvbSAnLi9sb2NhbGluZGV4LmpzJztcbmltcG9ydCB7IGlzV2luZG93c1Vuc2FmZVBhdGggfSBmcm9tICcuL3BhdGhzLmpzJztcbmltcG9ydCB7XG4gIGJhc2U2NFRvQnl0ZXMsXG4gIGJ5dGVzVG9CYXNlNjQsXG4gIElOTElORV9DT05URU5UX01BWF9CWVRFUyxcbiAgUHJvdG9jb2xWZXJzaW9uLFxuICB2YWxpZGF0ZUNoYW5nZU1lc3NhZ2UsXG4gIHZhbGlkYXRlQ29tbWl0QWNrTWVzc2FnZSxcbiAgdmFsaWRhdGVDb25mbGljdE1lc3NhZ2UsXG4gIHZhbGlkYXRlTWFuaWZlc3RNZXNzYWdlLFxuICB0eXBlIEJsb2JBY2tNZXNzYWdlLFxuICB0eXBlIEJsb2JNZXNzYWdlLFxuICB0eXBlIENoYW5nZU1lc3NhZ2UsXG4gIHR5cGUgQ29tbWl0QWNrTWVzc2FnZSxcbiAgdHlwZSBDb21taXRNZXNzYWdlLFxuICB0eXBlIENvbmZsaWN0TWVzc2FnZSxcbiAgdHlwZSBIZWxsb0Fja01lc3NhZ2UsXG4gIHR5cGUgTWFuaWZlc3RNZXNzYWdlLFxuICB0eXBlIE1lc3NhZ2UsXG4gIHR5cGUgU2VydmVyTWVzc2FnZSxcbiAgdHlwZSBTbmFwc2hvdENyZWF0ZUFja01lc3NhZ2UsXG4gIHR5cGUgU25hcHNob3RSZXN0b3JlQWNrTWVzc2FnZSxcbn0gZnJvbSAnLi9wcm90b2NvbC5qcyc7XG5pbXBvcnQge1xuICBjb21wdXRlU3luY1BsYW4sXG4gIHR5cGUgQ29uZmxpY3RPcCxcbiAgdHlwZSBQdWxsRmlsZU9wLFxuICB0eXBlIFB1bGxPcCxcbiAgdHlwZSBQdXNoT3AsXG4gIHR5cGUgUmVtb3RlRmlsZSxcbiAgdHlwZSBTeW5jUGxhbixcbn0gZnJvbSAnLi9yZXNvbHZlLmpzJztcbmltcG9ydCB7IHJlY29yZEhhc2hlZEZpbGVzLCBzY2FuVmF1bHQsIHR5cGUgSGFzaGVkRmlsZSB9IGZyb20gJy4vc2Nhbi5qcyc7XG5pbXBvcnQgdHlwZSB7IFRyYW5zcG9ydCB9IGZyb20gJy4vdHJhbnNwb3J0LmpzJztcbmltcG9ydCB0eXBlIHsgTG9naWNhbENsb2NrIH0gZnJvbSAnLi90eXBlcy5qcyc7XG5cbi8vIC0tLSBwdWJsaWMgb3B0aW9uL3N0YXR1cyBzaGFwZXMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIENsaWVudC1zaWRlIGNvbnRlbnQtYWRkcmVzc2VkIGJsb2IgY2FjaGUgKFIyIGNsaWVudCBpbiBwcm9kdWN0aW9uOyBhIE1hcCBpbiB0ZXN0cykuICovXG5leHBvcnQgaW50ZXJmYWNlIEJsb2JTdG9yZSB7XG4gIGdldChoYXNoOiBzdHJpbmcpOiBQcm9taXNlPFVpbnQ4QXJyYXkgfCB1bmRlZmluZWQ+O1xuICBwdXQoaGFzaDogc3RyaW5nLCBieXRlczogVWludDhBcnJheSk6IFByb21pc2U8dm9pZD47XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgU3luY0NsaWVudE9wdGlvbnMge1xuICBkZXZpY2VJZDogc3RyaW5nO1xuICBkZXZpY2VOYW1lOiBzdHJpbmc7XG4gIHRva2VuOiBzdHJpbmc7XG4gIC8qKiBBIGZhY3RvcnkgKHJlY29ubmVjdCBkaWFscyBmcmVzaCkgb3IgYSBzaW5nbGUgcmV1c2FibGUgaW5zdGFuY2UuICovXG4gIHRyYW5zcG9ydDogKCgpID0+IFRyYW5zcG9ydCkgfCBUcmFuc3BvcnQ7XG4gIGJsb2JTdG9yZTogQmxvYlN0b3JlO1xuICBzdG9yYWdlOiBTdG9yYWdlQWRhcHRlcjtcbiAgbG9nPzogTG9nQWRhcHRlcjtcbiAgLyoqIEluaXRpYWwgaWdub3JlIHNldHRpbmdzOyBzdXBlcnNlZGVkIGJ5IGBoZWxsb0Fjay5zZXR0aW5nc2Agb24gY29ubmVjdC4gKi9cbiAgc2V0dGluZ3M/OiBJZ25vcmVTZXR0aW5ncztcbiAgLyoqIEluamVjdGFibGUgY2xvY2sgKGRlZmF1bHQgYERhdGUubm93YCkuICovXG4gIG5vdz86ICgpID0+IG51bWJlcjtcbiAgLyoqIFdhdGNoZXIgZGVib3VuY2Ugd2luZG93IGluIG1zIChkZWZhdWx0IDMwMCkuICovXG4gIGRlYm91bmNlTXM/OiBudW1iZXI7XG4gIC8qKlxuICAgKiBTY2hlZHVsZXMgdGhlIGRlYm91bmNlZCBzeW5jIGN5Y2xlLiBEZWZhdWx0OiBgc2V0VGltZW91dGAuIFRlc3RzIGluamVjdCBhXG4gICAqIG1hbnVhbCBxdWV1ZSBcdTIwMTQgdGhlIGNsaWVudCBuZXZlciB0b3VjaGVzIGEgcmVhbCB0aW1lciBiZWhpbmQgdGhpcyBzZWFtLlxuICAgKi9cbiAgc2NoZWR1bGU/OiAoZm46ICgpID0+IHZvaWQsIG1zOiBudW1iZXIpID0+ICgpID0+IHZvaWQ7XG4gIC8qKlxuICAgKiBCb3VuZGVkIGNvbmN1cnJlbmN5IG9mIHRoZSBwdXNoIHBpcGVsaW5lOiBob3cgbWFueSBjb21taXRzIG1heSBiZSBpblxuICAgKiBmbGlnaHQgKHNlbnQsIGF3YWl0aW5nIGFjaykgYXQgb25jZS4gRGVmYXVsdCA4LiBDb25mbGljdCBhcmJpdHJhdGlvbiBpc1xuICAgKiBzZXJ2ZXItc2lkZSBhbmQgUEVSIFBBVEgsIGFuZCBhIGN5Y2xlIHN0YWdlcyBhdCBtb3N0IG9uZSBjb21taXQgcGVyIHBhdGgsXG4gICAqIHNvIG9yZGVyaW5nIGFjcm9zcyBkaWZmZXJlbnQgZmlsZXMgaXMgaXJyZWxldmFudCBcdTIwMTQgc2VlXG4gICAqIGBydW5QdXNoUGlwZWxpbmVgIGZvciB0aGUgZnVsbCBhcmd1bWVudC5cbiAgICovXG4gIHB1c2hDb25jdXJyZW5jeT86IG51bWJlcjtcbiAgLyoqXG4gICAqIE1pbmltdW0gd2FsbC1jbG9jayBtcyBiZXR3ZWVuIGBzdGF0dXMoKS5wcm9ncmVzc2AgdXBkYXRlcyBkdXJpbmcgYnVsa1xuICAgKiBwaGFzZXMgKGRlZmF1bHQgNTAgXHUyMDE0IHJlbmRlcmVyIGNvYWxlc2Npbmc7IHBoYXNlIGNoYW5nZXMgYW5kIGNvbXBsZXRpb25zXG4gICAqIGFsd2F5cyBlbWl0KS4gVGVzdHMgcGFzcyAwIHRvIG9ic2VydmUgZXZlcnkgZmlsZS5cbiAgICovXG4gIHByb2dyZXNzVGhyb3R0bGVNcz86IG51bWJlcjtcbn1cblxuZXhwb3J0IHR5cGUgU3luY0NsaWVudFN0YXRlID0gJ2lkbGUnIHwgJ2Nvbm5lY3RpbmcnIHwgJ3N5bmNpbmcnIHwgJ2xpdmUnIHwgJ2Rpc2Nvbm5lY3RlZCc7XG5cbi8qKiBUaGUgYnVsayBwaGFzZSBhIHJ1bm5pbmcgY3ljbGUgaXMgY3VycmVudGx5IGdyaW5kaW5nIHRocm91Z2guICovXG5leHBvcnQgdHlwZSBTeW5jUGhhc2UgPSAnc2Nhbm5pbmcnIHwgJ3B1c2hpbmcnIHwgJ3B1bGxpbmcnO1xuXG4vKiogWC9ZIHByb2dyZXNzIG9mIG9uZSBidWxrIHBoYXNlOyBwcmVzZW50IG9uIGBTeW5jQ2xpZW50U3RhdHVzYCBtaWQtY3ljbGUgb25seS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU3luY1Byb2dyZXNzIHtcbiAgcGhhc2U6IFN5bmNQaGFzZTtcbiAgZG9uZTogbnVtYmVyO1xuICB0b3RhbDogbnVtYmVyO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFN5bmNDbGllbnRTdGF0dXMge1xuICBzdGF0ZTogU3luY0NsaWVudFN0YXRlO1xuICAvKiogRXBvY2ggbXMgb2YgdGhlIGxhc3QgY29tcGxldGVkIGN5Y2xlLCBvciBudWxsIGJlZm9yZSB0aGUgZmlyc3QuICovXG4gIGxhc3RTeW5jQXQ6IG51bWJlciB8IG51bGw7XG4gIC8qKiBXYXRjaGVyL3JlY29uY2lsZSBldmVudHMgcXVldWVkIGJlaGluZCB0aGUgZGVib3VuY2Ugd2luZG93LiAqL1xuICBwZW5kaW5nOiBudW1iZXI7XG4gIC8qKlxuICAgKiBDb25mbGljdHMgb2JzZXJ2ZWQgYnkgdGhlIG1vc3QgcmVjZW50IHBsYW4gY3ljbGUgKGluZm9ybWF0aW9uYWw7XG4gICAqIHJlc29sdXRpb24gaXMgaW4gdGhlIGRhdGEpLiBSZXBsYWNlZCBldmVyeSBjeWNsZSBcdTIwMTQgYSBsYXRlciBjeWNsZSB0aGF0XG4gICAqIHBsYW5zIGNsZWFuIGNsZWFycyBpdCwgc28gYSBzeW5jZWQtcXVpZXQgY2xpZW50IHJlcG9ydHMgMC5cbiAgICovXG4gIGNvbmZsaWN0czogQ29uZmxpY3RPcFtdO1xuICAvKipcbiAgICogUGF0aHMgd2hvc2UgbGl2ZSBpbmRleCBlbnRyeSBpcyBJTlZJU0lCTEUgb24gdGhpcyBmaWxlc3lzdGVtIGJlY2F1c2VcbiAgICogYW5vdGhlciBzeW5jZWQgZmlsZSBkaWZmZXJzIGZyb20gaXQgb25seSBieSBuYW1lIGNhc2UgKGEgY2FzZS1jb2xsaWRpbmdcbiAgICogcGFpciwgY3JlYXRhYmxlIGZyb20gYSBjYXNlLXNlbnNpdGl2ZSBjbGllbnQgXHUyMDE0IEFSQ0hJVEVDVFVSRSBcdTAwQTcxNCkuIFRoZVxuICAgKiBzY2FuIG5ldmVyIHB1c2hlcyBhIGRlbGV0aW9uIGZvciB0aGVtOyB0aGV5IGFyZSBzdXJmYWNlZCBoZXJlIChhbmQgdmlhIGFcbiAgICogYHdhcm5gIGxvZyBsaW5lIHBlciBjeWNsZSkgdW50aWwgYSBodW1hbiByZW5hbWVzIG9uZSBvZiB0aGUgcGFpci5cbiAgICogUmVwbGFjZWQgZXZlcnkgY3ljbGUgbGlrZSBgY29uZmxpY3RzYDsgb21pdHRlZCB3aGVuIHRoZXJlIGFyZSBub25lLlxuICAgKi9cbiAgY2FzZUNvbGxpc2lvbnM/OiBzdHJpbmdbXTtcbiAgLyoqXG4gICAqIFBhdGhzIHRoZSBtb3N0IHJlY2VudCBjeWNsZSBTS0lQUEVEIGJlY2F1c2UgdGhlaXIgbmFtZXMgY2Fubm90IGJlXG4gICAqIG1hdGVyaWFsaXplZCBvbiBXaW5kb3dzIChyZXNlcnZlZCBkZXZpY2UgbmFtZXMgbGlrZSBgQ09OYC9gTlVMYC9gQ09NMWAsXG4gICAqIG9yIHNlZ21lbnRzIGVuZGluZyBpbiBgLmAvYCBgIFx1MjAxNCBzZWUgYHBhdGhzLnRzYCkuIExvY2FsIGZpbGVzIHdpdGggc3VjaFxuICAgKiBuYW1lcyBhcmUgbmV2ZXIgcHVzaGVkIGFuZCByZW1vdGUgaGVhZHMgYXQgc3VjaCBwYXRocyBhcmUgbmV2ZXIgYXBwbGllZDtcbiAgICogYSBsYXRlciB2ZXJzaW9uIGNoYW5nZSBhdCB0aGUgcGF0aCBpcyBhdHRlbXB0ZWQgYWdhaW4uIFN1cmZhY2VkIGhlcmVcbiAgICogKGFuZCB2aWEgYSBgd2FybmAgbG9nIGxpbmUpIHVudGlsIGEgaHVtYW4gcmVuYW1lcyB0aGUgcGF0aDsgcmVwbGFjZWRcbiAgICogZXZlcnkgY3ljbGUgbGlrZSBgY29uZmxpY3RzYC4gT21pdHRlZCB3aGVuIHRoZXJlIGFyZSBub25lLlxuICAgKi9cbiAgc2tpcHBlZFBhdGhzPzogc3RyaW5nW107XG4gIC8qKlxuICAgKiBTZXJ2ZXIgcmVsZWFzZSB2ZXJzaW9uIGFzIHJlcG9ydGVkIGJ5IGhlbGxvQWNrIChudWxsIGJlZm9yZSB0aGUgZmlyc3RcbiAgICogYWNrIFx1MjAxNCBhbmQgZm9yIGxlZ2FjeSBzZXJ2ZXJzIFx1MjI2NCAwLjEsIHdoaWNoIG5ldmVyIHNlbmQgdGhlIGZpZWxkOyBzZWVcbiAgICogYGNoZWNrU2VydmVyQ29tcGF0aWJpbGl0eWAgZm9yIHRoZSBzaGFyZWQgc2tldyBwb2xpY3kpLlxuICAgKi9cbiAgc2VydmVyVmVyc2lvbjogc3RyaW5nIHwgbnVsbDtcbiAgLyoqXG4gICAqIFByb2dyZXNzIG9mIHRoZSBSVU5OSU5HIGN5Y2xlJ3MgY3VycmVudCBidWxrIHBoYXNlIChgdnNhIFx1MjJFRiAxMjM0LzUwMDBgKTtcbiAgICogYWJzZW50IGJldHdlZW4gY3ljbGVzLiBVcGRhdGVzIGFyZSB0aHJvdHRsZWQgdG8gYHByb2dyZXNzVGhyb3R0bGVNc2AuXG4gICAqL1xuICBwcm9ncmVzcz86IFN5bmNQcm9ncmVzcztcbn1cblxuLyoqIERlZmF1bHQgaW4tZmxpZ2h0IGNvbW1pdCBjYXAgKHNlZSBgU3luY0NsaWVudE9wdGlvbnMucHVzaENvbmN1cnJlbmN5YCkuICovXG5leHBvcnQgY29uc3QgREVGQVVMVF9QVVNIX0NPTkNVUlJFTkNZID0gODtcbi8qKiBEZWZhdWx0IHByb2dyZXNzIGNvYWxlc2Npbmcgd2luZG93IChzZWUgYFN5bmNDbGllbnRPcHRpb25zLnByb2dyZXNzVGhyb3R0bGVNc2ApLiAqL1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfUFJPR1JFU1NfVEhST1RUTEVfTVMgPSA1MDtcblxuY29uc3QgZGVmYXVsdExvZzogTG9nQWRhcHRlciA9IHtcbiAgZGVidWc6ICgpID0+IHt9LFxuICBpbmZvOiAoKSA9PiB7fSxcbiAgd2FybjogKCkgPT4ge30sXG4gIGVycm9yOiAoKSA9PiB7fSxcbn07XG5cbmNvbnN0IGRlZmF1bHRTY2hlZHVsZSA9IChmbjogKCkgPT4gdm9pZCwgbXM6IG51bWJlcik6ICgoKSA9PiB2b2lkKSA9PiB7XG4gIGNvbnN0IGhhbmRsZSA9IGdsb2JhbFRoaXMuc2V0VGltZW91dChmbiwgbXMpIGFzIHVua25vd24gYXMgbnVtYmVyO1xuICByZXR1cm4gKCkgPT4gZ2xvYmFsVGhpcy5jbGVhclRpbWVvdXQoaGFuZGxlKTtcbn07XG5cbi8qKiBBIGNvbW1pdCBwcmVwYXJlZCBmb3IgdGhlIHdpcmUgKGEgYFB1c2hPcGAgKyBpdHMgc3RhZ2VkIGNvbnRlbnQpLiAqL1xuaW50ZXJmYWNlIFN0YWdlZENvbW1pdCB7XG4gIGtpbmQ6IENvbW1pdE1lc3NhZ2VbJ2tpbmQnXTtcbiAgcGF0aDogc3RyaW5nO1xuICBwYXJlbnRWZXJzaW9uOiBzdHJpbmcgfCBudWxsO1xuICBoYXNoOiBzdHJpbmc7XG4gIHNpemU6IG51bWJlcjtcbiAgZnJvbVBhdGg/OiBzdHJpbmc7XG4gIGlzRm9sZGVyPzogYm9vbGVhbjtcbiAgYnl0ZXM/OiBVaW50OEFycmF5O1xuICAvKipcbiAgICogU3RvcmFnZSBtdGltZSBvYnNlcnZlZCBieSBUSElTIGN5Y2xlJ3Mgc2NhbiB3aGVuIGl0IGhhc2hlZCB0aGUgY29udGVudFxuICAgKiAoYEhhc2hlZEZpbGUubXRpbWVgIG9mIHRoZSBwdXNoIHNvdXJjZSkuIFBpbm5lZCBvbnRvIHRoZSBpbmRleCBlbnRyeSB3aGVuXG4gICAqIHRoZSBhY2sgbGFuZHMsIHNvIHRoZSBlbnRyeSdzIChoYXNoLCBzaXplLCBtdGltZSkgYWx3YXlzIGRlc2NyaWJlcyBPTkVcbiAgICogY29uc2lzdGVudCBpbnN0YW50IG9mIHRoZSBmaWxlIFx1MjAxNCBuZXZlciBhIGxhdGVyIHN0YXQgcGFpcmVkIHdpdGggdGhpc1xuICAgKiBoYXNoLiBUaGF0IG9yZGVyaW5nIGlzIHdoYXQgbGV0cyB0aGUgc2NhbiBmYXN0LXBhdGggKG10aW1lK3NpemUpIHNraXBcbiAgICogcmUtaGFzaGluZyBzYWZlbHk6IGFuIGVkaXQgbGFuZGluZyBiZXR3ZWVuIGhhc2ggYW5kIGFjayBjaGFuZ2VzIHRoZSBkaXNrXG4gICAqIHN0YXQsIG1pc3NlcyB0aGUgZmFzdCBwYXRoLCBhbmQgaXMgcmUtaGFzaGVkIGFuZCBwdXNoZWQgb24gdGhlIG5leHQgc2Nhbi5cbiAgICovXG4gIG10aW1lPzogbnVtYmVyO1xufVxuXG4vLyAtLS0gdGhlIGNsaWVudCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGNsYXNzIFN5bmNDbGllbnQge1xuICBwcml2YXRlIHJlYWRvbmx5IG9wdGlvbnM6IFN5bmNDbGllbnRPcHRpb25zO1xuICBwcml2YXRlIHJlYWRvbmx5IGxvZzogTG9nQWRhcHRlcjtcbiAgcHJpdmF0ZSByZWFkb25seSBub3c6ICgpID0+IG51bWJlcjtcbiAgcHJpdmF0ZSByZWFkb25seSBkZWJvdW5jZU1zOiBudW1iZXI7XG4gIHByaXZhdGUgcmVhZG9ubHkgc2NoZWR1bGU6IChmbjogKCkgPT4gdm9pZCwgbXM6IG51bWJlcikgPT4gKCkgPT4gdm9pZDtcbiAgcHJpdmF0ZSByZWFkb25seSBkaWFsVHJhbnNwb3J0OiAoKSA9PiBUcmFuc3BvcnQ7XG4gIHByaXZhdGUgcmVhZG9ubHkgcHVzaENvbmN1cnJlbmN5OiBudW1iZXI7XG4gIHByaXZhdGUgcmVhZG9ubHkgcHJvZ3Jlc3NUaHJvdHRsZU1zOiBudW1iZXI7XG5cbiAgcHJpdmF0ZSB0cmFuc3BvcnQ6IFRyYW5zcG9ydCB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHN0YXRlOiBTeW5jQ2xpZW50U3RhdGUgPSAnaWRsZSc7XG4gIHByaXZhdGUgaW5kZXg6IExvY2FsSW5kZXggPSB7fTtcbiAgcHJpdmF0ZSBjdXJzb3IgPSAwO1xuICBwcml2YXRlIGxhc3RTeW5jQXQ6IG51bWJlciB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHBlbmRpbmcgPSAwO1xuICBwcml2YXRlIGNvbmZsaWN0czogQ29uZmxpY3RPcFtdID0gW107XG4gIHByaXZhdGUgY2FzZUNvbGxpc2lvbnM6IHN0cmluZ1tdID0gW107XG4gIHByaXZhdGUgc2tpcHBlZFBhdGhzOiBzdHJpbmdbXSA9IFtdO1xuICBwcml2YXRlIGlnbm9yZVNldHRpbmdzOiBJZ25vcmVTZXR0aW5ncztcbiAgcHJpdmF0ZSB3YXRjaEFkYXB0ZXI6IFdhdGNoQWRhcHRlciB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGNhbmNlbERlYm91bmNlOiAoKCkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcblxuICAvKipcbiAgICogRGVsdGEtbWFuaWZlc3QgYm9va2tlZXBpbmcgKHBlcnNpc3RlZCBhbG9uZ3NpZGUgdGhlIGluZGV4LCBzZWVcbiAgICogYFBlcnNpc3RlZFN5bmNTdGF0ZWApOiBgc3luY2VkVGhyb3VnaGAgXHUyMDE0IHRoZSBtYW5pZmVzdCBjdXJzb3Igb2YgdGhlIGxhc3RcbiAgICogZnVsbHktc3VjY2Vzc2Z1bCBjeWNsZSwgaS5lLiB0aGUgc2VxIHRocm91Z2ggd2hpY2ggdGhlIGluZGV4IGlzIGtub3duXG4gICAqIENPTVBMRVRFIChudWxsIHVudGlsIG9uZSBmaW5pc2hlcyk7IGBuZWVkc0Z1bGxNYW5pZmVzdGAgXHUyMDE0IGEgcmVtb3RlIGNoYW5nZVxuICAgKiB3YXMgZGVmZXJyZWQgb3ZlciBsb2NhbCBkaXZlcmdlbmNlIGFuZCBtdXN0IGJlIHJlc29sdmVkIHRocm91Z2ggYSBmdWxsXG4gICAqIG1hbmlmZXN0J3MgcGxhbiBsb2dpYzsgYHNlcnZlck9sZGVzdFJldGFpbmVkU2VxYCBcdTIwMTQgdGhlIGhlbGxvQWNrJ3MgYW5zd2VyXG4gICAqIHRvIFwiaXMgbXkgcmVwbGF5IHdpbmRvdyBpbnRhY3RcIiAobnVsbCBmb3IgbGVnYWN5IHNlcnZlcnMgXHUyMUQyIGFsd2F5cyBmdWxsKS5cbiAgICovXG4gIHByaXZhdGUgc3luY2VkVGhyb3VnaDogbnVtYmVyIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgbmVlZHNGdWxsTWFuaWZlc3QgPSBmYWxzZTtcbiAgcHJpdmF0ZSBzZXJ2ZXJPbGRlc3RSZXRhaW5lZFNlcTogbnVtYmVyIHwgbnVsbCA9IG51bGw7XG4gIC8qKiBTZXJ2ZXIgcmVsZWFzZSBmcm9tIGhlbGxvQWNrOyBudWxsIHVudGlsIGFja2VkIChsZWdhY3kgc2VydmVycyBzdGF5IG51bGwpLiAqL1xuICBwcml2YXRlIHNlcnZlclZlcnNpb246IHN0cmluZyB8IG51bGwgPSBudWxsO1xuXG4gIC8qKiBDdXJyZW50IGJ1bGstcGhhc2UgcHJvZ3Jlc3MsIGNsZWFyZWQgd2hlbiBhIGN5Y2xlIHNldHRsZXMuICovXG4gIHByaXZhdGUgcHJvZ3Jlc3M6IFN5bmNQcm9ncmVzcyB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGxhc3RQcm9ncmVzc0F0ID0gMDtcblxuICAvKiogU2VyaWFsaXplZCBvcGVyYXRpb24gcXVldWUgXHUyMDE0IGV4YWN0bHkgb25lIGFzeW5jIG9wIHJ1bnMgYXQgYSB0aW1lLiAqL1xuICBwcml2YXRlIHRhaWw6IFByb21pc2U8dW5rbm93bj4gPSBQcm9taXNlLnJlc29sdmUoKTtcbiAgcHJpdmF0ZSBxdWV1ZWRPcHMgPSAwO1xuICAvKiogU3RhcnR1cC10aW1lIGNoYW5nZSBmbG9vZCBpcyBidWZmZXJlZDsgdGhlIGZ1bGwgbWFuaWZlc3Qgc3Vic3VtZXMgaXQuICovXG4gIHByaXZhdGUgYnVmZmVyaW5nID0gZmFsc2U7XG4gIHByaXZhdGUgYnVmZmVyZWQ6IE1lc3NhZ2VbXSA9IFtdO1xuICAvKipcbiAgICogT3V0c3RhbmRpbmcgcmVxdWVzdCBleHBlY3RhdGlvbnMsIG9sZGVzdCBmaXJzdC4gT3BzIGFyZSBzZXJpYWxpemVkIHBlclxuICAgKiBjeWNsZSBFWENFUFQgdGhlIHB1c2ggcGlwZWxpbmUsIHdoaWNoIGtlZXBzIHNldmVyYWwgY29tbWl0cyBpbiBmbGlnaHQgXHUyMDE0XG4gICAqIHJlcGxpZXMgb24gdGhlIG9yZGVyZWQgV1MgYXJyaXZlIGluIHNlbmQgb3JkZXIsIHNvIG1hdGNoaW5nIHRoZSBPTERFU1RcbiAgICogZXhwZWN0YXRpb24gdGhhdCBhY2NlcHRzIGEgbWVzc2FnZSBwYWlycyBldmVyeSByZXBseSB3aXRoIGl0cyByZXF1ZXN0XG4gICAqICh0aGUgRE8gYXJiaXRyYXRlcyBiZWhpbmQgYHJ1bkV4Y2x1c2l2ZWAsIGFuZCB0aGUgaW4tbWVtb3J5IHNlcnZlclxuICAgKiBtaXJyb3JzIHRoYXQsIHNvIHRoZSBzZXJ2ZXIgbmV2ZXIgcmVvcmRlcnMgcmVwbGllcyBlaXRoZXIpLlxuICAgKi9cbiAgcHJpdmF0ZSBleHBlY3RhdGlvbnM6IEFycmF5PHtcbiAgICBtYXRjaGVzOiAobWVzc2FnZTogTWVzc2FnZSkgPT4gYm9vbGVhbjtcbiAgICByZXNvbHZlOiAobWVzc2FnZTogTWVzc2FnZSkgPT4gdm9pZDtcbiAgICByZWplY3Q6IChlcnJvcjogRXJyb3IpID0+IHZvaWQ7XG4gIH0+ID0gW107XG4gIC8qKlxuICAgKiBTZXJpYWxpemVzIEFDSyBBUFBMSUNBVElPTiBhY3Jvc3MgcGlwZWxpbmUgc2xvdHMuIFNsb3RzIGF3YWl0IHJlcGxpZXNcbiAgICogY29uY3VycmVudGx5LCBidXQgZWFjaCByZXBseSBmb2xkcyBpbnRvIHRoZSBTSEFSRUQgYHRoaXMuaW5kZXhgXG4gICAqIChyZWFkLW1vZGlmeS13cml0ZSk7IGNoYWluaW5nIHRoZSBmb2xkcyBrZWVwcyBldmVyeSBhcHBseSBhdG9taWMgd2l0aFxuICAgKiByZXNwZWN0IHRvIHRoZSBvdGhlcnMuIE9yZGVyIGFjcm9zcyBkaWZmZXJlbnQgcGF0aHMgaXMgaXJyZWxldmFudCAob25lXG4gICAqIGNvbW1pdCBwZXIgcGF0aCBwZXIgY3ljbGUsIHBlci1wYXRoIHNlcnZlciBhcmJpdHJhdGlvbiksIHNvIG5vIG9yZGVyaW5nXG4gICAqIGd1YXJhbnRlZSBpcyBuZWVkZWQgYmV5b25kIG11dHVhbCBleGNsdXNpb24uXG4gICAqL1xuICBwcml2YXRlIGFja0NoYWluOiBQcm9taXNlPHZvaWQ+ID0gUHJvbWlzZS5yZXNvbHZlKCk7XG5cbiAgY29uc3RydWN0b3Iob3B0aW9uczogU3luY0NsaWVudE9wdGlvbnMpIHtcbiAgICB0aGlzLm9wdGlvbnMgPSBvcHRpb25zO1xuICAgIHRoaXMubG9nID0gb3B0aW9ucy5sb2cgPz8gZGVmYXVsdExvZztcbiAgICB0aGlzLm5vdyA9IG9wdGlvbnMubm93ID8/ICgoKSA9PiBEYXRlLm5vdygpKTtcbiAgICB0aGlzLmRlYm91bmNlTXMgPSBvcHRpb25zLmRlYm91bmNlTXMgPz8gMzAwO1xuICAgIHRoaXMuc2NoZWR1bGUgPSBvcHRpb25zLnNjaGVkdWxlID8/IGRlZmF1bHRTY2hlZHVsZTtcbiAgICB0aGlzLnB1c2hDb25jdXJyZW5jeSA9IE1hdGgubWF4KDEsIG9wdGlvbnMucHVzaENvbmN1cnJlbmN5ID8/IERFRkFVTFRfUFVTSF9DT05DVVJSRU5DWSk7XG4gICAgdGhpcy5wcm9ncmVzc1Rocm90dGxlTXMgPSBNYXRoLm1heCgwLCBvcHRpb25zLnByb2dyZXNzVGhyb3R0bGVNcyA/PyBERUZBVUxUX1BST0dSRVNTX1RIUk9UVExFX01TKTtcbiAgICB0aGlzLmRpYWxUcmFuc3BvcnQgPVxuICAgICAgdHlwZW9mIG9wdGlvbnMudHJhbnNwb3J0ID09PSAnZnVuY3Rpb24nXG4gICAgICAgID8gb3B0aW9ucy50cmFuc3BvcnRcbiAgICAgICAgOiAoKSA9PiBvcHRpb25zLnRyYW5zcG9ydCBhcyBUcmFuc3BvcnQ7XG4gICAgdGhpcy5pZ25vcmVTZXR0aW5ncyA9IG9wdGlvbnMuc2V0dGluZ3MgPz8geyBvYnNpZGlhblN5bmM6IGZhbHNlIH07XG4gIH1cblxuICAvLyAtLS0gbGlmZWN5Y2xlIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICAvKiogUnVuIHN0YXJ0dXAgcmVjb25jaWxpYXRpb24gYW5kIGVudGVyIGxpdmUgbW9kZS4gKi9cbiAgYXN5bmMgY29ubmVjdCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLmVucXVldWUoKCkgPT4gdGhpcy5zdGFydHVwKCkpO1xuICB9XG5cbiAgLyoqIFJlLWRpYWwgYW5kIHJlLXJ1biB0aGUgZnVsbCBzdGFydHVwIHJlY29uY2lsaWF0aW9uLiAqL1xuICBhc3luYyByZWNvbm5lY3QoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5lbnF1ZXVlKGFzeW5jICgpID0+IHtcbiAgICAgIHRoaXMudHJhbnNwb3J0Py5jbG9zZSgpO1xuICAgICAgdGhpcy50cmFuc3BvcnQgPSBudWxsO1xuICAgICAgYXdhaXQgdGhpcy5zdGFydHVwKCk7XG4gICAgfSk7XG4gIH1cblxuICBjbG9zZSgpOiB2b2lkIHtcbiAgICB0aGlzLnN0b3BXYXRjaGluZygpO1xuICAgIHRoaXMuY2FuY2VsRGVib3VuY2U/LigpO1xuICAgIHRoaXMuY2FuY2VsRGVib3VuY2UgPSBudWxsO1xuICAgIHRoaXMudHJhbnNwb3J0Py5jbG9zZSgpO1xuICAgIHRoaXMudHJhbnNwb3J0ID0gbnVsbDtcbiAgICB0aGlzLnN0YXRlID0gJ2lkbGUnO1xuICB9XG5cbiAgLyoqIEJlZ2luIGRlYm91bmNlZCB3YXRjaGluZyAoQVJDSElURUNUVVJFIFx1MDBBNzggbGl2ZSBvcGVyYXRpb24pLiAqL1xuICBzdGFydFdhdGNoaW5nKHdhdGNoQWRhcHRlcjogV2F0Y2hBZGFwdGVyKTogdm9pZCB7XG4gICAgdGhpcy5zdG9wV2F0Y2hpbmcoKTtcbiAgICB0aGlzLndhdGNoQWRhcHRlciA9IHdhdGNoQWRhcHRlcjtcbiAgICB3YXRjaEFkYXB0ZXIuc3RhcnQoKGV2ZW50cykgPT4gdGhpcy5vbldhdGNoRXZlbnRzKGV2ZW50cykpO1xuICB9XG5cbiAgc3RvcFdhdGNoaW5nKCk6IHZvaWQge1xuICAgIHRoaXMud2F0Y2hBZGFwdGVyPy5zdG9wKCk7XG4gICAgdGhpcy53YXRjaEFkYXB0ZXIgPSBudWxsO1xuICB9XG5cbiAgLyoqIE1hbnVhbCBvbmUtc2hvdCBjeWNsZSAoYHZzYWAgb25lLXNob3QsIFwic3luYyBub3dcIiBidXR0b25zLCB0ZXN0cykuICovXG4gIGFzeW5jIHRyaWdnZXJTeW5jKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMuZW5xdWV1ZSgoKSA9PiB0aGlzLnJ1bkN5Y2xlKCkpO1xuICB9XG5cbiAgLyoqIFJlc29sdmVzIHdoZW4gZXZlcnkgcXVldWVkIG9wZXJhdGlvbiBoYXMgc2V0dGxlZC4gKi9cbiAgYXN5bmMgd2FpdElkbGUoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgd2hpbGUgKHRoaXMucXVldWVkT3BzID4gMCkgYXdhaXQgdGhpcy50YWlsO1xuICAgIGF3YWl0IHRoaXMudGFpbDtcbiAgfVxuXG4gIHN0YXR1cygpOiBTeW5jQ2xpZW50U3RhdHVzIHtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdGU6IHRoaXMuc3RhdGUsXG4gICAgICBsYXN0U3luY0F0OiB0aGlzLmxhc3RTeW5jQXQsXG4gICAgICBwZW5kaW5nOiB0aGlzLnBlbmRpbmcsXG4gICAgICBjb25mbGljdHM6IFsuLi50aGlzLmNvbmZsaWN0c10sXG4gICAgICAuLi4odGhpcy5jYXNlQ29sbGlzaW9ucy5sZW5ndGggPiAwID8geyBjYXNlQ29sbGlzaW9uczogWy4uLnRoaXMuY2FzZUNvbGxpc2lvbnNdIH0gOiB7fSksXG4gICAgICAuLi4odGhpcy5za2lwcGVkUGF0aHMubGVuZ3RoID4gMCA/IHsgc2tpcHBlZFBhdGhzOiBbLi4udGhpcy5za2lwcGVkUGF0aHNdIH0gOiB7fSksXG4gICAgICBzZXJ2ZXJWZXJzaW9uOiB0aGlzLnNlcnZlclZlcnNpb24sXG4gICAgICAuLi4odGhpcy5wcm9ncmVzcyAhPT0gbnVsbCA/IHsgcHJvZ3Jlc3M6IHsgLi4udGhpcy5wcm9ncmVzcyB9IH0gOiB7fSksXG4gICAgfTtcbiAgfVxuXG4gIC8qKiBSZWFkLW9ubHkgdmlldyBvZiB0aGUgbG9jYWwgaW5kZXggKHRlc3RzLCBgdnNhIHN0YXR1c2ApLiAqL1xuICBjdXJyZW50SW5kZXgoKTogTG9jYWxJbmRleCB7XG4gICAgcmV0dXJuIHsgLi4udGhpcy5pbmRleCB9O1xuICB9XG5cbiAgLyoqIExhc3Qgc2VlbiBzZXJ2ZXIgc2VxdWVuY2UgbnVtYmVyLiAqL1xuICBnZXQgY3Vyc29yVmFsdWUoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy5jdXJzb3I7XG4gIH1cblxuICAvKiogVFMtc2FmZSBzdGF0ZSBwcm9iZSAoYXNzaWdubWVudHMgaW5zaWRlIGFzeW5jIGZsb3dzIGRlZmVhdCBuYXJyb3dpbmcpLiAqL1xuICBwcml2YXRlIGlzRGlzY29ubmVjdGVkKCk6IGJvb2xlYW4ge1xuICAgIHJldHVybiB0aGlzLnN0YXRlID09PSAnZGlzY29ubmVjdGVkJztcbiAgfVxuXG4gIC8vIC0tLSBzdGFydHVwIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICBwcml2YXRlIGFzeW5jIHN0YXJ0dXAoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5zdGF0ZSA9ICdjb25uZWN0aW5nJztcbiAgICB0aGlzLmJ1ZmZlcmluZyA9IHRydWU7XG4gICAgdGhpcy5idWZmZXJlZCA9IFtdO1xuXG4gICAgLy8gUmVzdG9yZSB0aGUgaW5kZXggQU5EIHRoZSBzeW5jLWN1cnNvciBib29ra2VlcGluZyAob25lIGF0b21pYyBmaWxlKTpcbiAgICAvLyB0aGUgcGVyc2lzdGVkIGN1cnNvciBsZXRzIGhlbGxvIHJlcGxheSBvbmx5IHdoYXQgd2FzIG1pc3NlZCwgYW5kXG4gICAgLy8gYHN5bmNlZFRocm91Z2hgIGRlY2lkZXMgd2hldGhlciBhIGRlbHRhIG1hbmlmZXN0IG1heSBiZSByZXF1ZXN0ZWQuXG4gICAgLy8gQSBzdGF0ZSBmaWxlIHRoYXQgZmFpbHMgdG8gcGFyc2Ugb3IgdmFsaWRhdGUgaXMgbW92ZWQgYXNpZGUgKHRoZVxuICAgIC8vIGNvbmZpZy1zdG9yZSByZWNvdmVyeSBwYXR0ZXJuKSBhbmQgdGhlIGNsaWVudCByZXN5bmNzIGZyb20gYSBGVUxMXG4gICAgLy8gbWFuaWZlc3Qgb2ZmIGEgZnJlc2ggaW5kZXggXHUyMDE0IG9uZSBjb3JydXB0IGZpZWxkIG11c3Qgbm90IHdlZGdlIGV2ZXJ5XG4gICAgLy8gZnV0dXJlIHN0YXJ0dXAuXG4gICAgaWYgKGF3YWl0IHRoaXMuc2FmZVN0b3JhZ2VFeGlzdHMoTE9DQUxfSU5ERVhfU1RBVEVfUEFUSCkpIHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGNvbnN0IGxvYWRlZCA9IGF3YWl0IGxvYWRMb2NhbFN0YXRlKHRoaXMub3B0aW9ucy5zdG9yYWdlKTtcbiAgICAgICAgdGhpcy5pbmRleCA9IGxvYWRlZC5pbmRleDtcbiAgICAgICAgdGhpcy5jdXJzb3IgPSBsb2FkZWQuc3RhdGUuY3Vyc29yO1xuICAgICAgICB0aGlzLnN5bmNlZFRocm91Z2ggPSBsb2FkZWQuc3RhdGUuc3luY2VkVGhyb3VnaDtcbiAgICAgICAgdGhpcy5uZWVkc0Z1bGxNYW5pZmVzdCA9IGxvYWRlZC5zdGF0ZS5uZWVkc0Z1bGxNYW5pZmVzdDtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5vcHRpb25zLnN0b3JhZ2UucmVuYW1lRmlsZShcbiAgICAgICAgICAgIExPQ0FMX0lOREVYX1NUQVRFX1BBVEgsXG4gICAgICAgICAgICBgJHtMT0NBTF9JTkRFWF9TVEFURV9QQVRIfS5jb3JydXB0LmJha2AsXG4gICAgICAgICAgKTtcbiAgICAgICAgfSBjYXRjaCB7XG4gICAgICAgICAgLy8gQ291bGQgbm90IG1vdmUgdGhlIGJhZCBmaWxlIGFzaWRlOyB0aGUgZmlyc3QgcGVyc2lzdCBiZWxvd1xuICAgICAgICAgIC8vIG92ZXJ3cml0ZXMgaXQsIHNvIHRoZSBjbGllbnQgY2FuIHN0aWxsIG9wZXJhdGUuXG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5sb2cud2FybihcbiAgICAgICAgICAnbG9jYWwgaW5kZXggc3RhdGUgaXMgY29ycnVwdDsgcXVhcmFudGluZWQgdG8gc3RhdGUuY29ycnVwdC5iYWsgYW5kIHJlc3luY2luZyBmcm9tIGEgZnVsbCBtYW5pZmVzdCcsXG4gICAgICAgICAgZXJyb3IsXG4gICAgICAgICk7XG4gICAgICAgIHRoaXMucmVzZXRMb2NhbFN0YXRlKCk7XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMucmVzZXRMb2NhbFN0YXRlKCk7XG4gICAgfVxuICAgIHRoaXMuc2VydmVyT2xkZXN0UmV0YWluZWRTZXEgPSBudWxsO1xuICAgIC8vIFZlcnNpb24gc2tldyBpcyByZS1hc3Nlc3NlZCBwZXIgY29ubmVjdGlvbjogcmVzZXQgYmVmb3JlIHRoZSBhY2sgc28gYVxuICAgIC8vIHJlY29ubmVjdCBhZ2FpbnN0IGEgZGlmZmVyZW50IChvciBsZWdhY3kpIHNlcnZlciBuZXZlciByZXBvcnRzIGEgc3RhbGVcbiAgICAvLyB2ZXJzaW9uIGJldHdlZW4gdGhlIGRpYWwgYW5kIHRoZSBmcmVzaCBoZWxsb0Fjay5cbiAgICB0aGlzLnNlcnZlclZlcnNpb24gPSBudWxsO1xuXG4gICAgY29uc3QgdHJhbnNwb3J0ID0gdGhpcy5kaWFsVHJhbnNwb3J0KCk7XG4gICAgdGhpcy50cmFuc3BvcnQgPSB0cmFuc3BvcnQ7XG4gICAgdHJhbnNwb3J0Lm9uTWVzc2FnZSgobWVzc2FnZSkgPT4gdGhpcy5vblRyYW5zcG9ydE1lc3NhZ2UobWVzc2FnZSkpO1xuICAgIHRyYW5zcG9ydC5vbkNsb3NlKChyZWFzb24pID0+IHRoaXMub25UcmFuc3BvcnRDbG9zZShyZWFzb24pKTtcblxuICAgIGNvbnN0IGhlbGxvQWNrID0gYXdhaXQgdGhpcy5yZXF1ZXN0PEhlbGxvQWNrTWVzc2FnZSB8IFNlcnZlckVycm9yTWVzc2FnZT4oXG4gICAgICAobSkgPT4gbS50eXBlID09PSAnaGVsbG9BY2snIHx8IG0udHlwZSA9PT0gJ2Vycm9yJyxcbiAgICAgICgpID0+XG4gICAgICAgIHRyYW5zcG9ydC5zZW5kKHtcbiAgICAgICAgICB0eXBlOiAnaGVsbG8nLFxuICAgICAgICAgIHRva2VuOiB0aGlzLm9wdGlvbnMudG9rZW4sXG4gICAgICAgICAgcHJvdG9jb2xWZXJzaW9uOiBQcm90b2NvbFZlcnNpb24sXG4gICAgICAgICAgY3Vyc29yOiB0aGlzLmN1cnNvcixcbiAgICAgICAgfSksXG4gICAgKTtcbiAgICBpZiAoaGVsbG9BY2sudHlwZSA9PT0gJ2Vycm9yJykgdGhyb3cgdGhpcy50b0Vycm9yKGhlbGxvQWNrKTtcbiAgICAvLyBUaGUgc2VydmVyJ3MgcGVyLXZhdWx0IGBvYnNpZGlhblN5bmNgIHN1cGVyc2VkZXMgdGhlIGxvY2FsIGluaXRpYWxcbiAgICAvLyB2YWx1ZSwgYnV0IGBleHRyYUlnbm9yZXNgIGlzIGEgY2xpZW50LXNpZGUgY29uY2VybiBcdTIwMTQgdGhlIHdvcmtlciBuZXZlclxuICAgIC8vIHNlbmRzIGl0LCBzbyB0aGUgbG9jYWxseSBjb25maWd1cmVkIHBhdHRlcm5zIHN1cnZpdmUgdGhlIGhhbmRzaGFrZS5cbiAgICB0aGlzLmlnbm9yZVNldHRpbmdzID0ge1xuICAgICAgb2JzaWRpYW5TeW5jOiBoZWxsb0Fjay5zZXR0aW5ncy5vYnNpZGlhblN5bmMsXG4gICAgICAuLi4odGhpcy5pZ25vcmVTZXR0aW5ncy5leHRyYUlnbm9yZXMgIT09IHVuZGVmaW5lZFxuICAgICAgICA/IHsgZXh0cmFJZ25vcmVzOiB0aGlzLmlnbm9yZVNldHRpbmdzLmV4dHJhSWdub3JlcyB9XG4gICAgICAgIDoge30pLFxuICAgIH07XG4gICAgLy8gUmVwbGF5LXdpbmRvdyBhbnN3ZXI6IHdpdGggdGhpcywgdGhlIGNsaWVudCBjYW4gdGVsbCB3aGV0aGVyIGV2ZXJ5XG4gICAgLy8gZXZlbnQgYWZ0ZXIgaXRzIGN1cnNvciB3YXMgcmV0YWluZWQgKGRlbHRhLW1hbmlmZXN0IGVsaWdpYmlsaXR5KS5cbiAgICB0aGlzLnNlcnZlck9sZGVzdFJldGFpbmVkU2VxID0gaGVsbG9BY2sub2xkZXN0UmV0YWluZWRTZXEgPz8gbnVsbDtcbiAgICB0aGlzLnNlcnZlclZlcnNpb24gPSBoZWxsb0Fjay5zZXJ2ZXJWZXJzaW9uID8/IG51bGw7XG5cbiAgICB0aGlzLnN0YXRlID0gJ3N5bmNpbmcnO1xuICAgIGlmICh0aGlzLnNob3VsZFJlcXVlc3REZWx0YU1hbmlmZXN0KCkpIHtcbiAgICAgIC8vIERFTFRBIE1PREU6IGFwcGx5IHRoZSByZXBsYXllZCBjaGFuZ2VzIEJFRk9SRSBwbGFubmluZy4gVGhlIGRlbHRhXG4gICAgICAvLyBtYW5pZmVzdCBvbWl0cyBldmVyeSBoZWFkIGF0IG9yIGJlbG93IHRoZSBjdXJzb3IgXHUyMDE0IGluY2x1ZGluZyBoZWFkc1xuICAgICAgLy8gdGhhdCBubyBsb25nZXIgZXhpc3QgYmVjYXVzZSB0aGUgYXV0aG9yaXR5IE1JR1JBVEVEIHRoZW0gKGEgcmVuYW1lXG4gICAgICAvLyBkZWxldGVzIHRoZSBvbGQgcm93KSBcdTIwMTQgc28gdGhlIGluZGV4IHByb2plY3Rpb24gbXVzdCBub3QgY2FycnkgdGhvc2VcbiAgICAgIC8vIHBhdGhzIGFueW1vcmUuIFRoZSByZXBsYXllZCByZW5hbWUgKHNlcSA+IGN1cnNvcikgbWF0ZXJpYWxpemVzIGhlcmVcbiAgICAgIC8vIGFuZCByZW1vdmVzIHRoZSBzdGFsZSBwYXRoLCBtYWtpbmcgdGhlIG1lcmdlZCB2aWV3IGlkZW50aWNhbCB0byB3aGF0XG4gICAgICAvLyBhIGZ1bGwgbWFuaWZlc3Qgd291bGQgaGF2ZSBzYWlkLiAoVGhlIG9yZGVyZWQgd2lyZSBndWFyYW50ZWVzIHRoZVxuICAgICAgLy8gcmVwbGF5IHByZWNlZGVzIHRoZSBtYW5pZmVzdCByZXBseTsgYW55dGhpbmcgc3RyYWdnbGluZyBzdGF5c1xuICAgICAgLy8gYnVmZmVyZWQgYW5kIGlzIGRpc3BhdGNoZWQgYWZ0ZXIgdGhlIGN5Y2xlLCBhcyBhbHdheXMuKSBBIHJlcGxheWVkXG4gICAgICAvLyBjaGFuZ2UgdGhhdCBoaXRzIHRoZSBkaXZlcmdlbmNlIGd1YXJkIGZsaXBzIGBuZWVkc0Z1bGxNYW5pZmVzdGAsXG4gICAgICAvLyBhbmQgYGZldGNoTWFuaWZlc3RgIHJlLWV2YWx1YXRlcyBcdTIwMTQgZmFsbGluZyBiYWNrIHRvIGZ1bGwsIGFzIGRlc2lnbmVkLlxuICAgICAgY29uc3QgcmVwbGF5ID0gdGhpcy5idWZmZXJlZDtcbiAgICAgIHRoaXMuYnVmZmVyZWQgPSBbXTtcbiAgICAgIGZvciAoY29uc3QgbWVzc2FnZSBvZiByZXBsYXkpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5kaXNwYXRjaChtZXNzYWdlKTtcbiAgICAgIH1cbiAgICB9XG4gICAgYXdhaXQgdGhpcy5ydW5DeWNsZSgpO1xuXG4gICAgdGhpcy5idWZmZXJpbmcgPSBmYWxzZTtcbiAgICBjb25zdCBidWZmZXJlZCA9IHRoaXMuYnVmZmVyZWQ7XG4gICAgdGhpcy5idWZmZXJlZCA9IFtdO1xuICAgIGZvciAoY29uc3QgbWVzc2FnZSBvZiBidWZmZXJlZCkge1xuICAgICAgYXdhaXQgdGhpcy5kaXNwYXRjaChtZXNzYWdlKTtcbiAgICB9XG4gICAgaWYgKCF0aGlzLmlzRGlzY29ubmVjdGVkKCkpIHRoaXMuc3RhdGUgPSAnbGl2ZSc7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHNhZmVTdG9yYWdlRXhpc3RzKHBhdGg6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5vcHRpb25zLnN0b3JhZ2UuZXhpc3RzKHBhdGgpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIC8qKiBGcmVzaCBpbmRleCArIGN1cnNvciBib29ra2VlcGluZzogbm8gcHJpb3Iga25vd2xlZGdlLCBmdWxsIG1hbmlmZXN0LiAqL1xuICBwcml2YXRlIHJlc2V0TG9jYWxTdGF0ZSgpOiB2b2lkIHtcbiAgICB0aGlzLmluZGV4ID0ge307XG4gICAgdGhpcy5jdXJzb3IgPSAwO1xuICAgIHRoaXMuc3luY2VkVGhyb3VnaCA9IG51bGw7XG4gICAgdGhpcy5uZWVkc0Z1bGxNYW5pZmVzdCA9IGZhbHNlO1xuICB9XG5cbiAgcHJpdmF0ZSBvblRyYW5zcG9ydENsb3NlKHJlYXNvbjogeyBjb2RlPzogbnVtYmVyOyByZWFzb24/OiBzdHJpbmcgfSk6IHZvaWQge1xuICAgIHRoaXMubG9nLndhcm4oJ3RyYW5zcG9ydCBjbG9zZWQnLCByZWFzb24pO1xuICAgIHRoaXMuc3RhdGUgPSAnZGlzY29ubmVjdGVkJztcbiAgICBjb25zdCBleHBlY3RhdGlvbnMgPSB0aGlzLmV4cGVjdGF0aW9ucztcbiAgICB0aGlzLmV4cGVjdGF0aW9ucyA9IFtdO1xuICAgIGZvciAoY29uc3QgZXhwZWN0YXRpb24gb2YgZXhwZWN0YXRpb25zKSB7XG4gICAgICBleHBlY3RhdGlvbi5yZWplY3QoXG4gICAgICAgIG5ldyBOZXR3b3JrRXJyb3IoYGNvbm5lY3Rpb24gY2xvc2VkOiAke3JlYXNvbi5yZWFzb24gPz8gcmVhc29uLmNvZGUgPz8gJ3Vua25vd24nfWApLFxuICAgICAgKTtcbiAgICB9XG4gIH1cblxuICAvLyAtLS0gbWVzc2FnZSBwdW1wIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICBwcml2YXRlIG9uVHJhbnNwb3J0TWVzc2FnZSA9IChtZXNzYWdlOiBNZXNzYWdlKTogdm9pZCA9PiB7XG4gICAgLy8gT2xkZXN0IGV4cGVjdGF0aW9uIHRoYXQgYWNjZXB0cyB0aGlzIG1lc3NhZ2UuIFdpdGggdGhlIHB1c2ggcGlwZWxpbmVcbiAgICAvLyBzZXZlcmFsIGNvbW1pdCBleHBlY3RhdGlvbnMgYXJlIG91dHN0YW5kaW5nIGF0IG9uY2U7IHRoZSBvcmRlcmVkIHdpcmUgK1xuICAgIC8vIHRoZSBzZXJ2ZXIncyBzZXJpYWxpemVkIGFyYml0cmF0aW9uIGRlbGl2ZXIgcmVwbGllcyBpbiBzZW5kIG9yZGVyLCBzb1xuICAgIC8vIGZpcnN0LW1hdGNoIHBhaXJzIGVhY2ggcmVwbHkgd2l0aCBpdHMgb3duIHJlcXVlc3QuXG4gICAgY29uc3QgaW5kZXggPSB0aGlzLmV4cGVjdGF0aW9ucy5maW5kSW5kZXgoKGV4cGVjdGF0aW9uKSA9PiBleHBlY3RhdGlvbi5tYXRjaGVzKG1lc3NhZ2UpKTtcbiAgICBpZiAoaW5kZXggPj0gMCkge1xuICAgICAgY29uc3QgZXhwZWN0YXRpb24gPSB0aGlzLmV4cGVjdGF0aW9uc1tpbmRleF07XG4gICAgICB0aGlzLmV4cGVjdGF0aW9ucy5zcGxpY2UoaW5kZXgsIDEpO1xuICAgICAgaWYgKGV4cGVjdGF0aW9uICE9PSB1bmRlZmluZWQpIGV4cGVjdGF0aW9uLnJlc29sdmUobWVzc2FnZSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmICh0aGlzLmJ1ZmZlcmluZykge1xuICAgICAgdGhpcy5idWZmZXJlZC5wdXNoKG1lc3NhZ2UpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLmVucXVldWUoYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5kaXNwYXRjaChtZXNzYWdlKTtcbiAgICB9KS5jYXRjaCgoZXJyb3I6IHVua25vd24pID0+IHRoaXMubG9nLndhcm4oJ2NoYW5nZSBoYW5kbGVyIGZhaWxlZCcsIGVycm9yKSk7XG4gIH07XG5cbiAgcHJpdmF0ZSBhc3luYyBkaXNwYXRjaChtZXNzYWdlOiBNZXNzYWdlKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgc3dpdGNoIChtZXNzYWdlLnR5cGUpIHtcbiAgICAgIGNhc2UgJ2NoYW5nZSc6XG4gICAgICAgIGF3YWl0IHRoaXMuaGFuZGxlQ2hhbmdlKG1lc3NhZ2UpO1xuICAgICAgICByZXR1cm47XG4gICAgICBjYXNlICdkZXZpY2VTZWVuJzpcbiAgICAgICAgcmV0dXJuOyAvLyBwcmVzZW5jZSBvbmx5OyBkYXNoYm9hcmRzIGNvbnN1bWUgaXRcbiAgICAgIGNhc2UgJ3BvbmcnOlxuICAgICAgICByZXR1cm47XG4gICAgICBjYXNlICdlcnJvcic6XG4gICAgICAgIHRoaXMubG9nLmVycm9yKCdzZXJ2ZXIgZXJyb3InLCBtZXNzYWdlLmNvZGUsIG1lc3NhZ2UubWVzc2FnZSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIGNhc2UgJ2hlbGxvQWNrJzpcbiAgICAgIGNhc2UgJ21hbmlmZXN0JzpcbiAgICAgIGNhc2UgJ2NvbW1pdEFjayc6XG4gICAgICBjYXNlICdjb25mbGljdCc6XG4gICAgICBjYXNlICdibG9iJzpcbiAgICAgIGNhc2UgJ2Jsb2JBY2snOlxuICAgICAgY2FzZSAnc25hcHNob3RDcmVhdGVBY2snOlxuICAgICAgY2FzZSAnc25hcHNob3RSZXN0b3JlQWNrJzpcbiAgICAgICAgLy8gUmVwbGllcyBhcnJpdmUgb25seSBhZ2FpbnN0IGFuIG91dHN0YW5kaW5nIGV4cGVjdGF0aW9uOyBhXG4gICAgICAgIC8vIHNwb250YW5lb3VzIG9uZSBpcyBhIHByb3RvY29sIHZpb2xhdGlvbiB3ZSBsb2cgYW5kIGRyb3AuXG4gICAgICAgIHRoaXMubG9nLndhcm4oJ3VuZXhwZWN0ZWQgc2VydmVyIHJlcGx5JywgbWVzc2FnZS50eXBlKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgdGhpcy5sb2cud2FybignaWdub3JpbmcgY2xpZW50LXRvLXNlcnZlciBtZXNzYWdlIGZyb20gc2VydmVyJywgbWVzc2FnZSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBoYW5kbGVDaGFuZ2UoY2hhbmdlOiBDaGFuZ2VNZXNzYWdlKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdmFsaWRhdGVDaGFuZ2VNZXNzYWdlKGNoYW5nZSk7XG4gICAgaWYgKGNoYW5nZS5zZXEgPiB0aGlzLmN1cnNvcikgdGhpcy5jdXJzb3IgPSBjaGFuZ2Uuc2VxO1xuICAgIC8vIFdpbmRvd3MtdW5zYWZlIHBhdGhzIGNhbiBuZXZlciBiZSBtYXRlcmlhbGl6ZWQgaGVyZTogc2tpcCB0aGUgaGVhZFxuICAgIC8vIChkaWFnbm9zZWQsIG5vdCBhcHBsaWVkKSBpbnN0ZWFkIG9mIGZhaWxpbmcgdGhlIGhhbmRsZXIgZXZlcnkgdGltZS5cbiAgICAvLyBDaGVja2VkIGJlZm9yZSB0aGUgaWdub3JlIHJ1bGVzIFx1MjAxNCBhbiB1bnN5bmNhYmxlIHBhdGggaXMgbmV2ZXIgaWdub3JlZFxuICAgIC8vIHNpbGVudGx5LlxuICAgIGNvbnN0IHVuc2FmZSA9IGZpcnN0VW5zYWZlUGF0aChcbiAgICAgIGNoYW5nZS5mcm9tUGF0aCAhPT0gdW5kZWZpbmVkID8gW2NoYW5nZS5wYXRoLCBjaGFuZ2UuZnJvbVBhdGhdIDogW2NoYW5nZS5wYXRoXSxcbiAgICApO1xuICAgIGlmICh1bnNhZmUgIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5yZWNvcmRTa2lwcGVkUGF0aCh1bnNhZmUpO1xuICAgICAgLy8gVGhlIGhlYWQgaXMgcmVzb2x2ZWQgXHUyMDE0IGJ5IHNraXBwaW5nIFx1MjAxNCBzbyB0aGUgY29tcGxldGlvbiB3YXRlcm1hcmtcbiAgICAgIC8vIGFkdmFuY2VzIHdpdGggdGhlIGZlZWQgbGlrZSBhbiBhcHBsaWVkIGNoYW5nZSB3b3VsZC5cbiAgICAgIGlmIChjaGFuZ2Uuc2VxID4gKHRoaXMuc3luY2VkVGhyb3VnaCA/PyAwKSkgdGhpcy5zeW5jZWRUaHJvdWdoID0gY2hhbmdlLnNlcTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKGlzSWdub3JlZChjaGFuZ2UucGF0aCwgdGhpcy5pZ25vcmVTZXR0aW5ncykpIHJldHVybjtcbiAgICBpZiAoY2hhbmdlLmZyb21QYXRoICE9PSB1bmRlZmluZWQgJiYgaXNJZ25vcmVkKGNoYW5nZS5mcm9tUGF0aCwgdGhpcy5pZ25vcmVTZXR0aW5ncykpIHJldHVybjtcblxuICAgIC8vIFN0YWxlIHJlcGxheSAvIGR1cGxpY2F0ZSBmYW4tb3V0OiBwZXIgcGF0aCB0aGUgaGVhZCBjbG9jayBkb21pbmF0ZXNcbiAgICAvLyBldmVyeSBlYXJsaWVyIHZlcnNpb24sIHNvIGFueXRoaW5nIFx1MjI2NCB0aGUgcmVjb3JkZWQgY2xvY2sgaXMgb2xkIG5ld3MuXG4gICAgY29uc3QgZW50cnkgPSB0aGlzLmluZGV4W2NoYW5nZS5wYXRoXTtcbiAgICBpZiAoZW50cnkgIT09IHVuZGVmaW5lZCkge1xuICAgICAgaWYgKGVudHJ5LnZlcnNpb25JZCA9PT0gY2hhbmdlLnZlcnNpb24pIHJldHVybjtcbiAgICAgIGlmIChjb21wYXJlQ2xvY2tzKGVudHJ5LmNsb2NrLCBjaGFuZ2UuY2xvY2spID49IDApIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBUaGUgZ3VhcmQ6IG5ldmVyIHdyaXRlIGEgcmVtb3RlIGNoYW5nZSBvdmVyIGxvY2FsbHktZGl2ZXJnZWQgY29udGVudC5cbiAgICBpZiAoIShhd2FpdCB0aGlzLmNoYW5nZUlzU2FmZShjaGFuZ2UpKSkge1xuICAgICAgdGhpcy5sb2cuaW5mbygnZGVmZXJyaW5nIHJlbW90ZSBjaGFuZ2Ugb3ZlciBsb2NhbCBkaXZlcmdlbmNlJywgY2hhbmdlLnBhdGgpO1xuICAgICAgLy8gVGhlIGRpdmVyZ2VuY2UgbXVzdCBiZSByZXNvbHZlZCBieSBhIHBsYW4gY3ljbGUgdGhhdCBjYW4gU0VFIHRoZVxuICAgICAgLy8gcmVtb3RlIGhlYWQgXHUyMDE0IGZsYWcgdGhlIG5leHQgbWFuaWZlc3QgZnVsbCAoZGVsdGEgbWFuaWZlc3RzIG9taXRcbiAgICAgIC8vIGhlYWRzIGF0IG9yIGJlbG93IHRoZSBjdXJzb3IsIHdoaWNoIHRoaXMgY2hhbmdlIG1heSBiZSBhdCkuXG4gICAgICB0aGlzLm5lZWRzRnVsbE1hbmlmZXN0ID0gdHJ1ZTtcbiAgICAgIHRoaXMuc2NoZWR1bGVSZWNvbmNpbGUoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0aGlzLmluZGV4ID0gYXdhaXQgdGhpcy5hcHBseVB1bGxzKFt0aGlzLnB1bGxPcEZyb21DaGFuZ2UoY2hhbmdlKV0pO1xuICAgIC8vIFRoaXMgcGF0aCdzIGhlYWQgaXMgbm93IG1hdGVyaWFsaXplZCBsb2NhbGx5LCBzbyB0aGUgY29tcGxldGlvblxuICAgIC8vIHdhdGVybWFyayBhZHZhbmNlcyB3aXRoIHRoZSAoc3RyaWN0bHkgb3JkZXJlZCkgZmVlZC4gQSBjaGFuZ2UgdGhhdFxuICAgIC8vIHRvb2sgdGhlIGRlZmVyIGJyYW5jaCBhYm92ZSBuZXZlciByZWFjaGVzIHRoaXMgbGluZSwgYW5kIGl0c1xuICAgIC8vIGBuZWVkc0Z1bGxNYW5pZmVzdGAgZmxhZyBrZWVwcyBkZWx0YSBtb2RlIG9mZiB1bnRpbCBhIGZ1bGwtbWFuaWZlc3RcbiAgICAvLyBjeWNsZSByZXNvbHZlcyB0aGUgZGl2ZXJnZW5jZS5cbiAgICBpZiAoY2hhbmdlLnNlcSA+ICh0aGlzLnN5bmNlZFRocm91Z2ggPz8gMCkpIHRoaXMuc3luY2VkVGhyb3VnaCA9IGNoYW5nZS5zZXE7XG4gIH1cblxuICAvKipcbiAgICogQSBjaGFuZ2UgbWF5IGJlIGFwcGxpZWQgZGlyZWN0bHkgb25seSB3aGVuIHRoZSB0b3VjaGVkIHBhdGhzIGNhcnJ5IG5vXG4gICAqIHVuLXJlY29uY2lsZWQgbG9jYWwgY29udGVudC4gQW55dGhpbmcgZWxzZSBtdXN0IGRldG91ciB0aHJvdWdoIGEgZnVsbFxuICAgKiBgY29tcHV0ZVN5bmNQbGFuYCBjeWNsZSAoY29uZmxpY3QgbG9naWMsIGNvbmZsaWN0IGNvcGllcykuXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIGNoYW5nZUlzU2FmZShjaGFuZ2U6IENoYW5nZU1lc3NhZ2UpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBpZiAoY2hhbmdlLmlzRm9sZGVyID09PSB0cnVlKSByZXR1cm4gdHJ1ZTtcbiAgICBpZiAoY2hhbmdlLmtpbmQgPT09ICdyZW5hbWUnICYmIGNoYW5nZS5mcm9tUGF0aCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBpZiAoYXdhaXQgdGhpcy5wYXRoSGFzTG9jYWxEaXZlcmdlbmNlKGNoYW5nZS5mcm9tUGF0aCkpIHJldHVybiBmYWxzZTtcbiAgICAgIGlmIChhd2FpdCB0aGlzLnN0b3JhZ2VFeGlzdHMoY2hhbmdlLnBhdGgpKSB7XG4gICAgICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5pbmRleFtjaGFuZ2UucGF0aF07XG4gICAgICAgIGlmIChlbnRyeSA9PT0gdW5kZWZpbmVkIHx8IGVudHJ5LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkKSByZXR1cm4gZmFsc2U7XG4gICAgICAgIGNvbnN0IGFjdHVhbCA9IGF3YWl0IHNoYTI1NkhleChhd2FpdCB0aGlzLm9wdGlvbnMuc3RvcmFnZS5yZWFkRmlsZShjaGFuZ2UucGF0aCkpO1xuICAgICAgICBpZiAoYWN0dWFsICE9PSBlbnRyeS5oYXNoKSByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgcmV0dXJuICEoYXdhaXQgdGhpcy5wYXRoSGFzTG9jYWxEaXZlcmdlbmNlKGNoYW5nZS5wYXRoKSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHBhdGhIYXNMb2NhbERpdmVyZ2VuY2UocGF0aDogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgY29uc3QgZW50cnkgPSB0aGlzLmluZGV4W3BhdGhdO1xuICAgIGlmIChlbnRyeT8uaXNGb2xkZXIpIHJldHVybiBmYWxzZTtcbiAgICBpZiAoIShhd2FpdCB0aGlzLnN0b3JhZ2VFeGlzdHMocGF0aCkpKSByZXR1cm4gZmFsc2U7XG4gICAgaWYgKGVudHJ5ID09PSB1bmRlZmluZWQgfHwgZW50cnkuZGVsZXRlZEF0ICE9PSB1bmRlZmluZWQpIHJldHVybiB0cnVlO1xuICAgIGNvbnN0IGFjdHVhbCA9IGF3YWl0IHNoYTI1NkhleChhd2FpdCB0aGlzLm9wdGlvbnMuc3RvcmFnZS5yZWFkRmlsZShwYXRoKSk7XG4gICAgcmV0dXJuIGFjdHVhbCAhPT0gZW50cnkuaGFzaDtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgc3RvcmFnZUV4aXN0cyhwYXRoOiBzdHJpbmcpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMub3B0aW9ucy5zdG9yYWdlLmV4aXN0cyhwYXRoKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHB1bGxPcEZyb21DaGFuZ2UoY2hhbmdlOiBDaGFuZ2VNZXNzYWdlKTogUHVsbE9wIHtcbiAgICBpZiAoY2hhbmdlLmtpbmQgPT09ICdyZW5hbWUnICYmIGNoYW5nZS5mcm9tUGF0aCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBraW5kOiAncmVuYW1lJyxcbiAgICAgICAgZnJvbVBhdGg6IGNoYW5nZS5mcm9tUGF0aCxcbiAgICAgICAgdG9QYXRoOiBjaGFuZ2UucGF0aCxcbiAgICAgICAgaGFzaDogY2hhbmdlLmhhc2gsXG4gICAgICAgIHNpemU6IGNoYW5nZS5zaXplLFxuICAgICAgICB2ZXJzaW9uOiBjaGFuZ2UudmVyc2lvbixcbiAgICAgICAgY2xvY2s6IGNoYW5nZS5jbG9jayxcbiAgICAgIH07XG4gICAgfVxuICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5pbmRleFtjaGFuZ2UucGF0aF07XG4gICAgY29uc3Qga2luZDogUHVsbEZpbGVPcFsna2luZCddID0gY2hhbmdlLmRlbGV0ZWRcbiAgICAgID8gJ2RlbGV0ZSdcbiAgICAgIDogZW50cnkgPT09IHVuZGVmaW5lZFxuICAgICAgICA/ICdhZGQnXG4gICAgICAgIDogZW50cnkuZGVsZXRlZEF0ICE9PSB1bmRlZmluZWRcbiAgICAgICAgICA/ICdyZXN0b3JlJ1xuICAgICAgICAgIDogJ2VkaXQnO1xuICAgIHJldHVybiB7XG4gICAgICBraW5kLFxuICAgICAgcGF0aDogY2hhbmdlLnBhdGgsXG4gICAgICBoYXNoOiBjaGFuZ2UuaGFzaCxcbiAgICAgIHNpemU6IGNoYW5nZS5zaXplLFxuICAgICAgdmVyc2lvbjogY2hhbmdlLnZlcnNpb24sXG4gICAgICBjbG9jazogY2hhbmdlLmNsb2NrLFxuICAgICAgZGVsZXRlZDogY2hhbmdlLmRlbGV0ZWQsXG4gICAgICAuLi4oY2hhbmdlLmlzRm9sZGVyID09PSB0cnVlID8geyBpc0ZvbGRlcjogdHJ1ZSB9IDoge30pLFxuICAgIH07XG4gIH1cblxuICAvKiogTWF0ZXJpYWxpemUgcHVsbHMgdGhyb3VnaCB0aGUgdmVyaWZpZWQgZW5naW5lIHBhdGg7IHJldHVybnMgdGhlIG5ldyBpbmRleC4gKi9cbiAgcHJpdmF0ZSBhc3luYyBhcHBseVB1bGxzKFxuICAgIHB1bGxzOiBSZWFkb25seUFycmF5PFB1bGxPcD4sXG4gICAgcHJvZ3Jlc3M/OiB7IG9uUHJvZ3Jlc3M6IChkb25lOiBudW1iZXIsIHRvdGFsOiBudW1iZXIpID0+IHZvaWQgfSxcbiAgKTogUHJvbWlzZTxMb2NhbEluZGV4PiB7XG4gICAgLy8gUHVsbHMgd2hvc2UgdGFyZ2V0IHBhdGggaXMgV2luZG93cy11bnNhZmUgd291bGQgdGhyb3cgaW4gdGhlIGFkYXB0ZXJcbiAgICAvLyBldmVyeSBjeWNsZTsgdGhleSBhcmUgc2tpcHBlZCBhbmQgZGlhZ25vc2VkIGluc3RlYWQgKGEgbGF0ZXIgdmVyc2lvblxuICAgIC8vIGNoYW5nZSBhdCB0aGUgcGF0aCBpcyBhdHRlbXB0ZWQgYWdhaW4pLlxuICAgIGNvbnN0IG1hdGVyaWFsaXphYmxlOiBQdWxsT3BbXSA9IFtdO1xuICAgIGZvciAoY29uc3QgcHVsbCBvZiBwdWxscykge1xuICAgICAgY29uc3QgdW5zYWZlID0gZmlyc3RVbnNhZmVQYXRoKHB1bGxUYXJnZXRzKHB1bGwpKTtcbiAgICAgIGlmICh1bnNhZmUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICBtYXRlcmlhbGl6YWJsZS5wdXNoKHB1bGwpO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIHRoaXMucmVjb3JkU2tpcHBlZFBhdGgodW5zYWZlKTtcbiAgICB9XG4gICAgcmV0dXJuIGFwcGx5UHVsbChcbiAgICAgIHRoaXMub3B0aW9ucy5zdG9yYWdlLFxuICAgICAgdGhpcy5pbmRleCxcbiAgICAgIHsgcHVzaGVzOiBbXSwgcHVsbHM6IG1hdGVyaWFsaXphYmxlLCBjb25mbGljdHM6IFtdLCBmb2xkZXJQdXNoZXM6IFtdIH0sXG4gICAgICB0aGlzLmZldGNoQmxvYixcbiAgICAgIHtcbiAgICAgICAgbm93OiB0aGlzLm5vdygpLFxuICAgICAgICAvLyBLZWVwIHRoZSBlbnZlbG9wZSdzIGN1cnNvciBib29ra2VlcGluZyBpbnRhY3QgYWNyb3NzIHB1bGwtc2lkZVxuICAgICAgICAvLyBwZXJzaXN0cyAoYXBwbHlQdWxsIHJld3JpdGVzIHRoZSB3aG9sZSBzdGF0ZSBmaWxlKS5cbiAgICAgICAgcGVyc2lzdGVkU3RhdGU6IHRoaXMucGVyc2lzdGVkU3RhdGUoKSxcbiAgICAgICAgLi4uKHByb2dyZXNzICE9PSB1bmRlZmluZWQgPyB7IG9uUHJvZ3Jlc3M6IHByb2dyZXNzLm9uUHJvZ3Jlc3MgfSA6IHt9KSxcbiAgICAgIH0sXG4gICAgKTtcbiAgfVxuXG4gIC8qKiBUaGUgZW52ZWxvcGUgYm9va2tlZXBpbmcgd3JpdHRlbiB3aGVuZXZlciB0aGUgY2xpZW50IHBlcnNpc3RzIHRoZSBpbmRleC4gKi9cbiAgcHJpdmF0ZSBwZXJzaXN0ZWRTdGF0ZSgpOiBQZXJzaXN0ZWRTeW5jU3RhdGUge1xuICAgIHJldHVybiB7XG4gICAgICBjdXJzb3I6IHRoaXMuY3Vyc29yLFxuICAgICAgc3luY2VkVGhyb3VnaDogdGhpcy5zeW5jZWRUaHJvdWdoLFxuICAgICAgbmVlZHNGdWxsTWFuaWZlc3Q6IHRoaXMubmVlZHNGdWxsTWFuaWZlc3QsXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmQgYSBwYXRoIHRoZSBjeWNsZSBjb3VsZCBub3Qgc3luYyBiZWNhdXNlIGl0cyBuYW1lIGlzXG4gICAqIFdpbmRvd3MtdW5zYWZlIChgcGF0aHMudHNgKTogc3VyZmFjZWQgb24gYHN0YXR1cygpLnNraXBwZWRQYXRoc2AgYW5kXG4gICAqIGxvZ2dlZCBvbmNlIHBlciByZWNvcmQgdW50aWwgYSBodW1hbiByZW5hbWVzIGl0LiBEZWR1cGVkOyByZXBsYWNlZCBhdFxuICAgKiB0aGUgc3RhcnQgb2YgZXZlcnkgY3ljbGUuXG4gICAqL1xuICBwcml2YXRlIHJlY29yZFNraXBwZWRQYXRoKHBhdGg6IHN0cmluZyk6IHZvaWQge1xuICAgIGlmICh0aGlzLnNraXBwZWRQYXRocy5pbmNsdWRlcyhwYXRoKSkgcmV0dXJuO1xuICAgIHRoaXMuc2tpcHBlZFBhdGhzLnB1c2gocGF0aCk7XG4gICAgdGhpcy5sb2cud2FybihcbiAgICAgICdza2lwcGluZyBhIFdpbmRvd3MtdW5zYWZlIHBhdGggKHJlc2VydmVkIGRldmljZSBuYW1lIG9yIHRyYWlsaW5nIGRvdC9zcGFjZSk7IHJlbmFtZSBpdCB0byBzeW5jJyxcbiAgICAgIHBhdGgsXG4gICAgKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmQgb25lIGJ1bGstcGhhc2Ugc3RlcCBvbiBgc3RhdHVzKCkucHJvZ3Jlc3NgLiBDb2FsZXNjZWQgdG8gYXQgbW9zdFxuICAgKiBvbmUgdXBkYXRlIHBlciBgcHJvZ3Jlc3NUaHJvdHRsZU1zYCAocmVuZGVyZXIgY2h1cm4pLCBFWENFUFQgcGhhc2VcbiAgICogY2hhbmdlcyBhbmQgY29tcGxldGlvbnMsIHdoaWNoIGFsd2F5cyBlbWl0IHNvIGEgcGhhc2UgaXMgbmV2ZXIgbWlzc2VkXG4gICAqIGFuZCBgZG9uZS90b3RhbGAgYWx3YXlzIGxhbmRzIG9uIGl0cyBmaW5hbCB2YWx1ZS5cbiAgICovXG4gIHByaXZhdGUgZW1pdFByb2dyZXNzKHBoYXNlOiBTeW5jUGhhc2UsIGRvbmU6IG51bWJlciwgdG90YWw6IG51bWJlcik6IHZvaWQge1xuICAgIGlmICh0b3RhbCA9PT0gMCkgcmV0dXJuOyAvLyBub3RoaW5nIHRvIHNob3cgZm9yIGFuIGVtcHR5IHBoYXNlXG4gICAgY29uc3Qgbm93ID0gdGhpcy5ub3coKTtcbiAgICBjb25zdCBjb21wbGV0ZSA9IGRvbmUgPj0gdG90YWw7XG4gICAgY29uc3QgcGhhc2VDaGFuZ2VkID0gdGhpcy5wcm9ncmVzcz8ucGhhc2UgIT09IHBoYXNlO1xuICAgIGlmICghY29tcGxldGUgJiYgIXBoYXNlQ2hhbmdlZCAmJiBub3cgLSB0aGlzLmxhc3RQcm9ncmVzc0F0IDwgdGhpcy5wcm9ncmVzc1Rocm90dGxlTXMpIHJldHVybjtcbiAgICB0aGlzLmxhc3RQcm9ncmVzc0F0ID0gbm93O1xuICAgIHRoaXMucHJvZ3Jlc3MgPSB7IHBoYXNlLCBkb25lLCB0b3RhbCB9O1xuICB9XG5cbiAgLy8gLS0tIHdhdGNoZXIgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgcHJpdmF0ZSBvbldhdGNoRXZlbnRzKGV2ZW50czogUmVhZG9ubHlBcnJheTx7IHBhdGg6IHN0cmluZyB9Pik6IHZvaWQge1xuICAgIGNvbnN0IHJlbGV2YW50ID0gZXZlbnRzLmZpbHRlcigoZXZlbnQpID0+ICFpc0lnbm9yZWQoZXZlbnQucGF0aCwgdGhpcy5pZ25vcmVTZXR0aW5ncykpO1xuICAgIGlmIChyZWxldmFudC5sZW5ndGggPT09IDApIHJldHVybjtcbiAgICB0aGlzLnBlbmRpbmcgKz0gcmVsZXZhbnQubGVuZ3RoO1xuICAgIHRoaXMuc2NoZWR1bGVSZWNvbmNpbGUoKTtcbiAgfVxuXG4gIC8qKiBEZWJvdW5jZWQgc2Nhblx1MjE5MnBsYW5cdTIxOTJleGVjdXRlIChzaGFyZWQgYnkgd2F0Y2hlciBhbmQgZGVmZXJyZWQgY2hhbmdlcykuICovXG4gIHByaXZhdGUgc2NoZWR1bGVSZWNvbmNpbGUoKTogdm9pZCB7XG4gICAgdGhpcy5jYW5jZWxEZWJvdW5jZT8uKCk7XG4gICAgdGhpcy5jYW5jZWxEZWJvdW5jZSA9IHRoaXMuc2NoZWR1bGUoKCkgPT4ge1xuICAgICAgdGhpcy5jYW5jZWxEZWJvdW5jZSA9IG51bGw7XG4gICAgICB0aGlzLmVucXVldWUoKCkgPT4gdGhpcy5ydW5DeWNsZSgpKS5jYXRjaCgoZXJyb3I6IHVua25vd24pID0+XG4gICAgICAgIHRoaXMubG9nLndhcm4oJ2RlYm91bmNlZCBzeW5jIGN5Y2xlIGZhaWxlZCcsIGVycm9yKSxcbiAgICAgICk7XG4gICAgfSwgdGhpcy5kZWJvdW5jZU1zKTtcbiAgfVxuXG4gIC8vIC0tLSB0aGUgc3luYyBjeWNsZSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuQ3ljbGUoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKHRoaXMudHJhbnNwb3J0ID09PSBudWxsIHx8IHRoaXMuaXNEaXNjb25uZWN0ZWQoKSkgcmV0dXJuO1xuICAgIHRoaXMuc3RhdGUgPSAnc3luY2luZyc7XG4gICAgdGhpcy5wcm9ncmVzcyA9IG51bGw7XG4gICAgdGhpcy5za2lwcGVkUGF0aHMgPSBbXTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgbWFuaWZlc3QgPSBhd2FpdCB0aGlzLmZldGNoTWFuaWZlc3QoKTtcbiAgICAgIGNvbnN0IGxvY2FsQ2hhbmdlcyA9IGF3YWl0IHNjYW5WYXVsdChcbiAgICAgICAgdGhpcy5vcHRpb25zLnN0b3JhZ2UsXG4gICAgICAgIHRoaXMuaW5kZXgsXG4gICAgICAgIHRoaXMuaWdub3JlU2V0dGluZ3MsXG4gICAgICAgIHRoaXMubm93KCksXG4gICAgICAgIHtcbiAgICAgICAgICBvblByb2dyZXNzOiAoZG9uZSwgdG90YWwpID0+IHRoaXMuZW1pdFByb2dyZXNzKCdzY2FubmluZycsIGRvbmUsIHRvdGFsKSxcbiAgICAgICAgICAvLyBTaGFycGVucyB0aGUgc3RhbGVEaXJzIHJ1bGU6IGFuIGVtcHR5IGRpciBvdmVyIGEgdG9tYnN0b25lIFRISVNcbiAgICAgICAgICAvLyBkZXZpY2UgYXV0aG9yZWQgaXMgYSBsb2NhbCByZWNyZWF0aW9uLCBub3QgYSBkZWxldGlvbiByZXNpZHVlLlxuICAgICAgICAgIHRoaXNEZXZpY2VJZDogdGhpcy5vcHRpb25zLmRldmljZUlkLFxuICAgICAgICB9LFxuICAgICAgKTtcbiAgICAgIGNvbnN0IHBsYW4gPSBjb21wdXRlU3luY1BsYW4oe1xuICAgICAgICBsb2NhbENoYW5nZXMsXG4gICAgICAgIGluZGV4OiB0aGlzLmluZGV4LFxuICAgICAgICBtYW5pZmVzdCxcbiAgICAgICAgdGhpc0RldmljZUlkOiB0aGlzLm9wdGlvbnMuZGV2aWNlSWQsXG4gICAgICAgIHRoaXNEZXZpY2VOYW1lOiB0aGlzLm9wdGlvbnMuZGV2aWNlTmFtZSxcbiAgICAgICAgbm93OiB0aGlzLm5vdygpLFxuICAgICAgfSk7XG4gICAgICAvLyBDb25mbGljdHMgcmVmbGVjdCB0aGUgbGF0ZXN0IHBsYW46IGVudHJpZXMgZm9yIHBhdGhzIG5vIGxvbmdlclxuICAgICAgLy8gY29udGVzdGVkIGFyZSBkcm9wcGVkIChhIGN5Y2xlIHRoYXQgcGxhbnMgY2xlYW4gY2xlYXJzIHRoZSBsaXN0KSwgc29cbiAgICAgIC8vIGEgc3luY2VkLXF1aWV0IGNsaWVudCByZXBvcnRzIDAgd2hpbGUgc3RpbGwtY29udGVzdGVkIHBhdGhzIHN0YXlcbiAgICAgIC8vIHZpc2libGUgdW50aWwgYSBjeWNsZSBhY3R1YWxseSByZXNvbHZlcyB0aGVtLlxuICAgICAgdGhpcy5jb25mbGljdHMgPSBbLi4ucGxhbi5jb25mbGljdHNdO1xuICAgICAgLy8gQ2FzZS1jb2xsaXNpb24gZGlhZ25vc3RpY3MgZnJvbSB0aGUgc2NhbiAobmV2ZXIgZGVsZXRpb25zIFx1MjAxNCBzZWVcbiAgICAgIC8vIGBTeW5jQ2xpZW50U3RhdHVzLmNhc2VDb2xsaXNpb25zYCk6IHJlcGxhY2VkIGV2ZXJ5IGN5Y2xlIHNvIGFcbiAgICAgIC8vIHJlc29sdmVkIGNvbGxpc2lvbiBkaXNhcHBlYXJzLCBhbiB1bnJlc29sdmVkIG9uZSBzdGF5cyB2aXNpYmxlLlxuICAgICAgdGhpcy5jYXNlQ29sbGlzaW9ucyA9IFsuLi4obG9jYWxDaGFuZ2VzLmNhc2VDb2xsaXNpb25zID8/IFtdKV07XG4gICAgICBpZiAodGhpcy5jYXNlQ29sbGlzaW9ucy5sZW5ndGggPiAwKSB7XG4gICAgICAgIHRoaXMubG9nLndhcm4oXG4gICAgICAgICAgJ2Nhc2UtY29sbGlkaW5nIGZpbGUgcGFpcjogdGhlc2UgZmlsZXMgZGlmZmVyIG9ubHkgYnkgbmFtZSBjYXNlIGFuZCBvbmUgaXMgaW52aXNpYmxlIG9uIHRoaXMgZmlsZXN5c3RlbTsgcmVuYW1lIG9uZSBvZiB0aGVtJyxcbiAgICAgICAgICB0aGlzLmNhc2VDb2xsaXNpb25zLFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgLy8gV2luZG93cy11bnNhZmUgbG9jYWwgbmFtZXMgKG5ldmVyIHB1c2hlZCBcdTIwMTQgc2VlIGBwYXRocy50c2ApIHN1cmZhY2VcbiAgICAgIC8vIHRocm91Z2ggdGhlIHNhbWUgZGlhZ25vc3RpY3MgY2hhbm5lbC5cbiAgICAgIGZvciAoY29uc3QgcGF0aCBvZiBsb2NhbENoYW5nZXMudW5zYWZlUGF0aHMgPz8gW10pIHtcbiAgICAgICAgdGhpcy5yZWNvcmRTa2lwcGVkUGF0aChwYXRoKTtcbiAgICAgIH1cblxuICAgICAgLy8gU3RhZ2UgcHVzaCBjb250ZW50cyBCRUZPUkUgcHVsbHMgb3ZlcndyaXRlIHRoZSB3b3JraW5nIHRyZWUgKGFcbiAgICAgIC8vIGNvbmZsaWN0LWNvcHkgcHVzaCByZWFkcyB0aGUgbG9zZXIgY29udGVudCBmcm9tIHRoZSBvcmlnaW5hbCBwYXRoKS5cbiAgICAgIGNvbnN0IHN0YWdlZCA9IGF3YWl0IHRoaXMuc3RhZ2VQdXNoZXMocGxhbiwgbG9jYWxDaGFuZ2VzLmhhc2hlZCk7XG5cbiAgICAgIHRoaXMuaW5kZXggPSBhd2FpdCB0aGlzLmFwcGx5UHVsbHMocGxhbi5wdWxscywge1xuICAgICAgICBvblByb2dyZXNzOiAoZG9uZSwgdG90YWwpID0+IHRoaXMuZW1pdFByb2dyZXNzKCdwdWxsaW5nJywgZG9uZSwgdG90YWwpLFxuICAgICAgfSk7XG5cbiAgICAgIC8vIFB1c2ggcGlwZWxpbmU6IHVwIHRvIGBwdXNoQ29uY3VycmVuY3lgIGNvbW1pdHMgaW4gZmxpZ2h0OyBhY2tzIGZvbGRcbiAgICAgIC8vIGludG8gdGhlIGluZGV4IGFzIHRoZXkgYXJyaXZlIChzZXJpYWxpemVkIHRocm91Z2ggYGFja0NoYWluYCkuXG4gICAgICAvLyBCbG9iIHVwbG9hZHMgZm9yID4yNTZLQiBmaWxlcyBzdGFydCBpbnNpZGUgdGhlaXIgc2xvdCBhbmQgb3ZlcmxhcFxuICAgICAgLy8gd2l0aCB0aGUgT1RIRVIgc2xvdHMnIGluLWZsaWdodCBjb21taXRzIGluc3RlYWQgb2Ygc2VyaWFsaXppbmcuXG4gICAgICBjb25zdCBwdXNoVG90YWwgPSBzdGFnZWQubGVuZ3RoICsgcGxhbi5mb2xkZXJQdXNoZXMubGVuZ3RoO1xuICAgICAgbGV0IHB1c2hEb25lID0gMDtcbiAgICAgIGNvbnN0IHNldHRsZVB1c2ggPSAoKTogdm9pZCA9PiB7XG4gICAgICAgIHB1c2hEb25lICs9IDE7XG4gICAgICAgIHRoaXMuZW1pdFByb2dyZXNzKCdwdXNoaW5nJywgcHVzaERvbmUsIHB1c2hUb3RhbCk7XG4gICAgICB9O1xuICAgICAgdGhpcy5lbWl0UHJvZ3Jlc3MoJ3B1c2hpbmcnLCAwLCBwdXNoVG90YWwpO1xuICAgICAgYXdhaXQgdGhpcy5ydW5QdXNoUGlwZWxpbmUoc3RhZ2VkLCBzZXR0bGVQdXNoKTtcblxuICAgICAgLy8gUHJ1bmUtb24tZGVsZXRlIChDKSwgbG9jYWwgc2lkZTogZXZlcnkgZGVsZXRpb24gdGhhdCBhY3R1YWxseVxuICAgICAgLy8gY29tbWl0dGVkIHRoaXMgY3ljbGUgKHRoZSBpbmRleCBub3cgdG9tYnN0b25lcyBpdCAvIG1pZ3JhdGVkIGl0IGF3YXkpXG4gICAgICAvLyBtYXkgaGF2ZSBlbXB0aWVkIGl0cyBwYXJlbnQgZGlyZWN0b3J5LiBSZW1vdmUgc3VjaCBkaXJlY3RvcmllcyBcdTIwMTRcbiAgICAgIC8vIEJFRk9SRSB0aGUgcGxhY2Vob2xkZXIgcHVzaGVzIGJlbG93LCBzbyBhbiBlbXB0aWVkIGRpcmVjdG9yeSBpcyBub3RcbiAgICAgIC8vIGltbWVkaWF0ZWx5IHJlLXB1c2hlZCBhcyBhbiBlbXB0eS1mb2xkZXIgcGxhY2Vob2xkZXIuXG4gICAgICBjb25zdCBlbXB0aWVkRGlycyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICAgICAgZm9yIChjb25zdCBjb21taXQgb2Ygc3RhZ2VkKSB7XG4gICAgICAgIC8vIFRoZSBwYXRoIHRoYXQgY2Vhc2VkIHRvIGV4aXN0LCBJRiBpdHMgY29tbWl0IGFjdHVhbGx5IGxhbmRlZFxuICAgICAgICAvLyAodG9tYnN0b25lZCBpbiB0aGUgaW5kZXggZm9yIGRlbGV0ZXM7IG1pZ3JhdGVkIGF3YXkgZm9yIHJlbmFtZXMgXHUyMDE0XG4gICAgICAgIC8vIGEgZGVsZXRlIHRoYXQgbG9zdCBpdHMgcmFjZSB0byBhIHJlbW90ZSBlZGl0IGlzIG5vdCBhIGRlbGV0aW9uKS5cbiAgICAgICAgbGV0IGNlYXNlZFBhdGg6IHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgICAgICAgaWYgKGNvbW1pdC5raW5kID09PSAnZGVsZXRlJyAmJiBjb21taXQuaXNGb2xkZXIgIT09IHRydWUpIHtcbiAgICAgICAgICBpZiAodGhpcy5pbmRleFtjb21taXQucGF0aF0/LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkKSBjZWFzZWRQYXRoID0gY29tbWl0LnBhdGg7XG4gICAgICAgIH0gZWxzZSBpZiAoY29tbWl0LmtpbmQgPT09ICdyZW5hbWUnICYmIGNvbW1pdC5mcm9tUGF0aCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgaWYgKCEoY29tbWl0LmZyb21QYXRoIGluIHRoaXMuaW5kZXgpKSBjZWFzZWRQYXRoID0gY29tbWl0LmZyb21QYXRoO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjZWFzZWRQYXRoID09PSB1bmRlZmluZWQpIGNvbnRpbnVlO1xuICAgICAgICBjb25zdCBwcnVuZWQgPSBhd2FpdCBwcnVuZVBhcmVudE9uRGVsZXRlKHRoaXMub3B0aW9ucy5zdG9yYWdlLCB0aGlzLmluZGV4LCBjZWFzZWRQYXRoKTtcbiAgICAgICAgaWYgKHBydW5lZCA9PT0gdW5kZWZpbmVkKSBjb250aW51ZTtcbiAgICAgICAgZW1wdGllZERpcnMuYWRkKHBydW5lZC5kaXIpO1xuICAgICAgICBjb25zdCBwbGFjZWhvbGRlciA9IHRoaXMuaW5kZXhbcHJ1bmVkLmRpcl07XG4gICAgICAgIGlmIChwbGFjZWhvbGRlcj8uaXNGb2xkZXIgJiYgcGxhY2Vob2xkZXIuZGVsZXRlZEF0ID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAvLyBXZSBqdXN0IHJlbW92ZWQgdGhlIGRpcmVjdG9yeSBhIGxpdmUgcGxhY2Vob2xkZXIgc3RpbGwgY2xhaW1zOlxuICAgICAgICAgIC8vIHNjYW4gYWdhaW4gc28gdGhlIHBsYWNlaG9sZGVyIGlzIHRvbWJzdG9uZWQgYW5kIHByb3BhZ2F0ZXMuXG4gICAgICAgICAgdGhpcy5zY2hlZHVsZVJlY29uY2lsZSgpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIC8vIFN0YWxlLWxlZnRvdmVyIGNsZWFudXAgKEYtMSk6IGEgdG9tYnN0b25lZCBmb2xkZXIgcGxhY2Vob2xkZXIgd2hvc2VcbiAgICAgIC8vIEVNUFRZIGRpcmVjdG9yeSBzdGlsbCBleGlzdHMgb24gZGlzayBcdTIwMTQgdGhlIHJlc2lkdWUgb2YgYSByZWNvcmQtb25seVxuICAgICAgLy8gdG9tYnN0b25lIGFwcGxpY2F0aW9uIChhbiBhZGFwdGVyIHdpdGhvdXQgYHJlbW92ZURpcmAsIG9yIGEgcmVtb3ZhbFxuICAgICAgLy8gdGhhdCBsb3N0IGEgcmFjZSkuIFRoZSBzY2FuIGRlbGliZXJhdGVseSBjbGFzc2lmaWVzIHRoZXNlIGFzXG4gICAgICAvLyBgc3RhbGVEaXJzYCBpbnN0ZWFkIG9mIGBlbXB0eUZvbGRlcnNgLCBzbyBub3RoaW5nIGJlbG93IHJlLXB1c2hlc1xuICAgICAgLy8gdGhlbSBhcyBwbGFjZWhvbGRlcnMgKHRoYXQgcmUtcHVzaCByZXN1cnJlY3RlZCBkZWxldGVkIGZvbGRlcnMgYW5kXG4gICAgICAvLyBwaW5nLXBvbmdlZCB0aGUgZGVsZXRpb24gYmV0d2VlbiBkZXZpY2VzKS4gUmV0cnlpbmcgdGhlIHJlbW92YWwgaGVyZVxuICAgICAgLy8gY29udmVyZ2VzIHN0b3JhZ2Ugb250byB0aGUgdG9tYnN0b25lLlxuICAgICAgZm9yIChjb25zdCBkaXIgb2YgbG9jYWxDaGFuZ2VzLnN0YWxlRGlycyA/PyBbXSkge1xuICAgICAgICBhd2FpdCByZW1vdmVEaXJJZlZhY2FudCh0aGlzLm9wdGlvbnMuc3RvcmFnZSwgdGhpcy5pbmRleCwgZGlyKTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgZm9sZGVyQ29tbWl0czogU3RhZ2VkQ29tbWl0W10gPSBbXTtcbiAgICAgIGZvciAoY29uc3QgcGF0aCBvZiBwbGFuLmZvbGRlclB1c2hlcykge1xuICAgICAgICAvLyBOZXZlciByZXN1cnJlY3QgYSBkaXJlY3RvcnkgdGhpcyBjeWNsZSBlbXB0aWVkIChkZWxldGUtZGVyaXZlZFxuICAgICAgICAvLyBwbGFjZWhvbGRlcnMgYXJlIHN1cHByZXNzZWQgZXZlbiB3aGVuIHJlbW92YWwgaXRzZWxmIHdhcyBub3RcbiAgICAgICAgLy8gcG9zc2libGUpLCBub3IgcHVzaCBvbmUgdGhhdCB2YW5pc2hlZCBzaW5jZSB0aGUgc2Nhbi5cbiAgICAgICAgaWYgKGVtcHRpZWREaXJzLmhhcyhwYXRoKSkgY29udGludWU7XG4gICAgICAgIGlmICghKGF3YWl0IHRoaXMuc3RvcmFnZUV4aXN0cyhwYXRoKSkpIGNvbnRpbnVlO1xuICAgICAgICBmb2xkZXJDb21taXRzLnB1c2goe1xuICAgICAgICAgIGtpbmQ6ICdlZGl0JyxcbiAgICAgICAgICBwYXRoLFxuICAgICAgICAgIHBhcmVudFZlcnNpb246IHRoaXMuaW5kZXhbcGF0aF0/LnZlcnNpb25JZCA/PyBudWxsLFxuICAgICAgICAgIGhhc2g6ICcnLFxuICAgICAgICAgIHNpemU6IDAsXG4gICAgICAgICAgaXNGb2xkZXI6IHRydWUsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgYXdhaXQgdGhpcy5ydW5QdXNoUGlwZWxpbmUoZm9sZGVyQ29tbWl0cywgc2V0dGxlUHVzaCk7XG5cbiAgICAgIC8vIENhY2hlIHRoZSBzY2FuJ3MgaGFzaCBvYnNlcnZhdGlvbnMgKG10aW1lKSBvbnRvIGVudHJpZXMgd2hvc2UgaGFzaFxuICAgICAgLy8gc3RpbGwgbWF0Y2hlcywgc28gdGhlIG5leHQgZmFzdCBzY2FuIGNhbiBza2lwIHRob3NlIGZpbGVzLiBSdW5zXG4gICAgICAvLyBhZnRlciBwdWxscy9wdXNoZXMgc28gZnJlc2hseS1hY2tlZCBlbnRyaWVzIGJlbmVmaXQgaW1tZWRpYXRlbHk7XG4gICAgICAvLyBgcmVjb3JkSGFzaGVkRmlsZXNgIHNraXBzIGFueXRoaW5nIHRoZSBjeWNsZSBjaGFuZ2VkIHVuZGVybmVhdGggdXMuXG4gICAgICB0aGlzLmluZGV4ID0gcmVjb3JkSGFzaGVkRmlsZXModGhpcy5pbmRleCwgbG9jYWxDaGFuZ2VzLmhhc2hlZCk7XG5cbiAgICAgIC8vIFRoZSBjeWNsZSBmaW5pc2hlZCBjbGVhbjogZXZlcnkgcHVsbCBvZiB0aGUgbWFuaWZlc3QgYXBwbGllZCwgZXZlcnlcbiAgICAgIC8vIHN0YWdlZCBjb21taXQgYWNrZWQuIFRoZSBpbmRleCBpcyBub3cgY29tcGxldGUgdGhyb3VnaCB0aGUgTUFOSUZFU1Qnc1xuICAgICAgLy8gZmV0Y2gtdGltZSBjdXJzb3IgKGRlbGliZXJhdGVseSBub3QgdGhlIGxhdGVyIGFjayBzZXFzIFx1MjAxNCBhIGNvbmN1cnJlbnRcbiAgICAgIC8vIGRldmljZSdzIGNoYW5nZSBjYW4gaW50ZXJsZWF2ZSBhbmQgcmlkZSB0aGUgcG9zdC1jeWNsZSBkaXNwYXRjaFxuICAgICAgLy8gcXVldWUpLCB3aGljaCBpcyB3aGF0IG1ha2VzIHRoZSBuZXh0IGRlbHRhIG1hbmlmZXN0IHNhZmUuXG4gICAgICBpZiAodGhpcy5tYW5pZmVzdEN1cnNvck9mQ3ljbGUgIT09IG51bGwgJiYgdGhpcy5tYW5pZmVzdEN1cnNvck9mQ3ljbGUgPiAodGhpcy5zeW5jZWRUaHJvdWdoID8/IDApKSB7XG4gICAgICAgIHRoaXMuc3luY2VkVGhyb3VnaCA9IHRoaXMubWFuaWZlc3RDdXJzb3JPZkN5Y2xlO1xuICAgICAgfVxuICAgICAgdGhpcy5tYW5pZmVzdEN1cnNvck9mQ3ljbGUgPSBudWxsO1xuICAgICAgdGhpcy5uZWVkc0Z1bGxNYW5pZmVzdCA9IGZhbHNlO1xuXG4gICAgICB0aGlzLmxhc3RTeW5jQXQgPSB0aGlzLm5vdygpO1xuICAgICAgdGhpcy5wZW5kaW5nID0gMDtcbiAgICAgIGlmICghdGhpcy5pc0Rpc2Nvbm5lY3RlZCgpKSB0aGlzLnN0YXRlID0gJ2xpdmUnO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLm1hbmlmZXN0Q3Vyc29yT2ZDeWNsZSA9IG51bGw7XG4gICAgICB0aGlzLmxvZy5lcnJvcignc3luYyBjeWNsZSBmYWlsZWQnLCBlcnJvcik7XG4gICAgICBpZiAoIXRoaXMuaXNEaXNjb25uZWN0ZWQoKSkgdGhpcy5zdGF0ZSA9IHRoaXMudHJhbnNwb3J0ICE9PSBudWxsID8gJ2xpdmUnIDogJ2lkbGUnO1xuICAgICAgdGhyb3cgZXJyb3I7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMucHJvZ3Jlc3MgPSBudWxsO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBUaGUgbWFuaWZlc3QncyBmZXRjaC10aW1lIGN1cnNvciBmb3IgdGhlIFJVTk5JTkcgY3ljbGUgXHUyMDE0IHRoZSBjb21wbGV0aW9uXG4gICAqIHdhdGVybWFyayBhIHN1Y2Nlc3NmdWwgY3ljbGUgcmVjb3JkcyBpbnRvIGBzeW5jZWRUaHJvdWdoYCAoc2VlIHRoZVxuICAgKiBjb21tZW50IHRoZXJlKS4gTnVsbCBvdXRzaWRlIGN5Y2xlcy5cbiAgICovXG4gIHByaXZhdGUgbWFuaWZlc3RDdXJzb3JPZkN5Y2xlOiBudW1iZXIgfCBudWxsID0gbnVsbDtcblxuICAvKipcbiAgICogV2hldGhlciBUSElTIGN5Y2xlIG1heSByZXF1ZXN0IGEgZGVsdGEgbWFuaWZlc3QuIEFsbCBmb3VyIGdhdGVzIG11c3RcbiAgICogaG9sZCAoYW55IGZhaWx1cmUgXHUyMUQyIGZ1bGwgbWFuaWZlc3QsIHRvZGF5J3MgYmVoYXZpb3IpOlxuICAgKlxuICAgKiAgMS4gYGN1cnNvciA+IDBgIFx1MjAxNCBhIGZpcnN0LWV2ZXIgY29ubmVjdCBrbm93cyBub3RoaW5nOyBmdWxsIG1hbmlmZXN0LlxuICAgKiAgMi4gYHN5bmNlZFRocm91Z2ggIT09IG51bGxgIFx1MjAxNCBzb21lIGZ1bGwtbWFuaWZlc3QgY3ljbGUgY29tcGxldGVkLCBzbyB0aGVcbiAgICogICAgIGluZGV4IGlzIENPTVBMRVRFIHRocm91Z2ggaXQ7IGhlYWRzIGFmdGVyIGl0IGFycml2ZSB2aWEgcmVwbGF5ICtcbiAgICogICAgIGRlbHRhLiBBbiBpbnRlcnJ1cHRlZCBpbml0aWFsIHN5bmMgbmV2ZXIgc2V0cyBpdCBcdTIxRDIgZnVsbCBtYW5pZmVzdC5cbiAgICogIDMuIGAhbmVlZHNGdWxsTWFuaWZlc3RgIFx1MjAxNCBubyBkZWZlcnJlZCBkaXZlcmdlbmNlIGF3YWl0cyBwbGFuIHJlc29sdXRpb24uXG4gICAqICA0LiBSZXBsYXkgd2luZG93IGludGFjdCBcdTIwMTQgaGVsbG9BY2sgcmVwb3J0ZWQgYG9sZGVzdFJldGFpbmVkU2VxIDw9XG4gICAqICAgICBjdXJzb3IgKyAxYCwgc28gZXZlcnkgZXZlbnQgYWZ0ZXIgb3VyIGN1cnNvciBpcyBzdGlsbCBvbiB0aGUgc2VydmVyLlxuICAgKi9cbiAgcHJpdmF0ZSBzaG91bGRSZXF1ZXN0RGVsdGFNYW5pZmVzdCgpOiBib29sZWFuIHtcbiAgICByZXR1cm4gKFxuICAgICAgdGhpcy5jdXJzb3IgPiAwICYmXG4gICAgICB0aGlzLnN5bmNlZFRocm91Z2ggIT09IG51bGwgJiZcbiAgICAgICF0aGlzLm5lZWRzRnVsbE1hbmlmZXN0ICYmXG4gICAgICB0aGlzLnNlcnZlck9sZGVzdFJldGFpbmVkU2VxICE9PSBudWxsICYmXG4gICAgICB0aGlzLnNlcnZlck9sZGVzdFJldGFpbmVkU2VxIDw9IHRoaXMuY3Vyc29yICsgMVxuICAgICk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGZldGNoTWFuaWZlc3QoKTogUHJvbWlzZTxSZW1vdGVGaWxlW10+IHtcbiAgICBjb25zdCB0cmFuc3BvcnQgPSB0aGlzLnRyYW5zcG9ydDtcbiAgICBpZiAodHJhbnNwb3J0ID09PSBudWxsKSB0aHJvdyBuZXcgTmV0d29ya0Vycm9yKCdub3QgY29ubmVjdGVkJyk7XG4gICAgY29uc3QgdXNlRGVsdGEgPSB0aGlzLnNob3VsZFJlcXVlc3REZWx0YU1hbmlmZXN0KCk7XG4gICAgY29uc3Qgc2luY2UgPSB1c2VEZWx0YSAmJiB0aGlzLnN5bmNlZFRocm91Z2ggIT09IG51bGwgPyB0aGlzLnN5bmNlZFRocm91Z2ggOiB1bmRlZmluZWQ7XG4gICAgY29uc3QgcmVwbHkgPSBhd2FpdCB0aGlzLnJlcXVlc3Q8TWFuaWZlc3RNZXNzYWdlIHwgU2VydmVyRXJyb3JNZXNzYWdlPihcbiAgICAgIChtKSA9PiBtLnR5cGUgPT09ICdtYW5pZmVzdCcgfHwgbS50eXBlID09PSAnZXJyb3InLFxuICAgICAgKCkgPT4gdHJhbnNwb3J0LnNlbmQoeyB0eXBlOiAnZ2V0TWFuaWZlc3QnLCAuLi4oc2luY2UgIT09IHVuZGVmaW5lZCA/IHsgc2luY2UgfSA6IHt9KSB9KSxcbiAgICApO1xuICAgIGlmIChyZXBseS50eXBlID09PSAnZXJyb3InKSB0aHJvdyB0aGlzLnRvRXJyb3IocmVwbHkpO1xuICAgIHZhbGlkYXRlTWFuaWZlc3RNZXNzYWdlKHJlcGx5KTtcbiAgICBpZiAocmVwbHkuY3Vyc29yID4gdGhpcy5jdXJzb3IpIHRoaXMuY3Vyc29yID0gcmVwbHkuY3Vyc29yO1xuICAgIHRoaXMubWFuaWZlc3RDdXJzb3JPZkN5Y2xlID0gcmVwbHkuY3Vyc29yO1xuICAgIGlmICghdXNlRGVsdGEpIHtcbiAgICAgIHJldHVybiB0aGlzLnRvUmVtb3RlRmlsZXMoT2JqZWN0LnZhbHVlcyhyZXBseS5lbnRyaWVzKSk7XG4gICAgfVxuICAgIC8vIERlbHRhOiBtZXJnZSB0aGUgY2hhbmdlZCBoZWFkcyBvdmVyIGFuIElOREVYIFBST0pFQ1RJT04gb2YgdGhlIGZ1bGxcbiAgICAvLyBtYW5pZmVzdC4gY29tcHV0ZVN5bmNQbGFuIG5lZWRzIHRoZSBjb21wbGV0ZSByZW1vdGUgdmlldyBcdTIwMTQgUGhhc2UgQlxuICAgIC8vIHRyZWF0cyBhbiBpbmRleCBwYXRoIGFic2VudCBmcm9tIHRoZSBtYW5pZmVzdCBhcyBcIm1pZ3JhdGVkIGF3YXlcIiBcdTIwMTQgYW5kXG4gICAgLy8gZWxpZ2liaWxpdHkgZ3VhcmFudGVlcyB0aGUgaW5kZXggYWxyZWFkeSBhZ3JlZXMgd2l0aCB0aGUgc2VydmVyIGZvclxuICAgIC8vIGV2ZXJ5IHBhdGggdGhlIGRlbHRhIG9taXRzIChoZWFkcyBcdTIyNjQgc3luY2VkVGhyb3VnaCkuIFByb2plY3RpbmcgZW50cmllc1xuICAgIC8vIHRvIHRoZWlyIGluZGV4IHN0YXRlIHRoZXJlZm9yZSByZWNvbnN0cnVjdHMgZXhhY3RseSB3aGF0IHRoZSBmdWxsXG4gICAgLy8gbWFuaWZlc3Qgd291bGQgaGF2ZSBzYWlkLCBhdCBPKGNoYW5nZXMpIGluc3RlYWQgb2YgTyh2YXVsdCkuXG4gICAgY29uc3QgbWVyZ2VkID0gbmV3IE1hcDxzdHJpbmcsIFJlbW90ZUZpbGU+KCk7XG4gICAgZm9yIChjb25zdCBbcGF0aCwgZW50cnldIG9mIE9iamVjdC5lbnRyaWVzKHRoaXMuaW5kZXgpKSB7XG4gICAgICBtZXJnZWQuc2V0KHBhdGgsIHtcbiAgICAgICAgcGF0aCxcbiAgICAgICAgdmVyc2lvbjogZW50cnkudmVyc2lvbklkLFxuICAgICAgICBoYXNoOiBlbnRyeS5oYXNoLFxuICAgICAgICBzaXplOiBlbnRyeS5zaXplLFxuICAgICAgICBkZWxldGVkOiBlbnRyeS5kZWxldGVkQXQgIT09IHVuZGVmaW5lZCxcbiAgICAgICAgY2xvY2s6IGVudHJ5LmNsb2NrLFxuICAgICAgICAuLi4oZW50cnkuaXNGb2xkZXIgPyB7IGlzRm9sZGVyOiB0cnVlIH0gOiB7fSksXG4gICAgICAgIG10aW1lOiBlbnRyeS5tdGltZSA/PyAwLFxuICAgICAgfSk7XG4gICAgfVxuICAgIGZvciAoY29uc3QgW3BhdGgsIGVudHJ5XSBvZiBPYmplY3QuZW50cmllcyhyZXBseS5lbnRyaWVzKSkge1xuICAgICAgbWVyZ2VkLnNldChwYXRoLCB7IC4uLmVudHJ5IH0pO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcy50b1JlbW90ZUZpbGVzKFsuLi5tZXJnZWQudmFsdWVzKCldKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBQcm9qZWN0IG1hbmlmZXN0LXNpZGUgZW50cmllcyB0byBgUmVtb3RlRmlsZWBzLCBza2lwcGluZyBXaW5kb3dzLXVuc2FmZVxuICAgKiBwYXRocyAoZGlhZ25vc2VkIHZpYSBgcmVjb3JkU2tpcHBlZFBhdGhgLCBuZXZlciBoYW5kZWQgdG8gdGhlIHBsYW5uZXIgXHUyMDE0XG4gICAqIG1hdGVyaWFsaXppbmcgdGhlbSBpcyBpbXBvc3NpYmxlLCBzbyBwbGFubmluZyB0aGVtIHdvdWxkIG9ubHkgcHJvZHVjZSBhXG4gICAqIHB1bGwgdGhhdCBmYWlscyBldmVyeSBjeWNsZSkuXG4gICAqL1xuICBwcml2YXRlIHRvUmVtb3RlRmlsZXMoZW50cmllczogcmVhZG9ubHkgUmVtb3RlRmlsZVtdKTogUmVtb3RlRmlsZVtdIHtcbiAgICBjb25zdCByZW1vdGU6IFJlbW90ZUZpbGVbXSA9IFtdO1xuICAgIGZvciAoY29uc3QgZW50cnkgb2YgZW50cmllcykge1xuICAgICAgaWYgKGlzV2luZG93c1Vuc2FmZVBhdGgoZW50cnkucGF0aCkpIHtcbiAgICAgICAgdGhpcy5yZWNvcmRTa2lwcGVkUGF0aChlbnRyeS5wYXRoKTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICByZW1vdGUucHVzaCh7IC4uLmVudHJ5IH0pO1xuICAgIH1cbiAgICByZXR1cm4gcmVtb3RlO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBzdGFnZVB1c2hlcyhcbiAgICBwbGFuOiBTeW5jUGxhbixcbiAgICBoYXNoZWQ6IHJlYWRvbmx5IEhhc2hlZEZpbGVbXSxcbiAgKTogUHJvbWlzZTxTdGFnZWRDb21taXRbXT4ge1xuICAgIC8vIEEgY29uZmxpY3QtY29weSBwdXNoIGNhcnJpZXMgY29udGVudCByZWFkIGZyb20gdGhlICpvcmlnaW5hbCogcGF0aC5cbiAgICBjb25zdCBjb3B5U291cmNlcyA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KCk7XG4gICAgZm9yIChjb25zdCBjb25mbGljdCBvZiBwbGFuLmNvbmZsaWN0cykge1xuICAgICAgaWYgKGNvbmZsaWN0LmNvbmZsaWN0Q29weVBhdGggIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBjb3B5U291cmNlcy5zZXQoY29uZmxpY3QuY29uZmxpY3RDb3B5UGF0aCwgY29uZmxpY3QucGF0aCk7XG4gICAgICB9XG4gICAgfVxuICAgIC8vIEhhc2gtdGltZSBzdGF0cyBieSBwYXRoOiBwaW5uaW5nIHRoZXNlIG9udG8gdGhlIGFja2VkIGVudHJpZXMgKGJlbG93KVxuICAgIC8vIGtlZXBzIHRoZSBmYXN0LXBhdGggY2FjaGUgaG9uZXN0IFx1MjAxNCBzZWUgYFN0YWdlZENvbW1pdC5tdGltZWAuXG4gICAgY29uc3QgaGFzaFRpbWVNdGltZSA9IG5ldyBNYXAoaGFzaGVkLm1hcCgob2JzZXJ2ZWQpID0+IFtvYnNlcnZlZC5wYXRoLCBvYnNlcnZlZC5tdGltZV0pKTtcblxuICAgIGNvbnN0IHN0YWdlZDogU3RhZ2VkQ29tbWl0W10gPSBbXTtcbiAgICBmb3IgKGNvbnN0IHB1c2ggb2YgcGxhbi5wdXNoZXMpIHtcbiAgICAgIGlmIChwdXNoLmtpbmQgPT09ICdkZWxldGUnIHx8IHB1c2gua2luZCA9PT0gJ3JlbmFtZScpIHtcbiAgICAgICAgc3RhZ2VkLnB1c2godGhpcy50b1N0YWdlZChwdXNoKSk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3Qgc291cmNlUGF0aCA9XG4gICAgICAgIHB1c2gua2luZCA9PT0gJ2NvbmZsaWN0Q29weScgPyBjb3B5U291cmNlcy5nZXQocHVzaC5wYXRoKSA/PyBwdXNoLnBhdGggOiBwdXNoLnBhdGg7XG4gICAgICBjb25zdCBieXRlcyA9IGF3YWl0IHRoaXMucmVhZExvY2FsKHNvdXJjZVBhdGgpO1xuICAgICAgaWYgKGJ5dGVzID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgdGhpcy5sb2cud2FybigncHVzaCBzb3VyY2UgdmFuaXNoZWQgc2luY2Ugc2NhbjsgZGVmZXJyaW5nJywgcHVzaC5wYXRoKTtcbiAgICAgICAgdGhpcy5zY2hlZHVsZVJlY29uY2lsZSgpO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGhhc2ggPSBhd2FpdCBzaGEyNTZIZXgoYnl0ZXMpO1xuICAgICAgaWYgKGhhc2ggIT09IHB1c2guaGFzaCB8fCBieXRlcy5ieXRlTGVuZ3RoICE9PSBwdXNoLnNpemUpIHtcbiAgICAgICAgdGhpcy5sb2cud2FybignbG9jYWwgY29udGVudCBkcmlmdGVkIHNpbmNlIHNjYW47IGRlZmVycmluZyBwdXNoJywgcHVzaC5wYXRoKTtcbiAgICAgICAgdGhpcy5zY2hlZHVsZVJlY29uY2lsZSgpO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChwdXNoLmtpbmQgPT09ICdjb25mbGljdENvcHknKSB7XG4gICAgICAgIC8vIE1hdGVyaWFsaXplIHRoZSBjb3B5IGxvY2FsbHkgTk9XLCBiZWZvcmUgdGhlIHB1bGxzIG92ZXJ3cml0ZSB0aGVcbiAgICAgICAgLy8gb3JpZ2luYWw6IHRoZSBzZXJ2ZXIgYnJvYWRjYXN0cyB0aGUgY29weSB0byAqb3RoZXIqIGNsaWVudHMgb25seSxcbiAgICAgICAgLy8gc28gdGhpcyBkZXZpY2UgbXVzdCB3cml0ZSBpdHMgb3duIGNvcHkgaXRzZWxmLiBUaGUgY29weSBsYW5kcyBhdCBhXG4gICAgICAgIC8vIE5FVyBwYXRoIHdob3NlIG9uLWRpc2sgc3RhdCBkaWZmZXJzIGZyb20gdGhlIHNvdXJjZSdzIFx1MjAxNCBubyBoYXNoLXRpbWVcbiAgICAgICAgLy8gc3RhdCB0byBwaW4sIHRoZSBuZXh0IHNjYW4gcmVjb3JkcyBvbmUuXG4gICAgICAgIGF3YWl0IHRoaXMub3B0aW9ucy5zdG9yYWdlLndyaXRlRmlsZShwdXNoLnBhdGgsIGJ5dGVzKTtcbiAgICAgICAgc3RhZ2VkLnB1c2goeyAuLi50aGlzLnRvU3RhZ2VkKHB1c2gpLCBieXRlcyB9KTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBzdGFnZWQucHVzaCh7XG4gICAgICAgIC4uLnRoaXMudG9TdGFnZWQocHVzaCksXG4gICAgICAgIGJ5dGVzLFxuICAgICAgICAuLi4oaGFzaFRpbWVNdGltZS5nZXQoc291cmNlUGF0aCkgIT09IHVuZGVmaW5lZFxuICAgICAgICAgID8geyBtdGltZTogaGFzaFRpbWVNdGltZS5nZXQoc291cmNlUGF0aCkgfVxuICAgICAgICAgIDoge30pLFxuICAgICAgfSk7XG4gICAgfVxuICAgIHJldHVybiBzdGFnZWQ7XG4gIH1cblxuICBwcml2YXRlIHRvU3RhZ2VkKHB1c2g6IFB1c2hPcCk6IFN0YWdlZENvbW1pdCB7XG4gICAgaWYgKHB1c2gua2luZCA9PT0gJ3JlbmFtZScpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGtpbmQ6ICdyZW5hbWUnLFxuICAgICAgICBwYXRoOiBwdXNoLnRvUGF0aCxcbiAgICAgICAgcGFyZW50VmVyc2lvbjogcHVzaC5wYXJlbnRWZXJzaW9uLFxuICAgICAgICBoYXNoOiBwdXNoLmhhc2gsXG4gICAgICAgIHNpemU6IHB1c2guc2l6ZSxcbiAgICAgICAgZnJvbVBhdGg6IHB1c2guZnJvbVBhdGgsXG4gICAgICB9O1xuICAgIH1cbiAgICByZXR1cm4ge1xuICAgICAga2luZDogcHVzaC5raW5kID09PSAnYWRkJyA/ICdlZGl0JyA6IHB1c2gua2luZCxcbiAgICAgIHBhdGg6IHB1c2gucGF0aCxcbiAgICAgIHBhcmVudFZlcnNpb246IHB1c2gucGFyZW50VmVyc2lvbixcbiAgICAgIGhhc2g6IHB1c2guaGFzaCxcbiAgICAgIHNpemU6IHB1c2guc2l6ZSxcbiAgICAgIC4uLihwdXNoLmlzRm9sZGVyID8geyBpc0ZvbGRlcjogdHJ1ZSB9IDoge30pLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlYWRMb2NhbChwYXRoOiBzdHJpbmcpOiBQcm9taXNlPFVpbnQ4QXJyYXkgfCB1bmRlZmluZWQ+IHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMub3B0aW9ucy5zdG9yYWdlLnJlYWRGaWxlKHBhdGgpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU2VuZCBgY29tbWl0c2AgdGhyb3VnaCBhIGJvdW5kZWQtY29uY3VycmVuY3kgcGlwZWxpbmU6IHVwIHRvXG4gICAqIGBwdXNoQ29uY3VycmVuY3lgIGNvbW1pdHMgaW4gZmxpZ2h0IChzZW50LCBhd2FpdGluZyB0aGVpciBzZXJ2ZXIgcmVwbHkpXG4gICAqIGF0IG9uY2U7IGVhY2ggc2xvdCBzZW5kcyBpdHMgbmV4dCBjb21taXQgYXMgc29vbiBhcyBhbiBlYXJsaWVyIG9uZSBpc1xuICAgKiBzZXR0bGVkLlxuICAgKlxuICAgKiBXSFkgUElQRUxJTklORyBJUyBTQUZFICh2cy4gYSBiYXRjaCBtZXNzYWdlKTogY29uZmxpY3QgYXJiaXRyYXRpb24gaXNcbiAgICogU0VSVkVSLXNpZGUgYW5kIFBFUiBQQVRIIChgYXJiaXRyYXRlQ29tbWl0YCByZWFkcyBhbmQgd3JpdGVzIGV4YWN0bHkgdGhlXG4gICAqIGNvbW1pdHRlZCBwYXRoJ3MgaGVhZCksIGFuZCBhIGN5Y2xlIHN0YWdlcyBhdCBtb3N0IE9ORSBjb21taXQgcGVyIHBhdGhcbiAgICogKHRoZSBzY2FuIGJ1Y2tldHMgYnkgcGF0aDsgcmVuYW1lcyBjb25zdW1lIGJvdGggZW5kcykuIFNvIHR3byBpbi1mbGlnaHRcbiAgICogY29tbWl0cyBjYW4gbmV2ZXIgaW50ZXJhY3Qgb24gdGhlIHNlcnZlciwgYW5kIHJlcGx5IE9SREVSIGFjcm9zc1xuICAgKiBkaWZmZXJlbnQgcGF0aHMgZG9lcyBub3QgbWF0dGVyIGZvciB0aGUgcmVzdWx0aW5nIHN0YXRlIFx1MjAxNCBvbmx5IHBlci1wYXRoXG4gICAqIHBhaXJpbmcgb2YgcmVwbHlcdTIxOTJjb21taXQgbWF0dGVycywgd2hpY2ggdGhlIG9yZGVyZWQgV2ViU29ja2V0IHBsdXMgdGhlXG4gICAqIHNlcnZlcidzIHNlcmlhbGl6ZWQgYXJiaXRyYXRpb24gZ3VhcmFudGVlIChyZXBsaWVzIGFycml2ZSBpbiBzZW5kIG9yZGVyLFxuICAgKiBtYXRjaGVkIEZJRk8gYnkgYG9uVHJhbnNwb3J0TWVzc2FnZWApLiBBIGJhdGNoIHByb3RvY29sIG1lc3NhZ2Ugd291bGRcbiAgICogYWRkaXRpb25hbGx5IGNvdXBsZSBibG9iLXVwbG9hZCB0aW1pbmcgYW5kIGVycm9yIGdyYW51bGFyaXR5IGZvciBub1xuICAgKiBjb3JyZWN0bmVzcyBnYWluLCBzbyBwcm90b2NvbCB2MSBzdGF5cyB1bmNoYW5nZWQuXG4gICAqXG4gICAqIE9uIHRoZSBmaXJzdCBmYWlsdXJlLCBpbi1mbGlnaHQgY29tbWl0cyBzdGlsbCBzZXR0bGUgKHRoZWlyIGFja3MgYXJlXG4gICAqIGFwcGxpZWQgXHUyMDE0IHRoZXkgYXJlIHJlYWwgaGVhZHMpIGJ1dCBubyBORVcgY29tbWl0IHN0YXJ0czsgdGhlIGVycm9yIGlzXG4gICAqIHJldGhyb3duIGFmdGVyIGFsbCBzbG90cyBkcmFpbiBzbyB0aGUgY3ljbGUgZmFpbHMgZXhhY3RseSBsaWtlIHRoZSBvbGRcbiAgICogc2VxdWVudGlhbCBsb29wIGRpZCAodW5zZW50IHB1c2hlcyBzaW1wbHkgcmV0cnkgbmV4dCBjeWNsZSkuXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIHJ1blB1c2hQaXBlbGluZShcbiAgICBjb21taXRzOiByZWFkb25seSBTdGFnZWRDb21taXRbXSxcbiAgICBvblNldHRsZWQ6ICgpID0+IHZvaWQsXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmIChjb21taXRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuICAgIGxldCBuZXh0ID0gMDtcbiAgICBsZXQgZmFpbHVyZTogRXJyb3IgfCBudWxsID0gbnVsbDtcbiAgICBjb25zdCBzbG90cyA9IE1hdGgubWluKHRoaXMucHVzaENvbmN1cnJlbmN5LCBjb21taXRzLmxlbmd0aCk7XG4gICAgY29uc3Qgd29ya2VyID0gYXN5bmMgKCk6IFByb21pc2U8dm9pZD4gPT4ge1xuICAgICAgd2hpbGUgKG5leHQgPCBjb21taXRzLmxlbmd0aCkge1xuICAgICAgICBpZiAoZmFpbHVyZSAhPT0gbnVsbCkgcmV0dXJuO1xuICAgICAgICBjb25zdCBjb21taXQgPSBjb21taXRzW25leHQrK10hO1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IHRoaXMuc2VuZENvbW1pdChjb21taXQpO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIGZhaWx1cmUgPz89IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgb25TZXR0bGVkKCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9O1xuICAgIGF3YWl0IFByb21pc2UuYWxsKEFycmF5LmZyb20oeyBsZW5ndGg6IHNsb3RzIH0sIHdvcmtlcikpO1xuICAgIGlmIChmYWlsdXJlICE9PSBudWxsKSB0aHJvdyBmYWlsdXJlO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBzZW5kQ29tbWl0KGNvbW1pdDogU3RhZ2VkQ29tbWl0KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgdHJhbnNwb3J0ID0gdGhpcy50cmFuc3BvcnQ7XG4gICAgaWYgKHRyYW5zcG9ydCA9PT0gbnVsbCkgdGhyb3cgbmV3IE5ldHdvcmtFcnJvcignbm90IGNvbm5lY3RlZCcpO1xuXG4gICAgY29uc3QgbWVzc2FnZTogQ29tbWl0TWVzc2FnZSA9IHtcbiAgICAgIHR5cGU6ICdjb21taXQnLFxuICAgICAgcGF0aDogY29tbWl0LnBhdGgsXG4gICAgICBwYXJlbnRWZXJzaW9uOiBjb21taXQucGFyZW50VmVyc2lvbixcbiAgICAgIGhhc2g6IGNvbW1pdC5oYXNoLFxuICAgICAgc2l6ZTogY29tbWl0LnNpemUsXG4gICAgICBraW5kOiBjb21taXQua2luZCxcbiAgICAgIC4uLihjb21taXQuZnJvbVBhdGggIT09IHVuZGVmaW5lZCA/IHsgZnJvbVBhdGg6IGNvbW1pdC5mcm9tUGF0aCB9IDoge30pLFxuICAgICAgLi4uKGNvbW1pdC5pc0ZvbGRlciA9PT0gdHJ1ZSA/IHsgaXNGb2xkZXI6IHRydWUgfSA6IHt9KSxcbiAgICAgIC4uLihjb21taXQuYnl0ZXMgIT09IHVuZGVmaW5lZCAmJiBjb21taXQuYnl0ZXMuYnl0ZUxlbmd0aCA8PSBJTkxJTkVfQ09OVEVOVF9NQVhfQllURVNcbiAgICAgICAgPyB7IGlubGluZTogYnl0ZXNUb0Jhc2U2NChjb21taXQuYnl0ZXMpIH1cbiAgICAgICAgOiB7fSksXG4gICAgfTtcblxuICAgIC8vIEF0dGFjaG1lbnRzIGFib3ZlIHRoZSBpbmxpbmUgY2FwIHJpZGUgdGhlIGJsb2Igc3RvcmUgKEZSLTgpLiBJbnNpZGUgYVxuICAgIC8vIHBpcGVsaW5lIHNsb3QgdGhpcyBhd2FpdCBvdmVybGFwcyB3aXRoIHRoZSBPVEhFUiBzbG90cycgaW4tZmxpZ2h0XG4gICAgLy8gY29tbWl0cyBcdTIwMTQgdGhlIHVwbG9hZCBubyBsb25nZXIgc2VyaWFsaXplcyBhaGVhZCBvZiBldmVyeSBjb21taXQgXHUyMDE0IGFuZFxuICAgIC8vIHN0aWxsIGNvbXBsZXRlcyBiZWZvcmUgSVRTIGNvbW1pdCBpcyBzZW50ICh0aGUgc2VydmVyIHJlamVjdHMgYSBjb21taXRcbiAgICAvLyB3aG9zZSBibG9iIGhhcyBub3QgYXJyaXZlZCkuXG4gICAgaWYgKGNvbW1pdC5ieXRlcyAhPT0gdW5kZWZpbmVkICYmIGNvbW1pdC5ieXRlcy5ieXRlTGVuZ3RoID4gSU5MSU5FX0NPTlRFTlRfTUFYX0JZVEVTKSB7XG4gICAgICBhd2FpdCB0aGlzLnVwbG9hZEJsb2IoY29tbWl0Lmhhc2gsIGNvbW1pdC5ieXRlcyk7XG4gICAgfVxuXG4gICAgY29uc3QgcmVwbHkgPSBhd2FpdCB0aGlzLnJlcXVlc3Q8Q29tbWl0QWNrTWVzc2FnZSB8IENvbmZsaWN0TWVzc2FnZSB8IFNlcnZlckVycm9yTWVzc2FnZT4oXG4gICAgICAobSkgPT4gbS50eXBlID09PSAnY29tbWl0QWNrJyB8fCBtLnR5cGUgPT09ICdjb25mbGljdCcgfHwgbS50eXBlID09PSAnZXJyb3InLFxuICAgICAgKCkgPT4gdHJhbnNwb3J0LnNlbmQobWVzc2FnZSksXG4gICAgKTtcbiAgICBpZiAocmVwbHkudHlwZSA9PT0gJ2Vycm9yJykgdGhyb3cgdGhpcy50b0Vycm9yKHJlcGx5KTtcbiAgICBpZiAocmVwbHkudHlwZSA9PT0gJ2NvbW1pdEFjaycpIHtcbiAgICAgIHZhbGlkYXRlQ29tbWl0QWNrTWVzc2FnZShyZXBseSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHZhbGlkYXRlQ29uZmxpY3RNZXNzYWdlKHJlcGx5KTtcbiAgICB9XG5cbiAgICAvLyBGb2xkIHRoZSByZXBseSBpbnRvIHNoYXJlZCBzdGF0ZSBiZWhpbmQgdGhlIGFjayBjaGFpbjogY29uY3VycmVudFxuICAgIC8vIHNsb3RzIG11c3Qgbm90IHJlYWQtbW9kaWZ5LXdyaXRlIGB0aGlzLmluZGV4YCBhdCB0aGUgc2FtZSB0aW1lLlxuICAgIGF3YWl0IHRoaXMuc2VyaWFsaXplQWNrQXBwbGljYXRpb24oYXN5bmMgKCkgPT4ge1xuICAgICAgaWYgKHJlcGx5LnR5cGUgPT09ICdjb21taXRBY2snKSB7XG4gICAgICAgIGlmIChyZXBseS5zZXEgPiB0aGlzLmN1cnNvcikgdGhpcy5jdXJzb3IgPSByZXBseS5zZXE7XG4gICAgICAgIHRoaXMuYXBwbHlBY2tUb0luZGV4KGNvbW1pdCwgcmVwbHkudmVyc2lvbiwgcmVwbHkuY2xvY2spO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBhd2FpdCB0aGlzLmhhbmRsZUNvbmZsaWN0UmVwbHkoY29tbWl0LCByZXBseSk7XG4gICAgfSk7XG4gIH1cblxuICAvKiogQ2hhaW4gb25lIHJlcGx5J3MgaW5kZXggYXBwbGljYXRpb24gYWZ0ZXIgZXZlcnkgcHJldmlvdXNseS1zdGFydGVkIG9uZS4gKi9cbiAgcHJpdmF0ZSBzZXJpYWxpemVBY2tBcHBsaWNhdGlvbihhcHBseTogKCkgPT4gUHJvbWlzZTx2b2lkPik6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHJ1biA9IHRoaXMuYWNrQ2hhaW4udGhlbihhcHBseSwgYXBwbHkpO1xuICAgIHRoaXMuYWNrQ2hhaW4gPSBydW4udGhlbihcbiAgICAgICgpID0+IHt9LFxuICAgICAgKCkgPT4ge30sXG4gICAgKTtcbiAgICByZXR1cm4gcnVuO1xuICB9XG5cbiAgcHJpdmF0ZSBhcHBseUFja1RvSW5kZXgoY29tbWl0OiBTdGFnZWRDb21taXQsIHZlcnNpb25JZDogc3RyaW5nLCBjbG9jazogTG9naWNhbENsb2NrKTogdm9pZCB7XG4gICAgY29uc3QgZGVsZXRlZCA9IGNvbW1pdC5raW5kID09PSAnZGVsZXRlJztcbiAgICBpZiAoY29tbWl0LmtpbmQgPT09ICdyZW5hbWUnICYmIGNvbW1pdC5mcm9tUGF0aCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aGlzLmluZGV4ID0gYXBwbHlDb21taXQocmVtb3ZlRW50cnkodGhpcy5pbmRleCwgY29tbWl0LmZyb21QYXRoKSwge1xuICAgICAgICBwYXRoOiBjb21taXQucGF0aCxcbiAgICAgICAgdmVyc2lvbklkLFxuICAgICAgICBoYXNoOiBjb21taXQuaGFzaCxcbiAgICAgICAgc2l6ZTogY29tbWl0LnNpemUsXG4gICAgICAgIGNsb2NrLFxuICAgICAgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIC8vIGBjb21taXQubXRpbWVgIGlzIHRoZSBzdGF0IG9ic2VydmVkIGF0IEhBU0ggdGltZSBmb3IgdGhpcyBleGFjdCBjb250ZW50XG4gICAgLy8gKHRocmVhZGVkIHRocm91Z2ggYHN0YWdlUHVzaGVzYCksIG5ldmVyIGEgc3RhdCB0YWtlbiBhdCBhY2sgdGltZSBcdTIwMTQgYW5cbiAgICAvLyBlZGl0IHRoYXQgbGFuZGVkIGJldHdlZW4gaGFzaGluZyBhbmQgdGhpcyBhY2sgY2hhbmdlZCB0aGUgZGlzayBzdGF0LCBzb1xuICAgIC8vIHRoZSBuZXh0IHNjYW4gbWlzc2VzIHRoZSBmYXN0IHBhdGggYW5kIHJlLWhhc2hlcy9wdXNoZXMgdGhlIGVkaXQuXG4gICAgdGhpcy5pbmRleCA9IGFwcGx5Q29tbWl0KHRoaXMuaW5kZXgsIHtcbiAgICAgIHBhdGg6IGNvbW1pdC5wYXRoLFxuICAgICAgdmVyc2lvbklkLFxuICAgICAgaGFzaDogY29tbWl0Lmhhc2gsXG4gICAgICBzaXplOiBjb21taXQuc2l6ZSxcbiAgICAgIGNsb2NrLFxuICAgICAgZGVsZXRlZCxcbiAgICAgIGRlbGV0ZWRBdDogZGVsZXRlZCA/IHRoaXMubm93KCkgOiB1bmRlZmluZWQsXG4gICAgICAuLi4oY29tbWl0LmlzRm9sZGVyID09PSB0cnVlID8geyBpc0ZvbGRlcjogdHJ1ZSB9IDoge30pLFxuICAgICAgLi4uKGNvbW1pdC5tdGltZSAhPT0gdW5kZWZpbmVkID8geyBtdGltZTogY29tbWl0Lm10aW1lIH0gOiB7fSksXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGhhbmRsZUNvbmZsaWN0UmVwbHkoXG4gICAgY29tbWl0OiBTdGFnZWRDb21taXQsXG4gICAgcmVwbHk6IENvbmZsaWN0TWVzc2FnZSxcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKHJlcGx5LnNlcSAhPT0gdW5kZWZpbmVkICYmIHJlcGx5LnNlcSA+IHRoaXMuY3Vyc29yKSB0aGlzLmN1cnNvciA9IHJlcGx5LnNlcTtcbiAgICBjb25zdCB3ZVdvbiA9XG4gICAgICByZXBseS53aW5uZXIuZGV2aWNlSWQgPT09IHRoaXMub3B0aW9ucy5kZXZpY2VJZCAmJiByZXBseS53aW5uZXIuaGFzaCA9PT0gY29tbWl0Lmhhc2g7XG4gICAgaWYgKHdlV29uKSB7XG4gICAgICB0aGlzLmFwcGx5QWNrVG9JbmRleChjb21taXQsIHJlcGx5Lndpbm5lci5pZCwgcmVwbHkud2lubmVyLmNsb2NrKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBXZSBsb3N0IHRoZSByYWNlLiBNYXRlcmlhbGl6ZSB0aGUgd2lubmVyIGRpcmVjdGx5IFx1MjAxNCB0aGUgc2VydmVyIGhhc1xuICAgIC8vIGFscmVhZHkgcHJlc2VydmVkIG91ciBjb250ZW50IGFzIGEgY29uZmxpY3QgY29weSAoaWYgaXQgd2FzIGRpc3RpbmN0KS5cbiAgICAvLyBPbmUgY2F2ZWF0OiBpZiB0aGUgd29ya2luZyB0cmVlIG1vdmVkIG9uIEFHQUlOIHNpbmNlIHdlIHN0YWdlZCB0aGlzXG4gICAgLy8gY29tbWl0LCBkbyBub3QgY2xvYmJlciBpdCBlaXRoZXIgXHUyMDE0IGhhbmQgdGhlIHdob2xlIHRoaW5nIHRvIGEgY3ljbGUuXG4gICAgaWYgKGNvbW1pdC5raW5kICE9PSAnZGVsZXRlJyAmJiBjb21taXQua2luZCAhPT0gJ3JlbmFtZScgJiYgY29tbWl0LmlzRm9sZGVyICE9PSB0cnVlKSB7XG4gICAgICBjb25zdCBsb2NhbCA9IGF3YWl0IHRoaXMucmVhZExvY2FsKGNvbW1pdC5wYXRoKTtcbiAgICAgIGlmIChsb2NhbCAhPT0gdW5kZWZpbmVkICYmIChhd2FpdCBzaGEyNTZIZXgobG9jYWwpKSAhPT0gY29tbWl0Lmhhc2gpIHtcbiAgICAgICAgdGhpcy5zY2hlZHVsZVJlY29uY2lsZSgpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGNvbW1pdC5raW5kID09PSAncmVuYW1lJyAmJiBjb21taXQuZnJvbVBhdGggIT09IHVuZGVmaW5lZCkge1xuICAgICAgLy8gT3VyIHJlbmFtZSBsb3N0OiB0aGUgZmlsZSBzdGF5cyB3aGVyZSB0aGUgd2lubmVyIGtlZXBzIGl0OyByZWNvcmRcbiAgICAgIC8vIHRoZSB3aW5uZXIgaGVhZCBmb3IgdGhlIGRlc3RpbmF0aW9uICh0aGUgc291cmNlIHBhdGggaXMgdW50b3VjaGVkKS5cbiAgICAgIHRoaXMuaW5kZXggPSBhcHBseUNvbW1pdCh0aGlzLmluZGV4LCB7XG4gICAgICAgIHBhdGg6IHJlcGx5Lndpbm5lci5wYXRoLFxuICAgICAgICB2ZXJzaW9uSWQ6IHJlcGx5Lndpbm5lci5pZCxcbiAgICAgICAgaGFzaDogcmVwbHkud2lubmVyLmhhc2gsXG4gICAgICAgIHNpemU6IHJlcGx5Lndpbm5lci5zaXplLFxuICAgICAgICBjbG9jazogcmVwbHkud2lubmVyLmNsb2NrLFxuICAgICAgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdGhpcy5pbmRleCA9IGF3YWl0IHRoaXMuYXBwbHlQdWxscyhbdGhpcy53aW5uZXJBc1B1bGwocmVwbHkud2lubmVyKV0pO1xuICB9XG5cbiAgLyoqIFR1cm4gYW4gYXJiaXRyYXRlZCB3aW5uZXIgdmVyc2lvbiBpbnRvIGEgcHVsbCBvcCAoY29udGVudCBvcHMgb25seSkuICovXG4gIHByaXZhdGUgd2lubmVyQXNQdWxsKHdpbm5lcjoge1xuICAgIHBhdGg6IHN0cmluZztcbiAgICBpZDogc3RyaW5nO1xuICAgIGhhc2g6IHN0cmluZztcbiAgICBzaXplOiBudW1iZXI7XG4gICAgZGV2aWNlSWQ6IHN0cmluZztcbiAgICBjbG9jazogTG9naWNhbENsb2NrO1xuICAgIGtpbmQ6IENvbW1pdE1lc3NhZ2VbJ2tpbmQnXTtcbiAgfSk6IFB1bGxPcCB7XG4gICAgY29uc3QgZW50cnkgPSB0aGlzLmluZGV4W3dpbm5lci5wYXRoXTtcbiAgICBjb25zdCBkZWxldGVkID0gd2lubmVyLmtpbmQgPT09ICdkZWxldGUnO1xuICAgIGNvbnN0IGtpbmQ6IFB1bGxGaWxlT3BbJ2tpbmQnXSA9IGRlbGV0ZWRcbiAgICAgID8gJ2RlbGV0ZSdcbiAgICAgIDogZW50cnkgPT09IHVuZGVmaW5lZFxuICAgICAgICA/ICdhZGQnXG4gICAgICAgIDogZW50cnkuZGVsZXRlZEF0ICE9PSB1bmRlZmluZWRcbiAgICAgICAgICA/ICdyZXN0b3JlJ1xuICAgICAgICAgIDogJ2VkaXQnO1xuICAgIHJldHVybiB7XG4gICAgICBraW5kLFxuICAgICAgcGF0aDogd2lubmVyLnBhdGgsXG4gICAgICBoYXNoOiB3aW5uZXIuaGFzaCxcbiAgICAgIHNpemU6IHdpbm5lci5zaXplLFxuICAgICAgdmVyc2lvbjogd2lubmVyLmlkLFxuICAgICAgY2xvY2s6IHdpbm5lci5jbG9jayxcbiAgICAgIGRlbGV0ZWQsXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgdXBsb2FkQmxvYihoYXNoOiBzdHJpbmcsIGJ5dGVzOiBVaW50OEFycmF5KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgdHJhbnNwb3J0ID0gdGhpcy50cmFuc3BvcnQ7XG4gICAgaWYgKHRyYW5zcG9ydCA9PT0gbnVsbCkgdGhyb3cgbmV3IE5ldHdvcmtFcnJvcignbm90IGNvbm5lY3RlZCcpO1xuICAgIGNvbnN0IHJlcGx5ID0gYXdhaXQgdGhpcy5yZXF1ZXN0PEJsb2JBY2tNZXNzYWdlIHwgU2VydmVyRXJyb3JNZXNzYWdlPihcbiAgICAgIChtKSA9PiBtLnR5cGUgPT09ICdibG9iQWNrJyB8fCBtLnR5cGUgPT09ICdlcnJvcicsXG4gICAgICAoKSA9PiB0cmFuc3BvcnQuc2VuZCh7IHR5cGU6ICdwdXRCbG9iJywgaGFzaCwgY29udGVudDogYnl0ZXNUb0Jhc2U2NChieXRlcykgfSksXG4gICAgKTtcbiAgICBpZiAocmVwbHkudHlwZSA9PT0gJ2Vycm9yJykgdGhyb3cgdGhpcy50b0Vycm9yKHJlcGx5KTtcbiAgICBhd2FpdCB0aGlzLm9wdGlvbnMuYmxvYlN0b3JlLnB1dChoYXNoLCBieXRlcyk7XG4gIH1cblxuICBwcml2YXRlIHJlYWRvbmx5IGZldGNoQmxvYjogRmV0Y2hCbG9iID0gYXN5bmMgKGhhc2g6IHN0cmluZyk6IFByb21pc2U8VWludDhBcnJheT4gPT4ge1xuICAgIGlmIChoYXNoID09PSAnJykgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoJ3JlZnVzaW5nIHRvIGZldGNoIGNvbnRlbnQgZm9yIGFuIGVtcHR5IGhhc2gnKTtcbiAgICBjb25zdCBjYWNoZWQgPSBhd2FpdCB0aGlzLm9wdGlvbnMuYmxvYlN0b3JlLmdldChoYXNoKTtcbiAgICBpZiAoY2FjaGVkICE9PSB1bmRlZmluZWQpIHJldHVybiBjYWNoZWQ7XG4gICAgY29uc3QgYnl0ZXMgPSBhd2FpdCB0aGlzLmRvd25sb2FkQmxvYihoYXNoKTtcbiAgICBhd2FpdCB0aGlzLm9wdGlvbnMuYmxvYlN0b3JlLnB1dChoYXNoLCBieXRlcyk7XG4gICAgcmV0dXJuIGJ5dGVzO1xuICB9O1xuXG4gIHByaXZhdGUgYXN5bmMgZG93bmxvYWRCbG9iKGhhc2g6IHN0cmluZyk6IFByb21pc2U8VWludDhBcnJheT4ge1xuICAgIGNvbnN0IHRyYW5zcG9ydCA9IHRoaXMudHJhbnNwb3J0O1xuICAgIGlmICh0cmFuc3BvcnQgPT09IG51bGwpIHRocm93IG5ldyBOZXR3b3JrRXJyb3IoJ25vdCBjb25uZWN0ZWQnKTtcbiAgICBjb25zdCByZXBseSA9IGF3YWl0IHRoaXMucmVxdWVzdDxCbG9iTWVzc2FnZSB8IFNlcnZlckVycm9yTWVzc2FnZT4oXG4gICAgICAobSkgPT4gKG0udHlwZSA9PT0gJ2Jsb2InICYmIG0uaGFzaCA9PT0gaGFzaCkgfHwgbS50eXBlID09PSAnZXJyb3InLFxuICAgICAgKCkgPT4gdHJhbnNwb3J0LnNlbmQoeyB0eXBlOiAnZ2V0QmxvYicsIGhhc2ggfSksXG4gICAgKTtcbiAgICBpZiAocmVwbHkudHlwZSA9PT0gJ2Vycm9yJykgdGhyb3cgdGhpcy50b0Vycm9yKHJlcGx5KTtcbiAgICBjb25zdCBieXRlcyA9IGJhc2U2NFRvQnl0ZXMocmVwbHkuY29udGVudCk7XG4gICAgaWYgKChhd2FpdCBzaGEyNTZIZXgoYnl0ZXMpKSAhPT0gaGFzaCkge1xuICAgICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoYGJsb2IgJHtoYXNofSBmYWlsZWQgdmVyaWZpY2F0aW9uIG9uIGRvd25sb2FkYCk7XG4gICAgfVxuICAgIHJldHVybiBieXRlcztcbiAgfVxuXG4gIC8vIC0tLSBzbmFwc2hvdHMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICAvKipcbiAgICogU25hcHNob3QgZXZlcnkgZmlsZSBoZWFkIG9uIHRoZSBhdXRob3JpdHkgKGEgd2hvbGUtdmF1bHQgcmVzdG9yZSBwb2ludCkuXG4gICAqIFNuYXBzaG90cyBhcmUgbm90IGJyb2FkY2FzdCBcdTIwMTQgb3RoZXIgZGV2aWNlcyBzZWUgbm90aGluZyBsaXZlLlxuICAgKi9cbiAgYXN5bmMgY3JlYXRlU25hcHNob3QobmFtZT86IHN0cmluZyk6IFByb21pc2U8U25hcHNob3RDcmVhdGVBY2tNZXNzYWdlPiB7XG4gICAgY29uc3QgdHJhbnNwb3J0ID0gdGhpcy50cmFuc3BvcnQ7XG4gICAgaWYgKHRyYW5zcG9ydCA9PT0gbnVsbCkgdGhyb3cgbmV3IE5ldHdvcmtFcnJvcignbm90IGNvbm5lY3RlZCcpO1xuICAgIGNvbnN0IHJlcGx5ID0gYXdhaXQgdGhpcy5yZXF1ZXN0PFNuYXBzaG90Q3JlYXRlQWNrTWVzc2FnZSB8IFNlcnZlckVycm9yTWVzc2FnZT4oXG4gICAgICAobSkgPT4gbS50eXBlID09PSAnc25hcHNob3RDcmVhdGVBY2snIHx8IG0udHlwZSA9PT0gJ2Vycm9yJyxcbiAgICAgICgpID0+IHRyYW5zcG9ydC5zZW5kKHsgdHlwZTogJ3NuYXBzaG90Q3JlYXRlJywgLi4uKG5hbWUgIT09IHVuZGVmaW5lZCA/IHsgbmFtZSB9IDoge30pIH0pLFxuICAgICk7XG4gICAgaWYgKHJlcGx5LnR5cGUgPT09ICdlcnJvcicpIHRocm93IHRoaXMudG9FcnJvcihyZXBseSk7XG4gICAgcmV0dXJuIHJlcGx5O1xuICB9XG5cbiAgLyoqXG4gICAqIFJlc3RvcmUgdGhlIHdob2xlIHZhdWx0IHRvIGEgc25hcHNob3QuIFRoZSBzZXJ2ZXIgbGFuZHMgZXZlcnkgcmV2ZXJ0ZWRcbiAgICogaGVhZCBhcyBhIE5FVyB2ZXJzaW9uIChoaXN0b3J5IGlzIG5ldmVyIGRlbGV0ZWQpIGFuZCBmYW5zIHRoZSBjaGFuZ2VzIG91dFxuICAgKiB0byBPVEhFUiBzb2NrZXRzIG9ubHkgXHUyMDE0IHRoaXMgZGV2aWNlIGRvZXMgbm90IHJlY2VpdmUgaXRzIG93biBmYW4tb3V0LCBzb1xuICAgKiB0aGUgbG9jYWwgaW5kZXggbXVzdCByZS1jb252ZXJnZSBmcm9tIGEgRlVMTCBtYW5pZmVzdDogZmxhZyBkZWx0YSBtb2RlXG4gICAqIG9mZiwgdGhlbiBydW4gYSBjeWNsZSBpbmxpbmUgKG9uZS1zaG90IGNhbGxlcnMgY2xvc2UgdGhlIHRyYW5zcG9ydCBhc1xuICAgKiBzb29uIGFzIHRoaXMgcmVzb2x2ZXMsIHNvIGEgZGVib3VuY2VkIGN5Y2xlIHdvdWxkIG5ldmVyIGZpcmUpLlxuICAgKi9cbiAgYXN5bmMgcmVzdG9yZVNuYXBzaG90KGlkOiBzdHJpbmcpOiBQcm9taXNlPFNuYXBzaG90UmVzdG9yZUFja01lc3NhZ2U+IHtcbiAgICBjb25zdCB0cmFuc3BvcnQgPSB0aGlzLnRyYW5zcG9ydDtcbiAgICBpZiAodHJhbnNwb3J0ID09PSBudWxsKSB0aHJvdyBuZXcgTmV0d29ya0Vycm9yKCdub3QgY29ubmVjdGVkJyk7XG4gICAgY29uc3QgcmVwbHkgPSBhd2FpdCB0aGlzLnJlcXVlc3Q8U25hcHNob3RSZXN0b3JlQWNrTWVzc2FnZSB8IFNlcnZlckVycm9yTWVzc2FnZT4oXG4gICAgICAobSkgPT4gbS50eXBlID09PSAnc25hcHNob3RSZXN0b3JlQWNrJyB8fCBtLnR5cGUgPT09ICdlcnJvcicsXG4gICAgICAoKSA9PiB0cmFuc3BvcnQuc2VuZCh7IHR5cGU6ICdzbmFwc2hvdFJlc3RvcmUnLCBpZCB9KSxcbiAgICApO1xuICAgIGlmIChyZXBseS50eXBlID09PSAnZXJyb3InKSB0aHJvdyB0aGlzLnRvRXJyb3IocmVwbHkpO1xuICAgIHRoaXMubmVlZHNGdWxsTWFuaWZlc3QgPSB0cnVlO1xuICAgIGF3YWl0IHRoaXMuZW5xdWV1ZSgoKSA9PiB0aGlzLnJ1bkN5Y2xlKCkpO1xuICAgIHJldHVybiByZXBseTtcbiAgfVxuXG4gIC8vIC0tLSBwbHVtYmluZyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgcHJpdmF0ZSByZXF1ZXN0PFQgZXh0ZW5kcyBTZXJ2ZXJNZXNzYWdlPihcbiAgICBtYXRjaGVzOiAobWVzc2FnZTogTWVzc2FnZSkgPT4gYm9vbGVhbixcbiAgICBzZW5kOiAoKSA9PiB2b2lkLFxuICApOiBQcm9taXNlPFQ+IHtcbiAgICByZXR1cm4gbmV3IFByb21pc2U8VD4oKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgY29uc3QgZXhwZWN0YXRpb246ICh0eXBlb2YgdGhpcy5leHBlY3RhdGlvbnMpW251bWJlcl0gPSB7XG4gICAgICAgIG1hdGNoZXM6IChtZXNzYWdlKSA9PiBtYXRjaGVzKG1lc3NhZ2UpLFxuICAgICAgICByZXNvbHZlOiAobWVzc2FnZSkgPT4gcmVzb2x2ZShtZXNzYWdlIGFzIFQpLFxuICAgICAgICByZWplY3QsXG4gICAgICB9O1xuICAgICAgdGhpcy5leHBlY3RhdGlvbnMucHVzaChleHBlY3RhdGlvbik7XG4gICAgICB0cnkge1xuICAgICAgICBzZW5kKCk7XG4gICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICBjb25zdCBpbmRleCA9IHRoaXMuZXhwZWN0YXRpb25zLmluZGV4T2YoZXhwZWN0YXRpb24pO1xuICAgICAgICBpZiAoaW5kZXggPj0gMCkgdGhpcy5leHBlY3RhdGlvbnMuc3BsaWNlKGluZGV4LCAxKTtcbiAgICAgICAgcmVqZWN0KGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBOZXR3b3JrRXJyb3IoU3RyaW5nKGVycm9yKSkpO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSB0b0Vycm9yKG1lc3NhZ2U6IFNlcnZlckVycm9yTWVzc2FnZSk6IEVycm9yIHtcbiAgICBzd2l0Y2ggKG1lc3NhZ2UuY29kZSkge1xuICAgICAgY2FzZSAnVU5BVVRIT1JJWkVEJzpcbiAgICAgICAgcmV0dXJuIG5ldyBVbmF1dGhvcml6ZWRFcnJvcihtZXNzYWdlLm1lc3NhZ2UpO1xuICAgICAgY2FzZSAnUkVWT0tFRCc6XG4gICAgICAgIHJldHVybiBuZXcgUmV2b2tlZEVycm9yKG1lc3NhZ2UubWVzc2FnZSk7XG4gICAgICBkZWZhdWx0OlxuICAgICAgICByZXR1cm4gbmV3IFByb3RvY29sRXJyb3IobWVzc2FnZS5tZXNzYWdlKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGVucXVldWUob3BlcmF0aW9uOiAoKSA9PiBQcm9taXNlPHZvaWQ+KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5xdWV1ZWRPcHMgKz0gMTtcbiAgICBjb25zdCBydW4gPSB0aGlzLnRhaWwudGhlbihvcGVyYXRpb24sIG9wZXJhdGlvbik7XG4gICAgY29uc3Qgc2V0dGxlZCA9IHJ1bi50aGVuKFxuICAgICAgKCkgPT4ge1xuICAgICAgICB0aGlzLnF1ZXVlZE9wcyAtPSAxO1xuICAgICAgICB0aGlzLnBlcnNpc3RJbmRleCgpO1xuICAgICAgfSxcbiAgICAgIChlcnJvcjogdW5rbm93bikgPT4ge1xuICAgICAgICB0aGlzLnF1ZXVlZE9wcyAtPSAxO1xuICAgICAgICB0aGlzLnBlcnNpc3RJbmRleCgpO1xuICAgICAgICB0aHJvdyBlcnJvcjtcbiAgICAgIH0sXG4gICAgKTtcbiAgICAvLyBTd2FsbG93IHJlamVjdGlvbnMgb24gdGhlIHNoYXJlZCB0YWlsIChpbmRpdmlkdWFsIGNhbGxlcnMgc2VlIHRoZW0gdmlhXG4gICAgLy8gYHNldHRsZWRgKTsgb25lIGZhaWxlZCBvcCBtdXN0IG5vdCBwb2lzb24gdGhlIHF1ZXVlLlxuICAgIHRoaXMudGFpbCA9IHNldHRsZWQudGhlbihcbiAgICAgICgpID0+IHt9LFxuICAgICAgKCkgPT4ge30sXG4gICAgKTtcbiAgICByZXR1cm4gc2V0dGxlZDtcbiAgfVxuXG4gIHByaXZhdGUgcGVyc2lzdEluZGV4KCk6IHZvaWQge1xuICAgIGNvbnN0IHNuYXBzaG90ID0gc2VyaWFsaXplTG9jYWxJbmRleCh0aGlzLmluZGV4LCB0aGlzLnBlcnNpc3RlZFN0YXRlKCkpO1xuICAgIHZvaWQgdGhpcy5vcHRpb25zLnN0b3JhZ2VcbiAgICAgIC53cml0ZUZpbGUoTE9DQUxfSU5ERVhfU1RBVEVfUEFUSCwgbmV3IFRleHRFbmNvZGVyKCkuZW5jb2RlKHNuYXBzaG90KSlcbiAgICAgIC5jYXRjaCgoZXJyb3I6IHVua25vd24pID0+IHRoaXMubG9nLndhcm4oJ2ZhaWxlZCB0byBwZXJzaXN0IGxvY2FsIGluZGV4JywgZXJyb3IpKTtcbiAgfVxufVxuXG4vLyAtLS0gbW9kdWxlLXByaXZhdGUgdHlwZSBhbGlhc2VzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG50eXBlIFNlcnZlckVycm9yTWVzc2FnZSA9IEV4dHJhY3Q8U2VydmVyTWVzc2FnZSwgeyB0eXBlOiAnZXJyb3InIH0+O1xuXG4vKiogRXZlcnkgdmF1bHQgcGF0aCBhIHB1bGwgd291bGQgdG91Y2ggb24gZGlzayAoYm90aCBlbmRzIG9mIGEgcmVuYW1lKS4gKi9cbmZ1bmN0aW9uIHB1bGxUYXJnZXRzKHB1bGw6IFB1bGxPcCk6IHN0cmluZ1tdIHtcbiAgcmV0dXJuIHB1bGwua2luZCA9PT0gJ3JlbmFtZScgPyBbcHVsbC5mcm9tUGF0aCwgcHVsbC50b1BhdGhdIDogW3B1bGwucGF0aF07XG59XG5cbi8qKiBUaGUgZmlyc3QgV2luZG93cy11bnNhZmUgcGF0aCBhbW9uZyBgcGF0aHNgOyB1bmRlZmluZWQgd2hlbiBhbGwgYXJlIHNhZmUuICovXG5mdW5jdGlvbiBmaXJzdFVuc2FmZVBhdGgocGF0aHM6IHJlYWRvbmx5IHN0cmluZ1tdKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgcmV0dXJuIHBhdGhzLmZpbmQoKHBhdGgpID0+IGlzV2luZG93c1Vuc2FmZVBhdGgocGF0aCkpO1xufVxuIiwgIi8qKlxuICogU2VydmVyIGNvbXBhdGliaWxpdHkgcG9saWN5IFx1MjAxNCB0aGUgdmVyc2lvbi1za2V3IGNvbXBhbmlvbiB0byB0aGUgd2lyZVxuICogcHJvdG9jb2wgY2hlY2suXG4gKlxuICogU2VsZi1ob3N0ZXJzIGRlcGxveSB0aGUgd29ya2VyIGZyb20gYSBDbG91ZGZsYXJlIHRlbXBsYXRlIHBpbm5lZCB0byBhXG4gKiByZWxlYXNlIHdoaWxlIHRoZSBwbHVnaW4vQ0xJL2RhZW1vbiB1cGRhdGUgb24gdGhlaXIgb3duIHNjaGVkdWxlcywgc29cbiAqIHZlcnNpb24gc2tldyBhY3Jvc3MgY29tcG9uZW50cyBpcyBndWFyYW50ZWVkLiBUaGUgV1MgaGFuZHNoYWtlIGFscmVhZHlcbiAqIGVuZm9yY2VzIGFuIEVYQUNUIGBQcm90b2NvbFZlcnNpb25gIG1hdGNoIChoYXJkIGdhdGUsIHByb3RvY29sLnRzKTsgdGhpc1xuICogbW9kdWxlIGFuc3dlcnMgdGhlIHNvZnRlciBxdWVzdGlvbiBcImlzIHRoaXMgcmVwb3J0ZWQgc2VydmVyIHJlbGVhc2VcbiAqIHJlYXNvbmFibHkgbWF0Y2hlZCB0byB0aGlzIGNsaWVudD9cIiB3aXRoIGEgcHVyZSwgZGVwZW5kZW5jeS1mcmVlIHZlcmRpY3RcbiAqIGV2ZXJ5IFVJIGNhbiBzaGFyZSAodGhlIHBsdWdpbidzIHN0YXR1cyBub3RlL05vdGljZSwgYHZzYSBkb2N0b3JgKS5cbiAqXG4gKiBEZWxpYmVyYXRlbHkgdG9sZXJhbnQ6IG9ubHkgYSBzZXJ2ZXIgT0xERVIgdGhhbiB0aGUgc3VwcG9ydGVkIGZsb29yIGlzIGFuXG4gKiBlcnJvcjsgbmV3ZXIgc2VydmVycyBhbmQgdW5wYXJzZWFibGUvYWJzZW50IHZlcnNpb25zIGFyZSB3YXJuaW5ncywgbmV2ZXJcbiAqIHN5bmMta2lsbGVycy5cbiAqL1xuXG4vKipcbiAqIE9sZGVzdCBzZXJ2ZXIgcmVsZWFzZSB0aGUgY2xpZW50cyBjYW4gYmUgZXhwZWN0ZWQgdG8gd29yayBhZ2FpbnN0LiBTZXJ2ZXJzXG4gKiBiZWxvdyB0aGlzIGFyZSByZXBvcnRlZCBhcyBlcnJvcnMgKFwidXBkYXRlIHRoZSB3b3JrZXJcIikuXG4gKi9cbmV4cG9ydCBjb25zdCBNSU5fU1VQUE9SVEVEX1NFUlZFUl9WRVJTSU9OID0gJzAuMS4wJztcblxuLyoqIE91dGNvbWUgb2YgYGNoZWNrU2VydmVyQ29tcGF0aWJpbGl0eWAuICovXG5leHBvcnQgaW50ZXJmYWNlIENvbXBhdGliaWxpdHlWZXJkaWN0IHtcbiAgLyoqXG4gICAqIGBva2AgXHUyMDE0IG5vdGhpbmcgdG8gZG87IGB3YXJuYCBcdTIwMTQgd29ya3MsIGNvbnNpZGVyIHVwZGF0aW5nIGEgY29tcG9uZW50O1xuICAgKiBgZXJyb3JgIFx1MjAxNCB0aGUgc2VydmVyIGlzIGJlbG93IHRoZSBzdXBwb3J0ZWQgZmxvb3IuIE5ldmVyIGEgc3luYy1raWxsZXI6XG4gICAqIHRoZSB3aXJlIGBQcm90b2NvbFZlcnNpb25gIGNoZWNrIHJlbWFpbnMgdGhlIGhhcmQgZ2F0ZS5cbiAgICovXG4gIGxldmVsOiAnb2snIHwgJ3dhcm4nIHwgJ2Vycm9yJztcbiAgLyoqIFVzZXItZmFjaW5nIHNlbnRlbmNlIChlbXB0eS1pc2ggZm9yIHRoZSBgb2tgIGNhc2UpLiAqL1xuICBtZXNzYWdlOiBzdHJpbmc7XG59XG5cbi8qKiBUaGUgcGFydHMgb2YgYSBzZW12ZXIgc3RyaW5nIHRoZSBwb2xpY3kgY29tcGFyZXMgKHByZXJlbGVhc2UvYnVpbGQgaWdub3JlZCkuICovXG5pbnRlcmZhY2UgU2VtVmVyIHtcbiAgbWFqb3I6IG51bWJlcjtcbiAgbWlub3I6IG51bWJlcjtcbiAgcGF0Y2g6IG51bWJlcjtcbn1cblxuLyoqXG4gKiBgbWFqb3IubWlub3IucGF0Y2hgLCB0b2xlcmF0aW5nIGEgbGVhZGluZyBgdmAsIGEgYC1wcmVyZWxlYXNlYCwgYW5kIGFcbiAqIGArYnVpbGRgIHN1ZmZpeC4gQW55dGhpbmcgZWxzZSAoaW5jbHVkaW5nIGAwLjFgLXN0eWxlIHR3by1wYXJ0IHZlcnNpb25zKVxuICogcGFyc2VzIGFzIGBudWxsYCBcdTIwMTQgdGhlIHBvbGljeSB0aGVuIHdhcm5zIHdpdGggdGhlIHJhdyB2YWx1ZSBpbnN0ZWFkIG9mXG4gKiBndWVzc2luZy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlU2VtVmVyKHJhdzogc3RyaW5nKTogU2VtVmVyIHwgbnVsbCB7XG4gIGNvbnN0IG1hdGNoID0gL152PyhcXGQrKVxcLihcXGQrKVxcLihcXGQrKSg/Oi1bMC05QS1aYS16Li1dKyk/KD86XFwrWzAtOUEtWmEtei4tXSspPyQvLmV4ZWMoXG4gICAgcmF3LnRyaW0oKSxcbiAgKTtcbiAgaWYgKG1hdGNoID09PSBudWxsKSByZXR1cm4gbnVsbDtcbiAgcmV0dXJuIHsgbWFqb3I6IE51bWJlcihtYXRjaFsxXSksIG1pbm9yOiBOdW1iZXIobWF0Y2hbMl0pLCBwYXRjaDogTnVtYmVyKG1hdGNoWzNdKSB9O1xufVxuXG4vKiogVGhyZWUtd2F5IGNvbXBhcmUgb24gbWFqb3IgXHUyMTkyIG1pbm9yIFx1MjE5MiBwYXRjaCAocHJlcmVsZWFzZS9idWlsZCBpZ25vcmVkKS4gKi9cbmZ1bmN0aW9uIGNvbXBhcmVTZW1WZXIoYTogU2VtVmVyLCBiOiBTZW1WZXIpOiBudW1iZXIge1xuICBpZiAoYS5tYWpvciAhPT0gYi5tYWpvcikgcmV0dXJuIGEubWFqb3IgPCBiLm1ham9yID8gLTEgOiAxO1xuICBpZiAoYS5taW5vciAhPT0gYi5taW5vcikgcmV0dXJuIGEubWlub3IgPCBiLm1pbm9yID8gLTEgOiAxO1xuICBpZiAoYS5wYXRjaCAhPT0gYi5wYXRjaCkgcmV0dXJuIGEucGF0Y2ggPCBiLnBhdGNoID8gLTEgOiAxO1xuICByZXR1cm4gMDtcbn1cblxuLyoqXG4gKiBBc3Nlc3MgYSBzZXJ2ZXIncyByZXBvcnRlZCByZWxlYXNlIGFnYWluc3QgdGhpcyBjbGllbnQncyB2ZXJzaW9uLlxuICpcbiAqICAtIGBzZXJ2ZXJWZXJzaW9uYCBudWxsL3VuZGVmaW5lZC9lbXB0eSBcdTIxOTIgdGhlIHNlcnZlciBwcmVkYXRlcyB2ZXJzaW9uXG4gKiAgICByZXBvcnRpbmcgKFx1MjI2NCAwLjEgbmV2ZXIgc2VuZHMgdGhlIGZpZWxkKTogd2FybiB3aXRoIGFuIHVwZ3JhZGUgaGludC5cbiAqICAtIFVucGFyc2VhYmxlIHNlcnZlclZlcnNpb24gXHUyMTkyIHdhcm4sIHF1b3RpbmcgdGhlIHJhdyB2YWx1ZS5cbiAqICAtIFNlcnZlciBhIE1BSk9SIG9yIE1JTk9SIGFoZWFkIG9mIHRoZSBjbGllbnQgXHUyMTkyIHdhcm4gKHBhdGNoIGdhcHMgYXJlXG4gKiAgICBmaW5lKTsgdGhlIHByb3RvY29sIGNoZWNrIGFscmVhZHkgZ3VhcmRzIGFjdHVhbCBpbmNvbXBhdGliaWxpdHkuXG4gKiAgLSBTZXJ2ZXIgYmVsb3cgYE1JTl9TVVBQT1JURURfU0VSVkVSX1ZFUlNJT05gIFx1MjE5MiBlcnJvci5cbiAqICAtIE90aGVyd2lzZSBcdTIxOTIgb2suXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjaGVja1NlcnZlckNvbXBhdGliaWxpdHkoXG4gIGNsaWVudFZlcnNpb246IHN0cmluZyxcbiAgc2VydmVyVmVyc2lvbjogc3RyaW5nIHwgbnVsbCB8IHVuZGVmaW5lZCxcbik6IENvbXBhdGliaWxpdHlWZXJkaWN0IHtcbiAgaWYgKHNlcnZlclZlcnNpb24gPT09IG51bGwgfHwgc2VydmVyVmVyc2lvbiA9PT0gdW5kZWZpbmVkIHx8IHNlcnZlclZlcnNpb24gPT09ICcnKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGxldmVsOiAnd2FybicsXG4gICAgICBtZXNzYWdlOiAnc3luYyBzZXJ2ZXIgcHJlZGF0ZXMgdmVyc2lvbiByZXBvcnRpbmcgKFxcdTIyNjQgMC4xKSBcXHUyMDE0IGNvbnNpZGVyIHVwZGF0aW5nIGl0IChkb2NzL1VQR1JBRElORy5tZCknLFxuICAgIH07XG4gIH1cbiAgY29uc3Qgc2VydmVyID0gcGFyc2VTZW1WZXIoc2VydmVyVmVyc2lvbik7XG4gIGlmIChzZXJ2ZXIgPT09IG51bGwpIHtcbiAgICByZXR1cm4ge1xuICAgICAgbGV2ZWw6ICd3YXJuJyxcbiAgICAgIG1lc3NhZ2U6IGBzZXJ2ZXIgdmVyc2lvbiAke0pTT04uc3RyaW5naWZ5KHNlcnZlclZlcnNpb24pfSBpcyBub3Qgc2VtdmVyIFxcdTIwMTQgY29tcGF0aWJpbGl0eSB1bmtub3duYCxcbiAgICB9O1xuICB9XG4gIC8vIEEgY2xpZW50IHZlcnNpb24gd2UgY2Fubm90IHBhcnNlIChkZXYgYnVpbGRzLCBcInVua25vd25cIikgc2ltcGx5IHNraXBzIHRoZVxuICAvLyBuZXdlci1zZXJ2ZXIgY29tcGFyaXNvbiByYXRoZXIgdGhhbiBmYWlsaW5nIHRoZSB3aG9sZSBhc3Nlc3NtZW50LlxuICBjb25zdCBjbGllbnQgPSBwYXJzZVNlbVZlcihjbGllbnRWZXJzaW9uKTtcbiAgaWYgKGNsaWVudCAhPT0gbnVsbCAmJiAoc2VydmVyLm1ham9yID4gY2xpZW50Lm1ham9yIHx8IHNlcnZlci5taW5vciA+IGNsaWVudC5taW5vcikpIHtcbiAgICByZXR1cm4ge1xuICAgICAgbGV2ZWw6ICd3YXJuJyxcbiAgICAgIG1lc3NhZ2U6IGBzZXJ2ZXIgJHtzZXJ2ZXJWZXJzaW9ufSBpcyBuZXdlciB0aGFuIHRoaXMgY2xpZW50ICgke2NsaWVudFZlcnNpb259KSBcXHUyMDE0IHVwZGF0ZSB0aGUgY2xpZW50IHdoZW4gY29udmVuaWVudGAsXG4gICAgfTtcbiAgfVxuICBjb25zdCBtaW5pbXVtID0gcGFyc2VTZW1WZXIoTUlOX1NVUFBPUlRFRF9TRVJWRVJfVkVSU0lPTik7XG4gIGlmIChtaW5pbXVtICE9PSBudWxsICYmIGNvbXBhcmVTZW1WZXIoc2VydmVyLCBtaW5pbXVtKSA8IDApIHtcbiAgICByZXR1cm4ge1xuICAgICAgbGV2ZWw6ICdlcnJvcicsXG4gICAgICBtZXNzYWdlOiBgc2VydmVyICR7c2VydmVyVmVyc2lvbn0gaXMgb2xkZXIgdGhhbiB0aGUgbWluaW11bSBzdXBwb3J0ZWQgKCR7TUlOX1NVUFBPUlRFRF9TRVJWRVJfVkVSU0lPTn0pIFxcdTIwMTQgdXBkYXRlIGl0OiBkb2NzL1VQR1JBRElORy5tZGAsXG4gICAgfTtcbiAgfVxuICByZXR1cm4geyBsZXZlbDogJ29rJywgbWVzc2FnZTogYHNlcnZlciAke3NlcnZlclZlcnNpb259IHdvcmtzIHdpdGggdGhpcyBjbGllbnQgKCR7Y2xpZW50VmVyc2lvbn0pYCB9O1xufVxuIiwgIi8qKlxuICogYE9ic2lkaWFuU3RvcmFnZUFkYXB0ZXJgIFx1MjAxNCBjb3JlJ3MgYFN0b3JhZ2VBZGFwdGVyYCBvdmVyIHRoZSBPYnNpZGlhbiB2YXVsdFxuICogYERhdGFBZGFwdGVyYCAoQVJDSElURUNUVVJFIFx1MDBBNzggYWRhcHRlcnM6IHBsdWdpbiBpbXBsZW1lbnRhdGlvbiwgZGVza3RvcCBhbmRcbiAqIG1vYmlsZSBhbGlrZSkuXG4gKlxuICogUGF0aCBtYXBwaW5nOiBldmVyeSBwYXRoIGNyb3NzaW5nIHRoZSBjb3JlIHNlYW0gaXMgYSBQT1NJWC1ub3JtYWxpemVkIHZhdWx0XG4gKiBwYXRoIChgL25vdGVzL2EubWRgLCByb290IGAvYCk7IHRoZSBPYnNpZGlhbiBhZGFwdGVyIHdhbnRzIHRoZSBzYW1lIHBhdGhcbiAqICp3aXRob3V0KiB0aGUgbGVhZGluZyBzbGFzaCAoYG5vdGVzL2EubWRgKSwgd2l0aCBgL2AgKG9yIGAnJ2ApIGZvciB0aGUgcm9vdC5cbiAqXG4gKiBBbGwgd3JpdGVzIGdvIHRocm91Z2ggdGhlIGFkYXB0ZXIgKG5ldmVyIGB2YXVsdC5tb2RpZnlgIG9uIHRoZSBzaWRlKSwgc29cbiAqIE9ic2lkaWFuJ3Mgb3duIGZpbGUgd2F0Y2hpbmcgb2JzZXJ2ZXMgdGhlbSBsaWtlIGFueSBleHRlcm5hbCBlZGl0IGFuZCBvcGVuXG4gKiBlZGl0b3JzIHJlZnJlc2ggKEZSLTMpLiBXcml0ZXMgYXJlIGF0b21pYy1pc2g6IGNvbnRlbnQgbGFuZHMgaW4gYSB0ZW1wIGZpbGVcbiAqIHVuZGVyIGAvLnZhdWx0c3luY2ZvcmFnZW50cy90bXAvYCAoY29yZSBpZ25vcmVzIHRoYXQgd2hvbGUgc3VidHJlZSkgYW5kIGlzXG4gKiByZW5hbWVkIG9udG8gdGhlIHRhcmdldDsgaWYgcmVuYW1pbmcgaXMgdW5hdmFpbGFibGUgKGV4b3RpYyBtb2JpbGVcbiAqIGFkYXB0ZXJzKSwgd2UgZmFsbCBiYWNrIHRvIGEgZGlyZWN0IHdyaXRlLlxuICovXG5cbmltcG9ydCB0eXBlIHsgRGF0YUFkYXB0ZXIgfSBmcm9tICdvYnNpZGlhbic7XG5pbXBvcnQgdHlwZSB7IEZpbGVTdGF0LCBTdG9yYWdlQWRhcHRlciB9IGZyb20gJ0B2c2EvY29yZSc7XG5pbXBvcnQgeyBub3JtYWxpemVWYXVsdFBhdGggfSBmcm9tICdAdnNhL2NvcmUnO1xuXG4vKiogRGlyZWN0b3J5IChpbnNpZGUgdGhlIHZhdWx0KSBob2xkaW5nIHRlbXAgZmlsZXMgZHVyaW5nIGF0b21pYyB3cml0ZXMuICovXG5leHBvcnQgY29uc3QgVEVNUF9ESVJfVkFVTFRfUEFUSCA9ICcvLnZhdWx0c3luY2ZvcmFnZW50cy90bXAnO1xuXG4vKiogU3RhdHMgT2JzaWRpYW4ncyBgRGF0YUFkYXB0ZXIuc3RhdGAgcmV0dXJucyBmb3IgYSBmaWxlLiAqL1xuaW50ZXJmYWNlIEFkYXB0ZXJTdGF0IHtcbiAgc2l6ZTogbnVtYmVyO1xuICBtdGltZTogbnVtYmVyO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIE9ic2lkaWFuU3RvcmFnZUFkYXB0ZXJPcHRpb25zIHtcbiAgYWRhcHRlcjogRGF0YUFkYXB0ZXI7XG4gIC8qKlxuICAgKiBEZXNrdG9wIGFuZCBtb2JpbGUgT2JzaWRpYW4ncyBgRGF0YUFkYXB0ZXIucm1kaXJgIGlzIGZzLnJtLWJhc2VkIGFuZFxuICAgKiByZWZ1c2VzIEVWRVJZIGRpcmVjdG9yeSAoYEVSUl9GU19FSVNESVJgKSBcdTIwMTQgaXQgY2Fubm90IHJlbW92ZSBldmVuIGFuXG4gICAqIGVtcHR5IGZvbGRlciwgd2hpY2ggc2lsZW50bHkgZGVncmFkZWQgZXZlcnkgZm9sZGVyLXRvbWJzdG9uZSBhcHBsaWNhdGlvblxuICAgKiB0byByZWNvcmQtb25seSAodGhlIEYtMSBwaW5nLXBvbmcpLiBXaGVuIHByb3ZpZGVkLCBgcmVtb3ZlRGlyYCBwZXJmb3Jtc1xuICAgKiB0aGUgZW1wdHktZm9sZGVyIHJlbW92YWwgdGhyb3VnaCB0aGlzIGNhbGxiYWNrIGluc3RlYWQgXHUyMDE0IHRoZSBwbHVnaW4gd2lyZXNcbiAgICogaXQgdG8gYGZpbGVNYW5hZ2VyLnRyYXNoRmlsZWAgb24gdGhlIHZhdWx0J3MgVEZvbGRlciwgd2hpY2ggd29ya3MgYW5kXG4gICAqIG5ldmVyIGRlc3Ryb3lzIGRhdGEgKHN5c3RlbSB0cmFzaDsgY29yZSBwcmUtY2hlY2tzIGVtcHRpbmVzcyBhbnl3YXkpLlxuICAgKiBSZWNlaXZlcyB0aGUgQURBUFRFUiBwYXRoIChubyBsZWFkaW5nIHNsYXNoKS5cbiAgICovXG4gIHJlbW92ZUVtcHR5RGlyPzogKGFkYXB0ZXJQYXRoOiBzdHJpbmcpID0+IFByb21pc2U8dm9pZD47XG59XG5cbmV4cG9ydCBjbGFzcyBPYnNpZGlhblN0b3JhZ2VBZGFwdGVyIGltcGxlbWVudHMgU3RvcmFnZUFkYXB0ZXIge1xuICBwcml2YXRlIHJlYWRvbmx5IGFkYXB0ZXI6IERhdGFBZGFwdGVyO1xuICBwcml2YXRlIHJlYWRvbmx5IHJlbW92ZUVtcHR5RGlyPzogKGFkYXB0ZXJQYXRoOiBzdHJpbmcpID0+IFByb21pc2U8dm9pZD47XG4gIC8qKlxuICAgKiBMYXRjaGVkIHdoZW4gYSB0ZW1wK3JlbmFtZSBhdHRlbXB0IGZhaWxzOiBldmVyeSBsYXRlciB3cml0ZSBnb2VzIHN0cmFpZ2h0XG4gICAqIHRvIGB3cml0ZUJpbmFyeWAgaW5zdGVhZCBvZiBwYXlpbmcgdGhlIGZhaWxpbmctcmVuYW1lIHBlbmFsdHkgYWdhaW4uXG4gICAqL1xuICBwcml2YXRlIHRlbXBSZW5hbWVCcm9rZW4gPSBmYWxzZTtcbiAgcHJpdmF0ZSB0ZW1wQ291bnRlciA9IDA7XG5cbiAgY29uc3RydWN0b3Iob3B0aW9uczogT2JzaWRpYW5TdG9yYWdlQWRhcHRlck9wdGlvbnMpIHtcbiAgICB0aGlzLmFkYXB0ZXIgPSBvcHRpb25zLmFkYXB0ZXI7XG4gICAgdGhpcy5yZW1vdmVFbXB0eURpciA9IG9wdGlvbnMucmVtb3ZlRW1wdHlEaXI7XG4gIH1cblxuICAvLyAtLS0gcGF0aCBtYXBwaW5nIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICAvKiogVmF1bHQgcGF0aCBcdTIxOTIgYWRhcHRlciBwYXRoIChgL2EvYi5tZGAgXHUyMTkyIGBhL2IubWRgLCBgL2AgXHUyMTkyIGAvYCkuICovXG4gIHByaXZhdGUgdG9BZGFwdGVyUGF0aCh2YXVsdFBhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IG5vcm1hbGl6ZVZhdWx0UGF0aCh2YXVsdFBhdGgpO1xuICAgIHJldHVybiBub3JtYWxpemVkID09PSAnLycgPyAnLycgOiBub3JtYWxpemVkLnNsaWNlKDEpO1xuICB9XG5cbiAgLy8gLS0tIFN0b3JhZ2VBZGFwdGVyIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIGFzeW5jIHJlYWRGaWxlKHBhdGg6IHN0cmluZyk6IFByb21pc2U8VWludDhBcnJheT4ge1xuICAgIGNvbnN0IGJ1ZmZlciA9IGF3YWl0IHRoaXMuYWRhcHRlci5yZWFkQmluYXJ5KHRoaXMudG9BZGFwdGVyUGF0aChwYXRoKSk7XG4gICAgcmV0dXJuIG5ldyBVaW50OEFycmF5KGJ1ZmZlcik7XG4gIH1cblxuICBhc3luYyB3cml0ZUZpbGUocGF0aDogc3RyaW5nLCBkYXRhOiBVaW50OEFycmF5KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgdGFyZ2V0ID0gdGhpcy50b0FkYXB0ZXJQYXRoKHBhdGgpO1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUGFyZW50RGlycyh0YXJnZXQpO1xuICAgIC8vIENvcHkgaW50byBhIHN0YW5kYWxvbmUgQXJyYXlCdWZmZXI6IGBieXRlcy5idWZmZXJgIG1heSBiZSBhIHBvb2xlZFxuICAgIC8vIGJ1ZmZlciBsYXJnZXIgdGhhbiB0aGUgdmlldyAoY29yZSBzbGljZXMgYW5kIHJldXNlcyBidWZmZXJzKS5cbiAgICBjb25zdCBidWZmZXIgPSBuZXcgQXJyYXlCdWZmZXIoZGF0YS5ieXRlTGVuZ3RoKTtcbiAgICBuZXcgVWludDhBcnJheShidWZmZXIpLnNldChkYXRhKTtcblxuICAgIGlmICh0aGlzLnRlbXBSZW5hbWVCcm9rZW4pIHtcbiAgICAgIGF3YWl0IHRoaXMuYWRhcHRlci53cml0ZUJpbmFyeSh0YXJnZXQsIGJ1ZmZlcik7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHRlbXAgPSBhd2FpdCB0aGlzLnRlbXBQYXRoKCk7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuYWRhcHRlci53cml0ZUJpbmFyeSh0ZW1wLCBidWZmZXIpO1xuICAgICAgYXdhaXQgdGhpcy5hZGFwdGVyLnJlbmFtZSh0ZW1wLCB0YXJnZXQpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gQ2xlYW4gdXAgdGhlIG9ycGhhbmVkIHRlbXAgKGJlc3QgZWZmb3J0IFx1MjAxNCBpdCBsaXZlcyBpbiB0aGUgaWdub3JlZFxuICAgICAgLy8gc3RhdGUgZGlyLCBzbyBldmVuIGEgbGVhayBpcyBpbnZpc2libGUgdG8gc3luYyksIHRoZW4gZmFsbCBiYWNrIHRvXG4gICAgICAvLyBhIGRpcmVjdCwgbm9uLWF0b21pYyB3cml0ZSByYXRoZXIgdGhhbiBmYWlsaW5nIHRoZSBzeW5jLlxuICAgICAgYXdhaXQgdGhpcy5zaWxlbnRSZW1vdmUodGVtcCk7XG4gICAgICB0aGlzLnRlbXBSZW5hbWVCcm9rZW4gPSB0cnVlO1xuICAgICAgYXdhaXQgdGhpcy5hZGFwdGVyLndyaXRlQmluYXJ5KHRhcmdldCwgYnVmZmVyKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBkZWxldGVGaWxlKHBhdGg6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHRhcmdldCA9IHRoaXMudG9BZGFwdGVyUGF0aChwYXRoKTtcbiAgICAvLyBJZGVtcG90ZW50IHBlciB0aGUgYWRhcHRlciBjb250cmFjdC5cbiAgICBpZiAoIShhd2FpdCB0aGlzLmFkYXB0ZXIuZXhpc3RzKHRhcmdldCkpKSByZXR1cm47XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuYWRhcHRlci5yZW1vdmUodGFyZ2V0KTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIExvc3QgYSByYWNlIHdpdGggYSBjb25jdXJyZW50IGRlbGV0ZSBcdTIwMTQgb25seSBzdXJmYWNlIGlmIGl0IHN1cnZpdmVzLlxuICAgICAgaWYgKGF3YWl0IHRoaXMuYWRhcHRlci5leGlzdHModGFyZ2V0KSkgdGhyb3cgbmV3IEVycm9yKGBmYWlsZWQgdG8gZGVsZXRlICR7dGFyZ2V0fWApO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHJlbmFtZUZpbGUoZnJvbTogc3RyaW5nLCB0bzogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgZnJvbVBhdGggPSB0aGlzLnRvQWRhcHRlclBhdGgoZnJvbSk7XG4gICAgY29uc3QgdG9QYXRoID0gdGhpcy50b0FkYXB0ZXJQYXRoKHRvKTtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVBhcmVudERpcnModG9QYXRoKTtcbiAgICBhd2FpdCB0aGlzLmFkYXB0ZXIucmVuYW1lKGZyb21QYXRoLCB0b1BhdGgpO1xuICB9XG5cbiAgYXN5bmMgbGlzdEZpbGVzKCk6IFByb21pc2U8cmVhZG9ubHkgRmlsZVN0YXRbXT4ge1xuICAgIGNvbnN0IGZpbGVzOiBGaWxlU3RhdFtdID0gW107XG4gICAgYXdhaXQgdGhpcy53YWxrRmlsZXMoJy8nLCBhc3luYyAoYWRhcHRlclBhdGgpID0+IHtcbiAgICAgIGNvbnN0IHN0YXQgPSBhd2FpdCB0aGlzLnN0YXRPck51bGwoYWRhcHRlclBhdGgpO1xuICAgICAgaWYgKHN0YXQgPT09IG51bGwpIHJldHVybjsgLy8gdmFuaXNoZWQgbWlkLXdhbGtcbiAgICAgIGZpbGVzLnB1c2goe1xuICAgICAgICBwYXRoOiBgLyR7YWRhcHRlclBhdGh9YCxcbiAgICAgICAgc2l6ZTogc3RhdC5zaXplLFxuICAgICAgICBtdGltZTogc3RhdC5tdGltZSxcbiAgICAgIH0pO1xuICAgIH0pO1xuICAgIGZpbGVzLnNvcnQoKGEsIGIpID0+IChhLnBhdGggPCBiLnBhdGggPyAtMSA6IGEucGF0aCA+IGIucGF0aCA/IDEgOiAwKSk7XG4gICAgcmV0dXJuIGZpbGVzO1xuICB9XG5cbiAgYXN5bmMgbGlzdERpcnMoKTogUHJvbWlzZTxyZWFkb25seSBzdHJpbmdbXT4ge1xuICAgIGNvbnN0IGRpcnM6IHN0cmluZ1tdID0gWycvJ107XG4gICAgYXdhaXQgdGhpcy53YWxrRm9sZGVycygnLycsIGFzeW5jIChhZGFwdGVyUGF0aCkgPT4ge1xuICAgICAgZGlycy5wdXNoKGAvJHthZGFwdGVyUGF0aH1gKTtcbiAgICB9KTtcbiAgICBkaXJzLnNvcnQoKGEsIGIpID0+IChhIDwgYiA/IC0xIDogYSA+IGIgPyAxIDogMCkpO1xuICAgIHJldHVybiBkaXJzO1xuICB9XG5cbiAgYXN5bmMgZW5zdXJlRGlyKHBhdGg6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVWYXVsdFBhdGgocGF0aCk7XG4gICAgY29uc3Qgc2VnbWVudHMgPSBub3JtYWxpemVkID09PSAnLycgPyBbXSA6IG5vcm1hbGl6ZWQuc2xpY2UoMSkuc3BsaXQoJy8nKTtcbiAgICBsZXQgY3VycmVudCA9ICcnO1xuICAgIGZvciAoY29uc3Qgc2VnbWVudCBvZiBzZWdtZW50cykge1xuICAgICAgY3VycmVudCA9IGN1cnJlbnQgPT09ICcnID8gc2VnbWVudCA6IGAke2N1cnJlbnR9LyR7c2VnbWVudH1gO1xuICAgICAgaWYgKCEoYXdhaXQgdGhpcy5hZGFwdGVyLmV4aXN0cyhjdXJyZW50KSkpIGF3YWl0IHRoaXMuYWRhcHRlci5ta2RpcihjdXJyZW50KTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUmVtb3ZlIGFuIEVNUFRZIGRpcmVjdG9yeSAodGhlIGBTdG9yYWdlQWRhcHRlci5yZW1vdmVEaXJgIGNvbnRyYWN0KS5cbiAgICogUHJlZmVycyB0aGUgdmF1bHQtQVBJIGNhbGxiYWNrIChgcmVtb3ZlRW1wdHlEaXJgIFx1MjAxNCBzZWUgdGhlIG9wdGlvbidzIGRvY1xuICAgKiBmb3Igd2h5IGBEYXRhQWRhcHRlci5ybWRpcmAgY2Fubm90IGRvIHRoaXMpOyBmYWxscyBiYWNrIHRvIGBybWRpcmAgZm9yXG4gICAqIGJhcmUgYWRhcHRlcnMgKHRlc3RzKS4gTWlzc2luZyBwYXRoIFx1MjFEMiBuby1vcCAoaWRlbXBvdGVudCk7IHRoZSB2YXVsdCByb290XG4gICAqIGlzIG5ldmVyIHJlbW92YWJsZTsgYSBub24tZW1wdHkgcmVmdXNhbCBwcm9wYWdhdGVzIChjb3JlIHRyZWF0cyBpdCBhc1xuICAgKiByZWNvcmQtb25seSBcdTIwMTQgbmV2ZXIgZGF0YSBsb3NzKS5cbiAgICovXG4gIGFzeW5jIHJlbW92ZURpcihwYXRoOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBub3JtYWxpemVkID0gbm9ybWFsaXplVmF1bHRQYXRoKHBhdGgpO1xuICAgIGlmIChub3JtYWxpemVkID09PSAnLycpIHJldHVybjsgLy8gbmV2ZXIgdG91Y2ggdGhlIHZhdWx0IHJvb3RcbiAgICBjb25zdCB0YXJnZXQgPSB0aGlzLnRvQWRhcHRlclBhdGgobm9ybWFsaXplZCk7XG4gICAgLy8gSWRlbXBvdGVudCBwZXIgdGhlIGFkYXB0ZXIgY29udHJhY3QuXG4gICAgaWYgKCEoYXdhaXQgdGhpcy5hZGFwdGVyLmV4aXN0cyh0YXJnZXQpKSkgcmV0dXJuO1xuICAgIGlmICh0aGlzLnJlbW92ZUVtcHR5RGlyICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGF3YWl0IHRoaXMucmVtb3ZlRW1wdHlEaXIodGFyZ2V0KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgYXdhaXQgdGhpcy5hZGFwdGVyLnJtZGlyKHRhcmdldCwgZmFsc2UpO1xuICB9XG5cbiAgYXN5bmMgZXhpc3RzKHBhdGg6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVWYXVsdFBhdGgocGF0aCk7XG4gICAgaWYgKG5vcm1hbGl6ZWQgPT09ICcvJykgcmV0dXJuIHRydWU7IC8vIHRoZSB2YXVsdCByb290IGFsd2F5cyBleGlzdHNcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuYWRhcHRlci5leGlzdHModGhpcy50b0FkYXB0ZXJQYXRoKG5vcm1hbGl6ZWQpKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cblxuICAvLyAtLS0gaGVscGVycyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgcHJpdmF0ZSBhc3luYyBzdGF0T3JOdWxsKGFkYXB0ZXJQYXRoOiBzdHJpbmcpOiBQcm9taXNlPEFkYXB0ZXJTdGF0IHwgbnVsbD4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBzdGF0ID0gYXdhaXQgdGhpcy5hZGFwdGVyLnN0YXQoYWRhcHRlclBhdGgpO1xuICAgICAgaWYgKHN0YXQgPT09IG51bGwgfHwgc3RhdC50eXBlICE9PSAnZmlsZScpIHJldHVybiBudWxsO1xuICAgICAgcmV0dXJuIHsgc2l6ZTogc3RhdC5zaXplLCBtdGltZTogc3RhdC5tdGltZSB9O1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICB9XG5cbiAgLyoqIEEgdW5pcXVlIHRlbXAgcGF0aCBpbnNpZGUgdGhlIChzeW5jLWlnbm9yZWQpIGNsaWVudCBzdGF0ZSBkaXIuICovXG4gIHByaXZhdGUgYXN5bmMgdGVtcFBhdGgoKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZURpcihURU1QX0RJUl9WQVVMVF9QQVRIKTtcbiAgICB0aGlzLnRlbXBDb3VudGVyICs9IDE7XG4gICAgcmV0dXJuIGAke1RFTVBfRElSX1ZBVUxUX1BBVEguc2xpY2UoMSl9L3ctJHtEYXRlLm5vdygpLnRvU3RyaW5nKDM2KX0tJHt0aGlzLnRlbXBDb3VudGVyfS50bXBgO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBzaWxlbnRSZW1vdmUoYWRhcHRlclBhdGg6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLmFkYXB0ZXIucmVtb3ZlKGFkYXB0ZXJQYXRoKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIGJlc3QgZWZmb3J0XG4gICAgfVxuICB9XG5cbiAgLyoqIENyZWF0ZSBldmVyeSBhbmNlc3RvciBkaXJlY3Rvcnkgb2YgYW4gYWRhcHRlciBmaWxlIHBhdGguICovXG4gIHByaXZhdGUgYXN5bmMgZW5zdXJlUGFyZW50RGlycyhhZGFwdGVyUGF0aDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgc2xhc2ggPSBhZGFwdGVyUGF0aC5sYXN0SW5kZXhPZignLycpO1xuICAgIGlmIChzbGFzaCA8PSAwKSByZXR1cm47IC8vIHZhdWx0IHJvb3QgXHUyMDE0IGFsd2F5cyBleGlzdHNcbiAgICBjb25zdCBwYXJlbnQgPSBhZGFwdGVyUGF0aC5zbGljZSgwLCBzbGFzaCk7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVEaXIoYC8ke3BhcmVudH1gKTtcbiAgfVxuXG4gIC8qKiBSZWN1cnNpdmVseSB2aXNpdCBldmVyeSBmaWxlIHVuZGVyIGBkaXJBZGFwdGVyUGF0aGAgKGFkYXB0ZXIgcGF0aHMpLiAqL1xuICBwcml2YXRlIGFzeW5jIHdhbGtGaWxlcyhcbiAgICBkaXJBZGFwdGVyUGF0aDogc3RyaW5nLFxuICAgIHZpc2l0OiAoYWRhcHRlclBhdGg6IHN0cmluZykgPT4gUHJvbWlzZTx2b2lkPixcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgbGV0IGxpc3Rpbmc7XG4gICAgdHJ5IHtcbiAgICAgIGxpc3RpbmcgPSBhd2FpdCB0aGlzLmFkYXB0ZXIubGlzdChkaXJBZGFwdGVyUGF0aCk7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm47IC8vIHVucmVhZGFibGUvbWlzc2luZyBcdTIwMTQgdHJlYXQgYXMgZW1wdHlcbiAgICB9XG4gICAgZm9yIChjb25zdCBmaWxlIG9mIGxpc3RpbmcuZmlsZXMpIGF3YWl0IHZpc2l0KGZpbGUpO1xuICAgIGZvciAoY29uc3QgZm9sZGVyIG9mIGxpc3RpbmcuZm9sZGVycykgYXdhaXQgdGhpcy53YWxrRmlsZXMoZm9sZGVyLCB2aXNpdCk7XG4gIH1cblxuICAvKiogUmVjdXJzaXZlbHkgdmlzaXQgZXZlcnkgZm9sZGVyIHVuZGVyIGBkaXJBZGFwdGVyUGF0aGAgKGFkYXB0ZXIgcGF0aHMpLiAqL1xuICBwcml2YXRlIGFzeW5jIHdhbGtGb2xkZXJzKFxuICAgIGRpckFkYXB0ZXJQYXRoOiBzdHJpbmcsXG4gICAgdmlzaXQ6IChhZGFwdGVyUGF0aDogc3RyaW5nKSA9PiBQcm9taXNlPHZvaWQ+LFxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBsZXQgbGlzdGluZztcbiAgICB0cnkge1xuICAgICAgbGlzdGluZyA9IGF3YWl0IHRoaXMuYWRhcHRlci5saXN0KGRpckFkYXB0ZXJQYXRoKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgZm9yIChjb25zdCBmb2xkZXIgb2YgbGlzdGluZy5mb2xkZXJzKSB7XG4gICAgICBhd2FpdCB2aXNpdChmb2xkZXIpO1xuICAgICAgYXdhaXQgdGhpcy53YWxrRm9sZGVycyhmb2xkZXIsIHZpc2l0KTtcbiAgICB9XG4gIH1cbn1cbiIsICIvKipcbiAqIGBPYnNpZGlhbldhdGNoQWRhcHRlcmAgKyBgUmVzY2FuU2NoZWR1bGVyYCBcdTIwMTQgY29yZSdzIGBXYXRjaEFkYXB0ZXJgIG92ZXJcbiAqIE9ic2lkaWFuIHZhdWx0IGV2ZW50cyAoQVJDSElURUNUVVJFIFx1MDBBNzggYWRhcHRlcnMpLCBwbHVzIHRoZSBwZXJpb2RpYyAvXG4gKiBmb2N1cy1kcml2ZW4gcmVjb25jaWxpYXRpb24gaG9va3MgdGhlIG1vYmlsZSAmIGV4dGVybmFsLWVkaXQgc3RvcmllcyBuZWVkXG4gKiAoXHUwMEE3OCBcIk1vYmlsZVwiLCBGUi01LCBGUi0xMikuXG4gKlxuICogVmF1bHQgZXZlbnRzIGNvdmVyIGV2ZXJ5dGhpbmcgT2JzaWRpYW4gaXRzZWxmIG9ic2VydmVzIFx1MjAxNCBpbi1hcHAgZWRpdHMsXG4gKiBkcmFnLWRyb3BzLCBhbmQgZXh0ZXJuYWwgZWRpdHMgbWFkZSB3aGlsZSBPYnNpZGlhbiBpcyAqb3BlbiouIEVkaXRzIG1hZGVcbiAqIHdoaWxlIE9ic2lkaWFuIHdhcyBjbG9zZWQgYXJlIHBpY2tlZCB1cCBieSB0aGUgc3RhcnR1cCByZWNvbmNpbGlhdGlvbiBhbmRcbiAqIGJ5IHRoZSBwZXJpb2RpYyByZXNjYW4gd2lyZWQgaGVyZTpcbiAqXG4gKiAgIHZhdWx0IGV2ZW50cyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1QkEgV2F0Y2hBZGFwdGVyLnN0YXJ0KGNiKSBcdTI1MDBcdTI1QkEgU3luY0NsaWVudCBkZWJvdW5jZWQgY3ljbGVcbiAqICAgc2V0SW50ZXJ2YWwgKGRlZmF1bHQgMzBzKSBcdTI1MDBcdTI1QkEgUmVzY2FuU2NoZWR1bGVyIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjVCQSBTeW5jQ2xpZW50LnRyaWdnZXJTeW5jKClcbiAqICAgYWN0aXZlLWxlYWYtY2hhbmdlIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjVCQSBSZXNjYW5TY2hlZHVsZXIucG9rZSgpIFx1MjUwMFx1MjUwMFx1MjVCQSAoc2hvcnQgZGVib3VuY2UsIHRoZW4gYSBjeWNsZSlcbiAqL1xuXG5pbXBvcnQgdHlwZSB7IEV2ZW50UmVmLCBUQWJzdHJhY3RGaWxlLCBWYXVsdCB9IGZyb20gJ29ic2lkaWFuJztcbmltcG9ydCB0eXBlIHsgRmlsZUNoYW5nZUV2ZW50LCBXYXRjaEFkYXB0ZXIgfSBmcm9tICdAdnNhL2NvcmUnO1xuXG5leHBvcnQgaW50ZXJmYWNlIE9ic2lkaWFuV2F0Y2hBZGFwdGVyT3B0aW9ucyB7XG4gIHZhdWx0OiBWYXVsdDtcbn1cblxuZXhwb3J0IGNsYXNzIE9ic2lkaWFuV2F0Y2hBZGFwdGVyIGltcGxlbWVudHMgV2F0Y2hBZGFwdGVyIHtcbiAgcHJpdmF0ZSByZWFkb25seSB2YXVsdDogVmF1bHQ7XG4gIHByaXZhdGUgcmVmczogRXZlbnRSZWZbXSA9IFtdO1xuICBwcml2YXRlIGVtaXQ6ICgoZXZlbnRzOiByZWFkb25seSBGaWxlQ2hhbmdlRXZlbnRbXSkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcblxuICBjb25zdHJ1Y3RvcihvcHRpb25zOiBPYnNpZGlhbldhdGNoQWRhcHRlck9wdGlvbnMpIHtcbiAgICB0aGlzLnZhdWx0ID0gb3B0aW9ucy52YXVsdDtcbiAgfVxuXG4gIHN0YXJ0KGNiOiAoZXZlbnRzOiByZWFkb25seSBGaWxlQ2hhbmdlRXZlbnRbXSkgPT4gdm9pZCk6IHZvaWQge1xuICAgIHRoaXMuc3RvcCgpO1xuICAgIHRoaXMuZW1pdCA9IGNiO1xuICAgIC8vIEJvdGggZmlsZXMgYW5kIGZvbGRlcnMgYXJlIGZvcndhcmRlZDogZm9sZGVyIGV2ZW50cyAoY3JlYXRlL3JlbmFtZS9cbiAgICAvLyBkZWxldGUpIHRyaWdnZXIgdGhlIHJlY29uY2lsaWF0aW9uIHNjYW4gdGhhdCBkaXNjb3ZlcnMgZW1wdHktZm9sZGVyXG4gICAgLy8gcGxhY2Vob2xkZXIgY2hhbmdlcyAoRlItMTApLiBUaGUgZW5naW5lIGZpbHRlcnMgaWdub3JlZCBwYXRocyBpdHNlbGYuXG4gICAgdGhpcy5yZWZzID0gW1xuICAgICAgdGhpcy52YXVsdC5vbignY3JlYXRlJywgKGZpbGU6IFRBYnN0cmFjdEZpbGUpID0+IHtcbiAgICAgICAgdGhpcy5mb3J3YXJkKHsga2luZDogJ2FkZCcsIHBhdGg6IHZhdWx0UGF0aE9mKGZpbGUpIH0pO1xuICAgICAgfSksXG4gICAgICB0aGlzLnZhdWx0Lm9uKCdtb2RpZnknLCAoZmlsZTogVEFic3RyYWN0RmlsZSkgPT4ge1xuICAgICAgICB0aGlzLmZvcndhcmQoeyBraW5kOiAnbW9kaWZ5JywgcGF0aDogdmF1bHRQYXRoT2YoZmlsZSkgfSk7XG4gICAgICB9KSxcbiAgICAgIHRoaXMudmF1bHQub24oJ2RlbGV0ZScsIChmaWxlOiBUQWJzdHJhY3RGaWxlKSA9PiB7XG4gICAgICAgIHRoaXMuZm9yd2FyZCh7IGtpbmQ6ICdkZWxldGUnLCBwYXRoOiB2YXVsdFBhdGhPZihmaWxlKSB9KTtcbiAgICAgIH0pLFxuICAgICAgdGhpcy52YXVsdC5vbigncmVuYW1lJywgKGZpbGU6IFRBYnN0cmFjdEZpbGUsIG9sZFBhdGg6IHN0cmluZykgPT4ge1xuICAgICAgICAvLyBgb2xkUGF0aGAgXHUyMTkyIGBmaWxlLnBhdGhgOiB0aGUgZW50cnkgYXQgYHBhdGhgIG1vdmVkIHRvIGB0b1BhdGhgLlxuICAgICAgICB0aGlzLmZvcndhcmQoeyBraW5kOiAncmVuYW1lJywgcGF0aDogYC8ke29sZFBhdGh9YCwgdG9QYXRoOiB2YXVsdFBhdGhPZihmaWxlKSB9KTtcbiAgICAgIH0pLFxuICAgIF07XG4gIH1cblxuICBzdG9wKCk6IHZvaWQge1xuICAgIGZvciAoY29uc3QgcmVmIG9mIHRoaXMucmVmcykgdGhpcy52YXVsdC5vZmZyZWYocmVmKTtcbiAgICB0aGlzLnJlZnMgPSBbXTtcbiAgICB0aGlzLmVtaXQgPSBudWxsO1xuICB9XG5cbiAgcHJpdmF0ZSBmb3J3YXJkKGV2ZW50OiBGaWxlQ2hhbmdlRXZlbnQpOiB2b2lkIHtcbiAgICB0aGlzLmVtaXQ/LihbZXZlbnRdKTtcbiAgfVxufVxuXG4vKiogVmF1bHQgZXZlbnQgcGF0aCAoYWRhcHRlci1ub3JtYWxpemVkLCBubyBsZWFkaW5nIHNsYXNoKSBcdTIxOTIgY29yZSB2YXVsdCBwYXRoLiAqL1xuZnVuY3Rpb24gdmF1bHRQYXRoT2YoZmlsZTogVEFic3RyYWN0RmlsZSk6IHN0cmluZyB7XG4gIHJldHVybiBmaWxlLnBhdGguc3RhcnRzV2l0aCgnLycpID8gZmlsZS5wYXRoIDogYC8ke2ZpbGUucGF0aH1gO1xufVxuXG4vLyAtLS0gUmVzY2FuU2NoZWR1bGVyIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgUmVzY2FuU2NoZWR1bGVyT3B0aW9ucyB7XG4gIC8qKiBQZXJpb2QgYmV0d2VlbiBmdWxsIHJlc2NhbnMgaW4gbXM7IGAwYCBkaXNhYmxlcyB0aGUgcGVyaW9kaWMgdGltZXIuICovXG4gIGludGVydmFsTXM6IG51bWJlcjtcbiAgLyoqIERlYm91bmNlIHdpbmRvdyBmb3IgYHBva2UoKWAgKGFjdGl2ZS1sZWFmLWNoYW5nZSksIGRlZmF1bHQgMzAwMCBtcy4gKi9cbiAgcG9rZURlbGF5TXM/OiBudW1iZXI7XG4gIC8qKiBJbmplY3RhYmxlIHRpbWVyIHNlYW1zICh0ZXN0cyB1c2UgZmFrZSB0aW1lcnMgYWdhaW5zdCB0aGUgZ2xvYmFscykuICovXG4gIHNldEludGVydmFsSW1wbD86IChmbjogKCkgPT4gdm9pZCwgbXM6IG51bWJlcikgPT4gdW5rbm93bjtcbiAgY2xlYXJJbnRlcnZhbEltcGw/OiAoaGFuZGxlOiB1bmtub3duKSA9PiB2b2lkO1xuICBzZXRUaW1lb3V0SW1wbD86IChmbjogKCkgPT4gdm9pZCwgbXM6IG51bWJlcikgPT4gdW5rbm93bjtcbiAgY2xlYXJUaW1lb3V0SW1wbD86IChoYW5kbGU6IHVua25vd24pID0+IHZvaWQ7XG59XG5cbi8qKlxuICogRHJpdmVzIHBlcmlvZGljICsgZm9jdXMtdHJpZ2dlcmVkIGZ1bGwgcmVjb25jaWxpYXRpb24gY3ljbGVzLiBOb3QgYVxuICogYFdhdGNoQWRhcHRlcmAgaXRzZWxmIFx1MjAxNCBpdHMgYHJ1bmAgY2FsbGJhY2sgaXMgd2lyZWQgdG9cbiAqIGBTeW5jQ2xpZW50LnRyaWdnZXJTeW5jKClgIGJ5IHRoZSBwbHVnaW4gKGEgcmVzY2FuIGlzIGEgZnVsbCBjeWNsZSwgbm90IGFcbiAqIHNpbmdsZSBmaWxlIGV2ZW50KS5cbiAqL1xuZXhwb3J0IGNsYXNzIFJlc2NhblNjaGVkdWxlciB7XG4gIHByaXZhdGUgcmVhZG9ubHkgcG9rZURlbGF5TXM6IG51bWJlcjtcbiAgcHJpdmF0ZSByZWFkb25seSBzZXRJbnRlcnZhbEltcGw6IChmbjogKCkgPT4gdm9pZCwgbXM6IG51bWJlcikgPT4gdW5rbm93bjtcbiAgcHJpdmF0ZSByZWFkb25seSBjbGVhckludGVydmFsSW1wbDogKGhhbmRsZTogdW5rbm93bikgPT4gdm9pZDtcbiAgcHJpdmF0ZSByZWFkb25seSBzZXRUaW1lb3V0SW1wbDogKGZuOiAoKSA9PiB2b2lkLCBtczogbnVtYmVyKSA9PiB1bmtub3duO1xuICBwcml2YXRlIHJlYWRvbmx5IGNsZWFyVGltZW91dEltcGw6IChoYW5kbGU6IHVua25vd24pID0+IHZvaWQ7XG5cbiAgcHJpdmF0ZSBydW46ICgoKSA9PiB2b2lkKSB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGludGVydmFsSGFuZGxlOiB1bmtub3duID0gbnVsbDtcbiAgcHJpdmF0ZSBpbnRlcnZhbE1zOiBudW1iZXI7XG4gIHByaXZhdGUgcG9rZUhhbmRsZTogdW5rbm93biA9IG51bGw7XG5cbiAgY29uc3RydWN0b3Iob3B0aW9uczogUmVzY2FuU2NoZWR1bGVyT3B0aW9ucykge1xuICAgIHRoaXMuaW50ZXJ2YWxNcyA9IG9wdGlvbnMuaW50ZXJ2YWxNcztcbiAgICB0aGlzLnBva2VEZWxheU1zID0gb3B0aW9ucy5wb2tlRGVsYXlNcyA/PyAzMDAwO1xuICAgIHRoaXMuc2V0SW50ZXJ2YWxJbXBsID0gb3B0aW9ucy5zZXRJbnRlcnZhbEltcGwgPz8gKChmbiwgbXMpID0+IHNldEludGVydmFsKGZuLCBtcykpO1xuICAgIHRoaXMuY2xlYXJJbnRlcnZhbEltcGwgPSBvcHRpb25zLmNsZWFySW50ZXJ2YWxJbXBsID8/ICgoaGFuZGxlKSA9PiBjbGVhckludGVydmFsKGhhbmRsZSBhcyBudW1iZXIpKTtcbiAgICB0aGlzLnNldFRpbWVvdXRJbXBsID0gb3B0aW9ucy5zZXRUaW1lb3V0SW1wbCA/PyAoKGZuLCBtcykgPT4gc2V0VGltZW91dChmbiwgbXMpKTtcbiAgICB0aGlzLmNsZWFyVGltZW91dEltcGwgPSBvcHRpb25zLmNsZWFyVGltZW91dEltcGwgPz8gKChoYW5kbGUpID0+IGNsZWFyVGltZW91dChoYW5kbGUgYXMgbnVtYmVyKSk7XG4gIH1cblxuICAvKiogQmVnaW4gcGVyaW9kaWMgcmVzY2FuczsgYHJ1bmAgbXVzdCBiZSBzYWZlIHRvIGNhbGwgYXQgYW55IHRpbWUuICovXG4gIHN0YXJ0KHJ1bjogKCkgPT4gdm9pZCk6IHZvaWQge1xuICAgIHRoaXMuc3RvcCgpO1xuICAgIHRoaXMucnVuID0gcnVuO1xuICAgIHRoaXMuYXJtSW50ZXJ2YWwoKTtcbiAgfVxuXG4gIHN0b3AoKTogdm9pZCB7XG4gICAgdGhpcy5jbGVhckludGVydmFsSW1wbEtlZXAoKTtcbiAgICBpZiAodGhpcy5wb2tlSGFuZGxlICE9PSBudWxsKSB7XG4gICAgICB0aGlzLmNsZWFyVGltZW91dEltcGwodGhpcy5wb2tlSGFuZGxlKTtcbiAgICAgIHRoaXMucG9rZUhhbmRsZSA9IG51bGw7XG4gICAgfVxuICAgIHRoaXMucnVuID0gbnVsbDtcbiAgfVxuXG4gIC8qKiBDaGFuZ2UgdGhlIHBlcmlvZGljIGludGVydmFsIGxpdmUgKHRoZSBzZXR0aW5ncy10YWIgdG9nZ2xlKS4gKi9cbiAgc2V0SW50ZXJ2YWxNcyhtczogbnVtYmVyKTogdm9pZCB7XG4gICAgdGhpcy5pbnRlcnZhbE1zID0gbXM7XG4gICAgaWYgKHRoaXMucnVuICE9PSBudWxsKSB7XG4gICAgICB0aGlzLmNsZWFySW50ZXJ2YWxJbXBsS2VlcCgpO1xuICAgICAgdGhpcy5hcm1JbnRlcnZhbCgpO1xuICAgIH1cbiAgfVxuXG4gIC8qKiBBIGZvY3VzL2FwcC1zd2l0Y2ggc2lnbmFsIChhY3RpdmUtbGVhZi1jaGFuZ2UpOiByZXNjYW4gc29vbiwgY29hbGVzY2VkLiAqL1xuICBwb2tlKCk6IHZvaWQge1xuICAgIGlmICh0aGlzLnJ1biA9PT0gbnVsbCkgcmV0dXJuO1xuICAgIGlmICh0aGlzLnBva2VIYW5kbGUgIT09IG51bGwpIHJldHVybjsgLy8gYWxyZWFkeSBzY2hlZHVsZWRcbiAgICB0aGlzLnBva2VIYW5kbGUgPSB0aGlzLnNldFRpbWVvdXRJbXBsKCgpID0+IHtcbiAgICAgIHRoaXMucG9rZUhhbmRsZSA9IG51bGw7XG4gICAgICB0aGlzLnJ1bj8uKCk7XG4gICAgfSwgdGhpcy5wb2tlRGVsYXlNcyk7XG4gIH1cblxuICBnZXQgaW50ZXJ2YWxNc1ZhbHVlKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMuaW50ZXJ2YWxNcztcbiAgfVxuXG4gIHByaXZhdGUgYXJtSW50ZXJ2YWwoKTogdm9pZCB7XG4gICAgaWYgKHRoaXMuaW50ZXJ2YWxNcyA8PSAwIHx8IHRoaXMucnVuID09PSBudWxsKSByZXR1cm47XG4gICAgdGhpcy5pbnRlcnZhbEhhbmRsZSA9IHRoaXMuc2V0SW50ZXJ2YWxJbXBsKCgpID0+IHRoaXMucnVuPy4oKSwgdGhpcy5pbnRlcnZhbE1zKTtcbiAgfVxuXG4gIHByaXZhdGUgY2xlYXJJbnRlcnZhbEltcGxLZWVwKCk6IHZvaWQge1xuICAgIGlmICh0aGlzLmludGVydmFsSGFuZGxlICE9PSBudWxsKSB7XG4gICAgICB0aGlzLmNsZWFySW50ZXJ2YWxJbXBsKHRoaXMuaW50ZXJ2YWxIYW5kbGUpO1xuICAgICAgdGhpcy5pbnRlcnZhbEhhbmRsZSA9IG51bGw7XG4gICAgfVxuICB9XG59XG4iLCAiLyoqXG4gKiBgSHR0cEJsb2JTdG9yZWAgXHUyMDE0IGNvcmUncyBgQmxvYlN0b3JlYCBhZ2FpbnN0IHRoZSB3b3JrZXIncyBgL2Jsb2IvOmhhc2hgXG4gKiByb3V0ZXMgKEFSQ0hJVEVDVFVSRSBcdTAwQTc1IEhUVFBTIHJvdXRlcyksIGF1dGhlbnRpY2F0ZWQgd2l0aCB0aGUgZGV2aWNlIHRva2VuXG4gKiBhcyBhIEJlYXJlciBoZWFkZXIuIEJ1aWx0IG9uIHRoZSBnbG9iYWwgYGZldGNoYCAoT2JzaWRpYW4gZGVza3RvcCBhbmRcbiAqIG1vYmlsZSksIGluamVjdGFibGUgZm9yIHRlc3RzLiBQbHVnaW4tbG9jYWwgdHdpbiBvZiB0aGUgbm9kZS1ydW50aW1lIG9uZTpcbiAqIG5vIGltcG9ydHMgZnJvbSBgQHZzYS9ub2RlLXJ1bnRpbWVgIChOb2RlLW9ubHkgcGFja2FnZSkuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBCbG9iU3RvcmUgfSBmcm9tICdAdnNhL2NvcmUnO1xuXG4vKiogTm9uLTJ4eCBibG9iLXJvdXRlIHJlcGx5LiBgc3RhdHVzYCBpcyB0aGUgSFRUUCBzdGF0dXMgY29kZS4gKi9cbmV4cG9ydCBjbGFzcyBIdHRwQmxvYkVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBjb25zdHJ1Y3RvcihcbiAgICByZWFkb25seSBzdGF0dXM6IG51bWJlcixcbiAgICBtZXNzYWdlOiBzdHJpbmcsXG4gICkge1xuICAgIHN1cGVyKG1lc3NhZ2UpO1xuICAgIHRoaXMubmFtZSA9ICdIdHRwQmxvYkVycm9yJztcbiAgfVxufVxuXG5leHBvcnQgaW50ZXJmYWNlIEh0dHBCbG9iU3RvcmVPcHRpb25zIHtcbiAgLyoqIFdvcmtlciBvcmlnaW4sIGUuZy4gYGh0dHBzOi8vcGVyc29uYWwueC53b3JrZXJzLmRldmAuICovXG4gIGJhc2VVcmw6IHN0cmluZztcbiAgLyoqIERldmljZSB0b2tlbiAoQmVhcmVyKS4gKi9cbiAgdG9rZW46IHN0cmluZztcbiAgLyoqIEluamVjdGFibGUgZmV0Y2ggKHRlc3RzKS4gRGVmYXVsdHMgdG8gdGhlIGdsb2JhbC4gKi9cbiAgZmV0Y2hJbXBsPzogdHlwZW9mIGZldGNoO1xufVxuXG5leHBvcnQgY2xhc3MgSHR0cEJsb2JTdG9yZSBpbXBsZW1lbnRzIEJsb2JTdG9yZSB7XG4gIHByaXZhdGUgcmVhZG9ubHkgYmFzZTogc3RyaW5nO1xuICBwcml2YXRlIHJlYWRvbmx5IHRva2VuOiBzdHJpbmc7XG4gIHByaXZhdGUgcmVhZG9ubHkgZG9GZXRjaDogdHlwZW9mIGZldGNoO1xuXG4gIGNvbnN0cnVjdG9yKG9wdGlvbnM6IEh0dHBCbG9iU3RvcmVPcHRpb25zKSB7XG4gICAgdGhpcy5iYXNlID0gb3B0aW9ucy5iYXNlVXJsLnJlcGxhY2UoL1xcLyskLywgJycpO1xuICAgIHRoaXMudG9rZW4gPSBvcHRpb25zLnRva2VuO1xuICAgIC8vIEJvdW5kIGxpa2UgdGhlIHBsdWdpbidzIGBmZXRjaEltcGxgIHNlYW06IHRoaXMgY2xhc3MgY2FsbHMgYGRvRmV0Y2hgXG4gICAgLy8gZGV0YWNoZWQsIGFuZCBhIGJhcmUgZ2xvYmFsIGBmZXRjaGAgaXMgYW4gaWxsZWdhbCBpbnZvY2F0aW9uIGluXG4gICAgLy8gQ2hyb21pdW0gcmVuZGVyZXJzIChyZWFsIE9ic2lkaWFuKS5cbiAgICB0aGlzLmRvRmV0Y2ggPSBvcHRpb25zLmZldGNoSW1wbCA/PyBnbG9iYWxUaGlzLmZldGNoLmJpbmQoZ2xvYmFsVGhpcyk7XG4gIH1cblxuICAvKiogR0VUIC9ibG9iLzpoYXNoIFx1MjE5MiBieXRlcywgb3IgYHVuZGVmaW5lZGAgb24gNDA0LiAqL1xuICBhc3luYyBnZXQoaGFzaDogc3RyaW5nKTogUHJvbWlzZTxVaW50OEFycmF5IHwgdW5kZWZpbmVkPiB7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLmRvRmV0Y2goYCR7dGhpcy5iYXNlfS9ibG9iLyR7aGFzaH1gLCB7XG4gICAgICBoZWFkZXJzOiB7IGF1dGhvcml6YXRpb246IGBCZWFyZXIgJHt0aGlzLnRva2VufWAgfSxcbiAgICB9KTtcbiAgICBpZiAocmVzcG9uc2Uuc3RhdHVzID09PSA0MDQpIHJldHVybiB1bmRlZmluZWQ7XG4gICAgaWYgKCFyZXNwb25zZS5vaykge1xuICAgICAgdGhyb3cgbmV3IEh0dHBCbG9iRXJyb3IocmVzcG9uc2Uuc3RhdHVzLCBhd2FpdCBlcnJvck1lc3NhZ2UocmVzcG9uc2UsICdmZXRjaCBibG9iJykpO1xuICAgIH1cbiAgICByZXR1cm4gbmV3IFVpbnQ4QXJyYXkoYXdhaXQgcmVzcG9uc2UuYXJyYXlCdWZmZXIoKSk7XG4gIH1cblxuICAvKiogUFVUIC9ibG9iLzpoYXNoIFx1MjAxNCBpZGVtcG90ZW50IHBlciB0aGUgQ0FTIGNvbnRyYWN0LiAqL1xuICBhc3luYyBwdXQoaGFzaDogc3RyaW5nLCBieXRlczogVWludDhBcnJheSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5kb0ZldGNoKGAke3RoaXMuYmFzZX0vYmxvYi8ke2hhc2h9YCwge1xuICAgICAgbWV0aG9kOiAnUFVUJyxcbiAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgYXV0aG9yaXphdGlvbjogYEJlYXJlciAke3RoaXMudG9rZW59YCxcbiAgICAgICAgJ2NvbnRlbnQtdHlwZSc6ICdhcHBsaWNhdGlvbi9vY3RldC1zdHJlYW0nLFxuICAgICAgfSxcbiAgICAgIGJvZHk6IGJ5dGVzIGFzIEJvZHlJbml0LFxuICAgIH0pO1xuICAgIGlmICghcmVzcG9uc2Uub2spIHtcbiAgICAgIHRocm93IG5ldyBIdHRwQmxvYkVycm9yKHJlc3BvbnNlLnN0YXR1cywgYXdhaXQgZXJyb3JNZXNzYWdlKHJlc3BvbnNlLCAnc3RvcmUgYmxvYicpKTtcbiAgICB9XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gZXJyb3JNZXNzYWdlKHJlc3BvbnNlOiBSZXNwb25zZSwgd2hhdDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgZGV0YWlsID0gKGF3YWl0IHJlc3BvbnNlLnRleHQoKS5jYXRjaCgoKSA9PiAnJykpLnNsaWNlKDAsIDMwMCk7XG4gIHJldHVybiBkZXRhaWwgPT09ICcnXG4gICAgPyBgZmFpbGVkIHRvICR7d2hhdH06IEhUVFAgJHtyZXNwb25zZS5zdGF0dXN9YFxuICAgIDogYGZhaWxlZCB0byAke3doYXR9OiBIVFRQICR7cmVzcG9uc2Uuc3RhdHVzfTogJHtkZXRhaWx9YDtcbn1cbiIsICIvKipcbiAqIERpYWdub3N0aWNzICh0aGUgc2V0dGluZ3MgdGFiJ3MgXCJBZHZhbmNlZCBcdTIxOTIgRGlhZ25vc3RpY3NcIik6IGEgYm91bmRlZCByaW5nXG4gKiBidWZmZXIgb3ZlciB0aGUgcGx1Z2luJ3MgbG9nIHN0cmVhbSB3aXRoIGEgdXNlci1zZWxlY3RhYmxlIG1pbmltdW0gbGV2ZWwsXG4gKiBhIHRyYW5zcG9ydCB3cmFwcGVyIHRoYXQgcmVjb3JkcyBwcm90b2NvbCByb3VuZC10cmlwcyBhdCBkZWJ1ZyBsZXZlbCAobG93XG4gKiB2b2x1bWU6IG9uZSBzaG9ydCBsaW5lIHBlciBmcmFtZSksIGFuZCB0aGUgXCJDb3B5IGRpYWdub3N0aWNzXCIgYnVuZGxlLlxuICpcbiAqIFRoZSBidW5kbGUgaXMgYSBwbGFpbi10ZXh0IHNuYXBzaG90IG1lYW50IGZvciBidWcgcmVwb3J0czogdmVyc2lvbnMsXG4gKiBpZGVudGl0eSwgd29ya2VyLCBhIGNsaWVudCBzdGF0dXMgc25hcHNob3QsIHRoZSBwbGF0Zm9ybSwgYW5kIHRoZSBsYXN0IE5cbiAqIGxvZyBsaW5lcy4gYGJ1aWxkU3VwcG9ydEJ1bmRsZWAgaXMgaXRzIHJpY2hlciBtYXJrZG93biBzaWJsaW5nIFx1MjAxNCB0aGUgZmlsZVxuICogYSBcInN5bmMgYXRlIG15IG5vdGVcIiByZXBvcnQgYXR0YWNoZXMuXG4gKi9cblxuaW1wb3J0IHsgUHJvdG9jb2xWZXJzaW9uIH0gZnJvbSAnQHZzYS9jb3JlJztcbmltcG9ydCB0eXBlIHsgTG9nQWRhcHRlciwgU3luY0NsaWVudFN0YXR1cywgVHJhbnNwb3J0IH0gZnJvbSAnQHZzYS9jb3JlJztcbmltcG9ydCB7IFBsYXRmb3JtIH0gZnJvbSAnb2JzaWRpYW4nO1xuaW1wb3J0IHR5cGUgeyBMb2dMZXZlbCwgUGx1Z2luU3luY1NldHRpbmdzIH0gZnJvbSAnLi9kYXRhLmpzJztcblxuLyoqIFNldmVyaXR5IHJhbmtpbmc7IGBlcnJvcmAgYWx3YXlzIG91dHJhbmtzIGV2ZXJ5IHNlbGVjdGFibGUgbGV2ZWwuICovXG5jb25zdCBMRVZFTF9SQU5LOiBSZWNvcmQ8TG9nTGV2ZWwgfCAnZXJyb3InLCBudW1iZXI+ID0geyBkZWJ1ZzogMTAsIGluZm86IDIwLCB3YXJuOiAzMCwgZXJyb3I6IDQwIH07XG5cbi8qKiBMb2cgbGluZXMga2VwdCBmb3IgdGhlIGRpYWdub3N0aWNzIGJ1bmRsZSAodGhlIHNwZWMncyBcImxhc3QgMjBcIikuICovXG5leHBvcnQgY29uc3QgUklOR19DQVBBQ0lUWSA9IDIwO1xuXG4vKiogTWF4IGNoYXJhY3RlcnMgb25lIGFyZ3VtZW50IGNvbnRyaWJ1dGVzIHRvIGEgcmluZyBsaW5lLiAqL1xuY29uc3QgQVJHX01BWF9DSEFSUyA9IDMwMDtcblxuLyoqIEEgYExvZ0FkYXB0ZXJgIHdpdGggYSBsZXZlbCBnYXRlIGFuZCBhIGJvdW5kZWQgcmluZyBidWZmZXIgYXR0YWNoZWQuICovXG5leHBvcnQgaW50ZXJmYWNlIFBsdWdpbkxvZyBleHRlbmRzIExvZ0FkYXB0ZXIge1xuICAvKiogQ2hhbmdlIHRoZSBtaW5pbXVtIHJlY29yZGVkIGxldmVsIGF0IHJ1bnRpbWUgKHRoZSBzZXR0aW5ncyBkcm9wZG93bikuICovXG4gIHNldExldmVsKGxldmVsOiBMb2dMZXZlbCk6IHZvaWQ7XG4gIGdldExldmVsKCk6IExvZ0xldmVsO1xuICAvKiogV2hldGhlciBgZGVidWdgIGNhbGxzIGN1cnJlbnRseSBwYXNzIHRoZSBnYXRlIChyb3VuZC10cmlwIGxvZ2dpbmcgaG9vaykuICovXG4gIGdldCBkZWJ1Z0VuYWJsZWQoKTogYm9vbGVhbjtcbiAgLyoqIFRoZSBtb3N0IHJlY2VudCBsaW5lcywgb2xkZXN0IGZpcnN0IChib3VuZGVkIGJ5IHRoZSBjYXBhY2l0eSkuICovXG4gIHJlY2VudExpbmVzKCk6IHN0cmluZ1tdO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFBsdWdpbkxvZ09wdGlvbnMge1xuICAvKiogUmluZyBjYXBhY2l0eSAoZGVmYXVsdCAyMCkuICovXG4gIGNhcGFjaXR5PzogbnVtYmVyO1xuICAvKiogTWluaW11bSByZWNvcmRlZCBsZXZlbCAoZGVmYXVsdCAnaW5mbycpLiAqL1xuICBsZXZlbD86IExvZ0xldmVsO1xuICAvKiogVGltZXN0YW1wIHNlYW0gKGRlZmF1bHQgYERhdGUubm93YCkuICovXG4gIG5vdz86ICgpID0+IG51bWJlcjtcbn1cblxuLyoqIEJ1aWxkIHRoZSBwbHVnaW4ncyBsb2cgYWRhcHRlcjogY29uc29sZSBtaXJyb3IgKyBib3VuZGVkIHJpbmcgYnVmZmVyLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVBsdWdpbkxvZyhvcHRpb25zOiBQbHVnaW5Mb2dPcHRpb25zID0ge30pOiBQbHVnaW5Mb2cge1xuICBjb25zdCBjYXBhY2l0eSA9IG9wdGlvbnMuY2FwYWNpdHkgPz8gUklOR19DQVBBQ0lUWTtcbiAgY29uc3Qgbm93ID0gb3B0aW9ucy5ub3cgPz8gKCgpID0+IERhdGUubm93KCkpO1xuICBsZXQgbGV2ZWw6IExvZ0xldmVsID0gb3B0aW9ucy5sZXZlbCA/PyAnaW5mbyc7XG4gIGxldCByaW5nOiBzdHJpbmdbXSA9IFtdO1xuXG4gIGNvbnN0IHdyaXRlID0gKHNldmVyaXR5OiBMb2dMZXZlbCB8ICdlcnJvcicsIGFyZ3M6IHJlYWRvbmx5IHVua25vd25bXSk6IHZvaWQgPT4ge1xuICAgIGlmIChMRVZFTF9SQU5LW3NldmVyaXR5XSA8IExFVkVMX1JBTktbbGV2ZWxdKSByZXR1cm47XG4gICAgY29uc3QgbGluZSA9IGAke25ldyBEYXRlKG5vdygpKS50b0lTT1N0cmluZygpfSBbJHtzZXZlcml0eX1dICR7YXJncy5tYXAoZm10KS5qb2luKCcgJyl9YDtcbiAgICByaW5nLnB1c2gobGluZSk7XG4gICAgaWYgKHJpbmcubGVuZ3RoID4gY2FwYWNpdHkpIHJpbmcgPSByaW5nLnNsaWNlKHJpbmcubGVuZ3RoIC0gY2FwYWNpdHkpO1xuICAgIGNvbnN0IHNpbmsgPVxuICAgICAgc2V2ZXJpdHkgPT09ICdlcnJvcicgPyBjb25zb2xlLmVycm9yIDogc2V2ZXJpdHkgPT09ICd3YXJuJyA/IGNvbnNvbGUud2FybiA6IGNvbnNvbGUubG9nO1xuICAgIHNpbmsoJ1t2c2FdJywgLi4uYXJncyk7XG4gIH07XG5cbiAgcmV0dXJuIHtcbiAgICBkZWJ1ZzogKC4uLmFyZ3M6IHVua25vd25bXSkgPT4gd3JpdGUoJ2RlYnVnJywgYXJncyksXG4gICAgaW5mbzogKC4uLmFyZ3M6IHVua25vd25bXSkgPT4gd3JpdGUoJ2luZm8nLCBhcmdzKSxcbiAgICB3YXJuOiAoLi4uYXJnczogdW5rbm93bltdKSA9PiB3cml0ZSgnd2FybicsIGFyZ3MpLFxuICAgIGVycm9yOiAoLi4uYXJnczogdW5rbm93bltdKSA9PiB3cml0ZSgnZXJyb3InLCBhcmdzKSxcbiAgICBzZXRMZXZlbChuZXh0OiBMb2dMZXZlbCk6IHZvaWQge1xuICAgICAgbGV2ZWwgPSBuZXh0O1xuICAgIH0sXG4gICAgZ2V0TGV2ZWwoKTogTG9nTGV2ZWwge1xuICAgICAgcmV0dXJuIGxldmVsO1xuICAgIH0sXG4gICAgZ2V0IGRlYnVnRW5hYmxlZCgpOiBib29sZWFuIHtcbiAgICAgIHJldHVybiBsZXZlbCA9PT0gJ2RlYnVnJztcbiAgICB9LFxuICAgIHJlY2VudExpbmVzKCk6IHN0cmluZ1tdIHtcbiAgICAgIHJldHVybiBbLi4ucmluZ107XG4gICAgfSxcbiAgfTtcbn1cblxuLyoqIE9uZSBsb2cgYXJndW1lbnQgXHUyMTkyIGNvbXBhY3QgdGV4dCAoc3RyaW5ncyBwYXNzIHRocm91Z2gsIGxvbmcgdmFsdWVzIHRydW5jYXRlZCkuICovXG5mdW5jdGlvbiBmbXQodmFsdWU6IHVua25vd24pOiBzdHJpbmcge1xuICBpZiAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJykgcmV0dXJuIHRydW5jYXRlKHZhbHVlKTtcbiAgaWYgKHZhbHVlIGluc3RhbmNlb2YgRXJyb3IpIHJldHVybiB0cnVuY2F0ZShgJHt2YWx1ZS5uYW1lfTogJHt2YWx1ZS5tZXNzYWdlfWApO1xuICB0cnkge1xuICAgIHJldHVybiB0cnVuY2F0ZShKU09OLnN0cmluZ2lmeSh2YWx1ZSkgPz8gU3RyaW5nKHZhbHVlKSk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBTdHJpbmcodmFsdWUpO1xuICB9XG59XG5cbmZ1bmN0aW9uIHRydW5jYXRlKHRleHQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiB0ZXh0Lmxlbmd0aCA8PSBBUkdfTUFYX0NIQVJTID8gdGV4dCA6IGAke3RleHQuc2xpY2UoMCwgQVJHX01BWF9DSEFSUyAtIDEpfVx1MjAyNmA7XG59XG5cbi8vIC0tLSBwcm90b2NvbCByb3VuZC10cmlwIGxvZ2dpbmcgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBDb21wYWN0LCBsb3ctdm9sdW1lIGRlc2NyaXB0aW9uIG9mIGEgd2lyZSBmcmFtZSAodHlwZSArIGlkZW50aXR5IGtleXMpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRlc2NyaWJlTWVzc2FnZShtZXNzYWdlOiB7XG4gIHR5cGU6IHN0cmluZztcbiAgcGF0aD86IHN0cmluZztcbiAgaGFzaD86IHN0cmluZztcbiAgZnJvbVBhdGg/OiBzdHJpbmc7XG4gIGN1cnNvcj86IG51bWJlcjtcbiAgc2VxPzogbnVtYmVyO1xufSk6IHN0cmluZyB7XG4gIGNvbnN0IGJpdHMgPSBbbWVzc2FnZS50eXBlXTtcbiAgaWYgKG1lc3NhZ2UuZnJvbVBhdGggIT09IHVuZGVmaW5lZCkgYml0cy5wdXNoKGAke21lc3NhZ2UuZnJvbVBhdGh9IFx1MjE5MmApO1xuICBpZiAobWVzc2FnZS5wYXRoICE9PSB1bmRlZmluZWQpIGJpdHMucHVzaChtZXNzYWdlLnBhdGgpO1xuICBpZiAobWVzc2FnZS5oYXNoICE9PSB1bmRlZmluZWQpIGJpdHMucHVzaChtZXNzYWdlLmhhc2guc2xpY2UoMCwgMTIpKTtcbiAgaWYgKG1lc3NhZ2Uuc2VxICE9PSB1bmRlZmluZWQpIGJpdHMucHVzaChgc2VxICR7bWVzc2FnZS5zZXF9YCk7XG4gIGlmIChtZXNzYWdlLmN1cnNvciAhPT0gdW5kZWZpbmVkKSBiaXRzLnB1c2goYGN1cnNvciAke21lc3NhZ2UuY3Vyc29yfWApO1xuICByZXR1cm4gYml0cy5qb2luKCcgJyk7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUm91bmRUcmlwTG9nZ2luZ09wdGlvbnMge1xuICBsb2c6IExvZ0FkYXB0ZXI7XG4gIC8qKiBDaGVhcCBwcmUtY2hlY2sgc28gdGhlIHN0cmluZyBidWlsZGluZyBpcyBza2lwcGVkIHVubGVzcyBkZWJ1ZyBpcyBvbi4gKi9cbiAgc2hvdWxkTG9nOiAoKSA9PiBib29sZWFuO1xufVxuXG4vKipcbiAqIFdyYXAgYSBgVHJhbnNwb3J0YCBzbyBldmVyeSBzZW50L3JlY2VpdmVkIGZyYW1lIGlzIGxvZ2dlZCBhdCBkZWJ1ZyBsZXZlbCBcdTIwMTRcbiAqIG9uZSBzaG9ydCBsaW5lIHBlciBmcmFtZSAoYGRlc2NyaWJlTWVzc2FnZWApLCBub3RoaW5nIGF0IG90aGVyIGxldmVscy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHdpdGhSb3VuZFRyaXBMb2dnaW5nKFxuICB0cmFuc3BvcnQ6IFRyYW5zcG9ydCxcbiAgb3B0aW9uczogUm91bmRUcmlwTG9nZ2luZ09wdGlvbnMsXG4pOiBUcmFuc3BvcnQge1xuICBjb25zdCB7IGxvZywgc2hvdWxkTG9nIH0gPSBvcHRpb25zO1xuICByZXR1cm4ge1xuICAgIHNlbmQ6IChtZXNzYWdlKSA9PiB7XG4gICAgICBpZiAoc2hvdWxkTG9nKCkpIGxvZy5kZWJ1ZygnXHUyMTkyJywgZGVzY3JpYmVNZXNzYWdlKG1lc3NhZ2UpKTtcbiAgICAgIHRyYW5zcG9ydC5zZW5kKG1lc3NhZ2UpO1xuICAgIH0sXG4gICAgb25NZXNzYWdlOiAoY2FsbGJhY2spID0+IHtcbiAgICAgIHRyYW5zcG9ydC5vbk1lc3NhZ2UoKG1lc3NhZ2UpID0+IHtcbiAgICAgICAgaWYgKHNob3VsZExvZygpKSBsb2cuZGVidWcoJ1x1MjE5MCcsIGRlc2NyaWJlTWVzc2FnZShtZXNzYWdlKSk7XG4gICAgICAgIGNhbGxiYWNrKG1lc3NhZ2UpO1xuICAgICAgfSk7XG4gICAgfSxcbiAgICBvbkNsb3NlOiAoY2FsbGJhY2spID0+IHRyYW5zcG9ydC5vbkNsb3NlKGNhbGxiYWNrKSxcbiAgICBjbG9zZTogKCkgPT4gdHJhbnNwb3J0LmNsb3NlKCksXG4gIH07XG59XG5cbi8vIC0tLSB0aGUgYnVuZGxlIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgRGlhZ25vc3RpY3NJbnB1dCB7XG4gIHBsdWdpblZlcnNpb246IHN0cmluZztcbiAgZGV2aWNlSWQ6IHN0cmluZztcbiAgZGV2aWNlTmFtZTogc3RyaW5nO1xuICB3b3JrZXJVcmw6IHN0cmluZztcbiAgcGFpcmVkOiBib29sZWFuO1xuICBwYXVzZWQ6IGJvb2xlYW47XG4gIGNsaWVudFN0YXR1czogU3luY0NsaWVudFN0YXR1cyB8IG51bGw7XG4gIHJlY2VudExvZ0xpbmVzOiByZWFkb25seSBzdHJpbmdbXTtcbiAgLyoqIFdvcmtlci1yZXBvcnRlZCB2ZXJzaW9uIChudWxsIHVudGlsIGEgbGF0ZXIgY2hhbmdlIHBvcHVsYXRlcyBpdCkuICovXG4gIHNlcnZlclZlcnNpb24/OiBzdHJpbmcgfCBudWxsO1xuICAvKiogQ2xpZW50LXNpZGUgc2V0dGluZ3MgKG5vbmUgYXJlIHNlY3JldCBcdTIwMTQgYWxsIGZpZWxkcyByZW5kZXIgdmVyYmF0aW0pLiAqL1xuICBzZXR0aW5ncz86IFBsdWdpblN5bmNTZXR0aW5ncztcbiAgLyoqXG4gICAqIENvbmZsaWN0IHBhdGhzIGZvciB0aGUgc3VwcG9ydCBidW5kbGUsIGRlcml2ZWQgZnJvbVxuICAgKiBgY2xpZW50U3RhdHVzLmNvbmZsaWN0c2AgXHUyMDE0IFBBVEhTIE9OTFksIG5ldmVyIGZpbGUgY29udGVudC5cbiAgICovXG4gIHJlY2VudENvbmZsaWN0cz86IEFycmF5PHsgcGF0aDogc3RyaW5nIH0+O1xufVxuXG4vKiogVGhlIHByb3RvY29sIHZlcnNpb24gZnJvbSBjb3JlLCBzdXJmYWNlZCBmb3IgdGhlIGJ1bmRsZS9BYm91dCBzZWN0aW9uLiAqL1xuZXhwb3J0IGNvbnN0IFBST1RPQ09MX1ZFUlNJT04gPSBQcm90b2NvbFZlcnNpb247XG5cbi8qKiBUaGUgY29weWFibGUgZGlhZ25vc3RpY3MgYnVuZGxlIChwbGFpbiB0ZXh0LCBidWctcmVwb3J0IGZyaWVuZGx5KS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZERpYWdub3N0aWNzQnVuZGxlKGlucHV0OiBEaWFnbm9zdGljc0lucHV0KTogc3RyaW5nIHtcbiAgY29uc3Qgc3RhdHVzID0gaW5wdXQuY2xpZW50U3RhdHVzO1xuICBjb25zdCBsaW5lczogc3RyaW5nW10gPSBbXG4gICAgJ1ZhdWx0U3luYyBmb3IgQWdlbnRzIFx1MjAxNCBkaWFnbm9zdGljcycsXG4gICAgYFBsdWdpbiB2ZXJzaW9uOiAke2lucHV0LnBsdWdpblZlcnNpb259YCxcbiAgICBgUHJvdG9jb2wgdmVyc2lvbjogJHtQcm90b2NvbFZlcnNpb259YCxcbiAgICBgRGV2aWNlOiAke2lucHV0LmRldmljZUlkIHx8ICcodW5hc3NpZ25lZCknfSR7aW5wdXQuZGV2aWNlTmFtZSA/IGAgKCR7aW5wdXQuZGV2aWNlTmFtZX0pYCA6ICcnfWAsXG4gICAgYFdvcmtlcjogJHtpbnB1dC53b3JrZXJVcmwgfHwgJyhub3QgY29uZmlndXJlZCknfWAsXG4gICAgYFBhaXJpbmc6ICR7aW5wdXQucGFpcmVkID8gJ3BhaXJlZCcgOiAnbm90IHBhaXJlZCd9YCxcbiAgICBpbnB1dC5wYXVzZWRcbiAgICAgID8gJ1N5bmM6IHBhdXNlZCdcbiAgICAgIDogc3RhdHVzID09PSBudWxsXG4gICAgICAgID8gJ1N5bmM6IG5vdCBydW5uaW5nJ1xuICAgICAgICA6IGBTeW5jOiAke3N0YXR1cy5zdGF0ZX0sIGxhc3Qgc3luYyAke1xuICAgICAgICAgICAgc3RhdHVzLmxhc3RTeW5jQXQgPT09IG51bGwgPyAnbmV2ZXInIDogYCR7TWF0aC5tYXgoMCwgRGF0ZS5ub3coKSAtIHN0YXR1cy5sYXN0U3luY0F0KX1tcyBhZ29gXG4gICAgICAgICAgfSwgcGVuZGluZyAke3N0YXR1cy5wZW5kaW5nfSwgY29uZmxpY3RzICR7c3RhdHVzLmNvbmZsaWN0cy5sZW5ndGh9YCxcbiAgICBgUGxhdGZvcm06ICR7cGxhdGZvcm1TdW1tYXJ5KCl9YCxcbiAgICBgUmVjZW50IGxvZyAobGFzdCAke2lucHV0LnJlY2VudExvZ0xpbmVzLmxlbmd0aH0gbGluZXMpOmAsXG4gIF07XG4gIGlmIChpbnB1dC5yZWNlbnRMb2dMaW5lcy5sZW5ndGggPT09IDApIHtcbiAgICBsaW5lcy5wdXNoKCcgIChubyByZWNvcmRlZCBsb2cgbGluZXMpJyk7XG4gIH0gZWxzZSB7XG4gICAgZm9yIChjb25zdCBsaW5lIG9mIGlucHV0LnJlY2VudExvZ0xpbmVzKSBsaW5lcy5wdXNoKGAgICR7bGluZX1gKTtcbiAgfVxuICByZXR1cm4gbGluZXMuam9pbignXFxuJyk7XG59XG5cbi8qKiBFcG9jaCBtcyBcdTIxOTIgYDIwMjYwODIxLTE0MzAwNWAgKGxvY2FsIHRpbWUpIGZvciBzdXBwb3J0LWJ1bmRsZSBmaWxlIG5hbWVzLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdFN1cHBvcnRCdW5kbGVTdGFtcChub3c6IG51bWJlcik6IHN0cmluZyB7XG4gIGNvbnN0IGQgPSBuZXcgRGF0ZShub3cpO1xuICBjb25zdCB0d28gPSAobjogbnVtYmVyKTogc3RyaW5nID0+IFN0cmluZyhuKS5wYWRTdGFydCgyLCAnMCcpO1xuICByZXR1cm4gKFxuICAgIGAke2QuZ2V0RnVsbFllYXIoKX0ke3R3byhkLmdldE1vbnRoKCkgKyAxKX0ke3R3byhkLmdldERhdGUoKSl9YCArXG4gICAgYC0ke3R3byhkLmdldEhvdXJzKCkpfSR7dHdvKGQuZ2V0TWludXRlcygpKX0ke3R3byhkLmdldFNlY29uZHMoKSl9YFxuICApO1xufVxuXG5jb25zdCBvbk9mZiA9ICh2YWx1ZTogYm9vbGVhbik6IHN0cmluZyA9PiAodmFsdWUgPyAnb24nIDogJ29mZicpO1xuXG4vKipcbiAqIFRoZSBcIlNhdmUgc3VwcG9ydCBidW5kbGVcIiBtYXJrZG93bi4gUmVkYWN0aW9uIGNvbnRyYWN0OiB0aGUgZGV2aWNlIHRva2VuXG4gKiBuZXZlciBhcHBlYXJzICh0aGUgaW5wdXQgc3RydWN0dXJhbGx5IGNhbm5vdCBjYXJyeSBpdCksIGFuZCBmaWxlc1xuICogY29udHJpYnV0ZSB2YXVsdC1yZWxhdGl2ZSBQQVRIUyBPTkxZIFx1MjAxNCBuZXZlciBjb250ZW50LlxuICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRTdXBwb3J0QnVuZGxlKGlucHV0OiBEaWFnbm9zdGljc0lucHV0LCBub3c6IG51bWJlcik6IHN0cmluZyB7XG4gIGNvbnN0IHN0YXR1cyA9IGlucHV0LmNsaWVudFN0YXR1cztcbiAgLy8gQ29uZmxpY3RzIHJlbmRlciBhcyBwYXRocyBvbmx5OyBgcmVjZW50Q29uZmxpY3RzYCAocHJlLXJlZGFjdGVkIGJ5IHRoZVxuICAvLyBjYWxsZXIpIHdpbnMgd2hlbiBwcmVzZW50LCBlbHNlIHBhdGhzIGFyZSBkZXJpdmVkIGZyb20gdGhlIHN0YXR1cy5cbiAgY29uc3QgY29uZmxpY3RQYXRocyA9XG4gICAgaW5wdXQucmVjZW50Q29uZmxpY3RzPy5tYXAoKGMpID0+IGMucGF0aCkgPz8gc3RhdHVzPy5jb25mbGljdHMubWFwKChjKSA9PiBjLnBhdGgpID8/IFtdO1xuXG4gIGNvbnN0IGxpbmVzOiBzdHJpbmdbXSA9IFtcbiAgICAnIyBWYXVsdFN5bmMgZm9yIEFnZW50cyBcdTIwMTQgc3VwcG9ydCBidW5kbGUnLFxuICAgICcnLFxuICAgIGBHZW5lcmF0ZWQ6ICR7bmV3IERhdGUobm93KS50b0lTT1N0cmluZygpfWAsXG4gICAgJycsXG4gICAgJyMjIFZlcnNpb25zJyxcbiAgICAnJyxcbiAgICBgLSBQbHVnaW46ICR7aW5wdXQucGx1Z2luVmVyc2lvbn1gLFxuICAgIGAtIFByb3RvY29sOiAke1Byb3RvY29sVmVyc2lvbn1gLFxuICAgIGAtIFNlcnZlcjogJHtpbnB1dC5zZXJ2ZXJWZXJzaW9uID8/ICd1bmtub3duJ31gLFxuICAgIGAtIFBsYXRmb3JtOiAke3BsYXRmb3JtU3VtbWFyeSgpfWAsXG4gICAgJycsXG4gICAgJyMjIENvbm5lY3Rpb24nLFxuICAgICcnLFxuICAgIGAtIFdvcmtlciBVUkw6ICR7aW5wdXQud29ya2VyVXJsIHx8ICcobm90IGNvbmZpZ3VyZWQpJ31gLFxuICAgIGAtIERldmljZSBJRDogJHtpbnB1dC5kZXZpY2VJZCB8fCAnKHVuYXNzaWduZWQpJ31gLFxuICAgIGAtIERldmljZSBuYW1lOiAke2lucHV0LmRldmljZU5hbWUgfHwgJyhkZWZhdWx0KSd9YCxcbiAgICBgLSBQYWlyaW5nOiAke2lucHV0LnBhaXJlZCA/ICdwYWlyZWQnIDogJ25vdCBwYWlyZWQnfWAsXG4gICAgYC0gU3luY2luZzogJHtpbnB1dC5wYXVzZWQgPyAncGF1c2VkJyA6ICdhY3RpdmUnfWAsXG4gIF07XG5cbiAgaWYgKGlucHV0LnNldHRpbmdzICE9PSB1bmRlZmluZWQpIHtcbiAgICBjb25zdCB7IHNldHRpbmdzIH0gPSBpbnB1dDtcbiAgICBjb25zdCBwYXR0ZXJucyA9IHNldHRpbmdzLmlnbm9yZVBhdHRlcm5zXG4gICAgICAuc3BsaXQoL1xccj9cXG4vKVxuICAgICAgLm1hcCgobGluZSkgPT4gbGluZS50cmltKCkpXG4gICAgICAuZmlsdGVyKChsaW5lKSA9PiBsaW5lICE9PSAnJyk7XG4gICAgbGluZXMucHVzaCgnJywgJyMjIFNldHRpbmdzJywgJycsIGAtIFJlc2NhbiBpbnRlcnZhbDogJHtzZXR0aW5ncy5yZXNjYW5JbnRlcnZhbFNlYyA9PT0gMCA/ICdvZmYnIDogYCR7c2V0dGluZ3MucmVzY2FuSW50ZXJ2YWxTZWN9IHNlY29uZHNgfWAsIGAtIFN5bmMgLm9ic2lkaWFuLyBmb2xkZXI6ICR7b25PZmYoc2V0dGluZ3Mub2JzaWRpYW5TeW5jKX1gLCBgLSBTdGF0dXMgYmFyIGluZGljYXRvcjogJHtzZXR0aW5ncy5zdGF0dXNCYXJNb2RlfWAsIGAtIFN5bmMgb24gc3RhcnR1cDogJHtvbk9mZihzZXR0aW5ncy5zeW5jT25TdGFydHVwKX1gLCBgLSBEaWFnbm9zdGljcyBsb2cgbGV2ZWw6ICR7c2V0dGluZ3MubG9nTGV2ZWx9YCk7XG4gICAgaWYgKHBhdHRlcm5zLmxlbmd0aCA9PT0gMCkge1xuICAgICAgbGluZXMucHVzaCgnLSBJZ25vcmUgcGF0dGVybnM6IChub25lKScpO1xuICAgIH0gZWxzZSB7XG4gICAgICBsaW5lcy5wdXNoKCctIElnbm9yZSBwYXR0ZXJuczonKTtcbiAgICAgIGZvciAoY29uc3QgcGF0dGVybiBvZiBwYXR0ZXJucykgbGluZXMucHVzaChgICAke3BhdHRlcm59YCk7XG4gICAgfVxuICB9XG5cbiAgbGluZXMucHVzaCgnJywgJyMjIFN5bmMgc3RhdGUnLCAnJyk7XG4gIGlmIChpbnB1dC5wYXVzZWQpIGxpbmVzLnB1c2goJy0gU3RhdGU6IHBhdXNlZCcpO1xuICBlbHNlIGlmIChzdGF0dXMgPT09IG51bGwpIGxpbmVzLnB1c2goJy0gU3RhdGU6IG5vdCBydW5uaW5nJyk7XG4gIGVsc2UgbGluZXMucHVzaChgLSBTdGF0ZTogJHtzdGF0dXMuc3RhdGV9YCk7XG4gIGlmIChzdGF0dXMgIT09IG51bGwpIHtcbiAgICBsaW5lcy5wdXNoKFxuICAgICAgYC0gTGFzdCBzeW5jOiAke3N0YXR1cy5sYXN0U3luY0F0ID09PSBudWxsID8gJ25ldmVyJyA6IG5ldyBEYXRlKHN0YXR1cy5sYXN0U3luY0F0KS50b0lTT1N0cmluZygpfWAsXG4gICAgICBgLSBQZW5kaW5nIGNoYW5nZXM6ICR7c3RhdHVzLnBlbmRpbmd9YCxcbiAgICAgIGAtIENvbmZsaWN0czogJHtjb25mbGljdFBhdGhzLmxlbmd0aH1gLFxuICAgICk7XG4gICAgZm9yIChjb25zdCBwYXRoIG9mIGNvbmZsaWN0UGF0aHMpIGxpbmVzLnB1c2goYCAgLSAke3BhdGh9YCk7XG4gICAgY29uc3QgY29sbGlzaW9ucyA9IHN0YXR1cy5jYXNlQ29sbGlzaW9ucyA/PyBbXTtcbiAgICBpZiAoY29sbGlzaW9ucy5sZW5ndGggPiAwKSB7XG4gICAgICBsaW5lcy5wdXNoKGAtIENhc2UtY29sbGlkaW5nIHBhdGhzIChpbnZpc2libGUgdHdpbiBvbiB0aGlzIGZpbGVzeXN0ZW0pOiAke2NvbGxpc2lvbnMubGVuZ3RofWApO1xuICAgICAgZm9yIChjb25zdCBwYXRoIG9mIGNvbGxpc2lvbnMpIGxpbmVzLnB1c2goYCAgLSAke3BhdGh9YCk7XG4gICAgfVxuICAgIGlmIChzdGF0dXMucHJvZ3Jlc3MgIT09IHVuZGVmaW5lZCkge1xuICAgICAgbGluZXMucHVzaChgLSBQcm9ncmVzczogJHtzdGF0dXMucHJvZ3Jlc3MucGhhc2V9ICR7c3RhdHVzLnByb2dyZXNzLmRvbmV9LyR7c3RhdHVzLnByb2dyZXNzLnRvdGFsfWApO1xuICAgIH1cbiAgfVxuXG4gIGxpbmVzLnB1c2goJycsIGAjIyBSZWNlbnQgbG9nIChsYXN0ICR7aW5wdXQucmVjZW50TG9nTGluZXMubGVuZ3RofSBsaW5lcylgLCAnJyk7XG4gIGlmIChpbnB1dC5yZWNlbnRMb2dMaW5lcy5sZW5ndGggPT09IDApIHtcbiAgICBsaW5lcy5wdXNoKCcobm8gcmVjb3JkZWQgbG9nIGxpbmVzKScpO1xuICB9IGVsc2Uge1xuICAgIGxpbmVzLnB1c2goJ2BgYHRleHQnKTtcbiAgICBsaW5lcy5wdXNoKC4uLmlucHV0LnJlY2VudExvZ0xpbmVzKTtcbiAgICBsaW5lcy5wdXNoKCdgYGAnKTtcbiAgfVxuICByZXR1cm4gYCR7bGluZXMuam9pbignXFxuJyl9XFxuYDtcbn1cblxuLyoqIEh1bWFuIHBsYXRmb3JtIHN1bW1hcnkgZnJvbSBgUGxhdGZvcm1gIChtb2JpbGUgdnMgZGVza3RvcCwgT1MsIGZvcm0gZmFjdG9yKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwbGF0Zm9ybVN1bW1hcnkoKTogc3RyaW5nIHtcbiAgaWYgKFBsYXRmb3JtLmlzTW9iaWxlQXBwKSB7XG4gICAgY29uc3Qgb3MgPSBQbGF0Zm9ybS5pc0lvc0FwcCA/ICdpT1MnIDogUGxhdGZvcm0uaXNBbmRyb2lkQXBwID8gJ0FuZHJvaWQnIDogJ3Vua25vd24gT1MnO1xuICAgIGNvbnN0IGZhY3RvciA9IFBsYXRmb3JtLmlzVGFibGV0ID8gJ3RhYmxldCcgOiBQbGF0Zm9ybS5pc1Bob25lID8gJ3Bob25lJyA6ICdkZXZpY2UnO1xuICAgIHJldHVybiBgT2JzaWRpYW4gbW9iaWxlIGFwcCAoJHtvc30sICR7ZmFjdG9yfSlgO1xuICB9XG4gIHJldHVybiAnT2JzaWRpYW4gZGVza3RvcCBhcHAnO1xufVxuXG4vKiogQmVzdC1lZmZvcnQgY2xpcGJvYXJkIHdyaXRlOyByZXNvbHZlcyBmYWxzZSB3aGVyZSB0aGUgY2xpcGJvYXJkIGlzIHVuYXZhaWxhYmxlLiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNvcHlUb0NsaXBib2FyZCh0ZXh0OiBzdHJpbmcpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgY29uc3QgY2xpcGJvYXJkID0gKGdsb2JhbFRoaXMgYXMgeyBuYXZpZ2F0b3I/OiB7IGNsaXBib2FyZD86IHsgd3JpdGVUZXh0Pyh0OiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IH0gfSB9KVxuICAgIC5uYXZpZ2F0b3I/LmNsaXBib2FyZDtcbiAgaWYgKGNsaXBib2FyZD8ud3JpdGVUZXh0ID09PSB1bmRlZmluZWQpIHJldHVybiBmYWxzZTtcbiAgdHJ5IHtcbiAgICBhd2FpdCBjbGlwYm9hcmQud3JpdGVUZXh0KHRleHQpO1xuICAgIHJldHVybiB0cnVlO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuLyoqIEJ5dGVzIFx1MjE5MiBodW1hbiB0ZXh0IChgNzMwIEJgLCBgMS4yIE1CYCkuICovXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0Qnl0ZXMoYnl0ZXM6IG51bWJlcik6IHN0cmluZyB7XG4gIGlmIChieXRlcyA8IDEwMjQpIHJldHVybiBgJHtieXRlc30gQmA7XG4gIGNvbnN0IHVuaXRzID0gWydLQicsICdNQicsICdHQicsICdUQiddO1xuICBsZXQgdmFsdWUgPSBieXRlcztcbiAgbGV0IHVuaXQgPSAtMTtcbiAgZG8ge1xuICAgIHZhbHVlIC89IDEwMjQ7XG4gICAgdW5pdCArPSAxO1xuICB9IHdoaWxlICh2YWx1ZSA+PSAxMDI0ICYmIHVuaXQgPCB1bml0cy5sZW5ndGggLSAxKTtcbiAgcmV0dXJuIGAke3ZhbHVlID49IDEwMCA/IE1hdGgucm91bmQodmFsdWUpIDogdmFsdWUudG9GaXhlZCgxKX0gJHt1bml0c1t1bml0XX1gO1xufVxuIiwgIi8qKlxuICogVGhlIHBsdWdpbidzIHBlcnNpc3RlZCBzdGF0ZSAoYGRhdGEuanNvbmAsIHZpYSBgUGx1Z2luLmxvYWREYXRhL3NhdmVEYXRhYCkuXG4gKlxuICogS2VwdCBkZWxpYmVyYXRlbHkgc21hbGw6IGxpbmsgaWRlbnRpdHkgKHVybC90b2tlbi9kZXZpY2VJZC9kZXZpY2VOYW1lKSBwbHVzXG4gKiB0aGUgdHdvIGNsaWVudC1zaWRlIHRvZ2dsZXMuIFRoZSB0b2tlbiBpcyB0aGUgZGV2aWNlJ3MgbG9uZy1saXZlZFxuICogY3JlZGVudGlhbCAoQVJDSElURUNUVVJFIFx1MDBBNzMpIFx1MjAxNCBPYnNpZGlhbiBzdG9yZXMgZGF0YS5qc29uIGluc2lkZSB0aGUgdmF1bHQnc1xuICogYC5vYnNpZGlhbi9wbHVnaW5zL2AgZGlyLCB3aGljaCBzeW5jIGV4Y2x1ZGVzLCBzbyBpdCBuZXZlciBsZWF2ZXMgdGhlXG4gKiBtYWNoaW5lIHRocm91Z2ggc3luYyBpdHNlbGYuXG4gKi9cblxuaW1wb3J0IHsgUGxhdGZvcm0gfSBmcm9tICdvYnNpZGlhbic7XG5pbXBvcnQgdHlwZSB7IFN0YXR1c0Jhck1vZGUgfSBmcm9tICcuL3N0YXR1c2Jhci5qcyc7XG5cbi8qKiBEaWFnbm9zdGljcyBsb2cgbGV2ZWwgKHRoZSBcIkRpYWdub3N0aWNzXCIgc2V0dGluZ3MgZHJvcGRvd24pLiAqL1xuZXhwb3J0IHR5cGUgTG9nTGV2ZWwgPSAnaW5mbycgfCAnZGVidWcnIHwgJ3dhcm4nO1xuXG4vKiogQ2xpZW50LXNpZGUgc3luYyBiZWhhdmlvciBzZXR0aW5ncyAodGhlIHNldHRpbmdzLXRhYiB0b2dnbGVzKS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUGx1Z2luU3luY1NldHRpbmdzIHtcbiAgLyoqXG4gICAqIFBlcmlvZGljIGZ1bGwtcmVzY2FuIGludGVydmFsIGluIHNlY29uZHMgKEFSQ0hJVEVDVFVSRSBcdTAwQTc4IG1vYmlsZSAvXG4gICAqIGV4dGVybmFsIGVkaXRzKS4gYDBgIGRpc2FibGVzIHRoZSB0aW1lciBcdTIwMTQgdmF1bHQgZXZlbnRzIGFuZCBhcHAtb3BlblxuICAgKiByZWNvbmNpbGlhdGlvbiBzdGlsbCBydW4uXG4gICAqL1xuICByZXNjYW5JbnRlcnZhbFNlYzogbnVtYmVyO1xuICAvKipcbiAgICogT3B0IGluIHRvIHN5bmNpbmcgYC5vYnNpZGlhbi9gIChGUi0xMSkuIFRoaXMgaXMgdGhlIGNsaWVudC1zaWRlIGluaXRpYWxcbiAgICogaWdub3JlIHNldHRpbmc7IHRoZSB3b3JrZXIncyBwZXItdmF1bHQgYFZhdWx0U2V0dGluZ3Mub2JzaWRpYW5TeW5jYFxuICAgKiAoZGVsaXZlcmVkIGluIGBoZWxsb0Fja2ApIHN1cGVyc2VkZXMgaXQgb25jZSBjb25uZWN0ZWQuXG4gICAqL1xuICBvYnNpZGlhblN5bmM6IGJvb2xlYW47XG4gIC8qKiBTdGF0dXMtYmFyIGluZGljYXRvcjogZnVsbCB0ZXh0LCBhIGNvbXBhY3Qgc3ltYm9sLCBvciBubyBpdGVtIGF0IGFsbC4gKi9cbiAgc3RhdHVzQmFyTW9kZTogU3RhdHVzQmFyTW9kZTtcbiAgLyoqXG4gICAqIFN0YXJ0IHN5bmNpbmcgd2hlbiBPYnNpZGlhbiBsb2FkcyAoZGVmYXVsdCkuIE9GRiA9IG1hbnVhbC1vbmx5IG1vZGU6IHRoZVxuICAgKiBwbHVnaW4gbG9hZHMgaWRsZSBhbmQgdGhlIGZpcnN0IFwiU3luYyBub3dcIiBzdGFydHMgaXQuXG4gICAqL1xuICBzeW5jT25TdGFydHVwOiBib29sZWFuO1xuICAvKiogRGlhZ25vc3RpY3MgbG9nIGxldmVsOyBgZGVidWdgIGFsc28gbG9ncyBwcm90b2NvbCByb3VuZC10cmlwcy4gKi9cbiAgbG9nTGV2ZWw6IExvZ0xldmVsO1xuICAvKiogUmF3IGlnbm9yZS1wYXR0ZXJuIHRleHQsIG9uZSBwYXR0ZXJuIHBlciBsaW5lIChzZWUgYHBhcnNlSWdub3JlUGF0dGVybnNgKS4gKi9cbiAgaWdub3JlUGF0dGVybnM6IHN0cmluZztcbn1cblxuLyoqIFNoYXBlIG9mIHRoZSBwbHVnaW4ncyBgZGF0YS5qc29uYC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVmF1bHRTeW5jUGx1Z2luRGF0YSB7XG4gIC8qKiBXb3JrZXIgb3JpZ2luLCBlLmcuIGBodHRwczovL3BlcnNvbmFsLngud29ya2Vycy5kZXZgIChlbXB0eSBwcmUtcGFpcikuICovXG4gIHVybDogc3RyaW5nO1xuICAvKiogTG9uZy1saXZlZCBkZXZpY2UgdG9rZW4gKGVtcHR5IHByZS1wYWlyKS4gKi9cbiAgdG9rZW46IHN0cmluZztcbiAgLyoqIERldmljZSBpZCBhc3NpZ25lZCBieSB0aGUgd29ya2VyIGF0IHBhaXIgdGltZS4gKi9cbiAgZGV2aWNlSWQ6IHN0cmluZztcbiAgLyoqIEh1bWFuLXJlYWRhYmxlIGRldmljZSBuYW1lIHNob3duIGluIHRoZSBkYXNoYm9hcmQncyBkZXZpY2UgbGlzdC4gKi9cbiAgZGV2aWNlTmFtZTogc3RyaW5nO1xuICBzZXR0aW5nczogUGx1Z2luU3luY1NldHRpbmdzO1xufVxuXG5leHBvcnQgY29uc3QgREVGQVVMVF9SRVNDQU5fSU5URVJWQUxfU0VDID0gMzA7XG5cbi8qKiBDaG9pY2VzIG9mZmVyZWQgYnkgdGhlIHNldHRpbmdzIGRyb3Bkb3duOiBzZWNvbmRzIFx1MjE5MiBsYWJlbC4gKi9cbmV4cG9ydCBjb25zdCBSRVNDQU5fSU5URVJWQUxfQ0hPSUNFUzogUmVhZG9ubHlBcnJheTx7IHZhbHVlOiBudW1iZXI7IGxhYmVsOiBzdHJpbmcgfT4gPSBbXG4gIHsgdmFsdWU6IDEwLCBsYWJlbDogJ0V2ZXJ5IDEwIHNlY29uZHMnIH0sXG4gIHsgdmFsdWU6IDMwLCBsYWJlbDogJ0V2ZXJ5IDMwIHNlY29uZHMnIH0sXG4gIHsgdmFsdWU6IDYwLCBsYWJlbDogJ0V2ZXJ5IG1pbnV0ZScgfSxcbiAgeyB2YWx1ZTogMzAwLCBsYWJlbDogJ0V2ZXJ5IDUgbWludXRlcycgfSxcbiAgeyB2YWx1ZTogMCwgbGFiZWw6ICdPZmYgKHZhdWx0IGV2ZW50cyBvbmx5KScgfSxcbl07XG5cbmV4cG9ydCBmdW5jdGlvbiBkZWZhdWx0UGx1Z2luRGF0YSgpOiBWYXVsdFN5bmNQbHVnaW5EYXRhIHtcbiAgcmV0dXJuIHtcbiAgICB1cmw6ICcnLFxuICAgIHRva2VuOiAnJyxcbiAgICBkZXZpY2VJZDogJycsXG4gICAgZGV2aWNlTmFtZTogJycsXG4gICAgc2V0dGluZ3M6IHtcbiAgICAgIHJlc2NhbkludGVydmFsU2VjOiBERUZBVUxUX1JFU0NBTl9JTlRFUlZBTF9TRUMsXG4gICAgICBvYnNpZGlhblN5bmM6IGZhbHNlLFxuICAgICAgc3RhdHVzQmFyTW9kZTogJ2RldGFpbGVkJyxcbiAgICAgIHN5bmNPblN0YXJ0dXA6IHRydWUsXG4gICAgICBsb2dMZXZlbDogJ2luZm8nLFxuICAgICAgaWdub3JlUGF0dGVybnM6ICcnLFxuICAgIH0sXG4gIH07XG59XG5cbi8qKiBDb2VyY2Ugd2hhdGV2ZXIgYGxvYWREYXRhKClgIHJldHVybmVkIGludG8gYSB3ZWxsLWZvcm1lZCBvYmplY3QuICovXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplUGx1Z2luRGF0YShyYXc6IHVua25vd24pOiBWYXVsdFN5bmNQbHVnaW5EYXRhIHtcbiAgY29uc3QgYmFzZSA9IGRlZmF1bHRQbHVnaW5EYXRhKCk7XG4gIGlmICh0eXBlb2YgcmF3ICE9PSAnb2JqZWN0JyB8fCByYXcgPT09IG51bGwpIHJldHVybiBiYXNlO1xuICBjb25zdCBzb3VyY2UgPSByYXcgYXMgUGFydGlhbDxWYXVsdFN5bmNQbHVnaW5EYXRhPiAmIHsgc2V0dGluZ3M/OiBQYXJ0aWFsPFBsdWdpblN5bmNTZXR0aW5ncz4gfTtcbiAgY29uc3Qgc3RhdHVzQmFyTW9kZSA9IHNvdXJjZS5zZXR0aW5ncz8uc3RhdHVzQmFyTW9kZTtcbiAgY29uc3QgbG9nTGV2ZWwgPSBzb3VyY2Uuc2V0dGluZ3M/LmxvZ0xldmVsO1xuICByZXR1cm4ge1xuICAgIHVybDogdHlwZW9mIHNvdXJjZS51cmwgPT09ICdzdHJpbmcnID8gc291cmNlLnVybCA6ICcnLFxuICAgIHRva2VuOiB0eXBlb2Ygc291cmNlLnRva2VuID09PSAnc3RyaW5nJyA/IHNvdXJjZS50b2tlbiA6ICcnLFxuICAgIGRldmljZUlkOiB0eXBlb2Ygc291cmNlLmRldmljZUlkID09PSAnc3RyaW5nJyA/IHNvdXJjZS5kZXZpY2VJZCA6ICcnLFxuICAgIGRldmljZU5hbWU6IHR5cGVvZiBzb3VyY2UuZGV2aWNlTmFtZSA9PT0gJ3N0cmluZycgPyBzb3VyY2UuZGV2aWNlTmFtZSA6ICcnLFxuICAgIHNldHRpbmdzOiB7XG4gICAgICByZXNjYW5JbnRlcnZhbFNlYzpcbiAgICAgICAgdHlwZW9mIHNvdXJjZS5zZXR0aW5ncz8ucmVzY2FuSW50ZXJ2YWxTZWMgPT09ICdudW1iZXInICYmIHNvdXJjZS5zZXR0aW5ncy5yZXNjYW5JbnRlcnZhbFNlYyA+PSAwXG4gICAgICAgICAgPyBNYXRoLmZsb29yKHNvdXJjZS5zZXR0aW5ncy5yZXNjYW5JbnRlcnZhbFNlYylcbiAgICAgICAgICA6IERFRkFVTFRfUkVTQ0FOX0lOVEVSVkFMX1NFQyxcbiAgICAgIG9ic2lkaWFuU3luYzogc291cmNlLnNldHRpbmdzPy5vYnNpZGlhblN5bmMgPT09IHRydWUsXG4gICAgICBzdGF0dXNCYXJNb2RlOlxuICAgICAgICBzdGF0dXNCYXJNb2RlID09PSAnY29tcGFjdCcgfHwgc3RhdHVzQmFyTW9kZSA9PT0gJ2hpZGRlbicgPyBzdGF0dXNCYXJNb2RlIDogJ2RldGFpbGVkJyxcbiAgICAgIHN5bmNPblN0YXJ0dXA6IHNvdXJjZS5zZXR0aW5ncz8uc3luY09uU3RhcnR1cCAhPT0gZmFsc2UsXG4gICAgICBsb2dMZXZlbDogbG9nTGV2ZWwgPT09ICdkZWJ1ZycgfHwgbG9nTGV2ZWwgPT09ICd3YXJuJyA/IGxvZ0xldmVsIDogJ2luZm8nLFxuICAgICAgaWdub3JlUGF0dGVybnM6IHR5cGVvZiBzb3VyY2Uuc2V0dGluZ3M/Lmlnbm9yZVBhdHRlcm5zID09PSAnc3RyaW5nJyA/IHNvdXJjZS5zZXR0aW5ncy5pZ25vcmVQYXR0ZXJucyA6ICcnLFxuICAgIH0sXG4gIH07XG59XG5cbi8qKlxuICogSWdub3JlLXBhdHRlcm4gdGV4dCBcdTIxOTIgcGF0dGVybiBsaXN0OiBvbmUgcGF0dGVybiBwZXIgbGluZSwgdHJpbW1lZCwgYmxhbmtcbiAqIGxpbmVzIGRyb3BwZWQuIFB1cmUgXHUyMDE0IHNhZmUgdG8gY2FsbCBvbiBldmVyeSBgc3RhcnRTeW5jYC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlSWdub3JlUGF0dGVybnModGV4dDogc3RyaW5nKTogc3RyaW5nW10ge1xuICByZXR1cm4gdGV4dFxuICAgIC5zcGxpdCgvXFxyP1xcbi8pXG4gICAgLm1hcCgobGluZSkgPT4gbGluZS50cmltKCkpXG4gICAgLmZpbHRlcigobGluZSkgPT4gbGluZSAhPT0gJycpO1xufVxuXG4vKiogQSB2YXVsdCBpcyBsaW5rZWQgaWZmIHBhaXIgaWRlbnRpdHkgaXMgY29tcGxldGUuICovXG5leHBvcnQgZnVuY3Rpb24gaXNMaW5rZWQoZGF0YTogVmF1bHRTeW5jUGx1Z2luRGF0YSk6IGJvb2xlYW4ge1xuICByZXR1cm4gZGF0YS51cmwgIT09ICcnICYmIGRhdGEudG9rZW4gIT09ICcnICYmIGRhdGEuZGV2aWNlSWQgIT09ICcnO1xufVxuXG4vKiogRGV2aWNlIHR5cGUgZm9yIHRoZSB3b3JrZXIgcmVnaXN0cnksIGZyb20gdGhlIHBsYXRmb3JtIChGUi0yMykuICovXG5leHBvcnQgZnVuY3Rpb24gZGV0ZWN0RGV2aWNlVHlwZSgpOiAnZGVza3RvcCcgfCAnbW9iaWxlJyB7XG4gIHJldHVybiBQbGF0Zm9ybS5pc01vYmlsZUFwcCA/ICdtb2JpbGUnIDogJ2Rlc2t0b3AnO1xufVxuXG4vKiogRGVmYXVsdCBkZXZpY2UgbmFtZSB3aGVuIHRoZSB1c2VyIGhhcyBub3QgdHlwZWQgb25lLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRlZmF1bHREZXZpY2VOYW1lKCk6IHN0cmluZyB7XG4gIGlmIChQbGF0Zm9ybS5pc01vYmlsZUFwcCkge1xuICAgIGlmIChQbGF0Zm9ybS5pc0lvc0FwcCkgcmV0dXJuICdpUGhvbmUvaVBhZCc7XG4gICAgaWYgKFBsYXRmb3JtLmlzQW5kcm9pZEFwcCkgcmV0dXJuICdBbmRyb2lkJztcbiAgICByZXR1cm4gJ09ic2lkaWFuIG1vYmlsZSc7XG4gIH1cbiAgcmV0dXJuICdPYnNpZGlhbiBkZXNrdG9wJztcbn1cbiIsICIvKipcbiAqIE1pbmltYWwgdHlwZWQgY2xpZW50IGZvciB0aGUgd29ya2VyJ3MgSFRUUCBzdXJmYWNlIGFzIHRoZSBwbHVnaW4gdXNlcyBpdDpcbiAqIGBHRVQgL2hlYWx0aGAgKGNsYWltLXN0YXRlIHByb2JlIGJlZm9yZSBwYWlyaW5nKSwgYFBPU1QgL3BhaXJgIChyZWRlZW0gYVxuICogcGFpcmluZyBjb2RlLCBBUkNISVRFQ1RVUkUgXHUwMEE3MyksIGBQQVRDSCAvZGV2aWNlYCAoZGV2aWNlIHNlbGYtc2VydmljZVxuICogcmVuYW1lKSwgYW5kIGBHRVQgL2FwaS9zdGF0dXNgIChzdG9yYWdlL2RldmljZSBzdW1tYXJ5IGZvciBBYm91dCkuIEJ1aWx0XG4gKiBvbiBhbiBpbmplY3RhYmxlIGBmZXRjaGA7IGZhaWx1cmVzIG1hcCB0byB0eXBlZCBlcnJvcnMgd2l0aCBhY3Rpb25hYmxlXG4gKiBtZXNzYWdlcyBzbyB0aGUgc2V0dGluZ3MgVUkgYW5kIHRoZSBkZWVwLWxpbmsgaGFuZGxlciBuZXZlciBzZWUgYSByYXdcbiAqIGBUeXBlRXJyb3I6IEZhaWxlZCB0byBmZXRjaGAuXG4gKi9cblxuLyoqIEEgd29ya2VyIGNhbGwgZmFpbGVkICh1bnJlYWNoYWJsZSBvciB1bmV4cGVjdGVkIEhUVFApLiAqL1xuZXhwb3J0IGNsYXNzIFdvcmtlckFwaUVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBjb25zdHJ1Y3RvcihcbiAgICBtZXNzYWdlOiBzdHJpbmcsXG4gICAgcmVhZG9ubHkgc3RhdHVzPzogbnVtYmVyLFxuICApIHtcbiAgICBzdXBlcihtZXNzYWdlKTtcbiAgICB0aGlzLm5hbWUgPSAnV29ya2VyQXBpRXJyb3InO1xuICB9XG59XG5cbi8qKiBUaGUgcGFpcmluZyBjb2RlIHdhcyByZWplY3RlZCAoaW52YWxpZCAvIGV4cGlyZWQgLyBhbHJlYWR5IHVzZWQpLiAqL1xuZXhwb3J0IGNsYXNzIFBhaXJSZWplY3RlZEVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBjb25zdHJ1Y3RvcihtZXNzYWdlOiBzdHJpbmcpIHtcbiAgICBzdXBlcihtZXNzYWdlKTtcbiAgICB0aGlzLm5hbWUgPSAnUGFpclJlamVjdGVkRXJyb3InO1xuICB9XG59XG5cbi8qKiBUaGUgd29ya2VyIGV4aXN0cyBidXQgaGFzIG5vdCBiZWVuIGNsYWltZWQgeWV0IChIVFRQIDQyMSBzZW1hbnRpY3MpLiAqL1xuZXhwb3J0IGNsYXNzIFVuY2xhaW1lZFdvcmtlckVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBjb25zdHJ1Y3RvcihtZXNzYWdlOiBzdHJpbmcpIHtcbiAgICBzdXBlcihtZXNzYWdlKTtcbiAgICB0aGlzLm5hbWUgPSAnVW5jbGFpbWVkV29ya2VyRXJyb3InO1xuICB9XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgSGVhbHRoSW5mbyB7XG4gIHJlYWNoYWJsZTogYm9vbGVhbjtcbiAgY2xhaW1lZDogYm9vbGVhbjtcbiAgLyoqIEh1bWFuLXJlYWRhYmxlIHJlYXNvbiB3aGVuIHRoZSB3b3JrZXIgY291bGQgbm90IGJlIHJlYWNoZWQuICovXG4gIHJlYXNvbj86IHN0cmluZztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBQYWlyQ3JlZGVudGlhbHMge1xuICB0b2tlbjogc3RyaW5nO1xuICBkZXZpY2VJZDogc3RyaW5nO1xufVxuXG4vKipcbiAqIE5vcm1hbGl6ZSB1c2VyIGlucHV0IGludG8gYSB3b3JrZXIgb3JpZ2luOiB0cmltcywgdG9sZXJhdGVzIGEgbWlzc2luZ1xuICogc2NoZW1lIChhc3N1bWVzIGh0dHBzKSwgYSB0cmFpbGluZyBzbGFzaCwgYW5kIHN0cmF5IHBhdGggY29tcG9uZW50cztcbiAqIHJldHVybnMgYGh0dHBzOi8vaG9zdGAgc3R5bGUgb3JpZ2luLiBUaHJvd3MgYFdvcmtlckFwaUVycm9yYCBvbiBnYXJiYWdlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplV29ya2VyVXJsKGlucHV0OiBzdHJpbmcpOiBzdHJpbmcge1xuICBsZXQgY2FuZGlkYXRlID0gaW5wdXQudHJpbSgpO1xuICBpZiAoY2FuZGlkYXRlID09PSAnJykgdGhyb3cgbmV3IFdvcmtlckFwaUVycm9yKCd3b3JrZXIgVVJMIGlzIGVtcHR5Jyk7XG4gIGlmICghL15bYS16QS1aXVthLXpBLVowLTkrLi1dKjpcXC9cXC8vLnRlc3QoY2FuZGlkYXRlKSkgY2FuZGlkYXRlID0gYGh0dHBzOi8vJHtjYW5kaWRhdGV9YDtcbiAgbGV0IG9yaWdpbjogc3RyaW5nO1xuICB0cnkge1xuICAgIG9yaWdpbiA9IG5ldyBVUkwoY2FuZGlkYXRlKS5vcmlnaW47XG4gIH0gY2F0Y2gge1xuICAgIHRocm93IG5ldyBXb3JrZXJBcGlFcnJvcihgaW52YWxpZCB3b3JrZXIgVVJMOiAke0pTT04uc3RyaW5naWZ5KGlucHV0KX1gKTtcbiAgfVxuICBpZiAoIW9yaWdpbi5zdGFydHNXaXRoKCdodHRwOi8vJykgJiYgIW9yaWdpbi5zdGFydHNXaXRoKCdodHRwczovLycpKSB7XG4gICAgdGhyb3cgbmV3IFdvcmtlckFwaUVycm9yKGB3b3JrZXIgVVJMIG11c3QgYmUgaHR0cChzKSwgZ290ICR7b3JpZ2lufWApO1xuICB9XG4gIHJldHVybiBvcmlnaW47XG59XG5cbi8qKiBHRVQgL2hlYWx0aCBcdTIwMTQgbmV2ZXIgdGhyb3dzIGZvciByZWFjaGFiaWxpdHk7IHJlcG9ydHMgY2xhaW0gc3RhdGUgaW5zdGVhZC4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBmZXRjaEhlYWx0aChcbiAgb3JpZ2luOiBzdHJpbmcsXG4gIGZldGNoSW1wbDogdHlwZW9mIGZldGNoLFxuKTogUHJvbWlzZTxIZWFsdGhJbmZvPiB7XG4gIGxldCByZXNwb25zZTogUmVzcG9uc2U7XG4gIHRyeSB7XG4gICAgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaEltcGwoYCR7b3JpZ2lufS9oZWFsdGhgKTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICByZXR1cm4ge1xuICAgICAgcmVhY2hhYmxlOiBmYWxzZSxcbiAgICAgIGNsYWltZWQ6IGZhbHNlLFxuICAgICAgcmVhc29uOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvciksXG4gICAgfTtcbiAgfVxuICBpZiAoIXJlc3BvbnNlLm9rKSB7XG4gICAgcmV0dXJuIHsgcmVhY2hhYmxlOiBmYWxzZSwgY2xhaW1lZDogZmFsc2UsIHJlYXNvbjogYEhUVFAgJHtyZXNwb25zZS5zdGF0dXN9YCB9O1xuICB9XG4gIGNvbnN0IGJvZHkgPSAoYXdhaXQgcmVzcG9uc2UuanNvbigpLmNhdGNoKCgpID0+ICh7fSkpKSBhcyB7IGNsYWltZWQ/OiBib29sZWFuIH07XG4gIHJldHVybiB7IHJlYWNoYWJsZTogdHJ1ZSwgY2xhaW1lZDogYm9keS5jbGFpbWVkID09PSB0cnVlIH07XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUGFpclJlcXVlc3RQYXJhbXMge1xuICBvcmlnaW46IHN0cmluZztcbiAgY29kZTogc3RyaW5nO1xuICBkZXZpY2VOYW1lOiBzdHJpbmc7XG4gIGRldmljZVR5cGU6ICdkZXNrdG9wJyB8ICdtb2JpbGUnO1xuICBmZXRjaEltcGw6IHR5cGVvZiBmZXRjaDtcbn1cblxuLyoqXG4gKiBQT1NUIC9wYWlyIFx1MjAxNCByZWRlZW0gYSBvbmUtdGltZSBwYWlyaW5nIGNvZGUgZm9yIGxvbmctbGl2ZWQgZGV2aWNlXG4gKiBjcmVkZW50aWFscy4gVGhyb3dzIGBQYWlyUmVqZWN0ZWRFcnJvcmAgKGJhZCBjb2RlKSwgYFVuY2xhaW1lZFdvcmtlckVycm9yYFxuICogKDQyMSksIG9yIGBXb3JrZXJBcGlFcnJvcmAgKHVucmVhY2hhYmxlIC8gdW5leHBlY3RlZCkuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZXF1ZXN0UGFpcihwYXJhbXM6IFBhaXJSZXF1ZXN0UGFyYW1zKTogUHJvbWlzZTxQYWlyQ3JlZGVudGlhbHM+IHtcbiAgbGV0IHJlc3BvbnNlOiBSZXNwb25zZTtcbiAgdHJ5IHtcbiAgICByZXNwb25zZSA9IGF3YWl0IHBhcmFtcy5mZXRjaEltcGwoYCR7cGFyYW1zLm9yaWdpbn0vcGFpcmAsIHtcbiAgICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgICAgaGVhZGVyczogeyAnY29udGVudC10eXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nIH0sXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIGNvZGU6IHBhcmFtcy5jb2RlLFxuICAgICAgICBkZXZpY2VOYW1lOiBwYXJhbXMuZGV2aWNlTmFtZSxcbiAgICAgICAgZGV2aWNlVHlwZTogcGFyYW1zLmRldmljZVR5cGUsXG4gICAgICB9KSxcbiAgICB9KTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICB0aHJvdyBuZXcgV29ya2VyQXBpRXJyb3IoXG4gICAgICBgY291bGQgbm90IHJlYWNoIHRoZSB3b3JrZXIgYXQgJHtwYXJhbXMub3JpZ2lufTogJHtcbiAgICAgICAgZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpXG4gICAgICB9YCxcbiAgICApO1xuICB9XG4gIC8vIFJlYWQgdGhlIGJvZHkgb25jZSAoYSBSZXNwb25zZSBib2R5IGlzIHNpbmdsZS11c2UpIGFuZCBwYXJzZSBmcm9tIHRleHQuXG4gIGNvbnN0IGRldGFpbCA9IChhd2FpdCByZXNwb25zZS50ZXh0KCkuY2F0Y2goKCkgPT4gJycpKS50cmltKCk7XG4gIGlmIChyZXNwb25zZS5zdGF0dXMgPT09IDQyMSkge1xuICAgIHRocm93IG5ldyBVbmNsYWltZWRXb3JrZXJFcnJvcigndGhpcyB3b3JrZXIgaGFzIG5vdCBiZWVuIGNsYWltZWQgeWV0Jyk7XG4gIH1cbiAgaWYgKHJlc3BvbnNlLnN0YXR1cyA9PT0gNDAxIHx8IHJlc3BvbnNlLnN0YXR1cyA9PT0gNDAzKSB7XG4gICAgdGhyb3cgbmV3IFBhaXJSZWplY3RlZEVycm9yKFxuICAgICAgJ3BhaXJpbmcgY29kZSByZWplY3RlZCBcdTIwMTQgY29kZXMgYXJlIG9uZS10aW1lLCBleHBpcmUgYWZ0ZXIgMTAgbWludXRlcywgYW5kIGNvbWUgJyArXG4gICAgICAgICdmcm9tIHRoZSB3b3JrZXIgZGFzaGJvYXJkLiBHZW5lcmF0ZSBhIGZyZXNoIG9uZSBhbmQgcmV0cnkuJyxcbiAgICApO1xuICB9XG4gIGlmICghcmVzcG9uc2Uub2spIHtcbiAgICB0aHJvdyBuZXcgV29ya2VyQXBpRXJyb3IoXG4gICAgICBgcGFpcmluZyBmYWlsZWQ6IEhUVFAgJHtyZXNwb25zZS5zdGF0dXN9ICR7ZGV0YWlsLnNsaWNlKDAsIDIwMCl9YC50cmltKCksXG4gICAgICByZXNwb25zZS5zdGF0dXMsXG4gICAgKTtcbiAgfVxuICBsZXQgYm9keTogeyB0b2tlbj86IHVua25vd247IGRldmljZUlkPzogdW5rbm93biB9O1xuICB0cnkge1xuICAgIGJvZHkgPSBKU09OLnBhcnNlKGRldGFpbCkgYXMgeyB0b2tlbj86IHVua25vd247IGRldmljZUlkPzogdW5rbm93biB9O1xuICB9IGNhdGNoIHtcbiAgICB0aHJvdyBuZXcgV29ya2VyQXBpRXJyb3IoJ3BhaXJpbmcgcmVwbHkgd2FzIG5vdCBKU09OJywgcmVzcG9uc2Uuc3RhdHVzKTtcbiAgfVxuICBpZiAodHlwZW9mIGJvZHkudG9rZW4gIT09ICdzdHJpbmcnIHx8IHR5cGVvZiBib2R5LmRldmljZUlkICE9PSAnc3RyaW5nJykge1xuICAgIHRocm93IG5ldyBXb3JrZXJBcGlFcnJvcigncGFpcmluZyByZXBseSB3YXMgbWlzc2luZyB0b2tlbi9kZXZpY2VJZCcsIHJlc3BvbnNlLnN0YXR1cyk7XG4gIH1cbiAgcmV0dXJuIHsgdG9rZW46IGJvZHkudG9rZW4sIGRldmljZUlkOiBib2R5LmRldmljZUlkIH07XG59XG5cbi8vIC0tLSBkZXZpY2Ugc2VsZi1zZXJ2aWNlIChQQVRDSCAvZGV2aWNlKSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogVGhlIGRldmljZSBkb2N1bWVudCB0aGUgd29ya2VyIHJldHVybnMgZnJvbSBgUEFUQ0ggL2RldmljZWAuICovXG5leHBvcnQgaW50ZXJmYWNlIFdvcmtlckRldmljZSB7XG4gIGlkOiBzdHJpbmc7XG4gIG5hbWU6IHN0cmluZztcbiAgdHlwZTogc3RyaW5nO1xufVxuXG5leHBvcnQgdHlwZSBSZW5hbWVPdXRjb21lID1cbiAgfCB7IG9rOiB0cnVlOyBkZXZpY2U6IFdvcmtlckRldmljZSB9XG4gIHwgeyBvazogZmFsc2U7IGVycm9yOiBzdHJpbmcgfTtcblxuZXhwb3J0IGludGVyZmFjZSBSZW5hbWVQYXJhbXMge1xuICBvcmlnaW46IHN0cmluZztcbiAgLyoqIFRoZSBjYWxsaW5nIGRldmljZSdzIG93biB0b2tlbiBcdTIwMTQgaXQgY2FuIG9ubHkgZXZlciByZW5hbWUgaXRzZWxmLiAqL1xuICB0b2tlbjogc3RyaW5nO1xuICBuYW1lOiBzdHJpbmc7XG4gIGZldGNoSW1wbDogdHlwZW9mIGZldGNoO1xufVxuXG4vKipcbiAqIGBQQVRDSCAvZGV2aWNlYCBcdTIwMTQgcmVuYW1lIFRISVMgZGV2aWNlIG9uIHRoZSB3b3JrZXIgKGRldmljZS10b2tlblxuICogYXV0aGVudGljYXRlZDsgbmV2ZXIgdGhyb3dzOiBmYWlsdXJlcyBjb21lIGJhY2sgYXMgYHtvazpmYWxzZSwgZXJyb3J9YCkuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZW5hbWVEZXZpY2UocGFyYW1zOiBSZW5hbWVQYXJhbXMpOiBQcm9taXNlPFJlbmFtZU91dGNvbWU+IHtcbiAgbGV0IHJlc3BvbnNlOiBSZXNwb25zZTtcbiAgdHJ5IHtcbiAgICByZXNwb25zZSA9IGF3YWl0IHBhcmFtcy5mZXRjaEltcGwoYCR7cGFyYW1zLm9yaWdpbn0vZGV2aWNlYCwge1xuICAgICAgbWV0aG9kOiAnUEFUQ0gnLFxuICAgICAgaGVhZGVyczogeyAnY29udGVudC10eXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLCBhdXRob3JpemF0aW9uOiBgQmVhcmVyICR7cGFyYW1zLnRva2VufWAgfSxcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgbmFtZTogcGFyYW1zLm5hbWUgfSksXG4gICAgfSk7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIG9rOiBmYWxzZSxcbiAgICAgIGVycm9yOiBgY291bGQgbm90IHJlYWNoIHRoZSB3b3JrZXIgYXQgJHtwYXJhbXMub3JpZ2lufTogJHtcbiAgICAgICAgZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpXG4gICAgICB9YCxcbiAgICB9O1xuICB9XG4gIGNvbnN0IGRldGFpbCA9IChhd2FpdCByZXNwb25zZS50ZXh0KCkuY2F0Y2goKCkgPT4gJycpKS50cmltKCk7XG4gIGlmIChyZXNwb25zZS5zdGF0dXMgPT09IDQyMSkge1xuICAgIHJldHVybiB7IG9rOiBmYWxzZSwgZXJyb3I6ICd0aGlzIHdvcmtlciBoYXMgbm90IGJlZW4gY2xhaW1lZCB5ZXQnIH07XG4gIH1cbiAgaWYgKHJlc3BvbnNlLnN0YXR1cyA9PT0gNDAxIHx8IHJlc3BvbnNlLnN0YXR1cyA9PT0gNDAzKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIG9rOiBmYWxzZSxcbiAgICAgIGVycm9yOiAndGhlIHdvcmtlciByZWplY3RlZCB0aGlzIGRldmljZVxcdTIwMTlzIHRva2VuIChyZXZva2VkPykgXHUyMDE0IHVubGluayBhbmQgcmUtcGFpciB3aXRoIGEgZnJlc2ggY29kZS4nLFxuICAgIH07XG4gIH1cbiAgaWYgKCFyZXNwb25zZS5vaykge1xuICAgIGxldCByZWFzb24gPSBgSFRUUCAke3Jlc3BvbnNlLnN0YXR1c31gO1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKGRldGFpbCkgYXMgeyBlcnJvcj86IHVua25vd24gfTtcbiAgICAgIGlmICh0eXBlb2YgcGFyc2VkLmVycm9yID09PSAnc3RyaW5nJykgcmVhc29uID0gcGFyc2VkLmVycm9yO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8ga2VlcCB0aGUgYmFyZSBzdGF0dXNcbiAgICB9XG4gICAgcmV0dXJuIHsgb2s6IGZhbHNlLCBlcnJvcjogcmVhc29uIH07XG4gIH1cbiAgbGV0IGJvZHk6IHsgZGV2aWNlPzogdW5rbm93biB9O1xuICB0cnkge1xuICAgIGJvZHkgPSBKU09OLnBhcnNlKGRldGFpbCkgYXMgeyBkZXZpY2U/OiB1bmtub3duIH07XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiB7IG9rOiBmYWxzZSwgZXJyb3I6ICdyZW5hbWUgcmVwbHkgd2FzIG5vdCBKU09OJyB9O1xuICB9XG4gIGNvbnN0IGRldmljZSA9IGJvZHkuZGV2aWNlIGFzIFBhcnRpYWw8V29ya2VyRGV2aWNlPiB8IHVuZGVmaW5lZDtcbiAgaWYgKFxuICAgIHR5cGVvZiBkZXZpY2U/LmlkICE9PSAnc3RyaW5nJyB8fFxuICAgIHR5cGVvZiBkZXZpY2UubmFtZSAhPT0gJ3N0cmluZycgfHxcbiAgICB0eXBlb2YgZGV2aWNlLnR5cGUgIT09ICdzdHJpbmcnXG4gICkge1xuICAgIHJldHVybiB7IG9rOiBmYWxzZSwgZXJyb3I6ICdyZW5hbWUgcmVwbHkgd2FzIG1pc3NpbmcgdGhlIGRldmljZSBkb2N1bWVudCcgfTtcbiAgfVxuICByZXR1cm4geyBvazogdHJ1ZSwgZGV2aWNlOiB7IGlkOiBkZXZpY2UuaWQsIG5hbWU6IGRldmljZS5uYW1lLCB0eXBlOiBkZXZpY2UudHlwZSB9IH07XG59XG5cbi8vIC0tLSB3b3JrZXIgc3RhdHVzIChHRVQgL2FwaS9zdGF0dXMsIGRldmljZSB0b2tlbikgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFRoZSBzbGljZSBvZiBgL2FwaS9zdGF0dXNgIHRoZSBwbHVnaW4ncyBBYm91dCBzZWN0aW9uIHNob3dzLiAqL1xuZXhwb3J0IGludGVyZmFjZSBXb3JrZXJTdGF0dXNTdW1tYXJ5IHtcbiAgdmF1bHROYW1lOiBzdHJpbmc7XG4gIGRldmljZXM6IEFycmF5PHsgaWQ6IHN0cmluZzsgbmFtZTogc3RyaW5nOyB0eXBlOiBzdHJpbmc7IG9ubGluZTogYm9vbGVhbjsgcmV2b2tlZDogYm9vbGVhbiB9PjtcbiAgYXR0YWNobWVudHM6IHsgY291bnQ6IG51bWJlcjsgYnl0ZXM6IG51bWJlciB9O1xuICBzdG9yYWdlQnl0ZXM6IG51bWJlcjtcbiAgLyoqIFdvcmtlci1yZXBvcnRlZCByZWxlYXNlIHZlcnNpb24gKGFic2VudCBvbiBzZXJ2ZXJzIFx1MjI2NCAwLjEpLiAqL1xuICBzZXJ2ZXJWZXJzaW9uPzogc3RyaW5nO1xufVxuXG4vKipcbiAqIGBHRVQgL2FwaS9zdGF0dXNgIHdpdGggdGhlIGRldmljZSB0b2tlbiBcdTIwMTQgc3RvcmFnZSB1c2FnZSArIGRldmljZSBsaXN0IGZvclxuICogdGhlIEFib3V0IHNlY3Rpb24uIFJlc29sdmVzIGBudWxsYCBvbiBhbnkgZmFpbHVyZSAoQWJvdXQgc2hvd3MgXCJ1bmtub3duXCIpLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZmV0Y2hXb3JrZXJTdGF0dXMocGFyYW1zOiB7XG4gIG9yaWdpbjogc3RyaW5nO1xuICB0b2tlbjogc3RyaW5nO1xuICBmZXRjaEltcGw6IHR5cGVvZiBmZXRjaDtcbn0pOiBQcm9taXNlPFdvcmtlclN0YXR1c1N1bW1hcnkgfCBudWxsPiB7XG4gIGxldCByZXNwb25zZTogUmVzcG9uc2U7XG4gIHRyeSB7XG4gICAgcmVzcG9uc2UgPSBhd2FpdCBwYXJhbXMuZmV0Y2hJbXBsKGAke3BhcmFtcy5vcmlnaW59L2FwaS9zdGF0dXNgLCB7XG4gICAgICBoZWFkZXJzOiB7IGF1dGhvcml6YXRpb246IGBCZWFyZXIgJHtwYXJhbXMudG9rZW59YCB9LFxuICAgIH0pO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuICBpZiAoIXJlc3BvbnNlLm9rKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgYm9keSA9IChhd2FpdCByZXNwb25zZS5qc29uKCkuY2F0Y2goKCkgPT4gbnVsbCkpIGFzIFBhcnRpYWw8V29ya2VyU3RhdHVzU3VtbWFyeT4gfCBudWxsO1xuICBpZiAoYm9keSA9PT0gbnVsbCB8fCB0eXBlb2YgYm9keS5zdG9yYWdlQnl0ZXMgIT09ICdudW1iZXInIHx8IHR5cGVvZiBib2R5LmF0dGFjaG1lbnRzICE9PSAnb2JqZWN0Jykge1xuICAgIHJldHVybiBudWxsO1xuICB9XG4gIHJldHVybiB7XG4gICAgdmF1bHROYW1lOiB0eXBlb2YgYm9keS52YXVsdE5hbWUgPT09ICdzdHJpbmcnID8gYm9keS52YXVsdE5hbWUgOiAnJyxcbiAgICBkZXZpY2VzOiBBcnJheS5pc0FycmF5KGJvZHkuZGV2aWNlcykgPyBib2R5LmRldmljZXMgOiBbXSxcbiAgICBhdHRhY2htZW50czogYm9keS5hdHRhY2htZW50cyxcbiAgICBzdG9yYWdlQnl0ZXM6IGJvZHkuc3RvcmFnZUJ5dGVzLFxuICAgIC4uLih0eXBlb2YgYm9keS5zZXJ2ZXJWZXJzaW9uID09PSAnc3RyaW5nJyA/IHsgc2VydmVyVmVyc2lvbjogYm9keS5zZXJ2ZXJWZXJzaW9uIH0gOiB7fSksXG4gIH07XG59XG4iLCAiLyoqXG4gKiBUaGUgcGFpciBmbG93IHNoYXJlZCBieSB0aGUgc2V0dGluZ3MgZm9ybSBhbmQgdGhlIGBvYnNpZGlhbjovL2AgZGVlcCBsaW5rXG4gKiAoQVJDSElURUNUVVJFIFx1MDBBNzMpOiBwcm9iZSBgR0VUIC9oZWFsdGhgIGZpcnN0IFx1MjAxNCBhbiAqdW5jbGFpbWVkKiB3b3JrZXIgZ2V0c1xuICogZnJpZW5kbHkgb25ib2FyZGluZyBndWlkYW5jZSBpbnN0ZWFkIG9mIGEgY3J5cHRpYyA0MjEgXHUyMDE0IHRoZW4gYFBPU1QgL3BhaXJgXG4gKiBhbmQgaGFuZCB0aGUgY3JlZGVudGlhbHMgYmFjayB0byBiZSBwZXJzaXN0ZWQuXG4gKi9cblxuaW1wb3J0IHtcbiAgZmV0Y2hIZWFsdGgsXG4gIG5vcm1hbGl6ZVdvcmtlclVybCxcbiAgcmVxdWVzdFBhaXIsXG4gIFBhaXJSZWplY3RlZEVycm9yLFxuICBVbmNsYWltZWRXb3JrZXJFcnJvcixcbiAgV29ya2VyQXBpRXJyb3IsXG59IGZyb20gJy4vd29ya2VyYXBpLmpzJztcblxuZXhwb3J0IHR5cGUgUGFpck91dGNvbWUgPVxuICB8IHsgc3RhdHVzOiAncGFpcmVkJzsgdXJsOiBzdHJpbmc7IHRva2VuOiBzdHJpbmc7IGRldmljZUlkOiBzdHJpbmcgfVxuICB8IHsgc3RhdHVzOiAndW5jbGFpbWVkJzsgdXJsOiBzdHJpbmc7IGd1aWRhbmNlOiBzdHJpbmcgfVxuICB8IHsgc3RhdHVzOiAndW5yZWFjaGFibGUnOyB1cmw6IHN0cmluZzsgcmVhc29uOiBzdHJpbmcgfVxuICB8IHsgc3RhdHVzOiAncmVqZWN0ZWQnOyB1cmw6IHN0cmluZzsgcmVhc29uOiBzdHJpbmcgfVxuICB8IHsgc3RhdHVzOiAnaW52YWxpZC11cmwnOyBpbnB1dDogc3RyaW5nIH07XG5cbmV4cG9ydCBpbnRlcmZhY2UgUGFpckZsb3dQYXJhbXMge1xuICAvKiogV29ya2VyIFVSTCBhcyB0eXBlZCAvIGRlZXAtbGlua2VkIChzY2hlbWVsZXNzIGlzIHRvbGVyYXRlZCkuICovXG4gIHVybDogc3RyaW5nO1xuICAvKiogT25lLXRpbWUgcGFpcmluZyBjb2RlIGZyb20gdGhlIHdvcmtlciBkYXNoYm9hcmQuICovXG4gIGNvZGU6IHN0cmluZztcbiAgZGV2aWNlTmFtZTogc3RyaW5nO1xuICBkZXZpY2VUeXBlOiAnZGVza3RvcCcgfCAnbW9iaWxlJztcbiAgZmV0Y2hJbXBsOiB0eXBlb2YgZmV0Y2g7XG59XG5cbi8qKiBPbmJvYXJkaW5nIHRleHQgc2hvd24gd2hlbiB0aGUgd29ya2VyIGlzIGRlcGxveWVkIGJ1dCBub3QgY2xhaW1lZC4gKi9cbmV4cG9ydCBmdW5jdGlvbiB1bmNsYWltZWRHdWlkYW5jZSh1cmw6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBbXG4gICAgYFRoZSB3b3JrZXIgYXQgJHt1cmx9IGlzIGRlcGxveWVkIGJ1dCBub3QgY2xhaW1lZCB5ZXQuIEZpbmlzaCBzZXR1cCBpbiBhIGJyb3dzZXI6YCxcbiAgICAnJyxcbiAgICBgMS4gT3BlbiAke3VybH1gLFxuICAgICcyLiBTZXQgdGhlIGFkbWluIHBhc3NwaHJhc2UgYW5kIG5hbWUgdGhlIHZhdWx0ICh0aGUgY2xhaW0gcGFnZSkuJyxcbiAgICAnMy4gT24gdGhlIGRhc2hib2FyZCwgY3JlYXRlIGEgcGFpcmluZyBjb2RlIChEZXZpY2VzIFx1MjE5MiBQYWlyIG5ldyBkZXZpY2UpLicsXG4gICAgJzQuIEVudGVyIHRoYXQgY29kZSBoZXJlIChvciBjbGljayB0aGUgb2JzaWRpYW46Ly8gbGluayB0aGUgZGFzaGJvYXJkIHNob3dzKSBhbmQgcGFpci4nLFxuICBdLmpvaW4oJ1xcbicpO1xufVxuXG4vKipcbiAqIFJ1biB0aGUgcGFpciBmbG93LiBOZXZlciB0aHJvd3MgXHUyMDE0IGV2ZXJ5IGZhaWx1cmUgbW9kZSBpcyBhIHR5cGVkIG91dGNvbWUgdGhlXG4gKiBVSSBjYW4gcmVuZGVyIChhbmQgdGhlIGRlZXAtbGluayBoYW5kbGVyIGNhbiB0dXJuIGludG8gYSBOb3RpY2UpLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcGFpcldpdGhXb3JrZXIocGFyYW1zOiBQYWlyRmxvd1BhcmFtcyk6IFByb21pc2U8UGFpck91dGNvbWU+IHtcbiAgbGV0IG9yaWdpbjogc3RyaW5nO1xuICB0cnkge1xuICAgIG9yaWdpbiA9IG5vcm1hbGl6ZVdvcmtlclVybChwYXJhbXMudXJsKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIHsgc3RhdHVzOiAnaW52YWxpZC11cmwnLCBpbnB1dDogcGFyYW1zLnVybCB9O1xuICB9XG5cbiAgY29uc3QgaGVhbHRoID0gYXdhaXQgZmV0Y2hIZWFsdGgob3JpZ2luLCBwYXJhbXMuZmV0Y2hJbXBsKTtcbiAgaWYgKCFoZWFsdGgucmVhY2hhYmxlKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1czogJ3VucmVhY2hhYmxlJyxcbiAgICAgIHVybDogb3JpZ2luLFxuICAgICAgcmVhc29uOlxuICAgICAgICBgJHtoZWFsdGgucmVhc29uID8/ICd1bmtub3duIGVycm9yJ30gXHUyMDE0IGNoZWNrIHRoZSBVUkwsIHlvdXIgbmV0d29yaywgYW5kIHRoYXQgdGhlIGAgK1xuICAgICAgICAnd29ya2VyIGlzIGRlcGxveWVkLicsXG4gICAgfTtcbiAgfVxuICBpZiAoIWhlYWx0aC5jbGFpbWVkKSB7XG4gICAgcmV0dXJuIHsgc3RhdHVzOiAndW5jbGFpbWVkJywgdXJsOiBvcmlnaW4sIGd1aWRhbmNlOiB1bmNsYWltZWRHdWlkYW5jZShvcmlnaW4pIH07XG4gIH1cblxuICB0cnkge1xuICAgIGNvbnN0IGNyZWRlbnRpYWxzID0gYXdhaXQgcmVxdWVzdFBhaXIoe1xuICAgICAgb3JpZ2luLFxuICAgICAgY29kZTogcGFyYW1zLmNvZGUsXG4gICAgICBkZXZpY2VOYW1lOiBwYXJhbXMuZGV2aWNlTmFtZSxcbiAgICAgIGRldmljZVR5cGU6IHBhcmFtcy5kZXZpY2VUeXBlLFxuICAgICAgZmV0Y2hJbXBsOiBwYXJhbXMuZmV0Y2hJbXBsLFxuICAgIH0pO1xuICAgIHJldHVybiB7IHN0YXR1czogJ3BhaXJlZCcsIHVybDogb3JpZ2luLCAuLi5jcmVkZW50aWFscyB9O1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIFVuY2xhaW1lZFdvcmtlckVycm9yKSB7XG4gICAgICByZXR1cm4geyBzdGF0dXM6ICd1bmNsYWltZWQnLCB1cmw6IG9yaWdpbiwgZ3VpZGFuY2U6IHVuY2xhaW1lZEd1aWRhbmNlKG9yaWdpbikgfTtcbiAgICB9XG4gICAgaWYgKGVycm9yIGluc3RhbmNlb2YgUGFpclJlamVjdGVkRXJyb3IpIHtcbiAgICAgIHJldHVybiB7IHN0YXR1czogJ3JlamVjdGVkJywgdXJsOiBvcmlnaW4sIHJlYXNvbjogZXJyb3IubWVzc2FnZSB9O1xuICAgIH1cbiAgICBjb25zdCByZWFzb24gPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcik7XG4gICAgcmV0dXJuIHsgc3RhdHVzOiAncmVqZWN0ZWQnLCB1cmw6IG9yaWdpbiwgcmVhc29uIH07XG4gIH1cbn1cblxuLyoqIFJlbmRlciBhbnkgb3V0Y29tZSBhcyB1c2VyLWZhY2luZyB0ZXh0IChOb3RpY2VzLCBkZWVwLWxpbmsgZmVlZGJhY2spLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhaXJPdXRjb21lTWVzc2FnZShvdXRjb21lOiBQYWlyT3V0Y29tZSk6IHN0cmluZyB7XG4gIHN3aXRjaCAob3V0Y29tZS5zdGF0dXMpIHtcbiAgICBjYXNlICdwYWlyZWQnOlxuICAgICAgcmV0dXJuIGBQYWlyZWQgd2l0aCAke291dGNvbWUudXJsfSBcdTIwMTQgc3luY2luZyBub3cuYDtcbiAgICBjYXNlICd1bmNsYWltZWQnOlxuICAgICAgcmV0dXJuIG91dGNvbWUuZ3VpZGFuY2U7XG4gICAgY2FzZSAndW5yZWFjaGFibGUnOlxuICAgICAgcmV0dXJuIGBDb3VsZCBub3QgcmVhY2ggdGhlIHdvcmtlcjogJHtvdXRjb21lLnJlYXNvbn1gO1xuICAgIGNhc2UgJ3JlamVjdGVkJzpcbiAgICAgIHJldHVybiBgUGFpcmluZyBmYWlsZWQ6ICR7b3V0Y29tZS5yZWFzb259YDtcbiAgICBjYXNlICdpbnZhbGlkLXVybCc6XG4gICAgICByZXR1cm4gYFRoYXQgZG9lcyBub3QgbG9vayBsaWtlIGEgd29ya2VyIFVSTDogJHtKU09OLnN0cmluZ2lmeShvdXRjb21lLmlucHV0KX1gO1xuICB9XG59XG4iLCAiLyoqXG4gKiBgb2JzaWRpYW46Ly92YXVsdHN5bmNmb3JhZ2VudHMvcGFpcj91cmw9PHdvcmtlcj4mY29kZT08cGFpcmluZz5gIGRlZXAtbGlua1xuICogaGFuZGxpbmcgKEFSQ0hJVEVDVFVSRSBcdTAwQTczKTogdGhlIGRhc2hib2FyZCByZW5kZXJzIHRoaXMgbGluayAoYW5kIHRoZSBRUlxuICogZXF1aXZhbGVudCkgc28gYSBuZXcgZGV2aWNlIHBhaXJzIHdpdGggemVybyB0eXBpbmcuXG4gKlxuICogVGhlIGhhbmRsZXIgaXMgcmVnaXN0ZXJlZCBmb3IgdGhlIGFjdGlvbiBgdmF1bHRzeW5jZm9yYWdlbnRzYC4gT2JzaWRpYW5cbiAqIGJ1aWxkcyBkaWZmZXIgc3VidGx5IGluIGhvdyB0aGUgYC9wYWlyYCBwYXRoIHNlZ21lbnQgb2YgYSBwcm90b2NvbCBVUkwgaXNcbiAqIG1hdGNoZWQsIHNvIHRoZSBzYW1lIGhhbmRsZXIgaXMgcmVnaXN0ZXJlZCBmb3IgYHZhdWx0c3luY2ZvcmFnZW50cy9wYWlyYFxuICogdG9vIFx1MjAxNCB3aGljaGV2ZXIgc3BlbGxpbmcgYSBnaXZlbiBidWlsZCByZXNvbHZlcywgdGhlIGxpbmsgd29ya3MuIFdoZW5cbiAqIGB1cmxgL2Bjb2RlYCBhcmUgYWJzZW50IHRoZSBpbnZvY2F0aW9uIGlzIGlnbm9yZWQgKGEgc3RyYXkgcHJvdG9jb2wgaGl0XG4gKiBtdXN0IG5vdCBzcGFtIGEgTm90aWNlKTsgYSAqbWFsZm9ybWVkKiBwYWlyIGxpbmsgKG9uZSBvZiB0aGUgdHdvIHByZXNlbnQpXG4gKiBnZXRzIGFuIGFjdGlvbmFibGUgZXJyb3IuXG4gKi9cblxuaW1wb3J0IHsgTm90aWNlIH0gZnJvbSAnb2JzaWRpYW4nO1xuXG4vKiogUHJvdG9jb2wgYWN0aW9uICh0aGUgYG9ic2lkaWFuOi8vYCBcImhvc3RcIiBwYXJ0KS4gKi9cbmV4cG9ydCBjb25zdCBQUk9UT0NPTF9BQ1RJT04gPSAndmF1bHRzeW5jZm9yYWdlbnRzJztcblxuLyoqIEhhbmRsZXIgc2hhcGUgKE9ic2lkaWFuIHBhc3NlcyBpdHMgZGVjb2RlZCBxdWVyeSBwYXJhbXMpLiAqL1xuZXhwb3J0IHR5cGUgUHJvdG9jb2xIYW5kbGVyID0gKHBhcmFtczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pID0+IHZvaWQ7XG5cbi8qKiBIb3cgaGFuZGxlcnMgZ2V0IHJlZ2lzdGVyZWQgXHUyMDE0IGBQbHVnaW4ucmVnaXN0ZXJPYnNpZGlhblByb3RvY29sSGFuZGxlcmAuICovXG5leHBvcnQgdHlwZSBQcm90b2NvbFJlZ2lzdHJhciA9IChhY3Rpb246IHN0cmluZywgaGFuZGxlcjogUHJvdG9jb2xIYW5kbGVyKSA9PiB2b2lkO1xuXG4vKiogUGFyc2VkIHBhaXIgZGVlcCBsaW5rLiAqL1xuZXhwb3J0IGludGVyZmFjZSBQYWlyRGVlcExpbmsge1xuICB1cmw6IHN0cmluZztcbiAgY29kZTogc3RyaW5nO1xufVxuXG5leHBvcnQgdHlwZSBEZWVwTGlua1BhcnNlUmVzdWx0ID1cbiAgfCB7IG9rOiB0cnVlOyBsaW5rOiBQYWlyRGVlcExpbmsgfVxuICB8IHsgb2s6IGZhbHNlOyBlcnJvcjogc3RyaW5nIH07XG5cbi8qKlxuICogRXh0cmFjdCBge3VybCwgY29kZX1gIGZyb20gT2JzaWRpYW4ncyBkZWNvZGVkIHF1ZXJ5IHBhcmFtcy4gVmFsdWVzIGFycml2ZVxuICogYXMgc3RyaW5ncyAodXN1YWxseSBhbHJlYWR5IGRlY29kZWQ7IGEgZG91YmxlLWVuY29kZWQgYCV4eGAgcmVtbmFudCBpc1xuICogZGVjb2RlZCBvbmNlIG1vcmUsIGJlc3QgZWZmb3J0KS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlUGFpckRlZXBMaW5rKHBhcmFtczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiBEZWVwTGlua1BhcnNlUmVzdWx0IHtcbiAgY29uc3QgdXJsID0gcGFyYW1UZXh0KHBhcmFtcywgJ3VybCcpO1xuICBjb25zdCBjb2RlID0gcGFyYW1UZXh0KHBhcmFtcywgJ2NvZGUnKTtcbiAgaWYgKHVybCA9PT0gJycgJiYgY29kZSA9PT0gJycpIHtcbiAgICByZXR1cm4geyBvazogZmFsc2UsIGVycm9yOiAnbm8gcGFpcmluZyBwYXJhbWV0ZXJzJyB9O1xuICB9XG4gIGlmICh1cmwgPT09ICcnKSByZXR1cm4geyBvazogZmFsc2UsIGVycm9yOiAnZGVlcCBsaW5rIGlzIG1pc3NpbmcgdGhlIHdvcmtlciBVUkwgKD91cmw9XHUyMDI2KScgfTtcbiAgaWYgKGNvZGUgPT09ICcnKSByZXR1cm4geyBvazogZmFsc2UsIGVycm9yOiAnZGVlcCBsaW5rIGlzIG1pc3NpbmcgdGhlIHBhaXJpbmcgY29kZSAoP2NvZGU9XHUyMDI2KScgfTtcbiAgcmV0dXJuIHsgb2s6IHRydWUsIGxpbms6IHsgdXJsLCBjb2RlIH0gfTtcbn1cblxuZnVuY3Rpb24gcGFyYW1UZXh0KHBhcmFtczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIGtleTogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdmFsdWUgPSBwYXJhbXNba2V5XTtcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ251bWJlcicpIHJldHVybiBTdHJpbmcodmFsdWUpO1xuICBpZiAodHlwZW9mIHZhbHVlICE9PSAnc3RyaW5nJykgcmV0dXJuICcnO1xuICBjb25zdCB0cmltbWVkID0gdmFsdWUudHJpbSgpO1xuICAvLyBPYnNpZGlhbiBoYW5kcyBvdmVyIGRlY29kZWQgdmFsdWVzOyB0b2xlcmF0ZSBvbmUgc3Vydml2aW5nIHJvdW5kIG9mXG4gIC8vIHBlcmNlbnQtZW5jb2RpbmcgZnJvbSBvdmVyLWVhZ2VyIGxpbmsgZ2VuZXJhdG9ycy5cbiAgaWYgKHRyaW1tZWQuaW5jbHVkZXMoJyUnKSkge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gZGVjb2RlVVJJQ29tcG9uZW50KHRyaW1tZWQpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIHRyaW1tZWQ7XG4gICAgfVxuICB9XG4gIHJldHVybiB0cmltbWVkO1xufVxuXG4vKipcbiAqIFJlZ2lzdGVyIHRoZSBwYWlyIGRlZXAtbGluayBoYW5kbGVyIChjYWxsIGZyb20gYG9ubG9hZGAgd2l0aCB0aGUgcGx1Z2luJ3NcbiAqIG93biByZWdpc3RyYXIpLiBgb25QYWlyYCBydW5zIHRoZSBzaGFyZWQgcGFpciBmbG93IChzZXR0aW5ncyArIE5vdGljZXNcbiAqIGxpdmUgaW4gdGhlIHBsdWdpbik7IGl0cyBlcnJvcnMgYXJlIGxvZ2dlZCwgbmV2ZXIgZmF0YWwuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZWdpc3RlclBhaXJQcm90b2NvbEhhbmRsZXIoXG4gIHJlZ2lzdGVyOiBQcm90b2NvbFJlZ2lzdHJhcixcbiAgb25QYWlyOiAobGluazogUGFpckRlZXBMaW5rKSA9PiBQcm9taXNlPHZvaWQ+LFxuKTogdm9pZCB7XG4gIGNvbnN0IGhhbmRsZXI6IFByb3RvY29sSGFuZGxlciA9IChwYXJhbXMpID0+IHtcbiAgICBjb25zdCBwYXJzZWQgPSBwYXJzZVBhaXJEZWVwTGluayhwYXJhbXMpO1xuICAgIGlmICghcGFyc2VkLm9rKSB7XG4gICAgICAvLyBNaXNzaW5nIGJvdGggXHUyMTkyIGEgYmFyZSBvYnNpZGlhbjovL3ZhdWx0c3luY2ZvcmFnZW50cyBoaXQ7IHN0YXkgcXVpZXQuXG4gICAgICBpZiAocGFyc2VkLmVycm9yICE9PSAnbm8gcGFpcmluZyBwYXJhbWV0ZXJzJykge1xuICAgICAgICBuZXcgTm90aWNlKGBWYXVsdFN5bmMgZGVlcCBsaW5rOiAke3BhcnNlZC5lcnJvcn1gKTtcbiAgICAgIH1cbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdm9pZCBvblBhaXIocGFyc2VkLmxpbmspLmNhdGNoKChlcnJvcjogdW5rbm93bikgPT4ge1xuICAgICAgY29uc29sZS5lcnJvcignW3ZzYV0gZGVlcC1saW5rIHBhaXJpbmcgZmFpbGVkJywgZXJyb3IpO1xuICAgICAgbmV3IE5vdGljZSgnVmF1bHRTeW5jOiBwYWlyaW5nIHZpYSBsaW5rIGZhaWxlZCBcdTIwMTQgc2VlIHRoZSBjb25zb2xlIGZvciBkZXRhaWxzLicpO1xuICAgIH0pO1xuICB9O1xuICByZWdpc3RlcihQUk9UT0NPTF9BQ1RJT04sIGhhbmRsZXIpO1xuICAvLyBSZWdpc3RlciB0aGUgcGF0aC1zcGVsbGVkIGFjdGlvbiB0b28gKGJ1aWxkLWRlcGVuZGVudCBtYXRjaGluZykuXG4gIHJlZ2lzdGVyKGAke1BST1RPQ09MX0FDVElPTn0vcGFpcmAsIGhhbmRsZXIpO1xufVxuIiwgIi8qKlxuICogUmVjb25uZWN0IHBvbGljeSAocGx1Z2luIHNjb3BlIGl0ZW0gIzUpOiBleHBvbmVudGlhbCBiYWNrb2ZmIHdpdGggaml0dGVyLFxuICogY2FwcGVkIGF0IDYwIHMuIFRoZSBwbHVnaW4ncyAxIHMgc3VwZXJ2aXNpb24gdGljayBhc2tzIHRoZSBzdXBlcnZpc29yIHdoYXRcbiAqIHRvIGRvIHdoZW5ldmVyIHRoZSBjbGllbnQgcmVwb3J0cyBgZGlzY29ubmVjdGVkYDsgYSBzY2hlZHVsZWQgcmVjb25uZWN0IGlzXG4gKiBhIHNpbmdsZSBmbGlnaHQgXHUyMDE0IG5ldmVyIGEgc3RhY2sgb2YgcmV0cmllcy5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IFN5bmNDbGllbnRTdGF0ZSB9IGZyb20gJ0B2c2EvY29yZSc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQmFja29mZk9wdGlvbnMge1xuICAvKiogRmlyc3QgYXR0ZW1wdCBkZWxheSAoZGVmYXVsdCAxIHMpLiAqL1xuICBiYXNlTXM/OiBudW1iZXI7XG4gIC8qKiBDZWlsaW5nIChkZWZhdWx0IDYwIHMgcGVyIHRoZSBwbHVnaW4gc3BlYykuICovXG4gIGNhcE1zPzogbnVtYmVyO1xuICAvKiogSml0dGVyIGZyYWN0aW9uIGFyb3VuZCB0aGUgZXhwb25lbnRpYWwgdmFsdWUsIDBcdTIwMTMwLjUgKGRlZmF1bHQgMC4zKS4gKi9cbiAgaml0dGVyPzogbnVtYmVyO1xuICAvKiogSW5qZWN0YWJsZSByYW5kb21uZXNzICh0ZXN0cykuIERlZmF1bHQgYE1hdGgucmFuZG9tYC4gKi9cbiAgcmFuZG9tPzogKCkgPT4gbnVtYmVyO1xufVxuXG5leHBvcnQgY29uc3QgREVGQVVMVF9SRUNPTk5FQ1RfQkFTRV9NUyA9IDEwMDA7XG5leHBvcnQgY29uc3QgREVGQVVMVF9SRUNPTk5FQ1RfQ0FQX01TID0gNjBfMDAwO1xuXG4vKipcbiAqIERlbGF5IGZvciBhdHRlbXB0IE4gKDAtYmFzZWQpOiBgbWluKGNhcCwgYmFzZSBcdTAwQjcgMl5hdHRlbXB0KWAgd2l0aCBzeW1tZXRyaWNcbiAqIG11bHRpcGxpY2F0aXZlIGppdHRlciwgZmxvb3JlZCBhdCAyNTAgbXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBiYWNrb2ZmRGVsYXlNcyhhdHRlbXB0OiBudW1iZXIsIG9wdGlvbnM6IEJhY2tvZmZPcHRpb25zID0ge30pOiBudW1iZXIge1xuICBjb25zdCBiYXNlID0gb3B0aW9ucy5iYXNlTXMgPz8gREVGQVVMVF9SRUNPTk5FQ1RfQkFTRV9NUztcbiAgY29uc3QgY2FwID0gb3B0aW9ucy5jYXBNcyA/PyBERUZBVUxUX1JFQ09OTkVDVF9DQVBfTVM7XG4gIGNvbnN0IGppdHRlciA9IG9wdGlvbnMuaml0dGVyID8/IDAuMztcbiAgY29uc3QgcmFuZG9tID0gb3B0aW9ucy5yYW5kb20gPz8gTWF0aC5yYW5kb207XG4gIGNvbnN0IGV4cG9uZW50aWFsID0gTWF0aC5taW4oY2FwLCBiYXNlICogMiAqKiBhdHRlbXB0KTtcbiAgY29uc3QgZmFjdG9yID0gMSArIChyYW5kb20oKSAqIDIgLSAxKSAqIGppdHRlcjtcbiAgcmV0dXJuIE1hdGgucm91bmQoTWF0aC5taW4oY2FwLCBNYXRoLm1heCgyNTAsIGV4cG9uZW50aWFsICogZmFjdG9yKSkpO1xufVxuXG5leHBvcnQgdHlwZSBSZWNvbm5lY3REZWNpc2lvbiA9IHsgYWN0aW9uOiAncmVjb25uZWN0JzsgZGVsYXlNczogbnVtYmVyIH0gfCB7IGFjdGlvbjogJ3dhaXQnIH07XG5cbi8qKlxuICogVHJhY2tzIHJlY29ubmVjdCBhdHRlbXB0cyBhY3Jvc3MgdGhlIHN1cGVydmlzaW9uIHRpY2suIE5vbi1kaXNjb25uZWN0ZWRcbiAqIHN0YXRlcyByZXNldCB0aGUgYmFja29mZiBsYWRkZXIgKGEgc3VjY2Vzc2Z1bCBjeWNsZSBtZWFucyB0aGUgbmV0d29yayBpc1xuICogYmFjayk7IGBzY2hlZHVsZWRgIGtlZXBzIGV4YWN0bHkgb25lIHJlY29ubmVjdCBpbiBmbGlnaHQuXG4gKi9cbmV4cG9ydCBjbGFzcyBSZWNvbm5lY3RTdXBlcnZpc29yIHtcbiAgcHJpdmF0ZSBhdHRlbXB0ID0gMDtcbiAgcHJpdmF0ZSBzY2hlZHVsZWQgPSBmYWxzZTtcbiAgcHJpdmF0ZSByZWFkb25seSBvcHRpb25zOiBCYWNrb2ZmT3B0aW9ucztcblxuICBjb25zdHJ1Y3RvcihvcHRpb25zOiBCYWNrb2ZmT3B0aW9ucyA9IHt9KSB7XG4gICAgdGhpcy5vcHRpb25zID0gb3B0aW9ucztcbiAgfVxuXG4gIC8qKiBDYWxsIGVhY2ggdGljazsgb24gYHJlY29ubmVjdGAsIGZvbGxvdyB1cCB3aXRoIGBhY2tub3dsZWRnZWQoKWAuICovXG4gIGNvbnNpZGVyKHN0YXRlOiBTeW5jQ2xpZW50U3RhdGUpOiBSZWNvbm5lY3REZWNpc2lvbiB7XG4gICAgaWYgKHN0YXRlICE9PSAnZGlzY29ubmVjdGVkJykge1xuICAgICAgdGhpcy5hdHRlbXB0ID0gMDtcbiAgICAgIHRoaXMuc2NoZWR1bGVkID0gZmFsc2U7XG4gICAgICByZXR1cm4geyBhY3Rpb246ICd3YWl0JyB9O1xuICAgIH1cbiAgICBpZiAodGhpcy5zY2hlZHVsZWQpIHJldHVybiB7IGFjdGlvbjogJ3dhaXQnIH07XG4gICAgcmV0dXJuIHsgYWN0aW9uOiAncmVjb25uZWN0JywgZGVsYXlNczogYmFja29mZkRlbGF5TXModGhpcy5hdHRlbXB0LCB0aGlzLm9wdGlvbnMpIH07XG4gIH1cblxuICAvKiogTWFyayB0aGUgcmV0dXJuZWQgcmVjb25uZWN0IGFzIGluIGZsaWdodCAob25lIGF0IGEgdGltZSkuICovXG4gIGFja25vd2xlZGdlZCgpOiB2b2lkIHtcbiAgICB0aGlzLmF0dGVtcHQgKz0gMTtcbiAgICB0aGlzLnNjaGVkdWxlZCA9IHRydWU7XG4gIH1cblxuICAvKiogVGhlIGluLWZsaWdodCByZWNvbm5lY3Qgc2V0dGxlZCAoc3VjY2VzcyBvciBmYWlsdXJlKS4gKi9cbiAgc2V0dGxlZCgpOiB2b2lkIHtcbiAgICB0aGlzLnNjaGVkdWxlZCA9IGZhbHNlO1xuICB9XG5cbiAgLyoqIENvbXBsZXRlZCByZWNvbm5lY3QgYXR0ZW1wdHMgc2luY2UgdGhlIGxhc3QgaGVhbHRoeSBzdGF0ZS4gKi9cbiAgZ2V0IGF0dGVtcHRzKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMuYXR0ZW1wdDtcbiAgfVxufVxuIiwgIi8qKlxuICogVGhlIHNldHRpbmdzIHRhYiAocGx1Z2luIHNjb3BlIGl0ZW0gIzYpLCBvcmdhbml6ZWQgaW4gZm91ciBzZWN0aW9uczpcbiAqXG4gKiAgIENvbm5lY3Rpb24gXHUyMDE0IHdvcmtlciBVUkwsIGRldmljZSBuYW1lIChwYWlyaW5nLXRpbWUgT1IgcmVuYW1lIHdoZW5cbiAqICAgICAgICAgICAgICAgIGxpbmtlZCksIHBhaXJpbmcgZm9ybSAvIHN0YXR1cyByZWFkb3V0ICsgU3luYyBub3cgKyB1bmxpbmtcbiAqICAgU3luYyAgICAgICBcdTIwMTQgcmVzY2FuIGludGVydmFsLCAub2JzaWRpYW4vIHRvZ2dsZSwgcGF1c2UvcmVzdW1lLFxuICogICAgICAgICAgICAgICAgc3luYy1vbi1zdGFydHVwXG4gKiAgIEFkdmFuY2VkICAgXHUyMDE0IHN0YXR1cy1iYXIgaW5kaWNhdG9yIG1vZGUsIGlnbm9yZSBwYXR0ZXJucywgZGlhZ25vc3RpY3NcbiAqICAgICAgICAgICAgICAgIChsb2cgbGV2ZWwgKyBDb3B5IGRpYWdub3N0aWNzICsgU2F2ZSBzdXBwb3J0IGJ1bmRsZSlcbiAqICAgQWJvdXQgICAgICBcdTIwMTQgdmVyc2lvbnMsIHN0b3JhZ2UgdXNhZ2UsIHByb2plY3QgUkVBRE1FIGxpbmtcbiAqXG4gKiBBbGwgbG9naWMgbGl2ZXMgb24gYFZhdWx0U3luY1BsdWdpbmA7IHRoZSB0YWIgaXMgcHJlc2VudGF0aW9uIHBsdXMgd2lyaW5nLlxuICovXG5cbmltcG9ydCB7IE1vZGFsLCBOb3RpY2UsIFBsdWdpblNldHRpbmdUYWIsIFNldHRpbmcgfSBmcm9tICdvYnNpZGlhbic7XG5pbXBvcnQgdHlwZSB7IEFwcCB9IGZyb20gJ29ic2lkaWFuJztcbmltcG9ydCB7XG4gIGRlZmF1bHREZXZpY2VOYW1lLFxuICBSRVNDQU5fSU5URVJWQUxfQ0hPSUNFUyxcbiAgdHlwZSBMb2dMZXZlbCxcbiAgdHlwZSBWYXVsdFN5bmNQbHVnaW5EYXRhLFxufSBmcm9tICcuL2RhdGEuanMnO1xuaW1wb3J0IHR5cGUgeyBQYWlyT3V0Y29tZSB9IGZyb20gJy4vcGFpcmluZy5qcyc7XG5pbXBvcnQgeyBwYWlyT3V0Y29tZU1lc3NhZ2UgfSBmcm9tICcuL3BhaXJpbmcuanMnO1xuaW1wb3J0IHsgZm9ybWF0Qnl0ZXMsIFBST1RPQ09MX1ZFUlNJT04gfSBmcm9tICcuL2RpYWdub3N0aWNzLmpzJztcbmltcG9ydCB7IGZvcm1hdFNpbmNlIH0gZnJvbSAnLi9zdGF0dXNiYXIuanMnO1xuaW1wb3J0IHR5cGUgeyBWYXVsdFN5bmNQbHVnaW4gfSBmcm9tICcuL3BsdWdpbi5qcyc7XG5cbi8qKlxuICogQ2xvdWRmbGFyZSBEZXBsb3kgQnV0dG9uIHRhcmdldCAoRlItMjEpOiBwcm92aXNpb25zIGEgcHJlY29uZmlndXJlZCB3b3JrZXJcbiAqICsgRHVyYWJsZSBPYmplY3QgKyBSMiBidWNrZXQgaW4gdGhlIHVzZXIncyBvd24gYWNjb3VudCBcdTIwMTQgbm8gd3JhbmdsZXIsIG5vXG4gKiBtYW51YWwgY29uZmlnLiBUaGUgdGVtcGxhdGUgcmVwbyBwaW5zIGEgcmVsZWFzZWQgd29ya2VyIHZlcnNpb24uXG4gKi9cbmV4cG9ydCBjb25zdCBERVBMT1lfVVJMID1cbiAgJ2h0dHBzOi8vZGVwbG95LndvcmtlcnMuY2xvdWRmbGFyZS5jb20vP3VybD0nICtcbiAgJ2h0dHBzOi8vZ2l0aHViLmNvbS9hbnVjaGluL3ZhdWx0c3luY2ZvcmFnZW50cy10ZW1wbGF0ZSc7XG5cbi8qKiBUaGUgcHJvamVjdCBSRUFETUUgKHRoZSBBYm91dCBzZWN0aW9uJ3MgbGluaykuICovXG5leHBvcnQgY29uc3QgUFJPSkVDVF9SRUFETUVfVVJMID0gJ2h0dHBzOi8vZ2l0aHViLmNvbS9hbnVjaGluL3ZhdWx0c3luY2ZvcmFnZW50cyNyZWFkbWUnO1xuXG4vKiogT3BlbiB0aGUgZGVwbG95IHBhZ2UgaW4gdGhlIHN5c3RlbSBicm93c2VyIChuby1vcCB3aGVyZSBgd2luZG93YCBpcyBhYnNlbnQpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG9wZW5EZXBsb3lQYWdlKCk6IHZvaWQge1xuICBpZiAodHlwZW9mIHdpbmRvdyA9PT0gJ3VuZGVmaW5lZCcpIHJldHVybjtcbiAgd2luZG93Lm9wZW4oREVQTE9ZX1VSTCwgJ19ibGFuaycpO1xufVxuXG4vKiogT3BlbiB0aGUgcHJvamVjdCBSRUFETUUgaW4gdGhlIHN5c3RlbSBicm93c2VyIChuby1vcCB3aXRob3V0IGB3aW5kb3dgKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBvcGVuUmVhZG1lUGFnZSgpOiB2b2lkIHtcbiAgaWYgKHR5cGVvZiB3aW5kb3cgPT09ICd1bmRlZmluZWQnKSByZXR1cm47XG4gIHdpbmRvdy5vcGVuKFBST0pFQ1RfUkVBRE1FX1VSTCwgJ19ibGFuaycpO1xufVxuXG4vKiogU21hbGwgY29uZmlybWF0aW9uIGRpYWxvZyAodGhlIHVubGluayBidXR0b24ncyBzYWZldHkgbmV0KS4gKi9cbmV4cG9ydCBjbGFzcyBDb25maXJtTW9kYWwgZXh0ZW5kcyBNb2RhbCB7XG4gIGNvbnN0cnVjdG9yKFxuICAgIGFwcDogQXBwLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgb3B0aW9uczoge1xuICAgICAgdGl0bGU6IHN0cmluZztcbiAgICAgIGJvZHk6IHN0cmluZztcbiAgICAgIGNvbmZpcm1UZXh0OiBzdHJpbmc7XG4gICAgICBvbkNvbmZpcm06ICgpID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+O1xuICAgIH0sXG4gICkge1xuICAgIHN1cGVyKGFwcCk7XG4gIH1cblxuICBvdmVycmlkZSBvbk9wZW4oKTogdm9pZCB7XG4gICAgbmV3IFNldHRpbmcodGhpcy5jb250ZW50RWwpLnNldE5hbWUodGhpcy5vcHRpb25zLnRpdGxlKS5zZXREZXNjKHRoaXMub3B0aW9ucy5ib2R5KTtcbiAgICBuZXcgU2V0dGluZyh0aGlzLmNvbnRlbnRFbCkuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICBidXR0b24uc2V0QnV0dG9uVGV4dCgnQ2FuY2VsJykub25DbGljaygoKSA9PiB0aGlzLmNsb3NlKCkpLFxuICAgICk7XG4gICAgbmV3IFNldHRpbmcodGhpcy5jb250ZW50RWwpLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgYnV0dG9uXG4gICAgICAgIC5zZXRDdGEoKVxuICAgICAgICAuc2V0QnV0dG9uVGV4dCh0aGlzLm9wdGlvbnMuY29uZmlybVRleHQpXG4gICAgICAgIC5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICB0aGlzLmNsb3NlKCk7XG4gICAgICAgICAgYXdhaXQgdGhpcy5vcHRpb25zLm9uQ29uZmlybSgpO1xuICAgICAgICB9KSxcbiAgICApO1xuICB9XG59XG5cbmV4cG9ydCBjbGFzcyBWYXVsdFN5bmNTZXR0aW5nVGFiIGV4dGVuZHMgUGx1Z2luU2V0dGluZ1RhYiB7XG4gIHByaXZhdGUgcmVhZG9ubHkgcGx1Z2luOiBWYXVsdFN5bmNQbHVnaW47XG4gIC8qKiBQYWlyaW5nIGNvZGVzIG5ldmVyIHRvdWNoIGRpc2sgXHUyMDE0IHRoZXkgYXJlIG9uZS10aW1lLCBzaG9ydC1saXZlZCBzZWNyZXRzLiAqL1xuICBwcml2YXRlIHBhaXJpbmdDb2RlID0gJyc7XG4gIC8qKlxuICAgKiBMaW5rZWQtbW9kZSBkZXZpY2UtbmFtZSBkcmFmdDogZWRpdHMgc3RhZ2UgaGVyZSAoTk9UIGluIHBsdWdpbiBkYXRhKSBzbyBhXG4gICAqIGZhaWxlZCByZW5hbWUgY2Fubm90IGxlYXZlIHRoZSBsb2NhbCBuYW1lIG91dCBvZiBzeW5jIHdpdGggdGhlIHdvcmtlci5cbiAgICovXG4gIHByaXZhdGUgcmVuYW1lRHJhZnQ6IHN0cmluZyB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGhpbnRTZXR0aW5nOiBTZXR0aW5nIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgc3RhdHVzU2V0dGluZzogU2V0dGluZyB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHN0b3JhZ2VTZXR0aW5nOiBTZXR0aW5nIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgc2VydmVyVmVyc2lvblNldHRpbmc6IFNldHRpbmcgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSByZWZyZXNoSGFuZGxlOiBSZXR1cm5UeXBlPHR5cGVvZiBzZXRJbnRlcnZhbD4gfCBudWxsID0gbnVsbDtcblxuICBjb25zdHJ1Y3RvcihhcHA6IEFwcCwgcGx1Z2luOiBWYXVsdFN5bmNQbHVnaW4pIHtcbiAgICBzdXBlcihhcHAsIHBsdWdpbik7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gIH1cblxuICBvdmVycmlkZSBkaXNwbGF5KCk6IHZvaWQge1xuICAgIHRoaXMuc3RvcFJlZnJlc2goKTtcbiAgICBjb25zdCB7IGNvbnRhaW5lckVsIH0gPSB0aGlzO1xuICAgIGNvbnRhaW5lckVsLmVtcHR5KCk7XG4gICAgdGhpcy5oaW50U2V0dGluZyA9IG51bGw7XG4gICAgdGhpcy5zdGF0dXNTZXR0aW5nID0gbnVsbDtcbiAgICB0aGlzLnN0b3JhZ2VTZXR0aW5nID0gbnVsbDtcbiAgICB0aGlzLnNlcnZlclZlcnNpb25TZXR0aW5nID0gbnVsbDtcbiAgICB0aGlzLnJlbmFtZURyYWZ0ID0gbnVsbDtcblxuICAgIHRoaXMucmVuZGVyQ29ubmVjdGlvblNlY3Rpb24oKTtcbiAgICB0aGlzLnJlbmRlclN5bmNTZWN0aW9uKCk7XG4gICAgdGhpcy5yZW5kZXJBZHZhbmNlZFNlY3Rpb24oKTtcbiAgICB0aGlzLnJlbmRlckFib3V0U2VjdGlvbigpO1xuICAgIHRoaXMuc3RhcnRSZWZyZXNoKCk7XG4gIH1cblxuICBvdmVycmlkZSBoaWRlKCk6IHZvaWQge1xuICAgIHRoaXMuc3RvcFJlZnJlc2goKTtcbiAgfVxuXG4gIC8vIC0tLSBzZWN0aW9ucyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIHByaXZhdGUgaGVhZGluZyh0ZXh0OiBzdHJpbmcpOiB2b2lkIHtcbiAgICBuZXcgU2V0dGluZyh0aGlzLmNvbnRhaW5lckVsKS5zZXROYW1lKHRleHQpLnNldEhlYWRpbmcoKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyQ29ubmVjdGlvblNlY3Rpb24oKTogdm9pZCB7XG4gICAgY29uc3QgeyBjb250YWluZXJFbCB9ID0gdGhpcztcbiAgICB0aGlzLmhlYWRpbmcoJ0Nvbm5lY3Rpb24nKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ1dvcmtlciBVUkwnKVxuICAgICAgLnNldERlc2MoXG4gICAgICAgICdZb3VyIHN5bmMgd29ya2VyLCBlLmcuIGh0dHBzOi8vcGVyc29uYWwueC53b3JrZXJzLmRldi4gTm8gd29ya2VyIHlldD8gVXNlIFwiRGVwbG95IHlvdXIgd29ya2VyXCIgYmVsb3csIG9wZW4gdGhlIFVSTCBpbiBhIGJyb3dzZXIsIGFuZCBjbGFpbSBpdC4nLFxuICAgICAgKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHRcbiAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoJ2h0dHBzOi8vcGVyc29uYWwueC53b3JrZXJzLmRldicpXG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMucGx1Z2luLmRhdGEudXJsKVxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLmRhdGEudXJsID0gdmFsdWUudHJpbSgpO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVBsdWdpbkRhdGEoKTtcbiAgICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBpZiAodGhpcy5wbHVnaW4ubGlua2VkKSB7XG4gICAgICB0aGlzLnJlbmRlckxpbmtlZERldmljZU5hbWUoKTtcbiAgICAgIHRoaXMucmVuZGVyTGlua2VkU3RhdHVzKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMucmVuZGVyUGFpcmluZ0RldmljZU5hbWUoKTtcbiAgICAgIHRoaXMucmVuZGVyUGFpcmluZ1NlY3Rpb24oKTtcbiAgICB9XG4gIH1cblxuICAvKiogVW5saW5rZWQ6IHRoZSBuYW1lIGlzIGEgcGFpcmluZy10aW1lIGRlZmF1bHQgKGFwcGxpZXMgYXQgbmV4dCBwYWlyKS4gKi9cbiAgcHJpdmF0ZSByZW5kZXJQYWlyaW5nRGV2aWNlTmFtZSgpOiB2b2lkIHtcbiAgICBuZXcgU2V0dGluZyh0aGlzLmNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ0RldmljZSBuYW1lJylcbiAgICAgIC5zZXREZXNjKGBTaG93biBpbiB0aGUgd29ya2VyIGRhc2hib2FyZCdzIGRldmljZSBsaXN0LiBBcHBsaWVzIHdoZW4gKHJlKXBhaXJpbmcuYClcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PlxuICAgICAgICB0ZXh0XG4gICAgICAgICAgLnNldFBsYWNlaG9sZGVyKGRlZmF1bHREZXZpY2VOYW1lKCkpXG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMucGx1Z2luLmRhdGEuZGV2aWNlTmFtZSlcbiAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5kYXRhLmRldmljZU5hbWUgPSB2YWx1ZS50cmltKCk7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlUGx1Z2luRGF0YSgpO1xuICAgICAgICAgIH0pLFxuICAgICAgKTtcbiAgfVxuXG4gIC8qKiBMaW5rZWQ6IHRoZSBmaWVsZCBzaG93cyB0aGUgY3VycmVudCBuYW1lOyBSZW5hbWUgcHVzaGVzIGl0IHRvIHRoZSB3b3JrZXIuICovXG4gIHByaXZhdGUgcmVuZGVyTGlua2VkRGV2aWNlTmFtZSgpOiB2b2lkIHtcbiAgICBjb25zdCBjdXJyZW50ID0gdGhpcy5yZW5hbWVEcmFmdCA/PyB0aGlzLnBsdWdpbi5kYXRhLmRldmljZU5hbWU7XG4gICAgbmV3IFNldHRpbmcodGhpcy5jb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdEZXZpY2UgbmFtZScpXG4gICAgICAuc2V0RGVzYyhcbiAgICAgICAgJ1RoZSB3b3JrZXIgZGFzaGJvYXJkIHNob3dzIHRoaXMgbmFtZS4gRWRpdCBpdCBhbmQgcHJlc3MgXCJSZW5hbWUgZGV2aWNlXCIgdG8gdXBkYXRlIHRoaXMgZGV2aWNlIG9uIHRoZSB3b3JrZXIgKDEtMzAgY2hhcmFjdGVycykuJyxcbiAgICAgIClcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PlxuICAgICAgICB0ZXh0XG4gICAgICAgICAgLnNldFBsYWNlaG9sZGVyKGRlZmF1bHREZXZpY2VOYW1lKCkpXG4gICAgICAgICAgLnNldFZhbHVlKGN1cnJlbnQpXG4gICAgICAgICAgLm9uQ2hhbmdlKCh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5yZW5hbWVEcmFmdCA9IHZhbHVlO1xuICAgICAgICAgIH0pLFxuICAgICAgKVxuICAgICAgLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgICBidXR0b24uc2V0QnV0dG9uVGV4dCgnUmVuYW1lIGRldmljZScpLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGJ1dHRvbi5zZXREaXNhYmxlZCh0cnVlKTtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3Qgb2sgPSBhd2FpdCB0aGlzLnBsdWdpbi5yZW5hbWVEZXZpY2UodGhpcy5yZW5hbWVEcmFmdCA/PyB0aGlzLnBsdWdpbi5kYXRhLmRldmljZU5hbWUpO1xuICAgICAgICAgICAgaWYgKG9rKSB0aGlzLmRpc3BsYXkoKTsgLy8gcmUtcmVuZGVyIHdpdGggdGhlIHBlcnNpc3RlZCBuYW1lXG4gICAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICAgIGJ1dHRvbi5zZXREaXNhYmxlZChmYWxzZSk7XG4gICAgICAgICAgfVxuICAgICAgICB9KSxcbiAgICAgICk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlclBhaXJpbmdTZWN0aW9uKCk6IHZvaWQge1xuICAgIGNvbnN0IHsgY29udGFpbmVyRWwgfSA9IHRoaXM7XG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnUGFpcmluZyBjb2RlJylcbiAgICAgIC5zZXREZXNjKCdGcm9tIHlvdXIgd29ya2VyIGRhc2hib2FyZDogRGV2aWNlcyBcdTIxOTIgUGFpciBuZXcgZGV2aWNlLiBDb2RlcyBhcmUgb25lLXRpbWUgYW5kIGV4cGlyZSBhZnRlciAxMCBtaW51dGVzLicpXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT5cbiAgICAgICAgdGV4dFxuICAgICAgICAgIC5zZXRQbGFjZWhvbGRlcignN0YzSy1ROU0yJylcbiAgICAgICAgICAub25DaGFuZ2UoKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnBhaXJpbmdDb2RlID0gdmFsdWUudHJpbSgpO1xuICAgICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKS5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgIGJ1dHRvblxuICAgICAgICAuc2V0Q3RhKClcbiAgICAgICAgLnNldEJ1dHRvblRleHQoJ1BhaXIgdGhpcyB2YXVsdCcpXG4gICAgICAgIC5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICBidXR0b24uc2V0RGlzYWJsZWQodHJ1ZSk7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IG91dGNvbWUgPSBhd2FpdCB0aGlzLnBsdWdpbi5wYWlyRnJvbVNldHRpbmdzKHRoaXMucGFpcmluZ0NvZGUpO1xuICAgICAgICAgICAgdGhpcy5zaG93T3V0Y29tZShvdXRjb21lKTtcbiAgICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgICAgYnV0dG9uLnNldERpc2FibGVkKGZhbHNlKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pLFxuICAgICk7XG5cbiAgICB0aGlzLmhpbnRTZXR0aW5nID0gbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnR2V0dGluZyBzdGFydGVkJylcbiAgICAgIC5zZXRDbGFzcygndnNhLXNldHRpbmdzLWhpbnQnKVxuICAgICAgLnNldERlc2MoXG4gICAgICAgIFtcbiAgICAgICAgICAnMS4gRGVwbG95IHlvdXIgb3duIHdvcmtlciB3aXRoIHRoZSBidXR0b24gYmVsb3cgKHlvdXIgQ2xvdWRmbGFyZSBhY2NvdW50LCBwcmVjb25maWd1cmVkIFx1MjAxNCBubyB3cmFuZ2xlcikuJyxcbiAgICAgICAgICAnMi4gT3BlbiB0aGUgd29ya2VyIFVSTCBpbiBhIGJyb3dzZXIgYW5kIHNldCB0aGUgYWRtaW4gcGFzc3BocmFzZSAoY2xhaW0pLicsXG4gICAgICAgICAgJzMuIENyZWF0ZSBhIHBhaXJpbmcgY29kZSBvbiB0aGUgZGFzaGJvYXJkLCBwYXN0ZSBpdCBhYm92ZSwgYW5kIHBhaXIuJyxcbiAgICAgICAgICAnT24gYSBwaG9uZSwgc2Nhbm5pbmcgdGhlIGRhc2hib2FyZCBRUiBvciB0YXBwaW5nIGl0cyBvYnNpZGlhbjovLyBsaW5rIHBhaXJzIHdpdGhvdXQgdHlwaW5nLicsXG4gICAgICAgIF0uam9pbignXFxuJyksXG4gICAgICApXG4gICAgICAuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KCdEZXBsb3kgeW91ciB3b3JrZXInKS5vbkNsaWNrKCgpID0+IG9wZW5EZXBsb3lQYWdlKCkpLFxuICAgICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyTGlua2VkU3RhdHVzKCk6IHZvaWQge1xuICAgIGNvbnN0IHsgY29udGFpbmVyRWwgfSA9IHRoaXM7XG5cbiAgICB0aGlzLnN0YXR1c1NldHRpbmcgPSBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdTdGF0dXMnKVxuICAgICAgLnNldENsYXNzKCd2c2Etc3RhdHVzLXJlYWRvdXQnKVxuICAgICAgLnNldERlc2ModGhpcy5zdGF0dXNUZXh0KCkpO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoJ1N5bmMgbm93Jykub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgIGJ1dHRvbi5zZXREaXNhYmxlZCh0cnVlKTtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zeW5jTm93KCk7XG4gICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgYnV0dG9uLnNldERpc2FibGVkKGZhbHNlKTtcbiAgICAgICAgICB0aGlzLnJlZnJlc2hTdGF0dXMoKTtcbiAgICAgICAgfVxuICAgICAgfSksXG4gICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKS5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KCdVbmxpbmsgdGhpcyB2YXVsdCcpLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgICBuZXcgQ29uZmlybU1vZGFsKHRoaXMuYXBwLCB7XG4gICAgICAgICAgdGl0bGU6ICdVbmxpbmsgVmF1bHRTeW5jPycsXG4gICAgICAgICAgYm9keTogJ1RoaXMgc3RvcHMgc3luY2luZyBhbmQgY2xlYXJzIHRoaXMgZGV2aWNlXFx1MjAxOXMgbG9jYWwgc3luYyBzdGF0ZS4gRmlsZXMgYWxyZWFkeSBpbiB0aGUgdmF1bHQgYXJlIHVudG91Y2hlZC4gVGhlIHdvcmtlciBrZWVwcyB0aGlzIGRldmljZSBpbiBpdHMgcmVnaXN0cnkgXFx1MjAxNCByZXZva2UgaXQgZnJvbSB0aGUgZGFzaGJvYXJkIGlmIHlvdSBhcmUgZG9uZSB3aXRoIGl0LicsXG4gICAgICAgICAgY29uZmlybVRleHQ6ICdVbmxpbmsnLFxuICAgICAgICAgIG9uQ29uZmlybTogYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4udW5saW5rKCk7XG4gICAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAgICAgICB9LFxuICAgICAgICB9KS5vcGVuKCk7XG4gICAgICB9KSxcbiAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJTeW5jU2VjdGlvbigpOiB2b2lkIHtcbiAgICBjb25zdCB7IGNvbnRhaW5lckVsIH0gPSB0aGlzO1xuICAgIGNvbnN0IGRhdGEgPSB0aGlzLnBsdWdpbi5kYXRhO1xuICAgIHRoaXMuaGVhZGluZygnU3luYycpO1xuXG4gICAgaWYgKHRoaXMucGx1Z2luLmxpbmtlZCkge1xuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKCdSZXNjYW4gaW50ZXJ2YWwnKVxuICAgICAgICAuc2V0RGVzYyhcbiAgICAgICAgICAnUGVyaW9kaWMgZnVsbCByZWNvbmNpbGlhdGlvbiBcdTIwMTQgY2F0Y2hlcyBleHRlcm5hbCBlZGl0cyB3aGlsZSBPYnNpZGlhbiBpcyBvcGVuIGFuZCBjb3ZlcnMgbW9iaWxlIGJhY2tncm91bmQgbGltaXRzLiBWYXVsdCBldmVudHMgYW5kIGFwcC1vcGVuIHN5bmMgYWx3YXlzIHJ1bi4nLFxuICAgICAgICApXG4gICAgICAgIC5hZGREcm9wZG93bigoZHJvcGRvd24pID0+IHtcbiAgICAgICAgICBmb3IgKGNvbnN0IGNob2ljZSBvZiBSRVNDQU5fSU5URVJWQUxfQ0hPSUNFUykge1xuICAgICAgICAgICAgZHJvcGRvd24uYWRkT3B0aW9uKFN0cmluZyhjaG9pY2UudmFsdWUpLCBjaG9pY2UubGFiZWwpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBkcm9wZG93bi5zZXRWYWx1ZShTdHJpbmcoZGF0YS5zZXR0aW5ncy5yZXNjYW5JbnRlcnZhbFNlYykpO1xuICAgICAgICAgIGRyb3Bkb3duLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uYXBwbHlSZXNjYW5JbnRlcnZhbChOdW1iZXIodmFsdWUpKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZSgnU3luYyAub2JzaWRpYW4vIGZvbGRlcicpXG4gICAgICAgIC5zZXREZXNjKFxuICAgICAgICAgICdPcHQgaW4gdG8gc3luY2luZyAub2JzaWRpYW4vIChzZXR0aW5ncyBhbmQgcGx1Z2lucyksIGV4Y2x1ZGluZyB3b3Jrc3BhY2UuanNvbiBhbmQgY2FjaGVzLiAnICtcbiAgICAgICAgICAgICdUaGUgd29ya2VyXFx1MjAxOXMgcGVyLXZhdWx0IHNldHRpbmcgdGFrZXMgcHJlY2VkZW5jZSBvbmNlIGNvbm5lY3RlZC4nLFxuICAgICAgICApXG4gICAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgICB0b2dnbGUuc2V0VmFsdWUoZGF0YS5zZXR0aW5ncy5vYnNpZGlhblN5bmMpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uYXBwbHlPYnNpZGlhblN5bmModmFsdWUpO1xuICAgICAgICAgIH0pLFxuICAgICAgICApO1xuXG4gICAgICBjb25zdCBwYXVzZWQgPSB0aGlzLnBsdWdpbi5zeW5jaW5nUGF1c2VkO1xuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKHBhdXNlZCA/ICdTeW5jaW5nIHBhdXNlZCcgOiAnUGF1c2Ugc3luY2luZycpXG4gICAgICAgIC5zZXREZXNjKFxuICAgICAgICAgIHBhdXNlZFxuICAgICAgICAgICAgPyAnU3luY2luZyBpcyBwYXVzZWQ6IHRoZSBjb25uZWN0aW9uIGlzIGRvd24gYW5kIHZhdWx0IGNoYW5nZXMgc3RheSBsb2NhbC4gUmVzdW1lIHJlY29ubmVjdHMgYW5kIHJ1bnMgYSBmdWxsIGNhdGNoLXVwIHN5bmMuJ1xuICAgICAgICAgICAgOiAnVGVtcG9yYXJpbHkgc3RvcCBzeW5jaW5nIHdpdGhvdXQgdW5saW5raW5nIFx1MjAxNCB0aGUgdHJhbnNwb3J0IGRpc2Nvbm5lY3RzIGFuZCB0aGUgd2F0Y2hlciBnb2VzIGlkbGUuIFlvdXIgbGluayBhbmQgbG9jYWwgc3RhdGUgYXJlIGtlcHQuJyxcbiAgICAgICAgKVxuICAgICAgICAuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICAgICAgYnV0dG9uXG4gICAgICAgICAgICAuc2V0QnV0dG9uVGV4dChwYXVzZWQgPyAnUmVzdW1lIHN5bmNpbmcnIDogJ1BhdXNlIHN5bmNpbmcnKVxuICAgICAgICAgICAgLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgICBidXR0b24uc2V0RGlzYWJsZWQodHJ1ZSk7XG4gICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgaWYgKHBhdXNlZCkgYXdhaXQgdGhpcy5wbHVnaW4ucmVzdW1lU3luY2luZygpO1xuICAgICAgICAgICAgICAgIGVsc2UgdGhpcy5wbHVnaW4ucGF1c2VTeW5jaW5nKCk7XG4gICAgICAgICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICAgICAgdGhpcy5kaXNwbGF5KCk7IC8vIHJlLXJlbmRlcjogdGhlIGJ1dHRvbiAoYW5kIGxhYmVsKSBmbGlwXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pLFxuICAgICAgICApO1xuICAgIH1cblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ1N5bmMgb24gc3RhcnR1cCcpXG4gICAgICAuc2V0RGVzYyhcbiAgICAgICAgJ09OIChkZWZhdWx0KTogc3luYyBzdGFydHMgYXMgc29vbiBhcyBPYnNpZGlhbiBvcGVucy4gT0ZGOiB0aGUgcGx1Z2luIGxvYWRzIGlkbGUgYW5kIHRoZSBmaXJzdCBcIlN5bmMgbm93XCIgcHJlc3Mgc3RhcnRzIHN5bmNpbmcgKG1hbnVhbC1vbmx5IG1vZGUpLicsXG4gICAgICApXG4gICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgIHRvZ2dsZS5zZXRWYWx1ZShkYXRhLnNldHRpbmdzLnN5bmNPblN0YXJ0dXApLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLmFwcGx5U3luY09uU3RhcnR1cCh2YWx1ZSk7XG4gICAgICAgIH0pLFxuICAgICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyQWR2YW5jZWRTZWN0aW9uKCk6IHZvaWQge1xuICAgIGNvbnN0IHsgY29udGFpbmVyRWwgfSA9IHRoaXM7XG4gICAgY29uc3QgZGF0YSA9IHRoaXMucGx1Z2luLmRhdGE7XG4gICAgdGhpcy5oZWFkaW5nKCdBZHZhbmNlZCcpO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnU3RhdHVzIGJhciBpbmRpY2F0b3InKVxuICAgICAgLnNldERlc2MoXG4gICAgICAgICdEZXRhaWxlZDogXCJ2c2EgXHUyNzEzIDEyc1wiIHdpdGggc3RhdGUgYW5kIGFnZS4gQ29tcGFjdDoganVzdCB0aGUgc3ltYm9sLiBIaWRkZW46IG5vIHN0YXR1cyBiYXIgaXRlbSBhdCBhbGwuJyxcbiAgICAgIClcbiAgICAgIC5hZGREcm9wZG93bigoZHJvcGRvd24pID0+IHtcbiAgICAgICAgZHJvcGRvd24uYWRkT3B0aW9uKCdkZXRhaWxlZCcsICdEZXRhaWxlZCcpO1xuICAgICAgICBkcm9wZG93bi5hZGRPcHRpb24oJ2NvbXBhY3QnLCAnQ29tcGFjdCcpO1xuICAgICAgICBkcm9wZG93bi5hZGRPcHRpb24oJ2hpZGRlbicsICdIaWRkZW4nKTtcbiAgICAgICAgZHJvcGRvd24uc2V0VmFsdWUoZGF0YS5zZXR0aW5ncy5zdGF0dXNCYXJNb2RlKTtcbiAgICAgICAgZHJvcGRvd24ub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uYXBwbHlTdGF0dXNCYXJNb2RlKFxuICAgICAgICAgICAgdmFsdWUgPT09ICdjb21wYWN0JyB8fCB2YWx1ZSA9PT0gJ2hpZGRlbicgPyB2YWx1ZSA6ICdkZXRhaWxlZCcsXG4gICAgICAgICAgKTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ0lnbm9yZSBwYXR0ZXJucycpXG4gICAgICAuc2V0RGVzYyhcbiAgICAgICAgJ09uZSBwYXR0ZXJuIHBlciBsaW5lLCBlLmcuIHByaXZhdGUvKiogb3IgKi50bXAuIEdsb2ItbGl0ZTogKiBtYXRjaGVzIHdpdGhpbiBvbmUgZm9sZGVyIG5hbWUsICoqIHNwYW5zIGZvbGRlcnMgKGRpci8qKiBza2lwcyB0aGUgZm9sZGVyIGFuZCBldmVyeXRoaW5nIGluIGl0KTsgYSBwYXR0ZXJuIHdpdGhvdXQgLyBtYXRjaGVzIGZpbGUgbmFtZXMgYXQgYW55IGRlcHRoLiBDYXNlLWluc2Vuc2l0aXZlOyBhcHBsaWVzIG9uIHRoaXMgZGV2aWNlIG9ubHk7IHNhdmluZyByZWNvbm5lY3RzIHN5bmMgdG8gYXBwbHkgdGhlbS4nLFxuICAgICAgKVxuICAgICAgLmFkZFRleHRBcmVhKChhcmVhKSA9PlxuICAgICAgICBhcmVhXG4gICAgICAgICAgLnNldFBsYWNlaG9sZGVyKCdwcml2YXRlLyoqXFxuKi50bXAnKVxuICAgICAgICAgIC5zZXRWYWx1ZShkYXRhLnNldHRpbmdzLmlnbm9yZVBhdHRlcm5zKVxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLmFwcGx5SWdub3JlUGF0dGVybnModmFsdWUpO1xuICAgICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ0RpYWdub3N0aWNzIGxvZyBsZXZlbCcpXG4gICAgICAuc2V0RGVzYyhcbiAgICAgICAgJ2luZm8gKGRlZmF1bHQpIHJlY29yZHMgbGlmZWN5Y2xlIGV2ZW50czsgZGVidWcgYWRkaXRpb25hbGx5IGxvZ3MgcHJvdG9jb2wgcm91bmQtdHJpcHMgKG9uZSBzaG9ydCBsaW5lIHBlciBmcmFtZSk7IHdhcm4ga2VlcHMgb25seSB3YXJuaW5ncyBhbmQgZXJyb3JzLicsXG4gICAgICApXG4gICAgICAuYWRkRHJvcGRvd24oKGRyb3Bkb3duKSA9PiB7XG4gICAgICAgIGRyb3Bkb3duLmFkZE9wdGlvbignaW5mbycsICdpbmZvJyk7XG4gICAgICAgIGRyb3Bkb3duLmFkZE9wdGlvbignZGVidWcnLCAnZGVidWcnKTtcbiAgICAgICAgZHJvcGRvd24uYWRkT3B0aW9uKCd3YXJuJywgJ3dhcm4nKTtcbiAgICAgICAgZHJvcGRvd24uc2V0VmFsdWUoZGF0YS5zZXR0aW5ncy5sb2dMZXZlbCk7XG4gICAgICAgIGRyb3Bkb3duLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIGNvbnN0IGxldmVsOiBMb2dMZXZlbCA9IHZhbHVlID09PSAnZGVidWcnIHx8IHZhbHVlID09PSAnd2FybicgPyB2YWx1ZSA6ICdpbmZvJztcbiAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5hcHBseUxvZ0xldmVsKGxldmVsKTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ0NvcHkgZGlhZ25vc3RpY3MnKVxuICAgICAgLnNldERlc2MoXG4gICAgICAgICdDb3BpZXMgYSBidWctcmVwb3J0IGJ1bmRsZTogcGx1Z2luICsgcHJvdG9jb2wgdmVyc2lvbnMsIGRldmljZSwgd29ya2VyIFVSTCwgcGFpcmluZyBzdGF0ZSwgYSBzdGF0dXMgc25hcHNob3QsIHRoZSBwbGF0Zm9ybSwgYW5kIHRoZSBsYXN0IDIwIGxvZyBsaW5lcy4nLFxuICAgICAgKVxuICAgICAgLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgICBidXR0b24uc2V0QnV0dG9uVGV4dCgnQ29weSBkaWFnbm9zdGljcycpLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGJ1dHRvbi5zZXREaXNhYmxlZCh0cnVlKTtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uY29weURpYWdub3N0aWNzKCk7XG4gICAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICAgIGJ1dHRvbi5zZXREaXNhYmxlZChmYWxzZSk7XG4gICAgICAgICAgfVxuICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdTYXZlIHN1cHBvcnQgYnVuZGxlJylcbiAgICAgIC5zZXREZXNjKFxuICAgICAgICAnV3JpdGVzIGEgcmljaGVyIG1hcmtkb3duIGRpYWdub3N0aWMgZmlsZSAodmVyc2lvbnMsIHNldHRpbmdzLCBzeW5jIHN0YXRlLCByZWNlbnQgbG9nKSB0byAudmF1bHRzeW5jZm9yYWdlbnRzLyBpbiB0aGlzIHZhdWx0IFx1MjAxNCBhdHRhY2ggaXQgdG8gYnVnIHJlcG9ydHMuIEl0IG5ldmVyIGNvbnRhaW5zIG5vdGUgY29udGVudHMgb3IgdGhlIGRldmljZSB0b2tlbi4nLFxuICAgICAgKVxuICAgICAgLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgICBidXR0b24uc2V0QnV0dG9uVGV4dCgnU2F2ZSBzdXBwb3J0IGJ1bmRsZScpLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGJ1dHRvbi5zZXREaXNhYmxlZCh0cnVlKTtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVN1cHBvcnRCdW5kbGUoKTtcbiAgICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgICAgYnV0dG9uLnNldERpc2FibGVkKGZhbHNlKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pLFxuICAgICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyQWJvdXRTZWN0aW9uKCk6IHZvaWQge1xuICAgIGNvbnN0IHsgY29udGFpbmVyRWwgfSA9IHRoaXM7XG4gICAgdGhpcy5oZWFkaW5nKCdBYm91dCcpO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnVmVyc2lvbnMnKVxuICAgICAgLnNldERlc2MoXG4gICAgICAgIGBQbHVnaW4gJHt0aGlzLnBsdWdpbi5tYW5pZmVzdC52ZXJzaW9uIHx8ICd1bmtub3duJ30gXHUwMEI3IHByb3RvY29sIHYke1BST1RPQ09MX1ZFUlNJT059IFx1MDBCNyAke3RoaXMucGx1Z2luLnBsYXRmb3JtU3VtbWFyeSgpfWAsXG4gICAgICApO1xuXG4gICAgdGhpcy5zZXJ2ZXJWZXJzaW9uU2V0dGluZyA9IG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ1NlcnZlciB2ZXJzaW9uJylcbiAgICAgIC5zZXREZXNjKHRoaXMuc2VydmVyVmVyc2lvblRleHQoKSk7XG4gICAgdGhpcy5yZWZyZXNoU2VydmVyVmVyc2lvbigpO1xuXG4gICAgdGhpcy5zdG9yYWdlU2V0dGluZyA9IG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ1ZhdWx0IHN0b3JhZ2UnKVxuICAgICAgLnNldERlc2ModGhpcy5wbHVnaW4ubGlua2VkID8gJ0NoZWNraW5nIHRoZSB3b3JrZXJcdTIwMjYnIDogJ1BhaXIgdGhpcyB2YXVsdCB0byBzZWUgc3RvcmFnZSB1c2FnZS4nKTtcbiAgICBpZiAodGhpcy5wbHVnaW4ubGlua2VkKSB2b2lkIHRoaXMucmVmcmVzaFN0b3JhZ2UoKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ1Byb2plY3QgaG9tZScpXG4gICAgICAuc2V0RGVzYyhgRG9jdW1lbnRhdGlvbiBhbmQgc291cmNlOiAke1BST0pFQ1RfUkVBRE1FX1VSTH1gKVxuICAgICAgLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgICBidXR0b24uc2V0QnV0dG9uVGV4dCgnT3BlbiBSRUFETUUnKS5vbkNsaWNrKCgpID0+IG9wZW5SZWFkbWVQYWdlKCkpLFxuICAgICAgKTtcbiAgfVxuXG4gIC8qKiBGaWxsIHRoZSBBYm91dCBzdG9yYWdlIGxpbmUgZnJvbSAvYXBpL3N0YXR1cyAoZGV2aWNlLXRva2VuIGF1dGgpLiAqL1xuICBwcml2YXRlIGFzeW5jIHJlZnJlc2hTdG9yYWdlKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHN1bW1hcnkgPSBhd2FpdCB0aGlzLnBsdWdpbi5mZXRjaFN0b3JhZ2VTdW1tYXJ5KCk7XG4gICAgY29uc3QgZGVzYyA9XG4gICAgICBzdW1tYXJ5ID09PSBudWxsXG4gICAgICAgID8gJ1N0b3JhZ2UgdXNhZ2UgaXMgY3VycmVudGx5IHVuYXZhaWxhYmxlICh0aGUgd29ya2VyIGlzIHVucmVhY2hhYmxlKS4nXG4gICAgICAgIDogYFN0b3JhZ2UgdXNlZDogJHtmb3JtYXRCeXRlcyhzdW1tYXJ5LnN0b3JhZ2VCeXRlcyl9IFx1MDBCNyAke3N1bW1hcnkuYXR0YWNobWVudHMuY291bnR9IGF0dGFjaG1lbnQke1xuICAgICAgICAgICAgc3VtbWFyeS5hdHRhY2htZW50cy5jb3VudCA9PT0gMSA/ICcnIDogJ3MnXG4gICAgICAgICAgfSAoJHtmb3JtYXRCeXRlcyhzdW1tYXJ5LmF0dGFjaG1lbnRzLmJ5dGVzKX0pYCArXG4gICAgICAgICAgKHN1bW1hcnkuZGV2aWNlcy5sZW5ndGggPiAwXG4gICAgICAgICAgICA/IGAgXHUwMEI3ICR7c3VtbWFyeS5kZXZpY2VzLmxlbmd0aH0gZGV2aWNlJHtzdW1tYXJ5LmRldmljZXMubGVuZ3RoID09PSAxID8gJycgOiAncyd9YFxuICAgICAgICAgICAgOiAnJyk7XG4gICAgLy8gVGhlIHRhYiBtYXkgaGF2ZSBiZWVuIGNsb3NlZC9yZS1yZW5kZXJlZCBtZWFud2hpbGU7IHBhaW50IG9ubHkgaWYgbGl2ZS5cbiAgICBpZiAodGhpcy5zdG9yYWdlU2V0dGluZyAhPT0gbnVsbCkgdGhpcy5zdG9yYWdlU2V0dGluZy5zZXREZXNjKGRlc2MpO1xuICB9XG5cbiAgLy8gLS0tIHN0YXR1cyAvIGZlZWRiYWNrIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgcHJpdmF0ZSBzdGF0dXNUZXh0KCk6IHN0cmluZyB7XG4gICAgY29uc3QgZGF0YTogVmF1bHRTeW5jUGx1Z2luRGF0YSA9IHRoaXMucGx1Z2luLmRhdGE7XG4gICAgY29uc3Qgc3RhdHVzID0gdGhpcy5wbHVnaW4uY2xpZW50Py5zdGF0dXMoKTtcbiAgICBpZiAodGhpcy5wbHVnaW4uc3luY2luZ1BhdXNlZCkge1xuICAgICAgcmV0dXJuIFtcbiAgICAgICAgJ1N0YXRlOiBwYXVzZWQnLFxuICAgICAgICBgV29ya2VyOiAke2RhdGEudXJsfWAsXG4gICAgICAgICdWYXVsdCBjaGFuZ2VzIHN0YXkgbG9jYWwgdW50aWwgeW91IHJlc3VtZSBzeW5jaW5nLicsXG4gICAgICBdLmpvaW4oJ1xcbicpO1xuICAgIH1cbiAgICBpZiAoc3RhdHVzID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHJldHVybiBgTGlua2VkIHRvICR7ZGF0YS51cmx9IChkZXZpY2UgJHtkYXRhLmRldmljZU5hbWUgfHwgZGF0YS5kZXZpY2VJZH0pLmA7XG4gICAgfVxuICAgIGNvbnN0IGxhc3RTeW5jID1cbiAgICAgIHN0YXR1cy5sYXN0U3luY0F0ID09PSBudWxsXG4gICAgICAgID8gJ25ldmVyJ1xuICAgICAgICA6IGAke2Zvcm1hdFNpbmNlKERhdGUubm93KCkgLSBzdGF0dXMubGFzdFN5bmNBdCl9IGFnb2A7XG4gICAgY29uc3Qgc3RhdGUgPSBzdGF0dXMuc3RhdGUgPT09ICdsaXZlJyA/ICdjb25uZWN0ZWQnIDogc3RhdHVzLnN0YXRlO1xuICAgIGNvbnN0IGxpbmVzID0gW2BTdGF0ZTogJHtzdGF0ZX1gLCBgV29ya2VyOiAke2RhdGEudXJsfWAsIGBMYXN0IHN5bmM6ICR7bGFzdFN5bmN9YF07XG4gICAgLy8gQnVsay1waGFzZSBwcm9ncmVzcyBcdTIwMTQgdGhlIHNhbWUgWC9ZIHRoZSBzdGF0dXMgYmFyIHNob3dzIGR1cmluZyBhXG4gICAgLy8gbXVsdGktbWludXRlIGluaXRpYWwgc3luYy5cbiAgICBpZiAoc3RhdHVzLnByb2dyZXNzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGxpbmVzLnB1c2goYFN5bmNpbmc6ICR7c3RhdHVzLnByb2dyZXNzLmRvbmV9LyR7c3RhdHVzLnByb2dyZXNzLnRvdGFsfSAoJHtzdGF0dXMucHJvZ3Jlc3MucGhhc2V9KWApO1xuICAgIH1cbiAgICBsaW5lcy5wdXNoKFxuICAgICAgYFBlbmRpbmcgY2hhbmdlczogJHtzdGF0dXMucGVuZGluZ31gLFxuICAgICAgYENvbmZsaWN0czogJHtzdGF0dXMuY29uZmxpY3RzLmxlbmd0aH0ke3N0YXR1cy5jb25mbGljdHMubGVuZ3RoID4gMCA/ICcgKGNvbmZsaWN0IGNvcGllcyB3ZXJlIHdyaXR0ZW4gaW50byB0aGUgdmF1bHQpJyA6ICcnfWAsXG4gICAgKTtcbiAgICByZXR1cm4gbGluZXMuam9pbignXFxuJyk7XG4gIH1cblxuICBwcml2YXRlIHJlZnJlc2hTdGF0dXMoKTogdm9pZCB7XG4gICAgdGhpcy5zdGF0dXNTZXR0aW5nPy5zZXREZXNjKHRoaXMuc3RhdHVzVGV4dCgpKTtcbiAgICB0aGlzLnJlZnJlc2hTZXJ2ZXJWZXJzaW9uKCk7XG4gIH1cblxuICAvKipcbiAgICogVGhlIEFib3V0IHNlY3Rpb24ncyBzZXJ2ZXItdmVyc2lvbiBsaW5lOiB0aGUgaGVsbG9BY2stcmVwb3J0ZWQgdmVyc2lvblxuICAgKiBwbHVzIHRoZSBjb21wYXQgdmVyZGljdCB3aGVuIGl0IGlzIG5vdCBvay4gYHNlcnZlclZlcnNpb25gIG1heSBsYWcgdGhlXG4gICAqIHZlcmRpY3QgYnkgYSB0aWNrICh0aGUgcGx1Z2luIGFzc2Vzc2VzIG9uIGl0cyBvd24gMSBIeiBzdXBlcnZpc2lvbiksIHNvXG4gICAqIHRoZSB2ZXJkaWN0IG1lc3NhZ2UgaXMgYXV0aG9yaXRhdGl2ZSB3aGVuIHByZXNlbnQuXG4gICAqL1xuICBwcml2YXRlIHNlcnZlclZlcnNpb25UZXh0KCk6IHN0cmluZyB7XG4gICAgaWYgKCF0aGlzLnBsdWdpbi5saW5rZWQpIHJldHVybiAnUGFpciB0aGlzIHZhdWx0IHRvIHNlZSB0aGUgd29ya2VyIHZlcnNpb24uJztcbiAgICBjb25zdCBzdGF0dXMgPSB0aGlzLnBsdWdpbi5jbGllbnQ/LnN0YXR1cygpO1xuICAgIGNvbnN0IHZlcmRpY3QgPSB0aGlzLnBsdWdpbi5zZXJ2ZXJDb21wYXRpYmlsaXR5O1xuICAgIGlmICh2ZXJkaWN0ICE9PSBudWxsICYmIHZlcmRpY3QubGV2ZWwgIT09ICdvaycpIHJldHVybiB2ZXJkaWN0Lm1lc3NhZ2U7XG4gICAgY29uc3QgdmVyc2lvbiA9IHN0YXR1cz8uc2VydmVyVmVyc2lvbiA/PyBudWxsO1xuICAgIHJldHVybiB2ZXJzaW9uID09PSBudWxsXG4gICAgICA/ICdVbmtub3duIFx1MjAxNCB0aGUgd29ya2VyIGhhcyBub3QgcmVwb3J0ZWQgYSB2ZXJzaW9uIHlldC4nXG4gICAgICA6IGBTZXJ2ZXIgJHt2ZXJzaW9ufSBcdTAwQjcgY29tcGF0aWJsZSB3aXRoIHRoaXMgcGx1Z2luLmA7XG4gIH1cblxuICAvKiogUmVwYWludCB0aGUgc2VydmVyLXZlcnNpb24gcm93IChjYWxsZWQgYnkgdGhlIDEgSHogcmVmcmVzaCBsb29wKS4gKi9cbiAgcHJpdmF0ZSByZWZyZXNoU2VydmVyVmVyc2lvbigpOiB2b2lkIHtcbiAgICAvLyBUaGUgdGFiIG1heSBoYXZlIGJlZW4gY2xvc2VkL3JlLXJlbmRlcmVkIG1lYW53aGlsZTsgcGFpbnQgb25seSBpZiBsaXZlLlxuICAgIGlmICh0aGlzLnNlcnZlclZlcnNpb25TZXR0aW5nICE9PSBudWxsKSB0aGlzLnNlcnZlclZlcnNpb25TZXR0aW5nLnNldERlc2ModGhpcy5zZXJ2ZXJWZXJzaW9uVGV4dCgpKTtcbiAgfVxuXG4gIC8qKiBQYWlyIGZlZWRiYWNrOiBzdWNjZXNzIHJlLXJlbmRlcnM7IGZhaWx1cmVzIGxhbmQgaW4gdGhlIGhpbnQgU2V0dGluZy4gKi9cbiAgcHJpdmF0ZSBzaG93T3V0Y29tZShvdXRjb21lOiBQYWlyT3V0Y29tZSk6IHZvaWQge1xuICAgIGlmIChvdXRjb21lLnN0YXR1cyA9PT0gJ3BhaXJlZCcpIHtcbiAgICAgIG5ldyBOb3RpY2UocGFpck91dGNvbWVNZXNzYWdlKG91dGNvbWUpKTtcbiAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBtZXNzYWdlID0gcGFpck91dGNvbWVNZXNzYWdlKG91dGNvbWUpO1xuICAgIG5ldyBOb3RpY2UobWVzc2FnZSwgMTAwMDApO1xuICAgIGlmICh0aGlzLmhpbnRTZXR0aW5nICE9PSBudWxsKSB0aGlzLmhpbnRTZXR0aW5nLnNldERlc2MobWVzc2FnZSk7XG4gIH1cblxuICAvLyAtLS0gbGl2ZSByZWZyZXNoIGxvb3AgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgLyoqIFJlZnJlc2ggdGhlIHN0YXR1cyByZWFkb3V0IH4xIEh6IHdoaWxlIHRoZSB0YWIgaXMgb3Blbi4gKi9cbiAgcHJpdmF0ZSBzdGFydFJlZnJlc2goKTogdm9pZCB7XG4gICAgdGhpcy5zdG9wUmVmcmVzaCgpO1xuICAgIGNvbnN0IGhhbmRsZSA9IHNldEludGVydmFsKCgpID0+IHRoaXMucmVmcmVzaFN0YXR1cygpLCAxMDAwKTtcbiAgICB0aGlzLnJlZnJlc2hIYW5kbGUgPSBoYW5kbGU7XG4gICAgLy8gT2JzaWRpYW4gY2xlYXJzIHJlZ2lzdGVyZWQgaW50ZXJ2YWxzIHdoZW4gdGhlIHBsdWdpbiB1bmxvYWRzIFx1MjAxNCBubyBsZWFrXG4gICAgLy8gZXZlbiBpZiB0aGUgc2V0dGluZ3MgbW9kYWwgaXMgZm9yY2UtY2xvc2VkLlxuICAgIHRoaXMucGx1Z2luLnJlZ2lzdGVySW50ZXJ2YWwoaGFuZGxlIGFzIHVua25vd24gYXMgbnVtYmVyKTtcbiAgfVxuXG4gIHByaXZhdGUgc3RvcFJlZnJlc2goKTogdm9pZCB7XG4gICAgaWYgKHRoaXMucmVmcmVzaEhhbmRsZSAhPT0gbnVsbCkge1xuICAgICAgY2xlYXJJbnRlcnZhbCh0aGlzLnJlZnJlc2hIYW5kbGUpO1xuICAgICAgdGhpcy5yZWZyZXNoSGFuZGxlID0gbnVsbDtcbiAgICB9XG4gIH1cbn1cbiIsICIvKipcbiAqIFN0YXR1cy1iYXIgaW5kaWNhdG9yIChwbHVnaW4gc2NvcGUgaXRlbSAjNSk6IGEgc21hbGwgcGFzc2l2ZSB2aWV3IG92ZXJcbiAqIGBTeW5jQ2xpZW50U3RhdHVzYCwgcmVwYWludGVkIGJ5IHRoZSBwbHVnaW4ncyAxIHMgc3VwZXJ2aXNpb24gdGljay5cbiAqXG4gKiAgIHZzYSBcdTIyRUYgICAgICAgICAgICAgIGNvbm5lY3RpbmcgLyBzeW5jaW5nXG4gKiAgIHZzYSBcdTIyRUYgMTIzNC81MDAwICAgIHN5bmNpbmcsIGJ1bGsgcGhhc2UgcHJvZ3Jlc3MgKHNjYW5uaW5nL3B1c2hpbmcvcHVsbGluZylcbiAqICAgdnNhIFx1MjcxMyAxMnMgICAgICAgICAgbGl2ZSwgbGFzdCBjb21wbGV0ZWQgY3ljbGUgMTIgcyBhZ29cbiAqICAgdnNhIFx1MjZBMCBjb25mbGljdHM6IDIgY29uZmxpY3RzIG9ic2VydmVkIChjb25mbGljdCBjb3BpZXMgZXhpc3QgaW4gdGhlIHZhdWx0KVxuICogICB2c2EgXHUyNzE3IG9mZmxpbmUgICAgICBkaXNjb25uZWN0ZWQgKHJlY29ubmVjdCBiYWNrb2ZmIHJ1bm5pbmcpXG4gKiAgIHZzYSBcdTIzRjggICAgICAgICAgICAgIHN5bmNpbmcgcGF1c2VkICh0aGUgUGF1c2Ugc3luY2luZyBzZXR0aW5nKVxuICpcbiAqIENvbXBhY3QgbW9kZSBkcm9wcyB0aGUgdHJhaWxpbmcgZGV0YWlsIChcInZzYSBcdTI3MTMgMTJzXCIgXHUyMTkyIFwidnNhIFx1MjcxM1wiLCBldGMuKTtcbiAqIEhpZGRlbiBtb2RlIHJlbW92ZXMgdGhlIGl0ZW0gZW50aXJlbHkgKHRoZSBwbHVnaW4gbmV2ZXIgbW91bnRzIGl0KS5cbiAqXG4gKiBUaGUgdG9vbHRpcCBjYXJyaWVzIHRoZSBkZXRhaWw6IHN0YXRlLCB3b3JrZXIgVVJMLCBkZXZpY2UsIGxhc3Qgc3luYywgcGVuZGluZy5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IFN5bmNDbGllbnRTdGF0dXMgfSBmcm9tICdAdnNhL2NvcmUnO1xuXG4vKiogSG93IHRoZSBzdGF0dXMtYmFyIGluZGljYXRvciByZW5kZXJzICh0aGUgXCJTdGF0dXMgYmFyIGluZGljYXRvclwiIHNldHRpbmcpLiAqL1xuZXhwb3J0IHR5cGUgU3RhdHVzQmFyTW9kZSA9ICdkZXRhaWxlZCcgfCAnY29tcGFjdCcgfCAnaGlkZGVuJztcblxuLyoqIFRoZSBzbGljZSBvZiBIVE1MRWxlbWVudCB0aGUgaW5kaWNhdG9yIHRvdWNoZXMgKHRlc3RzIHBhc3MgYSBwbGFpbiBvYmplY3QpLiAqL1xuZXhwb3J0IGludGVyZmFjZSBTdGF0dXNJdGVtTGlrZSB7XG4gIHRleHRDb250ZW50OiBzdHJpbmc7XG4gIGFkZENsYXNzPyhjbHM6IHN0cmluZyk6IHVua25vd247XG4gIHJlbW92ZUNsYXNzPyhjbHM6IHN0cmluZyk6IHVua25vd247XG4gIHNldEF0dHJpYnV0ZT8obmFtZTogc3RyaW5nLCB2YWx1ZTogc3RyaW5nKTogdW5rbm93bjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBTdGF0dXNDb250ZXh0IHtcbiAgdXJsOiBzdHJpbmc7XG4gIGRldmljZU5hbWU6IHN0cmluZztcbiAgLyoqIEV4dHJhIGxpbmUgKGUuZy4gYW4gYXV0aCBmYWlsdXJlIG5vdGUpIGFwcGVuZGVkIHRvIHRoZSB0b29sdGlwLiAqL1xuICBub3RlPzogc3RyaW5nO1xuICAvKiogU3luY2luZyBpcyBwYXVzZWQgKHRoZSBQYXVzZSBzeW5jaW5nIGJ1dHRvbikgXHUyMDE0IHNob3dzIFwidnNhIFx1MjNGOFwiLiAqL1xuICBwYXVzZWQ/OiBib29sZWFuO1xuICAvKiogSW5kaWNhdG9yIG1vZGUgKHRoZSBwbHVnaW4ncyBzdGF0dXMgYmFyIHNldHRpbmcpOyBkZWZhdWx0IGRldGFpbGVkLiAqL1xuICBtb2RlPzogU3RhdHVzQmFyTW9kZTtcbn1cblxuLyoqIGBub3cgLSBzaW5jZWAsIGZsb29yZWQ6IGAxMnNgLCBgNW1gLCBgM2hgIFx1MjAxNCBkaXNwbGF5IG9ubHkuICovXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0U2luY2UoZWxhcHNlZE1zOiBudW1iZXIpOiBzdHJpbmcge1xuICBjb25zdCBzZWNvbmRzID0gTWF0aC5tYXgoMCwgTWF0aC5mbG9vcihlbGFwc2VkTXMgLyAxMDAwKSk7XG4gIGlmIChzZWNvbmRzIDwgNjApIHJldHVybiBgJHtzZWNvbmRzfXNgO1xuICBjb25zdCBtaW51dGVzID0gTWF0aC5mbG9vcihzZWNvbmRzIC8gNjApO1xuICBpZiAobWludXRlcyA8IDYwKSByZXR1cm4gYCR7bWludXRlc31tYDtcbiAgcmV0dXJuIGAke01hdGguZmxvb3IobWludXRlcyAvIDYwKX1oYDtcbn1cblxuLyoqXG4gKiBUaGUgb25lLWxpbmUgc3RhdHVzIHRleHQgZm9yIGEgY2xpZW50IHN0YXR1cyBhdCB0aW1lIGBub3dgLiBgbW9kZWAgc2hyaW5rc1xuICogdGhlIGxpbmUgKGNvbXBhY3QgZHJvcHMgdGhlIHRyYWlsaW5nIGRldGFpbCk7IGBwYXVzZWRgIHdpbnMgb3ZlciBldmVyeXRoaW5nLlxuICpcbiAqIER1cmluZyBhIGJ1bGsgcGhhc2UgKGBzdGF0dXMucHJvZ3Jlc3NgIFx1MjAxNCBzY2FubmluZy9wdXNoaW5nL3B1bGxpbmcgb2YgYVxuICogbXVsdGktbWludXRlIGluaXRpYWwgc3luYykgYm90aCBkZXRhaWwgbGV2ZWxzIHNob3cgdGhlIGNvdW50cyBcdTIwMTRcbiAqIGB2c2EgXHUyMkVGIDEyMzQvNTAwMGAgXHUyMDE0IGJlY2F1c2UgdGhhdCBpcyB0aGUgb25lIHRoaW5nIGEgdXNlciB3YWl0aW5nIG9uIGEgYmlnXG4gKiBzeW5jIG5lZWRzOyBoaWRkZW4gbW9kZSBzaG93cyBub3RoaW5nICh0aGUgaXRlbSBpcyBuZXZlciBtb3VudGVkKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN0YXR1c0xpbmVGb3IoXG4gIHN0YXR1czogU3luY0NsaWVudFN0YXR1cyxcbiAgbm93OiBudW1iZXIsXG4gIG1vZGU6IFN0YXR1c0Jhck1vZGUgPSAnZGV0YWlsZWQnLFxuICBwYXVzZWQgPSBmYWxzZSxcbik6IHN0cmluZyB7XG4gIGlmIChwYXVzZWQpIHJldHVybiAndnNhIFx1MjNGOCc7XG4gIGNvbnN0IGNvbXBhY3QgPSBtb2RlID09PSAnY29tcGFjdCc7XG4gIHN3aXRjaCAoc3RhdHVzLnN0YXRlKSB7XG4gICAgY2FzZSAnY29ubmVjdGluZyc6XG4gICAgY2FzZSAnc3luY2luZyc6IHtcbiAgICAgIGNvbnN0IHByb2dyZXNzID0gc3RhdHVzLnByb2dyZXNzO1xuICAgICAgaWYgKHByb2dyZXNzICE9PSB1bmRlZmluZWQpIHJldHVybiBgdnNhIFx1MjJFRiAke3Byb2dyZXNzLmRvbmV9LyR7cHJvZ3Jlc3MudG90YWx9YDtcbiAgICAgIHJldHVybiAndnNhIFx1MjJFRic7XG4gICAgfVxuICAgIGNhc2UgJ2Rpc2Nvbm5lY3RlZCc6XG4gICAgICByZXR1cm4gY29tcGFjdCA/ICd2c2EgXHUyNzE3JyA6ICd2c2EgXHUyNzE3IG9mZmxpbmUnO1xuICAgIGNhc2UgJ2xpdmUnOlxuICAgICAgaWYgKHN0YXR1cy5jb25mbGljdHMubGVuZ3RoID4gMCkge1xuICAgICAgICByZXR1cm4gY29tcGFjdCA/ICd2c2EgXHUyNkEwJyA6IGB2c2EgXHUyNkEwIGNvbmZsaWN0czogJHtzdGF0dXMuY29uZmxpY3RzLmxlbmd0aH1gO1xuICAgICAgfVxuICAgICAgaWYgKHN0YXR1cy5sYXN0U3luY0F0ID09PSBudWxsIHx8IGNvbXBhY3QpIHJldHVybiAndnNhIFx1MjcxMyc7XG4gICAgICByZXR1cm4gYHZzYSBcdTI3MTMgJHtmb3JtYXRTaW5jZShub3cgLSBzdGF0dXMubGFzdFN5bmNBdCl9YDtcbiAgICBjYXNlICdpZGxlJzpcbiAgICAgIHJldHVybiAndnNhJztcbiAgfVxufVxuXG4vKiogVG9vbHRpcCBsaW5lcyAoam9pbmVkIHdpdGggYFxcbmApLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN0YXR1c1Rvb2x0aXBGb3Ioc3RhdHVzOiBTeW5jQ2xpZW50U3RhdHVzLCBjb250ZXh0OiBTdGF0dXNDb250ZXh0LCBub3c6IG51bWJlcik6IHN0cmluZyB7XG4gIGNvbnN0IHN0YXRlTGFiZWw6IFJlY29yZDxTeW5jQ2xpZW50U3RhdHVzWydzdGF0ZSddLCBzdHJpbmc+ID0ge1xuICAgIGlkbGU6ICdub3QgcnVubmluZycsXG4gICAgY29ubmVjdGluZzogJ2Nvbm5lY3RpbmdcdTIwMjYnLFxuICAgIHN5bmNpbmc6ICdzeW5jaW5nXHUyMDI2JyxcbiAgICBsaXZlOiAnbGl2ZScsXG4gICAgZGlzY29ubmVjdGVkOiAnb2ZmbGluZSBcdTIwMTQgcmVjb25uZWN0aW5nJyxcbiAgfTtcbiAgY29uc3QgaGVhZGxpbmUgPSBjb250ZXh0LnBhdXNlZCA9PT0gdHJ1ZSA/ICdwYXVzZWQnIDogc3RhdGVMYWJlbFtzdGF0dXMuc3RhdGVdO1xuICBjb25zdCBsaW5lcyA9IFtgVmF1bHRTeW5jIGZvciBBZ2VudHMgXHUyMDE0ICR7aGVhZGxpbmV9YF07XG4gIGlmIChjb250ZXh0LnVybCAhPT0gJycpIGxpbmVzLnB1c2goYFdvcmtlcjogJHtjb250ZXh0LnVybH1gKTtcbiAgaWYgKGNvbnRleHQuZGV2aWNlTmFtZSAhPT0gJycpIGxpbmVzLnB1c2goYERldmljZTogJHtjb250ZXh0LmRldmljZU5hbWV9YCk7XG4gIGxpbmVzLnB1c2goXG4gICAgc3RhdHVzLmxhc3RTeW5jQXQgPT09IG51bGxcbiAgICAgID8gJ0xhc3Qgc3luYzogbmV2ZXInXG4gICAgICA6IGBMYXN0IHN5bmM6ICR7Zm9ybWF0U2luY2Uobm93IC0gc3RhdHVzLmxhc3RTeW5jQXQpfSBhZ29gLFxuICApO1xuICBpZiAoc3RhdHVzLnByb2dyZXNzICE9PSB1bmRlZmluZWQpIHtcbiAgICBsaW5lcy5wdXNoKGBTeW5jaW5nOiAke3N0YXR1cy5wcm9ncmVzcy5kb25lfS8ke3N0YXR1cy5wcm9ncmVzcy50b3RhbH0gKCR7c3RhdHVzLnByb2dyZXNzLnBoYXNlfSlgKTtcbiAgfVxuICBsaW5lcy5wdXNoKGBQZW5kaW5nIGNoYW5nZXM6ICR7c3RhdHVzLnBlbmRpbmd9YCk7XG4gIGxpbmVzLnB1c2goYENvbmZsaWN0czogJHtzdGF0dXMuY29uZmxpY3RzLmxlbmd0aH1gKTtcbiAgaWYgKHN0YXR1cy5jb25mbGljdHMubGVuZ3RoID4gMCkge1xuICAgIGxpbmVzLnB1c2goYENvbmZsaWN0IGNvcGllczogJHtzdGF0dXMuY29uZmxpY3RzLm1hcCgoYykgPT4gYy5wYXRoKS5qb2luKCcsICcpfWApO1xuICB9XG4gIGlmIChjb250ZXh0Lm5vdGUgIT09IHVuZGVmaW5lZCAmJiBjb250ZXh0Lm5vdGUgIT09ICcnKSBsaW5lcy5wdXNoKGNvbnRleHQubm90ZSk7XG4gIHJldHVybiBsaW5lcy5qb2luKCdcXG4nKTtcbn1cblxuLyoqIENTUyBtb2RpZmllciBmb3IgdGhlIGluZGljYXRvciAodGludGVkIHdhcm5pbmcvZXJyb3Igc3RhdGVzKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdGF0dXNDbGFzc0ZvcihzdGF0dXM6IFN5bmNDbGllbnRTdGF0dXMpOiBzdHJpbmcge1xuICBpZiAoc3RhdHVzLnN0YXRlID09PSAnZGlzY29ubmVjdGVkJykgcmV0dXJuICd2c2EtZXJyb3InO1xuICBpZiAoc3RhdHVzLmNvbmZsaWN0cy5sZW5ndGggPiAwKSByZXR1cm4gJ3ZzYS13YXJuJztcbiAgcmV0dXJuICcnO1xufVxuXG4vKipcbiAqIFBhaW50cyBvbmUgc3RhdHVzLWJhciBpdGVtLiBQYXNzaXZlOiB0aGUgcGx1Z2luIGNhbGxzIGB1cGRhdGUoKWAgZnJvbSBpdHNcbiAqIHN1cGVydmlzaW9uIHRpY2sgXHUyMDE0IG5vIHRpbWVycyBvZiBpdHMgb3duIHRvIGxlYWsuXG4gKi9cbmV4cG9ydCBjbGFzcyBTdGF0dXNCYXJJbmRpY2F0b3Ige1xuICAvKiogQWx3YXlzIG9uIFx1MjAxNCB0aGUgYmFzZSBjbGFzcyBzdHlsZXMuY3NzIHRhcmdldHMuICovXG4gIHByaXZhdGUgc3RhdGljIHJlYWRvbmx5IEJBU0VfQ0xBU1MgPSAndnNhLXN0YXR1cyc7XG4gIHByaXZhdGUgc3RhdGljIHJlYWRvbmx5IE1PRElGSUVSX0NMQVNTRVMgPSBbJ3ZzYS13YXJuJywgJ3ZzYS1lcnJvciddO1xuXG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgaXRlbTogU3RhdHVzSXRlbUxpa2UpIHt9XG5cbiAgdXBkYXRlKHN0YXR1czogU3luY0NsaWVudFN0YXR1cywgY29udGV4dDogU3RhdHVzQ29udGV4dCwgbm93OiBudW1iZXIpOiB2b2lkIHtcbiAgICB0aGlzLml0ZW0udGV4dENvbnRlbnQgPSBzdGF0dXNMaW5lRm9yKHN0YXR1cywgbm93LCBjb250ZXh0Lm1vZGUgPz8gJ2RldGFpbGVkJywgY29udGV4dC5wYXVzZWQgPT09IHRydWUpO1xuICAgIHRoaXMuaXRlbS5hZGRDbGFzcz8uKFN0YXR1c0JhckluZGljYXRvci5CQVNFX0NMQVNTKTtcbiAgICBjb25zdCBtb2RpZmllciA9IHN0YXR1c0NsYXNzRm9yKHN0YXR1cyk7XG4gICAgZm9yIChjb25zdCBjbHMgb2YgU3RhdHVzQmFySW5kaWNhdG9yLk1PRElGSUVSX0NMQVNTRVMpIHtcbiAgICAgIGlmIChjbHMgPT09IG1vZGlmaWVyKSB0aGlzLml0ZW0uYWRkQ2xhc3M/LihjbHMpO1xuICAgICAgZWxzZSB0aGlzLml0ZW0ucmVtb3ZlQ2xhc3M/LihjbHMpO1xuICAgIH1cbiAgICB0aGlzLml0ZW0uc2V0QXR0cmlidXRlPy4oJ3RpdGxlJywgc3RhdHVzVG9vbHRpcEZvcihzdGF0dXMsIGNvbnRleHQsIG5vdykpO1xuICB9XG59XG4iLCAiLyoqXG4gKiBgV2ViU29ja2V0VHJhbnNwb3J0YCBcdTIwMTQgY29yZSdzIGBUcmFuc3BvcnRgIG92ZXIgdGhlIGdsb2JhbCBgV2ViU29ja2V0YFxuICogKHByZXNlbnQgaW4gT2JzaWRpYW4gZGVza3RvcCAqYW5kKiBtb2JpbGU7IGZlYXR1cmUtY2hlY2tlZCB3aXRoIGEgY2xlYXJcbiAqIGVycm9yIGZvciBleG90aWMgYnVpbGRzKS5cbiAqXG4gKiBUaGlzIG1pcnJvcnMgYEB2c2Evbm9kZS1ydW50aW1lYCdzIHRyYW5zcG9ydCBvbiBwdXJwb3NlIChzYW1lIHdpcmUgZm9ybWF0OlxuICogb25lIEpTT04gdGV4dCBmcmFtZSBwZXIgbWVzc2FnZSwgY29yZSdzIGBwYXJzZU1lc3NhZ2VgIG9uIHJlY2VpdmUsIHF1ZXVlZFxuICogc2VuZHMgYmVmb3JlIG9wZW4pIGJ1dCBzaGFyZXMgbm8gY29kZSB3aXRoIGl0IFx1MjAxNCBgQHZzYS9ub2RlLXJ1bnRpbWVgIGlzXG4gKiBOb2RlLW9ubHkgYW5kIG11c3QgbmV2ZXIgYmUgYSBwbHVnaW4gZGVwZW5kZW5jeS5cbiAqL1xuXG5pbXBvcnQgeyBOZXR3b3JrRXJyb3IsIHBhcnNlTWVzc2FnZSB9IGZyb20gJ0B2c2EvY29yZSc7XG5pbXBvcnQgdHlwZSB7IENsb3NlUmVhc29uLCBNZXNzYWdlLCBUcmFuc3BvcnQgfSBmcm9tICdAdnNhL2NvcmUnO1xuXG4vKipcbiAqIFRoZSBtaW5pbWFsIFdlYlNvY2tldCBzdXJmYWNlIHRoaXMgdHJhbnNwb3J0IG5lZWRzLiBJbmplY3RhYmxlIHNvIHRlc3RzXG4gKiAoYW5kIGV4b3RpYyBydW50aW1lcykgY2FuIHN1cHBseSBhIGZha2U7IHByb2R1Y3Rpb24gdXNlcyB0aGUgZ2xvYmFsLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFdlYlNvY2tldExpa2Uge1xuICBzZW5kKGRhdGE6IHN0cmluZyk6IHZvaWQ7XG4gIGNsb3NlKGNvZGU/OiBudW1iZXIsIHJlYXNvbj86IHN0cmluZyk6IHZvaWQ7XG4gIGFkZEV2ZW50TGlzdGVuZXIodHlwZTogJ29wZW4nLCBsaXN0ZW5lcjogKCkgPT4gdm9pZCk6IHZvaWQ7XG4gIGFkZEV2ZW50TGlzdGVuZXIodHlwZTogJ21lc3NhZ2UnLCBsaXN0ZW5lcjogKGV2ZW50OiB7IGRhdGE6IHVua25vd24gfSkgPT4gdm9pZCk6IHZvaWQ7XG4gIGFkZEV2ZW50TGlzdGVuZXIodHlwZTogJ2Nsb3NlJywgbGlzdGVuZXI6IChldmVudDogeyBjb2RlPzogbnVtYmVyOyByZWFzb24/OiBzdHJpbmcgfSkgPT4gdm9pZCk6IHZvaWQ7XG4gIGFkZEV2ZW50TGlzdGVuZXIodHlwZTogJ2Vycm9yJywgbGlzdGVuZXI6IChldmVudDogdW5rbm93bikgPT4gdm9pZCk6IHZvaWQ7XG59XG5cbmV4cG9ydCB0eXBlIFdlYlNvY2tldEZhY3RvcnkgPSAodXJsOiBzdHJpbmcpID0+IFdlYlNvY2tldExpa2U7XG5cbmV4cG9ydCBpbnRlcmZhY2UgV2ViU29ja2V0VHJhbnNwb3J0T3B0aW9ucyB7XG4gIC8qKiBXb3JrZXIgb3JpZ2luIChgaHR0cHM6Ly9wZXJzb25hbC54LndvcmtlcnMuZGV2YCkgb3IgYSBgd3Mocyk6Ly9gIFVSTC4gKi9cbiAgdXJsOiBzdHJpbmc7XG4gIC8qKiBEZXZpY2UgdG9rZW4gXHUyMDE0IGNhcnJpZWQgaW4gdGhlIHF1ZXJ5IHN0cmluZyAodGhlIHdvcmtlcidzIHByZS1hdXRoIHBhdGgpLiAqL1xuICB0b2tlbjogc3RyaW5nO1xuICAvKiogV1MgcGF0aCBvbiB0aGUgd29ya2VyIChkZWZhdWx0IGAvd3NgOyBgL3N5bmNgIGlzIGVxdWl2YWxlbnQpLiAqL1xuICBwYXRoPzogc3RyaW5nO1xuICAvKiogSW5qZWN0YWJsZSBzb2NrZXQgZmFjdG9yeSAodGVzdHMpLiBEZWZhdWx0OiB0aGUgZ2xvYmFsIGBXZWJTb2NrZXRgLiAqL1xuICB3c0ZhY3Rvcnk/OiBXZWJTb2NrZXRGYWN0b3J5O1xufVxuXG4vKipcbiAqIEJ1aWxkIHRoZSBhdXRoZW50aWNhdGVkIFdTIFVSTDogYGh0dHBzOi8veGAgXHUyMTkyIGB3c3M6Ly94L3dzP3Rva2VuPVx1MjAyNmAuXG4gKiBUaHJvd3Mgb24gbm9uLUhUVFAoUykvV1Mgc2NoZW1lcyBvciB1bnBhcnNhYmxlIGlucHV0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gdG9XZWJTb2NrZXRVcmwoYmFzZVVybDogc3RyaW5nLCB0b2tlbjogc3RyaW5nLCBwYXRoID0gJy93cycpOiBzdHJpbmcge1xuICBjb25zdCB1cmwgPSBuZXcgVVJMKGJhc2VVcmwpO1xuICBpZiAodXJsLnByb3RvY29sID09PSAnaHR0cDonKSB1cmwucHJvdG9jb2wgPSAnd3M6JztcbiAgZWxzZSBpZiAodXJsLnByb3RvY29sID09PSAnaHR0cHM6JykgdXJsLnByb3RvY29sID0gJ3dzczonO1xuICBlbHNlIGlmICh1cmwucHJvdG9jb2wgIT09ICd3czonICYmIHVybC5wcm90b2NvbCAhPT0gJ3dzczonKSB7XG4gICAgdGhyb3cgbmV3IE5ldHdvcmtFcnJvcihgd29ya2VyIFVSTCBtdXN0IGJlIGh0dHAocyk6Ly8gb3Igd3Mocyk6Ly8sIGdvdCAke3VybC5wcm90b2NvbH1gKTtcbiAgfVxuICB1cmwucGF0aG5hbWUgPSBwYXRoO1xuICB1cmwuc2VhcmNoID0gJyc7XG4gIHVybC5zZWFyY2hQYXJhbXMuc2V0KCd0b2tlbicsIHRva2VuKTtcbiAgcmV0dXJuIHVybC50b1N0cmluZygpO1xufVxuXG5mdW5jdGlvbiBkZWZhdWx0V2ViU29ja2V0RmFjdG9yeSh1cmw6IHN0cmluZyk6IFdlYlNvY2tldExpa2Uge1xuICBjb25zdCB3ZWJzb2NrZXQgPSAoZ2xvYmFsVGhpcyBhcyB7IFdlYlNvY2tldD86IHVua25vd24gfSkuV2ViU29ja2V0O1xuICBpZiAodHlwZW9mIHdlYnNvY2tldCAhPT0gJ2Z1bmN0aW9uJykge1xuICAgIHRocm93IG5ldyBOZXR3b3JrRXJyb3IoXG4gICAgICAnV2ViU29ja2V0IGlzIG5vdCBhdmFpbGFibGUgaW4gdGhpcyBPYnNpZGlhbiBidWlsZCAoaXQgaXMgYnVpbHQgaW4gb24gZGVza3RvcCBhbmQgJyArXG4gICAgICAgICdtb2JpbGU7IGEgdmVyeSBvbGQgYXBwIHZlcnNpb24gb3IgYSBzdHJpcHBlZCB3ZWJ2aWV3IGlzIHRoZSBvbmx5IGtub3duIGNhdXNlKS4gJyArXG4gICAgICAgICdTeW5jIHJlcXVpcmVzIGl0LicsXG4gICAgKTtcbiAgfVxuICByZXR1cm4gbmV3ICh3ZWJzb2NrZXQgYXMgbmV3ICh1cmw6IHN0cmluZykgPT4gV2ViU29ja2V0TGlrZSkodXJsKTtcbn1cblxuZXhwb3J0IGNsYXNzIFdlYlNvY2tldFRyYW5zcG9ydCBpbXBsZW1lbnRzIFRyYW5zcG9ydCB7XG4gIHByaXZhdGUgcmVhZG9ubHkgc29ja2V0OiBXZWJTb2NrZXRMaWtlO1xuICBwcml2YXRlIG1lc3NhZ2VDYWxsYmFjazogKChtZXNzYWdlOiBNZXNzYWdlKSA9PiB2b2lkKSB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGNsb3NlQ2FsbGJhY2s6ICgocmVhc29uOiBDbG9zZVJlYXNvbikgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBvcGVuID0gZmFsc2U7XG4gIHByaXZhdGUgY2xvc2VkID0gZmFsc2U7XG4gIHByaXZhdGUgY2xvc2VOb3RpZmllZCA9IGZhbHNlO1xuICBwcml2YXRlIHJlYWRvbmx5IHNlbmRRdWV1ZTogc3RyaW5nW10gPSBbXTtcbiAgcHJpdmF0ZSBsYXN0RXJyb3I6IHN0cmluZyB8IHVuZGVmaW5lZDtcblxuICBjb25zdHJ1Y3RvcihvcHRpb25zOiBXZWJTb2NrZXRUcmFuc3BvcnRPcHRpb25zKSB7XG4gICAgY29uc3QgZmFjdG9yeSA9IG9wdGlvbnMud3NGYWN0b3J5ID8/IGRlZmF1bHRXZWJTb2NrZXRGYWN0b3J5O1xuICAgIGNvbnN0IHVybCA9IHRvV2ViU29ja2V0VXJsKG9wdGlvbnMudXJsLCBvcHRpb25zLnRva2VuLCBvcHRpb25zLnBhdGggPz8gJy93cycpO1xuICAgIHRoaXMuc29ja2V0ID0gZmFjdG9yeSh1cmwpO1xuXG4gICAgdGhpcy5zb2NrZXQuYWRkRXZlbnRMaXN0ZW5lcignb3BlbicsICgpID0+IHtcbiAgICAgIHRoaXMub3BlbiA9IHRydWU7XG4gICAgICBjb25zdCBxdWV1ZWQgPSBbLi4udGhpcy5zZW5kUXVldWVdO1xuICAgICAgdGhpcy5zZW5kUXVldWUubGVuZ3RoID0gMDtcbiAgICAgIGZvciAoY29uc3QgZnJhbWUgb2YgcXVldWVkKSB0aGlzLnNvY2tldC5zZW5kKGZyYW1lKTtcbiAgICB9KTtcblxuICAgIHRoaXMuc29ja2V0LmFkZEV2ZW50TGlzdGVuZXIoJ21lc3NhZ2UnLCAoZXZlbnQpID0+IHtcbiAgICAgIGlmICh0eXBlb2YgZXZlbnQuZGF0YSAhPT0gJ3N0cmluZycpIHtcbiAgICAgICAgdGhpcy5mYWlsKHsgY29kZTogMTAwMywgcmVhc29uOiAnYmluYXJ5IGZyYW1lcyBhcmUgbm90IHBhcnQgb2YgdGhlIHByb3RvY29sJyB9KTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgbGV0IG1lc3NhZ2U6IE1lc3NhZ2U7XG4gICAgICB0cnkge1xuICAgICAgICBtZXNzYWdlID0gcGFyc2VNZXNzYWdlKGV2ZW50LmRhdGEpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdGhpcy5mYWlsKHsgY29kZTogMTAwMiwgcmVhc29uOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcikgfSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHRoaXMubWVzc2FnZUNhbGxiYWNrPy4obWVzc2FnZSk7XG4gICAgfSk7XG5cbiAgICB0aGlzLnNvY2tldC5hZGRFdmVudExpc3RlbmVyKCdlcnJvcicsIChldmVudCkgPT4ge1xuICAgICAgdGhpcy5sYXN0RXJyb3IgPVxuICAgICAgICBldmVudCBpbnN0YW5jZW9mIEVycm9yID8gZXZlbnQubWVzc2FnZSA6IGV2ZW50ICE9PSB1bmRlZmluZWQgPyBTdHJpbmcoZXZlbnQpIDogJ3NvY2tldCBlcnJvcic7XG4gICAgfSk7XG5cbiAgICB0aGlzLnNvY2tldC5hZGRFdmVudExpc3RlbmVyKCdjbG9zZScsIChldmVudCkgPT4ge1xuICAgICAgdGhpcy5maW5pc2hDbG9zZSh7XG4gICAgICAgIGNvZGU6IGV2ZW50LmNvZGUsXG4gICAgICAgIHJlYXNvbjogZXZlbnQucmVhc29uICE9PSB1bmRlZmluZWQgJiYgZXZlbnQucmVhc29uICE9PSAnJyA/IGV2ZW50LnJlYXNvbiA6IHRoaXMubGFzdEVycm9yLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBzZW5kKG1lc3NhZ2U6IE1lc3NhZ2UpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5jbG9zZWQpIHRocm93IG5ldyBOZXR3b3JrRXJyb3IoJ3NlbmQgb24gYSBjbG9zZWQgdHJhbnNwb3J0Jyk7XG4gICAgY29uc3QgZnJhbWUgPSBKU09OLnN0cmluZ2lmeShtZXNzYWdlKTtcbiAgICBpZiAodGhpcy5vcGVuKSB7XG4gICAgICB0aGlzLnNvY2tldC5zZW5kKGZyYW1lKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5zZW5kUXVldWUucHVzaChmcmFtZSk7XG4gIH1cblxuICBvbk1lc3NhZ2UoY2FsbGJhY2s6IChtZXNzYWdlOiBNZXNzYWdlKSA9PiB2b2lkKTogdm9pZCB7XG4gICAgdGhpcy5tZXNzYWdlQ2FsbGJhY2sgPSBjYWxsYmFjaztcbiAgfVxuXG4gIG9uQ2xvc2UoY2FsbGJhY2s6IChyZWFzb246IENsb3NlUmVhc29uKSA9PiB2b2lkKTogdm9pZCB7XG4gICAgdGhpcy5jbG9zZUNhbGxiYWNrID0gY2FsbGJhY2s7XG4gIH1cblxuICBjbG9zZSgpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5jbG9zZWQpIHJldHVybjtcbiAgICB0aGlzLmNsb3NlZCA9IHRydWU7XG4gICAgdGhpcy5zZW5kUXVldWUubGVuZ3RoID0gMDtcbiAgICB0cnkge1xuICAgICAgdGhpcy5zb2NrZXQuY2xvc2UoMTAwMCwgJ2Nsb3NlZCBieSBjYWxsZXInKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIGFscmVhZHkgZGVhZCBcdTIwMTQgdGhlIGNsb3NlIGV2ZW50IG1heSBuZXZlciBhcnJpdmVcbiAgICB9XG4gICAgLy8gTm90aWZ5IGV2ZW4gaWYgdGhlIHNvY2tldCBuZXZlciBlbWl0cyAnY2xvc2UnIChmYWlsZWQgZGlhbCkuXG4gICAgdGhpcy5maW5pc2hDbG9zZSh7IGNvZGU6IDEwMDAsIHJlYXNvbjogJ2Nsb3NlZCBieSBjYWxsZXInIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBmYWlsKHJlYXNvbjogQ2xvc2VSZWFzb24pOiB2b2lkIHtcbiAgICB0aGlzLmNsb3NlZCA9IHRydWU7XG4gICAgdHJ5IHtcbiAgICAgIHRoaXMuc29ja2V0LmNsb3NlKHJlYXNvbi5jb2RlID8/IDEwMDIsIHJlYXNvbi5yZWFzb24gPz8gJycpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gYWxyZWFkeSBjbG9zZWRcbiAgICB9XG4gICAgdGhpcy5maW5pc2hDbG9zZShyZWFzb24pO1xuICB9XG5cbiAgcHJpdmF0ZSBmaW5pc2hDbG9zZShyZWFzb246IENsb3NlUmVhc29uKTogdm9pZCB7XG4gICAgdGhpcy5vcGVuID0gZmFsc2U7XG4gICAgdGhpcy5jbG9zZWQgPSB0cnVlO1xuICAgIGlmICh0aGlzLmNsb3NlTm90aWZpZWQpIHJldHVybjtcbiAgICB0aGlzLmNsb3NlTm90aWZpZWQgPSB0cnVlO1xuICAgIHRoaXMuY2xvc2VDYWxsYmFjaz8uKHJlYXNvbik7XG4gIH1cbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTs7O0FDY0EsSUFBQUEsbUJBQStCOzs7QUNLeEIsSUFBTSx3QkFBTixjQUFvQyxNQUFNO0FBQUEsRUFDL0MsWUFBWSxTQUFpQjtBQUMzQixVQUFNLE9BQU87QUFDYixTQUFLLE9BQU87QUFBQSxFQUNkO0FBQ0Y7QUFlTyxTQUFTLG1CQUFtQixPQUEwQjtBQUMzRCxNQUFJLE9BQU8sVUFBVSxVQUFVO0FBQzdCLFVBQU0sSUFBSSxzQkFBc0Isb0NBQW9DLE9BQU8sS0FBSyxFQUFFO0FBQUEsRUFDcEY7QUFDQSxNQUFJLE1BQU0sU0FBUyxJQUFJLEdBQUc7QUFDeEIsVUFBTSxJQUFJLHNCQUFzQixpQ0FBaUMsS0FBSyxVQUFVLEtBQUssQ0FBQyxFQUFFO0FBQUEsRUFDMUY7QUFDQSxNQUFJLGFBQWEsS0FBSyxLQUFLLEdBQUc7QUFDNUIsVUFBTSxJQUFJO0FBQUEsTUFDUixnRUFBZ0UsS0FBSyxVQUFVLEtBQUssQ0FBQztBQUFBLElBQ3ZGO0FBQUEsRUFDRjtBQUNBLE1BQUksTUFBTSxXQUFXLE1BQU0sR0FBRztBQUM1QixVQUFNLElBQUk7QUFBQSxNQUNSLHNDQUFzQyxLQUFLLFVBQVUsS0FBSyxDQUFDO0FBQUEsSUFDN0Q7QUFBQSxFQUNGO0FBRUEsUUFBTSxZQUFZLE1BQU0sUUFBUSxPQUFPLEdB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QUFNLE9BQU8sT0FBTyxPQUFPLGVBQWUsV0FBVyxPQUFPLGFBQWEsT0FBTztBQUNoRixZQUFNLFFBQVEsT0FBTyxPQUFPLFFBQVEsV0FBVyxPQUFPLE1BQU07QUFDNUQsVUFBSTtBQUFBLFFBQ0YsNERBQTRELElBQUksZ0JBQWdCLEtBQUs7QUFBQSxRQUdyRjtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUNGO0FBRUEsU0FBUyx1QkFBdUIsT0FBdUI7QUFDckQsTUFBSTtBQUNGLFdBQU8sbUJBQW1CLEtBQUs7QUFBQSxFQUNqQyxTQUFRO0FBQ04sV0FBTztBQUFBLEVBQ1Q7QUFDRjsiLAogICJuYW1lcyI6IFsiaW1wb3J0X29ic2lkaWFuIiwgImlzUGxhaW5PYmplY3QiLCAiX2EiLCAiX2IiLCAiX2MiLCAiX2QiLCAiX2UiLCAiY29tcGFyZVN0cmluZ3MiLCAiaW1wb3J0X29ic2lkaWFuIiwgImltcG9ydF9vYnNpZGlhbiIsICJpbXBvcnRfb2JzaWRpYW4iLCAiX2EiLCAiX2EiXQp9Cg==
