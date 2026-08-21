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
  "ping"
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
  "pong"
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
    pulls: pulls.sort((a, b) => compareStrings(opPath(a), opPath(b))),
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
function compareStrings(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// ../core/src/scan.ts
async function scanVault(storage, index, settings, now, options = {}) {
  var _a, _b;
  const hashFn = (_a = options.hash) != null ? _a : sha256Hex;
  const mode = (_b = options.mode) != null ? _b : "fast";
  const onProgress = options.onProgress;
  const files = await storage.listFiles();
  const kept = [];
  for (const file of files) {
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
  const dirs = await storage.listDirs();
  const emptyFolders = detectEmptyFolders(index, settings, files, dirs);
  const folderDeletions = detectFolderDeletions(index, settings, dirs);
  return {
    scannedAt: now,
    added: sortCandidates(unmatchedAdded),
    modified: sortCandidates(modified),
    deleted: [...unmatchedDeleted].sort(byPath),
    renamed: [...renamed].sort((a, b) => byPath(a, b)),
    emptyFolders,
    folderDeletions,
    hashed: [...hashed].sort(byPath)
  };
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
function detectEmptyFolders(index, settings, files, dirs) {
  const representedDirs = /* @__PURE__ */ new Set();
  for (const file of files) {
    for (let dir = parentPath(file.path); dir !== "/"; dir = parentPath(dir)) {
      representedDirs.add(dir);
    }
  }
  const emptyFolders = [];
  for (const dir of dirs) {
    if (dir === "/") continue;
    if (representedDirs.has(dir)) continue;
    if (isIgnored(dir, settings)) continue;
    const entry = index[dir];
    if ((entry == null ? void 0 : entry.isFolder) && entry.deletedAt === void 0) continue;
    emptyFolders.push(dir);
  }
  return emptyFolders.sort();
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
    var _a;
    this.state = "connecting";
    this.buffering = true;
    this.buffered = [];
    if (await this.safeStorageExists(LOCAL_INDEX_STATE_PATH)) {
      const loaded = await loadLocalState(this.options.storage);
      this.index = loaded.index;
      this.cursor = loaded.state.cursor;
      this.syncedThrough = loaded.state.syncedThrough;
      this.needsFullManifest = loaded.state.needsFullManifest;
    } else {
      this.index = {};
      this.cursor = 0;
      this.syncedThrough = null;
      this.needsFullManifest = false;
    }
    this.serverOldestRetainedSeq = null;
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
        this.log.warn("unexpected server reply", message.type);
        return;
      default:
        this.log.warn("ignoring client-to-server message from server", message);
    }
  }
  async handleChange(change) {
    var _a;
    if (change.seq > this.cursor) this.cursor = change.seq;
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
    if (change.seq > ((_a = this.syncedThrough) != null ? _a : 0)) this.syncedThrough = change.seq;
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
    return applyPull(
      this.options.storage,
      this.index,
      { pushes: [], pulls: [...pulls], conflicts: [], folderPushes: [] },
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
    var _a, _b, _c, _d;
    if (this.transport === null || this.isDisconnected()) return;
    this.state = "syncing";
    this.progress = null;
    try {
      const manifest = await this.fetchManifest();
      const localChanges = await scanVault(
        this.options.storage,
        this.index,
        this.ignoreSettings,
        this.now(),
        { onProgress: (done, total) => this.emitProgress("scanning", done, total) }
      );
      const plan = computeSyncPlan({
        localChanges,
        index: this.index,
        manifest,
        thisDeviceId: this.options.deviceId,
        thisDeviceName: this.options.deviceName,
        now: this.now()
      });
      this.conflicts = [...this.conflicts, ...plan.conflicts];
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
          if (((_a = this.index[commit.path]) == null ? void 0 : _a.deletedAt) !== void 0) ceasedPath = commit.path;
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
      const folderCommits = [];
      for (const path of plan.folderPushes) {
        if (emptiedDirs.has(path)) continue;
        if (!await this.storageExists(path)) continue;
        folderCommits.push({
          kind: "edit",
          path,
          parentVersion: (_c = (_b = this.index[path]) == null ? void 0 : _b.versionId) != null ? _c : null,
          hash: "",
          size: 0,
          isFolder: true
        });
      }
      await this.runPushPipeline(folderCommits, settlePush);
      this.index = recordHashedFiles(this.index, localChanges.hashed);
      if (this.manifestCursorOfCycle !== null && this.manifestCursorOfCycle > ((_d = this.syncedThrough) != null ? _d : 0)) {
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
    if (reply.cursor > this.cursor) this.cursor = reply.cursor;
    this.manifestCursorOfCycle = reply.cursor;
    if (!useDelta) {
      return Object.values(reply.entries).map((entry) => ({ ...entry }));
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
    return [...merged.values()];
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

// src/adapters/obsidian-storage.ts
var TEMP_DIR_VAULT_PATH = "/.vaultsyncforagents/tmp";
var ObsidianStorageAdapter = class {
  constructor(options) {
    __publicField(this, "adapter");
    /**
     * Latched when a temp+rename attempt fails: every later write goes straight
     * to `writeBinary` instead of paying the failing-rename penalty again.
     */
    __publicField(this, "tempRenameBroken", false);
    __publicField(this, "tempCounter", 0);
    this.adapter = options.adapter;
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
    storageBytes: body.storageBytes
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
  }
  renderAboutSection() {
    const { containerEl } = this;
    this.heading("About");
    new import_obsidian4.Setting(containerEl).setName("Versions").setDesc(
      `Plugin ${this.plugin.manifest.version || "unknown"} \xB7 protocol v${PROTOCOL_VERSION} \xB7 ${this.plugin.platformSummary()}`
    );
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
  /** obsidian://vaultsyncforagents/pair?url=…&code=… (protocol-handler.ts). */
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
  /** Write the FR-44 marker the CLI/daemon read to detect double-clients. */
  async writeDeviceMarker() {
    if (!this.linked) return;
    const storage = new ObsidianStorageAdapter({ adapter: this.app.vault.adapter });
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
    const storage = new ObsidianStorageAdapter({ adapter: this.app.vault.adapter });
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
  /** Copy the diagnostics bundle to the clipboard (fallback: console). */
  async copyDiagnostics() {
    var _a, _b;
    const bundle = buildDiagnosticsBundle({
      pluginVersion: this.manifest.version || "unknown",
      deviceId: this.data.deviceId,
      deviceName: this.resolveDeviceName(),
      workerUrl: this.data.url,
      paired: this.linked,
      paused: this.paused,
      clientStatus: (_b = (_a = this.client) == null ? void 0 : _a.status()) != null ? _b : null,
      recentLogLines: this.syncLog.recentLines()
    });
    const copied = await copyToClipboard(bundle);
    if (copied) {
      new import_obsidian5.Notice("VaultSync: diagnostics copied to the clipboard.");
      return;
    }
    console.info("[vsa] diagnostics (clipboard unavailable):\n" + bundle);
    new import_obsidian5.Notice("VaultSync: clipboard unavailable \u2014 diagnostics written to the developer console.", 1e4);
  }
  /** The platform line for the About/diagnostics readouts. */
  platformSummary() {
    return platformSummary();
  }
  async unlink() {
    this.stopSync();
    this.paused = false;
    const storage = new ObsidianStorageAdapter({ adapter: this.app.vault.adapter });
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
    (_a = this.statusBar) == null ? void 0 : _a.update(
      status,
      {
        url: this.data.url,
        deviceName: this.resolveDeviceName(),
        note: this.statusNote,
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiLCAic3JjL3BsdWdpbi50cyIsICIuLi9jb3JlL3NyYy9wYXRocy50cyIsICIuLi9jb3JlL3NyYy9jbG9jay50cyIsICIuLi9jb3JlL3NyYy9oYXNoaW5nLnRzIiwgIi4uL2NvcmUvc3JjL2Vycm9ycy50cyIsICIuLi9jb3JlL3NyYy9sb2NhbGluZGV4LnRzIiwgIi4uL2NvcmUvc3JjL2VuZ2luZS50cyIsICIuLi9jb3JlL3NyYy9pZ25vcmUudHMiLCAiLi4vY29yZS9zcmMvcHJvdG9jb2wudHMiLCAiLi4vY29yZS9zcmMvY29uZmxpY3RuYW1lcy50cyIsICIuLi9jb3JlL3NyYy9yZXNvbHZlLnRzIiwgIi4uL2NvcmUvc3JjL3NjYW4udHMiLCAiLi4vY29yZS9zcmMvY2xpZW50LnRzIiwgInNyYy9hZGFwdGVycy9vYnNpZGlhbi1zdG9yYWdlLnRzIiwgInNyYy9hZGFwdGVycy9vYnNpZGlhbi13YXRjaC50cyIsICJzcmMvYmxvYnN0b3JlLnRzIiwgInNyYy9kaWFnbm9zdGljcy50cyIsICJzcmMvZGF0YS50cyIsICJzcmMvd29ya2VyYXBpLnRzIiwgInNyYy9wYWlyaW5nLnRzIiwgInNyYy9wcm90b2NvbC1oYW5kbGVyLnRzIiwgInNyYy9yZWNvbm5lY3QudHMiLCAic3JjL3NldHRpbmdzLnRzIiwgInNyYy9zdGF0dXNiYXIudHMiLCAic3JjL3RyYW5zcG9ydC50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLyoqXG4gKiBQbHVnaW4gZW50cnkgcG9pbnQgXHUyMDE0IE9ic2lkaWFuIGxvYWRzIGBtYWluLmpzYCBhbmQgaW5zdGFudGlhdGVzIHRoZSBkZWZhdWx0XG4gKiBleHBvcnQuIEV2ZXJ5dGhpbmcgcmVhbCBsaXZlcyBpbiBgcGx1Z2luLnRzYCAoYW5kIGl0cyBtb2R1bGVzKTsgdGhpcyBmaWxlXG4gKiBvbmx5IHJlLWV4cG9ydHMuXG4gKi9cblxuZXhwb3J0IHsgVmF1bHRTeW5jUGx1Z2luIGFzIGRlZmF1bHQgfSBmcm9tICcuL3BsdWdpbi5qcyc7XG4iLCAiLyoqXG4gKiBgVmF1bHRTeW5jUGx1Z2luYCBcdTIwMTQgdGhlIE9ic2lkaWFuIGNsaWVudCAoZGVza3RvcCArIG1vYmlsZSkuXG4gKlxuICogb25sb2FkOiBsb2FkIGxpbmsgaWRlbnRpdHkgXHUyMTkyIGlmIGxpbmtlZCwgYnVpbGQgYFN5bmNDbGllbnRgIChjb3JlKSBvdmVyIHRoZVxuICogT2JzaWRpYW4gYWRhcHRlcnMgYW5kIHJ1biBzdGFydHVwIHJlY29uY2lsaWF0aW9uICh0aGUgc3luYy1vbi1vcGVuXG4gKiBjb250cmFjdCwgRlItNC9GUi01L0ZSLTEyKSwgdGhlbiBlbnRlciBsaXZlIG1vZGUgKHZhdWx0IGV2ZW50cyArIHBlcmlvZGljXG4gKiByZXNjYW4gKyBmb2N1cyByZXNjYW4pIHdpdGggYSBzdGF0dXMtYmFyIGluZGljYXRvciBhbmQgaml0dGVyZWRcbiAqIGV4cG9uZW50aWFsLWJhY2tvZmYgcmVjb25uZWN0IChjYXBwZWQgYXQgNjAgcykuXG4gKlxuICogQSAxIEh6IFwic3VwZXJ2aXNpb24gdGlja1wiIGRyaXZlcyBldmVyeXRoaW5nIHRpbWUtYmFzZWQ6IGl0IHJlcGFpbnRzIHRoZVxuICogc3RhdHVzIGJhciBhbmQgbm90aWNlcyBgZGlzY29ubmVjdGVkYCBcdTIxOTIgc2NoZWR1bGVzIG9uZSByZWNvbm5lY3QgYXQgYSB0aW1lLlxuICogQWxsIHRpbWVycyBhcmUgb3duZWQgaGVyZSBhbmQgdG9ybiBkb3duIGluIGBzdG9wU3luYygpYC9gb251bmxvYWRgLlxuICovXG5cbmltcG9ydCB7IE5vdGljZSwgUGx1Z2luIH0gZnJvbSAnb2JzaWRpYW4nO1xuaW1wb3J0IHR5cGUgeyBBcHAsIFBsdWdpbk1hbmlmZXN0IH0gZnJvbSAnb2JzaWRpYW4nO1xuaW1wb3J0IHsgUmV2b2tlZEVycm9yLCBTeW5jQ2xpZW50LCBVbmF1dGhvcml6ZWRFcnJvciB9IGZyb20gJ0B2c2EvY29yZSc7XG5pbXBvcnQgeyBPYnNpZGlhblN0b3JhZ2VBZGFwdGVyIH0gZnJvbSAnLi9hZGFwdGVycy9vYnNpZGlhbi1zdG9yYWdlLmpzJztcbmltcG9ydCB7IE9ic2lkaWFuV2F0Y2hBZGFwdGVyLCBSZXNjYW5TY2hlZHVsZXIgfSBmcm9tICcuL2FkYXB0ZXJzL29ic2lkaWFuLXdhdGNoLmpzJztcbmltcG9ydCB7IEh0dHBCbG9iU3RvcmUgfSBmcm9tICcuL2Jsb2JzdG9yZS5qcyc7XG5pbXBvcnQge1xuICBidWlsZERpYWdub3N0aWNzQnVuZGxlLFxuICBjb3B5VG9DbGlwYm9hcmQsXG4gIGNyZWF0ZVBsdWdpbkxvZyxcbiAgcGxhdGZvcm1TdW1tYXJ5LFxuICB3aXRoUm91bmRUcmlwTG9nZ2luZyxcbiAgdHlwZSBQbHVnaW5Mb2csXG59IGZyb20gJy4vZGlhZ25vc3RpY3MuanMnO1xuaW1wb3J0IHtcbiAgZGVmYXVsdERldmljZU5hbWUsXG4gIGRldGVjdERldmljZVR5cGUsXG4gIGlzTGlua2VkLFxuICBub3JtYWxpemVQbHVnaW5EYXRhLFxuICBwYXJzZUlnbm9yZVBhdHRlcm5zLFxuICBkZWZhdWx0UGx1Z2luRGF0YSxcbiAgdHlwZSBMb2dMZXZlbCxcbiAgdHlwZSBWYXVsdFN5bmNQbHVnaW5EYXRhLFxufSBmcm9tICcuL2RhdGEuanMnO1xuaW1wb3J0IHsgcGFpck91dGNvbWVNZXNzYWdlLCBwYWlyV2l0aFdvcmtlciB9IGZyb20gJy4vcGFpcmluZy5qcyc7XG5pbXBvcnQgdHlwZSB7IFBhaXJPdXRjb21lIH0gZnJvbSAnLi9wYWlyaW5nLmpzJztcbmltcG9ydCB7IHJlZ2lzdGVyUGFpclByb3RvY29sSGFuZGxlciB9IGZyb20gJy4vcHJvdG9jb2wtaGFuZGxlci5qcyc7XG5pbXBvcnQgeyBSZWNvbm5lY3RTdXBlcnZpc29yIH0gZnJvbSAnLi9yZWNvbm5lY3QuanMnO1xuaW1wb3J0IHR5cGUgeyBCYWNrb2ZmT3B0aW9ucyB9IGZyb20gJy4vcmVjb25uZWN0LmpzJztcbmltcG9ydCB0eXBlIHsgU3RhdHVzQmFyTW9kZSB9IGZyb20gJy4vc3RhdHVzYmFyLmpzJztcbmltcG9ydCB7IFZhdWx0U3luY1NldHRpbmdUYWIgfSBmcm9tICcuL3NldHRpbmdzLmpzJztcbmltcG9ydCB7IFN0YXR1c0JhckluZGljYXRvciB9IGZyb20gJy4vc3RhdHVzYmFyLmpzJztcbmltcG9ydCB7IFdlYlNvY2tldFRyYW5zcG9ydCB9IGZyb20gJy4vdHJhbnNwb3J0LmpzJztcbmltcG9ydCB0eXBlIHsgV2ViU29ja2V0RmFjdG9yeSB9IGZyb20gJy4vdHJhbnNwb3J0LmpzJztcbmltcG9ydCB7IGZldGNoV29ya2VyU3RhdHVzLCBub3JtYWxpemVXb3JrZXJVcmwsIHJlbmFtZURldmljZSB9IGZyb20gJy4vd29ya2VyYXBpLmpzJztcbmltcG9ydCB0eXBlIHsgV29ya2VyU3RhdHVzU3VtbWFyeSB9IGZyb20gJy4vd29ya2VyYXBpLmpzJztcblxuLyoqIFRoZSBpbi12YXVsdCBkZXZpY2UgbWFya2VyIHNoYXJlZCB3aXRoIHRoZSBkYWVtb24vQ0xJIChGUi00NCBoYW5kc2hha2UpLiAqL1xuY29uc3QgREVWSUNFX01BUktFUl9WQVVMVF9QQVRIID0gJy8udmF1bHRzeW5jZm9yYWdlbnRzL2RldmljZS5qc29uJztcbmNvbnN0IExPQ0FMX0lOREVYX1ZBVUxUX1BBVEggPSAnLy52YXVsdHN5bmNmb3JhZ2VudHMvc3RhdGUnO1xuY29uc3QgU1VQRVJWSVNJT05fVElDS19NUyA9IDEwMDA7XG5cbi8qKiBUaW1lciBoYW5kbGVzIChudW1iZXIgaW4gdGhlIERPTSwgYFRpbWVvdXRgIHdoZW4gTm9kZSB0eXBlcyBsZWFrIGluKS4gKi9cbnR5cGUgVGltZXJIYW5kbGUgPSBSZXR1cm5UeXBlPHR5cGVvZiBzZXRJbnRlcnZhbD47XG5cbi8qKiBJbmplY3RhYmxlIHNlYW1zIHNvIHVuaXQgdGVzdHMgbmVlZCBubyByZWFsIE9ic2lkaWFuL25ldHdvcmsuICovXG5leHBvcnQgaW50ZXJmYWNlIFBsdWdpbk92ZXJyaWRlcyB7XG4gIGZldGNoSW1wbD86IHR5cGVvZiBmZXRjaDtcbiAgd3NGYWN0b3J5PzogV2ViU29ja2V0RmFjdG9yeTtcbiAgbm93PzogKCkgPT4gbnVtYmVyO1xuICAvKiogUmVjb25uZWN0IGJhY2tvZmYga25vYnMgKHRlc3RzIGluamVjdCBhIGRldGVybWluaXN0aWMgcmFuZG9tKS4gKi9cbiAgcmVjb25uZWN0PzogQmFja29mZk9wdGlvbnM7XG59XG5cbmV4cG9ydCBjbGFzcyBWYXVsdFN5bmNQbHVnaW4gZXh0ZW5kcyBQbHVnaW4ge1xuICBkYXRhOiBWYXVsdFN5bmNQbHVnaW5EYXRhID0gZGVmYXVsdFBsdWdpbkRhdGEoKTtcbiAgLyoqIFRoZSBsaXZlIHN5bmMgY2xpZW50IChudWxsIHdoaWxlIHVubGlua2VkL3N0b3BwZWQpLiAqL1xuICBjbGllbnQ6IFN5bmNDbGllbnQgfCBudWxsID0gbnVsbDtcblxuICBwcml2YXRlIHJlYWRvbmx5IG92ZXJyaWRlczogUGx1Z2luT3ZlcnJpZGVzO1xuICBwcml2YXRlIHdhdGNoZXI6IE9ic2lkaWFuV2F0Y2hBZGFwdGVyIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgcmVzY2FuOiBSZXNjYW5TY2hlZHVsZXIgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBzdGF0dXNCYXI6IFN0YXR1c0JhckluZGljYXRvciB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHN0YXR1c0Jhckl0ZW06IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgdGlja0hhbmRsZTogVGltZXJIYW5kbGUgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSByZWNvbm5lY3RUaW1lcjogVGltZXJIYW5kbGUgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBzdXBlcnZpc29yID0gbmV3IFJlY29ubmVjdFN1cGVydmlzb3IoKTtcbiAgLyoqIFNldCB3aGVuIHRoZSB3b3JrZXIgcmVqZWN0ZWQgdGhlIHRva2VuIFx1MjAxNCByZWNvbm5lY3RpbmcgY2Fubm90IGhlbHAuICovXG4gIHByaXZhdGUgYXV0aEZhaWxlZCA9IGZhbHNlO1xuICBwcml2YXRlIHN0YXR1c05vdGUgPSAnJztcbiAgLyoqIFBhdXNlLXN5bmNpbmcgc3RhdGUgKHJ1bnRpbWUgb25seSBcdTIwMTQgYSByZWxvYWQgc3RhcnRzIHBlciBzeW5jT25TdGFydHVwKS4gKi9cbiAgcHJpdmF0ZSBwYXVzZWQgPSBmYWxzZTtcbiAgLyoqIFRoZSBwbHVnaW4ncyBsb2c6IGNvbnNvbGUgbWlycm9yICsgYm91bmRlZCByaW5nIChDb3B5IGRpYWdub3N0aWNzKS4gKi9cbiAgcHJpdmF0ZSByZWFkb25seSBzeW5jTG9nOiBQbHVnaW5Mb2cgPSBjcmVhdGVQbHVnaW5Mb2coKTtcblxuICBjb25zdHJ1Y3RvcihhcHA6IEFwcCwgbWFuaWZlc3Q6IFBsdWdpbk1hbmlmZXN0LCBvdmVycmlkZXM6IFBsdWdpbk92ZXJyaWRlcyA9IHt9KSB7XG4gICAgc3VwZXIoYXBwLCBtYW5pZmVzdCk7XG4gICAgdGhpcy5vdmVycmlkZXMgPSBvdmVycmlkZXM7XG4gIH1cblxuICBwcml2YXRlIGdldCBub3coKTogKCkgPT4gbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy5vdmVycmlkZXMubm93ID8/ICgoKSA9PiBEYXRlLm5vdygpKTtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0IGZldGNoSW1wbCgpOiB0eXBlb2YgZmV0Y2gge1xuICAgIC8vIEJpbmQgYXQgdGhlIHNlYW06IGNvbnN1bWVycyAocGFpcmluZywgYEh0dHBCbG9iU3RvcmVgKSBpbnZva2UgdGhpcyBhcyBhXG4gICAgLy8gZGV0YWNoZWQgZnVuY3Rpb24sIGFuZCBhIGRldGFjaGVkIGBmZXRjaGAgdGhyb3dzXG4gICAgLy8gYFR5cGVFcnJvcjogRmFpbGVkIHRvIGV4ZWN1dGUgJ2ZldGNoJyBvbiAnV2luZG93JzogSWxsZWdhbCBpbnZvY2F0aW9uYFxuICAgIC8vIGluIENocm9taXVtIHJlbmRlcmVycyBcdTIwMTQgaS5lLiBpbiByZWFsIE9ic2lkaWFuIChkZXNrdG9wIGFuZCBtb2JpbGUpLlxuICAgIC8vIEJpbmRpbmcgdG8gdGhlIGdsb2JhbCBtYWtlcyB0aGUgZGVmYXVsdCBzYWZlIHRvIGNhbGwgYmFyZS5cbiAgICByZXR1cm4gdGhpcy5vdmVycmlkZXMuZmV0Y2hJbXBsID8/IGdsb2JhbFRoaXMuZmV0Y2guYmluZChnbG9iYWxUaGlzKTtcbiAgfVxuXG4gIGdldCBsaW5rZWQoKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGlzTGlua2VkKHRoaXMuZGF0YSk7XG4gIH1cblxuICBvdmVycmlkZSBhc3luYyBvbmxvYWQoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5kYXRhID0gbm9ybWFsaXplUGx1Z2luRGF0YShhd2FpdCB0aGlzLmxvYWREYXRhKCkpO1xuICAgIHRoaXMuc3luY0xvZy5zZXRMZXZlbCh0aGlzLmRhdGEuc2V0dGluZ3MubG9nTGV2ZWwpO1xuICAgIHRoaXMuYWRkU2V0dGluZ1RhYihuZXcgVmF1bHRTeW5jU2V0dGluZ1RhYih0aGlzLmFwcCwgdGhpcykpO1xuICAgIHJlZ2lzdGVyUGFpclByb3RvY29sSGFuZGxlcihcbiAgICAgIChhY3Rpb24sIGhhbmRsZXIpID0+IHRoaXMucmVnaXN0ZXJPYnNpZGlhblByb3RvY29sSGFuZGxlcihhY3Rpb24sIGhhbmRsZXIpLFxuICAgICAgKGxpbmspID0+IHRoaXMuaGFuZGxlUGFpckRlZXBMaW5rKGxpbmsudXJsLCBsaW5rLmNvZGUpLFxuICAgICk7XG4gICAgLy8gQ2hlYXAgZm9jdXMtZHJpdmVuIHJlc2NhbiAoRlItMTIpOiBldmVyeSBub3RlL2FwcCBzd2l0Y2ggcG9rZXMgdGhlXG4gICAgLy8gc2NoZWR1bGVyLCB3aGljaCBjb2FsZXNjZXMgaW50byBhdCBtb3N0IG9uZSBjeWNsZSBwZXIgZGVib3VuY2Ugd2luZG93LlxuICAgIHRoaXMucmVnaXN0ZXJFdmVudCh0aGlzLmFwcC53b3Jrc3BhY2Uub24oJ2FjdGl2ZS1sZWFmLWNoYW5nZScsICgpID0+IHRoaXMucmVzY2FuPy5wb2tlKCkpKTtcbiAgICAvLyBcIlN5bmMgb24gc3RhcnR1cFwiIE9GRiA9IG1hbnVhbC1vbmx5IG1vZGU6IGxvYWQgaWRsZTsgdGhlIGZpcnN0IFwiU3luY1xuICAgIC8vIG5vd1wiIHN0YXJ0cyB0aGUgbWFjaGluZXJ5ICh3YXRjaGVyIGluY2x1ZGVkKS5cbiAgICBpZiAodGhpcy5saW5rZWQgJiYgdGhpcy5kYXRhLnNldHRpbmdzLnN5bmNPblN0YXJ0dXApIGF3YWl0IHRoaXMuc3RhcnRTeW5jKCk7XG4gIH1cblxuICBvdmVycmlkZSBvbnVubG9hZCgpOiB2b2lkIHtcbiAgICB0aGlzLnN0b3BTeW5jKCk7XG4gIH1cblxuICAvLyAtLS0gcGVyc2lzdGVuY2UgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICBhc3luYyBzYXZlUGx1Z2luRGF0YSgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLnNhdmVEYXRhKHRoaXMuZGF0YSk7XG4gIH1cblxuICAvLyAtLS0gcGFpcmluZyAoc2V0dGluZ3MgdGFiICsgZGVlcCBsaW5rKSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIC8qKiBQYWlyIGZyb20gdGhlIHNldHRpbmdzIGZvcm0gKGZpZWxkcyBhbHJlYWR5IGxpdmUgaW4gYHRoaXMuZGF0YWApLiAqL1xuICBhc3luYyBwYWlyRnJvbVNldHRpbmdzKGNvZGU6IHN0cmluZyk6IFByb21pc2U8UGFpck91dGNvbWU+IHtcbiAgICBjb25zdCBkZXZpY2VOYW1lID0gdGhpcy5yZXNvbHZlRGV2aWNlTmFtZSgpO1xuICAgIGNvbnN0IG91dGNvbWUgPSBhd2FpdCBwYWlyV2l0aFdvcmtlcih7XG4gICAgICB1cmw6IHRoaXMuZGF0YS51cmwsXG4gICAgICBjb2RlLFxuICAgICAgZGV2aWNlTmFtZSxcbiAgICAgIGRldmljZVR5cGU6IGRldGVjdERldmljZVR5cGUoKSxcbiAgICAgIGZldGNoSW1wbDogdGhpcy5mZXRjaEltcGwsXG4gICAgfSk7XG4gICAgYXdhaXQgdGhpcy5hcHBseVBhaXJPdXRjb21lKG91dGNvbWUsIGRldmljZU5hbWUpO1xuICAgIHJldHVybiBvdXRjb21lO1xuICB9XG5cbiAgLyoqIG9ic2lkaWFuOi8vdmF1bHRzeW5jZm9yYWdlbnRzL3BhaXI/dXJsPVx1MjAyNiZjb2RlPVx1MjAyNiAocHJvdG9jb2wtaGFuZGxlci50cykuICovXG4gIHByaXZhdGUgYXN5bmMgaGFuZGxlUGFpckRlZXBMaW5rKHVybDogc3RyaW5nLCBjb2RlOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAodGhpcy5saW5rZWQpIHtcbiAgICAgIGlmIChub3JtYWxpemVXb3JrZXJVcmxTYWZlKHVybCkgPT09IG5vcm1hbGl6ZVdvcmtlclVybFNhZmUodGhpcy5kYXRhLnVybCkpIHtcbiAgICAgICAgbmV3IE5vdGljZSgnVmF1bHRTeW5jOiB0aGlzIHZhdWx0IGlzIGFscmVhZHkgcGFpcmVkIHdpdGggdGhhdCB3b3JrZXIuJyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBuZXcgTm90aWNlKFxuICAgICAgICAgICdWYXVsdFN5bmM6IHRoaXMgdmF1bHQgaXMgcGFpcmVkIHdpdGggYSBkaWZmZXJlbnQgd29ya2VyLiBVbmxpbmsgaXQgaW4gc2V0dGluZ3MgZmlyc3QuJyxcbiAgICAgICAgICAxMDAwMCxcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgZGV2aWNlTmFtZSA9IHRoaXMucmVzb2x2ZURldmljZU5hbWUoKTtcbiAgICBjb25zdCBvdXRjb21lID0gYXdhaXQgcGFpcldpdGhXb3JrZXIoe1xuICAgICAgdXJsLFxuICAgICAgY29kZSxcbiAgICAgIGRldmljZU5hbWUsXG4gICAgICBkZXZpY2VUeXBlOiBkZXRlY3REZXZpY2VUeXBlKCksXG4gICAgICBmZXRjaEltcGw6IHRoaXMuZmV0Y2hJbXBsLFxuICAgIH0pO1xuICAgIGF3YWl0IHRoaXMuYXBwbHlQYWlyT3V0Y29tZShvdXRjb21lLCBkZXZpY2VOYW1lKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgYXBwbHlQYWlyT3V0Y29tZShvdXRjb21lOiBQYWlyT3V0Y29tZSwgZGV2aWNlTmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKG91dGNvbWUuc3RhdHVzICE9PSAncGFpcmVkJykge1xuICAgICAgbmV3IE5vdGljZShwYWlyT3V0Y29tZU1lc3NhZ2Uob3V0Y29tZSksIDEwMDAwKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5kYXRhLnVybCA9IG91dGNvbWUudXJsO1xuICAgIHRoaXMuZGF0YS50b2tlbiA9IG91dGNvbWUudG9rZW47XG4gICAgdGhpcy5kYXRhLmRldmljZUlkID0gb3V0Y29tZS5kZXZpY2VJZDtcbiAgICB0aGlzLmRhdGEuZGV2aWNlTmFtZSA9IGRldmljZU5hbWU7XG4gICAgYXdhaXQgdGhpcy5zYXZlUGx1Z2luRGF0YSgpO1xuICAgIGF3YWl0IHRoaXMud3JpdGVEZXZpY2VNYXJrZXIoKTtcbiAgICBuZXcgTm90aWNlKHBhaXJPdXRjb21lTWVzc2FnZShvdXRjb21lKSk7XG4gICAgYXdhaXQgdGhpcy5zdGFydFN5bmMoKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVzb2x2ZURldmljZU5hbWUoKTogc3RyaW5nIHtcbiAgICBjb25zdCB0eXBlZCA9IHRoaXMuZGF0YS5kZXZpY2VOYW1lLnRyaW0oKTtcbiAgICByZXR1cm4gdHlwZWQgIT09ICcnID8gdHlwZWQgOiBkZWZhdWx0RGV2aWNlTmFtZSgpO1xuICB9XG5cbiAgLyoqIFdyaXRlIHRoZSBGUi00NCBtYXJrZXIgdGhlIENMSS9kYWVtb24gcmVhZCB0byBkZXRlY3QgZG91YmxlLWNsaWVudHMuICovXG4gIHByaXZhdGUgYXN5bmMgd3JpdGVEZXZpY2VNYXJrZXIoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCF0aGlzLmxpbmtlZCkgcmV0dXJuO1xuICAgIGNvbnN0IHN0b3JhZ2UgPSBuZXcgT2JzaWRpYW5TdG9yYWdlQWRhcHRlcih7IGFkYXB0ZXI6IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIgfSk7XG4gICAgY29uc3QgbWFya2VyID0ge1xuICAgICAgZGV2aWNlSWQ6IHRoaXMuZGF0YS5kZXZpY2VJZCxcbiAgICAgIGRldmljZU5hbWU6IHRoaXMucmVzb2x2ZURldmljZU5hbWUoKSxcbiAgICAgIHVybDogdGhpcy5kYXRhLnVybCxcbiAgICAgIGxpbmtlZEF0OiB0aGlzLm5vdygpLFxuICAgIH07XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHN0b3JhZ2Uud3JpdGVGaWxlKFxuICAgICAgICBERVZJQ0VfTUFSS0VSX1ZBVUxUX1BBVEgsXG4gICAgICAgIG5ldyBUZXh0RW5jb2RlcigpLmVuY29kZShgJHtKU09OLnN0cmluZ2lmeShtYXJrZXIsIG51bGwsIDIpfVxcbmApLFxuICAgICAgKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5zeW5jTG9nLndhcm4oJ2ZhaWxlZCB0byB3cml0ZSBkZXZpY2UgbWFya2VyJywgZXJyb3IpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBgUEFUQ0ggL2RldmljZWAgXHUyMDE0IHJlbmFtZSBUSElTIGRldmljZSBvbiB0aGUgd29ya2VyICh0aGUgc2V0dGluZ3MgdGFiJ3NcbiAgICogUmVuYW1lIGJ1dHRvbikuIFVwZGF0ZXMgcGx1Z2luIGRhdGEgKyB0aGUgaW4tdmF1bHQgZGV2aWNlIG1hcmtlciAod2hpY2hcbiAgICogc3RvcmVzIHRoZSBuYW1lIGZvciB0aGUgRlItNDQgZG91YmxlLWNsaWVudCB3YXJuaW5nKS4gTG9jYWwgc3RhdGUga2VlcHNcbiAgICogaXRzIHByZXZpb3VzIG5hbWUgb24gZmFpbHVyZS5cbiAgICovXG4gIGFzeW5jIHJlbmFtZURldmljZShuYW1lOiBzdHJpbmcpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBpZiAoIXRoaXMubGlua2VkKSB7XG4gICAgICBuZXcgTm90aWNlKCdWYXVsdFN5bmM6IHBhaXIgdGhpcyB2YXVsdCBmaXJzdCBcdTIwMTQgdGhlIG5hbWUgYXBwbGllcyBhdCBwYWlyaW5nIHRpbWUuJyk7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGNvbnN0IHRyaW1tZWQgPSBuYW1lLnRyaW0oKTtcbiAgICBpZiAodHJpbW1lZCA9PT0gJycgfHwgdHJpbW1lZC5sZW5ndGggPiAzMCB8fCAvW1xcdTAwMDAtXFx1MDAxZlxcdTAwN2ZdLy50ZXN0KHRyaW1tZWQpKSB7XG4gICAgICBuZXcgTm90aWNlKCdWYXVsdFN5bmM6IGRldmljZSBuYW1lIG11c3QgYmUgMS0zMCBjaGFyYWN0ZXJzLCB3aXRob3V0IGNvbnRyb2wgY2hhcmFjdGVycy4nLCA4MDAwKTtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgY29uc3Qgb3V0Y29tZSA9IGF3YWl0IHJlbmFtZURldmljZSh7XG4gICAgICBvcmlnaW46IHRoaXMuZGF0YS51cmwsXG4gICAgICB0b2tlbjogdGhpcy5kYXRhLnRva2VuLFxuICAgICAgbmFtZTogdHJpbW1lZCxcbiAgICAgIGZldGNoSW1wbDogdGhpcy5mZXRjaEltcGwsXG4gICAgfSk7XG4gICAgaWYgKCFvdXRjb21lLm9rKSB7XG4gICAgICBuZXcgTm90aWNlKGBWYXVsdFN5bmM6IHJlbmFtaW5nIGZhaWxlZCBcdTIwMTQgJHtvdXRjb21lLmVycm9yfWAsIDEwMDAwKTtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgdGhpcy5kYXRhLmRldmljZU5hbWUgPSBvdXRjb21lLmRldmljZS5uYW1lO1xuICAgIGF3YWl0IHRoaXMuc2F2ZVBsdWdpbkRhdGEoKTtcbiAgICBhd2FpdCB0aGlzLndyaXRlRGV2aWNlTWFya2VyKCk7XG4gICAgbmV3IE5vdGljZShgVmF1bHRTeW5jOiBkZXZpY2UgcmVuYW1lZCB0byBcdTIwMUMke291dGNvbWUuZGV2aWNlLm5hbWV9XHUyMDFELmApO1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgLy8gLS0tIHN5bmMgbGlmZWN5Y2xlIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIC8qKiBCdWlsZCBldmVyeXRoaW5nIGFuZCBydW4gc3RhcnR1cCByZWNvbmNpbGlhdGlvbiAoaWRlbXBvdGVudCByZXN0YXJ0KS4gKi9cbiAgcHJpdmF0ZSBhc3luYyBzdGFydFN5bmMoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCF0aGlzLmxpbmtlZCkgcmV0dXJuO1xuICAgIHRoaXMuc3RvcFN5bmMoKTtcblxuICAgIGNvbnN0IHsgdXJsLCB0b2tlbiwgZGV2aWNlSWQgfSA9IHRoaXMuZGF0YTtcbiAgICBjb25zdCBkZXZpY2VOYW1lID0gdGhpcy5yZXNvbHZlRGV2aWNlTmFtZSgpO1xuICAgIGNvbnN0IHN0b3JhZ2UgPSBuZXcgT2JzaWRpYW5TdG9yYWdlQWRhcHRlcih7IGFkYXB0ZXI6IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIgfSk7XG4gICAgYXdhaXQgdGhpcy53YXJuSWZGb3JlaWduU3RhdGVEaXIoc3RvcmFnZSk7XG5cbiAgICBjb25zdCBjbGllbnQgPSBuZXcgU3luY0NsaWVudCh7XG4gICAgICBkZXZpY2VJZCxcbiAgICAgIGRldmljZU5hbWUsXG4gICAgICB0b2tlbixcbiAgICAgIHRyYW5zcG9ydDogKCkgPT5cbiAgICAgICAgd2l0aFJvdW5kVHJpcExvZ2dpbmcoXG4gICAgICAgICAgbmV3IFdlYlNvY2tldFRyYW5zcG9ydCh7IHVybCwgdG9rZW4sIHdzRmFjdG9yeTogdGhpcy5vdmVycmlkZXMud3NGYWN0b3J5IH0pLFxuICAgICAgICAgIHsgbG9nOiB0aGlzLnN5bmNMb2csIHNob3VsZExvZzogKCkgPT4gdGhpcy5zeW5jTG9nLmRlYnVnRW5hYmxlZCB9LFxuICAgICAgICApLFxuICAgICAgYmxvYlN0b3JlOiBuZXcgSHR0cEJsb2JTdG9yZSh7IGJhc2VVcmw6IHVybCwgdG9rZW4sIGZldGNoSW1wbDogdGhpcy5mZXRjaEltcGwgfSksXG4gICAgICBzdG9yYWdlLFxuICAgICAgc2V0dGluZ3M6IHtcbiAgICAgICAgb2JzaWRpYW5TeW5jOiB0aGlzLmRhdGEuc2V0dGluZ3Mub2JzaWRpYW5TeW5jLFxuICAgICAgICBleHRyYUlnbm9yZXM6IHBhcnNlSWdub3JlUGF0dGVybnModGhpcy5kYXRhLnNldHRpbmdzLmlnbm9yZVBhdHRlcm5zKSxcbiAgICAgIH0sXG4gICAgICBsb2c6IHRoaXMuc3luY0xvZyxcbiAgICAgIG5vdzogdGhpcy5ub3csXG4gICAgfSk7XG4gICAgdGhpcy5jbGllbnQgPSBjbGllbnQ7XG4gICAgdGhpcy5hdXRoRmFpbGVkID0gZmFsc2U7XG4gICAgdGhpcy5zdGF0dXNOb3RlID0gJyc7XG4gICAgdGhpcy5zdXBlcnZpc29yID0gbmV3IFJlY29ubmVjdFN1cGVydmlzb3IodGhpcy5vdmVycmlkZXMucmVjb25uZWN0ID8/IHt9KTtcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBjbGllbnQuY29ubmVjdCgpOyAvLyBzdGFydHVwIHJlY29uY2lsaWF0aW9uIFx1MjE5MiBsaXZlIG1vZGVcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5oYW5kbGVTeW5jRXJyb3IoZXJyb3IsICdzdGFydHVwIHN5bmMgZmFpbGVkJyk7XG4gICAgfVxuXG4gICAgLy8gTGl2ZSB3YXRjaGluZzogdmF1bHQgZXZlbnRzIChkZWJvdW5jZWQgaW4gY29yZSkgKyByZXNjYW4gaG9va3MuXG4gICAgdGhpcy53YXRjaGVyID0gbmV3IE9ic2lkaWFuV2F0Y2hBZGFwdGVyKHsgdmF1bHQ6IHRoaXMuYXBwLnZhdWx0IH0pO1xuICAgIGNsaWVudC5zdGFydFdhdGNoaW5nKHRoaXMud2F0Y2hlcik7XG4gICAgdGhpcy5yZXNjYW4gPSBuZXcgUmVzY2FuU2NoZWR1bGVyKHtcbiAgICAgIGludGVydmFsTXM6IHRoaXMuZGF0YS5zZXR0aW5ncy5yZXNjYW5JbnRlcnZhbFNlYyAqIDEwMDAsXG4gICAgfSk7XG4gICAgdGhpcy5yZXNjYW4uc3RhcnQoKCkgPT4ge1xuICAgICAgdm9pZCBjbGllbnQudHJpZ2dlclN5bmMoKS5jYXRjaCgoZXJyb3I6IHVua25vd24pID0+IHtcbiAgICAgICAgdGhpcy5oYW5kbGVTeW5jRXJyb3IoZXJyb3IsICdyZXNjYW4gZmFpbGVkJyk7XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIC8vIFN0YXR1cyBiYXIgKHBlciB0aGUgc3RhdHVzQmFyTW9kZSBzZXR0aW5nKSArIHRoZSAxIEh6IHN1cGVydmlzaW9uIHRpY2tcbiAgICAvLyB0aGF0IHJlcGFpbnRzIGl0IGFuZCBzdXBlcnZpc2VzIHJlY29ubmVjdGlvbi5cbiAgICB0aGlzLm1vdW50U3RhdHVzQmFyKCk7XG4gICAgY29uc3QgdGljayA9IHNldEludGVydmFsKCgpID0+IHRoaXMub25UaWNrKCksIFNVUEVSVklTSU9OX1RJQ0tfTVMpO1xuICAgIHRoaXMudGlja0hhbmRsZSA9IHRpY2s7XG4gICAgdGhpcy5yZWdpc3RlckludGVydmFsKHRpY2sgYXMgdW5rbm93biBhcyBudW1iZXIpOyAvLyBPYnNpZGlhbiBjbGVhcnMgdGhpcyBvbiB1bmxvYWRcbiAgICB0aGlzLm9uVGljaygpO1xuICB9XG5cbiAgLyoqIChSZSltb3VudCB0aGUgc3RhdHVzLWJhciBpdGVtIHBlciB0aGUgY3VycmVudCBtb2RlICgnaGlkZGVuJyA9IG5vbmUpLiAqL1xuICBwcml2YXRlIG1vdW50U3RhdHVzQmFyKCk6IHZvaWQge1xuICAgIHRoaXMuc3RhdHVzQmFySXRlbT8ucmVtb3ZlKCk7XG4gICAgdGhpcy5zdGF0dXNCYXJJdGVtID0gbnVsbDtcbiAgICB0aGlzLnN0YXR1c0JhciA9IG51bGw7XG4gICAgaWYgKHRoaXMuY2xpZW50ID09PSBudWxsKSByZXR1cm47XG4gICAgaWYgKHRoaXMuZGF0YS5zZXR0aW5ncy5zdGF0dXNCYXJNb2RlID09PSAnaGlkZGVuJykgcmV0dXJuO1xuICAgIGNvbnN0IGl0ZW0gPSB0aGlzLmFkZFN0YXR1c0Jhckl0ZW0oKTtcbiAgICB0aGlzLnN0YXR1c0Jhckl0ZW0gPSBpdGVtO1xuICAgIHRoaXMuc3RhdHVzQmFyID0gbmV3IFN0YXR1c0JhckluZGljYXRvcihpdGVtKTtcbiAgfVxuXG4gIC8qKiBUZWFyIGRvd24gZXZlcnkgdGltZXIsIHdhdGNoZXIsIHNvY2tldCwgYW5kIFVJIGFydGlmYWN0LiBJZGVtcG90ZW50LiAqL1xuICBwcml2YXRlIHN0b3BTeW5jKCk6IHZvaWQge1xuICAgIGlmICh0aGlzLnJlY29ubmVjdFRpbWVyICE9PSBudWxsKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGhpcy5yZWNvbm5lY3RUaW1lcik7XG4gICAgICB0aGlzLnJlY29ubmVjdFRpbWVyID0gbnVsbDtcbiAgICB9XG4gICAgaWYgKHRoaXMudGlja0hhbmRsZSAhPT0gbnVsbCkge1xuICAgICAgY2xlYXJJbnRlcnZhbCh0aGlzLnRpY2tIYW5kbGUpO1xuICAgICAgdGhpcy50aWNrSGFuZGxlID0gbnVsbDtcbiAgICB9XG4gICAgdGhpcy5yZXNjYW4/LnN0b3AoKTtcbiAgICB0aGlzLnJlc2NhbiA9IG51bGw7XG4gICAgdGhpcy5jbGllbnQ/LmNsb3NlKCk7IC8vIGFsc28gc3RvcHMgdGhlIHdhdGNoZXJcbiAgICB0aGlzLmNsaWVudCA9IG51bGw7XG4gICAgdGhpcy53YXRjaGVyID0gbnVsbDtcbiAgICB0aGlzLnN0YXR1c0Jhckl0ZW0/LnJlbW92ZSgpO1xuICAgIHRoaXMuc3RhdHVzQmFySXRlbSA9IG51bGw7XG4gICAgdGhpcy5zdGF0dXNCYXIgPSBudWxsO1xuICB9XG5cbiAgLy8gLS0tIHVzZXIgYWN0aW9ucyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgYXN5bmMgc3luY05vdygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAodGhpcy5wYXVzZWQpIHtcbiAgICAgIG5ldyBOb3RpY2UoJ1ZhdWx0U3luYzogc3luY2luZyBpcyBwYXVzZWQgXHUyMDE0IHJlc3VtZSBpdCBpbiBzZXR0aW5ncyBmaXJzdC4nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgY2xpZW50ID0gdGhpcy5jbGllbnQ7XG4gICAgaWYgKGNsaWVudCA9PT0gbnVsbCkge1xuICAgICAgaWYgKCF0aGlzLmxpbmtlZCkge1xuICAgICAgICBuZXcgTm90aWNlKCdWYXVsdFN5bmM6IG5vdCBwYWlyZWQgeWV0IFx1MjAxNCBhZGQgeW91ciB3b3JrZXIgVVJMIGFuZCBhIHBhaXJpbmcgY29kZSBpbiBzZXR0aW5ncy4nKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgLy8gTWFudWFsLW9ubHkgbW9kZSAoXCJTeW5jIG9uIHN0YXJ0dXBcIiBPRkYpOiB0aGlzIGlzIHRoZSBmaXJzdCBzdGFydC5cbiAgICAgIGF3YWl0IHRoaXMuc3RhcnRTeW5jKCk7XG4gICAgICBjb25zdCBzdGF0dXMgPSB0aGlzLmNsaWVudD8uc3RhdHVzKCk7XG4gICAgICBpZiAoc3RhdHVzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgbmV3IE5vdGljZShcbiAgICAgICAgICBzdGF0dXMuc3RhdGUgPT09ICdkaXNjb25uZWN0ZWQnXG4gICAgICAgICAgICA/ICdWYXVsdFN5bmM6IG9mZmxpbmUgXHUyMDE0IGNoYW5nZXMgd2lsbCBzeW5jIHdoZW4gdGhlIHdvcmtlciBpcyByZWFjaGFibGUuJ1xuICAgICAgICAgICAgOiAnVmF1bHRTeW5jOiB1cCB0byBkYXRlLicsXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBjbGllbnQudHJpZ2dlclN5bmMoKTtcbiAgICAgIGNvbnN0IHN0YXR1cyA9IGNsaWVudC5zdGF0dXMoKTtcbiAgICAgIG5ldyBOb3RpY2UoXG4gICAgICAgIHN0YXR1cy5zdGF0ZSA9PT0gJ2Rpc2Nvbm5lY3RlZCdcbiAgICAgICAgICA/ICdWYXVsdFN5bmM6IG9mZmxpbmUgXHUyMDE0IGNoYW5nZXMgd2lsbCBzeW5jIHdoZW4gdGhlIHdvcmtlciBpcyByZWFjaGFibGUuJ1xuICAgICAgICAgIDogJ1ZhdWx0U3luYzogdXAgdG8gZGF0ZS4nLFxuICAgICAgKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5oYW5kbGVTeW5jRXJyb3IoZXJyb3IsICdzeW5jIG5vdyBmYWlsZWQnKTtcbiAgICAgIG5ldyBOb3RpY2UoJ1ZhdWx0U3luYzogc3luYyBmYWlsZWQgXHUyMDE0IHNlZSB0aGUgZGV2ZWxvcGVyIGNvbnNvbGUgZm9yIGRldGFpbHMuJyk7XG4gICAgfVxuICB9XG5cbiAgLyoqIFBhdXNlOiB0cmFuc3BvcnQgZG93biArIHdhdGNoZXIvcmVzY2FuIGlkbGUsIGxpbmsgYW5kIHN0YXRlIGtlcHQuICovXG4gIHBhdXNlU3luY2luZygpOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMubGlua2VkIHx8IHRoaXMucGF1c2VkKSByZXR1cm47XG4gICAgdGhpcy5wYXVzZWQgPSB0cnVlO1xuICAgIGlmICh0aGlzLnJlY29ubmVjdFRpbWVyICE9PSBudWxsKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGhpcy5yZWNvbm5lY3RUaW1lcik7XG4gICAgICB0aGlzLnJlY29ubmVjdFRpbWVyID0gbnVsbDtcbiAgICB9XG4gICAgdGhpcy5zdXBlcnZpc29yLnNldHRsZWQoKTtcbiAgICB0aGlzLnJlc2Nhbj8uc3RvcCgpO1xuICAgIHRoaXMucmVzY2FuID0gbnVsbDtcbiAgICB0aGlzLmNsaWVudD8uY2xvc2UoKTsgLy8gYWxzbyBzdG9wcyB0aGUgd2F0Y2hlcjsgc3RhdGUgXHUyMTkyIGlkbGVcbiAgICB0aGlzLm9uVGljaygpOyAvLyByZXBhaW50IFwidnNhIFx1MjNGOFwiXG4gICAgbmV3IE5vdGljZSgnVmF1bHRTeW5jOiBwYXVzZWQuIE5ldyBhbmQgY2hhbmdlZCBmaWxlcyBzdGF5IGxvY2FsIHVudGlsIHlvdSByZXN1bWUuJyk7XG4gIH1cblxuICAvKiogUmVzdW1lOiByZWNvbm5lY3QgYW5kIHJ1biBhIGZ1bGwgY2F0Y2gtdXAgY3ljbGUgKHN0YXJ0dXAgcmVjb25jaWxpYXRpb24pLiAqL1xuICBhc3luYyByZXN1bWVTeW5jaW5nKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghdGhpcy5saW5rZWQgfHwgIXRoaXMucGF1c2VkKSByZXR1cm47XG4gICAgdGhpcy5wYXVzZWQgPSBmYWxzZTtcbiAgICBuZXcgTm90aWNlKCdWYXVsdFN5bmM6IHJlc3VtaW5nIFx1MjAxNCBydW5uaW5nIGEgZnVsbCBjYXRjaC11cCBzeW5jXHUyMDI2Jyk7XG4gICAgYXdhaXQgdGhpcy5zdGFydFN5bmMoKTtcbiAgfVxuXG4gIC8qKiBSdW50aW1lIHBhdXNlIHN0YXRlICh0aGUgc2V0dGluZ3MgdGFiJ3MgYnV0dG9uIGxhYmVsICsgZGlhZ25vc3RpY3MpLiAqL1xuICBnZXQgc3luY2luZ1BhdXNlZCgpOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy5wYXVzZWQ7XG4gIH1cblxuICBhc3luYyBhcHBseVJlc2NhbkludGVydmFsKHNlY29uZHM6IG51bWJlcik6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuZGF0YS5zZXR0aW5ncy5yZXNjYW5JbnRlcnZhbFNlYyA9IE1hdGgubWF4KDAsIE1hdGguZmxvb3Ioc2Vjb25kcykpO1xuICAgIGF3YWl0IHRoaXMuc2F2ZVBsdWdpbkRhdGEoKTtcbiAgICB0aGlzLnJlc2Nhbj8uc2V0SW50ZXJ2YWxNcyh0aGlzLmRhdGEuc2V0dGluZ3MucmVzY2FuSW50ZXJ2YWxTZWMgKiAxMDAwKTtcbiAgfVxuXG4gIGFzeW5jIGFwcGx5T2JzaWRpYW5TeW5jKGVuYWJsZWQ6IGJvb2xlYW4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLmRhdGEuc2V0dGluZ3Mub2JzaWRpYW5TeW5jID0gZW5hYmxlZDtcbiAgICBhd2FpdCB0aGlzLnNhdmVQbHVnaW5EYXRhKCk7XG4gICAgbmV3IE5vdGljZShcbiAgICAgIGVuYWJsZWRcbiAgICAgICAgPyAnVmF1bHRTeW5jOiAub2JzaWRpYW4vIHdpbGwgc3luYyBhZnRlciB0aGUgbmV4dCByZWNvbm5lY3QgKHRoZSB3b3JrZXJcXHUyMDE5cyBwZXItdmF1bHQgc2V0dGluZyB0YWtlcyBwcmVjZWRlbmNlKS4nXG4gICAgICAgIDogJ1ZhdWx0U3luYzogLm9ic2lkaWFuLyB3aWxsIGJlIGV4Y2x1ZGVkIGFmdGVyIHRoZSBuZXh0IHJlY29ubmVjdC4nLFxuICAgICk7XG4gIH1cblxuICBhc3luYyBhcHBseVN0YXR1c0Jhck1vZGUobW9kZTogU3RhdHVzQmFyTW9kZSk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuZGF0YS5zZXR0aW5ncy5zdGF0dXNCYXJNb2RlID0gbW9kZTtcbiAgICBhd2FpdCB0aGlzLnNhdmVQbHVnaW5EYXRhKCk7XG4gICAgdGhpcy5tb3VudFN0YXR1c0JhcigpOyAvLyByZS1tb3VudHMgKG9yIHJlbW92ZXMpIHRoZSBpdGVtIHBlciB0aGUgbW9kZVxuICAgIHRoaXMub25UaWNrKCk7XG4gIH1cblxuICBhc3luYyBhcHBseVN5bmNPblN0YXJ0dXAoZW5hYmxlZDogYm9vbGVhbik6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuZGF0YS5zZXR0aW5ncy5zeW5jT25TdGFydHVwID0gZW5hYmxlZDtcbiAgICBhd2FpdCB0aGlzLnNhdmVQbHVnaW5EYXRhKCk7XG4gICAgbmV3IE5vdGljZShcbiAgICAgIGVuYWJsZWRcbiAgICAgICAgPyAnVmF1bHRTeW5jOiBzeW5jaW5nIHdpbGwgc3RhcnQgYXV0b21hdGljYWxseSB0aGUgbmV4dCB0aW1lIE9ic2lkaWFuIG9wZW5zLidcbiAgICAgICAgOiAnVmF1bHRTeW5jOiBvbiB0aGUgbmV4dCBsYXVuY2ggdGhpcyBwbHVnaW4gc3RheXMgaWRsZSB1bnRpbCB5b3UgcHJlc3MgXHUyMDFDU3luYyBub3dcdTIwMUQuJyxcbiAgICApO1xuICB9XG5cbiAgYXN5bmMgYXBwbHlMb2dMZXZlbChsZXZlbDogTG9nTGV2ZWwpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLmRhdGEuc2V0dGluZ3MubG9nTGV2ZWwgPSBsZXZlbDtcbiAgICBhd2FpdCB0aGlzLnNhdmVQbHVnaW5EYXRhKCk7XG4gICAgdGhpcy5zeW5jTG9nLnNldExldmVsKGxldmVsKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBOZXcgaWdub3JlIHBhdHRlcm5zOiBwZXJzaXN0LCB0aGVuIHJlc3RhcnQgdGhlIHN5bmMgbWFjaGluZXJ5IHdoaWxlIGxpdmVcbiAgICogc28gdGhlIHNjYW4vd2F0Y2hlciBwaWNrIHRoZW0gdXAgaW1tZWRpYXRlbHkgKGEgcGF1c2VkIHNlc3Npb24gYXBwbGllc1xuICAgKiB0aGVtIG9uIHJlc3VtZSBcdTIwMTQgcmVzdW1lIGFsd2F5cyByZWJ1aWxkcyB0aGUgY2xpZW50KS5cbiAgICovXG4gIGFzeW5jIGFwcGx5SWdub3JlUGF0dGVybnModGV4dDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5kYXRhLnNldHRpbmdzLmlnbm9yZVBhdHRlcm5zID0gdGV4dDtcbiAgICBhd2FpdCB0aGlzLnNhdmVQbHVnaW5EYXRhKCk7XG4gICAgaWYgKHRoaXMuY2xpZW50ICE9PSBudWxsICYmICF0aGlzLnBhdXNlZCkgYXdhaXQgdGhpcy5zdGFydFN5bmMoKTtcbiAgfVxuXG4gIC8qKiBTdG9yYWdlL2F0dGFjaG1lbnQgc3VtbWFyeSBmb3IgdGhlIEFib3V0IHNlY3Rpb24gKG51bGwgPSB1bmF2YWlsYWJsZSkuICovXG4gIGFzeW5jIGZldGNoU3RvcmFnZVN1bW1hcnkoKTogUHJvbWlzZTxXb3JrZXJTdGF0dXNTdW1tYXJ5IHwgbnVsbD4ge1xuICAgIGlmICghdGhpcy5saW5rZWQpIHJldHVybiBudWxsO1xuICAgIHJldHVybiBmZXRjaFdvcmtlclN0YXR1cyh7XG4gICAgICBvcmlnaW46IHRoaXMuZGF0YS51cmwsXG4gICAgICB0b2tlbjogdGhpcy5kYXRhLnRva2VuLFxuICAgICAgZmV0Y2hJbXBsOiB0aGlzLmZldGNoSW1wbCxcbiAgICB9KTtcbiAgfVxuXG4gIC8qKiBDb3B5IHRoZSBkaWFnbm9zdGljcyBidW5kbGUgdG8gdGhlIGNsaXBib2FyZCAoZmFsbGJhY2s6IGNvbnNvbGUpLiAqL1xuICBhc3luYyBjb3B5RGlhZ25vc3RpY3MoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgYnVuZGxlID0gYnVpbGREaWFnbm9zdGljc0J1bmRsZSh7XG4gICAgICBwbHVnaW5WZXJzaW9uOiB0aGlzLm1hbmlmZXN0LnZlcnNpb24gfHwgJ3Vua25vd24nLFxuICAgICAgZGV2aWNlSWQ6IHRoaXMuZGF0YS5kZXZpY2VJZCxcbiAgICAgIGRldmljZU5hbWU6IHRoaXMucmVzb2x2ZURldmljZU5hbWUoKSxcbiAgICAgIHdvcmtlclVybDogdGhpcy5kYXRhLnVybCxcbiAgICAgIHBhaXJlZDogdGhpcy5saW5rZWQsXG4gICAgICBwYXVzZWQ6IHRoaXMucGF1c2VkLFxuICAgICAgY2xpZW50U3RhdHVzOiB0aGlzLmNsaWVudD8uc3RhdHVzKCkgPz8gbnVsbCxcbiAgICAgIHJlY2VudExvZ0xpbmVzOiB0aGlzLnN5bmNMb2cucmVjZW50TGluZXMoKSxcbiAgICB9KTtcbiAgICBjb25zdCBjb3BpZWQgPSBhd2FpdCBjb3B5VG9DbGlwYm9hcmQoYnVuZGxlKTtcbiAgICBpZiAoY29waWVkKSB7XG4gICAgICBuZXcgTm90aWNlKCdWYXVsdFN5bmM6IGRpYWdub3N0aWNzIGNvcGllZCB0byB0aGUgY2xpcGJvYXJkLicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zb2xlLmluZm8oJ1t2c2FdIGRpYWdub3N0aWNzIChjbGlwYm9hcmQgdW5hdmFpbGFibGUpOlxcbicgKyBidW5kbGUpO1xuICAgIG5ldyBOb3RpY2UoJ1ZhdWx0U3luYzogY2xpcGJvYXJkIHVuYXZhaWxhYmxlIFx1MjAxNCBkaWFnbm9zdGljcyB3cml0dGVuIHRvIHRoZSBkZXZlbG9wZXIgY29uc29sZS4nLCAxMDAwMCk7XG4gIH1cblxuICAvKiogVGhlIHBsYXRmb3JtIGxpbmUgZm9yIHRoZSBBYm91dC9kaWFnbm9zdGljcyByZWFkb3V0cy4gKi9cbiAgcGxhdGZvcm1TdW1tYXJ5KCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHBsYXRmb3JtU3VtbWFyeSgpO1xuICB9XG5cbiAgYXN5bmMgdW5saW5rKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuc3RvcFN5bmMoKTtcbiAgICB0aGlzLnBhdXNlZCA9IGZhbHNlO1xuICAgIC8vIENsZWFyIGxvY2FsIHN5bmMgc3RhdGUgKGRldmljZSBtYXJrZXIgKyBpbmRleCkgc28gYSBmdXR1cmUgY2xpZW50IFx1MjAxNFxuICAgIC8vIHRoaXMgcGx1Z2luIGFmdGVyIGEgcmUtcGFpciwgdGhlIGRhZW1vbiwgdGhlIENMSSBcdTIwMTQgc3RhcnRzIGNsZWFuXG4gICAgLy8gKEZSLTQ0OiBzdGFsZSBzdGF0ZSB3b3VsZCBtYWtlIGl0IHJlZnVzZSBvciBtaXMtc3luYykuXG4gICAgY29uc3Qgc3RvcmFnZSA9IG5ldyBPYnNpZGlhblN0b3JhZ2VBZGFwdGVyKHsgYWRhcHRlcjogdGhpcy5hcHAudmF1bHQuYWRhcHRlciB9KTtcbiAgICBhd2FpdCBzdG9yYWdlLmRlbGV0ZUZpbGUoREVWSUNFX01BUktFUl9WQVVMVF9QQVRIKTtcbiAgICBhd2FpdCBzdG9yYWdlLmRlbGV0ZUZpbGUoTE9DQUxfSU5ERVhfVkFVTFRfUEFUSCk7XG4gICAgdGhpcy5kYXRhID0ge1xuICAgICAgLi4uZGVmYXVsdFBsdWdpbkRhdGEoKSxcbiAgICAgIGRldmljZU5hbWU6IHRoaXMuZGF0YS5kZXZpY2VOYW1lLFxuICAgICAgc2V0dGluZ3M6IHRoaXMuZGF0YS5zZXR0aW5ncyxcbiAgICB9O1xuICAgIGF3YWl0IHRoaXMuc2F2ZVBsdWdpbkRhdGEoKTtcbiAgICBuZXcgTm90aWNlKFxuICAgICAgJ1ZhdWx0U3luYzogdW5saW5rZWQuIFJldm9rZSB0aGlzIGRldmljZSBmcm9tIHRoZSB3b3JrZXIgZGFzaGJvYXJkIGlmIHlvdSBhcmUgZG9uZSB3aXRoIGl0LicsXG4gICAgKTtcbiAgfVxuXG4gIC8vIC0tLSBzdXBlcnZpc2lvbiAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIHByaXZhdGUgb25UaWNrKCk6IHZvaWQge1xuICAgIGNvbnN0IGNsaWVudCA9IHRoaXMuY2xpZW50O1xuICAgIGlmIChjbGllbnQgPT09IG51bGwpIHJldHVybjtcbiAgICBjb25zdCBzdGF0dXMgPSBjbGllbnQuc3RhdHVzKCk7XG4gICAgdGhpcy5zdGF0dXNCYXI/LnVwZGF0ZShcbiAgICAgIHN0YXR1cyxcbiAgICAgIHtcbiAgICAgICAgdXJsOiB0aGlzLmRhdGEudXJsLFxuICAgICAgICBkZXZpY2VOYW1lOiB0aGlzLnJlc29sdmVEZXZpY2VOYW1lKCksXG4gICAgICAgIG5vdGU6IHRoaXMuc3RhdHVzTm90ZSxcbiAgICAgICAgcGF1c2VkOiB0aGlzLnBhdXNlZCxcbiAgICAgICAgbW9kZTogdGhpcy5kYXRhLnNldHRpbmdzLnN0YXR1c0Jhck1vZGUsXG4gICAgICB9LFxuICAgICAgdGhpcy5ub3coKSxcbiAgICApO1xuICAgIGlmICh0aGlzLnBhdXNlZCB8fCB0aGlzLmF1dGhGYWlsZWQpIHJldHVybjsgLy8gbm8gcmVjb25uZWN0IHdoaWxlIHBhdXNlZCAvIHRva2VuIHJlamVjdGVkXG4gICAgY29uc3QgZGVjaXNpb24gPSB0aGlzLnN1cGVydmlzb3IuY29uc2lkZXIoc3RhdHVzLnN0YXRlKTtcbiAgICBpZiAoZGVjaXNpb24uYWN0aW9uID09PSAnd2FpdCcpIHJldHVybjtcbiAgICB0aGlzLnN1cGVydmlzb3IuYWNrbm93bGVkZ2VkKCk7XG4gICAgdGhpcy5zY2hlZHVsZVJlY29ubmVjdChkZWNpc2lvbi5kZWxheU1zKTtcbiAgfVxuXG4gIHByaXZhdGUgc2NoZWR1bGVSZWNvbm5lY3QoZGVsYXlNczogbnVtYmVyKTogdm9pZCB7XG4gICAgaWYgKHRoaXMucmVjb25uZWN0VGltZXIgIT09IG51bGwpIHJldHVybjsgLy8gb25lIGluIGZsaWdodCwgYWx3YXlzXG4gICAgdGhpcy5yZWNvbm5lY3RUaW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdGhpcy5yZWNvbm5lY3RUaW1lciA9IG51bGw7XG4gICAgICBjb25zdCBjbGllbnQgPSB0aGlzLmNsaWVudDtcbiAgICAgIGlmIChjbGllbnQgPT09IG51bGwpIHtcbiAgICAgICAgdGhpcy5zdXBlcnZpc29yLnNldHRsZWQoKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgY2xpZW50XG4gICAgICAgIC5yZWNvbm5lY3QoKVxuICAgICAgICAudGhlbihcbiAgICAgICAgICAoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnN1cGVydmlzb3Iuc2V0dGxlZCgpO1xuICAgICAgICAgIH0sXG4gICAgICAgICAgKGVycm9yOiB1bmtub3duKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnN1cGVydmlzb3Iuc2V0dGxlZCgpO1xuICAgICAgICAgICAgdGhpcy5oYW5kbGVTeW5jRXJyb3IoZXJyb3IsICdyZWNvbm5lY3QgZmFpbGVkJyk7XG4gICAgICAgICAgfSxcbiAgICAgICAgKVxuICAgICAgICAuY2F0Y2goKCkgPT4ge30pOyAvLyBoYW5kbGVTeW5jRXJyb3IgbmV2ZXIgdGhyb3dzOyBiZWx0IGFuZCBicmFjZXNcbiAgICB9LCBkZWxheU1zKTtcbiAgfVxuXG4gIC8qKiBEaXN0aW5ndWlzaCBmYXRhbCBhdXRoIGZhaWx1cmVzIGZyb20gdHJhbnNpZW50IG5ldHdvcmsgdHJvdWJsZS4gKi9cbiAgcHJpdmF0ZSBoYW5kbGVTeW5jRXJyb3IoZXJyb3I6IHVua25vd24sIGNvbnRleHQ6IHN0cmluZyk6IHZvaWQge1xuICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIFJldm9rZWRFcnJvciB8fCBlcnJvciBpbnN0YW5jZW9mIFVuYXV0aG9yaXplZEVycm9yKSB7XG4gICAgICB0aGlzLmF1dGhGYWlsZWQgPSB0cnVlO1xuICAgICAgdGhpcy5zdGF0dXNOb3RlID0gJ0RldmljZSB0b2tlbiByZWplY3RlZCBcdTIwMTQgdW5saW5rIGFuZCByZS1wYWlyIHdpdGggYSBmcmVzaCBjb2RlLic7XG4gICAgICB0aGlzLnN5bmNMb2cuZXJyb3IoY29udGV4dCwgZXJyb3IpO1xuICAgICAgbmV3IE5vdGljZShcbiAgICAgICAgJ1ZhdWx0U3luYzogdGhlIHdvcmtlciByZWplY3RlZCB0aGlzIGRldmljZVxcdTIwMTlzIHRva2VuIChyZXZva2VkPykuIFVubGluayBhbmQgcmUtcGFpciBmcm9tIHNldHRpbmdzLicsXG4gICAgICAgIDEwMDAwLFxuICAgICAgKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5zeW5jTG9nLndhcm4oY29udGV4dCwgZXJyb3IpOyAvLyBvZmZsaW5lL3Byb3RvY29sOiBiYWNrb2ZmIGtlZXBzIHJldHJ5aW5nXG4gIH1cblxuICAvKiogRlItNDQ6IHdhcm4gd2hlbiB0aGUgdmF1bHQncyBzdGF0ZSBkaXIgYmVsb25ncyB0byBhbm90aGVyIGNsaWVudC4gKi9cbiAgcHJpdmF0ZSBhc3luYyB3YXJuSWZGb3JlaWduU3RhdGVEaXIoc3RvcmFnZTogT2JzaWRpYW5TdG9yYWdlQWRhcHRlcik6IFByb21pc2U8dm9pZD4ge1xuICAgIGxldCBtYXJrZXI6IHsgZGV2aWNlSWQ/OiB1bmtub3duOyBkZXZpY2VOYW1lPzogdW5rbm93bjsgdXJsPzogdW5rbm93biB9O1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBieXRlcyA9IGF3YWl0IHN0b3JhZ2UucmVhZEZpbGUoREVWSUNFX01BUktFUl9WQVVMVF9QQVRIKTtcbiAgICAgIG1hcmtlciA9IEpTT04ucGFyc2UobmV3IFRleHREZWNvZGVyKCkuZGVjb2RlKGJ5dGVzKSkgYXMgdHlwZW9mIG1hcmtlcjtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybjsgLy8gbm8gbWFya2VyIChvciB1bnJlYWRhYmxlKSBcdTIwMTQgbm90aGluZyB0byB3YXJuIGFib3V0XG4gICAgfVxuICAgIGlmIChcbiAgICAgIHR5cGVvZiBtYXJrZXIuZGV2aWNlSWQgPT09ICdzdHJpbmcnICYmXG4gICAgICBtYXJrZXIuZGV2aWNlSWQgIT09IHRoaXMuZGF0YS5kZXZpY2VJZFxuICAgICkge1xuICAgICAgY29uc3QgbmFtZSA9IHR5cGVvZiBtYXJrZXIuZGV2aWNlTmFtZSA9PT0gJ3N0cmluZycgPyBtYXJrZXIuZGV2aWNlTmFtZSA6IG1hcmtlci5kZXZpY2VJZDtcbiAgICAgIGNvbnN0IHdoZXJlID0gdHlwZW9mIG1hcmtlci51cmwgPT09ICdzdHJpbmcnID8gbWFya2VyLnVybCA6ICdhIHdvcmtlcic7XG4gICAgICBuZXcgTm90aWNlKFxuICAgICAgICBgVmF1bHRTeW5jOiB0aGlzIHZhdWx0IGFscmVhZHkgaGFzIHN5bmMgc3RhdGUgZm9yIGRldmljZSBcIiR7bmFtZX1cIiAobGlua2VkIHRvICR7d2hlcmV9KS4gYCArXG4gICAgICAgICAgJ09uZSBzeW5jIGNsaWVudCBwZXIgbWFjaGluZSBwZXIgdmF1bHQgXHUyMDE0IHJ1bm5pbmcgdHdvIGRvdWJsZS1jb21taXRzIGV2ZXJ5IGNoYW5nZS4gJyArXG4gICAgICAgICAgJ1VubGluayB0aGUgb3RoZXIgY2xpZW50IChvciBjbGVhciAudmF1bHRzeW5jZm9yYWdlbnRzLykgaWYgdGhpcyBpcyB1bmV4cGVjdGVkLicsXG4gICAgICAgIDE1MDAwLFxuICAgICAgKTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplV29ya2VyVXJsU2FmZShpbnB1dDogc3RyaW5nKTogc3RyaW5nIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gbm9ybWFsaXplV29ya2VyVXJsKGlucHV0KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGlucHV0O1xuICB9XG59XG4iLCAiLyoqXG4gKiBWYXVsdCBwYXRoIHV0aWxpdGllcy5cbiAqXG4gKiBWYXVsdC1pbnRlcm5hbCBwYXRocyBhcmUgUE9TSVgtbm9ybWFsaXplZCBzdHJpbmdzIHJlbGF0aXZlIHRvIHRoZSB2YXVsdCByb290OlxuICogICAtIGFsd2F5cyBzdGFydCB3aXRoIGAvYCAoYC9hL2IubWRgKTsgdGhlIHZhdWx0IHJvb3QgaXRzZWxmIGlzIGAvYFxuICogICAtIHNlZ21lbnRzIHNlcGFyYXRlZCBieSBgL2A7IG5vIHRyYWlsaW5nIHNsYXNoLCBubyBgLmAvYC4uYCBzZWdtZW50cyxcbiAqICAgICBubyBkdXBsaWNhdGUgc2xhc2hlc1xuICogICAtIG5ldmVyIGVzY2FwZSB0aGUgcm9vdDogYW55IGAuLmAgdGhhdCB3b3VsZCBwb3AgYWJvdmUgYC9gIGlzIHJlamVjdGVkXG4gKlxuICogQmFja3NsYXNoZXMgYXJlIGNvbnZlcnRlZCB0byBgL2AgKFdpbmRvd3MgY2FsbGVycyByb3V0aW5lbHkgaGFuZCB1c1xuICogYGRpclxcZmlsZS5tZGApLCBidXQgYWJzb2x1dGUgV2luZG93cyBwYXRocyAoZHJpdmUgbGV0dGVycyBsaWtlIGBDOi9gLCBVTkNcbiAqIGBcXFxcc2VydmVyXFxzaGFyZWApIGFyZSByZWplY3RlZCBcdTIwMTQgYSB2YXVsdCBwYXRoIGlzIG5ldmVyIGFic29sdXRlIGluIHRoZSBob3N0XG4gKiBmaWxlc3lzdGVtIHNlbnNlLlxuICovXG5cbi8qKiBBIHZhdWx0LWludGVybmFsLCBQT1NJWC1ub3JtYWxpemVkIHBhdGggc3RyaW5nIChlLmcuIGAvbm90ZXMvdG9kby5tZGApLiAqL1xuZXhwb3J0IHR5cGUgVmF1bHRQYXRoID0gc3RyaW5nO1xuXG4vKiogVGhyb3duIHdoZW4gYSBwYXRoIGNhbm5vdCBiZSBpbnRlcnByZXRlZCBhcyBhIHZhdWx0LWludGVybmFsIHBhdGguICovXG5leHBvcnQgY2xhc3MgSW52YWxpZFZhdWx0UGF0aEVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBjb25zdHJ1Y3RvcihtZXNzYWdlOiBzdHJpbmcpIHtcbiAgICBzdXBlcihtZXNzYWdlKTtcbiAgICB0aGlzLm5hbWUgPSAnSW52YWxpZFZhdWx0UGF0aEVycm9yJztcbiAgfVxufVxuXG4vKipcbiAqIE5vcm1hbGl6ZSBhIHVzZXItIG9yIHBsYXRmb3JtLXN1cHBsaWVkIHBhdGggaW50byBjYW5vbmljYWwgdmF1bHQgZm9ybS5cbiAqXG4gKiBBY2NlcHRlZDogYGEvYi5tZGAgKHJvb3QtcmVsYXRpdmUgd2l0aG91dCBsZWFkaW5nIHNsYXNoKSwgYC9hL2IubWRgLFxuICogYGFcXGIubWRgIChiYWNrc2xhc2ggY29udmVyc2lvbiksIGBhLy4vYi5tZGAsIGBhL2IvLi4vYy5tZGAgKGludGVyaW9yIGAuLmBcbiAqIHJlc29sdmVzKSwgZHVwbGljYXRlIHNsYXNoZXMsIHRyYWlsaW5nIHNsYXNoZXMuXG4gKlxuICogUmVqZWN0ZWQ6IGAuLmAgZXNjYXBpbmcgdGhlIHJvb3QgKGAvLi4vYWAsIGAvYS8uLi8uLmApLCBhYnNvbHV0ZSBXaW5kb3dzXG4gKiBkcml2ZSBwYXRocyAoYEM6L3ZhdWx0L2EubWRgLCBgQzpcXHZhdWx0XFxhLm1kYCksIFVOQyBwYXRocyAoYFxcXFxzcnZcXHNoYXJlYCksXG4gKiBsZWFkaW5nIGAvL2AsIE5VTCBieXRlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZVZhdWx0UGF0aChpbnB1dDogc3RyaW5nKTogVmF1bHRQYXRoIHtcbiAgaWYgKHR5cGVvZiBpbnB1dCAhPT0gJ3N0cmluZycpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZFZhdWx0UGF0aEVycm9yKGBWYXVsdCBwYXRoIG11c3QgYmUgYSBzdHJpbmcsIGdvdCAke3R5cGVvZiBpbnB1dH1gKTtcbiAgfVxuICBpZiAoaW5wdXQuaW5jbHVkZXMoJ1xcMCcpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRWYXVsdFBhdGhFcnJvcihgVmF1bHQgcGF0aCBjb250YWlucyBOVUwgYnl0ZTogJHtKU09OLnN0cmluZ2lmeShpbnB1dCl9YCk7XG4gIH1cbiAgaWYgKC9eW2EtekEtWl06Ly50ZXN0KGlucHV0KSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkVmF1bHRQYXRoRXJyb3IoXG4gICAgICBgVmF1bHQgcGF0aCBtdXN0IG5vdCBiZSBhbiBhYnNvbHV0ZSBob3N0IHBhdGggKGRyaXZlIGxldHRlcik6ICR7SlNPTi5zdHJpbmdpZnkoaW5wdXQpfWAsXG4gICAgKTtcbiAgfVxuICBpZiAoaW5wdXQuc3RhcnRzV2l0aCgnXFxcXFxcXFwnKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkVmF1bHRQYXRoRXJyb3IoXG4gICAgICBgVmF1bHQgcGF0aCBtdXN0IG5vdCBiZSBhIFVOQyBwYXRoOiAke0pTT04uc3RyaW5naWZ5KGlucHV0KX1gLFxuICAgICk7XG4gIH1cblxuICBjb25zdCBjb252ZXJ0ZWQgPSBpbnB1dC5yZXBsYWNlKC9cXFxcL2csICcvJyk7XG4gIGlmIChjb252ZXJ0ZWQuc3RhcnRzV2l0aCgnLy8nKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkVmF1bHRQYXRoRXJyb3IoXG4gICAgICBgVmF1bHQgcGF0aCBtdXN0IG5vdCBzdGFydCB3aXRoIFwiLy9cIiAoVU5DIG9yIHByb3RvY29sLXN0eWxlIHBhdGgpOiAke0pTT04uc3RyaW5naWZ5KGlucHV0KX1gLFxuICAgICk7XG4gIH1cblxuICBjb25zdCBzZWdtZW50czogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChjb25zdCBzZWdtZW50IG9mIGNvbnZlcnRlZC5zcGxpdCgnLycpKSB7XG4gICAgaWYgKHNlZ21lbnQgPT09ICcnIHx8IHNlZ21lbnQgPT09ICcuJykgY29udGludWU7XG4gICAgaWYgKHNlZ21lbnQgPT09ICcuLicpIHtcbiAgICAgIGlmIChzZWdtZW50cy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IEludmFsaWRWYXVsdFBhdGhFcnJvcihcbiAgICAgICAgICBgVmF1bHQgcGF0aCBlc2NhcGVzIHRoZSB2YXVsdCByb290OiAke0pTT04uc3RyaW5naWZ5KGlucHV0KX1gLFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgc2VnbWVudHMucG9wKCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgc2VnbWVudHMucHVzaChzZWdtZW50KTtcbiAgfVxuICByZXR1cm4gc2VnbWVudHMubGVuZ3RoID09PSAwID8gJy8nIDogYC8ke3NlZ21lbnRzLmpvaW4oJy8nKX1gO1xufVxuXG4vKipcbiAqIEpvaW4gYSBiYXNlIHZhdWx0IHBhdGggd2l0aCBvbmUgb3IgbW9yZSByZWxhdGl2ZSBwYXRoIHBhcnRzLlxuICpcbiAqIEVhY2ggcGFydCBtdXN0IGJlIHJlbGF0aXZlIChubyBsZWFkaW5nIGAvYCBhZnRlciBiYWNrc2xhc2ggY29udmVyc2lvbikgYW5kXG4gKiBpcyBhcHBlbmRlZCB0byB0aGUgYmFzZSBiZWZvcmUgbm9ybWFsaXphdGlvbjsgYC4uYCBpbnNpZGUgcGFydHMgbWF5IG5vdFxuICogZXNjYXBlIHRoZSByZXN1bHRpbmcgcm9vdC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGpvaW5QYXRoKGJhc2U6IHN0cmluZywgLi4ucGFydHM6IHJlYWRvbmx5IHN0cmluZ1tdKTogVmF1bHRQYXRoIHtcbiAgbGV0IGNvbWJpbmVkID0gbm9ybWFsaXplVmF1bHRQYXRoKGJhc2UpO1xuICBmb3IgKGNvbnN0IHBhcnQgb2YgcGFydHMpIHtcbiAgICBjb25zdCBjb252ZXJ0ZWQgPSBwYXJ0LnJlcGxhY2UoL1xcXFwvZywgJy8nKTtcbiAgICBpZiAoY29udmVydGVkLnN0YXJ0c1dpdGgoJy8nKSkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRWYXVsdFBhdGhFcnJvcihcbiAgICAgICAgYGpvaW5QYXRoIHBhcnRzIG11c3QgYmUgcmVsYXRpdmUsIGdvdCAke0pTT04uc3RyaW5naWZ5KHBhcnQpfWAsXG4gICAgICApO1xuICAgIH1cbiAgICBjb21iaW5lZCA9IGAke2NvbWJpbmVkID09PSAnLycgPyAnJyA6IGNvbWJpbmVkfS8ke2NvbnZlcnRlZH1gO1xuICB9XG4gIHJldHVybiBub3JtYWxpemVWYXVsdFBhdGgoY29tYmluZWQpO1xufVxuXG4vKipcbiAqIFBhcmVudCBkaXJlY3Rvcnkgb2YgYSB2YXVsdCBwYXRoLiBUaGUgcGFyZW50IG9mIGAvYCBpcyBgL2AgKHRoZSByb290IGhhcyBub1xuICogcGFyZW50IGFib3ZlIGl0KTsgd2FsayBgd2hpbGUgKHAgIT09IHBhcmVudFBhdGgocCkpYCBzdHlsZSBsb29wcyB0ZXJtaW5hdGUuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJlbnRQYXRoKHBhdGg6IHN0cmluZyk6IFZhdWx0UGF0aCB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVWYXVsdFBhdGgocGF0aCk7XG4gIGlmIChub3JtYWxpemVkID09PSAnLycpIHJldHVybiAnLyc7XG4gIGNvbnN0IGxhc3RTbGFzaCA9IG5vcm1hbGl6ZWQubGFzdEluZGV4T2YoJy8nKTtcbiAgcmV0dXJuIGxhc3RTbGFzaCA9PT0gMCA/ICcvJyA6IG5vcm1hbGl6ZWQuc2xpY2UoMCwgbGFzdFNsYXNoKTtcbn1cblxuLyoqXG4gKiBGaW5hbCBwYXRoIHNlZ21lbnQuIGBiYXNlbmFtZSgnL2EvYi5tZCcpYCBcdTIxOTIgYGIubWRgOyBgYmFzZW5hbWUoJy8nKWAgXHUyMTkyIGAnJ2AuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBiYXNlbmFtZShwYXRoOiBzdHJpbmcpOiBWYXVsdFBhdGgge1xuICBjb25zdCBub3JtYWxpemVkID0gbm9ybWFsaXplVmF1bHRQYXRoKHBhdGgpO1xuICBpZiAobm9ybWFsaXplZCA9PT0gJy8nKSByZXR1cm4gJyc7XG4gIHJldHVybiBub3JtYWxpemVkLnNsaWNlKG5vcm1hbGl6ZWQubGFzdEluZGV4T2YoJy8nKSArIDEpO1xufVxuXG4vKipcbiAqIFdoZXRoZXIgYGNoaWxkYCBuYW1lcyBzb21ldGhpbmcgYXQgbGVhc3Qgb25lIGxldmVsIEJFTE9XIGBhbmNlc3RvcmBcbiAqIChib3RoIG5vcm1hbGl6ZWQgdmF1bHQgcGF0aHMpLiBUaGUgcm9vdCBpcyBhbiBhbmNlc3RvciBvZiBldmVyeXRoaW5nXG4gKiBleGNlcHQgaXRzZWxmOyBhIHBhdGggaXMgbmV2ZXIgc3RyaWN0bHkgYmVuZWF0aCBpdHNlbGYuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc1N0cmljdGx5QmVuZWF0aChjaGlsZDogc3RyaW5nLCBhbmNlc3Rvcjogc3RyaW5nKTogYm9vbGVhbiB7XG4gIGlmIChhbmNlc3RvciA9PT0gJy8nKSByZXR1cm4gY2hpbGQgIT09ICcvJztcbiAgcmV0dXJuIGNoaWxkLmxlbmd0aCA+IGFuY2VzdG9yLmxlbmd0aCAmJiBjaGlsZC5zdGFydHNXaXRoKGAke2FuY2VzdG9yfS9gKTtcbn1cbiIsICIvKipcbiAqIExvZ2ljYWwgY2xvY2sgb3BlcmF0aW9ucyAoQVJDSElURUNUVVJFLm1kIFx1MDBBNzQpLlxuICpcbiAqIENsb2NrcyBhcmUgcGVyLWZpbGUgbW9ub3RvbmljIGNvdW50ZXJzIG93bmVkIGJ5IHRoZSBzeW5jIGF1dGhvcml0eSAodGhlXG4gKiBEdXJhYmxlIE9iamVjdCkuIEEgY2xvY2sgcGFpcnMgdGhlIGNvdW50ZXIgd2l0aCB0aGUgaWQgb2YgdGhlIGRldmljZSB0aGF0XG4gKiBwcm9kdWNlZCBpdC4gT3JkZXJpbmcgaXMgZnVsbHkgZGV0ZXJtaW5pc3RpYyBvbiBldmVyeSBjbGllbnQ6XG4gKlxuICogICAxLiBoaWdoZXIgYGNvdW50ZXJgIHdpbnM7XG4gKiAgIDIuIGV4YWN0IGNvdW50ZXIgdGllIFx1MjE5MiBsZXhpY29ncmFwaGljYWxseSBncmVhdGVyIGBkZXZpY2VJZGAgd2luc1xuICogICAgICAocGxhaW4gSlMgc3RyaW5nIGNvbXBhcmlzb24sIGkuZS4gYnkgVVRGLTE2IGNvZGUgdW5pdHMpO1xuICogICAzLiBpZGVudGljYWwgY291bnRlciAqYW5kKiBpZGVudGljYWwgZGV2aWNlSWQgXHUyMTkyIHRoZSBjbG9ja3MgYXJlIGVxdWFsLlxuICpcbiAqIFdhbGwtY2xvY2sgdGltZSBuZXZlciBwYXJ0aWNpcGF0ZXMgaW4gb3JkZXJpbmcgKGRpc3BsYXktb25seSBwZXIgXHUwMEE3NCkuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBMb2dpY2FsQ2xvY2sgfSBmcm9tICcuL3R5cGVzLmpzJztcblxuLyoqIFJlc3VsdCBvZiBgY29tcGFyZUNsb2Nrc2A6IHNpZ24gb2YgYGFgIHZzIGBiYCAocG9zaXRpdmUgXHUyMUQyIGBhYCB3aW5zKS4gKi9cbmV4cG9ydCB0eXBlIENsb2NrQ29tcGFyaXNvbiA9IC0xIHwgMCB8IDE7XG5cbi8qKlxuICogQ29tcGFyZSB0d28gbG9naWNhbCBjbG9ja3MuXG4gKlxuICogUmV0dXJucyBgMWAgd2hlbiBgYWAgd2lucywgYC0xYCB3aGVuIGBiYCB3aW5zLCBgMGAgd2hlbiB0aGUgY2xvY2tzIGFyZVxuICogaWRlbnRpY2FsIChzYW1lIGNvdW50ZXIgKmFuZCogc2FtZSBkZXZpY2VJZCBcdTIwMTQgaW4gcHJhY3RpY2Ugb25seSB3aGVuXG4gKiBjb21wYXJpbmcgYSBjbG9jayB3aXRoIGl0c2VsZikuIENhbGxlcnMgdGhhdCBtdXN0IHBpY2sgYSBzaWRlIG9uIGAwYFxuICogc2hvdWxkIGRvIHNvIGV4cGxpY2l0bHkgYW5kIGRvY3VtZW50IHRoZSBjaG9pY2UuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb21wYXJlQ2xvY2tzKGE6IExvZ2ljYWxDbG9jaywgYjogTG9naWNhbENsb2NrKTogQ2xvY2tDb21wYXJpc29uIHtcbiAgaWYgKGEuY291bnRlciAhPT0gYi5jb3VudGVyKSByZXR1cm4gYS5jb3VudGVyID4gYi5jb3VudGVyID8gMSA6IC0xO1xuICBpZiAoYS5kZXZpY2VJZCAhPT0gYi5kZXZpY2VJZCkgcmV0dXJuIGEuZGV2aWNlSWQgPiBiLmRldmljZUlkID8gMSA6IC0xO1xuICByZXR1cm4gMDtcbn1cblxuLyoqXG4gKiBUaGUgY2xvY2sgYSBjb21taXQgZnJvbSBgZGV2aWNlSWRgIHdvdWxkIHJlY2VpdmUgd2hlbiBidWlsZGluZyBvbiBgcGFyZW50YFxuICogKG9yIG9uIG5vdGhpbmcsIHdoZW4gYHBhcmVudGAgaXMgYWJzZW50KTogcGFyZW50J3MgY291bnRlciArIDEuXG4gKlxuICogVGhpcyBpcyB0aGUgKnRlbnRhdGl2ZSogY2xvY2sgdXNlZCBieSBjbGllbnQtc2lkZSBjb25mbGljdCBwcmVkaWN0aW9uXG4gKiAoYHJlc29sdmUudHNgKTogdGhlIERPIGFzc2lnbnMgcmVhbCBjb3VudGVycyB3aXRoIHRoZSBzYW1lIHJ1bGUsIHNvIHRoZVxuICogcHJlZGljdGlvbiBtYXRjaGVzIHRoZSBzZXJ2ZXIncyBhcmJpdHJhdGlvbiBhcyBsb25nIGFzIGJvdGggc2lkZXMgYnVpbGQgb25cbiAqIHRoZSBzYW1lIHBhcmVudC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5leHRDbG9jayhcbiAgcGFyZW50OiBMb2dpY2FsQ2xvY2sgfCBudWxsIHwgdW5kZWZpbmVkLFxuICBkZXZpY2VJZDogc3RyaW5nLFxuKTogTG9naWNhbENsb2NrIHtcbiAgcmV0dXJuIHsgY291bnRlcjogKHBhcmVudD8uY291bnRlciA/PyAwKSArIDEsIGRldmljZUlkIH07XG59XG4iLCAiLyoqXG4gKiBDb250ZW50IGhhc2hpbmcgYW5kIGNvbXByZXNzaW9uIFx1MjAxNCBXZWIgQVBJcyBvbmx5LlxuICpcbiAqIGBjcnlwdG8uc3VidGxlYCBpcyBhdmFpbGFibGUgaW4gTm9kZSAxOCssIENsb3VkZmxhcmUgV29ya2VycyxcbiAqIGFuZCBPYnNpZGlhbiAoRWxlY3Ryb24pLiBgQ29tcHJlc3Npb25TdHJlYW1gIGxpa2V3aXNlLiBObyBOb2RlIGltcG9ydHM6XG4gKiB0aGlzIG1vZHVsZSBtdXN0IHJ1biB1bmNoYW5nZWQgaW4gZXZlcnkgY2xpZW50IChBUkNISVRFQ1RVUkUubWQgXHUwMEE3OCkuXG4gKi9cblxuLyoqIEhhc2ggb2YgYGJ5dGVzYCBhcyBsb3dlcmNhc2Ugc2hhMjU2IGhleC4gTWF0Y2hlcyBSMiBibG9iIGtleXMgYGJsb2JzL3tzaGEyNTZ9YC4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzaGEyNTZIZXgoYnl0ZXM6IFVpbnQ4QXJyYXkgfCBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCBkYXRhID0gdHlwZW9mIGJ5dGVzID09PSAnc3RyaW5nJyA/IG5ldyBUZXh0RW5jb2RlcigpLmVuY29kZShieXRlcykgOiBieXRlcztcbiAgLy8gYGNyeXB0b2AgKG5vdCBgZ2xvYmFsVGhpcy5jcnlwdG9gKTogdGhlIGJhcmUgaWRlbnRpZmllciByZXNvbHZlcyBpbiBldmVyeVxuICAvLyB0YXJnZXQncyB0eXBlcyAoRE9NIGxpYiwgQ2xvdWRmbGFyZSB3b3JrZXJkIHR5cGVzLCBOb2RlKSBcdTIwMTQgdGhlIHF1YWxpZmllZFxuICAvLyBmb3JtIGRvZXMgbm90LCBiZWNhdXNlIHdvcmtlcnMgdHlwZXMgZGVjbGFyZSBpdCBgY29uc3RgLCB3aGljaCBuZXZlclxuICAvLyBtZXJnZXMgaW50byBgdHlwZW9mIGdsb2JhbFRoaXNgLlxuICBjb25zdCBkaWdlc3QgPSBhd2FpdCBjcnlwdG8uc3VidGxlLmRpZ2VzdCgnU0hBLTI1NicsIGRhdGEgYXMgQnVmZmVyU291cmNlKTtcbiAgcmV0dXJuIHRvSGV4KG5ldyBVaW50OEFycmF5KGRpZ2VzdCkpO1xufVxuXG4vKipcbiAqIFdoZXRoZXIgZ3ppcCBzdHJlYW1zIGFyZSBhdmFpbGFibGUgaW4gdGhpcyBydW50aW1lLiBPbGRlciBPYnNpZGlhbiBtb2JpbGVcbiAqIHdlYnZpZXdzIG1heSBsYWNrIGBDb21wcmVzc2lvblN0cmVhbWA7IGNhbGxlcnMgZmFsbCBiYWNrIHRvIGlkZW50aXR5LlxuICovXG5leHBvcnQgZnVuY3Rpb24gc3VwcG9ydHNDb21wcmVzc2lvbigpOiBib29sZWFuIHtcbiAgcmV0dXJuIChcbiAgICB0eXBlb2YgQ29tcHJlc3Npb25TdHJlYW0gIT09ICd1bmRlZmluZWQnICYmXG4gICAgdHlwZW9mIERlY29tcHJlc3Npb25TdHJlYW0gIT09ICd1bmRlZmluZWQnXG4gICk7XG59XG5cbi8qKlxuICogR3ppcCBgZGF0YWAuIEZhbGxzIGJhY2sgdG8gaWRlbnRpdHkgKHJldHVybnMgaW5wdXQgdW5jaGFuZ2VkKSB3aGVuXG4gKiBgQ29tcHJlc3Npb25TdHJlYW1gIGlzIHVuYXZhaWxhYmxlIFx1MjAxNCBjYWxsIGBzdXBwb3J0c0NvbXByZXNzaW9uKClgIGZpcnN0IGlmXG4gKiB5b3UgbXVzdCBrbm93IHdoaWNoIGhhcHBlbmVkLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY29tcHJlc3MoZGF0YTogVWludDhBcnJheSk6IFByb21pc2U8VWludDhBcnJheT4ge1xuICBpZiAoIXN1cHBvcnRzQ29tcHJlc3Npb24oKSkgcmV0dXJuIGRhdGE7XG4gIC8vIGBhcyBCdWZmZXJTb3VyY2VgIChub3QgYGFzIEJsb2JQYXJ0YCk6IHRoZSBuYW1lIGBCdWZmZXJTb3VyY2VgIHJlc29sdmVzIGluXG4gIC8vIGJvdGggRE9NIGxpYiBhbmQgd29ya2VyZCBydW50aW1lIHR5cGVzLCBhbmQgaXMgYSB2YWxpZCBCbG9iUGFydCBpbiBlYWNoLlxuICBjb25zdCBzdHJlYW0gPSBuZXcgQmxvYihbZGF0YSBhcyBCdWZmZXJTb3VyY2VdKVxuICAgIC5zdHJlYW0oKVxuICAgIC5waXBlVGhyb3VnaChuZXcgQ29tcHJlc3Npb25TdHJlYW0oJ2d6aXAnKSk7XG4gIHJldHVybiBuZXcgVWludDhBcnJheShhd2FpdCBuZXcgUmVzcG9uc2Uoc3RyZWFtKS5hcnJheUJ1ZmZlcigpKTtcbn1cblxuLyoqXG4gKiBHdW56aXAgYGRhdGFgIHByb2R1Y2VkIGJ5IGBjb21wcmVzc2AgKGluIGEgcnVudGltZSB0aGF0IGhhZCBnemlwIHN1cHBvcnQpLlxuICogRmFsbHMgYmFjayB0byBpZGVudGl0eSB3aGVuIGBEZWNvbXByZXNzaW9uU3RyZWFtYCBpcyB1bmF2YWlsYWJsZS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGRlY29tcHJlc3MoZGF0YTogVWludDhBcnJheSk6IFByb21pc2U8VWludDhBcnJheT4ge1xuICBpZiAoIXN1cHBvcnRzQ29tcHJlc3Npb24oKSkgcmV0dXJuIGRhdGE7XG4gIGNvbnN0IHN0cmVhbSA9IG5ldyBCbG9iKFtkYXRhIGFzIEJ1ZmZlclNvdXJjZV0pXG4gICAgLnN0cmVhbSgpXG4gICAgLnBpcGVUaHJvdWdoKG5ldyBEZWNvbXByZXNzaW9uU3RyZWFtKCdnemlwJykpO1xuICByZXR1cm4gbmV3IFVpbnQ4QXJyYXkoYXdhaXQgbmV3IFJlc3BvbnNlKHN0cmVhbSkuYXJyYXlCdWZmZXIoKSk7XG59XG5cbmZ1bmN0aW9uIHRvSGV4KGJ5dGVzOiBVaW50OEFycmF5KTogc3RyaW5nIHtcbiAgbGV0IG91dCA9ICcnO1xuICBmb3IgKGNvbnN0IGJ5dGUgb2YgYnl0ZXMpIHtcbiAgICBvdXQgKz0gYnl0ZS50b1N0cmluZygxNikucGFkU3RhcnQoMiwgJzAnKTtcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuIiwgIi8qKlxuICogVHlwZWQgZXJyb3IgaGllcmFyY2h5IHNoYXJlZCBieSBhbGwgY2xpZW50cyAocGx1Z2luLCBkYWVtb24sIENMSSkgYW5kIHRoZVxuICogdGVzdC1zdWl0ZSBzZXJ2ZXIuIEVycm9ycyBjYXJyeSBhIHN0YWJsZSBtYWNoaW5lLXJlYWRhYmxlIGBjb2RlYC5cbiAqL1xuXG5leHBvcnQgdHlwZSBFcnJvckNvZGUgPVxuICB8ICdVTkNMQUlNRUQnXG4gIHwgJ1VOQVVUSE9SSVpFRCdcbiAgfCAnUkVWT0tFRCdcbiAgfCAnQ09ORkxJQ1QnXG4gIHwgJ1BST1RPQ09MJ1xuICB8ICdORVRXT1JLJztcblxuLyoqIEJhc2UgY2xhc3MgZm9yIGFsbCBWYXVsdFN5bmMgZXJyb3JzLiAqL1xuZXhwb3J0IGFic3RyYWN0IGNsYXNzIFZhdWx0U3luY0Vycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBhYnN0cmFjdCByZWFkb25seSBjb2RlOiBFcnJvckNvZGU7XG5cbiAgY29uc3RydWN0b3IobWVzc2FnZTogc3RyaW5nLCBvcHRpb25zPzogRXJyb3JPcHRpb25zKSB7XG4gICAgc3VwZXIobWVzc2FnZSwgb3B0aW9ucyk7XG4gICAgdGhpcy5uYW1lID0gbmV3LnRhcmdldC5uYW1lO1xuICB9XG59XG5cbi8qKiBXb3JrZXIgZXhpc3RzIGJ1dCBoYXMgbm90IGJlZW4gY2xhaW1lZCB5ZXQgKEhUVFAgNDIxIG9uIGV2ZXJ5IEFQSSBjYWxsKS4gKi9cbmV4cG9ydCBjbGFzcyBVbmNsYWltZWRFcnJvciBleHRlbmRzIFZhdWx0U3luY0Vycm9yIHtcbiAgcmVhZG9ubHkgY29kZSA9ICdVTkNMQUlNRUQnIGFzIGNvbnN0O1xufVxuXG4vKiogVG9rZW4gbWlzc2luZywgaW52YWxpZCwgb3Igbm90IGFjY2VwdGVkIChIVFRQIDQwMSBjbGFzcykuICovXG5leHBvcnQgY2xhc3MgVW5hdXRob3JpemVkRXJyb3IgZXh0ZW5kcyBWYXVsdFN5bmNFcnJvciB7XG4gIHJlYWRvbmx5IGNvZGUgPSAnVU5BVVRIT1JJWkVEJyBhcyBjb25zdDtcbn1cblxuLyoqIFRoZSBkZXZpY2UgdG9rZW4gd2FzIHJldm9rZWQ7IHRoZSBkZXZpY2UgbXVzdCBiZSByZS1wYWlyZWQuICovXG5leHBvcnQgY2xhc3MgUmV2b2tlZEVycm9yIGV4dGVuZHMgVmF1bHRTeW5jRXJyb3Ige1xuICByZWFkb25seSBjb2RlID0gJ1JFVk9LRUQnIGFzIGNvbnN0O1xufVxuXG4vKiogQSBjb21taXQgcmFjZWQgd2l0aCBhIGNvbmN1cnJlbnQgZWRpdDsgdGhlIHNlcnZlciBhcmJpdHJhdGVkIChzZWUgXHUwMEE3NCkuICovXG5leHBvcnQgY2xhc3MgQ29uZmxpY3RFcnJvciBleHRlbmRzIFZhdWx0U3luY0Vycm9yIHtcbiAgcmVhZG9ubHkgY29kZSA9ICdDT05GTElDVCcgYXMgY29uc3Q7XG59XG5cbi8qKiBBIHBlZXIgKG9yIGxvY2FsIGJ1ZykgdmlvbGF0ZWQgdGhlIHByb3RvY29sOiBiYWQgbWVzc2FnZSBzaGFwZSwgYmFkIHZlcnNpb24uICovXG5leHBvcnQgY2xhc3MgUHJvdG9jb2xFcnJvciBleHRlbmRzIFZhdWx0U3luY0Vycm9yIHtcbiAgcmVhZG9ubHkgY29kZSA9ICdQUk9UT0NPTCcgYXMgY29uc3Q7XG59XG5cbi8qKiBUcmFuc3BvcnQtbGV2ZWwgZmFpbHVyZTogc29ja2V0IGNsb3NlZCwgZmV0Y2ggcmVmdXNlZCwgdGltZW91dC4gUmV0cmlhYmxlLiAqL1xuZXhwb3J0IGNsYXNzIE5ldHdvcmtFcnJvciBleHRlbmRzIFZhdWx0U3luY0Vycm9yIHtcbiAgcmVhZG9ubHkgY29kZSA9ICdORVRXT1JLJyBhcyBjb25zdDtcbn1cbiIsICIvKipcbiAqIFRoZSBjbGllbnQncyBwZXJzaXN0ZWQgc3luYyBzdGF0ZSAoQVJDSElURUNUVVJFLm1kIFx1MDBBNzggc3RlcCAxKS5cbiAqXG4gKiBBIGBMb2NhbEluZGV4YCBtYXBzIGV2ZXJ5IHZhdWx0IHBhdGggdGhpcyBjbGllbnQgaGFzIGV2ZXIgc3luY2VkIHRvIHRoZVxuICogbGFzdCB2ZXJzaW9uIGl0ICprbm93cyogd2FzIGF1dGhvcml0YXRpdmU6IGNvbnRlbnQgaGFzaCwgc2l6ZSwgdGhlXG4gKiBzZXJ2ZXItYXNzaWduZWQgdmVyc2lvbiBpZCwgYW5kIHRoZSB2ZXJzaW9uJ3MgbG9naWNhbCBjbG9jay4gRW50cmllcyB3aXRoXG4gKiBgZGVsZXRlZEF0YCBzZXQgYXJlIHRvbWJzdG9uZXMgXHUyMDE0IHRoZSBmaWxlIHdhcyBkZWxldGVkIChsb2NhbGx5IG9yXG4gKiByZW1vdGVseSkgYnV0IHRoZSBlbnRyeSBzdGF5cyBzbyB0aGUgZGVsZXRpb24gaXMgbm90IHJlc3VycmVjdGVkIGJ5IHRoZVxuICogbmV4dCBzY2FuIGFuZCBzbyByZW5hbWUgY29ycmVsYXRpb24ga2VlcHMgd29ya2luZy5cbiAqXG4gKiBUaGUgaW5kZXggaXMgcGVyc2lzdGVkIGluc2lkZSB0aGUgdmF1bHQgYXQgYC8udmF1bHRzeW5jZm9yYWdlbnRzL3N0YXRlYFxuICogKHRoYXQgZGlyZWN0b3J5IGlzIHN5bmMtaWdub3JlZCwgc2VlIGBpZ25vcmUudHNgKSB0aHJvdWdoIHRoZSBzdG9yYWdlXG4gKiBhZGFwdGVyLCB3aG9zZSBgd3JpdGVGaWxlYCBpcyBhdG9taWMgKHRlbXAgKyByZW5hbWUpIGJ5IGNvbnRyYWN0LlxuICpcbiAqIEFsbCBvcGVyYXRpb25zIGFyZSBwdXJlOiB0aGV5IHJldHVybiBuZXcgb2JqZWN0cyBhbmQgbmV2ZXIgbXV0YXRlIGlucHV0cy5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IExvZ2ljYWxDbG9jayB9IGZyb20gJy4vdHlwZXMuanMnO1xuaW1wb3J0IHsgUHJvdG9jb2xFcnJvciB9IGZyb20gJy4vZXJyb3JzLmpzJztcblxuLyoqXG4gKiBDdXJyZW50IG9uLWRpc2sgc2NoZW1hIHZlcnNpb24uIEJ1bXAgKyBhZGQgbWlncmF0aW9uIG9uIGJyZWFraW5nIGNoYW5nZXMuXG4gKlxuICogSGlzdG9yeTpcbiAqICAgLSAxIFx1MjAxNCBpbml0aWFsIHNoYXBlIChoYXNoL3NpemUvdmVyc2lvbklkL2Nsb2NrL2RlbGV0ZWRBdC9pc0ZvbGRlcikuXG4gKiAgIC0gMiBcdTIwMTQgYWRkcyB0aGUgb3B0aW9uYWwgYG10aW1lYCBjYWNoZSBmaWVsZCBwZXIgZW50cnkgKHNjYW4gcHJlLWZpbHRlcixcbiAqICAgICAgICAgc2VlIGBzY2FuLnRzYCkuIEdyYWNlZnVsIG1pZ3JhdGlvbjogdjEgZW50cmllcyBzaW1wbHkgbGFjayBgbXRpbWVgLFxuICogICAgICAgICB3aGljaCByZWFkcyBiYWNrIGFzIFwidW5rbm93blwiIFx1MjAxNCB0aGUgbmV4dCBmYXN0IHNjYW4gcmUtaGFzaGVzIHRoZVxuICogICAgICAgICBmaWxlIGFuZCByZWNvcmRzIGl0LiBPbGQgdjEgc3RhdGUgZmlsZXMgbG9hZCB3aXRob3V0IGVycm9yLlxuICpcbiAqIFRoZSB2MiBFTlZFTE9QRSBhbHNvIGNhcnJpZXMgb3B0aW9uYWwgc3luYy1jdXJzb3IgYm9va2tlZXBpbmcgKGBjdXJzb3JgLFxuICogYHN5bmNlZFRocm91Z2hgLCBgbmVlZHNGdWxsTWFuaWZlc3RgIFx1MjAxNCBzZWUgYFBlcnNpc3RlZFN5bmNTdGF0ZWApOyBmaWxlc1xuICogd3JpdHRlbiBiZWZvcmUgaXQgZXhpc3RlZCBzaW1wbHkgbGFjayB0aG9zZSBrZXlzLCB3aGljaCByZWFkIGJhY2sgYXNcbiAqIFwibm8gY3Vyc29yIGtub3dsZWRnZVwiIChmdWxsIG1hbmlmZXN0IG9uIHRoZSBuZXh0IGNvbm5lY3QpLiBObyB2ZXJzaW9uXG4gKiBidW1wOiBib3RoIGRpcmVjdGlvbnMgdG9sZXJhdGUgdGhlIG1pc3NpbmcgZmllbGRzLlxuICovXG5leHBvcnQgY29uc3QgTE9DQUxfSU5ERVhfU0NIRU1BX1ZFUlNJT04gPSAyO1xuXG4vKiogT2xkZXN0IG9uLWRpc2sgc2NoZW1hIHZlcnNpb24gdGhpcyBidWlsZCBjYW4gc3RpbGwgcmVhZC4gKi9cbmV4cG9ydCBjb25zdCBNSU5fTE9DQUxfSU5ERVhfU0NIRU1BX1ZFUlNJT04gPSAxO1xuXG4vKiogVmF1bHQgcGF0aCB3aGVyZSB0aGUgY2xpZW50IHBlcnNpc3RzIGl0cyBsb2NhbCBpbmRleC4gKi9cbmV4cG9ydCBjb25zdCBMT0NBTF9JTkRFWF9TVEFURV9QQVRIID0gJy8udmF1bHRzeW5jZm9yYWdlbnRzL3N0YXRlJztcblxuLyoqIE9uZSBwYXRoJ3MgbGFzdC1rbm93bi1zeW5jZWQgc3RhdGUuICovXG5leHBvcnQgaW50ZXJmYWNlIExvY2FsSW5kZXhFbnRyeSB7XG4gIC8qKiBzaGEyNTYgaGV4IG9mIHRoZSBjb250ZW50IGF0IGB2ZXJzaW9uSWRgLiAqL1xuICBoYXNoOiBzdHJpbmc7XG4gIC8qKiBDb250ZW50IHNpemUgaW4gYnl0ZXMgKGAwYCBmb3IgZm9sZGVyIHBsYWNlaG9sZGVycykuICovXG4gIHNpemU6IG51bWJlcjtcbiAgLyoqIFNlcnZlci1hc3NpZ25lZCB2ZXJzaW9uIGlkIHRoaXMgZW50cnkgcmVmbGVjdHMuICovXG4gIHZlcnNpb25JZDogc3RyaW5nO1xuICAvKiogTG9naWNhbCBjbG9jayBvZiBgdmVyc2lvbklkYCBcdTIwMTQgdXNlZCB0byBwcmVkaWN0IGNvbmZsaWN0IG91dGNvbWVzLiAqL1xuICBjbG9jazogTG9naWNhbENsb2NrO1xuICAvKiogUHJlc2VudCBcdTIxRDIgdG9tYnN0b25lOiB0aGUgcGF0aCB3YXMgZGVsZXRlZCBhdCB0aGlzIGVwb2NoIG1zLiAqL1xuICBkZWxldGVkQXQ/OiBudW1iZXI7XG4gIC8qKlxuICAgKiBUcnVlIGZvciBlbXB0eS1mb2xkZXIgcGxhY2Vob2xkZXIgZW50cmllcyAoRlItMTApLiBGb2xkZXIgZW50cmllcyBjYXJyeVxuICAgKiBgaGFzaDogJydgLCBgc2l6ZTogMGA7IHRoZSBjbG9jayBpcyB0aGF0IG9mIHRoZSBwbGFjZWhvbGRlcidzIHZlcnNpb24uXG4gICAqL1xuICBpc0ZvbGRlcj86IGJvb2xlYW47XG4gIC8qKlxuICAgKiBTdG9yYWdlIG10aW1lIChlcG9jaCBtcykgb2JzZXJ2ZWQgdGhlIGxhc3QgdGltZSB0aGlzIGVudHJ5J3MgZmlsZSB3YXNcbiAgICogaGFzaGVkIGJ5IGEgc2Nhbi4gQSBwdXJlIGNhY2hlIGZvciB0aGUgc2NhbiBwcmUtZmlsdGVyIChgc2Nhbi50c2ApOlxuICAgKiBudWxsaXNoIChhYnNlbnQsIGUuZy4gbGVnYWN5IHYxIHN0YXRlIG9yIGVudHJpZXMgd3JpdHRlbiBieSBwdWxscylcbiAgICogbWVhbnMgXCJ1bmtub3duXCIgXHUyMDE0IHRoZSBuZXh0IGZhc3Qgc2NhbiBoYXNoZXMgdGhlIGZpbGUgYW5kIHJlY29yZHMgaXQgdmlhXG4gICAqIGByZWNvcmRIYXNoZWRGaWxlc2AuIE5ldmVyIGNvbnN1bHRlZCBmb3Igc3luYyBkZWNpc2lvbnMuXG4gICAqL1xuICBtdGltZT86IG51bWJlcjtcbn1cblxuLyoqIFRoZSB3aG9sZSBpbmRleDogbm9ybWFsaXplZCB2YXVsdCBwYXRoIFx1MjE5MiBlbnRyeS4gYHt9YCBpcyBhIHZhbGlkIGVtcHR5IGluZGV4LiAqL1xuZXhwb3J0IHR5cGUgTG9jYWxJbmRleCA9IFJlYWRvbmx5PFJlY29yZDxzdHJpbmcsIExvY2FsSW5kZXhFbnRyeT4+O1xuXG4vKiogVmVyc2lvbmVkIHNlcmlhbGl6YXRpb24gZW52ZWxvcGUgKHNjaGVtYVZlcnNpb24gZW5hYmxlcyBmdXR1cmUgbWlncmF0aW9uKS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgTG9jYWxJbmRleEVudmVsb3BlIHtcbiAgc2NoZW1hVmVyc2lvbjogbnVtYmVyO1xuICBlbnRyaWVzOiBSZWNvcmQ8c3RyaW5nLCBMb2NhbEluZGV4RW50cnk+O1xuICAvKipcbiAgICogRW52ZWxvcGUtbGV2ZWwgc3luYyBib29ra2VlcGluZyAob3B0aW9uYWwgc28gdjIgZmlsZXMgd3JpdHRlbiBiZWZvcmUgaXRcbiAgICogZXhpc3RlZCBzdGlsbCBsb2FkOyB1bmtub3duIGZpZWxkcyBhcmUgdG9sZXJhdGVkIGluIGJvdGggZGlyZWN0aW9ucykuXG4gICAqIFNlZSBgUGVyc2lzdGVkU3luY1N0YXRlYC5cbiAgICovXG4gIGN1cnNvcj86IG51bWJlcjtcbiAgc3luY2VkVGhyb3VnaD86IG51bWJlciB8IG51bGw7XG4gIG5lZWRzRnVsbE1hbmlmZXN0PzogYm9vbGVhbjtcbn1cblxuLyoqXG4gKiBTeW5jLWN1cnNvciBib29ra2VlcGluZyBwZXJzaXN0ZWQgYXRvbWljYWxseSBXSVRIIHRoZSBlbnRyaWVzIChvbmUgZmlsZSxcbiAqIG9uZSB3cml0ZSkgc28gdGhlIHR3byBjYW4gbmV2ZXIgZGlzYWdyZWUgYWZ0ZXIgYSBjcmFzaC4gUmVzdG9yZWQgb25cbiAqIHN0YXJ0dXAgdG8gcG93ZXIgZGVsdGEtbWFuaWZlc3QgcmVjb25uZWN0cy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBQZXJzaXN0ZWRTeW5jU3RhdGUge1xuICAvKiogTGFzdCBzZWVuIHNlcnZlciBzZXF1ZW5jZSBudW1iZXIgKHNlbnQgYXMgYGhlbGxvLmN1cnNvcmApLiAqL1xuICBjdXJzb3I/OiBudW1iZXI7XG4gIC8qKlxuICAgKiBTZXF1ZW5jZSB0aHJvdWdoIHdoaWNoIHRoZSBpbmRleCBpcyBrbm93biBDT01QTEVURTogdGhlIG1hbmlmZXN0IGN1cnNvclxuICAgKiBvZiB0aGUgbGFzdCBzeW5jIGN5Y2xlIHRoYXQgZmluaXNoZWQgc3VjY2Vzc2Z1bGx5LiBFdmVyeSBoZWFkIGF0IG9yXG4gICAqIGJlbG93IGl0IGlzIHJlZmxlY3RlZCBpbiB0aGUgZW50cmllcyBhYm92ZSwgc28gYSBsYXRlciByZWNvbm5lY3Qgb25seVxuICAgKiBuZWVkcyBoZWFkcyB3aXRoIGBoZWFkX3NlcSA+IHN5bmNlZFRocm91Z2hgIFx1MjAxNCB0aGUgZGVsdGEtbWFuaWZlc3Qgd2luZG93LlxuICAgKiBgbnVsbGAvYWJzZW50IFx1MjFEMiBubyBjb21wbGV0ZWQgY3ljbGUgeWV0IChvciBhbiBpbnRlcnJ1cHRlZCBvbmUpOiB0aGUgbmV4dFxuICAgKiBtYW5pZmVzdCBtdXN0IGJlIEZVTEwuIERlbGliZXJhdGVseSBOT1QgYWR2YW5jZWQgdG8gY29tbWl0LWFjayBzZXFzIHNlZW5cbiAgICogbWlkLWN5Y2xlOiBhIGNoYW5nZSBicm9hZGNhc3QgZnJvbSBhbm90aGVyIGRldmljZSBjYW4gaW50ZXJsZWF2ZSB3aXRoXG4gICAqIG91ciBhY2tzIGFuZCBsYW5kIGluIHRoZSBwb3N0LWN5Y2xlIGRpc3BhdGNoIHF1ZXVlLCBzbyBvbmx5IHRoZVxuICAgKiBmZXRjaC10aW1lIG1hbmlmZXN0IGN1cnNvciBpcyBhIGNvbXBsZXRpb24gZ3VhcmFudGVlLlxuICAgKi9cbiAgc3luY2VkVGhyb3VnaD86IG51bWJlciB8IG51bGw7XG4gIC8qKlxuICAgKiBBIHJlbW90ZSBjaGFuZ2Ugd2FzIGRlZmVycmVkIG92ZXIgbG9jYWxseS1kaXZlcmdlZCBjb250ZW50IChgaGFuZGxlQ2hhbmdlYFxuICAgKiBndWFyZCkgYW5kIGhhcyBub3QgYmVlbiB0aHJvdWdoIGEgcGxhbiBjeWNsZSB5ZXQuIFRoZSBuZXh0IG1hbmlmZXN0IG11c3RcbiAgICogYmUgRlVMTCBzbyBgY29tcHV0ZVN5bmNQbGFuYCBzZWVzIHRoZSByZW1vdGUgaGVhZCBhbmQgcmVzb2x2ZXMgdGhlXG4gICAqIGRpdmVyZ2VuY2UgdGhyb3VnaCBpdHMgY29uZmxpY3QgbG9naWMgaW5zdGVhZCBvZiBhIHN0YWxlLXBhcmVudCBwdXNoLlxuICAgKi9cbiAgbmVlZHNGdWxsTWFuaWZlc3Q/OiBib29sZWFuO1xufVxuXG4vKiogT25lIGF1dGhvcml0YXRpdmUgc3RhdGUgY2hhbmdlIHRvIGZvbGQgaW50byB0aGUgaW5kZXguICovXG5leHBvcnQgaW50ZXJmYWNlIExvY2FsSW5kZXhDb21taXQge1xuICBwYXRoOiBzdHJpbmc7XG4gIHZlcnNpb25JZDogc3RyaW5nO1xuICBoYXNoOiBzdHJpbmc7XG4gIHNpemU6IG51bWJlcjtcbiAgY2xvY2s6IExvZ2ljYWxDbG9jaztcbiAgLyoqIFByZXNlbnQgXHUyMUQyIHRvbWJzdG9uZTogdGhlIHBhdGggd2FzIGRlbGV0ZWQgYXQgdGhpcyBlcG9jaCBtcy4gKi9cbiAgZGVsZXRlZD86IGJvb2xlYW47XG4gIC8qKiBFcG9jaCBtcyBvZiB0aGUgZGVsZXRpb24gXHUyMDE0IHJlcXVpcmVkIHdoZW4gYGRlbGV0ZWRgIGlzIHRydWUuICovXG4gIGRlbGV0ZWRBdD86IG51bWJlcjtcbiAgLyoqIFRydWUgd2hlbiB0aGlzIGNvbW1pdCByZWNvcmRzIGFuIGVtcHR5LWZvbGRlciBwbGFjZWhvbGRlciAoRlItMTApLiAqL1xuICBpc0ZvbGRlcj86IGJvb2xlYW47XG4gIC8qKlxuICAgKiBTdG9yYWdlIG10aW1lIG9ic2VydmVkIGF0IEhBU0ggdGltZSBmb3IgdGhpcyBleGFjdCBjb250ZW50IFx1MjAxNCBwaW5uZWQgb250b1xuICAgKiB0aGUgZW50cnkgd2hlbiB0aGUgY29tbWl0IGlzIGZvbGRlZCAoaS5lLiBhdCBjb21taXQtYWNrIHRpbWUpLiBUaHJlYWRpbmdcbiAgICogdGhlIHN0YXQgdGhhdCBjby1vY2N1cnJlZCB3aXRoIHRoZSBoYXNoZWQgYnl0ZXMgKHJhdGhlciB0aGFuIGFueVxuICAgKiBsYXRlci9jdXJyZW50IHN0YXQpIGd1YXJhbnRlZXMgdGhlIGZhc3QtcGF0aCBjYWNoZSBjYW4gbmV2ZXIgcGFpciBhXG4gICAqIGZyZXNoZXIgc3RhdCB3aXRoIHRoaXMgaGFzaCwgd2hpY2ggd291bGQgaGlkZSBhbiBlZGl0IGZyb20gZXZlcnkgZnV0dXJlXG4gICAqIHNjYW4gKHRoZSBzaWxlbnQgZHJvcHBlZC1lZGl0IGNsYXNzKS4gQWJzZW50IFx1MjFEMiB1bmtub3duOyB0aGUgbmV4dCBzY2FuXG4gICAqIHJlLWhhc2hlcyBhbmQgcmVjb3JkcyB2aWEgYHJlY29yZEhhc2hlZEZpbGVzYC5cbiAgICovXG4gIG10aW1lPzogbnVtYmVyO1xufVxuXG4vKipcbiAqIEZvbGQgb25lIGNvbW1pdCBpbnRvIHRoZSBpbmRleC4gUHVyZTogcmV0dXJucyBhIG5ldyBpbmRleCwgaW5wdXQgdW50b3VjaGVkLlxuICpcbiAqIEFwcGx5aW5nIGEgY29tbWl0IGZvciBhIHBhdGggcmVwbGFjZXMgdGhhdCBwYXRoJ3MgZW50cnkgd2hvbGVzYWxlIChhIGNvbW1pdFxuICogKmlzKiB0aGUgbmV3IHRydXRoIGZvciB0aGUgcGF0aCk7IGBhcHBseUNvbW1pdGAgbmV2ZXIgbWVyZ2VzIGZpZWxkcy5cbiAqIFRvbWJzdG9uaW5nIChgZGVsZXRlZDogdHJ1ZWApIHJlcXVpcmVzIGBkZWxldGVkQXRgIGFuZCBrZWVwcyB0aGUgZW50cnkuXG4gKlxuICogVG8gZHJvcCBhbiBlbnRyeSBlbnRpcmVseSAodGhlIHBhdGggbWlncmF0ZWQgYXdheSwgZS5nLiBhIHN5bmNlZCByZW5hbWUpXG4gKiB1c2UgYHJlbW92ZUVudHJ5YCBpbnN0ZWFkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYXBwbHlDb21taXQoaW5kZXg6IExvY2FsSW5kZXgsIGNvbW1pdDogTG9jYWxJbmRleENvbW1pdCk6IExvY2FsSW5kZXgge1xuICBpZiAoY29tbWl0LmRlbGV0ZWQgJiYgY29tbWl0LmRlbGV0ZWRBdCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgYGFwcGx5Q29tbWl0OiB0b21ic3RvbmUgZm9yICR7SlNPTi5zdHJpbmdpZnkoY29tbWl0LnBhdGgpfSByZXF1aXJlcyBkZWxldGVkQXRgLFxuICAgICk7XG4gIH1cbiAgY29uc3QgbmV4dDogUmVjb3JkPHN0cmluZywgTG9jYWxJbmRleEVudHJ5PiA9IHsgLi4uaW5kZXggfTtcbiAgY29uc3QgZW50cnk6IExvY2FsSW5kZXhFbnRyeSA9IHtcbiAgICBoYXNoOiBjb21taXQuaGFzaCxcbiAgICBzaXplOiBjb21taXQuc2l6ZSxcbiAgICB2ZXJzaW9uSWQ6IGNvbW1pdC52ZXJzaW9uSWQsXG4gICAgY2xvY2s6IGNvbW1pdC5jbG9jayxcbiAgfTtcbiAgaWYgKGNvbW1pdC5kZWxldGVkKSBlbnRyeS5kZWxldGVkQXQgPSBjb21taXQuZGVsZXRlZEF0O1xuICBpZiAoY29tbWl0LmlzRm9sZGVyKSBlbnRyeS5pc0ZvbGRlciA9IHRydWU7XG4gIGlmIChjb21taXQubXRpbWUgIT09IHVuZGVmaW5lZCkgZW50cnkubXRpbWUgPSBjb21taXQubXRpbWU7XG4gIG5leHRbY29tbWl0LnBhdGhdID0gZW50cnk7XG4gIHJldHVybiBuZXh0O1xufVxuXG4vKipcbiAqIFJlbW92ZSBhIHBhdGgncyBlbnRyeSBlbnRpcmVseSAobm8gdG9tYnN0b25lKS4gVXNlZCB3aGVuIHRoZSBhdXRob3JpdHlcbiAqIG1pZ3JhdGVzIGEgcGF0aCdzIHZlcnNpb24gY2hhaW4gZWxzZXdoZXJlIFx1MjAxNCBpLmUuIGEgc3luY2VkIHJlbmFtZTogdGhlIG9sZFxuICogcGF0aCBtdXN0IHZhbmlzaCBmcm9tIHRoZSBpbmRleCBleGFjdGx5IGFzIGl0IHZhbmlzaGVkIGZyb20gdGhlIG1hbmlmZXN0LlxuICogUHVyZTsgcmVtb3ZpbmcgYW4gYWJzZW50IHBhdGggaXMgYSBuby1vcC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlbW92ZUVudHJ5KGluZGV4OiBMb2NhbEluZGV4LCBwYXRoOiBzdHJpbmcpOiBMb2NhbEluZGV4IHtcbiAgaWYgKCEocGF0aCBpbiBpbmRleCkpIHJldHVybiBpbmRleDtcbiAgY29uc3QgbmV4dDogUmVjb3JkPHN0cmluZywgTG9jYWxJbmRleEVudHJ5PiA9IHsgLi4uaW5kZXggfTtcbiAgZGVsZXRlIG5leHRbcGF0aF07XG4gIHJldHVybiBuZXh0O1xufVxuXG4vKipcbiAqIFNlcmlhbGl6ZSB0byBhIGRldGVybWluaXN0aWMgSlNPTiBzdHJpbmc6IHZlcnNpb25lZCBlbnZlbG9wZSwgZW50cmllc1xuICogc29ydGVkIGJ5IHBhdGggKHNvIGlkZW50aWNhbCBpbmRleGVzIHNlcmlhbGl6ZSBieXRlLWlkZW50aWNhbGx5IGFuZCBkaWZmXG4gKiBjbGVhbmx5IGluIHN0YXRlLWRpciBsaXN0aW5ncykuIGBzdGF0ZWAgKG9wdGlvbmFsKSBjYXJyaWVzIHRoZSBzeW5jLWN1cnNvclxuICogYm9va2tlZXBpbmcgcGVyc2lzdGVkIGFsb25nc2lkZSB0aGUgZW50cmllcyBcdTIwMTQgc2VlIGBQZXJzaXN0ZWRTeW5jU3RhdGVgLlxuICovXG5leHBvcnQgZnVuY3Rpb24gc2VyaWFsaXplTG9jYWxJbmRleChpbmRleDogTG9jYWxJbmRleCwgc3RhdGU6IFBlcnNpc3RlZFN5bmNTdGF0ZSA9IHt9KTogc3RyaW5nIHtcbiAgY29uc3QgZW50cmllczogUmVjb3JkPHN0cmluZywgTG9jYWxJbmRleEVudHJ5PiA9IHt9O1xuICBmb3IgKGNvbnN0IHBhdGggb2YgT2JqZWN0LmtleXMoaW5kZXgpLnNvcnQoKSkge1xuICAgIGVudHJpZXNbcGF0aF0gPSBpbmRleFtwYXRoXSBhcyBMb2NhbEluZGV4RW50cnk7XG4gIH1cbiAgY29uc3QgZW52ZWxvcGU6IExvY2FsSW5kZXhFbnZlbG9wZSA9IHtcbiAgICBzY2hlbWFWZXJzaW9uOiBMT0NBTF9JTkRFWF9TQ0hFTUFfVkVSU0lPTixcbiAgICBlbnRyaWVzLFxuICAgIC4uLihzdGF0ZS5jdXJzb3IgIT09IHVuZGVmaW5lZCA/IHsgY3Vyc29yOiBzdGF0ZS5jdXJzb3IgfSA6IHt9KSxcbiAgICAuLi4oc3RhdGUuc3luY2VkVGhyb3VnaCAhPT0gdW5kZWZpbmVkID8geyBzeW5jZWRUaHJvdWdoOiBzdGF0ZS5zeW5jZWRUaHJvdWdoIH0gOiB7fSksXG4gICAgLi4uKHN0YXRlLm5lZWRzRnVsbE1hbmlmZXN0ICE9PSB1bmRlZmluZWRcbiAgICAgID8geyBuZWVkc0Z1bGxNYW5pZmVzdDogc3RhdGUubmVlZHNGdWxsTWFuaWZlc3QgfVxuICAgICAgOiB7fSksXG4gIH07XG4gIHJldHVybiBKU09OLnN0cmluZ2lmeShlbnZlbG9wZSk7XG59XG5cbi8qKiBUaGUgZW50cmllcyBwbHVzIHRoZSBzeW5jLWN1cnNvciBib29ra2VlcGluZyBvZiBhIHBlcnNpc3RlZCBzdGF0ZSBmaWxlLiAqL1xuZXhwb3J0IGludGVyZmFjZSBEZXNlcmlhbGl6ZWRMb2NhbFN0YXRlIHtcbiAgaW5kZXg6IExvY2FsSW5kZXg7XG4gIC8qKiBFbnZlbG9wZSBib29ra2VlcGluZzsgZGVmYXVsdHMgZm9yIGZpbGVzIHdyaXR0ZW4gYmVmb3JlIGl0IGV4aXN0ZWQuICovXG4gIHN0YXRlOiBSZXF1aXJlZDxQZXJzaXN0ZWRTeW5jU3RhdGU+O1xufVxuXG4vKipcbiAqIFBhcnNlIGEgc2VyaWFsaXplZCBzdGF0ZSBmaWxlIElOQ0xVRElORyBpdHMgZW52ZWxvcGUgYm9va2tlZXBpbmcgKHRoZVxuICogY2xpZW50J3Mgc3RhcnR1cCBwYXRoKS4gRW50cnkgdmFsaWRhdGlvbiBpcyBpZGVudGljYWwgdG9cbiAqIGBkZXNlcmlhbGl6ZUxvY2FsSW5kZXhgOyB0aGUgZXh0cmEgZmllbGRzIGRlZmF1bHQgdG8gXCJubyBjdXJzb3Iga25vd2xlZGdlXCJcbiAqIChgY3Vyc29yOiAwYCwgYHN5bmNlZFRocm91Z2g6IG51bGxgLCBgbmVlZHNGdWxsTWFuaWZlc3Q6IGZhbHNlYCkgc28gdjJcbiAqIGZpbGVzIHdyaXR0ZW4gYnkgb2xkZXIgYnVpbGRzIGxvYWQgdW5jaGFuZ2VkIGFuZCBzaW1wbHkgcmVjb25uZWN0IHdpdGggYVxuICogZnVsbCBtYW5pZmVzdC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRlc2VyaWFsaXplTG9jYWxTdGF0ZShqc29uOiBzdHJpbmcpOiBEZXNlcmlhbGl6ZWRMb2NhbFN0YXRlIHtcbiAgbGV0IHBhcnNlZDogdW5rbm93bjtcbiAgdHJ5IHtcbiAgICBwYXJzZWQgPSBKU09OLnBhcnNlKGpzb24pO1xuICB9IGNhdGNoIChjYXVzZSkge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKCdMb2NhbCBpbmRleCBzdGF0ZSBpcyBub3QgdmFsaWQgSlNPTicsIHsgY2F1c2UgfSk7XG4gIH1cbiAgaWYgKCFpc1BsYWluT2JqZWN0KHBhcnNlZCkpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcignTG9jYWwgaW5kZXggc3RhdGUgaXMgbm90IGFuIG9iamVjdCcpO1xuICB9XG4gIC8vIEVudHJ5LWxldmVsIHZhbGlkYXRpb24gaXMgZXhhY3RseSBgZGVzZXJpYWxpemVMb2NhbEluZGV4YCdzOyB0aGUgY2FsbFxuICAvLyBhbHNvIGVuZm9yY2VzIHRoZSBzY2hlbWEtdmVyc2lvbiB3aW5kb3cuXG4gIGNvbnN0IGluZGV4ID0gZGVzZXJpYWxpemVMb2NhbEluZGV4KGpzb24pO1xuICBjb25zdCByYXdDdXJzb3IgPSAocGFyc2VkIGFzIHsgY3Vyc29yPzogdW5rbm93biB9KS5jdXJzb3I7XG4gIGNvbnN0IHJhd1N5bmNlZFRocm91Z2ggPSAocGFyc2VkIGFzIHsgc3luY2VkVGhyb3VnaD86IHVua25vd24gfSkuc3luY2VkVGhyb3VnaDtcbiAgY29uc3QgcmF3TmVlZHNGdWxsID0gKHBhcnNlZCBhcyB7IG5lZWRzRnVsbE1hbmlmZXN0PzogdW5rbm93biB9KS5uZWVkc0Z1bGxNYW5pZmVzdDtcbiAgaWYgKHJhd0N1cnNvciAhPT0gdW5kZWZpbmVkICYmICh0eXBlb2YgcmF3Q3Vyc29yICE9PSAnbnVtYmVyJyB8fCAhTnVtYmVyLmlzSW50ZWdlcihyYXdDdXJzb3IpIHx8IHJhd0N1cnNvciA8IDApKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoJ0xvY2FsIGluZGV4IHN0YXRlOiBjdXJzb3IgbXVzdCBiZSBhIG5vbi1uZWdhdGl2ZSBpbnRlZ2VyJyk7XG4gIH1cbiAgaWYgKFxuICAgIHJhd1N5bmNlZFRocm91Z2ggIT09IHVuZGVmaW5lZCAmJlxuICAgIHJhd1N5bmNlZFRocm91Z2ggIT09IG51bGwgJiZcbiAgICAodHlwZW9mIHJhd1N5bmNlZFRocm91Z2ggIT09ICdudW1iZXInIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKHJhd1N5bmNlZFRocm91Z2gpIHx8IHJhd1N5bmNlZFRocm91Z2ggPCAwKVxuICApIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcignTG9jYWwgaW5kZXggc3RhdGU6IHN5bmNlZFRocm91Z2ggbXVzdCBiZSBhIG5vbi1uZWdhdGl2ZSBpbnRlZ2VyIG9yIG51bGwnKTtcbiAgfVxuICBpZiAocmF3TmVlZHNGdWxsICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIHJhd05lZWRzRnVsbCAhPT0gJ2Jvb2xlYW4nKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoJ0xvY2FsIGluZGV4IHN0YXRlOiBuZWVkc0Z1bGxNYW5pZmVzdCBtdXN0IGJlIGEgYm9vbGVhbiB3aGVuIHByZXNlbnQnKTtcbiAgfVxuICByZXR1cm4ge1xuICAgIGluZGV4LFxuICAgIHN0YXRlOiB7XG4gICAgICBjdXJzb3I6IHR5cGVvZiByYXdDdXJzb3IgPT09ICdudW1iZXInID8gcmF3Q3Vyc29yIDogMCxcbiAgICAgIHN5bmNlZFRocm91Z2g6IHR5cGVvZiByYXdTeW5jZWRUaHJvdWdoID09PSAnbnVtYmVyJyA/IHJhd1N5bmNlZFRocm91Z2ggOiBudWxsLFxuICAgICAgbmVlZHNGdWxsTWFuaWZlc3Q6IHJhd05lZWRzRnVsbCA9PT0gdHJ1ZSxcbiAgICB9LFxuICB9O1xufVxuXG4vKipcbiAqIFBhcnNlIGEgc2VyaWFsaXplZCBpbmRleCBiYWNrLiBUaHJvd3MgYFByb3RvY29sRXJyb3JgIG9uIG5vbi1KU09OIGlucHV0LFxuICogYSBtYWxmb3JtZWQgZW52ZWxvcGUsIGVudHJpZXMgd2l0aCB3cm9uZyBmaWVsZCB0eXBlcywgb3IgYSBgc2NoZW1hVmVyc2lvbmBcbiAqIG91dHNpZGUgdGhlIHN1cHBvcnRlZCByYW5nZSAob2xkZXIgdGhhbiBgTUlOX0xPQ0FMX0lOREVYX1NDSEVNQV9WRVJTSU9OYFxuICogb3IgbmV3ZXIgdGhhbiBgTE9DQUxfSU5ERVhfU0NIRU1BX1ZFUlNJT05gKSBcdTIwMTQgb2xkZXIgdmVyc2lvbnMgKndpdGhpbiogdGhlXG4gKiByYW5nZSBsb2FkIHdpdGhvdXQgZXJyb3IgKHYxIGVudHJpZXMgc2ltcGx5IGRlc2VyaWFsaXplIHdpdGggYG10aW1lYFxuICogdW5rbm93bikuIFVua25vd24gZXh0cmEgZmllbGRzIGFyZSB0b2xlcmF0ZWQgZm9yIGZvcndhcmQgY29tcGF0aWJpbGl0eS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRlc2VyaWFsaXplTG9jYWxJbmRleChqc29uOiBzdHJpbmcpOiBMb2NhbEluZGV4IHtcbiAgbGV0IHBhcnNlZDogdW5rbm93bjtcbiAgdHJ5IHtcbiAgICBwYXJzZWQgPSBKU09OLnBhcnNlKGpzb24pO1xuICB9IGNhdGNoIChjYXVzZSkge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKCdMb2NhbCBpbmRleCBzdGF0ZSBpcyBub3QgdmFsaWQgSlNPTicsIHsgY2F1c2UgfSk7XG4gIH1cbiAgaWYgKCFpc1BsYWluT2JqZWN0KHBhcnNlZCkpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcignTG9jYWwgaW5kZXggc3RhdGUgaXMgbm90IGFuIG9iamVjdCcpO1xuICB9XG4gIGNvbnN0IHZlcnNpb24gPSBwYXJzZWQuc2NoZW1hVmVyc2lvbjtcbiAgaWYgKHR5cGVvZiB2ZXJzaW9uICE9PSAnbnVtYmVyJyB8fCAhTnVtYmVyLmlzSW50ZWdlcih2ZXJzaW9uKSkge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKCdMb2NhbCBpbmRleCBzdGF0ZSBpcyBtaXNzaW5nIGludGVnZXIgc2NoZW1hVmVyc2lvbicpO1xuICB9XG4gIGlmICh2ZXJzaW9uIDwgTUlOX0xPQ0FMX0lOREVYX1NDSEVNQV9WRVJTSU9OIHx8IHZlcnNpb24gPiBMT0NBTF9JTkRFWF9TQ0hFTUFfVkVSU0lPTikge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKFxuICAgICAgYExvY2FsIGluZGV4IHNjaGVtYSB2ZXJzaW9uICR7dmVyc2lvbn0gaXMgbm90IHN1cHBvcnRlZCBieSB0aGlzIGJ1aWxkIGAgK1xuICAgICAgICBgKGV4cGVjdGVkICR7TUlOX0xPQ0FMX0lOREVYX1NDSEVNQV9WRVJTSU9OfS4uJHtMT0NBTF9JTkRFWF9TQ0hFTUFfVkVSU0lPTn0pOyBgICtcbiAgICAgICAgJ2EgbWlncmF0aW9uIGlzIHJlcXVpcmVkJyxcbiAgICApO1xuICB9XG4gIGNvbnN0IHJhd0VudHJpZXMgPSBwYXJzZWQuZW50cmllcztcbiAgaWYgKCFpc1BsYWluT2JqZWN0KHJhd0VudHJpZXMpKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoJ0xvY2FsIGluZGV4IHN0YXRlIGlzIG1pc3NpbmcgdGhlIGVudHJpZXMgb2JqZWN0Jyk7XG4gIH1cblxuICBjb25zdCBlbnRyaWVzOiBSZWNvcmQ8c3RyaW5nLCBMb2NhbEluZGV4RW50cnk+ID0ge307XG4gIGZvciAoY29uc3QgW3BhdGgsIHJhd10gb2YgT2JqZWN0LmVudHJpZXMocmF3RW50cmllcykpIHtcbiAgICBlbnRyaWVzW3BhdGhdID0gcGFyc2VFbnRyeShwYXRoLCByYXcpO1xuICB9XG4gIHJldHVybiBlbnRyaWVzO1xufVxuXG5mdW5jdGlvbiBwYXJzZUVudHJ5KHBhdGg6IHN0cmluZywgcmF3OiB1bmtub3duKTogTG9jYWxJbmRleEVudHJ5IHtcbiAgY29uc3Qgd2hlcmUgPSBgTG9jYWwgaW5kZXggZW50cnkgJHtKU09OLnN0cmluZ2lmeShwYXRoKX1gO1xuICBpZiAoIWlzUGxhaW5PYmplY3QocmF3KSkgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoYCR7d2hlcmV9IGlzIG5vdCBhbiBvYmplY3RgKTtcbiAgY29uc3QgeyBoYXNoLCBzaXplLCB2ZXJzaW9uSWQsIGNsb2NrLCBkZWxldGVkQXQsIGlzRm9sZGVyLCBtdGltZSB9ID0gcmF3IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICBpZiAodHlwZW9mIGhhc2ggIT09ICdzdHJpbmcnKSB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgJHt3aGVyZX06IGhhc2ggbXVzdCBiZSBhIHN0cmluZ2ApO1xuICBpZiAodHlwZW9mIHZlcnNpb25JZCAhPT0gJ3N0cmluZycpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgJHt3aGVyZX06IHZlcnNpb25JZCBtdXN0IGJlIGEgc3RyaW5nYCk7XG4gIH1cbiAgaWYgKHR5cGVvZiBzaXplICE9PSAnbnVtYmVyJyB8fCAhTnVtYmVyLmlzSW50ZWdlcihzaXplKSB8fCBzaXplIDwgMCkge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKGAke3doZXJlfTogc2l6ZSBtdXN0IGJlIGEgbm9uLW5lZ2F0aXZlIGludGVnZXJgKTtcbiAgfVxuICBpZiAoIWlzUGxhaW5PYmplY3QoY2xvY2spIHx8IHR5cGVvZiBjbG9jay5jb3VudGVyICE9PSAnbnVtYmVyJyB8fCB0eXBlb2YgY2xvY2suZGV2aWNlSWQgIT09ICdzdHJpbmcnKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoYCR7d2hlcmV9OiBjbG9jayBtdXN0IGJlIHsgY291bnRlcjogbnVtYmVyLCBkZXZpY2VJZDogc3RyaW5nIH1gKTtcbiAgfVxuICBpZiAoZGVsZXRlZEF0ICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIGRlbGV0ZWRBdCAhPT0gJ251bWJlcicpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgJHt3aGVyZX06IGRlbGV0ZWRBdCBtdXN0IGJlIGEgbnVtYmVyIHdoZW4gcHJlc2VudGApO1xuICB9XG4gIGlmIChpc0ZvbGRlciAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBpc0ZvbGRlciAhPT0gJ2Jvb2xlYW4nKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoYCR7d2hlcmV9OiBpc0ZvbGRlciBtdXN0IGJlIGEgYm9vbGVhbiB3aGVuIHByZXNlbnRgKTtcbiAgfVxuICBpZiAobXRpbWUgIT09IHVuZGVmaW5lZCAmJiAodHlwZW9mIG10aW1lICE9PSAnbnVtYmVyJyB8fCAhTnVtYmVyLmlzRmluaXRlKG10aW1lKSkpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgJHt3aGVyZX06IG10aW1lIG11c3QgYmUgYSBmaW5pdGUgbnVtYmVyIHdoZW4gcHJlc2VudGApO1xuICB9XG4gIGNvbnN0IGVudHJ5OiBMb2NhbEluZGV4RW50cnkgPSB7XG4gICAgaGFzaCxcbiAgICBzaXplLFxuICAgIHZlcnNpb25JZCxcbiAgICBjbG9jazogeyBjb3VudGVyOiBjbG9jay5jb3VudGVyIGFzIG51bWJlciwgZGV2aWNlSWQ6IGNsb2NrLmRldmljZUlkIGFzIHN0cmluZyB9LFxuICB9O1xuICBpZiAoZGVsZXRlZEF0ICE9PSB1bmRlZmluZWQpIGVudHJ5LmRlbGV0ZWRBdCA9IGRlbGV0ZWRBdCBhcyBudW1iZXI7XG4gIGlmIChpc0ZvbGRlciAhPT0gdW5kZWZpbmVkKSBlbnRyeS5pc0ZvbGRlciA9IGlzRm9sZGVyIGFzIGJvb2xlYW47XG4gIGlmIChtdGltZSAhPT0gdW5kZWZpbmVkKSBlbnRyeS5tdGltZSA9IG10aW1lIGFzIG51bWJlcjtcbiAgcmV0dXJuIGVudHJ5O1xufVxuXG5mdW5jdGlvbiBpc1BsYWluT2JqZWN0KHZhbHVlOiB1bmtub3duKTogdmFsdWUgaXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4ge1xuICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiB2YWx1ZSAhPT0gbnVsbCAmJiAhQXJyYXkuaXNBcnJheSh2YWx1ZSk7XG59XG4iLCAiLyoqXG4gKiBUaGluIHB1bGwtc2lkZSBvcmNoZXN0cmF0aW9uIChBUkNISVRFQ1RVUkUubWQgXHUwMEE3OCBzdGVwIDUpLiBOT1QgdGhlIG5ldHdvcmtcbiAqIGNsaWVudDogYWxsIHRyYW5zcG9ydCBpcyBpbmplY3RlZCAoYGZldGNoQmxvYmApLCB3aGljaCB0aGUgbGF0ZXIgbmV0d29ya1xuICogcGhhc2UgaW1wbGVtZW50cyBvdmVyIGAvYmxvYi86aGFzaGAgb3IgV1MtaW5saW5lIGNvbnRlbnQuXG4gKlxuICogYGFwcGx5UHVsbGAgbWF0ZXJpYWxpemVzIGV2ZXJ5IGBQdWxsT3BgIG9mIGEgYFN5bmNQbGFuYCB0aHJvdWdoIHRoZVxuICogc3RvcmFnZSBhZGFwdGVyIGFuZCB1cGRhdGVzIHRoZSBsb2NhbCBpbmRleCBcdTIwMTQgZHVyYWJseSBhbmQgaG9uZXN0bHk6XG4gKlxuICogICAtIGJsb2JzIGFyZSB2ZXJpZmllZCAoc2hhMjU2KSBiZWZvcmUgYmVpbmcgd3JpdHRlbjsgYSBtaXNtYXRjaCBhYm9ydHNcbiAqICAgICB0aGUgcGxhbjtcbiAqICAgLSBlYWNoIGluZGV4IGVudHJ5IGlzIHJlY29yZGVkIG9ubHkgKmFmdGVyKiBpdHMgc3RvcmFnZSB3cml0ZSBzdWNjZWVkZWQsXG4gKiAgICAgc28gYSBtaWQtcGxhbiBmYWlsdXJlIGxlYXZlcyB0aGUgaW5kZXggZGVzY3JpYmluZyBleGFjdGx5IHRoZSBmaWxlc1xuICogICAgIHRoYXQgYWN0dWFsbHkgbGFuZGVkIChGUi01OiBub3RoaW5nIGlzIHNpbGVudGx5IGxvc3QgXHUyMDE0IHRoZSB1bnN5bmNlZFxuICogICAgIHB1bGxzIHNpbXBseSByZW1haW4gaW4gdGhlIHBsYW4gYW5kIGFyZSByZXRyaWVkIGJ5IHRoZSBjYWxsZXIpO1xuICogICAtIHRoZSBpbmRleCBpcyBwZXJzaXN0ZWQgdGhyb3VnaCB0aGUgYWRhcHRlcidzIGF0b21pYyBgd3JpdGVGaWxlYFxuICogICAgICh0ZW1wICsgcmVuYW1lIHBlciB0aGUgYWRhcHRlciBjb250cmFjdCkgYXRcbiAqICAgICBgLy52YXVsdHN5bmNmb3JhZ2VudHMvc3RhdGVgLCBpbmNsdWRpbmcgb24gdGhlIGZhaWx1cmUgcGF0aC5cbiAqXG4gKiBGb2xkZXIgbGlmZWN5Y2xlIChGUi0xMCBhbmQgaXRzIGRlbGV0aW9uIGNvdW50ZXJwYXJ0KTpcbiAqXG4gKiAgIC0gYXBwbHlpbmcgYSBSRU1PVEUgRk9MREVSIFRPTUJTVE9ORSByZW1vdmVzIHRoZSBsb2NhbCBkaXJlY3Rvcnkgd2hlblxuICogICAgIGl0IGV4aXN0cyBhbmQgaXMgZW1wdHkgKGFkYXB0ZXIgYHJlbW92ZURpcmApOyBub24tZW1wdHkgb3IgbWlzc2luZyBcdTIxRDJcbiAqICAgICByZWNvcmQgdGhlIHRvbWJzdG9uZSBvbmx5IFx1MjAxNCB0aGUgZGlyZWN0b3J5IGNvbnZlcmdlcyBsYXRlciwgYW5kIGFcbiAqICAgICBub24tZW1wdHkgZGlyZWN0b3J5IGlzIG5ldmVyIGRlbGV0ZWQ7XG4gKiAgIC0gUFJVTkUtT04tREVMRVRFOiBhcHBseWluZyBhIHJlbW90ZSBmaWxlIGRlbGV0aW9uIChvciByZW5hbWUgYXdheSlcbiAqICAgICByZW1vdmVzIHRoZSBkZWxldGVkIHBhdGgncyBwYXJlbnQgZGlyZWN0b3J5IHdoZW4gaXQgaXMgbm93IGVtcHR5IG9uXG4gKiAgICAgZGlzayBhbmQgaG9sZHMgbm8gbGl2ZSBmaWxlIGVudHJpZXMgaW4gdGhlIGluZGV4IFx1MjAxNCB0aGlzIGlzIHdoYXQgc3RvcHNcbiAqICAgICBhbiBlbXB0aWVkIGRpcmVjdG9yeSBmcm9tIHNlbGYtcmVzdXJyZWN0aW5nIGFzIGFuIGVtcHR5LWZvbGRlclxuICogICAgIHBsYWNlaG9sZGVyIG9uIHRoZSBuZXh0IHNjYW4uIEV4YWN0bHkgT05FIGxldmVsIHBlciBkZWxldGlvbjogdGhlXG4gKiAgICAgaW1tZWRpYXRlIHBhcmVudCBvbmx5LCBuZXZlciBhIGNhc2NhZGUgKGEgY2hhaW4gb2YgZW1wdGllZFxuICogICAgIGRpcmVjdG9yaWVzIGNvbnZlcmdlcyBvdmVyIHN1Y2Nlc3NpdmUgY3ljbGVzOyB0aGUgc2FmZXR5IGludmFyaWFudCBcdTIwMTRcbiAqICAgICBuZXZlciBkZWxldGUgYSBub24tZW1wdHkgZGlyZWN0b3J5LCBuZXZlciBsb3NlIHVzZXIgY29udGVudCBcdTIwMTQgaXNcbiAqICAgICBjaGVja2VkIGJlZm9yZSBldmVyeSByZW1vdmFsKS5cbiAqXG4gKiBQdXNoZXMvY29uZmxpY3RzL2ZvbGRlciBvcHMgYXJlIHRoZSBuZXR3b3JrIHBoYXNlJ3MgYnVzaW5lc3M7IHJldHJ5XG4gKiBxdWV1ZXMgYXJlIGV4cGxpY2l0bHkgb3V0IG9mIHNjb3BlIGhlcmUuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBTdG9yYWdlQWRhcHRlciB9IGZyb20gJy4vYWRhcHRlcnMuanMnO1xuaW1wb3J0IHsgc2hhMjU2SGV4IH0gZnJvbSAnLi9oYXNoaW5nLmpzJztcbmltcG9ydCB7XG4gIGFwcGx5Q29tbWl0LFxuICBkZXNlcmlhbGl6ZUxvY2FsU3RhdGUsXG4gIExPQ0FMX0lOREVYX1NUQVRFX1BBVEgsXG4gIHJlbW92ZUVudHJ5LFxuICBzZXJpYWxpemVMb2NhbEluZGV4LFxuICB0eXBlIERlc2VyaWFsaXplZExvY2FsU3RhdGUsXG4gIHR5cGUgTG9jYWxJbmRleCxcbiAgdHlwZSBQZXJzaXN0ZWRTeW5jU3RhdGUsXG59IGZyb20gJy4vbG9jYWxpbmRleC5qcyc7XG5pbXBvcnQgeyBpc1N0cmljdGx5QmVuZWF0aCwgcGFyZW50UGF0aCB9IGZyb20gJy4vcGF0aHMuanMnO1xuaW1wb3J0IHR5cGUgeyBQdWxsT3AsIFN5bmNQbGFuIH0gZnJvbSAnLi9yZXNvbHZlLmpzJztcblxuLyoqIEluamVjdGVkIGNvbnRlbnQgdHJhbnNwb3J0OiBmZXRjaCB0aGUgYmxvYiBmb3IgYSBjb250ZW50IGhhc2guICovXG5leHBvcnQgdHlwZSBGZXRjaEJsb2IgPSAoaGFzaDogc3RyaW5nKSA9PiBQcm9taXNlPFVpbnQ4QXJyYXk+O1xuXG5leHBvcnQgaW50ZXJmYWNlIEFwcGx5UHVsbE9wdGlvbnMge1xuICAvKiogRXBvY2ggbXMgdXNlZCBmb3IgdG9tYnN0b25lIHRpbWVzdGFtcHMuIERlZmF1bHQ6IGBEYXRlLm5vdygpYCBcdTIwMTQgdGhpc1xuICAgKiAgZnVuY3Rpb24gaXMgSS9PIG9yY2hlc3RyYXRpb24sIG5vdCBhIHB1cmUgZnVuY3Rpb24sIGJ1dCB0ZXN0cyBpbmplY3RcbiAgICogIGEgZml4ZWQgdmFsdWUgZm9yIGRldGVybWluaXNtLiAqL1xuICBub3c/OiBudW1iZXI7XG4gIC8qKlxuICAgKiBCdWxrLXB1bGwgcHJvZ3Jlc3M6IGNhbGxlZCBvbmNlIHdpdGggKDAsIHRvdGFsKSB1cCBmcm9udCBhbmQgb25jZSBhZnRlclxuICAgKiBlYWNoIHB1bGwgbWF0ZXJpYWxpemVzLiBQdXJlIHJlcG9ydGluZyBcdTIwMTQgbmV2ZXIgYWZmZWN0cyBhcHBsaWNhdGlvbi5cbiAgICovXG4gIG9uUHJvZ3Jlc3M/OiAoZG9uZTogbnVtYmVyLCB0b3RhbDogbnVtYmVyKSA9PiB2b2lkO1xuICAvKipcbiAgICogU3luYy1jdXJzb3IgYm9va2tlZXBpbmcgdG8gd3JpdGUgaW50byB0aGUgc3RhdGUgZmlsZSdzIGVudmVsb3BlIHdoZW5ldmVyXG4gICAqIHRoaXMgY2FsbCBwZXJzaXN0cyB0aGUgaW5kZXguIFdpdGhvdXQgaXQgYSBwdWxsLXNpZGUgcGVyc2lzdCB3b3VsZCBzdHJpcFxuICAgKiB0aGUgY2xpZW50J3MgY3Vyc29yL3N5bmNlZFRocm91Z2ggZmllbGRzIGZyb20gYC8udmF1bHRzeW5jZm9yYWdlbnRzL3N0YXRlYFxuICAgKiAodGhlIGVudmVsb3BlIGlzIHJld3JpdHRlbiB3aG9sZXNhbGUpLiBUaGUgY2xpZW50IHBhc3NlcyBpdHMgY3VycmVudFxuICAgKiB2YWx1ZXM7IGEgc25hcHNob3QgYSBtb21lbnQgc3RhbGUgaXMgaGFybWxlc3MgXHUyMDE0IHRoZSBuZXh0IHBlcnNpc3QgcmVmcmVzaGVzXG4gICAqIGl0LCBhbmQgYW4gdW5kZXItcmVwb3J0ZWQgY3Vyc29yIG9ubHkgd2lkZW5zIHRoZSBuZXh0IHJlcGxheS5cbiAgICovXG4gIHBlcnNpc3RlZFN0YXRlPzogUGVyc2lzdGVkU3luY1N0YXRlO1xufVxuXG4vKipcbiAqIEFwcGx5IGFsbCBwdWxscyBvZiBgcGxhbmAgYW5kIHJldHVybiB0aGUgdXBkYXRlZCBpbmRleCAoYWxzbyBwZXJzaXN0ZWQgdG9cbiAqIHRoZSBhZGFwdGVyIGF0IGBMT0NBTF9JTkRFWF9TVEFURV9QQVRIYCkuXG4gKlxuICogU3RvcmFnZSB3cml0ZXMgaGFwcGVuIGluIHBsYW4gb3JkZXIuIElmIGFueSBvcCBmYWlscywgdGhlIGluZGV4IHJlZmxlY3RpbmdcbiAqIGV2ZXJ5IG9wIHRoYXQgc3VjY2VlZGVkIHNvIGZhciBpcyBwZXJzaXN0ZWQgYW5kIHRoZSBvcmlnaW5hbCBlcnJvciBpc1xuICogcmV0aHJvd24gXHUyMDE0IHBhdGhzIHRoYXQgZmFpbGVkIGFyZSBhYnNlbnQgZnJvbSB0aGUgcmV0dXJuZWQvcGVyc2lzdGVkIGluZGV4LlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gYXBwbHlQdWxsKFxuICBzdG9yYWdlOiBTdG9yYWdlQWRhcHRlcixcbiAgaW5kZXg6IExvY2FsSW5kZXgsXG4gIHBsYW46IFN5bmNQbGFuLFxuICBmZXRjaEJsb2I6IEZldGNoQmxvYixcbiAgb3B0aW9uczogQXBwbHlQdWxsT3B0aW9ucyA9IHt9LFxuKTogUHJvbWlzZTxMb2NhbEluZGV4PiB7XG4gIGNvbnN0IG5vdyA9IG9wdGlvbnMubm93ID8/IERhdGUubm93KCk7XG4gIGNvbnN0IG9uUHJvZ3Jlc3MgPSBvcHRpb25zLm9uUHJvZ3Jlc3M7XG4gIGxldCB3b3JraW5nOiBMb2NhbEluZGV4ID0gaW5kZXg7XG5cbiAgb25Qcm9ncmVzcz8uKDAsIHBsYW4ucHVsbHMubGVuZ3RoKTtcbiAgbGV0IGRvbmUgPSAwO1xuICB0cnkge1xuICAgIGZvciAoY29uc3QgcHVsbCBvZiBwbGFuLnB1bGxzKSB7XG4gICAgICB3b3JraW5nID0gYXdhaXQgYXBwbHlPbmVQdWxsKHN0b3JhZ2UsIHdvcmtpbmcsIHB1bGwsIGZldGNoQmxvYiwgbm93KTtcbiAgICAgIGRvbmUgKz0gMTtcbiAgICAgIG9uUHJvZ3Jlc3M/Lihkb25lLCBwbGFuLnB1bGxzLmxlbmd0aCk7XG4gICAgfVxuICB9IGNhdGNoIChlcnJvcikge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCBwZXJzaXN0SW5kZXgoc3RvcmFnZSwgd29ya2luZywgb3B0aW9ucy5wZXJzaXN0ZWRTdGF0ZSk7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBQZXJzaXN0ZW5jZSBmYWlsdXJlIG11c3Qgbm90IG1hc2sgdGhlIG9yaWdpbmFsIGVycm9yOyB0aGUgY2FsbGVyXG4gICAgICAvLyByZXRyaWVzIHRoZSB3aG9sZSBjeWNsZSBhbnl3YXkuXG4gICAgfVxuICAgIHRocm93IGVycm9yO1xuICB9XG5cbiAgYXdhaXQgcGVyc2lzdEluZGV4KHN0b3JhZ2UsIHdvcmtpbmcsIG9wdGlvbnMucGVyc2lzdGVkU3RhdGUpO1xuICByZXR1cm4gd29ya2luZztcbn1cblxuYXN5bmMgZnVuY3Rpb24gYXBwbHlPbmVQdWxsKFxuICBzdG9yYWdlOiBTdG9yYWdlQWRhcHRlcixcbiAgaW5kZXg6IExvY2FsSW5kZXgsXG4gIHB1bGw6IFB1bGxPcCxcbiAgZmV0Y2hCbG9iOiBGZXRjaEJsb2IsXG4gIG5vdzogbnVtYmVyLFxuKTogUHJvbWlzZTxMb2NhbEluZGV4PiB7XG4gIGlmIChwdWxsLmtpbmQgPT09ICdyZW5hbWUnKSB7XG4gICAgaWYgKGF3YWl0IHN0b3JhZ2UuZXhpc3RzKHB1bGwuZnJvbVBhdGgpKSB7XG4gICAgICBhd2FpdCBzdG9yYWdlLnJlbmFtZUZpbGUocHVsbC5mcm9tUGF0aCwgcHVsbC50b1BhdGgpO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBPbGQgcGF0aCBuZXZlciBtYXRlcmlhbGl6ZWQgaGVyZSAob3IgYWxyZWFkeSBtb3ZlZCk6IGZldGNoIGNvbnRlbnQuXG4gICAgICBhd2FpdCBmZXRjaFZlcmlmaWVkKHN0b3JhZ2UsIHB1bGwudG9QYXRoLCBwdWxsLmhhc2gsIGZldGNoQmxvYik7XG4gICAgfVxuICAgIGNvbnN0IG1vdmVkID0gYXBwbHlDb21taXQocmVtb3ZlRW50cnkoaW5kZXgsIHB1bGwuZnJvbVBhdGgpLCB7XG4gICAgICBwYXRoOiBwdWxsLnRvUGF0aCxcbiAgICAgIHZlcnNpb25JZDogcHVsbC52ZXJzaW9uLFxuICAgICAgaGFzaDogcHVsbC5oYXNoLFxuICAgICAgc2l6ZTogcHVsbC5zaXplLFxuICAgICAgY2xvY2s6IHB1bGwuY2xvY2ssXG4gICAgfSk7XG4gICAgLy8gVGhlIGxhc3QgZmlsZSBtYXkganVzdCBoYXZlIGxlZnQgaXRzIG9sZCBwYXJlbnQgZGlyZWN0b3J5IChwcnVuZS1vbi1cbiAgICAvLyBkZWxldGUgYXBwbGllcyB0byBtb3ZlcyB0b287IHRoZSByZW5hbWUgaXRzZWxmIGlzIHVudG91Y2hlZCkuXG4gICAgYXdhaXQgcHJ1bmVQYXJlbnRPbkRlbGV0ZShzdG9yYWdlLCBtb3ZlZCwgcHVsbC5mcm9tUGF0aCk7XG4gICAgcmV0dXJuIG1vdmVkO1xuICB9XG5cbiAgaWYgKHB1bGwuaXNGb2xkZXIpIHtcbiAgICAvLyBGb2xkZXIgcGxhY2Vob2xkZXJzIChGUi0xMCk6IGNyZWF0ZSB0aGUgZGlyZWN0b3J5LCByZWNvcmQgdGhlIGVudHJ5LlxuICAgIC8vIEEgZm9sZGVyIFRPTUJTVE9ORSBhZGRpdGlvbmFsbHkgcmVtb3ZlcyB0aGUgbG9jYWwgZGlyZWN0b3J5IHdoZW4gaXRcbiAgICAvLyBleGlzdHMgYW5kIGlzIGVtcHR5OyBub24tZW1wdHkgb3IgbWlzc2luZyBcdTIxRDIgcmVjb3JkIG9ubHkgKGNvbnZlcmdlc1xuICAgIC8vIGxhdGVyIFx1MjAxNCBhIG5vbi1lbXB0eSBkaXJlY3RvcnkgaXMgbmV2ZXIgZGVsZXRlZCBoZXJlKS5cbiAgICBpZiAocHVsbC5kZWxldGVkKSB7XG4gICAgICBhd2FpdCByZW1vdmVEaXJJZlZhY2FudChzdG9yYWdlLCBpbmRleCwgcHVsbC5wYXRoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgYXdhaXQgc3RvcmFnZS5lbnN1cmVEaXIocHVsbC5wYXRoKTtcbiAgICB9XG4gICAgcmV0dXJuIGFwcGx5Q29tbWl0KGluZGV4LCB7XG4gICAgICBwYXRoOiBwdWxsLnBhdGgsXG4gICAgICB2ZXJzaW9uSWQ6IHB1bGwudmVyc2lvbixcbiAgICAgIGhhc2g6IHB1bGwuaGFzaCxcbiAgICAgIHNpemU6IHB1bGwuc2l6ZSxcbiAgICAgIGNsb2NrOiBwdWxsLmNsb2NrLFxuICAgICAgZGVsZXRlZDogcHVsbC5kZWxldGVkLFxuICAgICAgZGVsZXRlZEF0OiBwdWxsLmRlbGV0ZWQgPyBub3cgOiB1bmRlZmluZWQsXG4gICAgICBpc0ZvbGRlcjogdHJ1ZSxcbiAgICB9KTtcbiAgfVxuXG4gIGlmIChwdWxsLmRlbGV0ZWQpIHtcbiAgICAvLyBJZGVtcG90ZW50IHBlciB0aGUgYWRhcHRlciBjb250cmFjdDsgYSBsb2NhbCAudHJhc2ggY29weSBpcyBhXG4gICAgLy8gcGxhdGZvcm0tbGF5ZXIgY29uY2VybiAoZGFlbW9uL3BsdWdpbiksIG5vdCBlbmdpbmUgbG9naWMuXG4gICAgYXdhaXQgc3RvcmFnZS5kZWxldGVGaWxlKHB1bGwucGF0aCk7XG4gICAgY29uc3QgdG9tYnN0b25lZCA9IGFwcGx5Q29tbWl0KGluZGV4LCB7XG4gICAgICBwYXRoOiBwdWxsLnBhdGgsXG4gICAgICB2ZXJzaW9uSWQ6IHB1bGwudmVyc2lvbixcbiAgICAgIGhhc2g6IHB1bGwuaGFzaCxcbiAgICAgIHNpemU6IHB1bGwuc2l6ZSxcbiAgICAgIGNsb2NrOiBwdWxsLmNsb2NrLFxuICAgICAgZGVsZXRlZDogdHJ1ZSxcbiAgICAgIGRlbGV0ZWRBdDogbm93LFxuICAgIH0pO1xuICAgIC8vIFBydW5lLW9uLWRlbGV0ZTogYW4gZW1wdGllZCBwYXJlbnQgZGlyZWN0b3J5IG11c3Qgbm90IGxpbmdlciBhbmRcbiAgICAvLyByZS1zdXJmYWNlIGFzIGFuIGVtcHR5LWZvbGRlciBwbGFjZWhvbGRlciBvbiB0aGUgbmV4dCBzY2FuLlxuICAgIGF3YWl0IHBydW5lUGFyZW50T25EZWxldGUoc3RvcmFnZSwgdG9tYnN0b25lZCwgcHVsbC5wYXRoKTtcbiAgICByZXR1cm4gdG9tYnN0b25lZDtcbiAgfVxuXG4gIGNvbnN0IGN1cnJlbnQgPSBpbmRleFtwdWxsLnBhdGhdO1xuICBpZiAoXG4gICAgY3VycmVudCAhPT0gdW5kZWZpbmVkICYmXG4gICAgY3VycmVudC5kZWxldGVkQXQgPT09IHVuZGVmaW5lZCAmJlxuICAgIGN1cnJlbnQuaGFzaCA9PT0gcHVsbC5oYXNoICYmXG4gICAgKGF3YWl0IHN0b3JhZ2UuZXhpc3RzKHB1bGwucGF0aCkpXG4gICkge1xuICAgIC8vIENvbnRlbnQgYWxyZWFkeSBjb3JyZWN0IGxvY2FsbHkgKGUuZy4gdmVyc2lvbi1pZCBjYXRjaC11cCBhZnRlciBhXG4gICAgLy8gcmVuYW1lIGVsc2V3aGVyZSk6IHJlY29yZCB0aGUgYXV0aG9yaXRhdGl2ZSBoZWFkLCBza2lwIGZldGNoK3dyaXRlLlxuICAgIC8vIFRoZSBleGlzdGVuY2UgY2hlY2sgbWF0dGVycyB3aGVuIHRoZSBmaWxlIHdhcyBkZWxldGVkIGxvY2FsbHkgc2luY2UgdGhlXG4gICAgLy8gaW5kZXggd2FzIGxhc3Qgd3JpdHRlbiBcdTIwMTQgcmVjcmVhdGluZyBpdCBpcyB3aGF0IHRoZSBwdWxsIGRlbWFuZHMuXG4gICAgcmV0dXJuIGFwcGx5Q29tbWl0KGluZGV4LCB7XG4gICAgICBwYXRoOiBwdWxsLnBhdGgsXG4gICAgICB2ZXJzaW9uSWQ6IHB1bGwudmVyc2lvbixcbiAgICAgIGhhc2g6IHB1bGwuaGFzaCxcbiAgICAgIHNpemU6IHB1bGwuc2l6ZSxcbiAgICAgIGNsb2NrOiBwdWxsLmNsb2NrLFxuICAgIH0pO1xuICB9XG5cbiAgYXdhaXQgZmV0Y2hWZXJpZmllZChzdG9yYWdlLCBwdWxsLnBhdGgsIHB1bGwuaGFzaCwgZmV0Y2hCbG9iKTtcbiAgcmV0dXJuIGFwcGx5Q29tbWl0KGluZGV4LCB7XG4gICAgcGF0aDogcHVsbC5wYXRoLFxuICAgIHZlcnNpb25JZDogcHVsbC52ZXJzaW9uLFxuICAgIGhhc2g6IHB1bGwuaGFzaCxcbiAgICBzaXplOiBwdWxsLnNpemUsXG4gICAgY2xvY2s6IHB1bGwuY2xvY2ssXG4gIH0pO1xufVxuXG4vLyAtLS0gZm9sZGVyIGxpZmVjeWNsZSBoZWxwZXJzIChCOiB0b21ic3RvbmUtYXBwbHksIEM6IHBydW5lLW9uLWRlbGV0ZSkgLS0tLS0tLS1cblxuLyoqIE91dGNvbWUgb2YgYSBwcnVuZSBhdHRlbXB0OiB0aGUgZGlyZWN0b3J5IGp1ZGdlZCBkZWxldGFibGUsIGFuZCB3aGV0aGVyIGl0IHdhcy4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUHJ1bmVkRGlyIHtcbiAgLyoqIFRoZSBkaXJlY3RvcnkgdGhhdCBxdWFsaWZpZWQgZm9yIHJlbW92YWwgKHRoZSBkZWxldGVkIHBhdGgncyBwYXJlbnQpLiAqL1xuICBkaXI6IHN0cmluZztcbiAgLyoqIFdoZXRoZXIgYHN0b3JhZ2UucmVtb3ZlRGlyYCBhY3R1YWxseSByZW1vdmVkIGl0IChmYWxzZSB3aGVuIHRoZSBhZGFwdGVyXG4gICAqICBsYWNrcyB0aGUgaG9vayBvciByZWZ1c2VkIFx1MjAxNCBlbGlnaWJpbGl0eSBhbG9uZSBzdGlsbCBzdXBwcmVzc2VzIGFcbiAgICogIHBsYWNlaG9sZGVyIHB1c2ggZm9yIGl0LCBgY2xpZW50LnRzYCkuICovXG4gIHJlbW92ZWQ6IGJvb2xlYW47XG59XG5cbi8qKlxuICogV2hldGhlciBgZGlyYCBtYXkgYmUgZGVsZXRlZCB3aXRob3V0IGxvc2luZyBhbnl0aGluZzogaXQgZXhpc3RzLCBub3RoaW5nXG4gKiAoZmlsZSBvciBkaXJlY3RvcnkpIGxpdmVzIGJlbmVhdGggaXQgaW4gc3RvcmFnZSwgYW5kIHRoZSBpbmRleCBob2xkcyBub1xuICogbGl2ZSBmaWxlIGVudHJ5IGJlbmVhdGggaXQuIFRoZSByb290IGlzIG5ldmVyIGRlbGV0YWJsZS4gVGhpcyBpcyB0aGVcbiAqIG5ldmVyLWRlbGV0ZS1ub24tZW1wdHkgLyBuZXZlci1sb3NlLWNvbnRlbnQgaW52YXJpYW50IG1hZGUgZXhwbGljaXQgXHUyMDE0XG4gKiBldmVyeSBkaXJlY3RvcnkgcmVtb3ZhbCBpbiBjb3JlIGdvZXMgdGhyb3VnaCBpdC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gZGlySXNWYWNhbnQoXG4gIHN0b3JhZ2U6IFN0b3JhZ2VBZGFwdGVyLFxuICBpbmRleDogTG9jYWxJbmRleCxcbiAgZGlyOiBzdHJpbmcsXG4pOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgaWYgKGRpciA9PT0gJy8nKSByZXR1cm4gZmFsc2U7XG4gIGlmICghKGF3YWl0IHN0b3JhZ2UuZXhpc3RzKGRpcikpKSByZXR1cm4gZmFsc2U7XG4gIGZvciAoY29uc3QgZmlsZSBvZiBhd2FpdCBzdG9yYWdlLmxpc3RGaWxlcygpKSB7XG4gICAgaWYgKGlzU3RyaWN0bHlCZW5lYXRoKGZpbGUucGF0aCwgZGlyKSkgcmV0dXJuIGZhbHNlO1xuICB9XG4gIGZvciAoY29uc3QgY2hpbGQgb2YgYXdhaXQgc3RvcmFnZS5saXN0RGlycygpKSB7XG4gICAgaWYgKGlzU3RyaWN0bHlCZW5lYXRoKGNoaWxkLCBkaXIpKSByZXR1cm4gZmFsc2U7XG4gIH1cbiAgZm9yIChjb25zdCBbcGF0aCwgZW50cnldIG9mIE9iamVjdC5lbnRyaWVzKGluZGV4KSkge1xuICAgIGlmIChlbnRyeS5pc0ZvbGRlciB8fCBlbnRyeS5kZWxldGVkQXQgIT09IHVuZGVmaW5lZCkgY29udGludWU7XG4gICAgaWYgKGlzU3RyaWN0bHlCZW5lYXRoKHBhdGgsIGRpcikpIHJldHVybiBmYWxzZTtcbiAgfVxuICByZXR1cm4gdHJ1ZTtcbn1cblxuLyoqIFJlbW92ZSBgZGlyYCB0aHJvdWdoIHRoZSBhZGFwdGVyIHdoZW4gaXQgaXMgdmFjYW50LiBNaXNzaW5nL25vbi1lbXB0eS91bnN1cHBvcnRlZCBcdTIxRDIgZmFsc2UuICovXG5hc3luYyBmdW5jdGlvbiByZW1vdmVEaXJJZlZhY2FudChcbiAgc3RvcmFnZTogU3RvcmFnZUFkYXB0ZXIsXG4gIGluZGV4OiBMb2NhbEluZGV4LFxuICBkaXI6IHN0cmluZyxcbik6IFByb21pc2U8Ym9vbGVhbj4ge1xuICBpZiAoIShhd2FpdCBkaXJJc1ZhY2FudChzdG9yYWdlLCBpbmRleCwgZGlyKSkpIHJldHVybiBmYWxzZTtcbiAgcmV0dXJuIHJlbW92ZVZhY2FudERpcihzdG9yYWdlLCBkaXIpO1xufVxuXG5hc3luYyBmdW5jdGlvbiByZW1vdmVWYWNhbnREaXIoc3RvcmFnZTogU3RvcmFnZUFkYXB0ZXIsIGRpcjogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XG4gIGlmIChzdG9yYWdlLnJlbW92ZURpciA9PT0gdW5kZWZpbmVkKSByZXR1cm4gZmFsc2U7IC8vIHByZS1ob29rIGFkYXB0ZXJzOiByZWNvcmQtb25seVxuICB0cnkge1xuICAgIGF3YWl0IHN0b3JhZ2UucmVtb3ZlRGlyKGRpcik7XG4gICAgcmV0dXJuIHRydWU7XG4gIH0gY2F0Y2gge1xuICAgIC8vIEEgcmVmdXNlZCBvciByYWNlZCByZW1vdmFsIGlzIHJlY29yZC1vbmx5LCBuZXZlciBmYXRhbCBhbmQgbmV2ZXIgZGF0YVxuICAgIC8vIGxvc3MgXHUyMDE0IHRoZSB0b21ic3RvbmUgaXMgc3RpbGwgcmVjb3JkZWQgYW5kIHN0YXRlIGNvbnZlcmdlcyBsYXRlci5cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuLyoqXG4gKiBQcnVuZS1vbi1kZWxldGUgKEMpOiBhZnRlciBgZGVsZXRlZFBhdGhgIHdhcyBkZWxldGVkIChvciByZW5hbWVkIGF3YXkpLFxuICogcmVtb3ZlIGl0cyBpbW1lZGlhdGUgcGFyZW50IGRpcmVjdG9yeSB3aGVuIGl0IGlzIG5vdyBlbXB0eSBvbiBkaXNrIGFuZFxuICogdW5yZXByZXNlbnRlZCBieSBsaXZlIGluZGV4IGVudHJpZXMgXHUyMDE0IGV4YWN0bHkgT05FIGxldmVsLCBubyBjYXNjYWRlLlxuICpcbiAqIFJldHVybnMgdGhlIGBQcnVuZWREaXJgIHdoZW4gdGhlIHBhcmVudCBRVUFMSUZJRUQgZm9yIHJlbW92YWwgKHdoZXRoZXIgb3JcbiAqIG5vdCB0aGUgYWRhcHRlciBjb3VsZCBwZXJmb3JtIGl0IFx1MjAxNCBjYWxsZXJzIHVzZSBlbGlnaWJpbGl0eSB0byBzdXBwcmVzcyBhblxuICogZW1wdHktZm9sZGVyIHBsYWNlaG9sZGVyIHB1c2ggZm9yIHRoYXQgZGlyZWN0b3J5KSwgYHVuZGVmaW5lZGAgd2hlbiB0aGVcbiAqIHBhcmVudCB3YXMgbm90IGRlbGV0YWJsZSAobm9uLWVtcHR5LCBob2xkcyBsaXZlIGVudHJpZXMsIG1pc3NpbmcsIG9yIHJvb3QpLlxuICogUHVyZSB3aXRoIHJlc3BlY3QgdG8gdGhlIGluZGV4OiBuZXZlciBtdXRhdGVzIGl0LlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcHJ1bmVQYXJlbnRPbkRlbGV0ZShcbiAgc3RvcmFnZTogU3RvcmFnZUFkYXB0ZXIsXG4gIGluZGV4OiBMb2NhbEluZGV4LFxuICBkZWxldGVkUGF0aDogc3RyaW5nLFxuKTogUHJvbWlzZTxQcnVuZWREaXIgfCB1bmRlZmluZWQ+IHtcbiAgY29uc3QgZGlyID0gcGFyZW50UGF0aChkZWxldGVkUGF0aCk7XG4gIGlmICghKGF3YWl0IGRpcklzVmFjYW50KHN0b3JhZ2UsIGluZGV4LCBkaXIpKSkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgcmV0dXJuIHsgZGlyLCByZW1vdmVkOiBhd2FpdCByZW1vdmVWYWNhbnREaXIoc3RvcmFnZSwgZGlyKSB9O1xufVxuXG4vKiogRG93bmxvYWQsIHZlcmlmeSwgYW5kIHdyaXRlIG9uZSBibG9iLiBBIGhhc2ggbWlzbWF0Y2ggYWJvcnRzIHRoZSBwbGFuLiAqL1xuYXN5bmMgZnVuY3Rpb24gZmV0Y2hWZXJpZmllZChcbiAgc3RvcmFnZTogU3RvcmFnZUFkYXB0ZXIsXG4gIHBhdGg6IHN0cmluZyxcbiAgaGFzaDogc3RyaW5nLFxuICBmZXRjaEJsb2I6IEZldGNoQmxvYixcbik6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCBieXRlcyA9IGF3YWl0IGZldGNoQmxvYihoYXNoKTtcbiAgY29uc3QgYWN0dWFsID0gYXdhaXQgc2hhMjU2SGV4KGJ5dGVzKTtcbiAgaWYgKGFjdHVhbCAhPT0gaGFzaCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIGBCbG9iIGhhc2ggbWlzbWF0Y2ggZm9yICR7SlNPTi5zdHJpbmdpZnkocGF0aCl9OiBleHBlY3RlZCAke2hhc2h9LCBnb3QgJHthY3R1YWx9YCxcbiAgICApO1xuICB9XG4gIGF3YWl0IHN0b3JhZ2Uud3JpdGVGaWxlKHBhdGgsIGJ5dGVzKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcGVyc2lzdEluZGV4KFxuICBzdG9yYWdlOiBTdG9yYWdlQWRhcHRlcixcbiAgaW5kZXg6IExvY2FsSW5kZXgsXG4gIHN0YXRlOiBQZXJzaXN0ZWRTeW5jU3RhdGUgPSB7fSxcbik6IFByb21pc2U8dm9pZD4ge1xuICBhd2FpdCBzdG9yYWdlLndyaXRlRmlsZShcbiAgICBMT0NBTF9JTkRFWF9TVEFURV9QQVRILFxuICAgIG5ldyBUZXh0RW5jb2RlcigpLmVuY29kZShzZXJpYWxpemVMb2NhbEluZGV4KGluZGV4LCBzdGF0ZSkpLFxuICApO1xufVxuXG4vKipcbiAqIExvYWQgdGhlIHBlcnNpc3RlZCBpbmRleCBBTkQgaXRzIHN5bmMtY3Vyc29yIGJvb2trZWVwaW5nICh0aGUgY2xpZW50J3NcbiAqIHN0YXJ0dXAgcGF0aCBcdTIwMTQgdGhlIGN1cnNvciBwb3dlcnMgZGVsdGEtbWFuaWZlc3QgcmVjb25uZWN0cykuIFRocm93c1xuICogYFByb3RvY29sRXJyb3JgICh2aWEgYGRlc2VyaWFsaXplTG9jYWxTdGF0ZWApIG9uIGNvcnJ1cHQgb3IgZnV0dXJlLXNjaGVtYVxuICogc3RhdGUgXHUyMDE0IGNhbGxlcnMgc3VyZmFjZSB0aGF0IGluc3RlYWQgb2Ygc2lsZW50bHkgcmUtc3luY2luZyBmcm9tIHNjcmF0Y2guXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBsb2FkTG9jYWxTdGF0ZShzdG9yYWdlOiBTdG9yYWdlQWRhcHRlcik6IFByb21pc2U8RGVzZXJpYWxpemVkTG9jYWxTdGF0ZT4ge1xuICBjb25zdCBieXRlcyA9IGF3YWl0IHN0b3JhZ2UucmVhZEZpbGUoTE9DQUxfSU5ERVhfU1RBVEVfUEFUSCk7XG4gIHJldHVybiBkZXNlcmlhbGl6ZUxvY2FsU3RhdGUobmV3IFRleHREZWNvZGVyKCkuZGVjb2RlKGJ5dGVzKSk7XG59XG5cbi8qKlxuICogTG9hZCB0aGUgcGVyc2lzdGVkIGluZGV4IChBUkNISVRFQ1RVUkUgXHUwMEE3OCBzdGVwIDEpLiBUaHJvd3NcbiAqIGBQcm90b2NvbEVycm9yYCAodmlhIGBkZXNlcmlhbGl6ZUxvY2FsSW5kZXhgKSBvbiBjb3JydXB0IG9yIGZ1dHVyZS1zY2hlbWFcbiAqIHN0YXRlIFx1MjAxNCBjYWxsZXJzIHN1cmZhY2UgdGhhdCBpbnN0ZWFkIG9mIHNpbGVudGx5IHJlLXN5bmNpbmcgZnJvbSBzY3JhdGNoLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbG9hZExvY2FsSW5kZXgoc3RvcmFnZTogU3RvcmFnZUFkYXB0ZXIpOiBQcm9taXNlPExvY2FsSW5kZXg+IHtcbiAgcmV0dXJuIChhd2FpdCBsb2FkTG9jYWxTdGF0ZShzdG9yYWdlKSkuaW5kZXg7XG59XG4iLCAiLyoqXG4gKiBWYXVsdCBpZ25vcmUgcnVsZXMgKEFSQ0hJVEVDVFVSRS5tZCBcdTAwQTc0LCBGUi0xMS9GUi00MikgXHUyMDE0IHNoYXJlZCBieSBldmVyeVxuICogY2xpZW50IHNvIGxvY2FsIHNjYW5zLCB3YXRjaGVycywgYW5kIGNvbW1pdCBwYXRocyBhZ3JlZSBieXRlLWZvci1ieXRlLlxuICpcbiAqIE1hdGNoaW5nIGlzIHNlZ21lbnQtYmFzZWQgYW5kIGNhc2UtaW5zZW5zaXRpdmUgKHRoZSBvd25lcidzIHByaW1hcnlcbiAqIHBsYXRmb3JtcyBcdTIwMTQgV2luZG93cywgbWFjT1MgXHUyMDE0IGhhdmUgY2FzZS1pbnNlbnNpdGl2ZSBmaWxlc3lzdGVtcywgc29cbiAqIGAuVHJhc2gvZm9vLm1kYCBtdXN0IG5vdCBzbmVhayBwYXN0IHRoZSBgLnRyYXNoL2AgcnVsZSkuXG4gKi9cblxuaW1wb3J0IHsgbm9ybWFsaXplVmF1bHRQYXRoIH0gZnJvbSAnLi9wYXRocy5qcyc7XG5cbi8qKiBTZXR0aW5ncyBzdWJzZXQgYGlzSWdub3JlZGAgbmVlZHM7IGBWYXVsdFNldHRpbmdzYCBzYXRpc2ZpZXMgaXQuICovXG5leHBvcnQgaW50ZXJmYWNlIElnbm9yZVNldHRpbmdzIHtcbiAgb2JzaWRpYW5TeW5jOiBib29sZWFuO1xuICAvKipcbiAgICogVXNlci1kZWZpbmVkIGV4dHJhIGlnbm9yZSBwYXR0ZXJucyAoY2xpZW50LXNpZGUgb25seSkuIEdsb2ItbGl0ZSBzeW50YXg6XG4gICAqIGAqYCBtYXRjaGVzIHdpdGhpbiBvbmUgcGF0aCBzZWdtZW50LCBhIHdob2xlIGAqKmAgc2VnbWVudCBzcGFucyBhbnlcbiAgICogbnVtYmVyIG9mIHNlZ21lbnRzLCBtYXRjaGluZyBpcyBjYXNlLWluc2Vuc2l0aXZlLiBBIHBhdHRlcm4gY29udGFpbmluZ1xuICAgKiBgL2AgaXMgYW5jaG9yZWQgYXQgdGhlIHZhdWx0IHJvb3QgKGBwcml2YXRlLyoqYCk7IGEgYmFyZSBwYXR0ZXJuIHdpdGhvdXRcbiAgICogYC9gIG1hdGNoZXMgYSBmaWxlIE5BTUUgYXQgYW55IGRlcHRoIChgKi50bXBgKS4gRW1wdHkgbGluZXMgYXJlIGlnbm9yZWQuXG4gICAqL1xuICBleHRyYUlnbm9yZXM/OiByZWFkb25seSBzdHJpbmdbXTtcbn1cblxuLyoqIElnbm9yZWQgd2hlcmV2ZXIgdGhleSBhcHBlYXIsIGFzIGFueSBwYXRoIHNlZ21lbnQgKGRpciBvciBmaWxlIG5hbWUpLiAqL1xuY29uc3QgQUxXQVlTX0lHTk9SRURfU0VHTUVOVFM6IFJlYWRvbmx5U2V0PHN0cmluZz4gPSBuZXcgU2V0KFtcbiAgJy50cmFzaCcsIC8vIGxvY2FsIGRlbGV0ZS1yZWNvdmVyeSBkaXIgKEZSLTQyKVxuICAnLmRzX3N0b3JlJyxcbiAgJy52YXVsdHN5bmNmb3JhZ2VudHMnLCAvLyBjbGllbnQgc3RhdGUgZGlyIChsb2NhbCBpbmRleCkgaW5zaWRlIHRoZSB2YXVsdFxuICAndGh1bWJzLmRiJyxcbl0pO1xuXG4vKiogYC5vYnNpZGlhbi9gIGZpbGVzIGV4Y2x1ZGVkIGV2ZW4gd2hlbiBgLm9ic2lkaWFuL2Agc3luYyBpcyBvcHRlZCBpbi4gKi9cbmNvbnN0IE9CU0lESUFOX1ZPTEFUSUxFX0ZJTEVTOiBSZWFkb25seVNldDxzdHJpbmc+ID0gbmV3IFNldChbXG4gICcub2JzaWRpYW4vd29ya3NwYWNlLmpzb24nLFxuICAnLm9ic2lkaWFuL3dvcmtzcGFjZS1tb2JpbGUuanNvbicsXG5dKTtcblxuLyoqXG4gKiBXaGV0aGVyIGB2YXVsdFBhdGhgIG11c3QgYmUgZXhjbHVkZWQgZnJvbSBzeW5jLlxuICpcbiAqIEFsd2F5cyBpZ25vcmVkOiBgLnRyYXNoL2AsIGAuRFNfU3RvcmVgLCBgVGh1bWJzLmRiYCwgYC52YXVsdHN5bmNmb3JhZ2VudHMvYFxuICogKGFueSBkZXB0aCkuIGAub2JzaWRpYW4vYCBpcyBpZ25vcmVkIGVudGlyZWx5IHdoZW4gYHNldHRpbmdzLm9ic2lkaWFuU3luY2BcbiAqIGlzIGZhbHNlOyB3aGVuIHRydWUsIGV2ZXJ5dGhpbmcgdW5kZXIgaXQgc3luY3MgZXhjZXB0IGB3b3Jrc3BhY2UuanNvbmAsXG4gKiBgd29ya3NwYWNlLW1vYmlsZS5qc29uYCwgYW5kIGAub2JzaWRpYW4vY2FjaGUvYC4gRmluYWxseSwgZXZlcnkgcGF0dGVybiBpblxuICogYHNldHRpbmdzLmV4dHJhSWdub3Jlc2AgaXMgbWF0Y2hlZCAoZ2xvYi1saXRlIFx1MjAxNCBzZWUgYElnbm9yZVNldHRpbmdzYCkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0lnbm9yZWQodmF1bHRQYXRoOiBzdHJpbmcsIHNldHRpbmdzOiBJZ25vcmVTZXR0aW5ncyk6IGJvb2xlYW4ge1xuICBjb25zdCBub3JtYWxpemVkID0gbm9ybWFsaXplVmF1bHRQYXRoKHZhdWx0UGF0aCk7XG4gIGlmIChub3JtYWxpemVkID09PSAnLycpIHJldHVybiBmYWxzZTtcblxuICBjb25zdCBsb3dlciA9IG5vcm1hbGl6ZWQuc2xpY2UoMSkudG9Mb3dlckNhc2UoKTtcbiAgY29uc3Qgc2VnbWVudHMgPSBsb3dlci5zcGxpdCgnLycpO1xuXG4gIGlmIChzZWdtZW50cy5zb21lKChzZWdtZW50KSA9PiBBTFdBWVNfSUdOT1JFRF9TRUdNRU5UUy5oYXMoc2VnbWVudCkpKSB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICBpZiAoc2VnbWVudHNbMF0gPT09ICcub2JzaWRpYW4nKSB7XG4gICAgaWYgKCFzZXR0aW5ncy5vYnNpZGlhblN5bmMpIHJldHVybiB0cnVlO1xuICAgIGlmIChPQlNJRElBTl9WT0xBVElMRV9GSUxFUy5oYXMobG93ZXIpKSByZXR1cm4gdHJ1ZTtcbiAgICBpZiAoc2VnbWVudHNbMV0gPT09ICdjYWNoZScpIHJldHVybiB0cnVlOyAvLyB0aGUgZGlyIGl0c2VsZiBhbmQgYW55dGhpbmcgdW5kZXIgaXRcbiAgfVxuXG4gIGNvbnN0IGV4dHJhcyA9IHNldHRpbmdzLmV4dHJhSWdub3JlcztcbiAgaWYgKGV4dHJhcyAhPT0gdW5kZWZpbmVkICYmIGV4dHJhcy5sZW5ndGggPiAwKSB7XG4gICAgZm9yIChjb25zdCBwYXR0ZXJuIG9mIGV4dHJhcykge1xuICAgICAgY29uc3QgY29tcGlsZWQgPSBjb21waWxlRXh0cmFJZ25vcmUocGF0dGVybik7XG4gICAgICBpZiAoY29tcGlsZWQgIT09IG51bGwgJiYgbWF0Y2hlc1NlZ21lbnRzKGNvbXBpbGVkLCBzZWdtZW50cykpIHJldHVybiB0cnVlO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBmYWxzZTtcbn1cblxuLy8gLS0tIGV4dHJhIGlnbm9yZSBwYXR0ZXJucyAoZ2xvYi1saXRlKSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIEEgY29tcGlsZWQgZXh0cmEtaWdub3JlIHBhdHRlcm46IGxvd2VyY2FzZWQsIGAvYC1zcGxpdCBzZWdtZW50cy4gKi9cbnR5cGUgQ29tcGlsZWRQYXR0ZXJuID0geyBzZWdtZW50czogcmVhZG9ubHkgc3RyaW5nW107IGFuY2hvcmVkOiBib29sZWFuIH07XG5cbi8qKlxuICogTm9ybWFsaXplIG9uZSB1c2VyIHBhdHRlcm4gaW50byBtYXRjaGFibGUgc2VnbWVudHMuIFJldHVybnMgYG51bGxgIGZvclxuICogYmxhbmsgcGF0dGVybnMgKHRoZXkgY2FuIG5ldmVyIG1hdGNoIFx1MjAxNCBhbmQgbXVzdCBub3QgYmVjb21lIFwiaWdub3JlXG4gKiBldmVyeXRoaW5nXCIgYnkgYWNjaWRlbnQpLiBBIGxlYWRpbmcvdHJhaWxpbmcgYC9gIGlzIHRvbGVyYXRlZCBhbmQgc3RyaXBwZWQ7XG4gKiBgYW5jaG9yZWRgIHJlY29yZHMgd2hldGhlciB0aGUgcGF0dGVybiBuYW1lcyBhIHBhdGggKG1hdGNoZWQgZnJvbSB0aGVcbiAqIHZhdWx0IHJvb3QpIG9yIGEgYmFyZSBuYW1lIChtYXRjaGVkIGFnYWluc3QgYW55IHN1ZmZpeCBvZiB0aGUgcGF0aCkuXG4gKi9cbmZ1bmN0aW9uIGNvbXBpbGVFeHRyYUlnbm9yZShwYXR0ZXJuOiBzdHJpbmcpOiBDb21waWxlZFBhdHRlcm4gfCBudWxsIHtcbiAgbGV0IGNsZWFuZWQgPSBwYXR0ZXJuLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICB3aGlsZSAoY2xlYW5lZC5zdGFydHNXaXRoKCcvJykpIGNsZWFuZWQgPSBjbGVhbmVkLnNsaWNlKDEpO1xuICB3aGlsZSAoY2xlYW5lZC5lbmRzV2l0aCgnLycpKSBjbGVhbmVkID0gY2xlYW5lZC5zbGljZSgwLCAtMSk7XG4gIGlmIChjbGVhbmVkID09PSAnJykgcmV0dXJuIG51bGw7XG4gIHJldHVybiB7IHNlZ21lbnRzOiBjbGVhbmVkLnNwbGl0KCcvJyksIGFuY2hvcmVkOiBjbGVhbmVkLmluY2x1ZGVzKCcvJykgfTtcbn1cblxuLyoqIFBhdHRlcm4gdnMgcGF0aCBzZWdtZW50czsgYGFuY2hvcmVkYCBwYXR0ZXJucyBtYXkgYWxzbyBzdGFydCBkZWVwZXIuICovXG5mdW5jdGlvbiBtYXRjaGVzU2VnbWVudHMocGF0dGVybjogQ29tcGlsZWRQYXR0ZXJuLCBwYXRoOiByZWFkb25seSBzdHJpbmdbXSk6IGJvb2xlYW4ge1xuICBpZiAocGF0dGVybi5hbmNob3JlZCkge1xuICAgIHJldHVybiBzZWdtZW50c01hdGNoKHBhdHRlcm4uc2VnbWVudHMsIHBhdGgpO1xuICB9XG4gIC8vIEJhcmUgbmFtZSBwYXR0ZXJuOiBtYXRjaCBhbnkgdHJhaWxpbmcgc2VnbWVudCBydW4gKGAqLnRtcGAgYXQgYW55IGRlcHRoKS5cbiAgZm9yIChsZXQgc3RhcnQgPSAwOyBzdGFydCA8IHBhdGgubGVuZ3RoOyBzdGFydCsrKSB7XG4gICAgaWYgKHNlZ21lbnRzTWF0Y2gocGF0dGVybi5zZWdtZW50cywgcGF0aC5zbGljZShzdGFydCkpKSByZXR1cm4gdHJ1ZTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKiBHbG9iLWxpdGUgc2VnbWVudCBtYXRjaGluZzogYCpgIGluc2lkZSBhIHNlZ21lbnQsIGAqKmAgYXMgYSB3aG9sZSBzZWdtZW50LiAqL1xuZnVuY3Rpb24gc2VnbWVudHNNYXRjaChwYXR0ZXJuOiByZWFkb25seSBzdHJpbmdbXSwgcGF0aDogcmVhZG9ubHkgc3RyaW5nW10pOiBib29sZWFuIHtcbiAgaWYgKHBhdHRlcm4ubGVuZ3RoID09PSAwKSByZXR1cm4gcGF0aC5sZW5ndGggPT09IDA7XG4gIGNvbnN0IGhlYWQgPSBwYXR0ZXJuWzBdO1xuICBjb25zdCByZXN0ID0gcGF0dGVybi5zbGljZSgxKTtcbiAgaWYgKGhlYWQgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHBhdGgubGVuZ3RoID09PSAwO1xuICBpZiAoaGVhZCA9PT0gJyoqJykge1xuICAgIC8vIGAqKmAgY29uc3VtZXMgemVybyBvciBtb3JlIHBhdGggc2VnbWVudHMuXG4gICAgZm9yIChsZXQgc2tpcCA9IDA7IHNraXAgPD0gcGF0aC5sZW5ndGg7IHNraXArKykge1xuICAgICAgaWYgKHNlZ21lbnRzTWF0Y2gocmVzdCwgcGF0aC5zbGljZShza2lwKSkpIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgaWYgKHBhdGgubGVuZ3RoID09PSAwIHx8ICFzZWdtZW50TWF0Y2goaGVhZCwgcGF0aFswXSEpKSByZXR1cm4gZmFsc2U7XG4gIHJldHVybiBzZWdtZW50c01hdGNoKHJlc3QsIHBhdGguc2xpY2UoMSkpO1xufVxuXG4vKiogT25lIHNlZ21lbnQ6IGxpdGVyYWwgdGV4dCB3aXRoIGAqYCB3aWxkY2FyZHMgKGFueSBydW4gd2l0aGluIHRoZSBzZWdtZW50KS4gKi9cbmZ1bmN0aW9uIHNlZ21lbnRNYXRjaChwYXR0ZXJuOiBzdHJpbmcsIHNlZ21lbnQ6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBpZiAoIXBhdHRlcm4uaW5jbHVkZXMoJyonKSkgcmV0dXJuIHBhdHRlcm4gPT09IHNlZ21lbnQ7XG4gIGNvbnN0IGZpcnN0ID0gcGF0dGVybi5pbmRleE9mKCcqJyk7XG4gIGNvbnN0IGxhc3QgPSBwYXR0ZXJuLmxhc3RJbmRleE9mKCcqJyk7XG4gIGlmICghc2VnbWVudC5zdGFydHNXaXRoKHBhdHRlcm4uc2xpY2UoMCwgZmlyc3QpKSkgcmV0dXJuIGZhbHNlO1xuICBpZiAoIXNlZ21lbnQuZW5kc1dpdGgocGF0dGVybi5zbGljZShsYXN0ICsgMSkpKSByZXR1cm4gZmFsc2U7XG4gIGxldCBpbmRleCA9IGZpcnN0O1xuICBmb3IgKGNvbnN0IG1pZGRsZSBvZiBwYXR0ZXJuLnNsaWNlKGZpcnN0LCBsYXN0ICsgMSkuc3BsaXQoJyonKS5zbGljZSgxLCAtMSkpIHtcbiAgICBjb25zdCBmb3VuZCA9IHNlZ21lbnQuaW5kZXhPZihtaWRkbGUsIGluZGV4KTtcbiAgICBpZiAoZm91bmQgPT09IC0xKSByZXR1cm4gZmFsc2U7XG4gICAgaW5kZXggPSBmb3VuZCArIG1pZGRsZS5sZW5ndGg7XG4gIH1cbiAgcmV0dXJuIHRydWU7XG59XG4iLCAiLyoqXG4gKiBUeXBlZCBXZWJTb2NrZXQgbWVzc2FnZSBkZWZpbml0aW9ucyBmb3IgdGhlIGAvc3luY2AgY2hhbm5lbFxuICogKEFSQ0hJVEVDVFVSRS5tZCBcdTAwQTc1KS4gQWxsIG1lc3NhZ2VzIGFyZSBKU09OIHdpdGggYSBgdHlwZWAgZGlzY3JpbWluYW50LlxuICpcbiAqIFR3byBjaGFubmVscyBleGlzdDogdGhpcyBXUyBwcm90b2NvbCAobWV0YWRhdGEgKyBjaGFuZ2UgZmVlZCkgYW5kIHBsYWluXG4gKiBIVFRQUyBibG9iIHJvdXRlcyAoYEdFVC9QVVQgL2Jsb2IvOmhhc2hgKSBmb3IgY29udGVudCBcdTIwMTQgcmVmZXJlbmNlZCBoZXJlXG4gKiBvbmx5IHZpYSBjb250ZW50IGhhc2hlcy5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IExvZ2ljYWxDbG9jaywgVmVyc2lvbiwgVmVyc2lvbktpbmQsIFZhdWx0U2V0dGluZ3MgfSBmcm9tICcuL3R5cGVzLmpzJztcbmltcG9ydCB7IFByb3RvY29sRXJyb3IgfSBmcm9tICcuL2Vycm9ycy5qcyc7XG5cbi8qKiBXaXJlIHByb3RvY29sIHZlcnNpb24uIEJ1bXAgb24gYnJlYWtpbmcgbWVzc2FnZS1zaGFwZSBjaGFuZ2VzLiAqL1xuZXhwb3J0IGNvbnN0IFByb3RvY29sVmVyc2lvbiA9IDEgYXMgY29uc3Q7XG5cbi8qKiBDb21taXRzIGF0IG9yIGJlbG93IHRoaXMgc2l6ZSBtYXkgaW5saW5lIGNvbnRlbnQgKGJhc2U2NCkgb24gdGhlIFdTLiAqL1xuZXhwb3J0IGNvbnN0IElOTElORV9DT05URU5UX01BWF9CWVRFUyA9IDI1NiAqIDEwMjQ7XG5cbi8qKlxuICogT25lIGVudHJ5IG9mIHRoZSBtYW5pZmVzdCBtYXAgKGB7cGF0aCBcdTIxOTIgTWFuaWZlc3RFbnRyeX1gKS4gVGhlIGVudHJ5IGlzXG4gKiBzZWxmLWRlc2NyaWJpbmc6IGl0IGNhcnJpZXMgaXRzIG93biBgcGF0aGAgYW5kIHRoZSBoZWFkJ3MgYGNsb2NrYCBzbyB0aGVcbiAqIGNsaWVudC1zaWRlIHJlY29uY2lsaWF0aW9uIChgcmVzb2x2ZS50c2ApIGNhbiBvcmRlciByZW1vdGUgc3RhdGUgYWdhaW5zdFxuICogbG9jYWwgc3RhdGUgd2l0aG91dCBhbnkgZXh0cmEgcm91bmQtdHJpcHMuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgTWFuaWZlc3RFbnRyeSB7XG4gIC8qKiBOb3JtYWxpemVkIHZhdWx0IHBhdGggdGhpcyBlbnRyeSBkZXNjcmliZXMgKG1pcnJvcnMgdGhlIG1hcCBrZXkpLiAqL1xuICBwYXRoOiBzdHJpbmc7XG4gIC8qKiBWZXJzaW9uIGlkIG9mIHRoZSBlbnRyeSdzIGhlYWQuICovXG4gIHZlcnNpb246IHN0cmluZztcbiAgLyoqIHNoYTI1NiBoZXggb2YgY3VycmVudCBjb250ZW50IChgJydgIGZvciBmb2xkZXIgcGxhY2Vob2xkZXJzKS4gKi9cbiAgaGFzaDogc3RyaW5nO1xuICAvKiogQ29udGVudCBzaXplIGluIGJ5dGVzIChgMGAgZm9yIGZvbGRlciBwbGFjZWhvbGRlcnMpLiAqL1xuICBzaXplOiBudW1iZXI7XG4gIC8qKiBUb21ic3RvbmUgZmxhZy4gKi9cbiAgZGVsZXRlZDogYm9vbGVhbjtcbiAgLyoqIExvZ2ljYWwgY2xvY2sgb2YgdGhlIGhlYWQgXHUyMDE0IHRoZSBvcmRlcmluZyBhdXRob3JpdHkgKFx1MDBBNzQpLiAqL1xuICBjbG9jazogTG9naWNhbENsb2NrO1xuICAvKiogVHJ1ZSBmb3IgZW1wdHktZm9sZGVyIHBsYWNlaG9sZGVyIGVudHJpZXMgKEZSLTEwKS4gKi9cbiAgaXNGb2xkZXI/OiBib29sZWFuO1xuICAvKiogRXBvY2ggbXMgb2YgbGFzdCB1cGRhdGUsIGRpc3BsYXktb25seS4gKi9cbiAgbXRpbWU6IG51bWJlcjtcbn1cblxuLy8gLS0tIENsaWVudCBcdTIxOTIgU2VydmVyIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIEF1dGggKyBjYXRjaC11cDogdG9rZW4sIHByb3RvY29sIHZlcnNpb24sIGxhc3Qgc2VlbiBETyBzZXF1ZW5jZSBudW1iZXIuICovXG5leHBvcnQgaW50ZXJmYWNlIEhlbGxvTWVzc2FnZSB7XG4gIHR5cGU6ICdoZWxsbyc7XG4gIHRva2VuOiBzdHJpbmc7XG4gIHByb3RvY29sVmVyc2lvbjogbnVtYmVyO1xuICAvKiogTGFzdCBzZWVuIGdsb2JhbCBzZXF1ZW5jZSBudW1iZXI7IDAgZm9yIGEgZmlyc3QtZXZlciBjb25uZWN0LiAqL1xuICBjdXJzb3I6IG51bWJlcjtcbn1cblxuLyoqIFJlcXVlc3QgZnVsbCAoYHNpbmNlYCBvbWl0dGVkKSBvciBkZWx0YSBtYW5pZmVzdC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgR2V0TWFuaWZlc3RNZXNzYWdlIHtcbiAgdHlwZTogJ2dldE1hbmlmZXN0JztcbiAgc2luY2U/OiBudW1iZXI7XG59XG5cbi8qKlxuICogQ29tbWl0IGEgbmV3IHZlcnNpb24uIElmIGBpbmxpbmVgIGlzIHNldCBpdCBjYXJyaWVzIHRoZSBmdWxsIGNvbnRlbnRcbiAqIGJhc2U2NC1lbmNvZGVkIChvbmx5IGFsbG93ZWQgd2hlbiBgc2l6ZSA8PSBJTkxJTkVfQ09OVEVOVF9NQVhfQllURVNgKTtcbiAqIG90aGVyd2lzZSB0aGUgYmxvYiBtdXN0IGFscmVhZHkgYmUgdXBsb2FkZWQgKGBwdXRCbG9iYCBvbiB0aGlzIGNoYW5uZWwsXG4gKiBgUFVUIC9ibG9iLzpoYXNoYCBvbiB0aGUgcmVhbCB3b3JrZXIpLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIENvbW1pdE1lc3NhZ2Uge1xuICB0eXBlOiAnY29tbWl0JztcbiAgcGF0aDogc3RyaW5nO1xuICAvKiogVmVyc2lvbiBpZCB0aGUgY29tbWl0IGJ1aWxkcyBvbjsgc2VydmVyIGRldGVjdHMgZGl2ZXJnZW5jZSBcdTIxOTIgY29uZmxpY3QuICovXG4gIHBhcmVudFZlcnNpb246IHN0cmluZyB8IG51bGw7XG4gIGhhc2g6IHN0cmluZztcbiAgc2l6ZTogbnVtYmVyO1xuICAvKiogV2hhdCBraW5kIG9mIHZlcnNpb24gdGhpcyBjb21taXRzIChtaXJyb3JzIGBWZXJzaW9uLmtpbmRgKS4gKi9cbiAga2luZDogVmVyc2lvbktpbmQ7XG4gIGlubGluZT86IHN0cmluZztcbiAgLyoqIFNvdXJjZSBwYXRoIFx1MjAxNCByZXF1aXJlZCBmb3IgYGtpbmQ6ICdyZW5hbWUnYCAoY2hhaW4gbWlncmF0aW9uLCBGUi05KS4gKi9cbiAgZnJvbVBhdGg/OiBzdHJpbmc7XG4gIC8qKiBUcnVlIGZvciBlbXB0eS1mb2xkZXIgcGxhY2Vob2xkZXIgY29tbWl0cyAoRlItMTA7IGhhc2ggYCcnYCwgc2l6ZSAwKS4gKi9cbiAgaXNGb2xkZXI/OiBib29sZWFuO1xufVxuXG4vKiogS2VlcGFsaXZlLiAqL1xuZXhwb3J0IGludGVyZmFjZSBQaW5nTWVzc2FnZSB7XG4gIHR5cGU6ICdwaW5nJztcbiAgLyoqIENsaWVudCBlcG9jaCBtczsgZWNob2VkIGJhY2sgb24gYHBvbmdgIGZvciBSVFQgLyBza2V3IG1lYXN1cmVtZW50LiAqL1xuICB0cz86IG51bWJlcjtcbn1cblxuLyoqXG4gKiBVcGxvYWQgYSBjb250ZW50IGJsb2Igb3ZlciB0aGUgc3luYyBjaGFubmVsLiBUZXN0IGRvdWJsZXMgYW5kIHNtYWxsIHZhdWx0c1xuICogY2FuIHVzZSB0aGlzIGRpcmVjdGx5OyB0aGUgcmVhbCB3b3JrZXIgZXhwb3NlcyB0aGUgc2FtZSBvcGVyYXRpb24gYXNcbiAqIGBQVVQgL2Jsb2IvOmhhc2hgIChzdHJlYW1lZCkuIElkZW1wb3RlbnQ6IHNhbWUgaGFzaCBcdTIxRDIgc2FtZSBjb250ZW50LlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFB1dEJsb2JNZXNzYWdlIHtcbiAgdHlwZTogJ3B1dEJsb2InO1xuICBoYXNoOiBzdHJpbmc7XG4gIC8qKiBGdWxsIGNvbnRlbnQsIGJhc2U2NC1lbmNvZGVkLiAqL1xuICBjb250ZW50OiBzdHJpbmc7XG59XG5cbi8qKiBGZXRjaCBhIGNvbnRlbnQgYmxvYiAodGhlIFdTLWlubGluZSBwYXRoIG9mIFx1MDBBNzggXCJmZXRjaCBibG9iXCIpLiAqL1xuZXhwb3J0IGludGVyZmFjZSBHZXRCbG9iTWVzc2FnZSB7XG4gIHR5cGU6ICdnZXRCbG9iJztcbiAgaGFzaDogc3RyaW5nO1xufVxuXG4vLyAtLS0gU2VydmVyIFx1MjE5MiBDbGllbnQgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogU3VjY2Vzc2Z1bCBoZWxsbzogdGhpcyBkZXZpY2UncyBpZGVudGl0eSArIHZhdWx0LWxldmVsIGluZm8uICovXG5leHBvcnQgaW50ZXJmYWNlIEhlbGxvQWNrTWVzc2FnZSB7XG4gIHR5cGU6ICdoZWxsb0Fjayc7XG4gIGRldmljZUlkOiBzdHJpbmc7XG4gIHZhdWx0TmFtZTogc3RyaW5nO1xuICBzZXR0aW5nczogVmF1bHRTZXR0aW5ncztcbiAgLyoqXG4gICAqIExvd2VzdCBjaGFuZ2UtZXZlbnQgc2VxdWVuY2UgbnVtYmVyIHRoZSBzZXJ2ZXIgc3RpbGwgcmV0YWlucyAocHJvdG9jb2xcbiAgICogdjEsIHByZS1yZWxlYXNlOyBvcHRpb25hbCBzbyBvbGRlciBzZXJ2ZXJzIGNhbiBiZSBhbnN3ZXJlZCB3aXRoIGEgZnVsbFxuICAgKiBtYW5pZmVzdCkuIEEgY2xpZW50IHdob3NlIGN1cnNvciBzYXRpc2ZpZXNcbiAgICogYG9sZGVzdFJldGFpbmVkU2VxIDw9IGN1cnNvciArIDFgIGNhbiByZXF1ZXN0IGEgZGVsdGEgbWFuaWZlc3QgXHUyMDE0IGV2ZXJ5XG4gICAqIGV2ZW50IGFmdGVyIGl0cyBjdXJzb3IgaXMgc3RpbGwgcmVwbGF5YWJsZSwgc28gaXRzIGluZGV4IGlzIGd1YXJhbnRlZWRcbiAgICogdG8gb25seSBtaXNzIGhlYWRzIHdpdGggYGhlYWRfc2VxID4gY3Vyc29yYC4gQWJzZW50IChvciBgPiBjdXJzb3IgKyAxYClcbiAgICogXHUyMUQyIHRoZSBjbGllbnQgbXVzdCBmYWxsIGJhY2sgdG8gYSBmdWxsIG1hbmlmZXN0LlxuICAgKi9cbiAgb2xkZXN0UmV0YWluZWRTZXE/OiBudW1iZXI7XG59XG5cbi8qKiBSZXBseSB0byBgZ2V0TWFuaWZlc3RgOiB0aGUgKHBvc3NpYmx5IGRlbHRhKSBmaWxlIGluZGV4LiAqL1xuZXhwb3J0IGludGVyZmFjZSBNYW5pZmVzdE1lc3NhZ2Uge1xuICB0eXBlOiAnbWFuaWZlc3QnO1xuICBlbnRyaWVzOiBSZWFkb25seTxSZWNvcmQ8c3RyaW5nLCBNYW5pZmVzdEVudHJ5Pj47XG4gIC8qKiBHbG9iYWwgc2VxdWVuY2UgbnVtYmVyIHRoaXMgbWFuaWZlc3QgcmVmbGVjdHMgKGN1cnNvciBjYXRjaC11cCkuICovXG4gIGN1cnNvcjogbnVtYmVyO1xufVxuXG4vKiogQ29tbWl0IGFjY2VwdGVkIGFzIHRoZSBuZXcgaGVhZC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ29tbWl0QWNrTWVzc2FnZSB7XG4gIHR5cGU6ICdjb21taXRBY2snO1xuICAvKiogVmVyc2lvbiBpZCBhc3NpZ25lZCBieSB0aGUgYXV0aG9yaXR5LiAqL1xuICB2ZXJzaW9uOiBzdHJpbmc7XG4gIC8qKiBMb2dpY2FsIGNsb2NrIG9mIHRoZSBhY2NlcHRlZCB2ZXJzaW9uLiAqL1xuICBjbG9jazogTG9naWNhbENsb2NrO1xuICAvKiogR2xvYmFsIHNlcXVlbmNlIG51bWJlciBvZiB0aGUgYWNjZXB0ZWQgaGVhZCAoY3Vyc29yIHRyYWNraW5nKS4gKi9cbiAgc2VxOiBudW1iZXI7XG59XG5cbi8qKiBXaGF0IGhhcHBlbmVkIHRvIHRoZSBsb3Npbmcgc2lkZSBvZiBhIGNvbmN1cnJlbnQgZWRpdCAoc2VlIGRpc3Bvc2l0aW9uKS4gKi9cbmV4cG9ydCB0eXBlIENvbmZsaWN0TG9zZXJEaXNwb3NpdGlvbiA9ICdjb25mbGljdENvcHknO1xuXG4vKiogQ29tbWl0IGxvc3QgdGhlIHJhY2U7IHRoZSBzZXJ2ZXIncyBjaG9zZW4gd2lubmVyIHN0YW5kcy4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ29uZmxpY3RNZXNzYWdlIHtcbiAgdHlwZTogJ2NvbmZsaWN0JztcbiAgLyoqIFRoZSB3aW5uaW5nIHZlcnNpb24gKHRoaXMgY29tbWl0IG9yIHRoZSBjb25jdXJyZW50IG9uZSkuICovXG4gIHdpbm5lcjogVmVyc2lvbjtcbiAgLyoqIFdoYXQgdGhlIHNlcnZlciBkaWQgd2l0aCB0aGUgbG9zZXIncyBjb250ZW50IFx1MjAxNCBuZXZlciBkZWxldGVkLiAqL1xuICBsb3NlckRpc3Bvc2l0aW9uOiBDb25mbGljdExvc2VyRGlzcG9zaXRpb247XG4gIC8qKiBHbG9iYWwgc2VxdWVuY2UgbnVtYmVyIG9mIHRoZSB3aW5uaW5nIGhlYWQsIHdoZW4gaXQgaGFzIG9uZS4gKi9cbiAgc2VxPzogbnVtYmVyO1xufVxuXG4vKipcbiAqIEZhbi1vdXQgcGF5bG9hZCBzaGFyZWQgYnkgdGhlIGNoYW5nZSBicm9hZGNhc3QgYW5kIHRoZSBhcmJpdHJhdGlvbiByZXN1bHQuXG4gKiBFdmVyeXRoaW5nIGEgY2xpZW50IG5lZWRzIHRvIG1hdGVyaWFsaXplIG9uZSBoZWFkIHRyYW5zaXRpb24uXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ2hhbmdlUGF5bG9hZCB7XG4gIHBhdGg6IHN0cmluZztcbiAgLyoqIFZlcnNpb24gaWQgb2YgdGhlIG5ldyBoZWFkLiAqL1xuICB2ZXJzaW9uOiBzdHJpbmc7XG4gIGhhc2g6IHN0cmluZztcbiAgc2l6ZTogbnVtYmVyO1xuICBkZWxldGVkOiBib29sZWFuO1xuICAvKiogSWQgb2YgdGhlIGRldmljZSB0aGF0IGNvbW1pdHRlZC4gKi9cbiAgZGV2aWNlOiBzdHJpbmc7XG4gIC8qKiBMb2dpY2FsIGNsb2NrIG9mIHRoZSBuZXcgaGVhZCBcdTIwMTQgY2xpZW50cyB1c2UgaXQgdG8gc2tpcCBzdGFsZSByZXBsYXlzLiAqL1xuICBjbG9jazogTG9naWNhbENsb2NrO1xuICAvKiogV2hhdCBraW5kIG9mIGNoYW5nZSB0aGlzIGlzIChtaXJyb3JzIGBWZXJzaW9uLmtpbmRgKS4gKi9cbiAga2luZDogVmVyc2lvbktpbmQ7XG4gIC8qKiBTb3VyY2UgcGF0aCBcdTIwMTQgcHJlc2VudCB3aGVuIGBraW5kOiAncmVuYW1lJ2AuICovXG4gIGZyb21QYXRoPzogc3RyaW5nO1xuICAvKiogVHJ1ZSBmb3IgZm9sZGVyIHBsYWNlaG9sZGVyIGNoYW5nZXMgKEZSLTEwKS4gKi9cbiAgaXNGb2xkZXI/OiBib29sZWFuO1xufVxuXG4vKiogRmFuLW91dCBicm9hZGNhc3QgdG8gYWxsICpvdGhlciogY29ubmVjdGVkIGNsaWVudHMuICovXG5leHBvcnQgaW50ZXJmYWNlIENoYW5nZU1lc3NhZ2UgZXh0ZW5kcyBDaGFuZ2VQYXlsb2FkIHtcbiAgdHlwZTogJ2NoYW5nZSc7XG4gIC8qKiBHbG9iYWwgc2VxdWVuY2UgbnVtYmVyIG9mIHRoaXMgY2hhbmdlIChjdXJzb3IgdHJhY2tpbmcpLiAqL1xuICBzZXE6IG51bWJlcjtcbn1cblxuLyoqIFJlcGx5IHRvIGBwdXRCbG9iYC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQmxvYkFja01lc3NhZ2Uge1xuICB0eXBlOiAnYmxvYkFjayc7XG4gIGhhc2g6IHN0cmluZztcbn1cblxuLyoqIFJlcGx5IHRvIGBnZXRCbG9iYDogdGhlIHJlcXVlc3RlZCBjb250ZW50LiAqL1xuZXhwb3J0IGludGVyZmFjZSBCbG9iTWVzc2FnZSB7XG4gIHR5cGU6ICdibG9iJztcbiAgaGFzaDogc3RyaW5nO1xuICAvKiogRnVsbCBjb250ZW50LCBiYXNlNjQtZW5jb2RlZC4gKi9cbiAgY29udGVudDogc3RyaW5nO1xufVxuXG4vKiogTWFjaGluZS1yZWFkYWJsZSBjb2RlcyBjYXJyaWVkIGJ5IGBlcnJvcmAgbWVzc2FnZXMgKEhUVFAtZXF1aXZhbGVudCkuICovXG5leHBvcnQgdHlwZSBTZXJ2ZXJFcnJvckNvZGUgPSAnVU5BVVRIT1JJWkVEJyB8ICdSRVZPS0VEJyB8ICdOT1RfRk9VTkQnIHwgJ1BST1RPQ09MJztcblxuLyoqIE5lZ2F0aXZlIHJlcGx5IChhdXRoIGZhaWx1cmUsIHVua25vd24gYmxvYiwgcHJvdG9jb2wgdmlvbGF0aW9uLCBcdTIwMjYpLiAqL1xuZXhwb3J0IGludGVyZmFjZSBFcnJvck1lc3NhZ2Uge1xuICB0eXBlOiAnZXJyb3InO1xuICBjb2RlOiBTZXJ2ZXJFcnJvckNvZGU7XG4gIG1lc3NhZ2U6IHN0cmluZztcbn1cblxuLyoqIFByZXNlbmNlIHVwZGF0ZSBmb3IgZGFzaGJvYXJkcyAvIGB2c2Egc3RhdHVzYC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRGV2aWNlU2Vlbk1lc3NhZ2Uge1xuICB0eXBlOiAnZGV2aWNlU2Vlbic7XG4gIGRldmljZUlkOiBzdHJpbmc7XG4gIHRzOiBudW1iZXI7XG59XG5cbi8qKiBLZWVwYWxpdmUgcmVwbHkuICovXG5leHBvcnQgaW50ZXJmYWNlIFBvbmdNZXNzYWdlIHtcbiAgdHlwZTogJ3BvbmcnO1xuICAvKiogRWNob2VzIHRoZSBgcGluZ2AgdHMgd2hlbiBvbmUgd2FzIHByb3ZpZGVkLiAqL1xuICB0cz86IG51bWJlcjtcbn1cblxuLy8gLS0tIFVuaW9uICsgZ3VhcmRzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgdHlwZSBDbGllbnRNZXNzYWdlID1cbiAgfCBIZWxsb01lc3NhZ2VcbiAgfCBHZXRNYW5pZmVzdE1lc3NhZ2VcbiAgfCBDb21taXRNZXNzYWdlXG4gIHwgUHV0QmxvYk1lc3NhZ2VcbiAgfCBHZXRCbG9iTWVzc2FnZVxuICB8IFBpbmdNZXNzYWdlO1xuXG5leHBvcnQgdHlwZSBTZXJ2ZXJNZXNzYWdlID1cbiAgfCBIZWxsb0Fja01lc3NhZ2VcbiAgfCBNYW5pZmVzdE1lc3NhZ2VcbiAgfCBDb21taXRBY2tNZXNzYWdlXG4gIHwgQ29uZmxpY3RNZXNzYWdlXG4gIHwgQ2hhbmdlTWVzc2FnZVxuICB8IERldmljZVNlZW5NZXNzYWdlXG4gIHwgQmxvYkFja01lc3NhZ2VcbiAgfCBCbG9iTWVzc2FnZVxuICB8IEVycm9yTWVzc2FnZVxuICB8IFBvbmdNZXNzYWdlO1xuXG5leHBvcnQgdHlwZSBNZXNzYWdlID0gQ2xpZW50TWVzc2FnZSB8IFNlcnZlck1lc3NhZ2U7XG5cbmNvbnN0IENMSUVOVF9UWVBFUzogUmVhZG9ubHlTZXQ8c3RyaW5nPiA9IG5ldyBTZXQoW1xuICAnaGVsbG8nLFxuICAnZ2V0TWFuaWZlc3QnLFxuICAnY29tbWl0JyxcbiAgJ3B1dEJsb2InLFxuICAnZ2V0QmxvYicsXG4gICdwaW5nJyxcbl0pO1xuY29uc3QgU0VSVkVSX1RZUEVTOiBSZWFkb25seVNldDxzdHJpbmc+ID0gbmV3IFNldChbXG4gICdoZWxsb0FjaycsXG4gICdtYW5pZmVzdCcsXG4gICdjb21taXRBY2snLFxuICAnY29uZmxpY3QnLFxuICAnY2hhbmdlJyxcbiAgJ2RldmljZVNlZW4nLFxuICAnYmxvYkFjaycsXG4gICdibG9iJyxcbiAgJ2Vycm9yJyxcbiAgJ3BvbmcnLFxuXSk7XG5cbi8qKlxuICogUnVudGltZSBzaGFwZSBjaGVjazogYSB2YWx1ZSBpcyBhIGBNZXNzYWdlYCBpZmYgaXQgaXMgYW4gb2JqZWN0IHdob3NlXG4gKiBgdHlwZWAgaXMgYSBrbm93biBtZXNzYWdlIHR5cGUuIEZpZWxkLWxldmVsIHZhbGlkYXRpb24gaGFwcGVucyB3aGVyZSBhXG4gKiBtZXNzYWdlIGlzIGFjdGVkIHVwb24gKGxhdGVyIHBoYXNlcyk7IHRoZSBndWFyZCBpcyBkZWxpYmVyYXRlbHkgY2hlYXAgc29cbiAqIGJvdGggV1MgZW5kcyBjYW4gdHJpYWdlIHVua25vd24vZm9yd2FyZC1jb21wYXRpYmxlIHR5cGVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNNZXNzYWdlKHZhbHVlOiB1bmtub3duKTogdmFsdWUgaXMgTWVzc2FnZSB7XG4gIHJldHVybiAoXG4gICAgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJlxuICAgIHZhbHVlICE9PSBudWxsICYmXG4gICAgdHlwZW9mICh2YWx1ZSBhcyB7IHR5cGU/OiB1bmtub3duIH0pLnR5cGUgPT09ICdzdHJpbmcnICYmXG4gICAgKENMSUVOVF9UWVBFUy5oYXMoKHZhbHVlIGFzIHsgdHlwZTogc3RyaW5nIH0pLnR5cGUpIHx8XG4gICAgICBTRVJWRVJfVFlQRVMuaGFzKCh2YWx1ZSBhcyB7IHR5cGU6IHN0cmluZyB9KS50eXBlKSlcbiAgKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGlzQ2xpZW50TWVzc2FnZSh2YWx1ZTogdW5rbm93bik6IHZhbHVlIGlzIENsaWVudE1lc3NhZ2Uge1xuICByZXR1cm4gKFxuICAgIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiZcbiAgICB2YWx1ZSAhPT0gbnVsbCAmJlxuICAgIENMSUVOVF9UWVBFUy5oYXMoKHZhbHVlIGFzIHsgdHlwZT86IHVua25vd24gfSkudHlwZSBhcyBzdHJpbmcpXG4gICk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc1NlcnZlck1lc3NhZ2UodmFsdWU6IHVua25vd24pOiB2YWx1ZSBpcyBTZXJ2ZXJNZXNzYWdlIHtcbiAgcmV0dXJuIChcbiAgICB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmXG4gICAgdmFsdWUgIT09IG51bGwgJiZcbiAgICBTRVJWRVJfVFlQRVMuaGFzKCh2YWx1ZSBhcyB7IHR5cGU/OiB1bmtub3duIH0pLnR5cGUgYXMgc3RyaW5nKVxuICApO1xufVxuXG4vKipcbiAqIFBhcnNlIGEgV1MgdGV4dCBmcmFtZSBpbnRvIGEgdHlwZWQgYE1lc3NhZ2VgLlxuICogVGhyb3dzIGBQcm90b2NvbEVycm9yYCBvbiBub24tSlNPTiBpbnB1dCBvciB1bmtub3duIG1lc3NhZ2UgdHlwZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZU1lc3NhZ2UoZGF0YTogc3RyaW5nKTogTWVzc2FnZSB7XG4gIGxldCBwYXJzZWQ6IHVua25vd247XG4gIHRyeSB7XG4gICAgcGFyc2VkID0gSlNPTi5wYXJzZShkYXRhKTtcbiAgfSBjYXRjaCAoY2F1c2UpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgTWVzc2FnZSBpcyBub3QgdmFsaWQgSlNPTjogJHtTdHJpbmcoZGF0YSkuc2xpY2UoMCwgMjAwKX1gLCB7IGNhdXNlIH0pO1xuICB9XG4gIGlmICghaXNNZXNzYWdlKHBhcnNlZCkpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihcbiAgICAgIGBVbmtub3duIG9yIG1hbGZvcm1lZCBtZXNzYWdlIHR5cGU6ICR7SlNPTi5zdHJpbmdpZnkoKHBhcnNlZCBhcyB7IHR5cGU/OiB1bmtub3duIH0pPy50eXBlKX1gLFxuICAgICk7XG4gIH1cbiAgcmV0dXJuIHBhcnNlZDtcbn1cblxuLy8gLS0tIHdpcmUgZW5jb2RpbmcgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vL1xuLy8gYGlubGluZWAvYGNvbnRlbnRgIGZpZWxkcyBjYXJyeSByYXcgYnl0ZXMgYXMgYmFzZTY0LiBgYnRvYWAvYGF0b2JgIGV4aXN0IGluXG4vLyBldmVyeSB0YXJnZXQgcnVudGltZSAoV29ya2VycywgTm9kZSAxNissIEVsZWN0cm9uKTsgY2h1bmtpbmcgYXZvaWRzXG4vLyBleGNlZWRpbmcgYXJndW1lbnQtbGVuZ3RoIGxpbWl0cyBvbiBsYXJnZSBhdHRhY2htZW50cy5cblxuLyoqIEVuY29kZSBieXRlcyBhcyBiYXNlNjQuICovXG5leHBvcnQgZnVuY3Rpb24gYnl0ZXNUb0Jhc2U2NChieXRlczogVWludDhBcnJheSk6IHN0cmluZyB7XG4gIGxldCBiaW5hcnkgPSAnJztcbiAgY29uc3QgQ0hVTksgPSAweDgwMDA7XG4gIGZvciAobGV0IG9mZnNldCA9IDA7IG9mZnNldCA8IGJ5dGVzLmxlbmd0aDsgb2Zmc2V0ICs9IENIVU5LKSB7XG4gICAgYmluYXJ5ICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoLi4uYnl0ZXMuc3ViYXJyYXkob2Zmc2V0LCBvZmZzZXQgKyBDSFVOSykpO1xuICB9XG4gIHJldHVybiBidG9hKGJpbmFyeSk7XG59XG5cbi8qKiBEZWNvZGUgYmFzZTY0IHRvIGJ5dGVzLiBUaHJvd3MgYFByb3RvY29sRXJyb3JgIG9uIGludmFsaWQgaW5wdXQuICovXG5leHBvcnQgZnVuY3Rpb24gYmFzZTY0VG9CeXRlcyhlbmNvZGVkOiBzdHJpbmcpOiBVaW50OEFycmF5IHtcbiAgbGV0IGJpbmFyeTogc3RyaW5nO1xuICB0cnkge1xuICAgIGJpbmFyeSA9IGF0b2IoZW5jb2RlZCk7XG4gIH0gY2F0Y2ggKGNhdXNlKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoJ0Jhc2U2NCBwYXlsb2FkIGlzIG5vdCB2YWxpZCcsIHsgY2F1c2UgfSk7XG4gIH1cbiAgY29uc3QgYnl0ZXMgPSBuZXcgVWludDhBcnJheShiaW5hcnkubGVuZ3RoKTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBiaW5hcnkubGVuZ3RoOyBpKyspIGJ5dGVzW2ldID0gYmluYXJ5LmNoYXJDb2RlQXQoaSk7XG4gIHJldHVybiBieXRlcztcbn1cbiIsICIvKipcbiAqIENvbmZsaWN0LWNvcHkgZmlsZSBuYW1pbmcgKEFSQ0hJVEVDVFVSRS5tZCBcdTAwQTc0LCBGUi02KS5cbiAqXG4gKiBXaGVuIGEgZGV2aWNlIGxvc2VzIGEgY29uZmxpY3QgYnV0IGl0cyBjb250ZW50IG11c3QgYmUgcHJlc2VydmVkLCB0aGVcbiAqIGNvbnRlbnQgaXMgY29tbWl0dGVkIHRvIGEgc2libGluZyBcImNvbmZsaWN0IGNvcHlcIiBwYXRoIHNoYXBlZCBsaWtlOlxuICpcbiAqICAgICBOb3RlIChjb25mbGljdCAyMDI2LTA4LTIwIDE0LTIzIC0gZnJvbSBQaG9uZSkubWRcbiAqICAgICBcdTI1MTRcdTI1MDAgc3RlbSBcdTI1MDBcdTI1MThcdTI1MTRcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDAgVVRDIGRhdGUgKyBISC1tbSBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MThcdTI1MTQgZGV2aWNlIFx1MjUxOFx1MjUxNGV4dFx1MjUxOFxuICpcbiAqIFJ1bGVzOlxuICogICAtIHRpbWVzdGFtcCBpcyBhbHdheXMgVVRDIChuZXZlciBhIGxvY2FsIHRpbWV6b25lKSBzbyBldmVyeSBjbGllbnRcbiAqICAgICBjb21wdXRlcyB0aGUgaWRlbnRpY2FsIG5hbWUgZnJvbSB0aGUgc2FtZSBjb21taXQgdGltZTtcbiAqICAgLSB0aGUgZGV2aWNlIG5hbWUgaXMgc2FuaXRpemVkIGZvciBmaWxlc3lzdGVtIHNhZmV0eSAoc2VlXG4gKiAgICAgYHNhbml0aXplRGV2aWNlTmFtZWApO1xuICogICAtIHRoZSBvcmlnaW5hbCBleHRlbnNpb24gaXMgcHJlc2VydmVkIChsYXN0IGRvdCBpbiB0aGUgYmFzZW5hbWUsIGFzIGxvbmdcbiAqICAgICBhcyBpdCBpcyBub3QgdGhlIGZpcnN0IGNoYXJhY3RlciBcdTIwMTQgYC5naXRpZ25vcmVgIGhhcyBubyBleHRlbnNpb24pO1xuICogICAtIGlmIHRoZSBjYW5kaWRhdGUgYWxyZWFkeSBleGlzdHMgKGluIHRoZSBsb2NhbCBpbmRleCBvciB0aGUgcmVtb3RlXG4gKiAgICAgbWFuaWZlc3QgXHUyMDE0IHRoZSBjYWxsZXIgc3VwcGxpZXMgdGhlIGBleGlzdHNgIHByZWRpY2F0ZSksIGAgMmAsIGAgM2AsIFx1MjAyNlxuICogICAgIGlzIGFwcGVuZGVkIGJlZm9yZSB0aGUgZXh0ZW5zaW9uLlxuICovXG5cbmltcG9ydCB7IGJhc2VuYW1lLCBub3JtYWxpemVWYXVsdFBhdGgsIHBhcmVudFBhdGggfSBmcm9tICcuL3BhdGhzLmpzJztcblxuLyoqIENoYXJhY3RlcnMgZm9yYmlkZGVuIG9uIGF0IGxlYXN0IG9uZSBzdXBwb3J0ZWQgcGxhdGZvcm0uICovXG5jb25zdCBJTExFR0FMX0ZJTEVOQU1FX0NIQVJTID0gL1s8PjpcIi9cXFxcfD8qXS9nO1xuLyoqIEMwIGNvbnRyb2xzICsgREVMIFx1MjAxNCBuZXZlciB2YWxpZCBpbiBmaWxlbmFtZXMuICovXG5jb25zdCBDT05UUk9MX0NIQVJTID0gL1tcXHgwMC1cXHgxZlxceDdmXS9nO1xuXG4vKiogTWF4IGxlbmd0aCAoaW4gY29kZSBwb2ludHMpIG9mIGEgc2FuaXRpemVkIGRldmljZSBuYW1lLiAqL1xuY29uc3QgTUFYX0RFVklDRV9OQU1FX0xFTkdUSCA9IDMwO1xuXG4vKiogRmFsbGJhY2sgd2hlbiBhIGRldmljZSBuYW1lIHNhbml0aXplcyB0byBub3RoaW5nLiAqL1xuY29uc3QgRkFMTEJBQ0tfREVWSUNFX05BTUUgPSAndW5rbm93bic7XG5cbi8qKiBIaWdoZXN0IGAgTmAgc3VmZml4IHRyaWVkIGJlZm9yZSBnaXZpbmcgdXAuICovXG5jb25zdCBNQVhfQ09MTElTSU9OX1NVRkZJWCA9IDk5OTtcblxuLyoqXG4gKiBTYW5pdGl6ZSBhIGRldmljZSBuYW1lIGZvciB1c2UgaW5zaWRlIGEgZmlsZW5hbWU6IHN0cmlwIGA8PjpcIi9cXFxcfD8qYCBhbmRcbiAqIGNvbnRyb2wgY2hhcmFjdGVycywgdHJpbSB3aGl0ZXNwYWNlIGFuZCBlZGdlIGRvdHMgKFdpbmRvd3Mgc2VnbWVudHMgbWF5XG4gKiBub3QgZW5kIHdpdGggYC5gIG9yIHdoaXRlc3BhY2UpLCB0cnVuY2F0ZSB0byAzMCBjb2RlIHBvaW50cyAobmV2ZXIgc3BsaXRzXG4gKiBhIHN1cnJvZ2F0ZSBwYWlyKS4gUmV0dXJucyBgJ3Vua25vd24nYCB3aGVuIG5vdGhpbmcgc3Vydml2ZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzYW5pdGl6ZURldmljZU5hbWUobmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgbGV0IGNsZWFuZWQgPSBuYW1lLnJlcGxhY2UoSUxMRUdBTF9GSUxFTkFNRV9DSEFSUywgJycpLnJlcGxhY2UoQ09OVFJPTF9DSEFSUywgJycpO1xuICBjbGVhbmVkID0gWy4uLmNsZWFuZWRdLnNsaWNlKDAsIE1BWF9ERVZJQ0VfTkFNRV9MRU5HVEgpLmpvaW4oJycpO1xuICBjbGVhbmVkID0gY2xlYW5lZC50cmltKCkucmVwbGFjZSgvXlsuXFxzXSt8Wy5cXHNdKyQvZywgJycpO1xuICByZXR1cm4gY2xlYW5lZC5sZW5ndGggPT09IDAgPyBGQUxMQkFDS19ERVZJQ0VfTkFNRSA6IGNsZWFuZWQ7XG59XG5cbi8qKlxuICogQ29tcHV0ZSB0aGUgY29uZmxpY3QtY29weSBwYXRoIGZvciBgcGF0aGAuXG4gKlxuICogUHVyZSBhbmQgZGV0ZXJtaW5pc3RpYzogdGhlIHNhbWUgYChwYXRoLCBkZXZpY2VOYW1lLCBub3csIGV4aXN0cylgIGFsd2F5c1xuICogeWllbGRzIHRoZSBzYW1lIHJlc3VsdC4gYG5vd2AgaXMgdGhlIGNvbmZsaWN0J3MgZXBvY2gtbXMgdGltZXN0YW1wICh0aGVcbiAqIGNhbGxlciBwYXNzZXMgaXQgaW4gXHUyMDE0IG5vIGhpZGRlbiBjbG9ja3MpOyBgZXhpc3RzYCBpcyBjb25zdWx0ZWQgZm9yXG4gKiBjb2xsaXNpb24gYXZvaWRhbmNlIGFuZCB0eXBpY2FsbHkgY2hlY2tzIHRoZSBsb2NhbCBpbmRleCBwbHVzIHRoZSByZW1vdGVcbiAqIG1hbmlmZXN0LlxuICpcbiAqIFRocm93cyB3aGVuIG1vcmUgdGhhbiBgTUFYX0NPTExJU0lPTl9TVUZGSVhgIG5hbWUgY29sbGlzaW9ucyBvY2N1ciAoYVxuICogZ2VudWluZWx5IHBhdGhvbG9naWNhbCB2YXVsdCBzdGF0ZSB0aGUgY2FsbGVyIHNob3VsZCBzdXJmYWNlLCBub3QgcGFwZXJcbiAqIG92ZXIpLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY29uZmxpY3RDb3B5UGF0aChcbiAgcGF0aDogc3RyaW5nLFxuICBkZXZpY2VOYW1lOiBzdHJpbmcsXG4gIG5vdzogbnVtYmVyLFxuICBleGlzdHM6IChjYW5kaWRhdGVQYXRoOiBzdHJpbmcpID0+IGJvb2xlYW4gPSAoKSA9PiBmYWxzZSxcbik6IHN0cmluZyB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVWYXVsdFBhdGgocGF0aCk7XG4gIGNvbnN0IGRpciA9IHBhcmVudFBhdGgobm9ybWFsaXplZCk7XG4gIGNvbnN0IG5hbWUgPSBiYXNlbmFtZShub3JtYWxpemVkKTtcblxuICBjb25zdCBsYXN0RG90ID0gbmFtZS5sYXN0SW5kZXhPZignLicpO1xuICBjb25zdCBoYXNFeHRlbnNpb24gPSBsYXN0RG90ID4gMDsgLy8gYSBsZWFkaW5nIGRvdCBtYXJrcyBhIGRvdGZpbGUsIG5vdCBhbiBleHRlbnNpb25cbiAgY29uc3Qgc3RlbSA9IGhhc0V4dGVuc2lvbiA/IG5hbWUuc2xpY2UoMCwgbGFzdERvdCkgOiBuYW1lO1xuICBjb25zdCBleHRlbnNpb24gPSBoYXNFeHRlbnNpb24gPyBuYW1lLnNsaWNlKGxhc3REb3QpIDogJyc7XG5cbiAgY29uc3Qgc3VmZml4ID0gYCAoY29uZmxpY3QgJHtmb3JtYXRDb25mbGljdFN0YW1wKG5vdyl9IC0gZnJvbSAke3Nhbml0aXplRGV2aWNlTmFtZShkZXZpY2VOYW1lKX0pYDtcbiAgY29uc3Qgam9pbiA9IChmaWxlTmFtZTogc3RyaW5nKTogc3RyaW5nID0+IChkaXIgPT09ICcvJyA/IGAvJHtmaWxlTmFtZX1gIDogYCR7ZGlyfS8ke2ZpbGVOYW1lfWApO1xuXG4gIGxldCBjYW5kaWRhdGUgPSBqb2luKGAke3N0ZW19JHtzdWZmaXh9JHtleHRlbnNpb259YCk7XG4gIGZvciAobGV0IG4gPSAyOyBuIDw9IE1BWF9DT0xMSVNJT05fU1VGRklYOyBuKyspIHtcbiAgICBpZiAoIWV4aXN0cyhjYW5kaWRhdGUpKSByZXR1cm4gY2FuZGlkYXRlO1xuICAgIGNhbmRpZGF0ZSA9IGpvaW4oYCR7c3RlbX0ke3N1ZmZpeH0gJHtufSR7ZXh0ZW5zaW9ufWApO1xuICB9XG4gIHRocm93IG5ldyBFcnJvcihcbiAgICBgY29uZmxpY3RDb3B5UGF0aDogbW9yZSB0aGFuICR7TUFYX0NPTExJU0lPTl9TVUZGSVh9IGNvbGxpc2lvbnMgZm9yICR7SlNPTi5zdHJpbmdpZnkobm9ybWFsaXplZCl9YCxcbiAgKTtcbn1cblxuLyoqIGAyMDI2LTA4LTIwIDE0LTIzYCBcdTIwMTQgVVRDIGRhdGUsIHNwYWNlLCB6ZXJvLXBhZGRlZCBISC1tbS4gTWludXRlcywgbm90IHNlY29uZHMuICovXG5mdW5jdGlvbiBmb3JtYXRDb25mbGljdFN0YW1wKG5vdzogbnVtYmVyKTogc3RyaW5nIHtcbiAgY29uc3QgZCA9IG5ldyBEYXRlKG5vdyk7XG4gIGNvbnN0IHBhZCA9IChuOiBudW1iZXIpOiBzdHJpbmcgPT4gU3RyaW5nKG4pLnBhZFN0YXJ0KDIsICcwJyk7XG4gIHJldHVybiAoXG4gICAgYCR7ZC5nZXRVVENGdWxsWWVhcigpfS0ke3BhZChkLmdldFVUQ01vbnRoKCkgKyAxKX0tJHtwYWQoZC5nZXRVVENEYXRlKCkpfWAgK1xuICAgIGAgJHtwYWQoZC5nZXRVVENIb3VycygpKX0tJHtwYWQoZC5nZXRVVENNaW51dGVzKCkpfWBcbiAgKTtcbn1cbiIsICIvKipcbiAqIFRocmVlLXdheSByZWNvbmNpbGlhdGlvbiAoQVJDSElURUNUVVJFLm1kIFx1MDBBNzggc3RlcCA0KS5cbiAqXG4gKiBgY29tcHV0ZVN5bmNQbGFuYCBpcyBhIFBVUkUsIERFVEVSTUlOSVNUSUMgZnVuY3Rpb246IHRoZSBzYW1lIGlucHV0cyBhbHdheXNcbiAqIHByb2R1Y2UgdGhlIHNhbWUgcGxhbiAobWFuaWZlc3QgYW5kIGNoYW5nZSBidWNrZXRzIGFyZSByZS1zb3J0ZWRcbiAqIGludGVybmFsbHk7IGBub3dgIGlzIGEgcGFyYW1ldGVyLCBuZXZlciByZWFkIGZyb20gYSBjbG9jaykuIEl0IGNvbXBhcmVzXG4gKiB0aHJlZSBzdGF0ZXMgZm9yIGV2ZXJ5IHBhdGg6XG4gKlxuICogICAtIHRoZSAqKmxvY2FsIGluZGV4KiogXHUyMDE0IHdoYXQgdGhpcyBkZXZpY2UgbGFzdCBrbmV3IGFzIGF1dGhvcml0YXRpdmVcbiAqICAgICAodGhlIFwiY29tbW9uIGFuY2VzdG9yXCIgb2YgdGhlIHRocmVlLXdheSBtZXJnZSk7XG4gKiAgIC0gdGhlICoqbG9jYWwgY2hhbmdlcyoqIFx1MjAxNCBob3cgbG9jYWwgc3RvcmFnZSBkaXZlcmdlZCBmcm9tIHRoZSBpbmRleFxuICogICAgIHdoaWxlIG9mZmxpbmUgKGBzY2FuLnRzYCBvdXRwdXQpO1xuICogICAtIHRoZSAqKm1hbmlmZXN0KiogXHUyMDE0IHRoZSBhdXRob3JpdHkncyBjdXJyZW50IGhlYWQgcGVyIHBhdGguXG4gKlxuICogYW5kIGVtaXRzIGEgYFN5bmNQbGFuYCAoc2hhcGUgZG9jdW1lbnRlZCBvbiB0aGUgaW50ZXJmYWNlKTogb3BzIHRvIHB1c2gsXG4gKiBvcHMgdG8gcHVsbCwgY29uZmxpY3QgcmVzb2x1dGlvbnMsIGFuZCBmb2xkZXIgcGxhY2Vob2xkZXJzIHRvIHB1c2guXG4gKlxuICogQ29uZmxpY3QgYXJiaXRyYXRpb24gbWlycm9ycyB0aGUgRE8ncyBydWxlIChcdTAwQTc0KTogd2lubmVyID0gaGlnaGVyIGxvZ2ljYWxcbiAqIGNsb2NrOyB0aWUgXHUyMTkyIGdyZWF0ZXIgZGV2aWNlSWQuIFRoZSBsb2NhbCBzaWRlJ3MgKnRlbnRhdGl2ZSogY2xvY2sgaXNcbiAqIGBuZXh0Q2xvY2soaW5kZXggY2xvY2ssIHRoaXNEZXZpY2VJZClgIFx1MjAxNCBleGFjdGx5IHRoZSBjb3VudGVyIHRoZSBETyB3b3VsZFxuICogYXNzaWduIGEgY29tbWl0IGJ1aWxkaW5nIG9uIHRoZSBzYW1lIHBhcmVudCwgc28gdGhlIGNsaWVudCdzIHByZWRpY3Rpb25cbiAqIG1hdGNoZXMgdGhlIHNlcnZlcidzIGFyYml0cmF0aW9uLiBXaGVuIHRoZSByZW1vdGUgc2lkZSB3aW5zLCB0aGUgbG9zaW5nXG4gKiBsb2NhbCBjb250ZW50IGlzIHByZXNlcnZlZCBieSBwdXNoaW5nIGl0IHRvIGEgY29uZmxpY3QtY29weSBwYXRoXG4gKiAoYGNvbmZsaWN0bmFtZXMudHNgKTsgd2hlbiB0aGUgbG9jYWwgc2lkZSB3aW5zLCB0aGUgY2xpZW50IHNpbXBseSBjb21taXRzXG4gKiB3aXRoIGl0cyAobm93IHN0YWxlKSBwYXJlbnQgdmVyc2lvbiBhbmQgbGV0cyB0aGUgc2VydmVyIGFyYml0cmF0ZSBcdTIwMTQgdGhlXG4gKiBzZXJ2ZXIgc3ludGhlc2l6ZXMgYW55IGNvbmZsaWN0IGNvcHkgZm9yIHRoZSBsb3NpbmcgcmVtb3RlIGNvbnRlbnQsIHdoaWNoXG4gKiBhcnJpdmVzIGxhdGVyIGFzIGFuIG9yZGluYXJ5IGNoYW5nZSBldmVudC5cbiAqL1xuXG5pbXBvcnQgeyBjb21wYXJlQ2xvY2tzLCBuZXh0Q2xvY2sgfSBmcm9tICcuL2Nsb2NrLmpzJztcbmltcG9ydCB7IGNvbmZsaWN0Q29weVBhdGggfSBmcm9tICcuL2NvbmZsaWN0bmFtZXMuanMnO1xuaW1wb3J0IHR5cGUgeyBMb2NhbEluZGV4LCBMb2NhbEluZGV4RW50cnkgfSBmcm9tICcuL2xvY2FsaW5kZXguanMnO1xuaW1wb3J0IHsgcGFyZW50UGF0aCB9IGZyb20gJy4vcGF0aHMuanMnO1xuaW1wb3J0IHR5cGUgeyBNYW5pZmVzdEVudHJ5IH0gZnJvbSAnLi9wcm90b2NvbC5qcyc7XG5pbXBvcnQgdHlwZSB7IERlbGV0ZWRDYW5kaWRhdGUsIExvY2FsQ2hhbmdlcywgUmVuYW1lQ2FuZGlkYXRlLCBTY2FuQ2FuZGlkYXRlIH0gZnJvbSAnLi9zY2FuLmpzJztcbmltcG9ydCB0eXBlIHsgTG9naWNhbENsb2NrIH0gZnJvbSAnLi90eXBlcy5qcyc7XG5cbi8qKlxuICogQSBtYW5pZmVzdCBlbnRyeSBhcyByZWNvbmNpbGlhdGlvbiBjb25zdW1lcyBpdC4gU2luY2UgYE1hbmlmZXN0RW50cnlgIGdyZXdcbiAqIGBwYXRoYCwgYGNsb2NrYCwgYW5kIGBpc0ZvbGRlcmAgKHByb3RvY29sIHYxLCBwcmUtcmVsZWFzZSksIHRoaXMgaXMgbm93IHRoZVxuICogbWFuaWZlc3QgZW50cnkgaXRzZWxmIFx1MjAxNCBrZXB0IGFzIGEgbmFtZWQgYWxpYXMgc28gYGNvbXB1dGVTeW5jUGxhbmAncyBpbnB1dFxuICogY29udHJhY3Qgc3RheXMgc2VsZi1kb2N1bWVudGluZy5cbiAqL1xuZXhwb3J0IHR5cGUgUmVtb3RlRmlsZSA9IE1hbmlmZXN0RW50cnk7XG5cbi8qKiBJbnB1dCB0byBgY29tcHV0ZVN5bmNQbGFuYC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU3luY1BsYW5JbnB1dCB7XG4gIGxvY2FsQ2hhbmdlczogTG9jYWxDaGFuZ2VzO1xuICBpbmRleDogTG9jYWxJbmRleDtcbiAgbWFuaWZlc3Q6IHJlYWRvbmx5IFJlbW90ZUZpbGVbXTtcbiAgdGhpc0RldmljZUlkOiBzdHJpbmc7XG4gIC8qKiBIdW1hbi1yZWFkYWJsZSBuYW1lIG9mIHRoaXMgZGV2aWNlIFx1MjAxNCB1c2VkIGluIGNvbmZsaWN0LWNvcHkgZmlsZSBuYW1lcy4gKi9cbiAgdGhpc0RldmljZU5hbWU6IHN0cmluZztcbiAgLyoqIEVwb2NoIG1zIHVzZWQgZm9yIGNvbmZsaWN0LWNvcHkgdGltZXN0YW1wcyAocGFzc2VkIGluIGZvciBkZXRlcm1pbmlzbSkuICovXG4gIG5vdzogbnVtYmVyO1xufVxuXG4vKiogV2h5IGEgcGF0aCB3ZW50IHRocm91Z2ggY29uZmxpY3QgcmVzb2x1dGlvbi4gKi9cbmV4cG9ydCB0eXBlIENvbmZsaWN0UmVhc29uID0gJ2NvbmN1cnJlbnQtZWRpdCcgfCAnYWRkLXZzLWFkZCcgfCAnZGVsZXRlLXZzLWVkaXQnIHwgJ3JlbmFtZS1yYWNlJztcblxuLyoqXG4gKiBBIGNvbW1pdCB0aGlzIGRldmljZSBzaG91bGQgc2VuZCAocGF5bG9hZCBvZiBhIHByb3RvY29sIGBjb21taXRgIG1lc3NhZ2UpLlxuICpcbiAqIGBwYXJlbnRWZXJzaW9uYCBzZW1hbnRpY3M6XG4gKiAgIC0gbG9jYWwtb25seSBjaGFuZ2VzIGFuZCBsb2NhbC13aW5zIGNvbmZsaWN0cyBuYW1lIHRoZSAqaW5kZXgqIGhlYWQgKG9yXG4gKiAgICAgYG51bGxgIGZvciBicmFuZC1uZXcgcGF0aHMpIFx1MjAxNCBkZWxpYmVyYXRlbHkgc3RhbGUgd2hlbiBhIGNvbmZsaWN0IHdhc1xuICogICAgIHByZWRpY3RlZCwgc28gdGhlIERPIGFyYml0cmF0ZXMgYW5kIHByZXNlcnZlcyB0aGUgbG9zaW5nIHJlbW90ZVxuICogICAgIGNvbnRlbnQgc2VydmVyLXNpZGU7XG4gKiAgIC0gY29uZmxpY3QtY29weSBwdXNoZXMgbmFtZSB0aGUgKnJlbW90ZSogaGVhZCAoZmFzdC1wYXRoOiB0aGV5IGJ1aWxkIG9uXG4gKiAgICAgdGhlIHdpbm5lciBhbmQgbXVzdCBub3QgcmUtY29uZmxpY3QpLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFB1c2hGaWxlT3Age1xuICBraW5kOiAnYWRkJyB8ICdlZGl0JyB8ICdkZWxldGUnIHwgJ3Jlc3RvcmUnIHwgJ2NvbmZsaWN0Q29weSc7XG4gIHBhdGg6IHN0cmluZztcbiAgcGFyZW50VmVyc2lvbjogc3RyaW5nIHwgbnVsbDtcbiAgLyoqIENvbnRlbnQgaGFzaDsgZGVsZXRlIG9wcyByZXVzZSB0aGUgZGVsZXRlZCBjb250ZW50J3MgaGFzaC4gKi9cbiAgaGFzaDogc3RyaW5nO1xuICBzaXplOiBudW1iZXI7XG4gIC8qKiBUcnVlIGZvciBmb2xkZXItdG9tYnN0b25lIGRlbGV0ZXMgKGBoYXNoICcnYCwgc2l6ZSAwKSBcdTIwMTQgRlItMTAgbGlmZWN5Y2xlLiAqL1xuICBpc0ZvbGRlcj86IGJvb2xlYW47XG59XG5cbi8qKiBBIGxvY2FsIHJlbmFtZSB0byBjb21taXQgYXMgb25lIGNoYWluIG1pZ3JhdGlvbiAoRlItOSkuICovXG5leHBvcnQgaW50ZXJmYWNlIFB1c2hSZW5hbWVPcCB7XG4gIGtpbmQ6ICdyZW5hbWUnO1xuICBmcm9tUGF0aDogc3RyaW5nO1xuICB0b1BhdGg6IHN0cmluZztcbiAgLyoqIFZlcnNpb24gb2YgdGhlIGBmcm9tUGF0aGAgaGVhZCB0aGlzIHJlbmFtZSBidWlsZHMgb24uICovXG4gIHBhcmVudFZlcnNpb246IHN0cmluZyB8IG51bGw7XG4gIGhhc2g6IHN0cmluZztcbiAgc2l6ZTogbnVtYmVyO1xufVxuXG5leHBvcnQgdHlwZSBQdXNoT3AgPSBQdXNoRmlsZU9wIHwgUHVzaFJlbmFtZU9wO1xuXG4vKiogUmVtb3RlIGNvbnRlbnQgdGhpcyBkZXZpY2Ugc2hvdWxkIGZldGNoIGFuZCBtYXRlcmlhbGl6ZSB2aWEgYGFwcGx5UHVsbGAuICovXG5leHBvcnQgaW50ZXJmYWNlIFB1bGxGaWxlT3Age1xuICBraW5kOiAnYWRkJyB8ICdlZGl0JyB8ICdkZWxldGUnIHwgJ3Jlc3RvcmUnO1xuICBwYXRoOiBzdHJpbmc7XG4gIGhhc2g6IHN0cmluZztcbiAgc2l6ZTogbnVtYmVyO1xuICB2ZXJzaW9uOiBzdHJpbmc7XG4gIGNsb2NrOiBMb2dpY2FsQ2xvY2s7XG4gIC8qKiBUcnVlIGZvciB0b21ic3RvbmVzIChraW5kIGAnZGVsZXRlJ2ApLiAqL1xuICBkZWxldGVkOiBib29sZWFuO1xuICAvKiogVHJ1ZSBmb3IgZW1wdHktZm9sZGVyIHBsYWNlaG9sZGVyIHB1bGxzIChGUi0xMCkgXHUyMDE0IG1hdGVyaWFsaXplIHdpdGggYGVuc3VyZURpcmAuICovXG4gIGlzRm9sZGVyPzogYm9vbGVhbjtcbn1cblxuLyoqIEEgcmVtb3RlIHJlbmFtZSB0byBmb2xsb3cgbG9jYWxseSAoZGV0ZWN0ZWQgYnkgaGFzaCBjb3JyZWxhdGlvbikuICovXG5leHBvcnQgaW50ZXJmYWNlIFB1bGxSZW5hbWVPcCB7XG4gIGtpbmQ6ICdyZW5hbWUnO1xuICBmcm9tUGF0aDogc3RyaW5nO1xuICB0b1BhdGg6IHN0cmluZztcbiAgaGFzaDogc3RyaW5nO1xuICBzaXplOiBudW1iZXI7XG4gIHZlcnNpb246IHN0cmluZztcbiAgY2xvY2s6IExvZ2ljYWxDbG9jaztcbn1cblxuZXhwb3J0IHR5cGUgUHVsbE9wID0gUHVsbEZpbGVPcCB8IFB1bGxSZW5hbWVPcDtcblxuLyoqXG4gKiBPbmUgYXJiaXRyYXRlZCBjb25mbGljdC4gYGxvc2VyQ29udGVudGAgaXMgYCdub25lJ2Agd2hlbiB0aGUgbG9zaW5nIHNpZGVcbiAqIHdhcyBhIGRlbGV0aW9uIChub3RoaW5nIHRvIHByZXNlcnZlKS4gV2hlbiB0aGUgbG9jYWwgY29udGVudCBsb3N0IGFuZCBoYWRcbiAqIGNvbnRlbnQsIGBjb25mbGljdENvcHlQYXRoYCBuYW1lcyB3aGVyZSB0aGUgcGxhbiBwcmVzZXJ2ZXMgaXQgKHRoZSBwdXNoXG4gKiBpdHNlbGYgaXMgaW4gYFN5bmNQbGFuLnB1c2hlc2Agd2l0aCBraW5kIGAnY29uZmxpY3RDb3B5J2ApLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIENvbmZsaWN0T3Age1xuICBwYXRoOiBzdHJpbmc7XG4gIHJlYXNvbjogQ29uZmxpY3RSZWFzb247XG4gIHdpbm5lcjogJ2xvY2FsJyB8ICdyZW1vdGUnO1xuICBsb3NlckNvbnRlbnQ6ICdsb2NhbCcgfCAncmVtb3RlJyB8ICdub25lJztcbiAgY29uZmxpY3RDb3B5UGF0aD86IHN0cmluZztcbiAgcmVtb3RlOiB7IHZlcnNpb246IHN0cmluZzsgaGFzaDogc3RyaW5nOyBzaXplOiBudW1iZXI7IGRlbGV0ZWQ6IGJvb2xlYW47IGNsb2NrOiBMb2dpY2FsQ2xvY2sgfTtcbiAgLyoqIFRoZSB0ZW50YXRpdmUgY2xvY2sgdGhlIGxvY2FsIHNpZGUgd2FzIGFyYml0cmF0ZWQgd2l0aC4gKi9cbiAgbG9jYWxDbG9jazogTG9naWNhbENsb2NrO1xufVxuXG4vKipcbiAqIFRoZSBjb21wbGV0ZSByZWNvbmNpbGlhdGlvbiByZXN1bHQgZm9yIG9uZSBzeW5jIGN5Y2xlLiBPcHMgYXJlIHNvcnRlZCBieVxuICogdGFyZ2V0IHBhdGggKHJlbmFtZXMgYnkgYHRvUGF0aGApOyBldmVyeSBhcnJheSBtYXkgYmUgZW1wdHkuIGBwdXNoZXNgIGFuZFxuICogYHB1bGxzYCBhcmUgaW5kZXBlbmRlbnQgXHUyMDE0IGEgcGF0aCBhcHBlYXJzIGF0IG1vc3Qgb25jZSBpbiBlYWNoLiBQdXNoZXMgYXJlXG4gKiBOT1QgYXBwbGllZCB0byB0aGUgbG9jYWwgaW5kZXggdW50aWwgdGhlIHNlcnZlciBhY2tzIHRoZW07IHB1bGxzIGFyZVxuICogYXBwbGllZCBieSBgYXBwbHlQdWxsYCAoYGVuZ2luZS50c2ApLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFN5bmNQbGFuIHtcbiAgLyoqIENvbW1pdHMgdG8gc2VuZCwgaW4gb3JkZXIuICovXG4gIHB1c2hlczogUHVzaE9wW107XG4gIC8qKiBSZW1vdGUgY2hhbmdlcyB0byBtYXRlcmlhbGl6ZSwgaW4gb3JkZXIuICovXG4gIHB1bGxzOiBQdWxsT3BbXTtcbiAgLyoqIENvbmZsaWN0cyB0aGF0IHdlcmUgYXJiaXRyYXRlZCAoaW5mb3JtYXRpb25hbDsgc2lkZSBlZmZlY3RzIGxpdmUgaW4gcHVzaGVzL3B1bGxzKS4gKi9cbiAgY29uZmxpY3RzOiBDb25mbGljdE9wW107XG4gIC8qKiBFbXB0eS1mb2xkZXIgcGxhY2Vob2xkZXIgcGF0aHMgdG8gY3JlYXRlIHJlbW90ZWx5IChGUi0xMCkuICovXG4gIGZvbGRlclB1c2hlczogc3RyaW5nW107XG59XG5cbi8qKiBJbnRlcm5hbDogYSBsb2NhbCBjYW5kaWRhdGUgKGFkZGVkL21vZGlmaWVkL2RlbGV0ZWQpIHVuaWZpZWQgZm9yIHJlc29sdXRpb24uICovXG5pbnRlcmZhY2UgTG9jYWxDYW5kaWRhdGUge1xuICBwYXRoOiBzdHJpbmc7XG4gIGtpbmQ6ICdhZGQnIHwgJ2VkaXQnIHwgJ3Jlc3RvcmUnIHwgJ2RlbGV0ZSc7XG4gIGhhc2g6IHN0cmluZztcbiAgc2l6ZTogbnVtYmVyO1xuICAvKiogRm9sZGVyLXBsYWNlaG9sZGVyIGRlbGV0aW9ucyAoYHNjYW4uZm9sZGVyRGVsZXRpb25zYCkgcmVzb2x2ZSBhcyB0b21ic3RvbmVzLiAqL1xuICBpc0ZvbGRlcj86IGJvb2xlYW47XG59XG5cbmNvbnN0IFpFUk9fQ0xPQ0s6IExvZ2ljYWxDbG9jayA9IHsgY291bnRlcjogMCwgZGV2aWNlSWQ6ICcnIH07XG5cbi8qKlxuICogQ29tcHV0ZSB0aGUgc3luYyBwbGFuLiBTZWUgdGhlIG1vZHVsZSBkb2MgZm9yIHRoZSBtb2RlbCBhbmQgdGhlIG9wXG4gKiBzZW1hbnRpY3MuIFRocm93cyBub3RoaW5nIG9uIG9yZGluYXJ5IGRpdmVyZ2VuY2UgXHUyMDE0IGNvbmZsaWN0cyBhcmUgZGF0YSxcbiAqIG5vdCBlcnJvcnMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb21wdXRlU3luY1BsYW4oaW5wdXQ6IFN5bmNQbGFuSW5wdXQpOiBTeW5jUGxhbiB7XG4gIGNvbnN0IHsgbG9jYWxDaGFuZ2VzLCBpbmRleCwgdGhpc0RldmljZUlkLCB0aGlzRGV2aWNlTmFtZSwgbm93IH0gPSBpbnB1dDtcbiAgY29uc3QgbWFuaWZlc3QgPSBbLi4uaW5wdXQubWFuaWZlc3RdLnNvcnQoKGEsIGIpID0+IGNvbXBhcmVTdHJpbmdzKGEucGF0aCwgYi5wYXRoKSk7XG4gIGNvbnN0IG1hbmlmZXN0QnlQYXRoID0gbmV3IE1hcChtYW5pZmVzdC5tYXAoKGVudHJ5KSA9PiBbZW50cnkucGF0aCwgZW50cnldKSk7XG5cbiAgY29uc3QgcHVzaGVzOiBQdXNoT3BbXSA9IFtdO1xuICBjb25zdCBwdWxsczogUHVsbE9wW10gPSBbXTtcbiAgY29uc3QgY29uZmxpY3RzOiBDb25mbGljdE9wW10gPSBbXTtcblxuICAvLyBFdmVyeSBwYXRoIHRoZSBsb2NhbCBzaWRlIGRpdmVyZ2VkIG9uIChzY2FuIGJ1Y2tldHMgKyBib3RoIGVuZHMgb2YgcmVuYW1lcykuXG4gIGNvbnN0IGxvY2FsUGF0aHMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgZm9yIChjb25zdCBjIG9mIGxvY2FsQ2hhbmdlcy5hZGRlZCkgbG9jYWxQYXRocy5hZGQoYy5wYXRoKTtcbiAgZm9yIChjb25zdCBjIG9mIGxvY2FsQ2hhbmdlcy5tb2RpZmllZCkgbG9jYWxQYXRocy5hZGQoYy5wYXRoKTtcbiAgZm9yIChjb25zdCBkIG9mIGxvY2FsQ2hhbmdlcy5kZWxldGVkKSBsb2NhbFBhdGhzLmFkZChkLnBhdGgpO1xuICBmb3IgKGNvbnN0IHIgb2YgbG9jYWxDaGFuZ2VzLnJlbmFtZWQpIHtcbiAgICBsb2NhbFBhdGhzLmFkZChyLmZyb20pO1xuICAgIGxvY2FsUGF0aHMuYWRkKHIudG8pO1xuICB9XG4gIGZvciAoY29uc3QgZiBvZiBsb2NhbENoYW5nZXMuZm9sZGVyRGVsZXRpb25zKSBsb2NhbFBhdGhzLmFkZChmLnBhdGgpO1xuXG4gIC8vIFBhdGhzIGFscmVhZHkgY29uc3VtZWQgYnkgYW4gZWFybGllciBwaGFzZSAocmVuYW1lIGNvcnJlbGF0aW9uIGV0Yy4pLlxuICBjb25zdCBjb25zdW1lZCA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuXG4gIGNvbnN0IHBhdGhFeGlzdHMgPSAocGF0aDogc3RyaW5nKTogYm9vbGVhbiA9PiBwYXRoIGluIGluZGV4IHx8IG1hbmlmZXN0QnlQYXRoLmhhcyhwYXRoKTtcblxuICAvLyAtLS0gUGhhc2UgQTogbG9jYWwgcmVuYW1lcyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgLy8gVW5jb250ZXN0ZWQ6IG9uZSBQdXNoUmVuYW1lT3AuIENvbnRlc3RlZCAocmVtb3RlIGNoYW5nZWQgYXQgZWl0aGVyIGVuZCk6XG4gIC8vIGRlY29tcG9zZSBcdTIwMTQgdGhlIGBmcm9tYCBzaWRlIGlzIHJlc29sdmVkIG9uIGl0cyBvd24gKHVzdWFsbHkgdG9tYnN0b25lZFxuICAvLyBvciBwdWxsZWQpLCB0aGUgcmVuYW1lZCBjb250ZW50IGlzIHBsYWNlZCBhdCBgdG9gIHRocm91Z2ggdGhlIGdlbmVyaWNcbiAgLy8gY29udGVudCBtYWNoaW5lcnkuIENvbnRlbnQgaXMgbmV2ZXIgbG9zdCBlaXRoZXIgd2F5LlxuICBmb3IgKGNvbnN0IHJlbmFtZSBvZiBbLi4ubG9jYWxDaGFuZ2VzLnJlbmFtZWRdLnNvcnQoKGEsIGIpID0+IGNvbXBhcmVTdHJpbmdzKGEuZnJvbSwgYi5mcm9tKSkpIHtcbiAgICBjb25zdCBpbmRleEZyb20gPSBpbmRleFtyZW5hbWUuZnJvbV07XG4gICAgY29uc3QgaW5kZXhUbyA9IGluZGV4W3JlbmFtZS50b107XG4gICAgY29uc3QgcmVtb3RlRnJvbSA9IG1hbmlmZXN0QnlQYXRoLmdldChyZW5hbWUuZnJvbSk7XG4gICAgY29uc3QgcmVtb3RlVG8gPSBtYW5pZmVzdEJ5UGF0aC5nZXQocmVuYW1lLnRvKTtcblxuICAgIGNvbnN0IGZyb21DaGFuZ2VkID0gcmVtb3RlRnJvbVxuICAgICAgPyByZW1vdGVFbnRyeUNoYW5nZWQoaW5kZXhGcm9tLCByZW1vdGVGcm9tKVxuICAgICAgOiBpbmRleEZyb20/LmRlbGV0ZWRBdCA9PT0gdW5kZWZpbmVkOyAvLyBhYnNlbnQgcmVtb3RlbHkgKyBsaXZlIGxvY2FsbHkgXHUyMUQyIGNoYW5nZWRcbiAgICBjb25zdCB0b0NoYW5nZWQgPSByZW1vdGVUb1xuICAgICAgPyByZW1vdGVFbnRyeUNoYW5nZWQoaW5kZXhUbywgcmVtb3RlVG8pXG4gICAgICA6IGZhbHNlOyAvLyBhYnNlbnQgcmVtb3RlbHkgXHUyMUQyIG5vdGhpbmcgdG8gcmFjZSBhdCBgdG9gXG5cbiAgICBpZiAoIWZyb21DaGFuZ2VkICYmICF0b0NoYW5nZWQpIHtcbiAgICAgIHB1c2hlcy5wdXNoKHtcbiAgICAgICAga2luZDogJ3JlbmFtZScsXG4gICAgICAgIGZyb21QYXRoOiByZW5hbWUuZnJvbSxcbiAgICAgICAgdG9QYXRoOiByZW5hbWUudG8sXG4gICAgICAgIHBhcmVudFZlcnNpb246IGluZGV4RnJvbT8udmVyc2lvbklkID8/IG51bGwsXG4gICAgICAgIGhhc2g6IHJlbmFtZS5oYXNoLFxuICAgICAgICBzaXplOiByZW5hbWUuc2l6ZSxcbiAgICAgIH0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgLy8gYGZyb21gIHNpZGUgb2YgYSBjb250ZXN0ZWQgcmVuYW1lOlxuICAgIGlmICghZnJvbUNoYW5nZWQpIHtcbiAgICAgIC8vIE5vdGhpbmcgcmVtb3RlIHRoZXJlIFx1MjAxNCB0aGUgbW92ZSBpdHNlbGYgcmVtb3ZlcyB0aGUgb2xkIHBhdGguXG4gICAgICBpZiAoaW5kZXhGcm9tICYmIGluZGV4RnJvbS5kZWxldGVkQXQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICBwdXNoZXMucHVzaCh7XG4gICAgICAgICAga2luZDogJ2RlbGV0ZScsXG4gICAgICAgICAgcGF0aDogcmVuYW1lLmZyb20sXG4gICAgICAgICAgcGFyZW50VmVyc2lvbjogaW5kZXhGcm9tLnZlcnNpb25JZCxcbiAgICAgICAgICBoYXNoOiBpbmRleEZyb20uaGFzaCxcbiAgICAgICAgICBzaXplOiBpbmRleEZyb20uc2l6ZSxcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmICghcmVtb3RlRnJvbSB8fCByZW1vdGVGcm9tLmRlbGV0ZWQpIHtcbiAgICAgIC8vIFJlbW90ZSBkZWxldGVkIChvciBtaWdyYXRlZCBhd2F5IGZyb20pIGBmcm9tYCBcdTIwMTQgZGVsZXRpb24gc3RhbmRzIGZvclxuICAgICAgLy8gdGhlIG9sZCBwYXRoOyB0aGUgcmVuYW1lZCBjb250ZW50IHN1cnZpdmVzIGF0IGB0b2AuXG4gICAgICBwdWxscy5wdXNoKFxuICAgICAgICBwdWxsRmlsZSgnZGVsZXRlJywgcmVuYW1lLmZyb20sIHtcbiAgICAgICAgICBoYXNoOiByZW1vdGVGcm9tPy5oYXNoID8/IGluZGV4RnJvbT8uaGFzaCA/PyByZW5hbWUuaGFzaCxcbiAgICAgICAgICBzaXplOiByZW1vdGVGcm9tPy5zaXplID8/IGluZGV4RnJvbT8uc2l6ZSA/PyByZW5hbWUuc2l6ZSxcbiAgICAgICAgICB2ZXJzaW9uOiByZW1vdGVGcm9tPy52ZXJzaW9uID8/ICcnLFxuICAgICAgICAgIGNsb2NrOiByZW1vdGVGcm9tPy5jbG9jayA/PyBpbmRleEZyb20/LmNsb2NrID8/IFpFUk9fQ0xPQ0ssXG4gICAgICAgICAgZGVsZXRlZDogdHJ1ZSxcbiAgICAgICAgfSksXG4gICAgICApO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBSZW1vdGUgZWRpdGVkIGBmcm9tYC4gVGhlIHJlbW90ZSBlZGl0IGtlZXBzIHRoZSBvbGQgcGF0aDsgdGhlIG1vdmVkXG4gICAgICAvLyBjb250ZW50IGlzIHBsYWNlZCBhdCBgdG9gIGJlbG93IFx1MjAxNCBhIHJlbmFtZS1yYWNlIHRoZSBsb2NhbCBzaWRlXG4gICAgICAvLyBjb25jZWRlcyB1bmxlc3MgaXRzIGNsb2NrIHdpbnMgdGhlIHJlbmFtZSBwdXNoLlxuICAgICAgY29uc3QgbG9jYWxDbG9jayA9IG5leHRDbG9jayhpbmRleEZyb20/LmNsb2NrLCB0aGlzRGV2aWNlSWQpO1xuICAgICAgaWYgKGNvbXBhcmVDbG9ja3MocmVtb3RlRnJvbS5jbG9jaywgbG9jYWxDbG9jaykgPiAwKSB7XG4gICAgICAgIHB1bGxzLnB1c2gocHVsbEZpbGUoJ2VkaXQnLCByZW5hbWUuZnJvbSwgcmVtb3RlRnJvbSkpO1xuICAgICAgICBjb25mbGljdHMucHVzaCh7XG4gICAgICAgICAgcGF0aDogcmVuYW1lLmZyb20sXG4gICAgICAgICAgcmVhc29uOiAncmVuYW1lLXJhY2UnLFxuICAgICAgICAgIHdpbm5lcjogJ3JlbW90ZScsXG4gICAgICAgICAgLy8gTG9jYWwgY29udGVudCBpcyBwcmVzZXJ2ZWQgYnkgdGhlIHJlbmFtZSBpdHNlbGYgKHB1c2hlZCBhdCBgdG9gKS5cbiAgICAgICAgICBsb3NlckNvbnRlbnQ6ICdsb2NhbCcsXG4gICAgICAgICAgcmVtb3RlOiByZW1vdGVTdW1tYXJ5KHJlbW90ZUZyb20pLFxuICAgICAgICAgIGxvY2FsQ2xvY2ssXG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcHVzaGVzLnB1c2goe1xuICAgICAgICAgIGtpbmQ6ICdyZW5hbWUnLFxuICAgICAgICAgIGZyb21QYXRoOiByZW5hbWUuZnJvbSxcbiAgICAgICAgICB0b1BhdGg6IHJlbmFtZS50byxcbiAgICAgICAgICBwYXJlbnRWZXJzaW9uOiBpbmRleEZyb20/LnZlcnNpb25JZCA/PyBudWxsLFxuICAgICAgICAgIGhhc2g6IHJlbmFtZS5oYXNoLFxuICAgICAgICAgIHNpemU6IHJlbmFtZS5zaXplLFxuICAgICAgICB9KTtcbiAgICAgICAgY29uZmxpY3RzLnB1c2goe1xuICAgICAgICAgIHBhdGg6IHJlbmFtZS5mcm9tLFxuICAgICAgICAgIHJlYXNvbjogJ3JlbmFtZS1yYWNlJyxcbiAgICAgICAgICB3aW5uZXI6ICdsb2NhbCcsXG4gICAgICAgICAgbG9zZXJDb250ZW50OiAncmVtb3RlJyxcbiAgICAgICAgICByZW1vdGU6IHJlbW90ZVN1bW1hcnkocmVtb3RlRnJvbSksXG4gICAgICAgICAgbG9jYWxDbG9jayxcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnRpbnVlOyAvLyB0aGUgcmVuYW1lIHB1c2ggY2FycmllcyB0aGUgY29udGVudDsgbm8gYHRvYCBvcCBuZWVkZWRcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBgdG9gIHNpZGUgb2YgYSBjb250ZXN0ZWQgcmVuYW1lOlxuICAgIGlmICghdG9DaGFuZ2VkKSB7XG4gICAgICBwdXNoZXMucHVzaCh7XG4gICAgICAgIGtpbmQ6IGluZGV4VG8/LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkID8gJ3Jlc3RvcmUnIDogJ2FkZCcsXG4gICAgICAgIHBhdGg6IHJlbmFtZS50byxcbiAgICAgICAgcGFyZW50VmVyc2lvbjogaW5kZXhUbz8udmVyc2lvbklkID8/IG51bGwsXG4gICAgICAgIGhhc2g6IHJlbmFtZS5oYXNoLFxuICAgICAgICBzaXplOiByZW5hbWUuc2l6ZSxcbiAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXNvbHZlQ29udGVzdGVkUGF0aChyZW5hbWUudG8sIGluZGV4VG8sIHJlbW90ZVRvIGFzIFJlbW90ZUZpbGUsIHtcbiAgICAgICAgcGF0aDogcmVuYW1lLnRvLFxuICAgICAgICBraW5kOiBpbmRleFRvPy5kZWxldGVkQXQgIT09IHVuZGVmaW5lZCA/ICdyZXN0b3JlJyA6ICdhZGQnLFxuICAgICAgICBoYXNoOiByZW5hbWUuaGFzaCxcbiAgICAgICAgc2l6ZTogcmVuYW1lLnNpemUsXG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICAvLyAtLS0gUGhhc2UgQjogcmVtb3RlIHJlbmFtZXMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgLy8gQSBwYXRoIGxpdmUgaW4gdGhlIGluZGV4IGJ1dCBBQlNFTlQgZnJvbSB0aGUgbWFuaWZlc3Qgd2FzIG1pZ3JhdGVkIGJ5IHRoZVxuICAvLyBhdXRob3JpdHkgKHRvbWJzdG9uZXMgYXBwZWFyIGluIHRoZSBtYW5pZmVzdCB3aXRoIGRlbGV0ZWQ6dHJ1ZSBcdTIwMTQgb25seSBhXG4gIC8vIHJlbmFtZSByZW1vdmVzIGEgcGF0aCkuIENvcnJlbGF0ZSBieSBjb250ZW50IGhhc2ggYWdhaW5zdCBuZXcgbWFuaWZlc3RcbiAgLy8gcGF0aHMsIHNhbWUtcGFyZW50IHByZWZlcnJlZCwgc21hbGxlc3QgcGF0aCB3aXRoaW4gYSBwcmVmZXJlbmNlIGNsYXNzLlxuICBmb3IgKGNvbnN0IGZyb20gb2YgT2JqZWN0LmtleXMoaW5kZXgpXG4gICAgLmZpbHRlcigocCkgPT4ge1xuICAgICAgY29uc3QgZW50cnkgPSBpbmRleFtwXSBhcyBMb2NhbEluZGV4RW50cnk7XG4gICAgICByZXR1cm4gZW50cnkuZGVsZXRlZEF0ID09PSB1bmRlZmluZWQgJiYgIWVudHJ5LmlzRm9sZGVyO1xuICAgIH0pXG4gICAgLnNvcnQoY29tcGFyZVN0cmluZ3MpKSB7XG4gICAgaWYgKGxvY2FsUGF0aHMuaGFzKGZyb20pIHx8IGNvbnN1bWVkLmhhcyhmcm9tKSkgY29udGludWU7XG4gICAgaWYgKG1hbmlmZXN0QnlQYXRoLmhhcyhmcm9tKSkgY29udGludWU7IC8vIHByZXNlbnQgKGxpdmUgb3IgdG9tYnN0b25lZCkgXHUyMUQyIG5vdCBtaWdyYXRlZFxuICAgIGNvbnN0IGVudHJ5ID0gaW5kZXhbZnJvbV0gYXMgTG9jYWxJbmRleEVudHJ5O1xuXG4gICAgbGV0IGJlc3Q6IFJlbW90ZUZpbGUgfCB1bmRlZmluZWQ7XG4gICAgbGV0IGJlc3RTYW1lRGlyID0gZmFsc2U7XG4gICAgZm9yIChjb25zdCBjYW5kaWRhdGUgb2YgbWFuaWZlc3QpIHtcbiAgICAgIGlmIChjYW5kaWRhdGUuZGVsZXRlZCkgY29udGludWU7XG4gICAgICBpZiAobG9jYWxQYXRocy5oYXMoY2FuZGlkYXRlLnBhdGgpIHx8IGNvbnN1bWVkLmhhcyhjYW5kaWRhdGUucGF0aCkpIGNvbnRpbnVlO1xuICAgICAgY29uc3Qga25vd24gPSBpbmRleFtjYW5kaWRhdGUucGF0aF07XG4gICAgICBpZiAoa25vd24gIT09IHVuZGVmaW5lZCAmJiBrbm93bi5kZWxldGVkQXQgPT09IHVuZGVmaW5lZCkgY29udGludWU7IC8vIHRhcmdldCBub3QgbmV3XG4gICAgICBpZiAoY2FuZGlkYXRlLmhhc2ggIT09IGVudHJ5Lmhhc2gpIGNvbnRpbnVlO1xuICAgICAgY29uc3Qgc2FtZURpciA9IHBhcmVudFBhdGgoY2FuZGlkYXRlLnBhdGgpID09PSBwYXJlbnRQYXRoKGZyb20pO1xuICAgICAgaWYgKGJlc3QgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICBiZXN0ID0gY2FuZGlkYXRlO1xuICAgICAgICBiZXN0U2FtZURpciA9IHNhbWVEaXI7XG4gICAgICB9IGVsc2UgaWYgKHNhbWVEaXIgJiYgIWJlc3RTYW1lRGlyKSB7XG4gICAgICAgIGJlc3QgPSBjYW5kaWRhdGU7XG4gICAgICAgIGJlc3RTYW1lRGlyID0gdHJ1ZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoYmVzdCkge1xuICAgICAgcHVsbHMucHVzaCh7XG4gICAgICAgIGtpbmQ6ICdyZW5hbWUnLFxuICAgICAgICBmcm9tUGF0aDogZnJvbSxcbiAgICAgICAgdG9QYXRoOiBiZXN0LnBhdGgsXG4gICAgICAgIGhhc2g6IGJlc3QuaGFzaCxcbiAgICAgICAgc2l6ZTogYmVzdC5zaXplLFxuICAgICAgICB2ZXJzaW9uOiBiZXN0LnZlcnNpb24sXG4gICAgICAgIGNsb2NrOiBiZXN0LmNsb2NrLFxuICAgICAgfSk7XG4gICAgICBjb25zdW1lZC5hZGQoZnJvbSk7XG4gICAgICBjb25zdW1lZC5hZGQoYmVzdC5wYXRoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gQWJzZW50IHdpdGhvdXQgY29ycmVsYXRpb246IHRoZSBhdXRob3JpdHkgbm8gbG9uZ2VyIGtub3dzIHRoZSBwYXRoLlxuICAgICAgLy8gVHJlYXQgYXMgYSByZW1vdGUgZGVsZXRlIHdpdGggdW5rbm93biBoZWFkIHZlcnNpb24gKCcnIFx1MjAxNCB0aGUgbmV4dFxuICAgICAgLy8gZnVsbCBtYW5pZmVzdCBoZWFscyB0aGUgdmVyc2lvbiBpZCkuIFRoaXMgYWxzbyBjb3ZlcnMgcmVtb3RlXG4gICAgICAvLyByZW5hbWUrZWRpdCwgd2hpY2ggZ2VudWluZWx5IGlzIGRlbGV0ZSArIGFkZC5cbiAgICAgIHB1bGxzLnB1c2goXG4gICAgICAgIHB1bGxGaWxlKCdkZWxldGUnLCBmcm9tLCB7XG4gICAgICAgICAgaGFzaDogZW50cnkuaGFzaCxcbiAgICAgICAgICBzaXplOiBlbnRyeS5zaXplLFxuICAgICAgICAgIHZlcnNpb246ICcnLFxuICAgICAgICAgIGNsb2NrOiBlbnRyeS5jbG9jayxcbiAgICAgICAgICBkZWxldGVkOiB0cnVlLFxuICAgICAgICB9KSxcbiAgICAgICk7XG4gICAgICBjb25zdW1lZC5hZGQoZnJvbSk7XG4gICAgfVxuICB9XG5cbiAgLy8gLS0tIFBoYXNlIEM6IHJlbWFpbmluZyByZW1vdGUtb25seSBjaGFuZ2VzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gIGZvciAoY29uc3QgcmVtb3RlIG9mIG1hbmlmZXN0KSB7XG4gICAgaWYgKGxvY2FsUGF0aHMuaGFzKHJlbW90ZS5wYXRoKSB8fCBjb25zdW1lZC5oYXMocmVtb3RlLnBhdGgpKSBjb250aW51ZTtcbiAgICBjb25zdCBlbnRyeSA9IGluZGV4W3JlbW90ZS5wYXRoXTtcbiAgICBpZiAoIXJlbW90ZUVudHJ5Q2hhbmdlZChlbnRyeSwgcmVtb3RlKSkgY29udGludWU7XG4gICAgaWYgKGVudHJ5ID09PSB1bmRlZmluZWQpIHtcbiAgICAgIGlmICghcmVtb3RlLmRlbGV0ZWQpIHtcbiAgICAgICAgcHVsbHMucHVzaChwdWxsRmlsZSgnYWRkJywgcmVtb3RlLnBhdGgsIHJlbW90ZSkpO1xuICAgICAgICBjb25zdW1lZC5hZGQocmVtb3RlLnBhdGgpO1xuICAgICAgfVxuICAgICAgLy8gZGVsZXRlZCArIG5ldmVyIGtub3duIGxvY2FsbHkgXHUyMUQyIG5vdGhpbmcgdG8gZG9cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAocmVtb3RlLmRlbGV0ZWQpIHtcbiAgICAgIHB1bGxzLnB1c2gocHVsbEZpbGUoJ2RlbGV0ZScsIHJlbW90ZS5wYXRoLCByZW1vdGUpKTsgLy8gaW5jbHVkZXMgdG9tYnN0b25lXHUyMTkydG9tYnN0b25lIHZlcnNpb24gY2F0Y2gtdXBcbiAgICB9IGVsc2UgaWYgKGVudHJ5LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBwdWxscy5wdXNoKHB1bGxGaWxlKCdyZXN0b3JlJywgcmVtb3RlLnBhdGgsIHJlbW90ZSkpO1xuICAgIH0gZWxzZSB7XG4gICAgICBwdWxscy5wdXNoKHB1bGxGaWxlKCdlZGl0JywgcmVtb3RlLnBhdGgsIHJlbW90ZSkpO1xuICAgIH1cbiAgICBjb25zdW1lZC5hZGQocmVtb3RlLnBhdGgpO1xuICB9XG5cbiAgLy8gLS0tIFBoYXNlIEQ6IGxvY2FsIGNhbmRpZGF0ZXMgKGxvY2FsLW9ubHkgcHVzaGVzICsgYm90aC1jaGFuZ2VkKSAtLS0tLS0tXG4gIGNvbnN0IGNhbmRpZGF0ZXM6IExvY2FsQ2FuZGlkYXRlW10gPSBbXG4gICAgLi4ubG9jYWxDaGFuZ2VzLmFkZGVkLm1hcCgoYykgPT4gKHsgLi4uYywga2luZDogJ2FkZCcgYXMgY29uc3QgfSkpLFxuICAgIC4uLmxvY2FsQ2hhbmdlcy5tb2RpZmllZC5tYXAoKGMpID0+ICh7XG4gICAgICAuLi5jLFxuICAgICAga2luZDogaW5kZXhbYy5wYXRoXT8uZGVsZXRlZEF0ICE9PSB1bmRlZmluZWQgPyAoJ3Jlc3RvcmUnIGFzIGNvbnN0KSA6ICgnZWRpdCcgYXMgY29uc3QpLFxuICAgIH0pKSxcbiAgICAuLi5sb2NhbENoYW5nZXMuZGVsZXRlZC5tYXAoKGQpOiBMb2NhbENhbmRpZGF0ZSA9PiAoeyAuLi5kLCBraW5kOiAnZGVsZXRlJyB9KSksXG4gICAgLy8gRm9sZGVyIHBsYWNlaG9sZGVycyB3aG9zZSBkaXJlY3RvcnkgdmFuaXNoZWQ6IHRvbWJzdG9uZSBwdXNoZXMuIFRoZXlcbiAgICAvLyBjYXJyeSBubyBjb250ZW50IChoYXNoICcnL3NpemUgMCkgYW5kIGNhbiBuZXZlciBwYWlyIHdpdGggYW4gYWRkLCBzb1xuICAgIC8vIHRoZXkgam9pbiBoZXJlIHJhdGhlciB0aGFuIHRoZSBgZGVsZXRlZGAgYnVja2V0IChyZW5hbWUgY29ycmVsYXRpb24sXG4gICAgLy8gY29uZmxpY3QgY29waWVzIFx1MjAxNCBuZWl0aGVyIGFwcGxpZXMgdG8gcGxhY2Vob2xkZXJzKS5cbiAgICAuLi5sb2NhbENoYW5nZXMuZm9sZGVyRGVsZXRpb25zLm1hcChcbiAgICAgIChmKTogTG9jYWxDYW5kaWRhdGUgPT4gKHtcbiAgICAgICAgcGF0aDogZi5wYXRoLFxuICAgICAgICBraW5kOiAnZGVsZXRlJyxcbiAgICAgICAgaGFzaDogJycsXG4gICAgICAgIHNpemU6IDAsXG4gICAgICAgIGlzRm9sZGVyOiB0cnVlLFxuICAgICAgfSksXG4gICAgKSxcbiAgXS5zb3J0KChhLCBiKSA9PiBjb21wYXJlU3RyaW5ncyhhLnBhdGgsIGIucGF0aCkpO1xuXG4gIGZvciAoY29uc3QgY2FuZGlkYXRlIG9mIGNhbmRpZGF0ZXMpIHtcbiAgICBjb25zdCBlbnRyeSA9IGluZGV4W2NhbmRpZGF0ZS5wYXRoXTtcbiAgICBjb25zdCByZW1vdGUgPSBtYW5pZmVzdEJ5UGF0aC5nZXQoY2FuZGlkYXRlLnBhdGgpO1xuICAgIGNvbnN0IHJlbW90ZUNoYW5nZWRIZXJlID1cbiAgICAgIHJlbW90ZSAhPT0gdW5kZWZpbmVkICYmIChlbnRyeSAhPT0gdW5kZWZpbmVkID8gcmVtb3RlLnZlcnNpb24gIT09IGVudHJ5LnZlcnNpb25JZCA6ICFyZW1vdGUuZGVsZXRlZCk7XG4gICAgaWYgKCFyZW1vdGVDaGFuZ2VkSGVyZSkge1xuICAgICAgcHVzaExvY2FsKGNhbmRpZGF0ZSwgZW50cnkpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXNvbHZlQ29udGVzdGVkUGF0aChjYW5kaWRhdGUucGF0aCwgZW50cnksIHJlbW90ZSBhcyBSZW1vdGVGaWxlLCBjYW5kaWRhdGUpO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7XG4gICAgcHVzaGVzOiBwdXNoZXMuc29ydCgoYSwgYikgPT4gY29tcGFyZVN0cmluZ3Mob3BQYXRoKGEpLCBvcFBhdGgoYikpKSxcbiAgICBwdWxsczogcHVsbHMuc29ydCgoYSwgYikgPT4gY29tcGFyZVN0cmluZ3Mob3BQYXRoKGEpLCBvcFBhdGgoYikpKSxcbiAgICBjb25mbGljdHM6IGNvbmZsaWN0cy5zb3J0KChhLCBiKSA9PiBjb21wYXJlU3RyaW5ncyhhLnBhdGgsIGIucGF0aCkpLFxuICAgIGZvbGRlclB1c2hlczogWy4uLmxvY2FsQ2hhbmdlcy5lbXB0eUZvbGRlcnNdLnNvcnQoY29tcGFyZVN0cmluZ3MpLFxuICB9O1xuXG4gIC8vIC0tLSBoZWxwZXJzIChjbG9zZSBvdmVyIHRoZSBhY2N1bXVsYXRvcnMpIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIGZ1bmN0aW9uIHB1c2hMb2NhbChjYW5kaWRhdGU6IExvY2FsQ2FuZGlkYXRlLCBlbnRyeTogTG9jYWxJbmRleEVudHJ5IHwgdW5kZWZpbmVkKTogdm9pZCB7XG4gICAgaWYgKGNhbmRpZGF0ZS5raW5kID09PSAnZGVsZXRlJykge1xuICAgICAgcHVzaGVzLnB1c2goe1xuICAgICAgICBraW5kOiAnZGVsZXRlJyxcbiAgICAgICAgcGF0aDogY2FuZGlkYXRlLnBhdGgsXG4gICAgICAgIHBhcmVudFZlcnNpb246IGVudHJ5Py52ZXJzaW9uSWQgPz8gbnVsbCxcbiAgICAgICAgaGFzaDogZW50cnk/Lmhhc2ggPz8gY2FuZGlkYXRlLmhhc2gsXG4gICAgICAgIHNpemU6IGVudHJ5Py5zaXplID8/IGNhbmRpZGF0ZS5zaXplLFxuICAgICAgICAuLi4oY2FuZGlkYXRlLmlzRm9sZGVyID8geyBpc0ZvbGRlcjogdHJ1ZSB9IDoge30pLFxuICAgICAgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHB1c2hlcy5wdXNoKHtcbiAgICAgIGtpbmQ6IGNhbmRpZGF0ZS5raW5kLFxuICAgICAgcGF0aDogY2FuZGlkYXRlLnBhdGgsXG4gICAgICBwYXJlbnRWZXJzaW9uOiBlbnRyeT8udmVyc2lvbklkID8/IG51bGwsXG4gICAgICBoYXNoOiBjYW5kaWRhdGUuaGFzaCxcbiAgICAgIHNpemU6IGNhbmRpZGF0ZS5zaXplLFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIEJvdGggc2lkZXMgY2hhbmdlZCBvbmUgcGF0aC4gQXJiaXRyYXRlIHBlciBcdTAwQTc0LiBMb2NhbCBkZWxldGlvbnMgbmV2ZXIgZ2V0XG4gICAqIGEgY29uZmxpY3QgY29weSAobm8gY29udGVudCB0byBwcmVzZXJ2ZSk7IGxvY2FsICpjb250ZW50KiB0aGF0IGxvc2VzIGlzXG4gICAqIHByZXNlcnZlZCB2aWEgYSBjb25mbGljdC1jb3B5IHB1c2guXG4gICAqL1xuICBmdW5jdGlvbiByZXNvbHZlQ29udGVzdGVkUGF0aChcbiAgICBwYXRoOiBzdHJpbmcsXG4gICAgZW50cnk6IExvY2FsSW5kZXhFbnRyeSB8IHVuZGVmaW5lZCxcbiAgICByZW1vdGU6IFJlbW90ZUZpbGUsXG4gICAgbG9jYWw6IExvY2FsQ2FuZGlkYXRlLFxuICApOiB2b2lkIHtcbiAgICBjb25zdCBsb2NhbENsb2NrID0gbmV4dENsb2NrKGVudHJ5Py5jbG9jaywgdGhpc0RldmljZUlkKTtcbiAgICBjb25zdCByZW1vdGVXaW5zID0gY29tcGFyZUNsb2NrcyhyZW1vdGUuY2xvY2ssIGxvY2FsQ2xvY2spID4gMDsgLy8gMCBcdTIxRDIgbG9jYWwgKGRvY3VtZW50ZWQpXG4gICAgY29uc3Qgc3VtbWFyeSA9IHJlbW90ZVN1bW1hcnkocmVtb3RlKTtcbiAgICBjb25zdCByZWFzb246IENvbmZsaWN0UmVhc29uID1cbiAgICAgIGxvY2FsLmtpbmQgPT09ICdkZWxldGUnIHx8IHJlbW90ZS5kZWxldGVkXG4gICAgICAgID8gJ2RlbGV0ZS12cy1lZGl0J1xuICAgICAgICA6IGVudHJ5ID09PSB1bmRlZmluZWRcbiAgICAgICAgICA/ICdhZGQtdnMtYWRkJ1xuICAgICAgICAgIDogJ2NvbmN1cnJlbnQtZWRpdCc7XG5cbiAgICBpZiAobG9jYWwua2luZCA9PT0gJ2RlbGV0ZScgJiYgcmVtb3RlLmRlbGV0ZWQpIHtcbiAgICAgIC8vIEJvdGggZGVsZXRlZCBcdTIwMTQgY29udmVyZ2Ugc2lsZW50bHkgb24gdGhlIHJlbW90ZSB0b21ic3RvbmUuXG4gICAgICBwdWxscy5wdXNoKHB1bGxGaWxlKCdkZWxldGUnLCBwYXRoLCByZW1vdGUpKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAobG9jYWwua2luZCA9PT0gJ2RlbGV0ZScpIHtcbiAgICAgIC8vIExvY2FsIGRlbGV0ZSB2cyByZW1vdGUgZWRpdC5cbiAgICAgIGlmIChyZW1vdGVXaW5zKSB7XG4gICAgICAgIHB1bGxzLnB1c2gocHVsbEZpbGUoJ2VkaXQnLCBwYXRoLCByZW1vdGUpKTsgLy8gZmlsZSBpcyByZWNyZWF0ZWRcbiAgICAgICAgY29uZmxpY3RzLnB1c2goe1xuICAgICAgICAgIHBhdGgsIHJlYXNvbiwgd2lubmVyOiAncmVtb3RlJywgbG9zZXJDb250ZW50OiAnbm9uZScsXG4gICAgICAgICAgcmVtb3RlOiBzdW1tYXJ5LCBsb2NhbENsb2NrLFxuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHB1c2hlcy5wdXNoKHtcbiAgICAgICAgICBraW5kOiAnZGVsZXRlJyxcbiAgICAgICAgICBwYXRoLFxuICAgICAgICAgIHBhcmVudFZlcnNpb246IGVudHJ5Py52ZXJzaW9uSWQgPz8gbnVsbCxcbiAgICAgICAgICBoYXNoOiBlbnRyeT8uaGFzaCA/PyBsb2NhbC5oYXNoLFxuICAgICAgICAgIHNpemU6IGVudHJ5Py5zaXplID8/IGxvY2FsLnNpemUsXG4gICAgICAgICAgLi4uKGxvY2FsLmlzRm9sZGVyID8geyBpc0ZvbGRlcjogdHJ1ZSB9IDoge30pLFxuICAgICAgICB9KTtcbiAgICAgICAgY29uZmxpY3RzLnB1c2goe1xuICAgICAgICAgIHBhdGgsIHJlYXNvbiwgd2lubmVyOiAnbG9jYWwnLCBsb3NlckNvbnRlbnQ6ICdyZW1vdGUnLFxuICAgICAgICAgIHJlbW90ZTogc3VtbWFyeSwgbG9jYWxDbG9jayxcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKHJlbW90ZS5kZWxldGVkKSB7XG4gICAgICAvLyBMb2NhbCBlZGl0IHZzIHJlbW90ZSBkZWxldGUuXG4gICAgICBpZiAocmVtb3RlV2lucykge1xuICAgICAgICBwdWxscy5wdXNoKHB1bGxGaWxlKCdkZWxldGUnLCBwYXRoLCByZW1vdGUpKTtcbiAgICAgICAgY29uZmxpY3RzLnB1c2goe1xuICAgICAgICAgIHBhdGgsIHJlYXNvbiwgd2lubmVyOiAncmVtb3RlJywgbG9zZXJDb250ZW50OiAnbG9jYWwnLFxuICAgICAgICAgIGNvbmZsaWN0Q29weVBhdGg6IHB1c2hDb25mbGljdENvcHkocGF0aCwgbG9jYWwsIHJlbW90ZSksXG4gICAgICAgICAgcmVtb3RlOiBzdW1tYXJ5LCBsb2NhbENsb2NrLFxuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHB1c2hlcy5wdXNoKHtcbiAgICAgICAgICBraW5kOiBsb2NhbC5raW5kLFxuICAgICAgICAgIHBhdGgsXG4gICAgICAgICAgcGFyZW50VmVyc2lvbjogZW50cnk/LnZlcnNpb25JZCA/PyBudWxsLFxuICAgICAgICAgIGhhc2g6IGxvY2FsLmhhc2gsXG4gICAgICAgICAgc2l6ZTogbG9jYWwuc2l6ZSxcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbmZsaWN0cy5wdXNoKHtcbiAgICAgICAgICBwYXRoLCByZWFzb24sIHdpbm5lcjogJ2xvY2FsJywgbG9zZXJDb250ZW50OiAnbm9uZScsXG4gICAgICAgICAgcmVtb3RlOiBzdW1tYXJ5LCBsb2NhbENsb2NrLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBDb25jdXJyZW50IGNvbnRlbnQgKGVkaXQtdnMtZWRpdCBvciBhZGQtdnMtYWRkKS5cbiAgICBpZiAocmVtb3RlV2lucykge1xuICAgICAgcHVsbHMucHVzaChcbiAgICAgICAgcHVsbEZpbGUoZW50cnk/LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkID8gJ3Jlc3RvcmUnIDogZW50cnkgPT09IHVuZGVmaW5lZCA/ICdhZGQnIDogJ2VkaXQnLCBwYXRoLCByZW1vdGUpLFxuICAgICAgKTtcbiAgICAgIGNvbmZsaWN0cy5wdXNoKHtcbiAgICAgICAgcGF0aCwgcmVhc29uLCB3aW5uZXI6ICdyZW1vdGUnLCBsb3NlckNvbnRlbnQ6ICdsb2NhbCcsXG4gICAgICAgIGNvbmZsaWN0Q29weVBhdGg6IHB1c2hDb25mbGljdENvcHkocGF0aCwgbG9jYWwsIHJlbW90ZSksXG4gICAgICAgIHJlbW90ZTogc3VtbWFyeSwgbG9jYWxDbG9jayxcbiAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBwdXNoZXMucHVzaCh7XG4gICAgICAgIGtpbmQ6IGxvY2FsLmtpbmQsXG4gICAgICAgIHBhdGgsXG4gICAgICAgIC8vIERlbGliZXJhdGVseSB0aGUgKHN0YWxlKSBpbmRleCBwYXJlbnQ6IHRoZSBETyBtdXN0IGFyYml0cmF0ZSBhbmRcbiAgICAgICAgLy8gc3ludGhlc2l6ZSB0aGUgY29uZmxpY3QgY29weSBmb3IgdGhlIGxvc2luZyByZW1vdGUgY29udGVudC5cbiAgICAgICAgcGFyZW50VmVyc2lvbjogZW50cnk/LnZlcnNpb25JZCA/PyBudWxsLFxuICAgICAgICBoYXNoOiBsb2NhbC5oYXNoLFxuICAgICAgICBzaXplOiBsb2NhbC5zaXplLFxuICAgICAgfSk7XG4gICAgICBjb25mbGljdHMucHVzaCh7XG4gICAgICAgIHBhdGgsIHJlYXNvbiwgd2lubmVyOiAnbG9jYWwnLCBsb3NlckNvbnRlbnQ6ICdyZW1vdGUnLFxuICAgICAgICByZW1vdGU6IHN1bW1hcnksIGxvY2FsQ2xvY2ssXG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUHVzaCB0aGUgbG9zaW5nIGxvY2FsIGNvbnRlbnQgdG8gYSBjb25mbGljdC1jb3B5IHBhdGg7IHJldHVybnMgdGhlIHBhdGgsXG4gICAqIG9yIGB1bmRlZmluZWRgIHdoZW4gdGhlIGxvc2luZyBjb250ZW50IGlzIGJ5dGUtaWRlbnRpY2FsIHRvIHRoZSB3aW5uZXInc1xuICAgKiAoYSBzYW1lLWNvbnRlbnQgcmFjZSBcdTIwMTQgbm90aGluZyBkaXN0aW5jdCB0byBwcmVzZXJ2ZTsgbWF0Y2hlcyB0aGUgc2VydmVyJ3NcbiAgICogYXJiaXRyYXRpb24sIHdoaWNoIGxpa2V3aXNlIHN5bnRoZXNpemVzIG5vIGNvcHkgZm9yIGlkZW50aWNhbCBjb250ZW50KS5cbiAgICovXG4gIGZ1bmN0aW9uIHB1c2hDb25mbGljdENvcHkocGF0aDogc3RyaW5nLCBsb2NhbDogTG9jYWxDYW5kaWRhdGUsIHJlbW90ZTogUmVtb3RlRmlsZSk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgaWYgKGxvY2FsLmhhc2ggPT09IHJlbW90ZS5oYXNoKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgIGNvbnN0IGNvcHlQYXRoID0gY29uZmxpY3RDb3B5UGF0aChwYXRoLCB0aGlzRGV2aWNlTmFtZSwgbm93LCBwYXRoRXhpc3RzKTtcbiAgICBwdXNoZXMucHVzaCh7XG4gICAgICBraW5kOiAnY29uZmxpY3RDb3B5JyxcbiAgICAgIHBhdGg6IGNvcHlQYXRoLFxuICAgICAgLy8gQnVpbGQgb24gdGhlIHdpbm5pbmcgcmVtb3RlIGhlYWQ6IHRoaXMgcHVzaCBtdXN0IGZhc3QtcGF0aC5cbiAgICAgIHBhcmVudFZlcnNpb246IHJlbW90ZS52ZXJzaW9uLFxuICAgICAgaGFzaDogbG9jYWwuaGFzaCxcbiAgICAgIHNpemU6IGxvY2FsLnNpemUsXG4gICAgfSk7XG4gICAgcmV0dXJuIGNvcHlQYXRoO1xuICB9XG59XG5cbi8vIC0tLSBtb2R1bGUtbGV2ZWwgaGVscGVycyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZnVuY3Rpb24gcHVsbEZpbGUoXG4gIGtpbmQ6IFB1bGxGaWxlT3BbJ2tpbmQnXSxcbiAgcGF0aDogc3RyaW5nLFxuICByZW1vdGU6IFBpY2s8UmVtb3RlRmlsZSwgJ2hhc2gnIHwgJ3NpemUnIHwgJ3ZlcnNpb24nIHwgJ2Nsb2NrJyB8ICdpc0ZvbGRlcic+ICYge1xuICAgIGRlbGV0ZWQ/OiBib29sZWFuO1xuICB9LFxuKTogUHVsbEZpbGVPcCB7XG4gIHJldHVybiB7XG4gICAga2luZCxcbiAgICBwYXRoLFxuICAgIGhhc2g6IHJlbW90ZS5oYXNoLFxuICAgIHNpemU6IHJlbW90ZS5zaXplLFxuICAgIHZlcnNpb246IHJlbW90ZS52ZXJzaW9uLFxuICAgIGNsb2NrOiByZW1vdGUuY2xvY2ssXG4gICAgZGVsZXRlZDogcmVtb3RlLmRlbGV0ZWQgPz8ga2luZCA9PT0gJ2RlbGV0ZScsXG4gICAgLi4uKHJlbW90ZS5pc0ZvbGRlciA/IHsgaXNGb2xkZXI6IHRydWUgfSA6IHt9KSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gcmVtb3RlU3VtbWFyeShyZW1vdGU6IFJlbW90ZUZpbGUpOiBDb25mbGljdE9wWydyZW1vdGUnXSB7XG4gIHJldHVybiB7XG4gICAgdmVyc2lvbjogcmVtb3RlLnZlcnNpb24sXG4gICAgaGFzaDogcmVtb3RlLmhhc2gsXG4gICAgc2l6ZTogcmVtb3RlLnNpemUsXG4gICAgZGVsZXRlZDogcmVtb3RlLmRlbGV0ZWQsXG4gICAgY2xvY2s6IHJlbW90ZS5jbG9jayxcbiAgfTtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIHRoZSByZW1vdGUgaGVhZCBmb3IgYSBwYXRoIGRpZmZlcnMgZnJvbSB3aGF0IHRoZSBpbmRleCByZWNvcmRzLlxuICogVmVyc2lvbiBpZHMgYXJlIHRoZSBwcmltYXJ5IHNpZ25hbCAoY2xpZW50IGFuZCBETyBzaGFyZSBvbmUgaWQgc3BhY2UpO1xuICogYSBwYXRoIGFic2VudCByZW1vdGVseSBjb3VudHMgYXMgY2hhbmdlZCBvbmx5IHdoaWxlIHRoZSBpbmRleCBzdGlsbCBob2xkc1xuICogaXQgbGl2ZSBcdTIwMTQgY2FsbGVycyBkZWNpZGUgd2hhdCBhYnNlbmNlICptZWFucyogKHJlbmFtZSB2cyBkZWxldGUpLlxuICovXG5mdW5jdGlvbiByZW1vdGVFbnRyeUNoYW5nZWQoXG4gIGVudHJ5OiBMb2NhbEluZGV4RW50cnkgfCB1bmRlZmluZWQsXG4gIHJlbW90ZTogUmVtb3RlRmlsZSB8IHVuZGVmaW5lZCxcbik6IGJvb2xlYW4ge1xuICBpZiAocmVtb3RlID09PSB1bmRlZmluZWQpIHJldHVybiBmYWxzZTtcbiAgaWYgKGVudHJ5ID09PSB1bmRlZmluZWQpIHJldHVybiAhcmVtb3RlLmRlbGV0ZWQ7XG4gIHJldHVybiByZW1vdGUudmVyc2lvbiAhPT0gZW50cnkudmVyc2lvbklkO1xufVxuXG5mdW5jdGlvbiBvcFBhdGgob3A6IFB1c2hPcCB8IFB1bGxPcCk6IHN0cmluZyB7XG4gIHJldHVybiBvcC5raW5kID09PSAncmVuYW1lJyA/IG9wLnRvUGF0aCA6IG9wLnBhdGg7XG59XG5cbmZ1bmN0aW9uIGNvbXBhcmVTdHJpbmdzKGE6IHN0cmluZywgYjogc3RyaW5nKTogbnVtYmVyIHtcbiAgcmV0dXJuIGEgPCBiID8gLTEgOiBhID4gYiA/IDEgOiAwO1xufVxuIiwgIi8qKlxuICogTG9jYWwgY2hhbmdlIGRldGVjdGlvbiAoQVJDSElURUNUVVJFLm1kIFx1MDBBNzggc3RlcCAzKS5cbiAqXG4gKiBgc2NhblZhdWx0YCB3YWxrcyB0aGUgc3RvcmFnZSBhZGFwdGVyLCBhcHBsaWVzIHRoZSBzaGFyZWQgaWdub3JlIHJ1bGVzLFxuICogaGFzaGVzIG5vbi1pZ25vcmVkIGZpbGVzIChzaGEyNTYgXHUyMDE0IHNhbWUgYXMgYmxvYiBhZGRyZXNzaW5nKSBhbmQgZGlmZnNcbiAqIHRoZSByZXN1bHQgYWdhaW5zdCB0aGUgY2xpZW50J3MgYExvY2FsSW5kZXhgLiBUaGUgZGlmZiBjbGFzc2lmaWVzOlxuICpcbiAqICAgLSBgYWRkZWRgICAgIFx1MjAxNCBmaWxlIHByZXNlbnQsIHBhdGggdW5rbm93biB0byB0aGUgaW5kZXg7XG4gKiAgIC0gYG1vZGlmaWVkYCBcdTIwMTQgZmlsZSBwcmVzZW50LCBjb250ZW50IGhhc2ggZGlmZmVycyBmcm9tIHRoZSBpbmRleCBlbnRyeS5cbiAqICAgICAgICAgICAgICAgICAgQSBmaWxlIHdob3NlIGluZGV4IGVudHJ5IGlzIGEgKnRvbWJzdG9uZSogYWxzbyBsYW5kcyBoZXJlXG4gKiAgICAgICAgICAgICAgICAgIChkb2N1bWVudGVkIGRlY2lzaW9uKTogd2hldGhlciBpdCBpcyBhbiBlZGl0LW9mLWRlbGV0ZWRcbiAqICAgICAgICAgICAgICAgICAgb3IgYSBwdXJlIHJlc3VycmVjdCwgdGhlIHJlc29sdXRpb24gaXMgaWRlbnRpY2FsIFx1MjAxNCBsb2NhbFxuICogICAgICAgICAgICAgICAgICBjb250ZW50IGV4aXN0cyB0aGF0IHRoZSBpbmRleCBoZWFkIGRvZXMgbm90IHJlZmxlY3Q7XG4gKiAgIC0gYGRlbGV0ZWRgICBcdTIwMTQgaW5kZXggZW50cnkgbGl2ZSwgZmlsZSBnb25lO1xuICogICAtIGByZW5hbWVkYCAgXHUyMDE0IGEgZGVsZXRlICsgYWRkIHBhaXIgKndpdGhpbiBvbmUgc2Nhbiogd2hvc2UgY29udGVudFxuICogICAgICAgICAgICAgICAgICBoYXNoZXMgbWF0Y2ggKEFSQ0hJVEVDVFVSRSBcdTAwQTc0IHJlbmFtZSBjb3JyZWxhdGlvbikuIEFcbiAqICAgICAgICAgICAgICAgICAgcmVuYW1lIHdob3NlIGNvbnRlbnQgYWxzbyBjaGFuZ2VkIChyZW5hbWUgKyBlZGl0KSBub1xuICogICAgICAgICAgICAgICAgICBsb25nZXIgY29ycmVsYXRlcyBhbmQgZmFsbHMgYmFjayB0byBkZWxldGUgKyBhZGQgXHUyMDE0IHRoYXRcbiAqICAgICAgICAgICAgICAgICAgaXMgdGhlIGRvY3VtZW50ZWQsIGNvcnJlY3QgdjEgYmVoYXZpb3I7XG4gKiAgIC0gYGVtcHR5Rm9sZGVyc2AgXHUyMDE0IGRpcmVjdG9yaWVzIGV4aXN0aW5nIGluIHN0b3JhZ2UgYnV0IHJlcHJlc2VudGVkXG4gKiAgICAgICAgICAgICAgICAgIG5laXRoZXIgYnkgYSBsaXZlIGZvbGRlciBwbGFjZWhvbGRlciBpbiB0aGUgaW5kZXggbm9yIGJ5XG4gKiAgICAgICAgICAgICAgICAgIGFueSBmaWxlIGJlbmVhdGggdGhlbSAoRlItMTApO1xuICogICAtIGBmb2xkZXJEZWxldGlvbnNgIFx1MjAxNCBsaXZlIGZvbGRlciBwbGFjZWhvbGRlciBlbnRyaWVzIHdob3NlIGRpcmVjdG9yeVxuICogICAgICAgICAgICAgICAgICBubyBsb25nZXIgZXhpc3RzIGluIHN0b3JhZ2U6IHRoZSB1c2VyIGRlbGV0ZWQgYW4gZW1wdHlcbiAqICAgICAgICAgICAgICAgICAgZm9sZGVyIChvciBwcnVuZS1vbi1kZWxldGUgcmVtb3ZlZCBpdCwgYGVuZ2luZS50c2ApLCBhbmRcbiAqICAgICAgICAgICAgICAgICAgdGhlIGRlbGV0aW9uIG11c3QgcHJvcGFnYXRlIGFzIGEgZm9sZGVyIHRvbWJzdG9uZS4gVGhlXG4gKiAgICAgICAgICAgICAgICAgIGJ1Y2tldCBpcyBTRVBBUkFURSBmcm9tIGBkZWxldGVkYCBvbiBwdXJwb3NlOiBmb2xkZXJcbiAqICAgICAgICAgICAgICAgICAgcGxhY2Vob2xkZXJzIGNhcnJ5IG5vIGNvbnRlbnQgaGFzaCwgbXVzdCBuZXZlciBlbnRlclxuICogICAgICAgICAgICAgICAgICByZW5hbWUgY29ycmVsYXRpb24sIGFuZCByZXNvbHZlIGFzIHBsYWNlaG9sZGVyc1xuICogICAgICAgICAgICAgICAgICAoYGlzRm9sZGVyYCkgZG93bnN0cmVhbS4gQSBwbGFjZWhvbGRlciB0aGF0IG1lcmVseSBiZWNhbWVcbiAqICAgICAgICAgICAgICAgICAgaWdub3JlZCAoc2V0dGluZ3MgY2hhbmdlKSBpcyBOT1QgYSBkZWxldGlvbiBcdTIwMTQgaXQgaXNcbiAqICAgICAgICAgICAgICAgICAgc2tpcHBlZCwgZXhhY3RseSBsaWtlIGlnbm9yZWQgZmlsZXMuXG4gKlxuICogIyMgVGhlIG10aW1lK3NpemUgcHJlLWZpbHRlciAoZmFzdCBtb2RlLCB0aGUgZGVmYXVsdClcbiAqXG4gKiBSZS1oYXNoaW5nIGEgNTBrLWZpbGUgdmF1bHQgYXQgZXZlcnkgYXBwLW9wZW4gaXMgYSByZWFsIGJhdHRlcnkgY29zdCwgc29cbiAqIGZhc3QgbW9kZSBza2lwcyBoYXNoaW5nIGEgZmlsZSB3aG9zZSBgc2l6ZWAgQU5EIGBtdGltZWAgKGZyb20gdGhlIHN0b3JhZ2VcbiAqIGFkYXB0ZXIncyBgRmlsZVN0YXRgKSBleGFjdGx5IG1hdGNoIGl0cyBsaXZlIGluZGV4IGVudHJ5IFx1MjAxNCB0aGUgcmVjb3JkZWRcbiAqIGhhc2ggY2FycmllcyBmb3J3YXJkIGFzIHVuY2hhbmdlZC4gQSBmaWxlIGlzIGhhc2hlZCB3aGVuIGl0IGhhcyBubyBlbnRyeSxcbiAqIHRoZSBlbnRyeSBpcyBhIHRvbWJzdG9uZSBvciBmb2xkZXIgcGxhY2Vob2xkZXIsIHRoZSBzaXplIGRpZmZlcnMsIG9yIHRoZVxuICogbXRpbWUgZGlmZmVycyBvciBpcyB1bmtub3duIChsZWdhY3kgc3RhdGUsIHB1bGxzLCBmaXJzdCBzY2FuKS4gUmVuYW1lXG4gKiBjb3JyZWxhdGlvbiBpcyB1bmFmZmVjdGVkOiB0aGUgZGVzdGluYXRpb24gcGF0aCBvZiBhIHJlbmFtZSBhbHdheXMgbG9va3NcbiAqICdhZGRlZCcsIHNvIGl0IGlzIGFsd2F5cyBoYXNoZWQgXHUyMDE0IGNvbnRlbnQtcHJlc2VydmluZyBtb3ZlcyBzdGlsbCBwYWlyLlxuICpcbiAqIFRoZSB0cmFkZW9mZjogZmFzdCBtb2RlIHRydXN0cyB0aGUgZmlsZXN5c3RlbSBub3QgdG8gY2hhbmdlIGNvbnRlbnQgd2hpbGVcbiAqIHByZXNlcnZpbmcgYm90aCBzaXplIGFuZCBtdGltZS4gRm9yIHZlcmlmaWNhdGlvbiAoYHZzYSBkb2N0b3JgLCBwZXJpb2RpY1xuICogaW50ZWdyaXR5IGNoZWNrcykgcGFzcyBgeyBtb2RlOiAnZnVsbCcgfWAgdG8gcmUtaGFzaCBldmVyeXRoaW5nLlxuICpcbiAqIFRoZSBmdW5jdGlvbiB0YWtlcyBgbm93YCBhbmQgdGhlIGlnbm9yZSBzZXR0aW5ncyBhcyBwYXJhbWV0ZXJzIChubyBoaWRkZW5cbiAqIGNsb2Nrcywgbm8gYW1iaWVudCBjb25maWcpIGFuZCByZXR1cm5zIGRldGVybWluaXN0aWNhbGx5IG9yZGVyZWQgcmVzdWx0c1xuICogKGV2ZXJ5IGJ1Y2tldCBzb3J0ZWQgYnkgcGF0aDsgcmVuYW1lcyBieSBgZnJvbWApLlxuICovXG5cbmltcG9ydCB0eXBlIHsgRmlsZVN0YXQsIFN0b3JhZ2VBZGFwdGVyIH0gZnJvbSAnLi9hZGFwdGVycy5qcyc7XG5pbXBvcnQgeyBzaGEyNTZIZXggfSBmcm9tICcuL2hhc2hpbmcuanMnO1xuaW1wb3J0IHsgaXNJZ25vcmVkLCB0eXBlIElnbm9yZVNldHRpbmdzIH0gZnJvbSAnLi9pZ25vcmUuanMnO1xuaW1wb3J0IHR5cGUgeyBMb2NhbEluZGV4LCBMb2NhbEluZGV4RW50cnkgfSBmcm9tICcuL2xvY2FsaW5kZXguanMnO1xuaW1wb3J0IHsgcGFyZW50UGF0aCB9IGZyb20gJy4vcGF0aHMuanMnO1xuXG4vKiogSW5qZWN0YWJsZSBjb250ZW50IGhhc2ggKHRoZSBkZWZhdWx0IGlzIHNoYTI1Niwgc2FtZSBhcyBibG9iIGFkZHJlc3NpbmcpLiAqL1xuZXhwb3J0IHR5cGUgSGFzaEZuID0gKGJ5dGVzOiBVaW50OEFycmF5KSA9PiBQcm9taXNlPHN0cmluZz47XG5cbi8qKiBPcHRpb25zIGZvciBgc2NhblZhdWx0YC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU2NhblZhdWx0T3B0aW9ucyB7XG4gIC8qKlxuICAgKiBgJ2Zhc3QnYCAoZGVmYXVsdCk6IGZpbGVzIHdob3NlIHNpemUrbXRpbWUgZXhhY3RseSBtYXRjaCB0aGVpciBsaXZlIGluZGV4XG4gICAqIGVudHJ5IHNraXAgcmUtaGFzaGluZy4gYCdmdWxsJ2A6IGhhc2ggZXZlcnl0aGluZyByZWdhcmRsZXNzIFx1MjAxNCBpbnRlZ3JpdHlcbiAgICogdmVyaWZpY2F0aW9uIChgdnNhIGRvY3RvcmAsIHBlcmlvZGljIGNoZWNrcykuXG4gICAqL1xuICBtb2RlPzogJ2Zhc3QnIHwgJ2Z1bGwnO1xuICAvKiogQ29udGVudCBoYXNoIG92ZXJyaWRlICh0ZXN0cyBjb3VudC9pbnNwZWN0IGhhc2hpbmcpLiBEZWZhdWx0OiBzaGEyNTZIZXguICovXG4gIGhhc2g/OiBIYXNoRm47XG4gIC8qKlxuICAgKiBCdWxrLXNjYW4gcHJvZ3Jlc3M6IGNhbGxlZCBvbmNlIHdpdGggKDAsIHRvdGFsKSBiZWZvcmUgdGhlIHdhbGsgYW5kIG9uY2VcbiAgICogcGVyIGZpbGUgYWZ0ZXJ3YXJkcyAoYGRvbmVgIGNvdW50cyBoYXNoZWQgQU5EIGZhc3QtcGF0aC1za2lwcGVkIGZpbGVzKS5cbiAgICogUHVyZSByZXBvcnRpbmcgXHUyMDE0IG5ldmVyIGFmZmVjdHMgdGhlIHNjYW4ncyBkZWNpc2lvbnMuXG4gICAqL1xuICBvblByb2dyZXNzPzogKGRvbmU6IG51bWJlciwgdG90YWw6IG51bWJlcikgPT4gdm9pZDtcbn1cblxuLyoqIEEgbG9jYWwgY29udGVudCBjaGFuZ2UgZm9yIGEgcGF0aCB0aGF0IGV4aXN0cyBpbiBzdG9yYWdlLiAqL1xuZXhwb3J0IGludGVyZmFjZSBTY2FuQ2FuZGlkYXRlIHtcbiAgcGF0aDogc3RyaW5nO1xuICBoYXNoOiBzdHJpbmc7XG4gIHNpemU6IG51bWJlcjtcbn1cblxuLyoqIEEgbG9jYWwgZGVsZXRpb246IGNhcnJpZXMgdGhlIGluZGV4J3MgdmVyc2lvbiBzbyB0aGUgdG9tYnN0b25lIGNvbW1pdCBuYW1lcyBpdHMgcGFyZW50LiAqL1xuZXhwb3J0IGludGVyZmFjZSBEZWxldGVkQ2FuZGlkYXRlIHtcbiAgcGF0aDogc3RyaW5nO1xuICAvKiogSGFzaCBvZiB0aGUgY29udGVudCBhcyBsYXN0IHN5bmNlZCAodG9tYnN0b25lcyByZXVzZSBpdCkuICovXG4gIGhhc2g6IHN0cmluZztcbiAgc2l6ZTogbnVtYmVyO1xuICAvKiogVmVyc2lvbiBpZCB0aGUgZGVsZXRpb24gY29tbWl0IGJ1aWxkcyBvbi4gKi9cbiAgdmVyc2lvbklkOiBzdHJpbmc7XG59XG5cbi8qKiBBIGRldGVjdGVkIHJlbmFtZTogc2FtZSBjb250ZW50IGhhc2ggbW92ZWQgZnJvbSBgZnJvbWAgdG8gYHRvYC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUmVuYW1lQ2FuZGlkYXRlIHtcbiAgZnJvbTogc3RyaW5nO1xuICB0bzogc3RyaW5nO1xuICBoYXNoOiBzdHJpbmc7XG4gIHNpemU6IG51bWJlcjtcbn1cblxuLyoqXG4gKiBBIGxpdmUgZm9sZGVyIHBsYWNlaG9sZGVyIHdob3NlIGRpcmVjdG9yeSB2YW5pc2hlZCBmcm9tIHN0b3JhZ2U6IHRoZVxuICogZGVsZXRpb24gbXVzdCBwcm9wYWdhdGUgYXMgYSBmb2xkZXIgdG9tYnN0b25lIChraW5kIGAnZGVsZXRlJ2AsXG4gKiBgaXNGb2xkZXI6IHRydWVgKS4gQ2FycmllcyB0aGUgcGxhY2Vob2xkZXIncyB2ZXJzaW9uIGlkIHNvIHRoZSB0b21ic3RvbmVcbiAqIGNvbW1pdCBuYW1lcyBpdHMgcGFyZW50OyBoYXNoL3NpemUgYXJlIHRoZSBwbGFjZWhvbGRlciBjb25zdGFudHNcbiAqIChgJydgL2AwYCkgYW5kIGFyZSByZS1kZXJpdmVkIGRvd25zdHJlYW0gcmF0aGVyIHRoYW4gY2FycmllZC5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBGb2xkZXJEZWxldGlvbkNhbmRpZGF0ZSB7XG4gIHBhdGg6IHN0cmluZztcbiAgLyoqIFZlcnNpb24gaWQgb2YgdGhlIHBsYWNlaG9sZGVyIGhlYWQgdGhlIHRvbWJzdG9uZSBjb21taXQgYnVpbGRzIG9uLiAqL1xuICB2ZXJzaW9uSWQ6IHN0cmluZztcbn1cblxuLyoqXG4gKiBBIGZpbGUgdGhpcyBzY2FuIGFjdHVhbGx5IHJlYWQgYW5kIGhhc2hlZCwgd2l0aCB0aGUgc3RhdCBvYnNlcnZlZCBhdCBoYXNoXG4gKiB0aW1lLiBGZWVkcyBgcmVjb3JkSGFzaGVkRmlsZXNgIHNvIHRoZSBORVhUIGZhc3Qgc2NhbiBjYW4gc2tpcCB0aGVzZSBmaWxlc1xuICogKHRoZSBtdGltZSBjYWNoZSBvbiB0aGUgaW5kZXggZW50cnkpLiBGaWxlcyBza2lwcGVkIGJ5IHRoZSBwcmUtZmlsdGVyIGFyZSxcbiAqIGJ5IGRlZmluaXRpb24sIG5vdCBoYXNoZWQgYW5kIGRvIG5vdCBhcHBlYXIgaGVyZS5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBIYXNoZWRGaWxlIHtcbiAgcGF0aDogc3RyaW5nO1xuICBoYXNoOiBzdHJpbmc7XG4gIHNpemU6IG51bWJlcjtcbiAgLyoqIEVwb2NoIG1zIFx1MjAxNCB0aGUgc3RvcmFnZSBzdGF0IGF0IGhhc2ggdGltZSAoYEZpbGVTdGF0Lm10aW1lYCkuICovXG4gIG10aW1lOiBudW1iZXI7XG59XG5cbi8qKiBUaGUgZnVsbCByZXN1bHQgb2Ygb25lIGxvY2FsIHNjYW4uIEFsbCBidWNrZXRzIHNvcnRlZCBieSBwYXRoLiAqL1xuZXhwb3J0IGludGVyZmFjZSBMb2NhbENoYW5nZXMge1xuICAvKiogVGhlIGBub3dgIHBhc3NlZCBpbiBcdTIwMTQgd2hlbiB0aGlzIHNjYW4gY29uY2VwdHVhbGx5IGhhcHBlbmVkLiAqL1xuICBzY2FubmVkQXQ6IG51bWJlcjtcbiAgYWRkZWQ6IFNjYW5DYW5kaWRhdGVbXTtcbiAgbW9kaWZpZWQ6IFNjYW5DYW5kaWRhdGVbXTtcbiAgZGVsZXRlZDogRGVsZXRlZENhbmRpZGF0ZVtdO1xuICByZW5hbWVkOiBSZW5hbWVDYW5kaWRhdGVbXTtcbiAgLyoqIEVtcHR5LWZvbGRlciBwYXRocyB0byBwdXNoIGFzIHBsYWNlaG9sZGVyIGVudHJpZXMgKEZSLTEwKS4gKi9cbiAgZW1wdHlGb2xkZXJzOiBzdHJpbmdbXTtcbiAgLyoqXG4gICAqIExpdmUgZm9sZGVyIHBsYWNlaG9sZGVycyB3aG9zZSBkaXJlY3Rvcnkgbm8gbG9uZ2VyIGV4aXN0cyBpbiBzdG9yYWdlIFx1MjAxNFxuICAgKiBmb2xkZXIgZGVsZXRpb25zIHRvIHB1c2ggYXMgdG9tYnN0b25lcyAoa2luZCBgJ2RlbGV0ZSdgLCBgaXNGb2xkZXJgKS5cbiAgICovXG4gIGZvbGRlckRlbGV0aW9uczogRm9sZGVyRGVsZXRpb25DYW5kaWRhdGVbXTtcbiAgLyoqIEV2ZXJ5IGZpbGUgdGhlIHNjYW4gaGFzaGVkIChmYXN0IG1vZGUncyBza2lwcGVkIGZpbGVzIGFyZSBhYnNlbnQpLCBzb3J0ZWQgYnkgcGF0aC4gKi9cbiAgaGFzaGVkOiBIYXNoZWRGaWxlW107XG59XG5cbi8qKlxuICogU2NhbiB0aGUgdmF1bHQgYW5kIGRpZmYgaXQgYWdhaW5zdCB0aGUgaW5kZXguXG4gKlxuICogSW4gZmFzdCBtb2RlICh0aGUgZGVmYXVsdCkgYSBmaWxlIHdob3NlIHNpemUgYW5kIG10aW1lIGJvdGggZXhhY3RseSBtYXRjaFxuICogaXRzIGxpdmUgaW5kZXggZW50cnkgaXMgTk9UIHJlLWhhc2hlZCBcdTIwMTQgdGhlIHJlY29yZGVkIGhhc2ggY2FycmllcyBmb3J3YXJkXG4gKiBhcyB1bmNoYW5nZWQgKHNlZSB0aGUgbW9kdWxlIGRvYyBmb3IgdGhlIHRyYWRlb2ZmIGFuZCB0aGUgYGZ1bGxgIGVzY2FwZVxuICogaGF0Y2gpLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc2NhblZhdWx0KFxuICBzdG9yYWdlOiBTdG9yYWdlQWRhcHRlcixcbiAgaW5kZXg6IExvY2FsSW5kZXgsXG4gIHNldHRpbmdzOiBJZ25vcmVTZXR0aW5ncyxcbiAgbm93OiBudW1iZXIsXG4gIG9wdGlvbnM6IFNjYW5WYXVsdE9wdGlvbnMgPSB7fSxcbik6IFByb21pc2U8TG9jYWxDaGFuZ2VzPiB7XG4gIGNvbnN0IGhhc2hGbiA9IG9wdGlvbnMuaGFzaCA/PyBzaGEyNTZIZXg7XG4gIGNvbnN0IG1vZGUgPSBvcHRpb25zLm1vZGUgPz8gJ2Zhc3QnO1xuICBjb25zdCBvblByb2dyZXNzID0gb3B0aW9ucy5vblByb2dyZXNzO1xuXG4gIGNvbnN0IGZpbGVzID0gYXdhaXQgc3RvcmFnZS5saXN0RmlsZXMoKTtcblxuICBjb25zdCBrZXB0OiBGaWxlU3RhdFtdID0gW107XG4gIGZvciAoY29uc3QgZmlsZSBvZiBmaWxlcykge1xuICAgIGlmICghaXNJZ25vcmVkKGZpbGUucGF0aCwgc2V0dGluZ3MpKSBrZXB0LnB1c2goZmlsZSk7XG4gIH1cbiAgY29uc3Qga2VwdFBhdGhzID0gbmV3IFNldChrZXB0Lm1hcCgoZikgPT4gZi5wYXRoKSk7XG5cbiAgY29uc3QgYWRkZWQ6IFNjYW5DYW5kaWRhdGVbXSA9IFtdO1xuICBjb25zdCBtb2RpZmllZDogU2NhbkNhbmRpZGF0ZVtdID0gW107XG4gIGNvbnN0IGhhc2hlZDogSGFzaGVkRmlsZVtdID0gW107XG5cbiAgb25Qcm9ncmVzcz8uKDAsIGtlcHQubGVuZ3RoKTtcbiAgbGV0IHNjYW5uZWQgPSAwO1xuICBmb3IgKGNvbnN0IGZpbGUgb2Yga2VwdCkge1xuICAgIGNvbnN0IGVudHJ5ID0gaW5kZXhbZmlsZS5wYXRoXTtcbiAgICBpZiAobW9kZSA9PT0gJ2Zhc3QnICYmIHN0YXRNYXRjaGVzRW50cnkoZW50cnksIGZpbGUpKSB7XG4gICAgICBzY2FubmVkICs9IDE7XG4gICAgICBvblByb2dyZXNzPy4oc2Nhbm5lZCwga2VwdC5sZW5ndGgpO1xuICAgICAgY29udGludWU7IC8vIHNpemUrbXRpbWUgdW5jaGFuZ2VkIHNpbmNlIHRoZSByZWNvcmRlZCBoYXNoIFx1MjAxNCB0cnVzdCBpdFxuICAgIH1cbiAgICBjb25zdCBoYXNoID0gYXdhaXQgaGFzaEZuKGF3YWl0IHN0b3JhZ2UucmVhZEZpbGUoZmlsZS5wYXRoKSk7XG4gICAgaGFzaGVkLnB1c2goeyBwYXRoOiBmaWxlLnBhdGgsIGhhc2gsIHNpemU6IGZpbGUuc2l6ZSwgbXRpbWU6IGZpbGUubXRpbWUgfSk7XG4gICAgc2Nhbm5lZCArPSAxO1xuICAgIG9uUHJvZ3Jlc3M/LihzY2FubmVkLCBrZXB0Lmxlbmd0aCk7XG4gICAgaWYgKGVudHJ5ID09PSB1bmRlZmluZWQpIHtcbiAgICAgIGFkZGVkLnB1c2goeyBwYXRoOiBmaWxlLnBhdGgsIGhhc2gsIHNpemU6IGZpbGUuc2l6ZSB9KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAoZW50cnkuaXNGb2xkZXIpIHtcbiAgICAgIC8vIEEgcmVhbCBmaWxlIHJlcGxhY2VkIGEgZm9sZGVyIHBsYWNlaG9sZGVyOiB0cmVhdCBhcyBjb250ZW50IGNoYW5nZS5cbiAgICAgIG1vZGlmaWVkLnB1c2goeyBwYXRoOiBmaWxlLnBhdGgsIGhhc2gsIHNpemU6IGZpbGUuc2l6ZSB9KTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICAvLyBUb21ic3RvbmVkIGVudHJ5IHdpdGggdGhlIGZpbGUgYmFjayBcdTIxRDIgbW9kaWZpZWQgKHJlc3VycmVjdCBvclxuICAgIC8vIGVkaXQtb2YtZGVsZXRlZCBcdTIwMTQgYm90aCByZXNvbHZlIHRoZSBzYW1lIHdheSBkb3duc3RyZWFtKS5cbiAgICBpZiAoZW50cnkuZGVsZXRlZEF0ICE9PSB1bmRlZmluZWQgfHwgZW50cnkuaGFzaCAhPT0gaGFzaCkge1xuICAgICAgbW9kaWZpZWQucHVzaCh7IHBhdGg6IGZpbGUucGF0aCwgaGFzaCwgc2l6ZTogZmlsZS5zaXplIH0pO1xuICAgIH1cbiAgfVxuXG4gIGNvbnN0IGRlbGV0ZWQ6IERlbGV0ZWRDYW5kaWRhdGVbXSA9IFtdO1xuICBmb3IgKGNvbnN0IFtwYXRoLCBlbnRyeV0gb2YgT2JqZWN0LmVudHJpZXMoaW5kZXgpKSB7XG4gICAgaWYgKGVudHJ5LmlzRm9sZGVyKSBjb250aW51ZTsgLy8gZm9sZGVyIHBsYWNlaG9sZGVycyBuZXZlciBwcm9kdWNlIGZpbGUgZGVsZXRpb25zXG4gICAgaWYgKGVudHJ5LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkKSBjb250aW51ZTsgLy8gYWxyZWFkeSB0b21ic3RvbmVkXG4gICAgaWYgKGtlcHRQYXRocy5oYXMocGF0aCkpIGNvbnRpbnVlO1xuICAgIGlmIChpc0lnbm9yZWQocGF0aCwgc2V0dGluZ3MpKSB7XG4gICAgICAvLyBUaGUgcGF0aCBiZWNhbWUgaWdub3JlZCAoc2V0dGluZ3MgY2hhbmdlKSBcdTIwMTQgbm90IGEgZGVsZXRpb24uXG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgZGVsZXRlZC5wdXNoKHsgcGF0aCwgaGFzaDogZW50cnkuaGFzaCwgc2l6ZTogZW50cnkuc2l6ZSwgdmVyc2lvbklkOiBlbnRyeS52ZXJzaW9uSWQgfSk7XG4gIH1cblxuICBjb25zdCB7IHJlbmFtZWQsIGRlbGV0ZWQ6IHVubWF0Y2hlZERlbGV0ZWQsIGFkZGVkOiB1bm1hdGNoZWRBZGRlZCB9ID0gZGV0ZWN0UmVuYW1lcyhkZWxldGVkLCBhZGRlZCk7XG4gIGNvbnN0IGRpcnMgPSBhd2FpdCBzdG9yYWdlLmxpc3REaXJzKCk7XG4gIGNvbnN0IGVtcHR5Rm9sZGVycyA9IGRldGVjdEVtcHR5Rm9sZGVycyhpbmRleCwgc2V0dGluZ3MsIGZpbGVzLCBkaXJzKTtcbiAgY29uc3QgZm9sZGVyRGVsZXRpb25zID0gZGV0ZWN0Rm9sZGVyRGVsZXRpb25zKGluZGV4LCBzZXR0aW5ncywgZGlycyk7XG5cbiAgcmV0dXJuIHtcbiAgICBzY2FubmVkQXQ6IG5vdyxcbiAgICBhZGRlZDogc29ydENhbmRpZGF0ZXModW5tYXRjaGVkQWRkZWQpLFxuICAgIG1vZGlmaWVkOiBzb3J0Q2FuZGlkYXRlcyhtb2RpZmllZCksXG4gICAgZGVsZXRlZDogWy4uLnVubWF0Y2hlZERlbGV0ZWRdLnNvcnQoYnlQYXRoKSxcbiAgICByZW5hbWVkOiBbLi4ucmVuYW1lZF0uc29ydCgoYSwgYikgPT4gYnlQYXRoKGEsIGIpKSxcbiAgICBlbXB0eUZvbGRlcnMsXG4gICAgZm9sZGVyRGVsZXRpb25zLFxuICAgIGhhc2hlZDogWy4uLmhhc2hlZF0uc29ydChieVBhdGgpLFxuICB9O1xufVxuXG4vKipcbiAqIFdoZXRoZXIgdGhlIGZpbGUncyBzdGF0IGV4YWN0bHkgbWF0Y2hlcyBpdHMgbGl2ZSBpbmRleCBlbnRyeSBcdTIwMTQgdGhlIGZhc3RcbiAqIG1vZGUgcHJlLWZpbHRlci4gUmVxdWlyZXMgYSBrbm93biByZWNvcmRlZCBgbXRpbWVgIChsZWdhY3kgZW50cmllcyBhbmRcbiAqIHB1bGwtd3JpdHRlbiBlbnRyaWVzIGhhdmUgbm9uZSBcdTIxRDIgaGFzaGVkLCB0aGVuIHJlY29yZGVkKSBhbmQgbmV2ZXIgZmlyZXNcbiAqIGZvciB0b21ic3RvbmVzIChhIHJlc3VycmVjdCBtdXN0IGFsd2F5cyBzdXJmYWNlKSBvciBmb2xkZXIgcGxhY2Vob2xkZXJzLlxuICovXG5mdW5jdGlvbiBzdGF0TWF0Y2hlc0VudHJ5KGVudHJ5OiBMb2NhbEluZGV4RW50cnkgfCB1bmRlZmluZWQsIGZpbGU6IEZpbGVTdGF0KTogYm9vbGVhbiB7XG4gIHJldHVybiAoXG4gICAgZW50cnkgIT09IHVuZGVmaW5lZCAmJlxuICAgIGVudHJ5LmRlbGV0ZWRBdCA9PT0gdW5kZWZpbmVkICYmXG4gICAgZW50cnkuaXNGb2xkZXIgIT09IHRydWUgJiZcbiAgICBlbnRyeS5tdGltZSAhPT0gdW5kZWZpbmVkICYmXG4gICAgZW50cnkubXRpbWUgPT09IGZpbGUubXRpbWUgJiZcbiAgICBlbnRyeS5zaXplID09PSBmaWxlLnNpemVcbiAgKTtcbn1cblxuLyoqXG4gKiBSZWNvcmQgYSBzY2FuJ3MgaGFzaCBvYnNlcnZhdGlvbnMgaW50byB0aGUgaW5kZXg6IGZvciBldmVyeSBsaXZlIGZpbGVcbiAqIGVudHJ5IHdob3NlIGNvbnRlbnQgaGFzaCBtYXRjaGVzIHdoYXQgdGhlIHNjYW4gaGFzaGVkLCBjYWNoZSB0aGUgb2JzZXJ2ZWRcbiAqIG10aW1lIHNvIHRoZSBuZXh0IGZhc3Qgc2NhbiBjYW4gc2tpcCByZS1oYXNoaW5nIGl0LlxuICpcbiAqIFB1cmU6IHJldHVybnMgYSBuZXcgaW5kZXggKG9yIHRoZSBpbnB1dCB3aGVuIG5vdGhpbmcgY2hhbmdlcyksIG5ldmVyXG4gKiBtdXRhdGVzLiBUaGUgaGFzaC1tYXRjaCBndWFyZCBrZWVwcyB0aGUgY2FjaGUgaG9uZXN0IFx1MjAxNCBhbiBlbnRyeSB3aG9zZVxuICogaGFzaCBubyBsb25nZXIgcmVmbGVjdHMgdGhlIG9ic2VydmF0aW9uIChlLmcuIGEgcHVsbCBvdmVyd3JvdGUgdGhlIHBhdGhcbiAqIG1pZC1jeWNsZSkgaXMgbGVmdCB1bnRvdWNoZWQgYW5kIHNpbXBseSBnZXRzIHJlLWhhc2hlZCBuZXh0IHNjYW4uXG4gKiBFbnRyaWVzIG5ldmVyIGRlbW90ZTogYGRlbGV0ZWRBdGAvYGlzRm9sZGVyYCBlbnRyaWVzIGFyZSBuZXZlciBwYXRjaGVkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVjb3JkSGFzaGVkRmlsZXMoXG4gIGluZGV4OiBMb2NhbEluZGV4LFxuICBoYXNoZWQ6IHJlYWRvbmx5IEhhc2hlZEZpbGVbXSxcbik6IExvY2FsSW5kZXgge1xuICBsZXQgbmV4dDogUmVjb3JkPHN0cmluZywgTG9jYWxJbmRleEVudHJ5PiB8IHVuZGVmaW5lZDtcbiAgZm9yIChjb25zdCBvYnNlcnZlZCBvZiBoYXNoZWQpIHtcbiAgICBjb25zdCBlbnRyeSA9IGluZGV4W29ic2VydmVkLnBhdGhdO1xuICAgIGlmIChlbnRyeSA9PT0gdW5kZWZpbmVkIHx8IGVudHJ5LmlzRm9sZGVyIHx8IGVudHJ5LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkKSBjb250aW51ZTtcbiAgICBpZiAoZW50cnkuaGFzaCAhPT0gb2JzZXJ2ZWQuaGFzaCkgY29udGludWU7XG4gICAgaWYgKGVudHJ5Lm10aW1lID09PSBvYnNlcnZlZC5tdGltZSkgY29udGludWU7XG4gICAgbmV4dCA/Pz0geyAuLi5pbmRleCB9O1xuICAgIG5leHRbb2JzZXJ2ZWQucGF0aF0gPSB7IC4uLmVudHJ5LCBtdGltZTogb2JzZXJ2ZWQubXRpbWUgfTtcbiAgfVxuICByZXR1cm4gbmV4dCA/PyBpbmRleDtcbn1cblxuLyoqXG4gKiBDb3JyZWxhdGUgZGVsZXRlICsgYWRkIHBhaXJzIGJ5IGNvbnRlbnQgaGFzaCAoQVJDSElURUNUVVJFIFx1MDBBNzQpLlxuICpcbiAqIE9uZS10by1vbmUgbWF0Y2hpbmcsIG1vc3QgZGV0ZXJtaW5pc3RpYyB3aW5zOiB3aGVuIHNldmVyYWwgdW5tYXRjaGVkIGFkZHNcbiAqIHNoYXJlIHRoZSBkZWxldGVkIHNpZGUncyBoYXNoLCBwcmVmZXIgYW4gYWRkIGluIHRoZSBzYW1lIHBhcmVudCBkaXJlY3Rvcnk7XG4gKiB3aXRoaW4gYSBwcmVmZXJlbmNlIGNsYXNzLCB0aGUgbGV4aWNvZ3JhcGhpY2FsbHkgc21hbGxlc3QgYHRvYCBwYXRoIHdpbnMuXG4gKiBNYXRjaGVkIHBhaXJzIGxlYXZlIHRoZSBkZWxldGUvYWRkIGJ1Y2tldHMgYW5kIGJlY29tZSBgcmVuYW1lZGAuXG4gKi9cbmZ1bmN0aW9uIGRldGVjdFJlbmFtZXMoXG4gIGRlbGV0ZWQ6IHJlYWRvbmx5IERlbGV0ZWRDYW5kaWRhdGVbXSxcbiAgYWRkZWQ6IHJlYWRvbmx5IFNjYW5DYW5kaWRhdGVbXSxcbik6IHtcbiAgcmVuYW1lZDogUmVuYW1lQ2FuZGlkYXRlW107XG4gIGRlbGV0ZWQ6IERlbGV0ZWRDYW5kaWRhdGVbXTtcbiAgYWRkZWQ6IFNjYW5DYW5kaWRhdGVbXTtcbn0ge1xuICBjb25zdCBhZGRzQnlIYXNoID0gbmV3IE1hcDxzdHJpbmcsIFNjYW5DYW5kaWRhdGVbXT4oKTtcbiAgZm9yIChjb25zdCBjYW5kaWRhdGUgb2YgWy4uLmFkZGVkXS5zb3J0KGJ5UGF0aCkpIHtcbiAgICBjb25zdCBidWNrZXQgPSBhZGRzQnlIYXNoLmdldChjYW5kaWRhdGUuaGFzaCk7XG4gICAgaWYgKGJ1Y2tldCkgYnVja2V0LnB1c2goY2FuZGlkYXRlKTtcbiAgICBlbHNlIGFkZHNCeUhhc2guc2V0KGNhbmRpZGF0ZS5oYXNoLCBbY2FuZGlkYXRlXSk7XG4gIH1cblxuICBjb25zdCB1c2VkQWRkcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBjb25zdCByZW5hbWVkOiBSZW5hbWVDYW5kaWRhdGVbXSA9IFtdO1xuICBjb25zdCB1bm1hdGNoZWREZWxldGVkOiBEZWxldGVkQ2FuZGlkYXRlW10gPSBbXTtcblxuICBmb3IgKGNvbnN0IGRlbGV0aW9uIG9mIFsuLi5kZWxldGVkXS5zb3J0KGJ5UGF0aCkpIHtcbiAgICBjb25zdCBjYW5kaWRhdGVzID0gYWRkc0J5SGFzaC5nZXQoZGVsZXRpb24uaGFzaCkgPz8gW107XG4gICAgbGV0IGZhbGxiYWNrOiBTY2FuQ2FuZGlkYXRlIHwgdW5kZWZpbmVkO1xuICAgIGxldCBzYW1lRGlyOiBTY2FuQ2FuZGlkYXRlIHwgdW5kZWZpbmVkO1xuICAgIGZvciAoY29uc3QgY2FuZGlkYXRlIG9mIGNhbmRpZGF0ZXMpIHtcbiAgICAgIGlmICh1c2VkQWRkcy5oYXMoY2FuZGlkYXRlLnBhdGgpKSBjb250aW51ZTtcbiAgICAgIGlmIChwYXJlbnRQYXRoKGNhbmRpZGF0ZS5wYXRoKSA9PT0gcGFyZW50UGF0aChkZWxldGlvbi5wYXRoKSkge1xuICAgICAgICBzYW1lRGlyID8/PSBjYW5kaWRhdGU7IC8vIHNvcnRlZCBcdTIxRDIgZmlyc3QgaXMgc21hbGxlc3RcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGZhbGxiYWNrID8/PSBjYW5kaWRhdGU7XG4gICAgICB9XG4gICAgfVxuICAgIGNvbnN0IG1hdGNoID0gc2FtZURpciA/PyBmYWxsYmFjaztcbiAgICBpZiAobWF0Y2gpIHtcbiAgICAgIHVzZWRBZGRzLmFkZChtYXRjaC5wYXRoKTtcbiAgICAgIHJlbmFtZWQucHVzaCh7IGZyb206IGRlbGV0aW9uLnBhdGgsIHRvOiBtYXRjaC5wYXRoLCBoYXNoOiBkZWxldGlvbi5oYXNoLCBzaXplOiBkZWxldGlvbi5zaXplIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICB1bm1hdGNoZWREZWxldGVkLnB1c2goZGVsZXRpb24pO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7XG4gICAgcmVuYW1lZCxcbiAgICBkZWxldGVkOiB1bm1hdGNoZWREZWxldGVkLFxuICAgIGFkZGVkOiBhZGRlZC5maWx0ZXIoKGNhbmRpZGF0ZSkgPT4gIXVzZWRBZGRzLmhhcyhjYW5kaWRhdGUucGF0aCkpLFxuICB9O1xufVxuXG4vKipcbiAqIERpcmVjdG9yaWVzIHRoYXQgZXhpc3QgaW4gc3RvcmFnZSBidXQgYXJlIHJlcHJlc2VudGVkIG5laXRoZXIgYnkgYSBsaXZlXG4gKiBmb2xkZXIgcGxhY2Vob2xkZXIgaW4gdGhlIGluZGV4IG5vciBieSBhbnkgZmlsZSAoaWdub3JlZCBvciBub3QpIGJlbmVhdGhcbiAqIHRoZW0uIEEgZGlyZWN0b3J5IGNvbnRhaW5pbmcgb25seSBpZ25vcmVkIGZpbGVzIGlzIHRoZXJlZm9yZSAqbm90KiBlbXB0eSBcdTIwMTRcbiAqIGl0IGlzIHJlcHJlc2VudGVkIGJ5IHRob3NlIGZpbGVzIGFzIGZhciBhcyB0aGUgbG9jYWwgbWFjaGluZSBpcyBjb25jZXJuZWQuXG4gKi9cbmZ1bmN0aW9uIGRldGVjdEVtcHR5Rm9sZGVycyhcbiAgaW5kZXg6IExvY2FsSW5kZXgsXG4gIHNldHRpbmdzOiBJZ25vcmVTZXR0aW5ncyxcbiAgZmlsZXM6IHJlYWRvbmx5IEZpbGVTdGF0W10sXG4gIGRpcnM6IHJlYWRvbmx5IHN0cmluZ1tdLFxuKTogc3RyaW5nW10ge1xuICBjb25zdCByZXByZXNlbnRlZERpcnMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgZm9yIChjb25zdCBmaWxlIG9mIGZpbGVzKSB7XG4gICAgZm9yIChsZXQgZGlyID0gcGFyZW50UGF0aChmaWxlLnBhdGgpOyBkaXIgIT09ICcvJzsgZGlyID0gcGFyZW50UGF0aChkaXIpKSB7XG4gICAgICByZXByZXNlbnRlZERpcnMuYWRkKGRpcik7XG4gICAgfVxuICB9XG5cbiAgY29uc3QgZW1wdHlGb2xkZXJzOiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGRpciBvZiBkaXJzKSB7XG4gICAgaWYgKGRpciA9PT0gJy8nKSBjb250aW51ZTtcbiAgICBpZiAocmVwcmVzZW50ZWREaXJzLmhhcyhkaXIpKSBjb250aW51ZTtcbiAgICBpZiAoaXNJZ25vcmVkKGRpciwgc2V0dGluZ3MpKSBjb250aW51ZTtcbiAgICBjb25zdCBlbnRyeSA9IGluZGV4W2Rpcl07XG4gICAgaWYgKGVudHJ5Py5pc0ZvbGRlciAmJiBlbnRyeS5kZWxldGVkQXQgPT09IHVuZGVmaW5lZCkgY29udGludWU7IC8vIGFscmVhZHkgc3luY2VkIGFzIHBsYWNlaG9sZGVyXG4gICAgZW1wdHlGb2xkZXJzLnB1c2goZGlyKTtcbiAgfVxuICByZXR1cm4gZW1wdHlGb2xkZXJzLnNvcnQoKTtcbn1cblxuLyoqXG4gKiBMaXZlIGZvbGRlciBwbGFjZWhvbGRlciBlbnRyaWVzIHdob3NlIGRpcmVjdG9yeSBubyBsb25nZXIgZXhpc3RzIGluXG4gKiBzdG9yYWdlIFx1MjAxNCB0aGUgZm9sZGVyIHdhcyBkZWxldGVkIGxvY2FsbHkgKGRpcmVjdGx5LCBvciBieSBwcnVuZS1vbi1kZWxldGVcbiAqIGVtcHR5aW5nIGl0KS4gRW1pdHMgb25lIGBGb2xkZXJEZWxldGlvbkNhbmRpZGF0ZWAgcGVyIHBsYWNlaG9sZGVyIHNvIHRoZVxuICogcmVzb2x2ZS9jb21taXQgcGF0aCBwdXNoZXMgYSBmb2xkZXIgdG9tYnN0b25lOyBhbHJlYWR5LXRvbWJzdG9uZWRcbiAqIHBsYWNlaG9sZGVycyBhbmQgcGxhY2Vob2xkZXJzIHRoYXQgbWVyZWx5IGJlY2FtZSBpZ25vcmVkIGFyZSBza2lwcGVkLlxuICovXG5mdW5jdGlvbiBkZXRlY3RGb2xkZXJEZWxldGlvbnMoXG4gIGluZGV4OiBMb2NhbEluZGV4LFxuICBzZXR0aW5nczogSWdub3JlU2V0dGluZ3MsXG4gIGRpcnM6IHJlYWRvbmx5IHN0cmluZ1tdLFxuKTogRm9sZGVyRGVsZXRpb25DYW5kaWRhdGVbXSB7XG4gIGNvbnN0IHByZXNlbnQgPSBuZXcgU2V0KGRpcnMpO1xuICBjb25zdCBmb2xkZXJEZWxldGlvbnM6IEZvbGRlckRlbGV0aW9uQ2FuZGlkYXRlW10gPSBbXTtcbiAgZm9yIChjb25zdCBbcGF0aCwgZW50cnldIG9mIE9iamVjdC5lbnRyaWVzKGluZGV4KSkge1xuICAgIGlmICghZW50cnkuaXNGb2xkZXIpIGNvbnRpbnVlOyAvLyBmaWxlcyBhcmUgaGFuZGxlZCBieSB0aGUgYGRlbGV0ZWRgIGJ1Y2tldFxuICAgIGlmIChlbnRyeS5kZWxldGVkQXQgIT09IHVuZGVmaW5lZCkgY29udGludWU7IC8vIGFscmVhZHkgdG9tYnN0b25lZFxuICAgIGlmIChwcmVzZW50LmhhcyhwYXRoKSkgY29udGludWU7IC8vIGRpcmVjdG9yeSBzdGlsbCBleGlzdHMgXHUyMDE0IG5vIGRlbGV0aW9uXG4gICAgaWYgKGlzSWdub3JlZChwYXRoLCBzZXR0aW5ncykpIGNvbnRpbnVlOyAvLyBzZXR0aW5ncyBjaGFuZ2UsIG5vdCBhIGRlbGV0aW9uXG4gICAgZm9sZGVyRGVsZXRpb25zLnB1c2goeyBwYXRoLCB2ZXJzaW9uSWQ6IGVudHJ5LnZlcnNpb25JZCB9KTtcbiAgfVxuICByZXR1cm4gZm9sZGVyRGVsZXRpb25zLnNvcnQoYnlQYXRoKTtcbn1cblxuZnVuY3Rpb24gc29ydENhbmRpZGF0ZXMoY2FuZGlkYXRlczogU2NhbkNhbmRpZGF0ZVtdKTogU2NhbkNhbmRpZGF0ZVtdIHtcbiAgcmV0dXJuIFsuLi5jYW5kaWRhdGVzXS5zb3J0KGJ5UGF0aCk7XG59XG5cbmZ1bmN0aW9uIGJ5UGF0aDxUIGV4dGVuZHMgeyBwYXRoPzogc3RyaW5nOyBmcm9tPzogc3RyaW5nIH0+KGE6IFQsIGI6IFQpOiBudW1iZXIge1xuICBjb25zdCBrZXlBID0gYS5wYXRoID8/IGEuZnJvbSA/PyAnJztcbiAgY29uc3Qga2V5QiA9IGIucGF0aCA/PyBiLmZyb20gPz8gJyc7XG4gIHJldHVybiBrZXlBIDwga2V5QiA/IC0xIDoga2V5QSA+IGtleUIgPyAxIDogMDtcbn1cbiIsICIvKipcbiAqIGBTeW5jQ2xpZW50YCBcdTIwMTQgdGhlIG5ldHdvcmstZmFjaW5nIG9yY2hlc3RyYXRvciAoQVJDSElURUNUVVJFLm1kIFx1MDBBNzgpLlxuICpcbiAqIENvbXBvc2VzIHRoZSBwaGFzZS0xYS8xYiBwaWVjZXMgaW50byBvbmUgbG9vcCBwZXIgZGV2aWNlOlxuICpcbiAqICAgc3RhcnR1cDogIGxvYWRMb2NhbFN0YXRlIChlbnRyaWVzICsgcGVyc2lzdGVkIGN1cnNvcikgXHUyMTkyIGhlbGxvL2hlbGxvQWNrXG4gKiAgICAgICAgICAgICAoc2VydmVyIHJlcG9ydHMgYG9sZGVzdFJldGFpbmVkU2VxYCkgXHUyMTkyIGdldE1hbmlmZXN0IFx1MjAxNCBhIERFTFRBXG4gKiAgICAgICAgICAgICBtYW5pZmVzdCAoYHNpbmNlOiBzeW5jZWRUaHJvdWdoYCkgbWVyZ2VkIG92ZXIgdGhlIGluZGV4XG4gKiAgICAgICAgICAgICBwcm9qZWN0aW9uIHdoZW4gdGhlIHJlcGxheSB3aW5kb3cgaXMgaW50YWN0LCBlbHNlIGZ1bGwgXHUyMTkyXG4gKiAgICAgICAgICAgICBzY2FuVmF1bHQgXHUyMTkyIGNvbXB1dGVTeW5jUGxhbiBcdTIxOTIgZXhlY3V0ZSAocHVzaGVzIHRocm91Z2ggYVxuICogICAgICAgICAgICAgYm91bmRlZC1jb25jdXJyZW5jeSBwaXBlbGluZSwgcHVsbHMgdmlhIGFwcGx5UHVsbCB3aXRoIHRoZVxuICogICAgICAgICAgICAgaW5qZWN0ZWQgYmxvYiBzdG9yZSk7XG4gKiAgIGxpdmU6ICAgICBgY2hhbmdlYCBtZXNzYWdlcyBtYXRlcmlhbGl6ZSBpbW1lZGlhdGVseSB3aGVuIHRoZSB0YXJnZXQgaXNcbiAqICAgICAgICAgICAgIGNsZWFuLCBhbmQgZGVmZXIgdG8gYSBmdWxsIHJlY29uY2lsZSBjeWNsZSB3aGVuIGl0IGlzIG5vdCBcdTIwMTQgYVxuICogICAgICAgICAgICAgcmVtb3RlIGNoYW5nZSBpcyBORVZFUiB3cml0dGVuIG92ZXIgbG9jYWxseS1tb2RpZmllZCBjb250ZW50XG4gKiAgICAgICAgICAgICB3aXRob3V0IGdvaW5nIHRocm91Z2ggYGNvbXB1dGVTeW5jUGxhbmAncyBjb25mbGljdCBsb2dpYztcbiAqICAgd2F0Y2hlcjogIGBXYXRjaEFkYXB0ZXJgIGJhdGNoZXMgYXJlIGRlYm91bmNlZCAofjMwMCBtcywgaW5qZWN0YWJsZVxuICogICAgICAgICAgICAgc2NoZWR1bGVyIFx1MjAxNCBubyBhbWJpZW50IHRpbWVycyBpbiB0ZXN0cykgaW50byBzY2FuXHUyMTkycGxhblx1MjE5MmV4ZWN1dGU7XG4gKiAgIHJlY29ubmVjdDogYG9uQ2xvc2VgIGZsaXBzIHRvIGAnZGlzY29ubmVjdGVkJ2A7IGByZWNvbm5lY3QoKWAgcmUtcnVucyB0aGVcbiAqICAgICAgICAgICAgIHdob2xlIHN0YXJ0dXAgcmVjb25jaWxpYXRpb24gKGJhY2tvZmYgaXMgdGhlIGNhbGxlcidzIGpvYikuXG4gKlxuICogQnVsayBwaGFzZXMgcmVwb3J0IFgvWSBvbiBgc3RhdHVzKCkucHJvZ3Jlc3NgICh0aHJvdHRsZWQgdmlhIHRoZSBpbmplY3RlZFxuICogY2xvY2spOyB0aGUgcHVzaCBwaGFzZSBrZWVwcyB1cCB0byBgcHVzaENvbmN1cnJlbmN5YCBjb21taXRzIGluIGZsaWdodC5cbiAqXG4gKiBBbGwgSS9PIGNyb3NzZXMgdGhlIGFkYXB0ZXIgc2VhbXMgKGBTdG9yYWdlQWRhcHRlcmAsIGBUcmFuc3BvcnRgLFxuICogYEJsb2JTdG9yZWAsIGBMb2dBZGFwdGVyYCk7IHRoZSBjbGFzcyBpdHNlbGYgaXMgcHVyZSBvcmNoZXN0cmF0aW9uIGFuZCBydW5zXG4gKiBhbnl3aGVyZSBgY29yZWAgcnVucyBcdTIwMTQgV29ya2VycyB0ZXN0cyBpbmNsdWRlZC5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IExvZ0FkYXB0ZXIsIFN0b3JhZ2VBZGFwdGVyLCBXYXRjaEFkYXB0ZXIgfSBmcm9tICcuL2FkYXB0ZXJzLmpzJztcbmltcG9ydCB7IGNvbXBhcmVDbG9ja3MgfSBmcm9tICcuL2Nsb2NrLmpzJztcbmltcG9ydCB7IGFwcGx5UHVsbCwgbG9hZExvY2FsU3RhdGUsIHBydW5lUGFyZW50T25EZWxldGUsIHR5cGUgRmV0Y2hCbG9iIH0gZnJvbSAnLi9lbmdpbmUuanMnO1xuaW1wb3J0IHsgTmV0d29ya0Vycm9yLCBQcm90b2NvbEVycm9yLCBSZXZva2VkRXJyb3IsIFVuYXV0aG9yaXplZEVycm9yIH0gZnJvbSAnLi9lcnJvcnMuanMnO1xuaW1wb3J0IHsgc2hhMjU2SGV4IH0gZnJvbSAnLi9oYXNoaW5nLmpzJztcbmltcG9ydCB7IGlzSWdub3JlZCwgdHlwZSBJZ25vcmVTZXR0aW5ncyB9IGZyb20gJy4vaWdub3JlLmpzJztcbmltcG9ydCB7XG4gIGFwcGx5Q29tbWl0LFxuICBMT0NBTF9JTkRFWF9TVEFURV9QQVRILFxuICByZW1vdmVFbnRyeSxcbiAgc2VyaWFsaXplTG9jYWxJbmRleCxcbiAgdHlwZSBMb2NhbEluZGV4LFxuICB0eXBlIFBlcnNpc3RlZFN5bmNTdGF0ZSxcbn0gZnJvbSAnLi9sb2NhbGluZGV4LmpzJztcbmltcG9ydCB7XG4gIGJhc2U2NFRvQnl0ZXMsXG4gIGJ5dGVzVG9CYXNlNjQsXG4gIElOTElORV9DT05URU5UX01BWF9CWVRFUyxcbiAgUHJvdG9jb2xWZXJzaW9uLFxuICB0eXBlIEJsb2JBY2tNZXNzYWdlLFxuICB0eXBlIEJsb2JNZXNzYWdlLFxuICB0eXBlIENoYW5nZU1lc3NhZ2UsXG4gIHR5cGUgQ29tbWl0QWNrTWVzc2FnZSxcbiAgdHlwZSBDb21taXRNZXNzYWdlLFxuICB0eXBlIENvbmZsaWN0TWVzc2FnZSxcbiAgdHlwZSBIZWxsb0Fja01lc3NhZ2UsXG4gIHR5cGUgTWFuaWZlc3RNZXNzYWdlLFxuICB0eXBlIE1lc3NhZ2UsXG4gIHR5cGUgU2VydmVyTWVzc2FnZSxcbn0gZnJvbSAnLi9wcm90b2NvbC5qcyc7XG5pbXBvcnQge1xuICBjb21wdXRlU3luY1BsYW4sXG4gIHR5cGUgQ29uZmxpY3RPcCxcbiAgdHlwZSBQdWxsRmlsZU9wLFxuICB0eXBlIFB1bGxPcCxcbiAgdHlwZSBQdXNoT3AsXG4gIHR5cGUgUmVtb3RlRmlsZSxcbiAgdHlwZSBTeW5jUGxhbixcbn0gZnJvbSAnLi9yZXNvbHZlLmpzJztcbmltcG9ydCB7IHJlY29yZEhhc2hlZEZpbGVzLCBzY2FuVmF1bHQsIHR5cGUgSGFzaGVkRmlsZSB9IGZyb20gJy4vc2Nhbi5qcyc7XG5pbXBvcnQgdHlwZSB7IFRyYW5zcG9ydCB9IGZyb20gJy4vdHJhbnNwb3J0LmpzJztcbmltcG9ydCB0eXBlIHsgTG9naWNhbENsb2NrIH0gZnJvbSAnLi90eXBlcy5qcyc7XG5cbi8vIC0tLSBwdWJsaWMgb3B0aW9uL3N0YXR1cyBzaGFwZXMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIENsaWVudC1zaWRlIGNvbnRlbnQtYWRkcmVzc2VkIGJsb2IgY2FjaGUgKFIyIGNsaWVudCBpbiBwcm9kdWN0aW9uOyBhIE1hcCBpbiB0ZXN0cykuICovXG5leHBvcnQgaW50ZXJmYWNlIEJsb2JTdG9yZSB7XG4gIGdldChoYXNoOiBzdHJpbmcpOiBQcm9taXNlPFVpbnQ4QXJyYXkgfCB1bmRlZmluZWQ+O1xuICBwdXQoaGFzaDogc3RyaW5nLCBieXRlczogVWludDhBcnJheSk6IFByb21pc2U8dm9pZD47XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgU3luY0NsaWVudE9wdGlvbnMge1xuICBkZXZpY2VJZDogc3RyaW5nO1xuICBkZXZpY2VOYW1lOiBzdHJpbmc7XG4gIHRva2VuOiBzdHJpbmc7XG4gIC8qKiBBIGZhY3RvcnkgKHJlY29ubmVjdCBkaWFscyBmcmVzaCkgb3IgYSBzaW5nbGUgcmV1c2FibGUgaW5zdGFuY2UuICovXG4gIHRyYW5zcG9ydDogKCgpID0+IFRyYW5zcG9ydCkgfCBUcmFuc3BvcnQ7XG4gIGJsb2JTdG9yZTogQmxvYlN0b3JlO1xuICBzdG9yYWdlOiBTdG9yYWdlQWRhcHRlcjtcbiAgbG9nPzogTG9nQWRhcHRlcjtcbiAgLyoqIEluaXRpYWwgaWdub3JlIHNldHRpbmdzOyBzdXBlcnNlZGVkIGJ5IGBoZWxsb0Fjay5zZXR0aW5nc2Agb24gY29ubmVjdC4gKi9cbiAgc2V0dGluZ3M/OiBJZ25vcmVTZXR0aW5ncztcbiAgLyoqIEluamVjdGFibGUgY2xvY2sgKGRlZmF1bHQgYERhdGUubm93YCkuICovXG4gIG5vdz86ICgpID0+IG51bWJlcjtcbiAgLyoqIFdhdGNoZXIgZGVib3VuY2Ugd2luZG93IGluIG1zIChkZWZhdWx0IDMwMCkuICovXG4gIGRlYm91bmNlTXM/OiBudW1iZXI7XG4gIC8qKlxuICAgKiBTY2hlZHVsZXMgdGhlIGRlYm91bmNlZCBzeW5jIGN5Y2xlLiBEZWZhdWx0OiBgc2V0VGltZW91dGAuIFRlc3RzIGluamVjdCBhXG4gICAqIG1hbnVhbCBxdWV1ZSBcdTIwMTQgdGhlIGNsaWVudCBuZXZlciB0b3VjaGVzIGEgcmVhbCB0aW1lciBiZWhpbmQgdGhpcyBzZWFtLlxuICAgKi9cbiAgc2NoZWR1bGU/OiAoZm46ICgpID0+IHZvaWQsIG1zOiBudW1iZXIpID0+ICgpID0+IHZvaWQ7XG4gIC8qKlxuICAgKiBCb3VuZGVkIGNvbmN1cnJlbmN5IG9mIHRoZSBwdXNoIHBpcGVsaW5lOiBob3cgbWFueSBjb21taXRzIG1heSBiZSBpblxuICAgKiBmbGlnaHQgKHNlbnQsIGF3YWl0aW5nIGFjaykgYXQgb25jZS4gRGVmYXVsdCA4LiBDb25mbGljdCBhcmJpdHJhdGlvbiBpc1xuICAgKiBzZXJ2ZXItc2lkZSBhbmQgUEVSIFBBVEgsIGFuZCBhIGN5Y2xlIHN0YWdlcyBhdCBtb3N0IG9uZSBjb21taXQgcGVyIHBhdGgsXG4gICAqIHNvIG9yZGVyaW5nIGFjcm9zcyBkaWZmZXJlbnQgZmlsZXMgaXMgaXJyZWxldmFudCBcdTIwMTQgc2VlXG4gICAqIGBydW5QdXNoUGlwZWxpbmVgIGZvciB0aGUgZnVsbCBhcmd1bWVudC5cbiAgICovXG4gIHB1c2hDb25jdXJyZW5jeT86IG51bWJlcjtcbiAgLyoqXG4gICAqIE1pbmltdW0gd2FsbC1jbG9jayBtcyBiZXR3ZWVuIGBzdGF0dXMoKS5wcm9ncmVzc2AgdXBkYXRlcyBkdXJpbmcgYnVsa1xuICAgKiBwaGFzZXMgKGRlZmF1bHQgNTAgXHUyMDE0IHJlbmRlcmVyIGNvYWxlc2Npbmc7IHBoYXNlIGNoYW5nZXMgYW5kIGNvbXBsZXRpb25zXG4gICAqIGFsd2F5cyBlbWl0KS4gVGVzdHMgcGFzcyAwIHRvIG9ic2VydmUgZXZlcnkgZmlsZS5cbiAgICovXG4gIHByb2dyZXNzVGhyb3R0bGVNcz86IG51bWJlcjtcbn1cblxuZXhwb3J0IHR5cGUgU3luY0NsaWVudFN0YXRlID0gJ2lkbGUnIHwgJ2Nvbm5lY3RpbmcnIHwgJ3N5bmNpbmcnIHwgJ2xpdmUnIHwgJ2Rpc2Nvbm5lY3RlZCc7XG5cbi8qKiBUaGUgYnVsayBwaGFzZSBhIHJ1bm5pbmcgY3ljbGUgaXMgY3VycmVudGx5IGdyaW5kaW5nIHRocm91Z2guICovXG5leHBvcnQgdHlwZSBTeW5jUGhhc2UgPSAnc2Nhbm5pbmcnIHwgJ3B1c2hpbmcnIHwgJ3B1bGxpbmcnO1xuXG4vKiogWC9ZIHByb2dyZXNzIG9mIG9uZSBidWxrIHBoYXNlOyBwcmVzZW50IG9uIGBTeW5jQ2xpZW50U3RhdHVzYCBtaWQtY3ljbGUgb25seS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU3luY1Byb2dyZXNzIHtcbiAgcGhhc2U6IFN5bmNQaGFzZTtcbiAgZG9uZTogbnVtYmVyO1xuICB0b3RhbDogbnVtYmVyO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFN5bmNDbGllbnRTdGF0dXMge1xuICBzdGF0ZTogU3luY0NsaWVudFN0YXRlO1xuICAvKiogRXBvY2ggbXMgb2YgdGhlIGxhc3QgY29tcGxldGVkIGN5Y2xlLCBvciBudWxsIGJlZm9yZSB0aGUgZmlyc3QuICovXG4gIGxhc3RTeW5jQXQ6IG51bWJlciB8IG51bGw7XG4gIC8qKiBXYXRjaGVyL3JlY29uY2lsZSBldmVudHMgcXVldWVkIGJlaGluZCB0aGUgZGVib3VuY2Ugd2luZG93LiAqL1xuICBwZW5kaW5nOiBudW1iZXI7XG4gIC8qKiBDb25mbGljdHMgb2JzZXJ2ZWQgYnkgcGxhbiBjeWNsZXMgKGluZm9ybWF0aW9uYWw7IHJlc29sdXRpb24gaXMgaW4gdGhlIGRhdGEpLiAqL1xuICBjb25mbGljdHM6IENvbmZsaWN0T3BbXTtcbiAgLyoqXG4gICAqIFByb2dyZXNzIG9mIHRoZSBSVU5OSU5HIGN5Y2xlJ3MgY3VycmVudCBidWxrIHBoYXNlIChgdnNhIFx1MjJFRiAxMjM0LzUwMDBgKTtcbiAgICogYWJzZW50IGJldHdlZW4gY3ljbGVzLiBVcGRhdGVzIGFyZSB0aHJvdHRsZWQgdG8gYHByb2dyZXNzVGhyb3R0bGVNc2AuXG4gICAqL1xuICBwcm9ncmVzcz86IFN5bmNQcm9ncmVzcztcbn1cblxuLyoqIERlZmF1bHQgaW4tZmxpZ2h0IGNvbW1pdCBjYXAgKHNlZSBgU3luY0NsaWVudE9wdGlvbnMucHVzaENvbmN1cnJlbmN5YCkuICovXG5leHBvcnQgY29uc3QgREVGQVVMVF9QVVNIX0NPTkNVUlJFTkNZID0gODtcbi8qKiBEZWZhdWx0IHByb2dyZXNzIGNvYWxlc2Npbmcgd2luZG93IChzZWUgYFN5bmNDbGllbnRPcHRpb25zLnByb2dyZXNzVGhyb3R0bGVNc2ApLiAqL1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfUFJPR1JFU1NfVEhST1RUTEVfTVMgPSA1MDtcblxuY29uc3QgZGVmYXVsdExvZzogTG9nQWRhcHRlciA9IHtcbiAgZGVidWc6ICgpID0+IHt9LFxuICBpbmZvOiAoKSA9PiB7fSxcbiAgd2FybjogKCkgPT4ge30sXG4gIGVycm9yOiAoKSA9PiB7fSxcbn07XG5cbmNvbnN0IGRlZmF1bHRTY2hlZHVsZSA9IChmbjogKCkgPT4gdm9pZCwgbXM6IG51bWJlcik6ICgoKSA9PiB2b2lkKSA9PiB7XG4gIGNvbnN0IGhhbmRsZSA9IGdsb2JhbFRoaXMuc2V0VGltZW91dChmbiwgbXMpIGFzIHVua25vd24gYXMgbnVtYmVyO1xuICByZXR1cm4gKCkgPT4gZ2xvYmFsVGhpcy5jbGVhclRpbWVvdXQoaGFuZGxlKTtcbn07XG5cbi8qKiBBIGNvbW1pdCBwcmVwYXJlZCBmb3IgdGhlIHdpcmUgKGEgYFB1c2hPcGAgKyBpdHMgc3RhZ2VkIGNvbnRlbnQpLiAqL1xuaW50ZXJmYWNlIFN0YWdlZENvbW1pdCB7XG4gIGtpbmQ6IENvbW1pdE1lc3NhZ2VbJ2tpbmQnXTtcbiAgcGF0aDogc3RyaW5nO1xuICBwYXJlbnRWZXJzaW9uOiBzdHJpbmcgfCBudWxsO1xuICBoYXNoOiBzdHJpbmc7XG4gIHNpemU6IG51bWJlcjtcbiAgZnJvbVBhdGg/OiBzdHJpbmc7XG4gIGlzRm9sZGVyPzogYm9vbGVhbjtcbiAgYnl0ZXM/OiBVaW50OEFycmF5O1xuICAvKipcbiAgICogU3RvcmFnZSBtdGltZSBvYnNlcnZlZCBieSBUSElTIGN5Y2xlJ3Mgc2NhbiB3aGVuIGl0IGhhc2hlZCB0aGUgY29udGVudFxuICAgKiAoYEhhc2hlZEZpbGUubXRpbWVgIG9mIHRoZSBwdXNoIHNvdXJjZSkuIFBpbm5lZCBvbnRvIHRoZSBpbmRleCBlbnRyeSB3aGVuXG4gICAqIHRoZSBhY2sgbGFuZHMsIHNvIHRoZSBlbnRyeSdzIChoYXNoLCBzaXplLCBtdGltZSkgYWx3YXlzIGRlc2NyaWJlcyBPTkVcbiAgICogY29uc2lzdGVudCBpbnN0YW50IG9mIHRoZSBmaWxlIFx1MjAxNCBuZXZlciBhIGxhdGVyIHN0YXQgcGFpcmVkIHdpdGggdGhpc1xuICAgKiBoYXNoLiBUaGF0IG9yZGVyaW5nIGlzIHdoYXQgbGV0cyB0aGUgc2NhbiBmYXN0LXBhdGggKG10aW1lK3NpemUpIHNraXBcbiAgICogcmUtaGFzaGluZyBzYWZlbHk6IGFuIGVkaXQgbGFuZGluZyBiZXR3ZWVuIGhhc2ggYW5kIGFjayBjaGFuZ2VzIHRoZSBkaXNrXG4gICAqIHN0YXQsIG1pc3NlcyB0aGUgZmFzdCBwYXRoLCBhbmQgaXMgcmUtaGFzaGVkIGFuZCBwdXNoZWQgb24gdGhlIG5leHQgc2Nhbi5cbiAgICovXG4gIG10aW1lPzogbnVtYmVyO1xufVxuXG4vLyAtLS0gdGhlIGNsaWVudCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGNsYXNzIFN5bmNDbGllbnQge1xuICBwcml2YXRlIHJlYWRvbmx5IG9wdGlvbnM6IFN5bmNDbGllbnRPcHRpb25zO1xuICBwcml2YXRlIHJlYWRvbmx5IGxvZzogTG9nQWRhcHRlcjtcbiAgcHJpdmF0ZSByZWFkb25seSBub3c6ICgpID0+IG51bWJlcjtcbiAgcHJpdmF0ZSByZWFkb25seSBkZWJvdW5jZU1zOiBudW1iZXI7XG4gIHByaXZhdGUgcmVhZG9ubHkgc2NoZWR1bGU6IChmbjogKCkgPT4gdm9pZCwgbXM6IG51bWJlcikgPT4gKCkgPT4gdm9pZDtcbiAgcHJpdmF0ZSByZWFkb25seSBkaWFsVHJhbnNwb3J0OiAoKSA9PiBUcmFuc3BvcnQ7XG4gIHByaXZhdGUgcmVhZG9ubHkgcHVzaENvbmN1cnJlbmN5OiBudW1iZXI7XG4gIHByaXZhdGUgcmVhZG9ubHkgcHJvZ3Jlc3NUaHJvdHRsZU1zOiBudW1iZXI7XG5cbiAgcHJpdmF0ZSB0cmFuc3BvcnQ6IFRyYW5zcG9ydCB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHN0YXRlOiBTeW5jQ2xpZW50U3RhdGUgPSAnaWRsZSc7XG4gIHByaXZhdGUgaW5kZXg6IExvY2FsSW5kZXggPSB7fTtcbiAgcHJpdmF0ZSBjdXJzb3IgPSAwO1xuICBwcml2YXRlIGxhc3RTeW5jQXQ6IG51bWJlciB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHBlbmRpbmcgPSAwO1xuICBwcml2YXRlIGNvbmZsaWN0czogQ29uZmxpY3RPcFtdID0gW107XG4gIHByaXZhdGUgaWdub3JlU2V0dGluZ3M6IElnbm9yZVNldHRpbmdzO1xuICBwcml2YXRlIHdhdGNoQWRhcHRlcjogV2F0Y2hBZGFwdGVyIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgY2FuY2VsRGVib3VuY2U6ICgoKSA9PiB2b2lkKSB8IG51bGwgPSBudWxsO1xuXG4gIC8qKlxuICAgKiBEZWx0YS1tYW5pZmVzdCBib29ra2VlcGluZyAocGVyc2lzdGVkIGFsb25nc2lkZSB0aGUgaW5kZXgsIHNlZVxuICAgKiBgUGVyc2lzdGVkU3luY1N0YXRlYCk6IGBzeW5jZWRUaHJvdWdoYCBcdTIwMTQgdGhlIG1hbmlmZXN0IGN1cnNvciBvZiB0aGUgbGFzdFxuICAgKiBmdWxseS1zdWNjZXNzZnVsIGN5Y2xlLCBpLmUuIHRoZSBzZXEgdGhyb3VnaCB3aGljaCB0aGUgaW5kZXggaXMga25vd25cbiAgICogQ09NUExFVEUgKG51bGwgdW50aWwgb25lIGZpbmlzaGVzKTsgYG5lZWRzRnVsbE1hbmlmZXN0YCBcdTIwMTQgYSByZW1vdGUgY2hhbmdlXG4gICAqIHdhcyBkZWZlcnJlZCBvdmVyIGxvY2FsIGRpdmVyZ2VuY2UgYW5kIG11c3QgYmUgcmVzb2x2ZWQgdGhyb3VnaCBhIGZ1bGxcbiAgICogbWFuaWZlc3QncyBwbGFuIGxvZ2ljOyBgc2VydmVyT2xkZXN0UmV0YWluZWRTZXFgIFx1MjAxNCB0aGUgaGVsbG9BY2sncyBhbnN3ZXJcbiAgICogdG8gXCJpcyBteSByZXBsYXkgd2luZG93IGludGFjdFwiIChudWxsIGZvciBsZWdhY3kgc2VydmVycyBcdTIxRDIgYWx3YXlzIGZ1bGwpLlxuICAgKi9cbiAgcHJpdmF0ZSBzeW5jZWRUaHJvdWdoOiBudW1iZXIgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBuZWVkc0Z1bGxNYW5pZmVzdCA9IGZhbHNlO1xuICBwcml2YXRlIHNlcnZlck9sZGVzdFJldGFpbmVkU2VxOiBudW1iZXIgfCBudWxsID0gbnVsbDtcblxuICAvKiogQ3VycmVudCBidWxrLXBoYXNlIHByb2dyZXNzLCBjbGVhcmVkIHdoZW4gYSBjeWNsZSBzZXR0bGVzLiAqL1xuICBwcml2YXRlIHByb2dyZXNzOiBTeW5jUHJvZ3Jlc3MgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBsYXN0UHJvZ3Jlc3NBdCA9IDA7XG5cbiAgLyoqIFNlcmlhbGl6ZWQgb3BlcmF0aW9uIHF1ZXVlIFx1MjAxNCBleGFjdGx5IG9uZSBhc3luYyBvcCBydW5zIGF0IGEgdGltZS4gKi9cbiAgcHJpdmF0ZSB0YWlsOiBQcm9taXNlPHVua25vd24+ID0gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIHByaXZhdGUgcXVldWVkT3BzID0gMDtcbiAgLyoqIFN0YXJ0dXAtdGltZSBjaGFuZ2UgZmxvb2QgaXMgYnVmZmVyZWQ7IHRoZSBmdWxsIG1hbmlmZXN0IHN1YnN1bWVzIGl0LiAqL1xuICBwcml2YXRlIGJ1ZmZlcmluZyA9IGZhbHNlO1xuICBwcml2YXRlIGJ1ZmZlcmVkOiBNZXNzYWdlW10gPSBbXTtcbiAgLyoqXG4gICAqIE91dHN0YW5kaW5nIHJlcXVlc3QgZXhwZWN0YXRpb25zLCBvbGRlc3QgZmlyc3QuIE9wcyBhcmUgc2VyaWFsaXplZCBwZXJcbiAgICogY3ljbGUgRVhDRVBUIHRoZSBwdXNoIHBpcGVsaW5lLCB3aGljaCBrZWVwcyBzZXZlcmFsIGNvbW1pdHMgaW4gZmxpZ2h0IFx1MjAxNFxuICAgKiByZXBsaWVzIG9uIHRoZSBvcmRlcmVkIFdTIGFycml2ZSBpbiBzZW5kIG9yZGVyLCBzbyBtYXRjaGluZyB0aGUgT0xERVNUXG4gICAqIGV4cGVjdGF0aW9uIHRoYXQgYWNjZXB0cyBhIG1lc3NhZ2UgcGFpcnMgZXZlcnkgcmVwbHkgd2l0aCBpdHMgcmVxdWVzdFxuICAgKiAodGhlIERPIGFyYml0cmF0ZXMgYmVoaW5kIGBydW5FeGNsdXNpdmVgLCBhbmQgdGhlIGluLW1lbW9yeSBzZXJ2ZXJcbiAgICogbWlycm9ycyB0aGF0LCBzbyB0aGUgc2VydmVyIG5ldmVyIHJlb3JkZXJzIHJlcGxpZXMgZWl0aGVyKS5cbiAgICovXG4gIHByaXZhdGUgZXhwZWN0YXRpb25zOiBBcnJheTx7XG4gICAgbWF0Y2hlczogKG1lc3NhZ2U6IE1lc3NhZ2UpID0+IGJvb2xlYW47XG4gICAgcmVzb2x2ZTogKG1lc3NhZ2U6IE1lc3NhZ2UpID0+IHZvaWQ7XG4gICAgcmVqZWN0OiAoZXJyb3I6IEVycm9yKSA9PiB2b2lkO1xuICB9PiA9IFtdO1xuICAvKipcbiAgICogU2VyaWFsaXplcyBBQ0sgQVBQTElDQVRJT04gYWNyb3NzIHBpcGVsaW5lIHNsb3RzLiBTbG90cyBhd2FpdCByZXBsaWVzXG4gICAqIGNvbmN1cnJlbnRseSwgYnV0IGVhY2ggcmVwbHkgZm9sZHMgaW50byB0aGUgU0hBUkVEIGB0aGlzLmluZGV4YFxuICAgKiAocmVhZC1tb2RpZnktd3JpdGUpOyBjaGFpbmluZyB0aGUgZm9sZHMga2VlcHMgZXZlcnkgYXBwbHkgYXRvbWljIHdpdGhcbiAgICogcmVzcGVjdCB0byB0aGUgb3RoZXJzLiBPcmRlciBhY3Jvc3MgZGlmZmVyZW50IHBhdGhzIGlzIGlycmVsZXZhbnQgKG9uZVxuICAgKiBjb21taXQgcGVyIHBhdGggcGVyIGN5Y2xlLCBwZXItcGF0aCBzZXJ2ZXIgYXJiaXRyYXRpb24pLCBzbyBubyBvcmRlcmluZ1xuICAgKiBndWFyYW50ZWUgaXMgbmVlZGVkIGJleW9uZCBtdXR1YWwgZXhjbHVzaW9uLlxuICAgKi9cbiAgcHJpdmF0ZSBhY2tDaGFpbjogUHJvbWlzZTx2b2lkPiA9IFByb21pc2UucmVzb2x2ZSgpO1xuXG4gIGNvbnN0cnVjdG9yKG9wdGlvbnM6IFN5bmNDbGllbnRPcHRpb25zKSB7XG4gICAgdGhpcy5vcHRpb25zID0gb3B0aW9ucztcbiAgICB0aGlzLmxvZyA9IG9wdGlvbnMubG9nID8/IGRlZmF1bHRMb2c7XG4gICAgdGhpcy5ub3cgPSBvcHRpb25zLm5vdyA/PyAoKCkgPT4gRGF0ZS5ub3coKSk7XG4gICAgdGhpcy5kZWJvdW5jZU1zID0gb3B0aW9ucy5kZWJvdW5jZU1zID8/IDMwMDtcbiAgICB0aGlzLnNjaGVkdWxlID0gb3B0aW9ucy5zY2hlZHVsZSA/PyBkZWZhdWx0U2NoZWR1bGU7XG4gICAgdGhpcy5wdXNoQ29uY3VycmVuY3kgPSBNYXRoLm1heCgxLCBvcHRpb25zLnB1c2hDb25jdXJyZW5jeSA/PyBERUZBVUxUX1BVU0hfQ09OQ1VSUkVOQ1kpO1xuICAgIHRoaXMucHJvZ3Jlc3NUaHJvdHRsZU1zID0gTWF0aC5tYXgoMCwgb3B0aW9ucy5wcm9ncmVzc1Rocm90dGxlTXMgPz8gREVGQVVMVF9QUk9HUkVTU19USFJPVFRMRV9NUyk7XG4gICAgdGhpcy5kaWFsVHJhbnNwb3J0ID1cbiAgICAgIHR5cGVvZiBvcHRpb25zLnRyYW5zcG9ydCA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgICA/IG9wdGlvbnMudHJhbnNwb3J0XG4gICAgICAgIDogKCkgPT4gb3B0aW9ucy50cmFuc3BvcnQgYXMgVHJhbnNwb3J0O1xuICAgIHRoaXMuaWdub3JlU2V0dGluZ3MgPSBvcHRpb25zLnNldHRpbmdzID8/IHsgb2JzaWRpYW5TeW5jOiBmYWxzZSB9O1xuICB9XG5cbiAgLy8gLS0tIGxpZmVjeWNsZSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgLyoqIFJ1biBzdGFydHVwIHJlY29uY2lsaWF0aW9uIGFuZCBlbnRlciBsaXZlIG1vZGUuICovXG4gIGFzeW5jIGNvbm5lY3QoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5lbnF1ZXVlKCgpID0+IHRoaXMuc3RhcnR1cCgpKTtcbiAgfVxuXG4gIC8qKiBSZS1kaWFsIGFuZCByZS1ydW4gdGhlIGZ1bGwgc3RhcnR1cCByZWNvbmNpbGlhdGlvbi4gKi9cbiAgYXN5bmMgcmVjb25uZWN0KCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMuZW5xdWV1ZShhc3luYyAoKSA9PiB7XG4gICAgICB0aGlzLnRyYW5zcG9ydD8uY2xvc2UoKTtcbiAgICAgIHRoaXMudHJhbnNwb3J0ID0gbnVsbDtcbiAgICAgIGF3YWl0IHRoaXMuc3RhcnR1cCgpO1xuICAgIH0pO1xuICB9XG5cbiAgY2xvc2UoKTogdm9pZCB7XG4gICAgdGhpcy5zdG9wV2F0Y2hpbmcoKTtcbiAgICB0aGlzLmNhbmNlbERlYm91bmNlPy4oKTtcbiAgICB0aGlzLmNhbmNlbERlYm91bmNlID0gbnVsbDtcbiAgICB0aGlzLnRyYW5zcG9ydD8uY2xvc2UoKTtcbiAgICB0aGlzLnRyYW5zcG9ydCA9IG51bGw7XG4gICAgdGhpcy5zdGF0ZSA9ICdpZGxlJztcbiAgfVxuXG4gIC8qKiBCZWdpbiBkZWJvdW5jZWQgd2F0Y2hpbmcgKEFSQ0hJVEVDVFVSRSBcdTAwQTc4IGxpdmUgb3BlcmF0aW9uKS4gKi9cbiAgc3RhcnRXYXRjaGluZyh3YXRjaEFkYXB0ZXI6IFdhdGNoQWRhcHRlcik6IHZvaWQge1xuICAgIHRoaXMuc3RvcFdhdGNoaW5nKCk7XG4gICAgdGhpcy53YXRjaEFkYXB0ZXIgPSB3YXRjaEFkYXB0ZXI7XG4gICAgd2F0Y2hBZGFwdGVyLnN0YXJ0KChldmVudHMpID0+IHRoaXMub25XYXRjaEV2ZW50cyhldmVudHMpKTtcbiAgfVxuXG4gIHN0b3BXYXRjaGluZygpOiB2b2lkIHtcbiAgICB0aGlzLndhdGNoQWRhcHRlcj8uc3RvcCgpO1xuICAgIHRoaXMud2F0Y2hBZGFwdGVyID0gbnVsbDtcbiAgfVxuXG4gIC8qKiBNYW51YWwgb25lLXNob3QgY3ljbGUgKGB2c2FgIG9uZS1zaG90LCBcInN5bmMgbm93XCIgYnV0dG9ucywgdGVzdHMpLiAqL1xuICBhc3luYyB0cmlnZ2VyU3luYygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLmVucXVldWUoKCkgPT4gdGhpcy5ydW5DeWNsZSgpKTtcbiAgfVxuXG4gIC8qKiBSZXNvbHZlcyB3aGVuIGV2ZXJ5IHF1ZXVlZCBvcGVyYXRpb24gaGFzIHNldHRsZWQuICovXG4gIGFzeW5jIHdhaXRJZGxlKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHdoaWxlICh0aGlzLnF1ZXVlZE9wcyA+IDApIGF3YWl0IHRoaXMudGFpbDtcbiAgICBhd2FpdCB0aGlzLnRhaWw7XG4gIH1cblxuICBzdGF0dXMoKTogU3luY0NsaWVudFN0YXR1cyB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB0aGlzLnN0YXRlLFxuICAgICAgbGFzdFN5bmNBdDogdGhpcy5sYXN0U3luY0F0LFxuICAgICAgcGVuZGluZzogdGhpcy5wZW5kaW5nLFxuICAgICAgY29uZmxpY3RzOiBbLi4udGhpcy5jb25mbGljdHNdLFxuICAgICAgLi4uKHRoaXMucHJvZ3Jlc3MgIT09IG51bGwgPyB7IHByb2dyZXNzOiB7IC4uLnRoaXMucHJvZ3Jlc3MgfSB9IDoge30pLFxuICAgIH07XG4gIH1cblxuICAvKiogUmVhZC1vbmx5IHZpZXcgb2YgdGhlIGxvY2FsIGluZGV4ICh0ZXN0cywgYHZzYSBzdGF0dXNgKS4gKi9cbiAgY3VycmVudEluZGV4KCk6IExvY2FsSW5kZXgge1xuICAgIHJldHVybiB7IC4uLnRoaXMuaW5kZXggfTtcbiAgfVxuXG4gIC8qKiBMYXN0IHNlZW4gc2VydmVyIHNlcXVlbmNlIG51bWJlci4gKi9cbiAgZ2V0IGN1cnNvclZhbHVlKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMuY3Vyc29yO1xuICB9XG5cbiAgLyoqIFRTLXNhZmUgc3RhdGUgcHJvYmUgKGFzc2lnbm1lbnRzIGluc2lkZSBhc3luYyBmbG93cyBkZWZlYXQgbmFycm93aW5nKS4gKi9cbiAgcHJpdmF0ZSBpc0Rpc2Nvbm5lY3RlZCgpOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy5zdGF0ZSA9PT0gJ2Rpc2Nvbm5lY3RlZCc7XG4gIH1cblxuICAvLyAtLS0gc3RhcnR1cCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgcHJpdmF0ZSBhc3luYyBzdGFydHVwKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuc3RhdGUgPSAnY29ubmVjdGluZyc7XG4gICAgdGhpcy5idWZmZXJpbmcgPSB0cnVlO1xuICAgIHRoaXMuYnVmZmVyZWQgPSBbXTtcblxuICAgIC8vIFJlc3RvcmUgdGhlIGluZGV4IEFORCB0aGUgc3luYy1jdXJzb3IgYm9va2tlZXBpbmcgKG9uZSBhdG9taWMgZmlsZSk6XG4gICAgLy8gdGhlIHBlcnNpc3RlZCBjdXJzb3IgbGV0cyBoZWxsbyByZXBsYXkgb25seSB3aGF0IHdhcyBtaXNzZWQsIGFuZFxuICAgIC8vIGBzeW5jZWRUaHJvdWdoYCBkZWNpZGVzIHdoZXRoZXIgYSBkZWx0YSBtYW5pZmVzdCBtYXkgYmUgcmVxdWVzdGVkLlxuICAgIGlmIChhd2FpdCB0aGlzLnNhZmVTdG9yYWdlRXhpc3RzKExPQ0FMX0lOREVYX1NUQVRFX1BBVEgpKSB7XG4gICAgICBjb25zdCBsb2FkZWQgPSBhd2FpdCBsb2FkTG9jYWxTdGF0ZSh0aGlzLm9wdGlvbnMuc3RvcmFnZSk7XG4gICAgICB0aGlzLmluZGV4ID0gbG9hZGVkLmluZGV4O1xuICAgICAgdGhpcy5jdXJzb3IgPSBsb2FkZWQuc3RhdGUuY3Vyc29yO1xuICAgICAgdGhpcy5zeW5jZWRUaHJvdWdoID0gbG9hZGVkLnN0YXRlLnN5bmNlZFRocm91Z2g7XG4gICAgICB0aGlzLm5lZWRzRnVsbE1hbmlmZXN0ID0gbG9hZGVkLnN0YXRlLm5lZWRzRnVsbE1hbmlmZXN0O1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmluZGV4ID0ge307XG4gICAgICB0aGlzLmN1cnNvciA9IDA7XG4gICAgICB0aGlzLnN5bmNlZFRocm91Z2ggPSBudWxsO1xuICAgICAgdGhpcy5uZWVkc0Z1bGxNYW5pZmVzdCA9IGZhbHNlO1xuICAgIH1cbiAgICB0aGlzLnNlcnZlck9sZGVzdFJldGFpbmVkU2VxID0gbnVsbDtcblxuICAgIGNvbnN0IHRyYW5zcG9ydCA9IHRoaXMuZGlhbFRyYW5zcG9ydCgpO1xuICAgIHRoaXMudHJhbnNwb3J0ID0gdHJhbnNwb3J0O1xuICAgIHRyYW5zcG9ydC5vbk1lc3NhZ2UoKG1lc3NhZ2UpID0+IHRoaXMub25UcmFuc3BvcnRNZXNzYWdlKG1lc3NhZ2UpKTtcbiAgICB0cmFuc3BvcnQub25DbG9zZSgocmVhc29uKSA9PiB0aGlzLm9uVHJhbnNwb3J0Q2xvc2UocmVhc29uKSk7XG5cbiAgICBjb25zdCBoZWxsb0FjayA9IGF3YWl0IHRoaXMucmVxdWVzdDxIZWxsb0Fja01lc3NhZ2UgfCBTZXJ2ZXJFcnJvck1lc3NhZ2U+KFxuICAgICAgKG0pID0+IG0udHlwZSA9PT0gJ2hlbGxvQWNrJyB8fCBtLnR5cGUgPT09ICdlcnJvcicsXG4gICAgICAoKSA9PlxuICAgICAgICB0cmFuc3BvcnQuc2VuZCh7XG4gICAgICAgICAgdHlwZTogJ2hlbGxvJyxcbiAgICAgICAgICB0b2tlbjogdGhpcy5vcHRpb25zLnRva2VuLFxuICAgICAgICAgIHByb3RvY29sVmVyc2lvbjogUHJvdG9jb2xWZXJzaW9uLFxuICAgICAgICAgIGN1cnNvcjogdGhpcy5jdXJzb3IsXG4gICAgICAgIH0pLFxuICAgICk7XG4gICAgaWYgKGhlbGxvQWNrLnR5cGUgPT09ICdlcnJvcicpIHRocm93IHRoaXMudG9FcnJvcihoZWxsb0Fjayk7XG4gICAgLy8gVGhlIHNlcnZlcidzIHBlci12YXVsdCBgb2JzaWRpYW5TeW5jYCBzdXBlcnNlZGVzIHRoZSBsb2NhbCBpbml0aWFsXG4gICAgLy8gdmFsdWUsIGJ1dCBgZXh0cmFJZ25vcmVzYCBpcyBhIGNsaWVudC1zaWRlIGNvbmNlcm4gXHUyMDE0IHRoZSB3b3JrZXIgbmV2ZXJcbiAgICAvLyBzZW5kcyBpdCwgc28gdGhlIGxvY2FsbHkgY29uZmlndXJlZCBwYXR0ZXJucyBzdXJ2aXZlIHRoZSBoYW5kc2hha2UuXG4gICAgdGhpcy5pZ25vcmVTZXR0aW5ncyA9IHtcbiAgICAgIG9ic2lkaWFuU3luYzogaGVsbG9BY2suc2V0dGluZ3Mub2JzaWRpYW5TeW5jLFxuICAgICAgLi4uKHRoaXMuaWdub3JlU2V0dGluZ3MuZXh0cmFJZ25vcmVzICE9PSB1bmRlZmluZWRcbiAgICAgICAgPyB7IGV4dHJhSWdub3JlczogdGhpcy5pZ25vcmVTZXR0aW5ncy5leHRyYUlnbm9yZXMgfVxuICAgICAgICA6IHt9KSxcbiAgICB9O1xuICAgIC8vIFJlcGxheS13aW5kb3cgYW5zd2VyOiB3aXRoIHRoaXMsIHRoZSBjbGllbnQgY2FuIHRlbGwgd2hldGhlciBldmVyeVxuICAgIC8vIGV2ZW50IGFmdGVyIGl0cyBjdXJzb3Igd2FzIHJldGFpbmVkIChkZWx0YS1tYW5pZmVzdCBlbGlnaWJpbGl0eSkuXG4gICAgdGhpcy5zZXJ2ZXJPbGRlc3RSZXRhaW5lZFNlcSA9IGhlbGxvQWNrLm9sZGVzdFJldGFpbmVkU2VxID8/IG51bGw7XG5cbiAgICB0aGlzLnN0YXRlID0gJ3N5bmNpbmcnO1xuICAgIGlmICh0aGlzLnNob3VsZFJlcXVlc3REZWx0YU1hbmlmZXN0KCkpIHtcbiAgICAgIC8vIERFTFRBIE1PREU6IGFwcGx5IHRoZSByZXBsYXllZCBjaGFuZ2VzIEJFRk9SRSBwbGFubmluZy4gVGhlIGRlbHRhXG4gICAgICAvLyBtYW5pZmVzdCBvbWl0cyBldmVyeSBoZWFkIGF0IG9yIGJlbG93IHRoZSBjdXJzb3IgXHUyMDE0IGluY2x1ZGluZyBoZWFkc1xuICAgICAgLy8gdGhhdCBubyBsb25nZXIgZXhpc3QgYmVjYXVzZSB0aGUgYXV0aG9yaXR5IE1JR1JBVEVEIHRoZW0gKGEgcmVuYW1lXG4gICAgICAvLyBkZWxldGVzIHRoZSBvbGQgcm93KSBcdTIwMTQgc28gdGhlIGluZGV4IHByb2plY3Rpb24gbXVzdCBub3QgY2FycnkgdGhvc2VcbiAgICAgIC8vIHBhdGhzIGFueW1vcmUuIFRoZSByZXBsYXllZCByZW5hbWUgKHNlcSA+IGN1cnNvcikgbWF0ZXJpYWxpemVzIGhlcmVcbiAgICAgIC8vIGFuZCByZW1vdmVzIHRoZSBzdGFsZSBwYXRoLCBtYWtpbmcgdGhlIG1lcmdlZCB2aWV3IGlkZW50aWNhbCB0byB3aGF0XG4gICAgICAvLyBhIGZ1bGwgbWFuaWZlc3Qgd291bGQgaGF2ZSBzYWlkLiAoVGhlIG9yZGVyZWQgd2lyZSBndWFyYW50ZWVzIHRoZVxuICAgICAgLy8gcmVwbGF5IHByZWNlZGVzIHRoZSBtYW5pZmVzdCByZXBseTsgYW55dGhpbmcgc3RyYWdnbGluZyBzdGF5c1xuICAgICAgLy8gYnVmZmVyZWQgYW5kIGlzIGRpc3BhdGNoZWQgYWZ0ZXIgdGhlIGN5Y2xlLCBhcyBhbHdheXMuKSBBIHJlcGxheWVkXG4gICAgICAvLyBjaGFuZ2UgdGhhdCBoaXRzIHRoZSBkaXZlcmdlbmNlIGd1YXJkIGZsaXBzIGBuZWVkc0Z1bGxNYW5pZmVzdGAsXG4gICAgICAvLyBhbmQgYGZldGNoTWFuaWZlc3RgIHJlLWV2YWx1YXRlcyBcdTIwMTQgZmFsbGluZyBiYWNrIHRvIGZ1bGwsIGFzIGRlc2lnbmVkLlxuICAgICAgY29uc3QgcmVwbGF5ID0gdGhpcy5idWZmZXJlZDtcbiAgICAgIHRoaXMuYnVmZmVyZWQgPSBbXTtcbiAgICAgIGZvciAoY29uc3QgbWVzc2FnZSBvZiByZXBsYXkpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5kaXNwYXRjaChtZXNzYWdlKTtcbiAgICAgIH1cbiAgICB9XG4gICAgYXdhaXQgdGhpcy5ydW5DeWNsZSgpO1xuXG4gICAgdGhpcy5idWZmZXJpbmcgPSBmYWxzZTtcbiAgICBjb25zdCBidWZmZXJlZCA9IHRoaXMuYnVmZmVyZWQ7XG4gICAgdGhpcy5idWZmZXJlZCA9IFtdO1xuICAgIGZvciAoY29uc3QgbWVzc2FnZSBvZiBidWZmZXJlZCkge1xuICAgICAgYXdhaXQgdGhpcy5kaXNwYXRjaChtZXNzYWdlKTtcbiAgICB9XG4gICAgaWYgKCF0aGlzLmlzRGlzY29ubmVjdGVkKCkpIHRoaXMuc3RhdGUgPSAnbGl2ZSc7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHNhZmVTdG9yYWdlRXhpc3RzKHBhdGg6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5vcHRpb25zLnN0b3JhZ2UuZXhpc3RzKHBhdGgpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgb25UcmFuc3BvcnRDbG9zZShyZWFzb246IHsgY29kZT86IG51bWJlcjsgcmVhc29uPzogc3RyaW5nIH0pOiB2b2lkIHtcbiAgICB0aGlzLmxvZy53YXJuKCd0cmFuc3BvcnQgY2xvc2VkJywgcmVhc29uKTtcbiAgICB0aGlzLnN0YXRlID0gJ2Rpc2Nvbm5lY3RlZCc7XG4gICAgY29uc3QgZXhwZWN0YXRpb25zID0gdGhpcy5leHBlY3RhdGlvbnM7XG4gICAgdGhpcy5leHBlY3RhdGlvbnMgPSBbXTtcbiAgICBmb3IgKGNvbnN0IGV4cGVjdGF0aW9uIG9mIGV4cGVjdGF0aW9ucykge1xuICAgICAgZXhwZWN0YXRpb24ucmVqZWN0KFxuICAgICAgICBuZXcgTmV0d29ya0Vycm9yKGBjb25uZWN0aW9uIGNsb3NlZDogJHtyZWFzb24ucmVhc29uID8/IHJlYXNvbi5jb2RlID8/ICd1bmtub3duJ31gKSxcbiAgICAgICk7XG4gICAgfVxuICB9XG5cbiAgLy8gLS0tIG1lc3NhZ2UgcHVtcCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgcHJpdmF0ZSBvblRyYW5zcG9ydE1lc3NhZ2UgPSAobWVzc2FnZTogTWVzc2FnZSk6IHZvaWQgPT4ge1xuICAgIC8vIE9sZGVzdCBleHBlY3RhdGlvbiB0aGF0IGFjY2VwdHMgdGhpcyBtZXNzYWdlLiBXaXRoIHRoZSBwdXNoIHBpcGVsaW5lXG4gICAgLy8gc2V2ZXJhbCBjb21taXQgZXhwZWN0YXRpb25zIGFyZSBvdXRzdGFuZGluZyBhdCBvbmNlOyB0aGUgb3JkZXJlZCB3aXJlICtcbiAgICAvLyB0aGUgc2VydmVyJ3Mgc2VyaWFsaXplZCBhcmJpdHJhdGlvbiBkZWxpdmVyIHJlcGxpZXMgaW4gc2VuZCBvcmRlciwgc29cbiAgICAvLyBmaXJzdC1tYXRjaCBwYWlycyBlYWNoIHJlcGx5IHdpdGggaXRzIG93biByZXF1ZXN0LlxuICAgIGNvbnN0IGluZGV4ID0gdGhpcy5leHBlY3RhdGlvbnMuZmluZEluZGV4KChleHBlY3RhdGlvbikgPT4gZXhwZWN0YXRpb24ubWF0Y2hlcyhtZXNzYWdlKSk7XG4gICAgaWYgKGluZGV4ID49IDApIHtcbiAgICAgIGNvbnN0IGV4cGVjdGF0aW9uID0gdGhpcy5leHBlY3RhdGlvbnNbaW5kZXhdO1xuICAgICAgdGhpcy5leHBlY3RhdGlvbnMuc3BsaWNlKGluZGV4LCAxKTtcbiAgICAgIGlmIChleHBlY3RhdGlvbiAhPT0gdW5kZWZpbmVkKSBleHBlY3RhdGlvbi5yZXNvbHZlKG1lc3NhZ2UpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAodGhpcy5idWZmZXJpbmcpIHtcbiAgICAgIHRoaXMuYnVmZmVyZWQucHVzaChtZXNzYWdlKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5lbnF1ZXVlKGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuZGlzcGF0Y2gobWVzc2FnZSk7XG4gICAgfSkuY2F0Y2goKGVycm9yOiB1bmtub3duKSA9PiB0aGlzLmxvZy53YXJuKCdjaGFuZ2UgaGFuZGxlciBmYWlsZWQnLCBlcnJvcikpO1xuICB9O1xuXG4gIHByaXZhdGUgYXN5bmMgZGlzcGF0Y2gobWVzc2FnZTogTWVzc2FnZSk6IFByb21pc2U8dm9pZD4ge1xuICAgIHN3aXRjaCAobWVzc2FnZS50eXBlKSB7XG4gICAgICBjYXNlICdjaGFuZ2UnOlxuICAgICAgICBhd2FpdCB0aGlzLmhhbmRsZUNoYW5nZShtZXNzYWdlKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgY2FzZSAnZGV2aWNlU2Vlbic6XG4gICAgICAgIHJldHVybjsgLy8gcHJlc2VuY2Ugb25seTsgZGFzaGJvYXJkcyBjb25zdW1lIGl0XG4gICAgICBjYXNlICdwb25nJzpcbiAgICAgICAgcmV0dXJuO1xuICAgICAgY2FzZSAnZXJyb3InOlxuICAgICAgICB0aGlzLmxvZy5lcnJvcignc2VydmVyIGVycm9yJywgbWVzc2FnZS5jb2RlLCBtZXNzYWdlLm1lc3NhZ2UpO1xuICAgICAgICByZXR1cm47XG4gICAgICBjYXNlICdoZWxsb0Fjayc6XG4gICAgICBjYXNlICdtYW5pZmVzdCc6XG4gICAgICBjYXNlICdjb21taXRBY2snOlxuICAgICAgY2FzZSAnY29uZmxpY3QnOlxuICAgICAgY2FzZSAnYmxvYic6XG4gICAgICBjYXNlICdibG9iQWNrJzpcbiAgICAgICAgLy8gUmVwbGllcyBhcnJpdmUgb25seSBhZ2FpbnN0IGFuIG91dHN0YW5kaW5nIGV4cGVjdGF0aW9uOyBhXG4gICAgICAgIC8vIHNwb250YW5lb3VzIG9uZSBpcyBhIHByb3RvY29sIHZpb2xhdGlvbiB3ZSBsb2cgYW5kIGRyb3AuXG4gICAgICAgIHRoaXMubG9nLndhcm4oJ3VuZXhwZWN0ZWQgc2VydmVyIHJlcGx5JywgbWVzc2FnZS50eXBlKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgdGhpcy5sb2cud2FybignaWdub3JpbmcgY2xpZW50LXRvLXNlcnZlciBtZXNzYWdlIGZyb20gc2VydmVyJywgbWVzc2FnZSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBoYW5kbGVDaGFuZ2UoY2hhbmdlOiBDaGFuZ2VNZXNzYWdlKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKGNoYW5nZS5zZXEgPiB0aGlzLmN1cnNvcikgdGhpcy5jdXJzb3IgPSBjaGFuZ2Uuc2VxO1xuICAgIGlmIChpc0lnbm9yZWQoY2hhbmdlLnBhdGgsIHRoaXMuaWdub3JlU2V0dGluZ3MpKSByZXR1cm47XG4gICAgaWYgKGNoYW5nZS5mcm9tUGF0aCAhPT0gdW5kZWZpbmVkICYmIGlzSWdub3JlZChjaGFuZ2UuZnJvbVBhdGgsIHRoaXMuaWdub3JlU2V0dGluZ3MpKSByZXR1cm47XG5cbiAgICAvLyBTdGFsZSByZXBsYXkgLyBkdXBsaWNhdGUgZmFuLW91dDogcGVyIHBhdGggdGhlIGhlYWQgY2xvY2sgZG9taW5hdGVzXG4gICAgLy8gZXZlcnkgZWFybGllciB2ZXJzaW9uLCBzbyBhbnl0aGluZyBcdTIyNjQgdGhlIHJlY29yZGVkIGNsb2NrIGlzIG9sZCBuZXdzLlxuICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5pbmRleFtjaGFuZ2UucGF0aF07XG4gICAgaWYgKGVudHJ5ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGlmIChlbnRyeS52ZXJzaW9uSWQgPT09IGNoYW5nZS52ZXJzaW9uKSByZXR1cm47XG4gICAgICBpZiAoY29tcGFyZUNsb2NrcyhlbnRyeS5jbG9jaywgY2hhbmdlLmNsb2NrKSA+PSAwKSByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gVGhlIGd1YXJkOiBuZXZlciB3cml0ZSBhIHJlbW90ZSBjaGFuZ2Ugb3ZlciBsb2NhbGx5LWRpdmVyZ2VkIGNvbnRlbnQuXG4gICAgaWYgKCEoYXdhaXQgdGhpcy5jaGFuZ2VJc1NhZmUoY2hhbmdlKSkpIHtcbiAgICAgIHRoaXMubG9nLmluZm8oJ2RlZmVycmluZyByZW1vdGUgY2hhbmdlIG92ZXIgbG9jYWwgZGl2ZXJnZW5jZScsIGNoYW5nZS5wYXRoKTtcbiAgICAgIC8vIFRoZSBkaXZlcmdlbmNlIG11c3QgYmUgcmVzb2x2ZWQgYnkgYSBwbGFuIGN5Y2xlIHRoYXQgY2FuIFNFRSB0aGVcbiAgICAgIC8vIHJlbW90ZSBoZWFkIFx1MjAxNCBmbGFnIHRoZSBuZXh0IG1hbmlmZXN0IGZ1bGwgKGRlbHRhIG1hbmlmZXN0cyBvbWl0XG4gICAgICAvLyBoZWFkcyBhdCBvciBiZWxvdyB0aGUgY3Vyc29yLCB3aGljaCB0aGlzIGNoYW5nZSBtYXkgYmUgYXQpLlxuICAgICAgdGhpcy5uZWVkc0Z1bGxNYW5pZmVzdCA9IHRydWU7XG4gICAgICB0aGlzLnNjaGVkdWxlUmVjb25jaWxlKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdGhpcy5pbmRleCA9IGF3YWl0IHRoaXMuYXBwbHlQdWxscyhbdGhpcy5wdWxsT3BGcm9tQ2hhbmdlKGNoYW5nZSldKTtcbiAgICAvLyBUaGlzIHBhdGgncyBoZWFkIGlzIG5vdyBtYXRlcmlhbGl6ZWQgbG9jYWxseSwgc28gdGhlIGNvbXBsZXRpb25cbiAgICAvLyB3YXRlcm1hcmsgYWR2YW5jZXMgd2l0aCB0aGUgKHN0cmljdGx5IG9yZGVyZWQpIGZlZWQuIEEgY2hhbmdlIHRoYXRcbiAgICAvLyB0b29rIHRoZSBkZWZlciBicmFuY2ggYWJvdmUgbmV2ZXIgcmVhY2hlcyB0aGlzIGxpbmUsIGFuZCBpdHNcbiAgICAvLyBgbmVlZHNGdWxsTWFuaWZlc3RgIGZsYWcga2VlcHMgZGVsdGEgbW9kZSBvZmYgdW50aWwgYSBmdWxsLW1hbmlmZXN0XG4gICAgLy8gY3ljbGUgcmVzb2x2ZXMgdGhlIGRpdmVyZ2VuY2UuXG4gICAgaWYgKGNoYW5nZS5zZXEgPiAodGhpcy5zeW5jZWRUaHJvdWdoID8/IDApKSB0aGlzLnN5bmNlZFRocm91Z2ggPSBjaGFuZ2Uuc2VxO1xuICB9XG5cbiAgLyoqXG4gICAqIEEgY2hhbmdlIG1heSBiZSBhcHBsaWVkIGRpcmVjdGx5IG9ubHkgd2hlbiB0aGUgdG91Y2hlZCBwYXRocyBjYXJyeSBub1xuICAgKiB1bi1yZWNvbmNpbGVkIGxvY2FsIGNvbnRlbnQuIEFueXRoaW5nIGVsc2UgbXVzdCBkZXRvdXIgdGhyb3VnaCBhIGZ1bGxcbiAgICogYGNvbXB1dGVTeW5jUGxhbmAgY3ljbGUgKGNvbmZsaWN0IGxvZ2ljLCBjb25mbGljdCBjb3BpZXMpLlxuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyBjaGFuZ2VJc1NhZmUoY2hhbmdlOiBDaGFuZ2VNZXNzYWdlKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgaWYgKGNoYW5nZS5pc0ZvbGRlciA9PT0gdHJ1ZSkgcmV0dXJuIHRydWU7XG4gICAgaWYgKGNoYW5nZS5raW5kID09PSAncmVuYW1lJyAmJiBjaGFuZ2UuZnJvbVBhdGggIT09IHVuZGVmaW5lZCkge1xuICAgICAgaWYgKGF3YWl0IHRoaXMucGF0aEhhc0xvY2FsRGl2ZXJnZW5jZShjaGFuZ2UuZnJvbVBhdGgpKSByZXR1cm4gZmFsc2U7XG4gICAgICBpZiAoYXdhaXQgdGhpcy5zdG9yYWdlRXhpc3RzKGNoYW5nZS5wYXRoKSkge1xuICAgICAgICBjb25zdCBlbnRyeSA9IHRoaXMuaW5kZXhbY2hhbmdlLnBhdGhdO1xuICAgICAgICBpZiAoZW50cnkgPT09IHVuZGVmaW5lZCB8fCBlbnRyeS5kZWxldGVkQXQgIT09IHVuZGVmaW5lZCkgcmV0dXJuIGZhbHNlO1xuICAgICAgICBjb25zdCBhY3R1YWwgPSBhd2FpdCBzaGEyNTZIZXgoYXdhaXQgdGhpcy5vcHRpb25zLnN0b3JhZ2UucmVhZEZpbGUoY2hhbmdlLnBhdGgpKTtcbiAgICAgICAgaWYgKGFjdHVhbCAhPT0gZW50cnkuaGFzaCkgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIHJldHVybiAhKGF3YWl0IHRoaXMucGF0aEhhc0xvY2FsRGl2ZXJnZW5jZShjaGFuZ2UucGF0aCkpO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBwYXRoSGFzTG9jYWxEaXZlcmdlbmNlKHBhdGg6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5pbmRleFtwYXRoXTtcbiAgICBpZiAoZW50cnk/LmlzRm9sZGVyKSByZXR1cm4gZmFsc2U7XG4gICAgaWYgKCEoYXdhaXQgdGhpcy5zdG9yYWdlRXhpc3RzKHBhdGgpKSkgcmV0dXJuIGZhbHNlO1xuICAgIGlmIChlbnRyeSA9PT0gdW5kZWZpbmVkIHx8IGVudHJ5LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkKSByZXR1cm4gdHJ1ZTtcbiAgICBjb25zdCBhY3R1YWwgPSBhd2FpdCBzaGEyNTZIZXgoYXdhaXQgdGhpcy5vcHRpb25zLnN0b3JhZ2UucmVhZEZpbGUocGF0aCkpO1xuICAgIHJldHVybiBhY3R1YWwgIT09IGVudHJ5Lmhhc2g7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHN0b3JhZ2VFeGlzdHMocGF0aDogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLm9wdGlvbnMuc3RvcmFnZS5leGlzdHMocGF0aCk7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBwdWxsT3BGcm9tQ2hhbmdlKGNoYW5nZTogQ2hhbmdlTWVzc2FnZSk6IFB1bGxPcCB7XG4gICAgaWYgKGNoYW5nZS5raW5kID09PSAncmVuYW1lJyAmJiBjaGFuZ2UuZnJvbVBhdGggIT09IHVuZGVmaW5lZCkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAga2luZDogJ3JlbmFtZScsXG4gICAgICAgIGZyb21QYXRoOiBjaGFuZ2UuZnJvbVBhdGgsXG4gICAgICAgIHRvUGF0aDogY2hhbmdlLnBhdGgsXG4gICAgICAgIGhhc2g6IGNoYW5nZS5oYXNoLFxuICAgICAgICBzaXplOiBjaGFuZ2Uuc2l6ZSxcbiAgICAgICAgdmVyc2lvbjogY2hhbmdlLnZlcnNpb24sXG4gICAgICAgIGNsb2NrOiBjaGFuZ2UuY2xvY2ssXG4gICAgICB9O1xuICAgIH1cbiAgICBjb25zdCBlbnRyeSA9IHRoaXMuaW5kZXhbY2hhbmdlLnBhdGhdO1xuICAgIGNvbnN0IGtpbmQ6IFB1bGxGaWxlT3BbJ2tpbmQnXSA9IGNoYW5nZS5kZWxldGVkXG4gICAgICA/ICdkZWxldGUnXG4gICAgICA6IGVudHJ5ID09PSB1bmRlZmluZWRcbiAgICAgICAgPyAnYWRkJ1xuICAgICAgICA6IGVudHJ5LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkXG4gICAgICAgICAgPyAncmVzdG9yZSdcbiAgICAgICAgICA6ICdlZGl0JztcbiAgICByZXR1cm4ge1xuICAgICAga2luZCxcbiAgICAgIHBhdGg6IGNoYW5nZS5wYXRoLFxuICAgICAgaGFzaDogY2hhbmdlLmhhc2gsXG4gICAgICBzaXplOiBjaGFuZ2Uuc2l6ZSxcbiAgICAgIHZlcnNpb246IGNoYW5nZS52ZXJzaW9uLFxuICAgICAgY2xvY2s6IGNoYW5nZS5jbG9jayxcbiAgICAgIGRlbGV0ZWQ6IGNoYW5nZS5kZWxldGVkLFxuICAgICAgLi4uKGNoYW5nZS5pc0ZvbGRlciA9PT0gdHJ1ZSA/IHsgaXNGb2xkZXI6IHRydWUgfSA6IHt9KSxcbiAgICB9O1xuICB9XG5cbiAgLyoqIE1hdGVyaWFsaXplIHB1bGxzIHRocm91Z2ggdGhlIHZlcmlmaWVkIGVuZ2luZSBwYXRoOyByZXR1cm5zIHRoZSBuZXcgaW5kZXguICovXG4gIHByaXZhdGUgYXN5bmMgYXBwbHlQdWxscyhcbiAgICBwdWxsczogUmVhZG9ubHlBcnJheTxQdWxsT3A+LFxuICAgIHByb2dyZXNzPzogeyBvblByb2dyZXNzOiAoZG9uZTogbnVtYmVyLCB0b3RhbDogbnVtYmVyKSA9PiB2b2lkIH0sXG4gICk6IFByb21pc2U8TG9jYWxJbmRleD4ge1xuICAgIHJldHVybiBhcHBseVB1bGwoXG4gICAgICB0aGlzLm9wdGlvbnMuc3RvcmFnZSxcbiAgICAgIHRoaXMuaW5kZXgsXG4gICAgICB7IHB1c2hlczogW10sIHB1bGxzOiBbLi4ucHVsbHNdLCBjb25mbGljdHM6IFtdLCBmb2xkZXJQdXNoZXM6IFtdIH0sXG4gICAgICB0aGlzLmZldGNoQmxvYixcbiAgICAgIHtcbiAgICAgICAgbm93OiB0aGlzLm5vdygpLFxuICAgICAgICAvLyBLZWVwIHRoZSBlbnZlbG9wZSdzIGN1cnNvciBib29ra2VlcGluZyBpbnRhY3QgYWNyb3NzIHB1bGwtc2lkZVxuICAgICAgICAvLyBwZXJzaXN0cyAoYXBwbHlQdWxsIHJld3JpdGVzIHRoZSB3aG9sZSBzdGF0ZSBmaWxlKS5cbiAgICAgICAgcGVyc2lzdGVkU3RhdGU6IHRoaXMucGVyc2lzdGVkU3RhdGUoKSxcbiAgICAgICAgLi4uKHByb2dyZXNzICE9PSB1bmRlZmluZWQgPyB7IG9uUHJvZ3Jlc3M6IHByb2dyZXNzLm9uUHJvZ3Jlc3MgfSA6IHt9KSxcbiAgICAgIH0sXG4gICAgKTtcbiAgfVxuXG4gIC8qKiBUaGUgZW52ZWxvcGUgYm9va2tlZXBpbmcgd3JpdHRlbiB3aGVuZXZlciB0aGUgY2xpZW50IHBlcnNpc3RzIHRoZSBpbmRleC4gKi9cbiAgcHJpdmF0ZSBwZXJzaXN0ZWRTdGF0ZSgpOiBQZXJzaXN0ZWRTeW5jU3RhdGUge1xuICAgIHJldHVybiB7XG4gICAgICBjdXJzb3I6IHRoaXMuY3Vyc29yLFxuICAgICAgc3luY2VkVGhyb3VnaDogdGhpcy5zeW5jZWRUaHJvdWdoLFxuICAgICAgbmVlZHNGdWxsTWFuaWZlc3Q6IHRoaXMubmVlZHNGdWxsTWFuaWZlc3QsXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmQgb25lIGJ1bGstcGhhc2Ugc3RlcCBvbiBgc3RhdHVzKCkucHJvZ3Jlc3NgLiBDb2FsZXNjZWQgdG8gYXQgbW9zdFxuICAgKiBvbmUgdXBkYXRlIHBlciBgcHJvZ3Jlc3NUaHJvdHRsZU1zYCAocmVuZGVyZXIgY2h1cm4pLCBFWENFUFQgcGhhc2VcbiAgICogY2hhbmdlcyBhbmQgY29tcGxldGlvbnMsIHdoaWNoIGFsd2F5cyBlbWl0IHNvIGEgcGhhc2UgaXMgbmV2ZXIgbWlzc2VkXG4gICAqIGFuZCBgZG9uZS90b3RhbGAgYWx3YXlzIGxhbmRzIG9uIGl0cyBmaW5hbCB2YWx1ZS5cbiAgICovXG4gIHByaXZhdGUgZW1pdFByb2dyZXNzKHBoYXNlOiBTeW5jUGhhc2UsIGRvbmU6IG51bWJlciwgdG90YWw6IG51bWJlcik6IHZvaWQge1xuICAgIGlmICh0b3RhbCA9PT0gMCkgcmV0dXJuOyAvLyBub3RoaW5nIHRvIHNob3cgZm9yIGFuIGVtcHR5IHBoYXNlXG4gICAgY29uc3Qgbm93ID0gdGhpcy5ub3coKTtcbiAgICBjb25zdCBjb21wbGV0ZSA9IGRvbmUgPj0gdG90YWw7XG4gICAgY29uc3QgcGhhc2VDaGFuZ2VkID0gdGhpcy5wcm9ncmVzcz8ucGhhc2UgIT09IHBoYXNlO1xuICAgIGlmICghY29tcGxldGUgJiYgIXBoYXNlQ2hhbmdlZCAmJiBub3cgLSB0aGlzLmxhc3RQcm9ncmVzc0F0IDwgdGhpcy5wcm9ncmVzc1Rocm90dGxlTXMpIHJldHVybjtcbiAgICB0aGlzLmxhc3RQcm9ncmVzc0F0ID0gbm93O1xuICAgIHRoaXMucHJvZ3Jlc3MgPSB7IHBoYXNlLCBkb25lLCB0b3RhbCB9O1xuICB9XG5cbiAgLy8gLS0tIHdhdGNoZXIgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgcHJpdmF0ZSBvbldhdGNoRXZlbnRzKGV2ZW50czogUmVhZG9ubHlBcnJheTx7IHBhdGg6IHN0cmluZyB9Pik6IHZvaWQge1xuICAgIGNvbnN0IHJlbGV2YW50ID0gZXZlbnRzLmZpbHRlcigoZXZlbnQpID0+ICFpc0lnbm9yZWQoZXZlbnQucGF0aCwgdGhpcy5pZ25vcmVTZXR0aW5ncykpO1xuICAgIGlmIChyZWxldmFudC5sZW5ndGggPT09IDApIHJldHVybjtcbiAgICB0aGlzLnBlbmRpbmcgKz0gcmVsZXZhbnQubGVuZ3RoO1xuICAgIHRoaXMuc2NoZWR1bGVSZWNvbmNpbGUoKTtcbiAgfVxuXG4gIC8qKiBEZWJvdW5jZWQgc2Nhblx1MjE5MnBsYW5cdTIxOTJleGVjdXRlIChzaGFyZWQgYnkgd2F0Y2hlciBhbmQgZGVmZXJyZWQgY2hhbmdlcykuICovXG4gIHByaXZhdGUgc2NoZWR1bGVSZWNvbmNpbGUoKTogdm9pZCB7XG4gICAgdGhpcy5jYW5jZWxEZWJvdW5jZT8uKCk7XG4gICAgdGhpcy5jYW5jZWxEZWJvdW5jZSA9IHRoaXMuc2NoZWR1bGUoKCkgPT4ge1xuICAgICAgdGhpcy5jYW5jZWxEZWJvdW5jZSA9IG51bGw7XG4gICAgICB0aGlzLmVucXVldWUoKCkgPT4gdGhpcy5ydW5DeWNsZSgpKS5jYXRjaCgoZXJyb3I6IHVua25vd24pID0+XG4gICAgICAgIHRoaXMubG9nLndhcm4oJ2RlYm91bmNlZCBzeW5jIGN5Y2xlIGZhaWxlZCcsIGVycm9yKSxcbiAgICAgICk7XG4gICAgfSwgdGhpcy5kZWJvdW5jZU1zKTtcbiAgfVxuXG4gIC8vIC0tLSB0aGUgc3luYyBjeWNsZSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuQ3ljbGUoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKHRoaXMudHJhbnNwb3J0ID09PSBudWxsIHx8IHRoaXMuaXNEaXNjb25uZWN0ZWQoKSkgcmV0dXJuO1xuICAgIHRoaXMuc3RhdGUgPSAnc3luY2luZyc7XG4gICAgdGhpcy5wcm9ncmVzcyA9IG51bGw7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IG1hbmlmZXN0ID0gYXdhaXQgdGhpcy5mZXRjaE1hbmlmZXN0KCk7XG4gICAgICBjb25zdCBsb2NhbENoYW5nZXMgPSBhd2FpdCBzY2FuVmF1bHQoXG4gICAgICAgIHRoaXMub3B0aW9ucy5zdG9yYWdlLFxuICAgICAgICB0aGlzLmluZGV4LFxuICAgICAgICB0aGlzLmlnbm9yZVNldHRpbmdzLFxuICAgICAgICB0aGlzLm5vdygpLFxuICAgICAgICB7IG9uUHJvZ3Jlc3M6IChkb25lLCB0b3RhbCkgPT4gdGhpcy5lbWl0UHJvZ3Jlc3MoJ3NjYW5uaW5nJywgZG9uZSwgdG90YWwpIH0sXG4gICAgICApO1xuICAgICAgY29uc3QgcGxhbiA9IGNvbXB1dGVTeW5jUGxhbih7XG4gICAgICAgIGxvY2FsQ2hhbmdlcyxcbiAgICAgICAgaW5kZXg6IHRoaXMuaW5kZXgsXG4gICAgICAgIG1hbmlmZXN0LFxuICAgICAgICB0aGlzRGV2aWNlSWQ6IHRoaXMub3B0aW9ucy5kZXZpY2VJZCxcbiAgICAgICAgdGhpc0RldmljZU5hbWU6IHRoaXMub3B0aW9ucy5kZXZpY2VOYW1lLFxuICAgICAgICBub3c6IHRoaXMubm93KCksXG4gICAgICB9KTtcbiAgICAgIHRoaXMuY29uZmxpY3RzID0gWy4uLnRoaXMuY29uZmxpY3RzLCAuLi5wbGFuLmNvbmZsaWN0c107XG5cbiAgICAgIC8vIFN0YWdlIHB1c2ggY29udGVudHMgQkVGT1JFIHB1bGxzIG92ZXJ3cml0ZSB0aGUgd29ya2luZyB0cmVlIChhXG4gICAgICAvLyBjb25mbGljdC1jb3B5IHB1c2ggcmVhZHMgdGhlIGxvc2VyIGNvbnRlbnQgZnJvbSB0aGUgb3JpZ2luYWwgcGF0aCkuXG4gICAgICBjb25zdCBzdGFnZWQgPSBhd2FpdCB0aGlzLnN0YWdlUHVzaGVzKHBsYW4sIGxvY2FsQ2hhbmdlcy5oYXNoZWQpO1xuXG4gICAgICB0aGlzLmluZGV4ID0gYXdhaXQgdGhpcy5hcHBseVB1bGxzKHBsYW4ucHVsbHMsIHtcbiAgICAgICAgb25Qcm9ncmVzczogKGRvbmUsIHRvdGFsKSA9PiB0aGlzLmVtaXRQcm9ncmVzcygncHVsbGluZycsIGRvbmUsIHRvdGFsKSxcbiAgICAgIH0pO1xuXG4gICAgICAvLyBQdXNoIHBpcGVsaW5lOiB1cCB0byBgcHVzaENvbmN1cnJlbmN5YCBjb21taXRzIGluIGZsaWdodDsgYWNrcyBmb2xkXG4gICAgICAvLyBpbnRvIHRoZSBpbmRleCBhcyB0aGV5IGFycml2ZSAoc2VyaWFsaXplZCB0aHJvdWdoIGBhY2tDaGFpbmApLlxuICAgICAgLy8gQmxvYiB1cGxvYWRzIGZvciA+MjU2S0IgZmlsZXMgc3RhcnQgaW5zaWRlIHRoZWlyIHNsb3QgYW5kIG92ZXJsYXBcbiAgICAgIC8vIHdpdGggdGhlIE9USEVSIHNsb3RzJyBpbi1mbGlnaHQgY29tbWl0cyBpbnN0ZWFkIG9mIHNlcmlhbGl6aW5nLlxuICAgICAgY29uc3QgcHVzaFRvdGFsID0gc3RhZ2VkLmxlbmd0aCArIHBsYW4uZm9sZGVyUHVzaGVzLmxlbmd0aDtcbiAgICAgIGxldCBwdXNoRG9uZSA9IDA7XG4gICAgICBjb25zdCBzZXR0bGVQdXNoID0gKCk6IHZvaWQgPT4ge1xuICAgICAgICBwdXNoRG9uZSArPSAxO1xuICAgICAgICB0aGlzLmVtaXRQcm9ncmVzcygncHVzaGluZycsIHB1c2hEb25lLCBwdXNoVG90YWwpO1xuICAgICAgfTtcbiAgICAgIHRoaXMuZW1pdFByb2dyZXNzKCdwdXNoaW5nJywgMCwgcHVzaFRvdGFsKTtcbiAgICAgIGF3YWl0IHRoaXMucnVuUHVzaFBpcGVsaW5lKHN0YWdlZCwgc2V0dGxlUHVzaCk7XG5cbiAgICAgIC8vIFBydW5lLW9uLWRlbGV0ZSAoQyksIGxvY2FsIHNpZGU6IGV2ZXJ5IGRlbGV0aW9uIHRoYXQgYWN0dWFsbHlcbiAgICAgIC8vIGNvbW1pdHRlZCB0aGlzIGN5Y2xlICh0aGUgaW5kZXggbm93IHRvbWJzdG9uZXMgaXQgLyBtaWdyYXRlZCBpdCBhd2F5KVxuICAgICAgLy8gbWF5IGhhdmUgZW1wdGllZCBpdHMgcGFyZW50IGRpcmVjdG9yeS4gUmVtb3ZlIHN1Y2ggZGlyZWN0b3JpZXMgXHUyMDE0XG4gICAgICAvLyBCRUZPUkUgdGhlIHBsYWNlaG9sZGVyIHB1c2hlcyBiZWxvdywgc28gYW4gZW1wdGllZCBkaXJlY3RvcnkgaXMgbm90XG4gICAgICAvLyBpbW1lZGlhdGVseSByZS1wdXNoZWQgYXMgYW4gZW1wdHktZm9sZGVyIHBsYWNlaG9sZGVyLlxuICAgICAgY29uc3QgZW1wdGllZERpcnMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgICAgIGZvciAoY29uc3QgY29tbWl0IG9mIHN0YWdlZCkge1xuICAgICAgICAvLyBUaGUgcGF0aCB0aGF0IGNlYXNlZCB0byBleGlzdCwgSUYgaXRzIGNvbW1pdCBhY3R1YWxseSBsYW5kZWRcbiAgICAgICAgLy8gKHRvbWJzdG9uZWQgaW4gdGhlIGluZGV4IGZvciBkZWxldGVzOyBtaWdyYXRlZCBhd2F5IGZvciByZW5hbWVzIFx1MjAxNFxuICAgICAgICAvLyBhIGRlbGV0ZSB0aGF0IGxvc3QgaXRzIHJhY2UgdG8gYSByZW1vdGUgZWRpdCBpcyBub3QgYSBkZWxldGlvbikuXG4gICAgICAgIGxldCBjZWFzZWRQYXRoOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG4gICAgICAgIGlmIChjb21taXQua2luZCA9PT0gJ2RlbGV0ZScgJiYgY29tbWl0LmlzRm9sZGVyICE9PSB0cnVlKSB7XG4gICAgICAgICAgaWYgKHRoaXMuaW5kZXhbY29tbWl0LnBhdGhdPy5kZWxldGVkQXQgIT09IHVuZGVmaW5lZCkgY2Vhc2VkUGF0aCA9IGNvbW1pdC5wYXRoO1xuICAgICAgICB9IGVsc2UgaWYgKGNvbW1pdC5raW5kID09PSAncmVuYW1lJyAmJiBjb21taXQuZnJvbVBhdGggIT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIGlmICghKGNvbW1pdC5mcm9tUGF0aCBpbiB0aGlzLmluZGV4KSkgY2Vhc2VkUGF0aCA9IGNvbW1pdC5mcm9tUGF0aDtcbiAgICAgICAgfVxuICAgICAgICBpZiAoY2Vhc2VkUGF0aCA9PT0gdW5kZWZpbmVkKSBjb250aW51ZTtcbiAgICAgICAgY29uc3QgcHJ1bmVkID0gYXdhaXQgcHJ1bmVQYXJlbnRPbkRlbGV0ZSh0aGlzLm9wdGlvbnMuc3RvcmFnZSwgdGhpcy5pbmRleCwgY2Vhc2VkUGF0aCk7XG4gICAgICAgIGlmIChwcnVuZWQgPT09IHVuZGVmaW5lZCkgY29udGludWU7XG4gICAgICAgIGVtcHRpZWREaXJzLmFkZChwcnVuZWQuZGlyKTtcbiAgICAgICAgY29uc3QgcGxhY2Vob2xkZXIgPSB0aGlzLmluZGV4W3BydW5lZC5kaXJdO1xuICAgICAgICBpZiAocGxhY2Vob2xkZXI/LmlzRm9sZGVyICYmIHBsYWNlaG9sZGVyLmRlbGV0ZWRBdCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgLy8gV2UganVzdCByZW1vdmVkIHRoZSBkaXJlY3RvcnkgYSBsaXZlIHBsYWNlaG9sZGVyIHN0aWxsIGNsYWltczpcbiAgICAgICAgICAvLyBzY2FuIGFnYWluIHNvIHRoZSBwbGFjZWhvbGRlciBpcyB0b21ic3RvbmVkIGFuZCBwcm9wYWdhdGVzLlxuICAgICAgICAgIHRoaXMuc2NoZWR1bGVSZWNvbmNpbGUoKTtcbiAgICAgICAgfVxuICAgICAgfVxuXG4gICAgICBjb25zdCBmb2xkZXJDb21taXRzOiBTdGFnZWRDb21taXRbXSA9IFtdO1xuICAgICAgZm9yIChjb25zdCBwYXRoIG9mIHBsYW4uZm9sZGVyUHVzaGVzKSB7XG4gICAgICAgIC8vIE5ldmVyIHJlc3VycmVjdCBhIGRpcmVjdG9yeSB0aGlzIGN5Y2xlIGVtcHRpZWQgKGRlbGV0ZS1kZXJpdmVkXG4gICAgICAgIC8vIHBsYWNlaG9sZGVycyBhcmUgc3VwcHJlc3NlZCBldmVuIHdoZW4gcmVtb3ZhbCBpdHNlbGYgd2FzIG5vdFxuICAgICAgICAvLyBwb3NzaWJsZSksIG5vciBwdXNoIG9uZSB0aGF0IHZhbmlzaGVkIHNpbmNlIHRoZSBzY2FuLlxuICAgICAgICBpZiAoZW1wdGllZERpcnMuaGFzKHBhdGgpKSBjb250aW51ZTtcbiAgICAgICAgaWYgKCEoYXdhaXQgdGhpcy5zdG9yYWdlRXhpc3RzKHBhdGgpKSkgY29udGludWU7XG4gICAgICAgIGZvbGRlckNvbW1pdHMucHVzaCh7XG4gICAgICAgICAga2luZDogJ2VkaXQnLFxuICAgICAgICAgIHBhdGgsXG4gICAgICAgICAgcGFyZW50VmVyc2lvbjogdGhpcy5pbmRleFtwYXRoXT8udmVyc2lvbklkID8/IG51bGwsXG4gICAgICAgICAgaGFzaDogJycsXG4gICAgICAgICAgc2l6ZTogMCxcbiAgICAgICAgICBpc0ZvbGRlcjogdHJ1ZSxcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICBhd2FpdCB0aGlzLnJ1blB1c2hQaXBlbGluZShmb2xkZXJDb21taXRzLCBzZXR0bGVQdXNoKTtcblxuICAgICAgLy8gQ2FjaGUgdGhlIHNjYW4ncyBoYXNoIG9ic2VydmF0aW9ucyAobXRpbWUpIG9udG8gZW50cmllcyB3aG9zZSBoYXNoXG4gICAgICAvLyBzdGlsbCBtYXRjaGVzLCBzbyB0aGUgbmV4dCBmYXN0IHNjYW4gY2FuIHNraXAgdGhvc2UgZmlsZXMuIFJ1bnNcbiAgICAgIC8vIGFmdGVyIHB1bGxzL3B1c2hlcyBzbyBmcmVzaGx5LWFja2VkIGVudHJpZXMgYmVuZWZpdCBpbW1lZGlhdGVseTtcbiAgICAgIC8vIGByZWNvcmRIYXNoZWRGaWxlc2Agc2tpcHMgYW55dGhpbmcgdGhlIGN5Y2xlIGNoYW5nZWQgdW5kZXJuZWF0aCB1cy5cbiAgICAgIHRoaXMuaW5kZXggPSByZWNvcmRIYXNoZWRGaWxlcyh0aGlzLmluZGV4LCBsb2NhbENoYW5nZXMuaGFzaGVkKTtcblxuICAgICAgLy8gVGhlIGN5Y2xlIGZpbmlzaGVkIGNsZWFuOiBldmVyeSBwdWxsIG9mIHRoZSBtYW5pZmVzdCBhcHBsaWVkLCBldmVyeVxuICAgICAgLy8gc3RhZ2VkIGNvbW1pdCBhY2tlZC4gVGhlIGluZGV4IGlzIG5vdyBjb21wbGV0ZSB0aHJvdWdoIHRoZSBNQU5JRkVTVCdzXG4gICAgICAvLyBmZXRjaC10aW1lIGN1cnNvciAoZGVsaWJlcmF0ZWx5IG5vdCB0aGUgbGF0ZXIgYWNrIHNlcXMgXHUyMDE0IGEgY29uY3VycmVudFxuICAgICAgLy8gZGV2aWNlJ3MgY2hhbmdlIGNhbiBpbnRlcmxlYXZlIGFuZCByaWRlIHRoZSBwb3N0LWN5Y2xlIGRpc3BhdGNoXG4gICAgICAvLyBxdWV1ZSksIHdoaWNoIGlzIHdoYXQgbWFrZXMgdGhlIG5leHQgZGVsdGEgbWFuaWZlc3Qgc2FmZS5cbiAgICAgIGlmICh0aGlzLm1hbmlmZXN0Q3Vyc29yT2ZDeWNsZSAhPT0gbnVsbCAmJiB0aGlzLm1hbmlmZXN0Q3Vyc29yT2ZDeWNsZSA+ICh0aGlzLnN5bmNlZFRocm91Z2ggPz8gMCkpIHtcbiAgICAgICAgdGhpcy5zeW5jZWRUaHJvdWdoID0gdGhpcy5tYW5pZmVzdEN1cnNvck9mQ3ljbGU7XG4gICAgICB9XG4gICAgICB0aGlzLm1hbmlmZXN0Q3Vyc29yT2ZDeWNsZSA9IG51bGw7XG4gICAgICB0aGlzLm5lZWRzRnVsbE1hbmlmZXN0ID0gZmFsc2U7XG5cbiAgICAgIHRoaXMubGFzdFN5bmNBdCA9IHRoaXMubm93KCk7XG4gICAgICB0aGlzLnBlbmRpbmcgPSAwO1xuICAgICAgaWYgKCF0aGlzLmlzRGlzY29ubmVjdGVkKCkpIHRoaXMuc3RhdGUgPSAnbGl2ZSc7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMubWFuaWZlc3RDdXJzb3JPZkN5Y2xlID0gbnVsbDtcbiAgICAgIHRoaXMubG9nLmVycm9yKCdzeW5jIGN5Y2xlIGZhaWxlZCcsIGVycm9yKTtcbiAgICAgIGlmICghdGhpcy5pc0Rpc2Nvbm5lY3RlZCgpKSB0aGlzLnN0YXRlID0gdGhpcy50cmFuc3BvcnQgIT09IG51bGwgPyAnbGl2ZScgOiAnaWRsZSc7XG4gICAgICB0aHJvdyBlcnJvcjtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgdGhpcy5wcm9ncmVzcyA9IG51bGw7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFRoZSBtYW5pZmVzdCdzIGZldGNoLXRpbWUgY3Vyc29yIGZvciB0aGUgUlVOTklORyBjeWNsZSBcdTIwMTQgdGhlIGNvbXBsZXRpb25cbiAgICogd2F0ZXJtYXJrIGEgc3VjY2Vzc2Z1bCBjeWNsZSByZWNvcmRzIGludG8gYHN5bmNlZFRocm91Z2hgIChzZWUgdGhlXG4gICAqIGNvbW1lbnQgdGhlcmUpLiBOdWxsIG91dHNpZGUgY3ljbGVzLlxuICAgKi9cbiAgcHJpdmF0ZSBtYW5pZmVzdEN1cnNvck9mQ3ljbGU6IG51bWJlciB8IG51bGwgPSBudWxsO1xuXG4gIC8qKlxuICAgKiBXaGV0aGVyIFRISVMgY3ljbGUgbWF5IHJlcXVlc3QgYSBkZWx0YSBtYW5pZmVzdC4gQWxsIGZvdXIgZ2F0ZXMgbXVzdFxuICAgKiBob2xkIChhbnkgZmFpbHVyZSBcdTIxRDIgZnVsbCBtYW5pZmVzdCwgdG9kYXkncyBiZWhhdmlvcik6XG4gICAqXG4gICAqICAxLiBgY3Vyc29yID4gMGAgXHUyMDE0IGEgZmlyc3QtZXZlciBjb25uZWN0IGtub3dzIG5vdGhpbmc7IGZ1bGwgbWFuaWZlc3QuXG4gICAqICAyLiBgc3luY2VkVGhyb3VnaCAhPT0gbnVsbGAgXHUyMDE0IHNvbWUgZnVsbC1tYW5pZmVzdCBjeWNsZSBjb21wbGV0ZWQsIHNvIHRoZVxuICAgKiAgICAgaW5kZXggaXMgQ09NUExFVEUgdGhyb3VnaCBpdDsgaGVhZHMgYWZ0ZXIgaXQgYXJyaXZlIHZpYSByZXBsYXkgK1xuICAgKiAgICAgZGVsdGEuIEFuIGludGVycnVwdGVkIGluaXRpYWwgc3luYyBuZXZlciBzZXRzIGl0IFx1MjFEMiBmdWxsIG1hbmlmZXN0LlxuICAgKiAgMy4gYCFuZWVkc0Z1bGxNYW5pZmVzdGAgXHUyMDE0IG5vIGRlZmVycmVkIGRpdmVyZ2VuY2UgYXdhaXRzIHBsYW4gcmVzb2x1dGlvbi5cbiAgICogIDQuIFJlcGxheSB3aW5kb3cgaW50YWN0IFx1MjAxNCBoZWxsb0FjayByZXBvcnRlZCBgb2xkZXN0UmV0YWluZWRTZXEgPD1cbiAgICogICAgIGN1cnNvciArIDFgLCBzbyBldmVyeSBldmVudCBhZnRlciBvdXIgY3Vyc29yIGlzIHN0aWxsIG9uIHRoZSBzZXJ2ZXIuXG4gICAqL1xuICBwcml2YXRlIHNob3VsZFJlcXVlc3REZWx0YU1hbmlmZXN0KCk6IGJvb2xlYW4ge1xuICAgIHJldHVybiAoXG4gICAgICB0aGlzLmN1cnNvciA+IDAgJiZcbiAgICAgIHRoaXMuc3luY2VkVGhyb3VnaCAhPT0gbnVsbCAmJlxuICAgICAgIXRoaXMubmVlZHNGdWxsTWFuaWZlc3QgJiZcbiAgICAgIHRoaXMuc2VydmVyT2xkZXN0UmV0YWluZWRTZXEgIT09IG51bGwgJiZcbiAgICAgIHRoaXMuc2VydmVyT2xkZXN0UmV0YWluZWRTZXEgPD0gdGhpcy5jdXJzb3IgKyAxXG4gICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZmV0Y2hNYW5pZmVzdCgpOiBQcm9taXNlPFJlbW90ZUZpbGVbXT4ge1xuICAgIGNvbnN0IHRyYW5zcG9ydCA9IHRoaXMudHJhbnNwb3J0O1xuICAgIGlmICh0cmFuc3BvcnQgPT09IG51bGwpIHRocm93IG5ldyBOZXR3b3JrRXJyb3IoJ25vdCBjb25uZWN0ZWQnKTtcbiAgICBjb25zdCB1c2VEZWx0YSA9IHRoaXMuc2hvdWxkUmVxdWVzdERlbHRhTWFuaWZlc3QoKTtcbiAgICBjb25zdCBzaW5jZSA9IHVzZURlbHRhICYmIHRoaXMuc3luY2VkVGhyb3VnaCAhPT0gbnVsbCA/IHRoaXMuc3luY2VkVGhyb3VnaCA6IHVuZGVmaW5lZDtcbiAgICBjb25zdCByZXBseSA9IGF3YWl0IHRoaXMucmVxdWVzdDxNYW5pZmVzdE1lc3NhZ2UgfCBTZXJ2ZXJFcnJvck1lc3NhZ2U+KFxuICAgICAgKG0pID0+IG0udHlwZSA9PT0gJ21hbmlmZXN0JyB8fCBtLnR5cGUgPT09ICdlcnJvcicsXG4gICAgICAoKSA9PiB0cmFuc3BvcnQuc2VuZCh7IHR5cGU6ICdnZXRNYW5pZmVzdCcsIC4uLihzaW5jZSAhPT0gdW5kZWZpbmVkID8geyBzaW5jZSB9IDoge30pIH0pLFxuICAgICk7XG4gICAgaWYgKHJlcGx5LnR5cGUgPT09ICdlcnJvcicpIHRocm93IHRoaXMudG9FcnJvcihyZXBseSk7XG4gICAgaWYgKHJlcGx5LmN1cnNvciA+IHRoaXMuY3Vyc29yKSB0aGlzLmN1cnNvciA9IHJlcGx5LmN1cnNvcjtcbiAgICB0aGlzLm1hbmlmZXN0Q3Vyc29yT2ZDeWNsZSA9IHJlcGx5LmN1cnNvcjtcbiAgICBpZiAoIXVzZURlbHRhKSB7XG4gICAgICByZXR1cm4gT2JqZWN0LnZhbHVlcyhyZXBseS5lbnRyaWVzKS5tYXAoKGVudHJ5KSA9PiAoeyAuLi5lbnRyeSB9KSk7XG4gICAgfVxuICAgIC8vIERlbHRhOiBtZXJnZSB0aGUgY2hhbmdlZCBoZWFkcyBvdmVyIGFuIElOREVYIFBST0pFQ1RJT04gb2YgdGhlIGZ1bGxcbiAgICAvLyBtYW5pZmVzdC4gY29tcHV0ZVN5bmNQbGFuIG5lZWRzIHRoZSBjb21wbGV0ZSByZW1vdGUgdmlldyBcdTIwMTQgUGhhc2UgQlxuICAgIC8vIHRyZWF0cyBhbiBpbmRleCBwYXRoIGFic2VudCBmcm9tIHRoZSBtYW5pZmVzdCBhcyBcIm1pZ3JhdGVkIGF3YXlcIiBcdTIwMTQgYW5kXG4gICAgLy8gZWxpZ2liaWxpdHkgZ3VhcmFudGVlcyB0aGUgaW5kZXggYWxyZWFkeSBhZ3JlZXMgd2l0aCB0aGUgc2VydmVyIGZvclxuICAgIC8vIGV2ZXJ5IHBhdGggdGhlIGRlbHRhIG9taXRzIChoZWFkcyBcdTIyNjQgc3luY2VkVGhyb3VnaCkuIFByb2plY3RpbmcgZW50cmllc1xuICAgIC8vIHRvIHRoZWlyIGluZGV4IHN0YXRlIHRoZXJlZm9yZSByZWNvbnN0cnVjdHMgZXhhY3RseSB3aGF0IHRoZSBmdWxsXG4gICAgLy8gbWFuaWZlc3Qgd291bGQgaGF2ZSBzYWlkLCBhdCBPKGNoYW5nZXMpIGluc3RlYWQgb2YgTyh2YXVsdCkuXG4gICAgY29uc3QgbWVyZ2VkID0gbmV3IE1hcDxzdHJpbmcsIFJlbW90ZUZpbGU+KCk7XG4gICAgZm9yIChjb25zdCBbcGF0aCwgZW50cnldIG9mIE9iamVjdC5lbnRyaWVzKHRoaXMuaW5kZXgpKSB7XG4gICAgICBtZXJnZWQuc2V0KHBhdGgsIHtcbiAgICAgICAgcGF0aCxcbiAgICAgICAgdmVyc2lvbjogZW50cnkudmVyc2lvbklkLFxuICAgICAgICBoYXNoOiBlbnRyeS5oYXNoLFxuICAgICAgICBzaXplOiBlbnRyeS5zaXplLFxuICAgICAgICBkZWxldGVkOiBlbnRyeS5kZWxldGVkQXQgIT09IHVuZGVmaW5lZCxcbiAgICAgICAgY2xvY2s6IGVudHJ5LmNsb2NrLFxuICAgICAgICAuLi4oZW50cnkuaXNGb2xkZXIgPyB7IGlzRm9sZGVyOiB0cnVlIH0gOiB7fSksXG4gICAgICAgIG10aW1lOiBlbnRyeS5tdGltZSA/PyAwLFxuICAgICAgfSk7XG4gICAgfVxuICAgIGZvciAoY29uc3QgW3BhdGgsIGVudHJ5XSBvZiBPYmplY3QuZW50cmllcyhyZXBseS5lbnRyaWVzKSkge1xuICAgICAgbWVyZ2VkLnNldChwYXRoLCB7IC4uLmVudHJ5IH0pO1xuICAgIH1cbiAgICByZXR1cm4gWy4uLm1lcmdlZC52YWx1ZXMoKV07XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHN0YWdlUHVzaGVzKFxuICAgIHBsYW46IFN5bmNQbGFuLFxuICAgIGhhc2hlZDogcmVhZG9ubHkgSGFzaGVkRmlsZVtdLFxuICApOiBQcm9taXNlPFN0YWdlZENvbW1pdFtdPiB7XG4gICAgLy8gQSBjb25mbGljdC1jb3B5IHB1c2ggY2FycmllcyBjb250ZW50IHJlYWQgZnJvbSB0aGUgKm9yaWdpbmFsKiBwYXRoLlxuICAgIGNvbnN0IGNvcHlTb3VyY2VzID0gbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oKTtcbiAgICBmb3IgKGNvbnN0IGNvbmZsaWN0IG9mIHBsYW4uY29uZmxpY3RzKSB7XG4gICAgICBpZiAoY29uZmxpY3QuY29uZmxpY3RDb3B5UGF0aCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGNvcHlTb3VyY2VzLnNldChjb25mbGljdC5jb25mbGljdENvcHlQYXRoLCBjb25mbGljdC5wYXRoKTtcbiAgICAgIH1cbiAgICB9XG4gICAgLy8gSGFzaC10aW1lIHN0YXRzIGJ5IHBhdGg6IHBpbm5pbmcgdGhlc2Ugb250byB0aGUgYWNrZWQgZW50cmllcyAoYmVsb3cpXG4gICAgLy8ga2VlcHMgdGhlIGZhc3QtcGF0aCBjYWNoZSBob25lc3QgXHUyMDE0IHNlZSBgU3RhZ2VkQ29tbWl0Lm10aW1lYC5cbiAgICBjb25zdCBoYXNoVGltZU10aW1lID0gbmV3IE1hcChoYXNoZWQubWFwKChvYnNlcnZlZCkgPT4gW29ic2VydmVkLnBhdGgsIG9ic2VydmVkLm10aW1lXSkpO1xuXG4gICAgY29uc3Qgc3RhZ2VkOiBTdGFnZWRDb21taXRbXSA9IFtdO1xuICAgIGZvciAoY29uc3QgcHVzaCBvZiBwbGFuLnB1c2hlcykge1xuICAgICAgaWYgKHB1c2gua2luZCA9PT0gJ2RlbGV0ZScgfHwgcHVzaC5raW5kID09PSAncmVuYW1lJykge1xuICAgICAgICBzdGFnZWQucHVzaCh0aGlzLnRvU3RhZ2VkKHB1c2gpKTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjb25zdCBzb3VyY2VQYXRoID1cbiAgICAgICAgcHVzaC5raW5kID09PSAnY29uZmxpY3RDb3B5JyA/IGNvcHlTb3VyY2VzLmdldChwdXNoLnBhdGgpID8/IHB1c2gucGF0aCA6IHB1c2gucGF0aDtcbiAgICAgIGNvbnN0IGJ5dGVzID0gYXdhaXQgdGhpcy5yZWFkTG9jYWwoc291cmNlUGF0aCk7XG4gICAgICBpZiAoYnl0ZXMgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICB0aGlzLmxvZy53YXJuKCdwdXNoIHNvdXJjZSB2YW5pc2hlZCBzaW5jZSBzY2FuOyBkZWZlcnJpbmcnLCBwdXNoLnBhdGgpO1xuICAgICAgICB0aGlzLnNjaGVkdWxlUmVjb25jaWxlKCk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3QgaGFzaCA9IGF3YWl0IHNoYTI1NkhleChieXRlcyk7XG4gICAgICBpZiAoaGFzaCAhPT0gcHVzaC5oYXNoIHx8IGJ5dGVzLmJ5dGVMZW5ndGggIT09IHB1c2guc2l6ZSkge1xuICAgICAgICB0aGlzLmxvZy53YXJuKCdsb2NhbCBjb250ZW50IGRyaWZ0ZWQgc2luY2Ugc2NhbjsgZGVmZXJyaW5nIHB1c2gnLCBwdXNoLnBhdGgpO1xuICAgICAgICB0aGlzLnNjaGVkdWxlUmVjb25jaWxlKCk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKHB1c2gua2luZCA9PT0gJ2NvbmZsaWN0Q29weScpIHtcbiAgICAgICAgLy8gTWF0ZXJpYWxpemUgdGhlIGNvcHkgbG9jYWxseSBOT1csIGJlZm9yZSB0aGUgcHVsbHMgb3ZlcndyaXRlIHRoZVxuICAgICAgICAvLyBvcmlnaW5hbDogdGhlIHNlcnZlciBicm9hZGNhc3RzIHRoZSBjb3B5IHRvICpvdGhlciogY2xpZW50cyBvbmx5LFxuICAgICAgICAvLyBzbyB0aGlzIGRldmljZSBtdXN0IHdyaXRlIGl0cyBvd24gY29weSBpdHNlbGYuIFRoZSBjb3B5IGxhbmRzIGF0IGFcbiAgICAgICAgLy8gTkVXIHBhdGggd2hvc2Ugb24tZGlzayBzdGF0IGRpZmZlcnMgZnJvbSB0aGUgc291cmNlJ3MgXHUyMDE0IG5vIGhhc2gtdGltZVxuICAgICAgICAvLyBzdGF0IHRvIHBpbiwgdGhlIG5leHQgc2NhbiByZWNvcmRzIG9uZS5cbiAgICAgICAgYXdhaXQgdGhpcy5vcHRpb25zLnN0b3JhZ2Uud3JpdGVGaWxlKHB1c2gucGF0aCwgYnl0ZXMpO1xuICAgICAgICBzdGFnZWQucHVzaCh7IC4uLnRoaXMudG9TdGFnZWQocHVzaCksIGJ5dGVzIH0pO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIHN0YWdlZC5wdXNoKHtcbiAgICAgICAgLi4udGhpcy50b1N0YWdlZChwdXNoKSxcbiAgICAgICAgYnl0ZXMsXG4gICAgICAgIC4uLihoYXNoVGltZU10aW1lLmdldChzb3VyY2VQYXRoKSAhPT0gdW5kZWZpbmVkXG4gICAgICAgICAgPyB7IG10aW1lOiBoYXNoVGltZU10aW1lLmdldChzb3VyY2VQYXRoKSB9XG4gICAgICAgICAgOiB7fSksXG4gICAgICB9KTtcbiAgICB9XG4gICAgcmV0dXJuIHN0YWdlZDtcbiAgfVxuXG4gIHByaXZhdGUgdG9TdGFnZWQocHVzaDogUHVzaE9wKTogU3RhZ2VkQ29tbWl0IHtcbiAgICBpZiAocHVzaC5raW5kID09PSAncmVuYW1lJykge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAga2luZDogJ3JlbmFtZScsXG4gICAgICAgIHBhdGg6IHB1c2gudG9QYXRoLFxuICAgICAgICBwYXJlbnRWZXJzaW9uOiBwdXNoLnBhcmVudFZlcnNpb24sXG4gICAgICAgIGhhc2g6IHB1c2guaGFzaCxcbiAgICAgICAgc2l6ZTogcHVzaC5zaXplLFxuICAgICAgICBmcm9tUGF0aDogcHVzaC5mcm9tUGF0aCxcbiAgICAgIH07XG4gICAgfVxuICAgIHJldHVybiB7XG4gICAgICBraW5kOiBwdXNoLmtpbmQgPT09ICdhZGQnID8gJ2VkaXQnIDogcHVzaC5raW5kLFxuICAgICAgcGF0aDogcHVzaC5wYXRoLFxuICAgICAgcGFyZW50VmVyc2lvbjogcHVzaC5wYXJlbnRWZXJzaW9uLFxuICAgICAgaGFzaDogcHVzaC5oYXNoLFxuICAgICAgc2l6ZTogcHVzaC5zaXplLFxuICAgICAgLi4uKHB1c2guaXNGb2xkZXIgPyB7IGlzRm9sZGVyOiB0cnVlIH0gOiB7fSksXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVhZExvY2FsKHBhdGg6IHN0cmluZyk6IFByb21pc2U8VWludDhBcnJheSB8IHVuZGVmaW5lZD4ge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5vcHRpb25zLnN0b3JhZ2UucmVhZEZpbGUocGF0aCk7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBTZW5kIGBjb21taXRzYCB0aHJvdWdoIGEgYm91bmRlZC1jb25jdXJyZW5jeSBwaXBlbGluZTogdXAgdG9cbiAgICogYHB1c2hDb25jdXJyZW5jeWAgY29tbWl0cyBpbiBmbGlnaHQgKHNlbnQsIGF3YWl0aW5nIHRoZWlyIHNlcnZlciByZXBseSlcbiAgICogYXQgb25jZTsgZWFjaCBzbG90IHNlbmRzIGl0cyBuZXh0IGNvbW1pdCBhcyBzb29uIGFzIGFuIGVhcmxpZXIgb25lIGlzXG4gICAqIHNldHRsZWQuXG4gICAqXG4gICAqIFdIWSBQSVBFTElOSU5HIElTIFNBRkUgKHZzLiBhIGJhdGNoIG1lc3NhZ2UpOiBjb25mbGljdCBhcmJpdHJhdGlvbiBpc1xuICAgKiBTRVJWRVItc2lkZSBhbmQgUEVSIFBBVEggKGBhcmJpdHJhdGVDb21taXRgIHJlYWRzIGFuZCB3cml0ZXMgZXhhY3RseSB0aGVcbiAgICogY29tbWl0dGVkIHBhdGgncyBoZWFkKSwgYW5kIGEgY3ljbGUgc3RhZ2VzIGF0IG1vc3QgT05FIGNvbW1pdCBwZXIgcGF0aFxuICAgKiAodGhlIHNjYW4gYnVja2V0cyBieSBwYXRoOyByZW5hbWVzIGNvbnN1bWUgYm90aCBlbmRzKS4gU28gdHdvIGluLWZsaWdodFxuICAgKiBjb21taXRzIGNhbiBuZXZlciBpbnRlcmFjdCBvbiB0aGUgc2VydmVyLCBhbmQgcmVwbHkgT1JERVIgYWNyb3NzXG4gICAqIGRpZmZlcmVudCBwYXRocyBkb2VzIG5vdCBtYXR0ZXIgZm9yIHRoZSByZXN1bHRpbmcgc3RhdGUgXHUyMDE0IG9ubHkgcGVyLXBhdGhcbiAgICogcGFpcmluZyBvZiByZXBseVx1MjE5MmNvbW1pdCBtYXR0ZXJzLCB3aGljaCB0aGUgb3JkZXJlZCBXZWJTb2NrZXQgcGx1cyB0aGVcbiAgICogc2VydmVyJ3Mgc2VyaWFsaXplZCBhcmJpdHJhdGlvbiBndWFyYW50ZWUgKHJlcGxpZXMgYXJyaXZlIGluIHNlbmQgb3JkZXIsXG4gICAqIG1hdGNoZWQgRklGTyBieSBgb25UcmFuc3BvcnRNZXNzYWdlYCkuIEEgYmF0Y2ggcHJvdG9jb2wgbWVzc2FnZSB3b3VsZFxuICAgKiBhZGRpdGlvbmFsbHkgY291cGxlIGJsb2ItdXBsb2FkIHRpbWluZyBhbmQgZXJyb3IgZ3JhbnVsYXJpdHkgZm9yIG5vXG4gICAqIGNvcnJlY3RuZXNzIGdhaW4sIHNvIHByb3RvY29sIHYxIHN0YXlzIHVuY2hhbmdlZC5cbiAgICpcbiAgICogT24gdGhlIGZpcnN0IGZhaWx1cmUsIGluLWZsaWdodCBjb21taXRzIHN0aWxsIHNldHRsZSAodGhlaXIgYWNrcyBhcmVcbiAgICogYXBwbGllZCBcdTIwMTQgdGhleSBhcmUgcmVhbCBoZWFkcykgYnV0IG5vIE5FVyBjb21taXQgc3RhcnRzOyB0aGUgZXJyb3IgaXNcbiAgICogcmV0aHJvd24gYWZ0ZXIgYWxsIHNsb3RzIGRyYWluIHNvIHRoZSBjeWNsZSBmYWlscyBleGFjdGx5IGxpa2UgdGhlIG9sZFxuICAgKiBzZXF1ZW50aWFsIGxvb3AgZGlkICh1bnNlbnQgcHVzaGVzIHNpbXBseSByZXRyeSBuZXh0IGN5Y2xlKS5cbiAgICovXG4gIHByaXZhdGUgYXN5bmMgcnVuUHVzaFBpcGVsaW5lKFxuICAgIGNvbW1pdHM6IHJlYWRvbmx5IFN0YWdlZENvbW1pdFtdLFxuICAgIG9uU2V0dGxlZDogKCkgPT4gdm9pZCxcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKGNvbW1pdHMubGVuZ3RoID09PSAwKSByZXR1cm47XG4gICAgbGV0IG5leHQgPSAwO1xuICAgIGxldCBmYWlsdXJlOiBFcnJvciB8IG51bGwgPSBudWxsO1xuICAgIGNvbnN0IHNsb3RzID0gTWF0aC5taW4odGhpcy5wdXNoQ29uY3VycmVuY3ksIGNvbW1pdHMubGVuZ3RoKTtcbiAgICBjb25zdCB3b3JrZXIgPSBhc3luYyAoKTogUHJvbWlzZTx2b2lkPiA9PiB7XG4gICAgICB3aGlsZSAobmV4dCA8IGNvbW1pdHMubGVuZ3RoKSB7XG4gICAgICAgIGlmIChmYWlsdXJlICE9PSBudWxsKSByZXR1cm47XG4gICAgICAgIGNvbnN0IGNvbW1pdCA9IGNvbW1pdHNbbmV4dCsrXSE7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5zZW5kQ29tbWl0KGNvbW1pdCk7XG4gICAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgICAgZmFpbHVyZSA/Pz0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IEVycm9yKFN0cmluZyhlcnJvcikpO1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICBvblNldHRsZWQoKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH07XG4gICAgYXdhaXQgUHJvbWlzZS5hbGwoQXJyYXkuZnJvbSh7IGxlbmd0aDogc2xvdHMgfSwgd29ya2VyKSk7XG4gICAgaWYgKGZhaWx1cmUgIT09IG51bGwpIHRocm93IGZhaWx1cmU7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHNlbmRDb21taXQoY29tbWl0OiBTdGFnZWRDb21taXQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCB0cmFuc3BvcnQgPSB0aGlzLnRyYW5zcG9ydDtcbiAgICBpZiAodHJhbnNwb3J0ID09PSBudWxsKSB0aHJvdyBuZXcgTmV0d29ya0Vycm9yKCdub3QgY29ubmVjdGVkJyk7XG5cbiAgICBjb25zdCBtZXNzYWdlOiBDb21taXRNZXNzYWdlID0ge1xuICAgICAgdHlwZTogJ2NvbW1pdCcsXG4gICAgICBwYXRoOiBjb21taXQucGF0aCxcbiAgICAgIHBhcmVudFZlcnNpb246IGNvbW1pdC5wYXJlbnRWZXJzaW9uLFxuICAgICAgaGFzaDogY29tbWl0Lmhhc2gsXG4gICAgICBzaXplOiBjb21taXQuc2l6ZSxcbiAgICAgIGtpbmQ6IGNvbW1pdC5raW5kLFxuICAgICAgLi4uKGNvbW1pdC5mcm9tUGF0aCAhPT0gdW5kZWZpbmVkID8geyBmcm9tUGF0aDogY29tbWl0LmZyb21QYXRoIH0gOiB7fSksXG4gICAgICAuLi4oY29tbWl0LmlzRm9sZGVyID09PSB0cnVlID8geyBpc0ZvbGRlcjogdHJ1ZSB9IDoge30pLFxuICAgICAgLi4uKGNvbW1pdC5ieXRlcyAhPT0gdW5kZWZpbmVkICYmIGNvbW1pdC5ieXRlcy5ieXRlTGVuZ3RoIDw9IElOTElORV9DT05URU5UX01BWF9CWVRFU1xuICAgICAgICA/IHsgaW5saW5lOiBieXRlc1RvQmFzZTY0KGNvbW1pdC5ieXRlcykgfVxuICAgICAgICA6IHt9KSxcbiAgICB9O1xuXG4gICAgLy8gQXR0YWNobWVudHMgYWJvdmUgdGhlIGlubGluZSBjYXAgcmlkZSB0aGUgYmxvYiBzdG9yZSAoRlItOCkuIEluc2lkZSBhXG4gICAgLy8gcGlwZWxpbmUgc2xvdCB0aGlzIGF3YWl0IG92ZXJsYXBzIHdpdGggdGhlIE9USEVSIHNsb3RzJyBpbi1mbGlnaHRcbiAgICAvLyBjb21taXRzIFx1MjAxNCB0aGUgdXBsb2FkIG5vIGxvbmdlciBzZXJpYWxpemVzIGFoZWFkIG9mIGV2ZXJ5IGNvbW1pdCBcdTIwMTQgYW5kXG4gICAgLy8gc3RpbGwgY29tcGxldGVzIGJlZm9yZSBJVFMgY29tbWl0IGlzIHNlbnQgKHRoZSBzZXJ2ZXIgcmVqZWN0cyBhIGNvbW1pdFxuICAgIC8vIHdob3NlIGJsb2IgaGFzIG5vdCBhcnJpdmVkKS5cbiAgICBpZiAoY29tbWl0LmJ5dGVzICE9PSB1bmRlZmluZWQgJiYgY29tbWl0LmJ5dGVzLmJ5dGVMZW5ndGggPiBJTkxJTkVfQ09OVEVOVF9NQVhfQllURVMpIHtcbiAgICAgIGF3YWl0IHRoaXMudXBsb2FkQmxvYihjb21taXQuaGFzaCwgY29tbWl0LmJ5dGVzKTtcbiAgICB9XG5cbiAgICBjb25zdCByZXBseSA9IGF3YWl0IHRoaXMucmVxdWVzdDxDb21taXRBY2tNZXNzYWdlIHwgQ29uZmxpY3RNZXNzYWdlIHwgU2VydmVyRXJyb3JNZXNzYWdlPihcbiAgICAgIChtKSA9PiBtLnR5cGUgPT09ICdjb21taXRBY2snIHx8IG0udHlwZSA9PT0gJ2NvbmZsaWN0JyB8fCBtLnR5cGUgPT09ICdlcnJvcicsXG4gICAgICAoKSA9PiB0cmFuc3BvcnQuc2VuZChtZXNzYWdlKSxcbiAgICApO1xuICAgIGlmIChyZXBseS50eXBlID09PSAnZXJyb3InKSB0aHJvdyB0aGlzLnRvRXJyb3IocmVwbHkpO1xuXG4gICAgLy8gRm9sZCB0aGUgcmVwbHkgaW50byBzaGFyZWQgc3RhdGUgYmVoaW5kIHRoZSBhY2sgY2hhaW46IGNvbmN1cnJlbnRcbiAgICAvLyBzbG90cyBtdXN0IG5vdCByZWFkLW1vZGlmeS13cml0ZSBgdGhpcy5pbmRleGAgYXQgdGhlIHNhbWUgdGltZS5cbiAgICBhd2FpdCB0aGlzLnNlcmlhbGl6ZUFja0FwcGxpY2F0aW9uKGFzeW5jICgpID0+IHtcbiAgICAgIGlmIChyZXBseS50eXBlID09PSAnY29tbWl0QWNrJykge1xuICAgICAgICBpZiAocmVwbHkuc2VxID4gdGhpcy5jdXJzb3IpIHRoaXMuY3Vyc29yID0gcmVwbHkuc2VxO1xuICAgICAgICB0aGlzLmFwcGx5QWNrVG9JbmRleChjb21taXQsIHJlcGx5LnZlcnNpb24sIHJlcGx5LmNsb2NrKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgYXdhaXQgdGhpcy5oYW5kbGVDb25mbGljdFJlcGx5KGNvbW1pdCwgcmVwbHkpO1xuICAgIH0pO1xuICB9XG5cbiAgLyoqIENoYWluIG9uZSByZXBseSdzIGluZGV4IGFwcGxpY2F0aW9uIGFmdGVyIGV2ZXJ5IHByZXZpb3VzbHktc3RhcnRlZCBvbmUuICovXG4gIHByaXZhdGUgc2VyaWFsaXplQWNrQXBwbGljYXRpb24oYXBwbHk6ICgpID0+IFByb21pc2U8dm9pZD4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBydW4gPSB0aGlzLmFja0NoYWluLnRoZW4oYXBwbHksIGFwcGx5KTtcbiAgICB0aGlzLmFja0NoYWluID0gcnVuLnRoZW4oXG4gICAgICAoKSA9PiB7fSxcbiAgICAgICgpID0+IHt9LFxuICAgICk7XG4gICAgcmV0dXJuIHJ1bjtcbiAgfVxuXG4gIHByaXZhdGUgYXBwbHlBY2tUb0luZGV4KGNvbW1pdDogU3RhZ2VkQ29tbWl0LCB2ZXJzaW9uSWQ6IHN0cmluZywgY2xvY2s6IExvZ2ljYWxDbG9jayk6IHZvaWQge1xuICAgIGNvbnN0IGRlbGV0ZWQgPSBjb21taXQua2luZCA9PT0gJ2RlbGV0ZSc7XG4gICAgaWYgKGNvbW1pdC5raW5kID09PSAncmVuYW1lJyAmJiBjb21taXQuZnJvbVBhdGggIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5pbmRleCA9IGFwcGx5Q29tbWl0KHJlbW92ZUVudHJ5KHRoaXMuaW5kZXgsIGNvbW1pdC5mcm9tUGF0aCksIHtcbiAgICAgICAgcGF0aDogY29tbWl0LnBhdGgsXG4gICAgICAgIHZlcnNpb25JZCxcbiAgICAgICAgaGFzaDogY29tbWl0Lmhhc2gsXG4gICAgICAgIHNpemU6IGNvbW1pdC5zaXplLFxuICAgICAgICBjbG9jayxcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICAvLyBgY29tbWl0Lm10aW1lYCBpcyB0aGUgc3RhdCBvYnNlcnZlZCBhdCBIQVNIIHRpbWUgZm9yIHRoaXMgZXhhY3QgY29udGVudFxuICAgIC8vICh0aHJlYWRlZCB0aHJvdWdoIGBzdGFnZVB1c2hlc2ApLCBuZXZlciBhIHN0YXQgdGFrZW4gYXQgYWNrIHRpbWUgXHUyMDE0IGFuXG4gICAgLy8gZWRpdCB0aGF0IGxhbmRlZCBiZXR3ZWVuIGhhc2hpbmcgYW5kIHRoaXMgYWNrIGNoYW5nZWQgdGhlIGRpc2sgc3RhdCwgc29cbiAgICAvLyB0aGUgbmV4dCBzY2FuIG1pc3NlcyB0aGUgZmFzdCBwYXRoIGFuZCByZS1oYXNoZXMvcHVzaGVzIHRoZSBlZGl0LlxuICAgIHRoaXMuaW5kZXggPSBhcHBseUNvbW1pdCh0aGlzLmluZGV4LCB7XG4gICAgICBwYXRoOiBjb21taXQucGF0aCxcbiAgICAgIHZlcnNpb25JZCxcbiAgICAgIGhhc2g6IGNvbW1pdC5oYXNoLFxuICAgICAgc2l6ZTogY29tbWl0LnNpemUsXG4gICAgICBjbG9jayxcbiAgICAgIGRlbGV0ZWQsXG4gICAgICBkZWxldGVkQXQ6IGRlbGV0ZWQgPyB0aGlzLm5vdygpIDogdW5kZWZpbmVkLFxuICAgICAgLi4uKGNvbW1pdC5pc0ZvbGRlciA9PT0gdHJ1ZSA/IHsgaXNGb2xkZXI6IHRydWUgfSA6IHt9KSxcbiAgICAgIC4uLihjb21taXQubXRpbWUgIT09IHVuZGVmaW5lZCA/IHsgbXRpbWU6IGNvbW1pdC5tdGltZSB9IDoge30pLFxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBoYW5kbGVDb25mbGljdFJlcGx5KFxuICAgIGNvbW1pdDogU3RhZ2VkQ29tbWl0LFxuICAgIHJlcGx5OiBDb25mbGljdE1lc3NhZ2UsXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmIChyZXBseS5zZXEgIT09IHVuZGVmaW5lZCAmJiByZXBseS5zZXEgPiB0aGlzLmN1cnNvcikgdGhpcy5jdXJzb3IgPSByZXBseS5zZXE7XG4gICAgY29uc3Qgd2VXb24gPVxuICAgICAgcmVwbHkud2lubmVyLmRldmljZUlkID09PSB0aGlzLm9wdGlvbnMuZGV2aWNlSWQgJiYgcmVwbHkud2lubmVyLmhhc2ggPT09IGNvbW1pdC5oYXNoO1xuICAgIGlmICh3ZVdvbikge1xuICAgICAgdGhpcy5hcHBseUFja1RvSW5kZXgoY29tbWl0LCByZXBseS53aW5uZXIuaWQsIHJlcGx5Lndpbm5lci5jbG9jayk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gV2UgbG9zdCB0aGUgcmFjZS4gTWF0ZXJpYWxpemUgdGhlIHdpbm5lciBkaXJlY3RseSBcdTIwMTQgdGhlIHNlcnZlciBoYXNcbiAgICAvLyBhbHJlYWR5IHByZXNlcnZlZCBvdXIgY29udGVudCBhcyBhIGNvbmZsaWN0IGNvcHkgKGlmIGl0IHdhcyBkaXN0aW5jdCkuXG4gICAgLy8gT25lIGNhdmVhdDogaWYgdGhlIHdvcmtpbmcgdHJlZSBtb3ZlZCBvbiBBR0FJTiBzaW5jZSB3ZSBzdGFnZWQgdGhpc1xuICAgIC8vIGNvbW1pdCwgZG8gbm90IGNsb2JiZXIgaXQgZWl0aGVyIFx1MjAxNCBoYW5kIHRoZSB3aG9sZSB0aGluZyB0byBhIGN5Y2xlLlxuICAgIGlmIChjb21taXQua2luZCAhPT0gJ2RlbGV0ZScgJiYgY29tbWl0LmtpbmQgIT09ICdyZW5hbWUnICYmIGNvbW1pdC5pc0ZvbGRlciAhPT0gdHJ1ZSkge1xuICAgICAgY29uc3QgbG9jYWwgPSBhd2FpdCB0aGlzLnJlYWRMb2NhbChjb21taXQucGF0aCk7XG4gICAgICBpZiAobG9jYWwgIT09IHVuZGVmaW5lZCAmJiAoYXdhaXQgc2hhMjU2SGV4KGxvY2FsKSkgIT09IGNvbW1pdC5oYXNoKSB7XG4gICAgICAgIHRoaXMuc2NoZWR1bGVSZWNvbmNpbGUoKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChjb21taXQua2luZCA9PT0gJ3JlbmFtZScgJiYgY29tbWl0LmZyb21QYXRoICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIC8vIE91ciByZW5hbWUgbG9zdDogdGhlIGZpbGUgc3RheXMgd2hlcmUgdGhlIHdpbm5lciBrZWVwcyBpdDsgcmVjb3JkXG4gICAgICAvLyB0aGUgd2lubmVyIGhlYWQgZm9yIHRoZSBkZXN0aW5hdGlvbiAodGhlIHNvdXJjZSBwYXRoIGlzIHVudG91Y2hlZCkuXG4gICAgICB0aGlzLmluZGV4ID0gYXBwbHlDb21taXQodGhpcy5pbmRleCwge1xuICAgICAgICBwYXRoOiByZXBseS53aW5uZXIucGF0aCxcbiAgICAgICAgdmVyc2lvbklkOiByZXBseS53aW5uZXIuaWQsXG4gICAgICAgIGhhc2g6IHJlcGx5Lndpbm5lci5oYXNoLFxuICAgICAgICBzaXplOiByZXBseS53aW5uZXIuc2l6ZSxcbiAgICAgICAgY2xvY2s6IHJlcGx5Lndpbm5lci5jbG9jayxcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRoaXMuaW5kZXggPSBhd2FpdCB0aGlzLmFwcGx5UHVsbHMoW3RoaXMud2lubmVyQXNQdWxsKHJlcGx5Lndpbm5lcildKTtcbiAgfVxuXG4gIC8qKiBUdXJuIGFuIGFyYml0cmF0ZWQgd2lubmVyIHZlcnNpb24gaW50byBhIHB1bGwgb3AgKGNvbnRlbnQgb3BzIG9ubHkpLiAqL1xuICBwcml2YXRlIHdpbm5lckFzUHVsbCh3aW5uZXI6IHtcbiAgICBwYXRoOiBzdHJpbmc7XG4gICAgaWQ6IHN0cmluZztcbiAgICBoYXNoOiBzdHJpbmc7XG4gICAgc2l6ZTogbnVtYmVyO1xuICAgIGRldmljZUlkOiBzdHJpbmc7XG4gICAgY2xvY2s6IExvZ2ljYWxDbG9jaztcbiAgICBraW5kOiBDb21taXRNZXNzYWdlWydraW5kJ107XG4gIH0pOiBQdWxsT3Age1xuICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5pbmRleFt3aW5uZXIucGF0aF07XG4gICAgY29uc3QgZGVsZXRlZCA9IHdpbm5lci5raW5kID09PSAnZGVsZXRlJztcbiAgICBjb25zdCBraW5kOiBQdWxsRmlsZU9wWydraW5kJ10gPSBkZWxldGVkXG4gICAgICA/ICdkZWxldGUnXG4gICAgICA6IGVudHJ5ID09PSB1bmRlZmluZWRcbiAgICAgICAgPyAnYWRkJ1xuICAgICAgICA6IGVudHJ5LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkXG4gICAgICAgICAgPyAncmVzdG9yZSdcbiAgICAgICAgICA6ICdlZGl0JztcbiAgICByZXR1cm4ge1xuICAgICAga2luZCxcbiAgICAgIHBhdGg6IHdpbm5lci5wYXRoLFxuICAgICAgaGFzaDogd2lubmVyLmhhc2gsXG4gICAgICBzaXplOiB3aW5uZXIuc2l6ZSxcbiAgICAgIHZlcnNpb246IHdpbm5lci5pZCxcbiAgICAgIGNsb2NrOiB3aW5uZXIuY2xvY2ssXG4gICAgICBkZWxldGVkLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHVwbG9hZEJsb2IoaGFzaDogc3RyaW5nLCBieXRlczogVWludDhBcnJheSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHRyYW5zcG9ydCA9IHRoaXMudHJhbnNwb3J0O1xuICAgIGlmICh0cmFuc3BvcnQgPT09IG51bGwpIHRocm93IG5ldyBOZXR3b3JrRXJyb3IoJ25vdCBjb25uZWN0ZWQnKTtcbiAgICBjb25zdCByZXBseSA9IGF3YWl0IHRoaXMucmVxdWVzdDxCbG9iQWNrTWVzc2FnZSB8IFNlcnZlckVycm9yTWVzc2FnZT4oXG4gICAgICAobSkgPT4gbS50eXBlID09PSAnYmxvYkFjaycgfHwgbS50eXBlID09PSAnZXJyb3InLFxuICAgICAgKCkgPT4gdHJhbnNwb3J0LnNlbmQoeyB0eXBlOiAncHV0QmxvYicsIGhhc2gsIGNvbnRlbnQ6IGJ5dGVzVG9CYXNlNjQoYnl0ZXMpIH0pLFxuICAgICk7XG4gICAgaWYgKHJlcGx5LnR5cGUgPT09ICdlcnJvcicpIHRocm93IHRoaXMudG9FcnJvcihyZXBseSk7XG4gICAgYXdhaXQgdGhpcy5vcHRpb25zLmJsb2JTdG9yZS5wdXQoaGFzaCwgYnl0ZXMpO1xuICB9XG5cbiAgcHJpdmF0ZSByZWFkb25seSBmZXRjaEJsb2I6IEZldGNoQmxvYiA9IGFzeW5jIChoYXNoOiBzdHJpbmcpOiBQcm9taXNlPFVpbnQ4QXJyYXk+ID0+IHtcbiAgICBpZiAoaGFzaCA9PT0gJycpIHRocm93IG5ldyBQcm90b2NvbEVycm9yKCdyZWZ1c2luZyB0byBmZXRjaCBjb250ZW50IGZvciBhbiBlbXB0eSBoYXNoJyk7XG4gICAgY29uc3QgY2FjaGVkID0gYXdhaXQgdGhpcy5vcHRpb25zLmJsb2JTdG9yZS5nZXQoaGFzaCk7XG4gICAgaWYgKGNhY2hlZCAhPT0gdW5kZWZpbmVkKSByZXR1cm4gY2FjaGVkO1xuICAgIGNvbnN0IGJ5dGVzID0gYXdhaXQgdGhpcy5kb3dubG9hZEJsb2IoaGFzaCk7XG4gICAgYXdhaXQgdGhpcy5vcHRpb25zLmJsb2JTdG9yZS5wdXQoaGFzaCwgYnl0ZXMpO1xuICAgIHJldHVybiBieXRlcztcbiAgfTtcblxuICBwcml2YXRlIGFzeW5jIGRvd25sb2FkQmxvYihoYXNoOiBzdHJpbmcpOiBQcm9taXNlPFVpbnQ4QXJyYXk+IHtcbiAgICBjb25zdCB0cmFuc3BvcnQgPSB0aGlzLnRyYW5zcG9ydDtcbiAgICBpZiAodHJhbnNwb3J0ID09PSBudWxsKSB0aHJvdyBuZXcgTmV0d29ya0Vycm9yKCdub3QgY29ubmVjdGVkJyk7XG4gICAgY29uc3QgcmVwbHkgPSBhd2FpdCB0aGlzLnJlcXVlc3Q8QmxvYk1lc3NhZ2UgfCBTZXJ2ZXJFcnJvck1lc3NhZ2U+KFxuICAgICAgKG0pID0+IChtLnR5cGUgPT09ICdibG9iJyAmJiBtLmhhc2ggPT09IGhhc2gpIHx8IG0udHlwZSA9PT0gJ2Vycm9yJyxcbiAgICAgICgpID0+IHRyYW5zcG9ydC5zZW5kKHsgdHlwZTogJ2dldEJsb2InLCBoYXNoIH0pLFxuICAgICk7XG4gICAgaWYgKHJlcGx5LnR5cGUgPT09ICdlcnJvcicpIHRocm93IHRoaXMudG9FcnJvcihyZXBseSk7XG4gICAgY29uc3QgYnl0ZXMgPSBiYXNlNjRUb0J5dGVzKHJlcGx5LmNvbnRlbnQpO1xuICAgIGlmICgoYXdhaXQgc2hhMjU2SGV4KGJ5dGVzKSkgIT09IGhhc2gpIHtcbiAgICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKGBibG9iICR7aGFzaH0gZmFpbGVkIHZlcmlmaWNhdGlvbiBvbiBkb3dubG9hZGApO1xuICAgIH1cbiAgICByZXR1cm4gYnl0ZXM7XG4gIH1cblxuICAvLyAtLS0gcGx1bWJpbmcgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIHByaXZhdGUgcmVxdWVzdDxUIGV4dGVuZHMgU2VydmVyTWVzc2FnZT4oXG4gICAgbWF0Y2hlczogKG1lc3NhZ2U6IE1lc3NhZ2UpID0+IGJvb2xlYW4sXG4gICAgc2VuZDogKCkgPT4gdm9pZCxcbiAgKTogUHJvbWlzZTxUPiB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlPFQ+KChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIGNvbnN0IGV4cGVjdGF0aW9uOiAodHlwZW9mIHRoaXMuZXhwZWN0YXRpb25zKVtudW1iZXJdID0ge1xuICAgICAgICBtYXRjaGVzOiAobWVzc2FnZSkgPT4gbWF0Y2hlcyhtZXNzYWdlKSxcbiAgICAgICAgcmVzb2x2ZTogKG1lc3NhZ2UpID0+IHJlc29sdmUobWVzc2FnZSBhcyBUKSxcbiAgICAgICAgcmVqZWN0LFxuICAgICAgfTtcbiAgICAgIHRoaXMuZXhwZWN0YXRpb25zLnB1c2goZXhwZWN0YXRpb24pO1xuICAgICAgdHJ5IHtcbiAgICAgICAgc2VuZCgpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgY29uc3QgaW5kZXggPSB0aGlzLmV4cGVjdGF0aW9ucy5pbmRleE9mKGV4cGVjdGF0aW9uKTtcbiAgICAgICAgaWYgKGluZGV4ID49IDApIHRoaXMuZXhwZWN0YXRpb25zLnNwbGljZShpbmRleCwgMSk7XG4gICAgICAgIHJlamVjdChlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgTmV0d29ya0Vycm9yKFN0cmluZyhlcnJvcikpKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgdG9FcnJvcihtZXNzYWdlOiBTZXJ2ZXJFcnJvck1lc3NhZ2UpOiBFcnJvciB7XG4gICAgc3dpdGNoIChtZXNzYWdlLmNvZGUpIHtcbiAgICAgIGNhc2UgJ1VOQVVUSE9SSVpFRCc6XG4gICAgICAgIHJldHVybiBuZXcgVW5hdXRob3JpemVkRXJyb3IobWVzc2FnZS5tZXNzYWdlKTtcbiAgICAgIGNhc2UgJ1JFVk9LRUQnOlxuICAgICAgICByZXR1cm4gbmV3IFJldm9rZWRFcnJvcihtZXNzYWdlLm1lc3NhZ2UpO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgcmV0dXJuIG5ldyBQcm90b2NvbEVycm9yKG1lc3NhZ2UubWVzc2FnZSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBlbnF1ZXVlKG9wZXJhdGlvbjogKCkgPT4gUHJvbWlzZTx2b2lkPik6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMucXVldWVkT3BzICs9IDE7XG4gICAgY29uc3QgcnVuID0gdGhpcy50YWlsLnRoZW4ob3BlcmF0aW9uLCBvcGVyYXRpb24pO1xuICAgIGNvbnN0IHNldHRsZWQgPSBydW4udGhlbihcbiAgICAgICgpID0+IHtcbiAgICAgICAgdGhpcy5xdWV1ZWRPcHMgLT0gMTtcbiAgICAgICAgdGhpcy5wZXJzaXN0SW5kZXgoKTtcbiAgICAgIH0sXG4gICAgICAoZXJyb3I6IHVua25vd24pID0+IHtcbiAgICAgICAgdGhpcy5xdWV1ZWRPcHMgLT0gMTtcbiAgICAgICAgdGhpcy5wZXJzaXN0SW5kZXgoKTtcbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICB9LFxuICAgICk7XG4gICAgLy8gU3dhbGxvdyByZWplY3Rpb25zIG9uIHRoZSBzaGFyZWQgdGFpbCAoaW5kaXZpZHVhbCBjYWxsZXJzIHNlZSB0aGVtIHZpYVxuICAgIC8vIGBzZXR0bGVkYCk7IG9uZSBmYWlsZWQgb3AgbXVzdCBub3QgcG9pc29uIHRoZSBxdWV1ZS5cbiAgICB0aGlzLnRhaWwgPSBzZXR0bGVkLnRoZW4oXG4gICAgICAoKSA9PiB7fSxcbiAgICAgICgpID0+IHt9LFxuICAgICk7XG4gICAgcmV0dXJuIHNldHRsZWQ7XG4gIH1cblxuICBwcml2YXRlIHBlcnNpc3RJbmRleCgpOiB2b2lkIHtcbiAgICBjb25zdCBzbmFwc2hvdCA9IHNlcmlhbGl6ZUxvY2FsSW5kZXgodGhpcy5pbmRleCwgdGhpcy5wZXJzaXN0ZWRTdGF0ZSgpKTtcbiAgICB2b2lkIHRoaXMub3B0aW9ucy5zdG9yYWdlXG4gICAgICAud3JpdGVGaWxlKExPQ0FMX0lOREVYX1NUQVRFX1BBVEgsIG5ldyBUZXh0RW5jb2RlcigpLmVuY29kZShzbmFwc2hvdCkpXG4gICAgICAuY2F0Y2goKGVycm9yOiB1bmtub3duKSA9PiB0aGlzLmxvZy53YXJuKCdmYWlsZWQgdG8gcGVyc2lzdCBsb2NhbCBpbmRleCcsIGVycm9yKSk7XG4gIH1cbn1cblxuLy8gLS0tIG1vZHVsZS1wcml2YXRlIHR5cGUgYWxpYXNlcyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxudHlwZSBTZXJ2ZXJFcnJvck1lc3NhZ2UgPSBFeHRyYWN0PFNlcnZlck1lc3NhZ2UsIHsgdHlwZTogJ2Vycm9yJyB9PjtcbiIsICIvKipcbiAqIGBPYnNpZGlhblN0b3JhZ2VBZGFwdGVyYCBcdTIwMTQgY29yZSdzIGBTdG9yYWdlQWRhcHRlcmAgb3ZlciB0aGUgT2JzaWRpYW4gdmF1bHRcbiAqIGBEYXRhQWRhcHRlcmAgKEFSQ0hJVEVDVFVSRSBcdTAwQTc4IGFkYXB0ZXJzOiBwbHVnaW4gaW1wbGVtZW50YXRpb24sIGRlc2t0b3AgYW5kXG4gKiBtb2JpbGUgYWxpa2UpLlxuICpcbiAqIFBhdGggbWFwcGluZzogZXZlcnkgcGF0aCBjcm9zc2luZyB0aGUgY29yZSBzZWFtIGlzIGEgUE9TSVgtbm9ybWFsaXplZCB2YXVsdFxuICogcGF0aCAoYC9ub3Rlcy9hLm1kYCwgcm9vdCBgL2ApOyB0aGUgT2JzaWRpYW4gYWRhcHRlciB3YW50cyB0aGUgc2FtZSBwYXRoXG4gKiAqd2l0aG91dCogdGhlIGxlYWRpbmcgc2xhc2ggKGBub3Rlcy9hLm1kYCksIHdpdGggYC9gIChvciBgJydgKSBmb3IgdGhlIHJvb3QuXG4gKlxuICogQWxsIHdyaXRlcyBnbyB0aHJvdWdoIHRoZSBhZGFwdGVyIChuZXZlciBgdmF1bHQubW9kaWZ5YCBvbiB0aGUgc2lkZSksIHNvXG4gKiBPYnNpZGlhbidzIG93biBmaWxlIHdhdGNoaW5nIG9ic2VydmVzIHRoZW0gbGlrZSBhbnkgZXh0ZXJuYWwgZWRpdCBhbmQgb3BlblxuICogZWRpdG9ycyByZWZyZXNoIChGUi0zKS4gV3JpdGVzIGFyZSBhdG9taWMtaXNoOiBjb250ZW50IGxhbmRzIGluIGEgdGVtcCBmaWxlXG4gKiB1bmRlciBgLy52YXVsdHN5bmNmb3JhZ2VudHMvdG1wL2AgKGNvcmUgaWdub3JlcyB0aGF0IHdob2xlIHN1YnRyZWUpIGFuZCBpc1xuICogcmVuYW1lZCBvbnRvIHRoZSB0YXJnZXQ7IGlmIHJlbmFtaW5nIGlzIHVuYXZhaWxhYmxlIChleG90aWMgbW9iaWxlXG4gKiBhZGFwdGVycyksIHdlIGZhbGwgYmFjayB0byBhIGRpcmVjdCB3cml0ZS5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IERhdGFBZGFwdGVyIH0gZnJvbSAnb2JzaWRpYW4nO1xuaW1wb3J0IHR5cGUgeyBGaWxlU3RhdCwgU3RvcmFnZUFkYXB0ZXIgfSBmcm9tICdAdnNhL2NvcmUnO1xuaW1wb3J0IHsgbm9ybWFsaXplVmF1bHRQYXRoIH0gZnJvbSAnQHZzYS9jb3JlJztcblxuLyoqIERpcmVjdG9yeSAoaW5zaWRlIHRoZSB2YXVsdCkgaG9sZGluZyB0ZW1wIGZpbGVzIGR1cmluZyBhdG9taWMgd3JpdGVzLiAqL1xuZXhwb3J0IGNvbnN0IFRFTVBfRElSX1ZBVUxUX1BBVEggPSAnLy52YXVsdHN5bmNmb3JhZ2VudHMvdG1wJztcblxuLyoqIFN0YXRzIE9ic2lkaWFuJ3MgYERhdGFBZGFwdGVyLnN0YXRgIHJldHVybnMgZm9yIGEgZmlsZS4gKi9cbmludGVyZmFjZSBBZGFwdGVyU3RhdCB7XG4gIHNpemU6IG51bWJlcjtcbiAgbXRpbWU6IG51bWJlcjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBPYnNpZGlhblN0b3JhZ2VBZGFwdGVyT3B0aW9ucyB7XG4gIGFkYXB0ZXI6IERhdGFBZGFwdGVyO1xufVxuXG5leHBvcnQgY2xhc3MgT2JzaWRpYW5TdG9yYWdlQWRhcHRlciBpbXBsZW1lbnRzIFN0b3JhZ2VBZGFwdGVyIHtcbiAgcHJpdmF0ZSByZWFkb25seSBhZGFwdGVyOiBEYXRhQWRhcHRlcjtcbiAgLyoqXG4gICAqIExhdGNoZWQgd2hlbiBhIHRlbXArcmVuYW1lIGF0dGVtcHQgZmFpbHM6IGV2ZXJ5IGxhdGVyIHdyaXRlIGdvZXMgc3RyYWlnaHRcbiAgICogdG8gYHdyaXRlQmluYXJ5YCBpbnN0ZWFkIG9mIHBheWluZyB0aGUgZmFpbGluZy1yZW5hbWUgcGVuYWx0eSBhZ2Fpbi5cbiAgICovXG4gIHByaXZhdGUgdGVtcFJlbmFtZUJyb2tlbiA9IGZhbHNlO1xuICBwcml2YXRlIHRlbXBDb3VudGVyID0gMDtcblxuICBjb25zdHJ1Y3RvcihvcHRpb25zOiBPYnNpZGlhblN0b3JhZ2VBZGFwdGVyT3B0aW9ucykge1xuICAgIHRoaXMuYWRhcHRlciA9IG9wdGlvbnMuYWRhcHRlcjtcbiAgfVxuXG4gIC8vIC0tLSBwYXRoIG1hcHBpbmcgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIC8qKiBWYXVsdCBwYXRoIFx1MjE5MiBhZGFwdGVyIHBhdGggKGAvYS9iLm1kYCBcdTIxOTIgYGEvYi5tZGAsIGAvYCBcdTIxOTIgYC9gKS4gKi9cbiAgcHJpdmF0ZSB0b0FkYXB0ZXJQYXRoKHZhdWx0UGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBub3JtYWxpemVkID0gbm9ybWFsaXplVmF1bHRQYXRoKHZhdWx0UGF0aCk7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZWQgPT09ICcvJyA/ICcvJyA6IG5vcm1hbGl6ZWQuc2xpY2UoMSk7XG4gIH1cblxuICAvLyAtLS0gU3RvcmFnZUFkYXB0ZXIgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgYXN5bmMgcmVhZEZpbGUocGF0aDogc3RyaW5nKTogUHJvbWlzZTxVaW50OEFycmF5PiB7XG4gICAgY29uc3QgYnVmZmVyID0gYXdhaXQgdGhpcy5hZGFwdGVyLnJlYWRCaW5hcnkodGhpcy50b0FkYXB0ZXJQYXRoKHBhdGgpKTtcbiAgICByZXR1cm4gbmV3IFVpbnQ4QXJyYXkoYnVmZmVyKTtcbiAgfVxuXG4gIGFzeW5jIHdyaXRlRmlsZShwYXRoOiBzdHJpbmcsIGRhdGE6IFVpbnQ4QXJyYXkpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCB0YXJnZXQgPSB0aGlzLnRvQWRhcHRlclBhdGgocGF0aCk7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVQYXJlbnREaXJzKHRhcmdldCk7XG4gICAgLy8gQ29weSBpbnRvIGEgc3RhbmRhbG9uZSBBcnJheUJ1ZmZlcjogYGJ5dGVzLmJ1ZmZlcmAgbWF5IGJlIGEgcG9vbGVkXG4gICAgLy8gYnVmZmVyIGxhcmdlciB0aGFuIHRoZSB2aWV3IChjb3JlIHNsaWNlcyBhbmQgcmV1c2VzIGJ1ZmZlcnMpLlxuICAgIGNvbnN0IGJ1ZmZlciA9IG5ldyBBcnJheUJ1ZmZlcihkYXRhLmJ5dGVMZW5ndGgpO1xuICAgIG5ldyBVaW50OEFycmF5KGJ1ZmZlcikuc2V0KGRhdGEpO1xuXG4gICAgaWYgKHRoaXMudGVtcFJlbmFtZUJyb2tlbikge1xuICAgICAgYXdhaXQgdGhpcy5hZGFwdGVyLndyaXRlQmluYXJ5KHRhcmdldCwgYnVmZmVyKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgdGVtcCA9IGF3YWl0IHRoaXMudGVtcFBhdGgoKTtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5hZGFwdGVyLndyaXRlQmluYXJ5KHRlbXAsIGJ1ZmZlcik7XG4gICAgICBhd2FpdCB0aGlzLmFkYXB0ZXIucmVuYW1lKHRlbXAsIHRhcmdldCk7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBDbGVhbiB1cCB0aGUgb3JwaGFuZWQgdGVtcCAoYmVzdCBlZmZvcnQgXHUyMDE0IGl0IGxpdmVzIGluIHRoZSBpZ25vcmVkXG4gICAgICAvLyBzdGF0ZSBkaXIsIHNvIGV2ZW4gYSBsZWFrIGlzIGludmlzaWJsZSB0byBzeW5jKSwgdGhlbiBmYWxsIGJhY2sgdG9cbiAgICAgIC8vIGEgZGlyZWN0LCBub24tYXRvbWljIHdyaXRlIHJhdGhlciB0aGFuIGZhaWxpbmcgdGhlIHN5bmMuXG4gICAgICBhd2FpdCB0aGlzLnNpbGVudFJlbW92ZSh0ZW1wKTtcbiAgICAgIHRoaXMudGVtcFJlbmFtZUJyb2tlbiA9IHRydWU7XG4gICAgICBhd2FpdCB0aGlzLmFkYXB0ZXIud3JpdGVCaW5hcnkodGFyZ2V0LCBidWZmZXIpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGRlbGV0ZUZpbGUocGF0aDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgdGFyZ2V0ID0gdGhpcy50b0FkYXB0ZXJQYXRoKHBhdGgpO1xuICAgIC8vIElkZW1wb3RlbnQgcGVyIHRoZSBhZGFwdGVyIGNvbnRyYWN0LlxuICAgIGlmICghKGF3YWl0IHRoaXMuYWRhcHRlci5leGlzdHModGFyZ2V0KSkpIHJldHVybjtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5hZGFwdGVyLnJlbW92ZSh0YXJnZXQpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gTG9zdCBhIHJhY2Ugd2l0aCBhIGNvbmN1cnJlbnQgZGVsZXRlIFx1MjAxNCBvbmx5IHN1cmZhY2UgaWYgaXQgc3Vydml2ZXMuXG4gICAgICBpZiAoYXdhaXQgdGhpcy5hZGFwdGVyLmV4aXN0cyh0YXJnZXQpKSB0aHJvdyBuZXcgRXJyb3IoYGZhaWxlZCB0byBkZWxldGUgJHt0YXJnZXR9YCk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgcmVuYW1lRmlsZShmcm9tOiBzdHJpbmcsIHRvOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBmcm9tUGF0aCA9IHRoaXMudG9BZGFwdGVyUGF0aChmcm9tKTtcbiAgICBjb25zdCB0b1BhdGggPSB0aGlzLnRvQWRhcHRlclBhdGgodG8pO1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUGFyZW50RGlycyh0b1BhdGgpO1xuICAgIGF3YWl0IHRoaXMuYWRhcHRlci5yZW5hbWUoZnJvbVBhdGgsIHRvUGF0aCk7XG4gIH1cblxuICBhc3luYyBsaXN0RmlsZXMoKTogUHJvbWlzZTxyZWFkb25seSBGaWxlU3RhdFtdPiB7XG4gICAgY29uc3QgZmlsZXM6IEZpbGVTdGF0W10gPSBbXTtcbiAgICBhd2FpdCB0aGlzLndhbGtGaWxlcygnLycsIGFzeW5jIChhZGFwdGVyUGF0aCkgPT4ge1xuICAgICAgY29uc3Qgc3RhdCA9IGF3YWl0IHRoaXMuc3RhdE9yTnVsbChhZGFwdGVyUGF0aCk7XG4gICAgICBpZiAoc3RhdCA9PT0gbnVsbCkgcmV0dXJuOyAvLyB2YW5pc2hlZCBtaWQtd2Fsa1xuICAgICAgZmlsZXMucHVzaCh7XG4gICAgICAgIHBhdGg6IGAvJHthZGFwdGVyUGF0aH1gLFxuICAgICAgICBzaXplOiBzdGF0LnNpemUsXG4gICAgICAgIG10aW1lOiBzdGF0Lm10aW1lLFxuICAgICAgfSk7XG4gICAgfSk7XG4gICAgZmlsZXMuc29ydCgoYSwgYikgPT4gKGEucGF0aCA8IGIucGF0aCA/IC0xIDogYS5wYXRoID4gYi5wYXRoID8gMSA6IDApKTtcbiAgICByZXR1cm4gZmlsZXM7XG4gIH1cblxuICBhc3luYyBsaXN0RGlycygpOiBQcm9taXNlPHJlYWRvbmx5IHN0cmluZ1tdPiB7XG4gICAgY29uc3QgZGlyczogc3RyaW5nW10gPSBbJy8nXTtcbiAgICBhd2FpdCB0aGlzLndhbGtGb2xkZXJzKCcvJywgYXN5bmMgKGFkYXB0ZXJQYXRoKSA9PiB7XG4gICAgICBkaXJzLnB1c2goYC8ke2FkYXB0ZXJQYXRofWApO1xuICAgIH0pO1xuICAgIGRpcnMuc29ydCgoYSwgYikgPT4gKGEgPCBiID8gLTEgOiBhID4gYiA/IDEgOiAwKSk7XG4gICAgcmV0dXJuIGRpcnM7XG4gIH1cblxuICBhc3luYyBlbnN1cmVEaXIocGF0aDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IG5vcm1hbGl6ZVZhdWx0UGF0aChwYXRoKTtcbiAgICBjb25zdCBzZWdtZW50cyA9IG5vcm1hbGl6ZWQgPT09ICcvJyA/IFtdIDogbm9ybWFsaXplZC5zbGljZSgxKS5zcGxpdCgnLycpO1xuICAgIGxldCBjdXJyZW50ID0gJyc7XG4gICAgZm9yIChjb25zdCBzZWdtZW50IG9mIHNlZ21lbnRzKSB7XG4gICAgICBjdXJyZW50ID0gY3VycmVudCA9PT0gJycgPyBzZWdtZW50IDogYCR7Y3VycmVudH0vJHtzZWdtZW50fWA7XG4gICAgICBpZiAoIShhd2FpdCB0aGlzLmFkYXB0ZXIuZXhpc3RzKGN1cnJlbnQpKSkgYXdhaXQgdGhpcy5hZGFwdGVyLm1rZGlyKGN1cnJlbnQpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGV4aXN0cyhwYXRoOiBzdHJpbmcpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBjb25zdCBub3JtYWxpemVkID0gbm9ybWFsaXplVmF1bHRQYXRoKHBhdGgpO1xuICAgIGlmIChub3JtYWxpemVkID09PSAnLycpIHJldHVybiB0cnVlOyAvLyB0aGUgdmF1bHQgcm9vdCBhbHdheXMgZXhpc3RzXG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLmFkYXB0ZXIuZXhpc3RzKHRoaXMudG9BZGFwdGVyUGF0aChub3JtYWxpemVkKSk7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICB9XG5cbiAgLy8gLS0tIGhlbHBlcnMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIHByaXZhdGUgYXN5bmMgc3RhdE9yTnVsbChhZGFwdGVyUGF0aDogc3RyaW5nKTogUHJvbWlzZTxBZGFwdGVyU3RhdCB8IG51bGw+IHtcbiAgICB0cnkge1xuICAgICAgY29uc3Qgc3RhdCA9IGF3YWl0IHRoaXMuYWRhcHRlci5zdGF0KGFkYXB0ZXJQYXRoKTtcbiAgICAgIGlmIChzdGF0ID09PSBudWxsIHx8IHN0YXQudHlwZSAhPT0gJ2ZpbGUnKSByZXR1cm4gbnVsbDtcbiAgICAgIHJldHVybiB7IHNpemU6IHN0YXQuc2l6ZSwgbXRpbWU6IHN0YXQubXRpbWUgfTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cbiAgfVxuXG4gIC8qKiBBIHVuaXF1ZSB0ZW1wIHBhdGggaW5zaWRlIHRoZSAoc3luYy1pZ25vcmVkKSBjbGllbnQgc3RhdGUgZGlyLiAqL1xuICBwcml2YXRlIGFzeW5jIHRlbXBQYXRoKCk6IFByb21pc2U8c3RyaW5nPiB7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVEaXIoVEVNUF9ESVJfVkFVTFRfUEFUSCk7XG4gICAgdGhpcy50ZW1wQ291bnRlciArPSAxO1xuICAgIHJldHVybiBgJHtURU1QX0RJUl9WQVVMVF9QQVRILnNsaWNlKDEpfS93LSR7RGF0ZS5ub3coKS50b1N0cmluZygzNil9LSR7dGhpcy50ZW1wQ291bnRlcn0udG1wYDtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgc2lsZW50UmVtb3ZlKGFkYXB0ZXJQYXRoOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5hZGFwdGVyLnJlbW92ZShhZGFwdGVyUGF0aCk7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBiZXN0IGVmZm9ydFxuICAgIH1cbiAgfVxuXG4gIC8qKiBDcmVhdGUgZXZlcnkgYW5jZXN0b3IgZGlyZWN0b3J5IG9mIGFuIGFkYXB0ZXIgZmlsZSBwYXRoLiAqL1xuICBwcml2YXRlIGFzeW5jIGVuc3VyZVBhcmVudERpcnMoYWRhcHRlclBhdGg6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHNsYXNoID0gYWRhcHRlclBhdGgubGFzdEluZGV4T2YoJy8nKTtcbiAgICBpZiAoc2xhc2ggPD0gMCkgcmV0dXJuOyAvLyB2YXVsdCByb290IFx1MjAxNCBhbHdheXMgZXhpc3RzXG4gICAgY29uc3QgcGFyZW50ID0gYWRhcHRlclBhdGguc2xpY2UoMCwgc2xhc2gpO1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlRGlyKGAvJHtwYXJlbnR9YCk7XG4gIH1cblxuICAvKiogUmVjdXJzaXZlbHkgdmlzaXQgZXZlcnkgZmlsZSB1bmRlciBgZGlyQWRhcHRlclBhdGhgIChhZGFwdGVyIHBhdGhzKS4gKi9cbiAgcHJpdmF0ZSBhc3luYyB3YWxrRmlsZXMoXG4gICAgZGlyQWRhcHRlclBhdGg6IHN0cmluZyxcbiAgICB2aXNpdDogKGFkYXB0ZXJQYXRoOiBzdHJpbmcpID0+IFByb21pc2U8dm9pZD4sXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGxldCBsaXN0aW5nO1xuICAgIHRyeSB7XG4gICAgICBsaXN0aW5nID0gYXdhaXQgdGhpcy5hZGFwdGVyLmxpc3QoZGlyQWRhcHRlclBhdGgpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuOyAvLyB1bnJlYWRhYmxlL21pc3NpbmcgXHUyMDE0IHRyZWF0IGFzIGVtcHR5XG4gICAgfVxuICAgIGZvciAoY29uc3QgZmlsZSBvZiBsaXN0aW5nLmZpbGVzKSBhd2FpdCB2aXNpdChmaWxlKTtcbiAgICBmb3IgKGNvbnN0IGZvbGRlciBvZiBsaXN0aW5nLmZvbGRlcnMpIGF3YWl0IHRoaXMud2Fsa0ZpbGVzKGZvbGRlciwgdmlzaXQpO1xuICB9XG5cbiAgLyoqIFJlY3Vyc2l2ZWx5IHZpc2l0IGV2ZXJ5IGZvbGRlciB1bmRlciBgZGlyQWRhcHRlclBhdGhgIChhZGFwdGVyIHBhdGhzKS4gKi9cbiAgcHJpdmF0ZSBhc3luYyB3YWxrRm9sZGVycyhcbiAgICBkaXJBZGFwdGVyUGF0aDogc3RyaW5nLFxuICAgIHZpc2l0OiAoYWRhcHRlclBhdGg6IHN0cmluZykgPT4gUHJvbWlzZTx2b2lkPixcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgbGV0IGxpc3Rpbmc7XG4gICAgdHJ5IHtcbiAgICAgIGxpc3RpbmcgPSBhd2FpdCB0aGlzLmFkYXB0ZXIubGlzdChkaXJBZGFwdGVyUGF0aCk7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGZvciAoY29uc3QgZm9sZGVyIG9mIGxpc3RpbmcuZm9sZGVycykge1xuICAgICAgYXdhaXQgdmlzaXQoZm9sZGVyKTtcbiAgICAgIGF3YWl0IHRoaXMud2Fsa0ZvbGRlcnMoZm9sZGVyLCB2aXNpdCk7XG4gICAgfVxuICB9XG59XG4iLCAiLyoqXG4gKiBgT2JzaWRpYW5XYXRjaEFkYXB0ZXJgICsgYFJlc2NhblNjaGVkdWxlcmAgXHUyMDE0IGNvcmUncyBgV2F0Y2hBZGFwdGVyYCBvdmVyXG4gKiBPYnNpZGlhbiB2YXVsdCBldmVudHMgKEFSQ0hJVEVDVFVSRSBcdTAwQTc4IGFkYXB0ZXJzKSwgcGx1cyB0aGUgcGVyaW9kaWMgL1xuICogZm9jdXMtZHJpdmVuIHJlY29uY2lsaWF0aW9uIGhvb2tzIHRoZSBtb2JpbGUgJiBleHRlcm5hbC1lZGl0IHN0b3JpZXMgbmVlZFxuICogKFx1MDBBNzggXCJNb2JpbGVcIiwgRlItNSwgRlItMTIpLlxuICpcbiAqIFZhdWx0IGV2ZW50cyBjb3ZlciBldmVyeXRoaW5nIE9ic2lkaWFuIGl0c2VsZiBvYnNlcnZlcyBcdTIwMTQgaW4tYXBwIGVkaXRzLFxuICogZHJhZy1kcm9wcywgYW5kIGV4dGVybmFsIGVkaXRzIG1hZGUgd2hpbGUgT2JzaWRpYW4gaXMgKm9wZW4qLiBFZGl0cyBtYWRlXG4gKiB3aGlsZSBPYnNpZGlhbiB3YXMgY2xvc2VkIGFyZSBwaWNrZWQgdXAgYnkgdGhlIHN0YXJ0dXAgcmVjb25jaWxpYXRpb24gYW5kXG4gKiBieSB0aGUgcGVyaW9kaWMgcmVzY2FuIHdpcmVkIGhlcmU6XG4gKlxuICogICB2YXVsdCBldmVudHMgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNUJBIFdhdGNoQWRhcHRlci5zdGFydChjYikgXHUyNTAwXHUyNUJBIFN5bmNDbGllbnQgZGVib3VuY2VkIGN5Y2xlXG4gKiAgIHNldEludGVydmFsIChkZWZhdWx0IDMwcykgXHUyNTAwXHUyNUJBIFJlc2NhblNjaGVkdWxlciBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1QkEgU3luY0NsaWVudC50cmlnZ2VyU3luYygpXG4gKiAgIGFjdGl2ZS1sZWFmLWNoYW5nZSBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1QkEgUmVzY2FuU2NoZWR1bGVyLnBva2UoKSBcdTI1MDBcdTI1MDBcdTI1QkEgKHNob3J0IGRlYm91bmNlLCB0aGVuIGEgY3ljbGUpXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBFdmVudFJlZiwgVEFic3RyYWN0RmlsZSwgVmF1bHQgfSBmcm9tICdvYnNpZGlhbic7XG5pbXBvcnQgdHlwZSB7IEZpbGVDaGFuZ2VFdmVudCwgV2F0Y2hBZGFwdGVyIH0gZnJvbSAnQHZzYS9jb3JlJztcblxuZXhwb3J0IGludGVyZmFjZSBPYnNpZGlhbldhdGNoQWRhcHRlck9wdGlvbnMge1xuICB2YXVsdDogVmF1bHQ7XG59XG5cbmV4cG9ydCBjbGFzcyBPYnNpZGlhbldhdGNoQWRhcHRlciBpbXBsZW1lbnRzIFdhdGNoQWRhcHRlciB7XG4gIHByaXZhdGUgcmVhZG9ubHkgdmF1bHQ6IFZhdWx0O1xuICBwcml2YXRlIHJlZnM6IEV2ZW50UmVmW10gPSBbXTtcbiAgcHJpdmF0ZSBlbWl0OiAoKGV2ZW50czogcmVhZG9ubHkgRmlsZUNoYW5nZUV2ZW50W10pID0+IHZvaWQpIHwgbnVsbCA9IG51bGw7XG5cbiAgY29uc3RydWN0b3Iob3B0aW9uczogT2JzaWRpYW5XYXRjaEFkYXB0ZXJPcHRpb25zKSB7XG4gICAgdGhpcy52YXVsdCA9IG9wdGlvbnMudmF1bHQ7XG4gIH1cblxuICBzdGFydChjYjogKGV2ZW50czogcmVhZG9ubHkgRmlsZUNoYW5nZUV2ZW50W10pID0+IHZvaWQpOiB2b2lkIHtcbiAgICB0aGlzLnN0b3AoKTtcbiAgICB0aGlzLmVtaXQgPSBjYjtcbiAgICAvLyBCb3RoIGZpbGVzIGFuZCBmb2xkZXJzIGFyZSBmb3J3YXJkZWQ6IGZvbGRlciBldmVudHMgKGNyZWF0ZS9yZW5hbWUvXG4gICAgLy8gZGVsZXRlKSB0cmlnZ2VyIHRoZSByZWNvbmNpbGlhdGlvbiBzY2FuIHRoYXQgZGlzY292ZXJzIGVtcHR5LWZvbGRlclxuICAgIC8vIHBsYWNlaG9sZGVyIGNoYW5nZXMgKEZSLTEwKS4gVGhlIGVuZ2luZSBmaWx0ZXJzIGlnbm9yZWQgcGF0aHMgaXRzZWxmLlxuICAgIHRoaXMucmVmcyA9IFtcbiAgICAgIHRoaXMudmF1bHQub24oJ2NyZWF0ZScsIChmaWxlOiBUQWJzdHJhY3RGaWxlKSA9PiB7XG4gICAgICAgIHRoaXMuZm9yd2FyZCh7IGtpbmQ6ICdhZGQnLCBwYXRoOiB2YXVsdFBhdGhPZihmaWxlKSB9KTtcbiAgICAgIH0pLFxuICAgICAgdGhpcy52YXVsdC5vbignbW9kaWZ5JywgKGZpbGU6IFRBYnN0cmFjdEZpbGUpID0+IHtcbiAgICAgICAgdGhpcy5mb3J3YXJkKHsga2luZDogJ21vZGlmeScsIHBhdGg6IHZhdWx0UGF0aE9mKGZpbGUpIH0pO1xuICAgICAgfSksXG4gICAgICB0aGlzLnZhdWx0Lm9uKCdkZWxldGUnLCAoZmlsZTogVEFic3RyYWN0RmlsZSkgPT4ge1xuICAgICAgICB0aGlzLmZvcndhcmQoeyBraW5kOiAnZGVsZXRlJywgcGF0aDogdmF1bHRQYXRoT2YoZmlsZSkgfSk7XG4gICAgICB9KSxcbiAgICAgIHRoaXMudmF1bHQub24oJ3JlbmFtZScsIChmaWxlOiBUQWJzdHJhY3RGaWxlLCBvbGRQYXRoOiBzdHJpbmcpID0+IHtcbiAgICAgICAgLy8gYG9sZFBhdGhgIFx1MjE5MiBgZmlsZS5wYXRoYDogdGhlIGVudHJ5IGF0IGBwYXRoYCBtb3ZlZCB0byBgdG9QYXRoYC5cbiAgICAgICAgdGhpcy5mb3J3YXJkKHsga2luZDogJ3JlbmFtZScsIHBhdGg6IGAvJHtvbGRQYXRofWAsIHRvUGF0aDogdmF1bHRQYXRoT2YoZmlsZSkgfSk7XG4gICAgICB9KSxcbiAgICBdO1xuICB9XG5cbiAgc3RvcCgpOiB2b2lkIHtcbiAgICBmb3IgKGNvbnN0IHJlZiBvZiB0aGlzLnJlZnMpIHRoaXMudmF1bHQub2ZmcmVmKHJlZik7XG4gICAgdGhpcy5yZWZzID0gW107XG4gICAgdGhpcy5lbWl0ID0gbnVsbDtcbiAgfVxuXG4gIHByaXZhdGUgZm9yd2FyZChldmVudDogRmlsZUNoYW5nZUV2ZW50KTogdm9pZCB7XG4gICAgdGhpcy5lbWl0Py4oW2V2ZW50XSk7XG4gIH1cbn1cblxuLyoqIFZhdWx0IGV2ZW50IHBhdGggKGFkYXB0ZXItbm9ybWFsaXplZCwgbm8gbGVhZGluZyBzbGFzaCkgXHUyMTkyIGNvcmUgdmF1bHQgcGF0aC4gKi9cbmZ1bmN0aW9uIHZhdWx0UGF0aE9mKGZpbGU6IFRBYnN0cmFjdEZpbGUpOiBzdHJpbmcge1xuICByZXR1cm4gZmlsZS5wYXRoLnN0YXJ0c1dpdGgoJy8nKSA/IGZpbGUucGF0aCA6IGAvJHtmaWxlLnBhdGh9YDtcbn1cblxuLy8gLS0tIFJlc2NhblNjaGVkdWxlciAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIFJlc2NhblNjaGVkdWxlck9wdGlvbnMge1xuICAvKiogUGVyaW9kIGJldHdlZW4gZnVsbCByZXNjYW5zIGluIG1zOyBgMGAgZGlzYWJsZXMgdGhlIHBlcmlvZGljIHRpbWVyLiAqL1xuICBpbnRlcnZhbE1zOiBudW1iZXI7XG4gIC8qKiBEZWJvdW5jZSB3aW5kb3cgZm9yIGBwb2tlKClgIChhY3RpdmUtbGVhZi1jaGFuZ2UpLCBkZWZhdWx0IDMwMDAgbXMuICovXG4gIHBva2VEZWxheU1zPzogbnVtYmVyO1xuICAvKiogSW5qZWN0YWJsZSB0aW1lciBzZWFtcyAodGVzdHMgdXNlIGZha2UgdGltZXJzIGFnYWluc3QgdGhlIGdsb2JhbHMpLiAqL1xuICBzZXRJbnRlcnZhbEltcGw/OiAoZm46ICgpID0+IHZvaWQsIG1zOiBudW1iZXIpID0+IHVua25vd247XG4gIGNsZWFySW50ZXJ2YWxJbXBsPzogKGhhbmRsZTogdW5rbm93bikgPT4gdm9pZDtcbiAgc2V0VGltZW91dEltcGw/OiAoZm46ICgpID0+IHZvaWQsIG1zOiBudW1iZXIpID0+IHVua25vd247XG4gIGNsZWFyVGltZW91dEltcGw/OiAoaGFuZGxlOiB1bmtub3duKSA9PiB2b2lkO1xufVxuXG4vKipcbiAqIERyaXZlcyBwZXJpb2RpYyArIGZvY3VzLXRyaWdnZXJlZCBmdWxsIHJlY29uY2lsaWF0aW9uIGN5Y2xlcy4gTm90IGFcbiAqIGBXYXRjaEFkYXB0ZXJgIGl0c2VsZiBcdTIwMTQgaXRzIGBydW5gIGNhbGxiYWNrIGlzIHdpcmVkIHRvXG4gKiBgU3luY0NsaWVudC50cmlnZ2VyU3luYygpYCBieSB0aGUgcGx1Z2luIChhIHJlc2NhbiBpcyBhIGZ1bGwgY3ljbGUsIG5vdCBhXG4gKiBzaW5nbGUgZmlsZSBldmVudCkuXG4gKi9cbmV4cG9ydCBjbGFzcyBSZXNjYW5TY2hlZHVsZXIge1xuICBwcml2YXRlIHJlYWRvbmx5IHBva2VEZWxheU1zOiBudW1iZXI7XG4gIHByaXZhdGUgcmVhZG9ubHkgc2V0SW50ZXJ2YWxJbXBsOiAoZm46ICgpID0+IHZvaWQsIG1zOiBudW1iZXIpID0+IHVua25vd247XG4gIHByaXZhdGUgcmVhZG9ubHkgY2xlYXJJbnRlcnZhbEltcGw6IChoYW5kbGU6IHVua25vd24pID0+IHZvaWQ7XG4gIHByaXZhdGUgcmVhZG9ubHkgc2V0VGltZW91dEltcGw6IChmbjogKCkgPT4gdm9pZCwgbXM6IG51bWJlcikgPT4gdW5rbm93bjtcbiAgcHJpdmF0ZSByZWFkb25seSBjbGVhclRpbWVvdXRJbXBsOiAoaGFuZGxlOiB1bmtub3duKSA9PiB2b2lkO1xuXG4gIHByaXZhdGUgcnVuOiAoKCkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBpbnRlcnZhbEhhbmRsZTogdW5rbm93biA9IG51bGw7XG4gIHByaXZhdGUgaW50ZXJ2YWxNczogbnVtYmVyO1xuICBwcml2YXRlIHBva2VIYW5kbGU6IHVua25vd24gPSBudWxsO1xuXG4gIGNvbnN0cnVjdG9yKG9wdGlvbnM6IFJlc2NhblNjaGVkdWxlck9wdGlvbnMpIHtcbiAgICB0aGlzLmludGVydmFsTXMgPSBvcHRpb25zLmludGVydmFsTXM7XG4gICAgdGhpcy5wb2tlRGVsYXlNcyA9IG9wdGlvbnMucG9rZURlbGF5TXMgPz8gMzAwMDtcbiAgICB0aGlzLnNldEludGVydmFsSW1wbCA9IG9wdGlvbnMuc2V0SW50ZXJ2YWxJbXBsID8/ICgoZm4sIG1zKSA9PiBzZXRJbnRlcnZhbChmbiwgbXMpKTtcbiAgICB0aGlzLmNsZWFySW50ZXJ2YWxJbXBsID0gb3B0aW9ucy5jbGVhckludGVydmFsSW1wbCA/PyAoKGhhbmRsZSkgPT4gY2xlYXJJbnRlcnZhbChoYW5kbGUgYXMgbnVtYmVyKSk7XG4gICAgdGhpcy5zZXRUaW1lb3V0SW1wbCA9IG9wdGlvbnMuc2V0VGltZW91dEltcGwgPz8gKChmbiwgbXMpID0+IHNldFRpbWVvdXQoZm4sIG1zKSk7XG4gICAgdGhpcy5jbGVhclRpbWVvdXRJbXBsID0gb3B0aW9ucy5jbGVhclRpbWVvdXRJbXBsID8/ICgoaGFuZGxlKSA9PiBjbGVhclRpbWVvdXQoaGFuZGxlIGFzIG51bWJlcikpO1xuICB9XG5cbiAgLyoqIEJlZ2luIHBlcmlvZGljIHJlc2NhbnM7IGBydW5gIG11c3QgYmUgc2FmZSB0byBjYWxsIGF0IGFueSB0aW1lLiAqL1xuICBzdGFydChydW46ICgpID0+IHZvaWQpOiB2b2lkIHtcbiAgICB0aGlzLnN0b3AoKTtcbiAgICB0aGlzLnJ1biA9IHJ1bjtcbiAgICB0aGlzLmFybUludGVydmFsKCk7XG4gIH1cblxuICBzdG9wKCk6IHZvaWQge1xuICAgIHRoaXMuY2xlYXJJbnRlcnZhbEltcGxLZWVwKCk7XG4gICAgaWYgKHRoaXMucG9rZUhhbmRsZSAhPT0gbnVsbCkge1xuICAgICAgdGhpcy5jbGVhclRpbWVvdXRJbXBsKHRoaXMucG9rZUhhbmRsZSk7XG4gICAgICB0aGlzLnBva2VIYW5kbGUgPSBudWxsO1xuICAgIH1cbiAgICB0aGlzLnJ1biA9IG51bGw7XG4gIH1cblxuICAvKiogQ2hhbmdlIHRoZSBwZXJpb2RpYyBpbnRlcnZhbCBsaXZlICh0aGUgc2V0dGluZ3MtdGFiIHRvZ2dsZSkuICovXG4gIHNldEludGVydmFsTXMobXM6IG51bWJlcik6IHZvaWQge1xuICAgIHRoaXMuaW50ZXJ2YWxNcyA9IG1zO1xuICAgIGlmICh0aGlzLnJ1biAhPT0gbnVsbCkge1xuICAgICAgdGhpcy5jbGVhckludGVydmFsSW1wbEtlZXAoKTtcbiAgICAgIHRoaXMuYXJtSW50ZXJ2YWwoKTtcbiAgICB9XG4gIH1cblxuICAvKiogQSBmb2N1cy9hcHAtc3dpdGNoIHNpZ25hbCAoYWN0aXZlLWxlYWYtY2hhbmdlKTogcmVzY2FuIHNvb24sIGNvYWxlc2NlZC4gKi9cbiAgcG9rZSgpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5ydW4gPT09IG51bGwpIHJldHVybjtcbiAgICBpZiAodGhpcy5wb2tlSGFuZGxlICE9PSBudWxsKSByZXR1cm47IC8vIGFscmVhZHkgc2NoZWR1bGVkXG4gICAgdGhpcy5wb2tlSGFuZGxlID0gdGhpcy5zZXRUaW1lb3V0SW1wbCgoKSA9PiB7XG4gICAgICB0aGlzLnBva2VIYW5kbGUgPSBudWxsO1xuICAgICAgdGhpcy5ydW4/LigpO1xuICAgIH0sIHRoaXMucG9rZURlbGF5TXMpO1xuICB9XG5cbiAgZ2V0IGludGVydmFsTXNWYWx1ZSgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLmludGVydmFsTXM7XG4gIH1cblxuICBwcml2YXRlIGFybUludGVydmFsKCk6IHZvaWQge1xuICAgIGlmICh0aGlzLmludGVydmFsTXMgPD0gMCB8fCB0aGlzLnJ1biA9PT0gbnVsbCkgcmV0dXJuO1xuICAgIHRoaXMuaW50ZXJ2YWxIYW5kbGUgPSB0aGlzLnNldEludGVydmFsSW1wbCgoKSA9PiB0aGlzLnJ1bj8uKCksIHRoaXMuaW50ZXJ2YWxNcyk7XG4gIH1cblxuICBwcml2YXRlIGNsZWFySW50ZXJ2YWxJbXBsS2VlcCgpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5pbnRlcnZhbEhhbmRsZSAhPT0gbnVsbCkge1xuICAgICAgdGhpcy5jbGVhckludGVydmFsSW1wbCh0aGlzLmludGVydmFsSGFuZGxlKTtcbiAgICAgIHRoaXMuaW50ZXJ2YWxIYW5kbGUgPSBudWxsO1xuICAgIH1cbiAgfVxufVxuIiwgIi8qKlxuICogYEh0dHBCbG9iU3RvcmVgIFx1MjAxNCBjb3JlJ3MgYEJsb2JTdG9yZWAgYWdhaW5zdCB0aGUgd29ya2VyJ3MgYC9ibG9iLzpoYXNoYFxuICogcm91dGVzIChBUkNISVRFQ1RVUkUgXHUwMEE3NSBIVFRQUyByb3V0ZXMpLCBhdXRoZW50aWNhdGVkIHdpdGggdGhlIGRldmljZSB0b2tlblxuICogYXMgYSBCZWFyZXIgaGVhZGVyLiBCdWlsdCBvbiB0aGUgZ2xvYmFsIGBmZXRjaGAgKE9ic2lkaWFuIGRlc2t0b3AgYW5kXG4gKiBtb2JpbGUpLCBpbmplY3RhYmxlIGZvciB0ZXN0cy4gUGx1Z2luLWxvY2FsIHR3aW4gb2YgdGhlIG5vZGUtcnVudGltZSBvbmU6XG4gKiBubyBpbXBvcnRzIGZyb20gYEB2c2Evbm9kZS1ydW50aW1lYCAoTm9kZS1vbmx5IHBhY2thZ2UpLlxuICovXG5cbmltcG9ydCB0eXBlIHsgQmxvYlN0b3JlIH0gZnJvbSAnQHZzYS9jb3JlJztcblxuLyoqIE5vbi0yeHggYmxvYi1yb3V0ZSByZXBseS4gYHN0YXR1c2AgaXMgdGhlIEhUVFAgc3RhdHVzIGNvZGUuICovXG5leHBvcnQgY2xhc3MgSHR0cEJsb2JFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgY29uc3RydWN0b3IoXG4gICAgcmVhZG9ubHkgc3RhdHVzOiBudW1iZXIsXG4gICAgbWVzc2FnZTogc3RyaW5nLFxuICApIHtcbiAgICBzdXBlcihtZXNzYWdlKTtcbiAgICB0aGlzLm5hbWUgPSAnSHR0cEJsb2JFcnJvcic7XG4gIH1cbn1cblxuZXhwb3J0IGludGVyZmFjZSBIdHRwQmxvYlN0b3JlT3B0aW9ucyB7XG4gIC8qKiBXb3JrZXIgb3JpZ2luLCBlLmcuIGBodHRwczovL3BlcnNvbmFsLngud29ya2Vycy5kZXZgLiAqL1xuICBiYXNlVXJsOiBzdHJpbmc7XG4gIC8qKiBEZXZpY2UgdG9rZW4gKEJlYXJlcikuICovXG4gIHRva2VuOiBzdHJpbmc7XG4gIC8qKiBJbmplY3RhYmxlIGZldGNoICh0ZXN0cykuIERlZmF1bHRzIHRvIHRoZSBnbG9iYWwuICovXG4gIGZldGNoSW1wbD86IHR5cGVvZiBmZXRjaDtcbn1cblxuZXhwb3J0IGNsYXNzIEh0dHBCbG9iU3RvcmUgaW1wbGVtZW50cyBCbG9iU3RvcmUge1xuICBwcml2YXRlIHJlYWRvbmx5IGJhc2U6IHN0cmluZztcbiAgcHJpdmF0ZSByZWFkb25seSB0b2tlbjogc3RyaW5nO1xuICBwcml2YXRlIHJlYWRvbmx5IGRvRmV0Y2g6IHR5cGVvZiBmZXRjaDtcblxuICBjb25zdHJ1Y3RvcihvcHRpb25zOiBIdHRwQmxvYlN0b3JlT3B0aW9ucykge1xuICAgIHRoaXMuYmFzZSA9IG9wdGlvbnMuYmFzZVVybC5yZXBsYWNlKC9cXC8rJC8sICcnKTtcbiAgICB0aGlzLnRva2VuID0gb3B0aW9ucy50b2tlbjtcbiAgICAvLyBCb3VuZCBsaWtlIHRoZSBwbHVnaW4ncyBgZmV0Y2hJbXBsYCBzZWFtOiB0aGlzIGNsYXNzIGNhbGxzIGBkb0ZldGNoYFxuICAgIC8vIGRldGFjaGVkLCBhbmQgYSBiYXJlIGdsb2JhbCBgZmV0Y2hgIGlzIGFuIGlsbGVnYWwgaW52b2NhdGlvbiBpblxuICAgIC8vIENocm9taXVtIHJlbmRlcmVycyAocmVhbCBPYnNpZGlhbikuXG4gICAgdGhpcy5kb0ZldGNoID0gb3B0aW9ucy5mZXRjaEltcGwgPz8gZ2xvYmFsVGhpcy5mZXRjaC5iaW5kKGdsb2JhbFRoaXMpO1xuICB9XG5cbiAgLyoqIEdFVCAvYmxvYi86aGFzaCBcdTIxOTIgYnl0ZXMsIG9yIGB1bmRlZmluZWRgIG9uIDQwNC4gKi9cbiAgYXN5bmMgZ2V0KGhhc2g6IHN0cmluZyk6IFByb21pc2U8VWludDhBcnJheSB8IHVuZGVmaW5lZD4ge1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5kb0ZldGNoKGAke3RoaXMuYmFzZX0vYmxvYi8ke2hhc2h9YCwge1xuICAgICAgaGVhZGVyczogeyBhdXRob3JpemF0aW9uOiBgQmVhcmVyICR7dGhpcy50b2tlbn1gIH0sXG4gICAgfSk7XG4gICAgaWYgKHJlc3BvbnNlLnN0YXR1cyA9PT0gNDA0KSByZXR1cm4gdW5kZWZpbmVkO1xuICAgIGlmICghcmVzcG9uc2Uub2spIHtcbiAgICAgIHRocm93IG5ldyBIdHRwQmxvYkVycm9yKHJlc3BvbnNlLnN0YXR1cywgYXdhaXQgZXJyb3JNZXNzYWdlKHJlc3BvbnNlLCAnZmV0Y2ggYmxvYicpKTtcbiAgICB9XG4gICAgcmV0dXJuIG5ldyBVaW50OEFycmF5KGF3YWl0IHJlc3BvbnNlLmFycmF5QnVmZmVyKCkpO1xuICB9XG5cbiAgLyoqIFBVVCAvYmxvYi86aGFzaCBcdTIwMTQgaWRlbXBvdGVudCBwZXIgdGhlIENBUyBjb250cmFjdC4gKi9cbiAgYXN5bmMgcHV0KGhhc2g6IHN0cmluZywgYnl0ZXM6IFVpbnQ4QXJyYXkpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMuZG9GZXRjaChgJHt0aGlzLmJhc2V9L2Jsb2IvJHtoYXNofWAsIHtcbiAgICAgIG1ldGhvZDogJ1BVVCcsXG4gICAgICBoZWFkZXJzOiB7XG4gICAgICAgIGF1dGhvcml6YXRpb246IGBCZWFyZXIgJHt0aGlzLnRva2VufWAsXG4gICAgICAgICdjb250ZW50LXR5cGUnOiAnYXBwbGljYXRpb24vb2N0ZXQtc3RyZWFtJyxcbiAgICAgIH0sXG4gICAgICBib2R5OiBieXRlcyBhcyBCb2R5SW5pdCxcbiAgICB9KTtcbiAgICBpZiAoIXJlc3BvbnNlLm9rKSB7XG4gICAgICB0aHJvdyBuZXcgSHR0cEJsb2JFcnJvcihyZXNwb25zZS5zdGF0dXMsIGF3YWl0IGVycm9yTWVzc2FnZShyZXNwb25zZSwgJ3N0b3JlIGJsb2InKSk7XG4gICAgfVxuICB9XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGVycm9yTWVzc2FnZShyZXNwb25zZTogUmVzcG9uc2UsIHdoYXQ6IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gIGNvbnN0IGRldGFpbCA9IChhd2FpdCByZXNwb25zZS50ZXh0KCkuY2F0Y2goKCkgPT4gJycpKS5zbGljZSgwLCAzMDApO1xuICByZXR1cm4gZGV0YWlsID09PSAnJ1xuICAgID8gYGZhaWxlZCB0byAke3doYXR9OiBIVFRQICR7cmVzcG9uc2Uuc3RhdHVzfWBcbiAgICA6IGBmYWlsZWQgdG8gJHt3aGF0fTogSFRUUCAke3Jlc3BvbnNlLnN0YXR1c306ICR7ZGV0YWlsfWA7XG59XG4iLCAiLyoqXG4gKiBEaWFnbm9zdGljcyAodGhlIHNldHRpbmdzIHRhYidzIFwiQWR2YW5jZWQgXHUyMTkyIERpYWdub3N0aWNzXCIpOiBhIGJvdW5kZWQgcmluZ1xuICogYnVmZmVyIG92ZXIgdGhlIHBsdWdpbidzIGxvZyBzdHJlYW0gd2l0aCBhIHVzZXItc2VsZWN0YWJsZSBtaW5pbXVtIGxldmVsLFxuICogYSB0cmFuc3BvcnQgd3JhcHBlciB0aGF0IHJlY29yZHMgcHJvdG9jb2wgcm91bmQtdHJpcHMgYXQgZGVidWcgbGV2ZWwgKGxvd1xuICogdm9sdW1lOiBvbmUgc2hvcnQgbGluZSBwZXIgZnJhbWUpLCBhbmQgdGhlIFwiQ29weSBkaWFnbm9zdGljc1wiIGJ1bmRsZS5cbiAqXG4gKiBUaGUgYnVuZGxlIGlzIGEgcGxhaW4tdGV4dCBzbmFwc2hvdCBtZWFudCBmb3IgYnVnIHJlcG9ydHM6IHZlcnNpb25zLFxuICogaWRlbnRpdHksIHdvcmtlciwgYSBjbGllbnQgc3RhdHVzIHNuYXBzaG90LCB0aGUgcGxhdGZvcm0sIGFuZCB0aGUgbGFzdCBOXG4gKiBsb2cgbGluZXMuXG4gKi9cblxuaW1wb3J0IHsgUHJvdG9jb2xWZXJzaW9uIH0gZnJvbSAnQHZzYS9jb3JlJztcbmltcG9ydCB0eXBlIHsgTG9nQWRhcHRlciwgU3luY0NsaWVudFN0YXR1cywgVHJhbnNwb3J0IH0gZnJvbSAnQHZzYS9jb3JlJztcbmltcG9ydCB7IFBsYXRmb3JtIH0gZnJvbSAnb2JzaWRpYW4nO1xuaW1wb3J0IHR5cGUgeyBMb2dMZXZlbCB9IGZyb20gJy4vZGF0YS5qcyc7XG5cbi8qKiBTZXZlcml0eSByYW5raW5nOyBgZXJyb3JgIGFsd2F5cyBvdXRyYW5rcyBldmVyeSBzZWxlY3RhYmxlIGxldmVsLiAqL1xuY29uc3QgTEVWRUxfUkFOSzogUmVjb3JkPExvZ0xldmVsIHwgJ2Vycm9yJywgbnVtYmVyPiA9IHsgZGVidWc6IDEwLCBpbmZvOiAyMCwgd2FybjogMzAsIGVycm9yOiA0MCB9O1xuXG4vKiogTG9nIGxpbmVzIGtlcHQgZm9yIHRoZSBkaWFnbm9zdGljcyBidW5kbGUgKHRoZSBzcGVjJ3MgXCJsYXN0IDIwXCIpLiAqL1xuZXhwb3J0IGNvbnN0IFJJTkdfQ0FQQUNJVFkgPSAyMDtcblxuLyoqIE1heCBjaGFyYWN0ZXJzIG9uZSBhcmd1bWVudCBjb250cmlidXRlcyB0byBhIHJpbmcgbGluZS4gKi9cbmNvbnN0IEFSR19NQVhfQ0hBUlMgPSAzMDA7XG5cbi8qKiBBIGBMb2dBZGFwdGVyYCB3aXRoIGEgbGV2ZWwgZ2F0ZSBhbmQgYSBib3VuZGVkIHJpbmcgYnVmZmVyIGF0dGFjaGVkLiAqL1xuZXhwb3J0IGludGVyZmFjZSBQbHVnaW5Mb2cgZXh0ZW5kcyBMb2dBZGFwdGVyIHtcbiAgLyoqIENoYW5nZSB0aGUgbWluaW11bSByZWNvcmRlZCBsZXZlbCBhdCBydW50aW1lICh0aGUgc2V0dGluZ3MgZHJvcGRvd24pLiAqL1xuICBzZXRMZXZlbChsZXZlbDogTG9nTGV2ZWwpOiB2b2lkO1xuICBnZXRMZXZlbCgpOiBMb2dMZXZlbDtcbiAgLyoqIFdoZXRoZXIgYGRlYnVnYCBjYWxscyBjdXJyZW50bHkgcGFzcyB0aGUgZ2F0ZSAocm91bmQtdHJpcCBsb2dnaW5nIGhvb2spLiAqL1xuICBnZXQgZGVidWdFbmFibGVkKCk6IGJvb2xlYW47XG4gIC8qKiBUaGUgbW9zdCByZWNlbnQgbGluZXMsIG9sZGVzdCBmaXJzdCAoYm91bmRlZCBieSB0aGUgY2FwYWNpdHkpLiAqL1xuICByZWNlbnRMaW5lcygpOiBzdHJpbmdbXTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBQbHVnaW5Mb2dPcHRpb25zIHtcbiAgLyoqIFJpbmcgY2FwYWNpdHkgKGRlZmF1bHQgMjApLiAqL1xuICBjYXBhY2l0eT86IG51bWJlcjtcbiAgLyoqIE1pbmltdW0gcmVjb3JkZWQgbGV2ZWwgKGRlZmF1bHQgJ2luZm8nKS4gKi9cbiAgbGV2ZWw/OiBMb2dMZXZlbDtcbiAgLyoqIFRpbWVzdGFtcCBzZWFtIChkZWZhdWx0IGBEYXRlLm5vd2ApLiAqL1xuICBub3c/OiAoKSA9PiBudW1iZXI7XG59XG5cbi8qKiBCdWlsZCB0aGUgcGx1Z2luJ3MgbG9nIGFkYXB0ZXI6IGNvbnNvbGUgbWlycm9yICsgYm91bmRlZCByaW5nIGJ1ZmZlci4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjcmVhdGVQbHVnaW5Mb2cob3B0aW9uczogUGx1Z2luTG9nT3B0aW9ucyA9IHt9KTogUGx1Z2luTG9nIHtcbiAgY29uc3QgY2FwYWNpdHkgPSBvcHRpb25zLmNhcGFjaXR5ID8/IFJJTkdfQ0FQQUNJVFk7XG4gIGNvbnN0IG5vdyA9IG9wdGlvbnMubm93ID8/ICgoKSA9PiBEYXRlLm5vdygpKTtcbiAgbGV0IGxldmVsOiBMb2dMZXZlbCA9IG9wdGlvbnMubGV2ZWwgPz8gJ2luZm8nO1xuICBsZXQgcmluZzogc3RyaW5nW10gPSBbXTtcblxuICBjb25zdCB3cml0ZSA9IChzZXZlcml0eTogTG9nTGV2ZWwgfCAnZXJyb3InLCBhcmdzOiByZWFkb25seSB1bmtub3duW10pOiB2b2lkID0+IHtcbiAgICBpZiAoTEVWRUxfUkFOS1tzZXZlcml0eV0gPCBMRVZFTF9SQU5LW2xldmVsXSkgcmV0dXJuO1xuICAgIGNvbnN0IGxpbmUgPSBgJHtuZXcgRGF0ZShub3coKSkudG9JU09TdHJpbmcoKX0gWyR7c2V2ZXJpdHl9XSAke2FyZ3MubWFwKGZtdCkuam9pbignICcpfWA7XG4gICAgcmluZy5wdXNoKGxpbmUpO1xuICAgIGlmIChyaW5nLmxlbmd0aCA+IGNhcGFjaXR5KSByaW5nID0gcmluZy5zbGljZShyaW5nLmxlbmd0aCAtIGNhcGFjaXR5KTtcbiAgICBjb25zdCBzaW5rID1cbiAgICAgIHNldmVyaXR5ID09PSAnZXJyb3InID8gY29uc29sZS5lcnJvciA6IHNldmVyaXR5ID09PSAnd2FybicgPyBjb25zb2xlLndhcm4gOiBjb25zb2xlLmxvZztcbiAgICBzaW5rKCdbdnNhXScsIC4uLmFyZ3MpO1xuICB9O1xuXG4gIHJldHVybiB7XG4gICAgZGVidWc6ICguLi5hcmdzOiB1bmtub3duW10pID0+IHdyaXRlKCdkZWJ1ZycsIGFyZ3MpLFxuICAgIGluZm86ICguLi5hcmdzOiB1bmtub3duW10pID0+IHdyaXRlKCdpbmZvJywgYXJncyksXG4gICAgd2FybjogKC4uLmFyZ3M6IHVua25vd25bXSkgPT4gd3JpdGUoJ3dhcm4nLCBhcmdzKSxcbiAgICBlcnJvcjogKC4uLmFyZ3M6IHVua25vd25bXSkgPT4gd3JpdGUoJ2Vycm9yJywgYXJncyksXG4gICAgc2V0TGV2ZWwobmV4dDogTG9nTGV2ZWwpOiB2b2lkIHtcbiAgICAgIGxldmVsID0gbmV4dDtcbiAgICB9LFxuICAgIGdldExldmVsKCk6IExvZ0xldmVsIHtcbiAgICAgIHJldHVybiBsZXZlbDtcbiAgICB9LFxuICAgIGdldCBkZWJ1Z0VuYWJsZWQoKTogYm9vbGVhbiB7XG4gICAgICByZXR1cm4gbGV2ZWwgPT09ICdkZWJ1Zyc7XG4gICAgfSxcbiAgICByZWNlbnRMaW5lcygpOiBzdHJpbmdbXSB7XG4gICAgICByZXR1cm4gWy4uLnJpbmddO1xuICAgIH0sXG4gIH07XG59XG5cbi8qKiBPbmUgbG9nIGFyZ3VtZW50IFx1MjE5MiBjb21wYWN0IHRleHQgKHN0cmluZ3MgcGFzcyB0aHJvdWdoLCBsb25nIHZhbHVlcyB0cnVuY2F0ZWQpLiAqL1xuZnVuY3Rpb24gZm10KHZhbHVlOiB1bmtub3duKTogc3RyaW5nIHtcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ3N0cmluZycpIHJldHVybiB0cnVuY2F0ZSh2YWx1ZSk7XG4gIGlmICh2YWx1ZSBpbnN0YW5jZW9mIEVycm9yKSByZXR1cm4gdHJ1bmNhdGUoYCR7dmFsdWUubmFtZX06ICR7dmFsdWUubWVzc2FnZX1gKTtcbiAgdHJ5IHtcbiAgICByZXR1cm4gdHJ1bmNhdGUoSlNPTi5zdHJpbmdpZnkodmFsdWUpID8/IFN0cmluZyh2YWx1ZSkpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gU3RyaW5nKHZhbHVlKTtcbiAgfVxufVxuXG5mdW5jdGlvbiB0cnVuY2F0ZSh0ZXh0OiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gdGV4dC5sZW5ndGggPD0gQVJHX01BWF9DSEFSUyA/IHRleHQgOiBgJHt0ZXh0LnNsaWNlKDAsIEFSR19NQVhfQ0hBUlMgLSAxKX1cdTIwMjZgO1xufVxuXG4vLyAtLS0gcHJvdG9jb2wgcm91bmQtdHJpcCBsb2dnaW5nIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogQ29tcGFjdCwgbG93LXZvbHVtZSBkZXNjcmlwdGlvbiBvZiBhIHdpcmUgZnJhbWUgKHR5cGUgKyBpZGVudGl0eSBrZXlzKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkZXNjcmliZU1lc3NhZ2UobWVzc2FnZToge1xuICB0eXBlOiBzdHJpbmc7XG4gIHBhdGg/OiBzdHJpbmc7XG4gIGhhc2g/OiBzdHJpbmc7XG4gIGZyb21QYXRoPzogc3RyaW5nO1xuICBjdXJzb3I/OiBudW1iZXI7XG4gIHNlcT86IG51bWJlcjtcbn0pOiBzdHJpbmcge1xuICBjb25zdCBiaXRzID0gW21lc3NhZ2UudHlwZV07XG4gIGlmIChtZXNzYWdlLmZyb21QYXRoICE9PSB1bmRlZmluZWQpIGJpdHMucHVzaChgJHttZXNzYWdlLmZyb21QYXRofSBcdTIxOTJgKTtcbiAgaWYgKG1lc3NhZ2UucGF0aCAhPT0gdW5kZWZpbmVkKSBiaXRzLnB1c2gobWVzc2FnZS5wYXRoKTtcbiAgaWYgKG1lc3NhZ2UuaGFzaCAhPT0gdW5kZWZpbmVkKSBiaXRzLnB1c2gobWVzc2FnZS5oYXNoLnNsaWNlKDAsIDEyKSk7XG4gIGlmIChtZXNzYWdlLnNlcSAhPT0gdW5kZWZpbmVkKSBiaXRzLnB1c2goYHNlcSAke21lc3NhZ2Uuc2VxfWApO1xuICBpZiAobWVzc2FnZS5jdXJzb3IgIT09IHVuZGVmaW5lZCkgYml0cy5wdXNoKGBjdXJzb3IgJHttZXNzYWdlLmN1cnNvcn1gKTtcbiAgcmV0dXJuIGJpdHMuam9pbignICcpO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFJvdW5kVHJpcExvZ2dpbmdPcHRpb25zIHtcbiAgbG9nOiBMb2dBZGFwdGVyO1xuICAvKiogQ2hlYXAgcHJlLWNoZWNrIHNvIHRoZSBzdHJpbmcgYnVpbGRpbmcgaXMgc2tpcHBlZCB1bmxlc3MgZGVidWcgaXMgb24uICovXG4gIHNob3VsZExvZzogKCkgPT4gYm9vbGVhbjtcbn1cblxuLyoqXG4gKiBXcmFwIGEgYFRyYW5zcG9ydGAgc28gZXZlcnkgc2VudC9yZWNlaXZlZCBmcmFtZSBpcyBsb2dnZWQgYXQgZGVidWcgbGV2ZWwgXHUyMDE0XG4gKiBvbmUgc2hvcnQgbGluZSBwZXIgZnJhbWUgKGBkZXNjcmliZU1lc3NhZ2VgKSwgbm90aGluZyBhdCBvdGhlciBsZXZlbHMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiB3aXRoUm91bmRUcmlwTG9nZ2luZyhcbiAgdHJhbnNwb3J0OiBUcmFuc3BvcnQsXG4gIG9wdGlvbnM6IFJvdW5kVHJpcExvZ2dpbmdPcHRpb25zLFxuKTogVHJhbnNwb3J0IHtcbiAgY29uc3QgeyBsb2csIHNob3VsZExvZyB9ID0gb3B0aW9ucztcbiAgcmV0dXJuIHtcbiAgICBzZW5kOiAobWVzc2FnZSkgPT4ge1xuICAgICAgaWYgKHNob3VsZExvZygpKSBsb2cuZGVidWcoJ1x1MjE5MicsIGRlc2NyaWJlTWVzc2FnZShtZXNzYWdlKSk7XG4gICAgICB0cmFuc3BvcnQuc2VuZChtZXNzYWdlKTtcbiAgICB9LFxuICAgIG9uTWVzc2FnZTogKGNhbGxiYWNrKSA9PiB7XG4gICAgICB0cmFuc3BvcnQub25NZXNzYWdlKChtZXNzYWdlKSA9PiB7XG4gICAgICAgIGlmIChzaG91bGRMb2coKSkgbG9nLmRlYnVnKCdcdTIxOTAnLCBkZXNjcmliZU1lc3NhZ2UobWVzc2FnZSkpO1xuICAgICAgICBjYWxsYmFjayhtZXNzYWdlKTtcbiAgICAgIH0pO1xuICAgIH0sXG4gICAgb25DbG9zZTogKGNhbGxiYWNrKSA9PiB0cmFuc3BvcnQub25DbG9zZShjYWxsYmFjayksXG4gICAgY2xvc2U6ICgpID0+IHRyYW5zcG9ydC5jbG9zZSgpLFxuICB9O1xufVxuXG4vLyAtLS0gdGhlIGJ1bmRsZSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgaW50ZXJmYWNlIERpYWdub3N0aWNzSW5wdXQge1xuICBwbHVnaW5WZXJzaW9uOiBzdHJpbmc7XG4gIGRldmljZUlkOiBzdHJpbmc7XG4gIGRldmljZU5hbWU6IHN0cmluZztcbiAgd29ya2VyVXJsOiBzdHJpbmc7XG4gIHBhaXJlZDogYm9vbGVhbjtcbiAgcGF1c2VkOiBib29sZWFuO1xuICBjbGllbnRTdGF0dXM6IFN5bmNDbGllbnRTdGF0dXMgfCBudWxsO1xuICByZWNlbnRMb2dMaW5lczogcmVhZG9ubHkgc3RyaW5nW107XG59XG5cbi8qKiBUaGUgcHJvdG9jb2wgdmVyc2lvbiBmcm9tIGNvcmUsIHN1cmZhY2VkIGZvciB0aGUgYnVuZGxlL0Fib3V0IHNlY3Rpb24uICovXG5leHBvcnQgY29uc3QgUFJPVE9DT0xfVkVSU0lPTiA9IFByb3RvY29sVmVyc2lvbjtcblxuLyoqIFRoZSBjb3B5YWJsZSBkaWFnbm9zdGljcyBidW5kbGUgKHBsYWluIHRleHQsIGJ1Zy1yZXBvcnQgZnJpZW5kbHkpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkRGlhZ25vc3RpY3NCdW5kbGUoaW5wdXQ6IERpYWdub3N0aWNzSW5wdXQpOiBzdHJpbmcge1xuICBjb25zdCBzdGF0dXMgPSBpbnB1dC5jbGllbnRTdGF0dXM7XG4gIGNvbnN0IGxpbmVzOiBzdHJpbmdbXSA9IFtcbiAgICAnVmF1bHRTeW5jIGZvciBBZ2VudHMgXHUyMDE0IGRpYWdub3N0aWNzJyxcbiAgICBgUGx1Z2luIHZlcnNpb246ICR7aW5wdXQucGx1Z2luVmVyc2lvbn1gLFxuICAgIGBQcm90b2NvbCB2ZXJzaW9uOiAke1Byb3RvY29sVmVyc2lvbn1gLFxuICAgIGBEZXZpY2U6ICR7aW5wdXQuZGV2aWNlSWQgfHwgJyh1bmFzc2lnbmVkKSd9JHtpbnB1dC5kZXZpY2VOYW1lID8gYCAoJHtpbnB1dC5kZXZpY2VOYW1lfSlgIDogJyd9YCxcbiAgICBgV29ya2VyOiAke2lucHV0LndvcmtlclVybCB8fCAnKG5vdCBjb25maWd1cmVkKSd9YCxcbiAgICBgUGFpcmluZzogJHtpbnB1dC5wYWlyZWQgPyAncGFpcmVkJyA6ICdub3QgcGFpcmVkJ31gLFxuICAgIGlucHV0LnBhdXNlZFxuICAgICAgPyAnU3luYzogcGF1c2VkJ1xuICAgICAgOiBzdGF0dXMgPT09IG51bGxcbiAgICAgICAgPyAnU3luYzogbm90IHJ1bm5pbmcnXG4gICAgICAgIDogYFN5bmM6ICR7c3RhdHVzLnN0YXRlfSwgbGFzdCBzeW5jICR7XG4gICAgICAgICAgICBzdGF0dXMubGFzdFN5bmNBdCA9PT0gbnVsbCA/ICduZXZlcicgOiBgJHtNYXRoLm1heCgwLCBEYXRlLm5vdygpIC0gc3RhdHVzLmxhc3RTeW5jQXQpfW1zIGFnb2BcbiAgICAgICAgICB9LCBwZW5kaW5nICR7c3RhdHVzLnBlbmRpbmd9LCBjb25mbGljdHMgJHtzdGF0dXMuY29uZmxpY3RzLmxlbmd0aH1gLFxuICAgIGBQbGF0Zm9ybTogJHtwbGF0Zm9ybVN1bW1hcnkoKX1gLFxuICAgIGBSZWNlbnQgbG9nIChsYXN0ICR7aW5wdXQucmVjZW50TG9nTGluZXMubGVuZ3RofSBsaW5lcyk6YCxcbiAgXTtcbiAgaWYgKGlucHV0LnJlY2VudExvZ0xpbmVzLmxlbmd0aCA9PT0gMCkge1xuICAgIGxpbmVzLnB1c2goJyAgKG5vIHJlY29yZGVkIGxvZyBsaW5lcyknKTtcbiAgfSBlbHNlIHtcbiAgICBmb3IgKGNvbnN0IGxpbmUgb2YgaW5wdXQucmVjZW50TG9nTGluZXMpIGxpbmVzLnB1c2goYCAgJHtsaW5lfWApO1xuICB9XG4gIHJldHVybiBsaW5lcy5qb2luKCdcXG4nKTtcbn1cblxuLyoqIEh1bWFuIHBsYXRmb3JtIHN1bW1hcnkgZnJvbSBgUGxhdGZvcm1gIChtb2JpbGUgdnMgZGVza3RvcCwgT1MsIGZvcm0gZmFjdG9yKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwbGF0Zm9ybVN1bW1hcnkoKTogc3RyaW5nIHtcbiAgaWYgKFBsYXRmb3JtLmlzTW9iaWxlQXBwKSB7XG4gICAgY29uc3Qgb3MgPSBQbGF0Zm9ybS5pc0lvc0FwcCA/ICdpT1MnIDogUGxhdGZvcm0uaXNBbmRyb2lkQXBwID8gJ0FuZHJvaWQnIDogJ3Vua25vd24gT1MnO1xuICAgIGNvbnN0IGZhY3RvciA9IFBsYXRmb3JtLmlzVGFibGV0ID8gJ3RhYmxldCcgOiBQbGF0Zm9ybS5pc1Bob25lID8gJ3Bob25lJyA6ICdkZXZpY2UnO1xuICAgIHJldHVybiBgT2JzaWRpYW4gbW9iaWxlIGFwcCAoJHtvc30sICR7ZmFjdG9yfSlgO1xuICB9XG4gIHJldHVybiAnT2JzaWRpYW4gZGVza3RvcCBhcHAnO1xufVxuXG4vKiogQmVzdC1lZmZvcnQgY2xpcGJvYXJkIHdyaXRlOyByZXNvbHZlcyBmYWxzZSB3aGVyZSB0aGUgY2xpcGJvYXJkIGlzIHVuYXZhaWxhYmxlLiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNvcHlUb0NsaXBib2FyZCh0ZXh0OiBzdHJpbmcpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgY29uc3QgY2xpcGJvYXJkID0gKGdsb2JhbFRoaXMgYXMgeyBuYXZpZ2F0b3I/OiB7IGNsaXBib2FyZD86IHsgd3JpdGVUZXh0Pyh0OiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IH0gfSB9KVxuICAgIC5uYXZpZ2F0b3I/LmNsaXBib2FyZDtcbiAgaWYgKGNsaXBib2FyZD8ud3JpdGVUZXh0ID09PSB1bmRlZmluZWQpIHJldHVybiBmYWxzZTtcbiAgdHJ5IHtcbiAgICBhd2FpdCBjbGlwYm9hcmQud3JpdGVUZXh0KHRleHQpO1xuICAgIHJldHVybiB0cnVlO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuLyoqIEJ5dGVzIFx1MjE5MiBodW1hbiB0ZXh0IChgNzMwIEJgLCBgMS4yIE1CYCkuICovXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0Qnl0ZXMoYnl0ZXM6IG51bWJlcik6IHN0cmluZyB7XG4gIGlmIChieXRlcyA8IDEwMjQpIHJldHVybiBgJHtieXRlc30gQmA7XG4gIGNvbnN0IHVuaXRzID0gWydLQicsICdNQicsICdHQicsICdUQiddO1xuICBsZXQgdmFsdWUgPSBieXRlcztcbiAgbGV0IHVuaXQgPSAtMTtcbiAgZG8ge1xuICAgIHZhbHVlIC89IDEwMjQ7XG4gICAgdW5pdCArPSAxO1xuICB9IHdoaWxlICh2YWx1ZSA+PSAxMDI0ICYmIHVuaXQgPCB1bml0cy5sZW5ndGggLSAxKTtcbiAgcmV0dXJuIGAke3ZhbHVlID49IDEwMCA/IE1hdGgucm91bmQodmFsdWUpIDogdmFsdWUudG9GaXhlZCgxKX0gJHt1bml0c1t1bml0XX1gO1xufVxuIiwgIi8qKlxuICogVGhlIHBsdWdpbidzIHBlcnNpc3RlZCBzdGF0ZSAoYGRhdGEuanNvbmAsIHZpYSBgUGx1Z2luLmxvYWREYXRhL3NhdmVEYXRhYCkuXG4gKlxuICogS2VwdCBkZWxpYmVyYXRlbHkgc21hbGw6IGxpbmsgaWRlbnRpdHkgKHVybC90b2tlbi9kZXZpY2VJZC9kZXZpY2VOYW1lKSBwbHVzXG4gKiB0aGUgdHdvIGNsaWVudC1zaWRlIHRvZ2dsZXMuIFRoZSB0b2tlbiBpcyB0aGUgZGV2aWNlJ3MgbG9uZy1saXZlZFxuICogY3JlZGVudGlhbCAoQVJDSElURUNUVVJFIFx1MDBBNzMpIFx1MjAxNCBPYnNpZGlhbiBzdG9yZXMgZGF0YS5qc29uIGluc2lkZSB0aGUgdmF1bHQnc1xuICogYC5vYnNpZGlhbi9wbHVnaW5zL2AgZGlyLCB3aGljaCBzeW5jIGV4Y2x1ZGVzLCBzbyBpdCBuZXZlciBsZWF2ZXMgdGhlXG4gKiBtYWNoaW5lIHRocm91Z2ggc3luYyBpdHNlbGYuXG4gKi9cblxuaW1wb3J0IHsgUGxhdGZvcm0gfSBmcm9tICdvYnNpZGlhbic7XG5pbXBvcnQgdHlwZSB7IFN0YXR1c0Jhck1vZGUgfSBmcm9tICcuL3N0YXR1c2Jhci5qcyc7XG5cbi8qKiBEaWFnbm9zdGljcyBsb2cgbGV2ZWwgKHRoZSBcIkRpYWdub3N0aWNzXCIgc2V0dGluZ3MgZHJvcGRvd24pLiAqL1xuZXhwb3J0IHR5cGUgTG9nTGV2ZWwgPSAnaW5mbycgfCAnZGVidWcnIHwgJ3dhcm4nO1xuXG4vKiogQ2xpZW50LXNpZGUgc3luYyBiZWhhdmlvciBzZXR0aW5ncyAodGhlIHNldHRpbmdzLXRhYiB0b2dnbGVzKS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUGx1Z2luU3luY1NldHRpbmdzIHtcbiAgLyoqXG4gICAqIFBlcmlvZGljIGZ1bGwtcmVzY2FuIGludGVydmFsIGluIHNlY29uZHMgKEFSQ0hJVEVDVFVSRSBcdTAwQTc4IG1vYmlsZSAvXG4gICAqIGV4dGVybmFsIGVkaXRzKS4gYDBgIGRpc2FibGVzIHRoZSB0aW1lciBcdTIwMTQgdmF1bHQgZXZlbnRzIGFuZCBhcHAtb3BlblxuICAgKiByZWNvbmNpbGlhdGlvbiBzdGlsbCBydW4uXG4gICAqL1xuICByZXNjYW5JbnRlcnZhbFNlYzogbnVtYmVyO1xuICAvKipcbiAgICogT3B0IGluIHRvIHN5bmNpbmcgYC5vYnNpZGlhbi9gIChGUi0xMSkuIFRoaXMgaXMgdGhlIGNsaWVudC1zaWRlIGluaXRpYWxcbiAgICogaWdub3JlIHNldHRpbmc7IHRoZSB3b3JrZXIncyBwZXItdmF1bHQgYFZhdWx0U2V0dGluZ3Mub2JzaWRpYW5TeW5jYFxuICAgKiAoZGVsaXZlcmVkIGluIGBoZWxsb0Fja2ApIHN1cGVyc2VkZXMgaXQgb25jZSBjb25uZWN0ZWQuXG4gICAqL1xuICBvYnNpZGlhblN5bmM6IGJvb2xlYW47XG4gIC8qKiBTdGF0dXMtYmFyIGluZGljYXRvcjogZnVsbCB0ZXh0LCBhIGNvbXBhY3Qgc3ltYm9sLCBvciBubyBpdGVtIGF0IGFsbC4gKi9cbiAgc3RhdHVzQmFyTW9kZTogU3RhdHVzQmFyTW9kZTtcbiAgLyoqXG4gICAqIFN0YXJ0IHN5bmNpbmcgd2hlbiBPYnNpZGlhbiBsb2FkcyAoZGVmYXVsdCkuIE9GRiA9IG1hbnVhbC1vbmx5IG1vZGU6IHRoZVxuICAgKiBwbHVnaW4gbG9hZHMgaWRsZSBhbmQgdGhlIGZpcnN0IFwiU3luYyBub3dcIiBzdGFydHMgaXQuXG4gICAqL1xuICBzeW5jT25TdGFydHVwOiBib29sZWFuO1xuICAvKiogRGlhZ25vc3RpY3MgbG9nIGxldmVsOyBgZGVidWdgIGFsc28gbG9ncyBwcm90b2NvbCByb3VuZC10cmlwcy4gKi9cbiAgbG9nTGV2ZWw6IExvZ0xldmVsO1xuICAvKiogUmF3IGlnbm9yZS1wYXR0ZXJuIHRleHQsIG9uZSBwYXR0ZXJuIHBlciBsaW5lIChzZWUgYHBhcnNlSWdub3JlUGF0dGVybnNgKS4gKi9cbiAgaWdub3JlUGF0dGVybnM6IHN0cmluZztcbn1cblxuLyoqIFNoYXBlIG9mIHRoZSBwbHVnaW4ncyBgZGF0YS5qc29uYC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVmF1bHRTeW5jUGx1Z2luRGF0YSB7XG4gIC8qKiBXb3JrZXIgb3JpZ2luLCBlLmcuIGBodHRwczovL3BlcnNvbmFsLngud29ya2Vycy5kZXZgIChlbXB0eSBwcmUtcGFpcikuICovXG4gIHVybDogc3RyaW5nO1xuICAvKiogTG9uZy1saXZlZCBkZXZpY2UgdG9rZW4gKGVtcHR5IHByZS1wYWlyKS4gKi9cbiAgdG9rZW46IHN0cmluZztcbiAgLyoqIERldmljZSBpZCBhc3NpZ25lZCBieSB0aGUgd29ya2VyIGF0IHBhaXIgdGltZS4gKi9cbiAgZGV2aWNlSWQ6IHN0cmluZztcbiAgLyoqIEh1bWFuLXJlYWRhYmxlIGRldmljZSBuYW1lIHNob3duIGluIHRoZSBkYXNoYm9hcmQncyBkZXZpY2UgbGlzdC4gKi9cbiAgZGV2aWNlTmFtZTogc3RyaW5nO1xuICBzZXR0aW5nczogUGx1Z2luU3luY1NldHRpbmdzO1xufVxuXG5leHBvcnQgY29uc3QgREVGQVVMVF9SRVNDQU5fSU5URVJWQUxfU0VDID0gMzA7XG5cbi8qKiBDaG9pY2VzIG9mZmVyZWQgYnkgdGhlIHNldHRpbmdzIGRyb3Bkb3duOiBzZWNvbmRzIFx1MjE5MiBsYWJlbC4gKi9cbmV4cG9ydCBjb25zdCBSRVNDQU5fSU5URVJWQUxfQ0hPSUNFUzogUmVhZG9ubHlBcnJheTx7IHZhbHVlOiBudW1iZXI7IGxhYmVsOiBzdHJpbmcgfT4gPSBbXG4gIHsgdmFsdWU6IDEwLCBsYWJlbDogJ0V2ZXJ5IDEwIHNlY29uZHMnIH0sXG4gIHsgdmFsdWU6IDMwLCBsYWJlbDogJ0V2ZXJ5IDMwIHNlY29uZHMnIH0sXG4gIHsgdmFsdWU6IDYwLCBsYWJlbDogJ0V2ZXJ5IG1pbnV0ZScgfSxcbiAgeyB2YWx1ZTogMzAwLCBsYWJlbDogJ0V2ZXJ5IDUgbWludXRlcycgfSxcbiAgeyB2YWx1ZTogMCwgbGFiZWw6ICdPZmYgKHZhdWx0IGV2ZW50cyBvbmx5KScgfSxcbl07XG5cbmV4cG9ydCBmdW5jdGlvbiBkZWZhdWx0UGx1Z2luRGF0YSgpOiBWYXVsdFN5bmNQbHVnaW5EYXRhIHtcbiAgcmV0dXJuIHtcbiAgICB1cmw6ICcnLFxuICAgIHRva2VuOiAnJyxcbiAgICBkZXZpY2VJZDogJycsXG4gICAgZGV2aWNlTmFtZTogJycsXG4gICAgc2V0dGluZ3M6IHtcbiAgICAgIHJlc2NhbkludGVydmFsU2VjOiBERUZBVUxUX1JFU0NBTl9JTlRFUlZBTF9TRUMsXG4gICAgICBvYnNpZGlhblN5bmM6IGZhbHNlLFxuICAgICAgc3RhdHVzQmFyTW9kZTogJ2RldGFpbGVkJyxcbiAgICAgIHN5bmNPblN0YXJ0dXA6IHRydWUsXG4gICAgICBsb2dMZXZlbDogJ2luZm8nLFxuICAgICAgaWdub3JlUGF0dGVybnM6ICcnLFxuICAgIH0sXG4gIH07XG59XG5cbi8qKiBDb2VyY2Ugd2hhdGV2ZXIgYGxvYWREYXRhKClgIHJldHVybmVkIGludG8gYSB3ZWxsLWZvcm1lZCBvYmplY3QuICovXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplUGx1Z2luRGF0YShyYXc6IHVua25vd24pOiBWYXVsdFN5bmNQbHVnaW5EYXRhIHtcbiAgY29uc3QgYmFzZSA9IGRlZmF1bHRQbHVnaW5EYXRhKCk7XG4gIGlmICh0eXBlb2YgcmF3ICE9PSAnb2JqZWN0JyB8fCByYXcgPT09IG51bGwpIHJldHVybiBiYXNlO1xuICBjb25zdCBzb3VyY2UgPSByYXcgYXMgUGFydGlhbDxWYXVsdFN5bmNQbHVnaW5EYXRhPiAmIHsgc2V0dGluZ3M/OiBQYXJ0aWFsPFBsdWdpblN5bmNTZXR0aW5ncz4gfTtcbiAgY29uc3Qgc3RhdHVzQmFyTW9kZSA9IHNvdXJjZS5zZXR0aW5ncz8uc3RhdHVzQmFyTW9kZTtcbiAgY29uc3QgbG9nTGV2ZWwgPSBzb3VyY2Uuc2V0dGluZ3M/LmxvZ0xldmVsO1xuICByZXR1cm4ge1xuICAgIHVybDogdHlwZW9mIHNvdXJjZS51cmwgPT09ICdzdHJpbmcnID8gc291cmNlLnVybCA6ICcnLFxuICAgIHRva2VuOiB0eXBlb2Ygc291cmNlLnRva2VuID09PSAnc3RyaW5nJyA/IHNvdXJjZS50b2tlbiA6ICcnLFxuICAgIGRldmljZUlkOiB0eXBlb2Ygc291cmNlLmRldmljZUlkID09PSAnc3RyaW5nJyA/IHNvdXJjZS5kZXZpY2VJZCA6ICcnLFxuICAgIGRldmljZU5hbWU6IHR5cGVvZiBzb3VyY2UuZGV2aWNlTmFtZSA9PT0gJ3N0cmluZycgPyBzb3VyY2UuZGV2aWNlTmFtZSA6ICcnLFxuICAgIHNldHRpbmdzOiB7XG4gICAgICByZXNjYW5JbnRlcnZhbFNlYzpcbiAgICAgICAgdHlwZW9mIHNvdXJjZS5zZXR0aW5ncz8ucmVzY2FuSW50ZXJ2YWxTZWMgPT09ICdudW1iZXInICYmIHNvdXJjZS5zZXR0aW5ncy5yZXNjYW5JbnRlcnZhbFNlYyA+PSAwXG4gICAgICAgICAgPyBNYXRoLmZsb29yKHNvdXJjZS5zZXR0aW5ncy5yZXNjYW5JbnRlcnZhbFNlYylcbiAgICAgICAgICA6IERFRkFVTFRfUkVTQ0FOX0lOVEVSVkFMX1NFQyxcbiAgICAgIG9ic2lkaWFuU3luYzogc291cmNlLnNldHRpbmdzPy5vYnNpZGlhblN5bmMgPT09IHRydWUsXG4gICAgICBzdGF0dXNCYXJNb2RlOlxuICAgICAgICBzdGF0dXNCYXJNb2RlID09PSAnY29tcGFjdCcgfHwgc3RhdHVzQmFyTW9kZSA9PT0gJ2hpZGRlbicgPyBzdGF0dXNCYXJNb2RlIDogJ2RldGFpbGVkJyxcbiAgICAgIHN5bmNPblN0YXJ0dXA6IHNvdXJjZS5zZXR0aW5ncz8uc3luY09uU3RhcnR1cCAhPT0gZmFsc2UsXG4gICAgICBsb2dMZXZlbDogbG9nTGV2ZWwgPT09ICdkZWJ1ZycgfHwgbG9nTGV2ZWwgPT09ICd3YXJuJyA/IGxvZ0xldmVsIDogJ2luZm8nLFxuICAgICAgaWdub3JlUGF0dGVybnM6IHR5cGVvZiBzb3VyY2Uuc2V0dGluZ3M/Lmlnbm9yZVBhdHRlcm5zID09PSAnc3RyaW5nJyA/IHNvdXJjZS5zZXR0aW5ncy5pZ25vcmVQYXR0ZXJucyA6ICcnLFxuICAgIH0sXG4gIH07XG59XG5cbi8qKlxuICogSWdub3JlLXBhdHRlcm4gdGV4dCBcdTIxOTIgcGF0dGVybiBsaXN0OiBvbmUgcGF0dGVybiBwZXIgbGluZSwgdHJpbW1lZCwgYmxhbmtcbiAqIGxpbmVzIGRyb3BwZWQuIFB1cmUgXHUyMDE0IHNhZmUgdG8gY2FsbCBvbiBldmVyeSBgc3RhcnRTeW5jYC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlSWdub3JlUGF0dGVybnModGV4dDogc3RyaW5nKTogc3RyaW5nW10ge1xuICByZXR1cm4gdGV4dFxuICAgIC5zcGxpdCgvXFxyP1xcbi8pXG4gICAgLm1hcCgobGluZSkgPT4gbGluZS50cmltKCkpXG4gICAgLmZpbHRlcigobGluZSkgPT4gbGluZSAhPT0gJycpO1xufVxuXG4vKiogQSB2YXVsdCBpcyBsaW5rZWQgaWZmIHBhaXIgaWRlbnRpdHkgaXMgY29tcGxldGUuICovXG5leHBvcnQgZnVuY3Rpb24gaXNMaW5rZWQoZGF0YTogVmF1bHRTeW5jUGx1Z2luRGF0YSk6IGJvb2xlYW4ge1xuICByZXR1cm4gZGF0YS51cmwgIT09ICcnICYmIGRhdGEudG9rZW4gIT09ICcnICYmIGRhdGEuZGV2aWNlSWQgIT09ICcnO1xufVxuXG4vKiogRGV2aWNlIHR5cGUgZm9yIHRoZSB3b3JrZXIgcmVnaXN0cnksIGZyb20gdGhlIHBsYXRmb3JtIChGUi0yMykuICovXG5leHBvcnQgZnVuY3Rpb24gZGV0ZWN0RGV2aWNlVHlwZSgpOiAnZGVza3RvcCcgfCAnbW9iaWxlJyB7XG4gIHJldHVybiBQbGF0Zm9ybS5pc01vYmlsZUFwcCA/ICdtb2JpbGUnIDogJ2Rlc2t0b3AnO1xufVxuXG4vKiogRGVmYXVsdCBkZXZpY2UgbmFtZSB3aGVuIHRoZSB1c2VyIGhhcyBub3QgdHlwZWQgb25lLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRlZmF1bHREZXZpY2VOYW1lKCk6IHN0cmluZyB7XG4gIGlmIChQbGF0Zm9ybS5pc01vYmlsZUFwcCkge1xuICAgIGlmIChQbGF0Zm9ybS5pc0lvc0FwcCkgcmV0dXJuICdpUGhvbmUvaVBhZCc7XG4gICAgaWYgKFBsYXRmb3JtLmlzQW5kcm9pZEFwcCkgcmV0dXJuICdBbmRyb2lkJztcbiAgICByZXR1cm4gJ09ic2lkaWFuIG1vYmlsZSc7XG4gIH1cbiAgcmV0dXJuICdPYnNpZGlhbiBkZXNrdG9wJztcbn1cbiIsICIvKipcbiAqIE1pbmltYWwgdHlwZWQgY2xpZW50IGZvciB0aGUgd29ya2VyJ3MgSFRUUCBzdXJmYWNlIGFzIHRoZSBwbHVnaW4gdXNlcyBpdDpcbiAqIGBHRVQgL2hlYWx0aGAgKGNsYWltLXN0YXRlIHByb2JlIGJlZm9yZSBwYWlyaW5nKSwgYFBPU1QgL3BhaXJgIChyZWRlZW0gYVxuICogcGFpcmluZyBjb2RlLCBBUkNISVRFQ1RVUkUgXHUwMEE3MyksIGBQQVRDSCAvZGV2aWNlYCAoZGV2aWNlIHNlbGYtc2VydmljZVxuICogcmVuYW1lKSwgYW5kIGBHRVQgL2FwaS9zdGF0dXNgIChzdG9yYWdlL2RldmljZSBzdW1tYXJ5IGZvciBBYm91dCkuIEJ1aWx0XG4gKiBvbiBhbiBpbmplY3RhYmxlIGBmZXRjaGA7IGZhaWx1cmVzIG1hcCB0byB0eXBlZCBlcnJvcnMgd2l0aCBhY3Rpb25hYmxlXG4gKiBtZXNzYWdlcyBzbyB0aGUgc2V0dGluZ3MgVUkgYW5kIHRoZSBkZWVwLWxpbmsgaGFuZGxlciBuZXZlciBzZWUgYSByYXdcbiAqIGBUeXBlRXJyb3I6IEZhaWxlZCB0byBmZXRjaGAuXG4gKi9cblxuLyoqIEEgd29ya2VyIGNhbGwgZmFpbGVkICh1bnJlYWNoYWJsZSBvciB1bmV4cGVjdGVkIEhUVFApLiAqL1xuZXhwb3J0IGNsYXNzIFdvcmtlckFwaUVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBjb25zdHJ1Y3RvcihcbiAgICBtZXNzYWdlOiBzdHJpbmcsXG4gICAgcmVhZG9ubHkgc3RhdHVzPzogbnVtYmVyLFxuICApIHtcbiAgICBzdXBlcihtZXNzYWdlKTtcbiAgICB0aGlzLm5hbWUgPSAnV29ya2VyQXBpRXJyb3InO1xuICB9XG59XG5cbi8qKiBUaGUgcGFpcmluZyBjb2RlIHdhcyByZWplY3RlZCAoaW52YWxpZCAvIGV4cGlyZWQgLyBhbHJlYWR5IHVzZWQpLiAqL1xuZXhwb3J0IGNsYXNzIFBhaXJSZWplY3RlZEVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBjb25zdHJ1Y3RvcihtZXNzYWdlOiBzdHJpbmcpIHtcbiAgICBzdXBlcihtZXNzYWdlKTtcbiAgICB0aGlzLm5hbWUgPSAnUGFpclJlamVjdGVkRXJyb3InO1xuICB9XG59XG5cbi8qKiBUaGUgd29ya2VyIGV4aXN0cyBidXQgaGFzIG5vdCBiZWVuIGNsYWltZWQgeWV0IChIVFRQIDQyMSBzZW1hbnRpY3MpLiAqL1xuZXhwb3J0IGNsYXNzIFVuY2xhaW1lZFdvcmtlckVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBjb25zdHJ1Y3RvcihtZXNzYWdlOiBzdHJpbmcpIHtcbiAgICBzdXBlcihtZXNzYWdlKTtcbiAgICB0aGlzLm5hbWUgPSAnVW5jbGFpbWVkV29ya2VyRXJyb3InO1xuICB9XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgSGVhbHRoSW5mbyB7XG4gIHJlYWNoYWJsZTogYm9vbGVhbjtcbiAgY2xhaW1lZDogYm9vbGVhbjtcbiAgLyoqIEh1bWFuLXJlYWRhYmxlIHJlYXNvbiB3aGVuIHRoZSB3b3JrZXIgY291bGQgbm90IGJlIHJlYWNoZWQuICovXG4gIHJlYXNvbj86IHN0cmluZztcbn1cblxuZXhwb3J0IGludGVyZmFjZSBQYWlyQ3JlZGVudGlhbHMge1xuICB0b2tlbjogc3RyaW5nO1xuICBkZXZpY2VJZDogc3RyaW5nO1xufVxuXG4vKipcbiAqIE5vcm1hbGl6ZSB1c2VyIGlucHV0IGludG8gYSB3b3JrZXIgb3JpZ2luOiB0cmltcywgdG9sZXJhdGVzIGEgbWlzc2luZ1xuICogc2NoZW1lIChhc3N1bWVzIGh0dHBzKSwgYSB0cmFpbGluZyBzbGFzaCwgYW5kIHN0cmF5IHBhdGggY29tcG9uZW50cztcbiAqIHJldHVybnMgYGh0dHBzOi8vaG9zdGAgc3R5bGUgb3JpZ2luLiBUaHJvd3MgYFdvcmtlckFwaUVycm9yYCBvbiBnYXJiYWdlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplV29ya2VyVXJsKGlucHV0OiBzdHJpbmcpOiBzdHJpbmcge1xuICBsZXQgY2FuZGlkYXRlID0gaW5wdXQudHJpbSgpO1xuICBpZiAoY2FuZGlkYXRlID09PSAnJykgdGhyb3cgbmV3IFdvcmtlckFwaUVycm9yKCd3b3JrZXIgVVJMIGlzIGVtcHR5Jyk7XG4gIGlmICghL15bYS16QS1aXVthLXpBLVowLTkrLi1dKjpcXC9cXC8vLnRlc3QoY2FuZGlkYXRlKSkgY2FuZGlkYXRlID0gYGh0dHBzOi8vJHtjYW5kaWRhdGV9YDtcbiAgbGV0IG9yaWdpbjogc3RyaW5nO1xuICB0cnkge1xuICAgIG9yaWdpbiA9IG5ldyBVUkwoY2FuZGlkYXRlKS5vcmlnaW47XG4gIH0gY2F0Y2gge1xuICAgIHRocm93IG5ldyBXb3JrZXJBcGlFcnJvcihgaW52YWxpZCB3b3JrZXIgVVJMOiAke0pTT04uc3RyaW5naWZ5KGlucHV0KX1gKTtcbiAgfVxuICBpZiAoIW9yaWdpbi5zdGFydHNXaXRoKCdodHRwOi8vJykgJiYgIW9yaWdpbi5zdGFydHNXaXRoKCdodHRwczovLycpKSB7XG4gICAgdGhyb3cgbmV3IFdvcmtlckFwaUVycm9yKGB3b3JrZXIgVVJMIG11c3QgYmUgaHR0cChzKSwgZ290ICR7b3JpZ2lufWApO1xuICB9XG4gIHJldHVybiBvcmlnaW47XG59XG5cbi8qKiBHRVQgL2hlYWx0aCBcdTIwMTQgbmV2ZXIgdGhyb3dzIGZvciByZWFjaGFiaWxpdHk7IHJlcG9ydHMgY2xhaW0gc3RhdGUgaW5zdGVhZC4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBmZXRjaEhlYWx0aChcbiAgb3JpZ2luOiBzdHJpbmcsXG4gIGZldGNoSW1wbDogdHlwZW9mIGZldGNoLFxuKTogUHJvbWlzZTxIZWFsdGhJbmZvPiB7XG4gIGxldCByZXNwb25zZTogUmVzcG9uc2U7XG4gIHRyeSB7XG4gICAgcmVzcG9uc2UgPSBhd2FpdCBmZXRjaEltcGwoYCR7b3JpZ2lufS9oZWFsdGhgKTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICByZXR1cm4ge1xuICAgICAgcmVhY2hhYmxlOiBmYWxzZSxcbiAgICAgIGNsYWltZWQ6IGZhbHNlLFxuICAgICAgcmVhc29uOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvciksXG4gICAgfTtcbiAgfVxuICBpZiAoIXJlc3BvbnNlLm9rKSB7XG4gICAgcmV0dXJuIHsgcmVhY2hhYmxlOiBmYWxzZSwgY2xhaW1lZDogZmFsc2UsIHJlYXNvbjogYEhUVFAgJHtyZXNwb25zZS5zdGF0dXN9YCB9O1xuICB9XG4gIGNvbnN0IGJvZHkgPSAoYXdhaXQgcmVzcG9uc2UuanNvbigpLmNhdGNoKCgpID0+ICh7fSkpKSBhcyB7IGNsYWltZWQ/OiBib29sZWFuIH07XG4gIHJldHVybiB7IHJlYWNoYWJsZTogdHJ1ZSwgY2xhaW1lZDogYm9keS5jbGFpbWVkID09PSB0cnVlIH07XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUGFpclJlcXVlc3RQYXJhbXMge1xuICBvcmlnaW46IHN0cmluZztcbiAgY29kZTogc3RyaW5nO1xuICBkZXZpY2VOYW1lOiBzdHJpbmc7XG4gIGRldmljZVR5cGU6ICdkZXNrdG9wJyB8ICdtb2JpbGUnO1xuICBmZXRjaEltcGw6IHR5cGVvZiBmZXRjaDtcbn1cblxuLyoqXG4gKiBQT1NUIC9wYWlyIFx1MjAxNCByZWRlZW0gYSBvbmUtdGltZSBwYWlyaW5nIGNvZGUgZm9yIGxvbmctbGl2ZWQgZGV2aWNlXG4gKiBjcmVkZW50aWFscy4gVGhyb3dzIGBQYWlyUmVqZWN0ZWRFcnJvcmAgKGJhZCBjb2RlKSwgYFVuY2xhaW1lZFdvcmtlckVycm9yYFxuICogKDQyMSksIG9yIGBXb3JrZXJBcGlFcnJvcmAgKHVucmVhY2hhYmxlIC8gdW5leHBlY3RlZCkuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZXF1ZXN0UGFpcihwYXJhbXM6IFBhaXJSZXF1ZXN0UGFyYW1zKTogUHJvbWlzZTxQYWlyQ3JlZGVudGlhbHM+IHtcbiAgbGV0IHJlc3BvbnNlOiBSZXNwb25zZTtcbiAgdHJ5IHtcbiAgICByZXNwb25zZSA9IGF3YWl0IHBhcmFtcy5mZXRjaEltcGwoYCR7cGFyYW1zLm9yaWdpbn0vcGFpcmAsIHtcbiAgICAgIG1ldGhvZDogJ1BPU1QnLFxuICAgICAgaGVhZGVyczogeyAnY29udGVudC10eXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nIH0sXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7XG4gICAgICAgIGNvZGU6IHBhcmFtcy5jb2RlLFxuICAgICAgICBkZXZpY2VOYW1lOiBwYXJhbXMuZGV2aWNlTmFtZSxcbiAgICAgICAgZGV2aWNlVHlwZTogcGFyYW1zLmRldmljZVR5cGUsXG4gICAgICB9KSxcbiAgICB9KTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICB0aHJvdyBuZXcgV29ya2VyQXBpRXJyb3IoXG4gICAgICBgY291bGQgbm90IHJlYWNoIHRoZSB3b3JrZXIgYXQgJHtwYXJhbXMub3JpZ2lufTogJHtcbiAgICAgICAgZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpXG4gICAgICB9YCxcbiAgICApO1xuICB9XG4gIC8vIFJlYWQgdGhlIGJvZHkgb25jZSAoYSBSZXNwb25zZSBib2R5IGlzIHNpbmdsZS11c2UpIGFuZCBwYXJzZSBmcm9tIHRleHQuXG4gIGNvbnN0IGRldGFpbCA9IChhd2FpdCByZXNwb25zZS50ZXh0KCkuY2F0Y2goKCkgPT4gJycpKS50cmltKCk7XG4gIGlmIChyZXNwb25zZS5zdGF0dXMgPT09IDQyMSkge1xuICAgIHRocm93IG5ldyBVbmNsYWltZWRXb3JrZXJFcnJvcigndGhpcyB3b3JrZXIgaGFzIG5vdCBiZWVuIGNsYWltZWQgeWV0Jyk7XG4gIH1cbiAgaWYgKHJlc3BvbnNlLnN0YXR1cyA9PT0gNDAxIHx8IHJlc3BvbnNlLnN0YXR1cyA9PT0gNDAzKSB7XG4gICAgdGhyb3cgbmV3IFBhaXJSZWplY3RlZEVycm9yKFxuICAgICAgJ3BhaXJpbmcgY29kZSByZWplY3RlZCBcdTIwMTQgY29kZXMgYXJlIG9uZS10aW1lLCBleHBpcmUgYWZ0ZXIgMTAgbWludXRlcywgYW5kIGNvbWUgJyArXG4gICAgICAgICdmcm9tIHRoZSB3b3JrZXIgZGFzaGJvYXJkLiBHZW5lcmF0ZSBhIGZyZXNoIG9uZSBhbmQgcmV0cnkuJyxcbiAgICApO1xuICB9XG4gIGlmICghcmVzcG9uc2Uub2spIHtcbiAgICB0aHJvdyBuZXcgV29ya2VyQXBpRXJyb3IoXG4gICAgICBgcGFpcmluZyBmYWlsZWQ6IEhUVFAgJHtyZXNwb25zZS5zdGF0dXN9ICR7ZGV0YWlsLnNsaWNlKDAsIDIwMCl9YC50cmltKCksXG4gICAgICByZXNwb25zZS5zdGF0dXMsXG4gICAgKTtcbiAgfVxuICBsZXQgYm9keTogeyB0b2tlbj86IHVua25vd247IGRldmljZUlkPzogdW5rbm93biB9O1xuICB0cnkge1xuICAgIGJvZHkgPSBKU09OLnBhcnNlKGRldGFpbCkgYXMgeyB0b2tlbj86IHVua25vd247IGRldmljZUlkPzogdW5rbm93biB9O1xuICB9IGNhdGNoIHtcbiAgICB0aHJvdyBuZXcgV29ya2VyQXBpRXJyb3IoJ3BhaXJpbmcgcmVwbHkgd2FzIG5vdCBKU09OJywgcmVzcG9uc2Uuc3RhdHVzKTtcbiAgfVxuICBpZiAodHlwZW9mIGJvZHkudG9rZW4gIT09ICdzdHJpbmcnIHx8IHR5cGVvZiBib2R5LmRldmljZUlkICE9PSAnc3RyaW5nJykge1xuICAgIHRocm93IG5ldyBXb3JrZXJBcGlFcnJvcigncGFpcmluZyByZXBseSB3YXMgbWlzc2luZyB0b2tlbi9kZXZpY2VJZCcsIHJlc3BvbnNlLnN0YXR1cyk7XG4gIH1cbiAgcmV0dXJuIHsgdG9rZW46IGJvZHkudG9rZW4sIGRldmljZUlkOiBib2R5LmRldmljZUlkIH07XG59XG5cbi8vIC0tLSBkZXZpY2Ugc2VsZi1zZXJ2aWNlIChQQVRDSCAvZGV2aWNlKSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogVGhlIGRldmljZSBkb2N1bWVudCB0aGUgd29ya2VyIHJldHVybnMgZnJvbSBgUEFUQ0ggL2RldmljZWAuICovXG5leHBvcnQgaW50ZXJmYWNlIFdvcmtlckRldmljZSB7XG4gIGlkOiBzdHJpbmc7XG4gIG5hbWU6IHN0cmluZztcbiAgdHlwZTogc3RyaW5nO1xufVxuXG5leHBvcnQgdHlwZSBSZW5hbWVPdXRjb21lID1cbiAgfCB7IG9rOiB0cnVlOyBkZXZpY2U6IFdvcmtlckRldmljZSB9XG4gIHwgeyBvazogZmFsc2U7IGVycm9yOiBzdHJpbmcgfTtcblxuZXhwb3J0IGludGVyZmFjZSBSZW5hbWVQYXJhbXMge1xuICBvcmlnaW46IHN0cmluZztcbiAgLyoqIFRoZSBjYWxsaW5nIGRldmljZSdzIG93biB0b2tlbiBcdTIwMTQgaXQgY2FuIG9ubHkgZXZlciByZW5hbWUgaXRzZWxmLiAqL1xuICB0b2tlbjogc3RyaW5nO1xuICBuYW1lOiBzdHJpbmc7XG4gIGZldGNoSW1wbDogdHlwZW9mIGZldGNoO1xufVxuXG4vKipcbiAqIGBQQVRDSCAvZGV2aWNlYCBcdTIwMTQgcmVuYW1lIFRISVMgZGV2aWNlIG9uIHRoZSB3b3JrZXIgKGRldmljZS10b2tlblxuICogYXV0aGVudGljYXRlZDsgbmV2ZXIgdGhyb3dzOiBmYWlsdXJlcyBjb21lIGJhY2sgYXMgYHtvazpmYWxzZSwgZXJyb3J9YCkuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZW5hbWVEZXZpY2UocGFyYW1zOiBSZW5hbWVQYXJhbXMpOiBQcm9taXNlPFJlbmFtZU91dGNvbWU+IHtcbiAgbGV0IHJlc3BvbnNlOiBSZXNwb25zZTtcbiAgdHJ5IHtcbiAgICByZXNwb25zZSA9IGF3YWl0IHBhcmFtcy5mZXRjaEltcGwoYCR7cGFyYW1zLm9yaWdpbn0vZGV2aWNlYCwge1xuICAgICAgbWV0aG9kOiAnUEFUQ0gnLFxuICAgICAgaGVhZGVyczogeyAnY29udGVudC10eXBlJzogJ2FwcGxpY2F0aW9uL2pzb24nLCBhdXRob3JpemF0aW9uOiBgQmVhcmVyICR7cGFyYW1zLnRva2VufWAgfSxcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHsgbmFtZTogcGFyYW1zLm5hbWUgfSksXG4gICAgfSk7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIG9rOiBmYWxzZSxcbiAgICAgIGVycm9yOiBgY291bGQgbm90IHJlYWNoIHRoZSB3b3JrZXIgYXQgJHtwYXJhbXMub3JpZ2lufTogJHtcbiAgICAgICAgZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpXG4gICAgICB9YCxcbiAgICB9O1xuICB9XG4gIGNvbnN0IGRldGFpbCA9IChhd2FpdCByZXNwb25zZS50ZXh0KCkuY2F0Y2goKCkgPT4gJycpKS50cmltKCk7XG4gIGlmIChyZXNwb25zZS5zdGF0dXMgPT09IDQyMSkge1xuICAgIHJldHVybiB7IG9rOiBmYWxzZSwgZXJyb3I6ICd0aGlzIHdvcmtlciBoYXMgbm90IGJlZW4gY2xhaW1lZCB5ZXQnIH07XG4gIH1cbiAgaWYgKHJlc3BvbnNlLnN0YXR1cyA9PT0gNDAxIHx8IHJlc3BvbnNlLnN0YXR1cyA9PT0gNDAzKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIG9rOiBmYWxzZSxcbiAgICAgIGVycm9yOiAndGhlIHdvcmtlciByZWplY3RlZCB0aGlzIGRldmljZVxcdTIwMTlzIHRva2VuIChyZXZva2VkPykgXHUyMDE0IHVubGluayBhbmQgcmUtcGFpciB3aXRoIGEgZnJlc2ggY29kZS4nLFxuICAgIH07XG4gIH1cbiAgaWYgKCFyZXNwb25zZS5vaykge1xuICAgIGxldCByZWFzb24gPSBgSFRUUCAke3Jlc3BvbnNlLnN0YXR1c31gO1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBwYXJzZWQgPSBKU09OLnBhcnNlKGRldGFpbCkgYXMgeyBlcnJvcj86IHVua25vd24gfTtcbiAgICAgIGlmICh0eXBlb2YgcGFyc2VkLmVycm9yID09PSAnc3RyaW5nJykgcmVhc29uID0gcGFyc2VkLmVycm9yO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8ga2VlcCB0aGUgYmFyZSBzdGF0dXNcbiAgICB9XG4gICAgcmV0dXJuIHsgb2s6IGZhbHNlLCBlcnJvcjogcmVhc29uIH07XG4gIH1cbiAgbGV0IGJvZHk6IHsgZGV2aWNlPzogdW5rbm93biB9O1xuICB0cnkge1xuICAgIGJvZHkgPSBKU09OLnBhcnNlKGRldGFpbCkgYXMgeyBkZXZpY2U/OiB1bmtub3duIH07XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiB7IG9rOiBmYWxzZSwgZXJyb3I6ICdyZW5hbWUgcmVwbHkgd2FzIG5vdCBKU09OJyB9O1xuICB9XG4gIGNvbnN0IGRldmljZSA9IGJvZHkuZGV2aWNlIGFzIFBhcnRpYWw8V29ya2VyRGV2aWNlPiB8IHVuZGVmaW5lZDtcbiAgaWYgKFxuICAgIHR5cGVvZiBkZXZpY2U/LmlkICE9PSAnc3RyaW5nJyB8fFxuICAgIHR5cGVvZiBkZXZpY2UubmFtZSAhPT0gJ3N0cmluZycgfHxcbiAgICB0eXBlb2YgZGV2aWNlLnR5cGUgIT09ICdzdHJpbmcnXG4gICkge1xuICAgIHJldHVybiB7IG9rOiBmYWxzZSwgZXJyb3I6ICdyZW5hbWUgcmVwbHkgd2FzIG1pc3NpbmcgdGhlIGRldmljZSBkb2N1bWVudCcgfTtcbiAgfVxuICByZXR1cm4geyBvazogdHJ1ZSwgZGV2aWNlOiB7IGlkOiBkZXZpY2UuaWQsIG5hbWU6IGRldmljZS5uYW1lLCB0eXBlOiBkZXZpY2UudHlwZSB9IH07XG59XG5cbi8vIC0tLSB3b3JrZXIgc3RhdHVzIChHRVQgL2FwaS9zdGF0dXMsIGRldmljZSB0b2tlbikgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFRoZSBzbGljZSBvZiBgL2FwaS9zdGF0dXNgIHRoZSBwbHVnaW4ncyBBYm91dCBzZWN0aW9uIHNob3dzLiAqL1xuZXhwb3J0IGludGVyZmFjZSBXb3JrZXJTdGF0dXNTdW1tYXJ5IHtcbiAgdmF1bHROYW1lOiBzdHJpbmc7XG4gIGRldmljZXM6IEFycmF5PHsgaWQ6IHN0cmluZzsgbmFtZTogc3RyaW5nOyB0eXBlOiBzdHJpbmc7IG9ubGluZTogYm9vbGVhbjsgcmV2b2tlZDogYm9vbGVhbiB9PjtcbiAgYXR0YWNobWVudHM6IHsgY291bnQ6IG51bWJlcjsgYnl0ZXM6IG51bWJlciB9O1xuICBzdG9yYWdlQnl0ZXM6IG51bWJlcjtcbn1cblxuLyoqXG4gKiBgR0VUIC9hcGkvc3RhdHVzYCB3aXRoIHRoZSBkZXZpY2UgdG9rZW4gXHUyMDE0IHN0b3JhZ2UgdXNhZ2UgKyBkZXZpY2UgbGlzdCBmb3JcbiAqIHRoZSBBYm91dCBzZWN0aW9uLiBSZXNvbHZlcyBgbnVsbGAgb24gYW55IGZhaWx1cmUgKEFib3V0IHNob3dzIFwidW5rbm93blwiKS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGZldGNoV29ya2VyU3RhdHVzKHBhcmFtczoge1xuICBvcmlnaW46IHN0cmluZztcbiAgdG9rZW46IHN0cmluZztcbiAgZmV0Y2hJbXBsOiB0eXBlb2YgZmV0Y2g7XG59KTogUHJvbWlzZTxXb3JrZXJTdGF0dXNTdW1tYXJ5IHwgbnVsbD4ge1xuICBsZXQgcmVzcG9uc2U6IFJlc3BvbnNlO1xuICB0cnkge1xuICAgIHJlc3BvbnNlID0gYXdhaXQgcGFyYW1zLmZldGNoSW1wbChgJHtwYXJhbXMub3JpZ2lufS9hcGkvc3RhdHVzYCwge1xuICAgICAgaGVhZGVyczogeyBhdXRob3JpemF0aW9uOiBgQmVhcmVyICR7cGFyYW1zLnRva2VufWAgfSxcbiAgICB9KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbiAgaWYgKCFyZXNwb25zZS5vaykgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGJvZHkgPSAoYXdhaXQgcmVzcG9uc2UuanNvbigpLmNhdGNoKCgpID0+IG51bGwpKSBhcyBQYXJ0aWFsPFdvcmtlclN0YXR1c1N1bW1hcnk+IHwgbnVsbDtcbiAgaWYgKGJvZHkgPT09IG51bGwgfHwgdHlwZW9mIGJvZHkuc3RvcmFnZUJ5dGVzICE9PSAnbnVtYmVyJyB8fCB0eXBlb2YgYm9keS5hdHRhY2htZW50cyAhPT0gJ29iamVjdCcpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuICByZXR1cm4ge1xuICAgIHZhdWx0TmFtZTogdHlwZW9mIGJvZHkudmF1bHROYW1lID09PSAnc3RyaW5nJyA/IGJvZHkudmF1bHROYW1lIDogJycsXG4gICAgZGV2aWNlczogQXJyYXkuaXNBcnJheShib2R5LmRldmljZXMpID8gYm9keS5kZXZpY2VzIDogW10sXG4gICAgYXR0YWNobWVudHM6IGJvZHkuYXR0YWNobWVudHMsXG4gICAgc3RvcmFnZUJ5dGVzOiBib2R5LnN0b3JhZ2VCeXRlcyxcbiAgfTtcbn1cbiIsICIvKipcbiAqIFRoZSBwYWlyIGZsb3cgc2hhcmVkIGJ5IHRoZSBzZXR0aW5ncyBmb3JtIGFuZCB0aGUgYG9ic2lkaWFuOi8vYCBkZWVwIGxpbmtcbiAqIChBUkNISVRFQ1RVUkUgXHUwMEE3Myk6IHByb2JlIGBHRVQgL2hlYWx0aGAgZmlyc3QgXHUyMDE0IGFuICp1bmNsYWltZWQqIHdvcmtlciBnZXRzXG4gKiBmcmllbmRseSBvbmJvYXJkaW5nIGd1aWRhbmNlIGluc3RlYWQgb2YgYSBjcnlwdGljIDQyMSBcdTIwMTQgdGhlbiBgUE9TVCAvcGFpcmBcbiAqIGFuZCBoYW5kIHRoZSBjcmVkZW50aWFscyBiYWNrIHRvIGJlIHBlcnNpc3RlZC5cbiAqL1xuXG5pbXBvcnQge1xuICBmZXRjaEhlYWx0aCxcbiAgbm9ybWFsaXplV29ya2VyVXJsLFxuICByZXF1ZXN0UGFpcixcbiAgUGFpclJlamVjdGVkRXJyb3IsXG4gIFVuY2xhaW1lZFdvcmtlckVycm9yLFxuICBXb3JrZXJBcGlFcnJvcixcbn0gZnJvbSAnLi93b3JrZXJhcGkuanMnO1xuXG5leHBvcnQgdHlwZSBQYWlyT3V0Y29tZSA9XG4gIHwgeyBzdGF0dXM6ICdwYWlyZWQnOyB1cmw6IHN0cmluZzsgdG9rZW46IHN0cmluZzsgZGV2aWNlSWQ6IHN0cmluZyB9XG4gIHwgeyBzdGF0dXM6ICd1bmNsYWltZWQnOyB1cmw6IHN0cmluZzsgZ3VpZGFuY2U6IHN0cmluZyB9XG4gIHwgeyBzdGF0dXM6ICd1bnJlYWNoYWJsZSc7IHVybDogc3RyaW5nOyByZWFzb246IHN0cmluZyB9XG4gIHwgeyBzdGF0dXM6ICdyZWplY3RlZCc7IHVybDogc3RyaW5nOyByZWFzb246IHN0cmluZyB9XG4gIHwgeyBzdGF0dXM6ICdpbnZhbGlkLXVybCc7IGlucHV0OiBzdHJpbmcgfTtcblxuZXhwb3J0IGludGVyZmFjZSBQYWlyRmxvd1BhcmFtcyB7XG4gIC8qKiBXb3JrZXIgVVJMIGFzIHR5cGVkIC8gZGVlcC1saW5rZWQgKHNjaGVtZWxlc3MgaXMgdG9sZXJhdGVkKS4gKi9cbiAgdXJsOiBzdHJpbmc7XG4gIC8qKiBPbmUtdGltZSBwYWlyaW5nIGNvZGUgZnJvbSB0aGUgd29ya2VyIGRhc2hib2FyZC4gKi9cbiAgY29kZTogc3RyaW5nO1xuICBkZXZpY2VOYW1lOiBzdHJpbmc7XG4gIGRldmljZVR5cGU6ICdkZXNrdG9wJyB8ICdtb2JpbGUnO1xuICBmZXRjaEltcGw6IHR5cGVvZiBmZXRjaDtcbn1cblxuLyoqIE9uYm9hcmRpbmcgdGV4dCBzaG93biB3aGVuIHRoZSB3b3JrZXIgaXMgZGVwbG95ZWQgYnV0IG5vdCBjbGFpbWVkLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHVuY2xhaW1lZEd1aWRhbmNlKHVybDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIFtcbiAgICBgVGhlIHdvcmtlciBhdCAke3VybH0gaXMgZGVwbG95ZWQgYnV0IG5vdCBjbGFpbWVkIHlldC4gRmluaXNoIHNldHVwIGluIGEgYnJvd3NlcjpgLFxuICAgICcnLFxuICAgIGAxLiBPcGVuICR7dXJsfWAsXG4gICAgJzIuIFNldCB0aGUgYWRtaW4gcGFzc3BocmFzZSBhbmQgbmFtZSB0aGUgdmF1bHQgKHRoZSBjbGFpbSBwYWdlKS4nLFxuICAgICczLiBPbiB0aGUgZGFzaGJvYXJkLCBjcmVhdGUgYSBwYWlyaW5nIGNvZGUgKERldmljZXMgXHUyMTkyIFBhaXIgbmV3IGRldmljZSkuJyxcbiAgICAnNC4gRW50ZXIgdGhhdCBjb2RlIGhlcmUgKG9yIGNsaWNrIHRoZSBvYnNpZGlhbjovLyBsaW5rIHRoZSBkYXNoYm9hcmQgc2hvd3MpIGFuZCBwYWlyLicsXG4gIF0uam9pbignXFxuJyk7XG59XG5cbi8qKlxuICogUnVuIHRoZSBwYWlyIGZsb3cuIE5ldmVyIHRocm93cyBcdTIwMTQgZXZlcnkgZmFpbHVyZSBtb2RlIGlzIGEgdHlwZWQgb3V0Y29tZSB0aGVcbiAqIFVJIGNhbiByZW5kZXIgKGFuZCB0aGUgZGVlcC1saW5rIGhhbmRsZXIgY2FuIHR1cm4gaW50byBhIE5vdGljZSkuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBwYWlyV2l0aFdvcmtlcihwYXJhbXM6IFBhaXJGbG93UGFyYW1zKTogUHJvbWlzZTxQYWlyT3V0Y29tZT4ge1xuICBsZXQgb3JpZ2luOiBzdHJpbmc7XG4gIHRyeSB7XG4gICAgb3JpZ2luID0gbm9ybWFsaXplV29ya2VyVXJsKHBhcmFtcy51cmwpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4geyBzdGF0dXM6ICdpbnZhbGlkLXVybCcsIGlucHV0OiBwYXJhbXMudXJsIH07XG4gIH1cblxuICBjb25zdCBoZWFsdGggPSBhd2FpdCBmZXRjaEhlYWx0aChvcmlnaW4sIHBhcmFtcy5mZXRjaEltcGwpO1xuICBpZiAoIWhlYWx0aC5yZWFjaGFibGUpIHtcbiAgICByZXR1cm4ge1xuICAgICAgc3RhdHVzOiAndW5yZWFjaGFibGUnLFxuICAgICAgdXJsOiBvcmlnaW4sXG4gICAgICByZWFzb246XG4gICAgICAgIGAke2hlYWx0aC5yZWFzb24gPz8gJ3Vua25vd24gZXJyb3InfSBcdTIwMTQgY2hlY2sgdGhlIFVSTCwgeW91ciBuZXR3b3JrLCBhbmQgdGhhdCB0aGUgYCArXG4gICAgICAgICd3b3JrZXIgaXMgZGVwbG95ZWQuJyxcbiAgICB9O1xuICB9XG4gIGlmICghaGVhbHRoLmNsYWltZWQpIHtcbiAgICByZXR1cm4geyBzdGF0dXM6ICd1bmNsYWltZWQnLCB1cmw6IG9yaWdpbiwgZ3VpZGFuY2U6IHVuY2xhaW1lZEd1aWRhbmNlKG9yaWdpbikgfTtcbiAgfVxuXG4gIHRyeSB7XG4gICAgY29uc3QgY3JlZGVudGlhbHMgPSBhd2FpdCByZXF1ZXN0UGFpcih7XG4gICAgICBvcmlnaW4sXG4gICAgICBjb2RlOiBwYXJhbXMuY29kZSxcbiAgICAgIGRldmljZU5hbWU6IHBhcmFtcy5kZXZpY2VOYW1lLFxuICAgICAgZGV2aWNlVHlwZTogcGFyYW1zLmRldmljZVR5cGUsXG4gICAgICBmZXRjaEltcGw6IHBhcmFtcy5mZXRjaEltcGwsXG4gICAgfSk7XG4gICAgcmV0dXJuIHsgc3RhdHVzOiAncGFpcmVkJywgdXJsOiBvcmlnaW4sIC4uLmNyZWRlbnRpYWxzIH07XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgaWYgKGVycm9yIGluc3RhbmNlb2YgVW5jbGFpbWVkV29ya2VyRXJyb3IpIHtcbiAgICAgIHJldHVybiB7IHN0YXR1czogJ3VuY2xhaW1lZCcsIHVybDogb3JpZ2luLCBndWlkYW5jZTogdW5jbGFpbWVkR3VpZGFuY2Uob3JpZ2luKSB9O1xuICAgIH1cbiAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBQYWlyUmVqZWN0ZWRFcnJvcikge1xuICAgICAgcmV0dXJuIHsgc3RhdHVzOiAncmVqZWN0ZWQnLCB1cmw6IG9yaWdpbiwgcmVhc29uOiBlcnJvci5tZXNzYWdlIH07XG4gICAgfVxuICAgIGNvbnN0IHJlYXNvbiA9IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKTtcbiAgICByZXR1cm4geyBzdGF0dXM6ICdyZWplY3RlZCcsIHVybDogb3JpZ2luLCByZWFzb24gfTtcbiAgfVxufVxuXG4vKiogUmVuZGVyIGFueSBvdXRjb21lIGFzIHVzZXItZmFjaW5nIHRleHQgKE5vdGljZXMsIGRlZXAtbGluayBmZWVkYmFjaykuICovXG5leHBvcnQgZnVuY3Rpb24gcGFpck91dGNvbWVNZXNzYWdlKG91dGNvbWU6IFBhaXJPdXRjb21lKTogc3RyaW5nIHtcbiAgc3dpdGNoIChvdXRjb21lLnN0YXR1cykge1xuICAgIGNhc2UgJ3BhaXJlZCc6XG4gICAgICByZXR1cm4gYFBhaXJlZCB3aXRoICR7b3V0Y29tZS51cmx9IFx1MjAxNCBzeW5jaW5nIG5vdy5gO1xuICAgIGNhc2UgJ3VuY2xhaW1lZCc6XG4gICAgICByZXR1cm4gb3V0Y29tZS5ndWlkYW5jZTtcbiAgICBjYXNlICd1bnJlYWNoYWJsZSc6XG4gICAgICByZXR1cm4gYENvdWxkIG5vdCByZWFjaCB0aGUgd29ya2VyOiAke291dGNvbWUucmVhc29ufWA7XG4gICAgY2FzZSAncmVqZWN0ZWQnOlxuICAgICAgcmV0dXJuIGBQYWlyaW5nIGZhaWxlZDogJHtvdXRjb21lLnJlYXNvbn1gO1xuICAgIGNhc2UgJ2ludmFsaWQtdXJsJzpcbiAgICAgIHJldHVybiBgVGhhdCBkb2VzIG5vdCBsb29rIGxpa2UgYSB3b3JrZXIgVVJMOiAke0pTT04uc3RyaW5naWZ5KG91dGNvbWUuaW5wdXQpfWA7XG4gIH1cbn1cbiIsICIvKipcbiAqIGBvYnNpZGlhbjovL3ZhdWx0c3luY2ZvcmFnZW50cy9wYWlyP3VybD08d29ya2VyPiZjb2RlPTxwYWlyaW5nPmAgZGVlcC1saW5rXG4gKiBoYW5kbGluZyAoQVJDSElURUNUVVJFIFx1MDBBNzMpOiB0aGUgZGFzaGJvYXJkIHJlbmRlcnMgdGhpcyBsaW5rIChhbmQgdGhlIFFSXG4gKiBlcXVpdmFsZW50KSBzbyBhIG5ldyBkZXZpY2UgcGFpcnMgd2l0aCB6ZXJvIHR5cGluZy5cbiAqXG4gKiBUaGUgaGFuZGxlciBpcyByZWdpc3RlcmVkIGZvciB0aGUgYWN0aW9uIGB2YXVsdHN5bmNmb3JhZ2VudHNgLiBPYnNpZGlhblxuICogYnVpbGRzIGRpZmZlciBzdWJ0bHkgaW4gaG93IHRoZSBgL3BhaXJgIHBhdGggc2VnbWVudCBvZiBhIHByb3RvY29sIFVSTCBpc1xuICogbWF0Y2hlZCwgc28gdGhlIHNhbWUgaGFuZGxlciBpcyByZWdpc3RlcmVkIGZvciBgdmF1bHRzeW5jZm9yYWdlbnRzL3BhaXJgXG4gKiB0b28gXHUyMDE0IHdoaWNoZXZlciBzcGVsbGluZyBhIGdpdmVuIGJ1aWxkIHJlc29sdmVzLCB0aGUgbGluayB3b3Jrcy4gV2hlblxuICogYHVybGAvYGNvZGVgIGFyZSBhYnNlbnQgdGhlIGludm9jYXRpb24gaXMgaWdub3JlZCAoYSBzdHJheSBwcm90b2NvbCBoaXRcbiAqIG11c3Qgbm90IHNwYW0gYSBOb3RpY2UpOyBhICptYWxmb3JtZWQqIHBhaXIgbGluayAob25lIG9mIHRoZSB0d28gcHJlc2VudClcbiAqIGdldHMgYW4gYWN0aW9uYWJsZSBlcnJvci5cbiAqL1xuXG5pbXBvcnQgeyBOb3RpY2UgfSBmcm9tICdvYnNpZGlhbic7XG5cbi8qKiBQcm90b2NvbCBhY3Rpb24gKHRoZSBgb2JzaWRpYW46Ly9gIFwiaG9zdFwiIHBhcnQpLiAqL1xuZXhwb3J0IGNvbnN0IFBST1RPQ09MX0FDVElPTiA9ICd2YXVsdHN5bmNmb3JhZ2VudHMnO1xuXG4vKiogSGFuZGxlciBzaGFwZSAoT2JzaWRpYW4gcGFzc2VzIGl0cyBkZWNvZGVkIHF1ZXJ5IHBhcmFtcykuICovXG5leHBvcnQgdHlwZSBQcm90b2NvbEhhbmRsZXIgPSAocGFyYW1zOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPikgPT4gdm9pZDtcblxuLyoqIEhvdyBoYW5kbGVycyBnZXQgcmVnaXN0ZXJlZCBcdTIwMTQgYFBsdWdpbi5yZWdpc3Rlck9ic2lkaWFuUHJvdG9jb2xIYW5kbGVyYC4gKi9cbmV4cG9ydCB0eXBlIFByb3RvY29sUmVnaXN0cmFyID0gKGFjdGlvbjogc3RyaW5nLCBoYW5kbGVyOiBQcm90b2NvbEhhbmRsZXIpID0+IHZvaWQ7XG5cbi8qKiBQYXJzZWQgcGFpciBkZWVwIGxpbmsuICovXG5leHBvcnQgaW50ZXJmYWNlIFBhaXJEZWVwTGluayB7XG4gIHVybDogc3RyaW5nO1xuICBjb2RlOiBzdHJpbmc7XG59XG5cbmV4cG9ydCB0eXBlIERlZXBMaW5rUGFyc2VSZXN1bHQgPVxuICB8IHsgb2s6IHRydWU7IGxpbms6IFBhaXJEZWVwTGluayB9XG4gIHwgeyBvazogZmFsc2U7IGVycm9yOiBzdHJpbmcgfTtcblxuLyoqXG4gKiBFeHRyYWN0IGB7dXJsLCBjb2RlfWAgZnJvbSBPYnNpZGlhbidzIGRlY29kZWQgcXVlcnkgcGFyYW1zLiBWYWx1ZXMgYXJyaXZlXG4gKiBhcyBzdHJpbmdzICh1c3VhbGx5IGFscmVhZHkgZGVjb2RlZDsgYSBkb3VibGUtZW5jb2RlZCBgJXh4YCByZW1uYW50IGlzXG4gKiBkZWNvZGVkIG9uY2UgbW9yZSwgYmVzdCBlZmZvcnQpLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VQYWlyRGVlcExpbmsocGFyYW1zOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPik6IERlZXBMaW5rUGFyc2VSZXN1bHQge1xuICBjb25zdCB1cmwgPSBwYXJhbVRleHQocGFyYW1zLCAndXJsJyk7XG4gIGNvbnN0IGNvZGUgPSBwYXJhbVRleHQocGFyYW1zLCAnY29kZScpO1xuICBpZiAodXJsID09PSAnJyAmJiBjb2RlID09PSAnJykge1xuICAgIHJldHVybiB7IG9rOiBmYWxzZSwgZXJyb3I6ICdubyBwYWlyaW5nIHBhcmFtZXRlcnMnIH07XG4gIH1cbiAgaWYgKHVybCA9PT0gJycpIHJldHVybiB7IG9rOiBmYWxzZSwgZXJyb3I6ICdkZWVwIGxpbmsgaXMgbWlzc2luZyB0aGUgd29ya2VyIFVSTCAoP3VybD1cdTIwMjYpJyB9O1xuICBpZiAoY29kZSA9PT0gJycpIHJldHVybiB7IG9rOiBmYWxzZSwgZXJyb3I6ICdkZWVwIGxpbmsgaXMgbWlzc2luZyB0aGUgcGFpcmluZyBjb2RlICg/Y29kZT1cdTIwMjYpJyB9O1xuICByZXR1cm4geyBvazogdHJ1ZSwgbGluazogeyB1cmwsIGNvZGUgfSB9O1xufVxuXG5mdW5jdGlvbiBwYXJhbVRleHQocGFyYW1zOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiwga2V5OiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCB2YWx1ZSA9IHBhcmFtc1trZXldO1xuICBpZiAodHlwZW9mIHZhbHVlID09PSAnbnVtYmVyJykgcmV0dXJuIFN0cmluZyh2YWx1ZSk7XG4gIGlmICh0eXBlb2YgdmFsdWUgIT09ICdzdHJpbmcnKSByZXR1cm4gJyc7XG4gIGNvbnN0IHRyaW1tZWQgPSB2YWx1ZS50cmltKCk7XG4gIC8vIE9ic2lkaWFuIGhhbmRzIG92ZXIgZGVjb2RlZCB2YWx1ZXM7IHRvbGVyYXRlIG9uZSBzdXJ2aXZpbmcgcm91bmQgb2ZcbiAgLy8gcGVyY2VudC1lbmNvZGluZyBmcm9tIG92ZXItZWFnZXIgbGluayBnZW5lcmF0b3JzLlxuICBpZiAodHJpbW1lZC5pbmNsdWRlcygnJScpKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBkZWNvZGVVUklDb21wb25lbnQodHJpbW1lZCk7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gdHJpbW1lZDtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHRyaW1tZWQ7XG59XG5cbi8qKlxuICogUmVnaXN0ZXIgdGhlIHBhaXIgZGVlcC1saW5rIGhhbmRsZXIgKGNhbGwgZnJvbSBgb25sb2FkYCB3aXRoIHRoZSBwbHVnaW4nc1xuICogb3duIHJlZ2lzdHJhcikuIGBvblBhaXJgIHJ1bnMgdGhlIHNoYXJlZCBwYWlyIGZsb3cgKHNldHRpbmdzICsgTm90aWNlc1xuICogbGl2ZSBpbiB0aGUgcGx1Z2luKTsgaXRzIGVycm9ycyBhcmUgbG9nZ2VkLCBuZXZlciBmYXRhbC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlZ2lzdGVyUGFpclByb3RvY29sSGFuZGxlcihcbiAgcmVnaXN0ZXI6IFByb3RvY29sUmVnaXN0cmFyLFxuICBvblBhaXI6IChsaW5rOiBQYWlyRGVlcExpbmspID0+IFByb21pc2U8dm9pZD4sXG4pOiB2b2lkIHtcbiAgY29uc3QgaGFuZGxlcjogUHJvdG9jb2xIYW5kbGVyID0gKHBhcmFtcykgPT4ge1xuICAgIGNvbnN0IHBhcnNlZCA9IHBhcnNlUGFpckRlZXBMaW5rKHBhcmFtcyk7XG4gICAgaWYgKCFwYXJzZWQub2spIHtcbiAgICAgIC8vIE1pc3NpbmcgYm90aCBcdTIxOTIgYSBiYXJlIG9ic2lkaWFuOi8vdmF1bHRzeW5jZm9yYWdlbnRzIGhpdDsgc3RheSBxdWlldC5cbiAgICAgIGlmIChwYXJzZWQuZXJyb3IgIT09ICdubyBwYWlyaW5nIHBhcmFtZXRlcnMnKSB7XG4gICAgICAgIG5ldyBOb3RpY2UoYFZhdWx0U3luYyBkZWVwIGxpbms6ICR7cGFyc2VkLmVycm9yfWApO1xuICAgICAgfVxuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB2b2lkIG9uUGFpcihwYXJzZWQubGluaykuY2F0Y2goKGVycm9yOiB1bmtub3duKSA9PiB7XG4gICAgICBjb25zb2xlLmVycm9yKCdbdnNhXSBkZWVwLWxpbmsgcGFpcmluZyBmYWlsZWQnLCBlcnJvcik7XG4gICAgICBuZXcgTm90aWNlKCdWYXVsdFN5bmM6IHBhaXJpbmcgdmlhIGxpbmsgZmFpbGVkIFx1MjAxNCBzZWUgdGhlIGNvbnNvbGUgZm9yIGRldGFpbHMuJyk7XG4gICAgfSk7XG4gIH07XG4gIHJlZ2lzdGVyKFBST1RPQ09MX0FDVElPTiwgaGFuZGxlcik7XG4gIC8vIFJlZ2lzdGVyIHRoZSBwYXRoLXNwZWxsZWQgYWN0aW9uIHRvbyAoYnVpbGQtZGVwZW5kZW50IG1hdGNoaW5nKS5cbiAgcmVnaXN0ZXIoYCR7UFJPVE9DT0xfQUNUSU9OfS9wYWlyYCwgaGFuZGxlcik7XG59XG4iLCAiLyoqXG4gKiBSZWNvbm5lY3QgcG9saWN5IChwbHVnaW4gc2NvcGUgaXRlbSAjNSk6IGV4cG9uZW50aWFsIGJhY2tvZmYgd2l0aCBqaXR0ZXIsXG4gKiBjYXBwZWQgYXQgNjAgcy4gVGhlIHBsdWdpbidzIDEgcyBzdXBlcnZpc2lvbiB0aWNrIGFza3MgdGhlIHN1cGVydmlzb3Igd2hhdFxuICogdG8gZG8gd2hlbmV2ZXIgdGhlIGNsaWVudCByZXBvcnRzIGBkaXNjb25uZWN0ZWRgOyBhIHNjaGVkdWxlZCByZWNvbm5lY3QgaXNcbiAqIGEgc2luZ2xlIGZsaWdodCBcdTIwMTQgbmV2ZXIgYSBzdGFjayBvZiByZXRyaWVzLlxuICovXG5cbmltcG9ydCB0eXBlIHsgU3luY0NsaWVudFN0YXRlIH0gZnJvbSAnQHZzYS9jb3JlJztcblxuZXhwb3J0IGludGVyZmFjZSBCYWNrb2ZmT3B0aW9ucyB7XG4gIC8qKiBGaXJzdCBhdHRlbXB0IGRlbGF5IChkZWZhdWx0IDEgcykuICovXG4gIGJhc2VNcz86IG51bWJlcjtcbiAgLyoqIENlaWxpbmcgKGRlZmF1bHQgNjAgcyBwZXIgdGhlIHBsdWdpbiBzcGVjKS4gKi9cbiAgY2FwTXM/OiBudW1iZXI7XG4gIC8qKiBKaXR0ZXIgZnJhY3Rpb24gYXJvdW5kIHRoZSBleHBvbmVudGlhbCB2YWx1ZSwgMFx1MjAxMzAuNSAoZGVmYXVsdCAwLjMpLiAqL1xuICBqaXR0ZXI/OiBudW1iZXI7XG4gIC8qKiBJbmplY3RhYmxlIHJhbmRvbW5lc3MgKHRlc3RzKS4gRGVmYXVsdCBgTWF0aC5yYW5kb21gLiAqL1xuICByYW5kb20/OiAoKSA9PiBudW1iZXI7XG59XG5cbmV4cG9ydCBjb25zdCBERUZBVUxUX1JFQ09OTkVDVF9CQVNFX01TID0gMTAwMDtcbmV4cG9ydCBjb25zdCBERUZBVUxUX1JFQ09OTkVDVF9DQVBfTVMgPSA2MF8wMDA7XG5cbi8qKlxuICogRGVsYXkgZm9yIGF0dGVtcHQgTiAoMC1iYXNlZCk6IGBtaW4oY2FwLCBiYXNlIFx1MDBCNyAyXmF0dGVtcHQpYCB3aXRoIHN5bW1ldHJpY1xuICogbXVsdGlwbGljYXRpdmUgaml0dGVyLCBmbG9vcmVkIGF0IDI1MCBtcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJhY2tvZmZEZWxheU1zKGF0dGVtcHQ6IG51bWJlciwgb3B0aW9uczogQmFja29mZk9wdGlvbnMgPSB7fSk6IG51bWJlciB7XG4gIGNvbnN0IGJhc2UgPSBvcHRpb25zLmJhc2VNcyA/PyBERUZBVUxUX1JFQ09OTkVDVF9CQVNFX01TO1xuICBjb25zdCBjYXAgPSBvcHRpb25zLmNhcE1zID8/IERFRkFVTFRfUkVDT05ORUNUX0NBUF9NUztcbiAgY29uc3Qgaml0dGVyID0gb3B0aW9ucy5qaXR0ZXIgPz8gMC4zO1xuICBjb25zdCByYW5kb20gPSBvcHRpb25zLnJhbmRvbSA/PyBNYXRoLnJhbmRvbTtcbiAgY29uc3QgZXhwb25lbnRpYWwgPSBNYXRoLm1pbihjYXAsIGJhc2UgKiAyICoqIGF0dGVtcHQpO1xuICBjb25zdCBmYWN0b3IgPSAxICsgKHJhbmRvbSgpICogMiAtIDEpICogaml0dGVyO1xuICByZXR1cm4gTWF0aC5yb3VuZChNYXRoLm1pbihjYXAsIE1hdGgubWF4KDI1MCwgZXhwb25lbnRpYWwgKiBmYWN0b3IpKSk7XG59XG5cbmV4cG9ydCB0eXBlIFJlY29ubmVjdERlY2lzaW9uID0geyBhY3Rpb246ICdyZWNvbm5lY3QnOyBkZWxheU1zOiBudW1iZXIgfSB8IHsgYWN0aW9uOiAnd2FpdCcgfTtcblxuLyoqXG4gKiBUcmFja3MgcmVjb25uZWN0IGF0dGVtcHRzIGFjcm9zcyB0aGUgc3VwZXJ2aXNpb24gdGljay4gTm9uLWRpc2Nvbm5lY3RlZFxuICogc3RhdGVzIHJlc2V0IHRoZSBiYWNrb2ZmIGxhZGRlciAoYSBzdWNjZXNzZnVsIGN5Y2xlIG1lYW5zIHRoZSBuZXR3b3JrIGlzXG4gKiBiYWNrKTsgYHNjaGVkdWxlZGAga2VlcHMgZXhhY3RseSBvbmUgcmVjb25uZWN0IGluIGZsaWdodC5cbiAqL1xuZXhwb3J0IGNsYXNzIFJlY29ubmVjdFN1cGVydmlzb3Ige1xuICBwcml2YXRlIGF0dGVtcHQgPSAwO1xuICBwcml2YXRlIHNjaGVkdWxlZCA9IGZhbHNlO1xuICBwcml2YXRlIHJlYWRvbmx5IG9wdGlvbnM6IEJhY2tvZmZPcHRpb25zO1xuXG4gIGNvbnN0cnVjdG9yKG9wdGlvbnM6IEJhY2tvZmZPcHRpb25zID0ge30pIHtcbiAgICB0aGlzLm9wdGlvbnMgPSBvcHRpb25zO1xuICB9XG5cbiAgLyoqIENhbGwgZWFjaCB0aWNrOyBvbiBgcmVjb25uZWN0YCwgZm9sbG93IHVwIHdpdGggYGFja25vd2xlZGdlZCgpYC4gKi9cbiAgY29uc2lkZXIoc3RhdGU6IFN5bmNDbGllbnRTdGF0ZSk6IFJlY29ubmVjdERlY2lzaW9uIHtcbiAgICBpZiAoc3RhdGUgIT09ICdkaXNjb25uZWN0ZWQnKSB7XG4gICAgICB0aGlzLmF0dGVtcHQgPSAwO1xuICAgICAgdGhpcy5zY2hlZHVsZWQgPSBmYWxzZTtcbiAgICAgIHJldHVybiB7IGFjdGlvbjogJ3dhaXQnIH07XG4gICAgfVxuICAgIGlmICh0aGlzLnNjaGVkdWxlZCkgcmV0dXJuIHsgYWN0aW9uOiAnd2FpdCcgfTtcbiAgICByZXR1cm4geyBhY3Rpb246ICdyZWNvbm5lY3QnLCBkZWxheU1zOiBiYWNrb2ZmRGVsYXlNcyh0aGlzLmF0dGVtcHQsIHRoaXMub3B0aW9ucykgfTtcbiAgfVxuXG4gIC8qKiBNYXJrIHRoZSByZXR1cm5lZCByZWNvbm5lY3QgYXMgaW4gZmxpZ2h0IChvbmUgYXQgYSB0aW1lKS4gKi9cbiAgYWNrbm93bGVkZ2VkKCk6IHZvaWQge1xuICAgIHRoaXMuYXR0ZW1wdCArPSAxO1xuICAgIHRoaXMuc2NoZWR1bGVkID0gdHJ1ZTtcbiAgfVxuXG4gIC8qKiBUaGUgaW4tZmxpZ2h0IHJlY29ubmVjdCBzZXR0bGVkIChzdWNjZXNzIG9yIGZhaWx1cmUpLiAqL1xuICBzZXR0bGVkKCk6IHZvaWQge1xuICAgIHRoaXMuc2NoZWR1bGVkID0gZmFsc2U7XG4gIH1cblxuICAvKiogQ29tcGxldGVkIHJlY29ubmVjdCBhdHRlbXB0cyBzaW5jZSB0aGUgbGFzdCBoZWFsdGh5IHN0YXRlLiAqL1xuICBnZXQgYXR0ZW1wdHMoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy5hdHRlbXB0O1xuICB9XG59XG4iLCAiLyoqXG4gKiBUaGUgc2V0dGluZ3MgdGFiIChwbHVnaW4gc2NvcGUgaXRlbSAjNiksIG9yZ2FuaXplZCBpbiBmb3VyIHNlY3Rpb25zOlxuICpcbiAqICAgQ29ubmVjdGlvbiBcdTIwMTQgd29ya2VyIFVSTCwgZGV2aWNlIG5hbWUgKHBhaXJpbmctdGltZSBPUiByZW5hbWUgd2hlblxuICogICAgICAgICAgICAgICAgbGlua2VkKSwgcGFpcmluZyBmb3JtIC8gc3RhdHVzIHJlYWRvdXQgKyBTeW5jIG5vdyArIHVubGlua1xuICogICBTeW5jICAgICAgIFx1MjAxNCByZXNjYW4gaW50ZXJ2YWwsIC5vYnNpZGlhbi8gdG9nZ2xlLCBwYXVzZS9yZXN1bWUsXG4gKiAgICAgICAgICAgICAgICBzeW5jLW9uLXN0YXJ0dXBcbiAqICAgQWR2YW5jZWQgICBcdTIwMTQgc3RhdHVzLWJhciBpbmRpY2F0b3IgbW9kZSwgaWdub3JlIHBhdHRlcm5zLCBkaWFnbm9zdGljc1xuICogICAgICAgICAgICAgICAgKGxvZyBsZXZlbCArIENvcHkgZGlhZ25vc3RpY3MpXG4gKiAgIEFib3V0ICAgICAgXHUyMDE0IHZlcnNpb25zLCBzdG9yYWdlIHVzYWdlLCBwcm9qZWN0IFJFQURNRSBsaW5rXG4gKlxuICogQWxsIGxvZ2ljIGxpdmVzIG9uIGBWYXVsdFN5bmNQbHVnaW5gOyB0aGUgdGFiIGlzIHByZXNlbnRhdGlvbiBwbHVzIHdpcmluZy5cbiAqL1xuXG5pbXBvcnQgeyBNb2RhbCwgTm90aWNlLCBQbHVnaW5TZXR0aW5nVGFiLCBTZXR0aW5nIH0gZnJvbSAnb2JzaWRpYW4nO1xuaW1wb3J0IHR5cGUgeyBBcHAgfSBmcm9tICdvYnNpZGlhbic7XG5pbXBvcnQge1xuICBkZWZhdWx0RGV2aWNlTmFtZSxcbiAgUkVTQ0FOX0lOVEVSVkFMX0NIT0lDRVMsXG4gIHR5cGUgTG9nTGV2ZWwsXG4gIHR5cGUgVmF1bHRTeW5jUGx1Z2luRGF0YSxcbn0gZnJvbSAnLi9kYXRhLmpzJztcbmltcG9ydCB0eXBlIHsgUGFpck91dGNvbWUgfSBmcm9tICcuL3BhaXJpbmcuanMnO1xuaW1wb3J0IHsgcGFpck91dGNvbWVNZXNzYWdlIH0gZnJvbSAnLi9wYWlyaW5nLmpzJztcbmltcG9ydCB7IGZvcm1hdEJ5dGVzLCBQUk9UT0NPTF9WRVJTSU9OIH0gZnJvbSAnLi9kaWFnbm9zdGljcy5qcyc7XG5pbXBvcnQgeyBmb3JtYXRTaW5jZSB9IGZyb20gJy4vc3RhdHVzYmFyLmpzJztcbmltcG9ydCB0eXBlIHsgVmF1bHRTeW5jUGx1Z2luIH0gZnJvbSAnLi9wbHVnaW4uanMnO1xuXG4vKipcbiAqIENsb3VkZmxhcmUgRGVwbG95IEJ1dHRvbiB0YXJnZXQgKEZSLTIxKTogcHJvdmlzaW9ucyBhIHByZWNvbmZpZ3VyZWQgd29ya2VyXG4gKiArIER1cmFibGUgT2JqZWN0ICsgUjIgYnVja2V0IGluIHRoZSB1c2VyJ3Mgb3duIGFjY291bnQgXHUyMDE0IG5vIHdyYW5nbGVyLCBub1xuICogbWFudWFsIGNvbmZpZy4gVGhlIHRlbXBsYXRlIHJlcG8gcGlucyBhIHJlbGVhc2VkIHdvcmtlciB2ZXJzaW9uLlxuICovXG5leHBvcnQgY29uc3QgREVQTE9ZX1VSTCA9XG4gICdodHRwczovL2RlcGxveS53b3JrZXJzLmNsb3VkZmxhcmUuY29tLz91cmw9JyArXG4gICdodHRwczovL2dpdGh1Yi5jb20vYW51Y2hpbi92YXVsdHN5bmNmb3JhZ2VudHMtdGVtcGxhdGUnO1xuXG4vKiogVGhlIHByb2plY3QgUkVBRE1FICh0aGUgQWJvdXQgc2VjdGlvbidzIGxpbmspLiAqL1xuZXhwb3J0IGNvbnN0IFBST0pFQ1RfUkVBRE1FX1VSTCA9ICdodHRwczovL2dpdGh1Yi5jb20vYW51Y2hpbi92YXVsdHN5bmNmb3JhZ2VudHMjcmVhZG1lJztcblxuLyoqIE9wZW4gdGhlIGRlcGxveSBwYWdlIGluIHRoZSBzeXN0ZW0gYnJvd3NlciAobm8tb3Agd2hlcmUgYHdpbmRvd2AgaXMgYWJzZW50KS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBvcGVuRGVwbG95UGFnZSgpOiB2b2lkIHtcbiAgaWYgKHR5cGVvZiB3aW5kb3cgPT09ICd1bmRlZmluZWQnKSByZXR1cm47XG4gIHdpbmRvdy5vcGVuKERFUExPWV9VUkwsICdfYmxhbmsnKTtcbn1cblxuLyoqIE9wZW4gdGhlIHByb2plY3QgUkVBRE1FIGluIHRoZSBzeXN0ZW0gYnJvd3NlciAobm8tb3Agd2l0aG91dCBgd2luZG93YCkuICovXG5leHBvcnQgZnVuY3Rpb24gb3BlblJlYWRtZVBhZ2UoKTogdm9pZCB7XG4gIGlmICh0eXBlb2Ygd2luZG93ID09PSAndW5kZWZpbmVkJykgcmV0dXJuO1xuICB3aW5kb3cub3BlbihQUk9KRUNUX1JFQURNRV9VUkwsICdfYmxhbmsnKTtcbn1cblxuLyoqIFNtYWxsIGNvbmZpcm1hdGlvbiBkaWFsb2cgKHRoZSB1bmxpbmsgYnV0dG9uJ3Mgc2FmZXR5IG5ldCkuICovXG5leHBvcnQgY2xhc3MgQ29uZmlybU1vZGFsIGV4dGVuZHMgTW9kYWwge1xuICBjb25zdHJ1Y3RvcihcbiAgICBhcHA6IEFwcCxcbiAgICBwcml2YXRlIHJlYWRvbmx5IG9wdGlvbnM6IHtcbiAgICAgIHRpdGxlOiBzdHJpbmc7XG4gICAgICBib2R5OiBzdHJpbmc7XG4gICAgICBjb25maXJtVGV4dDogc3RyaW5nO1xuICAgICAgb25Db25maXJtOiAoKSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPjtcbiAgICB9LFxuICApIHtcbiAgICBzdXBlcihhcHApO1xuICB9XG5cbiAgb3ZlcnJpZGUgb25PcGVuKCk6IHZvaWQge1xuICAgIG5ldyBTZXR0aW5nKHRoaXMuY29udGVudEVsKS5zZXROYW1lKHRoaXMub3B0aW9ucy50aXRsZSkuc2V0RGVzYyh0aGlzLm9wdGlvbnMuYm9keSk7XG4gICAgbmV3IFNldHRpbmcodGhpcy5jb250ZW50RWwpLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoJ0NhbmNlbCcpLm9uQ2xpY2soKCkgPT4gdGhpcy5jbG9zZSgpKSxcbiAgICApO1xuICAgIG5ldyBTZXR0aW5nKHRoaXMuY29udGVudEVsKS5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgIGJ1dHRvblxuICAgICAgICAuc2V0Q3RhKClcbiAgICAgICAgLnNldEJ1dHRvblRleHQodGhpcy5vcHRpb25zLmNvbmZpcm1UZXh0KVxuICAgICAgICAub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgdGhpcy5jbG9zZSgpO1xuICAgICAgICAgIGF3YWl0IHRoaXMub3B0aW9ucy5vbkNvbmZpcm0oKTtcbiAgICAgICAgfSksXG4gICAgKTtcbiAgfVxufVxuXG5leHBvcnQgY2xhc3MgVmF1bHRTeW5jU2V0dGluZ1RhYiBleHRlbmRzIFBsdWdpblNldHRpbmdUYWIge1xuICBwcml2YXRlIHJlYWRvbmx5IHBsdWdpbjogVmF1bHRTeW5jUGx1Z2luO1xuICAvKiogUGFpcmluZyBjb2RlcyBuZXZlciB0b3VjaCBkaXNrIFx1MjAxNCB0aGV5IGFyZSBvbmUtdGltZSwgc2hvcnQtbGl2ZWQgc2VjcmV0cy4gKi9cbiAgcHJpdmF0ZSBwYWlyaW5nQ29kZSA9ICcnO1xuICAvKipcbiAgICogTGlua2VkLW1vZGUgZGV2aWNlLW5hbWUgZHJhZnQ6IGVkaXRzIHN0YWdlIGhlcmUgKE5PVCBpbiBwbHVnaW4gZGF0YSkgc28gYVxuICAgKiBmYWlsZWQgcmVuYW1lIGNhbm5vdCBsZWF2ZSB0aGUgbG9jYWwgbmFtZSBvdXQgb2Ygc3luYyB3aXRoIHRoZSB3b3JrZXIuXG4gICAqL1xuICBwcml2YXRlIHJlbmFtZURyYWZ0OiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBoaW50U2V0dGluZzogU2V0dGluZyB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHN0YXR1c1NldHRpbmc6IFNldHRpbmcgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBzdG9yYWdlU2V0dGluZzogU2V0dGluZyB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHJlZnJlc2hIYW5kbGU6IFJldHVyblR5cGU8dHlwZW9mIHNldEludGVydmFsPiB8IG51bGwgPSBudWxsO1xuXG4gIGNvbnN0cnVjdG9yKGFwcDogQXBwLCBwbHVnaW46IFZhdWx0U3luY1BsdWdpbikge1xuICAgIHN1cGVyKGFwcCwgcGx1Z2luKTtcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcbiAgfVxuXG4gIG92ZXJyaWRlIGRpc3BsYXkoKTogdm9pZCB7XG4gICAgdGhpcy5zdG9wUmVmcmVzaCgpO1xuICAgIGNvbnN0IHsgY29udGFpbmVyRWwgfSA9IHRoaXM7XG4gICAgY29udGFpbmVyRWwuZW1wdHkoKTtcbiAgICB0aGlzLmhpbnRTZXR0aW5nID0gbnVsbDtcbiAgICB0aGlzLnN0YXR1c1NldHRpbmcgPSBudWxsO1xuICAgIHRoaXMuc3RvcmFnZVNldHRpbmcgPSBudWxsO1xuICAgIHRoaXMucmVuYW1lRHJhZnQgPSBudWxsO1xuXG4gICAgdGhpcy5yZW5kZXJDb25uZWN0aW9uU2VjdGlvbigpO1xuICAgIHRoaXMucmVuZGVyU3luY1NlY3Rpb24oKTtcbiAgICB0aGlzLnJlbmRlckFkdmFuY2VkU2VjdGlvbigpO1xuICAgIHRoaXMucmVuZGVyQWJvdXRTZWN0aW9uKCk7XG4gICAgdGhpcy5zdGFydFJlZnJlc2goKTtcbiAgfVxuXG4gIG92ZXJyaWRlIGhpZGUoKTogdm9pZCB7XG4gICAgdGhpcy5zdG9wUmVmcmVzaCgpO1xuICB9XG5cbiAgLy8gLS0tIHNlY3Rpb25zIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgcHJpdmF0ZSBoZWFkaW5nKHRleHQ6IHN0cmluZyk6IHZvaWQge1xuICAgIG5ldyBTZXR0aW5nKHRoaXMuY29udGFpbmVyRWwpLnNldE5hbWUodGV4dCkuc2V0SGVhZGluZygpO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJDb25uZWN0aW9uU2VjdGlvbigpOiB2b2lkIHtcbiAgICBjb25zdCB7IGNvbnRhaW5lckVsIH0gPSB0aGlzO1xuICAgIHRoaXMuaGVhZGluZygnQ29ubmVjdGlvbicpO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnV29ya2VyIFVSTCcpXG4gICAgICAuc2V0RGVzYyhcbiAgICAgICAgJ1lvdXIgc3luYyB3b3JrZXIsIGUuZy4gaHR0cHM6Ly9wZXJzb25hbC54LndvcmtlcnMuZGV2LiBObyB3b3JrZXIgeWV0PyBVc2UgXCJEZXBsb3kgeW91ciB3b3JrZXJcIiBiZWxvdywgb3BlbiB0aGUgVVJMIGluIGEgYnJvd3NlciwgYW5kIGNsYWltIGl0LicsXG4gICAgICApXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT5cbiAgICAgICAgdGV4dFxuICAgICAgICAgIC5zZXRQbGFjZWhvbGRlcignaHR0cHM6Ly9wZXJzb25hbC54LndvcmtlcnMuZGV2JylcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uZGF0YS51cmwpXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4uZGF0YS51cmwgPSB2YWx1ZS50cmltKCk7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlUGx1Z2luRGF0YSgpO1xuICAgICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIGlmICh0aGlzLnBsdWdpbi5saW5rZWQpIHtcbiAgICAgIHRoaXMucmVuZGVyTGlua2VkRGV2aWNlTmFtZSgpO1xuICAgICAgdGhpcy5yZW5kZXJMaW5rZWRTdGF0dXMoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5yZW5kZXJQYWlyaW5nRGV2aWNlTmFtZSgpO1xuICAgICAgdGhpcy5yZW5kZXJQYWlyaW5nU2VjdGlvbigpO1xuICAgIH1cbiAgfVxuXG4gIC8qKiBVbmxpbmtlZDogdGhlIG5hbWUgaXMgYSBwYWlyaW5nLXRpbWUgZGVmYXVsdCAoYXBwbGllcyBhdCBuZXh0IHBhaXIpLiAqL1xuICBwcml2YXRlIHJlbmRlclBhaXJpbmdEZXZpY2VOYW1lKCk6IHZvaWQge1xuICAgIG5ldyBTZXR0aW5nKHRoaXMuY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnRGV2aWNlIG5hbWUnKVxuICAgICAgLnNldERlc2MoYFNob3duIGluIHRoZSB3b3JrZXIgZGFzaGJvYXJkJ3MgZGV2aWNlIGxpc3QuIEFwcGxpZXMgd2hlbiAocmUpcGFpcmluZy5gKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHRcbiAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoZGVmYXVsdERldmljZU5hbWUoKSlcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uZGF0YS5kZXZpY2VOYW1lKVxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLmRhdGEuZGV2aWNlTmFtZSA9IHZhbHVlLnRyaW0oKTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVQbHVnaW5EYXRhKCk7XG4gICAgICAgICAgfSksXG4gICAgICApO1xuICB9XG5cbiAgLyoqIExpbmtlZDogdGhlIGZpZWxkIHNob3dzIHRoZSBjdXJyZW50IG5hbWU7IFJlbmFtZSBwdXNoZXMgaXQgdG8gdGhlIHdvcmtlci4gKi9cbiAgcHJpdmF0ZSByZW5kZXJMaW5rZWREZXZpY2VOYW1lKCk6IHZvaWQge1xuICAgIGNvbnN0IGN1cnJlbnQgPSB0aGlzLnJlbmFtZURyYWZ0ID8/IHRoaXMucGx1Z2luLmRhdGEuZGV2aWNlTmFtZTtcbiAgICBuZXcgU2V0dGluZyh0aGlzLmNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ0RldmljZSBuYW1lJylcbiAgICAgIC5zZXREZXNjKFxuICAgICAgICAnVGhlIHdvcmtlciBkYXNoYm9hcmQgc2hvd3MgdGhpcyBuYW1lLiBFZGl0IGl0IGFuZCBwcmVzcyBcIlJlbmFtZSBkZXZpY2VcIiB0byB1cGRhdGUgdGhpcyBkZXZpY2Ugb24gdGhlIHdvcmtlciAoMS0zMCBjaGFyYWN0ZXJzKS4nLFxuICAgICAgKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHRcbiAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoZGVmYXVsdERldmljZU5hbWUoKSlcbiAgICAgICAgICAuc2V0VmFsdWUoY3VycmVudClcbiAgICAgICAgICAub25DaGFuZ2UoKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnJlbmFtZURyYWZ0ID0gdmFsdWU7XG4gICAgICAgICAgfSksXG4gICAgICApXG4gICAgICAuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KCdSZW5hbWUgZGV2aWNlJykub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgYnV0dG9uLnNldERpc2FibGVkKHRydWUpO1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBvayA9IGF3YWl0IHRoaXMucGx1Z2luLnJlbmFtZURldmljZSh0aGlzLnJlbmFtZURyYWZ0ID8/IHRoaXMucGx1Z2luLmRhdGEuZGV2aWNlTmFtZSk7XG4gICAgICAgICAgICBpZiAob2spIHRoaXMuZGlzcGxheSgpOyAvLyByZS1yZW5kZXIgd2l0aCB0aGUgcGVyc2lzdGVkIG5hbWVcbiAgICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgICAgYnV0dG9uLnNldERpc2FibGVkKGZhbHNlKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pLFxuICAgICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyUGFpcmluZ1NlY3Rpb24oKTogdm9pZCB7XG4gICAgY29uc3QgeyBjb250YWluZXJFbCB9ID0gdGhpcztcbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdQYWlyaW5nIGNvZGUnKVxuICAgICAgLnNldERlc2MoJ0Zyb20geW91ciB3b3JrZXIgZGFzaGJvYXJkOiBEZXZpY2VzIFx1MjE5MiBQYWlyIG5ldyBkZXZpY2UuIENvZGVzIGFyZSBvbmUtdGltZSBhbmQgZXhwaXJlIGFmdGVyIDEwIG1pbnV0ZXMuJylcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PlxuICAgICAgICB0ZXh0XG4gICAgICAgICAgLnNldFBsYWNlaG9sZGVyKCc3RjNLLVE5TTInKVxuICAgICAgICAgIC5vbkNoYW5nZSgodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMucGFpcmluZ0NvZGUgPSB2YWx1ZS50cmltKCk7XG4gICAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgYnV0dG9uXG4gICAgICAgIC5zZXRDdGEoKVxuICAgICAgICAuc2V0QnV0dG9uVGV4dCgnUGFpciB0aGlzIHZhdWx0JylcbiAgICAgICAgLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGJ1dHRvbi5zZXREaXNhYmxlZCh0cnVlKTtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3Qgb3V0Y29tZSA9IGF3YWl0IHRoaXMucGx1Z2luLnBhaXJGcm9tU2V0dGluZ3ModGhpcy5wYWlyaW5nQ29kZSk7XG4gICAgICAgICAgICB0aGlzLnNob3dPdXRjb21lKG91dGNvbWUpO1xuICAgICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICBidXR0b24uc2V0RGlzYWJsZWQoZmFsc2UpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSksXG4gICAgKTtcblxuICAgIHRoaXMuaGludFNldHRpbmcgPSBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdHZXR0aW5nIHN0YXJ0ZWQnKVxuICAgICAgLnNldENsYXNzKCd2c2Etc2V0dGluZ3MtaGludCcpXG4gICAgICAuc2V0RGVzYyhcbiAgICAgICAgW1xuICAgICAgICAgICcxLiBEZXBsb3kgeW91ciBvd24gd29ya2VyIHdpdGggdGhlIGJ1dHRvbiBiZWxvdyAoeW91ciBDbG91ZGZsYXJlIGFjY291bnQsIHByZWNvbmZpZ3VyZWQgXHUyMDE0IG5vIHdyYW5nbGVyKS4nLFxuICAgICAgICAgICcyLiBPcGVuIHRoZSB3b3JrZXIgVVJMIGluIGEgYnJvd3NlciBhbmQgc2V0IHRoZSBhZG1pbiBwYXNzcGhyYXNlIChjbGFpbSkuJyxcbiAgICAgICAgICAnMy4gQ3JlYXRlIGEgcGFpcmluZyBjb2RlIG9uIHRoZSBkYXNoYm9hcmQsIHBhc3RlIGl0IGFib3ZlLCBhbmQgcGFpci4nLFxuICAgICAgICAgICdPbiBhIHBob25lLCBzY2FubmluZyB0aGUgZGFzaGJvYXJkIFFSIG9yIHRhcHBpbmcgaXRzIG9ic2lkaWFuOi8vIGxpbmsgcGFpcnMgd2l0aG91dCB0eXBpbmcuJyxcbiAgICAgICAgXS5qb2luKCdcXG4nKSxcbiAgICAgIClcbiAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoJ0RlcGxveSB5b3VyIHdvcmtlcicpLm9uQ2xpY2soKCkgPT4gb3BlbkRlcGxveVBhZ2UoKSksXG4gICAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJMaW5rZWRTdGF0dXMoKTogdm9pZCB7XG4gICAgY29uc3QgeyBjb250YWluZXJFbCB9ID0gdGhpcztcblxuICAgIHRoaXMuc3RhdHVzU2V0dGluZyA9IG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ1N0YXR1cycpXG4gICAgICAuc2V0Q2xhc3MoJ3ZzYS1zdGF0dXMtcmVhZG91dCcpXG4gICAgICAuc2V0RGVzYyh0aGlzLnN0YXR1c1RleHQoKSk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbCkuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICBidXR0b24uc2V0QnV0dG9uVGV4dCgnU3luYyBub3cnKS5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgYnV0dG9uLnNldERpc2FibGVkKHRydWUpO1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnN5bmNOb3coKTtcbiAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICBidXR0b24uc2V0RGlzYWJsZWQoZmFsc2UpO1xuICAgICAgICAgIHRoaXMucmVmcmVzaFN0YXR1cygpO1xuICAgICAgICB9XG4gICAgICB9KSxcbiAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoJ1VubGluayB0aGlzIHZhdWx0Jykub25DbGljaygoKSA9PiB7XG4gICAgICAgIG5ldyBDb25maXJtTW9kYWwodGhpcy5hcHAsIHtcbiAgICAgICAgICB0aXRsZTogJ1VubGluayBWYXVsdFN5bmM/JyxcbiAgICAgICAgICBib2R5OiAnVGhpcyBzdG9wcyBzeW5jaW5nIGFuZCBjbGVhcnMgdGhpcyBkZXZpY2VcXHUyMDE5cyBsb2NhbCBzeW5jIHN0YXRlLiBGaWxlcyBhbHJlYWR5IGluIHRoZSB2YXVsdCBhcmUgdW50b3VjaGVkLiBUaGUgd29ya2VyIGtlZXBzIHRoaXMgZGV2aWNlIGluIGl0cyByZWdpc3RyeSBcXHUyMDE0IHJldm9rZSBpdCBmcm9tIHRoZSBkYXNoYm9hcmQgaWYgeW91IGFyZSBkb25lIHdpdGggaXQuJyxcbiAgICAgICAgICBjb25maXJtVGV4dDogJ1VubGluaycsXG4gICAgICAgICAgb25Db25maXJtOiBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi51bmxpbmsoKTtcbiAgICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgICAgIH0sXG4gICAgICAgIH0pLm9wZW4oKTtcbiAgICAgIH0pLFxuICAgICk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlclN5bmNTZWN0aW9uKCk6IHZvaWQge1xuICAgIGNvbnN0IHsgY29udGFpbmVyRWwgfSA9IHRoaXM7XG4gICAgY29uc3QgZGF0YSA9IHRoaXMucGx1Z2luLmRhdGE7XG4gICAgdGhpcy5oZWFkaW5nKCdTeW5jJyk7XG5cbiAgICBpZiAodGhpcy5wbHVnaW4ubGlua2VkKSB7XG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUoJ1Jlc2NhbiBpbnRlcnZhbCcpXG4gICAgICAgIC5zZXREZXNjKFxuICAgICAgICAgICdQZXJpb2RpYyBmdWxsIHJlY29uY2lsaWF0aW9uIFx1MjAxNCBjYXRjaGVzIGV4dGVybmFsIGVkaXRzIHdoaWxlIE9ic2lkaWFuIGlzIG9wZW4gYW5kIGNvdmVycyBtb2JpbGUgYmFja2dyb3VuZCBsaW1pdHMuIFZhdWx0IGV2ZW50cyBhbmQgYXBwLW9wZW4gc3luYyBhbHdheXMgcnVuLicsXG4gICAgICAgIClcbiAgICAgICAgLmFkZERyb3Bkb3duKChkcm9wZG93bikgPT4ge1xuICAgICAgICAgIGZvciAoY29uc3QgY2hvaWNlIG9mIFJFU0NBTl9JTlRFUlZBTF9DSE9JQ0VTKSB7XG4gICAgICAgICAgICBkcm9wZG93bi5hZGRPcHRpb24oU3RyaW5nKGNob2ljZS52YWx1ZSksIGNob2ljZS5sYWJlbCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGRyb3Bkb3duLnNldFZhbHVlKFN0cmluZyhkYXRhLnNldHRpbmdzLnJlc2NhbkludGVydmFsU2VjKSk7XG4gICAgICAgICAgZHJvcGRvd24ub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5hcHBseVJlc2NhbkludGVydmFsKE51bWJlcih2YWx1ZSkpO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKCdTeW5jIC5vYnNpZGlhbi8gZm9sZGVyJylcbiAgICAgICAgLnNldERlc2MoXG4gICAgICAgICAgJ09wdCBpbiB0byBzeW5jaW5nIC5vYnNpZGlhbi8gKHNldHRpbmdzIGFuZCBwbHVnaW5zKSwgZXhjbHVkaW5nIHdvcmtzcGFjZS5qc29uIGFuZCBjYWNoZXMuICcgK1xuICAgICAgICAgICAgJ1RoZSB3b3JrZXJcXHUyMDE5cyBwZXItdmF1bHQgc2V0dGluZyB0YWtlcyBwcmVjZWRlbmNlIG9uY2UgY29ubmVjdGVkLicsXG4gICAgICAgIClcbiAgICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICAgIHRvZ2dsZS5zZXRWYWx1ZShkYXRhLnNldHRpbmdzLm9ic2lkaWFuU3luYykub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5hcHBseU9ic2lkaWFuU3luYyh2YWx1ZSk7XG4gICAgICAgICAgfSksXG4gICAgICAgICk7XG5cbiAgICAgIGNvbnN0IHBhdXNlZCA9IHRoaXMucGx1Z2luLnN5bmNpbmdQYXVzZWQ7XG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUocGF1c2VkID8gJ1N5bmNpbmcgcGF1c2VkJyA6ICdQYXVzZSBzeW5jaW5nJylcbiAgICAgICAgLnNldERlc2MoXG4gICAgICAgICAgcGF1c2VkXG4gICAgICAgICAgICA/ICdTeW5jaW5nIGlzIHBhdXNlZDogdGhlIGNvbm5lY3Rpb24gaXMgZG93biBhbmQgdmF1bHQgY2hhbmdlcyBzdGF5IGxvY2FsLiBSZXN1bWUgcmVjb25uZWN0cyBhbmQgcnVucyBhIGZ1bGwgY2F0Y2gtdXAgc3luYy4nXG4gICAgICAgICAgICA6ICdUZW1wb3JhcmlseSBzdG9wIHN5bmNpbmcgd2l0aG91dCB1bmxpbmtpbmcgXHUyMDE0IHRoZSB0cmFuc3BvcnQgZGlzY29ubmVjdHMgYW5kIHRoZSB3YXRjaGVyIGdvZXMgaWRsZS4gWW91ciBsaW5rIGFuZCBsb2NhbCBzdGF0ZSBhcmUga2VwdC4nLFxuICAgICAgICApXG4gICAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgICBidXR0b25cbiAgICAgICAgICAgIC5zZXRCdXR0b25UZXh0KHBhdXNlZCA/ICdSZXN1bWUgc3luY2luZycgOiAnUGF1c2Ugc3luY2luZycpXG4gICAgICAgICAgICAub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICAgIGJ1dHRvbi5zZXREaXNhYmxlZCh0cnVlKTtcbiAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBpZiAocGF1c2VkKSBhd2FpdCB0aGlzLnBsdWdpbi5yZXN1bWVTeW5jaW5nKCk7XG4gICAgICAgICAgICAgICAgZWxzZSB0aGlzLnBsdWdpbi5wYXVzZVN5bmNpbmcoKTtcbiAgICAgICAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICAgICAgICB0aGlzLmRpc3BsYXkoKTsgLy8gcmUtcmVuZGVyOiB0aGUgYnV0dG9uIChhbmQgbGFiZWwpIGZsaXBcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSksXG4gICAgICAgICk7XG4gICAgfVxuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnU3luYyBvbiBzdGFydHVwJylcbiAgICAgIC5zZXREZXNjKFxuICAgICAgICAnT04gKGRlZmF1bHQpOiBzeW5jIHN0YXJ0cyBhcyBzb29uIGFzIE9ic2lkaWFuIG9wZW5zLiBPRkY6IHRoZSBwbHVnaW4gbG9hZHMgaWRsZSBhbmQgdGhlIGZpcnN0IFwiU3luYyBub3dcIiBwcmVzcyBzdGFydHMgc3luY2luZyAobWFudWFsLW9ubHkgbW9kZSkuJyxcbiAgICAgIClcbiAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgdG9nZ2xlLnNldFZhbHVlKGRhdGEuc2V0dGluZ3Muc3luY09uU3RhcnR1cCkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uYXBwbHlTeW5jT25TdGFydHVwKHZhbHVlKTtcbiAgICAgICAgfSksXG4gICAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJBZHZhbmNlZFNlY3Rpb24oKTogdm9pZCB7XG4gICAgY29uc3QgeyBjb250YWluZXJFbCB9ID0gdGhpcztcbiAgICBjb25zdCBkYXRhID0gdGhpcy5wbHVnaW4uZGF0YTtcbiAgICB0aGlzLmhlYWRpbmcoJ0FkdmFuY2VkJyk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdTdGF0dXMgYmFyIGluZGljYXRvcicpXG4gICAgICAuc2V0RGVzYyhcbiAgICAgICAgJ0RldGFpbGVkOiBcInZzYSBcdTI3MTMgMTJzXCIgd2l0aCBzdGF0ZSBhbmQgYWdlLiBDb21wYWN0OiBqdXN0IHRoZSBzeW1ib2wuIEhpZGRlbjogbm8gc3RhdHVzIGJhciBpdGVtIGF0IGFsbC4nLFxuICAgICAgKVxuICAgICAgLmFkZERyb3Bkb3duKChkcm9wZG93bikgPT4ge1xuICAgICAgICBkcm9wZG93bi5hZGRPcHRpb24oJ2RldGFpbGVkJywgJ0RldGFpbGVkJyk7XG4gICAgICAgIGRyb3Bkb3duLmFkZE9wdGlvbignY29tcGFjdCcsICdDb21wYWN0Jyk7XG4gICAgICAgIGRyb3Bkb3duLmFkZE9wdGlvbignaGlkZGVuJywgJ0hpZGRlbicpO1xuICAgICAgICBkcm9wZG93bi5zZXRWYWx1ZShkYXRhLnNldHRpbmdzLnN0YXR1c0Jhck1vZGUpO1xuICAgICAgICBkcm9wZG93bi5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5hcHBseVN0YXR1c0Jhck1vZGUoXG4gICAgICAgICAgICB2YWx1ZSA9PT0gJ2NvbXBhY3QnIHx8IHZhbHVlID09PSAnaGlkZGVuJyA/IHZhbHVlIDogJ2RldGFpbGVkJyxcbiAgICAgICAgICApO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnSWdub3JlIHBhdHRlcm5zJylcbiAgICAgIC5zZXREZXNjKFxuICAgICAgICAnT25lIHBhdHRlcm4gcGVyIGxpbmUsIGUuZy4gcHJpdmF0ZS8qKiBvciAqLnRtcC4gR2xvYi1saXRlOiAqIG1hdGNoZXMgd2l0aGluIG9uZSBmb2xkZXIgbmFtZSwgKiogc3BhbnMgZm9sZGVycyAoZGlyLyoqIHNraXBzIHRoZSBmb2xkZXIgYW5kIGV2ZXJ5dGhpbmcgaW4gaXQpOyBhIHBhdHRlcm4gd2l0aG91dCAvIG1hdGNoZXMgZmlsZSBuYW1lcyBhdCBhbnkgZGVwdGguIENhc2UtaW5zZW5zaXRpdmU7IGFwcGxpZXMgb24gdGhpcyBkZXZpY2Ugb25seTsgc2F2aW5nIHJlY29ubmVjdHMgc3luYyB0byBhcHBseSB0aGVtLicsXG4gICAgICApXG4gICAgICAuYWRkVGV4dEFyZWEoKGFyZWEpID0+XG4gICAgICAgIGFyZWFcbiAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoJ3ByaXZhdGUvKipcXG4qLnRtcCcpXG4gICAgICAgICAgLnNldFZhbHVlKGRhdGEuc2V0dGluZ3MuaWdub3JlUGF0dGVybnMpXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uYXBwbHlJZ25vcmVQYXR0ZXJucyh2YWx1ZSk7XG4gICAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnRGlhZ25vc3RpY3MgbG9nIGxldmVsJylcbiAgICAgIC5zZXREZXNjKFxuICAgICAgICAnaW5mbyAoZGVmYXVsdCkgcmVjb3JkcyBsaWZlY3ljbGUgZXZlbnRzOyBkZWJ1ZyBhZGRpdGlvbmFsbHkgbG9ncyBwcm90b2NvbCByb3VuZC10cmlwcyAob25lIHNob3J0IGxpbmUgcGVyIGZyYW1lKTsgd2FybiBrZWVwcyBvbmx5IHdhcm5pbmdzIGFuZCBlcnJvcnMuJyxcbiAgICAgIClcbiAgICAgIC5hZGREcm9wZG93bigoZHJvcGRvd24pID0+IHtcbiAgICAgICAgZHJvcGRvd24uYWRkT3B0aW9uKCdpbmZvJywgJ2luZm8nKTtcbiAgICAgICAgZHJvcGRvd24uYWRkT3B0aW9uKCdkZWJ1ZycsICdkZWJ1ZycpO1xuICAgICAgICBkcm9wZG93bi5hZGRPcHRpb24oJ3dhcm4nLCAnd2FybicpO1xuICAgICAgICBkcm9wZG93bi5zZXRWYWx1ZShkYXRhLnNldHRpbmdzLmxvZ0xldmVsKTtcbiAgICAgICAgZHJvcGRvd24ub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgY29uc3QgbGV2ZWw6IExvZ0xldmVsID0gdmFsdWUgPT09ICdkZWJ1ZycgfHwgdmFsdWUgPT09ICd3YXJuJyA/IHZhbHVlIDogJ2luZm8nO1xuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLmFwcGx5TG9nTGV2ZWwobGV2ZWwpO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnQ29weSBkaWFnbm9zdGljcycpXG4gICAgICAuc2V0RGVzYyhcbiAgICAgICAgJ0NvcGllcyBhIGJ1Zy1yZXBvcnQgYnVuZGxlOiBwbHVnaW4gKyBwcm90b2NvbCB2ZXJzaW9ucywgZGV2aWNlLCB3b3JrZXIgVVJMLCBwYWlyaW5nIHN0YXRlLCBhIHN0YXR1cyBzbmFwc2hvdCwgdGhlIHBsYXRmb3JtLCBhbmQgdGhlIGxhc3QgMjAgbG9nIGxpbmVzLicsXG4gICAgICApXG4gICAgICAuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KCdDb3B5IGRpYWdub3N0aWNzJykub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgYnV0dG9uLnNldERpc2FibGVkKHRydWUpO1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5jb3B5RGlhZ25vc3RpY3MoKTtcbiAgICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgICAgYnV0dG9uLnNldERpc2FibGVkKGZhbHNlKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pLFxuICAgICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyQWJvdXRTZWN0aW9uKCk6IHZvaWQge1xuICAgIGNvbnN0IHsgY29udGFpbmVyRWwgfSA9IHRoaXM7XG4gICAgdGhpcy5oZWFkaW5nKCdBYm91dCcpO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnVmVyc2lvbnMnKVxuICAgICAgLnNldERlc2MoXG4gICAgICAgIGBQbHVnaW4gJHt0aGlzLnBsdWdpbi5tYW5pZmVzdC52ZXJzaW9uIHx8ICd1bmtub3duJ30gXHUwMEI3IHByb3RvY29sIHYke1BST1RPQ09MX1ZFUlNJT059IFx1MDBCNyAke3RoaXMucGx1Z2luLnBsYXRmb3JtU3VtbWFyeSgpfWAsXG4gICAgICApO1xuXG4gICAgdGhpcy5zdG9yYWdlU2V0dGluZyA9IG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ1ZhdWx0IHN0b3JhZ2UnKVxuICAgICAgLnNldERlc2ModGhpcy5wbHVnaW4ubGlua2VkID8gJ0NoZWNraW5nIHRoZSB3b3JrZXJcdTIwMjYnIDogJ1BhaXIgdGhpcyB2YXVsdCB0byBzZWUgc3RvcmFnZSB1c2FnZS4nKTtcbiAgICBpZiAodGhpcy5wbHVnaW4ubGlua2VkKSB2b2lkIHRoaXMucmVmcmVzaFN0b3JhZ2UoKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ1Byb2plY3QgaG9tZScpXG4gICAgICAuc2V0RGVzYyhgRG9jdW1lbnRhdGlvbiBhbmQgc291cmNlOiAke1BST0pFQ1RfUkVBRE1FX1VSTH1gKVxuICAgICAgLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgICBidXR0b24uc2V0QnV0dG9uVGV4dCgnT3BlbiBSRUFETUUnKS5vbkNsaWNrKCgpID0+IG9wZW5SZWFkbWVQYWdlKCkpLFxuICAgICAgKTtcbiAgfVxuXG4gIC8qKiBGaWxsIHRoZSBBYm91dCBzdG9yYWdlIGxpbmUgZnJvbSAvYXBpL3N0YXR1cyAoZGV2aWNlLXRva2VuIGF1dGgpLiAqL1xuICBwcml2YXRlIGFzeW5jIHJlZnJlc2hTdG9yYWdlKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHN1bW1hcnkgPSBhd2FpdCB0aGlzLnBsdWdpbi5mZXRjaFN0b3JhZ2VTdW1tYXJ5KCk7XG4gICAgY29uc3QgZGVzYyA9XG4gICAgICBzdW1tYXJ5ID09PSBudWxsXG4gICAgICAgID8gJ1N0b3JhZ2UgdXNhZ2UgaXMgY3VycmVudGx5IHVuYXZhaWxhYmxlICh0aGUgd29ya2VyIGlzIHVucmVhY2hhYmxlKS4nXG4gICAgICAgIDogYFN0b3JhZ2UgdXNlZDogJHtmb3JtYXRCeXRlcyhzdW1tYXJ5LnN0b3JhZ2VCeXRlcyl9IFx1MDBCNyAke3N1bW1hcnkuYXR0YWNobWVudHMuY291bnR9IGF0dGFjaG1lbnQke1xuICAgICAgICAgICAgc3VtbWFyeS5hdHRhY2htZW50cy5jb3VudCA9PT0gMSA/ICcnIDogJ3MnXG4gICAgICAgICAgfSAoJHtmb3JtYXRCeXRlcyhzdW1tYXJ5LmF0dGFjaG1lbnRzLmJ5dGVzKX0pYCArXG4gICAgICAgICAgKHN1bW1hcnkuZGV2aWNlcy5sZW5ndGggPiAwXG4gICAgICAgICAgICA/IGAgXHUwMEI3ICR7c3VtbWFyeS5kZXZpY2VzLmxlbmd0aH0gZGV2aWNlJHtzdW1tYXJ5LmRldmljZXMubGVuZ3RoID09PSAxID8gJycgOiAncyd9YFxuICAgICAgICAgICAgOiAnJyk7XG4gICAgLy8gVGhlIHRhYiBtYXkgaGF2ZSBiZWVuIGNsb3NlZC9yZS1yZW5kZXJlZCBtZWFud2hpbGU7IHBhaW50IG9ubHkgaWYgbGl2ZS5cbiAgICBpZiAodGhpcy5zdG9yYWdlU2V0dGluZyAhPT0gbnVsbCkgdGhpcy5zdG9yYWdlU2V0dGluZy5zZXREZXNjKGRlc2MpO1xuICB9XG5cbiAgLy8gLS0tIHN0YXR1cyAvIGZlZWRiYWNrIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgcHJpdmF0ZSBzdGF0dXNUZXh0KCk6IHN0cmluZyB7XG4gICAgY29uc3QgZGF0YTogVmF1bHRTeW5jUGx1Z2luRGF0YSA9IHRoaXMucGx1Z2luLmRhdGE7XG4gICAgY29uc3Qgc3RhdHVzID0gdGhpcy5wbHVnaW4uY2xpZW50Py5zdGF0dXMoKTtcbiAgICBpZiAodGhpcy5wbHVnaW4uc3luY2luZ1BhdXNlZCkge1xuICAgICAgcmV0dXJuIFtcbiAgICAgICAgJ1N0YXRlOiBwYXVzZWQnLFxuICAgICAgICBgV29ya2VyOiAke2RhdGEudXJsfWAsXG4gICAgICAgICdWYXVsdCBjaGFuZ2VzIHN0YXkgbG9jYWwgdW50aWwgeW91IHJlc3VtZSBzeW5jaW5nLicsXG4gICAgICBdLmpvaW4oJ1xcbicpO1xuICAgIH1cbiAgICBpZiAoc3RhdHVzID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHJldHVybiBgTGlua2VkIHRvICR7ZGF0YS51cmx9IChkZXZpY2UgJHtkYXRhLmRldmljZU5hbWUgfHwgZGF0YS5kZXZpY2VJZH0pLmA7XG4gICAgfVxuICAgIGNvbnN0IGxhc3RTeW5jID1cbiAgICAgIHN0YXR1cy5sYXN0U3luY0F0ID09PSBudWxsXG4gICAgICAgID8gJ25ldmVyJ1xuICAgICAgICA6IGAke2Zvcm1hdFNpbmNlKERhdGUubm93KCkgLSBzdGF0dXMubGFzdFN5bmNBdCl9IGFnb2A7XG4gICAgY29uc3Qgc3RhdGUgPSBzdGF0dXMuc3RhdGUgPT09ICdsaXZlJyA/ICdjb25uZWN0ZWQnIDogc3RhdHVzLnN0YXRlO1xuICAgIGNvbnN0IGxpbmVzID0gW2BTdGF0ZTogJHtzdGF0ZX1gLCBgV29ya2VyOiAke2RhdGEudXJsfWAsIGBMYXN0IHN5bmM6ICR7bGFzdFN5bmN9YF07XG4gICAgLy8gQnVsay1waGFzZSBwcm9ncmVzcyBcdTIwMTQgdGhlIHNhbWUgWC9ZIHRoZSBzdGF0dXMgYmFyIHNob3dzIGR1cmluZyBhXG4gICAgLy8gbXVsdGktbWludXRlIGluaXRpYWwgc3luYy5cbiAgICBpZiAoc3RhdHVzLnByb2dyZXNzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGxpbmVzLnB1c2goYFN5bmNpbmc6ICR7c3RhdHVzLnByb2dyZXNzLmRvbmV9LyR7c3RhdHVzLnByb2dyZXNzLnRvdGFsfSAoJHtzdGF0dXMucHJvZ3Jlc3MucGhhc2V9KWApO1xuICAgIH1cbiAgICBsaW5lcy5wdXNoKFxuICAgICAgYFBlbmRpbmcgY2hhbmdlczogJHtzdGF0dXMucGVuZGluZ31gLFxuICAgICAgYENvbmZsaWN0czogJHtzdGF0dXMuY29uZmxpY3RzLmxlbmd0aH0ke3N0YXR1cy5jb25mbGljdHMubGVuZ3RoID4gMCA/ICcgKGNvbmZsaWN0IGNvcGllcyB3ZXJlIHdyaXR0ZW4gaW50byB0aGUgdmF1bHQpJyA6ICcnfWAsXG4gICAgKTtcbiAgICByZXR1cm4gbGluZXMuam9pbignXFxuJyk7XG4gIH1cblxuICBwcml2YXRlIHJlZnJlc2hTdGF0dXMoKTogdm9pZCB7XG4gICAgdGhpcy5zdGF0dXNTZXR0aW5nPy5zZXREZXNjKHRoaXMuc3RhdHVzVGV4dCgpKTtcbiAgfVxuXG4gIC8qKiBQYWlyIGZlZWRiYWNrOiBzdWNjZXNzIHJlLXJlbmRlcnM7IGZhaWx1cmVzIGxhbmQgaW4gdGhlIGhpbnQgU2V0dGluZy4gKi9cbiAgcHJpdmF0ZSBzaG93T3V0Y29tZShvdXRjb21lOiBQYWlyT3V0Y29tZSk6IHZvaWQge1xuICAgIGlmIChvdXRjb21lLnN0YXR1cyA9PT0gJ3BhaXJlZCcpIHtcbiAgICAgIG5ldyBOb3RpY2UocGFpck91dGNvbWVNZXNzYWdlKG91dGNvbWUpKTtcbiAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBtZXNzYWdlID0gcGFpck91dGNvbWVNZXNzYWdlKG91dGNvbWUpO1xuICAgIG5ldyBOb3RpY2UobWVzc2FnZSwgMTAwMDApO1xuICAgIGlmICh0aGlzLmhpbnRTZXR0aW5nICE9PSBudWxsKSB0aGlzLmhpbnRTZXR0aW5nLnNldERlc2MobWVzc2FnZSk7XG4gIH1cblxuICAvLyAtLS0gbGl2ZSByZWZyZXNoIGxvb3AgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgLyoqIFJlZnJlc2ggdGhlIHN0YXR1cyByZWFkb3V0IH4xIEh6IHdoaWxlIHRoZSB0YWIgaXMgb3Blbi4gKi9cbiAgcHJpdmF0ZSBzdGFydFJlZnJlc2goKTogdm9pZCB7XG4gICAgdGhpcy5zdG9wUmVmcmVzaCgpO1xuICAgIGNvbnN0IGhhbmRsZSA9IHNldEludGVydmFsKCgpID0+IHRoaXMucmVmcmVzaFN0YXR1cygpLCAxMDAwKTtcbiAgICB0aGlzLnJlZnJlc2hIYW5kbGUgPSBoYW5kbGU7XG4gICAgLy8gT2JzaWRpYW4gY2xlYXJzIHJlZ2lzdGVyZWQgaW50ZXJ2YWxzIHdoZW4gdGhlIHBsdWdpbiB1bmxvYWRzIFx1MjAxNCBubyBsZWFrXG4gICAgLy8gZXZlbiBpZiB0aGUgc2V0dGluZ3MgbW9kYWwgaXMgZm9yY2UtY2xvc2VkLlxuICAgIHRoaXMucGx1Z2luLnJlZ2lzdGVySW50ZXJ2YWwoaGFuZGxlIGFzIHVua25vd24gYXMgbnVtYmVyKTtcbiAgfVxuXG4gIHByaXZhdGUgc3RvcFJlZnJlc2goKTogdm9pZCB7XG4gICAgaWYgKHRoaXMucmVmcmVzaEhhbmRsZSAhPT0gbnVsbCkge1xuICAgICAgY2xlYXJJbnRlcnZhbCh0aGlzLnJlZnJlc2hIYW5kbGUpO1xuICAgICAgdGhpcy5yZWZyZXNoSGFuZGxlID0gbnVsbDtcbiAgICB9XG4gIH1cbn1cbiIsICIvKipcbiAqIFN0YXR1cy1iYXIgaW5kaWNhdG9yIChwbHVnaW4gc2NvcGUgaXRlbSAjNSk6IGEgc21hbGwgcGFzc2l2ZSB2aWV3IG92ZXJcbiAqIGBTeW5jQ2xpZW50U3RhdHVzYCwgcmVwYWludGVkIGJ5IHRoZSBwbHVnaW4ncyAxIHMgc3VwZXJ2aXNpb24gdGljay5cbiAqXG4gKiAgIHZzYSBcdTIyRUYgICAgICAgICAgICAgIGNvbm5lY3RpbmcgLyBzeW5jaW5nXG4gKiAgIHZzYSBcdTIyRUYgMTIzNC81MDAwICAgIHN5bmNpbmcsIGJ1bGsgcGhhc2UgcHJvZ3Jlc3MgKHNjYW5uaW5nL3B1c2hpbmcvcHVsbGluZylcbiAqICAgdnNhIFx1MjcxMyAxMnMgICAgICAgICAgbGl2ZSwgbGFzdCBjb21wbGV0ZWQgY3ljbGUgMTIgcyBhZ29cbiAqICAgdnNhIFx1MjZBMCBjb25mbGljdHM6IDIgY29uZmxpY3RzIG9ic2VydmVkIChjb25mbGljdCBjb3BpZXMgZXhpc3QgaW4gdGhlIHZhdWx0KVxuICogICB2c2EgXHUyNzE3IG9mZmxpbmUgICAgICBkaXNjb25uZWN0ZWQgKHJlY29ubmVjdCBiYWNrb2ZmIHJ1bm5pbmcpXG4gKiAgIHZzYSBcdTIzRjggICAgICAgICAgICAgIHN5bmNpbmcgcGF1c2VkICh0aGUgUGF1c2Ugc3luY2luZyBzZXR0aW5nKVxuICpcbiAqIENvbXBhY3QgbW9kZSBkcm9wcyB0aGUgdHJhaWxpbmcgZGV0YWlsIChcInZzYSBcdTI3MTMgMTJzXCIgXHUyMTkyIFwidnNhIFx1MjcxM1wiLCBldGMuKTtcbiAqIEhpZGRlbiBtb2RlIHJlbW92ZXMgdGhlIGl0ZW0gZW50aXJlbHkgKHRoZSBwbHVnaW4gbmV2ZXIgbW91bnRzIGl0KS5cbiAqXG4gKiBUaGUgdG9vbHRpcCBjYXJyaWVzIHRoZSBkZXRhaWw6IHN0YXRlLCB3b3JrZXIgVVJMLCBkZXZpY2UsIGxhc3Qgc3luYywgcGVuZGluZy5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IFN5bmNDbGllbnRTdGF0dXMgfSBmcm9tICdAdnNhL2NvcmUnO1xuXG4vKiogSG93IHRoZSBzdGF0dXMtYmFyIGluZGljYXRvciByZW5kZXJzICh0aGUgXCJTdGF0dXMgYmFyIGluZGljYXRvclwiIHNldHRpbmcpLiAqL1xuZXhwb3J0IHR5cGUgU3RhdHVzQmFyTW9kZSA9ICdkZXRhaWxlZCcgfCAnY29tcGFjdCcgfCAnaGlkZGVuJztcblxuLyoqIFRoZSBzbGljZSBvZiBIVE1MRWxlbWVudCB0aGUgaW5kaWNhdG9yIHRvdWNoZXMgKHRlc3RzIHBhc3MgYSBwbGFpbiBvYmplY3QpLiAqL1xuZXhwb3J0IGludGVyZmFjZSBTdGF0dXNJdGVtTGlrZSB7XG4gIHRleHRDb250ZW50OiBzdHJpbmc7XG4gIGFkZENsYXNzPyhjbHM6IHN0cmluZyk6IHVua25vd247XG4gIHJlbW92ZUNsYXNzPyhjbHM6IHN0cmluZyk6IHVua25vd247XG4gIHNldEF0dHJpYnV0ZT8obmFtZTogc3RyaW5nLCB2YWx1ZTogc3RyaW5nKTogdW5rbm93bjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBTdGF0dXNDb250ZXh0IHtcbiAgdXJsOiBzdHJpbmc7XG4gIGRldmljZU5hbWU6IHN0cmluZztcbiAgLyoqIEV4dHJhIGxpbmUgKGUuZy4gYW4gYXV0aCBmYWlsdXJlIG5vdGUpIGFwcGVuZGVkIHRvIHRoZSB0b29sdGlwLiAqL1xuICBub3RlPzogc3RyaW5nO1xuICAvKiogU3luY2luZyBpcyBwYXVzZWQgKHRoZSBQYXVzZSBzeW5jaW5nIGJ1dHRvbikgXHUyMDE0IHNob3dzIFwidnNhIFx1MjNGOFwiLiAqL1xuICBwYXVzZWQ/OiBib29sZWFuO1xuICAvKiogSW5kaWNhdG9yIG1vZGUgKHRoZSBwbHVnaW4ncyBzdGF0dXMgYmFyIHNldHRpbmcpOyBkZWZhdWx0IGRldGFpbGVkLiAqL1xuICBtb2RlPzogU3RhdHVzQmFyTW9kZTtcbn1cblxuLyoqIGBub3cgLSBzaW5jZWAsIGZsb29yZWQ6IGAxMnNgLCBgNW1gLCBgM2hgIFx1MjAxNCBkaXNwbGF5IG9ubHkuICovXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0U2luY2UoZWxhcHNlZE1zOiBudW1iZXIpOiBzdHJpbmcge1xuICBjb25zdCBzZWNvbmRzID0gTWF0aC5tYXgoMCwgTWF0aC5mbG9vcihlbGFwc2VkTXMgLyAxMDAwKSk7XG4gIGlmIChzZWNvbmRzIDwgNjApIHJldHVybiBgJHtzZWNvbmRzfXNgO1xuICBjb25zdCBtaW51dGVzID0gTWF0aC5mbG9vcihzZWNvbmRzIC8gNjApO1xuICBpZiAobWludXRlcyA8IDYwKSByZXR1cm4gYCR7bWludXRlc31tYDtcbiAgcmV0dXJuIGAke01hdGguZmxvb3IobWludXRlcyAvIDYwKX1oYDtcbn1cblxuLyoqXG4gKiBUaGUgb25lLWxpbmUgc3RhdHVzIHRleHQgZm9yIGEgY2xpZW50IHN0YXR1cyBhdCB0aW1lIGBub3dgLiBgbW9kZWAgc2hyaW5rc1xuICogdGhlIGxpbmUgKGNvbXBhY3QgZHJvcHMgdGhlIHRyYWlsaW5nIGRldGFpbCk7IGBwYXVzZWRgIHdpbnMgb3ZlciBldmVyeXRoaW5nLlxuICpcbiAqIER1cmluZyBhIGJ1bGsgcGhhc2UgKGBzdGF0dXMucHJvZ3Jlc3NgIFx1MjAxNCBzY2FubmluZy9wdXNoaW5nL3B1bGxpbmcgb2YgYVxuICogbXVsdGktbWludXRlIGluaXRpYWwgc3luYykgYm90aCBkZXRhaWwgbGV2ZWxzIHNob3cgdGhlIGNvdW50cyBcdTIwMTRcbiAqIGB2c2EgXHUyMkVGIDEyMzQvNTAwMGAgXHUyMDE0IGJlY2F1c2UgdGhhdCBpcyB0aGUgb25lIHRoaW5nIGEgdXNlciB3YWl0aW5nIG9uIGEgYmlnXG4gKiBzeW5jIG5lZWRzOyBoaWRkZW4gbW9kZSBzaG93cyBub3RoaW5nICh0aGUgaXRlbSBpcyBuZXZlciBtb3VudGVkKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN0YXR1c0xpbmVGb3IoXG4gIHN0YXR1czogU3luY0NsaWVudFN0YXR1cyxcbiAgbm93OiBudW1iZXIsXG4gIG1vZGU6IFN0YXR1c0Jhck1vZGUgPSAnZGV0YWlsZWQnLFxuICBwYXVzZWQgPSBmYWxzZSxcbik6IHN0cmluZyB7XG4gIGlmIChwYXVzZWQpIHJldHVybiAndnNhIFx1MjNGOCc7XG4gIGNvbnN0IGNvbXBhY3QgPSBtb2RlID09PSAnY29tcGFjdCc7XG4gIHN3aXRjaCAoc3RhdHVzLnN0YXRlKSB7XG4gICAgY2FzZSAnY29ubmVjdGluZyc6XG4gICAgY2FzZSAnc3luY2luZyc6IHtcbiAgICAgIGNvbnN0IHByb2dyZXNzID0gc3RhdHVzLnByb2dyZXNzO1xuICAgICAgaWYgKHByb2dyZXNzICE9PSB1bmRlZmluZWQpIHJldHVybiBgdnNhIFx1MjJFRiAke3Byb2dyZXNzLmRvbmV9LyR7cHJvZ3Jlc3MudG90YWx9YDtcbiAgICAgIHJldHVybiAndnNhIFx1MjJFRic7XG4gICAgfVxuICAgIGNhc2UgJ2Rpc2Nvbm5lY3RlZCc6XG4gICAgICByZXR1cm4gY29tcGFjdCA/ICd2c2EgXHUyNzE3JyA6ICd2c2EgXHUyNzE3IG9mZmxpbmUnO1xuICAgIGNhc2UgJ2xpdmUnOlxuICAgICAgaWYgKHN0YXR1cy5jb25mbGljdHMubGVuZ3RoID4gMCkge1xuICAgICAgICByZXR1cm4gY29tcGFjdCA/ICd2c2EgXHUyNkEwJyA6IGB2c2EgXHUyNkEwIGNvbmZsaWN0czogJHtzdGF0dXMuY29uZmxpY3RzLmxlbmd0aH1gO1xuICAgICAgfVxuICAgICAgaWYgKHN0YXR1cy5sYXN0U3luY0F0ID09PSBudWxsIHx8IGNvbXBhY3QpIHJldHVybiAndnNhIFx1MjcxMyc7XG4gICAgICByZXR1cm4gYHZzYSBcdTI3MTMgJHtmb3JtYXRTaW5jZShub3cgLSBzdGF0dXMubGFzdFN5bmNBdCl9YDtcbiAgICBjYXNlICdpZGxlJzpcbiAgICAgIHJldHVybiAndnNhJztcbiAgfVxufVxuXG4vKiogVG9vbHRpcCBsaW5lcyAoam9pbmVkIHdpdGggYFxcbmApLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN0YXR1c1Rvb2x0aXBGb3Ioc3RhdHVzOiBTeW5jQ2xpZW50U3RhdHVzLCBjb250ZXh0OiBTdGF0dXNDb250ZXh0LCBub3c6IG51bWJlcik6IHN0cmluZyB7XG4gIGNvbnN0IHN0YXRlTGFiZWw6IFJlY29yZDxTeW5jQ2xpZW50U3RhdHVzWydzdGF0ZSddLCBzdHJpbmc+ID0ge1xuICAgIGlkbGU6ICdub3QgcnVubmluZycsXG4gICAgY29ubmVjdGluZzogJ2Nvbm5lY3RpbmdcdTIwMjYnLFxuICAgIHN5bmNpbmc6ICdzeW5jaW5nXHUyMDI2JyxcbiAgICBsaXZlOiAnbGl2ZScsXG4gICAgZGlzY29ubmVjdGVkOiAnb2ZmbGluZSBcdTIwMTQgcmVjb25uZWN0aW5nJyxcbiAgfTtcbiAgY29uc3QgaGVhZGxpbmUgPSBjb250ZXh0LnBhdXNlZCA9PT0gdHJ1ZSA/ICdwYXVzZWQnIDogc3RhdGVMYWJlbFtzdGF0dXMuc3RhdGVdO1xuICBjb25zdCBsaW5lcyA9IFtgVmF1bHRTeW5jIGZvciBBZ2VudHMgXHUyMDE0ICR7aGVhZGxpbmV9YF07XG4gIGlmIChjb250ZXh0LnVybCAhPT0gJycpIGxpbmVzLnB1c2goYFdvcmtlcjogJHtjb250ZXh0LnVybH1gKTtcbiAgaWYgKGNvbnRleHQuZGV2aWNlTmFtZSAhPT0gJycpIGxpbmVzLnB1c2goYERldmljZTogJHtjb250ZXh0LmRldmljZU5hbWV9YCk7XG4gIGxpbmVzLnB1c2goXG4gICAgc3RhdHVzLmxhc3RTeW5jQXQgPT09IG51bGxcbiAgICAgID8gJ0xhc3Qgc3luYzogbmV2ZXInXG4gICAgICA6IGBMYXN0IHN5bmM6ICR7Zm9ybWF0U2luY2Uobm93IC0gc3RhdHVzLmxhc3RTeW5jQXQpfSBhZ29gLFxuICApO1xuICBpZiAoc3RhdHVzLnByb2dyZXNzICE9PSB1bmRlZmluZWQpIHtcbiAgICBsaW5lcy5wdXNoKGBTeW5jaW5nOiAke3N0YXR1cy5wcm9ncmVzcy5kb25lfS8ke3N0YXR1cy5wcm9ncmVzcy50b3RhbH0gKCR7c3RhdHVzLnByb2dyZXNzLnBoYXNlfSlgKTtcbiAgfVxuICBsaW5lcy5wdXNoKGBQZW5kaW5nIGNoYW5nZXM6ICR7c3RhdHVzLnBlbmRpbmd9YCk7XG4gIGxpbmVzLnB1c2goYENvbmZsaWN0czogJHtzdGF0dXMuY29uZmxpY3RzLmxlbmd0aH1gKTtcbiAgaWYgKHN0YXR1cy5jb25mbGljdHMubGVuZ3RoID4gMCkge1xuICAgIGxpbmVzLnB1c2goYENvbmZsaWN0IGNvcGllczogJHtzdGF0dXMuY29uZmxpY3RzLm1hcCgoYykgPT4gYy5wYXRoKS5qb2luKCcsICcpfWApO1xuICB9XG4gIGlmIChjb250ZXh0Lm5vdGUgIT09IHVuZGVmaW5lZCAmJiBjb250ZXh0Lm5vdGUgIT09ICcnKSBsaW5lcy5wdXNoKGNvbnRleHQubm90ZSk7XG4gIHJldHVybiBsaW5lcy5qb2luKCdcXG4nKTtcbn1cblxuLyoqIENTUyBtb2RpZmllciBmb3IgdGhlIGluZGljYXRvciAodGludGVkIHdhcm5pbmcvZXJyb3Igc3RhdGVzKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdGF0dXNDbGFzc0ZvcihzdGF0dXM6IFN5bmNDbGllbnRTdGF0dXMpOiBzdHJpbmcge1xuICBpZiAoc3RhdHVzLnN0YXRlID09PSAnZGlzY29ubmVjdGVkJykgcmV0dXJuICd2c2EtZXJyb3InO1xuICBpZiAoc3RhdHVzLmNvbmZsaWN0cy5sZW5ndGggPiAwKSByZXR1cm4gJ3ZzYS13YXJuJztcbiAgcmV0dXJuICcnO1xufVxuXG4vKipcbiAqIFBhaW50cyBvbmUgc3RhdHVzLWJhciBpdGVtLiBQYXNzaXZlOiB0aGUgcGx1Z2luIGNhbGxzIGB1cGRhdGUoKWAgZnJvbSBpdHNcbiAqIHN1cGVydmlzaW9uIHRpY2sgXHUyMDE0IG5vIHRpbWVycyBvZiBpdHMgb3duIHRvIGxlYWsuXG4gKi9cbmV4cG9ydCBjbGFzcyBTdGF0dXNCYXJJbmRpY2F0b3Ige1xuICAvKiogQWx3YXlzIG9uIFx1MjAxNCB0aGUgYmFzZSBjbGFzcyBzdHlsZXMuY3NzIHRhcmdldHMuICovXG4gIHByaXZhdGUgc3RhdGljIHJlYWRvbmx5IEJBU0VfQ0xBU1MgPSAndnNhLXN0YXR1cyc7XG4gIHByaXZhdGUgc3RhdGljIHJlYWRvbmx5IE1PRElGSUVSX0NMQVNTRVMgPSBbJ3ZzYS13YXJuJywgJ3ZzYS1lcnJvciddO1xuXG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgaXRlbTogU3RhdHVzSXRlbUxpa2UpIHt9XG5cbiAgdXBkYXRlKHN0YXR1czogU3luY0NsaWVudFN0YXR1cywgY29udGV4dDogU3RhdHVzQ29udGV4dCwgbm93OiBudW1iZXIpOiB2b2lkIHtcbiAgICB0aGlzLml0ZW0udGV4dENvbnRlbnQgPSBzdGF0dXNMaW5lRm9yKHN0YXR1cywgbm93LCBjb250ZXh0Lm1vZGUgPz8gJ2RldGFpbGVkJywgY29udGV4dC5wYXVzZWQgPT09IHRydWUpO1xuICAgIHRoaXMuaXRlbS5hZGRDbGFzcz8uKFN0YXR1c0JhckluZGljYXRvci5CQVNFX0NMQVNTKTtcbiAgICBjb25zdCBtb2RpZmllciA9IHN0YXR1c0NsYXNzRm9yKHN0YXR1cyk7XG4gICAgZm9yIChjb25zdCBjbHMgb2YgU3RhdHVzQmFySW5kaWNhdG9yLk1PRElGSUVSX0NMQVNTRVMpIHtcbiAgICAgIGlmIChjbHMgPT09IG1vZGlmaWVyKSB0aGlzLml0ZW0uYWRkQ2xhc3M/LihjbHMpO1xuICAgICAgZWxzZSB0aGlzLml0ZW0ucmVtb3ZlQ2xhc3M/LihjbHMpO1xuICAgIH1cbiAgICB0aGlzLml0ZW0uc2V0QXR0cmlidXRlPy4oJ3RpdGxlJywgc3RhdHVzVG9vbHRpcEZvcihzdGF0dXMsIGNvbnRleHQsIG5vdykpO1xuICB9XG59XG4iLCAiLyoqXG4gKiBgV2ViU29ja2V0VHJhbnNwb3J0YCBcdTIwMTQgY29yZSdzIGBUcmFuc3BvcnRgIG92ZXIgdGhlIGdsb2JhbCBgV2ViU29ja2V0YFxuICogKHByZXNlbnQgaW4gT2JzaWRpYW4gZGVza3RvcCAqYW5kKiBtb2JpbGU7IGZlYXR1cmUtY2hlY2tlZCB3aXRoIGEgY2xlYXJcbiAqIGVycm9yIGZvciBleG90aWMgYnVpbGRzKS5cbiAqXG4gKiBUaGlzIG1pcnJvcnMgYEB2c2Evbm9kZS1ydW50aW1lYCdzIHRyYW5zcG9ydCBvbiBwdXJwb3NlIChzYW1lIHdpcmUgZm9ybWF0OlxuICogb25lIEpTT04gdGV4dCBmcmFtZSBwZXIgbWVzc2FnZSwgY29yZSdzIGBwYXJzZU1lc3NhZ2VgIG9uIHJlY2VpdmUsIHF1ZXVlZFxuICogc2VuZHMgYmVmb3JlIG9wZW4pIGJ1dCBzaGFyZXMgbm8gY29kZSB3aXRoIGl0IFx1MjAxNCBgQHZzYS9ub2RlLXJ1bnRpbWVgIGlzXG4gKiBOb2RlLW9ubHkgYW5kIG11c3QgbmV2ZXIgYmUgYSBwbHVnaW4gZGVwZW5kZW5jeS5cbiAqL1xuXG5pbXBvcnQgeyBOZXR3b3JrRXJyb3IsIHBhcnNlTWVzc2FnZSB9IGZyb20gJ0B2c2EvY29yZSc7XG5pbXBvcnQgdHlwZSB7IENsb3NlUmVhc29uLCBNZXNzYWdlLCBUcmFuc3BvcnQgfSBmcm9tICdAdnNhL2NvcmUnO1xuXG4vKipcbiAqIFRoZSBtaW5pbWFsIFdlYlNvY2tldCBzdXJmYWNlIHRoaXMgdHJhbnNwb3J0IG5lZWRzLiBJbmplY3RhYmxlIHNvIHRlc3RzXG4gKiAoYW5kIGV4b3RpYyBydW50aW1lcykgY2FuIHN1cHBseSBhIGZha2U7IHByb2R1Y3Rpb24gdXNlcyB0aGUgZ2xvYmFsLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFdlYlNvY2tldExpa2Uge1xuICBzZW5kKGRhdGE6IHN0cmluZyk6IHZvaWQ7XG4gIGNsb3NlKGNvZGU/OiBudW1iZXIsIHJlYXNvbj86IHN0cmluZyk6IHZvaWQ7XG4gIGFkZEV2ZW50TGlzdGVuZXIodHlwZTogJ29wZW4nLCBsaXN0ZW5lcjogKCkgPT4gdm9pZCk6IHZvaWQ7XG4gIGFkZEV2ZW50TGlzdGVuZXIodHlwZTogJ21lc3NhZ2UnLCBsaXN0ZW5lcjogKGV2ZW50OiB7IGRhdGE6IHVua25vd24gfSkgPT4gdm9pZCk6IHZvaWQ7XG4gIGFkZEV2ZW50TGlzdGVuZXIodHlwZTogJ2Nsb3NlJywgbGlzdGVuZXI6IChldmVudDogeyBjb2RlPzogbnVtYmVyOyByZWFzb24/OiBzdHJpbmcgfSkgPT4gdm9pZCk6IHZvaWQ7XG4gIGFkZEV2ZW50TGlzdGVuZXIodHlwZTogJ2Vycm9yJywgbGlzdGVuZXI6IChldmVudDogdW5rbm93bikgPT4gdm9pZCk6IHZvaWQ7XG59XG5cbmV4cG9ydCB0eXBlIFdlYlNvY2tldEZhY3RvcnkgPSAodXJsOiBzdHJpbmcpID0+IFdlYlNvY2tldExpa2U7XG5cbmV4cG9ydCBpbnRlcmZhY2UgV2ViU29ja2V0VHJhbnNwb3J0T3B0aW9ucyB7XG4gIC8qKiBXb3JrZXIgb3JpZ2luIChgaHR0cHM6Ly9wZXJzb25hbC54LndvcmtlcnMuZGV2YCkgb3IgYSBgd3Mocyk6Ly9gIFVSTC4gKi9cbiAgdXJsOiBzdHJpbmc7XG4gIC8qKiBEZXZpY2UgdG9rZW4gXHUyMDE0IGNhcnJpZWQgaW4gdGhlIHF1ZXJ5IHN0cmluZyAodGhlIHdvcmtlcidzIHByZS1hdXRoIHBhdGgpLiAqL1xuICB0b2tlbjogc3RyaW5nO1xuICAvKiogV1MgcGF0aCBvbiB0aGUgd29ya2VyIChkZWZhdWx0IGAvd3NgOyBgL3N5bmNgIGlzIGVxdWl2YWxlbnQpLiAqL1xuICBwYXRoPzogc3RyaW5nO1xuICAvKiogSW5qZWN0YWJsZSBzb2NrZXQgZmFjdG9yeSAodGVzdHMpLiBEZWZhdWx0OiB0aGUgZ2xvYmFsIGBXZWJTb2NrZXRgLiAqL1xuICB3c0ZhY3Rvcnk/OiBXZWJTb2NrZXRGYWN0b3J5O1xufVxuXG4vKipcbiAqIEJ1aWxkIHRoZSBhdXRoZW50aWNhdGVkIFdTIFVSTDogYGh0dHBzOi8veGAgXHUyMTkyIGB3c3M6Ly94L3dzP3Rva2VuPVx1MjAyNmAuXG4gKiBUaHJvd3Mgb24gbm9uLUhUVFAoUykvV1Mgc2NoZW1lcyBvciB1bnBhcnNhYmxlIGlucHV0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gdG9XZWJTb2NrZXRVcmwoYmFzZVVybDogc3RyaW5nLCB0b2tlbjogc3RyaW5nLCBwYXRoID0gJy93cycpOiBzdHJpbmcge1xuICBjb25zdCB1cmwgPSBuZXcgVVJMKGJhc2VVcmwpO1xuICBpZiAodXJsLnByb3RvY29sID09PSAnaHR0cDonKSB1cmwucHJvdG9jb2wgPSAnd3M6JztcbiAgZWxzZSBpZiAodXJsLnByb3RvY29sID09PSAnaHR0cHM6JykgdXJsLnByb3RvY29sID0gJ3dzczonO1xuICBlbHNlIGlmICh1cmwucHJvdG9jb2wgIT09ICd3czonICYmIHVybC5wcm90b2NvbCAhPT0gJ3dzczonKSB7XG4gICAgdGhyb3cgbmV3IE5ldHdvcmtFcnJvcihgd29ya2VyIFVSTCBtdXN0IGJlIGh0dHAocyk6Ly8gb3Igd3Mocyk6Ly8sIGdvdCAke3VybC5wcm90b2NvbH1gKTtcbiAgfVxuICB1cmwucGF0aG5hbWUgPSBwYXRoO1xuICB1cmwuc2VhcmNoID0gJyc7XG4gIHVybC5zZWFyY2hQYXJhbXMuc2V0KCd0b2tlbicsIHRva2VuKTtcbiAgcmV0dXJuIHVybC50b1N0cmluZygpO1xufVxuXG5mdW5jdGlvbiBkZWZhdWx0V2ViU29ja2V0RmFjdG9yeSh1cmw6IHN0cmluZyk6IFdlYlNvY2tldExpa2Uge1xuICBjb25zdCB3ZWJzb2NrZXQgPSAoZ2xvYmFsVGhpcyBhcyB7IFdlYlNvY2tldD86IHVua25vd24gfSkuV2ViU29ja2V0O1xuICBpZiAodHlwZW9mIHdlYnNvY2tldCAhPT0gJ2Z1bmN0aW9uJykge1xuICAgIHRocm93IG5ldyBOZXR3b3JrRXJyb3IoXG4gICAgICAnV2ViU29ja2V0IGlzIG5vdCBhdmFpbGFibGUgaW4gdGhpcyBPYnNpZGlhbiBidWlsZCAoaXQgaXMgYnVpbHQgaW4gb24gZGVza3RvcCBhbmQgJyArXG4gICAgICAgICdtb2JpbGU7IGEgdmVyeSBvbGQgYXBwIHZlcnNpb24gb3IgYSBzdHJpcHBlZCB3ZWJ2aWV3IGlzIHRoZSBvbmx5IGtub3duIGNhdXNlKS4gJyArXG4gICAgICAgICdTeW5jIHJlcXVpcmVzIGl0LicsXG4gICAgKTtcbiAgfVxuICByZXR1cm4gbmV3ICh3ZWJzb2NrZXQgYXMgbmV3ICh1cmw6IHN0cmluZykgPT4gV2ViU29ja2V0TGlrZSkodXJsKTtcbn1cblxuZXhwb3J0IGNsYXNzIFdlYlNvY2tldFRyYW5zcG9ydCBpbXBsZW1lbnRzIFRyYW5zcG9ydCB7XG4gIHByaXZhdGUgcmVhZG9ubHkgc29ja2V0OiBXZWJTb2NrZXRMaWtlO1xuICBwcml2YXRlIG1lc3NhZ2VDYWxsYmFjazogKChtZXNzYWdlOiBNZXNzYWdlKSA9PiB2b2lkKSB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGNsb3NlQ2FsbGJhY2s6ICgocmVhc29uOiBDbG9zZVJlYXNvbikgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBvcGVuID0gZmFsc2U7XG4gIHByaXZhdGUgY2xvc2VkID0gZmFsc2U7XG4gIHByaXZhdGUgY2xvc2VOb3RpZmllZCA9IGZhbHNlO1xuICBwcml2YXRlIHJlYWRvbmx5IHNlbmRRdWV1ZTogc3RyaW5nW10gPSBbXTtcbiAgcHJpdmF0ZSBsYXN0RXJyb3I6IHN0cmluZyB8IHVuZGVmaW5lZDtcblxuICBjb25zdHJ1Y3RvcihvcHRpb25zOiBXZWJTb2NrZXRUcmFuc3BvcnRPcHRpb25zKSB7XG4gICAgY29uc3QgZmFjdG9yeSA9IG9wdGlvbnMud3NGYWN0b3J5ID8/IGRlZmF1bHRXZWJTb2NrZXRGYWN0b3J5O1xuICAgIGNvbnN0IHVybCA9IHRvV2ViU29ja2V0VXJsKG9wdGlvbnMudXJsLCBvcHRpb25zLnRva2VuLCBvcHRpb25zLnBhdGggPz8gJy93cycpO1xuICAgIHRoaXMuc29ja2V0ID0gZmFjdG9yeSh1cmwpO1xuXG4gICAgdGhpcy5zb2NrZXQuYWRkRXZlbnRMaXN0ZW5lcignb3BlbicsICgpID0+IHtcbiAgICAgIHRoaXMub3BlbiA9IHRydWU7XG4gICAgICBjb25zdCBxdWV1ZWQgPSBbLi4udGhpcy5zZW5kUXVldWVdO1xuICAgICAgdGhpcy5zZW5kUXVldWUubGVuZ3RoID0gMDtcbiAgICAgIGZvciAoY29uc3QgZnJhbWUgb2YgcXVldWVkKSB0aGlzLnNvY2tldC5zZW5kKGZyYW1lKTtcbiAgICB9KTtcblxuICAgIHRoaXMuc29ja2V0LmFkZEV2ZW50TGlzdGVuZXIoJ21lc3NhZ2UnLCAoZXZlbnQpID0+IHtcbiAgICAgIGlmICh0eXBlb2YgZXZlbnQuZGF0YSAhPT0gJ3N0cmluZycpIHtcbiAgICAgICAgdGhpcy5mYWlsKHsgY29kZTogMTAwMywgcmVhc29uOiAnYmluYXJ5IGZyYW1lcyBhcmUgbm90IHBhcnQgb2YgdGhlIHByb3RvY29sJyB9KTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgbGV0IG1lc3NhZ2U6IE1lc3NhZ2U7XG4gICAgICB0cnkge1xuICAgICAgICBtZXNzYWdlID0gcGFyc2VNZXNzYWdlKGV2ZW50LmRhdGEpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdGhpcy5mYWlsKHsgY29kZTogMTAwMiwgcmVhc29uOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcikgfSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHRoaXMubWVzc2FnZUNhbGxiYWNrPy4obWVzc2FnZSk7XG4gICAgfSk7XG5cbiAgICB0aGlzLnNvY2tldC5hZGRFdmVudExpc3RlbmVyKCdlcnJvcicsIChldmVudCkgPT4ge1xuICAgICAgdGhpcy5sYXN0RXJyb3IgPVxuICAgICAgICBldmVudCBpbnN0YW5jZW9mIEVycm9yID8gZXZlbnQubWVzc2FnZSA6IGV2ZW50ICE9PSB1bmRlZmluZWQgPyBTdHJpbmcoZXZlbnQpIDogJ3NvY2tldCBlcnJvcic7XG4gICAgfSk7XG5cbiAgICB0aGlzLnNvY2tldC5hZGRFdmVudExpc3RlbmVyKCdjbG9zZScsIChldmVudCkgPT4ge1xuICAgICAgdGhpcy5maW5pc2hDbG9zZSh7XG4gICAgICAgIGNvZGU6IGV2ZW50LmNvZGUsXG4gICAgICAgIHJlYXNvbjogZXZlbnQucmVhc29uICE9PSB1bmRlZmluZWQgJiYgZXZlbnQucmVhc29uICE9PSAnJyA/IGV2ZW50LnJlYXNvbiA6IHRoaXMubGFzdEVycm9yLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBzZW5kKG1lc3NhZ2U6IE1lc3NhZ2UpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5jbG9zZWQpIHRocm93IG5ldyBOZXR3b3JrRXJyb3IoJ3NlbmQgb24gYSBjbG9zZWQgdHJhbnNwb3J0Jyk7XG4gICAgY29uc3QgZnJhbWUgPSBKU09OLnN0cmluZ2lmeShtZXNzYWdlKTtcbiAgICBpZiAodGhpcy5vcGVuKSB7XG4gICAgICB0aGlzLnNvY2tldC5zZW5kKGZyYW1lKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5zZW5kUXVldWUucHVzaChmcmFtZSk7XG4gIH1cblxuICBvbk1lc3NhZ2UoY2FsbGJhY2s6IChtZXNzYWdlOiBNZXNzYWdlKSA9PiB2b2lkKTogdm9pZCB7XG4gICAgdGhpcy5tZXNzYWdlQ2FsbGJhY2sgPSBjYWxsYmFjaztcbiAgfVxuXG4gIG9uQ2xvc2UoY2FsbGJhY2s6IChyZWFzb246IENsb3NlUmVhc29uKSA9PiB2b2lkKTogdm9pZCB7XG4gICAgdGhpcy5jbG9zZUNhbGxiYWNrID0gY2FsbGJhY2s7XG4gIH1cblxuICBjbG9zZSgpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5jbG9zZWQpIHJldHVybjtcbiAgICB0aGlzLmNsb3NlZCA9IHRydWU7XG4gICAgdGhpcy5zZW5kUXVldWUubGVuZ3RoID0gMDtcbiAgICB0cnkge1xuICAgICAgdGhpcy5zb2NrZXQuY2xvc2UoMTAwMCwgJ2Nsb3NlZCBieSBjYWxsZXInKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIGFscmVhZHkgZGVhZCBcdTIwMTQgdGhlIGNsb3NlIGV2ZW50IG1heSBuZXZlciBhcnJpdmVcbiAgICB9XG4gICAgLy8gTm90aWZ5IGV2ZW4gaWYgdGhlIHNvY2tldCBuZXZlciBlbWl0cyAnY2xvc2UnIChmYWlsZWQgZGlhbCkuXG4gICAgdGhpcy5maW5pc2hDbG9zZSh7IGNvZGU6IDEwMDAsIHJlYXNvbjogJ2Nsb3NlZCBieSBjYWxsZXInIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBmYWlsKHJlYXNvbjogQ2xvc2VSZWFzb24pOiB2b2lkIHtcbiAgICB0aGlzLmNsb3NlZCA9IHRydWU7XG4gICAgdHJ5IHtcbiAgICAgIHRoaXMuc29ja2V0LmNsb3NlKHJlYXNvbi5jb2RlID8/IDEwMDIsIHJlYXNvbi5yZWFzb24gPz8gJycpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gYWxyZWFkeSBjbG9zZWRcbiAgICB9XG4gICAgdGhpcy5maW5pc2hDbG9zZShyZWFzb24pO1xuICB9XG5cbiAgcHJpdmF0ZSBmaW5pc2hDbG9zZShyZWFzb246IENsb3NlUmVhc29uKTogdm9pZCB7XG4gICAgdGhpcy5vcGVuID0gZmFsc2U7XG4gICAgdGhpcy5jbG9zZWQgPSB0cnVlO1xuICAgIGlmICh0aGlzLmNsb3NlTm90aWZpZWQpIHJldHVybjtcbiAgICB0aGlzLmNsb3NlTm90aWZpZWQgPSB0cnVlO1xuICAgIHRoaXMuY2xvc2VDYWxsYmFjaz8uKHJlYXNvbik7XG4gIH1cbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTs7O0FDY0EsSUFBQUEsbUJBQStCOzs7QUNLeEIsSUFBTSx3QkFBTixjQUFvQyxNQUFNO0FBQUEsRUFDL0MsWUFBWSxTQUFpQjtBQUMzQixVQUFNLE9BQU87QUFDYixTQUFLLE9BQU87QUFBQSxFQUNkO0FBQ0Y7QUFhTyxTQUFTLG1CQUFtQixPQUEwQjtBQUMzRCxNQUFJLE9BQU8sVUFBVSxVQUFVO0FBQzdCLFVBQU0sSUFBSSxzQkFBc0Isb0NBQW9DLE9BQU8sS0FBSyxFQUFFO0FBQUEsRUFDcEY7QUFDQSxNQUFJLE1BQU0sU0FBUyxJQUFJLEdBQUc7QUFDeEIsVUFBTSxJQUFJLHNCQUFzQixpQ0FBaUMsS0FBSyxVQUFVLEtBQUssQ0FBQyxFQUFFO0FBQUEsRUFDMUY7QUFDQSxNQUFJLGFBQWEsS0FBSyxLQUFLLEdBQUc7QUFDNUIsVUFBTSxJQUFJO0FBQUEsTUFDUixnRUFB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QUNGLEVBQ0MsTUFBTSxNQUFNO0FBQUEsTUFBQyxDQUFDO0FBQUEsSUFDbkIsR0FBRyxPQUFPO0FBQUEsRUFDWjtBQUFBO0FBQUEsRUFHUSxnQkFBZ0IsT0FBZ0IsU0FBdUI7QUFDN0QsUUFBSSxpQkFBaUIsZ0JBQWdCLGlCQUFpQixtQkFBbUI7QUFDdkUsV0FBSyxhQUFhO0FBQ2xCLFdBQUssYUFBYTtBQUNsQixXQUFLLFFBQVEsTUFBTSxTQUFTLEtBQUs7QUFDakMsVUFBSTtBQUFBLFFBQ0Y7QUFBQSxRQUNBO0FBQUEsTUFDRjtBQUNBO0FBQUEsSUFDRjtBQUNBLFNBQUssUUFBUSxLQUFLLFNBQVMsS0FBSztBQUFBLEVBQ2xDO0FBQUE7QUFBQSxFQUdBLE1BQWMsc0JBQXNCLFNBQWdEO0FBQ2xGLFFBQUk7QUFDSixRQUFJO0FBQ0YsWUFBTSxRQUFRLE1BQU0sUUFBUSxTQUFTLHdCQUF3QjtBQUM3RCxlQUFTLEtBQUssTUFBTSxJQUFJLFlBQVksRUFBRSxPQUFPLEtBQUssQ0FBQztBQUFBLElBQ3JELFNBQVE7QUFDTjtBQUFBLElBQ0Y7QUFDQSxRQUNFLE9BQU8sT0FBTyxhQUFhLFlBQzNCLE9BQU8sYUFBYSxLQUFLLEtBQUssVUFDOUI7QUFDQSxZQUFNLE9BQU8sT0FBTyxPQUFPLGVBQWUsV0FBVyxPQUFPLGFBQWEsT0FBTztBQUNoRixZQUFNLFFBQVEsT0FBTyxPQUFPLFFBQVEsV0FBVyxPQUFPLE1BQU07QUFDNUQsVUFBSTtBQUFBLFFBQ0YsNERBQTRELElBQUksZ0JBQWdCLEtBQUs7QUFBQSxRQUdyRjtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUNGO0FBRUEsU0FBUyx1QkFBdUIsT0FBdUI7QUFDckQsTUFBSTtBQUNGLFdBQU8sbUJBQW1CLEtBQUs7QUFBQSxFQUNqQyxTQUFRO0FBQ04sV0FBTztBQUFBLEVBQ1Q7QUFDRjsiLAogICJuYW1lcyI6IFsiaW1wb3J0X29ic2lkaWFuIiwgIl9hIiwgIl9iIiwgIl9jIiwgIl9kIiwgIl9lIiwgImltcG9ydF9vYnNpZGlhbiIsICJpbXBvcnRfb2JzaWRpYW4iLCAiaW1wb3J0X29ic2lkaWFuIiwgIl9hIiwgIl9hIl0KfQo=
