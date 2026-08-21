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
function serializeLocalIndex(index) {
  const entries = {};
  for (const path of Object.keys(index).sort()) {
    entries[path] = index[path];
  }
  const envelope = {
    schemaVersion: LOCAL_INDEX_SCHEMA_VERSION,
    entries
  };
  return JSON.stringify(envelope);
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
  let working = index;
  try {
    for (const pull of plan.pulls) {
      working = await applyOnePull(storage, working, pull, fetchBlob, now);
    }
  } catch (error) {
    try {
      await persistIndex(storage, working);
    } catch (e) {
    }
    throw error;
  }
  await persistIndex(storage, working);
  return working;
}
async function applyOnePull(storage, index, pull, fetchBlob, now) {
  if (pull.kind === "rename") {
    if (await storage.exists(pull.fromPath)) {
      await storage.renameFile(pull.fromPath, pull.toPath);
    } else {
      await fetchVerified(storage, pull.toPath, pull.hash, fetchBlob);
    }
    return applyCommit(removeEntry(index, pull.fromPath), {
      path: pull.toPath,
      versionId: pull.version,
      hash: pull.hash,
      size: pull.size,
      clock: pull.clock
    });
  }
  if (pull.isFolder) {
    if (!pull.deleted) await storage.ensureDir(pull.path);
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
    return applyCommit(index, {
      path: pull.path,
      versionId: pull.version,
      hash: pull.hash,
      size: pull.size,
      clock: pull.clock,
      deleted: true,
      deletedAt: now
    });
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
async function persistIndex(storage, index) {
  await storage.writeFile(
    LOCAL_INDEX_STATE_PATH,
    new TextEncoder().encode(serializeLocalIndex(index))
  );
}
async function loadLocalIndex(storage) {
  const bytes = await storage.readFile(LOCAL_INDEX_STATE_PATH);
  return deserializeLocalIndex(new TextDecoder().decode(bytes));
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
    ...localChanges.deleted.map((d) => ({ ...d, kind: "delete" }))
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
        size: (_c2 = entry == null ? void 0 : entry.size) != null ? _c2 : candidate.size
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
          size: (_c2 = entry == null ? void 0 : entry.size) != null ? _c2 : local.size
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
  const files = await storage.listFiles();
  const kept = [];
  for (const file of files) {
    if (!isIgnored(file.path, settings)) kept.push(file);
  }
  const keptPaths = new Set(kept.map((f) => f.path));
  const added = [];
  const modified = [];
  const hashed = [];
  for (const file of kept) {
    const entry = index[file.path];
    if (mode === "fast" && statMatchesEntry(entry, file)) {
      continue;
    }
    const hash = await hashFn(await storage.readFile(file.path));
    hashed.push({ path: file.path, hash, size: file.size, mtime: file.mtime });
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
  const emptyFolders = await detectEmptyFolders(storage, index, settings, files);
  return {
    scannedAt: now,
    added: sortCandidates(unmatchedAdded),
    modified: sortCandidates(modified),
    deleted: [...unmatchedDeleted].sort(byPath),
    renamed: [...renamed].sort((a, b) => byPath(a, b)),
    emptyFolders,
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
async function detectEmptyFolders(storage, index, settings, files) {
  const representedDirs = /* @__PURE__ */ new Set();
  for (const file of files) {
    for (let dir = parentPath(file.path); dir !== "/"; dir = parentPath(dir)) {
      representedDirs.add(dir);
    }
  }
  const emptyFolders = [];
  for (const dir of await storage.listDirs()) {
    if (dir === "/") continue;
    if (representedDirs.has(dir)) continue;
    if (isIgnored(dir, settings)) continue;
    const entry = index[dir];
    if ((entry == null ? void 0 : entry.isFolder) && entry.deletedAt === void 0) continue;
    emptyFolders.push(dir);
  }
  return emptyFolders.sort();
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
    /** Serialized operation queue — exactly one async op runs at a time. */
    __publicField(this, "tail", Promise.resolve());
    __publicField(this, "queuedOps", 0);
    /** Startup-time change flood is buffered; the full manifest subsumes it. */
    __publicField(this, "buffering", false);
    __publicField(this, "buffered", []);
    /** Single outstanding request expectation (ops are serialized). */
    __publicField(this, "expectation", null);
    // --- message pump ----------------------------------------------------------------------
    __publicField(this, "onTransportMessage", (message) => {
      const expectation = this.expectation;
      if (expectation !== null && expectation.matches(message)) {
        this.expectation = null;
        expectation.resolve(message);
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
    __publicField(this, "fetchBlob", async (hash) => {
      if (hash === "") throw new ProtocolError("refusing to fetch content for an empty hash");
      const cached = await this.options.blobStore.get(hash);
      if (cached !== void 0) return cached;
      const bytes = await this.downloadBlob(hash);
      await this.options.blobStore.put(hash, bytes);
      return bytes;
    });
    var _a, _b, _c, _d, _e;
    this.options = options;
    this.log = (_a = options.log) != null ? _a : defaultLog;
    this.now = (_b = options.now) != null ? _b : (() => Date.now());
    this.debounceMs = (_c = options.debounceMs) != null ? _c : 300;
    this.schedule = (_d = options.schedule) != null ? _d : defaultSchedule;
    this.dialTransport = typeof options.transport === "function" ? options.transport : () => options.transport;
    this.ignoreSettings = (_e = options.settings) != null ? _e : { obsidianSync: false };
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
      conflicts: [...this.conflicts]
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
    this.state = "connecting";
    this.buffering = true;
    this.buffered = [];
    this.index = await this.safeStorageExists(LOCAL_INDEX_STATE_PATH) ? await loadLocalIndex(this.options.storage) : {};
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
    this.state = "syncing";
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
    const expectation = this.expectation;
    if (expectation !== null) {
      this.expectation = null;
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
      this.scheduleReconcile();
      return;
    }
    this.index = await this.applyPulls([this.pullOpFromChange(change)]);
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
  async applyPulls(pulls) {
    return applyPull(
      this.options.storage,
      this.index,
      { pushes: [], pulls: [...pulls], conflicts: [], folderPushes: [] },
      this.fetchBlob,
      { now: this.now() }
    );
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
    var _a, _b;
    if (this.transport === null || this.isDisconnected()) return;
    this.state = "syncing";
    try {
      const manifest = await this.fetchManifest();
      const localChanges = await scanVault(
        this.options.storage,
        this.index,
        this.ignoreSettings,
        this.now()
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
      this.index = await this.applyPulls(plan.pulls);
      for (const commit of staged) {
        await this.sendCommit(commit);
      }
      for (const path of plan.folderPushes) {
        await this.sendCommit({
          kind: "edit",
          path,
          parentVersion: (_b = (_a = this.index[path]) == null ? void 0 : _a.versionId) != null ? _b : null,
          hash: "",
          size: 0,
          isFolder: true
        });
      }
      this.index = recordHashedFiles(this.index, localChanges.hashed);
      this.lastSyncAt = this.now();
      this.pending = 0;
      if (!this.isDisconnected()) this.state = "live";
    } catch (error) {
      this.log.error("sync cycle failed", error);
      if (!this.isDisconnected()) this.state = this.transport !== null ? "live" : "idle";
      throw error;
    }
  }
  async fetchManifest() {
    const transport = this.transport;
    if (transport === null) throw new NetworkError("not connected");
    const reply = await this.request(
      (m) => m.type === "manifest" || m.type === "error",
      () => transport.send({ type: "getManifest" })
    );
    if (reply.type === "error") throw this.toError(reply);
    if (reply.cursor > this.cursor) this.cursor = reply.cursor;
    return Object.values(reply.entries).map((entry) => ({ ...entry }));
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
      size: push.size
    };
  }
  async readLocal(path) {
    try {
      return await this.options.storage.readFile(path);
    } catch (e) {
      return void 0;
    }
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
      if (reply.seq > this.cursor) this.cursor = reply.seq;
      this.applyAckToIndex(commit, reply.version, reply.clock);
      return;
    }
    await this.handleConflictReply(commit, reply);
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
      this.expectation = {
        matches: (message) => matches(message),
        resolve: (message) => resolve(message),
        reject
      };
      try {
        send();
      } catch (error) {
        this.expectation = null;
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
    const snapshot = serializeLocalIndex(this.index);
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
    case "syncing":
      return "vsa \u22EF";
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
var DEPLOY_URL = "https://deploy.workers.cloudflare.com/?url=https://github.com/vaultsyncforagents/vaultsyncforagents-template";
var PROJECT_README_URL = "https://github.com/vaultsyncforagents/vaultsyncforagents#readme";
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
    return [
      `State: ${state}`,
      `Worker: ${data.url}`,
      `Last sync: ${lastSync}`,
      `Pending changes: ${status.pending}`,
      `Conflicts: ${status.conflicts.length}${status.conflicts.length > 0 ? " (conflict copies were written into the vault)" : ""}`
    ].join("\n");
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiLCAic3JjL3BsdWdpbi50cyIsICIuLi9jb3JlL3NyYy9wYXRocy50cyIsICIuLi9jb3JlL3NyYy9jbG9jay50cyIsICIuLi9jb3JlL3NyYy9oYXNoaW5nLnRzIiwgIi4uL2NvcmUvc3JjL2Vycm9ycy50cyIsICIuLi9jb3JlL3NyYy9sb2NhbGluZGV4LnRzIiwgIi4uL2NvcmUvc3JjL2VuZ2luZS50cyIsICIuLi9jb3JlL3NyYy9pZ25vcmUudHMiLCAiLi4vY29yZS9zcmMvcHJvdG9jb2wudHMiLCAiLi4vY29yZS9zcmMvY29uZmxpY3RuYW1lcy50cyIsICIuLi9jb3JlL3NyYy9yZXNvbHZlLnRzIiwgIi4uL2NvcmUvc3JjL3NjYW4udHMiLCAiLi4vY29yZS9zcmMvY2xpZW50LnRzIiwgInNyYy9hZGFwdGVycy9vYnNpZGlhbi1zdG9yYWdlLnRzIiwgInNyYy9hZGFwdGVycy9vYnNpZGlhbi13YXRjaC50cyIsICJzcmMvYmxvYnN0b3JlLnRzIiwgInNyYy9kaWFnbm9zdGljcy50cyIsICJzcmMvZGF0YS50cyIsICJzcmMvd29ya2VyYXBpLnRzIiwgInNyYy9wYWlyaW5nLnRzIiwgInNyYy9wcm90b2NvbC1oYW5kbGVyLnRzIiwgInNyYy9yZWNvbm5lY3QudHMiLCAic3JjL3NldHRpbmdzLnRzIiwgInNyYy9zdGF0dXNiYXIudHMiLCAic3JjL3RyYW5zcG9ydC50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiLyoqXG4gKiBQbHVnaW4gZW50cnkgcG9pbnQgXHUyMDE0IE9ic2lkaWFuIGxvYWRzIGBtYWluLmpzYCBhbmQgaW5zdGFudGlhdGVzIHRoZSBkZWZhdWx0XG4gKiBleHBvcnQuIEV2ZXJ5dGhpbmcgcmVhbCBsaXZlcyBpbiBgcGx1Z2luLnRzYCAoYW5kIGl0cyBtb2R1bGVzKTsgdGhpcyBmaWxlXG4gKiBvbmx5IHJlLWV4cG9ydHMuXG4gKi9cblxuZXhwb3J0IHsgVmF1bHRTeW5jUGx1Z2luIGFzIGRlZmF1bHQgfSBmcm9tICcuL3BsdWdpbi5qcyc7XG4iLCAiLyoqXG4gKiBgVmF1bHRTeW5jUGx1Z2luYCBcdTIwMTQgdGhlIE9ic2lkaWFuIGNsaWVudCAoZGVza3RvcCArIG1vYmlsZSkuXG4gKlxuICogb25sb2FkOiBsb2FkIGxpbmsgaWRlbnRpdHkgXHUyMTkyIGlmIGxpbmtlZCwgYnVpbGQgYFN5bmNDbGllbnRgIChjb3JlKSBvdmVyIHRoZVxuICogT2JzaWRpYW4gYWRhcHRlcnMgYW5kIHJ1biBzdGFydHVwIHJlY29uY2lsaWF0aW9uICh0aGUgc3luYy1vbi1vcGVuXG4gKiBjb250cmFjdCwgRlItNC9GUi01L0ZSLTEyKSwgdGhlbiBlbnRlciBsaXZlIG1vZGUgKHZhdWx0IGV2ZW50cyArIHBlcmlvZGljXG4gKiByZXNjYW4gKyBmb2N1cyByZXNjYW4pIHdpdGggYSBzdGF0dXMtYmFyIGluZGljYXRvciBhbmQgaml0dGVyZWRcbiAqIGV4cG9uZW50aWFsLWJhY2tvZmYgcmVjb25uZWN0IChjYXBwZWQgYXQgNjAgcykuXG4gKlxuICogQSAxIEh6IFwic3VwZXJ2aXNpb24gdGlja1wiIGRyaXZlcyBldmVyeXRoaW5nIHRpbWUtYmFzZWQ6IGl0IHJlcGFpbnRzIHRoZVxuICogc3RhdHVzIGJhciBhbmQgbm90aWNlcyBgZGlzY29ubmVjdGVkYCBcdTIxOTIgc2NoZWR1bGVzIG9uZSByZWNvbm5lY3QgYXQgYSB0aW1lLlxuICogQWxsIHRpbWVycyBhcmUgb3duZWQgaGVyZSBhbmQgdG9ybiBkb3duIGluIGBzdG9wU3luYygpYC9gb251bmxvYWRgLlxuICovXG5cbmltcG9ydCB7IE5vdGljZSwgUGx1Z2luIH0gZnJvbSAnb2JzaWRpYW4nO1xuaW1wb3J0IHR5cGUgeyBBcHAsIFBsdWdpbk1hbmlmZXN0IH0gZnJvbSAnb2JzaWRpYW4nO1xuaW1wb3J0IHsgUmV2b2tlZEVycm9yLCBTeW5jQ2xpZW50LCBVbmF1dGhvcml6ZWRFcnJvciB9IGZyb20gJ0B2c2EvY29yZSc7XG5pbXBvcnQgeyBPYnNpZGlhblN0b3JhZ2VBZGFwdGVyIH0gZnJvbSAnLi9hZGFwdGVycy9vYnNpZGlhbi1zdG9yYWdlLmpzJztcbmltcG9ydCB7IE9ic2lkaWFuV2F0Y2hBZGFwdGVyLCBSZXNjYW5TY2hlZHVsZXIgfSBmcm9tICcuL2FkYXB0ZXJzL29ic2lkaWFuLXdhdGNoLmpzJztcbmltcG9ydCB7IEh0dHBCbG9iU3RvcmUgfSBmcm9tICcuL2Jsb2JzdG9yZS5qcyc7XG5pbXBvcnQge1xuICBidWlsZERpYWdub3N0aWNzQnVuZGxlLFxuICBjb3B5VG9DbGlwYm9hcmQsXG4gIGNyZWF0ZVBsdWdpbkxvZyxcbiAgcGxhdGZvcm1TdW1tYXJ5LFxuICB3aXRoUm91bmRUcmlwTG9nZ2luZyxcbiAgdHlwZSBQbHVnaW5Mb2csXG59IGZyb20gJy4vZGlhZ25vc3RpY3MuanMnO1xuaW1wb3J0IHtcbiAgZGVmYXVsdERldmljZU5hbWUsXG4gIGRldGVjdERldmljZVR5cGUsXG4gIGlzTGlua2VkLFxuICBub3JtYWxpemVQbHVnaW5EYXRhLFxuICBwYXJzZUlnbm9yZVBhdHRlcm5zLFxuICBkZWZhdWx0UGx1Z2luRGF0YSxcbiAgdHlwZSBMb2dMZXZlbCxcbiAgdHlwZSBWYXVsdFN5bmNQbHVnaW5EYXRhLFxufSBmcm9tICcuL2RhdGEuanMnO1xuaW1wb3J0IHsgcGFpck91dGNvbWVNZXNzYWdlLCBwYWlyV2l0aFdvcmtlciB9IGZyb20gJy4vcGFpcmluZy5qcyc7XG5pbXBvcnQgdHlwZSB7IFBhaXJPdXRjb21lIH0gZnJvbSAnLi9wYWlyaW5nLmpzJztcbmltcG9ydCB7IHJlZ2lzdGVyUGFpclByb3RvY29sSGFuZGxlciB9IGZyb20gJy4vcHJvdG9jb2wtaGFuZGxlci5qcyc7XG5pbXBvcnQgeyBSZWNvbm5lY3RTdXBlcnZpc29yIH0gZnJvbSAnLi9yZWNvbm5lY3QuanMnO1xuaW1wb3J0IHR5cGUgeyBCYWNrb2ZmT3B0aW9ucyB9IGZyb20gJy4vcmVjb25uZWN0LmpzJztcbmltcG9ydCB0eXBlIHsgU3RhdHVzQmFyTW9kZSB9IGZyb20gJy4vc3RhdHVzYmFyLmpzJztcbmltcG9ydCB7IFZhdWx0U3luY1NldHRpbmdUYWIgfSBmcm9tICcuL3NldHRpbmdzLmpzJztcbmltcG9ydCB7IFN0YXR1c0JhckluZGljYXRvciB9IGZyb20gJy4vc3RhdHVzYmFyLmpzJztcbmltcG9ydCB7IFdlYlNvY2tldFRyYW5zcG9ydCB9IGZyb20gJy4vdHJhbnNwb3J0LmpzJztcbmltcG9ydCB0eXBlIHsgV2ViU29ja2V0RmFjdG9yeSB9IGZyb20gJy4vdHJhbnNwb3J0LmpzJztcbmltcG9ydCB7IGZldGNoV29ya2VyU3RhdHVzLCBub3JtYWxpemVXb3JrZXJVcmwsIHJlbmFtZURldmljZSB9IGZyb20gJy4vd29ya2VyYXBpLmpzJztcbmltcG9ydCB0eXBlIHsgV29ya2VyU3RhdHVzU3VtbWFyeSB9IGZyb20gJy4vd29ya2VyYXBpLmpzJztcblxuLyoqIFRoZSBpbi12YXVsdCBkZXZpY2UgbWFya2VyIHNoYXJlZCB3aXRoIHRoZSBkYWVtb24vQ0xJIChGUi00NCBoYW5kc2hha2UpLiAqL1xuY29uc3QgREVWSUNFX01BUktFUl9WQVVMVF9QQVRIID0gJy8udmF1bHRzeW5jZm9yYWdlbnRzL2RldmljZS5qc29uJztcbmNvbnN0IExPQ0FMX0lOREVYX1ZBVUxUX1BBVEggPSAnLy52YXVsdHN5bmNmb3JhZ2VudHMvc3RhdGUnO1xuY29uc3QgU1VQRVJWSVNJT05fVElDS19NUyA9IDEwMDA7XG5cbi8qKiBUaW1lciBoYW5kbGVzIChudW1iZXIgaW4gdGhlIERPTSwgYFRpbWVvdXRgIHdoZW4gTm9kZSB0eXBlcyBsZWFrIGluKS4gKi9cbnR5cGUgVGltZXJIYW5kbGUgPSBSZXR1cm5UeXBlPHR5cGVvZiBzZXRJbnRlcnZhbD47XG5cbi8qKiBJbmplY3RhYmxlIHNlYW1zIHNvIHVuaXQgdGVzdHMgbmVlZCBubyByZWFsIE9ic2lkaWFuL25ldHdvcmsuICovXG5leHBvcnQgaW50ZXJmYWNlIFBsdWdpbk92ZXJyaWRlcyB7XG4gIGZldGNoSW1wbD86IHR5cGVvZiBmZXRjaDtcbiAgd3NGYWN0b3J5PzogV2ViU29ja2V0RmFjdG9yeTtcbiAgbm93PzogKCkgPT4gbnVtYmVyO1xuICAvKiogUmVjb25uZWN0IGJhY2tvZmYga25vYnMgKHRlc3RzIGluamVjdCBhIGRldGVybWluaXN0aWMgcmFuZG9tKS4gKi9cbiAgcmVjb25uZWN0PzogQmFja29mZk9wdGlvbnM7XG59XG5cbmV4cG9ydCBjbGFzcyBWYXVsdFN5bmNQbHVnaW4gZXh0ZW5kcyBQbHVnaW4ge1xuICBkYXRhOiBWYXVsdFN5bmNQbHVnaW5EYXRhID0gZGVmYXVsdFBsdWdpbkRhdGEoKTtcbiAgLyoqIFRoZSBsaXZlIHN5bmMgY2xpZW50IChudWxsIHdoaWxlIHVubGlua2VkL3N0b3BwZWQpLiAqL1xuICBjbGllbnQ6IFN5bmNDbGllbnQgfCBudWxsID0gbnVsbDtcblxuICBwcml2YXRlIHJlYWRvbmx5IG92ZXJyaWRlczogUGx1Z2luT3ZlcnJpZGVzO1xuICBwcml2YXRlIHdhdGNoZXI6IE9ic2lkaWFuV2F0Y2hBZGFwdGVyIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgcmVzY2FuOiBSZXNjYW5TY2hlZHVsZXIgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBzdGF0dXNCYXI6IFN0YXR1c0JhckluZGljYXRvciB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHN0YXR1c0Jhckl0ZW06IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgdGlja0hhbmRsZTogVGltZXJIYW5kbGUgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSByZWNvbm5lY3RUaW1lcjogVGltZXJIYW5kbGUgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBzdXBlcnZpc29yID0gbmV3IFJlY29ubmVjdFN1cGVydmlzb3IoKTtcbiAgLyoqIFNldCB3aGVuIHRoZSB3b3JrZXIgcmVqZWN0ZWQgdGhlIHRva2VuIFx1MjAxNCByZWNvbm5lY3RpbmcgY2Fubm90IGhlbHAuICovXG4gIHByaXZhdGUgYXV0aEZhaWxlZCA9IGZhbHNlO1xuICBwcml2YXRlIHN0YXR1c05vdGUgPSAnJztcbiAgLyoqIFBhdXNlLXN5bmNpbmcgc3RhdGUgKHJ1bnRpbWUgb25seSBcdTIwMTQgYSByZWxvYWQgc3RhcnRzIHBlciBzeW5jT25TdGFydHVwKS4gKi9cbiAgcHJpdmF0ZSBwYXVzZWQgPSBmYWxzZTtcbiAgLyoqIFRoZSBwbHVnaW4ncyBsb2c6IGNvbnNvbGUgbWlycm9yICsgYm91bmRlZCByaW5nIChDb3B5IGRpYWdub3N0aWNzKS4gKi9cbiAgcHJpdmF0ZSByZWFkb25seSBzeW5jTG9nOiBQbHVnaW5Mb2cgPSBjcmVhdGVQbHVnaW5Mb2coKTtcblxuICBjb25zdHJ1Y3RvcihhcHA6IEFwcCwgbWFuaWZlc3Q6IFBsdWdpbk1hbmlmZXN0LCBvdmVycmlkZXM6IFBsdWdpbk92ZXJyaWRlcyA9IHt9KSB7XG4gICAgc3VwZXIoYXBwLCBtYW5pZmVzdCk7XG4gICAgdGhpcy5vdmVycmlkZXMgPSBvdmVycmlkZXM7XG4gIH1cblxuICBwcml2YXRlIGdldCBub3coKTogKCkgPT4gbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy5vdmVycmlkZXMubm93ID8/ICgoKSA9PiBEYXRlLm5vdygpKTtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0IGZldGNoSW1wbCgpOiB0eXBlb2YgZmV0Y2gge1xuICAgIC8vIEJpbmQgYXQgdGhlIHNlYW06IGNvbnN1bWVycyAocGFpcmluZywgYEh0dHBCbG9iU3RvcmVgKSBpbnZva2UgdGhpcyBhcyBhXG4gICAgLy8gZGV0YWNoZWQgZnVuY3Rpb24sIGFuZCBhIGRldGFjaGVkIGBmZXRjaGAgdGhyb3dzXG4gICAgLy8gYFR5cGVFcnJvcjogRmFpbGVkIHRvIGV4ZWN1dGUgJ2ZldGNoJyBvbiAnV2luZG93JzogSWxsZWdhbCBpbnZvY2F0aW9uYFxuICAgIC8vIGluIENocm9taXVtIHJlbmRlcmVycyBcdTIwMTQgaS5lLiBpbiByZWFsIE9ic2lkaWFuIChkZXNrdG9wIGFuZCBtb2JpbGUpLlxuICAgIC8vIEJpbmRpbmcgdG8gdGhlIGdsb2JhbCBtYWtlcyB0aGUgZGVmYXVsdCBzYWZlIHRvIGNhbGwgYmFyZS5cbiAgICByZXR1cm4gdGhpcy5vdmVycmlkZXMuZmV0Y2hJbXBsID8/IGdsb2JhbFRoaXMuZmV0Y2guYmluZChnbG9iYWxUaGlzKTtcbiAgfVxuXG4gIGdldCBsaW5rZWQoKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGlzTGlua2VkKHRoaXMuZGF0YSk7XG4gIH1cblxuICBvdmVycmlkZSBhc3luYyBvbmxvYWQoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5kYXRhID0gbm9ybWFsaXplUGx1Z2luRGF0YShhd2FpdCB0aGlzLmxvYWREYXRhKCkpO1xuICAgIHRoaXMuc3luY0xvZy5zZXRMZXZlbCh0aGlzLmRhdGEuc2V0dGluZ3MubG9nTGV2ZWwpO1xuICAgIHRoaXMuYWRkU2V0dGluZ1RhYihuZXcgVmF1bHRTeW5jU2V0dGluZ1RhYih0aGlzLmFwcCwgdGhpcykpO1xuICAgIHJlZ2lzdGVyUGFpclByb3RvY29sSGFuZGxlcihcbiAgICAgIChhY3Rpb24sIGhhbmRsZXIpID0+IHRoaXMucmVnaXN0ZXJPYnNpZGlhblByb3RvY29sSGFuZGxlcihhY3Rpb24sIGhhbmRsZXIpLFxuICAgICAgKGxpbmspID0+IHRoaXMuaGFuZGxlUGFpckRlZXBMaW5rKGxpbmsudXJsLCBsaW5rLmNvZGUpLFxuICAgICk7XG4gICAgLy8gQ2hlYXAgZm9jdXMtZHJpdmVuIHJlc2NhbiAoRlItMTIpOiBldmVyeSBub3RlL2FwcCBzd2l0Y2ggcG9rZXMgdGhlXG4gICAgLy8gc2NoZWR1bGVyLCB3aGljaCBjb2FsZXNjZXMgaW50byBhdCBtb3N0IG9uZSBjeWNsZSBwZXIgZGVib3VuY2Ugd2luZG93LlxuICAgIHRoaXMucmVnaXN0ZXJFdmVudCh0aGlzLmFwcC53b3Jrc3BhY2Uub24oJ2FjdGl2ZS1sZWFmLWNoYW5nZScsICgpID0+IHRoaXMucmVzY2FuPy5wb2tlKCkpKTtcbiAgICAvLyBcIlN5bmMgb24gc3RhcnR1cFwiIE9GRiA9IG1hbnVhbC1vbmx5IG1vZGU6IGxvYWQgaWRsZTsgdGhlIGZpcnN0IFwiU3luY1xuICAgIC8vIG5vd1wiIHN0YXJ0cyB0aGUgbWFjaGluZXJ5ICh3YXRjaGVyIGluY2x1ZGVkKS5cbiAgICBpZiAodGhpcy5saW5rZWQgJiYgdGhpcy5kYXRhLnNldHRpbmdzLnN5bmNPblN0YXJ0dXApIGF3YWl0IHRoaXMuc3RhcnRTeW5jKCk7XG4gIH1cblxuICBvdmVycmlkZSBvbnVubG9hZCgpOiB2b2lkIHtcbiAgICB0aGlzLnN0b3BTeW5jKCk7XG4gIH1cblxuICAvLyAtLS0gcGVyc2lzdGVuY2UgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICBhc3luYyBzYXZlUGx1Z2luRGF0YSgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLnNhdmVEYXRhKHRoaXMuZGF0YSk7XG4gIH1cblxuICAvLyAtLS0gcGFpcmluZyAoc2V0dGluZ3MgdGFiICsgZGVlcCBsaW5rKSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIC8qKiBQYWlyIGZyb20gdGhlIHNldHRpbmdzIGZvcm0gKGZpZWxkcyBhbHJlYWR5IGxpdmUgaW4gYHRoaXMuZGF0YWApLiAqL1xuICBhc3luYyBwYWlyRnJvbVNldHRpbmdzKGNvZGU6IHN0cmluZyk6IFByb21pc2U8UGFpck91dGNvbWU+IHtcbiAgICBjb25zdCBkZXZpY2VOYW1lID0gdGhpcy5yZXNvbHZlRGV2aWNlTmFtZSgpO1xuICAgIGNvbnN0IG91dGNvbWUgPSBhd2FpdCBwYWlyV2l0aFdvcmtlcih7XG4gICAgICB1cmw6IHRoaXMuZGF0YS51cmwsXG4gICAgICBjb2RlLFxuICAgICAgZGV2aWNlTmFtZSxcbiAgICAgIGRldmljZVR5cGU6IGRldGVjdERldmljZVR5cGUoKSxcbiAgICAgIGZldGNoSW1wbDogdGhpcy5mZXRjaEltcGwsXG4gICAgfSk7XG4gICAgYXdhaXQgdGhpcy5hcHBseVBhaXJPdXRjb21lKG91dGNvbWUsIGRldmljZU5hbWUpO1xuICAgIHJldHVybiBvdXRjb21lO1xuICB9XG5cbiAgLyoqIG9ic2lkaWFuOi8vdmF1bHRzeW5jZm9yYWdlbnRzL3BhaXI/dXJsPVx1MjAyNiZjb2RlPVx1MjAyNiAocHJvdG9jb2wtaGFuZGxlci50cykuICovXG4gIHByaXZhdGUgYXN5bmMgaGFuZGxlUGFpckRlZXBMaW5rKHVybDogc3RyaW5nLCBjb2RlOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAodGhpcy5saW5rZWQpIHtcbiAgICAgIGlmIChub3JtYWxpemVXb3JrZXJVcmxTYWZlKHVybCkgPT09IG5vcm1hbGl6ZVdvcmtlclVybFNhZmUodGhpcy5kYXRhLnVybCkpIHtcbiAgICAgICAgbmV3IE5vdGljZSgnVmF1bHRTeW5jOiB0aGlzIHZhdWx0IGlzIGFscmVhZHkgcGFpcmVkIHdpdGggdGhhdCB3b3JrZXIuJyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBuZXcgTm90aWNlKFxuICAgICAgICAgICdWYXVsdFN5bmM6IHRoaXMgdmF1bHQgaXMgcGFpcmVkIHdpdGggYSBkaWZmZXJlbnQgd29ya2VyLiBVbmxpbmsgaXQgaW4gc2V0dGluZ3MgZmlyc3QuJyxcbiAgICAgICAgICAxMDAwMCxcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgZGV2aWNlTmFtZSA9IHRoaXMucmVzb2x2ZURldmljZU5hbWUoKTtcbiAgICBjb25zdCBvdXRjb21lID0gYXdhaXQgcGFpcldpdGhXb3JrZXIoe1xuICAgICAgdXJsLFxuICAgICAgY29kZSxcbiAgICAgIGRldmljZU5hbWUsXG4gICAgICBkZXZpY2VUeXBlOiBkZXRlY3REZXZpY2VUeXBlKCksXG4gICAgICBmZXRjaEltcGw6IHRoaXMuZmV0Y2hJbXBsLFxuICAgIH0pO1xuICAgIGF3YWl0IHRoaXMuYXBwbHlQYWlyT3V0Y29tZShvdXRjb21lLCBkZXZpY2VOYW1lKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgYXBwbHlQYWlyT3V0Y29tZShvdXRjb21lOiBQYWlyT3V0Y29tZSwgZGV2aWNlTmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKG91dGNvbWUuc3RhdHVzICE9PSAncGFpcmVkJykge1xuICAgICAgbmV3IE5vdGljZShwYWlyT3V0Y29tZU1lc3NhZ2Uob3V0Y29tZSksIDEwMDAwKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5kYXRhLnVybCA9IG91dGNvbWUudXJsO1xuICAgIHRoaXMuZGF0YS50b2tlbiA9IG91dGNvbWUudG9rZW47XG4gICAgdGhpcy5kYXRhLmRldmljZUlkID0gb3V0Y29tZS5kZXZpY2VJZDtcbiAgICB0aGlzLmRhdGEuZGV2aWNlTmFtZSA9IGRldmljZU5hbWU7XG4gICAgYXdhaXQgdGhpcy5zYXZlUGx1Z2luRGF0YSgpO1xuICAgIGF3YWl0IHRoaXMud3JpdGVEZXZpY2VNYXJrZXIoKTtcbiAgICBuZXcgTm90aWNlKHBhaXJPdXRjb21lTWVzc2FnZShvdXRjb21lKSk7XG4gICAgYXdhaXQgdGhpcy5zdGFydFN5bmMoKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVzb2x2ZURldmljZU5hbWUoKTogc3RyaW5nIHtcbiAgICBjb25zdCB0eXBlZCA9IHRoaXMuZGF0YS5kZXZpY2VOYW1lLnRyaW0oKTtcbiAgICByZXR1cm4gdHlwZWQgIT09ICcnID8gdHlwZWQgOiBkZWZhdWx0RGV2aWNlTmFtZSgpO1xuICB9XG5cbiAgLyoqIFdyaXRlIHRoZSBGUi00NCBtYXJrZXIgdGhlIENMSS9kYWVtb24gcmVhZCB0byBkZXRlY3QgZG91YmxlLWNsaWVudHMuICovXG4gIHByaXZhdGUgYXN5bmMgd3JpdGVEZXZpY2VNYXJrZXIoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCF0aGlzLmxpbmtlZCkgcmV0dXJuO1xuICAgIGNvbnN0IHN0b3JhZ2UgPSBuZXcgT2JzaWRpYW5TdG9yYWdlQWRhcHRlcih7IGFkYXB0ZXI6IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIgfSk7XG4gICAgY29uc3QgbWFya2VyID0ge1xuICAgICAgZGV2aWNlSWQ6IHRoaXMuZGF0YS5kZXZpY2VJZCxcbiAgICAgIGRldmljZU5hbWU6IHRoaXMucmVzb2x2ZURldmljZU5hbWUoKSxcbiAgICAgIHVybDogdGhpcy5kYXRhLnVybCxcbiAgICAgIGxpbmtlZEF0OiB0aGlzLm5vdygpLFxuICAgIH07XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHN0b3JhZ2Uud3JpdGVGaWxlKFxuICAgICAgICBERVZJQ0VfTUFSS0VSX1ZBVUxUX1BBVEgsXG4gICAgICAgIG5ldyBUZXh0RW5jb2RlcigpLmVuY29kZShgJHtKU09OLnN0cmluZ2lmeShtYXJrZXIsIG51bGwsIDIpfVxcbmApLFxuICAgICAgKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5zeW5jTG9nLndhcm4oJ2ZhaWxlZCB0byB3cml0ZSBkZXZpY2UgbWFya2VyJywgZXJyb3IpO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBgUEFUQ0ggL2RldmljZWAgXHUyMDE0IHJlbmFtZSBUSElTIGRldmljZSBvbiB0aGUgd29ya2VyICh0aGUgc2V0dGluZ3MgdGFiJ3NcbiAgICogUmVuYW1lIGJ1dHRvbikuIFVwZGF0ZXMgcGx1Z2luIGRhdGEgKyB0aGUgaW4tdmF1bHQgZGV2aWNlIG1hcmtlciAod2hpY2hcbiAgICogc3RvcmVzIHRoZSBuYW1lIGZvciB0aGUgRlItNDQgZG91YmxlLWNsaWVudCB3YXJuaW5nKS4gTG9jYWwgc3RhdGUga2VlcHNcbiAgICogaXRzIHByZXZpb3VzIG5hbWUgb24gZmFpbHVyZS5cbiAgICovXG4gIGFzeW5jIHJlbmFtZURldmljZShuYW1lOiBzdHJpbmcpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBpZiAoIXRoaXMubGlua2VkKSB7XG4gICAgICBuZXcgTm90aWNlKCdWYXVsdFN5bmM6IHBhaXIgdGhpcyB2YXVsdCBmaXJzdCBcdTIwMTQgdGhlIG5hbWUgYXBwbGllcyBhdCBwYWlyaW5nIHRpbWUuJyk7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICAgIGNvbnN0IHRyaW1tZWQgPSBuYW1lLnRyaW0oKTtcbiAgICBpZiAodHJpbW1lZCA9PT0gJycgfHwgdHJpbW1lZC5sZW5ndGggPiAzMCB8fCAvW1xcdTAwMDAtXFx1MDAxZlxcdTAwN2ZdLy50ZXN0KHRyaW1tZWQpKSB7XG4gICAgICBuZXcgTm90aWNlKCdWYXVsdFN5bmM6IGRldmljZSBuYW1lIG11c3QgYmUgMS0zMCBjaGFyYWN0ZXJzLCB3aXRob3V0IGNvbnRyb2wgY2hhcmFjdGVycy4nLCA4MDAwKTtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgY29uc3Qgb3V0Y29tZSA9IGF3YWl0IHJlbmFtZURldmljZSh7XG4gICAgICBvcmlnaW46IHRoaXMuZGF0YS51cmwsXG4gICAgICB0b2tlbjogdGhpcy5kYXRhLnRva2VuLFxuICAgICAgbmFtZTogdHJpbW1lZCxcbiAgICAgIGZldGNoSW1wbDogdGhpcy5mZXRjaEltcGwsXG4gICAgfSk7XG4gICAgaWYgKCFvdXRjb21lLm9rKSB7XG4gICAgICBuZXcgTm90aWNlKGBWYXVsdFN5bmM6IHJlbmFtaW5nIGZhaWxlZCBcdTIwMTQgJHtvdXRjb21lLmVycm9yfWAsIDEwMDAwKTtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gICAgdGhpcy5kYXRhLmRldmljZU5hbWUgPSBvdXRjb21lLmRldmljZS5uYW1lO1xuICAgIGF3YWl0IHRoaXMuc2F2ZVBsdWdpbkRhdGEoKTtcbiAgICBhd2FpdCB0aGlzLndyaXRlRGV2aWNlTWFya2VyKCk7XG4gICAgbmV3IE5vdGljZShgVmF1bHRTeW5jOiBkZXZpY2UgcmVuYW1lZCB0byBcdTIwMUMke291dGNvbWUuZGV2aWNlLm5hbWV9XHUyMDFELmApO1xuICAgIHJldHVybiB0cnVlO1xuICB9XG5cbiAgLy8gLS0tIHN5bmMgbGlmZWN5Y2xlIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIC8qKiBCdWlsZCBldmVyeXRoaW5nIGFuZCBydW4gc3RhcnR1cCByZWNvbmNpbGlhdGlvbiAoaWRlbXBvdGVudCByZXN0YXJ0KS4gKi9cbiAgcHJpdmF0ZSBhc3luYyBzdGFydFN5bmMoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCF0aGlzLmxpbmtlZCkgcmV0dXJuO1xuICAgIHRoaXMuc3RvcFN5bmMoKTtcblxuICAgIGNvbnN0IHsgdXJsLCB0b2tlbiwgZGV2aWNlSWQgfSA9IHRoaXMuZGF0YTtcbiAgICBjb25zdCBkZXZpY2VOYW1lID0gdGhpcy5yZXNvbHZlRGV2aWNlTmFtZSgpO1xuICAgIGNvbnN0IHN0b3JhZ2UgPSBuZXcgT2JzaWRpYW5TdG9yYWdlQWRhcHRlcih7IGFkYXB0ZXI6IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIgfSk7XG4gICAgYXdhaXQgdGhpcy53YXJuSWZGb3JlaWduU3RhdGVEaXIoc3RvcmFnZSk7XG5cbiAgICBjb25zdCBjbGllbnQgPSBuZXcgU3luY0NsaWVudCh7XG4gICAgICBkZXZpY2VJZCxcbiAgICAgIGRldmljZU5hbWUsXG4gICAgICB0b2tlbixcbiAgICAgIHRyYW5zcG9ydDogKCkgPT5cbiAgICAgICAgd2l0aFJvdW5kVHJpcExvZ2dpbmcoXG4gICAgICAgICAgbmV3IFdlYlNvY2tldFRyYW5zcG9ydCh7IHVybCwgdG9rZW4sIHdzRmFjdG9yeTogdGhpcy5vdmVycmlkZXMud3NGYWN0b3J5IH0pLFxuICAgICAgICAgIHsgbG9nOiB0aGlzLnN5bmNMb2csIHNob3VsZExvZzogKCkgPT4gdGhpcy5zeW5jTG9nLmRlYnVnRW5hYmxlZCB9LFxuICAgICAgICApLFxuICAgICAgYmxvYlN0b3JlOiBuZXcgSHR0cEJsb2JTdG9yZSh7IGJhc2VVcmw6IHVybCwgdG9rZW4sIGZldGNoSW1wbDogdGhpcy5mZXRjaEltcGwgfSksXG4gICAgICBzdG9yYWdlLFxuICAgICAgc2V0dGluZ3M6IHtcbiAgICAgICAgb2JzaWRpYW5TeW5jOiB0aGlzLmRhdGEuc2V0dGluZ3Mub2JzaWRpYW5TeW5jLFxuICAgICAgICBleHRyYUlnbm9yZXM6IHBhcnNlSWdub3JlUGF0dGVybnModGhpcy5kYXRhLnNldHRpbmdzLmlnbm9yZVBhdHRlcm5zKSxcbiAgICAgIH0sXG4gICAgICBsb2c6IHRoaXMuc3luY0xvZyxcbiAgICAgIG5vdzogdGhpcy5ub3csXG4gICAgfSk7XG4gICAgdGhpcy5jbGllbnQgPSBjbGllbnQ7XG4gICAgdGhpcy5hdXRoRmFpbGVkID0gZmFsc2U7XG4gICAgdGhpcy5zdGF0dXNOb3RlID0gJyc7XG4gICAgdGhpcy5zdXBlcnZpc29yID0gbmV3IFJlY29ubmVjdFN1cGVydmlzb3IodGhpcy5vdmVycmlkZXMucmVjb25uZWN0ID8/IHt9KTtcblxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBjbGllbnQuY29ubmVjdCgpOyAvLyBzdGFydHVwIHJlY29uY2lsaWF0aW9uIFx1MjE5MiBsaXZlIG1vZGVcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5oYW5kbGVTeW5jRXJyb3IoZXJyb3IsICdzdGFydHVwIHN5bmMgZmFpbGVkJyk7XG4gICAgfVxuXG4gICAgLy8gTGl2ZSB3YXRjaGluZzogdmF1bHQgZXZlbnRzIChkZWJvdW5jZWQgaW4gY29yZSkgKyByZXNjYW4gaG9va3MuXG4gICAgdGhpcy53YXRjaGVyID0gbmV3IE9ic2lkaWFuV2F0Y2hBZGFwdGVyKHsgdmF1bHQ6IHRoaXMuYXBwLnZhdWx0IH0pO1xuICAgIGNsaWVudC5zdGFydFdhdGNoaW5nKHRoaXMud2F0Y2hlcik7XG4gICAgdGhpcy5yZXNjYW4gPSBuZXcgUmVzY2FuU2NoZWR1bGVyKHtcbiAgICAgIGludGVydmFsTXM6IHRoaXMuZGF0YS5zZXR0aW5ncy5yZXNjYW5JbnRlcnZhbFNlYyAqIDEwMDAsXG4gICAgfSk7XG4gICAgdGhpcy5yZXNjYW4uc3RhcnQoKCkgPT4ge1xuICAgICAgdm9pZCBjbGllbnQudHJpZ2dlclN5bmMoKS5jYXRjaCgoZXJyb3I6IHVua25vd24pID0+IHtcbiAgICAgICAgdGhpcy5oYW5kbGVTeW5jRXJyb3IoZXJyb3IsICdyZXNjYW4gZmFpbGVkJyk7XG4gICAgICB9KTtcbiAgICB9KTtcblxuICAgIC8vIFN0YXR1cyBiYXIgKHBlciB0aGUgc3RhdHVzQmFyTW9kZSBzZXR0aW5nKSArIHRoZSAxIEh6IHN1cGVydmlzaW9uIHRpY2tcbiAgICAvLyB0aGF0IHJlcGFpbnRzIGl0IGFuZCBzdXBlcnZpc2VzIHJlY29ubmVjdGlvbi5cbiAgICB0aGlzLm1vdW50U3RhdHVzQmFyKCk7XG4gICAgY29uc3QgdGljayA9IHNldEludGVydmFsKCgpID0+IHRoaXMub25UaWNrKCksIFNVUEVSVklTSU9OX1RJQ0tfTVMpO1xuICAgIHRoaXMudGlja0hhbmRsZSA9IHRpY2s7XG4gICAgdGhpcy5yZWdpc3RlckludGVydmFsKHRpY2sgYXMgdW5rbm93biBhcyBudW1iZXIpOyAvLyBPYnNpZGlhbiBjbGVhcnMgdGhpcyBvbiB1bmxvYWRcbiAgICB0aGlzLm9uVGljaygpO1xuICB9XG5cbiAgLyoqIChSZSltb3VudCB0aGUgc3RhdHVzLWJhciBpdGVtIHBlciB0aGUgY3VycmVudCBtb2RlICgnaGlkZGVuJyA9IG5vbmUpLiAqL1xuICBwcml2YXRlIG1vdW50U3RhdHVzQmFyKCk6IHZvaWQge1xuICAgIHRoaXMuc3RhdHVzQmFySXRlbT8ucmVtb3ZlKCk7XG4gICAgdGhpcy5zdGF0dXNCYXJJdGVtID0gbnVsbDtcbiAgICB0aGlzLnN0YXR1c0JhciA9IG51bGw7XG4gICAgaWYgKHRoaXMuY2xpZW50ID09PSBudWxsKSByZXR1cm47XG4gICAgaWYgKHRoaXMuZGF0YS5zZXR0aW5ncy5zdGF0dXNCYXJNb2RlID09PSAnaGlkZGVuJykgcmV0dXJuO1xuICAgIGNvbnN0IGl0ZW0gPSB0aGlzLmFkZFN0YXR1c0Jhckl0ZW0oKTtcbiAgICB0aGlzLnN0YXR1c0Jhckl0ZW0gPSBpdGVtO1xuICAgIHRoaXMuc3RhdHVzQmFyID0gbmV3IFN0YXR1c0JhckluZGljYXRvcihpdGVtKTtcbiAgfVxuXG4gIC8qKiBUZWFyIGRvd24gZXZlcnkgdGltZXIsIHdhdGNoZXIsIHNvY2tldCwgYW5kIFVJIGFydGlmYWN0LiBJZGVtcG90ZW50LiAqL1xuICBwcml2YXRlIHN0b3BTeW5jKCk6IHZvaWQge1xuICAgIGlmICh0aGlzLnJlY29ubmVjdFRpbWVyICE9PSBudWxsKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGhpcy5yZWNvbm5lY3RUaW1lcik7XG4gICAgICB0aGlzLnJlY29ubmVjdFRpbWVyID0gbnVsbDtcbiAgICB9XG4gICAgaWYgKHRoaXMudGlja0hhbmRsZSAhPT0gbnVsbCkge1xuICAgICAgY2xlYXJJbnRlcnZhbCh0aGlzLnRpY2tIYW5kbGUpO1xuICAgICAgdGhpcy50aWNrSGFuZGxlID0gbnVsbDtcbiAgICB9XG4gICAgdGhpcy5yZXNjYW4/LnN0b3AoKTtcbiAgICB0aGlzLnJlc2NhbiA9IG51bGw7XG4gICAgdGhpcy5jbGllbnQ/LmNsb3NlKCk7IC8vIGFsc28gc3RvcHMgdGhlIHdhdGNoZXJcbiAgICB0aGlzLmNsaWVudCA9IG51bGw7XG4gICAgdGhpcy53YXRjaGVyID0gbnVsbDtcbiAgICB0aGlzLnN0YXR1c0Jhckl0ZW0/LnJlbW92ZSgpO1xuICAgIHRoaXMuc3RhdHVzQmFySXRlbSA9IG51bGw7XG4gICAgdGhpcy5zdGF0dXNCYXIgPSBudWxsO1xuICB9XG5cbiAgLy8gLS0tIHVzZXIgYWN0aW9ucyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgYXN5bmMgc3luY05vdygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAodGhpcy5wYXVzZWQpIHtcbiAgICAgIG5ldyBOb3RpY2UoJ1ZhdWx0U3luYzogc3luY2luZyBpcyBwYXVzZWQgXHUyMDE0IHJlc3VtZSBpdCBpbiBzZXR0aW5ncyBmaXJzdC4nKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgY2xpZW50ID0gdGhpcy5jbGllbnQ7XG4gICAgaWYgKGNsaWVudCA9PT0gbnVsbCkge1xuICAgICAgaWYgKCF0aGlzLmxpbmtlZCkge1xuICAgICAgICBuZXcgTm90aWNlKCdWYXVsdFN5bmM6IG5vdCBwYWlyZWQgeWV0IFx1MjAxNCBhZGQgeW91ciB3b3JrZXIgVVJMIGFuZCBhIHBhaXJpbmcgY29kZSBpbiBzZXR0aW5ncy4nKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgLy8gTWFudWFsLW9ubHkgbW9kZSAoXCJTeW5jIG9uIHN0YXJ0dXBcIiBPRkYpOiB0aGlzIGlzIHRoZSBmaXJzdCBzdGFydC5cbiAgICAgIGF3YWl0IHRoaXMuc3RhcnRTeW5jKCk7XG4gICAgICBjb25zdCBzdGF0dXMgPSB0aGlzLmNsaWVudD8uc3RhdHVzKCk7XG4gICAgICBpZiAoc3RhdHVzICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgbmV3IE5vdGljZShcbiAgICAgICAgICBzdGF0dXMuc3RhdGUgPT09ICdkaXNjb25uZWN0ZWQnXG4gICAgICAgICAgICA/ICdWYXVsdFN5bmM6IG9mZmxpbmUgXHUyMDE0IGNoYW5nZXMgd2lsbCBzeW5jIHdoZW4gdGhlIHdvcmtlciBpcyByZWFjaGFibGUuJ1xuICAgICAgICAgICAgOiAnVmF1bHRTeW5jOiB1cCB0byBkYXRlLicsXG4gICAgICAgICk7XG4gICAgICB9XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBjbGllbnQudHJpZ2dlclN5bmMoKTtcbiAgICAgIGNvbnN0IHN0YXR1cyA9IGNsaWVudC5zdGF0dXMoKTtcbiAgICAgIG5ldyBOb3RpY2UoXG4gICAgICAgIHN0YXR1cy5zdGF0ZSA9PT0gJ2Rpc2Nvbm5lY3RlZCdcbiAgICAgICAgICA/ICdWYXVsdFN5bmM6IG9mZmxpbmUgXHUyMDE0IGNoYW5nZXMgd2lsbCBzeW5jIHdoZW4gdGhlIHdvcmtlciBpcyByZWFjaGFibGUuJ1xuICAgICAgICAgIDogJ1ZhdWx0U3luYzogdXAgdG8gZGF0ZS4nLFxuICAgICAgKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5oYW5kbGVTeW5jRXJyb3IoZXJyb3IsICdzeW5jIG5vdyBmYWlsZWQnKTtcbiAgICAgIG5ldyBOb3RpY2UoJ1ZhdWx0U3luYzogc3luYyBmYWlsZWQgXHUyMDE0IHNlZSB0aGUgZGV2ZWxvcGVyIGNvbnNvbGUgZm9yIGRldGFpbHMuJyk7XG4gICAgfVxuICB9XG5cbiAgLyoqIFBhdXNlOiB0cmFuc3BvcnQgZG93biArIHdhdGNoZXIvcmVzY2FuIGlkbGUsIGxpbmsgYW5kIHN0YXRlIGtlcHQuICovXG4gIHBhdXNlU3luY2luZygpOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMubGlua2VkIHx8IHRoaXMucGF1c2VkKSByZXR1cm47XG4gICAgdGhpcy5wYXVzZWQgPSB0cnVlO1xuICAgIGlmICh0aGlzLnJlY29ubmVjdFRpbWVyICE9PSBudWxsKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGhpcy5yZWNvbm5lY3RUaW1lcik7XG4gICAgICB0aGlzLnJlY29ubmVjdFRpbWVyID0gbnVsbDtcbiAgICB9XG4gICAgdGhpcy5zdXBlcnZpc29yLnNldHRsZWQoKTtcbiAgICB0aGlzLnJlc2Nhbj8uc3RvcCgpO1xuICAgIHRoaXMucmVzY2FuID0gbnVsbDtcbiAgICB0aGlzLmNsaWVudD8uY2xvc2UoKTsgLy8gYWxzbyBzdG9wcyB0aGUgd2F0Y2hlcjsgc3RhdGUgXHUyMTkyIGlkbGVcbiAgICB0aGlzLm9uVGljaygpOyAvLyByZXBhaW50IFwidnNhIFx1MjNGOFwiXG4gICAgbmV3IE5vdGljZSgnVmF1bHRTeW5jOiBwYXVzZWQuIE5ldyBhbmQgY2hhbmdlZCBmaWxlcyBzdGF5IGxvY2FsIHVudGlsIHlvdSByZXN1bWUuJyk7XG4gIH1cblxuICAvKiogUmVzdW1lOiByZWNvbm5lY3QgYW5kIHJ1biBhIGZ1bGwgY2F0Y2gtdXAgY3ljbGUgKHN0YXJ0dXAgcmVjb25jaWxpYXRpb24pLiAqL1xuICBhc3luYyByZXN1bWVTeW5jaW5nKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghdGhpcy5saW5rZWQgfHwgIXRoaXMucGF1c2VkKSByZXR1cm47XG4gICAgdGhpcy5wYXVzZWQgPSBmYWxzZTtcbiAgICBuZXcgTm90aWNlKCdWYXVsdFN5bmM6IHJlc3VtaW5nIFx1MjAxNCBydW5uaW5nIGEgZnVsbCBjYXRjaC11cCBzeW5jXHUyMDI2Jyk7XG4gICAgYXdhaXQgdGhpcy5zdGFydFN5bmMoKTtcbiAgfVxuXG4gIC8qKiBSdW50aW1lIHBhdXNlIHN0YXRlICh0aGUgc2V0dGluZ3MgdGFiJ3MgYnV0dG9uIGxhYmVsICsgZGlhZ25vc3RpY3MpLiAqL1xuICBnZXQgc3luY2luZ1BhdXNlZCgpOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy5wYXVzZWQ7XG4gIH1cblxuICBhc3luYyBhcHBseVJlc2NhbkludGVydmFsKHNlY29uZHM6IG51bWJlcik6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuZGF0YS5zZXR0aW5ncy5yZXNjYW5JbnRlcnZhbFNlYyA9IE1hdGgubWF4KDAsIE1hdGguZmxvb3Ioc2Vjb25kcykpO1xuICAgIGF3YWl0IHRoaXMuc2F2ZVBsdWdpbkRhdGEoKTtcbiAgICB0aGlzLnJlc2Nhbj8uc2V0SW50ZXJ2YWxNcyh0aGlzLmRhdGEuc2V0dGluZ3MucmVzY2FuSW50ZXJ2YWxTZWMgKiAxMDAwKTtcbiAgfVxuXG4gIGFzeW5jIGFwcGx5T2JzaWRpYW5TeW5jKGVuYWJsZWQ6IGJvb2xlYW4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLmRhdGEuc2V0dGluZ3Mub2JzaWRpYW5TeW5jID0gZW5hYmxlZDtcbiAgICBhd2FpdCB0aGlzLnNhdmVQbHVnaW5EYXRhKCk7XG4gICAgbmV3IE5vdGljZShcbiAgICAgIGVuYWJsZWRcbiAgICAgICAgPyAnVmF1bHRTeW5jOiAub2JzaWRpYW4vIHdpbGwgc3luYyBhZnRlciB0aGUgbmV4dCByZWNvbm5lY3QgKHRoZSB3b3JrZXJcXHUyMDE5cyBwZXItdmF1bHQgc2V0dGluZyB0YWtlcyBwcmVjZWRlbmNlKS4nXG4gICAgICAgIDogJ1ZhdWx0U3luYzogLm9ic2lkaWFuLyB3aWxsIGJlIGV4Y2x1ZGVkIGFmdGVyIHRoZSBuZXh0IHJlY29ubmVjdC4nLFxuICAgICk7XG4gIH1cblxuICBhc3luYyBhcHBseVN0YXR1c0Jhck1vZGUobW9kZTogU3RhdHVzQmFyTW9kZSk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuZGF0YS5zZXR0aW5ncy5zdGF0dXNCYXJNb2RlID0gbW9kZTtcbiAgICBhd2FpdCB0aGlzLnNhdmVQbHVnaW5EYXRhKCk7XG4gICAgdGhpcy5tb3VudFN0YXR1c0JhcigpOyAvLyByZS1tb3VudHMgKG9yIHJlbW92ZXMpIHRoZSBpdGVtIHBlciB0aGUgbW9kZVxuICAgIHRoaXMub25UaWNrKCk7XG4gIH1cblxuICBhc3luYyBhcHBseVN5bmNPblN0YXJ0dXAoZW5hYmxlZDogYm9vbGVhbik6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuZGF0YS5zZXR0aW5ncy5zeW5jT25TdGFydHVwID0gZW5hYmxlZDtcbiAgICBhd2FpdCB0aGlzLnNhdmVQbHVnaW5EYXRhKCk7XG4gICAgbmV3IE5vdGljZShcbiAgICAgIGVuYWJsZWRcbiAgICAgICAgPyAnVmF1bHRTeW5jOiBzeW5jaW5nIHdpbGwgc3RhcnQgYXV0b21hdGljYWxseSB0aGUgbmV4dCB0aW1lIE9ic2lkaWFuIG9wZW5zLidcbiAgICAgICAgOiAnVmF1bHRTeW5jOiBvbiB0aGUgbmV4dCBsYXVuY2ggdGhpcyBwbHVnaW4gc3RheXMgaWRsZSB1bnRpbCB5b3UgcHJlc3MgXHUyMDFDU3luYyBub3dcdTIwMUQuJyxcbiAgICApO1xuICB9XG5cbiAgYXN5bmMgYXBwbHlMb2dMZXZlbChsZXZlbDogTG9nTGV2ZWwpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLmRhdGEuc2V0dGluZ3MubG9nTGV2ZWwgPSBsZXZlbDtcbiAgICBhd2FpdCB0aGlzLnNhdmVQbHVnaW5EYXRhKCk7XG4gICAgdGhpcy5zeW5jTG9nLnNldExldmVsKGxldmVsKTtcbiAgfVxuXG4gIC8qKlxuICAgKiBOZXcgaWdub3JlIHBhdHRlcm5zOiBwZXJzaXN0LCB0aGVuIHJlc3RhcnQgdGhlIHN5bmMgbWFjaGluZXJ5IHdoaWxlIGxpdmVcbiAgICogc28gdGhlIHNjYW4vd2F0Y2hlciBwaWNrIHRoZW0gdXAgaW1tZWRpYXRlbHkgKGEgcGF1c2VkIHNlc3Npb24gYXBwbGllc1xuICAgKiB0aGVtIG9uIHJlc3VtZSBcdTIwMTQgcmVzdW1lIGFsd2F5cyByZWJ1aWxkcyB0aGUgY2xpZW50KS5cbiAgICovXG4gIGFzeW5jIGFwcGx5SWdub3JlUGF0dGVybnModGV4dDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5kYXRhLnNldHRpbmdzLmlnbm9yZVBhdHRlcm5zID0gdGV4dDtcbiAgICBhd2FpdCB0aGlzLnNhdmVQbHVnaW5EYXRhKCk7XG4gICAgaWYgKHRoaXMuY2xpZW50ICE9PSBudWxsICYmICF0aGlzLnBhdXNlZCkgYXdhaXQgdGhpcy5zdGFydFN5bmMoKTtcbiAgfVxuXG4gIC8qKiBTdG9yYWdlL2F0dGFjaG1lbnQgc3VtbWFyeSBmb3IgdGhlIEFib3V0IHNlY3Rpb24gKG51bGwgPSB1bmF2YWlsYWJsZSkuICovXG4gIGFzeW5jIGZldGNoU3RvcmFnZVN1bW1hcnkoKTogUHJvbWlzZTxXb3JrZXJTdGF0dXNTdW1tYXJ5IHwgbnVsbD4ge1xuICAgIGlmICghdGhpcy5saW5rZWQpIHJldHVybiBudWxsO1xuICAgIHJldHVybiBmZXRjaFdvcmtlclN0YXR1cyh7XG4gICAgICBvcmlnaW46IHRoaXMuZGF0YS51cmwsXG4gICAgICB0b2tlbjogdGhpcy5kYXRhLnRva2VuLFxuICAgICAgZmV0Y2hJbXBsOiB0aGlzLmZldGNoSW1wbCxcbiAgICB9KTtcbiAgfVxuXG4gIC8qKiBDb3B5IHRoZSBkaWFnbm9zdGljcyBidW5kbGUgdG8gdGhlIGNsaXBib2FyZCAoZmFsbGJhY2s6IGNvbnNvbGUpLiAqL1xuICBhc3luYyBjb3B5RGlhZ25vc3RpY3MoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgYnVuZGxlID0gYnVpbGREaWFnbm9zdGljc0J1bmRsZSh7XG4gICAgICBwbHVnaW5WZXJzaW9uOiB0aGlzLm1hbmlmZXN0LnZlcnNpb24gfHwgJ3Vua25vd24nLFxuICAgICAgZGV2aWNlSWQ6IHRoaXMuZGF0YS5kZXZpY2VJZCxcbiAgICAgIGRldmljZU5hbWU6IHRoaXMucmVzb2x2ZURldmljZU5hbWUoKSxcbiAgICAgIHdvcmtlclVybDogdGhpcy5kYXRhLnVybCxcbiAgICAgIHBhaXJlZDogdGhpcy5saW5rZWQsXG4gICAgICBwYXVzZWQ6IHRoaXMucGF1c2VkLFxuICAgICAgY2xpZW50U3RhdHVzOiB0aGlzLmNsaWVudD8uc3RhdHVzKCkgPz8gbnVsbCxcbiAgICAgIHJlY2VudExvZ0xpbmVzOiB0aGlzLnN5bmNMb2cucmVjZW50TGluZXMoKSxcbiAgICB9KTtcbiAgICBjb25zdCBjb3BpZWQgPSBhd2FpdCBjb3B5VG9DbGlwYm9hcmQoYnVuZGxlKTtcbiAgICBpZiAoY29waWVkKSB7XG4gICAgICBuZXcgTm90aWNlKCdWYXVsdFN5bmM6IGRpYWdub3N0aWNzIGNvcGllZCB0byB0aGUgY2xpcGJvYXJkLicpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zb2xlLmluZm8oJ1t2c2FdIGRpYWdub3N0aWNzIChjbGlwYm9hcmQgdW5hdmFpbGFibGUpOlxcbicgKyBidW5kbGUpO1xuICAgIG5ldyBOb3RpY2UoJ1ZhdWx0U3luYzogY2xpcGJvYXJkIHVuYXZhaWxhYmxlIFx1MjAxNCBkaWFnbm9zdGljcyB3cml0dGVuIHRvIHRoZSBkZXZlbG9wZXIgY29uc29sZS4nLCAxMDAwMCk7XG4gIH1cblxuICAvKiogVGhlIHBsYXRmb3JtIGxpbmUgZm9yIHRoZSBBYm91dC9kaWFnbm9zdGljcyByZWFkb3V0cy4gKi9cbiAgcGxhdGZvcm1TdW1tYXJ5KCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHBsYXRmb3JtU3VtbWFyeSgpO1xuICB9XG5cbiAgYXN5bmMgdW5saW5rKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuc3RvcFN5bmMoKTtcbiAgICB0aGlzLnBhdXNlZCA9IGZhbHNlO1xuICAgIC8vIENsZWFyIGxvY2FsIHN5bmMgc3RhdGUgKGRldmljZSBtYXJrZXIgKyBpbmRleCkgc28gYSBmdXR1cmUgY2xpZW50IFx1MjAxNFxuICAgIC8vIHRoaXMgcGx1Z2luIGFmdGVyIGEgcmUtcGFpciwgdGhlIGRhZW1vbiwgdGhlIENMSSBcdTIwMTQgc3RhcnRzIGNsZWFuXG4gICAgLy8gKEZSLTQ0OiBzdGFsZSBzdGF0ZSB3b3VsZCBtYWtlIGl0IHJlZnVzZSBvciBtaXMtc3luYykuXG4gICAgY29uc3Qgc3RvcmFnZSA9IG5ldyBPYnNpZGlhblN0b3JhZ2VBZGFwdGVyKHsgYWRhcHRlcjogdGhpcy5hcHAudmF1bHQuYWRhcHRlciB9KTtcbiAgICBhd2FpdCBzdG9yYWdlLmRlbGV0ZUZpbGUoREVWSUNFX01BUktFUl9WQVVMVF9QQVRIKTtcbiAgICBhd2FpdCBzdG9yYWdlLmRlbGV0ZUZpbGUoTE9DQUxfSU5ERVhfVkFVTFRfUEFUSCk7XG4gICAgdGhpcy5kYXRhID0ge1xuICAgICAgLi4uZGVmYXVsdFBsdWdpbkRhdGEoKSxcbiAgICAgIGRldmljZU5hbWU6IHRoaXMuZGF0YS5kZXZpY2VOYW1lLFxuICAgICAgc2V0dGluZ3M6IHRoaXMuZGF0YS5zZXR0aW5ncyxcbiAgICB9O1xuICAgIGF3YWl0IHRoaXMuc2F2ZVBsdWdpbkRhdGEoKTtcbiAgICBuZXcgTm90aWNlKFxuICAgICAgJ1ZhdWx0U3luYzogdW5saW5rZWQuIFJldm9rZSB0aGlzIGRldmljZSBmcm9tIHRoZSB3b3JrZXIgZGFzaGJvYXJkIGlmIHlvdSBhcmUgZG9uZSB3aXRoIGl0LicsXG4gICAgKTtcbiAgfVxuXG4gIC8vIC0tLSBzdXBlcnZpc2lvbiAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIHByaXZhdGUgb25UaWNrKCk6IHZvaWQge1xuICAgIGNvbnN0IGNsaWVudCA9IHRoaXMuY2xpZW50O1xuICAgIGlmIChjbGllbnQgPT09IG51bGwpIHJldHVybjtcbiAgICBjb25zdCBzdGF0dXMgPSBjbGllbnQuc3RhdHVzKCk7XG4gICAgdGhpcy5zdGF0dXNCYXI/LnVwZGF0ZShcbiAgICAgIHN0YXR1cyxcbiAgICAgIHtcbiAgICAgICAgdXJsOiB0aGlzLmRhdGEudXJsLFxuICAgICAgICBkZXZpY2VOYW1lOiB0aGlzLnJlc29sdmVEZXZpY2VOYW1lKCksXG4gICAgICAgIG5vdGU6IHRoaXMuc3RhdHVzTm90ZSxcbiAgICAgICAgcGF1c2VkOiB0aGlzLnBhdXNlZCxcbiAgICAgICAgbW9kZTogdGhpcy5kYXRhLnNldHRpbmdzLnN0YXR1c0Jhck1vZGUsXG4gICAgICB9LFxuICAgICAgdGhpcy5ub3coKSxcbiAgICApO1xuICAgIGlmICh0aGlzLnBhdXNlZCB8fCB0aGlzLmF1dGhGYWlsZWQpIHJldHVybjsgLy8gbm8gcmVjb25uZWN0IHdoaWxlIHBhdXNlZCAvIHRva2VuIHJlamVjdGVkXG4gICAgY29uc3QgZGVjaXNpb24gPSB0aGlzLnN1cGVydmlzb3IuY29uc2lkZXIoc3RhdHVzLnN0YXRlKTtcbiAgICBpZiAoZGVjaXNpb24uYWN0aW9uID09PSAnd2FpdCcpIHJldHVybjtcbiAgICB0aGlzLnN1cGVydmlzb3IuYWNrbm93bGVkZ2VkKCk7XG4gICAgdGhpcy5zY2hlZHVsZVJlY29ubmVjdChkZWNpc2lvbi5kZWxheU1zKTtcbiAgfVxuXG4gIHByaXZhdGUgc2NoZWR1bGVSZWNvbm5lY3QoZGVsYXlNczogbnVtYmVyKTogdm9pZCB7XG4gICAgaWYgKHRoaXMucmVjb25uZWN0VGltZXIgIT09IG51bGwpIHJldHVybjsgLy8gb25lIGluIGZsaWdodCwgYWx3YXlzXG4gICAgdGhpcy5yZWNvbm5lY3RUaW1lciA9IHNldFRpbWVvdXQoKCkgPT4ge1xuICAgICAgdGhpcy5yZWNvbm5lY3RUaW1lciA9IG51bGw7XG4gICAgICBjb25zdCBjbGllbnQgPSB0aGlzLmNsaWVudDtcbiAgICAgIGlmIChjbGllbnQgPT09IG51bGwpIHtcbiAgICAgICAgdGhpcy5zdXBlcnZpc29yLnNldHRsZWQoKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgY2xpZW50XG4gICAgICAgIC5yZWNvbm5lY3QoKVxuICAgICAgICAudGhlbihcbiAgICAgICAgICAoKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnN1cGVydmlzb3Iuc2V0dGxlZCgpO1xuICAgICAgICAgIH0sXG4gICAgICAgICAgKGVycm9yOiB1bmtub3duKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnN1cGVydmlzb3Iuc2V0dGxlZCgpO1xuICAgICAgICAgICAgdGhpcy5oYW5kbGVTeW5jRXJyb3IoZXJyb3IsICdyZWNvbm5lY3QgZmFpbGVkJyk7XG4gICAgICAgICAgfSxcbiAgICAgICAgKVxuICAgICAgICAuY2F0Y2goKCkgPT4ge30pOyAvLyBoYW5kbGVTeW5jRXJyb3IgbmV2ZXIgdGhyb3dzOyBiZWx0IGFuZCBicmFjZXNcbiAgICB9LCBkZWxheU1zKTtcbiAgfVxuXG4gIC8qKiBEaXN0aW5ndWlzaCBmYXRhbCBhdXRoIGZhaWx1cmVzIGZyb20gdHJhbnNpZW50IG5ldHdvcmsgdHJvdWJsZS4gKi9cbiAgcHJpdmF0ZSBoYW5kbGVTeW5jRXJyb3IoZXJyb3I6IHVua25vd24sIGNvbnRleHQ6IHN0cmluZyk6IHZvaWQge1xuICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIFJldm9rZWRFcnJvciB8fCBlcnJvciBpbnN0YW5jZW9mIFVuYXV0aG9yaXplZEVycm9yKSB7XG4gICAgICB0aGlzLmF1dGhGYWlsZWQgPSB0cnVlO1xuICAgICAgdGhpcy5zdGF0dXNOb3RlID0gJ0RldmljZSB0b2tlbiByZWplY3RlZCBcdTIwMTQgdW5saW5rIGFuZCByZS1wYWlyIHdpdGggYSBmcmVzaCBjb2RlLic7XG4gICAgICB0aGlzLnN5bmNMb2cuZXJyb3IoY29udGV4dCwgZXJyb3IpO1xuICAgICAgbmV3IE5vdGljZShcbiAgICAgICAgJ1ZhdWx0U3luYzogdGhlIHdvcmtlciByZWplY3RlZCB0aGlzIGRldmljZVxcdTIwMTlzIHRva2VuIChyZXZva2VkPykuIFVubGluayBhbmQgcmUtcGFpciBmcm9tIHNldHRpbmdzLicsXG4gICAgICAgIDEwMDAwLFxuICAgICAgKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5zeW5jTG9nLndhcm4oY29udGV4dCwgZXJyb3IpOyAvLyBvZmZsaW5lL3Byb3RvY29sOiBiYWNrb2ZmIGtlZXBzIHJldHJ5aW5nXG4gIH1cblxuICAvKiogRlItNDQ6IHdhcm4gd2hlbiB0aGUgdmF1bHQncyBzdGF0ZSBkaXIgYmVsb25ncyB0byBhbm90aGVyIGNsaWVudC4gKi9cbiAgcHJpdmF0ZSBhc3luYyB3YXJuSWZGb3JlaWduU3RhdGVEaXIoc3RvcmFnZTogT2JzaWRpYW5TdG9yYWdlQWRhcHRlcik6IFByb21pc2U8dm9pZD4ge1xuICAgIGxldCBtYXJrZXI6IHsgZGV2aWNlSWQ/OiB1bmtub3duOyBkZXZpY2VOYW1lPzogdW5rbm93bjsgdXJsPzogdW5rbm93biB9O1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBieXRlcyA9IGF3YWl0IHN0b3JhZ2UucmVhZEZpbGUoREVWSUNFX01BUktFUl9WQVVMVF9QQVRIKTtcbiAgICAgIG1hcmtlciA9IEpTT04ucGFyc2UobmV3IFRleHREZWNvZGVyKCkuZGVjb2RlKGJ5dGVzKSkgYXMgdHlwZW9mIG1hcmtlcjtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybjsgLy8gbm8gbWFya2VyIChvciB1bnJlYWRhYmxlKSBcdTIwMTQgbm90aGluZyB0byB3YXJuIGFib3V0XG4gICAgfVxuICAgIGlmIChcbiAgICAgIHR5cGVvZiBtYXJrZXIuZGV2aWNlSWQgPT09ICdzdHJpbmcnICYmXG4gICAgICBtYXJrZXIuZGV2aWNlSWQgIT09IHRoaXMuZGF0YS5kZXZpY2VJZFxuICAgICkge1xuICAgICAgY29uc3QgbmFtZSA9IHR5cGVvZiBtYXJrZXIuZGV2aWNlTmFtZSA9PT0gJ3N0cmluZycgPyBtYXJrZXIuZGV2aWNlTmFtZSA6IG1hcmtlci5kZXZpY2VJZDtcbiAgICAgIGNvbnN0IHdoZXJlID0gdHlwZW9mIG1hcmtlci51cmwgPT09ICdzdHJpbmcnID8gbWFya2VyLnVybCA6ICdhIHdvcmtlcic7XG4gICAgICBuZXcgTm90aWNlKFxuICAgICAgICBgVmF1bHRTeW5jOiB0aGlzIHZhdWx0IGFscmVhZHkgaGFzIHN5bmMgc3RhdGUgZm9yIGRldmljZSBcIiR7bmFtZX1cIiAobGlua2VkIHRvICR7d2hlcmV9KS4gYCArXG4gICAgICAgICAgJ09uZSBzeW5jIGNsaWVudCBwZXIgbWFjaGluZSBwZXIgdmF1bHQgXHUyMDE0IHJ1bm5pbmcgdHdvIGRvdWJsZS1jb21taXRzIGV2ZXJ5IGNoYW5nZS4gJyArXG4gICAgICAgICAgJ1VubGluayB0aGUgb3RoZXIgY2xpZW50IChvciBjbGVhciAudmF1bHRzeW5jZm9yYWdlbnRzLykgaWYgdGhpcyBpcyB1bmV4cGVjdGVkLicsXG4gICAgICAgIDE1MDAwLFxuICAgICAgKTtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gbm9ybWFsaXplV29ya2VyVXJsU2FmZShpbnB1dDogc3RyaW5nKTogc3RyaW5nIHtcbiAgdHJ5IHtcbiAgICByZXR1cm4gbm9ybWFsaXplV29ya2VyVXJsKGlucHV0KTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIGlucHV0O1xuICB9XG59XG4iLCAiLyoqXG4gKiBWYXVsdCBwYXRoIHV0aWxpdGllcy5cbiAqXG4gKiBWYXVsdC1pbnRlcm5hbCBwYXRocyBhcmUgUE9TSVgtbm9ybWFsaXplZCBzdHJpbmdzIHJlbGF0aXZlIHRvIHRoZSB2YXVsdCByb290OlxuICogICAtIGFsd2F5cyBzdGFydCB3aXRoIGAvYCAoYC9hL2IubWRgKTsgdGhlIHZhdWx0IHJvb3QgaXRzZWxmIGlzIGAvYFxuICogICAtIHNlZ21lbnRzIHNlcGFyYXRlZCBieSBgL2A7IG5vIHRyYWlsaW5nIHNsYXNoLCBubyBgLmAvYC4uYCBzZWdtZW50cyxcbiAqICAgICBubyBkdXBsaWNhdGUgc2xhc2hlc1xuICogICAtIG5ldmVyIGVzY2FwZSB0aGUgcm9vdDogYW55IGAuLmAgdGhhdCB3b3VsZCBwb3AgYWJvdmUgYC9gIGlzIHJlamVjdGVkXG4gKlxuICogQmFja3NsYXNoZXMgYXJlIGNvbnZlcnRlZCB0byBgL2AgKFdpbmRvd3MgY2FsbGVycyByb3V0aW5lbHkgaGFuZCB1c1xuICogYGRpclxcZmlsZS5tZGApLCBidXQgYWJzb2x1dGUgV2luZG93cyBwYXRocyAoZHJpdmUgbGV0dGVycyBsaWtlIGBDOi9gLCBVTkNcbiAqIGBcXFxcc2VydmVyXFxzaGFyZWApIGFyZSByZWplY3RlZCBcdTIwMTQgYSB2YXVsdCBwYXRoIGlzIG5ldmVyIGFic29sdXRlIGluIHRoZSBob3N0XG4gKiBmaWxlc3lzdGVtIHNlbnNlLlxuICovXG5cbi8qKiBBIHZhdWx0LWludGVybmFsLCBQT1NJWC1ub3JtYWxpemVkIHBhdGggc3RyaW5nIChlLmcuIGAvbm90ZXMvdG9kby5tZGApLiAqL1xuZXhwb3J0IHR5cGUgVmF1bHRQYXRoID0gc3RyaW5nO1xuXG4vKiogVGhyb3duIHdoZW4gYSBwYXRoIGNhbm5vdCBiZSBpbnRlcnByZXRlZCBhcyBhIHZhdWx0LWludGVybmFsIHBhdGguICovXG5leHBvcnQgY2xhc3MgSW52YWxpZFZhdWx0UGF0aEVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBjb25zdHJ1Y3RvcihtZXNzYWdlOiBzdHJpbmcpIHtcbiAgICBzdXBlcihtZXNzYWdlKTtcbiAgICB0aGlzLm5hbWUgPSAnSW52YWxpZFZhdWx0UGF0aEVycm9yJztcbiAgfVxufVxuXG4vKipcbiAqIE5vcm1hbGl6ZSBhIHVzZXItIG9yIHBsYXRmb3JtLXN1cHBsaWVkIHBhdGggaW50byBjYW5vbmljYWwgdmF1bHQgZm9ybS5cbiAqXG4gKiBBY2NlcHRlZDogYGEvYi5tZGAgKHJvb3QtcmVsYXRpdmUgd2l0aG91dCBsZWFkaW5nIHNsYXNoKSwgYC9hL2IubWRgLFxuICogYGFcXGIubWRgIChiYWNrc2xhc2ggY29udmVyc2lvbiksIGBhLy4vYi5tZGAsIGBhL2IvLi4vYy5tZGAgKGludGVyaW9yIGAuLmBcbiAqIHJlc29sdmVzKSwgZHVwbGljYXRlIHNsYXNoZXMsIHRyYWlsaW5nIHNsYXNoZXMuXG4gKlxuICogUmVqZWN0ZWQ6IGAuLmAgZXNjYXBpbmcgdGhlIHJvb3QgKGAvLi4vYWAsIGAvYS8uLi8uLmApLCBhYnNvbHV0ZSBXaW5kb3dzXG4gKiBkcml2ZSBwYXRocyAoYEM6L3ZhdWx0L2EubWRgLCBgQzpcXHZhdWx0XFxhLm1kYCksIFVOQyBwYXRocyAoYFxcXFxzcnZcXHNoYXJlYCksXG4gKiBsZWFkaW5nIGAvL2AsIE5VTCBieXRlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZVZhdWx0UGF0aChpbnB1dDogc3RyaW5nKTogVmF1bHRQYXRoIHtcbiAgaWYgKHR5cGVvZiBpbnB1dCAhPT0gJ3N0cmluZycpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZFZhdWx0UGF0aEVycm9yKGBWYXVsdCBwYXRoIG11c3QgYmUgYSBzdHJpbmcsIGdvdCAke3R5cGVvZiBpbnB1dH1gKTtcbiAgfVxuICBpZiAoaW5wdXQuaW5jbHVkZXMoJ1xcMCcpKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRWYXVsdFBhdGhFcnJvcihgVmF1bHQgcGF0aCBjb250YWlucyBOVUwgYnl0ZTogJHtKU09OLnN0cmluZ2lmeShpbnB1dCl9YCk7XG4gIH1cbiAgaWYgKC9eW2EtekEtWl06Ly50ZXN0KGlucHV0KSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkVmF1bHRQYXRoRXJyb3IoXG4gICAgICBgVmF1bHQgcGF0aCBtdXN0IG5vdCBiZSBhbiBhYnNvbHV0ZSBob3N0IHBhdGggKGRyaXZlIGxldHRlcik6ICR7SlNPTi5zdHJpbmdpZnkoaW5wdXQpfWAsXG4gICAgKTtcbiAgfVxuICBpZiAoaW5wdXQuc3RhcnRzV2l0aCgnXFxcXFxcXFwnKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkVmF1bHRQYXRoRXJyb3IoXG4gICAgICBgVmF1bHQgcGF0aCBtdXN0IG5vdCBiZSBhIFVOQyBwYXRoOiAke0pTT04uc3RyaW5naWZ5KGlucHV0KX1gLFxuICAgICk7XG4gIH1cblxuICBjb25zdCBjb252ZXJ0ZWQgPSBpbnB1dC5yZXBsYWNlKC9cXFxcL2csICcvJyk7XG4gIGlmIChjb252ZXJ0ZWQuc3RhcnRzV2l0aCgnLy8nKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkVmF1bHRQYXRoRXJyb3IoXG4gICAgICBgVmF1bHQgcGF0aCBtdXN0IG5vdCBzdGFydCB3aXRoIFwiLy9cIiAoVU5DIG9yIHByb3RvY29sLXN0eWxlIHBhdGgpOiAke0pTT04uc3RyaW5naWZ5KGlucHV0KX1gLFxuICAgICk7XG4gIH1cblxuICBjb25zdCBzZWdtZW50czogc3RyaW5nW10gPSBbXTtcbiAgZm9yIChjb25zdCBzZWdtZW50IG9mIGNvbnZlcnRlZC5zcGxpdCgnLycpKSB7XG4gICAgaWYgKHNlZ21lbnQgPT09ICcnIHx8IHNlZ21lbnQgPT09ICcuJykgY29udGludWU7XG4gICAgaWYgKHNlZ21lbnQgPT09ICcuLicpIHtcbiAgICAgIGlmIChzZWdtZW50cy5sZW5ndGggPT09IDApIHtcbiAgICAgICAgdGhyb3cgbmV3IEludmFsaWRWYXVsdFBhdGhFcnJvcihcbiAgICAgICAgICBgVmF1bHQgcGF0aCBlc2NhcGVzIHRoZSB2YXVsdCByb290OiAke0pTT04uc3RyaW5naWZ5KGlucHV0KX1gLFxuICAgICAgICApO1xuICAgICAgfVxuICAgICAgc2VnbWVudHMucG9wKCk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgc2VnbWVudHMucHVzaChzZWdtZW50KTtcbiAgfVxuICByZXR1cm4gc2VnbWVudHMubGVuZ3RoID09PSAwID8gJy8nIDogYC8ke3NlZ21lbnRzLmpvaW4oJy8nKX1gO1xufVxuXG4vKipcbiAqIEpvaW4gYSBiYXNlIHZhdWx0IHBhdGggd2l0aCBvbmUgb3IgbW9yZSByZWxhdGl2ZSBwYXRoIHBhcnRzLlxuICpcbiAqIEVhY2ggcGFydCBtdXN0IGJlIHJlbGF0aXZlIChubyBsZWFkaW5nIGAvYCBhZnRlciBiYWNrc2xhc2ggY29udmVyc2lvbikgYW5kXG4gKiBpcyBhcHBlbmRlZCB0byB0aGUgYmFzZSBiZWZvcmUgbm9ybWFsaXphdGlvbjsgYC4uYCBpbnNpZGUgcGFydHMgbWF5IG5vdFxuICogZXNjYXBlIHRoZSByZXN1bHRpbmcgcm9vdC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGpvaW5QYXRoKGJhc2U6IHN0cmluZywgLi4ucGFydHM6IHJlYWRvbmx5IHN0cmluZ1tdKTogVmF1bHRQYXRoIHtcbiAgbGV0IGNvbWJpbmVkID0gbm9ybWFsaXplVmF1bHRQYXRoKGJhc2UpO1xuICBmb3IgKGNvbnN0IHBhcnQgb2YgcGFydHMpIHtcbiAgICBjb25zdCBjb252ZXJ0ZWQgPSBwYXJ0LnJlcGxhY2UoL1xcXFwvZywgJy8nKTtcbiAgICBpZiAoY29udmVydGVkLnN0YXJ0c1dpdGgoJy8nKSkge1xuICAgICAgdGhyb3cgbmV3IEludmFsaWRWYXVsdFBhdGhFcnJvcihcbiAgICAgICAgYGpvaW5QYXRoIHBhcnRzIG11c3QgYmUgcmVsYXRpdmUsIGdvdCAke0pTT04uc3RyaW5naWZ5KHBhcnQpfWAsXG4gICAgICApO1xuICAgIH1cbiAgICBjb21iaW5lZCA9IGAke2NvbWJpbmVkID09PSAnLycgPyAnJyA6IGNvbWJpbmVkfS8ke2NvbnZlcnRlZH1gO1xuICB9XG4gIHJldHVybiBub3JtYWxpemVWYXVsdFBhdGgoY29tYmluZWQpO1xufVxuXG4vKipcbiAqIFBhcmVudCBkaXJlY3Rvcnkgb2YgYSB2YXVsdCBwYXRoLiBUaGUgcGFyZW50IG9mIGAvYCBpcyBgL2AgKHRoZSByb290IGhhcyBub1xuICogcGFyZW50IGFib3ZlIGl0KTsgd2FsayBgd2hpbGUgKHAgIT09IHBhcmVudFBhdGgocCkpYCBzdHlsZSBsb29wcyB0ZXJtaW5hdGUuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJlbnRQYXRoKHBhdGg6IHN0cmluZyk6IFZhdWx0UGF0aCB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVWYXVsdFBhdGgocGF0aCk7XG4gIGlmIChub3JtYWxpemVkID09PSAnLycpIHJldHVybiAnLyc7XG4gIGNvbnN0IGxhc3RTbGFzaCA9IG5vcm1hbGl6ZWQubGFzdEluZGV4T2YoJy8nKTtcbiAgcmV0dXJuIGxhc3RTbGFzaCA9PT0gMCA/ICcvJyA6IG5vcm1hbGl6ZWQuc2xpY2UoMCwgbGFzdFNsYXNoKTtcbn1cblxuLyoqXG4gKiBGaW5hbCBwYXRoIHNlZ21lbnQuIGBiYXNlbmFtZSgnL2EvYi5tZCcpYCBcdTIxOTIgYGIubWRgOyBgYmFzZW5hbWUoJy8nKWAgXHUyMTkyIGAnJ2AuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBiYXNlbmFtZShwYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICBjb25zdCBub3JtYWxpemVkID0gbm9ybWFsaXplVmF1bHRQYXRoKHBhdGgpO1xuICBpZiAobm9ybWFsaXplZCA9PT0gJy8nKSByZXR1cm4gJyc7XG4gIHJldHVybiBub3JtYWxpemVkLnNsaWNlKG5vcm1hbGl6ZWQubGFzdEluZGV4T2YoJy8nKSArIDEpO1xufVxuIiwgIi8qKlxuICogTG9naWNhbCBjbG9jayBvcGVyYXRpb25zIChBUkNISVRFQ1RVUkUubWQgXHUwMEE3NCkuXG4gKlxuICogQ2xvY2tzIGFyZSBwZXItZmlsZSBtb25vdG9uaWMgY291bnRlcnMgb3duZWQgYnkgdGhlIHN5bmMgYXV0aG9yaXR5ICh0aGVcbiAqIER1cmFibGUgT2JqZWN0KS4gQSBjbG9jayBwYWlycyB0aGUgY291bnRlciB3aXRoIHRoZSBpZCBvZiB0aGUgZGV2aWNlIHRoYXRcbiAqIHByb2R1Y2VkIGl0LiBPcmRlcmluZyBpcyBmdWxseSBkZXRlcm1pbmlzdGljIG9uIGV2ZXJ5IGNsaWVudDpcbiAqXG4gKiAgIDEuIGhpZ2hlciBgY291bnRlcmAgd2lucztcbiAqICAgMi4gZXhhY3QgY291bnRlciB0aWUgXHUyMTkyIGxleGljb2dyYXBoaWNhbGx5IGdyZWF0ZXIgYGRldmljZUlkYCB3aW5zXG4gKiAgICAgIChwbGFpbiBKUyBzdHJpbmcgY29tcGFyaXNvbiwgaS5lLiBieSBVVEYtMTYgY29kZSB1bml0cyk7XG4gKiAgIDMuIGlkZW50aWNhbCBjb3VudGVyICphbmQqIGlkZW50aWNhbCBkZXZpY2VJZCBcdTIxOTIgdGhlIGNsb2NrcyBhcmUgZXF1YWwuXG4gKlxuICogV2FsbC1jbG9jayB0aW1lIG5ldmVyIHBhcnRpY2lwYXRlcyBpbiBvcmRlcmluZyAoZGlzcGxheS1vbmx5IHBlciBcdTAwQTc0KS5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IExvZ2ljYWxDbG9jayB9IGZyb20gJy4vdHlwZXMuanMnO1xuXG4vKiogUmVzdWx0IG9mIGBjb21wYXJlQ2xvY2tzYDogc2lnbiBvZiBgYWAgdnMgYGJgIChwb3NpdGl2ZSBcdTIxRDIgYGFgIHdpbnMpLiAqL1xuZXhwb3J0IHR5cGUgQ2xvY2tDb21wYXJpc29uID0gLTEgfCAwIHwgMTtcblxuLyoqXG4gKiBDb21wYXJlIHR3byBsb2dpY2FsIGNsb2Nrcy5cbiAqXG4gKiBSZXR1cm5zIGAxYCB3aGVuIGBhYCB3aW5zLCBgLTFgIHdoZW4gYGJgIHdpbnMsIGAwYCB3aGVuIHRoZSBjbG9ja3MgYXJlXG4gKiBpZGVudGljYWwgKHNhbWUgY291bnRlciAqYW5kKiBzYW1lIGRldmljZUlkIFx1MjAxNCBpbiBwcmFjdGljZSBvbmx5IHdoZW5cbiAqIGNvbXBhcmluZyBhIGNsb2NrIHdpdGggaXRzZWxmKS4gQ2FsbGVycyB0aGF0IG11c3QgcGljayBhIHNpZGUgb24gYDBgXG4gKiBzaG91bGQgZG8gc28gZXhwbGljaXRseSBhbmQgZG9jdW1lbnQgdGhlIGNob2ljZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNvbXBhcmVDbG9ja3MoYTogTG9naWNhbENsb2NrLCBiOiBMb2dpY2FsQ2xvY2spOiBDbG9ja0NvbXBhcmlzb24ge1xuICBpZiAoYS5jb3VudGVyICE9PSBiLmNvdW50ZXIpIHJldHVybiBhLmNvdW50ZXIgPiBiLmNvdW50ZXIgPyAxIDogLTE7XG4gIGlmIChhLmRldmljZUlkICE9PSBiLmRldmljZUlkKSByZXR1cm4gYS5kZXZpY2VJZCA+IGIuZGV2aWNlSWQgPyAxIDogLTE7XG4gIHJldHVybiAwO1xufVxuXG4vKipcbiAqIFRoZSBjbG9jayBhIGNvbW1pdCBmcm9tIGBkZXZpY2VJZGAgd291bGQgcmVjZWl2ZSB3aGVuIGJ1aWxkaW5nIG9uIGBwYXJlbnRgXG4gKiAob3Igb24gbm90aGluZywgd2hlbiBgcGFyZW50YCBpcyBhYnNlbnQpOiBwYXJlbnQncyBjb3VudGVyICsgMS5cbiAqXG4gKiBUaGlzIGlzIHRoZSAqdGVudGF0aXZlKiBjbG9jayB1c2VkIGJ5IGNsaWVudC1zaWRlIGNvbmZsaWN0IHByZWRpY3Rpb25cbiAqIChgcmVzb2x2ZS50c2ApOiB0aGUgRE8gYXNzaWducyByZWFsIGNvdW50ZXJzIHdpdGggdGhlIHNhbWUgcnVsZSwgc28gdGhlXG4gKiBwcmVkaWN0aW9uIG1hdGNoZXMgdGhlIHNlcnZlcidzIGFyYml0cmF0aW9uIGFzIGxvbmcgYXMgYm90aCBzaWRlcyBidWlsZCBvblxuICogdGhlIHNhbWUgcGFyZW50LlxuICovXG5leHBvcnQgZnVuY3Rpb24gbmV4dENsb2NrKFxuICBwYXJlbnQ6IExvZ2ljYWxDbG9jayB8IG51bGwgfCB1bmRlZmluZWQsXG4gIGRldmljZUlkOiBzdHJpbmcsXG4pOiBMb2dpY2FsQ2xvY2sge1xuICByZXR1cm4geyBjb3VudGVyOiAocGFyZW50Py5jb3VudGVyID8/IDApICsgMSwgZGV2aWNlSWQgfTtcbn1cbiIsICIvKipcbiAqIENvbnRlbnQgaGFzaGluZyBhbmQgY29tcHJlc3Npb24gXHUyMDE0IFdlYiBBUElzIG9ubHkuXG4gKlxuICogYGNyeXB0by5zdWJ0bGVgIGlzIGF2YWlsYWJsZSBpbiBOb2RlIDE4KywgQ2xvdWRmbGFyZSBXb3JrZXJzLFxuICogYW5kIE9ic2lkaWFuIChFbGVjdHJvbikuIGBDb21wcmVzc2lvblN0cmVhbWAgbGlrZXdpc2UuIE5vIE5vZGUgaW1wb3J0czpcbiAqIHRoaXMgbW9kdWxlIG11c3QgcnVuIHVuY2hhbmdlZCBpbiBldmVyeSBjbGllbnQgKEFSQ0hJVEVDVFVSRS5tZCBcdTAwQTc4KS5cbiAqL1xuXG4vKiogSGFzaCBvZiBgYnl0ZXNgIGFzIGxvd2VyY2FzZSBzaGEyNTYgaGV4LiBNYXRjaGVzIFIyIGJsb2Iga2V5cyBgYmxvYnMve3NoYTI1Nn1gLiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHNoYTI1NkhleChieXRlczogVWludDhBcnJheSB8IHN0cmluZyk6IFByb21pc2U8c3RyaW5nPiB7XG4gIGNvbnN0IGRhdGEgPSB0eXBlb2YgYnl0ZXMgPT09ICdzdHJpbmcnID8gbmV3IFRleHRFbmNvZGVyKCkuZW5jb2RlKGJ5dGVzKSA6IGJ5dGVzO1xuICAvLyBgY3J5cHRvYCAobm90IGBnbG9iYWxUaGlzLmNyeXB0b2ApOiB0aGUgYmFyZSBpZGVudGlmaWVyIHJlc29sdmVzIGluIGV2ZXJ5XG4gIC8vIHRhcmdldCdzIHR5cGVzIChET00gbGliLCBDbG91ZGZsYXJlIHdvcmtlcmQgdHlwZXMsIE5vZGUpIFx1MjAxNCB0aGUgcXVhbGlmaWVkXG4gIC8vIGZvcm0gZG9lcyBub3QsIGJlY2F1c2Ugd29ya2VycyB0eXBlcyBkZWNsYXJlIGl0IGBjb25zdGAsIHdoaWNoIG5ldmVyXG4gIC8vIG1lcmdlcyBpbnRvIGB0eXBlb2YgZ2xvYmFsVGhpc2AuXG4gIGNvbnN0IGRpZ2VzdCA9IGF3YWl0IGNyeXB0by5zdWJ0bGUuZGlnZXN0KCdTSEEtMjU2JywgZGF0YSBhcyBCdWZmZXJTb3VyY2UpO1xuICByZXR1cm4gdG9IZXgobmV3IFVpbnQ4QXJyYXkoZGlnZXN0KSk7XG59XG5cbi8qKlxuICogV2hldGhlciBnemlwIHN0cmVhbXMgYXJlIGF2YWlsYWJsZSBpbiB0aGlzIHJ1bnRpbWUuIE9sZGVyIE9ic2lkaWFuIG1vYmlsZVxuICogd2Vidmlld3MgbWF5IGxhY2sgYENvbXByZXNzaW9uU3RyZWFtYDsgY2FsbGVycyBmYWxsIGJhY2sgdG8gaWRlbnRpdHkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdXBwb3J0c0NvbXByZXNzaW9uKCk6IGJvb2xlYW4ge1xuICByZXR1cm4gKFxuICAgIHR5cGVvZiBDb21wcmVzc2lvblN0cmVhbSAhPT0gJ3VuZGVmaW5lZCcgJiZcbiAgICB0eXBlb2YgRGVjb21wcmVzc2lvblN0cmVhbSAhPT0gJ3VuZGVmaW5lZCdcbiAgKTtcbn1cblxuLyoqXG4gKiBHemlwIGBkYXRhYC4gRmFsbHMgYmFjayB0byBpZGVudGl0eSAocmV0dXJucyBpbnB1dCB1bmNoYW5nZWQpIHdoZW5cbiAqIGBDb21wcmVzc2lvblN0cmVhbWAgaXMgdW5hdmFpbGFibGUgXHUyMDE0IGNhbGwgYHN1cHBvcnRzQ29tcHJlc3Npb24oKWAgZmlyc3QgaWZcbiAqIHlvdSBtdXN0IGtub3cgd2hpY2ggaGFwcGVuZWQuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBjb21wcmVzcyhkYXRhOiBVaW50OEFycmF5KTogUHJvbWlzZTxVaW50OEFycmF5PiB7XG4gIGlmICghc3VwcG9ydHNDb21wcmVzc2lvbigpKSByZXR1cm4gZGF0YTtcbiAgLy8gYGFzIEJ1ZmZlclNvdXJjZWAgKG5vdCBgYXMgQmxvYlBhcnRgKTogdGhlIG5hbWUgYEJ1ZmZlclNvdXJjZWAgcmVzb2x2ZXMgaW5cbiAgLy8gYm90aCBET00gbGliIGFuZCB3b3JrZXJkIHJ1bnRpbWUgdHlwZXMsIGFuZCBpcyBhIHZhbGlkIEJsb2JQYXJ0IGluIGVhY2guXG4gIGNvbnN0IHN0cmVhbSA9IG5ldyBCbG9iKFtkYXRhIGFzIEJ1ZmZlclNvdXJjZV0pXG4gICAgLnN0cmVhbSgpXG4gICAgLnBpcGVUaHJvdWdoKG5ldyBDb21wcmVzc2lvblN0cmVhbSgnZ3ppcCcpKTtcbiAgcmV0dXJuIG5ldyBVaW50OEFycmF5KGF3YWl0IG5ldyBSZXNwb25zZShzdHJlYW0pLmFycmF5QnVmZmVyKCkpO1xufVxuXG4vKipcbiAqIEd1bnppcCBgZGF0YWAgcHJvZHVjZWQgYnkgYGNvbXByZXNzYCAoaW4gYSBydW50aW1lIHRoYXQgaGFkIGd6aXAgc3VwcG9ydCkuXG4gKiBGYWxscyBiYWNrIHRvIGlkZW50aXR5IHdoZW4gYERlY29tcHJlc3Npb25TdHJlYW1gIGlzIHVuYXZhaWxhYmxlLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZGVjb21wcmVzcyhkYXRhOiBVaW50OEFycmF5KTogUHJvbWlzZTxVaW50OEFycmF5PiB7XG4gIGlmICghc3VwcG9ydHNDb21wcmVzc2lvbigpKSByZXR1cm4gZGF0YTtcbiAgY29uc3Qgc3RyZWFtID0gbmV3IEJsb2IoW2RhdGEgYXMgQnVmZmVyU291cmNlXSlcbiAgICAuc3RyZWFtKClcbiAgICAucGlwZVRocm91Z2gobmV3IERlY29tcHJlc3Npb25TdHJlYW0oJ2d6aXAnKSk7XG4gIHJldHVybiBuZXcgVWludDhBcnJheShhd2FpdCBuZXcgUmVzcG9uc2Uoc3RyZWFtKS5hcnJheUJ1ZmZlcigpKTtcbn1cblxuZnVuY3Rpb24gdG9IZXgoYnl0ZXM6IFVpbnQ4QXJyYXkpOiBzdHJpbmcge1xuICBsZXQgb3V0ID0gJyc7XG4gIGZvciAoY29uc3QgYnl0ZSBvZiBieXRlcykge1xuICAgIG91dCArPSBieXRlLnRvU3RyaW5nKDE2KS5wYWRTdGFydCgyLCAnMCcpO1xuICB9XG4gIHJldHVybiBvdXQ7XG59XG4iLCAiLyoqXG4gKiBUeXBlZCBlcnJvciBoaWVyYXJjaHkgc2hhcmVkIGJ5IGFsbCBjbGllbnRzIChwbHVnaW4sIGRhZW1vbiwgQ0xJKSBhbmQgdGhlXG4gKiB0ZXN0LXN1aXRlIHNlcnZlci4gRXJyb3JzIGNhcnJ5IGEgc3RhYmxlIG1hY2hpbmUtcmVhZGFibGUgYGNvZGVgLlxuICovXG5cbmV4cG9ydCB0eXBlIEVycm9yQ29kZSA9XG4gIHwgJ1VOQ0xBSU1FRCdcbiAgfCAnVU5BVVRIT1JJWkVEJ1xuICB8ICdSRVZPS0VEJ1xuICB8ICdDT05GTElDVCdcbiAgfCAnUFJPVE9DT0wnXG4gIHwgJ05FVFdPUksnO1xuXG4vKiogQmFzZSBjbGFzcyBmb3IgYWxsIFZhdWx0U3luYyBlcnJvcnMuICovXG5leHBvcnQgYWJzdHJhY3QgY2xhc3MgVmF1bHRTeW5jRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIGFic3RyYWN0IHJlYWRvbmx5IGNvZGU6IEVycm9yQ29kZTtcblxuICBjb25zdHJ1Y3RvcihtZXNzYWdlOiBzdHJpbmcsIG9wdGlvbnM/OiBFcnJvck9wdGlvbnMpIHtcbiAgICBzdXBlcihtZXNzYWdlLCBvcHRpb25zKTtcbiAgICB0aGlzLm5hbWUgPSBuZXcudGFyZ2V0Lm5hbWU7XG4gIH1cbn1cblxuLyoqIFdvcmtlciBleGlzdHMgYnV0IGhhcyBub3QgYmVlbiBjbGFpbWVkIHlldCAoSFRUUCA0MjEgb24gZXZlcnkgQVBJIGNhbGwpLiAqL1xuZXhwb3J0IGNsYXNzIFVuY2xhaW1lZEVycm9yIGV4dGVuZHMgVmF1bHRTeW5jRXJyb3Ige1xuICByZWFkb25seSBjb2RlID0gJ1VOQ0xBSU1FRCcgYXMgY29uc3Q7XG59XG5cbi8qKiBUb2tlbiBtaXNzaW5nLCBpbnZhbGlkLCBvciBub3QgYWNjZXB0ZWQgKEhUVFAgNDAxIGNsYXNzKS4gKi9cbmV4cG9ydCBjbGFzcyBVbmF1dGhvcml6ZWRFcnJvciBleHRlbmRzIFZhdWx0U3luY0Vycm9yIHtcbiAgcmVhZG9ubHkgY29kZSA9ICdVTkFVVEhPUklaRUQnIGFzIGNvbnN0O1xufVxuXG4vKiogVGhlIGRldmljZSB0b2tlbiB3YXMgcmV2b2tlZDsgdGhlIGRldmljZSBtdXN0IGJlIHJlLXBhaXJlZC4gKi9cbmV4cG9ydCBjbGFzcyBSZXZva2VkRXJyb3IgZXh0ZW5kcyBWYXVsdFN5bmNFcnJvciB7XG4gIHJlYWRvbmx5IGNvZGUgPSAnUkVWT0tFRCcgYXMgY29uc3Q7XG59XG5cbi8qKiBBIGNvbW1pdCByYWNlZCB3aXRoIGEgY29uY3VycmVudCBlZGl0OyB0aGUgc2VydmVyIGFyYml0cmF0ZWQgKHNlZSBcdTAwQTc0KS4gKi9cbmV4cG9ydCBjbGFzcyBDb25mbGljdEVycm9yIGV4dGVuZHMgVmF1bHRTeW5jRXJyb3Ige1xuICByZWFkb25seSBjb2RlID0gJ0NPTkZMSUNUJyBhcyBjb25zdDtcbn1cblxuLyoqIEEgcGVlciAob3IgbG9jYWwgYnVnKSB2aW9sYXRlZCB0aGUgcHJvdG9jb2w6IGJhZCBtZXNzYWdlIHNoYXBlLCBiYWQgdmVyc2lvbi4gKi9cbmV4cG9ydCBjbGFzcyBQcm90b2NvbEVycm9yIGV4dGVuZHMgVmF1bHRTeW5jRXJyb3Ige1xuICByZWFkb25seSBjb2RlID0gJ1BST1RPQ09MJyBhcyBjb25zdDtcbn1cblxuLyoqIFRyYW5zcG9ydC1sZXZlbCBmYWlsdXJlOiBzb2NrZXQgY2xvc2VkLCBmZXRjaCByZWZ1c2VkLCB0aW1lb3V0LiBSZXRyaWFibGUuICovXG5leHBvcnQgY2xhc3MgTmV0d29ya0Vycm9yIGV4dGVuZHMgVmF1bHRTeW5jRXJyb3Ige1xuICByZWFkb25seSBjb2RlID0gJ05FVFdPUksnIGFzIGNvbnN0O1xufVxuIiwgIi8qKlxuICogVGhlIGNsaWVudCdzIHBlcnNpc3RlZCBzeW5jIHN0YXRlIChBUkNISVRFQ1RVUkUubWQgXHUwMEE3OCBzdGVwIDEpLlxuICpcbiAqIEEgYExvY2FsSW5kZXhgIG1hcHMgZXZlcnkgdmF1bHQgcGF0aCB0aGlzIGNsaWVudCBoYXMgZXZlciBzeW5jZWQgdG8gdGhlXG4gKiBsYXN0IHZlcnNpb24gaXQgKmtub3dzKiB3YXMgYXV0aG9yaXRhdGl2ZTogY29udGVudCBoYXNoLCBzaXplLCB0aGVcbiAqIHNlcnZlci1hc3NpZ25lZCB2ZXJzaW9uIGlkLCBhbmQgdGhlIHZlcnNpb24ncyBsb2dpY2FsIGNsb2NrLiBFbnRyaWVzIHdpdGhcbiAqIGBkZWxldGVkQXRgIHNldCBhcmUgdG9tYnN0b25lcyBcdTIwMTQgdGhlIGZpbGUgd2FzIGRlbGV0ZWQgKGxvY2FsbHkgb3JcbiAqIHJlbW90ZWx5KSBidXQgdGhlIGVudHJ5IHN0YXlzIHNvIHRoZSBkZWxldGlvbiBpcyBub3QgcmVzdXJyZWN0ZWQgYnkgdGhlXG4gKiBuZXh0IHNjYW4gYW5kIHNvIHJlbmFtZSBjb3JyZWxhdGlvbiBrZWVwcyB3b3JraW5nLlxuICpcbiAqIFRoZSBpbmRleCBpcyBwZXJzaXN0ZWQgaW5zaWRlIHRoZSB2YXVsdCBhdCBgLy52YXVsdHN5bmNmb3JhZ2VudHMvc3RhdGVgXG4gKiAodGhhdCBkaXJlY3RvcnkgaXMgc3luYy1pZ25vcmVkLCBzZWUgYGlnbm9yZS50c2ApIHRocm91Z2ggdGhlIHN0b3JhZ2VcbiAqIGFkYXB0ZXIsIHdob3NlIGB3cml0ZUZpbGVgIGlzIGF0b21pYyAodGVtcCArIHJlbmFtZSkgYnkgY29udHJhY3QuXG4gKlxuICogQWxsIG9wZXJhdGlvbnMgYXJlIHB1cmU6IHRoZXkgcmV0dXJuIG5ldyBvYmplY3RzIGFuZCBuZXZlciBtdXRhdGUgaW5wdXRzLlxuICovXG5cbmltcG9ydCB0eXBlIHsgTG9naWNhbENsb2NrIH0gZnJvbSAnLi90eXBlcy5qcyc7XG5pbXBvcnQgeyBQcm90b2NvbEVycm9yIH0gZnJvbSAnLi9lcnJvcnMuanMnO1xuXG4vKipcbiAqIEN1cnJlbnQgb24tZGlzayBzY2hlbWEgdmVyc2lvbi4gQnVtcCArIGFkZCBtaWdyYXRpb24gb24gYnJlYWtpbmcgY2hhbmdlcy5cbiAqXG4gKiBIaXN0b3J5OlxuICogICAtIDEgXHUyMDE0IGluaXRpYWwgc2hhcGUgKGhhc2gvc2l6ZS92ZXJzaW9uSWQvY2xvY2svZGVsZXRlZEF0L2lzRm9sZGVyKS5cbiAqICAgLSAyIFx1MjAxNCBhZGRzIHRoZSBvcHRpb25hbCBgbXRpbWVgIGNhY2hlIGZpZWxkIHBlciBlbnRyeSAoc2NhbiBwcmUtZmlsdGVyLFxuICogICAgICAgICBzZWUgYHNjYW4udHNgKS4gR3JhY2VmdWwgbWlncmF0aW9uOiB2MSBlbnRyaWVzIHNpbXBseSBsYWNrIGBtdGltZWAsXG4gKiAgICAgICAgIHdoaWNoIHJlYWRzIGJhY2sgYXMgXCJ1bmtub3duXCIgXHUyMDE0IHRoZSBuZXh0IGZhc3Qgc2NhbiByZS1oYXNoZXMgdGhlXG4gKiAgICAgICAgIGZpbGUgYW5kIHJlY29yZHMgaXQuIE9sZCB2MSBzdGF0ZSBmaWxlcyBsb2FkIHdpdGhvdXQgZXJyb3IuXG4gKi9cbmV4cG9ydCBjb25zdCBMT0NBTF9JTkRFWF9TQ0hFTUFfVkVSU0lPTiA9IDI7XG5cbi8qKiBPbGRlc3Qgb24tZGlzayBzY2hlbWEgdmVyc2lvbiB0aGlzIGJ1aWxkIGNhbiBzdGlsbCByZWFkLiAqL1xuZXhwb3J0IGNvbnN0IE1JTl9MT0NBTF9JTkRFWF9TQ0hFTUFfVkVSU0lPTiA9IDE7XG5cbi8qKiBWYXVsdCBwYXRoIHdoZXJlIHRoZSBjbGllbnQgcGVyc2lzdHMgaXRzIGxvY2FsIGluZGV4LiAqL1xuZXhwb3J0IGNvbnN0IExPQ0FMX0lOREVYX1NUQVRFX1BBVEggPSAnLy52YXVsdHN5bmNmb3JhZ2VudHMvc3RhdGUnO1xuXG4vKiogT25lIHBhdGgncyBsYXN0LWtub3duLXN5bmNlZCBzdGF0ZS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgTG9jYWxJbmRleEVudHJ5IHtcbiAgLyoqIHNoYTI1NiBoZXggb2YgdGhlIGNvbnRlbnQgYXQgYHZlcnNpb25JZGAuICovXG4gIGhhc2g6IHN0cmluZztcbiAgLyoqIENvbnRlbnQgc2l6ZSBpbiBieXRlcyAoYDBgIGZvciBmb2xkZXIgcGxhY2Vob2xkZXJzKS4gKi9cbiAgc2l6ZTogbnVtYmVyO1xuICAvKiogU2VydmVyLWFzc2lnbmVkIHZlcnNpb24gaWQgdGhpcyBlbnRyeSByZWZsZWN0cy4gKi9cbiAgdmVyc2lvbklkOiBzdHJpbmc7XG4gIC8qKiBMb2dpY2FsIGNsb2NrIG9mIGB2ZXJzaW9uSWRgIFx1MjAxNCB1c2VkIHRvIHByZWRpY3QgY29uZmxpY3Qgb3V0Y29tZXMuICovXG4gIGNsb2NrOiBMb2dpY2FsQ2xvY2s7XG4gIC8qKiBQcmVzZW50IFx1MjFEMiB0b21ic3RvbmU6IHRoZSBwYXRoIHdhcyBkZWxldGVkIGF0IHRoaXMgZXBvY2ggbXMuICovXG4gIGRlbGV0ZWRBdD86IG51bWJlcjtcbiAgLyoqXG4gICAqIFRydWUgZm9yIGVtcHR5LWZvbGRlciBwbGFjZWhvbGRlciBlbnRyaWVzIChGUi0xMCkuIEZvbGRlciBlbnRyaWVzIGNhcnJ5XG4gICAqIGBoYXNoOiAnJ2AsIGBzaXplOiAwYDsgdGhlIGNsb2NrIGlzIHRoYXQgb2YgdGhlIHBsYWNlaG9sZGVyJ3MgdmVyc2lvbi5cbiAgICovXG4gIGlzRm9sZGVyPzogYm9vbGVhbjtcbiAgLyoqXG4gICAqIFN0b3JhZ2UgbXRpbWUgKGVwb2NoIG1zKSBvYnNlcnZlZCB0aGUgbGFzdCB0aW1lIHRoaXMgZW50cnkncyBmaWxlIHdhc1xuICAgKiBoYXNoZWQgYnkgYSBzY2FuLiBBIHB1cmUgY2FjaGUgZm9yIHRoZSBzY2FuIHByZS1maWx0ZXIgKGBzY2FuLnRzYCk6XG4gICAqIG51bGxpc2ggKGFic2VudCwgZS5nLiBsZWdhY3kgdjEgc3RhdGUgb3IgZW50cmllcyB3cml0dGVuIGJ5IHB1bGxzKVxuICAgKiBtZWFucyBcInVua25vd25cIiBcdTIwMTQgdGhlIG5leHQgZmFzdCBzY2FuIGhhc2hlcyB0aGUgZmlsZSBhbmQgcmVjb3JkcyBpdCB2aWFcbiAgICogYHJlY29yZEhhc2hlZEZpbGVzYC4gTmV2ZXIgY29uc3VsdGVkIGZvciBzeW5jIGRlY2lzaW9ucy5cbiAgICovXG4gIG10aW1lPzogbnVtYmVyO1xufVxuXG4vKiogVGhlIHdob2xlIGluZGV4OiBub3JtYWxpemVkIHZhdWx0IHBhdGggXHUyMTkyIGVudHJ5LiBge31gIGlzIGEgdmFsaWQgZW1wdHkgaW5kZXguICovXG5leHBvcnQgdHlwZSBMb2NhbEluZGV4ID0gUmVhZG9ubHk8UmVjb3JkPHN0cmluZywgTG9jYWxJbmRleEVudHJ5Pj47XG5cbi8qKiBWZXJzaW9uZWQgc2VyaWFsaXphdGlvbiBlbnZlbG9wZSAoc2NoZW1hVmVyc2lvbiBlbmFibGVzIGZ1dHVyZSBtaWdyYXRpb24pLiAqL1xuZXhwb3J0IGludGVyZmFjZSBMb2NhbEluZGV4RW52ZWxvcGUge1xuICBzY2hlbWFWZXJzaW9uOiBudW1iZXI7XG4gIGVudHJpZXM6IFJlY29yZDxzdHJpbmcsIExvY2FsSW5kZXhFbnRyeT47XG59XG5cbi8qKiBPbmUgYXV0aG9yaXRhdGl2ZSBzdGF0ZSBjaGFuZ2UgdG8gZm9sZCBpbnRvIHRoZSBpbmRleC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgTG9jYWxJbmRleENvbW1pdCB7XG4gIHBhdGg6IHN0cmluZztcbiAgdmVyc2lvbklkOiBzdHJpbmc7XG4gIGhhc2g6IHN0cmluZztcbiAgc2l6ZTogbnVtYmVyO1xuICBjbG9jazogTG9naWNhbENsb2NrO1xuICAvKiogUHJlc2VudCBcdTIxRDIgdG9tYnN0b25lOiB0aGUgcGF0aCB3YXMgZGVsZXRlZCBhdCB0aGlzIGVwb2NoIG1zLiAqL1xuICBkZWxldGVkPzogYm9vbGVhbjtcbiAgLyoqIEVwb2NoIG1zIG9mIHRoZSBkZWxldGlvbiBcdTIwMTQgcmVxdWlyZWQgd2hlbiBgZGVsZXRlZGAgaXMgdHJ1ZS4gKi9cbiAgZGVsZXRlZEF0PzogbnVtYmVyO1xuICAvKiogVHJ1ZSB3aGVuIHRoaXMgY29tbWl0IHJlY29yZHMgYW4gZW1wdHktZm9sZGVyIHBsYWNlaG9sZGVyIChGUi0xMCkuICovXG4gIGlzRm9sZGVyPzogYm9vbGVhbjtcbiAgLyoqXG4gICAqIFN0b3JhZ2UgbXRpbWUgb2JzZXJ2ZWQgYXQgSEFTSCB0aW1lIGZvciB0aGlzIGV4YWN0IGNvbnRlbnQgXHUyMDE0IHBpbm5lZCBvbnRvXG4gICAqIHRoZSBlbnRyeSB3aGVuIHRoZSBjb21taXQgaXMgZm9sZGVkIChpLmUuIGF0IGNvbW1pdC1hY2sgdGltZSkuIFRocmVhZGluZ1xuICAgKiB0aGUgc3RhdCB0aGF0IGNvLW9jY3VycmVkIHdpdGggdGhlIGhhc2hlZCBieXRlcyAocmF0aGVyIHRoYW4gYW55XG4gICAqIGxhdGVyL2N1cnJlbnQgc3RhdCkgZ3VhcmFudGVlcyB0aGUgZmFzdC1wYXRoIGNhY2hlIGNhbiBuZXZlciBwYWlyIGFcbiAgICogZnJlc2hlciBzdGF0IHdpdGggdGhpcyBoYXNoLCB3aGljaCB3b3VsZCBoaWRlIGFuIGVkaXQgZnJvbSBldmVyeSBmdXR1cmVcbiAgICogc2NhbiAodGhlIHNpbGVudCBkcm9wcGVkLWVkaXQgY2xhc3MpLiBBYnNlbnQgXHUyMUQyIHVua25vd247IHRoZSBuZXh0IHNjYW5cbiAgICogcmUtaGFzaGVzIGFuZCByZWNvcmRzIHZpYSBgcmVjb3JkSGFzaGVkRmlsZXNgLlxuICAgKi9cbiAgbXRpbWU/OiBudW1iZXI7XG59XG5cbi8qKlxuICogRm9sZCBvbmUgY29tbWl0IGludG8gdGhlIGluZGV4LiBQdXJlOiByZXR1cm5zIGEgbmV3IGluZGV4LCBpbnB1dCB1bnRvdWNoZWQuXG4gKlxuICogQXBwbHlpbmcgYSBjb21taXQgZm9yIGEgcGF0aCByZXBsYWNlcyB0aGF0IHBhdGgncyBlbnRyeSB3aG9sZXNhbGUgKGEgY29tbWl0XG4gKiAqaXMqIHRoZSBuZXcgdHJ1dGggZm9yIHRoZSBwYXRoKTsgYGFwcGx5Q29tbWl0YCBuZXZlciBtZXJnZXMgZmllbGRzLlxuICogVG9tYnN0b25pbmcgKGBkZWxldGVkOiB0cnVlYCkgcmVxdWlyZXMgYGRlbGV0ZWRBdGAgYW5kIGtlZXBzIHRoZSBlbnRyeS5cbiAqXG4gKiBUbyBkcm9wIGFuIGVudHJ5IGVudGlyZWx5ICh0aGUgcGF0aCBtaWdyYXRlZCBhd2F5LCBlLmcuIGEgc3luY2VkIHJlbmFtZSlcbiAqIHVzZSBgcmVtb3ZlRW50cnlgIGluc3RlYWQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBhcHBseUNvbW1pdChpbmRleDogTG9jYWxJbmRleCwgY29tbWl0OiBMb2NhbEluZGV4Q29tbWl0KTogTG9jYWxJbmRleCB7XG4gIGlmIChjb21taXQuZGVsZXRlZCAmJiBjb21taXQuZGVsZXRlZEF0ID09PSB1bmRlZmluZWQpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBgYXBwbHlDb21taXQ6IHRvbWJzdG9uZSBmb3IgJHtKU09OLnN0cmluZ2lmeShjb21taXQucGF0aCl9IHJlcXVpcmVzIGRlbGV0ZWRBdGAsXG4gICAgKTtcbiAgfVxuICBjb25zdCBuZXh0OiBSZWNvcmQ8c3RyaW5nLCBMb2NhbEluZGV4RW50cnk+ID0geyAuLi5pbmRleCB9O1xuICBjb25zdCBlbnRyeTogTG9jYWxJbmRleEVudHJ5ID0ge1xuICAgIGhhc2g6IGNvbW1pdC5oYXNoLFxuICAgIHNpemU6IGNvbW1pdC5zaXplLFxuICAgIHZlcnNpb25JZDogY29tbWl0LnZlcnNpb25JZCxcbiAgICBjbG9jazogY29tbWl0LmNsb2NrLFxuICB9O1xuICBpZiAoY29tbWl0LmRlbGV0ZWQpIGVudHJ5LmRlbGV0ZWRBdCA9IGNvbW1pdC5kZWxldGVkQXQ7XG4gIGlmIChjb21taXQuaXNGb2xkZXIpIGVudHJ5LmlzRm9sZGVyID0gdHJ1ZTtcbiAgaWYgKGNvbW1pdC5tdGltZSAhPT0gdW5kZWZpbmVkKSBlbnRyeS5tdGltZSA9IGNvbW1pdC5tdGltZTtcbiAgbmV4dFtjb21taXQucGF0aF0gPSBlbnRyeTtcbiAgcmV0dXJuIG5leHQ7XG59XG5cbi8qKlxuICogUmVtb3ZlIGEgcGF0aCdzIGVudHJ5IGVudGlyZWx5IChubyB0b21ic3RvbmUpLiBVc2VkIHdoZW4gdGhlIGF1dGhvcml0eVxuICogbWlncmF0ZXMgYSBwYXRoJ3MgdmVyc2lvbiBjaGFpbiBlbHNld2hlcmUgXHUyMDE0IGkuZS4gYSBzeW5jZWQgcmVuYW1lOiB0aGUgb2xkXG4gKiBwYXRoIG11c3QgdmFuaXNoIGZyb20gdGhlIGluZGV4IGV4YWN0bHkgYXMgaXQgdmFuaXNoZWQgZnJvbSB0aGUgbWFuaWZlc3QuXG4gKiBQdXJlOyByZW1vdmluZyBhbiBhYnNlbnQgcGF0aCBpcyBhIG5vLW9wLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVtb3ZlRW50cnkoaW5kZXg6IExvY2FsSW5kZXgsIHBhdGg6IHN0cmluZyk6IExvY2FsSW5kZXgge1xuICBpZiAoIShwYXRoIGluIGluZGV4KSkgcmV0dXJuIGluZGV4O1xuICBjb25zdCBuZXh0OiBSZWNvcmQ8c3RyaW5nLCBMb2NhbEluZGV4RW50cnk+ID0geyAuLi5pbmRleCB9O1xuICBkZWxldGUgbmV4dFtwYXRoXTtcbiAgcmV0dXJuIG5leHQ7XG59XG5cbi8qKlxuICogU2VyaWFsaXplIHRvIGEgZGV0ZXJtaW5pc3RpYyBKU09OIHN0cmluZzogdmVyc2lvbmVkIGVudmVsb3BlLCBlbnRyaWVzXG4gKiBzb3J0ZWQgYnkgcGF0aCAoc28gaWRlbnRpY2FsIGluZGV4ZXMgc2VyaWFsaXplIGJ5dGUtaWRlbnRpY2FsbHkgYW5kIGRpZmZcbiAqIGNsZWFubHkgaW4gc3RhdGUtZGlyIGxpc3RpbmdzKS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNlcmlhbGl6ZUxvY2FsSW5kZXgoaW5kZXg6IExvY2FsSW5kZXgpOiBzdHJpbmcge1xuICBjb25zdCBlbnRyaWVzOiBSZWNvcmQ8c3RyaW5nLCBMb2NhbEluZGV4RW50cnk+ID0ge307XG4gIGZvciAoY29uc3QgcGF0aCBvZiBPYmplY3Qua2V5cyhpbmRleCkuc29ydCgpKSB7XG4gICAgZW50cmllc1twYXRoXSA9IGluZGV4W3BhdGhdIGFzIExvY2FsSW5kZXhFbnRyeTtcbiAgfVxuICBjb25zdCBlbnZlbG9wZTogTG9jYWxJbmRleEVudmVsb3BlID0ge1xuICAgIHNjaGVtYVZlcnNpb246IExPQ0FMX0lOREVYX1NDSEVNQV9WRVJTSU9OLFxuICAgIGVudHJpZXMsXG4gIH07XG4gIHJldHVybiBKU09OLnN0cmluZ2lmeShlbnZlbG9wZSk7XG59XG5cbi8qKlxuICogUGFyc2UgYSBzZXJpYWxpemVkIGluZGV4IGJhY2suIFRocm93cyBgUHJvdG9jb2xFcnJvcmAgb24gbm9uLUpTT04gaW5wdXQsXG4gKiBhIG1hbGZvcm1lZCBlbnZlbG9wZSwgZW50cmllcyB3aXRoIHdyb25nIGZpZWxkIHR5cGVzLCBvciBhIGBzY2hlbWFWZXJzaW9uYFxuICogb3V0c2lkZSB0aGUgc3VwcG9ydGVkIHJhbmdlIChvbGRlciB0aGFuIGBNSU5fTE9DQUxfSU5ERVhfU0NIRU1BX1ZFUlNJT05gXG4gKiBvciBuZXdlciB0aGFuIGBMT0NBTF9JTkRFWF9TQ0hFTUFfVkVSU0lPTmApIFx1MjAxNCBvbGRlciB2ZXJzaW9ucyAqd2l0aGluKiB0aGVcbiAqIHJhbmdlIGxvYWQgd2l0aG91dCBlcnJvciAodjEgZW50cmllcyBzaW1wbHkgZGVzZXJpYWxpemUgd2l0aCBgbXRpbWVgXG4gKiB1bmtub3duKS4gVW5rbm93biBleHRyYSBmaWVsZHMgYXJlIHRvbGVyYXRlZCBmb3IgZm9yd2FyZCBjb21wYXRpYmlsaXR5LlxuICovXG5leHBvcnQgZnVuY3Rpb24gZGVzZXJpYWxpemVMb2NhbEluZGV4KGpzb246IHN0cmluZyk6IExvY2FsSW5kZXgge1xuICBsZXQgcGFyc2VkOiB1bmtub3duO1xuICB0cnkge1xuICAgIHBhcnNlZCA9IEpTT04ucGFyc2UoanNvbik7XG4gIH0gY2F0Y2ggKGNhdXNlKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoJ0xvY2FsIGluZGV4IHN0YXRlIGlzIG5vdCB2YWxpZCBKU09OJywgeyBjYXVzZSB9KTtcbiAgfVxuICBpZiAoIWlzUGxhaW5PYmplY3QocGFyc2VkKSkge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKCdMb2NhbCBpbmRleCBzdGF0ZSBpcyBub3QgYW4gb2JqZWN0Jyk7XG4gIH1cbiAgY29uc3QgdmVyc2lvbiA9IHBhcnNlZC5zY2hlbWFWZXJzaW9uO1xuICBpZiAodHlwZW9mIHZlcnNpb24gIT09ICdudW1iZXInIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKHZlcnNpb24pKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoJ0xvY2FsIGluZGV4IHN0YXRlIGlzIG1pc3NpbmcgaW50ZWdlciBzY2hlbWFWZXJzaW9uJyk7XG4gIH1cbiAgaWYgKHZlcnNpb24gPCBNSU5fTE9DQUxfSU5ERVhfU0NIRU1BX1ZFUlNJT04gfHwgdmVyc2lvbiA+IExPQ0FMX0lOREVYX1NDSEVNQV9WRVJTSU9OKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoXG4gICAgICBgTG9jYWwgaW5kZXggc2NoZW1hIHZlcnNpb24gJHt2ZXJzaW9ufSBpcyBub3Qgc3VwcG9ydGVkIGJ5IHRoaXMgYnVpbGQgYCArXG4gICAgICAgIGAoZXhwZWN0ZWQgJHtNSU5fTE9DQUxfSU5ERVhfU0NIRU1BX1ZFUlNJT059Li4ke0xPQ0FMX0lOREVYX1NDSEVNQV9WRVJTSU9OfSk7IGAgK1xuICAgICAgICAnYSBtaWdyYXRpb24gaXMgcmVxdWlyZWQnLFxuICAgICk7XG4gIH1cbiAgY29uc3QgcmF3RW50cmllcyA9IHBhcnNlZC5lbnRyaWVzO1xuICBpZiAoIWlzUGxhaW5PYmplY3QocmF3RW50cmllcykpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcignTG9jYWwgaW5kZXggc3RhdGUgaXMgbWlzc2luZyB0aGUgZW50cmllcyBvYmplY3QnKTtcbiAgfVxuXG4gIGNvbnN0IGVudHJpZXM6IFJlY29yZDxzdHJpbmcsIExvY2FsSW5kZXhFbnRyeT4gPSB7fTtcbiAgZm9yIChjb25zdCBbcGF0aCwgcmF3XSBvZiBPYmplY3QuZW50cmllcyhyYXdFbnRyaWVzKSkge1xuICAgIGVudHJpZXNbcGF0aF0gPSBwYXJzZUVudHJ5KHBhdGgsIHJhdyk7XG4gIH1cbiAgcmV0dXJuIGVudHJpZXM7XG59XG5cbmZ1bmN0aW9uIHBhcnNlRW50cnkocGF0aDogc3RyaW5nLCByYXc6IHVua25vd24pOiBMb2NhbEluZGV4RW50cnkge1xuICBjb25zdCB3aGVyZSA9IGBMb2NhbCBpbmRleCBlbnRyeSAke0pTT04uc3RyaW5naWZ5KHBhdGgpfWA7XG4gIGlmICghaXNQbGFpbk9iamVjdChyYXcpKSB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgJHt3aGVyZX0gaXMgbm90IGFuIG9iamVjdGApO1xuICBjb25zdCB7IGhhc2gsIHNpemUsIHZlcnNpb25JZCwgY2xvY2ssIGRlbGV0ZWRBdCwgaXNGb2xkZXIsIG10aW1lIH0gPSByYXcgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gIGlmICh0eXBlb2YgaGFzaCAhPT0gJ3N0cmluZycpIHRocm93IG5ldyBQcm90b2NvbEVycm9yKGAke3doZXJlfTogaGFzaCBtdXN0IGJlIGEgc3RyaW5nYCk7XG4gIGlmICh0eXBlb2YgdmVyc2lvbklkICE9PSAnc3RyaW5nJykge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKGAke3doZXJlfTogdmVyc2lvbklkIG11c3QgYmUgYSBzdHJpbmdgKTtcbiAgfVxuICBpZiAodHlwZW9mIHNpemUgIT09ICdudW1iZXInIHx8ICFOdW1iZXIuaXNJbnRlZ2VyKHNpemUpIHx8IHNpemUgPCAwKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoYCR7d2hlcmV9OiBzaXplIG11c3QgYmUgYSBub24tbmVnYXRpdmUgaW50ZWdlcmApO1xuICB9XG4gIGlmICghaXNQbGFpbk9iamVjdChjbG9jaykgfHwgdHlwZW9mIGNsb2NrLmNvdW50ZXIgIT09ICdudW1iZXInIHx8IHR5cGVvZiBjbG9jay5kZXZpY2VJZCAhPT0gJ3N0cmluZycpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgJHt3aGVyZX06IGNsb2NrIG11c3QgYmUgeyBjb3VudGVyOiBudW1iZXIsIGRldmljZUlkOiBzdHJpbmcgfWApO1xuICB9XG4gIGlmIChkZWxldGVkQXQgIT09IHVuZGVmaW5lZCAmJiB0eXBlb2YgZGVsZXRlZEF0ICE9PSAnbnVtYmVyJykge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKGAke3doZXJlfTogZGVsZXRlZEF0IG11c3QgYmUgYSBudW1iZXIgd2hlbiBwcmVzZW50YCk7XG4gIH1cbiAgaWYgKGlzRm9sZGVyICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIGlzRm9sZGVyICE9PSAnYm9vbGVhbicpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgJHt3aGVyZX06IGlzRm9sZGVyIG11c3QgYmUgYSBib29sZWFuIHdoZW4gcHJlc2VudGApO1xuICB9XG4gIGlmIChtdGltZSAhPT0gdW5kZWZpbmVkICYmICh0eXBlb2YgbXRpbWUgIT09ICdudW1iZXInIHx8ICFOdW1iZXIuaXNGaW5pdGUobXRpbWUpKSkge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKGAke3doZXJlfTogbXRpbWUgbXVzdCBiZSBhIGZpbml0ZSBudW1iZXIgd2hlbiBwcmVzZW50YCk7XG4gIH1cbiAgY29uc3QgZW50cnk6IExvY2FsSW5kZXhFbnRyeSA9IHtcbiAgICBoYXNoLFxuICAgIHNpemUsXG4gICAgdmVyc2lvbklkLFxuICAgIGNsb2NrOiB7IGNvdW50ZXI6IGNsb2NrLmNvdW50ZXIgYXMgbnVtYmVyLCBkZXZpY2VJZDogY2xvY2suZGV2aWNlSWQgYXMgc3RyaW5nIH0sXG4gIH07XG4gIGlmIChkZWxldGVkQXQgIT09IHVuZGVmaW5lZCkgZW50cnkuZGVsZXRlZEF0ID0gZGVsZXRlZEF0IGFzIG51bWJlcjtcbiAgaWYgKGlzRm9sZGVyICE9PSB1bmRlZmluZWQpIGVudHJ5LmlzRm9sZGVyID0gaXNGb2xkZXIgYXMgYm9vbGVhbjtcbiAgaWYgKG10aW1lICE9PSB1bmRlZmluZWQpIGVudHJ5Lm10aW1lID0gbXRpbWUgYXMgbnVtYmVyO1xuICByZXR1cm4gZW50cnk7XG59XG5cbmZ1bmN0aW9uIGlzUGxhaW5PYmplY3QodmFsdWU6IHVua25vd24pOiB2YWx1ZSBpcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB7XG4gIHJldHVybiB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmIHZhbHVlICE9PSBudWxsICYmICFBcnJheS5pc0FycmF5KHZhbHVlKTtcbn1cbiIsICIvKipcbiAqIFRoaW4gcHVsbC1zaWRlIG9yY2hlc3RyYXRpb24gKEFSQ0hJVEVDVFVSRS5tZCBcdTAwQTc4IHN0ZXAgNSkuIE5PVCB0aGUgbmV0d29ya1xuICogY2xpZW50OiBhbGwgdHJhbnNwb3J0IGlzIGluamVjdGVkIChgZmV0Y2hCbG9iYCksIHdoaWNoIHRoZSBsYXRlciBuZXR3b3JrXG4gKiBwaGFzZSBpbXBsZW1lbnRzIG92ZXIgYC9ibG9iLzpoYXNoYCBvciBXUy1pbmxpbmUgY29udGVudC5cbiAqXG4gKiBgYXBwbHlQdWxsYCBtYXRlcmlhbGl6ZXMgZXZlcnkgYFB1bGxPcGAgb2YgYSBgU3luY1BsYW5gIHRocm91Z2ggdGhlXG4gKiBzdG9yYWdlIGFkYXB0ZXIgYW5kIHVwZGF0ZXMgdGhlIGxvY2FsIGluZGV4IFx1MjAxNCBkdXJhYmx5IGFuZCBob25lc3RseTpcbiAqXG4gKiAgIC0gYmxvYnMgYXJlIHZlcmlmaWVkIChzaGEyNTYpIGJlZm9yZSBiZWluZyB3cml0dGVuOyBhIG1pc21hdGNoIGFib3J0c1xuICogICAgIHRoZSBwbGFuO1xuICogICAtIGVhY2ggaW5kZXggZW50cnkgaXMgcmVjb3JkZWQgb25seSAqYWZ0ZXIqIGl0cyBzdG9yYWdlIHdyaXRlIHN1Y2NlZWRlZCxcbiAqICAgICBzbyBhIG1pZC1wbGFuIGZhaWx1cmUgbGVhdmVzIHRoZSBpbmRleCBkZXNjcmliaW5nIGV4YWN0bHkgdGhlIGZpbGVzXG4gKiAgICAgdGhhdCBhY3R1YWxseSBsYW5kZWQgKEZSLTU6IG5vdGhpbmcgaXMgc2lsZW50bHkgbG9zdCBcdTIwMTQgdGhlIHVuc3luY2VkXG4gKiAgICAgcHVsbHMgc2ltcGx5IHJlbWFpbiBpbiB0aGUgcGxhbiBhbmQgYXJlIHJldHJpZWQgYnkgdGhlIGNhbGxlcik7XG4gKiAgIC0gdGhlIGluZGV4IGlzIHBlcnNpc3RlZCB0aHJvdWdoIHRoZSBhZGFwdGVyJ3MgYXRvbWljIGB3cml0ZUZpbGVgXG4gKiAgICAgKHRlbXAgKyByZW5hbWUgcGVyIHRoZSBhZGFwdGVyIGNvbnRyYWN0KSBhdFxuICogICAgIGAvLnZhdWx0c3luY2ZvcmFnZW50cy9zdGF0ZWAsIGluY2x1ZGluZyBvbiB0aGUgZmFpbHVyZSBwYXRoLlxuICpcbiAqIFB1c2hlcy9jb25mbGljdHMvZm9sZGVyIG9wcyBhcmUgdGhlIG5ldHdvcmsgcGhhc2UncyBidXNpbmVzczsgcmV0cnlcbiAqIHF1ZXVlcyBhcmUgZXhwbGljaXRseSBvdXQgb2Ygc2NvcGUgaGVyZS5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IFN0b3JhZ2VBZGFwdGVyIH0gZnJvbSAnLi9hZGFwdGVycy5qcyc7XG5pbXBvcnQgeyBzaGEyNTZIZXggfSBmcm9tICcuL2hhc2hpbmcuanMnO1xuaW1wb3J0IHtcbiAgYXBwbHlDb21taXQsXG4gIGRlc2VyaWFsaXplTG9jYWxJbmRleCxcbiAgTE9DQUxfSU5ERVhfU1RBVEVfUEFUSCxcbiAgcmVtb3ZlRW50cnksXG4gIHNlcmlhbGl6ZUxvY2FsSW5kZXgsXG4gIHR5cGUgTG9jYWxJbmRleCxcbn0gZnJvbSAnLi9sb2NhbGluZGV4LmpzJztcbmltcG9ydCB0eXBlIHsgUHVsbE9wLCBTeW5jUGxhbiB9IGZyb20gJy4vcmVzb2x2ZS5qcyc7XG5cbi8qKiBJbmplY3RlZCBjb250ZW50IHRyYW5zcG9ydDogZmV0Y2ggdGhlIGJsb2IgZm9yIGEgY29udGVudCBoYXNoLiAqL1xuZXhwb3J0IHR5cGUgRmV0Y2hCbG9iID0gKGhhc2g6IHN0cmluZykgPT4gUHJvbWlzZTxVaW50OEFycmF5PjtcblxuZXhwb3J0IGludGVyZmFjZSBBcHBseVB1bGxPcHRpb25zIHtcbiAgLyoqIEVwb2NoIG1zIHVzZWQgZm9yIHRvbWJzdG9uZSB0aW1lc3RhbXBzLiBEZWZhdWx0OiBgRGF0ZS5ub3coKWAgXHUyMDE0IHRoaXNcbiAgICogIGZ1bmN0aW9uIGlzIEkvTyBvcmNoZXN0cmF0aW9uLCBub3QgYSBwdXJlIGZ1bmN0aW9uLCBidXQgdGVzdHMgaW5qZWN0XG4gICAqICBhIGZpeGVkIHZhbHVlIGZvciBkZXRlcm1pbmlzbS4gKi9cbiAgbm93PzogbnVtYmVyO1xufVxuXG4vKipcbiAqIEFwcGx5IGFsbCBwdWxscyBvZiBgcGxhbmAgYW5kIHJldHVybiB0aGUgdXBkYXRlZCBpbmRleCAoYWxzbyBwZXJzaXN0ZWQgdG9cbiAqIHRoZSBhZGFwdGVyIGF0IGBMT0NBTF9JTkRFWF9TVEFURV9QQVRIYCkuXG4gKlxuICogU3RvcmFnZSB3cml0ZXMgaGFwcGVuIGluIHBsYW4gb3JkZXIuIElmIGFueSBvcCBmYWlscywgdGhlIGluZGV4IHJlZmxlY3RpbmdcbiAqIGV2ZXJ5IG9wIHRoYXQgc3VjY2VlZGVkIHNvIGZhciBpcyBwZXJzaXN0ZWQgYW5kIHRoZSBvcmlnaW5hbCBlcnJvciBpc1xuICogcmV0aHJvd24gXHUyMDE0IHBhdGhzIHRoYXQgZmFpbGVkIGFyZSBhYnNlbnQgZnJvbSB0aGUgcmV0dXJuZWQvcGVyc2lzdGVkIGluZGV4LlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gYXBwbHlQdWxsKFxuICBzdG9yYWdlOiBTdG9yYWdlQWRhcHRlcixcbiAgaW5kZXg6IExvY2FsSW5kZXgsXG4gIHBsYW46IFN5bmNQbGFuLFxuICBmZXRjaEJsb2I6IEZldGNoQmxvYixcbiAgb3B0aW9uczogQXBwbHlQdWxsT3B0aW9ucyA9IHt9LFxuKTogUHJvbWlzZTxMb2NhbEluZGV4PiB7XG4gIGNvbnN0IG5vdyA9IG9wdGlvbnMubm93ID8/IERhdGUubm93KCk7XG4gIGxldCB3b3JraW5nOiBMb2NhbEluZGV4ID0gaW5kZXg7XG5cbiAgdHJ5IHtcbiAgICBmb3IgKGNvbnN0IHB1bGwgb2YgcGxhbi5wdWxscykge1xuICAgICAgd29ya2luZyA9IGF3YWl0IGFwcGx5T25lUHVsbChzdG9yYWdlLCB3b3JraW5nLCBwdWxsLCBmZXRjaEJsb2IsIG5vdyk7XG4gICAgfVxuICB9IGNhdGNoIChlcnJvcikge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCBwZXJzaXN0SW5kZXgoc3RvcmFnZSwgd29ya2luZyk7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBQZXJzaXN0ZW5jZSBmYWlsdXJlIG11c3Qgbm90IG1hc2sgdGhlIG9yaWdpbmFsIGVycm9yOyB0aGUgY2FsbGVyXG4gICAgICAvLyByZXRyaWVzIHRoZSB3aG9sZSBjeWNsZSBhbnl3YXkuXG4gICAgfVxuICAgIHRocm93IGVycm9yO1xuICB9XG5cbiAgYXdhaXQgcGVyc2lzdEluZGV4KHN0b3JhZ2UsIHdvcmtpbmcpO1xuICByZXR1cm4gd29ya2luZztcbn1cblxuYXN5bmMgZnVuY3Rpb24gYXBwbHlPbmVQdWxsKFxuICBzdG9yYWdlOiBTdG9yYWdlQWRhcHRlcixcbiAgaW5kZXg6IExvY2FsSW5kZXgsXG4gIHB1bGw6IFB1bGxPcCxcbiAgZmV0Y2hCbG9iOiBGZXRjaEJsb2IsXG4gIG5vdzogbnVtYmVyLFxuKTogUHJvbWlzZTxMb2NhbEluZGV4PiB7XG4gIGlmIChwdWxsLmtpbmQgPT09ICdyZW5hbWUnKSB7XG4gICAgaWYgKGF3YWl0IHN0b3JhZ2UuZXhpc3RzKHB1bGwuZnJvbVBhdGgpKSB7XG4gICAgICBhd2FpdCBzdG9yYWdlLnJlbmFtZUZpbGUocHVsbC5mcm9tUGF0aCwgcHVsbC50b1BhdGgpO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBPbGQgcGF0aCBuZXZlciBtYXRlcmlhbGl6ZWQgaGVyZSAob3IgYWxyZWFkeSBtb3ZlZCk6IGZldGNoIGNvbnRlbnQuXG4gICAgICBhd2FpdCBmZXRjaFZlcmlmaWVkKHN0b3JhZ2UsIHB1bGwudG9QYXRoLCBwdWxsLmhhc2gsIGZldGNoQmxvYik7XG4gICAgfVxuICAgIHJldHVybiBhcHBseUNvbW1pdChyZW1vdmVFbnRyeShpbmRleCwgcHVsbC5mcm9tUGF0aCksIHtcbiAgICAgIHBhdGg6IHB1bGwudG9QYXRoLFxuICAgICAgdmVyc2lvbklkOiBwdWxsLnZlcnNpb24sXG4gICAgICBoYXNoOiBwdWxsLmhhc2gsXG4gICAgICBzaXplOiBwdWxsLnNpemUsXG4gICAgICBjbG9jazogcHVsbC5jbG9jayxcbiAgICB9KTtcbiAgfVxuXG4gIGlmIChwdWxsLmlzRm9sZGVyKSB7XG4gICAgLy8gRm9sZGVyIHBsYWNlaG9sZGVycyAoRlItMTApOiBjcmVhdGUgdGhlIGRpcmVjdG9yeSwgcmVjb3JkIHRoZSBlbnRyeS5cbiAgICAvLyBUb21ic3RvbmVkIHBsYWNlaG9sZGVycyByZWNvcmQgb25seSBcdTIwMTQgZGVsZXRpbmcgYSBkaXJlY3RvcnkgZnJvbSBzdG9yYWdlXG4gICAgLy8gKGFuZCBjYXNjYWRpbmcgdG8gYW55IGZpbGVzIHBsYWNlZCBpbnNpZGUgaXQpIGlzIGEgcGxhdGZvcm0gY29uY2Vybi5cbiAgICBpZiAoIXB1bGwuZGVsZXRlZCkgYXdhaXQgc3RvcmFnZS5lbnN1cmVEaXIocHVsbC5wYXRoKTtcbiAgICByZXR1cm4gYXBwbHlDb21taXQoaW5kZXgsIHtcbiAgICAgIHBhdGg6IHB1bGwucGF0aCxcbiAgICAgIHZlcnNpb25JZDogcHVsbC52ZXJzaW9uLFxuICAgICAgaGFzaDogcHVsbC5oYXNoLFxuICAgICAgc2l6ZTogcHVsbC5zaXplLFxuICAgICAgY2xvY2s6IHB1bGwuY2xvY2ssXG4gICAgICBkZWxldGVkOiBwdWxsLmRlbGV0ZWQsXG4gICAgICBkZWxldGVkQXQ6IHB1bGwuZGVsZXRlZCA/IG5vdyA6IHVuZGVmaW5lZCxcbiAgICAgIGlzRm9sZGVyOiB0cnVlLFxuICAgIH0pO1xuICB9XG5cbiAgaWYgKHB1bGwuZGVsZXRlZCkge1xuICAgIC8vIElkZW1wb3RlbnQgcGVyIHRoZSBhZGFwdGVyIGNvbnRyYWN0OyBhIGxvY2FsIC50cmFzaCBjb3B5IGlzIGFcbiAgICAvLyBwbGF0Zm9ybS1sYXllciBjb25jZXJuIChkYWVtb24vcGx1Z2luKSwgbm90IGVuZ2luZSBsb2dpYy5cbiAgICBhd2FpdCBzdG9yYWdlLmRlbGV0ZUZpbGUocHVsbC5wYXRoKTtcbiAgICByZXR1cm4gYXBwbHlDb21taXQoaW5kZXgsIHtcbiAgICAgIHBhdGg6IHB1bGwucGF0aCxcbiAgICAgIHZlcnNpb25JZDogcHVsbC52ZXJzaW9uLFxuICAgICAgaGFzaDogcHVsbC5oYXNoLFxuICAgICAgc2l6ZTogcHVsbC5zaXplLFxuICAgICAgY2xvY2s6IHB1bGwuY2xvY2ssXG4gICAgICBkZWxldGVkOiB0cnVlLFxuICAgICAgZGVsZXRlZEF0OiBub3csXG4gICAgfSk7XG4gIH1cblxuICBjb25zdCBjdXJyZW50ID0gaW5kZXhbcHVsbC5wYXRoXTtcbiAgaWYgKFxuICAgIGN1cnJlbnQgIT09IHVuZGVmaW5lZCAmJlxuICAgIGN1cnJlbnQuZGVsZXRlZEF0ID09PSB1bmRlZmluZWQgJiZcbiAgICBjdXJyZW50Lmhhc2ggPT09IHB1bGwuaGFzaCAmJlxuICAgIChhd2FpdCBzdG9yYWdlLmV4aXN0cyhwdWxsLnBhdGgpKVxuICApIHtcbiAgICAvLyBDb250ZW50IGFscmVhZHkgY29ycmVjdCBsb2NhbGx5IChlLmcuIHZlcnNpb24taWQgY2F0Y2gtdXAgYWZ0ZXIgYVxuICAgIC8vIHJlbmFtZSBlbHNld2hlcmUpOiByZWNvcmQgdGhlIGF1dGhvcml0YXRpdmUgaGVhZCwgc2tpcCBmZXRjaCt3cml0ZS5cbiAgICAvLyBUaGUgZXhpc3RlbmNlIGNoZWNrIG1hdHRlcnMgd2hlbiB0aGUgZmlsZSB3YXMgZGVsZXRlZCBsb2NhbGx5IHNpbmNlIHRoZVxuICAgIC8vIGluZGV4IHdhcyBsYXN0IHdyaXR0ZW4gXHUyMDE0IHJlY3JlYXRpbmcgaXQgaXMgd2hhdCB0aGUgcHVsbCBkZW1hbmRzLlxuICAgIHJldHVybiBhcHBseUNvbW1pdChpbmRleCwge1xuICAgICAgcGF0aDogcHVsbC5wYXRoLFxuICAgICAgdmVyc2lvbklkOiBwdWxsLnZlcnNpb24sXG4gICAgICBoYXNoOiBwdWxsLmhhc2gsXG4gICAgICBzaXplOiBwdWxsLnNpemUsXG4gICAgICBjbG9jazogcHVsbC5jbG9jayxcbiAgICB9KTtcbiAgfVxuXG4gIGF3YWl0IGZldGNoVmVyaWZpZWQoc3RvcmFnZSwgcHVsbC5wYXRoLCBwdWxsLmhhc2gsIGZldGNoQmxvYik7XG4gIHJldHVybiBhcHBseUNvbW1pdChpbmRleCwge1xuICAgIHBhdGg6IHB1bGwucGF0aCxcbiAgICB2ZXJzaW9uSWQ6IHB1bGwudmVyc2lvbixcbiAgICBoYXNoOiBwdWxsLmhhc2gsXG4gICAgc2l6ZTogcHVsbC5zaXplLFxuICAgIGNsb2NrOiBwdWxsLmNsb2NrLFxuICB9KTtcbn1cblxuLyoqIERvd25sb2FkLCB2ZXJpZnksIGFuZCB3cml0ZSBvbmUgYmxvYi4gQSBoYXNoIG1pc21hdGNoIGFib3J0cyB0aGUgcGxhbi4gKi9cbmFzeW5jIGZ1bmN0aW9uIGZldGNoVmVyaWZpZWQoXG4gIHN0b3JhZ2U6IFN0b3JhZ2VBZGFwdGVyLFxuICBwYXRoOiBzdHJpbmcsXG4gIGhhc2g6IHN0cmluZyxcbiAgZmV0Y2hCbG9iOiBGZXRjaEJsb2IsXG4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgY29uc3QgYnl0ZXMgPSBhd2FpdCBmZXRjaEJsb2IoaGFzaCk7XG4gIGNvbnN0IGFjdHVhbCA9IGF3YWl0IHNoYTI1NkhleChieXRlcyk7XG4gIGlmIChhY3R1YWwgIT09IGhhc2gpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICBgQmxvYiBoYXNoIG1pc21hdGNoIGZvciAke0pTT04uc3RyaW5naWZ5KHBhdGgpfTogZXhwZWN0ZWQgJHtoYXNofSwgZ290ICR7YWN0dWFsfWAsXG4gICAgKTtcbiAgfVxuICBhd2FpdCBzdG9yYWdlLndyaXRlRmlsZShwYXRoLCBieXRlcyk7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIHBlcnNpc3RJbmRleChzdG9yYWdlOiBTdG9yYWdlQWRhcHRlciwgaW5kZXg6IExvY2FsSW5kZXgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgYXdhaXQgc3RvcmFnZS53cml0ZUZpbGUoXG4gICAgTE9DQUxfSU5ERVhfU1RBVEVfUEFUSCxcbiAgICBuZXcgVGV4dEVuY29kZXIoKS5lbmNvZGUoc2VyaWFsaXplTG9jYWxJbmRleChpbmRleCkpLFxuICApO1xufVxuXG4vKipcbiAqIExvYWQgdGhlIHBlcnNpc3RlZCBpbmRleCBmcm9tIHN0b3JhZ2UgKEFSQ0hJVEVDVFVSRSBcdTAwQTc4IHN0ZXAgMSkuIFRocm93c1xuICogYFByb3RvY29sRXJyb3JgICh2aWEgYGRlc2VyaWFsaXplTG9jYWxJbmRleGApIG9uIGNvcnJ1cHQgb3IgZnV0dXJlLXNjaGVtYVxuICogc3RhdGUgXHUyMDE0IGNhbGxlcnMgc3VyZmFjZSB0aGF0IGluc3RlYWQgb2Ygc2lsZW50bHkgcmUtc3luY2luZyBmcm9tIHNjcmF0Y2guXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBsb2FkTG9jYWxJbmRleChzdG9yYWdlOiBTdG9yYWdlQWRhcHRlcik6IFByb21pc2U8TG9jYWxJbmRleD4ge1xuICBjb25zdCBieXRlcyA9IGF3YWl0IHN0b3JhZ2UucmVhZEZpbGUoTE9DQUxfSU5ERVhfU1RBVEVfUEFUSCk7XG4gIHJldHVybiBkZXNlcmlhbGl6ZUxvY2FsSW5kZXgobmV3IFRleHREZWNvZGVyKCkuZGVjb2RlKGJ5dGVzKSk7XG59XG4iLCAiLyoqXG4gKiBWYXVsdCBpZ25vcmUgcnVsZXMgKEFSQ0hJVEVDVFVSRS5tZCBcdTAwQTc0LCBGUi0xMS9GUi00MikgXHUyMDE0IHNoYXJlZCBieSBldmVyeVxuICogY2xpZW50IHNvIGxvY2FsIHNjYW5zLCB3YXRjaGVycywgYW5kIGNvbW1pdCBwYXRocyBhZ3JlZSBieXRlLWZvci1ieXRlLlxuICpcbiAqIE1hdGNoaW5nIGlzIHNlZ21lbnQtYmFzZWQgYW5kIGNhc2UtaW5zZW5zaXRpdmUgKHRoZSBvd25lcidzIHByaW1hcnlcbiAqIHBsYXRmb3JtcyBcdTIwMTQgV2luZG93cywgbWFjT1MgXHUyMDE0IGhhdmUgY2FzZS1pbnNlbnNpdGl2ZSBmaWxlc3lzdGVtcywgc29cbiAqIGAuVHJhc2gvZm9vLm1kYCBtdXN0IG5vdCBzbmVhayBwYXN0IHRoZSBgLnRyYXNoL2AgcnVsZSkuXG4gKi9cblxuaW1wb3J0IHsgbm9ybWFsaXplVmF1bHRQYXRoIH0gZnJvbSAnLi9wYXRocy5qcyc7XG5cbi8qKiBTZXR0aW5ncyBzdWJzZXQgYGlzSWdub3JlZGAgbmVlZHM7IGBWYXVsdFNldHRpbmdzYCBzYXRpc2ZpZXMgaXQuICovXG5leHBvcnQgaW50ZXJmYWNlIElnbm9yZVNldHRpbmdzIHtcbiAgb2JzaWRpYW5TeW5jOiBib29sZWFuO1xuICAvKipcbiAgICogVXNlci1kZWZpbmVkIGV4dHJhIGlnbm9yZSBwYXR0ZXJucyAoY2xpZW50LXNpZGUgb25seSkuIEdsb2ItbGl0ZSBzeW50YXg6XG4gICAqIGAqYCBtYXRjaGVzIHdpdGhpbiBvbmUgcGF0aCBzZWdtZW50LCBhIHdob2xlIGAqKmAgc2VnbWVudCBzcGFucyBhbnlcbiAgICogbnVtYmVyIG9mIHNlZ21lbnRzLCBtYXRjaGluZyBpcyBjYXNlLWluc2Vuc2l0aXZlLiBBIHBhdHRlcm4gY29udGFpbmluZ1xuICAgKiBgL2AgaXMgYW5jaG9yZWQgYXQgdGhlIHZhdWx0IHJvb3QgKGBwcml2YXRlLyoqYCk7IGEgYmFyZSBwYXR0ZXJuIHdpdGhvdXRcbiAgICogYC9gIG1hdGNoZXMgYSBmaWxlIE5BTUUgYXQgYW55IGRlcHRoIChgKi50bXBgKS4gRW1wdHkgbGluZXMgYXJlIGlnbm9yZWQuXG4gICAqL1xuICBleHRyYUlnbm9yZXM/OiByZWFkb25seSBzdHJpbmdbXTtcbn1cblxuLyoqIElnbm9yZWQgd2hlcmV2ZXIgdGhleSBhcHBlYXIsIGFzIGFueSBwYXRoIHNlZ21lbnQgKGRpciBvciBmaWxlIG5hbWUpLiAqL1xuY29uc3QgQUxXQVlTX0lHTk9SRURfU0VHTUVOVFM6IFJlYWRvbmx5U2V0PHN0cmluZz4gPSBuZXcgU2V0KFtcbiAgJy50cmFzaCcsIC8vIGxvY2FsIGRlbGV0ZS1yZWNvdmVyeSBkaXIgKEZSLTQyKVxuICAnLmRzX3N0b3JlJyxcbiAgJy52YXVsdHN5bmNmb3JhZ2VudHMnLCAvLyBjbGllbnQgc3RhdGUgZGlyIChsb2NhbCBpbmRleCkgaW5zaWRlIHRoZSB2YXVsdFxuICAndGh1bWJzLmRiJyxcbl0pO1xuXG4vKiogYC5vYnNpZGlhbi9gIGZpbGVzIGV4Y2x1ZGVkIGV2ZW4gd2hlbiBgLm9ic2lkaWFuL2Agc3luYyBpcyBvcHRlZCBpbi4gKi9cbmNvbnN0IE9CU0lESUFOX1ZPTEFUSUxFX0ZJTEVTOiBSZWFkb25seVNldDxzdHJpbmc+ID0gbmV3IFNldChbXG4gICcub2JzaWRpYW4vd29ya3NwYWNlLmpzb24nLFxuICAnLm9ic2lkaWFuL3dvcmtzcGFjZS1tb2JpbGUuanNvbicsXG5dKTtcblxuLyoqXG4gKiBXaGV0aGVyIGB2YXVsdFBhdGhgIG11c3QgYmUgZXhjbHVkZWQgZnJvbSBzeW5jLlxuICpcbiAqIEFsd2F5cyBpZ25vcmVkOiBgLnRyYXNoL2AsIGAuRFNfU3RvcmVgLCBgVGh1bWJzLmRiYCwgYC52YXVsdHN5bmNmb3JhZ2VudHMvYFxuICogKGFueSBkZXB0aCkuIGAub2JzaWRpYW4vYCBpcyBpZ25vcmVkIGVudGlyZWx5IHdoZW4gYHNldHRpbmdzLm9ic2lkaWFuU3luY2BcbiAqIGlzIGZhbHNlOyB3aGVuIHRydWUsIGV2ZXJ5dGhpbmcgdW5kZXIgaXQgc3luY3MgZXhjZXB0IGB3b3Jrc3BhY2UuanNvbmAsXG4gKiBgd29ya3NwYWNlLW1vYmlsZS5qc29uYCwgYW5kIGAub2JzaWRpYW4vY2FjaGUvYC4gRmluYWxseSwgZXZlcnkgcGF0dGVybiBpblxuICogYHNldHRpbmdzLmV4dHJhSWdub3Jlc2AgaXMgbWF0Y2hlZCAoZ2xvYi1saXRlIFx1MjAxNCBzZWUgYElnbm9yZVNldHRpbmdzYCkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0lnbm9yZWQodmF1bHRQYXRoOiBzdHJpbmcsIHNldHRpbmdzOiBJZ25vcmVTZXR0aW5ncyk6IGJvb2xlYW4ge1xuICBjb25zdCBub3JtYWxpemVkID0gbm9ybWFsaXplVmF1bHRQYXRoKHZhdWx0UGF0aCk7XG4gIGlmIChub3JtYWxpemVkID09PSAnLycpIHJldHVybiBmYWxzZTtcblxuICBjb25zdCBsb3dlciA9IG5vcm1hbGl6ZWQuc2xpY2UoMSkudG9Mb3dlckNhc2UoKTtcbiAgY29uc3Qgc2VnbWVudHMgPSBsb3dlci5zcGxpdCgnLycpO1xuXG4gIGlmIChzZWdtZW50cy5zb21lKChzZWdtZW50KSA9PiBBTFdBWVNfSUdOT1JFRF9TRUdNRU5UUy5oYXMoc2VnbWVudCkpKSB7XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cblxuICBpZiAoc2VnbWVudHNbMF0gPT09ICcub2JzaWRpYW4nKSB7XG4gICAgaWYgKCFzZXR0aW5ncy5vYnNpZGlhblN5bmMpIHJldHVybiB0cnVlO1xuICAgIGlmIChPQlNJRElBTl9WT0xBVElMRV9GSUxFUy5oYXMobG93ZXIpKSByZXR1cm4gdHJ1ZTtcbiAgICBpZiAoc2VnbWVudHNbMV0gPT09ICdjYWNoZScpIHJldHVybiB0cnVlOyAvLyB0aGUgZGlyIGl0c2VsZiBhbmQgYW55dGhpbmcgdW5kZXIgaXRcbiAgfVxuXG4gIGNvbnN0IGV4dHJhcyA9IHNldHRpbmdzLmV4dHJhSWdub3JlcztcbiAgaWYgKGV4dHJhcyAhPT0gdW5kZWZpbmVkICYmIGV4dHJhcy5sZW5ndGggPiAwKSB7XG4gICAgZm9yIChjb25zdCBwYXR0ZXJuIG9mIGV4dHJhcykge1xuICAgICAgY29uc3QgY29tcGlsZWQgPSBjb21waWxlRXh0cmFJZ25vcmUocGF0dGVybik7XG4gICAgICBpZiAoY29tcGlsZWQgIT09IG51bGwgJiYgbWF0Y2hlc1NlZ21lbnRzKGNvbXBpbGVkLCBzZWdtZW50cykpIHJldHVybiB0cnVlO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiBmYWxzZTtcbn1cblxuLy8gLS0tIGV4dHJhIGlnbm9yZSBwYXR0ZXJucyAoZ2xvYi1saXRlKSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIEEgY29tcGlsZWQgZXh0cmEtaWdub3JlIHBhdHRlcm46IGxvd2VyY2FzZWQsIGAvYC1zcGxpdCBzZWdtZW50cy4gKi9cbnR5cGUgQ29tcGlsZWRQYXR0ZXJuID0geyBzZWdtZW50czogcmVhZG9ubHkgc3RyaW5nW107IGFuY2hvcmVkOiBib29sZWFuIH07XG5cbi8qKlxuICogTm9ybWFsaXplIG9uZSB1c2VyIHBhdHRlcm4gaW50byBtYXRjaGFibGUgc2VnbWVudHMuIFJldHVybnMgYG51bGxgIGZvclxuICogYmxhbmsgcGF0dGVybnMgKHRoZXkgY2FuIG5ldmVyIG1hdGNoIFx1MjAxNCBhbmQgbXVzdCBub3QgYmVjb21lIFwiaWdub3JlXG4gKiBldmVyeXRoaW5nXCIgYnkgYWNjaWRlbnQpLiBBIGxlYWRpbmcvdHJhaWxpbmcgYC9gIGlzIHRvbGVyYXRlZCBhbmQgc3RyaXBwZWQ7XG4gKiBgYW5jaG9yZWRgIHJlY29yZHMgd2hldGhlciB0aGUgcGF0dGVybiBuYW1lcyBhIHBhdGggKG1hdGNoZWQgZnJvbSB0aGVcbiAqIHZhdWx0IHJvb3QpIG9yIGEgYmFyZSBuYW1lIChtYXRjaGVkIGFnYWluc3QgYW55IHN1ZmZpeCBvZiB0aGUgcGF0aCkuXG4gKi9cbmZ1bmN0aW9uIGNvbXBpbGVFeHRyYUlnbm9yZShwYXR0ZXJuOiBzdHJpbmcpOiBDb21waWxlZFBhdHRlcm4gfCBudWxsIHtcbiAgbGV0IGNsZWFuZWQgPSBwYXR0ZXJuLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xuICB3aGlsZSAoY2xlYW5lZC5zdGFydHNXaXRoKCcvJykpIGNsZWFuZWQgPSBjbGVhbmVkLnNsaWNlKDEpO1xuICB3aGlsZSAoY2xlYW5lZC5lbmRzV2l0aCgnLycpKSBjbGVhbmVkID0gY2xlYW5lZC5zbGljZSgwLCAtMSk7XG4gIGlmIChjbGVhbmVkID09PSAnJykgcmV0dXJuIG51bGw7XG4gIHJldHVybiB7IHNlZ21lbnRzOiBjbGVhbmVkLnNwbGl0KCcvJyksIGFuY2hvcmVkOiBjbGVhbmVkLmluY2x1ZGVzKCcvJykgfTtcbn1cblxuLyoqIFBhdHRlcm4gdnMgcGF0aCBzZWdtZW50czsgYGFuY2hvcmVkYCBwYXR0ZXJucyBtYXkgYWxzbyBzdGFydCBkZWVwZXIuICovXG5mdW5jdGlvbiBtYXRjaGVzU2VnbWVudHMocGF0dGVybjogQ29tcGlsZWRQYXR0ZXJuLCBwYXRoOiByZWFkb25seSBzdHJpbmdbXSk6IGJvb2xlYW4ge1xuICBpZiAocGF0dGVybi5hbmNob3JlZCkge1xuICAgIHJldHVybiBzZWdtZW50c01hdGNoKHBhdHRlcm4uc2VnbWVudHMsIHBhdGgpO1xuICB9XG4gIC8vIEJhcmUgbmFtZSBwYXR0ZXJuOiBtYXRjaCBhbnkgdHJhaWxpbmcgc2VnbWVudCBydW4gKGAqLnRtcGAgYXQgYW55IGRlcHRoKS5cbiAgZm9yIChsZXQgc3RhcnQgPSAwOyBzdGFydCA8IHBhdGgubGVuZ3RoOyBzdGFydCsrKSB7XG4gICAgaWYgKHNlZ21lbnRzTWF0Y2gocGF0dGVybi5zZWdtZW50cywgcGF0aC5zbGljZShzdGFydCkpKSByZXR1cm4gdHJ1ZTtcbiAgfVxuICByZXR1cm4gZmFsc2U7XG59XG5cbi8qKiBHbG9iLWxpdGUgc2VnbWVudCBtYXRjaGluZzogYCpgIGluc2lkZSBhIHNlZ21lbnQsIGAqKmAgYXMgYSB3aG9sZSBzZWdtZW50LiAqL1xuZnVuY3Rpb24gc2VnbWVudHNNYXRjaChwYXR0ZXJuOiByZWFkb25seSBzdHJpbmdbXSwgcGF0aDogcmVhZG9ubHkgc3RyaW5nW10pOiBib29sZWFuIHtcbiAgaWYgKHBhdHRlcm4ubGVuZ3RoID09PSAwKSByZXR1cm4gcGF0aC5sZW5ndGggPT09IDA7XG4gIGNvbnN0IGhlYWQgPSBwYXR0ZXJuWzBdO1xuICBjb25zdCByZXN0ID0gcGF0dGVybi5zbGljZSgxKTtcbiAgaWYgKGhlYWQgPT09IHVuZGVmaW5lZCkgcmV0dXJuIHBhdGgubGVuZ3RoID09PSAwO1xuICBpZiAoaGVhZCA9PT0gJyoqJykge1xuICAgIC8vIGAqKmAgY29uc3VtZXMgemVybyBvciBtb3JlIHBhdGggc2VnbWVudHMuXG4gICAgZm9yIChsZXQgc2tpcCA9IDA7IHNraXAgPD0gcGF0aC5sZW5ndGg7IHNraXArKykge1xuICAgICAgaWYgKHNlZ21lbnRzTWF0Y2gocmVzdCwgcGF0aC5zbGljZShza2lwKSkpIHJldHVybiB0cnVlO1xuICAgIH1cbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgaWYgKHBhdGgubGVuZ3RoID09PSAwIHx8ICFzZWdtZW50TWF0Y2goaGVhZCwgcGF0aFswXSEpKSByZXR1cm4gZmFsc2U7XG4gIHJldHVybiBzZWdtZW50c01hdGNoKHJlc3QsIHBhdGguc2xpY2UoMSkpO1xufVxuXG4vKiogT25lIHNlZ21lbnQ6IGxpdGVyYWwgdGV4dCB3aXRoIGAqYCB3aWxkY2FyZHMgKGFueSBydW4gd2l0aGluIHRoZSBzZWdtZW50KS4gKi9cbmZ1bmN0aW9uIHNlZ21lbnRNYXRjaChwYXR0ZXJuOiBzdHJpbmcsIHNlZ21lbnQ6IHN0cmluZyk6IGJvb2xlYW4ge1xuICBpZiAoIXBhdHRlcm4uaW5jbHVkZXMoJyonKSkgcmV0dXJuIHBhdHRlcm4gPT09IHNlZ21lbnQ7XG4gIGNvbnN0IGZpcnN0ID0gcGF0dGVybi5pbmRleE9mKCcqJyk7XG4gIGNvbnN0IGxhc3QgPSBwYXR0ZXJuLmxhc3RJbmRleE9mKCcqJyk7XG4gIGlmICghc2VnbWVudC5zdGFydHNXaXRoKHBhdHRlcm4uc2xpY2UoMCwgZmlyc3QpKSkgcmV0dXJuIGZhbHNlO1xuICBpZiAoIXNlZ21lbnQuZW5kc1dpdGgocGF0dGVybi5zbGljZShsYXN0ICsgMSkpKSByZXR1cm4gZmFsc2U7XG4gIGxldCBpbmRleCA9IGZpcnN0O1xuICBmb3IgKGNvbnN0IG1pZGRsZSBvZiBwYXR0ZXJuLnNsaWNlKGZpcnN0LCBsYXN0ICsgMSkuc3BsaXQoJyonKS5zbGljZSgxLCAtMSkpIHtcbiAgICBjb25zdCBmb3VuZCA9IHNlZ21lbnQuaW5kZXhPZihtaWRkbGUsIGluZGV4KTtcbiAgICBpZiAoZm91bmQgPT09IC0xKSByZXR1cm4gZmFsc2U7XG4gICAgaW5kZXggPSBmb3VuZCArIG1pZGRsZS5sZW5ndGg7XG4gIH1cbiAgcmV0dXJuIHRydWU7XG59XG4iLCAiLyoqXG4gKiBUeXBlZCBXZWJTb2NrZXQgbWVzc2FnZSBkZWZpbml0aW9ucyBmb3IgdGhlIGAvc3luY2AgY2hhbm5lbFxuICogKEFSQ0hJVEVDVFVSRS5tZCBcdTAwQTc1KS4gQWxsIG1lc3NhZ2VzIGFyZSBKU09OIHdpdGggYSBgdHlwZWAgZGlzY3JpbWluYW50LlxuICpcbiAqIFR3byBjaGFubmVscyBleGlzdDogdGhpcyBXUyBwcm90b2NvbCAobWV0YWRhdGEgKyBjaGFuZ2UgZmVlZCkgYW5kIHBsYWluXG4gKiBIVFRQUyBibG9iIHJvdXRlcyAoYEdFVC9QVVQgL2Jsb2IvOmhhc2hgKSBmb3IgY29udGVudCBcdTIwMTQgcmVmZXJlbmNlZCBoZXJlXG4gKiBvbmx5IHZpYSBjb250ZW50IGhhc2hlcy5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IExvZ2ljYWxDbG9jaywgVmVyc2lvbiwgVmVyc2lvbktpbmQsIFZhdWx0U2V0dGluZ3MgfSBmcm9tICcuL3R5cGVzLmpzJztcbmltcG9ydCB7IFByb3RvY29sRXJyb3IgfSBmcm9tICcuL2Vycm9ycy5qcyc7XG5cbi8qKiBXaXJlIHByb3RvY29sIHZlcnNpb24uIEJ1bXAgb24gYnJlYWtpbmcgbWVzc2FnZS1zaGFwZSBjaGFuZ2VzLiAqL1xuZXhwb3J0IGNvbnN0IFByb3RvY29sVmVyc2lvbiA9IDEgYXMgY29uc3Q7XG5cbi8qKiBDb21taXRzIGF0IG9yIGJlbG93IHRoaXMgc2l6ZSBtYXkgaW5saW5lIGNvbnRlbnQgKGJhc2U2NCkgb24gdGhlIFdTLiAqL1xuZXhwb3J0IGNvbnN0IElOTElORV9DT05URU5UX01BWF9CWVRFUyA9IDI1NiAqIDEwMjQ7XG5cbi8qKlxuICogT25lIGVudHJ5IG9mIHRoZSBtYW5pZmVzdCBtYXAgKGB7cGF0aCBcdTIxOTIgTWFuaWZlc3RFbnRyeX1gKS4gVGhlIGVudHJ5IGlzXG4gKiBzZWxmLWRlc2NyaWJpbmc6IGl0IGNhcnJpZXMgaXRzIG93biBgcGF0aGAgYW5kIHRoZSBoZWFkJ3MgYGNsb2NrYCBzbyB0aGVcbiAqIGNsaWVudC1zaWRlIHJlY29uY2lsaWF0aW9uIChgcmVzb2x2ZS50c2ApIGNhbiBvcmRlciByZW1vdGUgc3RhdGUgYWdhaW5zdFxuICogbG9jYWwgc3RhdGUgd2l0aG91dCBhbnkgZXh0cmEgcm91bmQtdHJpcHMuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgTWFuaWZlc3RFbnRyeSB7XG4gIC8qKiBOb3JtYWxpemVkIHZhdWx0IHBhdGggdGhpcyBlbnRyeSBkZXNjcmliZXMgKG1pcnJvcnMgdGhlIG1hcCBrZXkpLiAqL1xuICBwYXRoOiBzdHJpbmc7XG4gIC8qKiBWZXJzaW9uIGlkIG9mIHRoZSBlbnRyeSdzIGhlYWQuICovXG4gIHZlcnNpb246IHN0cmluZztcbiAgLyoqIHNoYTI1NiBoZXggb2YgY3VycmVudCBjb250ZW50IChgJydgIGZvciBmb2xkZXIgcGxhY2Vob2xkZXJzKS4gKi9cbiAgaGFzaDogc3RyaW5nO1xuICAvKiogQ29udGVudCBzaXplIGluIGJ5dGVzIChgMGAgZm9yIGZvbGRlciBwbGFjZWhvbGRlcnMpLiAqL1xuICBzaXplOiBudW1iZXI7XG4gIC8qKiBUb21ic3RvbmUgZmxhZy4gKi9cbiAgZGVsZXRlZDogYm9vbGVhbjtcbiAgLyoqIExvZ2ljYWwgY2xvY2sgb2YgdGhlIGhlYWQgXHUyMDE0IHRoZSBvcmRlcmluZyBhdXRob3JpdHkgKFx1MDBBNzQpLiAqL1xuICBjbG9jazogTG9naWNhbENsb2NrO1xuICAvKiogVHJ1ZSBmb3IgZW1wdHktZm9sZGVyIHBsYWNlaG9sZGVyIGVudHJpZXMgKEZSLTEwKS4gKi9cbiAgaXNGb2xkZXI/OiBib29sZWFuO1xuICAvKiogRXBvY2ggbXMgb2YgbGFzdCB1cGRhdGUsIGRpc3BsYXktb25seS4gKi9cbiAgbXRpbWU6IG51bWJlcjtcbn1cblxuLy8gLS0tIENsaWVudCBcdTIxOTIgU2VydmVyIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIEF1dGggKyBjYXRjaC11cDogdG9rZW4sIHByb3RvY29sIHZlcnNpb24sIGxhc3Qgc2VlbiBETyBzZXF1ZW5jZSBudW1iZXIuICovXG5leHBvcnQgaW50ZXJmYWNlIEhlbGxvTWVzc2FnZSB7XG4gIHR5cGU6ICdoZWxsbyc7XG4gIHRva2VuOiBzdHJpbmc7XG4gIHByb3RvY29sVmVyc2lvbjogbnVtYmVyO1xuICAvKiogTGFzdCBzZWVuIGdsb2JhbCBzZXF1ZW5jZSBudW1iZXI7IDAgZm9yIGEgZmlyc3QtZXZlciBjb25uZWN0LiAqL1xuICBjdXJzb3I6IG51bWJlcjtcbn1cblxuLyoqIFJlcXVlc3QgZnVsbCAoYHNpbmNlYCBvbWl0dGVkKSBvciBkZWx0YSBtYW5pZmVzdC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgR2V0TWFuaWZlc3RNZXNzYWdlIHtcbiAgdHlwZTogJ2dldE1hbmlmZXN0JztcbiAgc2luY2U/OiBudW1iZXI7XG59XG5cbi8qKlxuICogQ29tbWl0IGEgbmV3IHZlcnNpb24uIElmIGBpbmxpbmVgIGlzIHNldCBpdCBjYXJyaWVzIHRoZSBmdWxsIGNvbnRlbnRcbiAqIGJhc2U2NC1lbmNvZGVkIChvbmx5IGFsbG93ZWQgd2hlbiBgc2l6ZSA8PSBJTkxJTkVfQ09OVEVOVF9NQVhfQllURVNgKTtcbiAqIG90aGVyd2lzZSB0aGUgYmxvYiBtdXN0IGFscmVhZHkgYmUgdXBsb2FkZWQgKGBwdXRCbG9iYCBvbiB0aGlzIGNoYW5uZWwsXG4gKiBgUFVUIC9ibG9iLzpoYXNoYCBvbiB0aGUgcmVhbCB3b3JrZXIpLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIENvbW1pdE1lc3NhZ2Uge1xuICB0eXBlOiAnY29tbWl0JztcbiAgcGF0aDogc3RyaW5nO1xuICAvKiogVmVyc2lvbiBpZCB0aGUgY29tbWl0IGJ1aWxkcyBvbjsgc2VydmVyIGRldGVjdHMgZGl2ZXJnZW5jZSBcdTIxOTIgY29uZmxpY3QuICovXG4gIHBhcmVudFZlcnNpb246IHN0cmluZyB8IG51bGw7XG4gIGhhc2g6IHN0cmluZztcbiAgc2l6ZTogbnVtYmVyO1xuICAvKiogV2hhdCBraW5kIG9mIHZlcnNpb24gdGhpcyBjb21taXRzIChtaXJyb3JzIGBWZXJzaW9uLmtpbmRgKS4gKi9cbiAga2luZDogVmVyc2lvbktpbmQ7XG4gIGlubGluZT86IHN0cmluZztcbiAgLyoqIFNvdXJjZSBwYXRoIFx1MjAxNCByZXF1aXJlZCBmb3IgYGtpbmQ6ICdyZW5hbWUnYCAoY2hhaW4gbWlncmF0aW9uLCBGUi05KS4gKi9cbiAgZnJvbVBhdGg/OiBzdHJpbmc7XG4gIC8qKiBUcnVlIGZvciBlbXB0eS1mb2xkZXIgcGxhY2Vob2xkZXIgY29tbWl0cyAoRlItMTA7IGhhc2ggYCcnYCwgc2l6ZSAwKS4gKi9cbiAgaXNGb2xkZXI/OiBib29sZWFuO1xufVxuXG4vKiogS2VlcGFsaXZlLiAqL1xuZXhwb3J0IGludGVyZmFjZSBQaW5nTWVzc2FnZSB7XG4gIHR5cGU6ICdwaW5nJztcbiAgLyoqIENsaWVudCBlcG9jaCBtczsgZWNob2VkIGJhY2sgb24gYHBvbmdgIGZvciBSVFQgLyBza2V3IG1lYXN1cmVtZW50LiAqL1xuICB0cz86IG51bWJlcjtcbn1cblxuLyoqXG4gKiBVcGxvYWQgYSBjb250ZW50IGJsb2Igb3ZlciB0aGUgc3luYyBjaGFubmVsLiBUZXN0IGRvdWJsZXMgYW5kIHNtYWxsIHZhdWx0c1xuICogY2FuIHVzZSB0aGlzIGRpcmVjdGx5OyB0aGUgcmVhbCB3b3JrZXIgZXhwb3NlcyB0aGUgc2FtZSBvcGVyYXRpb24gYXNcbiAqIGBQVVQgL2Jsb2IvOmhhc2hgIChzdHJlYW1lZCkuIElkZW1wb3RlbnQ6IHNhbWUgaGFzaCBcdTIxRDIgc2FtZSBjb250ZW50LlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFB1dEJsb2JNZXNzYWdlIHtcbiAgdHlwZTogJ3B1dEJsb2InO1xuICBoYXNoOiBzdHJpbmc7XG4gIC8qKiBGdWxsIGNvbnRlbnQsIGJhc2U2NC1lbmNvZGVkLiAqL1xuICBjb250ZW50OiBzdHJpbmc7XG59XG5cbi8qKiBGZXRjaCBhIGNvbnRlbnQgYmxvYiAodGhlIFdTLWlubGluZSBwYXRoIG9mIFx1MDBBNzggXCJmZXRjaCBibG9iXCIpLiAqL1xuZXhwb3J0IGludGVyZmFjZSBHZXRCbG9iTWVzc2FnZSB7XG4gIHR5cGU6ICdnZXRCbG9iJztcbiAgaGFzaDogc3RyaW5nO1xufVxuXG4vLyAtLS0gU2VydmVyIFx1MjE5MiBDbGllbnQgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogU3VjY2Vzc2Z1bCBoZWxsbzogdGhpcyBkZXZpY2UncyBpZGVudGl0eSArIHZhdWx0LWxldmVsIGluZm8uICovXG5leHBvcnQgaW50ZXJmYWNlIEhlbGxvQWNrTWVzc2FnZSB7XG4gIHR5cGU6ICdoZWxsb0Fjayc7XG4gIGRldmljZUlkOiBzdHJpbmc7XG4gIHZhdWx0TmFtZTogc3RyaW5nO1xuICBzZXR0aW5nczogVmF1bHRTZXR0aW5ncztcbn1cblxuLyoqIFJlcGx5IHRvIGBnZXRNYW5pZmVzdGA6IHRoZSAocG9zc2libHkgZGVsdGEpIGZpbGUgaW5kZXguICovXG5leHBvcnQgaW50ZXJmYWNlIE1hbmlmZXN0TWVzc2FnZSB7XG4gIHR5cGU6ICdtYW5pZmVzdCc7XG4gIGVudHJpZXM6IFJlYWRvbmx5PFJlY29yZDxzdHJpbmcsIE1hbmlmZXN0RW50cnk+PjtcbiAgLyoqIEdsb2JhbCBzZXF1ZW5jZSBudW1iZXIgdGhpcyBtYW5pZmVzdCByZWZsZWN0cyAoY3Vyc29yIGNhdGNoLXVwKS4gKi9cbiAgY3Vyc29yOiBudW1iZXI7XG59XG5cbi8qKiBDb21taXQgYWNjZXB0ZWQgYXMgdGhlIG5ldyBoZWFkLiAqL1xuZXhwb3J0IGludGVyZmFjZSBDb21taXRBY2tNZXNzYWdlIHtcbiAgdHlwZTogJ2NvbW1pdEFjayc7XG4gIC8qKiBWZXJzaW9uIGlkIGFzc2lnbmVkIGJ5IHRoZSBhdXRob3JpdHkuICovXG4gIHZlcnNpb246IHN0cmluZztcbiAgLyoqIExvZ2ljYWwgY2xvY2sgb2YgdGhlIGFjY2VwdGVkIHZlcnNpb24uICovXG4gIGNsb2NrOiBMb2dpY2FsQ2xvY2s7XG4gIC8qKiBHbG9iYWwgc2VxdWVuY2UgbnVtYmVyIG9mIHRoZSBhY2NlcHRlZCBoZWFkIChjdXJzb3IgdHJhY2tpbmcpLiAqL1xuICBzZXE6IG51bWJlcjtcbn1cblxuLyoqIFdoYXQgaGFwcGVuZWQgdG8gdGhlIGxvc2luZyBzaWRlIG9mIGEgY29uY3VycmVudCBlZGl0IChzZWUgZGlzcG9zaXRpb24pLiAqL1xuZXhwb3J0IHR5cGUgQ29uZmxpY3RMb3NlckRpc3Bvc2l0aW9uID0gJ2NvbmZsaWN0Q29weSc7XG5cbi8qKiBDb21taXQgbG9zdCB0aGUgcmFjZTsgdGhlIHNlcnZlcidzIGNob3NlbiB3aW5uZXIgc3RhbmRzLiAqL1xuZXhwb3J0IGludGVyZmFjZSBDb25mbGljdE1lc3NhZ2Uge1xuICB0eXBlOiAnY29uZmxpY3QnO1xuICAvKiogVGhlIHdpbm5pbmcgdmVyc2lvbiAodGhpcyBjb21taXQgb3IgdGhlIGNvbmN1cnJlbnQgb25lKS4gKi9cbiAgd2lubmVyOiBWZXJzaW9uO1xuICAvKiogV2hhdCB0aGUgc2VydmVyIGRpZCB3aXRoIHRoZSBsb3NlcidzIGNvbnRlbnQgXHUyMDE0IG5ldmVyIGRlbGV0ZWQuICovXG4gIGxvc2VyRGlzcG9zaXRpb246IENvbmZsaWN0TG9zZXJEaXNwb3NpdGlvbjtcbiAgLyoqIEdsb2JhbCBzZXF1ZW5jZSBudW1iZXIgb2YgdGhlIHdpbm5pbmcgaGVhZCwgd2hlbiBpdCBoYXMgb25lLiAqL1xuICBzZXE/OiBudW1iZXI7XG59XG5cbi8qKlxuICogRmFuLW91dCBwYXlsb2FkIHNoYXJlZCBieSB0aGUgY2hhbmdlIGJyb2FkY2FzdCBhbmQgdGhlIGFyYml0cmF0aW9uIHJlc3VsdC5cbiAqIEV2ZXJ5dGhpbmcgYSBjbGllbnQgbmVlZHMgdG8gbWF0ZXJpYWxpemUgb25lIGhlYWQgdHJhbnNpdGlvbi5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBDaGFuZ2VQYXlsb2FkIHtcbiAgcGF0aDogc3RyaW5nO1xuICAvKiogVmVyc2lvbiBpZCBvZiB0aGUgbmV3IGhlYWQuICovXG4gIHZlcnNpb246IHN0cmluZztcbiAgaGFzaDogc3RyaW5nO1xuICBzaXplOiBudW1iZXI7XG4gIGRlbGV0ZWQ6IGJvb2xlYW47XG4gIC8qKiBJZCBvZiB0aGUgZGV2aWNlIHRoYXQgY29tbWl0dGVkLiAqL1xuICBkZXZpY2U6IHN0cmluZztcbiAgLyoqIExvZ2ljYWwgY2xvY2sgb2YgdGhlIG5ldyBoZWFkIFx1MjAxNCBjbGllbnRzIHVzZSBpdCB0byBza2lwIHN0YWxlIHJlcGxheXMuICovXG4gIGNsb2NrOiBMb2dpY2FsQ2xvY2s7XG4gIC8qKiBXaGF0IGtpbmQgb2YgY2hhbmdlIHRoaXMgaXMgKG1pcnJvcnMgYFZlcnNpb24ua2luZGApLiAqL1xuICBraW5kOiBWZXJzaW9uS2luZDtcbiAgLyoqIFNvdXJjZSBwYXRoIFx1MjAxNCBwcmVzZW50IHdoZW4gYGtpbmQ6ICdyZW5hbWUnYC4gKi9cbiAgZnJvbVBhdGg/OiBzdHJpbmc7XG4gIC8qKiBUcnVlIGZvciBmb2xkZXIgcGxhY2Vob2xkZXIgY2hhbmdlcyAoRlItMTApLiAqL1xuICBpc0ZvbGRlcj86IGJvb2xlYW47XG59XG5cbi8qKiBGYW4tb3V0IGJyb2FkY2FzdCB0byBhbGwgKm90aGVyKiBjb25uZWN0ZWQgY2xpZW50cy4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ2hhbmdlTWVzc2FnZSBleHRlbmRzIENoYW5nZVBheWxvYWQge1xuICB0eXBlOiAnY2hhbmdlJztcbiAgLyoqIEdsb2JhbCBzZXF1ZW5jZSBudW1iZXIgb2YgdGhpcyBjaGFuZ2UgKGN1cnNvciB0cmFja2luZykuICovXG4gIHNlcTogbnVtYmVyO1xufVxuXG4vKiogUmVwbHkgdG8gYHB1dEJsb2JgLiAqL1xuZXhwb3J0IGludGVyZmFjZSBCbG9iQWNrTWVzc2FnZSB7XG4gIHR5cGU6ICdibG9iQWNrJztcbiAgaGFzaDogc3RyaW5nO1xufVxuXG4vKiogUmVwbHkgdG8gYGdldEJsb2JgOiB0aGUgcmVxdWVzdGVkIGNvbnRlbnQuICovXG5leHBvcnQgaW50ZXJmYWNlIEJsb2JNZXNzYWdlIHtcbiAgdHlwZTogJ2Jsb2InO1xuICBoYXNoOiBzdHJpbmc7XG4gIC8qKiBGdWxsIGNvbnRlbnQsIGJhc2U2NC1lbmNvZGVkLiAqL1xuICBjb250ZW50OiBzdHJpbmc7XG59XG5cbi8qKiBNYWNoaW5lLXJlYWRhYmxlIGNvZGVzIGNhcnJpZWQgYnkgYGVycm9yYCBtZXNzYWdlcyAoSFRUUC1lcXVpdmFsZW50KS4gKi9cbmV4cG9ydCB0eXBlIFNlcnZlckVycm9yQ29kZSA9ICdVTkFVVEhPUklaRUQnIHwgJ1JFVk9LRUQnIHwgJ05PVF9GT1VORCcgfCAnUFJPVE9DT0wnO1xuXG4vKiogTmVnYXRpdmUgcmVwbHkgKGF1dGggZmFpbHVyZSwgdW5rbm93biBibG9iLCBwcm90b2NvbCB2aW9sYXRpb24sIFx1MjAyNikuICovXG5leHBvcnQgaW50ZXJmYWNlIEVycm9yTWVzc2FnZSB7XG4gIHR5cGU6ICdlcnJvcic7XG4gIGNvZGU6IFNlcnZlckVycm9yQ29kZTtcbiAgbWVzc2FnZTogc3RyaW5nO1xufVxuXG4vKiogUHJlc2VuY2UgdXBkYXRlIGZvciBkYXNoYm9hcmRzIC8gYHZzYSBzdGF0dXNgLiAqL1xuZXhwb3J0IGludGVyZmFjZSBEZXZpY2VTZWVuTWVzc2FnZSB7XG4gIHR5cGU6ICdkZXZpY2VTZWVuJztcbiAgZGV2aWNlSWQ6IHN0cmluZztcbiAgdHM6IG51bWJlcjtcbn1cblxuLyoqIEtlZXBhbGl2ZSByZXBseS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUG9uZ01lc3NhZ2Uge1xuICB0eXBlOiAncG9uZyc7XG4gIC8qKiBFY2hvZXMgdGhlIGBwaW5nYCB0cyB3aGVuIG9uZSB3YXMgcHJvdmlkZWQuICovXG4gIHRzPzogbnVtYmVyO1xufVxuXG4vLyAtLS0gVW5pb24gKyBndWFyZHMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCB0eXBlIENsaWVudE1lc3NhZ2UgPVxuICB8IEhlbGxvTWVzc2FnZVxuICB8IEdldE1hbmlmZXN0TWVzc2FnZVxuICB8IENvbW1pdE1lc3NhZ2VcbiAgfCBQdXRCbG9iTWVzc2FnZVxuICB8IEdldEJsb2JNZXNzYWdlXG4gIHwgUGluZ01lc3NhZ2U7XG5cbmV4cG9ydCB0eXBlIFNlcnZlck1lc3NhZ2UgPVxuICB8IEhlbGxvQWNrTWVzc2FnZVxuICB8IE1hbmlmZXN0TWVzc2FnZVxuICB8IENvbW1pdEFja01lc3NhZ2VcbiAgfCBDb25mbGljdE1lc3NhZ2VcbiAgfCBDaGFuZ2VNZXNzYWdlXG4gIHwgRGV2aWNlU2Vlbk1lc3NhZ2VcbiAgfCBCbG9iQWNrTWVzc2FnZVxuICB8IEJsb2JNZXNzYWdlXG4gIHwgRXJyb3JNZXNzYWdlXG4gIHwgUG9uZ01lc3NhZ2U7XG5cbmV4cG9ydCB0eXBlIE1lc3NhZ2UgPSBDbGllbnRNZXNzYWdlIHwgU2VydmVyTWVzc2FnZTtcblxuY29uc3QgQ0xJRU5UX1RZUEVTOiBSZWFkb25seVNldDxzdHJpbmc+ID0gbmV3IFNldChbXG4gICdoZWxsbycsXG4gICdnZXRNYW5pZmVzdCcsXG4gICdjb21taXQnLFxuICAncHV0QmxvYicsXG4gICdnZXRCbG9iJyxcbiAgJ3BpbmcnLFxuXSk7XG5jb25zdCBTRVJWRVJfVFlQRVM6IFJlYWRvbmx5U2V0PHN0cmluZz4gPSBuZXcgU2V0KFtcbiAgJ2hlbGxvQWNrJyxcbiAgJ21hbmlmZXN0JyxcbiAgJ2NvbW1pdEFjaycsXG4gICdjb25mbGljdCcsXG4gICdjaGFuZ2UnLFxuICAnZGV2aWNlU2VlbicsXG4gICdibG9iQWNrJyxcbiAgJ2Jsb2InLFxuICAnZXJyb3InLFxuICAncG9uZycsXG5dKTtcblxuLyoqXG4gKiBSdW50aW1lIHNoYXBlIGNoZWNrOiBhIHZhbHVlIGlzIGEgYE1lc3NhZ2VgIGlmZiBpdCBpcyBhbiBvYmplY3Qgd2hvc2VcbiAqIGB0eXBlYCBpcyBhIGtub3duIG1lc3NhZ2UgdHlwZS4gRmllbGQtbGV2ZWwgdmFsaWRhdGlvbiBoYXBwZW5zIHdoZXJlIGFcbiAqIG1lc3NhZ2UgaXMgYWN0ZWQgdXBvbiAobGF0ZXIgcGhhc2VzKTsgdGhlIGd1YXJkIGlzIGRlbGliZXJhdGVseSBjaGVhcCBzb1xuICogYm90aCBXUyBlbmRzIGNhbiB0cmlhZ2UgdW5rbm93bi9mb3J3YXJkLWNvbXBhdGlibGUgdHlwZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc01lc3NhZ2UodmFsdWU6IHVua25vd24pOiB2YWx1ZSBpcyBNZXNzYWdlIHtcbiAgcmV0dXJuIChcbiAgICB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmXG4gICAgdmFsdWUgIT09IG51bGwgJiZcbiAgICB0eXBlb2YgKHZhbHVlIGFzIHsgdHlwZT86IHVua25vd24gfSkudHlwZSA9PT0gJ3N0cmluZycgJiZcbiAgICAoQ0xJRU5UX1RZUEVTLmhhcygodmFsdWUgYXMgeyB0eXBlOiBzdHJpbmcgfSkudHlwZSkgfHxcbiAgICAgIFNFUlZFUl9UWVBFUy5oYXMoKHZhbHVlIGFzIHsgdHlwZTogc3RyaW5nIH0pLnR5cGUpKVxuICApO1xufVxuXG5leHBvcnQgZnVuY3Rpb24gaXNDbGllbnRNZXNzYWdlKHZhbHVlOiB1bmtub3duKTogdmFsdWUgaXMgQ2xpZW50TWVzc2FnZSB7XG4gIHJldHVybiAoXG4gICAgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJlxuICAgIHZhbHVlICE9PSBudWxsICYmXG4gICAgQ0xJRU5UX1RZUEVTLmhhcygodmFsdWUgYXMgeyB0eXBlPzogdW5rbm93biB9KS50eXBlIGFzIHN0cmluZylcbiAgKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGlzU2VydmVyTWVzc2FnZSh2YWx1ZTogdW5rbm93bik6IHZhbHVlIGlzIFNlcnZlck1lc3NhZ2Uge1xuICByZXR1cm4gKFxuICAgIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiZcbiAgICB2YWx1ZSAhPT0gbnVsbCAmJlxuICAgIFNFUlZFUl9UWVBFUy5oYXMoKHZhbHVlIGFzIHsgdHlwZT86IHVua25vd24gfSkudHlwZSBhcyBzdHJpbmcpXG4gICk7XG59XG5cbi8qKlxuICogUGFyc2UgYSBXUyB0ZXh0IGZyYW1lIGludG8gYSB0eXBlZCBgTWVzc2FnZWAuXG4gKiBUaHJvd3MgYFByb3RvY29sRXJyb3JgIG9uIG5vbi1KU09OIGlucHV0IG9yIHVua25vd24gbWVzc2FnZSB0eXBlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlTWVzc2FnZShkYXRhOiBzdHJpbmcpOiBNZXNzYWdlIHtcbiAgbGV0IHBhcnNlZDogdW5rbm93bjtcbiAgdHJ5IHtcbiAgICBwYXJzZWQgPSBKU09OLnBhcnNlKGRhdGEpO1xuICB9IGNhdGNoIChjYXVzZSkge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKGBNZXNzYWdlIGlzIG5vdCB2YWxpZCBKU09OOiAke1N0cmluZyhkYXRhKS5zbGljZSgwLCAyMDApfWAsIHsgY2F1c2UgfSk7XG4gIH1cbiAgaWYgKCFpc01lc3NhZ2UocGFyc2VkKSkge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKFxuICAgICAgYFVua25vd24gb3IgbWFsZm9ybWVkIG1lc3NhZ2UgdHlwZTogJHtKU09OLnN0cmluZ2lmeSgocGFyc2VkIGFzIHsgdHlwZT86IHVua25vd24gfSk/LnR5cGUpfWAsXG4gICAgKTtcbiAgfVxuICByZXR1cm4gcGFyc2VkO1xufVxuXG4vLyAtLS0gd2lyZSBlbmNvZGluZyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vXG4vLyBgaW5saW5lYC9gY29udGVudGAgZmllbGRzIGNhcnJ5IHJhdyBieXRlcyBhcyBiYXNlNjQuIGBidG9hYC9gYXRvYmAgZXhpc3QgaW5cbi8vIGV2ZXJ5IHRhcmdldCBydW50aW1lIChXb3JrZXJzLCBOb2RlIDE2KywgRWxlY3Ryb24pOyBjaHVua2luZyBhdm9pZHNcbi8vIGV4Y2VlZGluZyBhcmd1bWVudC1sZW5ndGggbGltaXRzIG9uIGxhcmdlIGF0dGFjaG1lbnRzLlxuXG4vKiogRW5jb2RlIGJ5dGVzIGFzIGJhc2U2NC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBieXRlc1RvQmFzZTY0KGJ5dGVzOiBVaW50OEFycmF5KTogc3RyaW5nIHtcbiAgbGV0IGJpbmFyeSA9ICcnO1xuICBjb25zdCBDSFVOSyA9IDB4ODAwMDtcbiAgZm9yIChsZXQgb2Zmc2V0ID0gMDsgb2Zmc2V0IDwgYnl0ZXMubGVuZ3RoOyBvZmZzZXQgKz0gQ0hVTkspIHtcbiAgICBiaW5hcnkgKz0gU3RyaW5nLmZyb21DaGFyQ29kZSguLi5ieXRlcy5zdWJhcnJheShvZmZzZXQsIG9mZnNldCArIENIVU5LKSk7XG4gIH1cbiAgcmV0dXJuIGJ0b2EoYmluYXJ5KTtcbn1cblxuLyoqIERlY29kZSBiYXNlNjQgdG8gYnl0ZXMuIFRocm93cyBgUHJvdG9jb2xFcnJvcmAgb24gaW52YWxpZCBpbnB1dC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBiYXNlNjRUb0J5dGVzKGVuY29kZWQ6IHN0cmluZyk6IFVpbnQ4QXJyYXkge1xuICBsZXQgYmluYXJ5OiBzdHJpbmc7XG4gIHRyeSB7XG4gICAgYmluYXJ5ID0gYXRvYihlbmNvZGVkKTtcbiAgfSBjYXRjaCAoY2F1c2UpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcignQmFzZTY0IHBheWxvYWQgaXMgbm90IHZhbGlkJywgeyBjYXVzZSB9KTtcbiAgfVxuICBjb25zdCBieXRlcyA9IG5ldyBVaW50OEFycmF5KGJpbmFyeS5sZW5ndGgpO1xuICBmb3IgKGxldCBpID0gMDsgaSA8IGJpbmFyeS5sZW5ndGg7IGkrKykgYnl0ZXNbaV0gPSBiaW5hcnkuY2hhckNvZGVBdChpKTtcbiAgcmV0dXJuIGJ5dGVzO1xufVxuIiwgIi8qKlxuICogQ29uZmxpY3QtY29weSBmaWxlIG5hbWluZyAoQVJDSElURUNUVVJFLm1kIFx1MDBBNzQsIEZSLTYpLlxuICpcbiAqIFdoZW4gYSBkZXZpY2UgbG9zZXMgYSBjb25mbGljdCBidXQgaXRzIGNvbnRlbnQgbXVzdCBiZSBwcmVzZXJ2ZWQsIHRoZVxuICogY29udGVudCBpcyBjb21taXR0ZWQgdG8gYSBzaWJsaW5nIFwiY29uZmxpY3QgY29weVwiIHBhdGggc2hhcGVkIGxpa2U6XG4gKlxuICogICAgIE5vdGUgKGNvbmZsaWN0IDIwMjYtMDgtMjAgMTQtMjMgLSBmcm9tIFBob25lKS5tZFxuICogICAgIFx1MjUxNFx1MjUwMCBzdGVtIFx1MjUwMFx1MjUxOFx1MjUxNFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMCBVVEMgZGF0ZSArIEhILW1tIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUxOFx1MjUxNCBkZXZpY2UgXHUyNTE4XHUyNTE0ZXh0XHUyNTE4XG4gKlxuICogUnVsZXM6XG4gKiAgIC0gdGltZXN0YW1wIGlzIGFsd2F5cyBVVEMgKG5ldmVyIGEgbG9jYWwgdGltZXpvbmUpIHNvIGV2ZXJ5IGNsaWVudFxuICogICAgIGNvbXB1dGVzIHRoZSBpZGVudGljYWwgbmFtZSBmcm9tIHRoZSBzYW1lIGNvbW1pdCB0aW1lO1xuICogICAtIHRoZSBkZXZpY2UgbmFtZSBpcyBzYW5pdGl6ZWQgZm9yIGZpbGVzeXN0ZW0gc2FmZXR5IChzZWVcbiAqICAgICBgc2FuaXRpemVEZXZpY2VOYW1lYCk7XG4gKiAgIC0gdGhlIG9yaWdpbmFsIGV4dGVuc2lvbiBpcyBwcmVzZXJ2ZWQgKGxhc3QgZG90IGluIHRoZSBiYXNlbmFtZSwgYXMgbG9uZ1xuICogICAgIGFzIGl0IGlzIG5vdCB0aGUgZmlyc3QgY2hhcmFjdGVyIFx1MjAxNCBgLmdpdGlnbm9yZWAgaGFzIG5vIGV4dGVuc2lvbik7XG4gKiAgIC0gaWYgdGhlIGNhbmRpZGF0ZSBhbHJlYWR5IGV4aXN0cyAoaW4gdGhlIGxvY2FsIGluZGV4IG9yIHRoZSByZW1vdGVcbiAqICAgICBtYW5pZmVzdCBcdTIwMTQgdGhlIGNhbGxlciBzdXBwbGllcyB0aGUgYGV4aXN0c2AgcHJlZGljYXRlKSwgYCAyYCwgYCAzYCwgXHUyMDI2XG4gKiAgICAgaXMgYXBwZW5kZWQgYmVmb3JlIHRoZSBleHRlbnNpb24uXG4gKi9cblxuaW1wb3J0IHsgYmFzZW5hbWUsIG5vcm1hbGl6ZVZhdWx0UGF0aCwgcGFyZW50UGF0aCB9IGZyb20gJy4vcGF0aHMuanMnO1xuXG4vKiogQ2hhcmFjdGVycyBmb3JiaWRkZW4gb24gYXQgbGVhc3Qgb25lIHN1cHBvcnRlZCBwbGF0Zm9ybS4gKi9cbmNvbnN0IElMTEVHQUxfRklMRU5BTUVfQ0hBUlMgPSAvWzw+OlwiL1xcXFx8PypdL2c7XG4vKiogQzAgY29udHJvbHMgKyBERUwgXHUyMDE0IG5ldmVyIHZhbGlkIGluIGZpbGVuYW1lcy4gKi9cbmNvbnN0IENPTlRST0xfQ0hBUlMgPSAvW1xceDAwLVxceDFmXFx4N2ZdL2c7XG5cbi8qKiBNYXggbGVuZ3RoIChpbiBjb2RlIHBvaW50cykgb2YgYSBzYW5pdGl6ZWQgZGV2aWNlIG5hbWUuICovXG5jb25zdCBNQVhfREVWSUNFX05BTUVfTEVOR1RIID0gMzA7XG5cbi8qKiBGYWxsYmFjayB3aGVuIGEgZGV2aWNlIG5hbWUgc2FuaXRpemVzIHRvIG5vdGhpbmcuICovXG5jb25zdCBGQUxMQkFDS19ERVZJQ0VfTkFNRSA9ICd1bmtub3duJztcblxuLyoqIEhpZ2hlc3QgYCBOYCBzdWZmaXggdHJpZWQgYmVmb3JlIGdpdmluZyB1cC4gKi9cbmNvbnN0IE1BWF9DT0xMSVNJT05fU1VGRklYID0gOTk5O1xuXG4vKipcbiAqIFNhbml0aXplIGEgZGV2aWNlIG5hbWUgZm9yIHVzZSBpbnNpZGUgYSBmaWxlbmFtZTogc3RyaXAgYDw+OlwiL1xcXFx8PypgIGFuZFxuICogY29udHJvbCBjaGFyYWN0ZXJzLCB0cmltIHdoaXRlc3BhY2UgYW5kIGVkZ2UgZG90cyAoV2luZG93cyBzZWdtZW50cyBtYXlcbiAqIG5vdCBlbmQgd2l0aCBgLmAgb3Igd2hpdGVzcGFjZSksIHRydW5jYXRlIHRvIDMwIGNvZGUgcG9pbnRzIChuZXZlciBzcGxpdHNcbiAqIGEgc3Vycm9nYXRlIHBhaXIpLiBSZXR1cm5zIGAndW5rbm93bidgIHdoZW4gbm90aGluZyBzdXJ2aXZlcy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHNhbml0aXplRGV2aWNlTmFtZShuYW1lOiBzdHJpbmcpOiBzdHJpbmcge1xuICBsZXQgY2xlYW5lZCA9IG5hbWUucmVwbGFjZShJTExFR0FMX0ZJTEVOQU1FX0NIQVJTLCAnJykucmVwbGFjZShDT05UUk9MX0NIQVJTLCAnJyk7XG4gIGNsZWFuZWQgPSBbLi4uY2xlYW5lZF0uc2xpY2UoMCwgTUFYX0RFVklDRV9OQU1FX0xFTkdUSCkuam9pbignJyk7XG4gIGNsZWFuZWQgPSBjbGVhbmVkLnRyaW0oKS5yZXBsYWNlKC9eWy5cXHNdK3xbLlxcc10rJC9nLCAnJyk7XG4gIHJldHVybiBjbGVhbmVkLmxlbmd0aCA9PT0gMCA/IEZBTExCQUNLX0RFVklDRV9OQU1FIDogY2xlYW5lZDtcbn1cblxuLyoqXG4gKiBDb21wdXRlIHRoZSBjb25mbGljdC1jb3B5IHBhdGggZm9yIGBwYXRoYC5cbiAqXG4gKiBQdXJlIGFuZCBkZXRlcm1pbmlzdGljOiB0aGUgc2FtZSBgKHBhdGgsIGRldmljZU5hbWUsIG5vdywgZXhpc3RzKWAgYWx3YXlzXG4gKiB5aWVsZHMgdGhlIHNhbWUgcmVzdWx0LiBgbm93YCBpcyB0aGUgY29uZmxpY3QncyBlcG9jaC1tcyB0aW1lc3RhbXAgKHRoZVxuICogY2FsbGVyIHBhc3NlcyBpdCBpbiBcdTIwMTQgbm8gaGlkZGVuIGNsb2Nrcyk7IGBleGlzdHNgIGlzIGNvbnN1bHRlZCBmb3JcbiAqIGNvbGxpc2lvbiBhdm9pZGFuY2UgYW5kIHR5cGljYWxseSBjaGVja3MgdGhlIGxvY2FsIGluZGV4IHBsdXMgdGhlIHJlbW90ZVxuICogbWFuaWZlc3QuXG4gKlxuICogVGhyb3dzIHdoZW4gbW9yZSB0aGFuIGBNQVhfQ09MTElTSU9OX1NVRkZJWGAgbmFtZSBjb2xsaXNpb25zIG9jY3VyIChhXG4gKiBnZW51aW5lbHkgcGF0aG9sb2dpY2FsIHZhdWx0IHN0YXRlIHRoZSBjYWxsZXIgc2hvdWxkIHN1cmZhY2UsIG5vdCBwYXBlclxuICogb3ZlcikuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb25mbGljdENvcHlQYXRoKFxuICBwYXRoOiBzdHJpbmcsXG4gIGRldmljZU5hbWU6IHN0cmluZyxcbiAgbm93OiBudW1iZXIsXG4gIGV4aXN0czogKGNhbmRpZGF0ZVBhdGg6IHN0cmluZykgPT4gYm9vbGVhbiA9ICgpID0+IGZhbHNlLFxuKTogc3RyaW5nIHtcbiAgY29uc3Qgbm9ybWFsaXplZCA9IG5vcm1hbGl6ZVZhdWx0UGF0aChwYXRoKTtcbiAgY29uc3QgZGlyID0gcGFyZW50UGF0aChub3JtYWxpemVkKTtcbiAgY29uc3QgbmFtZSA9IGJhc2VuYW1lKG5vcm1hbGl6ZWQpO1xuXG4gIGNvbnN0IGxhc3REb3QgPSBuYW1lLmxhc3RJbmRleE9mKCcuJyk7XG4gIGNvbnN0IGhhc0V4dGVuc2lvbiA9IGxhc3REb3QgPiAwOyAvLyBhIGxlYWRpbmcgZG90IG1hcmtzIGEgZG90ZmlsZSwgbm90IGFuIGV4dGVuc2lvblxuICBjb25zdCBzdGVtID0gaGFzRXh0ZW5zaW9uID8gbmFtZS5zbGljZSgwLCBsYXN0RG90KSA6IG5hbWU7XG4gIGNvbnN0IGV4dGVuc2lvbiA9IGhhc0V4dGVuc2lvbiA/IG5hbWUuc2xpY2UobGFzdERvdCkgOiAnJztcblxuICBjb25zdCBzdWZmaXggPSBgIChjb25mbGljdCAke2Zvcm1hdENvbmZsaWN0U3RhbXAobm93KX0gLSBmcm9tICR7c2FuaXRpemVEZXZpY2VOYW1lKGRldmljZU5hbWUpfSlgO1xuICBjb25zdCBqb2luID0gKGZpbGVOYW1lOiBzdHJpbmcpOiBzdHJpbmcgPT4gKGRpciA9PT0gJy8nID8gYC8ke2ZpbGVOYW1lfWAgOiBgJHtkaXJ9LyR7ZmlsZU5hbWV9YCk7XG5cbiAgbGV0IGNhbmRpZGF0ZSA9IGpvaW4oYCR7c3RlbX0ke3N1ZmZpeH0ke2V4dGVuc2lvbn1gKTtcbiAgZm9yIChsZXQgbiA9IDI7IG4gPD0gTUFYX0NPTExJU0lPTl9TVUZGSVg7IG4rKykge1xuICAgIGlmICghZXhpc3RzKGNhbmRpZGF0ZSkpIHJldHVybiBjYW5kaWRhdGU7XG4gICAgY2FuZGlkYXRlID0gam9pbihgJHtzdGVtfSR7c3VmZml4fSAke259JHtleHRlbnNpb259YCk7XG4gIH1cbiAgdGhyb3cgbmV3IEVycm9yKFxuICAgIGBjb25mbGljdENvcHlQYXRoOiBtb3JlIHRoYW4gJHtNQVhfQ09MTElTSU9OX1NVRkZJWH0gY29sbGlzaW9ucyBmb3IgJHtKU09OLnN0cmluZ2lmeShub3JtYWxpemVkKX1gLFxuICApO1xufVxuXG4vKiogYDIwMjYtMDgtMjAgMTQtMjNgIFx1MjAxNCBVVEMgZGF0ZSwgc3BhY2UsIHplcm8tcGFkZGVkIEhILW1tLiBNaW51dGVzLCBub3Qgc2Vjb25kcy4gKi9cbmZ1bmN0aW9uIGZvcm1hdENvbmZsaWN0U3RhbXAobm93OiBudW1iZXIpOiBzdHJpbmcge1xuICBjb25zdCBkID0gbmV3IERhdGUobm93KTtcbiAgY29uc3QgcGFkID0gKG46IG51bWJlcik6IHN0cmluZyA9PiBTdHJpbmcobikucGFkU3RhcnQoMiwgJzAnKTtcbiAgcmV0dXJuIChcbiAgICBgJHtkLmdldFVUQ0Z1bGxZZWFyKCl9LSR7cGFkKGQuZ2V0VVRDTW9udGgoKSArIDEpfS0ke3BhZChkLmdldFVUQ0RhdGUoKSl9YCArXG4gICAgYCAke3BhZChkLmdldFVUQ0hvdXJzKCkpfS0ke3BhZChkLmdldFVUQ01pbnV0ZXMoKSl9YFxuICApO1xufVxuIiwgIi8qKlxuICogVGhyZWUtd2F5IHJlY29uY2lsaWF0aW9uIChBUkNISVRFQ1RVUkUubWQgXHUwMEE3OCBzdGVwIDQpLlxuICpcbiAqIGBjb21wdXRlU3luY1BsYW5gIGlzIGEgUFVSRSwgREVURVJNSU5JU1RJQyBmdW5jdGlvbjogdGhlIHNhbWUgaW5wdXRzIGFsd2F5c1xuICogcHJvZHVjZSB0aGUgc2FtZSBwbGFuIChtYW5pZmVzdCBhbmQgY2hhbmdlIGJ1Y2tldHMgYXJlIHJlLXNvcnRlZFxuICogaW50ZXJuYWxseTsgYG5vd2AgaXMgYSBwYXJhbWV0ZXIsIG5ldmVyIHJlYWQgZnJvbSBhIGNsb2NrKS4gSXQgY29tcGFyZXNcbiAqIHRocmVlIHN0YXRlcyBmb3IgZXZlcnkgcGF0aDpcbiAqXG4gKiAgIC0gdGhlICoqbG9jYWwgaW5kZXgqKiBcdTIwMTQgd2hhdCB0aGlzIGRldmljZSBsYXN0IGtuZXcgYXMgYXV0aG9yaXRhdGl2ZVxuICogICAgICh0aGUgXCJjb21tb24gYW5jZXN0b3JcIiBvZiB0aGUgdGhyZWUtd2F5IG1lcmdlKTtcbiAqICAgLSB0aGUgKipsb2NhbCBjaGFuZ2VzKiogXHUyMDE0IGhvdyBsb2NhbCBzdG9yYWdlIGRpdmVyZ2VkIGZyb20gdGhlIGluZGV4XG4gKiAgICAgd2hpbGUgb2ZmbGluZSAoYHNjYW4udHNgIG91dHB1dCk7XG4gKiAgIC0gdGhlICoqbWFuaWZlc3QqKiBcdTIwMTQgdGhlIGF1dGhvcml0eSdzIGN1cnJlbnQgaGVhZCBwZXIgcGF0aC5cbiAqXG4gKiBhbmQgZW1pdHMgYSBgU3luY1BsYW5gIChzaGFwZSBkb2N1bWVudGVkIG9uIHRoZSBpbnRlcmZhY2UpOiBvcHMgdG8gcHVzaCxcbiAqIG9wcyB0byBwdWxsLCBjb25mbGljdCByZXNvbHV0aW9ucywgYW5kIGZvbGRlciBwbGFjZWhvbGRlcnMgdG8gcHVzaC5cbiAqXG4gKiBDb25mbGljdCBhcmJpdHJhdGlvbiBtaXJyb3JzIHRoZSBETydzIHJ1bGUgKFx1MDBBNzQpOiB3aW5uZXIgPSBoaWdoZXIgbG9naWNhbFxuICogY2xvY2s7IHRpZSBcdTIxOTIgZ3JlYXRlciBkZXZpY2VJZC4gVGhlIGxvY2FsIHNpZGUncyAqdGVudGF0aXZlKiBjbG9jayBpc1xuICogYG5leHRDbG9jayhpbmRleCBjbG9jaywgdGhpc0RldmljZUlkKWAgXHUyMDE0IGV4YWN0bHkgdGhlIGNvdW50ZXIgdGhlIERPIHdvdWxkXG4gKiBhc3NpZ24gYSBjb21taXQgYnVpbGRpbmcgb24gdGhlIHNhbWUgcGFyZW50LCBzbyB0aGUgY2xpZW50J3MgcHJlZGljdGlvblxuICogbWF0Y2hlcyB0aGUgc2VydmVyJ3MgYXJiaXRyYXRpb24uIFdoZW4gdGhlIHJlbW90ZSBzaWRlIHdpbnMsIHRoZSBsb3NpbmdcbiAqIGxvY2FsIGNvbnRlbnQgaXMgcHJlc2VydmVkIGJ5IHB1c2hpbmcgaXQgdG8gYSBjb25mbGljdC1jb3B5IHBhdGhcbiAqIChgY29uZmxpY3RuYW1lcy50c2ApOyB3aGVuIHRoZSBsb2NhbCBzaWRlIHdpbnMsIHRoZSBjbGllbnQgc2ltcGx5IGNvbW1pdHNcbiAqIHdpdGggaXRzIChub3cgc3RhbGUpIHBhcmVudCB2ZXJzaW9uIGFuZCBsZXRzIHRoZSBzZXJ2ZXIgYXJiaXRyYXRlIFx1MjAxNCB0aGVcbiAqIHNlcnZlciBzeW50aGVzaXplcyBhbnkgY29uZmxpY3QgY29weSBmb3IgdGhlIGxvc2luZyByZW1vdGUgY29udGVudCwgd2hpY2hcbiAqIGFycml2ZXMgbGF0ZXIgYXMgYW4gb3JkaW5hcnkgY2hhbmdlIGV2ZW50LlxuICovXG5cbmltcG9ydCB7IGNvbXBhcmVDbG9ja3MsIG5leHRDbG9jayB9IGZyb20gJy4vY2xvY2suanMnO1xuaW1wb3J0IHsgY29uZmxpY3RDb3B5UGF0aCB9IGZyb20gJy4vY29uZmxpY3RuYW1lcy5qcyc7XG5pbXBvcnQgdHlwZSB7IExvY2FsSW5kZXgsIExvY2FsSW5kZXhFbnRyeSB9IGZyb20gJy4vbG9jYWxpbmRleC5qcyc7XG5pbXBvcnQgeyBwYXJlbnRQYXRoIH0gZnJvbSAnLi9wYXRocy5qcyc7XG5pbXBvcnQgdHlwZSB7IE1hbmlmZXN0RW50cnkgfSBmcm9tICcuL3Byb3RvY29sLmpzJztcbmltcG9ydCB0eXBlIHsgRGVsZXRlZENhbmRpZGF0ZSwgTG9jYWxDaGFuZ2VzLCBSZW5hbWVDYW5kaWRhdGUsIFNjYW5DYW5kaWRhdGUgfSBmcm9tICcuL3NjYW4uanMnO1xuaW1wb3J0IHR5cGUgeyBMb2dpY2FsQ2xvY2sgfSBmcm9tICcuL3R5cGVzLmpzJztcblxuLyoqXG4gKiBBIG1hbmlmZXN0IGVudHJ5IGFzIHJlY29uY2lsaWF0aW9uIGNvbnN1bWVzIGl0LiBTaW5jZSBgTWFuaWZlc3RFbnRyeWAgZ3Jld1xuICogYHBhdGhgLCBgY2xvY2tgLCBhbmQgYGlzRm9sZGVyYCAocHJvdG9jb2wgdjEsIHByZS1yZWxlYXNlKSwgdGhpcyBpcyBub3cgdGhlXG4gKiBtYW5pZmVzdCBlbnRyeSBpdHNlbGYgXHUyMDE0IGtlcHQgYXMgYSBuYW1lZCBhbGlhcyBzbyBgY29tcHV0ZVN5bmNQbGFuYCdzIGlucHV0XG4gKiBjb250cmFjdCBzdGF5cyBzZWxmLWRvY3VtZW50aW5nLlxuICovXG5leHBvcnQgdHlwZSBSZW1vdGVGaWxlID0gTWFuaWZlc3RFbnRyeTtcblxuLyoqIElucHV0IHRvIGBjb21wdXRlU3luY1BsYW5gLiAqL1xuZXhwb3J0IGludGVyZmFjZSBTeW5jUGxhbklucHV0IHtcbiAgbG9jYWxDaGFuZ2VzOiBMb2NhbENoYW5nZXM7XG4gIGluZGV4OiBMb2NhbEluZGV4O1xuICBtYW5pZmVzdDogcmVhZG9ubHkgUmVtb3RlRmlsZVtdO1xuICB0aGlzRGV2aWNlSWQ6IHN0cmluZztcbiAgLyoqIEh1bWFuLXJlYWRhYmxlIG5hbWUgb2YgdGhpcyBkZXZpY2UgXHUyMDE0IHVzZWQgaW4gY29uZmxpY3QtY29weSBmaWxlIG5hbWVzLiAqL1xuICB0aGlzRGV2aWNlTmFtZTogc3RyaW5nO1xuICAvKiogRXBvY2ggbXMgdXNlZCBmb3IgY29uZmxpY3QtY29weSB0aW1lc3RhbXBzIChwYXNzZWQgaW4gZm9yIGRldGVybWluaXNtKS4gKi9cbiAgbm93OiBudW1iZXI7XG59XG5cbi8qKiBXaHkgYSBwYXRoIHdlbnQgdGhyb3VnaCBjb25mbGljdCByZXNvbHV0aW9uLiAqL1xuZXhwb3J0IHR5cGUgQ29uZmxpY3RSZWFzb24gPSAnY29uY3VycmVudC1lZGl0JyB8ICdhZGQtdnMtYWRkJyB8ICdkZWxldGUtdnMtZWRpdCcgfCAncmVuYW1lLXJhY2UnO1xuXG4vKipcbiAqIEEgY29tbWl0IHRoaXMgZGV2aWNlIHNob3VsZCBzZW5kIChwYXlsb2FkIG9mIGEgcHJvdG9jb2wgYGNvbW1pdGAgbWVzc2FnZSkuXG4gKlxuICogYHBhcmVudFZlcnNpb25gIHNlbWFudGljczpcbiAqICAgLSBsb2NhbC1vbmx5IGNoYW5nZXMgYW5kIGxvY2FsLXdpbnMgY29uZmxpY3RzIG5hbWUgdGhlICppbmRleCogaGVhZCAob3JcbiAqICAgICBgbnVsbGAgZm9yIGJyYW5kLW5ldyBwYXRocykgXHUyMDE0IGRlbGliZXJhdGVseSBzdGFsZSB3aGVuIGEgY29uZmxpY3Qgd2FzXG4gKiAgICAgcHJlZGljdGVkLCBzbyB0aGUgRE8gYXJiaXRyYXRlcyBhbmQgcHJlc2VydmVzIHRoZSBsb3NpbmcgcmVtb3RlXG4gKiAgICAgY29udGVudCBzZXJ2ZXItc2lkZTtcbiAqICAgLSBjb25mbGljdC1jb3B5IHB1c2hlcyBuYW1lIHRoZSAqcmVtb3RlKiBoZWFkIChmYXN0LXBhdGg6IHRoZXkgYnVpbGQgb25cbiAqICAgICB0aGUgd2lubmVyIGFuZCBtdXN0IG5vdCByZS1jb25mbGljdCkuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUHVzaEZpbGVPcCB7XG4gIGtpbmQ6ICdhZGQnIHwgJ2VkaXQnIHwgJ2RlbGV0ZScgfCAncmVzdG9yZScgfCAnY29uZmxpY3RDb3B5JztcbiAgcGF0aDogc3RyaW5nO1xuICBwYXJlbnRWZXJzaW9uOiBzdHJpbmcgfCBudWxsO1xuICAvKiogQ29udGVudCBoYXNoOyBkZWxldGUgb3BzIHJldXNlIHRoZSBkZWxldGVkIGNvbnRlbnQncyBoYXNoLiAqL1xuICBoYXNoOiBzdHJpbmc7XG4gIHNpemU6IG51bWJlcjtcbn1cblxuLyoqIEEgbG9jYWwgcmVuYW1lIHRvIGNvbW1pdCBhcyBvbmUgY2hhaW4gbWlncmF0aW9uIChGUi05KS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUHVzaFJlbmFtZU9wIHtcbiAga2luZDogJ3JlbmFtZSc7XG4gIGZyb21QYXRoOiBzdHJpbmc7XG4gIHRvUGF0aDogc3RyaW5nO1xuICAvKiogVmVyc2lvbiBvZiB0aGUgYGZyb21QYXRoYCBoZWFkIHRoaXMgcmVuYW1lIGJ1aWxkcyBvbi4gKi9cbiAgcGFyZW50VmVyc2lvbjogc3RyaW5nIHwgbnVsbDtcbiAgaGFzaDogc3RyaW5nO1xuICBzaXplOiBudW1iZXI7XG59XG5cbmV4cG9ydCB0eXBlIFB1c2hPcCA9IFB1c2hGaWxlT3AgfCBQdXNoUmVuYW1lT3A7XG5cbi8qKiBSZW1vdGUgY29udGVudCB0aGlzIGRldmljZSBzaG91bGQgZmV0Y2ggYW5kIG1hdGVyaWFsaXplIHZpYSBgYXBwbHlQdWxsYC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUHVsbEZpbGVPcCB7XG4gIGtpbmQ6ICdhZGQnIHwgJ2VkaXQnIHwgJ2RlbGV0ZScgfCAncmVzdG9yZSc7XG4gIHBhdGg6IHN0cmluZztcbiAgaGFzaDogc3RyaW5nO1xuICBzaXplOiBudW1iZXI7XG4gIHZlcnNpb246IHN0cmluZztcbiAgY2xvY2s6IExvZ2ljYWxDbG9jaztcbiAgLyoqIFRydWUgZm9yIHRvbWJzdG9uZXMgKGtpbmQgYCdkZWxldGUnYCkuICovXG4gIGRlbGV0ZWQ6IGJvb2xlYW47XG4gIC8qKiBUcnVlIGZvciBlbXB0eS1mb2xkZXIgcGxhY2Vob2xkZXIgcHVsbHMgKEZSLTEwKSBcdTIwMTQgbWF0ZXJpYWxpemUgd2l0aCBgZW5zdXJlRGlyYC4gKi9cbiAgaXNGb2xkZXI/OiBib29sZWFuO1xufVxuXG4vKiogQSByZW1vdGUgcmVuYW1lIHRvIGZvbGxvdyBsb2NhbGx5IChkZXRlY3RlZCBieSBoYXNoIGNvcnJlbGF0aW9uKS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUHVsbFJlbmFtZU9wIHtcbiAga2luZDogJ3JlbmFtZSc7XG4gIGZyb21QYXRoOiBzdHJpbmc7XG4gIHRvUGF0aDogc3RyaW5nO1xuICBoYXNoOiBzdHJpbmc7XG4gIHNpemU6IG51bWJlcjtcbiAgdmVyc2lvbjogc3RyaW5nO1xuICBjbG9jazogTG9naWNhbENsb2NrO1xufVxuXG5leHBvcnQgdHlwZSBQdWxsT3AgPSBQdWxsRmlsZU9wIHwgUHVsbFJlbmFtZU9wO1xuXG4vKipcbiAqIE9uZSBhcmJpdHJhdGVkIGNvbmZsaWN0LiBgbG9zZXJDb250ZW50YCBpcyBgJ25vbmUnYCB3aGVuIHRoZSBsb3Npbmcgc2lkZVxuICogd2FzIGEgZGVsZXRpb24gKG5vdGhpbmcgdG8gcHJlc2VydmUpLiBXaGVuIHRoZSBsb2NhbCBjb250ZW50IGxvc3QgYW5kIGhhZFxuICogY29udGVudCwgYGNvbmZsaWN0Q29weVBhdGhgIG5hbWVzIHdoZXJlIHRoZSBwbGFuIHByZXNlcnZlcyBpdCAodGhlIHB1c2hcbiAqIGl0c2VsZiBpcyBpbiBgU3luY1BsYW4ucHVzaGVzYCB3aXRoIGtpbmQgYCdjb25mbGljdENvcHknYCkuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ29uZmxpY3RPcCB7XG4gIHBhdGg6IHN0cmluZztcbiAgcmVhc29uOiBDb25mbGljdFJlYXNvbjtcbiAgd2lubmVyOiAnbG9jYWwnIHwgJ3JlbW90ZSc7XG4gIGxvc2VyQ29udGVudDogJ2xvY2FsJyB8ICdyZW1vdGUnIHwgJ25vbmUnO1xuICBjb25mbGljdENvcHlQYXRoPzogc3RyaW5nO1xuICByZW1vdGU6IHsgdmVyc2lvbjogc3RyaW5nOyBoYXNoOiBzdHJpbmc7IHNpemU6IG51bWJlcjsgZGVsZXRlZDogYm9vbGVhbjsgY2xvY2s6IExvZ2ljYWxDbG9jayB9O1xuICAvKiogVGhlIHRlbnRhdGl2ZSBjbG9jayB0aGUgbG9jYWwgc2lkZSB3YXMgYXJiaXRyYXRlZCB3aXRoLiAqL1xuICBsb2NhbENsb2NrOiBMb2dpY2FsQ2xvY2s7XG59XG5cbi8qKlxuICogVGhlIGNvbXBsZXRlIHJlY29uY2lsaWF0aW9uIHJlc3VsdCBmb3Igb25lIHN5bmMgY3ljbGUuIE9wcyBhcmUgc29ydGVkIGJ5XG4gKiB0YXJnZXQgcGF0aCAocmVuYW1lcyBieSBgdG9QYXRoYCk7IGV2ZXJ5IGFycmF5IG1heSBiZSBlbXB0eS4gYHB1c2hlc2AgYW5kXG4gKiBgcHVsbHNgIGFyZSBpbmRlcGVuZGVudCBcdTIwMTQgYSBwYXRoIGFwcGVhcnMgYXQgbW9zdCBvbmNlIGluIGVhY2guIFB1c2hlcyBhcmVcbiAqIE5PVCBhcHBsaWVkIHRvIHRoZSBsb2NhbCBpbmRleCB1bnRpbCB0aGUgc2VydmVyIGFja3MgdGhlbTsgcHVsbHMgYXJlXG4gKiBhcHBsaWVkIGJ5IGBhcHBseVB1bGxgIChgZW5naW5lLnRzYCkuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU3luY1BsYW4ge1xuICAvKiogQ29tbWl0cyB0byBzZW5kLCBpbiBvcmRlci4gKi9cbiAgcHVzaGVzOiBQdXNoT3BbXTtcbiAgLyoqIFJlbW90ZSBjaGFuZ2VzIHRvIG1hdGVyaWFsaXplLCBpbiBvcmRlci4gKi9cbiAgcHVsbHM6IFB1bGxPcFtdO1xuICAvKiogQ29uZmxpY3RzIHRoYXQgd2VyZSBhcmJpdHJhdGVkIChpbmZvcm1hdGlvbmFsOyBzaWRlIGVmZmVjdHMgbGl2ZSBpbiBwdXNoZXMvcHVsbHMpLiAqL1xuICBjb25mbGljdHM6IENvbmZsaWN0T3BbXTtcbiAgLyoqIEVtcHR5LWZvbGRlciBwbGFjZWhvbGRlciBwYXRocyB0byBjcmVhdGUgcmVtb3RlbHkgKEZSLTEwKS4gKi9cbiAgZm9sZGVyUHVzaGVzOiBzdHJpbmdbXTtcbn1cblxuLyoqIEludGVybmFsOiBhIGxvY2FsIGNhbmRpZGF0ZSAoYWRkZWQvbW9kaWZpZWQvZGVsZXRlZCkgdW5pZmllZCBmb3IgcmVzb2x1dGlvbi4gKi9cbmludGVyZmFjZSBMb2NhbENhbmRpZGF0ZSB7XG4gIHBhdGg6IHN0cmluZztcbiAga2luZDogJ2FkZCcgfCAnZWRpdCcgfCAncmVzdG9yZScgfCAnZGVsZXRlJztcbiAgaGFzaDogc3RyaW5nO1xuICBzaXplOiBudW1iZXI7XG59XG5cbmNvbnN0IFpFUk9fQ0xPQ0s6IExvZ2ljYWxDbG9jayA9IHsgY291bnRlcjogMCwgZGV2aWNlSWQ6ICcnIH07XG5cbi8qKlxuICogQ29tcHV0ZSB0aGUgc3luYyBwbGFuLiBTZWUgdGhlIG1vZHVsZSBkb2MgZm9yIHRoZSBtb2RlbCBhbmQgdGhlIG9wXG4gKiBzZW1hbnRpY3MuIFRocm93cyBub3RoaW5nIG9uIG9yZGluYXJ5IGRpdmVyZ2VuY2UgXHUyMDE0IGNvbmZsaWN0cyBhcmUgZGF0YSxcbiAqIG5vdCBlcnJvcnMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb21wdXRlU3luY1BsYW4oaW5wdXQ6IFN5bmNQbGFuSW5wdXQpOiBTeW5jUGxhbiB7XG4gIGNvbnN0IHsgbG9jYWxDaGFuZ2VzLCBpbmRleCwgdGhpc0RldmljZUlkLCB0aGlzRGV2aWNlTmFtZSwgbm93IH0gPSBpbnB1dDtcbiAgY29uc3QgbWFuaWZlc3QgPSBbLi4uaW5wdXQubWFuaWZlc3RdLnNvcnQoKGEsIGIpID0+IGNvbXBhcmVTdHJpbmdzKGEucGF0aCwgYi5wYXRoKSk7XG4gIGNvbnN0IG1hbmlmZXN0QnlQYXRoID0gbmV3IE1hcChtYW5pZmVzdC5tYXAoKGVudHJ5KSA9PiBbZW50cnkucGF0aCwgZW50cnldKSk7XG5cbiAgY29uc3QgcHVzaGVzOiBQdXNoT3BbXSA9IFtdO1xuICBjb25zdCBwdWxsczogUHVsbE9wW10gPSBbXTtcbiAgY29uc3QgY29uZmxpY3RzOiBDb25mbGljdE9wW10gPSBbXTtcblxuICAvLyBFdmVyeSBwYXRoIHRoZSBsb2NhbCBzaWRlIGRpdmVyZ2VkIG9uIChzY2FuIGJ1Y2tldHMgKyBib3RoIGVuZHMgb2YgcmVuYW1lcykuXG4gIGNvbnN0IGxvY2FsUGF0aHMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgZm9yIChjb25zdCBjIG9mIGxvY2FsQ2hhbmdlcy5hZGRlZCkgbG9jYWxQYXRocy5hZGQoYy5wYXRoKTtcbiAgZm9yIChjb25zdCBjIG9mIGxvY2FsQ2hhbmdlcy5tb2RpZmllZCkgbG9jYWxQYXRocy5hZGQoYy5wYXRoKTtcbiAgZm9yIChjb25zdCBkIG9mIGxvY2FsQ2hhbmdlcy5kZWxldGVkKSBsb2NhbFBhdGhzLmFkZChkLnBhdGgpO1xuICBmb3IgKGNvbnN0IHIgb2YgbG9jYWxDaGFuZ2VzLnJlbmFtZWQpIHtcbiAgICBsb2NhbFBhdGhzLmFkZChyLmZyb20pO1xuICAgIGxvY2FsUGF0aHMuYWRkKHIudG8pO1xuICB9XG5cbiAgLy8gUGF0aHMgYWxyZWFkeSBjb25zdW1lZCBieSBhbiBlYXJsaWVyIHBoYXNlIChyZW5hbWUgY29ycmVsYXRpb24gZXRjLikuXG4gIGNvbnN0IGNvbnN1bWVkID0gbmV3IFNldDxzdHJpbmc+KCk7XG5cbiAgY29uc3QgcGF0aEV4aXN0cyA9IChwYXRoOiBzdHJpbmcpOiBib29sZWFuID0+IHBhdGggaW4gaW5kZXggfHwgbWFuaWZlc3RCeVBhdGguaGFzKHBhdGgpO1xuXG4gIC8vIC0tLSBQaGFzZSBBOiBsb2NhbCByZW5hbWVzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAvLyBVbmNvbnRlc3RlZDogb25lIFB1c2hSZW5hbWVPcC4gQ29udGVzdGVkIChyZW1vdGUgY2hhbmdlZCBhdCBlaXRoZXIgZW5kKTpcbiAgLy8gZGVjb21wb3NlIFx1MjAxNCB0aGUgYGZyb21gIHNpZGUgaXMgcmVzb2x2ZWQgb24gaXRzIG93biAodXN1YWxseSB0b21ic3RvbmVkXG4gIC8vIG9yIHB1bGxlZCksIHRoZSByZW5hbWVkIGNvbnRlbnQgaXMgcGxhY2VkIGF0IGB0b2AgdGhyb3VnaCB0aGUgZ2VuZXJpY1xuICAvLyBjb250ZW50IG1hY2hpbmVyeS4gQ29udGVudCBpcyBuZXZlciBsb3N0IGVpdGhlciB3YXkuXG4gIGZvciAoY29uc3QgcmVuYW1lIG9mIFsuLi5sb2NhbENoYW5nZXMucmVuYW1lZF0uc29ydCgoYSwgYikgPT4gY29tcGFyZVN0cmluZ3MoYS5mcm9tLCBiLmZyb20pKSkge1xuICAgIGNvbnN0IGluZGV4RnJvbSA9IGluZGV4W3JlbmFtZS5mcm9tXTtcbiAgICBjb25zdCBpbmRleFRvID0gaW5kZXhbcmVuYW1lLnRvXTtcbiAgICBjb25zdCByZW1vdGVGcm9tID0gbWFuaWZlc3RCeVBhdGguZ2V0KHJlbmFtZS5mcm9tKTtcbiAgICBjb25zdCByZW1vdGVUbyA9IG1hbmlmZXN0QnlQYXRoLmdldChyZW5hbWUudG8pO1xuXG4gICAgY29uc3QgZnJvbUNoYW5nZWQgPSByZW1vdGVGcm9tXG4gICAgICA/IHJlbW90ZUVudHJ5Q2hhbmdlZChpbmRleEZyb20sIHJlbW90ZUZyb20pXG4gICAgICA6IGluZGV4RnJvbT8uZGVsZXRlZEF0ID09PSB1bmRlZmluZWQ7IC8vIGFic2VudCByZW1vdGVseSArIGxpdmUgbG9jYWxseSBcdTIxRDIgY2hhbmdlZFxuICAgIGNvbnN0IHRvQ2hhbmdlZCA9IHJlbW90ZVRvXG4gICAgICA/IHJlbW90ZUVudHJ5Q2hhbmdlZChpbmRleFRvLCByZW1vdGVUbylcbiAgICAgIDogZmFsc2U7IC8vIGFic2VudCByZW1vdGVseSBcdTIxRDIgbm90aGluZyB0byByYWNlIGF0IGB0b2BcblxuICAgIGlmICghZnJvbUNoYW5nZWQgJiYgIXRvQ2hhbmdlZCkge1xuICAgICAgcHVzaGVzLnB1c2goe1xuICAgICAgICBraW5kOiAncmVuYW1lJyxcbiAgICAgICAgZnJvbVBhdGg6IHJlbmFtZS5mcm9tLFxuICAgICAgICB0b1BhdGg6IHJlbmFtZS50byxcbiAgICAgICAgcGFyZW50VmVyc2lvbjogaW5kZXhGcm9tPy52ZXJzaW9uSWQgPz8gbnVsbCxcbiAgICAgICAgaGFzaDogcmVuYW1lLmhhc2gsXG4gICAgICAgIHNpemU6IHJlbmFtZS5zaXplLFxuICAgICAgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG5cbiAgICAvLyBgZnJvbWAgc2lkZSBvZiBhIGNvbnRlc3RlZCByZW5hbWU6XG4gICAgaWYgKCFmcm9tQ2hhbmdlZCkge1xuICAgICAgLy8gTm90aGluZyByZW1vdGUgdGhlcmUgXHUyMDE0IHRoZSBtb3ZlIGl0c2VsZiByZW1vdmVzIHRoZSBvbGQgcGF0aC5cbiAgICAgIGlmIChpbmRleEZyb20gJiYgaW5kZXhGcm9tLmRlbGV0ZWRBdCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHB1c2hlcy5wdXNoKHtcbiAgICAgICAgICBraW5kOiAnZGVsZXRlJyxcbiAgICAgICAgICBwYXRoOiByZW5hbWUuZnJvbSxcbiAgICAgICAgICBwYXJlbnRWZXJzaW9uOiBpbmRleEZyb20udmVyc2lvbklkLFxuICAgICAgICAgIGhhc2g6IGluZGV4RnJvbS5oYXNoLFxuICAgICAgICAgIHNpemU6IGluZGV4RnJvbS5zaXplLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICB9IGVsc2UgaWYgKCFyZW1vdGVGcm9tIHx8IHJlbW90ZUZyb20uZGVsZXRlZCkge1xuICAgICAgLy8gUmVtb3RlIGRlbGV0ZWQgKG9yIG1pZ3JhdGVkIGF3YXkgZnJvbSkgYGZyb21gIFx1MjAxNCBkZWxldGlvbiBzdGFuZHMgZm9yXG4gICAgICAvLyB0aGUgb2xkIHBhdGg7IHRoZSByZW5hbWVkIGNvbnRlbnQgc3Vydml2ZXMgYXQgYHRvYC5cbiAgICAgIHB1bGxzLnB1c2goXG4gICAgICAgIHB1bGxGaWxlKCdkZWxldGUnLCByZW5hbWUuZnJvbSwge1xuICAgICAgICAgIGhhc2g6IHJlbW90ZUZyb20/Lmhhc2ggPz8gaW5kZXhGcm9tPy5oYXNoID8/IHJlbmFtZS5oYXNoLFxuICAgICAgICAgIHNpemU6IHJlbW90ZUZyb20/LnNpemUgPz8gaW5kZXhGcm9tPy5zaXplID8/IHJlbmFtZS5zaXplLFxuICAgICAgICAgIHZlcnNpb246IHJlbW90ZUZyb20/LnZlcnNpb24gPz8gJycsXG4gICAgICAgICAgY2xvY2s6IHJlbW90ZUZyb20/LmNsb2NrID8/IGluZGV4RnJvbT8uY2xvY2sgPz8gWkVST19DTE9DSyxcbiAgICAgICAgICBkZWxldGVkOiB0cnVlLFxuICAgICAgICB9KSxcbiAgICAgICk7XG4gICAgfSBlbHNlIHtcbiAgICAgIC8vIFJlbW90ZSBlZGl0ZWQgYGZyb21gLiBUaGUgcmVtb3RlIGVkaXQga2VlcHMgdGhlIG9sZCBwYXRoOyB0aGUgbW92ZWRcbiAgICAgIC8vIGNvbnRlbnQgaXMgcGxhY2VkIGF0IGB0b2AgYmVsb3cgXHUyMDE0IGEgcmVuYW1lLXJhY2UgdGhlIGxvY2FsIHNpZGVcbiAgICAgIC8vIGNvbmNlZGVzIHVubGVzcyBpdHMgY2xvY2sgd2lucyB0aGUgcmVuYW1lIHB1c2guXG4gICAgICBjb25zdCBsb2NhbENsb2NrID0gbmV4dENsb2NrKGluZGV4RnJvbT8uY2xvY2ssIHRoaXNEZXZpY2VJZCk7XG4gICAgICBpZiAoY29tcGFyZUNsb2NrcyhyZW1vdGVGcm9tLmNsb2NrLCBsb2NhbENsb2NrKSA+IDApIHtcbiAgICAgICAgcHVsbHMucHVzaChwdWxsRmlsZSgnZWRpdCcsIHJlbmFtZS5mcm9tLCByZW1vdGVGcm9tKSk7XG4gICAgICAgIGNvbmZsaWN0cy5wdXNoKHtcbiAgICAgICAgICBwYXRoOiByZW5hbWUuZnJvbSxcbiAgICAgICAgICByZWFzb246ICdyZW5hbWUtcmFjZScsXG4gICAgICAgICAgd2lubmVyOiAncmVtb3RlJyxcbiAgICAgICAgICAvLyBMb2NhbCBjb250ZW50IGlzIHByZXNlcnZlZCBieSB0aGUgcmVuYW1lIGl0c2VsZiAocHVzaGVkIGF0IGB0b2ApLlxuICAgICAgICAgIGxvc2VyQ29udGVudDogJ2xvY2FsJyxcbiAgICAgICAgICByZW1vdGU6IHJlbW90ZVN1bW1hcnkocmVtb3RlRnJvbSksXG4gICAgICAgICAgbG9jYWxDbG9jayxcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBwdXNoZXMucHVzaCh7XG4gICAgICAgICAga2luZDogJ3JlbmFtZScsXG4gICAgICAgICAgZnJvbVBhdGg6IHJlbmFtZS5mcm9tLFxuICAgICAgICAgIHRvUGF0aDogcmVuYW1lLnRvLFxuICAgICAgICAgIHBhcmVudFZlcnNpb246IGluZGV4RnJvbT8udmVyc2lvbklkID8/IG51bGwsXG4gICAgICAgICAgaGFzaDogcmVuYW1lLmhhc2gsXG4gICAgICAgICAgc2l6ZTogcmVuYW1lLnNpemUsXG4gICAgICAgIH0pO1xuICAgICAgICBjb25mbGljdHMucHVzaCh7XG4gICAgICAgICAgcGF0aDogcmVuYW1lLmZyb20sXG4gICAgICAgICAgcmVhc29uOiAncmVuYW1lLXJhY2UnLFxuICAgICAgICAgIHdpbm5lcjogJ2xvY2FsJyxcbiAgICAgICAgICBsb3NlckNvbnRlbnQ6ICdyZW1vdGUnLFxuICAgICAgICAgIHJlbW90ZTogcmVtb3RlU3VtbWFyeShyZW1vdGVGcm9tKSxcbiAgICAgICAgICBsb2NhbENsb2NrLFxuICAgICAgICB9KTtcbiAgICAgICAgY29udGludWU7IC8vIHRoZSByZW5hbWUgcHVzaCBjYXJyaWVzIHRoZSBjb250ZW50OyBubyBgdG9gIG9wIG5lZWRlZFxuICAgICAgfVxuICAgIH1cblxuICAgIC8vIGB0b2Agc2lkZSBvZiBhIGNvbnRlc3RlZCByZW5hbWU6XG4gICAgaWYgKCF0b0NoYW5nZWQpIHtcbiAgICAgIHB1c2hlcy5wdXNoKHtcbiAgICAgICAga2luZDogaW5kZXhUbz8uZGVsZXRlZEF0ICE9PSB1bmRlZmluZWQgPyAncmVzdG9yZScgOiAnYWRkJyxcbiAgICAgICAgcGF0aDogcmVuYW1lLnRvLFxuICAgICAgICBwYXJlbnRWZXJzaW9uOiBpbmRleFRvPy52ZXJzaW9uSWQgPz8gbnVsbCxcbiAgICAgICAgaGFzaDogcmVuYW1lLmhhc2gsXG4gICAgICAgIHNpemU6IHJlbmFtZS5zaXplLFxuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHJlc29sdmVDb250ZXN0ZWRQYXRoKHJlbmFtZS50bywgaW5kZXhUbywgcmVtb3RlVG8gYXMgUmVtb3RlRmlsZSwge1xuICAgICAgICBwYXRoOiByZW5hbWUudG8sXG4gICAgICAgIGtpbmQ6IGluZGV4VG8/LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkID8gJ3Jlc3RvcmUnIDogJ2FkZCcsXG4gICAgICAgIGhhc2g6IHJlbmFtZS5oYXNoLFxuICAgICAgICBzaXplOiByZW5hbWUuc2l6ZSxcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIC8vIC0tLSBQaGFzZSBCOiByZW1vdGUgcmVuYW1lcyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAvLyBBIHBhdGggbGl2ZSBpbiB0aGUgaW5kZXggYnV0IEFCU0VOVCBmcm9tIHRoZSBtYW5pZmVzdCB3YXMgbWlncmF0ZWQgYnkgdGhlXG4gIC8vIGF1dGhvcml0eSAodG9tYnN0b25lcyBhcHBlYXIgaW4gdGhlIG1hbmlmZXN0IHdpdGggZGVsZXRlZDp0cnVlIFx1MjAxNCBvbmx5IGFcbiAgLy8gcmVuYW1lIHJlbW92ZXMgYSBwYXRoKS4gQ29ycmVsYXRlIGJ5IGNvbnRlbnQgaGFzaCBhZ2FpbnN0IG5ldyBtYW5pZmVzdFxuICAvLyBwYXRocywgc2FtZS1wYXJlbnQgcHJlZmVycmVkLCBzbWFsbGVzdCBwYXRoIHdpdGhpbiBhIHByZWZlcmVuY2UgY2xhc3MuXG4gIGZvciAoY29uc3QgZnJvbSBvZiBPYmplY3Qua2V5cyhpbmRleClcbiAgICAuZmlsdGVyKChwKSA9PiB7XG4gICAgICBjb25zdCBlbnRyeSA9IGluZGV4W3BdIGFzIExvY2FsSW5kZXhFbnRyeTtcbiAgICAgIHJldHVybiBlbnRyeS5kZWxldGVkQXQgPT09IHVuZGVmaW5lZCAmJiAhZW50cnkuaXNGb2xkZXI7XG4gICAgfSlcbiAgICAuc29ydChjb21wYXJlU3RyaW5ncykpIHtcbiAgICBpZiAobG9jYWxQYXRocy5oYXMoZnJvbSkgfHwgY29uc3VtZWQuaGFzKGZyb20pKSBjb250aW51ZTtcbiAgICBpZiAobWFuaWZlc3RCeVBhdGguaGFzKGZyb20pKSBjb250aW51ZTsgLy8gcHJlc2VudCAobGl2ZSBvciB0b21ic3RvbmVkKSBcdTIxRDIgbm90IG1pZ3JhdGVkXG4gICAgY29uc3QgZW50cnkgPSBpbmRleFtmcm9tXSBhcyBMb2NhbEluZGV4RW50cnk7XG5cbiAgICBsZXQgYmVzdDogUmVtb3RlRmlsZSB8IHVuZGVmaW5lZDtcbiAgICBsZXQgYmVzdFNhbWVEaXIgPSBmYWxzZTtcbiAgICBmb3IgKGNvbnN0IGNhbmRpZGF0ZSBvZiBtYW5pZmVzdCkge1xuICAgICAgaWYgKGNhbmRpZGF0ZS5kZWxldGVkKSBjb250aW51ZTtcbiAgICAgIGlmIChsb2NhbFBhdGhzLmhhcyhjYW5kaWRhdGUucGF0aCkgfHwgY29uc3VtZWQuaGFzKGNhbmRpZGF0ZS5wYXRoKSkgY29udGludWU7XG4gICAgICBjb25zdCBrbm93biA9IGluZGV4W2NhbmRpZGF0ZS5wYXRoXTtcbiAgICAgIGlmIChrbm93biAhPT0gdW5kZWZpbmVkICYmIGtub3duLmRlbGV0ZWRBdCA9PT0gdW5kZWZpbmVkKSBjb250aW51ZTsgLy8gdGFyZ2V0IG5vdCBuZXdcbiAgICAgIGlmIChjYW5kaWRhdGUuaGFzaCAhPT0gZW50cnkuaGFzaCkgY29udGludWU7XG4gICAgICBjb25zdCBzYW1lRGlyID0gcGFyZW50UGF0aChjYW5kaWRhdGUucGF0aCkgPT09IHBhcmVudFBhdGgoZnJvbSk7XG4gICAgICBpZiAoYmVzdCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGJlc3QgPSBjYW5kaWRhdGU7XG4gICAgICAgIGJlc3RTYW1lRGlyID0gc2FtZURpcjtcbiAgICAgIH0gZWxzZSBpZiAoc2FtZURpciAmJiAhYmVzdFNhbWVEaXIpIHtcbiAgICAgICAgYmVzdCA9IGNhbmRpZGF0ZTtcbiAgICAgICAgYmVzdFNhbWVEaXIgPSB0cnVlO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChiZXN0KSB7XG4gICAgICBwdWxscy5wdXNoKHtcbiAgICAgICAga2luZDogJ3JlbmFtZScsXG4gICAgICAgIGZyb21QYXRoOiBmcm9tLFxuICAgICAgICB0b1BhdGg6IGJlc3QucGF0aCxcbiAgICAgICAgaGFzaDogYmVzdC5oYXNoLFxuICAgICAgICBzaXplOiBiZXN0LnNpemUsXG4gICAgICAgIHZlcnNpb246IGJlc3QudmVyc2lvbixcbiAgICAgICAgY2xvY2s6IGJlc3QuY2xvY2ssXG4gICAgICB9KTtcbiAgICAgIGNvbnN1bWVkLmFkZChmcm9tKTtcbiAgICAgIGNvbnN1bWVkLmFkZChiZXN0LnBhdGgpO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBBYnNlbnQgd2l0aG91dCBjb3JyZWxhdGlvbjogdGhlIGF1dGhvcml0eSBubyBsb25nZXIga25vd3MgdGhlIHBhdGguXG4gICAgICAvLyBUcmVhdCBhcyBhIHJlbW90ZSBkZWxldGUgd2l0aCB1bmtub3duIGhlYWQgdmVyc2lvbiAoJycgXHUyMDE0IHRoZSBuZXh0XG4gICAgICAvLyBmdWxsIG1hbmlmZXN0IGhlYWxzIHRoZSB2ZXJzaW9uIGlkKS4gVGhpcyBhbHNvIGNvdmVycyByZW1vdGVcbiAgICAgIC8vIHJlbmFtZStlZGl0LCB3aGljaCBnZW51aW5lbHkgaXMgZGVsZXRlICsgYWRkLlxuICAgICAgcHVsbHMucHVzaChcbiAgICAgICAgcHVsbEZpbGUoJ2RlbGV0ZScsIGZyb20sIHtcbiAgICAgICAgICBoYXNoOiBlbnRyeS5oYXNoLFxuICAgICAgICAgIHNpemU6IGVudHJ5LnNpemUsXG4gICAgICAgICAgdmVyc2lvbjogJycsXG4gICAgICAgICAgY2xvY2s6IGVudHJ5LmNsb2NrLFxuICAgICAgICAgIGRlbGV0ZWQ6IHRydWUsXG4gICAgICAgIH0pLFxuICAgICAgKTtcbiAgICAgIGNvbnN1bWVkLmFkZChmcm9tKTtcbiAgICB9XG4gIH1cblxuICAvLyAtLS0gUGhhc2UgQzogcmVtYWluaW5nIHJlbW90ZS1vbmx5IGNoYW5nZXMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgZm9yIChjb25zdCByZW1vdGUgb2YgbWFuaWZlc3QpIHtcbiAgICBpZiAobG9jYWxQYXRocy5oYXMocmVtb3RlLnBhdGgpIHx8IGNvbnN1bWVkLmhhcyhyZW1vdGUucGF0aCkpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGVudHJ5ID0gaW5kZXhbcmVtb3RlLnBhdGhdO1xuICAgIGlmICghcmVtb3RlRW50cnlDaGFuZ2VkKGVudHJ5LCByZW1vdGUpKSBjb250aW51ZTtcbiAgICBpZiAoZW50cnkgPT09IHVuZGVmaW5lZCkge1xuICAgICAgaWYgKCFyZW1vdGUuZGVsZXRlZCkge1xuICAgICAgICBwdWxscy5wdXNoKHB1bGxGaWxlKCdhZGQnLCByZW1vdGUucGF0aCwgcmVtb3RlKSk7XG4gICAgICAgIGNvbnN1bWVkLmFkZChyZW1vdGUucGF0aCk7XG4gICAgICB9XG4gICAgICAvLyBkZWxldGVkICsgbmV2ZXIga25vd24gbG9jYWxseSBcdTIxRDIgbm90aGluZyB0byBkb1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChyZW1vdGUuZGVsZXRlZCkge1xuICAgICAgcHVsbHMucHVzaChwdWxsRmlsZSgnZGVsZXRlJywgcmVtb3RlLnBhdGgsIHJlbW90ZSkpOyAvLyBpbmNsdWRlcyB0b21ic3RvbmVcdTIxOTJ0b21ic3RvbmUgdmVyc2lvbiBjYXRjaC11cFxuICAgIH0gZWxzZSBpZiAoZW50cnkuZGVsZXRlZEF0ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHB1bGxzLnB1c2gocHVsbEZpbGUoJ3Jlc3RvcmUnLCByZW1vdGUucGF0aCwgcmVtb3RlKSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHB1bGxzLnB1c2gocHVsbEZpbGUoJ2VkaXQnLCByZW1vdGUucGF0aCwgcmVtb3RlKSk7XG4gICAgfVxuICAgIGNvbnN1bWVkLmFkZChyZW1vdGUucGF0aCk7XG4gIH1cblxuICAvLyAtLS0gUGhhc2UgRDogbG9jYWwgY2FuZGlkYXRlcyAobG9jYWwtb25seSBwdXNoZXMgKyBib3RoLWNoYW5nZWQpIC0tLS0tLS1cbiAgY29uc3QgY2FuZGlkYXRlczogTG9jYWxDYW5kaWRhdGVbXSA9IFtcbiAgICAuLi5sb2NhbENoYW5nZXMuYWRkZWQubWFwKChjKSA9PiAoeyAuLi5jLCBraW5kOiAnYWRkJyBhcyBjb25zdCB9KSksXG4gICAgLi4ubG9jYWxDaGFuZ2VzLm1vZGlmaWVkLm1hcCgoYykgPT4gKHtcbiAgICAgIC4uLmMsXG4gICAgICBraW5kOiBpbmRleFtjLnBhdGhdPy5kZWxldGVkQXQgIT09IHVuZGVmaW5lZCA/ICgncmVzdG9yZScgYXMgY29uc3QpIDogKCdlZGl0JyBhcyBjb25zdCksXG4gICAgfSkpLFxuICAgIC4uLmxvY2FsQ2hhbmdlcy5kZWxldGVkLm1hcCgoZCk6IExvY2FsQ2FuZGlkYXRlID0+ICh7IC4uLmQsIGtpbmQ6ICdkZWxldGUnIH0pKSxcbiAgXS5zb3J0KChhLCBiKSA9PiBjb21wYXJlU3RyaW5ncyhhLnBhdGgsIGIucGF0aCkpO1xuXG4gIGZvciAoY29uc3QgY2FuZGlkYXRlIG9mIGNhbmRpZGF0ZXMpIHtcbiAgICBjb25zdCBlbnRyeSA9IGluZGV4W2NhbmRpZGF0ZS5wYXRoXTtcbiAgICBjb25zdCByZW1vdGUgPSBtYW5pZmVzdEJ5UGF0aC5nZXQoY2FuZGlkYXRlLnBhdGgpO1xuICAgIGNvbnN0IHJlbW90ZUNoYW5nZWRIZXJlID1cbiAgICAgIHJlbW90ZSAhPT0gdW5kZWZpbmVkICYmIChlbnRyeSAhPT0gdW5kZWZpbmVkID8gcmVtb3RlLnZlcnNpb24gIT09IGVudHJ5LnZlcnNpb25JZCA6ICFyZW1vdGUuZGVsZXRlZCk7XG4gICAgaWYgKCFyZW1vdGVDaGFuZ2VkSGVyZSkge1xuICAgICAgcHVzaExvY2FsKGNhbmRpZGF0ZSwgZW50cnkpO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXNvbHZlQ29udGVzdGVkUGF0aChjYW5kaWRhdGUucGF0aCwgZW50cnksIHJlbW90ZSBhcyBSZW1vdGVGaWxlLCBjYW5kaWRhdGUpO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7XG4gICAgcHVzaGVzOiBwdXNoZXMuc29ydCgoYSwgYikgPT4gY29tcGFyZVN0cmluZ3Mob3BQYXRoKGEpLCBvcFBhdGgoYikpKSxcbiAgICBwdWxsczogcHVsbHMuc29ydCgoYSwgYikgPT4gY29tcGFyZVN0cmluZ3Mob3BQYXRoKGEpLCBvcFBhdGgoYikpKSxcbiAgICBjb25mbGljdHM6IGNvbmZsaWN0cy5zb3J0KChhLCBiKSA9PiBjb21wYXJlU3RyaW5ncyhhLnBhdGgsIGIucGF0aCkpLFxuICAgIGZvbGRlclB1c2hlczogWy4uLmxvY2FsQ2hhbmdlcy5lbXB0eUZvbGRlcnNdLnNvcnQoY29tcGFyZVN0cmluZ3MpLFxuICB9O1xuXG4gIC8vIC0tLSBoZWxwZXJzIChjbG9zZSBvdmVyIHRoZSBhY2N1bXVsYXRvcnMpIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIGZ1bmN0aW9uIHB1c2hMb2NhbChjYW5kaWRhdGU6IExvY2FsQ2FuZGlkYXRlLCBlbnRyeTogTG9jYWxJbmRleEVudHJ5IHwgdW5kZWZpbmVkKTogdm9pZCB7XG4gICAgaWYgKGNhbmRpZGF0ZS5raW5kID09PSAnZGVsZXRlJykge1xuICAgICAgcHVzaGVzLnB1c2goe1xuICAgICAgICBraW5kOiAnZGVsZXRlJyxcbiAgICAgICAgcGF0aDogY2FuZGlkYXRlLnBhdGgsXG4gICAgICAgIHBhcmVudFZlcnNpb246IGVudHJ5Py52ZXJzaW9uSWQgPz8gbnVsbCxcbiAgICAgICAgaGFzaDogZW50cnk/Lmhhc2ggPz8gY2FuZGlkYXRlLmhhc2gsXG4gICAgICAgIHNpemU6IGVudHJ5Py5zaXplID8/IGNhbmRpZGF0ZS5zaXplLFxuICAgICAgfSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHB1c2hlcy5wdXNoKHtcbiAgICAgIGtpbmQ6IGNhbmRpZGF0ZS5raW5kLFxuICAgICAgcGF0aDogY2FuZGlkYXRlLnBhdGgsXG4gICAgICBwYXJlbnRWZXJzaW9uOiBlbnRyeT8udmVyc2lvbklkID8/IG51bGwsXG4gICAgICBoYXNoOiBjYW5kaWRhdGUuaGFzaCxcbiAgICAgIHNpemU6IGNhbmRpZGF0ZS5zaXplLFxuICAgIH0pO1xuICB9XG5cbiAgLyoqXG4gICAqIEJvdGggc2lkZXMgY2hhbmdlZCBvbmUgcGF0aC4gQXJiaXRyYXRlIHBlciBcdTAwQTc0LiBMb2NhbCBkZWxldGlvbnMgbmV2ZXIgZ2V0XG4gICAqIGEgY29uZmxpY3QgY29weSAobm8gY29udGVudCB0byBwcmVzZXJ2ZSk7IGxvY2FsICpjb250ZW50KiB0aGF0IGxvc2VzIGlzXG4gICAqIHByZXNlcnZlZCB2aWEgYSBjb25mbGljdC1jb3B5IHB1c2guXG4gICAqL1xuICBmdW5jdGlvbiByZXNvbHZlQ29udGVzdGVkUGF0aChcbiAgICBwYXRoOiBzdHJpbmcsXG4gICAgZW50cnk6IExvY2FsSW5kZXhFbnRyeSB8IHVuZGVmaW5lZCxcbiAgICByZW1vdGU6IFJlbW90ZUZpbGUsXG4gICAgbG9jYWw6IExvY2FsQ2FuZGlkYXRlLFxuICApOiB2b2lkIHtcbiAgICBjb25zdCBsb2NhbENsb2NrID0gbmV4dENsb2NrKGVudHJ5Py5jbG9jaywgdGhpc0RldmljZUlkKTtcbiAgICBjb25zdCByZW1vdGVXaW5zID0gY29tcGFyZUNsb2NrcyhyZW1vdGUuY2xvY2ssIGxvY2FsQ2xvY2spID4gMDsgLy8gMCBcdTIxRDIgbG9jYWwgKGRvY3VtZW50ZWQpXG4gICAgY29uc3Qgc3VtbWFyeSA9IHJlbW90ZVN1bW1hcnkocmVtb3RlKTtcbiAgICBjb25zdCByZWFzb246IENvbmZsaWN0UmVhc29uID1cbiAgICAgIGxvY2FsLmtpbmQgPT09ICdkZWxldGUnIHx8IHJlbW90ZS5kZWxldGVkXG4gICAgICAgID8gJ2RlbGV0ZS12cy1lZGl0J1xuICAgICAgICA6IGVudHJ5ID09PSB1bmRlZmluZWRcbiAgICAgICAgICA/ICdhZGQtdnMtYWRkJ1xuICAgICAgICAgIDogJ2NvbmN1cnJlbnQtZWRpdCc7XG5cbiAgICBpZiAobG9jYWwua2luZCA9PT0gJ2RlbGV0ZScgJiYgcmVtb3RlLmRlbGV0ZWQpIHtcbiAgICAgIC8vIEJvdGggZGVsZXRlZCBcdTIwMTQgY29udmVyZ2Ugc2lsZW50bHkgb24gdGhlIHJlbW90ZSB0b21ic3RvbmUuXG4gICAgICBwdWxscy5wdXNoKHB1bGxGaWxlKCdkZWxldGUnLCBwYXRoLCByZW1vdGUpKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAobG9jYWwua2luZCA9PT0gJ2RlbGV0ZScpIHtcbiAgICAgIC8vIExvY2FsIGRlbGV0ZSB2cyByZW1vdGUgZWRpdC5cbiAgICAgIGlmIChyZW1vdGVXaW5zKSB7XG4gICAgICAgIHB1bGxzLnB1c2gocHVsbEZpbGUoJ2VkaXQnLCBwYXRoLCByZW1vdGUpKTsgLy8gZmlsZSBpcyByZWNyZWF0ZWRcbiAgICAgICAgY29uZmxpY3RzLnB1c2goe1xuICAgICAgICAgIHBhdGgsIHJlYXNvbiwgd2lubmVyOiAncmVtb3RlJywgbG9zZXJDb250ZW50OiAnbm9uZScsXG4gICAgICAgICAgcmVtb3RlOiBzdW1tYXJ5LCBsb2NhbENsb2NrLFxuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHB1c2hlcy5wdXNoKHtcbiAgICAgICAgICBraW5kOiAnZGVsZXRlJyxcbiAgICAgICAgICBwYXRoLFxuICAgICAgICAgIHBhcmVudFZlcnNpb246IGVudHJ5Py52ZXJzaW9uSWQgPz8gbnVsbCxcbiAgICAgICAgICBoYXNoOiBlbnRyeT8uaGFzaCA/PyBsb2NhbC5oYXNoLFxuICAgICAgICAgIHNpemU6IGVudHJ5Py5zaXplID8/IGxvY2FsLnNpemUsXG4gICAgICAgIH0pO1xuICAgICAgICBjb25mbGljdHMucHVzaCh7XG4gICAgICAgICAgcGF0aCwgcmVhc29uLCB3aW5uZXI6ICdsb2NhbCcsIGxvc2VyQ29udGVudDogJ3JlbW90ZScsXG4gICAgICAgICAgcmVtb3RlOiBzdW1tYXJ5LCBsb2NhbENsb2NrLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBpZiAocmVtb3RlLmRlbGV0ZWQpIHtcbiAgICAgIC8vIExvY2FsIGVkaXQgdnMgcmVtb3RlIGRlbGV0ZS5cbiAgICAgIGlmIChyZW1vdGVXaW5zKSB7XG4gICAgICAgIHB1bGxzLnB1c2gocHVsbEZpbGUoJ2RlbGV0ZScsIHBhdGgsIHJlbW90ZSkpO1xuICAgICAgICBjb25mbGljdHMucHVzaCh7XG4gICAgICAgICAgcGF0aCwgcmVhc29uLCB3aW5uZXI6ICdyZW1vdGUnLCBsb3NlckNvbnRlbnQ6ICdsb2NhbCcsXG4gICAgICAgICAgY29uZmxpY3RDb3B5UGF0aDogcHVzaENvbmZsaWN0Q29weShwYXRoLCBsb2NhbCwgcmVtb3RlKSxcbiAgICAgICAgICByZW1vdGU6IHN1bW1hcnksIGxvY2FsQ2xvY2ssXG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcHVzaGVzLnB1c2goe1xuICAgICAgICAgIGtpbmQ6IGxvY2FsLmtpbmQsXG4gICAgICAgICAgcGF0aCxcbiAgICAgICAgICBwYXJlbnRWZXJzaW9uOiBlbnRyeT8udmVyc2lvbklkID8/IG51bGwsXG4gICAgICAgICAgaGFzaDogbG9jYWwuaGFzaCxcbiAgICAgICAgICBzaXplOiBsb2NhbC5zaXplLFxuICAgICAgICB9KTtcbiAgICAgICAgY29uZmxpY3RzLnB1c2goe1xuICAgICAgICAgIHBhdGgsIHJlYXNvbiwgd2lubmVyOiAnbG9jYWwnLCBsb3NlckNvbnRlbnQ6ICdub25lJyxcbiAgICAgICAgICByZW1vdGU6IHN1bW1hcnksIGxvY2FsQ2xvY2ssXG4gICAgICAgIH0pO1xuICAgICAgfVxuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIENvbmN1cnJlbnQgY29udGVudCAoZWRpdC12cy1lZGl0IG9yIGFkZC12cy1hZGQpLlxuICAgIGlmIChyZW1vdGVXaW5zKSB7XG4gICAgICBwdWxscy5wdXNoKFxuICAgICAgICBwdWxsRmlsZShlbnRyeT8uZGVsZXRlZEF0ICE9PSB1bmRlZmluZWQgPyAncmVzdG9yZScgOiBlbnRyeSA9PT0gdW5kZWZpbmVkID8gJ2FkZCcgOiAnZWRpdCcsIHBhdGgsIHJlbW90ZSksXG4gICAgICApO1xuICAgICAgY29uZmxpY3RzLnB1c2goe1xuICAgICAgICBwYXRoLCByZWFzb24sIHdpbm5lcjogJ3JlbW90ZScsIGxvc2VyQ29udGVudDogJ2xvY2FsJyxcbiAgICAgICAgY29uZmxpY3RDb3B5UGF0aDogcHVzaENvbmZsaWN0Q29weShwYXRoLCBsb2NhbCwgcmVtb3RlKSxcbiAgICAgICAgcmVtb3RlOiBzdW1tYXJ5LCBsb2NhbENsb2NrLFxuICAgICAgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHB1c2hlcy5wdXNoKHtcbiAgICAgICAga2luZDogbG9jYWwua2luZCxcbiAgICAgICAgcGF0aCxcbiAgICAgICAgLy8gRGVsaWJlcmF0ZWx5IHRoZSAoc3RhbGUpIGluZGV4IHBhcmVudDogdGhlIERPIG11c3QgYXJiaXRyYXRlIGFuZFxuICAgICAgICAvLyBzeW50aGVzaXplIHRoZSBjb25mbGljdCBjb3B5IGZvciB0aGUgbG9zaW5nIHJlbW90ZSBjb250ZW50LlxuICAgICAgICBwYXJlbnRWZXJzaW9uOiBlbnRyeT8udmVyc2lvbklkID8/IG51bGwsXG4gICAgICAgIGhhc2g6IGxvY2FsLmhhc2gsXG4gICAgICAgIHNpemU6IGxvY2FsLnNpemUsXG4gICAgICB9KTtcbiAgICAgIGNvbmZsaWN0cy5wdXNoKHtcbiAgICAgICAgcGF0aCwgcmVhc29uLCB3aW5uZXI6ICdsb2NhbCcsIGxvc2VyQ29udGVudDogJ3JlbW90ZScsXG4gICAgICAgIHJlbW90ZTogc3VtbWFyeSwgbG9jYWxDbG9jayxcbiAgICAgIH0pO1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBQdXNoIHRoZSBsb3NpbmcgbG9jYWwgY29udGVudCB0byBhIGNvbmZsaWN0LWNvcHkgcGF0aDsgcmV0dXJucyB0aGUgcGF0aCxcbiAgICogb3IgYHVuZGVmaW5lZGAgd2hlbiB0aGUgbG9zaW5nIGNvbnRlbnQgaXMgYnl0ZS1pZGVudGljYWwgdG8gdGhlIHdpbm5lcidzXG4gICAqIChhIHNhbWUtY29udGVudCByYWNlIFx1MjAxNCBub3RoaW5nIGRpc3RpbmN0IHRvIHByZXNlcnZlOyBtYXRjaGVzIHRoZSBzZXJ2ZXInc1xuICAgKiBhcmJpdHJhdGlvbiwgd2hpY2ggbGlrZXdpc2Ugc3ludGhlc2l6ZXMgbm8gY29weSBmb3IgaWRlbnRpY2FsIGNvbnRlbnQpLlxuICAgKi9cbiAgZnVuY3Rpb24gcHVzaENvbmZsaWN0Q29weShwYXRoOiBzdHJpbmcsIGxvY2FsOiBMb2NhbENhbmRpZGF0ZSwgcmVtb3RlOiBSZW1vdGVGaWxlKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICBpZiAobG9jYWwuaGFzaCA9PT0gcmVtb3RlLmhhc2gpIHJldHVybiB1bmRlZmluZWQ7XG4gICAgY29uc3QgY29weVBhdGggPSBjb25mbGljdENvcHlQYXRoKHBhdGgsIHRoaXNEZXZpY2VOYW1lLCBub3csIHBhdGhFeGlzdHMpO1xuICAgIHB1c2hlcy5wdXNoKHtcbiAgICAgIGtpbmQ6ICdjb25mbGljdENvcHknLFxuICAgICAgcGF0aDogY29weVBhdGgsXG4gICAgICAvLyBCdWlsZCBvbiB0aGUgd2lubmluZyByZW1vdGUgaGVhZDogdGhpcyBwdXNoIG11c3QgZmFzdC1wYXRoLlxuICAgICAgcGFyZW50VmVyc2lvbjogcmVtb3RlLnZlcnNpb24sXG4gICAgICBoYXNoOiBsb2NhbC5oYXNoLFxuICAgICAgc2l6ZTogbG9jYWwuc2l6ZSxcbiAgICB9KTtcbiAgICByZXR1cm4gY29weVBhdGg7XG4gIH1cbn1cblxuLy8gLS0tIG1vZHVsZS1sZXZlbCBoZWxwZXJzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5mdW5jdGlvbiBwdWxsRmlsZShcbiAga2luZDogUHVsbEZpbGVPcFsna2luZCddLFxuICBwYXRoOiBzdHJpbmcsXG4gIHJlbW90ZTogUGljazxSZW1vdGVGaWxlLCAnaGFzaCcgfCAnc2l6ZScgfCAndmVyc2lvbicgfCAnY2xvY2snIHwgJ2lzRm9sZGVyJz4gJiB7XG4gICAgZGVsZXRlZD86IGJvb2xlYW47XG4gIH0sXG4pOiBQdWxsRmlsZU9wIHtcbiAgcmV0dXJuIHtcbiAgICBraW5kLFxuICAgIHBhdGgsXG4gICAgaGFzaDogcmVtb3RlLmhhc2gsXG4gICAgc2l6ZTogcmVtb3RlLnNpemUsXG4gICAgdmVyc2lvbjogcmVtb3RlLnZlcnNpb24sXG4gICAgY2xvY2s6IHJlbW90ZS5jbG9jayxcbiAgICBkZWxldGVkOiByZW1vdGUuZGVsZXRlZCA/PyBraW5kID09PSAnZGVsZXRlJyxcbiAgICAuLi4ocmVtb3RlLmlzRm9sZGVyID8geyBpc0ZvbGRlcjogdHJ1ZSB9IDoge30pLFxuICB9O1xufVxuXG5mdW5jdGlvbiByZW1vdGVTdW1tYXJ5KHJlbW90ZTogUmVtb3RlRmlsZSk6IENvbmZsaWN0T3BbJ3JlbW90ZSddIHtcbiAgcmV0dXJuIHtcbiAgICB2ZXJzaW9uOiByZW1vdGUudmVyc2lvbixcbiAgICBoYXNoOiByZW1vdGUuaGFzaCxcbiAgICBzaXplOiByZW1vdGUuc2l6ZSxcbiAgICBkZWxldGVkOiByZW1vdGUuZGVsZXRlZCxcbiAgICBjbG9jazogcmVtb3RlLmNsb2NrLFxuICB9O1xufVxuXG4vKipcbiAqIFdoZXRoZXIgdGhlIHJlbW90ZSBoZWFkIGZvciBhIHBhdGggZGlmZmVycyBmcm9tIHdoYXQgdGhlIGluZGV4IHJlY29yZHMuXG4gKiBWZXJzaW9uIGlkcyBhcmUgdGhlIHByaW1hcnkgc2lnbmFsIChjbGllbnQgYW5kIERPIHNoYXJlIG9uZSBpZCBzcGFjZSk7XG4gKiBhIHBhdGggYWJzZW50IHJlbW90ZWx5IGNvdW50cyBhcyBjaGFuZ2VkIG9ubHkgd2hpbGUgdGhlIGluZGV4IHN0aWxsIGhvbGRzXG4gKiBpdCBsaXZlIFx1MjAxNCBjYWxsZXJzIGRlY2lkZSB3aGF0IGFic2VuY2UgKm1lYW5zKiAocmVuYW1lIHZzIGRlbGV0ZSkuXG4gKi9cbmZ1bmN0aW9uIHJlbW90ZUVudHJ5Q2hhbmdlZChcbiAgZW50cnk6IExvY2FsSW5kZXhFbnRyeSB8IHVuZGVmaW5lZCxcbiAgcmVtb3RlOiBSZW1vdGVGaWxlIHwgdW5kZWZpbmVkLFxuKTogYm9vbGVhbiB7XG4gIGlmIChyZW1vdGUgPT09IHVuZGVmaW5lZCkgcmV0dXJuIGZhbHNlO1xuICBpZiAoZW50cnkgPT09IHVuZGVmaW5lZCkgcmV0dXJuICFyZW1vdGUuZGVsZXRlZDtcbiAgcmV0dXJuIHJlbW90ZS52ZXJzaW9uICE9PSBlbnRyeS52ZXJzaW9uSWQ7XG59XG5cbmZ1bmN0aW9uIG9wUGF0aChvcDogUHVzaE9wIHwgUHVsbE9wKTogc3RyaW5nIHtcbiAgcmV0dXJuIG9wLmtpbmQgPT09ICdyZW5hbWUnID8gb3AudG9QYXRoIDogb3AucGF0aDtcbn1cblxuZnVuY3Rpb24gY29tcGFyZVN0cmluZ3MoYTogc3RyaW5nLCBiOiBzdHJpbmcpOiBudW1iZXIge1xuICByZXR1cm4gYSA8IGIgPyAtMSA6IGEgPiBiID8gMSA6IDA7XG59XG4iLCAiLyoqXG4gKiBMb2NhbCBjaGFuZ2UgZGV0ZWN0aW9uIChBUkNISVRFQ1RVUkUubWQgXHUwMEE3OCBzdGVwIDMpLlxuICpcbiAqIGBzY2FuVmF1bHRgIHdhbGtzIHRoZSBzdG9yYWdlIGFkYXB0ZXIsIGFwcGxpZXMgdGhlIHNoYXJlZCBpZ25vcmUgcnVsZXMsXG4gKiBoYXNoZXMgbm9uLWlnbm9yZWQgZmlsZXMgKHNoYTI1NiBcdTIwMTQgc2FtZSBhcyBibG9iIGFkZHJlc3NpbmcpIGFuZCBkaWZmc1xuICogdGhlIHJlc3VsdCBhZ2FpbnN0IHRoZSBjbGllbnQncyBgTG9jYWxJbmRleGAuIFRoZSBkaWZmIGNsYXNzaWZpZXM6XG4gKlxuICogICAtIGBhZGRlZGAgICAgXHUyMDE0IGZpbGUgcHJlc2VudCwgcGF0aCB1bmtub3duIHRvIHRoZSBpbmRleDtcbiAqICAgLSBgbW9kaWZpZWRgIFx1MjAxNCBmaWxlIHByZXNlbnQsIGNvbnRlbnQgaGFzaCBkaWZmZXJzIGZyb20gdGhlIGluZGV4IGVudHJ5LlxuICogICAgICAgICAgICAgICAgICBBIGZpbGUgd2hvc2UgaW5kZXggZW50cnkgaXMgYSAqdG9tYnN0b25lKiBhbHNvIGxhbmRzIGhlcmVcbiAqICAgICAgICAgICAgICAgICAgKGRvY3VtZW50ZWQgZGVjaXNpb24pOiB3aGV0aGVyIGl0IGlzIGFuIGVkaXQtb2YtZGVsZXRlZFxuICogICAgICAgICAgICAgICAgICBvciBhIHB1cmUgcmVzdXJyZWN0LCB0aGUgcmVzb2x1dGlvbiBpcyBpZGVudGljYWwgXHUyMDE0IGxvY2FsXG4gKiAgICAgICAgICAgICAgICAgIGNvbnRlbnQgZXhpc3RzIHRoYXQgdGhlIGluZGV4IGhlYWQgZG9lcyBub3QgcmVmbGVjdDtcbiAqICAgLSBgZGVsZXRlZGAgIFx1MjAxNCBpbmRleCBlbnRyeSBsaXZlLCBmaWxlIGdvbmU7XG4gKiAgIC0gYHJlbmFtZWRgICBcdTIwMTQgYSBkZWxldGUgKyBhZGQgcGFpciAqd2l0aGluIG9uZSBzY2FuKiB3aG9zZSBjb250ZW50XG4gKiAgICAgICAgICAgICAgICAgIGhhc2hlcyBtYXRjaCAoQVJDSElURUNUVVJFIFx1MDBBNzQgcmVuYW1lIGNvcnJlbGF0aW9uKS4gQVxuICogICAgICAgICAgICAgICAgICByZW5hbWUgd2hvc2UgY29udGVudCBhbHNvIGNoYW5nZWQgKHJlbmFtZSArIGVkaXQpIG5vXG4gKiAgICAgICAgICAgICAgICAgIGxvbmdlciBjb3JyZWxhdGVzIGFuZCBmYWxscyBiYWNrIHRvIGRlbGV0ZSArIGFkZCBcdTIwMTQgdGhhdFxuICogICAgICAgICAgICAgICAgICBpcyB0aGUgZG9jdW1lbnRlZCwgY29ycmVjdCB2MSBiZWhhdmlvcjtcbiAqICAgLSBgZW1wdHlGb2xkZXJzYCBcdTIwMTQgZGlyZWN0b3JpZXMgZXhpc3RpbmcgaW4gc3RvcmFnZSBidXQgcmVwcmVzZW50ZWRcbiAqICAgICAgICAgICAgICAgICAgbmVpdGhlciBieSBhIGxpdmUgZm9sZGVyIHBsYWNlaG9sZGVyIGluIHRoZSBpbmRleCBub3IgYnlcbiAqICAgICAgICAgICAgICAgICAgYW55IGZpbGUgYmVuZWF0aCB0aGVtIChGUi0xMCkuXG4gKlxuICogIyMgVGhlIG10aW1lK3NpemUgcHJlLWZpbHRlciAoZmFzdCBtb2RlLCB0aGUgZGVmYXVsdClcbiAqXG4gKiBSZS1oYXNoaW5nIGEgNTBrLWZpbGUgdmF1bHQgYXQgZXZlcnkgYXBwLW9wZW4gaXMgYSByZWFsIGJhdHRlcnkgY29zdCwgc29cbiAqIGZhc3QgbW9kZSBza2lwcyBoYXNoaW5nIGEgZmlsZSB3aG9zZSBgc2l6ZWAgQU5EIGBtdGltZWAgKGZyb20gdGhlIHN0b3JhZ2VcbiAqIGFkYXB0ZXIncyBgRmlsZVN0YXRgKSBleGFjdGx5IG1hdGNoIGl0cyBsaXZlIGluZGV4IGVudHJ5IFx1MjAxNCB0aGUgcmVjb3JkZWRcbiAqIGhhc2ggY2FycmllcyBmb3J3YXJkIGFzIHVuY2hhbmdlZC4gQSBmaWxlIGlzIGhhc2hlZCB3aGVuIGl0IGhhcyBubyBlbnRyeSxcbiAqIHRoZSBlbnRyeSBpcyBhIHRvbWJzdG9uZSBvciBmb2xkZXIgcGxhY2Vob2xkZXIsIHRoZSBzaXplIGRpZmZlcnMsIG9yIHRoZVxuICogbXRpbWUgZGlmZmVycyBvciBpcyB1bmtub3duIChsZWdhY3kgc3RhdGUsIHB1bGxzLCBmaXJzdCBzY2FuKS4gUmVuYW1lXG4gKiBjb3JyZWxhdGlvbiBpcyB1bmFmZmVjdGVkOiB0aGUgZGVzdGluYXRpb24gcGF0aCBvZiBhIHJlbmFtZSBhbHdheXMgbG9va3NcbiAqICdhZGRlZCcsIHNvIGl0IGlzIGFsd2F5cyBoYXNoZWQgXHUyMDE0IGNvbnRlbnQtcHJlc2VydmluZyBtb3ZlcyBzdGlsbCBwYWlyLlxuICpcbiAqIFRoZSB0cmFkZW9mZjogZmFzdCBtb2RlIHRydXN0cyB0aGUgZmlsZXN5c3RlbSBub3QgdG8gY2hhbmdlIGNvbnRlbnQgd2hpbGVcbiAqIHByZXNlcnZpbmcgYm90aCBzaXplIGFuZCBtdGltZS4gRm9yIHZlcmlmaWNhdGlvbiAoYHZzYSBkb2N0b3JgLCBwZXJpb2RpY1xuICogaW50ZWdyaXR5IGNoZWNrcykgcGFzcyBgeyBtb2RlOiAnZnVsbCcgfWAgdG8gcmUtaGFzaCBldmVyeXRoaW5nLlxuICpcbiAqIFRoZSBmdW5jdGlvbiB0YWtlcyBgbm93YCBhbmQgdGhlIGlnbm9yZSBzZXR0aW5ncyBhcyBwYXJhbWV0ZXJzIChubyBoaWRkZW5cbiAqIGNsb2Nrcywgbm8gYW1iaWVudCBjb25maWcpIGFuZCByZXR1cm5zIGRldGVybWluaXN0aWNhbGx5IG9yZGVyZWQgcmVzdWx0c1xuICogKGV2ZXJ5IGJ1Y2tldCBzb3J0ZWQgYnkgcGF0aDsgcmVuYW1lcyBieSBgZnJvbWApLlxuICovXG5cbmltcG9ydCB0eXBlIHsgRmlsZVN0YXQsIFN0b3JhZ2VBZGFwdGVyIH0gZnJvbSAnLi9hZGFwdGVycy5qcyc7XG5pbXBvcnQgeyBzaGEyNTZIZXggfSBmcm9tICcuL2hhc2hpbmcuanMnO1xuaW1wb3J0IHsgaXNJZ25vcmVkLCB0eXBlIElnbm9yZVNldHRpbmdzIH0gZnJvbSAnLi9pZ25vcmUuanMnO1xuaW1wb3J0IHR5cGUgeyBMb2NhbEluZGV4LCBMb2NhbEluZGV4RW50cnkgfSBmcm9tICcuL2xvY2FsaW5kZXguanMnO1xuaW1wb3J0IHsgcGFyZW50UGF0aCB9IGZyb20gJy4vcGF0aHMuanMnO1xuXG4vKiogSW5qZWN0YWJsZSBjb250ZW50IGhhc2ggKHRoZSBkZWZhdWx0IGlzIHNoYTI1Niwgc2FtZSBhcyBibG9iIGFkZHJlc3NpbmcpLiAqL1xuZXhwb3J0IHR5cGUgSGFzaEZuID0gKGJ5dGVzOiBVaW50OEFycmF5KSA9PiBQcm9taXNlPHN0cmluZz47XG5cbi8qKiBPcHRpb25zIGZvciBgc2NhblZhdWx0YC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU2NhblZhdWx0T3B0aW9ucyB7XG4gIC8qKlxuICAgKiBgJ2Zhc3QnYCAoZGVmYXVsdCk6IGZpbGVzIHdob3NlIHNpemUrbXRpbWUgZXhhY3RseSBtYXRjaCB0aGVpciBsaXZlIGluZGV4XG4gICAqIGVudHJ5IHNraXAgcmUtaGFzaGluZy4gYCdmdWxsJ2A6IGhhc2ggZXZlcnl0aGluZyByZWdhcmRsZXNzIFx1MjAxNCBpbnRlZ3JpdHlcbiAgICogdmVyaWZpY2F0aW9uIChgdnNhIGRvY3RvcmAsIHBlcmlvZGljIGNoZWNrcykuXG4gICAqL1xuICBtb2RlPzogJ2Zhc3QnIHwgJ2Z1bGwnO1xuICAvKiogQ29udGVudCBoYXNoIG92ZXJyaWRlICh0ZXN0cyBjb3VudC9pbnNwZWN0IGhhc2hpbmcpLiBEZWZhdWx0OiBzaGEyNTZIZXguICovXG4gIGhhc2g/OiBIYXNoRm47XG59XG5cbi8qKiBBIGxvY2FsIGNvbnRlbnQgY2hhbmdlIGZvciBhIHBhdGggdGhhdCBleGlzdHMgaW4gc3RvcmFnZS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU2NhbkNhbmRpZGF0ZSB7XG4gIHBhdGg6IHN0cmluZztcbiAgaGFzaDogc3RyaW5nO1xuICBzaXplOiBudW1iZXI7XG59XG5cbi8qKiBBIGxvY2FsIGRlbGV0aW9uOiBjYXJyaWVzIHRoZSBpbmRleCdzIHZlcnNpb24gc28gdGhlIHRvbWJzdG9uZSBjb21taXQgbmFtZXMgaXRzIHBhcmVudC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRGVsZXRlZENhbmRpZGF0ZSB7XG4gIHBhdGg6IHN0cmluZztcbiAgLyoqIEhhc2ggb2YgdGhlIGNvbnRlbnQgYXMgbGFzdCBzeW5jZWQgKHRvbWJzdG9uZXMgcmV1c2UgaXQpLiAqL1xuICBoYXNoOiBzdHJpbmc7XG4gIHNpemU6IG51bWJlcjtcbiAgLyoqIFZlcnNpb24gaWQgdGhlIGRlbGV0aW9uIGNvbW1pdCBidWlsZHMgb24uICovXG4gIHZlcnNpb25JZDogc3RyaW5nO1xufVxuXG4vKiogQSBkZXRlY3RlZCByZW5hbWU6IHNhbWUgY29udGVudCBoYXNoIG1vdmVkIGZyb20gYGZyb21gIHRvIGB0b2AuICovXG5leHBvcnQgaW50ZXJmYWNlIFJlbmFtZUNhbmRpZGF0ZSB7XG4gIGZyb206IHN0cmluZztcbiAgdG86IHN0cmluZztcbiAgaGFzaDogc3RyaW5nO1xuICBzaXplOiBudW1iZXI7XG59XG5cbi8qKlxuICogQSBmaWxlIHRoaXMgc2NhbiBhY3R1YWxseSByZWFkIGFuZCBoYXNoZWQsIHdpdGggdGhlIHN0YXQgb2JzZXJ2ZWQgYXQgaGFzaFxuICogdGltZS4gRmVlZHMgYHJlY29yZEhhc2hlZEZpbGVzYCBzbyB0aGUgTkVYVCBmYXN0IHNjYW4gY2FuIHNraXAgdGhlc2UgZmlsZXNcbiAqICh0aGUgbXRpbWUgY2FjaGUgb24gdGhlIGluZGV4IGVudHJ5KS4gRmlsZXMgc2tpcHBlZCBieSB0aGUgcHJlLWZpbHRlciBhcmUsXG4gKiBieSBkZWZpbml0aW9uLCBub3QgaGFzaGVkIGFuZCBkbyBub3QgYXBwZWFyIGhlcmUuXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgSGFzaGVkRmlsZSB7XG4gIHBhdGg6IHN0cmluZztcbiAgaGFzaDogc3RyaW5nO1xuICBzaXplOiBudW1iZXI7XG4gIC8qKiBFcG9jaCBtcyBcdTIwMTQgdGhlIHN0b3JhZ2Ugc3RhdCBhdCBoYXNoIHRpbWUgKGBGaWxlU3RhdC5tdGltZWApLiAqL1xuICBtdGltZTogbnVtYmVyO1xufVxuXG4vKiogVGhlIGZ1bGwgcmVzdWx0IG9mIG9uZSBsb2NhbCBzY2FuLiBBbGwgYnVja2V0cyBzb3J0ZWQgYnkgcGF0aC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgTG9jYWxDaGFuZ2VzIHtcbiAgLyoqIFRoZSBgbm93YCBwYXNzZWQgaW4gXHUyMDE0IHdoZW4gdGhpcyBzY2FuIGNvbmNlcHR1YWxseSBoYXBwZW5lZC4gKi9cbiAgc2Nhbm5lZEF0OiBudW1iZXI7XG4gIGFkZGVkOiBTY2FuQ2FuZGlkYXRlW107XG4gIG1vZGlmaWVkOiBTY2FuQ2FuZGlkYXRlW107XG4gIGRlbGV0ZWQ6IERlbGV0ZWRDYW5kaWRhdGVbXTtcbiAgcmVuYW1lZDogUmVuYW1lQ2FuZGlkYXRlW107XG4gIC8qKiBFbXB0eS1mb2xkZXIgcGF0aHMgdG8gcHVzaCBhcyBwbGFjZWhvbGRlciBlbnRyaWVzIChGUi0xMCkuICovXG4gIGVtcHR5Rm9sZGVyczogc3RyaW5nW107XG4gIC8qKiBFdmVyeSBmaWxlIHRoZSBzY2FuIGhhc2hlZCAoZmFzdCBtb2RlJ3Mgc2tpcHBlZCBmaWxlcyBhcmUgYWJzZW50KSwgc29ydGVkIGJ5IHBhdGguICovXG4gIGhhc2hlZDogSGFzaGVkRmlsZVtdO1xufVxuXG4vKipcbiAqIFNjYW4gdGhlIHZhdWx0IGFuZCBkaWZmIGl0IGFnYWluc3QgdGhlIGluZGV4LlxuICpcbiAqIEluIGZhc3QgbW9kZSAodGhlIGRlZmF1bHQpIGEgZmlsZSB3aG9zZSBzaXplIGFuZCBtdGltZSBib3RoIGV4YWN0bHkgbWF0Y2hcbiAqIGl0cyBsaXZlIGluZGV4IGVudHJ5IGlzIE5PVCByZS1oYXNoZWQgXHUyMDE0IHRoZSByZWNvcmRlZCBoYXNoIGNhcnJpZXMgZm9yd2FyZFxuICogYXMgdW5jaGFuZ2VkIChzZWUgdGhlIG1vZHVsZSBkb2MgZm9yIHRoZSB0cmFkZW9mZiBhbmQgdGhlIGBmdWxsYCBlc2NhcGVcbiAqIGhhdGNoKS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHNjYW5WYXVsdChcbiAgc3RvcmFnZTogU3RvcmFnZUFkYXB0ZXIsXG4gIGluZGV4OiBMb2NhbEluZGV4LFxuICBzZXR0aW5nczogSWdub3JlU2V0dGluZ3MsXG4gIG5vdzogbnVtYmVyLFxuICBvcHRpb25zOiBTY2FuVmF1bHRPcHRpb25zID0ge30sXG4pOiBQcm9taXNlPExvY2FsQ2hhbmdlcz4ge1xuICBjb25zdCBoYXNoRm4gPSBvcHRpb25zLmhhc2ggPz8gc2hhMjU2SGV4O1xuICBjb25zdCBtb2RlID0gb3B0aW9ucy5tb2RlID8/ICdmYXN0JztcblxuICBjb25zdCBmaWxlcyA9IGF3YWl0IHN0b3JhZ2UubGlzdEZpbGVzKCk7XG5cbiAgY29uc3Qga2VwdDogRmlsZVN0YXRbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGZpbGUgb2YgZmlsZXMpIHtcbiAgICBpZiAoIWlzSWdub3JlZChmaWxlLnBhdGgsIHNldHRpbmdzKSkga2VwdC5wdXNoKGZpbGUpO1xuICB9XG4gIGNvbnN0IGtlcHRQYXRocyA9IG5ldyBTZXQoa2VwdC5tYXAoKGYpID0+IGYucGF0aCkpO1xuXG4gIGNvbnN0IGFkZGVkOiBTY2FuQ2FuZGlkYXRlW10gPSBbXTtcbiAgY29uc3QgbW9kaWZpZWQ6IFNjYW5DYW5kaWRhdGVbXSA9IFtdO1xuICBjb25zdCBoYXNoZWQ6IEhhc2hlZEZpbGVbXSA9IFtdO1xuXG4gIGZvciAoY29uc3QgZmlsZSBvZiBrZXB0KSB7XG4gICAgY29uc3QgZW50cnkgPSBpbmRleFtmaWxlLnBhdGhdO1xuICAgIGlmIChtb2RlID09PSAnZmFzdCcgJiYgc3RhdE1hdGNoZXNFbnRyeShlbnRyeSwgZmlsZSkpIHtcbiAgICAgIGNvbnRpbnVlOyAvLyBzaXplK210aW1lIHVuY2hhbmdlZCBzaW5jZSB0aGUgcmVjb3JkZWQgaGFzaCBcdTIwMTQgdHJ1c3QgaXRcbiAgICB9XG4gICAgY29uc3QgaGFzaCA9IGF3YWl0IGhhc2hGbihhd2FpdCBzdG9yYWdlLnJlYWRGaWxlKGZpbGUucGF0aCkpO1xuICAgIGhhc2hlZC5wdXNoKHsgcGF0aDogZmlsZS5wYXRoLCBoYXNoLCBzaXplOiBmaWxlLnNpemUsIG10aW1lOiBmaWxlLm10aW1lIH0pO1xuICAgIGlmIChlbnRyeSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBhZGRlZC5wdXNoKHsgcGF0aDogZmlsZS5wYXRoLCBoYXNoLCBzaXplOiBmaWxlLnNpemUgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgaWYgKGVudHJ5LmlzRm9sZGVyKSB7XG4gICAgICAvLyBBIHJlYWwgZmlsZSByZXBsYWNlZCBhIGZvbGRlciBwbGFjZWhvbGRlcjogdHJlYXQgYXMgY29udGVudCBjaGFuZ2UuXG4gICAgICBtb2RpZmllZC5wdXNoKHsgcGF0aDogZmlsZS5wYXRoLCBoYXNoLCBzaXplOiBmaWxlLnNpemUgfSk7XG4gICAgICBjb250aW51ZTtcbiAgICB9XG4gICAgLy8gVG9tYnN0b25lZCBlbnRyeSB3aXRoIHRoZSBmaWxlIGJhY2sgXHUyMUQyIG1vZGlmaWVkIChyZXN1cnJlY3Qgb3JcbiAgICAvLyBlZGl0LW9mLWRlbGV0ZWQgXHUyMDE0IGJvdGggcmVzb2x2ZSB0aGUgc2FtZSB3YXkgZG93bnN0cmVhbSkuXG4gICAgaWYgKGVudHJ5LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkIHx8IGVudHJ5Lmhhc2ggIT09IGhhc2gpIHtcbiAgICAgIG1vZGlmaWVkLnB1c2goeyBwYXRoOiBmaWxlLnBhdGgsIGhhc2gsIHNpemU6IGZpbGUuc2l6ZSB9KTtcbiAgICB9XG4gIH1cblxuICBjb25zdCBkZWxldGVkOiBEZWxldGVkQ2FuZGlkYXRlW10gPSBbXTtcbiAgZm9yIChjb25zdCBbcGF0aCwgZW50cnldIG9mIE9iamVjdC5lbnRyaWVzKGluZGV4KSkge1xuICAgIGlmIChlbnRyeS5pc0ZvbGRlcikgY29udGludWU7IC8vIGZvbGRlciBwbGFjZWhvbGRlcnMgbmV2ZXIgcHJvZHVjZSBmaWxlIGRlbGV0aW9uc1xuICAgIGlmIChlbnRyeS5kZWxldGVkQXQgIT09IHVuZGVmaW5lZCkgY29udGludWU7IC8vIGFscmVhZHkgdG9tYnN0b25lZFxuICAgIGlmIChrZXB0UGF0aHMuaGFzKHBhdGgpKSBjb250aW51ZTtcbiAgICBpZiAoaXNJZ25vcmVkKHBhdGgsIHNldHRpbmdzKSkge1xuICAgICAgLy8gVGhlIHBhdGggYmVjYW1lIGlnbm9yZWQgKHNldHRpbmdzIGNoYW5nZSkgXHUyMDE0IG5vdCBhIGRlbGV0aW9uLlxuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGRlbGV0ZWQucHVzaCh7IHBhdGgsIGhhc2g6IGVudHJ5Lmhhc2gsIHNpemU6IGVudHJ5LnNpemUsIHZlcnNpb25JZDogZW50cnkudmVyc2lvbklkIH0pO1xuICB9XG5cbiAgY29uc3QgeyByZW5hbWVkLCBkZWxldGVkOiB1bm1hdGNoZWREZWxldGVkLCBhZGRlZDogdW5tYXRjaGVkQWRkZWQgfSA9IGRldGVjdFJlbmFtZXMoZGVsZXRlZCwgYWRkZWQpO1xuICBjb25zdCBlbXB0eUZvbGRlcnMgPSBhd2FpdCBkZXRlY3RFbXB0eUZvbGRlcnMoc3RvcmFnZSwgaW5kZXgsIHNldHRpbmdzLCBmaWxlcyk7XG5cbiAgcmV0dXJuIHtcbiAgICBzY2FubmVkQXQ6IG5vdyxcbiAgICBhZGRlZDogc29ydENhbmRpZGF0ZXModW5tYXRjaGVkQWRkZWQpLFxuICAgIG1vZGlmaWVkOiBzb3J0Q2FuZGlkYXRlcyhtb2RpZmllZCksXG4gICAgZGVsZXRlZDogWy4uLnVubWF0Y2hlZERlbGV0ZWRdLnNvcnQoYnlQYXRoKSxcbiAgICByZW5hbWVkOiBbLi4ucmVuYW1lZF0uc29ydCgoYSwgYikgPT4gYnlQYXRoKGEsIGIpKSxcbiAgICBlbXB0eUZvbGRlcnMsXG4gICAgaGFzaGVkOiBbLi4uaGFzaGVkXS5zb3J0KGJ5UGF0aCksXG4gIH07XG59XG5cbi8qKlxuICogV2hldGhlciB0aGUgZmlsZSdzIHN0YXQgZXhhY3RseSBtYXRjaGVzIGl0cyBsaXZlIGluZGV4IGVudHJ5IFx1MjAxNCB0aGUgZmFzdFxuICogbW9kZSBwcmUtZmlsdGVyLiBSZXF1aXJlcyBhIGtub3duIHJlY29yZGVkIGBtdGltZWAgKGxlZ2FjeSBlbnRyaWVzIGFuZFxuICogcHVsbC13cml0dGVuIGVudHJpZXMgaGF2ZSBub25lIFx1MjFEMiBoYXNoZWQsIHRoZW4gcmVjb3JkZWQpIGFuZCBuZXZlciBmaXJlc1xuICogZm9yIHRvbWJzdG9uZXMgKGEgcmVzdXJyZWN0IG11c3QgYWx3YXlzIHN1cmZhY2UpIG9yIGZvbGRlciBwbGFjZWhvbGRlcnMuXG4gKi9cbmZ1bmN0aW9uIHN0YXRNYXRjaGVzRW50cnkoZW50cnk6IExvY2FsSW5kZXhFbnRyeSB8IHVuZGVmaW5lZCwgZmlsZTogRmlsZVN0YXQpOiBib29sZWFuIHtcbiAgcmV0dXJuIChcbiAgICBlbnRyeSAhPT0gdW5kZWZpbmVkICYmXG4gICAgZW50cnkuZGVsZXRlZEF0ID09PSB1bmRlZmluZWQgJiZcbiAgICBlbnRyeS5pc0ZvbGRlciAhPT0gdHJ1ZSAmJlxuICAgIGVudHJ5Lm10aW1lICE9PSB1bmRlZmluZWQgJiZcbiAgICBlbnRyeS5tdGltZSA9PT0gZmlsZS5tdGltZSAmJlxuICAgIGVudHJ5LnNpemUgPT09IGZpbGUuc2l6ZVxuICApO1xufVxuXG4vKipcbiAqIFJlY29yZCBhIHNjYW4ncyBoYXNoIG9ic2VydmF0aW9ucyBpbnRvIHRoZSBpbmRleDogZm9yIGV2ZXJ5IGxpdmUgZmlsZVxuICogZW50cnkgd2hvc2UgY29udGVudCBoYXNoIG1hdGNoZXMgd2hhdCB0aGUgc2NhbiBoYXNoZWQsIGNhY2hlIHRoZSBvYnNlcnZlZFxuICogbXRpbWUgc28gdGhlIG5leHQgZmFzdCBzY2FuIGNhbiBza2lwIHJlLWhhc2hpbmcgaXQuXG4gKlxuICogUHVyZTogcmV0dXJucyBhIG5ldyBpbmRleCAob3IgdGhlIGlucHV0IHdoZW4gbm90aGluZyBjaGFuZ2VzKSwgbmV2ZXJcbiAqIG11dGF0ZXMuIFRoZSBoYXNoLW1hdGNoIGd1YXJkIGtlZXBzIHRoZSBjYWNoZSBob25lc3QgXHUyMDE0IGFuIGVudHJ5IHdob3NlXG4gKiBoYXNoIG5vIGxvbmdlciByZWZsZWN0cyB0aGUgb2JzZXJ2YXRpb24gKGUuZy4gYSBwdWxsIG92ZXJ3cm90ZSB0aGUgcGF0aFxuICogbWlkLWN5Y2xlKSBpcyBsZWZ0IHVudG91Y2hlZCBhbmQgc2ltcGx5IGdldHMgcmUtaGFzaGVkIG5leHQgc2Nhbi5cbiAqIEVudHJpZXMgbmV2ZXIgZGVtb3RlOiBgZGVsZXRlZEF0YC9gaXNGb2xkZXJgIGVudHJpZXMgYXJlIG5ldmVyIHBhdGNoZWQuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiByZWNvcmRIYXNoZWRGaWxlcyhcbiAgaW5kZXg6IExvY2FsSW5kZXgsXG4gIGhhc2hlZDogcmVhZG9ubHkgSGFzaGVkRmlsZVtdLFxuKTogTG9jYWxJbmRleCB7XG4gIGxldCBuZXh0OiBSZWNvcmQ8c3RyaW5nLCBMb2NhbEluZGV4RW50cnk+IHwgdW5kZWZpbmVkO1xuICBmb3IgKGNvbnN0IG9ic2VydmVkIG9mIGhhc2hlZCkge1xuICAgIGNvbnN0IGVudHJ5ID0gaW5kZXhbb2JzZXJ2ZWQucGF0aF07XG4gICAgaWYgKGVudHJ5ID09PSB1bmRlZmluZWQgfHwgZW50cnkuaXNGb2xkZXIgfHwgZW50cnkuZGVsZXRlZEF0ICE9PSB1bmRlZmluZWQpIGNvbnRpbnVlO1xuICAgIGlmIChlbnRyeS5oYXNoICE9PSBvYnNlcnZlZC5oYXNoKSBjb250aW51ZTtcbiAgICBpZiAoZW50cnkubXRpbWUgPT09IG9ic2VydmVkLm10aW1lKSBjb250aW51ZTtcbiAgICBuZXh0ID8/PSB7IC4uLmluZGV4IH07XG4gICAgbmV4dFtvYnNlcnZlZC5wYXRoXSA9IHsgLi4uZW50cnksIG10aW1lOiBvYnNlcnZlZC5tdGltZSB9O1xuICB9XG4gIHJldHVybiBuZXh0ID8/IGluZGV4O1xufVxuXG4vKipcbiAqIENvcnJlbGF0ZSBkZWxldGUgKyBhZGQgcGFpcnMgYnkgY29udGVudCBoYXNoIChBUkNISVRFQ1RVUkUgXHUwMEE3NCkuXG4gKlxuICogT25lLXRvLW9uZSBtYXRjaGluZywgbW9zdCBkZXRlcm1pbmlzdGljIHdpbnM6IHdoZW4gc2V2ZXJhbCB1bm1hdGNoZWQgYWRkc1xuICogc2hhcmUgdGhlIGRlbGV0ZWQgc2lkZSdzIGhhc2gsIHByZWZlciBhbiBhZGQgaW4gdGhlIHNhbWUgcGFyZW50IGRpcmVjdG9yeTtcbiAqIHdpdGhpbiBhIHByZWZlcmVuY2UgY2xhc3MsIHRoZSBsZXhpY29ncmFwaGljYWxseSBzbWFsbGVzdCBgdG9gIHBhdGggd2lucy5cbiAqIE1hdGNoZWQgcGFpcnMgbGVhdmUgdGhlIGRlbGV0ZS9hZGQgYnVja2V0cyBhbmQgYmVjb21lIGByZW5hbWVkYC5cbiAqL1xuZnVuY3Rpb24gZGV0ZWN0UmVuYW1lcyhcbiAgZGVsZXRlZDogcmVhZG9ubHkgRGVsZXRlZENhbmRpZGF0ZVtdLFxuICBhZGRlZDogcmVhZG9ubHkgU2NhbkNhbmRpZGF0ZVtdLFxuKToge1xuICByZW5hbWVkOiBSZW5hbWVDYW5kaWRhdGVbXTtcbiAgZGVsZXRlZDogRGVsZXRlZENhbmRpZGF0ZVtdO1xuICBhZGRlZDogU2NhbkNhbmRpZGF0ZVtdO1xufSB7XG4gIGNvbnN0IGFkZHNCeUhhc2ggPSBuZXcgTWFwPHN0cmluZywgU2NhbkNhbmRpZGF0ZVtdPigpO1xuICBmb3IgKGNvbnN0IGNhbmRpZGF0ZSBvZiBbLi4uYWRkZWRdLnNvcnQoYnlQYXRoKSkge1xuICAgIGNvbnN0IGJ1Y2tldCA9IGFkZHNCeUhhc2guZ2V0KGNhbmRpZGF0ZS5oYXNoKTtcbiAgICBpZiAoYnVja2V0KSBidWNrZXQucHVzaChjYW5kaWRhdGUpO1xuICAgIGVsc2UgYWRkc0J5SGFzaC5zZXQoY2FuZGlkYXRlLmhhc2gsIFtjYW5kaWRhdGVdKTtcbiAgfVxuXG4gIGNvbnN0IHVzZWRBZGRzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGNvbnN0IHJlbmFtZWQ6IFJlbmFtZUNhbmRpZGF0ZVtdID0gW107XG4gIGNvbnN0IHVubWF0Y2hlZERlbGV0ZWQ6IERlbGV0ZWRDYW5kaWRhdGVbXSA9IFtdO1xuXG4gIGZvciAoY29uc3QgZGVsZXRpb24gb2YgWy4uLmRlbGV0ZWRdLnNvcnQoYnlQYXRoKSkge1xuICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBhZGRzQnlIYXNoLmdldChkZWxldGlvbi5oYXNoKSA/PyBbXTtcbiAgICBsZXQgZmFsbGJhY2s6IFNjYW5DYW5kaWRhdGUgfCB1bmRlZmluZWQ7XG4gICAgbGV0IHNhbWVEaXI6IFNjYW5DYW5kaWRhdGUgfCB1bmRlZmluZWQ7XG4gICAgZm9yIChjb25zdCBjYW5kaWRhdGUgb2YgY2FuZGlkYXRlcykge1xuICAgICAgaWYgKHVzZWRBZGRzLmhhcyhjYW5kaWRhdGUucGF0aCkpIGNvbnRpbnVlO1xuICAgICAgaWYgKHBhcmVudFBhdGgoY2FuZGlkYXRlLnBhdGgpID09PSBwYXJlbnRQYXRoKGRlbGV0aW9uLnBhdGgpKSB7XG4gICAgICAgIHNhbWVEaXIgPz89IGNhbmRpZGF0ZTsgLy8gc29ydGVkIFx1MjFEMiBmaXJzdCBpcyBzbWFsbGVzdFxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZmFsbGJhY2sgPz89IGNhbmRpZGF0ZTtcbiAgICAgIH1cbiAgICB9XG4gICAgY29uc3QgbWF0Y2ggPSBzYW1lRGlyID8/IGZhbGxiYWNrO1xuICAgIGlmIChtYXRjaCkge1xuICAgICAgdXNlZEFkZHMuYWRkKG1hdGNoLnBhdGgpO1xuICAgICAgcmVuYW1lZC5wdXNoKHsgZnJvbTogZGVsZXRpb24ucGF0aCwgdG86IG1hdGNoLnBhdGgsIGhhc2g6IGRlbGV0aW9uLmhhc2gsIHNpemU6IGRlbGV0aW9uLnNpemUgfSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHVubWF0Y2hlZERlbGV0ZWQucHVzaChkZWxldGlvbik7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHtcbiAgICByZW5hbWVkLFxuICAgIGRlbGV0ZWQ6IHVubWF0Y2hlZERlbGV0ZWQsXG4gICAgYWRkZWQ6IGFkZGVkLmZpbHRlcigoY2FuZGlkYXRlKSA9PiAhdXNlZEFkZHMuaGFzKGNhbmRpZGF0ZS5wYXRoKSksXG4gIH07XG59XG5cbi8qKlxuICogRGlyZWN0b3JpZXMgdGhhdCBleGlzdCBpbiBzdG9yYWdlIGJ1dCBhcmUgcmVwcmVzZW50ZWQgbmVpdGhlciBieSBhIGxpdmVcbiAqIGZvbGRlciBwbGFjZWhvbGRlciBpbiB0aGUgaW5kZXggbm9yIGJ5IGFueSBmaWxlIChpZ25vcmVkIG9yIG5vdCkgYmVuZWF0aFxuICogdGhlbS4gQSBkaXJlY3RvcnkgY29udGFpbmluZyBvbmx5IGlnbm9yZWQgZmlsZXMgaXMgdGhlcmVmb3JlICpub3QqIGVtcHR5IFx1MjAxNFxuICogaXQgaXMgcmVwcmVzZW50ZWQgYnkgdGhvc2UgZmlsZXMgYXMgZmFyIGFzIHRoZSBsb2NhbCBtYWNoaW5lIGlzIGNvbmNlcm5lZC5cbiAqL1xuYXN5bmMgZnVuY3Rpb24gZGV0ZWN0RW1wdHlGb2xkZXJzKFxuICBzdG9yYWdlOiBTdG9yYWdlQWRhcHRlcixcbiAgaW5kZXg6IExvY2FsSW5kZXgsXG4gIHNldHRpbmdzOiBJZ25vcmVTZXR0aW5ncyxcbiAgZmlsZXM6IHJlYWRvbmx5IEZpbGVTdGF0W10sXG4pOiBQcm9taXNlPHN0cmluZ1tdPiB7XG4gIGNvbnN0IHJlcHJlc2VudGVkRGlycyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBmb3IgKGNvbnN0IGZpbGUgb2YgZmlsZXMpIHtcbiAgICBmb3IgKGxldCBkaXIgPSBwYXJlbnRQYXRoKGZpbGUucGF0aCk7IGRpciAhPT0gJy8nOyBkaXIgPSBwYXJlbnRQYXRoKGRpcikpIHtcbiAgICAgIHJlcHJlc2VudGVkRGlycy5hZGQoZGlyKTtcbiAgICB9XG4gIH1cblxuICBjb25zdCBlbXB0eUZvbGRlcnM6IHN0cmluZ1tdID0gW107XG4gIGZvciAoY29uc3QgZGlyIG9mIGF3YWl0IHN0b3JhZ2UubGlzdERpcnMoKSkge1xuICAgIGlmIChkaXIgPT09ICcvJykgY29udGludWU7XG4gICAgaWYgKHJlcHJlc2VudGVkRGlycy5oYXMoZGlyKSkgY29udGludWU7XG4gICAgaWYgKGlzSWdub3JlZChkaXIsIHNldHRpbmdzKSkgY29udGludWU7XG4gICAgY29uc3QgZW50cnkgPSBpbmRleFtkaXJdO1xuICAgIGlmIChlbnRyeT8uaXNGb2xkZXIgJiYgZW50cnkuZGVsZXRlZEF0ID09PSB1bmRlZmluZWQpIGNvbnRpbnVlOyAvLyBhbHJlYWR5IHN5bmNlZCBhcyBwbGFjZWhvbGRlclxuICAgIGVtcHR5Rm9sZGVycy5wdXNoKGRpcik7XG4gIH1cbiAgcmV0dXJuIGVtcHR5Rm9sZGVycy5zb3J0KCk7XG59XG5cbmZ1bmN0aW9uIHNvcnRDYW5kaWRhdGVzKGNhbmRpZGF0ZXM6IFNjYW5DYW5kaWRhdGVbXSk6IFNjYW5DYW5kaWRhdGVbXSB7XG4gIHJldHVybiBbLi4uY2FuZGlkYXRlc10uc29ydChieVBhdGgpO1xufVxuXG5mdW5jdGlvbiBieVBhdGg8VCBleHRlbmRzIHsgcGF0aD86IHN0cmluZzsgZnJvbT86IHN0cmluZyB9PihhOiBULCBiOiBUKTogbnVtYmVyIHtcbiAgY29uc3Qga2V5QSA9IGEucGF0aCA/PyBhLmZyb20gPz8gJyc7XG4gIGNvbnN0IGtleUIgPSBiLnBhdGggPz8gYi5mcm9tID8/ICcnO1xuICByZXR1cm4ga2V5QSA8IGtleUIgPyAtMSA6IGtleUEgPiBrZXlCID8gMSA6IDA7XG59XG4iLCAiLyoqXG4gKiBgU3luY0NsaWVudGAgXHUyMDE0IHRoZSBuZXR3b3JrLWZhY2luZyBvcmNoZXN0cmF0b3IgKEFSQ0hJVEVDVFVSRS5tZCBcdTAwQTc4KS5cbiAqXG4gKiBDb21wb3NlcyB0aGUgcGhhc2UtMWEvMWIgcGllY2VzIGludG8gb25lIGxvb3AgcGVyIGRldmljZTpcbiAqXG4gKiAgIHN0YXJ0dXA6ICBsb2FkTG9jYWxJbmRleCBcdTIxOTIgaGVsbG8vaGVsbG9BY2sgXHUyMTkyIGdldE1hbmlmZXN0IFx1MjE5MiBzY2FuVmF1bHQgXHUyMTkyXG4gKiAgICAgICAgICAgICBjb21wdXRlU3luY1BsYW4gXHUyMTkyIGV4ZWN1dGUgKHB1c2hlcyBpbmxpbmUtb3ItYmxvYiwgcHVsbHMgdmlhXG4gKiAgICAgICAgICAgICBhcHBseVB1bGwgd2l0aCB0aGUgaW5qZWN0ZWQgYmxvYiBzdG9yZSk7XG4gKiAgIGxpdmU6ICAgICBgY2hhbmdlYCBtZXNzYWdlcyBtYXRlcmlhbGl6ZSBpbW1lZGlhdGVseSB3aGVuIHRoZSB0YXJnZXQgaXNcbiAqICAgICAgICAgICAgIGNsZWFuLCBhbmQgZGVmZXIgdG8gYSBmdWxsIHJlY29uY2lsZSBjeWNsZSB3aGVuIGl0IGlzIG5vdCBcdTIwMTQgYVxuICogICAgICAgICAgICAgcmVtb3RlIGNoYW5nZSBpcyBORVZFUiB3cml0dGVuIG92ZXIgbG9jYWxseS1tb2RpZmllZCBjb250ZW50XG4gKiAgICAgICAgICAgICB3aXRob3V0IGdvaW5nIHRocm91Z2ggYGNvbXB1dGVTeW5jUGxhbmAncyBjb25mbGljdCBsb2dpYztcbiAqICAgd2F0Y2hlcjogIGBXYXRjaEFkYXB0ZXJgIGJhdGNoZXMgYXJlIGRlYm91bmNlZCAofjMwMCBtcywgaW5qZWN0YWJsZVxuICogICAgICAgICAgICAgc2NoZWR1bGVyIFx1MjAxNCBubyBhbWJpZW50IHRpbWVycyBpbiB0ZXN0cykgaW50byBzY2FuXHUyMTkycGxhblx1MjE5MmV4ZWN1dGU7XG4gKiAgIHJlY29ubmVjdDogYG9uQ2xvc2VgIGZsaXBzIHRvIGAnZGlzY29ubmVjdGVkJ2A7IGByZWNvbm5lY3QoKWAgcmUtcnVucyB0aGVcbiAqICAgICAgICAgICAgIHdob2xlIHN0YXJ0dXAgcmVjb25jaWxpYXRpb24gKGJhY2tvZmYgaXMgdGhlIGNhbGxlcidzIGpvYikuXG4gKlxuICogQWxsIEkvTyBjcm9zc2VzIHRoZSBhZGFwdGVyIHNlYW1zIChgU3RvcmFnZUFkYXB0ZXJgLCBgVHJhbnNwb3J0YCxcbiAqIGBCbG9iU3RvcmVgLCBgTG9nQWRhcHRlcmApOyB0aGUgY2xhc3MgaXRzZWxmIGlzIHB1cmUgb3JjaGVzdHJhdGlvbiBhbmQgcnVuc1xuICogYW55d2hlcmUgYGNvcmVgIHJ1bnMgXHUyMDE0IFdvcmtlcnMgdGVzdHMgaW5jbHVkZWQuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBMb2dBZGFwdGVyLCBTdG9yYWdlQWRhcHRlciwgV2F0Y2hBZGFwdGVyIH0gZnJvbSAnLi9hZGFwdGVycy5qcyc7XG5pbXBvcnQgeyBjb21wYXJlQ2xvY2tzIH0gZnJvbSAnLi9jbG9jay5qcyc7XG5pbXBvcnQgeyBhcHBseVB1bGwsIGxvYWRMb2NhbEluZGV4LCB0eXBlIEZldGNoQmxvYiB9IGZyb20gJy4vZW5naW5lLmpzJztcbmltcG9ydCB7IE5ldHdvcmtFcnJvciwgUHJvdG9jb2xFcnJvciwgUmV2b2tlZEVycm9yLCBVbmF1dGhvcml6ZWRFcnJvciB9IGZyb20gJy4vZXJyb3JzLmpzJztcbmltcG9ydCB7IHNoYTI1NkhleCB9IGZyb20gJy4vaGFzaGluZy5qcyc7XG5pbXBvcnQgeyBpc0lnbm9yZWQsIHR5cGUgSWdub3JlU2V0dGluZ3MgfSBmcm9tICcuL2lnbm9yZS5qcyc7XG5pbXBvcnQge1xuICBhcHBseUNvbW1pdCxcbiAgTE9DQUxfSU5ERVhfU1RBVEVfUEFUSCxcbiAgcmVtb3ZlRW50cnksXG4gIHNlcmlhbGl6ZUxvY2FsSW5kZXgsXG4gIHR5cGUgTG9jYWxJbmRleCxcbn0gZnJvbSAnLi9sb2NhbGluZGV4LmpzJztcbmltcG9ydCB7XG4gIGJhc2U2NFRvQnl0ZXMsXG4gIGJ5dGVzVG9CYXNlNjQsXG4gIElOTElORV9DT05URU5UX01BWF9CWVRFUyxcbiAgUHJvdG9jb2xWZXJzaW9uLFxuICB0eXBlIEJsb2JBY2tNZXNzYWdlLFxuICB0eXBlIEJsb2JNZXNzYWdlLFxuICB0eXBlIENoYW5nZU1lc3NhZ2UsXG4gIHR5cGUgQ29tbWl0QWNrTWVzc2FnZSxcbiAgdHlwZSBDb21taXRNZXNzYWdlLFxuICB0eXBlIENvbmZsaWN0TWVzc2FnZSxcbiAgdHlwZSBIZWxsb0Fja01lc3NhZ2UsXG4gIHR5cGUgTWFuaWZlc3RNZXNzYWdlLFxuICB0eXBlIE1lc3NhZ2UsXG4gIHR5cGUgU2VydmVyTWVzc2FnZSxcbn0gZnJvbSAnLi9wcm90b2NvbC5qcyc7XG5pbXBvcnQge1xuICBjb21wdXRlU3luY1BsYW4sXG4gIHR5cGUgQ29uZmxpY3RPcCxcbiAgdHlwZSBQdWxsRmlsZU9wLFxuICB0eXBlIFB1bGxPcCxcbiAgdHlwZSBQdXNoT3AsXG4gIHR5cGUgUmVtb3RlRmlsZSxcbiAgdHlwZSBTeW5jUGxhbixcbn0gZnJvbSAnLi9yZXNvbHZlLmpzJztcbmltcG9ydCB7IHJlY29yZEhhc2hlZEZpbGVzLCBzY2FuVmF1bHQsIHR5cGUgSGFzaGVkRmlsZSB9IGZyb20gJy4vc2Nhbi5qcyc7XG5pbXBvcnQgdHlwZSB7IFRyYW5zcG9ydCB9IGZyb20gJy4vdHJhbnNwb3J0LmpzJztcbmltcG9ydCB0eXBlIHsgTG9naWNhbENsb2NrIH0gZnJvbSAnLi90eXBlcy5qcyc7XG5cbi8vIC0tLSBwdWJsaWMgb3B0aW9uL3N0YXR1cyBzaGFwZXMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIENsaWVudC1zaWRlIGNvbnRlbnQtYWRkcmVzc2VkIGJsb2IgY2FjaGUgKFIyIGNsaWVudCBpbiBwcm9kdWN0aW9uOyBhIE1hcCBpbiB0ZXN0cykuICovXG5leHBvcnQgaW50ZXJmYWNlIEJsb2JTdG9yZSB7XG4gIGdldChoYXNoOiBzdHJpbmcpOiBQcm9taXNlPFVpbnQ4QXJyYXkgfCB1bmRlZmluZWQ+O1xuICBwdXQoaGFzaDogc3RyaW5nLCBieXRlczogVWludDhBcnJheSk6IFByb21pc2U8dm9pZD47XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgU3luY0NsaWVudE9wdGlvbnMge1xuICBkZXZpY2VJZDogc3RyaW5nO1xuICBkZXZpY2VOYW1lOiBzdHJpbmc7XG4gIHRva2VuOiBzdHJpbmc7XG4gIC8qKiBBIGZhY3RvcnkgKHJlY29ubmVjdCBkaWFscyBmcmVzaCkgb3IgYSBzaW5nbGUgcmV1c2FibGUgaW5zdGFuY2UuICovXG4gIHRyYW5zcG9ydDogKCgpID0+IFRyYW5zcG9ydCkgfCBUcmFuc3BvcnQ7XG4gIGJsb2JTdG9yZTogQmxvYlN0b3JlO1xuICBzdG9yYWdlOiBTdG9yYWdlQWRhcHRlcjtcbiAgbG9nPzogTG9nQWRhcHRlcjtcbiAgLyoqIEluaXRpYWwgaWdub3JlIHNldHRpbmdzOyBzdXBlcnNlZGVkIGJ5IGBoZWxsb0Fjay5zZXR0aW5nc2Agb24gY29ubmVjdC4gKi9cbiAgc2V0dGluZ3M/OiBJZ25vcmVTZXR0aW5ncztcbiAgLyoqIEluamVjdGFibGUgY2xvY2sgKGRlZmF1bHQgYERhdGUubm93YCkuICovXG4gIG5vdz86ICgpID0+IG51bWJlcjtcbiAgLyoqIFdhdGNoZXIgZGVib3VuY2Ugd2luZG93IGluIG1zIChkZWZhdWx0IDMwMCkuICovXG4gIGRlYm91bmNlTXM/OiBudW1iZXI7XG4gIC8qKlxuICAgKiBTY2hlZHVsZXMgdGhlIGRlYm91bmNlZCBzeW5jIGN5Y2xlLiBEZWZhdWx0OiBgc2V0VGltZW91dGAuIFRlc3RzIGluamVjdCBhXG4gICAqIG1hbnVhbCBxdWV1ZSBcdTIwMTQgdGhlIGNsaWVudCBuZXZlciB0b3VjaGVzIGEgcmVhbCB0aW1lciBiZWhpbmQgdGhpcyBzZWFtLlxuICAgKi9cbiAgc2NoZWR1bGU/OiAoZm46ICgpID0+IHZvaWQsIG1zOiBudW1iZXIpID0+ICgpID0+IHZvaWQ7XG59XG5cbmV4cG9ydCB0eXBlIFN5bmNDbGllbnRTdGF0ZSA9ICdpZGxlJyB8ICdjb25uZWN0aW5nJyB8ICdzeW5jaW5nJyB8ICdsaXZlJyB8ICdkaXNjb25uZWN0ZWQnO1xuXG5leHBvcnQgaW50ZXJmYWNlIFN5bmNDbGllbnRTdGF0dXMge1xuICBzdGF0ZTogU3luY0NsaWVudFN0YXRlO1xuICAvKiogRXBvY2ggbXMgb2YgdGhlIGxhc3QgY29tcGxldGVkIGN5Y2xlLCBvciBudWxsIGJlZm9yZSB0aGUgZmlyc3QuICovXG4gIGxhc3RTeW5jQXQ6IG51bWJlciB8IG51bGw7XG4gIC8qKiBXYXRjaGVyL3JlY29uY2lsZSBldmVudHMgcXVldWVkIGJlaGluZCB0aGUgZGVib3VuY2Ugd2luZG93LiAqL1xuICBwZW5kaW5nOiBudW1iZXI7XG4gIC8qKiBDb25mbGljdHMgb2JzZXJ2ZWQgYnkgcGxhbiBjeWNsZXMgKGluZm9ybWF0aW9uYWw7IHJlc29sdXRpb24gaXMgaW4gdGhlIGRhdGEpLiAqL1xuICBjb25mbGljdHM6IENvbmZsaWN0T3BbXTtcbn1cblxuY29uc3QgZGVmYXVsdExvZzogTG9nQWRhcHRlciA9IHtcbiAgZGVidWc6ICgpID0+IHt9LFxuICBpbmZvOiAoKSA9PiB7fSxcbiAgd2FybjogKCkgPT4ge30sXG4gIGVycm9yOiAoKSA9PiB7fSxcbn07XG5cbmNvbnN0IGRlZmF1bHRTY2hlZHVsZSA9IChmbjogKCkgPT4gdm9pZCwgbXM6IG51bWJlcik6ICgoKSA9PiB2b2lkKSA9PiB7XG4gIGNvbnN0IGhhbmRsZSA9IGdsb2JhbFRoaXMuc2V0VGltZW91dChmbiwgbXMpIGFzIHVua25vd24gYXMgbnVtYmVyO1xuICByZXR1cm4gKCkgPT4gZ2xvYmFsVGhpcy5jbGVhclRpbWVvdXQoaGFuZGxlKTtcbn07XG5cbi8qKiBBIGNvbW1pdCBwcmVwYXJlZCBmb3IgdGhlIHdpcmUgKGEgYFB1c2hPcGAgKyBpdHMgc3RhZ2VkIGNvbnRlbnQpLiAqL1xuaW50ZXJmYWNlIFN0YWdlZENvbW1pdCB7XG4gIGtpbmQ6IENvbW1pdE1lc3NhZ2VbJ2tpbmQnXTtcbiAgcGF0aDogc3RyaW5nO1xuICBwYXJlbnRWZXJzaW9uOiBzdHJpbmcgfCBudWxsO1xuICBoYXNoOiBzdHJpbmc7XG4gIHNpemU6IG51bWJlcjtcbiAgZnJvbVBhdGg/OiBzdHJpbmc7XG4gIGlzRm9sZGVyPzogYm9vbGVhbjtcbiAgYnl0ZXM/OiBVaW50OEFycmF5O1xuICAvKipcbiAgICogU3RvcmFnZSBtdGltZSBvYnNlcnZlZCBieSBUSElTIGN5Y2xlJ3Mgc2NhbiB3aGVuIGl0IGhhc2hlZCB0aGUgY29udGVudFxuICAgKiAoYEhhc2hlZEZpbGUubXRpbWVgIG9mIHRoZSBwdXNoIHNvdXJjZSkuIFBpbm5lZCBvbnRvIHRoZSBpbmRleCBlbnRyeSB3aGVuXG4gICAqIHRoZSBhY2sgbGFuZHMsIHNvIHRoZSBlbnRyeSdzIChoYXNoLCBzaXplLCBtdGltZSkgYWx3YXlzIGRlc2NyaWJlcyBPTkVcbiAgICogY29uc2lzdGVudCBpbnN0YW50IG9mIHRoZSBmaWxlIFx1MjAxNCBuZXZlciBhIGxhdGVyIHN0YXQgcGFpcmVkIHdpdGggdGhpc1xuICAgKiBoYXNoLiBUaGF0IG9yZGVyaW5nIGlzIHdoYXQgbGV0cyB0aGUgc2NhbiBmYXN0LXBhdGggKG10aW1lK3NpemUpIHNraXBcbiAgICogcmUtaGFzaGluZyBzYWZlbHk6IGFuIGVkaXQgbGFuZGluZyBiZXR3ZWVuIGhhc2ggYW5kIGFjayBjaGFuZ2VzIHRoZSBkaXNrXG4gICAqIHN0YXQsIG1pc3NlcyB0aGUgZmFzdCBwYXRoLCBhbmQgaXMgcmUtaGFzaGVkIGFuZCBwdXNoZWQgb24gdGhlIG5leHQgc2Nhbi5cbiAgICovXG4gIG10aW1lPzogbnVtYmVyO1xufVxuXG4vLyAtLS0gdGhlIGNsaWVudCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGNsYXNzIFN5bmNDbGllbnQge1xuICBwcml2YXRlIHJlYWRvbmx5IG9wdGlvbnM6IFN5bmNDbGllbnRPcHRpb25zO1xuICBwcml2YXRlIHJlYWRvbmx5IGxvZzogTG9nQWRhcHRlcjtcbiAgcHJpdmF0ZSByZWFkb25seSBub3c6ICgpID0+IG51bWJlcjtcbiAgcHJpdmF0ZSByZWFkb25seSBkZWJvdW5jZU1zOiBudW1iZXI7XG4gIHByaXZhdGUgcmVhZG9ubHkgc2NoZWR1bGU6IChmbjogKCkgPT4gdm9pZCwgbXM6IG51bWJlcikgPT4gKCkgPT4gdm9pZDtcbiAgcHJpdmF0ZSByZWFkb25seSBkaWFsVHJhbnNwb3J0OiAoKSA9PiBUcmFuc3BvcnQ7XG5cbiAgcHJpdmF0ZSB0cmFuc3BvcnQ6IFRyYW5zcG9ydCB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHN0YXRlOiBTeW5jQ2xpZW50U3RhdGUgPSAnaWRsZSc7XG4gIHByaXZhdGUgaW5kZXg6IExvY2FsSW5kZXggPSB7fTtcbiAgcHJpdmF0ZSBjdXJzb3IgPSAwO1xuICBwcml2YXRlIGxhc3RTeW5jQXQ6IG51bWJlciB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHBlbmRpbmcgPSAwO1xuICBwcml2YXRlIGNvbmZsaWN0czogQ29uZmxpY3RPcFtdID0gW107XG4gIHByaXZhdGUgaWdub3JlU2V0dGluZ3M6IElnbm9yZVNldHRpbmdzO1xuICBwcml2YXRlIHdhdGNoQWRhcHRlcjogV2F0Y2hBZGFwdGVyIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgY2FuY2VsRGVib3VuY2U6ICgoKSA9PiB2b2lkKSB8IG51bGwgPSBudWxsO1xuXG4gIC8qKiBTZXJpYWxpemVkIG9wZXJhdGlvbiBxdWV1ZSBcdTIwMTQgZXhhY3RseSBvbmUgYXN5bmMgb3AgcnVucyBhdCBhIHRpbWUuICovXG4gIHByaXZhdGUgdGFpbDogUHJvbWlzZTx1bmtub3duPiA9IFByb21pc2UucmVzb2x2ZSgpO1xuICBwcml2YXRlIHF1ZXVlZE9wcyA9IDA7XG4gIC8qKiBTdGFydHVwLXRpbWUgY2hhbmdlIGZsb29kIGlzIGJ1ZmZlcmVkOyB0aGUgZnVsbCBtYW5pZmVzdCBzdWJzdW1lcyBpdC4gKi9cbiAgcHJpdmF0ZSBidWZmZXJpbmcgPSBmYWxzZTtcbiAgcHJpdmF0ZSBidWZmZXJlZDogTWVzc2FnZVtdID0gW107XG4gIC8qKiBTaW5nbGUgb3V0c3RhbmRpbmcgcmVxdWVzdCBleHBlY3RhdGlvbiAob3BzIGFyZSBzZXJpYWxpemVkKS4gKi9cbiAgcHJpdmF0ZSBleHBlY3RhdGlvbjoge1xuICAgIG1hdGNoZXM6IChtZXNzYWdlOiBNZXNzYWdlKSA9PiBib29sZWFuO1xuICAgIHJlc29sdmU6IChtZXNzYWdlOiBNZXNzYWdlKSA9PiB2b2lkO1xuICAgIHJlamVjdDogKGVycm9yOiBFcnJvcikgPT4gdm9pZDtcbiAgfSB8IG51bGwgPSBudWxsO1xuXG4gIGNvbnN0cnVjdG9yKG9wdGlvbnM6IFN5bmNDbGllbnRPcHRpb25zKSB7XG4gICAgdGhpcy5vcHRpb25zID0gb3B0aW9ucztcbiAgICB0aGlzLmxvZyA9IG9wdGlvbnMubG9nID8/IGRlZmF1bHRMb2c7XG4gICAgdGhpcy5ub3cgPSBvcHRpb25zLm5vdyA/PyAoKCkgPT4gRGF0ZS5ub3coKSk7XG4gICAgdGhpcy5kZWJvdW5jZU1zID0gb3B0aW9ucy5kZWJvdW5jZU1zID8/IDMwMDtcbiAgICB0aGlzLnNjaGVkdWxlID0gb3B0aW9ucy5zY2hlZHVsZSA/PyBkZWZhdWx0U2NoZWR1bGU7XG4gICAgdGhpcy5kaWFsVHJhbnNwb3J0ID1cbiAgICAgIHR5cGVvZiBvcHRpb25zLnRyYW5zcG9ydCA9PT0gJ2Z1bmN0aW9uJ1xuICAgICAgICA/IG9wdGlvbnMudHJhbnNwb3J0XG4gICAgICAgIDogKCkgPT4gb3B0aW9ucy50cmFuc3BvcnQgYXMgVHJhbnNwb3J0O1xuICAgIHRoaXMuaWdub3JlU2V0dGluZ3MgPSBvcHRpb25zLnNldHRpbmdzID8/IHsgb2JzaWRpYW5TeW5jOiBmYWxzZSB9O1xuICB9XG5cbiAgLy8gLS0tIGxpZmVjeWNsZSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgLyoqIFJ1biBzdGFydHVwIHJlY29uY2lsaWF0aW9uIGFuZCBlbnRlciBsaXZlIG1vZGUuICovXG4gIGFzeW5jIGNvbm5lY3QoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5lbnF1ZXVlKCgpID0+IHRoaXMuc3RhcnR1cCgpKTtcbiAgfVxuXG4gIC8qKiBSZS1kaWFsIGFuZCByZS1ydW4gdGhlIGZ1bGwgc3RhcnR1cCByZWNvbmNpbGlhdGlvbi4gKi9cbiAgYXN5bmMgcmVjb25uZWN0KCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMuZW5xdWV1ZShhc3luYyAoKSA9PiB7XG4gICAgICB0aGlzLnRyYW5zcG9ydD8uY2xvc2UoKTtcbiAgICAgIHRoaXMudHJhbnNwb3J0ID0gbnVsbDtcbiAgICAgIGF3YWl0IHRoaXMuc3RhcnR1cCgpO1xuICAgIH0pO1xuICB9XG5cbiAgY2xvc2UoKTogdm9pZCB7XG4gICAgdGhpcy5zdG9wV2F0Y2hpbmcoKTtcbiAgICB0aGlzLmNhbmNlbERlYm91bmNlPy4oKTtcbiAgICB0aGlzLmNhbmNlbERlYm91bmNlID0gbnVsbDtcbiAgICB0aGlzLnRyYW5zcG9ydD8uY2xvc2UoKTtcbiAgICB0aGlzLnRyYW5zcG9ydCA9IG51bGw7XG4gICAgdGhpcy5zdGF0ZSA9ICdpZGxlJztcbiAgfVxuXG4gIC8qKiBCZWdpbiBkZWJvdW5jZWQgd2F0Y2hpbmcgKEFSQ0hJVEVDVFVSRSBcdTAwQTc4IGxpdmUgb3BlcmF0aW9uKS4gKi9cbiAgc3RhcnRXYXRjaGluZyh3YXRjaEFkYXB0ZXI6IFdhdGNoQWRhcHRlcik6IHZvaWQge1xuICAgIHRoaXMuc3RvcFdhdGNoaW5nKCk7XG4gICAgdGhpcy53YXRjaEFkYXB0ZXIgPSB3YXRjaEFkYXB0ZXI7XG4gICAgd2F0Y2hBZGFwdGVyLnN0YXJ0KChldmVudHMpID0+IHRoaXMub25XYXRjaEV2ZW50cyhldmVudHMpKTtcbiAgfVxuXG4gIHN0b3BXYXRjaGluZygpOiB2b2lkIHtcbiAgICB0aGlzLndhdGNoQWRhcHRlcj8uc3RvcCgpO1xuICAgIHRoaXMud2F0Y2hBZGFwdGVyID0gbnVsbDtcbiAgfVxuXG4gIC8qKiBNYW51YWwgb25lLXNob3QgY3ljbGUgKGB2c2FgIG9uZS1zaG90LCBcInN5bmMgbm93XCIgYnV0dG9ucywgdGVzdHMpLiAqL1xuICBhc3luYyB0cmlnZ2VyU3luYygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLmVucXVldWUoKCkgPT4gdGhpcy5ydW5DeWNsZSgpKTtcbiAgfVxuXG4gIC8qKiBSZXNvbHZlcyB3aGVuIGV2ZXJ5IHF1ZXVlZCBvcGVyYXRpb24gaGFzIHNldHRsZWQuICovXG4gIGFzeW5jIHdhaXRJZGxlKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHdoaWxlICh0aGlzLnF1ZXVlZE9wcyA+IDApIGF3YWl0IHRoaXMudGFpbDtcbiAgICBhd2FpdCB0aGlzLnRhaWw7XG4gIH1cblxuICBzdGF0dXMoKTogU3luY0NsaWVudFN0YXR1cyB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHN0YXRlOiB0aGlzLnN0YXRlLFxuICAgICAgbGFzdFN5bmNBdDogdGhpcy5sYXN0U3luY0F0LFxuICAgICAgcGVuZGluZzogdGhpcy5wZW5kaW5nLFxuICAgICAgY29uZmxpY3RzOiBbLi4udGhpcy5jb25mbGljdHNdLFxuICAgIH07XG4gIH1cblxuICAvKiogUmVhZC1vbmx5IHZpZXcgb2YgdGhlIGxvY2FsIGluZGV4ICh0ZXN0cywgYHZzYSBzdGF0dXNgKS4gKi9cbiAgY3VycmVudEluZGV4KCk6IExvY2FsSW5kZXgge1xuICAgIHJldHVybiB7IC4uLnRoaXMuaW5kZXggfTtcbiAgfVxuXG4gIC8qKiBMYXN0IHNlZW4gc2VydmVyIHNlcXVlbmNlIG51bWJlci4gKi9cbiAgZ2V0IGN1cnNvclZhbHVlKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMuY3Vyc29yO1xuICB9XG5cbiAgLyoqIFRTLXNhZmUgc3RhdGUgcHJvYmUgKGFzc2lnbm1lbnRzIGluc2lkZSBhc3luYyBmbG93cyBkZWZlYXQgbmFycm93aW5nKS4gKi9cbiAgcHJpdmF0ZSBpc0Rpc2Nvbm5lY3RlZCgpOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy5zdGF0ZSA9PT0gJ2Rpc2Nvbm5lY3RlZCc7XG4gIH1cblxuICAvLyAtLS0gc3RhcnR1cCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgcHJpdmF0ZSBhc3luYyBzdGFydHVwKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuc3RhdGUgPSAnY29ubmVjdGluZyc7XG4gICAgdGhpcy5idWZmZXJpbmcgPSB0cnVlO1xuICAgIHRoaXMuYnVmZmVyZWQgPSBbXTtcblxuICAgIHRoaXMuaW5kZXggPSAoYXdhaXQgdGhpcy5zYWZlU3RvcmFnZUV4aXN0cyhMT0NBTF9JTkRFWF9TVEFURV9QQVRIKSlcbiAgICAgID8gYXdhaXQgbG9hZExvY2FsSW5kZXgodGhpcy5vcHRpb25zLnN0b3JhZ2UpXG4gICAgICA6IHt9O1xuXG4gICAgY29uc3QgdHJhbnNwb3J0ID0gdGhpcy5kaWFsVHJhbnNwb3J0KCk7XG4gICAgdGhpcy50cmFuc3BvcnQgPSB0cmFuc3BvcnQ7XG4gICAgdHJhbnNwb3J0Lm9uTWVzc2FnZSgobWVzc2FnZSkgPT4gdGhpcy5vblRyYW5zcG9ydE1lc3NhZ2UobWVzc2FnZSkpO1xuICAgIHRyYW5zcG9ydC5vbkNsb3NlKChyZWFzb24pID0+IHRoaXMub25UcmFuc3BvcnRDbG9zZShyZWFzb24pKTtcblxuICAgIGNvbnN0IGhlbGxvQWNrID0gYXdhaXQgdGhpcy5yZXF1ZXN0PEhlbGxvQWNrTWVzc2FnZSB8IFNlcnZlckVycm9yTWVzc2FnZT4oXG4gICAgICAobSkgPT4gbS50eXBlID09PSAnaGVsbG9BY2snIHx8IG0udHlwZSA9PT0gJ2Vycm9yJyxcbiAgICAgICgpID0+XG4gICAgICAgIHRyYW5zcG9ydC5zZW5kKHtcbiAgICAgICAgICB0eXBlOiAnaGVsbG8nLFxuICAgICAgICAgIHRva2VuOiB0aGlzLm9wdGlvbnMudG9rZW4sXG4gICAgICAgICAgcHJvdG9jb2xWZXJzaW9uOiBQcm90b2NvbFZlcnNpb24sXG4gICAgICAgICAgY3Vyc29yOiB0aGlzLmN1cnNvcixcbiAgICAgICAgfSksXG4gICAgKTtcbiAgICBpZiAoaGVsbG9BY2sudHlwZSA9PT0gJ2Vycm9yJykgdGhyb3cgdGhpcy50b0Vycm9yKGhlbGxvQWNrKTtcbiAgICAvLyBUaGUgc2VydmVyJ3MgcGVyLXZhdWx0IGBvYnNpZGlhblN5bmNgIHN1cGVyc2VkZXMgdGhlIGxvY2FsIGluaXRpYWxcbiAgICAvLyB2YWx1ZSwgYnV0IGBleHRyYUlnbm9yZXNgIGlzIGEgY2xpZW50LXNpZGUgY29uY2VybiBcdTIwMTQgdGhlIHdvcmtlciBuZXZlclxuICAgIC8vIHNlbmRzIGl0LCBzbyB0aGUgbG9jYWxseSBjb25maWd1cmVkIHBhdHRlcm5zIHN1cnZpdmUgdGhlIGhhbmRzaGFrZS5cbiAgICB0aGlzLmlnbm9yZVNldHRpbmdzID0ge1xuICAgICAgb2JzaWRpYW5TeW5jOiBoZWxsb0Fjay5zZXR0aW5ncy5vYnNpZGlhblN5bmMsXG4gICAgICAuLi4odGhpcy5pZ25vcmVTZXR0aW5ncy5leHRyYUlnbm9yZXMgIT09IHVuZGVmaW5lZFxuICAgICAgICA/IHsgZXh0cmFJZ25vcmVzOiB0aGlzLmlnbm9yZVNldHRpbmdzLmV4dHJhSWdub3JlcyB9XG4gICAgICAgIDoge30pLFxuICAgIH07XG5cbiAgICB0aGlzLnN0YXRlID0gJ3N5bmNpbmcnO1xuICAgIGF3YWl0IHRoaXMucnVuQ3ljbGUoKTtcblxuICAgIHRoaXMuYnVmZmVyaW5nID0gZmFsc2U7XG4gICAgY29uc3QgYnVmZmVyZWQgPSB0aGlzLmJ1ZmZlcmVkO1xuICAgIHRoaXMuYnVmZmVyZWQgPSBbXTtcbiAgICBmb3IgKGNvbnN0IG1lc3NhZ2Ugb2YgYnVmZmVyZWQpIHtcbiAgICAgIGF3YWl0IHRoaXMuZGlzcGF0Y2gobWVzc2FnZSk7XG4gICAgfVxuICAgIGlmICghdGhpcy5pc0Rpc2Nvbm5lY3RlZCgpKSB0aGlzLnN0YXRlID0gJ2xpdmUnO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBzYWZlU3RvcmFnZUV4aXN0cyhwYXRoOiBzdHJpbmcpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMub3B0aW9ucy5zdG9yYWdlLmV4aXN0cyhwYXRoKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIG9uVHJhbnNwb3J0Q2xvc2UocmVhc29uOiB7IGNvZGU/OiBudW1iZXI7IHJlYXNvbj86IHN0cmluZyB9KTogdm9pZCB7XG4gICAgdGhpcy5sb2cud2FybigndHJhbnNwb3J0IGNsb3NlZCcsIHJlYXNvbik7XG4gICAgdGhpcy5zdGF0ZSA9ICdkaXNjb25uZWN0ZWQnO1xuICAgIGNvbnN0IGV4cGVjdGF0aW9uID0gdGhpcy5leHBlY3RhdGlvbjtcbiAgICBpZiAoZXhwZWN0YXRpb24gIT09IG51bGwpIHtcbiAgICAgIHRoaXMuZXhwZWN0YXRpb24gPSBudWxsO1xuICAgICAgZXhwZWN0YXRpb24ucmVqZWN0KFxuICAgICAgICBuZXcgTmV0d29ya0Vycm9yKGBjb25uZWN0aW9uIGNsb3NlZDogJHtyZWFzb24ucmVhc29uID8/IHJlYXNvbi5jb2RlID8/ICd1bmtub3duJ31gKSxcbiAgICAgICk7XG4gICAgfVxuICB9XG5cbiAgLy8gLS0tIG1lc3NhZ2UgcHVtcCAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgcHJpdmF0ZSBvblRyYW5zcG9ydE1lc3NhZ2UgPSAobWVzc2FnZTogTWVzc2FnZSk6IHZvaWQgPT4ge1xuICAgIGNvbnN0IGV4cGVjdGF0aW9uID0gdGhpcy5leHBlY3RhdGlvbjtcbiAgICBpZiAoZXhwZWN0YXRpb24gIT09IG51bGwgJiYgZXhwZWN0YXRpb24ubWF0Y2hlcyhtZXNzYWdlKSkge1xuICAgICAgdGhpcy5leHBlY3RhdGlvbiA9IG51bGw7XG4gICAgICBleHBlY3RhdGlvbi5yZXNvbHZlKG1lc3NhZ2UpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAodGhpcy5idWZmZXJpbmcpIHtcbiAgICAgIHRoaXMuYnVmZmVyZWQucHVzaChtZXNzYWdlKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5lbnF1ZXVlKGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuZGlzcGF0Y2gobWVzc2FnZSk7XG4gICAgfSkuY2F0Y2goKGVycm9yOiB1bmtub3duKSA9PiB0aGlzLmxvZy53YXJuKCdjaGFuZ2UgaGFuZGxlciBmYWlsZWQnLCBlcnJvcikpO1xuICB9O1xuXG4gIHByaXZhdGUgYXN5bmMgZGlzcGF0Y2gobWVzc2FnZTogTWVzc2FnZSk6IFByb21pc2U8dm9pZD4ge1xuICAgIHN3aXRjaCAobWVzc2FnZS50eXBlKSB7XG4gICAgICBjYXNlICdjaGFuZ2UnOlxuICAgICAgICBhd2FpdCB0aGlzLmhhbmRsZUNoYW5nZShtZXNzYWdlKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgY2FzZSAnZGV2aWNlU2Vlbic6XG4gICAgICAgIHJldHVybjsgLy8gcHJlc2VuY2Ugb25seTsgZGFzaGJvYXJkcyBjb25zdW1lIGl0XG4gICAgICBjYXNlICdwb25nJzpcbiAgICAgICAgcmV0dXJuO1xuICAgICAgY2FzZSAnZXJyb3InOlxuICAgICAgICB0aGlzLmxvZy5lcnJvcignc2VydmVyIGVycm9yJywgbWVzc2FnZS5jb2RlLCBtZXNzYWdlLm1lc3NhZ2UpO1xuICAgICAgICByZXR1cm47XG4gICAgICBjYXNlICdoZWxsb0Fjayc6XG4gICAgICBjYXNlICdtYW5pZmVzdCc6XG4gICAgICBjYXNlICdjb21taXRBY2snOlxuICAgICAgY2FzZSAnY29uZmxpY3QnOlxuICAgICAgY2FzZSAnYmxvYic6XG4gICAgICBjYXNlICdibG9iQWNrJzpcbiAgICAgICAgLy8gUmVwbGllcyBhcnJpdmUgb25seSBhZ2FpbnN0IGFuIG91dHN0YW5kaW5nIGV4cGVjdGF0aW9uOyBhXG4gICAgICAgIC8vIHNwb250YW5lb3VzIG9uZSBpcyBhIHByb3RvY29sIHZpb2xhdGlvbiB3ZSBsb2cgYW5kIGRyb3AuXG4gICAgICAgIHRoaXMubG9nLndhcm4oJ3VuZXhwZWN0ZWQgc2VydmVyIHJlcGx5JywgbWVzc2FnZS50eXBlKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgdGhpcy5sb2cud2FybignaWdub3JpbmcgY2xpZW50LXRvLXNlcnZlciBtZXNzYWdlIGZyb20gc2VydmVyJywgbWVzc2FnZSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBoYW5kbGVDaGFuZ2UoY2hhbmdlOiBDaGFuZ2VNZXNzYWdlKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKGNoYW5nZS5zZXEgPiB0aGlzLmN1cnNvcikgdGhpcy5jdXJzb3IgPSBjaGFuZ2Uuc2VxO1xuICAgIGlmIChpc0lnbm9yZWQoY2hhbmdlLnBhdGgsIHRoaXMuaWdub3JlU2V0dGluZ3MpKSByZXR1cm47XG4gICAgaWYgKGNoYW5nZS5mcm9tUGF0aCAhPT0gdW5kZWZpbmVkICYmIGlzSWdub3JlZChjaGFuZ2UuZnJvbVBhdGgsIHRoaXMuaWdub3JlU2V0dGluZ3MpKSByZXR1cm47XG5cbiAgICAvLyBTdGFsZSByZXBsYXkgLyBkdXBsaWNhdGUgZmFuLW91dDogcGVyIHBhdGggdGhlIGhlYWQgY2xvY2sgZG9taW5hdGVzXG4gICAgLy8gZXZlcnkgZWFybGllciB2ZXJzaW9uLCBzbyBhbnl0aGluZyBcdTIyNjQgdGhlIHJlY29yZGVkIGNsb2NrIGlzIG9sZCBuZXdzLlxuICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5pbmRleFtjaGFuZ2UucGF0aF07XG4gICAgaWYgKGVudHJ5ICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIGlmIChlbnRyeS52ZXJzaW9uSWQgPT09IGNoYW5nZS52ZXJzaW9uKSByZXR1cm47XG4gICAgICBpZiAoY29tcGFyZUNsb2NrcyhlbnRyeS5jbG9jaywgY2hhbmdlLmNsb2NrKSA+PSAwKSByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gVGhlIGd1YXJkOiBuZXZlciB3cml0ZSBhIHJlbW90ZSBjaGFuZ2Ugb3ZlciBsb2NhbGx5LWRpdmVyZ2VkIGNvbnRlbnQuXG4gICAgaWYgKCEoYXdhaXQgdGhpcy5jaGFuZ2VJc1NhZmUoY2hhbmdlKSkpIHtcbiAgICAgIHRoaXMubG9nLmluZm8oJ2RlZmVycmluZyByZW1vdGUgY2hhbmdlIG92ZXIgbG9jYWwgZGl2ZXJnZW5jZScsIGNoYW5nZS5wYXRoKTtcbiAgICAgIHRoaXMuc2NoZWR1bGVSZWNvbmNpbGUoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0aGlzLmluZGV4ID0gYXdhaXQgdGhpcy5hcHBseVB1bGxzKFt0aGlzLnB1bGxPcEZyb21DaGFuZ2UoY2hhbmdlKV0pO1xuICB9XG5cbiAgLyoqXG4gICAqIEEgY2hhbmdlIG1heSBiZSBhcHBsaWVkIGRpcmVjdGx5IG9ubHkgd2hlbiB0aGUgdG91Y2hlZCBwYXRocyBjYXJyeSBub1xuICAgKiB1bi1yZWNvbmNpbGVkIGxvY2FsIGNvbnRlbnQuIEFueXRoaW5nIGVsc2UgbXVzdCBkZXRvdXIgdGhyb3VnaCBhIGZ1bGxcbiAgICogYGNvbXB1dGVTeW5jUGxhbmAgY3ljbGUgKGNvbmZsaWN0IGxvZ2ljLCBjb25mbGljdCBjb3BpZXMpLlxuICAgKi9cbiAgcHJpdmF0ZSBhc3luYyBjaGFuZ2VJc1NhZmUoY2hhbmdlOiBDaGFuZ2VNZXNzYWdlKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgaWYgKGNoYW5nZS5pc0ZvbGRlciA9PT0gdHJ1ZSkgcmV0dXJuIHRydWU7XG4gICAgaWYgKGNoYW5nZS5raW5kID09PSAncmVuYW1lJyAmJiBjaGFuZ2UuZnJvbVBhdGggIT09IHVuZGVmaW5lZCkge1xuICAgICAgaWYgKGF3YWl0IHRoaXMucGF0aEhhc0xvY2FsRGl2ZXJnZW5jZShjaGFuZ2UuZnJvbVBhdGgpKSByZXR1cm4gZmFsc2U7XG4gICAgICBpZiAoYXdhaXQgdGhpcy5zdG9yYWdlRXhpc3RzKGNoYW5nZS5wYXRoKSkge1xuICAgICAgICBjb25zdCBlbnRyeSA9IHRoaXMuaW5kZXhbY2hhbmdlLnBhdGhdO1xuICAgICAgICBpZiAoZW50cnkgPT09IHVuZGVmaW5lZCB8fCBlbnRyeS5kZWxldGVkQXQgIT09IHVuZGVmaW5lZCkgcmV0dXJuIGZhbHNlO1xuICAgICAgICBjb25zdCBhY3R1YWwgPSBhd2FpdCBzaGEyNTZIZXgoYXdhaXQgdGhpcy5vcHRpb25zLnN0b3JhZ2UucmVhZEZpbGUoY2hhbmdlLnBhdGgpKTtcbiAgICAgICAgaWYgKGFjdHVhbCAhPT0gZW50cnkuaGFzaCkgcmV0dXJuIGZhbHNlO1xuICAgICAgfVxuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIHJldHVybiAhKGF3YWl0IHRoaXMucGF0aEhhc0xvY2FsRGl2ZXJnZW5jZShjaGFuZ2UucGF0aCkpO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBwYXRoSGFzTG9jYWxEaXZlcmdlbmNlKHBhdGg6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5pbmRleFtwYXRoXTtcbiAgICBpZiAoZW50cnk/LmlzRm9sZGVyKSByZXR1cm4gZmFsc2U7XG4gICAgaWYgKCEoYXdhaXQgdGhpcy5zdG9yYWdlRXhpc3RzKHBhdGgpKSkgcmV0dXJuIGZhbHNlO1xuICAgIGlmIChlbnRyeSA9PT0gdW5kZWZpbmVkIHx8IGVudHJ5LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkKSByZXR1cm4gdHJ1ZTtcbiAgICBjb25zdCBhY3R1YWwgPSBhd2FpdCBzaGEyNTZIZXgoYXdhaXQgdGhpcy5vcHRpb25zLnN0b3JhZ2UucmVhZEZpbGUocGF0aCkpO1xuICAgIHJldHVybiBhY3R1YWwgIT09IGVudHJ5Lmhhc2g7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHN0b3JhZ2VFeGlzdHMocGF0aDogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgdHJ5IHtcbiAgICAgIHJldHVybiBhd2FpdCB0aGlzLm9wdGlvbnMuc3RvcmFnZS5leGlzdHMocGF0aCk7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBwdWxsT3BGcm9tQ2hhbmdlKGNoYW5nZTogQ2hhbmdlTWVzc2FnZSk6IFB1bGxPcCB7XG4gICAgaWYgKGNoYW5nZS5raW5kID09PSAncmVuYW1lJyAmJiBjaGFuZ2UuZnJvbVBhdGggIT09IHVuZGVmaW5lZCkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAga2luZDogJ3JlbmFtZScsXG4gICAgICAgIGZyb21QYXRoOiBjaGFuZ2UuZnJvbVBhdGgsXG4gICAgICAgIHRvUGF0aDogY2hhbmdlLnBhdGgsXG4gICAgICAgIGhhc2g6IGNoYW5nZS5oYXNoLFxuICAgICAgICBzaXplOiBjaGFuZ2Uuc2l6ZSxcbiAgICAgICAgdmVyc2lvbjogY2hhbmdlLnZlcnNpb24sXG4gICAgICAgIGNsb2NrOiBjaGFuZ2UuY2xvY2ssXG4gICAgICB9O1xuICAgIH1cbiAgICBjb25zdCBlbnRyeSA9IHRoaXMuaW5kZXhbY2hhbmdlLnBhdGhdO1xuICAgIGNvbnN0IGtpbmQ6IFB1bGxGaWxlT3BbJ2tpbmQnXSA9IGNoYW5nZS5kZWxldGVkXG4gICAgICA/ICdkZWxldGUnXG4gICAgICA6IGVudHJ5ID09PSB1bmRlZmluZWRcbiAgICAgICAgPyAnYWRkJ1xuICAgICAgICA6IGVudHJ5LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkXG4gICAgICAgICAgPyAncmVzdG9yZSdcbiAgICAgICAgICA6ICdlZGl0JztcbiAgICByZXR1cm4ge1xuICAgICAga2luZCxcbiAgICAgIHBhdGg6IGNoYW5nZS5wYXRoLFxuICAgICAgaGFzaDogY2hhbmdlLmhhc2gsXG4gICAgICBzaXplOiBjaGFuZ2Uuc2l6ZSxcbiAgICAgIHZlcnNpb246IGNoYW5nZS52ZXJzaW9uLFxuICAgICAgY2xvY2s6IGNoYW5nZS5jbG9jayxcbiAgICAgIGRlbGV0ZWQ6IGNoYW5nZS5kZWxldGVkLFxuICAgICAgLi4uKGNoYW5nZS5pc0ZvbGRlciA9PT0gdHJ1ZSA/IHsgaXNGb2xkZXI6IHRydWUgfSA6IHt9KSxcbiAgICB9O1xuICB9XG5cbiAgLyoqIE1hdGVyaWFsaXplIHB1bGxzIHRocm91Z2ggdGhlIHZlcmlmaWVkIGVuZ2luZSBwYXRoOyByZXR1cm5zIHRoZSBuZXcgaW5kZXguICovXG4gIHByaXZhdGUgYXN5bmMgYXBwbHlQdWxscyhwdWxsczogUmVhZG9ubHlBcnJheTxQdWxsT3A+KTogUHJvbWlzZTxMb2NhbEluZGV4PiB7XG4gICAgcmV0dXJuIGFwcGx5UHVsbChcbiAgICAgIHRoaXMub3B0aW9ucy5zdG9yYWdlLFxuICAgICAgdGhpcy5pbmRleCxcbiAgICAgIHsgcHVzaGVzOiBbXSwgcHVsbHM6IFsuLi5wdWxsc10sIGNvbmZsaWN0czogW10sIGZvbGRlclB1c2hlczogW10gfSxcbiAgICAgIHRoaXMuZmV0Y2hCbG9iLFxuICAgICAgeyBub3c6IHRoaXMubm93KCkgfSxcbiAgICApO1xuICB9XG5cbiAgLy8gLS0tIHdhdGNoZXIgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgcHJpdmF0ZSBvbldhdGNoRXZlbnRzKGV2ZW50czogUmVhZG9ubHlBcnJheTx7IHBhdGg6IHN0cmluZyB9Pik6IHZvaWQge1xuICAgIGNvbnN0IHJlbGV2YW50ID0gZXZlbnRzLmZpbHRlcigoZXZlbnQpID0+ICFpc0lnbm9yZWQoZXZlbnQucGF0aCwgdGhpcy5pZ25vcmVTZXR0aW5ncykpO1xuICAgIGlmIChyZWxldmFudC5sZW5ndGggPT09IDApIHJldHVybjtcbiAgICB0aGlzLnBlbmRpbmcgKz0gcmVsZXZhbnQubGVuZ3RoO1xuICAgIHRoaXMuc2NoZWR1bGVSZWNvbmNpbGUoKTtcbiAgfVxuXG4gIC8qKiBEZWJvdW5jZWQgc2Nhblx1MjE5MnBsYW5cdTIxOTJleGVjdXRlIChzaGFyZWQgYnkgd2F0Y2hlciBhbmQgZGVmZXJyZWQgY2hhbmdlcykuICovXG4gIHByaXZhdGUgc2NoZWR1bGVSZWNvbmNpbGUoKTogdm9pZCB7XG4gICAgdGhpcy5jYW5jZWxEZWJvdW5jZT8uKCk7XG4gICAgdGhpcy5jYW5jZWxEZWJvdW5jZSA9IHRoaXMuc2NoZWR1bGUoKCkgPT4ge1xuICAgICAgdGhpcy5jYW5jZWxEZWJvdW5jZSA9IG51bGw7XG4gICAgICB0aGlzLmVucXVldWUoKCkgPT4gdGhpcy5ydW5DeWNsZSgpKS5jYXRjaCgoZXJyb3I6IHVua25vd24pID0+XG4gICAgICAgIHRoaXMubG9nLndhcm4oJ2RlYm91bmNlZCBzeW5jIGN5Y2xlIGZhaWxlZCcsIGVycm9yKSxcbiAgICAgICk7XG4gICAgfSwgdGhpcy5kZWJvdW5jZU1zKTtcbiAgfVxuXG4gIC8vIC0tLSB0aGUgc3luYyBjeWNsZSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIHByaXZhdGUgYXN5bmMgcnVuQ3ljbGUoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKHRoaXMudHJhbnNwb3J0ID09PSBudWxsIHx8IHRoaXMuaXNEaXNjb25uZWN0ZWQoKSkgcmV0dXJuO1xuICAgIHRoaXMuc3RhdGUgPSAnc3luY2luZyc7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IG1hbmlmZXN0ID0gYXdhaXQgdGhpcy5mZXRjaE1hbmlmZXN0KCk7XG4gICAgICBjb25zdCBsb2NhbENoYW5nZXMgPSBhd2FpdCBzY2FuVmF1bHQoXG4gICAgICAgIHRoaXMub3B0aW9ucy5zdG9yYWdlLFxuICAgICAgICB0aGlzLmluZGV4LFxuICAgICAgICB0aGlzLmlnbm9yZVNldHRpbmdzLFxuICAgICAgICB0aGlzLm5vdygpLFxuICAgICAgKTtcbiAgICAgIGNvbnN0IHBsYW4gPSBjb21wdXRlU3luY1BsYW4oe1xuICAgICAgICBsb2NhbENoYW5nZXMsXG4gICAgICAgIGluZGV4OiB0aGlzLmluZGV4LFxuICAgICAgICBtYW5pZmVzdCxcbiAgICAgICAgdGhpc0RldmljZUlkOiB0aGlzLm9wdGlvbnMuZGV2aWNlSWQsXG4gICAgICAgIHRoaXNEZXZpY2VOYW1lOiB0aGlzLm9wdGlvbnMuZGV2aWNlTmFtZSxcbiAgICAgICAgbm93OiB0aGlzLm5vdygpLFxuICAgICAgfSk7XG4gICAgICB0aGlzLmNvbmZsaWN0cyA9IFsuLi50aGlzLmNvbmZsaWN0cywgLi4ucGxhbi5jb25mbGljdHNdO1xuXG4gICAgICAvLyBTdGFnZSBwdXNoIGNvbnRlbnRzIEJFRk9SRSBwdWxscyBvdmVyd3JpdGUgdGhlIHdvcmtpbmcgdHJlZSAoYVxuICAgICAgLy8gY29uZmxpY3QtY29weSBwdXNoIHJlYWRzIHRoZSBsb3NlciBjb250ZW50IGZyb20gdGhlIG9yaWdpbmFsIHBhdGgpLlxuICAgICAgY29uc3Qgc3RhZ2VkID0gYXdhaXQgdGhpcy5zdGFnZVB1c2hlcyhwbGFuLCBsb2NhbENoYW5nZXMuaGFzaGVkKTtcblxuICAgICAgdGhpcy5pbmRleCA9IGF3YWl0IHRoaXMuYXBwbHlQdWxscyhwbGFuLnB1bGxzKTtcblxuICAgICAgZm9yIChjb25zdCBjb21taXQgb2Ygc3RhZ2VkKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuc2VuZENvbW1pdChjb21taXQpO1xuICAgICAgfVxuICAgICAgZm9yIChjb25zdCBwYXRoIG9mIHBsYW4uZm9sZGVyUHVzaGVzKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuc2VuZENvbW1pdCh7XG4gICAgICAgICAga2luZDogJ2VkaXQnLFxuICAgICAgICAgIHBhdGgsXG4gICAgICAgICAgcGFyZW50VmVyc2lvbjogdGhpcy5pbmRleFtwYXRoXT8udmVyc2lvbklkID8/IG51bGwsXG4gICAgICAgICAgaGFzaDogJycsXG4gICAgICAgICAgc2l6ZTogMCxcbiAgICAgICAgICBpc0ZvbGRlcjogdHJ1ZSxcbiAgICAgICAgfSk7XG4gICAgICB9XG5cbiAgICAgIC8vIENhY2hlIHRoZSBzY2FuJ3MgaGFzaCBvYnNlcnZhdGlvbnMgKG10aW1lKSBvbnRvIGVudHJpZXMgd2hvc2UgaGFzaFxuICAgICAgLy8gc3RpbGwgbWF0Y2hlcywgc28gdGhlIG5leHQgZmFzdCBzY2FuIGNhbiBza2lwIHRob3NlIGZpbGVzLiBSdW5zXG4gICAgICAvLyBhZnRlciBwdWxscy9wdXNoZXMgc28gZnJlc2hseS1hY2tlZCBlbnRyaWVzIGJlbmVmaXQgaW1tZWRpYXRlbHk7XG4gICAgICAvLyBgcmVjb3JkSGFzaGVkRmlsZXNgIHNraXBzIGFueXRoaW5nIHRoZSBjeWNsZSBjaGFuZ2VkIHVuZGVybmVhdGggdXMuXG4gICAgICB0aGlzLmluZGV4ID0gcmVjb3JkSGFzaGVkRmlsZXModGhpcy5pbmRleCwgbG9jYWxDaGFuZ2VzLmhhc2hlZCk7XG5cbiAgICAgIHRoaXMubGFzdFN5bmNBdCA9IHRoaXMubm93KCk7XG4gICAgICB0aGlzLnBlbmRpbmcgPSAwO1xuICAgICAgaWYgKCF0aGlzLmlzRGlzY29ubmVjdGVkKCkpIHRoaXMuc3RhdGUgPSAnbGl2ZSc7XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMubG9nLmVycm9yKCdzeW5jIGN5Y2xlIGZhaWxlZCcsIGVycm9yKTtcbiAgICAgIGlmICghdGhpcy5pc0Rpc2Nvbm5lY3RlZCgpKSB0aGlzLnN0YXRlID0gdGhpcy50cmFuc3BvcnQgIT09IG51bGwgPyAnbGl2ZScgOiAnaWRsZSc7XG4gICAgICB0aHJvdyBlcnJvcjtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGZldGNoTWFuaWZlc3QoKTogUHJvbWlzZTxSZW1vdGVGaWxlW10+IHtcbiAgICBjb25zdCB0cmFuc3BvcnQgPSB0aGlzLnRyYW5zcG9ydDtcbiAgICBpZiAodHJhbnNwb3J0ID09PSBudWxsKSB0aHJvdyBuZXcgTmV0d29ya0Vycm9yKCdub3QgY29ubmVjdGVkJyk7XG4gICAgY29uc3QgcmVwbHkgPSBhd2FpdCB0aGlzLnJlcXVlc3Q8TWFuaWZlc3RNZXNzYWdlIHwgU2VydmVyRXJyb3JNZXNzYWdlPihcbiAgICAgIChtKSA9PiBtLnR5cGUgPT09ICdtYW5pZmVzdCcgfHwgbS50eXBlID09PSAnZXJyb3InLFxuICAgICAgKCkgPT4gdHJhbnNwb3J0LnNlbmQoeyB0eXBlOiAnZ2V0TWFuaWZlc3QnIH0pLFxuICAgICk7XG4gICAgaWYgKHJlcGx5LnR5cGUgPT09ICdlcnJvcicpIHRocm93IHRoaXMudG9FcnJvcihyZXBseSk7XG4gICAgaWYgKHJlcGx5LmN1cnNvciA+IHRoaXMuY3Vyc29yKSB0aGlzLmN1cnNvciA9IHJlcGx5LmN1cnNvcjtcbiAgICByZXR1cm4gT2JqZWN0LnZhbHVlcyhyZXBseS5lbnRyaWVzKS5tYXAoKGVudHJ5KSA9PiAoeyAuLi5lbnRyeSB9KSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHN0YWdlUHVzaGVzKFxuICAgIHBsYW46IFN5bmNQbGFuLFxuICAgIGhhc2hlZDogcmVhZG9ubHkgSGFzaGVkRmlsZVtdLFxuICApOiBQcm9taXNlPFN0YWdlZENvbW1pdFtdPiB7XG4gICAgLy8gQSBjb25mbGljdC1jb3B5IHB1c2ggY2FycmllcyBjb250ZW50IHJlYWQgZnJvbSB0aGUgKm9yaWdpbmFsKiBwYXRoLlxuICAgIGNvbnN0IGNvcHlTb3VyY2VzID0gbmV3IE1hcDxzdHJpbmcsIHN0cmluZz4oKTtcbiAgICBmb3IgKGNvbnN0IGNvbmZsaWN0IG9mIHBsYW4uY29uZmxpY3RzKSB7XG4gICAgICBpZiAoY29uZmxpY3QuY29uZmxpY3RDb3B5UGF0aCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIGNvcHlTb3VyY2VzLnNldChjb25mbGljdC5jb25mbGljdENvcHlQYXRoLCBjb25mbGljdC5wYXRoKTtcbiAgICAgIH1cbiAgICB9XG4gICAgLy8gSGFzaC10aW1lIHN0YXRzIGJ5IHBhdGg6IHBpbm5pbmcgdGhlc2Ugb250byB0aGUgYWNrZWQgZW50cmllcyAoYmVsb3cpXG4gICAgLy8ga2VlcHMgdGhlIGZhc3QtcGF0aCBjYWNoZSBob25lc3QgXHUyMDE0IHNlZSBgU3RhZ2VkQ29tbWl0Lm10aW1lYC5cbiAgICBjb25zdCBoYXNoVGltZU10aW1lID0gbmV3IE1hcChoYXNoZWQubWFwKChvYnNlcnZlZCkgPT4gW29ic2VydmVkLnBhdGgsIG9ic2VydmVkLm10aW1lXSkpO1xuXG4gICAgY29uc3Qgc3RhZ2VkOiBTdGFnZWRDb21taXRbXSA9IFtdO1xuICAgIGZvciAoY29uc3QgcHVzaCBvZiBwbGFuLnB1c2hlcykge1xuICAgICAgaWYgKHB1c2gua2luZCA9PT0gJ2RlbGV0ZScgfHwgcHVzaC5raW5kID09PSAncmVuYW1lJykge1xuICAgICAgICBzdGFnZWQucHVzaCh0aGlzLnRvU3RhZ2VkKHB1c2gpKTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjb25zdCBzb3VyY2VQYXRoID1cbiAgICAgICAgcHVzaC5raW5kID09PSAnY29uZmxpY3RDb3B5JyA/IGNvcHlTb3VyY2VzLmdldChwdXNoLnBhdGgpID8/IHB1c2gucGF0aCA6IHB1c2gucGF0aDtcbiAgICAgIGNvbnN0IGJ5dGVzID0gYXdhaXQgdGhpcy5yZWFkTG9jYWwoc291cmNlUGF0aCk7XG4gICAgICBpZiAoYnl0ZXMgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICB0aGlzLmxvZy53YXJuKCdwdXNoIHNvdXJjZSB2YW5pc2hlZCBzaW5jZSBzY2FuOyBkZWZlcnJpbmcnLCBwdXNoLnBhdGgpO1xuICAgICAgICB0aGlzLnNjaGVkdWxlUmVjb25jaWxlKCk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgY29uc3QgaGFzaCA9IGF3YWl0IHNoYTI1NkhleChieXRlcyk7XG4gICAgICBpZiAoaGFzaCAhPT0gcHVzaC5oYXNoIHx8IGJ5dGVzLmJ5dGVMZW5ndGggIT09IHB1c2guc2l6ZSkge1xuICAgICAgICB0aGlzLmxvZy53YXJuKCdsb2NhbCBjb250ZW50IGRyaWZ0ZWQgc2luY2Ugc2NhbjsgZGVmZXJyaW5nIHB1c2gnLCBwdXNoLnBhdGgpO1xuICAgICAgICB0aGlzLnNjaGVkdWxlUmVjb25jaWxlKCk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKHB1c2gua2luZCA9PT0gJ2NvbmZsaWN0Q29weScpIHtcbiAgICAgICAgLy8gTWF0ZXJpYWxpemUgdGhlIGNvcHkgbG9jYWxseSBOT1csIGJlZm9yZSB0aGUgcHVsbHMgb3ZlcndyaXRlIHRoZVxuICAgICAgICAvLyBvcmlnaW5hbDogdGhlIHNlcnZlciBicm9hZGNhc3RzIHRoZSBjb3B5IHRvICpvdGhlciogY2xpZW50cyBvbmx5LFxuICAgICAgICAvLyBzbyB0aGlzIGRldmljZSBtdXN0IHdyaXRlIGl0cyBvd24gY29weSBpdHNlbGYuIFRoZSBjb3B5IGxhbmRzIGF0IGFcbiAgICAgICAgLy8gTkVXIHBhdGggd2hvc2Ugb24tZGlzayBzdGF0IGRpZmZlcnMgZnJvbSB0aGUgc291cmNlJ3MgXHUyMDE0IG5vIGhhc2gtdGltZVxuICAgICAgICAvLyBzdGF0IHRvIHBpbiwgdGhlIG5leHQgc2NhbiByZWNvcmRzIG9uZS5cbiAgICAgICAgYXdhaXQgdGhpcy5vcHRpb25zLnN0b3JhZ2Uud3JpdGVGaWxlKHB1c2gucGF0aCwgYnl0ZXMpO1xuICAgICAgICBzdGFnZWQucHVzaCh7IC4uLnRoaXMudG9TdGFnZWQocHVzaCksIGJ5dGVzIH0pO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIHN0YWdlZC5wdXNoKHtcbiAgICAgICAgLi4udGhpcy50b1N0YWdlZChwdXNoKSxcbiAgICAgICAgYnl0ZXMsXG4gICAgICAgIC4uLihoYXNoVGltZU10aW1lLmdldChzb3VyY2VQYXRoKSAhPT0gdW5kZWZpbmVkXG4gICAgICAgICAgPyB7IG10aW1lOiBoYXNoVGltZU10aW1lLmdldChzb3VyY2VQYXRoKSB9XG4gICAgICAgICAgOiB7fSksXG4gICAgICB9KTtcbiAgICB9XG4gICAgcmV0dXJuIHN0YWdlZDtcbiAgfVxuXG4gIHByaXZhdGUgdG9TdGFnZWQocHVzaDogUHVzaE9wKTogU3RhZ2VkQ29tbWl0IHtcbiAgICBpZiAocHVzaC5raW5kID09PSAncmVuYW1lJykge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAga2luZDogJ3JlbmFtZScsXG4gICAgICAgIHBhdGg6IHB1c2gudG9QYXRoLFxuICAgICAgICBwYXJlbnRWZXJzaW9uOiBwdXNoLnBhcmVudFZlcnNpb24sXG4gICAgICAgIGhhc2g6IHB1c2guaGFzaCxcbiAgICAgICAgc2l6ZTogcHVzaC5zaXplLFxuICAgICAgICBmcm9tUGF0aDogcHVzaC5mcm9tUGF0aCxcbiAgICAgIH07XG4gICAgfVxuICAgIHJldHVybiB7XG4gICAgICBraW5kOiBwdXNoLmtpbmQgPT09ICdhZGQnID8gJ2VkaXQnIDogcHVzaC5raW5kLFxuICAgICAgcGF0aDogcHVzaC5wYXRoLFxuICAgICAgcGFyZW50VmVyc2lvbjogcHVzaC5wYXJlbnRWZXJzaW9uLFxuICAgICAgaGFzaDogcHVzaC5oYXNoLFxuICAgICAgc2l6ZTogcHVzaC5zaXplLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlYWRMb2NhbChwYXRoOiBzdHJpbmcpOiBQcm9taXNlPFVpbnQ4QXJyYXkgfCB1bmRlZmluZWQ+IHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMub3B0aW9ucy5zdG9yYWdlLnJlYWRGaWxlKHBhdGgpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHNlbmRDb21taXQoY29tbWl0OiBTdGFnZWRDb21taXQpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCB0cmFuc3BvcnQgPSB0aGlzLnRyYW5zcG9ydDtcbiAgICBpZiAodHJhbnNwb3J0ID09PSBudWxsKSB0aHJvdyBuZXcgTmV0d29ya0Vycm9yKCdub3QgY29ubmVjdGVkJyk7XG5cbiAgICBjb25zdCBtZXNzYWdlOiBDb21taXRNZXNzYWdlID0ge1xuICAgICAgdHlwZTogJ2NvbW1pdCcsXG4gICAgICBwYXRoOiBjb21taXQucGF0aCxcbiAgICAgIHBhcmVudFZlcnNpb246IGNvbW1pdC5wYXJlbnRWZXJzaW9uLFxuICAgICAgaGFzaDogY29tbWl0Lmhhc2gsXG4gICAgICBzaXplOiBjb21taXQuc2l6ZSxcbiAgICAgIGtpbmQ6IGNvbW1pdC5raW5kLFxuICAgICAgLi4uKGNvbW1pdC5mcm9tUGF0aCAhPT0gdW5kZWZpbmVkID8geyBmcm9tUGF0aDogY29tbWl0LmZyb21QYXRoIH0gOiB7fSksXG4gICAgICAuLi4oY29tbWl0LmlzRm9sZGVyID09PSB0cnVlID8geyBpc0ZvbGRlcjogdHJ1ZSB9IDoge30pLFxuICAgICAgLi4uKGNvbW1pdC5ieXRlcyAhPT0gdW5kZWZpbmVkICYmIGNvbW1pdC5ieXRlcy5ieXRlTGVuZ3RoIDw9IElOTElORV9DT05URU5UX01BWF9CWVRFU1xuICAgICAgICA/IHsgaW5saW5lOiBieXRlc1RvQmFzZTY0KGNvbW1pdC5ieXRlcykgfVxuICAgICAgICA6IHt9KSxcbiAgICB9O1xuXG4gICAgLy8gQXR0YWNobWVudHMgYWJvdmUgdGhlIGlubGluZSBjYXAgcmlkZSB0aGUgYmxvYiBzdG9yZSAoRlItOCkuXG4gICAgaWYgKGNvbW1pdC5ieXRlcyAhPT0gdW5kZWZpbmVkICYmIGNvbW1pdC5ieXRlcy5ieXRlTGVuZ3RoID4gSU5MSU5FX0NPTlRFTlRfTUFYX0JZVEVTKSB7XG4gICAgICBhd2FpdCB0aGlzLnVwbG9hZEJsb2IoY29tbWl0Lmhhc2gsIGNvbW1pdC5ieXRlcyk7XG4gICAgfVxuXG4gICAgY29uc3QgcmVwbHkgPSBhd2FpdCB0aGlzLnJlcXVlc3Q8Q29tbWl0QWNrTWVzc2FnZSB8IENvbmZsaWN0TWVzc2FnZSB8IFNlcnZlckVycm9yTWVzc2FnZT4oXG4gICAgICAobSkgPT4gbS50eXBlID09PSAnY29tbWl0QWNrJyB8fCBtLnR5cGUgPT09ICdjb25mbGljdCcgfHwgbS50eXBlID09PSAnZXJyb3InLFxuICAgICAgKCkgPT4gdHJhbnNwb3J0LnNlbmQobWVzc2FnZSksXG4gICAgKTtcbiAgICBpZiAocmVwbHkudHlwZSA9PT0gJ2Vycm9yJykgdGhyb3cgdGhpcy50b0Vycm9yKHJlcGx5KTtcblxuICAgIGlmIChyZXBseS50eXBlID09PSAnY29tbWl0QWNrJykge1xuICAgICAgaWYgKHJlcGx5LnNlcSA+IHRoaXMuY3Vyc29yKSB0aGlzLmN1cnNvciA9IHJlcGx5LnNlcTtcbiAgICAgIHRoaXMuYXBwbHlBY2tUb0luZGV4KGNvbW1pdCwgcmVwbHkudmVyc2lvbiwgcmVwbHkuY2xvY2spO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBhd2FpdCB0aGlzLmhhbmRsZUNvbmZsaWN0UmVwbHkoY29tbWl0LCByZXBseSk7XG4gIH1cblxuICBwcml2YXRlIGFwcGx5QWNrVG9JbmRleChjb21taXQ6IFN0YWdlZENvbW1pdCwgdmVyc2lvbklkOiBzdHJpbmcsIGNsb2NrOiBMb2dpY2FsQ2xvY2spOiB2b2lkIHtcbiAgICBjb25zdCBkZWxldGVkID0gY29tbWl0LmtpbmQgPT09ICdkZWxldGUnO1xuICAgIGlmIChjb21taXQua2luZCA9PT0gJ3JlbmFtZScgJiYgY29tbWl0LmZyb21QYXRoICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMuaW5kZXggPSBhcHBseUNvbW1pdChyZW1vdmVFbnRyeSh0aGlzLmluZGV4LCBjb21taXQuZnJvbVBhdGgpLCB7XG4gICAgICAgIHBhdGg6IGNvbW1pdC5wYXRoLFxuICAgICAgICB2ZXJzaW9uSWQsXG4gICAgICAgIGhhc2g6IGNvbW1pdC5oYXNoLFxuICAgICAgICBzaXplOiBjb21taXQuc2l6ZSxcbiAgICAgICAgY2xvY2ssXG4gICAgICB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgLy8gYGNvbW1pdC5tdGltZWAgaXMgdGhlIHN0YXQgb2JzZXJ2ZWQgYXQgSEFTSCB0aW1lIGZvciB0aGlzIGV4YWN0IGNvbnRlbnRcbiAgICAvLyAodGhyZWFkZWQgdGhyb3VnaCBgc3RhZ2VQdXNoZXNgKSwgbmV2ZXIgYSBzdGF0IHRha2VuIGF0IGFjayB0aW1lIFx1MjAxNCBhblxuICAgIC8vIGVkaXQgdGhhdCBsYW5kZWQgYmV0d2VlbiBoYXNoaW5nIGFuZCB0aGlzIGFjayBjaGFuZ2VkIHRoZSBkaXNrIHN0YXQsIHNvXG4gICAgLy8gdGhlIG5leHQgc2NhbiBtaXNzZXMgdGhlIGZhc3QgcGF0aCBhbmQgcmUtaGFzaGVzL3B1c2hlcyB0aGUgZWRpdC5cbiAgICB0aGlzLmluZGV4ID0gYXBwbHlDb21taXQodGhpcy5pbmRleCwge1xuICAgICAgcGF0aDogY29tbWl0LnBhdGgsXG4gICAgICB2ZXJzaW9uSWQsXG4gICAgICBoYXNoOiBjb21taXQuaGFzaCxcbiAgICAgIHNpemU6IGNvbW1pdC5zaXplLFxuICAgICAgY2xvY2ssXG4gICAgICBkZWxldGVkLFxuICAgICAgZGVsZXRlZEF0OiBkZWxldGVkID8gdGhpcy5ub3coKSA6IHVuZGVmaW5lZCxcbiAgICAgIC4uLihjb21taXQuaXNGb2xkZXIgPT09IHRydWUgPyB7IGlzRm9sZGVyOiB0cnVlIH0gOiB7fSksXG4gICAgICAuLi4oY29tbWl0Lm10aW1lICE9PSB1bmRlZmluZWQgPyB7IG10aW1lOiBjb21taXQubXRpbWUgfSA6IHt9KSxcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgaGFuZGxlQ29uZmxpY3RSZXBseShcbiAgICBjb21taXQ6IFN0YWdlZENvbW1pdCxcbiAgICByZXBseTogQ29uZmxpY3RNZXNzYWdlLFxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAocmVwbHkuc2VxICE9PSB1bmRlZmluZWQgJiYgcmVwbHkuc2VxID4gdGhpcy5jdXJzb3IpIHRoaXMuY3Vyc29yID0gcmVwbHkuc2VxO1xuICAgIGNvbnN0IHdlV29uID1cbiAgICAgIHJlcGx5Lndpbm5lci5kZXZpY2VJZCA9PT0gdGhpcy5vcHRpb25zLmRldmljZUlkICYmIHJlcGx5Lndpbm5lci5oYXNoID09PSBjb21taXQuaGFzaDtcbiAgICBpZiAod2VXb24pIHtcbiAgICAgIHRoaXMuYXBwbHlBY2tUb0luZGV4KGNvbW1pdCwgcmVwbHkud2lubmVyLmlkLCByZXBseS53aW5uZXIuY2xvY2spO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIC8vIFdlIGxvc3QgdGhlIHJhY2UuIE1hdGVyaWFsaXplIHRoZSB3aW5uZXIgZGlyZWN0bHkgXHUyMDE0IHRoZSBzZXJ2ZXIgaGFzXG4gICAgLy8gYWxyZWFkeSBwcmVzZXJ2ZWQgb3VyIGNvbnRlbnQgYXMgYSBjb25mbGljdCBjb3B5IChpZiBpdCB3YXMgZGlzdGluY3QpLlxuICAgIC8vIE9uZSBjYXZlYXQ6IGlmIHRoZSB3b3JraW5nIHRyZWUgbW92ZWQgb24gQUdBSU4gc2luY2Ugd2Ugc3RhZ2VkIHRoaXNcbiAgICAvLyBjb21taXQsIGRvIG5vdCBjbG9iYmVyIGl0IGVpdGhlciBcdTIwMTQgaGFuZCB0aGUgd2hvbGUgdGhpbmcgdG8gYSBjeWNsZS5cbiAgICBpZiAoY29tbWl0LmtpbmQgIT09ICdkZWxldGUnICYmIGNvbW1pdC5raW5kICE9PSAncmVuYW1lJyAmJiBjb21taXQuaXNGb2xkZXIgIT09IHRydWUpIHtcbiAgICAgIGNvbnN0IGxvY2FsID0gYXdhaXQgdGhpcy5yZWFkTG9jYWwoY29tbWl0LnBhdGgpO1xuICAgICAgaWYgKGxvY2FsICE9PSB1bmRlZmluZWQgJiYgKGF3YWl0IHNoYTI1NkhleChsb2NhbCkpICE9PSBjb21taXQuaGFzaCkge1xuICAgICAgICB0aGlzLnNjaGVkdWxlUmVjb25jaWxlKCk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoY29tbWl0LmtpbmQgPT09ICdyZW5hbWUnICYmIGNvbW1pdC5mcm9tUGF0aCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICAvLyBPdXIgcmVuYW1lIGxvc3Q6IHRoZSBmaWxlIHN0YXlzIHdoZXJlIHRoZSB3aW5uZXIga2VlcHMgaXQ7IHJlY29yZFxuICAgICAgLy8gdGhlIHdpbm5lciBoZWFkIGZvciB0aGUgZGVzdGluYXRpb24gKHRoZSBzb3VyY2UgcGF0aCBpcyB1bnRvdWNoZWQpLlxuICAgICAgdGhpcy5pbmRleCA9IGFwcGx5Q29tbWl0KHRoaXMuaW5kZXgsIHtcbiAgICAgICAgcGF0aDogcmVwbHkud2lubmVyLnBhdGgsXG4gICAgICAgIHZlcnNpb25JZDogcmVwbHkud2lubmVyLmlkLFxuICAgICAgICBoYXNoOiByZXBseS53aW5uZXIuaGFzaCxcbiAgICAgICAgc2l6ZTogcmVwbHkud2lubmVyLnNpemUsXG4gICAgICAgIGNsb2NrOiByZXBseS53aW5uZXIuY2xvY2ssXG4gICAgICB9KTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0aGlzLmluZGV4ID0gYXdhaXQgdGhpcy5hcHBseVB1bGxzKFt0aGlzLndpbm5lckFzUHVsbChyZXBseS53aW5uZXIpXSk7XG4gIH1cblxuICAvKiogVHVybiBhbiBhcmJpdHJhdGVkIHdpbm5lciB2ZXJzaW9uIGludG8gYSBwdWxsIG9wIChjb250ZW50IG9wcyBvbmx5KS4gKi9cbiAgcHJpdmF0ZSB3aW5uZXJBc1B1bGwod2lubmVyOiB7XG4gICAgcGF0aDogc3RyaW5nO1xuICAgIGlkOiBzdHJpbmc7XG4gICAgaGFzaDogc3RyaW5nO1xuICAgIHNpemU6IG51bWJlcjtcbiAgICBkZXZpY2VJZDogc3RyaW5nO1xuICAgIGNsb2NrOiBMb2dpY2FsQ2xvY2s7XG4gICAga2luZDogQ29tbWl0TWVzc2FnZVsna2luZCddO1xuICB9KTogUHVsbE9wIHtcbiAgICBjb25zdCBlbnRyeSA9IHRoaXMuaW5kZXhbd2lubmVyLnBhdGhdO1xuICAgIGNvbnN0IGRlbGV0ZWQgPSB3aW5uZXIua2luZCA9PT0gJ2RlbGV0ZSc7XG4gICAgY29uc3Qga2luZDogUHVsbEZpbGVPcFsna2luZCddID0gZGVsZXRlZFxuICAgICAgPyAnZGVsZXRlJ1xuICAgICAgOiBlbnRyeSA9PT0gdW5kZWZpbmVkXG4gICAgICAgID8gJ2FkZCdcbiAgICAgICAgOiBlbnRyeS5kZWxldGVkQXQgIT09IHVuZGVmaW5lZFxuICAgICAgICAgID8gJ3Jlc3RvcmUnXG4gICAgICAgICAgOiAnZWRpdCc7XG4gICAgcmV0dXJuIHtcbiAgICAgIGtpbmQsXG4gICAgICBwYXRoOiB3aW5uZXIucGF0aCxcbiAgICAgIGhhc2g6IHdpbm5lci5oYXNoLFxuICAgICAgc2l6ZTogd2lubmVyLnNpemUsXG4gICAgICB2ZXJzaW9uOiB3aW5uZXIuaWQsXG4gICAgICBjbG9jazogd2lubmVyLmNsb2NrLFxuICAgICAgZGVsZXRlZCxcbiAgICB9O1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyB1cGxvYWRCbG9iKGhhc2g6IHN0cmluZywgYnl0ZXM6IFVpbnQ4QXJyYXkpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCB0cmFuc3BvcnQgPSB0aGlzLnRyYW5zcG9ydDtcbiAgICBpZiAodHJhbnNwb3J0ID09PSBudWxsKSB0aHJvdyBuZXcgTmV0d29ya0Vycm9yKCdub3QgY29ubmVjdGVkJyk7XG4gICAgY29uc3QgcmVwbHkgPSBhd2FpdCB0aGlzLnJlcXVlc3Q8QmxvYkFja01lc3NhZ2UgfCBTZXJ2ZXJFcnJvck1lc3NhZ2U+KFxuICAgICAgKG0pID0+IG0udHlwZSA9PT0gJ2Jsb2JBY2snIHx8IG0udHlwZSA9PT0gJ2Vycm9yJyxcbiAgICAgICgpID0+IHRyYW5zcG9ydC5zZW5kKHsgdHlwZTogJ3B1dEJsb2InLCBoYXNoLCBjb250ZW50OiBieXRlc1RvQmFzZTY0KGJ5dGVzKSB9KSxcbiAgICApO1xuICAgIGlmIChyZXBseS50eXBlID09PSAnZXJyb3InKSB0aHJvdyB0aGlzLnRvRXJyb3IocmVwbHkpO1xuICAgIGF3YWl0IHRoaXMub3B0aW9ucy5ibG9iU3RvcmUucHV0KGhhc2gsIGJ5dGVzKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVhZG9ubHkgZmV0Y2hCbG9iOiBGZXRjaEJsb2IgPSBhc3luYyAoaGFzaDogc3RyaW5nKTogUHJvbWlzZTxVaW50OEFycmF5PiA9PiB7XG4gICAgaWYgKGhhc2ggPT09ICcnKSB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcigncmVmdXNpbmcgdG8gZmV0Y2ggY29udGVudCBmb3IgYW4gZW1wdHkgaGFzaCcpO1xuICAgIGNvbnN0IGNhY2hlZCA9IGF3YWl0IHRoaXMub3B0aW9ucy5ibG9iU3RvcmUuZ2V0KGhhc2gpO1xuICAgIGlmIChjYWNoZWQgIT09IHVuZGVmaW5lZCkgcmV0dXJuIGNhY2hlZDtcbiAgICBjb25zdCBieXRlcyA9IGF3YWl0IHRoaXMuZG93bmxvYWRCbG9iKGhhc2gpO1xuICAgIGF3YWl0IHRoaXMub3B0aW9ucy5ibG9iU3RvcmUucHV0KGhhc2gsIGJ5dGVzKTtcbiAgICByZXR1cm4gYnl0ZXM7XG4gIH07XG5cbiAgcHJpdmF0ZSBhc3luYyBkb3dubG9hZEJsb2IoaGFzaDogc3RyaW5nKTogUHJvbWlzZTxVaW50OEFycmF5PiB7XG4gICAgY29uc3QgdHJhbnNwb3J0ID0gdGhpcy50cmFuc3BvcnQ7XG4gICAgaWYgKHRyYW5zcG9ydCA9PT0gbnVsbCkgdGhyb3cgbmV3IE5ldHdvcmtFcnJvcignbm90IGNvbm5lY3RlZCcpO1xuICAgIGNvbnN0IHJlcGx5ID0gYXdhaXQgdGhpcy5yZXF1ZXN0PEJsb2JNZXNzYWdlIHwgU2VydmVyRXJyb3JNZXNzYWdlPihcbiAgICAgIChtKSA9PiAobS50eXBlID09PSAnYmxvYicgJiYgbS5oYXNoID09PSBoYXNoKSB8fCBtLnR5cGUgPT09ICdlcnJvcicsXG4gICAgICAoKSA9PiB0cmFuc3BvcnQuc2VuZCh7IHR5cGU6ICdnZXRCbG9iJywgaGFzaCB9KSxcbiAgICApO1xuICAgIGlmIChyZXBseS50eXBlID09PSAnZXJyb3InKSB0aHJvdyB0aGlzLnRvRXJyb3IocmVwbHkpO1xuICAgIGNvbnN0IGJ5dGVzID0gYmFzZTY0VG9CeXRlcyhyZXBseS5jb250ZW50KTtcbiAgICBpZiAoKGF3YWl0IHNoYTI1NkhleChieXRlcykpICE9PSBoYXNoKSB7XG4gICAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgYmxvYiAke2hhc2h9IGZhaWxlZCB2ZXJpZmljYXRpb24gb24gZG93bmxvYWRgKTtcbiAgICB9XG4gICAgcmV0dXJuIGJ5dGVzO1xuICB9XG5cbiAgLy8gLS0tIHBsdW1iaW5nIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICBwcml2YXRlIHJlcXVlc3Q8VCBleHRlbmRzIFNlcnZlck1lc3NhZ2U+KFxuICAgIG1hdGNoZXM6IChtZXNzYWdlOiBNZXNzYWdlKSA9PiBib29sZWFuLFxuICAgIHNlbmQ6ICgpID0+IHZvaWQsXG4gICk6IFByb21pc2U8VD4ge1xuICAgIHJldHVybiBuZXcgUHJvbWlzZTxUPigocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XG4gICAgICB0aGlzLmV4cGVjdGF0aW9uID0ge1xuICAgICAgICBtYXRjaGVzOiAobWVzc2FnZSkgPT4gbWF0Y2hlcyhtZXNzYWdlKSxcbiAgICAgICAgcmVzb2x2ZTogKG1lc3NhZ2UpID0+IHJlc29sdmUobWVzc2FnZSBhcyBUKSxcbiAgICAgICAgcmVqZWN0LFxuICAgICAgfTtcbiAgICAgIHRyeSB7XG4gICAgICAgIHNlbmQoKTtcbiAgICAgIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgICAgIHRoaXMuZXhwZWN0YXRpb24gPSBudWxsO1xuICAgICAgICByZWplY3QoZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yIDogbmV3IE5ldHdvcmtFcnJvcihTdHJpbmcoZXJyb3IpKSk7XG4gICAgICB9XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIHRvRXJyb3IobWVzc2FnZTogU2VydmVyRXJyb3JNZXNzYWdlKTogRXJyb3Ige1xuICAgIHN3aXRjaCAobWVzc2FnZS5jb2RlKSB7XG4gICAgICBjYXNlICdVTkFVVEhPUklaRUQnOlxuICAgICAgICByZXR1cm4gbmV3IFVuYXV0aG9yaXplZEVycm9yKG1lc3NhZ2UubWVzc2FnZSk7XG4gICAgICBjYXNlICdSRVZPS0VEJzpcbiAgICAgICAgcmV0dXJuIG5ldyBSZXZva2VkRXJyb3IobWVzc2FnZS5tZXNzYWdlKTtcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHJldHVybiBuZXcgUHJvdG9jb2xFcnJvcihtZXNzYWdlLm1lc3NhZ2UpO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgZW5xdWV1ZShvcGVyYXRpb246ICgpID0+IFByb21pc2U8dm9pZD4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLnF1ZXVlZE9wcyArPSAxO1xuICAgIGNvbnN0IHJ1biA9IHRoaXMudGFpbC50aGVuKG9wZXJhdGlvbiwgb3BlcmF0aW9uKTtcbiAgICBjb25zdCBzZXR0bGVkID0gcnVuLnRoZW4oXG4gICAgICAoKSA9PiB7XG4gICAgICAgIHRoaXMucXVldWVkT3BzIC09IDE7XG4gICAgICAgIHRoaXMucGVyc2lzdEluZGV4KCk7XG4gICAgICB9LFxuICAgICAgKGVycm9yOiB1bmtub3duKSA9PiB7XG4gICAgICAgIHRoaXMucXVldWVkT3BzIC09IDE7XG4gICAgICAgIHRoaXMucGVyc2lzdEluZGV4KCk7XG4gICAgICAgIHRocm93IGVycm9yO1xuICAgICAgfSxcbiAgICApO1xuICAgIC8vIFN3YWxsb3cgcmVqZWN0aW9ucyBvbiB0aGUgc2hhcmVkIHRhaWwgKGluZGl2aWR1YWwgY2FsbGVycyBzZWUgdGhlbSB2aWFcbiAgICAvLyBgc2V0dGxlZGApOyBvbmUgZmFpbGVkIG9wIG11c3Qgbm90IHBvaXNvbiB0aGUgcXVldWUuXG4gICAgdGhpcy50YWlsID0gc2V0dGxlZC50aGVuKFxuICAgICAgKCkgPT4ge30sXG4gICAgICAoKSA9PiB7fSxcbiAgICApO1xuICAgIHJldHVybiBzZXR0bGVkO1xuICB9XG5cbiAgcHJpdmF0ZSBwZXJzaXN0SW5kZXgoKTogdm9pZCB7XG4gICAgY29uc3Qgc25hcHNob3QgPSBzZXJpYWxpemVMb2NhbEluZGV4KHRoaXMuaW5kZXgpO1xuICAgIHZvaWQgdGhpcy5vcHRpb25zLnN0b3JhZ2VcbiAgICAgIC53cml0ZUZpbGUoTE9DQUxfSU5ERVhfU1RBVEVfUEFUSCwgbmV3IFRleHRFbmNvZGVyKCkuZW5jb2RlKHNuYXBzaG90KSlcbiAgICAgIC5jYXRjaCgoZXJyb3I6IHVua25vd24pID0+IHRoaXMubG9nLndhcm4oJ2ZhaWxlZCB0byBwZXJzaXN0IGxvY2FsIGluZGV4JywgZXJyb3IpKTtcbiAgfVxufVxuXG4vLyAtLS0gbW9kdWxlLXByaXZhdGUgdHlwZSBhbGlhc2VzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG50eXBlIFNlcnZlckVycm9yTWVzc2FnZSA9IEV4dHJhY3Q8U2VydmVyTWVzc2FnZSwgeyB0eXBlOiAnZXJyb3InIH0+O1xuIiwgIi8qKlxuICogYE9ic2lkaWFuU3RvcmFnZUFkYXB0ZXJgIFx1MjAxNCBjb3JlJ3MgYFN0b3JhZ2VBZGFwdGVyYCBvdmVyIHRoZSBPYnNpZGlhbiB2YXVsdFxuICogYERhdGFBZGFwdGVyYCAoQVJDSElURUNUVVJFIFx1MDBBNzggYWRhcHRlcnM6IHBsdWdpbiBpbXBsZW1lbnRhdGlvbiwgZGVza3RvcCBhbmRcbiAqIG1vYmlsZSBhbGlrZSkuXG4gKlxuICogUGF0aCBtYXBwaW5nOiBldmVyeSBwYXRoIGNyb3NzaW5nIHRoZSBjb3JlIHNlYW0gaXMgYSBQT1NJWC1ub3JtYWxpemVkIHZhdWx0XG4gKiBwYXRoIChgL25vdGVzL2EubWRgLCByb290IGAvYCk7IHRoZSBPYnNpZGlhbiBhZGFwdGVyIHdhbnRzIHRoZSBzYW1lIHBhdGhcbiAqICp3aXRob3V0KiB0aGUgbGVhZGluZyBzbGFzaCAoYG5vdGVzL2EubWRgKSwgd2l0aCBgL2AgKG9yIGAnJ2ApIGZvciB0aGUgcm9vdC5cbiAqXG4gKiBBbGwgd3JpdGVzIGdvIHRocm91Z2ggdGhlIGFkYXB0ZXIgKG5ldmVyIGB2YXVsdC5tb2RpZnlgIG9uIHRoZSBzaWRlKSwgc29cbiAqIE9ic2lkaWFuJ3Mgb3duIGZpbGUgd2F0Y2hpbmcgb2JzZXJ2ZXMgdGhlbSBsaWtlIGFueSBleHRlcm5hbCBlZGl0IGFuZCBvcGVuXG4gKiBlZGl0b3JzIHJlZnJlc2ggKEZSLTMpLiBXcml0ZXMgYXJlIGF0b21pYy1pc2g6IGNvbnRlbnQgbGFuZHMgaW4gYSB0ZW1wIGZpbGVcbiAqIHVuZGVyIGAvLnZhdWx0c3luY2ZvcmFnZW50cy90bXAvYCAoY29yZSBpZ25vcmVzIHRoYXQgd2hvbGUgc3VidHJlZSkgYW5kIGlzXG4gKiByZW5hbWVkIG9udG8gdGhlIHRhcmdldDsgaWYgcmVuYW1pbmcgaXMgdW5hdmFpbGFibGUgKGV4b3RpYyBtb2JpbGVcbiAqIGFkYXB0ZXJzKSwgd2UgZmFsbCBiYWNrIHRvIGEgZGlyZWN0IHdyaXRlLlxuICovXG5cbmltcG9ydCB0eXBlIHsgRGF0YUFkYXB0ZXIgfSBmcm9tICdvYnNpZGlhbic7XG5pbXBvcnQgdHlwZSB7IEZpbGVTdGF0LCBTdG9yYWdlQWRhcHRlciB9IGZyb20gJ0B2c2EvY29yZSc7XG5pbXBvcnQgeyBub3JtYWxpemVWYXVsdFBhdGggfSBmcm9tICdAdnNhL2NvcmUnO1xuXG4vKiogRGlyZWN0b3J5IChpbnNpZGUgdGhlIHZhdWx0KSBob2xkaW5nIHRlbXAgZmlsZXMgZHVyaW5nIGF0b21pYyB3cml0ZXMuICovXG5leHBvcnQgY29uc3QgVEVNUF9ESVJfVkFVTFRfUEFUSCA9ICcvLnZhdWx0c3luY2ZvcmFnZW50cy90bXAnO1xuXG4vKiogU3RhdHMgT2JzaWRpYW4ncyBgRGF0YUFkYXB0ZXIuc3RhdGAgcmV0dXJucyBmb3IgYSBmaWxlLiAqL1xuaW50ZXJmYWNlIEFkYXB0ZXJTdGF0IHtcbiAgc2l6ZTogbnVtYmVyO1xuICBtdGltZTogbnVtYmVyO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIE9ic2lkaWFuU3RvcmFnZUFkYXB0ZXJPcHRpb25zIHtcbiAgYWRhcHRlcjogRGF0YUFkYXB0ZXI7XG59XG5cbmV4cG9ydCBjbGFzcyBPYnNpZGlhblN0b3JhZ2VBZGFwdGVyIGltcGxlbWVudHMgU3RvcmFnZUFkYXB0ZXIge1xuICBwcml2YXRlIHJlYWRvbmx5IGFkYXB0ZXI6IERhdGFBZGFwdGVyO1xuICAvKipcbiAgICogTGF0Y2hlZCB3aGVuIGEgdGVtcCtyZW5hbWUgYXR0ZW1wdCBmYWlsczogZXZlcnkgbGF0ZXIgd3JpdGUgZ29lcyBzdHJhaWdodFxuICAgKiB0byBgd3JpdGVCaW5hcnlgIGluc3RlYWQgb2YgcGF5aW5nIHRoZSBmYWlsaW5nLXJlbmFtZSBwZW5hbHR5IGFnYWluLlxuICAgKi9cbiAgcHJpdmF0ZSB0ZW1wUmVuYW1lQnJva2VuID0gZmFsc2U7XG4gIHByaXZhdGUgdGVtcENvdW50ZXIgPSAwO1xuXG4gIGNvbnN0cnVjdG9yKG9wdGlvbnM6IE9ic2lkaWFuU3RvcmFnZUFkYXB0ZXJPcHRpb25zKSB7XG4gICAgdGhpcy5hZGFwdGVyID0gb3B0aW9ucy5hZGFwdGVyO1xuICB9XG5cbiAgLy8gLS0tIHBhdGggbWFwcGluZyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgLyoqIFZhdWx0IHBhdGggXHUyMTkyIGFkYXB0ZXIgcGF0aCAoYC9hL2IubWRgIFx1MjE5MiBgYS9iLm1kYCwgYC9gIFx1MjE5MiBgL2ApLiAqL1xuICBwcml2YXRlIHRvQWRhcHRlclBhdGgodmF1bHRQYXRoOiBzdHJpbmcpOiBzdHJpbmcge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVWYXVsdFBhdGgodmF1bHRQYXRoKTtcbiAgICByZXR1cm4gbm9ybWFsaXplZCA9PT0gJy8nID8gJy8nIDogbm9ybWFsaXplZC5zbGljZSgxKTtcbiAgfVxuXG4gIC8vIC0tLSBTdG9yYWdlQWRhcHRlciAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICBhc3luYyByZWFkRmlsZShwYXRoOiBzdHJpbmcpOiBQcm9taXNlPFVpbnQ4QXJyYXk+IHtcbiAgICBjb25zdCBidWZmZXIgPSBhd2FpdCB0aGlzLmFkYXB0ZXIucmVhZEJpbmFyeSh0aGlzLnRvQWRhcHRlclBhdGgocGF0aCkpO1xuICAgIHJldHVybiBuZXcgVWludDhBcnJheShidWZmZXIpO1xuICB9XG5cbiAgYXN5bmMgd3JpdGVGaWxlKHBhdGg6IHN0cmluZywgZGF0YTogVWludDhBcnJheSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHRhcmdldCA9IHRoaXMudG9BZGFwdGVyUGF0aChwYXRoKTtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVBhcmVudERpcnModGFyZ2V0KTtcbiAgICAvLyBDb3B5IGludG8gYSBzdGFuZGFsb25lIEFycmF5QnVmZmVyOiBgYnl0ZXMuYnVmZmVyYCBtYXkgYmUgYSBwb29sZWRcbiAgICAvLyBidWZmZXIgbGFyZ2VyIHRoYW4gdGhlIHZpZXcgKGNvcmUgc2xpY2VzIGFuZCByZXVzZXMgYnVmZmVycykuXG4gICAgY29uc3QgYnVmZmVyID0gbmV3IEFycmF5QnVmZmVyKGRhdGEuYnl0ZUxlbmd0aCk7XG4gICAgbmV3IFVpbnQ4QXJyYXkoYnVmZmVyKS5zZXQoZGF0YSk7XG5cbiAgICBpZiAodGhpcy50ZW1wUmVuYW1lQnJva2VuKSB7XG4gICAgICBhd2FpdCB0aGlzLmFkYXB0ZXIud3JpdGVCaW5hcnkodGFyZ2V0LCBidWZmZXIpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCB0ZW1wID0gYXdhaXQgdGhpcy50ZW1wUGF0aCgpO1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLmFkYXB0ZXIud3JpdGVCaW5hcnkodGVtcCwgYnVmZmVyKTtcbiAgICAgIGF3YWl0IHRoaXMuYWRhcHRlci5yZW5hbWUodGVtcCwgdGFyZ2V0KTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIENsZWFuIHVwIHRoZSBvcnBoYW5lZCB0ZW1wIChiZXN0IGVmZm9ydCBcdTIwMTQgaXQgbGl2ZXMgaW4gdGhlIGlnbm9yZWRcbiAgICAgIC8vIHN0YXRlIGRpciwgc28gZXZlbiBhIGxlYWsgaXMgaW52aXNpYmxlIHRvIHN5bmMpLCB0aGVuIGZhbGwgYmFjayB0b1xuICAgICAgLy8gYSBkaXJlY3QsIG5vbi1hdG9taWMgd3JpdGUgcmF0aGVyIHRoYW4gZmFpbGluZyB0aGUgc3luYy5cbiAgICAgIGF3YWl0IHRoaXMuc2lsZW50UmVtb3ZlKHRlbXApO1xuICAgICAgdGhpcy50ZW1wUmVuYW1lQnJva2VuID0gdHJ1ZTtcbiAgICAgIGF3YWl0IHRoaXMuYWRhcHRlci53cml0ZUJpbmFyeSh0YXJnZXQsIGJ1ZmZlcik7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgZGVsZXRlRmlsZShwYXRoOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCB0YXJnZXQgPSB0aGlzLnRvQWRhcHRlclBhdGgocGF0aCk7XG4gICAgLy8gSWRlbXBvdGVudCBwZXIgdGhlIGFkYXB0ZXIgY29udHJhY3QuXG4gICAgaWYgKCEoYXdhaXQgdGhpcy5hZGFwdGVyLmV4aXN0cyh0YXJnZXQpKSkgcmV0dXJuO1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLmFkYXB0ZXIucmVtb3ZlKHRhcmdldCk7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBMb3N0IGEgcmFjZSB3aXRoIGEgY29uY3VycmVudCBkZWxldGUgXHUyMDE0IG9ubHkgc3VyZmFjZSBpZiBpdCBzdXJ2aXZlcy5cbiAgICAgIGlmIChhd2FpdCB0aGlzLmFkYXB0ZXIuZXhpc3RzKHRhcmdldCkpIHRocm93IG5ldyBFcnJvcihgZmFpbGVkIHRvIGRlbGV0ZSAke3RhcmdldH1gKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyByZW5hbWVGaWxlKGZyb206IHN0cmluZywgdG86IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGZyb21QYXRoID0gdGhpcy50b0FkYXB0ZXJQYXRoKGZyb20pO1xuICAgIGNvbnN0IHRvUGF0aCA9IHRoaXMudG9BZGFwdGVyUGF0aCh0byk7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVQYXJlbnREaXJzKHRvUGF0aCk7XG4gICAgYXdhaXQgdGhpcy5hZGFwdGVyLnJlbmFtZShmcm9tUGF0aCwgdG9QYXRoKTtcbiAgfVxuXG4gIGFzeW5jIGxpc3RGaWxlcygpOiBQcm9taXNlPHJlYWRvbmx5IEZpbGVTdGF0W10+IHtcbiAgICBjb25zdCBmaWxlczogRmlsZVN0YXRbXSA9IFtdO1xuICAgIGF3YWl0IHRoaXMud2Fsa0ZpbGVzKCcvJywgYXN5bmMgKGFkYXB0ZXJQYXRoKSA9PiB7XG4gICAgICBjb25zdCBzdGF0ID0gYXdhaXQgdGhpcy5zdGF0T3JOdWxsKGFkYXB0ZXJQYXRoKTtcbiAgICAgIGlmIChzdGF0ID09PSBudWxsKSByZXR1cm47IC8vIHZhbmlzaGVkIG1pZC13YWxrXG4gICAgICBmaWxlcy5wdXNoKHtcbiAgICAgICAgcGF0aDogYC8ke2FkYXB0ZXJQYXRofWAsXG4gICAgICAgIHNpemU6IHN0YXQuc2l6ZSxcbiAgICAgICAgbXRpbWU6IHN0YXQubXRpbWUsXG4gICAgICB9KTtcbiAgICB9KTtcbiAgICBmaWxlcy5zb3J0KChhLCBiKSA9PiAoYS5wYXRoIDwgYi5wYXRoID8gLTEgOiBhLnBhdGggPiBiLnBhdGggPyAxIDogMCkpO1xuICAgIHJldHVybiBmaWxlcztcbiAgfVxuXG4gIGFzeW5jIGxpc3REaXJzKCk6IFByb21pc2U8cmVhZG9ubHkgc3RyaW5nW10+IHtcbiAgICBjb25zdCBkaXJzOiBzdHJpbmdbXSA9IFsnLyddO1xuICAgIGF3YWl0IHRoaXMud2Fsa0ZvbGRlcnMoJy8nLCBhc3luYyAoYWRhcHRlclBhdGgpID0+IHtcbiAgICAgIGRpcnMucHVzaChgLyR7YWRhcHRlclBhdGh9YCk7XG4gICAgfSk7XG4gICAgZGlycy5zb3J0KChhLCBiKSA9PiAoYSA8IGIgPyAtMSA6IGEgPiBiID8gMSA6IDApKTtcbiAgICByZXR1cm4gZGlycztcbiAgfVxuXG4gIGFzeW5jIGVuc3VyZURpcihwYXRoOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBub3JtYWxpemVkID0gbm9ybWFsaXplVmF1bHRQYXRoKHBhdGgpO1xuICAgIGNvbnN0IHNlZ21lbnRzID0gbm9ybWFsaXplZCA9PT0gJy8nID8gW10gOiBub3JtYWxpemVkLnNsaWNlKDEpLnNwbGl0KCcvJyk7XG4gICAgbGV0IGN1cnJlbnQgPSAnJztcbiAgICBmb3IgKGNvbnN0IHNlZ21lbnQgb2Ygc2VnbWVudHMpIHtcbiAgICAgIGN1cnJlbnQgPSBjdXJyZW50ID09PSAnJyA/IHNlZ21lbnQgOiBgJHtjdXJyZW50fS8ke3NlZ21lbnR9YDtcbiAgICAgIGlmICghKGF3YWl0IHRoaXMuYWRhcHRlci5leGlzdHMoY3VycmVudCkpKSBhd2FpdCB0aGlzLmFkYXB0ZXIubWtkaXIoY3VycmVudCk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgZXhpc3RzKHBhdGg6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVWYXVsdFBhdGgocGF0aCk7XG4gICAgaWYgKG5vcm1hbGl6ZWQgPT09ICcvJykgcmV0dXJuIHRydWU7IC8vIHRoZSB2YXVsdCByb290IGFsd2F5cyBleGlzdHNcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMuYWRhcHRlci5leGlzdHModGhpcy50b0FkYXB0ZXJQYXRoKG5vcm1hbGl6ZWQpKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cblxuICAvLyAtLS0gaGVscGVycyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgcHJpdmF0ZSBhc3luYyBzdGF0T3JOdWxsKGFkYXB0ZXJQYXRoOiBzdHJpbmcpOiBQcm9taXNlPEFkYXB0ZXJTdGF0IHwgbnVsbD4ge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCBzdGF0ID0gYXdhaXQgdGhpcy5hZGFwdGVyLnN0YXQoYWRhcHRlclBhdGgpO1xuICAgICAgaWYgKHN0YXQgPT09IG51bGwgfHwgc3RhdC50eXBlICE9PSAnZmlsZScpIHJldHVybiBudWxsO1xuICAgICAgcmV0dXJuIHsgc2l6ZTogc3RhdC5zaXplLCBtdGltZTogc3RhdC5tdGltZSB9O1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuICB9XG5cbiAgLyoqIEEgdW5pcXVlIHRlbXAgcGF0aCBpbnNpZGUgdGhlIChzeW5jLWlnbm9yZWQpIGNsaWVudCBzdGF0ZSBkaXIuICovXG4gIHByaXZhdGUgYXN5bmMgdGVtcFBhdGgoKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZURpcihURU1QX0RJUl9WQVVMVF9QQVRIKTtcbiAgICB0aGlzLnRlbXBDb3VudGVyICs9IDE7XG4gICAgcmV0dXJuIGAke1RFTVBfRElSX1ZBVUxUX1BBVEguc2xpY2UoMSl9L3ctJHtEYXRlLm5vdygpLnRvU3RyaW5nKDM2KX0tJHt0aGlzLnRlbXBDb3VudGVyfS50bXBgO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBzaWxlbnRSZW1vdmUoYWRhcHRlclBhdGg6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLmFkYXB0ZXIucmVtb3ZlKGFkYXB0ZXJQYXRoKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIGJlc3QgZWZmb3J0XG4gICAgfVxuICB9XG5cbiAgLyoqIENyZWF0ZSBldmVyeSBhbmNlc3RvciBkaXJlY3Rvcnkgb2YgYW4gYWRhcHRlciBmaWxlIHBhdGguICovXG4gIHByaXZhdGUgYXN5bmMgZW5zdXJlUGFyZW50RGlycyhhZGFwdGVyUGF0aDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgc2xhc2ggPSBhZGFwdGVyUGF0aC5sYXN0SW5kZXhPZignLycpO1xuICAgIGlmIChzbGFzaCA8PSAwKSByZXR1cm47IC8vIHZhdWx0IHJvb3QgXHUyMDE0IGFsd2F5cyBleGlzdHNcbiAgICBjb25zdCBwYXJlbnQgPSBhZGFwdGVyUGF0aC5zbGljZSgwLCBzbGFzaCk7XG4gICAgYXdhaXQgdGhpcy5lbnN1cmVEaXIoYC8ke3BhcmVudH1gKTtcbiAgfVxuXG4gIC8qKiBSZWN1cnNpdmVseSB2aXNpdCBldmVyeSBmaWxlIHVuZGVyIGBkaXJBZGFwdGVyUGF0aGAgKGFkYXB0ZXIgcGF0aHMpLiAqL1xuICBwcml2YXRlIGFzeW5jIHdhbGtGaWxlcyhcbiAgICBkaXJBZGFwdGVyUGF0aDogc3RyaW5nLFxuICAgIHZpc2l0OiAoYWRhcHRlclBhdGg6IHN0cmluZykgPT4gUHJvbWlzZTx2b2lkPixcbiAgKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgbGV0IGxpc3Rpbmc7XG4gICAgdHJ5IHtcbiAgICAgIGxpc3RpbmcgPSBhd2FpdCB0aGlzLmFkYXB0ZXIubGlzdChkaXJBZGFwdGVyUGF0aCk7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm47IC8vIHVucmVhZGFibGUvbWlzc2luZyBcdTIwMTQgdHJlYXQgYXMgZW1wdHlcbiAgICB9XG4gICAgZm9yIChjb25zdCBmaWxlIG9mIGxpc3RpbmcuZmlsZXMpIGF3YWl0IHZpc2l0KGZpbGUpO1xuICAgIGZvciAoY29uc3QgZm9sZGVyIG9mIGxpc3RpbmcuZm9sZGVycykgYXdhaXQgdGhpcy53YWxrRmlsZXMoZm9sZGVyLCB2aXNpdCk7XG4gIH1cblxuICAvKiogUmVjdXJzaXZlbHkgdmlzaXQgZXZlcnkgZm9sZGVyIHVuZGVyIGBkaXJBZGFwdGVyUGF0aGAgKGFkYXB0ZXIgcGF0aHMpLiAqL1xuICBwcml2YXRlIGFzeW5jIHdhbGtGb2xkZXJzKFxuICAgIGRpckFkYXB0ZXJQYXRoOiBzdHJpbmcsXG4gICAgdmlzaXQ6IChhZGFwdGVyUGF0aDogc3RyaW5nKSA9PiBQcm9taXNlPHZvaWQ+LFxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBsZXQgbGlzdGluZztcbiAgICB0cnkge1xuICAgICAgbGlzdGluZyA9IGF3YWl0IHRoaXMuYWRhcHRlci5saXN0KGRpckFkYXB0ZXJQYXRoKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgZm9yIChjb25zdCBmb2xkZXIgb2YgbGlzdGluZy5mb2xkZXJzKSB7XG4gICAgICBhd2FpdCB2aXNpdChmb2xkZXIpO1xuICAgICAgYXdhaXQgdGhpcy53YWxrRm9sZGVycyhmb2xkZXIsIHZpc2l0KTtcbiAgICB9XG4gIH1cbn1cbiIsICIvKipcbiAqIGBPYnNpZGlhbldhdGNoQWRhcHRlcmAgKyBgUmVzY2FuU2NoZWR1bGVyYCBcdTIwMTQgY29yZSdzIGBXYXRjaEFkYXB0ZXJgIG92ZXJcbiAqIE9ic2lkaWFuIHZhdWx0IGV2ZW50cyAoQVJDSElURUNUVVJFIFx1MDBBNzggYWRhcHRlcnMpLCBwbHVzIHRoZSBwZXJpb2RpYyAvXG4gKiBmb2N1cy1kcml2ZW4gcmVjb25jaWxpYXRpb24gaG9va3MgdGhlIG1vYmlsZSAmIGV4dGVybmFsLWVkaXQgc3RvcmllcyBuZWVkXG4gKiAoXHUwMEE3OCBcIk1vYmlsZVwiLCBGUi01LCBGUi0xMikuXG4gKlxuICogVmF1bHQgZXZlbnRzIGNvdmVyIGV2ZXJ5dGhpbmcgT2JzaWRpYW4gaXRzZWxmIG9ic2VydmVzIFx1MjAxNCBpbi1hcHAgZWRpdHMsXG4gKiBkcmFnLWRyb3BzLCBhbmQgZXh0ZXJuYWwgZWRpdHMgbWFkZSB3aGlsZSBPYnNpZGlhbiBpcyAqb3BlbiouIEVkaXRzIG1hZGVcbiAqIHdoaWxlIE9ic2lkaWFuIHdhcyBjbG9zZWQgYXJlIHBpY2tlZCB1cCBieSB0aGUgc3RhcnR1cCByZWNvbmNpbGlhdGlvbiBhbmRcbiAqIGJ5IHRoZSBwZXJpb2RpYyByZXNjYW4gd2lyZWQgaGVyZTpcbiAqXG4gKiAgIHZhdWx0IGV2ZW50cyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1QkEgV2F0Y2hBZGFwdGVyLnN0YXJ0KGNiKSBcdTI1MDBcdTI1QkEgU3luY0NsaWVudCBkZWJvdW5jZWQgY3ljbGVcbiAqICAgc2V0SW50ZXJ2YWwgKGRlZmF1bHQgMzBzKSBcdTI1MDBcdTI1QkEgUmVzY2FuU2NoZWR1bGVyIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjVCQSBTeW5jQ2xpZW50LnRyaWdnZXJTeW5jKClcbiAqICAgYWN0aXZlLWxlYWYtY2hhbmdlIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjVCQSBSZXNjYW5TY2hlZHVsZXIucG9rZSgpIFx1MjUwMFx1MjUwMFx1MjVCQSAoc2hvcnQgZGVib3VuY2UsIHRoZW4gYSBjeWNsZSlcbiAqL1xuXG5pbXBvcnQgdHlwZSB7IEV2ZW50UmVmLCBUQWJzdHJhY3RGaWxlLCBWYXVsdCB9IGZyb20gJ29ic2lkaWFuJztcbmltcG9ydCB0eXBlIHsgRmlsZUNoYW5nZUV2ZW50LCBXYXRjaEFkYXB0ZXIgfSBmcm9tICdAdnNhL2NvcmUnO1xuXG5leHBvcnQgaW50ZXJmYWNlIE9ic2lkaWFuV2F0Y2hBZGFwdGVyT3B0aW9ucyB7XG4gIHZhdWx0OiBWYXVsdDtcbn1cblxuZXhwb3J0IGNsYXNzIE9ic2lkaWFuV2F0Y2hBZGFwdGVyIGltcGxlbWVudHMgV2F0Y2hBZGFwdGVyIHtcbiAgcHJpdmF0ZSByZWFkb25seSB2YXVsdDogVmF1bHQ7XG4gIHByaXZhdGUgcmVmczogRXZlbnRSZWZbXSA9IFtdO1xuICBwcml2YXRlIGVtaXQ6ICgoZXZlbnRzOiByZWFkb25seSBGaWxlQ2hhbmdlRXZlbnRbXSkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcblxuICBjb25zdHJ1Y3RvcihvcHRpb25zOiBPYnNpZGlhbldhdGNoQWRhcHRlck9wdGlvbnMpIHtcbiAgICB0aGlzLnZhdWx0ID0gb3B0aW9ucy52YXVsdDtcbiAgfVxuXG4gIHN0YXJ0KGNiOiAoZXZlbnRzOiByZWFkb25seSBGaWxlQ2hhbmdlRXZlbnRbXSkgPT4gdm9pZCk6IHZvaWQge1xuICAgIHRoaXMuc3RvcCgpO1xuICAgIHRoaXMuZW1pdCA9IGNiO1xuICAgIC8vIEJvdGggZmlsZXMgYW5kIGZvbGRlcnMgYXJlIGZvcndhcmRlZDogZm9sZGVyIGV2ZW50cyAoY3JlYXRlL3JlbmFtZS9cbiAgICAvLyBkZWxldGUpIHRyaWdnZXIgdGhlIHJlY29uY2lsaWF0aW9uIHNjYW4gdGhhdCBkaXNjb3ZlcnMgZW1wdHktZm9sZGVyXG4gICAgLy8gcGxhY2Vob2xkZXIgY2hhbmdlcyAoRlItMTApLiBUaGUgZW5naW5lIGZpbHRlcnMgaWdub3JlZCBwYXRocyBpdHNlbGYuXG4gICAgdGhpcy5yZWZzID0gW1xuICAgICAgdGhpcy52YXVsdC5vbignY3JlYXRlJywgKGZpbGU6IFRBYnN0cmFjdEZpbGUpID0+IHtcbiAgICAgICAgdGhpcy5mb3J3YXJkKHsga2luZDogJ2FkZCcsIHBhdGg6IHZhdWx0UGF0aE9mKGZpbGUpIH0pO1xuICAgICAgfSksXG4gICAgICB0aGlzLnZhdWx0Lm9uKCdtb2RpZnknLCAoZmlsZTogVEFic3RyYWN0RmlsZSkgPT4ge1xuICAgICAgICB0aGlzLmZvcndhcmQoeyBraW5kOiAnbW9kaWZ5JywgcGF0aDogdmF1bHRQYXRoT2YoZmlsZSkgfSk7XG4gICAgICB9KSxcbiAgICAgIHRoaXMudmF1bHQub24oJ2RlbGV0ZScsIChmaWxlOiBUQWJzdHJhY3RGaWxlKSA9PiB7XG4gICAgICAgIHRoaXMuZm9yd2FyZCh7IGtpbmQ6ICdkZWxldGUnLCBwYXRoOiB2YXVsdFBhdGhPZihmaWxlKSB9KTtcbiAgICAgIH0pLFxuICAgICAgdGhpcy52YXVsdC5vbigncmVuYW1lJywgKGZpbGU6IFRBYnN0cmFjdEZpbGUsIG9sZFBhdGg6IHN0cmluZykgPT4ge1xuICAgICAgICAvLyBgb2xkUGF0aGAgXHUyMTkyIGBmaWxlLnBhdGhgOiB0aGUgZW50cnkgYXQgYHBhdGhgIG1vdmVkIHRvIGB0b1BhdGhgLlxuICAgICAgICB0aGlzLmZvcndhcmQoeyBraW5kOiAncmVuYW1lJywgcGF0aDogYC8ke29sZFBhdGh9YCwgdG9QYXRoOiB2YXVsdFBhdGhPZihmaWxlKSB9KTtcbiAgICAgIH0pLFxuICAgIF07XG4gIH1cblxuICBzdG9wKCk6IHZvaWQge1xuICAgIGZvciAoY29uc3QgcmVmIG9mIHRoaXMucmVmcykgdGhpcy52YXVsdC5vZmZyZWYocmVmKTtcbiAgICB0aGlzLnJlZnMgPSBbXTtcbiAgICB0aGlzLmVtaXQgPSBudWxsO1xuICB9XG5cbiAgcHJpdmF0ZSBmb3J3YXJkKGV2ZW50OiBGaWxlQ2hhbmdlRXZlbnQpOiB2b2lkIHtcbiAgICB0aGlzLmVtaXQ/LihbZXZlbnRdKTtcbiAgfVxufVxuXG4vKiogVmF1bHQgZXZlbnQgcGF0aCAoYWRhcHRlci1ub3JtYWxpemVkLCBubyBsZWFkaW5nIHNsYXNoKSBcdTIxOTIgY29yZSB2YXVsdCBwYXRoLiAqL1xuZnVuY3Rpb24gdmF1bHRQYXRoT2YoZmlsZTogVEFic3RyYWN0RmlsZSk6IHN0cmluZyB7XG4gIHJldHVybiBmaWxlLnBhdGguc3RhcnRzV2l0aCgnLycpID8gZmlsZS5wYXRoIDogYC8ke2ZpbGUucGF0aH1gO1xufVxuXG4vLyAtLS0gUmVzY2FuU2NoZWR1bGVyIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgUmVzY2FuU2NoZWR1bGVyT3B0aW9ucyB7XG4gIC8qKiBQZXJpb2QgYmV0d2VlbiBmdWxsIHJlc2NhbnMgaW4gbXM7IGAwYCBkaXNhYmxlcyB0aGUgcGVyaW9kaWMgdGltZXIuICovXG4gIGludGVydmFsTXM6IG51bWJlcjtcbiAgLyoqIERlYm91bmNlIHdpbmRvdyBmb3IgYHBva2UoKWAgKGFjdGl2ZS1sZWFmLWNoYW5nZSksIGRlZmF1bHQgMzAwMCBtcy4gKi9cbiAgcG9rZURlbGF5TXM/OiBudW1iZXI7XG4gIC8qKiBJbmplY3RhYmxlIHRpbWVyIHNlYW1zICh0ZXN0cyB1c2UgZmFrZSB0aW1lcnMgYWdhaW5zdCB0aGUgZ2xvYmFscykuICovXG4gIHNldEludGVydmFsSW1wbD86IChmbjogKCkgPT4gdm9pZCwgbXM6IG51bWJlcikgPT4gdW5rbm93bjtcbiAgY2xlYXJJbnRlcnZhbEltcGw/OiAoaGFuZGxlOiB1bmtub3duKSA9PiB2b2lkO1xuICBzZXRUaW1lb3V0SW1wbD86IChmbjogKCkgPT4gdm9pZCwgbXM6IG51bWJlcikgPT4gdW5rbm93bjtcbiAgY2xlYXJUaW1lb3V0SW1wbD86IChoYW5kbGU6IHVua25vd24pID0+IHZvaWQ7XG59XG5cbi8qKlxuICogRHJpdmVzIHBlcmlvZGljICsgZm9jdXMtdHJpZ2dlcmVkIGZ1bGwgcmVjb25jaWxpYXRpb24gY3ljbGVzLiBOb3QgYVxuICogYFdhdGNoQWRhcHRlcmAgaXRzZWxmIFx1MjAxNCBpdHMgYHJ1bmAgY2FsbGJhY2sgaXMgd2lyZWQgdG9cbiAqIGBTeW5jQ2xpZW50LnRyaWdnZXJTeW5jKClgIGJ5IHRoZSBwbHVnaW4gKGEgcmVzY2FuIGlzIGEgZnVsbCBjeWNsZSwgbm90IGFcbiAqIHNpbmdsZSBmaWxlIGV2ZW50KS5cbiAqL1xuZXhwb3J0IGNsYXNzIFJlc2NhblNjaGVkdWxlciB7XG4gIHByaXZhdGUgcmVhZG9ubHkgcG9rZURlbGF5TXM6IG51bWJlcjtcbiAgcHJpdmF0ZSByZWFkb25seSBzZXRJbnRlcnZhbEltcGw6IChmbjogKCkgPT4gdm9pZCwgbXM6IG51bWJlcikgPT4gdW5rbm93bjtcbiAgcHJpdmF0ZSByZWFkb25seSBjbGVhckludGVydmFsSW1wbDogKGhhbmRsZTogdW5rbm93bikgPT4gdm9pZDtcbiAgcHJpdmF0ZSByZWFkb25seSBzZXRUaW1lb3V0SW1wbDogKGZuOiAoKSA9PiB2b2lkLCBtczogbnVtYmVyKSA9PiB1bmtub3duO1xuICBwcml2YXRlIHJlYWRvbmx5IGNsZWFyVGltZW91dEltcGw6IChoYW5kbGU6IHVua25vd24pID0+IHZvaWQ7XG5cbiAgcHJpdmF0ZSBydW46ICgoKSA9PiB2b2lkKSB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGludGVydmFsSGFuZGxlOiB1bmtub3duID0gbnVsbDtcbiAgcHJpdmF0ZSBpbnRlcnZhbE1zOiBudW1iZXI7XG4gIHByaXZhdGUgcG9rZUhhbmRsZTogdW5rbm93biA9IG51bGw7XG5cbiAgY29uc3RydWN0b3Iob3B0aW9uczogUmVzY2FuU2NoZWR1bGVyT3B0aW9ucykge1xuICAgIHRoaXMuaW50ZXJ2YWxNcyA9IG9wdGlvbnMuaW50ZXJ2YWxNcztcbiAgICB0aGlzLnBva2VEZWxheU1zID0gb3B0aW9ucy5wb2tlRGVsYXlNcyA/PyAzMDAwO1xuICAgIHRoaXMuc2V0SW50ZXJ2YWxJbXBsID0gb3B0aW9ucy5zZXRJbnRlcnZhbEltcGwgPz8gKChmbiwgbXMpID0+IHNldEludGVydmFsKGZuLCBtcykpO1xuICAgIHRoaXMuY2xlYXJJbnRlcnZhbEltcGwgPSBvcHRpb25zLmNsZWFySW50ZXJ2YWxJbXBsID8/ICgoaGFuZGxlKSA9PiBjbGVhckludGVydmFsKGhhbmRsZSBhcyBudW1iZXIpKTtcbiAgICB0aGlzLnNldFRpbWVvdXRJbXBsID0gb3B0aW9ucy5zZXRUaW1lb3V0SW1wbCA/PyAoKGZuLCBtcykgPT4gc2V0VGltZW91dChmbiwgbXMpKTtcbiAgICB0aGlzLmNsZWFyVGltZW91dEltcGwgPSBvcHRpb25zLmNsZWFyVGltZW91dEltcGwgPz8gKChoYW5kbGUpID0+IGNsZWFyVGltZW91dChoYW5kbGUgYXMgbnVtYmVyKSk7XG4gIH1cblxuICAvKiogQmVnaW4gcGVyaW9kaWMgcmVzY2FuczsgYHJ1bmAgbXVzdCBiZSBzYWZlIHRvIGNhbGwgYXQgYW55IHRpbWUuICovXG4gIHN0YXJ0KHJ1bjogKCkgPT4gdm9pZCk6IHZvaWQge1xuICAgIHRoaXMuc3RvcCgpO1xuICAgIHRoaXMucnVuID0gcnVuO1xuICAgIHRoaXMuYXJtSW50ZXJ2YWwoKTtcbiAgfVxuXG4gIHN0b3AoKTogdm9pZCB7XG4gICAgdGhpcy5jbGVhckludGVydmFsSW1wbEtlZXAoKTtcbiAgICBpZiAodGhpcy5wb2tlSGFuZGxlICE9PSBudWxsKSB7XG4gICAgICB0aGlzLmNsZWFyVGltZW91dEltcGwodGhpcy5wb2tlSGFuZGxlKTtcbiAgICAgIHRoaXMucG9rZUhhbmRsZSA9IG51bGw7XG4gICAgfVxuICAgIHRoaXMucnVuID0gbnVsbDtcbiAgfVxuXG4gIC8qKiBDaGFuZ2UgdGhlIHBlcmlvZGljIGludGVydmFsIGxpdmUgKHRoZSBzZXR0aW5ncy10YWIgdG9nZ2xlKS4gKi9cbiAgc2V0SW50ZXJ2YWxNcyhtczogbnVtYmVyKTogdm9pZCB7XG4gICAgdGhpcy5pbnRlcnZhbE1zID0gbXM7XG4gICAgaWYgKHRoaXMucnVuICE9PSBudWxsKSB7XG4gICAgICB0aGlzLmNsZWFySW50ZXJ2YWxJbXBsS2VlcCgpO1xuICAgICAgdGhpcy5hcm1JbnRlcnZhbCgpO1xuICAgIH1cbiAgfVxuXG4gIC8qKiBBIGZvY3VzL2FwcC1zd2l0Y2ggc2lnbmFsIChhY3RpdmUtbGVhZi1jaGFuZ2UpOiByZXNjYW4gc29vbiwgY29hbGVzY2VkLiAqL1xuICBwb2tlKCk6IHZvaWQge1xuICAgIGlmICh0aGlzLnJ1biA9PT0gbnVsbCkgcmV0dXJuO1xuICAgIGlmICh0aGlzLnBva2VIYW5kbGUgIT09IG51bGwpIHJldHVybjsgLy8gYWxyZWFkeSBzY2hlZHVsZWRcbiAgICB0aGlzLnBva2VIYW5kbGUgPSB0aGlzLnNldFRpbWVvdXRJbXBsKCgpID0+IHtcbiAgICAgIHRoaXMucG9rZUhhbmRsZSA9IG51bGw7XG4gICAgICB0aGlzLnJ1bj8uKCk7XG4gICAgfSwgdGhpcy5wb2tlRGVsYXlNcyk7XG4gIH1cblxuICBnZXQgaW50ZXJ2YWxNc1ZhbHVlKCk6IG51bWJlciB7XG4gICAgcmV0dXJuIHRoaXMuaW50ZXJ2YWxNcztcbiAgfVxuXG4gIHByaXZhdGUgYXJtSW50ZXJ2YWwoKTogdm9pZCB7XG4gICAgaWYgKHRoaXMuaW50ZXJ2YWxNcyA8PSAwIHx8IHRoaXMucnVuID09PSBudWxsKSByZXR1cm47XG4gICAgdGhpcy5pbnRlcnZhbEhhbmRsZSA9IHRoaXMuc2V0SW50ZXJ2YWxJbXBsKCgpID0+IHRoaXMucnVuPy4oKSwgdGhpcy5pbnRlcnZhbE1zKTtcbiAgfVxuXG4gIHByaXZhdGUgY2xlYXJJbnRlcnZhbEltcGxLZWVwKCk6IHZvaWQge1xuICAgIGlmICh0aGlzLmludGVydmFsSGFuZGxlICE9PSBudWxsKSB7XG4gICAgICB0aGlzLmNsZWFySW50ZXJ2YWxJbXBsKHRoaXMuaW50ZXJ2YWxIYW5kbGUpO1xuICAgICAgdGhpcy5pbnRlcnZhbEhhbmRsZSA9IG51bGw7XG4gICAgfVxuICB9XG59XG4iLCAiLyoqXG4gKiBgSHR0cEJsb2JTdG9yZWAgXHUyMDE0IGNvcmUncyBgQmxvYlN0b3JlYCBhZ2FpbnN0IHRoZSB3b3JrZXIncyBgL2Jsb2IvOmhhc2hgXG4gKiByb3V0ZXMgKEFSQ0hJVEVDVFVSRSBcdTAwQTc1IEhUVFBTIHJvdXRlcyksIGF1dGhlbnRpY2F0ZWQgd2l0aCB0aGUgZGV2aWNlIHRva2VuXG4gKiBhcyBhIEJlYXJlciBoZWFkZXIuIEJ1aWx0IG9uIHRoZSBnbG9iYWwgYGZldGNoYCAoT2JzaWRpYW4gZGVza3RvcCBhbmRcbiAqIG1vYmlsZSksIGluamVjdGFibGUgZm9yIHRlc3RzLiBQbHVnaW4tbG9jYWwgdHdpbiBvZiB0aGUgbm9kZS1ydW50aW1lIG9uZTpcbiAqIG5vIGltcG9ydHMgZnJvbSBgQHZzYS9ub2RlLXJ1bnRpbWVgIChOb2RlLW9ubHkgcGFja2FnZSkuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBCbG9iU3RvcmUgfSBmcm9tICdAdnNhL2NvcmUnO1xuXG4vKiogTm9uLTJ4eCBibG9iLXJvdXRlIHJlcGx5LiBgc3RhdHVzYCBpcyB0aGUgSFRUUCBzdGF0dXMgY29kZS4gKi9cbmV4cG9ydCBjbGFzcyBIdHRwQmxvYkVycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBjb25zdHJ1Y3RvcihcbiAgICByZWFkb25seSBzdGF0dXM6IG51bWJlcixcbiAgICBtZXNzYWdlOiBzdHJpbmcsXG4gICkge1xuICAgIHN1cGVyKG1lc3NhZ2UpO1xuICAgIHRoaXMubmFtZSA9ICdIdHRwQmxvYkVycm9yJztcbiAgfVxufVxuXG5leHBvcnQgaW50ZXJmYWNlIEh0dHBCbG9iU3RvcmVPcHRpb25zIHtcbiAgLyoqIFdvcmtlciBvcmlnaW4sIGUuZy4gYGh0dHBzOi8vcGVyc29uYWwueC53b3JrZXJzLmRldmAuICovXG4gIGJhc2VVcmw6IHN0cmluZztcbiAgLyoqIERldmljZSB0b2tlbiAoQmVhcmVyKS4gKi9cbiAgdG9rZW46IHN0cmluZztcbiAgLyoqIEluamVjdGFibGUgZmV0Y2ggKHRlc3RzKS4gRGVmYXVsdHMgdG8gdGhlIGdsb2JhbC4gKi9cbiAgZmV0Y2hJbXBsPzogdHlwZW9mIGZldGNoO1xufVxuXG5leHBvcnQgY2xhc3MgSHR0cEJsb2JTdG9yZSBpbXBsZW1lbnRzIEJsb2JTdG9yZSB7XG4gIHByaXZhdGUgcmVhZG9ubHkgYmFzZTogc3RyaW5nO1xuICBwcml2YXRlIHJlYWRvbmx5IHRva2VuOiBzdHJpbmc7XG4gIHByaXZhdGUgcmVhZG9ubHkgZG9GZXRjaDogdHlwZW9mIGZldGNoO1xuXG4gIGNvbnN0cnVjdG9yKG9wdGlvbnM6IEh0dHBCbG9iU3RvcmVPcHRpb25zKSB7XG4gICAgdGhpcy5iYXNlID0gb3B0aW9ucy5iYXNlVXJsLnJlcGxhY2UoL1xcLyskLywgJycpO1xuICAgIHRoaXMudG9rZW4gPSBvcHRpb25zLnRva2VuO1xuICAgIC8vIEJvdW5kIGxpa2UgdGhlIHBsdWdpbidzIGBmZXRjaEltcGxgIHNlYW06IHRoaXMgY2xhc3MgY2FsbHMgYGRvRmV0Y2hgXG4gICAgLy8gZGV0YWNoZWQsIGFuZCBhIGJhcmUgZ2xvYmFsIGBmZXRjaGAgaXMgYW4gaWxsZWdhbCBpbnZvY2F0aW9uIGluXG4gICAgLy8gQ2hyb21pdW0gcmVuZGVyZXJzIChyZWFsIE9ic2lkaWFuKS5cbiAgICB0aGlzLmRvRmV0Y2ggPSBvcHRpb25zLmZldGNoSW1wbCA/PyBnbG9iYWxUaGlzLmZldGNoLmJpbmQoZ2xvYmFsVGhpcyk7XG4gIH1cblxuICAvKiogR0VUIC9ibG9iLzpoYXNoIFx1MjE5MiBieXRlcywgb3IgYHVuZGVmaW5lZGAgb24gNDA0LiAqL1xuICBhc3luYyBnZXQoaGFzaDogc3RyaW5nKTogUHJvbWlzZTxVaW50OEFycmF5IHwgdW5kZWZpbmVkPiB7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLmRvRmV0Y2goYCR7dGhpcy5iYXNlfS9ibG9iLyR7aGFzaH1gLCB7XG4gICAgICBoZWFkZXJzOiB7IGF1dGhvcml6YXRpb246IGBCZWFyZXIgJHt0aGlzLnRva2VufWAgfSxcbiAgICB9KTtcbiAgICBpZiAocmVzcG9uc2Uuc3RhdHVzID09PSA0MDQpIHJldHVybiB1bmRlZmluZWQ7XG4gICAgaWYgKCFyZXNwb25zZS5vaykge1xuICAgICAgdGhyb3cgbmV3IEh0dHBCbG9iRXJyb3IocmVzcG9uc2Uuc3RhdHVzLCBhd2FpdCBlcnJvck1lc3NhZ2UocmVzcG9uc2UsICdmZXRjaCBibG9iJykpO1xuICAgIH1cbiAgICByZXR1cm4gbmV3IFVpbnQ4QXJyYXkoYXdhaXQgcmVzcG9uc2UuYXJyYXlCdWZmZXIoKSk7XG4gIH1cblxuICAvKiogUFVUIC9ibG9iLzpoYXNoIFx1MjAxNCBpZGVtcG90ZW50IHBlciB0aGUgQ0FTIGNvbnRyYWN0LiAqL1xuICBhc3luYyBwdXQoaGFzaDogc3RyaW5nLCBieXRlczogVWludDhBcnJheSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHJlc3BvbnNlID0gYXdhaXQgdGhpcy5kb0ZldGNoKGAke3RoaXMuYmFzZX0vYmxvYi8ke2hhc2h9YCwge1xuICAgICAgbWV0aG9kOiAnUFVUJyxcbiAgICAgIGhlYWRlcnM6IHtcbiAgICAgICAgYXV0aG9yaXphdGlvbjogYEJlYXJlciAke3RoaXMudG9rZW59YCxcbiAgICAgICAgJ2NvbnRlbnQtdHlwZSc6ICdhcHBsaWNhdGlvbi9vY3RldC1zdHJlYW0nLFxuICAgICAgfSxcbiAgICAgIGJvZHk6IGJ5dGVzIGFzIEJvZHlJbml0LFxuICAgIH0pO1xuICAgIGlmICghcmVzcG9uc2Uub2spIHtcbiAgICAgIHRocm93IG5ldyBIdHRwQmxvYkVycm9yKHJlc3BvbnNlLnN0YXR1cywgYXdhaXQgZXJyb3JNZXNzYWdlKHJlc3BvbnNlLCAnc3RvcmUgYmxvYicpKTtcbiAgICB9XG4gIH1cbn1cblxuYXN5bmMgZnVuY3Rpb24gZXJyb3JNZXNzYWdlKHJlc3BvbnNlOiBSZXNwb25zZSwgd2hhdDogc3RyaW5nKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgY29uc3QgZGV0YWlsID0gKGF3YWl0IHJlc3BvbnNlLnRleHQoKS5jYXRjaCgoKSA9PiAnJykpLnNsaWNlKDAsIDMwMCk7XG4gIHJldHVybiBkZXRhaWwgPT09ICcnXG4gICAgPyBgZmFpbGVkIHRvICR7d2hhdH06IEhUVFAgJHtyZXNwb25zZS5zdGF0dXN9YFxuICAgIDogYGZhaWxlZCB0byAke3doYXR9OiBIVFRQICR7cmVzcG9uc2Uuc3RhdHVzfTogJHtkZXRhaWx9YDtcbn1cbiIsICIvKipcbiAqIERpYWdub3N0aWNzICh0aGUgc2V0dGluZ3MgdGFiJ3MgXCJBZHZhbmNlZCBcdTIxOTIgRGlhZ25vc3RpY3NcIik6IGEgYm91bmRlZCByaW5nXG4gKiBidWZmZXIgb3ZlciB0aGUgcGx1Z2luJ3MgbG9nIHN0cmVhbSB3aXRoIGEgdXNlci1zZWxlY3RhYmxlIG1pbmltdW0gbGV2ZWwsXG4gKiBhIHRyYW5zcG9ydCB3cmFwcGVyIHRoYXQgcmVjb3JkcyBwcm90b2NvbCByb3VuZC10cmlwcyBhdCBkZWJ1ZyBsZXZlbCAobG93XG4gKiB2b2x1bWU6IG9uZSBzaG9ydCBsaW5lIHBlciBmcmFtZSksIGFuZCB0aGUgXCJDb3B5IGRpYWdub3N0aWNzXCIgYnVuZGxlLlxuICpcbiAqIFRoZSBidW5kbGUgaXMgYSBwbGFpbi10ZXh0IHNuYXBzaG90IG1lYW50IGZvciBidWcgcmVwb3J0czogdmVyc2lvbnMsXG4gKiBpZGVudGl0eSwgd29ya2VyLCBhIGNsaWVudCBzdGF0dXMgc25hcHNob3QsIHRoZSBwbGF0Zm9ybSwgYW5kIHRoZSBsYXN0IE5cbiAqIGxvZyBsaW5lcy5cbiAqL1xuXG5pbXBvcnQgeyBQcm90b2NvbFZlcnNpb24gfSBmcm9tICdAdnNhL2NvcmUnO1xuaW1wb3J0IHR5cGUgeyBMb2dBZGFwdGVyLCBTeW5jQ2xpZW50U3RhdHVzLCBUcmFuc3BvcnQgfSBmcm9tICdAdnNhL2NvcmUnO1xuaW1wb3J0IHsgUGxhdGZvcm0gfSBmcm9tICdvYnNpZGlhbic7XG5pbXBvcnQgdHlwZSB7IExvZ0xldmVsIH0gZnJvbSAnLi9kYXRhLmpzJztcblxuLyoqIFNldmVyaXR5IHJhbmtpbmc7IGBlcnJvcmAgYWx3YXlzIG91dHJhbmtzIGV2ZXJ5IHNlbGVjdGFibGUgbGV2ZWwuICovXG5jb25zdCBMRVZFTF9SQU5LOiBSZWNvcmQ8TG9nTGV2ZWwgfCAnZXJyb3InLCBudW1iZXI+ID0geyBkZWJ1ZzogMTAsIGluZm86IDIwLCB3YXJuOiAzMCwgZXJyb3I6IDQwIH07XG5cbi8qKiBMb2cgbGluZXMga2VwdCBmb3IgdGhlIGRpYWdub3N0aWNzIGJ1bmRsZSAodGhlIHNwZWMncyBcImxhc3QgMjBcIikuICovXG5leHBvcnQgY29uc3QgUklOR19DQVBBQ0lUWSA9IDIwO1xuXG4vKiogTWF4IGNoYXJhY3RlcnMgb25lIGFyZ3VtZW50IGNvbnRyaWJ1dGVzIHRvIGEgcmluZyBsaW5lLiAqL1xuY29uc3QgQVJHX01BWF9DSEFSUyA9IDMwMDtcblxuLyoqIEEgYExvZ0FkYXB0ZXJgIHdpdGggYSBsZXZlbCBnYXRlIGFuZCBhIGJvdW5kZWQgcmluZyBidWZmZXIgYXR0YWNoZWQuICovXG5leHBvcnQgaW50ZXJmYWNlIFBsdWdpbkxvZyBleHRlbmRzIExvZ0FkYXB0ZXIge1xuICAvKiogQ2hhbmdlIHRoZSBtaW5pbXVtIHJlY29yZGVkIGxldmVsIGF0IHJ1bnRpbWUgKHRoZSBzZXR0aW5ncyBkcm9wZG93bikuICovXG4gIHNldExldmVsKGxldmVsOiBMb2dMZXZlbCk6IHZvaWQ7XG4gIGdldExldmVsKCk6IExvZ0xldmVsO1xuICAvKiogV2hldGhlciBgZGVidWdgIGNhbGxzIGN1cnJlbnRseSBwYXNzIHRoZSBnYXRlIChyb3VuZC10cmlwIGxvZ2dpbmcgaG9vaykuICovXG4gIGdldCBkZWJ1Z0VuYWJsZWQoKTogYm9vbGVhbjtcbiAgLyoqIFRoZSBtb3N0IHJlY2VudCBsaW5lcywgb2xkZXN0IGZpcnN0IChib3VuZGVkIGJ5IHRoZSBjYXBhY2l0eSkuICovXG4gIHJlY2VudExpbmVzKCk6IHN0cmluZ1tdO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFBsdWdpbkxvZ09wdGlvbnMge1xuICAvKiogUmluZyBjYXBhY2l0eSAoZGVmYXVsdCAyMCkuICovXG4gIGNhcGFjaXR5PzogbnVtYmVyO1xuICAvKiogTWluaW11bSByZWNvcmRlZCBsZXZlbCAoZGVmYXVsdCAnaW5mbycpLiAqL1xuICBsZXZlbD86IExvZ0xldmVsO1xuICAvKiogVGltZXN0YW1wIHNlYW0gKGRlZmF1bHQgYERhdGUubm93YCkuICovXG4gIG5vdz86ICgpID0+IG51bWJlcjtcbn1cblxuLyoqIEJ1aWxkIHRoZSBwbHVnaW4ncyBsb2cgYWRhcHRlcjogY29uc29sZSBtaXJyb3IgKyBib3VuZGVkIHJpbmcgYnVmZmVyLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGNyZWF0ZVBsdWdpbkxvZyhvcHRpb25zOiBQbHVnaW5Mb2dPcHRpb25zID0ge30pOiBQbHVnaW5Mb2cge1xuICBjb25zdCBjYXBhY2l0eSA9IG9wdGlvbnMuY2FwYWNpdHkgPz8gUklOR19DQVBBQ0lUWTtcbiAgY29uc3Qgbm93ID0gb3B0aW9ucy5ub3cgPz8gKCgpID0+IERhdGUubm93KCkpO1xuICBsZXQgbGV2ZWw6IExvZ0xldmVsID0gb3B0aW9ucy5sZXZlbCA/PyAnaW5mbyc7XG4gIGxldCByaW5nOiBzdHJpbmdbXSA9IFtdO1xuXG4gIGNvbnN0IHdyaXRlID0gKHNldmVyaXR5OiBMb2dMZXZlbCB8ICdlcnJvcicsIGFyZ3M6IHJlYWRvbmx5IHVua25vd25bXSk6IHZvaWQgPT4ge1xuICAgIGlmIChMRVZFTF9SQU5LW3NldmVyaXR5XSA8IExFVkVMX1JBTktbbGV2ZWxdKSByZXR1cm47XG4gICAgY29uc3QgbGluZSA9IGAke25ldyBEYXRlKG5vdygpKS50b0lTT1N0cmluZygpfSBbJHtzZXZlcml0eX1dICR7YXJncy5tYXAoZm10KS5qb2luKCcgJyl9YDtcbiAgICByaW5nLnB1c2gobGluZSk7XG4gICAgaWYgKHJpbmcubGVuZ3RoID4gY2FwYWNpdHkpIHJpbmcgPSByaW5nLnNsaWNlKHJpbmcubGVuZ3RoIC0gY2FwYWNpdHkpO1xuICAgIGNvbnN0IHNpbmsgPVxuICAgICAgc2V2ZXJpdHkgPT09ICdlcnJvcicgPyBjb25zb2xlLmVycm9yIDogc2V2ZXJpdHkgPT09ICd3YXJuJyA/IGNvbnNvbGUud2FybiA6IGNvbnNvbGUubG9nO1xuICAgIHNpbmsoJ1t2c2FdJywgLi4uYXJncyk7XG4gIH07XG5cbiAgcmV0dXJuIHtcbiAgICBkZWJ1ZzogKC4uLmFyZ3M6IHVua25vd25bXSkgPT4gd3JpdGUoJ2RlYnVnJywgYXJncyksXG4gICAgaW5mbzogKC4uLmFyZ3M6IHVua25vd25bXSkgPT4gd3JpdGUoJ2luZm8nLCBhcmdzKSxcbiAgICB3YXJuOiAoLi4uYXJnczogdW5rbm93bltdKSA9PiB3cml0ZSgnd2FybicsIGFyZ3MpLFxuICAgIGVycm9yOiAoLi4uYXJnczogdW5rbm93bltdKSA9PiB3cml0ZSgnZXJyb3InLCBhcmdzKSxcbiAgICBzZXRMZXZlbChuZXh0OiBMb2dMZXZlbCk6IHZvaWQge1xuICAgICAgbGV2ZWwgPSBuZXh0O1xuICAgIH0sXG4gICAgZ2V0TGV2ZWwoKTogTG9nTGV2ZWwge1xuICAgICAgcmV0dXJuIGxldmVsO1xuICAgIH0sXG4gICAgZ2V0IGRlYnVnRW5hYmxlZCgpOiBib29sZWFuIHtcbiAgICAgIHJldHVybiBsZXZlbCA9PT0gJ2RlYnVnJztcbiAgICB9LFxuICAgIHJlY2VudExpbmVzKCk6IHN0cmluZ1tdIHtcbiAgICAgIHJldHVybiBbLi4ucmluZ107XG4gICAgfSxcbiAgfTtcbn1cblxuLyoqIE9uZSBsb2cgYXJndW1lbnQgXHUyMTkyIGNvbXBhY3QgdGV4dCAoc3RyaW5ncyBwYXNzIHRocm91Z2gsIGxvbmcgdmFsdWVzIHRydW5jYXRlZCkuICovXG5mdW5jdGlvbiBmbXQodmFsdWU6IHVua25vd24pOiBzdHJpbmcge1xuICBpZiAodHlwZW9mIHZhbHVlID09PSAnc3RyaW5nJykgcmV0dXJuIHRydW5jYXRlKHZhbHVlKTtcbiAgaWYgKHZhbHVlIGluc3RhbmNlb2YgRXJyb3IpIHJldHVybiB0cnVuY2F0ZShgJHt2YWx1ZS5uYW1lfTogJHt2YWx1ZS5tZXNzYWdlfWApO1xuICB0cnkge1xuICAgIHJldHVybiB0cnVuY2F0ZShKU09OLnN0cmluZ2lmeSh2YWx1ZSkgPz8gU3RyaW5nKHZhbHVlKSk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBTdHJpbmcodmFsdWUpO1xuICB9XG59XG5cbmZ1bmN0aW9uIHRydW5jYXRlKHRleHQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHJldHVybiB0ZXh0Lmxlbmd0aCA8PSBBUkdfTUFYX0NIQVJTID8gdGV4dCA6IGAke3RleHQuc2xpY2UoMCwgQVJHX01BWF9DSEFSUyAtIDEpfVx1MjAyNmA7XG59XG5cbi8vIC0tLSBwcm90b2NvbCByb3VuZC10cmlwIGxvZ2dpbmcgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBDb21wYWN0LCBsb3ctdm9sdW1lIGRlc2NyaXB0aW9uIG9mIGEgd2lyZSBmcmFtZSAodHlwZSArIGlkZW50aXR5IGtleXMpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRlc2NyaWJlTWVzc2FnZShtZXNzYWdlOiB7XG4gIHR5cGU6IHN0cmluZztcbiAgcGF0aD86IHN0cmluZztcbiAgaGFzaD86IHN0cmluZztcbiAgZnJvbVBhdGg/OiBzdHJpbmc7XG4gIGN1cnNvcj86IG51bWJlcjtcbiAgc2VxPzogbnVtYmVyO1xufSk6IHN0cmluZyB7XG4gIGNvbnN0IGJpdHMgPSBbbWVzc2FnZS50eXBlXTtcbiAgaWYgKG1lc3NhZ2UuZnJvbVBhdGggIT09IHVuZGVmaW5lZCkgYml0cy5wdXNoKGAke21lc3NhZ2UuZnJvbVBhdGh9IFx1MjE5MmApO1xuICBpZiAobWVzc2FnZS5wYXRoICE9PSB1bmRlZmluZWQpIGJpdHMucHVzaChtZXNzYWdlLnBhdGgpO1xuICBpZiAobWVzc2FnZS5oYXNoICE9PSB1bmRlZmluZWQpIGJpdHMucHVzaChtZXNzYWdlLmhhc2guc2xpY2UoMCwgMTIpKTtcbiAgaWYgKG1lc3NhZ2Uuc2VxICE9PSB1bmRlZmluZWQpIGJpdHMucHVzaChgc2VxICR7bWVzc2FnZS5zZXF9YCk7XG4gIGlmIChtZXNzYWdlLmN1cnNvciAhPT0gdW5kZWZpbmVkKSBiaXRzLnB1c2goYGN1cnNvciAke21lc3NhZ2UuY3Vyc29yfWApO1xuICByZXR1cm4gYml0cy5qb2luKCcgJyk7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUm91bmRUcmlwTG9nZ2luZ09wdGlvbnMge1xuICBsb2c6IExvZ0FkYXB0ZXI7XG4gIC8qKiBDaGVhcCBwcmUtY2hlY2sgc28gdGhlIHN0cmluZyBidWlsZGluZyBpcyBza2lwcGVkIHVubGVzcyBkZWJ1ZyBpcyBvbi4gKi9cbiAgc2hvdWxkTG9nOiAoKSA9PiBib29sZWFuO1xufVxuXG4vKipcbiAqIFdyYXAgYSBgVHJhbnNwb3J0YCBzbyBldmVyeSBzZW50L3JlY2VpdmVkIGZyYW1lIGlzIGxvZ2dlZCBhdCBkZWJ1ZyBsZXZlbCBcdTIwMTRcbiAqIG9uZSBzaG9ydCBsaW5lIHBlciBmcmFtZSAoYGRlc2NyaWJlTWVzc2FnZWApLCBub3RoaW5nIGF0IG90aGVyIGxldmVscy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHdpdGhSb3VuZFRyaXBMb2dnaW5nKFxuICB0cmFuc3BvcnQ6IFRyYW5zcG9ydCxcbiAgb3B0aW9uczogUm91bmRUcmlwTG9nZ2luZ09wdGlvbnMsXG4pOiBUcmFuc3BvcnQge1xuICBjb25zdCB7IGxvZywgc2hvdWxkTG9nIH0gPSBvcHRpb25zO1xuICByZXR1cm4ge1xuICAgIHNlbmQ6IChtZXNzYWdlKSA9PiB7XG4gICAgICBpZiAoc2hvdWxkTG9nKCkpIGxvZy5kZWJ1ZygnXHUyMTkyJywgZGVzY3JpYmVNZXNzYWdlKG1lc3NhZ2UpKTtcbiAgICAgIHRyYW5zcG9ydC5zZW5kKG1lc3NhZ2UpO1xuICAgIH0sXG4gICAgb25NZXNzYWdlOiAoY2FsbGJhY2spID0+IHtcbiAgICAgIHRyYW5zcG9ydC5vbk1lc3NhZ2UoKG1lc3NhZ2UpID0+IHtcbiAgICAgICAgaWYgKHNob3VsZExvZygpKSBsb2cuZGVidWcoJ1x1MjE5MCcsIGRlc2NyaWJlTWVzc2FnZShtZXNzYWdlKSk7XG4gICAgICAgIGNhbGxiYWNrKG1lc3NhZ2UpO1xuICAgICAgfSk7XG4gICAgfSxcbiAgICBvbkNsb3NlOiAoY2FsbGJhY2spID0+IHRyYW5zcG9ydC5vbkNsb3NlKGNhbGxiYWNrKSxcbiAgICBjbG9zZTogKCkgPT4gdHJhbnNwb3J0LmNsb3NlKCksXG4gIH07XG59XG5cbi8vIC0tLSB0aGUgYnVuZGxlIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBpbnRlcmZhY2UgRGlhZ25vc3RpY3NJbnB1dCB7XG4gIHBsdWdpblZlcnNpb246IHN0cmluZztcbiAgZGV2aWNlSWQ6IHN0cmluZztcbiAgZGV2aWNlTmFtZTogc3RyaW5nO1xuICB3b3JrZXJVcmw6IHN0cmluZztcbiAgcGFpcmVkOiBib29sZWFuO1xuICBwYXVzZWQ6IGJvb2xlYW47XG4gIGNsaWVudFN0YXR1czogU3luY0NsaWVudFN0YXR1cyB8IG51bGw7XG4gIHJlY2VudExvZ0xpbmVzOiByZWFkb25seSBzdHJpbmdbXTtcbn1cblxuLyoqIFRoZSBwcm90b2NvbCB2ZXJzaW9uIGZyb20gY29yZSwgc3VyZmFjZWQgZm9yIHRoZSBidW5kbGUvQWJvdXQgc2VjdGlvbi4gKi9cbmV4cG9ydCBjb25zdCBQUk9UT0NPTF9WRVJTSU9OID0gUHJvdG9jb2xWZXJzaW9uO1xuXG4vKiogVGhlIGNvcHlhYmxlIGRpYWdub3N0aWNzIGJ1bmRsZSAocGxhaW4gdGV4dCwgYnVnLXJlcG9ydCBmcmllbmRseSkuICovXG5leHBvcnQgZnVuY3Rpb24gYnVpbGREaWFnbm9zdGljc0J1bmRsZShpbnB1dDogRGlhZ25vc3RpY3NJbnB1dCk6IHN0cmluZyB7XG4gIGNvbnN0IHN0YXR1cyA9IGlucHV0LmNsaWVudFN0YXR1cztcbiAgY29uc3QgbGluZXM6IHN0cmluZ1tdID0gW1xuICAgICdWYXVsdFN5bmMgZm9yIEFnZW50cyBcdTIwMTQgZGlhZ25vc3RpY3MnLFxuICAgIGBQbHVnaW4gdmVyc2lvbjogJHtpbnB1dC5wbHVnaW5WZXJzaW9ufWAsXG4gICAgYFByb3RvY29sIHZlcnNpb246ICR7UHJvdG9jb2xWZXJzaW9ufWAsXG4gICAgYERldmljZTogJHtpbnB1dC5kZXZpY2VJZCB8fCAnKHVuYXNzaWduZWQpJ30ke2lucHV0LmRldmljZU5hbWUgPyBgICgke2lucHV0LmRldmljZU5hbWV9KWAgOiAnJ31gLFxuICAgIGBXb3JrZXI6ICR7aW5wdXQud29ya2VyVXJsIHx8ICcobm90IGNvbmZpZ3VyZWQpJ31gLFxuICAgIGBQYWlyaW5nOiAke2lucHV0LnBhaXJlZCA/ICdwYWlyZWQnIDogJ25vdCBwYWlyZWQnfWAsXG4gICAgaW5wdXQucGF1c2VkXG4gICAgICA/ICdTeW5jOiBwYXVzZWQnXG4gICAgICA6IHN0YXR1cyA9PT0gbnVsbFxuICAgICAgICA/ICdTeW5jOiBub3QgcnVubmluZydcbiAgICAgICAgOiBgU3luYzogJHtzdGF0dXMuc3RhdGV9LCBsYXN0IHN5bmMgJHtcbiAgICAgICAgICAgIHN0YXR1cy5sYXN0U3luY0F0ID09PSBudWxsID8gJ25ldmVyJyA6IGAke01hdGgubWF4KDAsIERhdGUubm93KCkgLSBzdGF0dXMubGFzdFN5bmNBdCl9bXMgYWdvYFxuICAgICAgICAgIH0sIHBlbmRpbmcgJHtzdGF0dXMucGVuZGluZ30sIGNvbmZsaWN0cyAke3N0YXR1cy5jb25mbGljdHMubGVuZ3RofWAsXG4gICAgYFBsYXRmb3JtOiAke3BsYXRmb3JtU3VtbWFyeSgpfWAsXG4gICAgYFJlY2VudCBsb2cgKGxhc3QgJHtpbnB1dC5yZWNlbnRMb2dMaW5lcy5sZW5ndGh9IGxpbmVzKTpgLFxuICBdO1xuICBpZiAoaW5wdXQucmVjZW50TG9nTGluZXMubGVuZ3RoID09PSAwKSB7XG4gICAgbGluZXMucHVzaCgnICAobm8gcmVjb3JkZWQgbG9nIGxpbmVzKScpO1xuICB9IGVsc2Uge1xuICAgIGZvciAoY29uc3QgbGluZSBvZiBpbnB1dC5yZWNlbnRMb2dMaW5lcykgbGluZXMucHVzaChgICAke2xpbmV9YCk7XG4gIH1cbiAgcmV0dXJuIGxpbmVzLmpvaW4oJ1xcbicpO1xufVxuXG4vKiogSHVtYW4gcGxhdGZvcm0gc3VtbWFyeSBmcm9tIGBQbGF0Zm9ybWAgKG1vYmlsZSB2cyBkZXNrdG9wLCBPUywgZm9ybSBmYWN0b3IpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHBsYXRmb3JtU3VtbWFyeSgpOiBzdHJpbmcge1xuICBpZiAoUGxhdGZvcm0uaXNNb2JpbGVBcHApIHtcbiAgICBjb25zdCBvcyA9IFBsYXRmb3JtLmlzSW9zQXBwID8gJ2lPUycgOiBQbGF0Zm9ybS5pc0FuZHJvaWRBcHAgPyAnQW5kcm9pZCcgOiAndW5rbm93biBPUyc7XG4gICAgY29uc3QgZmFjdG9yID0gUGxhdGZvcm0uaXNUYWJsZXQgPyAndGFibGV0JyA6IFBsYXRmb3JtLmlzUGhvbmUgPyAncGhvbmUnIDogJ2RldmljZSc7XG4gICAgcmV0dXJuIGBPYnNpZGlhbiBtb2JpbGUgYXBwICgke29zfSwgJHtmYWN0b3J9KWA7XG4gIH1cbiAgcmV0dXJuICdPYnNpZGlhbiBkZXNrdG9wIGFwcCc7XG59XG5cbi8qKiBCZXN0LWVmZm9ydCBjbGlwYm9hcmQgd3JpdGU7IHJlc29sdmVzIGZhbHNlIHdoZXJlIHRoZSBjbGlwYm9hcmQgaXMgdW5hdmFpbGFibGUuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY29weVRvQ2xpcGJvYXJkKHRleHQ6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICBjb25zdCBjbGlwYm9hcmQgPSAoZ2xvYmFsVGhpcyBhcyB7IG5hdmlnYXRvcj86IHsgY2xpcGJvYXJkPzogeyB3cml0ZVRleHQ/KHQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4gfSB9IH0pXG4gICAgLm5hdmlnYXRvcj8uY2xpcGJvYXJkO1xuICBpZiAoY2xpcGJvYXJkPy53cml0ZVRleHQgPT09IHVuZGVmaW5lZCkgcmV0dXJuIGZhbHNlO1xuICB0cnkge1xuICAgIGF3YWl0IGNsaXBib2FyZC53cml0ZVRleHQodGV4dCk7XG4gICAgcmV0dXJuIHRydWU7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBmYWxzZTtcbiAgfVxufVxuXG4vKiogQnl0ZXMgXHUyMTkyIGh1bWFuIHRleHQgKGA3MzAgQmAsIGAxLjIgTUJgKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBmb3JtYXRCeXRlcyhieXRlczogbnVtYmVyKTogc3RyaW5nIHtcbiAgaWYgKGJ5dGVzIDwgMTAyNCkgcmV0dXJuIGAke2J5dGVzfSBCYDtcbiAgY29uc3QgdW5pdHMgPSBbJ0tCJywgJ01CJywgJ0dCJywgJ1RCJ107XG4gIGxldCB2YWx1ZSA9IGJ5dGVzO1xuICBsZXQgdW5pdCA9IC0xO1xuICBkbyB7XG4gICAgdmFsdWUgLz0gMTAyNDtcbiAgICB1bml0ICs9IDE7XG4gIH0gd2hpbGUgKHZhbHVlID49IDEwMjQgJiYgdW5pdCA8IHVuaXRzLmxlbmd0aCAtIDEpO1xuICByZXR1cm4gYCR7dmFsdWUgPj0gMTAwID8gTWF0aC5yb3VuZCh2YWx1ZSkgOiB2YWx1ZS50b0ZpeGVkKDEpfSAke3VuaXRzW3VuaXRdfWA7XG59XG4iLCAiLyoqXG4gKiBUaGUgcGx1Z2luJ3MgcGVyc2lzdGVkIHN0YXRlIChgZGF0YS5qc29uYCwgdmlhIGBQbHVnaW4ubG9hZERhdGEvc2F2ZURhdGFgKS5cbiAqXG4gKiBLZXB0IGRlbGliZXJhdGVseSBzbWFsbDogbGluayBpZGVudGl0eSAodXJsL3Rva2VuL2RldmljZUlkL2RldmljZU5hbWUpIHBsdXNcbiAqIHRoZSB0d28gY2xpZW50LXNpZGUgdG9nZ2xlcy4gVGhlIHRva2VuIGlzIHRoZSBkZXZpY2UncyBsb25nLWxpdmVkXG4gKiBjcmVkZW50aWFsIChBUkNISVRFQ1RVUkUgXHUwMEE3MykgXHUyMDE0IE9ic2lkaWFuIHN0b3JlcyBkYXRhLmpzb24gaW5zaWRlIHRoZSB2YXVsdCdzXG4gKiBgLm9ic2lkaWFuL3BsdWdpbnMvYCBkaXIsIHdoaWNoIHN5bmMgZXhjbHVkZXMsIHNvIGl0IG5ldmVyIGxlYXZlcyB0aGVcbiAqIG1hY2hpbmUgdGhyb3VnaCBzeW5jIGl0c2VsZi5cbiAqL1xuXG5pbXBvcnQgeyBQbGF0Zm9ybSB9IGZyb20gJ29ic2lkaWFuJztcbmltcG9ydCB0eXBlIHsgU3RhdHVzQmFyTW9kZSB9IGZyb20gJy4vc3RhdHVzYmFyLmpzJztcblxuLyoqIERpYWdub3N0aWNzIGxvZyBsZXZlbCAodGhlIFwiRGlhZ25vc3RpY3NcIiBzZXR0aW5ncyBkcm9wZG93bikuICovXG5leHBvcnQgdHlwZSBMb2dMZXZlbCA9ICdpbmZvJyB8ICdkZWJ1ZycgfCAnd2Fybic7XG5cbi8qKiBDbGllbnQtc2lkZSBzeW5jIGJlaGF2aW9yIHNldHRpbmdzICh0aGUgc2V0dGluZ3MtdGFiIHRvZ2dsZXMpLiAqL1xuZXhwb3J0IGludGVyZmFjZSBQbHVnaW5TeW5jU2V0dGluZ3Mge1xuICAvKipcbiAgICogUGVyaW9kaWMgZnVsbC1yZXNjYW4gaW50ZXJ2YWwgaW4gc2Vjb25kcyAoQVJDSElURUNUVVJFIFx1MDBBNzggbW9iaWxlIC9cbiAgICogZXh0ZXJuYWwgZWRpdHMpLiBgMGAgZGlzYWJsZXMgdGhlIHRpbWVyIFx1MjAxNCB2YXVsdCBldmVudHMgYW5kIGFwcC1vcGVuXG4gICAqIHJlY29uY2lsaWF0aW9uIHN0aWxsIHJ1bi5cbiAgICovXG4gIHJlc2NhbkludGVydmFsU2VjOiBudW1iZXI7XG4gIC8qKlxuICAgKiBPcHQgaW4gdG8gc3luY2luZyBgLm9ic2lkaWFuL2AgKEZSLTExKS4gVGhpcyBpcyB0aGUgY2xpZW50LXNpZGUgaW5pdGlhbFxuICAgKiBpZ25vcmUgc2V0dGluZzsgdGhlIHdvcmtlcidzIHBlci12YXVsdCBgVmF1bHRTZXR0aW5ncy5vYnNpZGlhblN5bmNgXG4gICAqIChkZWxpdmVyZWQgaW4gYGhlbGxvQWNrYCkgc3VwZXJzZWRlcyBpdCBvbmNlIGNvbm5lY3RlZC5cbiAgICovXG4gIG9ic2lkaWFuU3luYzogYm9vbGVhbjtcbiAgLyoqIFN0YXR1cy1iYXIgaW5kaWNhdG9yOiBmdWxsIHRleHQsIGEgY29tcGFjdCBzeW1ib2wsIG9yIG5vIGl0ZW0gYXQgYWxsLiAqL1xuICBzdGF0dXNCYXJNb2RlOiBTdGF0dXNCYXJNb2RlO1xuICAvKipcbiAgICogU3RhcnQgc3luY2luZyB3aGVuIE9ic2lkaWFuIGxvYWRzIChkZWZhdWx0KS4gT0ZGID0gbWFudWFsLW9ubHkgbW9kZTogdGhlXG4gICAqIHBsdWdpbiBsb2FkcyBpZGxlIGFuZCB0aGUgZmlyc3QgXCJTeW5jIG5vd1wiIHN0YXJ0cyBpdC5cbiAgICovXG4gIHN5bmNPblN0YXJ0dXA6IGJvb2xlYW47XG4gIC8qKiBEaWFnbm9zdGljcyBsb2cgbGV2ZWw7IGBkZWJ1Z2AgYWxzbyBsb2dzIHByb3RvY29sIHJvdW5kLXRyaXBzLiAqL1xuICBsb2dMZXZlbDogTG9nTGV2ZWw7XG4gIC8qKiBSYXcgaWdub3JlLXBhdHRlcm4gdGV4dCwgb25lIHBhdHRlcm4gcGVyIGxpbmUgKHNlZSBgcGFyc2VJZ25vcmVQYXR0ZXJuc2ApLiAqL1xuICBpZ25vcmVQYXR0ZXJuczogc3RyaW5nO1xufVxuXG4vKiogU2hhcGUgb2YgdGhlIHBsdWdpbidzIGBkYXRhLmpzb25gLiAqL1xuZXhwb3J0IGludGVyZmFjZSBWYXVsdFN5bmNQbHVnaW5EYXRhIHtcbiAgLyoqIFdvcmtlciBvcmlnaW4sIGUuZy4gYGh0dHBzOi8vcGVyc29uYWwueC53b3JrZXJzLmRldmAgKGVtcHR5IHByZS1wYWlyKS4gKi9cbiAgdXJsOiBzdHJpbmc7XG4gIC8qKiBMb25nLWxpdmVkIGRldmljZSB0b2tlbiAoZW1wdHkgcHJlLXBhaXIpLiAqL1xuICB0b2tlbjogc3RyaW5nO1xuICAvKiogRGV2aWNlIGlkIGFzc2lnbmVkIGJ5IHRoZSB3b3JrZXIgYXQgcGFpciB0aW1lLiAqL1xuICBkZXZpY2VJZDogc3RyaW5nO1xuICAvKiogSHVtYW4tcmVhZGFibGUgZGV2aWNlIG5hbWUgc2hvd24gaW4gdGhlIGRhc2hib2FyZCdzIGRldmljZSBsaXN0LiAqL1xuICBkZXZpY2VOYW1lOiBzdHJpbmc7XG4gIHNldHRpbmdzOiBQbHVnaW5TeW5jU2V0dGluZ3M7XG59XG5cbmV4cG9ydCBjb25zdCBERUZBVUxUX1JFU0NBTl9JTlRFUlZBTF9TRUMgPSAzMDtcblxuLyoqIENob2ljZXMgb2ZmZXJlZCBieSB0aGUgc2V0dGluZ3MgZHJvcGRvd246IHNlY29uZHMgXHUyMTkyIGxhYmVsLiAqL1xuZXhwb3J0IGNvbnN0IFJFU0NBTl9JTlRFUlZBTF9DSE9JQ0VTOiBSZWFkb25seUFycmF5PHsgdmFsdWU6IG51bWJlcjsgbGFiZWw6IHN0cmluZyB9PiA9IFtcbiAgeyB2YWx1ZTogMTAsIGxhYmVsOiAnRXZlcnkgMTAgc2Vjb25kcycgfSxcbiAgeyB2YWx1ZTogMzAsIGxhYmVsOiAnRXZlcnkgMzAgc2Vjb25kcycgfSxcbiAgeyB2YWx1ZTogNjAsIGxhYmVsOiAnRXZlcnkgbWludXRlJyB9LFxuICB7IHZhbHVlOiAzMDAsIGxhYmVsOiAnRXZlcnkgNSBtaW51dGVzJyB9LFxuICB7IHZhbHVlOiAwLCBsYWJlbDogJ09mZiAodmF1bHQgZXZlbnRzIG9ubHkpJyB9LFxuXTtcblxuZXhwb3J0IGZ1bmN0aW9uIGRlZmF1bHRQbHVnaW5EYXRhKCk6IFZhdWx0U3luY1BsdWdpbkRhdGEge1xuICByZXR1cm4ge1xuICAgIHVybDogJycsXG4gICAgdG9rZW46ICcnLFxuICAgIGRldmljZUlkOiAnJyxcbiAgICBkZXZpY2VOYW1lOiAnJyxcbiAgICBzZXR0aW5nczoge1xuICAgICAgcmVzY2FuSW50ZXJ2YWxTZWM6IERFRkFVTFRfUkVTQ0FOX0lOVEVSVkFMX1NFQyxcbiAgICAgIG9ic2lkaWFuU3luYzogZmFsc2UsXG4gICAgICBzdGF0dXNCYXJNb2RlOiAnZGV0YWlsZWQnLFxuICAgICAgc3luY09uU3RhcnR1cDogdHJ1ZSxcbiAgICAgIGxvZ0xldmVsOiAnaW5mbycsXG4gICAgICBpZ25vcmVQYXR0ZXJuczogJycsXG4gICAgfSxcbiAgfTtcbn1cblxuLyoqIENvZXJjZSB3aGF0ZXZlciBgbG9hZERhdGEoKWAgcmV0dXJuZWQgaW50byBhIHdlbGwtZm9ybWVkIG9iamVjdC4gKi9cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVQbHVnaW5EYXRhKHJhdzogdW5rbm93bik6IFZhdWx0U3luY1BsdWdpbkRhdGEge1xuICBjb25zdCBiYXNlID0gZGVmYXVsdFBsdWdpbkRhdGEoKTtcbiAgaWYgKHR5cGVvZiByYXcgIT09ICdvYmplY3QnIHx8IHJhdyA9PT0gbnVsbCkgcmV0dXJuIGJhc2U7XG4gIGNvbnN0IHNvdXJjZSA9IHJhdyBhcyBQYXJ0aWFsPFZhdWx0U3luY1BsdWdpbkRhdGE+ICYgeyBzZXR0aW5ncz86IFBhcnRpYWw8UGx1Z2luU3luY1NldHRpbmdzPiB9O1xuICBjb25zdCBzdGF0dXNCYXJNb2RlID0gc291cmNlLnNldHRpbmdzPy5zdGF0dXNCYXJNb2RlO1xuICBjb25zdCBsb2dMZXZlbCA9IHNvdXJjZS5zZXR0aW5ncz8ubG9nTGV2ZWw7XG4gIHJldHVybiB7XG4gICAgdXJsOiB0eXBlb2Ygc291cmNlLnVybCA9PT0gJ3N0cmluZycgPyBzb3VyY2UudXJsIDogJycsXG4gICAgdG9rZW46IHR5cGVvZiBzb3VyY2UudG9rZW4gPT09ICdzdHJpbmcnID8gc291cmNlLnRva2VuIDogJycsXG4gICAgZGV2aWNlSWQ6IHR5cGVvZiBzb3VyY2UuZGV2aWNlSWQgPT09ICdzdHJpbmcnID8gc291cmNlLmRldmljZUlkIDogJycsXG4gICAgZGV2aWNlTmFtZTogdHlwZW9mIHNvdXJjZS5kZXZpY2VOYW1lID09PSAnc3RyaW5nJyA/IHNvdXJjZS5kZXZpY2VOYW1lIDogJycsXG4gICAgc2V0dGluZ3M6IHtcbiAgICAgIHJlc2NhbkludGVydmFsU2VjOlxuICAgICAgICB0eXBlb2Ygc291cmNlLnNldHRpbmdzPy5yZXNjYW5JbnRlcnZhbFNlYyA9PT0gJ251bWJlcicgJiYgc291cmNlLnNldHRpbmdzLnJlc2NhbkludGVydmFsU2VjID49IDBcbiAgICAgICAgICA/IE1hdGguZmxvb3Ioc291cmNlLnNldHRpbmdzLnJlc2NhbkludGVydmFsU2VjKVxuICAgICAgICAgIDogREVGQVVMVF9SRVNDQU5fSU5URVJWQUxfU0VDLFxuICAgICAgb2JzaWRpYW5TeW5jOiBzb3VyY2Uuc2V0dGluZ3M/Lm9ic2lkaWFuU3luYyA9PT0gdHJ1ZSxcbiAgICAgIHN0YXR1c0Jhck1vZGU6XG4gICAgICAgIHN0YXR1c0Jhck1vZGUgPT09ICdjb21wYWN0JyB8fCBzdGF0dXNCYXJNb2RlID09PSAnaGlkZGVuJyA/IHN0YXR1c0Jhck1vZGUgOiAnZGV0YWlsZWQnLFxuICAgICAgc3luY09uU3RhcnR1cDogc291cmNlLnNldHRpbmdzPy5zeW5jT25TdGFydHVwICE9PSBmYWxzZSxcbiAgICAgIGxvZ0xldmVsOiBsb2dMZXZlbCA9PT0gJ2RlYnVnJyB8fCBsb2dMZXZlbCA9PT0gJ3dhcm4nID8gbG9nTGV2ZWwgOiAnaW5mbycsXG4gICAgICBpZ25vcmVQYXR0ZXJuczogdHlwZW9mIHNvdXJjZS5zZXR0aW5ncz8uaWdub3JlUGF0dGVybnMgPT09ICdzdHJpbmcnID8gc291cmNlLnNldHRpbmdzLmlnbm9yZVBhdHRlcm5zIDogJycsXG4gICAgfSxcbiAgfTtcbn1cblxuLyoqXG4gKiBJZ25vcmUtcGF0dGVybiB0ZXh0IFx1MjE5MiBwYXR0ZXJuIGxpc3Q6IG9uZSBwYXR0ZXJuIHBlciBsaW5lLCB0cmltbWVkLCBibGFua1xuICogbGluZXMgZHJvcHBlZC4gUHVyZSBcdTIwMTQgc2FmZSB0byBjYWxsIG9uIGV2ZXJ5IGBzdGFydFN5bmNgLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VJZ25vcmVQYXR0ZXJucyh0ZXh0OiBzdHJpbmcpOiBzdHJpbmdbXSB7XG4gIHJldHVybiB0ZXh0XG4gICAgLnNwbGl0KC9cXHI/XFxuLylcbiAgICAubWFwKChsaW5lKSA9PiBsaW5lLnRyaW0oKSlcbiAgICAuZmlsdGVyKChsaW5lKSA9PiBsaW5lICE9PSAnJyk7XG59XG5cbi8qKiBBIHZhdWx0IGlzIGxpbmtlZCBpZmYgcGFpciBpZGVudGl0eSBpcyBjb21wbGV0ZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0xpbmtlZChkYXRhOiBWYXVsdFN5bmNQbHVnaW5EYXRhKTogYm9vbGVhbiB7XG4gIHJldHVybiBkYXRhLnVybCAhPT0gJycgJiYgZGF0YS50b2tlbiAhPT0gJycgJiYgZGF0YS5kZXZpY2VJZCAhPT0gJyc7XG59XG5cbi8qKiBEZXZpY2UgdHlwZSBmb3IgdGhlIHdvcmtlciByZWdpc3RyeSwgZnJvbSB0aGUgcGxhdGZvcm0gKEZSLTIzKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkZXRlY3REZXZpY2VUeXBlKCk6ICdkZXNrdG9wJyB8ICdtb2JpbGUnIHtcbiAgcmV0dXJuIFBsYXRmb3JtLmlzTW9iaWxlQXBwID8gJ21vYmlsZScgOiAnZGVza3RvcCc7XG59XG5cbi8qKiBEZWZhdWx0IGRldmljZSBuYW1lIHdoZW4gdGhlIHVzZXIgaGFzIG5vdCB0eXBlZCBvbmUuICovXG5leHBvcnQgZnVuY3Rpb24gZGVmYXVsdERldmljZU5hbWUoKTogc3RyaW5nIHtcbiAgaWYgKFBsYXRmb3JtLmlzTW9iaWxlQXBwKSB7XG4gICAgaWYgKFBsYXRmb3JtLmlzSW9zQXBwKSByZXR1cm4gJ2lQaG9uZS9pUGFkJztcbiAgICBpZiAoUGxhdGZvcm0uaXNBbmRyb2lkQXBwKSByZXR1cm4gJ0FuZHJvaWQnO1xuICAgIHJldHVybiAnT2JzaWRpYW4gbW9iaWxlJztcbiAgfVxuICByZXR1cm4gJ09ic2lkaWFuIGRlc2t0b3AnO1xufVxuIiwgIi8qKlxuICogTWluaW1hbCB0eXBlZCBjbGllbnQgZm9yIHRoZSB3b3JrZXIncyBIVFRQIHN1cmZhY2UgYXMgdGhlIHBsdWdpbiB1c2VzIGl0OlxuICogYEdFVCAvaGVhbHRoYCAoY2xhaW0tc3RhdGUgcHJvYmUgYmVmb3JlIHBhaXJpbmcpLCBgUE9TVCAvcGFpcmAgKHJlZGVlbSBhXG4gKiBwYWlyaW5nIGNvZGUsIEFSQ0hJVEVDVFVSRSBcdTAwQTczKSwgYFBBVENIIC9kZXZpY2VgIChkZXZpY2Ugc2VsZi1zZXJ2aWNlXG4gKiByZW5hbWUpLCBhbmQgYEdFVCAvYXBpL3N0YXR1c2AgKHN0b3JhZ2UvZGV2aWNlIHN1bW1hcnkgZm9yIEFib3V0KS4gQnVpbHRcbiAqIG9uIGFuIGluamVjdGFibGUgYGZldGNoYDsgZmFpbHVyZXMgbWFwIHRvIHR5cGVkIGVycm9ycyB3aXRoIGFjdGlvbmFibGVcbiAqIG1lc3NhZ2VzIHNvIHRoZSBzZXR0aW5ncyBVSSBhbmQgdGhlIGRlZXAtbGluayBoYW5kbGVyIG5ldmVyIHNlZSBhIHJhd1xuICogYFR5cGVFcnJvcjogRmFpbGVkIHRvIGZldGNoYC5cbiAqL1xuXG4vKiogQSB3b3JrZXIgY2FsbCBmYWlsZWQgKHVucmVhY2hhYmxlIG9yIHVuZXhwZWN0ZWQgSFRUUCkuICovXG5leHBvcnQgY2xhc3MgV29ya2VyQXBpRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIGNvbnN0cnVjdG9yKFxuICAgIG1lc3NhZ2U6IHN0cmluZyxcbiAgICByZWFkb25seSBzdGF0dXM/OiBudW1iZXIsXG4gICkge1xuICAgIHN1cGVyKG1lc3NhZ2UpO1xuICAgIHRoaXMubmFtZSA9ICdXb3JrZXJBcGlFcnJvcic7XG4gIH1cbn1cblxuLyoqIFRoZSBwYWlyaW5nIGNvZGUgd2FzIHJlamVjdGVkIChpbnZhbGlkIC8gZXhwaXJlZCAvIGFscmVhZHkgdXNlZCkuICovXG5leHBvcnQgY2xhc3MgUGFpclJlamVjdGVkRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIGNvbnN0cnVjdG9yKG1lc3NhZ2U6IHN0cmluZykge1xuICAgIHN1cGVyKG1lc3NhZ2UpO1xuICAgIHRoaXMubmFtZSA9ICdQYWlyUmVqZWN0ZWRFcnJvcic7XG4gIH1cbn1cblxuLyoqIFRoZSB3b3JrZXIgZXhpc3RzIGJ1dCBoYXMgbm90IGJlZW4gY2xhaW1lZCB5ZXQgKEhUVFAgNDIxIHNlbWFudGljcykuICovXG5leHBvcnQgY2xhc3MgVW5jbGFpbWVkV29ya2VyRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIGNvbnN0cnVjdG9yKG1lc3NhZ2U6IHN0cmluZykge1xuICAgIHN1cGVyKG1lc3NhZ2UpO1xuICAgIHRoaXMubmFtZSA9ICdVbmNsYWltZWRXb3JrZXJFcnJvcic7XG4gIH1cbn1cblxuZXhwb3J0IGludGVyZmFjZSBIZWFsdGhJbmZvIHtcbiAgcmVhY2hhYmxlOiBib29sZWFuO1xuICBjbGFpbWVkOiBib29sZWFuO1xuICAvKiogSHVtYW4tcmVhZGFibGUgcmVhc29uIHdoZW4gdGhlIHdvcmtlciBjb3VsZCBub3QgYmUgcmVhY2hlZC4gKi9cbiAgcmVhc29uPzogc3RyaW5nO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFBhaXJDcmVkZW50aWFscyB7XG4gIHRva2VuOiBzdHJpbmc7XG4gIGRldmljZUlkOiBzdHJpbmc7XG59XG5cbi8qKlxuICogTm9ybWFsaXplIHVzZXIgaW5wdXQgaW50byBhIHdvcmtlciBvcmlnaW46IHRyaW1zLCB0b2xlcmF0ZXMgYSBtaXNzaW5nXG4gKiBzY2hlbWUgKGFzc3VtZXMgaHR0cHMpLCBhIHRyYWlsaW5nIHNsYXNoLCBhbmQgc3RyYXkgcGF0aCBjb21wb25lbnRzO1xuICogcmV0dXJucyBgaHR0cHM6Ly9ob3N0YCBzdHlsZSBvcmlnaW4uIFRocm93cyBgV29ya2VyQXBpRXJyb3JgIG9uIGdhcmJhZ2UuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVXb3JrZXJVcmwoaW5wdXQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIGxldCBjYW5kaWRhdGUgPSBpbnB1dC50cmltKCk7XG4gIGlmIChjYW5kaWRhdGUgPT09ICcnKSB0aHJvdyBuZXcgV29ya2VyQXBpRXJyb3IoJ3dvcmtlciBVUkwgaXMgZW1wdHknKTtcbiAgaWYgKCEvXlthLXpBLVpdW2EtekEtWjAtOSsuLV0qOlxcL1xcLy8udGVzdChjYW5kaWRhdGUpKSBjYW5kaWRhdGUgPSBgaHR0cHM6Ly8ke2NhbmRpZGF0ZX1gO1xuICBsZXQgb3JpZ2luOiBzdHJpbmc7XG4gIHRyeSB7XG4gICAgb3JpZ2luID0gbmV3IFVSTChjYW5kaWRhdGUpLm9yaWdpbjtcbiAgfSBjYXRjaCB7XG4gICAgdGhyb3cgbmV3IFdvcmtlckFwaUVycm9yKGBpbnZhbGlkIHdvcmtlciBVUkw6ICR7SlNPTi5zdHJpbmdpZnkoaW5wdXQpfWApO1xuICB9XG4gIGlmICghb3JpZ2luLnN0YXJ0c1dpdGgoJ2h0dHA6Ly8nKSAmJiAhb3JpZ2luLnN0YXJ0c1dpdGgoJ2h0dHBzOi8vJykpIHtcbiAgICB0aHJvdyBuZXcgV29ya2VyQXBpRXJyb3IoYHdvcmtlciBVUkwgbXVzdCBiZSBodHRwKHMpLCBnb3QgJHtvcmlnaW59YCk7XG4gIH1cbiAgcmV0dXJuIG9yaWdpbjtcbn1cblxuLyoqIEdFVCAvaGVhbHRoIFx1MjAxNCBuZXZlciB0aHJvd3MgZm9yIHJlYWNoYWJpbGl0eTsgcmVwb3J0cyBjbGFpbSBzdGF0ZSBpbnN0ZWFkLiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGZldGNoSGVhbHRoKFxuICBvcmlnaW46IHN0cmluZyxcbiAgZmV0Y2hJbXBsOiB0eXBlb2YgZmV0Y2gsXG4pOiBQcm9taXNlPEhlYWx0aEluZm8+IHtcbiAgbGV0IHJlc3BvbnNlOiBSZXNwb25zZTtcbiAgdHJ5IHtcbiAgICByZXNwb25zZSA9IGF3YWl0IGZldGNoSW1wbChgJHtvcmlnaW59L2hlYWx0aGApO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIHJldHVybiB7XG4gICAgICByZWFjaGFibGU6IGZhbHNlLFxuICAgICAgY2xhaW1lZDogZmFsc2UsXG4gICAgICByZWFzb246IGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKSxcbiAgICB9O1xuICB9XG4gIGlmICghcmVzcG9uc2Uub2spIHtcbiAgICByZXR1cm4geyByZWFjaGFibGU6IGZhbHNlLCBjbGFpbWVkOiBmYWxzZSwgcmVhc29uOiBgSFRUUCAke3Jlc3BvbnNlLnN0YXR1c31gIH07XG4gIH1cbiAgY29uc3QgYm9keSA9IChhd2FpdCByZXNwb25zZS5qc29uKCkuY2F0Y2goKCkgPT4gKHt9KSkpIGFzIHsgY2xhaW1lZD86IGJvb2xlYW4gfTtcbiAgcmV0dXJuIHsgcmVhY2hhYmxlOiB0cnVlLCBjbGFpbWVkOiBib2R5LmNsYWltZWQgPT09IHRydWUgfTtcbn1cblxuZXhwb3J0IGludGVyZmFjZSBQYWlyUmVxdWVzdFBhcmFtcyB7XG4gIG9yaWdpbjogc3RyaW5nO1xuICBjb2RlOiBzdHJpbmc7XG4gIGRldmljZU5hbWU6IHN0cmluZztcbiAgZGV2aWNlVHlwZTogJ2Rlc2t0b3AnIHwgJ21vYmlsZSc7XG4gIGZldGNoSW1wbDogdHlwZW9mIGZldGNoO1xufVxuXG4vKipcbiAqIFBPU1QgL3BhaXIgXHUyMDE0IHJlZGVlbSBhIG9uZS10aW1lIHBhaXJpbmcgY29kZSBmb3IgbG9uZy1saXZlZCBkZXZpY2VcbiAqIGNyZWRlbnRpYWxzLiBUaHJvd3MgYFBhaXJSZWplY3RlZEVycm9yYCAoYmFkIGNvZGUpLCBgVW5jbGFpbWVkV29ya2VyRXJyb3JgXG4gKiAoNDIxKSwgb3IgYFdvcmtlckFwaUVycm9yYCAodW5yZWFjaGFibGUgLyB1bmV4cGVjdGVkKS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlcXVlc3RQYWlyKHBhcmFtczogUGFpclJlcXVlc3RQYXJhbXMpOiBQcm9taXNlPFBhaXJDcmVkZW50aWFscz4ge1xuICBsZXQgcmVzcG9uc2U6IFJlc3BvbnNlO1xuICB0cnkge1xuICAgIHJlc3BvbnNlID0gYXdhaXQgcGFyYW1zLmZldGNoSW1wbChgJHtwYXJhbXMub3JpZ2lufS9wYWlyYCwge1xuICAgICAgbWV0aG9kOiAnUE9TVCcsXG4gICAgICBoZWFkZXJzOiB7ICdjb250ZW50LXR5cGUnOiAnYXBwbGljYXRpb24vanNvbicgfSxcbiAgICAgIGJvZHk6IEpTT04uc3RyaW5naWZ5KHtcbiAgICAgICAgY29kZTogcGFyYW1zLmNvZGUsXG4gICAgICAgIGRldmljZU5hbWU6IHBhcmFtcy5kZXZpY2VOYW1lLFxuICAgICAgICBkZXZpY2VUeXBlOiBwYXJhbXMuZGV2aWNlVHlwZSxcbiAgICAgIH0pLFxuICAgIH0pO1xuICB9IGNhdGNoIChlcnJvcikge1xuICAgIHRocm93IG5ldyBXb3JrZXJBcGlFcnJvcihcbiAgICAgIGBjb3VsZCBub3QgcmVhY2ggdGhlIHdvcmtlciBhdCAke3BhcmFtcy5vcmlnaW59OiAke1xuICAgICAgICBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcilcbiAgICAgIH1gLFxuICAgICk7XG4gIH1cbiAgLy8gUmVhZCB0aGUgYm9keSBvbmNlIChhIFJlc3BvbnNlIGJvZHkgaXMgc2luZ2xlLXVzZSkgYW5kIHBhcnNlIGZyb20gdGV4dC5cbiAgY29uc3QgZGV0YWlsID0gKGF3YWl0IHJlc3BvbnNlLnRleHQoKS5jYXRjaCgoKSA9PiAnJykpLnRyaW0oKTtcbiAgaWYgKHJlc3BvbnNlLnN0YXR1cyA9PT0gNDIxKSB7XG4gICAgdGhyb3cgbmV3IFVuY2xhaW1lZFdvcmtlckVycm9yKCd0aGlzIHdvcmtlciBoYXMgbm90IGJlZW4gY2xhaW1lZCB5ZXQnKTtcbiAgfVxuICBpZiAocmVzcG9uc2Uuc3RhdHVzID09PSA0MDEgfHwgcmVzcG9uc2Uuc3RhdHVzID09PSA0MDMpIHtcbiAgICB0aHJvdyBuZXcgUGFpclJlamVjdGVkRXJyb3IoXG4gICAgICAncGFpcmluZyBjb2RlIHJlamVjdGVkIFx1MjAxNCBjb2RlcyBhcmUgb25lLXRpbWUsIGV4cGlyZSBhZnRlciAxMCBtaW51dGVzLCBhbmQgY29tZSAnICtcbiAgICAgICAgJ2Zyb20gdGhlIHdvcmtlciBkYXNoYm9hcmQuIEdlbmVyYXRlIGEgZnJlc2ggb25lIGFuZCByZXRyeS4nLFxuICAgICk7XG4gIH1cbiAgaWYgKCFyZXNwb25zZS5vaykge1xuICAgIHRocm93IG5ldyBXb3JrZXJBcGlFcnJvcihcbiAgICAgIGBwYWlyaW5nIGZhaWxlZDogSFRUUCAke3Jlc3BvbnNlLnN0YXR1c30gJHtkZXRhaWwuc2xpY2UoMCwgMjAwKX1gLnRyaW0oKSxcbiAgICAgIHJlc3BvbnNlLnN0YXR1cyxcbiAgICApO1xuICB9XG4gIGxldCBib2R5OiB7IHRva2VuPzogdW5rbm93bjsgZGV2aWNlSWQ/OiB1bmtub3duIH07XG4gIHRyeSB7XG4gICAgYm9keSA9IEpTT04ucGFyc2UoZGV0YWlsKSBhcyB7IHRva2VuPzogdW5rbm93bjsgZGV2aWNlSWQ/OiB1bmtub3duIH07XG4gIH0gY2F0Y2gge1xuICAgIHRocm93IG5ldyBXb3JrZXJBcGlFcnJvcigncGFpcmluZyByZXBseSB3YXMgbm90IEpTT04nLCByZXNwb25zZS5zdGF0dXMpO1xuICB9XG4gIGlmICh0eXBlb2YgYm9keS50b2tlbiAhPT0gJ3N0cmluZycgfHwgdHlwZW9mIGJvZHkuZGV2aWNlSWQgIT09ICdzdHJpbmcnKSB7XG4gICAgdGhyb3cgbmV3IFdvcmtlckFwaUVycm9yKCdwYWlyaW5nIHJlcGx5IHdhcyBtaXNzaW5nIHRva2VuL2RldmljZUlkJywgcmVzcG9uc2Uuc3RhdHVzKTtcbiAgfVxuICByZXR1cm4geyB0b2tlbjogYm9keS50b2tlbiwgZGV2aWNlSWQ6IGJvZHkuZGV2aWNlSWQgfTtcbn1cblxuLy8gLS0tIGRldmljZSBzZWxmLXNlcnZpY2UgKFBBVENIIC9kZXZpY2UpIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBUaGUgZGV2aWNlIGRvY3VtZW50IHRoZSB3b3JrZXIgcmV0dXJucyBmcm9tIGBQQVRDSCAvZGV2aWNlYC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgV29ya2VyRGV2aWNlIHtcbiAgaWQ6IHN0cmluZztcbiAgbmFtZTogc3RyaW5nO1xuICB0eXBlOiBzdHJpbmc7XG59XG5cbmV4cG9ydCB0eXBlIFJlbmFtZU91dGNvbWUgPVxuICB8IHsgb2s6IHRydWU7IGRldmljZTogV29ya2VyRGV2aWNlIH1cbiAgfCB7IG9rOiBmYWxzZTsgZXJyb3I6IHN0cmluZyB9O1xuXG5leHBvcnQgaW50ZXJmYWNlIFJlbmFtZVBhcmFtcyB7XG4gIG9yaWdpbjogc3RyaW5nO1xuICAvKiogVGhlIGNhbGxpbmcgZGV2aWNlJ3Mgb3duIHRva2VuIFx1MjAxNCBpdCBjYW4gb25seSBldmVyIHJlbmFtZSBpdHNlbGYuICovXG4gIHRva2VuOiBzdHJpbmc7XG4gIG5hbWU6IHN0cmluZztcbiAgZmV0Y2hJbXBsOiB0eXBlb2YgZmV0Y2g7XG59XG5cbi8qKlxuICogYFBBVENIIC9kZXZpY2VgIFx1MjAxNCByZW5hbWUgVEhJUyBkZXZpY2Ugb24gdGhlIHdvcmtlciAoZGV2aWNlLXRva2VuXG4gKiBhdXRoZW50aWNhdGVkOyBuZXZlciB0aHJvd3M6IGZhaWx1cmVzIGNvbWUgYmFjayBhcyBge29rOmZhbHNlLCBlcnJvcn1gKS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHJlbmFtZURldmljZShwYXJhbXM6IFJlbmFtZVBhcmFtcyk6IFByb21pc2U8UmVuYW1lT3V0Y29tZT4ge1xuICBsZXQgcmVzcG9uc2U6IFJlc3BvbnNlO1xuICB0cnkge1xuICAgIHJlc3BvbnNlID0gYXdhaXQgcGFyYW1zLmZldGNoSW1wbChgJHtwYXJhbXMub3JpZ2lufS9kZXZpY2VgLCB7XG4gICAgICBtZXRob2Q6ICdQQVRDSCcsXG4gICAgICBoZWFkZXJzOiB7ICdjb250ZW50LXR5cGUnOiAnYXBwbGljYXRpb24vanNvbicsIGF1dGhvcml6YXRpb246IGBCZWFyZXIgJHtwYXJhbXMudG9rZW59YCB9LFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoeyBuYW1lOiBwYXJhbXMubmFtZSB9KSxcbiAgICB9KTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICByZXR1cm4ge1xuICAgICAgb2s6IGZhbHNlLFxuICAgICAgZXJyb3I6IGBjb3VsZCBub3QgcmVhY2ggdGhlIHdvcmtlciBhdCAke3BhcmFtcy5vcmlnaW59OiAke1xuICAgICAgICBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcilcbiAgICAgIH1gLFxuICAgIH07XG4gIH1cbiAgY29uc3QgZGV0YWlsID0gKGF3YWl0IHJlc3BvbnNlLnRleHQoKS5jYXRjaCgoKSA9PiAnJykpLnRyaW0oKTtcbiAgaWYgKHJlc3BvbnNlLnN0YXR1cyA9PT0gNDIxKSB7XG4gICAgcmV0dXJuIHsgb2s6IGZhbHNlLCBlcnJvcjogJ3RoaXMgd29ya2VyIGhhcyBub3QgYmVlbiBjbGFpbWVkIHlldCcgfTtcbiAgfVxuICBpZiAocmVzcG9uc2Uuc3RhdHVzID09PSA0MDEgfHwgcmVzcG9uc2Uuc3RhdHVzID09PSA0MDMpIHtcbiAgICByZXR1cm4ge1xuICAgICAgb2s6IGZhbHNlLFxuICAgICAgZXJyb3I6ICd0aGUgd29ya2VyIHJlamVjdGVkIHRoaXMgZGV2aWNlXFx1MjAxOXMgdG9rZW4gKHJldm9rZWQ/KSBcdTIwMTQgdW5saW5rIGFuZCByZS1wYWlyIHdpdGggYSBmcmVzaCBjb2RlLicsXG4gICAgfTtcbiAgfVxuICBpZiAoIXJlc3BvbnNlLm9rKSB7XG4gICAgbGV0IHJlYXNvbiA9IGBIVFRQICR7cmVzcG9uc2Uuc3RhdHVzfWA7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHBhcnNlZCA9IEpTT04ucGFyc2UoZGV0YWlsKSBhcyB7IGVycm9yPzogdW5rbm93biB9O1xuICAgICAgaWYgKHR5cGVvZiBwYXJzZWQuZXJyb3IgPT09ICdzdHJpbmcnKSByZWFzb24gPSBwYXJzZWQuZXJyb3I7XG4gICAgfSBjYXRjaCB7XG4gICAgICAvLyBrZWVwIHRoZSBiYXJlIHN0YXR1c1xuICAgIH1cbiAgICByZXR1cm4geyBvazogZmFsc2UsIGVycm9yOiByZWFzb24gfTtcbiAgfVxuICBsZXQgYm9keTogeyBkZXZpY2U/OiB1bmtub3duIH07XG4gIHRyeSB7XG4gICAgYm9keSA9IEpTT04ucGFyc2UoZGV0YWlsKSBhcyB7IGRldmljZT86IHVua25vd24gfTtcbiAgfSBjYXRjaCB7XG4gICAgcmV0dXJuIHsgb2s6IGZhbHNlLCBlcnJvcjogJ3JlbmFtZSByZXBseSB3YXMgbm90IEpTT04nIH07XG4gIH1cbiAgY29uc3QgZGV2aWNlID0gYm9keS5kZXZpY2UgYXMgUGFydGlhbDxXb3JrZXJEZXZpY2U+IHwgdW5kZWZpbmVkO1xuICBpZiAoXG4gICAgdHlwZW9mIGRldmljZT8uaWQgIT09ICdzdHJpbmcnIHx8XG4gICAgdHlwZW9mIGRldmljZS5uYW1lICE9PSAnc3RyaW5nJyB8fFxuICAgIHR5cGVvZiBkZXZpY2UudHlwZSAhPT0gJ3N0cmluZydcbiAgKSB7XG4gICAgcmV0dXJuIHsgb2s6IGZhbHNlLCBlcnJvcjogJ3JlbmFtZSByZXBseSB3YXMgbWlzc2luZyB0aGUgZGV2aWNlIGRvY3VtZW50JyB9O1xuICB9XG4gIHJldHVybiB7IG9rOiB0cnVlLCBkZXZpY2U6IHsgaWQ6IGRldmljZS5pZCwgbmFtZTogZGV2aWNlLm5hbWUsIHR5cGU6IGRldmljZS50eXBlIH0gfTtcbn1cblxuLy8gLS0tIHdvcmtlciBzdGF0dXMgKEdFVCAvYXBpL3N0YXR1cywgZGV2aWNlIHRva2VuKSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4vKiogVGhlIHNsaWNlIG9mIGAvYXBpL3N0YXR1c2AgdGhlIHBsdWdpbidzIEFib3V0IHNlY3Rpb24gc2hvd3MuICovXG5leHBvcnQgaW50ZXJmYWNlIFdvcmtlclN0YXR1c1N1bW1hcnkge1xuICB2YXVsdE5hbWU6IHN0cmluZztcbiAgZGV2aWNlczogQXJyYXk8eyBpZDogc3RyaW5nOyBuYW1lOiBzdHJpbmc7IHR5cGU6IHN0cmluZzsgb25saW5lOiBib29sZWFuOyByZXZva2VkOiBib29sZWFuIH0+O1xuICBhdHRhY2htZW50czogeyBjb3VudDogbnVtYmVyOyBieXRlczogbnVtYmVyIH07XG4gIHN0b3JhZ2VCeXRlczogbnVtYmVyO1xufVxuXG4vKipcbiAqIGBHRVQgL2FwaS9zdGF0dXNgIHdpdGggdGhlIGRldmljZSB0b2tlbiBcdTIwMTQgc3RvcmFnZSB1c2FnZSArIGRldmljZSBsaXN0IGZvclxuICogdGhlIEFib3V0IHNlY3Rpb24uIFJlc29sdmVzIGBudWxsYCBvbiBhbnkgZmFpbHVyZSAoQWJvdXQgc2hvd3MgXCJ1bmtub3duXCIpLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZmV0Y2hXb3JrZXJTdGF0dXMocGFyYW1zOiB7XG4gIG9yaWdpbjogc3RyaW5nO1xuICB0b2tlbjogc3RyaW5nO1xuICBmZXRjaEltcGw6IHR5cGVvZiBmZXRjaDtcbn0pOiBQcm9taXNlPFdvcmtlclN0YXR1c1N1bW1hcnkgfCBudWxsPiB7XG4gIGxldCByZXNwb25zZTogUmVzcG9uc2U7XG4gIHRyeSB7XG4gICAgcmVzcG9uc2UgPSBhd2FpdCBwYXJhbXMuZmV0Y2hJbXBsKGAke3BhcmFtcy5vcmlnaW59L2FwaS9zdGF0dXNgLCB7XG4gICAgICBoZWFkZXJzOiB7IGF1dGhvcml6YXRpb246IGBCZWFyZXIgJHtwYXJhbXMudG9rZW59YCB9LFxuICAgIH0pO1xuICB9IGNhdGNoIHtcbiAgICByZXR1cm4gbnVsbDtcbiAgfVxuICBpZiAoIXJlc3BvbnNlLm9rKSByZXR1cm4gbnVsbDtcbiAgY29uc3QgYm9keSA9IChhd2FpdCByZXNwb25zZS5qc29uKCkuY2F0Y2goKCkgPT4gbnVsbCkpIGFzIFBhcnRpYWw8V29ya2VyU3RhdHVzU3VtbWFyeT4gfCBudWxsO1xuICBpZiAoYm9keSA9PT0gbnVsbCB8fCB0eXBlb2YgYm9keS5zdG9yYWdlQnl0ZXMgIT09ICdudW1iZXInIHx8IHR5cGVvZiBib2R5LmF0dGFjaG1lbnRzICE9PSAnb2JqZWN0Jykge1xuICAgIHJldHVybiBudWxsO1xuICB9XG4gIHJldHVybiB7XG4gICAgdmF1bHROYW1lOiB0eXBlb2YgYm9keS52YXVsdE5hbWUgPT09ICdzdHJpbmcnID8gYm9keS52YXVsdE5hbWUgOiAnJyxcbiAgICBkZXZpY2VzOiBBcnJheS5pc0FycmF5KGJvZHkuZGV2aWNlcykgPyBib2R5LmRldmljZXMgOiBbXSxcbiAgICBhdHRhY2htZW50czogYm9keS5hdHRhY2htZW50cyxcbiAgICBzdG9yYWdlQnl0ZXM6IGJvZHkuc3RvcmFnZUJ5dGVzLFxuICB9O1xufVxuIiwgIi8qKlxuICogVGhlIHBhaXIgZmxvdyBzaGFyZWQgYnkgdGhlIHNldHRpbmdzIGZvcm0gYW5kIHRoZSBgb2JzaWRpYW46Ly9gIGRlZXAgbGlua1xuICogKEFSQ0hJVEVDVFVSRSBcdTAwQTczKTogcHJvYmUgYEdFVCAvaGVhbHRoYCBmaXJzdCBcdTIwMTQgYW4gKnVuY2xhaW1lZCogd29ya2VyIGdldHNcbiAqIGZyaWVuZGx5IG9uYm9hcmRpbmcgZ3VpZGFuY2UgaW5zdGVhZCBvZiBhIGNyeXB0aWMgNDIxIFx1MjAxNCB0aGVuIGBQT1NUIC9wYWlyYFxuICogYW5kIGhhbmQgdGhlIGNyZWRlbnRpYWxzIGJhY2sgdG8gYmUgcGVyc2lzdGVkLlxuICovXG5cbmltcG9ydCB7XG4gIGZldGNoSGVhbHRoLFxuICBub3JtYWxpemVXb3JrZXJVcmwsXG4gIHJlcXVlc3RQYWlyLFxuICBQYWlyUmVqZWN0ZWRFcnJvcixcbiAgVW5jbGFpbWVkV29ya2VyRXJyb3IsXG4gIFdvcmtlckFwaUVycm9yLFxufSBmcm9tICcuL3dvcmtlcmFwaS5qcyc7XG5cbmV4cG9ydCB0eXBlIFBhaXJPdXRjb21lID1cbiAgfCB7IHN0YXR1czogJ3BhaXJlZCc7IHVybDogc3RyaW5nOyB0b2tlbjogc3RyaW5nOyBkZXZpY2VJZDogc3RyaW5nIH1cbiAgfCB7IHN0YXR1czogJ3VuY2xhaW1lZCc7IHVybDogc3RyaW5nOyBndWlkYW5jZTogc3RyaW5nIH1cbiAgfCB7IHN0YXR1czogJ3VucmVhY2hhYmxlJzsgdXJsOiBzdHJpbmc7IHJlYXNvbjogc3RyaW5nIH1cbiAgfCB7IHN0YXR1czogJ3JlamVjdGVkJzsgdXJsOiBzdHJpbmc7IHJlYXNvbjogc3RyaW5nIH1cbiAgfCB7IHN0YXR1czogJ2ludmFsaWQtdXJsJzsgaW5wdXQ6IHN0cmluZyB9O1xuXG5leHBvcnQgaW50ZXJmYWNlIFBhaXJGbG93UGFyYW1zIHtcbiAgLyoqIFdvcmtlciBVUkwgYXMgdHlwZWQgLyBkZWVwLWxpbmtlZCAoc2NoZW1lbGVzcyBpcyB0b2xlcmF0ZWQpLiAqL1xuICB1cmw6IHN0cmluZztcbiAgLyoqIE9uZS10aW1lIHBhaXJpbmcgY29kZSBmcm9tIHRoZSB3b3JrZXIgZGFzaGJvYXJkLiAqL1xuICBjb2RlOiBzdHJpbmc7XG4gIGRldmljZU5hbWU6IHN0cmluZztcbiAgZGV2aWNlVHlwZTogJ2Rlc2t0b3AnIHwgJ21vYmlsZSc7XG4gIGZldGNoSW1wbDogdHlwZW9mIGZldGNoO1xufVxuXG4vKiogT25ib2FyZGluZyB0ZXh0IHNob3duIHdoZW4gdGhlIHdvcmtlciBpcyBkZXBsb3llZCBidXQgbm90IGNsYWltZWQuICovXG5leHBvcnQgZnVuY3Rpb24gdW5jbGFpbWVkR3VpZGFuY2UodXJsOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gW1xuICAgIGBUaGUgd29ya2VyIGF0ICR7dXJsfSBpcyBkZXBsb3llZCBidXQgbm90IGNsYWltZWQgeWV0LiBGaW5pc2ggc2V0dXAgaW4gYSBicm93c2VyOmAsXG4gICAgJycsXG4gICAgYDEuIE9wZW4gJHt1cmx9YCxcbiAgICAnMi4gU2V0IHRoZSBhZG1pbiBwYXNzcGhyYXNlIGFuZCBuYW1lIHRoZSB2YXVsdCAodGhlIGNsYWltIHBhZ2UpLicsXG4gICAgJzMuIE9uIHRoZSBkYXNoYm9hcmQsIGNyZWF0ZSBhIHBhaXJpbmcgY29kZSAoRGV2aWNlcyBcdTIxOTIgUGFpciBuZXcgZGV2aWNlKS4nLFxuICAgICc0LiBFbnRlciB0aGF0IGNvZGUgaGVyZSAob3IgY2xpY2sgdGhlIG9ic2lkaWFuOi8vIGxpbmsgdGhlIGRhc2hib2FyZCBzaG93cykgYW5kIHBhaXIuJyxcbiAgXS5qb2luKCdcXG4nKTtcbn1cblxuLyoqXG4gKiBSdW4gdGhlIHBhaXIgZmxvdy4gTmV2ZXIgdGhyb3dzIFx1MjAxNCBldmVyeSBmYWlsdXJlIG1vZGUgaXMgYSB0eXBlZCBvdXRjb21lIHRoZVxuICogVUkgY2FuIHJlbmRlciAoYW5kIHRoZSBkZWVwLWxpbmsgaGFuZGxlciBjYW4gdHVybiBpbnRvIGEgTm90aWNlKS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHBhaXJXaXRoV29ya2VyKHBhcmFtczogUGFpckZsb3dQYXJhbXMpOiBQcm9taXNlPFBhaXJPdXRjb21lPiB7XG4gIGxldCBvcmlnaW46IHN0cmluZztcbiAgdHJ5IHtcbiAgICBvcmlnaW4gPSBub3JtYWxpemVXb3JrZXJVcmwocGFyYW1zLnVybCk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiB7IHN0YXR1czogJ2ludmFsaWQtdXJsJywgaW5wdXQ6IHBhcmFtcy51cmwgfTtcbiAgfVxuXG4gIGNvbnN0IGhlYWx0aCA9IGF3YWl0IGZldGNoSGVhbHRoKG9yaWdpbiwgcGFyYW1zLmZldGNoSW1wbCk7XG4gIGlmICghaGVhbHRoLnJlYWNoYWJsZSkge1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0dXM6ICd1bnJlYWNoYWJsZScsXG4gICAgICB1cmw6IG9yaWdpbixcbiAgICAgIHJlYXNvbjpcbiAgICAgICAgYCR7aGVhbHRoLnJlYXNvbiA/PyAndW5rbm93biBlcnJvcid9IFx1MjAxNCBjaGVjayB0aGUgVVJMLCB5b3VyIG5ldHdvcmssIGFuZCB0aGF0IHRoZSBgICtcbiAgICAgICAgJ3dvcmtlciBpcyBkZXBsb3llZC4nLFxuICAgIH07XG4gIH1cbiAgaWYgKCFoZWFsdGguY2xhaW1lZCkge1xuICAgIHJldHVybiB7IHN0YXR1czogJ3VuY2xhaW1lZCcsIHVybDogb3JpZ2luLCBndWlkYW5jZTogdW5jbGFpbWVkR3VpZGFuY2Uob3JpZ2luKSB9O1xuICB9XG5cbiAgdHJ5IHtcbiAgICBjb25zdCBjcmVkZW50aWFscyA9IGF3YWl0IHJlcXVlc3RQYWlyKHtcbiAgICAgIG9yaWdpbixcbiAgICAgIGNvZGU6IHBhcmFtcy5jb2RlLFxuICAgICAgZGV2aWNlTmFtZTogcGFyYW1zLmRldmljZU5hbWUsXG4gICAgICBkZXZpY2VUeXBlOiBwYXJhbXMuZGV2aWNlVHlwZSxcbiAgICAgIGZldGNoSW1wbDogcGFyYW1zLmZldGNoSW1wbCxcbiAgICB9KTtcbiAgICByZXR1cm4geyBzdGF0dXM6ICdwYWlyZWQnLCB1cmw6IG9yaWdpbiwgLi4uY3JlZGVudGlhbHMgfTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBVbmNsYWltZWRXb3JrZXJFcnJvcikge1xuICAgICAgcmV0dXJuIHsgc3RhdHVzOiAndW5jbGFpbWVkJywgdXJsOiBvcmlnaW4sIGd1aWRhbmNlOiB1bmNsYWltZWRHdWlkYW5jZShvcmlnaW4pIH07XG4gICAgfVxuICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIFBhaXJSZWplY3RlZEVycm9yKSB7XG4gICAgICByZXR1cm4geyBzdGF0dXM6ICdyZWplY3RlZCcsIHVybDogb3JpZ2luLCByZWFzb246IGVycm9yLm1lc3NhZ2UgfTtcbiAgICB9XG4gICAgY29uc3QgcmVhc29uID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpO1xuICAgIHJldHVybiB7IHN0YXR1czogJ3JlamVjdGVkJywgdXJsOiBvcmlnaW4sIHJlYXNvbiB9O1xuICB9XG59XG5cbi8qKiBSZW5kZXIgYW55IG91dGNvbWUgYXMgdXNlci1mYWNpbmcgdGV4dCAoTm90aWNlcywgZGVlcC1saW5rIGZlZWRiYWNrKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYWlyT3V0Y29tZU1lc3NhZ2Uob3V0Y29tZTogUGFpck91dGNvbWUpOiBzdHJpbmcge1xuICBzd2l0Y2ggKG91dGNvbWUuc3RhdHVzKSB7XG4gICAgY2FzZSAncGFpcmVkJzpcbiAgICAgIHJldHVybiBgUGFpcmVkIHdpdGggJHtvdXRjb21lLnVybH0gXHUyMDE0IHN5bmNpbmcgbm93LmA7XG4gICAgY2FzZSAndW5jbGFpbWVkJzpcbiAgICAgIHJldHVybiBvdXRjb21lLmd1aWRhbmNlO1xuICAgIGNhc2UgJ3VucmVhY2hhYmxlJzpcbiAgICAgIHJldHVybiBgQ291bGQgbm90IHJlYWNoIHRoZSB3b3JrZXI6ICR7b3V0Y29tZS5yZWFzb259YDtcbiAgICBjYXNlICdyZWplY3RlZCc6XG4gICAgICByZXR1cm4gYFBhaXJpbmcgZmFpbGVkOiAke291dGNvbWUucmVhc29ufWA7XG4gICAgY2FzZSAnaW52YWxpZC11cmwnOlxuICAgICAgcmV0dXJuIGBUaGF0IGRvZXMgbm90IGxvb2sgbGlrZSBhIHdvcmtlciBVUkw6ICR7SlNPTi5zdHJpbmdpZnkob3V0Y29tZS5pbnB1dCl9YDtcbiAgfVxufVxuIiwgIi8qKlxuICogYG9ic2lkaWFuOi8vdmF1bHRzeW5jZm9yYWdlbnRzL3BhaXI/dXJsPTx3b3JrZXI+JmNvZGU9PHBhaXJpbmc+YCBkZWVwLWxpbmtcbiAqIGhhbmRsaW5nIChBUkNISVRFQ1RVUkUgXHUwMEE3Myk6IHRoZSBkYXNoYm9hcmQgcmVuZGVycyB0aGlzIGxpbmsgKGFuZCB0aGUgUVJcbiAqIGVxdWl2YWxlbnQpIHNvIGEgbmV3IGRldmljZSBwYWlycyB3aXRoIHplcm8gdHlwaW5nLlxuICpcbiAqIFRoZSBoYW5kbGVyIGlzIHJlZ2lzdGVyZWQgZm9yIHRoZSBhY3Rpb24gYHZhdWx0c3luY2ZvcmFnZW50c2AuIE9ic2lkaWFuXG4gKiBidWlsZHMgZGlmZmVyIHN1YnRseSBpbiBob3cgdGhlIGAvcGFpcmAgcGF0aCBzZWdtZW50IG9mIGEgcHJvdG9jb2wgVVJMIGlzXG4gKiBtYXRjaGVkLCBzbyB0aGUgc2FtZSBoYW5kbGVyIGlzIHJlZ2lzdGVyZWQgZm9yIGB2YXVsdHN5bmNmb3JhZ2VudHMvcGFpcmBcbiAqIHRvbyBcdTIwMTQgd2hpY2hldmVyIHNwZWxsaW5nIGEgZ2l2ZW4gYnVpbGQgcmVzb2x2ZXMsIHRoZSBsaW5rIHdvcmtzLiBXaGVuXG4gKiBgdXJsYC9gY29kZWAgYXJlIGFic2VudCB0aGUgaW52b2NhdGlvbiBpcyBpZ25vcmVkIChhIHN0cmF5IHByb3RvY29sIGhpdFxuICogbXVzdCBub3Qgc3BhbSBhIE5vdGljZSk7IGEgKm1hbGZvcm1lZCogcGFpciBsaW5rIChvbmUgb2YgdGhlIHR3byBwcmVzZW50KVxuICogZ2V0cyBhbiBhY3Rpb25hYmxlIGVycm9yLlxuICovXG5cbmltcG9ydCB7IE5vdGljZSB9IGZyb20gJ29ic2lkaWFuJztcblxuLyoqIFByb3RvY29sIGFjdGlvbiAodGhlIGBvYnNpZGlhbjovL2AgXCJob3N0XCIgcGFydCkuICovXG5leHBvcnQgY29uc3QgUFJPVE9DT0xfQUNUSU9OID0gJ3ZhdWx0c3luY2ZvcmFnZW50cyc7XG5cbi8qKiBIYW5kbGVyIHNoYXBlIChPYnNpZGlhbiBwYXNzZXMgaXRzIGRlY29kZWQgcXVlcnkgcGFyYW1zKS4gKi9cbmV4cG9ydCB0eXBlIFByb3RvY29sSGFuZGxlciA9IChwYXJhbXM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSA9PiB2b2lkO1xuXG4vKiogSG93IGhhbmRsZXJzIGdldCByZWdpc3RlcmVkIFx1MjAxNCBgUGx1Z2luLnJlZ2lzdGVyT2JzaWRpYW5Qcm90b2NvbEhhbmRsZXJgLiAqL1xuZXhwb3J0IHR5cGUgUHJvdG9jb2xSZWdpc3RyYXIgPSAoYWN0aW9uOiBzdHJpbmcsIGhhbmRsZXI6IFByb3RvY29sSGFuZGxlcikgPT4gdm9pZDtcblxuLyoqIFBhcnNlZCBwYWlyIGRlZXAgbGluay4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUGFpckRlZXBMaW5rIHtcbiAgdXJsOiBzdHJpbmc7XG4gIGNvZGU6IHN0cmluZztcbn1cblxuZXhwb3J0IHR5cGUgRGVlcExpbmtQYXJzZVJlc3VsdCA9XG4gIHwgeyBvazogdHJ1ZTsgbGluazogUGFpckRlZXBMaW5rIH1cbiAgfCB7IG9rOiBmYWxzZTsgZXJyb3I6IHN0cmluZyB9O1xuXG4vKipcbiAqIEV4dHJhY3QgYHt1cmwsIGNvZGV9YCBmcm9tIE9ic2lkaWFuJ3MgZGVjb2RlZCBxdWVyeSBwYXJhbXMuIFZhbHVlcyBhcnJpdmVcbiAqIGFzIHN0cmluZ3MgKHVzdWFsbHkgYWxyZWFkeSBkZWNvZGVkOyBhIGRvdWJsZS1lbmNvZGVkIGAleHhgIHJlbW5hbnQgaXNcbiAqIGRlY29kZWQgb25jZSBtb3JlLCBiZXN0IGVmZm9ydCkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZVBhaXJEZWVwTGluayhwYXJhbXM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogRGVlcExpbmtQYXJzZVJlc3VsdCB7XG4gIGNvbnN0IHVybCA9IHBhcmFtVGV4dChwYXJhbXMsICd1cmwnKTtcbiAgY29uc3QgY29kZSA9IHBhcmFtVGV4dChwYXJhbXMsICdjb2RlJyk7XG4gIGlmICh1cmwgPT09ICcnICYmIGNvZGUgPT09ICcnKSB7XG4gICAgcmV0dXJuIHsgb2s6IGZhbHNlLCBlcnJvcjogJ25vIHBhaXJpbmcgcGFyYW1ldGVycycgfTtcbiAgfVxuICBpZiAodXJsID09PSAnJykgcmV0dXJuIHsgb2s6IGZhbHNlLCBlcnJvcjogJ2RlZXAgbGluayBpcyBtaXNzaW5nIHRoZSB3b3JrZXIgVVJMICg/dXJsPVx1MjAyNiknIH07XG4gIGlmIChjb2RlID09PSAnJykgcmV0dXJuIHsgb2s6IGZhbHNlLCBlcnJvcjogJ2RlZXAgbGluayBpcyBtaXNzaW5nIHRoZSBwYWlyaW5nIGNvZGUgKD9jb2RlPVx1MjAyNiknIH07XG4gIHJldHVybiB7IG9rOiB0cnVlLCBsaW5rOiB7IHVybCwgY29kZSB9IH07XG59XG5cbmZ1bmN0aW9uIHBhcmFtVGV4dChwYXJhbXM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBrZXk6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHZhbHVlID0gcGFyYW1zW2tleV07XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdudW1iZXInKSByZXR1cm4gU3RyaW5nKHZhbHVlKTtcbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gJ3N0cmluZycpIHJldHVybiAnJztcbiAgY29uc3QgdHJpbW1lZCA9IHZhbHVlLnRyaW0oKTtcbiAgLy8gT2JzaWRpYW4gaGFuZHMgb3ZlciBkZWNvZGVkIHZhbHVlczsgdG9sZXJhdGUgb25lIHN1cnZpdmluZyByb3VuZCBvZlxuICAvLyBwZXJjZW50LWVuY29kaW5nIGZyb20gb3Zlci1lYWdlciBsaW5rIGdlbmVyYXRvcnMuXG4gIGlmICh0cmltbWVkLmluY2x1ZGVzKCclJykpIHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGRlY29kZVVSSUNvbXBvbmVudCh0cmltbWVkKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiB0cmltbWVkO1xuICAgIH1cbiAgfVxuICByZXR1cm4gdHJpbW1lZDtcbn1cblxuLyoqXG4gKiBSZWdpc3RlciB0aGUgcGFpciBkZWVwLWxpbmsgaGFuZGxlciAoY2FsbCBmcm9tIGBvbmxvYWRgIHdpdGggdGhlIHBsdWdpbidzXG4gKiBvd24gcmVnaXN0cmFyKS4gYG9uUGFpcmAgcnVucyB0aGUgc2hhcmVkIHBhaXIgZmxvdyAoc2V0dGluZ3MgKyBOb3RpY2VzXG4gKiBsaXZlIGluIHRoZSBwbHVnaW4pOyBpdHMgZXJyb3JzIGFyZSBsb2dnZWQsIG5ldmVyIGZhdGFsLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVnaXN0ZXJQYWlyUHJvdG9jb2xIYW5kbGVyKFxuICByZWdpc3RlcjogUHJvdG9jb2xSZWdpc3RyYXIsXG4gIG9uUGFpcjogKGxpbms6IFBhaXJEZWVwTGluaykgPT4gUHJvbWlzZTx2b2lkPixcbik6IHZvaWQge1xuICBjb25zdCBoYW5kbGVyOiBQcm90b2NvbEhhbmRsZXIgPSAocGFyYW1zKSA9PiB7XG4gICAgY29uc3QgcGFyc2VkID0gcGFyc2VQYWlyRGVlcExpbmsocGFyYW1zKTtcbiAgICBpZiAoIXBhcnNlZC5vaykge1xuICAgICAgLy8gTWlzc2luZyBib3RoIFx1MjE5MiBhIGJhcmUgb2JzaWRpYW46Ly92YXVsdHN5bmNmb3JhZ2VudHMgaGl0OyBzdGF5IHF1aWV0LlxuICAgICAgaWYgKHBhcnNlZC5lcnJvciAhPT0gJ25vIHBhaXJpbmcgcGFyYW1ldGVycycpIHtcbiAgICAgICAgbmV3IE5vdGljZShgVmF1bHRTeW5jIGRlZXAgbGluazogJHtwYXJzZWQuZXJyb3J9YCk7XG4gICAgICB9XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHZvaWQgb25QYWlyKHBhcnNlZC5saW5rKS5jYXRjaCgoZXJyb3I6IHVua25vd24pID0+IHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ1t2c2FdIGRlZXAtbGluayBwYWlyaW5nIGZhaWxlZCcsIGVycm9yKTtcbiAgICAgIG5ldyBOb3RpY2UoJ1ZhdWx0U3luYzogcGFpcmluZyB2aWEgbGluayBmYWlsZWQgXHUyMDE0IHNlZSB0aGUgY29uc29sZSBmb3IgZGV0YWlscy4nKTtcbiAgICB9KTtcbiAgfTtcbiAgcmVnaXN0ZXIoUFJPVE9DT0xfQUNUSU9OLCBoYW5kbGVyKTtcbiAgLy8gUmVnaXN0ZXIgdGhlIHBhdGgtc3BlbGxlZCBhY3Rpb24gdG9vIChidWlsZC1kZXBlbmRlbnQgbWF0Y2hpbmcpLlxuICByZWdpc3RlcihgJHtQUk9UT0NPTF9BQ1RJT059L3BhaXJgLCBoYW5kbGVyKTtcbn1cbiIsICIvKipcbiAqIFJlY29ubmVjdCBwb2xpY3kgKHBsdWdpbiBzY29wZSBpdGVtICM1KTogZXhwb25lbnRpYWwgYmFja29mZiB3aXRoIGppdHRlcixcbiAqIGNhcHBlZCBhdCA2MCBzLiBUaGUgcGx1Z2luJ3MgMSBzIHN1cGVydmlzaW9uIHRpY2sgYXNrcyB0aGUgc3VwZXJ2aXNvciB3aGF0XG4gKiB0byBkbyB3aGVuZXZlciB0aGUgY2xpZW50IHJlcG9ydHMgYGRpc2Nvbm5lY3RlZGA7IGEgc2NoZWR1bGVkIHJlY29ubmVjdCBpc1xuICogYSBzaW5nbGUgZmxpZ2h0IFx1MjAxNCBuZXZlciBhIHN0YWNrIG9mIHJldHJpZXMuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBTeW5jQ2xpZW50U3RhdGUgfSBmcm9tICdAdnNhL2NvcmUnO1xuXG5leHBvcnQgaW50ZXJmYWNlIEJhY2tvZmZPcHRpb25zIHtcbiAgLyoqIEZpcnN0IGF0dGVtcHQgZGVsYXkgKGRlZmF1bHQgMSBzKS4gKi9cbiAgYmFzZU1zPzogbnVtYmVyO1xuICAvKiogQ2VpbGluZyAoZGVmYXVsdCA2MCBzIHBlciB0aGUgcGx1Z2luIHNwZWMpLiAqL1xuICBjYXBNcz86IG51bWJlcjtcbiAgLyoqIEppdHRlciBmcmFjdGlvbiBhcm91bmQgdGhlIGV4cG9uZW50aWFsIHZhbHVlLCAwXHUyMDEzMC41IChkZWZhdWx0IDAuMykuICovXG4gIGppdHRlcj86IG51bWJlcjtcbiAgLyoqIEluamVjdGFibGUgcmFuZG9tbmVzcyAodGVzdHMpLiBEZWZhdWx0IGBNYXRoLnJhbmRvbWAuICovXG4gIHJhbmRvbT86ICgpID0+IG51bWJlcjtcbn1cblxuZXhwb3J0IGNvbnN0IERFRkFVTFRfUkVDT05ORUNUX0JBU0VfTVMgPSAxMDAwO1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfUkVDT05ORUNUX0NBUF9NUyA9IDYwXzAwMDtcblxuLyoqXG4gKiBEZWxheSBmb3IgYXR0ZW1wdCBOICgwLWJhc2VkKTogYG1pbihjYXAsIGJhc2UgXHUwMEI3IDJeYXR0ZW1wdClgIHdpdGggc3ltbWV0cmljXG4gKiBtdWx0aXBsaWNhdGl2ZSBqaXR0ZXIsIGZsb29yZWQgYXQgMjUwIG1zLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYmFja29mZkRlbGF5TXMoYXR0ZW1wdDogbnVtYmVyLCBvcHRpb25zOiBCYWNrb2ZmT3B0aW9ucyA9IHt9KTogbnVtYmVyIHtcbiAgY29uc3QgYmFzZSA9IG9wdGlvbnMuYmFzZU1zID8/IERFRkFVTFRfUkVDT05ORUNUX0JBU0VfTVM7XG4gIGNvbnN0IGNhcCA9IG9wdGlvbnMuY2FwTXMgPz8gREVGQVVMVF9SRUNPTk5FQ1RfQ0FQX01TO1xuICBjb25zdCBqaXR0ZXIgPSBvcHRpb25zLmppdHRlciA/PyAwLjM7XG4gIGNvbnN0IHJhbmRvbSA9IG9wdGlvbnMucmFuZG9tID8/IE1hdGgucmFuZG9tO1xuICBjb25zdCBleHBvbmVudGlhbCA9IE1hdGgubWluKGNhcCwgYmFzZSAqIDIgKiogYXR0ZW1wdCk7XG4gIGNvbnN0IGZhY3RvciA9IDEgKyAocmFuZG9tKCkgKiAyIC0gMSkgKiBqaXR0ZXI7XG4gIHJldHVybiBNYXRoLnJvdW5kKE1hdGgubWluKGNhcCwgTWF0aC5tYXgoMjUwLCBleHBvbmVudGlhbCAqIGZhY3RvcikpKTtcbn1cblxuZXhwb3J0IHR5cGUgUmVjb25uZWN0RGVjaXNpb24gPSB7IGFjdGlvbjogJ3JlY29ubmVjdCc7IGRlbGF5TXM6IG51bWJlciB9IHwgeyBhY3Rpb246ICd3YWl0JyB9O1xuXG4vKipcbiAqIFRyYWNrcyByZWNvbm5lY3QgYXR0ZW1wdHMgYWNyb3NzIHRoZSBzdXBlcnZpc2lvbiB0aWNrLiBOb24tZGlzY29ubmVjdGVkXG4gKiBzdGF0ZXMgcmVzZXQgdGhlIGJhY2tvZmYgbGFkZGVyIChhIHN1Y2Nlc3NmdWwgY3ljbGUgbWVhbnMgdGhlIG5ldHdvcmsgaXNcbiAqIGJhY2spOyBgc2NoZWR1bGVkYCBrZWVwcyBleGFjdGx5IG9uZSByZWNvbm5lY3QgaW4gZmxpZ2h0LlxuICovXG5leHBvcnQgY2xhc3MgUmVjb25uZWN0U3VwZXJ2aXNvciB7XG4gIHByaXZhdGUgYXR0ZW1wdCA9IDA7XG4gIHByaXZhdGUgc2NoZWR1bGVkID0gZmFsc2U7XG4gIHByaXZhdGUgcmVhZG9ubHkgb3B0aW9uczogQmFja29mZk9wdGlvbnM7XG5cbiAgY29uc3RydWN0b3Iob3B0aW9uczogQmFja29mZk9wdGlvbnMgPSB7fSkge1xuICAgIHRoaXMub3B0aW9ucyA9IG9wdGlvbnM7XG4gIH1cblxuICAvKiogQ2FsbCBlYWNoIHRpY2s7IG9uIGByZWNvbm5lY3RgLCBmb2xsb3cgdXAgd2l0aCBgYWNrbm93bGVkZ2VkKClgLiAqL1xuICBjb25zaWRlcihzdGF0ZTogU3luY0NsaWVudFN0YXRlKTogUmVjb25uZWN0RGVjaXNpb24ge1xuICAgIGlmIChzdGF0ZSAhPT0gJ2Rpc2Nvbm5lY3RlZCcpIHtcbiAgICAgIHRoaXMuYXR0ZW1wdCA9IDA7XG4gICAgICB0aGlzLnNjaGVkdWxlZCA9IGZhbHNlO1xuICAgICAgcmV0dXJuIHsgYWN0aW9uOiAnd2FpdCcgfTtcbiAgICB9XG4gICAgaWYgKHRoaXMuc2NoZWR1bGVkKSByZXR1cm4geyBhY3Rpb246ICd3YWl0JyB9O1xuICAgIHJldHVybiB7IGFjdGlvbjogJ3JlY29ubmVjdCcsIGRlbGF5TXM6IGJhY2tvZmZEZWxheU1zKHRoaXMuYXR0ZW1wdCwgdGhpcy5vcHRpb25zKSB9O1xuICB9XG5cbiAgLyoqIE1hcmsgdGhlIHJldHVybmVkIHJlY29ubmVjdCBhcyBpbiBmbGlnaHQgKG9uZSBhdCBhIHRpbWUpLiAqL1xuICBhY2tub3dsZWRnZWQoKTogdm9pZCB7XG4gICAgdGhpcy5hdHRlbXB0ICs9IDE7XG4gICAgdGhpcy5zY2hlZHVsZWQgPSB0cnVlO1xuICB9XG5cbiAgLyoqIFRoZSBpbi1mbGlnaHQgcmVjb25uZWN0IHNldHRsZWQgKHN1Y2Nlc3Mgb3IgZmFpbHVyZSkuICovXG4gIHNldHRsZWQoKTogdm9pZCB7XG4gICAgdGhpcy5zY2hlZHVsZWQgPSBmYWxzZTtcbiAgfVxuXG4gIC8qKiBDb21wbGV0ZWQgcmVjb25uZWN0IGF0dGVtcHRzIHNpbmNlIHRoZSBsYXN0IGhlYWx0aHkgc3RhdGUuICovXG4gIGdldCBhdHRlbXB0cygpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLmF0dGVtcHQ7XG4gIH1cbn1cbiIsICIvKipcbiAqIFRoZSBzZXR0aW5ncyB0YWIgKHBsdWdpbiBzY29wZSBpdGVtICM2KSwgb3JnYW5pemVkIGluIGZvdXIgc2VjdGlvbnM6XG4gKlxuICogICBDb25uZWN0aW9uIFx1MjAxNCB3b3JrZXIgVVJMLCBkZXZpY2UgbmFtZSAocGFpcmluZy10aW1lIE9SIHJlbmFtZSB3aGVuXG4gKiAgICAgICAgICAgICAgICBsaW5rZWQpLCBwYWlyaW5nIGZvcm0gLyBzdGF0dXMgcmVhZG91dCArIFN5bmMgbm93ICsgdW5saW5rXG4gKiAgIFN5bmMgICAgICAgXHUyMDE0IHJlc2NhbiBpbnRlcnZhbCwgLm9ic2lkaWFuLyB0b2dnbGUsIHBhdXNlL3Jlc3VtZSxcbiAqICAgICAgICAgICAgICAgIHN5bmMtb24tc3RhcnR1cFxuICogICBBZHZhbmNlZCAgIFx1MjAxNCBzdGF0dXMtYmFyIGluZGljYXRvciBtb2RlLCBpZ25vcmUgcGF0dGVybnMsIGRpYWdub3N0aWNzXG4gKiAgICAgICAgICAgICAgICAobG9nIGxldmVsICsgQ29weSBkaWFnbm9zdGljcylcbiAqICAgQWJvdXQgICAgICBcdTIwMTQgdmVyc2lvbnMsIHN0b3JhZ2UgdXNhZ2UsIHByb2plY3QgUkVBRE1FIGxpbmtcbiAqXG4gKiBBbGwgbG9naWMgbGl2ZXMgb24gYFZhdWx0U3luY1BsdWdpbmA7IHRoZSB0YWIgaXMgcHJlc2VudGF0aW9uIHBsdXMgd2lyaW5nLlxuICovXG5cbmltcG9ydCB7IE1vZGFsLCBOb3RpY2UsIFBsdWdpblNldHRpbmdUYWIsIFNldHRpbmcgfSBmcm9tICdvYnNpZGlhbic7XG5pbXBvcnQgdHlwZSB7IEFwcCB9IGZyb20gJ29ic2lkaWFuJztcbmltcG9ydCB7XG4gIGRlZmF1bHREZXZpY2VOYW1lLFxuICBSRVNDQU5fSU5URVJWQUxfQ0hPSUNFUyxcbiAgdHlwZSBMb2dMZXZlbCxcbiAgdHlwZSBWYXVsdFN5bmNQbHVnaW5EYXRhLFxufSBmcm9tICcuL2RhdGEuanMnO1xuaW1wb3J0IHR5cGUgeyBQYWlyT3V0Y29tZSB9IGZyb20gJy4vcGFpcmluZy5qcyc7XG5pbXBvcnQgeyBwYWlyT3V0Y29tZU1lc3NhZ2UgfSBmcm9tICcuL3BhaXJpbmcuanMnO1xuaW1wb3J0IHsgZm9ybWF0Qnl0ZXMsIFBST1RPQ09MX1ZFUlNJT04gfSBmcm9tICcuL2RpYWdub3N0aWNzLmpzJztcbmltcG9ydCB7IGZvcm1hdFNpbmNlIH0gZnJvbSAnLi9zdGF0dXNiYXIuanMnO1xuaW1wb3J0IHR5cGUgeyBWYXVsdFN5bmNQbHVnaW4gfSBmcm9tICcuL3BsdWdpbi5qcyc7XG5cbi8qKlxuICogQ2xvdWRmbGFyZSBEZXBsb3kgQnV0dG9uIHRhcmdldCAoRlItMjEpOiBwcm92aXNpb25zIGEgcHJlY29uZmlndXJlZCB3b3JrZXJcbiAqICsgRHVyYWJsZSBPYmplY3QgKyBSMiBidWNrZXQgaW4gdGhlIHVzZXIncyBvd24gYWNjb3VudCBcdTIwMTQgbm8gd3JhbmdsZXIsIG5vXG4gKiBtYW51YWwgY29uZmlnLiBUaGUgdGVtcGxhdGUgcmVwbyBwaW5zIGEgcmVsZWFzZWQgd29ya2VyIHZlcnNpb24uXG4gKi9cbmV4cG9ydCBjb25zdCBERVBMT1lfVVJMID1cbiAgJ2h0dHBzOi8vZGVwbG95LndvcmtlcnMuY2xvdWRmbGFyZS5jb20vP3VybD0nICtcbiAgJ2h0dHBzOi8vZ2l0aHViLmNvbS92YXVsdHN5bmNmb3JhZ2VudHMvdmF1bHRzeW5jZm9yYWdlbnRzLXRlbXBsYXRlJztcblxuLyoqIFRoZSBwcm9qZWN0IFJFQURNRSAodGhlIEFib3V0IHNlY3Rpb24ncyBsaW5rKS4gKi9cbmV4cG9ydCBjb25zdCBQUk9KRUNUX1JFQURNRV9VUkwgPSAnaHR0cHM6Ly9naXRodWIuY29tL3ZhdWx0c3luY2ZvcmFnZW50cy92YXVsdHN5bmNmb3JhZ2VudHMjcmVhZG1lJztcblxuLyoqIE9wZW4gdGhlIGRlcGxveSBwYWdlIGluIHRoZSBzeXN0ZW0gYnJvd3NlciAobm8tb3Agd2hlcmUgYHdpbmRvd2AgaXMgYWJzZW50KS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBvcGVuRGVwbG95UGFnZSgpOiB2b2lkIHtcbiAgaWYgKHR5cGVvZiB3aW5kb3cgPT09ICd1bmRlZmluZWQnKSByZXR1cm47XG4gIHdpbmRvdy5vcGVuKERFUExPWV9VUkwsICdfYmxhbmsnKTtcbn1cblxuLyoqIE9wZW4gdGhlIHByb2plY3QgUkVBRE1FIGluIHRoZSBzeXN0ZW0gYnJvd3NlciAobm8tb3Agd2l0aG91dCBgd2luZG93YCkuICovXG5leHBvcnQgZnVuY3Rpb24gb3BlblJlYWRtZVBhZ2UoKTogdm9pZCB7XG4gIGlmICh0eXBlb2Ygd2luZG93ID09PSAndW5kZWZpbmVkJykgcmV0dXJuO1xuICB3aW5kb3cub3BlbihQUk9KRUNUX1JFQURNRV9VUkwsICdfYmxhbmsnKTtcbn1cblxuLyoqIFNtYWxsIGNvbmZpcm1hdGlvbiBkaWFsb2cgKHRoZSB1bmxpbmsgYnV0dG9uJ3Mgc2FmZXR5IG5ldCkuICovXG5leHBvcnQgY2xhc3MgQ29uZmlybU1vZGFsIGV4dGVuZHMgTW9kYWwge1xuICBjb25zdHJ1Y3RvcihcbiAgICBhcHA6IEFwcCxcbiAgICBwcml2YXRlIHJlYWRvbmx5IG9wdGlvbnM6IHtcbiAgICAgIHRpdGxlOiBzdHJpbmc7XG4gICAgICBib2R5OiBzdHJpbmc7XG4gICAgICBjb25maXJtVGV4dDogc3RyaW5nO1xuICAgICAgb25Db25maXJtOiAoKSA9PiB2b2lkIHwgUHJvbWlzZTx2b2lkPjtcbiAgICB9LFxuICApIHtcbiAgICBzdXBlcihhcHApO1xuICB9XG5cbiAgb3ZlcnJpZGUgb25PcGVuKCk6IHZvaWQge1xuICAgIG5ldyBTZXR0aW5nKHRoaXMuY29udGVudEVsKS5zZXROYW1lKHRoaXMub3B0aW9ucy50aXRsZSkuc2V0RGVzYyh0aGlzLm9wdGlvbnMuYm9keSk7XG4gICAgbmV3IFNldHRpbmcodGhpcy5jb250ZW50RWwpLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoJ0NhbmNlbCcpLm9uQ2xpY2soKCkgPT4gdGhpcy5jbG9zZSgpKSxcbiAgICApO1xuICAgIG5ldyBTZXR0aW5nKHRoaXMuY29udGVudEVsKS5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgIGJ1dHRvblxuICAgICAgICAuc2V0Q3RhKClcbiAgICAgICAgLnNldEJ1dHRvblRleHQodGhpcy5vcHRpb25zLmNvbmZpcm1UZXh0KVxuICAgICAgICAub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgdGhpcy5jbG9zZSgpO1xuICAgICAgICAgIGF3YWl0IHRoaXMub3B0aW9ucy5vbkNvbmZpcm0oKTtcbiAgICAgICAgfSksXG4gICAgKTtcbiAgfVxufVxuXG5leHBvcnQgY2xhc3MgVmF1bHRTeW5jU2V0dGluZ1RhYiBleHRlbmRzIFBsdWdpblNldHRpbmdUYWIge1xuICBwcml2YXRlIHJlYWRvbmx5IHBsdWdpbjogVmF1bHRTeW5jUGx1Z2luO1xuICAvKiogUGFpcmluZyBjb2RlcyBuZXZlciB0b3VjaCBkaXNrIFx1MjAxNCB0aGV5IGFyZSBvbmUtdGltZSwgc2hvcnQtbGl2ZWQgc2VjcmV0cy4gKi9cbiAgcHJpdmF0ZSBwYWlyaW5nQ29kZSA9ICcnO1xuICAvKipcbiAgICogTGlua2VkLW1vZGUgZGV2aWNlLW5hbWUgZHJhZnQ6IGVkaXRzIHN0YWdlIGhlcmUgKE5PVCBpbiBwbHVnaW4gZGF0YSkgc28gYVxuICAgKiBmYWlsZWQgcmVuYW1lIGNhbm5vdCBsZWF2ZSB0aGUgbG9jYWwgbmFtZSBvdXQgb2Ygc3luYyB3aXRoIHRoZSB3b3JrZXIuXG4gICAqL1xuICBwcml2YXRlIHJlbmFtZURyYWZ0OiBzdHJpbmcgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBoaW50U2V0dGluZzogU2V0dGluZyB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHN0YXR1c1NldHRpbmc6IFNldHRpbmcgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBzdG9yYWdlU2V0dGluZzogU2V0dGluZyB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHJlZnJlc2hIYW5kbGU6IFJldHVyblR5cGU8dHlwZW9mIHNldEludGVydmFsPiB8IG51bGwgPSBudWxsO1xuXG4gIGNvbnN0cnVjdG9yKGFwcDogQXBwLCBwbHVnaW46IFZhdWx0U3luY1BsdWdpbikge1xuICAgIHN1cGVyKGFwcCwgcGx1Z2luKTtcbiAgICB0aGlzLnBsdWdpbiA9IHBsdWdpbjtcbiAgfVxuXG4gIG92ZXJyaWRlIGRpc3BsYXkoKTogdm9pZCB7XG4gICAgdGhpcy5zdG9wUmVmcmVzaCgpO1xuICAgIGNvbnN0IHsgY29udGFpbmVyRWwgfSA9IHRoaXM7XG4gICAgY29udGFpbmVyRWwuZW1wdHkoKTtcbiAgICB0aGlzLmhpbnRTZXR0aW5nID0gbnVsbDtcbiAgICB0aGlzLnN0YXR1c1NldHRpbmcgPSBudWxsO1xuICAgIHRoaXMuc3RvcmFnZVNldHRpbmcgPSBudWxsO1xuICAgIHRoaXMucmVuYW1lRHJhZnQgPSBudWxsO1xuXG4gICAgdGhpcy5yZW5kZXJDb25uZWN0aW9uU2VjdGlvbigpO1xuICAgIHRoaXMucmVuZGVyU3luY1NlY3Rpb24oKTtcbiAgICB0aGlzLnJlbmRlckFkdmFuY2VkU2VjdGlvbigpO1xuICAgIHRoaXMucmVuZGVyQWJvdXRTZWN0aW9uKCk7XG4gICAgdGhpcy5zdGFydFJlZnJlc2goKTtcbiAgfVxuXG4gIG92ZXJyaWRlIGhpZGUoKTogdm9pZCB7XG4gICAgdGhpcy5zdG9wUmVmcmVzaCgpO1xuICB9XG5cbiAgLy8gLS0tIHNlY3Rpb25zIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgcHJpdmF0ZSBoZWFkaW5nKHRleHQ6IHN0cmluZyk6IHZvaWQge1xuICAgIG5ldyBTZXR0aW5nKHRoaXMuY29udGFpbmVyRWwpLnNldE5hbWUodGV4dCkuc2V0SGVhZGluZygpO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJDb25uZWN0aW9uU2VjdGlvbigpOiB2b2lkIHtcbiAgICBjb25zdCB7IGNvbnRhaW5lckVsIH0gPSB0aGlzO1xuICAgIHRoaXMuaGVhZGluZygnQ29ubmVjdGlvbicpO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnV29ya2VyIFVSTCcpXG4gICAgICAuc2V0RGVzYyhcbiAgICAgICAgJ1lvdXIgc3luYyB3b3JrZXIsIGUuZy4gaHR0cHM6Ly9wZXJzb25hbC54LndvcmtlcnMuZGV2LiBObyB3b3JrZXIgeWV0PyBVc2UgXCJEZXBsb3kgeW91ciB3b3JrZXJcIiBiZWxvdywgb3BlbiB0aGUgVVJMIGluIGEgYnJvd3NlciwgYW5kIGNsYWltIGl0LicsXG4gICAgICApXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT5cbiAgICAgICAgdGV4dFxuICAgICAgICAgIC5zZXRQbGFjZWhvbGRlcignaHR0cHM6Ly9wZXJzb25hbC54LndvcmtlcnMuZGV2JylcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uZGF0YS51cmwpXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4uZGF0YS51cmwgPSB2YWx1ZS50cmltKCk7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlUGx1Z2luRGF0YSgpO1xuICAgICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIGlmICh0aGlzLnBsdWdpbi5saW5rZWQpIHtcbiAgICAgIHRoaXMucmVuZGVyTGlua2VkRGV2aWNlTmFtZSgpO1xuICAgICAgdGhpcy5yZW5kZXJMaW5rZWRTdGF0dXMoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5yZW5kZXJQYWlyaW5nRGV2aWNlTmFtZSgpO1xuICAgICAgdGhpcy5yZW5kZXJQYWlyaW5nU2VjdGlvbigpO1xuICAgIH1cbiAgfVxuXG4gIC8qKiBVbmxpbmtlZDogdGhlIG5hbWUgaXMgYSBwYWlyaW5nLXRpbWUgZGVmYXVsdCAoYXBwbGllcyBhdCBuZXh0IHBhaXIpLiAqL1xuICBwcml2YXRlIHJlbmRlclBhaXJpbmdEZXZpY2VOYW1lKCk6IHZvaWQge1xuICAgIG5ldyBTZXR0aW5nKHRoaXMuY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnRGV2aWNlIG5hbWUnKVxuICAgICAgLnNldERlc2MoYFNob3duIGluIHRoZSB3b3JrZXIgZGFzaGJvYXJkJ3MgZGV2aWNlIGxpc3QuIEFwcGxpZXMgd2hlbiAocmUpcGFpcmluZy5gKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHRcbiAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoZGVmYXVsdERldmljZU5hbWUoKSlcbiAgICAgICAgICAuc2V0VmFsdWUodGhpcy5wbHVnaW4uZGF0YS5kZXZpY2VOYW1lKVxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLmRhdGEuZGV2aWNlTmFtZSA9IHZhbHVlLnRyaW0oKTtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnNhdmVQbHVnaW5EYXRhKCk7XG4gICAgICAgICAgfSksXG4gICAgICApO1xuICB9XG5cbiAgLyoqIExpbmtlZDogdGhlIGZpZWxkIHNob3dzIHRoZSBjdXJyZW50IG5hbWU7IFJlbmFtZSBwdXNoZXMgaXQgdG8gdGhlIHdvcmtlci4gKi9cbiAgcHJpdmF0ZSByZW5kZXJMaW5rZWREZXZpY2VOYW1lKCk6IHZvaWQge1xuICAgIGNvbnN0IGN1cnJlbnQgPSB0aGlzLnJlbmFtZURyYWZ0ID8/IHRoaXMucGx1Z2luLmRhdGEuZGV2aWNlTmFtZTtcbiAgICBuZXcgU2V0dGluZyh0aGlzLmNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ0RldmljZSBuYW1lJylcbiAgICAgIC5zZXREZXNjKFxuICAgICAgICAnVGhlIHdvcmtlciBkYXNoYm9hcmQgc2hvd3MgdGhpcyBuYW1lLiBFZGl0IGl0IGFuZCBwcmVzcyBcIlJlbmFtZSBkZXZpY2VcIiB0byB1cGRhdGUgdGhpcyBkZXZpY2Ugb24gdGhlIHdvcmtlciAoMS0zMCBjaGFyYWN0ZXJzKS4nLFxuICAgICAgKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHRcbiAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoZGVmYXVsdERldmljZU5hbWUoKSlcbiAgICAgICAgICAuc2V0VmFsdWUoY3VycmVudClcbiAgICAgICAgICAub25DaGFuZ2UoKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnJlbmFtZURyYWZ0ID0gdmFsdWU7XG4gICAgICAgICAgfSksXG4gICAgICApXG4gICAgICAuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KCdSZW5hbWUgZGV2aWNlJykub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgYnV0dG9uLnNldERpc2FibGVkKHRydWUpO1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBjb25zdCBvayA9IGF3YWl0IHRoaXMucGx1Z2luLnJlbmFtZURldmljZSh0aGlzLnJlbmFtZURyYWZ0ID8/IHRoaXMucGx1Z2luLmRhdGEuZGV2aWNlTmFtZSk7XG4gICAgICAgICAgICBpZiAob2spIHRoaXMuZGlzcGxheSgpOyAvLyByZS1yZW5kZXIgd2l0aCB0aGUgcGVyc2lzdGVkIG5hbWVcbiAgICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgICAgYnV0dG9uLnNldERpc2FibGVkKGZhbHNlKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pLFxuICAgICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyUGFpcmluZ1NlY3Rpb24oKTogdm9pZCB7XG4gICAgY29uc3QgeyBjb250YWluZXJFbCB9ID0gdGhpcztcbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdQYWlyaW5nIGNvZGUnKVxuICAgICAgLnNldERlc2MoJ0Zyb20geW91ciB3b3JrZXIgZGFzaGJvYXJkOiBEZXZpY2VzIFx1MjE5MiBQYWlyIG5ldyBkZXZpY2UuIENvZGVzIGFyZSBvbmUtdGltZSBhbmQgZXhwaXJlIGFmdGVyIDEwIG1pbnV0ZXMuJylcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PlxuICAgICAgICB0ZXh0XG4gICAgICAgICAgLnNldFBsYWNlaG9sZGVyKCc3RjNLLVE5TTInKVxuICAgICAgICAgIC5vbkNoYW5nZSgodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMucGFpcmluZ0NvZGUgPSB2YWx1ZS50cmltKCk7XG4gICAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgYnV0dG9uXG4gICAgICAgIC5zZXRDdGEoKVxuICAgICAgICAuc2V0QnV0dG9uVGV4dCgnUGFpciB0aGlzIHZhdWx0JylcbiAgICAgICAgLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICAgIGJ1dHRvbi5zZXREaXNhYmxlZCh0cnVlKTtcbiAgICAgICAgICB0cnkge1xuICAgICAgICAgICAgY29uc3Qgb3V0Y29tZSA9IGF3YWl0IHRoaXMucGx1Z2luLnBhaXJGcm9tU2V0dGluZ3ModGhpcy5wYWlyaW5nQ29kZSk7XG4gICAgICAgICAgICB0aGlzLnNob3dPdXRjb21lKG91dGNvbWUpO1xuICAgICAgICAgIH0gZmluYWxseSB7XG4gICAgICAgICAgICBidXR0b24uc2V0RGlzYWJsZWQoZmFsc2UpO1xuICAgICAgICAgIH1cbiAgICAgICAgfSksXG4gICAgKTtcblxuICAgIHRoaXMuaGludFNldHRpbmcgPSBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdHZXR0aW5nIHN0YXJ0ZWQnKVxuICAgICAgLnNldENsYXNzKCd2c2Etc2V0dGluZ3MtaGludCcpXG4gICAgICAuc2V0RGVzYyhcbiAgICAgICAgW1xuICAgICAgICAgICcxLiBEZXBsb3kgeW91ciBvd24gd29ya2VyIHdpdGggdGhlIGJ1dHRvbiBiZWxvdyAoeW91ciBDbG91ZGZsYXJlIGFjY291bnQsIHByZWNvbmZpZ3VyZWQgXHUyMDE0IG5vIHdyYW5nbGVyKS4nLFxuICAgICAgICAgICcyLiBPcGVuIHRoZSB3b3JrZXIgVVJMIGluIGEgYnJvd3NlciBhbmQgc2V0IHRoZSBhZG1pbiBwYXNzcGhyYXNlIChjbGFpbSkuJyxcbiAgICAgICAgICAnMy4gQ3JlYXRlIGEgcGFpcmluZyBjb2RlIG9uIHRoZSBkYXNoYm9hcmQsIHBhc3RlIGl0IGFib3ZlLCBhbmQgcGFpci4nLFxuICAgICAgICAgICdPbiBhIHBob25lLCBzY2FubmluZyB0aGUgZGFzaGJvYXJkIFFSIG9yIHRhcHBpbmcgaXRzIG9ic2lkaWFuOi8vIGxpbmsgcGFpcnMgd2l0aG91dCB0eXBpbmcuJyxcbiAgICAgICAgXS5qb2luKCdcXG4nKSxcbiAgICAgIClcbiAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoJ0RlcGxveSB5b3VyIHdvcmtlcicpLm9uQ2xpY2soKCkgPT4gb3BlbkRlcGxveVBhZ2UoKSksXG4gICAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJMaW5rZWRTdGF0dXMoKTogdm9pZCB7XG4gICAgY29uc3QgeyBjb250YWluZXJFbCB9ID0gdGhpcztcblxuICAgIHRoaXMuc3RhdHVzU2V0dGluZyA9IG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ1N0YXR1cycpXG4gICAgICAuc2V0Q2xhc3MoJ3ZzYS1zdGF0dXMtcmVhZG91dCcpXG4gICAgICAuc2V0RGVzYyh0aGlzLnN0YXR1c1RleHQoKSk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbCkuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICBidXR0b24uc2V0QnV0dG9uVGV4dCgnU3luYyBub3cnKS5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgYnV0dG9uLnNldERpc2FibGVkKHRydWUpO1xuICAgICAgICB0cnkge1xuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnN5bmNOb3coKTtcbiAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICBidXR0b24uc2V0RGlzYWJsZWQoZmFsc2UpO1xuICAgICAgICAgIHRoaXMucmVmcmVzaFN0YXR1cygpO1xuICAgICAgICB9XG4gICAgICB9KSxcbiAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgYnV0dG9uLnNldEJ1dHRvblRleHQoJ1VubGluayB0aGlzIHZhdWx0Jykub25DbGljaygoKSA9PiB7XG4gICAgICAgIG5ldyBDb25maXJtTW9kYWwodGhpcy5hcHAsIHtcbiAgICAgICAgICB0aXRsZTogJ1VubGluayBWYXVsdFN5bmM/JyxcbiAgICAgICAgICBib2R5OiAnVGhpcyBzdG9wcyBzeW5jaW5nIGFuZCBjbGVhcnMgdGhpcyBkZXZpY2VcXHUyMDE5cyBsb2NhbCBzeW5jIHN0YXRlLiBGaWxlcyBhbHJlYWR5IGluIHRoZSB2YXVsdCBhcmUgdW50b3VjaGVkLiBUaGUgd29ya2VyIGtlZXBzIHRoaXMgZGV2aWNlIGluIGl0cyByZWdpc3RyeSBcXHUyMDE0IHJldm9rZSBpdCBmcm9tIHRoZSBkYXNoYm9hcmQgaWYgeW91IGFyZSBkb25lIHdpdGggaXQuJyxcbiAgICAgICAgICBjb25maXJtVGV4dDogJ1VubGluaycsXG4gICAgICAgICAgb25Db25maXJtOiBhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi51bmxpbmsoKTtcbiAgICAgICAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgICAgIH0sXG4gICAgICAgIH0pLm9wZW4oKTtcbiAgICAgIH0pLFxuICAgICk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlclN5bmNTZWN0aW9uKCk6IHZvaWQge1xuICAgIGNvbnN0IHsgY29udGFpbmVyRWwgfSA9IHRoaXM7XG4gICAgY29uc3QgZGF0YSA9IHRoaXMucGx1Z2luLmRhdGE7XG4gICAgdGhpcy5oZWFkaW5nKCdTeW5jJyk7XG5cbiAgICBpZiAodGhpcy5wbHVnaW4ubGlua2VkKSB7XG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUoJ1Jlc2NhbiBpbnRlcnZhbCcpXG4gICAgICAgIC5zZXREZXNjKFxuICAgICAgICAgICdQZXJpb2RpYyBmdWxsIHJlY29uY2lsaWF0aW9uIFx1MjAxNCBjYXRjaGVzIGV4dGVybmFsIGVkaXRzIHdoaWxlIE9ic2lkaWFuIGlzIG9wZW4gYW5kIGNvdmVycyBtb2JpbGUgYmFja2dyb3VuZCBsaW1pdHMuIFZhdWx0IGV2ZW50cyBhbmQgYXBwLW9wZW4gc3luYyBhbHdheXMgcnVuLicsXG4gICAgICAgIClcbiAgICAgICAgLmFkZERyb3Bkb3duKChkcm9wZG93bikgPT4ge1xuICAgICAgICAgIGZvciAoY29uc3QgY2hvaWNlIG9mIFJFU0NBTl9JTlRFUlZBTF9DSE9JQ0VTKSB7XG4gICAgICAgICAgICBkcm9wZG93bi5hZGRPcHRpb24oU3RyaW5nKGNob2ljZS52YWx1ZSksIGNob2ljZS5sYWJlbCk7XG4gICAgICAgICAgfVxuICAgICAgICAgIGRyb3Bkb3duLnNldFZhbHVlKFN0cmluZyhkYXRhLnNldHRpbmdzLnJlc2NhbkludGVydmFsU2VjKSk7XG4gICAgICAgICAgZHJvcGRvd24ub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5hcHBseVJlc2NhbkludGVydmFsKE51bWJlcih2YWx1ZSkpO1xuICAgICAgICAgIH0pO1xuICAgICAgICB9KTtcblxuICAgICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAgIC5zZXROYW1lKCdTeW5jIC5vYnNpZGlhbi8gZm9sZGVyJylcbiAgICAgICAgLnNldERlc2MoXG4gICAgICAgICAgJ09wdCBpbiB0byBzeW5jaW5nIC5vYnNpZGlhbi8gKHNldHRpbmdzIGFuZCBwbHVnaW5zKSwgZXhjbHVkaW5nIHdvcmtzcGFjZS5qc29uIGFuZCBjYWNoZXMuICcgK1xuICAgICAgICAgICAgJ1RoZSB3b3JrZXJcXHUyMDE5cyBwZXItdmF1bHQgc2V0dGluZyB0YWtlcyBwcmVjZWRlbmNlIG9uY2UgY29ubmVjdGVkLicsXG4gICAgICAgIClcbiAgICAgICAgLmFkZFRvZ2dsZSgodG9nZ2xlKSA9PlxuICAgICAgICAgIHRvZ2dsZS5zZXRWYWx1ZShkYXRhLnNldHRpbmdzLm9ic2lkaWFuU3luYykub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5hcHBseU9ic2lkaWFuU3luYyh2YWx1ZSk7XG4gICAgICAgICAgfSksXG4gICAgICAgICk7XG5cbiAgICAgIGNvbnN0IHBhdXNlZCA9IHRoaXMucGx1Z2luLnN5bmNpbmdQYXVzZWQ7XG4gICAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgICAgLnNldE5hbWUocGF1c2VkID8gJ1N5bmNpbmcgcGF1c2VkJyA6ICdQYXVzZSBzeW5jaW5nJylcbiAgICAgICAgLnNldERlc2MoXG4gICAgICAgICAgcGF1c2VkXG4gICAgICAgICAgICA/ICdTeW5jaW5nIGlzIHBhdXNlZDogdGhlIGNvbm5lY3Rpb24gaXMgZG93biBhbmQgdmF1bHQgY2hhbmdlcyBzdGF5IGxvY2FsLiBSZXN1bWUgcmVjb25uZWN0cyBhbmQgcnVucyBhIGZ1bGwgY2F0Y2gtdXAgc3luYy4nXG4gICAgICAgICAgICA6ICdUZW1wb3JhcmlseSBzdG9wIHN5bmNpbmcgd2l0aG91dCB1bmxpbmtpbmcgXHUyMDE0IHRoZSB0cmFuc3BvcnQgZGlzY29ubmVjdHMgYW5kIHRoZSB3YXRjaGVyIGdvZXMgaWRsZS4gWW91ciBsaW5rIGFuZCBsb2NhbCBzdGF0ZSBhcmUga2VwdC4nLFxuICAgICAgICApXG4gICAgICAgIC5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgICAgICBidXR0b25cbiAgICAgICAgICAgIC5zZXRCdXR0b25UZXh0KHBhdXNlZCA/ICdSZXN1bWUgc3luY2luZycgOiAnUGF1c2Ugc3luY2luZycpXG4gICAgICAgICAgICAub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgICAgIGJ1dHRvbi5zZXREaXNhYmxlZCh0cnVlKTtcbiAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBpZiAocGF1c2VkKSBhd2FpdCB0aGlzLnBsdWdpbi5yZXN1bWVTeW5jaW5nKCk7XG4gICAgICAgICAgICAgICAgZWxzZSB0aGlzLnBsdWdpbi5wYXVzZVN5bmNpbmcoKTtcbiAgICAgICAgICAgICAgfSBmaW5hbGx5IHtcbiAgICAgICAgICAgICAgICB0aGlzLmRpc3BsYXkoKTsgLy8gcmUtcmVuZGVyOiB0aGUgYnV0dG9uIChhbmQgbGFiZWwpIGZsaXBcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSksXG4gICAgICAgICk7XG4gICAgfVxuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnU3luYyBvbiBzdGFydHVwJylcbiAgICAgIC5zZXREZXNjKFxuICAgICAgICAnT04gKGRlZmF1bHQpOiBzeW5jIHN0YXJ0cyBhcyBzb29uIGFzIE9ic2lkaWFuIG9wZW5zLiBPRkY6IHRoZSBwbHVnaW4gbG9hZHMgaWRsZSBhbmQgdGhlIGZpcnN0IFwiU3luYyBub3dcIiBwcmVzcyBzdGFydHMgc3luY2luZyAobWFudWFsLW9ubHkgbW9kZSkuJyxcbiAgICAgIClcbiAgICAgIC5hZGRUb2dnbGUoKHRvZ2dsZSkgPT5cbiAgICAgICAgdG9nZ2xlLnNldFZhbHVlKGRhdGEuc2V0dGluZ3Muc3luY09uU3RhcnR1cCkub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uYXBwbHlTeW5jT25TdGFydHVwKHZhbHVlKTtcbiAgICAgICAgfSksXG4gICAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJBZHZhbmNlZFNlY3Rpb24oKTogdm9pZCB7XG4gICAgY29uc3QgeyBjb250YWluZXJFbCB9ID0gdGhpcztcbiAgICBjb25zdCBkYXRhID0gdGhpcy5wbHVnaW4uZGF0YTtcbiAgICB0aGlzLmhlYWRpbmcoJ0FkdmFuY2VkJyk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdTdGF0dXMgYmFyIGluZGljYXRvcicpXG4gICAgICAuc2V0RGVzYyhcbiAgICAgICAgJ0RldGFpbGVkOiBcInZzYSBcdTI3MTMgMTJzXCIgd2l0aCBzdGF0ZSBhbmQgYWdlLiBDb21wYWN0OiBqdXN0IHRoZSBzeW1ib2wuIEhpZGRlbjogbm8gc3RhdHVzIGJhciBpdGVtIGF0IGFsbC4nLFxuICAgICAgKVxuICAgICAgLmFkZERyb3Bkb3duKChkcm9wZG93bikgPT4ge1xuICAgICAgICBkcm9wZG93bi5hZGRPcHRpb24oJ2RldGFpbGVkJywgJ0RldGFpbGVkJyk7XG4gICAgICAgIGRyb3Bkb3duLmFkZE9wdGlvbignY29tcGFjdCcsICdDb21wYWN0Jyk7XG4gICAgICAgIGRyb3Bkb3duLmFkZE9wdGlvbignaGlkZGVuJywgJ0hpZGRlbicpO1xuICAgICAgICBkcm9wZG93bi5zZXRWYWx1ZShkYXRhLnNldHRpbmdzLnN0YXR1c0Jhck1vZGUpO1xuICAgICAgICBkcm9wZG93bi5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5hcHBseVN0YXR1c0Jhck1vZGUoXG4gICAgICAgICAgICB2YWx1ZSA9PT0gJ2NvbXBhY3QnIHx8IHZhbHVlID09PSAnaGlkZGVuJyA/IHZhbHVlIDogJ2RldGFpbGVkJyxcbiAgICAgICAgICApO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnSWdub3JlIHBhdHRlcm5zJylcbiAgICAgIC5zZXREZXNjKFxuICAgICAgICAnT25lIHBhdHRlcm4gcGVyIGxpbmUsIGUuZy4gcHJpdmF0ZS8qKiBvciAqLnRtcC4gR2xvYi1saXRlOiAqIG1hdGNoZXMgd2l0aGluIG9uZSBmb2xkZXIgbmFtZSwgKiogc3BhbnMgZm9sZGVycyAoZGlyLyoqIHNraXBzIHRoZSBmb2xkZXIgYW5kIGV2ZXJ5dGhpbmcgaW4gaXQpOyBhIHBhdHRlcm4gd2l0aG91dCAvIG1hdGNoZXMgZmlsZSBuYW1lcyBhdCBhbnkgZGVwdGguIENhc2UtaW5zZW5zaXRpdmU7IGFwcGxpZXMgb24gdGhpcyBkZXZpY2Ugb25seTsgc2F2aW5nIHJlY29ubmVjdHMgc3luYyB0byBhcHBseSB0aGVtLicsXG4gICAgICApXG4gICAgICAuYWRkVGV4dEFyZWEoKGFyZWEpID0+XG4gICAgICAgIGFyZWFcbiAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoJ3ByaXZhdGUvKipcXG4qLnRtcCcpXG4gICAgICAgICAgLnNldFZhbHVlKGRhdGEuc2V0dGluZ3MuaWdub3JlUGF0dGVybnMpXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uYXBwbHlJZ25vcmVQYXR0ZXJucyh2YWx1ZSk7XG4gICAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnRGlhZ25vc3RpY3MgbG9nIGxldmVsJylcbiAgICAgIC5zZXREZXNjKFxuICAgICAgICAnaW5mbyAoZGVmYXVsdCkgcmVjb3JkcyBsaWZlY3ljbGUgZXZlbnRzOyBkZWJ1ZyBhZGRpdGlvbmFsbHkgbG9ncyBwcm90b2NvbCByb3VuZC10cmlwcyAob25lIHNob3J0IGxpbmUgcGVyIGZyYW1lKTsgd2FybiBrZWVwcyBvbmx5IHdhcm5pbmdzIGFuZCBlcnJvcnMuJyxcbiAgICAgIClcbiAgICAgIC5hZGREcm9wZG93bigoZHJvcGRvd24pID0+IHtcbiAgICAgICAgZHJvcGRvd24uYWRkT3B0aW9uKCdpbmZvJywgJ2luZm8nKTtcbiAgICAgICAgZHJvcGRvd24uYWRkT3B0aW9uKCdkZWJ1ZycsICdkZWJ1ZycpO1xuICAgICAgICBkcm9wZG93bi5hZGRPcHRpb24oJ3dhcm4nLCAnd2FybicpO1xuICAgICAgICBkcm9wZG93bi5zZXRWYWx1ZShkYXRhLnNldHRpbmdzLmxvZ0xldmVsKTtcbiAgICAgICAgZHJvcGRvd24ub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgY29uc3QgbGV2ZWw6IExvZ0xldmVsID0gdmFsdWUgPT09ICdkZWJ1ZycgfHwgdmFsdWUgPT09ICd3YXJuJyA/IHZhbHVlIDogJ2luZm8nO1xuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLmFwcGx5TG9nTGV2ZWwobGV2ZWwpO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnQ29weSBkaWFnbm9zdGljcycpXG4gICAgICAuc2V0RGVzYyhcbiAgICAgICAgJ0NvcGllcyBhIGJ1Zy1yZXBvcnQgYnVuZGxlOiBwbHVnaW4gKyBwcm90b2NvbCB2ZXJzaW9ucywgZGV2aWNlLCB3b3JrZXIgVVJMLCBwYWlyaW5nIHN0YXRlLCBhIHN0YXR1cyBzbmFwc2hvdCwgdGhlIHBsYXRmb3JtLCBhbmQgdGhlIGxhc3QgMjAgbG9nIGxpbmVzLicsXG4gICAgICApXG4gICAgICAuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KCdDb3B5IGRpYWdub3N0aWNzJykub25DbGljayhhc3luYyAoKSA9PiB7XG4gICAgICAgICAgYnV0dG9uLnNldERpc2FibGVkKHRydWUpO1xuICAgICAgICAgIHRyeSB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLnBsdWdpbi5jb3B5RGlhZ25vc3RpY3MoKTtcbiAgICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgICAgYnV0dG9uLnNldERpc2FibGVkKGZhbHNlKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pLFxuICAgICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyQWJvdXRTZWN0aW9uKCk6IHZvaWQge1xuICAgIGNvbnN0IHsgY29udGFpbmVyRWwgfSA9IHRoaXM7XG4gICAgdGhpcy5oZWFkaW5nKCdBYm91dCcpO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnVmVyc2lvbnMnKVxuICAgICAgLnNldERlc2MoXG4gICAgICAgIGBQbHVnaW4gJHt0aGlzLnBsdWdpbi5tYW5pZmVzdC52ZXJzaW9uIHx8ICd1bmtub3duJ30gXHUwMEI3IHByb3RvY29sIHYke1BST1RPQ09MX1ZFUlNJT059IFx1MDBCNyAke3RoaXMucGx1Z2luLnBsYXRmb3JtU3VtbWFyeSgpfWAsXG4gICAgICApO1xuXG4gICAgdGhpcy5zdG9yYWdlU2V0dGluZyA9IG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ1ZhdWx0IHN0b3JhZ2UnKVxuICAgICAgLnNldERlc2ModGhpcy5wbHVnaW4ubGlua2VkID8gJ0NoZWNraW5nIHRoZSB3b3JrZXJcdTIwMjYnIDogJ1BhaXIgdGhpcyB2YXVsdCB0byBzZWUgc3RvcmFnZSB1c2FnZS4nKTtcbiAgICBpZiAodGhpcy5wbHVnaW4ubGlua2VkKSB2b2lkIHRoaXMucmVmcmVzaFN0b3JhZ2UoKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ1Byb2plY3QgaG9tZScpXG4gICAgICAuc2V0RGVzYyhgRG9jdW1lbnRhdGlvbiBhbmQgc291cmNlOiAke1BST0pFQ1RfUkVBRE1FX1VSTH1gKVxuICAgICAgLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgICBidXR0b24uc2V0QnV0dG9uVGV4dCgnT3BlbiBSRUFETUUnKS5vbkNsaWNrKCgpID0+IG9wZW5SZWFkbWVQYWdlKCkpLFxuICAgICAgKTtcbiAgfVxuXG4gIC8qKiBGaWxsIHRoZSBBYm91dCBzdG9yYWdlIGxpbmUgZnJvbSAvYXBpL3N0YXR1cyAoZGV2aWNlLXRva2VuIGF1dGgpLiAqL1xuICBwcml2YXRlIGFzeW5jIHJlZnJlc2hTdG9yYWdlKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHN1bW1hcnkgPSBhd2FpdCB0aGlzLnBsdWdpbi5mZXRjaFN0b3JhZ2VTdW1tYXJ5KCk7XG4gICAgY29uc3QgZGVzYyA9XG4gICAgICBzdW1tYXJ5ID09PSBudWxsXG4gICAgICAgID8gJ1N0b3JhZ2UgdXNhZ2UgaXMgY3VycmVudGx5IHVuYXZhaWxhYmxlICh0aGUgd29ya2VyIGlzIHVucmVhY2hhYmxlKS4nXG4gICAgICAgIDogYFN0b3JhZ2UgdXNlZDogJHtmb3JtYXRCeXRlcyhzdW1tYXJ5LnN0b3JhZ2VCeXRlcyl9IFx1MDBCNyAke3N1bW1hcnkuYXR0YWNobWVudHMuY291bnR9IGF0dGFjaG1lbnQke1xuICAgICAgICAgICAgc3VtbWFyeS5hdHRhY2htZW50cy5jb3VudCA9PT0gMSA/ICcnIDogJ3MnXG4gICAgICAgICAgfSAoJHtmb3JtYXRCeXRlcyhzdW1tYXJ5LmF0dGFjaG1lbnRzLmJ5dGVzKX0pYCArXG4gICAgICAgICAgKHN1bW1hcnkuZGV2aWNlcy5sZW5ndGggPiAwXG4gICAgICAgICAgICA/IGAgXHUwMEI3ICR7c3VtbWFyeS5kZXZpY2VzLmxlbmd0aH0gZGV2aWNlJHtzdW1tYXJ5LmRldmljZXMubGVuZ3RoID09PSAxID8gJycgOiAncyd9YFxuICAgICAgICAgICAgOiAnJyk7XG4gICAgLy8gVGhlIHRhYiBtYXkgaGF2ZSBiZWVuIGNsb3NlZC9yZS1yZW5kZXJlZCBtZWFud2hpbGU7IHBhaW50IG9ubHkgaWYgbGl2ZS5cbiAgICBpZiAodGhpcy5zdG9yYWdlU2V0dGluZyAhPT0gbnVsbCkgdGhpcy5zdG9yYWdlU2V0dGluZy5zZXREZXNjKGRlc2MpO1xuICB9XG5cbiAgLy8gLS0tIHN0YXR1cyAvIGZlZWRiYWNrIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgcHJpdmF0ZSBzdGF0dXNUZXh0KCk6IHN0cmluZyB7XG4gICAgY29uc3QgZGF0YTogVmF1bHRTeW5jUGx1Z2luRGF0YSA9IHRoaXMucGx1Z2luLmRhdGE7XG4gICAgY29uc3Qgc3RhdHVzID0gdGhpcy5wbHVnaW4uY2xpZW50Py5zdGF0dXMoKTtcbiAgICBpZiAodGhpcy5wbHVnaW4uc3luY2luZ1BhdXNlZCkge1xuICAgICAgcmV0dXJuIFtcbiAgICAgICAgJ1N0YXRlOiBwYXVzZWQnLFxuICAgICAgICBgV29ya2VyOiAke2RhdGEudXJsfWAsXG4gICAgICAgICdWYXVsdCBjaGFuZ2VzIHN0YXkgbG9jYWwgdW50aWwgeW91IHJlc3VtZSBzeW5jaW5nLicsXG4gICAgICBdLmpvaW4oJ1xcbicpO1xuICAgIH1cbiAgICBpZiAoc3RhdHVzID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHJldHVybiBgTGlua2VkIHRvICR7ZGF0YS51cmx9IChkZXZpY2UgJHtkYXRhLmRldmljZU5hbWUgfHwgZGF0YS5kZXZpY2VJZH0pLmA7XG4gICAgfVxuICAgIGNvbnN0IGxhc3RTeW5jID1cbiAgICAgIHN0YXR1cy5sYXN0U3luY0F0ID09PSBudWxsXG4gICAgICAgID8gJ25ldmVyJ1xuICAgICAgICA6IGAke2Zvcm1hdFNpbmNlKERhdGUubm93KCkgLSBzdGF0dXMubGFzdFN5bmNBdCl9IGFnb2A7XG4gICAgY29uc3Qgc3RhdGUgPSBzdGF0dXMuc3RhdGUgPT09ICdsaXZlJyA/ICdjb25uZWN0ZWQnIDogc3RhdHVzLnN0YXRlO1xuICAgIHJldHVybiBbXG4gICAgICBgU3RhdGU6ICR7c3RhdGV9YCxcbiAgICAgIGBXb3JrZXI6ICR7ZGF0YS51cmx9YCxcbiAgICAgIGBMYXN0IHN5bmM6ICR7bGFzdFN5bmN9YCxcbiAgICAgIGBQZW5kaW5nIGNoYW5nZXM6ICR7c3RhdHVzLnBlbmRpbmd9YCxcbiAgICAgIGBDb25mbGljdHM6ICR7c3RhdHVzLmNvbmZsaWN0cy5sZW5ndGh9JHtzdGF0dXMuY29uZmxpY3RzLmxlbmd0aCA+IDAgPyAnIChjb25mbGljdCBjb3BpZXMgd2VyZSB3cml0dGVuIGludG8gdGhlIHZhdWx0KScgOiAnJ31gLFxuICAgIF0uam9pbignXFxuJyk7XG4gIH1cblxuICBwcml2YXRlIHJlZnJlc2hTdGF0dXMoKTogdm9pZCB7XG4gICAgdGhpcy5zdGF0dXNTZXR0aW5nPy5zZXREZXNjKHRoaXMuc3RhdHVzVGV4dCgpKTtcbiAgfVxuXG4gIC8qKiBQYWlyIGZlZWRiYWNrOiBzdWNjZXNzIHJlLXJlbmRlcnM7IGZhaWx1cmVzIGxhbmQgaW4gdGhlIGhpbnQgU2V0dGluZy4gKi9cbiAgcHJpdmF0ZSBzaG93T3V0Y29tZShvdXRjb21lOiBQYWlyT3V0Y29tZSk6IHZvaWQge1xuICAgIGlmIChvdXRjb21lLnN0YXR1cyA9PT0gJ3BhaXJlZCcpIHtcbiAgICAgIG5ldyBOb3RpY2UocGFpck91dGNvbWVNZXNzYWdlKG91dGNvbWUpKTtcbiAgICAgIHRoaXMuZGlzcGxheSgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBtZXNzYWdlID0gcGFpck91dGNvbWVNZXNzYWdlKG91dGNvbWUpO1xuICAgIG5ldyBOb3RpY2UobWVzc2FnZSwgMTAwMDApO1xuICAgIGlmICh0aGlzLmhpbnRTZXR0aW5nICE9PSBudWxsKSB0aGlzLmhpbnRTZXR0aW5nLnNldERlc2MobWVzc2FnZSk7XG4gIH1cblxuICAvLyAtLS0gbGl2ZSByZWZyZXNoIGxvb3AgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgLyoqIFJlZnJlc2ggdGhlIHN0YXR1cyByZWFkb3V0IH4xIEh6IHdoaWxlIHRoZSB0YWIgaXMgb3Blbi4gKi9cbiAgcHJpdmF0ZSBzdGFydFJlZnJlc2goKTogdm9pZCB7XG4gICAgdGhpcy5zdG9wUmVmcmVzaCgpO1xuICAgIGNvbnN0IGhhbmRsZSA9IHNldEludGVydmFsKCgpID0+IHRoaXMucmVmcmVzaFN0YXR1cygpLCAxMDAwKTtcbiAgICB0aGlzLnJlZnJlc2hIYW5kbGUgPSBoYW5kbGU7XG4gICAgLy8gT2JzaWRpYW4gY2xlYXJzIHJlZ2lzdGVyZWQgaW50ZXJ2YWxzIHdoZW4gdGhlIHBsdWdpbiB1bmxvYWRzIFx1MjAxNCBubyBsZWFrXG4gICAgLy8gZXZlbiBpZiB0aGUgc2V0dGluZ3MgbW9kYWwgaXMgZm9yY2UtY2xvc2VkLlxuICAgIHRoaXMucGx1Z2luLnJlZ2lzdGVySW50ZXJ2YWwoaGFuZGxlIGFzIHVua25vd24gYXMgbnVtYmVyKTtcbiAgfVxuXG4gIHByaXZhdGUgc3RvcFJlZnJlc2goKTogdm9pZCB7XG4gICAgaWYgKHRoaXMucmVmcmVzaEhhbmRsZSAhPT0gbnVsbCkge1xuICAgICAgY2xlYXJJbnRlcnZhbCh0aGlzLnJlZnJlc2hIYW5kbGUpO1xuICAgICAgdGhpcy5yZWZyZXNoSGFuZGxlID0gbnVsbDtcbiAgICB9XG4gIH1cbn1cbiIsICIvKipcbiAqIFN0YXR1cy1iYXIgaW5kaWNhdG9yIChwbHVnaW4gc2NvcGUgaXRlbSAjNSk6IGEgc21hbGwgcGFzc2l2ZSB2aWV3IG92ZXJcbiAqIGBTeW5jQ2xpZW50U3RhdHVzYCwgcmVwYWludGVkIGJ5IHRoZSBwbHVnaW4ncyAxIHMgc3VwZXJ2aXNpb24gdGljay5cbiAqXG4gKiAgIHZzYSBcdTIyRUYgICAgICAgICAgICAgIGNvbm5lY3RpbmcgLyBzeW5jaW5nXG4gKiAgIHZzYSBcdTI3MTMgMTJzICAgICAgICAgIGxpdmUsIGxhc3QgY29tcGxldGVkIGN5Y2xlIDEyIHMgYWdvXG4gKiAgIHZzYSBcdTI2QTAgY29uZmxpY3RzOiAyIGNvbmZsaWN0cyBvYnNlcnZlZCAoY29uZmxpY3QgY29waWVzIGV4aXN0IGluIHRoZSB2YXVsdClcbiAqICAgdnNhIFx1MjcxNyBvZmZsaW5lICAgICAgZGlzY29ubmVjdGVkIChyZWNvbm5lY3QgYmFja29mZiBydW5uaW5nKVxuICogICB2c2EgXHUyM0Y4ICAgICAgICAgICAgICBzeW5jaW5nIHBhdXNlZCAodGhlIFBhdXNlIHN5bmNpbmcgc2V0dGluZylcbiAqXG4gKiBDb21wYWN0IG1vZGUgZHJvcHMgdGhlIHRyYWlsaW5nIGRldGFpbCAoXCJ2c2EgXHUyNzEzIDEyc1wiIFx1MjE5MiBcInZzYSBcdTI3MTNcIiwgZXRjLik7XG4gKiBIaWRkZW4gbW9kZSByZW1vdmVzIHRoZSBpdGVtIGVudGlyZWx5ICh0aGUgcGx1Z2luIG5ldmVyIG1vdW50cyBpdCkuXG4gKlxuICogVGhlIHRvb2x0aXAgY2FycmllcyB0aGUgZGV0YWlsOiBzdGF0ZSwgd29ya2VyIFVSTCwgZGV2aWNlLCBsYXN0IHN5bmMsIHBlbmRpbmcuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBTeW5jQ2xpZW50U3RhdHVzIH0gZnJvbSAnQHZzYS9jb3JlJztcblxuLyoqIEhvdyB0aGUgc3RhdHVzLWJhciBpbmRpY2F0b3IgcmVuZGVycyAodGhlIFwiU3RhdHVzIGJhciBpbmRpY2F0b3JcIiBzZXR0aW5nKS4gKi9cbmV4cG9ydCB0eXBlIFN0YXR1c0Jhck1vZGUgPSAnZGV0YWlsZWQnIHwgJ2NvbXBhY3QnIHwgJ2hpZGRlbic7XG5cbi8qKiBUaGUgc2xpY2Ugb2YgSFRNTEVsZW1lbnQgdGhlIGluZGljYXRvciB0b3VjaGVzICh0ZXN0cyBwYXNzIGEgcGxhaW4gb2JqZWN0KS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU3RhdHVzSXRlbUxpa2Uge1xuICB0ZXh0Q29udGVudDogc3RyaW5nO1xuICBhZGRDbGFzcz8oY2xzOiBzdHJpbmcpOiB1bmtub3duO1xuICByZW1vdmVDbGFzcz8oY2xzOiBzdHJpbmcpOiB1bmtub3duO1xuICBzZXRBdHRyaWJ1dGU/KG5hbWU6IHN0cmluZywgdmFsdWU6IHN0cmluZyk6IHVua25vd247XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgU3RhdHVzQ29udGV4dCB7XG4gIHVybDogc3RyaW5nO1xuICBkZXZpY2VOYW1lOiBzdHJpbmc7XG4gIC8qKiBFeHRyYSBsaW5lIChlLmcuIGFuIGF1dGggZmFpbHVyZSBub3RlKSBhcHBlbmRlZCB0byB0aGUgdG9vbHRpcC4gKi9cbiAgbm90ZT86IHN0cmluZztcbiAgLyoqIFN5bmNpbmcgaXMgcGF1c2VkICh0aGUgUGF1c2Ugc3luY2luZyBidXR0b24pIFx1MjAxNCBzaG93cyBcInZzYSBcdTIzRjhcIi4gKi9cbiAgcGF1c2VkPzogYm9vbGVhbjtcbiAgLyoqIEluZGljYXRvciBtb2RlICh0aGUgcGx1Z2luJ3Mgc3RhdHVzIGJhciBzZXR0aW5nKTsgZGVmYXVsdCBkZXRhaWxlZC4gKi9cbiAgbW9kZT86IFN0YXR1c0Jhck1vZGU7XG59XG5cbi8qKiBgbm93IC0gc2luY2VgLCBmbG9vcmVkOiBgMTJzYCwgYDVtYCwgYDNoYCBcdTIwMTQgZGlzcGxheSBvbmx5LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdFNpbmNlKGVsYXBzZWRNczogbnVtYmVyKTogc3RyaW5nIHtcbiAgY29uc3Qgc2Vjb25kcyA9IE1hdGgubWF4KDAsIE1hdGguZmxvb3IoZWxhcHNlZE1zIC8gMTAwMCkpO1xuICBpZiAoc2Vjb25kcyA8IDYwKSByZXR1cm4gYCR7c2Vjb25kc31zYDtcbiAgY29uc3QgbWludXRlcyA9IE1hdGguZmxvb3Ioc2Vjb25kcyAvIDYwKTtcbiAgaWYgKG1pbnV0ZXMgPCA2MCkgcmV0dXJuIGAke21pbnV0ZXN9bWA7XG4gIHJldHVybiBgJHtNYXRoLmZsb29yKG1pbnV0ZXMgLyA2MCl9aGA7XG59XG5cbi8qKlxuICogVGhlIG9uZS1saW5lIHN0YXR1cyB0ZXh0IGZvciBhIGNsaWVudCBzdGF0dXMgYXQgdGltZSBgbm93YC4gYG1vZGVgIHNocmlua3NcbiAqIHRoZSBsaW5lIChjb21wYWN0IGRyb3BzIHRoZSB0cmFpbGluZyBkZXRhaWwpOyBgcGF1c2VkYCB3aW5zIG92ZXIgZXZlcnl0aGluZy5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN0YXR1c0xpbmVGb3IoXG4gIHN0YXR1czogU3luY0NsaWVudFN0YXR1cyxcbiAgbm93OiBudW1iZXIsXG4gIG1vZGU6IFN0YXR1c0Jhck1vZGUgPSAnZGV0YWlsZWQnLFxuICBwYXVzZWQgPSBmYWxzZSxcbik6IHN0cmluZyB7XG4gIGlmIChwYXVzZWQpIHJldHVybiAndnNhIFx1MjNGOCc7XG4gIGNvbnN0IGNvbXBhY3QgPSBtb2RlID09PSAnY29tcGFjdCc7XG4gIHN3aXRjaCAoc3RhdHVzLnN0YXRlKSB7XG4gICAgY2FzZSAnY29ubmVjdGluZyc6XG4gICAgY2FzZSAnc3luY2luZyc6XG4gICAgICByZXR1cm4gJ3ZzYSBcdTIyRUYnO1xuICAgIGNhc2UgJ2Rpc2Nvbm5lY3RlZCc6XG4gICAgICByZXR1cm4gY29tcGFjdCA/ICd2c2EgXHUyNzE3JyA6ICd2c2EgXHUyNzE3IG9mZmxpbmUnO1xuICAgIGNhc2UgJ2xpdmUnOlxuICAgICAgaWYgKHN0YXR1cy5jb25mbGljdHMubGVuZ3RoID4gMCkge1xuICAgICAgICByZXR1cm4gY29tcGFjdCA/ICd2c2EgXHUyNkEwJyA6IGB2c2EgXHUyNkEwIGNvbmZsaWN0czogJHtzdGF0dXMuY29uZmxpY3RzLmxlbmd0aH1gO1xuICAgICAgfVxuICAgICAgaWYgKHN0YXR1cy5sYXN0U3luY0F0ID09PSBudWxsIHx8IGNvbXBhY3QpIHJldHVybiAndnNhIFx1MjcxMyc7XG4gICAgICByZXR1cm4gYHZzYSBcdTI3MTMgJHtmb3JtYXRTaW5jZShub3cgLSBzdGF0dXMubGFzdFN5bmNBdCl9YDtcbiAgICBjYXNlICdpZGxlJzpcbiAgICAgIHJldHVybiAndnNhJztcbiAgfVxufVxuXG4vKiogVG9vbHRpcCBsaW5lcyAoam9pbmVkIHdpdGggYFxcbmApLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN0YXR1c1Rvb2x0aXBGb3Ioc3RhdHVzOiBTeW5jQ2xpZW50U3RhdHVzLCBjb250ZXh0OiBTdGF0dXNDb250ZXh0LCBub3c6IG51bWJlcik6IHN0cmluZyB7XG4gIGNvbnN0IHN0YXRlTGFiZWw6IFJlY29yZDxTeW5jQ2xpZW50U3RhdHVzWydzdGF0ZSddLCBzdHJpbmc+ID0ge1xuICAgIGlkbGU6ICdub3QgcnVubmluZycsXG4gICAgY29ubmVjdGluZzogJ2Nvbm5lY3RpbmdcdTIwMjYnLFxuICAgIHN5bmNpbmc6ICdzeW5jaW5nXHUyMDI2JyxcbiAgICBsaXZlOiAnbGl2ZScsXG4gICAgZGlzY29ubmVjdGVkOiAnb2ZmbGluZSBcdTIwMTQgcmVjb25uZWN0aW5nJyxcbiAgfTtcbiAgY29uc3QgaGVhZGxpbmUgPSBjb250ZXh0LnBhdXNlZCA9PT0gdHJ1ZSA/ICdwYXVzZWQnIDogc3RhdGVMYWJlbFtzdGF0dXMuc3RhdGVdO1xuICBjb25zdCBsaW5lcyA9IFtgVmF1bHRTeW5jIGZvciBBZ2VudHMgXHUyMDE0ICR7aGVhZGxpbmV9YF07XG4gIGlmIChjb250ZXh0LnVybCAhPT0gJycpIGxpbmVzLnB1c2goYFdvcmtlcjogJHtjb250ZXh0LnVybH1gKTtcbiAgaWYgKGNvbnRleHQuZGV2aWNlTmFtZSAhPT0gJycpIGxpbmVzLnB1c2goYERldmljZTogJHtjb250ZXh0LmRldmljZU5hbWV9YCk7XG4gIGxpbmVzLnB1c2goXG4gICAgc3RhdHVzLmxhc3RTeW5jQXQgPT09IG51bGxcbiAgICAgID8gJ0xhc3Qgc3luYzogbmV2ZXInXG4gICAgICA6IGBMYXN0IHN5bmM6ICR7Zm9ybWF0U2luY2Uobm93IC0gc3RhdHVzLmxhc3RTeW5jQXQpfSBhZ29gLFxuICApO1xuICBsaW5lcy5wdXNoKGBQZW5kaW5nIGNoYW5nZXM6ICR7c3RhdHVzLnBlbmRpbmd9YCk7XG4gIGxpbmVzLnB1c2goYENvbmZsaWN0czogJHtzdGF0dXMuY29uZmxpY3RzLmxlbmd0aH1gKTtcbiAgaWYgKHN0YXR1cy5jb25mbGljdHMubGVuZ3RoID4gMCkge1xuICAgIGxpbmVzLnB1c2goYENvbmZsaWN0IGNvcGllczogJHtzdGF0dXMuY29uZmxpY3RzLm1hcCgoYykgPT4gYy5wYXRoKS5qb2luKCcsICcpfWApO1xuICB9XG4gIGlmIChjb250ZXh0Lm5vdGUgIT09IHVuZGVmaW5lZCAmJiBjb250ZXh0Lm5vdGUgIT09ICcnKSBsaW5lcy5wdXNoKGNvbnRleHQubm90ZSk7XG4gIHJldHVybiBsaW5lcy5qb2luKCdcXG4nKTtcbn1cblxuLyoqIENTUyBtb2RpZmllciBmb3IgdGhlIGluZGljYXRvciAodGludGVkIHdhcm5pbmcvZXJyb3Igc3RhdGVzKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzdGF0dXNDbGFzc0ZvcihzdGF0dXM6IFN5bmNDbGllbnRTdGF0dXMpOiBzdHJpbmcge1xuICBpZiAoc3RhdHVzLnN0YXRlID09PSAnZGlzY29ubmVjdGVkJykgcmV0dXJuICd2c2EtZXJyb3InO1xuICBpZiAoc3RhdHVzLmNvbmZsaWN0cy5sZW5ndGggPiAwKSByZXR1cm4gJ3ZzYS13YXJuJztcbiAgcmV0dXJuICcnO1xufVxuXG4vKipcbiAqIFBhaW50cyBvbmUgc3RhdHVzLWJhciBpdGVtLiBQYXNzaXZlOiB0aGUgcGx1Z2luIGNhbGxzIGB1cGRhdGUoKWAgZnJvbSBpdHNcbiAqIHN1cGVydmlzaW9uIHRpY2sgXHUyMDE0IG5vIHRpbWVycyBvZiBpdHMgb3duIHRvIGxlYWsuXG4gKi9cbmV4cG9ydCBjbGFzcyBTdGF0dXNCYXJJbmRpY2F0b3Ige1xuICAvKiogQWx3YXlzIG9uIFx1MjAxNCB0aGUgYmFzZSBjbGFzcyBzdHlsZXMuY3NzIHRhcmdldHMuICovXG4gIHByaXZhdGUgc3RhdGljIHJlYWRvbmx5IEJBU0VfQ0xBU1MgPSAndnNhLXN0YXR1cyc7XG4gIHByaXZhdGUgc3RhdGljIHJlYWRvbmx5IE1PRElGSUVSX0NMQVNTRVMgPSBbJ3ZzYS13YXJuJywgJ3ZzYS1lcnJvciddO1xuXG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgaXRlbTogU3RhdHVzSXRlbUxpa2UpIHt9XG5cbiAgdXBkYXRlKHN0YXR1czogU3luY0NsaWVudFN0YXR1cywgY29udGV4dDogU3RhdHVzQ29udGV4dCwgbm93OiBudW1iZXIpOiB2b2lkIHtcbiAgICB0aGlzLml0ZW0udGV4dENvbnRlbnQgPSBzdGF0dXNMaW5lRm9yKHN0YXR1cywgbm93LCBjb250ZXh0Lm1vZGUgPz8gJ2RldGFpbGVkJywgY29udGV4dC5wYXVzZWQgPT09IHRydWUpO1xuICAgIHRoaXMuaXRlbS5hZGRDbGFzcz8uKFN0YXR1c0JhckluZGljYXRvci5CQVNFX0NMQVNTKTtcbiAgICBjb25zdCBtb2RpZmllciA9IHN0YXR1c0NsYXNzRm9yKHN0YXR1cyk7XG4gICAgZm9yIChjb25zdCBjbHMgb2YgU3RhdHVzQmFySW5kaWNhdG9yLk1PRElGSUVSX0NMQVNTRVMpIHtcbiAgICAgIGlmIChjbHMgPT09IG1vZGlmaWVyKSB0aGlzLml0ZW0uYWRkQ2xhc3M/LihjbHMpO1xuICAgICAgZWxzZSB0aGlzLml0ZW0ucmVtb3ZlQ2xhc3M/LihjbHMpO1xuICAgIH1cbiAgICB0aGlzLml0ZW0uc2V0QXR0cmlidXRlPy4oJ3RpdGxlJywgc3RhdHVzVG9vbHRpcEZvcihzdGF0dXMsIGNvbnRleHQsIG5vdykpO1xuICB9XG59XG4iLCAiLyoqXG4gKiBgV2ViU29ja2V0VHJhbnNwb3J0YCBcdTIwMTQgY29yZSdzIGBUcmFuc3BvcnRgIG92ZXIgdGhlIGdsb2JhbCBgV2ViU29ja2V0YFxuICogKHByZXNlbnQgaW4gT2JzaWRpYW4gZGVza3RvcCAqYW5kKiBtb2JpbGU7IGZlYXR1cmUtY2hlY2tlZCB3aXRoIGEgY2xlYXJcbiAqIGVycm9yIGZvciBleG90aWMgYnVpbGRzKS5cbiAqXG4gKiBUaGlzIG1pcnJvcnMgYEB2c2Evbm9kZS1ydW50aW1lYCdzIHRyYW5zcG9ydCBvbiBwdXJwb3NlIChzYW1lIHdpcmUgZm9ybWF0OlxuICogb25lIEpTT04gdGV4dCBmcmFtZSBwZXIgbWVzc2FnZSwgY29yZSdzIGBwYXJzZU1lc3NhZ2VgIG9uIHJlY2VpdmUsIHF1ZXVlZFxuICogc2VuZHMgYmVmb3JlIG9wZW4pIGJ1dCBzaGFyZXMgbm8gY29kZSB3aXRoIGl0IFx1MjAxNCBgQHZzYS9ub2RlLXJ1bnRpbWVgIGlzXG4gKiBOb2RlLW9ubHkgYW5kIG11c3QgbmV2ZXIgYmUgYSBwbHVnaW4gZGVwZW5kZW5jeS5cbiAqL1xuXG5pbXBvcnQgeyBOZXR3b3JrRXJyb3IsIHBhcnNlTWVzc2FnZSB9IGZyb20gJ0B2c2EvY29yZSc7XG5pbXBvcnQgdHlwZSB7IENsb3NlUmVhc29uLCBNZXNzYWdlLCBUcmFuc3BvcnQgfSBmcm9tICdAdnNhL2NvcmUnO1xuXG4vKipcbiAqIFRoZSBtaW5pbWFsIFdlYlNvY2tldCBzdXJmYWNlIHRoaXMgdHJhbnNwb3J0IG5lZWRzLiBJbmplY3RhYmxlIHNvIHRlc3RzXG4gKiAoYW5kIGV4b3RpYyBydW50aW1lcykgY2FuIHN1cHBseSBhIGZha2U7IHByb2R1Y3Rpb24gdXNlcyB0aGUgZ2xvYmFsLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFdlYlNvY2tldExpa2Uge1xuICBzZW5kKGRhdGE6IHN0cmluZyk6IHZvaWQ7XG4gIGNsb3NlKGNvZGU/OiBudW1iZXIsIHJlYXNvbj86IHN0cmluZyk6IHZvaWQ7XG4gIGFkZEV2ZW50TGlzdGVuZXIodHlwZTogJ29wZW4nLCBsaXN0ZW5lcjogKCkgPT4gdm9pZCk6IHZvaWQ7XG4gIGFkZEV2ZW50TGlzdGVuZXIodHlwZTogJ21lc3NhZ2UnLCBsaXN0ZW5lcjogKGV2ZW50OiB7IGRhdGE6IHVua25vd24gfSkgPT4gdm9pZCk6IHZvaWQ7XG4gIGFkZEV2ZW50TGlzdGVuZXIodHlwZTogJ2Nsb3NlJywgbGlzdGVuZXI6IChldmVudDogeyBjb2RlPzogbnVtYmVyOyByZWFzb24/OiBzdHJpbmcgfSkgPT4gdm9pZCk6IHZvaWQ7XG4gIGFkZEV2ZW50TGlzdGVuZXIodHlwZTogJ2Vycm9yJywgbGlzdGVuZXI6IChldmVudDogdW5rbm93bikgPT4gdm9pZCk6IHZvaWQ7XG59XG5cbmV4cG9ydCB0eXBlIFdlYlNvY2tldEZhY3RvcnkgPSAodXJsOiBzdHJpbmcpID0+IFdlYlNvY2tldExpa2U7XG5cbmV4cG9ydCBpbnRlcmZhY2UgV2ViU29ja2V0VHJhbnNwb3J0T3B0aW9ucyB7XG4gIC8qKiBXb3JrZXIgb3JpZ2luIChgaHR0cHM6Ly9wZXJzb25hbC54LndvcmtlcnMuZGV2YCkgb3IgYSBgd3Mocyk6Ly9gIFVSTC4gKi9cbiAgdXJsOiBzdHJpbmc7XG4gIC8qKiBEZXZpY2UgdG9rZW4gXHUyMDE0IGNhcnJpZWQgaW4gdGhlIHF1ZXJ5IHN0cmluZyAodGhlIHdvcmtlcidzIHByZS1hdXRoIHBhdGgpLiAqL1xuICB0b2tlbjogc3RyaW5nO1xuICAvKiogV1MgcGF0aCBvbiB0aGUgd29ya2VyIChkZWZhdWx0IGAvd3NgOyBgL3N5bmNgIGlzIGVxdWl2YWxlbnQpLiAqL1xuICBwYXRoPzogc3RyaW5nO1xuICAvKiogSW5qZWN0YWJsZSBzb2NrZXQgZmFjdG9yeSAodGVzdHMpLiBEZWZhdWx0OiB0aGUgZ2xvYmFsIGBXZWJTb2NrZXRgLiAqL1xuICB3c0ZhY3Rvcnk/OiBXZWJTb2NrZXRGYWN0b3J5O1xufVxuXG4vKipcbiAqIEJ1aWxkIHRoZSBhdXRoZW50aWNhdGVkIFdTIFVSTDogYGh0dHBzOi8veGAgXHUyMTkyIGB3c3M6Ly94L3dzP3Rva2VuPVx1MjAyNmAuXG4gKiBUaHJvd3Mgb24gbm9uLUhUVFAoUykvV1Mgc2NoZW1lcyBvciB1bnBhcnNhYmxlIGlucHV0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gdG9XZWJTb2NrZXRVcmwoYmFzZVVybDogc3RyaW5nLCB0b2tlbjogc3RyaW5nLCBwYXRoID0gJy93cycpOiBzdHJpbmcge1xuICBjb25zdCB1cmwgPSBuZXcgVVJMKGJhc2VVcmwpO1xuICBpZiAodXJsLnByb3RvY29sID09PSAnaHR0cDonKSB1cmwucHJvdG9jb2wgPSAnd3M6JztcbiAgZWxzZSBpZiAodXJsLnByb3RvY29sID09PSAnaHR0cHM6JykgdXJsLnByb3RvY29sID0gJ3dzczonO1xuICBlbHNlIGlmICh1cmwucHJvdG9jb2wgIT09ICd3czonICYmIHVybC5wcm90b2NvbCAhPT0gJ3dzczonKSB7XG4gICAgdGhyb3cgbmV3IE5ldHdvcmtFcnJvcihgd29ya2VyIFVSTCBtdXN0IGJlIGh0dHAocyk6Ly8gb3Igd3Mocyk6Ly8sIGdvdCAke3VybC5wcm90b2NvbH1gKTtcbiAgfVxuICB1cmwucGF0aG5hbWUgPSBwYXRoO1xuICB1cmwuc2VhcmNoID0gJyc7XG4gIHVybC5zZWFyY2hQYXJhbXMuc2V0KCd0b2tlbicsIHRva2VuKTtcbiAgcmV0dXJuIHVybC50b1N0cmluZygpO1xufVxuXG5mdW5jdGlvbiBkZWZhdWx0V2ViU29ja2V0RmFjdG9yeSh1cmw6IHN0cmluZyk6IFdlYlNvY2tldExpa2Uge1xuICBjb25zdCB3ZWJzb2NrZXQgPSAoZ2xvYmFsVGhpcyBhcyB7IFdlYlNvY2tldD86IHVua25vd24gfSkuV2ViU29ja2V0O1xuICBpZiAodHlwZW9mIHdlYnNvY2tldCAhPT0gJ2Z1bmN0aW9uJykge1xuICAgIHRocm93IG5ldyBOZXR3b3JrRXJyb3IoXG4gICAgICAnV2ViU29ja2V0IGlzIG5vdCBhdmFpbGFibGUgaW4gdGhpcyBPYnNpZGlhbiBidWlsZCAoaXQgaXMgYnVpbHQgaW4gb24gZGVza3RvcCBhbmQgJyArXG4gICAgICAgICdtb2JpbGU7IGEgdmVyeSBvbGQgYXBwIHZlcnNpb24gb3IgYSBzdHJpcHBlZCB3ZWJ2aWV3IGlzIHRoZSBvbmx5IGtub3duIGNhdXNlKS4gJyArXG4gICAgICAgICdTeW5jIHJlcXVpcmVzIGl0LicsXG4gICAgKTtcbiAgfVxuICByZXR1cm4gbmV3ICh3ZWJzb2NrZXQgYXMgbmV3ICh1cmw6IHN0cmluZykgPT4gV2ViU29ja2V0TGlrZSkodXJsKTtcbn1cblxuZXhwb3J0IGNsYXNzIFdlYlNvY2tldFRyYW5zcG9ydCBpbXBsZW1lbnRzIFRyYW5zcG9ydCB7XG4gIHByaXZhdGUgcmVhZG9ubHkgc29ja2V0OiBXZWJTb2NrZXRMaWtlO1xuICBwcml2YXRlIG1lc3NhZ2VDYWxsYmFjazogKChtZXNzYWdlOiBNZXNzYWdlKSA9PiB2b2lkKSB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGNsb3NlQ2FsbGJhY2s6ICgocmVhc29uOiBDbG9zZVJlYXNvbikgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBvcGVuID0gZmFsc2U7XG4gIHByaXZhdGUgY2xvc2VkID0gZmFsc2U7XG4gIHByaXZhdGUgY2xvc2VOb3RpZmllZCA9IGZhbHNlO1xuICBwcml2YXRlIHJlYWRvbmx5IHNlbmRRdWV1ZTogc3RyaW5nW10gPSBbXTtcbiAgcHJpdmF0ZSBsYXN0RXJyb3I6IHN0cmluZyB8IHVuZGVmaW5lZDtcblxuICBjb25zdHJ1Y3RvcihvcHRpb25zOiBXZWJTb2NrZXRUcmFuc3BvcnRPcHRpb25zKSB7XG4gICAgY29uc3QgZmFjdG9yeSA9IG9wdGlvbnMud3NGYWN0b3J5ID8/IGRlZmF1bHRXZWJTb2NrZXRGYWN0b3J5O1xuICAgIGNvbnN0IHVybCA9IHRvV2ViU29ja2V0VXJsKG9wdGlvbnMudXJsLCBvcHRpb25zLnRva2VuLCBvcHRpb25zLnBhdGggPz8gJy93cycpO1xuICAgIHRoaXMuc29ja2V0ID0gZmFjdG9yeSh1cmwpO1xuXG4gICAgdGhpcy5zb2NrZXQuYWRkRXZlbnRMaXN0ZW5lcignb3BlbicsICgpID0+IHtcbiAgICAgIHRoaXMub3BlbiA9IHRydWU7XG4gICAgICBjb25zdCBxdWV1ZWQgPSBbLi4udGhpcy5zZW5kUXVldWVdO1xuICAgICAgdGhpcy5zZW5kUXVldWUubGVuZ3RoID0gMDtcbiAgICAgIGZvciAoY29uc3QgZnJhbWUgb2YgcXVldWVkKSB0aGlzLnNvY2tldC5zZW5kKGZyYW1lKTtcbiAgICB9KTtcblxuICAgIHRoaXMuc29ja2V0LmFkZEV2ZW50TGlzdGVuZXIoJ21lc3NhZ2UnLCAoZXZlbnQpID0+IHtcbiAgICAgIGlmICh0eXBlb2YgZXZlbnQuZGF0YSAhPT0gJ3N0cmluZycpIHtcbiAgICAgICAgdGhpcy5mYWlsKHsgY29kZTogMTAwMywgcmVhc29uOiAnYmluYXJ5IGZyYW1lcyBhcmUgbm90IHBhcnQgb2YgdGhlIHByb3RvY29sJyB9KTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgbGV0IG1lc3NhZ2U6IE1lc3NhZ2U7XG4gICAgICB0cnkge1xuICAgICAgICBtZXNzYWdlID0gcGFyc2VNZXNzYWdlKGV2ZW50LmRhdGEpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdGhpcy5mYWlsKHsgY29kZTogMTAwMiwgcmVhc29uOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcikgfSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHRoaXMubWVzc2FnZUNhbGxiYWNrPy4obWVzc2FnZSk7XG4gICAgfSk7XG5cbiAgICB0aGlzLnNvY2tldC5hZGRFdmVudExpc3RlbmVyKCdlcnJvcicsIChldmVudCkgPT4ge1xuICAgICAgdGhpcy5sYXN0RXJyb3IgPVxuICAgICAgICBldmVudCBpbnN0YW5jZW9mIEVycm9yID8gZXZlbnQubWVzc2FnZSA6IGV2ZW50ICE9PSB1bmRlZmluZWQgPyBTdHJpbmcoZXZlbnQpIDogJ3NvY2tldCBlcnJvcic7XG4gICAgfSk7XG5cbiAgICB0aGlzLnNvY2tldC5hZGRFdmVudExpc3RlbmVyKCdjbG9zZScsIChldmVudCkgPT4ge1xuICAgICAgdGhpcy5maW5pc2hDbG9zZSh7XG4gICAgICAgIGNvZGU6IGV2ZW50LmNvZGUsXG4gICAgICAgIHJlYXNvbjogZXZlbnQucmVhc29uICE9PSB1bmRlZmluZWQgJiYgZXZlbnQucmVhc29uICE9PSAnJyA/IGV2ZW50LnJlYXNvbiA6IHRoaXMubGFzdEVycm9yLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBzZW5kKG1lc3NhZ2U6IE1lc3NhZ2UpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5jbG9zZWQpIHRocm93IG5ldyBOZXR3b3JrRXJyb3IoJ3NlbmQgb24gYSBjbG9zZWQgdHJhbnNwb3J0Jyk7XG4gICAgY29uc3QgZnJhbWUgPSBKU09OLnN0cmluZ2lmeShtZXNzYWdlKTtcbiAgICBpZiAodGhpcy5vcGVuKSB7XG4gICAgICB0aGlzLnNvY2tldC5zZW5kKGZyYW1lKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5zZW5kUXVldWUucHVzaChmcmFtZSk7XG4gIH1cblxuICBvbk1lc3NhZ2UoY2FsbGJhY2s6IChtZXNzYWdlOiBNZXNzYWdlKSA9PiB2b2lkKTogdm9pZCB7XG4gICAgdGhpcy5tZXNzYWdlQ2FsbGJhY2sgPSBjYWxsYmFjaztcbiAgfVxuXG4gIG9uQ2xvc2UoY2FsbGJhY2s6IChyZWFzb246IENsb3NlUmVhc29uKSA9PiB2b2lkKTogdm9pZCB7XG4gICAgdGhpcy5jbG9zZUNhbGxiYWNrID0gY2FsbGJhY2s7XG4gIH1cblxuICBjbG9zZSgpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5jbG9zZWQpIHJldHVybjtcbiAgICB0aGlzLmNsb3NlZCA9IHRydWU7XG4gICAgdGhpcy5zZW5kUXVldWUubGVuZ3RoID0gMDtcbiAgICB0cnkge1xuICAgICAgdGhpcy5zb2NrZXQuY2xvc2UoMTAwMCwgJ2Nsb3NlZCBieSBjYWxsZXInKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIGFscmVhZHkgZGVhZCBcdTIwMTQgdGhlIGNsb3NlIGV2ZW50IG1heSBuZXZlciBhcnJpdmVcbiAgICB9XG4gICAgLy8gTm90aWZ5IGV2ZW4gaWYgdGhlIHNvY2tldCBuZXZlciBlbWl0cyAnY2xvc2UnIChmYWlsZWQgZGlhbCkuXG4gICAgdGhpcy5maW5pc2hDbG9zZSh7IGNvZGU6IDEwMDAsIHJlYXNvbjogJ2Nsb3NlZCBieSBjYWxsZXInIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBmYWlsKHJlYXNvbjogQ2xvc2VSZWFzb24pOiB2b2lkIHtcbiAgICB0aGlzLmNsb3NlZCA9IHRydWU7XG4gICAgdHJ5IHtcbiAgICAgIHRoaXMuc29ja2V0LmNsb3NlKHJlYXNvbi5jb2RlID8/IDEwMDIsIHJlYXNvbi5yZWFzb24gPz8gJycpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gYWxyZWFkeSBjbG9zZWRcbiAgICB9XG4gICAgdGhpcy5maW5pc2hDbG9zZShyZWFzb24pO1xuICB9XG5cbiAgcHJpdmF0ZSBmaW5pc2hDbG9zZShyZWFzb246IENsb3NlUmVhc29uKTogdm9pZCB7XG4gICAgdGhpcy5vcGVuID0gZmFsc2U7XG4gICAgdGhpcy5jbG9zZWQgPSB0cnVlO1xuICAgIGlmICh0aGlzLmNsb3NlTm90aWZpZWQpIHJldHVybjtcbiAgICB0aGlzLmNsb3NlTm90aWZpZWQgPSB0cnVlO1xuICAgIHRoaXMuY2xvc2VDYWxsYmFjaz8uKHJlYXNvbik7XG4gIH1cbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTs7O0FDY0EsSUFBQUEsbUJBQStCOzs7QUNLeEIsSUFBTSx3QkFBTixjQUFvQyxNQUFNO0FBQUEsRUFDL0MsWUFBWSxTQUFpQjtBQUMzQixVQUFNLE9BQU87QUFDYixTQUFLLE9BQU87QUFBQSxFQUNkO0FBQ0Y7QUFhTyxTQUFTLG1CQUFtQixPQUEwQjtBQUMzRCxNQUFJLE9BQU8sVUFBVSxVQUFVO0FBQzdCLFVBQU0sSUFBSSxzQkFBc0Isb0NBQW9DLE9BQU8sS0FBSyxFQUFFO0FBQUEsRUFDcEY7QUFDQSxNQUFJLE1BQU0sU0FBUyxJQUFJLEdBQUc7QUFDeEIsVUFBTSxJQUFJLHNCQUFzQixpQ0FBaUMsS0FBSyxVQUFVLEtBQUssQ0FBQyxFQUFFO0FBQUEsRUFDMUY7QUFDQSxNQUFJLGFBQWEsS0FBSyxLQUFLLEdBQUc7QUFDNUIsVUFBTSxJQUFJO0FBQUEsTUFDUixnRUFBZ0UsS0FBSyxVQUFVLEtBQUssQ0FBQztBQUFBLElBQ3ZGO0FBQUEsRUFDRjtBQUNBLE1BQUksTUFBTSxXQUFXLE1BQU0sR0FBRztBQUM1QixVQUFNLElBQUk7QUFBQSxNQUNSLHNDQUFzQyxLQUFLLFVBQVUsS0FBSyxDQUFDO0FBQUEsSUFDN0Q7QUFBQSxFQUNGO0FBRUEsUUFBTSxZQUFZLE1BQU0sUUFBUSxPQUFPLEdBQUc7QUFDMUMsTUFBSSxVQUFVLFdBQVcsSUFBSSxHQUFH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Q2xCLFdBQUssYUFBYTtBQUNsQixXQUFLLFFBQVEsTUFBTSxTQUFTLEtBQUs7QUFDakMsVUFBSTtBQUFBLFFBQ0Y7QUFBQSxRQUNBO0FBQUEsTUFDRjtBQUNBO0FBQUEsSUFDRjtBQUNBLFNBQUssUUFBUSxLQUFLLFNBQVMsS0FBSztBQUFBLEVBQ2xDO0FBQUE7QUFBQSxFQUdBLE1BQWMsc0JBQXNCLFNBQWdEO0FBQ2xGLFFBQUk7QUFDSixRQUFJO0FBQ0YsWUFBTSxRQUFRLE1BQU0sUUFBUSxTQUFTLHdCQUF3QjtBQUM3RCxlQUFTLEtBQUssTUFBTSxJQUFJLFlBQVksRUFBRSxPQUFPLEtBQUssQ0FBQztBQUFBLElBQ3JELFNBQVE7QUFDTjtBQUFBLElBQ0Y7QUFDQSxRQUNFLE9BQU8sT0FBTyxhQUFhLFlBQzNCLE9BQU8sYUFBYSxLQUFLLEtBQUssVUFDOUI7QUFDQSxZQUFNLE9BQU8sT0FBTyxPQUFPLGVBQWUsV0FBVyxPQUFPLGFBQWEsT0FBTztBQUNoRixZQUFNLFFBQVEsT0FBTyxPQUFPLFFBQVEsV0FBVyxPQUFPLE1BQU07QUFDNUQsVUFBSTtBQUFBLFFBQ0YsNERBQTRELElBQUksZ0JBQWdCLEtBQUs7QUFBQSxRQUdyRjtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUNGO0FBRUEsU0FBUyx1QkFBdUIsT0FBdUI7QUFDckQsTUFBSTtBQUNGLFdBQU8sbUJBQW1CLEtBQUs7QUFBQSxFQUNqQyxTQUFRO0FBQ04sV0FBTztBQUFBLEVBQ1Q7QUFDRjsiLAogICJuYW1lcyI6IFsiaW1wb3J0X29ic2lkaWFuIiwgIl9hIiwgIl9iIiwgIl9jIiwgIl9kIiwgIl9lIiwgImltcG9ydF9vYnNpZGlhbiIsICJpbXBvcnRfb2JzaWRpYW4iLCAiaW1wb3J0X29ic2lkaWFuIiwgIl9hIiwgIl9hIl0KfQo=
