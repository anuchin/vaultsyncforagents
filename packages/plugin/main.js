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
  const thisDeviceId = options.thisDeviceId;
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
  const { emptyFolders, staleDirs } = detectEmptyFolders(index, settings, files, dirs, thisDeviceId);
  const folderDeletions = detectFolderDeletions(index, settings, dirs);
  return {
    scannedAt: now,
    added: sortCandidates(unmatchedAdded),
    modified: sortCandidates(modified),
    deleted: [...unmatchedDeleted].sort(byPath),
    renamed: [...renamed].sort((a, b) => byPath(a, b)),
    emptyFolders,
    folderDeletions,
    // Omitted when empty (not `[]`) — see the field's doc.
    ...staleDirs.length > 0 ? { staleDirs } : {},
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
    var _a, _b, _c, _d, _e;
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
      for (const dir of (_b = localChanges.staleDirs) != null ? _b : []) {
        await removeDirIfVacant(this.options.storage, this.index, dir);
      }
      const folderCommits = [];
      for (const path of plan.folderPushes) {
        if (emptiedDirs.has(path)) continue;
        if (!await this.storageExists(path)) continue;
        folderCommits.push({
          kind: "edit",
          path,
          parentVersion: (_d = (_c = this.index[path]) == null ? void 0 : _c.versionId) != null ? _d : null,
          hash: "",
          size: 0,
          isFolder: true
        });
      }
      await this.runPushPipeline(folderCommits, settlePush);
      this.index = recordHashedFiles(this.index, localChanges.hashed);
      if (this.manifestCursorOfCycle !== null && this.manifestCursorOfCycle > ((_e = this.syncedThrough) != null ? _e : 0)) {
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiLCAic3JjL3BsdWdpbi50cyIsICIuLi9jb3JlL3NyYy9wYXRocy50cyIsICIuLi9jb3JlL3NyYy9jbG9jay50cyIsICIuLi9jb3JlL3NyYy9oYXNoaW5nLnRzIiwgIi4uL2NvcmUvc3JjL2Vycm9ycy50cyIsICIuLi9jb3JlL3NyYy9sb2NhbGluZGV4LnRzIiwgIi4uL2NvcmUvc3JjL2VuZ2luZS50cyIsICIuLi9jb3JlL3NyYy9pZ25vcmUudHMiLCAiLi4vY29yZS9zcmMvcHJvdG9jb2wudHMiLCAiLi4vY29yZS9zcmMvY29uZmxpY3RuYW1lcy50cyIsICIuLi9jb3JlL3NyYy9yZXNvbHZlLnRzIiwgIi4uL2NvcmUvc3JjL3NjYW4udHMiLCAiLi4vY29yZS9zcmMvY2xpZW50LnRzIiwgInNyYy9hZGFwdGVycy9vYnNpZGlhbi1zdG9yYWdlLnRzIiwgInNyYy9hZGFwdGVycy9vYnNpZGlhbi13YXRjaC50cyIsICJzcmMvYmxvYnN0b3JlLnRzIiwgInNyYy9kaWFnbm9zdGljcy50cyIsICJzcmMvZGF0YS50cyIsICJzcmMvd29ya2VyYXBpLnRzIiwgInNyYy9wYWlyaW5nLnRzIiwgInNyYy9wcm90b2NvbC1oYW5kbGVyLnRzIiwgInNyYy9yZWNvbm5lY3QudHMiLCAic3JjL3NldHRpbmdzLnRzIiwgInNyYy9zdGF0dXNiYXIudHMiLCAic3JjL3RyYW5zcG9ydC50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLyoqXG4gKiBQbHVnaW4gZW50cnkgcG9pbnQgXHUyMDE0IE9ic2lkaWFuIGxvYWRzIGBtYWluLmpzYCBhbmQgaW5zdGFudGlhdGVzIHRoZSBkZWZhdWx0XG4gKiBleHBvcnQuIEV2ZXJ5dGhpbmcgcmVhbCBsaXZlcyBpbiBgcGx1Z2luLnRzYCAoYW5kIGl0cyBtb2R1bGVzKTsgdGhpcyBmaWxlXG4gKiBvbmx5IHJlLWV4cG9ydHMuXG4gKi9cblxuZXhwb3J0IHsgVmF1bHRTeW5jUGx1Z2luIGFzIGRlZmF1bHQgfSBmcm9tICcuL3BsdWdpbi5qcyc7XG4iLCAiLyoqXG4gKiBgVmF1bHRTeW5jUGx1Z2luYCBcdTIwMTQgdGhlIE9ic2lkaWFuIGNsaWVudCAoZGVza3RvcCArIG1vYmlsZSkuXG4gKlxuICogb25sb2FkOiBsb2FkIGxpbmsgaWRlbnRpdHkgXHUyMTkyIGlmIGxpbmtlZCwgYnVpbGQgYFN5bmNDbGllbnRgIChjb3JlKSBvdmVyIHRoZVxuICogT2JzaWRpYW4gYWRhcHRlcnMgYW5kIHJ1biBzdGFydHVwIHJlY29uY2lsaWF0aW9uICh0aGUgc3luYy1vbi1vcGVuXG4gKiBjb250cmFjdCwgRlItNC9GUi01L0ZSLTEyKSwgdGhlbiBlbnRlciBsaXZlIG1vZGUgKHZhdWx0IGV2ZW50cyArIHBlcmlvZGljXG4gKiByZXNjYW4gKyBmb2N1cyByZXNjYW4pIHdpdGggYSBzdGF0dXMtYmFyIGluZGljYXRvciBhbmQgaml0dGVyZWRcbiAqIGV4cG9uZW50aWFsLWJhY2tvZmYgcmVjb25uZWN0IChjYXBwZWQgYXQgNjAgcykuXG4gKlxuICogQSAxIEh6IFwic3VwZXJ2aXNpb24gdGlja1wiIGRyaXZlcyBldmVyeXRoaW5nIHRpbWUtYmFzZWQ6IGl0IHJlcGFpbnRzIHRoZVxuICogc3RhdHVzIGJhciBhbmQgbm90aWNlcyBgZGlzY29ubmVjdGVkYCBcdTIxOTIgc2NoZWR1bGVzIG9uZSByZWNvbm5lY3QgYXQgYSB0aW1lLlxuICogQWxsIHRpbWVycyBhcmUgb3duZWQgaGVyZSBhbmQgdG9ybiBkb3duIGluIGBzdG9wU3luYygpYC9gb251bmxvYWRgLlxuICovXG5cbmltcG9ydCB7IE5vdGljZSwgUGx1Z2luIH0gZnJvbSAnb2JzaWRpYW4nO1xuaW1wb3J0IHR5cGUgeyBBcHAsIFBsdWdpbk1hbmlmZXN0IH0gZnJvbSAnb2JzaWRpYW4nO1xuaW1wb3J0IHsgUmV2b2tlZEVycm9yLCBTeW5jQ2xpZW50LCBVbmF1dGhvcml6ZWRFcnJvciB9IGZyb20gJ0B2c2EvY29yZSc7XG5pbXBvcnQgeyBPYnNpZGlhblN0b3JhZ2VBZGFwdGVyIH0gZnJvbSAnLi9hZGFwdGVycy9vYnNpZGlhbi1zdG9yYWdlLmpzJztcbmltcG9ydCB7IE9ic2lkaWFuV2F0Y2hBZGFwdGVyLCBSZXNjYW5TY2hlZHVsZXIgfSBmcm9tICcuL2FkYXB0ZXJzL29ic2lkaWFuLXdhdGNoLmpzJztcbmltcG9ydCB7IEh0dHBCbG9iU3RvcmUgfSBmcm9tICcuL2Jsb2JzdG9yZS5qcyc7XG5pbXBvcnQge1xuICBidWlsZERpYWdub3N0aWNzQnVuZGxlLFxuICBjb3B5VG9DbGlwYm9hcmQsXG4gIGNyZWF0ZVBsdWdpbkxvZyxcbiAgcGxhdGZvcm1TdW1tYXJ5LFxuICB3aXRoUm91bmRUcmlwTG9nZ2luZyxcbiAgdHlwZSBQbHVnaW5Mb2csXG59IGZyb20gJy4vZGlhZ25vc3RpY3MuanMnO1xuaW1wb3J0IHtcbiAgZGVmYXVsdERldmljZU5hbWUsXG4gIGRldGVjdERldmljZVR5cGUsXG4gIGlzTGlua2VkLFxuICBub3JtYWxpemVQbHVnaW5EYXRhLFxuICBwYXJzZUlnbm9yZVBhdHRlcm5zLFxuICBkZWZhdWx0UGx1Z2luRGF0YSxcbiAgdHlwZSBMb2dMZXZlbCxcbiAgdHlwZSBWYXVsdFN5bmNQbHVnaW5EYXRhLFxufSBmcm9tICcuL2RhdGEuanMnO1xuaW1wb3J0IHsgcGFpck91dGNvbWVNZXNzYWdlLCBwYWlyV2l0aFdvcmtlciB9IGZyb20gJy4vcGFpcmluZy5qcyc7XG5pbXBvcnQgdHlwZSB7IFBhaXJPdXRjb21lIH0gZnJvbSAnLi9wYWlyaW5nLmpzJztcbmltcG9ydCB7IHJlZ2lzdGVyUGFpclByb3RvY29sSGFuZGxlciB9IGZyb20gJy4vcHJvdG9jb2wtaGFuZGxlci5qcyc7XG5pbXBvcnQgeyBSZWNvbm5lY3RTdXBlcnZpc29yIH0gZnJvbSAnLi9yZWNvbm5lY3QuanMnO1xuaW1wb3J0IHR5cGUgeyBCYWNrb2ZmT3B0aW9ucyB9IGZyb20gJy4vcmVjb25uZWN0LmpzJztcbmltcG9ydCB0eXBlIHsgU3RhdHVzQmFyTW9kZSB9IGZyb20gJy4vc3RhdHVzYmFyLmpzJztcbmltcG9ydCB7IFZhdWx0U3luY1NldHRpbmdUYWIgfSBmcm9tICcuL3NldHRpbmdzLmpzJztcbmltcG9ydCB7IFN0YXR1c0JhckluZGljYXRvciB9IGZyb20gJy4vc3RhdHVzYmFyLmpzJztcbmltcG9ydCB7IFdlYlNvY2tldFRyYW5zcG9ydCB9IGZyb20gJy4vdHJhbnNwb3J0LmpzJztcbmltcG9ydCB0eXBlIHsgV2ViU29ja2V0RmFjdG9yeSB9IGZyb20gJy4vdHJhbnNwb3J0LmpzJztcbmltcG9ydCB7IGZldGNoV29ya2VyU3RhdHVzLCBub3JtYWxpemVXb3JrZXJVcmwsIHJlbmFtZURldmljZSB9IGZyb20gJy4vd29ya2VyYXBpLmpzJztcbmltcG9ydCB0eXBlIHsgV29ya2VyU3RhdHVzU3VtbWFyeSB9IGZyb20gJy4vd29ya2VyYXBpLmpzJztcblxuLyoqIFRoZSBpbi12YXVsdCBkZXZpY2UgbWFya2VyIHNoYXJlZCB3aXRoIHRoZSBkYWVtb24vQ0xJIChGUi00NCBoYW5kc2hha2UpLiAqL1xuY29uc3QgREVWSUNFX01BUktFUl9WQVVMVF9QQVRIID0gJy8udmF1bHRzeW5jZm9yYWdlbnRzL2RldmljZS5qc29uJztcbmNvbnN0IExPQ0FMX0lOREVYX1ZBVUxUX1BBVEggPSAnLy52YXVsdHN5bmNmb3JhZ2VudHMvc3RhdGUnO1xuY29uc3QgU1VQRVJWSVNJT05fVElDS19NUyA9IDEwMDA7XG5cbi8qKiBUaW1lciBoYW5kbGVzIChudW1iZXIgaW4gdGhlIERPTSwgYFRpbWVvdXRgIHdoZW4gTm9kZSB0eXBlcyBsZWFrIGluKS4gKi9cbnR5cGUgVGltZXJIYW5kbGUgPSBSZXR1cm5UeXBlPHR5cGVvZiBzZXRJbnRlcnZhbD47XG5cbi8qKiBJbmplY3RhYmxlIHNlYW1zIHNvIHVuaXQgdGVzdHMgbmVlZCBubyByZWFsIE9ic2lkaWFuL25ldHdvcmsuICovXG5leHBvcnQgaW50ZXJmYWNlIFBsdWdpbk92ZXJyaWRlcyB7XG4gIGZldGNoSW1wbD86IHR5cGVvZiBmZXRjaDtcbiAgd3NGYWN0b3J5PzogV2ViU29ja2V0RmFjdG9yeTtcbiAgbm93PzogKCkgPT4gbnVtYmVyO1xuICAvKiogUmVjb25uZWN0IGJhY2tvZmYga25vYnMgKHRlc3RzIGluamVjdCBhIGRldGVybWluaXN0aWMgcmFuZG9tKS4gKi9cbiAgcmVjb25uZWN0PzogQmFja29mZk9wdGlvbnM7XG59XG5cbmV4cG9ydCBjbGFzcyBWYXVsdFN5bmNQbHVnaW4gZXh0ZW5kcyBQbHVnaW4ge1xuICBkYXRhOiBWYXVsdFN5bmNQbHVnaW5EYXRhID0gZGVmYXVsdFBsdWdpbkRhdGEoKTtcbiAgLyoqIFRoZSBsaXZlIHN5bmMgY2xpZW50IChudWxsIHdoaWxlIHVubGlua2VkL3N0b3BwZWQpLiAqL1xuICBjbGllbnQ6IFN5bmNDbGllbnQgfCBudWxsID0gbnVsbDtcblxuICBwcml2YXRlIHJlYWRvbmx5IG92ZXJyaWRlczogUGx1Z2luT3ZlcnJpZGVzO1xuICBwcml2YXRlIHdhdGNoZXI6IE9ic2lkaWFuV2F0Y2hBZGFwdGVyIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgcmVzY2FuOiBSZXNjYW5TY2hlZHVsZXIgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBzdGF0dXNCYXI6IFN0YXR1c0JhckluZGljYXRvciB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHN0YXR1c0Jhckl0ZW06IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgdGlja0hhbmRsZTogVGltZXJIYW5kbGUgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSByZWNvbm5lY3RUaW1lcjogVGltZXJIYW5kbGUgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBzdXBlcnZpc29yID0gbmV3IFJlY29ubmVjdFN1cGVydmlzb3IoKTtcbiAgLyoqIFNldCB3aGVuIHRoZSB3b3JrZXIgcmVqZWN0ZWQgdGhlIHRva2VuIFx1MjAxNCByZWNvbm5lY3RpbmcgY2Fubm90IGhlbHAuICovXG4gIHByaXZhdGUgYXV0aEZhaWxlZCA9IGZhbHNlO1xuICBwcml2YXRlIHN0YXR1c05vdGUgPSAnJztcbiAgLyoqIFBhdXNlLXN5bmNpbmcgc3RhdGUgKHJ1bnRpbWUgb25seSBcdTIwMTQgYSByZWxvYWQgc3RhcnRzIHBlciBzeW5jT25TdGFydHVwKS4gKi9cbiAgcHJpdmF0ZSBwYXVzZWQgPSBmYWxzZTtcbiAgLyoqIFRoZSBwbHVnaW4ncyBsb2c6IGNvbnNvbGUgbWlycm9yICsgYm91bmRlZCByaW5nIChDb3B5IGRpYWdub3N0aWNzKS4gKi9cbiAgcHJpdmF0ZSByZWFkb25seSBzeW5jTG9nOiBQbHVnaW5Mb2cgPSBjcmVhdGVQbHVnaW5Mb2coKTtcblxuICBjb25zdHJ1Y3RvcihhcHA6IEFwcCwgbWFuaWZlc3Q6IFBsdWdpbk1hbmlmZXN0LCBvdmVycmlkZXM6IFBsdWdpbk92ZXJyaWRlcyA9IHt9KSB7XG4gICAgc3VwZXIoYXBwLCBtYW5pZmVzdCk7XG4gICAgdGhpcy5vdmVycmlkZXMgPSBvdmVycmlkZXM7XG4gIH1cblxuICBwcml2YXRlIGdldCBub3coKTogKCkgPT4gbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy5vdmVycmlkZXMubm93ID8/ICgoKSA9PiBEYXRlLm5vdygpKTtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0IGZldGNoSW1wbCgpOiB0eXBlb2YgZmV0Y2gge1xuICAgIC8vIEJpbmQgYXQgdGhlIHNlYW06IGNvbnN1bWVycyAocGFpcmluZywgYEh0dHBCbG9iU3RvcmVgKSBpbnZva2UgdGhpcyBhcyBhXG4gICAgLy8gZGV0YWNoZWQgZnVuY3Rpb24sIGFuZCBhIGRldGFjaGVkIGBmZXRjaGAgdGhyb3dzXG4gICAgLy8gYFR5cGVFcnJvcjogRmFpbGVkIHRvIGV4ZWN1dGUgJ2ZldGNoJyBvbiAnV2luZG93JzogSWxsZWdhbCBpbnZvY2F0aW9uYFxuICAgIC8vIGluIENocm9taXVtIHJlbmRlcmVycyBcdTIwMTQgaS5lLiBpbiByZWFsIE9ic2lkaWFuIChkZXNrdG9wIGFuZCBtb2JpbGUpLlxuICAgIC8vIEJpbmRpbmcgdG8gdGhlIGdsb2JhbCBtYWtlcyB0aGUgZGVmYXVsdCBzYWZlIHRvIGNhbGwgYmFyZS5cbiAgICByZXR1cm4gdGhpcy5vdmVycmlkZXMuZmV0Y2hJbXBsID8/IGdsb2JhbFRoaXMuZmV0Y2guYmluZChnbG9iYWxUaGlzKTtcbiAgfVxuXG4gIGdldCBsaW5rZWQoKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGlzTGlua2VkKHRoaXMuZGF0YSk7XG4gIH1cblxuICBvdmVycmlkZSBhc3luYyBvbmxvYWQoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5kYXRhID0gbm9ybWFsaXplUGx1Z2luRGF0YShhd2FpdCB0aGlzLmxvYWREYXRhKCkpO1xuICAgIHRoaXMuc3luY0xvZy5zZXRMZXZlbCh0aGlzLmRhdGEuc2V0dGluZ3MubG9nTGV2ZWwpO1xuICAgIHRoaXMuYWRkU2V0dGluZ1RhYihuZXcgVmF1bHRTeW5jU2V0dGluZ1RhYih0aGlzLmFwcCwgdGhpcykpO1xuICAgIHJlZ2lzdGVyUGFpclByb3RvY29sSGFuZGxlcihcbiAgICAgIChhY3Rpb24sIGhhbmRsZXIpID0+IHRoaXMucmVnaXN0ZXJPYnNpZGlhblByb3RvY29sSGFuZGxlcihhY3Rpb24sIGhhbmRsZXIpLFxuICAgICAgKGxpbmspID0+IHRoaXMuaGFuZGxlUGFpckRlZXBMaW5rKGxpbmsudXJsLCBsaW5rLmNvZGUpLFxuICAgICk7XG4gICAgLy8gQ2hlYXAgZm9jdXMtZHJpdmVuIHJlc2NhbiAoRlItMTIpOiBldmVyeSBub3RlL2FwcCBzd2l0Y2ggcG9rZXMgdGhlXG4gICAgLy8gc2NoZWR1bGVyLCB3aGljaCBjb2FsZXNjZXMgaW50byBhdCBtb3N0IG9uZSBjeWNsZSBwZXIgZGVib3VuY2Ugd2luZG93LlxuICAgIHRoaXMucmVnaXN0ZXJFdmVudCh0aGlzLmFwcC53b3Jrc3BhY2Uub24oJ2FjdGl2ZS1sZWFmLWNoYW5nZScsICgpID0+IHRoaXMucmVzY2FuPy5wb2tlKCkpKTtcbiAgICAvLyBcIlN5bmMgb24gc3RhcnR1cFwiIE9GRiA9IG1hbnVhbC1vbmx5IG1vZGU6IGxvYWQgaWRsZTsgdGhlIGZpcnN0IFwiU3luY1xuICAgIC8vIG5vd1wiIHN0YXJ0cyB0aGUgbWFjaGluZXJ5ICh3YXRjaGVyIGluY2x1ZGVkKS5cbiAgICBpZiAodGhpcy5saW5rZWQgJiYgdGhpcy5kYXRhLnNldHRpbmdzLnN5bmNPblN0YXJ0dXApIGF3YWl0IHRoaXMuc3RhcnRTeW5jKCk7XG4gIH1cblxuICBvdmVycmlkZSBvbnVubG9hZCgpOiB2b2lkIHtcbiAgICB0aGlzLnN0b3BTeW5jKCk7XG4gIH1cblxuICAvLyAtLS0gcGVyc2lzdGVuY2UgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICBhc3luYyBzYXZlUGx1Z2luRGF0YSgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLnNhdmVEYXRhKHRoaXMuZGF0YSk7XG4gIH1cblxuICAvLyAtLS0gcGFpcmluZyAoc2V0dGluZ3MgdGFiICsgZGVlcCBsaW5rKSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIC8qKiBQYWlyIGZyb20gdGhlIHNldHRpbmdzIGZvcm0gKGZpZWxkcyBhbHJlYWR5IGxpdmUgaW4gYHRoaXMuZGF0YWApLiAqL1xuICBhc3luYyBwYWlyRnJvbVNldHRpbmdzKGNvZGU6IHN0cmluZyk6IFByb21pc2U8UGFpck91dGNvbWU+IHtcbiAgICBjb25zdCBkZXZpY2VOYW1lID0gdGhpcy5yZXNvbHZlRGV2aWNlTmFtZSgpO1xuICAgIGNvbnN0IG91dGNvbWUgPSBhd2FpdCBwYWlyV2l0aFdvcmtlcih7XG4gICAgICB1cmw6IHRoaXMuZGF0YS51cmwsXG4gICAgICBjb2RlLFxuICAgICAgZGV2aWNlTmFtZSxcbiAgICAgIGRldmljZVR5cGU6IGRldGVjdERldmljZVR5cGUoKSxcbiAgICAgIGZldGNoSW1wbDogdGhpcy5mZXRjaEltcGwsXG4gICAgfSk7XG4gICAgYXdhaXQgdGhpcy5hcHBseVBhaXJPdXRjb21lKG91dGNvbWUsIGRldmljZU5hbWUpO1xuICAgIHJldHVybiBvdXRjb21lO1xuICB9XG5cbiAgLyoqIG9ic2lkaWFuOi8vdmF1bHRzeW5jZm9yYWdlbnRzL3BhaXI/dXJsPVx1MjAyNiZjb2RlPVx1MjAyNiAocHJvdG9jb2wtaGFuZGxlci50cykuICovXG4gIHByaXZhdGUgYXN5bmMgaGFuZGxlUGFpckRlZXBMaW5rKHVybDogc3RyaW5nLCBjb2RlOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAodGhpcy5saW5rZWQpIHtcbiAgICAgIGlmIChub3JtYWxpemVXb3JrZXJVcmxTYWZlKHVybCkgPT09IG5vcm1hbGl6ZVdvcmtlclVybFNhZmUodGhpcy5kYXRhLnVybCkpIHtcbiAgICAgICAgbmV3IE5vdGljZSgnVmF1bHRTeW5jOiB0aGlzIHZhdWx0IGlzIGFscmVhZHkgcGFpcmVkIHdpdGggdGhhdCB3b3JrZXIuJyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBuZXcgTm90aWNlKFxuICAgICAgICAgICdWYXVsdFN5bmM6IHRoaXMgdmF1bHQgaXMgcGFpcmVkIHdpdGggYSBkaWZmZXJlbnQgd29ya2VyLiBVbmxpbmsgaXQgaW4gc2V0dGluZ3MgZmlyc3QuJyxcbiAgICAgICAgICAxMDAwMCxcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgZGV2aWNlTmFtZSA9IHRoaXMucmVzb2x2ZURldmljZU5hbWUoKTtcbiAgICBjb25zdCBvdXRjb21lID0gYXdhaXQgcGFpcldpdGhXb3JrZXIoe1xuICAgICAgdXJsLFxuICAgICAgY29kZSxcbiAgICAgIGRldmljZU5hbWUsXG4gICAgICBkZXZpY2VUeXBlOiBkZXRlY3REZXZpY2VUeXBlKCksXG4gICAgICBmZXRjaEltcGw6IHRoaXMuZmV0Y2hJbXBsLFxuICAgIH0pO1xuICAgIGF3YWl0IHRoaXMuYXBwbHlQYWlyT3V0Y29tZShvdXRjb21lLCBkZXZpY2VOYW1lKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgYXBwbHlQYWlyT3V0Y29tZShvdXRjb21lOiBQYWlyT3V0Y29tZSwgZGV2aWNlTmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKG91dGNvbWUuc3RhdHVzICE9PSAncGFpcmVkJykge1xuICAgICAgbmV3IE5vdGljZShwYWlyT3V0Y29tZU1lc3NhZ2Uob3V0Y29tZSksIDEwMDAwKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5kYXRhLnVybCA9IG91dGNvbWUudXJsO1xuICAgIHRoaXMuZGF0YS50b2tlbiA9IG91dGNvbWUudG9rZW47XG4gICAgdGhpcy5kYXRhLmRldmljZUlkID0gb3V0Y29tZS5kZXZpY2VJZDtcbiAgICB0aGlzLmRhdGEuZGV2aWNlTmFtZSA9IGRldmljZU5hbWU7XG4gICAgYXdhaXQgdGhpcy5zYXZlUGx1Z2luRGF0YSgpO1xuICAgIGF3YWl0IHRoaXMud3JpdGVEZXZpY2VNYXJrZXIoKTtcbiAgICBuZXcgTm90aWNlKHBhaXJPdXRjb21lTWVzc2FnZShvdXRjb21lKSk7XG4gICAgYXdhaXQgdGhpcy5zdGFydFN5bmMoKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVzb2x2ZURldmljZU5hbWUoKTogc3RyaW5nIHtcbiAgICBjb25zdCB0eXBlZCA9IHRoaXMuZGF0YS5kZXZpY2VOYW1lLnRyaW0oKTtcbiAgICByZXR1cm4gdHlwZWQgIT09ICcnID8gdHlwZWQgOiBkZWZhdWx0RGV2aWNlTmFtZSgpO1xuICB9XG5cbiAgLyoqXG4gICAqIFRoZSB2YXVsdC1iYWNrZWQgc3RvcmFnZSBhZGFwdGVyIGV2ZXJ5IHN5bmMgc3VyZmFjZSB1c2VzLiBXaXJlcyB0aGVcbiAgICogZW1wdHktZm9sZGVyIHJlbW92YWwgdGhyb3VnaCBgZmlsZU1hbmFnZXIudHJhc2hGaWxlYCBcdTIwMTQgT2JzaWRpYW4nc1xuICAgKiBgRGF0YUFkYXB0ZXIucm1kaXJgIHJlZnVzZXMgRVZFUlkgZGlyZWN0b3J5IChgRVJSX0ZTX0VJU0RJUmApLCB3aGljaFxuICAgKiBzaWxlbnRseSBkZWdyYWRlZCBmb2xkZXItdG9tYnN0b25lIGFwcGxpY2F0aW9uIHRvIHJlY29yZC1vbmx5IChGLTEpLlxuICAgKiBUcmFzaCAobm90IGRlbGV0ZSkgYmVjYXVzZSBhbiBlbXB0eSBmb2xkZXIgaXMgdHJpdmlhbGx5IHJlY292ZXJhYmxlLlxuICAgKi9cbiAgcHJpdmF0ZSBjcmVhdGVTdG9yYWdlQWRhcHRlcigpOiBPYnNpZGlhblN0b3JhZ2VBZGFwdGVyIHtcbiAgICByZXR1cm4gbmV3IE9ic2lkaWFuU3RvcmFnZUFkYXB0ZXIoe1xuICAgICAgYWRhcHRlcjogdGhpcy5hcHAudmF1bHQuYWRhcHRlcixcbiAgICAgIHJlbW92ZUVtcHR5RGlyOiBhc3luYyAoYWRhcHRlclBhdGgpID0+IHtcbiAgICAgICAgY29uc3QgZm9sZGVyID0gdGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKGFkYXB0ZXJQYXRoKTtcbiAgICAgICAgaWYgKGZvbGRlciA9PT0gbnVsbCkgcmV0dXJuOyAvLyByYWNlZCBhd2F5IC8gdHJlZSBub3QgY2F1Z2h0IHVwIFx1MjAxNCBpZGVtcG90ZW50XG4gICAgICAgIGF3YWl0IHRoaXMuYXBwLmZpbGVNYW5hZ2VyLnRyYXNoRmlsZShmb2xkZXIpO1xuICAgICAgfSxcbiAgICB9KTtcbiAgfVxuXG4gIC8qKiBXcml0ZSB0aGUgRlItNDQgbWFya2VyIHRoZSBDTEkvZGFlbW9uIHJlYWQgdG8gZGV0ZWN0IGRvdWJsZS1jbGllbnRzLiAqL1xuICBwcml2YXRlIGFzeW5jIHdyaXRlRGV2aWNlTWFya2VyKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghdGhpcy5saW5rZWQpIHJldHVybjtcbiAgICBjb25zdCBzdG9yYWdlID0gdGhpcy5jcmVhdGVTdG9yYWdlQWRhcHRlcigpO1xuICAgIGNvbnN0IG1hcmtlciA9IHtcbiAgICAgIGRldmljZUlkOiB0aGlzLmRhdGEuZGV2aWNlSWQsXG4gICAgICBkZXZpY2VOYW1lOiB0aGlzLnJlc29sdmVEZXZpY2VOYW1lKCksXG4gICAgICB1cmw6IHRoaXMuZGF0YS51cmwsXG4gICAgICBsaW5rZWRBdDogdGhpcy5ub3coKSxcbiAgICB9O1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCBzdG9yYWdlLndyaXRlRmlsZShcbiAgICAgICAgREVWSUNFX01BUktFUl9WQVVMVF9QQVRILFxuICAgICAgICBuZXcgVGV4dEVuY29kZXIoKS5lbmNvZGUoYCR7SlNPTi5zdHJpbmdpZnkobWFya2VyLCBudWxsLCAyKX1cXG5gKSxcbiAgICAgICk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuc3luY0xvZy53YXJuKCdmYWlsZWQgdG8gd3JpdGUgZGV2aWNlIG1hcmtlcicsIGVycm9yKTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogYFBBVENIIC9kZXZpY2VgIFx1MjAxNCByZW5hbWUgVEhJUyBkZXZpY2Ugb24gdGhlIHdvcmtlciAodGhlIHNldHRpbmdzIHRhYidzXG4gICAqIFJlbmFtZSBidXR0b24pLiBVcGRhdGVzIHBsdWdpbiBkYXRhICsgdGhlIGluLXZhdWx0IGRldmljZSBtYXJrZXIgKHdoaWNoXG4gICAqIHN0b3JlcyB0aGUgbmFtZSBmb3IgdGhlIEZSLTQ0IGRvdWJsZS1jbGllbnQgd2FybmluZykuIExvY2FsIHN0YXRlIGtlZXBzXG4gICAqIGl0cyBwcmV2aW91cyBuYW1lIG9uIGZhaWx1cmUuXG4gICAqL1xuICBhc3luYyByZW5hbWVEZXZpY2UobmFtZTogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgaWYgKCF0aGlzLmxpbmtlZCkge1xuICAgICAgbmV3IE5vdGljZSgnVmF1bHRTeW5jOiBwYWlyIHRoaXMgdmF1bHQgZmlyc3QgXHUyMDE0IHRoZSBuYW1lIGFwcGxpZXMgYXQgcGFpcmluZyB0aW1lLicpO1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICBjb25zdCB0cmltbWVkID0gbmFtZS50cmltKCk7XG4gICAgaWYgKHRyaW1tZWQgPT09ICcnIHx8IHRyaW1tZWQubGVuZ3RoID4gMzAgfHwgL1tcXHUwMDAwLVxcdTAwMWZcXHUwMDdmXS8udGVzdCh0cmltbWVkKSkge1xuICAgICAgbmV3IE5vdGljZSgnVmF1bHRTeW5jOiBkZXZpY2UgbmFtZSBtdXN0IGJlIDEtMzAgY2hhcmFjdGVycywgd2l0aG91dCBjb250cm9sIGNoYXJhY3RlcnMuJywgODAwMCk7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGNvbnN0IG91dGNvbWUgPSBhd2FpdCByZW5hbWVEZXZpY2Uoe1xuICAgICAgb3JpZ2luOiB0aGlzLmRhdGEudXJsLFxuICAgICAgdG9rZW46IHRoaXMuZGF0YS50b2tlbixcbiAgICAgIG5hbWU6IHRyaW1tZWQsXG4gICAgICBmZXRjaEltcGw6IHRoaXMuZmV0Y2hJbXBsLFxuICAgIH0pO1xuICAgIGlmICghb3V0Y29tZS5vaykge1xuICAgICAgbmV3IE5vdGljZShgVmF1bHRTeW5jOiByZW5hbWluZyBmYWlsZWQgXHUyMDE0ICR7b3V0Y29tZS5lcnJvcn1gLCAxMDAwMCk7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIHRoaXMuZGF0YS5kZXZpY2VOYW1lID0gb3V0Y29tZS5kZXZpY2UubmFtZTtcbiAgICBhd2FpdCB0aGlzLnNhdmVQbHVnaW5EYXRhKCk7XG4gICAgYXdhaXQgdGhpcy53cml0ZURldmljZU1hcmtlcigpO1xuICAgIG5ldyBOb3RpY2UoYFZhdWx0U3luYzogZGV2aWNlIHJlbmFtZWQgdG8gXHUyMDFDJHtvdXRjb21lLmRldmljZS5uYW1lfVx1MjAxRC5gKTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIC8vIC0tLSBzeW5jIGxpZmVjeWNsZSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICAvKiogQnVpbGQgZXZlcnl0aGluZyBhbmQgcnVuIHN0YXJ0dXAgcmVjb25jaWxpYXRpb24gKGlkZW1wb3RlbnQgcmVzdGFydCkuICovXG4gIHByaXZhdGUgYXN5bmMgc3RhcnRTeW5jKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghdGhpcy5saW5rZWQpIHJldHVybjtcbiAgICB0aGlzLnN0b3BTeW5jKCk7XG5cbiAgICBjb25zdCB7IHVybCwgdG9rZW4sIGRldmljZUlkIH0gPSB0aGlzLmRhdGE7XG4gICAgY29uc3QgZGV2aWNlTmFtZSA9IHRoaXMucmVzb2x2ZURldmljZU5hbWUoKTtcbiAgICBjb25zdCBzdG9yYWdlID0gdGhpcy5jcmVhdGVTdG9yYWdlQWRhcHRlcigpO1xuICAgIGF3YWl0IHRoaXMud2FybklmRm9yZWlnblN0YXRlRGlyKHN0b3JhZ2UpO1xuXG4gICAgY29uc3QgY2xpZW50ID0gbmV3IFN5bmNDbGllbnQoe1xuICAgICAgZGV2aWNlSWQsXG4gICAgICBkZXZpY2VOYW1lLFxuICAgICAgdG9rZW4sXG4gICAgICB0cmFuc3BvcnQ6ICgpID0+XG4gICAgICAgIHdpdGhSb3VuZFRyaXBMb2dnaW5nKFxuICAgICAgICAgIG5ldyBXZWJTb2NrZXRUcmFuc3BvcnQoeyB1cmwsIHRva2VuLCB3c0ZhY3Rvcnk6IHRoaXMub3ZlcnJpZGVzLndzRmFjdG9yeSB9KSxcbiAgICAgICAgICB7IGxvZzogdGhpcy5zeW5jTG9nLCBzaG91bGRMb2c6ICgpID0+IHRoaXMuc3luY0xvZy5kZWJ1Z0VuYWJsZWQgfSxcbiAgICAgICAgKSxcbiAgICAgIGJsb2JTdG9yZTogbmV3IEh0dHBCbG9iU3RvcmUoeyBiYXNlVXJsOiB1cmwsIHRva2VuLCBmZXRjaEltcGw6IHRoaXMuZmV0Y2hJbXBsIH0pLFxuICAgICAgc3RvcmFnZSxcbiAgICAgIHNldHRpbmdzOiB7XG4gICAgICAgIG9ic2lkaWFuU3luYzogdGhpcy5kYXRhLnNldHRpbmdzLm9ic2lkaWFuU3luYyxcbiAgICAgICAgZXh0cmFJZ25vcmVzOiBwYXJzZUlnbm9yZVBhdHRlcm5zKHRoaXMuZGF0YS5zZXR0aW5ncy5pZ25vcmVQYXR0ZXJucyksXG4gICAgICB9LFxuICAgICAgbG9nOiB0aGlzLnN5bmNMb2csXG4gICAgICBub3c6IHRoaXMubm93LFxuICAgIH0pO1xuICAgIHRoaXMuY2xpZW50ID0gY2xpZW50O1xuICAgIHRoaXMuYXV0aEZhaWxlZCA9IGZhbHNlO1xuICAgIHRoaXMuc3RhdHVzTm90ZSA9ICcnO1xuICAgIHRoaXMuc3VwZXJ2aXNvciA9IG5ldyBSZWNvbm5lY3RTdXBlcnZpc29yKHRoaXMub3ZlcnJpZGVzLnJlY29ubmVjdCA/PyB7fSk7XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgY2xpZW50LmNvbm5lY3QoKTsgLy8gc3RhcnR1cCByZWNvbmNpbGlhdGlvbiBcdTIxOTIgbGl2ZSBtb2RlXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuaGFuZGxlU3luY0Vycm9yKGVycm9yLCAnc3RhcnR1cCBzeW5jIGZhaWxlZCcpO1xuICAgIH1cblxuICAgIC8vIExpdmUgd2F0Y2hpbmc6IHZhdWx0IGV2ZW50cyAoZGVib3VuY2VkIGluIGNvcmUpICsgcmVzY2FuIGhvb2tzLlxuICAgIHRoaXMud2F0Y2hlciA9IG5ldyBPYnNpZGlhbldhdGNoQWRhcHRlcih7IHZhdWx0OiB0aGlzLmFwcC52YXVsdCB9KTtcbiAgICBjbGllbnQuc3RhcnRXYXRjaGluZyh0aGlzLndhdGNoZXIpO1xuICAgIHRoaXMucmVzY2FuID0gbmV3IFJlc2NhblNjaGVkdWxlcih7XG4gICAgICBpbnRlcnZhbE1zOiB0aGlzLmRhdGEuc2V0dGluZ3MucmVzY2FuSW50ZXJ2YWxTZWMgKiAxMDAwLFxuICAgIH0pO1xuICAgIHRoaXMucmVzY2FuLnN0YXJ0KCgpID0+IHtcbiAgICAgIHZvaWQgY2xpZW50LnRyaWdnZXJTeW5jKCkuY2F0Y2goKGVycm9yOiB1bmtub3duKSA9PiB7XG4gICAgICAgIHRoaXMuaGFuZGxlU3luY0Vycm9yKGVycm9yLCAncmVzY2FuIGZhaWxlZCcpO1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICAvLyBTdGF0dXMgYmFyIChwZXIgdGhlIHN0YXR1c0Jhck1vZGUgc2V0dGluZykgKyB0aGUgMSBIeiBzdXBlcnZpc2lvbiB0aWNrXG4gICAgLy8gdGhhdCByZXBhaW50cyBpdCBhbmQgc3VwZXJ2aXNlcyByZWNvbm5lY3Rpb24uXG4gICAgdGhpcy5tb3VudFN0YXR1c0JhcigpO1xuICAgIGNvbnN0IHRpY2sgPSBzZXRJbnRlcnZhbCgoKSA9PiB0aGlzLm9uVGljaygpLCBTVVBFUlZJU0lPTl9USUNLX01TKTtcbiAgICB0aGlzLnRpY2tIYW5kbGUgPSB0aWNrO1xuICAgIHRoaXMucmVnaXN0ZXJJbnRlcnZhbCh0aWNrIGFzIHVua25vd24gYXMgbnVtYmVyKTsgLy8gT2JzaWRpYW4gY2xlYXJzIHRoaXMgb24gdW5sb2FkXG4gICAgdGhpcy5vblRpY2soKTtcbiAgfVxuXG4gIC8qKiAoUmUpbW91bnQgdGhlIHN0YXR1cy1iYXIgaXRlbSBwZXIgdGhlIGN1cnJlbnQgbW9kZSAoJ2hpZGRlbicgPSBub25lKS4gKi9cbiAgcHJpdmF0ZSBtb3VudFN0YXR1c0JhcigpOiB2b2lkIHtcbiAgICB0aGlzLnN0YXR1c0Jhckl0ZW0/LnJlbW92ZSgpO1xuICAgIHRoaXMuc3RhdHVzQmFySXRlbSA9IG51bGw7XG4gICAgdGhpcy5zdGF0dXNCYXIgPSBudWxsO1xuICAgIGlmICh0aGlzLmNsaWVudCA9PT0gbnVsbCkgcmV0dXJuO1xuICAgIGlmICh0aGlzLmRhdGEuc2V0dGluZ3Muc3RhdHVzQmFyTW9kZSA9PT0gJ2hpZGRlbicpIHJldHVybjtcbiAgICBjb25zdCBpdGVtID0gdGhpcy5hZGRTdGF0dXNCYXJJdGVtKCk7XG4gICAgdGhpcy5zdGF0dXNCYXJJdGVtID0gaXRlbTtcbiAgICB0aGlzLnN0YXR1c0JhciA9IG5ldyBTdGF0dXNCYXJJbmRpY2F0b3IoaXRlbSk7XG4gIH1cblxuICAvKiogVGVhciBkb3duIGV2ZXJ5IHRpbWVyLCB3YXRjaGVyLCBzb2NrZXQsIGFuZCBVSSBhcnRpZmFjdC4gSWRlbXBvdGVudC4gKi9cbiAgcHJpdmF0ZSBzdG9wU3luYygpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5yZWNvbm5lY3RUaW1lciAhPT0gbnVsbCkge1xuICAgICAgY2xlYXJUaW1lb3V0KHRoaXMucmVjb25uZWN0VGltZXIpO1xuICAgICAgdGhpcy5yZWNvbm5lY3RUaW1lciA9IG51bGw7XG4gICAgfVxuICAgIGlmICh0aGlzLnRpY2tIYW5kbGUgIT09IG51bGwpIHtcbiAgICAgIGNsZWFySW50ZXJ2YWwodGhpcy50aWNrSGFuZGxlKTtcbiAgICAgIHRoaXMudGlja0hhbmRsZSA9IG51bGw7XG4gICAgfVxuICAgIHRoaXMucmVzY2FuPy5zdG9wKCk7XG4gICAgdGhpcy5yZXNjYW4gPSBudWxsO1xuICAgIHRoaXMuY2xpZW50Py5jbG9zZSgpOyAvLyBhbHNvIHN0b3BzIHRoZSB3YXRjaGVyXG4gICAgdGhpcy5jbGllbnQgPSBudWxsO1xuICAgIHRoaXMud2F0Y2hlciA9IG51bGw7XG4gICAgdGhpcy5zdGF0dXNCYXJJdGVtPy5yZW1vdmUoKTtcbiAgICB0aGlzLnN0YXR1c0Jhckl0ZW0gPSBudWxsO1xuICAgIHRoaXMuc3RhdHVzQmFyID0gbnVsbDtcbiAgfVxuXG4gIC8vIC0tLSB1c2VyIGFjdGlvbnMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIGFzeW5jIHN5bmNOb3coKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKHRoaXMucGF1c2VkKSB7XG4gICAgICBuZXcgTm90aWNlKCdWYXVsdFN5bmM6IHN5bmNpbmcgaXMgcGF1c2VkIFx1MjAxNCByZXN1bWUgaXQgaW4gc2V0dGluZ3MgZmlyc3QuJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IGNsaWVudCA9IHRoaXMuY2xpZW50O1xuICAgIGlmIChjbGllbnQgPT09IG51bGwpIHtcbiAgICAgIGlmICghdGhpcy5saW5rZWQpIHtcbiAgICAgICAgbmV3IE5vdGljZSgnVmF1bHRTeW5jOiBub3QgcGFpcmVkIHlldCBcdTIwMTQgYWRkIHlvdXIgd29ya2VyIFVSTCBhbmQgYSBwYWlyaW5nIGNvZGUgaW4gc2V0dGluZ3MuJyk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIC8vIE1hbnVhbC1vbmx5IG1vZGUgKFwiU3luYyBvbiBzdGFydHVwXCIgT0ZGKTogdGhpcyBpcyB0aGUgZmlyc3Qgc3RhcnQuXG4gICAgICBhd2FpdCB0aGlzLnN0YXJ0U3luYygpO1xuICAgICAgY29uc3Qgc3RhdHVzID0gdGhpcy5jbGllbnQ/LnN0YXR1cygpO1xuICAgICAgaWYgKHN0YXR1cyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIG5ldyBOb3RpY2UoXG4gICAgICAgICAgc3RhdHVzLnN0YXRlID09PSAnZGlzY29ubmVjdGVkJ1xuICAgICAgICAgICAgPyAnVmF1bHRTeW5jOiBvZmZsaW5lIFx1MjAxNCBjaGFuZ2VzIHdpbGwgc3luYyB3aGVuIHRoZSB3b3JrZXIgaXMgcmVhY2hhYmxlLidcbiAgICAgICAgICAgIDogJ1ZhdWx0U3luYzogdXAgdG8gZGF0ZS4nLFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0cnkge1xuICAgICAgYXdhaXQgY2xpZW50LnRyaWdnZXJTeW5jKCk7XG4gICAgICBjb25zdCBzdGF0dXMgPSBjbGllbnQuc3RhdHVzKCk7XG4gICAgICBuZXcgTm90aWNlKFxuICAgICAgICBzdGF0dXMuc3RhdGUgPT09ICdkaXNjb25uZWN0ZWQnXG4gICAgICAgICAgPyAnVmF1bHRTeW5jOiBvZmZsaW5lIFx1MjAxNCBjaGFuZ2VzIHdpbGwgc3luYyB3aGVuIHRoZSB3b3JrZXIgaXMgcmVhY2hhYmxlLidcbiAgICAgICAgICA6ICdWYXVsdFN5bmM6IHVwIHRvIGRhdGUuJyxcbiAgICAgICk7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuaGFuZGxlU3luY0Vycm9yKGVycm9yLCAnc3luYyBub3cgZmFpbGVkJyk7XG4gICAgICBuZXcgTm90aWNlKCdWYXVsdFN5bmM6IHN5bmMgZmFpbGVkIFx1MjAxNCBzZWUgdGhlIGRldmVsb3BlciBjb25zb2xlIGZvciBkZXRhaWxzLicpO1xuICAgIH1cbiAgfVxuXG4gIC8qKiBQYXVzZTogdHJhbnNwb3J0IGRvd24gKyB3YXRjaGVyL3Jlc2NhbiBpZGxlLCBsaW5rIGFuZCBzdGF0ZSBrZXB0LiAqL1xuICBwYXVzZVN5bmNpbmcoKTogdm9pZCB7XG4gICAgaWYgKCF0aGlzLmxpbmtlZCB8fCB0aGlzLnBhdXNlZCkgcmV0dXJuO1xuICAgIHRoaXMucGF1c2VkID0gdHJ1ZTtcbiAgICBpZiAodGhpcy5yZWNvbm5lY3RUaW1lciAhPT0gbnVsbCkge1xuICAgICAgY2xlYXJUaW1lb3V0KHRoaXMucmVjb25uZWN0VGltZXIpO1xuICAgICAgdGhpcy5yZWNvbm5lY3RUaW1lciA9IG51bGw7XG4gICAgfVxuICAgIHRoaXMuc3VwZXJ2aXNvci5zZXR0bGVkKCk7XG4gICAgdGhpcy5yZXNjYW4/LnN0b3AoKTtcbiAgICB0aGlzLnJlc2NhbiA9IG51bGw7XG4gICAgdGhpcy5jbGllbnQ/LmNsb3NlKCk7IC8vIGFsc28gc3RvcHMgdGhlIHdhdGNoZXI7IHN0YXRlIFx1MjE5MiBpZGxlXG4gICAgdGhpcy5vblRpY2soKTsgLy8gcmVwYWludCBcInZzYSBcdTIzRjhcIlxuICAgIG5ldyBOb3RpY2UoJ1ZhdWx0U3luYzogcGF1c2VkLiBOZXcgYW5kIGNoYW5nZWQgZmlsZXMgc3RheSBsb2NhbCB1bnRpbCB5b3UgcmVzdW1lLicpO1xuICB9XG5cbiAgLyoqIFJlc3VtZTogcmVjb25uZWN0IGFuZCBydW4gYSBmdWxsIGNhdGNoLXVwIGN5Y2xlIChzdGFydHVwIHJlY29uY2lsaWF0aW9uKS4gKi9cbiAgYXN5bmMgcmVzdW1lU3luY2luZygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIXRoaXMubGlua2VkIHx8ICF0aGlzLnBhdXNlZCkgcmV0dXJuO1xuICAgIHRoaXMucGF1c2VkID0gZmFsc2U7XG4gICAgbmV3IE5vdGljZSgnVmF1bHRTeW5jOiByZXN1bWluZyBcdTIwMTQgcnVubmluZyBhIGZ1bGwgY2F0Y2gtdXAgc3luY1x1MjAyNicpO1xuICAgIGF3YWl0IHRoaXMuc3RhcnRTeW5jKCk7XG4gIH1cblxuICAvKiogUnVudGltZSBwYXVzZSBzdGF0ZSAodGhlIHNldHRpbmdzIHRhYidzIGJ1dHRvbiBsYWJlbCArIGRpYWdub3N0aWNzKS4gKi9cbiAgZ2V0IHN5bmNpbmdQYXVzZWQoKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIHRoaXMucGF1c2VkO1xuICB9XG5cbiAgYXN5bmMgYXBwbHlSZXNjYW5JbnRlcnZhbChzZWNvbmRzOiBudW1iZXIpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLmRhdGEuc2V0dGluZ3MucmVzY2FuSW50ZXJ2YWxTZWMgPSBNYXRoLm1heCgwLCBNYXRoLmZsb29yKHNlY29uZHMpKTtcbiAgICBhd2FpdCB0aGlzLnNhdmVQbHVnaW5EYXRhKCk7XG4gICAgdGhpcy5yZXNjYW4/LnNldEludGVydmFsTXModGhpcy5kYXRhLnNldHRpbmdzLnJlc2NhbkludGVydmFsU2VjICogMTAwMCk7XG4gIH1cblxuICBhc3luYyBhcHBseU9ic2lkaWFuU3luYyhlbmFibGVkOiBib29sZWFuKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5kYXRhLnNldHRpbmdzLm9ic2lkaWFuU3luYyA9IGVuYWJsZWQ7XG4gICAgYXdhaXQgdGhpcy5zYXZlUGx1Z2luRGF0YSgpO1xuICAgIG5ldyBOb3RpY2UoXG4gICAgICBlbmFibGVkXG4gICAgICAgID8gJ1ZhdWx0U3luYzogLm9ic2lkaWFuLyB3aWxsIHN5bmMgYWZ0ZXIgdGhlIG5leHQgcmVjb25uZWN0ICh0aGUgd29ya2VyXFx1MjAxOXMgcGVyLXZhdWx0IHNldHRpbmcgdGFrZXMgcHJlY2VkZW5jZSkuJ1xuICAgICAgICA6ICdWYXVsdFN5bmM6IC5vYnNpZGlhbi8gd2lsbCBiZSBleGNsdWRlZCBhZnRlciB0aGUgbmV4dCByZWNvbm5lY3QuJyxcbiAgICApO1xuICB9XG5cbiAgYXN5bmMgYXBwbHlTdGF0dXNCYXJNb2RlKG1vZGU6IFN0YXR1c0Jhck1vZGUpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLmRhdGEuc2V0dGluZ3Muc3RhdHVzQmFyTW9kZSA9IG1vZGU7XG4gICAgYXdhaXQgdGhpcy5zYXZlUGx1Z2luRGF0YSgpO1xuICAgIHRoaXMubW91bnRTdGF0dXNCYXIoKTsgLy8gcmUtbW91bnRzIChvciByZW1vdmVzKSB0aGUgaXRlbSBwZXIgdGhlIG1vZGVcbiAgICB0aGlzLm9uVGljaygpO1xuICB9XG5cbiAgYXN5bmMgYXBwbHlTeW5jT25TdGFydHVwKGVuYWJsZWQ6IGJvb2xlYW4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLmRhdGEuc2V0dGluZ3Muc3luY09uU3RhcnR1cCA9IGVuYWJsZWQ7XG4gICAgYXdhaXQgdGhpcy5zYXZlUGx1Z2luRGF0YSgpO1xuICAgIG5ldyBOb3RpY2UoXG4gICAgICBlbmFibGVkXG4gICAgICAgID8gJ1ZhdWx0U3luYzogc3luY2luZyB3aWxsIHN0YXJ0IGF1dG9tYXRpY2FsbHkgdGhlIG5leHQgdGltZSBPYnNpZGlhbiBvcGVucy4nXG4gICAgICAgIDogJ1ZhdWx0U3luYzogb24gdGhlIG5leHQgbGF1bmNoIHRoaXMgcGx1Z2luIHN0YXlzIGlkbGUgdW50aWwgeW91IHByZXNzIFx1MjAxQ1N5bmMgbm93XHUyMDFELicsXG4gICAgKTtcbiAgfVxuXG4gIGFzeW5jIGFwcGx5TG9nTGV2ZWwobGV2ZWw6IExvZ0xldmVsKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5kYXRhLnNldHRpbmdzLmxvZ0xldmVsID0gbGV2ZWw7XG4gICAgYXdhaXQgdGhpcy5zYXZlUGx1Z2luRGF0YSgpO1xuICAgIHRoaXMuc3luY0xvZy5zZXRMZXZlbChsZXZlbCk7XG4gIH1cblxuICAvKipcbiAgICogTmV3IGlnbm9yZSBwYXR0ZXJuczogcGVyc2lzdCwgdGhlbiByZXN0YXJ0IHRoZSBzeW5jIG1hY2hpbmVyeSB3aGlsZSBsaXZlXG4gICAqIHNvIHRoZSBzY2FuL3dhdGNoZXIgcGljayB0aGVtIHVwIGltbWVkaWF0ZWx5IChhIHBhdXNlZCBzZXNzaW9uIGFwcGxpZXNcbiAgICogdGhlbSBvbiByZXN1bWUgXHUyMDE0IHJlc3VtZSBhbHdheXMgcmVidWlsZHMgdGhlIGNsaWVudCkuXG4gICAqL1xuICBhc3luYyBhcHBseUlnbm9yZVBhdHRlcm5zKHRleHQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuZGF0YS5zZXR0aW5ncy5pZ25vcmVQYXR0ZXJucyA9IHRleHQ7XG4gICAgYXdhaXQgdGhpcy5zYXZlUGx1Z2luRGF0YSgpO1xuICAgIGlmICh0aGlzLmNsaWVudCAhPT0gbnVsbCAmJiAhdGhpcy5wYXVzZWQpIGF3YWl0IHRoaXMuc3RhcnRTeW5jKCk7XG4gIH1cblxuICAvKiogU3RvcmFnZS9hdHRhY2htZW50IHN1bW1hcnkgZm9yIHRoZSBBYm91dCBzZWN0aW9uIChudWxsID0gdW5hdmFpbGFibGUpLiAqL1xuICBhc3luYyBmZXRjaFN0b3JhZ2VTdW1tYXJ5KCk6IFByb21pc2U8V29ya2VyU3RhdHVzU3VtbWFyeSB8IG51bGw+IHtcbiAgICBpZiAoIXRoaXMubGlua2VkKSByZXR1cm4gbnVsbDtcbiAgICByZXR1cm4gZmV0Y2hXb3JrZXJTdGF0dXMoe1xuICAgICAgb3JpZ2luOiB0aGlzLmRhdGEudXJsLFxuICAgICAgdG9rZW46IHRoaXMuZGF0YS50b2tlbixcbiAgICAgIGZldGNoSW1wbDogdGhpcy5mZXRjaEltcGwsXG4gICAgfSk7XG4gIH1cblxuICAvKiogQ29weSB0aGUgZGlhZ25vc3RpY3MgYnVuZGxlIHRvIHRoZSBjbGlwYm9hcmQgKGZhbGxiYWNrOiBjb25zb2xlKS4gKi9cbiAgYXN5bmMgY29weURpYWdub3N0aWNzKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGJ1bmRsZSA9IGJ1aWxkRGlhZ25vc3RpY3NCdW5kbGUoe1xuICAgICAgcGx1Z2luVmVyc2lvbjogdGhpcy5tYW5pZmVzdC52ZXJzaW9uIHx8ICd1bmtub3duJyxcbiAgICAgIGRldmljZUlkOiB0aGlzLmRhdGEuZGV2aWNlSWQsXG4gICAgICBkZXZpY2VOYW1lOiB0aGlzLnJlc29sdmVEZXZpY2VOYW1lKCksXG4gICAgICB3b3JrZXJVcmw6IHRoaXMuZGF0YS51cmwsXG4gICAgICBwYWlyZWQ6IHRoaXMubGlua2VkLFxuICAgICAgcGF1c2VkOiB0aGlzLnBhdXNlZCxcbiAgICAgIGNsaWVudFN0YXR1czogdGhpcy5jbGllbnQ/LnN0YXR1cygpID8/IG51bGwsXG4gICAgICByZWNlbnRMb2dMaW5lczogdGhpcy5zeW5jTG9nLnJlY2VudExpbmVzKCksXG4gICAgfSk7XG4gICAgY29uc3QgY29waWVkID0gYXdhaXQgY29weVRvQ2xpcGJvYXJkKGJ1bmRsZSk7XG4gICAgaWYgKGNvcGllZCkge1xuICAgICAgbmV3IE5vdGljZSgnVmF1bHRTeW5jOiBkaWFnbm9zdGljcyBjb3BpZWQgdG8gdGhlIGNsaXBib2FyZC4nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc29sZS5pbmZvKCdbdnNhXSBkaWFnbm9zdGljcyAoY2xpcGJvYXJkIHVuYXZhaWxhYmxlKTpcXG4nICsgYnVuZGxlKTtcbiAgICBuZXcgTm90aWNlKCdWYXVsdFN5bmM6IGNsaXBib2FyZCB1bmF2YWlsYWJsZSBcdTIwMTQgZGlhZ25vc3RpY3Mgd3JpdHRlbiB0byB0aGUgZGV2ZWxvcGVyIGNvbnNvbGUuJywgMTAwMDApO1xuICB9XG5cbiAgLyoqIFRoZSBwbGF0Zm9ybSBsaW5lIGZvciB0aGUgQWJvdXQvZGlhZ25vc3RpY3MgcmVhZG91dHMuICovXG4gIHBsYXRmb3JtU3VtbWFyeSgpOiBzdHJpbmcge1xuICAgIHJldHVybiBwbGF0Zm9ybVN1bW1hcnkoKTtcbiAgfVxuXG4gIGFzeW5jIHVubGluaygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLnN0b3BTeW5jKCk7XG4gICAgdGhpcy5wYXVzZWQgPSBmYWxzZTtcbiAgICAvLyBDbGVhciBsb2NhbCBzeW5jIHN0YXRlIChkZXZpY2UgbWFya2VyICsgaW5kZXgpIHNvIGEgZnV0dXJlIGNsaWVudCBcdTIwMTRcbiAgICAvLyB0aGlzIHBsdWdpbiBhZnRlciBhIHJlLXBhaXIsIHRoZSBkYWVtb24sIHRoZSBDTEkgXHUyMDE0IHN0YXJ0cyBjbGVhblxuICAgIC8vIChGUi00NDogc3RhbGUgc3RhdGUgd291bGQgbWFrZSBpdCByZWZ1c2Ugb3IgbWlzLXN5bmMpLlxuICAgIGNvbnN0IHN0b3JhZ2UgPSB0aGlzLmNyZWF0ZVN0b3JhZ2VBZGFwdGVyKCk7XG4gICAgYXdhaXQgc3RvcmFnZS5kZWxldGVGaWxlKERFVklDRV9NQVJLRVJfVkFVTFRfUEFUSCk7XG4gICAgYXdhaXQgc3RvcmFnZS5kZWxldGVGaWxlKExPQ0FMX0lOREVYX1ZBVUxUX1BBVEgpO1xuICAgIHRoaXMuZGF0YSA9IHtcbiAgICAgIC4uLmRlZmF1bHRQbHVnaW5EYXRhKCksXG4gICAgICBkZXZpY2VOYW1lOiB0aGlzLmRhdGEuZGV2aWNlTmFtZSxcbiAgICAgIHNldHRpbmdzOiB0aGlzLmRhdGEuc2V0dGluZ3MsXG4gICAgfTtcbiAgICBhd2FpdCB0aGlzLnNhdmVQbHVnaW5EYXRhKCk7XG4gICAgbmV3IE5vdGljZShcbiAgICAgICdWYXVsdFN5bmM6IHVubGlua2VkLiBSZXZva2UgdGhpcyBkZXZpY2UgZnJvbSB0aGUgd29ya2VyIGRhc2hib2FyZCBpZiB5b3UgYXJlIGRvbmUgd2l0aCBpdC4nLFxuICAgICk7XG4gIH1cblxuICAvLyAtLS0gc3VwZXJ2aXNpb24gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICBwcml2YXRlIG9uVGljaygpOiB2b2lkIHtcbiAgICBjb25zdCBjbGllbnQgPSB0aGlzLmNsaWVudDtcbiAgICBpZiAoY2xpZW50ID09PSBudWxsKSByZXR1cm47XG4gICAgY29uc3Qgc3RhdHVzID0gY2xpZW50LnN0YXR1cygpO1xuICAgIHRoaXMuc3RhdHVzQmFyPy51cGRhdGUoXG4gICAgICBzdGF0dXMsXG4gICAgICB7XG4gICAgICAgIHVybDogdGhpcy5kYXRhLnVybCxcbiAgICAgICAgZGV2aWNlTmFtZTogdGhpcy5yZXNvbHZlRGV2aWNlTmFtZSgpLFxuICAgICAgICBub3RlOiB0aGlzLnN0YXR1c05vdGUsXG4gICAgICAgIHBhdXNlZDogdGhpcy5wYXVzZWQsXG4gICAgICAgIG1vZGU6IHRoaXMuZGF0YS5zZXR0aW5ncy5zdGF0dXNCYXJNb2RlLFxuICAgICAgfSxcbiAgICAgIHRoaXMubm93KCksXG4gICAgKTtcbiAgICBpZiAodGhpcy5wYXVzZWQgfHwgdGhpcy5hdXRoRmFpbGVkKSByZXR1cm47IC8vIG5vIHJlY29ubmVjdCB3aGlsZSBwYXVzZWQgLyB0b2tlbiByZWplY3RlZFxuICAgIGNvbnN0IGRlY2lzaW9uID0gdGhpcy5zdXBlcnZpc29yLmNvbnNpZGVyKHN0YXR1cy5zdGF0ZSk7XG4gICAgaWYgKGRlY2lzaW9uLmFjdGlvbiA9PT0gJ3dhaXQnKSByZXR1cm47XG4gICAgdGhpcy5zdXBlcnZpc29yLmFja25vd2xlZGdlZCgpO1xuICAgIHRoaXMuc2NoZWR1bGVSZWNvbm5lY3QoZGVjaXNpb24uZGVsYXlNcyk7XG4gIH1cblxuICBwcml2YXRlIHNjaGVkdWxlUmVjb25uZWN0KGRlbGF5TXM6IG51bWJlcik6IHZvaWQge1xuICAgIGlmICh0aGlzLnJlY29ubmVjdFRpbWVyICE9PSBudWxsKSByZXR1cm47IC8vIG9uZSBpbiBmbGlnaHQsIGFsd2F5c1xuICAgIHRoaXMucmVjb25uZWN0VGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRoaXMucmVjb25uZWN0VGltZXIgPSBudWxsO1xuICAgICAgY29uc3QgY2xpZW50ID0gdGhpcy5jbGllbnQ7XG4gICAgICBpZiAoY2xpZW50ID09PSBudWxsKSB7XG4gICAgICAgIHRoaXMuc3VwZXJ2aXNvci5zZXR0bGVkKCk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGNsaWVudFxuICAgICAgICAucmVjb25uZWN0KClcbiAgICAgICAgLnRoZW4oXG4gICAgICAgICAgKCkgPT4ge1xuICAgICAgICAgICAgdGhpcy5zdXBlcnZpc29yLnNldHRsZWQoKTtcbiAgICAgICAgICB9LFxuICAgICAgICAgIChlcnJvcjogdW5rbm93bikgPT4ge1xuICAgICAgICAgICAgdGhpcy5zdXBlcnZpc29yLnNldHRsZWQoKTtcbiAgICAgICAgICAgIHRoaXMuaGFuZGxlU3luY0Vycm9yKGVycm9yLCAncmVjb25uZWN0IGZhaWxlZCcpO1xuICAgICAgICAgIH0sXG4gICAgICAgIClcbiAgICAgICAgLmNhdGNoKCgpID0+IHt9KTsgLy8gaGFuZGxlU3luY0Vycm9yIG5ldmVyIHRocm93czsgYmVsdCBhbmQgYnJhY2VzXG4gICAgfSwgZGVsYXlNcyk7XG4gIH1cblxuICAvKiogRGlzdGluZ3Vpc2ggZmF0YWwgYXV0aCBmYWlsdXJlcyBmcm9tIHRyYW5zaWVudCBuZXR3b3JrIHRyb3VibGUuICovXG4gIHByaXZhdGUgaGFuZGxlU3luY0Vycm9yKGVycm9yOiB1bmtub3duLCBjb250ZXh0OiBzdHJpbmcpOiB2b2lkIHtcbiAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBSZXZva2VkRXJyb3IgfHwgZXJyb3IgaW5zdGFuY2VvZiBVbmF1dGhvcml6ZWRFcnJvcikge1xuICAgICAgdGhpcy5hdXRoRmFpbGVkID0gdHJ1ZTtcbiAgICAgIHRoaXMuc3RhdHVzTm90ZSA9ICdEZXZpY2UgdG9rZW4gcmVqZWN0ZWQgXHUyMDE0IHVubGluayBhbmQgcmUtcGFpciB3aXRoIGEgZnJlc2ggY29kZS4nO1xuICAgICAgdGhpcy5zeW5jTG9nLmVycm9yKGNvbnRleHQsIGVycm9yKTtcbiAgICAgIG5ldyBOb3RpY2UoXG4gICAgICAgICdWYXVsdFN5bmM6IHRoZSB3b3JrZXIgcmVqZWN0ZWQgdGhpcyBkZXZpY2VcXHUyMDE5cyB0b2tlbiAocmV2b2tlZD8pLiBVbmxpbmsgYW5kIHJlLXBhaXIgZnJvbSBzZXR0aW5ncy4nLFxuICAgICAgICAxMDAwMCxcbiAgICAgICk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRoaXMuc3luY0xvZy53YXJuKGNvbnRleHQsIGVycm9yKTsgLy8gb2ZmbGluZS9wcm90b2NvbDogYmFja29mZiBrZWVwcyByZXRyeWluZ1xuICB9XG5cbiAgLyoqIEZSLTQ0OiB3YXJuIHdoZW4gdGhlIHZhdWx0J3Mgc3RhdGUgZGlyIGJlbG9uZ3MgdG8gYW5vdGhlciBjbGllbnQuICovXG4gIHByaXZhdGUgYXN5bmMgd2FybklmRm9yZWlnblN0YXRlRGlyKHN0b3JhZ2U6IE9ic2lkaWFuU3RvcmFnZUFkYXB0ZXIpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBsZXQgbWFya2VyOiB7IGRldmljZUlkPzogdW5rbm93bjsgZGV2aWNlTmFtZT86IHVua25vd247IHVybD86IHVua25vd24gfTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgYnl0ZXMgPSBhd2FpdCBzdG9yYWdlLnJlYWRGaWxlKERFVklDRV9NQVJLRVJfVkFVTFRfUEFUSCk7XG4gICAgICBtYXJrZXIgPSBKU09OLnBhcnNlKG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShieXRlcykpIGFzIHR5cGVvZiBtYXJrZXI7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm47IC8vIG5vIG1hcmtlciAob3IgdW5yZWFkYWJsZSkgXHUyMDE0IG5vdGhpbmcgdG8gd2FybiBhYm91dFxuICAgIH1cbiAgICBpZiAoXG4gICAgICB0eXBlb2YgbWFya2VyLmRldmljZUlkID09PSAnc3RyaW5nJyAmJlxuICAgICAgbWFya2VyLmRldmljZUlkICE9PSB0aGlzLmRhdGEuZGV2aWNlSWRcbiAgICApIHtcbiAgICAgIGNvbnN0IG5hbWUgPSB0eXBlb2YgbWFya2VyLmRldmljZU5hbWUgPT09ICdzdHJpbmcnID8gbWFya2VyLmRldmljZU5hbWUgOiBtYXJrZXIuZGV2aWNlSWQ7XG4gICAgICBjb25zdCB3aGVyZSA9IHR5cGVvZiBtYXJrZXIudXJsID09PSAnc3RyaW5nJyA/IG1hcmtlci51cmwgOiAnYSB3b3JrZXInO1xuICAgICAgbmV3IE5vdGljZShcbiAgICAgICAgYFZhdWx0U3luYzogdGhpcyB2YXVsdCBhbHJlYWR5IGhhcyBzeW5jIHN0YXRlIGZvciBkZXZpY2UgXCIke25hbWV9XCIgKGxpbmtlZCB0byAke3doZXJlfSkuIGAgK1xuICAgICAgICAgICdPbmUgc3luYyBjbGllbnQgcGVyIG1hY2hpbmUgcGVyIHZhdWx0IFx1MjAxNCBydW5uaW5nIHR3byBkb3VibGUtY29tbWl0cyBldmVyeSBjaGFuZ2UuICcgK1xuICAgICAgICAgICdVbmxpbmsgdGhlIG90aGVyIGNsaWVudCAob3IgY2xlYXIgLnZhdWx0c3luY2ZvcmFnZW50cy8pIGlmIHRoaXMgaXMgdW5leHBlY3RlZC4nLFxuICAgICAgICAxNTAwMCxcbiAgICAgICk7XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZVdvcmtlclVybFNhZmUoaW5wdXQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZVdvcmtlclVybChpbnB1dCk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBpbnB1dDtcbiAgfVxufVxuIiwgIi8qKlxuICogVmF1bHQgcGF0aCB1dGlsaXRpZXMuXG4gKlxuICogVmF1bHQtaW50ZXJuYWwgcGF0aHMgYXJlIFBPU0lYLW5vcm1hbGl6ZWQgc3RyaW5ncyByZWxhdGl2ZSB0byB0aGUgdmF1bHQgcm9vdDpcbiAqICAgLSBhbHdheXMgc3RhcnQgd2l0aCBgL2AgKGAvYS9iLm1kYCk7IHRoZSB2YXVsdCByb290IGl0c2VsZiBpcyBgL2BcbiAqICAgLSBzZWdtZW50cyBzZXBhcmF0ZWQgYnkgYC9gOyBubyB0cmFpbGluZyBzbGFzaCwgbm8gYC5gL2AuLmAgc2VnbWVudHMsXG4gKiAgICAgbm8gZHVwbGljYXRlIHNsYXNoZXNcbiAqICAgLSBuZXZlciBlc2NhcGUgdGhlIHJvb3Q6IGFueSBgLi5gIHRoYXQgd291bGQgcG9wIGFib3ZlIGAvYCBpcyByZWplY3RlZFxuICpcbiAqIEJhY2tzbGFzaGVzIGFyZSBjb252ZXJ0ZWQgdG8gYC9gIChXaW5kb3dzIGNhbGxlcnMgcm91dGluZWx5IGhhbmQgdXNcbiAqIGBkaXJcXGZpbGUubWRgKSwgYnV0IGFic29sdXRlIFdpbmRvd3MgcGF0aHMgKGRyaXZlIGxldHRlcnMgbGlrZSBgQzovYCwgVU5DXG4gKiBgXFxcXHNlcnZlclxcc2hhcmVgKSBhcmUgcmVqZWN0ZWQgXHUyMDE0IGEgdmF1bHQgcGF0aCBpcyBuZXZlciBhYnNvbHV0ZSBpbiB0aGUgaG9zdFxuICogZmlsZXN5c3RlbSBzZW5zZS5cbiAqL1xuXG4vKiogQSB2YXVsdC1pbnRlcm5hbCwgUE9TSVgtbm9ybWFsaXplZCBwYXRoIHN0cmluZyAoZS5nLiBgL25vdGVzL3RvZG8ubWRgKS4gKi9cbmV4cG9ydCB0eXBlIFZhdWx0UGF0aCA9IHN0cmluZztcblxuLyoqIFRocm93biB3aGVuIGEgcGF0aCBjYW5ub3QgYmUgaW50ZXJwcmV0ZWQgYXMgYSB2YXVsdC1pbnRlcm5hbCBwYXRoLiAqL1xuZXhwb3J0IGNsYXNzIEludmFsaWRWYXVsdFBhdGhFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgY29uc3RydWN0b3IobWVzc2FnZTogc3RyaW5nKSB7XG4gICAgc3VwZXIobWVzc2FnZSk7XG4gICAgdGhpcy5uYW1lID0gJ0ludmFsaWRWYXVsdFBhdGhFcnJvcic7XG4gIH1cbn1cblxuLyoqXG4gKiBOb3JtYWxpemUgYSB1c2VyLSBvciBwbGF0Zm9ybS1zdXBwbGllZCBwYXRoIGludG8gY2Fub25pY2FsIHZhdWx0IGZvcm0uXG4gKlxuICogQWNjZXB0ZWQ6IGBhL2IubWRgIChyb290LXJlbGF0aXZlIHdpdGhvdXQgbGVhZGluZyBzbGFzaCksIGAvYS9iLm1kYCxcbiAqIGBhXFxiLm1kYCAoYmFja3NsYXNoIGNvbnZlcnNpb24pLCBgYS8uL2IubWRgLCBgYS9iLy4uL2MubWRgIChpbnRlcmlvciBgLi5gXG4gKiByZXNvbHZlcyksIGR1cGxpY2F0ZSBzbGFzaGVzLCB0cmFpbGluZyBzbGFzaGVzLlxuICpcbiAqIFJlamVjdGVkOiBgLi5gIGVzY2FwaW5nIHRoZSByb290IChgLy4uL2FgLCBgL2EvLi4vLi5gKSwgYWJzb2x1dGUgV2luZG93c1xuICogZHJpdmUgcGF0aHMgKGBDOi92YXVsdC9hLm1kYCwgYEM6XFx2YXVsdFxcYS5tZGApLCBVTkMgcGF0aHMgKGBcXFxcc3J2XFxzaGFyZWApLFxuICogbGVhZGluZyBgLy9gLCBOVUwgYnl0ZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVWYXVsdFBhdGgoaW5wdXQ6IHN0cmluZyk6IFZhdWx0UGF0aCB7XG4gIGlmICh0eXBlb2YgaW5wdXQgIT09ICdzdHJpbmcnKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRWYXVsdFBhdGhFcnJvcihgVmF1bHQgcGF0aCBtdXN0IGJlIGEgc3RyaW5nLCBnb3QgJHt0eXBlb2YgaW5wdXR9YCk7XG4gIH1cbiAgaWYgKGlucHV0LmluY2x1ZGVzKCdcXDAnKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkVmF1bHRQYXRoRXJyb3IoYFZhdWx0IHBhdGggY29udGFpbnMgTlVMIGJ5dGU6ICR7SlNPTi5zdHJpbmdpZnkoaW5wdXQpfWApO1xuICB9XG4gIGlmICgvXlthLXpBLVpdOi8udGVzdChpbnB1dCkpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZFZhdWx0UGF0aEVycm9yKFxuICAgICAgYFZhdWx0IHBhdGggbXVzdCBub3QgYmUgYW4gYWJzb2x1dGUgaG9zdCBwYXRoIChkcml2ZSBsZXR0ZXIpOiAke0pTT04uc3RyaW5naWZ5KGlucHV0KX1gLFxuICAgICk7XG4gIH1cbiAgaWYgKGlucHV0LnN0YXJ0c1dpdGgoJ1xcXFxcXFxcJykpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZFZhdWx0UGF0aEVycm9yKFxuICAgICAgYFZhdWx0IHBhdGggbXVzdCBub3QgYmUgYSBVTkMgcGF0aDogJHtKU09OLnN0cmluZ2lmeShpbnB1dCl9YCxcbiAgICApO1xuICB9XG5cbiAgY29uc3QgY29udmVydGVkID0gaW5wdXQucmVwbGFjZSgvXFxcXC9nLCAnLycpO1xuICBpZiAoY29udmVydGVkLnN0YXJ0c1dpdGgoJy8vJykpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZFZhdWx0UGF0aEVycm9yKFxuICAgICAgYFZhdWx0IHBhdGggbXVzdCBub3Qgc3RhcnQgd2l0aCBcIi8vXCIgKFVOQyBvciBwcm90b2NvbC1zdHlsZSBwYXRoKTogJHtKU09OLnN0cmluZ2lmeShpbnB1dCl9YCxcbiAgICApO1xuICB9XG5cbiAgY29uc3Qgc2VnbWVudHM6IHN0cmluZ1tdID0gW107XG4gIGZvciAoY29uc3Qgc2VnbWVudCBvZiBjb252ZXJ0ZWQuc3BsaXQoJy8nKSkge1xuICAgIGlmIChzZWdtZW50ID09PSAnJyB8fCBzZWdtZW50ID09PSAnLicpIGNvbnRpbnVlO1xuICAgIGlmIChzZWdtZW50ID09PSAnLi4nKSB7XG4gICAgICBpZiAoc2VnbWVudHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIHRocm93IG5ldyBJbnZhbGlkVmF1bHRQYXRoRXJyb3IoXG4gICAgICAgICAgYFZhdWx0IHBhdGggZXNjYXBlcyB0aGUgdmF1bHQgcm9vdDogJHtKU09OLnN0cmluZ2lmeShpbnB1dCl9YCxcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIHNlZ21lbnRzLnBvcCgpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIHNlZ21lbnRzLnB1c2goc2VnbWVudCk7XG4gIH1cbiAgcmV0dXJuIHNlZ21lbnRzLmxlbmd0aCA9PT0gMCA/ICcvJyA6IGAvJHtzZWdtZW50cy5qb2luKCcvJyl9YDtcbn1cblxuLyoqXG4gKiBKb2luIGEgYmFzZSB2YXVsdCBwYXRoIHdpdGggb25lIG9yIG1vcmUgcmVsYXRpdmUgcGF0aCBwYXJ0cy5cbiAqXG4gKiBFYWNoIHBhcnQgbXVzdCBiZSByZWxhdGl2ZSAobm8gbGVhZGluZyBgL2AgYWZ0ZXIgYmFja3NsYXNoIGNvbnZlcnNpb24pIGFuZFxuICogaXMgYXBwZW5kZWQgdG8gdGhlIGJhc2UgYmVmb3JlIG5vcm1hbGl6YXRpb247IGAuLmAgaW5zaWRlIHBhcnRzIG1heSBub3RcbiAqIGVzY2FwZSB0aGUgcmVzdWx0aW5nIHJvb3QuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBqb2luUGF0aChiYXNlOiBzdHJpbmcsIC4uLnBhcnRzOiByZWFkb25seSBzdHJpbmdbXSk6IFZhdWx0UGF0aCB7XG4gIGxldCBjb21iaW5lZCA9IG5vcm1hbGl6ZVZhdWx0UGF0aChiYXNlKTtcbiAgZm9yIChjb25zdCBwYXJ0IG9mIHBhcnRzKSB7XG4gICAgY29uc3QgY29udmVydGVkID0gcGFydC5yZXBsYWNlKC9cXFxcL2csICcvJyk7XG4gICAgaWYgKGNvbnZlcnRlZC5zdGFydHNXaXRoKCcvJykpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkVmF1bHRQYXRoRXJyb3IoXG4gICAgICAgIGBqb2luUGF0aCBwYXJ0cyBtdXN0IGJlIHJlbGF0aXZlLCBnb3QgJHtKU09OLnN0cmluZ2lmeShwYXJ0KX1gLFxuICAgICAgKTtcbiAgICB9XG4gICAgY29tYmluZWQgPSBgJHtjb21iaW5lZCA9PT0gJy8nID8gJycgOiBjb21iaW5lZH0vJHtjb252ZXJ0ZWR9YDtcbiAgfVxuICByZXR1cm4gbm9ybWFsaXplVmF1bHRQYXRoKGNvbWJpbmVkKTtcbn1cblxuLyoqXG4gKiBQYXJlbnQgZGlyZWN0b3J5IG9mIGEgdmF1bHQgcGF0aC4gVGhlIHBhcmVudCBvZiBgL2AgaXMgYC9gICh0aGUgcm9vdCBoYXMgbm9cbiAqIHBhcmVudCBhYm92ZSBpdCk7IHdhbGsgYHdoaWxlIChwICE9PSBwYXJlbnRQYXRoKHApKWAgc3R5bGUgbG9vcHMgdGVybWluYXRlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyZW50UGF0aChwYXRoOiBzdHJpbmcpOiBWYXVsdFBhdGgge1xuICBjb25zdCBub3JtYWxpemVkID0gbm9ybWFsaXplVmF1bHRQYXRoKHBhdGgpO1xuICBpZiAobm9ybWFsaXplZCA9PT0gJy8nKSByZXR1cm4gJy8nO1xuICBjb25zdCBsYXN0U2xhc2ggPSBub3JtYWxpemVkLmxhc3RJbmRleE9mKCcvJyk7XG4gIHJldHVybiBsYXN0U2xhc2ggPT09IDAgPyAnLycgOiBub3JtYWxpemVkLnNsaWNlKDAsIGxhc3RTbGFzaCk7XG59XG5cbi8qKlxuICogRmluYWwgcGF0aCBzZWdtZW50LiBgYmFzZW5hbWUoJy9hL2IubWQnKWAgXHUyMTkyIGBiLm1kYDsgYGJhc2VuYW1lKCcvJylgIFx1MjE5MiBgJydgLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYmFzZW5hbWUocGF0aDogc3RyaW5nKTogVmF1bHRQYXRoIHtcbiAgY29uc3Qgbm9ybWFsaXplZCA9IG5vcm1hbGl6ZVZhdWx0UGF0aChwYXRoKTtcbiAgaWYgKG5vcm1hbGl6ZWQgPT09ICcvJykgcmV0dXJuICcnO1xuICByZXR1cm4gbm9ybWFsaXplZC5zbGljZShub3JtYWxpemVkLmxhc3RJbmRleE9mKCcvJykgKyAxKTtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIGBjaGlsZGAgbmFtZXMgc29tZXRoaW5nIGF0IGxlYXN0IG9uZSBsZXZlbCBCRUxPVyBgYW5jZXN0b3JgXG4gKiAoYm90aCBub3JtYWxpemVkIHZhdWx0IHBhdGhzKS4gVGhlIHJvb3QgaXMgYW4gYW5jZXN0b3Igb2YgZXZlcnl0aGluZ1xuICogZXhjZXB0IGl0c2VsZjsgYSBwYXRoIGlzIG5ldmVyIHN0cmljdGx5IGJlbmVhdGggaXRzZWxmLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNTdHJpY3RseUJlbmVhdGgoY2hpbGQ6IHN0cmluZywgYW5jZXN0b3I6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBpZiAoYW5jZXN0b3IgPT09ICcvJykgcmV0dXJuIGNoaWxkICE9PSAnLyc7XG4gIHJldHVybiBjaGlsZC5sZW5ndGggPiBhbmNlc3Rvci5sZW5ndGggJiYgY2hpbGQuc3RhcnRzV2l0aChgJHthbmNlc3Rvcn0vYCk7XG59XG4iLCAiLyoqXG4gKiBMb2dpY2FsIGNsb2NrIG9wZXJhdGlvbnMgKEFSQ0hJVEVDVFVSRS5tZCBcdTAwQTc0KS5cbiAqXG4gKiBDbG9ja3MgYXJlIHBlci1maWxlIG1vbm90b25pYyBjb3VudGVycyBvd25lZCBieSB0aGUgc3luYyBhdXRob3JpdHkgKHRoZVxuICogRHVyYWJsZSBPYmplY3QpLiBBIGNsb2NrIHBhaXJzIHRoZSBjb3VudGVyIHdpdGggdGhlIGlkIG9mIHRoZSBkZXZpY2UgdGhhdFxuICogcHJvZHVjZWQgaXQuIE9yZGVyaW5nIGlzIGZ1bGx5IGRldGVybWluaXN0aWMgb24gZXZlcnkgY2xpZW50OlxuICpcbiAqICAgMS4gaGlnaGVyIGBjb3VudGVyYCB3aW5zO1xuICogICAyLiBleGFjdCBjb3VudGVyIHRpZSBcdTIxOTIgbGV4aWNvZ3JhcGhpY2FsbHkgZ3JlYXRlciBgZGV2aWNlSWRgIHdpbnNcbiAqICAgICAgKHBsYWluIEpTIHN0cmluZyBjb21wYXJpc29uLCBpLmUuIGJ5IFVURi0xNiBjb2RlIHVuaXRzKTtcbiAqICAgMy4gaWRlbnRpY2FsIGNvdW50ZXIgKmFuZCogaWRlbnRpY2FsIGRldmljZUlkIFx1MjE5MiB0aGUgY2xvY2tzIGFyZSBlcXVhbC5cbiAqXG4gKiBXYWxsLWNsb2NrIHRpbWUgbmV2ZXIgcGFydGljaXBhdGVzIGluIG9yZGVyaW5nIChkaXNwbGF5LW9ubHkgcGVyIFx1MDBBNzQpLlxuICovXG5cbmltcG9ydCB0eXBlIHsgTG9naWNhbENsb2NrIH0gZnJvbSAnLi90eXBlcy5qcyc7XG5cbi8qKiBSZXN1bHQgb2YgYGNvbXBhcmVDbG9ja3NgOiBzaWduIG9mIGBhYCB2cyBgYmAgKHBvc2l0aXZlIFx1MjFEMiBgYWAgd2lucykuICovXG5leHBvcnQgdHlwZSBDbG9ja0NvbXBhcmlzb24gPSAtMSB8IDAgfCAxO1xuXG4vKipcbiAqIENvbXBhcmUgdHdvIGxvZ2ljYWwgY2xvY2tzLlxuICpcbiAqIFJldHVybnMgYDFgIHdoZW4gYGFgIHdpbnMsIGAtMWAgd2hlbiBgYmAgd2lucywgYDBgIHdoZW4gdGhlIGNsb2NrcyBhcmVcbiAqIGlkZW50aWNhbCAoc2FtZSBjb3VudGVyICphbmQqIHNhbWUgZGV2aWNlSWQgXHUyMDE0IGluIHByYWN0aWNlIG9ubHkgd2hlblxuICogY29tcGFyaW5nIGEgY2xvY2sgd2l0aCBpdHNlbGYpLiBDYWxsZXJzIHRoYXQgbXVzdCBwaWNrIGEgc2lkZSBvbiBgMGBcbiAqIHNob3VsZCBkbyBzbyBleHBsaWNpdGx5IGFuZCBkb2N1bWVudCB0aGUgY2hvaWNlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY29tcGFyZUNsb2NrcyhhOiBMb2dpY2FsQ2xvY2ssIGI6IExvZ2ljYWxDbG9jayk6IENsb2NrQ29tcGFyaXNvbiB7XG4gIGlmIChhLmNvdW50ZXIgIT09IGIuY291bnRlcikgcmV0dXJuIGEuY291bnRlciA+IGIuY291bnRlciA/IDEgOiAtMTtcbiAgaWYgKGEuZGV2aWNlSWQgIT09IGIuZGV2aWNlSWQpIHJldHVybiBhLmRldmljZUlkID4gYi5kZXZpY2VJZCA/IDEgOiAtMTtcbiAgcmV0dXJuIDA7XG59XG5cbi8qKlxuICogVGhlIGNsb2NrIGEgY29tbWl0IGZyb20gYGRldmljZUlkYCB3b3VsZCByZWNlaXZlIHdoZW4gYnVpbGRpbmcgb24gYHBhcmVudGBcbiAqIChvciBvbiBub3RoaW5nLCB3aGVuIGBwYXJlbnRgIGlzIGFic2VudCk6IHBhcmVudCdzIGNvdW50ZXIgKyAxLlxuICpcbiAqIFRoaXMgaXMgdGhlICp0ZW50YXRpdmUqIGNsb2NrIHVzZWQgYnkgY2xpZW50LXNpZGUgY29uZmxpY3QgcHJlZGljdGlvblxuICogKGByZXNvbHZlLnRzYCk6IHRoZSBETyBhc3NpZ25zIHJlYWwgY291bnRlcnMgd2l0aCB0aGUgc2FtZSBydWxlLCBzbyB0aGVcbiAqIHByZWRpY3Rpb24gbWF0Y2hlcyB0aGUgc2VydmVyJ3MgYXJiaXRyYXRpb24gYXMgbG9uZyBhcyBib3RoIHNpZGVzIGJ1aWxkIG9uXG4gKiB0aGUgc2FtZSBwYXJlbnQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBuZXh0Q2xvY2soXG4gIHBhcmVudDogTG9naWNhbENsb2NrIHwgbnVsbCB8IHVuZGVmaW5lZCxcbiAgZGV2aWNlSWQ6IHN0cmluZyxcbik6IExvZ2ljYWxDbG9jayB7XG4gIHJldHVybiB7IGNvdW50ZXI6IChwYXJlbnQ/LmNvdW50ZXIgPz8gMCkgKyAxLCBkZXZpY2VJZCB9O1xufVxuIiwgIi8qKlxuICogQ29udGVudCBoYXNoaW5nIGFuZCBjb21wcmVzc2lvbiBcdTIwMTQgV2ViIEFQSXMgb25seS5cbiAqXG4gKiBgY3J5cHRvLnN1YnRsZWAgaXMgYXZhaWxhYmxlIGluIE5vZGUgMTgrLCBDbG91ZGZsYXJlIFdvcmtlcnMsXG4gKiBhbmQgT2JzaWRpYW4gKEVsZWN0cm9uKS4gYENvbXByZXNzaW9uU3RyZWFtYCBsaWtld2lzZS4gTm8gTm9kZSBpbXBvcnRzOlxuICogdGhpcyBtb2R1bGUgbXVzdCBydW4gdW5jaGFuZ2VkIGluIGV2ZXJ5IGNsaWVudCAoQVJDSElURUNUVVJFLm1kIFx1MDBBNzgpLlxuICovXG5cbi8qKiBIYXNoIG9mIGBieXRlc2AgYXMgbG93ZXJjYXNlIHNoYTI1NiBoZXguIE1hdGNoZXMgUjIgYmxvYiBrZXlzIGBibG9icy97c2hhMjU2fWAuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc2hhMjU2SGV4KGJ5dGVzOiBVaW50OEFycmF5IHwgc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgZGF0YSA9IHR5cGVvZiBieXRlcyA9PT0gJ3N0cmluZycgPyBuZXcgVGV4dEVuY29kZXIoKS5lbmNvZGUoYnl0ZXMpIDogYnl0ZXM7XG4gIC8vIGBjcnlwdG9gIChub3QgYGdsb2JhbFRoaXMuY3J5cHRvYCk6IHRoZSBiYXJlIGlkZW50aWZpZXIgcmVzb2x2ZXMgaW4gZXZlcnlcbiAgLy8gdGFyZ2V0J3MgdHlwZXMgKERPTSBsaWIsIENsb3VkZmxhcmUgd29ya2VyZCB0eXBlcywgTm9kZSkgXHUyMDE0IHRoZSBxdWFsaWZpZWRcbiAgLy8gZm9ybSBkb2VzIG5vdCwgYmVjYXVzZSB3b3JrZXJzIHR5cGVzIGRlY2xhcmUgaXQgYGNvbnN0YCwgd2hpY2ggbmV2ZXJcbiAgLy8gbWVyZ2VzIGludG8gYHR5cGVvZiBnbG9iYWxUaGlzYC5cbiAgY29uc3QgZGlnZXN0ID0gYXdhaXQgY3J5cHRvLnN1YnRsZS5kaWdlc3QoJ1NIQS0yNTYnLCBkYXRhIGFzIEJ1ZmZlclNvdXJjZSk7XG4gIHJldHVybiB0b0hleChuZXcgVWludDhBcnJheShkaWdlc3QpKTtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIGd6aXAgc3RyZWFtcyBhcmUgYXZhaWxhYmxlIGluIHRoaXMgcnVudGltZS4gT2xkZXIgT2JzaWRpYW4gbW9iaWxlXG4gKiB3ZWJ2aWV3cyBtYXkgbGFjayBgQ29tcHJlc3Npb25TdHJlYW1gOyBjYWxsZXJzIGZhbGwgYmFjayB0byBpZGVudGl0eS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN1cHBvcnRzQ29tcHJlc3Npb24oKTogYm9vbGVhbiB7XG4gIHJldHVybiAoXG4gICAgdHlwZW9mIENvbXByZXNzaW9uU3RyZWFtICE9PSAndW5kZWZpbmVkJyAmJlxuICAgIHR5cGVvZiBEZWNvbXByZXNzaW9uU3RyZWFtICE9PSAndW5kZWZpbmVkJ1xuICApO1xufVxuXG4vKipcbiAqIEd6aXAgYGRhdGFgLiBGYWxscyBiYWNrIHRvIGlkZW50aXR5IChyZXR1cm5zIGlucHV0IHVuY2hhbmdlZCkgd2hlblxuICogYENvbXByZXNzaW9uU3RyZWFtYCBpcyB1bmF2YWlsYWJsZSBcdTIwMTQgY2FsbCBgc3VwcG9ydHNDb21wcmVzc2lvbigpYCBmaXJzdCBpZlxuICogeW91IG11c3Qga25vdyB3aGljaCBoYXBwZW5lZC5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGNvbXByZXNzKGRhdGE6IFVpbnQ4QXJyYXkpOiBQcm9taXNlPFVpbnQ4QXJyYXk+IHtcbiAgaWYgKCFzdXBwb3J0c0NvbXByZXNzaW9uKCkpIHJldHVybiBkYXRhO1xuICAvLyBgYXMgQnVmZmVyU291cmNlYCAobm90IGBhcyBCbG9iUGFydGApOiB0aGUgbmFtZSBgQnVmZmVyU291cmNlYCByZXNvbHZlcyBpblxuICAvLyBib3RoIERPTSBsaWIgYW5kIHdvcmtlcmQgcnVudGltZSB0eXBlcywgYW5kIGlzIGEgdmFsaWQgQmxvYlBhcnQgaW4gZWFjaC5cbiAgY29uc3Qgc3RyZWFtID0gbmV3IEJsb2IoW2RhdGEgYXMgQnVmZmVyU291cmNlXSlcbiAgICAuc3RyZWFtKClcbiAgICAucGlwZVRocm91Z2gobmV3IENvbXByZXNzaW9uU3RyZWFtKCdnemlwJykpO1xuICByZXR1cm4gbmV3IFVpbnQ4QXJyYXkoYXdhaXQgbmV3IFJlc3BvbnNlKHN0cmVhbSkuYXJyYXlCdWZmZXIoKSk7XG59XG5cbi8qKlxuICogR3VuemlwIGBkYXRhYCBwcm9kdWNlZCBieSBgY29tcHJlc3NgIChpbiBhIHJ1bnRpbWUgdGhhdCBoYWQgZ3ppcCBzdXBwb3J0KS5cbiAqIEZhbGxzIGJhY2sgdG8gaWRlbnRpdHkgd2hlbiBgRGVjb21wcmVzc2lvblN0cmVhbWAgaXMgdW5hdmFpbGFibGUuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBkZWNvbXByZXNzKGRhdGE6IFVpbnQ4QXJyYXkpOiBQcm9taXNlPFVpbnQ4QXJyYXk+IHtcbiAgaWYgKCFzdXBwb3J0c0NvbXByZXNzaW9uKCkpIHJldHVybiBkYXRhO1xuICBjb25zdCBzdHJlYW0gPSBuZXcgQmxvYihbZGF0YSBhcyBCdWZmZXJTb3VyY2VdKVxuICAgIC5zdHJlYW0oKVxuICAgIC5waXBlVGhyb3VnaChuZXcgRGVjb21wcmVzc2lvblN0cmVhbSgnZ3ppcCcpKTtcbiAgcmV0dXJuIG5ldyBVaW50OEFycmF5KGF3YWl0IG5ldyBSZXNwb25zZShzdHJlYW0pLmFycmF5QnVmZmVyKCkpO1xufVxuXG5mdW5jdGlvbiB0b0hleChieXRlczogVWludDhBcnJheSk6IHN0cmluZyB7XG4gIGxldCBvdXQgPSAnJztcbiAgZm9yIChjb25zdCBieXRlIG9mIGJ5dGVzKSB7XG4gICAgb3V0ICs9IGJ5dGUudG9TdHJpbmcoMTYpLnBhZFN0YXJ0KDIsICcwJyk7XG4gIH1cbiAgcmV0dXJuIG91dDtcbn1cbiIsICIvKipcbiAqIFR5cGVkIGVycm9yIGhpZXJhcmNoeSBzaGFyZWQgYnkgYWxsIGNsaWVudHMgKHBsdWdpbiwgZGFlbW9uLCBDTEkpIGFuZCB0aGVcbiAqIHRlc3Qtc3VpdGUgc2VydmVyLiBFcnJvcnMgY2FycnkgYSBzdGFibGUgbWFjaGluZS1yZWFkYWJsZSBgY29kZWAuXG4gKi9cblxuZXhwb3J0IHR5cGUgRXJyb3JDb2RlID1cbiAgfCAnVU5DTEFJTUVEJ1xuICB8ICdVTkFVVEhPUklaRUQnXG4gIHwgJ1JFVk9LRUQnXG4gIHwgJ0NPTkZMSUNUJ1xuICB8ICdQUk9UT0NPTCdcbiAgfCAnTkVUV09SSyc7XG5cbi8qKiBCYXNlIGNsYXNzIGZvciBhbGwgVmF1bHRTeW5jIGVycm9ycy4gKi9cbmV4cG9ydCBhYnN0cmFjdCBjbGFzcyBWYXVsdFN5bmNFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgYWJzdHJhY3QgcmVhZG9ubHkgY29kZTogRXJyb3JDb2RlO1xuXG4gIGNvbnN0cnVjdG9yKG1lc3NhZ2U6IHN0cmluZywgb3B0aW9ucz86IEVycm9yT3B0aW9ucykge1xuICAgIHN1cGVyKG1lc3NhZ2UsIG9wdGlvbnMpO1xuICAgIHRoaXMubmFtZSA9IG5ldy50YXJnZXQubmFtZTtcbiAgfVxufVxuXG4vKiogV29ya2VyIGV4aXN0cyBidXQgaGFzIG5vdCBiZWVuIGNsYWltZWQgeWV0IChIVFRQIDQyMSBvbiBldmVyeSBBUEkgY2FsbCkuICovXG5leHBvcnQgY2xhc3MgVW5jbGFpbWVkRXJyb3IgZXh0ZW5kcyBWYXVsdFN5bmNFcnJvciB7XG4gIHJlYWRvbmx5IGNvZGUgPSAnVU5DTEFJTUVEJyBhcyBjb25zdDtcbn1cblxuLyoqIFRva2VuIG1pc3NpbmcsIGludmFsaWQsIG9yIG5vdCBhY2NlcHRlZCAoSFRUUCA0MDEgY2xhc3MpLiAqL1xuZXhwb3J0IGNsYXNzIFVuYXV0aG9yaXplZEVycm9yIGV4dGVuZHMgVmF1bHRTeW5jRXJyb3Ige1xuICByZWFkb25seSBjb2RlID0gJ1VOQVVUSE9SSVpFRCcgYXMgY29uc3Q7XG59XG5cbi8qKiBUaGUgZGV2aWNlIHRva2VuIHdhcyByZXZva2VkOyB0aGUgZGV2aWNlIG11c3QgYmUgcmUtcGFpcmVkLiAqL1xuZXhwb3J0IGNsYXNzIFJldm9rZWRFcnJvciBleHRlbmRzIFZhdWx0U3luY0Vycm9yIHtcbiAgcmVhZG9ubHkgY29kZSA9ICdSRVZPS0VEJyBhcyBjb25zdDtcbn1cblxuLyoqIEEgY29tbWl0IHJhY2VkIHdpdGggYSBjb25jdXJyZW50IGVkaXQ7IHRoZSBzZXJ2ZXIgYXJiaXRyYXRlZCAoc2VlIFx1MDBBNzQpLiAqL1xuZXhwb3J0IGNsYXNzIENvbmZsaWN0RXJyb3IgZXh0ZW5kcyBWYXVsdFN5bmNFcnJvciB7XG4gIHJlYWRvbmx5IGNvZGUgPSAnQ09ORkxJQ1QnIGFzIGNvbnN0O1xufVxuXG4vKiogQSBwZWVyIChvciBsb2NhbCBidWcpIHZpb2xhdGVkIHRoZSBwcm90b2NvbDogYmFkIG1lc3NhZ2Ugc2hhcGUsIGJhZCB2ZXJzaW9uLiAqL1xuZXhwb3J0IGNsYXNzIFByb3RvY29sRXJyb3IgZXh0ZW5kcyBWYXVsdFN5bmNFcnJvciB7XG4gIHJlYWRvbmx5IGNvZGUgPSAnUFJPVE9DT0wnIGFzIGNvbnN0O1xufVxuXG4vKiogVHJhbnNwb3J0LWxldmVsIGZhaWx1cmU6IHNvY2tldCBjbG9zZWQsIGZldGNoIHJlZnVzZWQsIHRpbWVvdXQuIFJldHJpYWJsZS4gKi9cbmV4cG9ydCBjbGFzcyBOZXR3b3JrRXJyb3IgZXh0ZW5kcyBWYXVsdFN5bmNFcnJvciB7XG4gIHJlYWRvbmx5IGNvZGUgPSAnTkVUV09SSycgYXMgY29uc3Q7XG59XG4iLCAiLyoqXG4gKiBUaGUgY2xpZW50J3MgcGVyc2lzdGVkIHN5bmMgc3RhdGUgKEFSQ0hJVEVDVFVSRS5tZCBcdTAwQTc4IHN0ZXAgMSkuXG4gKlxuICogQSBgTG9jYWxJbmRleGAgbWFwcyBldmVyeSB2YXVsdCBwYXRoIHRoaXMgY2xpZW50IGhhcyBldmVyIHN5bmNlZCB0byB0aGVcbiAqIGxhc3QgdmVyc2lvbiBpdCAqa25vd3MqIHdhcyBhdXRob3JpdGF0aXZlOiBjb250ZW50IGhhc2gsIHNpemUsIHRoZVxuICogc2VydmVyLWFzc2lnbmVkIHZlcnNpb24gaWQsIGFuZCB0aGUgdmVyc2lvbidzIGxvZ2ljYWwgY2xvY2suIEVudHJpZXMgd2l0aFxuICogYGRlbGV0ZWRBdGAgc2V0IGFyZSB0b21ic3RvbmVzIFx1MjAxNCB0aGUgZmlsZSB3YXMgZGVsZXRlZCAobG9jYWxseSBvclxuICogcmVtb3RlbHkpIGJ1dCB0aGUgZW50cnkgc3RheXMgc28gdGhlIGRlbGV0aW9uIGlzIG5vdCByZXN1cnJlY3RlZCBieSB0aGVcbiAqIG5leHQgc2NhbiBhbmQgc28gcmVuYW1lIGNvcnJlbGF0aW9uIGtlZXBzIHdvcmtpbmcuXG4gKlxuICogVGhlIGluZGV4IGlzIHBlcnNpc3RlZCBpbnNpZGUgdGhlIHZhdWx0IGF0IGAvLnZhdWx0c3luY2ZvcmFnZW50cy9zdGF0ZWBcbiAqICh0aGF0IGRpcmVjdG9yeSBpcyBzeW5jLWlnbm9yZWQsIHNlZSBgaWdub3JlLnRzYCkgdGhyb3VnaCB0aGUgc3RvcmFnZVxuICogYWRhcHRlciwgd2hvc2UgYHdyaXRlRmlsZWAgaXMgYXRvbWljICh0ZW1wICsgcmVuYW1lKSBieSBjb250cmFjdC5cbiAqXG4gKiBBbGwgb3BlcmF0aW9ucyBhcmUgcHVyZTogdGhleSByZXR1cm4gbmV3IG9iamVjdHMgYW5kIG5ldmVyIG11dGF0ZSBpbnB1dHMuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBMb2dpY2FsQ2xvY2sgfSBmcm9tICcuL3R5cGVzLmpzJztcbmltcG9ydCB7IFByb3RvY29sRXJyb3IgfSBmcm9tICcuL2Vycm9ycy5qcyc7XG5cbi8qKlxuICogQ3VycmVudCBvbi1kaXNrIHNjaGVtYSB2ZXJzaW9uLiBCdW1wICsgYWRkIG1pZ3JhdGlvbiBvbiBicmVha2luZyBjaGFuZ2VzLlxuICpcbiAqIEhpc3Rvcnk6XG4gKiAgIC0gMSBcdTIwMTQgaW5pdGlhbCBzaGFwZSAoaGFzaC9zaXplL3ZlcnNpb25JZC9jbG9jay9kZWxldGVkQXQvaXNGb2xkZXIpLlxuICogICAtIDIgXHUyMDE0IGFkZHMgdGhlIG9wdGlvbmFsIGBtdGltZWAgY2FjaGUgZmllbGQgcGVyIGVudHJ5IChzY2FuIHByZS1maWx0ZXIsXG4gKiAgICAgICAgIHNlZSBgc2Nhbi50c2ApLiBHcmFjZWZ1bCBtaWdyYXRpb246IHYxIGVudHJpZXMgc2ltcGx5IGxhY2sgYG10aW1lYCxcbiAqICAgICAgICAgd2hpY2ggcmVhZHMgYmFjayBhcyBcInVua25vd25cIiBcdTIwMTQgdGhlIG5leHQgZmFzdCBzY2FuIHJlLWhhc2hlcyB0aGVcbiAqICAgICAgICAgZmlsZSBhbmQgcmVjb3JkcyBpdC4gT2xkIHYxIHN0YXRlIGZpbGVzIGxvYWQgd2l0aG91dCBlcnJvci5cbiAqXG4gKiBUaGUgdjIgRU5WRUxPUEUgYWxzbyBjYXJyaWVzIG9wdGlvbmFsIHN5bmMtY3Vyc29yIGJvb2trZWVwaW5nIChgY3Vyc29yYCxcbiAqIGBzeW5jZWRUaHJvdWdoYCwgYG5lZWRzRnVsbE1hbmlmZXN0YCBcdTIwMTQgc2VlIGBQZXJzaXN0ZWRTeW5jU3RhdGVgKTsgZmlsZXNcbiAqIHdyaXR0ZW4gYmVmb3JlIGl0IGV4aXN0ZWQgc2ltcGx5IGxhY2sgdGhvc2Uga2V5cywgd2hpY2ggcmVhZCBiYWNrIGFzXG4gKiBcIm5vIGN1cnNvciBrbm93bGVkZ2VcIiAoZnVsbCBtYW5pZmVzdCBvbiB0aGUgbmV4dCBjb25uZWN0KS4gTm8gdmVyc2lvblxuICogYnVtcDogYm90aCBkaXJlY3Rpb25zIHRvbGVyYXRlIHRoZSBtaXNzaW5nIGZpZWxkcy5cbiAqL1xuZXhwb3J0IGNvbnN0IExPQ0FMX0lOREVYX1NDSEVNQV9WRVJTSU9OID0gMjtcblxuLyoqIE9sZGVzdCBvbi1kaXNrIHNjaGVtYSB2ZXJzaW9uIHRoaXMgYnVpbGQgY2FuIHN0aWxsIHJlYWQuICovXG5leHBvcnQgY29uc3QgTUlOX0xPQ0FMX0lOREVYX1NDSEVNQV9WRVJTSU9OID0gMTtcblxuLyoqIFZhdWx0IHBhdGggd2hlcmUgdGhlIGNsaWVudCBwZXJzaXN0cyBpdHMgbG9jYWwgaW5kZXguICovXG5leHBvcnQgY29uc3QgTE9DQUxfSU5ERVhfU1RBVEVfUEFUSCA9ICcvLnZhdWx0c3luY2ZvcmFnZW50cy9zdGF0ZSc7XG5cbi8qKiBPbmUgcGF0aCdzIGxhc3Qta25vd24tc3luY2VkIHN0YXRlLiAqL1xuZXhwb3J0IGludGVyZmFjZSBMb2NhbEluZGV4RW50cnkge1xuICAvKiogc2hhMjU2IGhleCBvZiB0aGUgY29udGVudCBhdCBgdmVyc2lvbklkYC4gKi9cbiAgaGFzaDogc3RyaW5nO1xuICAvKiogQ29udGVudCBzaXplIGluIGJ5dGVzIChgMGAgZm9yIGZvbGRlciBwbGFjZWhvbGRlcnMpLiAqL1xuICBzaXplOiBudW1iZXI7XG4gIC8qKiBTZXJ2ZXItYXNzaWduZWQgdmVyc2lvbiBpZCB0aGlzIGVudHJ5IHJlZmxlY3RzLiAqL1xuICB2ZXJzaW9uSWQ6IHN0cmluZztcbiAgLyoqIExvZ2ljYWwgY2xvY2sgb2YgYHZlcnNpb25JZGAgXHUyMDE0IHVzZWQgdG8gcHJlZGljdCBjb25mbGljdCBvdXRjb21lcy4gKi9cbiAgY2xvY2s6IExvZ2ljYWxDbG9jaztcbiAgLyoqIFByZXNlbnQgXHUyMUQyIHRvbWJzdG9uZTogdGhlIHBhdGggd2FzIGRlbGV0ZWQgYXQgdGhpcyBlcG9jaCBtcy4gKi9cbiAgZGVsZXRlZEF0PzogbnVtYmVyO1xuICAvKipcbiAgICogVHJ1ZSBmb3IgZW1wdHktZm9sZGVyIHBsYWNlaG9sZGVyIGVudHJpZXMgKEZSLTEwKS4gRm9sZGVyIGVudHJpZXMgY2FycnlcbiAgICogYGhhc2g6ICcnYCwgYHNpemU6IDBgOyB0aGUgY2xvY2sgaXMgdGhhdCBvZiB0aGUgcGxhY2Vob2xkZXIncyB2ZXJzaW9uLlxuICAgKi9cbiAgaXNGb2xkZXI/OiBib29sZWFuO1xuICAvKipcbiAgICogU3RvcmFnZSBtdGltZSAoZXBvY2ggbXMpIG9ic2VydmVkIHRoZSBsYXN0IHRpbWUgdGhpcyBlbnRyeSdzIGZpbGUgd2FzXG4gICAqIGhhc2hlZCBieSBhIHNjYW4uIEEgcHVyZSBjYWNoZSBmb3IgdGhlIHNjYW4gcHJlLWZpbHRlciAoYHNjYW4udHNgKTpcbiAgICogbnVsbGlzaCAoYWJzZW50LCBlLmcuIGxlZ2FjeSB2MSBzdGF0ZSBvciBlbnRyaWVzIHdyaXR0ZW4gYnkgcHVsbHMpXG4gICAqIG1lYW5zIFwidW5rbm93blwiIFx1MjAxNCB0aGUgbmV4dCBmYXN0IHNjYW4gaGFzaGVzIHRoZSBmaWxlIGFuZCByZWNvcmRzIGl0IHZpYVxuICAgKiBgcmVjb3JkSGFzaGVkRmlsZXNgLiBOZXZlciBjb25zdWx0ZWQgZm9yIHN5bmMgZGVjaXNpb25zLlxuICAgKi9cbiAgbXRpbWU/OiBudW1iZXI7XG59XG5cbi8qKiBUaGUgd2hvbGUgaW5kZXg6IG5vcm1hbGl6ZWQgdmF1bHQgcGF0aCBcdTIxOTIgZW50cnkuIGB7fWAgaXMgYSB2YWxpZCBlbXB0eSBpbmRleC4gKi9cbmV4cG9ydCB0eXBlIExvY2FsSW5kZXggPSBSZWFkb25seTxSZWNvcmQ8c3RyaW5nLCBMb2NhbEluZGV4RW50cnk+PjtcblxuLyoqIFZlcnNpb25lZCBzZXJpYWxpemF0aW9uIGVudmVsb3BlIChzY2hlbWFWZXJzaW9uIGVuYWJsZXMgZnV0dXJlIG1pZ3JhdGlvbikuICovXG5leHBvcnQgaW50ZXJmYWNlIExvY2FsSW5kZXhFbnZlbG9wZSB7XG4gIHNjaGVtYVZlcnNpb246IG51bWJlcjtcbiAgZW50cmllczogUmVjb3JkPHN0cmluZywgTG9jYWxJbmRleEVudHJ5PjtcbiAgLyoqXG4gICAqIEVudmVsb3BlLWxldmVsIHN5bmMgYm9va2tlZXBpbmcgKG9wdGlvbmFsIHNvIHYyIGZpbGVzIHdyaXR0ZW4gYmVmb3JlIGl0XG4gICAqIGV4aXN0ZWQgc3RpbGwgbG9hZDsgdW5rbm93biBmaWVsZHMgYXJlIHRvbGVyYXRlZCBpbiBib3RoIGRpcmVjdGlvbnMpLlxuICAgKiBTZWUgYFBlcnNpc3RlZFN5bmNTdGF0ZWAuXG4gICAqL1xuICBjdXJzb3I/OiBudW1iZXI7XG4gIHN5bmNlZFRocm91Z2g/OiBudW1iZXIgfCBudWxsO1xuICBuZWVkc0Z1bGxNYW5pZmVzdD86IGJvb2xlYW47XG59XG5cbi8qKlxuICogU3luYy1jdXJzb3IgYm9va2tlZXBpbmcgcGVyc2lzdGVkIGF0b21pY2FsbHkgV0lUSCB0aGUgZW50cmllcyAob25lIGZpbGUsXG4gKiBvbmUgd3JpdGUpIHNvIHRoZSB0d28gY2FuIG5ldmVyIGRpc2FncmVlIGFmdGVyIGEgY3Jhc2guIFJlc3RvcmVkIG9uXG4gKiBzdGFydHVwIHRvIHBvd2VyIGRlbHRhLW1hbmlmZXN0IHJlY29ubmVjdHMuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUGVyc2lzdGVkU3luY1N0YXRlIHtcbiAgLyoqIExhc3Qgc2VlbiBzZXJ2ZXIgc2VxdWVuY2UgbnVtYmVyIChzZW50IGFzIGBoZWxsby5jdXJzb3JgKS4gKi9cbiAgY3Vyc29yPzogbnVtYmVyO1xuICAvKipcbiAgICogU2VxdWVuY2UgdGhyb3VnaCB3aGljaCB0aGUgaW5kZXggaXMga25vd24gQ09NUExFVEU6IHRoZSBtYW5pZmVzdCBjdXJzb3JcbiAgICogb2YgdGhlIGxhc3Qgc3luYyBjeWNsZSB0aGF0IGZpbmlzaGVkIHN1Y2Nlc3NmdWxseS4gRXZlcnkgaGVhZCBhdCBvclxuICAgKiBiZWxvdyBpdCBpcyByZWZsZWN0ZWQgaW4gdGhlIGVudHJpZXMgYWJvdmUsIHNvIGEgbGF0ZXIgcmVjb25uZWN0IG9ubHlcbiAgICogbmVlZHMgaGVhZHMgd2l0aCBgaGVhZF9zZXEgPiBzeW5jZWRUaHJvdWdoYCBcdTIwMTQgdGhlIGRlbHRhLW1hbmlmZXN0IHdpbmRvdy5cbiAgICogYG51bGxgL2Fic2VudCBcdTIxRDIgbm8gY29tcGxldGVkIGN5Y2xlIHlldCAob3IgYW4gaW50ZXJydXB0ZWQgb25lKTogdGhlIG5leHRcbiAgICogbWFuaWZlc3QgbXVzdCBiZSBGVUxMLiBEZWxpYmVyYXRlbHkgTk9UIGFkdmFuY2VkIHRvIGNvbW1pdC1hY2sgc2VxcyBzZWVuXG4gICAqIG1pZC1jeWNsZTogYSBjaGFuZ2UgYnJvYWRjYXN0IGZyb20gYW5vdGhlciBkZXZpY2UgY2FuIGludGVybGVhdmUgd2l0aFxuICAgKiBvdXIgYWNrcyBhbmQgbGFuZCBpbiB0aGUgcG9zdC1jeWNsZSBkaXNwYXRjaCBxdWV1ZSwgc28gb25seSB0aGVcbiAgICogZmV0Y2gtdGltZSBtYW5pZmVzdCBjdXJzb3IgaXMgYSBjb21wbGV0aW9uIGd1YXJhbnRlZS5cbiAgICovXG4gIHN5bmNlZFRocm91Z2g/OiBudW1iZXIgfCBudWxsO1xuICAvKipcbiAgICogQSByZW1vdGUgY2hhbmdlIHdhcyBkZWZlcnJlZCBvdmVyIGxvY2FsbHktZGl2ZXJnZWQgY29udGVudCAoYGhhbmRsZUNoYW5nZWBcbiAgICogZ3VhcmQpIGFuZCBoYXMgbm90IGJlZW4gdGhyb3VnaCBhIHBsYW4gY3ljbGUgeWV0LiBUaGUgbmV4dCBtYW5pZmVzdCBtdXN0XG4gICAqIGJlIEZVTEwgc28gYGNvbXB1dGVTeW5jUGxhbmAgc2VlcyB0aGUgcmVtb3RlIGhlYWQgYW5kIHJlc29sdmVzIHRoZVxuICAgKiBkaXZlcmdlbmNlIHRocm91Z2ggaXRzIGNvbmZsaWN0IGxvZ2ljIGluc3RlYWQgb2YgYSBzdGFsZS1wYXJlbnQgcHVzaC5cbiAgICovXG4gIG5lZWRzRnVsbE1hbmlmZXN0PzogYm9vbGVhbjtcbn1cblxuLyoqIE9uZSBhdXRob3JpdGF0aXZlIHN0YXRlIGNoYW5nZSB0byBmb2xkIGludG8gdGhlIGluZGV4LiAqL1xuZXhwb3J0IGludGVyZmFjZSBMb2NhbEluZGV4Q29tbWl0IHtcbiAgcGF0aDogc3RyaW5nO1xuICB2ZXJzaW9uSWQ6IHN0cmluZztcbiAgaGFzaDogc3RyaW5nO1xuICBzaXplOiBudW1iZXI7XG4gIGNsb2NrOiBMb2dpY2FsQ2xvY2s7XG4gIC8qKiBQcmVzZW50IFx1MjFEMiB0b21ic3RvbmU6IHRoZSBwYXRoIHdhcyBkZWxldGVkIGF0IHRoaXMgZXBvY2ggbXMuICovXG4gIGRlbGV0ZWQ/OiBib29sZWFuO1xuICAvKiogRXBvY2ggbXMgb2YgdGhlIGRlbGV0aW9uIFx1MjAxNCByZXF1aXJlZCB3aGVuIGBkZWxldGVkYCBpcyB0cnVlLiAqL1xuICBkZWxldGVkQXQ/OiBudW1iZXI7XG4gIC8qKiBUcnVlIHdoZW4gdGhpcyBjb21taXQgcmVjb3JkcyBhbiBlbXB0eS1mb2xkZXIgcGxhY2Vob2xkZXIgKEZSLTEwKS4gKi9cbiAgaXNGb2xkZXI/OiBib29sZWFuO1xuICAvKipcbiAgICogU3RvcmFnZSBtdGltZSBvYnNlcnZlZCBhdCBIQVNIIHRpbWUgZm9yIHRoaXMgZXhhY3QgY29udGVudCBcdTIwMTQgcGlubmVkIG9udG9cbiAgICogdGhlIGVudHJ5IHdoZW4gdGhlIGNvbW1pdCBpcyBmb2xkZWQgKGkuZS4gYXQgY29tbWl0LWFjayB0aW1lKS4gVGhyZWFkaW5nXG4gICAqIHRoZSBzdGF0IHRoYXQgY28tb2NjdXJyZWQgd2l0aCB0aGUgaGFzaGVkIGJ5dGVzIChyYXRoZXIgdGhhbiBhbnlcbiAgICogbGF0ZXIvY3VycmVudCBzdGF0KSBndWFyYW50ZWVzIHRoZSBmYXN0LXBhdGggY2FjaGUgY2FuIG5ldmVyIHBhaXIgYVxuICAgKiBmcmVzaGVyIHN0YXQgd2l0aCB0aGlzIGhhc2gsIHdoaWNoIHdvdWxkIGhpZGUgYW4gZWRpdCBmcm9tIGV2ZXJ5IGZ1dHVyZVxuICAgKiBzY2FuICh0aGUgc2lsZW50IGRyb3BwZWQtZWRpdCBjbGFzcykuIEFic2VudCBcdTIxRDIgdW5rbm93bjsgdGhlIG5leHQgc2NhblxuICAgKiByZS1oYXNoZXMgYW5kIHJlY29yZHMgdmlhIGByZWNvcmRIYXNoZWRGaWxlc2AuXG4gICAqL1xuICBtdGltZT86IG51bWJlcjtcbn1cblxuLyoqXG4gKiBGb2xkIG9uZSBjb21taXQgaW50byB0aGUgaW5kZXguIFB1cmU6IHJldHVybnMgYSBuZXcgaW5kZXgsIGlucHV0IHVudG91Y2hlZC5cbiAqXG4gKiBBcHBseWluZyBhIGNvbW1pdCBmb3IgYSBwYXRoIHJlcGxhY2VzIHRoYXQgcGF0aCdzIGVudHJ5IHdob2xlc2FsZSAoYSBjb21taXRcbiAqICppcyogdGhlIG5ldyB0cnV0aCBmb3IgdGhlIHBhdGgpOyBgYXBwbHlDb21taXRgIG5ldmVyIG1lcmdlcyBmaWVsZHMuXG4gKiBUb21ic3RvbmluZyAoYGRlbGV0ZWQ6IHRydWVgKSByZXF1aXJlcyBgZGVsZXRlZEF0YCBhbmQga2VlcHMgdGhlIGVudHJ5LlxuICpcbiAqIFRvIGRyb3AgYW4gZW50cnkgZW50aXJlbHkgKHRoZSBwYXRoIG1pZ3JhdGVkIGF3YXksIGUuZy4gYSBzeW5jZWQgcmVuYW1lKVxuICogdXNlIGByZW1vdmVFbnRyeWAgaW5zdGVhZC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGFwcGx5Q29tbWl0KGluZGV4OiBMb2NhbEluZGV4LCBjb21taXQ6IExvY2FsSW5kZXhDb21taXQpOiBMb2NhbEluZGV4IHtcbiAgaWYgKGNvbW1pdC5kZWxldGVkICYmIGNvbW1pdC5kZWxldGVkQXQgPT09IHVuZGVmaW5lZCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIGBhcHBseUNvbW1pdDogdG9tYnN0b25lIGZvciAke0pTT04uc3RyaW5naWZ5KGNvbW1pdC5wYXRoKX0gcmVxdWlyZXMgZGVsZXRlZEF0YCxcbiAgICApO1xuICB9XG4gIGNvbnN0IG5leHQ6IFJlY29yZDxzdHJpbmcsIExvY2FsSW5kZXhFbnRyeT4gPSB7IC4uLmluZGV4IH07XG4gIGNvbnN0IGVudHJ5OiBMb2NhbEluZGV4RW50cnkgPSB7XG4gICAgaGFzaDogY29tbWl0Lmhhc2gsXG4gICAgc2l6ZTogY29tbWl0LnNpemUsXG4gICAgdmVyc2lvbklkOiBjb21taXQudmVyc2lvbklkLFxuICAgIGNsb2NrOiBjb21taXQuY2xvY2ssXG4gIH07XG4gIGlmIChjb21taXQuZGVsZXRlZCkgZW50cnkuZGVsZXRlZEF0ID0gY29tbWl0LmRlbGV0ZWRBdDtcbiAgaWYgKGNvbW1pdC5pc0ZvbGRlcikgZW50cnkuaXNGb2xkZXIgPSB0cnVlO1xuICBpZiAoY29tbWl0Lm10aW1lICE9PSB1bmRlZmluZWQpIGVudHJ5Lm10aW1lID0gY29tbWl0Lm10aW1lO1xuICBuZXh0W2NvbW1pdC5wYXRoXSA9IGVudHJ5O1xuICByZXR1cm4gbmV4dDtcbn1cblxuLyoqXG4gKiBSZW1vdmUgYSBwYXRoJ3MgZW50cnkgZW50aXJlbHkgKG5vIHRvbWJzdG9uZSkuIFVzZWQgd2hlbiB0aGUgYXV0aG9yaXR5XG4gKiBtaWdyYXRlcyBhIHBhdGgncyB2ZXJzaW9uIGNoYWluIGVsc2V3aGVyZSBcdTIwMTQgaS5lLiBhIHN5bmNlZCByZW5hbWU6IHRoZSBvbGRcbiAqIHBhdGggbXVzdCB2YW5pc2ggZnJvbSB0aGUgaW5kZXggZXhhY3RseSBhcyBpdCB2YW5pc2hlZCBmcm9tIHRoZSBtYW5pZmVzdC5cbiAqIFB1cmU7IHJlbW92aW5nIGFuIGFic2VudCBwYXRoIGlzIGEgbm8tb3AuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZW1vdmVFbnRyeShpbmRleDogTG9jYWxJbmRleCwgcGF0aDogc3RyaW5nKTogTG9jYWxJbmRleCB7XG4gIGlmICghKHBhdGggaW4gaW5kZXgpKSByZXR1cm4gaW5kZXg7XG4gIGNvbnN0IG5leHQ6IFJlY29yZDxzdHJpbmcsIExvY2FsSW5kZXhFbnRyeT4gPSB7IC4uLmluZGV4IH07XG4gIGRlbGV0ZSBuZXh0W3BhdGhdO1xuICByZXR1cm4gbmV4dDtcbn1cblxuLyoqXG4gKiBTZXJpYWxpemUgdG8gYSBkZXRlcm1pbmlzdGljIEpTT04gc3RyaW5nOiB2ZXJzaW9uZWQgZW52ZWxvcGUsIGVudHJpZXNcbiAqIHNvcnRlZCBieSBwYXRoIChzbyBpZGVudGljYWwgaW5kZXhlcyBzZXJpYWxpemUgYnl0ZS1pZGVudGljYWxseSBhbmQgZGlmZlxuICogY2xlYW5seSBpbiBzdGF0ZS1kaXIgbGlzdGluZ3MpLiBgc3RhdGVgIChvcHRpb25hbCkgY2FycmllcyB0aGUgc3luYy1jdXJzb3JcbiAqIGJvb2trZWVwaW5nIHBlcnNpc3RlZCBhbG9uZ3NpZGUgdGhlIGVudHJpZXMgXHUyMDE0IHNlZSBgUGVyc2lzdGVkU3luY1N0YXRlYC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNlcmlhbGl6ZUxvY2FsSW5kZXgoaW5kZXg6IExvY2FsSW5kZXgsIHN0YXRlOiBQZXJzaXN0ZWRTeW5jU3RhdGUgPSB7fSk6IHN0cmluZyB7XG4gIGNvbnN0IGVudHJpZXM6IFJlY29yZDxzdHJpbmcsIExvY2FsSW5kZXhFbnRyeT4gPSB7fTtcbiAgZm9yIChjb25zdCBwYXRoIG9mIE9iamVjdC5rZXlzKGluZGV4KS5zb3J0KCkpIHtcbiAgICBlbnRyaWVzW3BhdGhdID0gaW5kZXhbcGF0aF0gYXMgTG9jYWxJbmRleEVudHJ5O1xuICB9XG4gIGNvbnN0IGVudmVsb3BlOiBMb2NhbEluZGV4RW52ZWxvcGUgPSB7XG4gICAgc2NoZW1hVmVyc2lvbjogTE9DQUxfSU5ERVhfU0NIRU1BX1ZFUlNJT04sXG4gICAgZW50cmllcyxcbiAgICAuLi4oc3RhdGUuY3Vyc29yICE9PSB1bmRlZmluZWQgPyB7IGN1cnNvcjogc3RhdGUuY3Vyc29yIH0gOiB7fSksXG4gICAgLi4uKHN0YXRlLnN5bmNlZFRocm91Z2ggIT09IHVuZGVmaW5lZCA/IHsgc3luY2VkVGhyb3VnaDogc3RhdGUuc3luY2VkVGhyb3VnaCB9IDoge30pLFxuICAgIC4uLihzdGF0ZS5uZWVkc0Z1bGxNYW5pZmVzdCAhPT0gdW5kZWZpbmVkXG4gICAgICA/IHsgbmVlZHNGdWxsTWFuaWZlc3Q6IHN0YXRlLm5lZWRzRnVsbE1hbmlmZXN0IH1cbiAgICAgIDoge30pLFxuICB9O1xuICByZXR1cm4gSlNPTi5zdHJpbmdpZnkoZW52ZWxvcGUpO1xufVxuXG4vKiogVGhlIGVudHJpZXMgcGx1cyB0aGUgc3luYy1jdXJzb3IgYm9va2tlZXBpbmcgb2YgYSBwZXJzaXN0ZWQgc3RhdGUgZmlsZS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRGVzZXJpYWxpemVkTG9jYWxTdGF0ZSB7XG4gIGluZGV4OiBMb2NhbEluZGV4O1xuICAvKiogRW52ZWxvcGUgYm9va2tlZXBpbmc7IGRlZmF1bHRzIGZvciBmaWxlcyB3cml0dGVuIGJlZm9yZSBpdCBleGlzdGVkLiAqL1xuICBzdGF0ZTogUmVxdWlyZWQ8UGVyc2lzdGVkU3luY1N0YXRlPjtcbn1cblxuLyoqXG4gKiBQYXJzZSBhIHNlcmlhbGl6ZWQgc3RhdGUgZmlsZSBJTkNMVURJTkcgaXRzIGVudmVsb3BlIGJvb2trZWVwaW5nICh0aGVcbiAqIGNsaWVudCdzIHN0YXJ0dXAgcGF0aCkuIEVudHJ5IHZhbGlkYXRpb24gaXMgaWRlbnRpY2FsIHRvXG4gKiBgZGVzZXJpYWxpemVMb2NhbEluZGV4YDsgdGhlIGV4dHJhIGZpZWxkcyBkZWZhdWx0IHRvIFwibm8gY3Vyc29yIGtub3dsZWRnZVwiXG4gKiAoYGN1cnNvcjogMGAsIGBzeW5jZWRUaHJvdWdoOiBudWxsYCwgYG5lZWRzRnVsbE1hbmlmZXN0OiBmYWxzZWApIHNvIHYyXG4gKiBmaWxlcyB3cml0dGVuIGJ5IG9sZGVyIGJ1aWxkcyBsb2FkIHVuY2hhbmdlZCBhbmQgc2ltcGx5IHJlY29ubmVjdCB3aXRoIGFcbiAqIGZ1bGwgbWFuaWZlc3QuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkZXNlcmlhbGl6ZUxvY2FsU3RhdGUoanNvbjogc3RyaW5nKTogRGVzZXJpYWxpemVkTG9jYWxTdGF0ZSB7XG4gIGxldCBwYXJzZWQ6IHVua25vd247XG4gIHRyeSB7XG4gICAgcGFyc2VkID0gSlNPTi5wYXJzZShqc29uKTtcbiAgfSBjYXRjaCAoY2F1c2UpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcignTG9jYWwgaW5kZXggc3RhdGUgaXMgbm90IHZhbGlkIEpTT04nLCB7IGNhdXNlIH0pO1xuICB9XG4gIGlmICghaXNQbGFpbk9iamVjdChwYXJzZWQpKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoJ0xvY2FsIGluZGV4IHN0YXRlIGlzIG5vdCBhbiBvYmplY3QnKTtcbiAgfVxuICAvLyBFbnRyeS1sZXZlbCB2YWxpZGF0aW9uIGlzIGV4YWN0bHkgYGRlc2VyaWFsaXplTG9jYWxJbmRleGAnczsgdGhlIGNhbGxcbiAgLy8gYWxzbyBlbmZvcmNlcyB0aGUgc2NoZW1hLXZlcnNpb24gd2luZG93LlxuICBjb25zdCBpbmRleCA9IGRlc2VyaWFsaXplTG9jYWxJbmRleChqc29uKTtcbiAgY29uc3QgcmF3Q3Vyc29yID0gKHBhcnNlZCBhcyB7IGN1cnNvcj86IHVua25vd24gfSkuY3Vyc29yO1xuICBjb25zdCByYXdTeW5jZWRUaHJvdWdoID0gKHBhcnNlZCBhcyB7IHN5bmNlZFRocm91Z2g/OiB1bmtub3duIH0pLnN5bmNlZFRocm91Z2g7XG4gIGNvbnN0IHJhd05lZWRzRnVsbCA9IChwYXJzZWQgYXMgeyBuZWVkc0Z1bGxNYW5pZmVzdD86IHVua25vd24gfSkubmVlZHNGdWxsTWFuaWZlc3Q7XG4gIGlmIChyYXdDdXJzb3IgIT09IHVuZGVmaW5lZCAmJiAodHlwZW9mIHJhd0N1cnNvciAhPT0gJ251bWJlcicgfHwgIU51bWJlci5pc0ludGVnZXIocmF3Q3Vyc29yKSB8fCByYXdDdXJzb3IgPCAwKSkge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKCdMb2NhbCBpbmRleCBzdGF0ZTogY3Vyc29yIG11c3QgYmUgYSBub24tbmVnYXRpdmUgaW50ZWdlcicpO1xuICB9XG4gIGlmIChcbiAgICByYXdTeW5jZWRUaHJvdWdoICE9PSB1bmRlZmluZWQgJiZcbiAgICByYXdTeW5jZWRUaHJvdWdoICE9PSBudWxsICYmXG4gICAgKHR5cGVvZiByYXdTeW5jZWRUaHJvdWdoICE9PSAnbnVtYmVyJyB8fCAhTnVtYmVyLmlzSW50ZWdlcihyYXdTeW5jZWRUaHJvdWdoKSB8fCByYXdTeW5jZWRUaHJvdWdoIDwgMClcbiAgKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoJ0xvY2FsIGluZGV4IHN0YXRlOiBzeW5jZWRUaHJvdWdoIG11c3QgYmUgYSBub24tbmVnYXRpdmUgaW50ZWdlciBvciBudWxsJyk7XG4gIH1cbiAgaWYgKHJhd05lZWRzRnVsbCAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiByYXdOZWVkc0Z1bGwgIT09ICdib29sZWFuJykge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKCdMb2NhbCBpbmRleCBzdGF0ZTogbmVlZHNGdWxsTWFuaWZlc3QgbXVzdCBiZSBhIGJvb2xlYW4gd2hlbiBwcmVzZW50Jyk7XG4gIH1cbiAgcmV0dXJuIHtcbiAgICBpbmRleCxcbiAgICBzdGF0ZToge1xuICAgICAgY3Vyc29yOiB0eXBlb2YgcmF3Q3Vyc29yID09PSAnbnVtYmVyJyA/IHJhd0N1cnNvciA6IDAsXG4gICAgICBzeW5jZWRUaHJvdWdoOiB0eXBlb2YgcmF3U3luY2VkVGhyb3VnaCA9PT0gJ251bWJlcicgPyByYXdTeW5jZWRUaHJvdWdoIDogbnVsbCxcbiAgICAgIG5lZWRzRnVsbE1hbmlmZXN0OiByYXdOZWVkc0Z1bGwgPT09IHRydWUsXG4gICAgfSxcbiAgfTtcbn1cblxuLyoqXG4gKiBQYXJzZSBhIHNlcmlhbGl6ZWQgaW5kZXggYmFjay4gVGhyb3dzIGBQcm90b2NvbEVycm9yYCBvbiBub24tSlNPTiBpbnB1dCxcbiAqIGEgbWFsZm9ybWVkIGVudmVsb3BlLCBlbnRyaWVzIHdpdGggd3JvbmcgZmllbGQgdHlwZXMsIG9yIGEgYHNjaGVtYVZlcnNpb25gXG4gKiBvdXRzaWRlIHRoZSBzdXBwb3J0ZWQgcmFuZ2UgKG9sZGVyIHRoYW4gYE1JTl9MT0NBTF9JTkRFWF9TQ0hFTUFfVkVSU0lPTmBcbiAqIG9yIG5ld2VyIHRoYW4gYExPQ0FMX0lOREVYX1NDSEVNQV9WRVJTSU9OYCkgXHUyMDE0IG9sZGVyIHZlcnNpb25zICp3aXRoaW4qIHRoZVxuICogcmFuZ2UgbG9hZCB3aXRob3V0IGVycm9yICh2MSBlbnRyaWVzIHNpbXBseSBkZXNlcmlhbGl6ZSB3aXRoIGBtdGltZWBcbiAqIHVua25vd24pLiBVbmtub3duIGV4dHJhIGZpZWxkcyBhcmUgdG9sZXJhdGVkIGZvciBmb3J3YXJkIGNvbXBhdGliaWxpdHkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkZXNlcmlhbGl6ZUxvY2FsSW5kZXgoanNvbjogc3RyaW5nKTogTG9jYWxJbmRleCB7XG4gIGxldCBwYXJzZWQ6IHVua25vd247XG4gIHRyeSB7XG4gICAgcGFyc2VkID0gSlNPTi5wYXJzZShqc29uKTtcbiAgfSBjYXRjaCAoY2F1c2UpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcignTG9jYWwgaW5kZXggc3RhdGUgaXMgbm90IHZhbGlkIEpTT04nLCB7IGNhdXNlIH0pO1xuICB9XG4gIGlmICghaXNQbGFpbk9iamVjdChwYXJzZWQpKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoJ0xvY2FsIGluZGV4IHN0YXRlIGlzIG5vdCBhbiBvYmplY3QnKTtcbiAgfVxuICBjb25zdCB2ZXJzaW9uID0gcGFyc2VkLnNjaGVtYVZlcnNpb247XG4gIGlmICh0eXBlb2YgdmVyc2lvbiAhPT0gJ251bWJlcicgfHwgIU51bWJlci5pc0ludGVnZXIodmVyc2lvbikpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcignTG9jYWwgaW5kZXggc3RhdGUgaXMgbWlzc2luZyBpbnRlZ2VyIHNjaGVtYVZlcnNpb24nKTtcbiAgfVxuICBpZiAodmVyc2lvbiA8IE1JTl9MT0NBTF9JTkRFWF9TQ0hFTUFfVkVSU0lPTiB8fCB2ZXJzaW9uID4gTE9DQUxfSU5ERVhfU0NIRU1BX1ZFUlNJT04pIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihcbiAgICAgIGBMb2NhbCBpbmRleCBzY2hlbWEgdmVyc2lvbiAke3ZlcnNpb259IGlzIG5vdCBzdXBwb3J0ZWQgYnkgdGhpcyBidWlsZCBgICtcbiAgICAgICAgYChleHBlY3RlZCAke01JTl9MT0NBTF9JTkRFWF9TQ0hFTUFfVkVSU0lPTn0uLiR7TE9DQUxfSU5ERVhfU0NIRU1BX1ZFUlNJT059KTsgYCArXG4gICAgICAgICdhIG1pZ3JhdGlvbiBpcyByZXF1aXJlZCcsXG4gICAgKTtcbiAgfVxuICBjb25zdCByYXdFbnRyaWVzID0gcGFyc2VkLmVudHJpZXM7XG4gIGlmICghaXNQbGFpbk9iamVjdChyYXdFbnRyaWVzKSkge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKCdMb2NhbCBpbmRleCBzdGF0ZSBpcyBtaXNzaW5nIHRoZSBlbnRyaWVzIG9iamVjdCcpO1xuICB9XG5cbiAgY29uc3QgZW50cmllczogUmVjb3JkPHN0cmluZywgTG9jYWxJbmRleEVudHJ5PiA9IHt9O1xuICBmb3IgKGNvbnN0IFtwYXRoLCByYXddIG9mIE9iamVjdC5lbnRyaWVzKHJhd0VudHJpZXMpKSB7XG4gICAgZW50cmllc1twYXRoXSA9IHBhcnNlRW50cnkocGF0aCwgcmF3KTtcbiAgfVxuICByZXR1cm4gZW50cmllcztcbn1cblxuZnVuY3Rpb24gcGFyc2VFbnRyeShwYXRoOiBzdHJpbmcsIHJhdzogdW5rbm93bik6IExvY2FsSW5kZXhFbnRyeSB7XG4gIGNvbnN0IHdoZXJlID0gYExvY2FsIGluZGV4IGVudHJ5ICR7SlNPTi5zdHJpbmdpZnkocGF0aCl9YDtcbiAgaWYgKCFpc1BsYWluT2JqZWN0KHJhdykpIHRocm93IG5ldyBQcm90b2NvbEVycm9yKGAke3doZXJlfSBpcyBub3QgYW4gb2JqZWN0YCk7XG4gIGNvbnN0IHsgaGFzaCwgc2l6ZSwgdmVyc2lvbklkLCBjbG9jaywgZGVsZXRlZEF0LCBpc0ZvbGRlciwgbXRpbWUgfSA9IHJhdyBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcbiAgaWYgKHR5cGVvZiBoYXNoICE9PSAnc3RyaW5nJykgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoYCR7d2hlcmV9OiBoYXNoIG11c3QgYmUgYSBzdHJpbmdgKTtcbiAgaWYgKHR5cGVvZiB2ZXJzaW9uSWQgIT09ICdzdHJpbmcnKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoYCR7d2hlcmV9OiB2ZXJzaW9uSWQgbXVzdCBiZSBhIHN0cmluZ2ApO1xuICB9XG4gIGlmICh0eXBlb2Ygc2l6ZSAhPT0gJ251bWJlcicgfHwgIU51bWJlci5pc0ludGVnZXIoc2l6ZSkgfHwgc2l6ZSA8IDApIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgJHt3aGVyZX06IHNpemUgbXVzdCBiZSBhIG5vbi1uZWdhdGl2ZSBpbnRlZ2VyYCk7XG4gIH1cbiAgaWYgKCFpc1BsYWluT2JqZWN0KGNsb2NrKSB8fCB0eXBlb2YgY2xvY2suY291bnRlciAhPT0gJ251bWJlcicgfHwgdHlwZW9mIGNsb2NrLmRldmljZUlkICE9PSAnc3RyaW5nJykge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKGAke3doZXJlfTogY2xvY2sgbXVzdCBiZSB7IGNvdW50ZXI6IG51bWJlciwgZGV2aWNlSWQ6IHN0cmluZyB9YCk7XG4gIH1cbiAgaWYgKGRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBkZWxldGVkQXQgIT09ICdudW1iZXInKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoYCR7d2hlcmV9OiBkZWxldGVkQXQgbXVzdCBiZSBhIG51bWJlciB3aGVuIHByZXNlbnRgKTtcbiAgfVxuICBpZiAoaXNGb2xkZXIgIT09IHVuZGVmaW5lZCAmJiB0eXBlb2YgaXNGb2xkZXIgIT09ICdib29sZWFuJykge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKGAke3doZXJlfTogaXNGb2xkZXIgbXVzdCBiZSBhIGJvb2xlYW4gd2hlbiBwcmVzZW50YCk7XG4gIH1cbiAgaWYgKG10aW1lICE9PSB1bmRlZmluZWQgJiYgKHR5cGVvZiBtdGltZSAhPT0gJ251bWJlcicgfHwgIU51bWJlci5pc0Zpbml0ZShtdGltZSkpKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoYCR7d2hlcmV9OiBtdGltZSBtdXN0IGJlIGEgZmluaXRlIG51bWJlciB3aGVuIHByZXNlbnRgKTtcbiAgfVxuICBjb25zdCBlbnRyeTogTG9jYWxJbmRleEVudHJ5ID0ge1xuICAgIGhhc2gsXG4gICAgc2l6ZSxcbiAgICB2ZXJzaW9uSWQsXG4gICAgY2xvY2s6IHsgY291bnRlcjogY2xvY2suY291bnRlciBhcyBudW1iZXIsIGRldmljZUlkOiBjbG9jay5kZXZpY2VJZCBhcyBzdHJpbmcgfSxcbiAgfTtcbiAgaWYgKGRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkKSBlbnRyeS5kZWxldGVkQXQgPSBkZWxldGVkQXQgYXMgbnVtYmVyO1xuICBpZiAoaXNGb2xkZXIgIT09IHVuZGVmaW5lZCkgZW50cnkuaXNGb2xkZXIgPSBpc0ZvbGRlciBhcyBib29sZWFuO1xuICBpZiAobXRpbWUgIT09IHVuZGVmaW5lZCkgZW50cnkubXRpbWUgPSBtdGltZSBhcyBudW1iZXI7XG4gIHJldHVybiBlbnRyeTtcbn1cblxuZnVuY3Rpb24gaXNQbGFpbk9iamVjdCh2YWx1ZTogdW5rbm93bik6IHZhbHVlIGlzIFJlY29yZDxzdHJpbmcsIHVua25vd24+IHtcbiAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiYgdmFsdWUgIT09IG51bGwgJiYgIUFycmF5LmlzQXJyYXkodmFsdWUpO1xufVxuIiwgIi8qKlxuICogVGhpbiBwdWxsLXNpZGUgb3JjaGVzdHJhdGlvbiAoQVJDSElURUNUVVJFLm1kIFx1MDBBNzggc3RlcCA1KS4gTk9UIHRoZSBuZXR3b3JrXG4gKiBjbGllbnQ6IGFsbCB0cmFuc3BvcnQgaXMgaW5qZWN0ZWQgKGBmZXRjaEJsb2JgKSwgd2hpY2ggdGhlIGxhdGVyIG5ldHdvcmtcbiAqIHBoYXNlIGltcGxlbWVudHMgb3ZlciBgL2Jsb2IvOmhhc2hgIG9yIFdTLWlubGluZSBjb250ZW50LlxuICpcbiAqIGBhcHBseVB1bGxgIG1hdGVyaWFsaXplcyBldmVyeSBgUHVsbE9wYCBvZiBhIGBTeW5jUGxhbmAgdGhyb3VnaCB0aGVcbiAqIHN0b3JhZ2UgYWRhcHRlciBhbmQgdXBkYXRlcyB0aGUgbG9jYWwgaW5kZXggXHUyMDE0IGR1cmFibHkgYW5kIGhvbmVzdGx5OlxuICpcbiAqICAgLSBibG9icyBhcmUgdmVyaWZpZWQgKHNoYTI1NikgYmVmb3JlIGJlaW5nIHdyaXR0ZW47IGEgbWlzbWF0Y2ggYWJvcnRzXG4gKiAgICAgdGhlIHBsYW47XG4gKiAgIC0gZWFjaCBpbmRleCBlbnRyeSBpcyByZWNvcmRlZCBvbmx5ICphZnRlciogaXRzIHN0b3JhZ2Ugd3JpdGUgc3VjY2VlZGVkLFxuICogICAgIHNvIGEgbWlkLXBsYW4gZmFpbHVyZSBsZWF2ZXMgdGhlIGluZGV4IGRlc2NyaWJpbmcgZXhhY3RseSB0aGUgZmlsZXNcbiAqICAgICB0aGF0IGFjdHVhbGx5IGxhbmRlZCAoRlItNTogbm90aGluZyBpcyBzaWxlbnRseSBsb3N0IFx1MjAxNCB0aGUgdW5zeW5jZWRcbiAqICAgICBwdWxscyBzaW1wbHkgcmVtYWluIGluIHRoZSBwbGFuIGFuZCBhcmUgcmV0cmllZCBieSB0aGUgY2FsbGVyKTtcbiAqICAgLSB0aGUgaW5kZXggaXMgcGVyc2lzdGVkIHRocm91Z2ggdGhlIGFkYXB0ZXIncyBhdG9taWMgYHdyaXRlRmlsZWBcbiAqICAgICAodGVtcCArIHJlbmFtZSBwZXIgdGhlIGFkYXB0ZXIgY29udHJhY3QpIGF0XG4gKiAgICAgYC8udmF1bHRzeW5jZm9yYWdlbnRzL3N0YXRlYCwgaW5jbHVkaW5nIG9uIHRoZSBmYWlsdXJlIHBhdGguXG4gKlxuICogRm9sZGVyIGxpZmVjeWNsZSAoRlItMTAgYW5kIGl0cyBkZWxldGlvbiBjb3VudGVycGFydCk6XG4gKlxuICogICAtIGFwcGx5aW5nIGEgUkVNT1RFIEZPTERFUiBUT01CU1RPTkUgcmVtb3ZlcyB0aGUgbG9jYWwgZGlyZWN0b3J5IHdoZW5cbiAqICAgICBpdCBleGlzdHMgYW5kIGlzIGVtcHR5IChhZGFwdGVyIGByZW1vdmVEaXJgKTsgbm9uLWVtcHR5IG9yIG1pc3NpbmcgXHUyMUQyXG4gKiAgICAgcmVjb3JkIHRoZSB0b21ic3RvbmUgb25seSBcdTIwMTQgdGhlIGRpcmVjdG9yeSBjb252ZXJnZXMgbGF0ZXIsIGFuZCBhXG4gKiAgICAgbm9uLWVtcHR5IGRpcmVjdG9yeSBpcyBuZXZlciBkZWxldGVkO1xuICogICAtIFBSVU5FLU9OLURFTEVURTogYXBwbHlpbmcgYSByZW1vdGUgZmlsZSBkZWxldGlvbiAob3IgcmVuYW1lIGF3YXkpXG4gKiAgICAgcmVtb3ZlcyB0aGUgZGVsZXRlZCBwYXRoJ3MgcGFyZW50IGRpcmVjdG9yeSB3aGVuIGl0IGlzIG5vdyBlbXB0eSBvblxuICogICAgIGRpc2sgYW5kIGhvbGRzIG5vIGxpdmUgZmlsZSBlbnRyaWVzIGluIHRoZSBpbmRleCBcdTIwMTQgdGhpcyBpcyB3aGF0IHN0b3BzXG4gKiAgICAgYW4gZW1wdGllZCBkaXJlY3RvcnkgZnJvbSBzZWxmLXJlc3VycmVjdGluZyBhcyBhbiBlbXB0eS1mb2xkZXJcbiAqICAgICBwbGFjZWhvbGRlciBvbiB0aGUgbmV4dCBzY2FuLiBFeGFjdGx5IE9ORSBsZXZlbCBwZXIgZGVsZXRpb246IHRoZVxuICogICAgIGltbWVkaWF0ZSBwYXJlbnQgb25seSwgbmV2ZXIgYSBjYXNjYWRlIChhIGNoYWluIG9mIGVtcHRpZWRcbiAqICAgICBkaXJlY3RvcmllcyBjb252ZXJnZXMgb3ZlciBzdWNjZXNzaXZlIGN5Y2xlczsgdGhlIHNhZmV0eSBpbnZhcmlhbnQgXHUyMDE0XG4gKiAgICAgbmV2ZXIgZGVsZXRlIGEgbm9uLWVtcHR5IGRpcmVjdG9yeSwgbmV2ZXIgbG9zZSB1c2VyIGNvbnRlbnQgXHUyMDE0IGlzXG4gKiAgICAgY2hlY2tlZCBiZWZvcmUgZXZlcnkgcmVtb3ZhbCkuXG4gKlxuICogUHVzaGVzL2NvbmZsaWN0cy9mb2xkZXIgb3BzIGFyZSB0aGUgbmV0d29yayBwaGFzZSdzIGJ1c2luZXNzOyByZXRyeVxuICogcXVldWVzIGFyZSBleHBsaWNpdGx5IG91dCBvZiBzY29wZSBoZXJlLlxuICovXG5cbmltcG9ydCB0eXBlIHsgU3RvcmFnZUFkYXB0ZXIgfSBmcm9tICcuL2FkYXB0ZXJzLmpzJztcbmltcG9ydCB7IHNoYTI1NkhleCB9IGZyb20gJy4vaGFzaGluZy5qcyc7XG5pbXBvcnQge1xuICBhcHBseUNvbW1pdCxcbiAgZGVzZXJpYWxpemVMb2NhbFN0YXRlLFxuICBMT0NBTF9JTkRFWF9TVEFURV9QQVRILFxuICByZW1vdmVFbnRyeSxcbiAgc2VyaWFsaXplTG9jYWxJbmRleCxcbiAgdHlwZSBEZXNlcmlhbGl6ZWRMb2NhbFN0YXRlLFxuICB0eXBlIExvY2FsSW5kZXgsXG4gIHR5cGUgUGVyc2lzdGVkU3luY1N0YXRlLFxufSBmcm9tICcuL2xvY2FsaW5kZXguanMnO1xuaW1wb3J0IHsgaXNTdHJpY3RseUJlbmVhdGgsIHBhcmVudFBhdGggfSBmcm9tICcuL3BhdGhzLmpzJztcbmltcG9ydCB0eXBlIHsgUHVsbE9wLCBTeW5jUGxhbiB9IGZyb20gJy4vcmVzb2x2ZS5qcyc7XG5cbi8qKiBJbmplY3RlZCBjb250ZW50IHRyYW5zcG9ydDogZmV0Y2ggdGhlIGJsb2IgZm9yIGEgY29udGVudCBoYXNoLiAqL1xuZXhwb3J0IHR5cGUgRmV0Y2hCbG9iID0gKGhhc2g6IHN0cmluZykgPT4gUHJvbWlzZTxVaW50OEFycmF5PjtcblxuZXhwb3J0IGludGVyZmFjZSBBcHBseVB1bGxPcHRpb25zIHtcbiAgLyoqIEVwb2NoIG1zIHVzZWQgZm9yIHRvbWJzdG9uZSB0aW1lc3RhbXBzLiBEZWZhdWx0OiBgRGF0ZS5ub3coKWAgXHUyMDE0IHRoaXNcbiAgICogIGZ1bmN0aW9uIGlzIEkvTyBvcmNoZXN0cmF0aW9uLCBub3QgYSBwdXJlIGZ1bmN0aW9uLCBidXQgdGVzdHMgaW5qZWN0XG4gICAqICBhIGZpeGVkIHZhbHVlIGZvciBkZXRlcm1pbmlzbS4gKi9cbiAgbm93PzogbnVtYmVyO1xuICAvKipcbiAgICogQnVsay1wdWxsIHByb2dyZXNzOiBjYWxsZWQgb25jZSB3aXRoICgwLCB0b3RhbCkgdXAgZnJvbnQgYW5kIG9uY2UgYWZ0ZXJcbiAgICogZWFjaCBwdWxsIG1hdGVyaWFsaXplcy4gUHVyZSByZXBvcnRpbmcgXHUyMDE0IG5ldmVyIGFmZmVjdHMgYXBwbGljYXRpb24uXG4gICAqL1xuICBvblByb2dyZXNzPzogKGRvbmU6IG51bWJlciwgdG90YWw6IG51bWJlcikgPT4gdm9pZDtcbiAgLyoqXG4gICAqIFN5bmMtY3Vyc29yIGJvb2trZWVwaW5nIHRvIHdyaXRlIGludG8gdGhlIHN0YXRlIGZpbGUncyBlbnZlbG9wZSB3aGVuZXZlclxuICAgKiB0aGlzIGNhbGwgcGVyc2lzdHMgdGhlIGluZGV4LiBXaXRob3V0IGl0IGEgcHVsbC1zaWRlIHBlcnNpc3Qgd291bGQgc3RyaXBcbiAgICogdGhlIGNsaWVudCdzIGN1cnNvci9zeW5jZWRUaHJvdWdoIGZpZWxkcyBmcm9tIGAvLnZhdWx0c3luY2ZvcmFnZW50cy9zdGF0ZWBcbiAgICogKHRoZSBlbnZlbG9wZSBpcyByZXdyaXR0ZW4gd2hvbGVzYWxlKS4gVGhlIGNsaWVudCBwYXNzZXMgaXRzIGN1cnJlbnRcbiAgICogdmFsdWVzOyBhIHNuYXBzaG90IGEgbW9tZW50IHN0YWxlIGlzIGhhcm1sZXNzIFx1MjAxNCB0aGUgbmV4dCBwZXJzaXN0IHJlZnJlc2hlc1xuICAgKiBpdCwgYW5kIGFuIHVuZGVyLXJlcG9ydGVkIGN1cnNvciBvbmx5IHdpZGVucyB0aGUgbmV4dCByZXBsYXkuXG4gICAqL1xuICBwZXJzaXN0ZWRTdGF0ZT86IFBlcnNpc3RlZFN5bmNTdGF0ZTtcbn1cblxuLyoqXG4gKiBBcHBseSBhbGwgcHVsbHMgb2YgYHBsYW5gIGFuZCByZXR1cm4gdGhlIHVwZGF0ZWQgaW5kZXggKGFsc28gcGVyc2lzdGVkIHRvXG4gKiB0aGUgYWRhcHRlciBhdCBgTE9DQUxfSU5ERVhfU1RBVEVfUEFUSGApLlxuICpcbiAqIFN0b3JhZ2Ugd3JpdGVzIGhhcHBlbiBpbiBwbGFuIG9yZGVyLiBJZiBhbnkgb3AgZmFpbHMsIHRoZSBpbmRleCByZWZsZWN0aW5nXG4gKiBldmVyeSBvcCB0aGF0IHN1Y2NlZWRlZCBzbyBmYXIgaXMgcGVyc2lzdGVkIGFuZCB0aGUgb3JpZ2luYWwgZXJyb3IgaXNcbiAqIHJldGhyb3duIFx1MjAxNCBwYXRocyB0aGF0IGZhaWxlZCBhcmUgYWJzZW50IGZyb20gdGhlIHJldHVybmVkL3BlcnNpc3RlZCBpbmRleC5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGFwcGx5UHVsbChcbiAgc3RvcmFnZTogU3RvcmFnZUFkYXB0ZXIsXG4gIGluZGV4OiBMb2NhbEluZGV4LFxuICBwbGFuOiBTeW5jUGxhbixcbiAgZmV0Y2hCbG9iOiBGZXRjaEJsb2IsXG4gIG9wdGlvbnM6IEFwcGx5UHVsbE9wdGlvbnMgPSB7fSxcbik6IFByb21pc2U8TG9jYWxJbmRleD4ge1xuICBjb25zdCBub3cgPSBvcHRpb25zLm5vdyA/PyBEYXRlLm5vdygpO1xuICBjb25zdCBvblByb2dyZXNzID0gb3B0aW9ucy5vblByb2dyZXNzO1xuICBsZXQgd29ya2luZzogTG9jYWxJbmRleCA9IGluZGV4O1xuXG4gIG9uUHJvZ3Jlc3M/LigwLCBwbGFuLnB1bGxzLmxlbmd0aCk7XG4gIGxldCBkb25lID0gMDtcbiAgdHJ5IHtcbiAgICBmb3IgKGNvbnN0IHB1bGwgb2YgcGxhbi5wdWxscykge1xuICAgICAgd29ya2luZyA9IGF3YWl0IGFwcGx5T25lUHVsbChzdG9yYWdlLCB3b3JraW5nLCBwdWxsLCBmZXRjaEJsb2IsIG5vdyk7XG4gICAgICBkb25lICs9IDE7XG4gICAgICBvblByb2dyZXNzPy4oZG9uZSwgcGxhbi5wdWxscy5sZW5ndGgpO1xuICAgIH1cbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgcGVyc2lzdEluZGV4KHN0b3JhZ2UsIHdvcmtpbmcsIG9wdGlvbnMucGVyc2lzdGVkU3RhdGUpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gUGVyc2lzdGVuY2UgZmFpbHVyZSBtdXN0IG5vdCBtYXNrIHRoZSBvcmlnaW5hbCBlcnJvcjsgdGhlIGNhbGxlclxuICAgICAgLy8gcmV0cmllcyB0aGUgd2hvbGUgY3ljbGUgYW55d2F5LlxuICAgIH1cbiAgICB0aHJvdyBlcnJvcjtcbiAgfVxuXG4gIGF3YWl0IHBlcnNpc3RJbmRleChzdG9yYWdlLCB3b3JraW5nLCBvcHRpb25zLnBlcnNpc3RlZFN0YXRlKTtcbiAgcmV0dXJuIHdvcmtpbmc7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGFwcGx5T25lUHVsbChcbiAgc3RvcmFnZTogU3RvcmFnZUFkYXB0ZXIsXG4gIGluZGV4OiBMb2NhbEluZGV4LFxuICBwdWxsOiBQdWxsT3AsXG4gIGZldGNoQmxvYjogRmV0Y2hCbG9iLFxuICBub3c6IG51bWJlcixcbik6IFByb21pc2U8TG9jYWxJbmRleD4ge1xuICBpZiAocHVsbC5raW5kID09PSAncmVuYW1lJykge1xuICAgIGlmIChhd2FpdCBzdG9yYWdlLmV4aXN0cyhwdWxsLmZyb21QYXRoKSkge1xuICAgICAgYXdhaXQgc3RvcmFnZS5yZW5hbWVGaWxlKHB1bGwuZnJvbVBhdGgsIHB1bGwudG9QYXRoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gT2xkIHBhdGggbmV2ZXIgbWF0ZXJpYWxpemVkIGhlcmUgKG9yIGFscmVhZHkgbW92ZWQpOiBmZXRjaCBjb250ZW50LlxuICAgICAgYXdhaXQgZmV0Y2hWZXJpZmllZChzdG9yYWdlLCBwdWxsLnRvUGF0aCwgcHVsbC5oYXNoLCBmZXRjaEJsb2IpO1xuICAgIH1cbiAgICBjb25zdCBtb3ZlZCA9IGFwcGx5Q29tbWl0KHJlbW92ZUVudHJ5KGluZGV4LCBwdWxsLmZyb21QYXRoKSwge1xuICAgICAgcGF0aDogcHVsbC50b1BhdGgsXG4gICAgICB2ZXJzaW9uSWQ6IHB1bGwudmVyc2lvbixcbiAgICAgIGhhc2g6IHB1bGwuaGFzaCxcbiAgICAgIHNpemU6IHB1bGwuc2l6ZSxcbiAgICAgIGNsb2NrOiBwdWxsLmNsb2NrLFxuICAgIH0pO1xuICAgIC8vIFRoZSBsYXN0IGZpbGUgbWF5IGp1c3QgaGF2ZSBsZWZ0IGl0cyBvbGQgcGFyZW50IGRpcmVjdG9yeSAocHJ1bmUtb24tXG4gICAgLy8gZGVsZXRlIGFwcGxpZXMgdG8gbW92ZXMgdG9vOyB0aGUgcmVuYW1lIGl0c2VsZiBpcyB1bnRvdWNoZWQpLlxuICAgIGF3YWl0IHBydW5lUGFyZW50T25EZWxldGUoc3RvcmFnZSwgbW92ZWQsIHB1bGwuZnJvbVBhdGgpO1xuICAgIHJldHVybiBtb3ZlZDtcbiAgfVxuXG4gIGlmIChwdWxsLmlzRm9sZGVyKSB7XG4gICAgLy8gRm9sZGVyIHBsYWNlaG9sZGVycyAoRlItMTApOiBjcmVhdGUgdGhlIGRpcmVjdG9yeSwgcmVjb3JkIHRoZSBlbnRyeS5cbiAgICAvLyBBIGZvbGRlciBUT01CU1RPTkUgYWRkaXRpb25hbGx5IHJlbW92ZXMgdGhlIGxvY2FsIGRpcmVjdG9yeSB3aGVuIGl0XG4gICAgLy8gZXhpc3RzIGFuZCBpcyBlbXB0eTsgbm9uLWVtcHR5IG9yIG1pc3NpbmcgXHUyMUQyIHJlY29yZCBvbmx5IChjb252ZXJnZXNcbiAgICAvLyBsYXRlciBcdTIwMTQgYSBub24tZW1wdHkgZGlyZWN0b3J5IGlzIG5ldmVyIGRlbGV0ZWQgaGVyZSkuXG4gICAgaWYgKHB1bGwuZGVsZXRlZCkge1xuICAgICAgYXdhaXQgcmVtb3ZlRGlySWZWYWNhbnQoc3RvcmFnZSwgaW5kZXgsIHB1bGwucGF0aCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGF3YWl0IHN0b3JhZ2UuZW5zdXJlRGlyKHB1bGwucGF0aCk7XG4gICAgfVxuICAgIHJldHVybiBhcHBseUNvbW1pdChpbmRleCwge1xuICAgICAgcGF0aDogcHVsbC5wYXRoLFxuICAgICAgdmVyc2lvbklkOiBwdWxsLnZlcnNpb24sXG4gICAgICBoYXNoOiBwdWxsLmhhc2gsXG4gICAgICBzaXplOiBwdWxsLnNpemUsXG4gICAgICBjbG9jazogcHVsbC5jbG9jayxcbiAgICAgIGRlbGV0ZWQ6IHB1bGwuZGVsZXRlZCxcbiAgICAgIGRlbGV0ZWRBdDogcHVsbC5kZWxldGVkID8gbm93IDogdW5kZWZpbmVkLFxuICAgICAgaXNGb2xkZXI6IHRydWUsXG4gICAgfSk7XG4gIH1cblxuICBpZiAocHVsbC5kZWxldGVkKSB7XG4gICAgLy8gSWRlbXBvdGVudCBwZXIgdGhlIGFkYXB0ZXIgY29udHJhY3Q7IGEgbG9jYWwgLnRyYXNoIGNvcHkgaXMgYVxuICAgIC8vIHBsYXRmb3JtLWxheWVyIGNvbmNlcm4gKGRhZW1vbi9wbHVnaW4pLCBub3QgZW5naW5lIGxvZ2ljLlxuICAgIGF3YWl0IHN0b3JhZ2UuZGVsZXRlRmlsZShwdWxsLnBhdGgpO1xuICAgIGNvbnN0IHRvbWJzdG9uZWQgPSBhcHBseUNvbW1pdChpbmRleCwge1xuICAgICAgcGF0aDogcHVsbC5wYXRoLFxuICAgICAgdmVyc2lvbklkOiBwdWxsLnZlcnNpb24sXG4gICAgICBoYXNoOiBwdWxsLmhhc2gsXG4gICAgICBzaXplOiBwdWxsLnNpemUsXG4gICAgICBjbG9jazogcHVsbC5jbG9jayxcbiAgICAgIGRlbGV0ZWQ6IHRydWUsXG4gICAgICBkZWxldGVkQXQ6IG5vdyxcbiAgICB9KTtcbiAgICAvLyBQcnVuZS1vbi1kZWxldGU6IGFuIGVtcHRpZWQgcGFyZW50IGRpcmVjdG9yeSBtdXN0IG5vdCBsaW5nZXIgYW5kXG4gICAgLy8gcmUtc3VyZmFjZSBhcyBhbiBlbXB0eS1mb2xkZXIgcGxhY2Vob2xkZXIgb24gdGhlIG5leHQgc2Nhbi5cbiAgICBhd2FpdCBwcnVuZVBhcmVudE9uRGVsZXRlKHN0b3JhZ2UsIHRvbWJzdG9uZWQsIHB1bGwucGF0aCk7XG4gICAgcmV0dXJuIHRvbWJzdG9uZWQ7XG4gIH1cblxuICBjb25zdCBjdXJyZW50ID0gaW5kZXhbcHVsbC5wYXRoXTtcbiAgaWYgKFxuICAgIGN1cnJlbnQgIT09IHVuZGVmaW5lZCAmJlxuICAgIGN1cnJlbnQuZGVsZXRlZEF0ID09PSB1bmRlZmluZWQgJiZcbiAgICBjdXJyZW50Lmhhc2ggPT09IHB1bGwuaGFzaCAmJlxuICAgIChhd2FpdCBzdG9yYWdlLmV4aXN0cyhwdWxsLnBhdGgpKVxuICApIHtcbiAgICAvLyBDb250ZW50IGFscmVhZHkgY29ycmVjdCBsb2NhbGx5IChlLmcuIHZlcnNpb24taWQgY2F0Y2gtdXAgYWZ0ZXIgYVxuICAgIC8vIHJlbmFtZSBlbHNld2hlcmUpOiByZWNvcmQgdGhlIGF1dGhvcml0YXRpdmUgaGVhZCwgc2tpcCBmZXRjaCt3cml0ZS5cbiAgICAvLyBUaGUgZXhpc3RlbmNlIGNoZWNrIG1hdHRlcnMgd2hlbiB0aGUgZmlsZSB3YXMgZGVsZXRlZCBsb2NhbGx5IHNpbmNlIHRoZVxuICAgIC8vIGluZGV4IHdhcyBsYXN0IHdyaXR0ZW4gXHUyMDE0IHJlY3JlYXRpbmcgaXQgaXMgd2hhdCB0aGUgcHVsbCBkZW1hbmRzLlxuICAgIHJldHVybiBhcHBseUNvbW1pdChpbmRleCwge1xuICAgICAgcGF0aDogcHVsbC5wYXRoLFxuICAgICAgdmVyc2lvbklkOiBwdWxsLnZlcnNpb24sXG4gICAgICBoYXNoOiBwdWxsLmhhc2gsXG4gICAgICBzaXplOiBwdWxsLnNpemUsXG4gICAgICBjbG9jazogcHVsbC5jbG9jayxcbiAgICB9KTtcbiAgfVxuXG4gIGF3YWl0IGZldGNoVmVyaWZpZWQoc3RvcmFnZSwgcHVsbC5wYXRoLCBwdWxsLmhhc2gsIGZldGNoQmxvYik7XG4gIHJldHVybiBhcHBseUNvbW1pdChpbmRleCwge1xuICAgIHBhdGg6IHB1bGwucGF0aCxcbiAgICB2ZXJzaW9uSWQ6IHB1bGwudmVyc2lvbixcbiAgICBoYXNoOiBwdWxsLmhhc2gsXG4gICAgc2l6ZTogcHVsbC5zaXplLFxuICAgIGNsb2NrOiBwdWxsLmNsb2NrLFxuICB9KTtcbn1cblxuLy8gLS0tIGZvbGRlciBsaWZlY3ljbGUgaGVscGVycyAoQjogdG9tYnN0b25lLWFwcGx5LCBDOiBwcnVuZS1vbi1kZWxldGUpIC0tLS0tLS0tXG5cbi8qKiBPdXRjb21lIG9mIGEgcHJ1bmUgYXR0ZW1wdDogdGhlIGRpcmVjdG9yeSBqdWRnZWQgZGVsZXRhYmxlLCBhbmQgd2hldGhlciBpdCB3YXMuICovXG5leHBvcnQgaW50ZXJmYWNlIFBydW5lZERpciB7XG4gIC8qKiBUaGUgZGlyZWN0b3J5IHRoYXQgcXVhbGlmaWVkIGZvciByZW1vdmFsICh0aGUgZGVsZXRlZCBwYXRoJ3MgcGFyZW50KS4gKi9cbiAgZGlyOiBzdHJpbmc7XG4gIC8qKiBXaGV0aGVyIGBzdG9yYWdlLnJlbW92ZURpcmAgYWN0dWFsbHkgcmVtb3ZlZCBpdCAoZmFsc2Ugd2hlbiB0aGUgYWRhcHRlclxuICAgKiAgbGFja3MgdGhlIGhvb2sgb3IgcmVmdXNlZCBcdTIwMTQgZWxpZ2liaWxpdHkgYWxvbmUgc3RpbGwgc3VwcHJlc3NlcyBhXG4gICAqICBwbGFjZWhvbGRlciBwdXNoIGZvciBpdCwgYGNsaWVudC50c2ApLiAqL1xuICByZW1vdmVkOiBib29sZWFuO1xufVxuXG4vKipcbiAqIFdoZXRoZXIgYGRpcmAgbWF5IGJlIGRlbGV0ZWQgd2l0aG91dCBsb3NpbmcgYW55dGhpbmc6IGl0IGV4aXN0cywgbm90aGluZ1xuICogKGZpbGUgb3IgZGlyZWN0b3J5KSBsaXZlcyBiZW5lYXRoIGl0IGluIHN0b3JhZ2UsIGFuZCB0aGUgaW5kZXggaG9sZHMgbm9cbiAqIGxpdmUgZmlsZSBlbnRyeSBiZW5lYXRoIGl0LiBUaGUgcm9vdCBpcyBuZXZlciBkZWxldGFibGUuIFRoaXMgaXMgdGhlXG4gKiBuZXZlci1kZWxldGUtbm9uLWVtcHR5IC8gbmV2ZXItbG9zZS1jb250ZW50IGludmFyaWFudCBtYWRlIGV4cGxpY2l0IFx1MjAxNFxuICogZXZlcnkgZGlyZWN0b3J5IHJlbW92YWwgaW4gY29yZSBnb2VzIHRocm91Z2ggaXQuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGRpcklzVmFjYW50KFxuICBzdG9yYWdlOiBTdG9yYWdlQWRhcHRlcixcbiAgaW5kZXg6IExvY2FsSW5kZXgsXG4gIGRpcjogc3RyaW5nLFxuKTogUHJvbWlzZTxib29sZWFuPiB7XG4gIGlmIChkaXIgPT09ICcvJykgcmV0dXJuIGZhbHNlO1xuICBpZiAoIShhd2FpdCBzdG9yYWdlLmV4aXN0cyhkaXIpKSkgcmV0dXJuIGZhbHNlO1xuICBmb3IgKGNvbnN0IGZpbGUgb2YgYXdhaXQgc3RvcmFnZS5saXN0RmlsZXMoKSkge1xuICAgIGlmIChpc1N0cmljdGx5QmVuZWF0aChmaWxlLnBhdGgsIGRpcikpIHJldHVybiBmYWxzZTtcbiAgfVxuICBmb3IgKGNvbnN0IGNoaWxkIG9mIGF3YWl0IHN0b3JhZ2UubGlzdERpcnMoKSkge1xuICAgIGlmIChpc1N0cmljdGx5QmVuZWF0aChjaGlsZCwgZGlyKSkgcmV0dXJuIGZhbHNlO1xuICB9XG4gIGZvciAoY29uc3QgW3BhdGgsIGVudHJ5XSBvZiBPYmplY3QuZW50cmllcyhpbmRleCkpIHtcbiAgICBpZiAoZW50cnkuaXNGb2xkZXIgfHwgZW50cnkuZGVsZXRlZEF0ICE9PSB1bmRlZmluZWQpIGNvbnRpbnVlO1xuICAgIGlmIChpc1N0cmljdGx5QmVuZWF0aChwYXRoLCBkaXIpKSByZXR1cm4gZmFsc2U7XG4gIH1cbiAgcmV0dXJuIHRydWU7XG59XG5cbi8qKiBSZW1vdmUgYGRpcmAgdGhyb3VnaCB0aGUgYWRhcHRlciB3aGVuIGl0IGlzIHZhY2FudC4gTWlzc2luZy9ub24tZW1wdHkvdW5zdXBwb3J0ZWQgXHUyMUQyIGZhbHNlLiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlbW92ZURpcklmVmFjYW50KFxuICBzdG9yYWdlOiBTdG9yYWdlQWRhcHRlcixcbiAgaW5kZXg6IExvY2FsSW5kZXgsXG4gIGRpcjogc3RyaW5nLFxuKTogUHJvbWlzZTxib29sZWFuPiB7XG4gIGlmICghKGF3YWl0IGRpcklzVmFjYW50KHN0b3JhZ2UsIGluZGV4LCBkaXIpKSkgcmV0dXJuIGZhbHNlO1xuICByZXR1cm4gcmVtb3ZlVmFjYW50RGlyKHN0b3JhZ2UsIGRpcik7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHJlbW92ZVZhY2FudERpcihzdG9yYWdlOiBTdG9yYWdlQWRhcHRlciwgZGlyOiBzdHJpbmcpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgaWYgKHN0b3JhZ2UucmVtb3ZlRGlyID09PSB1bmRlZmluZWQpIHJldHVybiBmYWxzZTsgLy8gcHJlLWhvb2sgYWRhcHRlcnM6IHJlY29yZC1vbmx5XG4gIHRyeSB7XG4gICAgYXdhaXQgc3RvcmFnZS5yZW1vdmVEaXIoZGlyKTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSBjYXRjaCB7XG4gICAgLy8gQSByZWZ1c2VkIG9yIHJhY2VkIHJlbW92YWwgaXMgcmVjb3JkLW9ubHksIG5ldmVyIGZhdGFsIGFuZCBuZXZlciBkYXRhXG4gICAgLy8gbG9zcyBcdTIwMTQgdGhlIHRvbWJzdG9uZSBpcyBzdGlsbCByZWNvcmRlZCBhbmQgc3RhdGUgY29udmVyZ2VzIGxhdGVyLlxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG4vKipcbiAqIFBydW5lLW9uLWRlbGV0ZSAoQyk6IGFmdGVyIGBkZWxldGVkUGF0aGAgd2FzIGRlbGV0ZWQgKG9yIHJlbmFtZWQgYXdheSksXG4gKiByZW1vdmUgaXRzIGltbWVkaWF0ZSBwYXJlbnQgZGlyZWN0b3J5IHdoZW4gaXQgaXMgbm93IGVtcHR5IG9uIGRpc2sgYW5kXG4gKiB1bnJlcHJlc2VudGVkIGJ5IGxpdmUgaW5kZXggZW50cmllcyBcdTIwMTQgZXhhY3RseSBPTkUgbGV2ZWwsIG5vIGNhc2NhZGUuXG4gKlxuICogUmV0dXJucyB0aGUgYFBydW5lZERpcmAgd2hlbiB0aGUgcGFyZW50IFFVQUxJRklFRCBmb3IgcmVtb3ZhbCAod2hldGhlciBvclxuICogbm90IHRoZSBhZGFwdGVyIGNvdWxkIHBlcmZvcm0gaXQgXHUyMDE0IGNhbGxlcnMgdXNlIGVsaWdpYmlsaXR5IHRvIHN1cHByZXNzIGFuXG4gKiBlbXB0eS1mb2xkZXIgcGxhY2Vob2xkZXIgcHVzaCBmb3IgdGhhdCBkaXJlY3RvcnkpLCBgdW5kZWZpbmVkYCB3aGVuIHRoZVxuICogcGFyZW50IHdhcyBub3QgZGVsZXRhYmxlIChub24tZW1wdHksIGhvbGRzIGxpdmUgZW50cmllcywgbWlzc2luZywgb3Igcm9vdCkuXG4gKiBQdXJlIHdpdGggcmVzcGVjdCB0byB0aGUgaW5kZXg6IG5ldmVyIG11dGF0ZXMgaXQuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBwcnVuZVBhcmVudE9uRGVsZXRlKFxuICBzdG9yYWdlOiBTdG9yYWdlQWRhcHRlcixcbiAgaW5kZXg6IExvY2FsSW5kZXgsXG4gIGRlbGV0ZWRQYXRoOiBzdHJpbmcsXG4pOiBQcm9taXNlPFBydW5lZERpciB8IHVuZGVmaW5lZD4ge1xuICBjb25zdCBkaXIgPSBwYXJlbnRQYXRoKGRlbGV0ZWRQYXRoKTtcbiAgaWYgKCEoYXdhaXQgZGlySXNWYWNhbnQoc3RvcmFnZSwgaW5kZXgsIGRpcikpKSByZXR1cm4gdW5kZWZpbmVkO1xuICByZXR1cm4geyBkaXIsIHJlbW92ZWQ6IGF3YWl0IHJlbW92ZVZhY2FudERpcihzdG9yYWdlLCBkaXIpIH07XG59XG5cbi8qKiBEb3dubG9hZCwgdmVyaWZ5LCBhbmQgd3JpdGUgb25lIGJsb2IuIEEgaGFzaCBtaXNtYXRjaCBhYm9ydHMgdGhlIHBsYW4uICovXG5hc3luYyBmdW5jdGlvbiBmZXRjaFZlcmlmaWVkKFxuICBzdG9yYWdlOiBTdG9yYWdlQWRhcHRlcixcbiAgcGF0aDogc3RyaW5nLFxuICBoYXNoOiBzdHJpbmcsXG4gIGZldGNoQmxvYjogRmV0Y2hCbG9iLFxuKTogUHJvbWlzZTx2b2lkPiB7XG4gIGNvbnN0IGJ5dGVzID0gYXdhaXQgZmV0Y2hCbG9iKGhhc2gpO1xuICBjb25zdCBhY3R1YWwgPSBhd2FpdCBzaGEyNTZIZXgoYnl0ZXMpO1xuICBpZiAoYWN0dWFsICE9PSBoYXNoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgYEJsb2IgaGFzaCBtaXNtYXRjaCBmb3IgJHtKU09OLnN0cmluZ2lmeShwYXRoKX06IGV4cGVjdGVkICR7aGFzaH0sIGdvdCAke2FjdHVhbH1gLFxuICAgICk7XG4gIH1cbiAgYXdhaXQgc3RvcmFnZS53cml0ZUZpbGUocGF0aCwgYnl0ZXMpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBwZXJzaXN0SW5kZXgoXG4gIHN0b3JhZ2U6IFN0b3JhZ2VBZGFwdGVyLFxuICBpbmRleDogTG9jYWxJbmRleCxcbiAgc3RhdGU6IFBlcnNpc3RlZFN5bmNTdGF0ZSA9IHt9LFxuKTogUHJvbWlzZTx2b2lkPiB7XG4gIGF3YWl0IHN0b3JhZ2Uud3JpdGVGaWxlKFxuICAgIExPQ0FMX0lOREVYX1NUQVRFX1BBVEgsXG4gICAgbmV3IFRleHRFbmNvZGVyKCkuZW5jb2RlKHNlcmlhbGl6ZUxvY2FsSW5kZXgoaW5kZXgsIHN0YXRlKSksXG4gICk7XG59XG5cbi8qKlxuICogTG9hZCB0aGUgcGVyc2lzdGVkIGluZGV4IEFORCBpdHMgc3luYy1jdXJzb3IgYm9va2tlZXBpbmcgKHRoZSBjbGllbnQnc1xuICogc3RhcnR1cCBwYXRoIFx1MjAxNCB0aGUgY3Vyc29yIHBvd2VycyBkZWx0YS1tYW5pZmVzdCByZWNvbm5lY3RzKS4gVGhyb3dzXG4gKiBgUHJvdG9jb2xFcnJvcmAgKHZpYSBgZGVzZXJpYWxpemVMb2NhbFN0YXRlYCkgb24gY29ycnVwdCBvciBmdXR1cmUtc2NoZW1hXG4gKiBzdGF0ZSBcdTIwMTQgY2FsbGVycyBzdXJmYWNlIHRoYXQgaW5zdGVhZCBvZiBzaWxlbnRseSByZS1zeW5jaW5nIGZyb20gc2NyYXRjaC5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGxvYWRMb2NhbFN0YXRlKHN0b3JhZ2U6IFN0b3JhZ2VBZGFwdGVyKTogUHJvbWlzZTxEZXNlcmlhbGl6ZWRMb2NhbFN0YXRlPiB7XG4gIGNvbnN0IGJ5dGVzID0gYXdhaXQgc3RvcmFnZS5yZWFkRmlsZShMT0NBTF9JTkRFWF9TVEFURV9QQVRIKTtcbiAgcmV0dXJuIGRlc2VyaWFsaXplTG9jYWxTdGF0ZShuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUoYnl0ZXMpKTtcbn1cblxuLyoqXG4gKiBMb2FkIHRoZSBwZXJzaXN0ZWQgaW5kZXggKEFSQ0hJVEVDVFVSRSBcdTAwQTc4IHN0ZXAgMSkuIFRocm93c1xuICogYFByb3RvY29sRXJyb3JgICh2aWEgYGRlc2VyaWFsaXplTG9jYWxJbmRleGApIG9uIGNvcnJ1cHQgb3IgZnV0dXJlLXNjaGVtYVxuICogc3RhdGUgXHUyMDE0IGNhbGxlcnMgc3VyZmFjZSB0aGF0IGluc3RlYWQgb2Ygc2lsZW50bHkgcmUtc3luY2luZyBmcm9tIHNjcmF0Y2guXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBsb2FkTG9jYWxJbmRleChzdG9yYWdlOiBTdG9yYWdlQWRhcHRlcik6IFByb21pc2U8TG9jYWxJbmRleD4ge1xuICByZXR1cm4gKGF3YWl0IGxvYWRMb2NhbFN0YXRlKHN0b3JhZ2UpKS5pbmRleDtcbn1cbiIsICIvKipcbiAqIFZhdWx0IGlnbm9yZSBydWxlcyAoQVJDSElURUNUVVJFLm1kIFx1MDBBNzQsIEZSLTExL0ZSLTQyKSBcdTIwMTQgc2hhcmVkIGJ5IGV2ZXJ5XG4gKiBjbGllbnQgc28gbG9jYWwgc2NhbnMsIHdhdGNoZXJzLCBhbmQgY29tbWl0IHBhdGhzIGFncmVlIGJ5dGUtZm9yLWJ5dGUuXG4gKlxuICogTWF0Y2hpbmcgaXMgc2VnbWVudC1iYXNlZCBhbmQgY2FzZS1pbnNlbnNpdGl2ZSAodGhlIG93bmVyJ3MgcHJpbWFyeVxuICogcGxhdGZvcm1zIFx1MjAxNCBXaW5kb3dzLCBtYWNPUyBcdTIwMTQgaGF2ZSBjYXNlLWluc2Vuc2l0aXZlIGZpbGVzeXN0ZW1zLCBzb1xuICogYC5UcmFzaC9mb28ubWRgIG11c3Qgbm90IHNuZWFrIHBhc3QgdGhlIGAudHJhc2gvYCBydWxlKS5cbiAqL1xuXG5pbXBvcnQgeyBub3JtYWxpemVWYXVsdFBhdGggfSBmcm9tICcuL3BhdGhzLmpzJztcblxuLyoqIFNldHRpbmdzIHN1YnNldCBgaXNJZ25vcmVkYCBuZWVkczsgYFZhdWx0U2V0dGluZ3NgIHNhdGlzZmllcyBpdC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSWdub3JlU2V0dGluZ3Mge1xuICBvYnNpZGlhblN5bmM6IGJvb2xlYW47XG4gIC8qKlxuICAgKiBVc2VyLWRlZmluZWQgZXh0cmEgaWdub3JlIHBhdHRlcm5zIChjbGllbnQtc2lkZSBvbmx5KS4gR2xvYi1saXRlIHN5bnRheDpcbiAgICogYCpgIG1hdGNoZXMgd2l0aGluIG9uZSBwYXRoIHNlZ21lbnQsIGEgd2hvbGUgYCoqYCBzZWdtZW50IHNwYW5zIGFueVxuICAgKiBudW1iZXIgb2Ygc2VnbWVudHMsIG1hdGNoaW5nIGlzIGNhc2UtaW5zZW5zaXRpdmUuIEEgcGF0dGVybiBjb250YWluaW5nXG4gICAqIGAvYCBpcyBhbmNob3JlZCBhdCB0aGUgdmF1bHQgcm9vdCAoYHByaXZhdGUvKipgKTsgYSBiYXJlIHBhdHRlcm4gd2l0aG91dFxuICAgKiBgL2AgbWF0Y2hlcyBhIGZpbGUgTkFNRSBhdCBhbnkgZGVwdGggKGAqLnRtcGApLiBFbXB0eSBsaW5lcyBhcmUgaWdub3JlZC5cbiAgICovXG4gIGV4dHJhSWdub3Jlcz86IHJlYWRvbmx5IHN0cmluZ1tdO1xufVxuXG4vKiogSWdub3JlZCB3aGVyZXZlciB0aGV5IGFwcGVhciwgYXMgYW55IHBhdGggc2VnbWVudCAoZGlyIG9yIGZpbGUgbmFtZSkuICovXG5jb25zdCBBTFdBWVNfSUdOT1JFRF9TRUdNRU5UUzogUmVhZG9ubHlTZXQ8c3RyaW5nPiA9IG5ldyBTZXQoW1xuICAnLnRyYXNoJywgLy8gbG9jYWwgZGVsZXRlLXJlY292ZXJ5IGRpciAoRlItNDIpXG4gICcuZHNfc3RvcmUnLFxuICAnLnZhdWx0c3luY2ZvcmFnZW50cycsIC8vIGNsaWVudCBzdGF0ZSBkaXIgKGxvY2FsIGluZGV4KSBpbnNpZGUgdGhlIHZhdWx0XG4gICd0aHVtYnMuZGInLFxuXSk7XG5cbi8qKiBgLm9ic2lkaWFuL2AgZmlsZXMgZXhjbHVkZWQgZXZlbiB3aGVuIGAub2JzaWRpYW4vYCBzeW5jIGlzIG9wdGVkIGluLiAqL1xuY29uc3QgT0JTSURJQU5fVk9MQVRJTEVfRklMRVM6IFJlYWRvbmx5U2V0PHN0cmluZz4gPSBuZXcgU2V0KFtcbiAgJy5vYnNpZGlhbi93b3Jrc3BhY2UuanNvbicsXG4gICcub2JzaWRpYW4vd29ya3NwYWNlLW1vYmlsZS5qc29uJyxcbl0pO1xuXG4vKipcbiAqIFdoZXRoZXIgYHZhdWx0UGF0aGAgbXVzdCBiZSBleGNsdWRlZCBmcm9tIHN5bmMuXG4gKlxuICogQWx3YXlzIGlnbm9yZWQ6IGAudHJhc2gvYCwgYC5EU19TdG9yZWAsIGBUaHVtYnMuZGJgLCBgLnZhdWx0c3luY2ZvcmFnZW50cy9gXG4gKiAoYW55IGRlcHRoKS4gYC5vYnNpZGlhbi9gIGlzIGlnbm9yZWQgZW50aXJlbHkgd2hlbiBgc2V0dGluZ3Mub2JzaWRpYW5TeW5jYFxuICogaXMgZmFsc2U7IHdoZW4gdHJ1ZSwgZXZlcnl0aGluZyB1bmRlciBpdCBzeW5jcyBleGNlcHQgYHdvcmtzcGFjZS5qc29uYCxcbiAqIGB3b3Jrc3BhY2UtbW9iaWxlLmpzb25gLCBhbmQgYC5vYnNpZGlhbi9jYWNoZS9gLiBGaW5hbGx5LCBldmVyeSBwYXR0ZXJuIGluXG4gKiBgc2V0dGluZ3MuZXh0cmFJZ25vcmVzYCBpcyBtYXRjaGVkIChnbG9iLWxpdGUgXHUyMDE0IHNlZSBgSWdub3JlU2V0dGluZ3NgKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzSWdub3JlZCh2YXVsdFBhdGg6IHN0cmluZywgc2V0dGluZ3M6IElnbm9yZVNldHRpbmdzKTogYm9vbGVhbiB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVWYXVsdFBhdGgodmF1bHRQYXRoKTtcbiAgaWYgKG5vcm1hbGl6ZWQgPT09ICcvJykgcmV0dXJuIGZhbHNlO1xuXG4gIGNvbnN0IGxvd2VyID0gbm9ybWFsaXplZC5zbGljZSgxKS50b0xvd2VyQ2FzZSgpO1xuICBjb25zdCBzZWdtZW50cyA9IGxvd2VyLnNwbGl0KCcvJyk7XG5cbiAgaWYgKHNlZ21lbnRzLnNvbWUoKHNlZ21lbnQpID0+IEFMV0FZU19JR05PUkVEX1NFR01FTlRTLmhhcyhzZWdtZW50KSkpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIGlmIChzZWdtZW50c1swXSA9PT0gJy5vYnNpZGlhbicpIHtcbiAgICBpZiAoIXNldHRpbmdzLm9ic2lkaWFuU3luYykgcmV0dXJuIHRydWU7XG4gICAgaWYgKE9CU0lESUFOX1ZPTEFUSUxFX0ZJTEVTLmhhcyhsb3dlcikpIHJldHVybiB0cnVlO1xuICAgIGlmIChzZWdtZW50c1sxXSA9PT0gJ2NhY2hlJykgcmV0dXJuIHRydWU7IC8vIHRoZSBkaXIgaXRzZWxmIGFuZCBhbnl0aGluZyB1bmRlciBpdFxuICB9XG5cbiAgY29uc3QgZXh0cmFzID0gc2V0dGluZ3MuZXh0cmFJZ25vcmVzO1xuICBpZiAoZXh0cmFzICE9PSB1bmRlZmluZWQgJiYgZXh0cmFzLmxlbmd0aCA+IDApIHtcbiAgICBmb3IgKGNvbnN0IHBhdHRlcm4gb2YgZXh0cmFzKSB7XG4gICAgICBjb25zdCBjb21waWxlZCA9IGNvbXBpbGVFeHRyYUlnbm9yZShwYXR0ZXJuKTtcbiAgICAgIGlmIChjb21waWxlZCAhPT0gbnVsbCAmJiBtYXRjaGVzU2VnbWVudHMoY29tcGlsZWQsIHNlZ21lbnRzKSkgcmV0dXJuIHRydWU7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGZhbHNlO1xufVxuXG4vLyAtLS0gZXh0cmEgaWdub3JlIHBhdHRlcm5zIChnbG9iLWxpdGUpIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogQSBjb21waWxlZCBleHRyYS1pZ25vcmUgcGF0dGVybjogbG93ZXJjYXNlZCwgYC9gLXNwbGl0IHNlZ21lbnRzLiAqL1xudHlwZSBDb21waWxlZFBhdHRlcm4gPSB7IHNlZ21lbnRzOiByZWFkb25seSBzdHJpbmdbXTsgYW5jaG9yZWQ6IGJvb2xlYW4gfTtcblxuLyoqXG4gKiBOb3JtYWxpemUgb25lIHVzZXIgcGF0dGVybiBpbnRvIG1hdGNoYWJsZSBzZWdtZW50cy4gUmV0dXJucyBgbnVsbGAgZm9yXG4gKiBibGFuayBwYXR0ZXJucyAodGhleSBjYW4gbmV2ZXIgbWF0Y2ggXHUyMDE0IGFuZCBtdXN0IG5vdCBiZWNvbWUgXCJpZ25vcmVcbiAqIGV2ZXJ5dGhpbmdcIiBieSBhY2NpZGVudCkuIEEgbGVhZGluZy90cmFpbGluZyBgL2AgaXMgdG9sZXJhdGVkIGFuZCBzdHJpcHBlZDtcbiAqIGBhbmNob3JlZGAgcmVjb3JkcyB3aGV0aGVyIHRoZSBwYXR0ZXJuIG5hbWVzIGEgcGF0aCAobWF0Y2hlZCBmcm9tIHRoZVxuICogdmF1bHQgcm9vdCkgb3IgYSBiYXJlIG5hbWUgKG1hdGNoZWQgYWdhaW5zdCBhbnkgc3VmZml4IG9mIHRoZSBwYXRoKS5cbiAqL1xuZnVuY3Rpb24gY29tcGlsZUV4dHJhSWdub3JlKHBhdHRlcm46IHN0cmluZyk6IENvbXBpbGVkUGF0dGVybiB8IG51bGwge1xuICBsZXQgY2xlYW5lZCA9IHBhdHRlcm4udHJpbSgpLnRvTG93ZXJDYXNlKCk7XG4gIHdoaWxlIChjbGVhbmVkLnN0YXJ0c1dpdGgoJy8nKSkgY2xlYW5lZCA9IGNsZWFuZWQuc2xpY2UoMSk7XG4gIHdoaWxlIChjbGVhbmVkLmVuZHNXaXRoKCcvJykpIGNsZWFuZWQgPSBjbGVhbmVkLnNsaWNlKDAsIC0xKTtcbiAgaWYgKGNsZWFuZWQgPT09ICcnKSByZXR1cm4gbnVsbDtcbiAgcmV0dXJuIHsgc2VnbWVudHM6IGNsZWFuZWQuc3BsaXQoJy8nKSwgYW5jaG9yZWQ6IGNsZWFuZWQuaW5jbHVkZXMoJy8nKSB9O1xufVxuXG4vKiogUGF0dGVybiB2cyBwYXRoIHNlZ21lbnRzOyBgYW5jaG9yZWRgIHBhdHRlcm5zIG1heSBhbHNvIHN0YXJ0IGRlZXBlci4gKi9cbmZ1bmN0aW9uIG1hdGNoZXNTZWdtZW50cyhwYXR0ZXJuOiBDb21waWxlZFBhdHRlcm4sIHBhdGg6IHJlYWRvbmx5IHN0cmluZ1tdKTogYm9vbGVhbiB7XG4gIGlmIChwYXR0ZXJuLmFuY2hvcmVkKSB7XG4gICAgcmV0dXJuIHNlZ21lbnRzTWF0Y2gocGF0dGVybi5zZWdtZW50cywgcGF0aCk7XG4gIH1cbiAgLy8gQmFyZSBuYW1lIHBhdHRlcm46IG1hdGNoIGFueSB0cmFpbGluZyBzZWdtZW50IHJ1biAoYCoudG1wYCBhdCBhbnkgZGVwdGgpLlxuICBmb3IgKGxldCBzdGFydCA9IDA7IHN0YXJ0IDwgcGF0aC5sZW5ndGg7IHN0YXJ0KyspIHtcbiAgICBpZiAoc2VnbWVudHNNYXRjaChwYXR0ZXJuLnNlZ21lbnRzLCBwYXRoLnNsaWNlKHN0YXJ0KSkpIHJldHVybiB0cnVlO1xuICB9XG4gIHJldHVybiBmYWxzZTtcbn1cblxuLyoqIEdsb2ItbGl0ZSBzZWdtZW50IG1hdGNoaW5nOiBgKmAgaW5zaWRlIGEgc2VnbWVudCwgYCoqYCBhcyBhIHdob2xlIHNlZ21lbnQuICovXG5mdW5jdGlvbiBzZWdtZW50c01hdGNoKHBhdHRlcm46IHJlYWRvbmx5IHN0cmluZ1tdLCBwYXRoOiByZWFkb25seSBzdHJpbmdbXSk6IGJvb2xlYW4ge1xuICBpZiAocGF0dGVybi5sZW5ndGggPT09IDApIHJldHVybiBwYXRoLmxlbmd0aCA9PT0gMDtcbiAgY29uc3QgaGVhZCA9IHBhdHRlcm5bMF07XG4gIGNvbnN0IHJlc3QgPSBwYXR0ZXJuLnNsaWNlKDEpO1xuICBpZiAoaGVhZCA9PT0gdW5kZWZpbmVkKSByZXR1cm4gcGF0aC5sZW5ndGggPT09IDA7XG4gIGlmIChoZWFkID09PSAnKionKSB7XG4gICAgLy8gYCoqYCBjb25zdW1lcyB6ZXJvIG9yIG1vcmUgcGF0aCBzZWdtZW50cy5cbiAgICBmb3IgKGxldCBza2lwID0gMDsgc2tpcCA8PSBwYXRoLmxlbmd0aDsgc2tpcCsrKSB7XG4gICAgICBpZiAoc2VnbWVudHNNYXRjaChyZXN0LCBwYXRoLnNsaWNlKHNraXApKSkgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICBpZiAocGF0aC5sZW5ndGggPT09IDAgfHwgIXNlZ21lbnRNYXRjaChoZWFkLCBwYXRoWzBdISkpIHJldHVybiBmYWxzZTtcbiAgcmV0dXJuIHNlZ21lbnRzTWF0Y2gocmVzdCwgcGF0aC5zbGljZSgxKSk7XG59XG5cbi8qKiBPbmUgc2VnbWVudDogbGl0ZXJhbCB0ZXh0IHdpdGggYCpgIHdpbGRjYXJkcyAoYW55IHJ1biB3aXRoaW4gdGhlIHNlZ21lbnQpLiAqL1xuZnVuY3Rpb24gc2VnbWVudE1hdGNoKHBhdHRlcm46IHN0cmluZywgc2VnbWVudDogc3RyaW5nKTogYm9vbGVhbiB7XG4gIGlmICghcGF0dGVybi5pbmNsdWRlcygnKicpKSByZXR1cm4gcGF0dGVybiA9PT0gc2VnbWVudDtcbiAgY29uc3QgZmlyc3QgPSBwYXR0ZXJuLmluZGV4T2YoJyonKTtcbiAgY29uc3QgbGFzdCA9IHBhdHRlcm4ubGFzdEluZGV4T2YoJyonKTtcbiAgaWYgKCFzZWdtZW50LnN0YXJ0c1dpdGgocGF0dGVybi5zbGljZSgwLCBmaXJzdCkpKSByZXR1cm4gZmFsc2U7XG4gIGlmICghc2VnbWVudC5lbmRzV2l0aChwYXR0ZXJuLnNsaWNlKGxhc3QgKyAxKSkpIHJldHVybiBmYWxzZTtcbiAgbGV0IGluZGV4ID0gZmlyc3Q7XG4gIGZvciAoY29uc3QgbWlkZGxlIG9mIHBhdHRlcm4uc2xpY2UoZmlyc3QsIGxhc3QgKyAxKS5zcGxpdCgnKicpLnNsaWNlKDEsIC0xKSkge1xuICAgIGNvbnN0IGZvdW5kID0gc2VnbWVudC5pbmRleE9mKG1pZGRsZSwgaW5kZXgpO1xuICAgIGlmIChmb3VuZCA9PT0gLTEpIHJldHVybiBmYWxzZTtcbiAgICBpbmRleCA9IGZvdW5kICsgbWlkZGxlLmxlbmd0aDtcbiAgfVxuICByZXR1cm4gdHJ1ZTtcbn1cbiIsICIvKipcbiAqIFR5cGVkIFdlYlNvY2tldCBtZXNzYWdlIGRlZmluaXRpb25zIGZvciB0aGUgYC9zeW5jYCBjaGFubmVsXG4gKiAoQVJDSElURUNUVVJFLm1kIFx1MDBBNzUpLiBBbGwgbWVzc2FnZXMgYXJlIEpTT04gd2l0aCBhIGB0eXBlYCBkaXNjcmltaW5hbnQuXG4gKlxuICogVHdvIGNoYW5uZWxzIGV4aXN0OiB0aGlzIFdTIHByb3RvY29sIChtZXRhZGF0YSArIGNoYW5nZSBmZWVkKSBhbmQgcGxhaW5cbiAqIEhUVFBTIGJsb2Igcm91dGVzIChgR0VUL1BVVCAvYmxvYi86aGFzaGApIGZvciBjb250ZW50IFx1MjAxNCByZWZlcmVuY2VkIGhlcmVcbiAqIG9ubHkgdmlhIGNvbnRlbnQgaGFzaGVzLlxuICovXG5cbmltcG9ydCB0eXBlIHsgTG9naWNhbENsb2NrLCBWZXJzaW9uLCBWZXJzaW9uS2luZCwgVmF1bHRTZXR0aW5ncyB9IGZyb20gJy4vdHlwZXMuanMnO1xuaW1wb3J0IHsgUHJvdG9jb2xFcnJvciB9IGZyb20gJy4vZXJyb3JzLmpzJztcblxuLyoqIFdpcmUgcHJvdG9jb2wgdmVyc2lvbi4gQnVtcCBvbiBicmVha2luZyBtZXNzYWdlLXNoYXBlIGNoYW5nZXMuICovXG5leHBvcnQgY29uc3QgUHJvdG9jb2xWZXJzaW9uID0gMSBhcyBjb25zdDtcblxuLyoqIENvbW1pdHMgYXQgb3IgYmVsb3cgdGhpcyBzaXplIG1heSBpbmxpbmUgY29udGVudCAoYmFzZTY0KSBvbiB0aGUgV1MuICovXG5leHBvcnQgY29uc3QgSU5MSU5FX0NPTlRFTlRfTUFYX0JZVEVTID0gMjU2ICogMTAyNDtcblxuLyoqXG4gKiBPbmUgZW50cnkgb2YgdGhlIG1hbmlmZXN0IG1hcCAoYHtwYXRoIFx1MjE5MiBNYW5pZmVzdEVudHJ5fWApLiBUaGUgZW50cnkgaXNcbiAqIHNlbGYtZGVzY3JpYmluZzogaXQgY2FycmllcyBpdHMgb3duIGBwYXRoYCBhbmQgdGhlIGhlYWQncyBgY2xvY2tgIHNvIHRoZVxuICogY2xpZW50LXNpZGUgcmVjb25jaWxpYXRpb24gKGByZXNvbHZlLnRzYCkgY2FuIG9yZGVyIHJlbW90ZSBzdGF0ZSBhZ2FpbnN0XG4gKiBsb2NhbCBzdGF0ZSB3aXRob3V0IGFueSBleHRyYSByb3VuZC10cmlwcy5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBNYW5pZmVzdEVudHJ5IHtcbiAgLyoqIE5vcm1hbGl6ZWQgdmF1bHQgcGF0aCB0aGlzIGVudHJ5IGRlc2NyaWJlcyAobWlycm9ycyB0aGUgbWFwIGtleSkuICovXG4gIHBhdGg6IHN0cmluZztcbiAgLyoqIFZlcnNpb24gaWQgb2YgdGhlIGVudHJ5J3MgaGVhZC4gKi9cbiAgdmVyc2lvbjogc3RyaW5nO1xuICAvKiogc2hhMjU2IGhleCBvZiBjdXJyZW50IGNvbnRlbnQgKGAnJ2AgZm9yIGZvbGRlciBwbGFjZWhvbGRlcnMpLiAqL1xuICBoYXNoOiBzdHJpbmc7XG4gIC8qKiBDb250ZW50IHNpemUgaW4gYnl0ZXMgKGAwYCBmb3IgZm9sZGVyIHBsYWNlaG9sZGVycykuICovXG4gIHNpemU6IG51bWJlcjtcbiAgLyoqIFRvbWJzdG9uZSBmbGFnLiAqL1xuICBkZWxldGVkOiBib29sZWFuO1xuICAvKiogTG9naWNhbCBjbG9jayBvZiB0aGUgaGVhZCBcdTIwMTQgdGhlIG9yZGVyaW5nIGF1dGhvcml0eSAoXHUwMEE3NCkuICovXG4gIGNsb2NrOiBMb2dpY2FsQ2xvY2s7XG4gIC8qKiBUcnVlIGZvciBlbXB0eS1mb2xkZXIgcGxhY2Vob2xkZXIgZW50cmllcyAoRlItMTApLiAqL1xuICBpc0ZvbGRlcj86IGJvb2xlYW47XG4gIC8qKiBFcG9jaCBtcyBvZiBsYXN0IHVwZGF0ZSwgZGlzcGxheS1vbmx5LiAqL1xuICBtdGltZTogbnVtYmVyO1xufVxuXG4vLyAtLS0gQ2xpZW50IFx1MjE5MiBTZXJ2ZXIgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogQXV0aCArIGNhdGNoLXVwOiB0b2tlbiwgcHJvdG9jb2wgdmVyc2lvbiwgbGFzdCBzZWVuIERPIHNlcXVlbmNlIG51bWJlci4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSGVsbG9NZXNzYWdlIHtcbiAgdHlwZTogJ2hlbGxvJztcbiAgdG9rZW46IHN0cmluZztcbiAgcHJvdG9jb2xWZXJzaW9uOiBudW1iZXI7XG4gIC8qKiBMYXN0IHNlZW4gZ2xvYmFsIHNlcXVlbmNlIG51bWJlcjsgMCBmb3IgYSBmaXJzdC1ldmVyIGNvbm5lY3QuICovXG4gIGN1cnNvcjogbnVtYmVyO1xufVxuXG4vKiogUmVxdWVzdCBmdWxsIChgc2luY2VgIG9taXR0ZWQpIG9yIGRlbHRhIG1hbmlmZXN0LiAqL1xuZXhwb3J0IGludGVyZmFjZSBHZXRNYW5pZmVzdE1lc3NhZ2Uge1xuICB0eXBlOiAnZ2V0TWFuaWZlc3QnO1xuICBzaW5jZT86IG51bWJlcjtcbn1cblxuLyoqXG4gKiBDb21taXQgYSBuZXcgdmVyc2lvbi4gSWYgYGlubGluZWAgaXMgc2V0IGl0IGNhcnJpZXMgdGhlIGZ1bGwgY29udGVudFxuICogYmFzZTY0LWVuY29kZWQgKG9ubHkgYWxsb3dlZCB3aGVuIGBzaXplIDw9IElOTElORV9DT05URU5UX01BWF9CWVRFU2ApO1xuICogb3RoZXJ3aXNlIHRoZSBibG9iIG11c3QgYWxyZWFkeSBiZSB1cGxvYWRlZCAoYHB1dEJsb2JgIG9uIHRoaXMgY2hhbm5lbCxcbiAqIGBQVVQgL2Jsb2IvOmhhc2hgIG9uIHRoZSByZWFsIHdvcmtlcikuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ29tbWl0TWVzc2FnZSB7XG4gIHR5cGU6ICdjb21taXQnO1xuICBwYXRoOiBzdHJpbmc7XG4gIC8qKiBWZXJzaW9uIGlkIHRoZSBjb21taXQgYnVpbGRzIG9uOyBzZXJ2ZXIgZGV0ZWN0cyBkaXZlcmdlbmNlIFx1MjE5MiBjb25mbGljdC4gKi9cbiAgcGFyZW50VmVyc2lvbjogc3RyaW5nIHwgbnVsbDtcbiAgaGFzaDogc3RyaW5nO1xuICBzaXplOiBudW1iZXI7XG4gIC8qKiBXaGF0IGtpbmQgb2YgdmVyc2lvbiB0aGlzIGNvbW1pdHMgKG1pcnJvcnMgYFZlcnNpb24ua2luZGApLiAqL1xuICBraW5kOiBWZXJzaW9uS2luZDtcbiAgaW5saW5lPzogc3RyaW5nO1xuICAvKiogU291cmNlIHBhdGggXHUyMDE0IHJlcXVpcmVkIGZvciBga2luZDogJ3JlbmFtZSdgIChjaGFpbiBtaWdyYXRpb24sIEZSLTkpLiAqL1xuICBmcm9tUGF0aD86IHN0cmluZztcbiAgLyoqIFRydWUgZm9yIGVtcHR5LWZvbGRlciBwbGFjZWhvbGRlciBjb21taXRzIChGUi0xMDsgaGFzaCBgJydgLCBzaXplIDApLiAqL1xuICBpc0ZvbGRlcj86IGJvb2xlYW47XG59XG5cbi8qKiBLZWVwYWxpdmUuICovXG5leHBvcnQgaW50ZXJmYWNlIFBpbmdNZXNzYWdlIHtcbiAgdHlwZTogJ3BpbmcnO1xuICAvKiogQ2xpZW50IGVwb2NoIG1zOyBlY2hvZWQgYmFjayBvbiBgcG9uZ2AgZm9yIFJUVCAvIHNrZXcgbWVhc3VyZW1lbnQuICovXG4gIHRzPzogbnVtYmVyO1xufVxuXG4vKipcbiAqIFVwbG9hZCBhIGNvbnRlbnQgYmxvYiBvdmVyIHRoZSBzeW5jIGNoYW5uZWwuIFRlc3QgZG91YmxlcyBhbmQgc21hbGwgdmF1bHRzXG4gKiBjYW4gdXNlIHRoaXMgZGlyZWN0bHk7IHRoZSByZWFsIHdvcmtlciBleHBvc2VzIHRoZSBzYW1lIG9wZXJhdGlvbiBhc1xuICogYFBVVCAvYmxvYi86aGFzaGAgKHN0cmVhbWVkKS4gSWRlbXBvdGVudDogc2FtZSBoYXNoIFx1MjFEMiBzYW1lIGNvbnRlbnQuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUHV0QmxvYk1lc3NhZ2Uge1xuICB0eXBlOiAncHV0QmxvYic7XG4gIGhhc2g6IHN0cmluZztcbiAgLyoqIEZ1bGwgY29udGVudCwgYmFzZTY0LWVuY29kZWQuICovXG4gIGNvbnRlbnQ6IHN0cmluZztcbn1cblxuLyoqIEZldGNoIGEgY29udGVudCBibG9iICh0aGUgV1MtaW5saW5lIHBhdGggb2YgXHUwMEE3OCBcImZldGNoIGJsb2JcIikuICovXG5leHBvcnQgaW50ZXJmYWNlIEdldEJsb2JNZXNzYWdlIHtcbiAgdHlwZTogJ2dldEJsb2InO1xuICBoYXNoOiBzdHJpbmc7XG59XG5cbi8vIC0tLSBTZXJ2ZXIgXHUyMTkyIENsaWVudCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBTdWNjZXNzZnVsIGhlbGxvOiB0aGlzIGRldmljZSdzIGlkZW50aXR5ICsgdmF1bHQtbGV2ZWwgaW5mby4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSGVsbG9BY2tNZXNzYWdlIHtcbiAgdHlwZTogJ2hlbGxvQWNrJztcbiAgZGV2aWNlSWQ6IHN0cmluZztcbiAgdmF1bHROYW1lOiBzdHJpbmc7XG4gIHNldHRpbmdzOiBWYXVsdFNldHRpbmdzO1xuICAvKipcbiAgICogTG93ZXN0IGNoYW5nZS1ldmVudCBzZXF1ZW5jZSBudW1iZXIgdGhlIHNlcnZlciBzdGlsbCByZXRhaW5zIChwcm90b2NvbFxuICAgKiB2MSwgcHJlLXJlbGVhc2U7IG9wdGlvbmFsIHNvIG9sZGVyIHNlcnZlcnMgY2FuIGJlIGFuc3dlcmVkIHdpdGggYSBmdWxsXG4gICAqIG1hbmlmZXN0KS4gQSBjbGllbnQgd2hvc2UgY3Vyc29yIHNhdGlzZmllc1xuICAgKiBgb2xkZXN0UmV0YWluZWRTZXEgPD0gY3Vyc29yICsgMWAgY2FuIHJlcXVlc3QgYSBkZWx0YSBtYW5pZmVzdCBcdTIwMTQgZXZlcnlcbiAgICogZXZlbnQgYWZ0ZXIgaXRzIGN1cnNvciBpcyBzdGlsbCByZXBsYXlhYmxlLCBzbyBpdHMgaW5kZXggaXMgZ3VhcmFudGVlZFxuICAgKiB0byBvbmx5IG1pc3MgaGVhZHMgd2l0aCBgaGVhZF9zZXEgPiBjdXJzb3JgLiBBYnNlbnQgKG9yIGA+IGN1cnNvciArIDFgKVxuICAgKiBcdTIxRDIgdGhlIGNsaWVudCBtdXN0IGZhbGwgYmFjayB0byBhIGZ1bGwgbWFuaWZlc3QuXG4gICAqL1xuICBvbGRlc3RSZXRhaW5lZFNlcT86IG51bWJlcjtcbn1cblxuLyoqIFJlcGx5IHRvIGBnZXRNYW5pZmVzdGA6IHRoZSAocG9zc2libHkgZGVsdGEpIGZpbGUgaW5kZXguICovXG5leHBvcnQgaW50ZXJmYWNlIE1hbmlmZXN0TWVzc2FnZSB7XG4gIHR5cGU6ICdtYW5pZmVzdCc7XG4gIGVudHJpZXM6IFJlYWRvbmx5PFJlY29yZDxzdHJpbmcsIE1hbmlmZXN0RW50cnk+PjtcbiAgLyoqIEdsb2JhbCBzZXF1ZW5jZSBudW1iZXIgdGhpcyBtYW5pZmVzdCByZWZsZWN0cyAoY3Vyc29yIGNhdGNoLXVwKS4gKi9cbiAgY3Vyc29yOiBudW1iZXI7XG59XG5cbi8qKiBDb21taXQgYWNjZXB0ZWQgYXMgdGhlIG5ldyBoZWFkLiAqL1xuZXhwb3J0IGludGVyZmFjZSBDb21taXRBY2tNZXNzYWdlIHtcbiAgdHlwZTogJ2NvbW1pdEFjayc7XG4gIC8qKiBWZXJzaW9uIGlkIGFzc2lnbmVkIGJ5IHRoZSBhdXRob3JpdHkuICovXG4gIHZlcnNpb246IHN0cmluZztcbiAgLyoqIExvZ2ljYWwgY2xvY2sgb2YgdGhlIGFjY2VwdGVkIHZlcnNpb24uICovXG4gIGNsb2NrOiBMb2dpY2FsQ2xvY2s7XG4gIC8qKiBHbG9iYWwgc2VxdWVuY2UgbnVtYmVyIG9mIHRoZSBhY2NlcHRlZCBoZWFkIChjdXJzb3IgdHJhY2tpbmcpLiAqL1xuICBzZXE6IG51bWJlcjtcbn1cblxuLyoqIFdoYXQgaGFwcGVuZWQgdG8gdGhlIGxvc2luZyBzaWRlIG9mIGEgY29uY3VycmVudCBlZGl0IChzZWUgZGlzcG9zaXRpb24pLiAqL1xuZXhwb3J0IHR5cGUgQ29uZmxpY3RMb3NlckRpc3Bvc2l0aW9uID0gJ2NvbmZsaWN0Q29weSc7XG5cbi8qKiBDb21taXQgbG9zdCB0aGUgcmFjZTsgdGhlIHNlcnZlcidzIGNob3NlbiB3aW5uZXIgc3RhbmRzLiAqL1xuZXhwb3J0IGludGVyZmFjZSBDb25mbGljdE1lc3NhZ2Uge1xuICB0eXBlOiAnY29uZmxpY3QnO1xuICAvKiogVGhlIHdpbm5pbmcgdmVyc2lvbiAodGhpcyBjb21taXQgb3IgdGhlIGNvbmN1cnJlbnQgb25lKS4gKi9cbiAgd2lubmVyOiBWZXJzaW9uO1xuICAvKiogV2hhdCB0aGUgc2VydmVyIGRpZCB3aXRoIHRoZSBsb3NlcidzIGNvbnRlbnQgXHUyMDE0IG5ldmVyIGRlbGV0ZWQuICovXG4gIGxvc2VyRGlzcG9zaXRpb246IENvbmZsaWN0TG9zZXJEaXNwb3NpdGlvbjtcbiAgLyoqIEdsb2JhbCBzZXF1ZW5jZSBudW1iZXIgb2YgdGhlIHdpbm5pbmcgaGVhZCwgd2hlbiBpdCBoYXMgb25lLiAqL1xuICBzZXE/OiBudW1iZXI7XG59XG5cbi8qKlxuICogRmFuLW91dCBwYXlsb2FkIHNoYXJlZCBieSB0aGUgY2hhbmdlIGJyb2FkY2FzdCBhbmQgdGhlIGFyYml0cmF0aW9uIHJlc3VsdC5cbiAqIEV2ZXJ5dGhpbmcgYSBjbGllbnQgbmVlZHMgdG8gbWF0ZXJpYWxpemUgb25lIGhlYWQgdHJhbnNpdGlvbi5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBDaGFuZ2VQYXlsb2FkIHtcbiAgcGF0aDogc3RyaW5nO1xuICAvKiogVmVyc2lvbiBpZCBvZiB0aGUgbmV3IGhlYWQuICovXG4gIHZlcnNpb246IHN0cmluZztcbiAgaGFzaDogc3RyaW5nO1xuICBzaXplOiBudW1iZXI7XG4gIGRlbGV0ZWQ6IGJvb2xlYW47XG4gIC8qKiBJZCBvZiB0aGUgZGV2aWNlIHRoYXQgY29tbWl0dGVkLiAqL1xuICBkZXZpY2U6IHN0cmluZztcbiAgLyoqIExvZ2ljYWwgY2xvY2sgb2YgdGhlIG5ldyBoZWFkIFx1MjAxNCBjbGllbnRzIHVzZSBpdCB0byBza2lwIHN0YWxlIHJlcGxheXMuICovXG4gIGNsb2NrOiBMb2dpY2FsQ2xvY2s7XG4gIC8qKiBXaGF0IGtpbmQgb2YgY2hhbmdlIHRoaXMgaXMgKG1pcnJvcnMgYFZlcnNpb24ua2luZGApLiAqL1xuICBraW5kOiBWZXJzaW9uS2luZDtcbiAgLyoqIFNvdXJjZSBwYXRoIFx1MjAxNCBwcmVzZW50IHdoZW4gYGtpbmQ6ICdyZW5hbWUnYC4gKi9cbiAgZnJvbVBhdGg/OiBzdHJpbmc7XG4gIC8qKiBUcnVlIGZvciBmb2xkZXIgcGxhY2Vob2xkZXIgY2hhbmdlcyAoRlItMTApLiAqL1xuICBpc0ZvbGRlcj86IGJvb2xlYW47XG59XG5cbi8qKiBGYW4tb3V0IGJyb2FkY2FzdCB0byBhbGwgKm90aGVyKiBjb25uZWN0ZWQgY2xpZW50cy4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ2hhbmdlTWVzc2FnZSBleHRlbmRzIENoYW5nZVBheWxvYWQge1xuICB0eXBlOiAnY2hhbmdlJztcbiAgLyoqIEdsb2JhbCBzZXF1ZW5jZSBudW1iZXIgb2YgdGhpcyBjaGFuZ2UgKGN1cnNvciB0cmFja2luZykuICovXG4gIHNlcTogbnVtYmVyO1xufVxuXG4vKiogUmVwbHkgdG8gYHB1dEJsb2JgLiAqL1xuZXhwb3J0IGludGVyZmFjZSBCbG9iQWNrTWVzc2FnZSB7XG4gIHR5cGU6ICdibG9iQWNrJztcbiAgaGFzaDogc3RyaW5nO1xufVxuXG4vKiogUmVwbHkgdG8gYGdldEJsb2JgOiB0aGUgcmVxdWVzdGVkIGNvbnRlbnQuICovXG5leHBvcnQgaW50ZXJmYWNlIEJsb2JNZXNzYWdlIHtcbiAgdHlwZTogJ2Jsb2InO1xuICBoYXNoOiBzdHJpbmc7XG4gIC8qKiBGdWxsIGNvbnRlbnQsIGJhc2U2NC1lbmNvZGVkLiAqL1xuICBjb250ZW50OiBzdHJpbmc7XG59XG5cbi8qKiBNYWNoaW5lLXJlYWRhYmxlIGNvZGVzIGNhcnJpZWQgYnkgYGVycm9yYCBtZXNzYWdlcyAoSFRUUC1lcXVpdmFsZW50KS4gKi9cbmV4cG9ydCB0eXBlIFNlcnZlckVycm9yQ29kZSA9ICdVTkFVVEhPUklaRUQnIHwgJ1JFVk9LRUQnIHwgJ05PVF9GT1VORCcgfCAnUFJPVE9DT0wnO1xuXG4vKiogTmVnYXRpdmUgcmVwbHkgKGF1dGggZmFpbHVyZSwgdW5rbm93biBibG9iLCBwcm90b2NvbCB2aW9sYXRpb24sIFx1MjAyNikuICovXG5leHBvcnQgaW50ZXJmYWNlIEVycm9yTWVzc2FnZSB7XG4gIHR5cGU6ICdlcnJvcic7XG4gIGNvZGU6IFNlcnZlckVycm9yQ29kZTtcbiAgbWVzc2FnZTogc3RyaW5nO1xufVxuXG4vKiogUHJlc2VuY2UgdXBkYXRlIGZvciBkYXNoYm9hcmRzIC8gYHZzYSBzdGF0dXNgLiAqL1xuZXhwb3J0IGludGVyZmFjZSBEZXZpY2VTZWVuTWVzc2FnZSB7XG4gIHR5cGU6ICdkZXZpY2VTZWVuJztcbiAgZGV2aWNlSWQ6IHN0cmluZztcbiAgdHM6IG51bWJlcjtcbn1cblxuLyoqIEtlZXBhbGl2ZSByZXBseS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUG9uZ01lc3NhZ2Uge1xuICB0eXBlOiAncG9uZyc7XG4gIC8qKiBFY2hvZXMgdGhlIGBwaW5nYCB0cyB3aGVuIG9uZSB3YXMgcHJvdmlkZWQuICovXG4gIHRzPzogbnVtYmVyO1xufVxuXG4vLyAtLS0gVW5pb24gKyBndWFyZHMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCB0eXBlIENsaWVudE1lc3NhZ2UgPVxuICB8IEhlbGxvTWVzc2FnZVxuICB8IEdldE1hbmlmZXN0TWVzc2FnZVxuICB8IENvbW1pdE1lc3NhZ2VcbiAgfCBQdXRCbG9iTWVzc2FnZVxuICB8IEdldEJsb2JNZXNzYWdlXG4gIHwgUGluZ01lc3NhZ2U7XG5cbmV4cG9ydCB0eXBlIFNlcnZlck1lc3NhZ2UgPVxuICB8IEhlbGxvQWNrTWVzc2FnZVxuICB8IE1hbmlmZXN0TWVzc2FnZVxuICB8IENvbW1pdEFja01lc3NhZ2VcbiAgfCBDb25mbGljdE1lc3NhZ2VcbiAgfCBDaGFuZ2VNZXNzYWdlXG4gIHwgRGV2aWNlU2Vlbk1lc3NhZ2VcbiAgfCBCbG9iQWNrTWVzc2FnZVxuICB8IEJsb2JNZXNzYWdlXG4gIHwgRXJyb3JNZXNzYWdlXG4gIHwgUG9uZ01lc3NhZ2U7XG5cbmV4cG9ydCB0eXBlIE1lc3NhZ2UgPSBDbGllbnRNZXNzYWdlIHwgU2VydmVyTWVzc2FnZTtcblxuY29uc3QgQ0xJRU5UX1RZUEVTOiBSZWFkb25seVNldDxzdHJpbmc+ID0gbmV3IFNldChbXG4gICdoZWxsbycsXG4gICdnZXRNYW5pZmVzdCcsXG4gICdjb21taXQnLFxuICAncHV0QmxvYicsXG4gICdnZXRCbG9iJyxcbiAgJ3BpbmcnLFxuXSk7XG5jb25zdCBTRVJWRVJfVFlQRVM6IFJlYWRvbmx5U2V0PHN0cmluZz4gPSBuZXcgU2V0KFtcbiAgJ2hlbGxvQWNrJyxcbiAgJ21hbmlmZXN0JyxcbiAgJ2NvbW1pdEFjaycsXG4gICdjb25mbGljdCcsXG4gICdjaGFuZ2UnLFxuICAnZGV2aWNlU2VlbicsXG4gICdibG9iQWNrJyxcbiAgJ2Jsb2InLFxuICAnZXJyb3InLFxuICAncG9uZycsXG5dKTtcblxuLyoqXG4gKiBSdW50aW1lIHNoYXBlIGNoZWNrOiBhIHZhbHVlIGlzIGEgYE1lc3NhZ2VgIGlmZiBpdCBpcyBhbiBvYmplY3Qgd2hvc2VcbiAqIGB0eXBlYCBpcyBhIGtub3duIG1lc3NhZ2UgdHlwZS4gRmllbGQtbGV2ZWwgdmFsaWRhdGlvbiBoYXBwZW5zIHdoZXJlIGFcbiAqIG1lc3NhZ2UgaXMgYWN0ZWQgdXBvbiAobGF0ZXIgcGhhc2VzKTsgdGhlIGd1YXJkIGlzIGRlbGliZXJhdGVseSBjaGVhcCBzb1xuICogYm90aCBXUyBlbmRzIGNhbiB0cmlhZ2UgdW5rbm93bi9mb3J3YXJkLWNvbXBhdGlibGUgdHlwZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc01lc3NhZ2UodmFsdWU6IHVua25vd24pOiB2YWx1ZSBpcyBNZXNzYWdlIHtcbiAgcmV0dXJuIChcbiAgICB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmXG4gICAgdmFsdWUgIT09IG51bGwgJiZcbiAgICB0eXBlb2YgKHZhbHVlIGFzIHsgdHlwZT86IHVua25vd24gfSkudHlwZSA9PT0gJ3N0cmluZycgJiZcbiAgICAoQ0xJRU5UX1RZUEVTLmhhcygodmFsdWUgYXMgeyB0eXBlOiBzdHJpbmcgfSkudHlwZSkgfHxcbiAgICAgIFNFUlZFUl9UWVBFUy5oYXMoKHZhbHVlIGFzIHsgdHlwZTogc3RyaW5nIH0pLnR5cGUpKVxuICApO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaXNDbGllbnRNZXNzYWdlKHZhbHVlOiB1bmtub3duKTogdmFsdWUgaXMgQ2xpZW50TWVzc2FnZSB7XG4gIHJldHVybiAoXG4gICAgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJlxuICAgIHZhbHVlICE9PSBudWxsICYmXG4gICAgQ0xJRU5UX1RZUEVTLmhhcygodmFsdWUgYXMgeyB0eXBlPzogdW5rbm93biB9KS50eXBlIGFzIHN0cmluZylcbiAgKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGlzU2VydmVyTWVzc2FnZSh2YWx1ZTogdW5rbm93bik6IHZhbHVlIGlzIFNlcnZlck1lc3NhZ2Uge1xuICByZXR1cm4gKFxuICAgIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiZcbiAgICB2YWx1ZSAhPT0gbnVsbCAmJlxuICAgIFNFUlZFUl9UWVBFUy5oYXMoKHZhbHVlIGFzIHsgdHlwZT86IHVua25vd24gfSkudHlwZSBhcyBzdHJpbmcpXG4gICk7XG59XG5cbi8qKlxuICogUGFyc2UgYSBXUyB0ZXh0IGZyYW1lIGludG8gYSB0eXBlZCBgTWVzc2FnZWAuXG4gKiBUaHJvd3MgYFByb3RvY29sRXJyb3JgIG9uIG5vbi1KU09OIGlucHV0IG9yIHVua25vd24gbWVzc2FnZSB0eXBlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlTWVzc2FnZShkYXRhOiBzdHJpbmcpOiBNZXNzYWdlIHtcbiAgbGV0IHBhcnNlZDogdW5rbm93bjtcbiAgdHJ5IHtcbiAgICBwYXJzZWQgPSBKU09OLnBhcnNlKGRhdGEpO1xuICB9IGNhdGNoIChjYXVzZSkge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKGBNZXNzYWdlIGlzIG5vdCB2YWxpZCBKU09OOiAke1N0cmluZyhkYXRhKS5zbGljZSgwLCAyMDApfWAsIHsgY2F1c2UgfSk7XG4gIH1cbiAgaWYgKCFpc01lc3NhZ2UocGFyc2VkKSkge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKFxuICAgICAgYFVua25vd24gb3IgbWFsZm9ybWVkIG1lc3NhZ2UgdHlwZTogJHtKU09OLnN0cmluZ2lmeSgocGFyc2VkIGFzIHsgdHlwZT86IHVua25vd24gfSk/LnR5cGUpfWAsXG4gICAgKTtcbiAgfVxuICByZXR1cm4gcGFyc2VkO1xufVxuXG4vLyAtLS0gd2lyZSBlbmNvZGluZyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vXG4vLyBgaW5saW5lYC9gY29udGVudGAgZmllbGRzIGNhcnJ5IHJhdyBieXRlcyBhcyBiYXNlNjQuIGBidG9hYC9gYXRvYmAgZXhpc3QgaW5cbi8vIGV2ZXJ5IHRhcmdldCBydW50aW1lIChXb3JrZXJzLCBOb2RlIDE2KywgRWxlY3Ryb24pOyBjaHVua2luZyBhdm9pZHNcbi8vIGV4Y2VlZGluZyBhcmd1bWVudC1sZW5ndGggbGltaXRzIG9uIGxhcmdlIGF0dGFjaG1lbnRzLlxuXG4vKiogRW5jb2RlIGJ5dGVzIGFzIGJhc2U2NC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBieXRlc1RvQmFzZTY0KGJ5dGVzOiBVaW50OEFycmF5KTogc3RyaW5nIHtcbiAgbGV0IGJpbmFyeSA9ICcnO1xuICBjb25zdCBDSFVOSyA9IDB4ODAwMDtcbiAgZm9yIChsZXQgb2Zmc2V0ID0gMDsgb2Zmc2V0IDwgYnl0ZXMubGVuZ3RoOyBvZmZzZXQgKz0gQ0hVTkspIHtcbiAgICBiaW5hcnkgKz0gU3RyaW5nLmZyb21DaGFyQ29kZSguLi5ieXRlcy5zdWJhcnJheShvZmZzZXQsIG9mZnNldCArIENIVU5LKSk7XG4gIH1cbiAgcmV0dXJuIGJ0b2EoYmluYXJ5KTtcbn1cblxuLyoqIERlY29kZSBiYXNlNjQgdG8gYnl0ZXMuIFRocm93cyBgUHJvdG9jb2xFcnJvcmAgb24gaW52YWxpZCBpbnB1dC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBiYXNlNjRUb0J5dGVzKGVuY29kZWQ6IHN0cmluZyk6IFVpbnQ4QXJyYXkge1xuICBsZXQgYmluYXJ5OiBzdHJpbmc7XG4gIHRyeSB7XG4gICAgYmluYXJ5ID0gYXRvYihlbmNvZGVkKTtcbiAgfSBjYXRjaCAoY2F1c2UpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcignQmFzZTY0IHBheWxvYWQgaXMgbm90IHZhbGlkJywgeyBjYXVzZSB9KTtcbiAgfVxuICBjb25zdCBieXRlcyA9IG5ldyBVaW50OEFycmF5KGJpbmFyeS5sZW5ndGgpO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGJpbmFyeS5sZW5ndGg7IGkrKykgYnl0ZXNbaV0gPSBiaW5hcnkuY2hhckNvZGVBdChpKTtcbiAgcmV0dXJuIGJ5dGVzO1xufVxuIiwgIi8qKlxuICogQ29uZmxpY3QtY29weSBmaWxlIG5hbWluZyAoQVJDSElURUNUVVJFLm1kIFx1MDBBNzQsIEZSLTYpLlxuICpcbiAqIFdoZW4gYSBkZXZpY2UgbG9zZXMgYSBjb25mbGljdCBidXQgaXRzIGNvbnRlbnQgbXVzdCBiZSBwcmVzZXJ2ZWQsIHRoZVxuICogY29udGVudCBpcyBjb21taXR0ZWQgdG8gYSBzaWJsaW5nIFwiY29uZmxpY3QgY29weVwiIHBhdGggc2hhcGVkIGxpa2U6XG4gKlxuICogICAgIE5vdGUgKGNvbmZsaWN0IDIwMjYtMDgtMjAgMTQtMjMgLSBmcm9tIFBob25lKS5tZFxuICogICAgIFx1MjUxNFx1MjUwMCBzdGVtIFx1MjUwMFx1MjUxOFx1MjUxNFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMCBVVEMgZGF0ZSArIEhILW1tIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUxOFx1MjUxNCBkZXZpY2UgXHUyNTE4XHUyNTE0ZXh0XHUyNTE4XG4gKlxuICogUnVsZXM6XG4gKiAgIC0gdGltZXN0YW1wIGlzIGFsd2F5cyBVVEMgKG5ldmVyIGEgbG9jYWwgdGltZXpvbmUpIHNvIGV2ZXJ5IGNsaWVudFxuICogICAgIGNvbXB1dGVzIHRoZSBpZGVudGljYWwgbmFtZSBmcm9tIHRoZSBzYW1lIGNvbW1pdCB0aW1lO1xuICogICAtIHRoZSBkZXZpY2UgbmFtZSBpcyBzYW5pdGl6ZWQgZm9yIGZpbGVzeXN0ZW0gc2FmZXR5IChzZWVcbiAqICAgICBgc2FuaXRpemVEZXZpY2VOYW1lYCk7XG4gKiAgIC0gdGhlIG9yaWdpbmFsIGV4dGVuc2lvbiBpcyBwcmVzZXJ2ZWQgKGxhc3QgZG90IGluIHRoZSBiYXNlbmFtZSwgYXMgbG9uZ1xuICogICAgIGFzIGl0IGlzIG5vdCB0aGUgZmlyc3QgY2hhcmFjdGVyIFx1MjAxNCBgLmdpdGlnbm9yZWAgaGFzIG5vIGV4dGVuc2lvbik7XG4gKiAgIC0gaWYgdGhlIGNhbmRpZGF0ZSBhbHJlYWR5IGV4aXN0cyAoaW4gdGhlIGxvY2FsIGluZGV4IG9yIHRoZSByZW1vdGVcbiAqICAgICBtYW5pZmVzdCBcdTIwMTQgdGhlIGNhbGxlciBzdXBwbGllcyB0aGUgYGV4aXN0c2AgcHJlZGljYXRlKSwgYCAyYCwgYCAzYCwgXHUyMDI2XG4gKiAgICAgaXMgYXBwZW5kZWQgYmVmb3JlIHRoZSBleHRlbnNpb24uXG4gKi9cblxuaW1wb3J0IHsgYmFzZW5hbWUsIG5vcm1hbGl6ZVZhdWx0UGF0aCwgcGFyZW50UGF0aCB9IGZyb20gJy4vcGF0aHMuanMnO1xuXG4vKiogQ2hhcmFjdGVycyBmb3JiaWRkZW4gb24gYXQgbGVhc3Qgb25lIHN1cHBvcnRlZCBwbGF0Zm9ybS4gKi9cbmNvbnN0IElMTEVHQUxfRklMRU5BTUVfQ0hBUlMgPSAvWzw+OlwiL1xcXFx8PypdL2c7XG4vKiogQzAgY29udHJvbHMgKyBERUwgXHUyMDE0IG5ldmVyIHZhbGlkIGluIGZpbGVuYW1lcy4gKi9cbmNvbnN0IENPTlRST0xfQ0hBUlMgPSAvW1xceDAwLVxceDFmXFx4N2ZdL2c7XG5cbi8qKiBNYXggbGVuZ3RoIChpbiBjb2RlIHBvaW50cykgb2YgYSBzYW5pdGl6ZWQgZGV2aWNlIG5hbWUuICovXG5jb25zdCBNQVhfREVWSUNFX05BTUVfTEVOR1RIID0gMzA7XG5cbi8qKiBGYWxsYmFjayB3aGVuIGEgZGV2aWNlIG5hbWUgc2FuaXRpemVzIHRvIG5vdGhpbmcuICovXG5jb25zdCBGQUxMQkFDS19ERVZJQ0VfTkFNRSA9ICd1bmtub3duJztcblxuLyoqIEhpZ2hlc3QgYCBOYCBzdWZmaXggdHJpZWQgYmVmb3JlIGdpdmluZyB1cC4gKi9cbmNvbnN0IE1BWF9DT0xMSVNJT05fU1VGRklYID0gOTk5O1xuXG4vKipcbiAqIFNhbml0aXplIGEgZGV2aWNlIG5hbWUgZm9yIHVzZSBpbnNpZGUgYSBmaWxlbmFtZTogc3RyaXAgYDw+OlwiL1xcXFx8PypgIGFuZFxuICogY29udHJvbCBjaGFyYWN0ZXJzLCB0cmltIHdoaXRlc3BhY2UgYW5kIGVkZ2UgZG90cyAoV2luZG93cyBzZWdtZW50cyBtYXlcbiAqIG5vdCBlbmQgd2l0aCBgLmAgb3Igd2hpdGVzcGFjZSksIHRydW5jYXRlIHRvIDMwIGNvZGUgcG9pbnRzIChuZXZlciBzcGxpdHNcbiAqIGEgc3Vycm9nYXRlIHBhaXIpLiBSZXR1cm5zIGAndW5rbm93bidgIHdoZW4gbm90aGluZyBzdXJ2aXZlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNhbml0aXplRGV2aWNlTmFtZShuYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICBsZXQgY2xlYW5lZCA9IG5hbWUucmVwbGFjZShJTExFR0FMX0ZJTEVOQU1FX0NIQVJTLCAnJykucmVwbGFjZShDT05UUk9MX0NIQVJTLCAnJyk7XG4gIGNsZWFuZWQgPSBbLi4uY2xlYW5lZF0uc2xpY2UoMCwgTUFYX0RFVklDRV9OQU1FX0xFTkdUSCkuam9pbignJyk7XG4gIGNsZWFuZWQgPSBjbGVhbmVkLnRyaW0oKS5yZXBsYWNlKC9eWy5cXHNdK3xbLlxcc10rJC9nLCAnJyk7XG4gIHJldHVybiBjbGVhbmVkLmxlbmd0aCA9PT0gMCA/IEZBTExCQUNLX0RFVklDRV9OQU1FIDogY2xlYW5lZDtcbn1cblxuLyoqXG4gKiBDb21wdXRlIHRoZSBjb25mbGljdC1jb3B5IHBhdGggZm9yIGBwYXRoYC5cbiAqXG4gKiBQdXJlIGFuZCBkZXRlcm1pbmlzdGljOiB0aGUgc2FtZSBgKHBhdGgsIGRldmljZU5hbWUsIG5vdywgZXhpc3RzKWAgYWx3YXlzXG4gKiB5aWVsZHMgdGhlIHNhbWUgcmVzdWx0LiBgbm93YCBpcyB0aGUgY29uZmxpY3QncyBlcG9jaC1tcyB0aW1lc3RhbXAgKHRoZVxuICogY2FsbGVyIHBhc3NlcyBpdCBpbiBcdTIwMTQgbm8gaGlkZGVuIGNsb2Nrcyk7IGBleGlzdHNgIGlzIGNvbnN1bHRlZCBmb3JcbiAqIGNvbGxpc2lvbiBhdm9pZGFuY2UgYW5kIHR5cGljYWxseSBjaGVja3MgdGhlIGxvY2FsIGluZGV4IHBsdXMgdGhlIHJlbW90ZVxuICogbWFuaWZlc3QuXG4gKlxuICogVGhyb3dzIHdoZW4gbW9yZSB0aGFuIGBNQVhfQ09MTElTSU9OX1NVRkZJWGAgbmFtZSBjb2xsaXNpb25zIG9jY3VyIChhXG4gKiBnZW51aW5lbHkgcGF0aG9sb2dpY2FsIHZhdWx0IHN0YXRlIHRoZSBjYWxsZXIgc2hvdWxkIHN1cmZhY2UsIG5vdCBwYXBlclxuICogb3ZlcikuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb25mbGljdENvcHlQYXRoKFxuICBwYXRoOiBzdHJpbmcsXG4gIGRldmljZU5hbWU6IHN0cmluZyxcbiAgbm93OiBudW1iZXIsXG4gIGV4aXN0czogKGNhbmRpZGF0ZVBhdGg6IHN0cmluZykgPT4gYm9vbGVhbiA9ICgpID0+IGZhbHNlLFxuKTogc3RyaW5nIHtcbiAgY29uc3Qgbm9ybWFsaXplZCA9IG5vcm1hbGl6ZVZhdWx0UGF0aChwYXRoKTtcbiAgY29uc3QgZGlyID0gcGFyZW50UGF0aChub3JtYWxpemVkKTtcbiAgY29uc3QgbmFtZSA9IGJhc2VuYW1lKG5vcm1hbGl6ZWQpO1xuXG4gIGNvbnN0IGxhc3REb3QgPSBuYW1lLmxhc3RJbmRleE9mKCcuJyk7XG4gIGNvbnN0IGhhc0V4dGVuc2lvbiA9IGxhc3REb3QgPiAwOyAvLyBhIGxlYWRpbmcgZG90IG1hcmtzIGEgZG90ZmlsZSwgbm90IGFuIGV4dGVuc2lvblxuICBjb25zdCBzdGVtID0gaGFzRXh0ZW5zaW9uID8gbmFtZS5zbGljZSgwLCBsYXN0RG90KSA6IG5hbWU7XG4gIGNvbnN0IGV4dGVuc2lvbiA9IGhhc0V4dGVuc2lvbiA/IG5hbWUuc2xpY2UobGFzdERvdCkgOiAnJztcblxuICBjb25zdCBzdWZmaXggPSBgIChjb25mbGljdCAke2Zvcm1hdENvbmZsaWN0U3RhbXAobm93KX0gLSBmcm9tICR7c2FuaXRpemVEZXZpY2VOYW1lKGRldmljZU5hbWUpfSlgO1xuICBjb25zdCBqb2luID0gKGZpbGVOYW1lOiBzdHJpbmcpOiBzdHJpbmcgPT4gKGRpciA9PT0gJy8nID8gYC8ke2ZpbGVOYW1lfWAgOiBgJHtkaXJ9LyR7ZmlsZU5hbWV9YCk7XG5cbiAgbGV0IGNhbmRpZGF0ZSA9IGpvaW4oYCR7c3RlbX0ke3N1ZmZpeH0ke2V4dGVuc2lvbn1gKTtcbiAgZm9yIChsZXQgbiA9IDI7IG4gPD0gTUFYX0NPTExJU0lPTl9TVUZGSVg7IG4rKykge1xuICAgIGlmICghZXhpc3RzKGNhbmRpZGF0ZSkpIHJldHVybiBjYW5kaWRhdGU7XG4gICAgY2FuZGlkYXRlID0gam9pbihgJHtzdGVtfSR7c3VmZml4fSAke259JHtleHRlbnNpb259YCk7XG4gIH1cbiAgdGhyb3cgbmV3IEVycm9yKFxuICAgIGBjb25mbGljdENvcHlQYXRoOiBtb3JlIHRoYW4gJHtNQVhfQ09MTElTSU9OX1NVRkZJWH0gY29sbGlzaW9ucyBmb3IgJHtKU09OLnN0cmluZ2lmeShub3JtYWxpemVkKX1gLFxuICApO1xufVxuXG4vKiogYDIwMjYtMDgtMjAgMTQtMjNgIFx1MjAxNCBVVEMgZGF0ZSwgc3BhY2UsIHplcm8tcGFkZGVkIEhILW1tLiBNaW51dGVzLCBub3Qgc2Vjb25kcy4gKi9cbmZ1bmN0aW9uIGZvcm1hdENvbmZsaWN0U3RhbXAobm93OiBudW1iZXIpOiBzdHJpbmcge1xuICBjb25zdCBkID0gbmV3IERhdGUobm93KTtcbiAgY29uc3QgcGFkID0gKG46IG51bWJlcik6IHN0cmluZyA9PiBTdHJpbmcobikucGFkU3RhcnQoMiwgJzAnKTtcbiAgcmV0dXJuIChcbiAgICBgJHtkLmdldFVUQ0Z1bGxZZWFyKCl9LSR7cGFkKGQuZ2V0VVRDTW9udGgoKSArIDEpfS0ke3BhZChkLmdldFVUQ0RhdGUoKSl9YCArXG4gICAgYCAke3BhZChkLmdldFVUQ0hvdXJzKCkpfS0ke3BhZChkLmdldFVUQ01pbnV0ZXMoKSl9YFxuICApO1xufVxuIiwgIi8qKlxuICogVGhyZWUtd2F5IHJlY29uY2lsaWF0aW9uIChBUkNISVRFQ1RVUkUubWQgXHUwMEE3OCBzdGVwIDQpLlxuICpcbiAqIGBjb21wdXRlU3luY1BsYW5gIGlzIGEgUFVSRSwgREVURVJNSU5JU1RJQyBmdW5jdGlvbjogdGhlIHNhbWUgaW5wdXRzIGFsd2F5c1xuICogcHJvZHVjZSB0aGUgc2FtZSBwbGFuIChtYW5pZmVzdCBhbmQgY2hhbmdlIGJ1Y2tldHMgYXJlIHJlLXNvcnRlZFxuICogaW50ZXJuYWxseTsgYG5vd2AgaXMgYSBwYXJhbWV0ZXIsIG5ldmVyIHJlYWQgZnJvbSBhIGNsb2NrKS4gSXQgY29tcGFyZXNcbiAqIHRocmVlIHN0YXRlcyBmb3IgZXZlcnkgcGF0aDpcbiAqXG4gKiAgIC0gdGhlICoqbG9jYWwgaW5kZXgqKiBcdTIwMTQgd2hhdCB0aGlzIGRldmljZSBsYXN0IGtuZXcgYXMgYXV0aG9yaXRhdGl2ZVxuICogICAgICh0aGUgXCJjb21tb24gYW5jZXN0b3JcIiBvZiB0aGUgdGhyZWUtd2F5IG1lcmdlKTtcbiAqICAgLSB0aGUgKipsb2NhbCBjaGFuZ2VzKiogXHUyMDE0IGhvdyBsb2NhbCBzdG9yYWdlIGRpdmVyZ2VkIGZyb20gdGhlIGluZGV4XG4gKiAgICAgd2hpbGUgb2ZmbGluZSAoYHNjYW4udHNgIG91dHB1dCk7XG4gKiAgIC0gdGhlICoqbWFuaWZlc3QqKiBcdTIwMTQgdGhlIGF1dGhvcml0eSdzIGN1cnJlbnQgaGVhZCBwZXIgcGF0aC5cbiAqXG4gKiBhbmQgZW1pdHMgYSBgU3luY1BsYW5gIChzaGFwZSBkb2N1bWVudGVkIG9uIHRoZSBpbnRlcmZhY2UpOiBvcHMgdG8gcHVzaCxcbiAqIG9wcyB0byBwdWxsLCBjb25mbGljdCByZXNvbHV0aW9ucywgYW5kIGZvbGRlciBwbGFjZWhvbGRlcnMgdG8gcHVzaC5cbiAqXG4gKiBDb25mbGljdCBhcmJpdHJhdGlvbiBtaXJyb3JzIHRoZSBETydzIHJ1bGUgKFx1MDBBNzQpOiB3aW5uZXIgPSBoaWdoZXIgbG9naWNhbFxuICogY2xvY2s7IHRpZSBcdTIxOTIgZ3JlYXRlciBkZXZpY2VJZC4gVGhlIGxvY2FsIHNpZGUncyAqdGVudGF0aXZlKiBjbG9jayBpc1xuICogYG5leHRDbG9jayhpbmRleCBjbG9jaywgdGhpc0RldmljZUlkKWAgXHUyMDE0IGV4YWN0bHkgdGhlIGNvdW50ZXIgdGhlIERPIHdvdWxkXG4gKiBhc3NpZ24gYSBjb21taXQgYnVpbGRpbmcgb24gdGhlIHNhbWUgcGFyZW50LCBzbyB0aGUgY2xpZW50J3MgcHJlZGljdGlvblxuICogbWF0Y2hlcyB0aGUgc2VydmVyJ3MgYXJiaXRyYXRpb24uIFdoZW4gdGhlIHJlbW90ZSBzaWRlIHdpbnMsIHRoZSBsb3NpbmdcbiAqIGxvY2FsIGNvbnRlbnQgaXMgcHJlc2VydmVkIGJ5IHB1c2hpbmcgaXQgdG8gYSBjb25mbGljdC1jb3B5IHBhdGhcbiAqIChgY29uZmxpY3RuYW1lcy50c2ApOyB3aGVuIHRoZSBsb2NhbCBzaWRlIHdpbnMsIHRoZSBjbGllbnQgc2ltcGx5IGNvbW1pdHNcbiAqIHdpdGggaXRzIChub3cgc3RhbGUpIHBhcmVudCB2ZXJzaW9uIGFuZCBsZXRzIHRoZSBzZXJ2ZXIgYXJiaXRyYXRlIFx1MjAxNCB0aGVcbiAqIHNlcnZlciBzeW50aGVzaXplcyBhbnkgY29uZmxpY3QgY29weSBmb3IgdGhlIGxvc2luZyByZW1vdGUgY29udGVudCwgd2hpY2hcbiAqIGFycml2ZXMgbGF0ZXIgYXMgYW4gb3JkaW5hcnkgY2hhbmdlIGV2ZW50LlxuICovXG5cbmltcG9ydCB7IGNvbXBhcmVDbG9ja3MsIG5leHRDbG9jayB9IGZyb20gJy4vY2xvY2suanMnO1xuaW1wb3J0IHsgY29uZmxpY3RDb3B5UGF0aCB9IGZyb20gJy4vY29uZmxpY3RuYW1lcy5qcyc7XG5pbXBvcnQgdHlwZSB7IExvY2FsSW5kZXgsIExvY2FsSW5kZXhFbnRyeSB9IGZyb20gJy4vbG9jYWxpbmRleC5qcyc7XG5pbXBvcnQgeyBwYXJlbnRQYXRoIH0gZnJvbSAnLi9wYXRocy5qcyc7XG5pbXBvcnQgdHlwZSB7IE1hbmlmZXN0RW50cnkgfSBmcm9tICcuL3Byb3RvY29sLmpzJztcbmltcG9ydCB0eXBlIHsgRGVsZXRlZENhbmRpZGF0ZSwgTG9jYWxDaGFuZ2VzLCBSZW5hbWVDYW5kaWRhdGUsIFNjYW5DYW5kaWRhdGUgfSBmcm9tICcuL3NjYW4uanMnO1xuaW1wb3J0IHR5cGUgeyBMb2dpY2FsQ2xvY2sgfSBmcm9tICcuL3R5cGVzLmpzJztcblxuLyoqXG4gKiBBIG1hbmlmZXN0IGVudHJ5IGFzIHJlY29uY2lsaWF0aW9uIGNvbnN1bWVzIGl0LiBTaW5jZSBgTWFuaWZlc3RFbnRyeWAgZ3Jld1xuICogYHBhdGhgLCBgY2xvY2tgLCBhbmQgYGlzRm9sZGVyYCAocHJvdG9jb2wgdjEsIHByZS1yZWxlYXNlKSwgdGhpcyBpcyBub3cgdGhlXG4gKiBtYW5pZmVzdCBlbnRyeSBpdHNlbGYgXHUyMDE0IGtlcHQgYXMgYSBuYW1lZCBhbGlhcyBzbyBgY29tcHV0ZVN5bmNQbGFuYCdzIGlucHV0XG4gKiBjb250cmFjdCBzdGF5cyBzZWxmLWRvY3VtZW50aW5nLlxuICovXG5leHBvcnQgdHlwZSBSZW1vdGVGaWxlID0gTWFuaWZlc3RFbnRyeTtcblxuLyoqIElucHV0IHRvIGBjb21wdXRlU3luY1BsYW5gLiAqL1xuZXhwb3J0IGludGVyZmFjZSBTeW5jUGxhbklucHV0IHtcbiAgbG9jYWxDaGFuZ2VzOiBMb2NhbENoYW5nZXM7XG4gIGluZGV4OiBMb2NhbEluZGV4O1xuICBtYW5pZmVzdDogcmVhZG9ubHkgUmVtb3RlRmlsZVtdO1xuICB0aGlzRGV2aWNlSWQ6IHN0cmluZztcbiAgLyoqIEh1bWFuLXJlYWRhYmxlIG5hbWUgb2YgdGhpcyBkZXZpY2UgXHUyMDE0IHVzZWQgaW4gY29uZmxpY3QtY29weSBmaWxlIG5hbWVzLiAqL1xuICB0aGlzRGV2aWNlTmFtZTogc3RyaW5nO1xuICAvKiogRXBvY2ggbXMgdXNlZCBmb3IgY29uZmxpY3QtY29weSB0aW1lc3RhbXBzIChwYXNzZWQgaW4gZm9yIGRldGVybWluaXNtKS4gKi9cbiAgbm93OiBudW1iZXI7XG59XG5cbi8qKiBXaHkgYSBwYXRoIHdlbnQgdGhyb3VnaCBjb25mbGljdCByZXNvbHV0aW9uLiAqL1xuZXhwb3J0IHR5cGUgQ29uZmxpY3RSZWFzb24gPSAnY29uY3VycmVudC1lZGl0JyB8ICdhZGQtdnMtYWRkJyB8ICdkZWxldGUtdnMtZWRpdCcgfCAncmVuYW1lLXJhY2UnO1xuXG4vKipcbiAqIEEgY29tbWl0IHRoaXMgZGV2aWNlIHNob3VsZCBzZW5kIChwYXlsb2FkIG9mIGEgcHJvdG9jb2wgYGNvbW1pdGAgbWVzc2FnZSkuXG4gKlxuICogYHBhcmVudFZlcnNpb25gIHNlbWFudGljczpcbiAqICAgLSBsb2NhbC1vbmx5IGNoYW5nZXMgYW5kIGxvY2FsLXdpbnMgY29uZmxpY3RzIG5hbWUgdGhlICppbmRleCogaGVhZCAob3JcbiAqICAgICBgbnVsbGAgZm9yIGJyYW5kLW5ldyBwYXRocykgXHUyMDE0IGRlbGliZXJhdGVseSBzdGFsZSB3aGVuIGEgY29uZmxpY3Qgd2FzXG4gKiAgICAgcHJlZGljdGVkLCBzbyB0aGUgRE8gYXJiaXRyYXRlcyBhbmQgcHJlc2VydmVzIHRoZSBsb3NpbmcgcmVtb3RlXG4gKiAgICAgY29udGVudCBzZXJ2ZXItc2lkZTtcbiAqICAgLSBjb25mbGljdC1jb3B5IHB1c2hlcyBuYW1lIHRoZSAqcmVtb3RlKiBoZWFkIChmYXN0LXBhdGg6IHRoZXkgYnVpbGQgb25cbiAqICAgICB0aGUgd2lubmVyIGFuZCBtdXN0IG5vdCByZS1jb25mbGljdCkuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUHVzaEZpbGVPcCB7XG4gIGtpbmQ6ICdhZGQnIHwgJ2VkaXQnIHwgJ2RlbGV0ZScgfCAncmVzdG9yZScgfCAnY29uZmxpY3RDb3B5JztcbiAgcGF0aDogc3RyaW5nO1xuICBwYXJlbnRWZXJzaW9uOiBzdHJpbmcgfCBudWxsO1xuICAvKiogQ29udGVudCBoYXNoOyBkZWxldGUgb3BzIHJldXNlIHRoZSBkZWxldGVkIGNvbnRlbnQncyBoYXNoLiAqL1xuICBoYXNoOiBzdHJpbmc7XG4gIHNpemU6IG51bWJlcjtcbiAgLyoqIFRydWUgZm9yIGZvbGRlci10b21ic3RvbmUgZGVsZXRlcyAoYGhhc2ggJydgLCBzaXplIDApIFx1MjAxNCBGUi0xMCBsaWZlY3ljbGUuICovXG4gIGlzRm9sZGVyPzogYm9vbGVhbjtcbn1cblxuLyoqIEEgbG9jYWwgcmVuYW1lIHRvIGNvbW1pdCBhcyBvbmUgY2hhaW4gbWlncmF0aW9uIChGUi05KS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUHVzaFJlbmFtZU9wIHtcbiAga2luZDogJ3JlbmFtZSc7XG4gIGZyb21QYXRoOiBzdHJpbmc7XG4gIHRvUGF0aDogc3RyaW5nO1xuICAvKiogVmVyc2lvbiBvZiB0aGUgYGZyb21QYXRoYCBoZWFkIHRoaXMgcmVuYW1lIGJ1aWxkcyBvbi4gKi9cbiAgcGFyZW50VmVyc2lvbjogc3RyaW5nIHwgbnVsbDtcbiAgaGFzaDogc3RyaW5nO1xuICBzaXplOiBudW1iZXI7XG59XG5cbmV4cG9ydCB0eXBlIFB1c2hPcCA9IFB1c2hGaWxlT3AgfCBQdXNoUmVuYW1lT3A7XG5cbi8qKiBSZW1vdGUgY29udGVudCB0aGlzIGRldmljZSBzaG91bGQgZmV0Y2ggYW5kIG1hdGVyaWFsaXplIHZpYSBgYXBwbHlQdWxsYC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUHVsbEZpbGVPcCB7XG4gIGtpbmQ6ICdhZGQnIHwgJ2VkaXQnIHwgJ2RlbGV0ZScgfCAncmVzdG9yZSc7XG4gIHBhdGg6IHN0cmluZztcbiAgaGFzaDogc3RyaW5nO1xuICBzaXplOiBudW1iZXI7XG4gIHZlcnNpb246IHN0cmluZztcbiAgY2xvY2s6IExvZ2ljYWxDbG9jaztcbiAgLyoqIFRydWUgZm9yIHRvbWJzdG9uZXMgKGtpbmQgYCdkZWxldGUnYCkuICovXG4gIGRlbGV0ZWQ6IGJvb2xlYW47XG4gIC8qKiBUcnVlIGZvciBlbXB0eS1mb2xkZXIgcGxhY2Vob2xkZXIgcHVsbHMgKEZSLTEwKSBcdTIwMTQgbWF0ZXJpYWxpemUgd2l0aCBgZW5zdXJlRGlyYC4gKi9cbiAgaXNGb2xkZXI/OiBib29sZWFuO1xufVxuXG4vKiogQSByZW1vdGUgcmVuYW1lIHRvIGZvbGxvdyBsb2NhbGx5IChkZXRlY3RlZCBieSBoYXNoIGNvcnJlbGF0aW9uKS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUHVsbFJlbmFtZU9wIHtcbiAga2luZDogJ3JlbmFtZSc7XG4gIGZyb21QYXRoOiBzdHJpbmc7XG4gIHRvUGF0aDogc3RyaW5nO1xuICBoYXNoOiBzdHJpbmc7XG4gIHNpemU6IG51bWJlcjtcbiAgdmVyc2lvbjogc3RyaW5nO1xuICBjbG9jazogTG9naWNhbENsb2NrO1xufVxuXG5leHBvcnQgdHlwZSBQdWxsT3AgPSBQdWxsRmlsZU9wIHwgUHVsbFJlbmFtZU9wO1xuXG4vKipcbiAqIE9uZSBhcmJpdHJhdGVkIGNvbmZsaWN0LiBgbG9zZXJDb250ZW50YCBpcyBgJ25vbmUnYCB3aGVuIHRoZSBsb3Npbmcgc2lkZVxuICogd2FzIGEgZGVsZXRpb24gKG5vdGhpbmcgdG8gcHJlc2VydmUpLiBXaGVuIHRoZSBsb2NhbCBjb250ZW50IGxvc3QgYW5kIGhhZFxuICogY29udGVudCwgYGNvbmZsaWN0Q29weVBhdGhgIG5hbWVzIHdoZXJlIHRoZSBwbGFuIHByZXNlcnZlcyBpdCAodGhlIHB1c2hcbiAqIGl0c2VsZiBpcyBpbiBgU3luY1BsYW4ucHVzaGVzYCB3aXRoIGtpbmQgYCdjb25mbGljdENvcHknYCkuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ29uZmxpY3RPcCB7XG4gIHBhdGg6IHN0cmluZztcbiAgcmVhc29uOiBDb25mbGljdFJlYXNvbjtcbiAgd2lubmVyOiAnbG9jYWwnIHwgJ3JlbW90ZSc7XG4gIGxvc2VyQ29udGVudDogJ2xvY2FsJyB8ICdyZW1vdGUnIHwgJ25vbmUnO1xuICBjb25mbGljdENvcHlQYXRoPzogc3RyaW5nO1xuICByZW1vdGU6IHsgdmVyc2lvbjogc3RyaW5nOyBoYXNoOiBzdHJpbmc7IHNpemU6IG51bWJlcjsgZGVsZXRlZDogYm9vbGVhbjsgY2xvY2s6IExvZ2ljYWxDbG9jayB9O1xuICAvKiogVGhlIHRlbnRhdGl2ZSBjbG9jayB0aGUgbG9jYWwgc2lkZSB3YXMgYXJiaXRyYXRlZCB3aXRoLiAqL1xuICBsb2NhbENsb2NrOiBMb2dpY2FsQ2xvY2s7XG59XG5cbi8qKlxuICogVGhlIGNvbXBsZXRlIHJlY29uY2lsaWF0aW9uIHJlc3VsdCBmb3Igb25lIHN5bmMgY3ljbGUuIE9wcyBhcmUgc29ydGVkIGJ5XG4gKiB0YXJnZXQgcGF0aCAocmVuYW1lcyBieSBgdG9QYXRoYCk7IGV2ZXJ5IGFycmF5IG1heSBiZSBlbXB0eS4gYHB1c2hlc2AgYW5kXG4gKiBgcHVsbHNgIGFyZSBpbmRlcGVuZGVudCBcdTIwMTQgYSBwYXRoIGFwcGVhcnMgYXQgbW9zdCBvbmNlIGluIGVhY2guIFB1c2hlcyBhcmVcbiAqIE5PVCBhcHBsaWVkIHRvIHRoZSBsb2NhbCBpbmRleCB1bnRpbCB0aGUgc2VydmVyIGFja3MgdGhlbTsgcHVsbHMgYXJlXG4gKiBhcHBsaWVkIGJ5IGBhcHBseVB1bGxgIChgZW5naW5lLnRzYCkuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU3luY1BsYW4ge1xuICAvKiogQ29tbWl0cyB0byBzZW5kLCBpbiBvcmRlci4gKi9cbiAgcHVzaGVzOiBQdXNoT3BbXTtcbiAgLyoqIFJlbW90ZSBjaGFuZ2VzIHRvIG1hdGVyaWFsaXplLCBpbiBvcmRlci4gKi9cbiAgcHVsbHM6IFB1bGxPcFtdO1xuICAvKiogQ29uZmxpY3RzIHRoYXQgd2VyZSBhcmJpdHJhdGVkIChpbmZvcm1hdGlvbmFsOyBzaWRlIGVmZmVjdHMgbGl2ZSBpbiBwdXNoZXMvcHVsbHMpLiAqL1xuICBjb25mbGljdHM6IENvbmZsaWN0T3BbXTtcbiAgLyoqIEVtcHR5LWZvbGRlciBwbGFjZWhvbGRlciBwYXRocyB0byBjcmVhdGUgcmVtb3RlbHkgKEZSLTEwKS4gKi9cbiAgZm9sZGVyUHVzaGVzOiBzdHJpbmdbXTtcbn1cblxuLyoqIEludGVybmFsOiBhIGxvY2FsIGNhbmRpZGF0ZSAoYWRkZWQvbW9kaWZpZWQvZGVsZXRlZCkgdW5pZmllZCBmb3IgcmVzb2x1dGlvbi4gKi9cbmludGVyZmFjZSBMb2NhbENhbmRpZGF0ZSB7XG4gIHBhdGg6IHN0cmluZztcbiAga2luZDogJ2FkZCcgfCAnZWRpdCcgfCAncmVzdG9yZScgfCAnZGVsZXRlJztcbiAgaGFzaDogc3RyaW5nO1xuICBzaXplOiBudW1iZXI7XG4gIC8qKiBGb2xkZXItcGxhY2Vob2xkZXIgZGVsZXRpb25zIChgc2Nhbi5mb2xkZXJEZWxldGlvbnNgKSByZXNvbHZlIGFzIHRvbWJzdG9uZXMuICovXG4gIGlzRm9sZGVyPzogYm9vbGVhbjtcbn1cblxuY29uc3QgWkVST19DTE9DSzogTG9naWNhbENsb2NrID0geyBjb3VudGVyOiAwLCBkZXZpY2VJZDogJycgfTtcblxuLyoqXG4gKiBDb21wdXRlIHRoZSBzeW5jIHBsYW4uIFNlZSB0aGUgbW9kdWxlIGRvYyBmb3IgdGhlIG1vZGVsIGFuZCB0aGUgb3BcbiAqIHNlbWFudGljcy4gVGhyb3dzIG5vdGhpbmcgb24gb3JkaW5hcnkgZGl2ZXJnZW5jZSBcdTIwMTQgY29uZmxpY3RzIGFyZSBkYXRhLFxuICogbm90IGVycm9ycy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvbXB1dGVTeW5jUGxhbihpbnB1dDogU3luY1BsYW5JbnB1dCk6IFN5bmNQbGFuIHtcbiAgY29uc3QgeyBsb2NhbENoYW5nZXMsIGluZGV4LCB0aGlzRGV2aWNlSWQsIHRoaXNEZXZpY2VOYW1lLCBub3cgfSA9IGlucHV0O1xuICBjb25zdCBtYW5pZmVzdCA9IFsuLi5pbnB1dC5tYW5pZmVzdF0uc29ydCgoYSwgYikgPT4gY29tcGFyZVN0cmluZ3MoYS5wYXRoLCBiLnBhdGgpKTtcbiAgY29uc3QgbWFuaWZlc3RCeVBhdGggPSBuZXcgTWFwKG1hbmlmZXN0Lm1hcCgoZW50cnkpID0+IFtlbnRyeS5wYXRoLCBlbnRyeV0pKTtcblxuICBjb25zdCBwdXNoZXM6IFB1c2hPcFtdID0gW107XG4gIGNvbnN0IHB1bGxzOiBQdWxsT3BbXSA9IFtdO1xuICBjb25zdCBjb25mbGljdHM6IENvbmZsaWN0T3BbXSA9IFtdO1xuXG4gIC8vIEV2ZXJ5IHBhdGggdGhlIGxvY2FsIHNpZGUgZGl2ZXJnZWQgb24gKHNjYW4gYnVja2V0cyArIGJvdGggZW5kcyBvZiByZW5hbWVzKS5cbiAgY29uc3QgbG9jYWxQYXRocyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBmb3IgKGNvbnN0IGMgb2YgbG9jYWxDaGFuZ2VzLmFkZGVkKSBsb2NhbFBhdGhzLmFkZChjLnBhdGgpO1xuICBmb3IgKGNvbnN0IGMgb2YgbG9jYWxDaGFuZ2VzLm1vZGlmaWVkKSBsb2NhbFBhdGhzLmFkZChjLnBhdGgpO1xuICBmb3IgKGNvbnN0IGQgb2YgbG9jYWxDaGFuZ2VzLmRlbGV0ZWQpIGxvY2FsUGF0aHMuYWRkKGQucGF0aCk7XG4gIGZvciAoY29uc3QgciBvZiBsb2NhbENoYW5nZXMucmVuYW1lZCkge1xuICAgIGxvY2FsUGF0aHMuYWRkKHIuZnJvbSk7XG4gICAgbG9jYWxQYXRocy5hZGQoci50byk7XG4gIH1cbiAgZm9yIChjb25zdCBmIG9mIGxvY2FsQ2hhbmdlcy5mb2xkZXJEZWxldGlvbnMpIGxvY2FsUGF0aHMuYWRkKGYucGF0aCk7XG5cbiAgLy8gUGF0aHMgYWxyZWFkeSBjb25zdW1lZCBieSBhbiBlYXJsaWVyIHBoYXNlIChyZW5hbWUgY29ycmVsYXRpb24gZXRjLikuXG4gIGNvbnN0IGNvbnN1bWVkID0gbmV3IFNldDxzdHJpbmc+KCk7XG5cbiAgY29uc3QgcGF0aEV4aXN0cyA9IChwYXRoOiBzdHJpbmcpOiBib29sZWFuID0+IHBhdGggaW4gaW5kZXggfHwgbWFuaWZlc3RCeVBhdGguaGFzKHBhdGgpO1xuXG4gIC8vIC0tLSBQaGFzZSBBOiBsb2NhbCByZW5hbWVzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAvLyBVbmNvbnRlc3RlZDogb25lIFB1c2hSZW5hbWVPcC4gQ29udGVzdGVkIChyZW1vdGUgY2hhbmdlZCBhdCBlaXRoZXIgZW5kKTpcbiAgLy8gZGVjb21wb3NlIFx1MjAxNCB0aGUgYGZyb21gIHNpZGUgaXMgcmVzb2x2ZWQgb24gaXRzIG93biAodXN1YWxseSB0b21ic3RvbmVkXG4gIC8vIG9yIHB1bGxlZCksIHRoZSByZW5hbWVkIGNvbnRlbnQgaXMgcGxhY2VkIGF0IGB0b2AgdGhyb3VnaCB0aGUgZ2VuZXJpY1xuICAvLyBjb250ZW50IG1hY2hpbmVyeS4gQ29udGVudCBpcyBuZXZlciBsb3N0IGVpdGhlciB3YXkuXG4gIGZvciAoY29uc3QgcmVuYW1lIG9mIFsuLi5sb2NhbENoYW5nZXMucmVuYW1lZF0uc29ydCgoYSwgYikgPT4gY29tcGFyZVN0cmluZ3MoYS5mcm9tLCBiLmZyb20pKSkge1xuICAgIGNvbnN0IGluZGV4RnJvbSA9IGluZGV4W3JlbmFtZS5mcm9tXTtcbiAgICBjb25zdCBpbmRleFRvID0gaW5kZXhbcmVuYW1lLnRvXTtcbiAgICBjb25zdCByZW1vdGVGcm9tID0gbWFuaWZlc3RCeVBhdGguZ2V0KHJlbmFtZS5mcm9tKTtcbiAgICBjb25zdCByZW1vdGVUbyA9IG1hbmlmZXN0QnlQYXRoLmdldChyZW5hbWUudG8pO1xuXG4gICAgY29uc3QgZnJvbUNoYW5nZWQgPSByZW1vdGVGcm9tXG4gICAgICA/IHJlbW90ZUVudHJ5Q2hhbmdlZChpbmRleEZyb20sIHJlbW90ZUZyb20pXG4gICAgICA6IGluZGV4RnJvbT8uZGVsZXRlZEF0ID09PSB1bmRlZmluZWQ7IC8vIGFic2VudCByZW1vdGVseSArIGxpdmUgbG9jYWxseSBcdTIxRDIgY2hhbmdlZFxuICAgIGNvbnN0IHRvQ2hhbmdlZCA9IHJlbW90ZVRvXG4gICAgICA/IHJlbW90ZUVudHJ5Q2hhbmdlZChpbmRleFRvLCByZW1vdGVUbylcbiAgICAgIDogZmFsc2U7IC8vIGFic2VudCByZW1vdGVseSBcdTIxRDIgbm90aGluZyB0byByYWNlIGF0IGB0b2BcblxuICAgIGlmICghZnJvbUNoYW5nZWQgJiYgIXRvQ2hhbmdlZCkge1xuICAgICAgcHVzaGVzLnB1c2goe1xuICAgICAgICBraW5kOiAncmVuYW1lJyxcbiAgICAgICAgZnJvbVBhdGg6IHJlbmFtZS5mcm9tLFxuICAgICAgICB0b1BhdGg6IHJlbmFtZS50byxcbiAgICAgICAgcGFyZW50VmVyc2lvbjogaW5kZXhGcm9tPy52ZXJzaW9uSWQgPz8gbnVsbCxcbiAgICAgICAgaGFzaDogcmVuYW1lLmhhc2gsXG4gICAgICAgIHNpemU6IHJlbmFtZS5zaXplLFxuICAgICAgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBgZnJvbWAgc2lkZSBvZiBhIGNvbnRlc3RlZCByZW5hbWU6XG4gICAgaWYgKCFmcm9tQ2hhbmdlZCkge1xuICAgICAgLy8gTm90aGluZyByZW1vdGUgdGhlcmUgXHUyMDE0IHRoZSBtb3ZlIGl0c2VsZiByZW1vdmVzIHRoZSBvbGQgcGF0aC5cbiAgICAgIGlmIChpbmRleEZyb20gJiYgaW5kZXhGcm9tLmRlbGV0ZWRBdCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHB1c2hlcy5wdXNoKHtcbiAgICAgICAgICBraW5kOiAnZGVsZXRlJyxcbiAgICAgICAgICBwYXRoOiByZW5hbWUuZnJvbSxcbiAgICAgICAgICBwYXJlbnRWZXJzaW9uOiBpbmRleEZyb20udmVyc2lvbklkLFxuICAgICAgICAgIGhhc2g6IGluZGV4RnJvbS5oYXNoLFxuICAgICAgICAgIHNpemU6IGluZGV4RnJvbS5zaXplLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKCFyZW1vdGVGcm9tIHx8IHJlbW90ZUZyb20uZGVsZXRlZCkge1xuICAgICAgLy8gUmVtb3RlIGRlbGV0ZWQgKG9yIG1pZ3JhdGVkIGF3YXkgZnJvbSkgYGZyb21gIFx1MjAxNCBkZWxldGlvbiBzdGFuZHMgZm9yXG4gICAgICAvLyB0aGUgb2xkIHBhdGg7IHRoZSByZW5hbWVkIGNvbnRlbnQgc3Vydml2ZXMgYXQgYHRvYC5cbiAgICAgIHB1bGxzLnB1c2goXG4gICAgICAgIHB1bGxGaWxlKCdkZWxldGUnLCByZW5hbWUuZnJvbSwge1xuICAgICAgICAgIGhhc2g6IHJlbW90ZUZyb20/Lmhhc2ggPz8gaW5kZXhGcm9tPy5oYXNoID8/IHJlbmFtZS5oYXNoLFxuICAgICAgICAgIHNpemU6IHJlbW90ZUZyb20/LnNpemUgPz8gaW5kZXhGcm9tPy5zaXplID8/IHJlbmFtZS5zaXplLFxuICAgICAgICAgIHZlcnNpb246IHJlbW90ZUZyb20/LnZlcnNpb24gPz8gJycsXG4gICAgICAgICAgY2xvY2s6IHJlbW90ZUZyb20/LmNsb2NrID8/IGluZGV4RnJvbT8uY2xvY2sgPz8gWkVST19DTE9DSyxcbiAgICAgICAgICBkZWxldGVkOiB0cnVlLFxuICAgICAgICB9KSxcbiAgICAgICk7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIFJlbW90ZSBlZGl0ZWQgYGZyb21gLiBUaGUgcmVtb3RlIGVkaXQga2VlcHMgdGhlIG9sZCBwYXRoOyB0aGUgbW92ZWRcbiAgICAgIC8vIGNvbnRlbnQgaXMgcGxhY2VkIGF0IGB0b2AgYmVsb3cgXHUyMDE0IGEgcmVuYW1lLXJhY2UgdGhlIGxvY2FsIHNpZGVcbiAgICAgIC8vIGNvbmNlZGVzIHVubGVzcyBpdHMgY2xvY2sgd2lucyB0aGUgcmVuYW1lIHB1c2guXG4gICAgICBjb25zdCBsb2NhbENsb2NrID0gbmV4dENsb2NrKGluZGV4RnJvbT8uY2xvY2ssIHRoaXNEZXZpY2VJZCk7XG4gICAgICBpZiAoY29tcGFyZUNsb2NrcyhyZW1vdGVGcm9tLmNsb2NrLCBsb2NhbENsb2NrKSA+IDApIHtcbiAgICAgICAgcHVsbHMucHVzaChwdWxsRmlsZSgnZWRpdCcsIHJlbmFtZS5mcm9tLCByZW1vdGVGcm9tKSk7XG4gICAgICAgIGNvbmZsaWN0cy5wdXNoKHtcbiAgICAgICAgICBwYXRoOiByZW5hbWUuZnJvbSxcbiAgICAgICAgICByZWFzb246ICdyZW5hbWUtcmFjZScsXG4gICAgICAgICAgd2lubmVyOiAncmVtb3RlJyxcbiAgICAgICAgICAvLyBMb2NhbCBjb250ZW50IGlzIHByZXNlcnZlZCBieSB0aGUgcmVuYW1lIGl0c2VsZiAocHVzaGVkIGF0IGB0b2ApLlxuICAgICAgICAgIGxvc2VyQ29udGVudDogJ2xvY2FsJyxcbiAgICAgICAgICByZW1vdGU6IHJlbW90ZVN1bW1hcnkocmVtb3RlRnJvbSksXG4gICAgICAgICAgbG9jYWxDbG9jayxcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBwdXNoZXMucHVzaCh7XG4gICAgICAgICAga2luZDogJ3JlbmFtZScsXG4gICAgICAgICAgZnJvbVBhdGg6IHJlbmFtZS5mcm9tLFxuICAgICAgICAgIHRvUGF0aDogcmVuYW1lLnRvLFxuICAgICAgICAgIHBhcmVudFZlcnNpb246IGluZGV4RnJvbT8udmVyc2lvbklkID8/IG51bGwsXG4gICAgICAgICAgaGFzaDogcmVuYW1lLmhhc2gsXG4gICAgICAgICAgc2l6ZTogcmVuYW1lLnNpemUsXG4gICAgICAgIH0pO1xuICAgICAgICBjb25mbGljdHMucHVzaCh7XG4gICAgICAgICAgcGF0aDogcmVuYW1lLmZyb20sXG4gICAgICAgICAgcmVhc29uOiAncmVuYW1lLXJhY2UnLFxuICAgICAgICAgIHdpbm5lcjogJ2xvY2FsJyxcbiAgICAgICAgICBsb3NlckNvbnRlbnQ6ICdyZW1vdGUnLFxuICAgICAgICAgIHJlbW90ZTogcmVtb3RlU3VtbWFyeShyZW1vdGVGcm9tKSxcbiAgICAgICAgICBsb2NhbENsb2NrLFxuICAgICAgICB9KTtcbiAgICAgICAgY29udGludWU7IC8vIHRoZSByZW5hbWUgcHVzaCBjYXJyaWVzIHRoZSBjb250ZW50OyBubyBgdG9gIG9wIG5lZWRlZFxuICAgICAgfVxuICAgIH1cblxuICAgIC8vIGB0b2Agc2lkZSBvZiBhIGNvbnRlc3RlZCByZW5hbWU6XG4gICAgaWYgKCF0b0NoYW5nZWQpIHtcbiAgICAgIHB1c2hlcy5wdXNoKHtcbiAgICAgICAga2luZDogaW5kZXhUbz8uZGVsZXRlZEF0ICE9PSB1bmRlZmluZWQgPyAncmVzdG9yZScgOiAnYWRkJyxcbiAgICAgICAgcGF0aDogcmVuYW1lLnRvLFxuICAgICAgICBwYXJlbnRWZXJzaW9uOiBpbmRleFRvPy52ZXJzaW9uSWQgPz8gbnVsbCxcbiAgICAgICAgaGFzaDogcmVuYW1lLmhhc2gsXG4gICAgICAgIHNpemU6IHJlbmFtZS5zaXplLFxuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlc29sdmVDb250ZXN0ZWRQYXRoKHJlbmFtZS50bywgaW5kZXhUbywgcmVtb3RlVG8gYXMgUmVtb3RlRmlsZSwge1xuICAgICAgICBwYXRoOiByZW5hbWUudG8sXG4gICAgICAgIGtpbmQ6IGluZGV4VG8/LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkID8gJ3Jlc3RvcmUnIDogJ2FkZCcsXG4gICAgICAgIGhhc2g6IHJlbmFtZS5oYXNoLFxuICAgICAgICBzaXplOiByZW5hbWUuc2l6ZSxcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIC8vIC0tLSBQaGFzZSBCOiByZW1vdGUgcmVuYW1lcyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAvLyBBIHBhdGggbGl2ZSBpbiB0aGUgaW5kZXggYnV0IEFCU0VOVCBmcm9tIHRoZSBtYW5pZmVzdCB3YXMgbWlncmF0ZWQgYnkgdGhlXG4gIC8vIGF1dGhvcml0eSAodG9tYnN0b25lcyBhcHBlYXIgaW4gdGhlIG1hbmlmZXN0IHdpdGggZGVsZXRlZDp0cnVlIFx1MjAxNCBvbmx5IGFcbiAgLy8gcmVuYW1lIHJlbW92ZXMgYSBwYXRoKS4gQ29ycmVsYXRlIGJ5IGNvbnRlbnQgaGFzaCBhZ2FpbnN0IG5ldyBtYW5pZmVzdFxuICAvLyBwYXRocywgc2FtZS1wYXJlbnQgcHJlZmVycmVkLCBzbWFsbGVzdCBwYXRoIHdpdGhpbiBhIHByZWZlcmVuY2UgY2xhc3MuXG4gIGZvciAoY29uc3QgZnJvbSBvZiBPYmplY3Qua2V5cyhpbmRleClcbiAgICAuZmlsdGVyKChwKSA9PiB7XG4gICAgICBjb25zdCBlbnRyeSA9IGluZGV4W3BdIGFzIExvY2FsSW5kZXhFbnRyeTtcbiAgICAgIHJldHVybiBlbnRyeS5kZWxldGVkQXQgPT09IHVuZGVmaW5lZCAmJiAhZW50cnkuaXNGb2xkZXI7XG4gICAgfSlcbiAgICAuc29ydChjb21wYXJlU3RyaW5ncykpIHtcbiAgICBpZiAobG9jYWxQYXRocy5oYXMoZnJvbSkgfHwgY29uc3VtZWQuaGFzKGZyb20pKSBjb250aW51ZTtcbiAgICBpZiAobWFuaWZlc3RCeVBhdGguaGFzKGZyb20pKSBjb250aW51ZTsgLy8gcHJlc2VudCAobGl2ZSBvciB0b21ic3RvbmVkKSBcdTIxRDIgbm90IG1pZ3JhdGVkXG4gICAgY29uc3QgZW50cnkgPSBpbmRleFtmcm9tXSBhcyBMb2NhbEluZGV4RW50cnk7XG5cbiAgICBsZXQgYmVzdDogUmVtb3RlRmlsZSB8IHVuZGVmaW5lZDtcbiAgICBsZXQgYmVzdFNhbWVEaXIgPSBmYWxzZTtcbiAgICBmb3IgKGNvbnN0IGNhbmRpZGF0ZSBvZiBtYW5pZmVzdCkge1xuICAgICAgaWYgKGNhbmRpZGF0ZS5kZWxldGVkKSBjb250aW51ZTtcbiAgICAgIGlmIChsb2NhbFBhdGhzLmhhcyhjYW5kaWRhdGUucGF0aCkgfHwgY29uc3VtZWQuaGFzKGNhbmRpZGF0ZS5wYXRoKSkgY29udGludWU7XG4gICAgICBjb25zdCBrbm93biA9IGluZGV4W2NhbmRpZGF0ZS5wYXRoXTtcbiAgICAgIGlmIChrbm93biAhPT0gdW5kZWZpbmVkICYmIGtub3duLmRlbGV0ZWRBdCA9PT0gdW5kZWZpbmVkKSBjb250aW51ZTsgLy8gdGFyZ2V0IG5vdCBuZXdcbiAgICAgIGlmIChjYW5kaWRhdGUuaGFzaCAhPT0gZW50cnkuaGFzaCkgY29udGludWU7XG4gICAgICBjb25zdCBzYW1lRGlyID0gcGFyZW50UGF0aChjYW5kaWRhdGUucGF0aCkgPT09IHBhcmVudFBhdGgoZnJvbSk7XG4gICAgICBpZiAoYmVzdCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGJlc3QgPSBjYW5kaWRhdGU7XG4gICAgICAgIGJlc3RTYW1lRGlyID0gc2FtZURpcjtcbiAgICAgIH0gZWxzZSBpZiAoc2FtZURpciAmJiAhYmVzdFNhbWVEaXIpIHtcbiAgICAgICAgYmVzdCA9IGNhbmRpZGF0ZTtcbiAgICAgICAgYmVzdFNhbWVEaXIgPSB0cnVlO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChiZXN0KSB7XG4gICAgICBwdWxscy5wdXNoKHtcbiAgICAgICAga2luZDogJ3JlbmFtZScsXG4gICAgICAgIGZyb21QYXRoOiBmcm9tLFxuICAgICAgICB0b1BhdGg6IGJlc3QucGF0aCxcbiAgICAgICAgaGFzaDogYmVzdC5oYXNoLFxuICAgICAgICBzaXplOiBiZXN0LnNpemUsXG4gICAgICAgIHZlcnNpb246IGJlc3QudmVyc2lvbixcbiAgICAgICAgY2xvY2s6IGJlc3QuY2xvY2ssXG4gICAgICB9KTtcbiAgICAgIGNvbnN1bWVkLmFkZChmcm9tKTtcbiAgICAgIGNvbnN1bWVkLmFkZChiZXN0LnBhdGgpO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBBYnNlbnQgd2l0aG91dCBjb3JyZWxhdGlvbjogdGhlIGF1dGhvcml0eSBubyBsb25nZXIga25vd3MgdGhlIHBhdGguXG4gICAgICAvLyBUcmVhdCBhcyBhIHJlbW90ZSBkZWxldGUgd2l0aCB1bmtub3duIGhlYWQgdmVyc2lvbiAoJycgXHUyMDE0IHRoZSBuZXh0XG4gICAgICAvLyBmdWxsIG1hbmlmZXN0IGhlYWxzIHRoZSB2ZXJzaW9uIGlkKS4gVGhpcyBhbHNvIGNvdmVycyByZW1vdGVcbiAgICAgIC8vIHJlbmFtZStlZGl0LCB3aGljaCBnZW51aW5lbHkgaXMgZGVsZXRlICsgYWRkLlxuICAgICAgcHVsbHMucHVzaChcbiAgICAgICAgcHVsbEZpbGUoJ2RlbGV0ZScsIGZyb20sIHtcbiAgICAgICAgICBoYXNoOiBlbnRyeS5oYXNoLFxuICAgICAgICAgIHNpemU6IGVudHJ5LnNpemUsXG4gICAgICAgICAgdmVyc2lvbjogJycsXG4gICAgICAgICAgY2xvY2s6IGVudHJ5LmNsb2NrLFxuICAgICAgICAgIGRlbGV0ZWQ6IHRydWUsXG4gICAgICAgIH0pLFxuICAgICAgKTtcbiAgICAgIGNvbnN1bWVkLmFkZChmcm9tKTtcbiAgICB9XG4gIH1cblxuICAvLyAtLS0gUGhhc2UgQzogcmVtYWluaW5nIHJlbW90ZS1vbmx5IGNoYW5nZXMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgZm9yIChjb25zdCByZW1vdGUgb2YgbWFuaWZlc3QpIHtcbiAgICBpZiAobG9jYWxQYXRocy5oYXMocmVtb3RlLnBhdGgpIHx8IGNvbnN1bWVkLmhhcyhyZW1vdGUucGF0aCkpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGVudHJ5ID0gaW5kZXhbcmVtb3RlLnBhdGhdO1xuICAgIGlmICghcmVtb3RlRW50cnlDaGFuZ2VkKGVudHJ5LCByZW1vdGUpKSBjb250aW51ZTtcbiAgICBpZiAoZW50cnkgPT09IHVuZGVmaW5lZCkge1xuICAgICAgaWYgKCFyZW1vdGUuZGVsZXRlZCkge1xuICAgICAgICBwdWxscy5wdXNoKHB1bGxGaWxlKCdhZGQnLCByZW1vdGUucGF0aCwgcmVtb3RlKSk7XG4gICAgICAgIGNvbnN1bWVkLmFkZChyZW1vdGUucGF0aCk7XG4gICAgICB9XG4gICAgICAvLyBkZWxldGVkICsgbmV2ZXIga25vd24gbG9jYWxseSBcdTIxRDIgbm90aGluZyB0byBkb1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChyZW1vdGUuZGVsZXRlZCkge1xuICAgICAgcHVsbHMucHVzaChwdWxsRmlsZSgnZGVsZXRlJywgcmVtb3RlLnBhdGgsIHJlbW90ZSkpOyAvLyBpbmNsdWRlcyB0b21ic3RvbmVcdTIxOTJ0b21ic3RvbmUgdmVyc2lvbiBjYXRjaC11cFxuICAgIH0gZWxzZSBpZiAoZW50cnkuZGVsZXRlZEF0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHB1bGxzLnB1c2gocHVsbEZpbGUoJ3Jlc3RvcmUnLCByZW1vdGUucGF0aCwgcmVtb3RlKSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHB1bGxzLnB1c2gocHVsbEZpbGUoJ2VkaXQnLCByZW1vdGUucGF0aCwgcmVtb3RlKSk7XG4gICAgfVxuICAgIGNvbnN1bWVkLmFkZChyZW1vdGUucGF0aCk7XG4gIH1cblxuICAvLyAtLS0gUGhhc2UgRDogbG9jYWwgY2FuZGlkYXRlcyAobG9jYWwtb25seSBwdXNoZXMgKyBib3RoLWNoYW5nZWQpIC0tLS0tLS1cbiAgY29uc3QgY2FuZGlkYXRlczogTG9jYWxDYW5kaWRhdGVbXSA9IFtcbiAgICAuLi5sb2NhbENoYW5nZXMuYWRkZWQubWFwKChjKSA9PiAoeyAuLi5jLCBraW5kOiAnYWRkJyBhcyBjb25zdCB9KSksXG4gICAgLi4ubG9jYWxDaGFuZ2VzLm1vZGlmaWVkLm1hcCgoYykgPT4gKHtcbiAgICAgIC4uLmMsXG4gICAgICBraW5kOiBpbmRleFtjLnBhdGhdPy5kZWxldGVkQXQgIT09IHVuZGVmaW5lZCA/ICgncmVzdG9yZScgYXMgY29uc3QpIDogKCdlZGl0JyBhcyBjb25zdCksXG4gICAgfSkpLFxuICAgIC4uLmxvY2FsQ2hhbmdlcy5kZWxldGVkLm1hcCgoZCk6IExvY2FsQ2FuZGlkYXRlID0+ICh7IC4uLmQsIGtpbmQ6ICdkZWxldGUnIH0pKSxcbiAgICAvLyBGb2xkZXIgcGxhY2Vob2xkZXJzIHdob3NlIGRpcmVjdG9yeSB2YW5pc2hlZDogdG9tYnN0b25lIHB1c2hlcy4gVGhleVxuICAgIC8vIGNhcnJ5IG5vIGNvbnRlbnQgKGhhc2ggJycvc2l6ZSAwKSBhbmQgY2FuIG5ldmVyIHBhaXIgd2l0aCBhbiBhZGQsIHNvXG4gICAgLy8gdGhleSBqb2luIGhlcmUgcmF0aGVyIHRoYW4gdGhlIGBkZWxldGVkYCBidWNrZXQgKHJlbmFtZSBjb3JyZWxhdGlvbixcbiAgICAvLyBjb25mbGljdCBjb3BpZXMgXHUyMDE0IG5laXRoZXIgYXBwbGllcyB0byBwbGFjZWhvbGRlcnMpLlxuICAgIC4uLmxvY2FsQ2hhbmdlcy5mb2xkZXJEZWxldGlvbnMubWFwKFxuICAgICAgKGYpOiBMb2NhbENhbmRpZGF0ZSA9PiAoe1xuICAgICAgICBwYXRoOiBmLnBhdGgsXG4gICAgICAgIGtpbmQ6ICdkZWxldGUnLFxuICAgICAgICBoYXNoOiAnJyxcbiAgICAgICAgc2l6ZTogMCxcbiAgICAgICAgaXNGb2xkZXI6IHRydWUsXG4gICAgICB9KSxcbiAgICApLFxuICBdLnNvcnQoKGEsIGIpID0+IGNvbXBhcmVTdHJpbmdzKGEucGF0aCwgYi5wYXRoKSk7XG5cbiAgZm9yIChjb25zdCBjYW5kaWRhdGUgb2YgY2FuZGlkYXRlcykge1xuICAgIGNvbnN0IGVudHJ5ID0gaW5kZXhbY2FuZGlkYXRlLnBhdGhdO1xuICAgIGNvbnN0IHJlbW90ZSA9IG1hbmlmZXN0QnlQYXRoLmdldChjYW5kaWRhdGUucGF0aCk7XG4gICAgY29uc3QgcmVtb3RlQ2hhbmdlZEhlcmUgPVxuICAgICAgcmVtb3RlICE9PSB1bmRlZmluZWQgJiYgKGVudHJ5ICE9PSB1bmRlZmluZWQgPyByZW1vdGUudmVyc2lvbiAhPT0gZW50cnkudmVyc2lvbklkIDogIXJlbW90ZS5kZWxldGVkKTtcbiAgICBpZiAoIXJlbW90ZUNoYW5nZWRIZXJlKSB7XG4gICAgICBwdXNoTG9jYWwoY2FuZGlkYXRlLCBlbnRyeSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlc29sdmVDb250ZXN0ZWRQYXRoKGNhbmRpZGF0ZS5wYXRoLCBlbnRyeSwgcmVtb3RlIGFzIFJlbW90ZUZpbGUsIGNhbmRpZGF0ZSk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHtcbiAgICBwdXNoZXM6IHB1c2hlcy5zb3J0KChhLCBiKSA9PiBjb21wYXJlU3RyaW5ncyhvcFBhdGgoYSksIG9wUGF0aChiKSkpLFxuICAgIHB1bGxzOiBwdWxscy5zb3J0KChhLCBiKSA9PiBjb21wYXJlU3RyaW5ncyhvcFBhdGgoYSksIG9wUGF0aChiKSkpLFxuICAgIGNvbmZsaWN0czogY29uZmxpY3RzLnNvcnQoKGEsIGIpID0+IGNvbXBhcmVTdHJpbmdzKGEucGF0aCwgYi5wYXRoKSksXG4gICAgZm9sZGVyUHVzaGVzOiBbLi4ubG9jYWxDaGFuZ2VzLmVtcHR5Rm9sZGVyc10uc29ydChjb21wYXJlU3RyaW5ncyksXG4gIH07XG5cbiAgLy8gLS0tIGhlbHBlcnMgKGNsb3NlIG92ZXIgdGhlIGFjY3VtdWxhdG9ycykgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgZnVuY3Rpb24gcHVzaExvY2FsKGNhbmRpZGF0ZTogTG9jYWxDYW5kaWRhdGUsIGVudHJ5OiBMb2NhbEluZGV4RW50cnkgfCB1bmRlZmluZWQpOiB2b2lkIHtcbiAgICBpZiAoY2FuZGlkYXRlLmtpbmQgPT09ICdkZWxldGUnKSB7XG4gICAgICBwdXNoZXMucHVzaCh7XG4gICAgICAgIGtpbmQ6ICdkZWxldGUnLFxuICAgICAgICBwYXRoOiBjYW5kaWRhdGUucGF0aCxcbiAgICAgICAgcGFyZW50VmVyc2lvbjogZW50cnk/LnZlcnNpb25JZCA/PyBudWxsLFxuICAgICAgICBoYXNoOiBlbnRyeT8uaGFzaCA/PyBjYW5kaWRhdGUuaGFzaCxcbiAgICAgICAgc2l6ZTogZW50cnk/LnNpemUgPz8gY2FuZGlkYXRlLnNpemUsXG4gICAgICAgIC4uLihjYW5kaWRhdGUuaXNGb2xkZXIgPyB7IGlzRm9sZGVyOiB0cnVlIH0gOiB7fSksXG4gICAgICB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgcHVzaGVzLnB1c2goe1xuICAgICAga2luZDogY2FuZGlkYXRlLmtpbmQsXG4gICAgICBwYXRoOiBjYW5kaWRhdGUucGF0aCxcbiAgICAgIHBhcmVudFZlcnNpb246IGVudHJ5Py52ZXJzaW9uSWQgPz8gbnVsbCxcbiAgICAgIGhhc2g6IGNhbmRpZGF0ZS5oYXNoLFxuICAgICAgc2l6ZTogY2FuZGlkYXRlLnNpemUsXG4gICAgfSk7XG4gIH1cblxuICAvKipcbiAgICogQm90aCBzaWRlcyBjaGFuZ2VkIG9uZSBwYXRoLiBBcmJpdHJhdGUgcGVyIFx1MDBBNzQuIExvY2FsIGRlbGV0aW9ucyBuZXZlciBnZXRcbiAgICogYSBjb25mbGljdCBjb3B5IChubyBjb250ZW50IHRvIHByZXNlcnZlKTsgbG9jYWwgKmNvbnRlbnQqIHRoYXQgbG9zZXMgaXNcbiAgICogcHJlc2VydmVkIHZpYSBhIGNvbmZsaWN0LWNvcHkgcHVzaC5cbiAgICovXG4gIGZ1bmN0aW9uIHJlc29sdmVDb250ZXN0ZWRQYXRoKFxuICAgIHBhdGg6IHN0cmluZyxcbiAgICBlbnRyeTogTG9jYWxJbmRleEVudHJ5IHwgdW5kZWZpbmVkLFxuICAgIHJlbW90ZTogUmVtb3RlRmlsZSxcbiAgICBsb2NhbDogTG9jYWxDYW5kaWRhdGUsXG4gICk6IHZvaWQge1xuICAgIGNvbnN0IGxvY2FsQ2xvY2sgPSBuZXh0Q2xvY2soZW50cnk/LmNsb2NrLCB0aGlzRGV2aWNlSWQpO1xuICAgIGNvbnN0IHJlbW90ZVdpbnMgPSBjb21wYXJlQ2xvY2tzKHJlbW90ZS5jbG9jaywgbG9jYWxDbG9jaykgPiAwOyAvLyAwIFx1MjFEMiBsb2NhbCAoZG9jdW1lbnRlZClcbiAgICBjb25zdCBzdW1tYXJ5ID0gcmVtb3RlU3VtbWFyeShyZW1vdGUpO1xuICAgIGNvbnN0IHJlYXNvbjogQ29uZmxpY3RSZWFzb24gPVxuICAgICAgbG9jYWwua2luZCA9PT0gJ2RlbGV0ZScgfHwgcmVtb3RlLmRlbGV0ZWRcbiAgICAgICAgPyAnZGVsZXRlLXZzLWVkaXQnXG4gICAgICAgIDogZW50cnkgPT09IHVuZGVmaW5lZFxuICAgICAgICAgID8gJ2FkZC12cy1hZGQnXG4gICAgICAgICAgOiAnY29uY3VycmVudC1lZGl0JztcblxuICAgIGlmIChsb2NhbC5raW5kID09PSAnZGVsZXRlJyAmJiByZW1vdGUuZGVsZXRlZCkge1xuICAgICAgLy8gQm90aCBkZWxldGVkIFx1MjAxNCBjb252ZXJnZSBzaWxlbnRseSBvbiB0aGUgcmVtb3RlIHRvbWJzdG9uZS5cbiAgICAgIHB1bGxzLnB1c2gocHVsbEZpbGUoJ2RlbGV0ZScsIHBhdGgsIHJlbW90ZSkpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGlmIChsb2NhbC5raW5kID09PSAnZGVsZXRlJykge1xuICAgICAgLy8gTG9jYWwgZGVsZXRlIHZzIHJlbW90ZSBlZGl0LlxuICAgICAgaWYgKHJlbW90ZVdpbnMpIHtcbiAgICAgICAgcHVsbHMucHVzaChwdWxsRmlsZSgnZWRpdCcsIHBhdGgsIHJlbW90ZSkpOyAvLyBmaWxlIGlzIHJlY3JlYXRlZFxuICAgICAgICBjb25mbGljdHMucHVzaCh7XG4gICAgICAgICAgcGF0aCwgcmVhc29uLCB3aW5uZXI6ICdyZW1vdGUnLCBsb3NlckNvbnRlbnQ6ICdub25lJyxcbiAgICAgICAgICByZW1vdGU6IHN1bW1hcnksIGxvY2FsQ2xvY2ssXG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcHVzaGVzLnB1c2goe1xuICAgICAgICAgIGtpbmQ6ICdkZWxldGUnLFxuICAgICAgICAgIHBhdGgsXG4gICAgICAgICAgcGFyZW50VmVyc2lvbjogZW50cnk/LnZlcnNpb25JZCA/PyBudWxsLFxuICAgICAgICAgIGhhc2g6IGVudHJ5Py5oYXNoID8/IGxvY2FsLmhhc2gsXG4gICAgICAgICAgc2l6ZTogZW50cnk/LnNpemUgPz8gbG9jYWwuc2l6ZSxcbiAgICAgICAgICAuLi4obG9jYWwuaXNGb2xkZXIgPyB7IGlzRm9sZGVyOiB0cnVlIH0gOiB7fSksXG4gICAgICAgIH0pO1xuICAgICAgICBjb25mbGljdHMucHVzaCh7XG4gICAgICAgICAgcGF0aCwgcmVhc29uLCB3aW5uZXI6ICdsb2NhbCcsIGxvc2VyQ29udGVudDogJ3JlbW90ZScsXG4gICAgICAgICAgcmVtb3RlOiBzdW1tYXJ5LCBsb2NhbENsb2NrLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAocmVtb3RlLmRlbGV0ZWQpIHtcbiAgICAgIC8vIExvY2FsIGVkaXQgdnMgcmVtb3RlIGRlbGV0ZS5cbiAgICAgIGlmIChyZW1vdGVXaW5zKSB7XG4gICAgICAgIHB1bGxzLnB1c2gocHVsbEZpbGUoJ2RlbGV0ZScsIHBhdGgsIHJlbW90ZSkpO1xuICAgICAgICBjb25mbGljdHMucHVzaCh7XG4gICAgICAgICAgcGF0aCwgcmVhc29uLCB3aW5uZXI6ICdyZW1vdGUnLCBsb3NlckNvbnRlbnQ6ICdsb2NhbCcsXG4gICAgICAgICAgY29uZmxpY3RDb3B5UGF0aDogcHVzaENvbmZsaWN0Q29weShwYXRoLCBsb2NhbCwgcmVtb3RlKSxcbiAgICAgICAgICByZW1vdGU6IHN1bW1hcnksIGxvY2FsQ2xvY2ssXG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcHVzaGVzLnB1c2goe1xuICAgICAgICAgIGtpbmQ6IGxvY2FsLmtpbmQsXG4gICAgICAgICAgcGF0aCxcbiAgICAgICAgICBwYXJlbnRWZXJzaW9uOiBlbnRyeT8udmVyc2lvbklkID8/IG51bGwsXG4gICAgICAgICAgaGFzaDogbG9jYWwuaGFzaCxcbiAgICAgICAgICBzaXplOiBsb2NhbC5zaXplLFxuICAgICAgICB9KTtcbiAgICAgICAgY29uZmxpY3RzLnB1c2goe1xuICAgICAgICAgIHBhdGgsIHJlYXNvbiwgd2lubmVyOiAnbG9jYWwnLCBsb3NlckNvbnRlbnQ6ICdub25lJyxcbiAgICAgICAgICByZW1vdGU6IHN1bW1hcnksIGxvY2FsQ2xvY2ssXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIENvbmN1cnJlbnQgY29udGVudCAoZWRpdC12cy1lZGl0IG9yIGFkZC12cy1hZGQpLlxuICAgIGlmIChyZW1vdGVXaW5zKSB7XG4gICAgICBwdWxscy5wdXNoKFxuICAgICAgICBwdWxsRmlsZShlbnRyeT8uZGVsZXRlZEF0ICE9PSB1bmRlZmluZWQgPyAncmVzdG9yZScgOiBlbnRyeSA9PT0gdW5kZWZpbmVkID8gJ2FkZCcgOiAnZWRpdCcsIHBhdGgsIHJlbW90ZSksXG4gICAgICApO1xuICAgICAgY29uZmxpY3RzLnB1c2goe1xuICAgICAgICBwYXRoLCByZWFzb24sIHdpbm5lcjogJ3JlbW90ZScsIGxvc2VyQ29udGVudDogJ2xvY2FsJyxcbiAgICAgICAgY29uZmxpY3RDb3B5UGF0aDogcHVzaENvbmZsaWN0Q29weShwYXRoLCBsb2NhbCwgcmVtb3RlKSxcbiAgICAgICAgcmVtb3RlOiBzdW1tYXJ5LCBsb2NhbENsb2NrLFxuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHB1c2hlcy5wdXNoKHtcbiAgICAgICAga2luZDogbG9jYWwua2luZCxcbiAgICAgICAgcGF0aCxcbiAgICAgICAgLy8gRGVsaWJlcmF0ZWx5IHRoZSAoc3RhbGUpIGluZGV4IHBhcmVudDogdGhlIERPIG11c3QgYXJiaXRyYXRlIGFuZFxuICAgICAgICAvLyBzeW50aGVzaXplIHRoZSBjb25mbGljdCBjb3B5IGZvciB0aGUgbG9zaW5nIHJlbW90ZSBjb250ZW50LlxuICAgICAgICBwYXJlbnRWZXJzaW9uOiBlbnRyeT8udmVyc2lvbklkID8/IG51bGwsXG4gICAgICAgIGhhc2g6IGxvY2FsLmhhc2gsXG4gICAgICAgIHNpemU6IGxvY2FsLnNpemUsXG4gICAgICB9KTtcbiAgICAgIGNvbmZsaWN0cy5wdXNoKHtcbiAgICAgICAgcGF0aCwgcmVhc29uLCB3aW5uZXI6ICdsb2NhbCcsIGxvc2VyQ29udGVudDogJ3JlbW90ZScsXG4gICAgICAgIHJlbW90ZTogc3VtbWFyeSwgbG9jYWxDbG9jayxcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQdXNoIHRoZSBsb3NpbmcgbG9jYWwgY29udGVudCB0byBhIGNvbmZsaWN0LWNvcHkgcGF0aDsgcmV0dXJucyB0aGUgcGF0aCxcbiAgICogb3IgYHVuZGVmaW5lZGAgd2hlbiB0aGUgbG9zaW5nIGNvbnRlbnQgaXMgYnl0ZS1pZGVudGljYWwgdG8gdGhlIHdpbm5lcidzXG4gICAqIChhIHNhbWUtY29udGVudCByYWNlIFx1MjAxNCBub3RoaW5nIGRpc3RpbmN0IHRvIHByZXNlcnZlOyBtYXRjaGVzIHRoZSBzZXJ2ZXInc1xuICAgKiBhcmJpdHJhdGlvbiwgd2hpY2ggbGlrZXdpc2Ugc3ludGhlc2l6ZXMgbm8gY29weSBmb3IgaWRlbnRpY2FsIGNvbnRlbnQpLlxuICAgKi9cbiAgZnVuY3Rpb24gcHVzaENvbmZsaWN0Q29weShwYXRoOiBzdHJpbmcsIGxvY2FsOiBMb2NhbENhbmRpZGF0ZSwgcmVtb3RlOiBSZW1vdGVGaWxlKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICBpZiAobG9jYWwuaGFzaCA9PT0gcmVtb3RlLmhhc2gpIHJldHVybiB1bmRlZmluZWQ7XG4gICAgY29uc3QgY29weVBhdGggPSBjb25mbGljdENvcHlQYXRoKHBhdGgsIHRoaXNEZXZpY2VOYW1lLCBub3csIHBhdGhFeGlzdHMpO1xuICAgIHB1c2hlcy5wdXNoKHtcbiAgICAgIGtpbmQ6ICdjb25mbGljdENvcHknLFxuICAgICAgcGF0aDogY29weVBhdGgsXG4gICAgICAvLyBCdWlsZCBvbiB0aGUgd2lubmluZyByZW1vdGUgaGVhZDogdGhpcyBwdXNoIG11c3QgZmFzdC1wYXRoLlxuICAgICAgcGFyZW50VmVyc2lvbjogcmVtb3RlLnZlcnNpb24sXG4gICAgICBoYXNoOiBsb2NhbC5oYXNoLFxuICAgICAgc2l6ZTogbG9jYWwuc2l6ZSxcbiAgICB9KTtcbiAgICByZXR1cm4gY29weVBhdGg7XG4gIH1cbn1cblxuLy8gLS0tIG1vZHVsZS1sZXZlbCBoZWxwZXJzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5mdW5jdGlvbiBwdWxsRmlsZShcbiAga2luZDogUHVsbEZpbGVPcFsna2luZCddLFxuICBwYXRoOiBzdHJpbmcsXG4gIHJlbW90ZTogUGljazxSZW1vdGVGaWxlLCAnaGFzaCcgfCAnc2l6ZScgfCAndmVyc2lvbicgfCAnY2xvY2snIHwgJ2lzRm9sZGVyJz4gJiB7XG4gICAgZGVsZXRlZD86IGJvb2xlYW47XG4gIH0sXG4pOiBQdWxsRmlsZU9wIHtcbiAgcmV0dXJuIHtcbiAgICBraW5kLFxuICAgIHBhdGgsXG4gICAgaGFzaDogcmVtb3RlLmhhc2gsXG4gICAgc2l6ZTogcmVtb3RlLnNpemUsXG4gICAgdmVyc2lvbjogcmVtb3RlLnZlcnNpb24sXG4gICAgY2xvY2s6IHJlbW90ZS5jbG9jayxcbiAgICBkZWxldGVkOiByZW1vdGUuZGVsZXRlZCA/PyBraW5kID09PSAnZGVsZXRlJyxcbiAgICAuLi4ocmVtb3RlLmlzRm9sZGVyID8geyBpc0ZvbGRlcjogdHJ1ZSB9IDoge30pLFxuICB9O1xufVxuXG5mdW5jdGlvbiByZW1vdGVTdW1tYXJ5KHJlbW90ZTogUmVtb3RlRmlsZSk6IENvbmZsaWN0T3BbJ3JlbW90ZSddIHtcbiAgcmV0dXJuIHtcbiAgICB2ZXJzaW9uOiByZW1vdGUudmVyc2lvbixcbiAgICBoYXNoOiByZW1vdGUuaGFzaCxcbiAgICBzaXplOiByZW1vdGUuc2l6ZSxcbiAgICBkZWxldGVkOiByZW1vdGUuZGVsZXRlZCxcbiAgICBjbG9jazogcmVtb3RlLmNsb2NrLFxuICB9O1xufVxuXG4vKipcbiAqIFdoZXRoZXIgdGhlIHJlbW90ZSBoZWFkIGZvciBhIHBhdGggZGlmZmVycyBmcm9tIHdoYXQgdGhlIGluZGV4IHJlY29yZHMuXG4gKiBWZXJzaW9uIGlkcyBhcmUgdGhlIHByaW1hcnkgc2lnbmFsIChjbGllbnQgYW5kIERPIHNoYXJlIG9uZSBpZCBzcGFjZSk7XG4gKiBhIHBhdGggYWJzZW50IHJlbW90ZWx5IGNvdW50cyBhcyBjaGFuZ2VkIG9ubHkgd2hpbGUgdGhlIGluZGV4IHN0aWxsIGhvbGRzXG4gKiBpdCBsaXZlIFx1MjAxNCBjYWxsZXJzIGRlY2lkZSB3aGF0IGFic2VuY2UgKm1lYW5zKiAocmVuYW1lIHZzIGRlbGV0ZSkuXG4gKi9cbmZ1bmN0aW9uIHJlbW90ZUVudHJ5Q2hhbmdlZChcbiAgZW50cnk6IExvY2FsSW5kZXhFbnRyeSB8IHVuZGVmaW5lZCxcbiAgcmVtb3RlOiBSZW1vdGVGaWxlIHwgdW5kZWZpbmVkLFxuKTogYm9vbGVhbiB7XG4gIGlmIChyZW1vdGUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIGZhbHNlO1xuICBpZiAoZW50cnkgPT09IHVuZGVmaW5lZCkgcmV0dXJuICFyZW1vdGUuZGVsZXRlZDtcbiAgcmV0dXJuIHJlbW90ZS52ZXJzaW9uICE9PSBlbnRyeS52ZXJzaW9uSWQ7XG59XG5cbmZ1bmN0aW9uIG9wUGF0aChvcDogUHVzaE9wIHwgUHVsbE9wKTogc3RyaW5nIHtcbiAgcmV0dXJuIG9wLmtpbmQgPT09ICdyZW5hbWUnID8gb3AudG9QYXRoIDogb3AucGF0aDtcbn1cblxuZnVuY3Rpb24gY29tcGFyZVN0cmluZ3MoYTogc3RyaW5nLCBiOiBzdHJpbmcpOiBudW1iZXIge1xuICByZXR1cm4gYSA8IGIgPyAtMSA6IGEgPiBiID8gMSA6IDA7XG59XG4iLCAiLyoqXG4gKiBMb2NhbCBjaGFuZ2UgZGV0ZWN0aW9uIChBUkNISVRFQ1RVUkUubWQgXHUwMEE3OCBzdGVwIDMpLlxuICpcbiAqIGBzY2FuVmF1bHRgIHdhbGtzIHRoZSBzdG9yYWdlIGFkYXB0ZXIsIGFwcGxpZXMgdGhlIHNoYXJlZCBpZ25vcmUgcnVsZXMsXG4gKiBoYXNoZXMgbm9uLWlnbm9yZWQgZmlsZXMgKHNoYTI1NiBcdTIwMTQgc2FtZSBhcyBibG9iIGFkZHJlc3NpbmcpIGFuZCBkaWZmc1xuICogdGhlIHJlc3VsdCBhZ2FpbnN0IHRoZSBjbGllbnQncyBgTG9jYWxJbmRleGAuIFRoZSBkaWZmIGNsYXNzaWZpZXM6XG4gKlxuICogICAtIGBhZGRlZGAgICAgXHUyMDE0IGZpbGUgcHJlc2VudCwgcGF0aCB1bmtub3duIHRvIHRoZSBpbmRleDtcbiAqICAgLSBgbW9kaWZpZWRgIFx1MjAxNCBmaWxlIHByZXNlbnQsIGNvbnRlbnQgaGFzaCBkaWZmZXJzIGZyb20gdGhlIGluZGV4IGVudHJ5LlxuICogICAgICAgICAgICAgICAgICBBIGZpbGUgd2hvc2UgaW5kZXggZW50cnkgaXMgYSAqdG9tYnN0b25lKiBhbHNvIGxhbmRzIGhlcmVcbiAqICAgICAgICAgICAgICAgICAgKGRvY3VtZW50ZWQgZGVjaXNpb24pOiB3aGV0aGVyIGl0IGlzIGFuIGVkaXQtb2YtZGVsZXRlZFxuICogICAgICAgICAgICAgICAgICBvciBhIHB1cmUgcmVzdXJyZWN0LCB0aGUgcmVzb2x1dGlvbiBpcyBpZGVudGljYWwgXHUyMDE0IGxvY2FsXG4gKiAgICAgICAgICAgICAgICAgIGNvbnRlbnQgZXhpc3RzIHRoYXQgdGhlIGluZGV4IGhlYWQgZG9lcyBub3QgcmVmbGVjdDtcbiAqICAgLSBgZGVsZXRlZGAgIFx1MjAxNCBpbmRleCBlbnRyeSBsaXZlLCBmaWxlIGdvbmU7XG4gKiAgIC0gYHJlbmFtZWRgICBcdTIwMTQgYSBkZWxldGUgKyBhZGQgcGFpciAqd2l0aGluIG9uZSBzY2FuKiB3aG9zZSBjb250ZW50XG4gKiAgICAgICAgICAgICAgICAgIGhhc2hlcyBtYXRjaCAoQVJDSElURUNUVVJFIFx1MDBBNzQgcmVuYW1lIGNvcnJlbGF0aW9uKS4gQVxuICogICAgICAgICAgICAgICAgICByZW5hbWUgd2hvc2UgY29udGVudCBhbHNvIGNoYW5nZWQgKHJlbmFtZSArIGVkaXQpIG5vXG4gKiAgICAgICAgICAgICAgICAgIGxvbmdlciBjb3JyZWxhdGVzIGFuZCBmYWxscyBiYWNrIHRvIGRlbGV0ZSArIGFkZCBcdTIwMTQgdGhhdFxuICogICAgICAgICAgICAgICAgICBpcyB0aGUgZG9jdW1lbnRlZCwgY29ycmVjdCB2MSBiZWhhdmlvcjtcbiAqICAgLSBgZW1wdHlGb2xkZXJzYCBcdTIwMTQgZGlyZWN0b3JpZXMgZXhpc3RpbmcgaW4gc3RvcmFnZSBidXQgcmVwcmVzZW50ZWRcbiAqICAgICAgICAgICAgICAgICAgbmVpdGhlciBieSBhIGxpdmUgZm9sZGVyIHBsYWNlaG9sZGVyIGluIHRoZSBpbmRleCBub3IgYnlcbiAqICAgICAgICAgICAgICAgICAgYW55IGZpbGUgYmVuZWF0aCB0aGVtIChGUi0xMCk7XG4gKiAgIC0gYGZvbGRlckRlbGV0aW9uc2AgXHUyMDE0IGxpdmUgZm9sZGVyIHBsYWNlaG9sZGVyIGVudHJpZXMgd2hvc2UgZGlyZWN0b3J5XG4gKiAgICAgICAgICAgICAgICAgIG5vIGxvbmdlciBleGlzdHMgaW4gc3RvcmFnZTogdGhlIHVzZXIgZGVsZXRlZCBhbiBlbXB0eVxuICogICAgICAgICAgICAgICAgICBmb2xkZXIgKG9yIHBydW5lLW9uLWRlbGV0ZSByZW1vdmVkIGl0LCBgZW5naW5lLnRzYCksIGFuZFxuICogICAgICAgICAgICAgICAgICB0aGUgZGVsZXRpb24gbXVzdCBwcm9wYWdhdGUgYXMgYSBmb2xkZXIgdG9tYnN0b25lLiBUaGVcbiAqICAgICAgICAgICAgICAgICAgYnVja2V0IGlzIFNFUEFSQVRFIGZyb20gYGRlbGV0ZWRgIG9uIHB1cnBvc2U6IGZvbGRlclxuICogICAgICAgICAgICAgICAgICBwbGFjZWhvbGRlcnMgY2Fycnkgbm8gY29udGVudCBoYXNoLCBtdXN0IG5ldmVyIGVudGVyXG4gKiAgICAgICAgICAgICAgICAgIHJlbmFtZSBjb3JyZWxhdGlvbiwgYW5kIHJlc29sdmUgYXMgcGxhY2Vob2xkZXJzXG4gKiAgICAgICAgICAgICAgICAgIChgaXNGb2xkZXJgKSBkb3duc3RyZWFtLiBBIHBsYWNlaG9sZGVyIHRoYXQgbWVyZWx5IGJlY2FtZVxuICogICAgICAgICAgICAgICAgICBpZ25vcmVkIChzZXR0aW5ncyBjaGFuZ2UpIGlzIE5PVCBhIGRlbGV0aW9uIFx1MjAxNCBpdCBpc1xuICogICAgICAgICAgICAgICAgICBza2lwcGVkLCBleGFjdGx5IGxpa2UgaWdub3JlZCBmaWxlcy5cbiAqICAgLSBgc3RhbGVEaXJzYCBcdTIwMTQgZGlyZWN0b3JpZXMgd2hvc2UgaW5kZXggZW50cnkgaXMgYSBUT01CU1RPTkVEIGZvbGRlclxuICogICAgICAgICAgICAgICAgICBwbGFjZWhvbGRlciB3aGlsZSBhbiBFTVBUWSBkaXJlY3Rvcnkgc3RpbGwgZXhpc3RzIG9uIGRpc2tcbiAqICAgICAgICAgICAgICAgICAgQU5EIHRoZSB0b21ic3RvbmUgd2FzIGF1dGhvcmVkIGJ5IEFOT1RIRVIgZGV2aWNlOiB0aGVcbiAqICAgICAgICAgICAgICAgICAgcmVzaWR1ZSBvZiBhIHJlY29yZC1vbmx5IHRvbWJzdG9uZSBhcHBsaWNhdGlvbiAoYW4gYWRhcHRlclxuICogICAgICAgICAgICAgICAgICB3aXRob3V0IGByZW1vdmVEaXJgLCBvciBhIHJlbW92YWwgdGhhdCBsb3N0IGEgcmFjZSkuIFRoZVxuICogICAgICAgICAgICAgICAgICBsZWZ0b3ZlciBpcyBDT05TSVNURU5UIHdpdGggdGhlIChyZW1vdGUpIGRlbGV0aW9uLCBzbyBpdFxuICogICAgICAgICAgICAgICAgICBtdXN0IE5PVCByZXN1cnJlY3QgYXMgXCJsb2NhbCB3aW5zXCI6IHJlLXB1c2hpbmcgaXQgYXMgYW5cbiAqICAgICAgICAgICAgICAgICAgZW1wdHktZm9sZGVyIHBsYWNlaG9sZGVyIHdvdWxkIHVuZG8gYSBkZWxldGlvbiB0aGUgdXNlclxuICogICAgICAgICAgICAgICAgICBtYWRlIGFuZCBwaW5nLXBvbmcgaXQgYmV0d2VlbiBkZXZpY2VzIGZvcmV2ZXIgKG9ic2VydmVkXG4gKiAgICAgICAgICAgICAgICAgIGVuZC10by1lbmQ6IEEgZGVsZXRlcyBcdTIxOTIgQiByZWNvcmRzLW9ubHkgXHUyMTkyIEIgcmUtcHVzaGVzIFx1MjE5MlxuICogICAgICAgICAgICAgICAgICBBIHJlLXB1bGxzKS4gVGhlIGVudHJ5IHN0YXlzIHRvbWJzdG9uZWQ7IHRoZSBjbGllbnQgcmV0cmllc1xuICogICAgICAgICAgICAgICAgICBgcmVtb3ZlRGlyYCBmb3IgdGhlc2UgZGlycyBlYWNoIGN5Y2xlIChjbGllbnQudHMpLiBJZiB0aGVcbiAqICAgICAgICAgICAgICAgICAgdG9tYnN0b25lIHdhcyBhdXRob3JlZCBieSBUSElTIGRldmljZSwgb3IgY29udGVudCBleGlzdHNcbiAqICAgICAgICAgICAgICAgICAgYmVuZWF0aCB0aGUgZGlyZWN0b3J5LCB0aGlzIGlzIGdlbnVpbmUgbG9jYWwgcmVjcmVhdGlvbjpcbiAqICAgICAgICAgICAgICAgICAgdGhlIGRpciBsYW5kcyBpbiBgZW1wdHlGb2xkZXJzYCBpbnN0ZWFkLCByZXN0b3JpbmcgdGhlXG4gKiAgICAgICAgICAgICAgICAgIHBsYWNlaG9sZGVyIFx1MjAxNCBsb2NhbCB3aW5zIGlzIGNvcnJlY3QgdGhlcmUuXG4gKlxuICogIyMgVGhlIG10aW1lK3NpemUgcHJlLWZpbHRlciAoZmFzdCBtb2RlLCB0aGUgZGVmYXVsdClcbiAqXG4gKiBSZS1oYXNoaW5nIGEgNTBrLWZpbGUgdmF1bHQgYXQgZXZlcnkgYXBwLW9wZW4gaXMgYSByZWFsIGJhdHRlcnkgY29zdCwgc29cbiAqIGZhc3QgbW9kZSBza2lwcyBoYXNoaW5nIGEgZmlsZSB3aG9zZSBgc2l6ZWAgQU5EIGBtdGltZWAgKGZyb20gdGhlIHN0b3JhZ2VcbiAqIGFkYXB0ZXIncyBgRmlsZVN0YXRgKSBleGFjdGx5IG1hdGNoIGl0cyBsaXZlIGluZGV4IGVudHJ5IFx1MjAxNCB0aGUgcmVjb3JkZWRcbiAqIGhhc2ggY2FycmllcyBmb3J3YXJkIGFzIHVuY2hhbmdlZC4gQSBmaWxlIGlzIGhhc2hlZCB3aGVuIGl0IGhhcyBubyBlbnRyeSxcbiAqIHRoZSBlbnRyeSBpcyBhIHRvbWJzdG9uZSBvciBmb2xkZXIgcGxhY2Vob2xkZXIsIHRoZSBzaXplIGRpZmZlcnMsIG9yIHRoZVxuICogbXRpbWUgZGlmZmVycyBvciBpcyB1bmtub3duIChsZWdhY3kgc3RhdGUsIHB1bGxzLCBmaXJzdCBzY2FuKS4gUmVuYW1lXG4gKiBjb3JyZWxhdGlvbiBpcyB1bmFmZmVjdGVkOiB0aGUgZGVzdGluYXRpb24gcGF0aCBvZiBhIHJlbmFtZSBhbHdheXMgbG9va3NcbiAqICdhZGRlZCcsIHNvIGl0IGlzIGFsd2F5cyBoYXNoZWQgXHUyMDE0IGNvbnRlbnQtcHJlc2VydmluZyBtb3ZlcyBzdGlsbCBwYWlyLlxuICpcbiAqIFRoZSB0cmFkZW9mZjogZmFzdCBtb2RlIHRydXN0cyB0aGUgZmlsZXN5c3RlbSBub3QgdG8gY2hhbmdlIGNvbnRlbnQgd2hpbGVcbiAqIHByZXNlcnZpbmcgYm90aCBzaXplIGFuZCBtdGltZS4gRm9yIHZlcmlmaWNhdGlvbiAoYHZzYSBkb2N0b3JgLCBwZXJpb2RpY1xuICogaW50ZWdyaXR5IGNoZWNrcykgcGFzcyBgeyBtb2RlOiAnZnVsbCcgfWAgdG8gcmUtaGFzaCBldmVyeXRoaW5nLlxuICpcbiAqIFRoZSBmdW5jdGlvbiB0YWtlcyBgbm93YCBhbmQgdGhlIGlnbm9yZSBzZXR0aW5ncyBhcyBwYXJhbWV0ZXJzIChubyBoaWRkZW5cbiAqIGNsb2Nrcywgbm8gYW1iaWVudCBjb25maWcpIGFuZCByZXR1cm5zIGRldGVybWluaXN0aWNhbGx5IG9yZGVyZWQgcmVzdWx0c1xuICogKGV2ZXJ5IGJ1Y2tldCBzb3J0ZWQgYnkgcGF0aDsgcmVuYW1lcyBieSBgZnJvbWApLlxuICovXG5cbmltcG9ydCB0eXBlIHsgRmlsZVN0YXQsIFN0b3JhZ2VBZGFwdGVyIH0gZnJvbSAnLi9hZGFwdGVycy5qcyc7XG5pbXBvcnQgeyBzaGEyNTZIZXggfSBmcm9tICcuL2hhc2hpbmcuanMnO1xuaW1wb3J0IHsgaXNJZ25vcmVkLCB0eXBlIElnbm9yZVNldHRpbmdzIH0gZnJvbSAnLi9pZ25vcmUuanMnO1xuaW1wb3J0IHR5cGUgeyBMb2NhbEluZGV4LCBMb2NhbEluZGV4RW50cnkgfSBmcm9tICcuL2xvY2FsaW5kZXguanMnO1xuaW1wb3J0IHsgcGFyZW50UGF0aCB9IGZyb20gJy4vcGF0aHMuanMnO1xuXG4vKiogSW5qZWN0YWJsZSBjb250ZW50IGhhc2ggKHRoZSBkZWZhdWx0IGlzIHNoYTI1Niwgc2FtZSBhcyBibG9iIGFkZHJlc3NpbmcpLiAqL1xuZXhwb3J0IHR5cGUgSGFzaEZuID0gKGJ5dGVzOiBVaW50OEFycmF5KSA9PiBQcm9taXNlPHN0cmluZz47XG5cbi8qKiBPcHRpb25zIGZvciBgc2NhblZhdWx0YC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU2NhblZhdWx0T3B0aW9ucyB7XG4gIC8qKlxuICAgKiBgJ2Zhc3QnYCAoZGVmYXVsdCk6IGZpbGVzIHdob3NlIHNpemUrbXRpbWUgZXhhY3RseSBtYXRjaCB0aGVpciBsaXZlIGluZGV4XG4gICAqIGVudHJ5IHNraXAgcmUtaGFzaGluZy4gYCdmdWxsJ2A6IGhhc2ggZXZlcnl0aGluZyByZWdhcmRsZXNzIFx1MjAxNCBpbnRlZ3JpdHlcbiAgICogdmVyaWZpY2F0aW9uIChgdnNhIGRvY3RvcmAsIHBlcmlvZGljIGNoZWNrcykuXG4gICAqL1xuICBtb2RlPzogJ2Zhc3QnIHwgJ2Z1bGwnO1xuICAvKiogQ29udGVudCBoYXNoIG92ZXJyaWRlICh0ZXN0cyBjb3VudC9pbnNwZWN0IGhhc2hpbmcpLiBEZWZhdWx0OiBzaGEyNTZIZXguICovXG4gIGhhc2g/OiBIYXNoRm47XG4gIC8qKlxuICAgKiBCdWxrLXNjYW4gcHJvZ3Jlc3M6IGNhbGxlZCBvbmNlIHdpdGggKDAsIHRvdGFsKSBiZWZvcmUgdGhlIHdhbGsgYW5kIG9uY2VcbiAgICogcGVyIGZpbGUgYWZ0ZXJ3YXJkcyAoYGRvbmVgIGNvdW50cyBoYXNoZWQgQU5EIGZhc3QtcGF0aC1za2lwcGVkIGZpbGVzKS5cbiAgICogUHVyZSByZXBvcnRpbmcgXHUyMDE0IG5ldmVyIGFmZmVjdHMgdGhlIHNjYW4ncyBkZWNpc2lvbnMuXG4gICAqL1xuICBvblByb2dyZXNzPzogKGRvbmU6IG51bWJlciwgdG90YWw6IG51bWJlcikgPT4gdm9pZDtcbiAgLyoqXG4gICAqIFRoaXMgZGV2aWNlJ3MgaWQsIHdoZW4gdGhlIGNhbGxlciBpcyBhIHN5bmNpbmcgY2xpZW50LiBTaGFycGVucyB0aGVcbiAgICogdG9tYnN0b25lZC1wbGFjZWhvbGRlciBydWxlIChgc3RhbGVEaXJzYCk6IGFuIEVNUFRZIGRpcmVjdG9yeSBvdmVyIGFcbiAgICogdG9tYnN0b25lZCBwbGFjZWhvbGRlciBpcyB0aGUgcmVjb3JkLW9ubHkgcmVzaWR1ZSBvZiBhIFJFTU9URSBkZWxldGlvblxuICAgKiAobmV2ZXIgcmVzdXJyZWN0ZWQpLCBidXQgb3ZlciBhIHRvbWJzdG9uZSBUSElTIGRldmljZSBhdXRob3JlZCBpdCBtZWFuc1xuICAgKiB0aGUgdXNlciByZS1jcmVhdGVkIHRoZSBmb2xkZXIgaGVyZSBcdTIwMTQgcmVzdG9yZSBpdCAocHVzaCB0aGUgcGxhY2Vob2xkZXIpLlxuICAgKiBPbWl0dGVkIChvciBub24tZm9sZGVyIHNjYW5zKTogb25seSB0aGUgY29udGVudCB0ZXN0IGRlY2lkZXMuXG4gICAqL1xuICB0aGlzRGV2aWNlSWQ/OiBzdHJpbmc7XG59XG5cbi8qKiBBIGxvY2FsIGNvbnRlbnQgY2hhbmdlIGZvciBhIHBhdGggdGhhdCBleGlzdHMgaW4gc3RvcmFnZS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU2NhbkNhbmRpZGF0ZSB7XG4gIHBhdGg6IHN0cmluZztcbiAgaGFzaDogc3RyaW5nO1xuICBzaXplOiBudW1iZXI7XG59XG5cbi8qKiBBIGxvY2FsIGRlbGV0aW9uOiBjYXJyaWVzIHRoZSBpbmRleCdzIHZlcnNpb24gc28gdGhlIHRvbWJzdG9uZSBjb21taXQgbmFtZXMgaXRzIHBhcmVudC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRGVsZXRlZENhbmRpZGF0ZSB7XG4gIHBhdGg6IHN0cmluZztcbiAgLyoqIEhhc2ggb2YgdGhlIGNvbnRlbnQgYXMgbGFzdCBzeW5jZWQgKHRvbWJzdG9uZXMgcmV1c2UgaXQpLiAqL1xuICBoYXNoOiBzdHJpbmc7XG4gIHNpemU6IG51bWJlcjtcbiAgLyoqIFZlcnNpb24gaWQgdGhlIGRlbGV0aW9uIGNvbW1pdCBidWlsZHMgb24uICovXG4gIHZlcnNpb25JZDogc3RyaW5nO1xufVxuXG4vKiogQSBkZXRlY3RlZCByZW5hbWU6IHNhbWUgY29udGVudCBoYXNoIG1vdmVkIGZyb20gYGZyb21gIHRvIGB0b2AuICovXG5leHBvcnQgaW50ZXJmYWNlIFJlbmFtZUNhbmRpZGF0ZSB7XG4gIGZyb206IHN0cmluZztcbiAgdG86IHN0cmluZztcbiAgaGFzaDogc3RyaW5nO1xuICBzaXplOiBudW1iZXI7XG59XG5cbi8qKlxuICogQSBsaXZlIGZvbGRlciBwbGFjZWhvbGRlciB3aG9zZSBkaXJlY3RvcnkgdmFuaXNoZWQgZnJvbSBzdG9yYWdlOiB0aGVcbiAqIGRlbGV0aW9uIG11c3QgcHJvcGFnYXRlIGFzIGEgZm9sZGVyIHRvbWJzdG9uZSAoa2luZCBgJ2RlbGV0ZSdgLFxuICogYGlzRm9sZGVyOiB0cnVlYCkuIENhcnJpZXMgdGhlIHBsYWNlaG9sZGVyJ3MgdmVyc2lvbiBpZCBzbyB0aGUgdG9tYnN0b25lXG4gKiBjb21taXQgbmFtZXMgaXRzIHBhcmVudDsgaGFzaC9zaXplIGFyZSB0aGUgcGxhY2Vob2xkZXIgY29uc3RhbnRzXG4gKiAoYCcnYC9gMGApIGFuZCBhcmUgcmUtZGVyaXZlZCBkb3duc3RyZWFtIHJhdGhlciB0aGFuIGNhcnJpZWQuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRm9sZGVyRGVsZXRpb25DYW5kaWRhdGUge1xuICBwYXRoOiBzdHJpbmc7XG4gIC8qKiBWZXJzaW9uIGlkIG9mIHRoZSBwbGFjZWhvbGRlciBoZWFkIHRoZSB0b21ic3RvbmUgY29tbWl0IGJ1aWxkcyBvbi4gKi9cbiAgdmVyc2lvbklkOiBzdHJpbmc7XG59XG5cbi8qKlxuICogQSBmaWxlIHRoaXMgc2NhbiBhY3R1YWxseSByZWFkIGFuZCBoYXNoZWQsIHdpdGggdGhlIHN0YXQgb2JzZXJ2ZWQgYXQgaGFzaFxuICogdGltZS4gRmVlZHMgYHJlY29yZEhhc2hlZEZpbGVzYCBzbyB0aGUgTkVYVCBmYXN0IHNjYW4gY2FuIHNraXAgdGhlc2UgZmlsZXNcbiAqICh0aGUgbXRpbWUgY2FjaGUgb24gdGhlIGluZGV4IGVudHJ5KS4gRmlsZXMgc2tpcHBlZCBieSB0aGUgcHJlLWZpbHRlciBhcmUsXG4gKiBieSBkZWZpbml0aW9uLCBub3QgaGFzaGVkIGFuZCBkbyBub3QgYXBwZWFyIGhlcmUuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSGFzaGVkRmlsZSB7XG4gIHBhdGg6IHN0cmluZztcbiAgaGFzaDogc3RyaW5nO1xuICBzaXplOiBudW1iZXI7XG4gIC8qKiBFcG9jaCBtcyBcdTIwMTQgdGhlIHN0b3JhZ2Ugc3RhdCBhdCBoYXNoIHRpbWUgKGBGaWxlU3RhdC5tdGltZWApLiAqL1xuICBtdGltZTogbnVtYmVyO1xufVxuXG4vKiogVGhlIGZ1bGwgcmVzdWx0IG9mIG9uZSBsb2NhbCBzY2FuLiBBbGwgYnVja2V0cyBzb3J0ZWQgYnkgcGF0aC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgTG9jYWxDaGFuZ2VzIHtcbiAgLyoqIFRoZSBgbm93YCBwYXNzZWQgaW4gXHUyMDE0IHdoZW4gdGhpcyBzY2FuIGNvbmNlcHR1YWxseSBoYXBwZW5lZC4gKi9cbiAgc2Nhbm5lZEF0OiBudW1iZXI7XG4gIGFkZGVkOiBTY2FuQ2FuZGlkYXRlW107XG4gIG1vZGlmaWVkOiBTY2FuQ2FuZGlkYXRlW107XG4gIGRlbGV0ZWQ6IERlbGV0ZWRDYW5kaWRhdGVbXTtcbiAgcmVuYW1lZDogUmVuYW1lQ2FuZGlkYXRlW107XG4gIC8qKiBFbXB0eS1mb2xkZXIgcGF0aHMgdG8gcHVzaCBhcyBwbGFjZWhvbGRlciBlbnRyaWVzIChGUi0xMCkuICovXG4gIGVtcHR5Rm9sZGVyczogc3RyaW5nW107XG4gIC8qKlxuICAgKiBMaXZlIGZvbGRlciBwbGFjZWhvbGRlcnMgd2hvc2UgZGlyZWN0b3J5IG5vIGxvbmdlciBleGlzdHMgaW4gc3RvcmFnZSBcdTIwMTRcbiAgICogZm9sZGVyIGRlbGV0aW9ucyB0byBwdXNoIGFzIHRvbWJzdG9uZXMgKGtpbmQgYCdkZWxldGUnYCwgYGlzRm9sZGVyYCkuXG4gICAqL1xuICBmb2xkZXJEZWxldGlvbnM6IEZvbGRlckRlbGV0aW9uQ2FuZGlkYXRlW107XG4gIC8qKlxuICAgKiBEaXJlY3RvcmllcyB3aG9zZSBpbmRleCBlbnRyeSBpcyBhIFRPTUJTVE9ORUQgZm9sZGVyIHBsYWNlaG9sZGVyIHdoaWxlIGFuXG4gICAqIEVNUFRZIGRpcmVjdG9yeSBzdGlsbCBleGlzdHMgb24gZGlzayAocmVjb3JkLW9ubHkgdG9tYnN0b25lIGFwcGxpY2F0aW9uIFx1MjAxNFxuICAgKiBzZWUgdGhlIG1vZHVsZSBkb2MpLiBPbWl0dGVkIChub3QgbWVyZWx5IGVtcHR5KSB3aGVuIHRoZXJlIGFyZSBub25lLCBzb1xuICAgKiB3aG9sZS1vYmplY3QgY29tcGFyaXNvbnMgb2YgYExvY2FsQ2hhbmdlc2Agc3RheSBzdGFibGUgZm9yIGNsZWFuIHNjYW5zLlxuICAgKi9cbiAgc3RhbGVEaXJzPzogc3RyaW5nW107XG4gIC8qKiBFdmVyeSBmaWxlIHRoZSBzY2FuIGhhc2hlZCAoZmFzdCBtb2RlJ3Mgc2tpcHBlZCBmaWxlcyBhcmUgYWJzZW50KSwgc29ydGVkIGJ5IHBhdGguICovXG4gIGhhc2hlZDogSGFzaGVkRmlsZVtdO1xufVxuXG4vKipcbiAqIFNjYW4gdGhlIHZhdWx0IGFuZCBkaWZmIGl0IGFnYWluc3QgdGhlIGluZGV4LlxuICpcbiAqIEluIGZhc3QgbW9kZSAodGhlIGRlZmF1bHQpIGEgZmlsZSB3aG9zZSBzaXplIGFuZCBtdGltZSBib3RoIGV4YWN0bHkgbWF0Y2hcbiAqIGl0cyBsaXZlIGluZGV4IGVudHJ5IGlzIE5PVCByZS1oYXNoZWQgXHUyMDE0IHRoZSByZWNvcmRlZCBoYXNoIGNhcnJpZXMgZm9yd2FyZFxuICogYXMgdW5jaGFuZ2VkIChzZWUgdGhlIG1vZHVsZSBkb2MgZm9yIHRoZSB0cmFkZW9mZiBhbmQgdGhlIGBmdWxsYCBlc2NhcGVcbiAqIGhhdGNoKS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHNjYW5WYXVsdChcbiAgc3RvcmFnZTogU3RvcmFnZUFkYXB0ZXIsXG4gIGluZGV4OiBMb2NhbEluZGV4LFxuICBzZXR0aW5nczogSWdub3JlU2V0dGluZ3MsXG4gIG5vdzogbnVtYmVyLFxuICBvcHRpb25zOiBTY2FuVmF1bHRPcHRpb25zID0ge30sXG4pOiBQcm9taXNlPExvY2FsQ2hhbmdlcz4ge1xuICBjb25zdCBoYXNoRm4gPSBvcHRpb25zLmhhc2ggPz8gc2hhMjU2SGV4O1xuICBjb25zdCBtb2RlID0gb3B0aW9ucy5tb2RlID8/ICdmYXN0JztcbiAgY29uc3Qgb25Qcm9ncmVzcyA9IG9wdGlvbnMub25Qcm9ncmVzcztcbiAgY29uc3QgdGhpc0RldmljZUlkID0gb3B0aW9ucy50aGlzRGV2aWNlSWQ7XG5cbiAgY29uc3QgZmlsZXMgPSBhd2FpdCBzdG9yYWdlLmxpc3RGaWxlcygpO1xuXG4gIGNvbnN0IGtlcHQ6IEZpbGVTdGF0W10gPSBbXTtcbiAgZm9yIChjb25zdCBmaWxlIG9mIGZpbGVzKSB7XG4gICAgaWYgKCFpc0lnbm9yZWQoZmlsZS5wYXRoLCBzZXR0aW5ncykpIGtlcHQucHVzaChmaWxlKTtcbiAgfVxuICBjb25zdCBrZXB0UGF0aHMgPSBuZXcgU2V0KGtlcHQubWFwKChmKSA9PiBmLnBhdGgpKTtcblxuICBjb25zdCBhZGRlZDogU2NhbkNhbmRpZGF0ZVtdID0gW107XG4gIGNvbnN0IG1vZGlmaWVkOiBTY2FuQ2FuZGlkYXRlW10gPSBbXTtcbiAgY29uc3QgaGFzaGVkOiBIYXNoZWRGaWxlW10gPSBbXTtcblxuICBvblByb2dyZXNzPy4oMCwga2VwdC5sZW5ndGgpO1xuICBsZXQgc2Nhbm5lZCA9IDA7XG4gIGZvciAoY29uc3QgZmlsZSBvZiBrZXB0KSB7XG4gICAgY29uc3QgZW50cnkgPSBpbmRleFtmaWxlLnBhdGhdO1xuICAgIGlmIChtb2RlID09PSAnZmFzdCcgJiYgc3RhdE1hdGNoZXNFbnRyeShlbnRyeSwgZmlsZSkpIHtcbiAgICAgIHNjYW5uZWQgKz0gMTtcbiAgICAgIG9uUHJvZ3Jlc3M/LihzY2FubmVkLCBrZXB0Lmxlbmd0aCk7XG4gICAgICBjb250aW51ZTsgLy8gc2l6ZSttdGltZSB1bmNoYW5nZWQgc2luY2UgdGhlIHJlY29yZGVkIGhhc2ggXHUyMDE0IHRydXN0IGl0XG4gICAgfVxuICAgIGNvbnN0IGhhc2ggPSBhd2FpdCBoYXNoRm4oYXdhaXQgc3RvcmFnZS5yZWFkRmlsZShmaWxlLnBhdGgpKTtcbiAgICBoYXNoZWQucHVzaCh7IHBhdGg6IGZpbGUucGF0aCwgaGFzaCwgc2l6ZTogZmlsZS5zaXplLCBtdGltZTogZmlsZS5tdGltZSB9KTtcbiAgICBzY2FubmVkICs9IDE7XG4gICAgb25Qcm9ncmVzcz8uKHNjYW5uZWQsIGtlcHQubGVuZ3RoKTtcbiAgICBpZiAoZW50cnkgPT09IHVuZGVmaW5lZCkge1xuICAgICAgYWRkZWQucHVzaCh7IHBhdGg6IGZpbGUucGF0aCwgaGFzaCwgc2l6ZTogZmlsZS5zaXplIH0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChlbnRyeS5pc0ZvbGRlcikge1xuICAgICAgLy8gQSByZWFsIGZpbGUgcmVwbGFjZWQgYSBmb2xkZXIgcGxhY2Vob2xkZXI6IHRyZWF0IGFzIGNvbnRlbnQgY2hhbmdlLlxuICAgICAgbW9kaWZpZWQucHVzaCh7IHBhdGg6IGZpbGUucGF0aCwgaGFzaCwgc2l6ZTogZmlsZS5zaXplIH0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIC8vIFRvbWJzdG9uZWQgZW50cnkgd2l0aCB0aGUgZmlsZSBiYWNrIFx1MjFEMiBtb2RpZmllZCAocmVzdXJyZWN0IG9yXG4gICAgLy8gZWRpdC1vZi1kZWxldGVkIFx1MjAxNCBib3RoIHJlc29sdmUgdGhlIHNhbWUgd2F5IGRvd25zdHJlYW0pLlxuICAgIGlmIChlbnRyeS5kZWxldGVkQXQgIT09IHVuZGVmaW5lZCB8fCBlbnRyeS5oYXNoICE9PSBoYXNoKSB7XG4gICAgICBtb2RpZmllZC5wdXNoKHsgcGF0aDogZmlsZS5wYXRoLCBoYXNoLCBzaXplOiBmaWxlLnNpemUgfSk7XG4gICAgfVxuICB9XG5cbiAgY29uc3QgZGVsZXRlZDogRGVsZXRlZENhbmRpZGF0ZVtdID0gW107XG4gIGZvciAoY29uc3QgW3BhdGgsIGVudHJ5XSBvZiBPYmplY3QuZW50cmllcyhpbmRleCkpIHtcbiAgICBpZiAoZW50cnkuaXNGb2xkZXIpIGNvbnRpbnVlOyAvLyBmb2xkZXIgcGxhY2Vob2xkZXJzIG5ldmVyIHByb2R1Y2UgZmlsZSBkZWxldGlvbnNcbiAgICBpZiAoZW50cnkuZGVsZXRlZEF0ICE9PSB1bmRlZmluZWQpIGNvbnRpbnVlOyAvLyBhbHJlYWR5IHRvbWJzdG9uZWRcbiAgICBpZiAoa2VwdFBhdGhzLmhhcyhwYXRoKSkgY29udGludWU7XG4gICAgaWYgKGlzSWdub3JlZChwYXRoLCBzZXR0aW5ncykpIHtcbiAgICAgIC8vIFRoZSBwYXRoIGJlY2FtZSBpZ25vcmVkIChzZXR0aW5ncyBjaGFuZ2UpIFx1MjAxNCBub3QgYSBkZWxldGlvbi5cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBkZWxldGVkLnB1c2goeyBwYXRoLCBoYXNoOiBlbnRyeS5oYXNoLCBzaXplOiBlbnRyeS5zaXplLCB2ZXJzaW9uSWQ6IGVudHJ5LnZlcnNpb25JZCB9KTtcbiAgfVxuXG4gIGNvbnN0IHsgcmVuYW1lZCwgZGVsZXRlZDogdW5tYXRjaGVkRGVsZXRlZCwgYWRkZWQ6IHVubWF0Y2hlZEFkZGVkIH0gPSBkZXRlY3RSZW5hbWVzKGRlbGV0ZWQsIGFkZGVkKTtcbiAgY29uc3QgZGlycyA9IGF3YWl0IHN0b3JhZ2UubGlzdERpcnMoKTtcbiAgY29uc3QgeyBlbXB0eUZvbGRlcnMsIHN0YWxlRGlycyB9ID0gZGV0ZWN0RW1wdHlGb2xkZXJzKGluZGV4LCBzZXR0aW5ncywgZmlsZXMsIGRpcnMsIHRoaXNEZXZpY2VJZCk7XG4gIGNvbnN0IGZvbGRlckRlbGV0aW9ucyA9IGRldGVjdEZvbGRlckRlbGV0aW9ucyhpbmRleCwgc2V0dGluZ3MsIGRpcnMpO1xuXG4gIHJldHVybiB7XG4gICAgc2Nhbm5lZEF0OiBub3csXG4gICAgYWRkZWQ6IHNvcnRDYW5kaWRhdGVzKHVubWF0Y2hlZEFkZGVkKSxcbiAgICBtb2RpZmllZDogc29ydENhbmRpZGF0ZXMobW9kaWZpZWQpLFxuICAgIGRlbGV0ZWQ6IFsuLi51bm1hdGNoZWREZWxldGVkXS5zb3J0KGJ5UGF0aCksXG4gICAgcmVuYW1lZDogWy4uLnJlbmFtZWRdLnNvcnQoKGEsIGIpID0+IGJ5UGF0aChhLCBiKSksXG4gICAgZW1wdHlGb2xkZXJzLFxuICAgIGZvbGRlckRlbGV0aW9ucyxcbiAgICAvLyBPbWl0dGVkIHdoZW4gZW1wdHkgKG5vdCBgW11gKSBcdTIwMTQgc2VlIHRoZSBmaWVsZCdzIGRvYy5cbiAgICAuLi4oc3RhbGVEaXJzLmxlbmd0aCA+IDAgPyB7IHN0YWxlRGlycyB9IDoge30pLFxuICAgIGhhc2hlZDogWy4uLmhhc2hlZF0uc29ydChieVBhdGgpLFxuICB9O1xufVxuXG4vKipcbiAqIFdoZXRoZXIgdGhlIGZpbGUncyBzdGF0IGV4YWN0bHkgbWF0Y2hlcyBpdHMgbGl2ZSBpbmRleCBlbnRyeSBcdTIwMTQgdGhlIGZhc3RcbiAqIG1vZGUgcHJlLWZpbHRlci4gUmVxdWlyZXMgYSBrbm93biByZWNvcmRlZCBgbXRpbWVgIChsZWdhY3kgZW50cmllcyBhbmRcbiAqIHB1bGwtd3JpdHRlbiBlbnRyaWVzIGhhdmUgbm9uZSBcdTIxRDIgaGFzaGVkLCB0aGVuIHJlY29yZGVkKSBhbmQgbmV2ZXIgZmlyZXNcbiAqIGZvciB0b21ic3RvbmVzIChhIHJlc3VycmVjdCBtdXN0IGFsd2F5cyBzdXJmYWNlKSBvciBmb2xkZXIgcGxhY2Vob2xkZXJzLlxuICovXG5mdW5jdGlvbiBzdGF0TWF0Y2hlc0VudHJ5KGVudHJ5OiBMb2NhbEluZGV4RW50cnkgfCB1bmRlZmluZWQsIGZpbGU6IEZpbGVTdGF0KTogYm9vbGVhbiB7XG4gIHJldHVybiAoXG4gICAgZW50cnkgIT09IHVuZGVmaW5lZCAmJlxuICAgIGVudHJ5LmRlbGV0ZWRBdCA9PT0gdW5kZWZpbmVkICYmXG4gICAgZW50cnkuaXNGb2xkZXIgIT09IHRydWUgJiZcbiAgICBlbnRyeS5tdGltZSAhPT0gdW5kZWZpbmVkICYmXG4gICAgZW50cnkubXRpbWUgPT09IGZpbGUubXRpbWUgJiZcbiAgICBlbnRyeS5zaXplID09PSBmaWxlLnNpemVcbiAgKTtcbn1cblxuLyoqXG4gKiBSZWNvcmQgYSBzY2FuJ3MgaGFzaCBvYnNlcnZhdGlvbnMgaW50byB0aGUgaW5kZXg6IGZvciBldmVyeSBsaXZlIGZpbGVcbiAqIGVudHJ5IHdob3NlIGNvbnRlbnQgaGFzaCBtYXRjaGVzIHdoYXQgdGhlIHNjYW4gaGFzaGVkLCBjYWNoZSB0aGUgb2JzZXJ2ZWRcbiAqIG10aW1lIHNvIHRoZSBuZXh0IGZhc3Qgc2NhbiBjYW4gc2tpcCByZS1oYXNoaW5nIGl0LlxuICpcbiAqIFB1cmU6IHJldHVybnMgYSBuZXcgaW5kZXggKG9yIHRoZSBpbnB1dCB3aGVuIG5vdGhpbmcgY2hhbmdlcyksIG5ldmVyXG4gKiBtdXRhdGVzLiBUaGUgaGFzaC1tYXRjaCBndWFyZCBrZWVwcyB0aGUgY2FjaGUgaG9uZXN0IFx1MjAxNCBhbiBlbnRyeSB3aG9zZVxuICogaGFzaCBubyBsb25nZXIgcmVmbGVjdHMgdGhlIG9ic2VydmF0aW9uIChlLmcuIGEgcHVsbCBvdmVyd3JvdGUgdGhlIHBhdGhcbiAqIG1pZC1jeWNsZSkgaXMgbGVmdCB1bnRvdWNoZWQgYW5kIHNpbXBseSBnZXRzIHJlLWhhc2hlZCBuZXh0IHNjYW4uXG4gKiBFbnRyaWVzIG5ldmVyIGRlbW90ZTogYGRlbGV0ZWRBdGAvYGlzRm9sZGVyYCBlbnRyaWVzIGFyZSBuZXZlciBwYXRjaGVkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVjb3JkSGFzaGVkRmlsZXMoXG4gIGluZGV4OiBMb2NhbEluZGV4LFxuICBoYXNoZWQ6IHJlYWRvbmx5IEhhc2hlZEZpbGVbXSxcbik6IExvY2FsSW5kZXgge1xuICBsZXQgbmV4dDogUmVjb3JkPHN0cmluZywgTG9jYWxJbmRleEVudHJ5PiB8IHVuZGVmaW5lZDtcbiAgZm9yIChjb25zdCBvYnNlcnZlZCBvZiBoYXNoZWQpIHtcbiAgICBjb25zdCBlbnRyeSA9IGluZGV4W29ic2VydmVkLnBhdGhdO1xuICAgIGlmIChlbnRyeSA9PT0gdW5kZWZpbmVkIHx8IGVudHJ5LmlzRm9sZGVyIHx8IGVudHJ5LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkKSBjb250aW51ZTtcbiAgICBpZiAoZW50cnkuaGFzaCAhPT0gb2JzZXJ2ZWQuaGFzaCkgY29udGludWU7XG4gICAgaWYgKGVudHJ5Lm10aW1lID09PSBvYnNlcnZlZC5tdGltZSkgY29udGludWU7XG4gICAgbmV4dCA/Pz0geyAuLi5pbmRleCB9O1xuICAgIG5leHRbb2JzZXJ2ZWQucGF0aF0gPSB7IC4uLmVudHJ5LCBtdGltZTogb2JzZXJ2ZWQubXRpbWUgfTtcbiAgfVxuICByZXR1cm4gbmV4dCA/PyBpbmRleDtcbn1cblxuLyoqXG4gKiBDb3JyZWxhdGUgZGVsZXRlICsgYWRkIHBhaXJzIGJ5IGNvbnRlbnQgaGFzaCAoQVJDSElURUNUVVJFIFx1MDBBNzQpLlxuICpcbiAqIE9uZS10by1vbmUgbWF0Y2hpbmcsIG1vc3QgZGV0ZXJtaW5pc3RpYyB3aW5zOiB3aGVuIHNldmVyYWwgdW5tYXRjaGVkIGFkZHNcbiAqIHNoYXJlIHRoZSBkZWxldGVkIHNpZGUncyBoYXNoLCBwcmVmZXIgYW4gYWRkIGluIHRoZSBzYW1lIHBhcmVudCBkaXJlY3Rvcnk7XG4gKiB3aXRoaW4gYSBwcmVmZXJlbmNlIGNsYXNzLCB0aGUgbGV4aWNvZ3JhcGhpY2FsbHkgc21hbGxlc3QgYHRvYCBwYXRoIHdpbnMuXG4gKiBNYXRjaGVkIHBhaXJzIGxlYXZlIHRoZSBkZWxldGUvYWRkIGJ1Y2tldHMgYW5kIGJlY29tZSBgcmVuYW1lZGAuXG4gKi9cbmZ1bmN0aW9uIGRldGVjdFJlbmFtZXMoXG4gIGRlbGV0ZWQ6IHJlYWRvbmx5IERlbGV0ZWRDYW5kaWRhdGVbXSxcbiAgYWRkZWQ6IHJlYWRvbmx5IFNjYW5DYW5kaWRhdGVbXSxcbik6IHtcbiAgcmVuYW1lZDogUmVuYW1lQ2FuZGlkYXRlW107XG4gIGRlbGV0ZWQ6IERlbGV0ZWRDYW5kaWRhdGVbXTtcbiAgYWRkZWQ6IFNjYW5DYW5kaWRhdGVbXTtcbn0ge1xuICBjb25zdCBhZGRzQnlIYXNoID0gbmV3IE1hcDxzdHJpbmcsIFNjYW5DYW5kaWRhdGVbXT4oKTtcbiAgZm9yIChjb25zdCBjYW5kaWRhdGUgb2YgWy4uLmFkZGVkXS5zb3J0KGJ5UGF0aCkpIHtcbiAgICBjb25zdCBidWNrZXQgPSBhZGRzQnlIYXNoLmdldChjYW5kaWRhdGUuaGFzaCk7XG4gICAgaWYgKGJ1Y2tldCkgYnVja2V0LnB1c2goY2FuZGlkYXRlKTtcbiAgICBlbHNlIGFkZHNCeUhhc2guc2V0KGNhbmRpZGF0ZS5oYXNoLCBbY2FuZGlkYXRlXSk7XG4gIH1cblxuICBjb25zdCB1c2VkQWRkcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBjb25zdCByZW5hbWVkOiBSZW5hbWVDYW5kaWRhdGVbXSA9IFtdO1xuICBjb25zdCB1bm1hdGNoZWREZWxldGVkOiBEZWxldGVkQ2FuZGlkYXRlW10gPSBbXTtcblxuICBmb3IgKGNvbnN0IGRlbGV0aW9uIG9mIFsuLi5kZWxldGVkXS5zb3J0KGJ5UGF0aCkpIHtcbiAgICBjb25zdCBjYW5kaWRhdGVzID0gYWRkc0J5SGFzaC5nZXQoZGVsZXRpb24uaGFzaCkgPz8gW107XG4gICAgbGV0IGZhbGxiYWNrOiBTY2FuQ2FuZGlkYXRlIHwgdW5kZWZpbmVkO1xuICAgIGxldCBzYW1lRGlyOiBTY2FuQ2FuZGlkYXRlIHwgdW5kZWZpbmVkO1xuICAgIGZvciAoY29uc3QgY2FuZGlkYXRlIG9mIGNhbmRpZGF0ZXMpIHtcbiAgICAgIGlmICh1c2VkQWRkcy5oYXMoY2FuZGlkYXRlLnBhdGgpKSBjb250aW51ZTtcbiAgICAgIGlmIChwYXJlbnRQYXRoKGNhbmRpZGF0ZS5wYXRoKSA9PT0gcGFyZW50UGF0aChkZWxldGlvbi5wYXRoKSkge1xuICAgICAgICBzYW1lRGlyID8/PSBjYW5kaWRhdGU7IC8vIHNvcnRlZCBcdTIxRDIgZmlyc3QgaXMgc21hbGxlc3RcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGZhbGxiYWNrID8/PSBjYW5kaWRhdGU7XG4gICAgICB9XG4gICAgfVxuICAgIGNvbnN0IG1hdGNoID0gc2FtZURpciA/PyBmYWxsYmFjaztcbiAgICBpZiAobWF0Y2gpIHtcbiAgICAgIHVzZWRBZGRzLmFkZChtYXRjaC5wYXRoKTtcbiAgICAgIHJlbmFtZWQucHVzaCh7IGZyb206IGRlbGV0aW9uLnBhdGgsIHRvOiBtYXRjaC5wYXRoLCBoYXNoOiBkZWxldGlvbi5oYXNoLCBzaXplOiBkZWxldGlvbi5zaXplIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICB1bm1hdGNoZWREZWxldGVkLnB1c2goZGVsZXRpb24pO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7XG4gICAgcmVuYW1lZCxcbiAgICBkZWxldGVkOiB1bm1hdGNoZWREZWxldGVkLFxuICAgIGFkZGVkOiBhZGRlZC5maWx0ZXIoKGNhbmRpZGF0ZSkgPT4gIXVzZWRBZGRzLmhhcyhjYW5kaWRhdGUucGF0aCkpLFxuICB9O1xufVxuXG4vKipcbiAqIERpcmVjdG9yaWVzIHRoYXQgZXhpc3QgaW4gc3RvcmFnZSBidXQgYXJlIHJlcHJlc2VudGVkIG5laXRoZXIgYnkgYSBsaXZlXG4gKiBmb2xkZXIgcGxhY2Vob2xkZXIgaW4gdGhlIGluZGV4IG5vciBieSBhbnkgZmlsZSAoaWdub3JlZCBvciBub3QpIGJlbmVhdGhcbiAqIHRoZW0gXHUyMDE0IHBsdXMgdGhlIHRvbWJzdG9uZWQtcGxhY2Vob2xkZXIgc3BlY2lhbCBjYXNlcyB0aGF0IG1ha2UgdGhlXG4gKiBlbXB0eS1mb2xkZXIgbGlmZWN5Y2xlIGRlbGV0aW9uLXNhZmU6XG4gKlxuICogICAtIFRPTUJTVE9ORUQgcGxhY2Vob2xkZXIgKyBjb250ZW50IGJlbmVhdGggXHUyMTkyIGBlbXB0eUZvbGRlcnNgOiB0aGUgdXNlclxuICogICAgIHJlY3JlYXRlZCB0aGUgZm9sZGVyOyByZXN0b3JpbmcgdGhlIHBsYWNlaG9sZGVyIChcImxvY2FsIHdpbnNcIikgaXNcbiAqICAgICBjb3JyZWN0LiBUaGUgcmVjcmVhdGVkIEZJTEVTIGJlbmVhdGggc3VyZmFjZSB0aHJvdWdoIGBhZGRlZGAvYG1vZGlmaWVkYFxuICogICAgIGluZGVwZW5kZW50bHkuXG4gKiAgIC0gVE9NQlNUT05FRCBwbGFjZWhvbGRlciArIEVNUFRZIGRpciBvbiBkaXNrOlxuICogICAgICAgXHUwMEI3IHRvbWJzdG9uZSBhdXRob3JlZCBieSBBTk9USEVSIGRldmljZSAob3IgYXV0aG9yIHVua25vd24pIFx1MjE5MlxuICogICAgICAgICBgc3RhbGVEaXJzYDogdGhlIHJlY29yZC1vbmx5IHJlc2lkdWUgb2YgYSByZW1vdGUgZGVsZXRpb24sXG4gKiAgICAgICAgIGNvbnNpc3RlbnQgd2l0aCB0aGUgdG9tYnN0b25lIFx1MjAxNCBuZXZlciByZXN1cnJlY3RlZCAocmUtcHVzaGluZyBpdCBhc1xuICogICAgICAgICBhbiBlbXB0eSBmb2xkZXIgaXMgd2hhdCBtYWRlIGEgcGVlci1zaWRlIGRlbGV0aW9uIHBpbmctcG9uZ1xuICogICAgICAgICBmb3JldmVyKS4gVGhlIGNsaWVudCByZXRyaWVzIGByZW1vdmVEaXJgIG9uIHRoZXNlIGRpcnMuXG4gKiAgICAgICBcdTAwQjcgdG9tYnN0b25lIGF1dGhvcmVkIGJ5IFRISVMgZGV2aWNlIChgdGhpc0RldmljZUlkYCkgXHUyMTkyXG4gKiAgICAgICAgIGBlbXB0eUZvbGRlcnNgOiBteSBvd24gZGVsZXRpb24sIHlldCBhIGRpciBleGlzdHMgaGVyZSBub3cgXHUyMDE0IHRoZVxuICogICAgICAgICB1c2VyIHJlLWNyZWF0ZWQgaXQgbG9jYWxseTsgcmVzdG9yZSB0aGUgcGxhY2Vob2xkZXIuXG4gKlxuICogQSBkaXJlY3RvcnkgY29udGFpbmluZyBvbmx5IGlnbm9yZWQgZmlsZXMgaXMgKm5vdCogZW1wdHkgXHUyMDE0IGl0IGlzXG4gKiByZXByZXNlbnRlZCBieSB0aG9zZSBmaWxlcyBhcyBmYXIgYXMgdGhlIGxvY2FsIG1hY2hpbmUgaXMgY29uY2VybmVkLlxuICovXG5mdW5jdGlvbiBkZXRlY3RFbXB0eUZvbGRlcnMoXG4gIGluZGV4OiBMb2NhbEluZGV4LFxuICBzZXR0aW5nczogSWdub3JlU2V0dGluZ3MsXG4gIGZpbGVzOiByZWFkb25seSBGaWxlU3RhdFtdLFxuICBkaXJzOiByZWFkb25seSBzdHJpbmdbXSxcbiAgdGhpc0RldmljZUlkPzogc3RyaW5nLFxuKTogeyBlbXB0eUZvbGRlcnM6IHN0cmluZ1tdOyBzdGFsZURpcnM6IHN0cmluZ1tdIH0ge1xuICBjb25zdCByZXByZXNlbnRlZERpcnMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgZm9yIChjb25zdCBmaWxlIG9mIGZpbGVzKSB7XG4gICAgZm9yIChsZXQgZGlyID0gcGFyZW50UGF0aChmaWxlLnBhdGgpOyBkaXIgIT09ICcvJzsgZGlyID0gcGFyZW50UGF0aChkaXIpKSB7XG4gICAgICByZXByZXNlbnRlZERpcnMuYWRkKGRpcik7XG4gICAgfVxuICB9XG5cbiAgY29uc3QgZW1wdHlGb2xkZXJzOiBzdHJpbmdbXSA9IFtdO1xuICBjb25zdCBzdGFsZURpcnM6IHN0cmluZ1tdID0gW107XG4gIGZvciAoY29uc3QgZGlyIG9mIGRpcnMpIHtcbiAgICBpZiAoZGlyID09PSAnLycpIGNvbnRpbnVlO1xuICAgIGlmIChpc0lnbm9yZWQoZGlyLCBzZXR0aW5ncykpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGVudHJ5ID0gaW5kZXhbZGlyXTtcbiAgICBpZiAoZW50cnk/LmlzRm9sZGVyICYmIGVudHJ5LmRlbGV0ZWRBdCA9PT0gdW5kZWZpbmVkKSBjb250aW51ZTsgLy8gbGl2ZSBwbGFjZWhvbGRlciBcdTIwMTQgYWxyZWFkeSBzeW5jZWRcbiAgICBpZiAoZW50cnk/LmlzRm9sZGVyICYmIGVudHJ5LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAvLyBUb21ic3RvbmVkIHBsYWNlaG9sZGVyIHdob3NlIGRpcmVjdG9yeSBzdGlsbCBleGlzdHMuIENvbnRlbnQgYmVuZWF0aFxuICAgICAgLy8gXHUyMUQyIGdlbnVpbmUgcmVjcmVhdGlvbi4gRW1wdHkgXHUyMUQyIHN0YWxlIGxlZnRvdmVyIG9mIGEgcmVjb3JkLW9ubHlcbiAgICAgIC8vIHRvbWJzdG9uZSBhcHBsaWNhdGlvbiBcdTIwMTQgVU5MRVNTIHRoaXMgZGV2aWNlIGF1dGhvcmVkIHRoZSB0b21ic3RvbmVcbiAgICAgIC8vIGl0c2VsZiwgaW4gd2hpY2ggY2FzZSBhIHByZXNlbnQgZGlyIGNhbiBvbmx5IGJlIGxvY2FsIHJlY3JlYXRpb24uXG4gICAgICBpZiAocmVwcmVzZW50ZWREaXJzLmhhcyhkaXIpIHx8IGVudHJ5LmNsb2NrLmRldmljZUlkID09PSB0aGlzRGV2aWNlSWQpIHtcbiAgICAgICAgZW1wdHlGb2xkZXJzLnB1c2goZGlyKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHN0YWxlRGlycy5wdXNoKGRpcik7XG4gICAgICB9XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKHJlcHJlc2VudGVkRGlycy5oYXMoZGlyKSkgY29udGludWU7IC8vIHJlcHJlc2VudGVkIGJ5IGl0cyBmaWxlc1xuICAgIGVtcHR5Rm9sZGVycy5wdXNoKGRpcik7XG4gIH1cbiAgcmV0dXJuIHtcbiAgICBlbXB0eUZvbGRlcnM6IGVtcHR5Rm9sZGVycy5zb3J0KCksXG4gICAgc3RhbGVEaXJzOiBzdGFsZURpcnMuc29ydCgpLFxuICB9O1xufVxuXG4vKipcbiAqIExpdmUgZm9sZGVyIHBsYWNlaG9sZGVyIGVudHJpZXMgd2hvc2UgZGlyZWN0b3J5IG5vIGxvbmdlciBleGlzdHMgaW5cbiAqIHN0b3JhZ2UgXHUyMDE0IHRoZSBmb2xkZXIgd2FzIGRlbGV0ZWQgbG9jYWxseSAoZGlyZWN0bHksIG9yIGJ5IHBydW5lLW9uLWRlbGV0ZVxuICogZW1wdHlpbmcgaXQpLiBFbWl0cyBvbmUgYEZvbGRlckRlbGV0aW9uQ2FuZGlkYXRlYCBwZXIgcGxhY2Vob2xkZXIgc28gdGhlXG4gKiByZXNvbHZlL2NvbW1pdCBwYXRoIHB1c2hlcyBhIGZvbGRlciB0b21ic3RvbmU7IGFscmVhZHktdG9tYnN0b25lZFxuICogcGxhY2Vob2xkZXJzIGFuZCBwbGFjZWhvbGRlcnMgdGhhdCBtZXJlbHkgYmVjYW1lIGlnbm9yZWQgYXJlIHNraXBwZWQuXG4gKi9cbmZ1bmN0aW9uIGRldGVjdEZvbGRlckRlbGV0aW9ucyhcbiAgaW5kZXg6IExvY2FsSW5kZXgsXG4gIHNldHRpbmdzOiBJZ25vcmVTZXR0aW5ncyxcbiAgZGlyczogcmVhZG9ubHkgc3RyaW5nW10sXG4pOiBGb2xkZXJEZWxldGlvbkNhbmRpZGF0ZVtdIHtcbiAgY29uc3QgcHJlc2VudCA9IG5ldyBTZXQoZGlycyk7XG4gIGNvbnN0IGZvbGRlckRlbGV0aW9uczogRm9sZGVyRGVsZXRpb25DYW5kaWRhdGVbXSA9IFtdO1xuICBmb3IgKGNvbnN0IFtwYXRoLCBlbnRyeV0gb2YgT2JqZWN0LmVudHJpZXMoaW5kZXgpKSB7XG4gICAgaWYgKCFlbnRyeS5pc0ZvbGRlcikgY29udGludWU7IC8vIGZpbGVzIGFyZSBoYW5kbGVkIGJ5IHRoZSBgZGVsZXRlZGAgYnVja2V0XG4gICAgaWYgKGVudHJ5LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkKSBjb250aW51ZTsgLy8gYWxyZWFkeSB0b21ic3RvbmVkXG4gICAgaWYgKHByZXNlbnQuaGFzKHBhdGgpKSBjb250aW51ZTsgLy8gZGlyZWN0b3J5IHN0aWxsIGV4aXN0cyBcdTIwMTQgbm8gZGVsZXRpb25cbiAgICBpZiAoaXNJZ25vcmVkKHBhdGgsIHNldHRpbmdzKSkgY29udGludWU7IC8vIHNldHRpbmdzIGNoYW5nZSwgbm90IGEgZGVsZXRpb25cbiAgICBmb2xkZXJEZWxldGlvbnMucHVzaCh7IHBhdGgsIHZlcnNpb25JZDogZW50cnkudmVyc2lvbklkIH0pO1xuICB9XG4gIHJldHVybiBmb2xkZXJEZWxldGlvbnMuc29ydChieVBhdGgpO1xufVxuXG5mdW5jdGlvbiBzb3J0Q2FuZGlkYXRlcyhjYW5kaWRhdGVzOiBTY2FuQ2FuZGlkYXRlW10pOiBTY2FuQ2FuZGlkYXRlW10ge1xuICByZXR1cm4gWy4uLmNhbmRpZGF0ZXNdLnNvcnQoYnlQYXRoKTtcbn1cblxuZnVuY3Rpb24gYnlQYXRoPFQgZXh0ZW5kcyB7IHBhdGg/OiBzdHJpbmc7IGZyb20/OiBzdHJpbmcgfT4oYTogVCwgYjogVCk6IG51bWJlciB7XG4gIGNvbnN0IGtleUEgPSBhLnBhdGggPz8gYS5mcm9tID8/ICcnO1xuICBjb25zdCBrZXlCID0gYi5wYXRoID8/IGIuZnJvbSA/PyAnJztcbiAgcmV0dXJuIGtleUEgPCBrZXlCID8gLTEgOiBrZXlBID4ga2V5QiA/IDEgOiAwO1xufVxuIiwgIi8qKlxuICogYFN5bmNDbGllbnRgIFx1MjAxNCB0aGUgbmV0d29yay1mYWNpbmcgb3JjaGVzdHJhdG9yIChBUkNISVRFQ1RVUkUubWQgXHUwMEE3OCkuXG4gKlxuICogQ29tcG9zZXMgdGhlIHBoYXNlLTFhLzFiIHBpZWNlcyBpbnRvIG9uZSBsb29wIHBlciBkZXZpY2U6XG4gKlxuICogICBzdGFydHVwOiAgbG9hZExvY2FsU3RhdGUgKGVudHJpZXMgKyBwZXJzaXN0ZWQgY3Vyc29yKSBcdTIxOTIgaGVsbG8vaGVsbG9BY2tcbiAqICAgICAgICAgICAgIChzZXJ2ZXIgcmVwb3J0cyBgb2xkZXN0UmV0YWluZWRTZXFgKSBcdTIxOTIgZ2V0TWFuaWZlc3QgXHUyMDE0IGEgREVMVEFcbiAqICAgICAgICAgICAgIG1hbmlmZXN0IChgc2luY2U6IHN5bmNlZFRocm91Z2hgKSBtZXJnZWQgb3ZlciB0aGUgaW5kZXhcbiAqICAgICAgICAgICAgIHByb2plY3Rpb24gd2hlbiB0aGUgcmVwbGF5IHdpbmRvdyBpcyBpbnRhY3QsIGVsc2UgZnVsbCBcdTIxOTJcbiAqICAgICAgICAgICAgIHNjYW5WYXVsdCBcdTIxOTIgY29tcHV0ZVN5bmNQbGFuIFx1MjE5MiBleGVjdXRlIChwdXNoZXMgdGhyb3VnaCBhXG4gKiAgICAgICAgICAgICBib3VuZGVkLWNvbmN1cnJlbmN5IHBpcGVsaW5lLCBwdWxscyB2aWEgYXBwbHlQdWxsIHdpdGggdGhlXG4gKiAgICAgICAgICAgICBpbmplY3RlZCBibG9iIHN0b3JlKTtcbiAqICAgbGl2ZTogICAgIGBjaGFuZ2VgIG1lc3NhZ2VzIG1hdGVyaWFsaXplIGltbWVkaWF0ZWx5IHdoZW4gdGhlIHRhcmdldCBpc1xuICogICAgICAgICAgICAgY2xlYW4sIGFuZCBkZWZlciB0byBhIGZ1bGwgcmVjb25jaWxlIGN5Y2xlIHdoZW4gaXQgaXMgbm90IFx1MjAxNCBhXG4gKiAgICAgICAgICAgICByZW1vdGUgY2hhbmdlIGlzIE5FVkVSIHdyaXR0ZW4gb3ZlciBsb2NhbGx5LW1vZGlmaWVkIGNvbnRlbnRcbiAqICAgICAgICAgICAgIHdpdGhvdXQgZ29pbmcgdGhyb3VnaCBgY29tcHV0ZVN5bmNQbGFuYCdzIGNvbmZsaWN0IGxvZ2ljO1xuICogICB3YXRjaGVyOiAgYFdhdGNoQWRhcHRlcmAgYmF0Y2hlcyBhcmUgZGVib3VuY2VkICh+MzAwIG1zLCBpbmplY3RhYmxlXG4gKiAgICAgICAgICAgICBzY2hlZHVsZXIgXHUyMDE0IG5vIGFtYmllbnQgdGltZXJzIGluIHRlc3RzKSBpbnRvIHNjYW5cdTIxOTJwbGFuXHUyMTkyZXhlY3V0ZTtcbiAqICAgcmVjb25uZWN0OiBgb25DbG9zZWAgZmxpcHMgdG8gYCdkaXNjb25uZWN0ZWQnYDsgYHJlY29ubmVjdCgpYCByZS1ydW5zIHRoZVxuICogICAgICAgICAgICAgd2hvbGUgc3RhcnR1cCByZWNvbmNpbGlhdGlvbiAoYmFja29mZiBpcyB0aGUgY2FsbGVyJ3Mgam9iKS5cbiAqXG4gKiBCdWxrIHBoYXNlcyByZXBvcnQgWC9ZIG9uIGBzdGF0dXMoKS5wcm9ncmVzc2AgKHRocm90dGxlZCB2aWEgdGhlIGluamVjdGVkXG4gKiBjbG9jayk7IHRoZSBwdXNoIHBoYXNlIGtlZXBzIHVwIHRvIGBwdXNoQ29uY3VycmVuY3lgIGNvbW1pdHMgaW4gZmxpZ2h0LlxuICpcbiAqIEFsbCBJL08gY3Jvc3NlcyB0aGUgYWRhcHRlciBzZWFtcyAoYFN0b3JhZ2VBZGFwdGVyYCwgYFRyYW5zcG9ydGAsXG4gKiBgQmxvYlN0b3JlYCwgYExvZ0FkYXB0ZXJgKTsgdGhlIGNsYXNzIGl0c2VsZiBpcyBwdXJlIG9yY2hlc3RyYXRpb24gYW5kIHJ1bnNcbiAqIGFueXdoZXJlIGBjb3JlYCBydW5zIFx1MjAxNCBXb3JrZXJzIHRlc3RzIGluY2x1ZGVkLlxuICovXG5cbmltcG9ydCB0eXBlIHsgTG9nQWRhcHRlciwgU3RvcmFnZUFkYXB0ZXIsIFdhdGNoQWRhcHRlciB9IGZyb20gJy4vYWRhcHRlcnMuanMnO1xuaW1wb3J0IHsgY29tcGFyZUNsb2NrcyB9IGZyb20gJy4vY2xvY2suanMnO1xuaW1wb3J0IHsgYXBwbHlQdWxsLCBsb2FkTG9jYWxTdGF0ZSwgcHJ1bmVQYXJlbnRPbkRlbGV0ZSwgcmVtb3ZlRGlySWZWYWNhbnQsIHR5cGUgRmV0Y2hCbG9iIH0gZnJvbSAnLi9lbmdpbmUuanMnO1xuaW1wb3J0IHsgTmV0d29ya0Vycm9yLCBQcm90b2NvbEVycm9yLCBSZXZva2VkRXJyb3IsIFVuYXV0aG9yaXplZEVycm9yIH0gZnJvbSAnLi9lcnJvcnMuanMnO1xuaW1wb3J0IHsgc2hhMjU2SGV4IH0gZnJvbSAnLi9oYXNoaW5nLmpzJztcbmltcG9ydCB7IGlzSWdub3JlZCwgdHlwZSBJZ25vcmVTZXR0aW5ncyB9IGZyb20gJy4vaWdub3JlLmpzJztcbmltcG9ydCB7XG4gIGFwcGx5Q29tbWl0LFxuICBMT0NBTF9JTkRFWF9TVEFURV9QQVRILFxuICByZW1vdmVFbnRyeSxcbiAgc2VyaWFsaXplTG9jYWxJbmRleCxcbiAgdHlwZSBMb2NhbEluZGV4LFxuICB0eXBlIFBlcnNpc3RlZFN5bmNTdGF0ZSxcbn0gZnJvbSAnLi9sb2NhbGluZGV4LmpzJztcbmltcG9ydCB7XG4gIGJhc2U2NFRvQnl0ZXMsXG4gIGJ5dGVzVG9CYXNlNjQsXG4gIElOTElORV9DT05URU5UX01BWF9CWVRFUyxcbiAgUHJvdG9jb2xWZXJzaW9uLFxuICB0eXBlIEJsb2JBY2tNZXNzYWdlLFxuICB0eXBlIEJsb2JNZXNzYWdlLFxuICB0eXBlIENoYW5nZU1lc3NhZ2UsXG4gIHR5cGUgQ29tbWl0QWNrTWVzc2FnZSxcbiAgdHlwZSBDb21taXRNZXNzYWdlLFxuICB0eXBlIENvbmZsaWN0TWVzc2FnZSxcbiAgdHlwZSBIZWxsb0Fja01lc3NhZ2UsXG4gIHR5cGUgTWFuaWZlc3RNZXNzYWdlLFxuICB0eXBlIE1lc3NhZ2UsXG4gIHR5cGUgU2VydmVyTWVzc2FnZSxcbn0gZnJvbSAnLi9wcm90b2NvbC5qcyc7XG5pbXBvcnQge1xuICBjb21wdXRlU3luY1BsYW4sXG4gIHR5cGUgQ29uZmxpY3RPcCxcbiAgdHlwZSBQdWxsRmlsZU9wLFxuICB0eXBlIFB1bGxPcCxcbiAgdHlwZSBQdXNoT3AsXG4gIHR5cGUgUmVtb3RlRmlsZSxcbiAgdHlwZSBTeW5jUGxhbixcbn0gZnJvbSAnLi9yZXNvbHZlLmpzJztcbmltcG9ydCB7IHJlY29yZEhhc2hlZEZpbGVzLCBzY2FuVmF1bHQsIHR5cGUgSGFzaGVkRmlsZSB9IGZyb20gJy4vc2Nhbi5qcyc7XG5pbXBvcnQgdHlwZSB7IFRyYW5zcG9ydCB9IGZyb20gJy4vdHJhbnNwb3J0LmpzJztcbmltcG9ydCB0eXBlIHsgTG9naWNhbENsb2NrIH0gZnJvbSAnLi90eXBlcy5qcyc7XG5cbi8vIC0tLSBwdWJsaWMgb3B0aW9uL3N0YXR1cyBzaGFwZXMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIENsaWVudC1zaWRlIGNvbnRlbnQtYWRkcmVzc2VkIGJsb2IgY2FjaGUgKFIyIGNsaWVudCBpbiBwcm9kdWN0aW9uOyBhIE1hcCBpbiB0ZXN0cykuICovXG5leHBvcnQgaW50ZXJmYWNlIEJsb2JTdG9yZSB7XG4gIGdldChoYXNoOiBzdHJpbmcpOiBQcm9taXNlPFVpbnQ4QXJyYXkgfCB1bmRlZmluZWQ+O1xuICBwdXQoaGFzaDogc3RyaW5nLCBieXRlczogVWludDhBcnJheSk6IFByb21pc2U8dm9pZD47XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgU3luY0NsaWVudE9wdGlvbnMge1xuICBkZXZpY2VJZDogc3RyaW5nO1xuICBkZXZpY2VOYW1lOiBzdHJpbmc7XG4gIHRva2VuOiBzdHJpbmc7XG4gIC8qKiBBIGZhY3RvcnkgKHJlY29ubmVjdCBkaWFscyBmcmVzaCkgb3IgYSBzaW5nbGUgcmV1c2FibGUgaW5zdGFuY2UuICovXG4gIHRyYW5zcG9ydDogKCgpID0+IFRyYW5zcG9ydCkgfCBUcmFuc3BvcnQ7XG4gIGJsb2JTdG9yZTogQmxvYlN0b3JlO1xuICBzdG9yYWdlOiBTdG9yYWdlQWRhcHRlcjtcbiAgbG9nPzogTG9nQWRhcHRlcjtcbiAgLyoqIEluaXRpYWwgaWdub3JlIHNldHRpbmdzOyBzdXBlcnNlZGVkIGJ5IGBoZWxsb0Fjay5zZXR0aW5nc2Agb24gY29ubmVjdC4gKi9cbiAgc2V0dGluZ3M/OiBJZ25vcmVTZXR0aW5ncztcbiAgLyoqIEluamVjdGFibGUgY2xvY2sgKGRlZmF1bHQgYERhdGUubm93YCkuICovXG4gIG5vdz86ICgpID0+IG51bWJlcjtcbiAgLyoqIFdhdGNoZXIgZGVib3VuY2Ugd2luZG93IGluIG1zIChkZWZhdWx0IDMwMCkuICovXG4gIGRlYm91bmNlTXM/OiBudW1iZXI7XG4gIC8qKlxuICAgKiBTY2hlZHVsZXMgdGhlIGRlYm91bmNlZCBzeW5jIGN5Y2xlLiBEZWZhdWx0OiBgc2V0VGltZW91dGAuIFRlc3RzIGluamVjdCBhXG4gICAqIG1hbnVhbCBxdWV1ZSBcdTIwMTQgdGhlIGNsaWVudCBuZXZlciB0b3VjaGVzIGEgcmVhbCB0aW1lciBiZWhpbmQgdGhpcyBzZWFtLlxuICAgKi9cbiAgc2NoZWR1bGU/OiAoZm46ICgpID0+IHZvaWQsIG1zOiBudW1iZXIpID0+ICgpID0+IHZvaWQ7XG4gIC8qKlxuICAgKiBCb3VuZGVkIGNvbmN1cnJlbmN5IG9mIHRoZSBwdXNoIHBpcGVsaW5lOiBob3cgbWFueSBjb21taXRzIG1heSBiZSBpblxuICAgKiBmbGlnaHQgKHNlbnQsIGF3YWl0aW5nIGFjaykgYXQgb25jZS4gRGVmYXVsdCA4LiBDb25mbGljdCBhcmJpdHJhdGlvbiBpc1xuICAgKiBzZXJ2ZXItc2lkZSBhbmQgUEVSIFBBVEgsIGFuZCBhIGN5Y2xlIHN0YWdlcyBhdCBtb3N0IG9uZSBjb21taXQgcGVyIHBhdGgsXG4gICAqIHNvIG9yZGVyaW5nIGFjcm9zcyBkaWZmZXJlbnQgZmlsZXMgaXMgaXJyZWxldmFudCBcdTIwMTQgc2VlXG4gICAqIGBydW5QdXNoUGlwZWxpbmVgIGZvciB0aGUgZnVsbCBhcmd1bWVudC5cbiAgICovXG4gIHB1c2hDb25jdXJyZW5jeT86IG51bWJlcjtcbiAgLyoqXG4gICAqIE1pbmltdW0gd2FsbC1jbG9jayBtcyBiZXR3ZWVuIGBzdGF0dXMoKS5wcm9ncmVzc2AgdXBkYXRlcyBkdXJpbmcgYnVsa1xuICAgKiBwaGFzZXMgKGRlZmF1bHQgNTAgXHUyMDE0IHJlbmRlcmVyIGNvYWxlc2Npbmc7IHBoYXNlIGNoYW5nZXMgYW5kIGNvbXBsZXRpb25zXG4gICAqIGFsd2F5cyBlbWl0KS4gVGVzdHMgcGFzcyAwIHRvIG9ic2VydmUgZXZlcnkgZmlsZS5cbiAgICovXG4gIHByb2dyZXNzVGhyb3R0bGVNcz86IG51bWJlcjtcbn1cblxuZXhwb3J0IHR5cGUgU3luY0NsaWVudFN0YXRlID0gJ2lkbGUnIHwgJ2Nvbm5lY3RpbmcnIHwgJ3N5bmNpbmcnIHwgJ2xpdmUnIHwgJ2Rpc2Nvbm5lY3RlZCc7XG5cbi8qKiBUaGUgYnVsayBwaGFzZSBhIHJ1bm5pbmcgY3ljbGUgaXMgY3VycmVudGx5IGdyaW5kaW5nIHRocm91Z2guICovXG5leHBvcnQgdHlwZSBTeW5jUGhhc2UgPSAnc2Nhbm5pbmcnIHwgJ3B1c2hpbmcnIHwgJ3B1bGxpbmcnO1xuXG4vKiogWC9ZIHByb2dyZXNzIG9mIG9uZSBidWxrIHBoYXNlOyBwcmVzZW50IG9uIGBTeW5jQ2xpZW50U3RhdHVzYCBtaWQtY3ljbGUgb25seS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU3luY1Byb2dyZXNzIHtcbiAgcGhhc2U6IFN5bmNQaGFzZTtcbiAgZG9uZTogbnVtYmVyO1xuICB0b3RhbDogbnVtYmVyO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFN5bmNDbGllbnRTdGF0dXMge1xuICBzdGF0ZTogU3luY0NsaWVudFN0YXRlO1xuICAvKiogRXBvY2ggbXMgb2YgdGhlIGxhc3QgY29tcGxldGVkIGN5Y2xlLCBvciBudWxsIGJlZm9yZSB0aGUgZmlyc3QuICovXG4gIGxhc3RTeW5jQXQ6IG51bWJlciB8IG51bGw7XG4gIC8qKiBXYXRjaGVyL3JlY29uY2lsZSBldmVudHMgcXVldWVkIGJlaGluZCB0aGUgZGVib3VuY2Ugd2luZG93LiAqL1xuICBwZW5kaW5nOiBudW1iZXI7XG4gIC8qKiBDb25mbGljdHMgb2JzZXJ2ZWQgYnkgcGxhbiBjeWNsZXMgKGluZm9ybWF0aW9uYWw7IHJlc29sdXRpb24gaXMgaW4gdGhlIGRhdGEpLiAqL1xuICBjb25mbGljdHM6IENvbmZsaWN0T3BbXTtcbiAgLyoqXG4gICAqIFByb2dyZXNzIG9mIHRoZSBSVU5OSU5HIGN5Y2xlJ3MgY3VycmVudCBidWxrIHBoYXNlIChgdnNhIFx1MjJFRiAxMjM0LzUwMDBgKTtcbiAgICogYWJzZW50IGJldHdlZW4gY3ljbGVzLiBVcGRhdGVzIGFyZSB0aHJvdHRsZWQgdG8gYHByb2dyZXNzVGhyb3R0bGVNc2AuXG4gICAqL1xuICBwcm9ncmVzcz86IFN5bmNQcm9ncmVzcztcbn1cblxuLyoqIERlZmF1bHQgaW4tZmxpZ2h0IGNvbW1pdCBjYXAgKHNlZSBgU3luY0NsaWVudE9wdGlvbnMucHVzaENvbmN1cnJlbmN5YCkuICovXG5leHBvcnQgY29uc3QgREVGQVVMVF9QVVNIX0NPTkNVUlJFTkNZID0gODtcbi8qKiBEZWZhdWx0IHByb2dyZXNzIGNvYWxlc2Npbmcgd2luZG93IChzZWUgYFN5bmNDbGllbnRPcHRpb25zLnByb2dyZXNzVGhyb3R0bGVNc2ApLiAqL1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfUFJPR1JFU1NfVEhST1RUTEVfTVMgPSA1MDtcblxuY29uc3QgZGVmYXVsdExvZzogTG9nQWRhcHRlciA9IHtcbiAgZGVidWc6ICgpID0+IHt9LFxuICBpbmZvOiAoKSA9PiB7fSxcbiAgd2FybjogKCkgPT4ge30sXG4gIGVycm9yOiAoKSA9PiB7fSxcbn07XG5cbmNvbnN0IGRlZmF1bHRTY2hlZHVsZSA9IChmbjogKCkgPT4gdm9pZCwgbXM6IG51bWJlcik6ICgoKSA9PiB2b2lkKSA9PiB7XG4gIGNvbnN0IGhhbmRsZSA9IGdsb2JhbFRoaXMuc2V0VGltZW91dChmbiwgbXMpIGFzIHVua25vd24gYXMgbnVtYmVyO1xuICByZXR1cm4gKCkgPT4gZ2xvYmFsVGhpcy5jbGVhclRpbWVvdXQoaGFuZGxlKTtcbn07XG5cbi8qKiBBIGNvbW1pdCBwcmVwYXJlZCBmb3IgdGhlIHdpcmUgKGEgYFB1c2hPcGAgKyBpdHMgc3RhZ2VkIGNvbnRlbnQpLiAqL1xuaW50ZXJmYWNlIFN0YWdlZENvbW1pdCB7XG4gIGtpbmQ6IENvbW1pdE1lc3NhZ2VbJ2tpbmQnXTtcbiAgcGF0aDogc3RyaW5nO1xuICBwYXJlbnRWZXJzaW9uOiBzdHJpbmcgfCBudWxsO1xuICBoYXNoOiBzdHJpbmc7XG4gIHNpemU6IG51bWJlcjtcbiAgZnJvbVBhdGg/OiBzdHJpbmc7XG4gIGlzRm9sZGVyPzogYm9vbGVhbjtcbiAgYnl0ZXM/OiBVaW50OEFycmF5O1xuICAvKipcbiAgICogU3RvcmFnZSBtdGltZSBvYnNlcnZlZCBieSBUSElTIGN5Y2xlJ3Mgc2NhbiB3aGVuIGl0IGhhc2hlZCB0aGUgY29udGVudFxuICAgKiAoYEhhc2hlZEZpbGUubXRpbWVgIG9mIHRoZSBwdXNoIHNvdXJjZSkuIFBpbm5lZCBvbnRvIHRoZSBpbmRleCBlbnRyeSB3aGVuXG4gICAqIHRoZSBhY2sgbGFuZHMsIHNvIHRoZSBlbnRyeSdzIChoYXNoLCBzaXplLCBtdGltZSkgYWx3YXlzIGRlc2NyaWJlcyBPTkVcbiAgICogY29uc2lzdGVudCBpbnN0YW50IG9mIHRoZSBmaWxlIFx1MjAxNCBuZXZlciBhIGxhdGVyIHN0YXQgcGFpcmVkIHdpdGggdGhpc1xuICAgKiBoYXNoLiBUaGF0IG9yZGVyaW5nIGlzIHdoYXQgbGV0cyB0aGUgc2NhbiBmYXN0LXBhdGggKG10aW1lK3NpemUpIHNraXBcbiAgICogcmUtaGFzaGluZyBzYWZlbHk6IGFuIGVkaXQgbGFuZGluZyBiZXR3ZWVuIGhhc2ggYW5kIGFjayBjaGFuZ2VzIHRoZSBkaXNrXG4gICAqIHN0YXQsIG1pc3NlcyB0aGUgZmFzdCBwYXRoLCBhbmQgaXMgcmUtaGFzaGVkIGFuZCBwdXNoZWQgb24gdGhlIG5leHQgc2Nhbi5cbiAgICovXG4gIG10aW1lPzogbnVtYmVyO1xufVxuXG4vLyAtLS0gdGhlIGNsaWVudCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGNsYXNzIFN5bmNDbGllbnQge1xuICBwcml2YXRlIHJlYWRvbmx5IG9wdGlvbnM6IFN5bmNDbGllbnRPcHRpb25zO1xuICBwcml2YXRlIHJlYWRvbmx5IGxvZzogTG9nQWRhcHRlcjtcbiAgcHJpdmF0ZSByZWFkb25seSBub3c6ICgpID0+IG51bWJlcjtcbiAgcHJpdmF0ZSByZWFkb25seSBkZWJvdW5jZU1zOiBudW1iZXI7XG4gIHByaXZhdGUgcmVhZG9ubHkgc2NoZWR1bGU6IChmbjogKCkgPT4gdm9pZCwgbXM6IG51bWJlcikgPT4gKCkgPT4gdm9pZDtcbiAgcHJpdmF0ZSByZWFkb25seSBkaWFsVHJhbnNwb3J0OiAoKSA9PiBUcmFuc3BvcnQ7XG4gIHByaXZhdGUgcmVhZG9ubHkgcHVzaENvbmN1cnJlbmN5OiBudW1iZXI7XG4gIHByaXZhdGUgcmVhZG9ubHkgcHJvZ3Jlc3NUaHJvdHRsZU1zOiBudW1iZXI7XG5cbiAgcHJpdmF0ZSB0cmFuc3BvcnQ6IFRyYW5zcG9ydCB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHN0YXRlOiBTeW5jQ2xpZW50U3RhdGUgPSAnaWRsZSc7XG4gIHByaXZhdGUgaW5kZXg6IExvY2FsSW5kZXggPSB7fTtcbiAgcHJpdmF0ZSBjdXJzb3IgPSAwO1xuICBwcml2YXRlIGxhc3RTeW5jQXQ6IG51bWJlciB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHBlbmRpbmcgPSAwO1xuICBwcml2YXRlIGNvbmZsaWN0czogQ29uZmxpY3RPcFtdID0gW107XG4gIHByaXZhdGUgaWdub3JlU2V0dGluZ3M6IElnbm9yZVNldHRpbmdzO1xuICBwcml2YXRlIHdhdGNoQWRhcHRlcjogV2F0Y2hBZGFwdGVyIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgY2FuY2VsRGVib3VuY2U6ICgoKSA9PiB2b2lkKSB8IG51bGwgPSBudWxsO1xuXG4gIC8qKlxuICAgKiBEZWx0YS1tYW5pZmVzdCBib29ra2VlcGluZyAocGVyc2lzdGVkIGFsb25nc2lkZSB0aGUgaW5kZXgsIHNlZVxuICAgKiBgUGVyc2lzdGVkU3luY1N0YXRlYCk6IGBzeW5jZWRUaHJvdWdoYCBcdTIwMTQgdGhlIG1hbmlmZXN0IGN1cnNvciBvZiB0aGUgbGFzdFxuICAgKiBmdWxseS1zdWNjZXNzZnVsIGN5Y2xlLCBpLmUuIHRoZSBzZXEgdGhyb3VnaCB3aGljaCB0aGUgaW5kZXggaXMga25vd25cbiAgICogQ09NUExFVEUgKG51bGwgdW50aWwgb25lIGZpbmlzaGVzKTsgYG5lZWRzRnVsbE1hbmlmZXN0YCBcdTIwMTQgYSByZW1vdGUgY2hhbmdlXG4gICAqIHdhcyBkZWZlcnJlZCBvdmVyIGxvY2FsIGRpdmVyZ2VuY2UgYW5kIG11c3QgYmUgcmVzb2x2ZWQgdGhyb3VnaCBhIGZ1bGxcbiAgICogbWFuaWZlc3QncyBwbGFuIGxvZ2ljOyBgc2VydmVyT2xkZXN0UmV0YWluZWRTZXFgIFx1MjAxNCB0aGUgaGVsbG9BY2sncyBhbnN3ZXJcbiAgICogdG8gXCJpcyBteSByZXBsYXkgd2luZG93IGludGFjdFwiIChudWxsIGZvciBsZWdhY3kgc2VydmVycyBcdTIxRDIgYWx3YXlzIGZ1bGwpLlxuICAgKi9cbiAgcHJpdmF0ZSBzeW5jZWRUaHJvdWdoOiBudW1iZXIgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBuZWVkc0Z1bGxNYW5pZmVzdCA9IGZhbHNlO1xuICBwcml2YXRlIHNlcnZlck9sZGVzdFJldGFpbmVkU2VxOiBudW1iZXIgfCBudWxsID0gbnVsbDtcblxuICAvKiogQ3VycmVudCBidWxrLXBoYXNlIHByb2dyZXNzLCBjbGVhcmVkIHdoZW4gYSBjeWNsZSBzZXR0bGVzLiAqL1xuICBwcml2YXRlIHByb2dyZXNzOiBTeW5jUHJvZ3Jlc3MgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBsYXN0UHJvZ3Jlc3NBdCA9IDA7XG5cbiAgLyoqIFNlcmlhbGl6ZWQgb3BlcmF0aW9uIHF1ZXVlIFx1MjAxNCBleGFjdGx5IG9uZSBhc3luYyBvcCBydW5zIGF0IGEgdGltZS4gKi9cbiAgcHJpdmF0ZSB0YWlsOiBQcm9taXNlPHVua25vd24+ID0gUHJvbWlzZS5yZXNvbHZlKCk7XG4gIHByaXZhdGUgcXVldWVkT3BzID0gMDtcbiAgLyoqIFN0YXJ0dXAtdGltZSBjaGFuZ2UgZmxvb2QgaXMgYnVmZmVyZWQ7IHRoZSBmdWxsIG1hbmlmZXN0IHN1YnN1bWVzIGl0LiAqL1xuICBwcml2YXRlIGJ1ZmZlcmluZyA9IGZhbHNlO1xuICBwcml2YXRlIGJ1ZmZlcmVkOiBNZXNzYWdlW10gPSBbXTtcbiAgLyoqXG4gICAqIE91dHN0YW5kaW5nIHJlcXVlc3QgZXhwZWN0YXRpb25zLCBvbGRlc3QgZmlyc3QuIE9wcyBhcmUgc2VyaWFsaXplZCBwZXJcbiAgICogY3ljbGUgRVhDRVBUIHRoZSBwdXNoIHBpcGVsaW5lLCB3aGljaCBrZWVwcyBzZXZlcmFsIGNvbW1pdHMgaW4gZmxpZ2h0IFx1MjAxNFxuICAgKiByZXBsaWVzIG9uIHRoZSBvcmRlcmVkIFdTIGFycml2ZSBpbiBzZW5kIG9yZGVyLCBzbyBtYXRjaGluZyB0aGUgT0xERVNUXG4gICAqIGV4cGVjdGF0aW9uIHRoYXQgYWNjZXB0cyBhIG1lc3NhZ2UgcGFpcnMgZXZlcnkgcmVwbHkgd2l0aCBpdHMgcmVxdWVzdFxuICAgKiAodGhlIERPIGFyYml0cmF0ZXMgYmVoaW5kIGBydW5FeGNsdXNpdmVgLCBhbmQgdGhlIGluLW1lbW9yeSBzZXJ2ZXJcbiAgICogbWlycm9ycyB0aGF0LCBzbyB0aGUgc2VydmVyIG5ldmVyIHJlb3JkZXJzIHJlcGxpZXMgZWl0aGVyKS5cbiAgICovXG4gIHByaXZhdGUgZXhwZWN0YXRpb25zOiBBcnJheTx7XG4gICAgbWF0Y2hlczogKG1lc3NhZ2U6IE1lc3NhZ2UpID0+IGJvb2xlYW47XG4gICAgcmVzb2x2ZTogKG1lc3NhZ2U6IE1lc3NhZ2UpID0+IHZvaWQ7XG4gICAgcmVqZWN0OiAoZXJyb3I6IEVycm9yKSA9PiB2b2lkO1xuICB9PiA9IFtdO1xuICAvKipcbiAgICogU2VyaWFsaXplcyBBQ0sgQVBQTElDQVRJT04gYWNyb3NzIHBpcGVsaW5lIHNsb3RzLiBTbG90cyBhd2FpdCByZXBsaWVzXG4gICAqIGNvbmN1cnJlbnRseSwgYnV0IGVhY2ggcmVwbHkgZm9sZHMgaW50byB0aGUgU0hBUkVEIGB0aGlzLmluZGV4YFxuICAgKiAocmVhZC1tb2RpZnktd3JpdGUpOyBjaGFpbmluZyB0aGUgZm9sZHMga2VlcHMgZXZlcnkgYXBwbHkgYXRvbWljIHdpdGhcbiAgICogcmVzcGVjdCB0byB0aGUgb3RoZXJzLiBPcmRlciBhY3Jvc3MgZGlmZmVyZW50IHBhdGhzIGlzIGlycmVsZXZhbnQgKG9uZVxuICAgKiBjb21taXQgcGVyIHBhdGggcGVyIGN5Y2xlLCBwZXItcGF0aCBzZXJ2ZXIgYXJiaXRyYXRpb24pLCBzbyBubyBvcmRlcmluZ1xuICAgKiBndWFyYW50ZWUgaXMgbmVlZGVkIGJleW9uZCBtdXR1YWwgZXhjbHVzaW9uLlxuICAgKi9cbiAgcHJpdmF0ZSBhY2tDaGFpbjogUHJvbWlzZTx2b2lkPiA9IFByb21pc2UucmVzb2x2ZSgpO1xuXG4gIGNvbnN0cnVjdG9yKG9wdGlvbnM6IFN5bmNDbGllbnRPcHRpb25zKSB7XG4gICAgdGhpcy5vcHRpb25zID0gb3B0aW9ucztcbiAgICB0aGlzLmxvZyA9IG9wdGlvbnMubG9nID8/IGRlZmF1bHRMb2c7XG4gICAgdGhpcy5ub3cgPSBvcHRpb25zLm5vdyA/PyAoKCkgPT4gRGF0ZS5ub3coKSk7XG4gICAgdGhpcy5kZWJvdW5jZU1zID0gb3B0aW9ucy5kZWJvdW5jZU1zID8/IDMwMDtcbiAgICB0aGlzLnNjaGVkdWxlID0gb3B0aW9ucy5zY2hlZHVsZSA/PyBkZWZhdWx0U2NoZWR1bGU7XG4gICAgdGhpcy5wdXNoQ29uY3VycmVuY3kgPSBNYXRoLm1heCgxLCBvcHRpb25zLnB1c2hDb25jdXJyZW5jeSA/PyBERUZBVUxUX1BVU0hfQ09OQ1VSUkVOQ1kpO1xuICAgIHRoaXMucHJvZ3Jlc3NUaHJvdHRsZU1zID0gTWF0aC5tYXgoMCwgb3B0aW9ucy5wcm9ncmVzc1Rocm90dGxlTXMgPz8gREVGQVVMVF9QUk9HUkVTU19USFJPVFRMRV9NUyk7XG4gICAgdGhpcy5kaWFsVHJhbnNwb3J0ID1cbiAgICAgIHR5cGVvZiBvcHRpb25zLnRyYW5zcG9ydCA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgICA/IG9wdGlvbnMudHJhbnNwb3J0XG4gICAgICAgIDogKCkgPT4gb3B0aW9ucy50cmFuc3BvcnQgYXMgVHJhbnNwb3J0O1xuICAgIHRoaXMuaWdub3JlU2V0dGluZ3MgPSBvcHRpb25zLnNldHRpbmdzID8/IHsgb2JzaWRpYW5TeW5jOiBmYWxzZSB9O1xuICB9XG5cbiAgLy8gLS0tIGxpZmVjeWNsZSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgLyoqIFJ1biBzdGFydHVwIHJlY29uY2lsaWF0aW9uIGFuZCBlbnRlciBsaXZlIG1vZGUuICovXG4gIGFzeW5jIGNvbm5lY3QoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5lbnF1ZXVlKCgpID0+IHRoaXMuc3RhcnR1cCgpKTtcbiAgfVxuXG4gIC8qKiBSZS1kaWFsIGFuZCByZS1ydW4gdGhlIGZ1bGwgc3RhcnR1cCByZWNvbmNpbGlhdGlvbi4gKi9cbiAgYXN5bmMgcmVjb25uZWN0KCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMuZW5xdWV1ZShhc3luYyAoKSA9PiB7XG4gICAgICB0aGlzLnRyYW5zcG9ydD8uY2xvc2UoKTtcbiAgICAgIHRoaXMudHJhbnNwb3J0ID0gbnVsbDtcbiAgICAgIGF3YWl0IHRoaXMuc3RhcnR1cCgpO1xuICAgIH0pO1xuICB9XG5cbiAgY2xvc2UoKTogdm9pZCB7XG4gICAgdGhpcy5zdG9wV2F0Y2hpbmcoKTtcbiAgICB0aGlzLmNhbmNlbERlYm91bmNlPy4oKTtcbiAgICB0aGlzLmNhbmNlbERlYm91bmNlID0gbnVsbDtcbiAgICB0aGlzLnRyYW5zcG9ydD8uY2xvc2UoKTtcbiAgICB0aGlzLnRyYW5zcG9ydCA9IG51bGw7XG4gICAgdGhpcy5zdGF0ZSA9ICdpZGxlJztcbiAgfVxuXG4gIC8qKiBCZWdpbiBkZWJvdW5jZWQgd2F0Y2hpbmcgKEFSQ0hJVEVDVFVSRSBcdTAwQTc4IGxpdmUgb3BlcmF0aW9uKS4gKi9cbiAgc3RhcnRXYXRjaGluZyh3YXRjaEFkYXB0ZXI6IFdhdGNoQWRhcHRlcik6IHZvaWQge1xuICAgIHRoaXMuc3RvcFdhdGNoaW5nKCk7XG4gICAgdGhpcy53YXRjaEFkYXB0ZXIgPSB3YXRjaEFkYXB0ZXI7XG4gICAgd2F0Y2hBZGFwdGVyLnN0YXJ0KChldmVudHMpID0+IHRoaXMub25XYXRjaEV2ZW50cyhldmVudHMpKTtcbiAgfVxuXG4gIHN0b3BXYXRjaGluZygpOiB2b2lkIHtcbiAgICB0aGlzLndhdGNoQWRhcHRlcj8uc3RvcCgpO1xuICAgIHRoaXMud2F0Y2hBZGFwdGVyID0gbnVsbDtcbiAgfVxuXG4gIC8qKiBNYW51YWwgb25lLXNob3QgY3ljbGUgKGB2c2FgIG9uZS1zaG90LCBcInN5bmMgbm93XCIgYnV0dG9ucywgdGVzdHMpLiAqL1xuICBhc3luYyB0cmlnZ2VyU3luYygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLmVucXVldWUoKCkgPT4gdGhpcy5ydW5DeWNsZSgpKTtcbiAgfVxuXG4gIC8qKiBSZXNvbHZlcyB3aGVuIGV2ZXJ5IHF1ZXVlZCBvcGVyYXRpb24gaGFzIHNldHRsZWQuICovXG4gIGFzeW5jIHdhaXRJZGxlKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHdoaWxlICh0aGlzLnF1ZXVlZE9wcyA+IDApIGF3YWl0IHRoaXMudGFpbDtcbiAgICBhd2FpdCB0aGlzLnRhaWw7XG4gIH1cblxuICBzdGF0dXMoKTogU3luY0NsaWVudFN0YXR1cyB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB0aGlzLnN0YXRlLFxuICAgICAgbGFzdFN5bmNBdDogdGhpcy5sYXN0U3luY0F0LFxuICAgICAgcGVuZGluZzogdGhpcy5wZW5kaW5nLFxuICAgICAgY29uZmxpY3RzOiBbLi4udGhpcy5jb25mbGljdHNdLFxuICAgICAgLi4uKHRoaXMucHJvZ3Jlc3MgIT09IG51bGwgPyB7IHByb2dyZXNzOiB7IC4uLnRoaXMucHJvZ3Jlc3MgfSB9IDoge30pLFxuICAgIH07XG4gIH1cblxuICAvKiogUmVhZC1vbmx5IHZpZXcgb2YgdGhlIGxvY2FsIGluZGV4ICh0ZXN0cywgYHZzYSBzdGF0dXNgKS4gKi9cbiAgY3VycmVudEluZGV4KCk6IExvY2FsSW5kZXgge1xuICAgIHJldHVybiB7IC4uLnRoaXMuaW5kZXggfTtcbiAgfVxuXG4gIC8qKiBMYXN0IHNlZW4gc2VydmVyIHNlcXVlbmNlIG51bWJlci4gKi9cbiAgZ2V0IGN1cnNvclZhbHVlKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMuY3Vyc29yO1xuICB9XG5cbiAgLyoqIFRTLXNhZmUgc3RhdGUgcHJvYmUgKGFzc2lnbm1lbnRzIGluc2lkZSBhc3luYyBmbG93cyBkZWZlYXQgbmFycm93aW5nKS4gKi9cbiAgcHJpdmF0ZSBpc0Rpc2Nvbm5lY3RlZCgpOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy5zdGF0ZSA9PT0gJ2Rpc2Nvbm5lY3RlZCc7XG4gIH1cblxuICAvLyAtLS0gc3RhcnR1cCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgcHJpdmF0ZSBhc3luYyBzdGFydHVwKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuc3RhdGUgPSAnY29ubmVjdGluZyc7XG4gICAgdGhpcy5idWZmZXJpbmcgPSB0cnVlO1xuICAgIHRoaXMuYnVmZmVyZWQgPSBbXTtcblxuICAgIC8vIFJlc3RvcmUgdGhlIGluZGV4IEFORCB0aGUgc3luYy1jdXJzb3IgYm9va2tlZXBpbmcgKG9uZSBhdG9taWMgZmlsZSk6XG4gICAgLy8gdGhlIHBlcnNpc3RlZCBjdXJzb3IgbGV0cyBoZWxsbyByZXBsYXkgb25seSB3aGF0IHdhcyBtaXNzZWQsIGFuZFxuICAgIC8vIGBzeW5jZWRUaHJvdWdoYCBkZWNpZGVzIHdoZXRoZXIgYSBkZWx0YSBtYW5pZmVzdCBtYXkgYmUgcmVxdWVzdGVkLlxuICAgIGlmIChhd2FpdCB0aGlzLnNhZmVTdG9yYWdlRXhpc3RzKExPQ0FMX0lOREVYX1NUQVRFX1BBVEgpKSB7XG4gICAgICBjb25zdCBsb2FkZWQgPSBhd2FpdCBsb2FkTG9jYWxTdGF0ZSh0aGlzLm9wdGlvbnMuc3RvcmFnZSk7XG4gICAgICB0aGlzLmluZGV4ID0gbG9hZGVkLmluZGV4O1xuICAgICAgdGhpcy5jdXJzb3IgPSBsb2FkZWQuc3RhdGUuY3Vyc29yO1xuICAgICAgdGhpcy5zeW5jZWRUaHJvdWdoID0gbG9hZGVkLnN0YXRlLnN5bmNlZFRocm91Z2g7XG4gICAgICB0aGlzLm5lZWRzRnVsbE1hbmlmZXN0ID0gbG9hZGVkLnN0YXRlLm5lZWRzRnVsbE1hbmlmZXN0O1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmluZGV4ID0ge307XG4gICAgICB0aGlzLmN1cnNvciA9IDA7XG4gICAgICB0aGlzLnN5bmNlZFRocm91Z2ggPSBudWxsO1xuICAgICAgdGhpcy5uZWVkc0Z1bGxNYW5pZmVzdCA9IGZhbHNlO1xuICAgIH1cbiAgICB0aGlzLnNlcnZlck9sZGVzdFJldGFpbmVkU2VxID0gbnVsbDtcblxuICAgIGNvbnN0IHRyYW5zcG9ydCA9IHRoaXMuZGlhbFRyYW5zcG9ydCgpO1xuICAgIHRoaXMudHJhbnNwb3J0ID0gdHJhbnNwb3J0O1xuICAgIHRyYW5zcG9ydC5vbk1lc3NhZ2UoKG1lc3NhZ2UpID0+IHRoaXMub25UcmFuc3BvcnRNZXNzYWdlKG1lc3NhZ2UpKTtcbiAgICB0cmFuc3BvcnQub25DbG9zZSgocmVhc29uKSA9PiB0aGlzLm9uVHJhbnNwb3J0Q2xvc2UocmVhc29uKSk7XG5cbiAgICBjb25zdCBoZWxsb0FjayA9IGF3YWl0IHRoaXMucmVxdWVzdDxIZWxsb0Fja01lc3NhZ2UgfCBTZXJ2ZXJFcnJvck1lc3NhZ2U+KFxuICAgICAgKG0pID0+IG0udHlwZSA9PT0gJ2hlbGxvQWNrJyB8fCBtLnR5cGUgPT09ICdlcnJvcicsXG4gICAgICAoKSA9PlxuICAgICAgICB0cmFuc3BvcnQuc2VuZCh7XG4gICAgICAgICAgdHlwZTogJ2hlbGxvJyxcbiAgICAgICAgICB0b2tlbjogdGhpcy5vcHRpb25zLnRva2VuLFxuICAgICAgICAgIHByb3RvY29sVmVyc2lvbjogUHJvdG9jb2xWZXJzaW9uLFxuICAgICAgICAgIGN1cnNvcjogdGhpcy5jdXJzb3IsXG4gICAgICAgIH0pLFxuICAgICk7XG4gICAgaWYgKGhlbGxvQWNrLnR5cGUgPT09ICdlcnJvcicpIHRocm93IHRoaXMudG9FcnJvcihoZWxsb0Fjayk7XG4gICAgLy8gVGhlIHNlcnZlcidzIHBlci12YXVsdCBgb2JzaWRpYW5TeW5jYCBzdXBlcnNlZGVzIHRoZSBsb2NhbCBpbml0aWFsXG4gICAgLy8gdmFsdWUsIGJ1dCBgZXh0cmFJZ25vcmVzYCBpcyBhIGNsaWVudC1zaWRlIGNvbmNlcm4gXHUyMDE0IHRoZSB3b3JrZXIgbmV2ZXJcbiAgICAvLyBzZW5kcyBpdCwgc28gdGhlIGxvY2FsbHkgY29uZmlndXJlZCBwYXR0ZXJucyBzdXJ2aXZlIHRoZSBoYW5kc2hha2UuXG4gICAgdGhpcy5pZ25vcmVTZXR0aW5ncyA9IHtcbiAgICAgIG9ic2lkaWFuU3luYzogaGVsbG9BY2suc2V0dGluZ3Mub2JzaWRpYW5TeW5jLFxuICAgICAgLi4uKHRoaXMuaWdub3JlU2V0dGluZ3MuZXh0cmFJZ25vcmVzICE9PSB1bmRlZmluZWRcbiAgICAgICAgPyB7IGV4dHJhSWdub3JlczogdGhpcy5pZ25vcmVTZXR0aW5ncy5leHRyYUlnbm9yZXMgfVxuICAgICAgICA6IHt9KSxcbiAgICB9O1xuICAgIC8vIFJlcGxheS13aW5kb3cgYW5zd2VyOiB3aXRoIHRoaXMsIHRoZSBjbGllbnQgY2FuIHRlbGwgd2hldGhlciBldmVyeVxuICAgIC8vIGV2ZW50IGFmdGVyIGl0cyBjdXJzb3Igd2FzIHJldGFpbmVkIChkZWx0YS1tYW5pZmVzdCBlbGlnaWJpbGl0eSkuXG4gICAgdGhpcy5zZXJ2ZXJPbGRlc3RSZXRhaW5lZFNlcSA9IGhlbGxvQWNrLm9sZGVzdFJldGFpbmVkU2VxID8/IG51bGw7XG5cbiAgICB0aGlzLnN0YXRlID0gJ3N5bmNpbmcnO1xuICAgIGlmICh0aGlzLnNob3VsZFJlcXVlc3REZWx0YU1hbmlmZXN0KCkpIHtcbiAgICAgIC8vIERFTFRBIE1PREU6IGFwcGx5IHRoZSByZXBsYXllZCBjaGFuZ2VzIEJFRk9SRSBwbGFubmluZy4gVGhlIGRlbHRhXG4gICAgICAvLyBtYW5pZmVzdCBvbWl0cyBldmVyeSBoZWFkIGF0IG9yIGJlbG93IHRoZSBjdXJzb3IgXHUyMDE0IGluY2x1ZGluZyBoZWFkc1xuICAgICAgLy8gdGhhdCBubyBsb25nZXIgZXhpc3QgYmVjYXVzZSB0aGUgYXV0aG9yaXR5IE1JR1JBVEVEIHRoZW0gKGEgcmVuYW1lXG4gICAgICAvLyBkZWxldGVzIHRoZSBvbGQgcm93KSBcdTIwMTQgc28gdGhlIGluZGV4IHByb2plY3Rpb24gbXVzdCBub3QgY2FycnkgdGhvc2VcbiAgICAgIC8vIHBhdGhzIGFueW1vcmUuIFRoZSByZXBsYXllZCByZW5hbWUgKHNlcSA+IGN1cnNvcikgbWF0ZXJpYWxpemVzIGhlcmVcbiAgICAgIC8vIGFuZCByZW1vdmVzIHRoZSBzdGFsZSBwYXRoLCBtYWtpbmcgdGhlIG1lcmdlZCB2aWV3IGlkZW50aWNhbCB0byB3aGF0XG4gICAgICAvLyBhIGZ1bGwgbWFuaWZlc3Qgd291bGQgaGF2ZSBzYWlkLiAoVGhlIG9yZGVyZWQgd2lyZSBndWFyYW50ZWVzIHRoZVxuICAgICAgLy8gcmVwbGF5IHByZWNlZGVzIHRoZSBtYW5pZmVzdCByZXBseTsgYW55dGhpbmcgc3RyYWdnbGluZyBzdGF5c1xuICAgICAgLy8gYnVmZmVyZWQgYW5kIGlzIGRpc3BhdGNoZWQgYWZ0ZXIgdGhlIGN5Y2xlLCBhcyBhbHdheXMuKSBBIHJlcGxheWVkXG4gICAgICAvLyBjaGFuZ2UgdGhhdCBoaXRzIHRoZSBkaXZlcmdlbmNlIGd1YXJkIGZsaXBzIGBuZWVkc0Z1bGxNYW5pZmVzdGAsXG4gICAgICAvLyBhbmQgYGZldGNoTWFuaWZlc3RgIHJlLWV2YWx1YXRlcyBcdTIwMTQgZmFsbGluZyBiYWNrIHRvIGZ1bGwsIGFzIGRlc2lnbmVkLlxuICAgICAgY29uc3QgcmVwbGF5ID0gdGhpcy5idWZmZXJlZDtcbiAgICAgIHRoaXMuYnVmZmVyZWQgPSBbXTtcbiAgICAgIGZvciAoY29uc3QgbWVzc2FnZSBvZiByZXBsYXkpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5kaXNwYXRjaChtZXNzYWdlKTtcbiAgICAgIH1cbiAgICB9XG4gICAgYXdhaXQgdGhpcy5ydW5DeWNsZSgpO1xuXG4gICAgdGhpcy5idWZmZXJpbmcgPSBmYWxzZTtcbiAgICBjb25zdCBidWZmZXJlZCA9IHRoaXMuYnVmZmVyZWQ7XG4gICAgdGhpcy5idWZmZXJlZCA9IFtdO1xuICAgIGZvciAoY29uc3QgbWVzc2FnZSBvZiBidWZmZXJlZCkge1xuICAgICAgYXdhaXQgdGhpcy5kaXNwYXRjaChtZXNzYWdlKTtcbiAgICB9XG4gICAgaWYgKCF0aGlzLmlzRGlzY29ubmVjdGVkKCkpIHRoaXMuc3RhdGUgPSAnbGl2ZSc7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHNhZmVTdG9yYWdlRXhpc3RzKHBhdGg6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5vcHRpb25zLnN0b3JhZ2UuZXhpc3RzKHBhdGgpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgb25UcmFuc3BvcnRDbG9zZShyZWFzb246IHsgY29kZT86IG51bWJlcjsgcmVhc29uPzogc3RyaW5nIH0pOiB2b2lkIHtcbiAgICB0aGlzLmxvZy53YXJuKCd0cmFuc3BvcnQgY2xvc2VkJywgcmVhc29uKTtcbiAgICB0aGlzLnN0YXRlID0gJ2Rpc2Nvbm5lY3RlZCc7XG4gICAgY29uc3QgZXhwZWN0YXRpb25zID0gdGhpcy5leHBlY3RhdGlvbnM7XG4gICAgdGhpcy5leHBlY3RhdGlvbnMgPSBbXTtcbiAgICBmb3IgKGNvbnN0IGV4cGVjdGF0aW9uIG9mIGV4cGVjdGF0aW9ucykge1xuICAgICAgZXhwZWN0YXRpb24ucmVqZWN0KFxuICAgICAgICBuZXcgTmV0d29ya0Vycm9yKGBjb25uZWN0aW9uIGNsb3NlZDogJHtyZWFzb24ucmVhc29uID8/IHJlYXNvbi5jb2RlID8/ICd1bmtub3duJ31gKSxcbiAgICAgICk7XG4gICAgfVxuICB9XG5cbiAgLy8gLS0tIG1lc3NhZ2UgcHVtcCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgcHJpdmF0ZSBvblRyYW5zcG9ydE1lc3NhZ2UgPSAobWVzc2FnZTogTWVzc2FnZSk6IHZvaWQgPT4ge1xuICAgIC8vIE9sZGVzdCBleHBlY3RhdGlvbiB0aGF0IGFjY2VwdHMgdGhpcyBtZXNzYWdlLiBXaXRoIHRoZSBwdXNoIHBpcGVsaW5lXG4gICAgLy8gc2V2ZXJhbCBjb21taXQgZXhwZWN0YXRpb25zIGFyZSBvdXRzdGFuZGluZyBhdCBvbmNlOyB0aGUgb3JkZXJlZCB3aXJlICtcbiAgICAvLyB0aGUgc2VydmVyJ3Mgc2VyaWFsaXplZCBhcmJpdHJhdGlvbiBkZWxpdmVyIHJlcGxpZXMgaW4gc2VuZCBvcmRlciwgc29cbiAgICAvLyBmaXJzdC1tYXRjaCBwYWlycyBlYWNoIHJlcGx5IHdpdGggaXRzIG93biByZXF1ZXN0LlxuICAgIGNvbnN0IGluZGV4ID0gdGhpcy5leHBlY3RhdGlvbnMuZmluZEluZGV4KChleHBlY3RhdGlvbikgPT4gZXhwZWN0YXRpb24ubWF0Y2hlcyhtZXNzYWdlKSk7XG4gICAgaWYgKGluZGV4ID49IDApIHtcbiAgICAgIGNvbnN0IGV4cGVjdGF0aW9uID0gdGhpcy5leHBlY3RhdGlvbnNbaW5kZXhdO1xuICAgICAgdGhpcy5leHBlY3RhdGlvbnMuc3BsaWNlKGluZGV4LCAxKTtcbiAgICAgIGlmIChleHBlY3RhdGlvbiAhPT0gdW5kZWZpbmVkKSBleHBlY3RhdGlvbi5yZXNvbHZlKG1lc3NhZ2UpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAodGhpcy5idWZmZXJpbmcpIHtcbiAgICAgIHRoaXMuYnVmZmVyZWQucHVzaChtZXNzYWdlKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5lbnF1ZXVlKGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuZGlzcGF0Y2gobWVzc2FnZSk7XG4gICAgfSkuY2F0Y2goKGVycm9yOiB1bmtub3duKSA9PiB0aGlzLmxvZy53YXJuKCdjaGFuZ2UgaGFuZGxlciBmYWlsZWQnLCBlcnJvcikpO1xuICB9O1xuXG4gIHByaXZhdGUgYXN5bmMgZGlzcGF0Y2gobWVzc2FnZTogTWVzc2FnZSk6IFByb21pc2U8dm9pZD4ge1xuICAgIHN3aXRjaCAobWVzc2FnZS50eXBlKSB7XG4gICAgICBjYXNlICdjaGFuZ2UnOlxuICAgICAgICBhd2FpdCB0aGlzLmhhbmRsZUNoYW5nZShtZXNzYWdlKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgY2FzZSAnZGV2aWNlU2Vlbic6XG4gICAgICAgIHJldHVybjsgLy8gcHJlc2VuY2Ugb25seTsgZGFzaGJvYXJkcyBjb25zdW1lIGl0XG4gICAgICBjYXNlICdwb25nJzpcbiAgICAgICAgcmV0dXJuO1xuICAgICAgY2FzZSAnZXJyb3InOlxuICAgICAgICB0aGlzLmxvZy5lcnJvcignc2VydmVyIGVycm9yJywgbWVzc2FnZS5jb2RlLCBtZXNzYWdlLm1lc3NhZ2UpO1xuICAgICAgICByZXR1cm47XG4gICAgICBjYXNlICdoZWxsb0Fjayc6XG4gICAgICBjYXNlICdtYW5pZmVzdCc6XG4gICAgICBjYXNlICdjb21taXRBY2snOlxuICAgICAgY2FzZSAnY29uZmxpY3QnOlxuICAgICAgY2FzZSAnYmxvYic6XG4gICAgICBjYXNlICdibG9iQWNrJzpcbiAgICAgICAgLy8gUmVwbGllcyBhcnJpdmUgb25seSBhZ2FpbnN0IGFuIG91dHN0YW5kaW5nIGV4cGVjdGF0aW9uOyBhXG4gICAgICAgIC8vIHNwb250YW5lb3VzIG9uZSBpcyBhIHByb3RvY29sIHZpb2xhdGlvbiB3ZSBsb2cgYW5kIGRyb3AuXG4gICAgICAgIHRoaXMubG9nLndhcm4oJ3VuZXhwZWN0ZWQgc2VydmVyIHJlcGx5JywgbWVzc2FnZS50eXBlKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgdGhpcy5sb2cud2FybignaWdub3JpbmcgY2xpZW50LXRvLXNlcnZlciBtZXNzYWdlIGZyb20gc2VydmVyJywgbWVzc2FnZSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBoYW5kbGVDaGFuZ2UoY2hhbmdlOiBDaGFuZ2VNZXNzYWdlKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKGNoYW5nZS5zZXEgPiB0aGlzLmN1cnNvcikgdGhpcy5jdXJzb3IgPSBjaGFuZ2Uuc2VxO1xuICAgIGlmIChpc0lnbm9yZWQoY2hhbmdlLnBhdGgsIHRoaXMuaWdub3JlU2V0dGluZ3MpKSByZXR1cm47XG4gICAgaWYgKGNoYW5nZS5mcm9tUGF0aCAhPT0gdW5kZWZpbmVkICYmIGlzSWdub3JlZChjaGFuZ2UuZnJvbVBhdGgsIHRoaXMuaWdub3JlU2V0dGluZ3MpKSByZXR1cm47XG5cbiAgICAvLyBTdGFsZSByZXBsYXkgLyBkdXBsaWNhdGUgZmFuLW91dDogcGVyIHBhdGggdGhlIGhlYWQgY2xvY2sgZG9taW5hdGVzXG4gICAgLy8gZXZlcnkgZWFybGllciB2ZXJzaW9uLCBzbyBhbnl0aGluZyBcdTIyNjQgdGhlIHJlY29yZGVkIGNsb2NrIGlzIG9sZCBuZXdzLlxuICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5pbmRleFtjaGFuZ2UucGF0aF07XG4gICAgaWYgKGVudHJ5ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGlmIChlbnRyeS52ZXJzaW9uSWQgPT09IGNoYW5nZS52ZXJzaW9uKSByZXR1cm47XG4gICAgICBpZiAoY29tcGFyZUNsb2NrcyhlbnRyeS5jbG9jaywgY2hhbmdlLmNsb2NrKSA+PSAwKSByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gVGhlIGd1YXJkOiBuZXZlciB3cml0ZSBhIHJlbW90ZSBjaGFuZ2Ugb3ZlciBsb2NhbGx5LWRpdmVyZ2VkIGNvbnRlbnQuXG4gICAgaWYgKCEoYXdhaXQgdGhpcy5jaGFuZ2VJc1NhZmUoY2hhbmdlKSkpIHtcbiAgICAgIHRoaXMubG9nLmluZm8oJ2RlZmVycmluZyByZW1vdGUgY2hhbmdlIG92ZXIgbG9jYWwgZGl2ZXJnZW5jZScsIGNoYW5nZS5wYXRoKTtcbiAgICAgIC8vIFRoZSBkaXZlcmdlbmNlIG11c3QgYmUgcmVzb2x2ZWQgYnkgYSBwbGFuIGN5Y2xlIHRoYXQgY2FuIFNFRSB0aGVcbiAgICAgIC8vIHJlbW90ZSBoZWFkIFx1MjAxNCBmbGFnIHRoZSBuZXh0IG1hbmlmZXN0IGZ1bGwgKGRlbHRhIG1hbmlmZXN0cyBvbWl0XG4gICAgICAvLyBoZWFkcyBhdCBvciBiZWxvdyB0aGUgY3Vyc29yLCB3aGljaCB0aGlzIGNoYW5nZSBtYXkgYmUgYXQpLlxuICAgICAgdGhpcy5uZWVkc0Z1bGxNYW5pZmVzdCA9IHRydWU7XG4gICAgICB0aGlzLnNjaGVkdWxlUmVjb25jaWxlKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdGhpcy5pbmRleCA9IGF3YWl0IHRoaXMuYXBwbHlQdWxscyhbdGhpcy5wdWxsT3BGcm9tQ2hhbmdlKGNoYW5nZSldKTtcbiAgICAvLyBUaGlzIHBhdGgncyBoZWFkIGlzIG5vdyBtYXRlcmlhbGl6ZWQgbG9jYWxseSwgc28gdGhlIGNvbXBsZXRpb25cbiAgICAvLyB3YXRlcm1hcmsgYWR2YW5jZXMgd2l0aCB0aGUgKHN0cmljdGx5IG9yZGVyZWQpIGZlZWQuIEEgY2hhbmdlIHRoYXRcbiAgICAvLyB0b29rIHRoZSBkZWZlciBicmFuY2ggYWJvdmUgbmV2ZXIgcmVhY2hlcyB0aGlzIGxpbmUsIGFuZCBpdHNcbiAgICAvLyBgbmVlZHNGdWxsTWFuaWZlc3RgIGZsYWcga2VlcHMgZGVsdGEgbW9kZSBvZmYgdW50aWwgYSBmdWxsLW1hbmlmZXN0XG4gICAgLy8gY3ljbGUgcmVzb2x2ZXMgdGhlIGRpdmVyZ2VuY2UuXG4gICAgaWYgKGNoYW5nZS5zZXEgPiAodGhpcy5zeW5jZWRUaHJvdWdoID8/IDApKSB0aGlzLnN5bmNlZFRocm91Z2ggPSBjaGFuZ2Uuc2VxO1xuICB9XG5cbiAgLyoqXG4gICAqIEEgY2hhbmdlIG1heSBiZSBhcHBsaWVkIGRpcmVjdGx5IG9ubHkgd2hlbiB0aGUgdG91Y2hlZCBwYXRocyBjYXJyeSBub1xuICAgKiB1bi1yZWNvbmNpbGVkIGxvY2FsIGNvbnRlbnQuIEFueXRoaW5nIGVsc2UgbXVzdCBkZXRvdXIgdGhyb3VnaCBhIGZ1bGxcbiAgICogYGNvbXB1dGVTeW5jUGxhbmAgY3ljbGUgKGNvbmZsaWN0IGxvZ2ljLCBjb25mbGljdCBjb3BpZXMpLlxuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyBjaGFuZ2VJc1NhZmUoY2hhbmdlOiBDaGFuZ2VNZXNzYWdlKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgaWYgKGNoYW5nZS5pc0ZvbGRlciA9PT0gdHJ1ZSkgcmV0dXJuIHRydWU7XG4gICAgaWYgKGNoYW5nZS5raW5kID09PSAncmVuYW1lJyAmJiBjaGFuZ2UuZnJvbVBhdGggIT09IHVuZGVmaW5lZCkge1xuICAgICAgaWYgKGF3YWl0IHRoaXMucGF0aEhhc0xvY2FsRGl2ZXJnZW5jZShjaGFuZ2UuZnJvbVBhdGgpKSByZXR1cm4gZmFsc2U7XG4gICAgICBpZiAoYXdhaXQgdGhpcy5zdG9yYWdlRXhpc3RzKGNoYW5nZS5wYXRoKSkge1xuICAgICAgICBjb25zdCBlbnRyeSA9IHRoaXMuaW5kZXhbY2hhbmdlLnBhdGhdO1xuICAgICAgICBpZiAoZW50cnkgPT09IHVuZGVmaW5lZCB8fCBlbnRyeS5kZWxldGVkQXQgIT09IHVuZGVmaW5lZCkgcmV0dXJuIGZhbHNlO1xuICAgICAgICBjb25zdCBhY3R1YWwgPSBhd2FpdCBzaGEyNTZIZXgoYXdhaXQgdGhpcy5vcHRpb25zLnN0b3JhZ2UucmVhZEZpbGUoY2hhbmdlLnBhdGgpKTtcbiAgICAgICAgaWYgKGFjdHVhbCAhPT0gZW50cnkuaGFzaCkgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIHJldHVybiAhKGF3YWl0IHRoaXMucGF0aEhhc0xvY2FsRGl2ZXJnZW5jZShjaGFuZ2UucGF0aCkpO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBwYXRoSGFzTG9jYWxEaXZlcmdlbmNlKHBhdGg6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5pbmRleFtwYXRoXTtcbiAgICBpZiAoZW50cnk/LmlzRm9sZGVyKSByZXR1cm4gZmFsc2U7XG4gICAgaWYgKCEoYXdhaXQgdGhpcy5zdG9yYWdlRXhpc3RzKHBhdGgpKSkgcmV0dXJuIGZhbHNlO1xuICAgIGlmIChlbnRyeSA9PT0gdW5kZWZpbmVkIHx8IGVudHJ5LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkKSByZXR1cm4gdHJ1ZTtcbiAgICBjb25zdCBhY3R1YWwgPSBhd2FpdCBzaGEyNTZIZXgoYXdhaXQgdGhpcy5vcHRpb25zLnN0b3JhZ2UucmVhZEZpbGUocGF0aCkpO1xuICAgIHJldHVybiBhY3R1YWwgIT09IGVudHJ5Lmhhc2g7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHN0b3JhZ2VFeGlzdHMocGF0aDogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLm9wdGlvbnMuc3RvcmFnZS5leGlzdHMocGF0aCk7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBwdWxsT3BGcm9tQ2hhbmdlKGNoYW5nZTogQ2hhbmdlTWVzc2FnZSk6IFB1bGxPcCB7XG4gICAgaWYgKGNoYW5nZS5raW5kID09PSAncmVuYW1lJyAmJiBjaGFuZ2UuZnJvbVBhdGggIT09IHVuZGVmaW5lZCkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAga2luZDogJ3JlbmFtZScsXG4gICAgICAgIGZyb21QYXRoOiBjaGFuZ2UuZnJvbVBhdGgsXG4gICAgICAgIHRvUGF0aDogY2hhbmdlLnBhdGgsXG4gICAgICAgIGhhc2g6IGNoYW5nZS5oYXNoLFxuICAgICAgICBzaXplOiBjaGFuZ2Uuc2l6ZSxcbiAgICAgICAgdmVyc2lvbjogY2hhbmdlLnZlcnNpb24sXG4gICAgICAgIGNsb2NrOiBjaGFuZ2UuY2xvY2ssXG4gICAgICB9O1xuICAgIH1cbiAgICBjb25zdCBlbnRyeSA9IHRoaXMuaW5kZXhbY2hhbmdlLnBhdGhdO1xuICAgIGNvbnN0IGtpbmQ6IFB1bGxGaWxlT3BbJ2tpbmQnXSA9IGNoYW5nZS5kZWxldGVkXG4gICAgICA/ICdkZWxldGUnXG4gICAgICA6IGVudHJ5ID09PSB1bmRlZmluZWRcbiAgICAgICAgPyAnYWRkJ1xuICAgICAgICA6IGVudHJ5LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkXG4gICAgICAgICAgPyAncmVzdG9yZSdcbiAgICAgICAgICA6ICdlZGl0JztcbiAgICByZXR1cm4ge1xuICAgICAga2luZCxcbiAgICAgIHBhdGg6IGNoYW5nZS5wYXRoLFxuICAgICAgaGFzaDogY2hhbmdlLmhhc2gsXG4gICAgICBzaXplOiBjaGFuZ2Uuc2l6ZSxcbiAgICAgIHZlcnNpb246IGNoYW5nZS52ZXJzaW9uLFxuICAgICAgY2xvY2s6IGNoYW5nZS5jbG9jayxcbiAgICAgIGRlbGV0ZWQ6IGNoYW5nZS5kZWxldGVkLFxuICAgICAgLi4uKGNoYW5nZS5pc0ZvbGRlciA9PT0gdHJ1ZSA/IHsgaXNGb2xkZXI6IHRydWUgfSA6IHt9KSxcbiAgICB9O1xuICB9XG5cbiAgLyoqIE1hdGVyaWFsaXplIHB1bGxzIHRocm91Z2ggdGhlIHZlcmlmaWVkIGVuZ2luZSBwYXRoOyByZXR1cm5zIHRoZSBuZXcgaW5kZXguICovXG4gIHByaXZhdGUgYXN5bmMgYXBwbHlQdWxscyhcbiAgICBwdWxsczogUmVhZG9ubHlBcnJheTxQdWxsT3A+LFxuICAgIHByb2dyZXNzPzogeyBvblByb2dyZXNzOiAoZG9uZTogbnVtYmVyLCB0b3RhbDogbnVtYmVyKSA9PiB2b2lkIH0sXG4gICk6IFByb21pc2U8TG9jYWxJbmRleD4ge1xuICAgIHJldHVybiBhcHBseVB1bGwoXG4gICAgICB0aGlzLm9wdGlvbnMuc3RvcmFnZSxcbiAgICAgIHRoaXMuaW5kZXgsXG4gICAgICB7IHB1c2hlczogW10sIHB1bGxzOiBbLi4ucHVsbHNdLCBjb25mbGljdHM6IFtdLCBmb2xkZXJQdXNoZXM6IFtdIH0sXG4gICAgICB0aGlzLmZldGNoQmxvYixcbiAgICAgIHtcbiAgICAgICAgbm93OiB0aGlzLm5vdygpLFxuICAgICAgICAvLyBLZWVwIHRoZSBlbnZlbG9wZSdzIGN1cnNvciBib29ra2VlcGluZyBpbnRhY3QgYWNyb3NzIHB1bGwtc2lkZVxuICAgICAgICAvLyBwZXJzaXN0cyAoYXBwbHlQdWxsIHJld3JpdGVzIHRoZSB3aG9sZSBzdGF0ZSBmaWxlKS5cbiAgICAgICAgcGVyc2lzdGVkU3RhdGU6IHRoaXMucGVyc2lzdGVkU3RhdGUoKSxcbiAgICAgICAgLi4uKHByb2dyZXNzICE9PSB1bmRlZmluZWQgPyB7IG9uUHJvZ3Jlc3M6IHByb2dyZXNzLm9uUHJvZ3Jlc3MgfSA6IHt9KSxcbiAgICAgIH0sXG4gICAgKTtcbiAgfVxuXG4gIC8qKiBUaGUgZW52ZWxvcGUgYm9va2tlZXBpbmcgd3JpdHRlbiB3aGVuZXZlciB0aGUgY2xpZW50IHBlcnNpc3RzIHRoZSBpbmRleC4gKi9cbiAgcHJpdmF0ZSBwZXJzaXN0ZWRTdGF0ZSgpOiBQZXJzaXN0ZWRTeW5jU3RhdGUge1xuICAgIHJldHVybiB7XG4gICAgICBjdXJzb3I6IHRoaXMuY3Vyc29yLFxuICAgICAgc3luY2VkVGhyb3VnaDogdGhpcy5zeW5jZWRUaHJvdWdoLFxuICAgICAgbmVlZHNGdWxsTWFuaWZlc3Q6IHRoaXMubmVlZHNGdWxsTWFuaWZlc3QsXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmQgb25lIGJ1bGstcGhhc2Ugc3RlcCBvbiBgc3RhdHVzKCkucHJvZ3Jlc3NgLiBDb2FsZXNjZWQgdG8gYXQgbW9zdFxuICAgKiBvbmUgdXBkYXRlIHBlciBgcHJvZ3Jlc3NUaHJvdHRsZU1zYCAocmVuZGVyZXIgY2h1cm4pLCBFWENFUFQgcGhhc2VcbiAgICogY2hhbmdlcyBhbmQgY29tcGxldGlvbnMsIHdoaWNoIGFsd2F5cyBlbWl0IHNvIGEgcGhhc2UgaXMgbmV2ZXIgbWlzc2VkXG4gICAqIGFuZCBgZG9uZS90b3RhbGAgYWx3YXlzIGxhbmRzIG9uIGl0cyBmaW5hbCB2YWx1ZS5cbiAgICovXG4gIHByaXZhdGUgZW1pdFByb2dyZXNzKHBoYXNlOiBTeW5jUGhhc2UsIGRvbmU6IG51bWJlciwgdG90YWw6IG51bWJlcik6IHZvaWQge1xuICAgIGlmICh0b3RhbCA9PT0gMCkgcmV0dXJuOyAvLyBub3RoaW5nIHRvIHNob3cgZm9yIGFuIGVtcHR5IHBoYXNlXG4gICAgY29uc3Qgbm93ID0gdGhpcy5ub3coKTtcbiAgICBjb25zdCBjb21wbGV0ZSA9IGRvbmUgPj0gdG90YWw7XG4gICAgY29uc3QgcGhhc2VDaGFuZ2VkID0gdGhpcy5wcm9ncmVzcz8ucGhhc2UgIT09IHBoYXNlO1xuICAgIGlmICghY29tcGxldGUgJiYgIXBoYXNlQ2hhbmdlZCAmJiBub3cgLSB0aGlzLmxhc3RQcm9ncmVzc0F0IDwgdGhpcy5wcm9ncmVzc1Rocm90dGxlTXMpIHJldHVybjtcbiAgICB0aGlzLmxhc3RQcm9ncmVzc0F0ID0gbm93O1xuICAgIHRoaXMucHJvZ3Jlc3MgPSB7IHBoYXNlLCBkb25lLCB0b3RhbCB9O1xuICB9XG5cbiAgLy8gLS0tIHdhdGNoZXIgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgcHJpdmF0ZSBvbldhdGNoRXZlbnRzKGV2ZW50czogUmVhZG9ubHlBcnJheTx7IHBhdGg6IHN0cmluZyB9Pik6IHZvaWQge1xuICAgIGNvbnN0IHJlbGV2YW50ID0gZXZlbnRzLmZpbHRlcigoZXZlbnQpID0+ICFpc0lnbm9yZWQoZXZlbnQucGF0aCwgdGhpcy5pZ25vcmVTZXR0aW5ncykpO1xuICAgIGlmIChyZWxldmFudC5sZW5ndGggPT09IDApIHJldHVybjtcbiAgICB0aGlzLnBlbmRpbmcgKz0gcmVsZXZhbnQubGVuZ3RoO1xuICAgIHRoaXMuc2NoZWR1bGVSZWNvbmNpbGUoKTtcbiAgfVxuXG4gIC8qKiBEZWJvdW5jZWQgc2Nhblx1MjE5MnBsYW5cdTIxOTJleGVjdXRlIChzaGFyZWQgYnkgd2F0Y2hlciBhbmQgZGVmZXJyZWQgY2hhbmdlcykuICovXG4gIHByaXZhdGUgc2NoZWR1bGVSZWNvbmNpbGUoKTogdm9pZCB7XG4gICAgdGhpcy5jYW5jZWxEZWJvdW5jZT8uKCk7XG4gICAgdGhpcy5jYW5jZWxEZWJvdW5jZSA9IHRoaXMuc2NoZWR1bGUoKCkgPT4ge1xuICAgICAgdGhpcy5jYW5jZWxEZWJvdW5jZSA9IG51bGw7XG4gICAgICB0aGlzLmVucXVldWUoKCkgPT4gdGhpcy5ydW5DeWNsZSgpKS5jYXRjaCgoZXJyb3I6IHVua25vd24pID0+XG4gICAgICAgIHRoaXMubG9nLndhcm4oJ2RlYm91bmNlZCBzeW5jIGN5Y2xlIGZhaWxlZCcsIGVycm9yKSxcbiAgICAgICk7XG4gICAgfSwgdGhpcy5kZWJvdW5jZU1zKTtcbiAgfVxuXG4gIC8vIC0tLSB0aGUgc3luYyBjeWNsZSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuQ3ljbGUoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKHRoaXMudHJhbnNwb3J0ID09PSBudWxsIHx8IHRoaXMuaXNEaXNjb25uZWN0ZWQoKSkgcmV0dXJuO1xuICAgIHRoaXMuc3RhdGUgPSAnc3luY2luZyc7XG4gICAgdGhpcy5wcm9ncmVzcyA9IG51bGw7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IG1hbmlmZXN0ID0gYXdhaXQgdGhpcy5mZXRjaE1hbmlmZXN0KCk7XG4gICAgICBjb25zdCBsb2NhbENoYW5nZXMgPSBhd2FpdCBzY2FuVmF1bHQoXG4gICAgICAgIHRoaXMub3B0aW9ucy5zdG9yYWdlLFxuICAgICAgICB0aGlzLmluZGV4LFxuICAgICAgICB0aGlzLmlnbm9yZVNldHRpbmdzLFxuICAgICAgICB0aGlzLm5vdygpLFxuICAgICAgICB7XG4gICAgICAgICAgb25Qcm9ncmVzczogKGRvbmUsIHRvdGFsKSA9PiB0aGlzLmVtaXRQcm9ncmVzcygnc2Nhbm5pbmcnLCBkb25lLCB0b3RhbCksXG4gICAgICAgICAgLy8gU2hhcnBlbnMgdGhlIHN0YWxlRGlycyBydWxlOiBhbiBlbXB0eSBkaXIgb3ZlciBhIHRvbWJzdG9uZSBUSElTXG4gICAgICAgICAgLy8gZGV2aWNlIGF1dGhvcmVkIGlzIGEgbG9jYWwgcmVjcmVhdGlvbiwgbm90IGEgZGVsZXRpb24gcmVzaWR1ZS5cbiAgICAgICAgICB0aGlzRGV2aWNlSWQ6IHRoaXMub3B0aW9ucy5kZXZpY2VJZCxcbiAgICAgICAgfSxcbiAgICAgICk7XG4gICAgICBjb25zdCBwbGFuID0gY29tcHV0ZVN5bmNQbGFuKHtcbiAgICAgICAgbG9jYWxDaGFuZ2VzLFxuICAgICAgICBpbmRleDogdGhpcy5pbmRleCxcbiAgICAgICAgbWFuaWZlc3QsXG4gICAgICAgIHRoaXNEZXZpY2VJZDogdGhpcy5vcHRpb25zLmRldmljZUlkLFxuICAgICAgICB0aGlzRGV2aWNlTmFtZTogdGhpcy5vcHRpb25zLmRldmljZU5hbWUsXG4gICAgICAgIG5vdzogdGhpcy5ub3coKSxcbiAgICAgIH0pO1xuICAgICAgdGhpcy5jb25mbGljdHMgPSBbLi4udGhpcy5jb25mbGljdHMsIC4uLnBsYW4uY29uZmxpY3RzXTtcblxuICAgICAgLy8gU3RhZ2UgcHVzaCBjb250ZW50cyBCRUZPUkUgcHVsbHMgb3ZlcndyaXRlIHRoZSB3b3JraW5nIHRyZWUgKGFcbiAgICAgIC8vIGNvbmZsaWN0LWNvcHkgcHVzaCByZWFkcyB0aGUgbG9zZXIgY29udGVudCBmcm9tIHRoZSBvcmlnaW5hbCBwYXRoKS5cbiAgICAgIGNvbnN0IHN0YWdlZCA9IGF3YWl0IHRoaXMuc3RhZ2VQdXNoZXMocGxhbiwgbG9jYWxDaGFuZ2VzLmhhc2hlZCk7XG5cbiAgICAgIHRoaXMuaW5kZXggPSBhd2FpdCB0aGlzLmFwcGx5UHVsbHMocGxhbi5wdWxscywge1xuICAgICAgICBvblByb2dyZXNzOiAoZG9uZSwgdG90YWwpID0+IHRoaXMuZW1pdFByb2dyZXNzKCdwdWxsaW5nJywgZG9uZSwgdG90YWwpLFxuICAgICAgfSk7XG5cbiAgICAgIC8vIFB1c2ggcGlwZWxpbmU6IHVwIHRvIGBwdXNoQ29uY3VycmVuY3lgIGNvbW1pdHMgaW4gZmxpZ2h0OyBhY2tzIGZvbGRcbiAgICAgIC8vIGludG8gdGhlIGluZGV4IGFzIHRoZXkgYXJyaXZlIChzZXJpYWxpemVkIHRocm91Z2ggYGFja0NoYWluYCkuXG4gICAgICAvLyBCbG9iIHVwbG9hZHMgZm9yID4yNTZLQiBmaWxlcyBzdGFydCBpbnNpZGUgdGhlaXIgc2xvdCBhbmQgb3ZlcmxhcFxuICAgICAgLy8gd2l0aCB0aGUgT1RIRVIgc2xvdHMnIGluLWZsaWdodCBjb21taXRzIGluc3RlYWQgb2Ygc2VyaWFsaXppbmcuXG4gICAgICBjb25zdCBwdXNoVG90YWwgPSBzdGFnZWQubGVuZ3RoICsgcGxhbi5mb2xkZXJQdXNoZXMubGVuZ3RoO1xuICAgICAgbGV0IHB1c2hEb25lID0gMDtcbiAgICAgIGNvbnN0IHNldHRsZVB1c2ggPSAoKTogdm9pZCA9PiB7XG4gICAgICAgIHB1c2hEb25lICs9IDE7XG4gICAgICAgIHRoaXMuZW1pdFByb2dyZXNzKCdwdXNoaW5nJywgcHVzaERvbmUsIHB1c2hUb3RhbCk7XG4gICAgICB9O1xuICAgICAgdGhpcy5lbWl0UHJvZ3Jlc3MoJ3B1c2hpbmcnLCAwLCBwdXNoVG90YWwpO1xuICAgICAgYXdhaXQgdGhpcy5ydW5QdXNoUGlwZWxpbmUoc3RhZ2VkLCBzZXR0bGVQdXNoKTtcblxuICAgICAgLy8gUHJ1bmUtb24tZGVsZXRlIChDKSwgbG9jYWwgc2lkZTogZXZlcnkgZGVsZXRpb24gdGhhdCBhY3R1YWxseVxuICAgICAgLy8gY29tbWl0dGVkIHRoaXMgY3ljbGUgKHRoZSBpbmRleCBub3cgdG9tYnN0b25lcyBpdCAvIG1pZ3JhdGVkIGl0IGF3YXkpXG4gICAgICAvLyBtYXkgaGF2ZSBlbXB0aWVkIGl0cyBwYXJlbnQgZGlyZWN0b3J5LiBSZW1vdmUgc3VjaCBkaXJlY3RvcmllcyBcdTIwMTRcbiAgICAgIC8vIEJFRk9SRSB0aGUgcGxhY2Vob2xkZXIgcHVzaGVzIGJlbG93LCBzbyBhbiBlbXB0aWVkIGRpcmVjdG9yeSBpcyBub3RcbiAgICAgIC8vIGltbWVkaWF0ZWx5IHJlLXB1c2hlZCBhcyBhbiBlbXB0eS1mb2xkZXIgcGxhY2Vob2xkZXIuXG4gICAgICBjb25zdCBlbXB0aWVkRGlycyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICAgICAgZm9yIChjb25zdCBjb21taXQgb2Ygc3RhZ2VkKSB7XG4gICAgICAgIC8vIFRoZSBwYXRoIHRoYXQgY2Vhc2VkIHRvIGV4aXN0LCBJRiBpdHMgY29tbWl0IGFjdHVhbGx5IGxhbmRlZFxuICAgICAgICAvLyAodG9tYnN0b25lZCBpbiB0aGUgaW5kZXggZm9yIGRlbGV0ZXM7IG1pZ3JhdGVkIGF3YXkgZm9yIHJlbmFtZXMgXHUyMDE0XG4gICAgICAgIC8vIGEgZGVsZXRlIHRoYXQgbG9zdCBpdHMgcmFjZSB0byBhIHJlbW90ZSBlZGl0IGlzIG5vdCBhIGRlbGV0aW9uKS5cbiAgICAgICAgbGV0IGNlYXNlZFBhdGg6IHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgICAgICAgaWYgKGNvbW1pdC5raW5kID09PSAnZGVsZXRlJyAmJiBjb21taXQuaXNGb2xkZXIgIT09IHRydWUpIHtcbiAgICAgICAgICBpZiAodGhpcy5pbmRleFtjb21taXQucGF0aF0/LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkKSBjZWFzZWRQYXRoID0gY29tbWl0LnBhdGg7XG4gICAgICAgIH0gZWxzZSBpZiAoY29tbWl0LmtpbmQgPT09ICdyZW5hbWUnICYmIGNvbW1pdC5mcm9tUGF0aCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgaWYgKCEoY29tbWl0LmZyb21QYXRoIGluIHRoaXMuaW5kZXgpKSBjZWFzZWRQYXRoID0gY29tbWl0LmZyb21QYXRoO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjZWFzZWRQYXRoID09PSB1bmRlZmluZWQpIGNvbnRpbnVlO1xuICAgICAgICBjb25zdCBwcnVuZWQgPSBhd2FpdCBwcnVuZVBhcmVudE9uRGVsZXRlKHRoaXMub3B0aW9ucy5zdG9yYWdlLCB0aGlzLmluZGV4LCBjZWFzZWRQYXRoKTtcbiAgICAgICAgaWYgKHBydW5lZCA9PT0gdW5kZWZpbmVkKSBjb250aW51ZTtcbiAgICAgICAgZW1wdGllZERpcnMuYWRkKHBydW5lZC5kaXIpO1xuICAgICAgICBjb25zdCBwbGFjZWhvbGRlciA9IHRoaXMuaW5kZXhbcHJ1bmVkLmRpcl07XG4gICAgICAgIGlmIChwbGFjZWhvbGRlcj8uaXNGb2xkZXIgJiYgcGxhY2Vob2xkZXIuZGVsZXRlZEF0ID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAvLyBXZSBqdXN0IHJlbW92ZWQgdGhlIGRpcmVjdG9yeSBhIGxpdmUgcGxhY2Vob2xkZXIgc3RpbGwgY2xhaW1zOlxuICAgICAgICAgIC8vIHNjYW4gYWdhaW4gc28gdGhlIHBsYWNlaG9sZGVyIGlzIHRvbWJzdG9uZWQgYW5kIHByb3BhZ2F0ZXMuXG4gICAgICAgICAgdGhpcy5zY2hlZHVsZVJlY29uY2lsZSgpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIC8vIFN0YWxlLWxlZnRvdmVyIGNsZWFudXAgKEYtMSk6IGEgdG9tYnN0b25lZCBmb2xkZXIgcGxhY2Vob2xkZXIgd2hvc2VcbiAgICAgIC8vIEVNUFRZIGRpcmVjdG9yeSBzdGlsbCBleGlzdHMgb24gZGlzayBcdTIwMTQgdGhlIHJlc2lkdWUgb2YgYSByZWNvcmQtb25seVxuICAgICAgLy8gdG9tYnN0b25lIGFwcGxpY2F0aW9uIChhbiBhZGFwdGVyIHdpdGhvdXQgYHJlbW92ZURpcmAsIG9yIGEgcmVtb3ZhbFxuICAgICAgLy8gdGhhdCBsb3N0IGEgcmFjZSkuIFRoZSBzY2FuIGRlbGliZXJhdGVseSBjbGFzc2lmaWVzIHRoZXNlIGFzXG4gICAgICAvLyBgc3RhbGVEaXJzYCBpbnN0ZWFkIG9mIGBlbXB0eUZvbGRlcnNgLCBzbyBub3RoaW5nIGJlbG93IHJlLXB1c2hlc1xuICAgICAgLy8gdGhlbSBhcyBwbGFjZWhvbGRlcnMgKHRoYXQgcmUtcHVzaCByZXN1cnJlY3RlZCBkZWxldGVkIGZvbGRlcnMgYW5kXG4gICAgICAvLyBwaW5nLXBvbmdlZCB0aGUgZGVsZXRpb24gYmV0d2VlbiBkZXZpY2VzKS4gUmV0cnlpbmcgdGhlIHJlbW92YWwgaGVyZVxuICAgICAgLy8gY29udmVyZ2VzIHN0b3JhZ2Ugb250byB0aGUgdG9tYnN0b25lLlxuICAgICAgZm9yIChjb25zdCBkaXIgb2YgbG9jYWxDaGFuZ2VzLnN0YWxlRGlycyA/PyBbXSkge1xuICAgICAgICBhd2FpdCByZW1vdmVEaXJJZlZhY2FudCh0aGlzLm9wdGlvbnMuc3RvcmFnZSwgdGhpcy5pbmRleCwgZGlyKTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgZm9sZGVyQ29tbWl0czogU3RhZ2VkQ29tbWl0W10gPSBbXTtcbiAgICAgIGZvciAoY29uc3QgcGF0aCBvZiBwbGFuLmZvbGRlclB1c2hlcykge1xuICAgICAgICAvLyBOZXZlciByZXN1cnJlY3QgYSBkaXJlY3RvcnkgdGhpcyBjeWNsZSBlbXB0aWVkIChkZWxldGUtZGVyaXZlZFxuICAgICAgICAvLyBwbGFjZWhvbGRlcnMgYXJlIHN1cHByZXNzZWQgZXZlbiB3aGVuIHJlbW92YWwgaXRzZWxmIHdhcyBub3RcbiAgICAgICAgLy8gcG9zc2libGUpLCBub3IgcHVzaCBvbmUgdGhhdCB2YW5pc2hlZCBzaW5jZSB0aGUgc2Nhbi5cbiAgICAgICAgaWYgKGVtcHRpZWREaXJzLmhhcyhwYXRoKSkgY29udGludWU7XG4gICAgICAgIGlmICghKGF3YWl0IHRoaXMuc3RvcmFnZUV4aXN0cyhwYXRoKSkpIGNvbnRpbnVlO1xuICAgICAgICBmb2xkZXJDb21taXRzLnB1c2goe1xuICAgICAgICAgIGtpbmQ6ICdlZGl0JyxcbiAgICAgICAgICBwYXRoLFxuICAgICAgICAgIHBhcmVudFZlcnNpb246IHRoaXMuaW5kZXhbcGF0aF0/LnZlcnNpb25JZCA/PyBudWxsLFxuICAgICAgICAgIGhhc2g6ICcnLFxuICAgICAgICAgIHNpemU6IDAsXG4gICAgICAgICAgaXNGb2xkZXI6IHRydWUsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgYXdhaXQgdGhpcy5ydW5QdXNoUGlwZWxpbmUoZm9sZGVyQ29tbWl0cywgc2V0dGxlUHVzaCk7XG5cbiAgICAgIC8vIENhY2hlIHRoZSBzY2FuJ3MgaGFzaCBvYnNlcnZhdGlvbnMgKG10aW1lKSBvbnRvIGVudHJpZXMgd2hvc2UgaGFzaFxuICAgICAgLy8gc3RpbGwgbWF0Y2hlcywgc28gdGhlIG5leHQgZmFzdCBzY2FuIGNhbiBza2lwIHRob3NlIGZpbGVzLiBSdW5zXG4gICAgICAvLyBhZnRlciBwdWxscy9wdXNoZXMgc28gZnJlc2hseS1hY2tlZCBlbnRyaWVzIGJlbmVmaXQgaW1tZWRpYXRlbHk7XG4gICAgICAvLyBgcmVjb3JkSGFzaGVkRmlsZXNgIHNraXBzIGFueXRoaW5nIHRoZSBjeWNsZSBjaGFuZ2VkIHVuZGVybmVhdGggdXMuXG4gICAgICB0aGlzLmluZGV4ID0gcmVjb3JkSGFzaGVkRmlsZXModGhpcy5pbmRleCwgbG9jYWxDaGFuZ2VzLmhhc2hlZCk7XG5cbiAgICAgIC8vIFRoZSBjeWNsZSBmaW5pc2hlZCBjbGVhbjogZXZlcnkgcHVsbCBvZiB0aGUgbWFuaWZlc3QgYXBwbGllZCwgZXZlcnlcbiAgICAgIC8vIHN0YWdlZCBjb21taXQgYWNrZWQuIFRoZSBpbmRleCBpcyBub3cgY29tcGxldGUgdGhyb3VnaCB0aGUgTUFOSUZFU1Qnc1xuICAgICAgLy8gZmV0Y2gtdGltZSBjdXJzb3IgKGRlbGliZXJhdGVseSBub3QgdGhlIGxhdGVyIGFjayBzZXFzIFx1MjAxNCBhIGNvbmN1cnJlbnRcbiAgICAgIC8vIGRldmljZSdzIGNoYW5nZSBjYW4gaW50ZXJsZWF2ZSBhbmQgcmlkZSB0aGUgcG9zdC1jeWNsZSBkaXNwYXRjaFxuICAgICAgLy8gcXVldWUpLCB3aGljaCBpcyB3aGF0IG1ha2VzIHRoZSBuZXh0IGRlbHRhIG1hbmlmZXN0IHNhZmUuXG4gICAgICBpZiAodGhpcy5tYW5pZmVzdEN1cnNvck9mQ3ljbGUgIT09IG51bGwgJiYgdGhpcy5tYW5pZmVzdEN1cnNvck9mQ3ljbGUgPiAodGhpcy5zeW5jZWRUaHJvdWdoID8/IDApKSB7XG4gICAgICAgIHRoaXMuc3luY2VkVGhyb3VnaCA9IHRoaXMubWFuaWZlc3RDdXJzb3JPZkN5Y2xlO1xuICAgICAgfVxuICAgICAgdGhpcy5tYW5pZmVzdEN1cnNvck9mQ3ljbGUgPSBudWxsO1xuICAgICAgdGhpcy5uZWVkc0Z1bGxNYW5pZmVzdCA9IGZhbHNlO1xuXG4gICAgICB0aGlzLmxhc3RTeW5jQXQgPSB0aGlzLm5vdygpO1xuICAgICAgdGhpcy5wZW5kaW5nID0gMDtcbiAgICAgIGlmICghdGhpcy5pc0Rpc2Nvbm5lY3RlZCgpKSB0aGlzLnN0YXRlID0gJ2xpdmUnO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLm1hbmlmZXN0Q3Vyc29yT2ZDeWNsZSA9IG51bGw7XG4gICAgICB0aGlzLmxvZy5lcnJvcignc3luYyBjeWNsZSBmYWlsZWQnLCBlcnJvcik7XG4gICAgICBpZiAoIXRoaXMuaXNEaXNjb25uZWN0ZWQoKSkgdGhpcy5zdGF0ZSA9IHRoaXMudHJhbnNwb3J0ICE9PSBudWxsID8gJ2xpdmUnIDogJ2lkbGUnO1xuICAgICAgdGhyb3cgZXJyb3I7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMucHJvZ3Jlc3MgPSBudWxsO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBUaGUgbWFuaWZlc3QncyBmZXRjaC10aW1lIGN1cnNvciBmb3IgdGhlIFJVTk5JTkcgY3ljbGUgXHUyMDE0IHRoZSBjb21wbGV0aW9uXG4gICAqIHdhdGVybWFyayBhIHN1Y2Nlc3NmdWwgY3ljbGUgcmVjb3JkcyBpbnRvIGBzeW5jZWRUaHJvdWdoYCAoc2VlIHRoZVxuICAgKiBjb21tZW50IHRoZXJlKS4gTnVsbCBvdXRzaWRlIGN5Y2xlcy5cbiAgICovXG4gIHByaXZhdGUgbWFuaWZlc3RDdXJzb3JPZkN5Y2xlOiBudW1iZXIgfCBudWxsID0gbnVsbDtcblxuICAvKipcbiAgICogV2hldGhlciBUSElTIGN5Y2xlIG1heSByZXF1ZXN0IGEgZGVsdGEgbWFuaWZlc3QuIEFsbCBmb3VyIGdhdGVzIG11c3RcbiAgICogaG9sZCAoYW55IGZhaWx1cmUgXHUyMUQyIGZ1bGwgbWFuaWZlc3QsIHRvZGF5J3MgYmVoYXZpb3IpOlxuICAgKlxuICAgKiAgMS4gYGN1cnNvciA+IDBgIFx1MjAxNCBhIGZpcnN0LWV2ZXIgY29ubmVjdCBrbm93cyBub3RoaW5nOyBmdWxsIG1hbmlmZXN0LlxuICAgKiAgMi4gYHN5bmNlZFRocm91Z2ggIT09IG51bGxgIFx1MjAxNCBzb21lIGZ1bGwtbWFuaWZlc3QgY3ljbGUgY29tcGxldGVkLCBzbyB0aGVcbiAgICogICAgIGluZGV4IGlzIENPTVBMRVRFIHRocm91Z2ggaXQ7IGhlYWRzIGFmdGVyIGl0IGFycml2ZSB2aWEgcmVwbGF5ICtcbiAgICogICAgIGRlbHRhLiBBbiBpbnRlcnJ1cHRlZCBpbml0aWFsIHN5bmMgbmV2ZXIgc2V0cyBpdCBcdTIxRDIgZnVsbCBtYW5pZmVzdC5cbiAgICogIDMuIGAhbmVlZHNGdWxsTWFuaWZlc3RgIFx1MjAxNCBubyBkZWZlcnJlZCBkaXZlcmdlbmNlIGF3YWl0cyBwbGFuIHJlc29sdXRpb24uXG4gICAqICA0LiBSZXBsYXkgd2luZG93IGludGFjdCBcdTIwMTQgaGVsbG9BY2sgcmVwb3J0ZWQgYG9sZGVzdFJldGFpbmVkU2VxIDw9XG4gICAqICAgICBjdXJzb3IgKyAxYCwgc28gZXZlcnkgZXZlbnQgYWZ0ZXIgb3VyIGN1cnNvciBpcyBzdGlsbCBvbiB0aGUgc2VydmVyLlxuICAgKi9cbiAgcHJpdmF0ZSBzaG91bGRSZXF1ZXN0RGVsdGFNYW5pZmVzdCgpOiBib29sZWFuIHtcbiAgICByZXR1cm4gKFxuICAgICAgdGhpcy5jdXJzb3IgPiAwICYmXG4gICAgICB0aGlzLnN5bmNlZFRocm91Z2ggIT09IG51bGwgJiZcbiAgICAgICF0aGlzLm5lZWRzRnVsbE1hbmlmZXN0ICYmXG4gICAgICB0aGlzLnNlcnZlck9sZGVzdFJldGFpbmVkU2VxICE9PSBudWxsICYmXG4gICAgICB0aGlzLnNlcnZlck9sZGVzdFJldGFpbmVkU2VxIDw9IHRoaXMuY3Vyc29yICsgMVxuICAgICk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGZldGNoTWFuaWZlc3QoKTogUHJvbWlzZTxSZW1vdGVGaWxlW10+IHtcbiAgICBjb25zdCB0cmFuc3BvcnQgPSB0aGlzLnRyYW5zcG9ydDtcbiAgICBpZiAodHJhbnNwb3J0ID09PSBudWxsKSB0aHJvdyBuZXcgTmV0d29ya0Vycm9yKCdub3QgY29ubmVjdGVkJyk7XG4gICAgY29uc3QgdXNlRGVsdGEgPSB0aGlzLnNob3VsZFJlcXVlc3REZWx0YU1hbmlmZXN0KCk7XG4gICAgY29uc3Qgc2luY2UgPSB1c2VEZWx0YSAmJiB0aGlzLnN5bmNlZFRocm91Z2ggIT09IG51bGwgPyB0aGlzLnN5bmNlZFRocm91Z2ggOiB1bmRlZmluZWQ7XG4gICAgY29uc3QgcmVwbHkgPSBhd2FpdCB0aGlzLnJlcXVlc3Q8TWFuaWZlc3RNZXNzYWdlIHwgU2VydmVyRXJyb3JNZXNzYWdlPihcbiAgICAgIChtKSA9PiBtLnR5cGUgPT09ICdtYW5pZmVzdCcgfHwgbS50eXBlID09PSAnZXJyb3InLFxuICAgICAgKCkgPT4gdHJhbnNwb3J0LnNlbmQoeyB0eXBlOiAnZ2V0TWFuaWZlc3QnLCAuLi4oc2luY2UgIT09IHVuZGVmaW5lZCA/IHsgc2luY2UgfSA6IHt9KSB9KSxcbiAgICApO1xuICAgIGlmIChyZXBseS50eXBlID09PSAnZXJyb3InKSB0aHJvdyB0aGlzLnRvRXJyb3IocmVwbHkpO1xuICAgIGlmIChyZXBseS5jdXJzb3IgPiB0aGlzLmN1cnNvcikgdGhpcy5jdXJzb3IgPSByZXBseS5jdXJzb3I7XG4gICAgdGhpcy5tYW5pZmVzdEN1cnNvck9mQ3ljbGUgPSByZXBseS5jdXJzb3I7XG4gICAgaWYgKCF1c2VEZWx0YSkge1xuICAgICAgcmV0dXJuIE9iamVjdC52YWx1ZXMocmVwbHkuZW50cmllcykubWFwKChlbnRyeSkgPT4gKHsgLi4uZW50cnkgfSkpO1xuICAgIH1cbiAgICAvLyBEZWx0YTogbWVyZ2UgdGhlIGNoYW5nZWQgaGVhZHMgb3ZlciBhbiBJTkRFWCBQUk9KRUNUSU9OIG9mIHRoZSBmdWxsXG4gICAgLy8gbWFuaWZlc3QuIGNvbXB1dGVTeW5jUGxhbiBuZWVkcyB0aGUgY29tcGxldGUgcmVtb3RlIHZpZXcgXHUyMDE0IFBoYXNlIEJcbiAgICAvLyB0cmVhdHMgYW4gaW5kZXggcGF0aCBhYnNlbnQgZnJvbSB0aGUgbWFuaWZlc3QgYXMgXCJtaWdyYXRlZCBhd2F5XCIgXHUyMDE0IGFuZFxuICAgIC8vIGVsaWdpYmlsaXR5IGd1YXJhbnRlZXMgdGhlIGluZGV4IGFscmVhZHkgYWdyZWVzIHdpdGggdGhlIHNlcnZlciBmb3JcbiAgICAvLyBldmVyeSBwYXRoIHRoZSBkZWx0YSBvbWl0cyAoaGVhZHMgXHUyMjY0IHN5bmNlZFRocm91Z2gpLiBQcm9qZWN0aW5nIGVudHJpZXNcbiAgICAvLyB0byB0aGVpciBpbmRleCBzdGF0ZSB0aGVyZWZvcmUgcmVjb25zdHJ1Y3RzIGV4YWN0bHkgd2hhdCB0aGUgZnVsbFxuICAgIC8vIG1hbmlmZXN0IHdvdWxkIGhhdmUgc2FpZCwgYXQgTyhjaGFuZ2VzKSBpbnN0ZWFkIG9mIE8odmF1bHQpLlxuICAgIGNvbnN0IG1lcmdlZCA9IG5ldyBNYXA8c3RyaW5nLCBSZW1vdGVGaWxlPigpO1xuICAgIGZvciAoY29uc3QgW3BhdGgsIGVudHJ5XSBvZiBPYmplY3QuZW50cmllcyh0aGlzLmluZGV4KSkge1xuICAgICAgbWVyZ2VkLnNldChwYXRoLCB7XG4gICAgICAgIHBhdGgsXG4gICAgICAgIHZlcnNpb246IGVudHJ5LnZlcnNpb25JZCxcbiAgICAgICAgaGFzaDogZW50cnkuaGFzaCxcbiAgICAgICAgc2l6ZTogZW50cnkuc2l6ZSxcbiAgICAgICAgZGVsZXRlZDogZW50cnkuZGVsZXRlZEF0ICE9PSB1bmRlZmluZWQsXG4gICAgICAgIGNsb2NrOiBlbnRyeS5jbG9jayxcbiAgICAgICAgLi4uKGVudHJ5LmlzRm9sZGVyID8geyBpc0ZvbGRlcjogdHJ1ZSB9IDoge30pLFxuICAgICAgICBtdGltZTogZW50cnkubXRpbWUgPz8gMCxcbiAgICAgIH0pO1xuICAgIH1cbiAgICBmb3IgKGNvbnN0IFtwYXRoLCBlbnRyeV0gb2YgT2JqZWN0LmVudHJpZXMocmVwbHkuZW50cmllcykpIHtcbiAgICAgIG1lcmdlZC5zZXQocGF0aCwgeyAuLi5lbnRyeSB9KTtcbiAgICB9XG4gICAgcmV0dXJuIFsuLi5tZXJnZWQudmFsdWVzKCldO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBzdGFnZVB1c2hlcyhcbiAgICBwbGFuOiBTeW5jUGxhbixcbiAgICBoYXNoZWQ6IHJlYWRvbmx5IEhhc2hlZEZpbGVbXSxcbiAgKTogUHJvbWlzZTxTdGFnZWRDb21taXRbXT4ge1xuICAgIC8vIEEgY29uZmxpY3QtY29weSBwdXNoIGNhcnJpZXMgY29udGVudCByZWFkIGZyb20gdGhlICpvcmlnaW5hbCogcGF0aC5cbiAgICBjb25zdCBjb3B5U291cmNlcyA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KCk7XG4gICAgZm9yIChjb25zdCBjb25mbGljdCBvZiBwbGFuLmNvbmZsaWN0cykge1xuICAgICAgaWYgKGNvbmZsaWN0LmNvbmZsaWN0Q29weVBhdGggIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBjb3B5U291cmNlcy5zZXQoY29uZmxpY3QuY29uZmxpY3RDb3B5UGF0aCwgY29uZmxpY3QucGF0aCk7XG4gICAgICB9XG4gICAgfVxuICAgIC8vIEhhc2gtdGltZSBzdGF0cyBieSBwYXRoOiBwaW5uaW5nIHRoZXNlIG9udG8gdGhlIGFja2VkIGVudHJpZXMgKGJlbG93KVxuICAgIC8vIGtlZXBzIHRoZSBmYXN0LXBhdGggY2FjaGUgaG9uZXN0IFx1MjAxNCBzZWUgYFN0YWdlZENvbW1pdC5tdGltZWAuXG4gICAgY29uc3QgaGFzaFRpbWVNdGltZSA9IG5ldyBNYXAoaGFzaGVkLm1hcCgob2JzZXJ2ZWQpID0+IFtvYnNlcnZlZC5wYXRoLCBvYnNlcnZlZC5tdGltZV0pKTtcblxuICAgIGNvbnN0IHN0YWdlZDogU3RhZ2VkQ29tbWl0W10gPSBbXTtcbiAgICBmb3IgKGNvbnN0IHB1c2ggb2YgcGxhbi5wdXNoZXMpIHtcbiAgICAgIGlmIChwdXNoLmtpbmQgPT09ICdkZWxldGUnIHx8IHB1c2gua2luZCA9PT0gJ3JlbmFtZScpIHtcbiAgICAgICAgc3RhZ2VkLnB1c2godGhpcy50b1N0YWdlZChwdXNoKSk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3Qgc291cmNlUGF0aCA9XG4gICAgICAgIHB1c2gua2luZCA9PT0gJ2NvbmZsaWN0Q29weScgPyBjb3B5U291cmNlcy5nZXQocHVzaC5wYXRoKSA/PyBwdXNoLnBhdGggOiBwdXNoLnBhdGg7XG4gICAgICBjb25zdCBieXRlcyA9IGF3YWl0IHRoaXMucmVhZExvY2FsKHNvdXJjZVBhdGgpO1xuICAgICAgaWYgKGJ5dGVzID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgdGhpcy5sb2cud2FybigncHVzaCBzb3VyY2UgdmFuaXNoZWQgc2luY2Ugc2NhbjsgZGVmZXJyaW5nJywgcHVzaC5wYXRoKTtcbiAgICAgICAgdGhpcy5zY2hlZHVsZVJlY29uY2lsZSgpO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGhhc2ggPSBhd2FpdCBzaGEyNTZIZXgoYnl0ZXMpO1xuICAgICAgaWYgKGhhc2ggIT09IHB1c2guaGFzaCB8fCBieXRlcy5ieXRlTGVuZ3RoICE9PSBwdXNoLnNpemUpIHtcbiAgICAgICAgdGhpcy5sb2cud2FybignbG9jYWwgY29udGVudCBkcmlmdGVkIHNpbmNlIHNjYW47IGRlZmVycmluZyBwdXNoJywgcHVzaC5wYXRoKTtcbiAgICAgICAgdGhpcy5zY2hlZHVsZVJlY29uY2lsZSgpO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChwdXNoLmtpbmQgPT09ICdjb25mbGljdENvcHknKSB7XG4gICAgICAgIC8vIE1hdGVyaWFsaXplIHRoZSBjb3B5IGxvY2FsbHkgTk9XLCBiZWZvcmUgdGhlIHB1bGxzIG92ZXJ3cml0ZSB0aGVcbiAgICAgICAgLy8gb3JpZ2luYWw6IHRoZSBzZXJ2ZXIgYnJvYWRjYXN0cyB0aGUgY29weSB0byAqb3RoZXIqIGNsaWVudHMgb25seSxcbiAgICAgICAgLy8gc28gdGhpcyBkZXZpY2UgbXVzdCB3cml0ZSBpdHMgb3duIGNvcHkgaXRzZWxmLiBUaGUgY29weSBsYW5kcyBhdCBhXG4gICAgICAgIC8vIE5FVyBwYXRoIHdob3NlIG9uLWRpc2sgc3RhdCBkaWZmZXJzIGZyb20gdGhlIHNvdXJjZSdzIFx1MjAxNCBubyBoYXNoLXRpbWVcbiAgICAgICAgLy8gc3RhdCB0byBwaW4sIHRoZSBuZXh0IHNjYW4gcmVjb3JkcyBvbmUuXG4gICAgICAgIGF3YWl0IHRoaXMub3B0aW9ucy5zdG9yYWdlLndyaXRlRmlsZShwdXNoLnBhdGgsIGJ5dGVzKTtcbiAgICAgICAgc3RhZ2VkLnB1c2goeyAuLi50aGlzLnRvU3RhZ2VkKHB1c2gpLCBieXRlcyB9KTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBzdGFnZWQucHVzaCh7XG4gICAgICAgIC4uLnRoaXMudG9TdGFnZWQocHVzaCksXG4gICAgICAgIGJ5dGVzLFxuICAgICAgICAuLi4oaGFzaFRpbWVNdGltZS5nZXQoc291cmNlUGF0aCkgIT09IHVuZGVmaW5lZFxuICAgICAgICAgID8geyBtdGltZTogaGFzaFRpbWVNdGltZS5nZXQoc291cmNlUGF0aCkgfVxuICAgICAgICAgIDoge30pLFxuICAgICAgfSk7XG4gICAgfVxuICAgIHJldHVybiBzdGFnZWQ7XG4gIH1cblxuICBwcml2YXRlIHRvU3RhZ2VkKHB1c2g6IFB1c2hPcCk6IFN0YWdlZENvbW1pdCB7XG4gICAgaWYgKHB1c2gua2luZCA9PT0gJ3JlbmFtZScpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGtpbmQ6ICdyZW5hbWUnLFxuICAgICAgICBwYXRoOiBwdXNoLnRvUGF0aCxcbiAgICAgICAgcGFyZW50VmVyc2lvbjogcHVzaC5wYXJlbnRWZXJzaW9uLFxuICAgICAgICBoYXNoOiBwdXNoLmhhc2gsXG4gICAgICAgIHNpemU6IHB1c2guc2l6ZSxcbiAgICAgICAgZnJvbVBhdGg6IHB1c2guZnJvbVBhdGgsXG4gICAgICB9O1xuICAgIH1cbiAgICByZXR1cm4ge1xuICAgICAga2luZDogcHVzaC5raW5kID09PSAnYWRkJyA/ICdlZGl0JyA6IHB1c2gua2luZCxcbiAgICAgIHBhdGg6IHB1c2gucGF0aCxcbiAgICAgIHBhcmVudFZlcnNpb246IHB1c2gucGFyZW50VmVyc2lvbixcbiAgICAgIGhhc2g6IHB1c2guaGFzaCxcbiAgICAgIHNpemU6IHB1c2guc2l6ZSxcbiAgICAgIC4uLihwdXNoLmlzRm9sZGVyID8geyBpc0ZvbGRlcjogdHJ1ZSB9IDoge30pLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlYWRMb2NhbChwYXRoOiBzdHJpbmcpOiBQcm9taXNlPFVpbnQ4QXJyYXkgfCB1bmRlZmluZWQ+IHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMub3B0aW9ucy5zdG9yYWdlLnJlYWRGaWxlKHBhdGgpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU2VuZCBgY29tbWl0c2AgdGhyb3VnaCBhIGJvdW5kZWQtY29uY3VycmVuY3kgcGlwZWxpbmU6IHVwIHRvXG4gICAqIGBwdXNoQ29uY3VycmVuY3lgIGNvbW1pdHMgaW4gZmxpZ2h0IChzZW50LCBhd2FpdGluZyB0aGVpciBzZXJ2ZXIgcmVwbHkpXG4gICAqIGF0IG9uY2U7IGVhY2ggc2xvdCBzZW5kcyBpdHMgbmV4dCBjb21taXQgYXMgc29vbiBhcyBhbiBlYXJsaWVyIG9uZSBpc1xuICAgKiBzZXR0bGVkLlxuICAgKlxuICAgKiBXSFkgUElQRUxJTklORyBJUyBTQUZFICh2cy4gYSBiYXRjaCBtZXNzYWdlKTogY29uZmxpY3QgYXJiaXRyYXRpb24gaXNcbiAgICogU0VSVkVSLXNpZGUgYW5kIFBFUiBQQVRIIChgYXJiaXRyYXRlQ29tbWl0YCByZWFkcyBhbmQgd3JpdGVzIGV4YWN0bHkgdGhlXG4gICAqIGNvbW1pdHRlZCBwYXRoJ3MgaGVhZCksIGFuZCBhIGN5Y2xlIHN0YWdlcyBhdCBtb3N0IE9ORSBjb21taXQgcGVyIHBhdGhcbiAgICogKHRoZSBzY2FuIGJ1Y2tldHMgYnkgcGF0aDsgcmVuYW1lcyBjb25zdW1lIGJvdGggZW5kcykuIFNvIHR3byBpbi1mbGlnaHRcbiAgICogY29tbWl0cyBjYW4gbmV2ZXIgaW50ZXJhY3Qgb24gdGhlIHNlcnZlciwgYW5kIHJlcGx5IE9SREVSIGFjcm9zc1xuICAgKiBkaWZmZXJlbnQgcGF0aHMgZG9lcyBub3QgbWF0dGVyIGZvciB0aGUgcmVzdWx0aW5nIHN0YXRlIFx1MjAxNCBvbmx5IHBlci1wYXRoXG4gICAqIHBhaXJpbmcgb2YgcmVwbHlcdTIxOTJjb21taXQgbWF0dGVycywgd2hpY2ggdGhlIG9yZGVyZWQgV2ViU29ja2V0IHBsdXMgdGhlXG4gICAqIHNlcnZlcidzIHNlcmlhbGl6ZWQgYXJiaXRyYXRpb24gZ3VhcmFudGVlIChyZXBsaWVzIGFycml2ZSBpbiBzZW5kIG9yZGVyLFxuICAgKiBtYXRjaGVkIEZJRk8gYnkgYG9uVHJhbnNwb3J0TWVzc2FnZWApLiBBIGJhdGNoIHByb3RvY29sIG1lc3NhZ2Ugd291bGRcbiAgICogYWRkaXRpb25hbGx5IGNvdXBsZSBibG9iLXVwbG9hZCB0aW1pbmcgYW5kIGVycm9yIGdyYW51bGFyaXR5IGZvciBub1xuICAgKiBjb3JyZWN0bmVzcyBnYWluLCBzbyBwcm90b2NvbCB2MSBzdGF5cyB1bmNoYW5nZWQuXG4gICAqXG4gICAqIE9uIHRoZSBmaXJzdCBmYWlsdXJlLCBpbi1mbGlnaHQgY29tbWl0cyBzdGlsbCBzZXR0bGUgKHRoZWlyIGFja3MgYXJlXG4gICAqIGFwcGxpZWQgXHUyMDE0IHRoZXkgYXJlIHJlYWwgaGVhZHMpIGJ1dCBubyBORVcgY29tbWl0IHN0YXJ0czsgdGhlIGVycm9yIGlzXG4gICAqIHJldGhyb3duIGFmdGVyIGFsbCBzbG90cyBkcmFpbiBzbyB0aGUgY3ljbGUgZmFpbHMgZXhhY3RseSBsaWtlIHRoZSBvbGRcbiAgICogc2VxdWVudGlhbCBsb29wIGRpZCAodW5zZW50IHB1c2hlcyBzaW1wbHkgcmV0cnkgbmV4dCBjeWNsZSkuXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIHJ1blB1c2hQaXBlbGluZShcbiAgICBjb21taXRzOiByZWFkb25seSBTdGFnZWRDb21taXRbXSxcbiAgICBvblNldHRsZWQ6ICgpID0+IHZvaWQsXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmIChjb21taXRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuICAgIGxldCBuZXh0ID0gMDtcbiAgICBsZXQgZmFpbHVyZTogRXJyb3IgfCBudWxsID0gbnVsbDtcbiAgICBjb25zdCBzbG90cyA9IE1hdGgubWluKHRoaXMucHVzaENvbmN1cnJlbmN5LCBjb21taXRzLmxlbmd0aCk7XG4gICAgY29uc3Qgd29ya2VyID0gYXN5bmMgKCk6IFByb21pc2U8dm9pZD4gPT4ge1xuICAgICAgd2hpbGUgKG5leHQgPCBjb21taXRzLmxlbmd0aCkge1xuICAgICAgICBpZiAoZmFpbHVyZSAhPT0gbnVsbCkgcmV0dXJuO1xuICAgICAgICBjb25zdCBjb21taXQgPSBjb21taXRzW25leHQrK10hO1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IHRoaXMuc2VuZENvbW1pdChjb21taXQpO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIGZhaWx1cmUgPz89IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgb25TZXR0bGVkKCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9O1xuICAgIGF3YWl0IFByb21pc2UuYWxsKEFycmF5LmZyb20oeyBsZW5ndGg6IHNsb3RzIH0sIHdvcmtlcikpO1xuICAgIGlmIChmYWlsdXJlICE9PSBudWxsKSB0aHJvdyBmYWlsdXJlO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBzZW5kQ29tbWl0KGNvbW1pdDogU3RhZ2VkQ29tbWl0KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgdHJhbnNwb3J0ID0gdGhpcy50cmFuc3BvcnQ7XG4gICAgaWYgKHRyYW5zcG9ydCA9PT0gbnVsbCkgdGhyb3cgbmV3IE5ldHdvcmtFcnJvcignbm90IGNvbm5lY3RlZCcpO1xuXG4gICAgY29uc3QgbWVzc2FnZTogQ29tbWl0TWVzc2FnZSA9IHtcbiAgICAgIHR5cGU6ICdjb21taXQnLFxuICAgICAgcGF0aDogY29tbWl0LnBhdGgsXG4gICAgICBwYXJlbnRWZXJzaW9uOiBjb21taXQucGFyZW50VmVyc2lvbixcbiAgICAgIGhhc2g6IGNvbW1pdC5oYXNoLFxuICAgICAgc2l6ZTogY29tbWl0LnNpemUsXG4gICAgICBraW5kOiBjb21taXQua2luZCxcbiAgICAgIC4uLihjb21taXQuZnJvbVBhdGggIT09IHVuZGVmaW5lZCA/IHsgZnJvbVBhdGg6IGNvbW1pdC5mcm9tUGF0aCB9IDoge30pLFxuICAgICAgLi4uKGNvbW1pdC5pc0ZvbGRlciA9PT0gdHJ1ZSA/IHsgaXNGb2xkZXI6IHRydWUgfSA6IHt9KSxcbiAgICAgIC4uLihjb21taXQuYnl0ZXMgIT09IHVuZGVmaW5lZCAmJiBjb21taXQuYnl0ZXMuYnl0ZUxlbmd0aCA8PSBJTkxJTkVfQ09OVEVOVF9NQVhfQllURVNcbiAgICAgICAgPyB7IGlubGluZTogYnl0ZXNUb0Jhc2U2NChjb21taXQuYnl0ZXMpIH1cbiAgICAgICAgOiB7fSksXG4gICAgfTtcblxuICAgIC8vIEF0dGFjaG1lbnRzIGFib3ZlIHRoZSBpbmxpbmUgY2FwIHJpZGUgdGhlIGJsb2Igc3RvcmUgKEZSLTgpLiBJbnNpZGUgYVxuICAgIC8vIHBpcGVsaW5lIHNsb3QgdGhpcyBhd2FpdCBvdmVybGFwcyB3aXRoIHRoZSBPVEhFUiBzbG90cycgaW4tZmxpZ2h0XG4gICAgLy8gY29tbWl0cyBcdTIwMTQgdGhlIHVwbG9hZCBubyBsb25nZXIgc2VyaWFsaXplcyBhaGVhZCBvZiBldmVyeSBjb21taXQgXHUyMDE0IGFuZFxuICAgIC8vIHN0aWxsIGNvbXBsZXRlcyBiZWZvcmUgSVRTIGNvbW1pdCBpcyBzZW50ICh0aGUgc2VydmVyIHJlamVjdHMgYSBjb21taXRcbiAgICAvLyB3aG9zZSBibG9iIGhhcyBub3QgYXJyaXZlZCkuXG4gICAgaWYgKGNvbW1pdC5ieXRlcyAhPT0gdW5kZWZpbmVkICYmIGNvbW1pdC5ieXRlcy5ieXRlTGVuZ3RoID4gSU5MSU5FX0NPTlRFTlRfTUFYX0JZVEVTKSB7XG4gICAgICBhd2FpdCB0aGlzLnVwbG9hZEJsb2IoY29tbWl0Lmhhc2gsIGNvbW1pdC5ieXRlcyk7XG4gICAgfVxuXG4gICAgY29uc3QgcmVwbHkgPSBhd2FpdCB0aGlzLnJlcXVlc3Q8Q29tbWl0QWNrTWVzc2FnZSB8IENvbmZsaWN0TWVzc2FnZSB8IFNlcnZlckVycm9yTWVzc2FnZT4oXG4gICAgICAobSkgPT4gbS50eXBlID09PSAnY29tbWl0QWNrJyB8fCBtLnR5cGUgPT09ICdjb25mbGljdCcgfHwgbS50eXBlID09PSAnZXJyb3InLFxuICAgICAgKCkgPT4gdHJhbnNwb3J0LnNlbmQobWVzc2FnZSksXG4gICAgKTtcbiAgICBpZiAocmVwbHkudHlwZSA9PT0gJ2Vycm9yJykgdGhyb3cgdGhpcy50b0Vycm9yKHJlcGx5KTtcblxuICAgIC8vIEZvbGQgdGhlIHJlcGx5IGludG8gc2hhcmVkIHN0YXRlIGJlaGluZCB0aGUgYWNrIGNoYWluOiBjb25jdXJyZW50XG4gICAgLy8gc2xvdHMgbXVzdCBub3QgcmVhZC1tb2RpZnktd3JpdGUgYHRoaXMuaW5kZXhgIGF0IHRoZSBzYW1lIHRpbWUuXG4gICAgYXdhaXQgdGhpcy5zZXJpYWxpemVBY2tBcHBsaWNhdGlvbihhc3luYyAoKSA9PiB7XG4gICAgICBpZiAocmVwbHkudHlwZSA9PT0gJ2NvbW1pdEFjaycpIHtcbiAgICAgICAgaWYgKHJlcGx5LnNlcSA+IHRoaXMuY3Vyc29yKSB0aGlzLmN1cnNvciA9IHJlcGx5LnNlcTtcbiAgICAgICAgdGhpcy5hcHBseUFja1RvSW5kZXgoY29tbWl0LCByZXBseS52ZXJzaW9uLCByZXBseS5jbG9jayk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGF3YWl0IHRoaXMuaGFuZGxlQ29uZmxpY3RSZXBseShjb21taXQsIHJlcGx5KTtcbiAgICB9KTtcbiAgfVxuXG4gIC8qKiBDaGFpbiBvbmUgcmVwbHkncyBpbmRleCBhcHBsaWNhdGlvbiBhZnRlciBldmVyeSBwcmV2aW91c2x5LXN0YXJ0ZWQgb25lLiAqL1xuICBwcml2YXRlIHNlcmlhbGl6ZUFja0FwcGxpY2F0aW9uKGFwcGx5OiAoKSA9PiBQcm9taXNlPHZvaWQ+KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgcnVuID0gdGhpcy5hY2tDaGFpbi50aGVuKGFwcGx5LCBhcHBseSk7XG4gICAgdGhpcy5hY2tDaGFpbiA9IHJ1bi50aGVuKFxuICAgICAgKCkgPT4ge30sXG4gICAgICAoKSA9PiB7fSxcbiAgICApO1xuICAgIHJldHVybiBydW47XG4gIH1cblxuICBwcml2YXRlIGFwcGx5QWNrVG9JbmRleChjb21taXQ6IFN0YWdlZENvbW1pdCwgdmVyc2lvbklkOiBzdHJpbmcsIGNsb2NrOiBMb2dpY2FsQ2xvY2spOiB2b2lkIHtcbiAgICBjb25zdCBkZWxldGVkID0gY29tbWl0LmtpbmQgPT09ICdkZWxldGUnO1xuICAgIGlmIChjb21taXQua2luZCA9PT0gJ3JlbmFtZScgJiYgY29tbWl0LmZyb21QYXRoICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMuaW5kZXggPSBhcHBseUNvbW1pdChyZW1vdmVFbnRyeSh0aGlzLmluZGV4LCBjb21taXQuZnJvbVBhdGgpLCB7XG4gICAgICAgIHBhdGg6IGNvbW1pdC5wYXRoLFxuICAgICAgICB2ZXJzaW9uSWQsXG4gICAgICAgIGhhc2g6IGNvbW1pdC5oYXNoLFxuICAgICAgICBzaXplOiBjb21taXQuc2l6ZSxcbiAgICAgICAgY2xvY2ssXG4gICAgICB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgLy8gYGNvbW1pdC5tdGltZWAgaXMgdGhlIHN0YXQgb2JzZXJ2ZWQgYXQgSEFTSCB0aW1lIGZvciB0aGlzIGV4YWN0IGNvbnRlbnRcbiAgICAvLyAodGhyZWFkZWQgdGhyb3VnaCBgc3RhZ2VQdXNoZXNgKSwgbmV2ZXIgYSBzdGF0IHRha2VuIGF0IGFjayB0aW1lIFx1MjAxNCBhblxuICAgIC8vIGVkaXQgdGhhdCBsYW5kZWQgYmV0d2VlbiBoYXNoaW5nIGFuZCB0aGlzIGFjayBjaGFuZ2VkIHRoZSBkaXNrIHN0YXQsIHNvXG4gICAgLy8gdGhlIG5leHQgc2NhbiBtaXNzZXMgdGhlIGZhc3QgcGF0aCBhbmQgcmUtaGFzaGVzL3B1c2hlcyB0aGUgZWRpdC5cbiAgICB0aGlzLmluZGV4ID0gYXBwbHlDb21taXQodGhpcy5pbmRleCwge1xuICAgICAgcGF0aDogY29tbWl0LnBhdGgsXG4gICAgICB2ZXJzaW9uSWQsXG4gICAgICBoYXNoOiBjb21taXQuaGFzaCxcbiAgICAgIHNpemU6IGNvbW1pdC5zaXplLFxuICAgICAgY2xvY2ssXG4gICAgICBkZWxldGVkLFxuICAgICAgZGVsZXRlZEF0OiBkZWxldGVkID8gdGhpcy5ub3coKSA6IHVuZGVmaW5lZCxcbiAgICAgIC4uLihjb21taXQuaXNGb2xkZXIgPT09IHRydWUgPyB7IGlzRm9sZGVyOiB0cnVlIH0gOiB7fSksXG4gICAgICAuLi4oY29tbWl0Lm10aW1lICE9PSB1bmRlZmluZWQgPyB7IG10aW1lOiBjb21taXQubXRpbWUgfSA6IHt9KSxcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgaGFuZGxlQ29uZmxpY3RSZXBseShcbiAgICBjb21taXQ6IFN0YWdlZENvbW1pdCxcbiAgICByZXBseTogQ29uZmxpY3RNZXNzYWdlLFxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAocmVwbHkuc2VxICE9PSB1bmRlZmluZWQgJiYgcmVwbHkuc2VxID4gdGhpcy5jdXJzb3IpIHRoaXMuY3Vyc29yID0gcmVwbHkuc2VxO1xuICAgIGNvbnN0IHdlV29uID1cbiAgICAgIHJlcGx5Lndpbm5lci5kZXZpY2VJZCA9PT0gdGhpcy5vcHRpb25zLmRldmljZUlkICYmIHJlcGx5Lndpbm5lci5oYXNoID09PSBjb21taXQuaGFzaDtcbiAgICBpZiAod2VXb24pIHtcbiAgICAgIHRoaXMuYXBwbHlBY2tUb0luZGV4KGNvbW1pdCwgcmVwbHkud2lubmVyLmlkLCByZXBseS53aW5uZXIuY2xvY2spO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIFdlIGxvc3QgdGhlIHJhY2UuIE1hdGVyaWFsaXplIHRoZSB3aW5uZXIgZGlyZWN0bHkgXHUyMDE0IHRoZSBzZXJ2ZXIgaGFzXG4gICAgLy8gYWxyZWFkeSBwcmVzZXJ2ZWQgb3VyIGNvbnRlbnQgYXMgYSBjb25mbGljdCBjb3B5IChpZiBpdCB3YXMgZGlzdGluY3QpLlxuICAgIC8vIE9uZSBjYXZlYXQ6IGlmIHRoZSB3b3JraW5nIHRyZWUgbW92ZWQgb24gQUdBSU4gc2luY2Ugd2Ugc3RhZ2VkIHRoaXNcbiAgICAvLyBjb21taXQsIGRvIG5vdCBjbG9iYmVyIGl0IGVpdGhlciBcdTIwMTQgaGFuZCB0aGUgd2hvbGUgdGhpbmcgdG8gYSBjeWNsZS5cbiAgICBpZiAoY29tbWl0LmtpbmQgIT09ICdkZWxldGUnICYmIGNvbW1pdC5raW5kICE9PSAncmVuYW1lJyAmJiBjb21taXQuaXNGb2xkZXIgIT09IHRydWUpIHtcbiAgICAgIGNvbnN0IGxvY2FsID0gYXdhaXQgdGhpcy5yZWFkTG9jYWwoY29tbWl0LnBhdGgpO1xuICAgICAgaWYgKGxvY2FsICE9PSB1bmRlZmluZWQgJiYgKGF3YWl0IHNoYTI1NkhleChsb2NhbCkpICE9PSBjb21taXQuaGFzaCkge1xuICAgICAgICB0aGlzLnNjaGVkdWxlUmVjb25jaWxlKCk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoY29tbWl0LmtpbmQgPT09ICdyZW5hbWUnICYmIGNvbW1pdC5mcm9tUGF0aCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAvLyBPdXIgcmVuYW1lIGxvc3Q6IHRoZSBmaWxlIHN0YXlzIHdoZXJlIHRoZSB3aW5uZXIga2VlcHMgaXQ7IHJlY29yZFxuICAgICAgLy8gdGhlIHdpbm5lciBoZWFkIGZvciB0aGUgZGVzdGluYXRpb24gKHRoZSBzb3VyY2UgcGF0aCBpcyB1bnRvdWNoZWQpLlxuICAgICAgdGhpcy5pbmRleCA9IGFwcGx5Q29tbWl0KHRoaXMuaW5kZXgsIHtcbiAgICAgICAgcGF0aDogcmVwbHkud2lubmVyLnBhdGgsXG4gICAgICAgIHZlcnNpb25JZDogcmVwbHkud2lubmVyLmlkLFxuICAgICAgICBoYXNoOiByZXBseS53aW5uZXIuaGFzaCxcbiAgICAgICAgc2l6ZTogcmVwbHkud2lubmVyLnNpemUsXG4gICAgICAgIGNsb2NrOiByZXBseS53aW5uZXIuY2xvY2ssXG4gICAgICB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0aGlzLmluZGV4ID0gYXdhaXQgdGhpcy5hcHBseVB1bGxzKFt0aGlzLndpbm5lckFzUHVsbChyZXBseS53aW5uZXIpXSk7XG4gIH1cblxuICAvKiogVHVybiBhbiBhcmJpdHJhdGVkIHdpbm5lciB2ZXJzaW9uIGludG8gYSBwdWxsIG9wIChjb250ZW50IG9wcyBvbmx5KS4gKi9cbiAgcHJpdmF0ZSB3aW5uZXJBc1B1bGwod2lubmVyOiB7XG4gICAgcGF0aDogc3RyaW5nO1xuICAgIGlkOiBzdHJpbmc7XG4gICAgaGFzaDogc3RyaW5nO1xuICAgIHNpemU6IG51bWJlcjtcbiAgICBkZXZpY2VJZDogc3RyaW5nO1xuICAgIGNsb2NrOiBMb2dpY2FsQ2xvY2s7XG4gICAga2luZDogQ29tbWl0TWVzc2FnZVsna2luZCddO1xuICB9KTogUHVsbE9wIHtcbiAgICBjb25zdCBlbnRyeSA9IHRoaXMuaW5kZXhbd2lubmVyLnBhdGhdO1xuICAgIGNvbnN0IGRlbGV0ZWQgPSB3aW5uZXIua2luZCA9PT0gJ2RlbGV0ZSc7XG4gICAgY29uc3Qga2luZDogUHVsbEZpbGVPcFsna2luZCddID0gZGVsZXRlZFxuICAgICAgPyAnZGVsZXRlJ1xuICAgICAgOiBlbnRyeSA9PT0gdW5kZWZpbmVkXG4gICAgICAgID8gJ2FkZCdcbiAgICAgICAgOiBlbnRyeS5kZWxldGVkQXQgIT09IHVuZGVmaW5lZFxuICAgICAgICAgID8gJ3Jlc3RvcmUnXG4gICAgICAgICAgOiAnZWRpdCc7XG4gICAgcmV0dXJuIHtcbiAgICAgIGtpbmQsXG4gICAgICBwYXRoOiB3aW5uZXIucGF0aCxcbiAgICAgIGhhc2g6IHdpbm5lci5oYXNoLFxuICAgICAgc2l6ZTogd2lubmVyLnNpemUsXG4gICAgICB2ZXJzaW9uOiB3aW5uZXIuaWQsXG4gICAgICBjbG9jazogd2lubmVyLmNsb2NrLFxuICAgICAgZGVsZXRlZCxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyB1cGxvYWRCbG9iKGhhc2g6IHN0cmluZywgYnl0ZXM6IFVpbnQ4QXJyYXkpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCB0cmFuc3BvcnQgPSB0aGlzLnRyYW5zcG9ydDtcbiAgICBpZiAodHJhbnNwb3J0ID09PSBudWxsKSB0aHJvdyBuZXcgTmV0d29ya0Vycm9yKCdub3QgY29ubmVjdGVkJyk7XG4gICAgY29uc3QgcmVwbHkgPSBhd2FpdCB0aGlzLnJlcXVlc3Q8QmxvYkFja01lc3NhZ2UgfCBTZXJ2ZXJFcnJvck1lc3NhZ2U+KFxuICAgICAgKG0pID0+IG0udHlwZSA9PT0gJ2Jsb2JBY2snIHx8IG0udHlwZSA9PT0gJ2Vycm9yJyxcbiAgICAgICgpID0+IHRyYW5zcG9ydC5zZW5kKHsgdHlwZTogJ3B1dEJsb2InLCBoYXNoLCBjb250ZW50OiBieXRlc1RvQmFzZTY0KGJ5dGVzKSB9KSxcbiAgICApO1xuICAgIGlmIChyZXBseS50eXBlID09PSAnZXJyb3InKSB0aHJvdyB0aGlzLnRvRXJyb3IocmVwbHkpO1xuICAgIGF3YWl0IHRoaXMub3B0aW9ucy5ibG9iU3RvcmUucHV0KGhhc2gsIGJ5dGVzKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVhZG9ubHkgZmV0Y2hCbG9iOiBGZXRjaEJsb2IgPSBhc3luYyAoaGFzaDogc3RyaW5nKTogUHJvbWlzZTxVaW50OEFycmF5PiA9PiB7XG4gICAgaWYgKGhhc2ggPT09ICcnKSB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcigncmVmdXNpbmcgdG8gZmV0Y2ggY29udGVudCBmb3IgYW4gZW1wdHkgaGFzaCcpO1xuICAgIGNvbnN0IGNhY2hlZCA9IGF3YWl0IHRoaXMub3B0aW9ucy5ibG9iU3RvcmUuZ2V0KGhhc2gpO1xuICAgIGlmIChjYWNoZWQgIT09IHVuZGVmaW5lZCkgcmV0dXJuIGNhY2hlZDtcbiAgICBjb25zdCBieXRlcyA9IGF3YWl0IHRoaXMuZG93bmxvYWRCbG9iKGhhc2gpO1xuICAgIGF3YWl0IHRoaXMub3B0aW9ucy5ibG9iU3RvcmUucHV0KGhhc2gsIGJ5dGVzKTtcbiAgICByZXR1cm4gYnl0ZXM7XG4gIH07XG5cbiAgcHJpdmF0ZSBhc3luYyBkb3dubG9hZEJsb2IoaGFzaDogc3RyaW5nKTogUHJvbWlzZTxVaW50OEFycmF5PiB7XG4gICAgY29uc3QgdHJhbnNwb3J0ID0gdGhpcy50cmFuc3BvcnQ7XG4gICAgaWYgKHRyYW5zcG9ydCA9PT0gbnVsbCkgdGhyb3cgbmV3IE5ldHdvcmtFcnJvcignbm90IGNvbm5lY3RlZCcpO1xuICAgIGNvbnN0IHJlcGx5ID0gYXdhaXQgdGhpcy5yZXF1ZXN0PEJsb2JNZXNzYWdlIHwgU2VydmVyRXJyb3JNZXNzYWdlPihcbiAgICAgIChtKSA9PiAobS50eXBlID09PSAnYmxvYicgJiYgbS5oYXNoID09PSBoYXNoKSB8fCBtLnR5cGUgPT09ICdlcnJvcicsXG4gICAgICAoKSA9PiB0cmFuc3BvcnQuc2VuZCh7IHR5cGU6ICdnZXRCbG9iJywgaGFzaCB9KSxcbiAgICApO1xuICAgIGlmIChyZXBseS50eXBlID09PSAnZXJyb3InKSB0aHJvdyB0aGlzLnRvRXJyb3IocmVwbHkpO1xuICAgIGNvbnN0IGJ5dGVzID0gYmFzZTY0VG9CeXRlcyhyZXBseS5jb250ZW50KTtcbiAgICBpZiAoKGF3YWl0IHNoYTI1NkhleChieXRlcykpICE9PSBoYXNoKSB7XG4gICAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgYmxvYiAke2hhc2h9IGZhaWxlZCB2ZXJpZmljYXRpb24gb24gZG93bmxvYWRgKTtcbiAgICB9XG4gICAgcmV0dXJuIGJ5dGVzO1xuICB9XG5cbiAgLy8gLS0tIHBsdW1iaW5nIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICBwcml2YXRlIHJlcXVlc3Q8VCBleHRlbmRzIFNlcnZlck1lc3NhZ2U+KFxuICAgIG1hdGNoZXM6IChtZXNzYWdlOiBNZXNzYWdlKSA9PiBib29sZWFuLFxuICAgIHNlbmQ6ICgpID0+IHZvaWQsXG4gICk6IFByb21pc2U8VD4ge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZTxUPigocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBjb25zdCBleHBlY3RhdGlvbjogKHR5cGVvZiB0aGlzLmV4cGVjdGF0aW9ucylbbnVtYmVyXSA9IHtcbiAgICAgICAgbWF0Y2hlczogKG1lc3NhZ2UpID0+IG1hdGNoZXMobWVzc2FnZSksXG4gICAgICAgIHJlc29sdmU6IChtZXNzYWdlKSA9PiByZXNvbHZlKG1lc3NhZ2UgYXMgVCksXG4gICAgICAgIHJlamVjdCxcbiAgICAgIH07XG4gICAgICB0aGlzLmV4cGVjdGF0aW9ucy5wdXNoKGV4cGVjdGF0aW9uKTtcbiAgICAgIHRyeSB7XG4gICAgICAgIHNlbmQoKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnN0IGluZGV4ID0gdGhpcy5leHBlY3RhdGlvbnMuaW5kZXhPZihleHBlY3RhdGlvbik7XG4gICAgICAgIGlmIChpbmRleCA+PSAwKSB0aGlzLmV4cGVjdGF0aW9ucy5zcGxpY2UoaW5kZXgsIDEpO1xuICAgICAgICByZWplY3QoZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IE5ldHdvcmtFcnJvcihTdHJpbmcoZXJyb3IpKSk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIHRvRXJyb3IobWVzc2FnZTogU2VydmVyRXJyb3JNZXNzYWdlKTogRXJyb3Ige1xuICAgIHN3aXRjaCAobWVzc2FnZS5jb2RlKSB7XG4gICAgICBjYXNlICdVTkFVVEhPUklaRUQnOlxuICAgICAgICByZXR1cm4gbmV3IFVuYXV0aG9yaXplZEVycm9yKG1lc3NhZ2UubWVzc2FnZSk7XG4gICAgICBjYXNlICdSRVZPS0VEJzpcbiAgICAgICAgcmV0dXJuIG5ldyBSZXZva2VkRXJyb3IobWVzc2FnZS5tZXNzYWdlKTtcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHJldHVybiBuZXcgUHJvdG9jb2xFcnJvcihtZXNzYWdlLm1lc3NhZ2UpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgZW5xdWV1ZShvcGVyYXRpb246ICgpID0+IFByb21pc2U8dm9pZD4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLnF1ZXVlZE9wcyArPSAxO1xuICAgIGNvbnN0IHJ1biA9IHRoaXMudGFpbC50aGVuKG9wZXJhdGlvbiwgb3BlcmF0aW9uKTtcbiAgICBjb25zdCBzZXR0bGVkID0gcnVuLnRoZW4oXG4gICAgICAoKSA9PiB7XG4gICAgICAgIHRoaXMucXVldWVkT3BzIC09IDE7XG4gICAgICAgIHRoaXMucGVyc2lzdEluZGV4KCk7XG4gICAgICB9LFxuICAgICAgKGVycm9yOiB1bmtub3duKSA9PiB7XG4gICAgICAgIHRoaXMucXVldWVkT3BzIC09IDE7XG4gICAgICAgIHRoaXMucGVyc2lzdEluZGV4KCk7XG4gICAgICAgIHRocm93IGVycm9yO1xuICAgICAgfSxcbiAgICApO1xuICAgIC8vIFN3YWxsb3cgcmVqZWN0aW9ucyBvbiB0aGUgc2hhcmVkIHRhaWwgKGluZGl2aWR1YWwgY2FsbGVycyBzZWUgdGhlbSB2aWFcbiAgICAvLyBgc2V0dGxlZGApOyBvbmUgZmFpbGVkIG9wIG11c3Qgbm90IHBvaXNvbiB0aGUgcXVldWUuXG4gICAgdGhpcy50YWlsID0gc2V0dGxlZC50aGVuKFxuICAgICAgKCkgPT4ge30sXG4gICAgICAoKSA9PiB7fSxcbiAgICApO1xuICAgIHJldHVybiBzZXR0bGVkO1xuICB9XG5cbiAgcHJpdmF0ZSBwZXJzaXN0SW5kZXgoKTogdm9pZCB7XG4gICAgY29uc3Qgc25hcHNob3QgPSBzZXJpYWxpemVMb2NhbEluZGV4KHRoaXMuaW5kZXgsIHRoaXMucGVyc2lzdGVkU3RhdGUoKSk7XG4gICAgdm9pZCB0aGlzLm9wdGlvbnMuc3RvcmFnZVxuICAgICAgLndyaXRlRmlsZShMT0NBTF9JTkRFWF9TVEFURV9QQVRILCBuZXcgVGV4dEVuY29kZXIoKS5lbmNvZGUoc25hcHNob3QpKVxuICAgICAgLmNhdGNoKChlcnJvcjogdW5rbm93bikgPT4gdGhpcy5sb2cud2FybignZmFpbGVkIHRvIHBlcnNpc3QgbG9jYWwgaW5kZXgnLCBlcnJvcikpO1xuICB9XG59XG5cbi8vIC0tLSBtb2R1bGUtcHJpdmF0ZSB0eXBlIGFsaWFzZXMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbnR5cGUgU2VydmVyRXJyb3JNZXNzYWdlID0gRXh0cmFjdDxTZXJ2ZXJNZXNzYWdlLCB7IHR5cGU6ICdlcnJvcicgfT47XG4iLCAiLyoqXG4gKiBgT2JzaWRpYW5TdG9yYWdlQWRhcHRlcmAgXHUyMDE0IGNvcmUncyBgU3RvcmFnZUFkYXB0ZXJgIG92ZXIgdGhlIE9ic2lkaWFuIHZhdWx0XG4gKiBgRGF0YUFkYXB0ZXJgIChBUkNISVRFQ1RVUkUgXHUwMEE3OCBhZGFwdGVyczogcGx1Z2luIGltcGxlbWVudGF0aW9uLCBkZXNrdG9wIGFuZFxuICogbW9iaWxlIGFsaWtlKS5cbiAqXG4gKiBQYXRoIG1hcHBpbmc6IGV2ZXJ5IHBhdGggY3Jvc3NpbmcgdGhlIGNvcmUgc2VhbSBpcyBhIFBPU0lYLW5vcm1hbGl6ZWQgdmF1bHRcbiAqIHBhdGggKGAvbm90ZXMvYS5tZGAsIHJvb3QgYC9gKTsgdGhlIE9ic2lkaWFuIGFkYXB0ZXIgd2FudHMgdGhlIHNhbWUgcGF0aFxuICogKndpdGhvdXQqIHRoZSBsZWFkaW5nIHNsYXNoIChgbm90ZXMvYS5tZGApLCB3aXRoIGAvYCAob3IgYCcnYCkgZm9yIHRoZSByb290LlxuICpcbiAqIEFsbCB3cml0ZXMgZ28gdGhyb3VnaCB0aGUgYWRhcHRlciAobmV2ZXIgYHZhdWx0Lm1vZGlmeWAgb24gdGhlIHNpZGUpLCBzb1xuICogT2JzaWRpYW4ncyBvd24gZmlsZSB3YXRjaGluZyBvYnNlcnZlcyB0aGVtIGxpa2UgYW55IGV4dGVybmFsIGVkaXQgYW5kIG9wZW5cbiAqIGVkaXRvcnMgcmVmcmVzaCAoRlItMykuIFdyaXRlcyBhcmUgYXRvbWljLWlzaDogY29udGVudCBsYW5kcyBpbiBhIHRlbXAgZmlsZVxuICogdW5kZXIgYC8udmF1bHRzeW5jZm9yYWdlbnRzL3RtcC9gIChjb3JlIGlnbm9yZXMgdGhhdCB3aG9sZSBzdWJ0cmVlKSBhbmQgaXNcbiAqIHJlbmFtZWQgb250byB0aGUgdGFyZ2V0OyBpZiByZW5hbWluZyBpcyB1bmF2YWlsYWJsZSAoZXhvdGljIG1vYmlsZVxuICogYWRhcHRlcnMpLCB3ZSBmYWxsIGJhY2sgdG8gYSBkaXJlY3Qgd3JpdGUuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBEYXRhQWRhcHRlciB9IGZyb20gJ29ic2lkaWFuJztcbmltcG9ydCB0eXBlIHsgRmlsZVN0YXQsIFN0b3JhZ2VBZGFwdGVyIH0gZnJvbSAnQHZzYS9jb3JlJztcbmltcG9ydCB7IG5vcm1hbGl6ZVZhdWx0UGF0aCB9IGZyb20gJ0B2c2EvY29yZSc7XG5cbi8qKiBEaXJlY3RvcnkgKGluc2lkZSB0aGUgdmF1bHQpIGhvbGRpbmcgdGVtcCBmaWxlcyBkdXJpbmcgYXRvbWljIHdyaXRlcy4gKi9cbmV4cG9ydCBjb25zdCBURU1QX0RJUl9WQVVMVF9QQVRIID0gJy8udmF1bHRzeW5jZm9yYWdlbnRzL3RtcCc7XG5cbi8qKiBTdGF0cyBPYnNpZGlhbidzIGBEYXRhQWRhcHRlci5zdGF0YCByZXR1cm5zIGZvciBhIGZpbGUuICovXG5pbnRlcmZhY2UgQWRhcHRlclN0YXQge1xuICBzaXplOiBudW1iZXI7XG4gIG10aW1lOiBudW1iZXI7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgT2JzaWRpYW5TdG9yYWdlQWRhcHRlck9wdGlvbnMge1xuICBhZGFwdGVyOiBEYXRhQWRhcHRlcjtcbiAgLyoqXG4gICAqIERlc2t0b3AgYW5kIG1vYmlsZSBPYnNpZGlhbidzIGBEYXRhQWRhcHRlci5ybWRpcmAgaXMgZnMucm0tYmFzZWQgYW5kXG4gICAqIHJlZnVzZXMgRVZFUlkgZGlyZWN0b3J5IChgRVJSX0ZTX0VJU0RJUmApIFx1MjAxNCBpdCBjYW5ub3QgcmVtb3ZlIGV2ZW4gYW5cbiAgICogZW1wdHkgZm9sZGVyLCB3aGljaCBzaWxlbnRseSBkZWdyYWRlZCBldmVyeSBmb2xkZXItdG9tYnN0b25lIGFwcGxpY2F0aW9uXG4gICAqIHRvIHJlY29yZC1vbmx5ICh0aGUgRi0xIHBpbmctcG9uZykuIFdoZW4gcHJvdmlkZWQsIGByZW1vdmVEaXJgIHBlcmZvcm1zXG4gICAqIHRoZSBlbXB0eS1mb2xkZXIgcmVtb3ZhbCB0aHJvdWdoIHRoaXMgY2FsbGJhY2sgaW5zdGVhZCBcdTIwMTQgdGhlIHBsdWdpbiB3aXJlc1xuICAgKiBpdCB0byBgZmlsZU1hbmFnZXIudHJhc2hGaWxlYCBvbiB0aGUgdmF1bHQncyBURm9sZGVyLCB3aGljaCB3b3JrcyBhbmRcbiAgICogbmV2ZXIgZGVzdHJveXMgZGF0YSAoc3lzdGVtIHRyYXNoOyBjb3JlIHByZS1jaGVja3MgZW1wdGluZXNzIGFueXdheSkuXG4gICAqIFJlY2VpdmVzIHRoZSBBREFQVEVSIHBhdGggKG5vIGxlYWRpbmcgc2xhc2gpLlxuICAgKi9cbiAgcmVtb3ZlRW1wdHlEaXI/OiAoYWRhcHRlclBhdGg6IHN0cmluZykgPT4gUHJvbWlzZTx2b2lkPjtcbn1cblxuZXhwb3J0IGNsYXNzIE9ic2lkaWFuU3RvcmFnZUFkYXB0ZXIgaW1wbGVtZW50cyBTdG9yYWdlQWRhcHRlciB7XG4gIHByaXZhdGUgcmVhZG9ubHkgYWRhcHRlcjogRGF0YUFkYXB0ZXI7XG4gIHByaXZhdGUgcmVhZG9ubHkgcmVtb3ZlRW1wdHlEaXI/OiAoYWRhcHRlclBhdGg6IHN0cmluZykgPT4gUHJvbWlzZTx2b2lkPjtcbiAgLyoqXG4gICAqIExhdGNoZWQgd2hlbiBhIHRlbXArcmVuYW1lIGF0dGVtcHQgZmFpbHM6IGV2ZXJ5IGxhdGVyIHdyaXRlIGdvZXMgc3RyYWlnaHRcbiAgICogdG8gYHdyaXRlQmluYXJ5YCBpbnN0ZWFkIG9mIHBheWluZyB0aGUgZmFpbGluZy1yZW5hbWUgcGVuYWx0eSBhZ2Fpbi5cbiAgICovXG4gIHByaXZhdGUgdGVtcFJlbmFtZUJyb2tlbiA9IGZhbHNlO1xuICBwcml2YXRlIHRlbXBDb3VudGVyID0gMDtcblxuICBjb25zdHJ1Y3RvcihvcHRpb25zOiBPYnNpZGlhblN0b3JhZ2VBZGFwdGVyT3B0aW9ucykge1xuICAgIHRoaXMuYWRhcHRlciA9IG9wdGlvbnMuYWRhcHRlcjtcbiAgICB0aGlzLnJlbW92ZUVtcHR5RGlyID0gb3B0aW9ucy5yZW1vdmVFbXB0eURpcjtcbiAgfVxuXG4gIC8vIC0tLSBwYXRoIG1hcHBpbmcgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIC8qKiBWYXVsdCBwYXRoIFx1MjE5MiBhZGFwdGVyIHBhdGggKGAvYS9iLm1kYCBcdTIxOTIgYGEvYi5tZGAsIGAvYCBcdTIxOTIgYC9gKS4gKi9cbiAgcHJpdmF0ZSB0b0FkYXB0ZXJQYXRoKHZhdWx0UGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBub3JtYWxpemVkID0gbm9ybWFsaXplVmF1bHRQYXRoKHZhdWx0UGF0aCk7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZWQgPT09ICcvJyA/ICcvJyA6IG5vcm1hbGl6ZWQuc2xpY2UoMSk7XG4gIH1cblxuICAvLyAtLS0gU3RvcmFnZUFkYXB0ZXIgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgYXN5bmMgcmVhZEZpbGUocGF0aDogc3RyaW5nKTogUHJvbWlzZTxVaW50OEFycmF5PiB7XG4gICAgY29uc3QgYnVmZmVyID0gYXdhaXQgdGhpcy5hZGFwdGVyLnJlYWRCaW5hcnkodGhpcy50b0FkYXB0ZXJQYXRoKHBhdGgpKTtcbiAgICByZXR1cm4gbmV3IFVpbnQ4QXJyYXkoYnVmZmVyKTtcbiAgfVxuXG4gIGFzeW5jIHdyaXRlRmlsZShwYXRoOiBzdHJpbmcsIGRhdGE6IFVpbnQ4QXJyYXkpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCB0YXJnZXQgPSB0aGlzLnRvQWRhcHRlclBhdGgocGF0aCk7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVQYXJlbnREaXJzKHRhcmdldCk7XG4gICAgLy8gQ29weSBpbnRvIGEgc3RhbmRhbG9uZSBBcnJheUJ1ZmZlcjogYGJ5dGVzLmJ1ZmZlcmAgbWF5IGJlIGEgcG9vbGVkXG4gICAgLy8gYnVmZmVyIGxhcmdlciB0aGFuIHRoZSB2aWV3IChjb3JlIHNsaWNlcyBhbmQgcmV1c2VzIGJ1ZmZlcnMpLlxuICAgIGNvbnN0IGJ1ZmZlciA9IG5ldyBBcnJheUJ1ZmZlcihkYXRhLmJ5dGVMZW5ndGgpO1xuICAgIG5ldyBVaW50OEFycmF5KGJ1ZmZlcikuc2V0KGRhdGEpO1xuXG4gICAgaWYgKHRoaXMudGVtcFJlbmFtZUJyb2tlbikge1xuICAgICAgYXdhaXQgdGhpcy5hZGFwdGVyLndyaXRlQmluYXJ5KHRhcmdldCwgYnVmZmVyKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgdGVtcCA9IGF3YWl0IHRoaXMudGVtcFBhdGgoKTtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5hZGFwdGVyLndyaXRlQmluYXJ5KHRlbXAsIGJ1ZmZlcik7XG4gICAgICBhd2FpdCB0aGlzLmFkYXB0ZXIucmVuYW1lKHRlbXAsIHRhcmdldCk7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBDbGVhbiB1cCB0aGUgb3JwaGFuZWQgdGVtcCAoYmVzdCBlZmZvcnQgXHUyMDE0IGl0IGxpdmVzIGluIHRoZSBpZ25vcmVkXG4gICAgICAvLyBzdGF0ZSBkaXIsIHNvIGV2ZW4gYSBsZWFrIGlzIGludmlzaWJsZSB0byBzeW5jKSwgdGhlbiBmYWxsIGJhY2sgdG9cbiAgICAgIC8vIGEgZGlyZWN0LCBub24tYXRvbWljIHdyaXRlIHJhdGhlciB0aGFuIGZhaWxpbmcgdGhlIHN5bmMuXG4gICAgICBhd2FpdCB0aGlzLnNpbGVudFJlbW92ZSh0ZW1wKTtcbiAgICAgIHRoaXMudGVtcFJlbmFtZUJyb2tlbiA9IHRydWU7XG4gICAgICBhd2FpdCB0aGlzLmFkYXB0ZXIud3JpdGVCaW5hcnkodGFyZ2V0LCBidWZmZXIpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGRlbGV0ZUZpbGUocGF0aDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgdGFyZ2V0ID0gdGhpcy50b0FkYXB0ZXJQYXRoKHBhdGgpO1xuICAgIC8vIElkZW1wb3RlbnQgcGVyIHRoZSBhZGFwdGVyIGNvbnRyYWN0LlxuICAgIGlmICghKGF3YWl0IHRoaXMuYWRhcHRlci5leGlzdHModGFyZ2V0KSkpIHJldHVybjtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5hZGFwdGVyLnJlbW92ZSh0YXJnZXQpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gTG9zdCBhIHJhY2Ugd2l0aCBhIGNvbmN1cnJlbnQgZGVsZXRlIFx1MjAxNCBvbmx5IHN1cmZhY2UgaWYgaXQgc3Vydml2ZXMuXG4gICAgICBpZiAoYXdhaXQgdGhpcy5hZGFwdGVyLmV4aXN0cyh0YXJnZXQpKSB0aHJvdyBuZXcgRXJyb3IoYGZhaWxlZCB0byBkZWxldGUgJHt0YXJnZXR9YCk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgcmVuYW1lRmlsZShmcm9tOiBzdHJpbmcsIHRvOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBmcm9tUGF0aCA9IHRoaXMudG9BZGFwdGVyUGF0aChmcm9tKTtcbiAgICBjb25zdCB0b1BhdGggPSB0aGlzLnRvQWRhcHRlclBhdGgodG8pO1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUGFyZW50RGlycyh0b1BhdGgpO1xuICAgIGF3YWl0IHRoaXMuYWRhcHRlci5yZW5hbWUoZnJvbVBhdGgsIHRvUGF0aCk7XG4gIH1cblxuICBhc3luYyBsaXN0RmlsZXMoKTogUHJvbWlzZTxyZWFkb25seSBGaWxlU3RhdFtdPiB7XG4gICAgY29uc3QgZmlsZXM6IEZpbGVTdGF0W10gPSBbXTtcbiAgICBhd2FpdCB0aGlzLndhbGtGaWxlcygnLycsIGFzeW5jIChhZGFwdGVyUGF0aCkgPT4ge1xuICAgICAgY29uc3Qgc3RhdCA9IGF3YWl0IHRoaXMuc3RhdE9yTnVsbChhZGFwdGVyUGF0aCk7XG4gICAgICBpZiAoc3RhdCA9PT0gbnVsbCkgcmV0dXJuOyAvLyB2YW5pc2hlZCBtaWQtd2Fsa1xuICAgICAgZmlsZXMucHVzaCh7XG4gICAgICAgIHBhdGg6IGAvJHthZGFwdGVyUGF0aH1gLFxuICAgICAgICBzaXplOiBzdGF0LnNpemUsXG4gICAgICAgIG10aW1lOiBzdGF0Lm10aW1lLFxuICAgICAgfSk7XG4gICAgfSk7XG4gICAgZmlsZXMuc29ydCgoYSwgYikgPT4gKGEucGF0aCA8IGIucGF0aCA/IC0xIDogYS5wYXRoID4gYi5wYXRoID8gMSA6IDApKTtcbiAgICByZXR1cm4gZmlsZXM7XG4gIH1cblxuICBhc3luYyBsaXN0RGlycygpOiBQcm9taXNlPHJlYWRvbmx5IHN0cmluZ1tdPiB7XG4gICAgY29uc3QgZGlyczogc3RyaW5nW10gPSBbJy8nXTtcbiAgICBhd2FpdCB0aGlzLndhbGtGb2xkZXJzKCcvJywgYXN5bmMgKGFkYXB0ZXJQYXRoKSA9PiB7XG4gICAgICBkaXJzLnB1c2goYC8ke2FkYXB0ZXJQYXRofWApO1xuICAgIH0pO1xuICAgIGRpcnMuc29ydCgoYSwgYikgPT4gKGEgPCBiID8gLTEgOiBhID4gYiA/IDEgOiAwKSk7XG4gICAgcmV0dXJuIGRpcnM7XG4gIH1cblxuICBhc3luYyBlbnN1cmVEaXIocGF0aDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IG5vcm1hbGl6ZVZhdWx0UGF0aChwYXRoKTtcbiAgICBjb25zdCBzZWdtZW50cyA9IG5vcm1hbGl6ZWQgPT09ICcvJyA/IFtdIDogbm9ybWFsaXplZC5zbGljZSgxKS5zcGxpdCgnLycpO1xuICAgIGxldCBjdXJyZW50ID0gJyc7XG4gICAgZm9yIChjb25zdCBzZWdtZW50IG9mIHNlZ21lbnRzKSB7XG4gICAgICBjdXJyZW50ID0gY3VycmVudCA9PT0gJycgPyBzZWdtZW50IDogYCR7Y3VycmVudH0vJHtzZWdtZW50fWA7XG4gICAgICBpZiAoIShhd2FpdCB0aGlzLmFkYXB0ZXIuZXhpc3RzKGN1cnJlbnQpKSkgYXdhaXQgdGhpcy5hZGFwdGVyLm1rZGlyKGN1cnJlbnQpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZW1vdmUgYW4gRU1QVFkgZGlyZWN0b3J5ICh0aGUgYFN0b3JhZ2VBZGFwdGVyLnJlbW92ZURpcmAgY29udHJhY3QpLlxuICAgKiBQcmVmZXJzIHRoZSB2YXVsdC1BUEkgY2FsbGJhY2sgKGByZW1vdmVFbXB0eURpcmAgXHUyMDE0IHNlZSB0aGUgb3B0aW9uJ3MgZG9jXG4gICAqIGZvciB3aHkgYERhdGFBZGFwdGVyLnJtZGlyYCBjYW5ub3QgZG8gdGhpcyk7IGZhbGxzIGJhY2sgdG8gYHJtZGlyYCBmb3JcbiAgICogYmFyZSBhZGFwdGVycyAodGVzdHMpLiBNaXNzaW5nIHBhdGggXHUyMUQyIG5vLW9wIChpZGVtcG90ZW50KTsgdGhlIHZhdWx0IHJvb3RcbiAgICogaXMgbmV2ZXIgcmVtb3ZhYmxlOyBhIG5vbi1lbXB0eSByZWZ1c2FsIHByb3BhZ2F0ZXMgKGNvcmUgdHJlYXRzIGl0IGFzXG4gICAqIHJlY29yZC1vbmx5IFx1MjAxNCBuZXZlciBkYXRhIGxvc3MpLlxuICAgKi9cbiAgYXN5bmMgcmVtb3ZlRGlyKHBhdGg6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVWYXVsdFBhdGgocGF0aCk7XG4gICAgaWYgKG5vcm1hbGl6ZWQgPT09ICcvJykgcmV0dXJuOyAvLyBuZXZlciB0b3VjaCB0aGUgdmF1bHQgcm9vdFxuICAgIGNvbnN0IHRhcmdldCA9IHRoaXMudG9BZGFwdGVyUGF0aChub3JtYWxpemVkKTtcbiAgICAvLyBJZGVtcG90ZW50IHBlciB0aGUgYWRhcHRlciBjb250cmFjdC5cbiAgICBpZiAoIShhd2FpdCB0aGlzLmFkYXB0ZXIuZXhpc3RzKHRhcmdldCkpKSByZXR1cm47XG4gICAgaWYgKHRoaXMucmVtb3ZlRW1wdHlEaXIgIT09IHVuZGVmaW5lZCkge1xuICAgICAgYXdhaXQgdGhpcy5yZW1vdmVFbXB0eURpcih0YXJnZXQpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBhd2FpdCB0aGlzLmFkYXB0ZXIucm1kaXIodGFyZ2V0LCBmYWxzZSk7XG4gIH1cblxuICBhc3luYyBleGlzdHMocGF0aDogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IG5vcm1hbGl6ZVZhdWx0UGF0aChwYXRoKTtcbiAgICBpZiAobm9ybWFsaXplZCA9PT0gJy8nKSByZXR1cm4gdHJ1ZTsgLy8gdGhlIHZhdWx0IHJvb3QgYWx3YXlzIGV4aXN0c1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5hZGFwdGVyLmV4aXN0cyh0aGlzLnRvQWRhcHRlclBhdGgobm9ybWFsaXplZCkpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIC8vIC0tLSBoZWxwZXJzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICBwcml2YXRlIGFzeW5jIHN0YXRPck51bGwoYWRhcHRlclBhdGg6IHN0cmluZyk6IFByb21pc2U8QWRhcHRlclN0YXQgfCBudWxsPiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHN0YXQgPSBhd2FpdCB0aGlzLmFkYXB0ZXIuc3RhdChhZGFwdGVyUGF0aCk7XG4gICAgICBpZiAoc3RhdCA9PT0gbnVsbCB8fCBzdGF0LnR5cGUgIT09ICdmaWxlJykgcmV0dXJuIG51bGw7XG4gICAgICByZXR1cm4geyBzaXplOiBzdGF0LnNpemUsIG10aW1lOiBzdGF0Lm10aW1lIH07XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gIH1cblxuICAvKiogQSB1bmlxdWUgdGVtcCBwYXRoIGluc2lkZSB0aGUgKHN5bmMtaWdub3JlZCkgY2xpZW50IHN0YXRlIGRpci4gKi9cbiAgcHJpdmF0ZSBhc3luYyB0ZW1wUGF0aCgpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlRGlyKFRFTVBfRElSX1ZBVUxUX1BBVEgpO1xuICAgIHRoaXMudGVtcENvdW50ZXIgKz0gMTtcbiAgICByZXR1cm4gYCR7VEVNUF9ESVJfVkFVTFRfUEFUSC5zbGljZSgxKX0vdy0ke0RhdGUubm93KCkudG9TdHJpbmcoMzYpfS0ke3RoaXMudGVtcENvdW50ZXJ9LnRtcGA7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHNpbGVudFJlbW92ZShhZGFwdGVyUGF0aDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuYWRhcHRlci5yZW1vdmUoYWRhcHRlclBhdGgpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gYmVzdCBlZmZvcnRcbiAgICB9XG4gIH1cblxuICAvKiogQ3JlYXRlIGV2ZXJ5IGFuY2VzdG9yIGRpcmVjdG9yeSBvZiBhbiBhZGFwdGVyIGZpbGUgcGF0aC4gKi9cbiAgcHJpdmF0ZSBhc3luYyBlbnN1cmVQYXJlbnREaXJzKGFkYXB0ZXJQYXRoOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBzbGFzaCA9IGFkYXB0ZXJQYXRoLmxhc3RJbmRleE9mKCcvJyk7XG4gICAgaWYgKHNsYXNoIDw9IDApIHJldHVybjsgLy8gdmF1bHQgcm9vdCBcdTIwMTQgYWx3YXlzIGV4aXN0c1xuICAgIGNvbnN0IHBhcmVudCA9IGFkYXB0ZXJQYXRoLnNsaWNlKDAsIHNsYXNoKTtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZURpcihgLyR7cGFyZW50fWApO1xuICB9XG5cbiAgLyoqIFJlY3Vyc2l2ZWx5IHZpc2l0IGV2ZXJ5IGZpbGUgdW5kZXIgYGRpckFkYXB0ZXJQYXRoYCAoYWRhcHRlciBwYXRocykuICovXG4gIHByaXZhdGUgYXN5bmMgd2Fsa0ZpbGVzKFxuICAgIGRpckFkYXB0ZXJQYXRoOiBzdHJpbmcsXG4gICAgdmlzaXQ6IChhZGFwdGVyUGF0aDogc3RyaW5nKSA9PiBQcm9taXNlPHZvaWQ+LFxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBsZXQgbGlzdGluZztcbiAgICB0cnkge1xuICAgICAgbGlzdGluZyA9IGF3YWl0IHRoaXMuYWRhcHRlci5saXN0KGRpckFkYXB0ZXJQYXRoKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybjsgLy8gdW5yZWFkYWJsZS9taXNzaW5nIFx1MjAxNCB0cmVhdCBhcyBlbXB0eVxuICAgIH1cbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgbGlzdGluZy5maWxlcykgYXdhaXQgdmlzaXQoZmlsZSk7XG4gICAgZm9yIChjb25zdCBmb2xkZXIgb2YgbGlzdGluZy5mb2xkZXJzKSBhd2FpdCB0aGlzLndhbGtGaWxlcyhmb2xkZXIsIHZpc2l0KTtcbiAgfVxuXG4gIC8qKiBSZWN1cnNpdmVseSB2aXNpdCBldmVyeSBmb2xkZXIgdW5kZXIgYGRpckFkYXB0ZXJQYXRoYCAoYWRhcHRlciBwYXRocykuICovXG4gIHByaXZhdGUgYXN5bmMgd2Fsa0ZvbGRlcnMoXG4gICAgZGlyQWRhcHRlclBhdGg6IHN0cmluZyxcbiAgICB2aXNpdDogKGFkYXB0ZXJQYXRoOiBzdHJpbmcpID0+IFByb21pc2U8dm9pZD4sXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGxldCBsaXN0aW5nO1xuICAgIHRyeSB7XG4gICAgICBsaXN0aW5nID0gYXdhaXQgdGhpcy5hZGFwdGVyLmxpc3QoZGlyQWRhcHRlclBhdGgpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBmb3IgKGNvbnN0IGZvbGRlciBvZiBsaXN0aW5nLmZvbGRlcnMpIHtcbiAgICAgIGF3YWl0IHZpc2l0KGZvbGRlcik7XG4gICAgICBhd2FpdCB0aGlzLndhbGtGb2xkZXJzKGZvbGRlciwgdmlzaXQpO1xuICAgIH1cbiAgfVxufVxuIiwgIi8qKlxuICogYE9ic2lkaWFuV2F0Y2hBZGFwdGVyYCArIGBSZXNjYW5TY2hlZHVsZXJgIFx1MjAxNCBjb3JlJ3MgYFdhdGNoQWRhcHRlcmAgb3ZlclxuICogT2JzaWRpYW4gdmF1bHQgZXZlbnRzIChBUkNISVRFQ1RVUkUgXHUwMEE3OCBhZGFwdGVycyksIHBsdXMgdGhlIHBlcmlvZGljIC9cbiAqIGZvY3VzLWRyaXZlbiByZWNvbmNpbGlhdGlvbiBob29rcyB0aGUgbW9iaWxlICYgZXh0ZXJuYWwtZWRpdCBzdG9yaWVzIG5lZWRcbiAqIChcdTAwQTc4IFwiTW9iaWxlXCIsIEZSLTUsIEZSLTEyKS5cbiAqXG4gKiBWYXVsdCBldmVudHMgY292ZXIgZXZlcnl0aGluZyBPYnNpZGlhbiBpdHNlbGYgb2JzZXJ2ZXMgXHUyMDE0IGluLWFwcCBlZGl0cyxcbiAqIGRyYWctZHJvcHMsIGFuZCBleHRlcm5hbCBlZGl0cyBtYWRlIHdoaWxlIE9ic2lkaWFuIGlzICpvcGVuKi4gRWRpdHMgbWFkZVxuICogd2hpbGUgT2JzaWRpYW4gd2FzIGNsb3NlZCBhcmUgcGlja2VkIHVwIGJ5IHRoZSBzdGFydHVwIHJlY29uY2lsaWF0aW9uIGFuZFxuICogYnkgdGhlIHBlcmlvZGljIHJlc2NhbiB3aXJlZCBoZXJlOlxuICpcbiAqICAgdmF1bHQgZXZlbnRzIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjVCQSBXYXRjaEFkYXB0ZXIuc3RhcnQoY2IpIFx1MjUwMFx1MjVCQSBTeW5jQ2xpZW50IGRlYm91bmNlZCBjeWNsZVxuICogICBzZXRJbnRlcnZhbCAoZGVmYXVsdCAzMHMpIFx1MjUwMFx1MjVCQSBSZXNjYW5TY2hlZHVsZXIgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNUJBIFN5bmNDbGllbnQudHJpZ2dlclN5bmMoKVxuICogICBhY3RpdmUtbGVhZi1jaGFuZ2UgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNUJBIFJlc2NhblNjaGVkdWxlci5wb2tlKCkgXHUyNTAwXHUyNTAwXHUyNUJBIChzaG9ydCBkZWJvdW5jZSwgdGhlbiBhIGN5Y2xlKVxuICovXG5cbmltcG9ydCB0eXBlIHsgRXZlbnRSZWYsIFRBYnN0cmFjdEZpbGUsIFZhdWx0IH0gZnJvbSAnb2JzaWRpYW4nO1xuaW1wb3J0IHR5cGUgeyBGaWxlQ2hhbmdlRXZlbnQsIFdhdGNoQWRhcHRlciB9IGZyb20gJ0B2c2EvY29yZSc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgT2JzaWRpYW5XYXRjaEFkYXB0ZXJPcHRpb25zIHtcbiAgdmF1bHQ6IFZhdWx0O1xufVxuXG5leHBvcnQgY2xhc3MgT2JzaWRpYW5XYXRjaEFkYXB0ZXIgaW1wbGVtZW50cyBXYXRjaEFkYXB0ZXIge1xuICBwcml2YXRlIHJlYWRvbmx5IHZhdWx0OiBWYXVsdDtcbiAgcHJpdmF0ZSByZWZzOiBFdmVudFJlZltdID0gW107XG4gIHByaXZhdGUgZW1pdDogKChldmVudHM6IHJlYWRvbmx5IEZpbGVDaGFuZ2VFdmVudFtdKSA9PiB2b2lkKSB8IG51bGwgPSBudWxsO1xuXG4gIGNvbnN0cnVjdG9yKG9wdGlvbnM6IE9ic2lkaWFuV2F0Y2hBZGFwdGVyT3B0aW9ucykge1xuICAgIHRoaXMudmF1bHQgPSBvcHRpb25zLnZhdWx0O1xuICB9XG5cbiAgc3RhcnQoY2I6IChldmVudHM6IHJlYWRvbmx5IEZpbGVDaGFuZ2VFdmVudFtdKSA9PiB2b2lkKTogdm9pZCB7XG4gICAgdGhpcy5zdG9wKCk7XG4gICAgdGhpcy5lbWl0ID0gY2I7XG4gICAgLy8gQm90aCBmaWxlcyBhbmQgZm9sZGVycyBhcmUgZm9yd2FyZGVkOiBmb2xkZXIgZXZlbnRzIChjcmVhdGUvcmVuYW1lL1xuICAgIC8vIGRlbGV0ZSkgdHJpZ2dlciB0aGUgcmVjb25jaWxpYXRpb24gc2NhbiB0aGF0IGRpc2NvdmVycyBlbXB0eS1mb2xkZXJcbiAgICAvLyBwbGFjZWhvbGRlciBjaGFuZ2VzIChGUi0xMCkuIFRoZSBlbmdpbmUgZmlsdGVycyBpZ25vcmVkIHBhdGhzIGl0c2VsZi5cbiAgICB0aGlzLnJlZnMgPSBbXG4gICAgICB0aGlzLnZhdWx0Lm9uKCdjcmVhdGUnLCAoZmlsZTogVEFic3RyYWN0RmlsZSkgPT4ge1xuICAgICAgICB0aGlzLmZvcndhcmQoeyBraW5kOiAnYWRkJywgcGF0aDogdmF1bHRQYXRoT2YoZmlsZSkgfSk7XG4gICAgICB9KSxcbiAgICAgIHRoaXMudmF1bHQub24oJ21vZGlmeScsIChmaWxlOiBUQWJzdHJhY3RGaWxlKSA9PiB7XG4gICAgICAgIHRoaXMuZm9yd2FyZCh7IGtpbmQ6ICdtb2RpZnknLCBwYXRoOiB2YXVsdFBhdGhPZihmaWxlKSB9KTtcbiAgICAgIH0pLFxuICAgICAgdGhpcy52YXVsdC5vbignZGVsZXRlJywgKGZpbGU6IFRBYnN0cmFjdEZpbGUpID0+IHtcbiAgICAgICAgdGhpcy5mb3J3YXJkKHsga2luZDogJ2RlbGV0ZScsIHBhdGg6IHZhdWx0UGF0aE9mKGZpbGUpIH0pO1xuICAgICAgfSksXG4gICAgICB0aGlzLnZhdWx0Lm9uKCdyZW5hbWUnLCAoZmlsZTogVEFic3RyYWN0RmlsZSwgb2xkUGF0aDogc3RyaW5nKSA9PiB7XG4gICAgICAgIC8vIGBvbGRQYXRoYCBcdTIxOTIgYGZpbGUucGF0aGA6IHRoZSBlbnRyeSBhdCBgcGF0aGAgbW92ZWQgdG8gYHRvUGF0aGAuXG4gICAgICAgIHRoaXMuZm9yd2FyZCh7IGtpbmQ6ICdyZW5hbWUnLCBwYXRoOiBgLyR7b2xkUGF0aH1gLCB0b1BhdGg6IHZhdWx0UGF0aE9mKGZpbGUpIH0pO1xuICAgICAgfSksXG4gICAgXTtcbiAgfVxuXG4gIHN0b3AoKTogdm9pZCB7XG4gICAgZm9yIChjb25zdCByZWYgb2YgdGhpcy5yZWZzKSB0aGlzLnZhdWx0Lm9mZnJlZihyZWYpO1xuICAgIHRoaXMucmVmcyA9IFtdO1xuICAgIHRoaXMuZW1pdCA9IG51bGw7XG4gIH1cblxuICBwcml2YXRlIGZvcndhcmQoZXZlbnQ6IEZpbGVDaGFuZ2VFdmVudCk6IHZvaWQge1xuICAgIHRoaXMuZW1pdD8uKFtldmVudF0pO1xuICB9XG59XG5cbi8qKiBWYXVsdCBldmVudCBwYXRoIChhZGFwdGVyLW5vcm1hbGl6ZWQsIG5vIGxlYWRpbmcgc2xhc2gpIFx1MjE5MiBjb3JlIHZhdWx0IHBhdGguICovXG5mdW5jdGlvbiB2YXVsdFBhdGhPZihmaWxlOiBUQWJzdHJhY3RGaWxlKTogc3RyaW5nIHtcbiAgcmV0dXJuIGZpbGUucGF0aC5zdGFydHNXaXRoKCcvJykgPyBmaWxlLnBhdGggOiBgLyR7ZmlsZS5wYXRofWA7XG59XG5cbi8vIC0tLSBSZXNjYW5TY2hlZHVsZXIgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBSZXNjYW5TY2hlZHVsZXJPcHRpb25zIHtcbiAgLyoqIFBlcmlvZCBiZXR3ZWVuIGZ1bGwgcmVzY2FucyBpbiBtczsgYDBgIGRpc2FibGVzIHRoZSBwZXJpb2RpYyB0aW1lci4gKi9cbiAgaW50ZXJ2YWxNczogbnVtYmVyO1xuICAvKiogRGVib3VuY2Ugd2luZG93IGZvciBgcG9rZSgpYCAoYWN0aXZlLWxlYWYtY2hhbmdlKSwgZGVmYXVsdCAzMDAwIG1zLiAqL1xuICBwb2tlRGVsYXlNcz86IG51bWJlcjtcbiAgLyoqIEluamVjdGFibGUgdGltZXIgc2VhbXMgKHRlc3RzIHVzZSBmYWtlIHRpbWVycyBhZ2FpbnN0IHRoZSBnbG9iYWxzKS4gKi9cbiAgc2V0SW50ZXJ2YWxJbXBsPzogKGZuOiAoKSA9PiB2b2lkLCBtczogbnVtYmVyKSA9PiB1bmtub3duO1xuICBjbGVhckludGVydmFsSW1wbD86IChoYW5kbGU6IHVua25vd24pID0+IHZvaWQ7XG4gIHNldFRpbWVvdXRJbXBsPzogKGZuOiAoKSA9PiB2b2lkLCBtczogbnVtYmVyKSA9PiB1bmtub3duO1xuICBjbGVhclRpbWVvdXRJbXBsPzogKGhhbmRsZTogdW5rbm93bikgPT4gdm9pZDtcbn1cblxuLyoqXG4gKiBEcml2ZXMgcGVyaW9kaWMgKyBmb2N1cy10cmlnZ2VyZWQgZnVsbCByZWNvbmNpbGlhdGlvbiBjeWNsZXMuIE5vdCBhXG4gKiBgV2F0Y2hBZGFwdGVyYCBpdHNlbGYgXHUyMDE0IGl0cyBgcnVuYCBjYWxsYmFjayBpcyB3aXJlZCB0b1xuICogYFN5bmNDbGllbnQudHJpZ2dlclN5bmMoKWAgYnkgdGhlIHBsdWdpbiAoYSByZXNjYW4gaXMgYSBmdWxsIGN5Y2xlLCBub3QgYVxuICogc2luZ2xlIGZpbGUgZXZlbnQpLlxuICovXG5leHBvcnQgY2xhc3MgUmVzY2FuU2NoZWR1bGVyIHtcbiAgcHJpdmF0ZSByZWFkb25seSBwb2tlRGVsYXlNczogbnVtYmVyO1xuICBwcml2YXRlIHJlYWRvbmx5IHNldEludGVydmFsSW1wbDogKGZuOiAoKSA9PiB2b2lkLCBtczogbnVtYmVyKSA9PiB1bmtub3duO1xuICBwcml2YXRlIHJlYWRvbmx5IGNsZWFySW50ZXJ2YWxJbXBsOiAoaGFuZGxlOiB1bmtub3duKSA9PiB2b2lkO1xuICBwcml2YXRlIHJlYWRvbmx5IHNldFRpbWVvdXRJbXBsOiAoZm46ICgpID0+IHZvaWQsIG1zOiBudW1iZXIpID0+IHVua25vd247XG4gIHByaXZhdGUgcmVhZG9ubHkgY2xlYXJUaW1lb3V0SW1wbDogKGhhbmRsZTogdW5rbm93bikgPT4gdm9pZDtcblxuICBwcml2YXRlIHJ1bjogKCgpID0+IHZvaWQpIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgaW50ZXJ2YWxIYW5kbGU6IHVua25vd24gPSBudWxsO1xuICBwcml2YXRlIGludGVydmFsTXM6IG51bWJlcjtcbiAgcHJpdmF0ZSBwb2tlSGFuZGxlOiB1bmtub3duID0gbnVsbDtcblxuICBjb25zdHJ1Y3RvcihvcHRpb25zOiBSZXNjYW5TY2hlZHVsZXJPcHRpb25zKSB7XG4gICAgdGhpcy5pbnRlcnZhbE1zID0gb3B0aW9ucy5pbnRlcnZhbE1zO1xuICAgIHRoaXMucG9rZURlbGF5TXMgPSBvcHRpb25zLnBva2VEZWxheU1zID8/IDMwMDA7XG4gICAgdGhpcy5zZXRJbnRlcnZhbEltcGwgPSBvcHRpb25zLnNldEludGVydmFsSW1wbCA/PyAoKGZuLCBtcykgPT4gc2V0SW50ZXJ2YWwoZm4sIG1zKSk7XG4gICAgdGhpcy5jbGVhckludGVydmFsSW1wbCA9IG9wdGlvbnMuY2xlYXJJbnRlcnZhbEltcGwgPz8gKChoYW5kbGUpID0+IGNsZWFySW50ZXJ2YWwoaGFuZGxlIGFzIG51bWJlcikpO1xuICAgIHRoaXMuc2V0VGltZW91dEltcGwgPSBvcHRpb25zLnNldFRpbWVvdXRJbXBsID8/ICgoZm4sIG1zKSA9PiBzZXRUaW1lb3V0KGZuLCBtcykpO1xuICAgIHRoaXMuY2xlYXJUaW1lb3V0SW1wbCA9IG9wdGlvbnMuY2xlYXJUaW1lb3V0SW1wbCA/PyAoKGhhbmRsZSkgPT4gY2xlYXJUaW1lb3V0KGhhbmRsZSBhcyBudW1iZXIpKTtcbiAgfVxuXG4gIC8qKiBCZWdpbiBwZXJpb2RpYyByZXNjYW5zOyBgcnVuYCBtdXN0IGJlIHNhZmUgdG8gY2FsbCBhdCBhbnkgdGltZS4gKi9cbiAgc3RhcnQocnVuOiAoKSA9PiB2b2lkKTogdm9pZCB7XG4gICAgdGhpcy5zdG9wKCk7XG4gICAgdGhpcy5ydW4gPSBydW47XG4gICAgdGhpcy5hcm1JbnRlcnZhbCgpO1xuICB9XG5cbiAgc3RvcCgpOiB2b2lkIHtcbiAgICB0aGlzLmNsZWFySW50ZXJ2YWxJbXBsS2VlcCgpO1xuICAgIGlmICh0aGlzLnBva2VIYW5kbGUgIT09IG51bGwpIHtcbiAgICAgIHRoaXMuY2xlYXJUaW1lb3V0SW1wbCh0aGlzLnBva2VIYW5kbGUpO1xuICAgICAgdGhpcy5wb2tlSGFuZGxlID0gbnVsbDtcbiAgICB9XG4gICAgdGhpcy5ydW4gPSBudWxsO1xuICB9XG5cbiAgLyoqIENoYW5nZSB0aGUgcGVyaW9kaWMgaW50ZXJ2YWwgbGl2ZSAodGhlIHNldHRpbmdzLXRhYiB0b2dnbGUpLiAqL1xuICBzZXRJbnRlcnZhbE1zKG1zOiBudW1iZXIpOiB2b2lkIHtcbiAgICB0aGlzLmludGVydmFsTXMgPSBtcztcbiAgICBpZiAodGhpcy5ydW4gIT09IG51bGwpIHtcbiAgICAgIHRoaXMuY2xlYXJJbnRlcnZhbEltcGxLZWVwKCk7XG4gICAgICB0aGlzLmFybUludGVydmFsKCk7XG4gICAgfVxuICB9XG5cbiAgLyoqIEEgZm9jdXMvYXBwLXN3aXRjaCBzaWduYWwgKGFjdGl2ZS1sZWFmLWNoYW5nZSk6IHJlc2NhbiBzb29uLCBjb2FsZXNjZWQuICovXG4gIHBva2UoKTogdm9pZCB7XG4gICAgaWYgKHRoaXMucnVuID09PSBudWxsKSByZXR1cm47XG4gICAgaWYgKHRoaXMucG9rZUhhbmRsZSAhPT0gbnVsbCkgcmV0dXJuOyAvLyBhbHJlYWR5IHNjaGVkdWxlZFxuICAgIHRoaXMucG9rZUhhbmRsZSA9IHRoaXMuc2V0VGltZW91dEltcGwoKCkgPT4ge1xuICAgICAgdGhpcy5wb2tlSGFuZGxlID0gbnVsbDtcbiAgICAgIHRoaXMucnVuPy4oKTtcbiAgICB9LCB0aGlzLnBva2VEZWxheU1zKTtcbiAgfVxuXG4gIGdldCBpbnRlcnZhbE1zVmFsdWUoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy5pbnRlcnZhbE1zO1xuICB9XG5cbiAgcHJpdmF0ZSBhcm1JbnRlcnZhbCgpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5pbnRlcnZhbE1zIDw9IDAgfHwgdGhpcy5ydW4gPT09IG51bGwpIHJldHVybjtcbiAgICB0aGlzLmludGVydmFsSGFuZGxlID0gdGhpcy5zZXRJbnRlcnZhbEltcGwoKCkgPT4gdGhpcy5ydW4/LigpLCB0aGlzLmludGVydmFsTXMpO1xuICB9XG5cbiAgcHJpdmF0ZSBjbGVhckludGVydmFsSW1wbEtlZXAoKTogdm9pZCB7XG4gICAgaWYgKHRoaXMuaW50ZXJ2YWxIYW5kbGUgIT09IG51bGwpIHtcbiAgICAgIHRoaXMuY2xlYXJJbnRlcnZhbEltcGwodGhpcy5pbnRlcnZhbEhhbmRsZSk7XG4gICAgICB0aGlzLmludGVydmFsSGFuZGxlID0gbnVsbDtcbiAgICB9XG4gIH1cbn1cbiIsICIvKipcbiAqIGBIdHRwQmxvYlN0b3JlYCBcdTIwMTQgY29yZSdzIGBCbG9iU3RvcmVgIGFnYWluc3QgdGhlIHdvcmtlcidzIGAvYmxvYi86aGFzaGBcbiAqIHJvdXRlcyAoQVJDSElURUNUVVJFIFx1MDBBNzUgSFRUUFMgcm91dGVzKSwgYXV0aGVudGljYXRlZCB3aXRoIHRoZSBkZXZpY2UgdG9rZW5cbiAqIGFzIGEgQmVhcmVyIGhlYWRlci4gQnVpbHQgb24gdGhlIGdsb2JhbCBgZmV0Y2hgIChPYnNpZGlhbiBkZXNrdG9wIGFuZFxuICogbW9iaWxlKSwgaW5qZWN0YWJsZSBmb3IgdGVzdHMuIFBsdWdpbi1sb2NhbCB0d2luIG9mIHRoZSBub2RlLXJ1bnRpbWUgb25lOlxuICogbm8gaW1wb3J0cyBmcm9tIGBAdnNhL25vZGUtcnVudGltZWAgKE5vZGUtb25seSBwYWNrYWdlKS5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IEJsb2JTdG9yZSB9IGZyb20gJ0B2c2EvY29yZSc7XG5cbi8qKiBOb24tMnh4IGJsb2Itcm91dGUgcmVwbHkuIGBzdGF0dXNgIGlzIHRoZSBIVFRQIHN0YXR1cyBjb2RlLiAqL1xuZXhwb3J0IGNsYXNzIEh0dHBCbG9iRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIGNvbnN0cnVjdG9yKFxuICAgIHJlYWRvbmx5IHN0YXR1czogbnVtYmVyLFxuICAgIG1lc3NhZ2U6IHN0cmluZyxcbiAgKSB7XG4gICAgc3VwZXIobWVzc2FnZSk7XG4gICAgdGhpcy5uYW1lID0gJ0h0dHBCbG9iRXJyb3InO1xuICB9XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgSHR0cEJsb2JTdG9yZU9wdGlvbnMge1xuICAvKiogV29ya2VyIG9yaWdpbiwgZS5nLiBgaHR0cHM6Ly9wZXJzb25hbC54LndvcmtlcnMuZGV2YC4gKi9cbiAgYmFzZVVybDogc3RyaW5nO1xuICAvKiogRGV2aWNlIHRva2VuIChCZWFyZXIpLiAqL1xuICB0b2tlbjogc3RyaW5nO1xuICAvKiogSW5qZWN0YWJsZSBmZXRjaCAodGVzdHMpLiBEZWZhdWx0cyB0byB0aGUgZ2xvYmFsLiAqL1xuICBmZXRjaEltcGw/OiB0eXBlb2YgZmV0Y2g7XG59XG5cbmV4cG9ydCBjbGFzcyBIdHRwQmxvYlN0b3JlIGltcGxlbWVudHMgQmxvYlN0b3JlIHtcbiAgcHJpdmF0ZSByZWFkb25seSBiYXNlOiBzdHJpbmc7XG4gIHByaXZhdGUgcmVhZG9ubHkgdG9rZW46IHN0cmluZztcbiAgcHJpdmF0ZSByZWFkb25seSBkb0ZldGNoOiB0eXBlb2YgZmV0Y2g7XG5cbiAgY29uc3RydWN0b3Iob3B0aW9uczogSHR0cEJsb2JTdG9yZU9wdGlvbnMpIHtcbiAgICB0aGlzLmJhc2UgPSBvcHRpb25zLmJhc2VVcmwucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG4gICAgdGhpcy50b2tlbiA9IG9wdGlvbnMudG9rZW47XG4gICAgLy8gQm91bmQgbGlrZSB0aGUgcGx1Z2luJ3MgYGZldGNoSW1wbGAgc2VhbTogdGhpcyBjbGFzcyBjYWxscyBgZG9GZXRjaGBcbiAgICAvLyBkZXRhY2hlZCwgYW5kIGEgYmFyZSBnbG9iYWwgYGZldGNoYCBpcyBhbiBpbGxlZ2FsIGludm9jYXRpb24gaW5cbiAgICAvLyBDaHJvbWl1bSByZW5kZXJlcnMgKHJlYWwgT2JzaWRpYW4pLlxuICAgIHRoaXMuZG9GZXRjaCA9IG9wdGlvbnMuZmV0Y2hJbXBsID8/IGdsb2JhbFRoaXMuZmV0Y2guYmluZChnbG9iYWxUaGlzKTtcbiAgfVxuXG4gIC8qKiBHRVQgL2Jsb2IvOmhhc2ggXHUyMTkyIGJ5dGVzLCBvciBgdW5kZWZpbmVkYCBvbiA0MDQuICovXG4gIGFzeW5jIGdldChoYXNoOiBzdHJpbmcpOiBQcm9taXNlPFVpbnQ4QXJyYXkgfCB1bmRlZmluZWQ+IHtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMuZG9GZXRjaChgJHt0aGlzLmJhc2V9L2Jsb2IvJHtoYXNofWAsIHtcbiAgICAgIGhlYWRlcnM6IHsgYXV0aG9yaXphdGlvbjogYEJlYXJlciAke3RoaXMudG9rZW59YCB9LFxuICAgIH0pO1xuICAgIGlmIChyZXNwb25zZS5zdGF0dXMgPT09IDQwNCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICBpZiAoIXJlc3BvbnNlLm9rKSB7XG4gICAgICB0aHJvdyBuZXcgSHR0cEJsb2JFcnJvcihyZXNwb25zZS5zdGF0dXMsIGF3YWl0IGVycm9yTWVzc2FnZShyZXNwb25zZSwgJ2ZldGNoIGJsb2InKSk7XG4gICAgfVxuICAgIHJldHVybiBuZXcgVWludDhBcnJheShhd2FpdCByZXNwb25zZS5hcnJheUJ1ZmZlcigpKTtcbiAgfVxuXG4gIC8qKiBQVVQgL2Jsb2IvOmhhc2ggXHUyMDE0IGlkZW1wb3RlbnQgcGVyIHRoZSBDQVMgY29udHJhY3QuICovXG4gIGFzeW5jIHB1dChoYXNoOiBzdHJpbmcsIGJ5dGVzOiBVaW50OEFycmF5KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLmRvRmV0Y2goYCR7dGhpcy5iYXNlfS9ibG9iLyR7aGFzaH1gLCB7XG4gICAgICBtZXRob2Q6ICdQVVQnLFxuICAgICAgaGVhZGVyczoge1xuICAgICAgICBhdXRob3JpemF0aW9uOiBgQmVhcmVyICR7dGhpcy50b2tlbn1gLFxuICAgICAgICAnY29udGVudC10eXBlJzogJ2FwcGxpY2F0aW9uL29jdGV0LXN0cmVhbScsXG4gICAgICB9LFxuICAgICAgYm9keTogYnl0ZXMgYXMgQm9keUluaXQsXG4gICAgfSk7XG4gICAgaWYgKCFyZXNwb25zZS5vaykge1xuICAgICAgdGhyb3cgbmV3IEh0dHBCbG9iRXJyb3IocmVzcG9uc2Uuc3RhdHVzLCBhd2FpdCBlcnJvck1lc3NhZ2UocmVzcG9uc2UsICdzdG9yZSBibG9iJykpO1xuICAgIH1cbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBlcnJvck1lc3NhZ2UocmVzcG9uc2U6IFJlc3BvbnNlLCB3aGF0OiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCBkZXRhaWwgPSAoYXdhaXQgcmVzcG9uc2UudGV4dCgpLmNhdGNoKCgpID0+ICcnKSkuc2xpY2UoMCwgMzAwKTtcbiAgcmV0dXJuIGRldGFpbCA9PT0gJydcbiAgICA/IGBmYWlsZWQgdG8gJHt3aGF0fTogSFRUUCAke3Jlc3BvbnNlLnN0YXR1c31gXG4gICAgOiBgZmFpbGVkIHRvICR7d2hhdH06IEhUVFAgJHtyZXNwb25zZS5zdGF0dXN9OiAke2RldGFpbH1gO1xufVxuIiwgIi8qKlxuICogRGlhZ25vc3RpY3MgKHRoZSBzZXR0aW5ncyB0YWIncyBcIkFkdmFuY2VkIFx1MjE5MiBEaWFnbm9zdGljc1wiKTogYSBib3VuZGVkIHJpbmdcbiAqIGJ1ZmZlciBvdmVyIHRoZSBwbHVnaW4ncyBsb2cgc3RyZWFtIHdpdGggYSB1c2VyLXNlbGVjdGFibGUgbWluaW11bSBsZXZlbCxcbiAqIGEgdHJhbnNwb3J0IHdyYXBwZXIgdGhhdCByZWNvcmRzIHByb3RvY29sIHJvdW5kLXRyaXBzIGF0IGRlYnVnIGxldmVsIChsb3dcbiAqIHZvbHVtZTogb25lIHNob3J0IGxpbmUgcGVyIGZyYW1lKSwgYW5kIHRoZSBcIkNvcHkgZGlhZ25vc3RpY3NcIiBidW5kbGUuXG4gKlxuICogVGhlIGJ1bmRsZSBpcyBhIHBsYWluLXRleHQgc25hcHNob3QgbWVhbnQgZm9yIGJ1ZyByZXBvcnRzOiB2ZXJzaW9ucyxcbiAqIGlkZW50aXR5LCB3b3JrZXIsIGEgY2xpZW50IHN0YXR1cyBzbmFwc2hvdCwgdGhlIHBsYXRmb3JtLCBhbmQgdGhlIGxhc3QgTlxuICogbG9nIGxpbmVzLlxuICovXG5cbmltcG9ydCB7IFByb3RvY29sVmVyc2lvbiB9IGZyb20gJ0B2c2EvY29yZSc7XG5pbXBvcnQgdHlwZSB7IExvZ0FkYXB0ZXIsIFN5bmNDbGllbnRTdGF0dXMsIFRyYW5zcG9ydCB9IGZyb20gJ0B2c2EvY29yZSc7XG5pbXBvcnQgeyBQbGF0Zm9ybSB9IGZyb20gJ29ic2lkaWFuJztcbmltcG9ydCB0eXBlIHsgTG9nTGV2ZWwgfSBmcm9tICcuL2RhdGEuanMnO1xuXG4vKiogU2V2ZXJpdHkgcmFua2luZzsgYGVycm9yYCBhbHdheXMgb3V0cmFua3MgZXZlcnkgc2VsZWN0YWJsZSBsZXZlbC4gKi9cbmNvbnN0IExFVkVMX1JBTks6IFJlY29yZDxMb2dMZXZlbCB8ICdlcnJvcicsIG51bWJlcj4gPSB7IGRlYnVnOiAxMCwgaW5mbzogMjAsIHdhcm46IDMwLCBlcnJvcjogNDAgfTtcblxuLyoqIExvZyBsaW5lcyBrZXB0IGZvciB0aGUgZGlhZ25vc3RpY3MgYnVuZGxlICh0aGUgc3BlYydzIFwibGFzdCAyMFwiKS4gKi9cbmV4cG9ydCBjb25zdCBSSU5HX0NBUEFDSVRZID0gMjA7XG5cbi8qKiBNYXggY2hhcmFjdGVycyBvbmUgYXJndW1lbnQgY29udHJpYnV0ZXMgdG8gYSByaW5nIGxpbmUuICovXG5jb25zdCBBUkdfTUFYX0NIQVJTID0gMzAwO1xuXG4vKiogQSBgTG9nQWRhcHRlcmAgd2l0aCBhIGxldmVsIGdhdGUgYW5kIGEgYm91bmRlZCByaW5nIGJ1ZmZlciBhdHRhY2hlZC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUGx1Z2luTG9nIGV4dGVuZHMgTG9nQWRhcHRlciB7XG4gIC8qKiBDaGFuZ2UgdGhlIG1pbmltdW0gcmVjb3JkZWQgbGV2ZWwgYXQgcnVudGltZSAodGhlIHNldHRpbmdzIGRyb3Bkb3duKS4gKi9cbiAgc2V0TGV2ZWwobGV2ZWw6IExvZ0xldmVsKTogdm9pZDtcbiAgZ2V0TGV2ZWwoKTogTG9nTGV2ZWw7XG4gIC8qKiBXaGV0aGVyIGBkZWJ1Z2AgY2FsbHMgY3VycmVudGx5IHBhc3MgdGhlIGdhdGUgKHJvdW5kLXRyaXAgbG9nZ2luZyBob29rKS4gKi9cbiAgZ2V0IGRlYnVnRW5hYmxlZCgpOiBib29sZWFuO1xuICAvKiogVGhlIG1vc3QgcmVjZW50IGxpbmVzLCBvbGRlc3QgZmlyc3QgKGJvdW5kZWQgYnkgdGhlIGNhcGFjaXR5KS4gKi9cbiAgcmVjZW50TGluZXMoKTogc3RyaW5nW107XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUGx1Z2luTG9nT3B0aW9ucyB7XG4gIC8qKiBSaW5nIGNhcGFjaXR5IChkZWZhdWx0IDIwKS4gKi9cbiAgY2FwYWNpdHk/OiBudW1iZXI7XG4gIC8qKiBNaW5pbXVtIHJlY29yZGVkIGxldmVsIChkZWZhdWx0ICdpbmZvJykuICovXG4gIGxldmVsPzogTG9nTGV2ZWw7XG4gIC8qKiBUaW1lc3RhbXAgc2VhbSAoZGVmYXVsdCBgRGF0ZS5ub3dgKS4gKi9cbiAgbm93PzogKCkgPT4gbnVtYmVyO1xufVxuXG4vKiogQnVpbGQgdGhlIHBsdWdpbidzIGxvZyBhZGFwdGVyOiBjb25zb2xlIG1pcnJvciArIGJvdW5kZWQgcmluZyBidWZmZXIuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlUGx1Z2luTG9nKG9wdGlvbnM6IFBsdWdpbkxvZ09wdGlvbnMgPSB7fSk6IFBsdWdpbkxvZyB7XG4gIGNvbnN0IGNhcGFjaXR5ID0gb3B0aW9ucy5jYXBhY2l0eSA/PyBSSU5HX0NBUEFDSVRZO1xuICBjb25zdCBub3cgPSBvcHRpb25zLm5vdyA/PyAoKCkgPT4gRGF0ZS5ub3coKSk7XG4gIGxldCBsZXZlbDogTG9nTGV2ZWwgPSBvcHRpb25zLmxldmVsID8/ICdpbmZvJztcbiAgbGV0IHJpbmc6IHN0cmluZ1tdID0gW107XG5cbiAgY29uc3Qgd3JpdGUgPSAoc2V2ZXJpdHk6IExvZ0xldmVsIHwgJ2Vycm9yJywgYXJnczogcmVhZG9ubHkgdW5rbm93bltdKTogdm9pZCA9PiB7XG4gICAgaWYgKExFVkVMX1JBTktbc2V2ZXJpdHldIDwgTEVWRUxfUkFOS1tsZXZlbF0pIHJldHVybjtcbiAgICBjb25zdCBsaW5lID0gYCR7bmV3IERhdGUobm93KCkpLnRvSVNPU3RyaW5nKCl9IFske3NldmVyaXR5fV0gJHthcmdzLm1hcChmbXQpLmpvaW4oJyAnKX1gO1xuICAgIHJpbmcucHVzaChsaW5lKTtcbiAgICBpZiAocmluZy5sZW5ndGggPiBjYXBhY2l0eSkgcmluZyA9IHJpbmcuc2xpY2UocmluZy5sZW5ndGggLSBjYXBhY2l0eSk7XG4gICAgY29uc3Qgc2luayA9XG4gICAgICBzZXZlcml0eSA9PT0gJ2Vycm9yJyA/IGNvbnNvbGUuZXJyb3IgOiBzZXZlcml0eSA9PT0gJ3dhcm4nID8gY29uc29sZS53YXJuIDogY29uc29sZS5sb2c7XG4gICAgc2luaygnW3ZzYV0nLCAuLi5hcmdzKTtcbiAgfTtcblxuICByZXR1cm4ge1xuICAgIGRlYnVnOiAoLi4uYXJnczogdW5rbm93bltdKSA9PiB3cml0ZSgnZGVidWcnLCBhcmdzKSxcbiAgICBpbmZvOiAoLi4uYXJnczogdW5rbm93bltdKSA9PiB3cml0ZSgnaW5mbycsIGFyZ3MpLFxuICAgIHdhcm46ICguLi5hcmdzOiB1bmtub3duW10pID0+IHdyaXRlKCd3YXJuJywgYXJncyksXG4gICAgZXJyb3I6ICguLi5hcmdzOiB1bmtub3duW10pID0+IHdyaXRlKCdlcnJvcicsIGFyZ3MpLFxuICAgIHNldExldmVsKG5leHQ6IExvZ0xldmVsKTogdm9pZCB7XG4gICAgICBsZXZlbCA9IG5leHQ7XG4gICAgfSxcbiAgICBnZXRMZXZlbCgpOiBMb2dMZXZlbCB7XG4gICAgICByZXR1cm4gbGV2ZWw7XG4gICAgfSxcbiAgICBnZXQgZGVidWdFbmFibGVkKCk6IGJvb2xlYW4ge1xuICAgICAgcmV0dXJuIGxldmVsID09PSAnZGVidWcnO1xuICAgIH0sXG4gICAgcmVjZW50TGluZXMoKTogc3RyaW5nW10ge1xuICAgICAgcmV0dXJuIFsuLi5yaW5nXTtcbiAgICB9LFxuICB9O1xufVxuXG4vKiogT25lIGxvZyBhcmd1bWVudCBcdTIxOTIgY29tcGFjdCB0ZXh0IChzdHJpbmdzIHBhc3MgdGhyb3VnaCwgbG9uZyB2YWx1ZXMgdHJ1bmNhdGVkKS4gKi9cbmZ1bmN0aW9uIGZtdCh2YWx1ZTogdW5rbm93bik6IHN0cmluZyB7XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSByZXR1cm4gdHJ1bmNhdGUodmFsdWUpO1xuICBpZiAodmFsdWUgaW5zdGFuY2VvZiBFcnJvcikgcmV0dXJuIHRydW5jYXRlKGAke3ZhbHVlLm5hbWV9OiAke3ZhbHVlLm1lc3NhZ2V9YCk7XG4gIHRyeSB7XG4gICAgcmV0dXJuIHRydW5jYXRlKEpTT04uc3RyaW5naWZ5KHZhbHVlKSA/PyBTdHJpbmcodmFsdWUpKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIFN0cmluZyh2YWx1ZSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gdHJ1bmNhdGUodGV4dDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHRleHQubGVuZ3RoIDw9IEFSR19NQVhfQ0hBUlMgPyB0ZXh0IDogYCR7dGV4dC5zbGljZSgwLCBBUkdfTUFYX0NIQVJTIC0gMSl9XHUyMDI2YDtcbn1cblxuLy8gLS0tIHByb3RvY29sIHJvdW5kLXRyaXAgbG9nZ2luZyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIENvbXBhY3QsIGxvdy12b2x1bWUgZGVzY3JpcHRpb24gb2YgYSB3aXJlIGZyYW1lICh0eXBlICsgaWRlbnRpdHkga2V5cykuICovXG5leHBvcnQgZnVuY3Rpb24gZGVzY3JpYmVNZXNzYWdlKG1lc3NhZ2U6IHtcbiAgdHlwZTogc3RyaW5nO1xuICBwYXRoPzogc3RyaW5nO1xuICBoYXNoPzogc3RyaW5nO1xuICBmcm9tUGF0aD86IHN0cmluZztcbiAgY3Vyc29yPzogbnVtYmVyO1xuICBzZXE/OiBudW1iZXI7XG59KTogc3RyaW5nIHtcbiAgY29uc3QgYml0cyA9IFttZXNzYWdlLnR5cGVdO1xuICBpZiAobWVzc2FnZS5mcm9tUGF0aCAhPT0gdW5kZWZpbmVkKSBiaXRzLnB1c2goYCR7bWVzc2FnZS5mcm9tUGF0aH0gXHUyMTkyYCk7XG4gIGlmIChtZXNzYWdlLnBhdGggIT09IHVuZGVmaW5lZCkgYml0cy5wdXNoKG1lc3NhZ2UucGF0aCk7XG4gIGlmIChtZXNzYWdlLmhhc2ggIT09IHVuZGVmaW5lZCkgYml0cy5wdXNoKG1lc3NhZ2UuaGFzaC5zbGljZSgwLCAxMikpO1xuICBpZiAobWVzc2FnZS5zZXEgIT09IHVuZGVmaW5lZCkgYml0cy5wdXNoKGBzZXEgJHttZXNzYWdlLnNlcX1gKTtcbiAgaWYgKG1lc3NhZ2UuY3Vyc29yICE9PSB1bmRlZmluZWQpIGJpdHMucHVzaChgY3Vyc29yICR7bWVzc2FnZS5jdXJzb3J9YCk7XG4gIHJldHVybiBiaXRzLmpvaW4oJyAnKTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBSb3VuZFRyaXBMb2dnaW5nT3B0aW9ucyB7XG4gIGxvZzogTG9nQWRhcHRlcjtcbiAgLyoqIENoZWFwIHByZS1jaGVjayBzbyB0aGUgc3RyaW5nIGJ1aWxkaW5nIGlzIHNraXBwZWQgdW5sZXNzIGRlYnVnIGlzIG9uLiAqL1xuICBzaG91bGRMb2c6ICgpID0+IGJvb2xlYW47XG59XG5cbi8qKlxuICogV3JhcCBhIGBUcmFuc3BvcnRgIHNvIGV2ZXJ5IHNlbnQvcmVjZWl2ZWQgZnJhbWUgaXMgbG9nZ2VkIGF0IGRlYnVnIGxldmVsIFx1MjAxNFxuICogb25lIHNob3J0IGxpbmUgcGVyIGZyYW1lIChgZGVzY3JpYmVNZXNzYWdlYCksIG5vdGhpbmcgYXQgb3RoZXIgbGV2ZWxzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gd2l0aFJvdW5kVHJpcExvZ2dpbmcoXG4gIHRyYW5zcG9ydDogVHJhbnNwb3J0LFxuICBvcHRpb25zOiBSb3VuZFRyaXBMb2dnaW5nT3B0aW9ucyxcbik6IFRyYW5zcG9ydCB7XG4gIGNvbnN0IHsgbG9nLCBzaG91bGRMb2cgfSA9IG9wdGlvbnM7XG4gIHJldHVybiB7XG4gICAgc2VuZDogKG1lc3NhZ2UpID0+IHtcbiAgICAgIGlmIChzaG91bGRMb2coKSkgbG9nLmRlYnVnKCdcdTIxOTInLCBkZXNjcmliZU1lc3NhZ2UobWVzc2FnZSkpO1xuICAgICAgdHJhbnNwb3J0LnNlbmQobWVzc2FnZSk7XG4gICAgfSxcbiAgICBvbk1lc3NhZ2U6IChjYWxsYmFjaykgPT4ge1xuICAgICAgdHJhbnNwb3J0Lm9uTWVzc2FnZSgobWVzc2FnZSkgPT4ge1xuICAgICAgICBpZiAoc2hvdWxkTG9nKCkpIGxvZy5kZWJ1ZygnXHUyMTkwJywgZGVzY3JpYmVNZXNzYWdlKG1lc3NhZ2UpKTtcbiAgICAgICAgY2FsbGJhY2sobWVzc2FnZSk7XG4gICAgICB9KTtcbiAgICB9LFxuICAgIG9uQ2xvc2U6IChjYWxsYmFjaykgPT4gdHJhbnNwb3J0Lm9uQ2xvc2UoY2FsbGJhY2spLFxuICAgIGNsb3NlOiAoKSA9PiB0cmFuc3BvcnQuY2xvc2UoKSxcbiAgfTtcbn1cblxuLy8gLS0tIHRoZSBidW5kbGUgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBEaWFnbm9zdGljc0lucHV0IHtcbiAgcGx1Z2luVmVyc2lvbjogc3RyaW5nO1xuICBkZXZpY2VJZDogc3RyaW5nO1xuICBkZXZpY2VOYW1lOiBzdHJpbmc7XG4gIHdvcmtlclVybDogc3RyaW5nO1xuICBwYWlyZWQ6IGJvb2xlYW47XG4gIHBhdXNlZDogYm9vbGVhbjtcbiAgY2xpZW50U3RhdHVzOiBTeW5jQ2xpZW50U3RhdHVzIHwgbnVsbDtcbiAgcmVjZW50TG9nTGluZXM6IHJlYWRvbmx5IHN0cmluZ1tdO1xufVxuXG4vKiogVGhlIHByb3RvY29sIHZlcnNpb24gZnJvbSBjb3JlLCBzdXJmYWNlZCBmb3IgdGhlIGJ1bmRsZS9BYm91dCBzZWN0aW9uLiAqL1xuZXhwb3J0IGNvbnN0IFBST1RPQ09MX1ZFUlNJT04gPSBQcm90b2NvbFZlcnNpb247XG5cbi8qKiBUaGUgY29weWFibGUgZGlhZ25vc3RpY3MgYnVuZGxlIChwbGFpbiB0ZXh0LCBidWctcmVwb3J0IGZyaWVuZGx5KS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZERpYWdub3N0aWNzQnVuZGxlKGlucHV0OiBEaWFnbm9zdGljc0lucHV0KTogc3RyaW5nIHtcbiAgY29uc3Qgc3RhdHVzID0gaW5wdXQuY2xpZW50U3RhdHVzO1xuICBjb25zdCBsaW5lczogc3RyaW5nW10gPSBbXG4gICAgJ1ZhdWx0U3luYyBmb3IgQWdlbnRzIFx1MjAxNCBkaWFnbm9zdGljcycsXG4gICAgYFBsdWdpbiB2ZXJzaW9uOiAke2lucHV0LnBsdWdpblZlcnNpb259YCxcbiAgICBgUHJvdG9jb2wgdmVyc2lvbjogJHtQcm90b2NvbFZlcnNpb259YCxcbiAgICBgRGV2aWNlOiAke2lucHV0LmRldmljZUlkIHx8ICcodW5hc3NpZ25lZCknfSR7aW5wdXQuZGV2aWNlTmFtZSA/IGAgKCR7aW5wdXQuZGV2aWNlTmFtZX0pYCA6ICcnfWAsXG4gICAgYFdvcmtlcjogJHtpbnB1dC53b3JrZXJVcmwgfHwgJyhub3QgY29uZmlndXJlZCknfWAsXG4gICAgYFBhaXJpbmc6ICR7aW5wdXQucGFpcmVkID8gJ3BhaXJlZCcgOiAnbm90IHBhaXJlZCd9YCxcbiAgICBpbnB1dC5wYXVzZWRcbiAgICAgID8gJ1N5bmM6IHBhdXNlZCdcbiAgICAgIDogc3RhdHVzID09PSBudWxsXG4gICAgICAgID8gJ1N5bmM6IG5vdCBydW5uaW5nJ1xuICAgICAgICA6IGBTeW5jOiAke3N0YXR1cy5zdGF0ZX0sIGxhc3Qgc3luYyAke1xuICAgICAgICAgICAgc3RhdHVzLmxhc3RTeW5jQXQgPT09IG51bGwgPyAnbmV2ZXInIDogYCR7TWF0aC5tYXgoMCwgRGF0ZS5ub3coKSAtIHN0YXR1cy5sYXN0U3luY0F0KX1tcyBhZ29gXG4gICAgICAgICAgfSwgcGVuZGluZyAke3N0YXR1cy5wZW5kaW5nfSwgY29uZmxpY3RzICR7c3RhdHVzLmNvbmZsaWN0cy5sZW5ndGh9YCxcbiAgICBgUGxhdGZvcm06ICR7cGxhdGZvcm1TdW1tYXJ5KCl9YCxcbiAgICBgUmVjZW50IGxvZyAobGFzdCAke2lucHV0LnJlY2VudExvZ0xpbmVzLmxlbmd0aH0gbGluZXMpOmAsXG4gIF07XG4gIGlmIChpbnB1dC5yZWNlbnRMb2dMaW5lcy5sZW5ndGggPT09IDApIHtcbiAgICBsaW5lcy5wdXNoKCcgIChubyByZWNvcmRlZCBsb2cgbGluZXMpJyk7XG4gIH0gZWxzZSB7XG4gICAgZm9yIChjb25zdCBsaW5lIG9mIGlucHV0LnJlY2VudExvZ0xpbmVzKSBsaW5lcy5wdXNoKGAgICR7bGluZX1gKTtcbiAgfVxuICByZXR1cm4gbGluZXMuam9pbignXFxuJyk7XG59XG5cbi8qKiBIdW1hbiBwbGF0Zm9ybSBzdW1tYXJ5IGZyb20gYFBsYXRmb3JtYCAobW9iaWxlIHZzIGRlc2t0b3AsIE9TLCBmb3JtIGZhY3RvcikuICovXG5leHBvcnQgZnVuY3Rpb24gcGxhdGZvcm1TdW1tYXJ5KCk6IHN0cmluZyB7XG4gIGlmIChQbGF0Zm9ybS5pc01vYmlsZUFwcCkge1xuICAgIGNvbnN0IG9zID0gUGxhdGZvcm0uaXNJb3NBcHAgPyAnaU9TJyA6IFBsYXRmb3JtLmlzQW5kcm9pZEFwcCA/ICdBbmRyb2lkJyA6ICd1bmtub3duIE9TJztcbiAgICBjb25zdCBmYWN0b3IgPSBQbGF0Zm9ybS5pc1RhYmxldCA/ICd0YWJsZXQnIDogUGxhdGZvcm0uaXNQaG9uZSA/ICdwaG9uZScgOiAnZGV2aWNlJztcbiAgICByZXR1cm4gYE9ic2lkaWFuIG1vYmlsZSBhcHAgKCR7b3N9LCAke2ZhY3Rvcn0pYDtcbiAgfVxuICByZXR1cm4gJ09ic2lkaWFuIGRlc2t0b3AgYXBwJztcbn1cblxuLyoqIEJlc3QtZWZmb3J0IGNsaXBib2FyZCB3cml0ZTsgcmVzb2x2ZXMgZmFsc2Ugd2hlcmUgdGhlIGNsaXBib2FyZCBpcyB1bmF2YWlsYWJsZS4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjb3B5VG9DbGlwYm9hcmQodGV4dDogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XG4gIGNvbnN0IGNsaXBib2FyZCA9IChnbG9iYWxUaGlzIGFzIHsgbmF2aWdhdG9yPzogeyBjbGlwYm9hcmQ/OiB7IHdyaXRlVGV4dD8odDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB9IH0gfSlcbiAgICAubmF2aWdhdG9yPy5jbGlwYm9hcmQ7XG4gIGlmIChjbGlwYm9hcmQ/LndyaXRlVGV4dCA9PT0gdW5kZWZpbmVkKSByZXR1cm4gZmFsc2U7XG4gIHRyeSB7XG4gICAgYXdhaXQgY2xpcGJvYXJkLndyaXRlVGV4dCh0ZXh0KTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbi8qKiBCeXRlcyBcdTIxOTIgaHVtYW4gdGV4dCAoYDczMCBCYCwgYDEuMiBNQmApLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdEJ5dGVzKGJ5dGVzOiBudW1iZXIpOiBzdHJpbmcge1xuICBpZiAoYnl0ZXMgPCAxMDI0KSByZXR1cm4gYCR7Ynl0ZXN9IEJgO1xuICBjb25zdCB1bml0cyA9IFsnS0InLCAnTUInLCAnR0InLCAnVEInXTtcbiAgbGV0IHZhbHVlID0gYnl0ZXM7XG4gIGxldCB1bml0ID0gLTE7XG4gIGRvIHtcbiAgICB2YWx1ZSAvPSAxMDI0O1xuICAgIHVuaXQgKz0gMTtcbiAgfSB3aGlsZSAodmFsdWUgPj0gMTAyNCAmJiB1bml0IDwgdW5pdHMubGVuZ3RoIC0gMSk7XG4gIHJldHVybiBgJHt2YWx1ZSA+PSAxMDAgPyBNYXRoLnJvdW5kKHZhbHVlKSA6IHZhbHVlLnRvRml4ZWQoMSl9ICR7dW5pdHNbdW5pdF19YDtcbn1cbiIsICIvKipcbiAqIFRoZSBwbHVnaW4ncyBwZXJzaXN0ZWQgc3RhdGUgKGBkYXRhLmpzb25gLCB2aWEgYFBsdWdpbi5sb2FkRGF0YS9zYXZlRGF0YWApLlxuICpcbiAqIEtlcHQgZGVsaWJlcmF0ZWx5IHNtYWxsOiBsaW5rIGlkZW50aXR5ICh1cmwvdG9rZW4vZGV2aWNlSWQvZGV2aWNlTmFtZSkgcGx1c1xuICogdGhlIHR3byBjbGllbnQtc2lkZSB0b2dnbGVzLiBUaGUgdG9rZW4gaXMgdGhlIGRldmljZSdzIGxvbmctbGl2ZWRcbiAqIGNyZWRlbnRpYWwgKEFSQ0hJVEVDVFVSRSBcdTAwQTczKSBcdTIwMTQgT2JzaWRpYW4gc3RvcmVzIGRhdGEuanNvbiBpbnNpZGUgdGhlIHZhdWx0J3NcbiAqIGAub2JzaWRpYW4vcGx1Z2lucy9gIGRpciwgd2hpY2ggc3luYyBleGNsdWRlcywgc28gaXQgbmV2ZXIgbGVhdmVzIHRoZVxuICogbWFjaGluZSB0aHJvdWdoIHN5bmMgaXRzZWxmLlxuICovXG5cbmltcG9ydCB7IFBsYXRmb3JtIH0gZnJvbSAnb2JzaWRpYW4nO1xuaW1wb3J0IHR5cGUgeyBTdGF0dXNCYXJNb2RlIH0gZnJvbSAnLi9zdGF0dXNiYXIuanMnO1xuXG4vKiogRGlhZ25vc3RpY3MgbG9nIGxldmVsICh0aGUgXCJEaWFnbm9zdGljc1wiIHNldHRpbmdzIGRyb3Bkb3duKS4gKi9cbmV4cG9ydCB0eXBlIExvZ0xldmVsID0gJ2luZm8nIHwgJ2RlYnVnJyB8ICd3YXJuJztcblxuLyoqIENsaWVudC1zaWRlIHN5bmMgYmVoYXZpb3Igc2V0dGluZ3MgKHRoZSBzZXR0aW5ncy10YWIgdG9nZ2xlcykuICovXG5leHBvcnQgaW50ZXJmYWNlIFBsdWdpblN5bmNTZXR0aW5ncyB7XG4gIC8qKlxuICAgKiBQZXJpb2RpYyBmdWxsLXJlc2NhbiBpbnRlcnZhbCBpbiBzZWNvbmRzIChBUkNISVRFQ1RVUkUgXHUwMEE3OCBtb2JpbGUgL1xuICAgKiBleHRlcm5hbCBlZGl0cykuIGAwYCBkaXNhYmxlcyB0aGUgdGltZXIgXHUyMDE0IHZhdWx0IGV2ZW50cyBhbmQgYXBwLW9wZW5cbiAgICogcmVjb25jaWxpYXRpb24gc3RpbGwgcnVuLlxuICAgKi9cbiAgcmVzY2FuSW50ZXJ2YWxTZWM6IG51bWJlcjtcbiAgLyoqXG4gICAqIE9wdCBpbiB0byBzeW5jaW5nIGAub2JzaWRpYW4vYCAoRlItMTEpLiBUaGlzIGlzIHRoZSBjbGllbnQtc2lkZSBpbml0aWFsXG4gICAqIGlnbm9yZSBzZXR0aW5nOyB0aGUgd29ya2VyJ3MgcGVyLXZhdWx0IGBWYXVsdFNldHRpbmdzLm9ic2lkaWFuU3luY2BcbiAgICogKGRlbGl2ZXJlZCBpbiBgaGVsbG9BY2tgKSBzdXBlcnNlZGVzIGl0IG9uY2UgY29ubmVjdGVkLlxuICAgKi9cbiAgb2JzaWRpYW5TeW5jOiBib29sZWFuO1xuICAvKiogU3RhdHVzLWJhciBpbmRpY2F0b3I6IGZ1bGwgdGV4dCwgYSBjb21wYWN0IHN5bWJvbCwgb3Igbm8gaXRlbSBhdCBhbGwuICovXG4gIHN0YXR1c0Jhck1vZGU6IFN0YXR1c0Jhck1vZGU7XG4gIC8qKlxuICAgKiBTdGFydCBzeW5jaW5nIHdoZW4gT2JzaWRpYW4gbG9hZHMgKGRlZmF1bHQpLiBPRkYgPSBtYW51YWwtb25seSBtb2RlOiB0aGVcbiAgICogcGx1Z2luIGxvYWRzIGlkbGUgYW5kIHRoZSBmaXJzdCBcIlN5bmMgbm93XCIgc3RhcnRzIGl0LlxuICAgKi9cbiAgc3luY09uU3RhcnR1cDogYm9vbGVhbjtcbiAgLyoqIERpYWdub3N0aWNzIGxvZyBsZXZlbDsgYGRlYnVnYCBhbHNvIGxvZ3MgcHJvdG9jb2wgcm91bmQtdHJpcHMuICovXG4gIGxvZ0xldmVsOiBMb2dMZXZlbDtcbiAgLyoqIFJhdyBpZ25vcmUtcGF0dGVybiB0ZXh0LCBvbmUgcGF0dGVybiBwZXIgbGluZSAoc2VlIGBwYXJzZUlnbm9yZVBhdHRlcm5zYCkuICovXG4gIGlnbm9yZVBhdHRlcm5zOiBzdHJpbmc7XG59XG5cbi8qKiBTaGFwZSBvZiB0aGUgcGx1Z2luJ3MgYGRhdGEuanNvbmAuICovXG5leHBvcnQgaW50ZXJmYWNlIFZhdWx0U3luY1BsdWdpbkRhdGEge1xuICAvKiogV29ya2VyIG9yaWdpbiwgZS5nLiBgaHR0cHM6Ly9wZXJzb25hbC54LndvcmtlcnMuZGV2YCAoZW1wdHkgcHJlLXBhaXIpLiAqL1xuICB1cmw6IHN0cmluZztcbiAgLyoqIExvbmctbGl2ZWQgZGV2aWNlIHRva2VuIChlbXB0eSBwcmUtcGFpcikuICovXG4gIHRva2VuOiBzdHJpbmc7XG4gIC8qKiBEZXZpY2UgaWQgYXNzaWduZWQgYnkgdGhlIHdvcmtlciBhdCBwYWlyIHRpbWUuICovXG4gIGRldmljZUlkOiBzdHJpbmc7XG4gIC8qKiBIdW1hbi1yZWFkYWJsZSBkZXZpY2UgbmFtZSBzaG93biBpbiB0aGUgZGFzaGJvYXJkJ3MgZGV2aWNlIGxpc3QuICovXG4gIGRldmljZU5hbWU6IHN0cmluZztcbiAgc2V0dGluZ3M6IFBsdWdpblN5bmNTZXR0aW5ncztcbn1cblxuZXhwb3J0IGNvbnN0IERFRkFVTFRfUkVTQ0FOX0lOVEVSVkFMX1NFQyA9IDMwO1xuXG4vKiogQ2hvaWNlcyBvZmZlcmVkIGJ5IHRoZSBzZXR0aW5ncyBkcm9wZG93bjogc2Vjb25kcyBcdTIxOTIgbGFiZWwuICovXG5leHBvcnQgY29uc3QgUkVTQ0FOX0lOVEVSVkFMX0NIT0lDRVM6IFJlYWRvbmx5QXJyYXk8eyB2YWx1ZTogbnVtYmVyOyBsYWJlbDogc3RyaW5nIH0+ID0gW1xuICB7IHZhbHVlOiAxMCwgbGFiZWw6ICdFdmVyeSAxMCBzZWNvbmRzJyB9LFxuICB7IHZhbHVlOiAzMCwgbGFiZWw6ICdFdmVyeSAzMCBzZWNvbmRzJyB9LFxuICB7IHZhbHVlOiA2MCwgbGFiZWw6ICdFdmVyeSBtaW51dGUnIH0sXG4gIHsgdmFsdWU6IDMwMCwgbGFiZWw6ICdFdmVyeSA1IG1pbnV0ZXMnIH0sXG4gIHsgdmFsdWU6IDAsIGxhYmVsOiAnT2ZmICh2YXVsdCBldmVudHMgb25seSknIH0sXG5dO1xuXG5leHBvcnQgZnVuY3Rpb24gZGVmYXVsdFBsdWdpbkRhdGEoKTogVmF1bHRTeW5jUGx1Z2luRGF0YSB7XG4gIHJldHVybiB7XG4gICAgdXJsOiAnJyxcbiAgICB0b2tlbjogJycsXG4gICAgZGV2aWNlSWQ6ICcnLFxuICAgIGRldmljZU5hbWU6ICcnLFxuICAgIHNldHRpbmdzOiB7XG4gICAgICByZXNjYW5JbnRlcnZhbFNlYzogREVGQVVMVF9SRVNDQU5fSU5URVJWQUxfU0VDLFxuICAgICAgb2JzaWRpYW5TeW5jOiBmYWxzZSxcbiAgICAgIHN0YXR1c0Jhck1vZGU6ICdkZXRhaWxlZCcsXG4gICAgICBzeW5jT25TdGFydHVwOiB0cnVlLFxuICAgICAgbG9nTGV2ZWw6ICdpbmZvJyxcbiAgICAgIGlnbm9yZVBhdHRlcm5zOiAnJyxcbiAgICB9LFxuICB9O1xufVxuXG4vKiogQ29lcmNlIHdoYXRldmVyIGBsb2FkRGF0YSgpYCByZXR1cm5lZCBpbnRvIGEgd2VsbC1mb3JtZWQgb2JqZWN0LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZVBsdWdpbkRhdGEocmF3OiB1bmtub3duKTogVmF1bHRTeW5jUGx1Z2luRGF0YSB7XG4gIGNvbnN0IGJhc2UgPSBkZWZhdWx0UGx1Z2luRGF0YSgpO1xuICBpZiAodHlwZW9mIHJhdyAhPT0gJ29iamVjdCcgfHwgcmF3ID09PSBudWxsKSByZXR1cm4gYmFzZTtcbiAgY29uc3Qgc291cmNlID0gcmF3IGFzIFBhcnRpYWw8VmF1bHRTeW5jUGx1Z2luRGF0YT4gJiB7IHNldHRpbmdzPzogUGFydGlhbDxQbHVnaW5TeW5jU2V0dGluZ3M+IH07XG4gIGNvbnN0IHN0YXR1c0Jhck1vZGUgPSBzb3VyY2Uuc2V0dGluZ3M/LnN0YXR1c0Jhck1vZGU7XG4gIGNvbnN0IGxvZ0xldmVsID0gc291cmNlLnNldHRpbmdzPy5sb2dMZXZlbDtcbiAgcmV0dXJuIHtcbiAgICB1cmw6IHR5cGVvZiBzb3VyY2UudXJsID09PSAnc3RyaW5nJyA/IHNvdXJjZS51cmwgOiAnJyxcbiAgICB0b2tlbjogdHlwZW9mIHNvdXJjZS50b2tlbiA9PT0gJ3N0cmluZycgPyBzb3VyY2UudG9rZW4gOiAnJyxcbiAgICBkZXZpY2VJZDogdHlwZW9mIHNvdXJjZS5kZXZpY2VJZCA9PT0gJ3N0cmluZycgPyBzb3VyY2UuZGV2aWNlSWQgOiAnJyxcbiAgICBkZXZpY2VOYW1lOiB0eXBlb2Ygc291cmNlLmRldmljZU5hbWUgPT09ICdzdHJpbmcnID8gc291cmNlLmRldmljZU5hbWUgOiAnJyxcbiAgICBzZXR0aW5nczoge1xuICAgICAgcmVzY2FuSW50ZXJ2YWxTZWM6XG4gICAgICAgIHR5cGVvZiBzb3VyY2Uuc2V0dGluZ3M/LnJlc2NhbkludGVydmFsU2VjID09PSAnbnVtYmVyJyAmJiBzb3VyY2Uuc2V0dGluZ3MucmVzY2FuSW50ZXJ2YWxTZWMgPj0gMFxuICAgICAgICAgID8gTWF0aC5mbG9vcihzb3VyY2Uuc2V0dGluZ3MucmVzY2FuSW50ZXJ2YWxTZWMpXG4gICAgICAgICAgOiBERUZBVUxUX1JFU0NBTl9JTlRFUlZBTF9TRUMsXG4gICAgICBvYnNpZGlhblN5bmM6IHNvdXJjZS5zZXR0aW5ncz8ub2JzaWRpYW5TeW5jID09PSB0cnVlLFxuICAgICAgc3RhdHVzQmFyTW9kZTpcbiAgICAgICAgc3RhdHVzQmFyTW9kZSA9PT0gJ2NvbXBhY3QnIHx8IHN0YXR1c0Jhck1vZGUgPT09ICdoaWRkZW4nID8gc3RhdHVzQmFyTW9kZSA6ICdkZXRhaWxlZCcsXG4gICAgICBzeW5jT25TdGFydHVwOiBzb3VyY2Uuc2V0dGluZ3M/LnN5bmNPblN0YXJ0dXAgIT09IGZhbHNlLFxuICAgICAgbG9nTGV2ZWw6IGxvZ0xldmVsID09PSAnZGVidWcnIHx8IGxvZ0xldmVsID09PSAnd2FybicgPyBsb2dMZXZlbCA6ICdpbmZvJyxcbiAgICAgIGlnbm9yZVBhdHRlcm5zOiB0eXBlb2Ygc291cmNlLnNldHRpbmdzPy5pZ25vcmVQYXR0ZXJucyA9PT0gJ3N0cmluZycgPyBzb3VyY2Uuc2V0dGluZ3MuaWdub3JlUGF0dGVybnMgOiAnJyxcbiAgICB9LFxuICB9O1xufVxuXG4vKipcbiAqIElnbm9yZS1wYXR0ZXJuIHRleHQgXHUyMTkyIHBhdHRlcm4gbGlzdDogb25lIHBhdHRlcm4gcGVyIGxpbmUsIHRyaW1tZWQsIGJsYW5rXG4gKiBsaW5lcyBkcm9wcGVkLiBQdXJlIFx1MjAxNCBzYWZlIHRvIGNhbGwgb24gZXZlcnkgYHN0YXJ0U3luY2AuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUlnbm9yZVBhdHRlcm5zKHRleHQ6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgcmV0dXJuIHRleHRcbiAgICAuc3BsaXQoL1xccj9cXG4vKVxuICAgIC5tYXAoKGxpbmUpID0+IGxpbmUudHJpbSgpKVxuICAgIC5maWx0ZXIoKGxpbmUpID0+IGxpbmUgIT09ICcnKTtcbn1cblxuLyoqIEEgdmF1bHQgaXMgbGlua2VkIGlmZiBwYWlyIGlkZW50aXR5IGlzIGNvbXBsZXRlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzTGlua2VkKGRhdGE6IFZhdWx0U3luY1BsdWdpbkRhdGEpOiBib29sZWFuIHtcbiAgcmV0dXJuIGRhdGEudXJsICE9PSAnJyAmJiBkYXRhLnRva2VuICE9PSAnJyAmJiBkYXRhLmRldmljZUlkICE9PSAnJztcbn1cblxuLyoqIERldmljZSB0eXBlIGZvciB0aGUgd29ya2VyIHJlZ2lzdHJ5LCBmcm9tIHRoZSBwbGF0Zm9ybSAoRlItMjMpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRldGVjdERldmljZVR5cGUoKTogJ2Rlc2t0b3AnIHwgJ21vYmlsZScge1xuICByZXR1cm4gUGxhdGZvcm0uaXNNb2JpbGVBcHAgPyAnbW9iaWxlJyA6ICdkZXNrdG9wJztcbn1cblxuLyoqIERlZmF1bHQgZGV2aWNlIG5hbWUgd2hlbiB0aGUgdXNlciBoYXMgbm90IHR5cGVkIG9uZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkZWZhdWx0RGV2aWNlTmFtZSgpOiBzdHJpbmcge1xuICBpZiAoUGxhdGZvcm0uaXNNb2JpbGVBcHApIHtcbiAgICBpZiAoUGxhdGZvcm0uaXNJb3NBcHApIHJldHVybiAnaVBob25lL2lQYWQnO1xuICAgIGlmIChQbGF0Zm9ybS5pc0FuZHJvaWRBcHApIHJldHVybiAnQW5kcm9pZCc7XG4gICAgcmV0dXJuICdPYnNpZGlhbiBtb2JpbGUnO1xuICB9XG4gIHJldHVybiAnT2JzaWRpYW4gZGVza3RvcCc7XG59XG4iLCAiLyoqXG4gKiBNaW5pbWFsIHR5cGVkIGNsaWVudCBmb3IgdGhlIHdvcmtlcidzIEhUVFAgc3VyZmFjZSBhcyB0aGUgcGx1Z2luIHVzZXMgaXQ6XG4gKiBgR0VUIC9oZWFsdGhgIChjbGFpbS1zdGF0ZSBwcm9iZSBiZWZvcmUgcGFpcmluZyksIGBQT1NUIC9wYWlyYCAocmVkZWVtIGFcbiAqIHBhaXJpbmcgY29kZSwgQVJDSElURUNUVVJFIFx1MDBBNzMpLCBgUEFUQ0ggL2RldmljZWAgKGRldmljZSBzZWxmLXNlcnZpY2VcbiAqIHJlbmFtZSksIGFuZCBgR0VUIC9hcGkvc3RhdHVzYCAoc3RvcmFnZS9kZXZpY2Ugc3VtbWFyeSBmb3IgQWJvdXQpLiBCdWlsdFxuICogb24gYW4gaW5qZWN0YWJsZSBgZmV0Y2hgOyBmYWlsdXJlcyBtYXAgdG8gdHlwZWQgZXJyb3JzIHdpdGggYWN0aW9uYWJsZVxuICogbWVzc2FnZXMgc28gdGhlIHNldHRpbmdzIFVJIGFuZCB0aGUgZGVlcC1saW5rIGhhbmRsZXIgbmV2ZXIgc2VlIGEgcmF3XG4gKiBgVHlwZUVycm9yOiBGYWlsZWQgdG8gZmV0Y2hgLlxuICovXG5cbi8qKiBBIHdvcmtlciBjYWxsIGZhaWxlZCAodW5yZWFjaGFibGUgb3IgdW5leHBlY3RlZCBIVFRQKS4gKi9cbmV4cG9ydCBjbGFzcyBXb3JrZXJBcGlFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgY29uc3RydWN0b3IoXG4gICAgbWVzc2FnZTogc3RyaW5nLFxuICAgIHJlYWRvbmx5IHN0YXR1cz86IG51bWJlcixcbiAgKSB7XG4gICAgc3VwZXIobWVzc2FnZSk7XG4gICAgdGhpcy5uYW1lID0gJ1dvcmtlckFwaUVycm9yJztcbiAgfVxufVxuXG4vKiogVGhlIHBhaXJpbmcgY29kZSB3YXMgcmVqZWN0ZWQgKGludmFsaWQgLyBleHBpcmVkIC8gYWxyZWFkeSB1c2VkKS4gKi9cbmV4cG9ydCBjbGFzcyBQYWlyUmVqZWN0ZWRFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgY29uc3RydWN0b3IobWVzc2FnZTogc3RyaW5nKSB7XG4gICAgc3VwZXIobWVzc2FnZSk7XG4gICAgdGhpcy5uYW1lID0gJ1BhaXJSZWplY3RlZEVycm9yJztcbiAgfVxufVxuXG4vKiogVGhlIHdvcmtlciBleGlzdHMgYnV0IGhhcyBub3QgYmVlbiBjbGFpbWVkIHlldCAoSFRUUCA0MjEgc2VtYW50aWNzKS4gKi9cbmV4cG9ydCBjbGFzcyBVbmNsYWltZWRXb3JrZXJFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgY29uc3RydWN0b3IobWVzc2FnZTogc3RyaW5nKSB7XG4gICAgc3VwZXIobWVzc2FnZSk7XG4gICAgdGhpcy5uYW1lID0gJ1VuY2xhaW1lZFdvcmtlckVycm9yJztcbiAgfVxufVxuXG5leHBvcnQgaW50ZXJmYWNlIEhlYWx0aEluZm8ge1xuICByZWFjaGFibGU6IGJvb2xlYW47XG4gIGNsYWltZWQ6IGJvb2xlYW47XG4gIC8qKiBIdW1hbi1yZWFkYWJsZSByZWFzb24gd2hlbiB0aGUgd29ya2VyIGNvdWxkIG5vdCBiZSByZWFjaGVkLiAqL1xuICByZWFzb24/OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUGFpckNyZWRlbnRpYWxzIHtcbiAgdG9rZW46IHN0cmluZztcbiAgZGV2aWNlSWQ6IHN0cmluZztcbn1cblxuLyoqXG4gKiBOb3JtYWxpemUgdXNlciBpbnB1dCBpbnRvIGEgd29ya2VyIG9yaWdpbjogdHJpbXMsIHRvbGVyYXRlcyBhIG1pc3NpbmdcbiAqIHNjaGVtZSAoYXNzdW1lcyBodHRwcyksIGEgdHJhaWxpbmcgc2xhc2gsIGFuZCBzdHJheSBwYXRoIGNvbXBvbmVudHM7XG4gKiByZXR1cm5zIGBodHRwczovL2hvc3RgIHN0eWxlIG9yaWdpbi4gVGhyb3dzIGBXb3JrZXJBcGlFcnJvcmAgb24gZ2FyYmFnZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZVdvcmtlclVybChpbnB1dDogc3RyaW5nKTogc3RyaW5nIHtcbiAgbGV0IGNhbmRpZGF0ZSA9IGlucHV0LnRyaW0oKTtcbiAgaWYgKGNhbmRpZGF0ZSA9PT0gJycpIHRocm93IG5ldyBXb3JrZXJBcGlFcnJvcignd29ya2VyIFVSTCBpcyBlbXB0eScpO1xuICBpZiAoIS9eW2EtekEtWl1bYS16QS1aMC05Ky4tXSo6XFwvXFwvLy50ZXN0KGNhbmRpZGF0ZSkpIGNhbmRpZGF0ZSA9IGBodHRwczovLyR7Y2FuZGlkYXRlfWA7XG4gIGxldCBvcmlnaW46IHN0cmluZztcbiAgdHJ5IHtcbiAgICBvcmlnaW4gPSBuZXcgVVJMKGNhbmRpZGF0ZSkub3JpZ2luO1xuICB9IGNhdGNoIHtcbiAgICB0aHJvdyBuZXcgV29ya2VyQXBpRXJyb3IoYGludmFsaWQgd29ya2VyIFVSTDogJHtKU09OLnN0cmluZ2lmeShpbnB1dCl9YCk7XG4gIH1cbiAgaWYgKCFvcmlnaW4uc3RhcnRzV2l0aCgnaHR0cDovLycpICYmICFvcmlnaW4uc3RhcnRzV2l0aCgnaHR0cHM6Ly8nKSkge1xuICAgIHRocm93IG5ldyBXb3JrZXJBcGlFcnJvcihgd29ya2VyIFVSTCBtdXN0IGJlIGh0dHAocyksIGdvdCAke29yaWdpbn1gKTtcbiAgfVxuICByZXR1cm4gb3JpZ2luO1xufVxuXG4vKiogR0VUIC9oZWFsdGggXHUyMDE0IG5ldmVyIHRocm93cyBmb3IgcmVhY2hhYmlsaXR5OyByZXBvcnRzIGNsYWltIHN0YXRlIGluc3RlYWQuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZmV0Y2hIZWFsdGgoXG4gIG9yaWdpbjogc3RyaW5nLFxuICBmZXRjaEltcGw6IHR5cGVvZiBmZXRjaCxcbik6IFByb21pc2U8SGVhbHRoSW5mbz4ge1xuICBsZXQgcmVzcG9uc2U6IFJlc3BvbnNlO1xuICB0cnkge1xuICAgIHJlc3BvbnNlID0gYXdhaXQgZmV0Y2hJbXBsKGAke29yaWdpbn0vaGVhbHRoYCk7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHJlYWNoYWJsZTogZmFsc2UsXG4gICAgICBjbGFpbWVkOiBmYWxzZSxcbiAgICAgIHJlYXNvbjogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpLFxuICAgIH07XG4gIH1cbiAgaWYgKCFyZXNwb25zZS5vaykge1xuICAgIHJldHVybiB7IHJlYWNoYWJsZTogZmFsc2UsIGNsYWltZWQ6IGZhbHNlLCByZWFzb246IGBIVFRQICR7cmVzcG9uc2Uuc3RhdHVzfWAgfTtcbiAgfVxuICBjb25zdCBib2R5ID0gKGF3YWl0IHJlc3BvbnNlLmpzb24oKS5jYXRjaCgoKSA9PiAoe30pKSkgYXMgeyBjbGFpbWVkPzogYm9vbGVhbiB9O1xuICByZXR1cm4geyByZWFjaGFibGU6IHRydWUsIGNsYWltZWQ6IGJvZHkuY2xhaW1lZCA9PT0gdHJ1ZSB9O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFBhaXJSZXF1ZXN0UGFyYW1zIHtcbiAgb3JpZ2luOiBzdHJpbmc7XG4gIGNvZGU6IHN0cmluZztcbiAgZGV2aWNlTmFtZTogc3RyaW5nO1xuICBkZXZpY2VUeXBlOiAnZGVza3RvcCcgfCAnbW9iaWxlJztcbiAgZmV0Y2hJbXBsOiB0eXBlb2YgZmV0Y2g7XG59XG5cbi8qKlxuICogUE9TVCAvcGFpciBcdTIwMTQgcmVkZWVtIGEgb25lLXRpbWUgcGFpcmluZyBjb2RlIGZvciBsb25nLWxpdmVkIGRldmljZVxuICogY3JlZGVudGlhbHMuIFRocm93cyBgUGFpclJlamVjdGVkRXJyb3JgIChiYWQgY29kZSksIGBVbmNsYWltZWRXb3JrZXJFcnJvcmBcbiAqICg0MjEpLCBvciBgV29ya2VyQXBpRXJyb3JgICh1bnJlYWNoYWJsZSAvIHVuZXhwZWN0ZWQpLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVxdWVzdFBhaXIocGFyYW1zOiBQYWlyUmVxdWVzdFBhcmFtcyk6IFByb21pc2U8UGFpckNyZWRlbnRpYWxzPiB7XG4gIGxldCByZXNwb25zZTogUmVzcG9uc2U7XG4gIHRyeSB7XG4gICAgcmVzcG9uc2UgPSBhd2FpdCBwYXJhbXMuZmV0Y2hJbXBsKGAke3BhcmFtcy5vcmlnaW59L3BhaXJgLCB7XG4gICAgICBtZXRob2Q6ICdQT1NUJyxcbiAgICAgIGhlYWRlcnM6IHsgJ2NvbnRlbnQtdHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyB9LFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBjb2RlOiBwYXJhbXMuY29kZSxcbiAgICAgICAgZGV2aWNlTmFtZTogcGFyYW1zLmRldmljZU5hbWUsXG4gICAgICAgIGRldmljZVR5cGU6IHBhcmFtcy5kZXZpY2VUeXBlLFxuICAgICAgfSksXG4gICAgfSk7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgdGhyb3cgbmV3IFdvcmtlckFwaUVycm9yKFxuICAgICAgYGNvdWxkIG5vdCByZWFjaCB0aGUgd29ya2VyIGF0ICR7cGFyYW1zLm9yaWdpbn06ICR7XG4gICAgICAgIGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKVxuICAgICAgfWAsXG4gICAgKTtcbiAgfVxuICAvLyBSZWFkIHRoZSBib2R5IG9uY2UgKGEgUmVzcG9uc2UgYm9keSBpcyBzaW5nbGUtdXNlKSBhbmQgcGFyc2UgZnJvbSB0ZXh0LlxuICBjb25zdCBkZXRhaWwgPSAoYXdhaXQgcmVzcG9uc2UudGV4dCgpLmNhdGNoKCgpID0+ICcnKSkudHJpbSgpO1xuICBpZiAocmVzcG9uc2Uuc3RhdHVzID09PSA0MjEpIHtcbiAgICB0aHJvdyBuZXcgVW5jbGFpbWVkV29ya2VyRXJyb3IoJ3RoaXMgd29ya2VyIGhhcyBub3QgYmVlbiBjbGFpbWVkIHlldCcpO1xuICB9XG4gIGlmIChyZXNwb25zZS5zdGF0dXMgPT09IDQwMSB8fCByZXNwb25zZS5zdGF0dXMgPT09IDQwMykge1xuICAgIHRocm93IG5ldyBQYWlyUmVqZWN0ZWRFcnJvcihcbiAgICAgICdwYWlyaW5nIGNvZGUgcmVqZWN0ZWQgXHUyMDE0IGNvZGVzIGFyZSBvbmUtdGltZSwgZXhwaXJlIGFmdGVyIDEwIG1pbnV0ZXMsIGFuZCBjb21lICcgK1xuICAgICAgICAnZnJvbSB0aGUgd29ya2VyIGRhc2hib2FyZC4gR2VuZXJhdGUgYSBmcmVzaCBvbmUgYW5kIHJldHJ5LicsXG4gICAgKTtcbiAgfVxuICBpZiAoIXJlc3BvbnNlLm9rKSB7XG4gICAgdGhyb3cgbmV3IFdvcmtlckFwaUVycm9yKFxuICAgICAgYHBhaXJpbmcgZmFpbGVkOiBIVFRQICR7cmVzcG9uc2Uuc3RhdHVzfSAke2RldGFpbC5zbGljZSgwLCAyMDApfWAudHJpbSgpLFxuICAgICAgcmVzcG9uc2Uuc3RhdHVzLFxuICAgICk7XG4gIH1cbiAgbGV0IGJvZHk6IHsgdG9rZW4/OiB1bmtub3duOyBkZXZpY2VJZD86IHVua25vd24gfTtcbiAgdHJ5IHtcbiAgICBib2R5ID0gSlNPTi5wYXJzZShkZXRhaWwpIGFzIHsgdG9rZW4/OiB1bmtub3duOyBkZXZpY2VJZD86IHVua25vd24gfTtcbiAgfSBjYXRjaCB7XG4gICAgdGhyb3cgbmV3IFdvcmtlckFwaUVycm9yKCdwYWlyaW5nIHJlcGx5IHdhcyBub3QgSlNPTicsIHJlc3BvbnNlLnN0YXR1cyk7XG4gIH1cbiAgaWYgKHR5cGVvZiBib2R5LnRva2VuICE9PSAnc3RyaW5nJyB8fCB0eXBlb2YgYm9keS5kZXZpY2VJZCAhPT0gJ3N0cmluZycpIHtcbiAgICB0aHJvdyBuZXcgV29ya2VyQXBpRXJyb3IoJ3BhaXJpbmcgcmVwbHkgd2FzIG1pc3NpbmcgdG9rZW4vZGV2aWNlSWQnLCByZXNwb25zZS5zdGF0dXMpO1xuICB9XG4gIHJldHVybiB7IHRva2VuOiBib2R5LnRva2VuLCBkZXZpY2VJZDogYm9keS5kZXZpY2VJZCB9O1xufVxuXG4vLyAtLS0gZGV2aWNlIHNlbGYtc2VydmljZSAoUEFUQ0ggL2RldmljZSkgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFRoZSBkZXZpY2UgZG9jdW1lbnQgdGhlIHdvcmtlciByZXR1cm5zIGZyb20gYFBBVENIIC9kZXZpY2VgLiAqL1xuZXhwb3J0IGludGVyZmFjZSBXb3JrZXJEZXZpY2Uge1xuICBpZDogc3RyaW5nO1xuICBuYW1lOiBzdHJpbmc7XG4gIHR5cGU6IHN0cmluZztcbn1cblxuZXhwb3J0IHR5cGUgUmVuYW1lT3V0Y29tZSA9XG4gIHwgeyBvazogdHJ1ZTsgZGV2aWNlOiBXb3JrZXJEZXZpY2UgfVxuICB8IHsgb2s6IGZhbHNlOyBlcnJvcjogc3RyaW5nIH07XG5cbmV4cG9ydCBpbnRlcmZhY2UgUmVuYW1lUGFyYW1zIHtcbiAgb3JpZ2luOiBzdHJpbmc7XG4gIC8qKiBUaGUgY2FsbGluZyBkZXZpY2UncyBvd24gdG9rZW4gXHUyMDE0IGl0IGNhbiBvbmx5IGV2ZXIgcmVuYW1lIGl0c2VsZi4gKi9cbiAgdG9rZW46IHN0cmluZztcbiAgbmFtZTogc3RyaW5nO1xuICBmZXRjaEltcGw6IHR5cGVvZiBmZXRjaDtcbn1cblxuLyoqXG4gKiBgUEFUQ0ggL2RldmljZWAgXHUyMDE0IHJlbmFtZSBUSElTIGRldmljZSBvbiB0aGUgd29ya2VyIChkZXZpY2UtdG9rZW5cbiAqIGF1dGhlbnRpY2F0ZWQ7IG5ldmVyIHRocm93czogZmFpbHVyZXMgY29tZSBiYWNrIGFzIGB7b2s6ZmFsc2UsIGVycm9yfWApLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVuYW1lRGV2aWNlKHBhcmFtczogUmVuYW1lUGFyYW1zKTogUHJvbWlzZTxSZW5hbWVPdXRjb21lPiB7XG4gIGxldCByZXNwb25zZTogUmVzcG9uc2U7XG4gIHRyeSB7XG4gICAgcmVzcG9uc2UgPSBhd2FpdCBwYXJhbXMuZmV0Y2hJbXBsKGAke3BhcmFtcy5vcmlnaW59L2RldmljZWAsIHtcbiAgICAgIG1ldGhvZDogJ1BBVENIJyxcbiAgICAgIGhlYWRlcnM6IHsgJ2NvbnRlbnQtdHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJywgYXV0aG9yaXphdGlvbjogYEJlYXJlciAke3BhcmFtcy50b2tlbn1gIH0sXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IG5hbWU6IHBhcmFtcy5uYW1lIH0pLFxuICAgIH0pO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIHJldHVybiB7XG4gICAgICBvazogZmFsc2UsXG4gICAgICBlcnJvcjogYGNvdWxkIG5vdCByZWFjaCB0aGUgd29ya2VyIGF0ICR7cGFyYW1zLm9yaWdpbn06ICR7XG4gICAgICAgIGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKVxuICAgICAgfWAsXG4gICAgfTtcbiAgfVxuICBjb25zdCBkZXRhaWwgPSAoYXdhaXQgcmVzcG9uc2UudGV4dCgpLmNhdGNoKCgpID0+ICcnKSkudHJpbSgpO1xuICBpZiAocmVzcG9uc2Uuc3RhdHVzID09PSA0MjEpIHtcbiAgICByZXR1cm4geyBvazogZmFsc2UsIGVycm9yOiAndGhpcyB3b3JrZXIgaGFzIG5vdCBiZWVuIGNsYWltZWQgeWV0JyB9O1xuICB9XG4gIGlmIChyZXNwb25zZS5zdGF0dXMgPT09IDQwMSB8fCByZXNwb25zZS5zdGF0dXMgPT09IDQwMykge1xuICAgIHJldHVybiB7XG4gICAgICBvazogZmFsc2UsXG4gICAgICBlcnJvcjogJ3RoZSB3b3JrZXIgcmVqZWN0ZWQgdGhpcyBkZXZpY2VcXHUyMDE5cyB0b2tlbiAocmV2b2tlZD8pIFx1MjAxNCB1bmxpbmsgYW5kIHJlLXBhaXIgd2l0aCBhIGZyZXNoIGNvZGUuJyxcbiAgICB9O1xuICB9XG4gIGlmICghcmVzcG9uc2Uub2spIHtcbiAgICBsZXQgcmVhc29uID0gYEhUVFAgJHtyZXNwb25zZS5zdGF0dXN9YDtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShkZXRhaWwpIGFzIHsgZXJyb3I/OiB1bmtub3duIH07XG4gICAgICBpZiAodHlwZW9mIHBhcnNlZC5lcnJvciA9PT0gJ3N0cmluZycpIHJlYXNvbiA9IHBhcnNlZC5lcnJvcjtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIGtlZXAgdGhlIGJhcmUgc3RhdHVzXG4gICAgfVxuICAgIHJldHVybiB7IG9rOiBmYWxzZSwgZXJyb3I6IHJlYXNvbiB9O1xuICB9XG4gIGxldCBib2R5OiB7IGRldmljZT86IHVua25vd24gfTtcbiAgdHJ5IHtcbiAgICBib2R5ID0gSlNPTi5wYXJzZShkZXRhaWwpIGFzIHsgZGV2aWNlPzogdW5rbm93biB9O1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4geyBvazogZmFsc2UsIGVycm9yOiAncmVuYW1lIHJlcGx5IHdhcyBub3QgSlNPTicgfTtcbiAgfVxuICBjb25zdCBkZXZpY2UgPSBib2R5LmRldmljZSBhcyBQYXJ0aWFsPFdvcmtlckRldmljZT4gfCB1bmRlZmluZWQ7XG4gIGlmIChcbiAgICB0eXBlb2YgZGV2aWNlPy5pZCAhPT0gJ3N0cmluZycgfHxcbiAgICB0eXBlb2YgZGV2aWNlLm5hbWUgIT09ICdzdHJpbmcnIHx8XG4gICAgdHlwZW9mIGRldmljZS50eXBlICE9PSAnc3RyaW5nJ1xuICApIHtcbiAgICByZXR1cm4geyBvazogZmFsc2UsIGVycm9yOiAncmVuYW1lIHJlcGx5IHdhcyBtaXNzaW5nIHRoZSBkZXZpY2UgZG9jdW1lbnQnIH07XG4gIH1cbiAgcmV0dXJuIHsgb2s6IHRydWUsIGRldmljZTogeyBpZDogZGV2aWNlLmlkLCBuYW1lOiBkZXZpY2UubmFtZSwgdHlwZTogZGV2aWNlLnR5cGUgfSB9O1xufVxuXG4vLyAtLS0gd29ya2VyIHN0YXR1cyAoR0VUIC9hcGkvc3RhdHVzLCBkZXZpY2UgdG9rZW4pIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBUaGUgc2xpY2Ugb2YgYC9hcGkvc3RhdHVzYCB0aGUgcGx1Z2luJ3MgQWJvdXQgc2VjdGlvbiBzaG93cy4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgV29ya2VyU3RhdHVzU3VtbWFyeSB7XG4gIHZhdWx0TmFtZTogc3RyaW5nO1xuICBkZXZpY2VzOiBBcnJheTx7IGlkOiBzdHJpbmc7IG5hbWU6IHN0cmluZzsgdHlwZTogc3RyaW5nOyBvbmxpbmU6IGJvb2xlYW47IHJldm9rZWQ6IGJvb2xlYW4gfT47XG4gIGF0dGFjaG1lbnRzOiB7IGNvdW50OiBudW1iZXI7IGJ5dGVzOiBudW1iZXIgfTtcbiAgc3RvcmFnZUJ5dGVzOiBudW1iZXI7XG59XG5cbi8qKlxuICogYEdFVCAvYXBpL3N0YXR1c2Agd2l0aCB0aGUgZGV2aWNlIHRva2VuIFx1MjAxNCBzdG9yYWdlIHVzYWdlICsgZGV2aWNlIGxpc3QgZm9yXG4gKiB0aGUgQWJvdXQgc2VjdGlvbi4gUmVzb2x2ZXMgYG51bGxgIG9uIGFueSBmYWlsdXJlIChBYm91dCBzaG93cyBcInVua25vd25cIikuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBmZXRjaFdvcmtlclN0YXR1cyhwYXJhbXM6IHtcbiAgb3JpZ2luOiBzdHJpbmc7XG4gIHRva2VuOiBzdHJpbmc7XG4gIGZldGNoSW1wbDogdHlwZW9mIGZldGNoO1xufSk6IFByb21pc2U8V29ya2VyU3RhdHVzU3VtbWFyeSB8IG51bGw+IHtcbiAgbGV0IHJlc3BvbnNlOiBSZXNwb25zZTtcbiAgdHJ5IHtcbiAgICByZXNwb25zZSA9IGF3YWl0IHBhcmFtcy5mZXRjaEltcGwoYCR7cGFyYW1zLm9yaWdpbn0vYXBpL3N0YXR1c2AsIHtcbiAgICAgIGhlYWRlcnM6IHsgYXV0aG9yaXphdGlvbjogYEJlYXJlciAke3BhcmFtcy50b2tlbn1gIH0sXG4gICAgfSk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBudWxsO1xuICB9XG4gIGlmICghcmVzcG9uc2Uub2spIHJldHVybiBudWxsO1xuICBjb25zdCBib2R5ID0gKGF3YWl0IHJlc3BvbnNlLmpzb24oKS5jYXRjaCgoKSA9PiBudWxsKSkgYXMgUGFydGlhbDxXb3JrZXJTdGF0dXNTdW1tYXJ5PiB8IG51bGw7XG4gIGlmIChib2R5ID09PSBudWxsIHx8IHR5cGVvZiBib2R5LnN0b3JhZ2VCeXRlcyAhPT0gJ251bWJlcicgfHwgdHlwZW9mIGJvZHkuYXR0YWNobWVudHMgIT09ICdvYmplY3QnKSB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbiAgcmV0dXJuIHtcbiAgICB2YXVsdE5hbWU6IHR5cGVvZiBib2R5LnZhdWx0TmFtZSA9PT0gJ3N0cmluZycgPyBib2R5LnZhdWx0TmFtZSA6ICcnLFxuICAgIGRldmljZXM6IEFycmF5LmlzQXJyYXkoYm9keS5kZXZpY2VzKSA/IGJvZHkuZGV2aWNlcyA6IFtdLFxuICAgIGF0dGFjaG1lbnRzOiBib2R5LmF0dGFjaG1lbnRzLFxuICAgIHN0b3JhZ2VCeXRlczogYm9keS5zdG9yYWdlQnl0ZXMsXG4gIH07XG59XG4iLCAiLyoqXG4gKiBUaGUgcGFpciBmbG93IHNoYXJlZCBieSB0aGUgc2V0dGluZ3MgZm9ybSBhbmQgdGhlIGBvYnNpZGlhbjovL2AgZGVlcCBsaW5rXG4gKiAoQVJDSElURUNUVVJFIFx1MDBBNzMpOiBwcm9iZSBgR0VUIC9oZWFsdGhgIGZpcnN0IFx1MjAxNCBhbiAqdW5jbGFpbWVkKiB3b3JrZXIgZ2V0c1xuICogZnJpZW5kbHkgb25ib2FyZGluZyBndWlkYW5jZSBpbnN0ZWFkIG9mIGEgY3J5cHRpYyA0MjEgXHUyMDE0IHRoZW4gYFBPU1QgL3BhaXJgXG4gKiBhbmQgaGFuZCB0aGUgY3JlZGVudGlhbHMgYmFjayB0byBiZSBwZXJzaXN0ZWQuXG4gKi9cblxuaW1wb3J0IHtcbiAgZmV0Y2hIZWFsdGgsXG4gIG5vcm1hbGl6ZVdvcmtlclVybCxcbiAgcmVxdWVzdFBhaXIsXG4gIFBhaXJSZWplY3RlZEVycm9yLFxuICBVbmNsYWltZWRXb3JrZXJFcnJvcixcbiAgV29ya2VyQXBpRXJyb3IsXG59IGZyb20gJy4vd29ya2VyYXBpLmpzJztcblxuZXhwb3J0IHR5cGUgUGFpck91dGNvbWUgPVxuICB8IHsgc3RhdHVzOiAncGFpcmVkJzsgdXJsOiBzdHJpbmc7IHRva2VuOiBzdHJpbmc7IGRldmljZUlkOiBzdHJpbmcgfVxuICB8IHsgc3RhdHVzOiAndW5jbGFpbWVkJzsgdXJsOiBzdHJpbmc7IGd1aWRhbmNlOiBzdHJpbmcgfVxuICB8IHsgc3RhdHVzOiAndW5yZWFjaGFibGUnOyB1cmw6IHN0cmluZzsgcmVhc29uOiBzdHJpbmcgfVxuICB8IHsgc3RhdHVzOiAncmVqZWN0ZWQnOyB1cmw6IHN0cmluZzsgcmVhc29uOiBzdHJpbmcgfVxuICB8IHsgc3RhdHVzOiAnaW52YWxpZC11cmwnOyBpbnB1dDogc3RyaW5nIH07XG5cbmV4cG9ydCBpbnRlcmZhY2UgUGFpckZsb3dQYXJhbXMge1xuICAvKiogV29ya2VyIFVSTCBhcyB0eXBlZCAvIGRlZXAtbGlua2VkIChzY2hlbWVsZXNzIGlzIHRvbGVyYXRlZCkuICovXG4gIHVybDogc3RyaW5nO1xuICAvKiogT25lLXRpbWUgcGFpcmluZyBjb2RlIGZyb20gdGhlIHdvcmtlciBkYXNoYm9hcmQuICovXG4gIGNvZGU6IHN0cmluZztcbiAgZGV2aWNlTmFtZTogc3RyaW5nO1xuICBkZXZpY2VUeXBlOiAnZGVza3RvcCcgfCAnbW9iaWxlJztcbiAgZmV0Y2hJbXBsOiB0eXBlb2YgZmV0Y2g7XG59XG5cbi8qKiBPbmJvYXJkaW5nIHRleHQgc2hvd24gd2hlbiB0aGUgd29ya2VyIGlzIGRlcGxveWVkIGJ1dCBub3QgY2xhaW1lZC4gKi9cbmV4cG9ydCBmdW5jdGlvbiB1bmNsYWltZWRHdWlkYW5jZSh1cmw6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiBbXG4gICAgYFRoZSB3b3JrZXIgYXQgJHt1cmx9IGlzIGRlcGxveWVkIGJ1dCBub3QgY2xhaW1lZCB5ZXQuIEZpbmlzaCBzZXR1cCBpbiBhIGJyb3dzZXI6YCxcbiAgICAnJyxcbiAgICBgMS4gT3BlbiAke3VybH1gLFxuICAgICcyLiBTZXQgdGhlIGFkbWluIHBhc3NwaHJhc2UgYW5kIG5hbWUgdGhlIHZhdWx0ICh0aGUgY2xhaW0gcGFnZSkuJyxcbiAgICAnMy4gT24gdGhlIGRhc2hib2FyZCwgY3JlYXRlIGEgcGFpcmluZyBjb2RlIChEZXZpY2VzIFx1MjE5MiBQYWlyIG5ldyBkZXZpY2UpLicsXG4gICAgJzQuIEVudGVyIHRoYXQgY29kZSBoZXJlIChvciBjbGljayB0aGUgb2JzaWRpYW46Ly8gbGluayB0aGUgZGFzaGJvYXJkIHNob3dzKSBhbmQgcGFpci4nLFxuICBdLmpvaW4oJ1xcbicpO1xufVxuXG4vKipcbiAqIFJ1biB0aGUgcGFpciBmbG93LiBOZXZlciB0aHJvd3MgXHUyMDE0IGV2ZXJ5IGZhaWx1cmUgbW9kZSBpcyBhIHR5cGVkIG91dGNvbWUgdGhlXG4gKiBVSSBjYW4gcmVuZGVyIChhbmQgdGhlIGRlZXAtbGluayBoYW5kbGVyIGNhbiB0dXJuIGludG8gYSBOb3RpY2UpLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcGFpcldpdGhXb3JrZXIocGFyYW1zOiBQYWlyRmxvd1BhcmFtcyk6IFByb21pc2U8UGFpck91dGNvbWU+IHtcbiAgbGV0IG9yaWdpbjogc3RyaW5nO1xuICB0cnkge1xuICAgIG9yaWdpbiA9IG5vcm1hbGl6ZVdvcmtlclVybChwYXJhbXMudXJsKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIHsgc3RhdHVzOiAnaW52YWxpZC11cmwnLCBpbnB1dDogcGFyYW1zLnVybCB9O1xuICB9XG5cbiAgY29uc3QgaGVhbHRoID0gYXdhaXQgZmV0Y2hIZWFsdGgob3JpZ2luLCBwYXJhbXMuZmV0Y2hJbXBsKTtcbiAgaWYgKCFoZWFsdGgucmVhY2hhYmxlKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXR1czogJ3VucmVhY2hhYmxlJyxcbiAgICAgIHVybDogb3JpZ2luLFxuICAgICAgcmVhc29uOlxuICAgICAgICBgJHtoZWFsdGgucmVhc29uID8/ICd1bmtub3duIGVycm9yJ30gXHUyMDE0IGNoZWNrIHRoZSBVUkwsIHlvdXIgbmV0d29yaywgYW5kIHRoYXQgdGhlIGAgK1xuICAgICAgICAnd29ya2VyIGlzIGRlcGxveWVkLicsXG4gICAgfTtcbiAgfVxuICBpZiAoIWhlYWx0aC5jbGFpbWVkKSB7XG4gICAgcmV0dXJuIHsgc3RhdHVzOiAndW5jbGFpbWVkJywgdXJsOiBvcmlnaW4sIGd1aWRhbmNlOiB1bmNsYWltZWRHdWlkYW5jZShvcmlnaW4pIH07XG4gIH1cblxuICB0cnkge1xuICAgIGNvbnN0IGNyZWRlbnRpYWxzID0gYXdhaXQgcmVxdWVzdFBhaXIoe1xuICAgICAgb3JpZ2luLFxuICAgICAgY29kZTogcGFyYW1zLmNvZGUsXG4gICAgICBkZXZpY2VOYW1lOiBwYXJhbXMuZGV2aWNlTmFtZSxcbiAgICAgIGRldmljZVR5cGU6IHBhcmFtcy5kZXZpY2VUeXBlLFxuICAgICAgZmV0Y2hJbXBsOiBwYXJhbXMuZmV0Y2hJbXBsLFxuICAgIH0pO1xuICAgIHJldHVybiB7IHN0YXR1czogJ3BhaXJlZCcsIHVybDogb3JpZ2luLCAuLi5jcmVkZW50aWFscyB9O1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIFVuY2xhaW1lZFdvcmtlckVycm9yKSB7XG4gICAgICByZXR1cm4geyBzdGF0dXM6ICd1bmNsYWltZWQnLCB1cmw6IG9yaWdpbiwgZ3VpZGFuY2U6IHVuY2xhaW1lZEd1aWRhbmNlKG9yaWdpbikgfTtcbiAgICB9XG4gICAgaWYgKGVycm9yIGluc3RhbmNlb2YgUGFpclJlamVjdGVkRXJyb3IpIHtcbiAgICAgIHJldHVybiB7IHN0YXR1czogJ3JlamVjdGVkJywgdXJsOiBvcmlnaW4sIHJlYXNvbjogZXJyb3IubWVzc2FnZSB9O1xuICAgIH1cbiAgICBjb25zdCByZWFzb24gPSBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcik7XG4gICAgcmV0dXJuIHsgc3RhdHVzOiAncmVqZWN0ZWQnLCB1cmw6IG9yaWdpbiwgcmVhc29uIH07XG4gIH1cbn1cblxuLyoqIFJlbmRlciBhbnkgb3V0Y29tZSBhcyB1c2VyLWZhY2luZyB0ZXh0IChOb3RpY2VzLCBkZWVwLWxpbmsgZmVlZGJhY2spLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhaXJPdXRjb21lTWVzc2FnZShvdXRjb21lOiBQYWlyT3V0Y29tZSk6IHN0cmluZyB7XG4gIHN3aXRjaCAob3V0Y29tZS5zdGF0dXMpIHtcbiAgICBjYXNlICdwYWlyZWQnOlxuICAgICAgcmV0dXJuIGBQYWlyZWQgd2l0aCAke291dGNvbWUudXJsfSBcdTIwMTQgc3luY2luZyBub3cuYDtcbiAgICBjYXNlICd1bmNsYWltZWQnOlxuICAgICAgcmV0dXJuIG91dGNvbWUuZ3VpZGFuY2U7XG4gICAgY2FzZSAndW5yZWFjaGFibGUnOlxuICAgICAgcmV0dXJuIGBDb3VsZCBub3QgcmVhY2ggdGhlIHdvcmtlcjogJHtvdXRjb21lLnJlYXNvbn1gO1xuICAgIGNhc2UgJ3JlamVjdGVkJzpcbiAgICAgIHJldHVybiBgUGFpcmluZyBmYWlsZWQ6ICR7b3V0Y29tZS5yZWFzb259YDtcbiAgICBjYXNlICdpbnZhbGlkLXVybCc6XG4gICAgICByZXR1cm4gYFRoYXQgZG9lcyBub3QgbG9vayBsaWtlIGEgd29ya2VyIFVSTDogJHtKU09OLnN0cmluZ2lmeShvdXRjb21lLmlucHV0KX1gO1xuICB9XG59XG4iLCAiLyoqXG4gKiBgb2JzaWRpYW46Ly92YXVsdHN5bmNmb3JhZ2VudHMvcGFpcj91cmw9PHdvcmtlcj4mY29kZT08cGFpcmluZz5gIGRlZXAtbGlua1xuICogaGFuZGxpbmcgKEFSQ0hJVEVDVFVSRSBcdTAwQTczKTogdGhlIGRhc2hib2FyZCByZW5kZXJzIHRoaXMgbGluayAoYW5kIHRoZSBRUlxuICogZXF1aXZhbGVudCkgc28gYSBuZXcgZGV2aWNlIHBhaXJzIHdpdGggemVybyB0eXBpbmcuXG4gKlxuICogVGhlIGhhbmRsZXIgaXMgcmVnaXN0ZXJlZCBmb3IgdGhlIGFjdGlvbiBgdmF1bHRzeW5jZm9yYWdlbnRzYC4gT2JzaWRpYW5cbiAqIGJ1aWxkcyBkaWZmZXIgc3VidGx5IGluIGhvdyB0aGUgYC9wYWlyYCBwYXRoIHNlZ21lbnQgb2YgYSBwcm90b2NvbCBVUkwgaXNcbiAqIG1hdGNoZWQsIHNvIHRoZSBzYW1lIGhhbmRsZXIgaXMgcmVnaXN0ZXJlZCBmb3IgYHZhdWx0c3luY2ZvcmFnZW50cy9wYWlyYFxuICogdG9vIFx1MjAxNCB3aGljaGV2ZXIgc3BlbGxpbmcgYSBnaXZlbiBidWlsZCByZXNvbHZlcywgdGhlIGxpbmsgd29ya3MuIFdoZW5cbiAqIGB1cmxgL2Bjb2RlYCBhcmUgYWJzZW50IHRoZSBpbnZvY2F0aW9uIGlzIGlnbm9yZWQgKGEgc3RyYXkgcHJvdG9jb2wgaGl0XG4gKiBtdXN0IG5vdCBzcGFtIGEgTm90aWNlKTsgYSAqbWFsZm9ybWVkKiBwYWlyIGxpbmsgKG9uZSBvZiB0aGUgdHdvIHByZXNlbnQpXG4gKiBnZXRzIGFuIGFjdGlvbmFibGUgZXJyb3IuXG4gKi9cblxuaW1wb3J0IHsgTm90aWNlIH0gZnJvbSAnb2JzaWRpYW4nO1xuXG4vKiogUHJvdG9jb2wgYWN0aW9uICh0aGUgYG9ic2lkaWFuOi8vYCBcImhvc3RcIiBwYXJ0KS4gKi9cbmV4cG9ydCBjb25zdCBQUk9UT0NPTF9BQ1RJT04gPSAndmF1bHRzeW5jZm9yYWdlbnRzJztcblxuLyoqIEhhbmRsZXIgc2hhcGUgKE9ic2lkaWFuIHBhc3NlcyBpdHMgZGVjb2RlZCBxdWVyeSBwYXJhbXMpLiAqL1xuZXhwb3J0IHR5cGUgUHJvdG9jb2xIYW5kbGVyID0gKHBhcmFtczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pID0+IHZvaWQ7XG5cbi8qKiBIb3cgaGFuZGxlcnMgZ2V0IHJlZ2lzdGVyZWQgXHUyMDE0IGBQbHVnaW4ucmVnaXN0ZXJPYnNpZGlhblByb3RvY29sSGFuZGxlcmAuICovXG5leHBvcnQgdHlwZSBQcm90b2NvbFJlZ2lzdHJhciA9IChhY3Rpb246IHN0cmluZywgaGFuZGxlcjogUHJvdG9jb2xIYW5kbGVyKSA9PiB2b2lkO1xuXG4vKiogUGFyc2VkIHBhaXIgZGVlcCBsaW5rLiAqL1xuZXhwb3J0IGludGVyZmFjZSBQYWlyRGVlcExpbmsge1xuICB1cmw6IHN0cmluZztcbiAgY29kZTogc3RyaW5nO1xufVxuXG5leHBvcnQgdHlwZSBEZWVwTGlua1BhcnNlUmVzdWx0ID1cbiAgfCB7IG9rOiB0cnVlOyBsaW5rOiBQYWlyRGVlcExpbmsgfVxuICB8IHsgb2s6IGZhbHNlOyBlcnJvcjogc3RyaW5nIH07XG5cbi8qKlxuICogRXh0cmFjdCBge3VybCwgY29kZX1gIGZyb20gT2JzaWRpYW4ncyBkZWNvZGVkIHF1ZXJ5IHBhcmFtcy4gVmFsdWVzIGFycml2ZVxuICogYXMgc3RyaW5ncyAodXN1YWxseSBhbHJlYWR5IGRlY29kZWQ7IGEgZG91YmxlLWVuY29kZWQgYCV4eGAgcmVtbmFudCBpc1xuICogZGVjb2RlZCBvbmNlIG1vcmUsIGJlc3QgZWZmb3J0KS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlUGFpckRlZXBMaW5rKHBhcmFtczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiBEZWVwTGlua1BhcnNlUmVzdWx0IHtcbiAgY29uc3QgdXJsID0gcGFyYW1UZXh0KHBhcmFtcywgJ3VybCcpO1xuICBjb25zdCBjb2RlID0gcGFyYW1UZXh0KHBhcmFtcywgJ2NvZGUnKTtcbiAgaWYgKHVybCA9PT0gJycgJiYgY29kZSA9PT0gJycpIHtcbiAgICByZXR1cm4geyBvazogZmFsc2UsIGVycm9yOiAnbm8gcGFpcmluZyBwYXJhbWV0ZXJzJyB9O1xuICB9XG4gIGlmICh1cmwgPT09ICcnKSByZXR1cm4geyBvazogZmFsc2UsIGVycm9yOiAnZGVlcCBsaW5rIGlzIG1pc3NpbmcgdGhlIHdvcmtlciBVUkwgKD91cmw9XHUyMDI2KScgfTtcbiAgaWYgKGNvZGUgPT09ICcnKSByZXR1cm4geyBvazogZmFsc2UsIGVycm9yOiAnZGVlcCBsaW5rIGlzIG1pc3NpbmcgdGhlIHBhaXJpbmcgY29kZSAoP2NvZGU9XHUyMDI2KScgfTtcbiAgcmV0dXJuIHsgb2s6IHRydWUsIGxpbms6IHsgdXJsLCBjb2RlIH0gfTtcbn1cblxuZnVuY3Rpb24gcGFyYW1UZXh0KHBhcmFtczogUmVjb3JkPHN0cmluZywgdW5rbm93bj4sIGtleTogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3QgdmFsdWUgPSBwYXJhbXNba2V5XTtcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ251bWJlcicpIHJldHVybiBTdHJpbmcodmFsdWUpO1xuICBpZiAodHlwZW9mIHZhbHVlICE9PSAnc3RyaW5nJykgcmV0dXJuICcnO1xuICBjb25zdCB0cmltbWVkID0gdmFsdWUudHJpbSgpO1xuICAvLyBPYnNpZGlhbiBoYW5kcyBvdmVyIGRlY29kZWQgdmFsdWVzOyB0b2xlcmF0ZSBvbmUgc3Vydml2aW5nIHJvdW5kIG9mXG4gIC8vIHBlcmNlbnQtZW5jb2RpbmcgZnJvbSBvdmVyLWVhZ2VyIGxpbmsgZ2VuZXJhdG9ycy5cbiAgaWYgKHRyaW1tZWQuaW5jbHVkZXMoJyUnKSkge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gZGVjb2RlVVJJQ29tcG9uZW50KHRyaW1tZWQpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIHRyaW1tZWQ7XG4gICAgfVxuICB9XG4gIHJldHVybiB0cmltbWVkO1xufVxuXG4vKipcbiAqIFJlZ2lzdGVyIHRoZSBwYWlyIGRlZXAtbGluayBoYW5kbGVyIChjYWxsIGZyb20gYG9ubG9hZGAgd2l0aCB0aGUgcGx1Z2luJ3NcbiAqIG93biByZWdpc3RyYXIpLiBgb25QYWlyYCBydW5zIHRoZSBzaGFyZWQgcGFpciBmbG93IChzZXR0aW5ncyArIE5vdGljZXNcbiAqIGxpdmUgaW4gdGhlIHBsdWdpbik7IGl0cyBlcnJvcnMgYXJlIGxvZ2dlZCwgbmV2ZXIgZmF0YWwuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZWdpc3RlclBhaXJQcm90b2NvbEhhbmRsZXIoXG4gIHJlZ2lzdGVyOiBQcm90b2NvbFJlZ2lzdHJhcixcbiAgb25QYWlyOiAobGluazogUGFpckRlZXBMaW5rKSA9PiBQcm9taXNlPHZvaWQ+LFxuKTogdm9pZCB7XG4gIGNvbnN0IGhhbmRsZXI6IFByb3RvY29sSGFuZGxlciA9IChwYXJhbXMpID0+IHtcbiAgICBjb25zdCBwYXJzZWQgPSBwYXJzZVBhaXJEZWVwTGluayhwYXJhbXMpO1xuICAgIGlmICghcGFyc2VkLm9rKSB7XG4gICAgICAvLyBNaXNzaW5nIGJvdGggXHUyMTkyIGEgYmFyZSBvYnNpZGlhbjovL3ZhdWx0c3luY2ZvcmFnZW50cyBoaXQ7IHN0YXkgcXVpZXQuXG4gICAgICBpZiAocGFyc2VkLmVycm9yICE9PSAnbm8gcGFpcmluZyBwYXJhbWV0ZXJzJykge1xuICAgICAgICBuZXcgTm90aWNlKGBWYXVsdFN5bmMgZGVlcCBsaW5rOiAke3BhcnNlZC5lcnJvcn1gKTtcbiAgICAgIH1cbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdm9pZCBvblBhaXIocGFyc2VkLmxpbmspLmNhdGNoKChlcnJvcjogdW5rbm93bikgPT4ge1xuICAgICAgY29uc29sZS5lcnJvcignW3ZzYV0gZGVlcC1saW5rIHBhaXJpbmcgZmFpbGVkJywgZXJyb3IpO1xuICAgICAgbmV3IE5vdGljZSgnVmF1bHRTeW5jOiBwYWlyaW5nIHZpYSBsaW5rIGZhaWxlZCBcdTIwMTQgc2VlIHRoZSBjb25zb2xlIGZvciBkZXRhaWxzLicpO1xuICAgIH0pO1xuICB9O1xuICByZWdpc3RlcihQUk9UT0NPTF9BQ1RJT04sIGhhbmRsZXIpO1xuICAvLyBSZWdpc3RlciB0aGUgcGF0aC1zcGVsbGVkIGFjdGlvbiB0b28gKGJ1aWxkLWRlcGVuZGVudCBtYXRjaGluZykuXG4gIHJlZ2lzdGVyKGAke1BST1RPQ09MX0FDVElPTn0vcGFpcmAsIGhhbmRsZXIpO1xufVxuIiwgIi8qKlxuICogUmVjb25uZWN0IHBvbGljeSAocGx1Z2luIHNjb3BlIGl0ZW0gIzUpOiBleHBvbmVudGlhbCBiYWNrb2ZmIHdpdGggaml0dGVyLFxuICogY2FwcGVkIGF0IDYwIHMuIFRoZSBwbHVnaW4ncyAxIHMgc3VwZXJ2aXNpb24gdGljayBhc2tzIHRoZSBzdXBlcnZpc29yIHdoYXRcbiAqIHRvIGRvIHdoZW5ldmVyIHRoZSBjbGllbnQgcmVwb3J0cyBgZGlzY29ubmVjdGVkYDsgYSBzY2hlZHVsZWQgcmVjb25uZWN0IGlzXG4gKiBhIHNpbmdsZSBmbGlnaHQgXHUyMDE0IG5ldmVyIGEgc3RhY2sgb2YgcmV0cmllcy5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IFN5bmNDbGllbnRTdGF0ZSB9IGZyb20gJ0B2c2EvY29yZSc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgQmFja29mZk9wdGlvbnMge1xuICAvKiogRmlyc3QgYXR0ZW1wdCBkZWxheSAoZGVmYXVsdCAxIHMpLiAqL1xuICBiYXNlTXM/OiBudW1iZXI7XG4gIC8qKiBDZWlsaW5nIChkZWZhdWx0IDYwIHMgcGVyIHRoZSBwbHVnaW4gc3BlYykuICovXG4gIGNhcE1zPzogbnVtYmVyO1xuICAvKiogSml0dGVyIGZyYWN0aW9uIGFyb3VuZCB0aGUgZXhwb25lbnRpYWwgdmFsdWUsIDBcdTIwMTMwLjUgKGRlZmF1bHQgMC4zKS4gKi9cbiAgaml0dGVyPzogbnVtYmVyO1xuICAvKiogSW5qZWN0YWJsZSByYW5kb21uZXNzICh0ZXN0cykuIERlZmF1bHQgYE1hdGgucmFuZG9tYC4gKi9cbiAgcmFuZG9tPzogKCkgPT4gbnVtYmVyO1xufVxuXG5leHBvcnQgY29uc3QgREVGQVVMVF9SRUNPTk5FQ1RfQkFTRV9NUyA9IDEwMDA7XG5leHBvcnQgY29uc3QgREVGQVVMVF9SRUNPTk5FQ1RfQ0FQX01TID0gNjBfMDAwO1xuXG4vKipcbiAqIERlbGF5IGZvciBhdHRlbXB0IE4gKDAtYmFzZWQpOiBgbWluKGNhcCwgYmFzZSBcdTAwQjcgMl5hdHRlbXB0KWAgd2l0aCBzeW1tZXRyaWNcbiAqIG11bHRpcGxpY2F0aXZlIGppdHRlciwgZmxvb3JlZCBhdCAyNTAgbXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBiYWNrb2ZmRGVsYXlNcyhhdHRlbXB0OiBudW1iZXIsIG9wdGlvbnM6IEJhY2tvZmZPcHRpb25zID0ge30pOiBudW1iZXIge1xuICBjb25zdCBiYXNlID0gb3B0aW9ucy5iYXNlTXMgPz8gREVGQVVMVF9SRUNPTk5FQ1RfQkFTRV9NUztcbiAgY29uc3QgY2FwID0gb3B0aW9ucy5jYXBNcyA/PyBERUZBVUxUX1JFQ09OTkVDVF9DQVBfTVM7XG4gIGNvbnN0IGppdHRlciA9IG9wdGlvbnMuaml0dGVyID8/IDAuMztcbiAgY29uc3QgcmFuZG9tID0gb3B0aW9ucy5yYW5kb20gPz8gTWF0aC5yYW5kb207XG4gIGNvbnN0IGV4cG9uZW50aWFsID0gTWF0aC5taW4oY2FwLCBiYXNlICogMiAqKiBhdHRlbXB0KTtcbiAgY29uc3QgZmFjdG9yID0gMSArIChyYW5kb20oKSAqIDIgLSAxKSAqIGppdHRlcjtcbiAgcmV0dXJuIE1hdGgucm91bmQoTWF0aC5taW4oY2FwLCBNYXRoLm1heCgyNTAsIGV4cG9uZW50aWFsICogZmFjdG9yKSkpO1xufVxuXG5leHBvcnQgdHlwZSBSZWNvbm5lY3REZWNpc2lvbiA9IHsgYWN0aW9uOiAncmVjb25uZWN0JzsgZGVsYXlNczogbnVtYmVyIH0gfCB7IGFjdGlvbjogJ3dhaXQnIH07XG5cbi8qKlxuICogVHJhY2tzIHJlY29ubmVjdCBhdHRlbXB0cyBhY3Jvc3MgdGhlIHN1cGVydmlzaW9uIHRpY2suIE5vbi1kaXNjb25uZWN0ZWRcbiAqIHN0YXRlcyByZXNldCB0aGUgYmFja29mZiBsYWRkZXIgKGEgc3VjY2Vzc2Z1bCBjeWNsZSBtZWFucyB0aGUgbmV0d29yayBpc1xuICogYmFjayk7IGBzY2hlZHVsZWRgIGtlZXBzIGV4YWN0bHkgb25lIHJlY29ubmVjdCBpbiBmbGlnaHQuXG4gKi9cbmV4cG9ydCBjbGFzcyBSZWNvbm5lY3RTdXBlcnZpc29yIHtcbiAgcHJpdmF0ZSBhdHRlbXB0ID0gMDtcbiAgcHJpdmF0ZSBzY2hlZHVsZWQgPSBmYWxzZTtcbiAgcHJpdmF0ZSByZWFkb25seSBvcHRpb25zOiBCYWNrb2ZmT3B0aW9ucztcblxuICBjb25zdHJ1Y3RvcihvcHRpb25zOiBCYWNrb2ZmT3B0aW9ucyA9IHt9KSB7XG4gICAgdGhpcy5vcHRpb25zID0gb3B0aW9ucztcbiAgfVxuXG4gIC8qKiBDYWxsIGVhY2ggdGljazsgb24gYHJlY29ubmVjdGAsIGZvbGxvdyB1cCB3aXRoIGBhY2tub3dsZWRnZWQoKWAuICovXG4gIGNvbnNpZGVyKHN0YXRlOiBTeW5jQ2xpZW50U3RhdGUpOiBSZWNvbm5lY3REZWNpc2lvbiB7XG4gICAgaWYgKHN0YXRlICE9PSAnZGlzY29ubmVjdGVkJykge1xuICAgICAgdGhpcy5hdHRlbXB0ID0gMDtcbiAgICAgIHRoaXMuc2NoZWR1bGVkID0gZmFsc2U7XG4gICAgICByZXR1cm4geyBhY3Rpb246ICd3YWl0JyB9O1xuICAgIH1cbiAgICBpZiAodGhpcy5zY2hlZHVsZWQpIHJldHVybiB7IGFjdGlvbjogJ3dhaXQnIH07XG4gICAgcmV0dXJuIHsgYWN0aW9uOiAncmVjb25uZWN0JywgZGVsYXlNczogYmFja29mZkRlbGF5TXModGhpcy5hdHRlbXB0LCB0aGlzLm9wdGlvbnMpIH07XG4gIH1cblxuICAvKiogTWFyayB0aGUgcmV0dXJuZWQgcmVjb25uZWN0IGFzIGluIGZsaWdodCAob25lIGF0IGEgdGltZSkuICovXG4gIGFja25vd2xlZGdlZCgpOiB2b2lkIHtcbiAgICB0aGlzLmF0dGVtcHQgKz0gMTtcbiAgICB0aGlzLnNjaGVkdWxlZCA9IHRydWU7XG4gIH1cblxuICAvKiogVGhlIGluLWZsaWdodCByZWNvbm5lY3Qgc2V0dGxlZCAoc3VjY2VzcyBvciBmYWlsdXJlKS4gKi9cbiAgc2V0dGxlZCgpOiB2b2lkIHtcbiAgICB0aGlzLnNjaGVkdWxlZCA9IGZhbHNlO1xuICB9XG5cbiAgLyoqIENvbXBsZXRlZCByZWNvbm5lY3QgYXR0ZW1wdHMgc2luY2UgdGhlIGxhc3QgaGVhbHRoeSBzdGF0ZS4gKi9cbiAgZ2V0IGF0dGVtcHRzKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMuYXR0ZW1wdDtcbiAgfVxufVxuIiwgIi8qKlxuICogVGhlIHNldHRpbmdzIHRhYiAocGx1Z2luIHNjb3BlIGl0ZW0gIzYpLCBvcmdhbml6ZWQgaW4gZm91ciBzZWN0aW9uczpcbiAqXG4gKiAgIENvbm5lY3Rpb24gXHUyMDE0IHdvcmtlciBVUkwsIGRldmljZSBuYW1lIChwYWlyaW5nLXRpbWUgT1IgcmVuYW1lIHdoZW5cbiAqICAgICAgICAgICAgICAgIGxpbmtlZCksIHBhaXJpbmcgZm9ybSAvIHN0YXR1cyByZWFkb3V0ICsgU3luYyBub3cgKyB1bmxpbmtcbiAqICAgU3luYyAgICAgICBcdTIwMTQgcmVzY2FuIGludGVydmFsLCAub2JzaWRpYW4vIHRvZ2dsZSwgcGF1c2UvcmVzdW1lLFxuICogICAgICAgICAgICAgICAgc3luYy1vbi1zdGFydHVwXG4gKiAgIEFkdmFuY2VkICAgXHUyMDE0IHN0YXR1cy1iYXIgaW5kaWNhdG9yIG1vZGUsIGlnbm9yZSBwYXR0ZXJucywgZGlhZ25vc3RpY3NcbiAqICAgICAgICAgICAgICAgIChsb2cgbGV2ZWwgKyBDb3B5IGRpYWdub3N0aWNzKVxuICogICBBYm91dCAgICAgIFx1MjAxNCB2ZXJzaW9ucywgc3RvcmFnZSB1c2FnZSwgcHJvamVjdCBSRUFETUUgbGlua1xuICpcbiAqIEFsbCBsb2dpYyBsaXZlcyBvbiBgVmF1bHRTeW5jUGx1Z2luYDsgdGhlIHRhYiBpcyBwcmVzZW50YXRpb24gcGx1cyB3aXJpbmcuXG4gKi9cblxuaW1wb3J0IHsgTW9kYWwsIE5vdGljZSwgUGx1Z2luU2V0dGluZ1RhYiwgU2V0dGluZyB9IGZyb20gJ29ic2lkaWFuJztcbmltcG9ydCB0eXBlIHsgQXBwIH0gZnJvbSAnb2JzaWRpYW4nO1xuaW1wb3J0IHtcbiAgZGVmYXVsdERldmljZU5hbWUsXG4gIFJFU0NBTl9JTlRFUlZBTF9DSE9JQ0VTLFxuICB0eXBlIExvZ0xldmVsLFxuICB0eXBlIFZhdWx0U3luY1BsdWdpbkRhdGEsXG59IGZyb20gJy4vZGF0YS5qcyc7XG5pbXBvcnQgdHlwZSB7IFBhaXJPdXRjb21lIH0gZnJvbSAnLi9wYWlyaW5nLmpzJztcbmltcG9ydCB7IHBhaXJPdXRjb21lTWVzc2FnZSB9IGZyb20gJy4vcGFpcmluZy5qcyc7XG5pbXBvcnQgeyBmb3JtYXRCeXRlcywgUFJPVE9DT0xfVkVSU0lPTiB9IGZyb20gJy4vZGlhZ25vc3RpY3MuanMnO1xuaW1wb3J0IHsgZm9ybWF0U2luY2UgfSBmcm9tICcuL3N0YXR1c2Jhci5qcyc7XG5pbXBvcnQgdHlwZSB7IFZhdWx0U3luY1BsdWdpbiB9IGZyb20gJy4vcGx1Z2luLmpzJztcblxuLyoqXG4gKiBDbG91ZGZsYXJlIERlcGxveSBCdXR0b24gdGFyZ2V0IChGUi0yMSk6IHByb3Zpc2lvbnMgYSBwcmVjb25maWd1cmVkIHdvcmtlclxuICogKyBEdXJhYmxlIE9iamVjdCArIFIyIGJ1Y2tldCBpbiB0aGUgdXNlcidzIG93biBhY2NvdW50IFx1MjAxNCBubyB3cmFuZ2xlciwgbm9cbiAqIG1hbnVhbCBjb25maWcuIFRoZSB0ZW1wbGF0ZSByZXBvIHBpbnMgYSByZWxlYXNlZCB3b3JrZXIgdmVyc2lvbi5cbiAqL1xuZXhwb3J0IGNvbnN0IERFUExPWV9VUkwgPVxuICAnaHR0cHM6Ly9kZXBsb3kud29ya2Vycy5jbG91ZGZsYXJlLmNvbS8/dXJsPScgK1xuICAnaHR0cHM6Ly9naXRodWIuY29tL2FudWNoaW4vdmF1bHRzeW5jZm9yYWdlbnRzLXRlbXBsYXRlJztcblxuLyoqIFRoZSBwcm9qZWN0IFJFQURNRSAodGhlIEFib3V0IHNlY3Rpb24ncyBsaW5rKS4gKi9cbmV4cG9ydCBjb25zdCBQUk9KRUNUX1JFQURNRV9VUkwgPSAnaHR0cHM6Ly9naXRodWIuY29tL2FudWNoaW4vdmF1bHRzeW5jZm9yYWdlbnRzI3JlYWRtZSc7XG5cbi8qKiBPcGVuIHRoZSBkZXBsb3kgcGFnZSBpbiB0aGUgc3lzdGVtIGJyb3dzZXIgKG5vLW9wIHdoZXJlIGB3aW5kb3dgIGlzIGFic2VudCkuICovXG5leHBvcnQgZnVuY3Rpb24gb3BlbkRlcGxveVBhZ2UoKTogdm9pZCB7XG4gIGlmICh0eXBlb2Ygd2luZG93ID09PSAndW5kZWZpbmVkJykgcmV0dXJuO1xuICB3aW5kb3cub3BlbihERVBMT1lfVVJMLCAnX2JsYW5rJyk7XG59XG5cbi8qKiBPcGVuIHRoZSBwcm9qZWN0IFJFQURNRSBpbiB0aGUgc3lzdGVtIGJyb3dzZXIgKG5vLW9wIHdpdGhvdXQgYHdpbmRvd2ApLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG9wZW5SZWFkbWVQYWdlKCk6IHZvaWQge1xuICBpZiAodHlwZW9mIHdpbmRvdyA9PT0gJ3VuZGVmaW5lZCcpIHJldHVybjtcbiAgd2luZG93Lm9wZW4oUFJPSkVDVF9SRUFETUVfVVJMLCAnX2JsYW5rJyk7XG59XG5cbi8qKiBTbWFsbCBjb25maXJtYXRpb24gZGlhbG9nICh0aGUgdW5saW5rIGJ1dHRvbidzIHNhZmV0eSBuZXQpLiAqL1xuZXhwb3J0IGNsYXNzIENvbmZpcm1Nb2RhbCBleHRlbmRzIE1vZGFsIHtcbiAgY29uc3RydWN0b3IoXG4gICAgYXBwOiBBcHAsXG4gICAgcHJpdmF0ZSByZWFkb25seSBvcHRpb25zOiB7XG4gICAgICB0aXRsZTogc3RyaW5nO1xuICAgICAgYm9keTogc3RyaW5nO1xuICAgICAgY29uZmlybVRleHQ6IHN0cmluZztcbiAgICAgIG9uQ29uZmlybTogKCkgPT4gdm9pZCB8IFByb21pc2U8dm9pZD47XG4gICAgfSxcbiAgKSB7XG4gICAgc3VwZXIoYXBwKTtcbiAgfVxuXG4gIG92ZXJyaWRlIG9uT3BlbigpOiB2b2lkIHtcbiAgICBuZXcgU2V0dGluZyh0aGlzLmNvbnRlbnRFbCkuc2V0TmFtZSh0aGlzLm9wdGlvbnMudGl0bGUpLnNldERlc2ModGhpcy5vcHRpb25zLmJvZHkpO1xuICAgIG5ldyBTZXR0aW5nKHRoaXMuY29udGVudEVsKS5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KCdDYW5jZWwnKS5vbkNsaWNrKCgpID0+IHRoaXMuY2xvc2UoKSksXG4gICAgKTtcbiAgICBuZXcgU2V0dGluZyh0aGlzLmNvbnRlbnRFbCkuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICBidXR0b25cbiAgICAgICAgLnNldEN0YSgpXG4gICAgICAgIC5zZXRCdXR0b25UZXh0KHRoaXMub3B0aW9ucy5jb25maXJtVGV4dClcbiAgICAgICAgLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIHRoaXMuY2xvc2UoKTtcbiAgICAgICAgICBhd2FpdCB0aGlzLm9wdGlvbnMub25Db25maXJtKCk7XG4gICAgICAgIH0pLFxuICAgICk7XG4gIH1cbn1cblxuZXhwb3J0IGNsYXNzIFZhdWx0U3luY1NldHRpbmdUYWIgZXh0ZW5kcyBQbHVnaW5TZXR0aW5nVGFiIHtcbiAgcHJpdmF0ZSByZWFkb25seSBwbHVnaW46IFZhdWx0U3luY1BsdWdpbjtcbiAgLyoqIFBhaXJpbmcgY29kZXMgbmV2ZXIgdG91Y2ggZGlzayBcdTIwMTQgdGhleSBhcmUgb25lLXRpbWUsIHNob3J0LWxpdmVkIHNlY3JldHMuICovXG4gIHByaXZhdGUgcGFpcmluZ0NvZGUgPSAnJztcbiAgLyoqXG4gICAqIExpbmtlZC1tb2RlIGRldmljZS1uYW1lIGRyYWZ0OiBlZGl0cyBzdGFnZSBoZXJlIChOT1QgaW4gcGx1Z2luIGRhdGEpIHNvIGFcbiAgICogZmFpbGVkIHJlbmFtZSBjYW5ub3QgbGVhdmUgdGhlIGxvY2FsIG5hbWUgb3V0IG9mIHN5bmMgd2l0aCB0aGUgd29ya2VyLlxuICAgKi9cbiAgcHJpdmF0ZSByZW5hbWVEcmFmdDogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgaGludFNldHRpbmc6IFNldHRpbmcgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBzdGF0dXNTZXR0aW5nOiBTZXR0aW5nIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgc3RvcmFnZVNldHRpbmc6IFNldHRpbmcgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSByZWZyZXNoSGFuZGxlOiBSZXR1cm5UeXBlPHR5cGVvZiBzZXRJbnRlcnZhbD4gfCBudWxsID0gbnVsbDtcblxuICBjb25zdHJ1Y3RvcihhcHA6IEFwcCwgcGx1Z2luOiBWYXVsdFN5bmNQbHVnaW4pIHtcbiAgICBzdXBlcihhcHAsIHBsdWdpbik7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gIH1cblxuICBvdmVycmlkZSBkaXNwbGF5KCk6IHZvaWQge1xuICAgIHRoaXMuc3RvcFJlZnJlc2goKTtcbiAgICBjb25zdCB7IGNvbnRhaW5lckVsIH0gPSB0aGlzO1xuICAgIGNvbnRhaW5lckVsLmVtcHR5KCk7XG4gICAgdGhpcy5oaW50U2V0dGluZyA9IG51bGw7XG4gICAgdGhpcy5zdGF0dXNTZXR0aW5nID0gbnVsbDtcbiAgICB0aGlzLnN0b3JhZ2VTZXR0aW5nID0gbnVsbDtcbiAgICB0aGlzLnJlbmFtZURyYWZ0ID0gbnVsbDtcblxuICAgIHRoaXMucmVuZGVyQ29ubmVjdGlvblNlY3Rpb24oKTtcbiAgICB0aGlzLnJlbmRlclN5bmNTZWN0aW9uKCk7XG4gICAgdGhpcy5yZW5kZXJBZHZhbmNlZFNlY3Rpb24oKTtcbiAgICB0aGlzLnJlbmRlckFib3V0U2VjdGlvbigpO1xuICAgIHRoaXMuc3RhcnRSZWZyZXNoKCk7XG4gIH1cblxuICBvdmVycmlkZSBoaWRlKCk6IHZvaWQge1xuICAgIHRoaXMuc3RvcFJlZnJlc2goKTtcbiAgfVxuXG4gIC8vIC0tLSBzZWN0aW9ucyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIHByaXZhdGUgaGVhZGluZyh0ZXh0OiBzdHJpbmcpOiB2b2lkIHtcbiAgICBuZXcgU2V0dGluZyh0aGlzLmNvbnRhaW5lckVsKS5zZXROYW1lKHRleHQpLnNldEhlYWRpbmcoKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyQ29ubmVjdGlvblNlY3Rpb24oKTogdm9pZCB7XG4gICAgY29uc3QgeyBjb250YWluZXJFbCB9ID0gdGhpcztcbiAgICB0aGlzLmhlYWRpbmcoJ0Nvbm5lY3Rpb24nKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ1dvcmtlciBVUkwnKVxuICAgICAgLnNldERlc2MoXG4gICAgICAgICdZb3VyIHN5bmMgd29ya2VyLCBlLmcuIGh0dHBzOi8vcGVyc29uYWwueC53b3JrZXJzLmRldi4gTm8gd29ya2VyIHlldD8gVXNlIFwiRGVwbG95IHlvdXIgd29ya2VyXCIgYmVsb3csIG9wZW4gdGhlIFVSTCBpbiBhIGJyb3dzZXIsIGFuZCBjbGFpbSBpdC4nLFxuICAgICAgKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHRcbiAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoJ2h0dHBzOi8vcGVyc29uYWwueC53b3JrZXJzLmRldicpXG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMucGx1Z2luLmRhdGEudXJsKVxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLmRhdGEudXJsID0gdmFsdWUudHJpbSgpO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVBsdWdpbkRhdGEoKTtcbiAgICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBpZiAodGhpcy5wbHVnaW4ubGlua2VkKSB7XG4gICAgICB0aGlzLnJlbmRlckxpbmtlZERldmljZU5hbWUoKTtcbiAgICAgIHRoaXMucmVuZGVyTGlua2VkU3RhdHVzKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMucmVuZGVyUGFpcmluZ0RldmljZU5hbWUoKTtcbiAgICAgIHRoaXMucmVuZGVyUGFpcmluZ1NlY3Rpb24oKTtcbiAgICB9XG4gIH1cblxuICAvKiogVW5saW5rZWQ6IHRoZSBuYW1lIGlzIGEgcGFpcmluZy10aW1lIGRlZmF1bHQgKGFwcGxpZXMgYXQgbmV4dCBwYWlyKS4gKi9cbiAgcHJpdmF0ZSByZW5kZXJQYWlyaW5nRGV2aWNlTmFtZSgpOiB2b2lkIHtcbiAgICBuZXcgU2V0dGluZyh0aGlzLmNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ0RldmljZSBuYW1lJylcbiAgICAgIC5zZXREZXNjKGBTaG93biBpbiB0aGUgd29ya2VyIGRhc2hib2FyZCdzIGRldmljZSBsaXN0LiBBcHBsaWVzIHdoZW4gKHJlKXBhaXJpbmcuYClcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PlxuICAgICAgICB0ZXh0XG4gICAgICAgICAgLnNldFBsYWNlaG9sZGVyKGRlZmF1bHREZXZpY2VOYW1lKCkpXG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMucGx1Z2luLmRhdGEuZGV2aWNlTmFtZSlcbiAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5kYXRhLmRldmljZU5hbWUgPSB2YWx1ZS50cmltKCk7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlUGx1Z2luRGF0YSgpO1xuICAgICAgICAgIH0pLFxuICAgICAgKTtcbiAgfVxuXG4gIC8qKiBMaW5rZWQ6IHRoZSBmaWVsZCBzaG93cyB0aGUgY3VycmVudCBuYW1lOyBSZW5hbWUgcHVzaGVzIGl0IHRvIHRoZSB3b3JrZXIuICovXG4gIHByaXZhdGUgcmVuZGVyTGlua2VkRGV2aWNlTmFtZSgpOiB2b2lkIHtcbiAgICBjb25zdCBjdXJyZW50ID0gdGhpcy5yZW5hbWVEcmFmdCA/PyB0aGlzLnBsdWdpbi5kYXRhLmRldmljZU5hbWU7XG4gICAgbmV3IFNldHRpbmcodGhpcy5jb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdEZXZpY2UgbmFtZScpXG4gICAgICAuc2V0RGVzYyhcbiAgICAgICAgJ1RoZSB3b3JrZXIgZGFzaGJvYXJkIHNob3dzIHRoaXMgbmFtZS4gRWRpdCBpdCBhbmQgcHJlc3MgXCJSZW5hbWUgZGV2aWNlXCIgdG8gdXBkYXRlIHRoaXMgZGV2aWNlIG9uIHRoZSB3b3JrZXIgKDEtMzAgY2hhcmFjdGVycykuJyxcbiAgICAgIClcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PlxuICAgICAgICB0ZXh0XG4gICAgICAgICAgLnNldFBsYWNlaG9sZGVyKGRlZmF1bHREZXZpY2VOYW1lKCkpXG4gICAgICAgICAgLnNldFZhbHVlKGN1cnJlbnQpXG4gICAgICAgICAgLm9uQ2hhbmdlKCh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5yZW5hbWVEcmFmdCA9IHZhbHVlO1xuICAgICAgICAgIH0pLFxuICAgICAgKVxuICAgICAgLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgICBidXR0b24uc2V0QnV0dG9uVGV4dCgnUmVuYW1lIGRldmljZScpLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGJ1dHRvbi5zZXREaXNhYmxlZCh0cnVlKTtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3Qgb2sgPSBhd2FpdCB0aGlzLnBsdWdpbi5yZW5hbWVEZXZpY2UodGhpcy5yZW5hbWVEcmFmdCA/PyB0aGlzLnBsdWdpbi5kYXRhLmRldmljZU5hbWUpO1xuICAgICAgICAgICAgaWYgKG9rKSB0aGlzLmRpc3BsYXkoKTsgLy8gcmUtcmVuZGVyIHdpdGggdGhlIHBlcnNpc3RlZCBuYW1lXG4gICAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICAgIGJ1dHRvbi5zZXREaXNhYmxlZChmYWxzZSk7XG4gICAgICAgICAgfVxuICAgICAgICB9KSxcbiAgICAgICk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlclBhaXJpbmdTZWN0aW9uKCk6IHZvaWQge1xuICAgIGNvbnN0IHsgY29udGFpbmVyRWwgfSA9IHRoaXM7XG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnUGFpcmluZyBjb2RlJylcbiAgICAgIC5zZXREZXNjKCdGcm9tIHlvdXIgd29ya2VyIGRhc2hib2FyZDogRGV2aWNlcyBcdTIxOTIgUGFpciBuZXcgZGV2aWNlLiBDb2RlcyBhcmUgb25lLXRpbWUgYW5kIGV4cGlyZSBhZnRlciAxMCBtaW51dGVzLicpXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT5cbiAgICAgICAgdGV4dFxuICAgICAgICAgIC5zZXRQbGFjZWhvbGRlcignN0YzSy1ROU0yJylcbiAgICAgICAgICAub25DaGFuZ2UoKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnBhaXJpbmdDb2RlID0gdmFsdWUudHJpbSgpO1xuICAgICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKS5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgIGJ1dHRvblxuICAgICAgICAuc2V0Q3RhKClcbiAgICAgICAgLnNldEJ1dHRvblRleHQoJ1BhaXIgdGhpcyB2YXVsdCcpXG4gICAgICAgIC5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICBidXR0b24uc2V0RGlzYWJsZWQodHJ1ZSk7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IG91dGNvbWUgPSBhd2FpdCB0aGlzLnBsdWdpbi5wYWlyRnJvbVNldHRpbmdzKHRoaXMucGFpcmluZ0NvZGUpO1xuICAgICAgICAgICAgdGhpcy5zaG93T3V0Y29tZShvdXRjb21lKTtcbiAgICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgICAgYnV0dG9uLnNldERpc2FibGVkKGZhbHNlKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pLFxuICAgICk7XG5cbiAgICB0aGlzLmhpbnRTZXR0aW5nID0gbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnR2V0dGluZyBzdGFydGVkJylcbiAgICAgIC5zZXRDbGFzcygndnNhLXNldHRpbmdzLWhpbnQnKVxuICAgICAgLnNldERlc2MoXG4gICAgICAgIFtcbiAgICAgICAgICAnMS4gRGVwbG95IHlvdXIgb3duIHdvcmtlciB3aXRoIHRoZSBidXR0b24gYmVsb3cgKHlvdXIgQ2xvdWRmbGFyZSBhY2NvdW50LCBwcmVjb25maWd1cmVkIFx1MjAxNCBubyB3cmFuZ2xlcikuJyxcbiAgICAgICAgICAnMi4gT3BlbiB0aGUgd29ya2VyIFVSTCBpbiBhIGJyb3dzZXIgYW5kIHNldCB0aGUgYWRtaW4gcGFzc3BocmFzZSAoY2xhaW0pLicsXG4gICAgICAgICAgJzMuIENyZWF0ZSBhIHBhaXJpbmcgY29kZSBvbiB0aGUgZGFzaGJvYXJkLCBwYXN0ZSBpdCBhYm92ZSwgYW5kIHBhaXIuJyxcbiAgICAgICAgICAnT24gYSBwaG9uZSwgc2Nhbm5pbmcgdGhlIGRhc2hib2FyZCBRUiBvciB0YXBwaW5nIGl0cyBvYnNpZGlhbjovLyBsaW5rIHBhaXJzIHdpdGhvdXQgdHlwaW5nLicsXG4gICAgICAgIF0uam9pbignXFxuJyksXG4gICAgICApXG4gICAgICAuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KCdEZXBsb3kgeW91ciB3b3JrZXInKS5vbkNsaWNrKCgpID0+IG9wZW5EZXBsb3lQYWdlKCkpLFxuICAgICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyTGlua2VkU3RhdHVzKCk6IHZvaWQge1xuICAgIGNvbnN0IHsgY29udGFpbmVyRWwgfSA9IHRoaXM7XG5cbiAgICB0aGlzLnN0YXR1c1NldHRpbmcgPSBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdTdGF0dXMnKVxuICAgICAgLnNldENsYXNzKCd2c2Etc3RhdHVzLXJlYWRvdXQnKVxuICAgICAgLnNldERlc2ModGhpcy5zdGF0dXNUZXh0KCkpO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoJ1N5bmMgbm93Jykub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgIGJ1dHRvbi5zZXREaXNhYmxlZCh0cnVlKTtcbiAgICAgICAgdHJ5IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zeW5jTm93KCk7XG4gICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgYnV0dG9uLnNldERpc2FibGVkKGZhbHNlKTtcbiAgICAgICAgICB0aGlzLnJlZnJlc2hTdGF0dXMoKTtcbiAgICAgICAgfVxuICAgICAgfSksXG4gICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKS5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KCdVbmxpbmsgdGhpcyB2YXVsdCcpLm9uQ2xpY2soKCkgPT4ge1xuICAgICAgICBuZXcgQ29uZmlybU1vZGFsKHRoaXMuYXBwLCB7XG4gICAgICAgICAgdGl0bGU6ICdVbmxpbmsgVmF1bHRTeW5jPycsXG4gICAgICAgICAgYm9keTogJ1RoaXMgc3RvcHMgc3luY2luZyBhbmQgY2xlYXJzIHRoaXMgZGV2aWNlXFx1MjAxOXMgbG9jYWwgc3luYyBzdGF0ZS4gRmlsZXMgYWxyZWFkeSBpbiB0aGUgdmF1bHQgYXJlIHVudG91Y2hlZC4gVGhlIHdvcmtlciBrZWVwcyB0aGlzIGRldmljZSBpbiBpdHMgcmVnaXN0cnkgXFx1MjAxNCByZXZva2UgaXQgZnJvbSB0aGUgZGFzaGJvYXJkIGlmIHlvdSBhcmUgZG9uZSB3aXRoIGl0LicsXG4gICAgICAgICAgY29uZmlybVRleHQ6ICdVbmxpbmsnLFxuICAgICAgICAgIG9uQ29uZmlybTogYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4udW5saW5rKCk7XG4gICAgICAgICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAgICAgICB9LFxuICAgICAgICB9KS5vcGVuKCk7XG4gICAgICB9KSxcbiAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJTeW5jU2VjdGlvbigpOiB2b2lkIHtcbiAgICBjb25zdCB7IGNvbnRhaW5lckVsIH0gPSB0aGlzO1xuICAgIGNvbnN0IGRhdGEgPSB0aGlzLnBsdWdpbi5kYXRhO1xuICAgIHRoaXMuaGVhZGluZygnU3luYycpO1xuXG4gICAgaWYgKHRoaXMucGx1Z2luLmxpbmtlZCkge1xuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKCdSZXNjYW4gaW50ZXJ2YWwnKVxuICAgICAgICAuc2V0RGVzYyhcbiAgICAgICAgICAnUGVyaW9kaWMgZnVsbCByZWNvbmNpbGlhdGlvbiBcdTIwMTQgY2F0Y2hlcyBleHRlcm5hbCBlZGl0cyB3aGlsZSBPYnNpZGlhbiBpcyBvcGVuIGFuZCBjb3ZlcnMgbW9iaWxlIGJhY2tncm91bmQgbGltaXRzLiBWYXVsdCBldmVudHMgYW5kIGFwcC1vcGVuIHN5bmMgYWx3YXlzIHJ1bi4nLFxuICAgICAgICApXG4gICAgICAgIC5hZGREcm9wZG93bigoZHJvcGRvd24pID0+IHtcbiAgICAgICAgICBmb3IgKGNvbnN0IGNob2ljZSBvZiBSRVNDQU5fSU5URVJWQUxfQ0hPSUNFUykge1xuICAgICAgICAgICAgZHJvcGRvd24uYWRkT3B0aW9uKFN0cmluZyhjaG9pY2UudmFsdWUpLCBjaG9pY2UubGFiZWwpO1xuICAgICAgICAgIH1cbiAgICAgICAgICBkcm9wZG93bi5zZXRWYWx1ZShTdHJpbmcoZGF0YS5zZXR0aW5ncy5yZXNjYW5JbnRlcnZhbFNlYykpO1xuICAgICAgICAgIGRyb3Bkb3duLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uYXBwbHlSZXNjYW5JbnRlcnZhbChOdW1iZXIodmFsdWUpKTtcbiAgICAgICAgICB9KTtcbiAgICAgICAgfSk7XG5cbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZSgnU3luYyAub2JzaWRpYW4vIGZvbGRlcicpXG4gICAgICAgIC5zZXREZXNjKFxuICAgICAgICAgICdPcHQgaW4gdG8gc3luY2luZyAub2JzaWRpYW4vIChzZXR0aW5ncyBhbmQgcGx1Z2lucyksIGV4Y2x1ZGluZyB3b3Jrc3BhY2UuanNvbiBhbmQgY2FjaGVzLiAnICtcbiAgICAgICAgICAgICdUaGUgd29ya2VyXFx1MjAxOXMgcGVyLXZhdWx0IHNldHRpbmcgdGFrZXMgcHJlY2VkZW5jZSBvbmNlIGNvbm5lY3RlZC4nLFxuICAgICAgICApXG4gICAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgICB0b2dnbGUuc2V0VmFsdWUoZGF0YS5zZXR0aW5ncy5vYnNpZGlhblN5bmMpLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uYXBwbHlPYnNpZGlhblN5bmModmFsdWUpO1xuICAgICAgICAgIH0pLFxuICAgICAgICApO1xuXG4gICAgICBjb25zdCBwYXVzZWQgPSB0aGlzLnBsdWdpbi5zeW5jaW5nUGF1c2VkO1xuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKHBhdXNlZCA/ICdTeW5jaW5nIHBhdXNlZCcgOiAnUGF1c2Ugc3luY2luZycpXG4gICAgICAgIC5zZXREZXNjKFxuICAgICAgICAgIHBhdXNlZFxuICAgICAgICAgICAgPyAnU3luY2luZyBpcyBwYXVzZWQ6IHRoZSBjb25uZWN0aW9uIGlzIGRvd24gYW5kIHZhdWx0IGNoYW5nZXMgc3RheSBsb2NhbC4gUmVzdW1lIHJlY29ubmVjdHMgYW5kIHJ1bnMgYSBmdWxsIGNhdGNoLXVwIHN5bmMuJ1xuICAgICAgICAgICAgOiAnVGVtcG9yYXJpbHkgc3RvcCBzeW5jaW5nIHdpdGhvdXQgdW5saW5raW5nIFx1MjAxNCB0aGUgdHJhbnNwb3J0IGRpc2Nvbm5lY3RzIGFuZCB0aGUgd2F0Y2hlciBnb2VzIGlkbGUuIFlvdXIgbGluayBhbmQgbG9jYWwgc3RhdGUgYXJlIGtlcHQuJyxcbiAgICAgICAgKVxuICAgICAgICAuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICAgICAgYnV0dG9uXG4gICAgICAgICAgICAuc2V0QnV0dG9uVGV4dChwYXVzZWQgPyAnUmVzdW1lIHN5bmNpbmcnIDogJ1BhdXNlIHN5bmNpbmcnKVxuICAgICAgICAgICAgLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgICAgICBidXR0b24uc2V0RGlzYWJsZWQodHJ1ZSk7XG4gICAgICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICAgICAgaWYgKHBhdXNlZCkgYXdhaXQgdGhpcy5wbHVnaW4ucmVzdW1lU3luY2luZygpO1xuICAgICAgICAgICAgICAgIGVsc2UgdGhpcy5wbHVnaW4ucGF1c2VTeW5jaW5nKCk7XG4gICAgICAgICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICAgICAgdGhpcy5kaXNwbGF5KCk7IC8vIHJlLXJlbmRlcjogdGhlIGJ1dHRvbiAoYW5kIGxhYmVsKSBmbGlwXG4gICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0pLFxuICAgICAgICApO1xuICAgIH1cblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ1N5bmMgb24gc3RhcnR1cCcpXG4gICAgICAuc2V0RGVzYyhcbiAgICAgICAgJ09OIChkZWZhdWx0KTogc3luYyBzdGFydHMgYXMgc29vbiBhcyBPYnNpZGlhbiBvcGVucy4gT0ZGOiB0aGUgcGx1Z2luIGxvYWRzIGlkbGUgYW5kIHRoZSBmaXJzdCBcIlN5bmMgbm93XCIgcHJlc3Mgc3RhcnRzIHN5bmNpbmcgKG1hbnVhbC1vbmx5IG1vZGUpLicsXG4gICAgICApXG4gICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgIHRvZ2dsZS5zZXRWYWx1ZShkYXRhLnNldHRpbmdzLnN5bmNPblN0YXJ0dXApLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLmFwcGx5U3luY09uU3RhcnR1cCh2YWx1ZSk7XG4gICAgICAgIH0pLFxuICAgICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyQWR2YW5jZWRTZWN0aW9uKCk6IHZvaWQge1xuICAgIGNvbnN0IHsgY29udGFpbmVyRWwgfSA9IHRoaXM7XG4gICAgY29uc3QgZGF0YSA9IHRoaXMucGx1Z2luLmRhdGE7XG4gICAgdGhpcy5oZWFkaW5nKCdBZHZhbmNlZCcpO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnU3RhdHVzIGJhciBpbmRpY2F0b3InKVxuICAgICAgLnNldERlc2MoXG4gICAgICAgICdEZXRhaWxlZDogXCJ2c2EgXHUyNzEzIDEyc1wiIHdpdGggc3RhdGUgYW5kIGFnZS4gQ29tcGFjdDoganVzdCB0aGUgc3ltYm9sLiBIaWRkZW46IG5vIHN0YXR1cyBiYXIgaXRlbSBhdCBhbGwuJyxcbiAgICAgIClcbiAgICAgIC5hZGREcm9wZG93bigoZHJvcGRvd24pID0+IHtcbiAgICAgICAgZHJvcGRvd24uYWRkT3B0aW9uKCdkZXRhaWxlZCcsICdEZXRhaWxlZCcpO1xuICAgICAgICBkcm9wZG93bi5hZGRPcHRpb24oJ2NvbXBhY3QnLCAnQ29tcGFjdCcpO1xuICAgICAgICBkcm9wZG93bi5hZGRPcHRpb24oJ2hpZGRlbicsICdIaWRkZW4nKTtcbiAgICAgICAgZHJvcGRvd24uc2V0VmFsdWUoZGF0YS5zZXR0aW5ncy5zdGF0dXNCYXJNb2RlKTtcbiAgICAgICAgZHJvcGRvd24ub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uYXBwbHlTdGF0dXNCYXJNb2RlKFxuICAgICAgICAgICAgdmFsdWUgPT09ICdjb21wYWN0JyB8fCB2YWx1ZSA9PT0gJ2hpZGRlbicgPyB2YWx1ZSA6ICdkZXRhaWxlZCcsXG4gICAgICAgICAgKTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ0lnbm9yZSBwYXR0ZXJucycpXG4gICAgICAuc2V0RGVzYyhcbiAgICAgICAgJ09uZSBwYXR0ZXJuIHBlciBsaW5lLCBlLmcuIHByaXZhdGUvKiogb3IgKi50bXAuIEdsb2ItbGl0ZTogKiBtYXRjaGVzIHdpdGhpbiBvbmUgZm9sZGVyIG5hbWUsICoqIHNwYW5zIGZvbGRlcnMgKGRpci8qKiBza2lwcyB0aGUgZm9sZGVyIGFuZCBldmVyeXRoaW5nIGluIGl0KTsgYSBwYXR0ZXJuIHdpdGhvdXQgLyBtYXRjaGVzIGZpbGUgbmFtZXMgYXQgYW55IGRlcHRoLiBDYXNlLWluc2Vuc2l0aXZlOyBhcHBsaWVzIG9uIHRoaXMgZGV2aWNlIG9ubHk7IHNhdmluZyByZWNvbm5lY3RzIHN5bmMgdG8gYXBwbHkgdGhlbS4nLFxuICAgICAgKVxuICAgICAgLmFkZFRleHRBcmVhKChhcmVhKSA9PlxuICAgICAgICBhcmVhXG4gICAgICAgICAgLnNldFBsYWNlaG9sZGVyKCdwcml2YXRlLyoqXFxuKi50bXAnKVxuICAgICAgICAgIC5zZXRWYWx1ZShkYXRhLnNldHRpbmdzLmlnbm9yZVBhdHRlcm5zKVxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLmFwcGx5SWdub3JlUGF0dGVybnModmFsdWUpO1xuICAgICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ0RpYWdub3N0aWNzIGxvZyBsZXZlbCcpXG4gICAgICAuc2V0RGVzYyhcbiAgICAgICAgJ2luZm8gKGRlZmF1bHQpIHJlY29yZHMgbGlmZWN5Y2xlIGV2ZW50czsgZGVidWcgYWRkaXRpb25hbGx5IGxvZ3MgcHJvdG9jb2wgcm91bmQtdHJpcHMgKG9uZSBzaG9ydCBsaW5lIHBlciBmcmFtZSk7IHdhcm4ga2VlcHMgb25seSB3YXJuaW5ncyBhbmQgZXJyb3JzLicsXG4gICAgICApXG4gICAgICAuYWRkRHJvcGRvd24oKGRyb3Bkb3duKSA9PiB7XG4gICAgICAgIGRyb3Bkb3duLmFkZE9wdGlvbignaW5mbycsICdpbmZvJyk7XG4gICAgICAgIGRyb3Bkb3duLmFkZE9wdGlvbignZGVidWcnLCAnZGVidWcnKTtcbiAgICAgICAgZHJvcGRvd24uYWRkT3B0aW9uKCd3YXJuJywgJ3dhcm4nKTtcbiAgICAgICAgZHJvcGRvd24uc2V0VmFsdWUoZGF0YS5zZXR0aW5ncy5sb2dMZXZlbCk7XG4gICAgICAgIGRyb3Bkb3duLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIGNvbnN0IGxldmVsOiBMb2dMZXZlbCA9IHZhbHVlID09PSAnZGVidWcnIHx8IHZhbHVlID09PSAnd2FybicgPyB2YWx1ZSA6ICdpbmZvJztcbiAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5hcHBseUxvZ0xldmVsKGxldmVsKTtcbiAgICAgICAgfSk7XG4gICAgICB9KTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ0NvcHkgZGlhZ25vc3RpY3MnKVxuICAgICAgLnNldERlc2MoXG4gICAgICAgICdDb3BpZXMgYSBidWctcmVwb3J0IGJ1bmRsZTogcGx1Z2luICsgcHJvdG9jb2wgdmVyc2lvbnMsIGRldmljZSwgd29ya2VyIFVSTCwgcGFpcmluZyBzdGF0ZSwgYSBzdGF0dXMgc25hcHNob3QsIHRoZSBwbGF0Zm9ybSwgYW5kIHRoZSBsYXN0IDIwIGxvZyBsaW5lcy4nLFxuICAgICAgKVxuICAgICAgLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgICBidXR0b24uc2V0QnV0dG9uVGV4dCgnQ29weSBkaWFnbm9zdGljcycpLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGJ1dHRvbi5zZXREaXNhYmxlZCh0cnVlKTtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uY29weURpYWdub3N0aWNzKCk7XG4gICAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICAgIGJ1dHRvbi5zZXREaXNhYmxlZChmYWxzZSk7XG4gICAgICAgICAgfVxuICAgICAgICB9KSxcbiAgICAgICk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlckFib3V0U2VjdGlvbigpOiB2b2lkIHtcbiAgICBjb25zdCB7IGNvbnRhaW5lckVsIH0gPSB0aGlzO1xuICAgIHRoaXMuaGVhZGluZygnQWJvdXQnKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ1ZlcnNpb25zJylcbiAgICAgIC5zZXREZXNjKFxuICAgICAgICBgUGx1Z2luICR7dGhpcy5wbHVnaW4ubWFuaWZlc3QudmVyc2lvbiB8fCAndW5rbm93bid9IFx1MDBCNyBwcm90b2NvbCB2JHtQUk9UT0NPTF9WRVJTSU9OfSBcdTAwQjcgJHt0aGlzLnBsdWdpbi5wbGF0Zm9ybVN1bW1hcnkoKX1gLFxuICAgICAgKTtcblxuICAgIHRoaXMuc3RvcmFnZVNldHRpbmcgPSBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdWYXVsdCBzdG9yYWdlJylcbiAgICAgIC5zZXREZXNjKHRoaXMucGx1Z2luLmxpbmtlZCA/ICdDaGVja2luZyB0aGUgd29ya2VyXHUyMDI2JyA6ICdQYWlyIHRoaXMgdmF1bHQgdG8gc2VlIHN0b3JhZ2UgdXNhZ2UuJyk7XG4gICAgaWYgKHRoaXMucGx1Z2luLmxpbmtlZCkgdm9pZCB0aGlzLnJlZnJlc2hTdG9yYWdlKCk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdQcm9qZWN0IGhvbWUnKVxuICAgICAgLnNldERlc2MoYERvY3VtZW50YXRpb24gYW5kIHNvdXJjZTogJHtQUk9KRUNUX1JFQURNRV9VUkx9YClcbiAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoJ09wZW4gUkVBRE1FJykub25DbGljaygoKSA9PiBvcGVuUmVhZG1lUGFnZSgpKSxcbiAgICAgICk7XG4gIH1cblxuICAvKiogRmlsbCB0aGUgQWJvdXQgc3RvcmFnZSBsaW5lIGZyb20gL2FwaS9zdGF0dXMgKGRldmljZS10b2tlbiBhdXRoKS4gKi9cbiAgcHJpdmF0ZSBhc3luYyByZWZyZXNoU3RvcmFnZSgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBzdW1tYXJ5ID0gYXdhaXQgdGhpcy5wbHVnaW4uZmV0Y2hTdG9yYWdlU3VtbWFyeSgpO1xuICAgIGNvbnN0IGRlc2MgPVxuICAgICAgc3VtbWFyeSA9PT0gbnVsbFxuICAgICAgICA/ICdTdG9yYWdlIHVzYWdlIGlzIGN1cnJlbnRseSB1bmF2YWlsYWJsZSAodGhlIHdvcmtlciBpcyB1bnJlYWNoYWJsZSkuJ1xuICAgICAgICA6IGBTdG9yYWdlIHVzZWQ6ICR7Zm9ybWF0Qnl0ZXMoc3VtbWFyeS5zdG9yYWdlQnl0ZXMpfSBcdTAwQjcgJHtzdW1tYXJ5LmF0dGFjaG1lbnRzLmNvdW50fSBhdHRhY2htZW50JHtcbiAgICAgICAgICAgIHN1bW1hcnkuYXR0YWNobWVudHMuY291bnQgPT09IDEgPyAnJyA6ICdzJ1xuICAgICAgICAgIH0gKCR7Zm9ybWF0Qnl0ZXMoc3VtbWFyeS5hdHRhY2htZW50cy5ieXRlcyl9KWAgK1xuICAgICAgICAgIChzdW1tYXJ5LmRldmljZXMubGVuZ3RoID4gMFxuICAgICAgICAgICAgPyBgIFx1MDBCNyAke3N1bW1hcnkuZGV2aWNlcy5sZW5ndGh9IGRldmljZSR7c3VtbWFyeS5kZXZpY2VzLmxlbmd0aCA9PT0gMSA/ICcnIDogJ3MnfWBcbiAgICAgICAgICAgIDogJycpO1xuICAgIC8vIFRoZSB0YWIgbWF5IGhhdmUgYmVlbiBjbG9zZWQvcmUtcmVuZGVyZWQgbWVhbndoaWxlOyBwYWludCBvbmx5IGlmIGxpdmUuXG4gICAgaWYgKHRoaXMuc3RvcmFnZVNldHRpbmcgIT09IG51bGwpIHRoaXMuc3RvcmFnZVNldHRpbmcuc2V0RGVzYyhkZXNjKTtcbiAgfVxuXG4gIC8vIC0tLSBzdGF0dXMgLyBmZWVkYmFjayAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIHByaXZhdGUgc3RhdHVzVGV4dCgpOiBzdHJpbmcge1xuICAgIGNvbnN0IGRhdGE6IFZhdWx0U3luY1BsdWdpbkRhdGEgPSB0aGlzLnBsdWdpbi5kYXRhO1xuICAgIGNvbnN0IHN0YXR1cyA9IHRoaXMucGx1Z2luLmNsaWVudD8uc3RhdHVzKCk7XG4gICAgaWYgKHRoaXMucGx1Z2luLnN5bmNpbmdQYXVzZWQpIHtcbiAgICAgIHJldHVybiBbXG4gICAgICAgICdTdGF0ZTogcGF1c2VkJyxcbiAgICAgICAgYFdvcmtlcjogJHtkYXRhLnVybH1gLFxuICAgICAgICAnVmF1bHQgY2hhbmdlcyBzdGF5IGxvY2FsIHVudGlsIHlvdSByZXN1bWUgc3luY2luZy4nLFxuICAgICAgXS5qb2luKCdcXG4nKTtcbiAgICB9XG4gICAgaWYgKHN0YXR1cyA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICByZXR1cm4gYExpbmtlZCB0byAke2RhdGEudXJsfSAoZGV2aWNlICR7ZGF0YS5kZXZpY2VOYW1lIHx8IGRhdGEuZGV2aWNlSWR9KS5gO1xuICAgIH1cbiAgICBjb25zdCBsYXN0U3luYyA9XG4gICAgICBzdGF0dXMubGFzdFN5bmNBdCA9PT0gbnVsbFxuICAgICAgICA/ICduZXZlcidcbiAgICAgICAgOiBgJHtmb3JtYXRTaW5jZShEYXRlLm5vdygpIC0gc3RhdHVzLmxhc3RTeW5jQXQpfSBhZ29gO1xuICAgIGNvbnN0IHN0YXRlID0gc3RhdHVzLnN0YXRlID09PSAnbGl2ZScgPyAnY29ubmVjdGVkJyA6IHN0YXR1cy5zdGF0ZTtcbiAgICBjb25zdCBsaW5lcyA9IFtgU3RhdGU6ICR7c3RhdGV9YCwgYFdvcmtlcjogJHtkYXRhLnVybH1gLCBgTGFzdCBzeW5jOiAke2xhc3RTeW5jfWBdO1xuICAgIC8vIEJ1bGstcGhhc2UgcHJvZ3Jlc3MgXHUyMDE0IHRoZSBzYW1lIFgvWSB0aGUgc3RhdHVzIGJhciBzaG93cyBkdXJpbmcgYVxuICAgIC8vIG11bHRpLW1pbnV0ZSBpbml0aWFsIHN5bmMuXG4gICAgaWYgKHN0YXR1cy5wcm9ncmVzcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBsaW5lcy5wdXNoKGBTeW5jaW5nOiAke3N0YXR1cy5wcm9ncmVzcy5kb25lfS8ke3N0YXR1cy5wcm9ncmVzcy50b3RhbH0gKCR7c3RhdHVzLnByb2dyZXNzLnBoYXNlfSlgKTtcbiAgICB9XG4gICAgbGluZXMucHVzaChcbiAgICAgIGBQZW5kaW5nIGNoYW5nZXM6ICR7c3RhdHVzLnBlbmRpbmd9YCxcbiAgICAgIGBDb25mbGljdHM6ICR7c3RhdHVzLmNvbmZsaWN0cy5sZW5ndGh9JHtzdGF0dXMuY29uZmxpY3RzLmxlbmd0aCA+IDAgPyAnIChjb25mbGljdCBjb3BpZXMgd2VyZSB3cml0dGVuIGludG8gdGhlIHZhdWx0KScgOiAnJ31gLFxuICAgICk7XG4gICAgcmV0dXJuIGxpbmVzLmpvaW4oJ1xcbicpO1xuICB9XG5cbiAgcHJpdmF0ZSByZWZyZXNoU3RhdHVzKCk6IHZvaWQge1xuICAgIHRoaXMuc3RhdHVzU2V0dGluZz8uc2V0RGVzYyh0aGlzLnN0YXR1c1RleHQoKSk7XG4gIH1cblxuICAvKiogUGFpciBmZWVkYmFjazogc3VjY2VzcyByZS1yZW5kZXJzOyBmYWlsdXJlcyBsYW5kIGluIHRoZSBoaW50IFNldHRpbmcuICovXG4gIHByaXZhdGUgc2hvd091dGNvbWUob3V0Y29tZTogUGFpck91dGNvbWUpOiB2b2lkIHtcbiAgICBpZiAob3V0Y29tZS5zdGF0dXMgPT09ICdwYWlyZWQnKSB7XG4gICAgICBuZXcgTm90aWNlKHBhaXJPdXRjb21lTWVzc2FnZShvdXRjb21lKSk7XG4gICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgbWVzc2FnZSA9IHBhaXJPdXRjb21lTWVzc2FnZShvdXRjb21lKTtcbiAgICBuZXcgTm90aWNlKG1lc3NhZ2UsIDEwMDAwKTtcbiAgICBpZiAodGhpcy5oaW50U2V0dGluZyAhPT0gbnVsbCkgdGhpcy5oaW50U2V0dGluZy5zZXREZXNjKG1lc3NhZ2UpO1xuICB9XG5cbiAgLy8gLS0tIGxpdmUgcmVmcmVzaCBsb29wIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIC8qKiBSZWZyZXNoIHRoZSBzdGF0dXMgcmVhZG91dCB+MSBIeiB3aGlsZSB0aGUgdGFiIGlzIG9wZW4uICovXG4gIHByaXZhdGUgc3RhcnRSZWZyZXNoKCk6IHZvaWQge1xuICAgIHRoaXMuc3RvcFJlZnJlc2goKTtcbiAgICBjb25zdCBoYW5kbGUgPSBzZXRJbnRlcnZhbCgoKSA9PiB0aGlzLnJlZnJlc2hTdGF0dXMoKSwgMTAwMCk7XG4gICAgdGhpcy5yZWZyZXNoSGFuZGxlID0gaGFuZGxlO1xuICAgIC8vIE9ic2lkaWFuIGNsZWFycyByZWdpc3RlcmVkIGludGVydmFscyB3aGVuIHRoZSBwbHVnaW4gdW5sb2FkcyBcdTIwMTQgbm8gbGVha1xuICAgIC8vIGV2ZW4gaWYgdGhlIHNldHRpbmdzIG1vZGFsIGlzIGZvcmNlLWNsb3NlZC5cbiAgICB0aGlzLnBsdWdpbi5yZWdpc3RlckludGVydmFsKGhhbmRsZSBhcyB1bmtub3duIGFzIG51bWJlcik7XG4gIH1cblxuICBwcml2YXRlIHN0b3BSZWZyZXNoKCk6IHZvaWQge1xuICAgIGlmICh0aGlzLnJlZnJlc2hIYW5kbGUgIT09IG51bGwpIHtcbiAgICAgIGNsZWFySW50ZXJ2YWwodGhpcy5yZWZyZXNoSGFuZGxlKTtcbiAgICAgIHRoaXMucmVmcmVzaEhhbmRsZSA9IG51bGw7XG4gICAgfVxuICB9XG59XG4iLCAiLyoqXG4gKiBTdGF0dXMtYmFyIGluZGljYXRvciAocGx1Z2luIHNjb3BlIGl0ZW0gIzUpOiBhIHNtYWxsIHBhc3NpdmUgdmlldyBvdmVyXG4gKiBgU3luY0NsaWVudFN0YXR1c2AsIHJlcGFpbnRlZCBieSB0aGUgcGx1Z2luJ3MgMSBzIHN1cGVydmlzaW9uIHRpY2suXG4gKlxuICogICB2c2EgXHUyMkVGICAgICAgICAgICAgICBjb25uZWN0aW5nIC8gc3luY2luZ1xuICogICB2c2EgXHUyMkVGIDEyMzQvNTAwMCAgICBzeW5jaW5nLCBidWxrIHBoYXNlIHByb2dyZXNzIChzY2FubmluZy9wdXNoaW5nL3B1bGxpbmcpXG4gKiAgIHZzYSBcdTI3MTMgMTJzICAgICAgICAgIGxpdmUsIGxhc3QgY29tcGxldGVkIGN5Y2xlIDEyIHMgYWdvXG4gKiAgIHZzYSBcdTI2QTAgY29uZmxpY3RzOiAyIGNvbmZsaWN0cyBvYnNlcnZlZCAoY29uZmxpY3QgY29waWVzIGV4aXN0IGluIHRoZSB2YXVsdClcbiAqICAgdnNhIFx1MjcxNyBvZmZsaW5lICAgICAgZGlzY29ubmVjdGVkIChyZWNvbm5lY3QgYmFja29mZiBydW5uaW5nKVxuICogICB2c2EgXHUyM0Y4ICAgICAgICAgICAgICBzeW5jaW5nIHBhdXNlZCAodGhlIFBhdXNlIHN5bmNpbmcgc2V0dGluZylcbiAqXG4gKiBDb21wYWN0IG1vZGUgZHJvcHMgdGhlIHRyYWlsaW5nIGRldGFpbCAoXCJ2c2EgXHUyNzEzIDEyc1wiIFx1MjE5MiBcInZzYSBcdTI3MTNcIiwgZXRjLik7XG4gKiBIaWRkZW4gbW9kZSByZW1vdmVzIHRoZSBpdGVtIGVudGlyZWx5ICh0aGUgcGx1Z2luIG5ldmVyIG1vdW50cyBpdCkuXG4gKlxuICogVGhlIHRvb2x0aXAgY2FycmllcyB0aGUgZGV0YWlsOiBzdGF0ZSwgd29ya2VyIFVSTCwgZGV2aWNlLCBsYXN0IHN5bmMsIHBlbmRpbmcuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBTeW5jQ2xpZW50U3RhdHVzIH0gZnJvbSAnQHZzYS9jb3JlJztcblxuLyoqIEhvdyB0aGUgc3RhdHVzLWJhciBpbmRpY2F0b3IgcmVuZGVycyAodGhlIFwiU3RhdHVzIGJhciBpbmRpY2F0b3JcIiBzZXR0aW5nKS4gKi9cbmV4cG9ydCB0eXBlIFN0YXR1c0Jhck1vZGUgPSAnZGV0YWlsZWQnIHwgJ2NvbXBhY3QnIHwgJ2hpZGRlbic7XG5cbi8qKiBUaGUgc2xpY2Ugb2YgSFRNTEVsZW1lbnQgdGhlIGluZGljYXRvciB0b3VjaGVzICh0ZXN0cyBwYXNzIGEgcGxhaW4gb2JqZWN0KS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU3RhdHVzSXRlbUxpa2Uge1xuICB0ZXh0Q29udGVudDogc3RyaW5nO1xuICBhZGRDbGFzcz8oY2xzOiBzdHJpbmcpOiB1bmtub3duO1xuICByZW1vdmVDbGFzcz8oY2xzOiBzdHJpbmcpOiB1bmtub3duO1xuICBzZXRBdHRyaWJ1dGU/KG5hbWU6IHN0cmluZywgdmFsdWU6IHN0cmluZyk6IHVua25vd247XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgU3RhdHVzQ29udGV4dCB7XG4gIHVybDogc3RyaW5nO1xuICBkZXZpY2VOYW1lOiBzdHJpbmc7XG4gIC8qKiBFeHRyYSBsaW5lIChlLmcuIGFuIGF1dGggZmFpbHVyZSBub3RlKSBhcHBlbmRlZCB0byB0aGUgdG9vbHRpcC4gKi9cbiAgbm90ZT86IHN0cmluZztcbiAgLyoqIFN5bmNpbmcgaXMgcGF1c2VkICh0aGUgUGF1c2Ugc3luY2luZyBidXR0b24pIFx1MjAxNCBzaG93cyBcInZzYSBcdTIzRjhcIi4gKi9cbiAgcGF1c2VkPzogYm9vbGVhbjtcbiAgLyoqIEluZGljYXRvciBtb2RlICh0aGUgcGx1Z2luJ3Mgc3RhdHVzIGJhciBzZXR0aW5nKTsgZGVmYXVsdCBkZXRhaWxlZC4gKi9cbiAgbW9kZT86IFN0YXR1c0Jhck1vZGU7XG59XG5cbi8qKiBgbm93IC0gc2luY2VgLCBmbG9vcmVkOiBgMTJzYCwgYDVtYCwgYDNoYCBcdTIwMTQgZGlzcGxheSBvbmx5LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdFNpbmNlKGVsYXBzZWRNczogbnVtYmVyKTogc3RyaW5nIHtcbiAgY29uc3Qgc2Vjb25kcyA9IE1hdGgubWF4KDAsIE1hdGguZmxvb3IoZWxhcHNlZE1zIC8gMTAwMCkpO1xuICBpZiAoc2Vjb25kcyA8IDYwKSByZXR1cm4gYCR7c2Vjb25kc31zYDtcbiAgY29uc3QgbWludXRlcyA9IE1hdGguZmxvb3Ioc2Vjb25kcyAvIDYwKTtcbiAgaWYgKG1pbnV0ZXMgPCA2MCkgcmV0dXJuIGAke21pbnV0ZXN9bWA7XG4gIHJldHVybiBgJHtNYXRoLmZsb29yKG1pbnV0ZXMgLyA2MCl9aGA7XG59XG5cbi8qKlxuICogVGhlIG9uZS1saW5lIHN0YXR1cyB0ZXh0IGZvciBhIGNsaWVudCBzdGF0dXMgYXQgdGltZSBgbm93YC4gYG1vZGVgIHNocmlua3NcbiAqIHRoZSBsaW5lIChjb21wYWN0IGRyb3BzIHRoZSB0cmFpbGluZyBkZXRhaWwpOyBgcGF1c2VkYCB3aW5zIG92ZXIgZXZlcnl0aGluZy5cbiAqXG4gKiBEdXJpbmcgYSBidWxrIHBoYXNlIChgc3RhdHVzLnByb2dyZXNzYCBcdTIwMTQgc2Nhbm5pbmcvcHVzaGluZy9wdWxsaW5nIG9mIGFcbiAqIG11bHRpLW1pbnV0ZSBpbml0aWFsIHN5bmMpIGJvdGggZGV0YWlsIGxldmVscyBzaG93IHRoZSBjb3VudHMgXHUyMDE0XG4gKiBgdnNhIFx1MjJFRiAxMjM0LzUwMDBgIFx1MjAxNCBiZWNhdXNlIHRoYXQgaXMgdGhlIG9uZSB0aGluZyBhIHVzZXIgd2FpdGluZyBvbiBhIGJpZ1xuICogc3luYyBuZWVkczsgaGlkZGVuIG1vZGUgc2hvd3Mgbm90aGluZyAodGhlIGl0ZW0gaXMgbmV2ZXIgbW91bnRlZCkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdGF0dXNMaW5lRm9yKFxuICBzdGF0dXM6IFN5bmNDbGllbnRTdGF0dXMsXG4gIG5vdzogbnVtYmVyLFxuICBtb2RlOiBTdGF0dXNCYXJNb2RlID0gJ2RldGFpbGVkJyxcbiAgcGF1c2VkID0gZmFsc2UsXG4pOiBzdHJpbmcge1xuICBpZiAocGF1c2VkKSByZXR1cm4gJ3ZzYSBcdTIzRjgnO1xuICBjb25zdCBjb21wYWN0ID0gbW9kZSA9PT0gJ2NvbXBhY3QnO1xuICBzd2l0Y2ggKHN0YXR1cy5zdGF0ZSkge1xuICAgIGNhc2UgJ2Nvbm5lY3RpbmcnOlxuICAgIGNhc2UgJ3N5bmNpbmcnOiB7XG4gICAgICBjb25zdCBwcm9ncmVzcyA9IHN0YXR1cy5wcm9ncmVzcztcbiAgICAgIGlmIChwcm9ncmVzcyAhPT0gdW5kZWZpbmVkKSByZXR1cm4gYHZzYSBcdTIyRUYgJHtwcm9ncmVzcy5kb25lfS8ke3Byb2dyZXNzLnRvdGFsfWA7XG4gICAgICByZXR1cm4gJ3ZzYSBcdTIyRUYnO1xuICAgIH1cbiAgICBjYXNlICdkaXNjb25uZWN0ZWQnOlxuICAgICAgcmV0dXJuIGNvbXBhY3QgPyAndnNhIFx1MjcxNycgOiAndnNhIFx1MjcxNyBvZmZsaW5lJztcbiAgICBjYXNlICdsaXZlJzpcbiAgICAgIGlmIChzdGF0dXMuY29uZmxpY3RzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgcmV0dXJuIGNvbXBhY3QgPyAndnNhIFx1MjZBMCcgOiBgdnNhIFx1MjZBMCBjb25mbGljdHM6ICR7c3RhdHVzLmNvbmZsaWN0cy5sZW5ndGh9YDtcbiAgICAgIH1cbiAgICAgIGlmIChzdGF0dXMubGFzdFN5bmNBdCA9PT0gbnVsbCB8fCBjb21wYWN0KSByZXR1cm4gJ3ZzYSBcdTI3MTMnO1xuICAgICAgcmV0dXJuIGB2c2EgXHUyNzEzICR7Zm9ybWF0U2luY2Uobm93IC0gc3RhdHVzLmxhc3RTeW5jQXQpfWA7XG4gICAgY2FzZSAnaWRsZSc6XG4gICAgICByZXR1cm4gJ3ZzYSc7XG4gIH1cbn1cblxuLyoqIFRvb2x0aXAgbGluZXMgKGpvaW5lZCB3aXRoIGBcXG5gKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdGF0dXNUb29sdGlwRm9yKHN0YXR1czogU3luY0NsaWVudFN0YXR1cywgY29udGV4dDogU3RhdHVzQ29udGV4dCwgbm93OiBudW1iZXIpOiBzdHJpbmcge1xuICBjb25zdCBzdGF0ZUxhYmVsOiBSZWNvcmQ8U3luY0NsaWVudFN0YXR1c1snc3RhdGUnXSwgc3RyaW5nPiA9IHtcbiAgICBpZGxlOiAnbm90IHJ1bm5pbmcnLFxuICAgIGNvbm5lY3Rpbmc6ICdjb25uZWN0aW5nXHUyMDI2JyxcbiAgICBzeW5jaW5nOiAnc3luY2luZ1x1MjAyNicsXG4gICAgbGl2ZTogJ2xpdmUnLFxuICAgIGRpc2Nvbm5lY3RlZDogJ29mZmxpbmUgXHUyMDE0IHJlY29ubmVjdGluZycsXG4gIH07XG4gIGNvbnN0IGhlYWRsaW5lID0gY29udGV4dC5wYXVzZWQgPT09IHRydWUgPyAncGF1c2VkJyA6IHN0YXRlTGFiZWxbc3RhdHVzLnN0YXRlXTtcbiAgY29uc3QgbGluZXMgPSBbYFZhdWx0U3luYyBmb3IgQWdlbnRzIFx1MjAxNCAke2hlYWRsaW5lfWBdO1xuICBpZiAoY29udGV4dC51cmwgIT09ICcnKSBsaW5lcy5wdXNoKGBXb3JrZXI6ICR7Y29udGV4dC51cmx9YCk7XG4gIGlmIChjb250ZXh0LmRldmljZU5hbWUgIT09ICcnKSBsaW5lcy5wdXNoKGBEZXZpY2U6ICR7Y29udGV4dC5kZXZpY2VOYW1lfWApO1xuICBsaW5lcy5wdXNoKFxuICAgIHN0YXR1cy5sYXN0U3luY0F0ID09PSBudWxsXG4gICAgICA/ICdMYXN0IHN5bmM6IG5ldmVyJ1xuICAgICAgOiBgTGFzdCBzeW5jOiAke2Zvcm1hdFNpbmNlKG5vdyAtIHN0YXR1cy5sYXN0U3luY0F0KX0gYWdvYCxcbiAgKTtcbiAgaWYgKHN0YXR1cy5wcm9ncmVzcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgbGluZXMucHVzaChgU3luY2luZzogJHtzdGF0dXMucHJvZ3Jlc3MuZG9uZX0vJHtzdGF0dXMucHJvZ3Jlc3MudG90YWx9ICgke3N0YXR1cy5wcm9ncmVzcy5waGFzZX0pYCk7XG4gIH1cbiAgbGluZXMucHVzaChgUGVuZGluZyBjaGFuZ2VzOiAke3N0YXR1cy5wZW5kaW5nfWApO1xuICBsaW5lcy5wdXNoKGBDb25mbGljdHM6ICR7c3RhdHVzLmNvbmZsaWN0cy5sZW5ndGh9YCk7XG4gIGlmIChzdGF0dXMuY29uZmxpY3RzLmxlbmd0aCA+IDApIHtcbiAgICBsaW5lcy5wdXNoKGBDb25mbGljdCBjb3BpZXM6ICR7c3RhdHVzLmNvbmZsaWN0cy5tYXAoKGMpID0+IGMucGF0aCkuam9pbignLCAnKX1gKTtcbiAgfVxuICBpZiAoY29udGV4dC5ub3RlICE9PSB1bmRlZmluZWQgJiYgY29udGV4dC5ub3RlICE9PSAnJykgbGluZXMucHVzaChjb250ZXh0Lm5vdGUpO1xuICByZXR1cm4gbGluZXMuam9pbignXFxuJyk7XG59XG5cbi8qKiBDU1MgbW9kaWZpZXIgZm9yIHRoZSBpbmRpY2F0b3IgKHRpbnRlZCB3YXJuaW5nL2Vycm9yIHN0YXRlcykuICovXG5leHBvcnQgZnVuY3Rpb24gc3RhdHVzQ2xhc3NGb3Ioc3RhdHVzOiBTeW5jQ2xpZW50U3RhdHVzKTogc3RyaW5nIHtcbiAgaWYgKHN0YXR1cy5zdGF0ZSA9PT0gJ2Rpc2Nvbm5lY3RlZCcpIHJldHVybiAndnNhLWVycm9yJztcbiAgaWYgKHN0YXR1cy5jb25mbGljdHMubGVuZ3RoID4gMCkgcmV0dXJuICd2c2Etd2Fybic7XG4gIHJldHVybiAnJztcbn1cblxuLyoqXG4gKiBQYWludHMgb25lIHN0YXR1cy1iYXIgaXRlbS4gUGFzc2l2ZTogdGhlIHBsdWdpbiBjYWxscyBgdXBkYXRlKClgIGZyb20gaXRzXG4gKiBzdXBlcnZpc2lvbiB0aWNrIFx1MjAxNCBubyB0aW1lcnMgb2YgaXRzIG93biB0byBsZWFrLlxuICovXG5leHBvcnQgY2xhc3MgU3RhdHVzQmFySW5kaWNhdG9yIHtcbiAgLyoqIEFsd2F5cyBvbiBcdTIwMTQgdGhlIGJhc2UgY2xhc3Mgc3R5bGVzLmNzcyB0YXJnZXRzLiAqL1xuICBwcml2YXRlIHN0YXRpYyByZWFkb25seSBCQVNFX0NMQVNTID0gJ3ZzYS1zdGF0dXMnO1xuICBwcml2YXRlIHN0YXRpYyByZWFkb25seSBNT0RJRklFUl9DTEFTU0VTID0gWyd2c2Etd2FybicsICd2c2EtZXJyb3InXTtcblxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IGl0ZW06IFN0YXR1c0l0ZW1MaWtlKSB7fVxuXG4gIHVwZGF0ZShzdGF0dXM6IFN5bmNDbGllbnRTdGF0dXMsIGNvbnRleHQ6IFN0YXR1c0NvbnRleHQsIG5vdzogbnVtYmVyKTogdm9pZCB7XG4gICAgdGhpcy5pdGVtLnRleHRDb250ZW50ID0gc3RhdHVzTGluZUZvcihzdGF0dXMsIG5vdywgY29udGV4dC5tb2RlID8/ICdkZXRhaWxlZCcsIGNvbnRleHQucGF1c2VkID09PSB0cnVlKTtcbiAgICB0aGlzLml0ZW0uYWRkQ2xhc3M/LihTdGF0dXNCYXJJbmRpY2F0b3IuQkFTRV9DTEFTUyk7XG4gICAgY29uc3QgbW9kaWZpZXIgPSBzdGF0dXNDbGFzc0ZvcihzdGF0dXMpO1xuICAgIGZvciAoY29uc3QgY2xzIG9mIFN0YXR1c0JhckluZGljYXRvci5NT0RJRklFUl9DTEFTU0VTKSB7XG4gICAgICBpZiAoY2xzID09PSBtb2RpZmllcikgdGhpcy5pdGVtLmFkZENsYXNzPy4oY2xzKTtcbiAgICAgIGVsc2UgdGhpcy5pdGVtLnJlbW92ZUNsYXNzPy4oY2xzKTtcbiAgICB9XG4gICAgdGhpcy5pdGVtLnNldEF0dHJpYnV0ZT8uKCd0aXRsZScsIHN0YXR1c1Rvb2x0aXBGb3Ioc3RhdHVzLCBjb250ZXh0LCBub3cpKTtcbiAgfVxufVxuIiwgIi8qKlxuICogYFdlYlNvY2tldFRyYW5zcG9ydGAgXHUyMDE0IGNvcmUncyBgVHJhbnNwb3J0YCBvdmVyIHRoZSBnbG9iYWwgYFdlYlNvY2tldGBcbiAqIChwcmVzZW50IGluIE9ic2lkaWFuIGRlc2t0b3AgKmFuZCogbW9iaWxlOyBmZWF0dXJlLWNoZWNrZWQgd2l0aCBhIGNsZWFyXG4gKiBlcnJvciBmb3IgZXhvdGljIGJ1aWxkcykuXG4gKlxuICogVGhpcyBtaXJyb3JzIGBAdnNhL25vZGUtcnVudGltZWAncyB0cmFuc3BvcnQgb24gcHVycG9zZSAoc2FtZSB3aXJlIGZvcm1hdDpcbiAqIG9uZSBKU09OIHRleHQgZnJhbWUgcGVyIG1lc3NhZ2UsIGNvcmUncyBgcGFyc2VNZXNzYWdlYCBvbiByZWNlaXZlLCBxdWV1ZWRcbiAqIHNlbmRzIGJlZm9yZSBvcGVuKSBidXQgc2hhcmVzIG5vIGNvZGUgd2l0aCBpdCBcdTIwMTQgYEB2c2Evbm9kZS1ydW50aW1lYCBpc1xuICogTm9kZS1vbmx5IGFuZCBtdXN0IG5ldmVyIGJlIGEgcGx1Z2luIGRlcGVuZGVuY3kuXG4gKi9cblxuaW1wb3J0IHsgTmV0d29ya0Vycm9yLCBwYXJzZU1lc3NhZ2UgfSBmcm9tICdAdnNhL2NvcmUnO1xuaW1wb3J0IHR5cGUgeyBDbG9zZVJlYXNvbiwgTWVzc2FnZSwgVHJhbnNwb3J0IH0gZnJvbSAnQHZzYS9jb3JlJztcblxuLyoqXG4gKiBUaGUgbWluaW1hbCBXZWJTb2NrZXQgc3VyZmFjZSB0aGlzIHRyYW5zcG9ydCBuZWVkcy4gSW5qZWN0YWJsZSBzbyB0ZXN0c1xuICogKGFuZCBleG90aWMgcnVudGltZXMpIGNhbiBzdXBwbHkgYSBmYWtlOyBwcm9kdWN0aW9uIHVzZXMgdGhlIGdsb2JhbC5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBXZWJTb2NrZXRMaWtlIHtcbiAgc2VuZChkYXRhOiBzdHJpbmcpOiB2b2lkO1xuICBjbG9zZShjb2RlPzogbnVtYmVyLCByZWFzb24/OiBzdHJpbmcpOiB2b2lkO1xuICBhZGRFdmVudExpc3RlbmVyKHR5cGU6ICdvcGVuJywgbGlzdGVuZXI6ICgpID0+IHZvaWQpOiB2b2lkO1xuICBhZGRFdmVudExpc3RlbmVyKHR5cGU6ICdtZXNzYWdlJywgbGlzdGVuZXI6IChldmVudDogeyBkYXRhOiB1bmtub3duIH0pID0+IHZvaWQpOiB2b2lkO1xuICBhZGRFdmVudExpc3RlbmVyKHR5cGU6ICdjbG9zZScsIGxpc3RlbmVyOiAoZXZlbnQ6IHsgY29kZT86IG51bWJlcjsgcmVhc29uPzogc3RyaW5nIH0pID0+IHZvaWQpOiB2b2lkO1xuICBhZGRFdmVudExpc3RlbmVyKHR5cGU6ICdlcnJvcicsIGxpc3RlbmVyOiAoZXZlbnQ6IHVua25vd24pID0+IHZvaWQpOiB2b2lkO1xufVxuXG5leHBvcnQgdHlwZSBXZWJTb2NrZXRGYWN0b3J5ID0gKHVybDogc3RyaW5nKSA9PiBXZWJTb2NrZXRMaWtlO1xuXG5leHBvcnQgaW50ZXJmYWNlIFdlYlNvY2tldFRyYW5zcG9ydE9wdGlvbnMge1xuICAvKiogV29ya2VyIG9yaWdpbiAoYGh0dHBzOi8vcGVyc29uYWwueC53b3JrZXJzLmRldmApIG9yIGEgYHdzKHMpOi8vYCBVUkwuICovXG4gIHVybDogc3RyaW5nO1xuICAvKiogRGV2aWNlIHRva2VuIFx1MjAxNCBjYXJyaWVkIGluIHRoZSBxdWVyeSBzdHJpbmcgKHRoZSB3b3JrZXIncyBwcmUtYXV0aCBwYXRoKS4gKi9cbiAgdG9rZW46IHN0cmluZztcbiAgLyoqIFdTIHBhdGggb24gdGhlIHdvcmtlciAoZGVmYXVsdCBgL3dzYDsgYC9zeW5jYCBpcyBlcXVpdmFsZW50KS4gKi9cbiAgcGF0aD86IHN0cmluZztcbiAgLyoqIEluamVjdGFibGUgc29ja2V0IGZhY3RvcnkgKHRlc3RzKS4gRGVmYXVsdDogdGhlIGdsb2JhbCBgV2ViU29ja2V0YC4gKi9cbiAgd3NGYWN0b3J5PzogV2ViU29ja2V0RmFjdG9yeTtcbn1cblxuLyoqXG4gKiBCdWlsZCB0aGUgYXV0aGVudGljYXRlZCBXUyBVUkw6IGBodHRwczovL3hgIFx1MjE5MiBgd3NzOi8veC93cz90b2tlbj1cdTIwMjZgLlxuICogVGhyb3dzIG9uIG5vbi1IVFRQKFMpL1dTIHNjaGVtZXMgb3IgdW5wYXJzYWJsZSBpbnB1dC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHRvV2ViU29ja2V0VXJsKGJhc2VVcmw6IHN0cmluZywgdG9rZW46IHN0cmluZywgcGF0aCA9ICcvd3MnKTogc3RyaW5nIHtcbiAgY29uc3QgdXJsID0gbmV3IFVSTChiYXNlVXJsKTtcbiAgaWYgKHVybC5wcm90b2NvbCA9PT0gJ2h0dHA6JykgdXJsLnByb3RvY29sID0gJ3dzOic7XG4gIGVsc2UgaWYgKHVybC5wcm90b2NvbCA9PT0gJ2h0dHBzOicpIHVybC5wcm90b2NvbCA9ICd3c3M6JztcbiAgZWxzZSBpZiAodXJsLnByb3RvY29sICE9PSAnd3M6JyAmJiB1cmwucHJvdG9jb2wgIT09ICd3c3M6Jykge1xuICAgIHRocm93IG5ldyBOZXR3b3JrRXJyb3IoYHdvcmtlciBVUkwgbXVzdCBiZSBodHRwKHMpOi8vIG9yIHdzKHMpOi8vLCBnb3QgJHt1cmwucHJvdG9jb2x9YCk7XG4gIH1cbiAgdXJsLnBhdGhuYW1lID0gcGF0aDtcbiAgdXJsLnNlYXJjaCA9ICcnO1xuICB1cmwuc2VhcmNoUGFyYW1zLnNldCgndG9rZW4nLCB0b2tlbik7XG4gIHJldHVybiB1cmwudG9TdHJpbmcoKTtcbn1cblxuZnVuY3Rpb24gZGVmYXVsdFdlYlNvY2tldEZhY3RvcnkodXJsOiBzdHJpbmcpOiBXZWJTb2NrZXRMaWtlIHtcbiAgY29uc3Qgd2Vic29ja2V0ID0gKGdsb2JhbFRoaXMgYXMgeyBXZWJTb2NrZXQ/OiB1bmtub3duIH0pLldlYlNvY2tldDtcbiAgaWYgKHR5cGVvZiB3ZWJzb2NrZXQgIT09ICdmdW5jdGlvbicpIHtcbiAgICB0aHJvdyBuZXcgTmV0d29ya0Vycm9yKFxuICAgICAgJ1dlYlNvY2tldCBpcyBub3QgYXZhaWxhYmxlIGluIHRoaXMgT2JzaWRpYW4gYnVpbGQgKGl0IGlzIGJ1aWx0IGluIG9uIGRlc2t0b3AgYW5kICcgK1xuICAgICAgICAnbW9iaWxlOyBhIHZlcnkgb2xkIGFwcCB2ZXJzaW9uIG9yIGEgc3RyaXBwZWQgd2VidmlldyBpcyB0aGUgb25seSBrbm93biBjYXVzZSkuICcgK1xuICAgICAgICAnU3luYyByZXF1aXJlcyBpdC4nLFxuICAgICk7XG4gIH1cbiAgcmV0dXJuIG5ldyAod2Vic29ja2V0IGFzIG5ldyAodXJsOiBzdHJpbmcpID0+IFdlYlNvY2tldExpa2UpKHVybCk7XG59XG5cbmV4cG9ydCBjbGFzcyBXZWJTb2NrZXRUcmFuc3BvcnQgaW1wbGVtZW50cyBUcmFuc3BvcnQge1xuICBwcml2YXRlIHJlYWRvbmx5IHNvY2tldDogV2ViU29ja2V0TGlrZTtcbiAgcHJpdmF0ZSBtZXNzYWdlQ2FsbGJhY2s6ICgobWVzc2FnZTogTWVzc2FnZSkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBjbG9zZUNhbGxiYWNrOiAoKHJlYXNvbjogQ2xvc2VSZWFzb24pID0+IHZvaWQpIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgb3BlbiA9IGZhbHNlO1xuICBwcml2YXRlIGNsb3NlZCA9IGZhbHNlO1xuICBwcml2YXRlIGNsb3NlTm90aWZpZWQgPSBmYWxzZTtcbiAgcHJpdmF0ZSByZWFkb25seSBzZW5kUXVldWU6IHN0cmluZ1tdID0gW107XG4gIHByaXZhdGUgbGFzdEVycm9yOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG5cbiAgY29uc3RydWN0b3Iob3B0aW9uczogV2ViU29ja2V0VHJhbnNwb3J0T3B0aW9ucykge1xuICAgIGNvbnN0IGZhY3RvcnkgPSBvcHRpb25zLndzRmFjdG9yeSA/PyBkZWZhdWx0V2ViU29ja2V0RmFjdG9yeTtcbiAgICBjb25zdCB1cmwgPSB0b1dlYlNvY2tldFVybChvcHRpb25zLnVybCwgb3B0aW9ucy50b2tlbiwgb3B0aW9ucy5wYXRoID8/ICcvd3MnKTtcbiAgICB0aGlzLnNvY2tldCA9IGZhY3RvcnkodXJsKTtcblxuICAgIHRoaXMuc29ja2V0LmFkZEV2ZW50TGlzdGVuZXIoJ29wZW4nLCAoKSA9PiB7XG4gICAgICB0aGlzLm9wZW4gPSB0cnVlO1xuICAgICAgY29uc3QgcXVldWVkID0gWy4uLnRoaXMuc2VuZFF1ZXVlXTtcbiAgICAgIHRoaXMuc2VuZFF1ZXVlLmxlbmd0aCA9IDA7XG4gICAgICBmb3IgKGNvbnN0IGZyYW1lIG9mIHF1ZXVlZCkgdGhpcy5zb2NrZXQuc2VuZChmcmFtZSk7XG4gICAgfSk7XG5cbiAgICB0aGlzLnNvY2tldC5hZGRFdmVudExpc3RlbmVyKCdtZXNzYWdlJywgKGV2ZW50KSA9PiB7XG4gICAgICBpZiAodHlwZW9mIGV2ZW50LmRhdGEgIT09ICdzdHJpbmcnKSB7XG4gICAgICAgIHRoaXMuZmFpbCh7IGNvZGU6IDEwMDMsIHJlYXNvbjogJ2JpbmFyeSBmcmFtZXMgYXJlIG5vdCBwYXJ0IG9mIHRoZSBwcm90b2NvbCcgfSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGxldCBtZXNzYWdlOiBNZXNzYWdlO1xuICAgICAgdHJ5IHtcbiAgICAgICAgbWVzc2FnZSA9IHBhcnNlTWVzc2FnZShldmVudC5kYXRhKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHRoaXMuZmFpbCh7IGNvZGU6IDEwMDIsIHJlYXNvbjogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpIH0pO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICB0aGlzLm1lc3NhZ2VDYWxsYmFjaz8uKG1lc3NhZ2UpO1xuICAgIH0pO1xuXG4gICAgdGhpcy5zb2NrZXQuYWRkRXZlbnRMaXN0ZW5lcignZXJyb3InLCAoZXZlbnQpID0+IHtcbiAgICAgIHRoaXMubGFzdEVycm9yID1cbiAgICAgICAgZXZlbnQgaW5zdGFuY2VvZiBFcnJvciA/IGV2ZW50Lm1lc3NhZ2UgOiBldmVudCAhPT0gdW5kZWZpbmVkID8gU3RyaW5nKGV2ZW50KSA6ICdzb2NrZXQgZXJyb3InO1xuICAgIH0pO1xuXG4gICAgdGhpcy5zb2NrZXQuYWRkRXZlbnRMaXN0ZW5lcignY2xvc2UnLCAoZXZlbnQpID0+IHtcbiAgICAgIHRoaXMuZmluaXNoQ2xvc2Uoe1xuICAgICAgICBjb2RlOiBldmVudC5jb2RlLFxuICAgICAgICByZWFzb246IGV2ZW50LnJlYXNvbiAhPT0gdW5kZWZpbmVkICYmIGV2ZW50LnJlYXNvbiAhPT0gJycgPyBldmVudC5yZWFzb24gOiB0aGlzLmxhc3RFcnJvcixcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgc2VuZChtZXNzYWdlOiBNZXNzYWdlKTogdm9pZCB7XG4gICAgaWYgKHRoaXMuY2xvc2VkKSB0aHJvdyBuZXcgTmV0d29ya0Vycm9yKCdzZW5kIG9uIGEgY2xvc2VkIHRyYW5zcG9ydCcpO1xuICAgIGNvbnN0IGZyYW1lID0gSlNPTi5zdHJpbmdpZnkobWVzc2FnZSk7XG4gICAgaWYgKHRoaXMub3Blbikge1xuICAgICAgdGhpcy5zb2NrZXQuc2VuZChmcmFtZSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRoaXMuc2VuZFF1ZXVlLnB1c2goZnJhbWUpO1xuICB9XG5cbiAgb25NZXNzYWdlKGNhbGxiYWNrOiAobWVzc2FnZTogTWVzc2FnZSkgPT4gdm9pZCk6IHZvaWQge1xuICAgIHRoaXMubWVzc2FnZUNhbGxiYWNrID0gY2FsbGJhY2s7XG4gIH1cblxuICBvbkNsb3NlKGNhbGxiYWNrOiAocmVhc29uOiBDbG9zZVJlYXNvbikgPT4gdm9pZCk6IHZvaWQge1xuICAgIHRoaXMuY2xvc2VDYWxsYmFjayA9IGNhbGxiYWNrO1xuICB9XG5cbiAgY2xvc2UoKTogdm9pZCB7XG4gICAgaWYgKHRoaXMuY2xvc2VkKSByZXR1cm47XG4gICAgdGhpcy5jbG9zZWQgPSB0cnVlO1xuICAgIHRoaXMuc2VuZFF1ZXVlLmxlbmd0aCA9IDA7XG4gICAgdHJ5IHtcbiAgICAgIHRoaXMuc29ja2V0LmNsb3NlKDEwMDAsICdjbG9zZWQgYnkgY2FsbGVyJyk7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBhbHJlYWR5IGRlYWQgXHUyMDE0IHRoZSBjbG9zZSBldmVudCBtYXkgbmV2ZXIgYXJyaXZlXG4gICAgfVxuICAgIC8vIE5vdGlmeSBldmVuIGlmIHRoZSBzb2NrZXQgbmV2ZXIgZW1pdHMgJ2Nsb3NlJyAoZmFpbGVkIGRpYWwpLlxuICAgIHRoaXMuZmluaXNoQ2xvc2UoeyBjb2RlOiAxMDAwLCByZWFzb246ICdjbG9zZWQgYnkgY2FsbGVyJyB9KTtcbiAgfVxuXG4gIHByaXZhdGUgZmFpbChyZWFzb246IENsb3NlUmVhc29uKTogdm9pZCB7XG4gICAgdGhpcy5jbG9zZWQgPSB0cnVlO1xuICAgIHRyeSB7XG4gICAgICB0aGlzLnNvY2tldC5jbG9zZShyZWFzb24uY29kZSA/PyAxMDAyLCByZWFzb24ucmVhc29uID8/ICcnKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIGFscmVhZHkgY2xvc2VkXG4gICAgfVxuICAgIHRoaXMuZmluaXNoQ2xvc2UocmVhc29uKTtcbiAgfVxuXG4gIHByaXZhdGUgZmluaXNoQ2xvc2UocmVhc29uOiBDbG9zZVJlYXNvbik6IHZvaWQge1xuICAgIHRoaXMub3BlbiA9IGZhbHNlO1xuICAgIHRoaXMuY2xvc2VkID0gdHJ1ZTtcbiAgICBpZiAodGhpcy5jbG9zZU5vdGlmaWVkKSByZXR1cm47XG4gICAgdGhpcy5jbG9zZU5vdGlmaWVkID0gdHJ1ZTtcbiAgICB0aGlzLmNsb3NlQ2FsbGJhY2s/LihyZWFzb24pO1xuICB9XG59XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7OztBQ2NBLElBQUFBLG1CQUErQjs7O0FDS3hCLElBQU0sd0JBQU4sY0FBb0MsTUFBTTtBQUFBLEVBQy9DLFlBQVksU0FBaUI7QUFDM0IsVUFBTSxPQUFPO0FBQ2IsU0FBSyxPQUFPO0FBQUEsRUFDZDtBQUNGO0FBYU8sU0FBUyxtQkFBbUIsT0FBMEI7QUFDM0QsTUFBSSxPQUFPLFVBQVUsVUFBVTtBQUM3QixVQUFNLElBQUksc0JBQXNCLG9DQUFvQyxPQUFPLEtBQUssRUFBRTtBQUFBLEVBQ3BGO0FBQ0EsTUFBSSxNQUFNLFNBQVMsSUFBSSxHQUFHO0FBQ3hCLFVBQU0sSUFBSSxzQkFBc0IsaUNBQWlDLEtBQUssVUFBVSxLQUFLLENBQUMsRUFBRTtBQUFBLEVBQzFGO0FBQ0EsTUFBSSxhQUFhLEtBQUssS0FBSyxHQUFHO0FBQzVCLFVBQU0sSUFBSTtBQUFBLE1BQ1IsZ0VBQWdFLEtBQUssVUFBVSxLQUFLLENBQUM7QUFBQSxJQUN2RjtBQUFBLEVBQ0Y7QUFDQSxNQUFJLE1BQU0sV0FBVyxNQUFNLEdBQUc7QUFDNUIsVUFBTSxJQUFJO0FBQUEsTUFDUixzQ0FBc0MsS0FBSyxVQUFVLEtBQUssQ0FBQztBQUFBLElBQzdEO0FBQUEsRUFDRjtBQUVBLFFBQU0sWUFBWSxNQUFNLFFBQVEsT0FBTyxHQUFHO0FBQzFDLE1BQUksVUFBVSxXQUFXLElBQUksR0FBRztBQUM5QixVQUFNLElBQUk7QUFBQSxNQUNSLHFFQUFxRSxLQUFLLFVBQVUsS0FBSyxDQUFDO0FBQUEsSUFDNUY7QUFBQSxFQUNGO0FBRUEsUUFBTSxXQUFxQixDQUFDO0FBQzVCLGFBQVcsV0FBVyxVQUFVLE1BQU0sR0FBRyxHQUFHO0FBQzFDLFFBQUksWUFBWSxNQUFNLFlBQVksSUFBSztBQUN2QyxRQUFJLFlBQVksTUFBTTtBQUNwQixVQUFJLFNBQVMsV0FBVyxHQUFHO0FBQ3pCLGNBQU0sSUFBSTtBQUFBLFVBQ1Isc0NBQXNDLEtBQUssVUFBVSxLQUFLLENBQUM7QUFBQSxRQUM3RDtBQUFBLE1BQ0Y7QUFDQSxlQUFTLElBQUk7QUFDYjtBQUFBLElBQ0Y7QUFDQSxhQUFTLEtBQUssT0FBTztBQUFBLEVBQ3ZCO0FBQ0EsU0FBTyxTQUFTLFdBQVcsSUFBSSxNQUFNLElBQUksU0FBUyxLQUFLLEdBQUcsQ0FBQztBQUM3RDtBQTJCTyxTQUFTLFdBQVcsTUFBeUI7QUFDbEQsUUFBTSxhQUFhLG1CQUFtQixJQUFJO0FBQzFDLE1BQUksZUFBZSxJQUFLLFFBQU87QUFDL0IsUUFBTSxZQUFZLFdBQVcsWUFBWSxHQUFHO0FBQzVDLFNBQU8sY0FBYyxJQUFJLE1BQU0sV0FBVyxNQUFNLEdBQUcsU0FBUztBQUM5RDtBQUtPLFNBQVMsU0FBUyxNQUF5QjtBQUNoRCxRQUFNLGFBQWEsbUJBQW1CLElBQUk7QUFDMUMsTUFBSSxlQUFlLElBQUssUUFBTztBQUMvQixTQUFPLFdBQVcsTUFBTSxXQUFXLFlBQVksR0FBRyxJQUFJLENBQUM7QUFDekQ7QUFPTyxTQUFTLGtCQUFrQixPQUFlLFVBQTJCO0FBQzFFLE1BQUksYUFBYSxJQUFLLFFBQU8sVUFBVTtBQUN2QyxTQUFPLE1BQU0sU0FBUyxTQUFTLFVBQVUsTUFBTSxXQUFXLEdBQUcsUUFBUSxHQUFHO0FBQzFFOzs7QUNwR08sU0FBUyxjQUFjLEdBQWlCLEdBQWtDO0FBQy9FLE1BQUksRUFBRSxZQUFZLEVBQUUsUUFBUyxRQUFPLEVBQUUsVUFBVSxFQUFFLFVBQVUsSUFBSTtBQUNoRSxNQUFJLEVBQUUsYUFBYSxFQUFFLFNBQVUsUUFBTyxFQUFFLFdBQVcsRUFBRSxXQUFXLElBQUk7QUFDcEUsU0FBTztBQUNUO0FBV08sU0FBUyxVQUNkLFFBQ0EsVUFDYztBQTlDaEI7QUErQ0UsU0FBTyxFQUFFLFdBQVUsc0NBQVEsWUFBUixZQUFtQixLQUFLLEdBQUcsU0FBUztBQUN6RDs7O0FDdkNBLGVBQXNCLFVBQVUsT0FBNkM7QUFDM0UsUUFBTSxPQUFPLE9BQU8sVUFBVSxXQUFXLElBQUksWUFBWSxFQUFFLE9BQU8sS0FBSyxJQUFJO0FBSzNFLFFBQU0sU0FBUyxNQUFNLE9BQU8sT0FBTyxPQUFPLFdBQVcsSUFBb0I7QUFDekUsU0FBTyxNQUFNLElBQUksV0FBVyxNQUFNLENBQUM7QUFDckM7QUF3Q0EsU0FBUyxNQUFNLE9BQTJCO0FBQ3hDLE1BQUksTUFBTTtBQUNWLGFBQVcsUUFBUSxPQUFPO0FBQ3hCLFdBQU8sS0FBSyxTQUFTLEVBQUUsRUFBRSxTQUFTLEdBQUcsR0FBRztBQUFBLEVBQzFDO0FBQ0EsU0FBTztBQUNUOzs7QUNqRE8sSUFBZSxpQkFBZixjQUFzQyxNQUFNO0FBQUEsRUFHakQsWUFBWSxTQUFpQixTQUF3QjtBQUNuRCxVQUFNLFNBQVMsT0FBTztBQUN0QixTQUFLLE9BQU8sV0FBVztBQUFBLEVBQ3pCO0FBQ0Y7QUFRTyxJQUFNLG9CQUFOLGNBQWdDLGVBQWU7QUFBQSxFQUEvQztBQUFBO0FBQ0wsd0JBQVMsUUFBTztBQUFBO0FBQ2xCO0FBR08sSUFBTSxlQUFOLGNBQTJCLGVBQWU7QUFBQSxFQUExQztBQUFBO0FBQ0wsd0JBQVMsUUFBTztBQUFBO0FBQ2xCO0FBUU8sSUFBTSxnQkFBTixjQUE0QixlQUFlO0FBQUEsRUFBM0M7QUFBQTtBQUNMLHdCQUFTLFFBQU87QUFBQTtBQUNsQjtBQUdPLElBQU0sZUFBTixjQUEyQixlQUFlO0FBQUEsRUFBMUM7QUFBQTtBQUNMLHdCQUFTLFFBQU87QUFBQTtBQUNsQjs7O0FDZk8sSUFBTSw2QkFBNkI7QUFHbkMsSUFBTSxpQ0FBaUM7QUFHdkMsSUFBTSx5QkFBeUI7QUE4Ry9CLFNBQVMsWUFBWSxPQUFtQixRQUFzQztBQUNuRixNQUFJLE9BQU8sV0FBVyxPQUFPLGNBQWMsUUFBVztBQUNwRCxVQUFNLElBQUk7QUFBQSxNQUNSLDhCQUE4QixLQUFLLFVBQVUsT0FBTyxJQUFJLENBQUM7QUFBQSxJQUMzRDtBQUFBLEVBQ0Y7QUFDQSxRQUFNLE9BQXdDLEVBQUUsR0FBRyxNQUFNO0FBQ3pELFFBQU0sUUFBeUI7QUFBQSxJQUM3QixNQUFNLE9BQU87QUFBQSxJQUNiLE1BQU0sT0FBTztBQUFBLElBQ2IsV0FBVyxPQUFPO0FBQUEsSUFDbEIsT0FBTyxPQUFPO0FBQUEsRUFDaEI7QUFDQSxNQUFJLE9BQU8sUUFBUyxPQUFNLFlBQVksT0FBTztBQUM3QyxNQUFJLE9BQU8sU0FBVSxPQUFNLFdBQVc7QUFDdEMsTUFBSSxPQUFPLFVBQVUsT0FBVyxPQUFNLFFBQVEsT0FBTztBQUNyRCxPQUFLLE9BQU8sSUFBSSxJQUFJO0FBQ3BCLFNBQU87QUFDVDtBQVFPLFNBQVMsWUFBWSxPQUFtQixNQUEwQjtBQUN2RSxNQUFJLEVBQUUsUUFBUSxPQUFRLFFBQU87QUFDN0IsUUFBTSxPQUF3QyxFQUFFLEdBQUcsTUFBTTtBQUN6RCxTQUFPLEtBQUssSUFBSTtBQUNoQixTQUFPO0FBQ1Q7QUFRTyxTQUFTLG9CQUFvQixPQUFtQixRQUE0QixDQUFDLEdBQVc7QUFDN0YsUUFBTSxVQUEyQyxDQUFDO0FBQ2xELGFBQVcsUUFBUSxPQUFPLEtBQUssS0FBSyxFQUFFLEtBQUssR0FBRztBQUM1QyxZQUFRLElBQUksSUFBSSxNQUFNLElBQUk7QUFBQSxFQUM1QjtBQUNBLFFBQU0sV0FBK0I7QUFBQSxJQUNuQyxlQUFlO0FBQUEsSUFDZjtBQUFBLElBQ0EsR0FBSSxNQUFNLFdBQVcsU0FBWSxFQUFFLFFBQVEsTUFBTSxPQUFPLElBQUksQ0FBQztBQUFBLElBQzdELEdBQUksTUFBTSxrQkFBa0IsU0FBWSxFQUFFLGVBQWUsTUFBTSxjQUFjLElBQUksQ0FBQztBQUFBLElBQ2xGLEdBQUksTUFBTSxzQkFBc0IsU0FDNUIsRUFBRSxtQkFBbUIsTUFBTSxrQkFBa0IsSUFDN0MsQ0FBQztBQUFBLEVBQ1A7QUFDQSxTQUFPLEtBQUssVUFBVSxRQUFRO0FBQ2hDO0FBaUJPLFNBQVMsc0JBQXNCLE1BQXNDO0FBQzFFLE1BQUk7QUFDSixNQUFJO0FBQ0YsYUFBUyxLQUFLLE1BQU0sSUFBSTtBQUFBLEVBQzFCLFNBQVMsT0FBTztBQUNkLFVBQU0sSUFBSSxjQUFjLHVDQUF1QyxFQUFFLE1BQU0sQ0FBQztBQUFBLEVBQzFFO0FBQ0EsTUFBSSxDQUFDLGNBQWMsTUFBTSxHQUFHO0FBQzFCLFVBQU0sSUFBSSxjQUFjLG9DQUFvQztBQUFBLEVBQzlEO0FBR0EsUUFBTSxRQUFRLHNCQUFzQixJQUFJO0FBQ3hDLFFBQU0sWUFBYSxPQUFnQztBQUNuRCxRQUFNLG1CQUFvQixPQUF1QztBQUNqRSxRQUFNLGVBQWdCLE9BQTJDO0FBQ2pFLE1BQUksY0FBYyxXQUFjLE9BQU8sY0FBYyxZQUFZLENBQUMsT0FBTyxVQUFVLFNBQVMsS0FBSyxZQUFZLElBQUk7QUFDL0csVUFBTSxJQUFJLGNBQWMsMERBQTBEO0FBQUEsRUFDcEY7QUFDQSxNQUNFLHFCQUFxQixVQUNyQixxQkFBcUIsU0FDcEIsT0FBTyxxQkFBcUIsWUFBWSxDQUFDLE9BQU8sVUFBVSxnQkFBZ0IsS0FBSyxtQkFBbUIsSUFDbkc7QUFDQSxVQUFNLElBQUksY0FBYyx5RUFBeUU7QUFBQSxFQUNuRztBQUNBLE1BQUksaUJBQWlCLFVBQWEsT0FBTyxpQkFBaUIsV0FBVztBQUNuRSxVQUFNLElBQUksY0FBYyxxRUFBcUU7QUFBQSxFQUMvRjtBQUNBLFNBQU87QUFBQSxJQUNMO0FBQUEsSUFDQSxPQUFPO0FBQUEsTUFDTCxRQUFRLE9BQU8sY0FBYyxXQUFXLFlBQVk7QUFBQSxNQUNwRCxlQUFlLE9BQU8scUJBQXFCLFdBQVcsbUJBQW1CO0FBQUEsTUFDekUsbUJBQW1CLGlCQUFpQjtBQUFBLElBQ3RDO0FBQUEsRUFDRjtBQUNGO0FBVU8sU0FBUyxzQkFBc0IsTUFBMEI7QUFDOUQsTUFBSTtBQUNKLE1BQUk7QUFDRixhQUFTLEtBQUssTUFBTSxJQUFJO0FBQUEsRUFDMUIsU0FBUyxPQUFPO0FBQ2QsVUFBTSxJQUFJLGNBQWMsdUNBQXVDLEVBQUUsTUFBTSxDQUFDO0FBQUEsRUFDMUU7QUFDQSxNQUFJLENBQUMsY0FBYyxNQUFNLEdBQUc7QUFDMUIsVUFBTSxJQUFJLGNBQWMsb0NBQW9DO0FBQUEsRUFDOUQ7QUFDQSxRQUFNLFVBQVUsT0FBTztBQUN2QixNQUFJLE9BQU8sWUFBWSxZQUFZLENBQUMsT0FBTyxVQUFVLE9BQU8sR0FBRztBQUM3RCxVQUFNLElBQUksY0FBYyxvREFBb0Q7QUFBQSxFQUM5RTtBQUNBLE1BQUksVUFBVSxrQ0FBa0MsVUFBVSw0QkFBNEI7QUFDcEYsVUFBTSxJQUFJO0FBQUEsTUFDUiw4QkFBOEIsT0FBTyw2Q0FDdEIsOEJBQThCLEtBQUssMEJBQTBCO0FBQUEsSUFFOUU7QUFBQSxFQUNGO0FBQ0EsUUFBTSxhQUFhLE9BQU87QUFDMUIsTUFBSSxDQUFDLGNBQWMsVUFBVSxHQUFHO0FBQzlCLFVBQU0sSUFBSSxjQUFjLGlEQUFpRDtBQUFBLEVBQzNFO0FBRUEsUUFBTSxVQUEyQyxDQUFDO0FBQ2xELGFBQVcsQ0FBQyxNQUFNLEdBQUcsS0FBSyxPQUFPLFFBQVEsVUFBVSxHQUFHO0FBQ3BELFlBQVEsSUFBSSxJQUFJLFdBQVcsTUFBTSxHQUFHO0FBQUEsRUFDdEM7QUFDQSxTQUFPO0FBQ1Q7QUFFQSxTQUFTLFdBQVcsTUFBYyxLQUErQjtBQUMvRCxRQUFNLFFBQVEscUJBQXFCLEtBQUssVUFBVSxJQUFJLENBQUM7QUFDdkQsTUFBSSxDQUFDLGNBQWMsR0FBRyxFQUFHLE9BQU0sSUFBSSxjQUFjLEdBQUcsS0FBSyxtQkFBbUI7QUFDNUUsUUFBTSxFQUFFLE1BQU0sTUFBTSxXQUFXLE9BQU8sV0FBVyxVQUFVLE1BQU0sSUFBSTtBQUNyRSxNQUFJLE9BQU8sU0FBUyxTQUFVLE9BQU0sSUFBSSxjQUFjLEdBQUcsS0FBSyx5QkFBeUI7QUFDdkYsTUFBSSxPQUFPLGNBQWMsVUFBVTtBQUNqQyxVQUFNLElBQUksY0FBYyxHQUFHLEtBQUssOEJBQThCO0FBQUEsRUFDaEU7QUFDQSxNQUFJLE9BQU8sU0FBUyxZQUFZLENBQUMsT0FBTyxVQUFVLElBQUksS0FBSyxPQUFPLEdBQUc7QUFDbkUsVUFBTSxJQUFJLGNBQWMsR0FBRyxLQUFLLHVDQUF1QztBQUFBLEVBQ3pFO0FBQ0EsTUFBSSxDQUFDLGNBQWMsS0FBSyxLQUFLLE9BQU8sTUFBTSxZQUFZLFlBQVksT0FBTyxNQUFNLGFBQWEsVUFBVTtBQUNwRyxVQUFNLElBQUksY0FBYyxHQUFHLEtBQUssdURBQXVEO0FBQUEsRUFDekY7QUFDQSxNQUFJLGNBQWMsVUFBYSxPQUFPLGNBQWMsVUFBVTtBQUM1RCxVQUFNLElBQUksY0FBYyxHQUFHLEtBQUssMkNBQTJDO0FBQUEsRUFDN0U7QUFDQSxNQUFJLGFBQWEsVUFBYSxPQUFPLGFBQWEsV0FBVztBQUMzRCxVQUFNLElBQUksY0FBYyxHQUFHLEtBQUssMkNBQTJDO0FBQUEsRUFDN0U7QUFDQSxNQUFJLFVBQVUsV0FBYyxPQUFPLFVBQVUsWUFBWSxDQUFDLE9BQU8sU0FBUyxLQUFLLElBQUk7QUFDakYsVUFBTSxJQUFJLGNBQWMsR0FBRyxLQUFLLDhDQUE4QztBQUFBLEVBQ2hGO0FBQ0EsUUFBTSxRQUF5QjtBQUFBLElBQzdCO0FBQUEsSUFDQTtBQUFBLElBQ0E7QUFBQSxJQUNBLE9BQU8sRUFBRSxTQUFTLE1BQU0sU0FBbUIsVUFBVSxNQUFNLFNBQW1CO0FBQUEsRUFDaEY7QUFDQSxNQUFJLGNBQWMsT0FBVyxPQUFNLFlBQVk7QUFDL0MsTUFBSSxhQUFhLE9BQVcsT0FBTSxXQUFXO0FBQzdDLE1BQUksVUFBVSxPQUFXLE9BQU0sUUFBUTtBQUN2QyxTQUFPO0FBQ1Q7QUFFQSxTQUFTLGNBQWMsT0FBa0Q7QUFDdkUsU0FBTyxPQUFPLFVBQVUsWUFBWSxVQUFVLFFBQVEsQ0FBQyxNQUFNLFFBQVEsS0FBSztBQUM1RTs7O0FDL1BBLGVBQXNCLFVBQ3BCLFNBQ0EsT0FDQSxNQUNBLFdBQ0EsVUFBNEIsQ0FBQyxHQUNSO0FBM0Z2QjtBQTRGRSxRQUFNLE9BQU0sYUFBUSxRQUFSLFlBQWUsS0FBSyxJQUFJO0FBQ3BDLFFBQU0sYUFBYSxRQUFRO0FBQzNCLE1BQUksVUFBc0I7QUFFMUIsMkNBQWEsR0FBRyxLQUFLLE1BQU07QUFDM0IsTUFBSSxPQUFPO0FBQ1gsTUFBSTtBQUNGLGVBQVcsUUFBUSxLQUFLLE9BQU87QUFDN0IsZ0JBQVUsTUFBTSxhQUFhLFNBQVMsU0FBUyxNQUFNLFdBQVcsR0FBRztBQUNuRSxjQUFRO0FBQ1IsK0NBQWEsTUFBTSxLQUFLLE1BQU07QUFBQSxJQUNoQztBQUFBLEVBQ0YsU0FBUyxPQUFPO0FBQ2QsUUFBSTtBQUNGLFlBQU0sYUFBYSxTQUFTLFNBQVMsUUFBUSxjQUFjO0FBQUEsSUFDN0QsU0FBUTtBQUFBLElBR1I7QUFDQSxVQUFNO0FBQUEsRUFDUjtBQUVBLFFBQU0sYUFBYSxTQUFTLFNBQVMsUUFBUSxjQUFjO0FBQzNELFNBQU87QUFDVDtBQUVBLGVBQWUsYUFDYixTQUNBLE9BQ0EsTUFDQSxXQUNBLEtBQ3FCO0FBQ3JCLE1BQUksS0FBSyxTQUFTLFVBQVU7QUFDMUIsUUFBSSxNQUFNLFFBQVEsT0FBTyxLQUFLLFFBQVEsR0FBRztBQUN2QyxZQUFNLFFBQVEsV0FBVyxLQUFLLFVBQVUsS0FBSyxNQUFNO0FBQUEsSUFDckQsT0FBTztBQUVMLFlBQU0sY0FBYyxTQUFTLEtBQUssUUFBUSxLQUFLLE1BQU0sU0FBUztBQUFBLElBQ2hFO0FBQ0EsVUFBTSxRQUFRLFlBQVksWUFBWSxPQUFPLEtBQUssUUFBUSxHQUFHO0FBQUEsTUFDM0QsTUFBTSxLQUFLO0FBQUEsTUFDWCxXQUFXLEtBQUs7QUFBQSxNQUNoQixNQUFNLEtBQUs7QUFBQSxNQUNYLE1BQU0sS0FBSztBQUFBLE1BQ1gsT0FBTyxLQUFLO0FBQUEsSUFDZCxDQUFDO0FBR0QsVUFBTSxvQkFBb0IsU0FBUyxPQUFPLEtBQUssUUFBUTtBQUN2RCxXQUFPO0FBQUEsRUFDVDtBQUVBLE1BQUksS0FBSyxVQUFVO0FBS2pCLFFBQUksS0FBSyxTQUFTO0FBQ2hCLFlBQU0sa0JBQWtCLFNBQVMsT0FBTyxLQUFLLElBQUk7QUFBQSxJQUNuRCxPQUFPO0FBQ0wsWUFBTSxRQUFRLFVBQVUsS0FBSyxJQUFJO0FBQUEsSUFDbkM7QUFDQSxXQUFPLFlBQVksT0FBTztBQUFBLE1BQ3hCLE1BQU0sS0FBSztBQUFBLE1BQ1gsV0FBVyxLQUFLO0FBQUEsTUFDaEIsTUFBTSxLQUFLO0FBQUEsTUFDWCxNQUFNLEtBQUs7QUFBQSxNQUNYLE9BQU8sS0FBSztBQUFBLE1BQ1osU0FBUyxLQUFLO0FBQUEsTUFDZCxXQUFXLEtBQUssVUFBVSxNQUFNO0FBQUEsTUFDaEMsVUFBVTtBQUFBLElBQ1osQ0FBQztBQUFBLEVBQ0g7QUFFQSxNQUFJLEtBQUssU0FBUztBQUdoQixVQUFNLFFBQVEsV0FBVyxLQUFLLElBQUk7QUFDbEMsVUFBTSxhQUFhLFlBQVksT0FBTztBQUFBLE1BQ3BDLE1BQU0sS0FBSztBQUFBLE1BQ1gsV0FBVyxLQUFLO0FBQUEsTUFDaEIsTUFBTSxLQUFLO0FBQUEsTUFDWCxNQUFNLEtBQUs7QUFBQSxNQUNYLE9BQU8sS0FBSztBQUFBLE1BQ1osU0FBUztBQUFBLE1BQ1QsV0FBVztBQUFBLElBQ2IsQ0FBQztBQUdELFVBQU0sb0JBQW9CLFNBQVMsWUFBWSxLQUFLLElBQUk7QUFDeEQsV0FBTztBQUFBLEVBQ1Q7QUFFQSxRQUFNLFVBQVUsTUFBTSxLQUFLLElBQUk7QUFDL0IsTUFDRSxZQUFZLFVBQ1osUUFBUSxjQUFjLFVBQ3RCLFFBQVEsU0FBUyxLQUFLLFFBQ3JCLE1BQU0sUUFBUSxPQUFPLEtBQUssSUFBSSxHQUMvQjtBQUtBLFdBQU8sWUFBWSxPQUFPO0FBQUEsTUFDeEIsTUFBTSxLQUFLO0FBQUEsTUFDWCxXQUFXLEtBQUs7QUFBQSxNQUNoQixNQUFNLEtBQUs7QUFBQSxNQUNYLE1BQU0sS0FBSztBQUFBLE1BQ1gsT0FBTyxLQUFLO0FBQUEsSUFDZCxDQUFDO0FBQUEsRUFDSDtBQUVBLFFBQU0sY0FBYyxTQUFTLEtBQUssTUFBTSxLQUFLLE1BQU0sU0FBUztBQUM1RCxTQUFPLFlBQVksT0FBTztBQUFBLElBQ3hCLE1BQU0sS0FBSztBQUFBLElBQ1gsV0FBVyxLQUFLO0FBQUEsSUFDaEIsTUFBTSxLQUFLO0FBQUEsSUFDWCxNQUFNLEtBQUs7QUFBQSxJQUNYLE9BQU8sS0FBSztBQUFBLEVBQ2QsQ0FBQztBQUNIO0FBcUJBLGVBQWUsWUFDYixTQUNBLE9BQ0EsS0FDa0I7QUFDbEIsTUFBSSxRQUFRLElBQUssUUFBTztBQUN4QixNQUFJLENBQUUsTUFBTSxRQUFRLE9BQU8sR0FBRyxFQUFJLFFBQU87QUFDekMsYUFBVyxRQUFRLE1BQU0sUUFBUSxVQUFVLEdBQUc7QUFDNUMsUUFBSSxrQkFBa0IsS0FBSyxNQUFNLEdBQUcsRUFBRyxRQUFPO0FBQUEsRUFDaEQ7QUFDQSxhQUFXLFNBQVMsTUFBTSxRQUFRLFNBQVMsR0FBRztBQUM1QyxRQUFJLGtCQUFrQixPQUFPLEdBQUcsRUFBRyxRQUFPO0FBQUEsRUFDNUM7QUFDQSxhQUFXLENBQUMsTUFBTSxLQUFLLEtBQUssT0FBTyxRQUFRLEtBQUssR0FBRztBQUNqRCxRQUFJLE1BQU0sWUFBWSxNQUFNLGNBQWMsT0FBVztBQUNyRCxRQUFJLGtCQUFrQixNQUFNLEdBQUcsRUFBRyxRQUFPO0FBQUEsRUFDM0M7QUFDQSxTQUFPO0FBQ1Q7QUFHQSxlQUFzQixrQkFDcEIsU0FDQSxPQUNBLEtBQ2tCO0FBQ2xCLE1BQUksQ0FBRSxNQUFNLFlBQVksU0FBUyxPQUFPLEdBQUcsRUFBSSxRQUFPO0FBQ3RELFNBQU8sZ0JBQWdCLFNBQVMsR0FBRztBQUNyQztBQUVBLGVBQWUsZ0JBQWdCLFNBQXlCLEtBQStCO0FBQ3JGLE1BQUksUUFBUSxjQUFjLE9BQVcsUUFBTztBQUM1QyxNQUFJO0FBQ0YsVUFBTSxRQUFRLFVBQVUsR0FBRztBQUMzQixXQUFPO0FBQUEsRUFDVCxTQUFRO0FBR04sV0FBTztBQUFBLEVBQ1Q7QUFDRjtBQWFBLGVBQXNCLG9CQUNwQixTQUNBLE9BQ0EsYUFDZ0M7QUFDaEMsUUFBTSxNQUFNLFdBQVcsV0FBVztBQUNsQyxNQUFJLENBQUUsTUFBTSxZQUFZLFNBQVMsT0FBTyxHQUFHLEVBQUksUUFBTztBQUN0RCxTQUFPLEVBQUUsS0FBSyxTQUFTLE1BQU0sZ0JBQWdCLFNBQVMsR0FBRyxFQUFFO0FBQzdEO0FBR0EsZUFBZSxjQUNiLFNBQ0EsTUFDQSxNQUNBLFdBQ2U7QUFDZixRQUFNLFFBQVEsTUFBTSxVQUFVLElBQUk7QUFDbEMsUUFBTSxTQUFTLE1BQU0sVUFBVSxLQUFLO0FBQ3BDLE1BQUksV0FBVyxNQUFNO0FBQ25CLFVBQU0sSUFBSTtBQUFBLE1BQ1IsMEJBQTBCLEtBQUssVUFBVSxJQUFJLENBQUMsY0FBYyxJQUFJLFNBQVMsTUFBTTtBQUFBLElBQ2pGO0FBQUEsRUFDRjtBQUNBLFFBQU0sUUFBUSxVQUFVLE1BQU0sS0FBSztBQUNyQztBQUVBLGVBQWUsYUFDYixTQUNBLE9BQ0EsUUFBNEIsQ0FBQyxHQUNkO0FBQ2YsUUFBTSxRQUFRO0FBQUEsSUFDWjtBQUFBLElBQ0EsSUFBSSxZQUFZLEVBQUUsT0FBTyxvQkFBb0IsT0FBTyxLQUFLLENBQUM7QUFBQSxFQUM1RDtBQUNGO0FBUUEsZUFBc0IsZUFBZSxTQUEwRDtBQUM3RixRQUFNLFFBQVEsTUFBTSxRQUFRLFNBQVMsc0JBQXNCO0FBQzNELFNBQU8sc0JBQXNCLElBQUksWUFBWSxFQUFFLE9BQU8sS0FBSyxDQUFDO0FBQzlEOzs7QUN0VEEsSUFBTSwwQkFBK0Msb0JBQUksSUFBSTtBQUFBLEVBQzNEO0FBQUE7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBO0FBQUEsRUFDQTtBQUNGLENBQUM7QUFHRCxJQUFNLDBCQUErQyxvQkFBSSxJQUFJO0FBQUEsRUFDM0Q7QUFBQSxFQUNBO0FBQ0YsQ0FBQztBQVdNLFNBQVMsVUFBVSxXQUFtQixVQUFtQztBQUM5RSxRQUFNLGFBQWEsbUJBQW1CLFNBQVM7QUFDL0MsTUFBSSxlQUFlLElBQUssUUFBTztBQUUvQixRQUFNLFFBQVEsV0FBVyxNQUFNLENBQUMsRUFBRSxZQUFZO0FBQzlDLFFBQU0sV0FBVyxNQUFNLE1BQU0sR0FBRztBQUVoQyxNQUFJLFNBQVMsS0FBSyxDQUFDLFlBQVksd0JBQXdCLElBQUksT0FBTyxDQUFDLEdBQUc7QUFDcEUsV0FBTztBQUFBLEVBQ1Q7QUFFQSxNQUFJLFNBQVMsQ0FBQyxNQUFNLGFBQWE7QUFDL0IsUUFBSSxDQUFDLFNBQVMsYUFBYyxRQUFPO0FBQ25DLFFBQUksd0JBQXdCLElBQUksS0FBSyxFQUFHLFFBQU87QUFDL0MsUUFBSSxTQUFTLENBQUMsTUFBTSxRQUFTLFFBQU87QUFBQSxFQUN0QztBQUVBLFFBQU0sU0FBUyxTQUFTO0FBQ3hCLE1BQUksV0FBVyxVQUFhLE9BQU8sU0FBUyxHQUFHO0FBQzdDLGVBQVcsV0FBVyxRQUFRO0FBQzVCLFlBQU0sV0FBVyxtQkFBbUIsT0FBTztBQUMzQyxVQUFJLGFBQWEsUUFBUSxnQkFBZ0IsVUFBVSxRQUFRLEVBQUcsUUFBTztBQUFBLElBQ3ZFO0FBQUEsRUFDRjtBQUVBLFNBQU87QUFDVDtBQWNBLFNBQVMsbUJBQW1CLFNBQXlDO0FBQ25FLE1BQUksVUFBVSxRQUFRLEtBQUssRUFBRSxZQUFZO0FBQ3pDLFNBQU8sUUFBUSxXQUFXLEdBQUcsRUFBRyxXQUFVLFFBQVEsTUFBTSxDQUFDO0FBQ3pELFNBQU8sUUFBUSxTQUFTLEdBQUcsRUFBRyxXQUFVLFFBQVEsTUFBTSxHQUFHLEVBQUU7QUFDM0QsTUFBSSxZQUFZLEdBQUksUUFBTztBQUMzQixTQUFPLEVBQUUsVUFBVSxRQUFRLE1BQU0sR0FBRyxHQUFHLFVBQVUsUUFBUSxTQUFTLEdBQUcsRUFBRTtBQUN6RTtBQUdBLFNBQVMsZ0JBQWdCLFNBQTBCLE1BQWtDO0FBQ25GLE1BQUksUUFBUSxVQUFVO0FBQ3BCLFdBQU8sY0FBYyxRQUFRLFVBQVUsSUFBSTtBQUFBLEVBQzdDO0FBRUEsV0FBUyxRQUFRLEdBQUcsUUFBUSxLQUFLLFFBQVEsU0FBUztBQUNoRCxRQUFJLGNBQWMsUUFBUSxVQUFVLEtBQUssTUFBTSxLQUFLLENBQUMsRUFBRyxRQUFPO0FBQUEsRUFDakU7QUFDQSxTQUFPO0FBQ1Q7QUFHQSxTQUFTLGNBQWMsU0FBNEIsTUFBa0M7QUFDbkYsTUFBSSxRQUFRLFdBQVcsRUFBRyxRQUFPLEtBQUssV0FBVztBQUNqRCxRQUFNLE9BQU8sUUFBUSxDQUFDO0FBQ3RCLFFBQU0sT0FBTyxRQUFRLE1BQU0sQ0FBQztBQUM1QixNQUFJLFNBQVMsT0FBVyxRQUFPLEtBQUssV0FBVztBQUMvQyxNQUFJLFNBQVMsTUFBTTtBQUVqQixhQUFTLE9BQU8sR0FBRyxRQUFRLEtBQUssUUFBUSxRQUFRO0FBQzlDLFVBQUksY0FBYyxNQUFNLEtBQUssTUFBTSxJQUFJLENBQUMsRUFBRyxRQUFPO0FBQUEsSUFDcEQ7QUFDQSxXQUFPO0FBQUEsRUFDVDtBQUNBLE1BQUksS0FBSyxXQUFXLEtBQUssQ0FBQyxhQUFhLE1BQU0sS0FBSyxDQUFDLENBQUUsRUFBRyxRQUFPO0FBQy9ELFNBQU8sY0FBYyxNQUFNLEtBQUssTUFBTSxDQUFDLENBQUM7QUFDMUM7QUFHQSxTQUFTLGFBQWEsU0FBaUIsU0FBMEI7QUFDL0QsTUFBSSxDQUFDLFFBQVEsU0FBUyxHQUFHLEVBQUcsUUFBTyxZQUFZO0FBQy9DLFFBQU0sUUFBUSxRQUFRLFFBQVEsR0FBRztBQUNqQyxRQUFNLE9BQU8sUUFBUSxZQUFZLEdBQUc7QUFDcEMsTUFBSSxDQUFDLFFBQVEsV0FBVyxRQUFRLE1BQU0sR0FBRyxLQUFLLENBQUMsRUFBRyxRQUFPO0FBQ3pELE1BQUksQ0FBQyxRQUFRLFNBQVMsUUFBUSxNQUFNLE9BQU8sQ0FBQyxDQUFDLEVBQUcsUUFBTztBQUN2RCxNQUFJLFFBQVE7QUFDWixhQUFXLFVBQVUsUUFBUSxNQUFNLE9BQU8sT0FBTyxDQUFDLEVBQUUsTUFBTSxHQUFHLEVBQUUsTUFBTSxHQUFHLEVBQUUsR0FBRztBQUMzRSxVQUFNLFFBQVEsUUFBUSxRQUFRLFFBQVEsS0FBSztBQUMzQyxRQUFJLFVBQVUsR0FBSSxRQUFPO0FBQ3pCLFlBQVEsUUFBUSxPQUFPO0FBQUEsRUFDekI7QUFDQSxTQUFPO0FBQ1Q7OztBQzdITyxJQUFNLGtCQUFrQjtBQUd4QixJQUFNLDJCQUEyQixNQUFNO0FBNE85QyxJQUFNLGVBQW9DLG9CQUFJLElBQUk7QUFBQSxFQUNoRDtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQ0YsQ0FBQztBQUNELElBQU0sZUFBb0Msb0JBQUksSUFBSTtBQUFBLEVBQ2hEO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQ0YsQ0FBQztBQVFNLFNBQVMsVUFBVSxPQUFrQztBQUMxRCxTQUNFLE9BQU8sVUFBVSxZQUNqQixVQUFVLFFBQ1YsT0FBUSxNQUE2QixTQUFTLGFBQzdDLGFBQWEsSUFBSyxNQUEyQixJQUFJLEtBQ2hELGFBQWEsSUFBSyxNQUEyQixJQUFJO0FBRXZEO0FBc0JPLFNBQVMsYUFBYSxNQUF1QjtBQUNsRCxNQUFJO0FBQ0osTUFBSTtBQUNGLGFBQVMsS0FBSyxNQUFNLElBQUk7QUFBQSxFQUMxQixTQUFTLE9BQU87QUFDZCxVQUFNLElBQUksY0FBYyw4QkFBOEIsT0FBTyxJQUFJLEVBQUUsTUFBTSxHQUFHLEdBQUcsQ0FBQyxJQUFJLEVBQUUsTUFBTSxDQUFDO0FBQUEsRUFDL0Y7QUFDQSxNQUFJLENBQUMsVUFBVSxNQUFNLEdBQUc7QUFDdEIsVUFBTSxJQUFJO0FBQUEsTUFDUixzQ0FBc0MsS0FBSyxVQUFXLGlDQUErQixJQUFJLENBQUM7QUFBQSxJQUM1RjtBQUFBLEVBQ0Y7QUFDQSxTQUFPO0FBQ1Q7QUFTTyxTQUFTLGNBQWMsT0FBMkI7QUFDdkQsTUFBSSxTQUFTO0FBQ2IsUUFBTSxRQUFRO0FBQ2QsV0FBUyxTQUFTLEdBQUcsU0FBUyxNQUFNLFFBQVEsVUFBVSxPQUFPO0FBQzNELGNBQVUsT0FBTyxhQUFhLEdBQUcsTUFBTSxTQUFTLFFBQVEsU0FBUyxLQUFLLENBQUM7QUFBQSxFQUN6RTtBQUNBLFNBQU8sS0FBSyxNQUFNO0FBQ3BCO0FBR08sU0FBUyxjQUFjLFNBQTZCO0FBQ3pELE1BQUk7QUFDSixNQUFJO0FBQ0YsYUFBUyxLQUFLLE9BQU87QUFBQSxFQUN2QixTQUFTLE9BQU87QUFDZCxVQUFNLElBQUksY0FBYywrQkFBK0IsRUFBRSxNQUFNLENBQUM7QUFBQSxFQUNsRTtBQUNBLFFBQU0sUUFBUSxJQUFJLFdBQVcsT0FBTyxNQUFNO0FBQzFDLFdBQVMsSUFBSSxHQUFHLElBQUksT0FBTyxRQUFRLElBQUssT0FBTSxDQUFDLElBQUksT0FBTyxXQUFXLENBQUM7QUFDdEUsU0FBTztBQUNUOzs7QUN2VUEsSUFBTSx5QkFBeUI7QUFFL0IsSUFBTSxnQkFBZ0I7QUFHdEIsSUFBTSx5QkFBeUI7QUFHL0IsSUFBTSx1QkFBdUI7QUFHN0IsSUFBTSx1QkFBdUI7QUFRdEIsU0FBUyxtQkFBbUIsTUFBc0I7QUFDdkQsTUFBSSxVQUFVLEtBQUssUUFBUSx3QkFBd0IsRUFBRSxFQUFFLFFBQVEsZUFBZSxFQUFFO0FBQ2hGLFlBQVUsQ0FBQyxHQUFHLE9BQU8sRUFBRSxNQUFNLEdBQUcsc0JBQXNCLEVBQUUsS0FBSyxFQUFFO0FBQy9ELFlBQVUsUUFBUSxLQUFLLEVBQUUsUUFBUSxvQkFBb0IsRUFBRTtBQUN2RCxTQUFPLFFBQVEsV0FBVyxJQUFJLHVCQUF1QjtBQUN2RDtBQWVPLFNBQVMsaUJBQ2QsTUFDQSxZQUNBLEtBQ0EsU0FBNkMsTUFBTSxPQUMzQztBQUNSLFFBQU0sYUFBYSxtQkFBbUIsSUFBSTtBQUMxQyxRQUFNLE1BQU0sV0FBVyxVQUFVO0FBQ2pDLFFBQU0sT0FBTyxTQUFTLFVBQVU7QUFFaEMsUUFBTSxVQUFVLEtBQUssWUFBWSxHQUFHO0FBQ3BDLFFBQU0sZUFBZSxVQUFVO0FBQy9CLFFBQU0sT0FBTyxlQUFlLEtBQUssTUFBTSxHQUFHLE9BQU8sSUFBSTtBQUNyRCxRQUFNLFlBQVksZUFBZSxLQUFLLE1BQU0sT0FBTyxJQUFJO0FBRXZELFFBQU0sU0FBUyxjQUFjLG9CQUFvQixHQUFHLENBQUMsV0FBVyxtQkFBbUIsVUFBVSxDQUFDO0FBQzlGLFFBQU0sT0FBTyxDQUFDLGFBQThCLFFBQVEsTUFBTSxJQUFJLFFBQVEsS0FBSyxHQUFHLEdBQUcsSUFBSSxRQUFRO0FBRTdGLE1BQUksWUFBWSxLQUFLLEdBQUcsSUFBSSxHQUFHLE1BQU0sR0FBRyxTQUFTLEVBQUU7QUFDbkQsV0FBUyxJQUFJLEdBQUcsS0FBSyxzQkFBc0IsS0FBSztBQUM5QyxRQUFJLENBQUMsT0FBTyxTQUFTLEVBQUcsUUFBTztBQUMvQixnQkFBWSxLQUFLLEdBQUcsSUFBSSxHQUFHLE1BQU0sSUFBSSxDQUFDLEdBQUcsU0FBUyxFQUFFO0FBQUEsRUFDdEQ7QUFDQSxRQUFNLElBQUk7QUFBQSxJQUNSLCtCQUErQixvQkFBb0IsbUJBQW1CLEtBQUssVUFBVSxVQUFVLENBQUM7QUFBQSxFQUNsRztBQUNGO0FBR0EsU0FBUyxvQkFBb0IsS0FBcUI7QUFDaEQsUUFBTSxJQUFJLElBQUksS0FBSyxHQUFHO0FBQ3RCLFFBQU0sTUFBTSxDQUFDLE1BQXNCLE9BQU8sQ0FBQyxFQUFFLFNBQVMsR0FBRyxHQUFHO0FBQzVELFNBQ0UsR0FBRyxFQUFFLGVBQWUsQ0FBQyxJQUFJLElBQUksRUFBRSxZQUFZLElBQUksQ0FBQyxDQUFDLElBQUksSUFBSSxFQUFFLFdBQVcsQ0FBQyxDQUFDLElBQ3BFLElBQUksRUFBRSxZQUFZLENBQUMsQ0FBQyxJQUFJLElBQUksRUFBRSxjQUFjLENBQUMsQ0FBQztBQUV0RDs7O0FDb0VBLElBQU0sYUFBMkIsRUFBRSxTQUFTLEdBQUcsVUFBVSxHQUFHO0FBT3JELFNBQVMsZ0JBQWdCLE9BQWdDO0FBOUtoRTtBQStLRSxRQUFNLEVBQUUsY0FBYyxPQUFPLGNBQWMsZ0JBQWdCLElBQUksSUFBSTtBQUNuRSxRQUFNLFdBQVcsQ0FBQyxHQUFHLE1BQU0sUUFBUSxFQUFFLEtBQUssQ0FBQyxHQUFHLE1BQU0sZUFBZSxFQUFFLE1BQU0sRUFBRSxJQUFJLENBQUM7QUFDbEYsUUFBTSxpQkFBaUIsSUFBSSxJQUFJLFNBQVMsSUFBSSxDQUFDLFVBQVUsQ0FBQyxNQUFNLE1BQU0sS0FBSyxDQUFDLENBQUM7QUFFM0UsUUFBTSxTQUFtQixDQUFDO0FBQzFCLFFBQU0sUUFBa0IsQ0FBQztBQUN6QixRQUFNLFlBQTBCLENBQUM7QUFHakMsUUFBTSxhQUFhLG9CQUFJLElBQVk7QUFDbkMsYUFBVyxLQUFLLGFBQWEsTUFBTyxZQUFXLElBQUksRUFBRSxJQUFJO0FBQ3pELGFBQVcsS0FBSyxhQUFhLFNBQVUsWUFBVyxJQUFJLEVBQUUsSUFBSTtBQUM1RCxhQUFXLEtBQUssYUFBYSxRQUFTLFlBQVcsSUFBSSxFQUFFLElBQUk7QUFDM0QsYUFBVyxLQUFLLGFBQWEsU0FBUztBQUNwQyxlQUFXLElBQUksRUFBRSxJQUFJO0FBQ3JCLGVBQVcsSUFBSSxFQUFFLEVBQUU7QUFBQSxFQUNyQjtBQUNBLGFBQVcsS0FBSyxhQUFhLGdCQUFpQixZQUFXLElBQUksRUFBRSxJQUFJO0FBR25FLFFBQU0sV0FBVyxvQkFBSSxJQUFZO0FBRWpDLFFBQU0sYUFBYSxDQUFDLFNBQTBCLFFBQVEsU0FBUyxlQUFlLElBQUksSUFBSTtBQU90RixhQUFXLFVBQVUsQ0FBQyxHQUFHLGFBQWEsT0FBTyxFQUFFLEtBQUssQ0FBQyxHQUFHLE1BQU0sZUFBZSxFQUFFLE1BQU0sRUFBRSxJQUFJLENBQUMsR0FBRztBQUM3RixVQUFNLFlBQVksTUFBTSxPQUFPLElBQUk7QUFDbkMsVUFBTSxVQUFVLE1BQU0sT0FBTyxFQUFFO0FBQy9CLFVBQU0sYUFBYSxlQUFlLElBQUksT0FBTyxJQUFJO0FBQ2pELFVBQU0sV0FBVyxlQUFlLElBQUksT0FBTyxFQUFFO0FBRTdDLFVBQU0sY0FBYyxhQUNoQixtQkFBbUIsV0FBVyxVQUFVLEtBQ3hDLHVDQUFXLGVBQWM7QUFDN0IsVUFBTSxZQUFZLFdBQ2QsbUJBQW1CLFNBQVMsUUFBUSxJQUNwQztBQUVKLFFBQUksQ0FBQyxlQUFlLENBQUMsV0FBVztBQUM5QixhQUFPLEtBQUs7QUFBQSxRQUNWLE1BQU07QUFBQSxRQUNOLFVBQVUsT0FBTztBQUFBLFFBQ2pCLFFBQVEsT0FBTztBQUFBLFFBQ2YsZ0JBQWUsNENBQVcsY0FBWCxZQUF3QjtBQUFBLFFBQ3ZDLE1BQU0sT0FBTztBQUFBLFFBQ2IsTUFBTSxPQUFPO0FBQUEsTUFDZixDQUFDO0FBQ0Q7QUFBQSxJQUNGO0FBR0EsUUFBSSxDQUFDLGFBQWE7QUFFaEIsVUFBSSxhQUFhLFVBQVUsY0FBYyxRQUFXO0FBQ2xELGVBQU8sS0FBSztBQUFBLFVBQ1YsTUFBTTtBQUFBLFVBQ04sTUFBTSxPQUFPO0FBQUEsVUFDYixlQUFlLFVBQVU7QUFBQSxVQUN6QixNQUFNLFVBQVU7QUFBQSxVQUNoQixNQUFNLFVBQVU7QUFBQSxRQUNsQixDQUFDO0FBQUEsTUFDSDtBQUFBLElBQ0YsV0FBVyxDQUFDLGNBQWMsV0FBVyxTQUFTO0FBRzVDLFlBQU07QUFBQSxRQUNKLFNBQVMsVUFBVSxPQUFPLE1BQU07QUFBQSxVQUM5QixPQUFNLG9EQUFZLFNBQVosWUFBb0IsdUNBQVcsU0FBL0IsWUFBdUMsT0FBTztBQUFBLFVBQ3BELE9BQU0sb0RBQVksU0FBWixZQUFvQix1Q0FBVyxTQUEvQixZQUF1QyxPQUFPO0FBQUEsVUFDcEQsVUFBUyw4Q0FBWSxZQUFaLFlBQXVCO0FBQUEsVUFDaEMsUUFBTyxvREFBWSxVQUFaLFlBQXFCLHVDQUFXLFVBQWhDLFlBQXlDO0FBQUEsVUFDaEQsU0FBUztBQUFBLFFBQ1gsQ0FBQztBQUFBLE1BQ0g7QUFBQSxJQUNGLE9BQU87QUFJTCxZQUFNLGFBQWEsVUFBVSx1Q0FBVyxPQUFPLFlBQVk7QUFDM0QsVUFBSSxjQUFjLFdBQVcsT0FBTyxVQUFVLElBQUksR0FBRztBQUNuRCxjQUFNLEtBQUssU0FBUyxRQUFRLE9BQU8sTUFBTSxVQUFVLENBQUM7QUFDcEQsa0JBQVUsS0FBSztBQUFBLFVBQ2IsTUFBTSxPQUFPO0FBQUEsVUFDYixRQUFRO0FBQUEsVUFDUixRQUFRO0FBQUE7QUFBQSxVQUVSLGNBQWM7QUFBQSxVQUNkLFFBQVEsY0FBYyxVQUFVO0FBQUEsVUFDaEM7QUFBQSxRQUNGLENBQUM7QUFBQSxNQUNILE9BQU87QUFDTCxlQUFPLEtBQUs7QUFBQSxVQUNWLE1BQU07QUFBQSxVQUNOLFVBQVUsT0FBTztBQUFBLFVBQ2pCLFFBQVEsT0FBTztBQUFBLFVBQ2YsZ0JBQWUsNENBQVcsY0FBWCxZQUF3QjtBQUFBLFVBQ3ZDLE1BQU0sT0FBTztBQUFBLFVBQ2IsTUFBTSxPQUFPO0FBQUEsUUFDZixDQUFDO0FBQ0Qsa0JBQVUsS0FBSztBQUFBLFVBQ2IsTUFBTSxPQUFPO0FBQUEsVUFDYixRQUFRO0FBQUEsVUFDUixRQUFRO0FBQUEsVUFDUixjQUFjO0FBQUEsVUFDZCxRQUFRLGNBQWMsVUFBVTtBQUFBLFVBQ2hDO0FBQUEsUUFDRixDQUFDO0FBQ0Q7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUdBLFFBQUksQ0FBQyxXQUFXO0FBQ2QsYUFBTyxLQUFLO0FBQUEsUUFDVixPQUFNLG1DQUFTLGVBQWMsU0FBWSxZQUFZO0FBQUEsUUFDckQsTUFBTSxPQUFPO0FBQUEsUUFDYixnQkFBZSx3Q0FBUyxjQUFULFlBQXNCO0FBQUEsUUFDckMsTUFBTSxPQUFPO0FBQUEsUUFDYixNQUFNLE9BQU87QUFBQSxNQUNmLENBQUM7QUFBQSxJQUNILE9BQU87QUFDTCwyQkFBcUIsT0FBTyxJQUFJLFNBQVMsVUFBd0I7QUFBQSxRQUMvRCxNQUFNLE9BQU87QUFBQSxRQUNiLE9BQU0sbUNBQVMsZUFBYyxTQUFZLFlBQVk7QUFBQSxRQUNyRCxNQUFNLE9BQU87QUFBQSxRQUNiLE1BQU0sT0FBTztBQUFBLE1BQ2YsQ0FBQztBQUFBLElBQ0g7QUFBQSxFQUNGO0FBT0EsYUFBVyxRQUFRLE9BQU8sS0FBSyxLQUFLLEVBQ2pDLE9BQU8sQ0FBQyxNQUFNO0FBQ2IsVUFBTSxRQUFRLE1BQU0sQ0FBQztBQUNyQixXQUFPLE1BQU0sY0FBYyxVQUFhLENBQUMsTUFBTTtBQUFBLEVBQ2pELENBQUMsRUFDQSxLQUFLLGNBQWMsR0FBRztBQUN2QixRQUFJLFdBQVcsSUFBSSxJQUFJLEtBQUssU0FBUyxJQUFJLElBQUksRUFBRztBQUNoRCxRQUFJLGVBQWUsSUFBSSxJQUFJLEVBQUc7QUFDOUIsVUFBTSxRQUFRLE1BQU0sSUFBSTtBQUV4QixRQUFJO0FBQ0osUUFBSSxjQUFjO0FBQ2xCLGVBQVcsYUFBYSxVQUFVO0FBQ2hDLFVBQUksVUFBVSxRQUFTO0FBQ3ZCLFVBQUksV0FBVyxJQUFJLFVBQVUsSUFBSSxLQUFLLFNBQVMsSUFBSSxVQUFVLElBQUksRUFBRztBQUNwRSxZQUFNLFFBQVEsTUFBTSxVQUFVLElBQUk7QUFDbEMsVUFBSSxVQUFVLFVBQWEsTUFBTSxjQUFjLE9BQVc7QUFDMUQsVUFBSSxVQUFVLFNBQVMsTUFBTSxLQUFNO0FBQ25DLFlBQU0sVUFBVSxXQUFXLFVBQVUsSUFBSSxNQUFNLFdBQVcsSUFBSTtBQUM5RCxVQUFJLFNBQVMsUUFBVztBQUN0QixlQUFPO0FBQ1Asc0JBQWM7QUFBQSxNQUNoQixXQUFXLFdBQVcsQ0FBQyxhQUFhO0FBQ2xDLGVBQU87QUFDUCxzQkFBYztBQUFBLE1BQ2hCO0FBQUEsSUFDRjtBQUVBLFFBQUksTUFBTTtBQUNSLFlBQU0sS0FBSztBQUFBLFFBQ1QsTUFBTTtBQUFBLFFBQ04sVUFBVTtBQUFBLFFBQ1YsUUFBUSxLQUFLO0FBQUEsUUFDYixNQUFNLEtBQUs7QUFBQSxRQUNYLE1BQU0sS0FBSztBQUFBLFFBQ1gsU0FBUyxLQUFLO0FBQUEsUUFDZCxPQUFPLEtBQUs7QUFBQSxNQUNkLENBQUM7QUFDRCxlQUFTLElBQUksSUFBSTtBQUNqQixlQUFTLElBQUksS0FBSyxJQUFJO0FBQUEsSUFDeEIsT0FBTztBQUtMLFlBQU07QUFBQSxRQUNKLFNBQVMsVUFBVSxNQUFNO0FBQUEsVUFDdkIsTUFBTSxNQUFNO0FBQUEsVUFDWixNQUFNLE1BQU07QUFBQSxVQUNaLFNBQVM7QUFBQSxVQUNULE9BQU8sTUFBTTtBQUFBLFVBQ2IsU0FBUztBQUFBLFFBQ1gsQ0FBQztBQUFBLE1BQ0g7QUFDQSxlQUFTLElBQUksSUFBSTtBQUFBLElBQ25CO0FBQUEsRUFDRjtBQUdBLGFBQVcsVUFBVSxVQUFVO0FBQzdCLFFBQUksV0FBVyxJQUFJLE9BQU8sSUFBSSxLQUFLLFNBQVMsSUFBSSxPQUFPLElBQUksRUFBRztBQUM5RCxVQUFNLFFBQVEsTUFBTSxPQUFPLElBQUk7QUFDL0IsUUFBSSxDQUFDLG1CQUFtQixPQUFPLE1BQU0sRUFBRztBQUN4QyxRQUFJLFVBQVUsUUFBVztBQUN2QixVQUFJLENBQUMsT0FBTyxTQUFTO0FBQ25CLGNBQU0sS0FBSyxTQUFTLE9BQU8sT0FBTyxNQUFNLE1BQU0sQ0FBQztBQUMvQyxpQkFBUyxJQUFJLE9BQU8sSUFBSTtBQUFBLE1BQzFCO0FBRUE7QUFBQSxJQUNGO0FBQ0EsUUFBSSxPQUFPLFNBQVM7QUFDbEIsWUFBTSxLQUFLLFNBQVMsVUFBVSxPQUFPLE1BQU0sTUFBTSxDQUFDO0FBQUEsSUFDcEQsV0FBVyxNQUFNLGNBQWMsUUFBVztBQUN4QyxZQUFNLEtBQUssU0FBUyxXQUFXLE9BQU8sTUFBTSxNQUFNLENBQUM7QUFBQSxJQUNyRCxPQUFPO0FBQ0wsWUFBTSxLQUFLLFNBQVMsUUFBUSxPQUFPLE1BQU0sTUFBTSxDQUFDO0FBQUEsSUFDbEQ7QUFDQSxhQUFTLElBQUksT0FBTyxJQUFJO0FBQUEsRUFDMUI7QUFHQSxRQUFNLGFBQStCO0FBQUEsSUFDbkMsR0FBRyxhQUFhLE1BQU0sSUFBSSxDQUFDLE9BQU8sRUFBRSxHQUFHLEdBQUcsTUFBTSxNQUFlLEVBQUU7QUFBQSxJQUNqRSxHQUFHLGFBQWEsU0FBUyxJQUFJLENBQUMsTUFBRztBQTlZckMsVUFBQUM7QUE4WXlDO0FBQUEsUUFDbkMsR0FBRztBQUFBLFFBQ0gsUUFBTUEsTUFBQSxNQUFNLEVBQUUsSUFBSSxNQUFaLGdCQUFBQSxJQUFlLGVBQWMsU0FBYSxZQUF1QjtBQUFBLE1BQ3pFO0FBQUEsS0FBRTtBQUFBLElBQ0YsR0FBRyxhQUFhLFFBQVEsSUFBSSxDQUFDLE9BQXVCLEVBQUUsR0FBRyxHQUFHLE1BQU0sU0FBUyxFQUFFO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxJQUs3RSxHQUFHLGFBQWEsZ0JBQWdCO0FBQUEsTUFDOUIsQ0FBQyxPQUF1QjtBQUFBLFFBQ3RCLE1BQU0sRUFBRTtBQUFBLFFBQ1IsTUFBTTtBQUFBLFFBQ04sTUFBTTtBQUFBLFFBQ04sTUFBTTtBQUFBLFFBQ04sVUFBVTtBQUFBLE1BQ1o7QUFBQSxJQUNGO0FBQUEsRUFDRixFQUFFLEtBQUssQ0FBQyxHQUFHLE1BQU0sZUFBZSxFQUFFLE1BQU0sRUFBRSxJQUFJLENBQUM7QUFFL0MsYUFBVyxhQUFhLFlBQVk7QUFDbEMsVUFBTSxRQUFRLE1BQU0sVUFBVSxJQUFJO0FBQ2xDLFVBQU0sU0FBUyxlQUFlLElBQUksVUFBVSxJQUFJO0FBQ2hELFVBQU0sb0JBQ0osV0FBVyxXQUFjLFVBQVUsU0FBWSxPQUFPLFlBQVksTUFBTSxZQUFZLENBQUMsT0FBTztBQUM5RixRQUFJLENBQUMsbUJBQW1CO0FBQ3RCLGdCQUFVLFdBQVcsS0FBSztBQUFBLElBQzVCLE9BQU87QUFDTCwyQkFBcUIsVUFBVSxNQUFNLE9BQU8sUUFBc0IsU0FBUztBQUFBLElBQzdFO0FBQUEsRUFDRjtBQUVBLFNBQU87QUFBQSxJQUNMLFFBQVEsT0FBTyxLQUFLLENBQUMsR0FBRyxNQUFNLGVBQWUsT0FBTyxDQUFDLEdBQUcsT0FBTyxDQUFDLENBQUMsQ0FBQztBQUFBLElBQ2xFLE9BQU8sTUFBTSxLQUFLLENBQUMsR0FBRyxNQUFNLGVBQWUsT0FBTyxDQUFDLEdBQUcsT0FBTyxDQUFDLENBQUMsQ0FBQztBQUFBLElBQ2hFLFdBQVcsVUFBVSxLQUFLLENBQUMsR0FBRyxNQUFNLGVBQWUsRUFBRSxNQUFNLEVBQUUsSUFBSSxDQUFDO0FBQUEsSUFDbEUsY0FBYyxDQUFDLEdBQUcsYUFBYSxZQUFZLEVBQUUsS0FBSyxjQUFjO0FBQUEsRUFDbEU7QUFJQSxXQUFTLFVBQVUsV0FBMkIsT0FBMEM7QUF2YjFGLFFBQUFBLEtBQUFDLEtBQUFDLEtBQUFDO0FBd2JJLFFBQUksVUFBVSxTQUFTLFVBQVU7QUFDL0IsYUFBTyxLQUFLO0FBQUEsUUFDVixNQUFNO0FBQUEsUUFDTixNQUFNLFVBQVU7QUFBQSxRQUNoQixnQkFBZUgsTUFBQSwrQkFBTyxjQUFQLE9BQUFBLE1BQW9CO0FBQUEsUUFDbkMsT0FBTUMsTUFBQSwrQkFBTyxTQUFQLE9BQUFBLE1BQWUsVUFBVTtBQUFBLFFBQy9CLE9BQU1DLE1BQUEsK0JBQU8sU0FBUCxPQUFBQSxNQUFlLFVBQVU7QUFBQSxRQUMvQixHQUFJLFVBQVUsV0FBVyxFQUFFLFVBQVUsS0FBSyxJQUFJLENBQUM7QUFBQSxNQUNqRCxDQUFDO0FBQ0Q7QUFBQSxJQUNGO0FBQ0EsV0FBTyxLQUFLO0FBQUEsTUFDVixNQUFNLFVBQVU7QUFBQSxNQUNoQixNQUFNLFVBQVU7QUFBQSxNQUNoQixnQkFBZUMsTUFBQSwrQkFBTyxjQUFQLE9BQUFBLE1BQW9CO0FBQUEsTUFDbkMsTUFBTSxVQUFVO0FBQUEsTUFDaEIsTUFBTSxVQUFVO0FBQUEsSUFDbEIsQ0FBQztBQUFBLEVBQ0g7QUFPQSxXQUFTLHFCQUNQLE1BQ0EsT0FDQSxRQUNBLE9BQ007QUF0ZFYsUUFBQUgsS0FBQUMsS0FBQUMsS0FBQUMsS0FBQUM7QUF1ZEksVUFBTSxhQUFhLFVBQVUsK0JBQU8sT0FBTyxZQUFZO0FBQ3ZELFVBQU0sYUFBYSxjQUFjLE9BQU8sT0FBTyxVQUFVLElBQUk7QUFDN0QsVUFBTSxVQUFVLGNBQWMsTUFBTTtBQUNwQyxVQUFNLFNBQ0osTUFBTSxTQUFTLFlBQVksT0FBTyxVQUM5QixtQkFDQSxVQUFVLFNBQ1IsZUFDQTtBQUVSLFFBQUksTUFBTSxTQUFTLFlBQVksT0FBTyxTQUFTO0FBRTdDLFlBQU0sS0FBSyxTQUFTLFVBQVUsTUFBTSxNQUFNLENBQUM7QUFDM0M7QUFBQSxJQUNGO0FBRUEsUUFBSSxNQUFNLFNBQVMsVUFBVTtBQUUzQixVQUFJLFlBQVk7QUFDZCxjQUFNLEtBQUssU0FBUyxRQUFRLE1BQU0sTUFBTSxDQUFDO0FBQ3pDLGtCQUFVLEtBQUs7QUFBQSxVQUNiO0FBQUEsVUFBTTtBQUFBLFVBQVEsUUFBUTtBQUFBLFVBQVUsY0FBYztBQUFBLFVBQzlDLFFBQVE7QUFBQSxVQUFTO0FBQUEsUUFDbkIsQ0FBQztBQUFBLE1BQ0gsT0FBTztBQUNMLGVBQU8sS0FBSztBQUFBLFVBQ1YsTUFBTTtBQUFBLFVBQ047QUFBQSxVQUNBLGdCQUFlSixNQUFBLCtCQUFPLGNBQVAsT0FBQUEsTUFBb0I7QUFBQSxVQUNuQyxPQUFNQyxNQUFBLCtCQUFPLFNBQVAsT0FBQUEsTUFBZSxNQUFNO0FBQUEsVUFDM0IsT0FBTUMsTUFBQSwrQkFBTyxTQUFQLE9BQUFBLE1BQWUsTUFBTTtBQUFBLFVBQzNCLEdBQUksTUFBTSxXQUFXLEVBQUUsVUFBVSxLQUFLLElBQUksQ0FBQztBQUFBLFFBQzdDLENBQUM7QUFDRCxrQkFBVSxLQUFLO0FBQUEsVUFDYjtBQUFBLFVBQU07QUFBQSxVQUFRLFFBQVE7QUFBQSxVQUFTLGNBQWM7QUFBQSxVQUM3QyxRQUFRO0FBQUEsVUFBUztBQUFBLFFBQ25CLENBQUM7QUFBQSxNQUNIO0FBQ0E7QUFBQSxJQUNGO0FBRUEsUUFBSSxPQUFPLFNBQVM7QUFFbEIsVUFBSSxZQUFZO0FBQ2QsY0FBTSxLQUFLLFNBQVMsVUFBVSxNQUFNLE1BQU0sQ0FBQztBQUMzQyxrQkFBVSxLQUFLO0FBQUEsVUFDYjtBQUFBLFVBQU07QUFBQSxVQUFRLFFBQVE7QUFBQSxVQUFVLGNBQWM7QUFBQSxVQUM5QyxrQkFBa0IsaUJBQWlCLE1BQU0sT0FBTyxNQUFNO0FBQUEsVUFDdEQsUUFBUTtBQUFBLFVBQVM7QUFBQSxRQUNuQixDQUFDO0FBQUEsTUFDSCxPQUFPO0FBQ0wsZUFBTyxLQUFLO0FBQUEsVUFDVixNQUFNLE1BQU07QUFBQSxVQUNaO0FBQUEsVUFDQSxnQkFBZUMsTUFBQSwrQkFBTyxjQUFQLE9BQUFBLE1BQW9CO0FBQUEsVUFDbkMsTUFBTSxNQUFNO0FBQUEsVUFDWixNQUFNLE1BQU07QUFBQSxRQUNkLENBQUM7QUFDRCxrQkFBVSxLQUFLO0FBQUEsVUFDYjtBQUFBLFVBQU07QUFBQSxVQUFRLFFBQVE7QUFBQSxVQUFTLGNBQWM7QUFBQSxVQUM3QyxRQUFRO0FBQUEsVUFBUztBQUFBLFFBQ25CLENBQUM7QUFBQSxNQUNIO0FBQ0E7QUFBQSxJQUNGO0FBR0EsUUFBSSxZQUFZO0FBQ2QsWUFBTTtBQUFBLFFBQ0osVUFBUywrQkFBTyxlQUFjLFNBQVksWUFBWSxVQUFVLFNBQVksUUFBUSxRQUFRLE1BQU0sTUFBTTtBQUFBLE1BQzFHO0FBQ0EsZ0JBQVUsS0FBSztBQUFBLFFBQ2I7QUFBQSxRQUFNO0FBQUEsUUFBUSxRQUFRO0FBQUEsUUFBVSxjQUFjO0FBQUEsUUFDOUMsa0JBQWtCLGlCQUFpQixNQUFNLE9BQU8sTUFBTTtBQUFBLFFBQ3RELFFBQVE7QUFBQSxRQUFTO0FBQUEsTUFDbkIsQ0FBQztBQUFBLElBQ0gsT0FBTztBQUNMLGFBQU8sS0FBSztBQUFBLFFBQ1YsTUFBTSxNQUFNO0FBQUEsUUFDWjtBQUFBO0FBQUE7QUFBQSxRQUdBLGdCQUFlQyxNQUFBLCtCQUFPLGNBQVAsT0FBQUEsTUFBb0I7QUFBQSxRQUNuQyxNQUFNLE1BQU07QUFBQSxRQUNaLE1BQU0sTUFBTTtBQUFBLE1BQ2QsQ0FBQztBQUNELGdCQUFVLEtBQUs7QUFBQSxRQUNiO0FBQUEsUUFBTTtBQUFBLFFBQVEsUUFBUTtBQUFBLFFBQVMsY0FBYztBQUFBLFFBQzdDLFFBQVE7QUFBQSxRQUFTO0FBQUEsTUFDbkIsQ0FBQztBQUFBLElBQ0g7QUFBQSxFQUNGO0FBUUEsV0FBUyxpQkFBaUIsTUFBYyxPQUF1QixRQUF3QztBQUNyRyxRQUFJLE1BQU0sU0FBUyxPQUFPLEtBQU0sUUFBTztBQUN2QyxVQUFNLFdBQVcsaUJBQWlCLE1BQU0sZ0JBQWdCLEtBQUssVUFBVTtBQUN2RSxXQUFPLEtBQUs7QUFBQSxNQUNWLE1BQU07QUFBQSxNQUNOLE1BQU07QUFBQTtBQUFBLE1BRU4sZUFBZSxPQUFPO0FBQUEsTUFDdEIsTUFBTSxNQUFNO0FBQUEsTUFDWixNQUFNLE1BQU07QUFBQSxJQUNkLENBQUM7QUFDRCxXQUFPO0FBQUEsRUFDVDtBQUNGO0FBSUEsU0FBUyxTQUNQLE1BQ0EsTUFDQSxRQUdZO0FBamxCZDtBQWtsQkUsU0FBTztBQUFBLElBQ0w7QUFBQSxJQUNBO0FBQUEsSUFDQSxNQUFNLE9BQU87QUFBQSxJQUNiLE1BQU0sT0FBTztBQUFBLElBQ2IsU0FBUyxPQUFPO0FBQUEsSUFDaEIsT0FBTyxPQUFPO0FBQUEsSUFDZCxVQUFTLFlBQU8sWUFBUCxZQUFrQixTQUFTO0FBQUEsSUFDcEMsR0FBSSxPQUFPLFdBQVcsRUFBRSxVQUFVLEtBQUssSUFBSSxDQUFDO0FBQUEsRUFDOUM7QUFDRjtBQUVBLFNBQVMsY0FBYyxRQUEwQztBQUMvRCxTQUFPO0FBQUEsSUFDTCxTQUFTLE9BQU87QUFBQSxJQUNoQixNQUFNLE9BQU87QUFBQSxJQUNiLE1BQU0sT0FBTztBQUFBLElBQ2IsU0FBUyxPQUFPO0FBQUEsSUFDaEIsT0FBTyxPQUFPO0FBQUEsRUFDaEI7QUFDRjtBQVFBLFNBQVMsbUJBQ1AsT0FDQSxRQUNTO0FBQ1QsTUFBSSxXQUFXLE9BQVcsUUFBTztBQUNqQyxNQUFJLFVBQVUsT0FBVyxRQUFPLENBQUMsT0FBTztBQUN4QyxTQUFPLE9BQU8sWUFBWSxNQUFNO0FBQ2xDO0FBRUEsU0FBUyxPQUFPLElBQTZCO0FBQzNDLFNBQU8sR0FBRyxTQUFTLFdBQVcsR0FBRyxTQUFTLEdBQUc7QUFDL0M7QUFFQSxTQUFTLGVBQWUsR0FBVyxHQUFtQjtBQUNwRCxTQUFPLElBQUksSUFBSSxLQUFLLElBQUksSUFBSSxJQUFJO0FBQ2xDOzs7QUM5YkEsZUFBc0IsVUFDcEIsU0FDQSxPQUNBLFVBQ0EsS0FDQSxVQUE0QixDQUFDLEdBQ047QUFyTXpCO0FBc01FLFFBQU0sVUFBUyxhQUFRLFNBQVIsWUFBZ0I7QUFDL0IsUUFBTSxRQUFPLGFBQVEsU0FBUixZQUFnQjtBQUM3QixRQUFNLGFBQWEsUUFBUTtBQUMzQixRQUFNLGVBQWUsUUFBUTtBQUU3QixRQUFNLFFBQVEsTUFBTSxRQUFRLFVBQVU7QUFFdEMsUUFBTSxPQUFtQixDQUFDO0FBQzFCLGFBQVcsUUFBUSxPQUFPO0FBQ3hCLFFBQUksQ0FBQyxVQUFVLEtBQUssTUFBTSxRQUFRLEVBQUcsTUFBSyxLQUFLLElBQUk7QUFBQSxFQUNyRDtBQUNBLFFBQU0sWUFBWSxJQUFJLElBQUksS0FBSyxJQUFJLENBQUMsTUFBTSxFQUFFLElBQUksQ0FBQztBQUVqRCxRQUFNLFFBQXlCLENBQUM7QUFDaEMsUUFBTSxXQUE0QixDQUFDO0FBQ25DLFFBQU0sU0FBdUIsQ0FBQztBQUU5QiwyQ0FBYSxHQUFHLEtBQUs7QUFDckIsTUFBSSxVQUFVO0FBQ2QsYUFBVyxRQUFRLE1BQU07QUFDdkIsVUFBTSxRQUFRLE1BQU0sS0FBSyxJQUFJO0FBQzdCLFFBQUksU0FBUyxVQUFVLGlCQUFpQixPQUFPLElBQUksR0FBRztBQUNwRCxpQkFBVztBQUNYLCtDQUFhLFNBQVMsS0FBSztBQUMzQjtBQUFBLElBQ0Y7QUFDQSxVQUFNLE9BQU8sTUFBTSxPQUFPLE1BQU0sUUFBUSxTQUFTLEtBQUssSUFBSSxDQUFDO0FBQzNELFdBQU8sS0FBSyxFQUFFLE1BQU0sS0FBSyxNQUFNLE1BQU0sTUFBTSxLQUFLLE1BQU0sT0FBTyxLQUFLLE1BQU0sQ0FBQztBQUN6RSxlQUFXO0FBQ1gsNkNBQWEsU0FBUyxLQUFLO0FBQzNCLFFBQUksVUFBVSxRQUFXO0FBQ3ZCLFlBQU0sS0FBSyxFQUFFLE1BQU0sS0FBSyxNQUFNLE1BQU0sTUFBTSxLQUFLLEtBQUssQ0FBQztBQUNyRDtBQUFBLElBQ0Y7QUFDQSxRQUFJLE1BQU0sVUFBVTtBQUVsQixlQUFTLEtBQUssRUFBRSxNQUFNLEtBQUssTUFBTSxNQUFNLE1BQU0sS0FBSyxLQUFLLENBQUM7QUFDeEQ7QUFBQSxJQUNGO0FBR0EsUUFBSSxNQUFNLGNBQWMsVUFBYSxNQUFNLFNBQVMsTUFBTTtBQUN4RCxlQUFTLEtBQUssRUFBRSxNQUFNLEtBQUssTUFBTSxNQUFNLE1BQU0sS0FBSyxLQUFLLENBQUM7QUFBQSxJQUMxRDtBQUFBLEVBQ0Y7QUFFQSxRQUFNLFVBQThCLENBQUM7QUFDckMsYUFBVyxDQUFDLE1BQU0sS0FBSyxLQUFLLE9BQU8sUUFBUSxLQUFLLEdBQUc7QUFDakQsUUFBSSxNQUFNLFNBQVU7QUFDcEIsUUFBSSxNQUFNLGNBQWMsT0FBVztBQUNuQyxRQUFJLFVBQVUsSUFBSSxJQUFJLEVBQUc7QUFDekIsUUFBSSxVQUFVLE1BQU0sUUFBUSxHQUFHO0FBRTdCO0FBQUEsSUFDRjtBQUNBLFlBQVEsS0FBSyxFQUFFLE1BQU0sTUFBTSxNQUFNLE1BQU0sTUFBTSxNQUFNLE1BQU0sV0FBVyxNQUFNLFVBQVUsQ0FBQztBQUFBLEVBQ3ZGO0FBRUEsUUFBTSxFQUFFLFNBQVMsU0FBUyxrQkFBa0IsT0FBTyxlQUFlLElBQUksY0FBYyxTQUFTLEtBQUs7QUFDbEcsUUFBTSxPQUFPLE1BQU0sUUFBUSxTQUFTO0FBQ3BDLFFBQU0sRUFBRSxjQUFjLFVBQVUsSUFBSSxtQkFBbUIsT0FBTyxVQUFVLE9BQU8sTUFBTSxZQUFZO0FBQ2pHLFFBQU0sa0JBQWtCLHNCQUFzQixPQUFPLFVBQVUsSUFBSTtBQUVuRSxTQUFPO0FBQUEsSUFDTCxXQUFXO0FBQUEsSUFDWCxPQUFPLGVBQWUsY0FBYztBQUFBLElBQ3BDLFVBQVUsZUFBZSxRQUFRO0FBQUEsSUFDakMsU0FBUyxDQUFDLEdBQUcsZ0JBQWdCLEVBQUUsS0FBSyxNQUFNO0FBQUEsSUFDMUMsU0FBUyxDQUFDLEdBQUcsT0FBTyxFQUFFLEtBQUssQ0FBQyxHQUFHLE1BQU0sT0FBTyxHQUFHLENBQUMsQ0FBQztBQUFBLElBQ2pEO0FBQUEsSUFDQTtBQUFBO0FBQUEsSUFFQSxHQUFJLFVBQVUsU0FBUyxJQUFJLEVBQUUsVUFBVSxJQUFJLENBQUM7QUFBQSxJQUM1QyxRQUFRLENBQUMsR0FBRyxNQUFNLEVBQUUsS0FBSyxNQUFNO0FBQUEsRUFDakM7QUFDRjtBQVFBLFNBQVMsaUJBQWlCLE9BQW9DLE1BQXlCO0FBQ3JGLFNBQ0UsVUFBVSxVQUNWLE1BQU0sY0FBYyxVQUNwQixNQUFNLGFBQWEsUUFDbkIsTUFBTSxVQUFVLFVBQ2hCLE1BQU0sVUFBVSxLQUFLLFNBQ3JCLE1BQU0sU0FBUyxLQUFLO0FBRXhCO0FBYU8sU0FBUyxrQkFDZCxPQUNBLFFBQ1k7QUFDWixNQUFJO0FBQ0osYUFBVyxZQUFZLFFBQVE7QUFDN0IsVUFBTSxRQUFRLE1BQU0sU0FBUyxJQUFJO0FBQ2pDLFFBQUksVUFBVSxVQUFhLE1BQU0sWUFBWSxNQUFNLGNBQWMsT0FBVztBQUM1RSxRQUFJLE1BQU0sU0FBUyxTQUFTLEtBQU07QUFDbEMsUUFBSSxNQUFNLFVBQVUsU0FBUyxNQUFPO0FBQ3BDLGlDQUFTLEVBQUUsR0FBRyxNQUFNO0FBQ3BCLFNBQUssU0FBUyxJQUFJLElBQUksRUFBRSxHQUFHLE9BQU8sT0FBTyxTQUFTLE1BQU07QUFBQSxFQUMxRDtBQUNBLFNBQU8sc0JBQVE7QUFDakI7QUFVQSxTQUFTLGNBQ1AsU0FDQSxPQUtBO0FBOVVGO0FBK1VFLFFBQU0sYUFBYSxvQkFBSSxJQUE2QjtBQUNwRCxhQUFXLGFBQWEsQ0FBQyxHQUFHLEtBQUssRUFBRSxLQUFLLE1BQU0sR0FBRztBQUMvQyxVQUFNLFNBQVMsV0FBVyxJQUFJLFVBQVUsSUFBSTtBQUM1QyxRQUFJLE9BQVEsUUFBTyxLQUFLLFNBQVM7QUFBQSxRQUM1QixZQUFXLElBQUksVUFBVSxNQUFNLENBQUMsU0FBUyxDQUFDO0FBQUEsRUFDakQ7QUFFQSxRQUFNLFdBQVcsb0JBQUksSUFBWTtBQUNqQyxRQUFNLFVBQTZCLENBQUM7QUFDcEMsUUFBTSxtQkFBdUMsQ0FBQztBQUU5QyxhQUFXLFlBQVksQ0FBQyxHQUFHLE9BQU8sRUFBRSxLQUFLLE1BQU0sR0FBRztBQUNoRCxVQUFNLGNBQWEsZ0JBQVcsSUFBSSxTQUFTLElBQUksTUFBNUIsWUFBaUMsQ0FBQztBQUNyRCxRQUFJO0FBQ0osUUFBSTtBQUNKLGVBQVcsYUFBYSxZQUFZO0FBQ2xDLFVBQUksU0FBUyxJQUFJLFVBQVUsSUFBSSxFQUFHO0FBQ2xDLFVBQUksV0FBVyxVQUFVLElBQUksTUFBTSxXQUFXLFNBQVMsSUFBSSxHQUFHO0FBQzVELDhDQUFZO0FBQUEsTUFDZCxPQUFPO0FBQ0wsaURBQWE7QUFBQSxNQUNmO0FBQUEsSUFDRjtBQUNBLFVBQU0sUUFBUSw0QkFBVztBQUN6QixRQUFJLE9BQU87QUFDVCxlQUFTLElBQUksTUFBTSxJQUFJO0FBQ3ZCLGNBQVEsS0FBSyxFQUFFLE1BQU0sU0FBUyxNQUFNLElBQUksTUFBTSxNQUFNLE1BQU0sU0FBUyxNQUFNLE1BQU0sU0FBUyxLQUFLLENBQUM7QUFBQSxJQUNoRyxPQUFPO0FBQ0wsdUJBQWlCLEtBQUssUUFBUTtBQUFBLElBQ2hDO0FBQUEsRUFDRjtBQUVBLFNBQU87QUFBQSxJQUNMO0FBQUEsSUFDQSxTQUFTO0FBQUEsSUFDVCxPQUFPLE1BQU0sT0FBTyxDQUFDLGNBQWMsQ0FBQyxTQUFTLElBQUksVUFBVSxJQUFJLENBQUM7QUFBQSxFQUNsRTtBQUNGO0FBeUJBLFNBQVMsbUJBQ1AsT0FDQSxVQUNBLE9BQ0EsTUFDQSxjQUNpRDtBQUNqRCxRQUFNLGtCQUFrQixvQkFBSSxJQUFZO0FBQ3hDLGFBQVcsUUFBUSxPQUFPO0FBQ3hCLGFBQVMsTUFBTSxXQUFXLEtBQUssSUFBSSxHQUFHLFFBQVEsS0FBSyxNQUFNLFdBQVcsR0FBRyxHQUFHO0FBQ3hFLHNCQUFnQixJQUFJLEdBQUc7QUFBQSxJQUN6QjtBQUFBLEVBQ0Y7QUFFQSxRQUFNLGVBQXlCLENBQUM7QUFDaEMsUUFBTSxZQUFzQixDQUFDO0FBQzdCLGFBQVcsT0FBTyxNQUFNO0FBQ3RCLFFBQUksUUFBUSxJQUFLO0FBQ2pCLFFBQUksVUFBVSxLQUFLLFFBQVEsRUFBRztBQUM5QixVQUFNLFFBQVEsTUFBTSxHQUFHO0FBQ3ZCLFNBQUksK0JBQU8sYUFBWSxNQUFNLGNBQWMsT0FBVztBQUN0RCxTQUFJLCtCQUFPLGFBQVksTUFBTSxjQUFjLFFBQVc7QUFLcEQsVUFBSSxnQkFBZ0IsSUFBSSxHQUFHLEtBQUssTUFBTSxNQUFNLGFBQWEsY0FBYztBQUNyRSxxQkFBYSxLQUFLLEdBQUc7QUFBQSxNQUN2QixPQUFPO0FBQ0wsa0JBQVUsS0FBSyxHQUFHO0FBQUEsTUFDcEI7QUFDQTtBQUFBLElBQ0Y7QUFDQSxRQUFJLGdCQUFnQixJQUFJLEdBQUcsRUFBRztBQUM5QixpQkFBYSxLQUFLLEdBQUc7QUFBQSxFQUN2QjtBQUNBLFNBQU87QUFBQSxJQUNMLGNBQWMsYUFBYSxLQUFLO0FBQUEsSUFDaEMsV0FBVyxVQUFVLEtBQUs7QUFBQSxFQUM1QjtBQUNGO0FBU0EsU0FBUyxzQkFDUCxPQUNBLFVBQ0EsTUFDMkI7QUFDM0IsUUFBTSxVQUFVLElBQUksSUFBSSxJQUFJO0FBQzVCLFFBQU0sa0JBQTZDLENBQUM7QUFDcEQsYUFBVyxDQUFDLE1BQU0sS0FBSyxLQUFLLE9BQU8sUUFBUSxLQUFLLEdBQUc7QUFDakQsUUFBSSxDQUFDLE1BQU0sU0FBVTtBQUNyQixRQUFJLE1BQU0sY0FBYyxPQUFXO0FBQ25DLFFBQUksUUFBUSxJQUFJLElBQUksRUFBRztBQUN2QixRQUFJLFVBQVUsTUFBTSxRQUFRLEVBQUc7QUFDL0Isb0JBQWdCLEtBQUssRUFBRSxNQUFNLFdBQVcsTUFBTSxVQUFVLENBQUM7QUFBQSxFQUMzRDtBQUNBLFNBQU8sZ0JBQWdCLEtBQUssTUFBTTtBQUNwQztBQUVBLFNBQVMsZUFBZSxZQUE4QztBQUNwRSxTQUFPLENBQUMsR0FBRyxVQUFVLEVBQUUsS0FBSyxNQUFNO0FBQ3BDO0FBRUEsU0FBUyxPQUFtRCxHQUFNLEdBQWM7QUFuZGhGO0FBb2RFLFFBQU0sUUFBTyxhQUFFLFNBQUYsWUFBVSxFQUFFLFNBQVosWUFBb0I7QUFDakMsUUFBTSxRQUFPLGFBQUUsU0FBRixZQUFVLEVBQUUsU0FBWixZQUFvQjtBQUNqQyxTQUFPLE9BQU8sT0FBTyxLQUFLLE9BQU8sT0FBTyxJQUFJO0FBQzlDOzs7QUN2VU8sSUFBTSwyQkFBMkI7QUFFakMsSUFBTSwrQkFBK0I7QUFFNUMsSUFBTSxhQUF5QjtBQUFBLEVBQzdCLE9BQU8sTUFBTTtBQUFBLEVBQUM7QUFBQSxFQUNkLE1BQU0sTUFBTTtBQUFBLEVBQUM7QUFBQSxFQUNiLE1BQU0sTUFBTTtBQUFBLEVBQUM7QUFBQSxFQUNiLE9BQU8sTUFBTTtBQUFBLEVBQUM7QUFDaEI7QUFFQSxJQUFNLGtCQUFrQixDQUFDLElBQWdCLE9BQTZCO0FBQ3BFLFFBQU0sU0FBUyxXQUFXLFdBQVcsSUFBSSxFQUFFO0FBQzNDLFNBQU8sTUFBTSxXQUFXLGFBQWEsTUFBTTtBQUM3QztBQTBCTyxJQUFNLGFBQU4sTUFBaUI7QUFBQSxFQW1FdEIsWUFBWSxTQUE0QjtBQWxFeEMsd0JBQWlCO0FBQ2pCLHdCQUFpQjtBQUNqQix3QkFBaUI7QUFDakIsd0JBQWlCO0FBQ2pCLHdCQUFpQjtBQUNqQix3QkFBaUI7QUFDakIsd0JBQWlCO0FBQ2pCLHdCQUFpQjtBQUVqQix3QkFBUSxhQUE4QjtBQUN0Qyx3QkFBUSxTQUF5QjtBQUNqQyx3QkFBUSxTQUFvQixDQUFDO0FBQzdCLHdCQUFRLFVBQVM7QUFDakIsd0JBQVEsY0FBNEI7QUFDcEMsd0JBQVEsV0FBVTtBQUNsQix3QkFBUSxhQUEwQixDQUFDO0FBQ25DLHdCQUFRO0FBQ1Isd0JBQVEsZ0JBQW9DO0FBQzVDLHdCQUFRLGtCQUFzQztBQVc5QztBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSx3QkFBUSxpQkFBK0I7QUFDdkMsd0JBQVEscUJBQW9CO0FBQzVCLHdCQUFRLDJCQUF5QztBQUdqRDtBQUFBLHdCQUFRLFlBQWdDO0FBQ3hDLHdCQUFRLGtCQUFpQjtBQUd6QjtBQUFBLHdCQUFRLFFBQXlCLFFBQVEsUUFBUTtBQUNqRCx3QkFBUSxhQUFZO0FBRXBCO0FBQUEsd0JBQVEsYUFBWTtBQUNwQix3QkFBUSxZQUFzQixDQUFDO0FBUy9CO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSx3QkFBUSxnQkFJSCxDQUFDO0FBU047QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLHdCQUFRLFlBQTBCLFFBQVEsUUFBUTtBQW1NbEQ7QUFBQSx3QkFBUSxzQkFBcUIsQ0FBQyxZQUEyQjtBQUt2RCxZQUFNLFFBQVEsS0FBSyxhQUFhLFVBQVUsQ0FBQyxnQkFBZ0IsWUFBWSxRQUFRLE9BQU8sQ0FBQztBQUN2RixVQUFJLFNBQVMsR0FBRztBQUNkLGNBQU0sY0FBYyxLQUFLLGFBQWEsS0FBSztBQUMzQyxhQUFLLGFBQWEsT0FBTyxPQUFPLENBQUM7QUFDakMsWUFBSSxnQkFBZ0IsT0FBVyxhQUFZLFFBQVEsT0FBTztBQUMxRDtBQUFBLE1BQ0Y7QUFDQSxVQUFJLEtBQUssV0FBVztBQUNsQixhQUFLLFNBQVMsS0FBSyxPQUFPO0FBQzFCO0FBQUEsTUFDRjtBQUNBLFdBQUssUUFBUSxZQUFZO0FBQ3ZCLGNBQU0sS0FBSyxTQUFTLE9BQU87QUFBQSxNQUM3QixDQUFDLEVBQUUsTUFBTSxDQUFDLFVBQW1CLEtBQUssSUFBSSxLQUFLLHlCQUF5QixLQUFLLENBQUM7QUFBQSxJQUM1RTtBQW9WQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsd0JBQVEseUJBQXVDO0FBNFcvQyx3QkFBaUIsYUFBdUIsT0FBTyxTQUFzQztBQUNuRixVQUFJLFNBQVMsR0FBSSxPQUFNLElBQUksY0FBYyw2Q0FBNkM7QUFDdEYsWUFBTSxTQUFTLE1BQU0sS0FBSyxRQUFRLFVBQVUsSUFBSSxJQUFJO0FBQ3BELFVBQUksV0FBVyxPQUFXLFFBQU87QUFDakMsWUFBTSxRQUFRLE1BQU0sS0FBSyxhQUFhLElBQUk7QUFDMUMsWUFBTSxLQUFLLFFBQVEsVUFBVSxJQUFJLE1BQU0sS0FBSztBQUM1QyxhQUFPO0FBQUEsSUFDVDtBQXRwQ0Y7QUE0UEksU0FBSyxVQUFVO0FBQ2YsU0FBSyxPQUFNLGFBQVEsUUFBUixZQUFlO0FBQzFCLFNBQUssT0FBTSxhQUFRLFFBQVIsYUFBZ0IsTUFBTSxLQUFLLElBQUk7QUFDMUMsU0FBSyxjQUFhLGFBQVEsZUFBUixZQUFzQjtBQUN4QyxTQUFLLFlBQVcsYUFBUSxhQUFSLFlBQW9CO0FBQ3BDLFNBQUssa0JBQWtCLEtBQUssSUFBSSxJQUFHLGFBQVEsb0JBQVIsWUFBMkIsd0JBQXdCO0FBQ3RGLFNBQUsscUJBQXFCLEtBQUssSUFBSSxJQUFHLGFBQVEsdUJBQVIsWUFBOEIsNEJBQTRCO0FBQ2hHLFNBQUssZ0JBQ0gsT0FBTyxRQUFRLGNBQWMsYUFDekIsUUFBUSxZQUNSLE1BQU0sUUFBUTtBQUNwQixTQUFLLGtCQUFpQixhQUFRLGFBQVIsWUFBb0IsRUFBRSxjQUFjLE1BQU07QUFBQSxFQUNsRTtBQUFBO0FBQUE7QUFBQSxFQUtBLE1BQU0sVUFBeUI7QUFDN0IsVUFBTSxLQUFLLFFBQVEsTUFBTSxLQUFLLFFBQVEsQ0FBQztBQUFBLEVBQ3pDO0FBQUE7QUFBQSxFQUdBLE1BQU0sWUFBMkI7QUFDL0IsVUFBTSxLQUFLLFFBQVEsWUFBWTtBQW5SbkM7QUFvUk0saUJBQUssY0FBTCxtQkFBZ0I7QUFDaEIsV0FBSyxZQUFZO0FBQ2pCLFlBQU0sS0FBSyxRQUFRO0FBQUEsSUFDckIsQ0FBQztBQUFBLEVBQ0g7QUFBQSxFQUVBLFFBQWM7QUExUmhCO0FBMlJJLFNBQUssYUFBYTtBQUNsQixlQUFLLG1CQUFMO0FBQ0EsU0FBSyxpQkFBaUI7QUFDdEIsZUFBSyxjQUFMLG1CQUFnQjtBQUNoQixTQUFLLFlBQVk7QUFDakIsU0FBSyxRQUFRO0FBQUEsRUFDZjtBQUFBO0FBQUEsRUFHQSxjQUFjLGNBQWtDO0FBQzlDLFNBQUssYUFBYTtBQUNsQixTQUFLLGVBQWU7QUFDcEIsaUJBQWEsTUFBTSxDQUFDLFdBQVcsS0FBSyxjQUFjLE1BQU0sQ0FBQztBQUFBLEVBQzNEO0FBQUEsRUFFQSxlQUFxQjtBQTFTdkI7QUEyU0ksZUFBSyxpQkFBTCxtQkFBbUI7QUFDbkIsU0FBSyxlQUFlO0FBQUEsRUFDdEI7QUFBQTtBQUFBLEVBR0EsTUFBTSxjQUE2QjtBQUNqQyxVQUFNLEtBQUssUUFBUSxNQUFNLEtBQUssU0FBUyxDQUFDO0FBQUEsRUFDMUM7QUFBQTtBQUFBLEVBR0EsTUFBTSxXQUEwQjtBQUM5QixXQUFPLEtBQUssWUFBWSxFQUFHLE9BQU0sS0FBSztBQUN0QyxVQUFNLEtBQUs7QUFBQSxFQUNiO0FBQUEsRUFFQSxTQUEyQjtBQUN6QixXQUFPO0FBQUEsTUFDTCxPQUFPLEtBQUs7QUFBQSxNQUNaLFlBQVksS0FBSztBQUFBLE1BQ2pCLFNBQVMsS0FBSztBQUFBLE1BQ2QsV0FBVyxDQUFDLEdBQUcsS0FBSyxTQUFTO0FBQUEsTUFDN0IsR0FBSSxLQUFLLGFBQWEsT0FBTyxFQUFFLFVBQVUsRUFBRSxHQUFHLEtBQUssU0FBUyxFQUFFLElBQUksQ0FBQztBQUFBLElBQ3JFO0FBQUEsRUFDRjtBQUFBO0FBQUEsRUFHQSxlQUEyQjtBQUN6QixXQUFPLEVBQUUsR0FBRyxLQUFLLE1BQU07QUFBQSxFQUN6QjtBQUFBO0FBQUEsRUFHQSxJQUFJLGNBQXNCO0FBQ3hCLFdBQU8sS0FBSztBQUFBLEVBQ2Q7QUFBQTtBQUFBLEVBR1EsaUJBQTBCO0FBQ2hDLFdBQU8sS0FBSyxVQUFVO0FBQUEsRUFDeEI7QUFBQTtBQUFBLEVBSUEsTUFBYyxVQUF5QjtBQXJWekM7QUFzVkksU0FBSyxRQUFRO0FBQ2IsU0FBSyxZQUFZO0FBQ2pCLFNBQUssV0FBVyxDQUFDO0FBS2pCLFFBQUksTUFBTSxLQUFLLGtCQUFrQixzQkFBc0IsR0FBRztBQUN4RCxZQUFNLFNBQVMsTUFBTSxlQUFlLEtBQUssUUFBUSxPQUFPO0FBQ3hELFdBQUssUUFBUSxPQUFPO0FBQ3BCLFdBQUssU0FBUyxPQUFPLE1BQU07QUFDM0IsV0FBSyxnQkFBZ0IsT0FBTyxNQUFNO0FBQ2xDLFdBQUssb0JBQW9CLE9BQU8sTUFBTTtBQUFBLElBQ3hDLE9BQU87QUFDTCxXQUFLLFFBQVEsQ0FBQztBQUNkLFdBQUssU0FBUztBQUNkLFdBQUssZ0JBQWdCO0FBQ3JCLFdBQUssb0JBQW9CO0FBQUEsSUFDM0I7QUFDQSxTQUFLLDBCQUEwQjtBQUUvQixVQUFNLFlBQVksS0FBSyxjQUFjO0FBQ3JDLFNBQUssWUFBWTtBQUNqQixjQUFVLFVBQVUsQ0FBQyxZQUFZLEtBQUssbUJBQW1CLE9BQU8sQ0FBQztBQUNqRSxjQUFVLFFBQVEsQ0FBQyxXQUFXLEtBQUssaUJBQWlCLE1BQU0sQ0FBQztBQUUzRCxVQUFNLFdBQVcsTUFBTSxLQUFLO0FBQUEsTUFDMUIsQ0FBQyxNQUFNLEVBQUUsU0FBUyxjQUFjLEVBQUUsU0FBUztBQUFBLE1BQzNDLE1BQ0UsVUFBVSxLQUFLO0FBQUEsUUFDYixNQUFNO0FBQUEsUUFDTixPQUFPLEtBQUssUUFBUTtBQUFBLFFBQ3BCLGlCQUFpQjtBQUFBLFFBQ2pCLFFBQVEsS0FBSztBQUFBLE1BQ2YsQ0FBQztBQUFBLElBQ0w7QUFDQSxRQUFJLFNBQVMsU0FBUyxRQUFTLE9BQU0sS0FBSyxRQUFRLFFBQVE7QUFJMUQsU0FBSyxpQkFBaUI7QUFBQSxNQUNwQixjQUFjLFNBQVMsU0FBUztBQUFBLE1BQ2hDLEdBQUksS0FBSyxlQUFlLGlCQUFpQixTQUNyQyxFQUFFLGNBQWMsS0FBSyxlQUFlLGFBQWEsSUFDakQsQ0FBQztBQUFBLElBQ1A7QUFHQSxTQUFLLDJCQUEwQixjQUFTLHNCQUFULFlBQThCO0FBRTdELFNBQUssUUFBUTtBQUNiLFFBQUksS0FBSywyQkFBMkIsR0FBRztBQVlyQyxZQUFNLFNBQVMsS0FBSztBQUNwQixXQUFLLFdBQVcsQ0FBQztBQUNqQixpQkFBVyxXQUFXLFFBQVE7QUFDNUIsY0FBTSxLQUFLLFNBQVMsT0FBTztBQUFBLE1BQzdCO0FBQUEsSUFDRjtBQUNBLFVBQU0sS0FBSyxTQUFTO0FBRXBCLFNBQUssWUFBWTtBQUNqQixVQUFNLFdBQVcsS0FBSztBQUN0QixTQUFLLFdBQVcsQ0FBQztBQUNqQixlQUFXLFdBQVcsVUFBVTtBQUM5QixZQUFNLEtBQUssU0FBUyxPQUFPO0FBQUEsSUFDN0I7QUFDQSxRQUFJLENBQUMsS0FBSyxlQUFlLEVBQUcsTUFBSyxRQUFRO0FBQUEsRUFDM0M7QUFBQSxFQUVBLE1BQWMsa0JBQWtCLE1BQWdDO0FBQzlELFFBQUk7QUFDRixhQUFPLE1BQU0sS0FBSyxRQUFRLFFBQVEsT0FBTyxJQUFJO0FBQUEsSUFDL0MsU0FBUTtBQUNOLGFBQU87QUFBQSxJQUNUO0FBQUEsRUFDRjtBQUFBLEVBRVEsaUJBQWlCLFFBQWtEO0FBOWE3RTtBQSthSSxTQUFLLElBQUksS0FBSyxvQkFBb0IsTUFBTTtBQUN4QyxTQUFLLFFBQVE7QUFDYixVQUFNLGVBQWUsS0FBSztBQUMxQixTQUFLLGVBQWUsQ0FBQztBQUNyQixlQUFXLGVBQWUsY0FBYztBQUN0QyxrQkFBWTtBQUFBLFFBQ1YsSUFBSSxhQUFhLHVCQUFzQixrQkFBTyxXQUFQLFlBQWlCLE9BQU8sU0FBeEIsWUFBZ0MsU0FBUyxFQUFFO0FBQUEsTUFDcEY7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUFBLEVBeUJBLE1BQWMsU0FBUyxTQUFpQztBQUN0RCxZQUFRLFFBQVEsTUFBTTtBQUFBLE1BQ3BCLEtBQUs7QUFDSCxjQUFNLEtBQUssYUFBYSxPQUFPO0FBQy9CO0FBQUEsTUFDRixLQUFLO0FBQ0g7QUFBQTtBQUFBLE1BQ0YsS0FBSztBQUNIO0FBQUEsTUFDRixLQUFLO0FBQ0gsYUFBSyxJQUFJLE1BQU0sZ0JBQWdCLFFBQVEsTUFBTSxRQUFRLE9BQU87QUFDNUQ7QUFBQSxNQUNGLEtBQUs7QUFBQSxNQUNMLEtBQUs7QUFBQSxNQUNMLEtBQUs7QUFBQSxNQUNMLEtBQUs7QUFBQSxNQUNMLEtBQUs7QUFBQSxNQUNMLEtBQUs7QUFHSCxhQUFLLElBQUksS0FBSywyQkFBMkIsUUFBUSxJQUFJO0FBQ3JEO0FBQUEsTUFDRjtBQUNFLGFBQUssSUFBSSxLQUFLLGlEQUFpRCxPQUFPO0FBQUEsSUFDMUU7QUFBQSxFQUNGO0FBQUEsRUFFQSxNQUFjLGFBQWEsUUFBc0M7QUE1ZW5FO0FBNmVJLFFBQUksT0FBTyxNQUFNLEtBQUssT0FBUSxNQUFLLFNBQVMsT0FBTztBQUNuRCxRQUFJLFVBQVUsT0FBTyxNQUFNLEtBQUssY0FBYyxFQUFHO0FBQ2pELFFBQUksT0FBTyxhQUFhLFVBQWEsVUFBVSxPQUFPLFVBQVUsS0FBSyxjQUFjLEVBQUc7QUFJdEYsVUFBTSxRQUFRLEtBQUssTUFBTSxPQUFPLElBQUk7QUFDcEMsUUFBSSxVQUFVLFFBQVc7QUFDdkIsVUFBSSxNQUFNLGNBQWMsT0FBTyxRQUFTO0FBQ3hDLFVBQUksY0FBYyxNQUFNLE9BQU8sT0FBTyxLQUFLLEtBQUssRUFBRztBQUFBLElBQ3JEO0FBR0EsUUFBSSxDQUFFLE1BQU0sS0FBSyxhQUFhLE1BQU0sR0FBSTtBQUN0QyxXQUFLLElBQUksS0FBSyxpREFBaUQsT0FBTyxJQUFJO0FBSTFFLFdBQUssb0JBQW9CO0FBQ3pCLFdBQUssa0JBQWtCO0FBQ3ZCO0FBQUEsSUFDRjtBQUVBLFNBQUssUUFBUSxNQUFNLEtBQUssV0FBVyxDQUFDLEtBQUssaUJBQWlCLE1BQU0sQ0FBQyxDQUFDO0FBTWxFLFFBQUksT0FBTyxRQUFPLFVBQUssa0JBQUwsWUFBc0IsR0FBSSxNQUFLLGdCQUFnQixPQUFPO0FBQUEsRUFDMUU7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFPQSxNQUFjLGFBQWEsUUFBeUM7QUFDbEUsUUFBSSxPQUFPLGFBQWEsS0FBTSxRQUFPO0FBQ3JDLFFBQUksT0FBTyxTQUFTLFlBQVksT0FBTyxhQUFhLFFBQVc7QUFDN0QsVUFBSSxNQUFNLEtBQUssdUJBQXVCLE9BQU8sUUFBUSxFQUFHLFFBQU87QUFDL0QsVUFBSSxNQUFNLEtBQUssY0FBYyxPQUFPLElBQUksR0FBRztBQUN6QyxjQUFNLFFBQVEsS0FBSyxNQUFNLE9BQU8sSUFBSTtBQUNwQyxZQUFJLFVBQVUsVUFBYSxNQUFNLGNBQWMsT0FBVyxRQUFPO0FBQ2pFLGNBQU0sU0FBUyxNQUFNLFVBQVUsTUFBTSxLQUFLLFFBQVEsUUFBUSxTQUFTLE9BQU8sSUFBSSxDQUFDO0FBQy9FLFlBQUksV0FBVyxNQUFNLEtBQU0sUUFBTztBQUFBLE1BQ3BDO0FBQ0EsYUFBTztBQUFBLElBQ1Q7QUFDQSxXQUFPLENBQUUsTUFBTSxLQUFLLHVCQUF1QixPQUFPLElBQUk7QUFBQSxFQUN4RDtBQUFBLEVBRUEsTUFBYyx1QkFBdUIsTUFBZ0M7QUFDbkUsVUFBTSxRQUFRLEtBQUssTUFBTSxJQUFJO0FBQzdCLFFBQUksK0JBQU8sU0FBVSxRQUFPO0FBQzVCLFFBQUksQ0FBRSxNQUFNLEtBQUssY0FBYyxJQUFJLEVBQUksUUFBTztBQUM5QyxRQUFJLFVBQVUsVUFBYSxNQUFNLGNBQWMsT0FBVyxRQUFPO0FBQ2pFLFVBQU0sU0FBUyxNQUFNLFVBQVUsTUFBTSxLQUFLLFFBQVEsUUFBUSxTQUFTLElBQUksQ0FBQztBQUN4RSxXQUFPLFdBQVcsTUFBTTtBQUFBLEVBQzFCO0FBQUEsRUFFQSxNQUFjLGNBQWMsTUFBZ0M7QUFDMUQsUUFBSTtBQUNGLGFBQU8sTUFBTSxLQUFLLFFBQVEsUUFBUSxPQUFPLElBQUk7QUFBQSxJQUMvQyxTQUFRO0FBQ04sYUFBTztBQUFBLElBQ1Q7QUFBQSxFQUNGO0FBQUEsRUFFUSxpQkFBaUIsUUFBK0I7QUFDdEQsUUFBSSxPQUFPLFNBQVMsWUFBWSxPQUFPLGFBQWEsUUFBVztBQUM3RCxhQUFPO0FBQUEsUUFDTCxNQUFNO0FBQUEsUUFDTixVQUFVLE9BQU87QUFBQSxRQUNqQixRQUFRLE9BQU87QUFBQSxRQUNmLE1BQU0sT0FBTztBQUFBLFFBQ2IsTUFBTSxPQUFPO0FBQUEsUUFDYixTQUFTLE9BQU87QUFBQSxRQUNoQixPQUFPLE9BQU87QUFBQSxNQUNoQjtBQUFBLElBQ0Y7QUFDQSxVQUFNLFFBQVEsS0FBSyxNQUFNLE9BQU8sSUFBSTtBQUNwQyxVQUFNLE9BQTJCLE9BQU8sVUFDcEMsV0FDQSxVQUFVLFNBQ1IsUUFDQSxNQUFNLGNBQWMsU0FDbEIsWUFDQTtBQUNSLFdBQU87QUFBQSxNQUNMO0FBQUEsTUFDQSxNQUFNLE9BQU87QUFBQSxNQUNiLE1BQU0sT0FBTztBQUFBLE1BQ2IsTUFBTSxPQUFPO0FBQUEsTUFDYixTQUFTLE9BQU87QUFBQSxNQUNoQixPQUFPLE9BQU87QUFBQSxNQUNkLFNBQVMsT0FBTztBQUFBLE1BQ2hCLEdBQUksT0FBTyxhQUFhLE9BQU8sRUFBRSxVQUFVLEtBQUssSUFBSSxDQUFDO0FBQUEsSUFDdkQ7QUFBQSxFQUNGO0FBQUE7QUFBQSxFQUdBLE1BQWMsV0FDWixPQUNBLFVBQ3FCO0FBQ3JCLFdBQU87QUFBQSxNQUNMLEtBQUssUUFBUTtBQUFBLE1BQ2IsS0FBSztBQUFBLE1BQ0wsRUFBRSxRQUFRLENBQUMsR0FBRyxPQUFPLENBQUMsR0FBRyxLQUFLLEdBQUcsV0FBVyxDQUFDLEdBQUcsY0FBYyxDQUFDLEVBQUU7QUFBQSxNQUNqRSxLQUFLO0FBQUEsTUFDTDtBQUFBLFFBQ0UsS0FBSyxLQUFLLElBQUk7QUFBQTtBQUFBO0FBQUEsUUFHZCxnQkFBZ0IsS0FBSyxlQUFlO0FBQUEsUUFDcEMsR0FBSSxhQUFhLFNBQVksRUFBRSxZQUFZLFNBQVMsV0FBVyxJQUFJLENBQUM7QUFBQSxNQUN0RTtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQUE7QUFBQSxFQUdRLGlCQUFxQztBQUMzQyxXQUFPO0FBQUEsTUFDTCxRQUFRLEtBQUs7QUFBQSxNQUNiLGVBQWUsS0FBSztBQUFBLE1BQ3BCLG1CQUFtQixLQUFLO0FBQUEsSUFDMUI7QUFBQSxFQUNGO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFRUSxhQUFhLE9BQWtCLE1BQWMsT0FBcUI7QUFybkI1RTtBQXNuQkksUUFBSSxVQUFVLEVBQUc7QUFDakIsVUFBTSxNQUFNLEtBQUssSUFBSTtBQUNyQixVQUFNLFdBQVcsUUFBUTtBQUN6QixVQUFNLGlCQUFlLFVBQUssYUFBTCxtQkFBZSxXQUFVO0FBQzlDLFFBQUksQ0FBQyxZQUFZLENBQUMsZ0JBQWdCLE1BQU0sS0FBSyxpQkFBaUIsS0FBSyxtQkFBb0I7QUFDdkYsU0FBSyxpQkFBaUI7QUFDdEIsU0FBSyxXQUFXLEVBQUUsT0FBTyxNQUFNLE1BQU07QUFBQSxFQUN2QztBQUFBO0FBQUEsRUFJUSxjQUFjLFFBQStDO0FBQ25FLFVBQU0sV0FBVyxPQUFPLE9BQU8sQ0FBQyxVQUFVLENBQUMsVUFBVSxNQUFNLE1BQU0sS0FBSyxjQUFjLENBQUM7QUFDckYsUUFBSSxTQUFTLFdBQVcsRUFBRztBQUMzQixTQUFLLFdBQVcsU0FBUztBQUN6QixTQUFLLGtCQUFrQjtBQUFBLEVBQ3pCO0FBQUE7QUFBQSxFQUdRLG9CQUEwQjtBQXpvQnBDO0FBMG9CSSxlQUFLLG1CQUFMO0FBQ0EsU0FBSyxpQkFBaUIsS0FBSyxTQUFTLE1BQU07QUFDeEMsV0FBSyxpQkFBaUI7QUFDdEIsV0FBSyxRQUFRLE1BQU0sS0FBSyxTQUFTLENBQUMsRUFBRTtBQUFBLFFBQU0sQ0FBQyxVQUN6QyxLQUFLLElBQUksS0FBSywrQkFBK0IsS0FBSztBQUFBLE1BQ3BEO0FBQUEsSUFDRixHQUFHLEtBQUssVUFBVTtBQUFBLEVBQ3BCO0FBQUE7QUFBQSxFQUlBLE1BQWMsV0FBMEI7QUFycEIxQztBQXNwQkksUUFBSSxLQUFLLGNBQWMsUUFBUSxLQUFLLGVBQWUsRUFBRztBQUN0RCxTQUFLLFFBQVE7QUFDYixTQUFLLFdBQVc7QUFDaEIsUUFBSTtBQUNGLFlBQU0sV0FBVyxNQUFNLEtBQUssY0FBYztBQUMxQyxZQUFNLGVBQWUsTUFBTTtBQUFBLFFBQ3pCLEtBQUssUUFBUTtBQUFBLFFBQ2IsS0FBSztBQUFBLFFBQ0wsS0FBSztBQUFBLFFBQ0wsS0FBSyxJQUFJO0FBQUEsUUFDVDtBQUFBLFVBQ0UsWUFBWSxDQUFDLE1BQU0sVUFBVSxLQUFLLGFBQWEsWUFBWSxNQUFNLEtBQUs7QUFBQTtBQUFBO0FBQUEsVUFHdEUsY0FBYyxLQUFLLFFBQVE7QUFBQSxRQUM3QjtBQUFBLE1BQ0Y7QUFDQSxZQUFNLE9BQU8sZ0JBQWdCO0FBQUEsUUFDM0I7QUFBQSxRQUNBLE9BQU8sS0FBSztBQUFBLFFBQ1o7QUFBQSxRQUNBLGNBQWMsS0FBSyxRQUFRO0FBQUEsUUFDM0IsZ0JBQWdCLEtBQUssUUFBUTtBQUFBLFFBQzdCLEtBQUssS0FBSyxJQUFJO0FBQUEsTUFDaEIsQ0FBQztBQUNELFdBQUssWUFBWSxDQUFDLEdBQUcsS0FBSyxXQUFXLEdBQUcsS0FBSyxTQUFTO0FBSXRELFlBQU0sU0FBUyxNQUFNLEtBQUssWUFBWSxNQUFNLGFBQWEsTUFBTTtBQUUvRCxXQUFLLFFBQVEsTUFBTSxLQUFLLFdBQVcsS0FBSyxPQUFPO0FBQUEsUUFDN0MsWUFBWSxDQUFDLE1BQU0sVUFBVSxLQUFLLGFBQWEsV0FBVyxNQUFNLEtBQUs7QUFBQSxNQUN2RSxDQUFDO0FBTUQsWUFBTSxZQUFZLE9BQU8sU0FBUyxLQUFLLGFBQWE7QUFDcEQsVUFBSSxXQUFXO0FBQ2YsWUFBTSxhQUFhLE1BQVk7QUFDN0Isb0JBQVk7QUFDWixhQUFLLGFBQWEsV0FBVyxVQUFVLFNBQVM7QUFBQSxNQUNsRDtBQUNBLFdBQUssYUFBYSxXQUFXLEdBQUcsU0FBUztBQUN6QyxZQUFNLEtBQUssZ0JBQWdCLFFBQVEsVUFBVTtBQU83QyxZQUFNLGNBQWMsb0JBQUksSUFBWTtBQUNwQyxpQkFBVyxVQUFVLFFBQVE7QUFJM0IsWUFBSTtBQUNKLFlBQUksT0FBTyxTQUFTLFlBQVksT0FBTyxhQUFhLE1BQU07QUFDeEQsZ0JBQUksVUFBSyxNQUFNLE9BQU8sSUFBSSxNQUF0QixtQkFBeUIsZUFBYyxPQUFXLGNBQWEsT0FBTztBQUFBLFFBQzVFLFdBQVcsT0FBTyxTQUFTLFlBQVksT0FBTyxhQUFhLFFBQVc7QUFDcEUsY0FBSSxFQUFFLE9BQU8sWUFBWSxLQUFLLE9BQVEsY0FBYSxPQUFPO0FBQUEsUUFDNUQ7QUFDQSxZQUFJLGVBQWUsT0FBVztBQUM5QixjQUFNLFNBQVMsTUFBTSxvQkFBb0IsS0FBSyxRQUFRLFNBQVMsS0FBSyxPQUFPLFVBQVU7QUFDckYsWUFBSSxXQUFXLE9BQVc7QUFDMUIsb0JBQVksSUFBSSxPQUFPLEdBQUc7QUFDMUIsY0FBTSxjQUFjLEtBQUssTUFBTSxPQUFPLEdBQUc7QUFDekMsYUFBSSwyQ0FBYSxhQUFZLFlBQVksY0FBYyxRQUFXO0FBR2hFLGVBQUssa0JBQWtCO0FBQUEsUUFDekI7QUFBQSxNQUNGO0FBVUEsaUJBQVcsUUFBTyxrQkFBYSxjQUFiLFlBQTBCLENBQUMsR0FBRztBQUM5QyxjQUFNLGtCQUFrQixLQUFLLFFBQVEsU0FBUyxLQUFLLE9BQU8sR0FBRztBQUFBLE1BQy9EO0FBRUEsWUFBTSxnQkFBZ0MsQ0FBQztBQUN2QyxpQkFBVyxRQUFRLEtBQUssY0FBYztBQUlwQyxZQUFJLFlBQVksSUFBSSxJQUFJLEVBQUc7QUFDM0IsWUFBSSxDQUFFLE1BQU0sS0FBSyxjQUFjLElBQUksRUFBSTtBQUN2QyxzQkFBYyxLQUFLO0FBQUEsVUFDakIsTUFBTTtBQUFBLFVBQ047QUFBQSxVQUNBLGdCQUFlLGdCQUFLLE1BQU0sSUFBSSxNQUFmLG1CQUFrQixjQUFsQixZQUErQjtBQUFBLFVBQzlDLE1BQU07QUFBQSxVQUNOLE1BQU07QUFBQSxVQUNOLFVBQVU7QUFBQSxRQUNaLENBQUM7QUFBQSxNQUNIO0FBQ0EsWUFBTSxLQUFLLGdCQUFnQixlQUFlLFVBQVU7QUFNcEQsV0FBSyxRQUFRLGtCQUFrQixLQUFLLE9BQU8sYUFBYSxNQUFNO0FBTzlELFVBQUksS0FBSywwQkFBMEIsUUFBUSxLQUFLLDBCQUF5QixVQUFLLGtCQUFMLFlBQXNCLElBQUk7QUFDakcsYUFBSyxnQkFBZ0IsS0FBSztBQUFBLE1BQzVCO0FBQ0EsV0FBSyx3QkFBd0I7QUFDN0IsV0FBSyxvQkFBb0I7QUFFekIsV0FBSyxhQUFhLEtBQUssSUFBSTtBQUMzQixXQUFLLFVBQVU7QUFDZixVQUFJLENBQUMsS0FBSyxlQUFlLEVBQUcsTUFBSyxRQUFRO0FBQUEsSUFDM0MsU0FBUyxPQUFPO0FBQ2QsV0FBSyx3QkFBd0I7QUFDN0IsV0FBSyxJQUFJLE1BQU0scUJBQXFCLEtBQUs7QUFDekMsVUFBSSxDQUFDLEtBQUssZUFBZSxFQUFHLE1BQUssUUFBUSxLQUFLLGNBQWMsT0FBTyxTQUFTO0FBQzVFLFlBQU07QUFBQSxJQUNSLFVBQUU7QUFDQSxXQUFLLFdBQVc7QUFBQSxJQUNsQjtBQUFBLEVBQ0Y7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxFQXFCUSw2QkFBc0M7QUFDNUMsV0FDRSxLQUFLLFNBQVMsS0FDZCxLQUFLLGtCQUFrQixRQUN2QixDQUFDLEtBQUsscUJBQ04sS0FBSyw0QkFBNEIsUUFDakMsS0FBSywyQkFBMkIsS0FBSyxTQUFTO0FBQUEsRUFFbEQ7QUFBQSxFQUVBLE1BQWMsZ0JBQXVDO0FBM3pCdkQ7QUE0ekJJLFVBQU0sWUFBWSxLQUFLO0FBQ3ZCLFFBQUksY0FBYyxLQUFNLE9BQU0sSUFBSSxhQUFhLGVBQWU7QUFDOUQsVUFBTSxXQUFXLEtBQUssMkJBQTJCO0FBQ2pELFVBQU0sUUFBUSxZQUFZLEtBQUssa0JBQWtCLE9BQU8sS0FBSyxnQkFBZ0I7QUFDN0UsVUFBTSxRQUFRLE1BQU0sS0FBSztBQUFBLE1BQ3ZCLENBQUMsTUFBTSxFQUFFLFNBQVMsY0FBYyxFQUFFLFNBQVM7QUFBQSxNQUMzQyxNQUFNLFVBQVUsS0FBSyxFQUFFLE1BQU0sZUFBZSxHQUFJLFVBQVUsU0FBWSxFQUFFLE1BQU0sSUFBSSxDQUFDLEVBQUcsQ0FBQztBQUFBLElBQ3pGO0FBQ0EsUUFBSSxNQUFNLFNBQVMsUUFBUyxPQUFNLEtBQUssUUFBUSxLQUFLO0FBQ3BELFFBQUksTUFBTSxTQUFTLEtBQUssT0FBUSxNQUFLLFNBQVMsTUFBTTtBQUNwRCxTQUFLLHdCQUF3QixNQUFNO0FBQ25DLFFBQUksQ0FBQyxVQUFVO0FBQ2IsYUFBTyxPQUFPLE9BQU8sTUFBTSxPQUFPLEVBQUUsSUFBSSxDQUFDLFdBQVcsRUFBRSxHQUFHLE1BQU0sRUFBRTtBQUFBLElBQ25FO0FBUUEsVUFBTSxTQUFTLG9CQUFJLElBQXdCO0FBQzNDLGVBQVcsQ0FBQyxNQUFNLEtBQUssS0FBSyxPQUFPLFFBQVEsS0FBSyxLQUFLLEdBQUc7QUFDdEQsYUFBTyxJQUFJLE1BQU07QUFBQSxRQUNmO0FBQUEsUUFDQSxTQUFTLE1BQU07QUFBQSxRQUNmLE1BQU0sTUFBTTtBQUFBLFFBQ1osTUFBTSxNQUFNO0FBQUEsUUFDWixTQUFTLE1BQU0sY0FBYztBQUFBLFFBQzdCLE9BQU8sTUFBTTtBQUFBLFFBQ2IsR0FBSSxNQUFNLFdBQVcsRUFBRSxVQUFVLEtBQUssSUFBSSxDQUFDO0FBQUEsUUFDM0MsUUFBTyxXQUFNLFVBQU4sWUFBZTtBQUFBLE1BQ3hCLENBQUM7QUFBQSxJQUNIO0FBQ0EsZUFBVyxDQUFDLE1BQU0sS0FBSyxLQUFLLE9BQU8sUUFBUSxNQUFNLE9BQU8sR0FBRztBQUN6RCxhQUFPLElBQUksTUFBTSxFQUFFLEdBQUcsTUFBTSxDQUFDO0FBQUEsSUFDL0I7QUFDQSxXQUFPLENBQUMsR0FBRyxPQUFPLE9BQU8sQ0FBQztBQUFBLEVBQzVCO0FBQUEsRUFFQSxNQUFjLFlBQ1osTUFDQSxRQUN5QjtBQXYyQjdCO0FBeTJCSSxVQUFNLGNBQWMsb0JBQUksSUFBb0I7QUFDNUMsZUFBVyxZQUFZLEtBQUssV0FBVztBQUNyQyxVQUFJLFNBQVMscUJBQXFCLFFBQVc7QUFDM0Msb0JBQVksSUFBSSxTQUFTLGtCQUFrQixTQUFTLElBQUk7QUFBQSxNQUMxRDtBQUFBLElBQ0Y7QUFHQSxVQUFNLGdCQUFnQixJQUFJLElBQUksT0FBTyxJQUFJLENBQUMsYUFBYSxDQUFDLFNBQVMsTUFBTSxTQUFTLEtBQUssQ0FBQyxDQUFDO0FBRXZGLFVBQU0sU0FBeUIsQ0FBQztBQUNoQyxlQUFXLFFBQVEsS0FBSyxRQUFRO0FBQzlCLFVBQUksS0FBSyxTQUFTLFlBQVksS0FBSyxTQUFTLFVBQVU7QUFDcEQsZUFBTyxLQUFLLEtBQUssU0FBUyxJQUFJLENBQUM7QUFDL0I7QUFBQSxNQUNGO0FBQ0EsWUFBTSxhQUNKLEtBQUssU0FBUyxrQkFBaUIsaUJBQVksSUFBSSxLQUFLLElBQUksTUFBekIsWUFBOEIsS0FBSyxPQUFPLEtBQUs7QUFDaEYsWUFBTSxRQUFRLE1BQU0sS0FBSyxVQUFVLFVBQVU7QUFDN0MsVUFBSSxVQUFVLFFBQVc7QUFDdkIsYUFBSyxJQUFJLEtBQUssOENBQThDLEtBQUssSUFBSTtBQUNyRSxhQUFLLGtCQUFrQjtBQUN2QjtBQUFBLE1BQ0Y7QUFDQSxZQUFNLE9BQU8sTUFBTSxVQUFVLEtBQUs7QUFDbEMsVUFBSSxTQUFTLEtBQUssUUFBUSxNQUFNLGVBQWUsS0FBSyxNQUFNO0FBQ3hELGFBQUssSUFBSSxLQUFLLG9EQUFvRCxLQUFLLElBQUk7QUFDM0UsYUFBSyxrQkFBa0I7QUFDdkI7QUFBQSxNQUNGO0FBQ0EsVUFBSSxLQUFLLFNBQVMsZ0JBQWdCO0FBTWhDLGNBQU0sS0FBSyxRQUFRLFFBQVEsVUFBVSxLQUFLLE1BQU0sS0FBSztBQUNyRCxlQUFPLEtBQUssRUFBRSxHQUFHLEtBQUssU0FBUyxJQUFJLEdBQUcsTUFBTSxDQUFDO0FBQzdDO0FBQUEsTUFDRjtBQUNBLGFBQU8sS0FBSztBQUFBLFFBQ1YsR0FBRyxLQUFLLFNBQVMsSUFBSTtBQUFBLFFBQ3JCO0FBQUEsUUFDQSxHQUFJLGNBQWMsSUFBSSxVQUFVLE1BQU0sU0FDbEMsRUFBRSxPQUFPLGNBQWMsSUFBSSxVQUFVLEVBQUUsSUFDdkMsQ0FBQztBQUFBLE1BQ1AsQ0FBQztBQUFBLElBQ0g7QUFDQSxXQUFPO0FBQUEsRUFDVDtBQUFBLEVBRVEsU0FBUyxNQUE0QjtBQUMzQyxRQUFJLEtBQUssU0FBUyxVQUFVO0FBQzFCLGFBQU87QUFBQSxRQUNMLE1BQU07QUFBQSxRQUNOLE1BQU0sS0FBSztBQUFBLFFBQ1gsZUFBZSxLQUFLO0FBQUEsUUFDcEIsTUFBTSxLQUFLO0FBQUEsUUFDWCxNQUFNLEtBQUs7QUFBQSxRQUNYLFVBQVUsS0FBSztBQUFBLE1BQ2pCO0FBQUEsSUFDRjtBQUNBLFdBQU87QUFBQSxNQUNMLE1BQU0sS0FBSyxTQUFTLFFBQVEsU0FBUyxLQUFLO0FBQUEsTUFDMUMsTUFBTSxLQUFLO0FBQUEsTUFDWCxlQUFlLEtBQUs7QUFBQSxNQUNwQixNQUFNLEtBQUs7QUFBQSxNQUNYLE1BQU0sS0FBSztBQUFBLE1BQ1gsR0FBSSxLQUFLLFdBQVcsRUFBRSxVQUFVLEtBQUssSUFBSSxDQUFDO0FBQUEsSUFDNUM7QUFBQSxFQUNGO0FBQUEsRUFFQSxNQUFjLFVBQVUsTUFBK0M7QUFDckUsUUFBSTtBQUNGLGFBQU8sTUFBTSxLQUFLLFFBQVEsUUFBUSxTQUFTLElBQUk7QUFBQSxJQUNqRCxTQUFRO0FBQ04sYUFBTztBQUFBLElBQ1Q7QUFBQSxFQUNGO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLEVBeUJBLE1BQWMsZ0JBQ1osU0FDQSxXQUNlO0FBQ2YsUUFBSSxRQUFRLFdBQVcsRUFBRztBQUMxQixRQUFJLE9BQU87QUFDWCxRQUFJLFVBQXdCO0FBQzVCLFVBQU0sUUFBUSxLQUFLLElBQUksS0FBSyxpQkFBaUIsUUFBUSxNQUFNO0FBQzNELFVBQU0sU0FBUyxZQUEyQjtBQUN4QyxhQUFPLE9BQU8sUUFBUSxRQUFRO0FBQzVCLFlBQUksWUFBWSxLQUFNO0FBQ3RCLGNBQU0sU0FBUyxRQUFRLE1BQU07QUFDN0IsWUFBSTtBQUNGLGdCQUFNLEtBQUssV0FBVyxNQUFNO0FBQUEsUUFDOUIsU0FBUyxPQUFPO0FBQ2QsZ0RBQVksaUJBQWlCLFFBQVEsUUFBUSxJQUFJLE1BQU0sT0FBTyxLQUFLLENBQUM7QUFDcEU7QUFBQSxRQUNGLFVBQUU7QUFDQSxvQkFBVTtBQUFBLFFBQ1o7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUNBLFVBQU0sUUFBUSxJQUFJLE1BQU0sS0FBSyxFQUFFLFFBQVEsTUFBTSxHQUFHLE1BQU0sQ0FBQztBQUN2RCxRQUFJLFlBQVksS0FBTSxPQUFNO0FBQUEsRUFDOUI7QUFBQSxFQUVBLE1BQWMsV0FBVyxRQUFxQztBQUM1RCxVQUFNLFlBQVksS0FBSztBQUN2QixRQUFJLGNBQWMsS0FBTSxPQUFNLElBQUksYUFBYSxlQUFlO0FBRTlELFVBQU0sVUFBeUI7QUFBQSxNQUM3QixNQUFNO0FBQUEsTUFDTixNQUFNLE9BQU87QUFBQSxNQUNiLGVBQWUsT0FBTztBQUFBLE1BQ3RCLE1BQU0sT0FBTztBQUFBLE1BQ2IsTUFBTSxPQUFPO0FBQUEsTUFDYixNQUFNLE9BQU87QUFBQSxNQUNiLEdBQUksT0FBTyxhQUFhLFNBQVksRUFBRSxVQUFVLE9BQU8sU0FBUyxJQUFJLENBQUM7QUFBQSxNQUNyRSxHQUFJLE9BQU8sYUFBYSxPQUFPLEVBQUUsVUFBVSxLQUFLLElBQUksQ0FBQztBQUFBLE1BQ3JELEdBQUksT0FBTyxVQUFVLFVBQWEsT0FBTyxNQUFNLGNBQWMsMkJBQ3pELEVBQUUsUUFBUSxjQUFjLE9BQU8sS0FBSyxFQUFFLElBQ3RDLENBQUM7QUFBQSxJQUNQO0FBT0EsUUFBSSxPQUFPLFVBQVUsVUFBYSxPQUFPLE1BQU0sYUFBYSwwQkFBMEI7QUFDcEYsWUFBTSxLQUFLLFdBQVcsT0FBTyxNQUFNLE9BQU8sS0FBSztBQUFBLElBQ2pEO0FBRUEsVUFBTSxRQUFRLE1BQU0sS0FBSztBQUFBLE1BQ3ZCLENBQUMsTUFBTSxFQUFFLFNBQVMsZUFBZSxFQUFFLFNBQVMsY0FBYyxFQUFFLFNBQVM7QUFBQSxNQUNyRSxNQUFNLFVBQVUsS0FBSyxPQUFPO0FBQUEsSUFDOUI7QUFDQSxRQUFJLE1BQU0sU0FBUyxRQUFTLE9BQU0sS0FBSyxRQUFRLEtBQUs7QUFJcEQsVUFBTSxLQUFLLHdCQUF3QixZQUFZO0FBQzdDLFVBQUksTUFBTSxTQUFTLGFBQWE7QUFDOUIsWUFBSSxNQUFNLE1BQU0sS0FBSyxPQUFRLE1BQUssU0FBUyxNQUFNO0FBQ2pELGFBQUssZ0JBQWdCLFFBQVEsTUFBTSxTQUFTLE1BQU0sS0FBSztBQUN2RDtBQUFBLE1BQ0Y7QUFDQSxZQUFNLEtBQUssb0JBQW9CLFFBQVEsS0FBSztBQUFBLElBQzlDLENBQUM7QUFBQSxFQUNIO0FBQUE7QUFBQSxFQUdRLHdCQUF3QixPQUEyQztBQUN6RSxVQUFNLE1BQU0sS0FBSyxTQUFTLEtBQUssT0FBTyxLQUFLO0FBQzNDLFNBQUssV0FBVyxJQUFJO0FBQUEsTUFDbEIsTUFBTTtBQUFBLE1BQUM7QUFBQSxNQUNQLE1BQU07QUFBQSxNQUFDO0FBQUEsSUFDVDtBQUNBLFdBQU87QUFBQSxFQUNUO0FBQUEsRUFFUSxnQkFBZ0IsUUFBc0IsV0FBbUIsT0FBMkI7QUFDMUYsVUFBTSxVQUFVLE9BQU8sU0FBUztBQUNoQyxRQUFJLE9BQU8sU0FBUyxZQUFZLE9BQU8sYUFBYSxRQUFXO0FBQzdELFdBQUssUUFBUSxZQUFZLFlBQVksS0FBSyxPQUFPLE9BQU8sUUFBUSxHQUFHO0FBQUEsUUFDakUsTUFBTSxPQUFPO0FBQUEsUUFDYjtBQUFBLFFBQ0EsTUFBTSxPQUFPO0FBQUEsUUFDYixNQUFNLE9BQU87QUFBQSxRQUNiO0FBQUEsTUFDRixDQUFDO0FBQ0Q7QUFBQSxJQUNGO0FBS0EsU0FBSyxRQUFRLFlBQVksS0FBSyxPQUFPO0FBQUEsTUFDbkMsTUFBTSxPQUFPO0FBQUEsTUFDYjtBQUFBLE1BQ0EsTUFBTSxPQUFPO0FBQUEsTUFDYixNQUFNLE9BQU87QUFBQSxNQUNiO0FBQUEsTUFDQTtBQUFBLE1BQ0EsV0FBVyxVQUFVLEtBQUssSUFBSSxJQUFJO0FBQUEsTUFDbEMsR0FBSSxPQUFPLGFBQWEsT0FBTyxFQUFFLFVBQVUsS0FBSyxJQUFJLENBQUM7QUFBQSxNQUNyRCxHQUFJLE9BQU8sVUFBVSxTQUFZLEVBQUUsT0FBTyxPQUFPLE1BQU0sSUFBSSxDQUFDO0FBQUEsSUFDOUQsQ0FBQztBQUFBLEVBQ0g7QUFBQSxFQUVBLE1BQWMsb0JBQ1osUUFDQSxPQUNlO0FBQ2YsUUFBSSxNQUFNLFFBQVEsVUFBYSxNQUFNLE1BQU0sS0FBSyxPQUFRLE1BQUssU0FBUyxNQUFNO0FBQzVFLFVBQU0sUUFDSixNQUFNLE9BQU8sYUFBYSxLQUFLLFFBQVEsWUFBWSxNQUFNLE9BQU8sU0FBUyxPQUFPO0FBQ2xGLFFBQUksT0FBTztBQUNULFdBQUssZ0JBQWdCLFFBQVEsTUFBTSxPQUFPLElBQUksTUFBTSxPQUFPLEtBQUs7QUFDaEU7QUFBQSxJQUNGO0FBTUEsUUFBSSxPQUFPLFNBQVMsWUFBWSxPQUFPLFNBQVMsWUFBWSxPQUFPLGFBQWEsTUFBTTtBQUNwRixZQUFNLFFBQVEsTUFBTSxLQUFLLFVBQVUsT0FBTyxJQUFJO0FBQzlDLFVBQUksVUFBVSxVQUFjLE1BQU0sVUFBVSxLQUFLLE1BQU8sT0FBTyxNQUFNO0FBQ25FLGFBQUssa0JBQWtCO0FBQ3ZCO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFFQSxRQUFJLE9BQU8sU0FBUyxZQUFZLE9BQU8sYUFBYSxRQUFXO0FBRzdELFdBQUssUUFBUSxZQUFZLEtBQUssT0FBTztBQUFBLFFBQ25DLE1BQU0sTUFBTSxPQUFPO0FBQUEsUUFDbkIsV0FBVyxNQUFNLE9BQU87QUFBQSxRQUN4QixNQUFNLE1BQU0sT0FBTztBQUFBLFFBQ25CLE1BQU0sTUFBTSxPQUFPO0FBQUEsUUFDbkIsT0FBTyxNQUFNLE9BQU87QUFBQSxNQUN0QixDQUFDO0FBQ0Q7QUFBQSxJQUNGO0FBRUEsU0FBSyxRQUFRLE1BQU0sS0FBSyxXQUFXLENBQUMsS0FBSyxhQUFhLE1BQU0sTUFBTSxDQUFDLENBQUM7QUFBQSxFQUN0RTtBQUFBO0FBQUEsRUFHUSxhQUFhLFFBUVY7QUFDVCxVQUFNLFFBQVEsS0FBSyxNQUFNLE9BQU8sSUFBSTtBQUNwQyxVQUFNLFVBQVUsT0FBTyxTQUFTO0FBQ2hDLFVBQU0sT0FBMkIsVUFDN0IsV0FDQSxVQUFVLFNBQ1IsUUFDQSxNQUFNLGNBQWMsU0FDbEIsWUFDQTtBQUNSLFdBQU87QUFBQSxNQUNMO0FBQUEsTUFDQSxNQUFNLE9BQU87QUFBQSxNQUNiLE1BQU0sT0FBTztBQUFBLE1BQ2IsTUFBTSxPQUFPO0FBQUEsTUFDYixTQUFTLE9BQU87QUFBQSxNQUNoQixPQUFPLE9BQU87QUFBQSxNQUNkO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFBQSxFQUVBLE1BQWMsV0FBVyxNQUFjLE9BQWtDO0FBQ3ZFLFVBQU0sWUFBWSxLQUFLO0FBQ3ZCLFFBQUksY0FBYyxLQUFNLE9BQU0sSUFBSSxhQUFhLGVBQWU7QUFDOUQsVUFBTSxRQUFRLE1BQU0sS0FBSztBQUFBLE1BQ3ZCLENBQUMsTUFBTSxFQUFFLFNBQVMsYUFBYSxFQUFFLFNBQVM7QUFBQSxNQUMxQyxNQUFNLFVBQVUsS0FBSyxFQUFFLE1BQU0sV0FBVyxNQUFNLFNBQVMsY0FBYyxLQUFLLEVBQUUsQ0FBQztBQUFBLElBQy9FO0FBQ0EsUUFBSSxNQUFNLFNBQVMsUUFBUyxPQUFNLEtBQUssUUFBUSxLQUFLO0FBQ3BELFVBQU0sS0FBSyxRQUFRLFVBQVUsSUFBSSxNQUFNLEtBQUs7QUFBQSxFQUM5QztBQUFBLEVBV0EsTUFBYyxhQUFhLE1BQW1DO0FBQzVELFVBQU0sWUFBWSxLQUFLO0FBQ3ZCLFFBQUksY0FBYyxLQUFNLE9BQU0sSUFBSSxhQUFhLGVBQWU7QUFDOUQsVUFBTSxRQUFRLE1BQU0sS0FBSztBQUFBLE1BQ3ZCLENBQUMsTUFBTyxFQUFFLFNBQVMsVUFBVSxFQUFFLFNBQVMsUUFBUyxFQUFFLFNBQVM7QUFBQSxNQUM1RCxNQUFNLFVBQVUsS0FBSyxFQUFFLE1BQU0sV0FBVyxLQUFLLENBQUM7QUFBQSxJQUNoRDtBQUNBLFFBQUksTUFBTSxTQUFTLFFBQVMsT0FBTSxLQUFLLFFBQVEsS0FBSztBQUNwRCxVQUFNLFFBQVEsY0FBYyxNQUFNLE9BQU87QUFDekMsUUFBSyxNQUFNLFVBQVUsS0FBSyxNQUFPLE1BQU07QUFDckMsWUFBTSxJQUFJLGNBQWMsUUFBUSxJQUFJLGtDQUFrQztBQUFBLElBQ3hFO0FBQ0EsV0FBTztBQUFBLEVBQ1Q7QUFBQTtBQUFBLEVBSVEsUUFDTixTQUNBLE1BQ1k7QUFDWixXQUFPLElBQUksUUFBVyxDQUFDLFNBQVMsV0FBVztBQUN6QyxZQUFNLGNBQWtEO0FBQUEsUUFDdEQsU0FBUyxDQUFDLFlBQVksUUFBUSxPQUFPO0FBQUEsUUFDckMsU0FBUyxDQUFDLFlBQVksUUFBUSxPQUFZO0FBQUEsUUFDMUM7QUFBQSxNQUNGO0FBQ0EsV0FBSyxhQUFhLEtBQUssV0FBVztBQUNsQyxVQUFJO0FBQ0YsYUFBSztBQUFBLE1BQ1AsU0FBUyxPQUFPO0FBQ2QsY0FBTSxRQUFRLEtBQUssYUFBYSxRQUFRLFdBQVc7QUFDbkQsWUFBSSxTQUFTLEVBQUcsTUFBSyxhQUFhLE9BQU8sT0FBTyxDQUFDO0FBQ2pELGVBQU8saUJBQWlCLFFBQVEsUUFBUSxJQUFJLGFBQWEsT0FBTyxLQUFLLENBQUMsQ0FBQztBQUFBLE1BQ3pFO0FBQUEsSUFDRixDQUFDO0FBQUEsRUFDSDtBQUFBLEVBRVEsUUFBUSxTQUFvQztBQUNsRCxZQUFRLFFBQVEsTUFBTTtBQUFBLE1BQ3BCLEtBQUs7QUFDSCxlQUFPLElBQUksa0JBQWtCLFFBQVEsT0FBTztBQUFBLE1BQzlDLEtBQUs7QUFDSCxlQUFPLElBQUksYUFBYSxRQUFRLE9BQU87QUFBQSxNQUN6QztBQUNFLGVBQU8sSUFBSSxjQUFjLFFBQVEsT0FBTztBQUFBLElBQzVDO0FBQUEsRUFDRjtBQUFBLEVBRVEsUUFBUSxXQUErQztBQUM3RCxTQUFLLGFBQWE7QUFDbEIsVUFBTSxNQUFNLEtBQUssS0FBSyxLQUFLLFdBQVcsU0FBUztBQUMvQyxVQUFNLFVBQVUsSUFBSTtBQUFBLE1BQ2xCLE1BQU07QUFDSixhQUFLLGFBQWE7QUFDbEIsYUFBSyxhQUFhO0FBQUEsTUFDcEI7QUFBQSxNQUNBLENBQUMsVUFBbUI7QUFDbEIsYUFBSyxhQUFhO0FBQ2xCLGFBQUssYUFBYTtBQUNsQixjQUFNO0FBQUEsTUFDUjtBQUFBLElBQ0Y7QUFHQSxTQUFLLE9BQU8sUUFBUTtBQUFBLE1BQ2xCLE1BQU07QUFBQSxNQUFDO0FBQUEsTUFDUCxNQUFNO0FBQUEsTUFBQztBQUFBLElBQ1Q7QUFDQSxXQUFPO0FBQUEsRUFDVDtBQUFBLEVBRVEsZUFBcUI7QUFDM0IsVUFBTSxXQUFXLG9CQUFvQixLQUFLLE9BQU8sS0FBSyxlQUFlLENBQUM7QUFDdEUsU0FBSyxLQUFLLFFBQVEsUUFDZixVQUFVLHdCQUF3QixJQUFJLFlBQVksRUFBRSxPQUFPLFFBQVEsQ0FBQyxFQUNwRSxNQUFNLENBQUMsVUFBbUIsS0FBSyxJQUFJLEtBQUssaUNBQWlDLEtBQUssQ0FBQztBQUFBLEVBQ3BGO0FBQ0Y7OztBQ2h0Q08sSUFBTSxzQkFBc0I7QUF1QjVCLElBQU0seUJBQU4sTUFBdUQ7QUFBQSxFQVU1RCxZQUFZLFNBQXdDO0FBVHBELHdCQUFpQjtBQUNqQix3QkFBaUI7QUFLakI7QUFBQTtBQUFBO0FBQUE7QUFBQSx3QkFBUSxvQkFBbUI7QUFDM0Isd0JBQVEsZUFBYztBQUdwQixTQUFLLFVBQVUsUUFBUTtBQUN2QixTQUFLLGlCQUFpQixRQUFRO0FBQUEsRUFDaEM7QUFBQTtBQUFBO0FBQUEsRUFLUSxjQUFjLFdBQTJCO0FBQy9DLFVBQU0sYUFBYSxtQkFBbUIsU0FBUztBQUMvQyxXQUFPLGVBQWUsTUFBTSxNQUFNLFdBQVcsTUFBTSxDQUFDO0FBQUEsRUFDdEQ7QUFBQTtBQUFBLEVBSUEsTUFBTSxTQUFTLE1BQW1DO0FBQ2hELFVBQU0sU0FBUyxNQUFNLEtBQUssUUFBUSxXQUFXLEtBQUssY0FBYyxJQUFJLENBQUM7QUFDckUsV0FBTyxJQUFJLFdBQVcsTUFBTTtBQUFBLEVBQzlCO0FBQUEsRUFFQSxNQUFNLFVBQVUsTUFBYyxNQUFpQztBQUM3RCxVQUFNLFNBQVMsS0FBSyxjQUFjLElBQUk7QUFDdEMsVUFBTSxLQUFLLGlCQUFpQixNQUFNO0FBR2xDLFVBQU0sU0FBUyxJQUFJLFlBQVksS0FBSyxVQUFVO0FBQzlDLFFBQUksV0FBVyxNQUFNLEVBQUUsSUFBSSxJQUFJO0FBRS9CLFFBQUksS0FBSyxrQkFBa0I7QUFDekIsWUFBTSxLQUFLLFFBQVEsWUFBWSxRQUFRLE1BQU07QUFDN0M7QUFBQSxJQUNGO0FBQ0EsVUFBTSxPQUFPLE1BQU0sS0FBSyxTQUFTO0FBQ2pDLFFBQUk7QUFDRixZQUFNLEtBQUssUUFBUSxZQUFZLE1BQU0sTUFBTTtBQUMzQyxZQUFNLEtBQUssUUFBUSxPQUFPLE1BQU0sTUFBTTtBQUFBLElBQ3hDLFNBQVE7QUFJTixZQUFNLEtBQUssYUFBYSxJQUFJO0FBQzVCLFdBQUssbUJBQW1CO0FBQ3hCLFlBQU0sS0FBSyxRQUFRLFlBQVksUUFBUSxNQUFNO0FBQUEsSUFDL0M7QUFBQSxFQUNGO0FBQUEsRUFFQSxNQUFNLFdBQVcsTUFBNkI7QUFDNUMsVUFBTSxTQUFTLEtBQUssY0FBYyxJQUFJO0FBRXRDLFFBQUksQ0FBRSxNQUFNLEtBQUssUUFBUSxPQUFPLE1BQU0sRUFBSTtBQUMxQyxRQUFJO0FBQ0YsWUFBTSxLQUFLLFFBQVEsT0FBTyxNQUFNO0FBQUEsSUFDbEMsU0FBUTtBQUVOLFVBQUksTUFBTSxLQUFLLFFBQVEsT0FBTyxNQUFNLEVBQUcsT0FBTSxJQUFJLE1BQU0sb0JBQW9CLE1BQU0sRUFBRTtBQUFBLElBQ3JGO0FBQUEsRUFDRjtBQUFBLEVBRUEsTUFBTSxXQUFXLE1BQWMsSUFBMkI7QUFDeEQsVUFBTSxXQUFXLEtBQUssY0FBYyxJQUFJO0FBQ3hDLFVBQU0sU0FBUyxLQUFLLGNBQWMsRUFBRTtBQUNwQyxVQUFNLEtBQUssaUJBQWlCLE1BQU07QUFDbEMsVUFBTSxLQUFLLFFBQVEsT0FBTyxVQUFVLE1BQU07QUFBQSxFQUM1QztBQUFBLEVBRUEsTUFBTSxZQUEwQztBQUM5QyxVQUFNLFFBQW9CLENBQUM7QUFDM0IsVUFBTSxLQUFLLFVBQVUsS0FBSyxPQUFPLGdCQUFnQjtBQUMvQyxZQUFNLE9BQU8sTUFBTSxLQUFLLFdBQVcsV0FBVztBQUM5QyxVQUFJLFNBQVMsS0FBTTtBQUNuQixZQUFNLEtBQUs7QUFBQSxRQUNULE1BQU0sSUFBSSxXQUFXO0FBQUEsUUFDckIsTUFBTSxLQUFLO0FBQUEsUUFDWCxPQUFPLEtBQUs7QUFBQSxNQUNkLENBQUM7QUFBQSxJQUNILENBQUM7QUFDRCxVQUFNLEtBQUssQ0FBQyxHQUFHLE1BQU8sRUFBRSxPQUFPLEVBQUUsT0FBTyxLQUFLLEVBQUUsT0FBTyxFQUFFLE9BQU8sSUFBSSxDQUFFO0FBQ3JFLFdBQU87QUFBQSxFQUNUO0FBQUEsRUFFQSxNQUFNLFdBQXVDO0FBQzNDLFVBQU0sT0FBaUIsQ0FBQyxHQUFHO0FBQzNCLFVBQU0sS0FBSyxZQUFZLEtBQUssT0FBTyxnQkFBZ0I7QUFDakQsV0FBSyxLQUFLLElBQUksV0FBVyxFQUFFO0FBQUEsSUFDN0IsQ0FBQztBQUNELFNBQUssS0FBSyxDQUFDLEdBQUcsTUFBTyxJQUFJLElBQUksS0FBSyxJQUFJLElBQUksSUFBSSxDQUFFO0FBQ2hELFdBQU87QUFBQSxFQUNUO0FBQUEsRUFFQSxNQUFNLFVBQVUsTUFBNkI7QUFDM0MsVUFBTSxhQUFhLG1CQUFtQixJQUFJO0FBQzFDLFVBQU0sV0FBVyxlQUFlLE1BQU0sQ0FBQyxJQUFJLFdBQVcsTUFBTSxDQUFDLEVBQUUsTUFBTSxHQUFHO0FBQ3hFLFFBQUksVUFBVTtBQUNkLGVBQVcsV0FBVyxVQUFVO0FBQzlCLGdCQUFVLFlBQVksS0FBSyxVQUFVLEdBQUcsT0FBTyxJQUFJLE9BQU87QUFDMUQsVUFBSSxDQUFFLE1BQU0sS0FBSyxRQUFRLE9BQU8sT0FBTyxFQUFJLE9BQU0sS0FBSyxRQUFRLE1BQU0sT0FBTztBQUFBLElBQzdFO0FBQUEsRUFDRjtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxFQVVBLE1BQU0sVUFBVSxNQUE2QjtBQUMzQyxVQUFNLGFBQWEsbUJBQW1CLElBQUk7QUFDMUMsUUFBSSxlQUFlLElBQUs7QUFDeEIsVUFBTSxTQUFTLEtBQUssY0FBYyxVQUFVO0FBRTVDLFFBQUksQ0FBRSxNQUFNLEtBQUssUUFBUSxPQUFPLE1BQU0sRUFBSTtBQUMxQyxRQUFJLEtBQUssbUJBQW1CLFFBQVc7QUFDckMsWUFBTSxLQUFLLGVBQWUsTUFBTTtBQUNoQztBQUFBLElBQ0Y7QUFDQSxVQUFNLEtBQUssUUFBUSxNQUFNLFFBQVEsS0FBSztBQUFBLEVBQ3hDO0FBQUEsRUFFQSxNQUFNLE9BQU8sTUFBZ0M7QUFDM0MsVUFBTSxhQUFhLG1CQUFtQixJQUFJO0FBQzFDLFFBQUksZUFBZSxJQUFLLFFBQU87QUFDL0IsUUFBSTtBQUNGLGFBQU8sTUFBTSxLQUFLLFFBQVEsT0FBTyxLQUFLLGNBQWMsVUFBVSxDQUFDO0FBQUEsSUFDakUsU0FBUTtBQUNOLGFBQU87QUFBQSxJQUNUO0FBQUEsRUFDRjtBQUFBO0FBQUEsRUFJQSxNQUFjLFdBQVcsYUFBa0Q7QUFDekUsUUFBSTtBQUNGLFlBQU0sT0FBTyxNQUFNLEtBQUssUUFBUSxLQUFLLFdBQVc7QUFDaEQsVUFBSSxTQUFTLFFBQVEsS0FBSyxTQUFTLE9BQVEsUUFBTztBQUNsRCxhQUFPLEVBQUUsTUFBTSxLQUFLLE1BQU0sT0FBTyxLQUFLLE1BQU07QUFBQSxJQUM5QyxTQUFRO0FBQ04sYUFBTztBQUFBLElBQ1Q7QUFBQSxFQUNGO0FBQUE7QUFBQSxFQUdBLE1BQWMsV0FBNEI7QUFDeEMsVUFBTSxLQUFLLFVBQVUsbUJBQW1CO0FBQ3hDLFNBQUssZUFBZTtBQUNwQixXQUFPLEdBQUcsb0JBQW9CLE1BQU0sQ0FBQyxDQUFDLE1BQU0sS0FBSyxJQUFJLEVBQUUsU0FBUyxFQUFFLENBQUMsSUFBSSxLQUFLLFdBQVc7QUFBQSxFQUN6RjtBQUFBLEVBRUEsTUFBYyxhQUFhLGFBQW9DO0FBQzdELFFBQUk7QUFDRixZQUFNLEtBQUssUUFBUSxPQUFPLFdBQVc7QUFBQSxJQUN2QyxTQUFRO0FBQUEsSUFFUjtBQUFBLEVBQ0Y7QUFBQTtBQUFBLEVBR0EsTUFBYyxpQkFBaUIsYUFBb0M7QUFDakUsVUFBTSxRQUFRLFlBQVksWUFBWSxHQUFHO0FBQ3pDLFFBQUksU0FBUyxFQUFHO0FBQ2hCLFVBQU0sU0FBUyxZQUFZLE1BQU0sR0FBRyxLQUFLO0FBQ3pDLFVBQU0sS0FBSyxVQUFVLElBQUksTUFBTSxFQUFFO0FBQUEsRUFDbkM7QUFBQTtBQUFBLEVBR0EsTUFBYyxVQUNaLGdCQUNBLE9BQ2U7QUFDZixRQUFJO0FBQ0osUUFBSTtBQUNGLGdCQUFVLE1BQU0sS0FBSyxRQUFRLEtBQUssY0FBYztBQUFBLElBQ2xELFNBQVE7QUFDTjtBQUFBLElBQ0Y7QUFDQSxlQUFXLFFBQVEsUUFBUSxNQUFPLE9BQU0sTUFBTSxJQUFJO0FBQ2xELGVBQVcsVUFBVSxRQUFRLFFBQVMsT0FBTSxLQUFLLFVBQVUsUUFBUSxLQUFLO0FBQUEsRUFDMUU7QUFBQTtBQUFBLEVBR0EsTUFBYyxZQUNaLGdCQUNBLE9BQ2U7QUFDZixRQUFJO0FBQ0osUUFBSTtBQUNGLGdCQUFVLE1BQU0sS0FBSyxRQUFRLEtBQUssY0FBYztBQUFBLElBQ2xELFNBQVE7QUFDTjtBQUFBLElBQ0Y7QUFDQSxlQUFXLFVBQVUsUUFBUSxTQUFTO0FBQ3BDLFlBQU0sTUFBTSxNQUFNO0FBQ2xCLFlBQU0sS0FBSyxZQUFZLFFBQVEsS0FBSztBQUFBLElBQ3RDO0FBQUEsRUFDRjtBQUNGOzs7QUNwT08sSUFBTSx1QkFBTixNQUFtRDtBQUFBLEVBS3hELFlBQVksU0FBc0M7QUFKbEQsd0JBQWlCO0FBQ2pCLHdCQUFRLFFBQW1CLENBQUM7QUFDNUIsd0JBQVEsUUFBOEQ7QUFHcEUsU0FBSyxRQUFRLFFBQVE7QUFBQSxFQUN2QjtBQUFBLEVBRUEsTUFBTSxJQUF3RDtBQUM1RCxTQUFLLEtBQUs7QUFDVixTQUFLLE9BQU87QUFJWixTQUFLLE9BQU87QUFBQSxNQUNWLEtBQUssTUFBTSxHQUFHLFVBQVUsQ0FBQyxTQUF3QjtBQUMvQyxhQUFLLFFBQVEsRUFBRSxNQUFNLE9BQU8sTUFBTSxZQUFZLElBQUksRUFBRSxDQUFDO0FBQUEsTUFDdkQsQ0FBQztBQUFBLE1BQ0QsS0FBSyxNQUFNLEdBQUcsVUFBVSxDQUFDLFNBQXdCO0FBQy9DLGFBQUssUUFBUSxFQUFFLE1BQU0sVUFBVSxNQUFNLFlBQVksSUFBSSxFQUFFLENBQUM7QUFBQSxNQUMxRCxDQUFDO0FBQUEsTUFDRCxLQUFLLE1BQU0sR0FBRyxVQUFVLENBQUMsU0FBd0I7QUFDL0MsYUFBSyxRQUFRLEVBQUUsTUFBTSxVQUFVLE1BQU0sWUFBWSxJQUFJLEVBQUUsQ0FBQztBQUFBLE1BQzFELENBQUM7QUFBQSxNQUNELEtBQUssTUFBTSxHQUFHLFVBQVUsQ0FBQyxNQUFxQixZQUFvQjtBQUVoRSxhQUFLLFFBQVEsRUFBRSxNQUFNLFVBQVUsTUFBTSxJQUFJLE9BQU8sSUFBSSxRQUFRLFlBQVksSUFBSSxFQUFFLENBQUM7QUFBQSxNQUNqRixDQUFDO0FBQUEsSUFDSDtBQUFBLEVBQ0Y7QUFBQSxFQUVBLE9BQWE7QUFDWCxlQUFXLE9BQU8sS0FBSyxLQUFNLE1BQUssTUFBTSxPQUFPLEdBQUc7QUFDbEQsU0FBSyxPQUFPLENBQUM7QUFDYixTQUFLLE9BQU87QUFBQSxFQUNkO0FBQUEsRUFFUSxRQUFRLE9BQThCO0FBN0RoRDtBQThESSxlQUFLLFNBQUwsOEJBQVksQ0FBQyxLQUFLO0FBQUEsRUFDcEI7QUFDRjtBQUdBLFNBQVMsWUFBWSxNQUE2QjtBQUNoRCxTQUFPLEtBQUssS0FBSyxXQUFXLEdBQUcsSUFBSSxLQUFLLE9BQU8sSUFBSSxLQUFLLElBQUk7QUFDOUQ7QUFzQk8sSUFBTSxrQkFBTixNQUFzQjtBQUFBLEVBWTNCLFlBQVksU0FBaUM7QUFYN0Msd0JBQWlCO0FBQ2pCLHdCQUFpQjtBQUNqQix3QkFBaUI7QUFDakIsd0JBQWlCO0FBQ2pCLHdCQUFpQjtBQUVqQix3QkFBUSxPQUEyQjtBQUNuQyx3QkFBUSxrQkFBMEI7QUFDbEMsd0JBQVE7QUFDUix3QkFBUSxjQUFzQjtBQXJHaEM7QUF3R0ksU0FBSyxhQUFhLFFBQVE7QUFDMUIsU0FBSyxlQUFjLGFBQVEsZ0JBQVIsWUFBdUI7QUFDMUMsU0FBSyxtQkFBa0IsYUFBUSxvQkFBUixhQUE0QixDQUFDLElBQUksT0FBTyxZQUFZLElBQUksRUFBRTtBQUNqRixTQUFLLHFCQUFvQixhQUFRLHNCQUFSLGFBQThCLENBQUMsV0FBVyxjQUFjLE1BQWdCO0FBQ2pHLFNBQUssa0JBQWlCLGFBQVEsbUJBQVIsYUFBMkIsQ0FBQyxJQUFJLE9BQU8sV0FBVyxJQUFJLEVBQUU7QUFDOUUsU0FBSyxvQkFBbUIsYUFBUSxxQkFBUixhQUE2QixDQUFDLFdBQVcsYUFBYSxNQUFnQjtBQUFBLEVBQ2hHO0FBQUE7QUFBQSxFQUdBLE1BQU0sS0FBdUI7QUFDM0IsU0FBSyxLQUFLO0FBQ1YsU0FBSyxNQUFNO0FBQ1gsU0FBSyxZQUFZO0FBQUEsRUFDbkI7QUFBQSxFQUVBLE9BQWE7QUFDWCxTQUFLLHNCQUFzQjtBQUMzQixRQUFJLEtBQUssZUFBZSxNQUFNO0FBQzVCLFdBQUssaUJBQWlCLEtBQUssVUFBVTtBQUNyQyxXQUFLLGFBQWE7QUFBQSxJQUNwQjtBQUNBLFNBQUssTUFBTTtBQUFBLEVBQ2I7QUFBQTtBQUFBLEVBR0EsY0FBYyxJQUFrQjtBQUM5QixTQUFLLGFBQWE7QUFDbEIsUUFBSSxLQUFLLFFBQVEsTUFBTTtBQUNyQixXQUFLLHNCQUFzQjtBQUMzQixXQUFLLFlBQVk7QUFBQSxJQUNuQjtBQUFBLEVBQ0Y7QUFBQTtBQUFBLEVBR0EsT0FBYTtBQUNYLFFBQUksS0FBSyxRQUFRLEtBQU07QUFDdkIsUUFBSSxLQUFLLGVBQWUsS0FBTTtBQUM5QixTQUFLLGFBQWEsS0FBSyxlQUFlLE1BQU07QUE3SWhEO0FBOElNLFdBQUssYUFBYTtBQUNsQixpQkFBSyxRQUFMO0FBQUEsSUFDRixHQUFHLEtBQUssV0FBVztBQUFBLEVBQ3JCO0FBQUEsRUFFQSxJQUFJLGtCQUEwQjtBQUM1QixXQUFPLEtBQUs7QUFBQSxFQUNkO0FBQUEsRUFFUSxjQUFvQjtBQUMxQixRQUFJLEtBQUssY0FBYyxLQUFLLEtBQUssUUFBUSxLQUFNO0FBQy9DLFNBQUssaUJBQWlCLEtBQUssZ0JBQWdCLE1BQUc7QUF6SmxEO0FBeUpxRCx3QkFBSyxRQUFMO0FBQUEsT0FBYyxLQUFLLFVBQVU7QUFBQSxFQUNoRjtBQUFBLEVBRVEsd0JBQThCO0FBQ3BDLFFBQUksS0FBSyxtQkFBbUIsTUFBTTtBQUNoQyxXQUFLLGtCQUFrQixLQUFLLGNBQWM7QUFDMUMsV0FBSyxpQkFBaUI7QUFBQSxJQUN4QjtBQUFBLEVBQ0Y7QUFDRjs7O0FDdkpPLElBQU0sZ0JBQU4sY0FBNEIsTUFBTTtBQUFBLEVBQ3ZDLFlBQ1csUUFDVCxTQUNBO0FBQ0EsVUFBTSxPQUFPO0FBSEo7QUFJVCxTQUFLLE9BQU87QUFBQSxFQUNkO0FBQ0Y7QUFXTyxJQUFNLGdCQUFOLE1BQXlDO0FBQUEsRUFLOUMsWUFBWSxTQUErQjtBQUozQyx3QkFBaUI7QUFDakIsd0JBQWlCO0FBQ2pCLHdCQUFpQjtBQWpDbkI7QUFvQ0ksU0FBSyxPQUFPLFFBQVEsUUFBUSxRQUFRLFFBQVEsRUFBRTtBQUM5QyxTQUFLLFFBQVEsUUFBUTtBQUlyQixTQUFLLFdBQVUsYUFBUSxjQUFSLFlBQXFCLFdBQVcsTUFBTSxLQUFLLFVBQVU7QUFBQSxFQUN0RTtBQUFBO0FBQUEsRUFHQSxNQUFNLElBQUksTUFBK0M7QUFDdkQsVUFBTSxXQUFXLE1BQU0sS0FBSyxRQUFRLEdBQUcsS0FBSyxJQUFJLFNBQVMsSUFBSSxJQUFJO0FBQUEsTUFDL0QsU0FBUyxFQUFFLGVBQWUsVUFBVSxLQUFLLEtBQUssR0FBRztBQUFBLElBQ25ELENBQUM7QUFDRCxRQUFJLFNBQVMsV0FBVyxJQUFLLFFBQU87QUFDcEMsUUFBSSxDQUFDLFNBQVMsSUFBSTtBQUNoQixZQUFNLElBQUksY0FBYyxTQUFTLFFBQVEsTUFBTSxhQUFhLFVBQVUsWUFBWSxDQUFDO0FBQUEsSUFDckY7QUFDQSxXQUFPLElBQUksV0FBVyxNQUFNLFNBQVMsWUFBWSxDQUFDO0FBQUEsRUFDcEQ7QUFBQTtBQUFBLEVBR0EsTUFBTSxJQUFJLE1BQWMsT0FBa0M7QUFDeEQsVUFBTSxXQUFXLE1BQU0sS0FBSyxRQUFRLEdBQUcsS0FBSyxJQUFJLFNBQVMsSUFBSSxJQUFJO0FBQUEsTUFDL0QsUUFBUTtBQUFBLE1BQ1IsU0FBUztBQUFBLFFBQ1AsZUFBZSxVQUFVLEtBQUssS0FBSztBQUFBLFFBQ25DLGdCQUFnQjtBQUFBLE1BQ2xCO0FBQUEsTUFDQSxNQUFNO0FBQUEsSUFDUixDQUFDO0FBQ0QsUUFBSSxDQUFDLFNBQVMsSUFBSTtBQUNoQixZQUFNLElBQUksY0FBYyxTQUFTLFFBQVEsTUFBTSxhQUFhLFVBQVUsWUFBWSxDQUFDO0FBQUEsSUFDckY7QUFBQSxFQUNGO0FBQ0Y7QUFFQSxlQUFlLGFBQWEsVUFBb0IsTUFBK0I7QUFDN0UsUUFBTSxVQUFVLE1BQU0sU0FBUyxLQUFLLEVBQUUsTUFBTSxNQUFNLEVBQUUsR0FBRyxNQUFNLEdBQUcsR0FBRztBQUNuRSxTQUFPLFdBQVcsS0FDZCxhQUFhLElBQUksVUFBVSxTQUFTLE1BQU0sS0FDMUMsYUFBYSxJQUFJLFVBQVUsU0FBUyxNQUFNLEtBQUssTUFBTTtBQUMzRDs7O0FDaEVBLHNCQUF5QjtBQUl6QixJQUFNLGFBQWlELEVBQUUsT0FBTyxJQUFJLE1BQU0sSUFBSSxNQUFNLElBQUksT0FBTyxHQUFHO0FBRzNGLElBQU0sZ0JBQWdCO0FBRzdCLElBQU0sZ0JBQWdCO0FBdUJmLFNBQVMsZ0JBQWdCLFVBQTRCLENBQUMsR0FBYztBQTlDM0U7QUErQ0UsUUFBTSxZQUFXLGFBQVEsYUFBUixZQUFvQjtBQUNyQyxRQUFNLE9BQU0sYUFBUSxRQUFSLGFBQWdCLE1BQU0sS0FBSyxJQUFJO0FBQzNDLE1BQUksU0FBa0IsYUFBUSxVQUFSLFlBQWlCO0FBQ3ZDLE1BQUksT0FBaUIsQ0FBQztBQUV0QixRQUFNLFFBQVEsQ0FBQyxVQUE4QixTQUFtQztBQUM5RSxRQUFJLFdBQVcsUUFBUSxJQUFJLFdBQVcsS0FBSyxFQUFHO0FBQzlDLFVBQU0sT0FBTyxHQUFHLElBQUksS0FBSyxJQUFJLENBQUMsRUFBRSxZQUFZLENBQUMsS0FBSyxRQUFRLEtBQUssS0FBSyxJQUFJLEdBQUcsRUFBRSxLQUFLLEdBQUcsQ0FBQztBQUN0RixTQUFLLEtBQUssSUFBSTtBQUNkLFFBQUksS0FBSyxTQUFTLFNBQVUsUUFBTyxLQUFLLE1BQU0sS0FBSyxTQUFTLFFBQVE7QUFDcEUsVUFBTSxPQUNKLGFBQWEsVUFBVSxRQUFRLFFBQVEsYUFBYSxTQUFTLFFBQVEsT0FBTyxRQUFRO0FBQ3RGLFNBQUssU0FBUyxHQUFHLElBQUk7QUFBQSxFQUN2QjtBQUVBLFNBQU87QUFBQSxJQUNMLE9BQU8sSUFBSSxTQUFvQixNQUFNLFNBQVMsSUFBSTtBQUFBLElBQ2xELE1BQU0sSUFBSSxTQUFvQixNQUFNLFFBQVEsSUFBSTtBQUFBLElBQ2hELE1BQU0sSUFBSSxTQUFvQixNQUFNLFFBQVEsSUFBSTtBQUFBLElBQ2hELE9BQU8sSUFBSSxTQUFvQixNQUFNLFNBQVMsSUFBSTtBQUFBLElBQ2xELFNBQVMsTUFBc0I7QUFDN0IsY0FBUTtBQUFBLElBQ1Y7QUFBQSxJQUNBLFdBQXFCO0FBQ25CLGFBQU87QUFBQSxJQUNUO0FBQUEsSUFDQSxJQUFJLGVBQXdCO0FBQzFCLGFBQU8sVUFBVTtBQUFBLElBQ25CO0FBQUEsSUFDQSxjQUF3QjtBQUN0QixhQUFPLENBQUMsR0FBRyxJQUFJO0FBQUEsSUFDakI7QUFBQSxFQUNGO0FBQ0Y7QUFHQSxTQUFTLElBQUksT0FBd0I7QUFuRnJDO0FBb0ZFLE1BQUksT0FBTyxVQUFVLFNBQVUsUUFBTyxTQUFTLEtBQUs7QUFDcEQsTUFBSSxpQkFBaUIsTUFBTyxRQUFPLFNBQVMsR0FBRyxNQUFNLElBQUksS0FBSyxNQUFNLE9BQU8sRUFBRTtBQUM3RSxNQUFJO0FBQ0YsV0FBTyxVQUFTLFVBQUssVUFBVSxLQUFLLE1BQXBCLFlBQXlCLE9BQU8sS0FBSyxDQUFDO0FBQUEsRUFDeEQsU0FBUTtBQUNOLFdBQU8sT0FBTyxLQUFLO0FBQUEsRUFDckI7QUFDRjtBQUVBLFNBQVMsU0FBUyxNQUFzQjtBQUN0QyxTQUFPLEtBQUssVUFBVSxnQkFBZ0IsT0FBTyxHQUFHLEtBQUssTUFBTSxHQUFHLGdCQUFnQixDQUFDLENBQUM7QUFDbEY7QUFLTyxTQUFTLGdCQUFnQixTQU9yQjtBQUNULFFBQU0sT0FBTyxDQUFDLFFBQVEsSUFBSTtBQUMxQixNQUFJLFFBQVEsYUFBYSxPQUFXLE1BQUssS0FBSyxHQUFHLFFBQVEsUUFBUSxTQUFJO0FBQ3JFLE1BQUksUUFBUSxTQUFTLE9BQVcsTUFBSyxLQUFLLFFBQVEsSUFBSTtBQUN0RCxNQUFJLFFBQVEsU0FBUyxPQUFXLE1BQUssS0FBSyxRQUFRLEtBQUssTUFBTSxHQUFHLEVBQUUsQ0FBQztBQUNuRSxNQUFJLFFBQVEsUUFBUSxPQUFXLE1BQUssS0FBSyxPQUFPLFFBQVEsR0FBRyxFQUFFO0FBQzdELE1BQUksUUFBUSxXQUFXLE9BQVcsTUFBSyxLQUFLLFVBQVUsUUFBUSxNQUFNLEVBQUU7QUFDdEUsU0FBTyxLQUFLLEtBQUssR0FBRztBQUN0QjtBQVlPLFNBQVMscUJBQ2QsV0FDQSxTQUNXO0FBQ1gsUUFBTSxFQUFFLEtBQUssVUFBVSxJQUFJO0FBQzNCLFNBQU87QUFBQSxJQUNMLE1BQU0sQ0FBQyxZQUFZO0FBQ2pCLFVBQUksVUFBVSxFQUFHLEtBQUksTUFBTSxVQUFLLGdCQUFnQixPQUFPLENBQUM7QUFDeEQsZ0JBQVUsS0FBSyxPQUFPO0FBQUEsSUFDeEI7QUFBQSxJQUNBLFdBQVcsQ0FBQyxhQUFhO0FBQ3ZCLGdCQUFVLFVBQVUsQ0FBQyxZQUFZO0FBQy9CLFlBQUksVUFBVSxFQUFHLEtBQUksTUFBTSxVQUFLLGdCQUFnQixPQUFPLENBQUM7QUFDeEQsaUJBQVMsT0FBTztBQUFBLE1BQ2xCLENBQUM7QUFBQSxJQUNIO0FBQUEsSUFDQSxTQUFTLENBQUMsYUFBYSxVQUFVLFFBQVEsUUFBUTtBQUFBLElBQ2pELE9BQU8sTUFBTSxVQUFVLE1BQU07QUFBQSxFQUMvQjtBQUNGO0FBZ0JPLElBQU0sbUJBQW1CO0FBR3pCLFNBQVMsdUJBQXVCLE9BQWlDO0FBQ3RFLFFBQU0sU0FBUyxNQUFNO0FBQ3JCLFFBQU0sUUFBa0I7QUFBQSxJQUN0QjtBQUFBLElBQ0EsbUJBQW1CLE1BQU0sYUFBYTtBQUFBLElBQ3RDLHFCQUFxQixlQUFlO0FBQUEsSUFDcEMsV0FBVyxNQUFNLFlBQVksY0FBYyxHQUFHLE1BQU0sYUFBYSxLQUFLLE1BQU0sVUFBVSxNQUFNLEVBQUU7QUFBQSxJQUM5RixXQUFXLE1BQU0sYUFBYSxrQkFBa0I7QUFBQSxJQUNoRCxZQUFZLE1BQU0sU0FBUyxXQUFXLFlBQVk7QUFBQSxJQUNsRCxNQUFNLFNBQ0YsaUJBQ0EsV0FBVyxPQUNULHNCQUNBLFNBQVMsT0FBTyxLQUFLLGVBQ25CLE9BQU8sZUFBZSxPQUFPLFVBQVUsR0FBRyxLQUFLLElBQUksR0FBRyxLQUFLLElBQUksSUFBSSxPQUFPLFVBQVUsQ0FBQyxRQUN2RixhQUFhLE9BQU8sT0FBTyxlQUFlLE9BQU8sVUFBVSxNQUFNO0FBQUEsSUFDdkUsYUFBYSxnQkFBZ0IsQ0FBQztBQUFBLElBQzlCLG9CQUFvQixNQUFNLGVBQWUsTUFBTTtBQUFBLEVBQ2pEO0FBQ0EsTUFBSSxNQUFNLGVBQWUsV0FBVyxHQUFHO0FBQ3JDLFVBQU0sS0FBSywyQkFBMkI7QUFBQSxFQUN4QyxPQUFPO0FBQ0wsZUFBVyxRQUFRLE1BQU0sZUFBZ0IsT0FBTSxLQUFLLEtBQUssSUFBSSxFQUFFO0FBQUEsRUFDakU7QUFDQSxTQUFPLE1BQU0sS0FBSyxJQUFJO0FBQ3hCO0FBR08sU0FBUyxrQkFBMEI7QUFDeEMsTUFBSSx5QkFBUyxhQUFhO0FBQ3hCLFVBQU0sS0FBSyx5QkFBUyxXQUFXLFFBQVEseUJBQVMsZUFBZSxZQUFZO0FBQzNFLFVBQU0sU0FBUyx5QkFBUyxXQUFXLFdBQVcseUJBQVMsVUFBVSxVQUFVO0FBQzNFLFdBQU8sd0JBQXdCLEVBQUUsS0FBSyxNQUFNO0FBQUEsRUFDOUM7QUFDQSxTQUFPO0FBQ1Q7QUFHQSxlQUFzQixnQkFBZ0IsTUFBZ0M7QUEzTXRFO0FBNE1FLFFBQU0sYUFBYSxnQkFDaEIsY0FEZ0IsbUJBQ0w7QUFDZCxPQUFJLHVDQUFXLGVBQWMsT0FBVyxRQUFPO0FBQy9DLE1BQUk7QUFDRixVQUFNLFVBQVUsVUFBVSxJQUFJO0FBQzlCLFdBQU87QUFBQSxFQUNULFNBQVE7QUFDTixXQUFPO0FBQUEsRUFDVDtBQUNGO0FBR08sU0FBUyxZQUFZLE9BQXVCO0FBQ2pELE1BQUksUUFBUSxLQUFNLFFBQU8sR0FBRyxLQUFLO0FBQ2pDLFFBQU0sUUFBUSxDQUFDLE1BQU0sTUFBTSxNQUFNLElBQUk7QUFDckMsTUFBSSxRQUFRO0FBQ1osTUFBSSxPQUFPO0FBQ1gsS0FBRztBQUNELGFBQVM7QUFDVCxZQUFRO0FBQUEsRUFDVixTQUFTLFNBQVMsUUFBUSxPQUFPLE1BQU0sU0FBUztBQUNoRCxTQUFPLEdBQUcsU0FBUyxNQUFNLEtBQUssTUFBTSxLQUFLLElBQUksTUFBTSxRQUFRLENBQUMsQ0FBQyxJQUFJLE1BQU0sSUFBSSxDQUFDO0FBQzlFOzs7QUN4TkEsSUFBQUMsbUJBQXlCO0FBOENsQixJQUFNLDhCQUE4QjtBQUdwQyxJQUFNLDBCQUEyRTtBQUFBLEVBQ3RGLEVBQUUsT0FBTyxJQUFJLE9BQU8sbUJBQW1CO0FBQUEsRUFDdkMsRUFBRSxPQUFPLElBQUksT0FBTyxtQkFBbUI7QUFBQSxFQUN2QyxFQUFFLE9BQU8sSUFBSSxPQUFPLGVBQWU7QUFBQSxFQUNuQyxFQUFFLE9BQU8sS0FBSyxPQUFPLGtCQUFrQjtBQUFBLEVBQ3ZDLEVBQUUsT0FBTyxHQUFHLE9BQU8sMEJBQTBCO0FBQy9DO0FBRU8sU0FBUyxvQkFBeUM7QUFDdkQsU0FBTztBQUFBLElBQ0wsS0FBSztBQUFBLElBQ0wsT0FBTztBQUFBLElBQ1AsVUFBVTtBQUFBLElBQ1YsWUFBWTtBQUFBLElBQ1osVUFBVTtBQUFBLE1BQ1IsbUJBQW1CO0FBQUEsTUFDbkIsY0FBYztBQUFBLE1BQ2QsZUFBZTtBQUFBLE1BQ2YsZUFBZTtBQUFBLE1BQ2YsVUFBVTtBQUFBLE1BQ1YsZ0JBQWdCO0FBQUEsSUFDbEI7QUFBQSxFQUNGO0FBQ0Y7QUFHTyxTQUFTLG9CQUFvQixLQUFtQztBQXJGdkU7QUFzRkUsUUFBTSxPQUFPLGtCQUFrQjtBQUMvQixNQUFJLE9BQU8sUUFBUSxZQUFZLFFBQVEsS0FBTSxRQUFPO0FBQ3BELFFBQU0sU0FBUztBQUNmLFFBQU0saUJBQWdCLFlBQU8sYUFBUCxtQkFBaUI7QUFDdkMsUUFBTSxZQUFXLFlBQU8sYUFBUCxtQkFBaUI7QUFDbEMsU0FBTztBQUFBLElBQ0wsS0FBSyxPQUFPLE9BQU8sUUFBUSxXQUFXLE9BQU8sTUFBTTtBQUFBLElBQ25ELE9BQU8sT0FBTyxPQUFPLFVBQVUsV0FBVyxPQUFPLFFBQVE7QUFBQSxJQUN6RCxVQUFVLE9BQU8sT0FBTyxhQUFhLFdBQVcsT0FBTyxXQUFXO0FBQUEsSUFDbEUsWUFBWSxPQUFPLE9BQU8sZUFBZSxXQUFXLE9BQU8sYUFBYTtBQUFBLElBQ3hFLFVBQVU7QUFBQSxNQUNSLG1CQUNFLFNBQU8sWUFBTyxhQUFQLG1CQUFpQix1QkFBc0IsWUFBWSxPQUFPLFNBQVMscUJBQXFCLElBQzNGLEtBQUssTUFBTSxPQUFPLFNBQVMsaUJBQWlCLElBQzVDO0FBQUEsTUFDTixnQkFBYyxZQUFPLGFBQVAsbUJBQWlCLGtCQUFpQjtBQUFBLE1BQ2hELGVBQ0Usa0JBQWtCLGFBQWEsa0JBQWtCLFdBQVcsZ0JBQWdCO0FBQUEsTUFDOUUsaUJBQWUsWUFBTyxhQUFQLG1CQUFpQixtQkFBa0I7QUFBQSxNQUNsRCxVQUFVLGFBQWEsV0FBVyxhQUFhLFNBQVMsV0FBVztBQUFBLE1BQ25FLGdCQUFnQixTQUFPLFlBQU8sYUFBUCxtQkFBaUIsb0JBQW1CLFdBQVcsT0FBTyxTQUFTLGlCQUFpQjtBQUFBLElBQ3pHO0FBQUEsRUFDRjtBQUNGO0FBTU8sU0FBUyxvQkFBb0IsTUFBd0I7QUFDMUQsU0FBTyxLQUNKLE1BQU0sT0FBTyxFQUNiLElBQUksQ0FBQyxTQUFTLEtBQUssS0FBSyxDQUFDLEVBQ3pCLE9BQU8sQ0FBQyxTQUFTLFNBQVMsRUFBRTtBQUNqQztBQUdPLFNBQVMsU0FBUyxNQUFvQztBQUMzRCxTQUFPLEtBQUssUUFBUSxNQUFNLEtBQUssVUFBVSxNQUFNLEtBQUssYUFBYTtBQUNuRTtBQUdPLFNBQVMsbUJBQXlDO0FBQ3ZELFNBQU8sMEJBQVMsY0FBYyxXQUFXO0FBQzNDO0FBR08sU0FBUyxvQkFBNEI7QUFDMUMsTUFBSSwwQkFBUyxhQUFhO0FBQ3hCLFFBQUksMEJBQVMsU0FBVSxRQUFPO0FBQzlCLFFBQUksMEJBQVMsYUFBYyxRQUFPO0FBQ2xDLFdBQU87QUFBQSxFQUNUO0FBQ0EsU0FBTztBQUNUOzs7QUNqSU8sSUFBTSxpQkFBTixjQUE2QixNQUFNO0FBQUEsRUFDeEMsWUFDRSxTQUNTLFFBQ1Q7QUFDQSxVQUFNLE9BQU87QUFGSjtBQUdULFNBQUssT0FBTztBQUFBLEVBQ2Q7QUFDRjtBQUdPLElBQU0sb0JBQU4sY0FBZ0MsTUFBTTtBQUFBLEVBQzNDLFlBQVksU0FBaUI7QUFDM0IsVUFBTSxPQUFPO0FBQ2IsU0FBSyxPQUFPO0FBQUEsRUFDZDtBQUNGO0FBR08sSUFBTSx1QkFBTixjQUFtQyxNQUFNO0FBQUEsRUFDOUMsWUFBWSxTQUFpQjtBQUMzQixVQUFNLE9BQU87QUFDYixTQUFLLE9BQU87QUFBQSxFQUNkO0FBQ0Y7QUFtQk8sU0FBUyxtQkFBbUIsT0FBdUI7QUFDeEQsTUFBSSxZQUFZLE1BQU0sS0FBSztBQUMzQixNQUFJLGNBQWMsR0FBSSxPQUFNLElBQUksZUFBZSxxQkFBcUI7QUFDcEUsTUFBSSxDQUFDLGdDQUFnQyxLQUFLLFNBQVMsRUFBRyxhQUFZLFdBQVcsU0FBUztBQUN0RixNQUFJO0FBQ0osTUFBSTtBQUNGLGFBQVMsSUFBSSxJQUFJLFNBQVMsRUFBRTtBQUFBLEVBQzlCLFNBQVE7QUFDTixVQUFNLElBQUksZUFBZSx1QkFBdUIsS0FBSyxVQUFVLEtBQUssQ0FBQyxFQUFFO0FBQUEsRUFDekU7QUFDQSxNQUFJLENBQUMsT0FBTyxXQUFXLFNBQVMsS0FBSyxDQUFDLE9BQU8sV0FBVyxVQUFVLEdBQUc7QUFDbkUsVUFBTSxJQUFJLGVBQWUsbUNBQW1DLE1BQU0sRUFBRTtBQUFBLEVBQ3RFO0FBQ0EsU0FBTztBQUNUO0FBR0EsZUFBc0IsWUFDcEIsUUFDQSxXQUNxQjtBQUNyQixNQUFJO0FBQ0osTUFBSTtBQUNGLGVBQVcsTUFBTSxVQUFVLEdBQUcsTUFBTSxTQUFTO0FBQUEsRUFDL0MsU0FBUyxPQUFPO0FBQ2QsV0FBTztBQUFBLE1BQ0wsV0FBVztBQUFBLE1BQ1gsU0FBUztBQUFBLE1BQ1QsUUFBUSxpQkFBaUIsUUFBUSxNQUFNLFVBQVUsT0FBTyxLQUFLO0FBQUEsSUFDL0Q7QUFBQSxFQUNGO0FBQ0EsTUFBSSxDQUFDLFNBQVMsSUFBSTtBQUNoQixXQUFPLEVBQUUsV0FBVyxPQUFPLFNBQVMsT0FBTyxRQUFRLFFBQVEsU0FBUyxNQUFNLEdBQUc7QUFBQSxFQUMvRTtBQUNBLFFBQU0sT0FBUSxNQUFNLFNBQVMsS0FBSyxFQUFFLE1BQU0sT0FBTyxDQUFDLEVBQUU7QUFDcEQsU0FBTyxFQUFFLFdBQVcsTUFBTSxTQUFTLEtBQUssWUFBWSxLQUFLO0FBQzNEO0FBZUEsZUFBc0IsWUFBWSxRQUFxRDtBQUNyRixNQUFJO0FBQ0osTUFBSTtBQUNGLGVBQVcsTUFBTSxPQUFPLFVBQVUsR0FBRyxPQUFPLE1BQU0sU0FBUztBQUFBLE1BQ3pELFFBQVE7QUFBQSxNQUNSLFNBQVMsRUFBRSxnQkFBZ0IsbUJBQW1CO0FBQUEsTUFDOUMsTUFBTSxLQUFLLFVBQVU7QUFBQSxRQUNuQixNQUFNLE9BQU87QUFBQSxRQUNiLFlBQVksT0FBTztBQUFBLFFBQ25CLFlBQVksT0FBTztBQUFBLE1BQ3JCLENBQUM7QUFBQSxJQUNILENBQUM7QUFBQSxFQUNILFNBQVMsT0FBTztBQUNkLFVBQU0sSUFBSTtBQUFBLE1BQ1IsaUNBQWlDLE9BQU8sTUFBTSxLQUM1QyxpQkFBaUIsUUFBUSxNQUFNLFVBQVUsT0FBTyxLQUFLLENBQ3ZEO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFFQSxRQUFNLFVBQVUsTUFBTSxTQUFTLEtBQUssRUFBRSxNQUFNLE1BQU0sRUFBRSxHQUFHLEtBQUs7QUFDNUQsTUFBSSxTQUFTLFdBQVcsS0FBSztBQUMzQixVQUFNLElBQUkscUJBQXFCLHNDQUFzQztBQUFBLEVBQ3ZFO0FBQ0EsTUFBSSxTQUFTLFdBQVcsT0FBTyxTQUFTLFdBQVcsS0FBSztBQUN0RCxVQUFNLElBQUk7QUFBQSxNQUNSO0FBQUEsSUFFRjtBQUFBLEVBQ0Y7QUFDQSxNQUFJLENBQUMsU0FBUyxJQUFJO0FBQ2hCLFVBQU0sSUFBSTtBQUFBLE1BQ1Isd0JBQXdCLFNBQVMsTUFBTSxJQUFJLE9BQU8sTUFBTSxHQUFHLEdBQUcsQ0FBQyxHQUFHLEtBQUs7QUFBQSxNQUN2RSxTQUFTO0FBQUEsSUFDWDtBQUFBLEVBQ0Y7QUFDQSxNQUFJO0FBQ0osTUFBSTtBQUNGLFdBQU8sS0FBSyxNQUFNLE1BQU07QUFBQSxFQUMxQixTQUFRO0FBQ04sVUFBTSxJQUFJLGVBQWUsOEJBQThCLFNBQVMsTUFBTTtBQUFBLEVBQ3hFO0FBQ0EsTUFBSSxPQUFPLEtBQUssVUFBVSxZQUFZLE9BQU8sS0FBSyxhQUFhLFVBQVU7QUFDdkUsVUFBTSxJQUFJLGVBQWUsNENBQTRDLFNBQVMsTUFBTTtBQUFBLEVBQ3RGO0FBQ0EsU0FBTyxFQUFFLE9BQU8sS0FBSyxPQUFPLFVBQVUsS0FBSyxTQUFTO0FBQ3REO0FBMkJBLGVBQXNCLGFBQWEsUUFBOEM7QUFDL0UsTUFBSTtBQUNKLE1BQUk7QUFDRixlQUFXLE1BQU0sT0FBTyxVQUFVLEdBQUcsT0FBTyxNQUFNLFdBQVc7QUFBQSxNQUMzRCxRQUFRO0FBQUEsTUFDUixTQUFTLEVBQUUsZ0JBQWdCLG9CQUFvQixlQUFlLFVBQVUsT0FBTyxLQUFLLEdBQUc7QUFBQSxNQUN2RixNQUFNLEtBQUssVUFBVSxFQUFFLE1BQU0sT0FBTyxLQUFLLENBQUM7QUFBQSxJQUM1QyxDQUFDO0FBQUEsRUFDSCxTQUFTLE9BQU87QUFDZCxXQUFPO0FBQUEsTUFDTCxJQUFJO0FBQUEsTUFDSixPQUFPLGlDQUFpQyxPQUFPLE1BQU0sS0FDbkQsaUJBQWlCLFFBQVEsTUFBTSxVQUFVLE9BQU8sS0FBSyxDQUN2RDtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQ0EsUUFBTSxVQUFVLE1BQU0sU0FBUyxLQUFLLEVBQUUsTUFBTSxNQUFNLEVBQUUsR0FBRyxLQUFLO0FBQzVELE1BQUksU0FBUyxXQUFXLEtBQUs7QUFDM0IsV0FBTyxFQUFFLElBQUksT0FBTyxPQUFPLHVDQUF1QztBQUFBLEVBQ3BFO0FBQ0EsTUFBSSxTQUFTLFdBQVcsT0FBTyxTQUFTLFdBQVcsS0FBSztBQUN0RCxXQUFPO0FBQUEsTUFDTCxJQUFJO0FBQUEsTUFDSixPQUFPO0FBQUEsSUFDVDtBQUFBLEVBQ0Y7QUFDQSxNQUFJLENBQUMsU0FBUyxJQUFJO0FBQ2hCLFFBQUksU0FBUyxRQUFRLFNBQVMsTUFBTTtBQUNwQyxRQUFJO0FBQ0YsWUFBTSxTQUFTLEtBQUssTUFBTSxNQUFNO0FBQ2hDLFVBQUksT0FBTyxPQUFPLFVBQVUsU0FBVSxVQUFTLE9BQU87QUFBQSxJQUN4RCxTQUFRO0FBQUEsSUFFUjtBQUNBLFdBQU8sRUFBRSxJQUFJLE9BQU8sT0FBTyxPQUFPO0FBQUEsRUFDcEM7QUFDQSxNQUFJO0FBQ0osTUFBSTtBQUNGLFdBQU8sS0FBSyxNQUFNLE1BQU07QUFBQSxFQUMxQixTQUFRO0FBQ04sV0FBTyxFQUFFLElBQUksT0FBTyxPQUFPLDRCQUE0QjtBQUFBLEVBQ3pEO0FBQ0EsUUFBTSxTQUFTLEtBQUs7QUFDcEIsTUFDRSxRQUFPLGlDQUFRLFFBQU8sWUFDdEIsT0FBTyxPQUFPLFNBQVMsWUFDdkIsT0FBTyxPQUFPLFNBQVMsVUFDdkI7QUFDQSxXQUFPLEVBQUUsSUFBSSxPQUFPLE9BQU8sK0NBQStDO0FBQUEsRUFDNUU7QUFDQSxTQUFPLEVBQUUsSUFBSSxNQUFNLFFBQVEsRUFBRSxJQUFJLE9BQU8sSUFBSSxNQUFNLE9BQU8sTUFBTSxNQUFNLE9BQU8sS0FBSyxFQUFFO0FBQ3JGO0FBZ0JBLGVBQXNCLGtCQUFrQixRQUlBO0FBQ3RDLE1BQUk7QUFDSixNQUFJO0FBQ0YsZUFBVyxNQUFNLE9BQU8sVUFBVSxHQUFHLE9BQU8sTUFBTSxlQUFlO0FBQUEsTUFDL0QsU0FBUyxFQUFFLGVBQWUsVUFBVSxPQUFPLEtBQUssR0FBRztBQUFBLElBQ3JELENBQUM7QUFBQSxFQUNILFNBQVE7QUFDTixXQUFPO0FBQUEsRUFDVDtBQUNBLE1BQUksQ0FBQyxTQUFTLEdBQUksUUFBTztBQUN6QixRQUFNLE9BQVEsTUFBTSxTQUFTLEtBQUssRUFBRSxNQUFNLE1BQU0sSUFBSTtBQUNwRCxNQUFJLFNBQVMsUUFBUSxPQUFPLEtBQUssaUJBQWlCLFlBQVksT0FBTyxLQUFLLGdCQUFnQixVQUFVO0FBQ2xHLFdBQU87QUFBQSxFQUNUO0FBQ0EsU0FBTztBQUFBLElBQ0wsV0FBVyxPQUFPLEtBQUssY0FBYyxXQUFXLEtBQUssWUFBWTtBQUFBLElBQ2pFLFNBQVMsTUFBTSxRQUFRLEtBQUssT0FBTyxJQUFJLEtBQUssVUFBVSxDQUFDO0FBQUEsSUFDdkQsYUFBYSxLQUFLO0FBQUEsSUFDbEIsY0FBYyxLQUFLO0FBQUEsRUFDckI7QUFDRjs7O0FDM09PLFNBQVMsa0JBQWtCLEtBQXFCO0FBQ3JELFNBQU87QUFBQSxJQUNMLGlCQUFpQixHQUFHO0FBQUEsSUFDcEI7QUFBQSxJQUNBLFdBQVcsR0FBRztBQUFBLElBQ2Q7QUFBQSxJQUNBO0FBQUEsSUFDQTtBQUFBLEVBQ0YsRUFBRSxLQUFLLElBQUk7QUFDYjtBQU1BLGVBQXNCLGVBQWUsUUFBOEM7QUFqRG5GO0FBa0RFLE1BQUk7QUFDSixNQUFJO0FBQ0YsYUFBUyxtQkFBbUIsT0FBTyxHQUFHO0FBQUEsRUFDeEMsU0FBUTtBQUNOLFdBQU8sRUFBRSxRQUFRLGVBQWUsT0FBTyxPQUFPLElBQUk7QUFBQSxFQUNwRDtBQUVBLFFBQU0sU0FBUyxNQUFNLFlBQVksUUFBUSxPQUFPLFNBQVM7QUFDekQsTUFBSSxDQUFDLE9BQU8sV0FBVztBQUNyQixXQUFPO0FBQUEsTUFDTCxRQUFRO0FBQUEsTUFDUixLQUFLO0FBQUEsTUFDTCxRQUNFLElBQUcsWUFBTyxXQUFQLFlBQWlCLGVBQWU7QUFBQSxJQUV2QztBQUFBLEVBQ0Y7QUFDQSxNQUFJLENBQUMsT0FBTyxTQUFTO0FBQ25CLFdBQU8sRUFBRSxRQUFRLGFBQWEsS0FBSyxRQUFRLFVBQVUsa0JBQWtCLE1BQU0sRUFBRTtBQUFBLEVBQ2pGO0FBRUEsTUFBSTtBQUNGLFVBQU0sY0FBYyxNQUFNLFlBQVk7QUFBQSxNQUNwQztBQUFBLE1BQ0EsTUFBTSxPQUFPO0FBQUEsTUFDYixZQUFZLE9BQU87QUFBQSxNQUNuQixZQUFZLE9BQU87QUFBQSxNQUNuQixXQUFXLE9BQU87QUFBQSxJQUNwQixDQUFDO0FBQ0QsV0FBTyxFQUFFLFFBQVEsVUFBVSxLQUFLLFFBQVEsR0FBRyxZQUFZO0FBQUEsRUFDekQsU0FBUyxPQUFPO0FBQ2QsUUFBSSxpQkFBaUIsc0JBQXNCO0FBQ3pDLGFBQU8sRUFBRSxRQUFRLGFBQWEsS0FBSyxRQUFRLFVBQVUsa0JBQWtCLE1BQU0sRUFBRTtBQUFBLElBQ2pGO0FBQ0EsUUFBSSxpQkFBaUIsbUJBQW1CO0FBQ3RDLGFBQU8sRUFBRSxRQUFRLFlBQVksS0FBSyxRQUFRLFFBQVEsTUFBTSxRQUFRO0FBQUEsSUFDbEU7QUFDQSxVQUFNLFNBQVMsaUJBQWlCLFFBQVEsTUFBTSxVQUFVLE9BQU8sS0FBSztBQUNwRSxXQUFPLEVBQUUsUUFBUSxZQUFZLEtBQUssUUFBUSxPQUFPO0FBQUEsRUFDbkQ7QUFDRjtBQUdPLFNBQVMsbUJBQW1CLFNBQThCO0FBQy9ELFVBQVEsUUFBUSxRQUFRO0FBQUEsSUFDdEIsS0FBSztBQUNILGFBQU8sZUFBZSxRQUFRLEdBQUc7QUFBQSxJQUNuQyxLQUFLO0FBQ0gsYUFBTyxRQUFRO0FBQUEsSUFDakIsS0FBSztBQUNILGFBQU8sK0JBQStCLFFBQVEsTUFBTTtBQUFBLElBQ3RELEtBQUs7QUFDSCxhQUFPLG1CQUFtQixRQUFRLE1BQU07QUFBQSxJQUMxQyxLQUFLO0FBQ0gsYUFBTyx5Q0FBeUMsS0FBSyxVQUFVLFFBQVEsS0FBSyxDQUFDO0FBQUEsRUFDakY7QUFDRjs7O0FDNUZBLElBQUFDLG1CQUF1QjtBQUdoQixJQUFNLGtCQUFrQjtBQXVCeEIsU0FBUyxrQkFBa0IsUUFBc0Q7QUFDdEYsUUFBTSxNQUFNLFVBQVUsUUFBUSxLQUFLO0FBQ25DLFFBQU0sT0FBTyxVQUFVLFFBQVEsTUFBTTtBQUNyQyxNQUFJLFFBQVEsTUFBTSxTQUFTLElBQUk7QUFDN0IsV0FBTyxFQUFFLElBQUksT0FBTyxPQUFPLHdCQUF3QjtBQUFBLEVBQ3JEO0FBQ0EsTUFBSSxRQUFRLEdBQUksUUFBTyxFQUFFLElBQUksT0FBTyxPQUFPLG9EQUErQztBQUMxRixNQUFJLFNBQVMsR0FBSSxRQUFPLEVBQUUsSUFBSSxPQUFPLE9BQU8sdURBQWtEO0FBQzlGLFNBQU8sRUFBRSxJQUFJLE1BQU0sTUFBTSxFQUFFLEtBQUssS0FBSyxFQUFFO0FBQ3pDO0FBRUEsU0FBUyxVQUFVLFFBQWlDLEtBQXFCO0FBQ3ZFLFFBQU0sUUFBUSxPQUFPLEdBQUc7QUFDeEIsTUFBSSxPQUFPLFVBQVUsU0FBVSxRQUFPLE9BQU8sS0FBSztBQUNsRCxNQUFJLE9BQU8sVUFBVSxTQUFVLFFBQU87QUFDdEMsUUFBTSxVQUFVLE1BQU0sS0FBSztBQUczQixNQUFJLFFBQVEsU0FBUyxHQUFHLEdBQUc7QUFDekIsUUFBSTtBQUNGLGFBQU8sbUJBQW1CLE9BQU87QUFBQSxJQUNuQyxTQUFRO0FBQ04sYUFBTztBQUFBLElBQ1Q7QUFBQSxFQUNGO0FBQ0EsU0FBTztBQUNUO0FBT08sU0FBUyw0QkFDZCxVQUNBLFFBQ007QUFDTixRQUFNLFVBQTJCLENBQUMsV0FBVztBQUMzQyxVQUFNLFNBQVMsa0JBQWtCLE1BQU07QUFDdkMsUUFBSSxDQUFDLE9BQU8sSUFBSTtBQUVkLFVBQUksT0FBTyxVQUFVLHlCQUF5QjtBQUM1QyxZQUFJLHdCQUFPLHdCQUF3QixPQUFPLEtBQUssRUFBRTtBQUFBLE1BQ25EO0FBQ0E7QUFBQSxJQUNGO0FBQ0EsU0FBSyxPQUFPLE9BQU8sSUFBSSxFQUFFLE1BQU0sQ0FBQyxVQUFtQjtBQUNqRCxjQUFRLE1BQU0sa0NBQWtDLEtBQUs7QUFDckQsVUFBSSx3QkFBTyx3RUFBbUU7QUFBQSxJQUNoRixDQUFDO0FBQUEsRUFDSDtBQUNBLFdBQVMsaUJBQWlCLE9BQU87QUFFakMsV0FBUyxHQUFHLGVBQWUsU0FBUyxPQUFPO0FBQzdDOzs7QUMxRU8sSUFBTSw0QkFBNEI7QUFDbEMsSUFBTSwyQkFBMkI7QUFNakMsU0FBUyxlQUFlLFNBQWlCLFVBQTBCLENBQUMsR0FBVztBQTNCdEY7QUE0QkUsUUFBTSxRQUFPLGFBQVEsV0FBUixZQUFrQjtBQUMvQixRQUFNLE9BQU0sYUFBUSxVQUFSLFlBQWlCO0FBQzdCLFFBQU0sVUFBUyxhQUFRLFdBQVIsWUFBa0I7QUFDakMsUUFBTSxVQUFTLGFBQVEsV0FBUixZQUFrQixLQUFLO0FBQ3RDLFFBQU0sY0FBYyxLQUFLLElBQUksS0FBSyxPQUFPLEtBQUssT0FBTztBQUNyRCxRQUFNLFNBQVMsS0FBSyxPQUFPLElBQUksSUFBSSxLQUFLO0FBQ3hDLFNBQU8sS0FBSyxNQUFNLEtBQUssSUFBSSxLQUFLLEtBQUssSUFBSSxLQUFLLGNBQWMsTUFBTSxDQUFDLENBQUM7QUFDdEU7QUFTTyxJQUFNLHNCQUFOLE1BQTBCO0FBQUEsRUFLL0IsWUFBWSxVQUEwQixDQUFDLEdBQUc7QUFKMUMsd0JBQVEsV0FBVTtBQUNsQix3QkFBUSxhQUFZO0FBQ3BCLHdCQUFpQjtBQUdmLFNBQUssVUFBVTtBQUFBLEVBQ2pCO0FBQUE7QUFBQSxFQUdBLFNBQVMsT0FBMkM7QUFDbEQsUUFBSSxVQUFVLGdCQUFnQjtBQUM1QixXQUFLLFVBQVU7QUFDZixXQUFLLFlBQVk7QUFDakIsYUFBTyxFQUFFLFFBQVEsT0FBTztBQUFBLElBQzFCO0FBQ0EsUUFBSSxLQUFLLFVBQVcsUUFBTyxFQUFFLFFBQVEsT0FBTztBQUM1QyxXQUFPLEVBQUUsUUFBUSxhQUFhLFNBQVMsZUFBZSxLQUFLLFNBQVMsS0FBSyxPQUFPLEVBQUU7QUFBQSxFQUNwRjtBQUFBO0FBQUEsRUFHQSxlQUFxQjtBQUNuQixTQUFLLFdBQVc7QUFDaEIsU0FBSyxZQUFZO0FBQUEsRUFDbkI7QUFBQTtBQUFBLEVBR0EsVUFBZ0I7QUFDZCxTQUFLLFlBQVk7QUFBQSxFQUNuQjtBQUFBO0FBQUEsRUFHQSxJQUFJLFdBQW1CO0FBQ3JCLFdBQU8sS0FBSztBQUFBLEVBQ2Q7QUFDRjs7O0FDakVBLElBQUFDLG1CQUF5RDs7O0FDNEJsRCxTQUFTLFlBQVksV0FBMkI7QUFDckQsUUFBTSxVQUFVLEtBQUssSUFBSSxHQUFHLEtBQUssTUFBTSxZQUFZLEdBQUksQ0FBQztBQUN4RCxNQUFJLFVBQVUsR0FBSSxRQUFPLEdBQUcsT0FBTztBQUNuQyxRQUFNLFVBQVUsS0FBSyxNQUFNLFVBQVUsRUFBRTtBQUN2QyxNQUFJLFVBQVUsR0FBSSxRQUFPLEdBQUcsT0FBTztBQUNuQyxTQUFPLEdBQUcsS0FBSyxNQUFNLFVBQVUsRUFBRSxDQUFDO0FBQ3BDO0FBV08sU0FBUyxjQUNkLFFBQ0EsS0FDQSxPQUFzQixZQUN0QixTQUFTLE9BQ0Q7QUFDUixNQUFJLE9BQVEsUUFBTztBQUNuQixRQUFNLFVBQVUsU0FBUztBQUN6QixVQUFRLE9BQU8sT0FBTztBQUFBLElBQ3BCLEtBQUs7QUFBQSxJQUNMLEtBQUssV0FBVztBQUNkLFlBQU0sV0FBVyxPQUFPO0FBQ3hCLFVBQUksYUFBYSxPQUFXLFFBQU8sY0FBUyxTQUFTLElBQUksSUFBSSxTQUFTLEtBQUs7QUFDM0UsYUFBTztBQUFBLElBQ1Q7QUFBQSxJQUNBLEtBQUs7QUFDSCxhQUFPLFVBQVUsZUFBVTtBQUFBLElBQzdCLEtBQUs7QUFDSCxVQUFJLE9BQU8sVUFBVSxTQUFTLEdBQUc7QUFDL0IsZUFBTyxVQUFVLGVBQVUseUJBQW9CLE9BQU8sVUFBVSxNQUFNO0FBQUEsTUFDeEU7QUFDQSxVQUFJLE9BQU8sZUFBZSxRQUFRLFFBQVMsUUFBTztBQUNsRCxhQUFPLGNBQVMsWUFBWSxNQUFNLE9BQU8sVUFBVSxDQUFDO0FBQUEsSUFDdEQsS0FBSztBQUNILGFBQU87QUFBQSxFQUNYO0FBQ0Y7QUFHTyxTQUFTLGlCQUFpQixRQUEwQixTQUF3QixLQUFxQjtBQUN0RyxRQUFNLGFBQXdEO0FBQUEsSUFDNUQsTUFBTTtBQUFBLElBQ04sWUFBWTtBQUFBLElBQ1osU0FBUztBQUFBLElBQ1QsTUFBTTtBQUFBLElBQ04sY0FBYztBQUFBLEVBQ2hCO0FBQ0EsUUFBTSxXQUFXLFFBQVEsV0FBVyxPQUFPLFdBQVcsV0FBVyxPQUFPLEtBQUs7QUFDN0UsUUFBTSxRQUFRLENBQUMsK0JBQTBCLFFBQVEsRUFBRTtBQUNuRCxNQUFJLFFBQVEsUUFBUSxHQUFJLE9BQU0sS0FBSyxXQUFXLFFBQVEsR0FBRyxFQUFFO0FBQzNELE1BQUksUUFBUSxlQUFlLEdBQUksT0FBTSxLQUFLLFdBQVcsUUFBUSxVQUFVLEVBQUU7QUFDekUsUUFBTTtBQUFBLElBQ0osT0FBTyxlQUFlLE9BQ2xCLHFCQUNBLGNBQWMsWUFBWSxNQUFNLE9BQU8sVUFBVSxDQUFDO0FBQUEsRUFDeEQ7QUFDQSxNQUFJLE9BQU8sYUFBYSxRQUFXO0FBQ2pDLFVBQU0sS0FBSyxZQUFZLE9BQU8sU0FBUyxJQUFJLElBQUksT0FBTyxTQUFTLEtBQUssS0FBSyxPQUFPLFNBQVMsS0FBSyxHQUFHO0FBQUEsRUFDbkc7QUFDQSxRQUFNLEtBQUssb0JBQW9CLE9BQU8sT0FBTyxFQUFFO0FBQy9DLFFBQU0sS0FBSyxjQUFjLE9BQU8sVUFBVSxNQUFNLEVBQUU7QUFDbEQsTUFBSSxPQUFPLFVBQVUsU0FBUyxHQUFHO0FBQy9CLFVBQU0sS0FBSyxvQkFBb0IsT0FBTyxVQUFVLElBQUksQ0FBQyxNQUFNLEVBQUUsSUFBSSxFQUFFLEtBQUssSUFBSSxDQUFDLEVBQUU7QUFBQSxFQUNqRjtBQUNBLE1BQUksUUFBUSxTQUFTLFVBQWEsUUFBUSxTQUFTLEdBQUksT0FBTSxLQUFLLFFBQVEsSUFBSTtBQUM5RSxTQUFPLE1BQU0sS0FBSyxJQUFJO0FBQ3hCO0FBR08sU0FBUyxlQUFlLFFBQWtDO0FBQy9ELE1BQUksT0FBTyxVQUFVLGVBQWdCLFFBQU87QUFDNUMsTUFBSSxPQUFPLFVBQVUsU0FBUyxFQUFHLFFBQU87QUFDeEMsU0FBTztBQUNUO0FBTU8sSUFBTSxzQkFBTixNQUFNLG9CQUFtQjtBQUFBLEVBSzlCLFlBQTZCLE1BQXNCO0FBQXRCO0FBQUEsRUFBdUI7QUFBQSxFQUVwRCxPQUFPLFFBQTBCLFNBQXdCLEtBQW1CO0FBdkk5RTtBQXdJSSxTQUFLLEtBQUssY0FBYyxjQUFjLFFBQVEsTUFBSyxhQUFRLFNBQVIsWUFBZ0IsWUFBWSxRQUFRLFdBQVcsSUFBSTtBQUN0RyxxQkFBSyxNQUFLLGFBQVYsNEJBQXFCLG9CQUFtQjtBQUN4QyxVQUFNLFdBQVcsZUFBZSxNQUFNO0FBQ3RDLGVBQVcsT0FBTyxvQkFBbUIsa0JBQWtCO0FBQ3JELFVBQUksUUFBUSxTQUFVLGtCQUFLLE1BQUssYUFBViw0QkFBcUI7QUFBQSxVQUN0QyxrQkFBSyxNQUFLLGdCQUFWLDRCQUF3QjtBQUFBLElBQy9CO0FBQ0EscUJBQUssTUFBSyxpQkFBViw0QkFBeUIsU0FBUyxpQkFBaUIsUUFBUSxTQUFTLEdBQUc7QUFBQSxFQUN6RTtBQUNGO0FBQUE7QUFmRSxjQUZXLHFCQUVhLGNBQWE7QUFDckMsY0FIVyxxQkFHYSxvQkFBbUIsQ0FBQyxZQUFZLFdBQVc7QUFIOUQsSUFBTSxxQkFBTjs7O0FEL0ZBLElBQU0sYUFDWDtBQUlLLElBQU0scUJBQXFCO0FBRzNCLFNBQVMsaUJBQXVCO0FBQ3JDLE1BQUksT0FBTyxXQUFXLFlBQWE7QUFDbkMsU0FBTyxLQUFLLFlBQVksUUFBUTtBQUNsQztBQUdPLFNBQVMsaUJBQXVCO0FBQ3JDLE1BQUksT0FBTyxXQUFXLFlBQWE7QUFDbkMsU0FBTyxLQUFLLG9CQUFvQixRQUFRO0FBQzFDO0FBR08sSUFBTSxlQUFOLGNBQTJCLHVCQUFNO0FBQUEsRUFDdEMsWUFDRSxLQUNpQixTQU1qQjtBQUNBLFVBQU0sR0FBRztBQVBRO0FBQUEsRUFRbkI7QUFBQSxFQUVTLFNBQWU7QUFDdEIsUUFBSSx5QkFBUSxLQUFLLFNBQVMsRUFBRSxRQUFRLEtBQUssUUFBUSxLQUFLLEVBQUUsUUFBUSxLQUFLLFFBQVEsSUFBSTtBQUNqRixRQUFJLHlCQUFRLEtBQUssU0FBUyxFQUFFO0FBQUEsTUFBVSxDQUFDLFdBQ3JDLE9BQU8sY0FBYyxRQUFRLEVBQUUsUUFBUSxNQUFNLEtBQUssTUFBTSxDQUFDO0FBQUEsSUFDM0Q7QUFDQSxRQUFJLHlCQUFRLEtBQUssU0FBUyxFQUFFO0FBQUEsTUFBVSxDQUFDLFdBQ3JDLE9BQ0csT0FBTyxFQUNQLGNBQWMsS0FBSyxRQUFRLFdBQVcsRUFDdEMsUUFBUSxZQUFZO0FBQ25CLGFBQUssTUFBTTtBQUNYLGNBQU0sS0FBSyxRQUFRLFVBQVU7QUFBQSxNQUMvQixDQUFDO0FBQUEsSUFDTDtBQUFBLEVBQ0Y7QUFDRjtBQUVPLElBQU0sc0JBQU4sY0FBa0Msa0NBQWlCO0FBQUEsRUFjeEQsWUFBWSxLQUFVLFFBQXlCO0FBQzdDLFVBQU0sS0FBSyxNQUFNO0FBZG5CLHdCQUFpQjtBQUVqQjtBQUFBLHdCQUFRLGVBQWM7QUFLdEI7QUFBQTtBQUFBO0FBQUE7QUFBQSx3QkFBUSxlQUE2QjtBQUNyQyx3QkFBUSxlQUE4QjtBQUN0Qyx3QkFBUSxpQkFBZ0M7QUFDeEMsd0JBQVEsa0JBQWlDO0FBQ3pDLHdCQUFRLGlCQUF1RDtBQUk3RCxTQUFLLFNBQVM7QUFBQSxFQUNoQjtBQUFBLEVBRVMsVUFBZ0I7QUFDdkIsU0FBSyxZQUFZO0FBQ2pCLFVBQU0sRUFBRSxZQUFZLElBQUk7QUFDeEIsZ0JBQVksTUFBTTtBQUNsQixTQUFLLGNBQWM7QUFDbkIsU0FBSyxnQkFBZ0I7QUFDckIsU0FBSyxpQkFBaUI7QUFDdEIsU0FBSyxjQUFjO0FBRW5CLFNBQUssd0JBQXdCO0FBQzdCLFNBQUssa0JBQWtCO0FBQ3ZCLFNBQUssc0JBQXNCO0FBQzNCLFNBQUssbUJBQW1CO0FBQ3hCLFNBQUssYUFBYTtBQUFBLEVBQ3BCO0FBQUEsRUFFUyxPQUFhO0FBQ3BCLFNBQUssWUFBWTtBQUFBLEVBQ25CO0FBQUE7QUFBQSxFQUlRLFFBQVEsTUFBb0I7QUFDbEMsUUFBSSx5QkFBUSxLQUFLLFdBQVcsRUFBRSxRQUFRLElBQUksRUFBRSxXQUFXO0FBQUEsRUFDekQ7QUFBQSxFQUVRLDBCQUFnQztBQUN0QyxVQUFNLEVBQUUsWUFBWSxJQUFJO0FBQ3hCLFNBQUssUUFBUSxZQUFZO0FBRXpCLFFBQUkseUJBQVEsV0FBVyxFQUNwQixRQUFRLFlBQVksRUFDcEI7QUFBQSxNQUNDO0FBQUEsSUFDRixFQUNDO0FBQUEsTUFBUSxDQUFDLFNBQ1IsS0FDRyxlQUFlLGdDQUFnQyxFQUMvQyxTQUFTLEtBQUssT0FBTyxLQUFLLEdBQUcsRUFDN0IsU0FBUyxPQUFPLFVBQVU7QUFDekIsYUFBSyxPQUFPLEtBQUssTUFBTSxNQUFNLEtBQUs7QUFDbEMsY0FBTSxLQUFLLE9BQU8sZUFBZTtBQUFBLE1BQ25DLENBQUM7QUFBQSxJQUNMO0FBRUYsUUFBSSxLQUFLLE9BQU8sUUFBUTtBQUN0QixXQUFLLHVCQUF1QjtBQUM1QixXQUFLLG1CQUFtQjtBQUFBLElBQzFCLE9BQU87QUFDTCxXQUFLLHdCQUF3QjtBQUM3QixXQUFLLHFCQUFxQjtBQUFBLElBQzVCO0FBQUEsRUFDRjtBQUFBO0FBQUEsRUFHUSwwQkFBZ0M7QUFDdEMsUUFBSSx5QkFBUSxLQUFLLFdBQVcsRUFDekIsUUFBUSxhQUFhLEVBQ3JCLFFBQVEsd0VBQXdFLEVBQ2hGO0FBQUEsTUFBUSxDQUFDLFNBQ1IsS0FDRyxlQUFlLGtCQUFrQixDQUFDLEVBQ2xDLFNBQVMsS0FBSyxPQUFPLEtBQUssVUFBVSxFQUNwQyxTQUFTLE9BQU8sVUFBVTtBQUN6QixhQUFLLE9BQU8sS0FBSyxhQUFhLE1BQU0sS0FBSztBQUN6QyxjQUFNLEtBQUssT0FBTyxlQUFlO0FBQUEsTUFDbkMsQ0FBQztBQUFBLElBQ0w7QUFBQSxFQUNKO0FBQUE7QUFBQSxFQUdRLHlCQUErQjtBQTdLekM7QUE4S0ksVUFBTSxXQUFVLFVBQUssZ0JBQUwsWUFBb0IsS0FBSyxPQUFPLEtBQUs7QUFDckQsUUFBSSx5QkFBUSxLQUFLLFdBQVcsRUFDekIsUUFBUSxhQUFhLEVBQ3JCO0FBQUEsTUFDQztBQUFBLElBQ0YsRUFDQztBQUFBLE1BQVEsQ0FBQyxTQUNSLEtBQ0csZUFBZSxrQkFBa0IsQ0FBQyxFQUNsQyxTQUFTLE9BQU8sRUFDaEIsU0FBUyxDQUFDLFVBQVU7QUFDbkIsYUFBSyxjQUFjO0FBQUEsTUFDckIsQ0FBQztBQUFBLElBQ0wsRUFDQztBQUFBLE1BQVUsQ0FBQyxXQUNWLE9BQU8sY0FBYyxlQUFlLEVBQUUsUUFBUSxZQUFZO0FBN0xsRSxZQUFBQztBQThMVSxlQUFPLFlBQVksSUFBSTtBQUN2QixZQUFJO0FBQ0YsZ0JBQU0sS0FBSyxNQUFNLEtBQUssT0FBTyxjQUFhQSxNQUFBLEtBQUssZ0JBQUwsT0FBQUEsTUFBb0IsS0FBSyxPQUFPLEtBQUssVUFBVTtBQUN6RixjQUFJLEdBQUksTUFBSyxRQUFRO0FBQUEsUUFDdkIsVUFBRTtBQUNBLGlCQUFPLFlBQVksS0FBSztBQUFBLFFBQzFCO0FBQUEsTUFDRixDQUFDO0FBQUEsSUFDSDtBQUFBLEVBQ0o7QUFBQSxFQUVRLHVCQUE2QjtBQUNuQyxVQUFNLEVBQUUsWUFBWSxJQUFJO0FBQ3hCLFFBQUkseUJBQVEsV0FBVyxFQUNwQixRQUFRLGNBQWMsRUFDdEIsUUFBUSw2R0FBd0csRUFDaEg7QUFBQSxNQUFRLENBQUMsU0FDUixLQUNHLGVBQWUsV0FBVyxFQUMxQixTQUFTLENBQUMsVUFBVTtBQUNuQixhQUFLLGNBQWMsTUFBTSxLQUFLO0FBQUEsTUFDaEMsQ0FBQztBQUFBLElBQ0w7QUFFRixRQUFJLHlCQUFRLFdBQVcsRUFBRTtBQUFBLE1BQVUsQ0FBQyxXQUNsQyxPQUNHLE9BQU8sRUFDUCxjQUFjLGlCQUFpQixFQUMvQixRQUFRLFlBQVk7QUFDbkIsZUFBTyxZQUFZLElBQUk7QUFDdkIsWUFBSTtBQUNGLGdCQUFNLFVBQVUsTUFBTSxLQUFLLE9BQU8saUJBQWlCLEtBQUssV0FBVztBQUNuRSxlQUFLLFlBQVksT0FBTztBQUFBLFFBQzFCLFVBQUU7QUFDQSxpQkFBTyxZQUFZLEtBQUs7QUFBQSxRQUMxQjtBQUFBLE1BQ0YsQ0FBQztBQUFBLElBQ0w7QUFFQSxTQUFLLGNBQWMsSUFBSSx5QkFBUSxXQUFXLEVBQ3ZDLFFBQVEsaUJBQWlCLEVBQ3pCLFNBQVMsbUJBQW1CLEVBQzVCO0FBQUEsTUFDQztBQUFBLFFBQ0U7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxNQUNGLEVBQUUsS0FBSyxJQUFJO0FBQUEsSUFDYixFQUNDO0FBQUEsTUFBVSxDQUFDLFdBQ1YsT0FBTyxjQUFjLG9CQUFvQixFQUFFLFFBQVEsTUFBTSxlQUFlLENBQUM7QUFBQSxJQUMzRTtBQUFBLEVBQ0o7QUFBQSxFQUVRLHFCQUEyQjtBQUNqQyxVQUFNLEVBQUUsWUFBWSxJQUFJO0FBRXhCLFNBQUssZ0JBQWdCLElBQUkseUJBQVEsV0FBVyxFQUN6QyxRQUFRLFFBQVEsRUFDaEIsU0FBUyxvQkFBb0IsRUFDN0IsUUFBUSxLQUFLLFdBQVcsQ0FBQztBQUU1QixRQUFJLHlCQUFRLFdBQVcsRUFBRTtBQUFBLE1BQVUsQ0FBQyxXQUNsQyxPQUFPLGNBQWMsVUFBVSxFQUFFLFFBQVEsWUFBWTtBQUNuRCxlQUFPLFlBQVksSUFBSTtBQUN2QixZQUFJO0FBQ0YsZ0JBQU0sS0FBSyxPQUFPLFFBQVE7QUFBQSxRQUM1QixVQUFFO0FBQ0EsaUJBQU8sWUFBWSxLQUFLO0FBQ3hCLGVBQUssY0FBYztBQUFBLFFBQ3JCO0FBQUEsTUFDRixDQUFDO0FBQUEsSUFDSDtBQUVBLFFBQUkseUJBQVEsV0FBVyxFQUFFO0FBQUEsTUFBVSxDQUFDLFdBQ2xDLE9BQU8sY0FBYyxtQkFBbUIsRUFBRSxRQUFRLE1BQU07QUFDdEQsWUFBSSxhQUFhLEtBQUssS0FBSztBQUFBLFVBQ3pCLE9BQU87QUFBQSxVQUNQLE1BQU07QUFBQSxVQUNOLGFBQWE7QUFBQSxVQUNiLFdBQVcsWUFBWTtBQUNyQixrQkFBTSxLQUFLLE9BQU8sT0FBTztBQUN6QixpQkFBSyxRQUFRO0FBQUEsVUFDZjtBQUFBLFFBQ0YsQ0FBQyxFQUFFLEtBQUs7QUFBQSxNQUNWLENBQUM7QUFBQSxJQUNIO0FBQUEsRUFDRjtBQUFBLEVBRVEsb0JBQTBCO0FBQ2hDLFVBQU0sRUFBRSxZQUFZLElBQUk7QUFDeEIsVUFBTSxPQUFPLEtBQUssT0FBTztBQUN6QixTQUFLLFFBQVEsTUFBTTtBQUVuQixRQUFJLEtBQUssT0FBTyxRQUFRO0FBQ3RCLFVBQUkseUJBQVEsV0FBVyxFQUNwQixRQUFRLGlCQUFpQixFQUN6QjtBQUFBLFFBQ0M7QUFBQSxNQUNGLEVBQ0MsWUFBWSxDQUFDLGFBQWE7QUFDekIsbUJBQVcsVUFBVSx5QkFBeUI7QUFDNUMsbUJBQVMsVUFBVSxPQUFPLE9BQU8sS0FBSyxHQUFHLE9BQU8sS0FBSztBQUFBLFFBQ3ZEO0FBQ0EsaUJBQVMsU0FBUyxPQUFPLEtBQUssU0FBUyxpQkFBaUIsQ0FBQztBQUN6RCxpQkFBUyxTQUFTLE9BQU8sVUFBVTtBQUNqQyxnQkFBTSxLQUFLLE9BQU8sb0JBQW9CLE9BQU8sS0FBSyxDQUFDO0FBQUEsUUFDckQsQ0FBQztBQUFBLE1BQ0gsQ0FBQztBQUVILFVBQUkseUJBQVEsV0FBVyxFQUNwQixRQUFRLHdCQUF3QixFQUNoQztBQUFBLFFBQ0M7QUFBQSxNQUVGLEVBQ0M7QUFBQSxRQUFVLENBQUMsV0FDVixPQUFPLFNBQVMsS0FBSyxTQUFTLFlBQVksRUFBRSxTQUFTLE9BQU8sVUFBVTtBQUNwRSxnQkFBTSxLQUFLLE9BQU8sa0JBQWtCLEtBQUs7QUFBQSxRQUMzQyxDQUFDO0FBQUEsTUFDSDtBQUVGLFlBQU0sU0FBUyxLQUFLLE9BQU87QUFDM0IsVUFBSSx5QkFBUSxXQUFXLEVBQ3BCLFFBQVEsU0FBUyxtQkFBbUIsZUFBZSxFQUNuRDtBQUFBLFFBQ0MsU0FDSSw2SEFDQTtBQUFBLE1BQ04sRUFDQztBQUFBLFFBQVUsQ0FBQyxXQUNWLE9BQ0csY0FBYyxTQUFTLG1CQUFtQixlQUFlLEVBQ3pELFFBQVEsWUFBWTtBQUNuQixpQkFBTyxZQUFZLElBQUk7QUFDdkIsY0FBSTtBQUNGLGdCQUFJLE9BQVEsT0FBTSxLQUFLLE9BQU8sY0FBYztBQUFBLGdCQUN2QyxNQUFLLE9BQU8sYUFBYTtBQUFBLFVBQ2hDLFVBQUU7QUFDQSxpQkFBSyxRQUFRO0FBQUEsVUFDZjtBQUFBLFFBQ0YsQ0FBQztBQUFBLE1BQ0w7QUFBQSxJQUNKO0FBRUEsUUFBSSx5QkFBUSxXQUFXLEVBQ3BCLFFBQVEsaUJBQWlCLEVBQ3pCO0FBQUEsTUFDQztBQUFBLElBQ0YsRUFDQztBQUFBLE1BQVUsQ0FBQyxXQUNWLE9BQU8sU0FBUyxLQUFLLFNBQVMsYUFBYSxFQUFFLFNBQVMsT0FBTyxVQUFVO0FBQ3JFLGNBQU0sS0FBSyxPQUFPLG1CQUFtQixLQUFLO0FBQUEsTUFDNUMsQ0FBQztBQUFBLElBQ0g7QUFBQSxFQUNKO0FBQUEsRUFFUSx3QkFBOEI7QUFDcEMsVUFBTSxFQUFFLFlBQVksSUFBSTtBQUN4QixVQUFNLE9BQU8sS0FBSyxPQUFPO0FBQ3pCLFNBQUssUUFBUSxVQUFVO0FBRXZCLFFBQUkseUJBQVEsV0FBVyxFQUNwQixRQUFRLHNCQUFzQixFQUM5QjtBQUFBLE1BQ0M7QUFBQSxJQUNGLEVBQ0MsWUFBWSxDQUFDLGFBQWE7QUFDekIsZUFBUyxVQUFVLFlBQVksVUFBVTtBQUN6QyxlQUFTLFVBQVUsV0FBVyxTQUFTO0FBQ3ZDLGVBQVMsVUFBVSxVQUFVLFFBQVE7QUFDckMsZUFBUyxTQUFTLEtBQUssU0FBUyxhQUFhO0FBQzdDLGVBQVMsU0FBUyxPQUFPLFVBQVU7QUFDakMsY0FBTSxLQUFLLE9BQU87QUFBQSxVQUNoQixVQUFVLGFBQWEsVUFBVSxXQUFXLFFBQVE7QUFBQSxRQUN0RDtBQUFBLE1BQ0YsQ0FBQztBQUFBLElBQ0gsQ0FBQztBQUVILFFBQUkseUJBQVEsV0FBVyxFQUNwQixRQUFRLGlCQUFpQixFQUN6QjtBQUFBLE1BQ0M7QUFBQSxJQUNGLEVBQ0M7QUFBQSxNQUFZLENBQUMsU0FDWixLQUNHLGVBQWUsbUJBQW1CLEVBQ2xDLFNBQVMsS0FBSyxTQUFTLGNBQWMsRUFDckMsU0FBUyxPQUFPLFVBQVU7QUFDekIsY0FBTSxLQUFLLE9BQU8sb0JBQW9CLEtBQUs7QUFBQSxNQUM3QyxDQUFDO0FBQUEsSUFDTDtBQUVGLFFBQUkseUJBQVEsV0FBVyxFQUNwQixRQUFRLHVCQUF1QixFQUMvQjtBQUFBLE1BQ0M7QUFBQSxJQUNGLEVBQ0MsWUFBWSxDQUFDLGFBQWE7QUFDekIsZUFBUyxVQUFVLFFBQVEsTUFBTTtBQUNqQyxlQUFTLFVBQVUsU0FBUyxPQUFPO0FBQ25DLGVBQVMsVUFBVSxRQUFRLE1BQU07QUFDakMsZUFBUyxTQUFTLEtBQUssU0FBUyxRQUFRO0FBQ3hDLGVBQVMsU0FBUyxPQUFPLFVBQVU7QUFDakMsY0FBTSxRQUFrQixVQUFVLFdBQVcsVUFBVSxTQUFTLFFBQVE7QUFDeEUsY0FBTSxLQUFLLE9BQU8sY0FBYyxLQUFLO0FBQUEsTUFDdkMsQ0FBQztBQUFBLElBQ0gsQ0FBQztBQUVILFFBQUkseUJBQVEsV0FBVyxFQUNwQixRQUFRLGtCQUFrQixFQUMxQjtBQUFBLE1BQ0M7QUFBQSxJQUNGLEVBQ0M7QUFBQSxNQUFVLENBQUMsV0FDVixPQUFPLGNBQWMsa0JBQWtCLEVBQUUsUUFBUSxZQUFZO0FBQzNELGVBQU8sWUFBWSxJQUFJO0FBQ3ZCLFlBQUk7QUFDRixnQkFBTSxLQUFLLE9BQU8sZ0JBQWdCO0FBQUEsUUFDcEMsVUFBRTtBQUNBLGlCQUFPLFlBQVksS0FBSztBQUFBLFFBQzFCO0FBQUEsTUFDRixDQUFDO0FBQUEsSUFDSDtBQUFBLEVBQ0o7QUFBQSxFQUVRLHFCQUEyQjtBQUNqQyxVQUFNLEVBQUUsWUFBWSxJQUFJO0FBQ3hCLFNBQUssUUFBUSxPQUFPO0FBRXBCLFFBQUkseUJBQVEsV0FBVyxFQUNwQixRQUFRLFVBQVUsRUFDbEI7QUFBQSxNQUNDLFVBQVUsS0FBSyxPQUFPLFNBQVMsV0FBVyxTQUFTLG1CQUFnQixnQkFBZ0IsU0FBTSxLQUFLLE9BQU8sZ0JBQWdCLENBQUM7QUFBQSxJQUN4SDtBQUVGLFNBQUssaUJBQWlCLElBQUkseUJBQVEsV0FBVyxFQUMxQyxRQUFRLGVBQWUsRUFDdkIsUUFBUSxLQUFLLE9BQU8sU0FBUyw4QkFBeUIsdUNBQXVDO0FBQ2hHLFFBQUksS0FBSyxPQUFPLE9BQVEsTUFBSyxLQUFLLGVBQWU7QUFFakQsUUFBSSx5QkFBUSxXQUFXLEVBQ3BCLFFBQVEsY0FBYyxFQUN0QixRQUFRLDZCQUE2QixrQkFBa0IsRUFBRSxFQUN6RDtBQUFBLE1BQVUsQ0FBQyxXQUNWLE9BQU8sY0FBYyxhQUFhLEVBQUUsUUFBUSxNQUFNLGVBQWUsQ0FBQztBQUFBLElBQ3BFO0FBQUEsRUFDSjtBQUFBO0FBQUEsRUFHQSxNQUFjLGlCQUFnQztBQUM1QyxVQUFNLFVBQVUsTUFBTSxLQUFLLE9BQU8sb0JBQW9CO0FBQ3RELFVBQU0sT0FDSixZQUFZLE9BQ1Isd0VBQ0EsaUJBQWlCLFlBQVksUUFBUSxZQUFZLENBQUMsU0FBTSxRQUFRLFlBQVksS0FBSyxjQUMvRSxRQUFRLFlBQVksVUFBVSxJQUFJLEtBQUssR0FDekMsS0FBSyxZQUFZLFFBQVEsWUFBWSxLQUFLLENBQUMsT0FDMUMsUUFBUSxRQUFRLFNBQVMsSUFDdEIsU0FBTSxRQUFRLFFBQVEsTUFBTSxVQUFVLFFBQVEsUUFBUSxXQUFXLElBQUksS0FBSyxHQUFHLEtBQzdFO0FBRVYsUUFBSSxLQUFLLG1CQUFtQixLQUFNLE1BQUssZUFBZSxRQUFRLElBQUk7QUFBQSxFQUNwRTtBQUFBO0FBQUEsRUFJUSxhQUFxQjtBQTFjL0I7QUEyY0ksVUFBTSxPQUE0QixLQUFLLE9BQU87QUFDOUMsVUFBTSxVQUFTLFVBQUssT0FBTyxXQUFaLG1CQUFvQjtBQUNuQyxRQUFJLEtBQUssT0FBTyxlQUFlO0FBQzdCLGFBQU87QUFBQSxRQUNMO0FBQUEsUUFDQSxXQUFXLEtBQUssR0FBRztBQUFBLFFBQ25CO0FBQUEsTUFDRixFQUFFLEtBQUssSUFBSTtBQUFBLElBQ2I7QUFDQSxRQUFJLFdBQVcsUUFBVztBQUN4QixhQUFPLGFBQWEsS0FBSyxHQUFHLFlBQVksS0FBSyxjQUFjLEtBQUssUUFBUTtBQUFBLElBQzFFO0FBQ0EsVUFBTSxXQUNKLE9BQU8sZUFBZSxPQUNsQixVQUNBLEdBQUcsWUFBWSxLQUFLLElBQUksSUFBSSxPQUFPLFVBQVUsQ0FBQztBQUNwRCxVQUFNLFFBQVEsT0FBTyxVQUFVLFNBQVMsY0FBYyxPQUFPO0FBQzdELFVBQU0sUUFBUSxDQUFDLFVBQVUsS0FBSyxJQUFJLFdBQVcsS0FBSyxHQUFHLElBQUksY0FBYyxRQUFRLEVBQUU7QUFHakYsUUFBSSxPQUFPLGFBQWEsUUFBVztBQUNqQyxZQUFNLEtBQUssWUFBWSxPQUFPLFNBQVMsSUFBSSxJQUFJLE9BQU8sU0FBUyxLQUFLLEtBQUssT0FBTyxTQUFTLEtBQUssR0FBRztBQUFBLElBQ25HO0FBQ0EsVUFBTTtBQUFBLE1BQ0osb0JBQW9CLE9BQU8sT0FBTztBQUFBLE1BQ2xDLGNBQWMsT0FBTyxVQUFVLE1BQU0sR0FBRyxPQUFPLFVBQVUsU0FBUyxJQUFJLG1EQUFtRCxFQUFFO0FBQUEsSUFDN0g7QUFDQSxXQUFPLE1BQU0sS0FBSyxJQUFJO0FBQUEsRUFDeEI7QUFBQSxFQUVRLGdCQUFzQjtBQXplaEM7QUEwZUksZUFBSyxrQkFBTCxtQkFBb0IsUUFBUSxLQUFLLFdBQVc7QUFBQSxFQUM5QztBQUFBO0FBQUEsRUFHUSxZQUFZLFNBQTRCO0FBQzlDLFFBQUksUUFBUSxXQUFXLFVBQVU7QUFDL0IsVUFBSSx3QkFBTyxtQkFBbUIsT0FBTyxDQUFDO0FBQ3RDLFdBQUssUUFBUTtBQUNiO0FBQUEsSUFDRjtBQUNBLFVBQU0sVUFBVSxtQkFBbUIsT0FBTztBQUMxQyxRQUFJLHdCQUFPLFNBQVMsR0FBSztBQUN6QixRQUFJLEtBQUssZ0JBQWdCLEtBQU0sTUFBSyxZQUFZLFFBQVEsT0FBTztBQUFBLEVBQ2pFO0FBQUE7QUFBQTtBQUFBLEVBS1EsZUFBcUI7QUFDM0IsU0FBSyxZQUFZO0FBQ2pCLFVBQU0sU0FBUyxZQUFZLE1BQU0sS0FBSyxjQUFjLEdBQUcsR0FBSTtBQUMzRCxTQUFLLGdCQUFnQjtBQUdyQixTQUFLLE9BQU8saUJBQWlCLE1BQTJCO0FBQUEsRUFDMUQ7QUFBQSxFQUVRLGNBQW9CO0FBQzFCLFFBQUksS0FBSyxrQkFBa0IsTUFBTTtBQUMvQixvQkFBYyxLQUFLLGFBQWE7QUFDaEMsV0FBSyxnQkFBZ0I7QUFBQSxJQUN2QjtBQUFBLEVBQ0Y7QUFDRjs7O0FFL2RPLFNBQVMsZUFBZSxTQUFpQixPQUFlLE9BQU8sT0FBZTtBQUNuRixRQUFNLE1BQU0sSUFBSSxJQUFJLE9BQU87QUFDM0IsTUFBSSxJQUFJLGFBQWEsUUFBUyxLQUFJLFdBQVc7QUFBQSxXQUNwQyxJQUFJLGFBQWEsU0FBVSxLQUFJLFdBQVc7QUFBQSxXQUMxQyxJQUFJLGFBQWEsU0FBUyxJQUFJLGFBQWEsUUFBUTtBQUMxRCxVQUFNLElBQUksYUFBYSxrREFBa0QsSUFBSSxRQUFRLEVBQUU7QUFBQSxFQUN6RjtBQUNBLE1BQUksV0FBVztBQUNmLE1BQUksU0FBUztBQUNiLE1BQUksYUFBYSxJQUFJLFNBQVMsS0FBSztBQUNuQyxTQUFPLElBQUksU0FBUztBQUN0QjtBQUVBLFNBQVMsd0JBQXdCLEtBQTRCO0FBQzNELFFBQU0sWUFBYSxXQUF1QztBQUMxRCxNQUFJLE9BQU8sY0FBYyxZQUFZO0FBQ25DLFVBQU0sSUFBSTtBQUFBLE1BQ1I7QUFBQSxJQUdGO0FBQUEsRUFDRjtBQUNBLFNBQU8sSUFBSyxVQUFpRCxHQUFHO0FBQ2xFO0FBRU8sSUFBTSxxQkFBTixNQUE4QztBQUFBLEVBVW5ELFlBQVksU0FBb0M7QUFUaEQsd0JBQWlCO0FBQ2pCLHdCQUFRLG1CQUF1RDtBQUMvRCx3QkFBUSxpQkFBd0Q7QUFDaEUsd0JBQVEsUUFBTztBQUNmLHdCQUFRLFVBQVM7QUFDakIsd0JBQVEsaUJBQWdCO0FBQ3hCLHdCQUFpQixhQUFzQixDQUFDO0FBQ3hDLHdCQUFRO0FBN0VWO0FBZ0ZJLFVBQU0sV0FBVSxhQUFRLGNBQVIsWUFBcUI7QUFDckMsVUFBTSxNQUFNLGVBQWUsUUFBUSxLQUFLLFFBQVEsUUFBTyxhQUFRLFNBQVIsWUFBZ0IsS0FBSztBQUM1RSxTQUFLLFNBQVMsUUFBUSxHQUFHO0FBRXpCLFNBQUssT0FBTyxpQkFBaUIsUUFBUSxNQUFNO0FBQ3pDLFdBQUssT0FBTztBQUNaLFlBQU0sU0FBUyxDQUFDLEdBQUcsS0FBSyxTQUFTO0FBQ2pDLFdBQUssVUFBVSxTQUFTO0FBQ3hCLGlCQUFXLFNBQVMsT0FBUSxNQUFLLE9BQU8sS0FBSyxLQUFLO0FBQUEsSUFDcEQsQ0FBQztBQUVELFNBQUssT0FBTyxpQkFBaUIsV0FBVyxDQUFDLFVBQVU7QUEzRnZELFVBQUFDO0FBNEZNLFVBQUksT0FBTyxNQUFNLFNBQVMsVUFBVTtBQUNsQyxhQUFLLEtBQUssRUFBRSxNQUFNLE1BQU0sUUFBUSw2Q0FBNkMsQ0FBQztBQUM5RTtBQUFBLE1BQ0Y7QUFDQSxVQUFJO0FBQ0osVUFBSTtBQUNGLGtCQUFVLGFBQWEsTUFBTSxJQUFJO0FBQUEsTUFDbkMsU0FBUyxPQUFPO0FBQ2QsYUFBSyxLQUFLLEVBQUUsTUFBTSxNQUFNLFFBQVEsaUJBQWlCLFFBQVEsTUFBTSxVQUFVLE9BQU8sS0FBSyxFQUFFLENBQUM7QUFDeEY7QUFBQSxNQUNGO0FBQ0EsT0FBQUEsTUFBQSxLQUFLLG9CQUFMLGdCQUFBQSxJQUFBLFdBQXVCO0FBQUEsSUFDekIsQ0FBQztBQUVELFNBQUssT0FBTyxpQkFBaUIsU0FBUyxDQUFDLFVBQVU7QUFDL0MsV0FBSyxZQUNILGlCQUFpQixRQUFRLE1BQU0sVUFBVSxVQUFVLFNBQVksT0FBTyxLQUFLLElBQUk7QUFBQSxJQUNuRixDQUFDO0FBRUQsU0FBSyxPQUFPLGlCQUFpQixTQUFTLENBQUMsVUFBVTtBQUMvQyxXQUFLLFlBQVk7QUFBQSxRQUNmLE1BQU0sTUFBTTtBQUFBLFFBQ1osUUFBUSxNQUFNLFdBQVcsVUFBYSxNQUFNLFdBQVcsS0FBSyxNQUFNLFNBQVMsS0FBSztBQUFBLE1BQ2xGLENBQUM7QUFBQSxJQUNILENBQUM7QUFBQSxFQUNIO0FBQUEsRUFFQSxLQUFLLFNBQXdCO0FBQzNCLFFBQUksS0FBSyxPQUFRLE9BQU0sSUFBSSxhQUFhLDRCQUE0QjtBQUNwRSxVQUFNLFFBQVEsS0FBSyxVQUFVLE9BQU87QUFDcEMsUUFBSSxLQUFLLE1BQU07QUFDYixXQUFLLE9BQU8sS0FBSyxLQUFLO0FBQ3RCO0FBQUEsSUFDRjtBQUNBLFNBQUssVUFBVSxLQUFLLEtBQUs7QUFBQSxFQUMzQjtBQUFBLEVBRUEsVUFBVSxVQUE0QztBQUNwRCxTQUFLLGtCQUFrQjtBQUFBLEVBQ3pCO0FBQUEsRUFFQSxRQUFRLFVBQStDO0FBQ3JELFNBQUssZ0JBQWdCO0FBQUEsRUFDdkI7QUFBQSxFQUVBLFFBQWM7QUFDWixRQUFJLEtBQUssT0FBUTtBQUNqQixTQUFLLFNBQVM7QUFDZCxTQUFLLFVBQVUsU0FBUztBQUN4QixRQUFJO0FBQ0YsV0FBSyxPQUFPLE1BQU0sS0FBTSxrQkFBa0I7QUFBQSxJQUM1QyxTQUFRO0FBQUEsSUFFUjtBQUVBLFNBQUssWUFBWSxFQUFFLE1BQU0sS0FBTSxRQUFRLG1CQUFtQixDQUFDO0FBQUEsRUFDN0Q7QUFBQSxFQUVRLEtBQUssUUFBMkI7QUF0SjFDO0FBdUpJLFNBQUssU0FBUztBQUNkLFFBQUk7QUFDRixXQUFLLE9BQU8sT0FBTSxZQUFPLFNBQVAsWUFBZSxPQUFNLFlBQU8sV0FBUCxZQUFpQixFQUFFO0FBQUEsSUFDNUQsU0FBUTtBQUFBLElBRVI7QUFDQSxTQUFLLFlBQVksTUFBTTtBQUFBLEVBQ3pCO0FBQUEsRUFFUSxZQUFZLFFBQTJCO0FBaEtqRDtBQWlLSSxTQUFLLE9BQU87QUFDWixTQUFLLFNBQVM7QUFDZCxRQUFJLEtBQUssY0FBZTtBQUN4QixTQUFLLGdCQUFnQjtBQUNyQixlQUFLLGtCQUFMLDhCQUFxQjtBQUFBLEVBQ3ZCO0FBQ0Y7OztBeEJuSEEsSUFBTSwyQkFBMkI7QUFDakMsSUFBTSx5QkFBeUI7QUFDL0IsSUFBTSxzQkFBc0I7QUFjckIsSUFBTSxrQkFBTixjQUE4Qix3QkFBTztBQUFBLEVBcUIxQyxZQUFZLEtBQVUsVUFBMEIsWUFBNkIsQ0FBQyxHQUFHO0FBQy9FLFVBQU0sS0FBSyxRQUFRO0FBckJyQixnQ0FBNEIsa0JBQWtCO0FBRTlDO0FBQUEsa0NBQTRCO0FBRTVCLHdCQUFpQjtBQUNqQix3QkFBUSxXQUF1QztBQUMvQyx3QkFBUSxVQUFpQztBQUN6Qyx3QkFBUSxhQUF1QztBQUMvQyx3QkFBUSxpQkFBb0M7QUFDNUMsd0JBQVEsY0FBaUM7QUFDekMsd0JBQVEsa0JBQXFDO0FBQzdDLHdCQUFRLGNBQWEsSUFBSSxvQkFBb0I7QUFFN0M7QUFBQSx3QkFBUSxjQUFhO0FBQ3JCLHdCQUFRLGNBQWE7QUFFckI7QUFBQSx3QkFBUSxVQUFTO0FBRWpCO0FBQUEsd0JBQWlCLFdBQXFCLGdCQUFnQjtBQUlwRCxTQUFLLFlBQVk7QUFBQSxFQUNuQjtBQUFBLEVBRUEsSUFBWSxNQUFvQjtBQTlGbEM7QUErRkksWUFBTyxVQUFLLFVBQVUsUUFBZixhQUF1QixNQUFNLEtBQUssSUFBSTtBQUFBLEVBQy9DO0FBQUEsRUFFQSxJQUFZLFlBQTBCO0FBbEd4QztBQXdHSSxZQUFPLFVBQUssVUFBVSxjQUFmLFlBQTRCLFdBQVcsTUFBTSxLQUFLLFVBQVU7QUFBQSxFQUNyRTtBQUFBLEVBRUEsSUFBSSxTQUFrQjtBQUNwQixXQUFPLFNBQVMsS0FBSyxJQUFJO0FBQUEsRUFDM0I7QUFBQSxFQUVBLE1BQWUsU0FBd0I7QUFDckMsU0FBSyxPQUFPLG9CQUFvQixNQUFNLEtBQUssU0FBUyxDQUFDO0FBQ3JELFNBQUssUUFBUSxTQUFTLEtBQUssS0FBSyxTQUFTLFFBQVE7QUFDakQsU0FBSyxjQUFjLElBQUksb0JBQW9CLEtBQUssS0FBSyxJQUFJLENBQUM7QUFDMUQ7QUFBQSxNQUNFLENBQUMsUUFBUSxZQUFZLEtBQUssZ0NBQWdDLFFBQVEsT0FBTztBQUFBLE1BQ3pFLENBQUMsU0FBUyxLQUFLLG1CQUFtQixLQUFLLEtBQUssS0FBSyxJQUFJO0FBQUEsSUFDdkQ7QUFHQSxTQUFLLGNBQWMsS0FBSyxJQUFJLFVBQVUsR0FBRyxzQkFBc0IsTUFBRztBQXpIdEU7QUF5SHlFLHdCQUFLLFdBQUwsbUJBQWE7QUFBQSxLQUFNLENBQUM7QUFHekYsUUFBSSxLQUFLLFVBQVUsS0FBSyxLQUFLLFNBQVMsY0FBZSxPQUFNLEtBQUssVUFBVTtBQUFBLEVBQzVFO0FBQUEsRUFFUyxXQUFpQjtBQUN4QixTQUFLLFNBQVM7QUFBQSxFQUNoQjtBQUFBO0FBQUEsRUFJQSxNQUFNLGlCQUFnQztBQUNwQyxVQUFNLEtBQUssU0FBUyxLQUFLLElBQUk7QUFBQSxFQUMvQjtBQUFBO0FBQUE7QUFBQSxFQUtBLE1BQU0saUJBQWlCLE1BQW9DO0FBQ3pELFVBQU0sYUFBYSxLQUFLLGtCQUFrQjtBQUMxQyxVQUFNLFVBQVUsTUFBTSxlQUFlO0FBQUEsTUFDbkMsS0FBSyxLQUFLLEtBQUs7QUFBQSxNQUNmO0FBQUEsTUFDQTtBQUFBLE1BQ0EsWUFBWSxpQkFBaUI7QUFBQSxNQUM3QixXQUFXLEtBQUs7QUFBQSxJQUNsQixDQUFDO0FBQ0QsVUFBTSxLQUFLLGlCQUFpQixTQUFTLFVBQVU7QUFDL0MsV0FBTztBQUFBLEVBQ1Q7QUFBQTtBQUFBLEVBR0EsTUFBYyxtQkFBbUIsS0FBYSxNQUE2QjtBQUN6RSxRQUFJLEtBQUssUUFBUTtBQUNmLFVBQUksdUJBQXVCLEdBQUcsTUFBTSx1QkFBdUIsS0FBSyxLQUFLLEdBQUcsR0FBRztBQUN6RSxZQUFJLHdCQUFPLDJEQUEyRDtBQUFBLE1BQ3hFLE9BQU87QUFDTCxZQUFJO0FBQUEsVUFDRjtBQUFBLFVBQ0E7QUFBQSxRQUNGO0FBQUEsTUFDRjtBQUNBO0FBQUEsSUFDRjtBQUNBLFVBQU0sYUFBYSxLQUFLLGtCQUFrQjtBQUMxQyxVQUFNLFVBQVUsTUFBTSxlQUFlO0FBQUEsTUFDbkM7QUFBQSxNQUNBO0FBQUEsTUFDQTtBQUFBLE1BQ0EsWUFBWSxpQkFBaUI7QUFBQSxNQUM3QixXQUFXLEtBQUs7QUFBQSxJQUNsQixDQUFDO0FBQ0QsVUFBTSxLQUFLLGlCQUFpQixTQUFTLFVBQVU7QUFBQSxFQUNqRDtBQUFBLEVBRUEsTUFBYyxpQkFBaUIsU0FBc0IsWUFBbUM7QUFDdEYsUUFBSSxRQUFRLFdBQVcsVUFBVTtBQUMvQixVQUFJLHdCQUFPLG1CQUFtQixPQUFPLEdBQUcsR0FBSztBQUM3QztBQUFBLElBQ0Y7QUFDQSxTQUFLLEtBQUssTUFBTSxRQUFRO0FBQ3hCLFNBQUssS0FBSyxRQUFRLFFBQVE7QUFDMUIsU0FBSyxLQUFLLFdBQVcsUUFBUTtBQUM3QixTQUFLLEtBQUssYUFBYTtBQUN2QixVQUFNLEtBQUssZUFBZTtBQUMxQixVQUFNLEtBQUssa0JBQWtCO0FBQzdCLFFBQUksd0JBQU8sbUJBQW1CLE9BQU8sQ0FBQztBQUN0QyxVQUFNLEtBQUssVUFBVTtBQUFBLEVBQ3ZCO0FBQUEsRUFFUSxvQkFBNEI7QUFDbEMsVUFBTSxRQUFRLEtBQUssS0FBSyxXQUFXLEtBQUs7QUFDeEMsV0FBTyxVQUFVLEtBQUssUUFBUSxrQkFBa0I7QUFBQSxFQUNsRDtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFTUSx1QkFBK0M7QUFDckQsV0FBTyxJQUFJLHVCQUF1QjtBQUFBLE1BQ2hDLFNBQVMsS0FBSyxJQUFJLE1BQU07QUFBQSxNQUN4QixnQkFBZ0IsT0FBTyxnQkFBZ0I7QUFDckMsY0FBTSxTQUFTLEtBQUssSUFBSSxNQUFNLHNCQUFzQixXQUFXO0FBQy9ELFlBQUksV0FBVyxLQUFNO0FBQ3JCLGNBQU0sS0FBSyxJQUFJLFlBQVksVUFBVSxNQUFNO0FBQUEsTUFDN0M7QUFBQSxJQUNGLENBQUM7QUFBQSxFQUNIO0FBQUE7QUFBQSxFQUdBLE1BQWMsb0JBQW1DO0FBQy9DLFFBQUksQ0FBQyxLQUFLLE9BQVE7QUFDbEIsVUFBTSxVQUFVLEtBQUsscUJBQXFCO0FBQzFDLFVBQU0sU0FBUztBQUFBLE1BQ2IsVUFBVSxLQUFLLEtBQUs7QUFBQSxNQUNwQixZQUFZLEtBQUssa0JBQWtCO0FBQUEsTUFDbkMsS0FBSyxLQUFLLEtBQUs7QUFBQSxNQUNmLFVBQVUsS0FBSyxJQUFJO0FBQUEsSUFDckI7QUFDQSxRQUFJO0FBQ0YsWUFBTSxRQUFRO0FBQUEsUUFDWjtBQUFBLFFBQ0EsSUFBSSxZQUFZLEVBQUUsT0FBTyxHQUFHLEtBQUssVUFBVSxRQUFRLE1BQU0sQ0FBQyxDQUFDO0FBQUEsQ0FBSTtBQUFBLE1BQ2pFO0FBQUEsSUFDRixTQUFTLE9BQU87QUFDZCxXQUFLLFFBQVEsS0FBSyxpQ0FBaUMsS0FBSztBQUFBLElBQzFEO0FBQUEsRUFDRjtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLEVBUUEsTUFBTSxhQUFhLE1BQWdDO0FBQ2pELFFBQUksQ0FBQyxLQUFLLFFBQVE7QUFDaEIsVUFBSSx3QkFBTywyRUFBc0U7QUFDakYsYUFBTztBQUFBLElBQ1Q7QUFDQSxVQUFNLFVBQVUsS0FBSyxLQUFLO0FBQzFCLFFBQUksWUFBWSxNQUFNLFFBQVEsU0FBUyxNQUFNLHdCQUF3QixLQUFLLE9BQU8sR0FBRztBQUNsRixVQUFJLHdCQUFPLCtFQUErRSxHQUFJO0FBQzlGLGFBQU87QUFBQSxJQUNUO0FBQ0EsVUFBTSxVQUFVLE1BQU0sYUFBYTtBQUFBLE1BQ2pDLFFBQVEsS0FBSyxLQUFLO0FBQUEsTUFDbEIsT0FBTyxLQUFLLEtBQUs7QUFBQSxNQUNqQixNQUFNO0FBQUEsTUFDTixXQUFXLEtBQUs7QUFBQSxJQUNsQixDQUFDO0FBQ0QsUUFBSSxDQUFDLFFBQVEsSUFBSTtBQUNmLFVBQUksd0JBQU8scUNBQWdDLFFBQVEsS0FBSyxJQUFJLEdBQUs7QUFDakUsYUFBTztBQUFBLElBQ1Q7QUFDQSxTQUFLLEtBQUssYUFBYSxRQUFRLE9BQU87QUFDdEMsVUFBTSxLQUFLLGVBQWU7QUFDMUIsVUFBTSxLQUFLLGtCQUFrQjtBQUM3QixRQUFJLHdCQUFPLHNDQUFpQyxRQUFRLE9BQU8sSUFBSSxTQUFJO0FBQ25FLFdBQU87QUFBQSxFQUNUO0FBQUE7QUFBQTtBQUFBLEVBS0EsTUFBYyxZQUEyQjtBQS9RM0M7QUFnUkksUUFBSSxDQUFDLEtBQUssT0FBUTtBQUNsQixTQUFLLFNBQVM7QUFFZCxVQUFNLEVBQUUsS0FBSyxPQUFPLFNBQVMsSUFBSSxLQUFLO0FBQ3RDLFVBQU0sYUFBYSxLQUFLLGtCQUFrQjtBQUMxQyxVQUFNLFVBQVUsS0FBSyxxQkFBcUI7QUFDMUMsVUFBTSxLQUFLLHNCQUFzQixPQUFPO0FBRXhDLFVBQU0sU0FBUyxJQUFJLFdBQVc7QUFBQSxNQUM1QjtBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQSxXQUFXLE1BQ1Q7QUFBQSxRQUNFLElBQUksbUJBQW1CLEVBQUUsS0FBSyxPQUFPLFdBQVcsS0FBSyxVQUFVLFVBQVUsQ0FBQztBQUFBLFFBQzFFLEVBQUUsS0FBSyxLQUFLLFNBQVMsV0FBVyxNQUFNLEtBQUssUUFBUSxhQUFhO0FBQUEsTUFDbEU7QUFBQSxNQUNGLFdBQVcsSUFBSSxjQUFjLEVBQUUsU0FBUyxLQUFLLE9BQU8sV0FBVyxLQUFLLFVBQVUsQ0FBQztBQUFBLE1BQy9FO0FBQUEsTUFDQSxVQUFVO0FBQUEsUUFDUixjQUFjLEtBQUssS0FBSyxTQUFTO0FBQUEsUUFDakMsY0FBYyxvQkFBb0IsS0FBSyxLQUFLLFNBQVMsY0FBYztBQUFBLE1BQ3JFO0FBQUEsTUFDQSxLQUFLLEtBQUs7QUFBQSxNQUNWLEtBQUssS0FBSztBQUFBLElBQ1osQ0FBQztBQUNELFNBQUssU0FBUztBQUNkLFNBQUssYUFBYTtBQUNsQixTQUFLLGFBQWE7QUFDbEIsU0FBSyxhQUFhLElBQUkscUJBQW9CLFVBQUssVUFBVSxjQUFmLFlBQTRCLENBQUMsQ0FBQztBQUV4RSxRQUFJO0FBQ0YsWUFBTSxPQUFPLFFBQVE7QUFBQSxJQUN2QixTQUFTLE9BQU87QUFDZCxXQUFLLGdCQUFnQixPQUFPLHFCQUFxQjtBQUFBLElBQ25EO0FBR0EsU0FBSyxVQUFVLElBQUkscUJBQXFCLEVBQUUsT0FBTyxLQUFLLElBQUksTUFBTSxDQUFDO0FBQ2pFLFdBQU8sY0FBYyxLQUFLLE9BQU87QUFDakMsU0FBSyxTQUFTLElBQUksZ0JBQWdCO0FBQUEsTUFDaEMsWUFBWSxLQUFLLEtBQUssU0FBUyxvQkFBb0I7QUFBQSxJQUNyRCxDQUFDO0FBQ0QsU0FBSyxPQUFPLE1BQU0sTUFBTTtBQUN0QixXQUFLLE9BQU8sWUFBWSxFQUFFLE1BQU0sQ0FBQyxVQUFtQjtBQUNsRCxhQUFLLGdCQUFnQixPQUFPLGVBQWU7QUFBQSxNQUM3QyxDQUFDO0FBQUEsSUFDSCxDQUFDO0FBSUQsU0FBSyxlQUFlO0FBQ3BCLFVBQU0sT0FBTyxZQUFZLE1BQU0sS0FBSyxPQUFPLEdBQUcsbUJBQW1CO0FBQ2pFLFNBQUssYUFBYTtBQUNsQixTQUFLLGlCQUFpQixJQUF5QjtBQUMvQyxTQUFLLE9BQU87QUFBQSxFQUNkO0FBQUE7QUFBQSxFQUdRLGlCQUF1QjtBQTNVakM7QUE0VUksZUFBSyxrQkFBTCxtQkFBb0I7QUFDcEIsU0FBSyxnQkFBZ0I7QUFDckIsU0FBSyxZQUFZO0FBQ2pCLFFBQUksS0FBSyxXQUFXLEtBQU07QUFDMUIsUUFBSSxLQUFLLEtBQUssU0FBUyxrQkFBa0IsU0FBVTtBQUNuRCxVQUFNLE9BQU8sS0FBSyxpQkFBaUI7QUFDbkMsU0FBSyxnQkFBZ0I7QUFDckIsU0FBSyxZQUFZLElBQUksbUJBQW1CLElBQUk7QUFBQSxFQUM5QztBQUFBO0FBQUEsRUFHUSxXQUFpQjtBQXZWM0I7QUF3VkksUUFBSSxLQUFLLG1CQUFtQixNQUFNO0FBQ2hDLG1CQUFhLEtBQUssY0FBYztBQUNoQyxXQUFLLGlCQUFpQjtBQUFBLElBQ3hCO0FBQ0EsUUFBSSxLQUFLLGVBQWUsTUFBTTtBQUM1QixvQkFBYyxLQUFLLFVBQVU7QUFDN0IsV0FBSyxhQUFhO0FBQUEsSUFDcEI7QUFDQSxlQUFLLFdBQUwsbUJBQWE7QUFDYixTQUFLLFNBQVM7QUFDZCxlQUFLLFdBQUwsbUJBQWE7QUFDYixTQUFLLFNBQVM7QUFDZCxTQUFLLFVBQVU7QUFDZixlQUFLLGtCQUFMLG1CQUFvQjtBQUNwQixTQUFLLGdCQUFnQjtBQUNyQixTQUFLLFlBQVk7QUFBQSxFQUNuQjtBQUFBO0FBQUEsRUFJQSxNQUFNLFVBQXlCO0FBNVdqQztBQTZXSSxRQUFJLEtBQUssUUFBUTtBQUNmLFVBQUksd0JBQU8sa0VBQTZEO0FBQ3hFO0FBQUEsSUFDRjtBQUNBLFVBQU0sU0FBUyxLQUFLO0FBQ3BCLFFBQUksV0FBVyxNQUFNO0FBQ25CLFVBQUksQ0FBQyxLQUFLLFFBQVE7QUFDaEIsWUFBSSx3QkFBTyxzRkFBaUY7QUFDNUY7QUFBQSxNQUNGO0FBRUEsWUFBTSxLQUFLLFVBQVU7QUFDckIsWUFBTSxVQUFTLFVBQUssV0FBTCxtQkFBYTtBQUM1QixVQUFJLFdBQVcsUUFBVztBQUN4QixZQUFJO0FBQUEsVUFDRixPQUFPLFVBQVUsaUJBQ2IsOEVBQ0E7QUFBQSxRQUNOO0FBQUEsTUFDRjtBQUNBO0FBQUEsSUFDRjtBQUNBLFFBQUk7QUFDRixZQUFNLE9BQU8sWUFBWTtBQUN6QixZQUFNLFNBQVMsT0FBTyxPQUFPO0FBQzdCLFVBQUk7QUFBQSxRQUNGLE9BQU8sVUFBVSxpQkFDYiw4RUFDQTtBQUFBLE1BQ047QUFBQSxJQUNGLFNBQVMsT0FBTztBQUNkLFdBQUssZ0JBQWdCLE9BQU8saUJBQWlCO0FBQzdDLFVBQUksd0JBQU8sc0VBQWlFO0FBQUEsSUFDOUU7QUFBQSxFQUNGO0FBQUE7QUFBQSxFQUdBLGVBQXFCO0FBbFp2QjtBQW1aSSxRQUFJLENBQUMsS0FBSyxVQUFVLEtBQUssT0FBUTtBQUNqQyxTQUFLLFNBQVM7QUFDZCxRQUFJLEtBQUssbUJBQW1CLE1BQU07QUFDaEMsbUJBQWEsS0FBSyxjQUFjO0FBQ2hDLFdBQUssaUJBQWlCO0FBQUEsSUFDeEI7QUFDQSxTQUFLLFdBQVcsUUFBUTtBQUN4QixlQUFLLFdBQUwsbUJBQWE7QUFDYixTQUFLLFNBQVM7QUFDZCxlQUFLLFdBQUwsbUJBQWE7QUFDYixTQUFLLE9BQU87QUFDWixRQUFJLHdCQUFPLHVFQUF1RTtBQUFBLEVBQ3BGO0FBQUE7QUFBQSxFQUdBLE1BQU0sZ0JBQStCO0FBQ25DLFFBQUksQ0FBQyxLQUFLLFVBQVUsQ0FBQyxLQUFLLE9BQVE7QUFDbEMsU0FBSyxTQUFTO0FBQ2QsUUFBSSx3QkFBTywrREFBcUQ7QUFDaEUsVUFBTSxLQUFLLFVBQVU7QUFBQSxFQUN2QjtBQUFBO0FBQUEsRUFHQSxJQUFJLGdCQUF5QjtBQUMzQixXQUFPLEtBQUs7QUFBQSxFQUNkO0FBQUEsRUFFQSxNQUFNLG9CQUFvQixTQUFnQztBQTlhNUQ7QUErYUksU0FBSyxLQUFLLFNBQVMsb0JBQW9CLEtBQUssSUFBSSxHQUFHLEtBQUssTUFBTSxPQUFPLENBQUM7QUFDdEUsVUFBTSxLQUFLLGVBQWU7QUFDMUIsZUFBSyxXQUFMLG1CQUFhLGNBQWMsS0FBSyxLQUFLLFNBQVMsb0JBQW9CO0FBQUEsRUFDcEU7QUFBQSxFQUVBLE1BQU0sa0JBQWtCLFNBQWlDO0FBQ3ZELFNBQUssS0FBSyxTQUFTLGVBQWU7QUFDbEMsVUFBTSxLQUFLLGVBQWU7QUFDMUIsUUFBSTtBQUFBLE1BQ0YsVUFDSSxxSEFDQTtBQUFBLElBQ047QUFBQSxFQUNGO0FBQUEsRUFFQSxNQUFNLG1CQUFtQixNQUFvQztBQUMzRCxTQUFLLEtBQUssU0FBUyxnQkFBZ0I7QUFDbkMsVUFBTSxLQUFLLGVBQWU7QUFDMUIsU0FBSyxlQUFlO0FBQ3BCLFNBQUssT0FBTztBQUFBLEVBQ2Q7QUFBQSxFQUVBLE1BQU0sbUJBQW1CLFNBQWlDO0FBQ3hELFNBQUssS0FBSyxTQUFTLGdCQUFnQjtBQUNuQyxVQUFNLEtBQUssZUFBZTtBQUMxQixRQUFJO0FBQUEsTUFDRixVQUNJLDhFQUNBO0FBQUEsSUFDTjtBQUFBLEVBQ0Y7QUFBQSxFQUVBLE1BQU0sY0FBYyxPQUFnQztBQUNsRCxTQUFLLEtBQUssU0FBUyxXQUFXO0FBQzlCLFVBQU0sS0FBSyxlQUFlO0FBQzFCLFNBQUssUUFBUSxTQUFTLEtBQUs7QUFBQSxFQUM3QjtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxFQU9BLE1BQU0sb0JBQW9CLE1BQTZCO0FBQ3JELFNBQUssS0FBSyxTQUFTLGlCQUFpQjtBQUNwQyxVQUFNLEtBQUssZUFBZTtBQUMxQixRQUFJLEtBQUssV0FBVyxRQUFRLENBQUMsS0FBSyxPQUFRLE9BQU0sS0FBSyxVQUFVO0FBQUEsRUFDakU7QUFBQTtBQUFBLEVBR0EsTUFBTSxzQkFBMkQ7QUFDL0QsUUFBSSxDQUFDLEtBQUssT0FBUSxRQUFPO0FBQ3pCLFdBQU8sa0JBQWtCO0FBQUEsTUFDdkIsUUFBUSxLQUFLLEtBQUs7QUFBQSxNQUNsQixPQUFPLEtBQUssS0FBSztBQUFBLE1BQ2pCLFdBQVcsS0FBSztBQUFBLElBQ2xCLENBQUM7QUFBQSxFQUNIO0FBQUE7QUFBQSxFQUdBLE1BQU0sa0JBQWlDO0FBM2V6QztBQTRlSSxVQUFNLFNBQVMsdUJBQXVCO0FBQUEsTUFDcEMsZUFBZSxLQUFLLFNBQVMsV0FBVztBQUFBLE1BQ3hDLFVBQVUsS0FBSyxLQUFLO0FBQUEsTUFDcEIsWUFBWSxLQUFLLGtCQUFrQjtBQUFBLE1BQ25DLFdBQVcsS0FBSyxLQUFLO0FBQUEsTUFDckIsUUFBUSxLQUFLO0FBQUEsTUFDYixRQUFRLEtBQUs7QUFBQSxNQUNiLGVBQWMsZ0JBQUssV0FBTCxtQkFBYSxhQUFiLFlBQXlCO0FBQUEsTUFDdkMsZ0JBQWdCLEtBQUssUUFBUSxZQUFZO0FBQUEsSUFDM0MsQ0FBQztBQUNELFVBQU0sU0FBUyxNQUFNLGdCQUFnQixNQUFNO0FBQzNDLFFBQUksUUFBUTtBQUNWLFVBQUksd0JBQU8saURBQWlEO0FBQzVEO0FBQUEsSUFDRjtBQUNBLFlBQVEsS0FBSyxpREFBaUQsTUFBTTtBQUNwRSxRQUFJLHdCQUFPLHlGQUFvRixHQUFLO0FBQUEsRUFDdEc7QUFBQTtBQUFBLEVBR0Esa0JBQTBCO0FBQ3hCLFdBQU8sZ0JBQWdCO0FBQUEsRUFDekI7QUFBQSxFQUVBLE1BQU0sU0FBd0I7QUFDNUIsU0FBSyxTQUFTO0FBQ2QsU0FBSyxTQUFTO0FBSWQsVUFBTSxVQUFVLEtBQUsscUJBQXFCO0FBQzFDLFVBQU0sUUFBUSxXQUFXLHdCQUF3QjtBQUNqRCxVQUFNLFFBQVEsV0FBVyxzQkFBc0I7QUFDL0MsU0FBSyxPQUFPO0FBQUEsTUFDVixHQUFHLGtCQUFrQjtBQUFBLE1BQ3JCLFlBQVksS0FBSyxLQUFLO0FBQUEsTUFDdEIsVUFBVSxLQUFLLEtBQUs7QUFBQSxJQUN0QjtBQUNBLFVBQU0sS0FBSyxlQUFlO0FBQzFCLFFBQUk7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFBQTtBQUFBLEVBSVEsU0FBZTtBQTFoQnpCO0FBMmhCSSxVQUFNLFNBQVMsS0FBSztBQUNwQixRQUFJLFdBQVcsS0FBTTtBQUNyQixVQUFNLFNBQVMsT0FBTyxPQUFPO0FBQzdCLGVBQUssY0FBTCxtQkFBZ0I7QUFBQSxNQUNkO0FBQUEsTUFDQTtBQUFBLFFBQ0UsS0FBSyxLQUFLLEtBQUs7QUFBQSxRQUNmLFlBQVksS0FBSyxrQkFBa0I7QUFBQSxRQUNuQyxNQUFNLEtBQUs7QUFBQSxRQUNYLFFBQVEsS0FBSztBQUFBLFFBQ2IsTUFBTSxLQUFLLEtBQUssU0FBUztBQUFBLE1BQzNCO0FBQUEsTUFDQSxLQUFLLElBQUk7QUFBQTtBQUVYLFFBQUksS0FBSyxVQUFVLEtBQUssV0FBWTtBQUNwQyxVQUFNLFdBQVcsS0FBSyxXQUFXLFNBQVMsT0FBTyxLQUFLO0FBQ3RELFFBQUksU0FBUyxXQUFXLE9BQVE7QUFDaEMsU0FBSyxXQUFXLGFBQWE7QUFDN0IsU0FBSyxrQkFBa0IsU0FBUyxPQUFPO0FBQUEsRUFDekM7QUFBQSxFQUVRLGtCQUFrQixTQUF1QjtBQUMvQyxRQUFJLEtBQUssbUJBQW1CLEtBQU07QUFDbEMsU0FBSyxpQkFBaUIsV0FBVyxNQUFNO0FBQ3JDLFdBQUssaUJBQWlCO0FBQ3RCLFlBQU0sU0FBUyxLQUFLO0FBQ3BCLFVBQUksV0FBVyxNQUFNO0FBQ25CLGFBQUssV0FBVyxRQUFRO0FBQ3hCO0FBQUEsTUFDRjtBQUNBLGFBQ0csVUFBVSxFQUNWO0FBQUEsUUFDQyxNQUFNO0FBQ0osZUFBSyxXQUFXLFFBQVE7QUFBQSxRQUMxQjtBQUFBLFFBQ0EsQ0FBQyxVQUFtQjtBQUNsQixlQUFLLFdBQVcsUUFBUTtBQUN4QixlQUFLLGdCQUFnQixPQUFPLGtCQUFrQjtBQUFBLFFBQ2hEO0FBQUEsTUFDRixFQUNDLE1BQU0sTUFBTTtBQUFBLE1BQUMsQ0FBQztBQUFBLElBQ25CLEdBQUcsT0FBTztBQUFBLEVBQ1o7QUFBQTtBQUFBLEVBR1EsZ0JBQWdCLE9BQWdCLFNBQXVCO0FBQzdELFFBQUksaUJBQWlCLGdCQUFnQixpQkFBaUIsbUJBQW1CO0FBQ3ZFLFdBQUssYUFBYTtBQUNsQixXQUFLLGFBQWE7QUFDbEIsV0FBSyxRQUFRLE1BQU0sU0FBUyxLQUFLO0FBQ2pDLFVBQUk7QUFBQSxRQUNGO0FBQUEsUUFDQTtBQUFBLE1BQ0Y7QUFDQTtBQUFBLElBQ0Y7QUFDQSxTQUFLLFFBQVEsS0FBSyxTQUFTLEtBQUs7QUFBQSxFQUNsQztBQUFBO0FBQUEsRUFHQSxNQUFjLHNCQUFzQixTQUFnRDtBQUNsRixRQUFJO0FBQ0osUUFBSTtBQUNGLFlBQU0sUUFBUSxNQUFNLFFBQVEsU0FBUyx3QkFBd0I7QUFDN0QsZUFBUyxLQUFLLE1BQU0sSUFBSSxZQUFZLEVBQUUsT0FBTyxLQUFLLENBQUM7QUFBQSxJQUNyRCxTQUFRO0FBQ047QUFBQSxJQUNGO0FBQ0EsUUFDRSxPQUFPLE9BQU8sYUFBYSxZQUMzQixPQUFPLGFBQWEsS0FBSyxLQUFLLFVBQzlCO0FBQ0EsWUFBTSxPQUFPLE9BQU8sT0FBTyxlQUFlLFdBQVcsT0FBTyxhQUFhLE9BQU87QUFDaEYsWUFBTSxRQUFRLE9BQU8sT0FBTyxRQUFRLFdBQVcsT0FBTyxNQUFNO0FBQzVELFVBQUk7QUFBQSxRQUNGLDREQUE0RCxJQUFJLGdCQUFnQixLQUFLO0FBQUEsUUFHckY7QUFBQSxNQUNGO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFDRjtBQUVBLFNBQVMsdUJBQXVCLE9BQXVCO0FBQ3JELE1BQUk7QUFDRixXQUFPLG1CQUFtQixLQUFLO0FBQUEsRUFDakMsU0FBUTtBQUNOLFdBQU87QUFBQSxFQUNUO0FBQ0Y7IiwKICAibmFtZXMiOiBbImltcG9ydF9vYnNpZGlhbiIsICJfYSIsICJfYiIsICJfYyIsICJfZCIsICJfZSIsICJpbXBvcnRfb2JzaWRpYW4iLCAiaW1wb3J0X29ic2lkaWFuIiwgImltcG9ydF9vYnNpZGlhbiIsICJfYSIsICJfYSJdCn0K
