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
      this.conflicts = [...plan.conflicts];
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
  var _a, _b, _c, _d;
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiLCAic3JjL3BsdWdpbi50cyIsICIuLi9jb3JlL3NyYy9wYXRocy50cyIsICIuLi9jb3JlL3NyYy9jbG9jay50cyIsICIuLi9jb3JlL3NyYy9oYXNoaW5nLnRzIiwgIi4uL2NvcmUvc3JjL2Vycm9ycy50cyIsICIuLi9jb3JlL3NyYy9sb2NhbGluZGV4LnRzIiwgIi4uL2NvcmUvc3JjL2VuZ2luZS50cyIsICIuLi9jb3JlL3NyYy9pZ25vcmUudHMiLCAiLi4vY29yZS9zcmMvcHJvdG9jb2wudHMiLCAiLi4vY29yZS9zcmMvY29uZmxpY3RuYW1lcy50cyIsICIuLi9jb3JlL3NyYy9yZXNvbHZlLnRzIiwgIi4uL2NvcmUvc3JjL3NjYW4udHMiLCAiLi4vY29yZS9zcmMvY2xpZW50LnRzIiwgIi4uL2NvcmUvc3JjL2NvbXBhdC50cyIsICJzcmMvYWRhcHRlcnMvb2JzaWRpYW4tc3RvcmFnZS50cyIsICJzcmMvYWRhcHRlcnMvb2JzaWRpYW4td2F0Y2gudHMiLCAic3JjL2Jsb2JzdG9yZS50cyIsICJzcmMvZGlhZ25vc3RpY3MudHMiLCAic3JjL2RhdGEudHMiLCAic3JjL3dvcmtlcmFwaS50cyIsICJzcmMvcGFpcmluZy50cyIsICJzcmMvcHJvdG9jb2wtaGFuZGxlci50cyIsICJzcmMvcmVjb25uZWN0LnRzIiwgInNyYy9zZXR0aW5ncy50cyIsICJzcmMvc3RhdHVzYmFyLnRzIiwgInNyYy90cmFuc3BvcnQudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbIi8qKlxuICogUGx1Z2luIGVudHJ5IHBvaW50IFx1MjAxNCBPYnNpZGlhbiBsb2FkcyBgbWFpbi5qc2AgYW5kIGluc3RhbnRpYXRlcyB0aGUgZGVmYXVsdFxuICogZXhwb3J0LiBFdmVyeXRoaW5nIHJlYWwgbGl2ZXMgaW4gYHBsdWdpbi50c2AgKGFuZCBpdHMgbW9kdWxlcyk7IHRoaXMgZmlsZVxuICogb25seSByZS1leHBvcnRzLlxuICovXG5cbmV4cG9ydCB7IFZhdWx0U3luY1BsdWdpbiBhcyBkZWZhdWx0IH0gZnJvbSAnLi9wbHVnaW4uanMnO1xuIiwgIi8qKlxuICogYFZhdWx0U3luY1BsdWdpbmAgXHUyMDE0IHRoZSBPYnNpZGlhbiBjbGllbnQgKGRlc2t0b3AgKyBtb2JpbGUpLlxuICpcbiAqIG9ubG9hZDogbG9hZCBsaW5rIGlkZW50aXR5IFx1MjE5MiBpZiBsaW5rZWQsIGJ1aWxkIGBTeW5jQ2xpZW50YCAoY29yZSkgb3ZlciB0aGVcbiAqIE9ic2lkaWFuIGFkYXB0ZXJzIGFuZCBydW4gc3RhcnR1cCByZWNvbmNpbGlhdGlvbiAodGhlIHN5bmMtb24tb3BlblxuICogY29udHJhY3QsIEZSLTQvRlItNS9GUi0xMiksIHRoZW4gZW50ZXIgbGl2ZSBtb2RlICh2YXVsdCBldmVudHMgKyBwZXJpb2RpY1xuICogcmVzY2FuICsgZm9jdXMgcmVzY2FuKSB3aXRoIGEgc3RhdHVzLWJhciBpbmRpY2F0b3IgYW5kIGppdHRlcmVkXG4gKiBleHBvbmVudGlhbC1iYWNrb2ZmIHJlY29ubmVjdCAoY2FwcGVkIGF0IDYwIHMpLlxuICpcbiAqIEEgMSBIeiBcInN1cGVydmlzaW9uIHRpY2tcIiBkcml2ZXMgZXZlcnl0aGluZyB0aW1lLWJhc2VkOiBpdCByZXBhaW50cyB0aGVcbiAqIHN0YXR1cyBiYXIgYW5kIG5vdGljZXMgYGRpc2Nvbm5lY3RlZGAgXHUyMTkyIHNjaGVkdWxlcyBvbmUgcmVjb25uZWN0IGF0IGEgdGltZS5cbiAqIEFsbCB0aW1lcnMgYXJlIG93bmVkIGhlcmUgYW5kIHRvcm4gZG93biBpbiBgc3RvcFN5bmMoKWAvYG9udW5sb2FkYC5cbiAqL1xuXG5pbXBvcnQgeyBOb3RpY2UsIFBsdWdpbiB9IGZyb20gJ29ic2lkaWFuJztcbmltcG9ydCB0eXBlIHsgQXBwLCBQbHVnaW5NYW5pZmVzdCB9IGZyb20gJ29ic2lkaWFuJztcbmltcG9ydCB7XG4gIGNoZWNrU2VydmVyQ29tcGF0aWJpbGl0eSxcbiAgUmV2b2tlZEVycm9yLFxuICBTeW5jQ2xpZW50LFxuICBVbmF1dGhvcml6ZWRFcnJvcixcbiAgdHlwZSBDb21wYXRpYmlsaXR5VmVyZGljdCxcbiAgdHlwZSBTeW5jQ2xpZW50U3RhdHVzLFxufSBmcm9tICdAdnNhL2NvcmUnO1xuaW1wb3J0IHsgT2JzaWRpYW5TdG9yYWdlQWRhcHRlciB9IGZyb20gJy4vYWRhcHRlcnMvb2JzaWRpYW4tc3RvcmFnZS5qcyc7XG5pbXBvcnQgeyBPYnNpZGlhbldhdGNoQWRhcHRlciwgUmVzY2FuU2NoZWR1bGVyIH0gZnJvbSAnLi9hZGFwdGVycy9vYnNpZGlhbi13YXRjaC5qcyc7XG5pbXBvcnQgeyBIdHRwQmxvYlN0b3JlIH0gZnJvbSAnLi9ibG9ic3RvcmUuanMnO1xuaW1wb3J0IHtcbiAgYnVpbGREaWFnbm9zdGljc0J1bmRsZSxcbiAgYnVpbGRTdXBwb3J0QnVuZGxlLFxuICBjb3B5VG9DbGlwYm9hcmQsXG4gIGNyZWF0ZVBsdWdpbkxvZyxcbiAgZm9ybWF0U3VwcG9ydEJ1bmRsZVN0YW1wLFxuICBwbGF0Zm9ybVN1bW1hcnksXG4gIHdpdGhSb3VuZFRyaXBMb2dnaW5nLFxuICB0eXBlIERpYWdub3N0aWNzSW5wdXQsXG4gIHR5cGUgUGx1Z2luTG9nLFxufSBmcm9tICcuL2RpYWdub3N0aWNzLmpzJztcbmltcG9ydCB7XG4gIGRlZmF1bHREZXZpY2VOYW1lLFxuICBkZXRlY3REZXZpY2VUeXBlLFxuICBpc0xpbmtlZCxcbiAgbm9ybWFsaXplUGx1Z2luRGF0YSxcbiAgcGFyc2VJZ25vcmVQYXR0ZXJucyxcbiAgZGVmYXVsdFBsdWdpbkRhdGEsXG4gIHR5cGUgTG9nTGV2ZWwsXG4gIHR5cGUgVmF1bHRTeW5jUGx1Z2luRGF0YSxcbn0gZnJvbSAnLi9kYXRhLmpzJztcbmltcG9ydCB7IHBhaXJPdXRjb21lTWVzc2FnZSwgcGFpcldpdGhXb3JrZXIgfSBmcm9tICcuL3BhaXJpbmcuanMnO1xuaW1wb3J0IHR5cGUgeyBQYWlyT3V0Y29tZSB9IGZyb20gJy4vcGFpcmluZy5qcyc7XG5pbXBvcnQgeyByZWdpc3RlclBhaXJQcm90b2NvbEhhbmRsZXIgfSBmcm9tICcuL3Byb3RvY29sLWhhbmRsZXIuanMnO1xuaW1wb3J0IHsgUmVjb25uZWN0U3VwZXJ2aXNvciB9IGZyb20gJy4vcmVjb25uZWN0LmpzJztcbmltcG9ydCB0eXBlIHsgQmFja29mZk9wdGlvbnMgfSBmcm9tICcuL3JlY29ubmVjdC5qcyc7XG5pbXBvcnQgdHlwZSB7IFN0YXR1c0Jhck1vZGUgfSBmcm9tICcuL3N0YXR1c2Jhci5qcyc7XG5pbXBvcnQgeyBWYXVsdFN5bmNTZXR0aW5nVGFiIH0gZnJvbSAnLi9zZXR0aW5ncy5qcyc7XG5pbXBvcnQgeyBTdGF0dXNCYXJJbmRpY2F0b3IgfSBmcm9tICcuL3N0YXR1c2Jhci5qcyc7XG5pbXBvcnQgeyBXZWJTb2NrZXRUcmFuc3BvcnQgfSBmcm9tICcuL3RyYW5zcG9ydC5qcyc7XG5pbXBvcnQgdHlwZSB7IFdlYlNvY2tldEZhY3RvcnkgfSBmcm9tICcuL3RyYW5zcG9ydC5qcyc7XG5pbXBvcnQgeyBmZXRjaFdvcmtlclN0YXR1cywgbm9ybWFsaXplV29ya2VyVXJsLCByZW5hbWVEZXZpY2UgfSBmcm9tICcuL3dvcmtlcmFwaS5qcyc7XG5pbXBvcnQgdHlwZSB7IFdvcmtlclN0YXR1c1N1bW1hcnkgfSBmcm9tICcuL3dvcmtlcmFwaS5qcyc7XG5cbi8qKiBUaGUgaW4tdmF1bHQgZGV2aWNlIG1hcmtlciBzaGFyZWQgd2l0aCB0aGUgZGFlbW9uL0NMSSAoRlItNDQgaGFuZHNoYWtlKS4gKi9cbmNvbnN0IERFVklDRV9NQVJLRVJfVkFVTFRfUEFUSCA9ICcvLnZhdWx0c3luY2ZvcmFnZW50cy9kZXZpY2UuanNvbic7XG5jb25zdCBMT0NBTF9JTkRFWF9WQVVMVF9QQVRIID0gJy8udmF1bHRzeW5jZm9yYWdlbnRzL3N0YXRlJztcbi8qKiBXaGVyZSBcIlNhdmUgc3VwcG9ydCBidW5kbGVcIiB3cml0ZXMgaXRzIGRpYWdub3N0aWMgZmlsZS4gKi9cbmNvbnN0IFNVUFBPUlRfQlVORExFX0RJUl9WQVVMVF9QQVRIID0gJy8udmF1bHRzeW5jZm9yYWdlbnRzJztcbmNvbnN0IFNVUEVSVklTSU9OX1RJQ0tfTVMgPSAxMDAwO1xuXG4vKiogVGltZXIgaGFuZGxlcyAobnVtYmVyIGluIHRoZSBET00sIGBUaW1lb3V0YCB3aGVuIE5vZGUgdHlwZXMgbGVhayBpbikuICovXG50eXBlIFRpbWVySGFuZGxlID0gUmV0dXJuVHlwZTx0eXBlb2Ygc2V0SW50ZXJ2YWw+O1xuXG4vKiogSW5qZWN0YWJsZSBzZWFtcyBzbyB1bml0IHRlc3RzIG5lZWQgbm8gcmVhbCBPYnNpZGlhbi9uZXR3b3JrLiAqL1xuZXhwb3J0IGludGVyZmFjZSBQbHVnaW5PdmVycmlkZXMge1xuICBmZXRjaEltcGw/OiB0eXBlb2YgZmV0Y2g7XG4gIHdzRmFjdG9yeT86IFdlYlNvY2tldEZhY3Rvcnk7XG4gIG5vdz86ICgpID0+IG51bWJlcjtcbiAgLyoqIFJlY29ubmVjdCBiYWNrb2ZmIGtub2JzICh0ZXN0cyBpbmplY3QgYSBkZXRlcm1pbmlzdGljIHJhbmRvbSkuICovXG4gIHJlY29ubmVjdD86IEJhY2tvZmZPcHRpb25zO1xufVxuXG5leHBvcnQgY2xhc3MgVmF1bHRTeW5jUGx1Z2luIGV4dGVuZHMgUGx1Z2luIHtcbiAgZGF0YTogVmF1bHRTeW5jUGx1Z2luRGF0YSA9IGRlZmF1bHRQbHVnaW5EYXRhKCk7XG4gIC8qKiBUaGUgbGl2ZSBzeW5jIGNsaWVudCAobnVsbCB3aGlsZSB1bmxpbmtlZC9zdG9wcGVkKS4gKi9cbiAgY2xpZW50OiBTeW5jQ2xpZW50IHwgbnVsbCA9IG51bGw7XG5cbiAgcHJpdmF0ZSByZWFkb25seSBvdmVycmlkZXM6IFBsdWdpbk92ZXJyaWRlcztcbiAgcHJpdmF0ZSB3YXRjaGVyOiBPYnNpZGlhbldhdGNoQWRhcHRlciB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHJlc2NhbjogUmVzY2FuU2NoZWR1bGVyIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgc3RhdHVzQmFyOiBTdGF0dXNCYXJJbmRpY2F0b3IgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBzdGF0dXNCYXJJdGVtOiBIVE1MRWxlbWVudCB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHRpY2tIYW5kbGU6IFRpbWVySGFuZGxlIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgcmVjb25uZWN0VGltZXI6IFRpbWVySGFuZGxlIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgc3VwZXJ2aXNvciA9IG5ldyBSZWNvbm5lY3RTdXBlcnZpc29yKCk7XG4gIC8qKiBTZXQgd2hlbiB0aGUgd29ya2VyIHJlamVjdGVkIHRoZSB0b2tlbiBcdTIwMTQgcmVjb25uZWN0aW5nIGNhbm5vdCBoZWxwLiAqL1xuICBwcml2YXRlIGF1dGhGYWlsZWQgPSBmYWxzZTtcbiAgcHJpdmF0ZSBzdGF0dXNOb3RlID0gJyc7XG4gIC8qKlxuICAgKiBMYXRlc3Qgc2VydmVyLXZlcnNpb24gdmVyZGljdCAoY29yZSBjb21wYXQudHMpLCByZS1hc3Nlc3NlZCBieSB0aGVcbiAgICogc3VwZXJ2aXNpb24gdGljayBhZnRlciBldmVyeSBoZWxsb0FjazsgbnVsbCBiZWZvcmUgdGhlIGZpcnN0IGFjayBvZiBhXG4gICAqIHN5bmMgc2Vzc2lvbi4gTm9uLW9rIHZlcmRpY3RzIHJpZGUgdGhlIHN0YXR1cy1iYXIgdG9vbHRpcDsgYSBOb3RpY2UgaXNcbiAgICogc2hvd24gYXQgbW9zdCBvbmNlIHBlciBwbHVnaW4gc2Vzc2lvbi5cbiAgICovXG4gIHByaXZhdGUgc2VydmVyQ29tcGF0OiBDb21wYXRpYmlsaXR5VmVyZGljdCB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHNlcnZlckNvbXBhdE5vdGlmaWVkID0gZmFsc2U7XG4gIC8qKiBQYXVzZS1zeW5jaW5nIHN0YXRlIChydW50aW1lIG9ubHkgXHUyMDE0IGEgcmVsb2FkIHN0YXJ0cyBwZXIgc3luY09uU3RhcnR1cCkuICovXG4gIHByaXZhdGUgcGF1c2VkID0gZmFsc2U7XG4gIC8qKiBUaGUgcGx1Z2luJ3MgbG9nOiBjb25zb2xlIG1pcnJvciArIGJvdW5kZWQgcmluZyAoQ29weSBkaWFnbm9zdGljcykuICovXG4gIHByaXZhdGUgcmVhZG9ubHkgc3luY0xvZzogUGx1Z2luTG9nID0gY3JlYXRlUGx1Z2luTG9nKCk7XG5cbiAgY29uc3RydWN0b3IoYXBwOiBBcHAsIG1hbmlmZXN0OiBQbHVnaW5NYW5pZmVzdCwgb3ZlcnJpZGVzOiBQbHVnaW5PdmVycmlkZXMgPSB7fSkge1xuICAgIHN1cGVyKGFwcCwgbWFuaWZlc3QpO1xuICAgIHRoaXMub3ZlcnJpZGVzID0gb3ZlcnJpZGVzO1xuICB9XG5cbiAgcHJpdmF0ZSBnZXQgbm93KCk6ICgpID0+IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMub3ZlcnJpZGVzLm5vdyA/PyAoKCkgPT4gRGF0ZS5ub3coKSk7XG4gIH1cblxuICBwcml2YXRlIGdldCBmZXRjaEltcGwoKTogdHlwZW9mIGZldGNoIHtcbiAgICAvLyBCaW5kIGF0IHRoZSBzZWFtOiBjb25zdW1lcnMgKHBhaXJpbmcsIGBIdHRwQmxvYlN0b3JlYCkgaW52b2tlIHRoaXMgYXMgYVxuICAgIC8vIGRldGFjaGVkIGZ1bmN0aW9uLCBhbmQgYSBkZXRhY2hlZCBgZmV0Y2hgIHRocm93c1xuICAgIC8vIGBUeXBlRXJyb3I6IEZhaWxlZCB0byBleGVjdXRlICdmZXRjaCcgb24gJ1dpbmRvdyc6IElsbGVnYWwgaW52b2NhdGlvbmBcbiAgICAvLyBpbiBDaHJvbWl1bSByZW5kZXJlcnMgXHUyMDE0IGkuZS4gaW4gcmVhbCBPYnNpZGlhbiAoZGVza3RvcCBhbmQgbW9iaWxlKS5cbiAgICAvLyBCaW5kaW5nIHRvIHRoZSBnbG9iYWwgbWFrZXMgdGhlIGRlZmF1bHQgc2FmZSB0byBjYWxsIGJhcmUuXG4gICAgcmV0dXJuIHRoaXMub3ZlcnJpZGVzLmZldGNoSW1wbCA/PyBnbG9iYWxUaGlzLmZldGNoLmJpbmQoZ2xvYmFsVGhpcyk7XG4gIH1cblxuICBnZXQgbGlua2VkKCk6IGJvb2xlYW4ge1xuICAgIHJldHVybiBpc0xpbmtlZCh0aGlzLmRhdGEpO1xuICB9XG5cbiAgb3ZlcnJpZGUgYXN5bmMgb25sb2FkKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuZGF0YSA9IG5vcm1hbGl6ZVBsdWdpbkRhdGEoYXdhaXQgdGhpcy5sb2FkRGF0YSgpKTtcbiAgICB0aGlzLnN5bmNMb2cuc2V0TGV2ZWwodGhpcy5kYXRhLnNldHRpbmdzLmxvZ0xldmVsKTtcbiAgICB0aGlzLmFkZFNldHRpbmdUYWIobmV3IFZhdWx0U3luY1NldHRpbmdUYWIodGhpcy5hcHAsIHRoaXMpKTtcbiAgICByZWdpc3RlclBhaXJQcm90b2NvbEhhbmRsZXIoXG4gICAgICAoYWN0aW9uLCBoYW5kbGVyKSA9PiB0aGlzLnJlZ2lzdGVyT2JzaWRpYW5Qcm90b2NvbEhhbmRsZXIoYWN0aW9uLCBoYW5kbGVyKSxcbiAgICAgIChsaW5rKSA9PiB0aGlzLmhhbmRsZVBhaXJEZWVwTGluayhsaW5rLnVybCwgbGluay5jb2RlKSxcbiAgICApO1xuICAgIC8vIENoZWFwIGZvY3VzLWRyaXZlbiByZXNjYW4gKEZSLTEyKTogZXZlcnkgbm90ZS9hcHAgc3dpdGNoIHBva2VzIHRoZVxuICAgIC8vIHNjaGVkdWxlciwgd2hpY2ggY29hbGVzY2VzIGludG8gYXQgbW9zdCBvbmUgY3ljbGUgcGVyIGRlYm91bmNlIHdpbmRvdy5cbiAgICB0aGlzLnJlZ2lzdGVyRXZlbnQodGhpcy5hcHAud29ya3NwYWNlLm9uKCdhY3RpdmUtbGVhZi1jaGFuZ2UnLCAoKSA9PiB0aGlzLnJlc2Nhbj8ucG9rZSgpKSk7XG4gICAgdGhpcy5hZGRDb21tYW5kKHtcbiAgICAgIGlkOiAnY29weS1kaWFnbm9zdGljcycsXG4gICAgICBuYW1lOiAnQ29weSBkaWFnbm9zdGljcycsXG4gICAgICBjYWxsYmFjazogKCkgPT4gdGhpcy5jb3B5RGlhZ25vc3RpY3MoKSxcbiAgICB9KTtcbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6ICdzYXZlLXN1cHBvcnQtYnVuZGxlJyxcbiAgICAgIG5hbWU6ICdTYXZlIHN1cHBvcnQgYnVuZGxlJyxcbiAgICAgIGNhbGxiYWNrOiAoKSA9PiB0aGlzLnNhdmVTdXBwb3J0QnVuZGxlKCksXG4gICAgfSk7XG4gICAgLy8gXCJTeW5jIG9uIHN0YXJ0dXBcIiBPRkYgPSBtYW51YWwtb25seSBtb2RlOiBsb2FkIGlkbGU7IHRoZSBmaXJzdCBcIlN5bmNcbiAgICAvLyBub3dcIiBzdGFydHMgdGhlIG1hY2hpbmVyeSAod2F0Y2hlciBpbmNsdWRlZCkuXG4gICAgaWYgKHRoaXMubGlua2VkICYmIHRoaXMuZGF0YS5zZXR0aW5ncy5zeW5jT25TdGFydHVwKSBhd2FpdCB0aGlzLnN0YXJ0U3luYygpO1xuICB9XG5cbiAgb3ZlcnJpZGUgb251bmxvYWQoKTogdm9pZCB7XG4gICAgdGhpcy5zdG9wU3luYygpO1xuICB9XG5cbiAgLy8gLS0tIHBlcnNpc3RlbmNlIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgYXN5bmMgc2F2ZVBsdWdpbkRhdGEoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5zYXZlRGF0YSh0aGlzLmRhdGEpO1xuICB9XG5cbiAgLy8gLS0tIHBhaXJpbmcgKHNldHRpbmdzIHRhYiArIGRlZXAgbGluaykgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICAvKiogUGFpciBmcm9tIHRoZSBzZXR0aW5ncyBmb3JtIChmaWVsZHMgYWxyZWFkeSBsaXZlIGluIGB0aGlzLmRhdGFgKS4gKi9cbiAgYXN5bmMgcGFpckZyb21TZXR0aW5ncyhjb2RlOiBzdHJpbmcpOiBQcm9taXNlPFBhaXJPdXRjb21lPiB7XG4gICAgY29uc3QgZGV2aWNlTmFtZSA9IHRoaXMucmVzb2x2ZURldmljZU5hbWUoKTtcbiAgICBjb25zdCBvdXRjb21lID0gYXdhaXQgcGFpcldpdGhXb3JrZXIoe1xuICAgICAgdXJsOiB0aGlzLmRhdGEudXJsLFxuICAgICAgY29kZSxcbiAgICAgIGRldmljZU5hbWUsXG4gICAgICBkZXZpY2VUeXBlOiBkZXRlY3REZXZpY2VUeXBlKCksXG4gICAgICBmZXRjaEltcGw6IHRoaXMuZmV0Y2hJbXBsLFxuICAgIH0pO1xuICAgIGF3YWl0IHRoaXMuYXBwbHlQYWlyT3V0Y29tZShvdXRjb21lLCBkZXZpY2VOYW1lKTtcbiAgICByZXR1cm4gb3V0Y29tZTtcbiAgfVxuXG4gIC8qKiBvYnNpZGlhbjovL3ZhdWx0c3luY2ZvcmFnZW50cy9wYWlyP3VybD1cdTIwMjYmY29kZT1cdTIwMjYgKHByb3RvY29sLWhhbmRsZXIudHMpLiAqL1xuICBwcml2YXRlIGFzeW5jIGhhbmRsZVBhaXJEZWVwTGluayh1cmw6IHN0cmluZywgY29kZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKHRoaXMubGlua2VkKSB7XG4gICAgICBpZiAobm9ybWFsaXplV29ya2VyVXJsU2FmZSh1cmwpID09PSBub3JtYWxpemVXb3JrZXJVcmxTYWZlKHRoaXMuZGF0YS51cmwpKSB7XG4gICAgICAgIG5ldyBOb3RpY2UoJ1ZhdWx0U3luYzogdGhpcyB2YXVsdCBpcyBhbHJlYWR5IHBhaXJlZCB3aXRoIHRoYXQgd29ya2VyLicpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgbmV3IE5vdGljZShcbiAgICAgICAgICAnVmF1bHRTeW5jOiB0aGlzIHZhdWx0IGlzIHBhaXJlZCB3aXRoIGEgZGlmZmVyZW50IHdvcmtlci4gVW5saW5rIGl0IGluIHNldHRpbmdzIGZpcnN0LicsXG4gICAgICAgICAgMTAwMDAsXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IGRldmljZU5hbWUgPSB0aGlzLnJlc29sdmVEZXZpY2VOYW1lKCk7XG4gICAgY29uc3Qgb3V0Y29tZSA9IGF3YWl0IHBhaXJXaXRoV29ya2VyKHtcbiAgICAgIHVybCxcbiAgICAgIGNvZGUsXG4gICAgICBkZXZpY2VOYW1lLFxuICAgICAgZGV2aWNlVHlwZTogZGV0ZWN0RGV2aWNlVHlwZSgpLFxuICAgICAgZmV0Y2hJbXBsOiB0aGlzLmZldGNoSW1wbCxcbiAgICB9KTtcbiAgICBhd2FpdCB0aGlzLmFwcGx5UGFpck91dGNvbWUob3V0Y29tZSwgZGV2aWNlTmFtZSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGFwcGx5UGFpck91dGNvbWUob3V0Y29tZTogUGFpck91dGNvbWUsIGRldmljZU5hbWU6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmIChvdXRjb21lLnN0YXR1cyAhPT0gJ3BhaXJlZCcpIHtcbiAgICAgIG5ldyBOb3RpY2UocGFpck91dGNvbWVNZXNzYWdlKG91dGNvbWUpLCAxMDAwMCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRoaXMuZGF0YS51cmwgPSBvdXRjb21lLnVybDtcbiAgICB0aGlzLmRhdGEudG9rZW4gPSBvdXRjb21lLnRva2VuO1xuICAgIHRoaXMuZGF0YS5kZXZpY2VJZCA9IG91dGNvbWUuZGV2aWNlSWQ7XG4gICAgdGhpcy5kYXRhLmRldmljZU5hbWUgPSBkZXZpY2VOYW1lO1xuICAgIGF3YWl0IHRoaXMuc2F2ZVBsdWdpbkRhdGEoKTtcbiAgICBhd2FpdCB0aGlzLndyaXRlRGV2aWNlTWFya2VyKCk7XG4gICAgbmV3IE5vdGljZShwYWlyT3V0Y29tZU1lc3NhZ2Uob3V0Y29tZSkpO1xuICAgIGF3YWl0IHRoaXMuc3RhcnRTeW5jKCk7XG4gIH1cblxuICBwcml2YXRlIHJlc29sdmVEZXZpY2VOYW1lKCk6IHN0cmluZyB7XG4gICAgY29uc3QgdHlwZWQgPSB0aGlzLmRhdGEuZGV2aWNlTmFtZS50cmltKCk7XG4gICAgcmV0dXJuIHR5cGVkICE9PSAnJyA/IHR5cGVkIDogZGVmYXVsdERldmljZU5hbWUoKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBUaGUgdmF1bHQtYmFja2VkIHN0b3JhZ2UgYWRhcHRlciBldmVyeSBzeW5jIHN1cmZhY2UgdXNlcy4gV2lyZXMgdGhlXG4gICAqIGVtcHR5LWZvbGRlciByZW1vdmFsIHRocm91Z2ggYGZpbGVNYW5hZ2VyLnRyYXNoRmlsZWAgXHUyMDE0IE9ic2lkaWFuJ3NcbiAgICogYERhdGFBZGFwdGVyLnJtZGlyYCByZWZ1c2VzIEVWRVJZIGRpcmVjdG9yeSAoYEVSUl9GU19FSVNESVJgKSwgd2hpY2hcbiAgICogc2lsZW50bHkgZGVncmFkZWQgZm9sZGVyLXRvbWJzdG9uZSBhcHBsaWNhdGlvbiB0byByZWNvcmQtb25seSAoRi0xKS5cbiAgICogVHJhc2ggKG5vdCBkZWxldGUpIGJlY2F1c2UgYW4gZW1wdHkgZm9sZGVyIGlzIHRyaXZpYWxseSByZWNvdmVyYWJsZS5cbiAgICovXG4gIHByaXZhdGUgY3JlYXRlU3RvcmFnZUFkYXB0ZXIoKTogT2JzaWRpYW5TdG9yYWdlQWRhcHRlciB7XG4gICAgcmV0dXJuIG5ldyBPYnNpZGlhblN0b3JhZ2VBZGFwdGVyKHtcbiAgICAgIGFkYXB0ZXI6IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIsXG4gICAgICByZW1vdmVFbXB0eURpcjogYXN5bmMgKGFkYXB0ZXJQYXRoKSA9PiB7XG4gICAgICAgIGNvbnN0IGZvbGRlciA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChhZGFwdGVyUGF0aCk7XG4gICAgICAgIGlmIChmb2xkZXIgPT09IG51bGwpIHJldHVybjsgLy8gcmFjZWQgYXdheSAvIHRyZWUgbm90IGNhdWdodCB1cCBcdTIwMTQgaWRlbXBvdGVudFxuICAgICAgICBhd2FpdCB0aGlzLmFwcC5maWxlTWFuYWdlci50cmFzaEZpbGUoZm9sZGVyKTtcbiAgICAgIH0sXG4gICAgfSk7XG4gIH1cblxuICAvKiogV3JpdGUgdGhlIEZSLTQ0IG1hcmtlciB0aGUgQ0xJL2RhZW1vbiByZWFkIHRvIGRldGVjdCBkb3VibGUtY2xpZW50cy4gKi9cbiAgcHJpdmF0ZSBhc3luYyB3cml0ZURldmljZU1hcmtlcigpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIXRoaXMubGlua2VkKSByZXR1cm47XG4gICAgY29uc3Qgc3RvcmFnZSA9IHRoaXMuY3JlYXRlU3RvcmFnZUFkYXB0ZXIoKTtcbiAgICBjb25zdCBtYXJrZXIgPSB7XG4gICAgICBkZXZpY2VJZDogdGhpcy5kYXRhLmRldmljZUlkLFxuICAgICAgZGV2aWNlTmFtZTogdGhpcy5yZXNvbHZlRGV2aWNlTmFtZSgpLFxuICAgICAgdXJsOiB0aGlzLmRhdGEudXJsLFxuICAgICAgbGlua2VkQXQ6IHRoaXMubm93KCksXG4gICAgfTtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgc3RvcmFnZS53cml0ZUZpbGUoXG4gICAgICAgIERFVklDRV9NQVJLRVJfVkFVTFRfUEFUSCxcbiAgICAgICAgbmV3IFRleHRFbmNvZGVyKCkuZW5jb2RlKGAke0pTT04uc3RyaW5naWZ5KG1hcmtlciwgbnVsbCwgMil9XFxuYCksXG4gICAgICApO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLnN5bmNMb2cud2FybignZmFpbGVkIHRvIHdyaXRlIGRldmljZSBtYXJrZXInLCBlcnJvcik7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIGBQQVRDSCAvZGV2aWNlYCBcdTIwMTQgcmVuYW1lIFRISVMgZGV2aWNlIG9uIHRoZSB3b3JrZXIgKHRoZSBzZXR0aW5ncyB0YWInc1xuICAgKiBSZW5hbWUgYnV0dG9uKS4gVXBkYXRlcyBwbHVnaW4gZGF0YSArIHRoZSBpbi12YXVsdCBkZXZpY2UgbWFya2VyICh3aGljaFxuICAgKiBzdG9yZXMgdGhlIG5hbWUgZm9yIHRoZSBGUi00NCBkb3VibGUtY2xpZW50IHdhcm5pbmcpLiBMb2NhbCBzdGF0ZSBrZWVwc1xuICAgKiBpdHMgcHJldmlvdXMgbmFtZSBvbiBmYWlsdXJlLlxuICAgKi9cbiAgYXN5bmMgcmVuYW1lRGV2aWNlKG5hbWU6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIGlmICghdGhpcy5saW5rZWQpIHtcbiAgICAgIG5ldyBOb3RpY2UoJ1ZhdWx0U3luYzogcGFpciB0aGlzIHZhdWx0IGZpcnN0IFx1MjAxNCB0aGUgbmFtZSBhcHBsaWVzIGF0IHBhaXJpbmcgdGltZS4nKTtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgY29uc3QgdHJpbW1lZCA9IG5hbWUudHJpbSgpO1xuICAgIGlmICh0cmltbWVkID09PSAnJyB8fCB0cmltbWVkLmxlbmd0aCA+IDMwIHx8IC9bXFx1MDAwMC1cXHUwMDFmXFx1MDA3Zl0vLnRlc3QodHJpbW1lZCkpIHtcbiAgICAgIG5ldyBOb3RpY2UoJ1ZhdWx0U3luYzogZGV2aWNlIG5hbWUgbXVzdCBiZSAxLTMwIGNoYXJhY3RlcnMsIHdpdGhvdXQgY29udHJvbCBjaGFyYWN0ZXJzLicsIDgwMDApO1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICBjb25zdCBvdXRjb21lID0gYXdhaXQgcmVuYW1lRGV2aWNlKHtcbiAgICAgIG9yaWdpbjogdGhpcy5kYXRhLnVybCxcbiAgICAgIHRva2VuOiB0aGlzLmRhdGEudG9rZW4sXG4gICAgICBuYW1lOiB0cmltbWVkLFxuICAgICAgZmV0Y2hJbXBsOiB0aGlzLmZldGNoSW1wbCxcbiAgICB9KTtcbiAgICBpZiAoIW91dGNvbWUub2spIHtcbiAgICAgIG5ldyBOb3RpY2UoYFZhdWx0U3luYzogcmVuYW1pbmcgZmFpbGVkIFx1MjAxNCAke291dGNvbWUuZXJyb3J9YCwgMTAwMDApO1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgICB0aGlzLmRhdGEuZGV2aWNlTmFtZSA9IG91dGNvbWUuZGV2aWNlLm5hbWU7XG4gICAgYXdhaXQgdGhpcy5zYXZlUGx1Z2luRGF0YSgpO1xuICAgIGF3YWl0IHRoaXMud3JpdGVEZXZpY2VNYXJrZXIoKTtcbiAgICBuZXcgTm90aWNlKGBWYXVsdFN5bmM6IGRldmljZSByZW5hbWVkIHRvIFx1MjAxQyR7b3V0Y29tZS5kZXZpY2UubmFtZX1cdTIwMUQuYCk7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICAvLyAtLS0gc3luYyBsaWZlY3ljbGUgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgLyoqIEJ1aWxkIGV2ZXJ5dGhpbmcgYW5kIHJ1biBzdGFydHVwIHJlY29uY2lsaWF0aW9uIChpZGVtcG90ZW50IHJlc3RhcnQpLiAqL1xuICBwcml2YXRlIGFzeW5jIHN0YXJ0U3luYygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIXRoaXMubGlua2VkKSByZXR1cm47XG4gICAgdGhpcy5zdG9wU3luYygpO1xuXG4gICAgY29uc3QgeyB1cmwsIHRva2VuLCBkZXZpY2VJZCB9ID0gdGhpcy5kYXRhO1xuICAgIGNvbnN0IGRldmljZU5hbWUgPSB0aGlzLnJlc29sdmVEZXZpY2VOYW1lKCk7XG4gICAgY29uc3Qgc3RvcmFnZSA9IHRoaXMuY3JlYXRlU3RvcmFnZUFkYXB0ZXIoKTtcbiAgICBhd2FpdCB0aGlzLndhcm5JZkZvcmVpZ25TdGF0ZURpcihzdG9yYWdlKTtcblxuICAgIGNvbnN0IGNsaWVudCA9IG5ldyBTeW5jQ2xpZW50KHtcbiAgICAgIGRldmljZUlkLFxuICAgICAgZGV2aWNlTmFtZSxcbiAgICAgIHRva2VuLFxuICAgICAgdHJhbnNwb3J0OiAoKSA9PlxuICAgICAgICB3aXRoUm91bmRUcmlwTG9nZ2luZyhcbiAgICAgICAgICBuZXcgV2ViU29ja2V0VHJhbnNwb3J0KHsgdXJsLCB0b2tlbiwgd3NGYWN0b3J5OiB0aGlzLm92ZXJyaWRlcy53c0ZhY3RvcnkgfSksXG4gICAgICAgICAgeyBsb2c6IHRoaXMuc3luY0xvZywgc2hvdWxkTG9nOiAoKSA9PiB0aGlzLnN5bmNMb2cuZGVidWdFbmFibGVkIH0sXG4gICAgICAgICksXG4gICAgICBibG9iU3RvcmU6IG5ldyBIdHRwQmxvYlN0b3JlKHsgYmFzZVVybDogdXJsLCB0b2tlbiwgZmV0Y2hJbXBsOiB0aGlzLmZldGNoSW1wbCB9KSxcbiAgICAgIHN0b3JhZ2UsXG4gICAgICBzZXR0aW5nczoge1xuICAgICAgICBvYnNpZGlhblN5bmM6IHRoaXMuZGF0YS5zZXR0aW5ncy5vYnNpZGlhblN5bmMsXG4gICAgICAgIGV4dHJhSWdub3JlczogcGFyc2VJZ25vcmVQYXR0ZXJucyh0aGlzLmRhdGEuc2V0dGluZ3MuaWdub3JlUGF0dGVybnMpLFxuICAgICAgfSxcbiAgICAgIGxvZzogdGhpcy5zeW5jTG9nLFxuICAgICAgbm93OiB0aGlzLm5vdyxcbiAgICB9KTtcbiAgICB0aGlzLmNsaWVudCA9IGNsaWVudDtcbiAgICB0aGlzLmF1dGhGYWlsZWQgPSBmYWxzZTtcbiAgICB0aGlzLnN0YXR1c05vdGUgPSAnJztcbiAgICB0aGlzLnNlcnZlckNvbXBhdCA9IG51bGw7IC8vIHJlLWFzc2Vzc2VkIGZyb20gdGhlIGZyZXNoIGhlbGxvQWNrXG4gICAgdGhpcy5zdXBlcnZpc29yID0gbmV3IFJlY29ubmVjdFN1cGVydmlzb3IodGhpcy5vdmVycmlkZXMucmVjb25uZWN0ID8/IHt9KTtcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBjbGllbnQuY29ubmVjdCgpOyAvLyBzdGFydHVwIHJlY29uY2lsaWF0aW9uIFx1MjE5MiBsaXZlIG1vZGVcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5oYW5kbGVTeW5jRXJyb3IoZXJyb3IsICdzdGFydHVwIHN5bmMgZmFpbGVkJyk7XG4gICAgfVxuXG4gICAgLy8gTGl2ZSB3YXRjaGluZzogdmF1bHQgZXZlbnRzIChkZWJvdW5jZWQgaW4gY29yZSkgKyByZXNjYW4gaG9va3MuXG4gICAgdGhpcy53YXRjaGVyID0gbmV3IE9ic2lkaWFuV2F0Y2hBZGFwdGVyKHsgdmF1bHQ6IHRoaXMuYXBwLnZhdWx0IH0pO1xuICAgIGNsaWVudC5zdGFydFdhdGNoaW5nKHRoaXMud2F0Y2hlcik7XG4gICAgdGhpcy5yZXNjYW4gPSBuZXcgUmVzY2FuU2NoZWR1bGVyKHtcbiAgICAgIGludGVydmFsTXM6IHRoaXMuZGF0YS5zZXR0aW5ncy5yZXNjYW5JbnRlcnZhbFNlYyAqIDEwMDAsXG4gICAgfSk7XG4gICAgdGhpcy5yZXNjYW4uc3RhcnQoKCkgPT4ge1xuICAgICAgdm9pZCBjbGllbnQudHJpZ2dlclN5bmMoKS5jYXRjaCgoZXJyb3I6IHVua25vd24pID0+IHtcbiAgICAgICAgdGhpcy5oYW5kbGVTeW5jRXJyb3IoZXJyb3IsICdyZXNjYW4gZmFpbGVkJyk7XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIC8vIFN0YXR1cyBiYXIgKHBlciB0aGUgc3RhdHVzQmFyTW9kZSBzZXR0aW5nKSArIHRoZSAxIEh6IHN1cGVydmlzaW9uIHRpY2tcbiAgICAvLyB0aGF0IHJlcGFpbnRzIGl0IGFuZCBzdXBlcnZpc2VzIHJlY29ubmVjdGlvbi5cbiAgICB0aGlzLm1vdW50U3RhdHVzQmFyKCk7XG4gICAgY29uc3QgdGljayA9IHNldEludGVydmFsKCgpID0+IHRoaXMub25UaWNrKCksIFNVUEVSVklTSU9OX1RJQ0tfTVMpO1xuICAgIHRoaXMudGlja0hhbmRsZSA9IHRpY2s7XG4gICAgdGhpcy5yZWdpc3RlckludGVydmFsKHRpY2sgYXMgdW5rbm93biBhcyBudW1iZXIpOyAvLyBPYnNpZGlhbiBjbGVhcnMgdGhpcyBvbiB1bmxvYWRcbiAgICB0aGlzLm9uVGljaygpO1xuICB9XG5cbiAgLyoqIChSZSltb3VudCB0aGUgc3RhdHVzLWJhciBpdGVtIHBlciB0aGUgY3VycmVudCBtb2RlICgnaGlkZGVuJyA9IG5vbmUpLiAqL1xuICBwcml2YXRlIG1vdW50U3RhdHVzQmFyKCk6IHZvaWQge1xuICAgIHRoaXMuc3RhdHVzQmFySXRlbT8ucmVtb3ZlKCk7XG4gICAgdGhpcy5zdGF0dXNCYXJJdGVtID0gbnVsbDtcbiAgICB0aGlzLnN0YXR1c0JhciA9IG51bGw7XG4gICAgaWYgKHRoaXMuY2xpZW50ID09PSBudWxsKSByZXR1cm47XG4gICAgaWYgKHRoaXMuZGF0YS5zZXR0aW5ncy5zdGF0dXNCYXJNb2RlID09PSAnaGlkZGVuJykgcmV0dXJuO1xuICAgIGNvbnN0IGl0ZW0gPSB0aGlzLmFkZFN0YXR1c0Jhckl0ZW0oKTtcbiAgICB0aGlzLnN0YXR1c0Jhckl0ZW0gPSBpdGVtO1xuICAgIHRoaXMuc3RhdHVzQmFyID0gbmV3IFN0YXR1c0JhckluZGljYXRvcihpdGVtKTtcbiAgfVxuXG4gIC8qKiBUZWFyIGRvd24gZXZlcnkgdGltZXIsIHdhdGNoZXIsIHNvY2tldCwgYW5kIFVJIGFydGlmYWN0LiBJZGVtcG90ZW50LiAqL1xuICBwcml2YXRlIHN0b3BTeW5jKCk6IHZvaWQge1xuICAgIGlmICh0aGlzLnJlY29ubmVjdFRpbWVyICE9PSBudWxsKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGhpcy5yZWNvbm5lY3RUaW1lcik7XG4gICAgICB0aGlzLnJlY29ubmVjdFRpbWVyID0gbnVsbDtcbiAgICB9XG4gICAgaWYgKHRoaXMudGlja0hhbmRsZSAhPT0gbnVsbCkge1xuICAgICAgY2xlYXJJbnRlcnZhbCh0aGlzLnRpY2tIYW5kbGUpO1xuICAgICAgdGhpcy50aWNrSGFuZGxlID0gbnVsbDtcbiAgICB9XG4gICAgdGhpcy5yZXNjYW4/LnN0b3AoKTtcbiAgICB0aGlzLnJlc2NhbiA9IG51bGw7XG4gICAgdGhpcy5jbGllbnQ/LmNsb3NlKCk7IC8vIGFsc28gc3RvcHMgdGhlIHdhdGNoZXJcbiAgICB0aGlzLmNsaWVudCA9IG51bGw7XG4gICAgdGhpcy53YXRjaGVyID0gbnVsbDtcbiAgICB0aGlzLnN0YXR1c0Jhckl0ZW0/LnJlbW92ZSgpO1xuICAgIHRoaXMuc3RhdHVzQmFySXRlbSA9IG51bGw7XG4gICAgdGhpcy5zdGF0dXNCYXIgPSBudWxsO1xuICB9XG5cbiAgLy8gLS0tIHVzZXIgYWN0aW9ucyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgYXN5bmMgc3luY05vdygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAodGhpcy5wYXVzZWQpIHtcbiAgICAgIG5ldyBOb3RpY2UoJ1ZhdWx0U3luYzogc3luY2luZyBpcyBwYXVzZWQgXHUyMDE0IHJlc3VtZSBpdCBpbiBzZXR0aW5ncyBmaXJzdC4nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgY2xpZW50ID0gdGhpcy5jbGllbnQ7XG4gICAgaWYgKGNsaWVudCA9PT0gbnVsbCkge1xuICAgICAgaWYgKCF0aGlzLmxpbmtlZCkge1xuICAgICAgICBuZXcgTm90aWNlKCdWYXVsdFN5bmM6IG5vdCBwYWlyZWQgeWV0IFx1MjAxNCBhZGQgeW91ciB3b3JrZXIgVVJMIGFuZCBhIHBhaXJpbmcgY29kZSBpbiBzZXR0aW5ncy4nKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgLy8gTWFudWFsLW9ubHkgbW9kZSAoXCJTeW5jIG9uIHN0YXJ0dXBcIiBPRkYpOiB0aGlzIGlzIHRoZSBmaXJzdCBzdGFydC5cbiAgICAgIGF3YWl0IHRoaXMuc3RhcnRTeW5jKCk7XG4gICAgICBjb25zdCBzdGF0dXMgPSB0aGlzLmNsaWVudD8uc3RhdHVzKCk7XG4gICAgICBpZiAoc3RhdHVzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgbmV3IE5vdGljZShcbiAgICAgICAgICBzdGF0dXMuc3RhdGUgPT09ICdkaXNjb25uZWN0ZWQnXG4gICAgICAgICAgICA/ICdWYXVsdFN5bmM6IG9mZmxpbmUgXHUyMDE0IGNoYW5nZXMgd2lsbCBzeW5jIHdoZW4gdGhlIHdvcmtlciBpcyByZWFjaGFibGUuJ1xuICAgICAgICAgICAgOiAnVmF1bHRTeW5jOiB1cCB0byBkYXRlLicsXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBjbGllbnQudHJpZ2dlclN5bmMoKTtcbiAgICAgIGNvbnN0IHN0YXR1cyA9IGNsaWVudC5zdGF0dXMoKTtcbiAgICAgIG5ldyBOb3RpY2UoXG4gICAgICAgIHN0YXR1cy5zdGF0ZSA9PT0gJ2Rpc2Nvbm5lY3RlZCdcbiAgICAgICAgICA/ICdWYXVsdFN5bmM6IG9mZmxpbmUgXHUyMDE0IGNoYW5nZXMgd2lsbCBzeW5jIHdoZW4gdGhlIHdvcmtlciBpcyByZWFjaGFibGUuJ1xuICAgICAgICAgIDogJ1ZhdWx0U3luYzogdXAgdG8gZGF0ZS4nLFxuICAgICAgKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5oYW5kbGVTeW5jRXJyb3IoZXJyb3IsICdzeW5jIG5vdyBmYWlsZWQnKTtcbiAgICAgIG5ldyBOb3RpY2UoJ1ZhdWx0U3luYzogc3luYyBmYWlsZWQgXHUyMDE0IHNlZSB0aGUgZGV2ZWxvcGVyIGNvbnNvbGUgZm9yIGRldGFpbHMuJyk7XG4gICAgfVxuICB9XG5cbiAgLyoqIFBhdXNlOiB0cmFuc3BvcnQgZG93biArIHdhdGNoZXIvcmVzY2FuIGlkbGUsIGxpbmsgYW5kIHN0YXRlIGtlcHQuICovXG4gIHBhdXNlU3luY2luZygpOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMubGlua2VkIHx8IHRoaXMucGF1c2VkKSByZXR1cm47XG4gICAgdGhpcy5wYXVzZWQgPSB0cnVlO1xuICAgIGlmICh0aGlzLnJlY29ubmVjdFRpbWVyICE9PSBudWxsKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGhpcy5yZWNvbm5lY3RUaW1lcik7XG4gICAgICB0aGlzLnJlY29ubmVjdFRpbWVyID0gbnVsbDtcbiAgICB9XG4gICAgdGhpcy5zdXBlcnZpc29yLnNldHRsZWQoKTtcbiAgICB0aGlzLnJlc2Nhbj8uc3RvcCgpO1xuICAgIHRoaXMucmVzY2FuID0gbnVsbDtcbiAgICB0aGlzLmNsaWVudD8uY2xvc2UoKTsgLy8gYWxzbyBzdG9wcyB0aGUgd2F0Y2hlcjsgc3RhdGUgXHUyMTkyIGlkbGVcbiAgICB0aGlzLm9uVGljaygpOyAvLyByZXBhaW50IFwidnNhIFx1MjNGOFwiXG4gICAgbmV3IE5vdGljZSgnVmF1bHRTeW5jOiBwYXVzZWQuIE5ldyBhbmQgY2hhbmdlZCBmaWxlcyBzdGF5IGxvY2FsIHVudGlsIHlvdSByZXN1bWUuJyk7XG4gIH1cblxuICAvKiogUmVzdW1lOiByZWNvbm5lY3QgYW5kIHJ1biBhIGZ1bGwgY2F0Y2gtdXAgY3ljbGUgKHN0YXJ0dXAgcmVjb25jaWxpYXRpb24pLiAqL1xuICBhc3luYyByZXN1bWVTeW5jaW5nKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghdGhpcy5saW5rZWQgfHwgIXRoaXMucGF1c2VkKSByZXR1cm47XG4gICAgdGhpcy5wYXVzZWQgPSBmYWxzZTtcbiAgICBuZXcgTm90aWNlKCdWYXVsdFN5bmM6IHJlc3VtaW5nIFx1MjAxNCBydW5uaW5nIGEgZnVsbCBjYXRjaC11cCBzeW5jXHUyMDI2Jyk7XG4gICAgYXdhaXQgdGhpcy5zdGFydFN5bmMoKTtcbiAgfVxuXG4gIC8qKiBSdW50aW1lIHBhdXNlIHN0YXRlICh0aGUgc2V0dGluZ3MgdGFiJ3MgYnV0dG9uIGxhYmVsICsgZGlhZ25vc3RpY3MpLiAqL1xuICBnZXQgc3luY2luZ1BhdXNlZCgpOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy5wYXVzZWQ7XG4gIH1cblxuICBhc3luYyBhcHBseVJlc2NhbkludGVydmFsKHNlY29uZHM6IG51bWJlcik6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuZGF0YS5zZXR0aW5ncy5yZXNjYW5JbnRlcnZhbFNlYyA9IE1hdGgubWF4KDAsIE1hdGguZmxvb3Ioc2Vjb25kcykpO1xuICAgIGF3YWl0IHRoaXMuc2F2ZVBsdWdpbkRhdGEoKTtcbiAgICB0aGlzLnJlc2Nhbj8uc2V0SW50ZXJ2YWxNcyh0aGlzLmRhdGEuc2V0dGluZ3MucmVzY2FuSW50ZXJ2YWxTZWMgKiAxMDAwKTtcbiAgfVxuXG4gIGFzeW5jIGFwcGx5T2JzaWRpYW5TeW5jKGVuYWJsZWQ6IGJvb2xlYW4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLmRhdGEuc2V0dGluZ3Mub2JzaWRpYW5TeW5jID0gZW5hYmxlZDtcbiAgICBhd2FpdCB0aGlzLnNhdmVQbHVnaW5EYXRhKCk7XG4gICAgbmV3IE5vdGljZShcbiAgICAgIGVuYWJsZWRcbiAgICAgICAgPyAnVmF1bHRTeW5jOiAub2JzaWRpYW4vIHdpbGwgc3luYyBhZnRlciB0aGUgbmV4dCByZWNvbm5lY3QgKHRoZSB3b3JrZXJcXHUyMDE5cyBwZXItdmF1bHQgc2V0dGluZyB0YWtlcyBwcmVjZWRlbmNlKS4nXG4gICAgICAgIDogJ1ZhdWx0U3luYzogLm9ic2lkaWFuLyB3aWxsIGJlIGV4Y2x1ZGVkIGFmdGVyIHRoZSBuZXh0IHJlY29ubmVjdC4nLFxuICAgICk7XG4gIH1cblxuICBhc3luYyBhcHBseVN0YXR1c0Jhck1vZGUobW9kZTogU3RhdHVzQmFyTW9kZSk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuZGF0YS5zZXR0aW5ncy5zdGF0dXNCYXJNb2RlID0gbW9kZTtcbiAgICBhd2FpdCB0aGlzLnNhdmVQbHVnaW5EYXRhKCk7XG4gICAgdGhpcy5tb3VudFN0YXR1c0JhcigpOyAvLyByZS1tb3VudHMgKG9yIHJlbW92ZXMpIHRoZSBpdGVtIHBlciB0aGUgbW9kZVxuICAgIHRoaXMub25UaWNrKCk7XG4gIH1cblxuICBhc3luYyBhcHBseVN5bmNPblN0YXJ0dXAoZW5hYmxlZDogYm9vbGVhbik6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuZGF0YS5zZXR0aW5ncy5zeW5jT25TdGFydHVwID0gZW5hYmxlZDtcbiAgICBhd2FpdCB0aGlzLnNhdmVQbHVnaW5EYXRhKCk7XG4gICAgbmV3IE5vdGljZShcbiAgICAgIGVuYWJsZWRcbiAgICAgICAgPyAnVmF1bHRTeW5jOiBzeW5jaW5nIHdpbGwgc3RhcnQgYXV0b21hdGljYWxseSB0aGUgbmV4dCB0aW1lIE9ic2lkaWFuIG9wZW5zLidcbiAgICAgICAgOiAnVmF1bHRTeW5jOiBvbiB0aGUgbmV4dCBsYXVuY2ggdGhpcyBwbHVnaW4gc3RheXMgaWRsZSB1bnRpbCB5b3UgcHJlc3MgXHUyMDFDU3luYyBub3dcdTIwMUQuJyxcbiAgICApO1xuICB9XG5cbiAgYXN5bmMgYXBwbHlMb2dMZXZlbChsZXZlbDogTG9nTGV2ZWwpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLmRhdGEuc2V0dGluZ3MubG9nTGV2ZWwgPSBsZXZlbDtcbiAgICBhd2FpdCB0aGlzLnNhdmVQbHVnaW5EYXRhKCk7XG4gICAgdGhpcy5zeW5jTG9nLnNldExldmVsKGxldmVsKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBOZXcgaWdub3JlIHBhdHRlcm5zOiBwZXJzaXN0LCB0aGVuIHJlc3RhcnQgdGhlIHN5bmMgbWFjaGluZXJ5IHdoaWxlIGxpdmVcbiAgICogc28gdGhlIHNjYW4vd2F0Y2hlciBwaWNrIHRoZW0gdXAgaW1tZWRpYXRlbHkgKGEgcGF1c2VkIHNlc3Npb24gYXBwbGllc1xuICAgKiB0aGVtIG9uIHJlc3VtZSBcdTIwMTQgcmVzdW1lIGFsd2F5cyByZWJ1aWxkcyB0aGUgY2xpZW50KS5cbiAgICovXG4gIGFzeW5jIGFwcGx5SWdub3JlUGF0dGVybnModGV4dDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5kYXRhLnNldHRpbmdzLmlnbm9yZVBhdHRlcm5zID0gdGV4dDtcbiAgICBhd2FpdCB0aGlzLnNhdmVQbHVnaW5EYXRhKCk7XG4gICAgaWYgKHRoaXMuY2xpZW50ICE9PSBudWxsICYmICF0aGlzLnBhdXNlZCkgYXdhaXQgdGhpcy5zdGFydFN5bmMoKTtcbiAgfVxuXG4gIC8qKiBTdG9yYWdlL2F0dGFjaG1lbnQgc3VtbWFyeSBmb3IgdGhlIEFib3V0IHNlY3Rpb24gKG51bGwgPSB1bmF2YWlsYWJsZSkuICovXG4gIGFzeW5jIGZldGNoU3RvcmFnZVN1bW1hcnkoKTogUHJvbWlzZTxXb3JrZXJTdGF0dXNTdW1tYXJ5IHwgbnVsbD4ge1xuICAgIGlmICghdGhpcy5saW5rZWQpIHJldHVybiBudWxsO1xuICAgIHJldHVybiBmZXRjaFdvcmtlclN0YXR1cyh7XG4gICAgICBvcmlnaW46IHRoaXMuZGF0YS51cmwsXG4gICAgICB0b2tlbjogdGhpcy5kYXRhLnRva2VuLFxuICAgICAgZmV0Y2hJbXBsOiB0aGlzLmZldGNoSW1wbCxcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBUaGUgc2hhcmVkIHNuYXBzaG90IGJlaGluZCBcIkNvcHkgZGlhZ25vc3RpY3NcIiBhbmQgXCJTYXZlIHN1cHBvcnQgYnVuZGxlXCIuXG4gICAqIFN0cnVjdHVyYWxseSByZWRhY3RlZDogdGhlIGRldmljZSB0b2tlbiBuZXZlciBlbnRlcnMgKGl0IGxpdmVzIG9ubHkgaW5cbiAgICogYHRoaXMuZGF0YWApLCBhbmQgY29uZmxpY3RzIGNvbnRyaWJ1dGUgcGF0aHMgb25seSBcdTIwMTQgbmV2ZXIgZmlsZSBjb250ZW50LlxuICAgKi9cbiAgcHJpdmF0ZSBjb2xsZWN0RGlhZ25vc3RpY3NJbnB1dCgpOiBEaWFnbm9zdGljc0lucHV0IHtcbiAgICBjb25zdCBzdGF0dXMgPSB0aGlzLmNsaWVudD8uc3RhdHVzKCkgPz8gbnVsbDtcbiAgICByZXR1cm4ge1xuICAgICAgcGx1Z2luVmVyc2lvbjogdGhpcy5tYW5pZmVzdC52ZXJzaW9uIHx8ICd1bmtub3duJyxcbiAgICAgIGRldmljZUlkOiB0aGlzLmRhdGEuZGV2aWNlSWQsXG4gICAgICBkZXZpY2VOYW1lOiB0aGlzLnJlc29sdmVEZXZpY2VOYW1lKCksXG4gICAgICB3b3JrZXJVcmw6IHRoaXMuZGF0YS51cmwsXG4gICAgICBwYWlyZWQ6IHRoaXMubGlua2VkLFxuICAgICAgcGF1c2VkOiB0aGlzLnBhdXNlZCxcbiAgICAgIGNsaWVudFN0YXR1czogc3RhdHVzLFxuICAgICAgcmVjZW50TG9nTGluZXM6IHRoaXMuc3luY0xvZy5yZWNlbnRMaW5lcygpLFxuICAgICAgc2VydmVyVmVyc2lvbjogc3RhdHVzPy5zZXJ2ZXJWZXJzaW9uID8/IG51bGwsXG4gICAgICBzZXR0aW5nczogdGhpcy5kYXRhLnNldHRpbmdzLFxuICAgICAgcmVjZW50Q29uZmxpY3RzOiBzdGF0dXMgPT09IG51bGwgPyBbXSA6IHN0YXR1cy5jb25mbGljdHMubWFwKChjb25mbGljdCkgPT4gKHsgcGF0aDogY29uZmxpY3QucGF0aCB9KSksXG4gICAgfTtcbiAgfVxuXG4gIC8qKiBDb3B5IHRoZSBkaWFnbm9zdGljcyBidW5kbGUgdG8gdGhlIGNsaXBib2FyZCAoZmFsbGJhY2s6IGNvbnNvbGUpLiAqL1xuICBhc3luYyBjb3B5RGlhZ25vc3RpY3MoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgYnVuZGxlID0gYnVpbGREaWFnbm9zdGljc0J1bmRsZSh0aGlzLmNvbGxlY3REaWFnbm9zdGljc0lucHV0KCkpO1xuICAgIGNvbnN0IGNvcGllZCA9IGF3YWl0IGNvcHlUb0NsaXBib2FyZChidW5kbGUpO1xuICAgIGlmIChjb3BpZWQpIHtcbiAgICAgIG5ldyBOb3RpY2UoJ1ZhdWx0U3luYzogZGlhZ25vc3RpY3MgY29waWVkIHRvIHRoZSBjbGlwYm9hcmQuJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnNvbGUuaW5mbygnW3ZzYV0gZGlhZ25vc3RpY3MgKGNsaXBib2FyZCB1bmF2YWlsYWJsZSk6XFxuJyArIGJ1bmRsZSk7XG4gICAgbmV3IE5vdGljZSgnVmF1bHRTeW5jOiBjbGlwYm9hcmQgdW5hdmFpbGFibGUgXHUyMDE0IGRpYWdub3N0aWNzIHdyaXR0ZW4gdG8gdGhlIGRldmVsb3BlciBjb25zb2xlLicsIDEwMDAwKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBXcml0ZSB0aGUgc3VwcG9ydCBidW5kbGUgKG1hcmtkb3duKSBpbnRvIGAudmF1bHRzeW5jZm9yYWdlbnRzL2AgaW4gdGhlXG4gICAqIHZhdWx0IFx1MjAxNCB0aGUgcmljaGVyLCBhdHRhY2hhYmxlIHNpYmxpbmcgb2YgXCJDb3B5IGRpYWdub3N0aWNzXCIuXG4gICAqL1xuICBhc3luYyBzYXZlU3VwcG9ydEJ1bmRsZSgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBub3cgPSB0aGlzLm5vdygpO1xuICAgIGNvbnN0IG1hcmtkb3duID0gYnVpbGRTdXBwb3J0QnVuZGxlKHRoaXMuY29sbGVjdERpYWdub3N0aWNzSW5wdXQoKSwgbm93KTtcbiAgICBjb25zdCBmaWxlTmFtZSA9IGBzdXBwb3J0LWJ1bmRsZS0ke2Zvcm1hdFN1cHBvcnRCdW5kbGVTdGFtcChub3cpfS5tZGA7XG4gICAgY29uc3QgdmF1bHRQYXRoID0gYCR7U1VQUE9SVF9CVU5ETEVfRElSX1ZBVUxUX1BBVEh9LyR7ZmlsZU5hbWV9YDtcbiAgICB0cnkge1xuICAgICAgLy8gVGhlIHN0b3JhZ2UgYWRhcHRlciBta2RpcnMgdGhlIHN0YXRlIGRpciBvbiBkZW1hbmQgKGl0IGNhbiBiZSBhYnNlbnRcbiAgICAgIC8vIGJlZm9yZSB0aGUgZmlyc3Qgc3luYykgYW5kIGZhbGxzIGJhY2sgdG8gYSBwbGFpbiB3cml0ZSB3aGVyZSB0aGVcbiAgICAgIC8vIGFkYXB0ZXIgY2Fubm90IHJlbmFtZS5cbiAgICAgIGF3YWl0IHRoaXMuY3JlYXRlU3RvcmFnZUFkYXB0ZXIoKS53cml0ZUZpbGUodmF1bHRQYXRoLCBuZXcgVGV4dEVuY29kZXIoKS5lbmNvZGUobWFya2Rvd24pKTtcbiAgICAgIG5ldyBOb3RpY2UoYFZhdWx0U3luYzogc3VwcG9ydCBidW5kbGUgc2F2ZWQgdG8gJHt2YXVsdFBhdGguc2xpY2UoMSl9LmApO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLnN5bmNMb2cud2FybignZmFpbGVkIHRvIHdyaXRlIHN1cHBvcnQgYnVuZGxlJywgZXJyb3IpO1xuICAgICAgbmV3IE5vdGljZSgnVmF1bHRTeW5jOiBjb3VsZCBub3Qgd3JpdGUgdGhlIHN1cHBvcnQgYnVuZGxlIFx1MjAxNCBzZWUgdGhlIGRldmVsb3BlciBjb25zb2xlLicsIDEwMDAwKTtcbiAgICB9XG4gIH1cblxuICAvKiogVGhlIHBsYXRmb3JtIGxpbmUgZm9yIHRoZSBBYm91dC9kaWFnbm9zdGljcyByZWFkb3V0cy4gKi9cbiAgcGxhdGZvcm1TdW1tYXJ5KCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHBsYXRmb3JtU3VtbWFyeSgpO1xuICB9XG5cbiAgYXN5bmMgdW5saW5rKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuc3RvcFN5bmMoKTtcbiAgICB0aGlzLnBhdXNlZCA9IGZhbHNlO1xuICAgIC8vIENsZWFyIGxvY2FsIHN5bmMgc3RhdGUgKGRldmljZSBtYXJrZXIgKyBpbmRleCkgc28gYSBmdXR1cmUgY2xpZW50IFx1MjAxNFxuICAgIC8vIHRoaXMgcGx1Z2luIGFmdGVyIGEgcmUtcGFpciwgdGhlIGRhZW1vbiwgdGhlIENMSSBcdTIwMTQgc3RhcnRzIGNsZWFuXG4gICAgLy8gKEZSLTQ0OiBzdGFsZSBzdGF0ZSB3b3VsZCBtYWtlIGl0IHJlZnVzZSBvciBtaXMtc3luYykuXG4gICAgY29uc3Qgc3RvcmFnZSA9IHRoaXMuY3JlYXRlU3RvcmFnZUFkYXB0ZXIoKTtcbiAgICBhd2FpdCBzdG9yYWdlLmRlbGV0ZUZpbGUoREVWSUNFX01BUktFUl9WQVVMVF9QQVRIKTtcbiAgICBhd2FpdCBzdG9yYWdlLmRlbGV0ZUZpbGUoTE9DQUxfSU5ERVhfVkFVTFRfUEFUSCk7XG4gICAgdGhpcy5kYXRhID0ge1xuICAgICAgLi4uZGVmYXVsdFBsdWdpbkRhdGEoKSxcbiAgICAgIGRldmljZU5hbWU6IHRoaXMuZGF0YS5kZXZpY2VOYW1lLFxuICAgICAgc2V0dGluZ3M6IHRoaXMuZGF0YS5zZXR0aW5ncyxcbiAgICB9O1xuICAgIGF3YWl0IHRoaXMuc2F2ZVBsdWdpbkRhdGEoKTtcbiAgICBuZXcgTm90aWNlKFxuICAgICAgJ1ZhdWx0U3luYzogdW5saW5rZWQuIFJldm9rZSB0aGlzIGRldmljZSBmcm9tIHRoZSB3b3JrZXIgZGFzaGJvYXJkIGlmIHlvdSBhcmUgZG9uZSB3aXRoIGl0LicsXG4gICAgKTtcbiAgfVxuXG4gIC8vIC0tLSBzdXBlcnZpc2lvbiAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIHByaXZhdGUgb25UaWNrKCk6IHZvaWQge1xuICAgIGNvbnN0IGNsaWVudCA9IHRoaXMuY2xpZW50O1xuICAgIGlmIChjbGllbnQgPT09IG51bGwpIHJldHVybjtcbiAgICBjb25zdCBzdGF0dXMgPSBjbGllbnQuc3RhdHVzKCk7XG4gICAgdGhpcy5hc3Nlc3NTZXJ2ZXJWZXJzaW9uKHN0YXR1cyk7XG4gICAgdGhpcy5zdGF0dXNCYXI/LnVwZGF0ZShcbiAgICAgIHN0YXR1cyxcbiAgICAgIHtcbiAgICAgICAgdXJsOiB0aGlzLmRhdGEudXJsLFxuICAgICAgICBkZXZpY2VOYW1lOiB0aGlzLnJlc29sdmVEZXZpY2VOYW1lKCksXG4gICAgICAgIC8vIEJvdGggbm90ZXMgY2FuIGJlIGxpdmUgYXQgb25jZSAoYW4gYXV0aC1mYWlsdXJlIG5vdGUgd2hpbGUgdGhlXG4gICAgICAgIC8vIHNlcnZlciBhbHNvIHJlcG9ydHMgdmVyc2lvbiBza2V3KTogY29uY2F0ZW5hdGUgaW5zdGVhZCBvZiBsZXR0aW5nXG4gICAgICAgIC8vIGVpdGhlciBoaWRlIHRoZSBvdGhlcjsgZW1wdHkgcGFydHMgZHJvcCBvdXQuXG4gICAgICAgIG5vdGU6IFt0aGlzLnN0YXR1c05vdGUsIHRoaXMuc2VydmVyQ29tcGF0Tm90ZV0uZmlsdGVyKChwYXJ0KSA9PiBwYXJ0ICE9PSAnJykuam9pbignIFx1MDBCNyAnKSxcbiAgICAgICAgcGF1c2VkOiB0aGlzLnBhdXNlZCxcbiAgICAgICAgbW9kZTogdGhpcy5kYXRhLnNldHRpbmdzLnN0YXR1c0Jhck1vZGUsXG4gICAgICB9LFxuICAgICAgdGhpcy5ub3coKSxcbiAgICApO1xuICAgIGlmICh0aGlzLnBhdXNlZCB8fCB0aGlzLmF1dGhGYWlsZWQpIHJldHVybjsgLy8gbm8gcmVjb25uZWN0IHdoaWxlIHBhdXNlZCAvIHRva2VuIHJlamVjdGVkXG4gICAgY29uc3QgZGVjaXNpb24gPSB0aGlzLnN1cGVydmlzb3IuY29uc2lkZXIoc3RhdHVzLnN0YXRlKTtcbiAgICBpZiAoZGVjaXNpb24uYWN0aW9uID09PSAnd2FpdCcpIHJldHVybjtcbiAgICB0aGlzLnN1cGVydmlzb3IuYWNrbm93bGVkZ2VkKCk7XG4gICAgdGhpcy5zY2hlZHVsZVJlY29ubmVjdChkZWNpc2lvbi5kZWxheU1zKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBMYXRlc3Qgc2VydmVyLXZlcnNpb24gdmVyZGljdCBmb3IgdGhlIHNldHRpbmdzIHRhYjsgbnVsbCB1bnRpbCB0aGUgZmlyc3RcbiAgICogaGVsbG9BY2sgb2YgdGhlIGN1cnJlbnQgc3luYyBzZXNzaW9uLlxuICAgKi9cbiAgZ2V0IHNlcnZlckNvbXBhdGliaWxpdHkoKTogQ29tcGF0aWJpbGl0eVZlcmRpY3QgfCBudWxsIHtcbiAgICByZXR1cm4gdGhpcy5zZXJ2ZXJDb21wYXQ7XG4gIH1cblxuICAvKiogVGhlIHZlcmRpY3QncyB0b29sdGlwIGxpbmUgKCcnIHdoZW4gY29tcGF0aWJsZSBcdTIwMTQgbm90aGluZyB0byBuYWcgYWJvdXQpLiAqL1xuICBwcml2YXRlIGdldCBzZXJ2ZXJDb21wYXROb3RlKCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHRoaXMuc2VydmVyQ29tcGF0ICE9PSBudWxsICYmIHRoaXMuc2VydmVyQ29tcGF0LmxldmVsICE9PSAnb2snXG4gICAgICA/IHRoaXMuc2VydmVyQ29tcGF0Lm1lc3NhZ2VcbiAgICAgIDogJyc7XG4gIH1cblxuICAvKipcbiAgICogVmVyc2lvbi1za2V3IGFzc2Vzc21lbnQsIHJ1biBieSB0aGUgdGljayBvbmNlIHRoZSBjb25uZWN0aW9uIGhhcyBhY2tlZFxuICAgKiAoc3RhdGVzICdzeW5jaW5nJy8nbGl2ZScgYm90aCBmb2xsb3cgdGhlIGhlbGxvQWNrOyBwcmUtYWNrIHN0YXRlcyByZWFkXG4gICAqIHNlcnZlclZlcnNpb24gbnVsbCBmb3IgXCJub3QgeWV0IGtub3duXCIgYW5kIG11c3Qgbm90IHByb2R1Y2UgYSBzcHVyaW91c1xuICAgKiBcImxlZ2FjeSBzZXJ2ZXJcIiB2ZXJkaWN0KS4gTmV2ZXIga2lsbHMgc3luYzogdGhlIHdpcmUgYFByb3RvY29sVmVyc2lvbmBcbiAgICogY2hlY2sgYXQgaGVsbG8gcmVtYWlucyB0aGUgaGFyZCBnYXRlOyBhIHZlcmRpY3QgaXMgYWR2aXNvcnkuXG4gICAqL1xuICBwcml2YXRlIGFzc2Vzc1NlcnZlclZlcnNpb24oc3RhdHVzOiBTeW5jQ2xpZW50U3RhdHVzKTogdm9pZCB7XG4gICAgaWYgKHN0YXR1cy5zdGF0ZSAhPT0gJ3N5bmNpbmcnICYmIHN0YXR1cy5zdGF0ZSAhPT0gJ2xpdmUnKSByZXR1cm47XG4gICAgY29uc3QgdmVyZGljdCA9IGNoZWNrU2VydmVyQ29tcGF0aWJpbGl0eSh0aGlzLm1hbmlmZXN0LnZlcnNpb24gfHwgJ3Vua25vd24nLCBzdGF0dXMuc2VydmVyVmVyc2lvbik7XG4gICAgdGhpcy5zZXJ2ZXJDb21wYXQgPSB2ZXJkaWN0O1xuICAgIGlmICh2ZXJkaWN0LmxldmVsID09PSAnb2snKSByZXR1cm47IC8vIGFsc28gY2xlYXJzIGFueSBzdGFsZSB0b29sdGlwIG5vdGVcbiAgICBpZiAodGhpcy5zZXJ2ZXJDb21wYXROb3RpZmllZCkgcmV0dXJuOyAvLyBvbmUgTm90aWNlIHBlciBwbHVnaW4gc2Vzc2lvblxuICAgIHRoaXMuc2VydmVyQ29tcGF0Tm90aWZpZWQgPSB0cnVlO1xuICAgIG5ldyBOb3RpY2UoYFZhdWx0U3luYzogJHt2ZXJkaWN0Lm1lc3NhZ2V9YCwgMTAwMDApO1xuICB9XG5cbiAgcHJpdmF0ZSBzY2hlZHVsZVJlY29ubmVjdChkZWxheU1zOiBudW1iZXIpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5yZWNvbm5lY3RUaW1lciAhPT0gbnVsbCkgcmV0dXJuOyAvLyBvbmUgaW4gZmxpZ2h0LCBhbHdheXNcbiAgICB0aGlzLnJlY29ubmVjdFRpbWVyID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICB0aGlzLnJlY29ubmVjdFRpbWVyID0gbnVsbDtcbiAgICAgIGNvbnN0IGNsaWVudCA9IHRoaXMuY2xpZW50O1xuICAgICAgaWYgKGNsaWVudCA9PT0gbnVsbCkge1xuICAgICAgICB0aGlzLnN1cGVydmlzb3Iuc2V0dGxlZCgpO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICBjbGllbnRcbiAgICAgICAgLnJlY29ubmVjdCgpXG4gICAgICAgIC50aGVuKFxuICAgICAgICAgICgpID0+IHtcbiAgICAgICAgICAgIHRoaXMuc3VwZXJ2aXNvci5zZXR0bGVkKCk7XG4gICAgICAgICAgfSxcbiAgICAgICAgICAoZXJyb3I6IHVua25vd24pID0+IHtcbiAgICAgICAgICAgIHRoaXMuc3VwZXJ2aXNvci5zZXR0bGVkKCk7XG4gICAgICAgICAgICB0aGlzLmhhbmRsZVN5bmNFcnJvcihlcnJvciwgJ3JlY29ubmVjdCBmYWlsZWQnKTtcbiAgICAgICAgICB9LFxuICAgICAgICApXG4gICAgICAgIC5jYXRjaCgoKSA9PiB7fSk7IC8vIGhhbmRsZVN5bmNFcnJvciBuZXZlciB0aHJvd3M7IGJlbHQgYW5kIGJyYWNlc1xuICAgIH0sIGRlbGF5TXMpO1xuICB9XG5cbiAgLyoqIERpc3Rpbmd1aXNoIGZhdGFsIGF1dGggZmFpbHVyZXMgZnJvbSB0cmFuc2llbnQgbmV0d29yayB0cm91YmxlLiAqL1xuICBwcml2YXRlIGhhbmRsZVN5bmNFcnJvcihlcnJvcjogdW5rbm93biwgY29udGV4dDogc3RyaW5nKTogdm9pZCB7XG4gICAgaWYgKGVycm9yIGluc3RhbmNlb2YgUmV2b2tlZEVycm9yIHx8IGVycm9yIGluc3RhbmNlb2YgVW5hdXRob3JpemVkRXJyb3IpIHtcbiAgICAgIHRoaXMuYXV0aEZhaWxlZCA9IHRydWU7XG4gICAgICB0aGlzLnN0YXR1c05vdGUgPSAnRGV2aWNlIHRva2VuIHJlamVjdGVkIFx1MjAxNCB1bmxpbmsgYW5kIHJlLXBhaXIgd2l0aCBhIGZyZXNoIGNvZGUuJztcbiAgICAgIHRoaXMuc3luY0xvZy5lcnJvcihjb250ZXh0LCBlcnJvcik7XG4gICAgICBuZXcgTm90aWNlKFxuICAgICAgICAnVmF1bHRTeW5jOiB0aGUgd29ya2VyIHJlamVjdGVkIHRoaXMgZGV2aWNlXFx1MjAxOXMgdG9rZW4gKHJldm9rZWQ/KS4gVW5saW5rIGFuZCByZS1wYWlyIGZyb20gc2V0dGluZ3MuJyxcbiAgICAgICAgMTAwMDAsXG4gICAgICApO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLnN5bmNMb2cud2Fybihjb250ZXh0LCBlcnJvcik7IC8vIG9mZmxpbmUvcHJvdG9jb2w6IGJhY2tvZmYga2VlcHMgcmV0cnlpbmdcbiAgfVxuXG4gIC8qKiBGUi00NDogd2FybiB3aGVuIHRoZSB2YXVsdCdzIHN0YXRlIGRpciBiZWxvbmdzIHRvIGFub3RoZXIgY2xpZW50LiAqL1xuICBwcml2YXRlIGFzeW5jIHdhcm5JZkZvcmVpZ25TdGF0ZURpcihzdG9yYWdlOiBPYnNpZGlhblN0b3JhZ2VBZGFwdGVyKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgbGV0IG1hcmtlcjogeyBkZXZpY2VJZD86IHVua25vd247IGRldmljZU5hbWU/OiB1bmtub3duOyB1cmw/OiB1bmtub3duIH07XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGJ5dGVzID0gYXdhaXQgc3RvcmFnZS5yZWFkRmlsZShERVZJQ0VfTUFSS0VSX1ZBVUxUX1BBVEgpO1xuICAgICAgbWFya2VyID0gSlNPTi5wYXJzZShuZXcgVGV4dERlY29kZXIoKS5kZWNvZGUoYnl0ZXMpKSBhcyB0eXBlb2YgbWFya2VyO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuOyAvLyBubyBtYXJrZXIgKG9yIHVucmVhZGFibGUpIFx1MjAxNCBub3RoaW5nIHRvIHdhcm4gYWJvdXRcbiAgICB9XG4gICAgaWYgKFxuICAgICAgdHlwZW9mIG1hcmtlci5kZXZpY2VJZCA9PT0gJ3N0cmluZycgJiZcbiAgICAgIG1hcmtlci5kZXZpY2VJZCAhPT0gdGhpcy5kYXRhLmRldmljZUlkXG4gICAgKSB7XG4gICAgICBjb25zdCBuYW1lID0gdHlwZW9mIG1hcmtlci5kZXZpY2VOYW1lID09PSAnc3RyaW5nJyA/IG1hcmtlci5kZXZpY2VOYW1lIDogbWFya2VyLmRldmljZUlkO1xuICAgICAgY29uc3Qgd2hlcmUgPSB0eXBlb2YgbWFya2VyLnVybCA9PT0gJ3N0cmluZycgPyBtYXJrZXIudXJsIDogJ2Egd29ya2VyJztcbiAgICAgIG5ldyBOb3RpY2UoXG4gICAgICAgIGBWYXVsdFN5bmM6IHRoaXMgdmF1bHQgYWxyZWFkeSBoYXMgc3luYyBzdGF0ZSBmb3IgZGV2aWNlIFwiJHtuYW1lfVwiIChsaW5rZWQgdG8gJHt3aGVyZX0pLiBgICtcbiAgICAgICAgICAnT25lIHN5bmMgY2xpZW50IHBlciBtYWNoaW5lIHBlciB2YXVsdCBcdTIwMTQgcnVubmluZyB0d28gZG91YmxlLWNvbW1pdHMgZXZlcnkgY2hhbmdlLiAnICtcbiAgICAgICAgICAnVW5saW5rIHRoZSBvdGhlciBjbGllbnQgKG9yIGNsZWFyIC52YXVsdHN5bmNmb3JhZ2VudHMvKSBpZiB0aGlzIGlzIHVuZXhwZWN0ZWQuJyxcbiAgICAgICAgMTUwMDAsXG4gICAgICApO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBub3JtYWxpemVXb3JrZXJVcmxTYWZlKGlucHV0OiBzdHJpbmcpOiBzdHJpbmcge1xuICB0cnkge1xuICAgIHJldHVybiBub3JtYWxpemVXb3JrZXJVcmwoaW5wdXQpO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gaW5wdXQ7XG4gIH1cbn1cbiIsICIvKipcbiAqIFZhdWx0IHBhdGggdXRpbGl0aWVzLlxuICpcbiAqIFZhdWx0LWludGVybmFsIHBhdGhzIGFyZSBQT1NJWC1ub3JtYWxpemVkIHN0cmluZ3MgcmVsYXRpdmUgdG8gdGhlIHZhdWx0IHJvb3Q6XG4gKiAgIC0gYWx3YXlzIHN0YXJ0IHdpdGggYC9gIChgL2EvYi5tZGApOyB0aGUgdmF1bHQgcm9vdCBpdHNlbGYgaXMgYC9gXG4gKiAgIC0gc2VnbWVudHMgc2VwYXJhdGVkIGJ5IGAvYDsgbm8gdHJhaWxpbmcgc2xhc2gsIG5vIGAuYC9gLi5gIHNlZ21lbnRzLFxuICogICAgIG5vIGR1cGxpY2F0ZSBzbGFzaGVzXG4gKiAgIC0gbmV2ZXIgZXNjYXBlIHRoZSByb290OiBhbnkgYC4uYCB0aGF0IHdvdWxkIHBvcCBhYm92ZSBgL2AgaXMgcmVqZWN0ZWRcbiAqXG4gKiBCYWNrc2xhc2hlcyBhcmUgY29udmVydGVkIHRvIGAvYCAoV2luZG93cyBjYWxsZXJzIHJvdXRpbmVseSBoYW5kIHVzXG4gKiBgZGlyXFxmaWxlLm1kYCksIGJ1dCBhYnNvbHV0ZSBXaW5kb3dzIHBhdGhzIChkcml2ZSBsZXR0ZXJzIGxpa2UgYEM6L2AsIFVOQ1xuICogYFxcXFxzZXJ2ZXJcXHNoYXJlYCkgYXJlIHJlamVjdGVkIFx1MjAxNCBhIHZhdWx0IHBhdGggaXMgbmV2ZXIgYWJzb2x1dGUgaW4gdGhlIGhvc3RcbiAqIGZpbGVzeXN0ZW0gc2Vuc2UuXG4gKi9cblxuLyoqIEEgdmF1bHQtaW50ZXJuYWwsIFBPU0lYLW5vcm1hbGl6ZWQgcGF0aCBzdHJpbmcgKGUuZy4gYC9ub3Rlcy90b2RvLm1kYCkuICovXG5leHBvcnQgdHlwZSBWYXVsdFBhdGggPSBzdHJpbmc7XG5cbi8qKiBUaHJvd24gd2hlbiBhIHBhdGggY2Fubm90IGJlIGludGVycHJldGVkIGFzIGEgdmF1bHQtaW50ZXJuYWwgcGF0aC4gKi9cbmV4cG9ydCBjbGFzcyBJbnZhbGlkVmF1bHRQYXRoRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIGNvbnN0cnVjdG9yKG1lc3NhZ2U6IHN0cmluZykge1xuICAgIHN1cGVyKG1lc3NhZ2UpO1xuICAgIHRoaXMubmFtZSA9ICdJbnZhbGlkVmF1bHRQYXRoRXJyb3InO1xuICB9XG59XG5cbi8qKlxuICogTm9ybWFsaXplIGEgdXNlci0gb3IgcGxhdGZvcm0tc3VwcGxpZWQgcGF0aCBpbnRvIGNhbm9uaWNhbCB2YXVsdCBmb3JtLlxuICpcbiAqIEFjY2VwdGVkOiBgYS9iLm1kYCAocm9vdC1yZWxhdGl2ZSB3aXRob3V0IGxlYWRpbmcgc2xhc2gpLCBgL2EvYi5tZGAsXG4gKiBgYVxcYi5tZGAgKGJhY2tzbGFzaCBjb252ZXJzaW9uKSwgYGEvLi9iLm1kYCwgYGEvYi8uLi9jLm1kYCAoaW50ZXJpb3IgYC4uYFxuICogcmVzb2x2ZXMpLCBkdXBsaWNhdGUgc2xhc2hlcywgdHJhaWxpbmcgc2xhc2hlcy5cbiAqXG4gKiBSZWplY3RlZDogYC4uYCBlc2NhcGluZyB0aGUgcm9vdCAoYC8uLi9hYCwgYC9hLy4uLy4uYCksIGFic29sdXRlIFdpbmRvd3NcbiAqIGRyaXZlIHBhdGhzIChgQzovdmF1bHQvYS5tZGAsIGBDOlxcdmF1bHRcXGEubWRgKSwgVU5DIHBhdGhzIChgXFxcXHNydlxcc2hhcmVgKSxcbiAqIGxlYWRpbmcgYC8vYCwgTlVMIGJ5dGVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplVmF1bHRQYXRoKGlucHV0OiBzdHJpbmcpOiBWYXVsdFBhdGgge1xuICBpZiAodHlwZW9mIGlucHV0ICE9PSAnc3RyaW5nJykge1xuICAgIHRocm93IG5ldyBJbnZhbGlkVmF1bHRQYXRoRXJyb3IoYFZhdWx0IHBhdGggbXVzdCBiZSBhIHN0cmluZywgZ290ICR7dHlwZW9mIGlucHV0fWApO1xuICB9XG4gIGlmIChpbnB1dC5pbmNsdWRlcygnXFwwJykpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZFZhdWx0UGF0aEVycm9yKGBWYXVsdCBwYXRoIGNvbnRhaW5zIE5VTCBieXRlOiAke0pTT04uc3RyaW5naWZ5KGlucHV0KX1gKTtcbiAgfVxuICBpZiAoL15bYS16QS1aXTovLnRlc3QoaW5wdXQpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRWYXVsdFBhdGhFcnJvcihcbiAgICAgIGBWYXVsdCBwYXRoIG11c3Qgbm90IGJlIGFuIGFic29sdXRlIGhvc3QgcGF0aCAoZHJpdmUgbGV0dGVyKTogJHtKU09OLnN0cmluZ2lmeShpbnB1dCl9YCxcbiAgICApO1xuICB9XG4gIGlmIChpbnB1dC5zdGFydHNXaXRoKCdcXFxcXFxcXCcpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRWYXVsdFBhdGhFcnJvcihcbiAgICAgIGBWYXVsdCBwYXRoIG11c3Qgbm90IGJlIGEgVU5DIHBhdGg6ICR7SlNPTi5zdHJpbmdpZnkoaW5wdXQpfWAsXG4gICAgKTtcbiAgfVxuXG4gIGNvbnN0IGNvbnZlcnRlZCA9IGlucHV0LnJlcGxhY2UoL1xcXFwvZywgJy8nKTtcbiAgaWYgKGNvbnZlcnRlZC5zdGFydHNXaXRoKCcvLycpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRWYXVsdFBhdGhFcnJvcihcbiAgICAgIGBWYXVsdCBwYXRoIG11c3Qgbm90IHN0YXJ0IHdpdGggXCIvL1wiIChVTkMgb3IgcHJvdG9jb2wtc3R5bGUgcGF0aCk6ICR7SlNPTi5zdHJpbmdpZnkoaW5wdXQpfWAsXG4gICAgKTtcbiAgfVxuXG4gIGNvbnN0IHNlZ21lbnRzOiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGNvbnN0IHNlZ21lbnQgb2YgY29udmVydGVkLnNwbGl0KCcvJykpIHtcbiAgICBpZiAoc2VnbWVudCA9PT0gJycgfHwgc2VnbWVudCA9PT0gJy4nKSBjb250aW51ZTtcbiAgICBpZiAoc2VnbWVudCA9PT0gJy4uJykge1xuICAgICAgaWYgKHNlZ21lbnRzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICB0aHJvdyBuZXcgSW52YWxpZFZhdWx0UGF0aEVycm9yKFxuICAgICAgICAgIGBWYXVsdCBwYXRoIGVzY2FwZXMgdGhlIHZhdWx0IHJvb3Q6ICR7SlNPTi5zdHJpbmdpZnkoaW5wdXQpfWAsXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICBzZWdtZW50cy5wb3AoKTtcbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBzZWdtZW50cy5wdXNoKHNlZ21lbnQpO1xuICB9XG4gIHJldHVybiBzZWdtZW50cy5sZW5ndGggPT09IDAgPyAnLycgOiBgLyR7c2VnbWVudHMuam9pbignLycpfWA7XG59XG5cbi8qKlxuICogSm9pbiBhIGJhc2UgdmF1bHQgcGF0aCB3aXRoIG9uZSBvciBtb3JlIHJlbGF0aXZlIHBhdGggcGFydHMuXG4gKlxuICogRWFjaCBwYXJ0IG11c3QgYmUgcmVsYXRpdmUgKG5vIGxlYWRpbmcgYC9gIGFmdGVyIGJhY2tzbGFzaCBjb252ZXJzaW9uKSBhbmRcbiAqIGlzIGFwcGVuZGVkIHRvIHRoZSBiYXNlIGJlZm9yZSBub3JtYWxpemF0aW9uOyBgLi5gIGluc2lkZSBwYXJ0cyBtYXkgbm90XG4gKiBlc2NhcGUgdGhlIHJlc3VsdGluZyByb290LlxuICovXG5leHBvcnQgZnVuY3Rpb24gam9pblBhdGgoYmFzZTogc3RyaW5nLCAuLi5wYXJ0czogcmVhZG9ubHkgc3RyaW5nW10pOiBWYXVsdFBhdGgge1xuICBsZXQgY29tYmluZWQgPSBub3JtYWxpemVWYXVsdFBhdGgoYmFzZSk7XG4gIGZvciAoY29uc3QgcGFydCBvZiBwYXJ0cykge1xuICAgIGNvbnN0IGNvbnZlcnRlZCA9IHBhcnQucmVwbGFjZSgvXFxcXC9nLCAnLycpO1xuICAgIGlmIChjb252ZXJ0ZWQuc3RhcnRzV2l0aCgnLycpKSB7XG4gICAgICB0aHJvdyBuZXcgSW52YWxpZFZhdWx0UGF0aEVycm9yKFxuICAgICAgICBgam9pblBhdGggcGFydHMgbXVzdCBiZSByZWxhdGl2ZSwgZ290ICR7SlNPTi5zdHJpbmdpZnkocGFydCl9YCxcbiAgICAgICk7XG4gICAgfVxuICAgIGNvbWJpbmVkID0gYCR7Y29tYmluZWQgPT09ICcvJyA/ICcnIDogY29tYmluZWR9LyR7Y29udmVydGVkfWA7XG4gIH1cbiAgcmV0dXJuIG5vcm1hbGl6ZVZhdWx0UGF0aChjb21iaW5lZCk7XG59XG5cbi8qKlxuICogUGFyZW50IGRpcmVjdG9yeSBvZiBhIHZhdWx0IHBhdGguIFRoZSBwYXJlbnQgb2YgYC9gIGlzIGAvYCAodGhlIHJvb3QgaGFzIG5vXG4gKiBwYXJlbnQgYWJvdmUgaXQpOyB3YWxrIGB3aGlsZSAocCAhPT0gcGFyZW50UGF0aChwKSlgIHN0eWxlIGxvb3BzIHRlcm1pbmF0ZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcmVudFBhdGgocGF0aDogc3RyaW5nKTogVmF1bHRQYXRoIHtcbiAgY29uc3Qgbm9ybWFsaXplZCA9IG5vcm1hbGl6ZVZhdWx0UGF0aChwYXRoKTtcbiAgaWYgKG5vcm1hbGl6ZWQgPT09ICcvJykgcmV0dXJuICcvJztcbiAgY29uc3QgbGFzdFNsYXNoID0gbm9ybWFsaXplZC5sYXN0SW5kZXhPZignLycpO1xuICByZXR1cm4gbGFzdFNsYXNoID09PSAwID8gJy8nIDogbm9ybWFsaXplZC5zbGljZSgwLCBsYXN0U2xhc2gpO1xufVxuXG4vKipcbiAqIEZpbmFsIHBhdGggc2VnbWVudC4gYGJhc2VuYW1lKCcvYS9iLm1kJylgIFx1MjE5MiBgYi5tZGA7IGBiYXNlbmFtZSgnLycpYCBcdTIxOTIgYCcnYC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJhc2VuYW1lKHBhdGg6IHN0cmluZyk6IFZhdWx0UGF0aCB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVWYXVsdFBhdGgocGF0aCk7XG4gIGlmIChub3JtYWxpemVkID09PSAnLycpIHJldHVybiAnJztcbiAgcmV0dXJuIG5vcm1hbGl6ZWQuc2xpY2Uobm9ybWFsaXplZC5sYXN0SW5kZXhPZignLycpICsgMSk7XG59XG5cbi8qKlxuICogV2hldGhlciBgY2hpbGRgIG5hbWVzIHNvbWV0aGluZyBhdCBsZWFzdCBvbmUgbGV2ZWwgQkVMT1cgYGFuY2VzdG9yYFxuICogKGJvdGggbm9ybWFsaXplZCB2YXVsdCBwYXRocykuIFRoZSByb290IGlzIGFuIGFuY2VzdG9yIG9mIGV2ZXJ5dGhpbmdcbiAqIGV4Y2VwdCBpdHNlbGY7IGEgcGF0aCBpcyBuZXZlciBzdHJpY3RseSBiZW5lYXRoIGl0c2VsZi5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzU3RyaWN0bHlCZW5lYXRoKGNoaWxkOiBzdHJpbmcsIGFuY2VzdG9yOiBzdHJpbmcpOiBib29sZWFuIHtcbiAgaWYgKGFuY2VzdG9yID09PSAnLycpIHJldHVybiBjaGlsZCAhPT0gJy8nO1xuICByZXR1cm4gY2hpbGQubGVuZ3RoID4gYW5jZXN0b3IubGVuZ3RoICYmIGNoaWxkLnN0YXJ0c1dpdGgoYCR7YW5jZXN0b3J9L2ApO1xufVxuIiwgIi8qKlxuICogTG9naWNhbCBjbG9jayBvcGVyYXRpb25zIChBUkNISVRFQ1RVUkUubWQgXHUwMEE3NCkuXG4gKlxuICogQ2xvY2tzIGFyZSBwZXItZmlsZSBtb25vdG9uaWMgY291bnRlcnMgb3duZWQgYnkgdGhlIHN5bmMgYXV0aG9yaXR5ICh0aGVcbiAqIER1cmFibGUgT2JqZWN0KS4gQSBjbG9jayBwYWlycyB0aGUgY291bnRlciB3aXRoIHRoZSBpZCBvZiB0aGUgZGV2aWNlIHRoYXRcbiAqIHByb2R1Y2VkIGl0LiBPcmRlcmluZyBpcyBmdWxseSBkZXRlcm1pbmlzdGljIG9uIGV2ZXJ5IGNsaWVudDpcbiAqXG4gKiAgIDEuIGhpZ2hlciBgY291bnRlcmAgd2lucztcbiAqICAgMi4gZXhhY3QgY291bnRlciB0aWUgXHUyMTkyIGxleGljb2dyYXBoaWNhbGx5IGdyZWF0ZXIgYGRldmljZUlkYCB3aW5zXG4gKiAgICAgIChwbGFpbiBKUyBzdHJpbmcgY29tcGFyaXNvbiwgaS5lLiBieSBVVEYtMTYgY29kZSB1bml0cyk7XG4gKiAgIDMuIGlkZW50aWNhbCBjb3VudGVyICphbmQqIGlkZW50aWNhbCBkZXZpY2VJZCBcdTIxOTIgdGhlIGNsb2NrcyBhcmUgZXF1YWwuXG4gKlxuICogV2FsbC1jbG9jayB0aW1lIG5ldmVyIHBhcnRpY2lwYXRlcyBpbiBvcmRlcmluZyAoZGlzcGxheS1vbmx5IHBlciBcdTAwQTc0KS5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IExvZ2ljYWxDbG9jayB9IGZyb20gJy4vdHlwZXMuanMnO1xuXG4vKiogUmVzdWx0IG9mIGBjb21wYXJlQ2xvY2tzYDogc2lnbiBvZiBgYWAgdnMgYGJgIChwb3NpdGl2ZSBcdTIxRDIgYGFgIHdpbnMpLiAqL1xuZXhwb3J0IHR5cGUgQ2xvY2tDb21wYXJpc29uID0gLTEgfCAwIHwgMTtcblxuLyoqXG4gKiBDb21wYXJlIHR3byBsb2dpY2FsIGNsb2Nrcy5cbiAqXG4gKiBSZXR1cm5zIGAxYCB3aGVuIGBhYCB3aW5zLCBgLTFgIHdoZW4gYGJgIHdpbnMsIGAwYCB3aGVuIHRoZSBjbG9ja3MgYXJlXG4gKiBpZGVudGljYWwgKHNhbWUgY291bnRlciAqYW5kKiBzYW1lIGRldmljZUlkIFx1MjAxNCBpbiBwcmFjdGljZSBvbmx5IHdoZW5cbiAqIGNvbXBhcmluZyBhIGNsb2NrIHdpdGggaXRzZWxmKS4gQ2FsbGVycyB0aGF0IG11c3QgcGljayBhIHNpZGUgb24gYDBgXG4gKiBzaG91bGQgZG8gc28gZXhwbGljaXRseSBhbmQgZG9jdW1lbnQgdGhlIGNob2ljZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvbXBhcmVDbG9ja3MoYTogTG9naWNhbENsb2NrLCBiOiBMb2dpY2FsQ2xvY2spOiBDbG9ja0NvbXBhcmlzb24ge1xuICBpZiAoYS5jb3VudGVyICE9PSBiLmNvdW50ZXIpIHJldHVybiBhLmNvdW50ZXIgPiBiLmNvdW50ZXIgPyAxIDogLTE7XG4gIGlmIChhLmRldmljZUlkICE9PSBiLmRldmljZUlkKSByZXR1cm4gYS5kZXZpY2VJZCA+IGIuZGV2aWNlSWQgPyAxIDogLTE7XG4gIHJldHVybiAwO1xufVxuXG4vKipcbiAqIFRoZSBjbG9jayBhIGNvbW1pdCBmcm9tIGBkZXZpY2VJZGAgd291bGQgcmVjZWl2ZSB3aGVuIGJ1aWxkaW5nIG9uIGBwYXJlbnRgXG4gKiAob3Igb24gbm90aGluZywgd2hlbiBgcGFyZW50YCBpcyBhYnNlbnQpOiBwYXJlbnQncyBjb3VudGVyICsgMS5cbiAqXG4gKiBUaGlzIGlzIHRoZSAqdGVudGF0aXZlKiBjbG9jayB1c2VkIGJ5IGNsaWVudC1zaWRlIGNvbmZsaWN0IHByZWRpY3Rpb25cbiAqIChgcmVzb2x2ZS50c2ApOiB0aGUgRE8gYXNzaWducyByZWFsIGNvdW50ZXJzIHdpdGggdGhlIHNhbWUgcnVsZSwgc28gdGhlXG4gKiBwcmVkaWN0aW9uIG1hdGNoZXMgdGhlIHNlcnZlcidzIGFyYml0cmF0aW9uIGFzIGxvbmcgYXMgYm90aCBzaWRlcyBidWlsZCBvblxuICogdGhlIHNhbWUgcGFyZW50LlxuICovXG5leHBvcnQgZnVuY3Rpb24gbmV4dENsb2NrKFxuICBwYXJlbnQ6IExvZ2ljYWxDbG9jayB8IG51bGwgfCB1bmRlZmluZWQsXG4gIGRldmljZUlkOiBzdHJpbmcsXG4pOiBMb2dpY2FsQ2xvY2sge1xuICByZXR1cm4geyBjb3VudGVyOiAocGFyZW50Py5jb3VudGVyID8/IDApICsgMSwgZGV2aWNlSWQgfTtcbn1cbiIsICIvKipcbiAqIENvbnRlbnQgaGFzaGluZyBhbmQgY29tcHJlc3Npb24gXHUyMDE0IFdlYiBBUElzIG9ubHkuXG4gKlxuICogYGNyeXB0by5zdWJ0bGVgIGlzIGF2YWlsYWJsZSBpbiBOb2RlIDE4KywgQ2xvdWRmbGFyZSBXb3JrZXJzLFxuICogYW5kIE9ic2lkaWFuIChFbGVjdHJvbikuIGBDb21wcmVzc2lvblN0cmVhbWAgbGlrZXdpc2UuIE5vIE5vZGUgaW1wb3J0czpcbiAqIHRoaXMgbW9kdWxlIG11c3QgcnVuIHVuY2hhbmdlZCBpbiBldmVyeSBjbGllbnQgKEFSQ0hJVEVDVFVSRS5tZCBcdTAwQTc4KS5cbiAqL1xuXG4vKiogSGFzaCBvZiBgYnl0ZXNgIGFzIGxvd2VyY2FzZSBzaGEyNTYgaGV4LiBNYXRjaGVzIFIyIGJsb2Iga2V5cyBgYmxvYnMve3NoYTI1Nn1gLiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHNoYTI1NkhleChieXRlczogVWludDhBcnJheSB8IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gIGNvbnN0IGRhdGEgPSB0eXBlb2YgYnl0ZXMgPT09ICdzdHJpbmcnID8gbmV3IFRleHRFbmNvZGVyKCkuZW5jb2RlKGJ5dGVzKSA6IGJ5dGVzO1xuICAvLyBgY3J5cHRvYCAobm90IGBnbG9iYWxUaGlzLmNyeXB0b2ApOiB0aGUgYmFyZSBpZGVudGlmaWVyIHJlc29sdmVzIGluIGV2ZXJ5XG4gIC8vIHRhcmdldCdzIHR5cGVzIChET00gbGliLCBDbG91ZGZsYXJlIHdvcmtlcmQgdHlwZXMsIE5vZGUpIFx1MjAxNCB0aGUgcXVhbGlmaWVkXG4gIC8vIGZvcm0gZG9lcyBub3QsIGJlY2F1c2Ugd29ya2VycyB0eXBlcyBkZWNsYXJlIGl0IGBjb25zdGAsIHdoaWNoIG5ldmVyXG4gIC8vIG1lcmdlcyBpbnRvIGB0eXBlb2YgZ2xvYmFsVGhpc2AuXG4gIGNvbnN0IGRpZ2VzdCA9IGF3YWl0IGNyeXB0by5zdWJ0bGUuZGlnZXN0KCdTSEEtMjU2JywgZGF0YSBhcyBCdWZmZXJTb3VyY2UpO1xuICByZXR1cm4gdG9IZXgobmV3IFVpbnQ4QXJyYXkoZGlnZXN0KSk7XG59XG5cbi8qKlxuICogV2hldGhlciBnemlwIHN0cmVhbXMgYXJlIGF2YWlsYWJsZSBpbiB0aGlzIHJ1bnRpbWUuIE9sZGVyIE9ic2lkaWFuIG1vYmlsZVxuICogd2Vidmlld3MgbWF5IGxhY2sgYENvbXByZXNzaW9uU3RyZWFtYDsgY2FsbGVycyBmYWxsIGJhY2sgdG8gaWRlbnRpdHkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdXBwb3J0c0NvbXByZXNzaW9uKCk6IGJvb2xlYW4ge1xuICByZXR1cm4gKFxuICAgIHR5cGVvZiBDb21wcmVzc2lvblN0cmVhbSAhPT0gJ3VuZGVmaW5lZCcgJiZcbiAgICB0eXBlb2YgRGVjb21wcmVzc2lvblN0cmVhbSAhPT0gJ3VuZGVmaW5lZCdcbiAgKTtcbn1cblxuLyoqXG4gKiBHemlwIGBkYXRhYC4gRmFsbHMgYmFjayB0byBpZGVudGl0eSAocmV0dXJucyBpbnB1dCB1bmNoYW5nZWQpIHdoZW5cbiAqIGBDb21wcmVzc2lvblN0cmVhbWAgaXMgdW5hdmFpbGFibGUgXHUyMDE0IGNhbGwgYHN1cHBvcnRzQ29tcHJlc3Npb24oKWAgZmlyc3QgaWZcbiAqIHlvdSBtdXN0IGtub3cgd2hpY2ggaGFwcGVuZWQuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjb21wcmVzcyhkYXRhOiBVaW50OEFycmF5KTogUHJvbWlzZTxVaW50OEFycmF5PiB7XG4gIGlmICghc3VwcG9ydHNDb21wcmVzc2lvbigpKSByZXR1cm4gZGF0YTtcbiAgLy8gYGFzIEJ1ZmZlclNvdXJjZWAgKG5vdCBgYXMgQmxvYlBhcnRgKTogdGhlIG5hbWUgYEJ1ZmZlclNvdXJjZWAgcmVzb2x2ZXMgaW5cbiAgLy8gYm90aCBET00gbGliIGFuZCB3b3JrZXJkIHJ1bnRpbWUgdHlwZXMsIGFuZCBpcyBhIHZhbGlkIEJsb2JQYXJ0IGluIGVhY2guXG4gIGNvbnN0IHN0cmVhbSA9IG5ldyBCbG9iKFtkYXRhIGFzIEJ1ZmZlclNvdXJjZV0pXG4gICAgLnN0cmVhbSgpXG4gICAgLnBpcGVUaHJvdWdoKG5ldyBDb21wcmVzc2lvblN0cmVhbSgnZ3ppcCcpKTtcbiAgcmV0dXJuIG5ldyBVaW50OEFycmF5KGF3YWl0IG5ldyBSZXNwb25zZShzdHJlYW0pLmFycmF5QnVmZmVyKCkpO1xufVxuXG4vKipcbiAqIEd1bnppcCBgZGF0YWAgcHJvZHVjZWQgYnkgYGNvbXByZXNzYCAoaW4gYSBydW50aW1lIHRoYXQgaGFkIGd6aXAgc3VwcG9ydCkuXG4gKiBGYWxscyBiYWNrIHRvIGlkZW50aXR5IHdoZW4gYERlY29tcHJlc3Npb25TdHJlYW1gIGlzIHVuYXZhaWxhYmxlLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZGVjb21wcmVzcyhkYXRhOiBVaW50OEFycmF5KTogUHJvbWlzZTxVaW50OEFycmF5PiB7XG4gIGlmICghc3VwcG9ydHNDb21wcmVzc2lvbigpKSByZXR1cm4gZGF0YTtcbiAgY29uc3Qgc3RyZWFtID0gbmV3IEJsb2IoW2RhdGEgYXMgQnVmZmVyU291cmNlXSlcbiAgICAuc3RyZWFtKClcbiAgICAucGlwZVRocm91Z2gobmV3IERlY29tcHJlc3Npb25TdHJlYW0oJ2d6aXAnKSk7XG4gIHJldHVybiBuZXcgVWludDhBcnJheShhd2FpdCBuZXcgUmVzcG9uc2Uoc3RyZWFtKS5hcnJheUJ1ZmZlcigpKTtcbn1cblxuZnVuY3Rpb24gdG9IZXgoYnl0ZXM6IFVpbnQ4QXJyYXkpOiBzdHJpbmcge1xuICBsZXQgb3V0ID0gJyc7XG4gIGZvciAoY29uc3QgYnl0ZSBvZiBieXRlcykge1xuICAgIG91dCArPSBieXRlLnRvU3RyaW5nKDE2KS5wYWRTdGFydCgyLCAnMCcpO1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG4iLCAiLyoqXG4gKiBUeXBlZCBlcnJvciBoaWVyYXJjaHkgc2hhcmVkIGJ5IGFsbCBjbGllbnRzIChwbHVnaW4sIGRhZW1vbiwgQ0xJKSBhbmQgdGhlXG4gKiB0ZXN0LXN1aXRlIHNlcnZlci4gRXJyb3JzIGNhcnJ5IGEgc3RhYmxlIG1hY2hpbmUtcmVhZGFibGUgYGNvZGVgLlxuICovXG5cbmV4cG9ydCB0eXBlIEVycm9yQ29kZSA9XG4gIHwgJ1VOQ0xBSU1FRCdcbiAgfCAnVU5BVVRIT1JJWkVEJ1xuICB8ICdSRVZPS0VEJ1xuICB8ICdDT05GTElDVCdcbiAgfCAnUFJPVE9DT0wnXG4gIHwgJ05FVFdPUksnO1xuXG4vKiogQmFzZSBjbGFzcyBmb3IgYWxsIFZhdWx0U3luYyBlcnJvcnMuICovXG5leHBvcnQgYWJzdHJhY3QgY2xhc3MgVmF1bHRTeW5jRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIGFic3RyYWN0IHJlYWRvbmx5IGNvZGU6IEVycm9yQ29kZTtcblxuICBjb25zdHJ1Y3RvcihtZXNzYWdlOiBzdHJpbmcsIG9wdGlvbnM/OiBFcnJvck9wdGlvbnMpIHtcbiAgICBzdXBlcihtZXNzYWdlLCBvcHRpb25zKTtcbiAgICB0aGlzLm5hbWUgPSBuZXcudGFyZ2V0Lm5hbWU7XG4gIH1cbn1cblxuLyoqIFdvcmtlciBleGlzdHMgYnV0IGhhcyBub3QgYmVlbiBjbGFpbWVkIHlldCAoSFRUUCA0MjEgb24gZXZlcnkgQVBJIGNhbGwpLiAqL1xuZXhwb3J0IGNsYXNzIFVuY2xhaW1lZEVycm9yIGV4dGVuZHMgVmF1bHRTeW5jRXJyb3Ige1xuICByZWFkb25seSBjb2RlID0gJ1VOQ0xBSU1FRCcgYXMgY29uc3Q7XG59XG5cbi8qKiBUb2tlbiBtaXNzaW5nLCBpbnZhbGlkLCBvciBub3QgYWNjZXB0ZWQgKEhUVFAgNDAxIGNsYXNzKS4gKi9cbmV4cG9ydCBjbGFzcyBVbmF1dGhvcml6ZWRFcnJvciBleHRlbmRzIFZhdWx0U3luY0Vycm9yIHtcbiAgcmVhZG9ubHkgY29kZSA9ICdVTkFVVEhPUklaRUQnIGFzIGNvbnN0O1xufVxuXG4vKiogVGhlIGRldmljZSB0b2tlbiB3YXMgcmV2b2tlZDsgdGhlIGRldmljZSBtdXN0IGJlIHJlLXBhaXJlZC4gKi9cbmV4cG9ydCBjbGFzcyBSZXZva2VkRXJyb3IgZXh0ZW5kcyBWYXVsdFN5bmNFcnJvciB7XG4gIHJlYWRvbmx5IGNvZGUgPSAnUkVWT0tFRCcgYXMgY29uc3Q7XG59XG5cbi8qKiBBIGNvbW1pdCByYWNlZCB3aXRoIGEgY29uY3VycmVudCBlZGl0OyB0aGUgc2VydmVyIGFyYml0cmF0ZWQgKHNlZSBcdTAwQTc0KS4gKi9cbmV4cG9ydCBjbGFzcyBDb25mbGljdEVycm9yIGV4dGVuZHMgVmF1bHRTeW5jRXJyb3Ige1xuICByZWFkb25seSBjb2RlID0gJ0NPTkZMSUNUJyBhcyBjb25zdDtcbn1cblxuLyoqIEEgcGVlciAob3IgbG9jYWwgYnVnKSB2aW9sYXRlZCB0aGUgcHJvdG9jb2w6IGJhZCBtZXNzYWdlIHNoYXBlLCBiYWQgdmVyc2lvbi4gKi9cbmV4cG9ydCBjbGFzcyBQcm90b2NvbEVycm9yIGV4dGVuZHMgVmF1bHRTeW5jRXJyb3Ige1xuICByZWFkb25seSBjb2RlID0gJ1BST1RPQ09MJyBhcyBjb25zdDtcbn1cblxuLyoqIFRyYW5zcG9ydC1sZXZlbCBmYWlsdXJlOiBzb2NrZXQgY2xvc2VkLCBmZXRjaCByZWZ1c2VkLCB0aW1lb3V0LiBSZXRyaWFibGUuICovXG5leHBvcnQgY2xhc3MgTmV0d29ya0Vycm9yIGV4dGVuZHMgVmF1bHRTeW5jRXJyb3Ige1xuICByZWFkb25seSBjb2RlID0gJ05FVFdPUksnIGFzIGNvbnN0O1xufVxuIiwgIi8qKlxuICogVGhlIGNsaWVudCdzIHBlcnNpc3RlZCBzeW5jIHN0YXRlIChBUkNISVRFQ1RVUkUubWQgXHUwMEE3OCBzdGVwIDEpLlxuICpcbiAqIEEgYExvY2FsSW5kZXhgIG1hcHMgZXZlcnkgdmF1bHQgcGF0aCB0aGlzIGNsaWVudCBoYXMgZXZlciBzeW5jZWQgdG8gdGhlXG4gKiBsYXN0IHZlcnNpb24gaXQgKmtub3dzKiB3YXMgYXV0aG9yaXRhdGl2ZTogY29udGVudCBoYXNoLCBzaXplLCB0aGVcbiAqIHNlcnZlci1hc3NpZ25lZCB2ZXJzaW9uIGlkLCBhbmQgdGhlIHZlcnNpb24ncyBsb2dpY2FsIGNsb2NrLiBFbnRyaWVzIHdpdGhcbiAqIGBkZWxldGVkQXRgIHNldCBhcmUgdG9tYnN0b25lcyBcdTIwMTQgdGhlIGZpbGUgd2FzIGRlbGV0ZWQgKGxvY2FsbHkgb3JcbiAqIHJlbW90ZWx5KSBidXQgdGhlIGVudHJ5IHN0YXlzIHNvIHRoZSBkZWxldGlvbiBpcyBub3QgcmVzdXJyZWN0ZWQgYnkgdGhlXG4gKiBuZXh0IHNjYW4gYW5kIHNvIHJlbmFtZSBjb3JyZWxhdGlvbiBrZWVwcyB3b3JraW5nLlxuICpcbiAqIFRoZSBpbmRleCBpcyBwZXJzaXN0ZWQgaW5zaWRlIHRoZSB2YXVsdCBhdCBgLy52YXVsdHN5bmNmb3JhZ2VudHMvc3RhdGVgXG4gKiAodGhhdCBkaXJlY3RvcnkgaXMgc3luYy1pZ25vcmVkLCBzZWUgYGlnbm9yZS50c2ApIHRocm91Z2ggdGhlIHN0b3JhZ2VcbiAqIGFkYXB0ZXIsIHdob3NlIGB3cml0ZUZpbGVgIGlzIGF0b21pYyAodGVtcCArIHJlbmFtZSkgYnkgY29udHJhY3QuXG4gKlxuICogQWxsIG9wZXJhdGlvbnMgYXJlIHB1cmU6IHRoZXkgcmV0dXJuIG5ldyBvYmplY3RzIGFuZCBuZXZlciBtdXRhdGUgaW5wdXRzLlxuICovXG5cbmltcG9ydCB0eXBlIHsgTG9naWNhbENsb2NrIH0gZnJvbSAnLi90eXBlcy5qcyc7XG5pbXBvcnQgeyBQcm90b2NvbEVycm9yIH0gZnJvbSAnLi9lcnJvcnMuanMnO1xuXG4vKipcbiAqIEN1cnJlbnQgb24tZGlzayBzY2hlbWEgdmVyc2lvbi4gQnVtcCArIGFkZCBtaWdyYXRpb24gb24gYnJlYWtpbmcgY2hhbmdlcy5cbiAqXG4gKiBIaXN0b3J5OlxuICogICAtIDEgXHUyMDE0IGluaXRpYWwgc2hhcGUgKGhhc2gvc2l6ZS92ZXJzaW9uSWQvY2xvY2svZGVsZXRlZEF0L2lzRm9sZGVyKS5cbiAqICAgLSAyIFx1MjAxNCBhZGRzIHRoZSBvcHRpb25hbCBgbXRpbWVgIGNhY2hlIGZpZWxkIHBlciBlbnRyeSAoc2NhbiBwcmUtZmlsdGVyLFxuICogICAgICAgICBzZWUgYHNjYW4udHNgKS4gR3JhY2VmdWwgbWlncmF0aW9uOiB2MSBlbnRyaWVzIHNpbXBseSBsYWNrIGBtdGltZWAsXG4gKiAgICAgICAgIHdoaWNoIHJlYWRzIGJhY2sgYXMgXCJ1bmtub3duXCIgXHUyMDE0IHRoZSBuZXh0IGZhc3Qgc2NhbiByZS1oYXNoZXMgdGhlXG4gKiAgICAgICAgIGZpbGUgYW5kIHJlY29yZHMgaXQuIE9sZCB2MSBzdGF0ZSBmaWxlcyBsb2FkIHdpdGhvdXQgZXJyb3IuXG4gKlxuICogVGhlIHYyIEVOVkVMT1BFIGFsc28gY2FycmllcyBvcHRpb25hbCBzeW5jLWN1cnNvciBib29ra2VlcGluZyAoYGN1cnNvcmAsXG4gKiBgc3luY2VkVGhyb3VnaGAsIGBuZWVkc0Z1bGxNYW5pZmVzdGAgXHUyMDE0IHNlZSBgUGVyc2lzdGVkU3luY1N0YXRlYCk7IGZpbGVzXG4gKiB3cml0dGVuIGJlZm9yZSBpdCBleGlzdGVkIHNpbXBseSBsYWNrIHRob3NlIGtleXMsIHdoaWNoIHJlYWQgYmFjayBhc1xuICogXCJubyBjdXJzb3Iga25vd2xlZGdlXCIgKGZ1bGwgbWFuaWZlc3Qgb24gdGhlIG5leHQgY29ubmVjdCkuIE5vIHZlcnNpb25cbiAqIGJ1bXA6IGJvdGggZGlyZWN0aW9ucyB0b2xlcmF0ZSB0aGUgbWlzc2luZyBmaWVsZHMuXG4gKi9cbmV4cG9ydCBjb25zdCBMT0NBTF9JTkRFWF9TQ0hFTUFfVkVSU0lPTiA9IDI7XG5cbi8qKiBPbGRlc3Qgb24tZGlzayBzY2hlbWEgdmVyc2lvbiB0aGlzIGJ1aWxkIGNhbiBzdGlsbCByZWFkLiAqL1xuZXhwb3J0IGNvbnN0IE1JTl9MT0NBTF9JTkRFWF9TQ0hFTUFfVkVSU0lPTiA9IDE7XG5cbi8qKiBWYXVsdCBwYXRoIHdoZXJlIHRoZSBjbGllbnQgcGVyc2lzdHMgaXRzIGxvY2FsIGluZGV4LiAqL1xuZXhwb3J0IGNvbnN0IExPQ0FMX0lOREVYX1NUQVRFX1BBVEggPSAnLy52YXVsdHN5bmNmb3JhZ2VudHMvc3RhdGUnO1xuXG4vKiogT25lIHBhdGgncyBsYXN0LWtub3duLXN5bmNlZCBzdGF0ZS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgTG9jYWxJbmRleEVudHJ5IHtcbiAgLyoqIHNoYTI1NiBoZXggb2YgdGhlIGNvbnRlbnQgYXQgYHZlcnNpb25JZGAuICovXG4gIGhhc2g6IHN0cmluZztcbiAgLyoqIENvbnRlbnQgc2l6ZSBpbiBieXRlcyAoYDBgIGZvciBmb2xkZXIgcGxhY2Vob2xkZXJzKS4gKi9cbiAgc2l6ZTogbnVtYmVyO1xuICAvKiogU2VydmVyLWFzc2lnbmVkIHZlcnNpb24gaWQgdGhpcyBlbnRyeSByZWZsZWN0cy4gKi9cbiAgdmVyc2lvbklkOiBzdHJpbmc7XG4gIC8qKiBMb2dpY2FsIGNsb2NrIG9mIGB2ZXJzaW9uSWRgIFx1MjAxNCB1c2VkIHRvIHByZWRpY3QgY29uZmxpY3Qgb3V0Y29tZXMuICovXG4gIGNsb2NrOiBMb2dpY2FsQ2xvY2s7XG4gIC8qKiBQcmVzZW50IFx1MjFEMiB0b21ic3RvbmU6IHRoZSBwYXRoIHdhcyBkZWxldGVkIGF0IHRoaXMgZXBvY2ggbXMuICovXG4gIGRlbGV0ZWRBdD86IG51bWJlcjtcbiAgLyoqXG4gICAqIFRydWUgZm9yIGVtcHR5LWZvbGRlciBwbGFjZWhvbGRlciBlbnRyaWVzIChGUi0xMCkuIEZvbGRlciBlbnRyaWVzIGNhcnJ5XG4gICAqIGBoYXNoOiAnJ2AsIGBzaXplOiAwYDsgdGhlIGNsb2NrIGlzIHRoYXQgb2YgdGhlIHBsYWNlaG9sZGVyJ3MgdmVyc2lvbi5cbiAgICovXG4gIGlzRm9sZGVyPzogYm9vbGVhbjtcbiAgLyoqXG4gICAqIFN0b3JhZ2UgbXRpbWUgKGVwb2NoIG1zKSBvYnNlcnZlZCB0aGUgbGFzdCB0aW1lIHRoaXMgZW50cnkncyBmaWxlIHdhc1xuICAgKiBoYXNoZWQgYnkgYSBzY2FuLiBBIHB1cmUgY2FjaGUgZm9yIHRoZSBzY2FuIHByZS1maWx0ZXIgKGBzY2FuLnRzYCk6XG4gICAqIG51bGxpc2ggKGFic2VudCwgZS5nLiBsZWdhY3kgdjEgc3RhdGUgb3IgZW50cmllcyB3cml0dGVuIGJ5IHB1bGxzKVxuICAgKiBtZWFucyBcInVua25vd25cIiBcdTIwMTQgdGhlIG5leHQgZmFzdCBzY2FuIGhhc2hlcyB0aGUgZmlsZSBhbmQgcmVjb3JkcyBpdCB2aWFcbiAgICogYHJlY29yZEhhc2hlZEZpbGVzYC4gTmV2ZXIgY29uc3VsdGVkIGZvciBzeW5jIGRlY2lzaW9ucy5cbiAgICovXG4gIG10aW1lPzogbnVtYmVyO1xufVxuXG4vKiogVGhlIHdob2xlIGluZGV4OiBub3JtYWxpemVkIHZhdWx0IHBhdGggXHUyMTkyIGVudHJ5LiBge31gIGlzIGEgdmFsaWQgZW1wdHkgaW5kZXguICovXG5leHBvcnQgdHlwZSBMb2NhbEluZGV4ID0gUmVhZG9ubHk8UmVjb3JkPHN0cmluZywgTG9jYWxJbmRleEVudHJ5Pj47XG5cbi8qKiBWZXJzaW9uZWQgc2VyaWFsaXphdGlvbiBlbnZlbG9wZSAoc2NoZW1hVmVyc2lvbiBlbmFibGVzIGZ1dHVyZSBtaWdyYXRpb24pLiAqL1xuZXhwb3J0IGludGVyZmFjZSBMb2NhbEluZGV4RW52ZWxvcGUge1xuICBzY2hlbWFWZXJzaW9uOiBudW1iZXI7XG4gIGVudHJpZXM6IFJlY29yZDxzdHJpbmcsIExvY2FsSW5kZXhFbnRyeT47XG4gIC8qKlxuICAgKiBFbnZlbG9wZS1sZXZlbCBzeW5jIGJvb2trZWVwaW5nIChvcHRpb25hbCBzbyB2MiBmaWxlcyB3cml0dGVuIGJlZm9yZSBpdFxuICAgKiBleGlzdGVkIHN0aWxsIGxvYWQ7IHVua25vd24gZmllbGRzIGFyZSB0b2xlcmF0ZWQgaW4gYm90aCBkaXJlY3Rpb25zKS5cbiAgICogU2VlIGBQZXJzaXN0ZWRTeW5jU3RhdGVgLlxuICAgKi9cbiAgY3Vyc29yPzogbnVtYmVyO1xuICBzeW5jZWRUaHJvdWdoPzogbnVtYmVyIHwgbnVsbDtcbiAgbmVlZHNGdWxsTWFuaWZlc3Q/OiBib29sZWFuO1xufVxuXG4vKipcbiAqIFN5bmMtY3Vyc29yIGJvb2trZWVwaW5nIHBlcnNpc3RlZCBhdG9taWNhbGx5IFdJVEggdGhlIGVudHJpZXMgKG9uZSBmaWxlLFxuICogb25lIHdyaXRlKSBzbyB0aGUgdHdvIGNhbiBuZXZlciBkaXNhZ3JlZSBhZnRlciBhIGNyYXNoLiBSZXN0b3JlZCBvblxuICogc3RhcnR1cCB0byBwb3dlciBkZWx0YS1tYW5pZmVzdCByZWNvbm5lY3RzLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFBlcnNpc3RlZFN5bmNTdGF0ZSB7XG4gIC8qKiBMYXN0IHNlZW4gc2VydmVyIHNlcXVlbmNlIG51bWJlciAoc2VudCBhcyBgaGVsbG8uY3Vyc29yYCkuICovXG4gIGN1cnNvcj86IG51bWJlcjtcbiAgLyoqXG4gICAqIFNlcXVlbmNlIHRocm91Z2ggd2hpY2ggdGhlIGluZGV4IGlzIGtub3duIENPTVBMRVRFOiB0aGUgbWFuaWZlc3QgY3Vyc29yXG4gICAqIG9mIHRoZSBsYXN0IHN5bmMgY3ljbGUgdGhhdCBmaW5pc2hlZCBzdWNjZXNzZnVsbHkuIEV2ZXJ5IGhlYWQgYXQgb3JcbiAgICogYmVsb3cgaXQgaXMgcmVmbGVjdGVkIGluIHRoZSBlbnRyaWVzIGFib3ZlLCBzbyBhIGxhdGVyIHJlY29ubmVjdCBvbmx5XG4gICAqIG5lZWRzIGhlYWRzIHdpdGggYGhlYWRfc2VxID4gc3luY2VkVGhyb3VnaGAgXHUyMDE0IHRoZSBkZWx0YS1tYW5pZmVzdCB3aW5kb3cuXG4gICAqIGBudWxsYC9hYnNlbnQgXHUyMUQyIG5vIGNvbXBsZXRlZCBjeWNsZSB5ZXQgKG9yIGFuIGludGVycnVwdGVkIG9uZSk6IHRoZSBuZXh0XG4gICAqIG1hbmlmZXN0IG11c3QgYmUgRlVMTC4gRGVsaWJlcmF0ZWx5IE5PVCBhZHZhbmNlZCB0byBjb21taXQtYWNrIHNlcXMgc2VlblxuICAgKiBtaWQtY3ljbGU6IGEgY2hhbmdlIGJyb2FkY2FzdCBmcm9tIGFub3RoZXIgZGV2aWNlIGNhbiBpbnRlcmxlYXZlIHdpdGhcbiAgICogb3VyIGFja3MgYW5kIGxhbmQgaW4gdGhlIHBvc3QtY3ljbGUgZGlzcGF0Y2ggcXVldWUsIHNvIG9ubHkgdGhlXG4gICAqIGZldGNoLXRpbWUgbWFuaWZlc3QgY3Vyc29yIGlzIGEgY29tcGxldGlvbiBndWFyYW50ZWUuXG4gICAqL1xuICBzeW5jZWRUaHJvdWdoPzogbnVtYmVyIHwgbnVsbDtcbiAgLyoqXG4gICAqIEEgcmVtb3RlIGNoYW5nZSB3YXMgZGVmZXJyZWQgb3ZlciBsb2NhbGx5LWRpdmVyZ2VkIGNvbnRlbnQgKGBoYW5kbGVDaGFuZ2VgXG4gICAqIGd1YXJkKSBhbmQgaGFzIG5vdCBiZWVuIHRocm91Z2ggYSBwbGFuIGN5Y2xlIHlldC4gVGhlIG5leHQgbWFuaWZlc3QgbXVzdFxuICAgKiBiZSBGVUxMIHNvIGBjb21wdXRlU3luY1BsYW5gIHNlZXMgdGhlIHJlbW90ZSBoZWFkIGFuZCByZXNvbHZlcyB0aGVcbiAgICogZGl2ZXJnZW5jZSB0aHJvdWdoIGl0cyBjb25mbGljdCBsb2dpYyBpbnN0ZWFkIG9mIGEgc3RhbGUtcGFyZW50IHB1c2guXG4gICAqL1xuICBuZWVkc0Z1bGxNYW5pZmVzdD86IGJvb2xlYW47XG59XG5cbi8qKiBPbmUgYXV0aG9yaXRhdGl2ZSBzdGF0ZSBjaGFuZ2UgdG8gZm9sZCBpbnRvIHRoZSBpbmRleC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgTG9jYWxJbmRleENvbW1pdCB7XG4gIHBhdGg6IHN0cmluZztcbiAgdmVyc2lvbklkOiBzdHJpbmc7XG4gIGhhc2g6IHN0cmluZztcbiAgc2l6ZTogbnVtYmVyO1xuICBjbG9jazogTG9naWNhbENsb2NrO1xuICAvKiogUHJlc2VudCBcdTIxRDIgdG9tYnN0b25lOiB0aGUgcGF0aCB3YXMgZGVsZXRlZCBhdCB0aGlzIGVwb2NoIG1zLiAqL1xuICBkZWxldGVkPzogYm9vbGVhbjtcbiAgLyoqIEVwb2NoIG1zIG9mIHRoZSBkZWxldGlvbiBcdTIwMTQgcmVxdWlyZWQgd2hlbiBgZGVsZXRlZGAgaXMgdHJ1ZS4gKi9cbiAgZGVsZXRlZEF0PzogbnVtYmVyO1xuICAvKiogVHJ1ZSB3aGVuIHRoaXMgY29tbWl0IHJlY29yZHMgYW4gZW1wdHktZm9sZGVyIHBsYWNlaG9sZGVyIChGUi0xMCkuICovXG4gIGlzRm9sZGVyPzogYm9vbGVhbjtcbiAgLyoqXG4gICAqIFN0b3JhZ2UgbXRpbWUgb2JzZXJ2ZWQgYXQgSEFTSCB0aW1lIGZvciB0aGlzIGV4YWN0IGNvbnRlbnQgXHUyMDE0IHBpbm5lZCBvbnRvXG4gICAqIHRoZSBlbnRyeSB3aGVuIHRoZSBjb21taXQgaXMgZm9sZGVkIChpLmUuIGF0IGNvbW1pdC1hY2sgdGltZSkuIFRocmVhZGluZ1xuICAgKiB0aGUgc3RhdCB0aGF0IGNvLW9jY3VycmVkIHdpdGggdGhlIGhhc2hlZCBieXRlcyAocmF0aGVyIHRoYW4gYW55XG4gICAqIGxhdGVyL2N1cnJlbnQgc3RhdCkgZ3VhcmFudGVlcyB0aGUgZmFzdC1wYXRoIGNhY2hlIGNhbiBuZXZlciBwYWlyIGFcbiAgICogZnJlc2hlciBzdGF0IHdpdGggdGhpcyBoYXNoLCB3aGljaCB3b3VsZCBoaWRlIGFuIGVkaXQgZnJvbSBldmVyeSBmdXR1cmVcbiAgICogc2NhbiAodGhlIHNpbGVudCBkcm9wcGVkLWVkaXQgY2xhc3MpLiBBYnNlbnQgXHUyMUQyIHVua25vd247IHRoZSBuZXh0IHNjYW5cbiAgICogcmUtaGFzaGVzIGFuZCByZWNvcmRzIHZpYSBgcmVjb3JkSGFzaGVkRmlsZXNgLlxuICAgKi9cbiAgbXRpbWU/OiBudW1iZXI7XG59XG5cbi8qKlxuICogRm9sZCBvbmUgY29tbWl0IGludG8gdGhlIGluZGV4LiBQdXJlOiByZXR1cm5zIGEgbmV3IGluZGV4LCBpbnB1dCB1bnRvdWNoZWQuXG4gKlxuICogQXBwbHlpbmcgYSBjb21taXQgZm9yIGEgcGF0aCByZXBsYWNlcyB0aGF0IHBhdGgncyBlbnRyeSB3aG9sZXNhbGUgKGEgY29tbWl0XG4gKiAqaXMqIHRoZSBuZXcgdHJ1dGggZm9yIHRoZSBwYXRoKTsgYGFwcGx5Q29tbWl0YCBuZXZlciBtZXJnZXMgZmllbGRzLlxuICogVG9tYnN0b25pbmcgKGBkZWxldGVkOiB0cnVlYCkgcmVxdWlyZXMgYGRlbGV0ZWRBdGAgYW5kIGtlZXBzIHRoZSBlbnRyeS5cbiAqXG4gKiBUbyBkcm9wIGFuIGVudHJ5IGVudGlyZWx5ICh0aGUgcGF0aCBtaWdyYXRlZCBhd2F5LCBlLmcuIGEgc3luY2VkIHJlbmFtZSlcbiAqIHVzZSBgcmVtb3ZlRW50cnlgIGluc3RlYWQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhcHBseUNvbW1pdChpbmRleDogTG9jYWxJbmRleCwgY29tbWl0OiBMb2NhbEluZGV4Q29tbWl0KTogTG9jYWxJbmRleCB7XG4gIGlmIChjb21taXQuZGVsZXRlZCAmJiBjb21taXQuZGVsZXRlZEF0ID09PSB1bmRlZmluZWQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBgYXBwbHlDb21taXQ6IHRvbWJzdG9uZSBmb3IgJHtKU09OLnN0cmluZ2lmeShjb21taXQucGF0aCl9IHJlcXVpcmVzIGRlbGV0ZWRBdGAsXG4gICAgKTtcbiAgfVxuICBjb25zdCBuZXh0OiBSZWNvcmQ8c3RyaW5nLCBMb2NhbEluZGV4RW50cnk+ID0geyAuLi5pbmRleCB9O1xuICBjb25zdCBlbnRyeTogTG9jYWxJbmRleEVudHJ5ID0ge1xuICAgIGhhc2g6IGNvbW1pdC5oYXNoLFxuICAgIHNpemU6IGNvbW1pdC5zaXplLFxuICAgIHZlcnNpb25JZDogY29tbWl0LnZlcnNpb25JZCxcbiAgICBjbG9jazogY29tbWl0LmNsb2NrLFxuICB9O1xuICBpZiAoY29tbWl0LmRlbGV0ZWQpIGVudHJ5LmRlbGV0ZWRBdCA9IGNvbW1pdC5kZWxldGVkQXQ7XG4gIGlmIChjb21taXQuaXNGb2xkZXIpIGVudHJ5LmlzRm9sZGVyID0gdHJ1ZTtcbiAgaWYgKGNvbW1pdC5tdGltZSAhPT0gdW5kZWZpbmVkKSBlbnRyeS5tdGltZSA9IGNvbW1pdC5tdGltZTtcbiAgbmV4dFtjb21taXQucGF0aF0gPSBlbnRyeTtcbiAgcmV0dXJuIG5leHQ7XG59XG5cbi8qKlxuICogUmVtb3ZlIGEgcGF0aCdzIGVudHJ5IGVudGlyZWx5IChubyB0b21ic3RvbmUpLiBVc2VkIHdoZW4gdGhlIGF1dGhvcml0eVxuICogbWlncmF0ZXMgYSBwYXRoJ3MgdmVyc2lvbiBjaGFpbiBlbHNld2hlcmUgXHUyMDE0IGkuZS4gYSBzeW5jZWQgcmVuYW1lOiB0aGUgb2xkXG4gKiBwYXRoIG11c3QgdmFuaXNoIGZyb20gdGhlIGluZGV4IGV4YWN0bHkgYXMgaXQgdmFuaXNoZWQgZnJvbSB0aGUgbWFuaWZlc3QuXG4gKiBQdXJlOyByZW1vdmluZyBhbiBhYnNlbnQgcGF0aCBpcyBhIG5vLW9wLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVtb3ZlRW50cnkoaW5kZXg6IExvY2FsSW5kZXgsIHBhdGg6IHN0cmluZyk6IExvY2FsSW5kZXgge1xuICBpZiAoIShwYXRoIGluIGluZGV4KSkgcmV0dXJuIGluZGV4O1xuICBjb25zdCBuZXh0OiBSZWNvcmQ8c3RyaW5nLCBMb2NhbEluZGV4RW50cnk+ID0geyAuLi5pbmRleCB9O1xuICBkZWxldGUgbmV4dFtwYXRoXTtcbiAgcmV0dXJuIG5leHQ7XG59XG5cbi8qKlxuICogU2VyaWFsaXplIHRvIGEgZGV0ZXJtaW5pc3RpYyBKU09OIHN0cmluZzogdmVyc2lvbmVkIGVudmVsb3BlLCBlbnRyaWVzXG4gKiBzb3J0ZWQgYnkgcGF0aCAoc28gaWRlbnRpY2FsIGluZGV4ZXMgc2VyaWFsaXplIGJ5dGUtaWRlbnRpY2FsbHkgYW5kIGRpZmZcbiAqIGNsZWFubHkgaW4gc3RhdGUtZGlyIGxpc3RpbmdzKS4gYHN0YXRlYCAob3B0aW9uYWwpIGNhcnJpZXMgdGhlIHN5bmMtY3Vyc29yXG4gKiBib29ra2VlcGluZyBwZXJzaXN0ZWQgYWxvbmdzaWRlIHRoZSBlbnRyaWVzIFx1MjAxNCBzZWUgYFBlcnNpc3RlZFN5bmNTdGF0ZWAuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXJpYWxpemVMb2NhbEluZGV4KGluZGV4OiBMb2NhbEluZGV4LCBzdGF0ZTogUGVyc2lzdGVkU3luY1N0YXRlID0ge30pOiBzdHJpbmcge1xuICBjb25zdCBlbnRyaWVzOiBSZWNvcmQ8c3RyaW5nLCBMb2NhbEluZGV4RW50cnk+ID0ge307XG4gIGZvciAoY29uc3QgcGF0aCBvZiBPYmplY3Qua2V5cyhpbmRleCkuc29ydCgpKSB7XG4gICAgZW50cmllc1twYXRoXSA9IGluZGV4W3BhdGhdIGFzIExvY2FsSW5kZXhFbnRyeTtcbiAgfVxuICBjb25zdCBlbnZlbG9wZTogTG9jYWxJbmRleEVudmVsb3BlID0ge1xuICAgIHNjaGVtYVZlcnNpb246IExPQ0FMX0lOREVYX1NDSEVNQV9WRVJTSU9OLFxuICAgIGVudHJpZXMsXG4gICAgLi4uKHN0YXRlLmN1cnNvciAhPT0gdW5kZWZpbmVkID8geyBjdXJzb3I6IHN0YXRlLmN1cnNvciB9IDoge30pLFxuICAgIC4uLihzdGF0ZS5zeW5jZWRUaHJvdWdoICE9PSB1bmRlZmluZWQgPyB7IHN5bmNlZFRocm91Z2g6IHN0YXRlLnN5bmNlZFRocm91Z2ggfSA6IHt9KSxcbiAgICAuLi4oc3RhdGUubmVlZHNGdWxsTWFuaWZlc3QgIT09IHVuZGVmaW5lZFxuICAgICAgPyB7IG5lZWRzRnVsbE1hbmlmZXN0OiBzdGF0ZS5uZWVkc0Z1bGxNYW5pZmVzdCB9XG4gICAgICA6IHt9KSxcbiAgfTtcbiAgcmV0dXJuIEpTT04uc3RyaW5naWZ5KGVudmVsb3BlKTtcbn1cblxuLyoqIFRoZSBlbnRyaWVzIHBsdXMgdGhlIHN5bmMtY3Vyc29yIGJvb2trZWVwaW5nIG9mIGEgcGVyc2lzdGVkIHN0YXRlIGZpbGUuICovXG5leHBvcnQgaW50ZXJmYWNlIERlc2VyaWFsaXplZExvY2FsU3RhdGUge1xuICBpbmRleDogTG9jYWxJbmRleDtcbiAgLyoqIEVudmVsb3BlIGJvb2trZWVwaW5nOyBkZWZhdWx0cyBmb3IgZmlsZXMgd3JpdHRlbiBiZWZvcmUgaXQgZXhpc3RlZC4gKi9cbiAgc3RhdGU6IFJlcXVpcmVkPFBlcnNpc3RlZFN5bmNTdGF0ZT47XG59XG5cbi8qKlxuICogUGFyc2UgYSBzZXJpYWxpemVkIHN0YXRlIGZpbGUgSU5DTFVESU5HIGl0cyBlbnZlbG9wZSBib29ra2VlcGluZyAodGhlXG4gKiBjbGllbnQncyBzdGFydHVwIHBhdGgpLiBFbnRyeSB2YWxpZGF0aW9uIGlzIGlkZW50aWNhbCB0b1xuICogYGRlc2VyaWFsaXplTG9jYWxJbmRleGA7IHRoZSBleHRyYSBmaWVsZHMgZGVmYXVsdCB0byBcIm5vIGN1cnNvciBrbm93bGVkZ2VcIlxuICogKGBjdXJzb3I6IDBgLCBgc3luY2VkVGhyb3VnaDogbnVsbGAsIGBuZWVkc0Z1bGxNYW5pZmVzdDogZmFsc2VgKSBzbyB2MlxuICogZmlsZXMgd3JpdHRlbiBieSBvbGRlciBidWlsZHMgbG9hZCB1bmNoYW5nZWQgYW5kIHNpbXBseSByZWNvbm5lY3Qgd2l0aCBhXG4gKiBmdWxsIG1hbmlmZXN0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gZGVzZXJpYWxpemVMb2NhbFN0YXRlKGpzb246IHN0cmluZyk6IERlc2VyaWFsaXplZExvY2FsU3RhdGUge1xuICBsZXQgcGFyc2VkOiB1bmtub3duO1xuICB0cnkge1xuICAgIHBhcnNlZCA9IEpTT04ucGFyc2UoanNvbik7XG4gIH0gY2F0Y2ggKGNhdXNlKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoJ0xvY2FsIGluZGV4IHN0YXRlIGlzIG5vdCB2YWxpZCBKU09OJywgeyBjYXVzZSB9KTtcbiAgfVxuICBpZiAoIWlzUGxhaW5PYmplY3QocGFyc2VkKSkge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKCdMb2NhbCBpbmRleCBzdGF0ZSBpcyBub3QgYW4gb2JqZWN0Jyk7XG4gIH1cbiAgLy8gRW50cnktbGV2ZWwgdmFsaWRhdGlvbiBpcyBleGFjdGx5IGBkZXNlcmlhbGl6ZUxvY2FsSW5kZXhgJ3M7IHRoZSBjYWxsXG4gIC8vIGFsc28gZW5mb3JjZXMgdGhlIHNjaGVtYS12ZXJzaW9uIHdpbmRvdy5cbiAgY29uc3QgaW5kZXggPSBkZXNlcmlhbGl6ZUxvY2FsSW5kZXgoanNvbik7XG4gIGNvbnN0IHJhd0N1cnNvciA9IChwYXJzZWQgYXMgeyBjdXJzb3I/OiB1bmtub3duIH0pLmN1cnNvcjtcbiAgY29uc3QgcmF3U3luY2VkVGhyb3VnaCA9IChwYXJzZWQgYXMgeyBzeW5jZWRUaHJvdWdoPzogdW5rbm93biB9KS5zeW5jZWRUaHJvdWdoO1xuICBjb25zdCByYXdOZWVkc0Z1bGwgPSAocGFyc2VkIGFzIHsgbmVlZHNGdWxsTWFuaWZlc3Q/OiB1bmtub3duIH0pLm5lZWRzRnVsbE1hbmlmZXN0O1xuICBpZiAocmF3Q3Vyc29yICE9PSB1bmRlZmluZWQgJiYgKHR5cGVvZiByYXdDdXJzb3IgIT09ICdudW1iZXInIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKHJhd0N1cnNvcikgfHwgcmF3Q3Vyc29yIDwgMCkpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcignTG9jYWwgaW5kZXggc3RhdGU6IGN1cnNvciBtdXN0IGJlIGEgbm9uLW5lZ2F0aXZlIGludGVnZXInKTtcbiAgfVxuICBpZiAoXG4gICAgcmF3U3luY2VkVGhyb3VnaCAhPT0gdW5kZWZpbmVkICYmXG4gICAgcmF3U3luY2VkVGhyb3VnaCAhPT0gbnVsbCAmJlxuICAgICh0eXBlb2YgcmF3U3luY2VkVGhyb3VnaCAhPT0gJ251bWJlcicgfHwgIU51bWJlci5pc0ludGVnZXIocmF3U3luY2VkVGhyb3VnaCkgfHwgcmF3U3luY2VkVGhyb3VnaCA8IDApXG4gICkge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKCdMb2NhbCBpbmRleCBzdGF0ZTogc3luY2VkVGhyb3VnaCBtdXN0IGJlIGEgbm9uLW5lZ2F0aXZlIGludGVnZXIgb3IgbnVsbCcpO1xuICB9XG4gIGlmIChyYXdOZWVkc0Z1bGwgIT09IHVuZGVmaW5lZCAmJiB0eXBlb2YgcmF3TmVlZHNGdWxsICE9PSAnYm9vbGVhbicpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcignTG9jYWwgaW5kZXggc3RhdGU6IG5lZWRzRnVsbE1hbmlmZXN0IG11c3QgYmUgYSBib29sZWFuIHdoZW4gcHJlc2VudCcpO1xuICB9XG4gIHJldHVybiB7XG4gICAgaW5kZXgsXG4gICAgc3RhdGU6IHtcbiAgICAgIGN1cnNvcjogdHlwZW9mIHJhd0N1cnNvciA9PT0gJ251bWJlcicgPyByYXdDdXJzb3IgOiAwLFxuICAgICAgc3luY2VkVGhyb3VnaDogdHlwZW9mIHJhd1N5bmNlZFRocm91Z2ggPT09ICdudW1iZXInID8gcmF3U3luY2VkVGhyb3VnaCA6IG51bGwsXG4gICAgICBuZWVkc0Z1bGxNYW5pZmVzdDogcmF3TmVlZHNGdWxsID09PSB0cnVlLFxuICAgIH0sXG4gIH07XG59XG5cbi8qKlxuICogUGFyc2UgYSBzZXJpYWxpemVkIGluZGV4IGJhY2suIFRocm93cyBgUHJvdG9jb2xFcnJvcmAgb24gbm9uLUpTT04gaW5wdXQsXG4gKiBhIG1hbGZvcm1lZCBlbnZlbG9wZSwgZW50cmllcyB3aXRoIHdyb25nIGZpZWxkIHR5cGVzLCBvciBhIGBzY2hlbWFWZXJzaW9uYFxuICogb3V0c2lkZSB0aGUgc3VwcG9ydGVkIHJhbmdlIChvbGRlciB0aGFuIGBNSU5fTE9DQUxfSU5ERVhfU0NIRU1BX1ZFUlNJT05gXG4gKiBvciBuZXdlciB0aGFuIGBMT0NBTF9JTkRFWF9TQ0hFTUFfVkVSU0lPTmApIFx1MjAxNCBvbGRlciB2ZXJzaW9ucyAqd2l0aGluKiB0aGVcbiAqIHJhbmdlIGxvYWQgd2l0aG91dCBlcnJvciAodjEgZW50cmllcyBzaW1wbHkgZGVzZXJpYWxpemUgd2l0aCBgbXRpbWVgXG4gKiB1bmtub3duKS4gVW5rbm93biBleHRyYSBmaWVsZHMgYXJlIHRvbGVyYXRlZCBmb3IgZm9yd2FyZCBjb21wYXRpYmlsaXR5LlxuICovXG5leHBvcnQgZnVuY3Rpb24gZGVzZXJpYWxpemVMb2NhbEluZGV4KGpzb246IHN0cmluZyk6IExvY2FsSW5kZXgge1xuICBsZXQgcGFyc2VkOiB1bmtub3duO1xuICB0cnkge1xuICAgIHBhcnNlZCA9IEpTT04ucGFyc2UoanNvbik7XG4gIH0gY2F0Y2ggKGNhdXNlKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoJ0xvY2FsIGluZGV4IHN0YXRlIGlzIG5vdCB2YWxpZCBKU09OJywgeyBjYXVzZSB9KTtcbiAgfVxuICBpZiAoIWlzUGxhaW5PYmplY3QocGFyc2VkKSkge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKCdMb2NhbCBpbmRleCBzdGF0ZSBpcyBub3QgYW4gb2JqZWN0Jyk7XG4gIH1cbiAgY29uc3QgdmVyc2lvbiA9IHBhcnNlZC5zY2hlbWFWZXJzaW9uO1xuICBpZiAodHlwZW9mIHZlcnNpb24gIT09ICdudW1iZXInIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKHZlcnNpb24pKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoJ0xvY2FsIGluZGV4IHN0YXRlIGlzIG1pc3NpbmcgaW50ZWdlciBzY2hlbWFWZXJzaW9uJyk7XG4gIH1cbiAgaWYgKHZlcnNpb24gPCBNSU5fTE9DQUxfSU5ERVhfU0NIRU1BX1ZFUlNJT04gfHwgdmVyc2lvbiA+IExPQ0FMX0lOREVYX1NDSEVNQV9WRVJTSU9OKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoXG4gICAgICBgTG9jYWwgaW5kZXggc2NoZW1hIHZlcnNpb24gJHt2ZXJzaW9ufSBpcyBub3Qgc3VwcG9ydGVkIGJ5IHRoaXMgYnVpbGQgYCArXG4gICAgICAgIGAoZXhwZWN0ZWQgJHtNSU5fTE9DQUxfSU5ERVhfU0NIRU1BX1ZFUlNJT059Li4ke0xPQ0FMX0lOREVYX1NDSEVNQV9WRVJTSU9OfSk7IGAgK1xuICAgICAgICAnYSBtaWdyYXRpb24gaXMgcmVxdWlyZWQnLFxuICAgICk7XG4gIH1cbiAgY29uc3QgcmF3RW50cmllcyA9IHBhcnNlZC5lbnRyaWVzO1xuICBpZiAoIWlzUGxhaW5PYmplY3QocmF3RW50cmllcykpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcignTG9jYWwgaW5kZXggc3RhdGUgaXMgbWlzc2luZyB0aGUgZW50cmllcyBvYmplY3QnKTtcbiAgfVxuXG4gIGNvbnN0IGVudHJpZXM6IFJlY29yZDxzdHJpbmcsIExvY2FsSW5kZXhFbnRyeT4gPSB7fTtcbiAgZm9yIChjb25zdCBbcGF0aCwgcmF3XSBvZiBPYmplY3QuZW50cmllcyhyYXdFbnRyaWVzKSkge1xuICAgIGVudHJpZXNbcGF0aF0gPSBwYXJzZUVudHJ5KHBhdGgsIHJhdyk7XG4gIH1cbiAgcmV0dXJuIGVudHJpZXM7XG59XG5cbmZ1bmN0aW9uIHBhcnNlRW50cnkocGF0aDogc3RyaW5nLCByYXc6IHVua25vd24pOiBMb2NhbEluZGV4RW50cnkge1xuICBjb25zdCB3aGVyZSA9IGBMb2NhbCBpbmRleCBlbnRyeSAke0pTT04uc3RyaW5naWZ5KHBhdGgpfWA7XG4gIGlmICghaXNQbGFpbk9iamVjdChyYXcpKSB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgJHt3aGVyZX0gaXMgbm90IGFuIG9iamVjdGApO1xuICBjb25zdCB7IGhhc2gsIHNpemUsIHZlcnNpb25JZCwgY2xvY2ssIGRlbGV0ZWRBdCwgaXNGb2xkZXIsIG10aW1lIH0gPSByYXcgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIGlmICh0eXBlb2YgaGFzaCAhPT0gJ3N0cmluZycpIHRocm93IG5ldyBQcm90b2NvbEVycm9yKGAke3doZXJlfTogaGFzaCBtdXN0IGJlIGEgc3RyaW5nYCk7XG4gIGlmICh0eXBlb2YgdmVyc2lvbklkICE9PSAnc3RyaW5nJykge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKGAke3doZXJlfTogdmVyc2lvbklkIG11c3QgYmUgYSBzdHJpbmdgKTtcbiAgfVxuICBpZiAodHlwZW9mIHNpemUgIT09ICdudW1iZXInIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKHNpemUpIHx8IHNpemUgPCAwKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoYCR7d2hlcmV9OiBzaXplIG11c3QgYmUgYSBub24tbmVnYXRpdmUgaW50ZWdlcmApO1xuICB9XG4gIGlmICghaXNQbGFpbk9iamVjdChjbG9jaykgfHwgdHlwZW9mIGNsb2NrLmNvdW50ZXIgIT09ICdudW1iZXInIHx8IHR5cGVvZiBjbG9jay5kZXZpY2VJZCAhPT0gJ3N0cmluZycpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgJHt3aGVyZX06IGNsb2NrIG11c3QgYmUgeyBjb3VudGVyOiBudW1iZXIsIGRldmljZUlkOiBzdHJpbmcgfWApO1xuICB9XG4gIGlmIChkZWxldGVkQXQgIT09IHVuZGVmaW5lZCAmJiB0eXBlb2YgZGVsZXRlZEF0ICE9PSAnbnVtYmVyJykge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKGAke3doZXJlfTogZGVsZXRlZEF0IG11c3QgYmUgYSBudW1iZXIgd2hlbiBwcmVzZW50YCk7XG4gIH1cbiAgaWYgKGlzRm9sZGVyICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIGlzRm9sZGVyICE9PSAnYm9vbGVhbicpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgJHt3aGVyZX06IGlzRm9sZGVyIG11c3QgYmUgYSBib29sZWFuIHdoZW4gcHJlc2VudGApO1xuICB9XG4gIGlmIChtdGltZSAhPT0gdW5kZWZpbmVkICYmICh0eXBlb2YgbXRpbWUgIT09ICdudW1iZXInIHx8ICFOdW1iZXIuaXNGaW5pdGUobXRpbWUpKSkge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKGAke3doZXJlfTogbXRpbWUgbXVzdCBiZSBhIGZpbml0ZSBudW1iZXIgd2hlbiBwcmVzZW50YCk7XG4gIH1cbiAgY29uc3QgZW50cnk6IExvY2FsSW5kZXhFbnRyeSA9IHtcbiAgICBoYXNoLFxuICAgIHNpemUsXG4gICAgdmVyc2lvbklkLFxuICAgIGNsb2NrOiB7IGNvdW50ZXI6IGNsb2NrLmNvdW50ZXIgYXMgbnVtYmVyLCBkZXZpY2VJZDogY2xvY2suZGV2aWNlSWQgYXMgc3RyaW5nIH0sXG4gIH07XG4gIGlmIChkZWxldGVkQXQgIT09IHVuZGVmaW5lZCkgZW50cnkuZGVsZXRlZEF0ID0gZGVsZXRlZEF0IGFzIG51bWJlcjtcbiAgaWYgKGlzRm9sZGVyICE9PSB1bmRlZmluZWQpIGVudHJ5LmlzRm9sZGVyID0gaXNGb2xkZXIgYXMgYm9vbGVhbjtcbiAgaWYgKG10aW1lICE9PSB1bmRlZmluZWQpIGVudHJ5Lm10aW1lID0gbXRpbWUgYXMgbnVtYmVyO1xuICByZXR1cm4gZW50cnk7XG59XG5cbmZ1bmN0aW9uIGlzUGxhaW5PYmplY3QodmFsdWU6IHVua25vd24pOiB2YWx1ZSBpcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB7XG4gIHJldHVybiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIHZhbHVlICE9PSBudWxsICYmICFBcnJheS5pc0FycmF5KHZhbHVlKTtcbn1cbiIsICIvKipcbiAqIFRoaW4gcHVsbC1zaWRlIG9yY2hlc3RyYXRpb24gKEFSQ0hJVEVDVFVSRS5tZCBcdTAwQTc4IHN0ZXAgNSkuIE5PVCB0aGUgbmV0d29ya1xuICogY2xpZW50OiBhbGwgdHJhbnNwb3J0IGlzIGluamVjdGVkIChgZmV0Y2hCbG9iYCksIHdoaWNoIHRoZSBsYXRlciBuZXR3b3JrXG4gKiBwaGFzZSBpbXBsZW1lbnRzIG92ZXIgYC9ibG9iLzpoYXNoYCBvciBXUy1pbmxpbmUgY29udGVudC5cbiAqXG4gKiBgYXBwbHlQdWxsYCBtYXRlcmlhbGl6ZXMgZXZlcnkgYFB1bGxPcGAgb2YgYSBgU3luY1BsYW5gIHRocm91Z2ggdGhlXG4gKiBzdG9yYWdlIGFkYXB0ZXIgYW5kIHVwZGF0ZXMgdGhlIGxvY2FsIGluZGV4IFx1MjAxNCBkdXJhYmx5IGFuZCBob25lc3RseTpcbiAqXG4gKiAgIC0gYmxvYnMgYXJlIHZlcmlmaWVkIChzaGEyNTYpIGJlZm9yZSBiZWluZyB3cml0dGVuOyBhIG1pc21hdGNoIGFib3J0c1xuICogICAgIHRoZSBwbGFuO1xuICogICAtIGVhY2ggaW5kZXggZW50cnkgaXMgcmVjb3JkZWQgb25seSAqYWZ0ZXIqIGl0cyBzdG9yYWdlIHdyaXRlIHN1Y2NlZWRlZCxcbiAqICAgICBzbyBhIG1pZC1wbGFuIGZhaWx1cmUgbGVhdmVzIHRoZSBpbmRleCBkZXNjcmliaW5nIGV4YWN0bHkgdGhlIGZpbGVzXG4gKiAgICAgdGhhdCBhY3R1YWxseSBsYW5kZWQgKEZSLTU6IG5vdGhpbmcgaXMgc2lsZW50bHkgbG9zdCBcdTIwMTQgdGhlIHVuc3luY2VkXG4gKiAgICAgcHVsbHMgc2ltcGx5IHJlbWFpbiBpbiB0aGUgcGxhbiBhbmQgYXJlIHJldHJpZWQgYnkgdGhlIGNhbGxlcik7XG4gKiAgIC0gdGhlIGluZGV4IGlzIHBlcnNpc3RlZCB0aHJvdWdoIHRoZSBhZGFwdGVyJ3MgYXRvbWljIGB3cml0ZUZpbGVgXG4gKiAgICAgKHRlbXAgKyByZW5hbWUgcGVyIHRoZSBhZGFwdGVyIGNvbnRyYWN0KSBhdFxuICogICAgIGAvLnZhdWx0c3luY2ZvcmFnZW50cy9zdGF0ZWAsIGluY2x1ZGluZyBvbiB0aGUgZmFpbHVyZSBwYXRoLlxuICpcbiAqIEZvbGRlciBsaWZlY3ljbGUgKEZSLTEwIGFuZCBpdHMgZGVsZXRpb24gY291bnRlcnBhcnQpOlxuICpcbiAqICAgLSBhcHBseWluZyBhIFJFTU9URSBGT0xERVIgVE9NQlNUT05FIHJlbW92ZXMgdGhlIGxvY2FsIGRpcmVjdG9yeSB3aGVuXG4gKiAgICAgaXQgZXhpc3RzIGFuZCBpcyBlbXB0eSAoYWRhcHRlciBgcmVtb3ZlRGlyYCk7IG5vbi1lbXB0eSBvciBtaXNzaW5nIFx1MjFEMlxuICogICAgIHJlY29yZCB0aGUgdG9tYnN0b25lIG9ubHkgXHUyMDE0IHRoZSBkaXJlY3RvcnkgY29udmVyZ2VzIGxhdGVyLCBhbmQgYVxuICogICAgIG5vbi1lbXB0eSBkaXJlY3RvcnkgaXMgbmV2ZXIgZGVsZXRlZDtcbiAqICAgLSBQUlVORS1PTi1ERUxFVEU6IGFwcGx5aW5nIGEgcmVtb3RlIGZpbGUgZGVsZXRpb24gKG9yIHJlbmFtZSBhd2F5KVxuICogICAgIHJlbW92ZXMgdGhlIGRlbGV0ZWQgcGF0aCdzIHBhcmVudCBkaXJlY3Rvcnkgd2hlbiBpdCBpcyBub3cgZW1wdHkgb25cbiAqICAgICBkaXNrIGFuZCBob2xkcyBubyBsaXZlIGZpbGUgZW50cmllcyBpbiB0aGUgaW5kZXggXHUyMDE0IHRoaXMgaXMgd2hhdCBzdG9wc1xuICogICAgIGFuIGVtcHRpZWQgZGlyZWN0b3J5IGZyb20gc2VsZi1yZXN1cnJlY3RpbmcgYXMgYW4gZW1wdHktZm9sZGVyXG4gKiAgICAgcGxhY2Vob2xkZXIgb24gdGhlIG5leHQgc2Nhbi4gRXhhY3RseSBPTkUgbGV2ZWwgcGVyIGRlbGV0aW9uOiB0aGVcbiAqICAgICBpbW1lZGlhdGUgcGFyZW50IG9ubHksIG5ldmVyIGEgY2FzY2FkZSAoYSBjaGFpbiBvZiBlbXB0aWVkXG4gKiAgICAgZGlyZWN0b3JpZXMgY29udmVyZ2VzIG92ZXIgc3VjY2Vzc2l2ZSBjeWNsZXM7IHRoZSBzYWZldHkgaW52YXJpYW50IFx1MjAxNFxuICogICAgIG5ldmVyIGRlbGV0ZSBhIG5vbi1lbXB0eSBkaXJlY3RvcnksIG5ldmVyIGxvc2UgdXNlciBjb250ZW50IFx1MjAxNCBpc1xuICogICAgIGNoZWNrZWQgYmVmb3JlIGV2ZXJ5IHJlbW92YWwpLlxuICpcbiAqIFB1c2hlcy9jb25mbGljdHMvZm9sZGVyIG9wcyBhcmUgdGhlIG5ldHdvcmsgcGhhc2UncyBidXNpbmVzczsgcmV0cnlcbiAqIHF1ZXVlcyBhcmUgZXhwbGljaXRseSBvdXQgb2Ygc2NvcGUgaGVyZS5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IFN0b3JhZ2VBZGFwdGVyIH0gZnJvbSAnLi9hZGFwdGVycy5qcyc7XG5pbXBvcnQgeyBzaGEyNTZIZXggfSBmcm9tICcuL2hhc2hpbmcuanMnO1xuaW1wb3J0IHtcbiAgYXBwbHlDb21taXQsXG4gIGRlc2VyaWFsaXplTG9jYWxTdGF0ZSxcbiAgTE9DQUxfSU5ERVhfU1RBVEVfUEFUSCxcbiAgcmVtb3ZlRW50cnksXG4gIHNlcmlhbGl6ZUxvY2FsSW5kZXgsXG4gIHR5cGUgRGVzZXJpYWxpemVkTG9jYWxTdGF0ZSxcbiAgdHlwZSBMb2NhbEluZGV4LFxuICB0eXBlIFBlcnNpc3RlZFN5bmNTdGF0ZSxcbn0gZnJvbSAnLi9sb2NhbGluZGV4LmpzJztcbmltcG9ydCB7IGlzU3RyaWN0bHlCZW5lYXRoLCBwYXJlbnRQYXRoIH0gZnJvbSAnLi9wYXRocy5qcyc7XG5pbXBvcnQgdHlwZSB7IFB1bGxPcCwgU3luY1BsYW4gfSBmcm9tICcuL3Jlc29sdmUuanMnO1xuXG4vKiogSW5qZWN0ZWQgY29udGVudCB0cmFuc3BvcnQ6IGZldGNoIHRoZSBibG9iIGZvciBhIGNvbnRlbnQgaGFzaC4gKi9cbmV4cG9ydCB0eXBlIEZldGNoQmxvYiA9IChoYXNoOiBzdHJpbmcpID0+IFByb21pc2U8VWludDhBcnJheT47XG5cbmV4cG9ydCBpbnRlcmZhY2UgQXBwbHlQdWxsT3B0aW9ucyB7XG4gIC8qKiBFcG9jaCBtcyB1c2VkIGZvciB0b21ic3RvbmUgdGltZXN0YW1wcy4gRGVmYXVsdDogYERhdGUubm93KClgIFx1MjAxNCB0aGlzXG4gICAqICBmdW5jdGlvbiBpcyBJL08gb3JjaGVzdHJhdGlvbiwgbm90IGEgcHVyZSBmdW5jdGlvbiwgYnV0IHRlc3RzIGluamVjdFxuICAgKiAgYSBmaXhlZCB2YWx1ZSBmb3IgZGV0ZXJtaW5pc20uICovXG4gIG5vdz86IG51bWJlcjtcbiAgLyoqXG4gICAqIEJ1bGstcHVsbCBwcm9ncmVzczogY2FsbGVkIG9uY2Ugd2l0aCAoMCwgdG90YWwpIHVwIGZyb250IGFuZCBvbmNlIGFmdGVyXG4gICAqIGVhY2ggcHVsbCBtYXRlcmlhbGl6ZXMuIFB1cmUgcmVwb3J0aW5nIFx1MjAxNCBuZXZlciBhZmZlY3RzIGFwcGxpY2F0aW9uLlxuICAgKi9cbiAgb25Qcm9ncmVzcz86IChkb25lOiBudW1iZXIsIHRvdGFsOiBudW1iZXIpID0+IHZvaWQ7XG4gIC8qKlxuICAgKiBTeW5jLWN1cnNvciBib29ra2VlcGluZyB0byB3cml0ZSBpbnRvIHRoZSBzdGF0ZSBmaWxlJ3MgZW52ZWxvcGUgd2hlbmV2ZXJcbiAgICogdGhpcyBjYWxsIHBlcnNpc3RzIHRoZSBpbmRleC4gV2l0aG91dCBpdCBhIHB1bGwtc2lkZSBwZXJzaXN0IHdvdWxkIHN0cmlwXG4gICAqIHRoZSBjbGllbnQncyBjdXJzb3Ivc3luY2VkVGhyb3VnaCBmaWVsZHMgZnJvbSBgLy52YXVsdHN5bmNmb3JhZ2VudHMvc3RhdGVgXG4gICAqICh0aGUgZW52ZWxvcGUgaXMgcmV3cml0dGVuIHdob2xlc2FsZSkuIFRoZSBjbGllbnQgcGFzc2VzIGl0cyBjdXJyZW50XG4gICAqIHZhbHVlczsgYSBzbmFwc2hvdCBhIG1vbWVudCBzdGFsZSBpcyBoYXJtbGVzcyBcdTIwMTQgdGhlIG5leHQgcGVyc2lzdCByZWZyZXNoZXNcbiAgICogaXQsIGFuZCBhbiB1bmRlci1yZXBvcnRlZCBjdXJzb3Igb25seSB3aWRlbnMgdGhlIG5leHQgcmVwbGF5LlxuICAgKi9cbiAgcGVyc2lzdGVkU3RhdGU/OiBQZXJzaXN0ZWRTeW5jU3RhdGU7XG59XG5cbi8qKlxuICogQXBwbHkgYWxsIHB1bGxzIG9mIGBwbGFuYCBhbmQgcmV0dXJuIHRoZSB1cGRhdGVkIGluZGV4IChhbHNvIHBlcnNpc3RlZCB0b1xuICogdGhlIGFkYXB0ZXIgYXQgYExPQ0FMX0lOREVYX1NUQVRFX1BBVEhgKS5cbiAqXG4gKiBTdG9yYWdlIHdyaXRlcyBoYXBwZW4gaW4gcGxhbiBvcmRlci4gSWYgYW55IG9wIGZhaWxzLCB0aGUgaW5kZXggcmVmbGVjdGluZ1xuICogZXZlcnkgb3AgdGhhdCBzdWNjZWVkZWQgc28gZmFyIGlzIHBlcnNpc3RlZCBhbmQgdGhlIG9yaWdpbmFsIGVycm9yIGlzXG4gKiByZXRocm93biBcdTIwMTQgcGF0aHMgdGhhdCBmYWlsZWQgYXJlIGFic2VudCBmcm9tIHRoZSByZXR1cm5lZC9wZXJzaXN0ZWQgaW5kZXguXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBhcHBseVB1bGwoXG4gIHN0b3JhZ2U6IFN0b3JhZ2VBZGFwdGVyLFxuICBpbmRleDogTG9jYWxJbmRleCxcbiAgcGxhbjogU3luY1BsYW4sXG4gIGZldGNoQmxvYjogRmV0Y2hCbG9iLFxuICBvcHRpb25zOiBBcHBseVB1bGxPcHRpb25zID0ge30sXG4pOiBQcm9taXNlPExvY2FsSW5kZXg+IHtcbiAgY29uc3Qgbm93ID0gb3B0aW9ucy5ub3cgPz8gRGF0ZS5ub3coKTtcbiAgY29uc3Qgb25Qcm9ncmVzcyA9IG9wdGlvbnMub25Qcm9ncmVzcztcbiAgbGV0IHdvcmtpbmc6IExvY2FsSW5kZXggPSBpbmRleDtcblxuICBvblByb2dyZXNzPy4oMCwgcGxhbi5wdWxscy5sZW5ndGgpO1xuICBsZXQgZG9uZSA9IDA7XG4gIHRyeSB7XG4gICAgZm9yIChjb25zdCBwdWxsIG9mIHBsYW4ucHVsbHMpIHtcbiAgICAgIHdvcmtpbmcgPSBhd2FpdCBhcHBseU9uZVB1bGwoc3RvcmFnZSwgd29ya2luZywgcHVsbCwgZmV0Y2hCbG9iLCBub3cpO1xuICAgICAgZG9uZSArPSAxO1xuICAgICAgb25Qcm9ncmVzcz8uKGRvbmUsIHBsYW4ucHVsbHMubGVuZ3RoKTtcbiAgICB9XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHBlcnNpc3RJbmRleChzdG9yYWdlLCB3b3JraW5nLCBvcHRpb25zLnBlcnNpc3RlZFN0YXRlKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIFBlcnNpc3RlbmNlIGZhaWx1cmUgbXVzdCBub3QgbWFzayB0aGUgb3JpZ2luYWwgZXJyb3I7IHRoZSBjYWxsZXJcbiAgICAgIC8vIHJldHJpZXMgdGhlIHdob2xlIGN5Y2xlIGFueXdheS5cbiAgICB9XG4gICAgdGhyb3cgZXJyb3I7XG4gIH1cblxuICBhd2FpdCBwZXJzaXN0SW5kZXgoc3RvcmFnZSwgd29ya2luZywgb3B0aW9ucy5wZXJzaXN0ZWRTdGF0ZSk7XG4gIHJldHVybiB3b3JraW5nO1xufVxuXG5hc3luYyBmdW5jdGlvbiBhcHBseU9uZVB1bGwoXG4gIHN0b3JhZ2U6IFN0b3JhZ2VBZGFwdGVyLFxuICBpbmRleDogTG9jYWxJbmRleCxcbiAgcHVsbDogUHVsbE9wLFxuICBmZXRjaEJsb2I6IEZldGNoQmxvYixcbiAgbm93OiBudW1iZXIsXG4pOiBQcm9taXNlPExvY2FsSW5kZXg+IHtcbiAgaWYgKHB1bGwua2luZCA9PT0gJ3JlbmFtZScpIHtcbiAgICBpZiAoYXdhaXQgc3RvcmFnZS5leGlzdHMocHVsbC5mcm9tUGF0aCkpIHtcbiAgICAgIGF3YWl0IHN0b3JhZ2UucmVuYW1lRmlsZShwdWxsLmZyb21QYXRoLCBwdWxsLnRvUGF0aCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIE9sZCBwYXRoIG5ldmVyIG1hdGVyaWFsaXplZCBoZXJlIChvciBhbHJlYWR5IG1vdmVkKTogZmV0Y2ggY29udGVudC5cbiAgICAgIGF3YWl0IGZldGNoVmVyaWZpZWQoc3RvcmFnZSwgcHVsbC50b1BhdGgsIHB1bGwuaGFzaCwgZmV0Y2hCbG9iKTtcbiAgICB9XG4gICAgY29uc3QgbW92ZWQgPSBhcHBseUNvbW1pdChyZW1vdmVFbnRyeShpbmRleCwgcHVsbC5mcm9tUGF0aCksIHtcbiAgICAgIHBhdGg6IHB1bGwudG9QYXRoLFxuICAgICAgdmVyc2lvbklkOiBwdWxsLnZlcnNpb24sXG4gICAgICBoYXNoOiBwdWxsLmhhc2gsXG4gICAgICBzaXplOiBwdWxsLnNpemUsXG4gICAgICBjbG9jazogcHVsbC5jbG9jayxcbiAgICB9KTtcbiAgICAvLyBUaGUgbGFzdCBmaWxlIG1heSBqdXN0IGhhdmUgbGVmdCBpdHMgb2xkIHBhcmVudCBkaXJlY3RvcnkgKHBydW5lLW9uLVxuICAgIC8vIGRlbGV0ZSBhcHBsaWVzIHRvIG1vdmVzIHRvbzsgdGhlIHJlbmFtZSBpdHNlbGYgaXMgdW50b3VjaGVkKS5cbiAgICBhd2FpdCBwcnVuZVBhcmVudE9uRGVsZXRlKHN0b3JhZ2UsIG1vdmVkLCBwdWxsLmZyb21QYXRoKTtcbiAgICByZXR1cm4gbW92ZWQ7XG4gIH1cblxuICBpZiAocHVsbC5pc0ZvbGRlcikge1xuICAgIC8vIEZvbGRlciBwbGFjZWhvbGRlcnMgKEZSLTEwKTogY3JlYXRlIHRoZSBkaXJlY3RvcnksIHJlY29yZCB0aGUgZW50cnkuXG4gICAgLy8gQSBmb2xkZXIgVE9NQlNUT05FIGFkZGl0aW9uYWxseSByZW1vdmVzIHRoZSBsb2NhbCBkaXJlY3Rvcnkgd2hlbiBpdFxuICAgIC8vIGV4aXN0cyBhbmQgaXMgZW1wdHk7IG5vbi1lbXB0eSBvciBtaXNzaW5nIFx1MjFEMiByZWNvcmQgb25seSAoY29udmVyZ2VzXG4gICAgLy8gbGF0ZXIgXHUyMDE0IGEgbm9uLWVtcHR5IGRpcmVjdG9yeSBpcyBuZXZlciBkZWxldGVkIGhlcmUpLlxuICAgIGlmIChwdWxsLmRlbGV0ZWQpIHtcbiAgICAgIGF3YWl0IHJlbW92ZURpcklmVmFjYW50KHN0b3JhZ2UsIGluZGV4LCBwdWxsLnBhdGgpO1xuICAgIH0gZWxzZSB7XG4gICAgICBhd2FpdCBzdG9yYWdlLmVuc3VyZURpcihwdWxsLnBhdGgpO1xuICAgIH1cbiAgICByZXR1cm4gYXBwbHlDb21taXQoaW5kZXgsIHtcbiAgICAgIHBhdGg6IHB1bGwucGF0aCxcbiAgICAgIHZlcnNpb25JZDogcHVsbC52ZXJzaW9uLFxuICAgICAgaGFzaDogcHVsbC5oYXNoLFxuICAgICAgc2l6ZTogcHVsbC5zaXplLFxuICAgICAgY2xvY2s6IHB1bGwuY2xvY2ssXG4gICAgICBkZWxldGVkOiBwdWxsLmRlbGV0ZWQsXG4gICAgICBkZWxldGVkQXQ6IHB1bGwuZGVsZXRlZCA/IG5vdyA6IHVuZGVmaW5lZCxcbiAgICAgIGlzRm9sZGVyOiB0cnVlLFxuICAgIH0pO1xuICB9XG5cbiAgaWYgKHB1bGwuZGVsZXRlZCkge1xuICAgIC8vIElkZW1wb3RlbnQgcGVyIHRoZSBhZGFwdGVyIGNvbnRyYWN0OyBhIGxvY2FsIC50cmFzaCBjb3B5IGlzIGFcbiAgICAvLyBwbGF0Zm9ybS1sYXllciBjb25jZXJuIChkYWVtb24vcGx1Z2luKSwgbm90IGVuZ2luZSBsb2dpYy5cbiAgICBhd2FpdCBzdG9yYWdlLmRlbGV0ZUZpbGUocHVsbC5wYXRoKTtcbiAgICBjb25zdCB0b21ic3RvbmVkID0gYXBwbHlDb21taXQoaW5kZXgsIHtcbiAgICAgIHBhdGg6IHB1bGwucGF0aCxcbiAgICAgIHZlcnNpb25JZDogcHVsbC52ZXJzaW9uLFxuICAgICAgaGFzaDogcHVsbC5oYXNoLFxuICAgICAgc2l6ZTogcHVsbC5zaXplLFxuICAgICAgY2xvY2s6IHB1bGwuY2xvY2ssXG4gICAgICBkZWxldGVkOiB0cnVlLFxuICAgICAgZGVsZXRlZEF0OiBub3csXG4gICAgfSk7XG4gICAgLy8gUHJ1bmUtb24tZGVsZXRlOiBhbiBlbXB0aWVkIHBhcmVudCBkaXJlY3RvcnkgbXVzdCBub3QgbGluZ2VyIGFuZFxuICAgIC8vIHJlLXN1cmZhY2UgYXMgYW4gZW1wdHktZm9sZGVyIHBsYWNlaG9sZGVyIG9uIHRoZSBuZXh0IHNjYW4uXG4gICAgYXdhaXQgcHJ1bmVQYXJlbnRPbkRlbGV0ZShzdG9yYWdlLCB0b21ic3RvbmVkLCBwdWxsLnBhdGgpO1xuICAgIHJldHVybiB0b21ic3RvbmVkO1xuICB9XG5cbiAgY29uc3QgY3VycmVudCA9IGluZGV4W3B1bGwucGF0aF07XG4gIGlmIChcbiAgICBjdXJyZW50ICE9PSB1bmRlZmluZWQgJiZcbiAgICBjdXJyZW50LmRlbGV0ZWRBdCA9PT0gdW5kZWZpbmVkICYmXG4gICAgY3VycmVudC5oYXNoID09PSBwdWxsLmhhc2ggJiZcbiAgICAoYXdhaXQgc3RvcmFnZS5leGlzdHMocHVsbC5wYXRoKSlcbiAgKSB7XG4gICAgLy8gQ29udGVudCBhbHJlYWR5IGNvcnJlY3QgbG9jYWxseSAoZS5nLiB2ZXJzaW9uLWlkIGNhdGNoLXVwIGFmdGVyIGFcbiAgICAvLyByZW5hbWUgZWxzZXdoZXJlKTogcmVjb3JkIHRoZSBhdXRob3JpdGF0aXZlIGhlYWQsIHNraXAgZmV0Y2grd3JpdGUuXG4gICAgLy8gVGhlIGV4aXN0ZW5jZSBjaGVjayBtYXR0ZXJzIHdoZW4gdGhlIGZpbGUgd2FzIGRlbGV0ZWQgbG9jYWxseSBzaW5jZSB0aGVcbiAgICAvLyBpbmRleCB3YXMgbGFzdCB3cml0dGVuIFx1MjAxNCByZWNyZWF0aW5nIGl0IGlzIHdoYXQgdGhlIHB1bGwgZGVtYW5kcy5cbiAgICByZXR1cm4gYXBwbHlDb21taXQoaW5kZXgsIHtcbiAgICAgIHBhdGg6IHB1bGwucGF0aCxcbiAgICAgIHZlcnNpb25JZDogcHVsbC52ZXJzaW9uLFxuICAgICAgaGFzaDogcHVsbC5oYXNoLFxuICAgICAgc2l6ZTogcHVsbC5zaXplLFxuICAgICAgY2xvY2s6IHB1bGwuY2xvY2ssXG4gICAgfSk7XG4gIH1cblxuICBhd2FpdCBmZXRjaFZlcmlmaWVkKHN0b3JhZ2UsIHB1bGwucGF0aCwgcHVsbC5oYXNoLCBmZXRjaEJsb2IpO1xuICByZXR1cm4gYXBwbHlDb21taXQoaW5kZXgsIHtcbiAgICBwYXRoOiBwdWxsLnBhdGgsXG4gICAgdmVyc2lvbklkOiBwdWxsLnZlcnNpb24sXG4gICAgaGFzaDogcHVsbC5oYXNoLFxuICAgIHNpemU6IHB1bGwuc2l6ZSxcbiAgICBjbG9jazogcHVsbC5jbG9jayxcbiAgfSk7XG59XG5cbi8vIC0tLSBmb2xkZXIgbGlmZWN5Y2xlIGhlbHBlcnMgKEI6IHRvbWJzdG9uZS1hcHBseSwgQzogcHJ1bmUtb24tZGVsZXRlKSAtLS0tLS0tLVxuXG4vKiogT3V0Y29tZSBvZiBhIHBydW5lIGF0dGVtcHQ6IHRoZSBkaXJlY3RvcnkganVkZ2VkIGRlbGV0YWJsZSwgYW5kIHdoZXRoZXIgaXQgd2FzLiAqL1xuZXhwb3J0IGludGVyZmFjZSBQcnVuZWREaXIge1xuICAvKiogVGhlIGRpcmVjdG9yeSB0aGF0IHF1YWxpZmllZCBmb3IgcmVtb3ZhbCAodGhlIGRlbGV0ZWQgcGF0aCdzIHBhcmVudCkuICovXG4gIGRpcjogc3RyaW5nO1xuICAvKiogV2hldGhlciBgc3RvcmFnZS5yZW1vdmVEaXJgIGFjdHVhbGx5IHJlbW92ZWQgaXQgKGZhbHNlIHdoZW4gdGhlIGFkYXB0ZXJcbiAgICogIGxhY2tzIHRoZSBob29rIG9yIHJlZnVzZWQgXHUyMDE0IGVsaWdpYmlsaXR5IGFsb25lIHN0aWxsIHN1cHByZXNzZXMgYVxuICAgKiAgcGxhY2Vob2xkZXIgcHVzaCBmb3IgaXQsIGBjbGllbnQudHNgKS4gKi9cbiAgcmVtb3ZlZDogYm9vbGVhbjtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIGBkaXJgIG1heSBiZSBkZWxldGVkIHdpdGhvdXQgbG9zaW5nIGFueXRoaW5nOiBpdCBleGlzdHMsIG5vdGhpbmdcbiAqIChmaWxlIG9yIGRpcmVjdG9yeSkgbGl2ZXMgYmVuZWF0aCBpdCBpbiBzdG9yYWdlLCBhbmQgdGhlIGluZGV4IGhvbGRzIG5vXG4gKiBsaXZlIGZpbGUgZW50cnkgYmVuZWF0aCBpdC4gVGhlIHJvb3QgaXMgbmV2ZXIgZGVsZXRhYmxlLiBUaGlzIGlzIHRoZVxuICogbmV2ZXItZGVsZXRlLW5vbi1lbXB0eSAvIG5ldmVyLWxvc2UtY29udGVudCBpbnZhcmlhbnQgbWFkZSBleHBsaWNpdCBcdTIwMTRcbiAqIGV2ZXJ5IGRpcmVjdG9yeSByZW1vdmFsIGluIGNvcmUgZ29lcyB0aHJvdWdoIGl0LlxuICovXG5hc3luYyBmdW5jdGlvbiBkaXJJc1ZhY2FudChcbiAgc3RvcmFnZTogU3RvcmFnZUFkYXB0ZXIsXG4gIGluZGV4OiBMb2NhbEluZGV4LFxuICBkaXI6IHN0cmluZyxcbik6IFByb21pc2U8Ym9vbGVhbj4ge1xuICBpZiAoZGlyID09PSAnLycpIHJldHVybiBmYWxzZTtcbiAgaWYgKCEoYXdhaXQgc3RvcmFnZS5leGlzdHMoZGlyKSkpIHJldHVybiBmYWxzZTtcbiAgZm9yIChjb25zdCBmaWxlIG9mIGF3YWl0IHN0b3JhZ2UubGlzdEZpbGVzKCkpIHtcbiAgICBpZiAoaXNTdHJpY3RseUJlbmVhdGgoZmlsZS5wYXRoLCBkaXIpKSByZXR1cm4gZmFsc2U7XG4gIH1cbiAgZm9yIChjb25zdCBjaGlsZCBvZiBhd2FpdCBzdG9yYWdlLmxpc3REaXJzKCkpIHtcbiAgICBpZiAoaXNTdHJpY3RseUJlbmVhdGgoY2hpbGQsIGRpcikpIHJldHVybiBmYWxzZTtcbiAgfVxuICBmb3IgKGNvbnN0IFtwYXRoLCBlbnRyeV0gb2YgT2JqZWN0LmVudHJpZXMoaW5kZXgpKSB7XG4gICAgaWYgKGVudHJ5LmlzRm9sZGVyIHx8IGVudHJ5LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkKSBjb250aW51ZTtcbiAgICBpZiAoaXNTdHJpY3RseUJlbmVhdGgocGF0aCwgZGlyKSkgcmV0dXJuIGZhbHNlO1xuICB9XG4gIHJldHVybiB0cnVlO1xufVxuXG4vKiogUmVtb3ZlIGBkaXJgIHRocm91Z2ggdGhlIGFkYXB0ZXIgd2hlbiBpdCBpcyB2YWNhbnQuIE1pc3Npbmcvbm9uLWVtcHR5L3Vuc3VwcG9ydGVkIFx1MjFEMiBmYWxzZS4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiByZW1vdmVEaXJJZlZhY2FudChcbiAgc3RvcmFnZTogU3RvcmFnZUFkYXB0ZXIsXG4gIGluZGV4OiBMb2NhbEluZGV4LFxuICBkaXI6IHN0cmluZyxcbik6IFByb21pc2U8Ym9vbGVhbj4ge1xuICBpZiAoIShhd2FpdCBkaXJJc1ZhY2FudChzdG9yYWdlLCBpbmRleCwgZGlyKSkpIHJldHVybiBmYWxzZTtcbiAgcmV0dXJuIHJlbW92ZVZhY2FudERpcihzdG9yYWdlLCBkaXIpO1xufVxuXG5hc3luYyBmdW5jdGlvbiByZW1vdmVWYWNhbnREaXIoc3RvcmFnZTogU3RvcmFnZUFkYXB0ZXIsIGRpcjogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XG4gIGlmIChzdG9yYWdlLnJlbW92ZURpciA9PT0gdW5kZWZpbmVkKSByZXR1cm4gZmFsc2U7IC8vIHByZS1ob29rIGFkYXB0ZXJzOiByZWNvcmQtb25seVxuICB0cnkge1xuICAgIGF3YWl0IHN0b3JhZ2UucmVtb3ZlRGlyKGRpcik7XG4gICAgcmV0dXJuIHRydWU7XG4gIH0gY2F0Y2gge1xuICAgIC8vIEEgcmVmdXNlZCBvciByYWNlZCByZW1vdmFsIGlzIHJlY29yZC1vbmx5LCBuZXZlciBmYXRhbCBhbmQgbmV2ZXIgZGF0YVxuICAgIC8vIGxvc3MgXHUyMDE0IHRoZSB0b21ic3RvbmUgaXMgc3RpbGwgcmVjb3JkZWQgYW5kIHN0YXRlIGNvbnZlcmdlcyBsYXRlci5cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cblxuLyoqXG4gKiBQcnVuZS1vbi1kZWxldGUgKEMpOiBhZnRlciBgZGVsZXRlZFBhdGhgIHdhcyBkZWxldGVkIChvciByZW5hbWVkIGF3YXkpLFxuICogcmVtb3ZlIGl0cyBpbW1lZGlhdGUgcGFyZW50IGRpcmVjdG9yeSB3aGVuIGl0IGlzIG5vdyBlbXB0eSBvbiBkaXNrIGFuZFxuICogdW5yZXByZXNlbnRlZCBieSBsaXZlIGluZGV4IGVudHJpZXMgXHUyMDE0IGV4YWN0bHkgT05FIGxldmVsLCBubyBjYXNjYWRlLlxuICpcbiAqIFJldHVybnMgdGhlIGBQcnVuZWREaXJgIHdoZW4gdGhlIHBhcmVudCBRVUFMSUZJRUQgZm9yIHJlbW92YWwgKHdoZXRoZXIgb3JcbiAqIG5vdCB0aGUgYWRhcHRlciBjb3VsZCBwZXJmb3JtIGl0IFx1MjAxNCBjYWxsZXJzIHVzZSBlbGlnaWJpbGl0eSB0byBzdXBwcmVzcyBhblxuICogZW1wdHktZm9sZGVyIHBsYWNlaG9sZGVyIHB1c2ggZm9yIHRoYXQgZGlyZWN0b3J5KSwgYHVuZGVmaW5lZGAgd2hlbiB0aGVcbiAqIHBhcmVudCB3YXMgbm90IGRlbGV0YWJsZSAobm9uLWVtcHR5LCBob2xkcyBsaXZlIGVudHJpZXMsIG1pc3NpbmcsIG9yIHJvb3QpLlxuICogUHVyZSB3aXRoIHJlc3BlY3QgdG8gdGhlIGluZGV4OiBuZXZlciBtdXRhdGVzIGl0LlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcHJ1bmVQYXJlbnRPbkRlbGV0ZShcbiAgc3RvcmFnZTogU3RvcmFnZUFkYXB0ZXIsXG4gIGluZGV4OiBMb2NhbEluZGV4LFxuICBkZWxldGVkUGF0aDogc3RyaW5nLFxuKTogUHJvbWlzZTxQcnVuZWREaXIgfCB1bmRlZmluZWQ+IHtcbiAgY29uc3QgZGlyID0gcGFyZW50UGF0aChkZWxldGVkUGF0aCk7XG4gIGlmICghKGF3YWl0IGRpcklzVmFjYW50KHN0b3JhZ2UsIGluZGV4LCBkaXIpKSkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgcmV0dXJuIHsgZGlyLCByZW1vdmVkOiBhd2FpdCByZW1vdmVWYWNhbnREaXIoc3RvcmFnZSwgZGlyKSB9O1xufVxuXG4vKiogRG93bmxvYWQsIHZlcmlmeSwgYW5kIHdyaXRlIG9uZSBibG9iLiBBIGhhc2ggbWlzbWF0Y2ggYWJvcnRzIHRoZSBwbGFuLiAqL1xuYXN5bmMgZnVuY3Rpb24gZmV0Y2hWZXJpZmllZChcbiAgc3RvcmFnZTogU3RvcmFnZUFkYXB0ZXIsXG4gIHBhdGg6IHN0cmluZyxcbiAgaGFzaDogc3RyaW5nLFxuICBmZXRjaEJsb2I6IEZldGNoQmxvYixcbik6IFByb21pc2U8dm9pZD4ge1xuICBjb25zdCBieXRlcyA9IGF3YWl0IGZldGNoQmxvYihoYXNoKTtcbiAgY29uc3QgYWN0dWFsID0gYXdhaXQgc2hhMjU2SGV4KGJ5dGVzKTtcbiAgaWYgKGFjdHVhbCAhPT0gaGFzaCkge1xuICAgIHRocm93IG5ldyBFcnJvcihcbiAgICAgIGBCbG9iIGhhc2ggbWlzbWF0Y2ggZm9yICR7SlNPTi5zdHJpbmdpZnkocGF0aCl9OiBleHBlY3RlZCAke2hhc2h9LCBnb3QgJHthY3R1YWx9YCxcbiAgICApO1xuICB9XG4gIGF3YWl0IHN0b3JhZ2Uud3JpdGVGaWxlKHBhdGgsIGJ5dGVzKTtcbn1cblxuYXN5bmMgZnVuY3Rpb24gcGVyc2lzdEluZGV4KFxuICBzdG9yYWdlOiBTdG9yYWdlQWRhcHRlcixcbiAgaW5kZXg6IExvY2FsSW5kZXgsXG4gIHN0YXRlOiBQZXJzaXN0ZWRTeW5jU3RhdGUgPSB7fSxcbik6IFByb21pc2U8dm9pZD4ge1xuICBhd2FpdCBzdG9yYWdlLndyaXRlRmlsZShcbiAgICBMT0NBTF9JTkRFWF9TVEFURV9QQVRILFxuICAgIG5ldyBUZXh0RW5jb2RlcigpLmVuY29kZShzZXJpYWxpemVMb2NhbEluZGV4KGluZGV4LCBzdGF0ZSkpLFxuICApO1xufVxuXG4vKipcbiAqIExvYWQgdGhlIHBlcnNpc3RlZCBpbmRleCBBTkQgaXRzIHN5bmMtY3Vyc29yIGJvb2trZWVwaW5nICh0aGUgY2xpZW50J3NcbiAqIHN0YXJ0dXAgcGF0aCBcdTIwMTQgdGhlIGN1cnNvciBwb3dlcnMgZGVsdGEtbWFuaWZlc3QgcmVjb25uZWN0cykuIFRocm93c1xuICogYFByb3RvY29sRXJyb3JgICh2aWEgYGRlc2VyaWFsaXplTG9jYWxTdGF0ZWApIG9uIGNvcnJ1cHQgb3IgZnV0dXJlLXNjaGVtYVxuICogc3RhdGUgXHUyMDE0IGNhbGxlcnMgc3VyZmFjZSB0aGF0IGluc3RlYWQgb2Ygc2lsZW50bHkgcmUtc3luY2luZyBmcm9tIHNjcmF0Y2guXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBsb2FkTG9jYWxTdGF0ZShzdG9yYWdlOiBTdG9yYWdlQWRhcHRlcik6IFByb21pc2U8RGVzZXJpYWxpemVkTG9jYWxTdGF0ZT4ge1xuICBjb25zdCBieXRlcyA9IGF3YWl0IHN0b3JhZ2UucmVhZEZpbGUoTE9DQUxfSU5ERVhfU1RBVEVfUEFUSCk7XG4gIHJldHVybiBkZXNlcmlhbGl6ZUxvY2FsU3RhdGUobmV3IFRleHREZWNvZGVyKCkuZGVjb2RlKGJ5dGVzKSk7XG59XG5cbi8qKlxuICogTG9hZCB0aGUgcGVyc2lzdGVkIGluZGV4IChBUkNISVRFQ1RVUkUgXHUwMEE3OCBzdGVwIDEpLiBUaHJvd3NcbiAqIGBQcm90b2NvbEVycm9yYCAodmlhIGBkZXNlcmlhbGl6ZUxvY2FsSW5kZXhgKSBvbiBjb3JydXB0IG9yIGZ1dHVyZS1zY2hlbWFcbiAqIHN0YXRlIFx1MjAxNCBjYWxsZXJzIHN1cmZhY2UgdGhhdCBpbnN0ZWFkIG9mIHNpbGVudGx5IHJlLXN5bmNpbmcgZnJvbSBzY3JhdGNoLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbG9hZExvY2FsSW5kZXgoc3RvcmFnZTogU3RvcmFnZUFkYXB0ZXIpOiBQcm9taXNlPExvY2FsSW5kZXg+IHtcbiAgcmV0dXJuIChhd2FpdCBsb2FkTG9jYWxTdGF0ZShzdG9yYWdlKSkuaW5kZXg7XG59XG4iLCAiLyoqXG4gKiBWYXVsdCBpZ25vcmUgcnVsZXMgKEFSQ0hJVEVDVFVSRS5tZCBcdTAwQTc0LCBGUi0xMS9GUi00MikgXHUyMDE0IHNoYXJlZCBieSBldmVyeVxuICogY2xpZW50IHNvIGxvY2FsIHNjYW5zLCB3YXRjaGVycywgYW5kIGNvbW1pdCBwYXRocyBhZ3JlZSBieXRlLWZvci1ieXRlLlxuICpcbiAqIE1hdGNoaW5nIGlzIHNlZ21lbnQtYmFzZWQgYW5kIGNhc2UtaW5zZW5zaXRpdmUgKHRoZSBvd25lcidzIHByaW1hcnlcbiAqIHBsYXRmb3JtcyBcdTIwMTQgV2luZG93cywgbWFjT1MgXHUyMDE0IGhhdmUgY2FzZS1pbnNlbnNpdGl2ZSBmaWxlc3lzdGVtcywgc29cbiAqIGAuVHJhc2gvZm9vLm1kYCBtdXN0IG5vdCBzbmVhayBwYXN0IHRoZSBgLnRyYXNoL2AgcnVsZSkuXG4gKi9cblxuaW1wb3J0IHsgbm9ybWFsaXplVmF1bHRQYXRoIH0gZnJvbSAnLi9wYXRocy5qcyc7XG5cbi8qKiBTZXR0aW5ncyBzdWJzZXQgYGlzSWdub3JlZGAgbmVlZHM7IGBWYXVsdFNldHRpbmdzYCBzYXRpc2ZpZXMgaXQuICovXG5leHBvcnQgaW50ZXJmYWNlIElnbm9yZVNldHRpbmdzIHtcbiAgb2JzaWRpYW5TeW5jOiBib29sZWFuO1xuICAvKipcbiAgICogVXNlci1kZWZpbmVkIGV4dHJhIGlnbm9yZSBwYXR0ZXJucyAoY2xpZW50LXNpZGUgb25seSkuIEdsb2ItbGl0ZSBzeW50YXg6XG4gICAqIGAqYCBtYXRjaGVzIHdpdGhpbiBvbmUgcGF0aCBzZWdtZW50LCBhIHdob2xlIGAqKmAgc2VnbWVudCBzcGFucyBhbnlcbiAgICogbnVtYmVyIG9mIHNlZ21lbnRzLCBtYXRjaGluZyBpcyBjYXNlLWluc2Vuc2l0aXZlLiBBIHBhdHRlcm4gY29udGFpbmluZ1xuICAgKiBgL2AgaXMgYW5jaG9yZWQgYXQgdGhlIHZhdWx0IHJvb3QgKGBwcml2YXRlLyoqYCk7IGEgYmFyZSBwYXR0ZXJuIHdpdGhvdXRcbiAgICogYC9gIG1hdGNoZXMgYSBmaWxlIE5BTUUgYXQgYW55IGRlcHRoIChgKi50bXBgKS4gRW1wdHkgbGluZXMgYXJlIGlnbm9yZWQuXG4gICAqL1xuICBleHRyYUlnbm9yZXM/OiByZWFkb25seSBzdHJpbmdbXTtcbn1cblxuLyoqIElnbm9yZWQgd2hlcmV2ZXIgdGhleSBhcHBlYXIsIGFzIGFueSBwYXRoIHNlZ21lbnQgKGRpciBvciBmaWxlIG5hbWUpLiAqL1xuY29uc3QgQUxXQVlTX0lHTk9SRURfU0VHTUVOVFM6IFJlYWRvbmx5U2V0PHN0cmluZz4gPSBuZXcgU2V0KFtcbiAgJy50cmFzaCcsIC8vIGxvY2FsIGRlbGV0ZS1yZWNvdmVyeSBkaXIgKEZSLTQyKVxuICAnLmRzX3N0b3JlJyxcbiAgJy52YXVsdHN5bmNmb3JhZ2VudHMnLCAvLyBjbGllbnQgc3RhdGUgZGlyIChsb2NhbCBpbmRleCkgaW5zaWRlIHRoZSB2YXVsdFxuICAndGh1bWJzLmRiJyxcbl0pO1xuXG4vKiogYC5vYnNpZGlhbi9gIGZpbGVzIGV4Y2x1ZGVkIGV2ZW4gd2hlbiBgLm9ic2lkaWFuL2Agc3luYyBpcyBvcHRlZCBpbi4gKi9cbmNvbnN0IE9CU0lESUFOX1ZPTEFUSUxFX0ZJTEVTOiBSZWFkb25seVNldDxzdHJpbmc+ID0gbmV3IFNldChbXG4gICcub2JzaWRpYW4vd29ya3NwYWNlLmpzb24nLFxuICAnLm9ic2lkaWFuL3dvcmtzcGFjZS1tb2JpbGUuanNvbicsXG5dKTtcblxuLyoqXG4gKiBXaGV0aGVyIGB2YXVsdFBhdGhgIG11c3QgYmUgZXhjbHVkZWQgZnJvbSBzeW5jLlxuICpcbiAqIEFsd2F5cyBpZ25vcmVkOiBgLnRyYXNoL2AsIGAuRFNfU3RvcmVgLCBgVGh1bWJzLmRiYCwgYC52YXVsdHN5bmNmb3JhZ2VudHMvYFxuICogKGFueSBkZXB0aCkuIGAub2JzaWRpYW4vYCBpcyBpZ25vcmVkIGVudGlyZWx5IHdoZW4gYHNldHRpbmdzLm9ic2lkaWFuU3luY2BcbiAqIGlzIGZhbHNlOyB3aGVuIHRydWUsIGV2ZXJ5dGhpbmcgdW5kZXIgaXQgc3luY3MgZXhjZXB0IGB3b3Jrc3BhY2UuanNvbmAsXG4gKiBgd29ya3NwYWNlLW1vYmlsZS5qc29uYCwgYW5kIGAub2JzaWRpYW4vY2FjaGUvYC4gRmluYWxseSwgZXZlcnkgcGF0dGVybiBpblxuICogYHNldHRpbmdzLmV4dHJhSWdub3Jlc2AgaXMgbWF0Y2hlZCAoZ2xvYi1saXRlIFx1MjAxNCBzZWUgYElnbm9yZVNldHRpbmdzYCkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0lnbm9yZWQodmF1bHRQYXRoOiBzdHJpbmcsIHNldHRpbmdzOiBJZ25vcmVTZXR0aW5ncyk6IGJvb2xlYW4ge1xuICBjb25zdCBub3JtYWxpemVkID0gbm9ybWFsaXplVmF1bHRQYXRoKHZhdWx0UGF0aCk7XG4gIGlmIChub3JtYWxpemVkID09PSAnLycpIHJldHVybiBmYWxzZTtcblxuICBjb25zdCBsb3dlciA9IG5vcm1hbGl6ZWQuc2xpY2UoMSkudG9Mb3dlckNhc2UoKTtcbiAgY29uc3Qgc2VnbWVudHMgPSBsb3dlci5zcGxpdCgnLycpO1xuXG4gIGlmIChzZWdtZW50cy5zb21lKChzZWdtZW50KSA9PiBBTFdBWVNfSUdOT1JFRF9TRUdNRU5UUy5oYXMoc2VnbWVudCkpKSB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICBpZiAoc2VnbWVudHNbMF0gPT09ICcub2JzaWRpYW4nKSB7XG4gICAgaWYgKCFzZXR0aW5ncy5vYnNpZGlhblN5bmMpIHJldHVybiB0cnVlO1xuICAgIGlmIChPQlNJRElBTl9WT0xBVElMRV9GSUxFUy5oYXMobG93ZXIpKSByZXR1cm4gdHJ1ZTtcbiAgICBpZiAoc2VnbWVudHNbMV0gPT09ICdjYWNoZScpIHJldHVybiB0cnVlOyAvLyB0aGUgZGlyIGl0c2VsZiBhbmQgYW55dGhpbmcgdW5kZXIgaXRcbiAgfVxuXG4gIGNvbnN0IGV4dHJhcyA9IHNldHRpbmdzLmV4dHJhSWdub3JlcztcbiAgaWYgKGV4dHJhcyAhPT0gdW5kZWZpbmVkICYmIGV4dHJhcy5sZW5ndGggPiAwKSB7XG4gICAgZm9yIChjb25zdCBwYXR0ZXJuIG9mIGV4dHJhcykge1xuICAgICAgY29uc3QgY29tcGlsZWQgPSBjb21waWxlRXh0cmFJZ25vcmUocGF0dGVybik7XG4gICAgICBpZiAoY29tcGlsZWQgIT09IG51bGwgJiYgbWF0Y2hlc1NlZ21lbnRzKGNvbXBpbGVkLCBzZWdtZW50cykpIHJldHVybiB0cnVlO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBmYWxzZTtcbn1cblxuLy8gLS0tIGV4dHJhIGlnbm9yZSBwYXR0ZXJucyAoZ2xvYi1saXRlKSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIEEgY29tcGlsZWQgZXh0cmEtaWdub3JlIHBhdHRlcm46IGxvd2VyY2FzZWQsIGAvYC1zcGxpdCBzZWdtZW50cy4gKi9cbnR5cGUgQ29tcGlsZWRQYXR0ZXJuID0geyBzZWdtZW50czogcmVhZG9ubHkgc3RyaW5nW107IGFuY2hvcmVkOiBib29sZWFuIH07XG5cbi8qKlxuICogTm9ybWFsaXplIG9uZSB1c2VyIHBhdHRlcm4gaW50byBtYXRjaGFibGUgc2VnbWVudHMuIFJldHVybnMgYG51bGxgIGZvclxuICogYmxhbmsgcGF0dGVybnMgKHRoZXkgY2FuIG5ldmVyIG1hdGNoIFx1MjAxNCBhbmQgbXVzdCBub3QgYmVjb21lIFwiaWdub3JlXG4gKiBldmVyeXRoaW5nXCIgYnkgYWNjaWRlbnQpLiBBIGxlYWRpbmcvdHJhaWxpbmcgYC9gIGlzIHRvbGVyYXRlZCBhbmQgc3RyaXBwZWQ7XG4gKiBgYW5jaG9yZWRgIHJlY29yZHMgd2hldGhlciB0aGUgcGF0dGVybiBuYW1lcyBhIHBhdGggKG1hdGNoZWQgZnJvbSB0aGVcbiAqIHZhdWx0IHJvb3QpIG9yIGEgYmFyZSBuYW1lIChtYXRjaGVkIGFnYWluc3QgYW55IHN1ZmZpeCBvZiB0aGUgcGF0aCkuXG4gKi9cbmZ1bmN0aW9uIGNvbXBpbGVFeHRyYUlnbm9yZShwYXR0ZXJuOiBzdHJpbmcpOiBDb21waWxlZFBhdHRlcm4gfCBudWxsIHtcbiAgbGV0IGNsZWFuZWQgPSBwYXR0ZXJuLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICB3aGlsZSAoY2xlYW5lZC5zdGFydHNXaXRoKCcvJykpIGNsZWFuZWQgPSBjbGVhbmVkLnNsaWNlKDEpO1xuICB3aGlsZSAoY2xlYW5lZC5lbmRzV2l0aCgnLycpKSBjbGVhbmVkID0gY2xlYW5lZC5zbGljZSgwLCAtMSk7XG4gIGlmIChjbGVhbmVkID09PSAnJykgcmV0dXJuIG51bGw7XG4gIHJldHVybiB7IHNlZ21lbnRzOiBjbGVhbmVkLnNwbGl0KCcvJyksIGFuY2hvcmVkOiBjbGVhbmVkLmluY2x1ZGVzKCcvJykgfTtcbn1cblxuLyoqIFBhdHRlcm4gdnMgcGF0aCBzZWdtZW50czsgYGFuY2hvcmVkYCBwYXR0ZXJucyBtYXkgYWxzbyBzdGFydCBkZWVwZXIuICovXG5mdW5jdGlvbiBtYXRjaGVzU2VnbWVudHMocGF0dGVybjogQ29tcGlsZWRQYXR0ZXJuLCBwYXRoOiByZWFkb25seSBzdHJpbmdbXSk6IGJvb2xlYW4ge1xuICBpZiAocGF0dGVybi5hbmNob3JlZCkge1xuICAgIHJldHVybiBzZWdtZW50c01hdGNoKHBhdHRlcm4uc2VnbWVudHMsIHBhdGgpO1xuICB9XG4gIC8vIEJhcmUgbmFtZSBwYXR0ZXJuOiBtYXRjaCBhbnkgdHJhaWxpbmcgc2VnbWVudCBydW4gKGAqLnRtcGAgYXQgYW55IGRlcHRoKS5cbiAgZm9yIChsZXQgc3RhcnQgPSAwOyBzdGFydCA8IHBhdGgubGVuZ3RoOyBzdGFydCsrKSB7XG4gICAgaWYgKHNlZ21lbnRzTWF0Y2gocGF0dGVybi5zZWdtZW50cywgcGF0aC5zbGljZShzdGFydCkpKSByZXR1cm4gdHJ1ZTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKiBHbG9iLWxpdGUgc2VnbWVudCBtYXRjaGluZzogYCpgIGluc2lkZSBhIHNlZ21lbnQsIGAqKmAgYXMgYSB3aG9sZSBzZWdtZW50LiAqL1xuZnVuY3Rpb24gc2VnbWVudHNNYXRjaChwYXR0ZXJuOiByZWFkb25seSBzdHJpbmdbXSwgcGF0aDogcmVhZG9ubHkgc3RyaW5nW10pOiBib29sZWFuIHtcbiAgaWYgKHBhdHRlcm4ubGVuZ3RoID09PSAwKSByZXR1cm4gcGF0aC5sZW5ndGggPT09IDA7XG4gIGNvbnN0IGhlYWQgPSBwYXR0ZXJuWzBdO1xuICBjb25zdCByZXN0ID0gcGF0dGVybi5zbGljZSgxKTtcbiAgaWYgKGhlYWQgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHBhdGgubGVuZ3RoID09PSAwO1xuICBpZiAoaGVhZCA9PT0gJyoqJykge1xuICAgIC8vIGAqKmAgY29uc3VtZXMgemVybyBvciBtb3JlIHBhdGggc2VnbWVudHMuXG4gICAgZm9yIChsZXQgc2tpcCA9IDA7IHNraXAgPD0gcGF0aC5sZW5ndGg7IHNraXArKykge1xuICAgICAgaWYgKHNlZ21lbnRzTWF0Y2gocmVzdCwgcGF0aC5zbGljZShza2lwKSkpIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgaWYgKHBhdGgubGVuZ3RoID09PSAwIHx8ICFzZWdtZW50TWF0Y2goaGVhZCwgcGF0aFswXSEpKSByZXR1cm4gZmFsc2U7XG4gIHJldHVybiBzZWdtZW50c01hdGNoKHJlc3QsIHBhdGguc2xpY2UoMSkpO1xufVxuXG4vKiogT25lIHNlZ21lbnQ6IGxpdGVyYWwgdGV4dCB3aXRoIGAqYCB3aWxkY2FyZHMgKGFueSBydW4gd2l0aGluIHRoZSBzZWdtZW50KS4gKi9cbmZ1bmN0aW9uIHNlZ21lbnRNYXRjaChwYXR0ZXJuOiBzdHJpbmcsIHNlZ21lbnQ6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBpZiAoIXBhdHRlcm4uaW5jbHVkZXMoJyonKSkgcmV0dXJuIHBhdHRlcm4gPT09IHNlZ21lbnQ7XG4gIGNvbnN0IGZpcnN0ID0gcGF0dGVybi5pbmRleE9mKCcqJyk7XG4gIGNvbnN0IGxhc3QgPSBwYXR0ZXJuLmxhc3RJbmRleE9mKCcqJyk7XG4gIGlmICghc2VnbWVudC5zdGFydHNXaXRoKHBhdHRlcm4uc2xpY2UoMCwgZmlyc3QpKSkgcmV0dXJuIGZhbHNlO1xuICBpZiAoIXNlZ21lbnQuZW5kc1dpdGgocGF0dGVybi5zbGljZShsYXN0ICsgMSkpKSByZXR1cm4gZmFsc2U7XG4gIGxldCBpbmRleCA9IGZpcnN0O1xuICBmb3IgKGNvbnN0IG1pZGRsZSBvZiBwYXR0ZXJuLnNsaWNlKGZpcnN0LCBsYXN0ICsgMSkuc3BsaXQoJyonKS5zbGljZSgxLCAtMSkpIHtcbiAgICBjb25zdCBmb3VuZCA9IHNlZ21lbnQuaW5kZXhPZihtaWRkbGUsIGluZGV4KTtcbiAgICBpZiAoZm91bmQgPT09IC0xKSByZXR1cm4gZmFsc2U7XG4gICAgaW5kZXggPSBmb3VuZCArIG1pZGRsZS5sZW5ndGg7XG4gIH1cbiAgcmV0dXJuIHRydWU7XG59XG4iLCAiLyoqXG4gKiBUeXBlZCBXZWJTb2NrZXQgbWVzc2FnZSBkZWZpbml0aW9ucyBmb3IgdGhlIGAvc3luY2AgY2hhbm5lbFxuICogKEFSQ0hJVEVDVFVSRS5tZCBcdTAwQTc1KS4gQWxsIG1lc3NhZ2VzIGFyZSBKU09OIHdpdGggYSBgdHlwZWAgZGlzY3JpbWluYW50LlxuICpcbiAqIFR3byBjaGFubmVscyBleGlzdDogdGhpcyBXUyBwcm90b2NvbCAobWV0YWRhdGEgKyBjaGFuZ2UgZmVlZCkgYW5kIHBsYWluXG4gKiBIVFRQUyBibG9iIHJvdXRlcyAoYEdFVC9QVVQgL2Jsb2IvOmhhc2hgKSBmb3IgY29udGVudCBcdTIwMTQgcmVmZXJlbmNlZCBoZXJlXG4gKiBvbmx5IHZpYSBjb250ZW50IGhhc2hlcy5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IExvZ2ljYWxDbG9jaywgVmVyc2lvbiwgVmVyc2lvbktpbmQsIFZhdWx0U2V0dGluZ3MgfSBmcm9tICcuL3R5cGVzLmpzJztcbmltcG9ydCB7IFByb3RvY29sRXJyb3IgfSBmcm9tICcuL2Vycm9ycy5qcyc7XG5cbi8qKiBXaXJlIHByb3RvY29sIHZlcnNpb24uIEJ1bXAgb24gYnJlYWtpbmcgbWVzc2FnZS1zaGFwZSBjaGFuZ2VzLiAqL1xuZXhwb3J0IGNvbnN0IFByb3RvY29sVmVyc2lvbiA9IDEgYXMgY29uc3Q7XG5cbi8qKiBDb21taXRzIGF0IG9yIGJlbG93IHRoaXMgc2l6ZSBtYXkgaW5saW5lIGNvbnRlbnQgKGJhc2U2NCkgb24gdGhlIFdTLiAqL1xuZXhwb3J0IGNvbnN0IElOTElORV9DT05URU5UX01BWF9CWVRFUyA9IDI1NiAqIDEwMjQ7XG5cbi8qKlxuICogT25lIGVudHJ5IG9mIHRoZSBtYW5pZmVzdCBtYXAgKGB7cGF0aCBcdTIxOTIgTWFuaWZlc3RFbnRyeX1gKS4gVGhlIGVudHJ5IGlzXG4gKiBzZWxmLWRlc2NyaWJpbmc6IGl0IGNhcnJpZXMgaXRzIG93biBgcGF0aGAgYW5kIHRoZSBoZWFkJ3MgYGNsb2NrYCBzbyB0aGVcbiAqIGNsaWVudC1zaWRlIHJlY29uY2lsaWF0aW9uIChgcmVzb2x2ZS50c2ApIGNhbiBvcmRlciByZW1vdGUgc3RhdGUgYWdhaW5zdFxuICogbG9jYWwgc3RhdGUgd2l0aG91dCBhbnkgZXh0cmEgcm91bmQtdHJpcHMuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgTWFuaWZlc3RFbnRyeSB7XG4gIC8qKiBOb3JtYWxpemVkIHZhdWx0IHBhdGggdGhpcyBlbnRyeSBkZXNjcmliZXMgKG1pcnJvcnMgdGhlIG1hcCBrZXkpLiAqL1xuICBwYXRoOiBzdHJpbmc7XG4gIC8qKiBWZXJzaW9uIGlkIG9mIHRoZSBlbnRyeSdzIGhlYWQuICovXG4gIHZlcnNpb246IHN0cmluZztcbiAgLyoqIHNoYTI1NiBoZXggb2YgY3VycmVudCBjb250ZW50IChgJydgIGZvciBmb2xkZXIgcGxhY2Vob2xkZXJzKS4gKi9cbiAgaGFzaDogc3RyaW5nO1xuICAvKiogQ29udGVudCBzaXplIGluIGJ5dGVzIChgMGAgZm9yIGZvbGRlciBwbGFjZWhvbGRlcnMpLiAqL1xuICBzaXplOiBudW1iZXI7XG4gIC8qKiBUb21ic3RvbmUgZmxhZy4gKi9cbiAgZGVsZXRlZDogYm9vbGVhbjtcbiAgLyoqIExvZ2ljYWwgY2xvY2sgb2YgdGhlIGhlYWQgXHUyMDE0IHRoZSBvcmRlcmluZyBhdXRob3JpdHkgKFx1MDBBNzQpLiAqL1xuICBjbG9jazogTG9naWNhbENsb2NrO1xuICAvKiogVHJ1ZSBmb3IgZW1wdHktZm9sZGVyIHBsYWNlaG9sZGVyIGVudHJpZXMgKEZSLTEwKS4gKi9cbiAgaXNGb2xkZXI/OiBib29sZWFuO1xuICAvKiogRXBvY2ggbXMgb2YgbGFzdCB1cGRhdGUsIGRpc3BsYXktb25seS4gKi9cbiAgbXRpbWU6IG51bWJlcjtcbn1cblxuLy8gLS0tIENsaWVudCBcdTIxOTIgU2VydmVyIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIEF1dGggKyBjYXRjaC11cDogdG9rZW4sIHByb3RvY29sIHZlcnNpb24sIGxhc3Qgc2VlbiBETyBzZXF1ZW5jZSBudW1iZXIuICovXG5leHBvcnQgaW50ZXJmYWNlIEhlbGxvTWVzc2FnZSB7XG4gIHR5cGU6ICdoZWxsbyc7XG4gIHRva2VuOiBzdHJpbmc7XG4gIHByb3RvY29sVmVyc2lvbjogbnVtYmVyO1xuICAvKiogTGFzdCBzZWVuIGdsb2JhbCBzZXF1ZW5jZSBudW1iZXI7IDAgZm9yIGEgZmlyc3QtZXZlciBjb25uZWN0LiAqL1xuICBjdXJzb3I6IG51bWJlcjtcbn1cblxuLyoqIFJlcXVlc3QgZnVsbCAoYHNpbmNlYCBvbWl0dGVkKSBvciBkZWx0YSBtYW5pZmVzdC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgR2V0TWFuaWZlc3RNZXNzYWdlIHtcbiAgdHlwZTogJ2dldE1hbmlmZXN0JztcbiAgc2luY2U/OiBudW1iZXI7XG59XG5cbi8qKlxuICogQ29tbWl0IGEgbmV3IHZlcnNpb24uIElmIGBpbmxpbmVgIGlzIHNldCBpdCBjYXJyaWVzIHRoZSBmdWxsIGNvbnRlbnRcbiAqIGJhc2U2NC1lbmNvZGVkIChvbmx5IGFsbG93ZWQgd2hlbiBgc2l6ZSA8PSBJTkxJTkVfQ09OVEVOVF9NQVhfQllURVNgKTtcbiAqIG90aGVyd2lzZSB0aGUgYmxvYiBtdXN0IGFscmVhZHkgYmUgdXBsb2FkZWQgKGBwdXRCbG9iYCBvbiB0aGlzIGNoYW5uZWwsXG4gKiBgUFVUIC9ibG9iLzpoYXNoYCBvbiB0aGUgcmVhbCB3b3JrZXIpLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIENvbW1pdE1lc3NhZ2Uge1xuICB0eXBlOiAnY29tbWl0JztcbiAgcGF0aDogc3RyaW5nO1xuICAvKiogVmVyc2lvbiBpZCB0aGUgY29tbWl0IGJ1aWxkcyBvbjsgc2VydmVyIGRldGVjdHMgZGl2ZXJnZW5jZSBcdTIxOTIgY29uZmxpY3QuICovXG4gIHBhcmVudFZlcnNpb246IHN0cmluZyB8IG51bGw7XG4gIGhhc2g6IHN0cmluZztcbiAgc2l6ZTogbnVtYmVyO1xuICAvKiogV2hhdCBraW5kIG9mIHZlcnNpb24gdGhpcyBjb21taXRzIChtaXJyb3JzIGBWZXJzaW9uLmtpbmRgKS4gKi9cbiAga2luZDogVmVyc2lvbktpbmQ7XG4gIGlubGluZT86IHN0cmluZztcbiAgLyoqIFNvdXJjZSBwYXRoIFx1MjAxNCByZXF1aXJlZCBmb3IgYGtpbmQ6ICdyZW5hbWUnYCAoY2hhaW4gbWlncmF0aW9uLCBGUi05KS4gKi9cbiAgZnJvbVBhdGg/OiBzdHJpbmc7XG4gIC8qKiBUcnVlIGZvciBlbXB0eS1mb2xkZXIgcGxhY2Vob2xkZXIgY29tbWl0cyAoRlItMTA7IGhhc2ggYCcnYCwgc2l6ZSAwKS4gKi9cbiAgaXNGb2xkZXI/OiBib29sZWFuO1xufVxuXG4vKiogS2VlcGFsaXZlLiAqL1xuZXhwb3J0IGludGVyZmFjZSBQaW5nTWVzc2FnZSB7XG4gIHR5cGU6ICdwaW5nJztcbiAgLyoqIENsaWVudCBlcG9jaCBtczsgZWNob2VkIGJhY2sgb24gYHBvbmdgIGZvciBSVFQgLyBza2V3IG1lYXN1cmVtZW50LiAqL1xuICB0cz86IG51bWJlcjtcbn1cblxuLyoqXG4gKiBVcGxvYWQgYSBjb250ZW50IGJsb2Igb3ZlciB0aGUgc3luYyBjaGFubmVsLiBUZXN0IGRvdWJsZXMgYW5kIHNtYWxsIHZhdWx0c1xuICogY2FuIHVzZSB0aGlzIGRpcmVjdGx5OyB0aGUgcmVhbCB3b3JrZXIgZXhwb3NlcyB0aGUgc2FtZSBvcGVyYXRpb24gYXNcbiAqIGBQVVQgL2Jsb2IvOmhhc2hgIChzdHJlYW1lZCkuIElkZW1wb3RlbnQ6IHNhbWUgaGFzaCBcdTIxRDIgc2FtZSBjb250ZW50LlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFB1dEJsb2JNZXNzYWdlIHtcbiAgdHlwZTogJ3B1dEJsb2InO1xuICBoYXNoOiBzdHJpbmc7XG4gIC8qKiBGdWxsIGNvbnRlbnQsIGJhc2U2NC1lbmNvZGVkLiAqL1xuICBjb250ZW50OiBzdHJpbmc7XG59XG5cbi8qKiBGZXRjaCBhIGNvbnRlbnQgYmxvYiAodGhlIFdTLWlubGluZSBwYXRoIG9mIFx1MDBBNzggXCJmZXRjaCBibG9iXCIpLiAqL1xuZXhwb3J0IGludGVyZmFjZSBHZXRCbG9iTWVzc2FnZSB7XG4gIHR5cGU6ICdnZXRCbG9iJztcbiAgaGFzaDogc3RyaW5nO1xufVxuXG4vKipcbiAqIFNuYXBzaG90IGV2ZXJ5IGZpbGUgaGVhZCBhdCBhIG1vbWVudCAoYSB3aG9sZS12YXVsdCByZXN0b3JlIHBvaW50KS4gVGhlXG4gKiBzZXJ2ZXIgcmVjb3JkcyB0aGUgaGVhZCBzdGF0ZSBhdG9taWNhbGx5OyBzbmFwc2hvdHMgYXJlIG5ldmVyIGJyb2FkY2FzdCBcdTIwMTRcbiAqIG90aGVyIGRldmljZXMgbGVhcm4gbm90aGluZyBsaXZlLCB0aGUgbGlzdCBpcyBwdWxsLWJhc2VkLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFNuYXBzaG90Q3JlYXRlTWVzc2FnZSB7XG4gIHR5cGU6ICdzbmFwc2hvdENyZWF0ZSc7XG4gIC8qKiBPcHRpb25hbCBsYWJlbDsgb21pdHRlZC9lbXB0eSBcdTIxRDIgdW5uYW1lZC4gKi9cbiAgbmFtZT86IHN0cmluZztcbn1cblxuLyoqIFJlc3RvcmUgdGhlIHdob2xlIHZhdWx0IHRvIGEgc25hcHNob3QgKEZSLTc6IGFzIE5FVyB2ZXJzaW9ucyBcdTIwMTQgaGlzdG9yeSBpcyBuZXZlciBkZWxldGVkKS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU25hcHNob3RSZXN0b3JlTWVzc2FnZSB7XG4gIHR5cGU6ICdzbmFwc2hvdFJlc3RvcmUnO1xuICAvKiogU25hcHNob3QgaWQgKGFzIHJldHVybmVkIGJ5IGBzbmFwc2hvdENyZWF0ZUFja2AgLyBsaXN0ZWQgYnkgdGhlIHNlcnZlcikuICovXG4gIGlkOiBzdHJpbmc7XG59XG5cbi8vIC0tLSBTZXJ2ZXIgXHUyMTkyIENsaWVudCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBTdWNjZXNzZnVsIGhlbGxvOiB0aGlzIGRldmljZSdzIGlkZW50aXR5ICsgdmF1bHQtbGV2ZWwgaW5mby4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSGVsbG9BY2tNZXNzYWdlIHtcbiAgdHlwZTogJ2hlbGxvQWNrJztcbiAgZGV2aWNlSWQ6IHN0cmluZztcbiAgdmF1bHROYW1lOiBzdHJpbmc7XG4gIHNldHRpbmdzOiBWYXVsdFNldHRpbmdzO1xuICAvKipcbiAgICogTG93ZXN0IGNoYW5nZS1ldmVudCBzZXF1ZW5jZSBudW1iZXIgdGhlIHNlcnZlciBzdGlsbCByZXRhaW5zIChwcm90b2NvbFxuICAgKiB2MSwgcHJlLXJlbGVhc2U7IG9wdGlvbmFsIHNvIG9sZGVyIHNlcnZlcnMgY2FuIGJlIGFuc3dlcmVkIHdpdGggYSBmdWxsXG4gICAqIG1hbmlmZXN0KS4gQSBjbGllbnQgd2hvc2UgY3Vyc29yIHNhdGlzZmllc1xuICAgKiBgb2xkZXN0UmV0YWluZWRTZXEgPD0gY3Vyc29yICsgMWAgY2FuIHJlcXVlc3QgYSBkZWx0YSBtYW5pZmVzdCBcdTIwMTQgZXZlcnlcbiAgICogZXZlbnQgYWZ0ZXIgaXRzIGN1cnNvciBpcyBzdGlsbCByZXBsYXlhYmxlLCBzbyBpdHMgaW5kZXggaXMgZ3VhcmFudGVlZFxuICAgKiB0byBvbmx5IG1pc3MgaGVhZHMgd2l0aCBgaGVhZF9zZXEgPiBjdXJzb3JgLiBBYnNlbnQgKG9yIGA+IGN1cnNvciArIDFgKVxuICAgKiBcdTIxRDIgdGhlIGNsaWVudCBtdXN0IGZhbGwgYmFjayB0byBhIGZ1bGwgbWFuaWZlc3QuXG4gICAqL1xuICBvbGRlc3RSZXRhaW5lZFNlcT86IG51bWJlcjtcbiAgLyoqXG4gICAqIFRoZSBzZXJ2ZXIncyBvd24gcmVsZWFzZSB2ZXJzaW9uICh0aGUgd29ya2VyJ3MgcGFja2FnZSB2ZXJzaW9uKS5cbiAgICogT3B0aW9uYWwgYmVjYXVzZSBzZXJ2ZXJzIFx1MjI2NCAwLjEgcHJlZGF0ZSB2ZXJzaW9uIHJlcG9ydGluZyBhbmQgb21pdCBpdCBcdTIwMTRcbiAgICogY2xpZW50cyB0cmVhdCBhYnNlbmNlIGFzIFwibGVnYWN5IHNlcnZlclwiIChzZWUgYGNvbXBhdC50c2ApLCBuZXZlciBhcyBhXG4gICAqIHByb3RvY29sIGZhaWx1cmUuXG4gICAqL1xuICBzZXJ2ZXJWZXJzaW9uPzogc3RyaW5nO1xufVxuXG4vKiogUmVwbHkgdG8gYGdldE1hbmlmZXN0YDogdGhlIChwb3NzaWJseSBkZWx0YSkgZmlsZSBpbmRleC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgTWFuaWZlc3RNZXNzYWdlIHtcbiAgdHlwZTogJ21hbmlmZXN0JztcbiAgZW50cmllczogUmVhZG9ubHk8UmVjb3JkPHN0cmluZywgTWFuaWZlc3RFbnRyeT4+O1xuICAvKiogR2xvYmFsIHNlcXVlbmNlIG51bWJlciB0aGlzIG1hbmlmZXN0IHJlZmxlY3RzIChjdXJzb3IgY2F0Y2gtdXApLiAqL1xuICBjdXJzb3I6IG51bWJlcjtcbn1cblxuLyoqIENvbW1pdCBhY2NlcHRlZCBhcyB0aGUgbmV3IGhlYWQuICovXG5leHBvcnQgaW50ZXJmYWNlIENvbW1pdEFja01lc3NhZ2Uge1xuICB0eXBlOiAnY29tbWl0QWNrJztcbiAgLyoqIFZlcnNpb24gaWQgYXNzaWduZWQgYnkgdGhlIGF1dGhvcml0eS4gKi9cbiAgdmVyc2lvbjogc3RyaW5nO1xuICAvKiogTG9naWNhbCBjbG9jayBvZiB0aGUgYWNjZXB0ZWQgdmVyc2lvbi4gKi9cbiAgY2xvY2s6IExvZ2ljYWxDbG9jaztcbiAgLyoqIEdsb2JhbCBzZXF1ZW5jZSBudW1iZXIgb2YgdGhlIGFjY2VwdGVkIGhlYWQgKGN1cnNvciB0cmFja2luZykuICovXG4gIHNlcTogbnVtYmVyO1xufVxuXG4vKiogV2hhdCBoYXBwZW5lZCB0byB0aGUgbG9zaW5nIHNpZGUgb2YgYSBjb25jdXJyZW50IGVkaXQgKHNlZSBkaXNwb3NpdGlvbikuICovXG5leHBvcnQgdHlwZSBDb25mbGljdExvc2VyRGlzcG9zaXRpb24gPSAnY29uZmxpY3RDb3B5JztcblxuLyoqIENvbW1pdCBsb3N0IHRoZSByYWNlOyB0aGUgc2VydmVyJ3MgY2hvc2VuIHdpbm5lciBzdGFuZHMuICovXG5leHBvcnQgaW50ZXJmYWNlIENvbmZsaWN0TWVzc2FnZSB7XG4gIHR5cGU6ICdjb25mbGljdCc7XG4gIC8qKiBUaGUgd2lubmluZyB2ZXJzaW9uICh0aGlzIGNvbW1pdCBvciB0aGUgY29uY3VycmVudCBvbmUpLiAqL1xuICB3aW5uZXI6IFZlcnNpb247XG4gIC8qKiBXaGF0IHRoZSBzZXJ2ZXIgZGlkIHdpdGggdGhlIGxvc2VyJ3MgY29udGVudCBcdTIwMTQgbmV2ZXIgZGVsZXRlZC4gKi9cbiAgbG9zZXJEaXNwb3NpdGlvbjogQ29uZmxpY3RMb3NlckRpc3Bvc2l0aW9uO1xuICAvKiogR2xvYmFsIHNlcXVlbmNlIG51bWJlciBvZiB0aGUgd2lubmluZyBoZWFkLCB3aGVuIGl0IGhhcyBvbmUuICovXG4gIHNlcT86IG51bWJlcjtcbn1cblxuLyoqXG4gKiBGYW4tb3V0IHBheWxvYWQgc2hhcmVkIGJ5IHRoZSBjaGFuZ2UgYnJvYWRjYXN0IGFuZCB0aGUgYXJiaXRyYXRpb24gcmVzdWx0LlxuICogRXZlcnl0aGluZyBhIGNsaWVudCBuZWVkcyB0byBtYXRlcmlhbGl6ZSBvbmUgaGVhZCB0cmFuc2l0aW9uLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIENoYW5nZVBheWxvYWQge1xuICBwYXRoOiBzdHJpbmc7XG4gIC8qKiBWZXJzaW9uIGlkIG9mIHRoZSBuZXcgaGVhZC4gKi9cbiAgdmVyc2lvbjogc3RyaW5nO1xuICBoYXNoOiBzdHJpbmc7XG4gIHNpemU6IG51bWJlcjtcbiAgZGVsZXRlZDogYm9vbGVhbjtcbiAgLyoqIElkIG9mIHRoZSBkZXZpY2UgdGhhdCBjb21taXR0ZWQuICovXG4gIGRldmljZTogc3RyaW5nO1xuICAvKiogTG9naWNhbCBjbG9jayBvZiB0aGUgbmV3IGhlYWQgXHUyMDE0IGNsaWVudHMgdXNlIGl0IHRvIHNraXAgc3RhbGUgcmVwbGF5cy4gKi9cbiAgY2xvY2s6IExvZ2ljYWxDbG9jaztcbiAgLyoqIFdoYXQga2luZCBvZiBjaGFuZ2UgdGhpcyBpcyAobWlycm9ycyBgVmVyc2lvbi5raW5kYCkuICovXG4gIGtpbmQ6IFZlcnNpb25LaW5kO1xuICAvKiogU291cmNlIHBhdGggXHUyMDE0IHByZXNlbnQgd2hlbiBga2luZDogJ3JlbmFtZSdgLiAqL1xuICBmcm9tUGF0aD86IHN0cmluZztcbiAgLyoqIFRydWUgZm9yIGZvbGRlciBwbGFjZWhvbGRlciBjaGFuZ2VzIChGUi0xMCkuICovXG4gIGlzRm9sZGVyPzogYm9vbGVhbjtcbn1cblxuLyoqIEZhbi1vdXQgYnJvYWRjYXN0IHRvIGFsbCAqb3RoZXIqIGNvbm5lY3RlZCBjbGllbnRzLiAqL1xuZXhwb3J0IGludGVyZmFjZSBDaGFuZ2VNZXNzYWdlIGV4dGVuZHMgQ2hhbmdlUGF5bG9hZCB7XG4gIHR5cGU6ICdjaGFuZ2UnO1xuICAvKiogR2xvYmFsIHNlcXVlbmNlIG51bWJlciBvZiB0aGlzIGNoYW5nZSAoY3Vyc29yIHRyYWNraW5nKS4gKi9cbiAgc2VxOiBudW1iZXI7XG59XG5cbi8qKiBSZXBseSB0byBgcHV0QmxvYmAuICovXG5leHBvcnQgaW50ZXJmYWNlIEJsb2JBY2tNZXNzYWdlIHtcbiAgdHlwZTogJ2Jsb2JBY2snO1xuICBoYXNoOiBzdHJpbmc7XG59XG5cbi8qKiBSZXBseSB0byBgZ2V0QmxvYmA6IHRoZSByZXF1ZXN0ZWQgY29udGVudC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQmxvYk1lc3NhZ2Uge1xuICB0eXBlOiAnYmxvYic7XG4gIGhhc2g6IHN0cmluZztcbiAgLyoqIEZ1bGwgY29udGVudCwgYmFzZTY0LWVuY29kZWQuICovXG4gIGNvbnRlbnQ6IHN0cmluZztcbn1cblxuLyoqIE1hY2hpbmUtcmVhZGFibGUgY29kZXMgY2FycmllZCBieSBgZXJyb3JgIG1lc3NhZ2VzIChIVFRQLWVxdWl2YWxlbnQpLiAqL1xuZXhwb3J0IHR5cGUgU2VydmVyRXJyb3JDb2RlID0gJ1VOQVVUSE9SSVpFRCcgfCAnUkVWT0tFRCcgfCAnTk9UX0ZPVU5EJyB8ICdQUk9UT0NPTCc7XG5cbi8qKiBOZWdhdGl2ZSByZXBseSAoYXV0aCBmYWlsdXJlLCB1bmtub3duIGJsb2IsIHByb3RvY29sIHZpb2xhdGlvbiwgXHUyMDI2KS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRXJyb3JNZXNzYWdlIHtcbiAgdHlwZTogJ2Vycm9yJztcbiAgY29kZTogU2VydmVyRXJyb3JDb2RlO1xuICBtZXNzYWdlOiBzdHJpbmc7XG59XG5cbi8qKiBQcmVzZW5jZSB1cGRhdGUgZm9yIGRhc2hib2FyZHMgLyBgdnNhIHN0YXR1c2AuICovXG5leHBvcnQgaW50ZXJmYWNlIERldmljZVNlZW5NZXNzYWdlIHtcbiAgdHlwZTogJ2RldmljZVNlZW4nO1xuICBkZXZpY2VJZDogc3RyaW5nO1xuICB0czogbnVtYmVyO1xufVxuXG4vKiogS2VlcGFsaXZlIHJlcGx5LiAqL1xuZXhwb3J0IGludGVyZmFjZSBQb25nTWVzc2FnZSB7XG4gIHR5cGU6ICdwb25nJztcbiAgLyoqIEVjaG9lcyB0aGUgYHBpbmdgIHRzIHdoZW4gb25lIHdhcyBwcm92aWRlZC4gKi9cbiAgdHM/OiBudW1iZXI7XG59XG5cbi8qKiBSZXBseSB0byBgc25hcHNob3RDcmVhdGVgLiAqL1xuZXhwb3J0IGludGVyZmFjZSBTbmFwc2hvdENyZWF0ZUFja01lc3NhZ2Uge1xuICB0eXBlOiAnc25hcHNob3RDcmVhdGVBY2snO1xuICAvKiogSWQgYXNzaWduZWQgYnkgdGhlIGF1dGhvcml0eSAoYHN7bn1gKS4gKi9cbiAgaWQ6IHN0cmluZztcbiAgLyoqIEVjaG9lcyB0aGUgc3RvcmVkIG5hbWUgKGAnJ2AgZm9yIHVubmFtZWQgc25hcHNob3RzKS4gKi9cbiAgbmFtZTogc3RyaW5nO1xuICAvKiogRXBvY2ggbXMgb2YgdGhlIHNuYXBzaG90LiAqL1xuICB0czogbnVtYmVyO1xuICAvKiogR2xvYmFsIHNlcXVlbmNlIG51bWJlciBhdCBjcmVhdGlvbiAoY3Vyc29yIGJvb2trZWVwaW5nKS4gKi9cbiAgc2VxOiBudW1iZXI7XG4gIC8qKiBOdW1iZXIgb2YgZmlsZSBoZWFkcyBjYXB0dXJlZC4gKi9cbiAgZmlsZUNvdW50OiBudW1iZXI7XG59XG5cbi8qKiBSZXBseSB0byBgc25hcHNob3RSZXN0b3JlYC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU25hcHNob3RSZXN0b3JlQWNrTWVzc2FnZSB7XG4gIHR5cGU6ICdzbmFwc2hvdFJlc3RvcmVBY2snO1xuICBpZDogc3RyaW5nO1xuICAvKiogUGF0aHMgcmV2ZXJ0ZWQgdG8gdGhlIHNuYXBzaG90J3MgY29udGVudCAocmVzdXJyZWN0ZWQgdG9tYnN0b25lcyBpbmNsdWRlZCkuICovXG4gIHJlc3RvcmVkOiBudW1iZXI7XG4gIC8qKiBQYXRocyBuZXdseSB0b21ic3RvbmVkIChsaXZlIG5vdywgYWJzZW50IG9yIGRlbGV0ZWQgYXQgdGhlIHNuYXBzaG90KS4gKi9cbiAgdG9tYnN0b25lZDogbnVtYmVyO1xuICAvKiogR2xvYmFsIHNlcSBvZiB0aGUgbGFzdCByZXN0b3JlIGNoYW5nZSAoY3VycmVudCBzZXEgd2hlbiBub3RoaW5nIGRpZmZlcmVkKS4gKi9cbiAgc2VxOiBudW1iZXI7XG59XG5cbi8qKiBPbmUgdmF1bHQtbGV2ZWwgc25hcHNob3QgYXMgbGlzdGVkIGJ5IHRoZSBzZXJ2ZXIgKGBHRVQgL2FwaS9zbmFwc2hvdHNgKS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU25hcHNob3RTdW1tYXJ5IHtcbiAgaWQ6IHN0cmluZztcbiAgbmFtZTogc3RyaW5nO1xuICAvKiogRXBvY2ggbXMgb2YgY3JlYXRpb24uICovXG4gIHRzOiBudW1iZXI7XG4gIC8qKiBEZXZpY2UgdGhhdCBjcmVhdGVkIHRoZSBzbmFwc2hvdC4gKi9cbiAgZGV2aWNlSWQ6IHN0cmluZztcbiAgLyoqIEdsb2JhbCBzZXF1ZW5jZSBudW1iZXIgYXQgY3JlYXRpb24uICovXG4gIHNlcTogbnVtYmVyO1xuICAvKiogTnVtYmVyIG9mIGZpbGUgaGVhZHMgY2FwdHVyZWQuICovXG4gIGZpbGVDb3VudDogbnVtYmVyO1xufVxuXG4vLyAtLS0gVW5pb24gKyBndWFyZHMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCB0eXBlIENsaWVudE1lc3NhZ2UgPVxuICB8IEhlbGxvTWVzc2FnZVxuICB8IEdldE1hbmlmZXN0TWVzc2FnZVxuICB8IENvbW1pdE1lc3NhZ2VcbiAgfCBQdXRCbG9iTWVzc2FnZVxuICB8IEdldEJsb2JNZXNzYWdlXG4gIHwgUGluZ01lc3NhZ2VcbiAgfCBTbmFwc2hvdENyZWF0ZU1lc3NhZ2VcbiAgfCBTbmFwc2hvdFJlc3RvcmVNZXNzYWdlO1xuXG5leHBvcnQgdHlwZSBTZXJ2ZXJNZXNzYWdlID1cbiAgfCBIZWxsb0Fja01lc3NhZ2VcbiAgfCBNYW5pZmVzdE1lc3NhZ2VcbiAgfCBDb21taXRBY2tNZXNzYWdlXG4gIHwgQ29uZmxpY3RNZXNzYWdlXG4gIHwgQ2hhbmdlTWVzc2FnZVxuICB8IERldmljZVNlZW5NZXNzYWdlXG4gIHwgQmxvYkFja01lc3NhZ2VcbiAgfCBCbG9iTWVzc2FnZVxuICB8IEVycm9yTWVzc2FnZVxuICB8IFBvbmdNZXNzYWdlXG4gIHwgU25hcHNob3RDcmVhdGVBY2tNZXNzYWdlXG4gIHwgU25hcHNob3RSZXN0b3JlQWNrTWVzc2FnZTtcblxuZXhwb3J0IHR5cGUgTWVzc2FnZSA9IENsaWVudE1lc3NhZ2UgfCBTZXJ2ZXJNZXNzYWdlO1xuXG5jb25zdCBDTElFTlRfVFlQRVM6IFJlYWRvbmx5U2V0PHN0cmluZz4gPSBuZXcgU2V0KFtcbiAgJ2hlbGxvJyxcbiAgJ2dldE1hbmlmZXN0JyxcbiAgJ2NvbW1pdCcsXG4gICdwdXRCbG9iJyxcbiAgJ2dldEJsb2InLFxuICAncGluZycsXG4gICdzbmFwc2hvdENyZWF0ZScsXG4gICdzbmFwc2hvdFJlc3RvcmUnLFxuXSk7XG5jb25zdCBTRVJWRVJfVFlQRVM6IFJlYWRvbmx5U2V0PHN0cmluZz4gPSBuZXcgU2V0KFtcbiAgJ2hlbGxvQWNrJyxcbiAgJ21hbmlmZXN0JyxcbiAgJ2NvbW1pdEFjaycsXG4gICdjb25mbGljdCcsXG4gICdjaGFuZ2UnLFxuICAnZGV2aWNlU2VlbicsXG4gICdibG9iQWNrJyxcbiAgJ2Jsb2InLFxuICAnZXJyb3InLFxuICAncG9uZycsXG4gICdzbmFwc2hvdENyZWF0ZUFjaycsXG4gICdzbmFwc2hvdFJlc3RvcmVBY2snLFxuXSk7XG5cbi8qKlxuICogUnVudGltZSBzaGFwZSBjaGVjazogYSB2YWx1ZSBpcyBhIGBNZXNzYWdlYCBpZmYgaXQgaXMgYW4gb2JqZWN0IHdob3NlXG4gKiBgdHlwZWAgaXMgYSBrbm93biBtZXNzYWdlIHR5cGUuIEZpZWxkLWxldmVsIHZhbGlkYXRpb24gaGFwcGVucyB3aGVyZSBhXG4gKiBtZXNzYWdlIGlzIGFjdGVkIHVwb24gKGxhdGVyIHBoYXNlcyk7IHRoZSBndWFyZCBpcyBkZWxpYmVyYXRlbHkgY2hlYXAgc29cbiAqIGJvdGggV1MgZW5kcyBjYW4gdHJpYWdlIHVua25vd24vZm9yd2FyZC1jb21wYXRpYmxlIHR5cGVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNNZXNzYWdlKHZhbHVlOiB1bmtub3duKTogdmFsdWUgaXMgTWVzc2FnZSB7XG4gIHJldHVybiAoXG4gICAgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJlxuICAgIHZhbHVlICE9PSBudWxsICYmXG4gICAgdHlwZW9mICh2YWx1ZSBhcyB7IHR5cGU/OiB1bmtub3duIH0pLnR5cGUgPT09ICdzdHJpbmcnICYmXG4gICAgKENMSUVOVF9UWVBFUy5oYXMoKHZhbHVlIGFzIHsgdHlwZTogc3RyaW5nIH0pLnR5cGUpIHx8XG4gICAgICBTRVJWRVJfVFlQRVMuaGFzKCh2YWx1ZSBhcyB7IHR5cGU6IHN0cmluZyB9KS50eXBlKSlcbiAgKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGlzQ2xpZW50TWVzc2FnZSh2YWx1ZTogdW5rbm93bik6IHZhbHVlIGlzIENsaWVudE1lc3NhZ2Uge1xuICByZXR1cm4gKFxuICAgIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiZcbiAgICB2YWx1ZSAhPT0gbnVsbCAmJlxuICAgIENMSUVOVF9UWVBFUy5oYXMoKHZhbHVlIGFzIHsgdHlwZT86IHVua25vd24gfSkudHlwZSBhcyBzdHJpbmcpXG4gICk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc1NlcnZlck1lc3NhZ2UodmFsdWU6IHVua25vd24pOiB2YWx1ZSBpcyBTZXJ2ZXJNZXNzYWdlIHtcbiAgcmV0dXJuIChcbiAgICB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmXG4gICAgdmFsdWUgIT09IG51bGwgJiZcbiAgICBTRVJWRVJfVFlQRVMuaGFzKCh2YWx1ZSBhcyB7IHR5cGU/OiB1bmtub3duIH0pLnR5cGUgYXMgc3RyaW5nKVxuICApO1xufVxuXG4vKipcbiAqIFBhcnNlIGEgV1MgdGV4dCBmcmFtZSBpbnRvIGEgdHlwZWQgYE1lc3NhZ2VgLlxuICogVGhyb3dzIGBQcm90b2NvbEVycm9yYCBvbiBub24tSlNPTiBpbnB1dCBvciB1bmtub3duIG1lc3NhZ2UgdHlwZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZU1lc3NhZ2UoZGF0YTogc3RyaW5nKTogTWVzc2FnZSB7XG4gIGxldCBwYXJzZWQ6IHVua25vd247XG4gIHRyeSB7XG4gICAgcGFyc2VkID0gSlNPTi5wYXJzZShkYXRhKTtcbiAgfSBjYXRjaCAoY2F1c2UpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgTWVzc2FnZSBpcyBub3QgdmFsaWQgSlNPTjogJHtTdHJpbmcoZGF0YSkuc2xpY2UoMCwgMjAwKX1gLCB7IGNhdXNlIH0pO1xuICB9XG4gIGlmICghaXNNZXNzYWdlKHBhcnNlZCkpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihcbiAgICAgIGBVbmtub3duIG9yIG1hbGZvcm1lZCBtZXNzYWdlIHR5cGU6ICR7SlNPTi5zdHJpbmdpZnkoKHBhcnNlZCBhcyB7IHR5cGU/OiB1bmtub3duIH0pPy50eXBlKX1gLFxuICAgICk7XG4gIH1cbiAgcmV0dXJuIHBhcnNlZDtcbn1cblxuLy8gLS0tIHdpcmUgZW5jb2RpbmcgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vL1xuLy8gYGlubGluZWAvYGNvbnRlbnRgIGZpZWxkcyBjYXJyeSByYXcgYnl0ZXMgYXMgYmFzZTY0LiBgYnRvYWAvYGF0b2JgIGV4aXN0IGluXG4vLyBldmVyeSB0YXJnZXQgcnVudGltZSAoV29ya2VycywgTm9kZSAxNissIEVsZWN0cm9uKTsgY2h1bmtpbmcgYXZvaWRzXG4vLyBleGNlZWRpbmcgYXJndW1lbnQtbGVuZ3RoIGxpbWl0cyBvbiBsYXJnZSBhdHRhY2htZW50cy5cblxuLyoqIEVuY29kZSBieXRlcyBhcyBiYXNlNjQuICovXG5leHBvcnQgZnVuY3Rpb24gYnl0ZXNUb0Jhc2U2NChieXRlczogVWludDhBcnJheSk6IHN0cmluZyB7XG4gIGxldCBiaW5hcnkgPSAnJztcbiAgY29uc3QgQ0hVTksgPSAweDgwMDA7XG4gIGZvciAobGV0IG9mZnNldCA9IDA7IG9mZnNldCA8IGJ5dGVzLmxlbmd0aDsgb2Zmc2V0ICs9IENIVU5LKSB7XG4gICAgYmluYXJ5ICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoLi4uYnl0ZXMuc3ViYXJyYXkob2Zmc2V0LCBvZmZzZXQgKyBDSFVOSykpO1xuICB9XG4gIHJldHVybiBidG9hKGJpbmFyeSk7XG59XG5cbi8qKiBEZWNvZGUgYmFzZTY0IHRvIGJ5dGVzLiBUaHJvd3MgYFByb3RvY29sRXJyb3JgIG9uIGludmFsaWQgaW5wdXQuICovXG5leHBvcnQgZnVuY3Rpb24gYmFzZTY0VG9CeXRlcyhlbmNvZGVkOiBzdHJpbmcpOiBVaW50OEFycmF5IHtcbiAgbGV0IGJpbmFyeTogc3RyaW5nO1xuICB0cnkge1xuICAgIGJpbmFyeSA9IGF0b2IoZW5jb2RlZCk7XG4gIH0gY2F0Y2ggKGNhdXNlKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoJ0Jhc2U2NCBwYXlsb2FkIGlzIG5vdCB2YWxpZCcsIHsgY2F1c2UgfSk7XG4gIH1cbiAgY29uc3QgYnl0ZXMgPSBuZXcgVWludDhBcnJheShiaW5hcnkubGVuZ3RoKTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBiaW5hcnkubGVuZ3RoOyBpKyspIGJ5dGVzW2ldID0gYmluYXJ5LmNoYXJDb2RlQXQoaSk7XG4gIHJldHVybiBieXRlcztcbn1cbiIsICIvKipcbiAqIENvbmZsaWN0LWNvcHkgZmlsZSBuYW1pbmcgKEFSQ0hJVEVDVFVSRS5tZCBcdTAwQTc0LCBGUi02KS5cbiAqXG4gKiBXaGVuIGEgZGV2aWNlIGxvc2VzIGEgY29uZmxpY3QgYnV0IGl0cyBjb250ZW50IG11c3QgYmUgcHJlc2VydmVkLCB0aGVcbiAqIGNvbnRlbnQgaXMgY29tbWl0dGVkIHRvIGEgc2libGluZyBcImNvbmZsaWN0IGNvcHlcIiBwYXRoIHNoYXBlZCBsaWtlOlxuICpcbiAqICAgICBOb3RlIChjb25mbGljdCAyMDI2LTA4LTIwIDE0LTIzIC0gZnJvbSBQaG9uZSkubWRcbiAqICAgICBcdTI1MTRcdTI1MDAgc3RlbSBcdTI1MDBcdTI1MThcdTI1MTRcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDAgVVRDIGRhdGUgKyBISC1tbSBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MThcdTI1MTQgZGV2aWNlIFx1MjUxOFx1MjUxNGV4dFx1MjUxOFxuICpcbiAqIFJ1bGVzOlxuICogICAtIHRpbWVzdGFtcCBpcyBhbHdheXMgVVRDIChuZXZlciBhIGxvY2FsIHRpbWV6b25lKSBzbyBldmVyeSBjbGllbnRcbiAqICAgICBjb21wdXRlcyB0aGUgaWRlbnRpY2FsIG5hbWUgZnJvbSB0aGUgc2FtZSBjb21taXQgdGltZTtcbiAqICAgLSB0aGUgZGV2aWNlIG5hbWUgaXMgc2FuaXRpemVkIGZvciBmaWxlc3lzdGVtIHNhZmV0eSAoc2VlXG4gKiAgICAgYHNhbml0aXplRGV2aWNlTmFtZWApO1xuICogICAtIHRoZSBvcmlnaW5hbCBleHRlbnNpb24gaXMgcHJlc2VydmVkIChsYXN0IGRvdCBpbiB0aGUgYmFzZW5hbWUsIGFzIGxvbmdcbiAqICAgICBhcyBpdCBpcyBub3QgdGhlIGZpcnN0IGNoYXJhY3RlciBcdTIwMTQgYC5naXRpZ25vcmVgIGhhcyBubyBleHRlbnNpb24pO1xuICogICAtIGlmIHRoZSBjYW5kaWRhdGUgYWxyZWFkeSBleGlzdHMgKGluIHRoZSBsb2NhbCBpbmRleCBvciB0aGUgcmVtb3RlXG4gKiAgICAgbWFuaWZlc3QgXHUyMDE0IHRoZSBjYWxsZXIgc3VwcGxpZXMgdGhlIGBleGlzdHNgIHByZWRpY2F0ZSksIGAgMmAsIGAgM2AsIFx1MjAyNlxuICogICAgIGlzIGFwcGVuZGVkIGJlZm9yZSB0aGUgZXh0ZW5zaW9uLlxuICovXG5cbmltcG9ydCB7IGJhc2VuYW1lLCBub3JtYWxpemVWYXVsdFBhdGgsIHBhcmVudFBhdGggfSBmcm9tICcuL3BhdGhzLmpzJztcblxuLyoqIENoYXJhY3RlcnMgZm9yYmlkZGVuIG9uIGF0IGxlYXN0IG9uZSBzdXBwb3J0ZWQgcGxhdGZvcm0uICovXG5jb25zdCBJTExFR0FMX0ZJTEVOQU1FX0NIQVJTID0gL1s8PjpcIi9cXFxcfD8qXS9nO1xuLyoqIEMwIGNvbnRyb2xzICsgREVMIFx1MjAxNCBuZXZlciB2YWxpZCBpbiBmaWxlbmFtZXMuICovXG5jb25zdCBDT05UUk9MX0NIQVJTID0gL1tcXHgwMC1cXHgxZlxceDdmXS9nO1xuXG4vKiogTWF4IGxlbmd0aCAoaW4gY29kZSBwb2ludHMpIG9mIGEgc2FuaXRpemVkIGRldmljZSBuYW1lLiAqL1xuY29uc3QgTUFYX0RFVklDRV9OQU1FX0xFTkdUSCA9IDMwO1xuXG4vKiogRmFsbGJhY2sgd2hlbiBhIGRldmljZSBuYW1lIHNhbml0aXplcyB0byBub3RoaW5nLiAqL1xuY29uc3QgRkFMTEJBQ0tfREVWSUNFX05BTUUgPSAndW5rbm93bic7XG5cbi8qKiBIaWdoZXN0IGAgTmAgc3VmZml4IHRyaWVkIGJlZm9yZSBnaXZpbmcgdXAuICovXG5jb25zdCBNQVhfQ09MTElTSU9OX1NVRkZJWCA9IDk5OTtcblxuLyoqXG4gKiBTYW5pdGl6ZSBhIGRldmljZSBuYW1lIGZvciB1c2UgaW5zaWRlIGEgZmlsZW5hbWU6IHN0cmlwIGA8PjpcIi9cXFxcfD8qYCBhbmRcbiAqIGNvbnRyb2wgY2hhcmFjdGVycywgdHJpbSB3aGl0ZXNwYWNlIGFuZCBlZGdlIGRvdHMgKFdpbmRvd3Mgc2VnbWVudHMgbWF5XG4gKiBub3QgZW5kIHdpdGggYC5gIG9yIHdoaXRlc3BhY2UpLCB0cnVuY2F0ZSB0byAzMCBjb2RlIHBvaW50cyAobmV2ZXIgc3BsaXRzXG4gKiBhIHN1cnJvZ2F0ZSBwYWlyKS4gUmV0dXJucyBgJ3Vua25vd24nYCB3aGVuIG5vdGhpbmcgc3Vydml2ZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzYW5pdGl6ZURldmljZU5hbWUobmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgbGV0IGNsZWFuZWQgPSBuYW1lLnJlcGxhY2UoSUxMRUdBTF9GSUxFTkFNRV9DSEFSUywgJycpLnJlcGxhY2UoQ09OVFJPTF9DSEFSUywgJycpO1xuICBjbGVhbmVkID0gWy4uLmNsZWFuZWRdLnNsaWNlKDAsIE1BWF9ERVZJQ0VfTkFNRV9MRU5HVEgpLmpvaW4oJycpO1xuICBjbGVhbmVkID0gY2xlYW5lZC50cmltKCkucmVwbGFjZSgvXlsuXFxzXSt8Wy5cXHNdKyQvZywgJycpO1xuICByZXR1cm4gY2xlYW5lZC5sZW5ndGggPT09IDAgPyBGQUxMQkFDS19ERVZJQ0VfTkFNRSA6IGNsZWFuZWQ7XG59XG5cbi8qKlxuICogQ29tcHV0ZSB0aGUgY29uZmxpY3QtY29weSBwYXRoIGZvciBgcGF0aGAuXG4gKlxuICogUHVyZSBhbmQgZGV0ZXJtaW5pc3RpYzogdGhlIHNhbWUgYChwYXRoLCBkZXZpY2VOYW1lLCBub3csIGV4aXN0cylgIGFsd2F5c1xuICogeWllbGRzIHRoZSBzYW1lIHJlc3VsdC4gYG5vd2AgaXMgdGhlIGNvbmZsaWN0J3MgZXBvY2gtbXMgdGltZXN0YW1wICh0aGVcbiAqIGNhbGxlciBwYXNzZXMgaXQgaW4gXHUyMDE0IG5vIGhpZGRlbiBjbG9ja3MpOyBgZXhpc3RzYCBpcyBjb25zdWx0ZWQgZm9yXG4gKiBjb2xsaXNpb24gYXZvaWRhbmNlIGFuZCB0eXBpY2FsbHkgY2hlY2tzIHRoZSBsb2NhbCBpbmRleCBwbHVzIHRoZSByZW1vdGVcbiAqIG1hbmlmZXN0LlxuICpcbiAqIFRocm93cyB3aGVuIG1vcmUgdGhhbiBgTUFYX0NPTExJU0lPTl9TVUZGSVhgIG5hbWUgY29sbGlzaW9ucyBvY2N1ciAoYVxuICogZ2VudWluZWx5IHBhdGhvbG9naWNhbCB2YXVsdCBzdGF0ZSB0aGUgY2FsbGVyIHNob3VsZCBzdXJmYWNlLCBub3QgcGFwZXJcbiAqIG92ZXIpLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY29uZmxpY3RDb3B5UGF0aChcbiAgcGF0aDogc3RyaW5nLFxuICBkZXZpY2VOYW1lOiBzdHJpbmcsXG4gIG5vdzogbnVtYmVyLFxuICBleGlzdHM6IChjYW5kaWRhdGVQYXRoOiBzdHJpbmcpID0+IGJvb2xlYW4gPSAoKSA9PiBmYWxzZSxcbik6IHN0cmluZyB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVWYXVsdFBhdGgocGF0aCk7XG4gIGNvbnN0IGRpciA9IHBhcmVudFBhdGgobm9ybWFsaXplZCk7XG4gIGNvbnN0IG5hbWUgPSBiYXNlbmFtZShub3JtYWxpemVkKTtcblxuICBjb25zdCBsYXN0RG90ID0gbmFtZS5sYXN0SW5kZXhPZignLicpO1xuICBjb25zdCBoYXNFeHRlbnNpb24gPSBsYXN0RG90ID4gMDsgLy8gYSBsZWFkaW5nIGRvdCBtYXJrcyBhIGRvdGZpbGUsIG5vdCBhbiBleHRlbnNpb25cbiAgY29uc3Qgc3RlbSA9IGhhc0V4dGVuc2lvbiA/IG5hbWUuc2xpY2UoMCwgbGFzdERvdCkgOiBuYW1lO1xuICBjb25zdCBleHRlbnNpb24gPSBoYXNFeHRlbnNpb24gPyBuYW1lLnNsaWNlKGxhc3REb3QpIDogJyc7XG5cbiAgY29uc3Qgc3VmZml4ID0gYCAoY29uZmxpY3QgJHtmb3JtYXRDb25mbGljdFN0YW1wKG5vdyl9IC0gZnJvbSAke3Nhbml0aXplRGV2aWNlTmFtZShkZXZpY2VOYW1lKX0pYDtcbiAgY29uc3Qgam9pbiA9IChmaWxlTmFtZTogc3RyaW5nKTogc3RyaW5nID0+IChkaXIgPT09ICcvJyA/IGAvJHtmaWxlTmFtZX1gIDogYCR7ZGlyfS8ke2ZpbGVOYW1lfWApO1xuXG4gIGxldCBjYW5kaWRhdGUgPSBqb2luKGAke3N0ZW19JHtzdWZmaXh9JHtleHRlbnNpb259YCk7XG4gIGZvciAobGV0IG4gPSAyOyBuIDw9IE1BWF9DT0xMSVNJT05fU1VGRklYOyBuKyspIHtcbiAgICBpZiAoIWV4aXN0cyhjYW5kaWRhdGUpKSByZXR1cm4gY2FuZGlkYXRlO1xuICAgIGNhbmRpZGF0ZSA9IGpvaW4oYCR7c3RlbX0ke3N1ZmZpeH0gJHtufSR7ZXh0ZW5zaW9ufWApO1xuICB9XG4gIHRocm93IG5ldyBFcnJvcihcbiAgICBgY29uZmxpY3RDb3B5UGF0aDogbW9yZSB0aGFuICR7TUFYX0NPTExJU0lPTl9TVUZGSVh9IGNvbGxpc2lvbnMgZm9yICR7SlNPTi5zdHJpbmdpZnkobm9ybWFsaXplZCl9YCxcbiAgKTtcbn1cblxuLyoqIGAyMDI2LTA4LTIwIDE0LTIzYCBcdTIwMTQgVVRDIGRhdGUsIHNwYWNlLCB6ZXJvLXBhZGRlZCBISC1tbS4gTWludXRlcywgbm90IHNlY29uZHMuICovXG5mdW5jdGlvbiBmb3JtYXRDb25mbGljdFN0YW1wKG5vdzogbnVtYmVyKTogc3RyaW5nIHtcbiAgY29uc3QgZCA9IG5ldyBEYXRlKG5vdyk7XG4gIGNvbnN0IHBhZCA9IChuOiBudW1iZXIpOiBzdHJpbmcgPT4gU3RyaW5nKG4pLnBhZFN0YXJ0KDIsICcwJyk7XG4gIHJldHVybiAoXG4gICAgYCR7ZC5nZXRVVENGdWxsWWVhcigpfS0ke3BhZChkLmdldFVUQ01vbnRoKCkgKyAxKX0tJHtwYWQoZC5nZXRVVENEYXRlKCkpfWAgK1xuICAgIGAgJHtwYWQoZC5nZXRVVENIb3VycygpKX0tJHtwYWQoZC5nZXRVVENNaW51dGVzKCkpfWBcbiAgKTtcbn1cbiIsICIvKipcbiAqIFRocmVlLXdheSByZWNvbmNpbGlhdGlvbiAoQVJDSElURUNUVVJFLm1kIFx1MDBBNzggc3RlcCA0KS5cbiAqXG4gKiBgY29tcHV0ZVN5bmNQbGFuYCBpcyBhIFBVUkUsIERFVEVSTUlOSVNUSUMgZnVuY3Rpb246IHRoZSBzYW1lIGlucHV0cyBhbHdheXNcbiAqIHByb2R1Y2UgdGhlIHNhbWUgcGxhbiAobWFuaWZlc3QgYW5kIGNoYW5nZSBidWNrZXRzIGFyZSByZS1zb3J0ZWRcbiAqIGludGVybmFsbHk7IGBub3dgIGlzIGEgcGFyYW1ldGVyLCBuZXZlciByZWFkIGZyb20gYSBjbG9jaykuIEl0IGNvbXBhcmVzXG4gKiB0aHJlZSBzdGF0ZXMgZm9yIGV2ZXJ5IHBhdGg6XG4gKlxuICogICAtIHRoZSAqKmxvY2FsIGluZGV4KiogXHUyMDE0IHdoYXQgdGhpcyBkZXZpY2UgbGFzdCBrbmV3IGFzIGF1dGhvcml0YXRpdmVcbiAqICAgICAodGhlIFwiY29tbW9uIGFuY2VzdG9yXCIgb2YgdGhlIHRocmVlLXdheSBtZXJnZSk7XG4gKiAgIC0gdGhlICoqbG9jYWwgY2hhbmdlcyoqIFx1MjAxNCBob3cgbG9jYWwgc3RvcmFnZSBkaXZlcmdlZCBmcm9tIHRoZSBpbmRleFxuICogICAgIHdoaWxlIG9mZmxpbmUgKGBzY2FuLnRzYCBvdXRwdXQpO1xuICogICAtIHRoZSAqKm1hbmlmZXN0KiogXHUyMDE0IHRoZSBhdXRob3JpdHkncyBjdXJyZW50IGhlYWQgcGVyIHBhdGguXG4gKlxuICogYW5kIGVtaXRzIGEgYFN5bmNQbGFuYCAoc2hhcGUgZG9jdW1lbnRlZCBvbiB0aGUgaW50ZXJmYWNlKTogb3BzIHRvIHB1c2gsXG4gKiBvcHMgdG8gcHVsbCwgY29uZmxpY3QgcmVzb2x1dGlvbnMsIGFuZCBmb2xkZXIgcGxhY2Vob2xkZXJzIHRvIHB1c2guXG4gKlxuICogQ29uZmxpY3QgYXJiaXRyYXRpb24gbWlycm9ycyB0aGUgRE8ncyBydWxlIChcdTAwQTc0KTogd2lubmVyID0gaGlnaGVyIGxvZ2ljYWxcbiAqIGNsb2NrOyB0aWUgXHUyMTkyIGdyZWF0ZXIgZGV2aWNlSWQuIFRoZSBsb2NhbCBzaWRlJ3MgKnRlbnRhdGl2ZSogY2xvY2sgaXNcbiAqIGBuZXh0Q2xvY2soaW5kZXggY2xvY2ssIHRoaXNEZXZpY2VJZClgIFx1MjAxNCBleGFjdGx5IHRoZSBjb3VudGVyIHRoZSBETyB3b3VsZFxuICogYXNzaWduIGEgY29tbWl0IGJ1aWxkaW5nIG9uIHRoZSBzYW1lIHBhcmVudCwgc28gdGhlIGNsaWVudCdzIHByZWRpY3Rpb25cbiAqIG1hdGNoZXMgdGhlIHNlcnZlcidzIGFyYml0cmF0aW9uLiBXaGVuIHRoZSByZW1vdGUgc2lkZSB3aW5zLCB0aGUgbG9zaW5nXG4gKiBsb2NhbCBjb250ZW50IGlzIHByZXNlcnZlZCBieSBwdXNoaW5nIGl0IHRvIGEgY29uZmxpY3QtY29weSBwYXRoXG4gKiAoYGNvbmZsaWN0bmFtZXMudHNgKTsgd2hlbiB0aGUgbG9jYWwgc2lkZSB3aW5zLCB0aGUgY2xpZW50IHNpbXBseSBjb21taXRzXG4gKiB3aXRoIGl0cyAobm93IHN0YWxlKSBwYXJlbnQgdmVyc2lvbiBhbmQgbGV0cyB0aGUgc2VydmVyIGFyYml0cmF0ZSBcdTIwMTQgdGhlXG4gKiBzZXJ2ZXIgc3ludGhlc2l6ZXMgYW55IGNvbmZsaWN0IGNvcHkgZm9yIHRoZSBsb3NpbmcgcmVtb3RlIGNvbnRlbnQsIHdoaWNoXG4gKiBhcnJpdmVzIGxhdGVyIGFzIGFuIG9yZGluYXJ5IGNoYW5nZSBldmVudC5cbiAqL1xuXG5pbXBvcnQgeyBjb21wYXJlQ2xvY2tzLCBuZXh0Q2xvY2sgfSBmcm9tICcuL2Nsb2NrLmpzJztcbmltcG9ydCB7IGNvbmZsaWN0Q29weVBhdGggfSBmcm9tICcuL2NvbmZsaWN0bmFtZXMuanMnO1xuaW1wb3J0IHR5cGUgeyBMb2NhbEluZGV4LCBMb2NhbEluZGV4RW50cnkgfSBmcm9tICcuL2xvY2FsaW5kZXguanMnO1xuaW1wb3J0IHsgcGFyZW50UGF0aCB9IGZyb20gJy4vcGF0aHMuanMnO1xuaW1wb3J0IHR5cGUgeyBNYW5pZmVzdEVudHJ5IH0gZnJvbSAnLi9wcm90b2NvbC5qcyc7XG5pbXBvcnQgdHlwZSB7IERlbGV0ZWRDYW5kaWRhdGUsIExvY2FsQ2hhbmdlcywgUmVuYW1lQ2FuZGlkYXRlLCBTY2FuQ2FuZGlkYXRlIH0gZnJvbSAnLi9zY2FuLmpzJztcbmltcG9ydCB0eXBlIHsgTG9naWNhbENsb2NrIH0gZnJvbSAnLi90eXBlcy5qcyc7XG5cbi8qKlxuICogQSBtYW5pZmVzdCBlbnRyeSBhcyByZWNvbmNpbGlhdGlvbiBjb25zdW1lcyBpdC4gU2luY2UgYE1hbmlmZXN0RW50cnlgIGdyZXdcbiAqIGBwYXRoYCwgYGNsb2NrYCwgYW5kIGBpc0ZvbGRlcmAgKHByb3RvY29sIHYxLCBwcmUtcmVsZWFzZSksIHRoaXMgaXMgbm93IHRoZVxuICogbWFuaWZlc3QgZW50cnkgaXRzZWxmIFx1MjAxNCBrZXB0IGFzIGEgbmFtZWQgYWxpYXMgc28gYGNvbXB1dGVTeW5jUGxhbmAncyBpbnB1dFxuICogY29udHJhY3Qgc3RheXMgc2VsZi1kb2N1bWVudGluZy5cbiAqL1xuZXhwb3J0IHR5cGUgUmVtb3RlRmlsZSA9IE1hbmlmZXN0RW50cnk7XG5cbi8qKiBJbnB1dCB0byBgY29tcHV0ZVN5bmNQbGFuYC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU3luY1BsYW5JbnB1dCB7XG4gIGxvY2FsQ2hhbmdlczogTG9jYWxDaGFuZ2VzO1xuICBpbmRleDogTG9jYWxJbmRleDtcbiAgbWFuaWZlc3Q6IHJlYWRvbmx5IFJlbW90ZUZpbGVbXTtcbiAgdGhpc0RldmljZUlkOiBzdHJpbmc7XG4gIC8qKiBIdW1hbi1yZWFkYWJsZSBuYW1lIG9mIHRoaXMgZGV2aWNlIFx1MjAxNCB1c2VkIGluIGNvbmZsaWN0LWNvcHkgZmlsZSBuYW1lcy4gKi9cbiAgdGhpc0RldmljZU5hbWU6IHN0cmluZztcbiAgLyoqIEVwb2NoIG1zIHVzZWQgZm9yIGNvbmZsaWN0LWNvcHkgdGltZXN0YW1wcyAocGFzc2VkIGluIGZvciBkZXRlcm1pbmlzbSkuICovXG4gIG5vdzogbnVtYmVyO1xufVxuXG4vKiogV2h5IGEgcGF0aCB3ZW50IHRocm91Z2ggY29uZmxpY3QgcmVzb2x1dGlvbi4gKi9cbmV4cG9ydCB0eXBlIENvbmZsaWN0UmVhc29uID0gJ2NvbmN1cnJlbnQtZWRpdCcgfCAnYWRkLXZzLWFkZCcgfCAnZGVsZXRlLXZzLWVkaXQnIHwgJ3JlbmFtZS1yYWNlJztcblxuLyoqXG4gKiBBIGNvbW1pdCB0aGlzIGRldmljZSBzaG91bGQgc2VuZCAocGF5bG9hZCBvZiBhIHByb3RvY29sIGBjb21taXRgIG1lc3NhZ2UpLlxuICpcbiAqIGBwYXJlbnRWZXJzaW9uYCBzZW1hbnRpY3M6XG4gKiAgIC0gbG9jYWwtb25seSBjaGFuZ2VzIGFuZCBsb2NhbC13aW5zIGNvbmZsaWN0cyBuYW1lIHRoZSAqaW5kZXgqIGhlYWQgKG9yXG4gKiAgICAgYG51bGxgIGZvciBicmFuZC1uZXcgcGF0aHMpIFx1MjAxNCBkZWxpYmVyYXRlbHkgc3RhbGUgd2hlbiBhIGNvbmZsaWN0IHdhc1xuICogICAgIHByZWRpY3RlZCwgc28gdGhlIERPIGFyYml0cmF0ZXMgYW5kIHByZXNlcnZlcyB0aGUgbG9zaW5nIHJlbW90ZVxuICogICAgIGNvbnRlbnQgc2VydmVyLXNpZGU7XG4gKiAgIC0gY29uZmxpY3QtY29weSBwdXNoZXMgbmFtZSB0aGUgKnJlbW90ZSogaGVhZCAoZmFzdC1wYXRoOiB0aGV5IGJ1aWxkIG9uXG4gKiAgICAgdGhlIHdpbm5lciBhbmQgbXVzdCBub3QgcmUtY29uZmxpY3QpLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFB1c2hGaWxlT3Age1xuICBraW5kOiAnYWRkJyB8ICdlZGl0JyB8ICdkZWxldGUnIHwgJ3Jlc3RvcmUnIHwgJ2NvbmZsaWN0Q29weSc7XG4gIHBhdGg6IHN0cmluZztcbiAgcGFyZW50VmVyc2lvbjogc3RyaW5nIHwgbnVsbDtcbiAgLyoqIENvbnRlbnQgaGFzaDsgZGVsZXRlIG9wcyByZXVzZSB0aGUgZGVsZXRlZCBjb250ZW50J3MgaGFzaC4gKi9cbiAgaGFzaDogc3RyaW5nO1xuICBzaXplOiBudW1iZXI7XG4gIC8qKiBUcnVlIGZvciBmb2xkZXItdG9tYnN0b25lIGRlbGV0ZXMgKGBoYXNoICcnYCwgc2l6ZSAwKSBcdTIwMTQgRlItMTAgbGlmZWN5Y2xlLiAqL1xuICBpc0ZvbGRlcj86IGJvb2xlYW47XG59XG5cbi8qKiBBIGxvY2FsIHJlbmFtZSB0byBjb21taXQgYXMgb25lIGNoYWluIG1pZ3JhdGlvbiAoRlItOSkuICovXG5leHBvcnQgaW50ZXJmYWNlIFB1c2hSZW5hbWVPcCB7XG4gIGtpbmQ6ICdyZW5hbWUnO1xuICBmcm9tUGF0aDogc3RyaW5nO1xuICB0b1BhdGg6IHN0cmluZztcbiAgLyoqIFZlcnNpb24gb2YgdGhlIGBmcm9tUGF0aGAgaGVhZCB0aGlzIHJlbmFtZSBidWlsZHMgb24uICovXG4gIHBhcmVudFZlcnNpb246IHN0cmluZyB8IG51bGw7XG4gIGhhc2g6IHN0cmluZztcbiAgc2l6ZTogbnVtYmVyO1xufVxuXG5leHBvcnQgdHlwZSBQdXNoT3AgPSBQdXNoRmlsZU9wIHwgUHVzaFJlbmFtZU9wO1xuXG4vKiogUmVtb3RlIGNvbnRlbnQgdGhpcyBkZXZpY2Ugc2hvdWxkIGZldGNoIGFuZCBtYXRlcmlhbGl6ZSB2aWEgYGFwcGx5UHVsbGAuICovXG5leHBvcnQgaW50ZXJmYWNlIFB1bGxGaWxlT3Age1xuICBraW5kOiAnYWRkJyB8ICdlZGl0JyB8ICdkZWxldGUnIHwgJ3Jlc3RvcmUnO1xuICBwYXRoOiBzdHJpbmc7XG4gIGhhc2g6IHN0cmluZztcbiAgc2l6ZTogbnVtYmVyO1xuICB2ZXJzaW9uOiBzdHJpbmc7XG4gIGNsb2NrOiBMb2dpY2FsQ2xvY2s7XG4gIC8qKiBUcnVlIGZvciB0b21ic3RvbmVzIChraW5kIGAnZGVsZXRlJ2ApLiAqL1xuICBkZWxldGVkOiBib29sZWFuO1xuICAvKiogVHJ1ZSBmb3IgZW1wdHktZm9sZGVyIHBsYWNlaG9sZGVyIHB1bGxzIChGUi0xMCkgXHUyMDE0IG1hdGVyaWFsaXplIHdpdGggYGVuc3VyZURpcmAuICovXG4gIGlzRm9sZGVyPzogYm9vbGVhbjtcbn1cblxuLyoqIEEgcmVtb3RlIHJlbmFtZSB0byBmb2xsb3cgbG9jYWxseSAoZGV0ZWN0ZWQgYnkgaGFzaCBjb3JyZWxhdGlvbikuICovXG5leHBvcnQgaW50ZXJmYWNlIFB1bGxSZW5hbWVPcCB7XG4gIGtpbmQ6ICdyZW5hbWUnO1xuICBmcm9tUGF0aDogc3RyaW5nO1xuICB0b1BhdGg6IHN0cmluZztcbiAgaGFzaDogc3RyaW5nO1xuICBzaXplOiBudW1iZXI7XG4gIHZlcnNpb246IHN0cmluZztcbiAgY2xvY2s6IExvZ2ljYWxDbG9jaztcbn1cblxuZXhwb3J0IHR5cGUgUHVsbE9wID0gUHVsbEZpbGVPcCB8IFB1bGxSZW5hbWVPcDtcblxuLyoqXG4gKiBPbmUgYXJiaXRyYXRlZCBjb25mbGljdC4gYGxvc2VyQ29udGVudGAgaXMgYCdub25lJ2Agd2hlbiB0aGUgbG9zaW5nIHNpZGVcbiAqIHdhcyBhIGRlbGV0aW9uIChub3RoaW5nIHRvIHByZXNlcnZlKS4gV2hlbiB0aGUgbG9jYWwgY29udGVudCBsb3N0IGFuZCBoYWRcbiAqIGNvbnRlbnQsIGBjb25mbGljdENvcHlQYXRoYCBuYW1lcyB3aGVyZSB0aGUgcGxhbiBwcmVzZXJ2ZXMgaXQgKHRoZSBwdXNoXG4gKiBpdHNlbGYgaXMgaW4gYFN5bmNQbGFuLnB1c2hlc2Agd2l0aCBraW5kIGAnY29uZmxpY3RDb3B5J2ApLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIENvbmZsaWN0T3Age1xuICBwYXRoOiBzdHJpbmc7XG4gIHJlYXNvbjogQ29uZmxpY3RSZWFzb247XG4gIHdpbm5lcjogJ2xvY2FsJyB8ICdyZW1vdGUnO1xuICBsb3NlckNvbnRlbnQ6ICdsb2NhbCcgfCAncmVtb3RlJyB8ICdub25lJztcbiAgY29uZmxpY3RDb3B5UGF0aD86IHN0cmluZztcbiAgcmVtb3RlOiB7IHZlcnNpb246IHN0cmluZzsgaGFzaDogc3RyaW5nOyBzaXplOiBudW1iZXI7IGRlbGV0ZWQ6IGJvb2xlYW47IGNsb2NrOiBMb2dpY2FsQ2xvY2sgfTtcbiAgLyoqIFRoZSB0ZW50YXRpdmUgY2xvY2sgdGhlIGxvY2FsIHNpZGUgd2FzIGFyYml0cmF0ZWQgd2l0aC4gKi9cbiAgbG9jYWxDbG9jazogTG9naWNhbENsb2NrO1xufVxuXG4vKipcbiAqIFRoZSBjb21wbGV0ZSByZWNvbmNpbGlhdGlvbiByZXN1bHQgZm9yIG9uZSBzeW5jIGN5Y2xlLiBPcHMgYXJlIHNvcnRlZCBieVxuICogdGFyZ2V0IHBhdGggKHJlbmFtZXMgYnkgYHRvUGF0aGApOyBldmVyeSBhcnJheSBtYXkgYmUgZW1wdHkuIGBwdXNoZXNgIGFuZFxuICogYHB1bGxzYCBhcmUgaW5kZXBlbmRlbnQgXHUyMDE0IGEgcGF0aCBhcHBlYXJzIGF0IG1vc3Qgb25jZSBpbiBlYWNoLiBQdXNoZXMgYXJlXG4gKiBOT1QgYXBwbGllZCB0byB0aGUgbG9jYWwgaW5kZXggdW50aWwgdGhlIHNlcnZlciBhY2tzIHRoZW07IHB1bGxzIGFyZVxuICogYXBwbGllZCBieSBgYXBwbHlQdWxsYCAoYGVuZ2luZS50c2ApLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFN5bmNQbGFuIHtcbiAgLyoqIENvbW1pdHMgdG8gc2VuZCwgaW4gb3JkZXIuICovXG4gIHB1c2hlczogUHVzaE9wW107XG4gIC8qKiBSZW1vdGUgY2hhbmdlcyB0byBtYXRlcmlhbGl6ZSwgaW4gb3JkZXIuICovXG4gIHB1bGxzOiBQdWxsT3BbXTtcbiAgLyoqIENvbmZsaWN0cyB0aGF0IHdlcmUgYXJiaXRyYXRlZCAoaW5mb3JtYXRpb25hbDsgc2lkZSBlZmZlY3RzIGxpdmUgaW4gcHVzaGVzL3B1bGxzKS4gKi9cbiAgY29uZmxpY3RzOiBDb25mbGljdE9wW107XG4gIC8qKiBFbXB0eS1mb2xkZXIgcGxhY2Vob2xkZXIgcGF0aHMgdG8gY3JlYXRlIHJlbW90ZWx5IChGUi0xMCkuICovXG4gIGZvbGRlclB1c2hlczogc3RyaW5nW107XG59XG5cbi8qKiBJbnRlcm5hbDogYSBsb2NhbCBjYW5kaWRhdGUgKGFkZGVkL21vZGlmaWVkL2RlbGV0ZWQpIHVuaWZpZWQgZm9yIHJlc29sdXRpb24uICovXG5pbnRlcmZhY2UgTG9jYWxDYW5kaWRhdGUge1xuICBwYXRoOiBzdHJpbmc7XG4gIGtpbmQ6ICdhZGQnIHwgJ2VkaXQnIHwgJ3Jlc3RvcmUnIHwgJ2RlbGV0ZSc7XG4gIGhhc2g6IHN0cmluZztcbiAgc2l6ZTogbnVtYmVyO1xuICAvKiogRm9sZGVyLXBsYWNlaG9sZGVyIGRlbGV0aW9ucyAoYHNjYW4uZm9sZGVyRGVsZXRpb25zYCkgcmVzb2x2ZSBhcyB0b21ic3RvbmVzLiAqL1xuICBpc0ZvbGRlcj86IGJvb2xlYW47XG59XG5cbmNvbnN0IFpFUk9fQ0xPQ0s6IExvZ2ljYWxDbG9jayA9IHsgY291bnRlcjogMCwgZGV2aWNlSWQ6ICcnIH07XG5cbi8qKlxuICogQ29tcHV0ZSB0aGUgc3luYyBwbGFuLiBTZWUgdGhlIG1vZHVsZSBkb2MgZm9yIHRoZSBtb2RlbCBhbmQgdGhlIG9wXG4gKiBzZW1hbnRpY3MuIFRocm93cyBub3RoaW5nIG9uIG9yZGluYXJ5IGRpdmVyZ2VuY2UgXHUyMDE0IGNvbmZsaWN0cyBhcmUgZGF0YSxcbiAqIG5vdCBlcnJvcnMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb21wdXRlU3luY1BsYW4oaW5wdXQ6IFN5bmNQbGFuSW5wdXQpOiBTeW5jUGxhbiB7XG4gIGNvbnN0IHsgbG9jYWxDaGFuZ2VzLCBpbmRleCwgdGhpc0RldmljZUlkLCB0aGlzRGV2aWNlTmFtZSwgbm93IH0gPSBpbnB1dDtcbiAgY29uc3QgbWFuaWZlc3QgPSBbLi4uaW5wdXQubWFuaWZlc3RdLnNvcnQoKGEsIGIpID0+IGNvbXBhcmVTdHJpbmdzKGEucGF0aCwgYi5wYXRoKSk7XG4gIGNvbnN0IG1hbmlmZXN0QnlQYXRoID0gbmV3IE1hcChtYW5pZmVzdC5tYXAoKGVudHJ5KSA9PiBbZW50cnkucGF0aCwgZW50cnldKSk7XG5cbiAgY29uc3QgcHVzaGVzOiBQdXNoT3BbXSA9IFtdO1xuICBjb25zdCBwdWxsczogUHVsbE9wW10gPSBbXTtcbiAgY29uc3QgY29uZmxpY3RzOiBDb25mbGljdE9wW10gPSBbXTtcblxuICAvLyBFdmVyeSBwYXRoIHRoZSBsb2NhbCBzaWRlIGRpdmVyZ2VkIG9uIChzY2FuIGJ1Y2tldHMgKyBib3RoIGVuZHMgb2YgcmVuYW1lcykuXG4gIGNvbnN0IGxvY2FsUGF0aHMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgZm9yIChjb25zdCBjIG9mIGxvY2FsQ2hhbmdlcy5hZGRlZCkgbG9jYWxQYXRocy5hZGQoYy5wYXRoKTtcbiAgZm9yIChjb25zdCBjIG9mIGxvY2FsQ2hhbmdlcy5tb2RpZmllZCkgbG9jYWxQYXRocy5hZGQoYy5wYXRoKTtcbiAgZm9yIChjb25zdCBkIG9mIGxvY2FsQ2hhbmdlcy5kZWxldGVkKSBsb2NhbFBhdGhzLmFkZChkLnBhdGgpO1xuICBmb3IgKGNvbnN0IHIgb2YgbG9jYWxDaGFuZ2VzLnJlbmFtZWQpIHtcbiAgICBsb2NhbFBhdGhzLmFkZChyLmZyb20pO1xuICAgIGxvY2FsUGF0aHMuYWRkKHIudG8pO1xuICB9XG4gIGZvciAoY29uc3QgZiBvZiBsb2NhbENoYW5nZXMuZm9sZGVyRGVsZXRpb25zKSBsb2NhbFBhdGhzLmFkZChmLnBhdGgpO1xuXG4gIC8vIFBhdGhzIGFscmVhZHkgY29uc3VtZWQgYnkgYW4gZWFybGllciBwaGFzZSAocmVuYW1lIGNvcnJlbGF0aW9uIGV0Yy4pLlxuICBjb25zdCBjb25zdW1lZCA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuXG4gIGNvbnN0IHBhdGhFeGlzdHMgPSAocGF0aDogc3RyaW5nKTogYm9vbGVhbiA9PiBwYXRoIGluIGluZGV4IHx8IG1hbmlmZXN0QnlQYXRoLmhhcyhwYXRoKTtcblxuICAvLyAtLS0gUGhhc2UgQTogbG9jYWwgcmVuYW1lcyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgLy8gVW5jb250ZXN0ZWQ6IG9uZSBQdXNoUmVuYW1lT3AuIENvbnRlc3RlZCAocmVtb3RlIGNoYW5nZWQgYXQgZWl0aGVyIGVuZCk6XG4gIC8vIGRlY29tcG9zZSBcdTIwMTQgdGhlIGBmcm9tYCBzaWRlIGlzIHJlc29sdmVkIG9uIGl0cyBvd24gKHVzdWFsbHkgdG9tYnN0b25lZFxuICAvLyBvciBwdWxsZWQpLCB0aGUgcmVuYW1lZCBjb250ZW50IGlzIHBsYWNlZCBhdCBgdG9gIHRocm91Z2ggdGhlIGdlbmVyaWNcbiAgLy8gY29udGVudCBtYWNoaW5lcnkuIENvbnRlbnQgaXMgbmV2ZXIgbG9zdCBlaXRoZXIgd2F5LlxuICBmb3IgKGNvbnN0IHJlbmFtZSBvZiBbLi4ubG9jYWxDaGFuZ2VzLnJlbmFtZWRdLnNvcnQoKGEsIGIpID0+IGNvbXBhcmVTdHJpbmdzKGEuZnJvbSwgYi5mcm9tKSkpIHtcbiAgICBjb25zdCBpbmRleEZyb20gPSBpbmRleFtyZW5hbWUuZnJvbV07XG4gICAgY29uc3QgaW5kZXhUbyA9IGluZGV4W3JlbmFtZS50b107XG4gICAgY29uc3QgcmVtb3RlRnJvbSA9IG1hbmlmZXN0QnlQYXRoLmdldChyZW5hbWUuZnJvbSk7XG4gICAgY29uc3QgcmVtb3RlVG8gPSBtYW5pZmVzdEJ5UGF0aC5nZXQocmVuYW1lLnRvKTtcblxuICAgIGNvbnN0IGZyb21DaGFuZ2VkID0gcmVtb3RlRnJvbVxuICAgICAgPyByZW1vdGVFbnRyeUNoYW5nZWQoaW5kZXhGcm9tLCByZW1vdGVGcm9tKVxuICAgICAgOiBpbmRleEZyb20/LmRlbGV0ZWRBdCA9PT0gdW5kZWZpbmVkOyAvLyBhYnNlbnQgcmVtb3RlbHkgKyBsaXZlIGxvY2FsbHkgXHUyMUQyIGNoYW5nZWRcbiAgICBjb25zdCB0b0NoYW5nZWQgPSByZW1vdGVUb1xuICAgICAgPyByZW1vdGVFbnRyeUNoYW5nZWQoaW5kZXhUbywgcmVtb3RlVG8pXG4gICAgICA6IGZhbHNlOyAvLyBhYnNlbnQgcmVtb3RlbHkgXHUyMUQyIG5vdGhpbmcgdG8gcmFjZSBhdCBgdG9gXG5cbiAgICBpZiAoIWZyb21DaGFuZ2VkICYmICF0b0NoYW5nZWQpIHtcbiAgICAgIHB1c2hlcy5wdXNoKHtcbiAgICAgICAga2luZDogJ3JlbmFtZScsXG4gICAgICAgIGZyb21QYXRoOiByZW5hbWUuZnJvbSxcbiAgICAgICAgdG9QYXRoOiByZW5hbWUudG8sXG4gICAgICAgIHBhcmVudFZlcnNpb246IGluZGV4RnJvbT8udmVyc2lvbklkID8/IG51bGwsXG4gICAgICAgIGhhc2g6IHJlbmFtZS5oYXNoLFxuICAgICAgICBzaXplOiByZW5hbWUuc2l6ZSxcbiAgICAgIH0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgLy8gYGZyb21gIHNpZGUgb2YgYSBjb250ZXN0ZWQgcmVuYW1lOlxuICAgIGlmICghZnJvbUNoYW5nZWQpIHtcbiAgICAgIC8vIE5vdGhpbmcgcmVtb3RlIHRoZXJlIFx1MjAxNCB0aGUgbW92ZSBpdHNlbGYgcmVtb3ZlcyB0aGUgb2xkIHBhdGguXG4gICAgICBpZiAoaW5kZXhGcm9tICYmIGluZGV4RnJvbS5kZWxldGVkQXQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICBwdXNoZXMucHVzaCh7XG4gICAgICAgICAga2luZDogJ2RlbGV0ZScsXG4gICAgICAgICAgcGF0aDogcmVuYW1lLmZyb20sXG4gICAgICAgICAgcGFyZW50VmVyc2lvbjogaW5kZXhGcm9tLnZlcnNpb25JZCxcbiAgICAgICAgICBoYXNoOiBpbmRleEZyb20uaGFzaCxcbiAgICAgICAgICBzaXplOiBpbmRleEZyb20uc2l6ZSxcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmICghcmVtb3RlRnJvbSB8fCByZW1vdGVGcm9tLmRlbGV0ZWQpIHtcbiAgICAgIC8vIFJlbW90ZSBkZWxldGVkIChvciBtaWdyYXRlZCBhd2F5IGZyb20pIGBmcm9tYCBcdTIwMTQgZGVsZXRpb24gc3RhbmRzIGZvclxuICAgICAgLy8gdGhlIG9sZCBwYXRoOyB0aGUgcmVuYW1lZCBjb250ZW50IHN1cnZpdmVzIGF0IGB0b2AuXG4gICAgICBwdWxscy5wdXNoKFxuICAgICAgICBwdWxsRmlsZSgnZGVsZXRlJywgcmVuYW1lLmZyb20sIHtcbiAgICAgICAgICBoYXNoOiByZW1vdGVGcm9tPy5oYXNoID8/IGluZGV4RnJvbT8uaGFzaCA/PyByZW5hbWUuaGFzaCxcbiAgICAgICAgICBzaXplOiByZW1vdGVGcm9tPy5zaXplID8/IGluZGV4RnJvbT8uc2l6ZSA/PyByZW5hbWUuc2l6ZSxcbiAgICAgICAgICB2ZXJzaW9uOiByZW1vdGVGcm9tPy52ZXJzaW9uID8/ICcnLFxuICAgICAgICAgIGNsb2NrOiByZW1vdGVGcm9tPy5jbG9jayA/PyBpbmRleEZyb20/LmNsb2NrID8/IFpFUk9fQ0xPQ0ssXG4gICAgICAgICAgZGVsZXRlZDogdHJ1ZSxcbiAgICAgICAgfSksXG4gICAgICApO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBSZW1vdGUgZWRpdGVkIGBmcm9tYC4gVGhlIHJlbW90ZSBlZGl0IGtlZXBzIHRoZSBvbGQgcGF0aDsgdGhlIG1vdmVkXG4gICAgICAvLyBjb250ZW50IGlzIHBsYWNlZCBhdCBgdG9gIGJlbG93IFx1MjAxNCBhIHJlbmFtZS1yYWNlIHRoZSBsb2NhbCBzaWRlXG4gICAgICAvLyBjb25jZWRlcyB1bmxlc3MgaXRzIGNsb2NrIHdpbnMgdGhlIHJlbmFtZSBwdXNoLlxuICAgICAgY29uc3QgbG9jYWxDbG9jayA9IG5leHRDbG9jayhpbmRleEZyb20/LmNsb2NrLCB0aGlzRGV2aWNlSWQpO1xuICAgICAgaWYgKGNvbXBhcmVDbG9ja3MocmVtb3RlRnJvbS5jbG9jaywgbG9jYWxDbG9jaykgPiAwKSB7XG4gICAgICAgIHB1bGxzLnB1c2gocHVsbEZpbGUoJ2VkaXQnLCByZW5hbWUuZnJvbSwgcmVtb3RlRnJvbSkpO1xuICAgICAgICBjb25mbGljdHMucHVzaCh7XG4gICAgICAgICAgcGF0aDogcmVuYW1lLmZyb20sXG4gICAgICAgICAgcmVhc29uOiAncmVuYW1lLXJhY2UnLFxuICAgICAgICAgIHdpbm5lcjogJ3JlbW90ZScsXG4gICAgICAgICAgLy8gTG9jYWwgY29udGVudCBpcyBwcmVzZXJ2ZWQgYnkgdGhlIHJlbmFtZSBpdHNlbGYgKHB1c2hlZCBhdCBgdG9gKS5cbiAgICAgICAgICBsb3NlckNvbnRlbnQ6ICdsb2NhbCcsXG4gICAgICAgICAgcmVtb3RlOiByZW1vdGVTdW1tYXJ5KHJlbW90ZUZyb20pLFxuICAgICAgICAgIGxvY2FsQ2xvY2ssXG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcHVzaGVzLnB1c2goe1xuICAgICAgICAgIGtpbmQ6ICdyZW5hbWUnLFxuICAgICAgICAgIGZyb21QYXRoOiByZW5hbWUuZnJvbSxcbiAgICAgICAgICB0b1BhdGg6IHJlbmFtZS50byxcbiAgICAgICAgICBwYXJlbnRWZXJzaW9uOiBpbmRleEZyb20/LnZlcnNpb25JZCA/PyBudWxsLFxuICAgICAgICAgIGhhc2g6IHJlbmFtZS5oYXNoLFxuICAgICAgICAgIHNpemU6IHJlbmFtZS5zaXplLFxuICAgICAgICB9KTtcbiAgICAgICAgY29uZmxpY3RzLnB1c2goe1xuICAgICAgICAgIHBhdGg6IHJlbmFtZS5mcm9tLFxuICAgICAgICAgIHJlYXNvbjogJ3JlbmFtZS1yYWNlJyxcbiAgICAgICAgICB3aW5uZXI6ICdsb2NhbCcsXG4gICAgICAgICAgbG9zZXJDb250ZW50OiAncmVtb3RlJyxcbiAgICAgICAgICByZW1vdGU6IHJlbW90ZVN1bW1hcnkocmVtb3RlRnJvbSksXG4gICAgICAgICAgbG9jYWxDbG9jayxcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnRpbnVlOyAvLyB0aGUgcmVuYW1lIHB1c2ggY2FycmllcyB0aGUgY29udGVudDsgbm8gYHRvYCBvcCBuZWVkZWRcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBgdG9gIHNpZGUgb2YgYSBjb250ZXN0ZWQgcmVuYW1lOlxuICAgIGlmICghdG9DaGFuZ2VkKSB7XG4gICAgICBwdXNoZXMucHVzaCh7XG4gICAgICAgIGtpbmQ6IGluZGV4VG8/LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkID8gJ3Jlc3RvcmUnIDogJ2FkZCcsXG4gICAgICAgIHBhdGg6IHJlbmFtZS50byxcbiAgICAgICAgcGFyZW50VmVyc2lvbjogaW5kZXhUbz8udmVyc2lvbklkID8/IG51bGwsXG4gICAgICAgIGhhc2g6IHJlbmFtZS5oYXNoLFxuICAgICAgICBzaXplOiByZW5hbWUuc2l6ZSxcbiAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXNvbHZlQ29udGVzdGVkUGF0aChyZW5hbWUudG8sIGluZGV4VG8sIHJlbW90ZVRvIGFzIFJlbW90ZUZpbGUsIHtcbiAgICAgICAgcGF0aDogcmVuYW1lLnRvLFxuICAgICAgICBraW5kOiBpbmRleFRvPy5kZWxldGVkQXQgIT09IHVuZGVmaW5lZCA/ICdyZXN0b3JlJyA6ICdhZGQnLFxuICAgICAgICBoYXNoOiByZW5hbWUuaGFzaCxcbiAgICAgICAgc2l6ZTogcmVuYW1lLnNpemUsXG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICAvLyAtLS0gUGhhc2UgQjogcmVtb3RlIHJlbmFtZXMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgLy8gQSBwYXRoIGxpdmUgaW4gdGhlIGluZGV4IGJ1dCBBQlNFTlQgZnJvbSB0aGUgbWFuaWZlc3Qgd2FzIG1pZ3JhdGVkIGJ5IHRoZVxuICAvLyBhdXRob3JpdHkgKHRvbWJzdG9uZXMgYXBwZWFyIGluIHRoZSBtYW5pZmVzdCB3aXRoIGRlbGV0ZWQ6dHJ1ZSBcdTIwMTQgb25seSBhXG4gIC8vIHJlbmFtZSByZW1vdmVzIGEgcGF0aCkuIENvcnJlbGF0ZSBieSBjb250ZW50IGhhc2ggYWdhaW5zdCBuZXcgbWFuaWZlc3RcbiAgLy8gcGF0aHMsIHNhbWUtcGFyZW50IHByZWZlcnJlZCwgc21hbGxlc3QgcGF0aCB3aXRoaW4gYSBwcmVmZXJlbmNlIGNsYXNzLlxuICBmb3IgKGNvbnN0IGZyb20gb2YgT2JqZWN0LmtleXMoaW5kZXgpXG4gICAgLmZpbHRlcigocCkgPT4ge1xuICAgICAgY29uc3QgZW50cnkgPSBpbmRleFtwXSBhcyBMb2NhbEluZGV4RW50cnk7XG4gICAgICByZXR1cm4gZW50cnkuZGVsZXRlZEF0ID09PSB1bmRlZmluZWQgJiYgIWVudHJ5LmlzRm9sZGVyO1xuICAgIH0pXG4gICAgLnNvcnQoY29tcGFyZVN0cmluZ3MpKSB7XG4gICAgaWYgKGxvY2FsUGF0aHMuaGFzKGZyb20pIHx8IGNvbnN1bWVkLmhhcyhmcm9tKSkgY29udGludWU7XG4gICAgaWYgKG1hbmlmZXN0QnlQYXRoLmhhcyhmcm9tKSkgY29udGludWU7IC8vIHByZXNlbnQgKGxpdmUgb3IgdG9tYnN0b25lZCkgXHUyMUQyIG5vdCBtaWdyYXRlZFxuICAgIGNvbnN0IGVudHJ5ID0gaW5kZXhbZnJvbV0gYXMgTG9jYWxJbmRleEVudHJ5O1xuXG4gICAgbGV0IGJlc3Q6IFJlbW90ZUZpbGUgfCB1bmRlZmluZWQ7XG4gICAgbGV0IGJlc3RTYW1lRGlyID0gZmFsc2U7XG4gICAgZm9yIChjb25zdCBjYW5kaWRhdGUgb2YgbWFuaWZlc3QpIHtcbiAgICAgIGlmIChjYW5kaWRhdGUuZGVsZXRlZCkgY29udGludWU7XG4gICAgICBpZiAobG9jYWxQYXRocy5oYXMoY2FuZGlkYXRlLnBhdGgpIHx8IGNvbnN1bWVkLmhhcyhjYW5kaWRhdGUucGF0aCkpIGNvbnRpbnVlO1xuICAgICAgY29uc3Qga25vd24gPSBpbmRleFtjYW5kaWRhdGUucGF0aF07XG4gICAgICBpZiAoa25vd24gIT09IHVuZGVmaW5lZCAmJiBrbm93bi5kZWxldGVkQXQgPT09IHVuZGVmaW5lZCkgY29udGludWU7IC8vIHRhcmdldCBub3QgbmV3XG4gICAgICBpZiAoY2FuZGlkYXRlLmhhc2ggIT09IGVudHJ5Lmhhc2gpIGNvbnRpbnVlO1xuICAgICAgY29uc3Qgc2FtZURpciA9IHBhcmVudFBhdGgoY2FuZGlkYXRlLnBhdGgpID09PSBwYXJlbnRQYXRoKGZyb20pO1xuICAgICAgaWYgKGJlc3QgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICBiZXN0ID0gY2FuZGlkYXRlO1xuICAgICAgICBiZXN0U2FtZURpciA9IHNhbWVEaXI7XG4gICAgICB9IGVsc2UgaWYgKHNhbWVEaXIgJiYgIWJlc3RTYW1lRGlyKSB7XG4gICAgICAgIGJlc3QgPSBjYW5kaWRhdGU7XG4gICAgICAgIGJlc3RTYW1lRGlyID0gdHJ1ZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoYmVzdCkge1xuICAgICAgcHVsbHMucHVzaCh7XG4gICAgICAgIGtpbmQ6ICdyZW5hbWUnLFxuICAgICAgICBmcm9tUGF0aDogZnJvbSxcbiAgICAgICAgdG9QYXRoOiBiZXN0LnBhdGgsXG4gICAgICAgIGhhc2g6IGJlc3QuaGFzaCxcbiAgICAgICAgc2l6ZTogYmVzdC5zaXplLFxuICAgICAgICB2ZXJzaW9uOiBiZXN0LnZlcnNpb24sXG4gICAgICAgIGNsb2NrOiBiZXN0LmNsb2NrLFxuICAgICAgfSk7XG4gICAgICBjb25zdW1lZC5hZGQoZnJvbSk7XG4gICAgICBjb25zdW1lZC5hZGQoYmVzdC5wYXRoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gQWJzZW50IHdpdGhvdXQgY29ycmVsYXRpb246IHRoZSBhdXRob3JpdHkgbm8gbG9uZ2VyIGtub3dzIHRoZSBwYXRoLlxuICAgICAgLy8gVHJlYXQgYXMgYSByZW1vdGUgZGVsZXRlIHdpdGggdW5rbm93biBoZWFkIHZlcnNpb24gKCcnIFx1MjAxNCB0aGUgbmV4dFxuICAgICAgLy8gZnVsbCBtYW5pZmVzdCBoZWFscyB0aGUgdmVyc2lvbiBpZCkuIFRoaXMgYWxzbyBjb3ZlcnMgcmVtb3RlXG4gICAgICAvLyByZW5hbWUrZWRpdCwgd2hpY2ggZ2VudWluZWx5IGlzIGRlbGV0ZSArIGFkZC5cbiAgICAgIHB1bGxzLnB1c2goXG4gICAgICAgIHB1bGxGaWxlKCdkZWxldGUnLCBmcm9tLCB7XG4gICAgICAgICAgaGFzaDogZW50cnkuaGFzaCxcbiAgICAgICAgICBzaXplOiBlbnRyeS5zaXplLFxuICAgICAgICAgIHZlcnNpb246ICcnLFxuICAgICAgICAgIGNsb2NrOiBlbnRyeS5jbG9jayxcbiAgICAgICAgICBkZWxldGVkOiB0cnVlLFxuICAgICAgICB9KSxcbiAgICAgICk7XG4gICAgICBjb25zdW1lZC5hZGQoZnJvbSk7XG4gICAgfVxuICB9XG5cbiAgLy8gLS0tIFBoYXNlIEM6IHJlbWFpbmluZyByZW1vdGUtb25seSBjaGFuZ2VzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gIGZvciAoY29uc3QgcmVtb3RlIG9mIG1hbmlmZXN0KSB7XG4gICAgaWYgKGxvY2FsUGF0aHMuaGFzKHJlbW90ZS5wYXRoKSB8fCBjb25zdW1lZC5oYXMocmVtb3RlLnBhdGgpKSBjb250aW51ZTtcbiAgICBjb25zdCBlbnRyeSA9IGluZGV4W3JlbW90ZS5wYXRoXTtcbiAgICBpZiAoIXJlbW90ZUVudHJ5Q2hhbmdlZChlbnRyeSwgcmVtb3RlKSkgY29udGludWU7XG4gICAgaWYgKGVudHJ5ID09PSB1bmRlZmluZWQpIHtcbiAgICAgIGlmICghcmVtb3RlLmRlbGV0ZWQpIHtcbiAgICAgICAgcHVsbHMucHVzaChwdWxsRmlsZSgnYWRkJywgcmVtb3RlLnBhdGgsIHJlbW90ZSkpO1xuICAgICAgICBjb25zdW1lZC5hZGQocmVtb3RlLnBhdGgpO1xuICAgICAgfVxuICAgICAgLy8gZGVsZXRlZCArIG5ldmVyIGtub3duIGxvY2FsbHkgXHUyMUQyIG5vdGhpbmcgdG8gZG9cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAocmVtb3RlLmRlbGV0ZWQpIHtcbiAgICAgIHB1bGxzLnB1c2gocHVsbEZpbGUoJ2RlbGV0ZScsIHJlbW90ZS5wYXRoLCByZW1vdGUpKTsgLy8gaW5jbHVkZXMgdG9tYnN0b25lXHUyMTkydG9tYnN0b25lIHZlcnNpb24gY2F0Y2gtdXBcbiAgICB9IGVsc2UgaWYgKGVudHJ5LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBwdWxscy5wdXNoKHB1bGxGaWxlKCdyZXN0b3JlJywgcmVtb3RlLnBhdGgsIHJlbW90ZSkpO1xuICAgIH0gZWxzZSB7XG4gICAgICBwdWxscy5wdXNoKHB1bGxGaWxlKCdlZGl0JywgcmVtb3RlLnBhdGgsIHJlbW90ZSkpO1xuICAgIH1cbiAgICBjb25zdW1lZC5hZGQocmVtb3RlLnBhdGgpO1xuICB9XG5cbiAgLy8gLS0tIFBoYXNlIEQ6IGxvY2FsIGNhbmRpZGF0ZXMgKGxvY2FsLW9ubHkgcHVzaGVzICsgYm90aC1jaGFuZ2VkKSAtLS0tLS0tXG4gIGNvbnN0IGNhbmRpZGF0ZXM6IExvY2FsQ2FuZGlkYXRlW10gPSBbXG4gICAgLi4ubG9jYWxDaGFuZ2VzLmFkZGVkLm1hcCgoYykgPT4gKHsgLi4uYywga2luZDogJ2FkZCcgYXMgY29uc3QgfSkpLFxuICAgIC4uLmxvY2FsQ2hhbmdlcy5tb2RpZmllZC5tYXAoKGMpID0+ICh7XG4gICAgICAuLi5jLFxuICAgICAga2luZDogaW5kZXhbYy5wYXRoXT8uZGVsZXRlZEF0ICE9PSB1bmRlZmluZWQgPyAoJ3Jlc3RvcmUnIGFzIGNvbnN0KSA6ICgnZWRpdCcgYXMgY29uc3QpLFxuICAgIH0pKSxcbiAgICAuLi5sb2NhbENoYW5nZXMuZGVsZXRlZC5tYXAoKGQpOiBMb2NhbENhbmRpZGF0ZSA9PiAoeyAuLi5kLCBraW5kOiAnZGVsZXRlJyB9KSksXG4gICAgLy8gRm9sZGVyIHBsYWNlaG9sZGVycyB3aG9zZSBkaXJlY3RvcnkgdmFuaXNoZWQ6IHRvbWJzdG9uZSBwdXNoZXMuIFRoZXlcbiAgICAvLyBjYXJyeSBubyBjb250ZW50IChoYXNoICcnL3NpemUgMCkgYW5kIGNhbiBuZXZlciBwYWlyIHdpdGggYW4gYWRkLCBzb1xuICAgIC8vIHRoZXkgam9pbiBoZXJlIHJhdGhlciB0aGFuIHRoZSBgZGVsZXRlZGAgYnVja2V0IChyZW5hbWUgY29ycmVsYXRpb24sXG4gICAgLy8gY29uZmxpY3QgY29waWVzIFx1MjAxNCBuZWl0aGVyIGFwcGxpZXMgdG8gcGxhY2Vob2xkZXJzKS5cbiAgICAuLi5sb2NhbENoYW5nZXMuZm9sZGVyRGVsZXRpb25zLm1hcChcbiAgICAgIChmKTogTG9jYWxDYW5kaWRhdGUgPT4gKHtcbiAgICAgICAgcGF0aDogZi5wYXRoLFxuICAgICAgICBraW5kOiAnZGVsZXRlJyxcbiAgICAgICAgaGFzaDogJycsXG4gICAgICAgIHNpemU6IDAsXG4gICAgICAgIGlzRm9sZGVyOiB0cnVlLFxuICAgICAgfSksXG4gICAgKSxcbiAgXS5zb3J0KChhLCBiKSA9PiBjb21wYXJlU3RyaW5ncyhhLnBhdGgsIGIucGF0aCkpO1xuXG4gIGZvciAoY29uc3QgY2FuZGlkYXRlIG9mIGNhbmRpZGF0ZXMpIHtcbiAgICBjb25zdCBlbnRyeSA9IGluZGV4W2NhbmRpZGF0ZS5wYXRoXTtcbiAgICBjb25zdCByZW1vdGUgPSBtYW5pZmVzdEJ5UGF0aC5nZXQoY2FuZGlkYXRlLnBhdGgpO1xuICAgIGNvbnN0IHJlbW90ZUNoYW5nZWRIZXJlID1cbiAgICAgIHJlbW90ZSAhPT0gdW5kZWZpbmVkICYmIChlbnRyeSAhPT0gdW5kZWZpbmVkID8gcmVtb3RlLnZlcnNpb24gIT09IGVudHJ5LnZlcnNpb25JZCA6ICFyZW1vdGUuZGVsZXRlZCk7XG4gICAgaWYgKCFyZW1vdGVDaGFuZ2VkSGVyZSkge1xuICAgICAgcHVzaExvY2FsKGNhbmRpZGF0ZSwgZW50cnkpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXNvbHZlQ29udGVzdGVkUGF0aChjYW5kaWRhdGUucGF0aCwgZW50cnksIHJlbW90ZSBhcyBSZW1vdGVGaWxlLCBjYW5kaWRhdGUpO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7XG4gICAgcHVzaGVzOiBwdXNoZXMuc29ydCgoYSwgYikgPT4gY29tcGFyZVN0cmluZ3Mob3BQYXRoKGEpLCBvcFBhdGgoYikpKSxcbiAgICBwdWxsczogcHVsbHMuc29ydCgoYSwgYikgPT4gY29tcGFyZVN0cmluZ3Mob3BQYXRoKGEpLCBvcFBhdGgoYikpKSxcbiAgICBjb25mbGljdHM6IGNvbmZsaWN0cy5zb3J0KChhLCBiKSA9PiBjb21wYXJlU3RyaW5ncyhhLnBhdGgsIGIucGF0aCkpLFxuICAgIGZvbGRlclB1c2hlczogWy4uLmxvY2FsQ2hhbmdlcy5lbXB0eUZvbGRlcnNdLnNvcnQoY29tcGFyZVN0cmluZ3MpLFxuICB9O1xuXG4gIC8vIC0tLSBoZWxwZXJzIChjbG9zZSBvdmVyIHRoZSBhY2N1bXVsYXRvcnMpIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIGZ1bmN0aW9uIHB1c2hMb2NhbChjYW5kaWRhdGU6IExvY2FsQ2FuZGlkYXRlLCBlbnRyeTogTG9jYWxJbmRleEVudHJ5IHwgdW5kZWZpbmVkKTogdm9pZCB7XG4gICAgaWYgKGNhbmRpZGF0ZS5raW5kID09PSAnZGVsZXRlJykge1xuICAgICAgcHVzaGVzLnB1c2goe1xuICAgICAgICBraW5kOiAnZGVsZXRlJyxcbiAgICAgICAgcGF0aDogY2FuZGlkYXRlLnBhdGgsXG4gICAgICAgIHBhcmVudFZlcnNpb246IGVudHJ5Py52ZXJzaW9uSWQgPz8gbnVsbCxcbiAgICAgICAgaGFzaDogZW50cnk/Lmhhc2ggPz8gY2FuZGlkYXRlLmhhc2gsXG4gICAgICAgIHNpemU6IGVudHJ5Py5zaXplID8/IGNhbmRpZGF0ZS5zaXplLFxuICAgICAgICAuLi4oY2FuZGlkYXRlLmlzRm9sZGVyID8geyBpc0ZvbGRlcjogdHJ1ZSB9IDoge30pLFxuICAgICAgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHB1c2hlcy5wdXNoKHtcbiAgICAgIGtpbmQ6IGNhbmRpZGF0ZS5raW5kLFxuICAgICAgcGF0aDogY2FuZGlkYXRlLnBhdGgsXG4gICAgICBwYXJlbnRWZXJzaW9uOiBlbnRyeT8udmVyc2lvbklkID8/IG51bGwsXG4gICAgICBoYXNoOiBjYW5kaWRhdGUuaGFzaCxcbiAgICAgIHNpemU6IGNhbmRpZGF0ZS5zaXplLFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIEJvdGggc2lkZXMgY2hhbmdlZCBvbmUgcGF0aC4gQXJiaXRyYXRlIHBlciBcdTAwQTc0LiBMb2NhbCBkZWxldGlvbnMgbmV2ZXIgZ2V0XG4gICAqIGEgY29uZmxpY3QgY29weSAobm8gY29udGVudCB0byBwcmVzZXJ2ZSk7IGxvY2FsICpjb250ZW50KiB0aGF0IGxvc2VzIGlzXG4gICAqIHByZXNlcnZlZCB2aWEgYSBjb25mbGljdC1jb3B5IHB1c2guXG4gICAqL1xuICBmdW5jdGlvbiByZXNvbHZlQ29udGVzdGVkUGF0aChcbiAgICBwYXRoOiBzdHJpbmcsXG4gICAgZW50cnk6IExvY2FsSW5kZXhFbnRyeSB8IHVuZGVmaW5lZCxcbiAgICByZW1vdGU6IFJlbW90ZUZpbGUsXG4gICAgbG9jYWw6IExvY2FsQ2FuZGlkYXRlLFxuICApOiB2b2lkIHtcbiAgICBjb25zdCBsb2NhbENsb2NrID0gbmV4dENsb2NrKGVudHJ5Py5jbG9jaywgdGhpc0RldmljZUlkKTtcbiAgICBjb25zdCByZW1vdGVXaW5zID0gY29tcGFyZUNsb2NrcyhyZW1vdGUuY2xvY2ssIGxvY2FsQ2xvY2spID4gMDsgLy8gMCBcdTIxRDIgbG9jYWwgKGRvY3VtZW50ZWQpXG4gICAgY29uc3Qgc3VtbWFyeSA9IHJlbW90ZVN1bW1hcnkocmVtb3RlKTtcbiAgICBjb25zdCByZWFzb246IENvbmZsaWN0UmVhc29uID1cbiAgICAgIGxvY2FsLmtpbmQgPT09ICdkZWxldGUnIHx8IHJlbW90ZS5kZWxldGVkXG4gICAgICAgID8gJ2RlbGV0ZS12cy1lZGl0J1xuICAgICAgICA6IGVudHJ5ID09PSB1bmRlZmluZWRcbiAgICAgICAgICA/ICdhZGQtdnMtYWRkJ1xuICAgICAgICAgIDogJ2NvbmN1cnJlbnQtZWRpdCc7XG5cbiAgICBpZiAobG9jYWwua2luZCA9PT0gJ2RlbGV0ZScgJiYgcmVtb3RlLmRlbGV0ZWQpIHtcbiAgICAgIC8vIEJvdGggZGVsZXRlZCBcdTIwMTQgY29udmVyZ2Ugc2lsZW50bHkgb24gdGhlIHJlbW90ZSB0b21ic3RvbmUuXG4gICAgICBwdWxscy5wdXNoKHB1bGxGaWxlKCdkZWxldGUnLCBwYXRoLCByZW1vdGUpKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAobG9jYWwua2luZCA9PT0gJ2RlbGV0ZScpIHtcbiAgICAgIC8vIExvY2FsIGRlbGV0ZSB2cyByZW1vdGUgZWRpdC5cbiAgICAgIGlmIChyZW1vdGVXaW5zKSB7XG4gICAgICAgIHB1bGxzLnB1c2gocHVsbEZpbGUoJ2VkaXQnLCBwYXRoLCByZW1vdGUpKTsgLy8gZmlsZSBpcyByZWNyZWF0ZWRcbiAgICAgICAgY29uZmxpY3RzLnB1c2goe1xuICAgICAgICAgIHBhdGgsIHJlYXNvbiwgd2lubmVyOiAncmVtb3RlJywgbG9zZXJDb250ZW50OiAnbm9uZScsXG4gICAgICAgICAgcmVtb3RlOiBzdW1tYXJ5LCBsb2NhbENsb2NrLFxuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHB1c2hlcy5wdXNoKHtcbiAgICAgICAgICBraW5kOiAnZGVsZXRlJyxcbiAgICAgICAgICBwYXRoLFxuICAgICAgICAgIHBhcmVudFZlcnNpb246IGVudHJ5Py52ZXJzaW9uSWQgPz8gbnVsbCxcbiAgICAgICAgICBoYXNoOiBlbnRyeT8uaGFzaCA/PyBsb2NhbC5oYXNoLFxuICAgICAgICAgIHNpemU6IGVudHJ5Py5zaXplID8/IGxvY2FsLnNpemUsXG4gICAgICAgICAgLi4uKGxvY2FsLmlzRm9sZGVyID8geyBpc0ZvbGRlcjogdHJ1ZSB9IDoge30pLFxuICAgICAgICB9KTtcbiAgICAgICAgY29uZmxpY3RzLnB1c2goe1xuICAgICAgICAgIHBhdGgsIHJlYXNvbiwgd2lubmVyOiAnbG9jYWwnLCBsb3NlckNvbnRlbnQ6ICdyZW1vdGUnLFxuICAgICAgICAgIHJlbW90ZTogc3VtbWFyeSwgbG9jYWxDbG9jayxcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKHJlbW90ZS5kZWxldGVkKSB7XG4gICAgICAvLyBMb2NhbCBlZGl0IHZzIHJlbW90ZSBkZWxldGUuXG4gICAgICBpZiAocmVtb3RlV2lucykge1xuICAgICAgICBwdWxscy5wdXNoKHB1bGxGaWxlKCdkZWxldGUnLCBwYXRoLCByZW1vdGUpKTtcbiAgICAgICAgY29uZmxpY3RzLnB1c2goe1xuICAgICAgICAgIHBhdGgsIHJlYXNvbiwgd2lubmVyOiAncmVtb3RlJywgbG9zZXJDb250ZW50OiAnbG9jYWwnLFxuICAgICAgICAgIGNvbmZsaWN0Q29weVBhdGg6IHB1c2hDb25mbGljdENvcHkocGF0aCwgbG9jYWwsIHJlbW90ZSksXG4gICAgICAgICAgcmVtb3RlOiBzdW1tYXJ5LCBsb2NhbENsb2NrLFxuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHB1c2hlcy5wdXNoKHtcbiAgICAgICAgICBraW5kOiBsb2NhbC5raW5kLFxuICAgICAgICAgIHBhdGgsXG4gICAgICAgICAgcGFyZW50VmVyc2lvbjogZW50cnk/LnZlcnNpb25JZCA/PyBudWxsLFxuICAgICAgICAgIGhhc2g6IGxvY2FsLmhhc2gsXG4gICAgICAgICAgc2l6ZTogbG9jYWwuc2l6ZSxcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbmZsaWN0cy5wdXNoKHtcbiAgICAgICAgICBwYXRoLCByZWFzb24sIHdpbm5lcjogJ2xvY2FsJywgbG9zZXJDb250ZW50OiAnbm9uZScsXG4gICAgICAgICAgcmVtb3RlOiBzdW1tYXJ5LCBsb2NhbENsb2NrLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBDb25jdXJyZW50IGNvbnRlbnQgKGVkaXQtdnMtZWRpdCBvciBhZGQtdnMtYWRkKS5cbiAgICBpZiAobG9jYWwuaGFzaCA9PT0gcmVtb3RlLmhhc2gpIHtcbiAgICAgIC8vIEJ5dGUtaWRlbnRpY2FsIGNvbnRlbnQgb24gYm90aCBzaWRlcyAoYSBzZWNvbmQgZGV2aWNlIHBhaXJpbmcgb3ZlclxuICAgICAgLy8gZmlsZXMgaXQgYWxyZWFkeSBoYXMsIG9yIGJvdGggc2lkZXMgbWFraW5nIHRoZSBzYW1lIGVkaXQpOiBub3RoaW5nXG4gICAgICAvLyBkaXN0aW5jdCB0byBwcmVzZXJ2ZSwgc28gbm8gY29uZmxpY3QgcmVjb3JkIGFuZCBubyBjb3B5IFx1MjAxNCBjb252ZXJnZVxuICAgICAgLy8gc2lsZW50bHkgb24gdGhlIHJlbW90ZSBoZWFkIHJlZ2FyZGxlc3Mgb2YgY2xvY2sgb3JkZXIgKG1pcnJvcnMgdGhlXG4gICAgICAvLyBzZXJ2ZXIncyBhcmJpdHJhdGlvbiwgd2hpY2ggc3ludGhlc2l6ZXMgbm8gY29weSBmb3IgaWRlbnRpY2FsIGNvbnRlbnQpLlxuICAgICAgcHVsbHMucHVzaChcbiAgICAgICAgcHVsbEZpbGUoZW50cnk/LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkID8gJ3Jlc3RvcmUnIDogZW50cnkgPT09IHVuZGVmaW5lZCA/ICdhZGQnIDogJ2VkaXQnLCBwYXRoLCByZW1vdGUpLFxuICAgICAgKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKHJlbW90ZVdpbnMpIHtcbiAgICAgIHB1bGxzLnB1c2goXG4gICAgICAgIHB1bGxGaWxlKGVudHJ5Py5kZWxldGVkQXQgIT09IHVuZGVmaW5lZCA/ICdyZXN0b3JlJyA6IGVudHJ5ID09PSB1bmRlZmluZWQgPyAnYWRkJyA6ICdlZGl0JywgcGF0aCwgcmVtb3RlKSxcbiAgICAgICk7XG4gICAgICBjb25mbGljdHMucHVzaCh7XG4gICAgICAgIHBhdGgsIHJlYXNvbiwgd2lubmVyOiAncmVtb3RlJywgbG9zZXJDb250ZW50OiAnbG9jYWwnLFxuICAgICAgICBjb25mbGljdENvcHlQYXRoOiBwdXNoQ29uZmxpY3RDb3B5KHBhdGgsIGxvY2FsLCByZW1vdGUpLFxuICAgICAgICByZW1vdGU6IHN1bW1hcnksIGxvY2FsQ2xvY2ssXG4gICAgICB9KTtcbiAgICB9IGVsc2Uge1xuICAgICAgcHVzaGVzLnB1c2goe1xuICAgICAgICBraW5kOiBsb2NhbC5raW5kLFxuICAgICAgICBwYXRoLFxuICAgICAgICAvLyBEZWxpYmVyYXRlbHkgdGhlIChzdGFsZSkgaW5kZXggcGFyZW50OiB0aGUgRE8gbXVzdCBhcmJpdHJhdGUgYW5kXG4gICAgICAgIC8vIHN5bnRoZXNpemUgdGhlIGNvbmZsaWN0IGNvcHkgZm9yIHRoZSBsb3NpbmcgcmVtb3RlIGNvbnRlbnQuXG4gICAgICAgIHBhcmVudFZlcnNpb246IGVudHJ5Py52ZXJzaW9uSWQgPz8gbnVsbCxcbiAgICAgICAgaGFzaDogbG9jYWwuaGFzaCxcbiAgICAgICAgc2l6ZTogbG9jYWwuc2l6ZSxcbiAgICAgIH0pO1xuICAgICAgY29uZmxpY3RzLnB1c2goe1xuICAgICAgICBwYXRoLCByZWFzb24sIHdpbm5lcjogJ2xvY2FsJywgbG9zZXJDb250ZW50OiAncmVtb3RlJyxcbiAgICAgICAgcmVtb3RlOiBzdW1tYXJ5LCBsb2NhbENsb2NrLFxuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFB1c2ggdGhlIGxvc2luZyBsb2NhbCBjb250ZW50IHRvIGEgY29uZmxpY3QtY29weSBwYXRoOyByZXR1cm5zIHRoZSBwYXRoLFxuICAgKiBvciBgdW5kZWZpbmVkYCB3aGVuIHRoZSBsb3NpbmcgY29udGVudCBpcyBieXRlLWlkZW50aWNhbCB0byB0aGUgd2lubmVyJ3NcbiAgICogKGEgc2FtZS1jb250ZW50IHJhY2UgXHUyMDE0IG5vdGhpbmcgZGlzdGluY3QgdG8gcHJlc2VydmU7IG1hdGNoZXMgdGhlIHNlcnZlcidzXG4gICAqIGFyYml0cmF0aW9uLCB3aGljaCBsaWtld2lzZSBzeW50aGVzaXplcyBubyBjb3B5IGZvciBpZGVudGljYWwgY29udGVudCkuXG4gICAqL1xuICBmdW5jdGlvbiBwdXNoQ29uZmxpY3RDb3B5KHBhdGg6IHN0cmluZywgbG9jYWw6IExvY2FsQ2FuZGlkYXRlLCByZW1vdGU6IFJlbW90ZUZpbGUpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIGlmIChsb2NhbC5oYXNoID09PSByZW1vdGUuaGFzaCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICBjb25zdCBjb3B5UGF0aCA9IGNvbmZsaWN0Q29weVBhdGgocGF0aCwgdGhpc0RldmljZU5hbWUsIG5vdywgcGF0aEV4aXN0cyk7XG4gICAgcHVzaGVzLnB1c2goe1xuICAgICAga2luZDogJ2NvbmZsaWN0Q29weScsXG4gICAgICBwYXRoOiBjb3B5UGF0aCxcbiAgICAgIC8vIEJ1aWxkIG9uIHRoZSB3aW5uaW5nIHJlbW90ZSBoZWFkOiB0aGlzIHB1c2ggbXVzdCBmYXN0LXBhdGguXG4gICAgICBwYXJlbnRWZXJzaW9uOiByZW1vdGUudmVyc2lvbixcbiAgICAgIGhhc2g6IGxvY2FsLmhhc2gsXG4gICAgICBzaXplOiBsb2NhbC5zaXplLFxuICAgIH0pO1xuICAgIHJldHVybiBjb3B5UGF0aDtcbiAgfVxufVxuXG4vLyAtLS0gbW9kdWxlLWxldmVsIGhlbHBlcnMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmZ1bmN0aW9uIHB1bGxGaWxlKFxuICBraW5kOiBQdWxsRmlsZU9wWydraW5kJ10sXG4gIHBhdGg6IHN0cmluZyxcbiAgcmVtb3RlOiBQaWNrPFJlbW90ZUZpbGUsICdoYXNoJyB8ICdzaXplJyB8ICd2ZXJzaW9uJyB8ICdjbG9jaycgfCAnaXNGb2xkZXInPiAmIHtcbiAgICBkZWxldGVkPzogYm9vbGVhbjtcbiAgfSxcbik6IFB1bGxGaWxlT3Age1xuICByZXR1cm4ge1xuICAgIGtpbmQsXG4gICAgcGF0aCxcbiAgICBoYXNoOiByZW1vdGUuaGFzaCxcbiAgICBzaXplOiByZW1vdGUuc2l6ZSxcbiAgICB2ZXJzaW9uOiByZW1vdGUudmVyc2lvbixcbiAgICBjbG9jazogcmVtb3RlLmNsb2NrLFxuICAgIGRlbGV0ZWQ6IHJlbW90ZS5kZWxldGVkID8/IGtpbmQgPT09ICdkZWxldGUnLFxuICAgIC4uLihyZW1vdGUuaXNGb2xkZXIgPyB7IGlzRm9sZGVyOiB0cnVlIH0gOiB7fSksXG4gIH07XG59XG5cbmZ1bmN0aW9uIHJlbW90ZVN1bW1hcnkocmVtb3RlOiBSZW1vdGVGaWxlKTogQ29uZmxpY3RPcFsncmVtb3RlJ10ge1xuICByZXR1cm4ge1xuICAgIHZlcnNpb246IHJlbW90ZS52ZXJzaW9uLFxuICAgIGhhc2g6IHJlbW90ZS5oYXNoLFxuICAgIHNpemU6IHJlbW90ZS5zaXplLFxuICAgIGRlbGV0ZWQ6IHJlbW90ZS5kZWxldGVkLFxuICAgIGNsb2NrOiByZW1vdGUuY2xvY2ssXG4gIH07XG59XG5cbi8qKlxuICogV2hldGhlciB0aGUgcmVtb3RlIGhlYWQgZm9yIGEgcGF0aCBkaWZmZXJzIGZyb20gd2hhdCB0aGUgaW5kZXggcmVjb3Jkcy5cbiAqIFZlcnNpb24gaWRzIGFyZSB0aGUgcHJpbWFyeSBzaWduYWwgKGNsaWVudCBhbmQgRE8gc2hhcmUgb25lIGlkIHNwYWNlKTtcbiAqIGEgcGF0aCBhYnNlbnQgcmVtb3RlbHkgY291bnRzIGFzIGNoYW5nZWQgb25seSB3aGlsZSB0aGUgaW5kZXggc3RpbGwgaG9sZHNcbiAqIGl0IGxpdmUgXHUyMDE0IGNhbGxlcnMgZGVjaWRlIHdoYXQgYWJzZW5jZSAqbWVhbnMqIChyZW5hbWUgdnMgZGVsZXRlKS5cbiAqL1xuZnVuY3Rpb24gcmVtb3RlRW50cnlDaGFuZ2VkKFxuICBlbnRyeTogTG9jYWxJbmRleEVudHJ5IHwgdW5kZWZpbmVkLFxuICByZW1vdGU6IFJlbW90ZUZpbGUgfCB1bmRlZmluZWQsXG4pOiBib29sZWFuIHtcbiAgaWYgKHJlbW90ZSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gZmFsc2U7XG4gIGlmIChlbnRyeSA9PT0gdW5kZWZpbmVkKSByZXR1cm4gIXJlbW90ZS5kZWxldGVkO1xuICByZXR1cm4gcmVtb3RlLnZlcnNpb24gIT09IGVudHJ5LnZlcnNpb25JZDtcbn1cblxuZnVuY3Rpb24gb3BQYXRoKG9wOiBQdXNoT3AgfCBQdWxsT3ApOiBzdHJpbmcge1xuICByZXR1cm4gb3Aua2luZCA9PT0gJ3JlbmFtZScgPyBvcC50b1BhdGggOiBvcC5wYXRoO1xufVxuXG5mdW5jdGlvbiBjb21wYXJlU3RyaW5ncyhhOiBzdHJpbmcsIGI6IHN0cmluZyk6IG51bWJlciB7XG4gIHJldHVybiBhIDwgYiA/IC0xIDogYSA+IGIgPyAxIDogMDtcbn1cbiIsICIvKipcbiAqIExvY2FsIGNoYW5nZSBkZXRlY3Rpb24gKEFSQ0hJVEVDVFVSRS5tZCBcdTAwQTc4IHN0ZXAgMykuXG4gKlxuICogYHNjYW5WYXVsdGAgd2Fsa3MgdGhlIHN0b3JhZ2UgYWRhcHRlciwgYXBwbGllcyB0aGUgc2hhcmVkIGlnbm9yZSBydWxlcyxcbiAqIGhhc2hlcyBub24taWdub3JlZCBmaWxlcyAoc2hhMjU2IFx1MjAxNCBzYW1lIGFzIGJsb2IgYWRkcmVzc2luZykgYW5kIGRpZmZzXG4gKiB0aGUgcmVzdWx0IGFnYWluc3QgdGhlIGNsaWVudCdzIGBMb2NhbEluZGV4YC4gVGhlIGRpZmYgY2xhc3NpZmllczpcbiAqXG4gKiAgIC0gYGFkZGVkYCAgICBcdTIwMTQgZmlsZSBwcmVzZW50LCBwYXRoIHVua25vd24gdG8gdGhlIGluZGV4O1xuICogICAtIGBtb2RpZmllZGAgXHUyMDE0IGZpbGUgcHJlc2VudCwgY29udGVudCBoYXNoIGRpZmZlcnMgZnJvbSB0aGUgaW5kZXggZW50cnkuXG4gKiAgICAgICAgICAgICAgICAgIEEgZmlsZSB3aG9zZSBpbmRleCBlbnRyeSBpcyBhICp0b21ic3RvbmUqIGFsc28gbGFuZHMgaGVyZVxuICogICAgICAgICAgICAgICAgICAoZG9jdW1lbnRlZCBkZWNpc2lvbik6IHdoZXRoZXIgaXQgaXMgYW4gZWRpdC1vZi1kZWxldGVkXG4gKiAgICAgICAgICAgICAgICAgIG9yIGEgcHVyZSByZXN1cnJlY3QsIHRoZSByZXNvbHV0aW9uIGlzIGlkZW50aWNhbCBcdTIwMTQgbG9jYWxcbiAqICAgICAgICAgICAgICAgICAgY29udGVudCBleGlzdHMgdGhhdCB0aGUgaW5kZXggaGVhZCBkb2VzIG5vdCByZWZsZWN0O1xuICogICAtIGBkZWxldGVkYCAgXHUyMDE0IGluZGV4IGVudHJ5IGxpdmUsIGZpbGUgZ29uZTtcbiAqICAgLSBgcmVuYW1lZGAgIFx1MjAxNCBhIGRlbGV0ZSArIGFkZCBwYWlyICp3aXRoaW4gb25lIHNjYW4qIHdob3NlIGNvbnRlbnRcbiAqICAgICAgICAgICAgICAgICAgaGFzaGVzIG1hdGNoIChBUkNISVRFQ1RVUkUgXHUwMEE3NCByZW5hbWUgY29ycmVsYXRpb24pLiBBXG4gKiAgICAgICAgICAgICAgICAgIHJlbmFtZSB3aG9zZSBjb250ZW50IGFsc28gY2hhbmdlZCAocmVuYW1lICsgZWRpdCkgbm9cbiAqICAgICAgICAgICAgICAgICAgbG9uZ2VyIGNvcnJlbGF0ZXMgYW5kIGZhbGxzIGJhY2sgdG8gZGVsZXRlICsgYWRkIFx1MjAxNCB0aGF0XG4gKiAgICAgICAgICAgICAgICAgIGlzIHRoZSBkb2N1bWVudGVkLCBjb3JyZWN0IHYxIGJlaGF2aW9yO1xuICogICAtIGBlbXB0eUZvbGRlcnNgIFx1MjAxNCBkaXJlY3RvcmllcyBleGlzdGluZyBpbiBzdG9yYWdlIGJ1dCByZXByZXNlbnRlZFxuICogICAgICAgICAgICAgICAgICBuZWl0aGVyIGJ5IGEgbGl2ZSBmb2xkZXIgcGxhY2Vob2xkZXIgaW4gdGhlIGluZGV4IG5vciBieVxuICogICAgICAgICAgICAgICAgICBhbnkgZmlsZSBiZW5lYXRoIHRoZW0gKEZSLTEwKTtcbiAqICAgLSBgZm9sZGVyRGVsZXRpb25zYCBcdTIwMTQgbGl2ZSBmb2xkZXIgcGxhY2Vob2xkZXIgZW50cmllcyB3aG9zZSBkaXJlY3RvcnlcbiAqICAgICAgICAgICAgICAgICAgbm8gbG9uZ2VyIGV4aXN0cyBpbiBzdG9yYWdlOiB0aGUgdXNlciBkZWxldGVkIGFuIGVtcHR5XG4gKiAgICAgICAgICAgICAgICAgIGZvbGRlciAob3IgcHJ1bmUtb24tZGVsZXRlIHJlbW92ZWQgaXQsIGBlbmdpbmUudHNgKSwgYW5kXG4gKiAgICAgICAgICAgICAgICAgIHRoZSBkZWxldGlvbiBtdXN0IHByb3BhZ2F0ZSBhcyBhIGZvbGRlciB0b21ic3RvbmUuIFRoZVxuICogICAgICAgICAgICAgICAgICBidWNrZXQgaXMgU0VQQVJBVEUgZnJvbSBgZGVsZXRlZGAgb24gcHVycG9zZTogZm9sZGVyXG4gKiAgICAgICAgICAgICAgICAgIHBsYWNlaG9sZGVycyBjYXJyeSBubyBjb250ZW50IGhhc2gsIG11c3QgbmV2ZXIgZW50ZXJcbiAqICAgICAgICAgICAgICAgICAgcmVuYW1lIGNvcnJlbGF0aW9uLCBhbmQgcmVzb2x2ZSBhcyBwbGFjZWhvbGRlcnNcbiAqICAgICAgICAgICAgICAgICAgKGBpc0ZvbGRlcmApIGRvd25zdHJlYW0uIEEgcGxhY2Vob2xkZXIgdGhhdCBtZXJlbHkgYmVjYW1lXG4gKiAgICAgICAgICAgICAgICAgIGlnbm9yZWQgKHNldHRpbmdzIGNoYW5nZSkgaXMgTk9UIGEgZGVsZXRpb24gXHUyMDE0IGl0IGlzXG4gKiAgICAgICAgICAgICAgICAgIHNraXBwZWQsIGV4YWN0bHkgbGlrZSBpZ25vcmVkIGZpbGVzLlxuICogICAtIGBzdGFsZURpcnNgIFx1MjAxNCBkaXJlY3RvcmllcyB3aG9zZSBpbmRleCBlbnRyeSBpcyBhIFRPTUJTVE9ORUQgZm9sZGVyXG4gKiAgICAgICAgICAgICAgICAgIHBsYWNlaG9sZGVyIHdoaWxlIGFuIEVNUFRZIGRpcmVjdG9yeSBzdGlsbCBleGlzdHMgb24gZGlza1xuICogICAgICAgICAgICAgICAgICBBTkQgdGhlIHRvbWJzdG9uZSB3YXMgYXV0aG9yZWQgYnkgQU5PVEhFUiBkZXZpY2U6IHRoZVxuICogICAgICAgICAgICAgICAgICByZXNpZHVlIG9mIGEgcmVjb3JkLW9ubHkgdG9tYnN0b25lIGFwcGxpY2F0aW9uIChhbiBhZGFwdGVyXG4gKiAgICAgICAgICAgICAgICAgIHdpdGhvdXQgYHJlbW92ZURpcmAsIG9yIGEgcmVtb3ZhbCB0aGF0IGxvc3QgYSByYWNlKS4gVGhlXG4gKiAgICAgICAgICAgICAgICAgIGxlZnRvdmVyIGlzIENPTlNJU1RFTlQgd2l0aCB0aGUgKHJlbW90ZSkgZGVsZXRpb24sIHNvIGl0XG4gKiAgICAgICAgICAgICAgICAgIG11c3QgTk9UIHJlc3VycmVjdCBhcyBcImxvY2FsIHdpbnNcIjogcmUtcHVzaGluZyBpdCBhcyBhblxuICogICAgICAgICAgICAgICAgICBlbXB0eS1mb2xkZXIgcGxhY2Vob2xkZXIgd291bGQgdW5kbyBhIGRlbGV0aW9uIHRoZSB1c2VyXG4gKiAgICAgICAgICAgICAgICAgIG1hZGUgYW5kIHBpbmctcG9uZyBpdCBiZXR3ZWVuIGRldmljZXMgZm9yZXZlciAob2JzZXJ2ZWRcbiAqICAgICAgICAgICAgICAgICAgZW5kLXRvLWVuZDogQSBkZWxldGVzIFx1MjE5MiBCIHJlY29yZHMtb25seSBcdTIxOTIgQiByZS1wdXNoZXMgXHUyMTkyXG4gKiAgICAgICAgICAgICAgICAgIEEgcmUtcHVsbHMpLiBUaGUgZW50cnkgc3RheXMgdG9tYnN0b25lZDsgdGhlIGNsaWVudCByZXRyaWVzXG4gKiAgICAgICAgICAgICAgICAgIGByZW1vdmVEaXJgIGZvciB0aGVzZSBkaXJzIGVhY2ggY3ljbGUgKGNsaWVudC50cykuIElmIHRoZVxuICogICAgICAgICAgICAgICAgICB0b21ic3RvbmUgd2FzIGF1dGhvcmVkIGJ5IFRISVMgZGV2aWNlLCBvciBjb250ZW50IGV4aXN0c1xuICogICAgICAgICAgICAgICAgICBiZW5lYXRoIHRoZSBkaXJlY3RvcnksIHRoaXMgaXMgZ2VudWluZSBsb2NhbCByZWNyZWF0aW9uOlxuICogICAgICAgICAgICAgICAgICB0aGUgZGlyIGxhbmRzIGluIGBlbXB0eUZvbGRlcnNgIGluc3RlYWQsIHJlc3RvcmluZyB0aGVcbiAqICAgICAgICAgICAgICAgICAgcGxhY2Vob2xkZXIgXHUyMDE0IGxvY2FsIHdpbnMgaXMgY29ycmVjdCB0aGVyZS5cbiAqXG4gKiAjIyBUaGUgbXRpbWUrc2l6ZSBwcmUtZmlsdGVyIChmYXN0IG1vZGUsIHRoZSBkZWZhdWx0KVxuICpcbiAqIFJlLWhhc2hpbmcgYSA1MGstZmlsZSB2YXVsdCBhdCBldmVyeSBhcHAtb3BlbiBpcyBhIHJlYWwgYmF0dGVyeSBjb3N0LCBzb1xuICogZmFzdCBtb2RlIHNraXBzIGhhc2hpbmcgYSBmaWxlIHdob3NlIGBzaXplYCBBTkQgYG10aW1lYCAoZnJvbSB0aGUgc3RvcmFnZVxuICogYWRhcHRlcidzIGBGaWxlU3RhdGApIGV4YWN0bHkgbWF0Y2ggaXRzIGxpdmUgaW5kZXggZW50cnkgXHUyMDE0IHRoZSByZWNvcmRlZFxuICogaGFzaCBjYXJyaWVzIGZvcndhcmQgYXMgdW5jaGFuZ2VkLiBBIGZpbGUgaXMgaGFzaGVkIHdoZW4gaXQgaGFzIG5vIGVudHJ5LFxuICogdGhlIGVudHJ5IGlzIGEgdG9tYnN0b25lIG9yIGZvbGRlciBwbGFjZWhvbGRlciwgdGhlIHNpemUgZGlmZmVycywgb3IgdGhlXG4gKiBtdGltZSBkaWZmZXJzIG9yIGlzIHVua25vd24gKGxlZ2FjeSBzdGF0ZSwgcHVsbHMsIGZpcnN0IHNjYW4pLiBSZW5hbWVcbiAqIGNvcnJlbGF0aW9uIGlzIHVuYWZmZWN0ZWQ6IHRoZSBkZXN0aW5hdGlvbiBwYXRoIG9mIGEgcmVuYW1lIGFsd2F5cyBsb29rc1xuICogJ2FkZGVkJywgc28gaXQgaXMgYWx3YXlzIGhhc2hlZCBcdTIwMTQgY29udGVudC1wcmVzZXJ2aW5nIG1vdmVzIHN0aWxsIHBhaXIuXG4gKlxuICogVGhlIHRyYWRlb2ZmOiBmYXN0IG1vZGUgdHJ1c3RzIHRoZSBmaWxlc3lzdGVtIG5vdCB0byBjaGFuZ2UgY29udGVudCB3aGlsZVxuICogcHJlc2VydmluZyBib3RoIHNpemUgYW5kIG10aW1lLiBGb3IgdmVyaWZpY2F0aW9uIChgdnNhIGRvY3RvcmAsIHBlcmlvZGljXG4gKiBpbnRlZ3JpdHkgY2hlY2tzKSBwYXNzIGB7IG1vZGU6ICdmdWxsJyB9YCB0byByZS1oYXNoIGV2ZXJ5dGhpbmcuXG4gKlxuICogVGhlIGZ1bmN0aW9uIHRha2VzIGBub3dgIGFuZCB0aGUgaWdub3JlIHNldHRpbmdzIGFzIHBhcmFtZXRlcnMgKG5vIGhpZGRlblxuICogY2xvY2tzLCBubyBhbWJpZW50IGNvbmZpZykgYW5kIHJldHVybnMgZGV0ZXJtaW5pc3RpY2FsbHkgb3JkZXJlZCByZXN1bHRzXG4gKiAoZXZlcnkgYnVja2V0IHNvcnRlZCBieSBwYXRoOyByZW5hbWVzIGJ5IGBmcm9tYCkuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBGaWxlU3RhdCwgU3RvcmFnZUFkYXB0ZXIgfSBmcm9tICcuL2FkYXB0ZXJzLmpzJztcbmltcG9ydCB7IHNoYTI1NkhleCB9IGZyb20gJy4vaGFzaGluZy5qcyc7XG5pbXBvcnQgeyBpc0lnbm9yZWQsIHR5cGUgSWdub3JlU2V0dGluZ3MgfSBmcm9tICcuL2lnbm9yZS5qcyc7XG5pbXBvcnQgdHlwZSB7IExvY2FsSW5kZXgsIExvY2FsSW5kZXhFbnRyeSB9IGZyb20gJy4vbG9jYWxpbmRleC5qcyc7XG5pbXBvcnQgeyBwYXJlbnRQYXRoIH0gZnJvbSAnLi9wYXRocy5qcyc7XG5cbi8qKiBJbmplY3RhYmxlIGNvbnRlbnQgaGFzaCAodGhlIGRlZmF1bHQgaXMgc2hhMjU2LCBzYW1lIGFzIGJsb2IgYWRkcmVzc2luZykuICovXG5leHBvcnQgdHlwZSBIYXNoRm4gPSAoYnl0ZXM6IFVpbnQ4QXJyYXkpID0+IFByb21pc2U8c3RyaW5nPjtcblxuLyoqIE9wdGlvbnMgZm9yIGBzY2FuVmF1bHRgLiAqL1xuZXhwb3J0IGludGVyZmFjZSBTY2FuVmF1bHRPcHRpb25zIHtcbiAgLyoqXG4gICAqIGAnZmFzdCdgIChkZWZhdWx0KTogZmlsZXMgd2hvc2Ugc2l6ZSttdGltZSBleGFjdGx5IG1hdGNoIHRoZWlyIGxpdmUgaW5kZXhcbiAgICogZW50cnkgc2tpcCByZS1oYXNoaW5nLiBgJ2Z1bGwnYDogaGFzaCBldmVyeXRoaW5nIHJlZ2FyZGxlc3MgXHUyMDE0IGludGVncml0eVxuICAgKiB2ZXJpZmljYXRpb24gKGB2c2EgZG9jdG9yYCwgcGVyaW9kaWMgY2hlY2tzKS5cbiAgICovXG4gIG1vZGU/OiAnZmFzdCcgfCAnZnVsbCc7XG4gIC8qKiBDb250ZW50IGhhc2ggb3ZlcnJpZGUgKHRlc3RzIGNvdW50L2luc3BlY3QgaGFzaGluZykuIERlZmF1bHQ6IHNoYTI1NkhleC4gKi9cbiAgaGFzaD86IEhhc2hGbjtcbiAgLyoqXG4gICAqIEJ1bGstc2NhbiBwcm9ncmVzczogY2FsbGVkIG9uY2Ugd2l0aCAoMCwgdG90YWwpIGJlZm9yZSB0aGUgd2FsayBhbmQgb25jZVxuICAgKiBwZXIgZmlsZSBhZnRlcndhcmRzIChgZG9uZWAgY291bnRzIGhhc2hlZCBBTkQgZmFzdC1wYXRoLXNraXBwZWQgZmlsZXMpLlxuICAgKiBQdXJlIHJlcG9ydGluZyBcdTIwMTQgbmV2ZXIgYWZmZWN0cyB0aGUgc2NhbidzIGRlY2lzaW9ucy5cbiAgICovXG4gIG9uUHJvZ3Jlc3M/OiAoZG9uZTogbnVtYmVyLCB0b3RhbDogbnVtYmVyKSA9PiB2b2lkO1xuICAvKipcbiAgICogVGhpcyBkZXZpY2UncyBpZCwgd2hlbiB0aGUgY2FsbGVyIGlzIGEgc3luY2luZyBjbGllbnQuIFNoYXJwZW5zIHRoZVxuICAgKiB0b21ic3RvbmVkLXBsYWNlaG9sZGVyIHJ1bGUgKGBzdGFsZURpcnNgKTogYW4gRU1QVFkgZGlyZWN0b3J5IG92ZXIgYVxuICAgKiB0b21ic3RvbmVkIHBsYWNlaG9sZGVyIGlzIHRoZSByZWNvcmQtb25seSByZXNpZHVlIG9mIGEgUkVNT1RFIGRlbGV0aW9uXG4gICAqIChuZXZlciByZXN1cnJlY3RlZCksIGJ1dCBvdmVyIGEgdG9tYnN0b25lIFRISVMgZGV2aWNlIGF1dGhvcmVkIGl0IG1lYW5zXG4gICAqIHRoZSB1c2VyIHJlLWNyZWF0ZWQgdGhlIGZvbGRlciBoZXJlIFx1MjAxNCByZXN0b3JlIGl0IChwdXNoIHRoZSBwbGFjZWhvbGRlcikuXG4gICAqIE9taXR0ZWQgKG9yIG5vbi1mb2xkZXIgc2NhbnMpOiBvbmx5IHRoZSBjb250ZW50IHRlc3QgZGVjaWRlcy5cbiAgICovXG4gIHRoaXNEZXZpY2VJZD86IHN0cmluZztcbn1cblxuLyoqIEEgbG9jYWwgY29udGVudCBjaGFuZ2UgZm9yIGEgcGF0aCB0aGF0IGV4aXN0cyBpbiBzdG9yYWdlLiAqL1xuZXhwb3J0IGludGVyZmFjZSBTY2FuQ2FuZGlkYXRlIHtcbiAgcGF0aDogc3RyaW5nO1xuICBoYXNoOiBzdHJpbmc7XG4gIHNpemU6IG51bWJlcjtcbn1cblxuLyoqIEEgbG9jYWwgZGVsZXRpb246IGNhcnJpZXMgdGhlIGluZGV4J3MgdmVyc2lvbiBzbyB0aGUgdG9tYnN0b25lIGNvbW1pdCBuYW1lcyBpdHMgcGFyZW50LiAqL1xuZXhwb3J0IGludGVyZmFjZSBEZWxldGVkQ2FuZGlkYXRlIHtcbiAgcGF0aDogc3RyaW5nO1xuICAvKiogSGFzaCBvZiB0aGUgY29udGVudCBhcyBsYXN0IHN5bmNlZCAodG9tYnN0b25lcyByZXVzZSBpdCkuICovXG4gIGhhc2g6IHN0cmluZztcbiAgc2l6ZTogbnVtYmVyO1xuICAvKiogVmVyc2lvbiBpZCB0aGUgZGVsZXRpb24gY29tbWl0IGJ1aWxkcyBvbi4gKi9cbiAgdmVyc2lvbklkOiBzdHJpbmc7XG59XG5cbi8qKiBBIGRldGVjdGVkIHJlbmFtZTogc2FtZSBjb250ZW50IGhhc2ggbW92ZWQgZnJvbSBgZnJvbWAgdG8gYHRvYC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUmVuYW1lQ2FuZGlkYXRlIHtcbiAgZnJvbTogc3RyaW5nO1xuICB0bzogc3RyaW5nO1xuICBoYXNoOiBzdHJpbmc7XG4gIHNpemU6IG51bWJlcjtcbn1cblxuLyoqXG4gKiBBIGxpdmUgZm9sZGVyIHBsYWNlaG9sZGVyIHdob3NlIGRpcmVjdG9yeSB2YW5pc2hlZCBmcm9tIHN0b3JhZ2U6IHRoZVxuICogZGVsZXRpb24gbXVzdCBwcm9wYWdhdGUgYXMgYSBmb2xkZXIgdG9tYnN0b25lIChraW5kIGAnZGVsZXRlJ2AsXG4gKiBgaXNGb2xkZXI6IHRydWVgKS4gQ2FycmllcyB0aGUgcGxhY2Vob2xkZXIncyB2ZXJzaW9uIGlkIHNvIHRoZSB0b21ic3RvbmVcbiAqIGNvbW1pdCBuYW1lcyBpdHMgcGFyZW50OyBoYXNoL3NpemUgYXJlIHRoZSBwbGFjZWhvbGRlciBjb25zdGFudHNcbiAqIChgJydgL2AwYCkgYW5kIGFyZSByZS1kZXJpdmVkIGRvd25zdHJlYW0gcmF0aGVyIHRoYW4gY2FycmllZC5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBGb2xkZXJEZWxldGlvbkNhbmRpZGF0ZSB7XG4gIHBhdGg6IHN0cmluZztcbiAgLyoqIFZlcnNpb24gaWQgb2YgdGhlIHBsYWNlaG9sZGVyIGhlYWQgdGhlIHRvbWJzdG9uZSBjb21taXQgYnVpbGRzIG9uLiAqL1xuICB2ZXJzaW9uSWQ6IHN0cmluZztcbn1cblxuLyoqXG4gKiBBIGZpbGUgdGhpcyBzY2FuIGFjdHVhbGx5IHJlYWQgYW5kIGhhc2hlZCwgd2l0aCB0aGUgc3RhdCBvYnNlcnZlZCBhdCBoYXNoXG4gKiB0aW1lLiBGZWVkcyBgcmVjb3JkSGFzaGVkRmlsZXNgIHNvIHRoZSBORVhUIGZhc3Qgc2NhbiBjYW4gc2tpcCB0aGVzZSBmaWxlc1xuICogKHRoZSBtdGltZSBjYWNoZSBvbiB0aGUgaW5kZXggZW50cnkpLiBGaWxlcyBza2lwcGVkIGJ5IHRoZSBwcmUtZmlsdGVyIGFyZSxcbiAqIGJ5IGRlZmluaXRpb24sIG5vdCBoYXNoZWQgYW5kIGRvIG5vdCBhcHBlYXIgaGVyZS5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBIYXNoZWRGaWxlIHtcbiAgcGF0aDogc3RyaW5nO1xuICBoYXNoOiBzdHJpbmc7XG4gIHNpemU6IG51bWJlcjtcbiAgLyoqIEVwb2NoIG1zIFx1MjAxNCB0aGUgc3RvcmFnZSBzdGF0IGF0IGhhc2ggdGltZSAoYEZpbGVTdGF0Lm10aW1lYCkuICovXG4gIG10aW1lOiBudW1iZXI7XG59XG5cbi8qKiBUaGUgZnVsbCByZXN1bHQgb2Ygb25lIGxvY2FsIHNjYW4uIEFsbCBidWNrZXRzIHNvcnRlZCBieSBwYXRoLiAqL1xuZXhwb3J0IGludGVyZmFjZSBMb2NhbENoYW5nZXMge1xuICAvKiogVGhlIGBub3dgIHBhc3NlZCBpbiBcdTIwMTQgd2hlbiB0aGlzIHNjYW4gY29uY2VwdHVhbGx5IGhhcHBlbmVkLiAqL1xuICBzY2FubmVkQXQ6IG51bWJlcjtcbiAgYWRkZWQ6IFNjYW5DYW5kaWRhdGVbXTtcbiAgbW9kaWZpZWQ6IFNjYW5DYW5kaWRhdGVbXTtcbiAgZGVsZXRlZDogRGVsZXRlZENhbmRpZGF0ZVtdO1xuICByZW5hbWVkOiBSZW5hbWVDYW5kaWRhdGVbXTtcbiAgLyoqIEVtcHR5LWZvbGRlciBwYXRocyB0byBwdXNoIGFzIHBsYWNlaG9sZGVyIGVudHJpZXMgKEZSLTEwKS4gKi9cbiAgZW1wdHlGb2xkZXJzOiBzdHJpbmdbXTtcbiAgLyoqXG4gICAqIExpdmUgZm9sZGVyIHBsYWNlaG9sZGVycyB3aG9zZSBkaXJlY3Rvcnkgbm8gbG9uZ2VyIGV4aXN0cyBpbiBzdG9yYWdlIFx1MjAxNFxuICAgKiBmb2xkZXIgZGVsZXRpb25zIHRvIHB1c2ggYXMgdG9tYnN0b25lcyAoa2luZCBgJ2RlbGV0ZSdgLCBgaXNGb2xkZXJgKS5cbiAgICovXG4gIGZvbGRlckRlbGV0aW9uczogRm9sZGVyRGVsZXRpb25DYW5kaWRhdGVbXTtcbiAgLyoqXG4gICAqIERpcmVjdG9yaWVzIHdob3NlIGluZGV4IGVudHJ5IGlzIGEgVE9NQlNUT05FRCBmb2xkZXIgcGxhY2Vob2xkZXIgd2hpbGUgYW5cbiAgICogRU1QVFkgZGlyZWN0b3J5IHN0aWxsIGV4aXN0cyBvbiBkaXNrIChyZWNvcmQtb25seSB0b21ic3RvbmUgYXBwbGljYXRpb24gXHUyMDE0XG4gICAqIHNlZSB0aGUgbW9kdWxlIGRvYykuIE9taXR0ZWQgKG5vdCBtZXJlbHkgZW1wdHkpIHdoZW4gdGhlcmUgYXJlIG5vbmUsIHNvXG4gICAqIHdob2xlLW9iamVjdCBjb21wYXJpc29ucyBvZiBgTG9jYWxDaGFuZ2VzYCBzdGF5IHN0YWJsZSBmb3IgY2xlYW4gc2NhbnMuXG4gICAqL1xuICBzdGFsZURpcnM/OiBzdHJpbmdbXTtcbiAgLyoqIEV2ZXJ5IGZpbGUgdGhlIHNjYW4gaGFzaGVkIChmYXN0IG1vZGUncyBza2lwcGVkIGZpbGVzIGFyZSBhYnNlbnQpLCBzb3J0ZWQgYnkgcGF0aC4gKi9cbiAgaGFzaGVkOiBIYXNoZWRGaWxlW107XG59XG5cbi8qKlxuICogU2NhbiB0aGUgdmF1bHQgYW5kIGRpZmYgaXQgYWdhaW5zdCB0aGUgaW5kZXguXG4gKlxuICogSW4gZmFzdCBtb2RlICh0aGUgZGVmYXVsdCkgYSBmaWxlIHdob3NlIHNpemUgYW5kIG10aW1lIGJvdGggZXhhY3RseSBtYXRjaFxuICogaXRzIGxpdmUgaW5kZXggZW50cnkgaXMgTk9UIHJlLWhhc2hlZCBcdTIwMTQgdGhlIHJlY29yZGVkIGhhc2ggY2FycmllcyBmb3J3YXJkXG4gKiBhcyB1bmNoYW5nZWQgKHNlZSB0aGUgbW9kdWxlIGRvYyBmb3IgdGhlIHRyYWRlb2ZmIGFuZCB0aGUgYGZ1bGxgIGVzY2FwZVxuICogaGF0Y2gpLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gc2NhblZhdWx0KFxuICBzdG9yYWdlOiBTdG9yYWdlQWRhcHRlcixcbiAgaW5kZXg6IExvY2FsSW5kZXgsXG4gIHNldHRpbmdzOiBJZ25vcmVTZXR0aW5ncyxcbiAgbm93OiBudW1iZXIsXG4gIG9wdGlvbnM6IFNjYW5WYXVsdE9wdGlvbnMgPSB7fSxcbik6IFByb21pc2U8TG9jYWxDaGFuZ2VzPiB7XG4gIGNvbnN0IGhhc2hGbiA9IG9wdGlvbnMuaGFzaCA/PyBzaGEyNTZIZXg7XG4gIGNvbnN0IG1vZGUgPSBvcHRpb25zLm1vZGUgPz8gJ2Zhc3QnO1xuICBjb25zdCBvblByb2dyZXNzID0gb3B0aW9ucy5vblByb2dyZXNzO1xuICBjb25zdCB0aGlzRGV2aWNlSWQgPSBvcHRpb25zLnRoaXNEZXZpY2VJZDtcblxuICBjb25zdCBmaWxlcyA9IGF3YWl0IHN0b3JhZ2UubGlzdEZpbGVzKCk7XG5cbiAgY29uc3Qga2VwdDogRmlsZVN0YXRbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGZpbGUgb2YgZmlsZXMpIHtcbiAgICBpZiAoIWlzSWdub3JlZChmaWxlLnBhdGgsIHNldHRpbmdzKSkga2VwdC5wdXNoKGZpbGUpO1xuICB9XG4gIGNvbnN0IGtlcHRQYXRocyA9IG5ldyBTZXQoa2VwdC5tYXAoKGYpID0+IGYucGF0aCkpO1xuXG4gIGNvbnN0IGFkZGVkOiBTY2FuQ2FuZGlkYXRlW10gPSBbXTtcbiAgY29uc3QgbW9kaWZpZWQ6IFNjYW5DYW5kaWRhdGVbXSA9IFtdO1xuICBjb25zdCBoYXNoZWQ6IEhhc2hlZEZpbGVbXSA9IFtdO1xuXG4gIG9uUHJvZ3Jlc3M/LigwLCBrZXB0Lmxlbmd0aCk7XG4gIGxldCBzY2FubmVkID0gMDtcbiAgZm9yIChjb25zdCBmaWxlIG9mIGtlcHQpIHtcbiAgICBjb25zdCBlbnRyeSA9IGluZGV4W2ZpbGUucGF0aF07XG4gICAgaWYgKG1vZGUgPT09ICdmYXN0JyAmJiBzdGF0TWF0Y2hlc0VudHJ5KGVudHJ5LCBmaWxlKSkge1xuICAgICAgc2Nhbm5lZCArPSAxO1xuICAgICAgb25Qcm9ncmVzcz8uKHNjYW5uZWQsIGtlcHQubGVuZ3RoKTtcbiAgICAgIGNvbnRpbnVlOyAvLyBzaXplK210aW1lIHVuY2hhbmdlZCBzaW5jZSB0aGUgcmVjb3JkZWQgaGFzaCBcdTIwMTQgdHJ1c3QgaXRcbiAgICB9XG4gICAgY29uc3QgaGFzaCA9IGF3YWl0IGhhc2hGbihhd2FpdCBzdG9yYWdlLnJlYWRGaWxlKGZpbGUucGF0aCkpO1xuICAgIGhhc2hlZC5wdXNoKHsgcGF0aDogZmlsZS5wYXRoLCBoYXNoLCBzaXplOiBmaWxlLnNpemUsIG10aW1lOiBmaWxlLm10aW1lIH0pO1xuICAgIHNjYW5uZWQgKz0gMTtcbiAgICBvblByb2dyZXNzPy4oc2Nhbm5lZCwga2VwdC5sZW5ndGgpO1xuICAgIGlmIChlbnRyeSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBhZGRlZC5wdXNoKHsgcGF0aDogZmlsZS5wYXRoLCBoYXNoLCBzaXplOiBmaWxlLnNpemUgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGVudHJ5LmlzRm9sZGVyKSB7XG4gICAgICAvLyBBIHJlYWwgZmlsZSByZXBsYWNlZCBhIGZvbGRlciBwbGFjZWhvbGRlcjogdHJlYXQgYXMgY29udGVudCBjaGFuZ2UuXG4gICAgICBtb2RpZmllZC5wdXNoKHsgcGF0aDogZmlsZS5wYXRoLCBoYXNoLCBzaXplOiBmaWxlLnNpemUgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgLy8gVG9tYnN0b25lZCBlbnRyeSB3aXRoIHRoZSBmaWxlIGJhY2sgXHUyMUQyIG1vZGlmaWVkIChyZXN1cnJlY3Qgb3JcbiAgICAvLyBlZGl0LW9mLWRlbGV0ZWQgXHUyMDE0IGJvdGggcmVzb2x2ZSB0aGUgc2FtZSB3YXkgZG93bnN0cmVhbSkuXG4gICAgaWYgKGVudHJ5LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkIHx8IGVudHJ5Lmhhc2ggIT09IGhhc2gpIHtcbiAgICAgIG1vZGlmaWVkLnB1c2goeyBwYXRoOiBmaWxlLnBhdGgsIGhhc2gsIHNpemU6IGZpbGUuc2l6ZSB9KTtcbiAgICB9XG4gIH1cblxuICBjb25zdCBkZWxldGVkOiBEZWxldGVkQ2FuZGlkYXRlW10gPSBbXTtcbiAgZm9yIChjb25zdCBbcGF0aCwgZW50cnldIG9mIE9iamVjdC5lbnRyaWVzKGluZGV4KSkge1xuICAgIGlmIChlbnRyeS5pc0ZvbGRlcikgY29udGludWU7IC8vIGZvbGRlciBwbGFjZWhvbGRlcnMgbmV2ZXIgcHJvZHVjZSBmaWxlIGRlbGV0aW9uc1xuICAgIGlmIChlbnRyeS5kZWxldGVkQXQgIT09IHVuZGVmaW5lZCkgY29udGludWU7IC8vIGFscmVhZHkgdG9tYnN0b25lZFxuICAgIGlmIChrZXB0UGF0aHMuaGFzKHBhdGgpKSBjb250aW51ZTtcbiAgICBpZiAoaXNJZ25vcmVkKHBhdGgsIHNldHRpbmdzKSkge1xuICAgICAgLy8gVGhlIHBhdGggYmVjYW1lIGlnbm9yZWQgKHNldHRpbmdzIGNoYW5nZSkgXHUyMDE0IG5vdCBhIGRlbGV0aW9uLlxuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGRlbGV0ZWQucHVzaCh7IHBhdGgsIGhhc2g6IGVudHJ5Lmhhc2gsIHNpemU6IGVudHJ5LnNpemUsIHZlcnNpb25JZDogZW50cnkudmVyc2lvbklkIH0pO1xuICB9XG5cbiAgY29uc3QgeyByZW5hbWVkLCBkZWxldGVkOiB1bm1hdGNoZWREZWxldGVkLCBhZGRlZDogdW5tYXRjaGVkQWRkZWQgfSA9IGRldGVjdFJlbmFtZXMoZGVsZXRlZCwgYWRkZWQpO1xuICBjb25zdCBkaXJzID0gYXdhaXQgc3RvcmFnZS5saXN0RGlycygpO1xuICBjb25zdCB7IGVtcHR5Rm9sZGVycywgc3RhbGVEaXJzIH0gPSBkZXRlY3RFbXB0eUZvbGRlcnMoaW5kZXgsIHNldHRpbmdzLCBmaWxlcywgZGlycywgdGhpc0RldmljZUlkKTtcbiAgY29uc3QgZm9sZGVyRGVsZXRpb25zID0gZGV0ZWN0Rm9sZGVyRGVsZXRpb25zKGluZGV4LCBzZXR0aW5ncywgZGlycyk7XG5cbiAgcmV0dXJuIHtcbiAgICBzY2FubmVkQXQ6IG5vdyxcbiAgICBhZGRlZDogc29ydENhbmRpZGF0ZXModW5tYXRjaGVkQWRkZWQpLFxuICAgIG1vZGlmaWVkOiBzb3J0Q2FuZGlkYXRlcyhtb2RpZmllZCksXG4gICAgZGVsZXRlZDogWy4uLnVubWF0Y2hlZERlbGV0ZWRdLnNvcnQoYnlQYXRoKSxcbiAgICByZW5hbWVkOiBbLi4ucmVuYW1lZF0uc29ydCgoYSwgYikgPT4gYnlQYXRoKGEsIGIpKSxcbiAgICBlbXB0eUZvbGRlcnMsXG4gICAgZm9sZGVyRGVsZXRpb25zLFxuICAgIC8vIE9taXR0ZWQgd2hlbiBlbXB0eSAobm90IGBbXWApIFx1MjAxNCBzZWUgdGhlIGZpZWxkJ3MgZG9jLlxuICAgIC4uLihzdGFsZURpcnMubGVuZ3RoID4gMCA/IHsgc3RhbGVEaXJzIH0gOiB7fSksXG4gICAgaGFzaGVkOiBbLi4uaGFzaGVkXS5zb3J0KGJ5UGF0aCksXG4gIH07XG59XG5cbi8qKlxuICogV2hldGhlciB0aGUgZmlsZSdzIHN0YXQgZXhhY3RseSBtYXRjaGVzIGl0cyBsaXZlIGluZGV4IGVudHJ5IFx1MjAxNCB0aGUgZmFzdFxuICogbW9kZSBwcmUtZmlsdGVyLiBSZXF1aXJlcyBhIGtub3duIHJlY29yZGVkIGBtdGltZWAgKGxlZ2FjeSBlbnRyaWVzIGFuZFxuICogcHVsbC13cml0dGVuIGVudHJpZXMgaGF2ZSBub25lIFx1MjFEMiBoYXNoZWQsIHRoZW4gcmVjb3JkZWQpIGFuZCBuZXZlciBmaXJlc1xuICogZm9yIHRvbWJzdG9uZXMgKGEgcmVzdXJyZWN0IG11c3QgYWx3YXlzIHN1cmZhY2UpIG9yIGZvbGRlciBwbGFjZWhvbGRlcnMuXG4gKi9cbmZ1bmN0aW9uIHN0YXRNYXRjaGVzRW50cnkoZW50cnk6IExvY2FsSW5kZXhFbnRyeSB8IHVuZGVmaW5lZCwgZmlsZTogRmlsZVN0YXQpOiBib29sZWFuIHtcbiAgcmV0dXJuIChcbiAgICBlbnRyeSAhPT0gdW5kZWZpbmVkICYmXG4gICAgZW50cnkuZGVsZXRlZEF0ID09PSB1bmRlZmluZWQgJiZcbiAgICBlbnRyeS5pc0ZvbGRlciAhPT0gdHJ1ZSAmJlxuICAgIGVudHJ5Lm10aW1lICE9PSB1bmRlZmluZWQgJiZcbiAgICBlbnRyeS5tdGltZSA9PT0gZmlsZS5tdGltZSAmJlxuICAgIGVudHJ5LnNpemUgPT09IGZpbGUuc2l6ZVxuICApO1xufVxuXG4vKipcbiAqIFJlY29yZCBhIHNjYW4ncyBoYXNoIG9ic2VydmF0aW9ucyBpbnRvIHRoZSBpbmRleDogZm9yIGV2ZXJ5IGxpdmUgZmlsZVxuICogZW50cnkgd2hvc2UgY29udGVudCBoYXNoIG1hdGNoZXMgd2hhdCB0aGUgc2NhbiBoYXNoZWQsIGNhY2hlIHRoZSBvYnNlcnZlZFxuICogbXRpbWUgc28gdGhlIG5leHQgZmFzdCBzY2FuIGNhbiBza2lwIHJlLWhhc2hpbmcgaXQuXG4gKlxuICogUHVyZTogcmV0dXJucyBhIG5ldyBpbmRleCAob3IgdGhlIGlucHV0IHdoZW4gbm90aGluZyBjaGFuZ2VzKSwgbmV2ZXJcbiAqIG11dGF0ZXMuIFRoZSBoYXNoLW1hdGNoIGd1YXJkIGtlZXBzIHRoZSBjYWNoZSBob25lc3QgXHUyMDE0IGFuIGVudHJ5IHdob3NlXG4gKiBoYXNoIG5vIGxvbmdlciByZWZsZWN0cyB0aGUgb2JzZXJ2YXRpb24gKGUuZy4gYSBwdWxsIG92ZXJ3cm90ZSB0aGUgcGF0aFxuICogbWlkLWN5Y2xlKSBpcyBsZWZ0IHVudG91Y2hlZCBhbmQgc2ltcGx5IGdldHMgcmUtaGFzaGVkIG5leHQgc2Nhbi5cbiAqIEVudHJpZXMgbmV2ZXIgZGVtb3RlOiBgZGVsZXRlZEF0YC9gaXNGb2xkZXJgIGVudHJpZXMgYXJlIG5ldmVyIHBhdGNoZWQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZWNvcmRIYXNoZWRGaWxlcyhcbiAgaW5kZXg6IExvY2FsSW5kZXgsXG4gIGhhc2hlZDogcmVhZG9ubHkgSGFzaGVkRmlsZVtdLFxuKTogTG9jYWxJbmRleCB7XG4gIGxldCBuZXh0OiBSZWNvcmQ8c3RyaW5nLCBMb2NhbEluZGV4RW50cnk+IHwgdW5kZWZpbmVkO1xuICBmb3IgKGNvbnN0IG9ic2VydmVkIG9mIGhhc2hlZCkge1xuICAgIGNvbnN0IGVudHJ5ID0gaW5kZXhbb2JzZXJ2ZWQucGF0aF07XG4gICAgaWYgKGVudHJ5ID09PSB1bmRlZmluZWQgfHwgZW50cnkuaXNGb2xkZXIgfHwgZW50cnkuZGVsZXRlZEF0ICE9PSB1bmRlZmluZWQpIGNvbnRpbnVlO1xuICAgIGlmIChlbnRyeS5oYXNoICE9PSBvYnNlcnZlZC5oYXNoKSBjb250aW51ZTtcbiAgICBpZiAoZW50cnkubXRpbWUgPT09IG9ic2VydmVkLm10aW1lKSBjb250aW51ZTtcbiAgICBuZXh0ID8/PSB7IC4uLmluZGV4IH07XG4gICAgbmV4dFtvYnNlcnZlZC5wYXRoXSA9IHsgLi4uZW50cnksIG10aW1lOiBvYnNlcnZlZC5tdGltZSB9O1xuICB9XG4gIHJldHVybiBuZXh0ID8/IGluZGV4O1xufVxuXG4vKipcbiAqIENvcnJlbGF0ZSBkZWxldGUgKyBhZGQgcGFpcnMgYnkgY29udGVudCBoYXNoIChBUkNISVRFQ1RVUkUgXHUwMEE3NCkuXG4gKlxuICogT25lLXRvLW9uZSBtYXRjaGluZywgbW9zdCBkZXRlcm1pbmlzdGljIHdpbnM6IHdoZW4gc2V2ZXJhbCB1bm1hdGNoZWQgYWRkc1xuICogc2hhcmUgdGhlIGRlbGV0ZWQgc2lkZSdzIGhhc2gsIHByZWZlciBhbiBhZGQgaW4gdGhlIHNhbWUgcGFyZW50IGRpcmVjdG9yeTtcbiAqIHdpdGhpbiBhIHByZWZlcmVuY2UgY2xhc3MsIHRoZSBsZXhpY29ncmFwaGljYWxseSBzbWFsbGVzdCBgdG9gIHBhdGggd2lucy5cbiAqIE1hdGNoZWQgcGFpcnMgbGVhdmUgdGhlIGRlbGV0ZS9hZGQgYnVja2V0cyBhbmQgYmVjb21lIGByZW5hbWVkYC5cbiAqL1xuZnVuY3Rpb24gZGV0ZWN0UmVuYW1lcyhcbiAgZGVsZXRlZDogcmVhZG9ubHkgRGVsZXRlZENhbmRpZGF0ZVtdLFxuICBhZGRlZDogcmVhZG9ubHkgU2NhbkNhbmRpZGF0ZVtdLFxuKToge1xuICByZW5hbWVkOiBSZW5hbWVDYW5kaWRhdGVbXTtcbiAgZGVsZXRlZDogRGVsZXRlZENhbmRpZGF0ZVtdO1xuICBhZGRlZDogU2NhbkNhbmRpZGF0ZVtdO1xufSB7XG4gIGNvbnN0IGFkZHNCeUhhc2ggPSBuZXcgTWFwPHN0cmluZywgU2NhbkNhbmRpZGF0ZVtdPigpO1xuICBmb3IgKGNvbnN0IGNhbmRpZGF0ZSBvZiBbLi4uYWRkZWRdLnNvcnQoYnlQYXRoKSkge1xuICAgIGNvbnN0IGJ1Y2tldCA9IGFkZHNCeUhhc2guZ2V0KGNhbmRpZGF0ZS5oYXNoKTtcbiAgICBpZiAoYnVja2V0KSBidWNrZXQucHVzaChjYW5kaWRhdGUpO1xuICAgIGVsc2UgYWRkc0J5SGFzaC5zZXQoY2FuZGlkYXRlLmhhc2gsIFtjYW5kaWRhdGVdKTtcbiAgfVxuXG4gIGNvbnN0IHVzZWRBZGRzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGNvbnN0IHJlbmFtZWQ6IFJlbmFtZUNhbmRpZGF0ZVtdID0gW107XG4gIGNvbnN0IHVubWF0Y2hlZERlbGV0ZWQ6IERlbGV0ZWRDYW5kaWRhdGVbXSA9IFtdO1xuXG4gIGZvciAoY29uc3QgZGVsZXRpb24gb2YgWy4uLmRlbGV0ZWRdLnNvcnQoYnlQYXRoKSkge1xuICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBhZGRzQnlIYXNoLmdldChkZWxldGlvbi5oYXNoKSA/PyBbXTtcbiAgICBsZXQgZmFsbGJhY2s6IFNjYW5DYW5kaWRhdGUgfCB1bmRlZmluZWQ7XG4gICAgbGV0IHNhbWVEaXI6IFNjYW5DYW5kaWRhdGUgfCB1bmRlZmluZWQ7XG4gICAgZm9yIChjb25zdCBjYW5kaWRhdGUgb2YgY2FuZGlkYXRlcykge1xuICAgICAgaWYgKHVzZWRBZGRzLmhhcyhjYW5kaWRhdGUucGF0aCkpIGNvbnRpbnVlO1xuICAgICAgaWYgKHBhcmVudFBhdGgoY2FuZGlkYXRlLnBhdGgpID09PSBwYXJlbnRQYXRoKGRlbGV0aW9uLnBhdGgpKSB7XG4gICAgICAgIHNhbWVEaXIgPz89IGNhbmRpZGF0ZTsgLy8gc29ydGVkIFx1MjFEMiBmaXJzdCBpcyBzbWFsbGVzdFxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZmFsbGJhY2sgPz89IGNhbmRpZGF0ZTtcbiAgICAgIH1cbiAgICB9XG4gICAgY29uc3QgbWF0Y2ggPSBzYW1lRGlyID8/IGZhbGxiYWNrO1xuICAgIGlmIChtYXRjaCkge1xuICAgICAgdXNlZEFkZHMuYWRkKG1hdGNoLnBhdGgpO1xuICAgICAgcmVuYW1lZC5wdXNoKHsgZnJvbTogZGVsZXRpb24ucGF0aCwgdG86IG1hdGNoLnBhdGgsIGhhc2g6IGRlbGV0aW9uLmhhc2gsIHNpemU6IGRlbGV0aW9uLnNpemUgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHVubWF0Y2hlZERlbGV0ZWQucHVzaChkZWxldGlvbik7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHtcbiAgICByZW5hbWVkLFxuICAgIGRlbGV0ZWQ6IHVubWF0Y2hlZERlbGV0ZWQsXG4gICAgYWRkZWQ6IGFkZGVkLmZpbHRlcigoY2FuZGlkYXRlKSA9PiAhdXNlZEFkZHMuaGFzKGNhbmRpZGF0ZS5wYXRoKSksXG4gIH07XG59XG5cbi8qKlxuICogRGlyZWN0b3JpZXMgdGhhdCBleGlzdCBpbiBzdG9yYWdlIGJ1dCBhcmUgcmVwcmVzZW50ZWQgbmVpdGhlciBieSBhIGxpdmVcbiAqIGZvbGRlciBwbGFjZWhvbGRlciBpbiB0aGUgaW5kZXggbm9yIGJ5IGFueSBmaWxlIChpZ25vcmVkIG9yIG5vdCkgYmVuZWF0aFxuICogdGhlbSBcdTIwMTQgcGx1cyB0aGUgdG9tYnN0b25lZC1wbGFjZWhvbGRlciBzcGVjaWFsIGNhc2VzIHRoYXQgbWFrZSB0aGVcbiAqIGVtcHR5LWZvbGRlciBsaWZlY3ljbGUgZGVsZXRpb24tc2FmZTpcbiAqXG4gKiAgIC0gVE9NQlNUT05FRCBwbGFjZWhvbGRlciArIGNvbnRlbnQgYmVuZWF0aCBcdTIxOTIgYGVtcHR5Rm9sZGVyc2A6IHRoZSB1c2VyXG4gKiAgICAgcmVjcmVhdGVkIHRoZSBmb2xkZXI7IHJlc3RvcmluZyB0aGUgcGxhY2Vob2xkZXIgKFwibG9jYWwgd2luc1wiKSBpc1xuICogICAgIGNvcnJlY3QuIFRoZSByZWNyZWF0ZWQgRklMRVMgYmVuZWF0aCBzdXJmYWNlIHRocm91Z2ggYGFkZGVkYC9gbW9kaWZpZWRgXG4gKiAgICAgaW5kZXBlbmRlbnRseS5cbiAqICAgLSBUT01CU1RPTkVEIHBsYWNlaG9sZGVyICsgRU1QVFkgZGlyIG9uIGRpc2s6XG4gKiAgICAgICBcdTAwQjcgdG9tYnN0b25lIGF1dGhvcmVkIGJ5IEFOT1RIRVIgZGV2aWNlIChvciBhdXRob3IgdW5rbm93bikgXHUyMTkyXG4gKiAgICAgICAgIGBzdGFsZURpcnNgOiB0aGUgcmVjb3JkLW9ubHkgcmVzaWR1ZSBvZiBhIHJlbW90ZSBkZWxldGlvbixcbiAqICAgICAgICAgY29uc2lzdGVudCB3aXRoIHRoZSB0b21ic3RvbmUgXHUyMDE0IG5ldmVyIHJlc3VycmVjdGVkIChyZS1wdXNoaW5nIGl0IGFzXG4gKiAgICAgICAgIGFuIGVtcHR5IGZvbGRlciBpcyB3aGF0IG1hZGUgYSBwZWVyLXNpZGUgZGVsZXRpb24gcGluZy1wb25nXG4gKiAgICAgICAgIGZvcmV2ZXIpLiBUaGUgY2xpZW50IHJldHJpZXMgYHJlbW92ZURpcmAgb24gdGhlc2UgZGlycy5cbiAqICAgICAgIFx1MDBCNyB0b21ic3RvbmUgYXV0aG9yZWQgYnkgVEhJUyBkZXZpY2UgKGB0aGlzRGV2aWNlSWRgKSBcdTIxOTJcbiAqICAgICAgICAgYGVtcHR5Rm9sZGVyc2A6IG15IG93biBkZWxldGlvbiwgeWV0IGEgZGlyIGV4aXN0cyBoZXJlIG5vdyBcdTIwMTQgdGhlXG4gKiAgICAgICAgIHVzZXIgcmUtY3JlYXRlZCBpdCBsb2NhbGx5OyByZXN0b3JlIHRoZSBwbGFjZWhvbGRlci5cbiAqXG4gKiBBIGRpcmVjdG9yeSBjb250YWluaW5nIG9ubHkgaWdub3JlZCBmaWxlcyBpcyAqbm90KiBlbXB0eSBcdTIwMTQgaXQgaXNcbiAqIHJlcHJlc2VudGVkIGJ5IHRob3NlIGZpbGVzIGFzIGZhciBhcyB0aGUgbG9jYWwgbWFjaGluZSBpcyBjb25jZXJuZWQuXG4gKi9cbmZ1bmN0aW9uIGRldGVjdEVtcHR5Rm9sZGVycyhcbiAgaW5kZXg6IExvY2FsSW5kZXgsXG4gIHNldHRpbmdzOiBJZ25vcmVTZXR0aW5ncyxcbiAgZmlsZXM6IHJlYWRvbmx5IEZpbGVTdGF0W10sXG4gIGRpcnM6IHJlYWRvbmx5IHN0cmluZ1tdLFxuICB0aGlzRGV2aWNlSWQ/OiBzdHJpbmcsXG4pOiB7IGVtcHR5Rm9sZGVyczogc3RyaW5nW107IHN0YWxlRGlyczogc3RyaW5nW10gfSB7XG4gIGNvbnN0IHJlcHJlc2VudGVkRGlycyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBmb3IgKGNvbnN0IGZpbGUgb2YgZmlsZXMpIHtcbiAgICBmb3IgKGxldCBkaXIgPSBwYXJlbnRQYXRoKGZpbGUucGF0aCk7IGRpciAhPT0gJy8nOyBkaXIgPSBwYXJlbnRQYXRoKGRpcikpIHtcbiAgICAgIHJlcHJlc2VudGVkRGlycy5hZGQoZGlyKTtcbiAgICB9XG4gIH1cblxuICBjb25zdCBlbXB0eUZvbGRlcnM6IHN0cmluZ1tdID0gW107XG4gIGNvbnN0IHN0YWxlRGlyczogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChjb25zdCBkaXIgb2YgZGlycykge1xuICAgIGlmIChkaXIgPT09ICcvJykgY29udGludWU7XG4gICAgaWYgKGlzSWdub3JlZChkaXIsIHNldHRpbmdzKSkgY29udGludWU7XG4gICAgY29uc3QgZW50cnkgPSBpbmRleFtkaXJdO1xuICAgIGlmIChlbnRyeT8uaXNGb2xkZXIgJiYgZW50cnkuZGVsZXRlZEF0ID09PSB1bmRlZmluZWQpIGNvbnRpbnVlOyAvLyBsaXZlIHBsYWNlaG9sZGVyIFx1MjAxNCBhbHJlYWR5IHN5bmNlZFxuICAgIGlmIChlbnRyeT8uaXNGb2xkZXIgJiYgZW50cnkuZGVsZXRlZEF0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIC8vIFRvbWJzdG9uZWQgcGxhY2Vob2xkZXIgd2hvc2UgZGlyZWN0b3J5IHN0aWxsIGV4aXN0cy4gQ29udGVudCBiZW5lYXRoXG4gICAgICAvLyBcdTIxRDIgZ2VudWluZSByZWNyZWF0aW9uLiBFbXB0eSBcdTIxRDIgc3RhbGUgbGVmdG92ZXIgb2YgYSByZWNvcmQtb25seVxuICAgICAgLy8gdG9tYnN0b25lIGFwcGxpY2F0aW9uIFx1MjAxNCBVTkxFU1MgdGhpcyBkZXZpY2UgYXV0aG9yZWQgdGhlIHRvbWJzdG9uZVxuICAgICAgLy8gaXRzZWxmLCBpbiB3aGljaCBjYXNlIGEgcHJlc2VudCBkaXIgY2FuIG9ubHkgYmUgbG9jYWwgcmVjcmVhdGlvbi5cbiAgICAgIGlmIChyZXByZXNlbnRlZERpcnMuaGFzKGRpcikgfHwgZW50cnkuY2xvY2suZGV2aWNlSWQgPT09IHRoaXNEZXZpY2VJZCkge1xuICAgICAgICBlbXB0eUZvbGRlcnMucHVzaChkaXIpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgc3RhbGVEaXJzLnB1c2goZGlyKTtcbiAgICAgIH1cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAocmVwcmVzZW50ZWREaXJzLmhhcyhkaXIpKSBjb250aW51ZTsgLy8gcmVwcmVzZW50ZWQgYnkgaXRzIGZpbGVzXG4gICAgZW1wdHlGb2xkZXJzLnB1c2goZGlyKTtcbiAgfVxuICByZXR1cm4ge1xuICAgIGVtcHR5Rm9sZGVyczogZW1wdHlGb2xkZXJzLnNvcnQoKSxcbiAgICBzdGFsZURpcnM6IHN0YWxlRGlycy5zb3J0KCksXG4gIH07XG59XG5cbi8qKlxuICogTGl2ZSBmb2xkZXIgcGxhY2Vob2xkZXIgZW50cmllcyB3aG9zZSBkaXJlY3Rvcnkgbm8gbG9uZ2VyIGV4aXN0cyBpblxuICogc3RvcmFnZSBcdTIwMTQgdGhlIGZvbGRlciB3YXMgZGVsZXRlZCBsb2NhbGx5IChkaXJlY3RseSwgb3IgYnkgcHJ1bmUtb24tZGVsZXRlXG4gKiBlbXB0eWluZyBpdCkuIEVtaXRzIG9uZSBgRm9sZGVyRGVsZXRpb25DYW5kaWRhdGVgIHBlciBwbGFjZWhvbGRlciBzbyB0aGVcbiAqIHJlc29sdmUvY29tbWl0IHBhdGggcHVzaGVzIGEgZm9sZGVyIHRvbWJzdG9uZTsgYWxyZWFkeS10b21ic3RvbmVkXG4gKiBwbGFjZWhvbGRlcnMgYW5kIHBsYWNlaG9sZGVycyB0aGF0IG1lcmVseSBiZWNhbWUgaWdub3JlZCBhcmUgc2tpcHBlZC5cbiAqL1xuZnVuY3Rpb24gZGV0ZWN0Rm9sZGVyRGVsZXRpb25zKFxuICBpbmRleDogTG9jYWxJbmRleCxcbiAgc2V0dGluZ3M6IElnbm9yZVNldHRpbmdzLFxuICBkaXJzOiByZWFkb25seSBzdHJpbmdbXSxcbik6IEZvbGRlckRlbGV0aW9uQ2FuZGlkYXRlW10ge1xuICBjb25zdCBwcmVzZW50ID0gbmV3IFNldChkaXJzKTtcbiAgY29uc3QgZm9sZGVyRGVsZXRpb25zOiBGb2xkZXJEZWxldGlvbkNhbmRpZGF0ZVtdID0gW107XG4gIGZvciAoY29uc3QgW3BhdGgsIGVudHJ5XSBvZiBPYmplY3QuZW50cmllcyhpbmRleCkpIHtcbiAgICBpZiAoIWVudHJ5LmlzRm9sZGVyKSBjb250aW51ZTsgLy8gZmlsZXMgYXJlIGhhbmRsZWQgYnkgdGhlIGBkZWxldGVkYCBidWNrZXRcbiAgICBpZiAoZW50cnkuZGVsZXRlZEF0ICE9PSB1bmRlZmluZWQpIGNvbnRpbnVlOyAvLyBhbHJlYWR5IHRvbWJzdG9uZWRcbiAgICBpZiAocHJlc2VudC5oYXMocGF0aCkpIGNvbnRpbnVlOyAvLyBkaXJlY3Rvcnkgc3RpbGwgZXhpc3RzIFx1MjAxNCBubyBkZWxldGlvblxuICAgIGlmIChpc0lnbm9yZWQocGF0aCwgc2V0dGluZ3MpKSBjb250aW51ZTsgLy8gc2V0dGluZ3MgY2hhbmdlLCBub3QgYSBkZWxldGlvblxuICAgIGZvbGRlckRlbGV0aW9ucy5wdXNoKHsgcGF0aCwgdmVyc2lvbklkOiBlbnRyeS52ZXJzaW9uSWQgfSk7XG4gIH1cbiAgcmV0dXJuIGZvbGRlckRlbGV0aW9ucy5zb3J0KGJ5UGF0aCk7XG59XG5cbmZ1bmN0aW9uIHNvcnRDYW5kaWRhdGVzKGNhbmRpZGF0ZXM6IFNjYW5DYW5kaWRhdGVbXSk6IFNjYW5DYW5kaWRhdGVbXSB7XG4gIHJldHVybiBbLi4uY2FuZGlkYXRlc10uc29ydChieVBhdGgpO1xufVxuXG5mdW5jdGlvbiBieVBhdGg8VCBleHRlbmRzIHsgcGF0aD86IHN0cmluZzsgZnJvbT86IHN0cmluZyB9PihhOiBULCBiOiBUKTogbnVtYmVyIHtcbiAgY29uc3Qga2V5QSA9IGEucGF0aCA/PyBhLmZyb20gPz8gJyc7XG4gIGNvbnN0IGtleUIgPSBiLnBhdGggPz8gYi5mcm9tID8/ICcnO1xuICByZXR1cm4ga2V5QSA8IGtleUIgPyAtMSA6IGtleUEgPiBrZXlCID8gMSA6IDA7XG59XG4iLCAiLyoqXG4gKiBgU3luY0NsaWVudGAgXHUyMDE0IHRoZSBuZXR3b3JrLWZhY2luZyBvcmNoZXN0cmF0b3IgKEFSQ0hJVEVDVFVSRS5tZCBcdTAwQTc4KS5cbiAqXG4gKiBDb21wb3NlcyB0aGUgcGhhc2UtMWEvMWIgcGllY2VzIGludG8gb25lIGxvb3AgcGVyIGRldmljZTpcbiAqXG4gKiAgIHN0YXJ0dXA6ICBsb2FkTG9jYWxTdGF0ZSAoZW50cmllcyArIHBlcnNpc3RlZCBjdXJzb3IpIFx1MjE5MiBoZWxsby9oZWxsb0Fja1xuICogICAgICAgICAgICAgKHNlcnZlciByZXBvcnRzIGBvbGRlc3RSZXRhaW5lZFNlcWApIFx1MjE5MiBnZXRNYW5pZmVzdCBcdTIwMTQgYSBERUxUQVxuICogICAgICAgICAgICAgbWFuaWZlc3QgKGBzaW5jZTogc3luY2VkVGhyb3VnaGApIG1lcmdlZCBvdmVyIHRoZSBpbmRleFxuICogICAgICAgICAgICAgcHJvamVjdGlvbiB3aGVuIHRoZSByZXBsYXkgd2luZG93IGlzIGludGFjdCwgZWxzZSBmdWxsIFx1MjE5MlxuICogICAgICAgICAgICAgc2NhblZhdWx0IFx1MjE5MiBjb21wdXRlU3luY1BsYW4gXHUyMTkyIGV4ZWN1dGUgKHB1c2hlcyB0aHJvdWdoIGFcbiAqICAgICAgICAgICAgIGJvdW5kZWQtY29uY3VycmVuY3kgcGlwZWxpbmUsIHB1bGxzIHZpYSBhcHBseVB1bGwgd2l0aCB0aGVcbiAqICAgICAgICAgICAgIGluamVjdGVkIGJsb2Igc3RvcmUpO1xuICogICBsaXZlOiAgICAgYGNoYW5nZWAgbWVzc2FnZXMgbWF0ZXJpYWxpemUgaW1tZWRpYXRlbHkgd2hlbiB0aGUgdGFyZ2V0IGlzXG4gKiAgICAgICAgICAgICBjbGVhbiwgYW5kIGRlZmVyIHRvIGEgZnVsbCByZWNvbmNpbGUgY3ljbGUgd2hlbiBpdCBpcyBub3QgXHUyMDE0IGFcbiAqICAgICAgICAgICAgIHJlbW90ZSBjaGFuZ2UgaXMgTkVWRVIgd3JpdHRlbiBvdmVyIGxvY2FsbHktbW9kaWZpZWQgY29udGVudFxuICogICAgICAgICAgICAgd2l0aG91dCBnb2luZyB0aHJvdWdoIGBjb21wdXRlU3luY1BsYW5gJ3MgY29uZmxpY3QgbG9naWM7XG4gKiAgIHdhdGNoZXI6ICBgV2F0Y2hBZGFwdGVyYCBiYXRjaGVzIGFyZSBkZWJvdW5jZWQgKH4zMDAgbXMsIGluamVjdGFibGVcbiAqICAgICAgICAgICAgIHNjaGVkdWxlciBcdTIwMTQgbm8gYW1iaWVudCB0aW1lcnMgaW4gdGVzdHMpIGludG8gc2Nhblx1MjE5MnBsYW5cdTIxOTJleGVjdXRlO1xuICogICByZWNvbm5lY3Q6IGBvbkNsb3NlYCBmbGlwcyB0byBgJ2Rpc2Nvbm5lY3RlZCdgOyBgcmVjb25uZWN0KClgIHJlLXJ1bnMgdGhlXG4gKiAgICAgICAgICAgICB3aG9sZSBzdGFydHVwIHJlY29uY2lsaWF0aW9uIChiYWNrb2ZmIGlzIHRoZSBjYWxsZXIncyBqb2IpLlxuICpcbiAqIEJ1bGsgcGhhc2VzIHJlcG9ydCBYL1kgb24gYHN0YXR1cygpLnByb2dyZXNzYCAodGhyb3R0bGVkIHZpYSB0aGUgaW5qZWN0ZWRcbiAqIGNsb2NrKTsgdGhlIHB1c2ggcGhhc2Uga2VlcHMgdXAgdG8gYHB1c2hDb25jdXJyZW5jeWAgY29tbWl0cyBpbiBmbGlnaHQuXG4gKlxuICogQWxsIEkvTyBjcm9zc2VzIHRoZSBhZGFwdGVyIHNlYW1zIChgU3RvcmFnZUFkYXB0ZXJgLCBgVHJhbnNwb3J0YCxcbiAqIGBCbG9iU3RvcmVgLCBgTG9nQWRhcHRlcmApOyB0aGUgY2xhc3MgaXRzZWxmIGlzIHB1cmUgb3JjaGVzdHJhdGlvbiBhbmQgcnVuc1xuICogYW55d2hlcmUgYGNvcmVgIHJ1bnMgXHUyMDE0IFdvcmtlcnMgdGVzdHMgaW5jbHVkZWQuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBMb2dBZGFwdGVyLCBTdG9yYWdlQWRhcHRlciwgV2F0Y2hBZGFwdGVyIH0gZnJvbSAnLi9hZGFwdGVycy5qcyc7XG5pbXBvcnQgeyBjb21wYXJlQ2xvY2tzIH0gZnJvbSAnLi9jbG9jay5qcyc7XG5pbXBvcnQgeyBhcHBseVB1bGwsIGxvYWRMb2NhbFN0YXRlLCBwcnVuZVBhcmVudE9uRGVsZXRlLCByZW1vdmVEaXJJZlZhY2FudCwgdHlwZSBGZXRjaEJsb2IgfSBmcm9tICcuL2VuZ2luZS5qcyc7XG5pbXBvcnQgeyBOZXR3b3JrRXJyb3IsIFByb3RvY29sRXJyb3IsIFJldm9rZWRFcnJvciwgVW5hdXRob3JpemVkRXJyb3IgfSBmcm9tICcuL2Vycm9ycy5qcyc7XG5pbXBvcnQgeyBzaGEyNTZIZXggfSBmcm9tICcuL2hhc2hpbmcuanMnO1xuaW1wb3J0IHsgaXNJZ25vcmVkLCB0eXBlIElnbm9yZVNldHRpbmdzIH0gZnJvbSAnLi9pZ25vcmUuanMnO1xuaW1wb3J0IHtcbiAgYXBwbHlDb21taXQsXG4gIExPQ0FMX0lOREVYX1NUQVRFX1BBVEgsXG4gIHJlbW92ZUVudHJ5LFxuICBzZXJpYWxpemVMb2NhbEluZGV4LFxuICB0eXBlIExvY2FsSW5kZXgsXG4gIHR5cGUgUGVyc2lzdGVkU3luY1N0YXRlLFxufSBmcm9tICcuL2xvY2FsaW5kZXguanMnO1xuaW1wb3J0IHtcbiAgYmFzZTY0VG9CeXRlcyxcbiAgYnl0ZXNUb0Jhc2U2NCxcbiAgSU5MSU5FX0NPTlRFTlRfTUFYX0JZVEVTLFxuICBQcm90b2NvbFZlcnNpb24sXG4gIHR5cGUgQmxvYkFja01lc3NhZ2UsXG4gIHR5cGUgQmxvYk1lc3NhZ2UsXG4gIHR5cGUgQ2hhbmdlTWVzc2FnZSxcbiAgdHlwZSBDb21taXRBY2tNZXNzYWdlLFxuICB0eXBlIENvbW1pdE1lc3NhZ2UsXG4gIHR5cGUgQ29uZmxpY3RNZXNzYWdlLFxuICB0eXBlIEhlbGxvQWNrTWVzc2FnZSxcbiAgdHlwZSBNYW5pZmVzdE1lc3NhZ2UsXG4gIHR5cGUgTWVzc2FnZSxcbiAgdHlwZSBTZXJ2ZXJNZXNzYWdlLFxuICB0eXBlIFNuYXBzaG90Q3JlYXRlQWNrTWVzc2FnZSxcbiAgdHlwZSBTbmFwc2hvdFJlc3RvcmVBY2tNZXNzYWdlLFxufSBmcm9tICcuL3Byb3RvY29sLmpzJztcbmltcG9ydCB7XG4gIGNvbXB1dGVTeW5jUGxhbixcbiAgdHlwZSBDb25mbGljdE9wLFxuICB0eXBlIFB1bGxGaWxlT3AsXG4gIHR5cGUgUHVsbE9wLFxuICB0eXBlIFB1c2hPcCxcbiAgdHlwZSBSZW1vdGVGaWxlLFxuICB0eXBlIFN5bmNQbGFuLFxufSBmcm9tICcuL3Jlc29sdmUuanMnO1xuaW1wb3J0IHsgcmVjb3JkSGFzaGVkRmlsZXMsIHNjYW5WYXVsdCwgdHlwZSBIYXNoZWRGaWxlIH0gZnJvbSAnLi9zY2FuLmpzJztcbmltcG9ydCB0eXBlIHsgVHJhbnNwb3J0IH0gZnJvbSAnLi90cmFuc3BvcnQuanMnO1xuaW1wb3J0IHR5cGUgeyBMb2dpY2FsQ2xvY2sgfSBmcm9tICcuL3R5cGVzLmpzJztcblxuLy8gLS0tIHB1YmxpYyBvcHRpb24vc3RhdHVzIHNoYXBlcyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogQ2xpZW50LXNpZGUgY29udGVudC1hZGRyZXNzZWQgYmxvYiBjYWNoZSAoUjIgY2xpZW50IGluIHByb2R1Y3Rpb247IGEgTWFwIGluIHRlc3RzKS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQmxvYlN0b3JlIHtcbiAgZ2V0KGhhc2g6IHN0cmluZyk6IFByb21pc2U8VWludDhBcnJheSB8IHVuZGVmaW5lZD47XG4gIHB1dChoYXNoOiBzdHJpbmcsIGJ5dGVzOiBVaW50OEFycmF5KTogUHJvbWlzZTx2b2lkPjtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBTeW5jQ2xpZW50T3B0aW9ucyB7XG4gIGRldmljZUlkOiBzdHJpbmc7XG4gIGRldmljZU5hbWU6IHN0cmluZztcbiAgdG9rZW46IHN0cmluZztcbiAgLyoqIEEgZmFjdG9yeSAocmVjb25uZWN0IGRpYWxzIGZyZXNoKSBvciBhIHNpbmdsZSByZXVzYWJsZSBpbnN0YW5jZS4gKi9cbiAgdHJhbnNwb3J0OiAoKCkgPT4gVHJhbnNwb3J0KSB8IFRyYW5zcG9ydDtcbiAgYmxvYlN0b3JlOiBCbG9iU3RvcmU7XG4gIHN0b3JhZ2U6IFN0b3JhZ2VBZGFwdGVyO1xuICBsb2c/OiBMb2dBZGFwdGVyO1xuICAvKiogSW5pdGlhbCBpZ25vcmUgc2V0dGluZ3M7IHN1cGVyc2VkZWQgYnkgYGhlbGxvQWNrLnNldHRpbmdzYCBvbiBjb25uZWN0LiAqL1xuICBzZXR0aW5ncz86IElnbm9yZVNldHRpbmdzO1xuICAvKiogSW5qZWN0YWJsZSBjbG9jayAoZGVmYXVsdCBgRGF0ZS5ub3dgKS4gKi9cbiAgbm93PzogKCkgPT4gbnVtYmVyO1xuICAvKiogV2F0Y2hlciBkZWJvdW5jZSB3aW5kb3cgaW4gbXMgKGRlZmF1bHQgMzAwKS4gKi9cbiAgZGVib3VuY2VNcz86IG51bWJlcjtcbiAgLyoqXG4gICAqIFNjaGVkdWxlcyB0aGUgZGVib3VuY2VkIHN5bmMgY3ljbGUuIERlZmF1bHQ6IGBzZXRUaW1lb3V0YC4gVGVzdHMgaW5qZWN0IGFcbiAgICogbWFudWFsIHF1ZXVlIFx1MjAxNCB0aGUgY2xpZW50IG5ldmVyIHRvdWNoZXMgYSByZWFsIHRpbWVyIGJlaGluZCB0aGlzIHNlYW0uXG4gICAqL1xuICBzY2hlZHVsZT86IChmbjogKCkgPT4gdm9pZCwgbXM6IG51bWJlcikgPT4gKCkgPT4gdm9pZDtcbiAgLyoqXG4gICAqIEJvdW5kZWQgY29uY3VycmVuY3kgb2YgdGhlIHB1c2ggcGlwZWxpbmU6IGhvdyBtYW55IGNvbW1pdHMgbWF5IGJlIGluXG4gICAqIGZsaWdodCAoc2VudCwgYXdhaXRpbmcgYWNrKSBhdCBvbmNlLiBEZWZhdWx0IDguIENvbmZsaWN0IGFyYml0cmF0aW9uIGlzXG4gICAqIHNlcnZlci1zaWRlIGFuZCBQRVIgUEFUSCwgYW5kIGEgY3ljbGUgc3RhZ2VzIGF0IG1vc3Qgb25lIGNvbW1pdCBwZXIgcGF0aCxcbiAgICogc28gb3JkZXJpbmcgYWNyb3NzIGRpZmZlcmVudCBmaWxlcyBpcyBpcnJlbGV2YW50IFx1MjAxNCBzZWVcbiAgICogYHJ1blB1c2hQaXBlbGluZWAgZm9yIHRoZSBmdWxsIGFyZ3VtZW50LlxuICAgKi9cbiAgcHVzaENvbmN1cnJlbmN5PzogbnVtYmVyO1xuICAvKipcbiAgICogTWluaW11bSB3YWxsLWNsb2NrIG1zIGJldHdlZW4gYHN0YXR1cygpLnByb2dyZXNzYCB1cGRhdGVzIGR1cmluZyBidWxrXG4gICAqIHBoYXNlcyAoZGVmYXVsdCA1MCBcdTIwMTQgcmVuZGVyZXIgY29hbGVzY2luZzsgcGhhc2UgY2hhbmdlcyBhbmQgY29tcGxldGlvbnNcbiAgICogYWx3YXlzIGVtaXQpLiBUZXN0cyBwYXNzIDAgdG8gb2JzZXJ2ZSBldmVyeSBmaWxlLlxuICAgKi9cbiAgcHJvZ3Jlc3NUaHJvdHRsZU1zPzogbnVtYmVyO1xufVxuXG5leHBvcnQgdHlwZSBTeW5jQ2xpZW50U3RhdGUgPSAnaWRsZScgfCAnY29ubmVjdGluZycgfCAnc3luY2luZycgfCAnbGl2ZScgfCAnZGlzY29ubmVjdGVkJztcblxuLyoqIFRoZSBidWxrIHBoYXNlIGEgcnVubmluZyBjeWNsZSBpcyBjdXJyZW50bHkgZ3JpbmRpbmcgdGhyb3VnaC4gKi9cbmV4cG9ydCB0eXBlIFN5bmNQaGFzZSA9ICdzY2FubmluZycgfCAncHVzaGluZycgfCAncHVsbGluZyc7XG5cbi8qKiBYL1kgcHJvZ3Jlc3Mgb2Ygb25lIGJ1bGsgcGhhc2U7IHByZXNlbnQgb24gYFN5bmNDbGllbnRTdGF0dXNgIG1pZC1jeWNsZSBvbmx5LiAqL1xuZXhwb3J0IGludGVyZmFjZSBTeW5jUHJvZ3Jlc3Mge1xuICBwaGFzZTogU3luY1BoYXNlO1xuICBkb25lOiBudW1iZXI7XG4gIHRvdGFsOiBudW1iZXI7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgU3luY0NsaWVudFN0YXR1cyB7XG4gIHN0YXRlOiBTeW5jQ2xpZW50U3RhdGU7XG4gIC8qKiBFcG9jaCBtcyBvZiB0aGUgbGFzdCBjb21wbGV0ZWQgY3ljbGUsIG9yIG51bGwgYmVmb3JlIHRoZSBmaXJzdC4gKi9cbiAgbGFzdFN5bmNBdDogbnVtYmVyIHwgbnVsbDtcbiAgLyoqIFdhdGNoZXIvcmVjb25jaWxlIGV2ZW50cyBxdWV1ZWQgYmVoaW5kIHRoZSBkZWJvdW5jZSB3aW5kb3cuICovXG4gIHBlbmRpbmc6IG51bWJlcjtcbiAgLyoqXG4gICAqIENvbmZsaWN0cyBvYnNlcnZlZCBieSB0aGUgbW9zdCByZWNlbnQgcGxhbiBjeWNsZSAoaW5mb3JtYXRpb25hbDtcbiAgICogcmVzb2x1dGlvbiBpcyBpbiB0aGUgZGF0YSkuIFJlcGxhY2VkIGV2ZXJ5IGN5Y2xlIFx1MjAxNCBhIGxhdGVyIGN5Y2xlIHRoYXRcbiAgICogcGxhbnMgY2xlYW4gY2xlYXJzIGl0LCBzbyBhIHN5bmNlZC1xdWlldCBjbGllbnQgcmVwb3J0cyAwLlxuICAgKi9cbiAgY29uZmxpY3RzOiBDb25mbGljdE9wW107XG4gIC8qKlxuICAgKiBTZXJ2ZXIgcmVsZWFzZSB2ZXJzaW9uIGFzIHJlcG9ydGVkIGJ5IGhlbGxvQWNrIChudWxsIGJlZm9yZSB0aGUgZmlyc3RcbiAgICogYWNrIFx1MjAxNCBhbmQgZm9yIGxlZ2FjeSBzZXJ2ZXJzIFx1MjI2NCAwLjEsIHdoaWNoIG5ldmVyIHNlbmQgdGhlIGZpZWxkOyBzZWVcbiAgICogYGNoZWNrU2VydmVyQ29tcGF0aWJpbGl0eWAgZm9yIHRoZSBzaGFyZWQgc2tldyBwb2xpY3kpLlxuICAgKi9cbiAgc2VydmVyVmVyc2lvbjogc3RyaW5nIHwgbnVsbDtcbiAgLyoqXG4gICAqIFByb2dyZXNzIG9mIHRoZSBSVU5OSU5HIGN5Y2xlJ3MgY3VycmVudCBidWxrIHBoYXNlIChgdnNhIFx1MjJFRiAxMjM0LzUwMDBgKTtcbiAgICogYWJzZW50IGJldHdlZW4gY3ljbGVzLiBVcGRhdGVzIGFyZSB0aHJvdHRsZWQgdG8gYHByb2dyZXNzVGhyb3R0bGVNc2AuXG4gICAqL1xuICBwcm9ncmVzcz86IFN5bmNQcm9ncmVzcztcbn1cblxuLyoqIERlZmF1bHQgaW4tZmxpZ2h0IGNvbW1pdCBjYXAgKHNlZSBgU3luY0NsaWVudE9wdGlvbnMucHVzaENvbmN1cnJlbmN5YCkuICovXG5leHBvcnQgY29uc3QgREVGQVVMVF9QVVNIX0NPTkNVUlJFTkNZID0gODtcbi8qKiBEZWZhdWx0IHByb2dyZXNzIGNvYWxlc2Npbmcgd2luZG93IChzZWUgYFN5bmNDbGllbnRPcHRpb25zLnByb2dyZXNzVGhyb3R0bGVNc2ApLiAqL1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfUFJPR1JFU1NfVEhST1RUTEVfTVMgPSA1MDtcblxuY29uc3QgZGVmYXVsdExvZzogTG9nQWRhcHRlciA9IHtcbiAgZGVidWc6ICgpID0+IHt9LFxuICBpbmZvOiAoKSA9PiB7fSxcbiAgd2FybjogKCkgPT4ge30sXG4gIGVycm9yOiAoKSA9PiB7fSxcbn07XG5cbmNvbnN0IGRlZmF1bHRTY2hlZHVsZSA9IChmbjogKCkgPT4gdm9pZCwgbXM6IG51bWJlcik6ICgoKSA9PiB2b2lkKSA9PiB7XG4gIGNvbnN0IGhhbmRsZSA9IGdsb2JhbFRoaXMuc2V0VGltZW91dChmbiwgbXMpIGFzIHVua25vd24gYXMgbnVtYmVyO1xuICByZXR1cm4gKCkgPT4gZ2xvYmFsVGhpcy5jbGVhclRpbWVvdXQoaGFuZGxlKTtcbn07XG5cbi8qKiBBIGNvbW1pdCBwcmVwYXJlZCBmb3IgdGhlIHdpcmUgKGEgYFB1c2hPcGAgKyBpdHMgc3RhZ2VkIGNvbnRlbnQpLiAqL1xuaW50ZXJmYWNlIFN0YWdlZENvbW1pdCB7XG4gIGtpbmQ6IENvbW1pdE1lc3NhZ2VbJ2tpbmQnXTtcbiAgcGF0aDogc3RyaW5nO1xuICBwYXJlbnRWZXJzaW9uOiBzdHJpbmcgfCBudWxsO1xuICBoYXNoOiBzdHJpbmc7XG4gIHNpemU6IG51bWJlcjtcbiAgZnJvbVBhdGg/OiBzdHJpbmc7XG4gIGlzRm9sZGVyPzogYm9vbGVhbjtcbiAgYnl0ZXM/OiBVaW50OEFycmF5O1xuICAvKipcbiAgICogU3RvcmFnZSBtdGltZSBvYnNlcnZlZCBieSBUSElTIGN5Y2xlJ3Mgc2NhbiB3aGVuIGl0IGhhc2hlZCB0aGUgY29udGVudFxuICAgKiAoYEhhc2hlZEZpbGUubXRpbWVgIG9mIHRoZSBwdXNoIHNvdXJjZSkuIFBpbm5lZCBvbnRvIHRoZSBpbmRleCBlbnRyeSB3aGVuXG4gICAqIHRoZSBhY2sgbGFuZHMsIHNvIHRoZSBlbnRyeSdzIChoYXNoLCBzaXplLCBtdGltZSkgYWx3YXlzIGRlc2NyaWJlcyBPTkVcbiAgICogY29uc2lzdGVudCBpbnN0YW50IG9mIHRoZSBmaWxlIFx1MjAxNCBuZXZlciBhIGxhdGVyIHN0YXQgcGFpcmVkIHdpdGggdGhpc1xuICAgKiBoYXNoLiBUaGF0IG9yZGVyaW5nIGlzIHdoYXQgbGV0cyB0aGUgc2NhbiBmYXN0LXBhdGggKG10aW1lK3NpemUpIHNraXBcbiAgICogcmUtaGFzaGluZyBzYWZlbHk6IGFuIGVkaXQgbGFuZGluZyBiZXR3ZWVuIGhhc2ggYW5kIGFjayBjaGFuZ2VzIHRoZSBkaXNrXG4gICAqIHN0YXQsIG1pc3NlcyB0aGUgZmFzdCBwYXRoLCBhbmQgaXMgcmUtaGFzaGVkIGFuZCBwdXNoZWQgb24gdGhlIG5leHQgc2Nhbi5cbiAgICovXG4gIG10aW1lPzogbnVtYmVyO1xufVxuXG4vLyAtLS0gdGhlIGNsaWVudCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGNsYXNzIFN5bmNDbGllbnQge1xuICBwcml2YXRlIHJlYWRvbmx5IG9wdGlvbnM6IFN5bmNDbGllbnRPcHRpb25zO1xuICBwcml2YXRlIHJlYWRvbmx5IGxvZzogTG9nQWRhcHRlcjtcbiAgcHJpdmF0ZSByZWFkb25seSBub3c6ICgpID0+IG51bWJlcjtcbiAgcHJpdmF0ZSByZWFkb25seSBkZWJvdW5jZU1zOiBudW1iZXI7XG4gIHByaXZhdGUgcmVhZG9ubHkgc2NoZWR1bGU6IChmbjogKCkgPT4gdm9pZCwgbXM6IG51bWJlcikgPT4gKCkgPT4gdm9pZDtcbiAgcHJpdmF0ZSByZWFkb25seSBkaWFsVHJhbnNwb3J0OiAoKSA9PiBUcmFuc3BvcnQ7XG4gIHByaXZhdGUgcmVhZG9ubHkgcHVzaENvbmN1cnJlbmN5OiBudW1iZXI7XG4gIHByaXZhdGUgcmVhZG9ubHkgcHJvZ3Jlc3NUaHJvdHRsZU1zOiBudW1iZXI7XG5cbiAgcHJpdmF0ZSB0cmFuc3BvcnQ6IFRyYW5zcG9ydCB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHN0YXRlOiBTeW5jQ2xpZW50U3RhdGUgPSAnaWRsZSc7XG4gIHByaXZhdGUgaW5kZXg6IExvY2FsSW5kZXggPSB7fTtcbiAgcHJpdmF0ZSBjdXJzb3IgPSAwO1xuICBwcml2YXRlIGxhc3RTeW5jQXQ6IG51bWJlciB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHBlbmRpbmcgPSAwO1xuICBwcml2YXRlIGNvbmZsaWN0czogQ29uZmxpY3RPcFtdID0gW107XG4gIHByaXZhdGUgaWdub3JlU2V0dGluZ3M6IElnbm9yZVNldHRpbmdzO1xuICBwcml2YXRlIHdhdGNoQWRhcHRlcjogV2F0Y2hBZGFwdGVyIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgY2FuY2VsRGVib3VuY2U6ICgoKSA9PiB2b2lkKSB8IG51bGwgPSBudWxsO1xuXG4gIC8qKlxuICAgKiBEZWx0YS1tYW5pZmVzdCBib29ra2VlcGluZyAocGVyc2lzdGVkIGFsb25nc2lkZSB0aGUgaW5kZXgsIHNlZVxuICAgKiBgUGVyc2lzdGVkU3luY1N0YXRlYCk6IGBzeW5jZWRUaHJvdWdoYCBcdTIwMTQgdGhlIG1hbmlmZXN0IGN1cnNvciBvZiB0aGUgbGFzdFxuICAgKiBmdWxseS1zdWNjZXNzZnVsIGN5Y2xlLCBpLmUuIHRoZSBzZXEgdGhyb3VnaCB3aGljaCB0aGUgaW5kZXggaXMga25vd25cbiAgICogQ09NUExFVEUgKG51bGwgdW50aWwgb25lIGZpbmlzaGVzKTsgYG5lZWRzRnVsbE1hbmlmZXN0YCBcdTIwMTQgYSByZW1vdGUgY2hhbmdlXG4gICAqIHdhcyBkZWZlcnJlZCBvdmVyIGxvY2FsIGRpdmVyZ2VuY2UgYW5kIG11c3QgYmUgcmVzb2x2ZWQgdGhyb3VnaCBhIGZ1bGxcbiAgICogbWFuaWZlc3QncyBwbGFuIGxvZ2ljOyBgc2VydmVyT2xkZXN0UmV0YWluZWRTZXFgIFx1MjAxNCB0aGUgaGVsbG9BY2sncyBhbnN3ZXJcbiAgICogdG8gXCJpcyBteSByZXBsYXkgd2luZG93IGludGFjdFwiIChudWxsIGZvciBsZWdhY3kgc2VydmVycyBcdTIxRDIgYWx3YXlzIGZ1bGwpLlxuICAgKi9cbiAgcHJpdmF0ZSBzeW5jZWRUaHJvdWdoOiBudW1iZXIgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBuZWVkc0Z1bGxNYW5pZmVzdCA9IGZhbHNlO1xuICBwcml2YXRlIHNlcnZlck9sZGVzdFJldGFpbmVkU2VxOiBudW1iZXIgfCBudWxsID0gbnVsbDtcbiAgLyoqIFNlcnZlciByZWxlYXNlIGZyb20gaGVsbG9BY2s7IG51bGwgdW50aWwgYWNrZWQgKGxlZ2FjeSBzZXJ2ZXJzIHN0YXkgbnVsbCkuICovXG4gIHByaXZhdGUgc2VydmVyVmVyc2lvbjogc3RyaW5nIHwgbnVsbCA9IG51bGw7XG5cbiAgLyoqIEN1cnJlbnQgYnVsay1waGFzZSBwcm9ncmVzcywgY2xlYXJlZCB3aGVuIGEgY3ljbGUgc2V0dGxlcy4gKi9cbiAgcHJpdmF0ZSBwcm9ncmVzczogU3luY1Byb2dyZXNzIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgbGFzdFByb2dyZXNzQXQgPSAwO1xuXG4gIC8qKiBTZXJpYWxpemVkIG9wZXJhdGlvbiBxdWV1ZSBcdTIwMTQgZXhhY3RseSBvbmUgYXN5bmMgb3AgcnVucyBhdCBhIHRpbWUuICovXG4gIHByaXZhdGUgdGFpbDogUHJvbWlzZTx1bmtub3duPiA9IFByb21pc2UucmVzb2x2ZSgpO1xuICBwcml2YXRlIHF1ZXVlZE9wcyA9IDA7XG4gIC8qKiBTdGFydHVwLXRpbWUgY2hhbmdlIGZsb29kIGlzIGJ1ZmZlcmVkOyB0aGUgZnVsbCBtYW5pZmVzdCBzdWJzdW1lcyBpdC4gKi9cbiAgcHJpdmF0ZSBidWZmZXJpbmcgPSBmYWxzZTtcbiAgcHJpdmF0ZSBidWZmZXJlZDogTWVzc2FnZVtdID0gW107XG4gIC8qKlxuICAgKiBPdXRzdGFuZGluZyByZXF1ZXN0IGV4cGVjdGF0aW9ucywgb2xkZXN0IGZpcnN0LiBPcHMgYXJlIHNlcmlhbGl6ZWQgcGVyXG4gICAqIGN5Y2xlIEVYQ0VQVCB0aGUgcHVzaCBwaXBlbGluZSwgd2hpY2gga2VlcHMgc2V2ZXJhbCBjb21taXRzIGluIGZsaWdodCBcdTIwMTRcbiAgICogcmVwbGllcyBvbiB0aGUgb3JkZXJlZCBXUyBhcnJpdmUgaW4gc2VuZCBvcmRlciwgc28gbWF0Y2hpbmcgdGhlIE9MREVTVFxuICAgKiBleHBlY3RhdGlvbiB0aGF0IGFjY2VwdHMgYSBtZXNzYWdlIHBhaXJzIGV2ZXJ5IHJlcGx5IHdpdGggaXRzIHJlcXVlc3RcbiAgICogKHRoZSBETyBhcmJpdHJhdGVzIGJlaGluZCBgcnVuRXhjbHVzaXZlYCwgYW5kIHRoZSBpbi1tZW1vcnkgc2VydmVyXG4gICAqIG1pcnJvcnMgdGhhdCwgc28gdGhlIHNlcnZlciBuZXZlciByZW9yZGVycyByZXBsaWVzIGVpdGhlcikuXG4gICAqL1xuICBwcml2YXRlIGV4cGVjdGF0aW9uczogQXJyYXk8e1xuICAgIG1hdGNoZXM6IChtZXNzYWdlOiBNZXNzYWdlKSA9PiBib29sZWFuO1xuICAgIHJlc29sdmU6IChtZXNzYWdlOiBNZXNzYWdlKSA9PiB2b2lkO1xuICAgIHJlamVjdDogKGVycm9yOiBFcnJvcikgPT4gdm9pZDtcbiAgfT4gPSBbXTtcbiAgLyoqXG4gICAqIFNlcmlhbGl6ZXMgQUNLIEFQUExJQ0FUSU9OIGFjcm9zcyBwaXBlbGluZSBzbG90cy4gU2xvdHMgYXdhaXQgcmVwbGllc1xuICAgKiBjb25jdXJyZW50bHksIGJ1dCBlYWNoIHJlcGx5IGZvbGRzIGludG8gdGhlIFNIQVJFRCBgdGhpcy5pbmRleGBcbiAgICogKHJlYWQtbW9kaWZ5LXdyaXRlKTsgY2hhaW5pbmcgdGhlIGZvbGRzIGtlZXBzIGV2ZXJ5IGFwcGx5IGF0b21pYyB3aXRoXG4gICAqIHJlc3BlY3QgdG8gdGhlIG90aGVycy4gT3JkZXIgYWNyb3NzIGRpZmZlcmVudCBwYXRocyBpcyBpcnJlbGV2YW50IChvbmVcbiAgICogY29tbWl0IHBlciBwYXRoIHBlciBjeWNsZSwgcGVyLXBhdGggc2VydmVyIGFyYml0cmF0aW9uKSwgc28gbm8gb3JkZXJpbmdcbiAgICogZ3VhcmFudGVlIGlzIG5lZWRlZCBiZXlvbmQgbXV0dWFsIGV4Y2x1c2lvbi5cbiAgICovXG4gIHByaXZhdGUgYWNrQ2hhaW46IFByb21pc2U8dm9pZD4gPSBQcm9taXNlLnJlc29sdmUoKTtcblxuICBjb25zdHJ1Y3RvcihvcHRpb25zOiBTeW5jQ2xpZW50T3B0aW9ucykge1xuICAgIHRoaXMub3B0aW9ucyA9IG9wdGlvbnM7XG4gICAgdGhpcy5sb2cgPSBvcHRpb25zLmxvZyA/PyBkZWZhdWx0TG9nO1xuICAgIHRoaXMubm93ID0gb3B0aW9ucy5ub3cgPz8gKCgpID0+IERhdGUubm93KCkpO1xuICAgIHRoaXMuZGVib3VuY2VNcyA9IG9wdGlvbnMuZGVib3VuY2VNcyA/PyAzMDA7XG4gICAgdGhpcy5zY2hlZHVsZSA9IG9wdGlvbnMuc2NoZWR1bGUgPz8gZGVmYXVsdFNjaGVkdWxlO1xuICAgIHRoaXMucHVzaENvbmN1cnJlbmN5ID0gTWF0aC5tYXgoMSwgb3B0aW9ucy5wdXNoQ29uY3VycmVuY3kgPz8gREVGQVVMVF9QVVNIX0NPTkNVUlJFTkNZKTtcbiAgICB0aGlzLnByb2dyZXNzVGhyb3R0bGVNcyA9IE1hdGgubWF4KDAsIG9wdGlvbnMucHJvZ3Jlc3NUaHJvdHRsZU1zID8/IERFRkFVTFRfUFJPR1JFU1NfVEhST1RUTEVfTVMpO1xuICAgIHRoaXMuZGlhbFRyYW5zcG9ydCA9XG4gICAgICB0eXBlb2Ygb3B0aW9ucy50cmFuc3BvcnQgPT09ICdmdW5jdGlvbidcbiAgICAgICAgPyBvcHRpb25zLnRyYW5zcG9ydFxuICAgICAgICA6ICgpID0+IG9wdGlvbnMudHJhbnNwb3J0IGFzIFRyYW5zcG9ydDtcbiAgICB0aGlzLmlnbm9yZVNldHRpbmdzID0gb3B0aW9ucy5zZXR0aW5ncyA/PyB7IG9ic2lkaWFuU3luYzogZmFsc2UgfTtcbiAgfVxuXG4gIC8vIC0tLSBsaWZlY3ljbGUgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIC8qKiBSdW4gc3RhcnR1cCByZWNvbmNpbGlhdGlvbiBhbmQgZW50ZXIgbGl2ZSBtb2RlLiAqL1xuICBhc3luYyBjb25uZWN0KCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMuZW5xdWV1ZSgoKSA9PiB0aGlzLnN0YXJ0dXAoKSk7XG4gIH1cblxuICAvKiogUmUtZGlhbCBhbmQgcmUtcnVuIHRoZSBmdWxsIHN0YXJ0dXAgcmVjb25jaWxpYXRpb24uICovXG4gIGFzeW5jIHJlY29ubmVjdCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLmVucXVldWUoYXN5bmMgKCkgPT4ge1xuICAgICAgdGhpcy50cmFuc3BvcnQ/LmNsb3NlKCk7XG4gICAgICB0aGlzLnRyYW5zcG9ydCA9IG51bGw7XG4gICAgICBhd2FpdCB0aGlzLnN0YXJ0dXAoKTtcbiAgICB9KTtcbiAgfVxuXG4gIGNsb3NlKCk6IHZvaWQge1xuICAgIHRoaXMuc3RvcFdhdGNoaW5nKCk7XG4gICAgdGhpcy5jYW5jZWxEZWJvdW5jZT8uKCk7XG4gICAgdGhpcy5jYW5jZWxEZWJvdW5jZSA9IG51bGw7XG4gICAgdGhpcy50cmFuc3BvcnQ/LmNsb3NlKCk7XG4gICAgdGhpcy50cmFuc3BvcnQgPSBudWxsO1xuICAgIHRoaXMuc3RhdGUgPSAnaWRsZSc7XG4gIH1cblxuICAvKiogQmVnaW4gZGVib3VuY2VkIHdhdGNoaW5nIChBUkNISVRFQ1RVUkUgXHUwMEE3OCBsaXZlIG9wZXJhdGlvbikuICovXG4gIHN0YXJ0V2F0Y2hpbmcod2F0Y2hBZGFwdGVyOiBXYXRjaEFkYXB0ZXIpOiB2b2lkIHtcbiAgICB0aGlzLnN0b3BXYXRjaGluZygpO1xuICAgIHRoaXMud2F0Y2hBZGFwdGVyID0gd2F0Y2hBZGFwdGVyO1xuICAgIHdhdGNoQWRhcHRlci5zdGFydCgoZXZlbnRzKSA9PiB0aGlzLm9uV2F0Y2hFdmVudHMoZXZlbnRzKSk7XG4gIH1cblxuICBzdG9wV2F0Y2hpbmcoKTogdm9pZCB7XG4gICAgdGhpcy53YXRjaEFkYXB0ZXI/LnN0b3AoKTtcbiAgICB0aGlzLndhdGNoQWRhcHRlciA9IG51bGw7XG4gIH1cblxuICAvKiogTWFudWFsIG9uZS1zaG90IGN5Y2xlIChgdnNhYCBvbmUtc2hvdCwgXCJzeW5jIG5vd1wiIGJ1dHRvbnMsIHRlc3RzKS4gKi9cbiAgYXN5bmMgdHJpZ2dlclN5bmMoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5lbnF1ZXVlKCgpID0+IHRoaXMucnVuQ3ljbGUoKSk7XG4gIH1cblxuICAvKiogUmVzb2x2ZXMgd2hlbiBldmVyeSBxdWV1ZWQgb3BlcmF0aW9uIGhhcyBzZXR0bGVkLiAqL1xuICBhc3luYyB3YWl0SWRsZSgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB3aGlsZSAodGhpcy5xdWV1ZWRPcHMgPiAwKSBhd2FpdCB0aGlzLnRhaWw7XG4gICAgYXdhaXQgdGhpcy50YWlsO1xuICB9XG5cbiAgc3RhdHVzKCk6IFN5bmNDbGllbnRTdGF0dXMge1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0ZTogdGhpcy5zdGF0ZSxcbiAgICAgIGxhc3RTeW5jQXQ6IHRoaXMubGFzdFN5bmNBdCxcbiAgICAgIHBlbmRpbmc6IHRoaXMucGVuZGluZyxcbiAgICAgIGNvbmZsaWN0czogWy4uLnRoaXMuY29uZmxpY3RzXSxcbiAgICAgIHNlcnZlclZlcnNpb246IHRoaXMuc2VydmVyVmVyc2lvbixcbiAgICAgIC4uLih0aGlzLnByb2dyZXNzICE9PSBudWxsID8geyBwcm9ncmVzczogeyAuLi50aGlzLnByb2dyZXNzIH0gfSA6IHt9KSxcbiAgICB9O1xuICB9XG5cbiAgLyoqIFJlYWQtb25seSB2aWV3IG9mIHRoZSBsb2NhbCBpbmRleCAodGVzdHMsIGB2c2Egc3RhdHVzYCkuICovXG4gIGN1cnJlbnRJbmRleCgpOiBMb2NhbEluZGV4IHtcbiAgICByZXR1cm4geyAuLi50aGlzLmluZGV4IH07XG4gIH1cblxuICAvKiogTGFzdCBzZWVuIHNlcnZlciBzZXF1ZW5jZSBudW1iZXIuICovXG4gIGdldCBjdXJzb3JWYWx1ZSgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLmN1cnNvcjtcbiAgfVxuXG4gIC8qKiBUUy1zYWZlIHN0YXRlIHByb2JlIChhc3NpZ25tZW50cyBpbnNpZGUgYXN5bmMgZmxvd3MgZGVmZWF0IG5hcnJvd2luZykuICovXG4gIHByaXZhdGUgaXNEaXNjb25uZWN0ZWQoKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIHRoaXMuc3RhdGUgPT09ICdkaXNjb25uZWN0ZWQnO1xuICB9XG5cbiAgLy8gLS0tIHN0YXJ0dXAgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIHByaXZhdGUgYXN5bmMgc3RhcnR1cCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLnN0YXRlID0gJ2Nvbm5lY3RpbmcnO1xuICAgIHRoaXMuYnVmZmVyaW5nID0gdHJ1ZTtcbiAgICB0aGlzLmJ1ZmZlcmVkID0gW107XG5cbiAgICAvLyBSZXN0b3JlIHRoZSBpbmRleCBBTkQgdGhlIHN5bmMtY3Vyc29yIGJvb2trZWVwaW5nIChvbmUgYXRvbWljIGZpbGUpOlxuICAgIC8vIHRoZSBwZXJzaXN0ZWQgY3Vyc29yIGxldHMgaGVsbG8gcmVwbGF5IG9ubHkgd2hhdCB3YXMgbWlzc2VkLCBhbmRcbiAgICAvLyBgc3luY2VkVGhyb3VnaGAgZGVjaWRlcyB3aGV0aGVyIGEgZGVsdGEgbWFuaWZlc3QgbWF5IGJlIHJlcXVlc3RlZC5cbiAgICBpZiAoYXdhaXQgdGhpcy5zYWZlU3RvcmFnZUV4aXN0cyhMT0NBTF9JTkRFWF9TVEFURV9QQVRIKSkge1xuICAgICAgY29uc3QgbG9hZGVkID0gYXdhaXQgbG9hZExvY2FsU3RhdGUodGhpcy5vcHRpb25zLnN0b3JhZ2UpO1xuICAgICAgdGhpcy5pbmRleCA9IGxvYWRlZC5pbmRleDtcbiAgICAgIHRoaXMuY3Vyc29yID0gbG9hZGVkLnN0YXRlLmN1cnNvcjtcbiAgICAgIHRoaXMuc3luY2VkVGhyb3VnaCA9IGxvYWRlZC5zdGF0ZS5zeW5jZWRUaHJvdWdoO1xuICAgICAgdGhpcy5uZWVkc0Z1bGxNYW5pZmVzdCA9IGxvYWRlZC5zdGF0ZS5uZWVkc0Z1bGxNYW5pZmVzdDtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5pbmRleCA9IHt9O1xuICAgICAgdGhpcy5jdXJzb3IgPSAwO1xuICAgICAgdGhpcy5zeW5jZWRUaHJvdWdoID0gbnVsbDtcbiAgICAgIHRoaXMubmVlZHNGdWxsTWFuaWZlc3QgPSBmYWxzZTtcbiAgICB9XG4gICAgdGhpcy5zZXJ2ZXJPbGRlc3RSZXRhaW5lZFNlcSA9IG51bGw7XG4gICAgLy8gVmVyc2lvbiBza2V3IGlzIHJlLWFzc2Vzc2VkIHBlciBjb25uZWN0aW9uOiByZXNldCBiZWZvcmUgdGhlIGFjayBzbyBhXG4gICAgLy8gcmVjb25uZWN0IGFnYWluc3QgYSBkaWZmZXJlbnQgKG9yIGxlZ2FjeSkgc2VydmVyIG5ldmVyIHJlcG9ydHMgYSBzdGFsZVxuICAgIC8vIHZlcnNpb24gYmV0d2VlbiB0aGUgZGlhbCBhbmQgdGhlIGZyZXNoIGhlbGxvQWNrLlxuICAgIHRoaXMuc2VydmVyVmVyc2lvbiA9IG51bGw7XG5cbiAgICBjb25zdCB0cmFuc3BvcnQgPSB0aGlzLmRpYWxUcmFuc3BvcnQoKTtcbiAgICB0aGlzLnRyYW5zcG9ydCA9IHRyYW5zcG9ydDtcbiAgICB0cmFuc3BvcnQub25NZXNzYWdlKChtZXNzYWdlKSA9PiB0aGlzLm9uVHJhbnNwb3J0TWVzc2FnZShtZXNzYWdlKSk7XG4gICAgdHJhbnNwb3J0Lm9uQ2xvc2UoKHJlYXNvbikgPT4gdGhpcy5vblRyYW5zcG9ydENsb3NlKHJlYXNvbikpO1xuXG4gICAgY29uc3QgaGVsbG9BY2sgPSBhd2FpdCB0aGlzLnJlcXVlc3Q8SGVsbG9BY2tNZXNzYWdlIHwgU2VydmVyRXJyb3JNZXNzYWdlPihcbiAgICAgIChtKSA9PiBtLnR5cGUgPT09ICdoZWxsb0FjaycgfHwgbS50eXBlID09PSAnZXJyb3InLFxuICAgICAgKCkgPT5cbiAgICAgICAgdHJhbnNwb3J0LnNlbmQoe1xuICAgICAgICAgIHR5cGU6ICdoZWxsbycsXG4gICAgICAgICAgdG9rZW46IHRoaXMub3B0aW9ucy50b2tlbixcbiAgICAgICAgICBwcm90b2NvbFZlcnNpb246IFByb3RvY29sVmVyc2lvbixcbiAgICAgICAgICBjdXJzb3I6IHRoaXMuY3Vyc29yLFxuICAgICAgICB9KSxcbiAgICApO1xuICAgIGlmIChoZWxsb0Fjay50eXBlID09PSAnZXJyb3InKSB0aHJvdyB0aGlzLnRvRXJyb3IoaGVsbG9BY2spO1xuICAgIC8vIFRoZSBzZXJ2ZXIncyBwZXItdmF1bHQgYG9ic2lkaWFuU3luY2Agc3VwZXJzZWRlcyB0aGUgbG9jYWwgaW5pdGlhbFxuICAgIC8vIHZhbHVlLCBidXQgYGV4dHJhSWdub3Jlc2AgaXMgYSBjbGllbnQtc2lkZSBjb25jZXJuIFx1MjAxNCB0aGUgd29ya2VyIG5ldmVyXG4gICAgLy8gc2VuZHMgaXQsIHNvIHRoZSBsb2NhbGx5IGNvbmZpZ3VyZWQgcGF0dGVybnMgc3Vydml2ZSB0aGUgaGFuZHNoYWtlLlxuICAgIHRoaXMuaWdub3JlU2V0dGluZ3MgPSB7XG4gICAgICBvYnNpZGlhblN5bmM6IGhlbGxvQWNrLnNldHRpbmdzLm9ic2lkaWFuU3luYyxcbiAgICAgIC4uLih0aGlzLmlnbm9yZVNldHRpbmdzLmV4dHJhSWdub3JlcyAhPT0gdW5kZWZpbmVkXG4gICAgICAgID8geyBleHRyYUlnbm9yZXM6IHRoaXMuaWdub3JlU2V0dGluZ3MuZXh0cmFJZ25vcmVzIH1cbiAgICAgICAgOiB7fSksXG4gICAgfTtcbiAgICAvLyBSZXBsYXktd2luZG93IGFuc3dlcjogd2l0aCB0aGlzLCB0aGUgY2xpZW50IGNhbiB0ZWxsIHdoZXRoZXIgZXZlcnlcbiAgICAvLyBldmVudCBhZnRlciBpdHMgY3Vyc29yIHdhcyByZXRhaW5lZCAoZGVsdGEtbWFuaWZlc3QgZWxpZ2liaWxpdHkpLlxuICAgIHRoaXMuc2VydmVyT2xkZXN0UmV0YWluZWRTZXEgPSBoZWxsb0Fjay5vbGRlc3RSZXRhaW5lZFNlcSA/PyBudWxsO1xuICAgIHRoaXMuc2VydmVyVmVyc2lvbiA9IGhlbGxvQWNrLnNlcnZlclZlcnNpb24gPz8gbnVsbDtcblxuICAgIHRoaXMuc3RhdGUgPSAnc3luY2luZyc7XG4gICAgaWYgKHRoaXMuc2hvdWxkUmVxdWVzdERlbHRhTWFuaWZlc3QoKSkge1xuICAgICAgLy8gREVMVEEgTU9ERTogYXBwbHkgdGhlIHJlcGxheWVkIGNoYW5nZXMgQkVGT1JFIHBsYW5uaW5nLiBUaGUgZGVsdGFcbiAgICAgIC8vIG1hbmlmZXN0IG9taXRzIGV2ZXJ5IGhlYWQgYXQgb3IgYmVsb3cgdGhlIGN1cnNvciBcdTIwMTQgaW5jbHVkaW5nIGhlYWRzXG4gICAgICAvLyB0aGF0IG5vIGxvbmdlciBleGlzdCBiZWNhdXNlIHRoZSBhdXRob3JpdHkgTUlHUkFURUQgdGhlbSAoYSByZW5hbWVcbiAgICAgIC8vIGRlbGV0ZXMgdGhlIG9sZCByb3cpIFx1MjAxNCBzbyB0aGUgaW5kZXggcHJvamVjdGlvbiBtdXN0IG5vdCBjYXJyeSB0aG9zZVxuICAgICAgLy8gcGF0aHMgYW55bW9yZS4gVGhlIHJlcGxheWVkIHJlbmFtZSAoc2VxID4gY3Vyc29yKSBtYXRlcmlhbGl6ZXMgaGVyZVxuICAgICAgLy8gYW5kIHJlbW92ZXMgdGhlIHN0YWxlIHBhdGgsIG1ha2luZyB0aGUgbWVyZ2VkIHZpZXcgaWRlbnRpY2FsIHRvIHdoYXRcbiAgICAgIC8vIGEgZnVsbCBtYW5pZmVzdCB3b3VsZCBoYXZlIHNhaWQuIChUaGUgb3JkZXJlZCB3aXJlIGd1YXJhbnRlZXMgdGhlXG4gICAgICAvLyByZXBsYXkgcHJlY2VkZXMgdGhlIG1hbmlmZXN0IHJlcGx5OyBhbnl0aGluZyBzdHJhZ2dsaW5nIHN0YXlzXG4gICAgICAvLyBidWZmZXJlZCBhbmQgaXMgZGlzcGF0Y2hlZCBhZnRlciB0aGUgY3ljbGUsIGFzIGFsd2F5cy4pIEEgcmVwbGF5ZWRcbiAgICAgIC8vIGNoYW5nZSB0aGF0IGhpdHMgdGhlIGRpdmVyZ2VuY2UgZ3VhcmQgZmxpcHMgYG5lZWRzRnVsbE1hbmlmZXN0YCxcbiAgICAgIC8vIGFuZCBgZmV0Y2hNYW5pZmVzdGAgcmUtZXZhbHVhdGVzIFx1MjAxNCBmYWxsaW5nIGJhY2sgdG8gZnVsbCwgYXMgZGVzaWduZWQuXG4gICAgICBjb25zdCByZXBsYXkgPSB0aGlzLmJ1ZmZlcmVkO1xuICAgICAgdGhpcy5idWZmZXJlZCA9IFtdO1xuICAgICAgZm9yIChjb25zdCBtZXNzYWdlIG9mIHJlcGxheSkge1xuICAgICAgICBhd2FpdCB0aGlzLmRpc3BhdGNoKG1lc3NhZ2UpO1xuICAgICAgfVxuICAgIH1cbiAgICBhd2FpdCB0aGlzLnJ1bkN5Y2xlKCk7XG5cbiAgICB0aGlzLmJ1ZmZlcmluZyA9IGZhbHNlO1xuICAgIGNvbnN0IGJ1ZmZlcmVkID0gdGhpcy5idWZmZXJlZDtcbiAgICB0aGlzLmJ1ZmZlcmVkID0gW107XG4gICAgZm9yIChjb25zdCBtZXNzYWdlIG9mIGJ1ZmZlcmVkKSB7XG4gICAgICBhd2FpdCB0aGlzLmRpc3BhdGNoKG1lc3NhZ2UpO1xuICAgIH1cbiAgICBpZiAoIXRoaXMuaXNEaXNjb25uZWN0ZWQoKSkgdGhpcy5zdGF0ZSA9ICdsaXZlJztcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgc2FmZVN0b3JhZ2VFeGlzdHMocGF0aDogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLm9wdGlvbnMuc3RvcmFnZS5leGlzdHMocGF0aCk7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBvblRyYW5zcG9ydENsb3NlKHJlYXNvbjogeyBjb2RlPzogbnVtYmVyOyByZWFzb24/OiBzdHJpbmcgfSk6IHZvaWQge1xuICAgIHRoaXMubG9nLndhcm4oJ3RyYW5zcG9ydCBjbG9zZWQnLCByZWFzb24pO1xuICAgIHRoaXMuc3RhdGUgPSAnZGlzY29ubmVjdGVkJztcbiAgICBjb25zdCBleHBlY3RhdGlvbnMgPSB0aGlzLmV4cGVjdGF0aW9ucztcbiAgICB0aGlzLmV4cGVjdGF0aW9ucyA9IFtdO1xuICAgIGZvciAoY29uc3QgZXhwZWN0YXRpb24gb2YgZXhwZWN0YXRpb25zKSB7XG4gICAgICBleHBlY3RhdGlvbi5yZWplY3QoXG4gICAgICAgIG5ldyBOZXR3b3JrRXJyb3IoYGNvbm5lY3Rpb24gY2xvc2VkOiAke3JlYXNvbi5yZWFzb24gPz8gcmVhc29uLmNvZGUgPz8gJ3Vua25vd24nfWApLFxuICAgICAgKTtcbiAgICB9XG4gIH1cblxuICAvLyAtLS0gbWVzc2FnZSBwdW1wIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICBwcml2YXRlIG9uVHJhbnNwb3J0TWVzc2FnZSA9IChtZXNzYWdlOiBNZXNzYWdlKTogdm9pZCA9PiB7XG4gICAgLy8gT2xkZXN0IGV4cGVjdGF0aW9uIHRoYXQgYWNjZXB0cyB0aGlzIG1lc3NhZ2UuIFdpdGggdGhlIHB1c2ggcGlwZWxpbmVcbiAgICAvLyBzZXZlcmFsIGNvbW1pdCBleHBlY3RhdGlvbnMgYXJlIG91dHN0YW5kaW5nIGF0IG9uY2U7IHRoZSBvcmRlcmVkIHdpcmUgK1xuICAgIC8vIHRoZSBzZXJ2ZXIncyBzZXJpYWxpemVkIGFyYml0cmF0aW9uIGRlbGl2ZXIgcmVwbGllcyBpbiBzZW5kIG9yZGVyLCBzb1xuICAgIC8vIGZpcnN0LW1hdGNoIHBhaXJzIGVhY2ggcmVwbHkgd2l0aCBpdHMgb3duIHJlcXVlc3QuXG4gICAgY29uc3QgaW5kZXggPSB0aGlzLmV4cGVjdGF0aW9ucy5maW5kSW5kZXgoKGV4cGVjdGF0aW9uKSA9PiBleHBlY3RhdGlvbi5tYXRjaGVzKG1lc3NhZ2UpKTtcbiAgICBpZiAoaW5kZXggPj0gMCkge1xuICAgICAgY29uc3QgZXhwZWN0YXRpb24gPSB0aGlzLmV4cGVjdGF0aW9uc1tpbmRleF07XG4gICAgICB0aGlzLmV4cGVjdGF0aW9ucy5zcGxpY2UoaW5kZXgsIDEpO1xuICAgICAgaWYgKGV4cGVjdGF0aW9uICE9PSB1bmRlZmluZWQpIGV4cGVjdGF0aW9uLnJlc29sdmUobWVzc2FnZSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmICh0aGlzLmJ1ZmZlcmluZykge1xuICAgICAgdGhpcy5idWZmZXJlZC5wdXNoKG1lc3NhZ2UpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLmVucXVldWUoYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5kaXNwYXRjaChtZXNzYWdlKTtcbiAgICB9KS5jYXRjaCgoZXJyb3I6IHVua25vd24pID0+IHRoaXMubG9nLndhcm4oJ2NoYW5nZSBoYW5kbGVyIGZhaWxlZCcsIGVycm9yKSk7XG4gIH07XG5cbiAgcHJpdmF0ZSBhc3luYyBkaXNwYXRjaChtZXNzYWdlOiBNZXNzYWdlKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgc3dpdGNoIChtZXNzYWdlLnR5cGUpIHtcbiAgICAgIGNhc2UgJ2NoYW5nZSc6XG4gICAgICAgIGF3YWl0IHRoaXMuaGFuZGxlQ2hhbmdlKG1lc3NhZ2UpO1xuICAgICAgICByZXR1cm47XG4gICAgICBjYXNlICdkZXZpY2VTZWVuJzpcbiAgICAgICAgcmV0dXJuOyAvLyBwcmVzZW5jZSBvbmx5OyBkYXNoYm9hcmRzIGNvbnN1bWUgaXRcbiAgICAgIGNhc2UgJ3BvbmcnOlxuICAgICAgICByZXR1cm47XG4gICAgICBjYXNlICdlcnJvcic6XG4gICAgICAgIHRoaXMubG9nLmVycm9yKCdzZXJ2ZXIgZXJyb3InLCBtZXNzYWdlLmNvZGUsIG1lc3NhZ2UubWVzc2FnZSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIGNhc2UgJ2hlbGxvQWNrJzpcbiAgICAgIGNhc2UgJ21hbmlmZXN0JzpcbiAgICAgIGNhc2UgJ2NvbW1pdEFjayc6XG4gICAgICBjYXNlICdjb25mbGljdCc6XG4gICAgICBjYXNlICdibG9iJzpcbiAgICAgIGNhc2UgJ2Jsb2JBY2snOlxuICAgICAgY2FzZSAnc25hcHNob3RDcmVhdGVBY2snOlxuICAgICAgY2FzZSAnc25hcHNob3RSZXN0b3JlQWNrJzpcbiAgICAgICAgLy8gUmVwbGllcyBhcnJpdmUgb25seSBhZ2FpbnN0IGFuIG91dHN0YW5kaW5nIGV4cGVjdGF0aW9uOyBhXG4gICAgICAgIC8vIHNwb250YW5lb3VzIG9uZSBpcyBhIHByb3RvY29sIHZpb2xhdGlvbiB3ZSBsb2cgYW5kIGRyb3AuXG4gICAgICAgIHRoaXMubG9nLndhcm4oJ3VuZXhwZWN0ZWQgc2VydmVyIHJlcGx5JywgbWVzc2FnZS50eXBlKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgdGhpcy5sb2cud2FybignaWdub3JpbmcgY2xpZW50LXRvLXNlcnZlciBtZXNzYWdlIGZyb20gc2VydmVyJywgbWVzc2FnZSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBoYW5kbGVDaGFuZ2UoY2hhbmdlOiBDaGFuZ2VNZXNzYWdlKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKGNoYW5nZS5zZXEgPiB0aGlzLmN1cnNvcikgdGhpcy5jdXJzb3IgPSBjaGFuZ2Uuc2VxO1xuICAgIGlmIChpc0lnbm9yZWQoY2hhbmdlLnBhdGgsIHRoaXMuaWdub3JlU2V0dGluZ3MpKSByZXR1cm47XG4gICAgaWYgKGNoYW5nZS5mcm9tUGF0aCAhPT0gdW5kZWZpbmVkICYmIGlzSWdub3JlZChjaGFuZ2UuZnJvbVBhdGgsIHRoaXMuaWdub3JlU2V0dGluZ3MpKSByZXR1cm47XG5cbiAgICAvLyBTdGFsZSByZXBsYXkgLyBkdXBsaWNhdGUgZmFuLW91dDogcGVyIHBhdGggdGhlIGhlYWQgY2xvY2sgZG9taW5hdGVzXG4gICAgLy8gZXZlcnkgZWFybGllciB2ZXJzaW9uLCBzbyBhbnl0aGluZyBcdTIyNjQgdGhlIHJlY29yZGVkIGNsb2NrIGlzIG9sZCBuZXdzLlxuICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5pbmRleFtjaGFuZ2UucGF0aF07XG4gICAgaWYgKGVudHJ5ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGlmIChlbnRyeS52ZXJzaW9uSWQgPT09IGNoYW5nZS52ZXJzaW9uKSByZXR1cm47XG4gICAgICBpZiAoY29tcGFyZUNsb2NrcyhlbnRyeS5jbG9jaywgY2hhbmdlLmNsb2NrKSA+PSAwKSByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gVGhlIGd1YXJkOiBuZXZlciB3cml0ZSBhIHJlbW90ZSBjaGFuZ2Ugb3ZlciBsb2NhbGx5LWRpdmVyZ2VkIGNvbnRlbnQuXG4gICAgaWYgKCEoYXdhaXQgdGhpcy5jaGFuZ2VJc1NhZmUoY2hhbmdlKSkpIHtcbiAgICAgIHRoaXMubG9nLmluZm8oJ2RlZmVycmluZyByZW1vdGUgY2hhbmdlIG92ZXIgbG9jYWwgZGl2ZXJnZW5jZScsIGNoYW5nZS5wYXRoKTtcbiAgICAgIC8vIFRoZSBkaXZlcmdlbmNlIG11c3QgYmUgcmVzb2x2ZWQgYnkgYSBwbGFuIGN5Y2xlIHRoYXQgY2FuIFNFRSB0aGVcbiAgICAgIC8vIHJlbW90ZSBoZWFkIFx1MjAxNCBmbGFnIHRoZSBuZXh0IG1hbmlmZXN0IGZ1bGwgKGRlbHRhIG1hbmlmZXN0cyBvbWl0XG4gICAgICAvLyBoZWFkcyBhdCBvciBiZWxvdyB0aGUgY3Vyc29yLCB3aGljaCB0aGlzIGNoYW5nZSBtYXkgYmUgYXQpLlxuICAgICAgdGhpcy5uZWVkc0Z1bGxNYW5pZmVzdCA9IHRydWU7XG4gICAgICB0aGlzLnNjaGVkdWxlUmVjb25jaWxlKCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdGhpcy5pbmRleCA9IGF3YWl0IHRoaXMuYXBwbHlQdWxscyhbdGhpcy5wdWxsT3BGcm9tQ2hhbmdlKGNoYW5nZSldKTtcbiAgICAvLyBUaGlzIHBhdGgncyBoZWFkIGlzIG5vdyBtYXRlcmlhbGl6ZWQgbG9jYWxseSwgc28gdGhlIGNvbXBsZXRpb25cbiAgICAvLyB3YXRlcm1hcmsgYWR2YW5jZXMgd2l0aCB0aGUgKHN0cmljdGx5IG9yZGVyZWQpIGZlZWQuIEEgY2hhbmdlIHRoYXRcbiAgICAvLyB0b29rIHRoZSBkZWZlciBicmFuY2ggYWJvdmUgbmV2ZXIgcmVhY2hlcyB0aGlzIGxpbmUsIGFuZCBpdHNcbiAgICAvLyBgbmVlZHNGdWxsTWFuaWZlc3RgIGZsYWcga2VlcHMgZGVsdGEgbW9kZSBvZmYgdW50aWwgYSBmdWxsLW1hbmlmZXN0XG4gICAgLy8gY3ljbGUgcmVzb2x2ZXMgdGhlIGRpdmVyZ2VuY2UuXG4gICAgaWYgKGNoYW5nZS5zZXEgPiAodGhpcy5zeW5jZWRUaHJvdWdoID8/IDApKSB0aGlzLnN5bmNlZFRocm91Z2ggPSBjaGFuZ2Uuc2VxO1xuICB9XG5cbiAgLyoqXG4gICAqIEEgY2hhbmdlIG1heSBiZSBhcHBsaWVkIGRpcmVjdGx5IG9ubHkgd2hlbiB0aGUgdG91Y2hlZCBwYXRocyBjYXJyeSBub1xuICAgKiB1bi1yZWNvbmNpbGVkIGxvY2FsIGNvbnRlbnQuIEFueXRoaW5nIGVsc2UgbXVzdCBkZXRvdXIgdGhyb3VnaCBhIGZ1bGxcbiAgICogYGNvbXB1dGVTeW5jUGxhbmAgY3ljbGUgKGNvbmZsaWN0IGxvZ2ljLCBjb25mbGljdCBjb3BpZXMpLlxuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyBjaGFuZ2VJc1NhZmUoY2hhbmdlOiBDaGFuZ2VNZXNzYWdlKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgaWYgKGNoYW5nZS5pc0ZvbGRlciA9PT0gdHJ1ZSkgcmV0dXJuIHRydWU7XG4gICAgaWYgKGNoYW5nZS5raW5kID09PSAncmVuYW1lJyAmJiBjaGFuZ2UuZnJvbVBhdGggIT09IHVuZGVmaW5lZCkge1xuICAgICAgaWYgKGF3YWl0IHRoaXMucGF0aEhhc0xvY2FsRGl2ZXJnZW5jZShjaGFuZ2UuZnJvbVBhdGgpKSByZXR1cm4gZmFsc2U7XG4gICAgICBpZiAoYXdhaXQgdGhpcy5zdG9yYWdlRXhpc3RzKGNoYW5nZS5wYXRoKSkge1xuICAgICAgICBjb25zdCBlbnRyeSA9IHRoaXMuaW5kZXhbY2hhbmdlLnBhdGhdO1xuICAgICAgICBpZiAoZW50cnkgPT09IHVuZGVmaW5lZCB8fCBlbnRyeS5kZWxldGVkQXQgIT09IHVuZGVmaW5lZCkgcmV0dXJuIGZhbHNlO1xuICAgICAgICBjb25zdCBhY3R1YWwgPSBhd2FpdCBzaGEyNTZIZXgoYXdhaXQgdGhpcy5vcHRpb25zLnN0b3JhZ2UucmVhZEZpbGUoY2hhbmdlLnBhdGgpKTtcbiAgICAgICAgaWYgKGFjdHVhbCAhPT0gZW50cnkuaGFzaCkgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIHJldHVybiAhKGF3YWl0IHRoaXMucGF0aEhhc0xvY2FsRGl2ZXJnZW5jZShjaGFuZ2UucGF0aCkpO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBwYXRoSGFzTG9jYWxEaXZlcmdlbmNlKHBhdGg6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5pbmRleFtwYXRoXTtcbiAgICBpZiAoZW50cnk/LmlzRm9sZGVyKSByZXR1cm4gZmFsc2U7XG4gICAgaWYgKCEoYXdhaXQgdGhpcy5zdG9yYWdlRXhpc3RzKHBhdGgpKSkgcmV0dXJuIGZhbHNlO1xuICAgIGlmIChlbnRyeSA9PT0gdW5kZWZpbmVkIHx8IGVudHJ5LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkKSByZXR1cm4gdHJ1ZTtcbiAgICBjb25zdCBhY3R1YWwgPSBhd2FpdCBzaGEyNTZIZXgoYXdhaXQgdGhpcy5vcHRpb25zLnN0b3JhZ2UucmVhZEZpbGUocGF0aCkpO1xuICAgIHJldHVybiBhY3R1YWwgIT09IGVudHJ5Lmhhc2g7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHN0b3JhZ2VFeGlzdHMocGF0aDogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLm9wdGlvbnMuc3RvcmFnZS5leGlzdHMocGF0aCk7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBwdWxsT3BGcm9tQ2hhbmdlKGNoYW5nZTogQ2hhbmdlTWVzc2FnZSk6IFB1bGxPcCB7XG4gICAgaWYgKGNoYW5nZS5raW5kID09PSAncmVuYW1lJyAmJiBjaGFuZ2UuZnJvbVBhdGggIT09IHVuZGVmaW5lZCkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAga2luZDogJ3JlbmFtZScsXG4gICAgICAgIGZyb21QYXRoOiBjaGFuZ2UuZnJvbVBhdGgsXG4gICAgICAgIHRvUGF0aDogY2hhbmdlLnBhdGgsXG4gICAgICAgIGhhc2g6IGNoYW5nZS5oYXNoLFxuICAgICAgICBzaXplOiBjaGFuZ2Uuc2l6ZSxcbiAgICAgICAgdmVyc2lvbjogY2hhbmdlLnZlcnNpb24sXG4gICAgICAgIGNsb2NrOiBjaGFuZ2UuY2xvY2ssXG4gICAgICB9O1xuICAgIH1cbiAgICBjb25zdCBlbnRyeSA9IHRoaXMuaW5kZXhbY2hhbmdlLnBhdGhdO1xuICAgIGNvbnN0IGtpbmQ6IFB1bGxGaWxlT3BbJ2tpbmQnXSA9IGNoYW5nZS5kZWxldGVkXG4gICAgICA/ICdkZWxldGUnXG4gICAgICA6IGVudHJ5ID09PSB1bmRlZmluZWRcbiAgICAgICAgPyAnYWRkJ1xuICAgICAgICA6IGVudHJ5LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkXG4gICAgICAgICAgPyAncmVzdG9yZSdcbiAgICAgICAgICA6ICdlZGl0JztcbiAgICByZXR1cm4ge1xuICAgICAga2luZCxcbiAgICAgIHBhdGg6IGNoYW5nZS5wYXRoLFxuICAgICAgaGFzaDogY2hhbmdlLmhhc2gsXG4gICAgICBzaXplOiBjaGFuZ2Uuc2l6ZSxcbiAgICAgIHZlcnNpb246IGNoYW5nZS52ZXJzaW9uLFxuICAgICAgY2xvY2s6IGNoYW5nZS5jbG9jayxcbiAgICAgIGRlbGV0ZWQ6IGNoYW5nZS5kZWxldGVkLFxuICAgICAgLi4uKGNoYW5nZS5pc0ZvbGRlciA9PT0gdHJ1ZSA/IHsgaXNGb2xkZXI6IHRydWUgfSA6IHt9KSxcbiAgICB9O1xuICB9XG5cbiAgLyoqIE1hdGVyaWFsaXplIHB1bGxzIHRocm91Z2ggdGhlIHZlcmlmaWVkIGVuZ2luZSBwYXRoOyByZXR1cm5zIHRoZSBuZXcgaW5kZXguICovXG4gIHByaXZhdGUgYXN5bmMgYXBwbHlQdWxscyhcbiAgICBwdWxsczogUmVhZG9ubHlBcnJheTxQdWxsT3A+LFxuICAgIHByb2dyZXNzPzogeyBvblByb2dyZXNzOiAoZG9uZTogbnVtYmVyLCB0b3RhbDogbnVtYmVyKSA9PiB2b2lkIH0sXG4gICk6IFByb21pc2U8TG9jYWxJbmRleD4ge1xuICAgIHJldHVybiBhcHBseVB1bGwoXG4gICAgICB0aGlzLm9wdGlvbnMuc3RvcmFnZSxcbiAgICAgIHRoaXMuaW5kZXgsXG4gICAgICB7IHB1c2hlczogW10sIHB1bGxzOiBbLi4ucHVsbHNdLCBjb25mbGljdHM6IFtdLCBmb2xkZXJQdXNoZXM6IFtdIH0sXG4gICAgICB0aGlzLmZldGNoQmxvYixcbiAgICAgIHtcbiAgICAgICAgbm93OiB0aGlzLm5vdygpLFxuICAgICAgICAvLyBLZWVwIHRoZSBlbnZlbG9wZSdzIGN1cnNvciBib29ra2VlcGluZyBpbnRhY3QgYWNyb3NzIHB1bGwtc2lkZVxuICAgICAgICAvLyBwZXJzaXN0cyAoYXBwbHlQdWxsIHJld3JpdGVzIHRoZSB3aG9sZSBzdGF0ZSBmaWxlKS5cbiAgICAgICAgcGVyc2lzdGVkU3RhdGU6IHRoaXMucGVyc2lzdGVkU3RhdGUoKSxcbiAgICAgICAgLi4uKHByb2dyZXNzICE9PSB1bmRlZmluZWQgPyB7IG9uUHJvZ3Jlc3M6IHByb2dyZXNzLm9uUHJvZ3Jlc3MgfSA6IHt9KSxcbiAgICAgIH0sXG4gICAgKTtcbiAgfVxuXG4gIC8qKiBUaGUgZW52ZWxvcGUgYm9va2tlZXBpbmcgd3JpdHRlbiB3aGVuZXZlciB0aGUgY2xpZW50IHBlcnNpc3RzIHRoZSBpbmRleC4gKi9cbiAgcHJpdmF0ZSBwZXJzaXN0ZWRTdGF0ZSgpOiBQZXJzaXN0ZWRTeW5jU3RhdGUge1xuICAgIHJldHVybiB7XG4gICAgICBjdXJzb3I6IHRoaXMuY3Vyc29yLFxuICAgICAgc3luY2VkVGhyb3VnaDogdGhpcy5zeW5jZWRUaHJvdWdoLFxuICAgICAgbmVlZHNGdWxsTWFuaWZlc3Q6IHRoaXMubmVlZHNGdWxsTWFuaWZlc3QsXG4gICAgfTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWNvcmQgb25lIGJ1bGstcGhhc2Ugc3RlcCBvbiBgc3RhdHVzKCkucHJvZ3Jlc3NgLiBDb2FsZXNjZWQgdG8gYXQgbW9zdFxuICAgKiBvbmUgdXBkYXRlIHBlciBgcHJvZ3Jlc3NUaHJvdHRsZU1zYCAocmVuZGVyZXIgY2h1cm4pLCBFWENFUFQgcGhhc2VcbiAgICogY2hhbmdlcyBhbmQgY29tcGxldGlvbnMsIHdoaWNoIGFsd2F5cyBlbWl0IHNvIGEgcGhhc2UgaXMgbmV2ZXIgbWlzc2VkXG4gICAqIGFuZCBgZG9uZS90b3RhbGAgYWx3YXlzIGxhbmRzIG9uIGl0cyBmaW5hbCB2YWx1ZS5cbiAgICovXG4gIHByaXZhdGUgZW1pdFByb2dyZXNzKHBoYXNlOiBTeW5jUGhhc2UsIGRvbmU6IG51bWJlciwgdG90YWw6IG51bWJlcik6IHZvaWQge1xuICAgIGlmICh0b3RhbCA9PT0gMCkgcmV0dXJuOyAvLyBub3RoaW5nIHRvIHNob3cgZm9yIGFuIGVtcHR5IHBoYXNlXG4gICAgY29uc3Qgbm93ID0gdGhpcy5ub3coKTtcbiAgICBjb25zdCBjb21wbGV0ZSA9IGRvbmUgPj0gdG90YWw7XG4gICAgY29uc3QgcGhhc2VDaGFuZ2VkID0gdGhpcy5wcm9ncmVzcz8ucGhhc2UgIT09IHBoYXNlO1xuICAgIGlmICghY29tcGxldGUgJiYgIXBoYXNlQ2hhbmdlZCAmJiBub3cgLSB0aGlzLmxhc3RQcm9ncmVzc0F0IDwgdGhpcy5wcm9ncmVzc1Rocm90dGxlTXMpIHJldHVybjtcbiAgICB0aGlzLmxhc3RQcm9ncmVzc0F0ID0gbm93O1xuICAgIHRoaXMucHJvZ3Jlc3MgPSB7IHBoYXNlLCBkb25lLCB0b3RhbCB9O1xuICB9XG5cbiAgLy8gLS0tIHdhdGNoZXIgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgcHJpdmF0ZSBvbldhdGNoRXZlbnRzKGV2ZW50czogUmVhZG9ubHlBcnJheTx7IHBhdGg6IHN0cmluZyB9Pik6IHZvaWQge1xuICAgIGNvbnN0IHJlbGV2YW50ID0gZXZlbnRzLmZpbHRlcigoZXZlbnQpID0+ICFpc0lnbm9yZWQoZXZlbnQucGF0aCwgdGhpcy5pZ25vcmVTZXR0aW5ncykpO1xuICAgIGlmIChyZWxldmFudC5sZW5ndGggPT09IDApIHJldHVybjtcbiAgICB0aGlzLnBlbmRpbmcgKz0gcmVsZXZhbnQubGVuZ3RoO1xuICAgIHRoaXMuc2NoZWR1bGVSZWNvbmNpbGUoKTtcbiAgfVxuXG4gIC8qKiBEZWJvdW5jZWQgc2Nhblx1MjE5MnBsYW5cdTIxOTJleGVjdXRlIChzaGFyZWQgYnkgd2F0Y2hlciBhbmQgZGVmZXJyZWQgY2hhbmdlcykuICovXG4gIHByaXZhdGUgc2NoZWR1bGVSZWNvbmNpbGUoKTogdm9pZCB7XG4gICAgdGhpcy5jYW5jZWxEZWJvdW5jZT8uKCk7XG4gICAgdGhpcy5jYW5jZWxEZWJvdW5jZSA9IHRoaXMuc2NoZWR1bGUoKCkgPT4ge1xuICAgICAgdGhpcy5jYW5jZWxEZWJvdW5jZSA9IG51bGw7XG4gICAgICB0aGlzLmVucXVldWUoKCkgPT4gdGhpcy5ydW5DeWNsZSgpKS5jYXRjaCgoZXJyb3I6IHVua25vd24pID0+XG4gICAgICAgIHRoaXMubG9nLndhcm4oJ2RlYm91bmNlZCBzeW5jIGN5Y2xlIGZhaWxlZCcsIGVycm9yKSxcbiAgICAgICk7XG4gICAgfSwgdGhpcy5kZWJvdW5jZU1zKTtcbiAgfVxuXG4gIC8vIC0tLSB0aGUgc3luYyBjeWNsZSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuQ3ljbGUoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKHRoaXMudHJhbnNwb3J0ID09PSBudWxsIHx8IHRoaXMuaXNEaXNjb25uZWN0ZWQoKSkgcmV0dXJuO1xuICAgIHRoaXMuc3RhdGUgPSAnc3luY2luZyc7XG4gICAgdGhpcy5wcm9ncmVzcyA9IG51bGw7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IG1hbmlmZXN0ID0gYXdhaXQgdGhpcy5mZXRjaE1hbmlmZXN0KCk7XG4gICAgICBjb25zdCBsb2NhbENoYW5nZXMgPSBhd2FpdCBzY2FuVmF1bHQoXG4gICAgICAgIHRoaXMub3B0aW9ucy5zdG9yYWdlLFxuICAgICAgICB0aGlzLmluZGV4LFxuICAgICAgICB0aGlzLmlnbm9yZVNldHRpbmdzLFxuICAgICAgICB0aGlzLm5vdygpLFxuICAgICAgICB7XG4gICAgICAgICAgb25Qcm9ncmVzczogKGRvbmUsIHRvdGFsKSA9PiB0aGlzLmVtaXRQcm9ncmVzcygnc2Nhbm5pbmcnLCBkb25lLCB0b3RhbCksXG4gICAgICAgICAgLy8gU2hhcnBlbnMgdGhlIHN0YWxlRGlycyBydWxlOiBhbiBlbXB0eSBkaXIgb3ZlciBhIHRvbWJzdG9uZSBUSElTXG4gICAgICAgICAgLy8gZGV2aWNlIGF1dGhvcmVkIGlzIGEgbG9jYWwgcmVjcmVhdGlvbiwgbm90IGEgZGVsZXRpb24gcmVzaWR1ZS5cbiAgICAgICAgICB0aGlzRGV2aWNlSWQ6IHRoaXMub3B0aW9ucy5kZXZpY2VJZCxcbiAgICAgICAgfSxcbiAgICAgICk7XG4gICAgICBjb25zdCBwbGFuID0gY29tcHV0ZVN5bmNQbGFuKHtcbiAgICAgICAgbG9jYWxDaGFuZ2VzLFxuICAgICAgICBpbmRleDogdGhpcy5pbmRleCxcbiAgICAgICAgbWFuaWZlc3QsXG4gICAgICAgIHRoaXNEZXZpY2VJZDogdGhpcy5vcHRpb25zLmRldmljZUlkLFxuICAgICAgICB0aGlzRGV2aWNlTmFtZTogdGhpcy5vcHRpb25zLmRldmljZU5hbWUsXG4gICAgICAgIG5vdzogdGhpcy5ub3coKSxcbiAgICAgIH0pO1xuICAgICAgLy8gQ29uZmxpY3RzIHJlZmxlY3QgdGhlIGxhdGVzdCBwbGFuOiBlbnRyaWVzIGZvciBwYXRocyBubyBsb25nZXJcbiAgICAgIC8vIGNvbnRlc3RlZCBhcmUgZHJvcHBlZCAoYSBjeWNsZSB0aGF0IHBsYW5zIGNsZWFuIGNsZWFycyB0aGUgbGlzdCksIHNvXG4gICAgICAvLyBhIHN5bmNlZC1xdWlldCBjbGllbnQgcmVwb3J0cyAwIHdoaWxlIHN0aWxsLWNvbnRlc3RlZCBwYXRocyBzdGF5XG4gICAgICAvLyB2aXNpYmxlIHVudGlsIGEgY3ljbGUgYWN0dWFsbHkgcmVzb2x2ZXMgdGhlbS5cbiAgICAgIHRoaXMuY29uZmxpY3RzID0gWy4uLnBsYW4uY29uZmxpY3RzXTtcblxuICAgICAgLy8gU3RhZ2UgcHVzaCBjb250ZW50cyBCRUZPUkUgcHVsbHMgb3ZlcndyaXRlIHRoZSB3b3JraW5nIHRyZWUgKGFcbiAgICAgIC8vIGNvbmZsaWN0LWNvcHkgcHVzaCByZWFkcyB0aGUgbG9zZXIgY29udGVudCBmcm9tIHRoZSBvcmlnaW5hbCBwYXRoKS5cbiAgICAgIGNvbnN0IHN0YWdlZCA9IGF3YWl0IHRoaXMuc3RhZ2VQdXNoZXMocGxhbiwgbG9jYWxDaGFuZ2VzLmhhc2hlZCk7XG5cbiAgICAgIHRoaXMuaW5kZXggPSBhd2FpdCB0aGlzLmFwcGx5UHVsbHMocGxhbi5wdWxscywge1xuICAgICAgICBvblByb2dyZXNzOiAoZG9uZSwgdG90YWwpID0+IHRoaXMuZW1pdFByb2dyZXNzKCdwdWxsaW5nJywgZG9uZSwgdG90YWwpLFxuICAgICAgfSk7XG5cbiAgICAgIC8vIFB1c2ggcGlwZWxpbmU6IHVwIHRvIGBwdXNoQ29uY3VycmVuY3lgIGNvbW1pdHMgaW4gZmxpZ2h0OyBhY2tzIGZvbGRcbiAgICAgIC8vIGludG8gdGhlIGluZGV4IGFzIHRoZXkgYXJyaXZlIChzZXJpYWxpemVkIHRocm91Z2ggYGFja0NoYWluYCkuXG4gICAgICAvLyBCbG9iIHVwbG9hZHMgZm9yID4yNTZLQiBmaWxlcyBzdGFydCBpbnNpZGUgdGhlaXIgc2xvdCBhbmQgb3ZlcmxhcFxuICAgICAgLy8gd2l0aCB0aGUgT1RIRVIgc2xvdHMnIGluLWZsaWdodCBjb21taXRzIGluc3RlYWQgb2Ygc2VyaWFsaXppbmcuXG4gICAgICBjb25zdCBwdXNoVG90YWwgPSBzdGFnZWQubGVuZ3RoICsgcGxhbi5mb2xkZXJQdXNoZXMubGVuZ3RoO1xuICAgICAgbGV0IHB1c2hEb25lID0gMDtcbiAgICAgIGNvbnN0IHNldHRsZVB1c2ggPSAoKTogdm9pZCA9PiB7XG4gICAgICAgIHB1c2hEb25lICs9IDE7XG4gICAgICAgIHRoaXMuZW1pdFByb2dyZXNzKCdwdXNoaW5nJywgcHVzaERvbmUsIHB1c2hUb3RhbCk7XG4gICAgICB9O1xuICAgICAgdGhpcy5lbWl0UHJvZ3Jlc3MoJ3B1c2hpbmcnLCAwLCBwdXNoVG90YWwpO1xuICAgICAgYXdhaXQgdGhpcy5ydW5QdXNoUGlwZWxpbmUoc3RhZ2VkLCBzZXR0bGVQdXNoKTtcblxuICAgICAgLy8gUHJ1bmUtb24tZGVsZXRlIChDKSwgbG9jYWwgc2lkZTogZXZlcnkgZGVsZXRpb24gdGhhdCBhY3R1YWxseVxuICAgICAgLy8gY29tbWl0dGVkIHRoaXMgY3ljbGUgKHRoZSBpbmRleCBub3cgdG9tYnN0b25lcyBpdCAvIG1pZ3JhdGVkIGl0IGF3YXkpXG4gICAgICAvLyBtYXkgaGF2ZSBlbXB0aWVkIGl0cyBwYXJlbnQgZGlyZWN0b3J5LiBSZW1vdmUgc3VjaCBkaXJlY3RvcmllcyBcdTIwMTRcbiAgICAgIC8vIEJFRk9SRSB0aGUgcGxhY2Vob2xkZXIgcHVzaGVzIGJlbG93LCBzbyBhbiBlbXB0aWVkIGRpcmVjdG9yeSBpcyBub3RcbiAgICAgIC8vIGltbWVkaWF0ZWx5IHJlLXB1c2hlZCBhcyBhbiBlbXB0eS1mb2xkZXIgcGxhY2Vob2xkZXIuXG4gICAgICBjb25zdCBlbXB0aWVkRGlycyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICAgICAgZm9yIChjb25zdCBjb21taXQgb2Ygc3RhZ2VkKSB7XG4gICAgICAgIC8vIFRoZSBwYXRoIHRoYXQgY2Vhc2VkIHRvIGV4aXN0LCBJRiBpdHMgY29tbWl0IGFjdHVhbGx5IGxhbmRlZFxuICAgICAgICAvLyAodG9tYnN0b25lZCBpbiB0aGUgaW5kZXggZm9yIGRlbGV0ZXM7IG1pZ3JhdGVkIGF3YXkgZm9yIHJlbmFtZXMgXHUyMDE0XG4gICAgICAgIC8vIGEgZGVsZXRlIHRoYXQgbG9zdCBpdHMgcmFjZSB0byBhIHJlbW90ZSBlZGl0IGlzIG5vdCBhIGRlbGV0aW9uKS5cbiAgICAgICAgbGV0IGNlYXNlZFBhdGg6IHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgICAgICAgaWYgKGNvbW1pdC5raW5kID09PSAnZGVsZXRlJyAmJiBjb21taXQuaXNGb2xkZXIgIT09IHRydWUpIHtcbiAgICAgICAgICBpZiAodGhpcy5pbmRleFtjb21taXQucGF0aF0/LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkKSBjZWFzZWRQYXRoID0gY29tbWl0LnBhdGg7XG4gICAgICAgIH0gZWxzZSBpZiAoY29tbWl0LmtpbmQgPT09ICdyZW5hbWUnICYmIGNvbW1pdC5mcm9tUGF0aCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgaWYgKCEoY29tbWl0LmZyb21QYXRoIGluIHRoaXMuaW5kZXgpKSBjZWFzZWRQYXRoID0gY29tbWl0LmZyb21QYXRoO1xuICAgICAgICB9XG4gICAgICAgIGlmIChjZWFzZWRQYXRoID09PSB1bmRlZmluZWQpIGNvbnRpbnVlO1xuICAgICAgICBjb25zdCBwcnVuZWQgPSBhd2FpdCBwcnVuZVBhcmVudE9uRGVsZXRlKHRoaXMub3B0aW9ucy5zdG9yYWdlLCB0aGlzLmluZGV4LCBjZWFzZWRQYXRoKTtcbiAgICAgICAgaWYgKHBydW5lZCA9PT0gdW5kZWZpbmVkKSBjb250aW51ZTtcbiAgICAgICAgZW1wdGllZERpcnMuYWRkKHBydW5lZC5kaXIpO1xuICAgICAgICBjb25zdCBwbGFjZWhvbGRlciA9IHRoaXMuaW5kZXhbcHJ1bmVkLmRpcl07XG4gICAgICAgIGlmIChwbGFjZWhvbGRlcj8uaXNGb2xkZXIgJiYgcGxhY2Vob2xkZXIuZGVsZXRlZEF0ID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICAvLyBXZSBqdXN0IHJlbW92ZWQgdGhlIGRpcmVjdG9yeSBhIGxpdmUgcGxhY2Vob2xkZXIgc3RpbGwgY2xhaW1zOlxuICAgICAgICAgIC8vIHNjYW4gYWdhaW4gc28gdGhlIHBsYWNlaG9sZGVyIGlzIHRvbWJzdG9uZWQgYW5kIHByb3BhZ2F0ZXMuXG4gICAgICAgICAgdGhpcy5zY2hlZHVsZVJlY29uY2lsZSgpO1xuICAgICAgICB9XG4gICAgICB9XG5cbiAgICAgIC8vIFN0YWxlLWxlZnRvdmVyIGNsZWFudXAgKEYtMSk6IGEgdG9tYnN0b25lZCBmb2xkZXIgcGxhY2Vob2xkZXIgd2hvc2VcbiAgICAgIC8vIEVNUFRZIGRpcmVjdG9yeSBzdGlsbCBleGlzdHMgb24gZGlzayBcdTIwMTQgdGhlIHJlc2lkdWUgb2YgYSByZWNvcmQtb25seVxuICAgICAgLy8gdG9tYnN0b25lIGFwcGxpY2F0aW9uIChhbiBhZGFwdGVyIHdpdGhvdXQgYHJlbW92ZURpcmAsIG9yIGEgcmVtb3ZhbFxuICAgICAgLy8gdGhhdCBsb3N0IGEgcmFjZSkuIFRoZSBzY2FuIGRlbGliZXJhdGVseSBjbGFzc2lmaWVzIHRoZXNlIGFzXG4gICAgICAvLyBgc3RhbGVEaXJzYCBpbnN0ZWFkIG9mIGBlbXB0eUZvbGRlcnNgLCBzbyBub3RoaW5nIGJlbG93IHJlLXB1c2hlc1xuICAgICAgLy8gdGhlbSBhcyBwbGFjZWhvbGRlcnMgKHRoYXQgcmUtcHVzaCByZXN1cnJlY3RlZCBkZWxldGVkIGZvbGRlcnMgYW5kXG4gICAgICAvLyBwaW5nLXBvbmdlZCB0aGUgZGVsZXRpb24gYmV0d2VlbiBkZXZpY2VzKS4gUmV0cnlpbmcgdGhlIHJlbW92YWwgaGVyZVxuICAgICAgLy8gY29udmVyZ2VzIHN0b3JhZ2Ugb250byB0aGUgdG9tYnN0b25lLlxuICAgICAgZm9yIChjb25zdCBkaXIgb2YgbG9jYWxDaGFuZ2VzLnN0YWxlRGlycyA/PyBbXSkge1xuICAgICAgICBhd2FpdCByZW1vdmVEaXJJZlZhY2FudCh0aGlzLm9wdGlvbnMuc3RvcmFnZSwgdGhpcy5pbmRleCwgZGlyKTtcbiAgICAgIH1cblxuICAgICAgY29uc3QgZm9sZGVyQ29tbWl0czogU3RhZ2VkQ29tbWl0W10gPSBbXTtcbiAgICAgIGZvciAoY29uc3QgcGF0aCBvZiBwbGFuLmZvbGRlclB1c2hlcykge1xuICAgICAgICAvLyBOZXZlciByZXN1cnJlY3QgYSBkaXJlY3RvcnkgdGhpcyBjeWNsZSBlbXB0aWVkIChkZWxldGUtZGVyaXZlZFxuICAgICAgICAvLyBwbGFjZWhvbGRlcnMgYXJlIHN1cHByZXNzZWQgZXZlbiB3aGVuIHJlbW92YWwgaXRzZWxmIHdhcyBub3RcbiAgICAgICAgLy8gcG9zc2libGUpLCBub3IgcHVzaCBvbmUgdGhhdCB2YW5pc2hlZCBzaW5jZSB0aGUgc2Nhbi5cbiAgICAgICAgaWYgKGVtcHRpZWREaXJzLmhhcyhwYXRoKSkgY29udGludWU7XG4gICAgICAgIGlmICghKGF3YWl0IHRoaXMuc3RvcmFnZUV4aXN0cyhwYXRoKSkpIGNvbnRpbnVlO1xuICAgICAgICBmb2xkZXJDb21taXRzLnB1c2goe1xuICAgICAgICAgIGtpbmQ6ICdlZGl0JyxcbiAgICAgICAgICBwYXRoLFxuICAgICAgICAgIHBhcmVudFZlcnNpb246IHRoaXMuaW5kZXhbcGF0aF0/LnZlcnNpb25JZCA/PyBudWxsLFxuICAgICAgICAgIGhhc2g6ICcnLFxuICAgICAgICAgIHNpemU6IDAsXG4gICAgICAgICAgaXNGb2xkZXI6IHRydWUsXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgYXdhaXQgdGhpcy5ydW5QdXNoUGlwZWxpbmUoZm9sZGVyQ29tbWl0cywgc2V0dGxlUHVzaCk7XG5cbiAgICAgIC8vIENhY2hlIHRoZSBzY2FuJ3MgaGFzaCBvYnNlcnZhdGlvbnMgKG10aW1lKSBvbnRvIGVudHJpZXMgd2hvc2UgaGFzaFxuICAgICAgLy8gc3RpbGwgbWF0Y2hlcywgc28gdGhlIG5leHQgZmFzdCBzY2FuIGNhbiBza2lwIHRob3NlIGZpbGVzLiBSdW5zXG4gICAgICAvLyBhZnRlciBwdWxscy9wdXNoZXMgc28gZnJlc2hseS1hY2tlZCBlbnRyaWVzIGJlbmVmaXQgaW1tZWRpYXRlbHk7XG4gICAgICAvLyBgcmVjb3JkSGFzaGVkRmlsZXNgIHNraXBzIGFueXRoaW5nIHRoZSBjeWNsZSBjaGFuZ2VkIHVuZGVybmVhdGggdXMuXG4gICAgICB0aGlzLmluZGV4ID0gcmVjb3JkSGFzaGVkRmlsZXModGhpcy5pbmRleCwgbG9jYWxDaGFuZ2VzLmhhc2hlZCk7XG5cbiAgICAgIC8vIFRoZSBjeWNsZSBmaW5pc2hlZCBjbGVhbjogZXZlcnkgcHVsbCBvZiB0aGUgbWFuaWZlc3QgYXBwbGllZCwgZXZlcnlcbiAgICAgIC8vIHN0YWdlZCBjb21taXQgYWNrZWQuIFRoZSBpbmRleCBpcyBub3cgY29tcGxldGUgdGhyb3VnaCB0aGUgTUFOSUZFU1Qnc1xuICAgICAgLy8gZmV0Y2gtdGltZSBjdXJzb3IgKGRlbGliZXJhdGVseSBub3QgdGhlIGxhdGVyIGFjayBzZXFzIFx1MjAxNCBhIGNvbmN1cnJlbnRcbiAgICAgIC8vIGRldmljZSdzIGNoYW5nZSBjYW4gaW50ZXJsZWF2ZSBhbmQgcmlkZSB0aGUgcG9zdC1jeWNsZSBkaXNwYXRjaFxuICAgICAgLy8gcXVldWUpLCB3aGljaCBpcyB3aGF0IG1ha2VzIHRoZSBuZXh0IGRlbHRhIG1hbmlmZXN0IHNhZmUuXG4gICAgICBpZiAodGhpcy5tYW5pZmVzdEN1cnNvck9mQ3ljbGUgIT09IG51bGwgJiYgdGhpcy5tYW5pZmVzdEN1cnNvck9mQ3ljbGUgPiAodGhpcy5zeW5jZWRUaHJvdWdoID8/IDApKSB7XG4gICAgICAgIHRoaXMuc3luY2VkVGhyb3VnaCA9IHRoaXMubWFuaWZlc3RDdXJzb3JPZkN5Y2xlO1xuICAgICAgfVxuICAgICAgdGhpcy5tYW5pZmVzdEN1cnNvck9mQ3ljbGUgPSBudWxsO1xuICAgICAgdGhpcy5uZWVkc0Z1bGxNYW5pZmVzdCA9IGZhbHNlO1xuXG4gICAgICB0aGlzLmxhc3RTeW5jQXQgPSB0aGlzLm5vdygpO1xuICAgICAgdGhpcy5wZW5kaW5nID0gMDtcbiAgICAgIGlmICghdGhpcy5pc0Rpc2Nvbm5lY3RlZCgpKSB0aGlzLnN0YXRlID0gJ2xpdmUnO1xuICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICB0aGlzLm1hbmlmZXN0Q3Vyc29yT2ZDeWNsZSA9IG51bGw7XG4gICAgICB0aGlzLmxvZy5lcnJvcignc3luYyBjeWNsZSBmYWlsZWQnLCBlcnJvcik7XG4gICAgICBpZiAoIXRoaXMuaXNEaXNjb25uZWN0ZWQoKSkgdGhpcy5zdGF0ZSA9IHRoaXMudHJhbnNwb3J0ICE9PSBudWxsID8gJ2xpdmUnIDogJ2lkbGUnO1xuICAgICAgdGhyb3cgZXJyb3I7XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMucHJvZ3Jlc3MgPSBudWxsO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBUaGUgbWFuaWZlc3QncyBmZXRjaC10aW1lIGN1cnNvciBmb3IgdGhlIFJVTk5JTkcgY3ljbGUgXHUyMDE0IHRoZSBjb21wbGV0aW9uXG4gICAqIHdhdGVybWFyayBhIHN1Y2Nlc3NmdWwgY3ljbGUgcmVjb3JkcyBpbnRvIGBzeW5jZWRUaHJvdWdoYCAoc2VlIHRoZVxuICAgKiBjb21tZW50IHRoZXJlKS4gTnVsbCBvdXRzaWRlIGN5Y2xlcy5cbiAgICovXG4gIHByaXZhdGUgbWFuaWZlc3RDdXJzb3JPZkN5Y2xlOiBudW1iZXIgfCBudWxsID0gbnVsbDtcblxuICAvKipcbiAgICogV2hldGhlciBUSElTIGN5Y2xlIG1heSByZXF1ZXN0IGEgZGVsdGEgbWFuaWZlc3QuIEFsbCBmb3VyIGdhdGVzIG11c3RcbiAgICogaG9sZCAoYW55IGZhaWx1cmUgXHUyMUQyIGZ1bGwgbWFuaWZlc3QsIHRvZGF5J3MgYmVoYXZpb3IpOlxuICAgKlxuICAgKiAgMS4gYGN1cnNvciA+IDBgIFx1MjAxNCBhIGZpcnN0LWV2ZXIgY29ubmVjdCBrbm93cyBub3RoaW5nOyBmdWxsIG1hbmlmZXN0LlxuICAgKiAgMi4gYHN5bmNlZFRocm91Z2ggIT09IG51bGxgIFx1MjAxNCBzb21lIGZ1bGwtbWFuaWZlc3QgY3ljbGUgY29tcGxldGVkLCBzbyB0aGVcbiAgICogICAgIGluZGV4IGlzIENPTVBMRVRFIHRocm91Z2ggaXQ7IGhlYWRzIGFmdGVyIGl0IGFycml2ZSB2aWEgcmVwbGF5ICtcbiAgICogICAgIGRlbHRhLiBBbiBpbnRlcnJ1cHRlZCBpbml0aWFsIHN5bmMgbmV2ZXIgc2V0cyBpdCBcdTIxRDIgZnVsbCBtYW5pZmVzdC5cbiAgICogIDMuIGAhbmVlZHNGdWxsTWFuaWZlc3RgIFx1MjAxNCBubyBkZWZlcnJlZCBkaXZlcmdlbmNlIGF3YWl0cyBwbGFuIHJlc29sdXRpb24uXG4gICAqICA0LiBSZXBsYXkgd2luZG93IGludGFjdCBcdTIwMTQgaGVsbG9BY2sgcmVwb3J0ZWQgYG9sZGVzdFJldGFpbmVkU2VxIDw9XG4gICAqICAgICBjdXJzb3IgKyAxYCwgc28gZXZlcnkgZXZlbnQgYWZ0ZXIgb3VyIGN1cnNvciBpcyBzdGlsbCBvbiB0aGUgc2VydmVyLlxuICAgKi9cbiAgcHJpdmF0ZSBzaG91bGRSZXF1ZXN0RGVsdGFNYW5pZmVzdCgpOiBib29sZWFuIHtcbiAgICByZXR1cm4gKFxuICAgICAgdGhpcy5jdXJzb3IgPiAwICYmXG4gICAgICB0aGlzLnN5bmNlZFRocm91Z2ggIT09IG51bGwgJiZcbiAgICAgICF0aGlzLm5lZWRzRnVsbE1hbmlmZXN0ICYmXG4gICAgICB0aGlzLnNlcnZlck9sZGVzdFJldGFpbmVkU2VxICE9PSBudWxsICYmXG4gICAgICB0aGlzLnNlcnZlck9sZGVzdFJldGFpbmVkU2VxIDw9IHRoaXMuY3Vyc29yICsgMVxuICAgICk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGZldGNoTWFuaWZlc3QoKTogUHJvbWlzZTxSZW1vdGVGaWxlW10+IHtcbiAgICBjb25zdCB0cmFuc3BvcnQgPSB0aGlzLnRyYW5zcG9ydDtcbiAgICBpZiAodHJhbnNwb3J0ID09PSBudWxsKSB0aHJvdyBuZXcgTmV0d29ya0Vycm9yKCdub3QgY29ubmVjdGVkJyk7XG4gICAgY29uc3QgdXNlRGVsdGEgPSB0aGlzLnNob3VsZFJlcXVlc3REZWx0YU1hbmlmZXN0KCk7XG4gICAgY29uc3Qgc2luY2UgPSB1c2VEZWx0YSAmJiB0aGlzLnN5bmNlZFRocm91Z2ggIT09IG51bGwgPyB0aGlzLnN5bmNlZFRocm91Z2ggOiB1bmRlZmluZWQ7XG4gICAgY29uc3QgcmVwbHkgPSBhd2FpdCB0aGlzLnJlcXVlc3Q8TWFuaWZlc3RNZXNzYWdlIHwgU2VydmVyRXJyb3JNZXNzYWdlPihcbiAgICAgIChtKSA9PiBtLnR5cGUgPT09ICdtYW5pZmVzdCcgfHwgbS50eXBlID09PSAnZXJyb3InLFxuICAgICAgKCkgPT4gdHJhbnNwb3J0LnNlbmQoeyB0eXBlOiAnZ2V0TWFuaWZlc3QnLCAuLi4oc2luY2UgIT09IHVuZGVmaW5lZCA/IHsgc2luY2UgfSA6IHt9KSB9KSxcbiAgICApO1xuICAgIGlmIChyZXBseS50eXBlID09PSAnZXJyb3InKSB0aHJvdyB0aGlzLnRvRXJyb3IocmVwbHkpO1xuICAgIGlmIChyZXBseS5jdXJzb3IgPiB0aGlzLmN1cnNvcikgdGhpcy5jdXJzb3IgPSByZXBseS5jdXJzb3I7XG4gICAgdGhpcy5tYW5pZmVzdEN1cnNvck9mQ3ljbGUgPSByZXBseS5jdXJzb3I7XG4gICAgaWYgKCF1c2VEZWx0YSkge1xuICAgICAgcmV0dXJuIE9iamVjdC52YWx1ZXMocmVwbHkuZW50cmllcykubWFwKChlbnRyeSkgPT4gKHsgLi4uZW50cnkgfSkpO1xuICAgIH1cbiAgICAvLyBEZWx0YTogbWVyZ2UgdGhlIGNoYW5nZWQgaGVhZHMgb3ZlciBhbiBJTkRFWCBQUk9KRUNUSU9OIG9mIHRoZSBmdWxsXG4gICAgLy8gbWFuaWZlc3QuIGNvbXB1dGVTeW5jUGxhbiBuZWVkcyB0aGUgY29tcGxldGUgcmVtb3RlIHZpZXcgXHUyMDE0IFBoYXNlIEJcbiAgICAvLyB0cmVhdHMgYW4gaW5kZXggcGF0aCBhYnNlbnQgZnJvbSB0aGUgbWFuaWZlc3QgYXMgXCJtaWdyYXRlZCBhd2F5XCIgXHUyMDE0IGFuZFxuICAgIC8vIGVsaWdpYmlsaXR5IGd1YXJhbnRlZXMgdGhlIGluZGV4IGFscmVhZHkgYWdyZWVzIHdpdGggdGhlIHNlcnZlciBmb3JcbiAgICAvLyBldmVyeSBwYXRoIHRoZSBkZWx0YSBvbWl0cyAoaGVhZHMgXHUyMjY0IHN5bmNlZFRocm91Z2gpLiBQcm9qZWN0aW5nIGVudHJpZXNcbiAgICAvLyB0byB0aGVpciBpbmRleCBzdGF0ZSB0aGVyZWZvcmUgcmVjb25zdHJ1Y3RzIGV4YWN0bHkgd2hhdCB0aGUgZnVsbFxuICAgIC8vIG1hbmlmZXN0IHdvdWxkIGhhdmUgc2FpZCwgYXQgTyhjaGFuZ2VzKSBpbnN0ZWFkIG9mIE8odmF1bHQpLlxuICAgIGNvbnN0IG1lcmdlZCA9IG5ldyBNYXA8c3RyaW5nLCBSZW1vdGVGaWxlPigpO1xuICAgIGZvciAoY29uc3QgW3BhdGgsIGVudHJ5XSBvZiBPYmplY3QuZW50cmllcyh0aGlzLmluZGV4KSkge1xuICAgICAgbWVyZ2VkLnNldChwYXRoLCB7XG4gICAgICAgIHBhdGgsXG4gICAgICAgIHZlcnNpb246IGVudHJ5LnZlcnNpb25JZCxcbiAgICAgICAgaGFzaDogZW50cnkuaGFzaCxcbiAgICAgICAgc2l6ZTogZW50cnkuc2l6ZSxcbiAgICAgICAgZGVsZXRlZDogZW50cnkuZGVsZXRlZEF0ICE9PSB1bmRlZmluZWQsXG4gICAgICAgIGNsb2NrOiBlbnRyeS5jbG9jayxcbiAgICAgICAgLi4uKGVudHJ5LmlzRm9sZGVyID8geyBpc0ZvbGRlcjogdHJ1ZSB9IDoge30pLFxuICAgICAgICBtdGltZTogZW50cnkubXRpbWUgPz8gMCxcbiAgICAgIH0pO1xuICAgIH1cbiAgICBmb3IgKGNvbnN0IFtwYXRoLCBlbnRyeV0gb2YgT2JqZWN0LmVudHJpZXMocmVwbHkuZW50cmllcykpIHtcbiAgICAgIG1lcmdlZC5zZXQocGF0aCwgeyAuLi5lbnRyeSB9KTtcbiAgICB9XG4gICAgcmV0dXJuIFsuLi5tZXJnZWQudmFsdWVzKCldO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBzdGFnZVB1c2hlcyhcbiAgICBwbGFuOiBTeW5jUGxhbixcbiAgICBoYXNoZWQ6IHJlYWRvbmx5IEhhc2hlZEZpbGVbXSxcbiAgKTogUHJvbWlzZTxTdGFnZWRDb21taXRbXT4ge1xuICAgIC8vIEEgY29uZmxpY3QtY29weSBwdXNoIGNhcnJpZXMgY29udGVudCByZWFkIGZyb20gdGhlICpvcmlnaW5hbCogcGF0aC5cbiAgICBjb25zdCBjb3B5U291cmNlcyA9IG5ldyBNYXA8c3RyaW5nLCBzdHJpbmc+KCk7XG4gICAgZm9yIChjb25zdCBjb25mbGljdCBvZiBwbGFuLmNvbmZsaWN0cykge1xuICAgICAgaWYgKGNvbmZsaWN0LmNvbmZsaWN0Q29weVBhdGggIT09IHVuZGVmaW5lZCkge1xuICAgICAgICBjb3B5U291cmNlcy5zZXQoY29uZmxpY3QuY29uZmxpY3RDb3B5UGF0aCwgY29uZmxpY3QucGF0aCk7XG4gICAgICB9XG4gICAgfVxuICAgIC8vIEhhc2gtdGltZSBzdGF0cyBieSBwYXRoOiBwaW5uaW5nIHRoZXNlIG9udG8gdGhlIGFja2VkIGVudHJpZXMgKGJlbG93KVxuICAgIC8vIGtlZXBzIHRoZSBmYXN0LXBhdGggY2FjaGUgaG9uZXN0IFx1MjAxNCBzZWUgYFN0YWdlZENvbW1pdC5tdGltZWAuXG4gICAgY29uc3QgaGFzaFRpbWVNdGltZSA9IG5ldyBNYXAoaGFzaGVkLm1hcCgob2JzZXJ2ZWQpID0+IFtvYnNlcnZlZC5wYXRoLCBvYnNlcnZlZC5tdGltZV0pKTtcblxuICAgIGNvbnN0IHN0YWdlZDogU3RhZ2VkQ29tbWl0W10gPSBbXTtcbiAgICBmb3IgKGNvbnN0IHB1c2ggb2YgcGxhbi5wdXNoZXMpIHtcbiAgICAgIGlmIChwdXNoLmtpbmQgPT09ICdkZWxldGUnIHx8IHB1c2gua2luZCA9PT0gJ3JlbmFtZScpIHtcbiAgICAgICAgc3RhZ2VkLnB1c2godGhpcy50b1N0YWdlZChwdXNoKSk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3Qgc291cmNlUGF0aCA9XG4gICAgICAgIHB1c2gua2luZCA9PT0gJ2NvbmZsaWN0Q29weScgPyBjb3B5U291cmNlcy5nZXQocHVzaC5wYXRoKSA/PyBwdXNoLnBhdGggOiBwdXNoLnBhdGg7XG4gICAgICBjb25zdCBieXRlcyA9IGF3YWl0IHRoaXMucmVhZExvY2FsKHNvdXJjZVBhdGgpO1xuICAgICAgaWYgKGJ5dGVzID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgdGhpcy5sb2cud2FybigncHVzaCBzb3VyY2UgdmFuaXNoZWQgc2luY2Ugc2NhbjsgZGVmZXJyaW5nJywgcHVzaC5wYXRoKTtcbiAgICAgICAgdGhpcy5zY2hlZHVsZVJlY29uY2lsZSgpO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IGhhc2ggPSBhd2FpdCBzaGEyNTZIZXgoYnl0ZXMpO1xuICAgICAgaWYgKGhhc2ggIT09IHB1c2guaGFzaCB8fCBieXRlcy5ieXRlTGVuZ3RoICE9PSBwdXNoLnNpemUpIHtcbiAgICAgICAgdGhpcy5sb2cud2FybignbG9jYWwgY29udGVudCBkcmlmdGVkIHNpbmNlIHNjYW47IGRlZmVycmluZyBwdXNoJywgcHVzaC5wYXRoKTtcbiAgICAgICAgdGhpcy5zY2hlZHVsZVJlY29uY2lsZSgpO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChwdXNoLmtpbmQgPT09ICdjb25mbGljdENvcHknKSB7XG4gICAgICAgIC8vIE1hdGVyaWFsaXplIHRoZSBjb3B5IGxvY2FsbHkgTk9XLCBiZWZvcmUgdGhlIHB1bGxzIG92ZXJ3cml0ZSB0aGVcbiAgICAgICAgLy8gb3JpZ2luYWw6IHRoZSBzZXJ2ZXIgYnJvYWRjYXN0cyB0aGUgY29weSB0byAqb3RoZXIqIGNsaWVudHMgb25seSxcbiAgICAgICAgLy8gc28gdGhpcyBkZXZpY2UgbXVzdCB3cml0ZSBpdHMgb3duIGNvcHkgaXRzZWxmLiBUaGUgY29weSBsYW5kcyBhdCBhXG4gICAgICAgIC8vIE5FVyBwYXRoIHdob3NlIG9uLWRpc2sgc3RhdCBkaWZmZXJzIGZyb20gdGhlIHNvdXJjZSdzIFx1MjAxNCBubyBoYXNoLXRpbWVcbiAgICAgICAgLy8gc3RhdCB0byBwaW4sIHRoZSBuZXh0IHNjYW4gcmVjb3JkcyBvbmUuXG4gICAgICAgIGF3YWl0IHRoaXMub3B0aW9ucy5zdG9yYWdlLndyaXRlRmlsZShwdXNoLnBhdGgsIGJ5dGVzKTtcbiAgICAgICAgc3RhZ2VkLnB1c2goeyAuLi50aGlzLnRvU3RhZ2VkKHB1c2gpLCBieXRlcyB9KTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBzdGFnZWQucHVzaCh7XG4gICAgICAgIC4uLnRoaXMudG9TdGFnZWQocHVzaCksXG4gICAgICAgIGJ5dGVzLFxuICAgICAgICAuLi4oaGFzaFRpbWVNdGltZS5nZXQoc291cmNlUGF0aCkgIT09IHVuZGVmaW5lZFxuICAgICAgICAgID8geyBtdGltZTogaGFzaFRpbWVNdGltZS5nZXQoc291cmNlUGF0aCkgfVxuICAgICAgICAgIDoge30pLFxuICAgICAgfSk7XG4gICAgfVxuICAgIHJldHVybiBzdGFnZWQ7XG4gIH1cblxuICBwcml2YXRlIHRvU3RhZ2VkKHB1c2g6IFB1c2hPcCk6IFN0YWdlZENvbW1pdCB7XG4gICAgaWYgKHB1c2gua2luZCA9PT0gJ3JlbmFtZScpIHtcbiAgICAgIHJldHVybiB7XG4gICAgICAgIGtpbmQ6ICdyZW5hbWUnLFxuICAgICAgICBwYXRoOiBwdXNoLnRvUGF0aCxcbiAgICAgICAgcGFyZW50VmVyc2lvbjogcHVzaC5wYXJlbnRWZXJzaW9uLFxuICAgICAgICBoYXNoOiBwdXNoLmhhc2gsXG4gICAgICAgIHNpemU6IHB1c2guc2l6ZSxcbiAgICAgICAgZnJvbVBhdGg6IHB1c2guZnJvbVBhdGgsXG4gICAgICB9O1xuICAgIH1cbiAgICByZXR1cm4ge1xuICAgICAga2luZDogcHVzaC5raW5kID09PSAnYWRkJyA/ICdlZGl0JyA6IHB1c2gua2luZCxcbiAgICAgIHBhdGg6IHB1c2gucGF0aCxcbiAgICAgIHBhcmVudFZlcnNpb246IHB1c2gucGFyZW50VmVyc2lvbixcbiAgICAgIGhhc2g6IHB1c2guaGFzaCxcbiAgICAgIHNpemU6IHB1c2guc2l6ZSxcbiAgICAgIC4uLihwdXNoLmlzRm9sZGVyID8geyBpc0ZvbGRlcjogdHJ1ZSB9IDoge30pLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlYWRMb2NhbChwYXRoOiBzdHJpbmcpOiBQcm9taXNlPFVpbnQ4QXJyYXkgfCB1bmRlZmluZWQ+IHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMub3B0aW9ucy5zdG9yYWdlLnJlYWRGaWxlKHBhdGgpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU2VuZCBgY29tbWl0c2AgdGhyb3VnaCBhIGJvdW5kZWQtY29uY3VycmVuY3kgcGlwZWxpbmU6IHVwIHRvXG4gICAqIGBwdXNoQ29uY3VycmVuY3lgIGNvbW1pdHMgaW4gZmxpZ2h0IChzZW50LCBhd2FpdGluZyB0aGVpciBzZXJ2ZXIgcmVwbHkpXG4gICAqIGF0IG9uY2U7IGVhY2ggc2xvdCBzZW5kcyBpdHMgbmV4dCBjb21taXQgYXMgc29vbiBhcyBhbiBlYXJsaWVyIG9uZSBpc1xuICAgKiBzZXR0bGVkLlxuICAgKlxuICAgKiBXSFkgUElQRUxJTklORyBJUyBTQUZFICh2cy4gYSBiYXRjaCBtZXNzYWdlKTogY29uZmxpY3QgYXJiaXRyYXRpb24gaXNcbiAgICogU0VSVkVSLXNpZGUgYW5kIFBFUiBQQVRIIChgYXJiaXRyYXRlQ29tbWl0YCByZWFkcyBhbmQgd3JpdGVzIGV4YWN0bHkgdGhlXG4gICAqIGNvbW1pdHRlZCBwYXRoJ3MgaGVhZCksIGFuZCBhIGN5Y2xlIHN0YWdlcyBhdCBtb3N0IE9ORSBjb21taXQgcGVyIHBhdGhcbiAgICogKHRoZSBzY2FuIGJ1Y2tldHMgYnkgcGF0aDsgcmVuYW1lcyBjb25zdW1lIGJvdGggZW5kcykuIFNvIHR3byBpbi1mbGlnaHRcbiAgICogY29tbWl0cyBjYW4gbmV2ZXIgaW50ZXJhY3Qgb24gdGhlIHNlcnZlciwgYW5kIHJlcGx5IE9SREVSIGFjcm9zc1xuICAgKiBkaWZmZXJlbnQgcGF0aHMgZG9lcyBub3QgbWF0dGVyIGZvciB0aGUgcmVzdWx0aW5nIHN0YXRlIFx1MjAxNCBvbmx5IHBlci1wYXRoXG4gICAqIHBhaXJpbmcgb2YgcmVwbHlcdTIxOTJjb21taXQgbWF0dGVycywgd2hpY2ggdGhlIG9yZGVyZWQgV2ViU29ja2V0IHBsdXMgdGhlXG4gICAqIHNlcnZlcidzIHNlcmlhbGl6ZWQgYXJiaXRyYXRpb24gZ3VhcmFudGVlIChyZXBsaWVzIGFycml2ZSBpbiBzZW5kIG9yZGVyLFxuICAgKiBtYXRjaGVkIEZJRk8gYnkgYG9uVHJhbnNwb3J0TWVzc2FnZWApLiBBIGJhdGNoIHByb3RvY29sIG1lc3NhZ2Ugd291bGRcbiAgICogYWRkaXRpb25hbGx5IGNvdXBsZSBibG9iLXVwbG9hZCB0aW1pbmcgYW5kIGVycm9yIGdyYW51bGFyaXR5IGZvciBub1xuICAgKiBjb3JyZWN0bmVzcyBnYWluLCBzbyBwcm90b2NvbCB2MSBzdGF5cyB1bmNoYW5nZWQuXG4gICAqXG4gICAqIE9uIHRoZSBmaXJzdCBmYWlsdXJlLCBpbi1mbGlnaHQgY29tbWl0cyBzdGlsbCBzZXR0bGUgKHRoZWlyIGFja3MgYXJlXG4gICAqIGFwcGxpZWQgXHUyMDE0IHRoZXkgYXJlIHJlYWwgaGVhZHMpIGJ1dCBubyBORVcgY29tbWl0IHN0YXJ0czsgdGhlIGVycm9yIGlzXG4gICAqIHJldGhyb3duIGFmdGVyIGFsbCBzbG90cyBkcmFpbiBzbyB0aGUgY3ljbGUgZmFpbHMgZXhhY3RseSBsaWtlIHRoZSBvbGRcbiAgICogc2VxdWVudGlhbCBsb29wIGRpZCAodW5zZW50IHB1c2hlcyBzaW1wbHkgcmV0cnkgbmV4dCBjeWNsZSkuXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIHJ1blB1c2hQaXBlbGluZShcbiAgICBjb21taXRzOiByZWFkb25seSBTdGFnZWRDb21taXRbXSxcbiAgICBvblNldHRsZWQ6ICgpID0+IHZvaWQsXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmIChjb21taXRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuICAgIGxldCBuZXh0ID0gMDtcbiAgICBsZXQgZmFpbHVyZTogRXJyb3IgfCBudWxsID0gbnVsbDtcbiAgICBjb25zdCBzbG90cyA9IE1hdGgubWluKHRoaXMucHVzaENvbmN1cnJlbmN5LCBjb21taXRzLmxlbmd0aCk7XG4gICAgY29uc3Qgd29ya2VyID0gYXN5bmMgKCk6IFByb21pc2U8dm9pZD4gPT4ge1xuICAgICAgd2hpbGUgKG5leHQgPCBjb21taXRzLmxlbmd0aCkge1xuICAgICAgICBpZiAoZmFpbHVyZSAhPT0gbnVsbCkgcmV0dXJuO1xuICAgICAgICBjb25zdCBjb21taXQgPSBjb21taXRzW25leHQrK10hO1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IHRoaXMuc2VuZENvbW1pdChjb21taXQpO1xuICAgICAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgICAgIGZhaWx1cmUgPz89IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvciA6IG5ldyBFcnJvcihTdHJpbmcoZXJyb3IpKTtcbiAgICAgICAgICByZXR1cm47XG4gICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgb25TZXR0bGVkKCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9O1xuICAgIGF3YWl0IFByb21pc2UuYWxsKEFycmF5LmZyb20oeyBsZW5ndGg6IHNsb3RzIH0sIHdvcmtlcikpO1xuICAgIGlmIChmYWlsdXJlICE9PSBudWxsKSB0aHJvdyBmYWlsdXJlO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBzZW5kQ29tbWl0KGNvbW1pdDogU3RhZ2VkQ29tbWl0KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgdHJhbnNwb3J0ID0gdGhpcy50cmFuc3BvcnQ7XG4gICAgaWYgKHRyYW5zcG9ydCA9PT0gbnVsbCkgdGhyb3cgbmV3IE5ldHdvcmtFcnJvcignbm90IGNvbm5lY3RlZCcpO1xuXG4gICAgY29uc3QgbWVzc2FnZTogQ29tbWl0TWVzc2FnZSA9IHtcbiAgICAgIHR5cGU6ICdjb21taXQnLFxuICAgICAgcGF0aDogY29tbWl0LnBhdGgsXG4gICAgICBwYXJlbnRWZXJzaW9uOiBjb21taXQucGFyZW50VmVyc2lvbixcbiAgICAgIGhhc2g6IGNvbW1pdC5oYXNoLFxuICAgICAgc2l6ZTogY29tbWl0LnNpemUsXG4gICAgICBraW5kOiBjb21taXQua2luZCxcbiAgICAgIC4uLihjb21taXQuZnJvbVBhdGggIT09IHVuZGVmaW5lZCA/IHsgZnJvbVBhdGg6IGNvbW1pdC5mcm9tUGF0aCB9IDoge30pLFxuICAgICAgLi4uKGNvbW1pdC5pc0ZvbGRlciA9PT0gdHJ1ZSA/IHsgaXNGb2xkZXI6IHRydWUgfSA6IHt9KSxcbiAgICAgIC4uLihjb21taXQuYnl0ZXMgIT09IHVuZGVmaW5lZCAmJiBjb21taXQuYnl0ZXMuYnl0ZUxlbmd0aCA8PSBJTkxJTkVfQ09OVEVOVF9NQVhfQllURVNcbiAgICAgICAgPyB7IGlubGluZTogYnl0ZXNUb0Jhc2U2NChjb21taXQuYnl0ZXMpIH1cbiAgICAgICAgOiB7fSksXG4gICAgfTtcblxuICAgIC8vIEF0dGFjaG1lbnRzIGFib3ZlIHRoZSBpbmxpbmUgY2FwIHJpZGUgdGhlIGJsb2Igc3RvcmUgKEZSLTgpLiBJbnNpZGUgYVxuICAgIC8vIHBpcGVsaW5lIHNsb3QgdGhpcyBhd2FpdCBvdmVybGFwcyB3aXRoIHRoZSBPVEhFUiBzbG90cycgaW4tZmxpZ2h0XG4gICAgLy8gY29tbWl0cyBcdTIwMTQgdGhlIHVwbG9hZCBubyBsb25nZXIgc2VyaWFsaXplcyBhaGVhZCBvZiBldmVyeSBjb21taXQgXHUyMDE0IGFuZFxuICAgIC8vIHN0aWxsIGNvbXBsZXRlcyBiZWZvcmUgSVRTIGNvbW1pdCBpcyBzZW50ICh0aGUgc2VydmVyIHJlamVjdHMgYSBjb21taXRcbiAgICAvLyB3aG9zZSBibG9iIGhhcyBub3QgYXJyaXZlZCkuXG4gICAgaWYgKGNvbW1pdC5ieXRlcyAhPT0gdW5kZWZpbmVkICYmIGNvbW1pdC5ieXRlcy5ieXRlTGVuZ3RoID4gSU5MSU5FX0NPTlRFTlRfTUFYX0JZVEVTKSB7XG4gICAgICBhd2FpdCB0aGlzLnVwbG9hZEJsb2IoY29tbWl0Lmhhc2gsIGNvbW1pdC5ieXRlcyk7XG4gICAgfVxuXG4gICAgY29uc3QgcmVwbHkgPSBhd2FpdCB0aGlzLnJlcXVlc3Q8Q29tbWl0QWNrTWVzc2FnZSB8IENvbmZsaWN0TWVzc2FnZSB8IFNlcnZlckVycm9yTWVzc2FnZT4oXG4gICAgICAobSkgPT4gbS50eXBlID09PSAnY29tbWl0QWNrJyB8fCBtLnR5cGUgPT09ICdjb25mbGljdCcgfHwgbS50eXBlID09PSAnZXJyb3InLFxuICAgICAgKCkgPT4gdHJhbnNwb3J0LnNlbmQobWVzc2FnZSksXG4gICAgKTtcbiAgICBpZiAocmVwbHkudHlwZSA9PT0gJ2Vycm9yJykgdGhyb3cgdGhpcy50b0Vycm9yKHJlcGx5KTtcblxuICAgIC8vIEZvbGQgdGhlIHJlcGx5IGludG8gc2hhcmVkIHN0YXRlIGJlaGluZCB0aGUgYWNrIGNoYWluOiBjb25jdXJyZW50XG4gICAgLy8gc2xvdHMgbXVzdCBub3QgcmVhZC1tb2RpZnktd3JpdGUgYHRoaXMuaW5kZXhgIGF0IHRoZSBzYW1lIHRpbWUuXG4gICAgYXdhaXQgdGhpcy5zZXJpYWxpemVBY2tBcHBsaWNhdGlvbihhc3luYyAoKSA9PiB7XG4gICAgICBpZiAocmVwbHkudHlwZSA9PT0gJ2NvbW1pdEFjaycpIHtcbiAgICAgICAgaWYgKHJlcGx5LnNlcSA+IHRoaXMuY3Vyc29yKSB0aGlzLmN1cnNvciA9IHJlcGx5LnNlcTtcbiAgICAgICAgdGhpcy5hcHBseUFja1RvSW5kZXgoY29tbWl0LCByZXBseS52ZXJzaW9uLCByZXBseS5jbG9jayk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGF3YWl0IHRoaXMuaGFuZGxlQ29uZmxpY3RSZXBseShjb21taXQsIHJlcGx5KTtcbiAgICB9KTtcbiAgfVxuXG4gIC8qKiBDaGFpbiBvbmUgcmVwbHkncyBpbmRleCBhcHBsaWNhdGlvbiBhZnRlciBldmVyeSBwcmV2aW91c2x5LXN0YXJ0ZWQgb25lLiAqL1xuICBwcml2YXRlIHNlcmlhbGl6ZUFja0FwcGxpY2F0aW9uKGFwcGx5OiAoKSA9PiBQcm9taXNlPHZvaWQ+KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgcnVuID0gdGhpcy5hY2tDaGFpbi50aGVuKGFwcGx5LCBhcHBseSk7XG4gICAgdGhpcy5hY2tDaGFpbiA9IHJ1bi50aGVuKFxuICAgICAgKCkgPT4ge30sXG4gICAgICAoKSA9PiB7fSxcbiAgICApO1xuICAgIHJldHVybiBydW47XG4gIH1cblxuICBwcml2YXRlIGFwcGx5QWNrVG9JbmRleChjb21taXQ6IFN0YWdlZENvbW1pdCwgdmVyc2lvbklkOiBzdHJpbmcsIGNsb2NrOiBMb2dpY2FsQ2xvY2spOiB2b2lkIHtcbiAgICBjb25zdCBkZWxldGVkID0gY29tbWl0LmtpbmQgPT09ICdkZWxldGUnO1xuICAgIGlmIChjb21taXQua2luZCA9PT0gJ3JlbmFtZScgJiYgY29tbWl0LmZyb21QYXRoICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMuaW5kZXggPSBhcHBseUNvbW1pdChyZW1vdmVFbnRyeSh0aGlzLmluZGV4LCBjb21taXQuZnJvbVBhdGgpLCB7XG4gICAgICAgIHBhdGg6IGNvbW1pdC5wYXRoLFxuICAgICAgICB2ZXJzaW9uSWQsXG4gICAgICAgIGhhc2g6IGNvbW1pdC5oYXNoLFxuICAgICAgICBzaXplOiBjb21taXQuc2l6ZSxcbiAgICAgICAgY2xvY2ssXG4gICAgICB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgLy8gYGNvbW1pdC5tdGltZWAgaXMgdGhlIHN0YXQgb2JzZXJ2ZWQgYXQgSEFTSCB0aW1lIGZvciB0aGlzIGV4YWN0IGNvbnRlbnRcbiAgICAvLyAodGhyZWFkZWQgdGhyb3VnaCBgc3RhZ2VQdXNoZXNgKSwgbmV2ZXIgYSBzdGF0IHRha2VuIGF0IGFjayB0aW1lIFx1MjAxNCBhblxuICAgIC8vIGVkaXQgdGhhdCBsYW5kZWQgYmV0d2VlbiBoYXNoaW5nIGFuZCB0aGlzIGFjayBjaGFuZ2VkIHRoZSBkaXNrIHN0YXQsIHNvXG4gICAgLy8gdGhlIG5leHQgc2NhbiBtaXNzZXMgdGhlIGZhc3QgcGF0aCBhbmQgcmUtaGFzaGVzL3B1c2hlcyB0aGUgZWRpdC5cbiAgICB0aGlzLmluZGV4ID0gYXBwbHlDb21taXQodGhpcy5pbmRleCwge1xuICAgICAgcGF0aDogY29tbWl0LnBhdGgsXG4gICAgICB2ZXJzaW9uSWQsXG4gICAgICBoYXNoOiBjb21taXQuaGFzaCxcbiAgICAgIHNpemU6IGNvbW1pdC5zaXplLFxuICAgICAgY2xvY2ssXG4gICAgICBkZWxldGVkLFxuICAgICAgZGVsZXRlZEF0OiBkZWxldGVkID8gdGhpcy5ub3coKSA6IHVuZGVmaW5lZCxcbiAgICAgIC4uLihjb21taXQuaXNGb2xkZXIgPT09IHRydWUgPyB7IGlzRm9sZGVyOiB0cnVlIH0gOiB7fSksXG4gICAgICAuLi4oY29tbWl0Lm10aW1lICE9PSB1bmRlZmluZWQgPyB7IG10aW1lOiBjb21taXQubXRpbWUgfSA6IHt9KSxcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgaGFuZGxlQ29uZmxpY3RSZXBseShcbiAgICBjb21taXQ6IFN0YWdlZENvbW1pdCxcbiAgICByZXBseTogQ29uZmxpY3RNZXNzYWdlLFxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAocmVwbHkuc2VxICE9PSB1bmRlZmluZWQgJiYgcmVwbHkuc2VxID4gdGhpcy5jdXJzb3IpIHRoaXMuY3Vyc29yID0gcmVwbHkuc2VxO1xuICAgIGNvbnN0IHdlV29uID1cbiAgICAgIHJlcGx5Lndpbm5lci5kZXZpY2VJZCA9PT0gdGhpcy5vcHRpb25zLmRldmljZUlkICYmIHJlcGx5Lndpbm5lci5oYXNoID09PSBjb21taXQuaGFzaDtcbiAgICBpZiAod2VXb24pIHtcbiAgICAgIHRoaXMuYXBwbHlBY2tUb0luZGV4KGNvbW1pdCwgcmVwbHkud2lubmVyLmlkLCByZXBseS53aW5uZXIuY2xvY2spO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIFdlIGxvc3QgdGhlIHJhY2UuIE1hdGVyaWFsaXplIHRoZSB3aW5uZXIgZGlyZWN0bHkgXHUyMDE0IHRoZSBzZXJ2ZXIgaGFzXG4gICAgLy8gYWxyZWFkeSBwcmVzZXJ2ZWQgb3VyIGNvbnRlbnQgYXMgYSBjb25mbGljdCBjb3B5IChpZiBpdCB3YXMgZGlzdGluY3QpLlxuICAgIC8vIE9uZSBjYXZlYXQ6IGlmIHRoZSB3b3JraW5nIHRyZWUgbW92ZWQgb24gQUdBSU4gc2luY2Ugd2Ugc3RhZ2VkIHRoaXNcbiAgICAvLyBjb21taXQsIGRvIG5vdCBjbG9iYmVyIGl0IGVpdGhlciBcdTIwMTQgaGFuZCB0aGUgd2hvbGUgdGhpbmcgdG8gYSBjeWNsZS5cbiAgICBpZiAoY29tbWl0LmtpbmQgIT09ICdkZWxldGUnICYmIGNvbW1pdC5raW5kICE9PSAncmVuYW1lJyAmJiBjb21taXQuaXNGb2xkZXIgIT09IHRydWUpIHtcbiAgICAgIGNvbnN0IGxvY2FsID0gYXdhaXQgdGhpcy5yZWFkTG9jYWwoY29tbWl0LnBhdGgpO1xuICAgICAgaWYgKGxvY2FsICE9PSB1bmRlZmluZWQgJiYgKGF3YWl0IHNoYTI1NkhleChsb2NhbCkpICE9PSBjb21taXQuaGFzaCkge1xuICAgICAgICB0aGlzLnNjaGVkdWxlUmVjb25jaWxlKCk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoY29tbWl0LmtpbmQgPT09ICdyZW5hbWUnICYmIGNvbW1pdC5mcm9tUGF0aCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAvLyBPdXIgcmVuYW1lIGxvc3Q6IHRoZSBmaWxlIHN0YXlzIHdoZXJlIHRoZSB3aW5uZXIga2VlcHMgaXQ7IHJlY29yZFxuICAgICAgLy8gdGhlIHdpbm5lciBoZWFkIGZvciB0aGUgZGVzdGluYXRpb24gKHRoZSBzb3VyY2UgcGF0aCBpcyB1bnRvdWNoZWQpLlxuICAgICAgdGhpcy5pbmRleCA9IGFwcGx5Q29tbWl0KHRoaXMuaW5kZXgsIHtcbiAgICAgICAgcGF0aDogcmVwbHkud2lubmVyLnBhdGgsXG4gICAgICAgIHZlcnNpb25JZDogcmVwbHkud2lubmVyLmlkLFxuICAgICAgICBoYXNoOiByZXBseS53aW5uZXIuaGFzaCxcbiAgICAgICAgc2l6ZTogcmVwbHkud2lubmVyLnNpemUsXG4gICAgICAgIGNsb2NrOiByZXBseS53aW5uZXIuY2xvY2ssXG4gICAgICB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0aGlzLmluZGV4ID0gYXdhaXQgdGhpcy5hcHBseVB1bGxzKFt0aGlzLndpbm5lckFzUHVsbChyZXBseS53aW5uZXIpXSk7XG4gIH1cblxuICAvKiogVHVybiBhbiBhcmJpdHJhdGVkIHdpbm5lciB2ZXJzaW9uIGludG8gYSBwdWxsIG9wIChjb250ZW50IG9wcyBvbmx5KS4gKi9cbiAgcHJpdmF0ZSB3aW5uZXJBc1B1bGwod2lubmVyOiB7XG4gICAgcGF0aDogc3RyaW5nO1xuICAgIGlkOiBzdHJpbmc7XG4gICAgaGFzaDogc3RyaW5nO1xuICAgIHNpemU6IG51bWJlcjtcbiAgICBkZXZpY2VJZDogc3RyaW5nO1xuICAgIGNsb2NrOiBMb2dpY2FsQ2xvY2s7XG4gICAga2luZDogQ29tbWl0TWVzc2FnZVsna2luZCddO1xuICB9KTogUHVsbE9wIHtcbiAgICBjb25zdCBlbnRyeSA9IHRoaXMuaW5kZXhbd2lubmVyLnBhdGhdO1xuICAgIGNvbnN0IGRlbGV0ZWQgPSB3aW5uZXIua2luZCA9PT0gJ2RlbGV0ZSc7XG4gICAgY29uc3Qga2luZDogUHVsbEZpbGVPcFsna2luZCddID0gZGVsZXRlZFxuICAgICAgPyAnZGVsZXRlJ1xuICAgICAgOiBlbnRyeSA9PT0gdW5kZWZpbmVkXG4gICAgICAgID8gJ2FkZCdcbiAgICAgICAgOiBlbnRyeS5kZWxldGVkQXQgIT09IHVuZGVmaW5lZFxuICAgICAgICAgID8gJ3Jlc3RvcmUnXG4gICAgICAgICAgOiAnZWRpdCc7XG4gICAgcmV0dXJuIHtcbiAgICAgIGtpbmQsXG4gICAgICBwYXRoOiB3aW5uZXIucGF0aCxcbiAgICAgIGhhc2g6IHdpbm5lci5oYXNoLFxuICAgICAgc2l6ZTogd2lubmVyLnNpemUsXG4gICAgICB2ZXJzaW9uOiB3aW5uZXIuaWQsXG4gICAgICBjbG9jazogd2lubmVyLmNsb2NrLFxuICAgICAgZGVsZXRlZCxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyB1cGxvYWRCbG9iKGhhc2g6IHN0cmluZywgYnl0ZXM6IFVpbnQ4QXJyYXkpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCB0cmFuc3BvcnQgPSB0aGlzLnRyYW5zcG9ydDtcbiAgICBpZiAodHJhbnNwb3J0ID09PSBudWxsKSB0aHJvdyBuZXcgTmV0d29ya0Vycm9yKCdub3QgY29ubmVjdGVkJyk7XG4gICAgY29uc3QgcmVwbHkgPSBhd2FpdCB0aGlzLnJlcXVlc3Q8QmxvYkFja01lc3NhZ2UgfCBTZXJ2ZXJFcnJvck1lc3NhZ2U+KFxuICAgICAgKG0pID0+IG0udHlwZSA9PT0gJ2Jsb2JBY2snIHx8IG0udHlwZSA9PT0gJ2Vycm9yJyxcbiAgICAgICgpID0+IHRyYW5zcG9ydC5zZW5kKHsgdHlwZTogJ3B1dEJsb2InLCBoYXNoLCBjb250ZW50OiBieXRlc1RvQmFzZTY0KGJ5dGVzKSB9KSxcbiAgICApO1xuICAgIGlmIChyZXBseS50eXBlID09PSAnZXJyb3InKSB0aHJvdyB0aGlzLnRvRXJyb3IocmVwbHkpO1xuICAgIGF3YWl0IHRoaXMub3B0aW9ucy5ibG9iU3RvcmUucHV0KGhhc2gsIGJ5dGVzKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVhZG9ubHkgZmV0Y2hCbG9iOiBGZXRjaEJsb2IgPSBhc3luYyAoaGFzaDogc3RyaW5nKTogUHJvbWlzZTxVaW50OEFycmF5PiA9PiB7XG4gICAgaWYgKGhhc2ggPT09ICcnKSB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcigncmVmdXNpbmcgdG8gZmV0Y2ggY29udGVudCBmb3IgYW4gZW1wdHkgaGFzaCcpO1xuICAgIGNvbnN0IGNhY2hlZCA9IGF3YWl0IHRoaXMub3B0aW9ucy5ibG9iU3RvcmUuZ2V0KGhhc2gpO1xuICAgIGlmIChjYWNoZWQgIT09IHVuZGVmaW5lZCkgcmV0dXJuIGNhY2hlZDtcbiAgICBjb25zdCBieXRlcyA9IGF3YWl0IHRoaXMuZG93bmxvYWRCbG9iKGhhc2gpO1xuICAgIGF3YWl0IHRoaXMub3B0aW9ucy5ibG9iU3RvcmUucHV0KGhhc2gsIGJ5dGVzKTtcbiAgICByZXR1cm4gYnl0ZXM7XG4gIH07XG5cbiAgcHJpdmF0ZSBhc3luYyBkb3dubG9hZEJsb2IoaGFzaDogc3RyaW5nKTogUHJvbWlzZTxVaW50OEFycmF5PiB7XG4gICAgY29uc3QgdHJhbnNwb3J0ID0gdGhpcy50cmFuc3BvcnQ7XG4gICAgaWYgKHRyYW5zcG9ydCA9PT0gbnVsbCkgdGhyb3cgbmV3IE5ldHdvcmtFcnJvcignbm90IGNvbm5lY3RlZCcpO1xuICAgIGNvbnN0IHJlcGx5ID0gYXdhaXQgdGhpcy5yZXF1ZXN0PEJsb2JNZXNzYWdlIHwgU2VydmVyRXJyb3JNZXNzYWdlPihcbiAgICAgIChtKSA9PiAobS50eXBlID09PSAnYmxvYicgJiYgbS5oYXNoID09PSBoYXNoKSB8fCBtLnR5cGUgPT09ICdlcnJvcicsXG4gICAgICAoKSA9PiB0cmFuc3BvcnQuc2VuZCh7IHR5cGU6ICdnZXRCbG9iJywgaGFzaCB9KSxcbiAgICApO1xuICAgIGlmIChyZXBseS50eXBlID09PSAnZXJyb3InKSB0aHJvdyB0aGlzLnRvRXJyb3IocmVwbHkpO1xuICAgIGNvbnN0IGJ5dGVzID0gYmFzZTY0VG9CeXRlcyhyZXBseS5jb250ZW50KTtcbiAgICBpZiAoKGF3YWl0IHNoYTI1NkhleChieXRlcykpICE9PSBoYXNoKSB7XG4gICAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgYmxvYiAke2hhc2h9IGZhaWxlZCB2ZXJpZmljYXRpb24gb24gZG93bmxvYWRgKTtcbiAgICB9XG4gICAgcmV0dXJuIGJ5dGVzO1xuICB9XG5cbiAgLy8gLS0tIHNuYXBzaG90cyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIC8qKlxuICAgKiBTbmFwc2hvdCBldmVyeSBmaWxlIGhlYWQgb24gdGhlIGF1dGhvcml0eSAoYSB3aG9sZS12YXVsdCByZXN0b3JlIHBvaW50KS5cbiAgICogU25hcHNob3RzIGFyZSBub3QgYnJvYWRjYXN0IFx1MjAxNCBvdGhlciBkZXZpY2VzIHNlZSBub3RoaW5nIGxpdmUuXG4gICAqL1xuICBhc3luYyBjcmVhdGVTbmFwc2hvdChuYW1lPzogc3RyaW5nKTogUHJvbWlzZTxTbmFwc2hvdENyZWF0ZUFja01lc3NhZ2U+IHtcbiAgICBjb25zdCB0cmFuc3BvcnQgPSB0aGlzLnRyYW5zcG9ydDtcbiAgICBpZiAodHJhbnNwb3J0ID09PSBudWxsKSB0aHJvdyBuZXcgTmV0d29ya0Vycm9yKCdub3QgY29ubmVjdGVkJyk7XG4gICAgY29uc3QgcmVwbHkgPSBhd2FpdCB0aGlzLnJlcXVlc3Q8U25hcHNob3RDcmVhdGVBY2tNZXNzYWdlIHwgU2VydmVyRXJyb3JNZXNzYWdlPihcbiAgICAgIChtKSA9PiBtLnR5cGUgPT09ICdzbmFwc2hvdENyZWF0ZUFjaycgfHwgbS50eXBlID09PSAnZXJyb3InLFxuICAgICAgKCkgPT4gdHJhbnNwb3J0LnNlbmQoeyB0eXBlOiAnc25hcHNob3RDcmVhdGUnLCAuLi4obmFtZSAhPT0gdW5kZWZpbmVkID8geyBuYW1lIH0gOiB7fSkgfSksXG4gICAgKTtcbiAgICBpZiAocmVwbHkudHlwZSA9PT0gJ2Vycm9yJykgdGhyb3cgdGhpcy50b0Vycm9yKHJlcGx5KTtcbiAgICByZXR1cm4gcmVwbHk7XG4gIH1cblxuICAvKipcbiAgICogUmVzdG9yZSB0aGUgd2hvbGUgdmF1bHQgdG8gYSBzbmFwc2hvdC4gVGhlIHNlcnZlciBsYW5kcyBldmVyeSByZXZlcnRlZFxuICAgKiBoZWFkIGFzIGEgTkVXIHZlcnNpb24gKGhpc3RvcnkgaXMgbmV2ZXIgZGVsZXRlZCkgYW5kIGZhbnMgdGhlIGNoYW5nZXMgb3V0XG4gICAqIHRvIE9USEVSIHNvY2tldHMgb25seSBcdTIwMTQgdGhpcyBkZXZpY2UgZG9lcyBub3QgcmVjZWl2ZSBpdHMgb3duIGZhbi1vdXQsIHNvXG4gICAqIHRoZSBsb2NhbCBpbmRleCBtdXN0IHJlLWNvbnZlcmdlIGZyb20gYSBGVUxMIG1hbmlmZXN0OiBmbGFnIGRlbHRhIG1vZGVcbiAgICogb2ZmLCB0aGVuIHJ1biBhIGN5Y2xlIGlubGluZSAob25lLXNob3QgY2FsbGVycyBjbG9zZSB0aGUgdHJhbnNwb3J0IGFzXG4gICAqIHNvb24gYXMgdGhpcyByZXNvbHZlcywgc28gYSBkZWJvdW5jZWQgY3ljbGUgd291bGQgbmV2ZXIgZmlyZSkuXG4gICAqL1xuICBhc3luYyByZXN0b3JlU25hcHNob3QoaWQ6IHN0cmluZyk6IFByb21pc2U8U25hcHNob3RSZXN0b3JlQWNrTWVzc2FnZT4ge1xuICAgIGNvbnN0IHRyYW5zcG9ydCA9IHRoaXMudHJhbnNwb3J0O1xuICAgIGlmICh0cmFuc3BvcnQgPT09IG51bGwpIHRocm93IG5ldyBOZXR3b3JrRXJyb3IoJ25vdCBjb25uZWN0ZWQnKTtcbiAgICBjb25zdCByZXBseSA9IGF3YWl0IHRoaXMucmVxdWVzdDxTbmFwc2hvdFJlc3RvcmVBY2tNZXNzYWdlIHwgU2VydmVyRXJyb3JNZXNzYWdlPihcbiAgICAgIChtKSA9PiBtLnR5cGUgPT09ICdzbmFwc2hvdFJlc3RvcmVBY2snIHx8IG0udHlwZSA9PT0gJ2Vycm9yJyxcbiAgICAgICgpID0+IHRyYW5zcG9ydC5zZW5kKHsgdHlwZTogJ3NuYXBzaG90UmVzdG9yZScsIGlkIH0pLFxuICAgICk7XG4gICAgaWYgKHJlcGx5LnR5cGUgPT09ICdlcnJvcicpIHRocm93IHRoaXMudG9FcnJvcihyZXBseSk7XG4gICAgdGhpcy5uZWVkc0Z1bGxNYW5pZmVzdCA9IHRydWU7XG4gICAgYXdhaXQgdGhpcy5lbnF1ZXVlKCgpID0+IHRoaXMucnVuQ3ljbGUoKSk7XG4gICAgcmV0dXJuIHJlcGx5O1xuICB9XG5cbiAgLy8gLS0tIHBsdW1iaW5nIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICBwcml2YXRlIHJlcXVlc3Q8VCBleHRlbmRzIFNlcnZlck1lc3NhZ2U+KFxuICAgIG1hdGNoZXM6IChtZXNzYWdlOiBNZXNzYWdlKSA9PiBib29sZWFuLFxuICAgIHNlbmQ6ICgpID0+IHZvaWQsXG4gICk6IFByb21pc2U8VD4ge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZTxUPigocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICBjb25zdCBleHBlY3RhdGlvbjogKHR5cGVvZiB0aGlzLmV4cGVjdGF0aW9ucylbbnVtYmVyXSA9IHtcbiAgICAgICAgbWF0Y2hlczogKG1lc3NhZ2UpID0+IG1hdGNoZXMobWVzc2FnZSksXG4gICAgICAgIHJlc29sdmU6IChtZXNzYWdlKSA9PiByZXNvbHZlKG1lc3NhZ2UgYXMgVCksXG4gICAgICAgIHJlamVjdCxcbiAgICAgIH07XG4gICAgICB0aGlzLmV4cGVjdGF0aW9ucy5wdXNoKGV4cGVjdGF0aW9uKTtcbiAgICAgIHRyeSB7XG4gICAgICAgIHNlbmQoKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIGNvbnN0IGluZGV4ID0gdGhpcy5leHBlY3RhdGlvbnMuaW5kZXhPZihleHBlY3RhdGlvbik7XG4gICAgICAgIGlmIChpbmRleCA+PSAwKSB0aGlzLmV4cGVjdGF0aW9ucy5zcGxpY2UoaW5kZXgsIDEpO1xuICAgICAgICByZWplY3QoZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IE5ldHdvcmtFcnJvcihTdHJpbmcoZXJyb3IpKSk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIHRvRXJyb3IobWVzc2FnZTogU2VydmVyRXJyb3JNZXNzYWdlKTogRXJyb3Ige1xuICAgIHN3aXRjaCAobWVzc2FnZS5jb2RlKSB7XG4gICAgICBjYXNlICdVTkFVVEhPUklaRUQnOlxuICAgICAgICByZXR1cm4gbmV3IFVuYXV0aG9yaXplZEVycm9yKG1lc3NhZ2UubWVzc2FnZSk7XG4gICAgICBjYXNlICdSRVZPS0VEJzpcbiAgICAgICAgcmV0dXJuIG5ldyBSZXZva2VkRXJyb3IobWVzc2FnZS5tZXNzYWdlKTtcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHJldHVybiBuZXcgUHJvdG9jb2xFcnJvcihtZXNzYWdlLm1lc3NhZ2UpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgZW5xdWV1ZShvcGVyYXRpb246ICgpID0+IFByb21pc2U8dm9pZD4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLnF1ZXVlZE9wcyArPSAxO1xuICAgIGNvbnN0IHJ1biA9IHRoaXMudGFpbC50aGVuKG9wZXJhdGlvbiwgb3BlcmF0aW9uKTtcbiAgICBjb25zdCBzZXR0bGVkID0gcnVuLnRoZW4oXG4gICAgICAoKSA9PiB7XG4gICAgICAgIHRoaXMucXVldWVkT3BzIC09IDE7XG4gICAgICAgIHRoaXMucGVyc2lzdEluZGV4KCk7XG4gICAgICB9LFxuICAgICAgKGVycm9yOiB1bmtub3duKSA9PiB7XG4gICAgICAgIHRoaXMucXVldWVkT3BzIC09IDE7XG4gICAgICAgIHRoaXMucGVyc2lzdEluZGV4KCk7XG4gICAgICAgIHRocm93IGVycm9yO1xuICAgICAgfSxcbiAgICApO1xuICAgIC8vIFN3YWxsb3cgcmVqZWN0aW9ucyBvbiB0aGUgc2hhcmVkIHRhaWwgKGluZGl2aWR1YWwgY2FsbGVycyBzZWUgdGhlbSB2aWFcbiAgICAvLyBgc2V0dGxlZGApOyBvbmUgZmFpbGVkIG9wIG11c3Qgbm90IHBvaXNvbiB0aGUgcXVldWUuXG4gICAgdGhpcy50YWlsID0gc2V0dGxlZC50aGVuKFxuICAgICAgKCkgPT4ge30sXG4gICAgICAoKSA9PiB7fSxcbiAgICApO1xuICAgIHJldHVybiBzZXR0bGVkO1xuICB9XG5cbiAgcHJpdmF0ZSBwZXJzaXN0SW5kZXgoKTogdm9pZCB7XG4gICAgY29uc3Qgc25hcHNob3QgPSBzZXJpYWxpemVMb2NhbEluZGV4KHRoaXMuaW5kZXgsIHRoaXMucGVyc2lzdGVkU3RhdGUoKSk7XG4gICAgdm9pZCB0aGlzLm9wdGlvbnMuc3RvcmFnZVxuICAgICAgLndyaXRlRmlsZShMT0NBTF9JTkRFWF9TVEFURV9QQVRILCBuZXcgVGV4dEVuY29kZXIoKS5lbmNvZGUoc25hcHNob3QpKVxuICAgICAgLmNhdGNoKChlcnJvcjogdW5rbm93bikgPT4gdGhpcy5sb2cud2FybignZmFpbGVkIHRvIHBlcnNpc3QgbG9jYWwgaW5kZXgnLCBlcnJvcikpO1xuICB9XG59XG5cbi8vIC0tLSBtb2R1bGUtcHJpdmF0ZSB0eXBlIGFsaWFzZXMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbnR5cGUgU2VydmVyRXJyb3JNZXNzYWdlID0gRXh0cmFjdDxTZXJ2ZXJNZXNzYWdlLCB7IHR5cGU6ICdlcnJvcicgfT47XG4iLCAiLyoqXG4gKiBTZXJ2ZXIgY29tcGF0aWJpbGl0eSBwb2xpY3kgXHUyMDE0IHRoZSB2ZXJzaW9uLXNrZXcgY29tcGFuaW9uIHRvIHRoZSB3aXJlXG4gKiBwcm90b2NvbCBjaGVjay5cbiAqXG4gKiBTZWxmLWhvc3RlcnMgZGVwbG95IHRoZSB3b3JrZXIgZnJvbSBhIENsb3VkZmxhcmUgdGVtcGxhdGUgcGlubmVkIHRvIGFcbiAqIHJlbGVhc2Ugd2hpbGUgdGhlIHBsdWdpbi9DTEkvZGFlbW9uIHVwZGF0ZSBvbiB0aGVpciBvd24gc2NoZWR1bGVzLCBzb1xuICogdmVyc2lvbiBza2V3IGFjcm9zcyBjb21wb25lbnRzIGlzIGd1YXJhbnRlZWQuIFRoZSBXUyBoYW5kc2hha2UgYWxyZWFkeVxuICogZW5mb3JjZXMgYW4gRVhBQ1QgYFByb3RvY29sVmVyc2lvbmAgbWF0Y2ggKGhhcmQgZ2F0ZSwgcHJvdG9jb2wudHMpOyB0aGlzXG4gKiBtb2R1bGUgYW5zd2VycyB0aGUgc29mdGVyIHF1ZXN0aW9uIFwiaXMgdGhpcyByZXBvcnRlZCBzZXJ2ZXIgcmVsZWFzZVxuICogcmVhc29uYWJseSBtYXRjaGVkIHRvIHRoaXMgY2xpZW50P1wiIHdpdGggYSBwdXJlLCBkZXBlbmRlbmN5LWZyZWUgdmVyZGljdFxuICogZXZlcnkgVUkgY2FuIHNoYXJlICh0aGUgcGx1Z2luJ3Mgc3RhdHVzIG5vdGUvTm90aWNlLCBgdnNhIGRvY3RvcmApLlxuICpcbiAqIERlbGliZXJhdGVseSB0b2xlcmFudDogb25seSBhIHNlcnZlciBPTERFUiB0aGFuIHRoZSBzdXBwb3J0ZWQgZmxvb3IgaXMgYW5cbiAqIGVycm9yOyBuZXdlciBzZXJ2ZXJzIGFuZCB1bnBhcnNlYWJsZS9hYnNlbnQgdmVyc2lvbnMgYXJlIHdhcm5pbmdzLCBuZXZlclxuICogc3luYy1raWxsZXJzLlxuICovXG5cbi8qKlxuICogT2xkZXN0IHNlcnZlciByZWxlYXNlIHRoZSBjbGllbnRzIGNhbiBiZSBleHBlY3RlZCB0byB3b3JrIGFnYWluc3QuIFNlcnZlcnNcbiAqIGJlbG93IHRoaXMgYXJlIHJlcG9ydGVkIGFzIGVycm9ycyAoXCJ1cGRhdGUgdGhlIHdvcmtlclwiKS5cbiAqL1xuZXhwb3J0IGNvbnN0IE1JTl9TVVBQT1JURURfU0VSVkVSX1ZFUlNJT04gPSAnMC4xLjAnO1xuXG4vKiogT3V0Y29tZSBvZiBgY2hlY2tTZXJ2ZXJDb21wYXRpYmlsaXR5YC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ29tcGF0aWJpbGl0eVZlcmRpY3Qge1xuICAvKipcbiAgICogYG9rYCBcdTIwMTQgbm90aGluZyB0byBkbzsgYHdhcm5gIFx1MjAxNCB3b3JrcywgY29uc2lkZXIgdXBkYXRpbmcgYSBjb21wb25lbnQ7XG4gICAqIGBlcnJvcmAgXHUyMDE0IHRoZSBzZXJ2ZXIgaXMgYmVsb3cgdGhlIHN1cHBvcnRlZCBmbG9vci4gTmV2ZXIgYSBzeW5jLWtpbGxlcjpcbiAgICogdGhlIHdpcmUgYFByb3RvY29sVmVyc2lvbmAgY2hlY2sgcmVtYWlucyB0aGUgaGFyZCBnYXRlLlxuICAgKi9cbiAgbGV2ZWw6ICdvaycgfCAnd2FybicgfCAnZXJyb3InO1xuICAvKiogVXNlci1mYWNpbmcgc2VudGVuY2UgKGVtcHR5LWlzaCBmb3IgdGhlIGBva2AgY2FzZSkuICovXG4gIG1lc3NhZ2U6IHN0cmluZztcbn1cblxuLyoqIFRoZSBwYXJ0cyBvZiBhIHNlbXZlciBzdHJpbmcgdGhlIHBvbGljeSBjb21wYXJlcyAocHJlcmVsZWFzZS9idWlsZCBpZ25vcmVkKS4gKi9cbmludGVyZmFjZSBTZW1WZXIge1xuICBtYWpvcjogbnVtYmVyO1xuICBtaW5vcjogbnVtYmVyO1xuICBwYXRjaDogbnVtYmVyO1xufVxuXG4vKipcbiAqIGBtYWpvci5taW5vci5wYXRjaGAsIHRvbGVyYXRpbmcgYSBsZWFkaW5nIGB2YCwgYSBgLXByZXJlbGVhc2VgLCBhbmQgYVxuICogYCtidWlsZGAgc3VmZml4LiBBbnl0aGluZyBlbHNlIChpbmNsdWRpbmcgYDAuMWAtc3R5bGUgdHdvLXBhcnQgdmVyc2lvbnMpXG4gKiBwYXJzZXMgYXMgYG51bGxgIFx1MjAxNCB0aGUgcG9saWN5IHRoZW4gd2FybnMgd2l0aCB0aGUgcmF3IHZhbHVlIGluc3RlYWQgb2ZcbiAqIGd1ZXNzaW5nLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VTZW1WZXIocmF3OiBzdHJpbmcpOiBTZW1WZXIgfCBudWxsIHtcbiAgY29uc3QgbWF0Y2ggPSAvXnY/KFxcZCspXFwuKFxcZCspXFwuKFxcZCspKD86LVswLTlBLVphLXouLV0rKT8oPzpcXCtbMC05QS1aYS16Li1dKyk/JC8uZXhlYyhcbiAgICByYXcudHJpbSgpLFxuICApO1xuICBpZiAobWF0Y2ggPT09IG51bGwpIHJldHVybiBudWxsO1xuICByZXR1cm4geyBtYWpvcjogTnVtYmVyKG1hdGNoWzFdKSwgbWlub3I6IE51bWJlcihtYXRjaFsyXSksIHBhdGNoOiBOdW1iZXIobWF0Y2hbM10pIH07XG59XG5cbi8qKiBUaHJlZS13YXkgY29tcGFyZSBvbiBtYWpvciBcdTIxOTIgbWlub3IgXHUyMTkyIHBhdGNoIChwcmVyZWxlYXNlL2J1aWxkIGlnbm9yZWQpLiAqL1xuZnVuY3Rpb24gY29tcGFyZVNlbVZlcihhOiBTZW1WZXIsIGI6IFNlbVZlcik6IG51bWJlciB7XG4gIGlmIChhLm1ham9yICE9PSBiLm1ham9yKSByZXR1cm4gYS5tYWpvciA8IGIubWFqb3IgPyAtMSA6IDE7XG4gIGlmIChhLm1pbm9yICE9PSBiLm1pbm9yKSByZXR1cm4gYS5taW5vciA8IGIubWlub3IgPyAtMSA6IDE7XG4gIGlmIChhLnBhdGNoICE9PSBiLnBhdGNoKSByZXR1cm4gYS5wYXRjaCA8IGIucGF0Y2ggPyAtMSA6IDE7XG4gIHJldHVybiAwO1xufVxuXG4vKipcbiAqIEFzc2VzcyBhIHNlcnZlcidzIHJlcG9ydGVkIHJlbGVhc2UgYWdhaW5zdCB0aGlzIGNsaWVudCdzIHZlcnNpb24uXG4gKlxuICogIC0gYHNlcnZlclZlcnNpb25gIG51bGwvdW5kZWZpbmVkL2VtcHR5IFx1MjE5MiB0aGUgc2VydmVyIHByZWRhdGVzIHZlcnNpb25cbiAqICAgIHJlcG9ydGluZyAoXHUyMjY0IDAuMSBuZXZlciBzZW5kcyB0aGUgZmllbGQpOiB3YXJuIHdpdGggYW4gdXBncmFkZSBoaW50LlxuICogIC0gVW5wYXJzZWFibGUgc2VydmVyVmVyc2lvbiBcdTIxOTIgd2FybiwgcXVvdGluZyB0aGUgcmF3IHZhbHVlLlxuICogIC0gU2VydmVyIGEgTUFKT1Igb3IgTUlOT1IgYWhlYWQgb2YgdGhlIGNsaWVudCBcdTIxOTIgd2FybiAocGF0Y2ggZ2FwcyBhcmVcbiAqICAgIGZpbmUpOyB0aGUgcHJvdG9jb2wgY2hlY2sgYWxyZWFkeSBndWFyZHMgYWN0dWFsIGluY29tcGF0aWJpbGl0eS5cbiAqICAtIFNlcnZlciBiZWxvdyBgTUlOX1NVUFBPUlRFRF9TRVJWRVJfVkVSU0lPTmAgXHUyMTkyIGVycm9yLlxuICogIC0gT3RoZXJ3aXNlIFx1MjE5MiBvay5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNoZWNrU2VydmVyQ29tcGF0aWJpbGl0eShcbiAgY2xpZW50VmVyc2lvbjogc3RyaW5nLFxuICBzZXJ2ZXJWZXJzaW9uOiBzdHJpbmcgfCBudWxsIHwgdW5kZWZpbmVkLFxuKTogQ29tcGF0aWJpbGl0eVZlcmRpY3Qge1xuICBpZiAoc2VydmVyVmVyc2lvbiA9PT0gbnVsbCB8fCBzZXJ2ZXJWZXJzaW9uID09PSB1bmRlZmluZWQgfHwgc2VydmVyVmVyc2lvbiA9PT0gJycpIHtcbiAgICByZXR1cm4ge1xuICAgICAgbGV2ZWw6ICd3YXJuJyxcbiAgICAgIG1lc3NhZ2U6ICdzeW5jIHNlcnZlciBwcmVkYXRlcyB2ZXJzaW9uIHJlcG9ydGluZyAoXFx1MjI2NCAwLjEpIFxcdTIwMTQgY29uc2lkZXIgdXBkYXRpbmcgaXQgKGRvY3MvVVBHUkFESU5HLm1kKScsXG4gICAgfTtcbiAgfVxuICBjb25zdCBzZXJ2ZXIgPSBwYXJzZVNlbVZlcihzZXJ2ZXJWZXJzaW9uKTtcbiAgaWYgKHNlcnZlciA9PT0gbnVsbCkge1xuICAgIHJldHVybiB7XG4gICAgICBsZXZlbDogJ3dhcm4nLFxuICAgICAgbWVzc2FnZTogYHNlcnZlciB2ZXJzaW9uICR7SlNPTi5zdHJpbmdpZnkoc2VydmVyVmVyc2lvbil9IGlzIG5vdCBzZW12ZXIgXFx1MjAxNCBjb21wYXRpYmlsaXR5IHVua25vd25gLFxuICAgIH07XG4gIH1cbiAgLy8gQSBjbGllbnQgdmVyc2lvbiB3ZSBjYW5ub3QgcGFyc2UgKGRldiBidWlsZHMsIFwidW5rbm93blwiKSBzaW1wbHkgc2tpcHMgdGhlXG4gIC8vIG5ld2VyLXNlcnZlciBjb21wYXJpc29uIHJhdGhlciB0aGFuIGZhaWxpbmcgdGhlIHdob2xlIGFzc2Vzc21lbnQuXG4gIGNvbnN0IGNsaWVudCA9IHBhcnNlU2VtVmVyKGNsaWVudFZlcnNpb24pO1xuICBpZiAoY2xpZW50ICE9PSBudWxsICYmIChzZXJ2ZXIubWFqb3IgPiBjbGllbnQubWFqb3IgfHwgc2VydmVyLm1pbm9yID4gY2xpZW50Lm1pbm9yKSkge1xuICAgIHJldHVybiB7XG4gICAgICBsZXZlbDogJ3dhcm4nLFxuICAgICAgbWVzc2FnZTogYHNlcnZlciAke3NlcnZlclZlcnNpb259IGlzIG5ld2VyIHRoYW4gdGhpcyBjbGllbnQgKCR7Y2xpZW50VmVyc2lvbn0pIFxcdTIwMTQgdXBkYXRlIHRoZSBjbGllbnQgd2hlbiBjb252ZW5pZW50YCxcbiAgICB9O1xuICB9XG4gIGNvbnN0IG1pbmltdW0gPSBwYXJzZVNlbVZlcihNSU5fU1VQUE9SVEVEX1NFUlZFUl9WRVJTSU9OKTtcbiAgaWYgKG1pbmltdW0gIT09IG51bGwgJiYgY29tcGFyZVNlbVZlcihzZXJ2ZXIsIG1pbmltdW0pIDwgMCkge1xuICAgIHJldHVybiB7XG4gICAgICBsZXZlbDogJ2Vycm9yJyxcbiAgICAgIG1lc3NhZ2U6IGBzZXJ2ZXIgJHtzZXJ2ZXJWZXJzaW9ufSBpcyBvbGRlciB0aGFuIHRoZSBtaW5pbXVtIHN1cHBvcnRlZCAoJHtNSU5fU1VQUE9SVEVEX1NFUlZFUl9WRVJTSU9OfSkgXFx1MjAxNCB1cGRhdGUgaXQ6IGRvY3MvVVBHUkFESU5HLm1kYCxcbiAgICB9O1xuICB9XG4gIHJldHVybiB7IGxldmVsOiAnb2snLCBtZXNzYWdlOiBgc2VydmVyICR7c2VydmVyVmVyc2lvbn0gd29ya3Mgd2l0aCB0aGlzIGNsaWVudCAoJHtjbGllbnRWZXJzaW9ufSlgIH07XG59XG4iLCAiLyoqXG4gKiBgT2JzaWRpYW5TdG9yYWdlQWRhcHRlcmAgXHUyMDE0IGNvcmUncyBgU3RvcmFnZUFkYXB0ZXJgIG92ZXIgdGhlIE9ic2lkaWFuIHZhdWx0XG4gKiBgRGF0YUFkYXB0ZXJgIChBUkNISVRFQ1RVUkUgXHUwMEE3OCBhZGFwdGVyczogcGx1Z2luIGltcGxlbWVudGF0aW9uLCBkZXNrdG9wIGFuZFxuICogbW9iaWxlIGFsaWtlKS5cbiAqXG4gKiBQYXRoIG1hcHBpbmc6IGV2ZXJ5IHBhdGggY3Jvc3NpbmcgdGhlIGNvcmUgc2VhbSBpcyBhIFBPU0lYLW5vcm1hbGl6ZWQgdmF1bHRcbiAqIHBhdGggKGAvbm90ZXMvYS5tZGAsIHJvb3QgYC9gKTsgdGhlIE9ic2lkaWFuIGFkYXB0ZXIgd2FudHMgdGhlIHNhbWUgcGF0aFxuICogKndpdGhvdXQqIHRoZSBsZWFkaW5nIHNsYXNoIChgbm90ZXMvYS5tZGApLCB3aXRoIGAvYCAob3IgYCcnYCkgZm9yIHRoZSByb290LlxuICpcbiAqIEFsbCB3cml0ZXMgZ28gdGhyb3VnaCB0aGUgYWRhcHRlciAobmV2ZXIgYHZhdWx0Lm1vZGlmeWAgb24gdGhlIHNpZGUpLCBzb1xuICogT2JzaWRpYW4ncyBvd24gZmlsZSB3YXRjaGluZyBvYnNlcnZlcyB0aGVtIGxpa2UgYW55IGV4dGVybmFsIGVkaXQgYW5kIG9wZW5cbiAqIGVkaXRvcnMgcmVmcmVzaCAoRlItMykuIFdyaXRlcyBhcmUgYXRvbWljLWlzaDogY29udGVudCBsYW5kcyBpbiBhIHRlbXAgZmlsZVxuICogdW5kZXIgYC8udmF1bHRzeW5jZm9yYWdlbnRzL3RtcC9gIChjb3JlIGlnbm9yZXMgdGhhdCB3aG9sZSBzdWJ0cmVlKSBhbmQgaXNcbiAqIHJlbmFtZWQgb250byB0aGUgdGFyZ2V0OyBpZiByZW5hbWluZyBpcyB1bmF2YWlsYWJsZSAoZXhvdGljIG1vYmlsZVxuICogYWRhcHRlcnMpLCB3ZSBmYWxsIGJhY2sgdG8gYSBkaXJlY3Qgd3JpdGUuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBEYXRhQWRhcHRlciB9IGZyb20gJ29ic2lkaWFuJztcbmltcG9ydCB0eXBlIHsgRmlsZVN0YXQsIFN0b3JhZ2VBZGFwdGVyIH0gZnJvbSAnQHZzYS9jb3JlJztcbmltcG9ydCB7IG5vcm1hbGl6ZVZhdWx0UGF0aCB9IGZyb20gJ0B2c2EvY29yZSc7XG5cbi8qKiBEaXJlY3RvcnkgKGluc2lkZSB0aGUgdmF1bHQpIGhvbGRpbmcgdGVtcCBmaWxlcyBkdXJpbmcgYXRvbWljIHdyaXRlcy4gKi9cbmV4cG9ydCBjb25zdCBURU1QX0RJUl9WQVVMVF9QQVRIID0gJy8udmF1bHRzeW5jZm9yYWdlbnRzL3RtcCc7XG5cbi8qKiBTdGF0cyBPYnNpZGlhbidzIGBEYXRhQWRhcHRlci5zdGF0YCByZXR1cm5zIGZvciBhIGZpbGUuICovXG5pbnRlcmZhY2UgQWRhcHRlclN0YXQge1xuICBzaXplOiBudW1iZXI7XG4gIG10aW1lOiBudW1iZXI7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgT2JzaWRpYW5TdG9yYWdlQWRhcHRlck9wdGlvbnMge1xuICBhZGFwdGVyOiBEYXRhQWRhcHRlcjtcbiAgLyoqXG4gICAqIERlc2t0b3AgYW5kIG1vYmlsZSBPYnNpZGlhbidzIGBEYXRhQWRhcHRlci5ybWRpcmAgaXMgZnMucm0tYmFzZWQgYW5kXG4gICAqIHJlZnVzZXMgRVZFUlkgZGlyZWN0b3J5IChgRVJSX0ZTX0VJU0RJUmApIFx1MjAxNCBpdCBjYW5ub3QgcmVtb3ZlIGV2ZW4gYW5cbiAgICogZW1wdHkgZm9sZGVyLCB3aGljaCBzaWxlbnRseSBkZWdyYWRlZCBldmVyeSBmb2xkZXItdG9tYnN0b25lIGFwcGxpY2F0aW9uXG4gICAqIHRvIHJlY29yZC1vbmx5ICh0aGUgRi0xIHBpbmctcG9uZykuIFdoZW4gcHJvdmlkZWQsIGByZW1vdmVEaXJgIHBlcmZvcm1zXG4gICAqIHRoZSBlbXB0eS1mb2xkZXIgcmVtb3ZhbCB0aHJvdWdoIHRoaXMgY2FsbGJhY2sgaW5zdGVhZCBcdTIwMTQgdGhlIHBsdWdpbiB3aXJlc1xuICAgKiBpdCB0byBgZmlsZU1hbmFnZXIudHJhc2hGaWxlYCBvbiB0aGUgdmF1bHQncyBURm9sZGVyLCB3aGljaCB3b3JrcyBhbmRcbiAgICogbmV2ZXIgZGVzdHJveXMgZGF0YSAoc3lzdGVtIHRyYXNoOyBjb3JlIHByZS1jaGVja3MgZW1wdGluZXNzIGFueXdheSkuXG4gICAqIFJlY2VpdmVzIHRoZSBBREFQVEVSIHBhdGggKG5vIGxlYWRpbmcgc2xhc2gpLlxuICAgKi9cbiAgcmVtb3ZlRW1wdHlEaXI/OiAoYWRhcHRlclBhdGg6IHN0cmluZykgPT4gUHJvbWlzZTx2b2lkPjtcbn1cblxuZXhwb3J0IGNsYXNzIE9ic2lkaWFuU3RvcmFnZUFkYXB0ZXIgaW1wbGVtZW50cyBTdG9yYWdlQWRhcHRlciB7XG4gIHByaXZhdGUgcmVhZG9ubHkgYWRhcHRlcjogRGF0YUFkYXB0ZXI7XG4gIHByaXZhdGUgcmVhZG9ubHkgcmVtb3ZlRW1wdHlEaXI/OiAoYWRhcHRlclBhdGg6IHN0cmluZykgPT4gUHJvbWlzZTx2b2lkPjtcbiAgLyoqXG4gICAqIExhdGNoZWQgd2hlbiBhIHRlbXArcmVuYW1lIGF0dGVtcHQgZmFpbHM6IGV2ZXJ5IGxhdGVyIHdyaXRlIGdvZXMgc3RyYWlnaHRcbiAgICogdG8gYHdyaXRlQmluYXJ5YCBpbnN0ZWFkIG9mIHBheWluZyB0aGUgZmFpbGluZy1yZW5hbWUgcGVuYWx0eSBhZ2Fpbi5cbiAgICovXG4gIHByaXZhdGUgdGVtcFJlbmFtZUJyb2tlbiA9IGZhbHNlO1xuICBwcml2YXRlIHRlbXBDb3VudGVyID0gMDtcblxuICBjb25zdHJ1Y3RvcihvcHRpb25zOiBPYnNpZGlhblN0b3JhZ2VBZGFwdGVyT3B0aW9ucykge1xuICAgIHRoaXMuYWRhcHRlciA9IG9wdGlvbnMuYWRhcHRlcjtcbiAgICB0aGlzLnJlbW92ZUVtcHR5RGlyID0gb3B0aW9ucy5yZW1vdmVFbXB0eURpcjtcbiAgfVxuXG4gIC8vIC0tLSBwYXRoIG1hcHBpbmcgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIC8qKiBWYXVsdCBwYXRoIFx1MjE5MiBhZGFwdGVyIHBhdGggKGAvYS9iLm1kYCBcdTIxOTIgYGEvYi5tZGAsIGAvYCBcdTIxOTIgYC9gKS4gKi9cbiAgcHJpdmF0ZSB0b0FkYXB0ZXJQYXRoKHZhdWx0UGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgICBjb25zdCBub3JtYWxpemVkID0gbm9ybWFsaXplVmF1bHRQYXRoKHZhdWx0UGF0aCk7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZWQgPT09ICcvJyA/ICcvJyA6IG5vcm1hbGl6ZWQuc2xpY2UoMSk7XG4gIH1cblxuICAvLyAtLS0gU3RvcmFnZUFkYXB0ZXIgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgYXN5bmMgcmVhZEZpbGUocGF0aDogc3RyaW5nKTogUHJvbWlzZTxVaW50OEFycmF5PiB7XG4gICAgY29uc3QgYnVmZmVyID0gYXdhaXQgdGhpcy5hZGFwdGVyLnJlYWRCaW5hcnkodGhpcy50b0FkYXB0ZXJQYXRoKHBhdGgpKTtcbiAgICByZXR1cm4gbmV3IFVpbnQ4QXJyYXkoYnVmZmVyKTtcbiAgfVxuXG4gIGFzeW5jIHdyaXRlRmlsZShwYXRoOiBzdHJpbmcsIGRhdGE6IFVpbnQ4QXJyYXkpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCB0YXJnZXQgPSB0aGlzLnRvQWRhcHRlclBhdGgocGF0aCk7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVQYXJlbnREaXJzKHRhcmdldCk7XG4gICAgLy8gQ29weSBpbnRvIGEgc3RhbmRhbG9uZSBBcnJheUJ1ZmZlcjogYGJ5dGVzLmJ1ZmZlcmAgbWF5IGJlIGEgcG9vbGVkXG4gICAgLy8gYnVmZmVyIGxhcmdlciB0aGFuIHRoZSB2aWV3IChjb3JlIHNsaWNlcyBhbmQgcmV1c2VzIGJ1ZmZlcnMpLlxuICAgIGNvbnN0IGJ1ZmZlciA9IG5ldyBBcnJheUJ1ZmZlcihkYXRhLmJ5dGVMZW5ndGgpO1xuICAgIG5ldyBVaW50OEFycmF5KGJ1ZmZlcikuc2V0KGRhdGEpO1xuXG4gICAgaWYgKHRoaXMudGVtcFJlbmFtZUJyb2tlbikge1xuICAgICAgYXdhaXQgdGhpcy5hZGFwdGVyLndyaXRlQmluYXJ5KHRhcmdldCwgYnVmZmVyKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgdGVtcCA9IGF3YWl0IHRoaXMudGVtcFBhdGgoKTtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5hZGFwdGVyLndyaXRlQmluYXJ5KHRlbXAsIGJ1ZmZlcik7XG4gICAgICBhd2FpdCB0aGlzLmFkYXB0ZXIucmVuYW1lKHRlbXAsIHRhcmdldCk7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBDbGVhbiB1cCB0aGUgb3JwaGFuZWQgdGVtcCAoYmVzdCBlZmZvcnQgXHUyMDE0IGl0IGxpdmVzIGluIHRoZSBpZ25vcmVkXG4gICAgICAvLyBzdGF0ZSBkaXIsIHNvIGV2ZW4gYSBsZWFrIGlzIGludmlzaWJsZSB0byBzeW5jKSwgdGhlbiBmYWxsIGJhY2sgdG9cbiAgICAgIC8vIGEgZGlyZWN0LCBub24tYXRvbWljIHdyaXRlIHJhdGhlciB0aGFuIGZhaWxpbmcgdGhlIHN5bmMuXG4gICAgICBhd2FpdCB0aGlzLnNpbGVudFJlbW92ZSh0ZW1wKTtcbiAgICAgIHRoaXMudGVtcFJlbmFtZUJyb2tlbiA9IHRydWU7XG4gICAgICBhd2FpdCB0aGlzLmFkYXB0ZXIud3JpdGVCaW5hcnkodGFyZ2V0LCBidWZmZXIpO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGRlbGV0ZUZpbGUocGF0aDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgdGFyZ2V0ID0gdGhpcy50b0FkYXB0ZXJQYXRoKHBhdGgpO1xuICAgIC8vIElkZW1wb3RlbnQgcGVyIHRoZSBhZGFwdGVyIGNvbnRyYWN0LlxuICAgIGlmICghKGF3YWl0IHRoaXMuYWRhcHRlci5leGlzdHModGFyZ2V0KSkpIHJldHVybjtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgdGhpcy5hZGFwdGVyLnJlbW92ZSh0YXJnZXQpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gTG9zdCBhIHJhY2Ugd2l0aCBhIGNvbmN1cnJlbnQgZGVsZXRlIFx1MjAxNCBvbmx5IHN1cmZhY2UgaWYgaXQgc3Vydml2ZXMuXG4gICAgICBpZiAoYXdhaXQgdGhpcy5hZGFwdGVyLmV4aXN0cyh0YXJnZXQpKSB0aHJvdyBuZXcgRXJyb3IoYGZhaWxlZCB0byBkZWxldGUgJHt0YXJnZXR9YCk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgcmVuYW1lRmlsZShmcm9tOiBzdHJpbmcsIHRvOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBmcm9tUGF0aCA9IHRoaXMudG9BZGFwdGVyUGF0aChmcm9tKTtcbiAgICBjb25zdCB0b1BhdGggPSB0aGlzLnRvQWRhcHRlclBhdGgodG8pO1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUGFyZW50RGlycyh0b1BhdGgpO1xuICAgIGF3YWl0IHRoaXMuYWRhcHRlci5yZW5hbWUoZnJvbVBhdGgsIHRvUGF0aCk7XG4gIH1cblxuICBhc3luYyBsaXN0RmlsZXMoKTogUHJvbWlzZTxyZWFkb25seSBGaWxlU3RhdFtdPiB7XG4gICAgY29uc3QgZmlsZXM6IEZpbGVTdGF0W10gPSBbXTtcbiAgICBhd2FpdCB0aGlzLndhbGtGaWxlcygnLycsIGFzeW5jIChhZGFwdGVyUGF0aCkgPT4ge1xuICAgICAgY29uc3Qgc3RhdCA9IGF3YWl0IHRoaXMuc3RhdE9yTnVsbChhZGFwdGVyUGF0aCk7XG4gICAgICBpZiAoc3RhdCA9PT0gbnVsbCkgcmV0dXJuOyAvLyB2YW5pc2hlZCBtaWQtd2Fsa1xuICAgICAgZmlsZXMucHVzaCh7XG4gICAgICAgIHBhdGg6IGAvJHthZGFwdGVyUGF0aH1gLFxuICAgICAgICBzaXplOiBzdGF0LnNpemUsXG4gICAgICAgIG10aW1lOiBzdGF0Lm10aW1lLFxuICAgICAgfSk7XG4gICAgfSk7XG4gICAgZmlsZXMuc29ydCgoYSwgYikgPT4gKGEucGF0aCA8IGIucGF0aCA/IC0xIDogYS5wYXRoID4gYi5wYXRoID8gMSA6IDApKTtcbiAgICByZXR1cm4gZmlsZXM7XG4gIH1cblxuICBhc3luYyBsaXN0RGlycygpOiBQcm9taXNlPHJlYWRvbmx5IHN0cmluZ1tdPiB7XG4gICAgY29uc3QgZGlyczogc3RyaW5nW10gPSBbJy8nXTtcbiAgICBhd2FpdCB0aGlzLndhbGtGb2xkZXJzKCcvJywgYXN5bmMgKGFkYXB0ZXJQYXRoKSA9PiB7XG4gICAgICBkaXJzLnB1c2goYC8ke2FkYXB0ZXJQYXRofWApO1xuICAgIH0pO1xuICAgIGRpcnMuc29ydCgoYSwgYikgPT4gKGEgPCBiID8gLTEgOiBhID4gYiA/IDEgOiAwKSk7XG4gICAgcmV0dXJuIGRpcnM7XG4gIH1cblxuICBhc3luYyBlbnN1cmVEaXIocGF0aDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IG5vcm1hbGl6ZVZhdWx0UGF0aChwYXRoKTtcbiAgICBjb25zdCBzZWdtZW50cyA9IG5vcm1hbGl6ZWQgPT09ICcvJyA/IFtdIDogbm9ybWFsaXplZC5zbGljZSgxKS5zcGxpdCgnLycpO1xuICAgIGxldCBjdXJyZW50ID0gJyc7XG4gICAgZm9yIChjb25zdCBzZWdtZW50IG9mIHNlZ21lbnRzKSB7XG4gICAgICBjdXJyZW50ID0gY3VycmVudCA9PT0gJycgPyBzZWdtZW50IDogYCR7Y3VycmVudH0vJHtzZWdtZW50fWA7XG4gICAgICBpZiAoIShhd2FpdCB0aGlzLmFkYXB0ZXIuZXhpc3RzKGN1cnJlbnQpKSkgYXdhaXQgdGhpcy5hZGFwdGVyLm1rZGlyKGN1cnJlbnQpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZW1vdmUgYW4gRU1QVFkgZGlyZWN0b3J5ICh0aGUgYFN0b3JhZ2VBZGFwdGVyLnJlbW92ZURpcmAgY29udHJhY3QpLlxuICAgKiBQcmVmZXJzIHRoZSB2YXVsdC1BUEkgY2FsbGJhY2sgKGByZW1vdmVFbXB0eURpcmAgXHUyMDE0IHNlZSB0aGUgb3B0aW9uJ3MgZG9jXG4gICAqIGZvciB3aHkgYERhdGFBZGFwdGVyLnJtZGlyYCBjYW5ub3QgZG8gdGhpcyk7IGZhbGxzIGJhY2sgdG8gYHJtZGlyYCBmb3JcbiAgICogYmFyZSBhZGFwdGVycyAodGVzdHMpLiBNaXNzaW5nIHBhdGggXHUyMUQyIG5vLW9wIChpZGVtcG90ZW50KTsgdGhlIHZhdWx0IHJvb3RcbiAgICogaXMgbmV2ZXIgcmVtb3ZhYmxlOyBhIG5vbi1lbXB0eSByZWZ1c2FsIHByb3BhZ2F0ZXMgKGNvcmUgdHJlYXRzIGl0IGFzXG4gICAqIHJlY29yZC1vbmx5IFx1MjAxNCBuZXZlciBkYXRhIGxvc3MpLlxuICAgKi9cbiAgYXN5bmMgcmVtb3ZlRGlyKHBhdGg6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVWYXVsdFBhdGgocGF0aCk7XG4gICAgaWYgKG5vcm1hbGl6ZWQgPT09ICcvJykgcmV0dXJuOyAvLyBuZXZlciB0b3VjaCB0aGUgdmF1bHQgcm9vdFxuICAgIGNvbnN0IHRhcmdldCA9IHRoaXMudG9BZGFwdGVyUGF0aChub3JtYWxpemVkKTtcbiAgICAvLyBJZGVtcG90ZW50IHBlciB0aGUgYWRhcHRlciBjb250cmFjdC5cbiAgICBpZiAoIShhd2FpdCB0aGlzLmFkYXB0ZXIuZXhpc3RzKHRhcmdldCkpKSByZXR1cm47XG4gICAgaWYgKHRoaXMucmVtb3ZlRW1wdHlEaXIgIT09IHVuZGVmaW5lZCkge1xuICAgICAgYXdhaXQgdGhpcy5yZW1vdmVFbXB0eURpcih0YXJnZXQpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBhd2FpdCB0aGlzLmFkYXB0ZXIucm1kaXIodGFyZ2V0LCBmYWxzZSk7XG4gIH1cblxuICBhc3luYyBleGlzdHMocGF0aDogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IG5vcm1hbGl6ZVZhdWx0UGF0aChwYXRoKTtcbiAgICBpZiAobm9ybWFsaXplZCA9PT0gJy8nKSByZXR1cm4gdHJ1ZTsgLy8gdGhlIHZhdWx0IHJvb3QgYWx3YXlzIGV4aXN0c1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5hZGFwdGVyLmV4aXN0cyh0aGlzLnRvQWRhcHRlclBhdGgobm9ybWFsaXplZCkpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIC8vIC0tLSBoZWxwZXJzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICBwcml2YXRlIGFzeW5jIHN0YXRPck51bGwoYWRhcHRlclBhdGg6IHN0cmluZyk6IFByb21pc2U8QWRhcHRlclN0YXQgfCBudWxsPiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHN0YXQgPSBhd2FpdCB0aGlzLmFkYXB0ZXIuc3RhdChhZGFwdGVyUGF0aCk7XG4gICAgICBpZiAoc3RhdCA9PT0gbnVsbCB8fCBzdGF0LnR5cGUgIT09ICdmaWxlJykgcmV0dXJuIG51bGw7XG4gICAgICByZXR1cm4geyBzaXplOiBzdGF0LnNpemUsIG10aW1lOiBzdGF0Lm10aW1lIH07XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gIH1cblxuICAvKiogQSB1bmlxdWUgdGVtcCBwYXRoIGluc2lkZSB0aGUgKHN5bmMtaWdub3JlZCkgY2xpZW50IHN0YXRlIGRpci4gKi9cbiAgcHJpdmF0ZSBhc3luYyB0ZW1wUGF0aCgpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlRGlyKFRFTVBfRElSX1ZBVUxUX1BBVEgpO1xuICAgIHRoaXMudGVtcENvdW50ZXIgKz0gMTtcbiAgICByZXR1cm4gYCR7VEVNUF9ESVJfVkFVTFRfUEFUSC5zbGljZSgxKX0vdy0ke0RhdGUubm93KCkudG9TdHJpbmcoMzYpfS0ke3RoaXMudGVtcENvdW50ZXJ9LnRtcGA7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHNpbGVudFJlbW92ZShhZGFwdGVyUGF0aDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuYWRhcHRlci5yZW1vdmUoYWRhcHRlclBhdGgpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gYmVzdCBlZmZvcnRcbiAgICB9XG4gIH1cblxuICAvKiogQ3JlYXRlIGV2ZXJ5IGFuY2VzdG9yIGRpcmVjdG9yeSBvZiBhbiBhZGFwdGVyIGZpbGUgcGF0aC4gKi9cbiAgcHJpdmF0ZSBhc3luYyBlbnN1cmVQYXJlbnREaXJzKGFkYXB0ZXJQYXRoOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBzbGFzaCA9IGFkYXB0ZXJQYXRoLmxhc3RJbmRleE9mKCcvJyk7XG4gICAgaWYgKHNsYXNoIDw9IDApIHJldHVybjsgLy8gdmF1bHQgcm9vdCBcdTIwMTQgYWx3YXlzIGV4aXN0c1xuICAgIGNvbnN0IHBhcmVudCA9IGFkYXB0ZXJQYXRoLnNsaWNlKDAsIHNsYXNoKTtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZURpcihgLyR7cGFyZW50fWApO1xuICB9XG5cbiAgLyoqIFJlY3Vyc2l2ZWx5IHZpc2l0IGV2ZXJ5IGZpbGUgdW5kZXIgYGRpckFkYXB0ZXJQYXRoYCAoYWRhcHRlciBwYXRocykuICovXG4gIHByaXZhdGUgYXN5bmMgd2Fsa0ZpbGVzKFxuICAgIGRpckFkYXB0ZXJQYXRoOiBzdHJpbmcsXG4gICAgdmlzaXQ6IChhZGFwdGVyUGF0aDogc3RyaW5nKSA9PiBQcm9taXNlPHZvaWQ+LFxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBsZXQgbGlzdGluZztcbiAgICB0cnkge1xuICAgICAgbGlzdGluZyA9IGF3YWl0IHRoaXMuYWRhcHRlci5saXN0KGRpckFkYXB0ZXJQYXRoKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybjsgLy8gdW5yZWFkYWJsZS9taXNzaW5nIFx1MjAxNCB0cmVhdCBhcyBlbXB0eVxuICAgIH1cbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgbGlzdGluZy5maWxlcykgYXdhaXQgdmlzaXQoZmlsZSk7XG4gICAgZm9yIChjb25zdCBmb2xkZXIgb2YgbGlzdGluZy5mb2xkZXJzKSBhd2FpdCB0aGlzLndhbGtGaWxlcyhmb2xkZXIsIHZpc2l0KTtcbiAgfVxuXG4gIC8qKiBSZWN1cnNpdmVseSB2aXNpdCBldmVyeSBmb2xkZXIgdW5kZXIgYGRpckFkYXB0ZXJQYXRoYCAoYWRhcHRlciBwYXRocykuICovXG4gIHByaXZhdGUgYXN5bmMgd2Fsa0ZvbGRlcnMoXG4gICAgZGlyQWRhcHRlclBhdGg6IHN0cmluZyxcbiAgICB2aXNpdDogKGFkYXB0ZXJQYXRoOiBzdHJpbmcpID0+IFByb21pc2U8dm9pZD4sXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGxldCBsaXN0aW5nO1xuICAgIHRyeSB7XG4gICAgICBsaXN0aW5nID0gYXdhaXQgdGhpcy5hZGFwdGVyLmxpc3QoZGlyQWRhcHRlclBhdGgpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBmb3IgKGNvbnN0IGZvbGRlciBvZiBsaXN0aW5nLmZvbGRlcnMpIHtcbiAgICAgIGF3YWl0IHZpc2l0KGZvbGRlcik7XG4gICAgICBhd2FpdCB0aGlzLndhbGtGb2xkZXJzKGZvbGRlciwgdmlzaXQpO1xuICAgIH1cbiAgfVxufVxuIiwgIi8qKlxuICogYE9ic2lkaWFuV2F0Y2hBZGFwdGVyYCArIGBSZXNjYW5TY2hlZHVsZXJgIFx1MjAxNCBjb3JlJ3MgYFdhdGNoQWRhcHRlcmAgb3ZlclxuICogT2JzaWRpYW4gdmF1bHQgZXZlbnRzIChBUkNISVRFQ1RVUkUgXHUwMEE3OCBhZGFwdGVycyksIHBsdXMgdGhlIHBlcmlvZGljIC9cbiAqIGZvY3VzLWRyaXZlbiByZWNvbmNpbGlhdGlvbiBob29rcyB0aGUgbW9iaWxlICYgZXh0ZXJuYWwtZWRpdCBzdG9yaWVzIG5lZWRcbiAqIChcdTAwQTc4IFwiTW9iaWxlXCIsIEZSLTUsIEZSLTEyKS5cbiAqXG4gKiBWYXVsdCBldmVudHMgY292ZXIgZXZlcnl0aGluZyBPYnNpZGlhbiBpdHNlbGYgb2JzZXJ2ZXMgXHUyMDE0IGluLWFwcCBlZGl0cyxcbiAqIGRyYWctZHJvcHMsIGFuZCBleHRlcm5hbCBlZGl0cyBtYWRlIHdoaWxlIE9ic2lkaWFuIGlzICpvcGVuKi4gRWRpdHMgbWFkZVxuICogd2hpbGUgT2JzaWRpYW4gd2FzIGNsb3NlZCBhcmUgcGlja2VkIHVwIGJ5IHRoZSBzdGFydHVwIHJlY29uY2lsaWF0aW9uIGFuZFxuICogYnkgdGhlIHBlcmlvZGljIHJlc2NhbiB3aXJlZCBoZXJlOlxuICpcbiAqICAgdmF1bHQgZXZlbnRzIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjVCQSBXYXRjaEFkYXB0ZXIuc3RhcnQoY2IpIFx1MjUwMFx1MjVCQSBTeW5jQ2xpZW50IGRlYm91bmNlZCBjeWNsZVxuICogICBzZXRJbnRlcnZhbCAoZGVmYXVsdCAzMHMpIFx1MjUwMFx1MjVCQSBSZXNjYW5TY2hlZHVsZXIgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNUJBIFN5bmNDbGllbnQudHJpZ2dlclN5bmMoKVxuICogICBhY3RpdmUtbGVhZi1jaGFuZ2UgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNUJBIFJlc2NhblNjaGVkdWxlci5wb2tlKCkgXHUyNTAwXHUyNTAwXHUyNUJBIChzaG9ydCBkZWJvdW5jZSwgdGhlbiBhIGN5Y2xlKVxuICovXG5cbmltcG9ydCB0eXBlIHsgRXZlbnRSZWYsIFRBYnN0cmFjdEZpbGUsIFZhdWx0IH0gZnJvbSAnb2JzaWRpYW4nO1xuaW1wb3J0IHR5cGUgeyBGaWxlQ2hhbmdlRXZlbnQsIFdhdGNoQWRhcHRlciB9IGZyb20gJ0B2c2EvY29yZSc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgT2JzaWRpYW5XYXRjaEFkYXB0ZXJPcHRpb25zIHtcbiAgdmF1bHQ6IFZhdWx0O1xufVxuXG5leHBvcnQgY2xhc3MgT2JzaWRpYW5XYXRjaEFkYXB0ZXIgaW1wbGVtZW50cyBXYXRjaEFkYXB0ZXIge1xuICBwcml2YXRlIHJlYWRvbmx5IHZhdWx0OiBWYXVsdDtcbiAgcHJpdmF0ZSByZWZzOiBFdmVudFJlZltdID0gW107XG4gIHByaXZhdGUgZW1pdDogKChldmVudHM6IHJlYWRvbmx5IEZpbGVDaGFuZ2VFdmVudFtdKSA9PiB2b2lkKSB8IG51bGwgPSBudWxsO1xuXG4gIGNvbnN0cnVjdG9yKG9wdGlvbnM6IE9ic2lkaWFuV2F0Y2hBZGFwdGVyT3B0aW9ucykge1xuICAgIHRoaXMudmF1bHQgPSBvcHRpb25zLnZhdWx0O1xuICB9XG5cbiAgc3RhcnQoY2I6IChldmVudHM6IHJlYWRvbmx5IEZpbGVDaGFuZ2VFdmVudFtdKSA9PiB2b2lkKTogdm9pZCB7XG4gICAgdGhpcy5zdG9wKCk7XG4gICAgdGhpcy5lbWl0ID0gY2I7XG4gICAgLy8gQm90aCBmaWxlcyBhbmQgZm9sZGVycyBhcmUgZm9yd2FyZGVkOiBmb2xkZXIgZXZlbnRzIChjcmVhdGUvcmVuYW1lL1xuICAgIC8vIGRlbGV0ZSkgdHJpZ2dlciB0aGUgcmVjb25jaWxpYXRpb24gc2NhbiB0aGF0IGRpc2NvdmVycyBlbXB0eS1mb2xkZXJcbiAgICAvLyBwbGFjZWhvbGRlciBjaGFuZ2VzIChGUi0xMCkuIFRoZSBlbmdpbmUgZmlsdGVycyBpZ25vcmVkIHBhdGhzIGl0c2VsZi5cbiAgICB0aGlzLnJlZnMgPSBbXG4gICAgICB0aGlzLnZhdWx0Lm9uKCdjcmVhdGUnLCAoZmlsZTogVEFic3RyYWN0RmlsZSkgPT4ge1xuICAgICAgICB0aGlzLmZvcndhcmQoeyBraW5kOiAnYWRkJywgcGF0aDogdmF1bHRQYXRoT2YoZmlsZSkgfSk7XG4gICAgICB9KSxcbiAgICAgIHRoaXMudmF1bHQub24oJ21vZGlmeScsIChmaWxlOiBUQWJzdHJhY3RGaWxlKSA9PiB7XG4gICAgICAgIHRoaXMuZm9yd2FyZCh7IGtpbmQ6ICdtb2RpZnknLCBwYXRoOiB2YXVsdFBhdGhPZihmaWxlKSB9KTtcbiAgICAgIH0pLFxuICAgICAgdGhpcy52YXVsdC5vbignZGVsZXRlJywgKGZpbGU6IFRBYnN0cmFjdEZpbGUpID0+IHtcbiAgICAgICAgdGhpcy5mb3J3YXJkKHsga2luZDogJ2RlbGV0ZScsIHBhdGg6IHZhdWx0UGF0aE9mKGZpbGUpIH0pO1xuICAgICAgfSksXG4gICAgICB0aGlzLnZhdWx0Lm9uKCdyZW5hbWUnLCAoZmlsZTogVEFic3RyYWN0RmlsZSwgb2xkUGF0aDogc3RyaW5nKSA9PiB7XG4gICAgICAgIC8vIGBvbGRQYXRoYCBcdTIxOTIgYGZpbGUucGF0aGA6IHRoZSBlbnRyeSBhdCBgcGF0aGAgbW92ZWQgdG8gYHRvUGF0aGAuXG4gICAgICAgIHRoaXMuZm9yd2FyZCh7IGtpbmQ6ICdyZW5hbWUnLCBwYXRoOiBgLyR7b2xkUGF0aH1gLCB0b1BhdGg6IHZhdWx0UGF0aE9mKGZpbGUpIH0pO1xuICAgICAgfSksXG4gICAgXTtcbiAgfVxuXG4gIHN0b3AoKTogdm9pZCB7XG4gICAgZm9yIChjb25zdCByZWYgb2YgdGhpcy5yZWZzKSB0aGlzLnZhdWx0Lm9mZnJlZihyZWYpO1xuICAgIHRoaXMucmVmcyA9IFtdO1xuICAgIHRoaXMuZW1pdCA9IG51bGw7XG4gIH1cblxuICBwcml2YXRlIGZvcndhcmQoZXZlbnQ6IEZpbGVDaGFuZ2VFdmVudCk6IHZvaWQge1xuICAgIHRoaXMuZW1pdD8uKFtldmVudF0pO1xuICB9XG59XG5cbi8qKiBWYXVsdCBldmVudCBwYXRoIChhZGFwdGVyLW5vcm1hbGl6ZWQsIG5vIGxlYWRpbmcgc2xhc2gpIFx1MjE5MiBjb3JlIHZhdWx0IHBhdGguICovXG5mdW5jdGlvbiB2YXVsdFBhdGhPZihmaWxlOiBUQWJzdHJhY3RGaWxlKTogc3RyaW5nIHtcbiAgcmV0dXJuIGZpbGUucGF0aC5zdGFydHNXaXRoKCcvJykgPyBmaWxlLnBhdGggOiBgLyR7ZmlsZS5wYXRofWA7XG59XG5cbi8vIC0tLSBSZXNjYW5TY2hlZHVsZXIgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBSZXNjYW5TY2hlZHVsZXJPcHRpb25zIHtcbiAgLyoqIFBlcmlvZCBiZXR3ZWVuIGZ1bGwgcmVzY2FucyBpbiBtczsgYDBgIGRpc2FibGVzIHRoZSBwZXJpb2RpYyB0aW1lci4gKi9cbiAgaW50ZXJ2YWxNczogbnVtYmVyO1xuICAvKiogRGVib3VuY2Ugd2luZG93IGZvciBgcG9rZSgpYCAoYWN0aXZlLWxlYWYtY2hhbmdlKSwgZGVmYXVsdCAzMDAwIG1zLiAqL1xuICBwb2tlRGVsYXlNcz86IG51bWJlcjtcbiAgLyoqIEluamVjdGFibGUgdGltZXIgc2VhbXMgKHRlc3RzIHVzZSBmYWtlIHRpbWVycyBhZ2FpbnN0IHRoZSBnbG9iYWxzKS4gKi9cbiAgc2V0SW50ZXJ2YWxJbXBsPzogKGZuOiAoKSA9PiB2b2lkLCBtczogbnVtYmVyKSA9PiB1bmtub3duO1xuICBjbGVhckludGVydmFsSW1wbD86IChoYW5kbGU6IHVua25vd24pID0+IHZvaWQ7XG4gIHNldFRpbWVvdXRJbXBsPzogKGZuOiAoKSA9PiB2b2lkLCBtczogbnVtYmVyKSA9PiB1bmtub3duO1xuICBjbGVhclRpbWVvdXRJbXBsPzogKGhhbmRsZTogdW5rbm93bikgPT4gdm9pZDtcbn1cblxuLyoqXG4gKiBEcml2ZXMgcGVyaW9kaWMgKyBmb2N1cy10cmlnZ2VyZWQgZnVsbCByZWNvbmNpbGlhdGlvbiBjeWNsZXMuIE5vdCBhXG4gKiBgV2F0Y2hBZGFwdGVyYCBpdHNlbGYgXHUyMDE0IGl0cyBgcnVuYCBjYWxsYmFjayBpcyB3aXJlZCB0b1xuICogYFN5bmNDbGllbnQudHJpZ2dlclN5bmMoKWAgYnkgdGhlIHBsdWdpbiAoYSByZXNjYW4gaXMgYSBmdWxsIGN5Y2xlLCBub3QgYVxuICogc2luZ2xlIGZpbGUgZXZlbnQpLlxuICovXG5leHBvcnQgY2xhc3MgUmVzY2FuU2NoZWR1bGVyIHtcbiAgcHJpdmF0ZSByZWFkb25seSBwb2tlRGVsYXlNczogbnVtYmVyO1xuICBwcml2YXRlIHJlYWRvbmx5IHNldEludGVydmFsSW1wbDogKGZuOiAoKSA9PiB2b2lkLCBtczogbnVtYmVyKSA9PiB1bmtub3duO1xuICBwcml2YXRlIHJlYWRvbmx5IGNsZWFySW50ZXJ2YWxJbXBsOiAoaGFuZGxlOiB1bmtub3duKSA9PiB2b2lkO1xuICBwcml2YXRlIHJlYWRvbmx5IHNldFRpbWVvdXRJbXBsOiAoZm46ICgpID0+IHZvaWQsIG1zOiBudW1iZXIpID0+IHVua25vd247XG4gIHByaXZhdGUgcmVhZG9ubHkgY2xlYXJUaW1lb3V0SW1wbDogKGhhbmRsZTogdW5rbm93bikgPT4gdm9pZDtcblxuICBwcml2YXRlIHJ1bjogKCgpID0+IHZvaWQpIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgaW50ZXJ2YWxIYW5kbGU6IHVua25vd24gPSBudWxsO1xuICBwcml2YXRlIGludGVydmFsTXM6IG51bWJlcjtcbiAgcHJpdmF0ZSBwb2tlSGFuZGxlOiB1bmtub3duID0gbnVsbDtcblxuICBjb25zdHJ1Y3RvcihvcHRpb25zOiBSZXNjYW5TY2hlZHVsZXJPcHRpb25zKSB7XG4gICAgdGhpcy5pbnRlcnZhbE1zID0gb3B0aW9ucy5pbnRlcnZhbE1zO1xuICAgIHRoaXMucG9rZURlbGF5TXMgPSBvcHRpb25zLnBva2VEZWxheU1zID8/IDMwMDA7XG4gICAgdGhpcy5zZXRJbnRlcnZhbEltcGwgPSBvcHRpb25zLnNldEludGVydmFsSW1wbCA/PyAoKGZuLCBtcykgPT4gc2V0SW50ZXJ2YWwoZm4sIG1zKSk7XG4gICAgdGhpcy5jbGVhckludGVydmFsSW1wbCA9IG9wdGlvbnMuY2xlYXJJbnRlcnZhbEltcGwgPz8gKChoYW5kbGUpID0+IGNsZWFySW50ZXJ2YWwoaGFuZGxlIGFzIG51bWJlcikpO1xuICAgIHRoaXMuc2V0VGltZW91dEltcGwgPSBvcHRpb25zLnNldFRpbWVvdXRJbXBsID8/ICgoZm4sIG1zKSA9PiBzZXRUaW1lb3V0KGZuLCBtcykpO1xuICAgIHRoaXMuY2xlYXJUaW1lb3V0SW1wbCA9IG9wdGlvbnMuY2xlYXJUaW1lb3V0SW1wbCA/PyAoKGhhbmRsZSkgPT4gY2xlYXJUaW1lb3V0KGhhbmRsZSBhcyBudW1iZXIpKTtcbiAgfVxuXG4gIC8qKiBCZWdpbiBwZXJpb2RpYyByZXNjYW5zOyBgcnVuYCBtdXN0IGJlIHNhZmUgdG8gY2FsbCBhdCBhbnkgdGltZS4gKi9cbiAgc3RhcnQocnVuOiAoKSA9PiB2b2lkKTogdm9pZCB7XG4gICAgdGhpcy5zdG9wKCk7XG4gICAgdGhpcy5ydW4gPSBydW47XG4gICAgdGhpcy5hcm1JbnRlcnZhbCgpO1xuICB9XG5cbiAgc3RvcCgpOiB2b2lkIHtcbiAgICB0aGlzLmNsZWFySW50ZXJ2YWxJbXBsS2VlcCgpO1xuICAgIGlmICh0aGlzLnBva2VIYW5kbGUgIT09IG51bGwpIHtcbiAgICAgIHRoaXMuY2xlYXJUaW1lb3V0SW1wbCh0aGlzLnBva2VIYW5kbGUpO1xuICAgICAgdGhpcy5wb2tlSGFuZGxlID0gbnVsbDtcbiAgICB9XG4gICAgdGhpcy5ydW4gPSBudWxsO1xuICB9XG5cbiAgLyoqIENoYW5nZSB0aGUgcGVyaW9kaWMgaW50ZXJ2YWwgbGl2ZSAodGhlIHNldHRpbmdzLXRhYiB0b2dnbGUpLiAqL1xuICBzZXRJbnRlcnZhbE1zKG1zOiBudW1iZXIpOiB2b2lkIHtcbiAgICB0aGlzLmludGVydmFsTXMgPSBtcztcbiAgICBpZiAodGhpcy5ydW4gIT09IG51bGwpIHtcbiAgICAgIHRoaXMuY2xlYXJJbnRlcnZhbEltcGxLZWVwKCk7XG4gICAgICB0aGlzLmFybUludGVydmFsKCk7XG4gICAgfVxuICB9XG5cbiAgLyoqIEEgZm9jdXMvYXBwLXN3aXRjaCBzaWduYWwgKGFjdGl2ZS1sZWFmLWNoYW5nZSk6IHJlc2NhbiBzb29uLCBjb2FsZXNjZWQuICovXG4gIHBva2UoKTogdm9pZCB7XG4gICAgaWYgKHRoaXMucnVuID09PSBudWxsKSByZXR1cm47XG4gICAgaWYgKHRoaXMucG9rZUhhbmRsZSAhPT0gbnVsbCkgcmV0dXJuOyAvLyBhbHJlYWR5IHNjaGVkdWxlZFxuICAgIHRoaXMucG9rZUhhbmRsZSA9IHRoaXMuc2V0VGltZW91dEltcGwoKCkgPT4ge1xuICAgICAgdGhpcy5wb2tlSGFuZGxlID0gbnVsbDtcbiAgICAgIHRoaXMucnVuPy4oKTtcbiAgICB9LCB0aGlzLnBva2VEZWxheU1zKTtcbiAgfVxuXG4gIGdldCBpbnRlcnZhbE1zVmFsdWUoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy5pbnRlcnZhbE1zO1xuICB9XG5cbiAgcHJpdmF0ZSBhcm1JbnRlcnZhbCgpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5pbnRlcnZhbE1zIDw9IDAgfHwgdGhpcy5ydW4gPT09IG51bGwpIHJldHVybjtcbiAgICB0aGlzLmludGVydmFsSGFuZGxlID0gdGhpcy5zZXRJbnRlcnZhbEltcGwoKCkgPT4gdGhpcy5ydW4/LigpLCB0aGlzLmludGVydmFsTXMpO1xuICB9XG5cbiAgcHJpdmF0ZSBjbGVhckludGVydmFsSW1wbEtlZXAoKTogdm9pZCB7XG4gICAgaWYgKHRoaXMuaW50ZXJ2YWxIYW5kbGUgIT09IG51bGwpIHtcbiAgICAgIHRoaXMuY2xlYXJJbnRlcnZhbEltcGwodGhpcy5pbnRlcnZhbEhhbmRsZSk7XG4gICAgICB0aGlzLmludGVydmFsSGFuZGxlID0gbnVsbDtcbiAgICB9XG4gIH1cbn1cbiIsICIvKipcbiAqIGBIdHRwQmxvYlN0b3JlYCBcdTIwMTQgY29yZSdzIGBCbG9iU3RvcmVgIGFnYWluc3QgdGhlIHdvcmtlcidzIGAvYmxvYi86aGFzaGBcbiAqIHJvdXRlcyAoQVJDSElURUNUVVJFIFx1MDBBNzUgSFRUUFMgcm91dGVzKSwgYXV0aGVudGljYXRlZCB3aXRoIHRoZSBkZXZpY2UgdG9rZW5cbiAqIGFzIGEgQmVhcmVyIGhlYWRlci4gQnVpbHQgb24gdGhlIGdsb2JhbCBgZmV0Y2hgIChPYnNpZGlhbiBkZXNrdG9wIGFuZFxuICogbW9iaWxlKSwgaW5qZWN0YWJsZSBmb3IgdGVzdHMuIFBsdWdpbi1sb2NhbCB0d2luIG9mIHRoZSBub2RlLXJ1bnRpbWUgb25lOlxuICogbm8gaW1wb3J0cyBmcm9tIGBAdnNhL25vZGUtcnVudGltZWAgKE5vZGUtb25seSBwYWNrYWdlKS5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IEJsb2JTdG9yZSB9IGZyb20gJ0B2c2EvY29yZSc7XG5cbi8qKiBOb24tMnh4IGJsb2Itcm91dGUgcmVwbHkuIGBzdGF0dXNgIGlzIHRoZSBIVFRQIHN0YXR1cyBjb2RlLiAqL1xuZXhwb3J0IGNsYXNzIEh0dHBCbG9iRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIGNvbnN0cnVjdG9yKFxuICAgIHJlYWRvbmx5IHN0YXR1czogbnVtYmVyLFxuICAgIG1lc3NhZ2U6IHN0cmluZyxcbiAgKSB7XG4gICAgc3VwZXIobWVzc2FnZSk7XG4gICAgdGhpcy5uYW1lID0gJ0h0dHBCbG9iRXJyb3InO1xuICB9XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgSHR0cEJsb2JTdG9yZU9wdGlvbnMge1xuICAvKiogV29ya2VyIG9yaWdpbiwgZS5nLiBgaHR0cHM6Ly9wZXJzb25hbC54LndvcmtlcnMuZGV2YC4gKi9cbiAgYmFzZVVybDogc3RyaW5nO1xuICAvKiogRGV2aWNlIHRva2VuIChCZWFyZXIpLiAqL1xuICB0b2tlbjogc3RyaW5nO1xuICAvKiogSW5qZWN0YWJsZSBmZXRjaCAodGVzdHMpLiBEZWZhdWx0cyB0byB0aGUgZ2xvYmFsLiAqL1xuICBmZXRjaEltcGw/OiB0eXBlb2YgZmV0Y2g7XG59XG5cbmV4cG9ydCBjbGFzcyBIdHRwQmxvYlN0b3JlIGltcGxlbWVudHMgQmxvYlN0b3JlIHtcbiAgcHJpdmF0ZSByZWFkb25seSBiYXNlOiBzdHJpbmc7XG4gIHByaXZhdGUgcmVhZG9ubHkgdG9rZW46IHN0cmluZztcbiAgcHJpdmF0ZSByZWFkb25seSBkb0ZldGNoOiB0eXBlb2YgZmV0Y2g7XG5cbiAgY29uc3RydWN0b3Iob3B0aW9uczogSHR0cEJsb2JTdG9yZU9wdGlvbnMpIHtcbiAgICB0aGlzLmJhc2UgPSBvcHRpb25zLmJhc2VVcmwucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG4gICAgdGhpcy50b2tlbiA9IG9wdGlvbnMudG9rZW47XG4gICAgLy8gQm91bmQgbGlrZSB0aGUgcGx1Z2luJ3MgYGZldGNoSW1wbGAgc2VhbTogdGhpcyBjbGFzcyBjYWxscyBgZG9GZXRjaGBcbiAgICAvLyBkZXRhY2hlZCwgYW5kIGEgYmFyZSBnbG9iYWwgYGZldGNoYCBpcyBhbiBpbGxlZ2FsIGludm9jYXRpb24gaW5cbiAgICAvLyBDaHJvbWl1bSByZW5kZXJlcnMgKHJlYWwgT2JzaWRpYW4pLlxuICAgIHRoaXMuZG9GZXRjaCA9IG9wdGlvbnMuZmV0Y2hJbXBsID8/IGdsb2JhbFRoaXMuZmV0Y2guYmluZChnbG9iYWxUaGlzKTtcbiAgfVxuXG4gIC8qKiBHRVQgL2Jsb2IvOmhhc2ggXHUyMTkyIGJ5dGVzLCBvciBgdW5kZWZpbmVkYCBvbiA0MDQuICovXG4gIGFzeW5jIGdldChoYXNoOiBzdHJpbmcpOiBQcm9taXNlPFVpbnQ4QXJyYXkgfCB1bmRlZmluZWQ+IHtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMuZG9GZXRjaChgJHt0aGlzLmJhc2V9L2Jsb2IvJHtoYXNofWAsIHtcbiAgICAgIGhlYWRlcnM6IHsgYXV0aG9yaXphdGlvbjogYEJlYXJlciAke3RoaXMudG9rZW59YCB9LFxuICAgIH0pO1xuICAgIGlmIChyZXNwb25zZS5zdGF0dXMgPT09IDQwNCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICBpZiAoIXJlc3BvbnNlLm9rKSB7XG4gICAgICB0aHJvdyBuZXcgSHR0cEJsb2JFcnJvcihyZXNwb25zZS5zdGF0dXMsIGF3YWl0IGVycm9yTWVzc2FnZShyZXNwb25zZSwgJ2ZldGNoIGJsb2InKSk7XG4gICAgfVxuICAgIHJldHVybiBuZXcgVWludDhBcnJheShhd2FpdCByZXNwb25zZS5hcnJheUJ1ZmZlcigpKTtcbiAgfVxuXG4gIC8qKiBQVVQgL2Jsb2IvOmhhc2ggXHUyMDE0IGlkZW1wb3RlbnQgcGVyIHRoZSBDQVMgY29udHJhY3QuICovXG4gIGFzeW5jIHB1dChoYXNoOiBzdHJpbmcsIGJ5dGVzOiBVaW50OEFycmF5KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLmRvRmV0Y2goYCR7dGhpcy5iYXNlfS9ibG9iLyR7aGFzaH1gLCB7XG4gICAgICBtZXRob2Q6ICdQVVQnLFxuICAgICAgaGVhZGVyczoge1xuICAgICAgICBhdXRob3JpemF0aW9uOiBgQmVhcmVyICR7dGhpcy50b2tlbn1gLFxuICAgICAgICAnY29udGVudC10eXBlJzogJ2FwcGxpY2F0aW9uL29jdGV0LXN0cmVhbScsXG4gICAgICB9LFxuICAgICAgYm9keTogYnl0ZXMgYXMgQm9keUluaXQsXG4gICAgfSk7XG4gICAgaWYgKCFyZXNwb25zZS5vaykge1xuICAgICAgdGhyb3cgbmV3IEh0dHBCbG9iRXJyb3IocmVzcG9uc2Uuc3RhdHVzLCBhd2FpdCBlcnJvck1lc3NhZ2UocmVzcG9uc2UsICdzdG9yZSBibG9iJykpO1xuICAgIH1cbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBlcnJvck1lc3NhZ2UocmVzcG9uc2U6IFJlc3BvbnNlLCB3aGF0OiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCBkZXRhaWwgPSAoYXdhaXQgcmVzcG9uc2UudGV4dCgpLmNhdGNoKCgpID0+ICcnKSkuc2xpY2UoMCwgMzAwKTtcbiAgcmV0dXJuIGRldGFpbCA9PT0gJydcbiAgICA/IGBmYWlsZWQgdG8gJHt3aGF0fTogSFRUUCAke3Jlc3BvbnNlLnN0YXR1c31gXG4gICAgOiBgZmFpbGVkIHRvICR7d2hhdH06IEhUVFAgJHtyZXNwb25zZS5zdGF0dXN9OiAke2RldGFpbH1gO1xufVxuIiwgIi8qKlxuICogRGlhZ25vc3RpY3MgKHRoZSBzZXR0aW5ncyB0YWIncyBcIkFkdmFuY2VkIFx1MjE5MiBEaWFnbm9zdGljc1wiKTogYSBib3VuZGVkIHJpbmdcbiAqIGJ1ZmZlciBvdmVyIHRoZSBwbHVnaW4ncyBsb2cgc3RyZWFtIHdpdGggYSB1c2VyLXNlbGVjdGFibGUgbWluaW11bSBsZXZlbCxcbiAqIGEgdHJhbnNwb3J0IHdyYXBwZXIgdGhhdCByZWNvcmRzIHByb3RvY29sIHJvdW5kLXRyaXBzIGF0IGRlYnVnIGxldmVsIChsb3dcbiAqIHZvbHVtZTogb25lIHNob3J0IGxpbmUgcGVyIGZyYW1lKSwgYW5kIHRoZSBcIkNvcHkgZGlhZ25vc3RpY3NcIiBidW5kbGUuXG4gKlxuICogVGhlIGJ1bmRsZSBpcyBhIHBsYWluLXRleHQgc25hcHNob3QgbWVhbnQgZm9yIGJ1ZyByZXBvcnRzOiB2ZXJzaW9ucyxcbiAqIGlkZW50aXR5LCB3b3JrZXIsIGEgY2xpZW50IHN0YXR1cyBzbmFwc2hvdCwgdGhlIHBsYXRmb3JtLCBhbmQgdGhlIGxhc3QgTlxuICogbG9nIGxpbmVzLiBgYnVpbGRTdXBwb3J0QnVuZGxlYCBpcyBpdHMgcmljaGVyIG1hcmtkb3duIHNpYmxpbmcgXHUyMDE0IHRoZSBmaWxlXG4gKiBhIFwic3luYyBhdGUgbXkgbm90ZVwiIHJlcG9ydCBhdHRhY2hlcy5cbiAqL1xuXG5pbXBvcnQgeyBQcm90b2NvbFZlcnNpb24gfSBmcm9tICdAdnNhL2NvcmUnO1xuaW1wb3J0IHR5cGUgeyBMb2dBZGFwdGVyLCBTeW5jQ2xpZW50U3RhdHVzLCBUcmFuc3BvcnQgfSBmcm9tICdAdnNhL2NvcmUnO1xuaW1wb3J0IHsgUGxhdGZvcm0gfSBmcm9tICdvYnNpZGlhbic7XG5pbXBvcnQgdHlwZSB7IExvZ0xldmVsLCBQbHVnaW5TeW5jU2V0dGluZ3MgfSBmcm9tICcuL2RhdGEuanMnO1xuXG4vKiogU2V2ZXJpdHkgcmFua2luZzsgYGVycm9yYCBhbHdheXMgb3V0cmFua3MgZXZlcnkgc2VsZWN0YWJsZSBsZXZlbC4gKi9cbmNvbnN0IExFVkVMX1JBTks6IFJlY29yZDxMb2dMZXZlbCB8ICdlcnJvcicsIG51bWJlcj4gPSB7IGRlYnVnOiAxMCwgaW5mbzogMjAsIHdhcm46IDMwLCBlcnJvcjogNDAgfTtcblxuLyoqIExvZyBsaW5lcyBrZXB0IGZvciB0aGUgZGlhZ25vc3RpY3MgYnVuZGxlICh0aGUgc3BlYydzIFwibGFzdCAyMFwiKS4gKi9cbmV4cG9ydCBjb25zdCBSSU5HX0NBUEFDSVRZID0gMjA7XG5cbi8qKiBNYXggY2hhcmFjdGVycyBvbmUgYXJndW1lbnQgY29udHJpYnV0ZXMgdG8gYSByaW5nIGxpbmUuICovXG5jb25zdCBBUkdfTUFYX0NIQVJTID0gMzAwO1xuXG4vKiogQSBgTG9nQWRhcHRlcmAgd2l0aCBhIGxldmVsIGdhdGUgYW5kIGEgYm91bmRlZCByaW5nIGJ1ZmZlciBhdHRhY2hlZC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUGx1Z2luTG9nIGV4dGVuZHMgTG9nQWRhcHRlciB7XG4gIC8qKiBDaGFuZ2UgdGhlIG1pbmltdW0gcmVjb3JkZWQgbGV2ZWwgYXQgcnVudGltZSAodGhlIHNldHRpbmdzIGRyb3Bkb3duKS4gKi9cbiAgc2V0TGV2ZWwobGV2ZWw6IExvZ0xldmVsKTogdm9pZDtcbiAgZ2V0TGV2ZWwoKTogTG9nTGV2ZWw7XG4gIC8qKiBXaGV0aGVyIGBkZWJ1Z2AgY2FsbHMgY3VycmVudGx5IHBhc3MgdGhlIGdhdGUgKHJvdW5kLXRyaXAgbG9nZ2luZyBob29rKS4gKi9cbiAgZ2V0IGRlYnVnRW5hYmxlZCgpOiBib29sZWFuO1xuICAvKiogVGhlIG1vc3QgcmVjZW50IGxpbmVzLCBvbGRlc3QgZmlyc3QgKGJvdW5kZWQgYnkgdGhlIGNhcGFjaXR5KS4gKi9cbiAgcmVjZW50TGluZXMoKTogc3RyaW5nW107XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUGx1Z2luTG9nT3B0aW9ucyB7XG4gIC8qKiBSaW5nIGNhcGFjaXR5IChkZWZhdWx0IDIwKS4gKi9cbiAgY2FwYWNpdHk/OiBudW1iZXI7XG4gIC8qKiBNaW5pbXVtIHJlY29yZGVkIGxldmVsIChkZWZhdWx0ICdpbmZvJykuICovXG4gIGxldmVsPzogTG9nTGV2ZWw7XG4gIC8qKiBUaW1lc3RhbXAgc2VhbSAoZGVmYXVsdCBgRGF0ZS5ub3dgKS4gKi9cbiAgbm93PzogKCkgPT4gbnVtYmVyO1xufVxuXG4vKiogQnVpbGQgdGhlIHBsdWdpbidzIGxvZyBhZGFwdGVyOiBjb25zb2xlIG1pcnJvciArIGJvdW5kZWQgcmluZyBidWZmZXIuICovXG5leHBvcnQgZnVuY3Rpb24gY3JlYXRlUGx1Z2luTG9nKG9wdGlvbnM6IFBsdWdpbkxvZ09wdGlvbnMgPSB7fSk6IFBsdWdpbkxvZyB7XG4gIGNvbnN0IGNhcGFjaXR5ID0gb3B0aW9ucy5jYXBhY2l0eSA/PyBSSU5HX0NBUEFDSVRZO1xuICBjb25zdCBub3cgPSBvcHRpb25zLm5vdyA/PyAoKCkgPT4gRGF0ZS5ub3coKSk7XG4gIGxldCBsZXZlbDogTG9nTGV2ZWwgPSBvcHRpb25zLmxldmVsID8/ICdpbmZvJztcbiAgbGV0IHJpbmc6IHN0cmluZ1tdID0gW107XG5cbiAgY29uc3Qgd3JpdGUgPSAoc2V2ZXJpdHk6IExvZ0xldmVsIHwgJ2Vycm9yJywgYXJnczogcmVhZG9ubHkgdW5rbm93bltdKTogdm9pZCA9PiB7XG4gICAgaWYgKExFVkVMX1JBTktbc2V2ZXJpdHldIDwgTEVWRUxfUkFOS1tsZXZlbF0pIHJldHVybjtcbiAgICBjb25zdCBsaW5lID0gYCR7bmV3IERhdGUobm93KCkpLnRvSVNPU3RyaW5nKCl9IFske3NldmVyaXR5fV0gJHthcmdzLm1hcChmbXQpLmpvaW4oJyAnKX1gO1xuICAgIHJpbmcucHVzaChsaW5lKTtcbiAgICBpZiAocmluZy5sZW5ndGggPiBjYXBhY2l0eSkgcmluZyA9IHJpbmcuc2xpY2UocmluZy5sZW5ndGggLSBjYXBhY2l0eSk7XG4gICAgY29uc3Qgc2luayA9XG4gICAgICBzZXZlcml0eSA9PT0gJ2Vycm9yJyA/IGNvbnNvbGUuZXJyb3IgOiBzZXZlcml0eSA9PT0gJ3dhcm4nID8gY29uc29sZS53YXJuIDogY29uc29sZS5sb2c7XG4gICAgc2luaygnW3ZzYV0nLCAuLi5hcmdzKTtcbiAgfTtcblxuICByZXR1cm4ge1xuICAgIGRlYnVnOiAoLi4uYXJnczogdW5rbm93bltdKSA9PiB3cml0ZSgnZGVidWcnLCBhcmdzKSxcbiAgICBpbmZvOiAoLi4uYXJnczogdW5rbm93bltdKSA9PiB3cml0ZSgnaW5mbycsIGFyZ3MpLFxuICAgIHdhcm46ICguLi5hcmdzOiB1bmtub3duW10pID0+IHdyaXRlKCd3YXJuJywgYXJncyksXG4gICAgZXJyb3I6ICguLi5hcmdzOiB1bmtub3duW10pID0+IHdyaXRlKCdlcnJvcicsIGFyZ3MpLFxuICAgIHNldExldmVsKG5leHQ6IExvZ0xldmVsKTogdm9pZCB7XG4gICAgICBsZXZlbCA9IG5leHQ7XG4gICAgfSxcbiAgICBnZXRMZXZlbCgpOiBMb2dMZXZlbCB7XG4gICAgICByZXR1cm4gbGV2ZWw7XG4gICAgfSxcbiAgICBnZXQgZGVidWdFbmFibGVkKCk6IGJvb2xlYW4ge1xuICAgICAgcmV0dXJuIGxldmVsID09PSAnZGVidWcnO1xuICAgIH0sXG4gICAgcmVjZW50TGluZXMoKTogc3RyaW5nW10ge1xuICAgICAgcmV0dXJuIFsuLi5yaW5nXTtcbiAgICB9LFxuICB9O1xufVxuXG4vKiogT25lIGxvZyBhcmd1bWVudCBcdTIxOTIgY29tcGFjdCB0ZXh0IChzdHJpbmdzIHBhc3MgdGhyb3VnaCwgbG9uZyB2YWx1ZXMgdHJ1bmNhdGVkKS4gKi9cbmZ1bmN0aW9uIGZtdCh2YWx1ZTogdW5rbm93bik6IHN0cmluZyB7XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdzdHJpbmcnKSByZXR1cm4gdHJ1bmNhdGUodmFsdWUpO1xuICBpZiAodmFsdWUgaW5zdGFuY2VvZiBFcnJvcikgcmV0dXJuIHRydW5jYXRlKGAke3ZhbHVlLm5hbWV9OiAke3ZhbHVlLm1lc3NhZ2V9YCk7XG4gIHRyeSB7XG4gICAgcmV0dXJuIHRydW5jYXRlKEpTT04uc3RyaW5naWZ5KHZhbHVlKSA/PyBTdHJpbmcodmFsdWUpKTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIFN0cmluZyh2YWx1ZSk7XG4gIH1cbn1cblxuZnVuY3Rpb24gdHJ1bmNhdGUodGV4dDogc3RyaW5nKTogc3RyaW5nIHtcbiAgcmV0dXJuIHRleHQubGVuZ3RoIDw9IEFSR19NQVhfQ0hBUlMgPyB0ZXh0IDogYCR7dGV4dC5zbGljZSgwLCBBUkdfTUFYX0NIQVJTIC0gMSl9XHUyMDI2YDtcbn1cblxuLy8gLS0tIHByb3RvY29sIHJvdW5kLXRyaXAgbG9nZ2luZyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIENvbXBhY3QsIGxvdy12b2x1bWUgZGVzY3JpcHRpb24gb2YgYSB3aXJlIGZyYW1lICh0eXBlICsgaWRlbnRpdHkga2V5cykuICovXG5leHBvcnQgZnVuY3Rpb24gZGVzY3JpYmVNZXNzYWdlKG1lc3NhZ2U6IHtcbiAgdHlwZTogc3RyaW5nO1xuICBwYXRoPzogc3RyaW5nO1xuICBoYXNoPzogc3RyaW5nO1xuICBmcm9tUGF0aD86IHN0cmluZztcbiAgY3Vyc29yPzogbnVtYmVyO1xuICBzZXE/OiBudW1iZXI7XG59KTogc3RyaW5nIHtcbiAgY29uc3QgYml0cyA9IFttZXNzYWdlLnR5cGVdO1xuICBpZiAobWVzc2FnZS5mcm9tUGF0aCAhPT0gdW5kZWZpbmVkKSBiaXRzLnB1c2goYCR7bWVzc2FnZS5mcm9tUGF0aH0gXHUyMTkyYCk7XG4gIGlmIChtZXNzYWdlLnBhdGggIT09IHVuZGVmaW5lZCkgYml0cy5wdXNoKG1lc3NhZ2UucGF0aCk7XG4gIGlmIChtZXNzYWdlLmhhc2ggIT09IHVuZGVmaW5lZCkgYml0cy5wdXNoKG1lc3NhZ2UuaGFzaC5zbGljZSgwLCAxMikpO1xuICBpZiAobWVzc2FnZS5zZXEgIT09IHVuZGVmaW5lZCkgYml0cy5wdXNoKGBzZXEgJHttZXNzYWdlLnNlcX1gKTtcbiAgaWYgKG1lc3NhZ2UuY3Vyc29yICE9PSB1bmRlZmluZWQpIGJpdHMucHVzaChgY3Vyc29yICR7bWVzc2FnZS5jdXJzb3J9YCk7XG4gIHJldHVybiBiaXRzLmpvaW4oJyAnKTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBSb3VuZFRyaXBMb2dnaW5nT3B0aW9ucyB7XG4gIGxvZzogTG9nQWRhcHRlcjtcbiAgLyoqIENoZWFwIHByZS1jaGVjayBzbyB0aGUgc3RyaW5nIGJ1aWxkaW5nIGlzIHNraXBwZWQgdW5sZXNzIGRlYnVnIGlzIG9uLiAqL1xuICBzaG91bGRMb2c6ICgpID0+IGJvb2xlYW47XG59XG5cbi8qKlxuICogV3JhcCBhIGBUcmFuc3BvcnRgIHNvIGV2ZXJ5IHNlbnQvcmVjZWl2ZWQgZnJhbWUgaXMgbG9nZ2VkIGF0IGRlYnVnIGxldmVsIFx1MjAxNFxuICogb25lIHNob3J0IGxpbmUgcGVyIGZyYW1lIChgZGVzY3JpYmVNZXNzYWdlYCksIG5vdGhpbmcgYXQgb3RoZXIgbGV2ZWxzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gd2l0aFJvdW5kVHJpcExvZ2dpbmcoXG4gIHRyYW5zcG9ydDogVHJhbnNwb3J0LFxuICBvcHRpb25zOiBSb3VuZFRyaXBMb2dnaW5nT3B0aW9ucyxcbik6IFRyYW5zcG9ydCB7XG4gIGNvbnN0IHsgbG9nLCBzaG91bGRMb2cgfSA9IG9wdGlvbnM7XG4gIHJldHVybiB7XG4gICAgc2VuZDogKG1lc3NhZ2UpID0+IHtcbiAgICAgIGlmIChzaG91bGRMb2coKSkgbG9nLmRlYnVnKCdcdTIxOTInLCBkZXNjcmliZU1lc3NhZ2UobWVzc2FnZSkpO1xuICAgICAgdHJhbnNwb3J0LnNlbmQobWVzc2FnZSk7XG4gICAgfSxcbiAgICBvbk1lc3NhZ2U6IChjYWxsYmFjaykgPT4ge1xuICAgICAgdHJhbnNwb3J0Lm9uTWVzc2FnZSgobWVzc2FnZSkgPT4ge1xuICAgICAgICBpZiAoc2hvdWxkTG9nKCkpIGxvZy5kZWJ1ZygnXHUyMTkwJywgZGVzY3JpYmVNZXNzYWdlKG1lc3NhZ2UpKTtcbiAgICAgICAgY2FsbGJhY2sobWVzc2FnZSk7XG4gICAgICB9KTtcbiAgICB9LFxuICAgIG9uQ2xvc2U6IChjYWxsYmFjaykgPT4gdHJhbnNwb3J0Lm9uQ2xvc2UoY2FsbGJhY2spLFxuICAgIGNsb3NlOiAoKSA9PiB0cmFuc3BvcnQuY2xvc2UoKSxcbiAgfTtcbn1cblxuLy8gLS0tIHRoZSBidW5kbGUgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBEaWFnbm9zdGljc0lucHV0IHtcbiAgcGx1Z2luVmVyc2lvbjogc3RyaW5nO1xuICBkZXZpY2VJZDogc3RyaW5nO1xuICBkZXZpY2VOYW1lOiBzdHJpbmc7XG4gIHdvcmtlclVybDogc3RyaW5nO1xuICBwYWlyZWQ6IGJvb2xlYW47XG4gIHBhdXNlZDogYm9vbGVhbjtcbiAgY2xpZW50U3RhdHVzOiBTeW5jQ2xpZW50U3RhdHVzIHwgbnVsbDtcbiAgcmVjZW50TG9nTGluZXM6IHJlYWRvbmx5IHN0cmluZ1tdO1xuICAvKiogV29ya2VyLXJlcG9ydGVkIHZlcnNpb24gKG51bGwgdW50aWwgYSBsYXRlciBjaGFuZ2UgcG9wdWxhdGVzIGl0KS4gKi9cbiAgc2VydmVyVmVyc2lvbj86IHN0cmluZyB8IG51bGw7XG4gIC8qKiBDbGllbnQtc2lkZSBzZXR0aW5ncyAobm9uZSBhcmUgc2VjcmV0IFx1MjAxNCBhbGwgZmllbGRzIHJlbmRlciB2ZXJiYXRpbSkuICovXG4gIHNldHRpbmdzPzogUGx1Z2luU3luY1NldHRpbmdzO1xuICAvKipcbiAgICogQ29uZmxpY3QgcGF0aHMgZm9yIHRoZSBzdXBwb3J0IGJ1bmRsZSwgZGVyaXZlZCBmcm9tXG4gICAqIGBjbGllbnRTdGF0dXMuY29uZmxpY3RzYCBcdTIwMTQgUEFUSFMgT05MWSwgbmV2ZXIgZmlsZSBjb250ZW50LlxuICAgKi9cbiAgcmVjZW50Q29uZmxpY3RzPzogQXJyYXk8eyBwYXRoOiBzdHJpbmcgfT47XG59XG5cbi8qKiBUaGUgcHJvdG9jb2wgdmVyc2lvbiBmcm9tIGNvcmUsIHN1cmZhY2VkIGZvciB0aGUgYnVuZGxlL0Fib3V0IHNlY3Rpb24uICovXG5leHBvcnQgY29uc3QgUFJPVE9DT0xfVkVSU0lPTiA9IFByb3RvY29sVmVyc2lvbjtcblxuLyoqIFRoZSBjb3B5YWJsZSBkaWFnbm9zdGljcyBidW5kbGUgKHBsYWluIHRleHQsIGJ1Zy1yZXBvcnQgZnJpZW5kbHkpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkRGlhZ25vc3RpY3NCdW5kbGUoaW5wdXQ6IERpYWdub3N0aWNzSW5wdXQpOiBzdHJpbmcge1xuICBjb25zdCBzdGF0dXMgPSBpbnB1dC5jbGllbnRTdGF0dXM7XG4gIGNvbnN0IGxpbmVzOiBzdHJpbmdbXSA9IFtcbiAgICAnVmF1bHRTeW5jIGZvciBBZ2VudHMgXHUyMDE0IGRpYWdub3N0aWNzJyxcbiAgICBgUGx1Z2luIHZlcnNpb246ICR7aW5wdXQucGx1Z2luVmVyc2lvbn1gLFxuICAgIGBQcm90b2NvbCB2ZXJzaW9uOiAke1Byb3RvY29sVmVyc2lvbn1gLFxuICAgIGBEZXZpY2U6ICR7aW5wdXQuZGV2aWNlSWQgfHwgJyh1bmFzc2lnbmVkKSd9JHtpbnB1dC5kZXZpY2VOYW1lID8gYCAoJHtpbnB1dC5kZXZpY2VOYW1lfSlgIDogJyd9YCxcbiAgICBgV29ya2VyOiAke2lucHV0LndvcmtlclVybCB8fCAnKG5vdCBjb25maWd1cmVkKSd9YCxcbiAgICBgUGFpcmluZzogJHtpbnB1dC5wYWlyZWQgPyAncGFpcmVkJyA6ICdub3QgcGFpcmVkJ31gLFxuICAgIGlucHV0LnBhdXNlZFxuICAgICAgPyAnU3luYzogcGF1c2VkJ1xuICAgICAgOiBzdGF0dXMgPT09IG51bGxcbiAgICAgICAgPyAnU3luYzogbm90IHJ1bm5pbmcnXG4gICAgICAgIDogYFN5bmM6ICR7c3RhdHVzLnN0YXRlfSwgbGFzdCBzeW5jICR7XG4gICAgICAgICAgICBzdGF0dXMubGFzdFN5bmNBdCA9PT0gbnVsbCA/ICduZXZlcicgOiBgJHtNYXRoLm1heCgwLCBEYXRlLm5vdygpIC0gc3RhdHVzLmxhc3RTeW5jQXQpfW1zIGFnb2BcbiAgICAgICAgICB9LCBwZW5kaW5nICR7c3RhdHVzLnBlbmRpbmd9LCBjb25mbGljdHMgJHtzdGF0dXMuY29uZmxpY3RzLmxlbmd0aH1gLFxuICAgIGBQbGF0Zm9ybTogJHtwbGF0Zm9ybVN1bW1hcnkoKX1gLFxuICAgIGBSZWNlbnQgbG9nIChsYXN0ICR7aW5wdXQucmVjZW50TG9nTGluZXMubGVuZ3RofSBsaW5lcyk6YCxcbiAgXTtcbiAgaWYgKGlucHV0LnJlY2VudExvZ0xpbmVzLmxlbmd0aCA9PT0gMCkge1xuICAgIGxpbmVzLnB1c2goJyAgKG5vIHJlY29yZGVkIGxvZyBsaW5lcyknKTtcbiAgfSBlbHNlIHtcbiAgICBmb3IgKGNvbnN0IGxpbmUgb2YgaW5wdXQucmVjZW50TG9nTGluZXMpIGxpbmVzLnB1c2goYCAgJHtsaW5lfWApO1xuICB9XG4gIHJldHVybiBsaW5lcy5qb2luKCdcXG4nKTtcbn1cblxuLyoqIEVwb2NoIG1zIFx1MjE5MiBgMjAyNjA4MjEtMTQzMDA1YCAobG9jYWwgdGltZSkgZm9yIHN1cHBvcnQtYnVuZGxlIGZpbGUgbmFtZXMuICovXG5leHBvcnQgZnVuY3Rpb24gZm9ybWF0U3VwcG9ydEJ1bmRsZVN0YW1wKG5vdzogbnVtYmVyKTogc3RyaW5nIHtcbiAgY29uc3QgZCA9IG5ldyBEYXRlKG5vdyk7XG4gIGNvbnN0IHR3byA9IChuOiBudW1iZXIpOiBzdHJpbmcgPT4gU3RyaW5nKG4pLnBhZFN0YXJ0KDIsICcwJyk7XG4gIHJldHVybiAoXG4gICAgYCR7ZC5nZXRGdWxsWWVhcigpfSR7dHdvKGQuZ2V0TW9udGgoKSArIDEpfSR7dHdvKGQuZ2V0RGF0ZSgpKX1gICtcbiAgICBgLSR7dHdvKGQuZ2V0SG91cnMoKSl9JHt0d28oZC5nZXRNaW51dGVzKCkpfSR7dHdvKGQuZ2V0U2Vjb25kcygpKX1gXG4gICk7XG59XG5cbmNvbnN0IG9uT2ZmID0gKHZhbHVlOiBib29sZWFuKTogc3RyaW5nID0+ICh2YWx1ZSA/ICdvbicgOiAnb2ZmJyk7XG5cbi8qKlxuICogVGhlIFwiU2F2ZSBzdXBwb3J0IGJ1bmRsZVwiIG1hcmtkb3duLiBSZWRhY3Rpb24gY29udHJhY3Q6IHRoZSBkZXZpY2UgdG9rZW5cbiAqIG5ldmVyIGFwcGVhcnMgKHRoZSBpbnB1dCBzdHJ1Y3R1cmFsbHkgY2Fubm90IGNhcnJ5IGl0KSwgYW5kIGZpbGVzXG4gKiBjb250cmlidXRlIHZhdWx0LXJlbGF0aXZlIFBBVEhTIE9OTFkgXHUyMDE0IG5ldmVyIGNvbnRlbnQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBidWlsZFN1cHBvcnRCdW5kbGUoaW5wdXQ6IERpYWdub3N0aWNzSW5wdXQsIG5vdzogbnVtYmVyKTogc3RyaW5nIHtcbiAgY29uc3Qgc3RhdHVzID0gaW5wdXQuY2xpZW50U3RhdHVzO1xuICAvLyBDb25mbGljdHMgcmVuZGVyIGFzIHBhdGhzIG9ubHk7IGByZWNlbnRDb25mbGljdHNgIChwcmUtcmVkYWN0ZWQgYnkgdGhlXG4gIC8vIGNhbGxlcikgd2lucyB3aGVuIHByZXNlbnQsIGVsc2UgcGF0aHMgYXJlIGRlcml2ZWQgZnJvbSB0aGUgc3RhdHVzLlxuICBjb25zdCBjb25mbGljdFBhdGhzID1cbiAgICBpbnB1dC5yZWNlbnRDb25mbGljdHM/Lm1hcCgoYykgPT4gYy5wYXRoKSA/PyBzdGF0dXM/LmNvbmZsaWN0cy5tYXAoKGMpID0+IGMucGF0aCkgPz8gW107XG5cbiAgY29uc3QgbGluZXM6IHN0cmluZ1tdID0gW1xuICAgICcjIFZhdWx0U3luYyBmb3IgQWdlbnRzIFx1MjAxNCBzdXBwb3J0IGJ1bmRsZScsXG4gICAgJycsXG4gICAgYEdlbmVyYXRlZDogJHtuZXcgRGF0ZShub3cpLnRvSVNPU3RyaW5nKCl9YCxcbiAgICAnJyxcbiAgICAnIyMgVmVyc2lvbnMnLFxuICAgICcnLFxuICAgIGAtIFBsdWdpbjogJHtpbnB1dC5wbHVnaW5WZXJzaW9ufWAsXG4gICAgYC0gUHJvdG9jb2w6ICR7UHJvdG9jb2xWZXJzaW9ufWAsXG4gICAgYC0gU2VydmVyOiAke2lucHV0LnNlcnZlclZlcnNpb24gPz8gJ3Vua25vd24nfWAsXG4gICAgYC0gUGxhdGZvcm06ICR7cGxhdGZvcm1TdW1tYXJ5KCl9YCxcbiAgICAnJyxcbiAgICAnIyMgQ29ubmVjdGlvbicsXG4gICAgJycsXG4gICAgYC0gV29ya2VyIFVSTDogJHtpbnB1dC53b3JrZXJVcmwgfHwgJyhub3QgY29uZmlndXJlZCknfWAsXG4gICAgYC0gRGV2aWNlIElEOiAke2lucHV0LmRldmljZUlkIHx8ICcodW5hc3NpZ25lZCknfWAsXG4gICAgYC0gRGV2aWNlIG5hbWU6ICR7aW5wdXQuZGV2aWNlTmFtZSB8fCAnKGRlZmF1bHQpJ31gLFxuICAgIGAtIFBhaXJpbmc6ICR7aW5wdXQucGFpcmVkID8gJ3BhaXJlZCcgOiAnbm90IHBhaXJlZCd9YCxcbiAgICBgLSBTeW5jaW5nOiAke2lucHV0LnBhdXNlZCA/ICdwYXVzZWQnIDogJ2FjdGl2ZSd9YCxcbiAgXTtcblxuICBpZiAoaW5wdXQuc2V0dGluZ3MgIT09IHVuZGVmaW5lZCkge1xuICAgIGNvbnN0IHsgc2V0dGluZ3MgfSA9IGlucHV0O1xuICAgIGNvbnN0IHBhdHRlcm5zID0gc2V0dGluZ3MuaWdub3JlUGF0dGVybnNcbiAgICAgIC5zcGxpdCgvXFxyP1xcbi8pXG4gICAgICAubWFwKChsaW5lKSA9PiBsaW5lLnRyaW0oKSlcbiAgICAgIC5maWx0ZXIoKGxpbmUpID0+IGxpbmUgIT09ICcnKTtcbiAgICBsaW5lcy5wdXNoKCcnLCAnIyMgU2V0dGluZ3MnLCAnJywgYC0gUmVzY2FuIGludGVydmFsOiAke3NldHRpbmdzLnJlc2NhbkludGVydmFsU2VjID09PSAwID8gJ29mZicgOiBgJHtzZXR0aW5ncy5yZXNjYW5JbnRlcnZhbFNlY30gc2Vjb25kc2B9YCwgYC0gU3luYyAub2JzaWRpYW4vIGZvbGRlcjogJHtvbk9mZihzZXR0aW5ncy5vYnNpZGlhblN5bmMpfWAsIGAtIFN0YXR1cyBiYXIgaW5kaWNhdG9yOiAke3NldHRpbmdzLnN0YXR1c0Jhck1vZGV9YCwgYC0gU3luYyBvbiBzdGFydHVwOiAke29uT2ZmKHNldHRpbmdzLnN5bmNPblN0YXJ0dXApfWAsIGAtIERpYWdub3N0aWNzIGxvZyBsZXZlbDogJHtzZXR0aW5ncy5sb2dMZXZlbH1gKTtcbiAgICBpZiAocGF0dGVybnMubGVuZ3RoID09PSAwKSB7XG4gICAgICBsaW5lcy5wdXNoKCctIElnbm9yZSBwYXR0ZXJuczogKG5vbmUpJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGxpbmVzLnB1c2goJy0gSWdub3JlIHBhdHRlcm5zOicpO1xuICAgICAgZm9yIChjb25zdCBwYXR0ZXJuIG9mIHBhdHRlcm5zKSBsaW5lcy5wdXNoKGAgICR7cGF0dGVybn1gKTtcbiAgICB9XG4gIH1cblxuICBsaW5lcy5wdXNoKCcnLCAnIyMgU3luYyBzdGF0ZScsICcnKTtcbiAgaWYgKGlucHV0LnBhdXNlZCkgbGluZXMucHVzaCgnLSBTdGF0ZTogcGF1c2VkJyk7XG4gIGVsc2UgaWYgKHN0YXR1cyA9PT0gbnVsbCkgbGluZXMucHVzaCgnLSBTdGF0ZTogbm90IHJ1bm5pbmcnKTtcbiAgZWxzZSBsaW5lcy5wdXNoKGAtIFN0YXRlOiAke3N0YXR1cy5zdGF0ZX1gKTtcbiAgaWYgKHN0YXR1cyAhPT0gbnVsbCkge1xuICAgIGxpbmVzLnB1c2goXG4gICAgICBgLSBMYXN0IHN5bmM6ICR7c3RhdHVzLmxhc3RTeW5jQXQgPT09IG51bGwgPyAnbmV2ZXInIDogbmV3IERhdGUoc3RhdHVzLmxhc3RTeW5jQXQpLnRvSVNPU3RyaW5nKCl9YCxcbiAgICAgIGAtIFBlbmRpbmcgY2hhbmdlczogJHtzdGF0dXMucGVuZGluZ31gLFxuICAgICAgYC0gQ29uZmxpY3RzOiAke2NvbmZsaWN0UGF0aHMubGVuZ3RofWAsXG4gICAgKTtcbiAgICBmb3IgKGNvbnN0IHBhdGggb2YgY29uZmxpY3RQYXRocykgbGluZXMucHVzaChgICAtICR7cGF0aH1gKTtcbiAgICBpZiAoc3RhdHVzLnByb2dyZXNzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGxpbmVzLnB1c2goYC0gUHJvZ3Jlc3M6ICR7c3RhdHVzLnByb2dyZXNzLnBoYXNlfSAke3N0YXR1cy5wcm9ncmVzcy5kb25lfS8ke3N0YXR1cy5wcm9ncmVzcy50b3RhbH1gKTtcbiAgICB9XG4gIH1cblxuICBsaW5lcy5wdXNoKCcnLCBgIyMgUmVjZW50IGxvZyAobGFzdCAke2lucHV0LnJlY2VudExvZ0xpbmVzLmxlbmd0aH0gbGluZXMpYCwgJycpO1xuICBpZiAoaW5wdXQucmVjZW50TG9nTGluZXMubGVuZ3RoID09PSAwKSB7XG4gICAgbGluZXMucHVzaCgnKG5vIHJlY29yZGVkIGxvZyBsaW5lcyknKTtcbiAgfSBlbHNlIHtcbiAgICBsaW5lcy5wdXNoKCdgYGB0ZXh0Jyk7XG4gICAgbGluZXMucHVzaCguLi5pbnB1dC5yZWNlbnRMb2dMaW5lcyk7XG4gICAgbGluZXMucHVzaCgnYGBgJyk7XG4gIH1cbiAgcmV0dXJuIGAke2xpbmVzLmpvaW4oJ1xcbicpfVxcbmA7XG59XG5cbi8qKiBIdW1hbiBwbGF0Zm9ybSBzdW1tYXJ5IGZyb20gYFBsYXRmb3JtYCAobW9iaWxlIHZzIGRlc2t0b3AsIE9TLCBmb3JtIGZhY3RvcikuICovXG5leHBvcnQgZnVuY3Rpb24gcGxhdGZvcm1TdW1tYXJ5KCk6IHN0cmluZyB7XG4gIGlmIChQbGF0Zm9ybS5pc01vYmlsZUFwcCkge1xuICAgIGNvbnN0IG9zID0gUGxhdGZvcm0uaXNJb3NBcHAgPyAnaU9TJyA6IFBsYXRmb3JtLmlzQW5kcm9pZEFwcCA/ICdBbmRyb2lkJyA6ICd1bmtub3duIE9TJztcbiAgICBjb25zdCBmYWN0b3IgPSBQbGF0Zm9ybS5pc1RhYmxldCA/ICd0YWJsZXQnIDogUGxhdGZvcm0uaXNQaG9uZSA/ICdwaG9uZScgOiAnZGV2aWNlJztcbiAgICByZXR1cm4gYE9ic2lkaWFuIG1vYmlsZSBhcHAgKCR7b3N9LCAke2ZhY3Rvcn0pYDtcbiAgfVxuICByZXR1cm4gJ09ic2lkaWFuIGRlc2t0b3AgYXBwJztcbn1cblxuLyoqIEJlc3QtZWZmb3J0IGNsaXBib2FyZCB3cml0ZTsgcmVzb2x2ZXMgZmFsc2Ugd2hlcmUgdGhlIGNsaXBib2FyZCBpcyB1bmF2YWlsYWJsZS4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjb3B5VG9DbGlwYm9hcmQodGV4dDogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XG4gIGNvbnN0IGNsaXBib2FyZCA9IChnbG9iYWxUaGlzIGFzIHsgbmF2aWdhdG9yPzogeyBjbGlwYm9hcmQ/OiB7IHdyaXRlVGV4dD8odDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB9IH0gfSlcbiAgICAubmF2aWdhdG9yPy5jbGlwYm9hcmQ7XG4gIGlmIChjbGlwYm9hcmQ/LndyaXRlVGV4dCA9PT0gdW5kZWZpbmVkKSByZXR1cm4gZmFsc2U7XG4gIHRyeSB7XG4gICAgYXdhaXQgY2xpcGJvYXJkLndyaXRlVGV4dCh0ZXh0KTtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG5cbi8qKiBCeXRlcyBcdTIxOTIgaHVtYW4gdGV4dCAoYDczMCBCYCwgYDEuMiBNQmApLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdEJ5dGVzKGJ5dGVzOiBudW1iZXIpOiBzdHJpbmcge1xuICBpZiAoYnl0ZXMgPCAxMDI0KSByZXR1cm4gYCR7Ynl0ZXN9IEJgO1xuICBjb25zdCB1bml0cyA9IFsnS0InLCAnTUInLCAnR0InLCAnVEInXTtcbiAgbGV0IHZhbHVlID0gYnl0ZXM7XG4gIGxldCB1bml0ID0gLTE7XG4gIGRvIHtcbiAgICB2YWx1ZSAvPSAxMDI0O1xuICAgIHVuaXQgKz0gMTtcbiAgfSB3aGlsZSAodmFsdWUgPj0gMTAyNCAmJiB1bml0IDwgdW5pdHMubGVuZ3RoIC0gMSk7XG4gIHJldHVybiBgJHt2YWx1ZSA+PSAxMDAgPyBNYXRoLnJvdW5kKHZhbHVlKSA6IHZhbHVlLnRvRml4ZWQoMSl9ICR7dW5pdHNbdW5pdF19YDtcbn1cbiIsICIvKipcbiAqIFRoZSBwbHVnaW4ncyBwZXJzaXN0ZWQgc3RhdGUgKGBkYXRhLmpzb25gLCB2aWEgYFBsdWdpbi5sb2FkRGF0YS9zYXZlRGF0YWApLlxuICpcbiAqIEtlcHQgZGVsaWJlcmF0ZWx5IHNtYWxsOiBsaW5rIGlkZW50aXR5ICh1cmwvdG9rZW4vZGV2aWNlSWQvZGV2aWNlTmFtZSkgcGx1c1xuICogdGhlIHR3byBjbGllbnQtc2lkZSB0b2dnbGVzLiBUaGUgdG9rZW4gaXMgdGhlIGRldmljZSdzIGxvbmctbGl2ZWRcbiAqIGNyZWRlbnRpYWwgKEFSQ0hJVEVDVFVSRSBcdTAwQTczKSBcdTIwMTQgT2JzaWRpYW4gc3RvcmVzIGRhdGEuanNvbiBpbnNpZGUgdGhlIHZhdWx0J3NcbiAqIGAub2JzaWRpYW4vcGx1Z2lucy9gIGRpciwgd2hpY2ggc3luYyBleGNsdWRlcywgc28gaXQgbmV2ZXIgbGVhdmVzIHRoZVxuICogbWFjaGluZSB0aHJvdWdoIHN5bmMgaXRzZWxmLlxuICovXG5cbmltcG9ydCB7IFBsYXRmb3JtIH0gZnJvbSAnb2JzaWRpYW4nO1xuaW1wb3J0IHR5cGUgeyBTdGF0dXNCYXJNb2RlIH0gZnJvbSAnLi9zdGF0dXNiYXIuanMnO1xuXG4vKiogRGlhZ25vc3RpY3MgbG9nIGxldmVsICh0aGUgXCJEaWFnbm9zdGljc1wiIHNldHRpbmdzIGRyb3Bkb3duKS4gKi9cbmV4cG9ydCB0eXBlIExvZ0xldmVsID0gJ2luZm8nIHwgJ2RlYnVnJyB8ICd3YXJuJztcblxuLyoqIENsaWVudC1zaWRlIHN5bmMgYmVoYXZpb3Igc2V0dGluZ3MgKHRoZSBzZXR0aW5ncy10YWIgdG9nZ2xlcykuICovXG5leHBvcnQgaW50ZXJmYWNlIFBsdWdpblN5bmNTZXR0aW5ncyB7XG4gIC8qKlxuICAgKiBQZXJpb2RpYyBmdWxsLXJlc2NhbiBpbnRlcnZhbCBpbiBzZWNvbmRzIChBUkNISVRFQ1RVUkUgXHUwMEE3OCBtb2JpbGUgL1xuICAgKiBleHRlcm5hbCBlZGl0cykuIGAwYCBkaXNhYmxlcyB0aGUgdGltZXIgXHUyMDE0IHZhdWx0IGV2ZW50cyBhbmQgYXBwLW9wZW5cbiAgICogcmVjb25jaWxpYXRpb24gc3RpbGwgcnVuLlxuICAgKi9cbiAgcmVzY2FuSW50ZXJ2YWxTZWM6IG51bWJlcjtcbiAgLyoqXG4gICAqIE9wdCBpbiB0byBzeW5jaW5nIGAub2JzaWRpYW4vYCAoRlItMTEpLiBUaGlzIGlzIHRoZSBjbGllbnQtc2lkZSBpbml0aWFsXG4gICAqIGlnbm9yZSBzZXR0aW5nOyB0aGUgd29ya2VyJ3MgcGVyLXZhdWx0IGBWYXVsdFNldHRpbmdzLm9ic2lkaWFuU3luY2BcbiAgICogKGRlbGl2ZXJlZCBpbiBgaGVsbG9BY2tgKSBzdXBlcnNlZGVzIGl0IG9uY2UgY29ubmVjdGVkLlxuICAgKi9cbiAgb2JzaWRpYW5TeW5jOiBib29sZWFuO1xuICAvKiogU3RhdHVzLWJhciBpbmRpY2F0b3I6IGZ1bGwgdGV4dCwgYSBjb21wYWN0IHN5bWJvbCwgb3Igbm8gaXRlbSBhdCBhbGwuICovXG4gIHN0YXR1c0Jhck1vZGU6IFN0YXR1c0Jhck1vZGU7XG4gIC8qKlxuICAgKiBTdGFydCBzeW5jaW5nIHdoZW4gT2JzaWRpYW4gbG9hZHMgKGRlZmF1bHQpLiBPRkYgPSBtYW51YWwtb25seSBtb2RlOiB0aGVcbiAgICogcGx1Z2luIGxvYWRzIGlkbGUgYW5kIHRoZSBmaXJzdCBcIlN5bmMgbm93XCIgc3RhcnRzIGl0LlxuICAgKi9cbiAgc3luY09uU3RhcnR1cDogYm9vbGVhbjtcbiAgLyoqIERpYWdub3N0aWNzIGxvZyBsZXZlbDsgYGRlYnVnYCBhbHNvIGxvZ3MgcHJvdG9jb2wgcm91bmQtdHJpcHMuICovXG4gIGxvZ0xldmVsOiBMb2dMZXZlbDtcbiAgLyoqIFJhdyBpZ25vcmUtcGF0dGVybiB0ZXh0LCBvbmUgcGF0dGVybiBwZXIgbGluZSAoc2VlIGBwYXJzZUlnbm9yZVBhdHRlcm5zYCkuICovXG4gIGlnbm9yZVBhdHRlcm5zOiBzdHJpbmc7XG59XG5cbi8qKiBTaGFwZSBvZiB0aGUgcGx1Z2luJ3MgYGRhdGEuanNvbmAuICovXG5leHBvcnQgaW50ZXJmYWNlIFZhdWx0U3luY1BsdWdpbkRhdGEge1xuICAvKiogV29ya2VyIG9yaWdpbiwgZS5nLiBgaHR0cHM6Ly9wZXJzb25hbC54LndvcmtlcnMuZGV2YCAoZW1wdHkgcHJlLXBhaXIpLiAqL1xuICB1cmw6IHN0cmluZztcbiAgLyoqIExvbmctbGl2ZWQgZGV2aWNlIHRva2VuIChlbXB0eSBwcmUtcGFpcikuICovXG4gIHRva2VuOiBzdHJpbmc7XG4gIC8qKiBEZXZpY2UgaWQgYXNzaWduZWQgYnkgdGhlIHdvcmtlciBhdCBwYWlyIHRpbWUuICovXG4gIGRldmljZUlkOiBzdHJpbmc7XG4gIC8qKiBIdW1hbi1yZWFkYWJsZSBkZXZpY2UgbmFtZSBzaG93biBpbiB0aGUgZGFzaGJvYXJkJ3MgZGV2aWNlIGxpc3QuICovXG4gIGRldmljZU5hbWU6IHN0cmluZztcbiAgc2V0dGluZ3M6IFBsdWdpblN5bmNTZXR0aW5ncztcbn1cblxuZXhwb3J0IGNvbnN0IERFRkFVTFRfUkVTQ0FOX0lOVEVSVkFMX1NFQyA9IDMwO1xuXG4vKiogQ2hvaWNlcyBvZmZlcmVkIGJ5IHRoZSBzZXR0aW5ncyBkcm9wZG93bjogc2Vjb25kcyBcdTIxOTIgbGFiZWwuICovXG5leHBvcnQgY29uc3QgUkVTQ0FOX0lOVEVSVkFMX0NIT0lDRVM6IFJlYWRvbmx5QXJyYXk8eyB2YWx1ZTogbnVtYmVyOyBsYWJlbDogc3RyaW5nIH0+ID0gW1xuICB7IHZhbHVlOiAxMCwgbGFiZWw6ICdFdmVyeSAxMCBzZWNvbmRzJyB9LFxuICB7IHZhbHVlOiAzMCwgbGFiZWw6ICdFdmVyeSAzMCBzZWNvbmRzJyB9LFxuICB7IHZhbHVlOiA2MCwgbGFiZWw6ICdFdmVyeSBtaW51dGUnIH0sXG4gIHsgdmFsdWU6IDMwMCwgbGFiZWw6ICdFdmVyeSA1IG1pbnV0ZXMnIH0sXG4gIHsgdmFsdWU6IDAsIGxhYmVsOiAnT2ZmICh2YXVsdCBldmVudHMgb25seSknIH0sXG5dO1xuXG5leHBvcnQgZnVuY3Rpb24gZGVmYXVsdFBsdWdpbkRhdGEoKTogVmF1bHRTeW5jUGx1Z2luRGF0YSB7XG4gIHJldHVybiB7XG4gICAgdXJsOiAnJyxcbiAgICB0b2tlbjogJycsXG4gICAgZGV2aWNlSWQ6ICcnLFxuICAgIGRldmljZU5hbWU6ICcnLFxuICAgIHNldHRpbmdzOiB7XG4gICAgICByZXNjYW5JbnRlcnZhbFNlYzogREVGQVVMVF9SRVNDQU5fSU5URVJWQUxfU0VDLFxuICAgICAgb2JzaWRpYW5TeW5jOiBmYWxzZSxcbiAgICAgIHN0YXR1c0Jhck1vZGU6ICdkZXRhaWxlZCcsXG4gICAgICBzeW5jT25TdGFydHVwOiB0cnVlLFxuICAgICAgbG9nTGV2ZWw6ICdpbmZvJyxcbiAgICAgIGlnbm9yZVBhdHRlcm5zOiAnJyxcbiAgICB9LFxuICB9O1xufVxuXG4vKiogQ29lcmNlIHdoYXRldmVyIGBsb2FkRGF0YSgpYCByZXR1cm5lZCBpbnRvIGEgd2VsbC1mb3JtZWQgb2JqZWN0LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZVBsdWdpbkRhdGEocmF3OiB1bmtub3duKTogVmF1bHRTeW5jUGx1Z2luRGF0YSB7XG4gIGNvbnN0IGJhc2UgPSBkZWZhdWx0UGx1Z2luRGF0YSgpO1xuICBpZiAodHlwZW9mIHJhdyAhPT0gJ29iamVjdCcgfHwgcmF3ID09PSBudWxsKSByZXR1cm4gYmFzZTtcbiAgY29uc3Qgc291cmNlID0gcmF3IGFzIFBhcnRpYWw8VmF1bHRTeW5jUGx1Z2luRGF0YT4gJiB7IHNldHRpbmdzPzogUGFydGlhbDxQbHVnaW5TeW5jU2V0dGluZ3M+IH07XG4gIGNvbnN0IHN0YXR1c0Jhck1vZGUgPSBzb3VyY2Uuc2V0dGluZ3M/LnN0YXR1c0Jhck1vZGU7XG4gIGNvbnN0IGxvZ0xldmVsID0gc291cmNlLnNldHRpbmdzPy5sb2dMZXZlbDtcbiAgcmV0dXJuIHtcbiAgICB1cmw6IHR5cGVvZiBzb3VyY2UudXJsID09PSAnc3RyaW5nJyA/IHNvdXJjZS51cmwgOiAnJyxcbiAgICB0b2tlbjogdHlwZW9mIHNvdXJjZS50b2tlbiA9PT0gJ3N0cmluZycgPyBzb3VyY2UudG9rZW4gOiAnJyxcbiAgICBkZXZpY2VJZDogdHlwZW9mIHNvdXJjZS5kZXZpY2VJZCA9PT0gJ3N0cmluZycgPyBzb3VyY2UuZGV2aWNlSWQgOiAnJyxcbiAgICBkZXZpY2VOYW1lOiB0eXBlb2Ygc291cmNlLmRldmljZU5hbWUgPT09ICdzdHJpbmcnID8gc291cmNlLmRldmljZU5hbWUgOiAnJyxcbiAgICBzZXR0aW5nczoge1xuICAgICAgcmVzY2FuSW50ZXJ2YWxTZWM6XG4gICAgICAgIHR5cGVvZiBzb3VyY2Uuc2V0dGluZ3M/LnJlc2NhbkludGVydmFsU2VjID09PSAnbnVtYmVyJyAmJiBzb3VyY2Uuc2V0dGluZ3MucmVzY2FuSW50ZXJ2YWxTZWMgPj0gMFxuICAgICAgICAgID8gTWF0aC5mbG9vcihzb3VyY2Uuc2V0dGluZ3MucmVzY2FuSW50ZXJ2YWxTZWMpXG4gICAgICAgICAgOiBERUZBVUxUX1JFU0NBTl9JTlRFUlZBTF9TRUMsXG4gICAgICBvYnNpZGlhblN5bmM6IHNvdXJjZS5zZXR0aW5ncz8ub2JzaWRpYW5TeW5jID09PSB0cnVlLFxuICAgICAgc3RhdHVzQmFyTW9kZTpcbiAgICAgICAgc3RhdHVzQmFyTW9kZSA9PT0gJ2NvbXBhY3QnIHx8IHN0YXR1c0Jhck1vZGUgPT09ICdoaWRkZW4nID8gc3RhdHVzQmFyTW9kZSA6ICdkZXRhaWxlZCcsXG4gICAgICBzeW5jT25TdGFydHVwOiBzb3VyY2Uuc2V0dGluZ3M/LnN5bmNPblN0YXJ0dXAgIT09IGZhbHNlLFxuICAgICAgbG9nTGV2ZWw6IGxvZ0xldmVsID09PSAnZGVidWcnIHx8IGxvZ0xldmVsID09PSAnd2FybicgPyBsb2dMZXZlbCA6ICdpbmZvJyxcbiAgICAgIGlnbm9yZVBhdHRlcm5zOiB0eXBlb2Ygc291cmNlLnNldHRpbmdzPy5pZ25vcmVQYXR0ZXJucyA9PT0gJ3N0cmluZycgPyBzb3VyY2Uuc2V0dGluZ3MuaWdub3JlUGF0dGVybnMgOiAnJyxcbiAgICB9LFxuICB9O1xufVxuXG4vKipcbiAqIElnbm9yZS1wYXR0ZXJuIHRleHQgXHUyMTkyIHBhdHRlcm4gbGlzdDogb25lIHBhdHRlcm4gcGVyIGxpbmUsIHRyaW1tZWQsIGJsYW5rXG4gKiBsaW5lcyBkcm9wcGVkLiBQdXJlIFx1MjAxNCBzYWZlIHRvIGNhbGwgb24gZXZlcnkgYHN0YXJ0U3luY2AuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZUlnbm9yZVBhdHRlcm5zKHRleHQ6IHN0cmluZyk6IHN0cmluZ1tdIHtcbiAgcmV0dXJuIHRleHRcbiAgICAuc3BsaXQoL1xccj9cXG4vKVxuICAgIC5tYXAoKGxpbmUpID0+IGxpbmUudHJpbSgpKVxuICAgIC5maWx0ZXIoKGxpbmUpID0+IGxpbmUgIT09ICcnKTtcbn1cblxuLyoqIEEgdmF1bHQgaXMgbGlua2VkIGlmZiBwYWlyIGlkZW50aXR5IGlzIGNvbXBsZXRlLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzTGlua2VkKGRhdGE6IFZhdWx0U3luY1BsdWdpbkRhdGEpOiBib29sZWFuIHtcbiAgcmV0dXJuIGRhdGEudXJsICE9PSAnJyAmJiBkYXRhLnRva2VuICE9PSAnJyAmJiBkYXRhLmRldmljZUlkICE9PSAnJztcbn1cblxuLyoqIERldmljZSB0eXBlIGZvciB0aGUgd29ya2VyIHJlZ2lzdHJ5LCBmcm9tIHRoZSBwbGF0Zm9ybSAoRlItMjMpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRldGVjdERldmljZVR5cGUoKTogJ2Rlc2t0b3AnIHwgJ21vYmlsZScge1xuICByZXR1cm4gUGxhdGZvcm0uaXNNb2JpbGVBcHAgPyAnbW9iaWxlJyA6ICdkZXNrdG9wJztcbn1cblxuLyoqIERlZmF1bHQgZGV2aWNlIG5hbWUgd2hlbiB0aGUgdXNlciBoYXMgbm90IHR5cGVkIG9uZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkZWZhdWx0RGV2aWNlTmFtZSgpOiBzdHJpbmcge1xuICBpZiAoUGxhdGZvcm0uaXNNb2JpbGVBcHApIHtcbiAgICBpZiAoUGxhdGZvcm0uaXNJb3NBcHApIHJldHVybiAnaVBob25lL2lQYWQnO1xuICAgIGlmIChQbGF0Zm9ybS5pc0FuZHJvaWRBcHApIHJldHVybiAnQW5kcm9pZCc7XG4gICAgcmV0dXJuICdPYnNpZGlhbiBtb2JpbGUnO1xuICB9XG4gIHJldHVybiAnT2JzaWRpYW4gZGVza3RvcCc7XG59XG4iLCAiLyoqXG4gKiBNaW5pbWFsIHR5cGVkIGNsaWVudCBmb3IgdGhlIHdvcmtlcidzIEhUVFAgc3VyZmFjZSBhcyB0aGUgcGx1Z2luIHVzZXMgaXQ6XG4gKiBgR0VUIC9oZWFsdGhgIChjbGFpbS1zdGF0ZSBwcm9iZSBiZWZvcmUgcGFpcmluZyksIGBQT1NUIC9wYWlyYCAocmVkZWVtIGFcbiAqIHBhaXJpbmcgY29kZSwgQVJDSElURUNUVVJFIFx1MDBBNzMpLCBgUEFUQ0ggL2RldmljZWAgKGRldmljZSBzZWxmLXNlcnZpY2VcbiAqIHJlbmFtZSksIGFuZCBgR0VUIC9hcGkvc3RhdHVzYCAoc3RvcmFnZS9kZXZpY2Ugc3VtbWFyeSBmb3IgQWJvdXQpLiBCdWlsdFxuICogb24gYW4gaW5qZWN0YWJsZSBgZmV0Y2hgOyBmYWlsdXJlcyBtYXAgdG8gdHlwZWQgZXJyb3JzIHdpdGggYWN0aW9uYWJsZVxuICogbWVzc2FnZXMgc28gdGhlIHNldHRpbmdzIFVJIGFuZCB0aGUgZGVlcC1saW5rIGhhbmRsZXIgbmV2ZXIgc2VlIGEgcmF3XG4gKiBgVHlwZUVycm9yOiBGYWlsZWQgdG8gZmV0Y2hgLlxuICovXG5cbi8qKiBBIHdvcmtlciBjYWxsIGZhaWxlZCAodW5yZWFjaGFibGUgb3IgdW5leHBlY3RlZCBIVFRQKS4gKi9cbmV4cG9ydCBjbGFzcyBXb3JrZXJBcGlFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgY29uc3RydWN0b3IoXG4gICAgbWVzc2FnZTogc3RyaW5nLFxuICAgIHJlYWRvbmx5IHN0YXR1cz86IG51bWJlcixcbiAgKSB7XG4gICAgc3VwZXIobWVzc2FnZSk7XG4gICAgdGhpcy5uYW1lID0gJ1dvcmtlckFwaUVycm9yJztcbiAgfVxufVxuXG4vKiogVGhlIHBhaXJpbmcgY29kZSB3YXMgcmVqZWN0ZWQgKGludmFsaWQgLyBleHBpcmVkIC8gYWxyZWFkeSB1c2VkKS4gKi9cbmV4cG9ydCBjbGFzcyBQYWlyUmVqZWN0ZWRFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgY29uc3RydWN0b3IobWVzc2FnZTogc3RyaW5nKSB7XG4gICAgc3VwZXIobWVzc2FnZSk7XG4gICAgdGhpcy5uYW1lID0gJ1BhaXJSZWplY3RlZEVycm9yJztcbiAgfVxufVxuXG4vKiogVGhlIHdvcmtlciBleGlzdHMgYnV0IGhhcyBub3QgYmVlbiBjbGFpbWVkIHlldCAoSFRUUCA0MjEgc2VtYW50aWNzKS4gKi9cbmV4cG9ydCBjbGFzcyBVbmNsYWltZWRXb3JrZXJFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgY29uc3RydWN0b3IobWVzc2FnZTogc3RyaW5nKSB7XG4gICAgc3VwZXIobWVzc2FnZSk7XG4gICAgdGhpcy5uYW1lID0gJ1VuY2xhaW1lZFdvcmtlckVycm9yJztcbiAgfVxufVxuXG5leHBvcnQgaW50ZXJmYWNlIEhlYWx0aEluZm8ge1xuICByZWFjaGFibGU6IGJvb2xlYW47XG4gIGNsYWltZWQ6IGJvb2xlYW47XG4gIC8qKiBIdW1hbi1yZWFkYWJsZSByZWFzb24gd2hlbiB0aGUgd29ya2VyIGNvdWxkIG5vdCBiZSByZWFjaGVkLiAqL1xuICByZWFzb24/OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUGFpckNyZWRlbnRpYWxzIHtcbiAgdG9rZW46IHN0cmluZztcbiAgZGV2aWNlSWQ6IHN0cmluZztcbn1cblxuLyoqXG4gKiBOb3JtYWxpemUgdXNlciBpbnB1dCBpbnRvIGEgd29ya2VyIG9yaWdpbjogdHJpbXMsIHRvbGVyYXRlcyBhIG1pc3NpbmdcbiAqIHNjaGVtZSAoYXNzdW1lcyBodHRwcyksIGEgdHJhaWxpbmcgc2xhc2gsIGFuZCBzdHJheSBwYXRoIGNvbXBvbmVudHM7XG4gKiByZXR1cm5zIGBodHRwczovL2hvc3RgIHN0eWxlIG9yaWdpbi4gVGhyb3dzIGBXb3JrZXJBcGlFcnJvcmAgb24gZ2FyYmFnZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZVdvcmtlclVybChpbnB1dDogc3RyaW5nKTogc3RyaW5nIHtcbiAgbGV0IGNhbmRpZGF0ZSA9IGlucHV0LnRyaW0oKTtcbiAgaWYgKGNhbmRpZGF0ZSA9PT0gJycpIHRocm93IG5ldyBXb3JrZXJBcGlFcnJvcignd29ya2VyIFVSTCBpcyBlbXB0eScpO1xuICBpZiAoIS9eW2EtekEtWl1bYS16QS1aMC05Ky4tXSo6XFwvXFwvLy50ZXN0KGNhbmRpZGF0ZSkpIGNhbmRpZGF0ZSA9IGBodHRwczovLyR7Y2FuZGlkYXRlfWA7XG4gIGxldCBvcmlnaW46IHN0cmluZztcbiAgdHJ5IHtcbiAgICBvcmlnaW4gPSBuZXcgVVJMKGNhbmRpZGF0ZSkub3JpZ2luO1xuICB9IGNhdGNoIHtcbiAgICB0aHJvdyBuZXcgV29ya2VyQXBpRXJyb3IoYGludmFsaWQgd29ya2VyIFVSTDogJHtKU09OLnN0cmluZ2lmeShpbnB1dCl9YCk7XG4gIH1cbiAgaWYgKCFvcmlnaW4uc3RhcnRzV2l0aCgnaHR0cDovLycpICYmICFvcmlnaW4uc3RhcnRzV2l0aCgnaHR0cHM6Ly8nKSkge1xuICAgIHRocm93IG5ldyBXb3JrZXJBcGlFcnJvcihgd29ya2VyIFVSTCBtdXN0IGJlIGh0dHAocyksIGdvdCAke29yaWdpbn1gKTtcbiAgfVxuICByZXR1cm4gb3JpZ2luO1xufVxuXG4vKiogR0VUIC9oZWFsdGggXHUyMDE0IG5ldmVyIHRocm93cyBmb3IgcmVhY2hhYmlsaXR5OyByZXBvcnRzIGNsYWltIHN0YXRlIGluc3RlYWQuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZmV0Y2hIZWFsdGgoXG4gIG9yaWdpbjogc3RyaW5nLFxuICBmZXRjaEltcGw6IHR5cGVvZiBmZXRjaCxcbik6IFByb21pc2U8SGVhbHRoSW5mbz4ge1xuICBsZXQgcmVzcG9uc2U6IFJlc3BvbnNlO1xuICB0cnkge1xuICAgIHJlc3BvbnNlID0gYXdhaXQgZmV0Y2hJbXBsKGAke29yaWdpbn0vaGVhbHRoYCk7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHJlYWNoYWJsZTogZmFsc2UsXG4gICAgICBjbGFpbWVkOiBmYWxzZSxcbiAgICAgIHJlYXNvbjogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpLFxuICAgIH07XG4gIH1cbiAgaWYgKCFyZXNwb25zZS5vaykge1xuICAgIHJldHVybiB7IHJlYWNoYWJsZTogZmFsc2UsIGNsYWltZWQ6IGZhbHNlLCByZWFzb246IGBIVFRQICR7cmVzcG9uc2Uuc3RhdHVzfWAgfTtcbiAgfVxuICBjb25zdCBib2R5ID0gKGF3YWl0IHJlc3BvbnNlLmpzb24oKS5jYXRjaCgoKSA9PiAoe30pKSkgYXMgeyBjbGFpbWVkPzogYm9vbGVhbiB9O1xuICByZXR1cm4geyByZWFjaGFibGU6IHRydWUsIGNsYWltZWQ6IGJvZHkuY2xhaW1lZCA9PT0gdHJ1ZSB9O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFBhaXJSZXF1ZXN0UGFyYW1zIHtcbiAgb3JpZ2luOiBzdHJpbmc7XG4gIGNvZGU6IHN0cmluZztcbiAgZGV2aWNlTmFtZTogc3RyaW5nO1xuICBkZXZpY2VUeXBlOiAnZGVza3RvcCcgfCAnbW9iaWxlJztcbiAgZmV0Y2hJbXBsOiB0eXBlb2YgZmV0Y2g7XG59XG5cbi8qKlxuICogUE9TVCAvcGFpciBcdTIwMTQgcmVkZWVtIGEgb25lLXRpbWUgcGFpcmluZyBjb2RlIGZvciBsb25nLWxpdmVkIGRldmljZVxuICogY3JlZGVudGlhbHMuIFRocm93cyBgUGFpclJlamVjdGVkRXJyb3JgIChiYWQgY29kZSksIGBVbmNsYWltZWRXb3JrZXJFcnJvcmBcbiAqICg0MjEpLCBvciBgV29ya2VyQXBpRXJyb3JgICh1bnJlYWNoYWJsZSAvIHVuZXhwZWN0ZWQpLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVxdWVzdFBhaXIocGFyYW1zOiBQYWlyUmVxdWVzdFBhcmFtcyk6IFByb21pc2U8UGFpckNyZWRlbnRpYWxzPiB7XG4gIGxldCByZXNwb25zZTogUmVzcG9uc2U7XG4gIHRyeSB7XG4gICAgcmVzcG9uc2UgPSBhd2FpdCBwYXJhbXMuZmV0Y2hJbXBsKGAke3BhcmFtcy5vcmlnaW59L3BhaXJgLCB7XG4gICAgICBtZXRob2Q6ICdQT1NUJyxcbiAgICAgIGhlYWRlcnM6IHsgJ2NvbnRlbnQtdHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyB9LFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBjb2RlOiBwYXJhbXMuY29kZSxcbiAgICAgICAgZGV2aWNlTmFtZTogcGFyYW1zLmRldmljZU5hbWUsXG4gICAgICAgIGRldmljZVR5cGU6IHBhcmFtcy5kZXZpY2VUeXBlLFxuICAgICAgfSksXG4gICAgfSk7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgdGhyb3cgbmV3IFdvcmtlckFwaUVycm9yKFxuICAgICAgYGNvdWxkIG5vdCByZWFjaCB0aGUgd29ya2VyIGF0ICR7cGFyYW1zLm9yaWdpbn06ICR7XG4gICAgICAgIGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKVxuICAgICAgfWAsXG4gICAgKTtcbiAgfVxuICAvLyBSZWFkIHRoZSBib2R5IG9uY2UgKGEgUmVzcG9uc2UgYm9keSBpcyBzaW5nbGUtdXNlKSBhbmQgcGFyc2UgZnJvbSB0ZXh0LlxuICBjb25zdCBkZXRhaWwgPSAoYXdhaXQgcmVzcG9uc2UudGV4dCgpLmNhdGNoKCgpID0+ICcnKSkudHJpbSgpO1xuICBpZiAocmVzcG9uc2Uuc3RhdHVzID09PSA0MjEpIHtcbiAgICB0aHJvdyBuZXcgVW5jbGFpbWVkV29ya2VyRXJyb3IoJ3RoaXMgd29ya2VyIGhhcyBub3QgYmVlbiBjbGFpbWVkIHlldCcpO1xuICB9XG4gIGlmIChyZXNwb25zZS5zdGF0dXMgPT09IDQwMSB8fCByZXNwb25zZS5zdGF0dXMgPT09IDQwMykge1xuICAgIHRocm93IG5ldyBQYWlyUmVqZWN0ZWRFcnJvcihcbiAgICAgICdwYWlyaW5nIGNvZGUgcmVqZWN0ZWQgXHUyMDE0IGNvZGVzIGFyZSBvbmUtdGltZSwgZXhwaXJlIGFmdGVyIDEwIG1pbnV0ZXMsIGFuZCBjb21lICcgK1xuICAgICAgICAnZnJvbSB0aGUgd29ya2VyIGRhc2hib2FyZC4gR2VuZXJhdGUgYSBmcmVzaCBvbmUgYW5kIHJldHJ5LicsXG4gICAgKTtcbiAgfVxuICBpZiAoIXJlc3BvbnNlLm9rKSB7XG4gICAgdGhyb3cgbmV3IFdvcmtlckFwaUVycm9yKFxuICAgICAgYHBhaXJpbmcgZmFpbGVkOiBIVFRQICR7cmVzcG9uc2Uuc3RhdHVzfSAke2RldGFpbC5zbGljZSgwLCAyMDApfWAudHJpbSgpLFxuICAgICAgcmVzcG9uc2Uuc3RhdHVzLFxuICAgICk7XG4gIH1cbiAgbGV0IGJvZHk6IHsgdG9rZW4/OiB1bmtub3duOyBkZXZpY2VJZD86IHVua25vd24gfTtcbiAgdHJ5IHtcbiAgICBib2R5ID0gSlNPTi5wYXJzZShkZXRhaWwpIGFzIHsgdG9rZW4/OiB1bmtub3duOyBkZXZpY2VJZD86IHVua25vd24gfTtcbiAgfSBjYXRjaCB7XG4gICAgdGhyb3cgbmV3IFdvcmtlckFwaUVycm9yKCdwYWlyaW5nIHJlcGx5IHdhcyBub3QgSlNPTicsIHJlc3BvbnNlLnN0YXR1cyk7XG4gIH1cbiAgaWYgKHR5cGVvZiBib2R5LnRva2VuICE9PSAnc3RyaW5nJyB8fCB0eXBlb2YgYm9keS5kZXZpY2VJZCAhPT0gJ3N0cmluZycpIHtcbiAgICB0aHJvdyBuZXcgV29ya2VyQXBpRXJyb3IoJ3BhaXJpbmcgcmVwbHkgd2FzIG1pc3NpbmcgdG9rZW4vZGV2aWNlSWQnLCByZXNwb25zZS5zdGF0dXMpO1xuICB9XG4gIHJldHVybiB7IHRva2VuOiBib2R5LnRva2VuLCBkZXZpY2VJZDogYm9keS5kZXZpY2VJZCB9O1xufVxuXG4vLyAtLS0gZGV2aWNlIHNlbGYtc2VydmljZSAoUEFUQ0ggL2RldmljZSkgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFRoZSBkZXZpY2UgZG9jdW1lbnQgdGhlIHdvcmtlciByZXR1cm5zIGZyb20gYFBBVENIIC9kZXZpY2VgLiAqL1xuZXhwb3J0IGludGVyZmFjZSBXb3JrZXJEZXZpY2Uge1xuICBpZDogc3RyaW5nO1xuICBuYW1lOiBzdHJpbmc7XG4gIHR5cGU6IHN0cmluZztcbn1cblxuZXhwb3J0IHR5cGUgUmVuYW1lT3V0Y29tZSA9XG4gIHwgeyBvazogdHJ1ZTsgZGV2aWNlOiBXb3JrZXJEZXZpY2UgfVxuICB8IHsgb2s6IGZhbHNlOyBlcnJvcjogc3RyaW5nIH07XG5cbmV4cG9ydCBpbnRlcmZhY2UgUmVuYW1lUGFyYW1zIHtcbiAgb3JpZ2luOiBzdHJpbmc7XG4gIC8qKiBUaGUgY2FsbGluZyBkZXZpY2UncyBvd24gdG9rZW4gXHUyMDE0IGl0IGNhbiBvbmx5IGV2ZXIgcmVuYW1lIGl0c2VsZi4gKi9cbiAgdG9rZW46IHN0cmluZztcbiAgbmFtZTogc3RyaW5nO1xuICBmZXRjaEltcGw6IHR5cGVvZiBmZXRjaDtcbn1cblxuLyoqXG4gKiBgUEFUQ0ggL2RldmljZWAgXHUyMDE0IHJlbmFtZSBUSElTIGRldmljZSBvbiB0aGUgd29ya2VyIChkZXZpY2UtdG9rZW5cbiAqIGF1dGhlbnRpY2F0ZWQ7IG5ldmVyIHRocm93czogZmFpbHVyZXMgY29tZSBiYWNrIGFzIGB7b2s6ZmFsc2UsIGVycm9yfWApLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVuYW1lRGV2aWNlKHBhcmFtczogUmVuYW1lUGFyYW1zKTogUHJvbWlzZTxSZW5hbWVPdXRjb21lPiB7XG4gIGxldCByZXNwb25zZTogUmVzcG9uc2U7XG4gIHRyeSB7XG4gICAgcmVzcG9uc2UgPSBhd2FpdCBwYXJhbXMuZmV0Y2hJbXBsKGAke3BhcmFtcy5vcmlnaW59L2RldmljZWAsIHtcbiAgICAgIG1ldGhvZDogJ1BBVENIJyxcbiAgICAgIGhlYWRlcnM6IHsgJ2NvbnRlbnQtdHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJywgYXV0aG9yaXphdGlvbjogYEJlYXJlciAke3BhcmFtcy50b2tlbn1gIH0sXG4gICAgICBib2R5OiBKU09OLnN0cmluZ2lmeSh7IG5hbWU6IHBhcmFtcy5uYW1lIH0pLFxuICAgIH0pO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIHJldHVybiB7XG4gICAgICBvazogZmFsc2UsXG4gICAgICBlcnJvcjogYGNvdWxkIG5vdCByZWFjaCB0aGUgd29ya2VyIGF0ICR7cGFyYW1zLm9yaWdpbn06ICR7XG4gICAgICAgIGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKVxuICAgICAgfWAsXG4gICAgfTtcbiAgfVxuICBjb25zdCBkZXRhaWwgPSAoYXdhaXQgcmVzcG9uc2UudGV4dCgpLmNhdGNoKCgpID0+ICcnKSkudHJpbSgpO1xuICBpZiAocmVzcG9uc2Uuc3RhdHVzID09PSA0MjEpIHtcbiAgICByZXR1cm4geyBvazogZmFsc2UsIGVycm9yOiAndGhpcyB3b3JrZXIgaGFzIG5vdCBiZWVuIGNsYWltZWQgeWV0JyB9O1xuICB9XG4gIGlmIChyZXNwb25zZS5zdGF0dXMgPT09IDQwMSB8fCByZXNwb25zZS5zdGF0dXMgPT09IDQwMykge1xuICAgIHJldHVybiB7XG4gICAgICBvazogZmFsc2UsXG4gICAgICBlcnJvcjogJ3RoZSB3b3JrZXIgcmVqZWN0ZWQgdGhpcyBkZXZpY2VcXHUyMDE5cyB0b2tlbiAocmV2b2tlZD8pIFx1MjAxNCB1bmxpbmsgYW5kIHJlLXBhaXIgd2l0aCBhIGZyZXNoIGNvZGUuJyxcbiAgICB9O1xuICB9XG4gIGlmICghcmVzcG9uc2Uub2spIHtcbiAgICBsZXQgcmVhc29uID0gYEhUVFAgJHtyZXNwb25zZS5zdGF0dXN9YDtcbiAgICB0cnkge1xuICAgICAgY29uc3QgcGFyc2VkID0gSlNPTi5wYXJzZShkZXRhaWwpIGFzIHsgZXJyb3I/OiB1bmtub3duIH07XG4gICAgICBpZiAodHlwZW9mIHBhcnNlZC5lcnJvciA9PT0gJ3N0cmluZycpIHJlYXNvbiA9IHBhcnNlZC5lcnJvcjtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIGtlZXAgdGhlIGJhcmUgc3RhdHVzXG4gICAgfVxuICAgIHJldHVybiB7IG9rOiBmYWxzZSwgZXJyb3I6IHJlYXNvbiB9O1xuICB9XG4gIGxldCBib2R5OiB7IGRldmljZT86IHVua25vd24gfTtcbiAgdHJ5IHtcbiAgICBib2R5ID0gSlNPTi5wYXJzZShkZXRhaWwpIGFzIHsgZGV2aWNlPzogdW5rbm93biB9O1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4geyBvazogZmFsc2UsIGVycm9yOiAncmVuYW1lIHJlcGx5IHdhcyBub3QgSlNPTicgfTtcbiAgfVxuICBjb25zdCBkZXZpY2UgPSBib2R5LmRldmljZSBhcyBQYXJ0aWFsPFdvcmtlckRldmljZT4gfCB1bmRlZmluZWQ7XG4gIGlmIChcbiAgICB0eXBlb2YgZGV2aWNlPy5pZCAhPT0gJ3N0cmluZycgfHxcbiAgICB0eXBlb2YgZGV2aWNlLm5hbWUgIT09ICdzdHJpbmcnIHx8XG4gICAgdHlwZW9mIGRldmljZS50eXBlICE9PSAnc3RyaW5nJ1xuICApIHtcbiAgICByZXR1cm4geyBvazogZmFsc2UsIGVycm9yOiAncmVuYW1lIHJlcGx5IHdhcyBtaXNzaW5nIHRoZSBkZXZpY2UgZG9jdW1lbnQnIH07XG4gIH1cbiAgcmV0dXJuIHsgb2s6IHRydWUsIGRldmljZTogeyBpZDogZGV2aWNlLmlkLCBuYW1lOiBkZXZpY2UubmFtZSwgdHlwZTogZGV2aWNlLnR5cGUgfSB9O1xufVxuXG4vLyAtLS0gd29ya2VyIHN0YXR1cyAoR0VUIC9hcGkvc3RhdHVzLCBkZXZpY2UgdG9rZW4pIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBUaGUgc2xpY2Ugb2YgYC9hcGkvc3RhdHVzYCB0aGUgcGx1Z2luJ3MgQWJvdXQgc2VjdGlvbiBzaG93cy4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgV29ya2VyU3RhdHVzU3VtbWFyeSB7XG4gIHZhdWx0TmFtZTogc3RyaW5nO1xuICBkZXZpY2VzOiBBcnJheTx7IGlkOiBzdHJpbmc7IG5hbWU6IHN0cmluZzsgdHlwZTogc3RyaW5nOyBvbmxpbmU6IGJvb2xlYW47IHJldm9rZWQ6IGJvb2xlYW4gfT47XG4gIGF0dGFjaG1lbnRzOiB7IGNvdW50OiBudW1iZXI7IGJ5dGVzOiBudW1iZXIgfTtcbiAgc3RvcmFnZUJ5dGVzOiBudW1iZXI7XG4gIC8qKiBXb3JrZXItcmVwb3J0ZWQgcmVsZWFzZSB2ZXJzaW9uIChhYnNlbnQgb24gc2VydmVycyBcdTIyNjQgMC4xKS4gKi9cbiAgc2VydmVyVmVyc2lvbj86IHN0cmluZztcbn1cblxuLyoqXG4gKiBgR0VUIC9hcGkvc3RhdHVzYCB3aXRoIHRoZSBkZXZpY2UgdG9rZW4gXHUyMDE0IHN0b3JhZ2UgdXNhZ2UgKyBkZXZpY2UgbGlzdCBmb3JcbiAqIHRoZSBBYm91dCBzZWN0aW9uLiBSZXNvbHZlcyBgbnVsbGAgb24gYW55IGZhaWx1cmUgKEFib3V0IHNob3dzIFwidW5rbm93blwiKS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGZldGNoV29ya2VyU3RhdHVzKHBhcmFtczoge1xuICBvcmlnaW46IHN0cmluZztcbiAgdG9rZW46IHN0cmluZztcbiAgZmV0Y2hJbXBsOiB0eXBlb2YgZmV0Y2g7XG59KTogUHJvbWlzZTxXb3JrZXJTdGF0dXNTdW1tYXJ5IHwgbnVsbD4ge1xuICBsZXQgcmVzcG9uc2U6IFJlc3BvbnNlO1xuICB0cnkge1xuICAgIHJlc3BvbnNlID0gYXdhaXQgcGFyYW1zLmZldGNoSW1wbChgJHtwYXJhbXMub3JpZ2lufS9hcGkvc3RhdHVzYCwge1xuICAgICAgaGVhZGVyczogeyBhdXRob3JpemF0aW9uOiBgQmVhcmVyICR7cGFyYW1zLnRva2VufWAgfSxcbiAgICB9KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIG51bGw7XG4gIH1cbiAgaWYgKCFyZXNwb25zZS5vaykgcmV0dXJuIG51bGw7XG4gIGNvbnN0IGJvZHkgPSAoYXdhaXQgcmVzcG9uc2UuanNvbigpLmNhdGNoKCgpID0+IG51bGwpKSBhcyBQYXJ0aWFsPFdvcmtlclN0YXR1c1N1bW1hcnk+IHwgbnVsbDtcbiAgaWYgKGJvZHkgPT09IG51bGwgfHwgdHlwZW9mIGJvZHkuc3RvcmFnZUJ5dGVzICE9PSAnbnVtYmVyJyB8fCB0eXBlb2YgYm9keS5hdHRhY2htZW50cyAhPT0gJ29iamVjdCcpIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuICByZXR1cm4ge1xuICAgIHZhdWx0TmFtZTogdHlwZW9mIGJvZHkudmF1bHROYW1lID09PSAnc3RyaW5nJyA/IGJvZHkudmF1bHROYW1lIDogJycsXG4gICAgZGV2aWNlczogQXJyYXkuaXNBcnJheShib2R5LmRldmljZXMpID8gYm9keS5kZXZpY2VzIDogW10sXG4gICAgYXR0YWNobWVudHM6IGJvZHkuYXR0YWNobWVudHMsXG4gICAgc3RvcmFnZUJ5dGVzOiBib2R5LnN0b3JhZ2VCeXRlcyxcbiAgICAuLi4odHlwZW9mIGJvZHkuc2VydmVyVmVyc2lvbiA9PT0gJ3N0cmluZycgPyB7IHNlcnZlclZlcnNpb246IGJvZHkuc2VydmVyVmVyc2lvbiB9IDoge30pLFxuICB9O1xufVxuIiwgIi8qKlxuICogVGhlIHBhaXIgZmxvdyBzaGFyZWQgYnkgdGhlIHNldHRpbmdzIGZvcm0gYW5kIHRoZSBgb2JzaWRpYW46Ly9gIGRlZXAgbGlua1xuICogKEFSQ0hJVEVDVFVSRSBcdTAwQTczKTogcHJvYmUgYEdFVCAvaGVhbHRoYCBmaXJzdCBcdTIwMTQgYW4gKnVuY2xhaW1lZCogd29ya2VyIGdldHNcbiAqIGZyaWVuZGx5IG9uYm9hcmRpbmcgZ3VpZGFuY2UgaW5zdGVhZCBvZiBhIGNyeXB0aWMgNDIxIFx1MjAxNCB0aGVuIGBQT1NUIC9wYWlyYFxuICogYW5kIGhhbmQgdGhlIGNyZWRlbnRpYWxzIGJhY2sgdG8gYmUgcGVyc2lzdGVkLlxuICovXG5cbmltcG9ydCB7XG4gIGZldGNoSGVhbHRoLFxuICBub3JtYWxpemVXb3JrZXJVcmwsXG4gIHJlcXVlc3RQYWlyLFxuICBQYWlyUmVqZWN0ZWRFcnJvcixcbiAgVW5jbGFpbWVkV29ya2VyRXJyb3IsXG4gIFdvcmtlckFwaUVycm9yLFxufSBmcm9tICcuL3dvcmtlcmFwaS5qcyc7XG5cbmV4cG9ydCB0eXBlIFBhaXJPdXRjb21lID1cbiAgfCB7IHN0YXR1czogJ3BhaXJlZCc7IHVybDogc3RyaW5nOyB0b2tlbjogc3RyaW5nOyBkZXZpY2VJZDogc3RyaW5nIH1cbiAgfCB7IHN0YXR1czogJ3VuY2xhaW1lZCc7IHVybDogc3RyaW5nOyBndWlkYW5jZTogc3RyaW5nIH1cbiAgfCB7IHN0YXR1czogJ3VucmVhY2hhYmxlJzsgdXJsOiBzdHJpbmc7IHJlYXNvbjogc3RyaW5nIH1cbiAgfCB7IHN0YXR1czogJ3JlamVjdGVkJzsgdXJsOiBzdHJpbmc7IHJlYXNvbjogc3RyaW5nIH1cbiAgfCB7IHN0YXR1czogJ2ludmFsaWQtdXJsJzsgaW5wdXQ6IHN0cmluZyB9O1xuXG5leHBvcnQgaW50ZXJmYWNlIFBhaXJGbG93UGFyYW1zIHtcbiAgLyoqIFdvcmtlciBVUkwgYXMgdHlwZWQgLyBkZWVwLWxpbmtlZCAoc2NoZW1lbGVzcyBpcyB0b2xlcmF0ZWQpLiAqL1xuICB1cmw6IHN0cmluZztcbiAgLyoqIE9uZS10aW1lIHBhaXJpbmcgY29kZSBmcm9tIHRoZSB3b3JrZXIgZGFzaGJvYXJkLiAqL1xuICBjb2RlOiBzdHJpbmc7XG4gIGRldmljZU5hbWU6IHN0cmluZztcbiAgZGV2aWNlVHlwZTogJ2Rlc2t0b3AnIHwgJ21vYmlsZSc7XG4gIGZldGNoSW1wbDogdHlwZW9mIGZldGNoO1xufVxuXG4vKiogT25ib2FyZGluZyB0ZXh0IHNob3duIHdoZW4gdGhlIHdvcmtlciBpcyBkZXBsb3llZCBidXQgbm90IGNsYWltZWQuICovXG5leHBvcnQgZnVuY3Rpb24gdW5jbGFpbWVkR3VpZGFuY2UodXJsOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gW1xuICAgIGBUaGUgd29ya2VyIGF0ICR7dXJsfSBpcyBkZXBsb3llZCBidXQgbm90IGNsYWltZWQgeWV0LiBGaW5pc2ggc2V0dXAgaW4gYSBicm93c2VyOmAsXG4gICAgJycsXG4gICAgYDEuIE9wZW4gJHt1cmx9YCxcbiAgICAnMi4gU2V0IHRoZSBhZG1pbiBwYXNzcGhyYXNlIGFuZCBuYW1lIHRoZSB2YXVsdCAodGhlIGNsYWltIHBhZ2UpLicsXG4gICAgJzMuIE9uIHRoZSBkYXNoYm9hcmQsIGNyZWF0ZSBhIHBhaXJpbmcgY29kZSAoRGV2aWNlcyBcdTIxOTIgUGFpciBuZXcgZGV2aWNlKS4nLFxuICAgICc0LiBFbnRlciB0aGF0IGNvZGUgaGVyZSAob3IgY2xpY2sgdGhlIG9ic2lkaWFuOi8vIGxpbmsgdGhlIGRhc2hib2FyZCBzaG93cykgYW5kIHBhaXIuJyxcbiAgXS5qb2luKCdcXG4nKTtcbn1cblxuLyoqXG4gKiBSdW4gdGhlIHBhaXIgZmxvdy4gTmV2ZXIgdGhyb3dzIFx1MjAxNCBldmVyeSBmYWlsdXJlIG1vZGUgaXMgYSB0eXBlZCBvdXRjb21lIHRoZVxuICogVUkgY2FuIHJlbmRlciAoYW5kIHRoZSBkZWVwLWxpbmsgaGFuZGxlciBjYW4gdHVybiBpbnRvIGEgTm90aWNlKS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHBhaXJXaXRoV29ya2VyKHBhcmFtczogUGFpckZsb3dQYXJhbXMpOiBQcm9taXNlPFBhaXJPdXRjb21lPiB7XG4gIGxldCBvcmlnaW46IHN0cmluZztcbiAgdHJ5IHtcbiAgICBvcmlnaW4gPSBub3JtYWxpemVXb3JrZXJVcmwocGFyYW1zLnVybCk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiB7IHN0YXR1czogJ2ludmFsaWQtdXJsJywgaW5wdXQ6IHBhcmFtcy51cmwgfTtcbiAgfVxuXG4gIGNvbnN0IGhlYWx0aCA9IGF3YWl0IGZldGNoSGVhbHRoKG9yaWdpbiwgcGFyYW1zLmZldGNoSW1wbCk7XG4gIGlmICghaGVhbHRoLnJlYWNoYWJsZSkge1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0dXM6ICd1bnJlYWNoYWJsZScsXG4gICAgICB1cmw6IG9yaWdpbixcbiAgICAgIHJlYXNvbjpcbiAgICAgICAgYCR7aGVhbHRoLnJlYXNvbiA/PyAndW5rbm93biBlcnJvcid9IFx1MjAxNCBjaGVjayB0aGUgVVJMLCB5b3VyIG5ldHdvcmssIGFuZCB0aGF0IHRoZSBgICtcbiAgICAgICAgJ3dvcmtlciBpcyBkZXBsb3llZC4nLFxuICAgIH07XG4gIH1cbiAgaWYgKCFoZWFsdGguY2xhaW1lZCkge1xuICAgIHJldHVybiB7IHN0YXR1czogJ3VuY2xhaW1lZCcsIHVybDogb3JpZ2luLCBndWlkYW5jZTogdW5jbGFpbWVkR3VpZGFuY2Uob3JpZ2luKSB9O1xuICB9XG5cbiAgdHJ5IHtcbiAgICBjb25zdCBjcmVkZW50aWFscyA9IGF3YWl0IHJlcXVlc3RQYWlyKHtcbiAgICAgIG9yaWdpbixcbiAgICAgIGNvZGU6IHBhcmFtcy5jb2RlLFxuICAgICAgZGV2aWNlTmFtZTogcGFyYW1zLmRldmljZU5hbWUsXG4gICAgICBkZXZpY2VUeXBlOiBwYXJhbXMuZGV2aWNlVHlwZSxcbiAgICAgIGZldGNoSW1wbDogcGFyYW1zLmZldGNoSW1wbCxcbiAgICB9KTtcbiAgICByZXR1cm4geyBzdGF0dXM6ICdwYWlyZWQnLCB1cmw6IG9yaWdpbiwgLi4uY3JlZGVudGlhbHMgfTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBVbmNsYWltZWRXb3JrZXJFcnJvcikge1xuICAgICAgcmV0dXJuIHsgc3RhdHVzOiAndW5jbGFpbWVkJywgdXJsOiBvcmlnaW4sIGd1aWRhbmNlOiB1bmNsYWltZWRHdWlkYW5jZShvcmlnaW4pIH07XG4gICAgfVxuICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIFBhaXJSZWplY3RlZEVycm9yKSB7XG4gICAgICByZXR1cm4geyBzdGF0dXM6ICdyZWplY3RlZCcsIHVybDogb3JpZ2luLCByZWFzb246IGVycm9yLm1lc3NhZ2UgfTtcbiAgICB9XG4gICAgY29uc3QgcmVhc29uID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpO1xuICAgIHJldHVybiB7IHN0YXR1czogJ3JlamVjdGVkJywgdXJsOiBvcmlnaW4sIHJlYXNvbiB9O1xuICB9XG59XG5cbi8qKiBSZW5kZXIgYW55IG91dGNvbWUgYXMgdXNlci1mYWNpbmcgdGV4dCAoTm90aWNlcywgZGVlcC1saW5rIGZlZWRiYWNrKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYWlyT3V0Y29tZU1lc3NhZ2Uob3V0Y29tZTogUGFpck91dGNvbWUpOiBzdHJpbmcge1xuICBzd2l0Y2ggKG91dGNvbWUuc3RhdHVzKSB7XG4gICAgY2FzZSAncGFpcmVkJzpcbiAgICAgIHJldHVybiBgUGFpcmVkIHdpdGggJHtvdXRjb21lLnVybH0gXHUyMDE0IHN5bmNpbmcgbm93LmA7XG4gICAgY2FzZSAndW5jbGFpbWVkJzpcbiAgICAgIHJldHVybiBvdXRjb21lLmd1aWRhbmNlO1xuICAgIGNhc2UgJ3VucmVhY2hhYmxlJzpcbiAgICAgIHJldHVybiBgQ291bGQgbm90IHJlYWNoIHRoZSB3b3JrZXI6ICR7b3V0Y29tZS5yZWFzb259YDtcbiAgICBjYXNlICdyZWplY3RlZCc6XG4gICAgICByZXR1cm4gYFBhaXJpbmcgZmFpbGVkOiAke291dGNvbWUucmVhc29ufWA7XG4gICAgY2FzZSAnaW52YWxpZC11cmwnOlxuICAgICAgcmV0dXJuIGBUaGF0IGRvZXMgbm90IGxvb2sgbGlrZSBhIHdvcmtlciBVUkw6ICR7SlNPTi5zdHJpbmdpZnkob3V0Y29tZS5pbnB1dCl9YDtcbiAgfVxufVxuIiwgIi8qKlxuICogYG9ic2lkaWFuOi8vdmF1bHRzeW5jZm9yYWdlbnRzL3BhaXI/dXJsPTx3b3JrZXI+JmNvZGU9PHBhaXJpbmc+YCBkZWVwLWxpbmtcbiAqIGhhbmRsaW5nIChBUkNISVRFQ1RVUkUgXHUwMEE3Myk6IHRoZSBkYXNoYm9hcmQgcmVuZGVycyB0aGlzIGxpbmsgKGFuZCB0aGUgUVJcbiAqIGVxdWl2YWxlbnQpIHNvIGEgbmV3IGRldmljZSBwYWlycyB3aXRoIHplcm8gdHlwaW5nLlxuICpcbiAqIFRoZSBoYW5kbGVyIGlzIHJlZ2lzdGVyZWQgZm9yIHRoZSBhY3Rpb24gYHZhdWx0c3luY2ZvcmFnZW50c2AuIE9ic2lkaWFuXG4gKiBidWlsZHMgZGlmZmVyIHN1YnRseSBpbiBob3cgdGhlIGAvcGFpcmAgcGF0aCBzZWdtZW50IG9mIGEgcHJvdG9jb2wgVVJMIGlzXG4gKiBtYXRjaGVkLCBzbyB0aGUgc2FtZSBoYW5kbGVyIGlzIHJlZ2lzdGVyZWQgZm9yIGB2YXVsdHN5bmNmb3JhZ2VudHMvcGFpcmBcbiAqIHRvbyBcdTIwMTQgd2hpY2hldmVyIHNwZWxsaW5nIGEgZ2l2ZW4gYnVpbGQgcmVzb2x2ZXMsIHRoZSBsaW5rIHdvcmtzLiBXaGVuXG4gKiBgdXJsYC9gY29kZWAgYXJlIGFic2VudCB0aGUgaW52b2NhdGlvbiBpcyBpZ25vcmVkIChhIHN0cmF5IHByb3RvY29sIGhpdFxuICogbXVzdCBub3Qgc3BhbSBhIE5vdGljZSk7IGEgKm1hbGZvcm1lZCogcGFpciBsaW5rIChvbmUgb2YgdGhlIHR3byBwcmVzZW50KVxuICogZ2V0cyBhbiBhY3Rpb25hYmxlIGVycm9yLlxuICovXG5cbmltcG9ydCB7IE5vdGljZSB9IGZyb20gJ29ic2lkaWFuJztcblxuLyoqIFByb3RvY29sIGFjdGlvbiAodGhlIGBvYnNpZGlhbjovL2AgXCJob3N0XCIgcGFydCkuICovXG5leHBvcnQgY29uc3QgUFJPVE9DT0xfQUNUSU9OID0gJ3ZhdWx0c3luY2ZvcmFnZW50cyc7XG5cbi8qKiBIYW5kbGVyIHNoYXBlIChPYnNpZGlhbiBwYXNzZXMgaXRzIGRlY29kZWQgcXVlcnkgcGFyYW1zKS4gKi9cbmV4cG9ydCB0eXBlIFByb3RvY29sSGFuZGxlciA9IChwYXJhbXM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSA9PiB2b2lkO1xuXG4vKiogSG93IGhhbmRsZXJzIGdldCByZWdpc3RlcmVkIFx1MjAxNCBgUGx1Z2luLnJlZ2lzdGVyT2JzaWRpYW5Qcm90b2NvbEhhbmRsZXJgLiAqL1xuZXhwb3J0IHR5cGUgUHJvdG9jb2xSZWdpc3RyYXIgPSAoYWN0aW9uOiBzdHJpbmcsIGhhbmRsZXI6IFByb3RvY29sSGFuZGxlcikgPT4gdm9pZDtcblxuLyoqIFBhcnNlZCBwYWlyIGRlZXAgbGluay4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUGFpckRlZXBMaW5rIHtcbiAgdXJsOiBzdHJpbmc7XG4gIGNvZGU6IHN0cmluZztcbn1cblxuZXhwb3J0IHR5cGUgRGVlcExpbmtQYXJzZVJlc3VsdCA9XG4gIHwgeyBvazogdHJ1ZTsgbGluazogUGFpckRlZXBMaW5rIH1cbiAgfCB7IG9rOiBmYWxzZTsgZXJyb3I6IHN0cmluZyB9O1xuXG4vKipcbiAqIEV4dHJhY3QgYHt1cmwsIGNvZGV9YCBmcm9tIE9ic2lkaWFuJ3MgZGVjb2RlZCBxdWVyeSBwYXJhbXMuIFZhbHVlcyBhcnJpdmVcbiAqIGFzIHN0cmluZ3MgKHVzdWFsbHkgYWxyZWFkeSBkZWNvZGVkOyBhIGRvdWJsZS1lbmNvZGVkIGAleHhgIHJlbW5hbnQgaXNcbiAqIGRlY29kZWQgb25jZSBtb3JlLCBiZXN0IGVmZm9ydCkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZVBhaXJEZWVwTGluayhwYXJhbXM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogRGVlcExpbmtQYXJzZVJlc3VsdCB7XG4gIGNvbnN0IHVybCA9IHBhcmFtVGV4dChwYXJhbXMsICd1cmwnKTtcbiAgY29uc3QgY29kZSA9IHBhcmFtVGV4dChwYXJhbXMsICdjb2RlJyk7XG4gIGlmICh1cmwgPT09ICcnICYmIGNvZGUgPT09ICcnKSB7XG4gICAgcmV0dXJuIHsgb2s6IGZhbHNlLCBlcnJvcjogJ25vIHBhaXJpbmcgcGFyYW1ldGVycycgfTtcbiAgfVxuICBpZiAodXJsID09PSAnJykgcmV0dXJuIHsgb2s6IGZhbHNlLCBlcnJvcjogJ2RlZXAgbGluayBpcyBtaXNzaW5nIHRoZSB3b3JrZXIgVVJMICg/dXJsPVx1MjAyNiknIH07XG4gIGlmIChjb2RlID09PSAnJykgcmV0dXJuIHsgb2s6IGZhbHNlLCBlcnJvcjogJ2RlZXAgbGluayBpcyBtaXNzaW5nIHRoZSBwYWlyaW5nIGNvZGUgKD9jb2RlPVx1MjAyNiknIH07XG4gIHJldHVybiB7IG9rOiB0cnVlLCBsaW5rOiB7IHVybCwgY29kZSB9IH07XG59XG5cbmZ1bmN0aW9uIHBhcmFtVGV4dChwYXJhbXM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBrZXk6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHZhbHVlID0gcGFyYW1zW2tleV07XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdudW1iZXInKSByZXR1cm4gU3RyaW5nKHZhbHVlKTtcbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gJ3N0cmluZycpIHJldHVybiAnJztcbiAgY29uc3QgdHJpbW1lZCA9IHZhbHVlLnRyaW0oKTtcbiAgLy8gT2JzaWRpYW4gaGFuZHMgb3ZlciBkZWNvZGVkIHZhbHVlczsgdG9sZXJhdGUgb25lIHN1cnZpdmluZyByb3VuZCBvZlxuICAvLyBwZXJjZW50LWVuY29kaW5nIGZyb20gb3Zlci1lYWdlciBsaW5rIGdlbmVyYXRvcnMuXG4gIGlmICh0cmltbWVkLmluY2x1ZGVzKCclJykpIHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGRlY29kZVVSSUNvbXBvbmVudCh0cmltbWVkKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiB0cmltbWVkO1xuICAgIH1cbiAgfVxuICByZXR1cm4gdHJpbW1lZDtcbn1cblxuLyoqXG4gKiBSZWdpc3RlciB0aGUgcGFpciBkZWVwLWxpbmsgaGFuZGxlciAoY2FsbCBmcm9tIGBvbmxvYWRgIHdpdGggdGhlIHBsdWdpbidzXG4gKiBvd24gcmVnaXN0cmFyKS4gYG9uUGFpcmAgcnVucyB0aGUgc2hhcmVkIHBhaXIgZmxvdyAoc2V0dGluZ3MgKyBOb3RpY2VzXG4gKiBsaXZlIGluIHRoZSBwbHVnaW4pOyBpdHMgZXJyb3JzIGFyZSBsb2dnZWQsIG5ldmVyIGZhdGFsLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVnaXN0ZXJQYWlyUHJvdG9jb2xIYW5kbGVyKFxuICByZWdpc3RlcjogUHJvdG9jb2xSZWdpc3RyYXIsXG4gIG9uUGFpcjogKGxpbms6IFBhaXJEZWVwTGluaykgPT4gUHJvbWlzZTx2b2lkPixcbik6IHZvaWQge1xuICBjb25zdCBoYW5kbGVyOiBQcm90b2NvbEhhbmRsZXIgPSAocGFyYW1zKSA9PiB7XG4gICAgY29uc3QgcGFyc2VkID0gcGFyc2VQYWlyRGVlcExpbmsocGFyYW1zKTtcbiAgICBpZiAoIXBhcnNlZC5vaykge1xuICAgICAgLy8gTWlzc2luZyBib3RoIFx1MjE5MiBhIGJhcmUgb2JzaWRpYW46Ly92YXVsdHN5bmNmb3JhZ2VudHMgaGl0OyBzdGF5IHF1aWV0LlxuICAgICAgaWYgKHBhcnNlZC5lcnJvciAhPT0gJ25vIHBhaXJpbmcgcGFyYW1ldGVycycpIHtcbiAgICAgICAgbmV3IE5vdGljZShgVmF1bHRTeW5jIGRlZXAgbGluazogJHtwYXJzZWQuZXJyb3J9YCk7XG4gICAgICB9XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHZvaWQgb25QYWlyKHBhcnNlZC5saW5rKS5jYXRjaCgoZXJyb3I6IHVua25vd24pID0+IHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ1t2c2FdIGRlZXAtbGluayBwYWlyaW5nIGZhaWxlZCcsIGVycm9yKTtcbiAgICAgIG5ldyBOb3RpY2UoJ1ZhdWx0U3luYzogcGFpcmluZyB2aWEgbGluayBmYWlsZWQgXHUyMDE0IHNlZSB0aGUgY29uc29sZSBmb3IgZGV0YWlscy4nKTtcbiAgICB9KTtcbiAgfTtcbiAgcmVnaXN0ZXIoUFJPVE9DT0xfQUNUSU9OLCBoYW5kbGVyKTtcbiAgLy8gUmVnaXN0ZXIgdGhlIHBhdGgtc3BlbGxlZCBhY3Rpb24gdG9vIChidWlsZC1kZXBlbmRlbnQgbWF0Y2hpbmcpLlxuICByZWdpc3RlcihgJHtQUk9UT0NPTF9BQ1RJT059L3BhaXJgLCBoYW5kbGVyKTtcbn1cbiIsICIvKipcbiAqIFJlY29ubmVjdCBwb2xpY3kgKHBsdWdpbiBzY29wZSBpdGVtICM1KTogZXhwb25lbnRpYWwgYmFja29mZiB3aXRoIGppdHRlcixcbiAqIGNhcHBlZCBhdCA2MCBzLiBUaGUgcGx1Z2luJ3MgMSBzIHN1cGVydmlzaW9uIHRpY2sgYXNrcyB0aGUgc3VwZXJ2aXNvciB3aGF0XG4gKiB0byBkbyB3aGVuZXZlciB0aGUgY2xpZW50IHJlcG9ydHMgYGRpc2Nvbm5lY3RlZGA7IGEgc2NoZWR1bGVkIHJlY29ubmVjdCBpc1xuICogYSBzaW5nbGUgZmxpZ2h0IFx1MjAxNCBuZXZlciBhIHN0YWNrIG9mIHJldHJpZXMuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBTeW5jQ2xpZW50U3RhdGUgfSBmcm9tICdAdnNhL2NvcmUnO1xuXG5leHBvcnQgaW50ZXJmYWNlIEJhY2tvZmZPcHRpb25zIHtcbiAgLyoqIEZpcnN0IGF0dGVtcHQgZGVsYXkgKGRlZmF1bHQgMSBzKS4gKi9cbiAgYmFzZU1zPzogbnVtYmVyO1xuICAvKiogQ2VpbGluZyAoZGVmYXVsdCA2MCBzIHBlciB0aGUgcGx1Z2luIHNwZWMpLiAqL1xuICBjYXBNcz86IG51bWJlcjtcbiAgLyoqIEppdHRlciBmcmFjdGlvbiBhcm91bmQgdGhlIGV4cG9uZW50aWFsIHZhbHVlLCAwXHUyMDEzMC41IChkZWZhdWx0IDAuMykuICovXG4gIGppdHRlcj86IG51bWJlcjtcbiAgLyoqIEluamVjdGFibGUgcmFuZG9tbmVzcyAodGVzdHMpLiBEZWZhdWx0IGBNYXRoLnJhbmRvbWAuICovXG4gIHJhbmRvbT86ICgpID0+IG51bWJlcjtcbn1cblxuZXhwb3J0IGNvbnN0IERFRkFVTFRfUkVDT05ORUNUX0JBU0VfTVMgPSAxMDAwO1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfUkVDT05ORUNUX0NBUF9NUyA9IDYwXzAwMDtcblxuLyoqXG4gKiBEZWxheSBmb3IgYXR0ZW1wdCBOICgwLWJhc2VkKTogYG1pbihjYXAsIGJhc2UgXHUwMEI3IDJeYXR0ZW1wdClgIHdpdGggc3ltbWV0cmljXG4gKiBtdWx0aXBsaWNhdGl2ZSBqaXR0ZXIsIGZsb29yZWQgYXQgMjUwIG1zLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYmFja29mZkRlbGF5TXMoYXR0ZW1wdDogbnVtYmVyLCBvcHRpb25zOiBCYWNrb2ZmT3B0aW9ucyA9IHt9KTogbnVtYmVyIHtcbiAgY29uc3QgYmFzZSA9IG9wdGlvbnMuYmFzZU1zID8/IERFRkFVTFRfUkVDT05ORUNUX0JBU0VfTVM7XG4gIGNvbnN0IGNhcCA9IG9wdGlvbnMuY2FwTXMgPz8gREVGQVVMVF9SRUNPTk5FQ1RfQ0FQX01TO1xuICBjb25zdCBqaXR0ZXIgPSBvcHRpb25zLmppdHRlciA/PyAwLjM7XG4gIGNvbnN0IHJhbmRvbSA9IG9wdGlvbnMucmFuZG9tID8/IE1hdGgucmFuZG9tO1xuICBjb25zdCBleHBvbmVudGlhbCA9IE1hdGgubWluKGNhcCwgYmFzZSAqIDIgKiogYXR0ZW1wdCk7XG4gIGNvbnN0IGZhY3RvciA9IDEgKyAocmFuZG9tKCkgKiAyIC0gMSkgKiBqaXR0ZXI7XG4gIHJldHVybiBNYXRoLnJvdW5kKE1hdGgubWluKGNhcCwgTWF0aC5tYXgoMjUwLCBleHBvbmVudGlhbCAqIGZhY3RvcikpKTtcbn1cblxuZXhwb3J0IHR5cGUgUmVjb25uZWN0RGVjaXNpb24gPSB7IGFjdGlvbjogJ3JlY29ubmVjdCc7IGRlbGF5TXM6IG51bWJlciB9IHwgeyBhY3Rpb246ICd3YWl0JyB9O1xuXG4vKipcbiAqIFRyYWNrcyByZWNvbm5lY3QgYXR0ZW1wdHMgYWNyb3NzIHRoZSBzdXBlcnZpc2lvbiB0aWNrLiBOb24tZGlzY29ubmVjdGVkXG4gKiBzdGF0ZXMgcmVzZXQgdGhlIGJhY2tvZmYgbGFkZGVyIChhIHN1Y2Nlc3NmdWwgY3ljbGUgbWVhbnMgdGhlIG5ldHdvcmsgaXNcbiAqIGJhY2spOyBgc2NoZWR1bGVkYCBrZWVwcyBleGFjdGx5IG9uZSByZWNvbm5lY3QgaW4gZmxpZ2h0LlxuICovXG5leHBvcnQgY2xhc3MgUmVjb25uZWN0U3VwZXJ2aXNvciB7XG4gIHByaXZhdGUgYXR0ZW1wdCA9IDA7XG4gIHByaXZhdGUgc2NoZWR1bGVkID0gZmFsc2U7XG4gIHByaXZhdGUgcmVhZG9ubHkgb3B0aW9uczogQmFja29mZk9wdGlvbnM7XG5cbiAgY29uc3RydWN0b3Iob3B0aW9uczogQmFja29mZk9wdGlvbnMgPSB7fSkge1xuICAgIHRoaXMub3B0aW9ucyA9IG9wdGlvbnM7XG4gIH1cblxuICAvKiogQ2FsbCBlYWNoIHRpY2s7IG9uIGByZWNvbm5lY3RgLCBmb2xsb3cgdXAgd2l0aCBgYWNrbm93bGVkZ2VkKClgLiAqL1xuICBjb25zaWRlcihzdGF0ZTogU3luY0NsaWVudFN0YXRlKTogUmVjb25uZWN0RGVjaXNpb24ge1xuICAgIGlmIChzdGF0ZSAhPT0gJ2Rpc2Nvbm5lY3RlZCcpIHtcbiAgICAgIHRoaXMuYXR0ZW1wdCA9IDA7XG4gICAgICB0aGlzLnNjaGVkdWxlZCA9IGZhbHNlO1xuICAgICAgcmV0dXJuIHsgYWN0aW9uOiAnd2FpdCcgfTtcbiAgICB9XG4gICAgaWYgKHRoaXMuc2NoZWR1bGVkKSByZXR1cm4geyBhY3Rpb246ICd3YWl0JyB9O1xuICAgIHJldHVybiB7IGFjdGlvbjogJ3JlY29ubmVjdCcsIGRlbGF5TXM6IGJhY2tvZmZEZWxheU1zKHRoaXMuYXR0ZW1wdCwgdGhpcy5vcHRpb25zKSB9O1xuICB9XG5cbiAgLyoqIE1hcmsgdGhlIHJldHVybmVkIHJlY29ubmVjdCBhcyBpbiBmbGlnaHQgKG9uZSBhdCBhIHRpbWUpLiAqL1xuICBhY2tub3dsZWRnZWQoKTogdm9pZCB7XG4gICAgdGhpcy5hdHRlbXB0ICs9IDE7XG4gICAgdGhpcy5zY2hlZHVsZWQgPSB0cnVlO1xuICB9XG5cbiAgLyoqIFRoZSBpbi1mbGlnaHQgcmVjb25uZWN0IHNldHRsZWQgKHN1Y2Nlc3Mgb3IgZmFpbHVyZSkuICovXG4gIHNldHRsZWQoKTogdm9pZCB7XG4gICAgdGhpcy5zY2hlZHVsZWQgPSBmYWxzZTtcbiAgfVxuXG4gIC8qKiBDb21wbGV0ZWQgcmVjb25uZWN0IGF0dGVtcHRzIHNpbmNlIHRoZSBsYXN0IGhlYWx0aHkgc3RhdGUuICovXG4gIGdldCBhdHRlbXB0cygpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLmF0dGVtcHQ7XG4gIH1cbn1cbiIsICIvKipcbiAqIFRoZSBzZXR0aW5ncyB0YWIgKHBsdWdpbiBzY29wZSBpdGVtICM2KSwgb3JnYW5pemVkIGluIGZvdXIgc2VjdGlvbnM6XG4gKlxuICogICBDb25uZWN0aW9uIFx1MjAxNCB3b3JrZXIgVVJMLCBkZXZpY2UgbmFtZSAocGFpcmluZy10aW1lIE9SIHJlbmFtZSB3aGVuXG4gKiAgICAgICAgICAgICAgICBsaW5rZWQpLCBwYWlyaW5nIGZvcm0gLyBzdGF0dXMgcmVhZG91dCArIFN5bmMgbm93ICsgdW5saW5rXG4gKiAgIFN5bmMgICAgICAgXHUyMDE0IHJlc2NhbiBpbnRlcnZhbCwgLm9ic2lkaWFuLyB0b2dnbGUsIHBhdXNlL3Jlc3VtZSxcbiAqICAgICAgICAgICAgICAgIHN5bmMtb24tc3RhcnR1cFxuICogICBBZHZhbmNlZCAgIFx1MjAxNCBzdGF0dXMtYmFyIGluZGljYXRvciBtb2RlLCBpZ25vcmUgcGF0dGVybnMsIGRpYWdub3N0aWNzXG4gKiAgICAgICAgICAgICAgICAobG9nIGxldmVsICsgQ29weSBkaWFnbm9zdGljcyArIFNhdmUgc3VwcG9ydCBidW5kbGUpXG4gKiAgIEFib3V0ICAgICAgXHUyMDE0IHZlcnNpb25zLCBzdG9yYWdlIHVzYWdlLCBwcm9qZWN0IFJFQURNRSBsaW5rXG4gKlxuICogQWxsIGxvZ2ljIGxpdmVzIG9uIGBWYXVsdFN5bmNQbHVnaW5gOyB0aGUgdGFiIGlzIHByZXNlbnRhdGlvbiBwbHVzIHdpcmluZy5cbiAqL1xuXG5pbXBvcnQgeyBNb2RhbCwgTm90aWNlLCBQbHVnaW5TZXR0aW5nVGFiLCBTZXR0aW5nIH0gZnJvbSAnb2JzaWRpYW4nO1xuaW1wb3J0IHR5cGUgeyBBcHAgfSBmcm9tICdvYnNpZGlhbic7XG5pbXBvcnQge1xuICBkZWZhdWx0RGV2aWNlTmFtZSxcbiAgUkVTQ0FOX0lOVEVSVkFMX0NIT0lDRVMsXG4gIHR5cGUgTG9nTGV2ZWwsXG4gIHR5cGUgVmF1bHRTeW5jUGx1Z2luRGF0YSxcbn0gZnJvbSAnLi9kYXRhLmpzJztcbmltcG9ydCB0eXBlIHsgUGFpck91dGNvbWUgfSBmcm9tICcuL3BhaXJpbmcuanMnO1xuaW1wb3J0IHsgcGFpck91dGNvbWVNZXNzYWdlIH0gZnJvbSAnLi9wYWlyaW5nLmpzJztcbmltcG9ydCB7IGZvcm1hdEJ5dGVzLCBQUk9UT0NPTF9WRVJTSU9OIH0gZnJvbSAnLi9kaWFnbm9zdGljcy5qcyc7XG5pbXBvcnQgeyBmb3JtYXRTaW5jZSB9IGZyb20gJy4vc3RhdHVzYmFyLmpzJztcbmltcG9ydCB0eXBlIHsgVmF1bHRTeW5jUGx1Z2luIH0gZnJvbSAnLi9wbHVnaW4uanMnO1xuXG4vKipcbiAqIENsb3VkZmxhcmUgRGVwbG95IEJ1dHRvbiB0YXJnZXQgKEZSLTIxKTogcHJvdmlzaW9ucyBhIHByZWNvbmZpZ3VyZWQgd29ya2VyXG4gKiArIER1cmFibGUgT2JqZWN0ICsgUjIgYnVja2V0IGluIHRoZSB1c2VyJ3Mgb3duIGFjY291bnQgXHUyMDE0IG5vIHdyYW5nbGVyLCBub1xuICogbWFudWFsIGNvbmZpZy4gVGhlIHRlbXBsYXRlIHJlcG8gcGlucyBhIHJlbGVhc2VkIHdvcmtlciB2ZXJzaW9uLlxuICovXG5leHBvcnQgY29uc3QgREVQTE9ZX1VSTCA9XG4gICdodHRwczovL2RlcGxveS53b3JrZXJzLmNsb3VkZmxhcmUuY29tLz91cmw9JyArXG4gICdodHRwczovL2dpdGh1Yi5jb20vYW51Y2hpbi92YXVsdHN5bmNmb3JhZ2VudHMtdGVtcGxhdGUnO1xuXG4vKiogVGhlIHByb2plY3QgUkVBRE1FICh0aGUgQWJvdXQgc2VjdGlvbidzIGxpbmspLiAqL1xuZXhwb3J0IGNvbnN0IFBST0pFQ1RfUkVBRE1FX1VSTCA9ICdodHRwczovL2dpdGh1Yi5jb20vYW51Y2hpbi92YXVsdHN5bmNmb3JhZ2VudHMjcmVhZG1lJztcblxuLyoqIE9wZW4gdGhlIGRlcGxveSBwYWdlIGluIHRoZSBzeXN0ZW0gYnJvd3NlciAobm8tb3Agd2hlcmUgYHdpbmRvd2AgaXMgYWJzZW50KS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBvcGVuRGVwbG95UGFnZSgpOiB2b2lkIHtcbiAgaWYgKHR5cGVvZiB3aW5kb3cgPT09ICd1bmRlZmluZWQnKSByZXR1cm47XG4gIHdpbmRvdy5vcGVuKERFUExPWV9VUkwsICdfYmxhbmsnKTtcbn1cblxuLyoqIE9wZW4gdGhlIHByb2plY3QgUkVBRE1FIGluIHRoZSBzeXN0ZW0gYnJvd3NlciAobm8tb3Agd2l0aG91dCBgd2luZG93YCkuICovXG5leHBvcnQgZnVuY3Rpb24gb3BlblJlYWRtZVBhZ2UoKTogdm9pZCB7XG4gIGlmICh0eXBlb2Ygd2luZG93ID09PSAndW5kZWZpbmVkJykgcmV0dXJuO1xuICB3aW5kb3cub3BlbihQUk9KRUNUX1JFQURNRV9VUkwsICdfYmxhbmsnKTtcbn1cblxuLyoqIFNtYWxsIGNvbmZpcm1hdGlvbiBkaWFsb2cgKHRoZSB1bmxpbmsgYnV0dG9uJ3Mgc2FmZXR5IG5ldCkuICovXG5leHBvcnQgY2xhc3MgQ29uZmlybU1vZGFsIGV4dGVuZHMgTW9kYWwge1xuICBjb25zdHJ1Y3RvcihcbiAgICBhcHA6IEFwcCxcbiAgICBwcml2YXRlIHJlYWRvbmx5IG9wdGlvbnM6IHtcbiAgICAgIHRpdGxlOiBzdHJpbmc7XG4gICAgICBib2R5OiBzdHJpbmc7XG4gICAgICBjb25maXJtVGV4dDogc3RyaW5nO1xuICAgICAgb25Db25maXJtOiAoKSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPjtcbiAgICB9LFxuICApIHtcbiAgICBzdXBlcihhcHApO1xuICB9XG5cbiAgb3ZlcnJpZGUgb25PcGVuKCk6IHZvaWQge1xuICAgIG5ldyBTZXR0aW5nKHRoaXMuY29udGVudEVsKS5zZXROYW1lKHRoaXMub3B0aW9ucy50aXRsZSkuc2V0RGVzYyh0aGlzLm9wdGlvbnMuYm9keSk7XG4gICAgbmV3IFNldHRpbmcodGhpcy5jb250ZW50RWwpLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoJ0NhbmNlbCcpLm9uQ2xpY2soKCkgPT4gdGhpcy5jbG9zZSgpKSxcbiAgICApO1xuICAgIG5ldyBTZXR0aW5nKHRoaXMuY29udGVudEVsKS5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgIGJ1dHRvblxuICAgICAgICAuc2V0Q3RhKClcbiAgICAgICAgLnNldEJ1dHRvblRleHQodGhpcy5vcHRpb25zLmNvbmZpcm1UZXh0KVxuICAgICAgICAub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgdGhpcy5jbG9zZSgpO1xuICAgICAgICAgIGF3YWl0IHRoaXMub3B0aW9ucy5vbkNvbmZpcm0oKTtcbiAgICAgICAgfSksXG4gICAgKTtcbiAgfVxufVxuXG5leHBvcnQgY2xhc3MgVmF1bHRTeW5jU2V0dGluZ1RhYiBleHRlbmRzIFBsdWdpblNldHRpbmdUYWIge1xuICBwcml2YXRlIHJlYWRvbmx5IHBsdWdpbjogVmF1bHRTeW5jUGx1Z2luO1xuICAvKiogUGFpcmluZyBjb2RlcyBuZXZlciB0b3VjaCBkaXNrIFx1MjAxNCB0aGV5IGFyZSBvbmUtdGltZSwgc2hvcnQtbGl2ZWQgc2VjcmV0cy4gKi9cbiAgcHJpdmF0ZSBwYWlyaW5nQ29kZSA9ICcnO1xuICAvKipcbiAgICogTGlua2VkLW1vZGUgZGV2aWNlLW5hbWUgZHJhZnQ6IGVkaXRzIHN0YWdlIGhlcmUgKE5PVCBpbiBwbHVnaW4gZGF0YSkgc28gYVxuICAgKiBmYWlsZWQgcmVuYW1lIGNhbm5vdCBsZWF2ZSB0aGUgbG9jYWwgbmFtZSBvdXQgb2Ygc3luYyB3aXRoIHRoZSB3b3JrZXIuXG4gICAqL1xuICBwcml2YXRlIHJlbmFtZURyYWZ0OiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBoaW50U2V0dGluZzogU2V0dGluZyB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHN0YXR1c1NldHRpbmc6IFNldHRpbmcgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBzdG9yYWdlU2V0dGluZzogU2V0dGluZyB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHNlcnZlclZlcnNpb25TZXR0aW5nOiBTZXR0aW5nIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgcmVmcmVzaEhhbmRsZTogUmV0dXJuVHlwZTx0eXBlb2Ygc2V0SW50ZXJ2YWw+IHwgbnVsbCA9IG51bGw7XG5cbiAgY29uc3RydWN0b3IoYXBwOiBBcHAsIHBsdWdpbjogVmF1bHRTeW5jUGx1Z2luKSB7XG4gICAgc3VwZXIoYXBwLCBwbHVnaW4pO1xuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xuICB9XG5cbiAgb3ZlcnJpZGUgZGlzcGxheSgpOiB2b2lkIHtcbiAgICB0aGlzLnN0b3BSZWZyZXNoKCk7XG4gICAgY29uc3QgeyBjb250YWluZXJFbCB9ID0gdGhpcztcbiAgICBjb250YWluZXJFbC5lbXB0eSgpO1xuICAgIHRoaXMuaGludFNldHRpbmcgPSBudWxsO1xuICAgIHRoaXMuc3RhdHVzU2V0dGluZyA9IG51bGw7XG4gICAgdGhpcy5zdG9yYWdlU2V0dGluZyA9IG51bGw7XG4gICAgdGhpcy5zZXJ2ZXJWZXJzaW9uU2V0dGluZyA9IG51bGw7XG4gICAgdGhpcy5yZW5hbWVEcmFmdCA9IG51bGw7XG5cbiAgICB0aGlzLnJlbmRlckNvbm5lY3Rpb25TZWN0aW9uKCk7XG4gICAgdGhpcy5yZW5kZXJTeW5jU2VjdGlvbigpO1xuICAgIHRoaXMucmVuZGVyQWR2YW5jZWRTZWN0aW9uKCk7XG4gICAgdGhpcy5yZW5kZXJBYm91dFNlY3Rpb24oKTtcbiAgICB0aGlzLnN0YXJ0UmVmcmVzaCgpO1xuICB9XG5cbiAgb3ZlcnJpZGUgaGlkZSgpOiB2b2lkIHtcbiAgICB0aGlzLnN0b3BSZWZyZXNoKCk7XG4gIH1cblxuICAvLyAtLS0gc2VjdGlvbnMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICBwcml2YXRlIGhlYWRpbmcodGV4dDogc3RyaW5nKTogdm9pZCB7XG4gICAgbmV3IFNldHRpbmcodGhpcy5jb250YWluZXJFbCkuc2V0TmFtZSh0ZXh0KS5zZXRIZWFkaW5nKCk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlckNvbm5lY3Rpb25TZWN0aW9uKCk6IHZvaWQge1xuICAgIGNvbnN0IHsgY29udGFpbmVyRWwgfSA9IHRoaXM7XG4gICAgdGhpcy5oZWFkaW5nKCdDb25uZWN0aW9uJyk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdXb3JrZXIgVVJMJylcbiAgICAgIC5zZXREZXNjKFxuICAgICAgICAnWW91ciBzeW5jIHdvcmtlciwgZS5nLiBodHRwczovL3BlcnNvbmFsLngud29ya2Vycy5kZXYuIE5vIHdvcmtlciB5ZXQ/IFVzZSBcIkRlcGxveSB5b3VyIHdvcmtlclwiIGJlbG93LCBvcGVuIHRoZSBVUkwgaW4gYSBicm93c2VyLCBhbmQgY2xhaW0gaXQuJyxcbiAgICAgIClcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PlxuICAgICAgICB0ZXh0XG4gICAgICAgICAgLnNldFBsYWNlaG9sZGVyKCdodHRwczovL3BlcnNvbmFsLngud29ya2Vycy5kZXYnKVxuICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5kYXRhLnVybClcbiAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnBsdWdpbi5kYXRhLnVybCA9IHZhbHVlLnRyaW0oKTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVQbHVnaW5EYXRhKCk7XG4gICAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgaWYgKHRoaXMucGx1Z2luLmxpbmtlZCkge1xuICAgICAgdGhpcy5yZW5kZXJMaW5rZWREZXZpY2VOYW1lKCk7XG4gICAgICB0aGlzLnJlbmRlckxpbmtlZFN0YXR1cygpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnJlbmRlclBhaXJpbmdEZXZpY2VOYW1lKCk7XG4gICAgICB0aGlzLnJlbmRlclBhaXJpbmdTZWN0aW9uKCk7XG4gICAgfVxuICB9XG5cbiAgLyoqIFVubGlua2VkOiB0aGUgbmFtZSBpcyBhIHBhaXJpbmctdGltZSBkZWZhdWx0IChhcHBsaWVzIGF0IG5leHQgcGFpcikuICovXG4gIHByaXZhdGUgcmVuZGVyUGFpcmluZ0RldmljZU5hbWUoKTogdm9pZCB7XG4gICAgbmV3IFNldHRpbmcodGhpcy5jb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdEZXZpY2UgbmFtZScpXG4gICAgICAuc2V0RGVzYyhgU2hvd24gaW4gdGhlIHdvcmtlciBkYXNoYm9hcmQncyBkZXZpY2UgbGlzdC4gQXBwbGllcyB3aGVuIChyZSlwYWlyaW5nLmApXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT5cbiAgICAgICAgdGV4dFxuICAgICAgICAgIC5zZXRQbGFjZWhvbGRlcihkZWZhdWx0RGV2aWNlTmFtZSgpKVxuICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5kYXRhLmRldmljZU5hbWUpXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4uZGF0YS5kZXZpY2VOYW1lID0gdmFsdWUudHJpbSgpO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVBsdWdpbkRhdGEoKTtcbiAgICAgICAgICB9KSxcbiAgICAgICk7XG4gIH1cblxuICAvKiogTGlua2VkOiB0aGUgZmllbGQgc2hvd3MgdGhlIGN1cnJlbnQgbmFtZTsgUmVuYW1lIHB1c2hlcyBpdCB0byB0aGUgd29ya2VyLiAqL1xuICBwcml2YXRlIHJlbmRlckxpbmtlZERldmljZU5hbWUoKTogdm9pZCB7XG4gICAgY29uc3QgY3VycmVudCA9IHRoaXMucmVuYW1lRHJhZnQgPz8gdGhpcy5wbHVnaW4uZGF0YS5kZXZpY2VOYW1lO1xuICAgIG5ldyBTZXR0aW5nKHRoaXMuY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnRGV2aWNlIG5hbWUnKVxuICAgICAgLnNldERlc2MoXG4gICAgICAgICdUaGUgd29ya2VyIGRhc2hib2FyZCBzaG93cyB0aGlzIG5hbWUuIEVkaXQgaXQgYW5kIHByZXNzIFwiUmVuYW1lIGRldmljZVwiIHRvIHVwZGF0ZSB0aGlzIGRldmljZSBvbiB0aGUgd29ya2VyICgxLTMwIGNoYXJhY3RlcnMpLicsXG4gICAgICApXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT5cbiAgICAgICAgdGV4dFxuICAgICAgICAgIC5zZXRQbGFjZWhvbGRlcihkZWZhdWx0RGV2aWNlTmFtZSgpKVxuICAgICAgICAgIC5zZXRWYWx1ZShjdXJyZW50KVxuICAgICAgICAgIC5vbkNoYW5nZSgodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMucmVuYW1lRHJhZnQgPSB2YWx1ZTtcbiAgICAgICAgICB9KSxcbiAgICAgIClcbiAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoJ1JlbmFtZSBkZXZpY2UnKS5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICBidXR0b24uc2V0RGlzYWJsZWQodHJ1ZSk7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IG9rID0gYXdhaXQgdGhpcy5wbHVnaW4ucmVuYW1lRGV2aWNlKHRoaXMucmVuYW1lRHJhZnQgPz8gdGhpcy5wbHVnaW4uZGF0YS5kZXZpY2VOYW1lKTtcbiAgICAgICAgICAgIGlmIChvaykgdGhpcy5kaXNwbGF5KCk7IC8vIHJlLXJlbmRlciB3aXRoIHRoZSBwZXJzaXN0ZWQgbmFtZVxuICAgICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICBidXR0b24uc2V0RGlzYWJsZWQoZmFsc2UpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSksXG4gICAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJQYWlyaW5nU2VjdGlvbigpOiB2b2lkIHtcbiAgICBjb25zdCB7IGNvbnRhaW5lckVsIH0gPSB0aGlzO1xuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ1BhaXJpbmcgY29kZScpXG4gICAgICAuc2V0RGVzYygnRnJvbSB5b3VyIHdvcmtlciBkYXNoYm9hcmQ6IERldmljZXMgXHUyMTkyIFBhaXIgbmV3IGRldmljZS4gQ29kZXMgYXJlIG9uZS10aW1lIGFuZCBleHBpcmUgYWZ0ZXIgMTAgbWludXRlcy4nKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHRcbiAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoJzdGM0stUTlNMicpXG4gICAgICAgICAgLm9uQ2hhbmdlKCh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5wYWlyaW5nQ29kZSA9IHZhbHVlLnRyaW0oKTtcbiAgICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbCkuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICBidXR0b25cbiAgICAgICAgLnNldEN0YSgpXG4gICAgICAgIC5zZXRCdXR0b25UZXh0KCdQYWlyIHRoaXMgdmF1bHQnKVxuICAgICAgICAub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgYnV0dG9uLnNldERpc2FibGVkKHRydWUpO1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBvdXRjb21lID0gYXdhaXQgdGhpcy5wbHVnaW4ucGFpckZyb21TZXR0aW5ncyh0aGlzLnBhaXJpbmdDb2RlKTtcbiAgICAgICAgICAgIHRoaXMuc2hvd091dGNvbWUob3V0Y29tZSk7XG4gICAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICAgIGJ1dHRvbi5zZXREaXNhYmxlZChmYWxzZSk7XG4gICAgICAgICAgfVxuICAgICAgICB9KSxcbiAgICApO1xuXG4gICAgdGhpcy5oaW50U2V0dGluZyA9IG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ0dldHRpbmcgc3RhcnRlZCcpXG4gICAgICAuc2V0Q2xhc3MoJ3ZzYS1zZXR0aW5ncy1oaW50JylcbiAgICAgIC5zZXREZXNjKFxuICAgICAgICBbXG4gICAgICAgICAgJzEuIERlcGxveSB5b3VyIG93biB3b3JrZXIgd2l0aCB0aGUgYnV0dG9uIGJlbG93ICh5b3VyIENsb3VkZmxhcmUgYWNjb3VudCwgcHJlY29uZmlndXJlZCBcdTIwMTQgbm8gd3JhbmdsZXIpLicsXG4gICAgICAgICAgJzIuIE9wZW4gdGhlIHdvcmtlciBVUkwgaW4gYSBicm93c2VyIGFuZCBzZXQgdGhlIGFkbWluIHBhc3NwaHJhc2UgKGNsYWltKS4nLFxuICAgICAgICAgICczLiBDcmVhdGUgYSBwYWlyaW5nIGNvZGUgb24gdGhlIGRhc2hib2FyZCwgcGFzdGUgaXQgYWJvdmUsIGFuZCBwYWlyLicsXG4gICAgICAgICAgJ09uIGEgcGhvbmUsIHNjYW5uaW5nIHRoZSBkYXNoYm9hcmQgUVIgb3IgdGFwcGluZyBpdHMgb2JzaWRpYW46Ly8gbGluayBwYWlycyB3aXRob3V0IHR5cGluZy4nLFxuICAgICAgICBdLmpvaW4oJ1xcbicpLFxuICAgICAgKVxuICAgICAgLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgICBidXR0b24uc2V0QnV0dG9uVGV4dCgnRGVwbG95IHlvdXIgd29ya2VyJykub25DbGljaygoKSA9PiBvcGVuRGVwbG95UGFnZSgpKSxcbiAgICAgICk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlckxpbmtlZFN0YXR1cygpOiB2b2lkIHtcbiAgICBjb25zdCB7IGNvbnRhaW5lckVsIH0gPSB0aGlzO1xuXG4gICAgdGhpcy5zdGF0dXNTZXR0aW5nID0gbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnU3RhdHVzJylcbiAgICAgIC5zZXRDbGFzcygndnNhLXN0YXR1cy1yZWFkb3V0JylcbiAgICAgIC5zZXREZXNjKHRoaXMuc3RhdHVzVGV4dCgpKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKS5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KCdTeW5jIG5vdycpLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICBidXR0b24uc2V0RGlzYWJsZWQodHJ1ZSk7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc3luY05vdygpO1xuICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgIGJ1dHRvbi5zZXREaXNhYmxlZChmYWxzZSk7XG4gICAgICAgICAgdGhpcy5yZWZyZXNoU3RhdHVzKCk7XG4gICAgICAgIH1cbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbCkuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICBidXR0b24uc2V0QnV0dG9uVGV4dCgnVW5saW5rIHRoaXMgdmF1bHQnKS5vbkNsaWNrKCgpID0+IHtcbiAgICAgICAgbmV3IENvbmZpcm1Nb2RhbCh0aGlzLmFwcCwge1xuICAgICAgICAgIHRpdGxlOiAnVW5saW5rIFZhdWx0U3luYz8nLFxuICAgICAgICAgIGJvZHk6ICdUaGlzIHN0b3BzIHN5bmNpbmcgYW5kIGNsZWFycyB0aGlzIGRldmljZVxcdTIwMTlzIGxvY2FsIHN5bmMgc3RhdGUuIEZpbGVzIGFscmVhZHkgaW4gdGhlIHZhdWx0IGFyZSB1bnRvdWNoZWQuIFRoZSB3b3JrZXIga2VlcHMgdGhpcyBkZXZpY2UgaW4gaXRzIHJlZ2lzdHJ5IFxcdTIwMTQgcmV2b2tlIGl0IGZyb20gdGhlIGRhc2hib2FyZCBpZiB5b3UgYXJlIGRvbmUgd2l0aCBpdC4nLFxuICAgICAgICAgIGNvbmZpcm1UZXh0OiAnVW5saW5rJyxcbiAgICAgICAgICBvbkNvbmZpcm06IGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnVubGluaygpO1xuICAgICAgICAgICAgdGhpcy5kaXNwbGF5KCk7XG4gICAgICAgICAgfSxcbiAgICAgICAgfSkub3BlbigpO1xuICAgICAgfSksXG4gICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyU3luY1NlY3Rpb24oKTogdm9pZCB7XG4gICAgY29uc3QgeyBjb250YWluZXJFbCB9ID0gdGhpcztcbiAgICBjb25zdCBkYXRhID0gdGhpcy5wbHVnaW4uZGF0YTtcbiAgICB0aGlzLmhlYWRpbmcoJ1N5bmMnKTtcblxuICAgIGlmICh0aGlzLnBsdWdpbi5saW5rZWQpIHtcbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZSgnUmVzY2FuIGludGVydmFsJylcbiAgICAgICAgLnNldERlc2MoXG4gICAgICAgICAgJ1BlcmlvZGljIGZ1bGwgcmVjb25jaWxpYXRpb24gXHUyMDE0IGNhdGNoZXMgZXh0ZXJuYWwgZWRpdHMgd2hpbGUgT2JzaWRpYW4gaXMgb3BlbiBhbmQgY292ZXJzIG1vYmlsZSBiYWNrZ3JvdW5kIGxpbWl0cy4gVmF1bHQgZXZlbnRzIGFuZCBhcHAtb3BlbiBzeW5jIGFsd2F5cyBydW4uJyxcbiAgICAgICAgKVxuICAgICAgICAuYWRkRHJvcGRvd24oKGRyb3Bkb3duKSA9PiB7XG4gICAgICAgICAgZm9yIChjb25zdCBjaG9pY2Ugb2YgUkVTQ0FOX0lOVEVSVkFMX0NIT0lDRVMpIHtcbiAgICAgICAgICAgIGRyb3Bkb3duLmFkZE9wdGlvbihTdHJpbmcoY2hvaWNlLnZhbHVlKSwgY2hvaWNlLmxhYmVsKTtcbiAgICAgICAgICB9XG4gICAgICAgICAgZHJvcGRvd24uc2V0VmFsdWUoU3RyaW5nKGRhdGEuc2V0dGluZ3MucmVzY2FuSW50ZXJ2YWxTZWMpKTtcbiAgICAgICAgICBkcm9wZG93bi5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLmFwcGx5UmVzY2FuSW50ZXJ2YWwoTnVtYmVyKHZhbHVlKSk7XG4gICAgICAgICAgfSk7XG4gICAgICAgIH0pO1xuXG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUoJ1N5bmMgLm9ic2lkaWFuLyBmb2xkZXInKVxuICAgICAgICAuc2V0RGVzYyhcbiAgICAgICAgICAnT3B0IGluIHRvIHN5bmNpbmcgLm9ic2lkaWFuLyAoc2V0dGluZ3MgYW5kIHBsdWdpbnMpLCBleGNsdWRpbmcgd29ya3NwYWNlLmpzb24gYW5kIGNhY2hlcy4gJyArXG4gICAgICAgICAgICAnVGhlIHdvcmtlclxcdTIwMTlzIHBlci12YXVsdCBzZXR0aW5nIHRha2VzIHByZWNlZGVuY2Ugb25jZSBjb25uZWN0ZWQuJyxcbiAgICAgICAgKVxuICAgICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgICAgdG9nZ2xlLnNldFZhbHVlKGRhdGEuc2V0dGluZ3Mub2JzaWRpYW5TeW5jKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLmFwcGx5T2JzaWRpYW5TeW5jKHZhbHVlKTtcbiAgICAgICAgICB9KSxcbiAgICAgICAgKTtcblxuICAgICAgY29uc3QgcGF1c2VkID0gdGhpcy5wbHVnaW4uc3luY2luZ1BhdXNlZDtcbiAgICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgICAuc2V0TmFtZShwYXVzZWQgPyAnU3luY2luZyBwYXVzZWQnIDogJ1BhdXNlIHN5bmNpbmcnKVxuICAgICAgICAuc2V0RGVzYyhcbiAgICAgICAgICBwYXVzZWRcbiAgICAgICAgICAgID8gJ1N5bmNpbmcgaXMgcGF1c2VkOiB0aGUgY29ubmVjdGlvbiBpcyBkb3duIGFuZCB2YXVsdCBjaGFuZ2VzIHN0YXkgbG9jYWwuIFJlc3VtZSByZWNvbm5lY3RzIGFuZCBydW5zIGEgZnVsbCBjYXRjaC11cCBzeW5jLidcbiAgICAgICAgICAgIDogJ1RlbXBvcmFyaWx5IHN0b3Agc3luY2luZyB3aXRob3V0IHVubGlua2luZyBcdTIwMTQgdGhlIHRyYW5zcG9ydCBkaXNjb25uZWN0cyBhbmQgdGhlIHdhdGNoZXIgZ29lcyBpZGxlLiBZb3VyIGxpbmsgYW5kIGxvY2FsIHN0YXRlIGFyZSBrZXB0LicsXG4gICAgICAgIClcbiAgICAgICAgLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgICAgIGJ1dHRvblxuICAgICAgICAgICAgLnNldEJ1dHRvblRleHQocGF1c2VkID8gJ1Jlc3VtZSBzeW5jaW5nJyA6ICdQYXVzZSBzeW5jaW5nJylcbiAgICAgICAgICAgIC5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgICAgYnV0dG9uLnNldERpc2FibGVkKHRydWUpO1xuICAgICAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgICAgIGlmIChwYXVzZWQpIGF3YWl0IHRoaXMucGx1Z2luLnJlc3VtZVN5bmNpbmcoKTtcbiAgICAgICAgICAgICAgICBlbHNlIHRoaXMucGx1Z2luLnBhdXNlU3luY2luZygpO1xuICAgICAgICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgICAgICAgIHRoaXMuZGlzcGxheSgpOyAvLyByZS1yZW5kZXI6IHRoZSBidXR0b24gKGFuZCBsYWJlbCkgZmxpcFxuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9KSxcbiAgICAgICAgKTtcbiAgICB9XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdTeW5jIG9uIHN0YXJ0dXAnKVxuICAgICAgLnNldERlc2MoXG4gICAgICAgICdPTiAoZGVmYXVsdCk6IHN5bmMgc3RhcnRzIGFzIHNvb24gYXMgT2JzaWRpYW4gb3BlbnMuIE9GRjogdGhlIHBsdWdpbiBsb2FkcyBpZGxlIGFuZCB0aGUgZmlyc3QgXCJTeW5jIG5vd1wiIHByZXNzIHN0YXJ0cyBzeW5jaW5nIChtYW51YWwtb25seSBtb2RlKS4nLFxuICAgICAgKVxuICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICB0b2dnbGUuc2V0VmFsdWUoZGF0YS5zZXR0aW5ncy5zeW5jT25TdGFydHVwKS5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5hcHBseVN5bmNPblN0YXJ0dXAodmFsdWUpO1xuICAgICAgICB9KSxcbiAgICAgICk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlckFkdmFuY2VkU2VjdGlvbigpOiB2b2lkIHtcbiAgICBjb25zdCB7IGNvbnRhaW5lckVsIH0gPSB0aGlzO1xuICAgIGNvbnN0IGRhdGEgPSB0aGlzLnBsdWdpbi5kYXRhO1xuICAgIHRoaXMuaGVhZGluZygnQWR2YW5jZWQnKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ1N0YXR1cyBiYXIgaW5kaWNhdG9yJylcbiAgICAgIC5zZXREZXNjKFxuICAgICAgICAnRGV0YWlsZWQ6IFwidnNhIFx1MjcxMyAxMnNcIiB3aXRoIHN0YXRlIGFuZCBhZ2UuIENvbXBhY3Q6IGp1c3QgdGhlIHN5bWJvbC4gSGlkZGVuOiBubyBzdGF0dXMgYmFyIGl0ZW0gYXQgYWxsLicsXG4gICAgICApXG4gICAgICAuYWRkRHJvcGRvd24oKGRyb3Bkb3duKSA9PiB7XG4gICAgICAgIGRyb3Bkb3duLmFkZE9wdGlvbignZGV0YWlsZWQnLCAnRGV0YWlsZWQnKTtcbiAgICAgICAgZHJvcGRvd24uYWRkT3B0aW9uKCdjb21wYWN0JywgJ0NvbXBhY3QnKTtcbiAgICAgICAgZHJvcGRvd24uYWRkT3B0aW9uKCdoaWRkZW4nLCAnSGlkZGVuJyk7XG4gICAgICAgIGRyb3Bkb3duLnNldFZhbHVlKGRhdGEuc2V0dGluZ3Muc3RhdHVzQmFyTW9kZSk7XG4gICAgICAgIGRyb3Bkb3duLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLmFwcGx5U3RhdHVzQmFyTW9kZShcbiAgICAgICAgICAgIHZhbHVlID09PSAnY29tcGFjdCcgfHwgdmFsdWUgPT09ICdoaWRkZW4nID8gdmFsdWUgOiAnZGV0YWlsZWQnLFxuICAgICAgICAgICk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdJZ25vcmUgcGF0dGVybnMnKVxuICAgICAgLnNldERlc2MoXG4gICAgICAgICdPbmUgcGF0dGVybiBwZXIgbGluZSwgZS5nLiBwcml2YXRlLyoqIG9yICoudG1wLiBHbG9iLWxpdGU6ICogbWF0Y2hlcyB3aXRoaW4gb25lIGZvbGRlciBuYW1lLCAqKiBzcGFucyBmb2xkZXJzIChkaXIvKiogc2tpcHMgdGhlIGZvbGRlciBhbmQgZXZlcnl0aGluZyBpbiBpdCk7IGEgcGF0dGVybiB3aXRob3V0IC8gbWF0Y2hlcyBmaWxlIG5hbWVzIGF0IGFueSBkZXB0aC4gQ2FzZS1pbnNlbnNpdGl2ZTsgYXBwbGllcyBvbiB0aGlzIGRldmljZSBvbmx5OyBzYXZpbmcgcmVjb25uZWN0cyBzeW5jIHRvIGFwcGx5IHRoZW0uJyxcbiAgICAgIClcbiAgICAgIC5hZGRUZXh0QXJlYSgoYXJlYSkgPT5cbiAgICAgICAgYXJlYVxuICAgICAgICAgIC5zZXRQbGFjZWhvbGRlcigncHJpdmF0ZS8qKlxcbioudG1wJylcbiAgICAgICAgICAuc2V0VmFsdWUoZGF0YS5zZXR0aW5ncy5pZ25vcmVQYXR0ZXJucylcbiAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5hcHBseUlnbm9yZVBhdHRlcm5zKHZhbHVlKTtcbiAgICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdEaWFnbm9zdGljcyBsb2cgbGV2ZWwnKVxuICAgICAgLnNldERlc2MoXG4gICAgICAgICdpbmZvIChkZWZhdWx0KSByZWNvcmRzIGxpZmVjeWNsZSBldmVudHM7IGRlYnVnIGFkZGl0aW9uYWxseSBsb2dzIHByb3RvY29sIHJvdW5kLXRyaXBzIChvbmUgc2hvcnQgbGluZSBwZXIgZnJhbWUpOyB3YXJuIGtlZXBzIG9ubHkgd2FybmluZ3MgYW5kIGVycm9ycy4nLFxuICAgICAgKVxuICAgICAgLmFkZERyb3Bkb3duKChkcm9wZG93bikgPT4ge1xuICAgICAgICBkcm9wZG93bi5hZGRPcHRpb24oJ2luZm8nLCAnaW5mbycpO1xuICAgICAgICBkcm9wZG93bi5hZGRPcHRpb24oJ2RlYnVnJywgJ2RlYnVnJyk7XG4gICAgICAgIGRyb3Bkb3duLmFkZE9wdGlvbignd2FybicsICd3YXJuJyk7XG4gICAgICAgIGRyb3Bkb3duLnNldFZhbHVlKGRhdGEuc2V0dGluZ3MubG9nTGV2ZWwpO1xuICAgICAgICBkcm9wZG93bi5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICBjb25zdCBsZXZlbDogTG9nTGV2ZWwgPSB2YWx1ZSA9PT0gJ2RlYnVnJyB8fCB2YWx1ZSA9PT0gJ3dhcm4nID8gdmFsdWUgOiAnaW5mbyc7XG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uYXBwbHlMb2dMZXZlbChsZXZlbCk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdDb3B5IGRpYWdub3N0aWNzJylcbiAgICAgIC5zZXREZXNjKFxuICAgICAgICAnQ29waWVzIGEgYnVnLXJlcG9ydCBidW5kbGU6IHBsdWdpbiArIHByb3RvY29sIHZlcnNpb25zLCBkZXZpY2UsIHdvcmtlciBVUkwsIHBhaXJpbmcgc3RhdGUsIGEgc3RhdHVzIHNuYXBzaG90LCB0aGUgcGxhdGZvcm0sIGFuZCB0aGUgbGFzdCAyMCBsb2cgbGluZXMuJyxcbiAgICAgIClcbiAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoJ0NvcHkgZGlhZ25vc3RpY3MnKS5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICBidXR0b24uc2V0RGlzYWJsZWQodHJ1ZSk7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLmNvcHlEaWFnbm9zdGljcygpO1xuICAgICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICBidXR0b24uc2V0RGlzYWJsZWQoZmFsc2UpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnU2F2ZSBzdXBwb3J0IGJ1bmRsZScpXG4gICAgICAuc2V0RGVzYyhcbiAgICAgICAgJ1dyaXRlcyBhIHJpY2hlciBtYXJrZG93biBkaWFnbm9zdGljIGZpbGUgKHZlcnNpb25zLCBzZXR0aW5ncywgc3luYyBzdGF0ZSwgcmVjZW50IGxvZykgdG8gLnZhdWx0c3luY2ZvcmFnZW50cy8gaW4gdGhpcyB2YXVsdCBcdTIwMTQgYXR0YWNoIGl0IHRvIGJ1ZyByZXBvcnRzLiBJdCBuZXZlciBjb250YWlucyBub3RlIGNvbnRlbnRzIG9yIHRoZSBkZXZpY2UgdG9rZW4uJyxcbiAgICAgIClcbiAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoJ1NhdmUgc3VwcG9ydCBidW5kbGUnKS5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICBidXR0b24uc2V0RGlzYWJsZWQodHJ1ZSk7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVTdXBwb3J0QnVuZGxlKCk7XG4gICAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICAgIGJ1dHRvbi5zZXREaXNhYmxlZChmYWxzZSk7XG4gICAgICAgICAgfVxuICAgICAgICB9KSxcbiAgICAgICk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlckFib3V0U2VjdGlvbigpOiB2b2lkIHtcbiAgICBjb25zdCB7IGNvbnRhaW5lckVsIH0gPSB0aGlzO1xuICAgIHRoaXMuaGVhZGluZygnQWJvdXQnKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ1ZlcnNpb25zJylcbiAgICAgIC5zZXREZXNjKFxuICAgICAgICBgUGx1Z2luICR7dGhpcy5wbHVnaW4ubWFuaWZlc3QudmVyc2lvbiB8fCAndW5rbm93bid9IFx1MDBCNyBwcm90b2NvbCB2JHtQUk9UT0NPTF9WRVJTSU9OfSBcdTAwQjcgJHt0aGlzLnBsdWdpbi5wbGF0Zm9ybVN1bW1hcnkoKX1gLFxuICAgICAgKTtcblxuICAgIHRoaXMuc2VydmVyVmVyc2lvblNldHRpbmcgPSBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdTZXJ2ZXIgdmVyc2lvbicpXG4gICAgICAuc2V0RGVzYyh0aGlzLnNlcnZlclZlcnNpb25UZXh0KCkpO1xuICAgIHRoaXMucmVmcmVzaFNlcnZlclZlcnNpb24oKTtcblxuICAgIHRoaXMuc3RvcmFnZVNldHRpbmcgPSBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdWYXVsdCBzdG9yYWdlJylcbiAgICAgIC5zZXREZXNjKHRoaXMucGx1Z2luLmxpbmtlZCA/ICdDaGVja2luZyB0aGUgd29ya2VyXHUyMDI2JyA6ICdQYWlyIHRoaXMgdmF1bHQgdG8gc2VlIHN0b3JhZ2UgdXNhZ2UuJyk7XG4gICAgaWYgKHRoaXMucGx1Z2luLmxpbmtlZCkgdm9pZCB0aGlzLnJlZnJlc2hTdG9yYWdlKCk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdQcm9qZWN0IGhvbWUnKVxuICAgICAgLnNldERlc2MoYERvY3VtZW50YXRpb24gYW5kIHNvdXJjZTogJHtQUk9KRUNUX1JFQURNRV9VUkx9YClcbiAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoJ09wZW4gUkVBRE1FJykub25DbGljaygoKSA9PiBvcGVuUmVhZG1lUGFnZSgpKSxcbiAgICAgICk7XG4gIH1cblxuICAvKiogRmlsbCB0aGUgQWJvdXQgc3RvcmFnZSBsaW5lIGZyb20gL2FwaS9zdGF0dXMgKGRldmljZS10b2tlbiBhdXRoKS4gKi9cbiAgcHJpdmF0ZSBhc3luYyByZWZyZXNoU3RvcmFnZSgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBzdW1tYXJ5ID0gYXdhaXQgdGhpcy5wbHVnaW4uZmV0Y2hTdG9yYWdlU3VtbWFyeSgpO1xuICAgIGNvbnN0IGRlc2MgPVxuICAgICAgc3VtbWFyeSA9PT0gbnVsbFxuICAgICAgICA/ICdTdG9yYWdlIHVzYWdlIGlzIGN1cnJlbnRseSB1bmF2YWlsYWJsZSAodGhlIHdvcmtlciBpcyB1bnJlYWNoYWJsZSkuJ1xuICAgICAgICA6IGBTdG9yYWdlIHVzZWQ6ICR7Zm9ybWF0Qnl0ZXMoc3VtbWFyeS5zdG9yYWdlQnl0ZXMpfSBcdTAwQjcgJHtzdW1tYXJ5LmF0dGFjaG1lbnRzLmNvdW50fSBhdHRhY2htZW50JHtcbiAgICAgICAgICAgIHN1bW1hcnkuYXR0YWNobWVudHMuY291bnQgPT09IDEgPyAnJyA6ICdzJ1xuICAgICAgICAgIH0gKCR7Zm9ybWF0Qnl0ZXMoc3VtbWFyeS5hdHRhY2htZW50cy5ieXRlcyl9KWAgK1xuICAgICAgICAgIChzdW1tYXJ5LmRldmljZXMubGVuZ3RoID4gMFxuICAgICAgICAgICAgPyBgIFx1MDBCNyAke3N1bW1hcnkuZGV2aWNlcy5sZW5ndGh9IGRldmljZSR7c3VtbWFyeS5kZXZpY2VzLmxlbmd0aCA9PT0gMSA/ICcnIDogJ3MnfWBcbiAgICAgICAgICAgIDogJycpO1xuICAgIC8vIFRoZSB0YWIgbWF5IGhhdmUgYmVlbiBjbG9zZWQvcmUtcmVuZGVyZWQgbWVhbndoaWxlOyBwYWludCBvbmx5IGlmIGxpdmUuXG4gICAgaWYgKHRoaXMuc3RvcmFnZVNldHRpbmcgIT09IG51bGwpIHRoaXMuc3RvcmFnZVNldHRpbmcuc2V0RGVzYyhkZXNjKTtcbiAgfVxuXG4gIC8vIC0tLSBzdGF0dXMgLyBmZWVkYmFjayAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIHByaXZhdGUgc3RhdHVzVGV4dCgpOiBzdHJpbmcge1xuICAgIGNvbnN0IGRhdGE6IFZhdWx0U3luY1BsdWdpbkRhdGEgPSB0aGlzLnBsdWdpbi5kYXRhO1xuICAgIGNvbnN0IHN0YXR1cyA9IHRoaXMucGx1Z2luLmNsaWVudD8uc3RhdHVzKCk7XG4gICAgaWYgKHRoaXMucGx1Z2luLnN5bmNpbmdQYXVzZWQpIHtcbiAgICAgIHJldHVybiBbXG4gICAgICAgICdTdGF0ZTogcGF1c2VkJyxcbiAgICAgICAgYFdvcmtlcjogJHtkYXRhLnVybH1gLFxuICAgICAgICAnVmF1bHQgY2hhbmdlcyBzdGF5IGxvY2FsIHVudGlsIHlvdSByZXN1bWUgc3luY2luZy4nLFxuICAgICAgXS5qb2luKCdcXG4nKTtcbiAgICB9XG4gICAgaWYgKHN0YXR1cyA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICByZXR1cm4gYExpbmtlZCB0byAke2RhdGEudXJsfSAoZGV2aWNlICR7ZGF0YS5kZXZpY2VOYW1lIHx8IGRhdGEuZGV2aWNlSWR9KS5gO1xuICAgIH1cbiAgICBjb25zdCBsYXN0U3luYyA9XG4gICAgICBzdGF0dXMubGFzdFN5bmNBdCA9PT0gbnVsbFxuICAgICAgICA/ICduZXZlcidcbiAgICAgICAgOiBgJHtmb3JtYXRTaW5jZShEYXRlLm5vdygpIC0gc3RhdHVzLmxhc3RTeW5jQXQpfSBhZ29gO1xuICAgIGNvbnN0IHN0YXRlID0gc3RhdHVzLnN0YXRlID09PSAnbGl2ZScgPyAnY29ubmVjdGVkJyA6IHN0YXR1cy5zdGF0ZTtcbiAgICBjb25zdCBsaW5lcyA9IFtgU3RhdGU6ICR7c3RhdGV9YCwgYFdvcmtlcjogJHtkYXRhLnVybH1gLCBgTGFzdCBzeW5jOiAke2xhc3RTeW5jfWBdO1xuICAgIC8vIEJ1bGstcGhhc2UgcHJvZ3Jlc3MgXHUyMDE0IHRoZSBzYW1lIFgvWSB0aGUgc3RhdHVzIGJhciBzaG93cyBkdXJpbmcgYVxuICAgIC8vIG11bHRpLW1pbnV0ZSBpbml0aWFsIHN5bmMuXG4gICAgaWYgKHN0YXR1cy5wcm9ncmVzcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBsaW5lcy5wdXNoKGBTeW5jaW5nOiAke3N0YXR1cy5wcm9ncmVzcy5kb25lfS8ke3N0YXR1cy5wcm9ncmVzcy50b3RhbH0gKCR7c3RhdHVzLnByb2dyZXNzLnBoYXNlfSlgKTtcbiAgICB9XG4gICAgbGluZXMucHVzaChcbiAgICAgIGBQZW5kaW5nIGNoYW5nZXM6ICR7c3RhdHVzLnBlbmRpbmd9YCxcbiAgICAgIGBDb25mbGljdHM6ICR7c3RhdHVzLmNvbmZsaWN0cy5sZW5ndGh9JHtzdGF0dXMuY29uZmxpY3RzLmxlbmd0aCA+IDAgPyAnIChjb25mbGljdCBjb3BpZXMgd2VyZSB3cml0dGVuIGludG8gdGhlIHZhdWx0KScgOiAnJ31gLFxuICAgICk7XG4gICAgcmV0dXJuIGxpbmVzLmpvaW4oJ1xcbicpO1xuICB9XG5cbiAgcHJpdmF0ZSByZWZyZXNoU3RhdHVzKCk6IHZvaWQge1xuICAgIHRoaXMuc3RhdHVzU2V0dGluZz8uc2V0RGVzYyh0aGlzLnN0YXR1c1RleHQoKSk7XG4gICAgdGhpcy5yZWZyZXNoU2VydmVyVmVyc2lvbigpO1xuICB9XG5cbiAgLyoqXG4gICAqIFRoZSBBYm91dCBzZWN0aW9uJ3Mgc2VydmVyLXZlcnNpb24gbGluZTogdGhlIGhlbGxvQWNrLXJlcG9ydGVkIHZlcnNpb25cbiAgICogcGx1cyB0aGUgY29tcGF0IHZlcmRpY3Qgd2hlbiBpdCBpcyBub3Qgb2suIGBzZXJ2ZXJWZXJzaW9uYCBtYXkgbGFnIHRoZVxuICAgKiB2ZXJkaWN0IGJ5IGEgdGljayAodGhlIHBsdWdpbiBhc3Nlc3NlcyBvbiBpdHMgb3duIDEgSHogc3VwZXJ2aXNpb24pLCBzb1xuICAgKiB0aGUgdmVyZGljdCBtZXNzYWdlIGlzIGF1dGhvcml0YXRpdmUgd2hlbiBwcmVzZW50LlxuICAgKi9cbiAgcHJpdmF0ZSBzZXJ2ZXJWZXJzaW9uVGV4dCgpOiBzdHJpbmcge1xuICAgIGlmICghdGhpcy5wbHVnaW4ubGlua2VkKSByZXR1cm4gJ1BhaXIgdGhpcyB2YXVsdCB0byBzZWUgdGhlIHdvcmtlciB2ZXJzaW9uLic7XG4gICAgY29uc3Qgc3RhdHVzID0gdGhpcy5wbHVnaW4uY2xpZW50Py5zdGF0dXMoKTtcbiAgICBjb25zdCB2ZXJkaWN0ID0gdGhpcy5wbHVnaW4uc2VydmVyQ29tcGF0aWJpbGl0eTtcbiAgICBpZiAodmVyZGljdCAhPT0gbnVsbCAmJiB2ZXJkaWN0LmxldmVsICE9PSAnb2snKSByZXR1cm4gdmVyZGljdC5tZXNzYWdlO1xuICAgIGNvbnN0IHZlcnNpb24gPSBzdGF0dXM/LnNlcnZlclZlcnNpb24gPz8gbnVsbDtcbiAgICByZXR1cm4gdmVyc2lvbiA9PT0gbnVsbFxuICAgICAgPyAnVW5rbm93biBcdTIwMTQgdGhlIHdvcmtlciBoYXMgbm90IHJlcG9ydGVkIGEgdmVyc2lvbiB5ZXQuJ1xuICAgICAgOiBgU2VydmVyICR7dmVyc2lvbn0gXHUwMEI3IGNvbXBhdGlibGUgd2l0aCB0aGlzIHBsdWdpbi5gO1xuICB9XG5cbiAgLyoqIFJlcGFpbnQgdGhlIHNlcnZlci12ZXJzaW9uIHJvdyAoY2FsbGVkIGJ5IHRoZSAxIEh6IHJlZnJlc2ggbG9vcCkuICovXG4gIHByaXZhdGUgcmVmcmVzaFNlcnZlclZlcnNpb24oKTogdm9pZCB7XG4gICAgLy8gVGhlIHRhYiBtYXkgaGF2ZSBiZWVuIGNsb3NlZC9yZS1yZW5kZXJlZCBtZWFud2hpbGU7IHBhaW50IG9ubHkgaWYgbGl2ZS5cbiAgICBpZiAodGhpcy5zZXJ2ZXJWZXJzaW9uU2V0dGluZyAhPT0gbnVsbCkgdGhpcy5zZXJ2ZXJWZXJzaW9uU2V0dGluZy5zZXREZXNjKHRoaXMuc2VydmVyVmVyc2lvblRleHQoKSk7XG4gIH1cblxuICAvKiogUGFpciBmZWVkYmFjazogc3VjY2VzcyByZS1yZW5kZXJzOyBmYWlsdXJlcyBsYW5kIGluIHRoZSBoaW50IFNldHRpbmcuICovXG4gIHByaXZhdGUgc2hvd091dGNvbWUob3V0Y29tZTogUGFpck91dGNvbWUpOiB2b2lkIHtcbiAgICBpZiAob3V0Y29tZS5zdGF0dXMgPT09ICdwYWlyZWQnKSB7XG4gICAgICBuZXcgTm90aWNlKHBhaXJPdXRjb21lTWVzc2FnZShvdXRjb21lKSk7XG4gICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgbWVzc2FnZSA9IHBhaXJPdXRjb21lTWVzc2FnZShvdXRjb21lKTtcbiAgICBuZXcgTm90aWNlKG1lc3NhZ2UsIDEwMDAwKTtcbiAgICBpZiAodGhpcy5oaW50U2V0dGluZyAhPT0gbnVsbCkgdGhpcy5oaW50U2V0dGluZy5zZXREZXNjKG1lc3NhZ2UpO1xuICB9XG5cbiAgLy8gLS0tIGxpdmUgcmVmcmVzaCBsb29wIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIC8qKiBSZWZyZXNoIHRoZSBzdGF0dXMgcmVhZG91dCB+MSBIeiB3aGlsZSB0aGUgdGFiIGlzIG9wZW4uICovXG4gIHByaXZhdGUgc3RhcnRSZWZyZXNoKCk6IHZvaWQge1xuICAgIHRoaXMuc3RvcFJlZnJlc2goKTtcbiAgICBjb25zdCBoYW5kbGUgPSBzZXRJbnRlcnZhbCgoKSA9PiB0aGlzLnJlZnJlc2hTdGF0dXMoKSwgMTAwMCk7XG4gICAgdGhpcy5yZWZyZXNoSGFuZGxlID0gaGFuZGxlO1xuICAgIC8vIE9ic2lkaWFuIGNsZWFycyByZWdpc3RlcmVkIGludGVydmFscyB3aGVuIHRoZSBwbHVnaW4gdW5sb2FkcyBcdTIwMTQgbm8gbGVha1xuICAgIC8vIGV2ZW4gaWYgdGhlIHNldHRpbmdzIG1vZGFsIGlzIGZvcmNlLWNsb3NlZC5cbiAgICB0aGlzLnBsdWdpbi5yZWdpc3RlckludGVydmFsKGhhbmRsZSBhcyB1bmtub3duIGFzIG51bWJlcik7XG4gIH1cblxuICBwcml2YXRlIHN0b3BSZWZyZXNoKCk6IHZvaWQge1xuICAgIGlmICh0aGlzLnJlZnJlc2hIYW5kbGUgIT09IG51bGwpIHtcbiAgICAgIGNsZWFySW50ZXJ2YWwodGhpcy5yZWZyZXNoSGFuZGxlKTtcbiAgICAgIHRoaXMucmVmcmVzaEhhbmRsZSA9IG51bGw7XG4gICAgfVxuICB9XG59XG4iLCAiLyoqXG4gKiBTdGF0dXMtYmFyIGluZGljYXRvciAocGx1Z2luIHNjb3BlIGl0ZW0gIzUpOiBhIHNtYWxsIHBhc3NpdmUgdmlldyBvdmVyXG4gKiBgU3luY0NsaWVudFN0YXR1c2AsIHJlcGFpbnRlZCBieSB0aGUgcGx1Z2luJ3MgMSBzIHN1cGVydmlzaW9uIHRpY2suXG4gKlxuICogICB2c2EgXHUyMkVGICAgICAgICAgICAgICBjb25uZWN0aW5nIC8gc3luY2luZ1xuICogICB2c2EgXHUyMkVGIDEyMzQvNTAwMCAgICBzeW5jaW5nLCBidWxrIHBoYXNlIHByb2dyZXNzIChzY2FubmluZy9wdXNoaW5nL3B1bGxpbmcpXG4gKiAgIHZzYSBcdTI3MTMgMTJzICAgICAgICAgIGxpdmUsIGxhc3QgY29tcGxldGVkIGN5Y2xlIDEyIHMgYWdvXG4gKiAgIHZzYSBcdTI2QTAgY29uZmxpY3RzOiAyIGNvbmZsaWN0cyBvYnNlcnZlZCAoY29uZmxpY3QgY29waWVzIGV4aXN0IGluIHRoZSB2YXVsdClcbiAqICAgdnNhIFx1MjcxNyBvZmZsaW5lICAgICAgZGlzY29ubmVjdGVkIChyZWNvbm5lY3QgYmFja29mZiBydW5uaW5nKVxuICogICB2c2EgXHUyM0Y4ICAgICAgICAgICAgICBzeW5jaW5nIHBhdXNlZCAodGhlIFBhdXNlIHN5bmNpbmcgc2V0dGluZylcbiAqXG4gKiBDb21wYWN0IG1vZGUgZHJvcHMgdGhlIHRyYWlsaW5nIGRldGFpbCAoXCJ2c2EgXHUyNzEzIDEyc1wiIFx1MjE5MiBcInZzYSBcdTI3MTNcIiwgZXRjLik7XG4gKiBIaWRkZW4gbW9kZSByZW1vdmVzIHRoZSBpdGVtIGVudGlyZWx5ICh0aGUgcGx1Z2luIG5ldmVyIG1vdW50cyBpdCkuXG4gKlxuICogVGhlIHRvb2x0aXAgY2FycmllcyB0aGUgZGV0YWlsOiBzdGF0ZSwgd29ya2VyIFVSTCwgZGV2aWNlLCBsYXN0IHN5bmMsIHBlbmRpbmcuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBTeW5jQ2xpZW50U3RhdHVzIH0gZnJvbSAnQHZzYS9jb3JlJztcblxuLyoqIEhvdyB0aGUgc3RhdHVzLWJhciBpbmRpY2F0b3IgcmVuZGVycyAodGhlIFwiU3RhdHVzIGJhciBpbmRpY2F0b3JcIiBzZXR0aW5nKS4gKi9cbmV4cG9ydCB0eXBlIFN0YXR1c0Jhck1vZGUgPSAnZGV0YWlsZWQnIHwgJ2NvbXBhY3QnIHwgJ2hpZGRlbic7XG5cbi8qKiBUaGUgc2xpY2Ugb2YgSFRNTEVsZW1lbnQgdGhlIGluZGljYXRvciB0b3VjaGVzICh0ZXN0cyBwYXNzIGEgcGxhaW4gb2JqZWN0KS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU3RhdHVzSXRlbUxpa2Uge1xuICB0ZXh0Q29udGVudDogc3RyaW5nO1xuICBhZGRDbGFzcz8oY2xzOiBzdHJpbmcpOiB1bmtub3duO1xuICByZW1vdmVDbGFzcz8oY2xzOiBzdHJpbmcpOiB1bmtub3duO1xuICBzZXRBdHRyaWJ1dGU/KG5hbWU6IHN0cmluZywgdmFsdWU6IHN0cmluZyk6IHVua25vd247XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgU3RhdHVzQ29udGV4dCB7XG4gIHVybDogc3RyaW5nO1xuICBkZXZpY2VOYW1lOiBzdHJpbmc7XG4gIC8qKiBFeHRyYSBsaW5lIChlLmcuIGFuIGF1dGggZmFpbHVyZSBub3RlKSBhcHBlbmRlZCB0byB0aGUgdG9vbHRpcC4gKi9cbiAgbm90ZT86IHN0cmluZztcbiAgLyoqIFN5bmNpbmcgaXMgcGF1c2VkICh0aGUgUGF1c2Ugc3luY2luZyBidXR0b24pIFx1MjAxNCBzaG93cyBcInZzYSBcdTIzRjhcIi4gKi9cbiAgcGF1c2VkPzogYm9vbGVhbjtcbiAgLyoqIEluZGljYXRvciBtb2RlICh0aGUgcGx1Z2luJ3Mgc3RhdHVzIGJhciBzZXR0aW5nKTsgZGVmYXVsdCBkZXRhaWxlZC4gKi9cbiAgbW9kZT86IFN0YXR1c0Jhck1vZGU7XG59XG5cbi8qKiBgbm93IC0gc2luY2VgLCBmbG9vcmVkOiBgMTJzYCwgYDVtYCwgYDNoYCBcdTIwMTQgZGlzcGxheSBvbmx5LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdFNpbmNlKGVsYXBzZWRNczogbnVtYmVyKTogc3RyaW5nIHtcbiAgY29uc3Qgc2Vjb25kcyA9IE1hdGgubWF4KDAsIE1hdGguZmxvb3IoZWxhcHNlZE1zIC8gMTAwMCkpO1xuICBpZiAoc2Vjb25kcyA8IDYwKSByZXR1cm4gYCR7c2Vjb25kc31zYDtcbiAgY29uc3QgbWludXRlcyA9IE1hdGguZmxvb3Ioc2Vjb25kcyAvIDYwKTtcbiAgaWYgKG1pbnV0ZXMgPCA2MCkgcmV0dXJuIGAke21pbnV0ZXN9bWA7XG4gIHJldHVybiBgJHtNYXRoLmZsb29yKG1pbnV0ZXMgLyA2MCl9aGA7XG59XG5cbi8qKlxuICogVGhlIG9uZS1saW5lIHN0YXR1cyB0ZXh0IGZvciBhIGNsaWVudCBzdGF0dXMgYXQgdGltZSBgbm93YC4gYG1vZGVgIHNocmlua3NcbiAqIHRoZSBsaW5lIChjb21wYWN0IGRyb3BzIHRoZSB0cmFpbGluZyBkZXRhaWwpOyBgcGF1c2VkYCB3aW5zIG92ZXIgZXZlcnl0aGluZy5cbiAqXG4gKiBEdXJpbmcgYSBidWxrIHBoYXNlIChgc3RhdHVzLnByb2dyZXNzYCBcdTIwMTQgc2Nhbm5pbmcvcHVzaGluZy9wdWxsaW5nIG9mIGFcbiAqIG11bHRpLW1pbnV0ZSBpbml0aWFsIHN5bmMpIGJvdGggZGV0YWlsIGxldmVscyBzaG93IHRoZSBjb3VudHMgXHUyMDE0XG4gKiBgdnNhIFx1MjJFRiAxMjM0LzUwMDBgIFx1MjAxNCBiZWNhdXNlIHRoYXQgaXMgdGhlIG9uZSB0aGluZyBhIHVzZXIgd2FpdGluZyBvbiBhIGJpZ1xuICogc3luYyBuZWVkczsgaGlkZGVuIG1vZGUgc2hvd3Mgbm90aGluZyAodGhlIGl0ZW0gaXMgbmV2ZXIgbW91bnRlZCkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdGF0dXNMaW5lRm9yKFxuICBzdGF0dXM6IFN5bmNDbGllbnRTdGF0dXMsXG4gIG5vdzogbnVtYmVyLFxuICBtb2RlOiBTdGF0dXNCYXJNb2RlID0gJ2RldGFpbGVkJyxcbiAgcGF1c2VkID0gZmFsc2UsXG4pOiBzdHJpbmcge1xuICBpZiAocGF1c2VkKSByZXR1cm4gJ3ZzYSBcdTIzRjgnO1xuICBjb25zdCBjb21wYWN0ID0gbW9kZSA9PT0gJ2NvbXBhY3QnO1xuICBzd2l0Y2ggKHN0YXR1cy5zdGF0ZSkge1xuICAgIGNhc2UgJ2Nvbm5lY3RpbmcnOlxuICAgIGNhc2UgJ3N5bmNpbmcnOiB7XG4gICAgICBjb25zdCBwcm9ncmVzcyA9IHN0YXR1cy5wcm9ncmVzcztcbiAgICAgIGlmIChwcm9ncmVzcyAhPT0gdW5kZWZpbmVkKSByZXR1cm4gYHZzYSBcdTIyRUYgJHtwcm9ncmVzcy5kb25lfS8ke3Byb2dyZXNzLnRvdGFsfWA7XG4gICAgICByZXR1cm4gJ3ZzYSBcdTIyRUYnO1xuICAgIH1cbiAgICBjYXNlICdkaXNjb25uZWN0ZWQnOlxuICAgICAgcmV0dXJuIGNvbXBhY3QgPyAndnNhIFx1MjcxNycgOiAndnNhIFx1MjcxNyBvZmZsaW5lJztcbiAgICBjYXNlICdsaXZlJzpcbiAgICAgIGlmIChzdGF0dXMuY29uZmxpY3RzLmxlbmd0aCA+IDApIHtcbiAgICAgICAgcmV0dXJuIGNvbXBhY3QgPyAndnNhIFx1MjZBMCcgOiBgdnNhIFx1MjZBMCBjb25mbGljdHM6ICR7c3RhdHVzLmNvbmZsaWN0cy5sZW5ndGh9YDtcbiAgICAgIH1cbiAgICAgIGlmIChzdGF0dXMubGFzdFN5bmNBdCA9PT0gbnVsbCB8fCBjb21wYWN0KSByZXR1cm4gJ3ZzYSBcdTI3MTMnO1xuICAgICAgcmV0dXJuIGB2c2EgXHUyNzEzICR7Zm9ybWF0U2luY2Uobm93IC0gc3RhdHVzLmxhc3RTeW5jQXQpfWA7XG4gICAgY2FzZSAnaWRsZSc6XG4gICAgICByZXR1cm4gJ3ZzYSc7XG4gIH1cbn1cblxuLyoqIFRvb2x0aXAgbGluZXMgKGpvaW5lZCB3aXRoIGBcXG5gKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdGF0dXNUb29sdGlwRm9yKHN0YXR1czogU3luY0NsaWVudFN0YXR1cywgY29udGV4dDogU3RhdHVzQ29udGV4dCwgbm93OiBudW1iZXIpOiBzdHJpbmcge1xuICBjb25zdCBzdGF0ZUxhYmVsOiBSZWNvcmQ8U3luY0NsaWVudFN0YXR1c1snc3RhdGUnXSwgc3RyaW5nPiA9IHtcbiAgICBpZGxlOiAnbm90IHJ1bm5pbmcnLFxuICAgIGNvbm5lY3Rpbmc6ICdjb25uZWN0aW5nXHUyMDI2JyxcbiAgICBzeW5jaW5nOiAnc3luY2luZ1x1MjAyNicsXG4gICAgbGl2ZTogJ2xpdmUnLFxuICAgIGRpc2Nvbm5lY3RlZDogJ29mZmxpbmUgXHUyMDE0IHJlY29ubmVjdGluZycsXG4gIH07XG4gIGNvbnN0IGhlYWRsaW5lID0gY29udGV4dC5wYXVzZWQgPT09IHRydWUgPyAncGF1c2VkJyA6IHN0YXRlTGFiZWxbc3RhdHVzLnN0YXRlXTtcbiAgY29uc3QgbGluZXMgPSBbYFZhdWx0U3luYyBmb3IgQWdlbnRzIFx1MjAxNCAke2hlYWRsaW5lfWBdO1xuICBpZiAoY29udGV4dC51cmwgIT09ICcnKSBsaW5lcy5wdXNoKGBXb3JrZXI6ICR7Y29udGV4dC51cmx9YCk7XG4gIGlmIChjb250ZXh0LmRldmljZU5hbWUgIT09ICcnKSBsaW5lcy5wdXNoKGBEZXZpY2U6ICR7Y29udGV4dC5kZXZpY2VOYW1lfWApO1xuICBsaW5lcy5wdXNoKFxuICAgIHN0YXR1cy5sYXN0U3luY0F0ID09PSBudWxsXG4gICAgICA/ICdMYXN0IHN5bmM6IG5ldmVyJ1xuICAgICAgOiBgTGFzdCBzeW5jOiAke2Zvcm1hdFNpbmNlKG5vdyAtIHN0YXR1cy5sYXN0U3luY0F0KX0gYWdvYCxcbiAgKTtcbiAgaWYgKHN0YXR1cy5wcm9ncmVzcyAhPT0gdW5kZWZpbmVkKSB7XG4gICAgbGluZXMucHVzaChgU3luY2luZzogJHtzdGF0dXMucHJvZ3Jlc3MuZG9uZX0vJHtzdGF0dXMucHJvZ3Jlc3MudG90YWx9ICgke3N0YXR1cy5wcm9ncmVzcy5waGFzZX0pYCk7XG4gIH1cbiAgbGluZXMucHVzaChgUGVuZGluZyBjaGFuZ2VzOiAke3N0YXR1cy5wZW5kaW5nfWApO1xuICBsaW5lcy5wdXNoKGBDb25mbGljdHM6ICR7c3RhdHVzLmNvbmZsaWN0cy5sZW5ndGh9YCk7XG4gIGlmIChzdGF0dXMuY29uZmxpY3RzLmxlbmd0aCA+IDApIHtcbiAgICBsaW5lcy5wdXNoKGBDb25mbGljdCBjb3BpZXM6ICR7c3RhdHVzLmNvbmZsaWN0cy5tYXAoKGMpID0+IGMucGF0aCkuam9pbignLCAnKX1gKTtcbiAgfVxuICBpZiAoY29udGV4dC5ub3RlICE9PSB1bmRlZmluZWQgJiYgY29udGV4dC5ub3RlICE9PSAnJykgbGluZXMucHVzaChjb250ZXh0Lm5vdGUpO1xuICByZXR1cm4gbGluZXMuam9pbignXFxuJyk7XG59XG5cbi8qKiBDU1MgbW9kaWZpZXIgZm9yIHRoZSBpbmRpY2F0b3IgKHRpbnRlZCB3YXJuaW5nL2Vycm9yIHN0YXRlcykuICovXG5leHBvcnQgZnVuY3Rpb24gc3RhdHVzQ2xhc3NGb3Ioc3RhdHVzOiBTeW5jQ2xpZW50U3RhdHVzKTogc3RyaW5nIHtcbiAgaWYgKHN0YXR1cy5zdGF0ZSA9PT0gJ2Rpc2Nvbm5lY3RlZCcpIHJldHVybiAndnNhLWVycm9yJztcbiAgaWYgKHN0YXR1cy5jb25mbGljdHMubGVuZ3RoID4gMCkgcmV0dXJuICd2c2Etd2Fybic7XG4gIHJldHVybiAnJztcbn1cblxuLyoqXG4gKiBQYWludHMgb25lIHN0YXR1cy1iYXIgaXRlbS4gUGFzc2l2ZTogdGhlIHBsdWdpbiBjYWxscyBgdXBkYXRlKClgIGZyb20gaXRzXG4gKiBzdXBlcnZpc2lvbiB0aWNrIFx1MjAxNCBubyB0aW1lcnMgb2YgaXRzIG93biB0byBsZWFrLlxuICovXG5leHBvcnQgY2xhc3MgU3RhdHVzQmFySW5kaWNhdG9yIHtcbiAgLyoqIEFsd2F5cyBvbiBcdTIwMTQgdGhlIGJhc2UgY2xhc3Mgc3R5bGVzLmNzcyB0YXJnZXRzLiAqL1xuICBwcml2YXRlIHN0YXRpYyByZWFkb25seSBCQVNFX0NMQVNTID0gJ3ZzYS1zdGF0dXMnO1xuICBwcml2YXRlIHN0YXRpYyByZWFkb25seSBNT0RJRklFUl9DTEFTU0VTID0gWyd2c2Etd2FybicsICd2c2EtZXJyb3InXTtcblxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IGl0ZW06IFN0YXR1c0l0ZW1MaWtlKSB7fVxuXG4gIHVwZGF0ZShzdGF0dXM6IFN5bmNDbGllbnRTdGF0dXMsIGNvbnRleHQ6IFN0YXR1c0NvbnRleHQsIG5vdzogbnVtYmVyKTogdm9pZCB7XG4gICAgdGhpcy5pdGVtLnRleHRDb250ZW50ID0gc3RhdHVzTGluZUZvcihzdGF0dXMsIG5vdywgY29udGV4dC5tb2RlID8/ICdkZXRhaWxlZCcsIGNvbnRleHQucGF1c2VkID09PSB0cnVlKTtcbiAgICB0aGlzLml0ZW0uYWRkQ2xhc3M/LihTdGF0dXNCYXJJbmRpY2F0b3IuQkFTRV9DTEFTUyk7XG4gICAgY29uc3QgbW9kaWZpZXIgPSBzdGF0dXNDbGFzc0ZvcihzdGF0dXMpO1xuICAgIGZvciAoY29uc3QgY2xzIG9mIFN0YXR1c0JhckluZGljYXRvci5NT0RJRklFUl9DTEFTU0VTKSB7XG4gICAgICBpZiAoY2xzID09PSBtb2RpZmllcikgdGhpcy5pdGVtLmFkZENsYXNzPy4oY2xzKTtcbiAgICAgIGVsc2UgdGhpcy5pdGVtLnJlbW92ZUNsYXNzPy4oY2xzKTtcbiAgICB9XG4gICAgdGhpcy5pdGVtLnNldEF0dHJpYnV0ZT8uKCd0aXRsZScsIHN0YXR1c1Rvb2x0aXBGb3Ioc3RhdHVzLCBjb250ZXh0LCBub3cpKTtcbiAgfVxufVxuIiwgIi8qKlxuICogYFdlYlNvY2tldFRyYW5zcG9ydGAgXHUyMDE0IGNvcmUncyBgVHJhbnNwb3J0YCBvdmVyIHRoZSBnbG9iYWwgYFdlYlNvY2tldGBcbiAqIChwcmVzZW50IGluIE9ic2lkaWFuIGRlc2t0b3AgKmFuZCogbW9iaWxlOyBmZWF0dXJlLWNoZWNrZWQgd2l0aCBhIGNsZWFyXG4gKiBlcnJvciBmb3IgZXhvdGljIGJ1aWxkcykuXG4gKlxuICogVGhpcyBtaXJyb3JzIGBAdnNhL25vZGUtcnVudGltZWAncyB0cmFuc3BvcnQgb24gcHVycG9zZSAoc2FtZSB3aXJlIGZvcm1hdDpcbiAqIG9uZSBKU09OIHRleHQgZnJhbWUgcGVyIG1lc3NhZ2UsIGNvcmUncyBgcGFyc2VNZXNzYWdlYCBvbiByZWNlaXZlLCBxdWV1ZWRcbiAqIHNlbmRzIGJlZm9yZSBvcGVuKSBidXQgc2hhcmVzIG5vIGNvZGUgd2l0aCBpdCBcdTIwMTQgYEB2c2Evbm9kZS1ydW50aW1lYCBpc1xuICogTm9kZS1vbmx5IGFuZCBtdXN0IG5ldmVyIGJlIGEgcGx1Z2luIGRlcGVuZGVuY3kuXG4gKi9cblxuaW1wb3J0IHsgTmV0d29ya0Vycm9yLCBwYXJzZU1lc3NhZ2UgfSBmcm9tICdAdnNhL2NvcmUnO1xuaW1wb3J0IHR5cGUgeyBDbG9zZVJlYXNvbiwgTWVzc2FnZSwgVHJhbnNwb3J0IH0gZnJvbSAnQHZzYS9jb3JlJztcblxuLyoqXG4gKiBUaGUgbWluaW1hbCBXZWJTb2NrZXQgc3VyZmFjZSB0aGlzIHRyYW5zcG9ydCBuZWVkcy4gSW5qZWN0YWJsZSBzbyB0ZXN0c1xuICogKGFuZCBleG90aWMgcnVudGltZXMpIGNhbiBzdXBwbHkgYSBmYWtlOyBwcm9kdWN0aW9uIHVzZXMgdGhlIGdsb2JhbC5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBXZWJTb2NrZXRMaWtlIHtcbiAgc2VuZChkYXRhOiBzdHJpbmcpOiB2b2lkO1xuICBjbG9zZShjb2RlPzogbnVtYmVyLCByZWFzb24/OiBzdHJpbmcpOiB2b2lkO1xuICBhZGRFdmVudExpc3RlbmVyKHR5cGU6ICdvcGVuJywgbGlzdGVuZXI6ICgpID0+IHZvaWQpOiB2b2lkO1xuICBhZGRFdmVudExpc3RlbmVyKHR5cGU6ICdtZXNzYWdlJywgbGlzdGVuZXI6IChldmVudDogeyBkYXRhOiB1bmtub3duIH0pID0+IHZvaWQpOiB2b2lkO1xuICBhZGRFdmVudExpc3RlbmVyKHR5cGU6ICdjbG9zZScsIGxpc3RlbmVyOiAoZXZlbnQ6IHsgY29kZT86IG51bWJlcjsgcmVhc29uPzogc3RyaW5nIH0pID0+IHZvaWQpOiB2b2lkO1xuICBhZGRFdmVudExpc3RlbmVyKHR5cGU6ICdlcnJvcicsIGxpc3RlbmVyOiAoZXZlbnQ6IHVua25vd24pID0+IHZvaWQpOiB2b2lkO1xufVxuXG5leHBvcnQgdHlwZSBXZWJTb2NrZXRGYWN0b3J5ID0gKHVybDogc3RyaW5nKSA9PiBXZWJTb2NrZXRMaWtlO1xuXG5leHBvcnQgaW50ZXJmYWNlIFdlYlNvY2tldFRyYW5zcG9ydE9wdGlvbnMge1xuICAvKiogV29ya2VyIG9yaWdpbiAoYGh0dHBzOi8vcGVyc29uYWwueC53b3JrZXJzLmRldmApIG9yIGEgYHdzKHMpOi8vYCBVUkwuICovXG4gIHVybDogc3RyaW5nO1xuICAvKiogRGV2aWNlIHRva2VuIFx1MjAxNCBjYXJyaWVkIGluIHRoZSBxdWVyeSBzdHJpbmcgKHRoZSB3b3JrZXIncyBwcmUtYXV0aCBwYXRoKS4gKi9cbiAgdG9rZW46IHN0cmluZztcbiAgLyoqIFdTIHBhdGggb24gdGhlIHdvcmtlciAoZGVmYXVsdCBgL3dzYDsgYC9zeW5jYCBpcyBlcXVpdmFsZW50KS4gKi9cbiAgcGF0aD86IHN0cmluZztcbiAgLyoqIEluamVjdGFibGUgc29ja2V0IGZhY3RvcnkgKHRlc3RzKS4gRGVmYXVsdDogdGhlIGdsb2JhbCBgV2ViU29ja2V0YC4gKi9cbiAgd3NGYWN0b3J5PzogV2ViU29ja2V0RmFjdG9yeTtcbn1cblxuLyoqXG4gKiBCdWlsZCB0aGUgYXV0aGVudGljYXRlZCBXUyBVUkw6IGBodHRwczovL3hgIFx1MjE5MiBgd3NzOi8veC93cz90b2tlbj1cdTIwMjZgLlxuICogVGhyb3dzIG9uIG5vbi1IVFRQKFMpL1dTIHNjaGVtZXMgb3IgdW5wYXJzYWJsZSBpbnB1dC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHRvV2ViU29ja2V0VXJsKGJhc2VVcmw6IHN0cmluZywgdG9rZW46IHN0cmluZywgcGF0aCA9ICcvd3MnKTogc3RyaW5nIHtcbiAgY29uc3QgdXJsID0gbmV3IFVSTChiYXNlVXJsKTtcbiAgaWYgKHVybC5wcm90b2NvbCA9PT0gJ2h0dHA6JykgdXJsLnByb3RvY29sID0gJ3dzOic7XG4gIGVsc2UgaWYgKHVybC5wcm90b2NvbCA9PT0gJ2h0dHBzOicpIHVybC5wcm90b2NvbCA9ICd3c3M6JztcbiAgZWxzZSBpZiAodXJsLnByb3RvY29sICE9PSAnd3M6JyAmJiB1cmwucHJvdG9jb2wgIT09ICd3c3M6Jykge1xuICAgIHRocm93IG5ldyBOZXR3b3JrRXJyb3IoYHdvcmtlciBVUkwgbXVzdCBiZSBodHRwKHMpOi8vIG9yIHdzKHMpOi8vLCBnb3QgJHt1cmwucHJvdG9jb2x9YCk7XG4gIH1cbiAgdXJsLnBhdGhuYW1lID0gcGF0aDtcbiAgdXJsLnNlYXJjaCA9ICcnO1xuICB1cmwuc2VhcmNoUGFyYW1zLnNldCgndG9rZW4nLCB0b2tlbik7XG4gIHJldHVybiB1cmwudG9TdHJpbmcoKTtcbn1cblxuZnVuY3Rpb24gZGVmYXVsdFdlYlNvY2tldEZhY3RvcnkodXJsOiBzdHJpbmcpOiBXZWJTb2NrZXRMaWtlIHtcbiAgY29uc3Qgd2Vic29ja2V0ID0gKGdsb2JhbFRoaXMgYXMgeyBXZWJTb2NrZXQ/OiB1bmtub3duIH0pLldlYlNvY2tldDtcbiAgaWYgKHR5cGVvZiB3ZWJzb2NrZXQgIT09ICdmdW5jdGlvbicpIHtcbiAgICB0aHJvdyBuZXcgTmV0d29ya0Vycm9yKFxuICAgICAgJ1dlYlNvY2tldCBpcyBub3QgYXZhaWxhYmxlIGluIHRoaXMgT2JzaWRpYW4gYnVpbGQgKGl0IGlzIGJ1aWx0IGluIG9uIGRlc2t0b3AgYW5kICcgK1xuICAgICAgICAnbW9iaWxlOyBhIHZlcnkgb2xkIGFwcCB2ZXJzaW9uIG9yIGEgc3RyaXBwZWQgd2VidmlldyBpcyB0aGUgb25seSBrbm93biBjYXVzZSkuICcgK1xuICAgICAgICAnU3luYyByZXF1aXJlcyBpdC4nLFxuICAgICk7XG4gIH1cbiAgcmV0dXJuIG5ldyAod2Vic29ja2V0IGFzIG5ldyAodXJsOiBzdHJpbmcpID0+IFdlYlNvY2tldExpa2UpKHVybCk7XG59XG5cbmV4cG9ydCBjbGFzcyBXZWJTb2NrZXRUcmFuc3BvcnQgaW1wbGVtZW50cyBUcmFuc3BvcnQge1xuICBwcml2YXRlIHJlYWRvbmx5IHNvY2tldDogV2ViU29ja2V0TGlrZTtcbiAgcHJpdmF0ZSBtZXNzYWdlQ2FsbGJhY2s6ICgobWVzc2FnZTogTWVzc2FnZSkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBjbG9zZUNhbGxiYWNrOiAoKHJlYXNvbjogQ2xvc2VSZWFzb24pID0+IHZvaWQpIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgb3BlbiA9IGZhbHNlO1xuICBwcml2YXRlIGNsb3NlZCA9IGZhbHNlO1xuICBwcml2YXRlIGNsb3NlTm90aWZpZWQgPSBmYWxzZTtcbiAgcHJpdmF0ZSByZWFkb25seSBzZW5kUXVldWU6IHN0cmluZ1tdID0gW107XG4gIHByaXZhdGUgbGFzdEVycm9yOiBzdHJpbmcgfCB1bmRlZmluZWQ7XG5cbiAgY29uc3RydWN0b3Iob3B0aW9uczogV2ViU29ja2V0VHJhbnNwb3J0T3B0aW9ucykge1xuICAgIGNvbnN0IGZhY3RvcnkgPSBvcHRpb25zLndzRmFjdG9yeSA/PyBkZWZhdWx0V2ViU29ja2V0RmFjdG9yeTtcbiAgICBjb25zdCB1cmwgPSB0b1dlYlNvY2tldFVybChvcHRpb25zLnVybCwgb3B0aW9ucy50b2tlbiwgb3B0aW9ucy5wYXRoID8/ICcvd3MnKTtcbiAgICB0aGlzLnNvY2tldCA9IGZhY3RvcnkodXJsKTtcblxuICAgIHRoaXMuc29ja2V0LmFkZEV2ZW50TGlzdGVuZXIoJ29wZW4nLCAoKSA9PiB7XG4gICAgICB0aGlzLm9wZW4gPSB0cnVlO1xuICAgICAgY29uc3QgcXVldWVkID0gWy4uLnRoaXMuc2VuZFF1ZXVlXTtcbiAgICAgIHRoaXMuc2VuZFF1ZXVlLmxlbmd0aCA9IDA7XG4gICAgICBmb3IgKGNvbnN0IGZyYW1lIG9mIHF1ZXVlZCkgdGhpcy5zb2NrZXQuc2VuZChmcmFtZSk7XG4gICAgfSk7XG5cbiAgICB0aGlzLnNvY2tldC5hZGRFdmVudExpc3RlbmVyKCdtZXNzYWdlJywgKGV2ZW50KSA9PiB7XG4gICAgICBpZiAodHlwZW9mIGV2ZW50LmRhdGEgIT09ICdzdHJpbmcnKSB7XG4gICAgICAgIHRoaXMuZmFpbCh7IGNvZGU6IDEwMDMsIHJlYXNvbjogJ2JpbmFyeSBmcmFtZXMgYXJlIG5vdCBwYXJ0IG9mIHRoZSBwcm90b2NvbCcgfSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGxldCBtZXNzYWdlOiBNZXNzYWdlO1xuICAgICAgdHJ5IHtcbiAgICAgICAgbWVzc2FnZSA9IHBhcnNlTWVzc2FnZShldmVudC5kYXRhKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHRoaXMuZmFpbCh7IGNvZGU6IDEwMDIsIHJlYXNvbjogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpIH0pO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG4gICAgICB0aGlzLm1lc3NhZ2VDYWxsYmFjaz8uKG1lc3NhZ2UpO1xuICAgIH0pO1xuXG4gICAgdGhpcy5zb2NrZXQuYWRkRXZlbnRMaXN0ZW5lcignZXJyb3InLCAoZXZlbnQpID0+IHtcbiAgICAgIHRoaXMubGFzdEVycm9yID1cbiAgICAgICAgZXZlbnQgaW5zdGFuY2VvZiBFcnJvciA/IGV2ZW50Lm1lc3NhZ2UgOiBldmVudCAhPT0gdW5kZWZpbmVkID8gU3RyaW5nKGV2ZW50KSA6ICdzb2NrZXQgZXJyb3InO1xuICAgIH0pO1xuXG4gICAgdGhpcy5zb2NrZXQuYWRkRXZlbnRMaXN0ZW5lcignY2xvc2UnLCAoZXZlbnQpID0+IHtcbiAgICAgIHRoaXMuZmluaXNoQ2xvc2Uoe1xuICAgICAgICBjb2RlOiBldmVudC5jb2RlLFxuICAgICAgICByZWFzb246IGV2ZW50LnJlYXNvbiAhPT0gdW5kZWZpbmVkICYmIGV2ZW50LnJlYXNvbiAhPT0gJycgPyBldmVudC5yZWFzb24gOiB0aGlzLmxhc3RFcnJvcixcbiAgICAgIH0pO1xuICAgIH0pO1xuICB9XG5cbiAgc2VuZChtZXNzYWdlOiBNZXNzYWdlKTogdm9pZCB7XG4gICAgaWYgKHRoaXMuY2xvc2VkKSB0aHJvdyBuZXcgTmV0d29ya0Vycm9yKCdzZW5kIG9uIGEgY2xvc2VkIHRyYW5zcG9ydCcpO1xuICAgIGNvbnN0IGZyYW1lID0gSlNPTi5zdHJpbmdpZnkobWVzc2FnZSk7XG4gICAgaWYgKHRoaXMub3Blbikge1xuICAgICAgdGhpcy5zb2NrZXQuc2VuZChmcmFtZSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRoaXMuc2VuZFF1ZXVlLnB1c2goZnJhbWUpO1xuICB9XG5cbiAgb25NZXNzYWdlKGNhbGxiYWNrOiAobWVzc2FnZTogTWVzc2FnZSkgPT4gdm9pZCk6IHZvaWQge1xuICAgIHRoaXMubWVzc2FnZUNhbGxiYWNrID0gY2FsbGJhY2s7XG4gIH1cblxuICBvbkNsb3NlKGNhbGxiYWNrOiAocmVhc29uOiBDbG9zZVJlYXNvbikgPT4gdm9pZCk6IHZvaWQge1xuICAgIHRoaXMuY2xvc2VDYWxsYmFjayA9IGNhbGxiYWNrO1xuICB9XG5cbiAgY2xvc2UoKTogdm9pZCB7XG4gICAgaWYgKHRoaXMuY2xvc2VkKSByZXR1cm47XG4gICAgdGhpcy5jbG9zZWQgPSB0cnVlO1xuICAgIHRoaXMuc2VuZFF1ZXVlLmxlbmd0aCA9IDA7XG4gICAgdHJ5IHtcbiAgICAgIHRoaXMuc29ja2V0LmNsb3NlKDEwMDAsICdjbG9zZWQgYnkgY2FsbGVyJyk7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBhbHJlYWR5IGRlYWQgXHUyMDE0IHRoZSBjbG9zZSBldmVudCBtYXkgbmV2ZXIgYXJyaXZlXG4gICAgfVxuICAgIC8vIE5vdGlmeSBldmVuIGlmIHRoZSBzb2NrZXQgbmV2ZXIgZW1pdHMgJ2Nsb3NlJyAoZmFpbGVkIGRpYWwpLlxuICAgIHRoaXMuZmluaXNoQ2xvc2UoeyBjb2RlOiAxMDAwLCByZWFzb246ICdjbG9zZWQgYnkgY2FsbGVyJyB9KTtcbiAgfVxuXG4gIHByaXZhdGUgZmFpbChyZWFzb246IENsb3NlUmVhc29uKTogdm9pZCB7XG4gICAgdGhpcy5jbG9zZWQgPSB0cnVlO1xuICAgIHRyeSB7XG4gICAgICB0aGlzLnNvY2tldC5jbG9zZShyZWFzb24uY29kZSA/PyAxMDAyLCByZWFzb24ucmVhc29uID8/ICcnKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIGFscmVhZHkgY2xvc2VkXG4gICAgfVxuICAgIHRoaXMuZmluaXNoQ2xvc2UocmVhc29uKTtcbiAgfVxuXG4gIHByaXZhdGUgZmluaXNoQ2xvc2UocmVhc29uOiBDbG9zZVJlYXNvbik6IHZvaWQge1xuICAgIHRoaXMub3BlbiA9IGZhbHNlO1xuICAgIHRoaXMuY2xvc2VkID0gdHJ1ZTtcbiAgICBpZiAodGhpcy5jbG9zZU5vdGlmaWVkKSByZXR1cm47XG4gICAgdGhpcy5jbG9zZU5vdGlmaWVkID0g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Q1Y7QUFBQSxRQUNDLE1BQU07QUFDSixlQUFLLFdBQVcsUUFBUTtBQUFBLFFBQzFCO0FBQUEsUUFDQSxDQUFDLFVBQW1CO0FBQ2xCLGVBQUssV0FBVyxRQUFRO0FBQ3hCLGVBQUssZ0JBQWdCLE9BQU8sa0JBQWtCO0FBQUEsUUFDaEQ7QUFBQSxNQUNGLEVBQ0MsTUFBTSxNQUFNO0FBQUEsTUFBQyxDQUFDO0FBQUEsSUFDbkIsR0FBRyxPQUFPO0FBQUEsRUFDWjtBQUFBO0FBQUEsRUFHUSxnQkFBZ0IsT0FBZ0IsU0FBdUI7QUFDN0QsUUFBSSxpQkFBaUIsZ0JBQWdCLGlCQUFpQixtQkFBbUI7QUFDdkUsV0FBSyxhQUFhO0FBQ2xCLFdBQUssYUFBYTtBQUNsQixXQUFLLFFBQVEsTUFBTSxTQUFTLEtBQUs7QUFDakMsVUFBSTtBQUFBLFFBQ0Y7QUFBQSxRQUNBO0FBQUEsTUFDRjtBQUNBO0FBQUEsSUFDRjtBQUNBLFNBQUssUUFBUSxLQUFLLFNBQVMsS0FBSztBQUFBLEVBQ2xDO0FBQUE7QUFBQSxFQUdBLE1BQWMsc0JBQXNCLFNBQWdEO0FBQ2xGLFFBQUk7QUFDSixRQUFJO0FBQ0YsWUFBTSxRQUFRLE1BQU0sUUFBUSxTQUFTLHdCQUF3QjtBQUM3RCxlQUFTLEtBQUssTUFBTSxJQUFJLFlBQVksRUFBRSxPQUFPLEtBQUssQ0FBQztBQUFBLElBQ3JELFNBQVE7QUFDTjtBQUFBLElBQ0Y7QUFDQSxRQUNFLE9BQU8sT0FBTyxhQUFhLFlBQzNCLE9BQU8sYUFBYSxLQUFLLEtBQUssVUFDOUI7QUFDQSxZQUFNLE9BQU8sT0FBTyxPQUFPLGVBQWUsV0FBVyxPQUFPLGFBQWEsT0FBTztBQUNoRixZQUFNLFFBQVEsT0FBTyxPQUFPLFFBQVEsV0FBVyxPQUFPLE1BQU07QUFDNUQsVUFBSTtBQUFBLFFBQ0YsNERBQTRELElBQUksZ0JBQWdCLEtBQUs7QUFBQSxRQUdyRjtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUNGO0FBRUEsU0FBUyx1QkFBdUIsT0FBdUI7QUFDckQsTUFBSTtBQUNGLFdBQU8sbUJBQW1CLEtBQUs7QUFBQSxFQUNqQyxTQUFRO0FBQ04sV0FBTztBQUFBLEVBQ1Q7QUFDRjsiLAogICJuYW1lcyI6IFsiaW1wb3J0X29ic2lkaWFuIiwgIl9hIiwgIl9iIiwgIl9jIiwgIl9kIiwgIl9lIiwgImltcG9ydF9vYnNpZGlhbiIsICJpbXBvcnRfb2JzaWRpYW4iLCAiaW1wb3J0X29ic2lkaWFuIiwgIl9hIiwgIl9hIl0KfQo=
