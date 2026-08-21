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
var import_obsidian4 = require("obsidian");

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
  return false;
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
    this.ignoreSettings = { obsidianSync: helloAck.settings.obsidianSync };
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

// src/data.ts
var import_obsidian = require("obsidian");
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
      obsidianSync: false
    }
  };
}
function normalizePluginData(raw) {
  var _a, _b;
  const base = defaultPluginData();
  if (typeof raw !== "object" || raw === null) return base;
  const source = raw;
  return {
    url: typeof source.url === "string" ? source.url : "",
    token: typeof source.token === "string" ? source.token : "",
    deviceId: typeof source.deviceId === "string" ? source.deviceId : "",
    deviceName: typeof source.deviceName === "string" ? source.deviceName : "",
    settings: {
      rescanIntervalSec: typeof ((_a = source.settings) == null ? void 0 : _a.rescanIntervalSec) === "number" && source.settings.rescanIntervalSec >= 0 ? Math.floor(source.settings.rescanIntervalSec) : DEFAULT_RESCAN_INTERVAL_SEC,
      obsidianSync: ((_b = source.settings) == null ? void 0 : _b.obsidianSync) === true
    }
  };
}
function isLinked(data) {
  return data.url !== "" && data.token !== "" && data.deviceId !== "";
}
function detectDeviceType() {
  return import_obsidian.Platform.isMobileApp ? "mobile" : "desktop";
}
function defaultDeviceName() {
  if (import_obsidian.Platform.isMobileApp) {
    if (import_obsidian.Platform.isIosApp) return "iPhone/iPad";
    if (import_obsidian.Platform.isAndroidApp) return "Android";
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
var import_obsidian2 = require("obsidian");
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
        new import_obsidian2.Notice(`VaultSync deep link: ${parsed.error}`);
      }
      return;
    }
    void onPair(parsed.link).catch((error) => {
      console.error("[vsa] deep-link pairing failed", error);
      new import_obsidian2.Notice("VaultSync: pairing via link failed \u2014 see the console for details.");
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
var import_obsidian3 = require("obsidian");

// src/statusbar.ts
function formatSince(elapsedMs) {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1e3));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h`;
}
function statusLineFor(status, now) {
  switch (status.state) {
    case "connecting":
    case "syncing":
      return "vsa \u22EF";
    case "disconnected":
      return "vsa \u2717 offline";
    case "live":
      if (status.conflicts.length > 0) return `vsa \u26A0 conflicts: ${status.conflicts.length}`;
      if (status.lastSyncAt === null) return "vsa \u2713";
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
  const lines = [`VaultSync for Agents \u2014 ${stateLabel[status.state]}`];
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
    var _a, _b, _c, _d, _e, _f, _g, _h;
    this.item.textContent = statusLineFor(status, now);
    (_b = (_a = this.item).addClass) == null ? void 0 : _b.call(_a, _StatusBarIndicator.BASE_CLASS);
    const modifier = statusClassFor(status);
    for (const cls of _StatusBarIndicator.MODIFIER_CLASSES) {
      if (cls === modifier) (_d = (_c = this.item).addClass) == null ? void 0 : _d.call(_c, cls);
      else (_f = (_e = this.item).removeClass) == null ? void 0 : _f.call(_e, cls);
    }
    (_h = (_g = this.item).setAttribute) == null ? void 0 : _h.call(_g, "title", statusTooltipFor(status, context, now));
  }
};
/** Always on — the base class styles.css targets. */
__publicField(_StatusBarIndicator, "BASE_CLASS", "vsa-status");
__publicField(_StatusBarIndicator, "MODIFIER_CLASSES", ["vsa-warn", "vsa-error"]);
var StatusBarIndicator = _StatusBarIndicator;

// src/settings.ts
var DEPLOY_URL = "https://deploy.workers.cloudflare.com/?url=https://github.com/vaultsyncforagents/vaultsyncforagents-template";
function openDeployPage() {
  if (typeof window === "undefined") return;
  window.open(DEPLOY_URL, "_blank");
}
var ConfirmModal = class extends import_obsidian3.Modal {
  constructor(app, options) {
    super(app);
    __publicField(this, "options", options);
  }
  onOpen() {
    new import_obsidian3.Setting(this.contentEl).setName(this.options.title).setDesc(this.options.body);
    new import_obsidian3.Setting(this.contentEl).addButton(
      (button) => button.setButtonText("Cancel").onClick(() => this.close())
    );
    new import_obsidian3.Setting(this.contentEl).addButton(
      (button) => button.setCta().setButtonText(this.options.confirmText).onClick(async () => {
        this.close();
        await this.options.onConfirm();
      })
    );
  }
};
var VaultSyncSettingTab = class extends import_obsidian3.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    __publicField(this, "plugin");
    /** Pairing codes never touch disk — they are one-time, short-lived secrets. */
    __publicField(this, "pairingCode", "");
    __publicField(this, "hintSetting", null);
    __publicField(this, "statusSetting", null);
    __publicField(this, "refreshHandle", null);
    this.plugin = plugin;
  }
  display() {
    this.stopRefresh();
    const { containerEl } = this;
    containerEl.empty();
    this.hintSetting = null;
    this.statusSetting = null;
    this.renderConnectionSection();
    if (this.plugin.linked) {
      this.renderLinkedSection();
    } else {
      this.renderPairingSection();
    }
    this.startRefresh();
  }
  hide() {
    this.stopRefresh();
  }
  // --- sections -----------------------------------------------------------------
  renderConnectionSection() {
    const { containerEl } = this;
    new import_obsidian3.Setting(containerEl).setName("Worker URL").setDesc(
      'Your sync worker, e.g. https://personal.x.workers.dev. No worker yet? Use "Deploy your worker" below, open the URL in a browser, and claim it.'
    ).addText(
      (text) => text.setPlaceholder("https://personal.x.workers.dev").setValue(this.plugin.data.url).onChange(async (value) => {
        this.plugin.data.url = value.trim();
        await this.plugin.savePluginData();
      })
    );
    new import_obsidian3.Setting(containerEl).setName("Device name").setDesc(`Shown in the worker dashboard's device list. Applies when (re)pairing.`).addText(
      (text) => text.setPlaceholder(defaultDeviceName()).setValue(this.plugin.data.deviceName).onChange(async (value) => {
        this.plugin.data.deviceName = value.trim();
        await this.plugin.savePluginData();
      })
    );
  }
  renderPairingSection() {
    const { containerEl } = this;
    new import_obsidian3.Setting(containerEl).setName("Pairing code").setDesc("From your worker dashboard: Devices \u2192 Pair new device. Codes are one-time and expire after 10 minutes.").addText(
      (text) => text.setPlaceholder("7F3K-Q9M2").onChange((value) => {
        this.pairingCode = value.trim();
      })
    );
    new import_obsidian3.Setting(containerEl).addButton(
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
    this.hintSetting = new import_obsidian3.Setting(containerEl).setName("Getting started").setClass("vsa-settings-hint").setDesc(
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
  renderLinkedSection() {
    const { containerEl } = this;
    const data = this.plugin.data;
    this.statusSetting = new import_obsidian3.Setting(containerEl).setName("Status").setClass("vsa-status-readout").setDesc(this.statusText());
    new import_obsidian3.Setting(containerEl).addButton(
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
    new import_obsidian3.Setting(containerEl).setName("Rescan interval").setDesc(
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
    new import_obsidian3.Setting(containerEl).setName("Sync .obsidian/ folder").setDesc(
      "Opt in to syncing .obsidian/ (settings and plugins), excluding workspace.json and caches. The worker\u2019s per-vault setting takes precedence once connected."
    ).addToggle(
      (toggle) => toggle.setValue(data.settings.obsidianSync).onChange(async (value) => {
        await this.plugin.applyObsidianSync(value);
      })
    );
    new import_obsidian3.Setting(containerEl).addButton(
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
  // --- status / feedback -----------------------------------------------------------
  statusText() {
    var _a;
    const data = this.plugin.data;
    const status = (_a = this.plugin.client) == null ? void 0 : _a.status();
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
      new import_obsidian3.Notice(pairOutcomeMessage(outcome));
      this.display();
      return;
    }
    const message = pairOutcomeMessage(outcome);
    new import_obsidian3.Notice(message, 1e4);
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
var VaultSyncPlugin = class extends import_obsidian4.Plugin {
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
    __publicField(this, "syncLog", {
      debug: (...args) => console.debug("[vsa]", ...args),
      info: (...args) => console.info("[vsa]", ...args),
      warn: (...args) => console.warn("[vsa]", ...args),
      error: (...args) => console.error("[vsa]", ...args)
    });
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
    this.addSettingTab(new VaultSyncSettingTab(this.app, this));
    registerPairProtocolHandler(
      (action, handler) => this.registerObsidianProtocolHandler(action, handler),
      (link) => this.handlePairDeepLink(link.url, link.code)
    );
    this.registerEvent(this.app.workspace.on("active-leaf-change", () => {
      var _a;
      return (_a = this.rescan) == null ? void 0 : _a.poke();
    }));
    if (this.linked) await this.startSync();
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
        new import_obsidian4.Notice("VaultSync: this vault is already paired with that worker.");
      } else {
        new import_obsidian4.Notice(
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
      new import_obsidian4.Notice(pairOutcomeMessage(outcome), 1e4);
      return;
    }
    this.data.url = outcome.url;
    this.data.token = outcome.token;
    this.data.deviceId = outcome.deviceId;
    this.data.deviceName = deviceName;
    await this.savePluginData();
    await this.writeDeviceMarker();
    new import_obsidian4.Notice(pairOutcomeMessage(outcome));
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
      transport: () => new WebSocketTransport({ url, token, wsFactory: this.overrides.wsFactory }),
      blobStore: new HttpBlobStore({ baseUrl: url, token, fetchImpl: this.fetchImpl }),
      storage,
      settings: { obsidianSync: this.data.settings.obsidianSync },
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
    const item = this.addStatusBarItem();
    this.statusBarItem = item;
    this.statusBar = new StatusBarIndicator(item);
    const tick = setInterval(() => this.onTick(), SUPERVISION_TICK_MS);
    this.tickHandle = tick;
    this.registerInterval(tick);
    this.onTick();
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
    const client = this.client;
    if (client === null) {
      new import_obsidian4.Notice("VaultSync: not paired yet \u2014 add your worker URL and a pairing code in settings.");
      return;
    }
    try {
      await client.triggerSync();
      const status = client.status();
      new import_obsidian4.Notice(
        status.state === "disconnected" ? "VaultSync: offline \u2014 changes will sync when the worker is reachable." : "VaultSync: up to date."
      );
    } catch (error) {
      this.handleSyncError(error, "sync now failed");
      new import_obsidian4.Notice("VaultSync: sync failed \u2014 see the developer console for details.");
    }
  }
  async unlink() {
    this.stopSync();
    const storage = new ObsidianStorageAdapter({ adapter: this.app.vault.adapter });
    await storage.deleteFile(DEVICE_MARKER_VAULT_PATH);
    await storage.deleteFile(LOCAL_INDEX_VAULT_PATH);
    this.data = {
      ...defaultPluginData(),
      deviceName: this.data.deviceName,
      settings: this.data.settings
    };
    await this.savePluginData();
    new import_obsidian4.Notice(
      "VaultSync: unlinked. Revoke this device from the worker dashboard if you are done with it."
    );
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
    new import_obsidian4.Notice(
      enabled ? "VaultSync: .obsidian/ will sync after the next reconnect (the worker\u2019s per-vault setting takes precedence)." : "VaultSync: .obsidian/ will be excluded after the next reconnect."
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
      { url: this.data.url, deviceName: this.resolveDeviceName(), note: this.statusNote },
      this.now()
    );
    if (this.authFailed) return;
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
      new import_obsidian4.Notice(
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
      new import_obsidian4.Notice(
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiLCAic3JjL3BsdWdpbi50cyIsICIuLi9jb3JlL3NyYy9wYXRocy50cyIsICIuLi9jb3JlL3NyYy9jbG9jay50cyIsICIuLi9jb3JlL3NyYy9oYXNoaW5nLnRzIiwgIi4uL2NvcmUvc3JjL2Vycm9ycy50cyIsICIuLi9jb3JlL3NyYy9sb2NhbGluZGV4LnRzIiwgIi4uL2NvcmUvc3JjL2VuZ2luZS50cyIsICIuLi9jb3JlL3NyYy9pZ25vcmUudHMiLCAiLi4vY29yZS9zcmMvcHJvdG9jb2wudHMiLCAiLi4vY29yZS9zcmMvY29uZmxpY3RuYW1lcy50cyIsICIuLi9jb3JlL3NyYy9yZXNvbHZlLnRzIiwgIi4uL2NvcmUvc3JjL3NjYW4udHMiLCAiLi4vY29yZS9zcmMvY2xpZW50LnRzIiwgInNyYy9hZGFwdGVycy9vYnNpZGlhbi1zdG9yYWdlLnRzIiwgInNyYy9hZGFwdGVycy9vYnNpZGlhbi13YXRjaC50cyIsICJzcmMvYmxvYnN0b3JlLnRzIiwgInNyYy9kYXRhLnRzIiwgInNyYy93b3JrZXJhcGkudHMiLCAic3JjL3BhaXJpbmcudHMiLCAic3JjL3Byb3RvY29sLWhhbmRsZXIudHMiLCAic3JjL3JlY29ubmVjdC50cyIsICJzcmMvc2V0dGluZ3MudHMiLCAic3JjL3N0YXR1c2Jhci50cyIsICJzcmMvdHJhbnNwb3J0LnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyIvKipcbiAqIFBsdWdpbiBlbnRyeSBwb2ludCBcdTIwMTQgT2JzaWRpYW4gbG9hZHMgYG1haW4uanNgIGFuZCBpbnN0YW50aWF0ZXMgdGhlIGRlZmF1bHRcbiAqIGV4cG9ydC4gRXZlcnl0aGluZyByZWFsIGxpdmVzIGluIGBwbHVnaW4udHNgIChhbmQgaXRzIG1vZHVsZXMpOyB0aGlzIGZpbGVcbiAqIG9ubHkgcmUtZXhwb3J0cy5cbiAqL1xuXG5leHBvcnQgeyBWYXVsdFN5bmNQbHVnaW4gYXMgZGVmYXVsdCB9IGZyb20gJy4vcGx1Z2luLmpzJztcbiIsICIvKipcbiAqIGBWYXVsdFN5bmNQbHVnaW5gIFx1MjAxNCB0aGUgT2JzaWRpYW4gY2xpZW50IChkZXNrdG9wICsgbW9iaWxlKS5cbiAqXG4gKiBvbmxvYWQ6IGxvYWQgbGluayBpZGVudGl0eSBcdTIxOTIgaWYgbGlua2VkLCBidWlsZCBgU3luY0NsaWVudGAgKGNvcmUpIG92ZXIgdGhlXG4gKiBPYnNpZGlhbiBhZGFwdGVycyBhbmQgcnVuIHN0YXJ0dXAgcmVjb25jaWxpYXRpb24gKHRoZSBzeW5jLW9uLW9wZW5cbiAqIGNvbnRyYWN0LCBGUi00L0ZSLTUvRlItMTIpLCB0aGVuIGVudGVyIGxpdmUgbW9kZSAodmF1bHQgZXZlbnRzICsgcGVyaW9kaWNcbiAqIHJlc2NhbiArIGZvY3VzIHJlc2Nhbikgd2l0aCBhIHN0YXR1cy1iYXIgaW5kaWNhdG9yIGFuZCBqaXR0ZXJlZFxuICogZXhwb25lbnRpYWwtYmFja29mZiByZWNvbm5lY3QgKGNhcHBlZCBhdCA2MCBzKS5cbiAqXG4gKiBBIDEgSHogXCJzdXBlcnZpc2lvbiB0aWNrXCIgZHJpdmVzIGV2ZXJ5dGhpbmcgdGltZS1iYXNlZDogaXQgcmVwYWludHMgdGhlXG4gKiBzdGF0dXMgYmFyIGFuZCBub3RpY2VzIGBkaXNjb25uZWN0ZWRgIFx1MjE5MiBzY2hlZHVsZXMgb25lIHJlY29ubmVjdCBhdCBhIHRpbWUuXG4gKiBBbGwgdGltZXJzIGFyZSBvd25lZCBoZXJlIGFuZCB0b3JuIGRvd24gaW4gYHN0b3BTeW5jKClgL2BvbnVubG9hZGAuXG4gKi9cblxuaW1wb3J0IHsgTm90aWNlLCBQbHVnaW4gfSBmcm9tICdvYnNpZGlhbic7XG5pbXBvcnQgdHlwZSB7IEFwcCwgUGx1Z2luTWFuaWZlc3QgfSBmcm9tICdvYnNpZGlhbic7XG5pbXBvcnQgeyBSZXZva2VkRXJyb3IsIFN5bmNDbGllbnQsIFVuYXV0aG9yaXplZEVycm9yIH0gZnJvbSAnQHZzYS9jb3JlJztcbmltcG9ydCB0eXBlIHsgTG9nQWRhcHRlciB9IGZyb20gJ0B2c2EvY29yZSc7XG5pbXBvcnQgeyBPYnNpZGlhblN0b3JhZ2VBZGFwdGVyIH0gZnJvbSAnLi9hZGFwdGVycy9vYnNpZGlhbi1zdG9yYWdlLmpzJztcbmltcG9ydCB7IE9ic2lkaWFuV2F0Y2hBZGFwdGVyLCBSZXNjYW5TY2hlZHVsZXIgfSBmcm9tICcuL2FkYXB0ZXJzL29ic2lkaWFuLXdhdGNoLmpzJztcbmltcG9ydCB7IEh0dHBCbG9iU3RvcmUgfSBmcm9tICcuL2Jsb2JzdG9yZS5qcyc7XG5pbXBvcnQge1xuICBkZWZhdWx0RGV2aWNlTmFtZSxcbiAgZGV0ZWN0RGV2aWNlVHlwZSxcbiAgaXNMaW5rZWQsXG4gIG5vcm1hbGl6ZVBsdWdpbkRhdGEsXG4gIGRlZmF1bHRQbHVnaW5EYXRhLFxuICB0eXBlIFZhdWx0U3luY1BsdWdpbkRhdGEsXG59IGZyb20gJy4vZGF0YS5qcyc7XG5pbXBvcnQgeyBwYWlyT3V0Y29tZU1lc3NhZ2UsIHBhaXJXaXRoV29ya2VyIH0gZnJvbSAnLi9wYWlyaW5nLmpzJztcbmltcG9ydCB0eXBlIHsgUGFpck91dGNvbWUgfSBmcm9tICcuL3BhaXJpbmcuanMnO1xuaW1wb3J0IHsgcmVnaXN0ZXJQYWlyUHJvdG9jb2xIYW5kbGVyIH0gZnJvbSAnLi9wcm90b2NvbC1oYW5kbGVyLmpzJztcbmltcG9ydCB7IFJlY29ubmVjdFN1cGVydmlzb3IgfSBmcm9tICcuL3JlY29ubmVjdC5qcyc7XG5pbXBvcnQgdHlwZSB7IEJhY2tvZmZPcHRpb25zIH0gZnJvbSAnLi9yZWNvbm5lY3QuanMnO1xuaW1wb3J0IHsgVmF1bHRTeW5jU2V0dGluZ1RhYiB9IGZyb20gJy4vc2V0dGluZ3MuanMnO1xuaW1wb3J0IHsgU3RhdHVzQmFySW5kaWNhdG9yIH0gZnJvbSAnLi9zdGF0dXNiYXIuanMnO1xuaW1wb3J0IHsgV2ViU29ja2V0VHJhbnNwb3J0IH0gZnJvbSAnLi90cmFuc3BvcnQuanMnO1xuaW1wb3J0IHR5cGUgeyBXZWJTb2NrZXRGYWN0b3J5IH0gZnJvbSAnLi90cmFuc3BvcnQuanMnO1xuaW1wb3J0IHsgbm9ybWFsaXplV29ya2VyVXJsIH0gZnJvbSAnLi93b3JrZXJhcGkuanMnO1xuXG4vKiogVGhlIGluLXZhdWx0IGRldmljZSBtYXJrZXIgc2hhcmVkIHdpdGggdGhlIGRhZW1vbi9DTEkgKEZSLTQ0IGhhbmRzaGFrZSkuICovXG5jb25zdCBERVZJQ0VfTUFSS0VSX1ZBVUxUX1BBVEggPSAnLy52YXVsdHN5bmNmb3JhZ2VudHMvZGV2aWNlLmpzb24nO1xuY29uc3QgTE9DQUxfSU5ERVhfVkFVTFRfUEFUSCA9ICcvLnZhdWx0c3luY2ZvcmFnZW50cy9zdGF0ZSc7XG5jb25zdCBTVVBFUlZJU0lPTl9USUNLX01TID0gMTAwMDtcblxuLyoqIFRpbWVyIGhhbmRsZXMgKG51bWJlciBpbiB0aGUgRE9NLCBgVGltZW91dGAgd2hlbiBOb2RlIHR5cGVzIGxlYWsgaW4pLiAqL1xudHlwZSBUaW1lckhhbmRsZSA9IFJldHVyblR5cGU8dHlwZW9mIHNldEludGVydmFsPjtcblxuLyoqIEluamVjdGFibGUgc2VhbXMgc28gdW5pdCB0ZXN0cyBuZWVkIG5vIHJlYWwgT2JzaWRpYW4vbmV0d29yay4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUGx1Z2luT3ZlcnJpZGVzIHtcbiAgZmV0Y2hJbXBsPzogdHlwZW9mIGZldGNoO1xuICB3c0ZhY3Rvcnk/OiBXZWJTb2NrZXRGYWN0b3J5O1xuICBub3c/OiAoKSA9PiBudW1iZXI7XG4gIC8qKiBSZWNvbm5lY3QgYmFja29mZiBrbm9icyAodGVzdHMgaW5qZWN0IGEgZGV0ZXJtaW5pc3RpYyByYW5kb20pLiAqL1xuICByZWNvbm5lY3Q/OiBCYWNrb2ZmT3B0aW9ucztcbn1cblxuZXhwb3J0IGNsYXNzIFZhdWx0U3luY1BsdWdpbiBleHRlbmRzIFBsdWdpbiB7XG4gIGRhdGE6IFZhdWx0U3luY1BsdWdpbkRhdGEgPSBkZWZhdWx0UGx1Z2luRGF0YSgpO1xuICAvKiogVGhlIGxpdmUgc3luYyBjbGllbnQgKG51bGwgd2hpbGUgdW5saW5rZWQvc3RvcHBlZCkuICovXG4gIGNsaWVudDogU3luY0NsaWVudCB8IG51bGwgPSBudWxsO1xuXG4gIHByaXZhdGUgcmVhZG9ubHkgb3ZlcnJpZGVzOiBQbHVnaW5PdmVycmlkZXM7XG4gIHByaXZhdGUgd2F0Y2hlcjogT2JzaWRpYW5XYXRjaEFkYXB0ZXIgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSByZXNjYW46IFJlc2NhblNjaGVkdWxlciB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHN0YXR1c0JhcjogU3RhdHVzQmFySW5kaWNhdG9yIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgc3RhdHVzQmFySXRlbTogSFRNTEVsZW1lbnQgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSB0aWNrSGFuZGxlOiBUaW1lckhhbmRsZSB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHJlY29ubmVjdFRpbWVyOiBUaW1lckhhbmRsZSB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHN1cGVydmlzb3IgPSBuZXcgUmVjb25uZWN0U3VwZXJ2aXNvcigpO1xuICAvKiogU2V0IHdoZW4gdGhlIHdvcmtlciByZWplY3RlZCB0aGUgdG9rZW4gXHUyMDE0IHJlY29ubmVjdGluZyBjYW5ub3QgaGVscC4gKi9cbiAgcHJpdmF0ZSBhdXRoRmFpbGVkID0gZmFsc2U7XG4gIHByaXZhdGUgc3RhdHVzTm90ZSA9ICcnO1xuICBwcml2YXRlIHJlYWRvbmx5IHN5bmNMb2c6IExvZ0FkYXB0ZXIgPSB7XG4gICAgZGVidWc6ICguLi5hcmdzOiB1bmtub3duW10pID0+IGNvbnNvbGUuZGVidWcoJ1t2c2FdJywgLi4uYXJncyksXG4gICAgaW5mbzogKC4uLmFyZ3M6IHVua25vd25bXSkgPT4gY29uc29sZS5pbmZvKCdbdnNhXScsIC4uLmFyZ3MpLFxuICAgIHdhcm46ICguLi5hcmdzOiB1bmtub3duW10pID0+IGNvbnNvbGUud2FybignW3ZzYV0nLCAuLi5hcmdzKSxcbiAgICBlcnJvcjogKC4uLmFyZ3M6IHVua25vd25bXSkgPT4gY29uc29sZS5lcnJvcignW3ZzYV0nLCAuLi5hcmdzKSxcbiAgfTtcblxuICBjb25zdHJ1Y3RvcihhcHA6IEFwcCwgbWFuaWZlc3Q6IFBsdWdpbk1hbmlmZXN0LCBvdmVycmlkZXM6IFBsdWdpbk92ZXJyaWRlcyA9IHt9KSB7XG4gICAgc3VwZXIoYXBwLCBtYW5pZmVzdCk7XG4gICAgdGhpcy5vdmVycmlkZXMgPSBvdmVycmlkZXM7XG4gIH1cblxuICBwcml2YXRlIGdldCBub3coKTogKCkgPT4gbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy5vdmVycmlkZXMubm93ID8/ICgoKSA9PiBEYXRlLm5vdygpKTtcbiAgfVxuXG4gIHByaXZhdGUgZ2V0IGZldGNoSW1wbCgpOiB0eXBlb2YgZmV0Y2gge1xuICAgIC8vIEJpbmQgYXQgdGhlIHNlYW06IGNvbnN1bWVycyAocGFpcmluZywgYEh0dHBCbG9iU3RvcmVgKSBpbnZva2UgdGhpcyBhcyBhXG4gICAgLy8gZGV0YWNoZWQgZnVuY3Rpb24sIGFuZCBhIGRldGFjaGVkIGBmZXRjaGAgdGhyb3dzXG4gICAgLy8gYFR5cGVFcnJvcjogRmFpbGVkIHRvIGV4ZWN1dGUgJ2ZldGNoJyBvbiAnV2luZG93JzogSWxsZWdhbCBpbnZvY2F0aW9uYFxuICAgIC8vIGluIENocm9taXVtIHJlbmRlcmVycyBcdTIwMTQgaS5lLiBpbiByZWFsIE9ic2lkaWFuIChkZXNrdG9wIGFuZCBtb2JpbGUpLlxuICAgIC8vIEJpbmRpbmcgdG8gdGhlIGdsb2JhbCBtYWtlcyB0aGUgZGVmYXVsdCBzYWZlIHRvIGNhbGwgYmFyZS5cbiAgICByZXR1cm4gdGhpcy5vdmVycmlkZXMuZmV0Y2hJbXBsID8/IGdsb2JhbFRoaXMuZmV0Y2guYmluZChnbG9iYWxUaGlzKTtcbiAgfVxuXG4gIGdldCBsaW5rZWQoKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIGlzTGlua2VkKHRoaXMuZGF0YSk7XG4gIH1cblxuICBvdmVycmlkZSBhc3luYyBvbmxvYWQoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5kYXRhID0gbm9ybWFsaXplUGx1Z2luRGF0YShhd2FpdCB0aGlzLmxvYWREYXRhKCkpO1xuICAgIHRoaXMuYWRkU2V0dGluZ1RhYihuZXcgVmF1bHRTeW5jU2V0dGluZ1RhYih0aGlzLmFwcCwgdGhpcykpO1xuICAgIHJlZ2lzdGVyUGFpclByb3RvY29sSGFuZGxlcihcbiAgICAgIChhY3Rpb24sIGhhbmRsZXIpID0+IHRoaXMucmVnaXN0ZXJPYnNpZGlhblByb3RvY29sSGFuZGxlcihhY3Rpb24sIGhhbmRsZXIpLFxuICAgICAgKGxpbmspID0+IHRoaXMuaGFuZGxlUGFpckRlZXBMaW5rKGxpbmsudXJsLCBsaW5rLmNvZGUpLFxuICAgICk7XG4gICAgLy8gQ2hlYXAgZm9jdXMtZHJpdmVuIHJlc2NhbiAoRlItMTIpOiBldmVyeSBub3RlL2FwcCBzd2l0Y2ggcG9rZXMgdGhlXG4gICAgLy8gc2NoZWR1bGVyLCB3aGljaCBjb2FsZXNjZXMgaW50byBhdCBtb3N0IG9uZSBjeWNsZSBwZXIgZGVib3VuY2Ugd2luZG93LlxuICAgIHRoaXMucmVnaXN0ZXJFdmVudCh0aGlzLmFwcC53b3Jrc3BhY2Uub24oJ2FjdGl2ZS1sZWFmLWNoYW5nZScsICgpID0+IHRoaXMucmVzY2FuPy5wb2tlKCkpKTtcbiAgICBpZiAodGhpcy5saW5rZWQpIGF3YWl0IHRoaXMuc3RhcnRTeW5jKCk7XG4gIH1cblxuICBvdmVycmlkZSBvbnVubG9hZCgpOiB2b2lkIHtcbiAgICB0aGlzLnN0b3BTeW5jKCk7XG4gIH1cblxuICAvLyAtLS0gcGVyc2lzdGVuY2UgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICBhc3luYyBzYXZlUGx1Z2luRGF0YSgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLnNhdmVEYXRhKHRoaXMuZGF0YSk7XG4gIH1cblxuICAvLyAtLS0gcGFpcmluZyAoc2V0dGluZ3MgdGFiICsgZGVlcCBsaW5rKSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIC8qKiBQYWlyIGZyb20gdGhlIHNldHRpbmdzIGZvcm0gKGZpZWxkcyBhbHJlYWR5IGxpdmUgaW4gYHRoaXMuZGF0YWApLiAqL1xuICBhc3luYyBwYWlyRnJvbVNldHRpbmdzKGNvZGU6IHN0cmluZyk6IFByb21pc2U8UGFpck91dGNvbWU+IHtcbiAgICBjb25zdCBkZXZpY2VOYW1lID0gdGhpcy5yZXNvbHZlRGV2aWNlTmFtZSgpO1xuICAgIGNvbnN0IG91dGNvbWUgPSBhd2FpdCBwYWlyV2l0aFdvcmtlcih7XG4gICAgICB1cmw6IHRoaXMuZGF0YS51cmwsXG4gICAgICBjb2RlLFxuICAgICAgZGV2aWNlTmFtZSxcbiAgICAgIGRldmljZVR5cGU6IGRldGVjdERldmljZVR5cGUoKSxcbiAgICAgIGZldGNoSW1wbDogdGhpcy5mZXRjaEltcGwsXG4gICAgfSk7XG4gICAgYXdhaXQgdGhpcy5hcHBseVBhaXJPdXRjb21lKG91dGNvbWUsIGRldmljZU5hbWUpO1xuICAgIHJldHVybiBvdXRjb21lO1xuICB9XG5cbiAgLyoqIG9ic2lkaWFuOi8vdmF1bHRzeW5jZm9yYWdlbnRzL3BhaXI/dXJsPVx1MjAyNiZjb2RlPVx1MjAyNiAocHJvdG9jb2wtaGFuZGxlci50cykuICovXG4gIHByaXZhdGUgYXN5bmMgaGFuZGxlUGFpckRlZXBMaW5rKHVybDogc3RyaW5nLCBjb2RlOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAodGhpcy5saW5rZWQpIHtcbiAgICAgIGlmIChub3JtYWxpemVXb3JrZXJVcmxTYWZlKHVybCkgPT09IG5vcm1hbGl6ZVdvcmtlclVybFNhZmUodGhpcy5kYXRhLnVybCkpIHtcbiAgICAgICAgbmV3IE5vdGljZSgnVmF1bHRTeW5jOiB0aGlzIHZhdWx0IGlzIGFscmVhZHkgcGFpcmVkIHdpdGggdGhhdCB3b3JrZXIuJyk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBuZXcgTm90aWNlKFxuICAgICAgICAgICdWYXVsdFN5bmM6IHRoaXMgdmF1bHQgaXMgcGFpcmVkIHdpdGggYSBkaWZmZXJlbnQgd29ya2VyLiBVbmxpbmsgaXQgaW4gc2V0dGluZ3MgZmlyc3QuJyxcbiAgICAgICAgICAxMDAwMCxcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgZGV2aWNlTmFtZSA9IHRoaXMucmVzb2x2ZURldmljZU5hbWUoKTtcbiAgICBjb25zdCBvdXRjb21lID0gYXdhaXQgcGFpcldpdGhXb3JrZXIoe1xuICAgICAgdXJsLFxuICAgICAgY29kZSxcbiAgICAgIGRldmljZU5hbWUsXG4gICAgICBkZXZpY2VUeXBlOiBkZXRlY3REZXZpY2VUeXBlKCksXG4gICAgICBmZXRjaEltcGw6IHRoaXMuZmV0Y2hJbXBsLFxuICAgIH0pO1xuICAgIGF3YWl0IHRoaXMuYXBwbHlQYWlyT3V0Y29tZShvdXRjb21lLCBkZXZpY2VOYW1lKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgYXBwbHlQYWlyT3V0Y29tZShvdXRjb21lOiBQYWlyT3V0Y29tZSwgZGV2aWNlTmFtZTogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKG91dGNvbWUuc3RhdHVzICE9PSAncGFpcmVkJykge1xuICAgICAgbmV3IE5vdGljZShwYWlyT3V0Y29tZU1lc3NhZ2Uob3V0Y29tZSksIDEwMDAwKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5kYXRhLnVybCA9IG91dGNvbWUudXJsO1xuICAgIHRoaXMuZGF0YS50b2tlbiA9IG91dGNvbWUudG9rZW47XG4gICAgdGhpcy5kYXRhLmRldmljZUlkID0gb3V0Y29tZS5kZXZpY2VJZDtcbiAgICB0aGlzLmRhdGEuZGV2aWNlTmFtZSA9IGRldmljZU5hbWU7XG4gICAgYXdhaXQgdGhpcy5zYXZlUGx1Z2luRGF0YSgpO1xuICAgIGF3YWl0IHRoaXMud3JpdGVEZXZpY2VNYXJrZXIoKTtcbiAgICBuZXcgTm90aWNlKHBhaXJPdXRjb21lTWVzc2FnZShvdXRjb21lKSk7XG4gICAgYXdhaXQgdGhpcy5zdGFydFN5bmMoKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVzb2x2ZURldmljZU5hbWUoKTogc3RyaW5nIHtcbiAgICBjb25zdCB0eXBlZCA9IHRoaXMuZGF0YS5kZXZpY2VOYW1lLnRyaW0oKTtcbiAgICByZXR1cm4gdHlwZWQgIT09ICcnID8gdHlwZWQgOiBkZWZhdWx0RGV2aWNlTmFtZSgpO1xuICB9XG5cbiAgLyoqIFdyaXRlIHRoZSBGUi00NCBtYXJrZXIgdGhlIENMSS9kYWVtb24gcmVhZCB0byBkZXRlY3QgZG91YmxlLWNsaWVudHMuICovXG4gIHByaXZhdGUgYXN5bmMgd3JpdGVEZXZpY2VNYXJrZXIoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCF0aGlzLmxpbmtlZCkgcmV0dXJuO1xuICAgIGNvbnN0IHN0b3JhZ2UgPSBuZXcgT2JzaWRpYW5TdG9yYWdlQWRhcHRlcih7IGFkYXB0ZXI6IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIgfSk7XG4gICAgY29uc3QgbWFya2VyID0ge1xuICAgICAgZGV2aWNlSWQ6IHRoaXMuZGF0YS5kZXZpY2VJZCxcbiAgICAgIGRldmljZU5hbWU6IHRoaXMucmVzb2x2ZURldmljZU5hbWUoKSxcbiAgICAgIHVybDogdGhpcy5kYXRhLnVybCxcbiAgICAgIGxpbmtlZEF0OiB0aGlzLm5vdygpLFxuICAgIH07XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHN0b3JhZ2Uud3JpdGVGaWxlKFxuICAgICAgICBERVZJQ0VfTUFSS0VSX1ZBVUxUX1BBVEgsXG4gICAgICAgIG5ldyBUZXh0RW5jb2RlcigpLmVuY29kZShgJHtKU09OLnN0cmluZ2lmeShtYXJrZXIsIG51bGwsIDIpfVxcbmApLFxuICAgICAgKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5zeW5jTG9nLndhcm4oJ2ZhaWxlZCB0byB3cml0ZSBkZXZpY2UgbWFya2VyJywgZXJyb3IpO1xuICAgIH1cbiAgfVxuXG4gIC8vIC0tLSBzeW5jIGxpZmVjeWNsZSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICAvKiogQnVpbGQgZXZlcnl0aGluZyBhbmQgcnVuIHN0YXJ0dXAgcmVjb25jaWxpYXRpb24gKGlkZW1wb3RlbnQgcmVzdGFydCkuICovXG4gIHByaXZhdGUgYXN5bmMgc3RhcnRTeW5jKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmICghdGhpcy5saW5rZWQpIHJldHVybjtcbiAgICB0aGlzLnN0b3BTeW5jKCk7XG5cbiAgICBjb25zdCB7IHVybCwgdG9rZW4sIGRldmljZUlkIH0gPSB0aGlzLmRhdGE7XG4gICAgY29uc3QgZGV2aWNlTmFtZSA9IHRoaXMucmVzb2x2ZURldmljZU5hbWUoKTtcbiAgICBjb25zdCBzdG9yYWdlID0gbmV3IE9ic2lkaWFuU3RvcmFnZUFkYXB0ZXIoeyBhZGFwdGVyOiB0aGlzLmFwcC52YXVsdC5hZGFwdGVyIH0pO1xuICAgIGF3YWl0IHRoaXMud2FybklmRm9yZWlnblN0YXRlRGlyKHN0b3JhZ2UpO1xuXG4gICAgY29uc3QgY2xpZW50ID0gbmV3IFN5bmNDbGllbnQoe1xuICAgICAgZGV2aWNlSWQsXG4gICAgICBkZXZpY2VOYW1lLFxuICAgICAgdG9rZW4sXG4gICAgICB0cmFuc3BvcnQ6ICgpID0+IG5ldyBXZWJTb2NrZXRUcmFuc3BvcnQoeyB1cmwsIHRva2VuLCB3c0ZhY3Rvcnk6IHRoaXMub3ZlcnJpZGVzLndzRmFjdG9yeSB9KSxcbiAgICAgIGJsb2JTdG9yZTogbmV3IEh0dHBCbG9iU3RvcmUoeyBiYXNlVXJsOiB1cmwsIHRva2VuLCBmZXRjaEltcGw6IHRoaXMuZmV0Y2hJbXBsIH0pLFxuICAgICAgc3RvcmFnZSxcbiAgICAgIHNldHRpbmdzOiB7IG9ic2lkaWFuU3luYzogdGhpcy5kYXRhLnNldHRpbmdzLm9ic2lkaWFuU3luYyB9LFxuICAgICAgbG9nOiB0aGlzLnN5bmNMb2csXG4gICAgICBub3c6IHRoaXMubm93LFxuICAgIH0pO1xuICAgIHRoaXMuY2xpZW50ID0gY2xpZW50O1xuICAgIHRoaXMuYXV0aEZhaWxlZCA9IGZhbHNlO1xuICAgIHRoaXMuc3RhdHVzTm90ZSA9ICcnO1xuICAgIHRoaXMuc3VwZXJ2aXNvciA9IG5ldyBSZWNvbm5lY3RTdXBlcnZpc29yKHRoaXMub3ZlcnJpZGVzLnJlY29ubmVjdCA/PyB7fSk7XG5cbiAgICB0cnkge1xuICAgICAgYXdhaXQgY2xpZW50LmNvbm5lY3QoKTsgLy8gc3RhcnR1cCByZWNvbmNpbGlhdGlvbiBcdTIxOTIgbGl2ZSBtb2RlXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIHRoaXMuaGFuZGxlU3luY0Vycm9yKGVycm9yLCAnc3RhcnR1cCBzeW5jIGZhaWxlZCcpO1xuICAgIH1cblxuICAgIC8vIExpdmUgd2F0Y2hpbmc6IHZhdWx0IGV2ZW50cyAoZGVib3VuY2VkIGluIGNvcmUpICsgcmVzY2FuIGhvb2tzLlxuICAgIHRoaXMud2F0Y2hlciA9IG5ldyBPYnNpZGlhbldhdGNoQWRhcHRlcih7IHZhdWx0OiB0aGlzLmFwcC52YXVsdCB9KTtcbiAgICBjbGllbnQuc3RhcnRXYXRjaGluZyh0aGlzLndhdGNoZXIpO1xuICAgIHRoaXMucmVzY2FuID0gbmV3IFJlc2NhblNjaGVkdWxlcih7XG4gICAgICBpbnRlcnZhbE1zOiB0aGlzLmRhdGEuc2V0dGluZ3MucmVzY2FuSW50ZXJ2YWxTZWMgKiAxMDAwLFxuICAgIH0pO1xuICAgIHRoaXMucmVzY2FuLnN0YXJ0KCgpID0+IHtcbiAgICAgIHZvaWQgY2xpZW50LnRyaWdnZXJTeW5jKCkuY2F0Y2goKGVycm9yOiB1bmtub3duKSA9PiB7XG4gICAgICAgIHRoaXMuaGFuZGxlU3luY0Vycm9yKGVycm9yLCAncmVzY2FuIGZhaWxlZCcpO1xuICAgICAgfSk7XG4gICAgfSk7XG5cbiAgICAvLyBTdGF0dXMgYmFyICsgdGhlIDEgSHogc3VwZXJ2aXNpb24gdGljayB0aGF0IHJlcGFpbnRzIGl0IGFuZCBzdXBlcnZpc2VzXG4gICAgLy8gcmVjb25uZWN0aW9uLlxuICAgIGNvbnN0IGl0ZW0gPSB0aGlzLmFkZFN0YXR1c0Jhckl0ZW0oKTtcbiAgICB0aGlzLnN0YXR1c0Jhckl0ZW0gPSBpdGVtO1xuICAgIHRoaXMuc3RhdHVzQmFyID0gbmV3IFN0YXR1c0JhckluZGljYXRvcihpdGVtKTtcbiAgICBjb25zdCB0aWNrID0gc2V0SW50ZXJ2YWwoKCkgPT4gdGhpcy5vblRpY2soKSwgU1VQRVJWSVNJT05fVElDS19NUyk7XG4gICAgdGhpcy50aWNrSGFuZGxlID0gdGljaztcbiAgICB0aGlzLnJlZ2lzdGVySW50ZXJ2YWwodGljayBhcyB1bmtub3duIGFzIG51bWJlcik7IC8vIE9ic2lkaWFuIGNsZWFycyB0aGlzIG9uIHVubG9hZFxuICAgIHRoaXMub25UaWNrKCk7XG4gIH1cblxuICAvKiogVGVhciBkb3duIGV2ZXJ5IHRpbWVyLCB3YXRjaGVyLCBzb2NrZXQsIGFuZCBVSSBhcnRpZmFjdC4gSWRlbXBvdGVudC4gKi9cbiAgcHJpdmF0ZSBzdG9wU3luYygpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5yZWNvbm5lY3RUaW1lciAhPT0gbnVsbCkge1xuICAgICAgY2xlYXJUaW1lb3V0KHRoaXMucmVjb25uZWN0VGltZXIpO1xuICAgICAgdGhpcy5yZWNvbm5lY3RUaW1lciA9IG51bGw7XG4gICAgfVxuICAgIGlmICh0aGlzLnRpY2tIYW5kbGUgIT09IG51bGwpIHtcbiAgICAgIGNsZWFySW50ZXJ2YWwodGhpcy50aWNrSGFuZGxlKTtcbiAgICAgIHRoaXMudGlja0hhbmRsZSA9IG51bGw7XG4gICAgfVxuICAgIHRoaXMucmVzY2FuPy5zdG9wKCk7XG4gICAgdGhpcy5yZXNjYW4gPSBudWxsO1xuICAgIHRoaXMuY2xpZW50Py5jbG9zZSgpOyAvLyBhbHNvIHN0b3BzIHRoZSB3YXRjaGVyXG4gICAgdGhpcy5jbGllbnQgPSBudWxsO1xuICAgIHRoaXMud2F0Y2hlciA9IG51bGw7XG4gICAgdGhpcy5zdGF0dXNCYXJJdGVtPy5yZW1vdmUoKTtcbiAgICB0aGlzLnN0YXR1c0Jhckl0ZW0gPSBudWxsO1xuICAgIHRoaXMuc3RhdHVzQmFyID0gbnVsbDtcbiAgfVxuXG4gIC8vIC0tLSB1c2VyIGFjdGlvbnMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIGFzeW5jIHN5bmNOb3coKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgY2xpZW50ID0gdGhpcy5jbGllbnQ7XG4gICAgaWYgKGNsaWVudCA9PT0gbnVsbCkge1xuICAgICAgbmV3IE5vdGljZSgnVmF1bHRTeW5jOiBub3QgcGFpcmVkIHlldCBcdTIwMTQgYWRkIHlvdXIgd29ya2VyIFVSTCBhbmQgYSBwYWlyaW5nIGNvZGUgaW4gc2V0dGluZ3MuJyk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRyeSB7XG4gICAgICBhd2FpdCBjbGllbnQudHJpZ2dlclN5bmMoKTtcbiAgICAgIGNvbnN0IHN0YXR1cyA9IGNsaWVudC5zdGF0dXMoKTtcbiAgICAgIG5ldyBOb3RpY2UoXG4gICAgICAgIHN0YXR1cy5zdGF0ZSA9PT0gJ2Rpc2Nvbm5lY3RlZCdcbiAgICAgICAgICA/ICdWYXVsdFN5bmM6IG9mZmxpbmUgXHUyMDE0IGNoYW5nZXMgd2lsbCBzeW5jIHdoZW4gdGhlIHdvcmtlciBpcyByZWFjaGFibGUuJ1xuICAgICAgICAgIDogJ1ZhdWx0U3luYzogdXAgdG8gZGF0ZS4nLFxuICAgICAgKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5oYW5kbGVTeW5jRXJyb3IoZXJyb3IsICdzeW5jIG5vdyBmYWlsZWQnKTtcbiAgICAgIG5ldyBOb3RpY2UoJ1ZhdWx0U3luYzogc3luYyBmYWlsZWQgXHUyMDE0IHNlZSB0aGUgZGV2ZWxvcGVyIGNvbnNvbGUgZm9yIGRldGFpbHMuJyk7XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgdW5saW5rKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuc3RvcFN5bmMoKTtcbiAgICAvLyBDbGVhciBsb2NhbCBzeW5jIHN0YXRlIChkZXZpY2UgbWFya2VyICsgaW5kZXgpIHNvIGEgZnV0dXJlIGNsaWVudCBcdTIwMTRcbiAgICAvLyB0aGlzIHBsdWdpbiBhZnRlciBhIHJlLXBhaXIsIHRoZSBkYWVtb24sIHRoZSBDTEkgXHUyMDE0IHN0YXJ0cyBjbGVhblxuICAgIC8vIChGUi00NDogc3RhbGUgc3RhdGUgd291bGQgbWFrZSBpdCByZWZ1c2Ugb3IgbWlzLXN5bmMpLlxuICAgIGNvbnN0IHN0b3JhZ2UgPSBuZXcgT2JzaWRpYW5TdG9yYWdlQWRhcHRlcih7IGFkYXB0ZXI6IHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIgfSk7XG4gICAgYXdhaXQgc3RvcmFnZS5kZWxldGVGaWxlKERFVklDRV9NQVJLRVJfVkFVTFRfUEFUSCk7XG4gICAgYXdhaXQgc3RvcmFnZS5kZWxldGVGaWxlKExPQ0FMX0lOREVYX1ZBVUxUX1BBVEgpO1xuICAgIHRoaXMuZGF0YSA9IHtcbiAgICAgIC4uLmRlZmF1bHRQbHVnaW5EYXRhKCksXG4gICAgICBkZXZpY2VOYW1lOiB0aGlzLmRhdGEuZGV2aWNlTmFtZSxcbiAgICAgIHNldHRpbmdzOiB0aGlzLmRhdGEuc2V0dGluZ3MsXG4gICAgfTtcbiAgICBhd2FpdCB0aGlzLnNhdmVQbHVnaW5EYXRhKCk7XG4gICAgbmV3IE5vdGljZShcbiAgICAgICdWYXVsdFN5bmM6IHVubGlua2VkLiBSZXZva2UgdGhpcyBkZXZpY2UgZnJvbSB0aGUgd29ya2VyIGRhc2hib2FyZCBpZiB5b3UgYXJlIGRvbmUgd2l0aCBpdC4nLFxuICAgICk7XG4gIH1cblxuICBhc3luYyBhcHBseVJlc2NhbkludGVydmFsKHNlY29uZHM6IG51bWJlcik6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuZGF0YS5zZXR0aW5ncy5yZXNjYW5JbnRlcnZhbFNlYyA9IE1hdGgubWF4KDAsIE1hdGguZmxvb3Ioc2Vjb25kcykpO1xuICAgIGF3YWl0IHRoaXMuc2F2ZVBsdWdpbkRhdGEoKTtcbiAgICB0aGlzLnJlc2Nhbj8uc2V0SW50ZXJ2YWxNcyh0aGlzLmRhdGEuc2V0dGluZ3MucmVzY2FuSW50ZXJ2YWxTZWMgKiAxMDAwKTtcbiAgfVxuXG4gIGFzeW5jIGFwcGx5T2JzaWRpYW5TeW5jKGVuYWJsZWQ6IGJvb2xlYW4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLmRhdGEuc2V0dGluZ3Mub2JzaWRpYW5TeW5jID0gZW5hYmxlZDtcbiAgICBhd2FpdCB0aGlzLnNhdmVQbHVnaW5EYXRhKCk7XG4gICAgbmV3IE5vdGljZShcbiAgICAgIGVuYWJsZWRcbiAgICAgICAgPyAnVmF1bHRTeW5jOiAub2JzaWRpYW4vIHdpbGwgc3luYyBhZnRlciB0aGUgbmV4dCByZWNvbm5lY3QgKHRoZSB3b3JrZXJcXHUyMDE5cyBwZXItdmF1bHQgc2V0dGluZyB0YWtlcyBwcmVjZWRlbmNlKS4nXG4gICAgICAgIDogJ1ZhdWx0U3luYzogLm9ic2lkaWFuLyB3aWxsIGJlIGV4Y2x1ZGVkIGFmdGVyIHRoZSBuZXh0IHJlY29ubmVjdC4nLFxuICAgICk7XG4gIH1cblxuICAvLyAtLS0gc3VwZXJ2aXNpb24gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICBwcml2YXRlIG9uVGljaygpOiB2b2lkIHtcbiAgICBjb25zdCBjbGllbnQgPSB0aGlzLmNsaWVudDtcbiAgICBpZiAoY2xpZW50ID09PSBudWxsKSByZXR1cm47XG4gICAgY29uc3Qgc3RhdHVzID0gY2xpZW50LnN0YXR1cygpO1xuICAgIHRoaXMuc3RhdHVzQmFyPy51cGRhdGUoXG4gICAgICBzdGF0dXMsXG4gICAgICB7IHVybDogdGhpcy5kYXRhLnVybCwgZGV2aWNlTmFtZTogdGhpcy5yZXNvbHZlRGV2aWNlTmFtZSgpLCBub3RlOiB0aGlzLnN0YXR1c05vdGUgfSxcbiAgICAgIHRoaXMubm93KCksXG4gICAgKTtcbiAgICBpZiAodGhpcy5hdXRoRmFpbGVkKSByZXR1cm47IC8vIHRva2VuIHJlamVjdGVkOiByZWNvbm5lY3RpbmcgY2Fubm90IGZpeCBpdFxuICAgIGNvbnN0IGRlY2lzaW9uID0gdGhpcy5zdXBlcnZpc29yLmNvbnNpZGVyKHN0YXR1cy5zdGF0ZSk7XG4gICAgaWYgKGRlY2lzaW9uLmFjdGlvbiA9PT0gJ3dhaXQnKSByZXR1cm47XG4gICAgdGhpcy5zdXBlcnZpc29yLmFja25vd2xlZGdlZCgpO1xuICAgIHRoaXMuc2NoZWR1bGVSZWNvbm5lY3QoZGVjaXNpb24uZGVsYXlNcyk7XG4gIH1cblxuICBwcml2YXRlIHNjaGVkdWxlUmVjb25uZWN0KGRlbGF5TXM6IG51bWJlcik6IHZvaWQge1xuICAgIGlmICh0aGlzLnJlY29ubmVjdFRpbWVyICE9PSBudWxsKSByZXR1cm47IC8vIG9uZSBpbiBmbGlnaHQsIGFsd2F5c1xuICAgIHRoaXMucmVjb25uZWN0VGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRoaXMucmVjb25uZWN0VGltZXIgPSBudWxsO1xuICAgICAgY29uc3QgY2xpZW50ID0gdGhpcy5jbGllbnQ7XG4gICAgICBpZiAoY2xpZW50ID09PSBudWxsKSB7XG4gICAgICAgIHRoaXMuc3VwZXJ2aXNvci5zZXR0bGVkKCk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIGNsaWVudFxuICAgICAgICAucmVjb25uZWN0KClcbiAgICAgICAgLnRoZW4oXG4gICAgICAgICAgKCkgPT4ge1xuICAgICAgICAgICAgdGhpcy5zdXBlcnZpc29yLnNldHRsZWQoKTtcbiAgICAgICAgICB9LFxuICAgICAgICAgIChlcnJvcjogdW5rbm93bikgPT4ge1xuICAgICAgICAgICAgdGhpcy5zdXBlcnZpc29yLnNldHRsZWQoKTtcbiAgICAgICAgICAgIHRoaXMuaGFuZGxlU3luY0Vycm9yKGVycm9yLCAncmVjb25uZWN0IGZhaWxlZCcpO1xuICAgICAgICAgIH0sXG4gICAgICAgIClcbiAgICAgICAgLmNhdGNoKCgpID0+IHt9KTsgLy8gaGFuZGxlU3luY0Vycm9yIG5ldmVyIHRocm93czsgYmVsdCBhbmQgYnJhY2VzXG4gICAgfSwgZGVsYXlNcyk7XG4gIH1cblxuICAvKiogRGlzdGluZ3Vpc2ggZmF0YWwgYXV0aCBmYWlsdXJlcyBmcm9tIHRyYW5zaWVudCBuZXR3b3JrIHRyb3VibGUuICovXG4gIHByaXZhdGUgaGFuZGxlU3luY0Vycm9yKGVycm9yOiB1bmtub3duLCBjb250ZXh0OiBzdHJpbmcpOiB2b2lkIHtcbiAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBSZXZva2VkRXJyb3IgfHwgZXJyb3IgaW5zdGFuY2VvZiBVbmF1dGhvcml6ZWRFcnJvcikge1xuICAgICAgdGhpcy5hdXRoRmFpbGVkID0gdHJ1ZTtcbiAgICAgIHRoaXMuc3RhdHVzTm90ZSA9ICdEZXZpY2UgdG9rZW4gcmVqZWN0ZWQgXHUyMDE0IHVubGluayBhbmQgcmUtcGFpciB3aXRoIGEgZnJlc2ggY29kZS4nO1xuICAgICAgdGhpcy5zeW5jTG9nLmVycm9yKGNvbnRleHQsIGVycm9yKTtcbiAgICAgIG5ldyBOb3RpY2UoXG4gICAgICAgICdWYXVsdFN5bmM6IHRoZSB3b3JrZXIgcmVqZWN0ZWQgdGhpcyBkZXZpY2VcXHUyMDE5cyB0b2tlbiAocmV2b2tlZD8pLiBVbmxpbmsgYW5kIHJlLXBhaXIgZnJvbSBzZXR0aW5ncy4nLFxuICAgICAgICAxMDAwMCxcbiAgICAgICk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHRoaXMuc3luY0xvZy53YXJuKGNvbnRleHQsIGVycm9yKTsgLy8gb2ZmbGluZS9wcm90b2NvbDogYmFja29mZiBrZWVwcyByZXRyeWluZ1xuICB9XG5cbiAgLyoqIEZSLTQ0OiB3YXJuIHdoZW4gdGhlIHZhdWx0J3Mgc3RhdGUgZGlyIGJlbG9uZ3MgdG8gYW5vdGhlciBjbGllbnQuICovXG4gIHByaXZhdGUgYXN5bmMgd2FybklmRm9yZWlnblN0YXRlRGlyKHN0b3JhZ2U6IE9ic2lkaWFuU3RvcmFnZUFkYXB0ZXIpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBsZXQgbWFya2VyOiB7IGRldmljZUlkPzogdW5rbm93bjsgZGV2aWNlTmFtZT86IHVua25vd247IHVybD86IHVua25vd24gfTtcbiAgICB0cnkge1xuICAgICAgY29uc3QgYnl0ZXMgPSBhd2FpdCBzdG9yYWdlLnJlYWRGaWxlKERFVklDRV9NQVJLRVJfVkFVTFRfUEFUSCk7XG4gICAgICBtYXJrZXIgPSBKU09OLnBhcnNlKG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShieXRlcykpIGFzIHR5cGVvZiBtYXJrZXI7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm47IC8vIG5vIG1hcmtlciAob3IgdW5yZWFkYWJsZSkgXHUyMDE0IG5vdGhpbmcgdG8gd2FybiBhYm91dFxuICAgIH1cbiAgICBpZiAoXG4gICAgICB0eXBlb2YgbWFya2VyLmRldmljZUlkID09PSAnc3RyaW5nJyAmJlxuICAgICAgbWFya2VyLmRldmljZUlkICE9PSB0aGlzLmRhdGEuZGV2aWNlSWRcbiAgICApIHtcbiAgICAgIGNvbnN0IG5hbWUgPSB0eXBlb2YgbWFya2VyLmRldmljZU5hbWUgPT09ICdzdHJpbmcnID8gbWFya2VyLmRldmljZU5hbWUgOiBtYXJrZXIuZGV2aWNlSWQ7XG4gICAgICBjb25zdCB3aGVyZSA9IHR5cGVvZiBtYXJrZXIudXJsID09PSAnc3RyaW5nJyA/IG1hcmtlci51cmwgOiAnYSB3b3JrZXInO1xuICAgICAgbmV3IE5vdGljZShcbiAgICAgICAgYFZhdWx0U3luYzogdGhpcyB2YXVsdCBhbHJlYWR5IGhhcyBzeW5jIHN0YXRlIGZvciBkZXZpY2UgXCIke25hbWV9XCIgKGxpbmtlZCB0byAke3doZXJlfSkuIGAgK1xuICAgICAgICAgICdPbmUgc3luYyBjbGllbnQgcGVyIG1hY2hpbmUgcGVyIHZhdWx0IFx1MjAxNCBydW5uaW5nIHR3byBkb3VibGUtY29tbWl0cyBldmVyeSBjaGFuZ2UuICcgK1xuICAgICAgICAgICdVbmxpbmsgdGhlIG90aGVyIGNsaWVudCAob3IgY2xlYXIgLnZhdWx0c3luY2ZvcmFnZW50cy8pIGlmIHRoaXMgaXMgdW5leHBlY3RlZC4nLFxuICAgICAgICAxNTAwMCxcbiAgICAgICk7XG4gICAgfVxuICB9XG59XG5cbmZ1bmN0aW9uIG5vcm1hbGl6ZVdvcmtlclVybFNhZmUoaW5wdXQ6IHN0cmluZyk6IHN0cmluZyB7XG4gIHRyeSB7XG4gICAgcmV0dXJuIG5vcm1hbGl6ZVdvcmtlclVybChpbnB1dCk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiBpbnB1dDtcbiAgfVxufVxuIiwgIi8qKlxuICogVmF1bHQgcGF0aCB1dGlsaXRpZXMuXG4gKlxuICogVmF1bHQtaW50ZXJuYWwgcGF0aHMgYXJlIFBPU0lYLW5vcm1hbGl6ZWQgc3RyaW5ncyByZWxhdGl2ZSB0byB0aGUgdmF1bHQgcm9vdDpcbiAqICAgLSBhbHdheXMgc3RhcnQgd2l0aCBgL2AgKGAvYS9iLm1kYCk7IHRoZSB2YXVsdCByb290IGl0c2VsZiBpcyBgL2BcbiAqICAgLSBzZWdtZW50cyBzZXBhcmF0ZWQgYnkgYC9gOyBubyB0cmFpbGluZyBzbGFzaCwgbm8gYC5gL2AuLmAgc2VnbWVudHMsXG4gKiAgICAgbm8gZHVwbGljYXRlIHNsYXNoZXNcbiAqICAgLSBuZXZlciBlc2NhcGUgdGhlIHJvb3Q6IGFueSBgLi5gIHRoYXQgd291bGQgcG9wIGFib3ZlIGAvYCBpcyByZWplY3RlZFxuICpcbiAqIEJhY2tzbGFzaGVzIGFyZSBjb252ZXJ0ZWQgdG8gYC9gIChXaW5kb3dzIGNhbGxlcnMgcm91dGluZWx5IGhhbmQgdXNcbiAqIGBkaXJcXGZpbGUubWRgKSwgYnV0IGFic29sdXRlIFdpbmRvd3MgcGF0aHMgKGRyaXZlIGxldHRlcnMgbGlrZSBgQzovYCwgVU5DXG4gKiBgXFxcXHNlcnZlclxcc2hhcmVgKSBhcmUgcmVqZWN0ZWQgXHUyMDE0IGEgdmF1bHQgcGF0aCBpcyBuZXZlciBhYnNvbHV0ZSBpbiB0aGUgaG9zdFxuICogZmlsZXN5c3RlbSBzZW5zZS5cbiAqL1xuXG4vKiogQSB2YXVsdC1pbnRlcm5hbCwgUE9TSVgtbm9ybWFsaXplZCBwYXRoIHN0cmluZyAoZS5nLiBgL25vdGVzL3RvZG8ubWRgKS4gKi9cbmV4cG9ydCB0eXBlIFZhdWx0UGF0aCA9IHN0cmluZztcblxuLyoqIFRocm93biB3aGVuIGEgcGF0aCBjYW5ub3QgYmUgaW50ZXJwcmV0ZWQgYXMgYSB2YXVsdC1pbnRlcm5hbCBwYXRoLiAqL1xuZXhwb3J0IGNsYXNzIEludmFsaWRWYXVsdFBhdGhFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgY29uc3RydWN0b3IobWVzc2FnZTogc3RyaW5nKSB7XG4gICAgc3VwZXIobWVzc2FnZSk7XG4gICAgdGhpcy5uYW1lID0gJ0ludmFsaWRWYXVsdFBhdGhFcnJvcic7XG4gIH1cbn1cblxuLyoqXG4gKiBOb3JtYWxpemUgYSB1c2VyLSBvciBwbGF0Zm9ybS1zdXBwbGllZCBwYXRoIGludG8gY2Fub25pY2FsIHZhdWx0IGZvcm0uXG4gKlxuICogQWNjZXB0ZWQ6IGBhL2IubWRgIChyb290LXJlbGF0aXZlIHdpdGhvdXQgbGVhZGluZyBzbGFzaCksIGAvYS9iLm1kYCxcbiAqIGBhXFxiLm1kYCAoYmFja3NsYXNoIGNvbnZlcnNpb24pLCBgYS8uL2IubWRgLCBgYS9iLy4uL2MubWRgIChpbnRlcmlvciBgLi5gXG4gKiByZXNvbHZlcyksIGR1cGxpY2F0ZSBzbGFzaGVzLCB0cmFpbGluZyBzbGFzaGVzLlxuICpcbiAqIFJlamVjdGVkOiBgLi5gIGVzY2FwaW5nIHRoZSByb290IChgLy4uL2FgLCBgL2EvLi4vLi5gKSwgYWJzb2x1dGUgV2luZG93c1xuICogZHJpdmUgcGF0aHMgKGBDOi92YXVsdC9hLm1kYCwgYEM6XFx2YXVsdFxcYS5tZGApLCBVTkMgcGF0aHMgKGBcXFxcc3J2XFxzaGFyZWApLFxuICogbGVhZGluZyBgLy9gLCBOVUwgYnl0ZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBub3JtYWxpemVWYXVsdFBhdGgoaW5wdXQ6IHN0cmluZyk6IFZhdWx0UGF0aCB7XG4gIGlmICh0eXBlb2YgaW5wdXQgIT09ICdzdHJpbmcnKSB7XG4gICAgdGhyb3cgbmV3IEludmFsaWRWYXVsdFBhdGhFcnJvcihgVmF1bHQgcGF0aCBtdXN0IGJlIGEgc3RyaW5nLCBnb3QgJHt0eXBlb2YgaW5wdXR9YCk7XG4gIH1cbiAgaWYgKGlucHV0LmluY2x1ZGVzKCdcXDAnKSkge1xuICAgIHRocm93IG5ldyBJbnZhbGlkVmF1bHRQYXRoRXJyb3IoYFZhdWx0IHBhdGggY29udGFpbnMgTlVMIGJ5dGU6ICR7SlNPTi5zdHJpbmdpZnkoaW5wdXQpfWApO1xuICB9XG4gIGlmICgvXlthLXpBLVpdOi8udGVzdChpbnB1dCkpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZFZhdWx0UGF0aEVycm9yKFxuICAgICAgYFZhdWx0IHBhdGggbXVzdCBub3QgYmUgYW4gYWJzb2x1dGUgaG9zdCBwYXRoIChkcml2ZSBsZXR0ZXIpOiAke0pTT04uc3RyaW5naWZ5KGlucHV0KX1gLFxuICAgICk7XG4gIH1cbiAgaWYgKGlucHV0LnN0YXJ0c1dpdGgoJ1xcXFxcXFxcJykpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZFZhdWx0UGF0aEVycm9yKFxuICAgICAgYFZhdWx0IHBhdGggbXVzdCBub3QgYmUgYSBVTkMgcGF0aDogJHtKU09OLnN0cmluZ2lmeShpbnB1dCl9YCxcbiAgICApO1xuICB9XG5cbiAgY29uc3QgY29udmVydGVkID0gaW5wdXQucmVwbGFjZSgvXFxcXC9nLCAnLycpO1xuICBpZiAoY29udmVydGVkLnN0YXJ0c1dpdGgoJy8vJykpIHtcbiAgICB0aHJvdyBuZXcgSW52YWxpZFZhdWx0UGF0aEVycm9yKFxuICAgICAgYFZhdWx0IHBhdGggbXVzdCBub3Qgc3RhcnQgd2l0aCBcIi8vXCIgKFVOQyBvciBwcm90b2NvbC1zdHlsZSBwYXRoKTogJHtKU09OLnN0cmluZ2lmeShpbnB1dCl9YCxcbiAgICApO1xuICB9XG5cbiAgY29uc3Qgc2VnbWVudHM6IHN0cmluZ1tdID0gW107XG4gIGZvciAoY29uc3Qgc2VnbWVudCBvZiBjb252ZXJ0ZWQuc3BsaXQoJy8nKSkge1xuICAgIGlmIChzZWdtZW50ID09PSAnJyB8fCBzZWdtZW50ID09PSAnLicpIGNvbnRpbnVlO1xuICAgIGlmIChzZWdtZW50ID09PSAnLi4nKSB7XG4gICAgICBpZiAoc2VnbWVudHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAgIHRocm93IG5ldyBJbnZhbGlkVmF1bHRQYXRoRXJyb3IoXG4gICAgICAgICAgYFZhdWx0IHBhdGggZXNjYXBlcyB0aGUgdmF1bHQgcm9vdDogJHtKU09OLnN0cmluZ2lmeShpbnB1dCl9YCxcbiAgICAgICAgKTtcbiAgICAgIH1cbiAgICAgIHNlZ21lbnRzLnBvcCgpO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIHNlZ21lbnRzLnB1c2goc2VnbWVudCk7XG4gIH1cbiAgcmV0dXJuIHNlZ21lbnRzLmxlbmd0aCA9PT0gMCA/ICcvJyA6IGAvJHtzZWdtZW50cy5qb2luKCcvJyl9YDtcbn1cblxuLyoqXG4gKiBKb2luIGEgYmFzZSB2YXVsdCBwYXRoIHdpdGggb25lIG9yIG1vcmUgcmVsYXRpdmUgcGF0aCBwYXJ0cy5cbiAqXG4gKiBFYWNoIHBhcnQgbXVzdCBiZSByZWxhdGl2ZSAobm8gbGVhZGluZyBgL2AgYWZ0ZXIgYmFja3NsYXNoIGNvbnZlcnNpb24pIGFuZFxuICogaXMgYXBwZW5kZWQgdG8gdGhlIGJhc2UgYmVmb3JlIG5vcm1hbGl6YXRpb247IGAuLmAgaW5zaWRlIHBhcnRzIG1heSBub3RcbiAqIGVzY2FwZSB0aGUgcmVzdWx0aW5nIHJvb3QuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBqb2luUGF0aChiYXNlOiBzdHJpbmcsIC4uLnBhcnRzOiByZWFkb25seSBzdHJpbmdbXSk6IFZhdWx0UGF0aCB7XG4gIGxldCBjb21iaW5lZCA9IG5vcm1hbGl6ZVZhdWx0UGF0aChiYXNlKTtcbiAgZm9yIChjb25zdCBwYXJ0IG9mIHBhcnRzKSB7XG4gICAgY29uc3QgY29udmVydGVkID0gcGFydC5yZXBsYWNlKC9cXFxcL2csICcvJyk7XG4gICAgaWYgKGNvbnZlcnRlZC5zdGFydHNXaXRoKCcvJykpIHtcbiAgICAgIHRocm93IG5ldyBJbnZhbGlkVmF1bHRQYXRoRXJyb3IoXG4gICAgICAgIGBqb2luUGF0aCBwYXJ0cyBtdXN0IGJlIHJlbGF0aXZlLCBnb3QgJHtKU09OLnN0cmluZ2lmeShwYXJ0KX1gLFxuICAgICAgKTtcbiAgICB9XG4gICAgY29tYmluZWQgPSBgJHtjb21iaW5lZCA9PT0gJy8nID8gJycgOiBjb21iaW5lZH0vJHtjb252ZXJ0ZWR9YDtcbiAgfVxuICByZXR1cm4gbm9ybWFsaXplVmF1bHRQYXRoKGNvbWJpbmVkKTtcbn1cblxuLyoqXG4gKiBQYXJlbnQgZGlyZWN0b3J5IG9mIGEgdmF1bHQgcGF0aC4gVGhlIHBhcmVudCBvZiBgL2AgaXMgYC9gICh0aGUgcm9vdCBoYXMgbm9cbiAqIHBhcmVudCBhYm92ZSBpdCk7IHdhbGsgYHdoaWxlIChwICE9PSBwYXJlbnRQYXRoKHApKWAgc3R5bGUgbG9vcHMgdGVybWluYXRlLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcGFyZW50UGF0aChwYXRoOiBzdHJpbmcpOiBWYXVsdFBhdGgge1xuICBjb25zdCBub3JtYWxpemVkID0gbm9ybWFsaXplVmF1bHRQYXRoKHBhdGgpO1xuICBpZiAobm9ybWFsaXplZCA9PT0gJy8nKSByZXR1cm4gJy8nO1xuICBjb25zdCBsYXN0U2xhc2ggPSBub3JtYWxpemVkLmxhc3RJbmRleE9mKCcvJyk7XG4gIHJldHVybiBsYXN0U2xhc2ggPT09IDAgPyAnLycgOiBub3JtYWxpemVkLnNsaWNlKDAsIGxhc3RTbGFzaCk7XG59XG5cbi8qKlxuICogRmluYWwgcGF0aCBzZWdtZW50LiBgYmFzZW5hbWUoJy9hL2IubWQnKWAgXHUyMTkyIGBiLm1kYDsgYGJhc2VuYW1lKCcvJylgIFx1MjE5MiBgJydgLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYmFzZW5hbWUocGF0aDogc3RyaW5nKTogc3RyaW5nIHtcbiAgY29uc3Qgbm9ybWFsaXplZCA9IG5vcm1hbGl6ZVZhdWx0UGF0aChwYXRoKTtcbiAgaWYgKG5vcm1hbGl6ZWQgPT09ICcvJykgcmV0dXJuICcnO1xuICByZXR1cm4gbm9ybWFsaXplZC5zbGljZShub3JtYWxpemVkLmxhc3RJbmRleE9mKCcvJykgKyAxKTtcbn1cbiIsICIvKipcbiAqIExvZ2ljYWwgY2xvY2sgb3BlcmF0aW9ucyAoQVJDSElURUNUVVJFLm1kIFx1MDBBNzQpLlxuICpcbiAqIENsb2NrcyBhcmUgcGVyLWZpbGUgbW9ub3RvbmljIGNvdW50ZXJzIG93bmVkIGJ5IHRoZSBzeW5jIGF1dGhvcml0eSAodGhlXG4gKiBEdXJhYmxlIE9iamVjdCkuIEEgY2xvY2sgcGFpcnMgdGhlIGNvdW50ZXIgd2l0aCB0aGUgaWQgb2YgdGhlIGRldmljZSB0aGF0XG4gKiBwcm9kdWNlZCBpdC4gT3JkZXJpbmcgaXMgZnVsbHkgZGV0ZXJtaW5pc3RpYyBvbiBldmVyeSBjbGllbnQ6XG4gKlxuICogICAxLiBoaWdoZXIgYGNvdW50ZXJgIHdpbnM7XG4gKiAgIDIuIGV4YWN0IGNvdW50ZXIgdGllIFx1MjE5MiBsZXhpY29ncmFwaGljYWxseSBncmVhdGVyIGBkZXZpY2VJZGAgd2luc1xuICogICAgICAocGxhaW4gSlMgc3RyaW5nIGNvbXBhcmlzb24sIGkuZS4gYnkgVVRGLTE2IGNvZGUgdW5pdHMpO1xuICogICAzLiBpZGVudGljYWwgY291bnRlciAqYW5kKiBpZGVudGljYWwgZGV2aWNlSWQgXHUyMTkyIHRoZSBjbG9ja3MgYXJlIGVxdWFsLlxuICpcbiAqIFdhbGwtY2xvY2sgdGltZSBuZXZlciBwYXJ0aWNpcGF0ZXMgaW4gb3JkZXJpbmcgKGRpc3BsYXktb25seSBwZXIgXHUwMEE3NCkuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBMb2dpY2FsQ2xvY2sgfSBmcm9tICcuL3R5cGVzLmpzJztcblxuLyoqIFJlc3VsdCBvZiBgY29tcGFyZUNsb2Nrc2A6IHNpZ24gb2YgYGFgIHZzIGBiYCAocG9zaXRpdmUgXHUyMUQyIGBhYCB3aW5zKS4gKi9cbmV4cG9ydCB0eXBlIENsb2NrQ29tcGFyaXNvbiA9IC0xIHwgMCB8IDE7XG5cbi8qKlxuICogQ29tcGFyZSB0d28gbG9naWNhbCBjbG9ja3MuXG4gKlxuICogUmV0dXJucyBgMWAgd2hlbiBgYWAgd2lucywgYC0xYCB3aGVuIGBiYCB3aW5zLCBgMGAgd2hlbiB0aGUgY2xvY2tzIGFyZVxuICogaWRlbnRpY2FsIChzYW1lIGNvdW50ZXIgKmFuZCogc2FtZSBkZXZpY2VJZCBcdTIwMTQgaW4gcHJhY3RpY2Ugb25seSB3aGVuXG4gKiBjb21wYXJpbmcgYSBjbG9jayB3aXRoIGl0c2VsZikuIENhbGxlcnMgdGhhdCBtdXN0IHBpY2sgYSBzaWRlIG9uIGAwYFxuICogc2hvdWxkIGRvIHNvIGV4cGxpY2l0bHkgYW5kIGRvY3VtZW50IHRoZSBjaG9pY2UuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBjb21wYXJlQ2xvY2tzKGE6IExvZ2ljYWxDbG9jaywgYjogTG9naWNhbENsb2NrKTogQ2xvY2tDb21wYXJpc29uIHtcbiAgaWYgKGEuY291bnRlciAhPT0gYi5jb3VudGVyKSByZXR1cm4gYS5jb3VudGVyID4gYi5jb3VudGVyID8gMSA6IC0xO1xuICBpZiAoYS5kZXZpY2VJZCAhPT0gYi5kZXZpY2VJZCkgcmV0dXJuIGEuZGV2aWNlSWQgPiBiLmRldmljZUlkID8gMSA6IC0xO1xuICByZXR1cm4gMDtcbn1cblxuLyoqXG4gKiBUaGUgY2xvY2sgYSBjb21taXQgZnJvbSBgZGV2aWNlSWRgIHdvdWxkIHJlY2VpdmUgd2hlbiBidWlsZGluZyBvbiBgcGFyZW50YFxuICogKG9yIG9uIG5vdGhpbmcsIHdoZW4gYHBhcmVudGAgaXMgYWJzZW50KTogcGFyZW50J3MgY291bnRlciArIDEuXG4gKlxuICogVGhpcyBpcyB0aGUgKnRlbnRhdGl2ZSogY2xvY2sgdXNlZCBieSBjbGllbnQtc2lkZSBjb25mbGljdCBwcmVkaWN0aW9uXG4gKiAoYHJlc29sdmUudHNgKTogdGhlIERPIGFzc2lnbnMgcmVhbCBjb3VudGVycyB3aXRoIHRoZSBzYW1lIHJ1bGUsIHNvIHRoZVxuICogcHJlZGljdGlvbiBtYXRjaGVzIHRoZSBzZXJ2ZXIncyBhcmJpdHJhdGlvbiBhcyBsb25nIGFzIGJvdGggc2lkZXMgYnVpbGQgb25cbiAqIHRoZSBzYW1lIHBhcmVudC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5leHRDbG9jayhcbiAgcGFyZW50OiBMb2dpY2FsQ2xvY2sgfCBudWxsIHwgdW5kZWZpbmVkLFxuICBkZXZpY2VJZDogc3RyaW5nLFxuKTogTG9naWNhbENsb2NrIHtcbiAgcmV0dXJuIHsgY291bnRlcjogKHBhcmVudD8uY291bnRlciA/PyAwKSArIDEsIGRldmljZUlkIH07XG59XG4iLCAiLyoqXG4gKiBDb250ZW50IGhhc2hpbmcgYW5kIGNvbXByZXNzaW9uIFx1MjAxNCBXZWIgQVBJcyBvbmx5LlxuICpcbiAqIGBjcnlwdG8uc3VidGxlYCBpcyBhdmFpbGFibGUgaW4gTm9kZSAxOCssIENsb3VkZmxhcmUgV29ya2VycyxcbiAqIGFuZCBPYnNpZGlhbiAoRWxlY3Ryb24pLiBgQ29tcHJlc3Npb25TdHJlYW1gIGxpa2V3aXNlLiBObyBOb2RlIGltcG9ydHM6XG4gKiB0aGlzIG1vZHVsZSBtdXN0IHJ1biB1bmNoYW5nZWQgaW4gZXZlcnkgY2xpZW50IChBUkNISVRFQ1RVUkUubWQgXHUwMEE3OCkuXG4gKi9cblxuLyoqIEhhc2ggb2YgYGJ5dGVzYCBhcyBsb3dlcmNhc2Ugc2hhMjU2IGhleC4gTWF0Y2hlcyBSMiBibG9iIGtleXMgYGJsb2JzL3tzaGEyNTZ9YC4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzaGEyNTZIZXgoYnl0ZXM6IFVpbnQ4QXJyYXkgfCBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCBkYXRhID0gdHlwZW9mIGJ5dGVzID09PSAnc3RyaW5nJyA/IG5ldyBUZXh0RW5jb2RlcigpLmVuY29kZShieXRlcykgOiBieXRlcztcbiAgLy8gYGNyeXB0b2AgKG5vdCBgZ2xvYmFsVGhpcy5jcnlwdG9gKTogdGhlIGJhcmUgaWRlbnRpZmllciByZXNvbHZlcyBpbiBldmVyeVxuICAvLyB0YXJnZXQncyB0eXBlcyAoRE9NIGxpYiwgQ2xvdWRmbGFyZSB3b3JrZXJkIHR5cGVzLCBOb2RlKSBcdTIwMTQgdGhlIHF1YWxpZmllZFxuICAvLyBmb3JtIGRvZXMgbm90LCBiZWNhdXNlIHdvcmtlcnMgdHlwZXMgZGVjbGFyZSBpdCBgY29uc3RgLCB3aGljaCBuZXZlclxuICAvLyBtZXJnZXMgaW50byBgdHlwZW9mIGdsb2JhbFRoaXNgLlxuICBjb25zdCBkaWdlc3QgPSBhd2FpdCBjcnlwdG8uc3VidGxlLmRpZ2VzdCgnU0hBLTI1NicsIGRhdGEgYXMgQnVmZmVyU291cmNlKTtcbiAgcmV0dXJuIHRvSGV4KG5ldyBVaW50OEFycmF5KGRpZ2VzdCkpO1xufVxuXG4vKipcbiAqIFdoZXRoZXIgZ3ppcCBzdHJlYW1zIGFyZSBhdmFpbGFibGUgaW4gdGhpcyBydW50aW1lLiBPbGRlciBPYnNpZGlhbiBtb2JpbGVcbiAqIHdlYnZpZXdzIG1heSBsYWNrIGBDb21wcmVzc2lvblN0cmVhbWA7IGNhbGxlcnMgZmFsbCBiYWNrIHRvIGlkZW50aXR5LlxuICovXG5leHBvcnQgZnVuY3Rpb24gc3VwcG9ydHNDb21wcmVzc2lvbigpOiBib29sZWFuIHtcbiAgcmV0dXJuIChcbiAgICB0eXBlb2YgQ29tcHJlc3Npb25TdHJlYW0gIT09ICd1bmRlZmluZWQnICYmXG4gICAgdHlwZW9mIERlY29tcHJlc3Npb25TdHJlYW0gIT09ICd1bmRlZmluZWQnXG4gICk7XG59XG5cbi8qKlxuICogR3ppcCBgZGF0YWAuIEZhbGxzIGJhY2sgdG8gaWRlbnRpdHkgKHJldHVybnMgaW5wdXQgdW5jaGFuZ2VkKSB3aGVuXG4gKiBgQ29tcHJlc3Npb25TdHJlYW1gIGlzIHVuYXZhaWxhYmxlIFx1MjAxNCBjYWxsIGBzdXBwb3J0c0NvbXByZXNzaW9uKClgIGZpcnN0IGlmXG4gKiB5b3UgbXVzdCBrbm93IHdoaWNoIGhhcHBlbmVkLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gY29tcHJlc3MoZGF0YTogVWludDhBcnJheSk6IFByb21pc2U8VWludDhBcnJheT4ge1xuICBpZiAoIXN1cHBvcnRzQ29tcHJlc3Npb24oKSkgcmV0dXJuIGRhdGE7XG4gIC8vIGBhcyBCdWZmZXJTb3VyY2VgIChub3QgYGFzIEJsb2JQYXJ0YCk6IHRoZSBuYW1lIGBCdWZmZXJTb3VyY2VgIHJlc29sdmVzIGluXG4gIC8vIGJvdGggRE9NIGxpYiBhbmQgd29ya2VyZCBydW50aW1lIHR5cGVzLCBhbmQgaXMgYSB2YWxpZCBCbG9iUGFydCBpbiBlYWNoLlxuICBjb25zdCBzdHJlYW0gPSBuZXcgQmxvYihbZGF0YSBhcyBCdWZmZXJTb3VyY2VdKVxuICAgIC5zdHJlYW0oKVxuICAgIC5waXBlVGhyb3VnaChuZXcgQ29tcHJlc3Npb25TdHJlYW0oJ2d6aXAnKSk7XG4gIHJldHVybiBuZXcgVWludDhBcnJheShhd2FpdCBuZXcgUmVzcG9uc2Uoc3RyZWFtKS5hcnJheUJ1ZmZlcigpKTtcbn1cblxuLyoqXG4gKiBHdW56aXAgYGRhdGFgIHByb2R1Y2VkIGJ5IGBjb21wcmVzc2AgKGluIGEgcnVudGltZSB0aGF0IGhhZCBnemlwIHN1cHBvcnQpLlxuICogRmFsbHMgYmFjayB0byBpZGVudGl0eSB3aGVuIGBEZWNvbXByZXNzaW9uU3RyZWFtYCBpcyB1bmF2YWlsYWJsZS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGRlY29tcHJlc3MoZGF0YTogVWludDhBcnJheSk6IFByb21pc2U8VWludDhBcnJheT4ge1xuICBpZiAoIXN1cHBvcnRzQ29tcHJlc3Npb24oKSkgcmV0dXJuIGRhdGE7XG4gIGNvbnN0IHN0cmVhbSA9IG5ldyBCbG9iKFtkYXRhIGFzIEJ1ZmZlclNvdXJjZV0pXG4gICAgLnN0cmVhbSgpXG4gICAgLnBpcGVUaHJvdWdoKG5ldyBEZWNvbXByZXNzaW9uU3RyZWFtKCdnemlwJykpO1xuICByZXR1cm4gbmV3IFVpbnQ4QXJyYXkoYXdhaXQgbmV3IFJlc3BvbnNlKHN0cmVhbSkuYXJyYXlCdWZmZXIoKSk7XG59XG5cbmZ1bmN0aW9uIHRvSGV4KGJ5dGVzOiBVaW50OEFycmF5KTogc3RyaW5nIHtcbiAgbGV0IG91dCA9ICcnO1xuICBmb3IgKGNvbnN0IGJ5dGUgb2YgYnl0ZXMpIHtcbiAgICBvdXQgKz0gYnl0ZS50b1N0cmluZygxNikucGFkU3RhcnQoMiwgJzAnKTtcbiAgfVxuICByZXR1cm4gb3V0O1xufVxuIiwgIi8qKlxuICogVHlwZWQgZXJyb3IgaGllcmFyY2h5IHNoYXJlZCBieSBhbGwgY2xpZW50cyAocGx1Z2luLCBkYWVtb24sIENMSSkgYW5kIHRoZVxuICogdGVzdC1zdWl0ZSBzZXJ2ZXIuIEVycm9ycyBjYXJyeSBhIHN0YWJsZSBtYWNoaW5lLXJlYWRhYmxlIGBjb2RlYC5cbiAqL1xuXG5leHBvcnQgdHlwZSBFcnJvckNvZGUgPVxuICB8ICdVTkNMQUlNRUQnXG4gIHwgJ1VOQVVUSE9SSVpFRCdcbiAgfCAnUkVWT0tFRCdcbiAgfCAnQ09ORkxJQ1QnXG4gIHwgJ1BST1RPQ09MJ1xuICB8ICdORVRXT1JLJztcblxuLyoqIEJhc2UgY2xhc3MgZm9yIGFsbCBWYXVsdFN5bmMgZXJyb3JzLiAqL1xuZXhwb3J0IGFic3RyYWN0IGNsYXNzIFZhdWx0U3luY0Vycm9yIGV4dGVuZHMgRXJyb3Ige1xuICBhYnN0cmFjdCByZWFkb25seSBjb2RlOiBFcnJvckNvZGU7XG5cbiAgY29uc3RydWN0b3IobWVzc2FnZTogc3RyaW5nLCBvcHRpb25zPzogRXJyb3JPcHRpb25zKSB7XG4gICAgc3VwZXIobWVzc2FnZSwgb3B0aW9ucyk7XG4gICAgdGhpcy5uYW1lID0gbmV3LnRhcmdldC5uYW1lO1xuICB9XG59XG5cbi8qKiBXb3JrZXIgZXhpc3RzIGJ1dCBoYXMgbm90IGJlZW4gY2xhaW1lZCB5ZXQgKEhUVFAgNDIxIG9uIGV2ZXJ5IEFQSSBjYWxsKS4gKi9cbmV4cG9ydCBjbGFzcyBVbmNsYWltZWRFcnJvciBleHRlbmRzIFZhdWx0U3luY0Vycm9yIHtcbiAgcmVhZG9ubHkgY29kZSA9ICdVTkNMQUlNRUQnIGFzIGNvbnN0O1xufVxuXG4vKiogVG9rZW4gbWlzc2luZywgaW52YWxpZCwgb3Igbm90IGFjY2VwdGVkIChIVFRQIDQwMSBjbGFzcykuICovXG5leHBvcnQgY2xhc3MgVW5hdXRob3JpemVkRXJyb3IgZXh0ZW5kcyBWYXVsdFN5bmNFcnJvciB7XG4gIHJlYWRvbmx5IGNvZGUgPSAnVU5BVVRIT1JJWkVEJyBhcyBjb25zdDtcbn1cblxuLyoqIFRoZSBkZXZpY2UgdG9rZW4gd2FzIHJldm9rZWQ7IHRoZSBkZXZpY2UgbXVzdCBiZSByZS1wYWlyZWQuICovXG5leHBvcnQgY2xhc3MgUmV2b2tlZEVycm9yIGV4dGVuZHMgVmF1bHRTeW5jRXJyb3Ige1xuICByZWFkb25seSBjb2RlID0gJ1JFVk9LRUQnIGFzIGNvbnN0O1xufVxuXG4vKiogQSBjb21taXQgcmFjZWQgd2l0aCBhIGNvbmN1cnJlbnQgZWRpdDsgdGhlIHNlcnZlciBhcmJpdHJhdGVkIChzZWUgXHUwMEE3NCkuICovXG5leHBvcnQgY2xhc3MgQ29uZmxpY3RFcnJvciBleHRlbmRzIFZhdWx0U3luY0Vycm9yIHtcbiAgcmVhZG9ubHkgY29kZSA9ICdDT05GTElDVCcgYXMgY29uc3Q7XG59XG5cbi8qKiBBIHBlZXIgKG9yIGxvY2FsIGJ1ZykgdmlvbGF0ZWQgdGhlIHByb3RvY29sOiBiYWQgbWVzc2FnZSBzaGFwZSwgYmFkIHZlcnNpb24uICovXG5leHBvcnQgY2xhc3MgUHJvdG9jb2xFcnJvciBleHRlbmRzIFZhdWx0U3luY0Vycm9yIHtcbiAgcmVhZG9ubHkgY29kZSA9ICdQUk9UT0NPTCcgYXMgY29uc3Q7XG59XG5cbi8qKiBUcmFuc3BvcnQtbGV2ZWwgZmFpbHVyZTogc29ja2V0IGNsb3NlZCwgZmV0Y2ggcmVmdXNlZCwgdGltZW91dC4gUmV0cmlhYmxlLiAqL1xuZXhwb3J0IGNsYXNzIE5ldHdvcmtFcnJvciBleHRlbmRzIFZhdWx0U3luY0Vycm9yIHtcbiAgcmVhZG9ubHkgY29kZSA9ICdORVRXT1JLJyBhcyBjb25zdDtcbn1cbiIsICIvKipcbiAqIFRoZSBjbGllbnQncyBwZXJzaXN0ZWQgc3luYyBzdGF0ZSAoQVJDSElURUNUVVJFLm1kIFx1MDBBNzggc3RlcCAxKS5cbiAqXG4gKiBBIGBMb2NhbEluZGV4YCBtYXBzIGV2ZXJ5IHZhdWx0IHBhdGggdGhpcyBjbGllbnQgaGFzIGV2ZXIgc3luY2VkIHRvIHRoZVxuICogbGFzdCB2ZXJzaW9uIGl0ICprbm93cyogd2FzIGF1dGhvcml0YXRpdmU6IGNvbnRlbnQgaGFzaCwgc2l6ZSwgdGhlXG4gKiBzZXJ2ZXItYXNzaWduZWQgdmVyc2lvbiBpZCwgYW5kIHRoZSB2ZXJzaW9uJ3MgbG9naWNhbCBjbG9jay4gRW50cmllcyB3aXRoXG4gKiBgZGVsZXRlZEF0YCBzZXQgYXJlIHRvbWJzdG9uZXMgXHUyMDE0IHRoZSBmaWxlIHdhcyBkZWxldGVkIChsb2NhbGx5IG9yXG4gKiByZW1vdGVseSkgYnV0IHRoZSBlbnRyeSBzdGF5cyBzbyB0aGUgZGVsZXRpb24gaXMgbm90IHJlc3VycmVjdGVkIGJ5IHRoZVxuICogbmV4dCBzY2FuIGFuZCBzbyByZW5hbWUgY29ycmVsYXRpb24ga2VlcHMgd29ya2luZy5cbiAqXG4gKiBUaGUgaW5kZXggaXMgcGVyc2lzdGVkIGluc2lkZSB0aGUgdmF1bHQgYXQgYC8udmF1bHRzeW5jZm9yYWdlbnRzL3N0YXRlYFxuICogKHRoYXQgZGlyZWN0b3J5IGlzIHN5bmMtaWdub3JlZCwgc2VlIGBpZ25vcmUudHNgKSB0aHJvdWdoIHRoZSBzdG9yYWdlXG4gKiBhZGFwdGVyLCB3aG9zZSBgd3JpdGVGaWxlYCBpcyBhdG9taWMgKHRlbXAgKyByZW5hbWUpIGJ5IGNvbnRyYWN0LlxuICpcbiAqIEFsbCBvcGVyYXRpb25zIGFyZSBwdXJlOiB0aGV5IHJldHVybiBuZXcgb2JqZWN0cyBhbmQgbmV2ZXIgbXV0YXRlIGlucHV0cy5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IExvZ2ljYWxDbG9jayB9IGZyb20gJy4vdHlwZXMuanMnO1xuaW1wb3J0IHsgUHJvdG9jb2xFcnJvciB9IGZyb20gJy4vZXJyb3JzLmpzJztcblxuLyoqXG4gKiBDdXJyZW50IG9uLWRpc2sgc2NoZW1hIHZlcnNpb24uIEJ1bXAgKyBhZGQgbWlncmF0aW9uIG9uIGJyZWFraW5nIGNoYW5nZXMuXG4gKlxuICogSGlzdG9yeTpcbiAqICAgLSAxIFx1MjAxNCBpbml0aWFsIHNoYXBlIChoYXNoL3NpemUvdmVyc2lvbklkL2Nsb2NrL2RlbGV0ZWRBdC9pc0ZvbGRlcikuXG4gKiAgIC0gMiBcdTIwMTQgYWRkcyB0aGUgb3B0aW9uYWwgYG10aW1lYCBjYWNoZSBmaWVsZCBwZXIgZW50cnkgKHNjYW4gcHJlLWZpbHRlcixcbiAqICAgICAgICAgc2VlIGBzY2FuLnRzYCkuIEdyYWNlZnVsIG1pZ3JhdGlvbjogdjEgZW50cmllcyBzaW1wbHkgbGFjayBgbXRpbWVgLFxuICogICAgICAgICB3aGljaCByZWFkcyBiYWNrIGFzIFwidW5rbm93blwiIFx1MjAxNCB0aGUgbmV4dCBmYXN0IHNjYW4gcmUtaGFzaGVzIHRoZVxuICogICAgICAgICBmaWxlIGFuZCByZWNvcmRzIGl0LiBPbGQgdjEgc3RhdGUgZmlsZXMgbG9hZCB3aXRob3V0IGVycm9yLlxuICovXG5leHBvcnQgY29uc3QgTE9DQUxfSU5ERVhfU0NIRU1BX1ZFUlNJT04gPSAyO1xuXG4vKiogT2xkZXN0IG9uLWRpc2sgc2NoZW1hIHZlcnNpb24gdGhpcyBidWlsZCBjYW4gc3RpbGwgcmVhZC4gKi9cbmV4cG9ydCBjb25zdCBNSU5fTE9DQUxfSU5ERVhfU0NIRU1BX1ZFUlNJT04gPSAxO1xuXG4vKiogVmF1bHQgcGF0aCB3aGVyZSB0aGUgY2xpZW50IHBlcnNpc3RzIGl0cyBsb2NhbCBpbmRleC4gKi9cbmV4cG9ydCBjb25zdCBMT0NBTF9JTkRFWF9TVEFURV9QQVRIID0gJy8udmF1bHRzeW5jZm9yYWdlbnRzL3N0YXRlJztcblxuLyoqIE9uZSBwYXRoJ3MgbGFzdC1rbm93bi1zeW5jZWQgc3RhdGUuICovXG5leHBvcnQgaW50ZXJmYWNlIExvY2FsSW5kZXhFbnRyeSB7XG4gIC8qKiBzaGEyNTYgaGV4IG9mIHRoZSBjb250ZW50IGF0IGB2ZXJzaW9uSWRgLiAqL1xuICBoYXNoOiBzdHJpbmc7XG4gIC8qKiBDb250ZW50IHNpemUgaW4gYnl0ZXMgKGAwYCBmb3IgZm9sZGVyIHBsYWNlaG9sZGVycykuICovXG4gIHNpemU6IG51bWJlcjtcbiAgLyoqIFNlcnZlci1hc3NpZ25lZCB2ZXJzaW9uIGlkIHRoaXMgZW50cnkgcmVmbGVjdHMuICovXG4gIHZlcnNpb25JZDogc3RyaW5nO1xuICAvKiogTG9naWNhbCBjbG9jayBvZiBgdmVyc2lvbklkYCBcdTIwMTQgdXNlZCB0byBwcmVkaWN0IGNvbmZsaWN0IG91dGNvbWVzLiAqL1xuICBjbG9jazogTG9naWNhbENsb2NrO1xuICAvKiogUHJlc2VudCBcdTIxRDIgdG9tYnN0b25lOiB0aGUgcGF0aCB3YXMgZGVsZXRlZCBhdCB0aGlzIGVwb2NoIG1zLiAqL1xuICBkZWxldGVkQXQ/OiBudW1iZXI7XG4gIC8qKlxuICAgKiBUcnVlIGZvciBlbXB0eS1mb2xkZXIgcGxhY2Vob2xkZXIgZW50cmllcyAoRlItMTApLiBGb2xkZXIgZW50cmllcyBjYXJyeVxuICAgKiBgaGFzaDogJydgLCBgc2l6ZTogMGA7IHRoZSBjbG9jayBpcyB0aGF0IG9mIHRoZSBwbGFjZWhvbGRlcidzIHZlcnNpb24uXG4gICAqL1xuICBpc0ZvbGRlcj86IGJvb2xlYW47XG4gIC8qKlxuICAgKiBTdG9yYWdlIG10aW1lIChlcG9jaCBtcykgb2JzZXJ2ZWQgdGhlIGxhc3QgdGltZSB0aGlzIGVudHJ5J3MgZmlsZSB3YXNcbiAgICogaGFzaGVkIGJ5IGEgc2Nhbi4gQSBwdXJlIGNhY2hlIGZvciB0aGUgc2NhbiBwcmUtZmlsdGVyIChgc2Nhbi50c2ApOlxuICAgKiBudWxsaXNoIChhYnNlbnQsIGUuZy4gbGVnYWN5IHYxIHN0YXRlIG9yIGVudHJpZXMgd3JpdHRlbiBieSBwdWxscylcbiAgICogbWVhbnMgXCJ1bmtub3duXCIgXHUyMDE0IHRoZSBuZXh0IGZhc3Qgc2NhbiBoYXNoZXMgdGhlIGZpbGUgYW5kIHJlY29yZHMgaXQgdmlhXG4gICAqIGByZWNvcmRIYXNoZWRGaWxlc2AuIE5ldmVyIGNvbnN1bHRlZCBmb3Igc3luYyBkZWNpc2lvbnMuXG4gICAqL1xuICBtdGltZT86IG51bWJlcjtcbn1cblxuLyoqIFRoZSB3aG9sZSBpbmRleDogbm9ybWFsaXplZCB2YXVsdCBwYXRoIFx1MjE5MiBlbnRyeS4gYHt9YCBpcyBhIHZhbGlkIGVtcHR5IGluZGV4LiAqL1xuZXhwb3J0IHR5cGUgTG9jYWxJbmRleCA9IFJlYWRvbmx5PFJlY29yZDxzdHJpbmcsIExvY2FsSW5kZXhFbnRyeT4+O1xuXG4vKiogVmVyc2lvbmVkIHNlcmlhbGl6YXRpb24gZW52ZWxvcGUgKHNjaGVtYVZlcnNpb24gZW5hYmxlcyBmdXR1cmUgbWlncmF0aW9uKS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgTG9jYWxJbmRleEVudmVsb3BlIHtcbiAgc2NoZW1hVmVyc2lvbjogbnVtYmVyO1xuICBlbnRyaWVzOiBSZWNvcmQ8c3RyaW5nLCBMb2NhbEluZGV4RW50cnk+O1xufVxuXG4vKiogT25lIGF1dGhvcml0YXRpdmUgc3RhdGUgY2hhbmdlIHRvIGZvbGQgaW50byB0aGUgaW5kZXguICovXG5leHBvcnQgaW50ZXJmYWNlIExvY2FsSW5kZXhDb21taXQge1xuICBwYXRoOiBzdHJpbmc7XG4gIHZlcnNpb25JZDogc3RyaW5nO1xuICBoYXNoOiBzdHJpbmc7XG4gIHNpemU6IG51bWJlcjtcbiAgY2xvY2s6IExvZ2ljYWxDbG9jaztcbiAgLyoqIFByZXNlbnQgXHUyMUQyIHRvbWJzdG9uZTogdGhlIHBhdGggd2FzIGRlbGV0ZWQgYXQgdGhpcyBlcG9jaCBtcy4gKi9cbiAgZGVsZXRlZD86IGJvb2xlYW47XG4gIC8qKiBFcG9jaCBtcyBvZiB0aGUgZGVsZXRpb24gXHUyMDE0IHJlcXVpcmVkIHdoZW4gYGRlbGV0ZWRgIGlzIHRydWUuICovXG4gIGRlbGV0ZWRBdD86IG51bWJlcjtcbiAgLyoqIFRydWUgd2hlbiB0aGlzIGNvbW1pdCByZWNvcmRzIGFuIGVtcHR5LWZvbGRlciBwbGFjZWhvbGRlciAoRlItMTApLiAqL1xuICBpc0ZvbGRlcj86IGJvb2xlYW47XG4gIC8qKlxuICAgKiBTdG9yYWdlIG10aW1lIG9ic2VydmVkIGF0IEhBU0ggdGltZSBmb3IgdGhpcyBleGFjdCBjb250ZW50IFx1MjAxNCBwaW5uZWQgb250b1xuICAgKiB0aGUgZW50cnkgd2hlbiB0aGUgY29tbWl0IGlzIGZvbGRlZCAoaS5lLiBhdCBjb21taXQtYWNrIHRpbWUpLiBUaHJlYWRpbmdcbiAgICogdGhlIHN0YXQgdGhhdCBjby1vY2N1cnJlZCB3aXRoIHRoZSBoYXNoZWQgYnl0ZXMgKHJhdGhlciB0aGFuIGFueVxuICAgKiBsYXRlci9jdXJyZW50IHN0YXQpIGd1YXJhbnRlZXMgdGhlIGZhc3QtcGF0aCBjYWNoZSBjYW4gbmV2ZXIgcGFpciBhXG4gICAqIGZyZXNoZXIgc3RhdCB3aXRoIHRoaXMgaGFzaCwgd2hpY2ggd291bGQgaGlkZSBhbiBlZGl0IGZyb20gZXZlcnkgZnV0dXJlXG4gICAqIHNjYW4gKHRoZSBzaWxlbnQgZHJvcHBlZC1lZGl0IGNsYXNzKS4gQWJzZW50IFx1MjFEMiB1bmtub3duOyB0aGUgbmV4dCBzY2FuXG4gICAqIHJlLWhhc2hlcyBhbmQgcmVjb3JkcyB2aWEgYHJlY29yZEhhc2hlZEZpbGVzYC5cbiAgICovXG4gIG10aW1lPzogbnVtYmVyO1xufVxuXG4vKipcbiAqIEZvbGQgb25lIGNvbW1pdCBpbnRvIHRoZSBpbmRleC4gUHVyZTogcmV0dXJucyBhIG5ldyBpbmRleCwgaW5wdXQgdW50b3VjaGVkLlxuICpcbiAqIEFwcGx5aW5nIGEgY29tbWl0IGZvciBhIHBhdGggcmVwbGFjZXMgdGhhdCBwYXRoJ3MgZW50cnkgd2hvbGVzYWxlIChhIGNvbW1pdFxuICogKmlzKiB0aGUgbmV3IHRydXRoIGZvciB0aGUgcGF0aCk7IGBhcHBseUNvbW1pdGAgbmV2ZXIgbWVyZ2VzIGZpZWxkcy5cbiAqIFRvbWJzdG9uaW5nIChgZGVsZXRlZDogdHJ1ZWApIHJlcXVpcmVzIGBkZWxldGVkQXRgIGFuZCBrZWVwcyB0aGUgZW50cnkuXG4gKlxuICogVG8gZHJvcCBhbiBlbnRyeSBlbnRpcmVseSAodGhlIHBhdGggbWlncmF0ZWQgYXdheSwgZS5nLiBhIHN5bmNlZCByZW5hbWUpXG4gKiB1c2UgYHJlbW92ZUVudHJ5YCBpbnN0ZWFkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYXBwbHlDb21taXQoaW5kZXg6IExvY2FsSW5kZXgsIGNvbW1pdDogTG9jYWxJbmRleENvbW1pdCk6IExvY2FsSW5kZXgge1xuICBpZiAoY29tbWl0LmRlbGV0ZWQgJiYgY29tbWl0LmRlbGV0ZWRBdCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgYGFwcGx5Q29tbWl0OiB0b21ic3RvbmUgZm9yICR7SlNPTi5zdHJpbmdpZnkoY29tbWl0LnBhdGgpfSByZXF1aXJlcyBkZWxldGVkQXRgLFxuICAgICk7XG4gIH1cbiAgY29uc3QgbmV4dDogUmVjb3JkPHN0cmluZywgTG9jYWxJbmRleEVudHJ5PiA9IHsgLi4uaW5kZXggfTtcbiAgY29uc3QgZW50cnk6IExvY2FsSW5kZXhFbnRyeSA9IHtcbiAgICBoYXNoOiBjb21taXQuaGFzaCxcbiAgICBzaXplOiBjb21taXQuc2l6ZSxcbiAgICB2ZXJzaW9uSWQ6IGNvbW1pdC52ZXJzaW9uSWQsXG4gICAgY2xvY2s6IGNvbW1pdC5jbG9jayxcbiAgfTtcbiAgaWYgKGNvbW1pdC5kZWxldGVkKSBlbnRyeS5kZWxldGVkQXQgPSBjb21taXQuZGVsZXRlZEF0O1xuICBpZiAoY29tbWl0LmlzRm9sZGVyKSBlbnRyeS5pc0ZvbGRlciA9IHRydWU7XG4gIGlmIChjb21taXQubXRpbWUgIT09IHVuZGVmaW5lZCkgZW50cnkubXRpbWUgPSBjb21taXQubXRpbWU7XG4gIG5leHRbY29tbWl0LnBhdGhdID0gZW50cnk7XG4gIHJldHVybiBuZXh0O1xufVxuXG4vKipcbiAqIFJlbW92ZSBhIHBhdGgncyBlbnRyeSBlbnRpcmVseSAobm8gdG9tYnN0b25lKS4gVXNlZCB3aGVuIHRoZSBhdXRob3JpdHlcbiAqIG1pZ3JhdGVzIGEgcGF0aCdzIHZlcnNpb24gY2hhaW4gZWxzZXdoZXJlIFx1MjAxNCBpLmUuIGEgc3luY2VkIHJlbmFtZTogdGhlIG9sZFxuICogcGF0aCBtdXN0IHZhbmlzaCBmcm9tIHRoZSBpbmRleCBleGFjdGx5IGFzIGl0IHZhbmlzaGVkIGZyb20gdGhlIG1hbmlmZXN0LlxuICogUHVyZTsgcmVtb3ZpbmcgYW4gYWJzZW50IHBhdGggaXMgYSBuby1vcC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHJlbW92ZUVudHJ5KGluZGV4OiBMb2NhbEluZGV4LCBwYXRoOiBzdHJpbmcpOiBMb2NhbEluZGV4IHtcbiAgaWYgKCEocGF0aCBpbiBpbmRleCkpIHJldHVybiBpbmRleDtcbiAgY29uc3QgbmV4dDogUmVjb3JkPHN0cmluZywgTG9jYWxJbmRleEVudHJ5PiA9IHsgLi4uaW5kZXggfTtcbiAgZGVsZXRlIG5leHRbcGF0aF07XG4gIHJldHVybiBuZXh0O1xufVxuXG4vKipcbiAqIFNlcmlhbGl6ZSB0byBhIGRldGVybWluaXN0aWMgSlNPTiBzdHJpbmc6IHZlcnNpb25lZCBlbnZlbG9wZSwgZW50cmllc1xuICogc29ydGVkIGJ5IHBhdGggKHNvIGlkZW50aWNhbCBpbmRleGVzIHNlcmlhbGl6ZSBieXRlLWlkZW50aWNhbGx5IGFuZCBkaWZmXG4gKiBjbGVhbmx5IGluIHN0YXRlLWRpciBsaXN0aW5ncykuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzZXJpYWxpemVMb2NhbEluZGV4KGluZGV4OiBMb2NhbEluZGV4KTogc3RyaW5nIHtcbiAgY29uc3QgZW50cmllczogUmVjb3JkPHN0cmluZywgTG9jYWxJbmRleEVudHJ5PiA9IHt9O1xuICBmb3IgKGNvbnN0IHBhdGggb2YgT2JqZWN0LmtleXMoaW5kZXgpLnNvcnQoKSkge1xuICAgIGVudHJpZXNbcGF0aF0gPSBpbmRleFtwYXRoXSBhcyBMb2NhbEluZGV4RW50cnk7XG4gIH1cbiAgY29uc3QgZW52ZWxvcGU6IExvY2FsSW5kZXhFbnZlbG9wZSA9IHtcbiAgICBzY2hlbWFWZXJzaW9uOiBMT0NBTF9JTkRFWF9TQ0hFTUFfVkVSU0lPTixcbiAgICBlbnRyaWVzLFxuICB9O1xuICByZXR1cm4gSlNPTi5zdHJpbmdpZnkoZW52ZWxvcGUpO1xufVxuXG4vKipcbiAqIFBhcnNlIGEgc2VyaWFsaXplZCBpbmRleCBiYWNrLiBUaHJvd3MgYFByb3RvY29sRXJyb3JgIG9uIG5vbi1KU09OIGlucHV0LFxuICogYSBtYWxmb3JtZWQgZW52ZWxvcGUsIGVudHJpZXMgd2l0aCB3cm9uZyBmaWVsZCB0eXBlcywgb3IgYSBgc2NoZW1hVmVyc2lvbmBcbiAqIG91dHNpZGUgdGhlIHN1cHBvcnRlZCByYW5nZSAob2xkZXIgdGhhbiBgTUlOX0xPQ0FMX0lOREVYX1NDSEVNQV9WRVJTSU9OYFxuICogb3IgbmV3ZXIgdGhhbiBgTE9DQUxfSU5ERVhfU0NIRU1BX1ZFUlNJT05gKSBcdTIwMTQgb2xkZXIgdmVyc2lvbnMgKndpdGhpbiogdGhlXG4gKiByYW5nZSBsb2FkIHdpdGhvdXQgZXJyb3IgKHYxIGVudHJpZXMgc2ltcGx5IGRlc2VyaWFsaXplIHdpdGggYG10aW1lYFxuICogdW5rbm93bikuIFVua25vd24gZXh0cmEgZmllbGRzIGFyZSB0b2xlcmF0ZWQgZm9yIGZvcndhcmQgY29tcGF0aWJpbGl0eS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGRlc2VyaWFsaXplTG9jYWxJbmRleChqc29uOiBzdHJpbmcpOiBMb2NhbEluZGV4IHtcbiAgbGV0IHBhcnNlZDogdW5rbm93bjtcbiAgdHJ5IHtcbiAgICBwYXJzZWQgPSBKU09OLnBhcnNlKGpzb24pO1xuICB9IGNhdGNoIChjYXVzZSkge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKCdMb2NhbCBpbmRleCBzdGF0ZSBpcyBub3QgdmFsaWQgSlNPTicsIHsgY2F1c2UgfSk7XG4gIH1cbiAgaWYgKCFpc1BsYWluT2JqZWN0KHBhcnNlZCkpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcignTG9jYWwgaW5kZXggc3RhdGUgaXMgbm90IGFuIG9iamVjdCcpO1xuICB9XG4gIGNvbnN0IHZlcnNpb24gPSBwYXJzZWQuc2NoZW1hVmVyc2lvbjtcbiAgaWYgKHR5cGVvZiB2ZXJzaW9uICE9PSAnbnVtYmVyJyB8fCAhTnVtYmVyLmlzSW50ZWdlcih2ZXJzaW9uKSkge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKCdMb2NhbCBpbmRleCBzdGF0ZSBpcyBtaXNzaW5nIGludGVnZXIgc2NoZW1hVmVyc2lvbicpO1xuICB9XG4gIGlmICh2ZXJzaW9uIDwgTUlOX0xPQ0FMX0lOREVYX1NDSEVNQV9WRVJTSU9OIHx8IHZlcnNpb24gPiBMT0NBTF9JTkRFWF9TQ0hFTUFfVkVSU0lPTikge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKFxuICAgICAgYExvY2FsIGluZGV4IHNjaGVtYSB2ZXJzaW9uICR7dmVyc2lvbn0gaXMgbm90IHN1cHBvcnRlZCBieSB0aGlzIGJ1aWxkIGAgK1xuICAgICAgICBgKGV4cGVjdGVkICR7TUlOX0xPQ0FMX0lOREVYX1NDSEVNQV9WRVJTSU9OfS4uJHtMT0NBTF9JTkRFWF9TQ0hFTUFfVkVSU0lPTn0pOyBgICtcbiAgICAgICAgJ2EgbWlncmF0aW9uIGlzIHJlcXVpcmVkJyxcbiAgICApO1xuICB9XG4gIGNvbnN0IHJhd0VudHJpZXMgPSBwYXJzZWQuZW50cmllcztcbiAgaWYgKCFpc1BsYWluT2JqZWN0KHJhd0VudHJpZXMpKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoJ0xvY2FsIGluZGV4IHN0YXRlIGlzIG1pc3NpbmcgdGhlIGVudHJpZXMgb2JqZWN0Jyk7XG4gIH1cblxuICBjb25zdCBlbnRyaWVzOiBSZWNvcmQ8c3RyaW5nLCBMb2NhbEluZGV4RW50cnk+ID0ge307XG4gIGZvciAoY29uc3QgW3BhdGgsIHJhd10gb2YgT2JqZWN0LmVudHJpZXMocmF3RW50cmllcykpIHtcbiAgICBlbnRyaWVzW3BhdGhdID0gcGFyc2VFbnRyeShwYXRoLCByYXcpO1xuICB9XG4gIHJldHVybiBlbnRyaWVzO1xufVxuXG5mdW5jdGlvbiBwYXJzZUVudHJ5KHBhdGg6IHN0cmluZywgcmF3OiB1bmtub3duKTogTG9jYWxJbmRleEVudHJ5IHtcbiAgY29uc3Qgd2hlcmUgPSBgTG9jYWwgaW5kZXggZW50cnkgJHtKU09OLnN0cmluZ2lmeShwYXRoKX1gO1xuICBpZiAoIWlzUGxhaW5PYmplY3QocmF3KSkgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoYCR7d2hlcmV9IGlzIG5vdCBhbiBvYmplY3RgKTtcbiAgY29uc3QgeyBoYXNoLCBzaXplLCB2ZXJzaW9uSWQsIGNsb2NrLCBkZWxldGVkQXQsIGlzRm9sZGVyLCBtdGltZSB9ID0gcmF3IGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICBpZiAodHlwZW9mIGhhc2ggIT09ICdzdHJpbmcnKSB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgJHt3aGVyZX06IGhhc2ggbXVzdCBiZSBhIHN0cmluZ2ApO1xuICBpZiAodHlwZW9mIHZlcnNpb25JZCAhPT0gJ3N0cmluZycpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgJHt3aGVyZX06IHZlcnNpb25JZCBtdXN0IGJlIGEgc3RyaW5nYCk7XG4gIH1cbiAgaWYgKHR5cGVvZiBzaXplICE9PSAnbnVtYmVyJyB8fCAhTnVtYmVyLmlzSW50ZWdlcihzaXplKSB8fCBzaXplIDwgMCkge1xuICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKGAke3doZXJlfTogc2l6ZSBtdXN0IGJlIGEgbm9uLW5lZ2F0aXZlIGludGVnZXJgKTtcbiAgfVxuICBpZiAoIWlzUGxhaW5PYmplY3QoY2xvY2spIHx8IHR5cGVvZiBjbG9jay5jb3VudGVyICE9PSAnbnVtYmVyJyB8fCB0eXBlb2YgY2xvY2suZGV2aWNlSWQgIT09ICdzdHJpbmcnKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoYCR7d2hlcmV9OiBjbG9jayBtdXN0IGJlIHsgY291bnRlcjogbnVtYmVyLCBkZXZpY2VJZDogc3RyaW5nIH1gKTtcbiAgfVxuICBpZiAoZGVsZXRlZEF0ICE9PSB1bmRlZmluZWQgJiYgdHlwZW9mIGRlbGV0ZWRBdCAhPT0gJ251bWJlcicpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgJHt3aGVyZX06IGRlbGV0ZWRBdCBtdXN0IGJlIGEgbnVtYmVyIHdoZW4gcHJlc2VudGApO1xuICB9XG4gIGlmIChpc0ZvbGRlciAhPT0gdW5kZWZpbmVkICYmIHR5cGVvZiBpc0ZvbGRlciAhPT0gJ2Jvb2xlYW4nKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoYCR7d2hlcmV9OiBpc0ZvbGRlciBtdXN0IGJlIGEgYm9vbGVhbiB3aGVuIHByZXNlbnRgKTtcbiAgfVxuICBpZiAobXRpbWUgIT09IHVuZGVmaW5lZCAmJiAodHlwZW9mIG10aW1lICE9PSAnbnVtYmVyJyB8fCAhTnVtYmVyLmlzRmluaXRlKG10aW1lKSkpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgJHt3aGVyZX06IG10aW1lIG11c3QgYmUgYSBmaW5pdGUgbnVtYmVyIHdoZW4gcHJlc2VudGApO1xuICB9XG4gIGNvbnN0IGVudHJ5OiBMb2NhbEluZGV4RW50cnkgPSB7XG4gICAgaGFzaCxcbiAgICBzaXplLFxuICAgIHZlcnNpb25JZCxcbiAgICBjbG9jazogeyBjb3VudGVyOiBjbG9jay5jb3VudGVyIGFzIG51bWJlciwgZGV2aWNlSWQ6IGNsb2NrLmRldmljZUlkIGFzIHN0cmluZyB9LFxuICB9O1xuICBpZiAoZGVsZXRlZEF0ICE9PSB1bmRlZmluZWQpIGVudHJ5LmRlbGV0ZWRBdCA9IGRlbGV0ZWRBdCBhcyBudW1iZXI7XG4gIGlmIChpc0ZvbGRlciAhPT0gdW5kZWZpbmVkKSBlbnRyeS5pc0ZvbGRlciA9IGlzRm9sZGVyIGFzIGJvb2xlYW47XG4gIGlmIChtdGltZSAhPT0gdW5kZWZpbmVkKSBlbnRyeS5tdGltZSA9IG10aW1lIGFzIG51bWJlcjtcbiAgcmV0dXJuIGVudHJ5O1xufVxuXG5mdW5jdGlvbiBpc1BsYWluT2JqZWN0KHZhbHVlOiB1bmtub3duKTogdmFsdWUgaXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4ge1xuICByZXR1cm4gdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJiB2YWx1ZSAhPT0gbnVsbCAmJiAhQXJyYXkuaXNBcnJheSh2YWx1ZSk7XG59XG4iLCAiLyoqXG4gKiBUaGluIHB1bGwtc2lkZSBvcmNoZXN0cmF0aW9uIChBUkNISVRFQ1RVUkUubWQgXHUwMEE3OCBzdGVwIDUpLiBOT1QgdGhlIG5ldHdvcmtcbiAqIGNsaWVudDogYWxsIHRyYW5zcG9ydCBpcyBpbmplY3RlZCAoYGZldGNoQmxvYmApLCB3aGljaCB0aGUgbGF0ZXIgbmV0d29ya1xuICogcGhhc2UgaW1wbGVtZW50cyBvdmVyIGAvYmxvYi86aGFzaGAgb3IgV1MtaW5saW5lIGNvbnRlbnQuXG4gKlxuICogYGFwcGx5UHVsbGAgbWF0ZXJpYWxpemVzIGV2ZXJ5IGBQdWxsT3BgIG9mIGEgYFN5bmNQbGFuYCB0aHJvdWdoIHRoZVxuICogc3RvcmFnZSBhZGFwdGVyIGFuZCB1cGRhdGVzIHRoZSBsb2NhbCBpbmRleCBcdTIwMTQgZHVyYWJseSBhbmQgaG9uZXN0bHk6XG4gKlxuICogICAtIGJsb2JzIGFyZSB2ZXJpZmllZCAoc2hhMjU2KSBiZWZvcmUgYmVpbmcgd3JpdHRlbjsgYSBtaXNtYXRjaCBhYm9ydHNcbiAqICAgICB0aGUgcGxhbjtcbiAqICAgLSBlYWNoIGluZGV4IGVudHJ5IGlzIHJlY29yZGVkIG9ubHkgKmFmdGVyKiBpdHMgc3RvcmFnZSB3cml0ZSBzdWNjZWVkZWQsXG4gKiAgICAgc28gYSBtaWQtcGxhbiBmYWlsdXJlIGxlYXZlcyB0aGUgaW5kZXggZGVzY3JpYmluZyBleGFjdGx5IHRoZSBmaWxlc1xuICogICAgIHRoYXQgYWN0dWFsbHkgbGFuZGVkIChGUi01OiBub3RoaW5nIGlzIHNpbGVudGx5IGxvc3QgXHUyMDE0IHRoZSB1bnN5bmNlZFxuICogICAgIHB1bGxzIHNpbXBseSByZW1haW4gaW4gdGhlIHBsYW4gYW5kIGFyZSByZXRyaWVkIGJ5IHRoZSBjYWxsZXIpO1xuICogICAtIHRoZSBpbmRleCBpcyBwZXJzaXN0ZWQgdGhyb3VnaCB0aGUgYWRhcHRlcidzIGF0b21pYyBgd3JpdGVGaWxlYFxuICogICAgICh0ZW1wICsgcmVuYW1lIHBlciB0aGUgYWRhcHRlciBjb250cmFjdCkgYXRcbiAqICAgICBgLy52YXVsdHN5bmNmb3JhZ2VudHMvc3RhdGVgLCBpbmNsdWRpbmcgb24gdGhlIGZhaWx1cmUgcGF0aC5cbiAqXG4gKiBQdXNoZXMvY29uZmxpY3RzL2ZvbGRlciBvcHMgYXJlIHRoZSBuZXR3b3JrIHBoYXNlJ3MgYnVzaW5lc3M7IHJldHJ5XG4gKiBxdWV1ZXMgYXJlIGV4cGxpY2l0bHkgb3V0IG9mIHNjb3BlIGhlcmUuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBTdG9yYWdlQWRhcHRlciB9IGZyb20gJy4vYWRhcHRlcnMuanMnO1xuaW1wb3J0IHsgc2hhMjU2SGV4IH0gZnJvbSAnLi9oYXNoaW5nLmpzJztcbmltcG9ydCB7XG4gIGFwcGx5Q29tbWl0LFxuICBkZXNlcmlhbGl6ZUxvY2FsSW5kZXgsXG4gIExPQ0FMX0lOREVYX1NUQVRFX1BBVEgsXG4gIHJlbW92ZUVudHJ5LFxuICBzZXJpYWxpemVMb2NhbEluZGV4LFxuICB0eXBlIExvY2FsSW5kZXgsXG59IGZyb20gJy4vbG9jYWxpbmRleC5qcyc7XG5pbXBvcnQgdHlwZSB7IFB1bGxPcCwgU3luY1BsYW4gfSBmcm9tICcuL3Jlc29sdmUuanMnO1xuXG4vKiogSW5qZWN0ZWQgY29udGVudCB0cmFuc3BvcnQ6IGZldGNoIHRoZSBibG9iIGZvciBhIGNvbnRlbnQgaGFzaC4gKi9cbmV4cG9ydCB0eXBlIEZldGNoQmxvYiA9IChoYXNoOiBzdHJpbmcpID0+IFByb21pc2U8VWludDhBcnJheT47XG5cbmV4cG9ydCBpbnRlcmZhY2UgQXBwbHlQdWxsT3B0aW9ucyB7XG4gIC8qKiBFcG9jaCBtcyB1c2VkIGZvciB0b21ic3RvbmUgdGltZXN0YW1wcy4gRGVmYXVsdDogYERhdGUubm93KClgIFx1MjAxNCB0aGlzXG4gICAqICBmdW5jdGlvbiBpcyBJL08gb3JjaGVzdHJhdGlvbiwgbm90IGEgcHVyZSBmdW5jdGlvbiwgYnV0IHRlc3RzIGluamVjdFxuICAgKiAgYSBmaXhlZCB2YWx1ZSBmb3IgZGV0ZXJtaW5pc20uICovXG4gIG5vdz86IG51bWJlcjtcbn1cblxuLyoqXG4gKiBBcHBseSBhbGwgcHVsbHMgb2YgYHBsYW5gIGFuZCByZXR1cm4gdGhlIHVwZGF0ZWQgaW5kZXggKGFsc28gcGVyc2lzdGVkIHRvXG4gKiB0aGUgYWRhcHRlciBhdCBgTE9DQUxfSU5ERVhfU1RBVEVfUEFUSGApLlxuICpcbiAqIFN0b3JhZ2Ugd3JpdGVzIGhhcHBlbiBpbiBwbGFuIG9yZGVyLiBJZiBhbnkgb3AgZmFpbHMsIHRoZSBpbmRleCByZWZsZWN0aW5nXG4gKiBldmVyeSBvcCB0aGF0IHN1Y2NlZWRlZCBzbyBmYXIgaXMgcGVyc2lzdGVkIGFuZCB0aGUgb3JpZ2luYWwgZXJyb3IgaXNcbiAqIHJldGhyb3duIFx1MjAxNCBwYXRocyB0aGF0IGZhaWxlZCBhcmUgYWJzZW50IGZyb20gdGhlIHJldHVybmVkL3BlcnNpc3RlZCBpbmRleC5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIGFwcGx5UHVsbChcbiAgc3RvcmFnZTogU3RvcmFnZUFkYXB0ZXIsXG4gIGluZGV4OiBMb2NhbEluZGV4LFxuICBwbGFuOiBTeW5jUGxhbixcbiAgZmV0Y2hCbG9iOiBGZXRjaEJsb2IsXG4gIG9wdGlvbnM6IEFwcGx5UHVsbE9wdGlvbnMgPSB7fSxcbik6IFByb21pc2U8TG9jYWxJbmRleD4ge1xuICBjb25zdCBub3cgPSBvcHRpb25zLm5vdyA/PyBEYXRlLm5vdygpO1xuICBsZXQgd29ya2luZzogTG9jYWxJbmRleCA9IGluZGV4O1xuXG4gIHRyeSB7XG4gICAgZm9yIChjb25zdCBwdWxsIG9mIHBsYW4ucHVsbHMpIHtcbiAgICAgIHdvcmtpbmcgPSBhd2FpdCBhcHBseU9uZVB1bGwoc3RvcmFnZSwgd29ya2luZywgcHVsbCwgZmV0Y2hCbG9iLCBub3cpO1xuICAgIH1cbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICB0cnkge1xuICAgICAgYXdhaXQgcGVyc2lzdEluZGV4KHN0b3JhZ2UsIHdvcmtpbmcpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gUGVyc2lzdGVuY2UgZmFpbHVyZSBtdXN0IG5vdCBtYXNrIHRoZSBvcmlnaW5hbCBlcnJvcjsgdGhlIGNhbGxlclxuICAgICAgLy8gcmV0cmllcyB0aGUgd2hvbGUgY3ljbGUgYW55d2F5LlxuICAgIH1cbiAgICB0aHJvdyBlcnJvcjtcbiAgfVxuXG4gIGF3YWl0IHBlcnNpc3RJbmRleChzdG9yYWdlLCB3b3JraW5nKTtcbiAgcmV0dXJuIHdvcmtpbmc7XG59XG5cbmFzeW5jIGZ1bmN0aW9uIGFwcGx5T25lUHVsbChcbiAgc3RvcmFnZTogU3RvcmFnZUFkYXB0ZXIsXG4gIGluZGV4OiBMb2NhbEluZGV4LFxuICBwdWxsOiBQdWxsT3AsXG4gIGZldGNoQmxvYjogRmV0Y2hCbG9iLFxuICBub3c6IG51bWJlcixcbik6IFByb21pc2U8TG9jYWxJbmRleD4ge1xuICBpZiAocHVsbC5raW5kID09PSAncmVuYW1lJykge1xuICAgIGlmIChhd2FpdCBzdG9yYWdlLmV4aXN0cyhwdWxsLmZyb21QYXRoKSkge1xuICAgICAgYXdhaXQgc3RvcmFnZS5yZW5hbWVGaWxlKHB1bGwuZnJvbVBhdGgsIHB1bGwudG9QYXRoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gT2xkIHBhdGggbmV2ZXIgbWF0ZXJpYWxpemVkIGhlcmUgKG9yIGFscmVhZHkgbW92ZWQpOiBmZXRjaCBjb250ZW50LlxuICAgICAgYXdhaXQgZmV0Y2hWZXJpZmllZChzdG9yYWdlLCBwdWxsLnRvUGF0aCwgcHVsbC5oYXNoLCBmZXRjaEJsb2IpO1xuICAgIH1cbiAgICByZXR1cm4gYXBwbHlDb21taXQocmVtb3ZlRW50cnkoaW5kZXgsIHB1bGwuZnJvbVBhdGgpLCB7XG4gICAgICBwYXRoOiBwdWxsLnRvUGF0aCxcbiAgICAgIHZlcnNpb25JZDogcHVsbC52ZXJzaW9uLFxuICAgICAgaGFzaDogcHVsbC5oYXNoLFxuICAgICAgc2l6ZTogcHVsbC5zaXplLFxuICAgICAgY2xvY2s6IHB1bGwuY2xvY2ssXG4gICAgfSk7XG4gIH1cblxuICBpZiAocHVsbC5pc0ZvbGRlcikge1xuICAgIC8vIEZvbGRlciBwbGFjZWhvbGRlcnMgKEZSLTEwKTogY3JlYXRlIHRoZSBkaXJlY3RvcnksIHJlY29yZCB0aGUgZW50cnkuXG4gICAgLy8gVG9tYnN0b25lZCBwbGFjZWhvbGRlcnMgcmVjb3JkIG9ubHkgXHUyMDE0IGRlbGV0aW5nIGEgZGlyZWN0b3J5IGZyb20gc3RvcmFnZVxuICAgIC8vIChhbmQgY2FzY2FkaW5nIHRvIGFueSBmaWxlcyBwbGFjZWQgaW5zaWRlIGl0KSBpcyBhIHBsYXRmb3JtIGNvbmNlcm4uXG4gICAgaWYgKCFwdWxsLmRlbGV0ZWQpIGF3YWl0IHN0b3JhZ2UuZW5zdXJlRGlyKHB1bGwucGF0aCk7XG4gICAgcmV0dXJuIGFwcGx5Q29tbWl0KGluZGV4LCB7XG4gICAgICBwYXRoOiBwdWxsLnBhdGgsXG4gICAgICB2ZXJzaW9uSWQ6IHB1bGwudmVyc2lvbixcbiAgICAgIGhhc2g6IHB1bGwuaGFzaCxcbiAgICAgIHNpemU6IHB1bGwuc2l6ZSxcbiAgICAgIGNsb2NrOiBwdWxsLmNsb2NrLFxuICAgICAgZGVsZXRlZDogcHVsbC5kZWxldGVkLFxuICAgICAgZGVsZXRlZEF0OiBwdWxsLmRlbGV0ZWQgPyBub3cgOiB1bmRlZmluZWQsXG4gICAgICBpc0ZvbGRlcjogdHJ1ZSxcbiAgICB9KTtcbiAgfVxuXG4gIGlmIChwdWxsLmRlbGV0ZWQpIHtcbiAgICAvLyBJZGVtcG90ZW50IHBlciB0aGUgYWRhcHRlciBjb250cmFjdDsgYSBsb2NhbCAudHJhc2ggY29weSBpcyBhXG4gICAgLy8gcGxhdGZvcm0tbGF5ZXIgY29uY2VybiAoZGFlbW9uL3BsdWdpbiksIG5vdCBlbmdpbmUgbG9naWMuXG4gICAgYXdhaXQgc3RvcmFnZS5kZWxldGVGaWxlKHB1bGwucGF0aCk7XG4gICAgcmV0dXJuIGFwcGx5Q29tbWl0KGluZGV4LCB7XG4gICAgICBwYXRoOiBwdWxsLnBhdGgsXG4gICAgICB2ZXJzaW9uSWQ6IHB1bGwudmVyc2lvbixcbiAgICAgIGhhc2g6IHB1bGwuaGFzaCxcbiAgICAgIHNpemU6IHB1bGwuc2l6ZSxcbiAgICAgIGNsb2NrOiBwdWxsLmNsb2NrLFxuICAgICAgZGVsZXRlZDogdHJ1ZSxcbiAgICAgIGRlbGV0ZWRBdDogbm93LFxuICAgIH0pO1xuICB9XG5cbiAgY29uc3QgY3VycmVudCA9IGluZGV4W3B1bGwucGF0aF07XG4gIGlmIChcbiAgICBjdXJyZW50ICE9PSB1bmRlZmluZWQgJiZcbiAgICBjdXJyZW50LmRlbGV0ZWRBdCA9PT0gdW5kZWZpbmVkICYmXG4gICAgY3VycmVudC5oYXNoID09PSBwdWxsLmhhc2ggJiZcbiAgICAoYXdhaXQgc3RvcmFnZS5leGlzdHMocHVsbC5wYXRoKSlcbiAgKSB7XG4gICAgLy8gQ29udGVudCBhbHJlYWR5IGNvcnJlY3QgbG9jYWxseSAoZS5nLiB2ZXJzaW9uLWlkIGNhdGNoLXVwIGFmdGVyIGFcbiAgICAvLyByZW5hbWUgZWxzZXdoZXJlKTogcmVjb3JkIHRoZSBhdXRob3JpdGF0aXZlIGhlYWQsIHNraXAgZmV0Y2grd3JpdGUuXG4gICAgLy8gVGhlIGV4aXN0ZW5jZSBjaGVjayBtYXR0ZXJzIHdoZW4gdGhlIGZpbGUgd2FzIGRlbGV0ZWQgbG9jYWxseSBzaW5jZSB0aGVcbiAgICAvLyBpbmRleCB3YXMgbGFzdCB3cml0dGVuIFx1MjAxNCByZWNyZWF0aW5nIGl0IGlzIHdoYXQgdGhlIHB1bGwgZGVtYW5kcy5cbiAgICByZXR1cm4gYXBwbHlDb21taXQoaW5kZXgsIHtcbiAgICAgIHBhdGg6IHB1bGwucGF0aCxcbiAgICAgIHZlcnNpb25JZDogcHVsbC52ZXJzaW9uLFxuICAgICAgaGFzaDogcHVsbC5oYXNoLFxuICAgICAgc2l6ZTogcHVsbC5zaXplLFxuICAgICAgY2xvY2s6IHB1bGwuY2xvY2ssXG4gICAgfSk7XG4gIH1cblxuICBhd2FpdCBmZXRjaFZlcmlmaWVkKHN0b3JhZ2UsIHB1bGwucGF0aCwgcHVsbC5oYXNoLCBmZXRjaEJsb2IpO1xuICByZXR1cm4gYXBwbHlDb21taXQoaW5kZXgsIHtcbiAgICBwYXRoOiBwdWxsLnBhdGgsXG4gICAgdmVyc2lvbklkOiBwdWxsLnZlcnNpb24sXG4gICAgaGFzaDogcHVsbC5oYXNoLFxuICAgIHNpemU6IHB1bGwuc2l6ZSxcbiAgICBjbG9jazogcHVsbC5jbG9jayxcbiAgfSk7XG59XG5cbi8qKiBEb3dubG9hZCwgdmVyaWZ5LCBhbmQgd3JpdGUgb25lIGJsb2IuIEEgaGFzaCBtaXNtYXRjaCBhYm9ydHMgdGhlIHBsYW4uICovXG5hc3luYyBmdW5jdGlvbiBmZXRjaFZlcmlmaWVkKFxuICBzdG9yYWdlOiBTdG9yYWdlQWRhcHRlcixcbiAgcGF0aDogc3RyaW5nLFxuICBoYXNoOiBzdHJpbmcsXG4gIGZldGNoQmxvYjogRmV0Y2hCbG9iLFxuKTogUHJvbWlzZTx2b2lkPiB7XG4gIGNvbnN0IGJ5dGVzID0gYXdhaXQgZmV0Y2hCbG9iKGhhc2gpO1xuICBjb25zdCBhY3R1YWwgPSBhd2FpdCBzaGEyNTZIZXgoYnl0ZXMpO1xuICBpZiAoYWN0dWFsICE9PSBoYXNoKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKFxuICAgICAgYEJsb2IgaGFzaCBtaXNtYXRjaCBmb3IgJHtKU09OLnN0cmluZ2lmeShwYXRoKX06IGV4cGVjdGVkICR7aGFzaH0sIGdvdCAke2FjdHVhbH1gLFxuICAgICk7XG4gIH1cbiAgYXdhaXQgc3RvcmFnZS53cml0ZUZpbGUocGF0aCwgYnl0ZXMpO1xufVxuXG5hc3luYyBmdW5jdGlvbiBwZXJzaXN0SW5kZXgoc3RvcmFnZTogU3RvcmFnZUFkYXB0ZXIsIGluZGV4OiBMb2NhbEluZGV4KTogUHJvbWlzZTx2b2lkPiB7XG4gIGF3YWl0IHN0b3JhZ2Uud3JpdGVGaWxlKFxuICAgIExPQ0FMX0lOREVYX1NUQVRFX1BBVEgsXG4gICAgbmV3IFRleHRFbmNvZGVyKCkuZW5jb2RlKHNlcmlhbGl6ZUxvY2FsSW5kZXgoaW5kZXgpKSxcbiAgKTtcbn1cblxuLyoqXG4gKiBMb2FkIHRoZSBwZXJzaXN0ZWQgaW5kZXggZnJvbSBzdG9yYWdlIChBUkNISVRFQ1RVUkUgXHUwMEE3OCBzdGVwIDEpLiBUaHJvd3NcbiAqIGBQcm90b2NvbEVycm9yYCAodmlhIGBkZXNlcmlhbGl6ZUxvY2FsSW5kZXhgKSBvbiBjb3JydXB0IG9yIGZ1dHVyZS1zY2hlbWFcbiAqIHN0YXRlIFx1MjAxNCBjYWxsZXJzIHN1cmZhY2UgdGhhdCBpbnN0ZWFkIG9mIHNpbGVudGx5IHJlLXN5bmNpbmcgZnJvbSBzY3JhdGNoLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gbG9hZExvY2FsSW5kZXgoc3RvcmFnZTogU3RvcmFnZUFkYXB0ZXIpOiBQcm9taXNlPExvY2FsSW5kZXg+IHtcbiAgY29uc3QgYnl0ZXMgPSBhd2FpdCBzdG9yYWdlLnJlYWRGaWxlKExPQ0FMX0lOREVYX1NUQVRFX1BBVEgpO1xuICByZXR1cm4gZGVzZXJpYWxpemVMb2NhbEluZGV4KG5ldyBUZXh0RGVjb2RlcigpLmRlY29kZShieXRlcykpO1xufVxuIiwgIi8qKlxuICogVmF1bHQgaWdub3JlIHJ1bGVzIChBUkNISVRFQ1RVUkUubWQgXHUwMEE3NCwgRlItMTEvRlItNDIpIFx1MjAxNCBzaGFyZWQgYnkgZXZlcnlcbiAqIGNsaWVudCBzbyBsb2NhbCBzY2Fucywgd2F0Y2hlcnMsIGFuZCBjb21taXQgcGF0aHMgYWdyZWUgYnl0ZS1mb3ItYnl0ZS5cbiAqXG4gKiBNYXRjaGluZyBpcyBzZWdtZW50LWJhc2VkIGFuZCBjYXNlLWluc2Vuc2l0aXZlICh0aGUgb3duZXIncyBwcmltYXJ5XG4gKiBwbGF0Zm9ybXMgXHUyMDE0IFdpbmRvd3MsIG1hY09TIFx1MjAxNCBoYXZlIGNhc2UtaW5zZW5zaXRpdmUgZmlsZXN5c3RlbXMsIHNvXG4gKiBgLlRyYXNoL2Zvby5tZGAgbXVzdCBub3Qgc25lYWsgcGFzdCB0aGUgYC50cmFzaC9gIHJ1bGUpLlxuICovXG5cbmltcG9ydCB7IG5vcm1hbGl6ZVZhdWx0UGF0aCB9IGZyb20gJy4vcGF0aHMuanMnO1xuXG4vKiogU2V0dGluZ3Mgc3Vic2V0IGBpc0lnbm9yZWRgIG5lZWRzOyBgVmF1bHRTZXR0aW5nc2Agc2F0aXNmaWVzIGl0LiAqL1xuZXhwb3J0IGludGVyZmFjZSBJZ25vcmVTZXR0aW5ncyB7XG4gIG9ic2lkaWFuU3luYzogYm9vbGVhbjtcbn1cblxuLyoqIElnbm9yZWQgd2hlcmV2ZXIgdGhleSBhcHBlYXIsIGFzIGFueSBwYXRoIHNlZ21lbnQgKGRpciBvciBmaWxlIG5hbWUpLiAqL1xuY29uc3QgQUxXQVlTX0lHTk9SRURfU0VHTUVOVFM6IFJlYWRvbmx5U2V0PHN0cmluZz4gPSBuZXcgU2V0KFtcbiAgJy50cmFzaCcsIC8vIGxvY2FsIGRlbGV0ZS1yZWNvdmVyeSBkaXIgKEZSLTQyKVxuICAnLmRzX3N0b3JlJyxcbiAgJy52YXVsdHN5bmNmb3JhZ2VudHMnLCAvLyBjbGllbnQgc3RhdGUgZGlyIChsb2NhbCBpbmRleCkgaW5zaWRlIHRoZSB2YXVsdFxuICAndGh1bWJzLmRiJyxcbl0pO1xuXG4vKiogYC5vYnNpZGlhbi9gIGZpbGVzIGV4Y2x1ZGVkIGV2ZW4gd2hlbiBgLm9ic2lkaWFuL2Agc3luYyBpcyBvcHRlZCBpbi4gKi9cbmNvbnN0IE9CU0lESUFOX1ZPTEFUSUxFX0ZJTEVTOiBSZWFkb25seVNldDxzdHJpbmc+ID0gbmV3IFNldChbXG4gICcub2JzaWRpYW4vd29ya3NwYWNlLmpzb24nLFxuICAnLm9ic2lkaWFuL3dvcmtzcGFjZS1tb2JpbGUuanNvbicsXG5dKTtcblxuLyoqXG4gKiBXaGV0aGVyIGB2YXVsdFBhdGhgIG11c3QgYmUgZXhjbHVkZWQgZnJvbSBzeW5jLlxuICpcbiAqIEFsd2F5cyBpZ25vcmVkOiBgLnRyYXNoL2AsIGAuRFNfU3RvcmVgLCBgVGh1bWJzLmRiYCwgYC52YXVsdHN5bmNmb3JhZ2VudHMvYFxuICogKGFueSBkZXB0aCkuIGAub2JzaWRpYW4vYCBpcyBpZ25vcmVkIGVudGlyZWx5IHdoZW4gYHNldHRpbmdzLm9ic2lkaWFuU3luY2BcbiAqIGlzIGZhbHNlOyB3aGVuIHRydWUsIGV2ZXJ5dGhpbmcgdW5kZXIgaXQgc3luY3MgZXhjZXB0IGB3b3Jrc3BhY2UuanNvbmAsXG4gKiBgd29ya3NwYWNlLW1vYmlsZS5qc29uYCwgYW5kIGAub2JzaWRpYW4vY2FjaGUvYC5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGlzSWdub3JlZCh2YXVsdFBhdGg6IHN0cmluZywgc2V0dGluZ3M6IElnbm9yZVNldHRpbmdzKTogYm9vbGVhbiB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVWYXVsdFBhdGgodmF1bHRQYXRoKTtcbiAgaWYgKG5vcm1hbGl6ZWQgPT09ICcvJykgcmV0dXJuIGZhbHNlO1xuXG4gIGNvbnN0IGxvd2VyID0gbm9ybWFsaXplZC5zbGljZSgxKS50b0xvd2VyQ2FzZSgpO1xuICBjb25zdCBzZWdtZW50cyA9IGxvd2VyLnNwbGl0KCcvJyk7XG5cbiAgaWYgKHNlZ21lbnRzLnNvbWUoKHNlZ21lbnQpID0+IEFMV0FZU19JR05PUkVEX1NFR01FTlRTLmhhcyhzZWdtZW50KSkpIHtcbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuXG4gIGlmIChzZWdtZW50c1swXSA9PT0gJy5vYnNpZGlhbicpIHtcbiAgICBpZiAoIXNldHRpbmdzLm9ic2lkaWFuU3luYykgcmV0dXJuIHRydWU7XG4gICAgaWYgKE9CU0lESUFOX1ZPTEFUSUxFX0ZJTEVTLmhhcyhsb3dlcikpIHJldHVybiB0cnVlO1xuICAgIGlmIChzZWdtZW50c1sxXSA9PT0gJ2NhY2hlJykgcmV0dXJuIHRydWU7IC8vIHRoZSBkaXIgaXRzZWxmIGFuZCBhbnl0aGluZyB1bmRlciBpdFxuICB9XG5cbiAgcmV0dXJuIGZhbHNlO1xufVxuIiwgIi8qKlxuICogVHlwZWQgV2ViU29ja2V0IG1lc3NhZ2UgZGVmaW5pdGlvbnMgZm9yIHRoZSBgL3N5bmNgIGNoYW5uZWxcbiAqIChBUkNISVRFQ1RVUkUubWQgXHUwMEE3NSkuIEFsbCBtZXNzYWdlcyBhcmUgSlNPTiB3aXRoIGEgYHR5cGVgIGRpc2NyaW1pbmFudC5cbiAqXG4gKiBUd28gY2hhbm5lbHMgZXhpc3Q6IHRoaXMgV1MgcHJvdG9jb2wgKG1ldGFkYXRhICsgY2hhbmdlIGZlZWQpIGFuZCBwbGFpblxuICogSFRUUFMgYmxvYiByb3V0ZXMgKGBHRVQvUFVUIC9ibG9iLzpoYXNoYCkgZm9yIGNvbnRlbnQgXHUyMDE0IHJlZmVyZW5jZWQgaGVyZVxuICogb25seSB2aWEgY29udGVudCBoYXNoZXMuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBMb2dpY2FsQ2xvY2ssIFZlcnNpb24sIFZlcnNpb25LaW5kLCBWYXVsdFNldHRpbmdzIH0gZnJvbSAnLi90eXBlcy5qcyc7XG5pbXBvcnQgeyBQcm90b2NvbEVycm9yIH0gZnJvbSAnLi9lcnJvcnMuanMnO1xuXG4vKiogV2lyZSBwcm90b2NvbCB2ZXJzaW9uLiBCdW1wIG9uIGJyZWFraW5nIG1lc3NhZ2Utc2hhcGUgY2hhbmdlcy4gKi9cbmV4cG9ydCBjb25zdCBQcm90b2NvbFZlcnNpb24gPSAxIGFzIGNvbnN0O1xuXG4vKiogQ29tbWl0cyBhdCBvciBiZWxvdyB0aGlzIHNpemUgbWF5IGlubGluZSBjb250ZW50IChiYXNlNjQpIG9uIHRoZSBXUy4gKi9cbmV4cG9ydCBjb25zdCBJTkxJTkVfQ09OVEVOVF9NQVhfQllURVMgPSAyNTYgKiAxMDI0O1xuXG4vKipcbiAqIE9uZSBlbnRyeSBvZiB0aGUgbWFuaWZlc3QgbWFwIChge3BhdGggXHUyMTkyIE1hbmlmZXN0RW50cnl9YCkuIFRoZSBlbnRyeSBpc1xuICogc2VsZi1kZXNjcmliaW5nOiBpdCBjYXJyaWVzIGl0cyBvd24gYHBhdGhgIGFuZCB0aGUgaGVhZCdzIGBjbG9ja2Agc28gdGhlXG4gKiBjbGllbnQtc2lkZSByZWNvbmNpbGlhdGlvbiAoYHJlc29sdmUudHNgKSBjYW4gb3JkZXIgcmVtb3RlIHN0YXRlIGFnYWluc3RcbiAqIGxvY2FsIHN0YXRlIHdpdGhvdXQgYW55IGV4dHJhIHJvdW5kLXRyaXBzLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIE1hbmlmZXN0RW50cnkge1xuICAvKiogTm9ybWFsaXplZCB2YXVsdCBwYXRoIHRoaXMgZW50cnkgZGVzY3JpYmVzIChtaXJyb3JzIHRoZSBtYXAga2V5KS4gKi9cbiAgcGF0aDogc3RyaW5nO1xuICAvKiogVmVyc2lvbiBpZCBvZiB0aGUgZW50cnkncyBoZWFkLiAqL1xuICB2ZXJzaW9uOiBzdHJpbmc7XG4gIC8qKiBzaGEyNTYgaGV4IG9mIGN1cnJlbnQgY29udGVudCAoYCcnYCBmb3IgZm9sZGVyIHBsYWNlaG9sZGVycykuICovXG4gIGhhc2g6IHN0cmluZztcbiAgLyoqIENvbnRlbnQgc2l6ZSBpbiBieXRlcyAoYDBgIGZvciBmb2xkZXIgcGxhY2Vob2xkZXJzKS4gKi9cbiAgc2l6ZTogbnVtYmVyO1xuICAvKiogVG9tYnN0b25lIGZsYWcuICovXG4gIGRlbGV0ZWQ6IGJvb2xlYW47XG4gIC8qKiBMb2dpY2FsIGNsb2NrIG9mIHRoZSBoZWFkIFx1MjAxNCB0aGUgb3JkZXJpbmcgYXV0aG9yaXR5IChcdTAwQTc0KS4gKi9cbiAgY2xvY2s6IExvZ2ljYWxDbG9jaztcbiAgLyoqIFRydWUgZm9yIGVtcHR5LWZvbGRlciBwbGFjZWhvbGRlciBlbnRyaWVzIChGUi0xMCkuICovXG4gIGlzRm9sZGVyPzogYm9vbGVhbjtcbiAgLyoqIEVwb2NoIG1zIG9mIGxhc3QgdXBkYXRlLCBkaXNwbGF5LW9ubHkuICovXG4gIG10aW1lOiBudW1iZXI7XG59XG5cbi8vIC0tLSBDbGllbnQgXHUyMTkyIFNlcnZlciAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBBdXRoICsgY2F0Y2gtdXA6IHRva2VuLCBwcm90b2NvbCB2ZXJzaW9uLCBsYXN0IHNlZW4gRE8gc2VxdWVuY2UgbnVtYmVyLiAqL1xuZXhwb3J0IGludGVyZmFjZSBIZWxsb01lc3NhZ2Uge1xuICB0eXBlOiAnaGVsbG8nO1xuICB0b2tlbjogc3RyaW5nO1xuICBwcm90b2NvbFZlcnNpb246IG51bWJlcjtcbiAgLyoqIExhc3Qgc2VlbiBnbG9iYWwgc2VxdWVuY2UgbnVtYmVyOyAwIGZvciBhIGZpcnN0LWV2ZXIgY29ubmVjdC4gKi9cbiAgY3Vyc29yOiBudW1iZXI7XG59XG5cbi8qKiBSZXF1ZXN0IGZ1bGwgKGBzaW5jZWAgb21pdHRlZCkgb3IgZGVsdGEgbWFuaWZlc3QuICovXG5leHBvcnQgaW50ZXJmYWNlIEdldE1hbmlmZXN0TWVzc2FnZSB7XG4gIHR5cGU6ICdnZXRNYW5pZmVzdCc7XG4gIHNpbmNlPzogbnVtYmVyO1xufVxuXG4vKipcbiAqIENvbW1pdCBhIG5ldyB2ZXJzaW9uLiBJZiBgaW5saW5lYCBpcyBzZXQgaXQgY2FycmllcyB0aGUgZnVsbCBjb250ZW50XG4gKiBiYXNlNjQtZW5jb2RlZCAob25seSBhbGxvd2VkIHdoZW4gYHNpemUgPD0gSU5MSU5FX0NPTlRFTlRfTUFYX0JZVEVTYCk7XG4gKiBvdGhlcndpc2UgdGhlIGJsb2IgbXVzdCBhbHJlYWR5IGJlIHVwbG9hZGVkIChgcHV0QmxvYmAgb24gdGhpcyBjaGFubmVsLFxuICogYFBVVCAvYmxvYi86aGFzaGAgb24gdGhlIHJlYWwgd29ya2VyKS5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBDb21taXRNZXNzYWdlIHtcbiAgdHlwZTogJ2NvbW1pdCc7XG4gIHBhdGg6IHN0cmluZztcbiAgLyoqIFZlcnNpb24gaWQgdGhlIGNvbW1pdCBidWlsZHMgb247IHNlcnZlciBkZXRlY3RzIGRpdmVyZ2VuY2UgXHUyMTkyIGNvbmZsaWN0LiAqL1xuICBwYXJlbnRWZXJzaW9uOiBzdHJpbmcgfCBudWxsO1xuICBoYXNoOiBzdHJpbmc7XG4gIHNpemU6IG51bWJlcjtcbiAgLyoqIFdoYXQga2luZCBvZiB2ZXJzaW9uIHRoaXMgY29tbWl0cyAobWlycm9ycyBgVmVyc2lvbi5raW5kYCkuICovXG4gIGtpbmQ6IFZlcnNpb25LaW5kO1xuICBpbmxpbmU/OiBzdHJpbmc7XG4gIC8qKiBTb3VyY2UgcGF0aCBcdTIwMTQgcmVxdWlyZWQgZm9yIGBraW5kOiAncmVuYW1lJ2AgKGNoYWluIG1pZ3JhdGlvbiwgRlItOSkuICovXG4gIGZyb21QYXRoPzogc3RyaW5nO1xuICAvKiogVHJ1ZSBmb3IgZW1wdHktZm9sZGVyIHBsYWNlaG9sZGVyIGNvbW1pdHMgKEZSLTEwOyBoYXNoIGAnJ2AsIHNpemUgMCkuICovXG4gIGlzRm9sZGVyPzogYm9vbGVhbjtcbn1cblxuLyoqIEtlZXBhbGl2ZS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUGluZ01lc3NhZ2Uge1xuICB0eXBlOiAncGluZyc7XG4gIC8qKiBDbGllbnQgZXBvY2ggbXM7IGVjaG9lZCBiYWNrIG9uIGBwb25nYCBmb3IgUlRUIC8gc2tldyBtZWFzdXJlbWVudC4gKi9cbiAgdHM/OiBudW1iZXI7XG59XG5cbi8qKlxuICogVXBsb2FkIGEgY29udGVudCBibG9iIG92ZXIgdGhlIHN5bmMgY2hhbm5lbC4gVGVzdCBkb3VibGVzIGFuZCBzbWFsbCB2YXVsdHNcbiAqIGNhbiB1c2UgdGhpcyBkaXJlY3RseTsgdGhlIHJlYWwgd29ya2VyIGV4cG9zZXMgdGhlIHNhbWUgb3BlcmF0aW9uIGFzXG4gKiBgUFVUIC9ibG9iLzpoYXNoYCAoc3RyZWFtZWQpLiBJZGVtcG90ZW50OiBzYW1lIGhhc2ggXHUyMUQyIHNhbWUgY29udGVudC5cbiAqL1xuZXhwb3J0IGludGVyZmFjZSBQdXRCbG9iTWVzc2FnZSB7XG4gIHR5cGU6ICdwdXRCbG9iJztcbiAgaGFzaDogc3RyaW5nO1xuICAvKiogRnVsbCBjb250ZW50LCBiYXNlNjQtZW5jb2RlZC4gKi9cbiAgY29udGVudDogc3RyaW5nO1xufVxuXG4vKiogRmV0Y2ggYSBjb250ZW50IGJsb2IgKHRoZSBXUy1pbmxpbmUgcGF0aCBvZiBcdTAwQTc4IFwiZmV0Y2ggYmxvYlwiKS4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgR2V0QmxvYk1lc3NhZ2Uge1xuICB0eXBlOiAnZ2V0QmxvYic7XG4gIGhhc2g6IHN0cmluZztcbn1cblxuLy8gLS0tIFNlcnZlciBcdTIxOTIgQ2xpZW50IC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuLyoqIFN1Y2Nlc3NmdWwgaGVsbG86IHRoaXMgZGV2aWNlJ3MgaWRlbnRpdHkgKyB2YXVsdC1sZXZlbCBpbmZvLiAqL1xuZXhwb3J0IGludGVyZmFjZSBIZWxsb0Fja01lc3NhZ2Uge1xuICB0eXBlOiAnaGVsbG9BY2snO1xuICBkZXZpY2VJZDogc3RyaW5nO1xuICB2YXVsdE5hbWU6IHN0cmluZztcbiAgc2V0dGluZ3M6IFZhdWx0U2V0dGluZ3M7XG59XG5cbi8qKiBSZXBseSB0byBgZ2V0TWFuaWZlc3RgOiB0aGUgKHBvc3NpYmx5IGRlbHRhKSBmaWxlIGluZGV4LiAqL1xuZXhwb3J0IGludGVyZmFjZSBNYW5pZmVzdE1lc3NhZ2Uge1xuICB0eXBlOiAnbWFuaWZlc3QnO1xuICBlbnRyaWVzOiBSZWFkb25seTxSZWNvcmQ8c3RyaW5nLCBNYW5pZmVzdEVudHJ5Pj47XG4gIC8qKiBHbG9iYWwgc2VxdWVuY2UgbnVtYmVyIHRoaXMgbWFuaWZlc3QgcmVmbGVjdHMgKGN1cnNvciBjYXRjaC11cCkuICovXG4gIGN1cnNvcjogbnVtYmVyO1xufVxuXG4vKiogQ29tbWl0IGFjY2VwdGVkIGFzIHRoZSBuZXcgaGVhZC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ29tbWl0QWNrTWVzc2FnZSB7XG4gIHR5cGU6ICdjb21taXRBY2snO1xuICAvKiogVmVyc2lvbiBpZCBhc3NpZ25lZCBieSB0aGUgYXV0aG9yaXR5LiAqL1xuICB2ZXJzaW9uOiBzdHJpbmc7XG4gIC8qKiBMb2dpY2FsIGNsb2NrIG9mIHRoZSBhY2NlcHRlZCB2ZXJzaW9uLiAqL1xuICBjbG9jazogTG9naWNhbENsb2NrO1xuICAvKiogR2xvYmFsIHNlcXVlbmNlIG51bWJlciBvZiB0aGUgYWNjZXB0ZWQgaGVhZCAoY3Vyc29yIHRyYWNraW5nKS4gKi9cbiAgc2VxOiBudW1iZXI7XG59XG5cbi8qKiBXaGF0IGhhcHBlbmVkIHRvIHRoZSBsb3Npbmcgc2lkZSBvZiBhIGNvbmN1cnJlbnQgZWRpdCAoc2VlIGRpc3Bvc2l0aW9uKS4gKi9cbmV4cG9ydCB0eXBlIENvbmZsaWN0TG9zZXJEaXNwb3NpdGlvbiA9ICdjb25mbGljdENvcHknO1xuXG4vKiogQ29tbWl0IGxvc3QgdGhlIHJhY2U7IHRoZSBzZXJ2ZXIncyBjaG9zZW4gd2lubmVyIHN0YW5kcy4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ29uZmxpY3RNZXNzYWdlIHtcbiAgdHlwZTogJ2NvbmZsaWN0JztcbiAgLyoqIFRoZSB3aW5uaW5nIHZlcnNpb24gKHRoaXMgY29tbWl0IG9yIHRoZSBjb25jdXJyZW50IG9uZSkuICovXG4gIHdpbm5lcjogVmVyc2lvbjtcbiAgLyoqIFdoYXQgdGhlIHNlcnZlciBkaWQgd2l0aCB0aGUgbG9zZXIncyBjb250ZW50IFx1MjAxNCBuZXZlciBkZWxldGVkLiAqL1xuICBsb3NlckRpc3Bvc2l0aW9uOiBDb25mbGljdExvc2VyRGlzcG9zaXRpb247XG4gIC8qKiBHbG9iYWwgc2VxdWVuY2UgbnVtYmVyIG9mIHRoZSB3aW5uaW5nIGhlYWQsIHdoZW4gaXQgaGFzIG9uZS4gKi9cbiAgc2VxPzogbnVtYmVyO1xufVxuXG4vKipcbiAqIEZhbi1vdXQgcGF5bG9hZCBzaGFyZWQgYnkgdGhlIGNoYW5nZSBicm9hZGNhc3QgYW5kIHRoZSBhcmJpdHJhdGlvbiByZXN1bHQuXG4gKiBFdmVyeXRoaW5nIGEgY2xpZW50IG5lZWRzIHRvIG1hdGVyaWFsaXplIG9uZSBoZWFkIHRyYW5zaXRpb24uXG4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQ2hhbmdlUGF5bG9hZCB7XG4gIHBhdGg6IHN0cmluZztcbiAgLyoqIFZlcnNpb24gaWQgb2YgdGhlIG5ldyBoZWFkLiAqL1xuICB2ZXJzaW9uOiBzdHJpbmc7XG4gIGhhc2g6IHN0cmluZztcbiAgc2l6ZTogbnVtYmVyO1xuICBkZWxldGVkOiBib29sZWFuO1xuICAvKiogSWQgb2YgdGhlIGRldmljZSB0aGF0IGNvbW1pdHRlZC4gKi9cbiAgZGV2aWNlOiBzdHJpbmc7XG4gIC8qKiBMb2dpY2FsIGNsb2NrIG9mIHRoZSBuZXcgaGVhZCBcdTIwMTQgY2xpZW50cyB1c2UgaXQgdG8gc2tpcCBzdGFsZSByZXBsYXlzLiAqL1xuICBjbG9jazogTG9naWNhbENsb2NrO1xuICAvKiogV2hhdCBraW5kIG9mIGNoYW5nZSB0aGlzIGlzIChtaXJyb3JzIGBWZXJzaW9uLmtpbmRgKS4gKi9cbiAga2luZDogVmVyc2lvbktpbmQ7XG4gIC8qKiBTb3VyY2UgcGF0aCBcdTIwMTQgcHJlc2VudCB3aGVuIGBraW5kOiAncmVuYW1lJ2AuICovXG4gIGZyb21QYXRoPzogc3RyaW5nO1xuICAvKiogVHJ1ZSBmb3IgZm9sZGVyIHBsYWNlaG9sZGVyIGNoYW5nZXMgKEZSLTEwKS4gKi9cbiAgaXNGb2xkZXI/OiBib29sZWFuO1xufVxuXG4vKiogRmFuLW91dCBicm9hZGNhc3QgdG8gYWxsICpvdGhlciogY29ubmVjdGVkIGNsaWVudHMuICovXG5leHBvcnQgaW50ZXJmYWNlIENoYW5nZU1lc3NhZ2UgZXh0ZW5kcyBDaGFuZ2VQYXlsb2FkIHtcbiAgdHlwZTogJ2NoYW5nZSc7XG4gIC8qKiBHbG9iYWwgc2VxdWVuY2UgbnVtYmVyIG9mIHRoaXMgY2hhbmdlIChjdXJzb3IgdHJhY2tpbmcpLiAqL1xuICBzZXE6IG51bWJlcjtcbn1cblxuLyoqIFJlcGx5IHRvIGBwdXRCbG9iYC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgQmxvYkFja01lc3NhZ2Uge1xuICB0eXBlOiAnYmxvYkFjayc7XG4gIGhhc2g6IHN0cmluZztcbn1cblxuLyoqIFJlcGx5IHRvIGBnZXRCbG9iYDogdGhlIHJlcXVlc3RlZCBjb250ZW50LiAqL1xuZXhwb3J0IGludGVyZmFjZSBCbG9iTWVzc2FnZSB7XG4gIHR5cGU6ICdibG9iJztcbiAgaGFzaDogc3RyaW5nO1xuICAvKiogRnVsbCBjb250ZW50LCBiYXNlNjQtZW5jb2RlZC4gKi9cbiAgY29udGVudDogc3RyaW5nO1xufVxuXG4vKiogTWFjaGluZS1yZWFkYWJsZSBjb2RlcyBjYXJyaWVkIGJ5IGBlcnJvcmAgbWVzc2FnZXMgKEhUVFAtZXF1aXZhbGVudCkuICovXG5leHBvcnQgdHlwZSBTZXJ2ZXJFcnJvckNvZGUgPSAnVU5BVVRIT1JJWkVEJyB8ICdSRVZPS0VEJyB8ICdOT1RfRk9VTkQnIHwgJ1BST1RPQ09MJztcblxuLyoqIE5lZ2F0aXZlIHJlcGx5IChhdXRoIGZhaWx1cmUsIHVua25vd24gYmxvYiwgcHJvdG9jb2wgdmlvbGF0aW9uLCBcdTIwMjYpLiAqL1xuZXhwb3J0IGludGVyZmFjZSBFcnJvck1lc3NhZ2Uge1xuICB0eXBlOiAnZXJyb3InO1xuICBjb2RlOiBTZXJ2ZXJFcnJvckNvZGU7XG4gIG1lc3NhZ2U6IHN0cmluZztcbn1cblxuLyoqIFByZXNlbmNlIHVwZGF0ZSBmb3IgZGFzaGJvYXJkcyAvIGB2c2Egc3RhdHVzYC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgRGV2aWNlU2Vlbk1lc3NhZ2Uge1xuICB0eXBlOiAnZGV2aWNlU2Vlbic7XG4gIGRldmljZUlkOiBzdHJpbmc7XG4gIHRzOiBudW1iZXI7XG59XG5cbi8qKiBLZWVwYWxpdmUgcmVwbHkuICovXG5leHBvcnQgaW50ZXJmYWNlIFBvbmdNZXNzYWdlIHtcbiAgdHlwZTogJ3BvbmcnO1xuICAvKiogRWNob2VzIHRoZSBgcGluZ2AgdHMgd2hlbiBvbmUgd2FzIHByb3ZpZGVkLiAqL1xuICB0cz86IG51bWJlcjtcbn1cblxuLy8gLS0tIFVuaW9uICsgZ3VhcmRzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG5leHBvcnQgdHlwZSBDbGllbnRNZXNzYWdlID1cbiAgfCBIZWxsb01lc3NhZ2VcbiAgfCBHZXRNYW5pZmVzdE1lc3NhZ2VcbiAgfCBDb21taXRNZXNzYWdlXG4gIHwgUHV0QmxvYk1lc3NhZ2VcbiAgfCBHZXRCbG9iTWVzc2FnZVxuICB8IFBpbmdNZXNzYWdlO1xuXG5leHBvcnQgdHlwZSBTZXJ2ZXJNZXNzYWdlID1cbiAgfCBIZWxsb0Fja01lc3NhZ2VcbiAgfCBNYW5pZmVzdE1lc3NhZ2VcbiAgfCBDb21taXRBY2tNZXNzYWdlXG4gIHwgQ29uZmxpY3RNZXNzYWdlXG4gIHwgQ2hhbmdlTWVzc2FnZVxuICB8IERldmljZVNlZW5NZXNzYWdlXG4gIHwgQmxvYkFja01lc3NhZ2VcbiAgfCBCbG9iTWVzc2FnZVxuICB8IEVycm9yTWVzc2FnZVxuICB8IFBvbmdNZXNzYWdlO1xuXG5leHBvcnQgdHlwZSBNZXNzYWdlID0gQ2xpZW50TWVzc2FnZSB8IFNlcnZlck1lc3NhZ2U7XG5cbmNvbnN0IENMSUVOVF9UWVBFUzogUmVhZG9ubHlTZXQ8c3RyaW5nPiA9IG5ldyBTZXQoW1xuICAnaGVsbG8nLFxuICAnZ2V0TWFuaWZlc3QnLFxuICAnY29tbWl0JyxcbiAgJ3B1dEJsb2InLFxuICAnZ2V0QmxvYicsXG4gICdwaW5nJyxcbl0pO1xuY29uc3QgU0VSVkVSX1RZUEVTOiBSZWFkb25seVNldDxzdHJpbmc+ID0gbmV3IFNldChbXG4gICdoZWxsb0FjaycsXG4gICdtYW5pZmVzdCcsXG4gICdjb21taXRBY2snLFxuICAnY29uZmxpY3QnLFxuICAnY2hhbmdlJyxcbiAgJ2RldmljZVNlZW4nLFxuICAnYmxvYkFjaycsXG4gICdibG9iJyxcbiAgJ2Vycm9yJyxcbiAgJ3BvbmcnLFxuXSk7XG5cbi8qKlxuICogUnVudGltZSBzaGFwZSBjaGVjazogYSB2YWx1ZSBpcyBhIGBNZXNzYWdlYCBpZmYgaXQgaXMgYW4gb2JqZWN0IHdob3NlXG4gKiBgdHlwZWAgaXMgYSBrbm93biBtZXNzYWdlIHR5cGUuIEZpZWxkLWxldmVsIHZhbGlkYXRpb24gaGFwcGVucyB3aGVyZSBhXG4gKiBtZXNzYWdlIGlzIGFjdGVkIHVwb24gKGxhdGVyIHBoYXNlcyk7IHRoZSBndWFyZCBpcyBkZWxpYmVyYXRlbHkgY2hlYXAgc29cbiAqIGJvdGggV1MgZW5kcyBjYW4gdHJpYWdlIHVua25vd24vZm9yd2FyZC1jb21wYXRpYmxlIHR5cGVzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gaXNNZXNzYWdlKHZhbHVlOiB1bmtub3duKTogdmFsdWUgaXMgTWVzc2FnZSB7XG4gIHJldHVybiAoXG4gICAgdHlwZW9mIHZhbHVlID09PSAnb2JqZWN0JyAmJlxuICAgIHZhbHVlICE9PSBudWxsICYmXG4gICAgdHlwZW9mICh2YWx1ZSBhcyB7IHR5cGU/OiB1bmtub3duIH0pLnR5cGUgPT09ICdzdHJpbmcnICYmXG4gICAgKENMSUVOVF9UWVBFUy5oYXMoKHZhbHVlIGFzIHsgdHlwZTogc3RyaW5nIH0pLnR5cGUpIHx8XG4gICAgICBTRVJWRVJfVFlQRVMuaGFzKCh2YWx1ZSBhcyB7IHR5cGU6IHN0cmluZyB9KS50eXBlKSlcbiAgKTtcbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGlzQ2xpZW50TWVzc2FnZSh2YWx1ZTogdW5rbm93bik6IHZhbHVlIGlzIENsaWVudE1lc3NhZ2Uge1xuICByZXR1cm4gKFxuICAgIHR5cGVvZiB2YWx1ZSA9PT0gJ29iamVjdCcgJiZcbiAgICB2YWx1ZSAhPT0gbnVsbCAmJlxuICAgIENMSUVOVF9UWVBFUy5oYXMoKHZhbHVlIGFzIHsgdHlwZT86IHVua25vd24gfSkudHlwZSBhcyBzdHJpbmcpXG4gICk7XG59XG5cbmV4cG9ydCBmdW5jdGlvbiBpc1NlcnZlck1lc3NhZ2UodmFsdWU6IHVua25vd24pOiB2YWx1ZSBpcyBTZXJ2ZXJNZXNzYWdlIHtcbiAgcmV0dXJuIChcbiAgICB0eXBlb2YgdmFsdWUgPT09ICdvYmplY3QnICYmXG4gICAgdmFsdWUgIT09IG51bGwgJiZcbiAgICBTRVJWRVJfVFlQRVMuaGFzKCh2YWx1ZSBhcyB7IHR5cGU/OiB1bmtub3duIH0pLnR5cGUgYXMgc3RyaW5nKVxuICApO1xufVxuXG4vKipcbiAqIFBhcnNlIGEgV1MgdGV4dCBmcmFtZSBpbnRvIGEgdHlwZWQgYE1lc3NhZ2VgLlxuICogVGhyb3dzIGBQcm90b2NvbEVycm9yYCBvbiBub24tSlNPTiBpbnB1dCBvciB1bmtub3duIG1lc3NhZ2UgdHlwZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZU1lc3NhZ2UoZGF0YTogc3RyaW5nKTogTWVzc2FnZSB7XG4gIGxldCBwYXJzZWQ6IHVua25vd247XG4gIHRyeSB7XG4gICAgcGFyc2VkID0gSlNPTi5wYXJzZShkYXRhKTtcbiAgfSBjYXRjaCAoY2F1c2UpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihgTWVzc2FnZSBpcyBub3QgdmFsaWQgSlNPTjogJHtTdHJpbmcoZGF0YSkuc2xpY2UoMCwgMjAwKX1gLCB7IGNhdXNlIH0pO1xuICB9XG4gIGlmICghaXNNZXNzYWdlKHBhcnNlZCkpIHtcbiAgICB0aHJvdyBuZXcgUHJvdG9jb2xFcnJvcihcbiAgICAgIGBVbmtub3duIG9yIG1hbGZvcm1lZCBtZXNzYWdlIHR5cGU6ICR7SlNPTi5zdHJpbmdpZnkoKHBhcnNlZCBhcyB7IHR5cGU/OiB1bmtub3duIH0pPy50eXBlKX1gLFxuICAgICk7XG4gIH1cbiAgcmV0dXJuIHBhcnNlZDtcbn1cblxuLy8gLS0tIHdpcmUgZW5jb2RpbmcgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vL1xuLy8gYGlubGluZWAvYGNvbnRlbnRgIGZpZWxkcyBjYXJyeSByYXcgYnl0ZXMgYXMgYmFzZTY0LiBgYnRvYWAvYGF0b2JgIGV4aXN0IGluXG4vLyBldmVyeSB0YXJnZXQgcnVudGltZSAoV29ya2VycywgTm9kZSAxNissIEVsZWN0cm9uKTsgY2h1bmtpbmcgYXZvaWRzXG4vLyBleGNlZWRpbmcgYXJndW1lbnQtbGVuZ3RoIGxpbWl0cyBvbiBsYXJnZSBhdHRhY2htZW50cy5cblxuLyoqIEVuY29kZSBieXRlcyBhcyBiYXNlNjQuICovXG5leHBvcnQgZnVuY3Rpb24gYnl0ZXNUb0Jhc2U2NChieXRlczogVWludDhBcnJheSk6IHN0cmluZyB7XG4gIGxldCBiaW5hcnkgPSAnJztcbiAgY29uc3QgQ0hVTksgPSAweDgwMDA7XG4gIGZvciAobGV0IG9mZnNldCA9IDA7IG9mZnNldCA8IGJ5dGVzLmxlbmd0aDsgb2Zmc2V0ICs9IENIVU5LKSB7XG4gICAgYmluYXJ5ICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoLi4uYnl0ZXMuc3ViYXJyYXkob2Zmc2V0LCBvZmZzZXQgKyBDSFVOSykpO1xuICB9XG4gIHJldHVybiBidG9hKGJpbmFyeSk7XG59XG5cbi8qKiBEZWNvZGUgYmFzZTY0IHRvIGJ5dGVzLiBUaHJvd3MgYFByb3RvY29sRXJyb3JgIG9uIGludmFsaWQgaW5wdXQuICovXG5leHBvcnQgZnVuY3Rpb24gYmFzZTY0VG9CeXRlcyhlbmNvZGVkOiBzdHJpbmcpOiBVaW50OEFycmF5IHtcbiAgbGV0IGJpbmFyeTogc3RyaW5nO1xuICB0cnkge1xuICAgIGJpbmFyeSA9IGF0b2IoZW5jb2RlZCk7XG4gIH0gY2F0Y2ggKGNhdXNlKSB7XG4gICAgdGhyb3cgbmV3IFByb3RvY29sRXJyb3IoJ0Jhc2U2NCBwYXlsb2FkIGlzIG5vdCB2YWxpZCcsIHsgY2F1c2UgfSk7XG4gIH1cbiAgY29uc3QgYnl0ZXMgPSBuZXcgVWludDhBcnJheShiaW5hcnkubGVuZ3RoKTtcbiAgZm9yIChsZXQgaSA9IDA7IGkgPCBiaW5hcnkubGVuZ3RoOyBpKyspIGJ5dGVzW2ldID0gYmluYXJ5LmNoYXJDb2RlQXQoaSk7XG4gIHJldHVybiBieXRlcztcbn1cbiIsICIvKipcbiAqIENvbmZsaWN0LWNvcHkgZmlsZSBuYW1pbmcgKEFSQ0hJVEVDVFVSRS5tZCBcdTAwQTc0LCBGUi02KS5cbiAqXG4gKiBXaGVuIGEgZGV2aWNlIGxvc2VzIGEgY29uZmxpY3QgYnV0IGl0cyBjb250ZW50IG11c3QgYmUgcHJlc2VydmVkLCB0aGVcbiAqIGNvbnRlbnQgaXMgY29tbWl0dGVkIHRvIGEgc2libGluZyBcImNvbmZsaWN0IGNvcHlcIiBwYXRoIHNoYXBlZCBsaWtlOlxuICpcbiAqICAgICBOb3RlIChjb25mbGljdCAyMDI2LTA4LTIwIDE0LTIzIC0gZnJvbSBQaG9uZSkubWRcbiAqICAgICBcdTI1MTRcdTI1MDAgc3RlbSBcdTI1MDBcdTI1MThcdTI1MTRcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDAgVVRDIGRhdGUgKyBISC1tbSBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MThcdTI1MTQgZGV2aWNlIFx1MjUxOFx1MjUxNGV4dFx1MjUxOFxuICpcbiAqIFJ1bGVzOlxuICogICAtIHRpbWVzdGFtcCBpcyBhbHdheXMgVVRDIChuZXZlciBhIGxvY2FsIHRpbWV6b25lKSBzbyBldmVyeSBjbGllbnRcbiAqICAgICBjb21wdXRlcyB0aGUgaWRlbnRpY2FsIG5hbWUgZnJvbSB0aGUgc2FtZSBjb21taXQgdGltZTtcbiAqICAgLSB0aGUgZGV2aWNlIG5hbWUgaXMgc2FuaXRpemVkIGZvciBmaWxlc3lzdGVtIHNhZmV0eSAoc2VlXG4gKiAgICAgYHNhbml0aXplRGV2aWNlTmFtZWApO1xuICogICAtIHRoZSBvcmlnaW5hbCBleHRlbnNpb24gaXMgcHJlc2VydmVkIChsYXN0IGRvdCBpbiB0aGUgYmFzZW5hbWUsIGFzIGxvbmdcbiAqICAgICBhcyBpdCBpcyBub3QgdGhlIGZpcnN0IGNoYXJhY3RlciBcdTIwMTQgYC5naXRpZ25vcmVgIGhhcyBubyBleHRlbnNpb24pO1xuICogICAtIGlmIHRoZSBjYW5kaWRhdGUgYWxyZWFkeSBleGlzdHMgKGluIHRoZSBsb2NhbCBpbmRleCBvciB0aGUgcmVtb3RlXG4gKiAgICAgbWFuaWZlc3QgXHUyMDE0IHRoZSBjYWxsZXIgc3VwcGxpZXMgdGhlIGBleGlzdHNgIHByZWRpY2F0ZSksIGAgMmAsIGAgM2AsIFx1MjAyNlxuICogICAgIGlzIGFwcGVuZGVkIGJlZm9yZSB0aGUgZXh0ZW5zaW9uLlxuICovXG5cbmltcG9ydCB7IGJhc2VuYW1lLCBub3JtYWxpemVWYXVsdFBhdGgsIHBhcmVudFBhdGggfSBmcm9tICcuL3BhdGhzLmpzJztcblxuLyoqIENoYXJhY3RlcnMgZm9yYmlkZGVuIG9uIGF0IGxlYXN0IG9uZSBzdXBwb3J0ZWQgcGxhdGZvcm0uICovXG5jb25zdCBJTExFR0FMX0ZJTEVOQU1FX0NIQVJTID0gL1s8PjpcIi9cXFxcfD8qXS9nO1xuLyoqIEMwIGNvbnRyb2xzICsgREVMIFx1MjAxNCBuZXZlciB2YWxpZCBpbiBmaWxlbmFtZXMuICovXG5jb25zdCBDT05UUk9MX0NIQVJTID0gL1tcXHgwMC1cXHgxZlxceDdmXS9nO1xuXG4vKiogTWF4IGxlbmd0aCAoaW4gY29kZSBwb2ludHMpIG9mIGEgc2FuaXRpemVkIGRldmljZSBuYW1lLiAqL1xuY29uc3QgTUFYX0RFVklDRV9OQU1FX0xFTkdUSCA9IDMwO1xuXG4vKiogRmFsbGJhY2sgd2hlbiBhIGRldmljZSBuYW1lIHNhbml0aXplcyB0byBub3RoaW5nLiAqL1xuY29uc3QgRkFMTEJBQ0tfREVWSUNFX05BTUUgPSAndW5rbm93bic7XG5cbi8qKiBIaWdoZXN0IGAgTmAgc3VmZml4IHRyaWVkIGJlZm9yZSBnaXZpbmcgdXAuICovXG5jb25zdCBNQVhfQ09MTElTSU9OX1NVRkZJWCA9IDk5OTtcblxuLyoqXG4gKiBTYW5pdGl6ZSBhIGRldmljZSBuYW1lIGZvciB1c2UgaW5zaWRlIGEgZmlsZW5hbWU6IHN0cmlwIGA8PjpcIi9cXFxcfD8qYCBhbmRcbiAqIGNvbnRyb2wgY2hhcmFjdGVycywgdHJpbSB3aGl0ZXNwYWNlIGFuZCBlZGdlIGRvdHMgKFdpbmRvd3Mgc2VnbWVudHMgbWF5XG4gKiBub3QgZW5kIHdpdGggYC5gIG9yIHdoaXRlc3BhY2UpLCB0cnVuY2F0ZSB0byAzMCBjb2RlIHBvaW50cyAobmV2ZXIgc3BsaXRzXG4gKiBhIHN1cnJvZ2F0ZSBwYWlyKS4gUmV0dXJucyBgJ3Vua25vd24nYCB3aGVuIG5vdGhpbmcgc3Vydml2ZXMuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBzYW5pdGl6ZURldmljZU5hbWUobmFtZTogc3RyaW5nKTogc3RyaW5nIHtcbiAgbGV0IGNsZWFuZWQgPSBuYW1lLnJlcGxhY2UoSUxMRUdBTF9GSUxFTkFNRV9DSEFSUywgJycpLnJlcGxhY2UoQ09OVFJPTF9DSEFSUywgJycpO1xuICBjbGVhbmVkID0gWy4uLmNsZWFuZWRdLnNsaWNlKDAsIE1BWF9ERVZJQ0VfTkFNRV9MRU5HVEgpLmpvaW4oJycpO1xuICBjbGVhbmVkID0gY2xlYW5lZC50cmltKCkucmVwbGFjZSgvXlsuXFxzXSt8Wy5cXHNdKyQvZywgJycpO1xuICByZXR1cm4gY2xlYW5lZC5sZW5ndGggPT09IDAgPyBGQUxMQkFDS19ERVZJQ0VfTkFNRSA6IGNsZWFuZWQ7XG59XG5cbi8qKlxuICogQ29tcHV0ZSB0aGUgY29uZmxpY3QtY29weSBwYXRoIGZvciBgcGF0aGAuXG4gKlxuICogUHVyZSBhbmQgZGV0ZXJtaW5pc3RpYzogdGhlIHNhbWUgYChwYXRoLCBkZXZpY2VOYW1lLCBub3csIGV4aXN0cylgIGFsd2F5c1xuICogeWllbGRzIHRoZSBzYW1lIHJlc3VsdC4gYG5vd2AgaXMgdGhlIGNvbmZsaWN0J3MgZXBvY2gtbXMgdGltZXN0YW1wICh0aGVcbiAqIGNhbGxlciBwYXNzZXMgaXQgaW4gXHUyMDE0IG5vIGhpZGRlbiBjbG9ja3MpOyBgZXhpc3RzYCBpcyBjb25zdWx0ZWQgZm9yXG4gKiBjb2xsaXNpb24gYXZvaWRhbmNlIGFuZCB0eXBpY2FsbHkgY2hlY2tzIHRoZSBsb2NhbCBpbmRleCBwbHVzIHRoZSByZW1vdGVcbiAqIG1hbmlmZXN0LlxuICpcbiAqIFRocm93cyB3aGVuIG1vcmUgdGhhbiBgTUFYX0NPTExJU0lPTl9TVUZGSVhgIG5hbWUgY29sbGlzaW9ucyBvY2N1ciAoYVxuICogZ2VudWluZWx5IHBhdGhvbG9naWNhbCB2YXVsdCBzdGF0ZSB0aGUgY2FsbGVyIHNob3VsZCBzdXJmYWNlLCBub3QgcGFwZXJcbiAqIG92ZXIpLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY29uZmxpY3RDb3B5UGF0aChcbiAgcGF0aDogc3RyaW5nLFxuICBkZXZpY2VOYW1lOiBzdHJpbmcsXG4gIG5vdzogbnVtYmVyLFxuICBleGlzdHM6IChjYW5kaWRhdGVQYXRoOiBzdHJpbmcpID0+IGJvb2xlYW4gPSAoKSA9PiBmYWxzZSxcbik6IHN0cmluZyB7XG4gIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVWYXVsdFBhdGgocGF0aCk7XG4gIGNvbnN0IGRpciA9IHBhcmVudFBhdGgobm9ybWFsaXplZCk7XG4gIGNvbnN0IG5hbWUgPSBiYXNlbmFtZShub3JtYWxpemVkKTtcblxuICBjb25zdCBsYXN0RG90ID0gbmFtZS5sYXN0SW5kZXhPZignLicpO1xuICBjb25zdCBoYXNFeHRlbnNpb24gPSBsYXN0RG90ID4gMDsgLy8gYSBsZWFkaW5nIGRvdCBtYXJrcyBhIGRvdGZpbGUsIG5vdCBhbiBleHRlbnNpb25cbiAgY29uc3Qgc3RlbSA9IGhhc0V4dGVuc2lvbiA/IG5hbWUuc2xpY2UoMCwgbGFzdERvdCkgOiBuYW1lO1xuICBjb25zdCBleHRlbnNpb24gPSBoYXNFeHRlbnNpb24gPyBuYW1lLnNsaWNlKGxhc3REb3QpIDogJyc7XG5cbiAgY29uc3Qgc3VmZml4ID0gYCAoY29uZmxpY3QgJHtmb3JtYXRDb25mbGljdFN0YW1wKG5vdyl9IC0gZnJvbSAke3Nhbml0aXplRGV2aWNlTmFtZShkZXZpY2VOYW1lKX0pYDtcbiAgY29uc3Qgam9pbiA9IChmaWxlTmFtZTogc3RyaW5nKTogc3RyaW5nID0+IChkaXIgPT09ICcvJyA/IGAvJHtmaWxlTmFtZX1gIDogYCR7ZGlyfS8ke2ZpbGVOYW1lfWApO1xuXG4gIGxldCBjYW5kaWRhdGUgPSBqb2luKGAke3N0ZW19JHtzdWZmaXh9JHtleHRlbnNpb259YCk7XG4gIGZvciAobGV0IG4gPSAyOyBuIDw9IE1BWF9DT0xMSVNJT05fU1VGRklYOyBuKyspIHtcbiAgICBpZiAoIWV4aXN0cyhjYW5kaWRhdGUpKSByZXR1cm4gY2FuZGlkYXRlO1xuICAgIGNhbmRpZGF0ZSA9IGpvaW4oYCR7c3RlbX0ke3N1ZmZpeH0gJHtufSR7ZXh0ZW5zaW9ufWApO1xuICB9XG4gIHRocm93IG5ldyBFcnJvcihcbiAgICBgY29uZmxpY3RDb3B5UGF0aDogbW9yZSB0aGFuICR7TUFYX0NPTExJU0lPTl9TVUZGSVh9IGNvbGxpc2lvbnMgZm9yICR7SlNPTi5zdHJpbmdpZnkobm9ybWFsaXplZCl9YCxcbiAgKTtcbn1cblxuLyoqIGAyMDI2LTA4LTIwIDE0LTIzYCBcdTIwMTQgVVRDIGRhdGUsIHNwYWNlLCB6ZXJvLXBhZGRlZCBISC1tbS4gTWludXRlcywgbm90IHNlY29uZHMuICovXG5mdW5jdGlvbiBmb3JtYXRDb25mbGljdFN0YW1wKG5vdzogbnVtYmVyKTogc3RyaW5nIHtcbiAgY29uc3QgZCA9IG5ldyBEYXRlKG5vdyk7XG4gIGNvbnN0IHBhZCA9IChuOiBudW1iZXIpOiBzdHJpbmcgPT4gU3RyaW5nKG4pLnBhZFN0YXJ0KDIsICcwJyk7XG4gIHJldHVybiAoXG4gICAgYCR7ZC5nZXRVVENGdWxsWWVhcigpfS0ke3BhZChkLmdldFVUQ01vbnRoKCkgKyAxKX0tJHtwYWQoZC5nZXRVVENEYXRlKCkpfWAgK1xuICAgIGAgJHtwYWQoZC5nZXRVVENIb3VycygpKX0tJHtwYWQoZC5nZXRVVENNaW51dGVzKCkpfWBcbiAgKTtcbn1cbiIsICIvKipcbiAqIFRocmVlLXdheSByZWNvbmNpbGlhdGlvbiAoQVJDSElURUNUVVJFLm1kIFx1MDBBNzggc3RlcCA0KS5cbiAqXG4gKiBgY29tcHV0ZVN5bmNQbGFuYCBpcyBhIFBVUkUsIERFVEVSTUlOSVNUSUMgZnVuY3Rpb246IHRoZSBzYW1lIGlucHV0cyBhbHdheXNcbiAqIHByb2R1Y2UgdGhlIHNhbWUgcGxhbiAobWFuaWZlc3QgYW5kIGNoYW5nZSBidWNrZXRzIGFyZSByZS1zb3J0ZWRcbiAqIGludGVybmFsbHk7IGBub3dgIGlzIGEgcGFyYW1ldGVyLCBuZXZlciByZWFkIGZyb20gYSBjbG9jaykuIEl0IGNvbXBhcmVzXG4gKiB0aHJlZSBzdGF0ZXMgZm9yIGV2ZXJ5IHBhdGg6XG4gKlxuICogICAtIHRoZSAqKmxvY2FsIGluZGV4KiogXHUyMDE0IHdoYXQgdGhpcyBkZXZpY2UgbGFzdCBrbmV3IGFzIGF1dGhvcml0YXRpdmVcbiAqICAgICAodGhlIFwiY29tbW9uIGFuY2VzdG9yXCIgb2YgdGhlIHRocmVlLXdheSBtZXJnZSk7XG4gKiAgIC0gdGhlICoqbG9jYWwgY2hhbmdlcyoqIFx1MjAxNCBob3cgbG9jYWwgc3RvcmFnZSBkaXZlcmdlZCBmcm9tIHRoZSBpbmRleFxuICogICAgIHdoaWxlIG9mZmxpbmUgKGBzY2FuLnRzYCBvdXRwdXQpO1xuICogICAtIHRoZSAqKm1hbmlmZXN0KiogXHUyMDE0IHRoZSBhdXRob3JpdHkncyBjdXJyZW50IGhlYWQgcGVyIHBhdGguXG4gKlxuICogYW5kIGVtaXRzIGEgYFN5bmNQbGFuYCAoc2hhcGUgZG9jdW1lbnRlZCBvbiB0aGUgaW50ZXJmYWNlKTogb3BzIHRvIHB1c2gsXG4gKiBvcHMgdG8gcHVsbCwgY29uZmxpY3QgcmVzb2x1dGlvbnMsIGFuZCBmb2xkZXIgcGxhY2Vob2xkZXJzIHRvIHB1c2guXG4gKlxuICogQ29uZmxpY3QgYXJiaXRyYXRpb24gbWlycm9ycyB0aGUgRE8ncyBydWxlIChcdTAwQTc0KTogd2lubmVyID0gaGlnaGVyIGxvZ2ljYWxcbiAqIGNsb2NrOyB0aWUgXHUyMTkyIGdyZWF0ZXIgZGV2aWNlSWQuIFRoZSBsb2NhbCBzaWRlJ3MgKnRlbnRhdGl2ZSogY2xvY2sgaXNcbiAqIGBuZXh0Q2xvY2soaW5kZXggY2xvY2ssIHRoaXNEZXZpY2VJZClgIFx1MjAxNCBleGFjdGx5IHRoZSBjb3VudGVyIHRoZSBETyB3b3VsZFxuICogYXNzaWduIGEgY29tbWl0IGJ1aWxkaW5nIG9uIHRoZSBzYW1lIHBhcmVudCwgc28gdGhlIGNsaWVudCdzIHByZWRpY3Rpb25cbiAqIG1hdGNoZXMgdGhlIHNlcnZlcidzIGFyYml0cmF0aW9uLiBXaGVuIHRoZSByZW1vdGUgc2lkZSB3aW5zLCB0aGUgbG9zaW5nXG4gKiBsb2NhbCBjb250ZW50IGlzIHByZXNlcnZlZCBieSBwdXNoaW5nIGl0IHRvIGEgY29uZmxpY3QtY29weSBwYXRoXG4gKiAoYGNvbmZsaWN0bmFtZXMudHNgKTsgd2hlbiB0aGUgbG9jYWwgc2lkZSB3aW5zLCB0aGUgY2xpZW50IHNpbXBseSBjb21taXRzXG4gKiB3aXRoIGl0cyAobm93IHN0YWxlKSBwYXJlbnQgdmVyc2lvbiBhbmQgbGV0cyB0aGUgc2VydmVyIGFyYml0cmF0ZSBcdTIwMTQgdGhlXG4gKiBzZXJ2ZXIgc3ludGhlc2l6ZXMgYW55IGNvbmZsaWN0IGNvcHkgZm9yIHRoZSBsb3NpbmcgcmVtb3RlIGNvbnRlbnQsIHdoaWNoXG4gKiBhcnJpdmVzIGxhdGVyIGFzIGFuIG9yZGluYXJ5IGNoYW5nZSBldmVudC5cbiAqL1xuXG5pbXBvcnQgeyBjb21wYXJlQ2xvY2tzLCBuZXh0Q2xvY2sgfSBmcm9tICcuL2Nsb2NrLmpzJztcbmltcG9ydCB7IGNvbmZsaWN0Q29weVBhdGggfSBmcm9tICcuL2NvbmZsaWN0bmFtZXMuanMnO1xuaW1wb3J0IHR5cGUgeyBMb2NhbEluZGV4LCBMb2NhbEluZGV4RW50cnkgfSBmcm9tICcuL2xvY2FsaW5kZXguanMnO1xuaW1wb3J0IHsgcGFyZW50UGF0aCB9IGZyb20gJy4vcGF0aHMuanMnO1xuaW1wb3J0IHR5cGUgeyBNYW5pZmVzdEVudHJ5IH0gZnJvbSAnLi9wcm90b2NvbC5qcyc7XG5pbXBvcnQgdHlwZSB7IERlbGV0ZWRDYW5kaWRhdGUsIExvY2FsQ2hhbmdlcywgUmVuYW1lQ2FuZGlkYXRlLCBTY2FuQ2FuZGlkYXRlIH0gZnJvbSAnLi9zY2FuLmpzJztcbmltcG9ydCB0eXBlIHsgTG9naWNhbENsb2NrIH0gZnJvbSAnLi90eXBlcy5qcyc7XG5cbi8qKlxuICogQSBtYW5pZmVzdCBlbnRyeSBhcyByZWNvbmNpbGlhdGlvbiBjb25zdW1lcyBpdC4gU2luY2UgYE1hbmlmZXN0RW50cnlgIGdyZXdcbiAqIGBwYXRoYCwgYGNsb2NrYCwgYW5kIGBpc0ZvbGRlcmAgKHByb3RvY29sIHYxLCBwcmUtcmVsZWFzZSksIHRoaXMgaXMgbm93IHRoZVxuICogbWFuaWZlc3QgZW50cnkgaXRzZWxmIFx1MjAxNCBrZXB0IGFzIGEgbmFtZWQgYWxpYXMgc28gYGNvbXB1dGVTeW5jUGxhbmAncyBpbnB1dFxuICogY29udHJhY3Qgc3RheXMgc2VsZi1kb2N1bWVudGluZy5cbiAqL1xuZXhwb3J0IHR5cGUgUmVtb3RlRmlsZSA9IE1hbmlmZXN0RW50cnk7XG5cbi8qKiBJbnB1dCB0byBgY29tcHV0ZVN5bmNQbGFuYC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgU3luY1BsYW5JbnB1dCB7XG4gIGxvY2FsQ2hhbmdlczogTG9jYWxDaGFuZ2VzO1xuICBpbmRleDogTG9jYWxJbmRleDtcbiAgbWFuaWZlc3Q6IHJlYWRvbmx5IFJlbW90ZUZpbGVbXTtcbiAgdGhpc0RldmljZUlkOiBzdHJpbmc7XG4gIC8qKiBIdW1hbi1yZWFkYWJsZSBuYW1lIG9mIHRoaXMgZGV2aWNlIFx1MjAxNCB1c2VkIGluIGNvbmZsaWN0LWNvcHkgZmlsZSBuYW1lcy4gKi9cbiAgdGhpc0RldmljZU5hbWU6IHN0cmluZztcbiAgLyoqIEVwb2NoIG1zIHVzZWQgZm9yIGNvbmZsaWN0LWNvcHkgdGltZXN0YW1wcyAocGFzc2VkIGluIGZvciBkZXRlcm1pbmlzbSkuICovXG4gIG5vdzogbnVtYmVyO1xufVxuXG4vKiogV2h5IGEgcGF0aCB3ZW50IHRocm91Z2ggY29uZmxpY3QgcmVzb2x1dGlvbi4gKi9cbmV4cG9ydCB0eXBlIENvbmZsaWN0UmVhc29uID0gJ2NvbmN1cnJlbnQtZWRpdCcgfCAnYWRkLXZzLWFkZCcgfCAnZGVsZXRlLXZzLWVkaXQnIHwgJ3JlbmFtZS1yYWNlJztcblxuLyoqXG4gKiBBIGNvbW1pdCB0aGlzIGRldmljZSBzaG91bGQgc2VuZCAocGF5bG9hZCBvZiBhIHByb3RvY29sIGBjb21taXRgIG1lc3NhZ2UpLlxuICpcbiAqIGBwYXJlbnRWZXJzaW9uYCBzZW1hbnRpY3M6XG4gKiAgIC0gbG9jYWwtb25seSBjaGFuZ2VzIGFuZCBsb2NhbC13aW5zIGNvbmZsaWN0cyBuYW1lIHRoZSAqaW5kZXgqIGhlYWQgKG9yXG4gKiAgICAgYG51bGxgIGZvciBicmFuZC1uZXcgcGF0aHMpIFx1MjAxNCBkZWxpYmVyYXRlbHkgc3RhbGUgd2hlbiBhIGNvbmZsaWN0IHdhc1xuICogICAgIHByZWRpY3RlZCwgc28gdGhlIERPIGFyYml0cmF0ZXMgYW5kIHByZXNlcnZlcyB0aGUgbG9zaW5nIHJlbW90ZVxuICogICAgIGNvbnRlbnQgc2VydmVyLXNpZGU7XG4gKiAgIC0gY29uZmxpY3QtY29weSBwdXNoZXMgbmFtZSB0aGUgKnJlbW90ZSogaGVhZCAoZmFzdC1wYXRoOiB0aGV5IGJ1aWxkIG9uXG4gKiAgICAgdGhlIHdpbm5lciBhbmQgbXVzdCBub3QgcmUtY29uZmxpY3QpLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFB1c2hGaWxlT3Age1xuICBraW5kOiAnYWRkJyB8ICdlZGl0JyB8ICdkZWxldGUnIHwgJ3Jlc3RvcmUnIHwgJ2NvbmZsaWN0Q29weSc7XG4gIHBhdGg6IHN0cmluZztcbiAgcGFyZW50VmVyc2lvbjogc3RyaW5nIHwgbnVsbDtcbiAgLyoqIENvbnRlbnQgaGFzaDsgZGVsZXRlIG9wcyByZXVzZSB0aGUgZGVsZXRlZCBjb250ZW50J3MgaGFzaC4gKi9cbiAgaGFzaDogc3RyaW5nO1xuICBzaXplOiBudW1iZXI7XG59XG5cbi8qKiBBIGxvY2FsIHJlbmFtZSB0byBjb21taXQgYXMgb25lIGNoYWluIG1pZ3JhdGlvbiAoRlItOSkuICovXG5leHBvcnQgaW50ZXJmYWNlIFB1c2hSZW5hbWVPcCB7XG4gIGtpbmQ6ICdyZW5hbWUnO1xuICBmcm9tUGF0aDogc3RyaW5nO1xuICB0b1BhdGg6IHN0cmluZztcbiAgLyoqIFZlcnNpb24gb2YgdGhlIGBmcm9tUGF0aGAgaGVhZCB0aGlzIHJlbmFtZSBidWlsZHMgb24uICovXG4gIHBhcmVudFZlcnNpb246IHN0cmluZyB8IG51bGw7XG4gIGhhc2g6IHN0cmluZztcbiAgc2l6ZTogbnVtYmVyO1xufVxuXG5leHBvcnQgdHlwZSBQdXNoT3AgPSBQdXNoRmlsZU9wIHwgUHVzaFJlbmFtZU9wO1xuXG4vKiogUmVtb3RlIGNvbnRlbnQgdGhpcyBkZXZpY2Ugc2hvdWxkIGZldGNoIGFuZCBtYXRlcmlhbGl6ZSB2aWEgYGFwcGx5UHVsbGAuICovXG5leHBvcnQgaW50ZXJmYWNlIFB1bGxGaWxlT3Age1xuICBraW5kOiAnYWRkJyB8ICdlZGl0JyB8ICdkZWxldGUnIHwgJ3Jlc3RvcmUnO1xuICBwYXRoOiBzdHJpbmc7XG4gIGhhc2g6IHN0cmluZztcbiAgc2l6ZTogbnVtYmVyO1xuICB2ZXJzaW9uOiBzdHJpbmc7XG4gIGNsb2NrOiBMb2dpY2FsQ2xvY2s7XG4gIC8qKiBUcnVlIGZvciB0b21ic3RvbmVzIChraW5kIGAnZGVsZXRlJ2ApLiAqL1xuICBkZWxldGVkOiBib29sZWFuO1xuICAvKiogVHJ1ZSBmb3IgZW1wdHktZm9sZGVyIHBsYWNlaG9sZGVyIHB1bGxzIChGUi0xMCkgXHUyMDE0IG1hdGVyaWFsaXplIHdpdGggYGVuc3VyZURpcmAuICovXG4gIGlzRm9sZGVyPzogYm9vbGVhbjtcbn1cblxuLyoqIEEgcmVtb3RlIHJlbmFtZSB0byBmb2xsb3cgbG9jYWxseSAoZGV0ZWN0ZWQgYnkgaGFzaCBjb3JyZWxhdGlvbikuICovXG5leHBvcnQgaW50ZXJmYWNlIFB1bGxSZW5hbWVPcCB7XG4gIGtpbmQ6ICdyZW5hbWUnO1xuICBmcm9tUGF0aDogc3RyaW5nO1xuICB0b1BhdGg6IHN0cmluZztcbiAgaGFzaDogc3RyaW5nO1xuICBzaXplOiBudW1iZXI7XG4gIHZlcnNpb246IHN0cmluZztcbiAgY2xvY2s6IExvZ2ljYWxDbG9jaztcbn1cblxuZXhwb3J0IHR5cGUgUHVsbE9wID0gUHVsbEZpbGVPcCB8IFB1bGxSZW5hbWVPcDtcblxuLyoqXG4gKiBPbmUgYXJiaXRyYXRlZCBjb25mbGljdC4gYGxvc2VyQ29udGVudGAgaXMgYCdub25lJ2Agd2hlbiB0aGUgbG9zaW5nIHNpZGVcbiAqIHdhcyBhIGRlbGV0aW9uIChub3RoaW5nIHRvIHByZXNlcnZlKS4gV2hlbiB0aGUgbG9jYWwgY29udGVudCBsb3N0IGFuZCBoYWRcbiAqIGNvbnRlbnQsIGBjb25mbGljdENvcHlQYXRoYCBuYW1lcyB3aGVyZSB0aGUgcGxhbiBwcmVzZXJ2ZXMgaXQgKHRoZSBwdXNoXG4gKiBpdHNlbGYgaXMgaW4gYFN5bmNQbGFuLnB1c2hlc2Agd2l0aCBraW5kIGAnY29uZmxpY3RDb3B5J2ApLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIENvbmZsaWN0T3Age1xuICBwYXRoOiBzdHJpbmc7XG4gIHJlYXNvbjogQ29uZmxpY3RSZWFzb247XG4gIHdpbm5lcjogJ2xvY2FsJyB8ICdyZW1vdGUnO1xuICBsb3NlckNvbnRlbnQ6ICdsb2NhbCcgfCAncmVtb3RlJyB8ICdub25lJztcbiAgY29uZmxpY3RDb3B5UGF0aD86IHN0cmluZztcbiAgcmVtb3RlOiB7IHZlcnNpb246IHN0cmluZzsgaGFzaDogc3RyaW5nOyBzaXplOiBudW1iZXI7IGRlbGV0ZWQ6IGJvb2xlYW47IGNsb2NrOiBMb2dpY2FsQ2xvY2sgfTtcbiAgLyoqIFRoZSB0ZW50YXRpdmUgY2xvY2sgdGhlIGxvY2FsIHNpZGUgd2FzIGFyYml0cmF0ZWQgd2l0aC4gKi9cbiAgbG9jYWxDbG9jazogTG9naWNhbENsb2NrO1xufVxuXG4vKipcbiAqIFRoZSBjb21wbGV0ZSByZWNvbmNpbGlhdGlvbiByZXN1bHQgZm9yIG9uZSBzeW5jIGN5Y2xlLiBPcHMgYXJlIHNvcnRlZCBieVxuICogdGFyZ2V0IHBhdGggKHJlbmFtZXMgYnkgYHRvUGF0aGApOyBldmVyeSBhcnJheSBtYXkgYmUgZW1wdHkuIGBwdXNoZXNgIGFuZFxuICogYHB1bGxzYCBhcmUgaW5kZXBlbmRlbnQgXHUyMDE0IGEgcGF0aCBhcHBlYXJzIGF0IG1vc3Qgb25jZSBpbiBlYWNoLiBQdXNoZXMgYXJlXG4gKiBOT1QgYXBwbGllZCB0byB0aGUgbG9jYWwgaW5kZXggdW50aWwgdGhlIHNlcnZlciBhY2tzIHRoZW07IHB1bGxzIGFyZVxuICogYXBwbGllZCBieSBgYXBwbHlQdWxsYCAoYGVuZ2luZS50c2ApLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFN5bmNQbGFuIHtcbiAgLyoqIENvbW1pdHMgdG8gc2VuZCwgaW4gb3JkZXIuICovXG4gIHB1c2hlczogUHVzaE9wW107XG4gIC8qKiBSZW1vdGUgY2hhbmdlcyB0byBtYXRlcmlhbGl6ZSwgaW4gb3JkZXIuICovXG4gIHB1bGxzOiBQdWxsT3BbXTtcbiAgLyoqIENvbmZsaWN0cyB0aGF0IHdlcmUgYXJiaXRyYXRlZCAoaW5mb3JtYXRpb25hbDsgc2lkZSBlZmZlY3RzIGxpdmUgaW4gcHVzaGVzL3B1bGxzKS4gKi9cbiAgY29uZmxpY3RzOiBDb25mbGljdE9wW107XG4gIC8qKiBFbXB0eS1mb2xkZXIgcGxhY2Vob2xkZXIgcGF0aHMgdG8gY3JlYXRlIHJlbW90ZWx5IChGUi0xMCkuICovXG4gIGZvbGRlclB1c2hlczogc3RyaW5nW107XG59XG5cbi8qKiBJbnRlcm5hbDogYSBsb2NhbCBjYW5kaWRhdGUgKGFkZGVkL21vZGlmaWVkL2RlbGV0ZWQpIHVuaWZpZWQgZm9yIHJlc29sdXRpb24uICovXG5pbnRlcmZhY2UgTG9jYWxDYW5kaWRhdGUge1xuICBwYXRoOiBzdHJpbmc7XG4gIGtpbmQ6ICdhZGQnIHwgJ2VkaXQnIHwgJ3Jlc3RvcmUnIHwgJ2RlbGV0ZSc7XG4gIGhhc2g6IHN0cmluZztcbiAgc2l6ZTogbnVtYmVyO1xufVxuXG5jb25zdCBaRVJPX0NMT0NLOiBMb2dpY2FsQ2xvY2sgPSB7IGNvdW50ZXI6IDAsIGRldmljZUlkOiAnJyB9O1xuXG4vKipcbiAqIENvbXB1dGUgdGhlIHN5bmMgcGxhbi4gU2VlIHRoZSBtb2R1bGUgZG9jIGZvciB0aGUgbW9kZWwgYW5kIHRoZSBvcFxuICogc2VtYW50aWNzLiBUaHJvd3Mgbm90aGluZyBvbiBvcmRpbmFyeSBkaXZlcmdlbmNlIFx1MjAxNCBjb25mbGljdHMgYXJlIGRhdGEsXG4gKiBub3QgZXJyb3JzLlxuICovXG5leHBvcnQgZnVuY3Rpb24gY29tcHV0ZVN5bmNQbGFuKGlucHV0OiBTeW5jUGxhbklucHV0KTogU3luY1BsYW4ge1xuICBjb25zdCB7IGxvY2FsQ2hhbmdlcywgaW5kZXgsIHRoaXNEZXZpY2VJZCwgdGhpc0RldmljZU5hbWUsIG5vdyB9ID0gaW5wdXQ7XG4gIGNvbnN0IG1hbmlmZXN0ID0gWy4uLmlucHV0Lm1hbmlmZXN0XS5zb3J0KChhLCBiKSA9PiBjb21wYXJlU3RyaW5ncyhhLnBhdGgsIGIucGF0aCkpO1xuICBjb25zdCBtYW5pZmVzdEJ5UGF0aCA9IG5ldyBNYXAobWFuaWZlc3QubWFwKChlbnRyeSkgPT4gW2VudHJ5LnBhdGgsIGVudHJ5XSkpO1xuXG4gIGNvbnN0IHB1c2hlczogUHVzaE9wW10gPSBbXTtcbiAgY29uc3QgcHVsbHM6IFB1bGxPcFtdID0gW107XG4gIGNvbnN0IGNvbmZsaWN0czogQ29uZmxpY3RPcFtdID0gW107XG5cbiAgLy8gRXZlcnkgcGF0aCB0aGUgbG9jYWwgc2lkZSBkaXZlcmdlZCBvbiAoc2NhbiBidWNrZXRzICsgYm90aCBlbmRzIG9mIHJlbmFtZXMpLlxuICBjb25zdCBsb2NhbFBhdGhzID0gbmV3IFNldDxzdHJpbmc+KCk7XG4gIGZvciAoY29uc3QgYyBvZiBsb2NhbENoYW5nZXMuYWRkZWQpIGxvY2FsUGF0aHMuYWRkKGMucGF0aCk7XG4gIGZvciAoY29uc3QgYyBvZiBsb2NhbENoYW5nZXMubW9kaWZpZWQpIGxvY2FsUGF0aHMuYWRkKGMucGF0aCk7XG4gIGZvciAoY29uc3QgZCBvZiBsb2NhbENoYW5nZXMuZGVsZXRlZCkgbG9jYWxQYXRocy5hZGQoZC5wYXRoKTtcbiAgZm9yIChjb25zdCByIG9mIGxvY2FsQ2hhbmdlcy5yZW5hbWVkKSB7XG4gICAgbG9jYWxQYXRocy5hZGQoci5mcm9tKTtcbiAgICBsb2NhbFBhdGhzLmFkZChyLnRvKTtcbiAgfVxuXG4gIC8vIFBhdGhzIGFscmVhZHkgY29uc3VtZWQgYnkgYW4gZWFybGllciBwaGFzZSAocmVuYW1lIGNvcnJlbGF0aW9uIGV0Yy4pLlxuICBjb25zdCBjb25zdW1lZCA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuXG4gIGNvbnN0IHBhdGhFeGlzdHMgPSAocGF0aDogc3RyaW5nKTogYm9vbGVhbiA9PiBwYXRoIGluIGluZGV4IHx8IG1hbmlmZXN0QnlQYXRoLmhhcyhwYXRoKTtcblxuICAvLyAtLS0gUGhhc2UgQTogbG9jYWwgcmVuYW1lcyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgLy8gVW5jb250ZXN0ZWQ6IG9uZSBQdXNoUmVuYW1lT3AuIENvbnRlc3RlZCAocmVtb3RlIGNoYW5nZWQgYXQgZWl0aGVyIGVuZCk6XG4gIC8vIGRlY29tcG9zZSBcdTIwMTQgdGhlIGBmcm9tYCBzaWRlIGlzIHJlc29sdmVkIG9uIGl0cyBvd24gKHVzdWFsbHkgdG9tYnN0b25lZFxuICAvLyBvciBwdWxsZWQpLCB0aGUgcmVuYW1lZCBjb250ZW50IGlzIHBsYWNlZCBhdCBgdG9gIHRocm91Z2ggdGhlIGdlbmVyaWNcbiAgLy8gY29udGVudCBtYWNoaW5lcnkuIENvbnRlbnQgaXMgbmV2ZXIgbG9zdCBlaXRoZXIgd2F5LlxuICBmb3IgKGNvbnN0IHJlbmFtZSBvZiBbLi4ubG9jYWxDaGFuZ2VzLnJlbmFtZWRdLnNvcnQoKGEsIGIpID0+IGNvbXBhcmVTdHJpbmdzKGEuZnJvbSwgYi5mcm9tKSkpIHtcbiAgICBjb25zdCBpbmRleEZyb20gPSBpbmRleFtyZW5hbWUuZnJvbV07XG4gICAgY29uc3QgaW5kZXhUbyA9IGluZGV4W3JlbmFtZS50b107XG4gICAgY29uc3QgcmVtb3RlRnJvbSA9IG1hbmlmZXN0QnlQYXRoLmdldChyZW5hbWUuZnJvbSk7XG4gICAgY29uc3QgcmVtb3RlVG8gPSBtYW5pZmVzdEJ5UGF0aC5nZXQocmVuYW1lLnRvKTtcblxuICAgIGNvbnN0IGZyb21DaGFuZ2VkID0gcmVtb3RlRnJvbVxuICAgICAgPyByZW1vdGVFbnRyeUNoYW5nZWQoaW5kZXhGcm9tLCByZW1vdGVGcm9tKVxuICAgICAgOiBpbmRleEZyb20/LmRlbGV0ZWRBdCA9PT0gdW5kZWZpbmVkOyAvLyBhYnNlbnQgcmVtb3RlbHkgKyBsaXZlIGxvY2FsbHkgXHUyMUQyIGNoYW5nZWRcbiAgICBjb25zdCB0b0NoYW5nZWQgPSByZW1vdGVUb1xuICAgICAgPyByZW1vdGVFbnRyeUNoYW5nZWQoaW5kZXhUbywgcmVtb3RlVG8pXG4gICAgICA6IGZhbHNlOyAvLyBhYnNlbnQgcmVtb3RlbHkgXHUyMUQyIG5vdGhpbmcgdG8gcmFjZSBhdCBgdG9gXG5cbiAgICBpZiAoIWZyb21DaGFuZ2VkICYmICF0b0NoYW5nZWQpIHtcbiAgICAgIHB1c2hlcy5wdXNoKHtcbiAgICAgICAga2luZDogJ3JlbmFtZScsXG4gICAgICAgIGZyb21QYXRoOiByZW5hbWUuZnJvbSxcbiAgICAgICAgdG9QYXRoOiByZW5hbWUudG8sXG4gICAgICAgIHBhcmVudFZlcnNpb246IGluZGV4RnJvbT8udmVyc2lvbklkID8/IG51bGwsXG4gICAgICAgIGhhc2g6IHJlbmFtZS5oYXNoLFxuICAgICAgICBzaXplOiByZW5hbWUuc2l6ZSxcbiAgICAgIH0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuXG4gICAgLy8gYGZyb21gIHNpZGUgb2YgYSBjb250ZXN0ZWQgcmVuYW1lOlxuICAgIGlmICghZnJvbUNoYW5nZWQpIHtcbiAgICAgIC8vIE5vdGhpbmcgcmVtb3RlIHRoZXJlIFx1MjAxNCB0aGUgbW92ZSBpdHNlbGYgcmVtb3ZlcyB0aGUgb2xkIHBhdGguXG4gICAgICBpZiAoaW5kZXhGcm9tICYmIGluZGV4RnJvbS5kZWxldGVkQXQgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICBwdXNoZXMucHVzaCh7XG4gICAgICAgICAga2luZDogJ2RlbGV0ZScsXG4gICAgICAgICAgcGF0aDogcmVuYW1lLmZyb20sXG4gICAgICAgICAgcGFyZW50VmVyc2lvbjogaW5kZXhGcm9tLnZlcnNpb25JZCxcbiAgICAgICAgICBoYXNoOiBpbmRleEZyb20uaGFzaCxcbiAgICAgICAgICBzaXplOiBpbmRleEZyb20uc2l6ZSxcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgfSBlbHNlIGlmICghcmVtb3RlRnJvbSB8fCByZW1vdGVGcm9tLmRlbGV0ZWQpIHtcbiAgICAgIC8vIFJlbW90ZSBkZWxldGVkIChvciBtaWdyYXRlZCBhd2F5IGZyb20pIGBmcm9tYCBcdTIwMTQgZGVsZXRpb24gc3RhbmRzIGZvclxuICAgICAgLy8gdGhlIG9sZCBwYXRoOyB0aGUgcmVuYW1lZCBjb250ZW50IHN1cnZpdmVzIGF0IGB0b2AuXG4gICAgICBwdWxscy5wdXNoKFxuICAgICAgICBwdWxsRmlsZSgnZGVsZXRlJywgcmVuYW1lLmZyb20sIHtcbiAgICAgICAgICBoYXNoOiByZW1vdGVGcm9tPy5oYXNoID8/IGluZGV4RnJvbT8uaGFzaCA/PyByZW5hbWUuaGFzaCxcbiAgICAgICAgICBzaXplOiByZW1vdGVGcm9tPy5zaXplID8/IGluZGV4RnJvbT8uc2l6ZSA/PyByZW5hbWUuc2l6ZSxcbiAgICAgICAgICB2ZXJzaW9uOiByZW1vdGVGcm9tPy52ZXJzaW9uID8/ICcnLFxuICAgICAgICAgIGNsb2NrOiByZW1vdGVGcm9tPy5jbG9jayA/PyBpbmRleEZyb20/LmNsb2NrID8/IFpFUk9fQ0xPQ0ssXG4gICAgICAgICAgZGVsZXRlZDogdHJ1ZSxcbiAgICAgICAgfSksXG4gICAgICApO1xuICAgIH0gZWxzZSB7XG4gICAgICAvLyBSZW1vdGUgZWRpdGVkIGBmcm9tYC4gVGhlIHJlbW90ZSBlZGl0IGtlZXBzIHRoZSBvbGQgcGF0aDsgdGhlIG1vdmVkXG4gICAgICAvLyBjb250ZW50IGlzIHBsYWNlZCBhdCBgdG9gIGJlbG93IFx1MjAxNCBhIHJlbmFtZS1yYWNlIHRoZSBsb2NhbCBzaWRlXG4gICAgICAvLyBjb25jZWRlcyB1bmxlc3MgaXRzIGNsb2NrIHdpbnMgdGhlIHJlbmFtZSBwdXNoLlxuICAgICAgY29uc3QgbG9jYWxDbG9jayA9IG5leHRDbG9jayhpbmRleEZyb20/LmNsb2NrLCB0aGlzRGV2aWNlSWQpO1xuICAgICAgaWYgKGNvbXBhcmVDbG9ja3MocmVtb3RlRnJvbS5jbG9jaywgbG9jYWxDbG9jaykgPiAwKSB7XG4gICAgICAgIHB1bGxzLnB1c2gocHVsbEZpbGUoJ2VkaXQnLCByZW5hbWUuZnJvbSwgcmVtb3RlRnJvbSkpO1xuICAgICAgICBjb25mbGljdHMucHVzaCh7XG4gICAgICAgICAgcGF0aDogcmVuYW1lLmZyb20sXG4gICAgICAgICAgcmVhc29uOiAncmVuYW1lLXJhY2UnLFxuICAgICAgICAgIHdpbm5lcjogJ3JlbW90ZScsXG4gICAgICAgICAgLy8gTG9jYWwgY29udGVudCBpcyBwcmVzZXJ2ZWQgYnkgdGhlIHJlbmFtZSBpdHNlbGYgKHB1c2hlZCBhdCBgdG9gKS5cbiAgICAgICAgICBsb3NlckNvbnRlbnQ6ICdsb2NhbCcsXG4gICAgICAgICAgcmVtb3RlOiByZW1vdGVTdW1tYXJ5KHJlbW90ZUZyb20pLFxuICAgICAgICAgIGxvY2FsQ2xvY2ssXG4gICAgICAgIH0pO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgcHVzaGVzLnB1c2goe1xuICAgICAgICAgIGtpbmQ6ICdyZW5hbWUnLFxuICAgICAgICAgIGZyb21QYXRoOiByZW5hbWUuZnJvbSxcbiAgICAgICAgICB0b1BhdGg6IHJlbmFtZS50byxcbiAgICAgICAgICBwYXJlbnRWZXJzaW9uOiBpbmRleEZyb20/LnZlcnNpb25JZCA/PyBudWxsLFxuICAgICAgICAgIGhhc2g6IHJlbmFtZS5oYXNoLFxuICAgICAgICAgIHNpemU6IHJlbmFtZS5zaXplLFxuICAgICAgICB9KTtcbiAgICAgICAgY29uZmxpY3RzLnB1c2goe1xuICAgICAgICAgIHBhdGg6IHJlbmFtZS5mcm9tLFxuICAgICAgICAgIHJlYXNvbjogJ3JlbmFtZS1yYWNlJyxcbiAgICAgICAgICB3aW5uZXI6ICdsb2NhbCcsXG4gICAgICAgICAgbG9zZXJDb250ZW50OiAncmVtb3RlJyxcbiAgICAgICAgICByZW1vdGU6IHJlbW90ZVN1bW1hcnkocmVtb3RlRnJvbSksXG4gICAgICAgICAgbG9jYWxDbG9jayxcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbnRpbnVlOyAvLyB0aGUgcmVuYW1lIHB1c2ggY2FycmllcyB0aGUgY29udGVudDsgbm8gYHRvYCBvcCBuZWVkZWRcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBgdG9gIHNpZGUgb2YgYSBjb250ZXN0ZWQgcmVuYW1lOlxuICAgIGlmICghdG9DaGFuZ2VkKSB7XG4gICAgICBwdXNoZXMucHVzaCh7XG4gICAgICAgIGtpbmQ6IGluZGV4VG8/LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkID8gJ3Jlc3RvcmUnIDogJ2FkZCcsXG4gICAgICAgIHBhdGg6IHJlbmFtZS50byxcbiAgICAgICAgcGFyZW50VmVyc2lvbjogaW5kZXhUbz8udmVyc2lvbklkID8/IG51bGwsXG4gICAgICAgIGhhc2g6IHJlbmFtZS5oYXNoLFxuICAgICAgICBzaXplOiByZW5hbWUuc2l6ZSxcbiAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICByZXNvbHZlQ29udGVzdGVkUGF0aChyZW5hbWUudG8sIGluZGV4VG8sIHJlbW90ZVRvIGFzIFJlbW90ZUZpbGUsIHtcbiAgICAgICAgcGF0aDogcmVuYW1lLnRvLFxuICAgICAgICBraW5kOiBpbmRleFRvPy5kZWxldGVkQXQgIT09IHVuZGVmaW5lZCA/ICdyZXN0b3JlJyA6ICdhZGQnLFxuICAgICAgICBoYXNoOiByZW5hbWUuaGFzaCxcbiAgICAgICAgc2l6ZTogcmVuYW1lLnNpemUsXG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICAvLyAtLS0gUGhhc2UgQjogcmVtb3RlIHJlbmFtZXMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgLy8gQSBwYXRoIGxpdmUgaW4gdGhlIGluZGV4IGJ1dCBBQlNFTlQgZnJvbSB0aGUgbWFuaWZlc3Qgd2FzIG1pZ3JhdGVkIGJ5IHRoZVxuICAvLyBhdXRob3JpdHkgKHRvbWJzdG9uZXMgYXBwZWFyIGluIHRoZSBtYW5pZmVzdCB3aXRoIGRlbGV0ZWQ6dHJ1ZSBcdTIwMTQgb25seSBhXG4gIC8vIHJlbmFtZSByZW1vdmVzIGEgcGF0aCkuIENvcnJlbGF0ZSBieSBjb250ZW50IGhhc2ggYWdhaW5zdCBuZXcgbWFuaWZlc3RcbiAgLy8gcGF0aHMsIHNhbWUtcGFyZW50IHByZWZlcnJlZCwgc21hbGxlc3QgcGF0aCB3aXRoaW4gYSBwcmVmZXJlbmNlIGNsYXNzLlxuICBmb3IgKGNvbnN0IGZyb20gb2YgT2JqZWN0LmtleXMoaW5kZXgpXG4gICAgLmZpbHRlcigocCkgPT4ge1xuICAgICAgY29uc3QgZW50cnkgPSBpbmRleFtwXSBhcyBMb2NhbEluZGV4RW50cnk7XG4gICAgICByZXR1cm4gZW50cnkuZGVsZXRlZEF0ID09PSB1bmRlZmluZWQgJiYgIWVudHJ5LmlzRm9sZGVyO1xuICAgIH0pXG4gICAgLnNvcnQoY29tcGFyZVN0cmluZ3MpKSB7XG4gICAgaWYgKGxvY2FsUGF0aHMuaGFzKGZyb20pIHx8IGNvbnN1bWVkLmhhcyhmcm9tKSkgY29udGludWU7XG4gICAgaWYgKG1hbmlmZXN0QnlQYXRoLmhhcyhmcm9tKSkgY29udGludWU7IC8vIHByZXNlbnQgKGxpdmUgb3IgdG9tYnN0b25lZCkgXHUyMUQyIG5vdCBtaWdyYXRlZFxuICAgIGNvbnN0IGVudHJ5ID0gaW5kZXhbZnJvbV0gYXMgTG9jYWxJbmRleEVudHJ5O1xuXG4gICAgbGV0IGJlc3Q6IFJlbW90ZUZpbGUgfCB1bmRlZmluZWQ7XG4gICAgbGV0IGJlc3RTYW1lRGlyID0gZmFsc2U7XG4gICAgZm9yIChjb25zdCBjYW5kaWRhdGUgb2YgbWFuaWZlc3QpIHtcbiAgICAgIGlmIChjYW5kaWRhdGUuZGVsZXRlZCkgY29udGludWU7XG4gICAgICBpZiAobG9jYWxQYXRocy5oYXMoY2FuZGlkYXRlLnBhdGgpIHx8IGNvbnN1bWVkLmhhcyhjYW5kaWRhdGUucGF0aCkpIGNvbnRpbnVlO1xuICAgICAgY29uc3Qga25vd24gPSBpbmRleFtjYW5kaWRhdGUucGF0aF07XG4gICAgICBpZiAoa25vd24gIT09IHVuZGVmaW5lZCAmJiBrbm93bi5kZWxldGVkQXQgPT09IHVuZGVmaW5lZCkgY29udGludWU7IC8vIHRhcmdldCBub3QgbmV3XG4gICAgICBpZiAoY2FuZGlkYXRlLmhhc2ggIT09IGVudHJ5Lmhhc2gpIGNvbnRpbnVlO1xuICAgICAgY29uc3Qgc2FtZURpciA9IHBhcmVudFBhdGgoY2FuZGlkYXRlLnBhdGgpID09PSBwYXJlbnRQYXRoKGZyb20pO1xuICAgICAgaWYgKGJlc3QgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICBiZXN0ID0gY2FuZGlkYXRlO1xuICAgICAgICBiZXN0U2FtZURpciA9IHNhbWVEaXI7XG4gICAgICB9IGVsc2UgaWYgKHNhbWVEaXIgJiYgIWJlc3RTYW1lRGlyKSB7XG4gICAgICAgIGJlc3QgPSBjYW5kaWRhdGU7XG4gICAgICAgIGJlc3RTYW1lRGlyID0gdHJ1ZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoYmVzdCkge1xuICAgICAgcHVsbHMucHVzaCh7XG4gICAgICAgIGtpbmQ6ICdyZW5hbWUnLFxuICAgICAgICBmcm9tUGF0aDogZnJvbSxcbiAgICAgICAgdG9QYXRoOiBiZXN0LnBhdGgsXG4gICAgICAgIGhhc2g6IGJlc3QuaGFzaCxcbiAgICAgICAgc2l6ZTogYmVzdC5zaXplLFxuICAgICAgICB2ZXJzaW9uOiBiZXN0LnZlcnNpb24sXG4gICAgICAgIGNsb2NrOiBiZXN0LmNsb2NrLFxuICAgICAgfSk7XG4gICAgICBjb25zdW1lZC5hZGQoZnJvbSk7XG4gICAgICBjb25zdW1lZC5hZGQoYmVzdC5wYXRoKTtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gQWJzZW50IHdpdGhvdXQgY29ycmVsYXRpb246IHRoZSBhdXRob3JpdHkgbm8gbG9uZ2VyIGtub3dzIHRoZSBwYXRoLlxuICAgICAgLy8gVHJlYXQgYXMgYSByZW1vdGUgZGVsZXRlIHdpdGggdW5rbm93biBoZWFkIHZlcnNpb24gKCcnIFx1MjAxNCB0aGUgbmV4dFxuICAgICAgLy8gZnVsbCBtYW5pZmVzdCBoZWFscyB0aGUgdmVyc2lvbiBpZCkuIFRoaXMgYWxzbyBjb3ZlcnMgcmVtb3RlXG4gICAgICAvLyByZW5hbWUrZWRpdCwgd2hpY2ggZ2VudWluZWx5IGlzIGRlbGV0ZSArIGFkZC5cbiAgICAgIHB1bGxzLnB1c2goXG4gICAgICAgIHB1bGxGaWxlKCdkZWxldGUnLCBmcm9tLCB7XG4gICAgICAgICAgaGFzaDogZW50cnkuaGFzaCxcbiAgICAgICAgICBzaXplOiBlbnRyeS5zaXplLFxuICAgICAgICAgIHZlcnNpb246ICcnLFxuICAgICAgICAgIGNsb2NrOiBlbnRyeS5jbG9jayxcbiAgICAgICAgICBkZWxldGVkOiB0cnVlLFxuICAgICAgICB9KSxcbiAgICAgICk7XG4gICAgICBjb25zdW1lZC5hZGQoZnJvbSk7XG4gICAgfVxuICB9XG5cbiAgLy8gLS0tIFBoYXNlIEM6IHJlbWFpbmluZyByZW1vdGUtb25seSBjaGFuZ2VzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gIGZvciAoY29uc3QgcmVtb3RlIG9mIG1hbmlmZXN0KSB7XG4gICAgaWYgKGxvY2FsUGF0aHMuaGFzKHJlbW90ZS5wYXRoKSB8fCBjb25zdW1lZC5oYXMocmVtb3RlLnBhdGgpKSBjb250aW51ZTtcbiAgICBjb25zdCBlbnRyeSA9IGluZGV4W3JlbW90ZS5wYXRoXTtcbiAgICBpZiAoIXJlbW90ZUVudHJ5Q2hhbmdlZChlbnRyeSwgcmVtb3RlKSkgY29udGludWU7XG4gICAgaWYgKGVudHJ5ID09PSB1bmRlZmluZWQpIHtcbiAgICAgIGlmICghcmVtb3RlLmRlbGV0ZWQpIHtcbiAgICAgICAgcHVsbHMucHVzaChwdWxsRmlsZSgnYWRkJywgcmVtb3RlLnBhdGgsIHJlbW90ZSkpO1xuICAgICAgICBjb25zdW1lZC5hZGQocmVtb3RlLnBhdGgpO1xuICAgICAgfVxuICAgICAgLy8gZGVsZXRlZCArIG5ldmVyIGtub3duIGxvY2FsbHkgXHUyMUQyIG5vdGhpbmcgdG8gZG9cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBpZiAocmVtb3RlLmRlbGV0ZWQpIHtcbiAgICAgIHB1bGxzLnB1c2gocHVsbEZpbGUoJ2RlbGV0ZScsIHJlbW90ZS5wYXRoLCByZW1vdGUpKTsgLy8gaW5jbHVkZXMgdG9tYnN0b25lXHUyMTkydG9tYnN0b25lIHZlcnNpb24gY2F0Y2gtdXBcbiAgICB9IGVsc2UgaWYgKGVudHJ5LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBwdWxscy5wdXNoKHB1bGxGaWxlKCdyZXN0b3JlJywgcmVtb3RlLnBhdGgsIHJlbW90ZSkpO1xuICAgIH0gZWxzZSB7XG4gICAgICBwdWxscy5wdXNoKHB1bGxGaWxlKCdlZGl0JywgcmVtb3RlLnBhdGgsIHJlbW90ZSkpO1xuICAgIH1cbiAgICBjb25zdW1lZC5hZGQocmVtb3RlLnBhdGgpO1xuICB9XG5cbiAgLy8gLS0tIFBoYXNlIEQ6IGxvY2FsIGNhbmRpZGF0ZXMgKGxvY2FsLW9ubHkgcHVzaGVzICsgYm90aC1jaGFuZ2VkKSAtLS0tLS0tXG4gIGNvbnN0IGNhbmRpZGF0ZXM6IExvY2FsQ2FuZGlkYXRlW10gPSBbXG4gICAgLi4ubG9jYWxDaGFuZ2VzLmFkZGVkLm1hcCgoYykgPT4gKHsgLi4uYywga2luZDogJ2FkZCcgYXMgY29uc3QgfSkpLFxuICAgIC4uLmxvY2FsQ2hhbmdlcy5tb2RpZmllZC5tYXAoKGMpID0+ICh7XG4gICAgICAuLi5jLFxuICAgICAga2luZDogaW5kZXhbYy5wYXRoXT8uZGVsZXRlZEF0ICE9PSB1bmRlZmluZWQgPyAoJ3Jlc3RvcmUnIGFzIGNvbnN0KSA6ICgnZWRpdCcgYXMgY29uc3QpLFxuICAgIH0pKSxcbiAgICAuLi5sb2NhbENoYW5nZXMuZGVsZXRlZC5tYXAoKGQpOiBMb2NhbENhbmRpZGF0ZSA9PiAoeyAuLi5kLCBraW5kOiAnZGVsZXRlJyB9KSksXG4gIF0uc29ydCgoYSwgYikgPT4gY29tcGFyZVN0cmluZ3MoYS5wYXRoLCBiLnBhdGgpKTtcblxuICBmb3IgKGNvbnN0IGNhbmRpZGF0ZSBvZiBjYW5kaWRhdGVzKSB7XG4gICAgY29uc3QgZW50cnkgPSBpbmRleFtjYW5kaWRhdGUucGF0aF07XG4gICAgY29uc3QgcmVtb3RlID0gbWFuaWZlc3RCeVBhdGguZ2V0KGNhbmRpZGF0ZS5wYXRoKTtcbiAgICBjb25zdCByZW1vdGVDaGFuZ2VkSGVyZSA9XG4gICAgICByZW1vdGUgIT09IHVuZGVmaW5lZCAmJiAoZW50cnkgIT09IHVuZGVmaW5lZCA/IHJlbW90ZS52ZXJzaW9uICE9PSBlbnRyeS52ZXJzaW9uSWQgOiAhcmVtb3RlLmRlbGV0ZWQpO1xuICAgIGlmICghcmVtb3RlQ2hhbmdlZEhlcmUpIHtcbiAgICAgIHB1c2hMb2NhbChjYW5kaWRhdGUsIGVudHJ5KTtcbiAgICB9IGVsc2Uge1xuICAgICAgcmVzb2x2ZUNvbnRlc3RlZFBhdGgoY2FuZGlkYXRlLnBhdGgsIGVudHJ5LCByZW1vdGUgYXMgUmVtb3RlRmlsZSwgY2FuZGlkYXRlKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4ge1xuICAgIHB1c2hlczogcHVzaGVzLnNvcnQoKGEsIGIpID0+IGNvbXBhcmVTdHJpbmdzKG9wUGF0aChhKSwgb3BQYXRoKGIpKSksXG4gICAgcHVsbHM6IHB1bGxzLnNvcnQoKGEsIGIpID0+IGNvbXBhcmVTdHJpbmdzKG9wUGF0aChhKSwgb3BQYXRoKGIpKSksXG4gICAgY29uZmxpY3RzOiBjb25mbGljdHMuc29ydCgoYSwgYikgPT4gY29tcGFyZVN0cmluZ3MoYS5wYXRoLCBiLnBhdGgpKSxcbiAgICBmb2xkZXJQdXNoZXM6IFsuLi5sb2NhbENoYW5nZXMuZW1wdHlGb2xkZXJzXS5zb3J0KGNvbXBhcmVTdHJpbmdzKSxcbiAgfTtcblxuICAvLyAtLS0gaGVscGVycyAoY2xvc2Ugb3ZlciB0aGUgYWNjdW11bGF0b3JzKSAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICBmdW5jdGlvbiBwdXNoTG9jYWwoY2FuZGlkYXRlOiBMb2NhbENhbmRpZGF0ZSwgZW50cnk6IExvY2FsSW5kZXhFbnRyeSB8IHVuZGVmaW5lZCk6IHZvaWQge1xuICAgIGlmIChjYW5kaWRhdGUua2luZCA9PT0gJ2RlbGV0ZScpIHtcbiAgICAgIHB1c2hlcy5wdXNoKHtcbiAgICAgICAga2luZDogJ2RlbGV0ZScsXG4gICAgICAgIHBhdGg6IGNhbmRpZGF0ZS5wYXRoLFxuICAgICAgICBwYXJlbnRWZXJzaW9uOiBlbnRyeT8udmVyc2lvbklkID8/IG51bGwsXG4gICAgICAgIGhhc2g6IGVudHJ5Py5oYXNoID8/IGNhbmRpZGF0ZS5oYXNoLFxuICAgICAgICBzaXplOiBlbnRyeT8uc2l6ZSA/PyBjYW5kaWRhdGUuc2l6ZSxcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBwdXNoZXMucHVzaCh7XG4gICAgICBraW5kOiBjYW5kaWRhdGUua2luZCxcbiAgICAgIHBhdGg6IGNhbmRpZGF0ZS5wYXRoLFxuICAgICAgcGFyZW50VmVyc2lvbjogZW50cnk/LnZlcnNpb25JZCA/PyBudWxsLFxuICAgICAgaGFzaDogY2FuZGlkYXRlLmhhc2gsXG4gICAgICBzaXplOiBjYW5kaWRhdGUuc2l6ZSxcbiAgICB9KTtcbiAgfVxuXG4gIC8qKlxuICAgKiBCb3RoIHNpZGVzIGNoYW5nZWQgb25lIHBhdGguIEFyYml0cmF0ZSBwZXIgXHUwMEE3NC4gTG9jYWwgZGVsZXRpb25zIG5ldmVyIGdldFxuICAgKiBhIGNvbmZsaWN0IGNvcHkgKG5vIGNvbnRlbnQgdG8gcHJlc2VydmUpOyBsb2NhbCAqY29udGVudCogdGhhdCBsb3NlcyBpc1xuICAgKiBwcmVzZXJ2ZWQgdmlhIGEgY29uZmxpY3QtY29weSBwdXNoLlxuICAgKi9cbiAgZnVuY3Rpb24gcmVzb2x2ZUNvbnRlc3RlZFBhdGgoXG4gICAgcGF0aDogc3RyaW5nLFxuICAgIGVudHJ5OiBMb2NhbEluZGV4RW50cnkgfCB1bmRlZmluZWQsXG4gICAgcmVtb3RlOiBSZW1vdGVGaWxlLFxuICAgIGxvY2FsOiBMb2NhbENhbmRpZGF0ZSxcbiAgKTogdm9pZCB7XG4gICAgY29uc3QgbG9jYWxDbG9jayA9IG5leHRDbG9jayhlbnRyeT8uY2xvY2ssIHRoaXNEZXZpY2VJZCk7XG4gICAgY29uc3QgcmVtb3RlV2lucyA9IGNvbXBhcmVDbG9ja3MocmVtb3RlLmNsb2NrLCBsb2NhbENsb2NrKSA+IDA7IC8vIDAgXHUyMUQyIGxvY2FsIChkb2N1bWVudGVkKVxuICAgIGNvbnN0IHN1bW1hcnkgPSByZW1vdGVTdW1tYXJ5KHJlbW90ZSk7XG4gICAgY29uc3QgcmVhc29uOiBDb25mbGljdFJlYXNvbiA9XG4gICAgICBsb2NhbC5raW5kID09PSAnZGVsZXRlJyB8fCByZW1vdGUuZGVsZXRlZFxuICAgICAgICA/ICdkZWxldGUtdnMtZWRpdCdcbiAgICAgICAgOiBlbnRyeSA9PT0gdW5kZWZpbmVkXG4gICAgICAgICAgPyAnYWRkLXZzLWFkZCdcbiAgICAgICAgICA6ICdjb25jdXJyZW50LWVkaXQnO1xuXG4gICAgaWYgKGxvY2FsLmtpbmQgPT09ICdkZWxldGUnICYmIHJlbW90ZS5kZWxldGVkKSB7XG4gICAgICAvLyBCb3RoIGRlbGV0ZWQgXHUyMDE0IGNvbnZlcmdlIHNpbGVudGx5IG9uIHRoZSByZW1vdGUgdG9tYnN0b25lLlxuICAgICAgcHVsbHMucHVzaChwdWxsRmlsZSgnZGVsZXRlJywgcGF0aCwgcmVtb3RlKSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKGxvY2FsLmtpbmQgPT09ICdkZWxldGUnKSB7XG4gICAgICAvLyBMb2NhbCBkZWxldGUgdnMgcmVtb3RlIGVkaXQuXG4gICAgICBpZiAocmVtb3RlV2lucykge1xuICAgICAgICBwdWxscy5wdXNoKHB1bGxGaWxlKCdlZGl0JywgcGF0aCwgcmVtb3RlKSk7IC8vIGZpbGUgaXMgcmVjcmVhdGVkXG4gICAgICAgIGNvbmZsaWN0cy5wdXNoKHtcbiAgICAgICAgICBwYXRoLCByZWFzb24sIHdpbm5lcjogJ3JlbW90ZScsIGxvc2VyQ29udGVudDogJ25vbmUnLFxuICAgICAgICAgIHJlbW90ZTogc3VtbWFyeSwgbG9jYWxDbG9jayxcbiAgICAgICAgfSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBwdXNoZXMucHVzaCh7XG4gICAgICAgICAga2luZDogJ2RlbGV0ZScsXG4gICAgICAgICAgcGF0aCxcbiAgICAgICAgICBwYXJlbnRWZXJzaW9uOiBlbnRyeT8udmVyc2lvbklkID8/IG51bGwsXG4gICAgICAgICAgaGFzaDogZW50cnk/Lmhhc2ggPz8gbG9jYWwuaGFzaCxcbiAgICAgICAgICBzaXplOiBlbnRyeT8uc2l6ZSA/PyBsb2NhbC5zaXplLFxuICAgICAgICB9KTtcbiAgICAgICAgY29uZmxpY3RzLnB1c2goe1xuICAgICAgICAgIHBhdGgsIHJlYXNvbiwgd2lubmVyOiAnbG9jYWwnLCBsb3NlckNvbnRlbnQ6ICdyZW1vdGUnLFxuICAgICAgICAgIHJlbW90ZTogc3VtbWFyeSwgbG9jYWxDbG9jayxcbiAgICAgICAgfSk7XG4gICAgICB9XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKHJlbW90ZS5kZWxldGVkKSB7XG4gICAgICAvLyBMb2NhbCBlZGl0IHZzIHJlbW90ZSBkZWxldGUuXG4gICAgICBpZiAocmVtb3RlV2lucykge1xuICAgICAgICBwdWxscy5wdXNoKHB1bGxGaWxlKCdkZWxldGUnLCBwYXRoLCByZW1vdGUpKTtcbiAgICAgICAgY29uZmxpY3RzLnB1c2goe1xuICAgICAgICAgIHBhdGgsIHJlYXNvbiwgd2lubmVyOiAncmVtb3RlJywgbG9zZXJDb250ZW50OiAnbG9jYWwnLFxuICAgICAgICAgIGNvbmZsaWN0Q29weVBhdGg6IHB1c2hDb25mbGljdENvcHkocGF0aCwgbG9jYWwsIHJlbW90ZSksXG4gICAgICAgICAgcmVtb3RlOiBzdW1tYXJ5LCBsb2NhbENsb2NrLFxuICAgICAgICB9KTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHB1c2hlcy5wdXNoKHtcbiAgICAgICAgICBraW5kOiBsb2NhbC5raW5kLFxuICAgICAgICAgIHBhdGgsXG4gICAgICAgICAgcGFyZW50VmVyc2lvbjogZW50cnk/LnZlcnNpb25JZCA/PyBudWxsLFxuICAgICAgICAgIGhhc2g6IGxvY2FsLmhhc2gsXG4gICAgICAgICAgc2l6ZTogbG9jYWwuc2l6ZSxcbiAgICAgICAgfSk7XG4gICAgICAgIGNvbmZsaWN0cy5wdXNoKHtcbiAgICAgICAgICBwYXRoLCByZWFzb24sIHdpbm5lcjogJ2xvY2FsJywgbG9zZXJDb250ZW50OiAnbm9uZScsXG4gICAgICAgICAgcmVtb3RlOiBzdW1tYXJ5LCBsb2NhbENsb2NrLFxuICAgICAgICB9KTtcbiAgICAgIH1cbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBDb25jdXJyZW50IGNvbnRlbnQgKGVkaXQtdnMtZWRpdCBvciBhZGQtdnMtYWRkKS5cbiAgICBpZiAocmVtb3RlV2lucykge1xuICAgICAgcHVsbHMucHVzaChcbiAgICAgICAgcHVsbEZpbGUoZW50cnk/LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkID8gJ3Jlc3RvcmUnIDogZW50cnkgPT09IHVuZGVmaW5lZCA/ICdhZGQnIDogJ2VkaXQnLCBwYXRoLCByZW1vdGUpLFxuICAgICAgKTtcbiAgICAgIGNvbmZsaWN0cy5wdXNoKHtcbiAgICAgICAgcGF0aCwgcmVhc29uLCB3aW5uZXI6ICdyZW1vdGUnLCBsb3NlckNvbnRlbnQ6ICdsb2NhbCcsXG4gICAgICAgIGNvbmZsaWN0Q29weVBhdGg6IHB1c2hDb25mbGljdENvcHkocGF0aCwgbG9jYWwsIHJlbW90ZSksXG4gICAgICAgIHJlbW90ZTogc3VtbWFyeSwgbG9jYWxDbG9jayxcbiAgICAgIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICBwdXNoZXMucHVzaCh7XG4gICAgICAgIGtpbmQ6IGxvY2FsLmtpbmQsXG4gICAgICAgIHBhdGgsXG4gICAgICAgIC8vIERlbGliZXJhdGVseSB0aGUgKHN0YWxlKSBpbmRleCBwYXJlbnQ6IHRoZSBETyBtdXN0IGFyYml0cmF0ZSBhbmRcbiAgICAgICAgLy8gc3ludGhlc2l6ZSB0aGUgY29uZmxpY3QgY29weSBmb3IgdGhlIGxvc2luZyByZW1vdGUgY29udGVudC5cbiAgICAgICAgcGFyZW50VmVyc2lvbjogZW50cnk/LnZlcnNpb25JZCA/PyBudWxsLFxuICAgICAgICBoYXNoOiBsb2NhbC5oYXNoLFxuICAgICAgICBzaXplOiBsb2NhbC5zaXplLFxuICAgICAgfSk7XG4gICAgICBjb25mbGljdHMucHVzaCh7XG4gICAgICAgIHBhdGgsIHJlYXNvbiwgd2lubmVyOiAnbG9jYWwnLCBsb3NlckNvbnRlbnQ6ICdyZW1vdGUnLFxuICAgICAgICByZW1vdGU6IHN1bW1hcnksIGxvY2FsQ2xvY2ssXG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUHVzaCB0aGUgbG9zaW5nIGxvY2FsIGNvbnRlbnQgdG8gYSBjb25mbGljdC1jb3B5IHBhdGg7IHJldHVybnMgdGhlIHBhdGgsXG4gICAqIG9yIGB1bmRlZmluZWRgIHdoZW4gdGhlIGxvc2luZyBjb250ZW50IGlzIGJ5dGUtaWRlbnRpY2FsIHRvIHRoZSB3aW5uZXInc1xuICAgKiAoYSBzYW1lLWNvbnRlbnQgcmFjZSBcdTIwMTQgbm90aGluZyBkaXN0aW5jdCB0byBwcmVzZXJ2ZTsgbWF0Y2hlcyB0aGUgc2VydmVyJ3NcbiAgICogYXJiaXRyYXRpb24sIHdoaWNoIGxpa2V3aXNlIHN5bnRoZXNpemVzIG5vIGNvcHkgZm9yIGlkZW50aWNhbCBjb250ZW50KS5cbiAgICovXG4gIGZ1bmN0aW9uIHB1c2hDb25mbGljdENvcHkocGF0aDogc3RyaW5nLCBsb2NhbDogTG9jYWxDYW5kaWRhdGUsIHJlbW90ZTogUmVtb3RlRmlsZSk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgaWYgKGxvY2FsLmhhc2ggPT09IHJlbW90ZS5oYXNoKSByZXR1cm4gdW5kZWZpbmVkO1xuICAgIGNvbnN0IGNvcHlQYXRoID0gY29uZmxpY3RDb3B5UGF0aChwYXRoLCB0aGlzRGV2aWNlTmFtZSwgbm93LCBwYXRoRXhpc3RzKTtcbiAgICBwdXNoZXMucHVzaCh7XG4gICAgICBraW5kOiAnY29uZmxpY3RDb3B5JyxcbiAgICAgIHBhdGg6IGNvcHlQYXRoLFxuICAgICAgLy8gQnVpbGQgb24gdGhlIHdpbm5pbmcgcmVtb3RlIGhlYWQ6IHRoaXMgcHVzaCBtdXN0IGZhc3QtcGF0aC5cbiAgICAgIHBhcmVudFZlcnNpb246IHJlbW90ZS52ZXJzaW9uLFxuICAgICAgaGFzaDogbG9jYWwuaGFzaCxcbiAgICAgIHNpemU6IGxvY2FsLnNpemUsXG4gICAgfSk7XG4gICAgcmV0dXJuIGNvcHlQYXRoO1xuICB9XG59XG5cbi8vIC0tLSBtb2R1bGUtbGV2ZWwgaGVscGVycyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZnVuY3Rpb24gcHVsbEZpbGUoXG4gIGtpbmQ6IFB1bGxGaWxlT3BbJ2tpbmQnXSxcbiAgcGF0aDogc3RyaW5nLFxuICByZW1vdGU6IFBpY2s8UmVtb3RlRmlsZSwgJ2hhc2gnIHwgJ3NpemUnIHwgJ3ZlcnNpb24nIHwgJ2Nsb2NrJyB8ICdpc0ZvbGRlcic+ICYge1xuICAgIGRlbGV0ZWQ/OiBib29sZWFuO1xuICB9LFxuKTogUHVsbEZpbGVPcCB7XG4gIHJldHVybiB7XG4gICAga2luZCxcbiAgICBwYXRoLFxuICAgIGhhc2g6IHJlbW90ZS5oYXNoLFxuICAgIHNpemU6IHJlbW90ZS5zaXplLFxuICAgIHZlcnNpb246IHJlbW90ZS52ZXJzaW9uLFxuICAgIGNsb2NrOiByZW1vdGUuY2xvY2ssXG4gICAgZGVsZXRlZDogcmVtb3RlLmRlbGV0ZWQgPz8ga2luZCA9PT0gJ2RlbGV0ZScsXG4gICAgLi4uKHJlbW90ZS5pc0ZvbGRlciA/IHsgaXNGb2xkZXI6IHRydWUgfSA6IHt9KSxcbiAgfTtcbn1cblxuZnVuY3Rpb24gcmVtb3RlU3VtbWFyeShyZW1vdGU6IFJlbW90ZUZpbGUpOiBDb25mbGljdE9wWydyZW1vdGUnXSB7XG4gIHJldHVybiB7XG4gICAgdmVyc2lvbjogcmVtb3RlLnZlcnNpb24sXG4gICAgaGFzaDogcmVtb3RlLmhhc2gsXG4gICAgc2l6ZTogcmVtb3RlLnNpemUsXG4gICAgZGVsZXRlZDogcmVtb3RlLmRlbGV0ZWQsXG4gICAgY2xvY2s6IHJlbW90ZS5jbG9jayxcbiAgfTtcbn1cblxuLyoqXG4gKiBXaGV0aGVyIHRoZSByZW1vdGUgaGVhZCBmb3IgYSBwYXRoIGRpZmZlcnMgZnJvbSB3aGF0IHRoZSBpbmRleCByZWNvcmRzLlxuICogVmVyc2lvbiBpZHMgYXJlIHRoZSBwcmltYXJ5IHNpZ25hbCAoY2xpZW50IGFuZCBETyBzaGFyZSBvbmUgaWQgc3BhY2UpO1xuICogYSBwYXRoIGFic2VudCByZW1vdGVseSBjb3VudHMgYXMgY2hhbmdlZCBvbmx5IHdoaWxlIHRoZSBpbmRleCBzdGlsbCBob2xkc1xuICogaXQgbGl2ZSBcdTIwMTQgY2FsbGVycyBkZWNpZGUgd2hhdCBhYnNlbmNlICptZWFucyogKHJlbmFtZSB2cyBkZWxldGUpLlxuICovXG5mdW5jdGlvbiByZW1vdGVFbnRyeUNoYW5nZWQoXG4gIGVudHJ5OiBMb2NhbEluZGV4RW50cnkgfCB1bmRlZmluZWQsXG4gIHJlbW90ZTogUmVtb3RlRmlsZSB8IHVuZGVmaW5lZCxcbik6IGJvb2xlYW4ge1xuICBpZiAocmVtb3RlID09PSB1bmRlZmluZWQpIHJldHVybiBmYWxzZTtcbiAgaWYgKGVudHJ5ID09PSB1bmRlZmluZWQpIHJldHVybiAhcmVtb3RlLmRlbGV0ZWQ7XG4gIHJldHVybiByZW1vdGUudmVyc2lvbiAhPT0gZW50cnkudmVyc2lvbklkO1xufVxuXG5mdW5jdGlvbiBvcFBhdGgob3A6IFB1c2hPcCB8IFB1bGxPcCk6IHN0cmluZyB7XG4gIHJldHVybiBvcC5raW5kID09PSAncmVuYW1lJyA/IG9wLnRvUGF0aCA6IG9wLnBhdGg7XG59XG5cbmZ1bmN0aW9uIGNvbXBhcmVTdHJpbmdzKGE6IHN0cmluZywgYjogc3RyaW5nKTogbnVtYmVyIHtcbiAgcmV0dXJuIGEgPCBiID8gLTEgOiBhID4gYiA/IDEgOiAwO1xufVxuIiwgIi8qKlxuICogTG9jYWwgY2hhbmdlIGRldGVjdGlvbiAoQVJDSElURUNUVVJFLm1kIFx1MDBBNzggc3RlcCAzKS5cbiAqXG4gKiBgc2NhblZhdWx0YCB3YWxrcyB0aGUgc3RvcmFnZSBhZGFwdGVyLCBhcHBsaWVzIHRoZSBzaGFyZWQgaWdub3JlIHJ1bGVzLFxuICogaGFzaGVzIG5vbi1pZ25vcmVkIGZpbGVzIChzaGEyNTYgXHUyMDE0IHNhbWUgYXMgYmxvYiBhZGRyZXNzaW5nKSBhbmQgZGlmZnNcbiAqIHRoZSByZXN1bHQgYWdhaW5zdCB0aGUgY2xpZW50J3MgYExvY2FsSW5kZXhgLiBUaGUgZGlmZiBjbGFzc2lmaWVzOlxuICpcbiAqICAgLSBgYWRkZWRgICAgIFx1MjAxNCBmaWxlIHByZXNlbnQsIHBhdGggdW5rbm93biB0byB0aGUgaW5kZXg7XG4gKiAgIC0gYG1vZGlmaWVkYCBcdTIwMTQgZmlsZSBwcmVzZW50LCBjb250ZW50IGhhc2ggZGlmZmVycyBmcm9tIHRoZSBpbmRleCBlbnRyeS5cbiAqICAgICAgICAgICAgICAgICAgQSBmaWxlIHdob3NlIGluZGV4IGVudHJ5IGlzIGEgKnRvbWJzdG9uZSogYWxzbyBsYW5kcyBoZXJlXG4gKiAgICAgICAgICAgICAgICAgIChkb2N1bWVudGVkIGRlY2lzaW9uKTogd2hldGhlciBpdCBpcyBhbiBlZGl0LW9mLWRlbGV0ZWRcbiAqICAgICAgICAgICAgICAgICAgb3IgYSBwdXJlIHJlc3VycmVjdCwgdGhlIHJlc29sdXRpb24gaXMgaWRlbnRpY2FsIFx1MjAxNCBsb2NhbFxuICogICAgICAgICAgICAgICAgICBjb250ZW50IGV4aXN0cyB0aGF0IHRoZSBpbmRleCBoZWFkIGRvZXMgbm90IHJlZmxlY3Q7XG4gKiAgIC0gYGRlbGV0ZWRgICBcdTIwMTQgaW5kZXggZW50cnkgbGl2ZSwgZmlsZSBnb25lO1xuICogICAtIGByZW5hbWVkYCAgXHUyMDE0IGEgZGVsZXRlICsgYWRkIHBhaXIgKndpdGhpbiBvbmUgc2Nhbiogd2hvc2UgY29udGVudFxuICogICAgICAgICAgICAgICAgICBoYXNoZXMgbWF0Y2ggKEFSQ0hJVEVDVFVSRSBcdTAwQTc0IHJlbmFtZSBjb3JyZWxhdGlvbikuIEFcbiAqICAgICAgICAgICAgICAgICAgcmVuYW1lIHdob3NlIGNvbnRlbnQgYWxzbyBjaGFuZ2VkIChyZW5hbWUgKyBlZGl0KSBub1xuICogICAgICAgICAgICAgICAgICBsb25nZXIgY29ycmVsYXRlcyBhbmQgZmFsbHMgYmFjayB0byBkZWxldGUgKyBhZGQgXHUyMDE0IHRoYXRcbiAqICAgICAgICAgICAgICAgICAgaXMgdGhlIGRvY3VtZW50ZWQsIGNvcnJlY3QgdjEgYmVoYXZpb3I7XG4gKiAgIC0gYGVtcHR5Rm9sZGVyc2AgXHUyMDE0IGRpcmVjdG9yaWVzIGV4aXN0aW5nIGluIHN0b3JhZ2UgYnV0IHJlcHJlc2VudGVkXG4gKiAgICAgICAgICAgICAgICAgIG5laXRoZXIgYnkgYSBsaXZlIGZvbGRlciBwbGFjZWhvbGRlciBpbiB0aGUgaW5kZXggbm9yIGJ5XG4gKiAgICAgICAgICAgICAgICAgIGFueSBmaWxlIGJlbmVhdGggdGhlbSAoRlItMTApLlxuICpcbiAqICMjIFRoZSBtdGltZStzaXplIHByZS1maWx0ZXIgKGZhc3QgbW9kZSwgdGhlIGRlZmF1bHQpXG4gKlxuICogUmUtaGFzaGluZyBhIDUway1maWxlIHZhdWx0IGF0IGV2ZXJ5IGFwcC1vcGVuIGlzIGEgcmVhbCBiYXR0ZXJ5IGNvc3QsIHNvXG4gKiBmYXN0IG1vZGUgc2tpcHMgaGFzaGluZyBhIGZpbGUgd2hvc2UgYHNpemVgIEFORCBgbXRpbWVgIChmcm9tIHRoZSBzdG9yYWdlXG4gKiBhZGFwdGVyJ3MgYEZpbGVTdGF0YCkgZXhhY3RseSBtYXRjaCBpdHMgbGl2ZSBpbmRleCBlbnRyeSBcdTIwMTQgdGhlIHJlY29yZGVkXG4gKiBoYXNoIGNhcnJpZXMgZm9yd2FyZCBhcyB1bmNoYW5nZWQuIEEgZmlsZSBpcyBoYXNoZWQgd2hlbiBpdCBoYXMgbm8gZW50cnksXG4gKiB0aGUgZW50cnkgaXMgYSB0b21ic3RvbmUgb3IgZm9sZGVyIHBsYWNlaG9sZGVyLCB0aGUgc2l6ZSBkaWZmZXJzLCBvciB0aGVcbiAqIG10aW1lIGRpZmZlcnMgb3IgaXMgdW5rbm93biAobGVnYWN5IHN0YXRlLCBwdWxscywgZmlyc3Qgc2NhbikuIFJlbmFtZVxuICogY29ycmVsYXRpb24gaXMgdW5hZmZlY3RlZDogdGhlIGRlc3RpbmF0aW9uIHBhdGggb2YgYSByZW5hbWUgYWx3YXlzIGxvb2tzXG4gKiAnYWRkZWQnLCBzbyBpdCBpcyBhbHdheXMgaGFzaGVkIFx1MjAxNCBjb250ZW50LXByZXNlcnZpbmcgbW92ZXMgc3RpbGwgcGFpci5cbiAqXG4gKiBUaGUgdHJhZGVvZmY6IGZhc3QgbW9kZSB0cnVzdHMgdGhlIGZpbGVzeXN0ZW0gbm90IHRvIGNoYW5nZSBjb250ZW50IHdoaWxlXG4gKiBwcmVzZXJ2aW5nIGJvdGggc2l6ZSBhbmQgbXRpbWUuIEZvciB2ZXJpZmljYXRpb24gKGB2c2EgZG9jdG9yYCwgcGVyaW9kaWNcbiAqIGludGVncml0eSBjaGVja3MpIHBhc3MgYHsgbW9kZTogJ2Z1bGwnIH1gIHRvIHJlLWhhc2ggZXZlcnl0aGluZy5cbiAqXG4gKiBUaGUgZnVuY3Rpb24gdGFrZXMgYG5vd2AgYW5kIHRoZSBpZ25vcmUgc2V0dGluZ3MgYXMgcGFyYW1ldGVycyAobm8gaGlkZGVuXG4gKiBjbG9ja3MsIG5vIGFtYmllbnQgY29uZmlnKSBhbmQgcmV0dXJucyBkZXRlcm1pbmlzdGljYWxseSBvcmRlcmVkIHJlc3VsdHNcbiAqIChldmVyeSBidWNrZXQgc29ydGVkIGJ5IHBhdGg7IHJlbmFtZXMgYnkgYGZyb21gKS5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IEZpbGVTdGF0LCBTdG9yYWdlQWRhcHRlciB9IGZyb20gJy4vYWRhcHRlcnMuanMnO1xuaW1wb3J0IHsgc2hhMjU2SGV4IH0gZnJvbSAnLi9oYXNoaW5nLmpzJztcbmltcG9ydCB7IGlzSWdub3JlZCwgdHlwZSBJZ25vcmVTZXR0aW5ncyB9IGZyb20gJy4vaWdub3JlLmpzJztcbmltcG9ydCB0eXBlIHsgTG9jYWxJbmRleCwgTG9jYWxJbmRleEVudHJ5IH0gZnJvbSAnLi9sb2NhbGluZGV4LmpzJztcbmltcG9ydCB7IHBhcmVudFBhdGggfSBmcm9tICcuL3BhdGhzLmpzJztcblxuLyoqIEluamVjdGFibGUgY29udGVudCBoYXNoICh0aGUgZGVmYXVsdCBpcyBzaGEyNTYsIHNhbWUgYXMgYmxvYiBhZGRyZXNzaW5nKS4gKi9cbmV4cG9ydCB0eXBlIEhhc2hGbiA9IChieXRlczogVWludDhBcnJheSkgPT4gUHJvbWlzZTxzdHJpbmc+O1xuXG4vKiogT3B0aW9ucyBmb3IgYHNjYW5WYXVsdGAuICovXG5leHBvcnQgaW50ZXJmYWNlIFNjYW5WYXVsdE9wdGlvbnMge1xuICAvKipcbiAgICogYCdmYXN0J2AgKGRlZmF1bHQpOiBmaWxlcyB3aG9zZSBzaXplK210aW1lIGV4YWN0bHkgbWF0Y2ggdGhlaXIgbGl2ZSBpbmRleFxuICAgKiBlbnRyeSBza2lwIHJlLWhhc2hpbmcuIGAnZnVsbCdgOiBoYXNoIGV2ZXJ5dGhpbmcgcmVnYXJkbGVzcyBcdTIwMTQgaW50ZWdyaXR5XG4gICAqIHZlcmlmaWNhdGlvbiAoYHZzYSBkb2N0b3JgLCBwZXJpb2RpYyBjaGVja3MpLlxuICAgKi9cbiAgbW9kZT86ICdmYXN0JyB8ICdmdWxsJztcbiAgLyoqIENvbnRlbnQgaGFzaCBvdmVycmlkZSAodGVzdHMgY291bnQvaW5zcGVjdCBoYXNoaW5nKS4gRGVmYXVsdDogc2hhMjU2SGV4LiAqL1xuICBoYXNoPzogSGFzaEZuO1xufVxuXG4vKiogQSBsb2NhbCBjb250ZW50IGNoYW5nZSBmb3IgYSBwYXRoIHRoYXQgZXhpc3RzIGluIHN0b3JhZ2UuICovXG5leHBvcnQgaW50ZXJmYWNlIFNjYW5DYW5kaWRhdGUge1xuICBwYXRoOiBzdHJpbmc7XG4gIGhhc2g6IHN0cmluZztcbiAgc2l6ZTogbnVtYmVyO1xufVxuXG4vKiogQSBsb2NhbCBkZWxldGlvbjogY2FycmllcyB0aGUgaW5kZXgncyB2ZXJzaW9uIHNvIHRoZSB0b21ic3RvbmUgY29tbWl0IG5hbWVzIGl0cyBwYXJlbnQuICovXG5leHBvcnQgaW50ZXJmYWNlIERlbGV0ZWRDYW5kaWRhdGUge1xuICBwYXRoOiBzdHJpbmc7XG4gIC8qKiBIYXNoIG9mIHRoZSBjb250ZW50IGFzIGxhc3Qgc3luY2VkICh0b21ic3RvbmVzIHJldXNlIGl0KS4gKi9cbiAgaGFzaDogc3RyaW5nO1xuICBzaXplOiBudW1iZXI7XG4gIC8qKiBWZXJzaW9uIGlkIHRoZSBkZWxldGlvbiBjb21taXQgYnVpbGRzIG9uLiAqL1xuICB2ZXJzaW9uSWQ6IHN0cmluZztcbn1cblxuLyoqIEEgZGV0ZWN0ZWQgcmVuYW1lOiBzYW1lIGNvbnRlbnQgaGFzaCBtb3ZlZCBmcm9tIGBmcm9tYCB0byBgdG9gLiAqL1xuZXhwb3J0IGludGVyZmFjZSBSZW5hbWVDYW5kaWRhdGUge1xuICBmcm9tOiBzdHJpbmc7XG4gIHRvOiBzdHJpbmc7XG4gIGhhc2g6IHN0cmluZztcbiAgc2l6ZTogbnVtYmVyO1xufVxuXG4vKipcbiAqIEEgZmlsZSB0aGlzIHNjYW4gYWN0dWFsbHkgcmVhZCBhbmQgaGFzaGVkLCB3aXRoIHRoZSBzdGF0IG9ic2VydmVkIGF0IGhhc2hcbiAqIHRpbWUuIEZlZWRzIGByZWNvcmRIYXNoZWRGaWxlc2Agc28gdGhlIE5FWFQgZmFzdCBzY2FuIGNhbiBza2lwIHRoZXNlIGZpbGVzXG4gKiAodGhlIG10aW1lIGNhY2hlIG9uIHRoZSBpbmRleCBlbnRyeSkuIEZpbGVzIHNraXBwZWQgYnkgdGhlIHByZS1maWx0ZXIgYXJlLFxuICogYnkgZGVmaW5pdGlvbiwgbm90IGhhc2hlZCBhbmQgZG8gbm90IGFwcGVhciBoZXJlLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIEhhc2hlZEZpbGUge1xuICBwYXRoOiBzdHJpbmc7XG4gIGhhc2g6IHN0cmluZztcbiAgc2l6ZTogbnVtYmVyO1xuICAvKiogRXBvY2ggbXMgXHUyMDE0IHRoZSBzdG9yYWdlIHN0YXQgYXQgaGFzaCB0aW1lIChgRmlsZVN0YXQubXRpbWVgKS4gKi9cbiAgbXRpbWU6IG51bWJlcjtcbn1cblxuLyoqIFRoZSBmdWxsIHJlc3VsdCBvZiBvbmUgbG9jYWwgc2Nhbi4gQWxsIGJ1Y2tldHMgc29ydGVkIGJ5IHBhdGguICovXG5leHBvcnQgaW50ZXJmYWNlIExvY2FsQ2hhbmdlcyB7XG4gIC8qKiBUaGUgYG5vd2AgcGFzc2VkIGluIFx1MjAxNCB3aGVuIHRoaXMgc2NhbiBjb25jZXB0dWFsbHkgaGFwcGVuZWQuICovXG4gIHNjYW5uZWRBdDogbnVtYmVyO1xuICBhZGRlZDogU2NhbkNhbmRpZGF0ZVtdO1xuICBtb2RpZmllZDogU2NhbkNhbmRpZGF0ZVtdO1xuICBkZWxldGVkOiBEZWxldGVkQ2FuZGlkYXRlW107XG4gIHJlbmFtZWQ6IFJlbmFtZUNhbmRpZGF0ZVtdO1xuICAvKiogRW1wdHktZm9sZGVyIHBhdGhzIHRvIHB1c2ggYXMgcGxhY2Vob2xkZXIgZW50cmllcyAoRlItMTApLiAqL1xuICBlbXB0eUZvbGRlcnM6IHN0cmluZ1tdO1xuICAvKiogRXZlcnkgZmlsZSB0aGUgc2NhbiBoYXNoZWQgKGZhc3QgbW9kZSdzIHNraXBwZWQgZmlsZXMgYXJlIGFic2VudCksIHNvcnRlZCBieSBwYXRoLiAqL1xuICBoYXNoZWQ6IEhhc2hlZEZpbGVbXTtcbn1cblxuLyoqXG4gKiBTY2FuIHRoZSB2YXVsdCBhbmQgZGlmZiBpdCBhZ2FpbnN0IHRoZSBpbmRleC5cbiAqXG4gKiBJbiBmYXN0IG1vZGUgKHRoZSBkZWZhdWx0KSBhIGZpbGUgd2hvc2Ugc2l6ZSBhbmQgbXRpbWUgYm90aCBleGFjdGx5IG1hdGNoXG4gKiBpdHMgbGl2ZSBpbmRleCBlbnRyeSBpcyBOT1QgcmUtaGFzaGVkIFx1MjAxNCB0aGUgcmVjb3JkZWQgaGFzaCBjYXJyaWVzIGZvcndhcmRcbiAqIGFzIHVuY2hhbmdlZCAoc2VlIHRoZSBtb2R1bGUgZG9jIGZvciB0aGUgdHJhZGVvZmYgYW5kIHRoZSBgZnVsbGAgZXNjYXBlXG4gKiBoYXRjaCkuXG4gKi9cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzY2FuVmF1bHQoXG4gIHN0b3JhZ2U6IFN0b3JhZ2VBZGFwdGVyLFxuICBpbmRleDogTG9jYWxJbmRleCxcbiAgc2V0dGluZ3M6IElnbm9yZVNldHRpbmdzLFxuICBub3c6IG51bWJlcixcbiAgb3B0aW9uczogU2NhblZhdWx0T3B0aW9ucyA9IHt9LFxuKTogUHJvbWlzZTxMb2NhbENoYW5nZXM+IHtcbiAgY29uc3QgaGFzaEZuID0gb3B0aW9ucy5oYXNoID8/IHNoYTI1NkhleDtcbiAgY29uc3QgbW9kZSA9IG9wdGlvbnMubW9kZSA/PyAnZmFzdCc7XG5cbiAgY29uc3QgZmlsZXMgPSBhd2FpdCBzdG9yYWdlLmxpc3RGaWxlcygpO1xuXG4gIGNvbnN0IGtlcHQ6IEZpbGVTdGF0W10gPSBbXTtcbiAgZm9yIChjb25zdCBmaWxlIG9mIGZpbGVzKSB7XG4gICAgaWYgKCFpc0lnbm9yZWQoZmlsZS5wYXRoLCBzZXR0aW5ncykpIGtlcHQucHVzaChmaWxlKTtcbiAgfVxuICBjb25zdCBrZXB0UGF0aHMgPSBuZXcgU2V0KGtlcHQubWFwKChmKSA9PiBmLnBhdGgpKTtcblxuICBjb25zdCBhZGRlZDogU2NhbkNhbmRpZGF0ZVtdID0gW107XG4gIGNvbnN0IG1vZGlmaWVkOiBTY2FuQ2FuZGlkYXRlW10gPSBbXTtcbiAgY29uc3QgaGFzaGVkOiBIYXNoZWRGaWxlW10gPSBbXTtcblxuICBmb3IgKGNvbnN0IGZpbGUgb2Yga2VwdCkge1xuICAgIGNvbnN0IGVudHJ5ID0gaW5kZXhbZmlsZS5wYXRoXTtcbiAgICBpZiAobW9kZSA9PT0gJ2Zhc3QnICYmIHN0YXRNYXRjaGVzRW50cnkoZW50cnksIGZpbGUpKSB7XG4gICAgICBjb250aW51ZTsgLy8gc2l6ZSttdGltZSB1bmNoYW5nZWQgc2luY2UgdGhlIHJlY29yZGVkIGhhc2ggXHUyMDE0IHRydXN0IGl0XG4gICAgfVxuICAgIGNvbnN0IGhhc2ggPSBhd2FpdCBoYXNoRm4oYXdhaXQgc3RvcmFnZS5yZWFkRmlsZShmaWxlLnBhdGgpKTtcbiAgICBoYXNoZWQucHVzaCh7IHBhdGg6IGZpbGUucGF0aCwgaGFzaCwgc2l6ZTogZmlsZS5zaXplLCBtdGltZTogZmlsZS5tdGltZSB9KTtcbiAgICBpZiAoZW50cnkgPT09IHVuZGVmaW5lZCkge1xuICAgICAgYWRkZWQucHVzaCh7IHBhdGg6IGZpbGUucGF0aCwgaGFzaCwgc2l6ZTogZmlsZS5zaXplIH0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIGlmIChlbnRyeS5pc0ZvbGRlcikge1xuICAgICAgLy8gQSByZWFsIGZpbGUgcmVwbGFjZWQgYSBmb2xkZXIgcGxhY2Vob2xkZXI6IHRyZWF0IGFzIGNvbnRlbnQgY2hhbmdlLlxuICAgICAgbW9kaWZpZWQucHVzaCh7IHBhdGg6IGZpbGUucGF0aCwgaGFzaCwgc2l6ZTogZmlsZS5zaXplIH0pO1xuICAgICAgY29udGludWU7XG4gICAgfVxuICAgIC8vIFRvbWJzdG9uZWQgZW50cnkgd2l0aCB0aGUgZmlsZSBiYWNrIFx1MjFEMiBtb2RpZmllZCAocmVzdXJyZWN0IG9yXG4gICAgLy8gZWRpdC1vZi1kZWxldGVkIFx1MjAxNCBib3RoIHJlc29sdmUgdGhlIHNhbWUgd2F5IGRvd25zdHJlYW0pLlxuICAgIGlmIChlbnRyeS5kZWxldGVkQXQgIT09IHVuZGVmaW5lZCB8fCBlbnRyeS5oYXNoICE9PSBoYXNoKSB7XG4gICAgICBtb2RpZmllZC5wdXNoKHsgcGF0aDogZmlsZS5wYXRoLCBoYXNoLCBzaXplOiBmaWxlLnNpemUgfSk7XG4gICAgfVxuICB9XG5cbiAgY29uc3QgZGVsZXRlZDogRGVsZXRlZENhbmRpZGF0ZVtdID0gW107XG4gIGZvciAoY29uc3QgW3BhdGgsIGVudHJ5XSBvZiBPYmplY3QuZW50cmllcyhpbmRleCkpIHtcbiAgICBpZiAoZW50cnkuaXNGb2xkZXIpIGNvbnRpbnVlOyAvLyBmb2xkZXIgcGxhY2Vob2xkZXJzIG5ldmVyIHByb2R1Y2UgZmlsZSBkZWxldGlvbnNcbiAgICBpZiAoZW50cnkuZGVsZXRlZEF0ICE9PSB1bmRlZmluZWQpIGNvbnRpbnVlOyAvLyBhbHJlYWR5IHRvbWJzdG9uZWRcbiAgICBpZiAoa2VwdFBhdGhzLmhhcyhwYXRoKSkgY29udGludWU7XG4gICAgaWYgKGlzSWdub3JlZChwYXRoLCBzZXR0aW5ncykpIHtcbiAgICAgIC8vIFRoZSBwYXRoIGJlY2FtZSBpZ25vcmVkIChzZXR0aW5ncyBjaGFuZ2UpIFx1MjAxNCBub3QgYSBkZWxldGlvbi5cbiAgICAgIGNvbnRpbnVlO1xuICAgIH1cbiAgICBkZWxldGVkLnB1c2goeyBwYXRoLCBoYXNoOiBlbnRyeS5oYXNoLCBzaXplOiBlbnRyeS5zaXplLCB2ZXJzaW9uSWQ6IGVudHJ5LnZlcnNpb25JZCB9KTtcbiAgfVxuXG4gIGNvbnN0IHsgcmVuYW1lZCwgZGVsZXRlZDogdW5tYXRjaGVkRGVsZXRlZCwgYWRkZWQ6IHVubWF0Y2hlZEFkZGVkIH0gPSBkZXRlY3RSZW5hbWVzKGRlbGV0ZWQsIGFkZGVkKTtcbiAgY29uc3QgZW1wdHlGb2xkZXJzID0gYXdhaXQgZGV0ZWN0RW1wdHlGb2xkZXJzKHN0b3JhZ2UsIGluZGV4LCBzZXR0aW5ncywgZmlsZXMpO1xuXG4gIHJldHVybiB7XG4gICAgc2Nhbm5lZEF0OiBub3csXG4gICAgYWRkZWQ6IHNvcnRDYW5kaWRhdGVzKHVubWF0Y2hlZEFkZGVkKSxcbiAgICBtb2RpZmllZDogc29ydENhbmRpZGF0ZXMobW9kaWZpZWQpLFxuICAgIGRlbGV0ZWQ6IFsuLi51bm1hdGNoZWREZWxldGVkXS5zb3J0KGJ5UGF0aCksXG4gICAgcmVuYW1lZDogWy4uLnJlbmFtZWRdLnNvcnQoKGEsIGIpID0+IGJ5UGF0aChhLCBiKSksXG4gICAgZW1wdHlGb2xkZXJzLFxuICAgIGhhc2hlZDogWy4uLmhhc2hlZF0uc29ydChieVBhdGgpLFxuICB9O1xufVxuXG4vKipcbiAqIFdoZXRoZXIgdGhlIGZpbGUncyBzdGF0IGV4YWN0bHkgbWF0Y2hlcyBpdHMgbGl2ZSBpbmRleCBlbnRyeSBcdTIwMTQgdGhlIGZhc3RcbiAqIG1vZGUgcHJlLWZpbHRlci4gUmVxdWlyZXMgYSBrbm93biByZWNvcmRlZCBgbXRpbWVgIChsZWdhY3kgZW50cmllcyBhbmRcbiAqIHB1bGwtd3JpdHRlbiBlbnRyaWVzIGhhdmUgbm9uZSBcdTIxRDIgaGFzaGVkLCB0aGVuIHJlY29yZGVkKSBhbmQgbmV2ZXIgZmlyZXNcbiAqIGZvciB0b21ic3RvbmVzIChhIHJlc3VycmVjdCBtdXN0IGFsd2F5cyBzdXJmYWNlKSBvciBmb2xkZXIgcGxhY2Vob2xkZXJzLlxuICovXG5mdW5jdGlvbiBzdGF0TWF0Y2hlc0VudHJ5KGVudHJ5OiBMb2NhbEluZGV4RW50cnkgfCB1bmRlZmluZWQsIGZpbGU6IEZpbGVTdGF0KTogYm9vbGVhbiB7XG4gIHJldHVybiAoXG4gICAgZW50cnkgIT09IHVuZGVmaW5lZCAmJlxuICAgIGVudHJ5LmRlbGV0ZWRBdCA9PT0gdW5kZWZpbmVkICYmXG4gICAgZW50cnkuaXNGb2xkZXIgIT09IHRydWUgJiZcbiAgICBlbnRyeS5tdGltZSAhPT0gdW5kZWZpbmVkICYmXG4gICAgZW50cnkubXRpbWUgPT09IGZpbGUubXRpbWUgJiZcbiAgICBlbnRyeS5zaXplID09PSBmaWxlLnNpemVcbiAgKTtcbn1cblxuLyoqXG4gKiBSZWNvcmQgYSBzY2FuJ3MgaGFzaCBvYnNlcnZhdGlvbnMgaW50byB0aGUgaW5kZXg6IGZvciBldmVyeSBsaXZlIGZpbGVcbiAqIGVudHJ5IHdob3NlIGNvbnRlbnQgaGFzaCBtYXRjaGVzIHdoYXQgdGhlIHNjYW4gaGFzaGVkLCBjYWNoZSB0aGUgb2JzZXJ2ZWRcbiAqIG10aW1lIHNvIHRoZSBuZXh0IGZhc3Qgc2NhbiBjYW4gc2tpcCByZS1oYXNoaW5nIGl0LlxuICpcbiAqIFB1cmU6IHJldHVybnMgYSBuZXcgaW5kZXggKG9yIHRoZSBpbnB1dCB3aGVuIG5vdGhpbmcgY2hhbmdlcyksIG5ldmVyXG4gKiBtdXRhdGVzLiBUaGUgaGFzaC1tYXRjaCBndWFyZCBrZWVwcyB0aGUgY2FjaGUgaG9uZXN0IFx1MjAxNCBhbiBlbnRyeSB3aG9zZVxuICogaGFzaCBubyBsb25nZXIgcmVmbGVjdHMgdGhlIG9ic2VydmF0aW9uIChlLmcuIGEgcHVsbCBvdmVyd3JvdGUgdGhlIHBhdGhcbiAqIG1pZC1jeWNsZSkgaXMgbGVmdCB1bnRvdWNoZWQgYW5kIHNpbXBseSBnZXRzIHJlLWhhc2hlZCBuZXh0IHNjYW4uXG4gKiBFbnRyaWVzIG5ldmVyIGRlbW90ZTogYGRlbGV0ZWRBdGAvYGlzRm9sZGVyYCBlbnRyaWVzIGFyZSBuZXZlciBwYXRjaGVkLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVjb3JkSGFzaGVkRmlsZXMoXG4gIGluZGV4OiBMb2NhbEluZGV4LFxuICBoYXNoZWQ6IHJlYWRvbmx5IEhhc2hlZEZpbGVbXSxcbik6IExvY2FsSW5kZXgge1xuICBsZXQgbmV4dDogUmVjb3JkPHN0cmluZywgTG9jYWxJbmRleEVudHJ5PiB8IHVuZGVmaW5lZDtcbiAgZm9yIChjb25zdCBvYnNlcnZlZCBvZiBoYXNoZWQpIHtcbiAgICBjb25zdCBlbnRyeSA9IGluZGV4W29ic2VydmVkLnBhdGhdO1xuICAgIGlmIChlbnRyeSA9PT0gdW5kZWZpbmVkIHx8IGVudHJ5LmlzRm9sZGVyIHx8IGVudHJ5LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkKSBjb250aW51ZTtcbiAgICBpZiAoZW50cnkuaGFzaCAhPT0gb2JzZXJ2ZWQuaGFzaCkgY29udGludWU7XG4gICAgaWYgKGVudHJ5Lm10aW1lID09PSBvYnNlcnZlZC5tdGltZSkgY29udGludWU7XG4gICAgbmV4dCA/Pz0geyAuLi5pbmRleCB9O1xuICAgIG5leHRbb2JzZXJ2ZWQucGF0aF0gPSB7IC4uLmVudHJ5LCBtdGltZTogb2JzZXJ2ZWQubXRpbWUgfTtcbiAgfVxuICByZXR1cm4gbmV4dCA/PyBpbmRleDtcbn1cblxuLyoqXG4gKiBDb3JyZWxhdGUgZGVsZXRlICsgYWRkIHBhaXJzIGJ5IGNvbnRlbnQgaGFzaCAoQVJDSElURUNUVVJFIFx1MDBBNzQpLlxuICpcbiAqIE9uZS10by1vbmUgbWF0Y2hpbmcsIG1vc3QgZGV0ZXJtaW5pc3RpYyB3aW5zOiB3aGVuIHNldmVyYWwgdW5tYXRjaGVkIGFkZHNcbiAqIHNoYXJlIHRoZSBkZWxldGVkIHNpZGUncyBoYXNoLCBwcmVmZXIgYW4gYWRkIGluIHRoZSBzYW1lIHBhcmVudCBkaXJlY3Rvcnk7XG4gKiB3aXRoaW4gYSBwcmVmZXJlbmNlIGNsYXNzLCB0aGUgbGV4aWNvZ3JhcGhpY2FsbHkgc21hbGxlc3QgYHRvYCBwYXRoIHdpbnMuXG4gKiBNYXRjaGVkIHBhaXJzIGxlYXZlIHRoZSBkZWxldGUvYWRkIGJ1Y2tldHMgYW5kIGJlY29tZSBgcmVuYW1lZGAuXG4gKi9cbmZ1bmN0aW9uIGRldGVjdFJlbmFtZXMoXG4gIGRlbGV0ZWQ6IHJlYWRvbmx5IERlbGV0ZWRDYW5kaWRhdGVbXSxcbiAgYWRkZWQ6IHJlYWRvbmx5IFNjYW5DYW5kaWRhdGVbXSxcbik6IHtcbiAgcmVuYW1lZDogUmVuYW1lQ2FuZGlkYXRlW107XG4gIGRlbGV0ZWQ6IERlbGV0ZWRDYW5kaWRhdGVbXTtcbiAgYWRkZWQ6IFNjYW5DYW5kaWRhdGVbXTtcbn0ge1xuICBjb25zdCBhZGRzQnlIYXNoID0gbmV3IE1hcDxzdHJpbmcsIFNjYW5DYW5kaWRhdGVbXT4oKTtcbiAgZm9yIChjb25zdCBjYW5kaWRhdGUgb2YgWy4uLmFkZGVkXS5zb3J0KGJ5UGF0aCkpIHtcbiAgICBjb25zdCBidWNrZXQgPSBhZGRzQnlIYXNoLmdldChjYW5kaWRhdGUuaGFzaCk7XG4gICAgaWYgKGJ1Y2tldCkgYnVja2V0LnB1c2goY2FuZGlkYXRlKTtcbiAgICBlbHNlIGFkZHNCeUhhc2guc2V0KGNhbmRpZGF0ZS5oYXNoLCBbY2FuZGlkYXRlXSk7XG4gIH1cblxuICBjb25zdCB1c2VkQWRkcyA9IG5ldyBTZXQ8c3RyaW5nPigpO1xuICBjb25zdCByZW5hbWVkOiBSZW5hbWVDYW5kaWRhdGVbXSA9IFtdO1xuICBjb25zdCB1bm1hdGNoZWREZWxldGVkOiBEZWxldGVkQ2FuZGlkYXRlW10gPSBbXTtcblxuICBmb3IgKGNvbnN0IGRlbGV0aW9uIG9mIFsuLi5kZWxldGVkXS5zb3J0KGJ5UGF0aCkpIHtcbiAgICBjb25zdCBjYW5kaWRhdGVzID0gYWRkc0J5SGFzaC5nZXQoZGVsZXRpb24uaGFzaCkgPz8gW107XG4gICAgbGV0IGZhbGxiYWNrOiBTY2FuQ2FuZGlkYXRlIHwgdW5kZWZpbmVkO1xuICAgIGxldCBzYW1lRGlyOiBTY2FuQ2FuZGlkYXRlIHwgdW5kZWZpbmVkO1xuICAgIGZvciAoY29uc3QgY2FuZGlkYXRlIG9mIGNhbmRpZGF0ZXMpIHtcbiAgICAgIGlmICh1c2VkQWRkcy5oYXMoY2FuZGlkYXRlLnBhdGgpKSBjb250aW51ZTtcbiAgICAgIGlmIChwYXJlbnRQYXRoKGNhbmRpZGF0ZS5wYXRoKSA9PT0gcGFyZW50UGF0aChkZWxldGlvbi5wYXRoKSkge1xuICAgICAgICBzYW1lRGlyID8/PSBjYW5kaWRhdGU7IC8vIHNvcnRlZCBcdTIxRDIgZmlyc3QgaXMgc21hbGxlc3RcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGZhbGxiYWNrID8/PSBjYW5kaWRhdGU7XG4gICAgICB9XG4gICAgfVxuICAgIGNvbnN0IG1hdGNoID0gc2FtZURpciA/PyBmYWxsYmFjaztcbiAgICBpZiAobWF0Y2gpIHtcbiAgICAgIHVzZWRBZGRzLmFkZChtYXRjaC5wYXRoKTtcbiAgICAgIHJlbmFtZWQucHVzaCh7IGZyb206IGRlbGV0aW9uLnBhdGgsIHRvOiBtYXRjaC5wYXRoLCBoYXNoOiBkZWxldGlvbi5oYXNoLCBzaXplOiBkZWxldGlvbi5zaXplIH0pO1xuICAgIH0gZWxzZSB7XG4gICAgICB1bm1hdGNoZWREZWxldGVkLnB1c2goZGVsZXRpb24pO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB7XG4gICAgcmVuYW1lZCxcbiAgICBkZWxldGVkOiB1bm1hdGNoZWREZWxldGVkLFxuICAgIGFkZGVkOiBhZGRlZC5maWx0ZXIoKGNhbmRpZGF0ZSkgPT4gIXVzZWRBZGRzLmhhcyhjYW5kaWRhdGUucGF0aCkpLFxuICB9O1xufVxuXG4vKipcbiAqIERpcmVjdG9yaWVzIHRoYXQgZXhpc3QgaW4gc3RvcmFnZSBidXQgYXJlIHJlcHJlc2VudGVkIG5laXRoZXIgYnkgYSBsaXZlXG4gKiBmb2xkZXIgcGxhY2Vob2xkZXIgaW4gdGhlIGluZGV4IG5vciBieSBhbnkgZmlsZSAoaWdub3JlZCBvciBub3QpIGJlbmVhdGhcbiAqIHRoZW0uIEEgZGlyZWN0b3J5IGNvbnRhaW5pbmcgb25seSBpZ25vcmVkIGZpbGVzIGlzIHRoZXJlZm9yZSAqbm90KiBlbXB0eSBcdTIwMTRcbiAqIGl0IGlzIHJlcHJlc2VudGVkIGJ5IHRob3NlIGZpbGVzIGFzIGZhciBhcyB0aGUgbG9jYWwgbWFjaGluZSBpcyBjb25jZXJuZWQuXG4gKi9cbmFzeW5jIGZ1bmN0aW9uIGRldGVjdEVtcHR5Rm9sZGVycyhcbiAgc3RvcmFnZTogU3RvcmFnZUFkYXB0ZXIsXG4gIGluZGV4OiBMb2NhbEluZGV4LFxuICBzZXR0aW5nczogSWdub3JlU2V0dGluZ3MsXG4gIGZpbGVzOiByZWFkb25seSBGaWxlU3RhdFtdLFxuKTogUHJvbWlzZTxzdHJpbmdbXT4ge1xuICBjb25zdCByZXByZXNlbnRlZERpcnMgPSBuZXcgU2V0PHN0cmluZz4oKTtcbiAgZm9yIChjb25zdCBmaWxlIG9mIGZpbGVzKSB7XG4gICAgZm9yIChsZXQgZGlyID0gcGFyZW50UGF0aChmaWxlLnBhdGgpOyBkaXIgIT09ICcvJzsgZGlyID0gcGFyZW50UGF0aChkaXIpKSB7XG4gICAgICByZXByZXNlbnRlZERpcnMuYWRkKGRpcik7XG4gICAgfVxuICB9XG5cbiAgY29uc3QgZW1wdHlGb2xkZXJzOiBzdHJpbmdbXSA9IFtdO1xuICBmb3IgKGNvbnN0IGRpciBvZiBhd2FpdCBzdG9yYWdlLmxpc3REaXJzKCkpIHtcbiAgICBpZiAoZGlyID09PSAnLycpIGNvbnRpbnVlO1xuICAgIGlmIChyZXByZXNlbnRlZERpcnMuaGFzKGRpcikpIGNvbnRpbnVlO1xuICAgIGlmIChpc0lnbm9yZWQoZGlyLCBzZXR0aW5ncykpIGNvbnRpbnVlO1xuICAgIGNvbnN0IGVudHJ5ID0gaW5kZXhbZGlyXTtcbiAgICBpZiAoZW50cnk/LmlzRm9sZGVyICYmIGVudHJ5LmRlbGV0ZWRBdCA9PT0gdW5kZWZpbmVkKSBjb250aW51ZTsgLy8gYWxyZWFkeSBzeW5jZWQgYXMgcGxhY2Vob2xkZXJcbiAgICBlbXB0eUZvbGRlcnMucHVzaChkaXIpO1xuICB9XG4gIHJldHVybiBlbXB0eUZvbGRlcnMuc29ydCgpO1xufVxuXG5mdW5jdGlvbiBzb3J0Q2FuZGlkYXRlcyhjYW5kaWRhdGVzOiBTY2FuQ2FuZGlkYXRlW10pOiBTY2FuQ2FuZGlkYXRlW10ge1xuICByZXR1cm4gWy4uLmNhbmRpZGF0ZXNdLnNvcnQoYnlQYXRoKTtcbn1cblxuZnVuY3Rpb24gYnlQYXRoPFQgZXh0ZW5kcyB7IHBhdGg/OiBzdHJpbmc7IGZyb20/OiBzdHJpbmcgfT4oYTogVCwgYjogVCk6IG51bWJlciB7XG4gIGNvbnN0IGtleUEgPSBhLnBhdGggPz8gYS5mcm9tID8/ICcnO1xuICBjb25zdCBrZXlCID0gYi5wYXRoID8/IGIuZnJvbSA/PyAnJztcbiAgcmV0dXJuIGtleUEgPCBrZXlCID8gLTEgOiBrZXlBID4ga2V5QiA/IDEgOiAwO1xufVxuIiwgIi8qKlxuICogYFN5bmNDbGllbnRgIFx1MjAxNCB0aGUgbmV0d29yay1mYWNpbmcgb3JjaGVzdHJhdG9yIChBUkNISVRFQ1RVUkUubWQgXHUwMEE3OCkuXG4gKlxuICogQ29tcG9zZXMgdGhlIHBoYXNlLTFhLzFiIHBpZWNlcyBpbnRvIG9uZSBsb29wIHBlciBkZXZpY2U6XG4gKlxuICogICBzdGFydHVwOiAgbG9hZExvY2FsSW5kZXggXHUyMTkyIGhlbGxvL2hlbGxvQWNrIFx1MjE5MiBnZXRNYW5pZmVzdCBcdTIxOTIgc2NhblZhdWx0IFx1MjE5MlxuICogICAgICAgICAgICAgY29tcHV0ZVN5bmNQbGFuIFx1MjE5MiBleGVjdXRlIChwdXNoZXMgaW5saW5lLW9yLWJsb2IsIHB1bGxzIHZpYVxuICogICAgICAgICAgICAgYXBwbHlQdWxsIHdpdGggdGhlIGluamVjdGVkIGJsb2Igc3RvcmUpO1xuICogICBsaXZlOiAgICAgYGNoYW5nZWAgbWVzc2FnZXMgbWF0ZXJpYWxpemUgaW1tZWRpYXRlbHkgd2hlbiB0aGUgdGFyZ2V0IGlzXG4gKiAgICAgICAgICAgICBjbGVhbiwgYW5kIGRlZmVyIHRvIGEgZnVsbCByZWNvbmNpbGUgY3ljbGUgd2hlbiBpdCBpcyBub3QgXHUyMDE0IGFcbiAqICAgICAgICAgICAgIHJlbW90ZSBjaGFuZ2UgaXMgTkVWRVIgd3JpdHRlbiBvdmVyIGxvY2FsbHktbW9kaWZpZWQgY29udGVudFxuICogICAgICAgICAgICAgd2l0aG91dCBnb2luZyB0aHJvdWdoIGBjb21wdXRlU3luY1BsYW5gJ3MgY29uZmxpY3QgbG9naWM7XG4gKiAgIHdhdGNoZXI6ICBgV2F0Y2hBZGFwdGVyYCBiYXRjaGVzIGFyZSBkZWJvdW5jZWQgKH4zMDAgbXMsIGluamVjdGFibGVcbiAqICAgICAgICAgICAgIHNjaGVkdWxlciBcdTIwMTQgbm8gYW1iaWVudCB0aW1lcnMgaW4gdGVzdHMpIGludG8gc2Nhblx1MjE5MnBsYW5cdTIxOTJleGVjdXRlO1xuICogICByZWNvbm5lY3Q6IGBvbkNsb3NlYCBmbGlwcyB0byBgJ2Rpc2Nvbm5lY3RlZCdgOyBgcmVjb25uZWN0KClgIHJlLXJ1bnMgdGhlXG4gKiAgICAgICAgICAgICB3aG9sZSBzdGFydHVwIHJlY29uY2lsaWF0aW9uIChiYWNrb2ZmIGlzIHRoZSBjYWxsZXIncyBqb2IpLlxuICpcbiAqIEFsbCBJL08gY3Jvc3NlcyB0aGUgYWRhcHRlciBzZWFtcyAoYFN0b3JhZ2VBZGFwdGVyYCwgYFRyYW5zcG9ydGAsXG4gKiBgQmxvYlN0b3JlYCwgYExvZ0FkYXB0ZXJgKTsgdGhlIGNsYXNzIGl0c2VsZiBpcyBwdXJlIG9yY2hlc3RyYXRpb24gYW5kIHJ1bnNcbiAqIGFueXdoZXJlIGBjb3JlYCBydW5zIFx1MjAxNCBXb3JrZXJzIHRlc3RzIGluY2x1ZGVkLlxuICovXG5cbmltcG9ydCB0eXBlIHsgTG9nQWRhcHRlciwgU3RvcmFnZUFkYXB0ZXIsIFdhdGNoQWRhcHRlciB9IGZyb20gJy4vYWRhcHRlcnMuanMnO1xuaW1wb3J0IHsgY29tcGFyZUNsb2NrcyB9IGZyb20gJy4vY2xvY2suanMnO1xuaW1wb3J0IHsgYXBwbHlQdWxsLCBsb2FkTG9jYWxJbmRleCwgdHlwZSBGZXRjaEJsb2IgfSBmcm9tICcuL2VuZ2luZS5qcyc7XG5pbXBvcnQgeyBOZXR3b3JrRXJyb3IsIFByb3RvY29sRXJyb3IsIFJldm9rZWRFcnJvciwgVW5hdXRob3JpemVkRXJyb3IgfSBmcm9tICcuL2Vycm9ycy5qcyc7XG5pbXBvcnQgeyBzaGEyNTZIZXggfSBmcm9tICcuL2hhc2hpbmcuanMnO1xuaW1wb3J0IHsgaXNJZ25vcmVkLCB0eXBlIElnbm9yZVNldHRpbmdzIH0gZnJvbSAnLi9pZ25vcmUuanMnO1xuaW1wb3J0IHtcbiAgYXBwbHlDb21taXQsXG4gIExPQ0FMX0lOREVYX1NUQVRFX1BBVEgsXG4gIHJlbW92ZUVudHJ5LFxuICBzZXJpYWxpemVMb2NhbEluZGV4LFxuICB0eXBlIExvY2FsSW5kZXgsXG59IGZyb20gJy4vbG9jYWxpbmRleC5qcyc7XG5pbXBvcnQge1xuICBiYXNlNjRUb0J5dGVzLFxuICBieXRlc1RvQmFzZTY0LFxuICBJTkxJTkVfQ09OVEVOVF9NQVhfQllURVMsXG4gIFByb3RvY29sVmVyc2lvbixcbiAgdHlwZSBCbG9iQWNrTWVzc2FnZSxcbiAgdHlwZSBCbG9iTWVzc2FnZSxcbiAgdHlwZSBDaGFuZ2VNZXNzYWdlLFxuICB0eXBlIENvbW1pdEFja01lc3NhZ2UsXG4gIHR5cGUgQ29tbWl0TWVzc2FnZSxcbiAgdHlwZSBDb25mbGljdE1lc3NhZ2UsXG4gIHR5cGUgSGVsbG9BY2tNZXNzYWdlLFxuICB0eXBlIE1hbmlmZXN0TWVzc2FnZSxcbiAgdHlwZSBNZXNzYWdlLFxuICB0eXBlIFNlcnZlck1lc3NhZ2UsXG59IGZyb20gJy4vcHJvdG9jb2wuanMnO1xuaW1wb3J0IHtcbiAgY29tcHV0ZVN5bmNQbGFuLFxuICB0eXBlIENvbmZsaWN0T3AsXG4gIHR5cGUgUHVsbEZpbGVPcCxcbiAgdHlwZSBQdWxsT3AsXG4gIHR5cGUgUHVzaE9wLFxuICB0eXBlIFJlbW90ZUZpbGUsXG4gIHR5cGUgU3luY1BsYW4sXG59IGZyb20gJy4vcmVzb2x2ZS5qcyc7XG5pbXBvcnQgeyByZWNvcmRIYXNoZWRGaWxlcywgc2NhblZhdWx0LCB0eXBlIEhhc2hlZEZpbGUgfSBmcm9tICcuL3NjYW4uanMnO1xuaW1wb3J0IHR5cGUgeyBUcmFuc3BvcnQgfSBmcm9tICcuL3RyYW5zcG9ydC5qcyc7XG5pbXBvcnQgdHlwZSB7IExvZ2ljYWxDbG9jayB9IGZyb20gJy4vdHlwZXMuanMnO1xuXG4vLyAtLS0gcHVibGljIG9wdGlvbi9zdGF0dXMgc2hhcGVzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbi8qKiBDbGllbnQtc2lkZSBjb250ZW50LWFkZHJlc3NlZCBibG9iIGNhY2hlIChSMiBjbGllbnQgaW4gcHJvZHVjdGlvbjsgYSBNYXAgaW4gdGVzdHMpLiAqL1xuZXhwb3J0IGludGVyZmFjZSBCbG9iU3RvcmUge1xuICBnZXQoaGFzaDogc3RyaW5nKTogUHJvbWlzZTxVaW50OEFycmF5IHwgdW5kZWZpbmVkPjtcbiAgcHV0KGhhc2g6IHN0cmluZywgYnl0ZXM6IFVpbnQ4QXJyYXkpOiBQcm9taXNlPHZvaWQ+O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFN5bmNDbGllbnRPcHRpb25zIHtcbiAgZGV2aWNlSWQ6IHN0cmluZztcbiAgZGV2aWNlTmFtZTogc3RyaW5nO1xuICB0b2tlbjogc3RyaW5nO1xuICAvKiogQSBmYWN0b3J5IChyZWNvbm5lY3QgZGlhbHMgZnJlc2gpIG9yIGEgc2luZ2xlIHJldXNhYmxlIGluc3RhbmNlLiAqL1xuICB0cmFuc3BvcnQ6ICgoKSA9PiBUcmFuc3BvcnQpIHwgVHJhbnNwb3J0O1xuICBibG9iU3RvcmU6IEJsb2JTdG9yZTtcbiAgc3RvcmFnZTogU3RvcmFnZUFkYXB0ZXI7XG4gIGxvZz86IExvZ0FkYXB0ZXI7XG4gIC8qKiBJbml0aWFsIGlnbm9yZSBzZXR0aW5nczsgc3VwZXJzZWRlZCBieSBgaGVsbG9BY2suc2V0dGluZ3NgIG9uIGNvbm5lY3QuICovXG4gIHNldHRpbmdzPzogSWdub3JlU2V0dGluZ3M7XG4gIC8qKiBJbmplY3RhYmxlIGNsb2NrIChkZWZhdWx0IGBEYXRlLm5vd2ApLiAqL1xuICBub3c/OiAoKSA9PiBudW1iZXI7XG4gIC8qKiBXYXRjaGVyIGRlYm91bmNlIHdpbmRvdyBpbiBtcyAoZGVmYXVsdCAzMDApLiAqL1xuICBkZWJvdW5jZU1zPzogbnVtYmVyO1xuICAvKipcbiAgICogU2NoZWR1bGVzIHRoZSBkZWJvdW5jZWQgc3luYyBjeWNsZS4gRGVmYXVsdDogYHNldFRpbWVvdXRgLiBUZXN0cyBpbmplY3QgYVxuICAgKiBtYW51YWwgcXVldWUgXHUyMDE0IHRoZSBjbGllbnQgbmV2ZXIgdG91Y2hlcyBhIHJlYWwgdGltZXIgYmVoaW5kIHRoaXMgc2VhbS5cbiAgICovXG4gIHNjaGVkdWxlPzogKGZuOiAoKSA9PiB2b2lkLCBtczogbnVtYmVyKSA9PiAoKSA9PiB2b2lkO1xufVxuXG5leHBvcnQgdHlwZSBTeW5jQ2xpZW50U3RhdGUgPSAnaWRsZScgfCAnY29ubmVjdGluZycgfCAnc3luY2luZycgfCAnbGl2ZScgfCAnZGlzY29ubmVjdGVkJztcblxuZXhwb3J0IGludGVyZmFjZSBTeW5jQ2xpZW50U3RhdHVzIHtcbiAgc3RhdGU6IFN5bmNDbGllbnRTdGF0ZTtcbiAgLyoqIEVwb2NoIG1zIG9mIHRoZSBsYXN0IGNvbXBsZXRlZCBjeWNsZSwgb3IgbnVsbCBiZWZvcmUgdGhlIGZpcnN0LiAqL1xuICBsYXN0U3luY0F0OiBudW1iZXIgfCBudWxsO1xuICAvKiogV2F0Y2hlci9yZWNvbmNpbGUgZXZlbnRzIHF1ZXVlZCBiZWhpbmQgdGhlIGRlYm91bmNlIHdpbmRvdy4gKi9cbiAgcGVuZGluZzogbnVtYmVyO1xuICAvKiogQ29uZmxpY3RzIG9ic2VydmVkIGJ5IHBsYW4gY3ljbGVzIChpbmZvcm1hdGlvbmFsOyByZXNvbHV0aW9uIGlzIGluIHRoZSBkYXRhKS4gKi9cbiAgY29uZmxpY3RzOiBDb25mbGljdE9wW107XG59XG5cbmNvbnN0IGRlZmF1bHRMb2c6IExvZ0FkYXB0ZXIgPSB7XG4gIGRlYnVnOiAoKSA9PiB7fSxcbiAgaW5mbzogKCkgPT4ge30sXG4gIHdhcm46ICgpID0+IHt9LFxuICBlcnJvcjogKCkgPT4ge30sXG59O1xuXG5jb25zdCBkZWZhdWx0U2NoZWR1bGUgPSAoZm46ICgpID0+IHZvaWQsIG1zOiBudW1iZXIpOiAoKCkgPT4gdm9pZCkgPT4ge1xuICBjb25zdCBoYW5kbGUgPSBnbG9iYWxUaGlzLnNldFRpbWVvdXQoZm4sIG1zKSBhcyB1bmtub3duIGFzIG51bWJlcjtcbiAgcmV0dXJuICgpID0+IGdsb2JhbFRoaXMuY2xlYXJUaW1lb3V0KGhhbmRsZSk7XG59O1xuXG4vKiogQSBjb21taXQgcHJlcGFyZWQgZm9yIHRoZSB3aXJlIChhIGBQdXNoT3BgICsgaXRzIHN0YWdlZCBjb250ZW50KS4gKi9cbmludGVyZmFjZSBTdGFnZWRDb21taXQge1xuICBraW5kOiBDb21taXRNZXNzYWdlWydraW5kJ107XG4gIHBhdGg6IHN0cmluZztcbiAgcGFyZW50VmVyc2lvbjogc3RyaW5nIHwgbnVsbDtcbiAgaGFzaDogc3RyaW5nO1xuICBzaXplOiBudW1iZXI7XG4gIGZyb21QYXRoPzogc3RyaW5nO1xuICBpc0ZvbGRlcj86IGJvb2xlYW47XG4gIGJ5dGVzPzogVWludDhBcnJheTtcbiAgLyoqXG4gICAqIFN0b3JhZ2UgbXRpbWUgb2JzZXJ2ZWQgYnkgVEhJUyBjeWNsZSdzIHNjYW4gd2hlbiBpdCBoYXNoZWQgdGhlIGNvbnRlbnRcbiAgICogKGBIYXNoZWRGaWxlLm10aW1lYCBvZiB0aGUgcHVzaCBzb3VyY2UpLiBQaW5uZWQgb250byB0aGUgaW5kZXggZW50cnkgd2hlblxuICAgKiB0aGUgYWNrIGxhbmRzLCBzbyB0aGUgZW50cnkncyAoaGFzaCwgc2l6ZSwgbXRpbWUpIGFsd2F5cyBkZXNjcmliZXMgT05FXG4gICAqIGNvbnNpc3RlbnQgaW5zdGFudCBvZiB0aGUgZmlsZSBcdTIwMTQgbmV2ZXIgYSBsYXRlciBzdGF0IHBhaXJlZCB3aXRoIHRoaXNcbiAgICogaGFzaC4gVGhhdCBvcmRlcmluZyBpcyB3aGF0IGxldHMgdGhlIHNjYW4gZmFzdC1wYXRoIChtdGltZStzaXplKSBza2lwXG4gICAqIHJlLWhhc2hpbmcgc2FmZWx5OiBhbiBlZGl0IGxhbmRpbmcgYmV0d2VlbiBoYXNoIGFuZCBhY2sgY2hhbmdlcyB0aGUgZGlza1xuICAgKiBzdGF0LCBtaXNzZXMgdGhlIGZhc3QgcGF0aCwgYW5kIGlzIHJlLWhhc2hlZCBhbmQgcHVzaGVkIG9uIHRoZSBuZXh0IHNjYW4uXG4gICAqL1xuICBtdGltZT86IG51bWJlcjtcbn1cblxuLy8gLS0tIHRoZSBjbGllbnQgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbmV4cG9ydCBjbGFzcyBTeW5jQ2xpZW50IHtcbiAgcHJpdmF0ZSByZWFkb25seSBvcHRpb25zOiBTeW5jQ2xpZW50T3B0aW9ucztcbiAgcHJpdmF0ZSByZWFkb25seSBsb2c6IExvZ0FkYXB0ZXI7XG4gIHByaXZhdGUgcmVhZG9ubHkgbm93OiAoKSA9PiBudW1iZXI7XG4gIHByaXZhdGUgcmVhZG9ubHkgZGVib3VuY2VNczogbnVtYmVyO1xuICBwcml2YXRlIHJlYWRvbmx5IHNjaGVkdWxlOiAoZm46ICgpID0+IHZvaWQsIG1zOiBudW1iZXIpID0+ICgpID0+IHZvaWQ7XG4gIHByaXZhdGUgcmVhZG9ubHkgZGlhbFRyYW5zcG9ydDogKCkgPT4gVHJhbnNwb3J0O1xuXG4gIHByaXZhdGUgdHJhbnNwb3J0OiBUcmFuc3BvcnQgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBzdGF0ZTogU3luY0NsaWVudFN0YXRlID0gJ2lkbGUnO1xuICBwcml2YXRlIGluZGV4OiBMb2NhbEluZGV4ID0ge307XG4gIHByaXZhdGUgY3Vyc29yID0gMDtcbiAgcHJpdmF0ZSBsYXN0U3luY0F0OiBudW1iZXIgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBwZW5kaW5nID0gMDtcbiAgcHJpdmF0ZSBjb25mbGljdHM6IENvbmZsaWN0T3BbXSA9IFtdO1xuICBwcml2YXRlIGlnbm9yZVNldHRpbmdzOiBJZ25vcmVTZXR0aW5ncztcbiAgcHJpdmF0ZSB3YXRjaEFkYXB0ZXI6IFdhdGNoQWRhcHRlciB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGNhbmNlbERlYm91bmNlOiAoKCkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcblxuICAvKiogU2VyaWFsaXplZCBvcGVyYXRpb24gcXVldWUgXHUyMDE0IGV4YWN0bHkgb25lIGFzeW5jIG9wIHJ1bnMgYXQgYSB0aW1lLiAqL1xuICBwcml2YXRlIHRhaWw6IFByb21pc2U8dW5rbm93bj4gPSBQcm9taXNlLnJlc29sdmUoKTtcbiAgcHJpdmF0ZSBxdWV1ZWRPcHMgPSAwO1xuICAvKiogU3RhcnR1cC10aW1lIGNoYW5nZSBmbG9vZCBpcyBidWZmZXJlZDsgdGhlIGZ1bGwgbWFuaWZlc3Qgc3Vic3VtZXMgaXQuICovXG4gIHByaXZhdGUgYnVmZmVyaW5nID0gZmFsc2U7XG4gIHByaXZhdGUgYnVmZmVyZWQ6IE1lc3NhZ2VbXSA9IFtdO1xuICAvKiogU2luZ2xlIG91dHN0YW5kaW5nIHJlcXVlc3QgZXhwZWN0YXRpb24gKG9wcyBhcmUgc2VyaWFsaXplZCkuICovXG4gIHByaXZhdGUgZXhwZWN0YXRpb246IHtcbiAgICBtYXRjaGVzOiAobWVzc2FnZTogTWVzc2FnZSkgPT4gYm9vbGVhbjtcbiAgICByZXNvbHZlOiAobWVzc2FnZTogTWVzc2FnZSkgPT4gdm9pZDtcbiAgICByZWplY3Q6IChlcnJvcjogRXJyb3IpID0+IHZvaWQ7XG4gIH0gfCBudWxsID0gbnVsbDtcblxuICBjb25zdHJ1Y3RvcihvcHRpb25zOiBTeW5jQ2xpZW50T3B0aW9ucykge1xuICAgIHRoaXMub3B0aW9ucyA9IG9wdGlvbnM7XG4gICAgdGhpcy5sb2cgPSBvcHRpb25zLmxvZyA/PyBkZWZhdWx0TG9nO1xuICAgIHRoaXMubm93ID0gb3B0aW9ucy5ub3cgPz8gKCgpID0+IERhdGUubm93KCkpO1xuICAgIHRoaXMuZGVib3VuY2VNcyA9IG9wdGlvbnMuZGVib3VuY2VNcyA/PyAzMDA7XG4gICAgdGhpcy5zY2hlZHVsZSA9IG9wdGlvbnMuc2NoZWR1bGUgPz8gZGVmYXVsdFNjaGVkdWxlO1xuICAgIHRoaXMuZGlhbFRyYW5zcG9ydCA9XG4gICAgICB0eXBlb2Ygb3B0aW9ucy50cmFuc3BvcnQgPT09ICdmdW5jdGlvbidcbiAgICAgICAgPyBvcHRpb25zLnRyYW5zcG9ydFxuICAgICAgICA6ICgpID0+IG9wdGlvbnMudHJhbnNwb3J0IGFzIFRyYW5zcG9ydDtcbiAgICB0aGlzLmlnbm9yZVNldHRpbmdzID0gb3B0aW9ucy5zZXR0aW5ncyA/PyB7IG9ic2lkaWFuU3luYzogZmFsc2UgfTtcbiAgfVxuXG4gIC8vIC0tLSBsaWZlY3ljbGUgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIC8qKiBSdW4gc3RhcnR1cCByZWNvbmNpbGlhdGlvbiBhbmQgZW50ZXIgbGl2ZSBtb2RlLiAqL1xuICBhc3luYyBjb25uZWN0KCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGF3YWl0IHRoaXMuZW5xdWV1ZSgoKSA9PiB0aGlzLnN0YXJ0dXAoKSk7XG4gIH1cblxuICAvKiogUmUtZGlhbCBhbmQgcmUtcnVuIHRoZSBmdWxsIHN0YXJ0dXAgcmVjb25jaWxpYXRpb24uICovXG4gIGFzeW5jIHJlY29ubmVjdCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBhd2FpdCB0aGlzLmVucXVldWUoYXN5bmMgKCkgPT4ge1xuICAgICAgdGhpcy50cmFuc3BvcnQ/LmNsb3NlKCk7XG4gICAgICB0aGlzLnRyYW5zcG9ydCA9IG51bGw7XG4gICAgICBhd2FpdCB0aGlzLnN0YXJ0dXAoKTtcbiAgICB9KTtcbiAgfVxuXG4gIGNsb3NlKCk6IHZvaWQge1xuICAgIHRoaXMuc3RvcFdhdGNoaW5nKCk7XG4gICAgdGhpcy5jYW5jZWxEZWJvdW5jZT8uKCk7XG4gICAgdGhpcy5jYW5jZWxEZWJvdW5jZSA9IG51bGw7XG4gICAgdGhpcy50cmFuc3BvcnQ/LmNsb3NlKCk7XG4gICAgdGhpcy50cmFuc3BvcnQgPSBudWxsO1xuICAgIHRoaXMuc3RhdGUgPSAnaWRsZSc7XG4gIH1cblxuICAvKiogQmVnaW4gZGVib3VuY2VkIHdhdGNoaW5nIChBUkNISVRFQ1RVUkUgXHUwMEE3OCBsaXZlIG9wZXJhdGlvbikuICovXG4gIHN0YXJ0V2F0Y2hpbmcod2F0Y2hBZGFwdGVyOiBXYXRjaEFkYXB0ZXIpOiB2b2lkIHtcbiAgICB0aGlzLnN0b3BXYXRjaGluZygpO1xuICAgIHRoaXMud2F0Y2hBZGFwdGVyID0gd2F0Y2hBZGFwdGVyO1xuICAgIHdhdGNoQWRhcHRlci5zdGFydCgoZXZlbnRzKSA9PiB0aGlzLm9uV2F0Y2hFdmVudHMoZXZlbnRzKSk7XG4gIH1cblxuICBzdG9wV2F0Y2hpbmcoKTogdm9pZCB7XG4gICAgdGhpcy53YXRjaEFkYXB0ZXI/LnN0b3AoKTtcbiAgICB0aGlzLndhdGNoQWRhcHRlciA9IG51bGw7XG4gIH1cblxuICAvKiogTWFudWFsIG9uZS1zaG90IGN5Y2xlIChgdnNhYCBvbmUtc2hvdCwgXCJzeW5jIG5vd1wiIGJ1dHRvbnMsIHRlc3RzKS4gKi9cbiAgYXN5bmMgdHJpZ2dlclN5bmMoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5lbnF1ZXVlKCgpID0+IHRoaXMucnVuQ3ljbGUoKSk7XG4gIH1cblxuICAvKiogUmVzb2x2ZXMgd2hlbiBldmVyeSBxdWV1ZWQgb3BlcmF0aW9uIGhhcyBzZXR0bGVkLiAqL1xuICBhc3luYyB3YWl0SWRsZSgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB3aGlsZSAodGhpcy5xdWV1ZWRPcHMgPiAwKSBhd2FpdCB0aGlzLnRhaWw7XG4gICAgYXdhaXQgdGhpcy50YWlsO1xuICB9XG5cbiAgc3RhdHVzKCk6IFN5bmNDbGllbnRTdGF0dXMge1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0ZTogdGhpcy5zdGF0ZSxcbiAgICAgIGxhc3RTeW5jQXQ6IHRoaXMubGFzdFN5bmNBdCxcbiAgICAgIHBlbmRpbmc6IHRoaXMucGVuZGluZyxcbiAgICAgIGNvbmZsaWN0czogWy4uLnRoaXMuY29uZmxpY3RzXSxcbiAgICB9O1xuICB9XG5cbiAgLyoqIFJlYWQtb25seSB2aWV3IG9mIHRoZSBsb2NhbCBpbmRleCAodGVzdHMsIGB2c2Egc3RhdHVzYCkuICovXG4gIGN1cnJlbnRJbmRleCgpOiBMb2NhbEluZGV4IHtcbiAgICByZXR1cm4geyAuLi50aGlzLmluZGV4IH07XG4gIH1cblxuICAvKiogTGFzdCBzZWVuIHNlcnZlciBzZXF1ZW5jZSBudW1iZXIuICovXG4gIGdldCBjdXJzb3JWYWx1ZSgpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLmN1cnNvcjtcbiAgfVxuXG4gIC8qKiBUUy1zYWZlIHN0YXRlIHByb2JlIChhc3NpZ25tZW50cyBpbnNpZGUgYXN5bmMgZmxvd3MgZGVmZWF0IG5hcnJvd2luZykuICovXG4gIHByaXZhdGUgaXNEaXNjb25uZWN0ZWQoKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIHRoaXMuc3RhdGUgPT09ICdkaXNjb25uZWN0ZWQnO1xuICB9XG5cbiAgLy8gLS0tIHN0YXJ0dXAgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIHByaXZhdGUgYXN5bmMgc3RhcnR1cCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLnN0YXRlID0gJ2Nvbm5lY3RpbmcnO1xuICAgIHRoaXMuYnVmZmVyaW5nID0gdHJ1ZTtcbiAgICB0aGlzLmJ1ZmZlcmVkID0gW107XG5cbiAgICB0aGlzLmluZGV4ID0gKGF3YWl0IHRoaXMuc2FmZVN0b3JhZ2VFeGlzdHMoTE9DQUxfSU5ERVhfU1RBVEVfUEFUSCkpXG4gICAgICA/IGF3YWl0IGxvYWRMb2NhbEluZGV4KHRoaXMub3B0aW9ucy5zdG9yYWdlKVxuICAgICAgOiB7fTtcblxuICAgIGNvbnN0IHRyYW5zcG9ydCA9IHRoaXMuZGlhbFRyYW5zcG9ydCgpO1xuICAgIHRoaXMudHJhbnNwb3J0ID0gdHJhbnNwb3J0O1xuICAgIHRyYW5zcG9ydC5vbk1lc3NhZ2UoKG1lc3NhZ2UpID0+IHRoaXMub25UcmFuc3BvcnRNZXNzYWdlKG1lc3NhZ2UpKTtcbiAgICB0cmFuc3BvcnQub25DbG9zZSgocmVhc29uKSA9PiB0aGlzLm9uVHJhbnNwb3J0Q2xvc2UocmVhc29uKSk7XG5cbiAgICBjb25zdCBoZWxsb0FjayA9IGF3YWl0IHRoaXMucmVxdWVzdDxIZWxsb0Fja01lc3NhZ2UgfCBTZXJ2ZXJFcnJvck1lc3NhZ2U+KFxuICAgICAgKG0pID0+IG0udHlwZSA9PT0gJ2hlbGxvQWNrJyB8fCBtLnR5cGUgPT09ICdlcnJvcicsXG4gICAgICAoKSA9PlxuICAgICAgICB0cmFuc3BvcnQuc2VuZCh7XG4gICAgICAgICAgdHlwZTogJ2hlbGxvJyxcbiAgICAgICAgICB0b2tlbjogdGhpcy5vcHRpb25zLnRva2VuLFxuICAgICAgICAgIHByb3RvY29sVmVyc2lvbjogUHJvdG9jb2xWZXJzaW9uLFxuICAgICAgICAgIGN1cnNvcjogdGhpcy5jdXJzb3IsXG4gICAgICAgIH0pLFxuICAgICk7XG4gICAgaWYgKGhlbGxvQWNrLnR5cGUgPT09ICdlcnJvcicpIHRocm93IHRoaXMudG9FcnJvcihoZWxsb0Fjayk7XG4gICAgdGhpcy5pZ25vcmVTZXR0aW5ncyA9IHsgb2JzaWRpYW5TeW5jOiBoZWxsb0Fjay5zZXR0aW5ncy5vYnNpZGlhblN5bmMgfTtcblxuICAgIHRoaXMuc3RhdGUgPSAnc3luY2luZyc7XG4gICAgYXdhaXQgdGhpcy5ydW5DeWNsZSgpO1xuXG4gICAgdGhpcy5idWZmZXJpbmcgPSBmYWxzZTtcbiAgICBjb25zdCBidWZmZXJlZCA9IHRoaXMuYnVmZmVyZWQ7XG4gICAgdGhpcy5idWZmZXJlZCA9IFtdO1xuICAgIGZvciAoY29uc3QgbWVzc2FnZSBvZiBidWZmZXJlZCkge1xuICAgICAgYXdhaXQgdGhpcy5kaXNwYXRjaChtZXNzYWdlKTtcbiAgICB9XG4gICAgaWYgKCF0aGlzLmlzRGlzY29ubmVjdGVkKCkpIHRoaXMuc3RhdGUgPSAnbGl2ZSc7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHNhZmVTdG9yYWdlRXhpc3RzKHBhdGg6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5vcHRpb25zLnN0b3JhZ2UuZXhpc3RzKHBhdGgpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgb25UcmFuc3BvcnRDbG9zZShyZWFzb246IHsgY29kZT86IG51bWJlcjsgcmVhc29uPzogc3RyaW5nIH0pOiB2b2lkIHtcbiAgICB0aGlzLmxvZy53YXJuKCd0cmFuc3BvcnQgY2xvc2VkJywgcmVhc29uKTtcbiAgICB0aGlzLnN0YXRlID0gJ2Rpc2Nvbm5lY3RlZCc7XG4gICAgY29uc3QgZXhwZWN0YXRpb24gPSB0aGlzLmV4cGVjdGF0aW9uO1xuICAgIGlmIChleHBlY3RhdGlvbiAhPT0gbnVsbCkge1xuICAgICAgdGhpcy5leHBlY3RhdGlvbiA9IG51bGw7XG4gICAgICBleHBlY3RhdGlvbi5yZWplY3QoXG4gICAgICAgIG5ldyBOZXR3b3JrRXJyb3IoYGNvbm5lY3Rpb24gY2xvc2VkOiAke3JlYXNvbi5yZWFzb24gPz8gcmVhc29uLmNvZGUgPz8gJ3Vua25vd24nfWApLFxuICAgICAgKTtcbiAgICB9XG4gIH1cblxuICAvLyAtLS0gbWVzc2FnZSBwdW1wIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICBwcml2YXRlIG9uVHJhbnNwb3J0TWVzc2FnZSA9IChtZXNzYWdlOiBNZXNzYWdlKTogdm9pZCA9PiB7XG4gICAgY29uc3QgZXhwZWN0YXRpb24gPSB0aGlzLmV4cGVjdGF0aW9uO1xuICAgIGlmIChleHBlY3RhdGlvbiAhPT0gbnVsbCAmJiBleHBlY3RhdGlvbi5tYXRjaGVzKG1lc3NhZ2UpKSB7XG4gICAgICB0aGlzLmV4cGVjdGF0aW9uID0gbnVsbDtcbiAgICAgIGV4cGVjdGF0aW9uLnJlc29sdmUobWVzc2FnZSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGlmICh0aGlzLmJ1ZmZlcmluZykge1xuICAgICAgdGhpcy5idWZmZXJlZC5wdXNoKG1lc3NhZ2UpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB0aGlzLmVucXVldWUoYXN5bmMgKCkgPT4ge1xuICAgICAgYXdhaXQgdGhpcy5kaXNwYXRjaChtZXNzYWdlKTtcbiAgICB9KS5jYXRjaCgoZXJyb3I6IHVua25vd24pID0+IHRoaXMubG9nLndhcm4oJ2NoYW5nZSBoYW5kbGVyIGZhaWxlZCcsIGVycm9yKSk7XG4gIH07XG5cbiAgcHJpdmF0ZSBhc3luYyBkaXNwYXRjaChtZXNzYWdlOiBNZXNzYWdlKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgc3dpdGNoIChtZXNzYWdlLnR5cGUpIHtcbiAgICAgIGNhc2UgJ2NoYW5nZSc6XG4gICAgICAgIGF3YWl0IHRoaXMuaGFuZGxlQ2hhbmdlKG1lc3NhZ2UpO1xuICAgICAgICByZXR1cm47XG4gICAgICBjYXNlICdkZXZpY2VTZWVuJzpcbiAgICAgICAgcmV0dXJuOyAvLyBwcmVzZW5jZSBvbmx5OyBkYXNoYm9hcmRzIGNvbnN1bWUgaXRcbiAgICAgIGNhc2UgJ3BvbmcnOlxuICAgICAgICByZXR1cm47XG4gICAgICBjYXNlICdlcnJvcic6XG4gICAgICAgIHRoaXMubG9nLmVycm9yKCdzZXJ2ZXIgZXJyb3InLCBtZXNzYWdlLmNvZGUsIG1lc3NhZ2UubWVzc2FnZSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIGNhc2UgJ2hlbGxvQWNrJzpcbiAgICAgIGNhc2UgJ21hbmlmZXN0JzpcbiAgICAgIGNhc2UgJ2NvbW1pdEFjayc6XG4gICAgICBjYXNlICdjb25mbGljdCc6XG4gICAgICBjYXNlICdibG9iJzpcbiAgICAgIGNhc2UgJ2Jsb2JBY2snOlxuICAgICAgICAvLyBSZXBsaWVzIGFycml2ZSBvbmx5IGFnYWluc3QgYW4gb3V0c3RhbmRpbmcgZXhwZWN0YXRpb247IGFcbiAgICAgICAgLy8gc3BvbnRhbmVvdXMgb25lIGlzIGEgcHJvdG9jb2wgdmlvbGF0aW9uIHdlIGxvZyBhbmQgZHJvcC5cbiAgICAgICAgdGhpcy5sb2cud2FybigndW5leHBlY3RlZCBzZXJ2ZXIgcmVwbHknLCBtZXNzYWdlLnR5cGUpO1xuICAgICAgICByZXR1cm47XG4gICAgICBkZWZhdWx0OlxuICAgICAgICB0aGlzLmxvZy53YXJuKCdpZ25vcmluZyBjbGllbnQtdG8tc2VydmVyIG1lc3NhZ2UgZnJvbSBzZXJ2ZXInLCBtZXNzYWdlKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGhhbmRsZUNoYW5nZShjaGFuZ2U6IENoYW5nZU1lc3NhZ2UpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoY2hhbmdlLnNlcSA+IHRoaXMuY3Vyc29yKSB0aGlzLmN1cnNvciA9IGNoYW5nZS5zZXE7XG4gICAgaWYgKGlzSWdub3JlZChjaGFuZ2UucGF0aCwgdGhpcy5pZ25vcmVTZXR0aW5ncykpIHJldHVybjtcbiAgICBpZiAoY2hhbmdlLmZyb21QYXRoICE9PSB1bmRlZmluZWQgJiYgaXNJZ25vcmVkKGNoYW5nZS5mcm9tUGF0aCwgdGhpcy5pZ25vcmVTZXR0aW5ncykpIHJldHVybjtcblxuICAgIC8vIFN0YWxlIHJlcGxheSAvIGR1cGxpY2F0ZSBmYW4tb3V0OiBwZXIgcGF0aCB0aGUgaGVhZCBjbG9jayBkb21pbmF0ZXNcbiAgICAvLyBldmVyeSBlYXJsaWVyIHZlcnNpb24sIHNvIGFueXRoaW5nIFx1MjI2NCB0aGUgcmVjb3JkZWQgY2xvY2sgaXMgb2xkIG5ld3MuXG4gICAgY29uc3QgZW50cnkgPSB0aGlzLmluZGV4W2NoYW5nZS5wYXRoXTtcbiAgICBpZiAoZW50cnkgIT09IHVuZGVmaW5lZCkge1xuICAgICAgaWYgKGVudHJ5LnZlcnNpb25JZCA9PT0gY2hhbmdlLnZlcnNpb24pIHJldHVybjtcbiAgICAgIGlmIChjb21wYXJlQ2xvY2tzKGVudHJ5LmNsb2NrLCBjaGFuZ2UuY2xvY2spID49IDApIHJldHVybjtcbiAgICB9XG5cbiAgICAvLyBUaGUgZ3VhcmQ6IG5ldmVyIHdyaXRlIGEgcmVtb3RlIGNoYW5nZSBvdmVyIGxvY2FsbHktZGl2ZXJnZWQgY29udGVudC5cbiAgICBpZiAoIShhd2FpdCB0aGlzLmNoYW5nZUlzU2FmZShjaGFuZ2UpKSkge1xuICAgICAgdGhpcy5sb2cuaW5mbygnZGVmZXJyaW5nIHJlbW90ZSBjaGFuZ2Ugb3ZlciBsb2NhbCBkaXZlcmdlbmNlJywgY2hhbmdlLnBhdGgpO1xuICAgICAgdGhpcy5zY2hlZHVsZVJlY29uY2lsZSgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRoaXMuaW5kZXggPSBhd2FpdCB0aGlzLmFwcGx5UHVsbHMoW3RoaXMucHVsbE9wRnJvbUNoYW5nZShjaGFuZ2UpXSk7XG4gIH1cblxuICAvKipcbiAgICogQSBjaGFuZ2UgbWF5IGJlIGFwcGxpZWQgZGlyZWN0bHkgb25seSB3aGVuIHRoZSB0b3VjaGVkIHBhdGhzIGNhcnJ5IG5vXG4gICAqIHVuLXJlY29uY2lsZWQgbG9jYWwgY29udGVudC4gQW55dGhpbmcgZWxzZSBtdXN0IGRldG91ciB0aHJvdWdoIGEgZnVsbFxuICAgKiBgY29tcHV0ZVN5bmNQbGFuYCBjeWNsZSAoY29uZmxpY3QgbG9naWMsIGNvbmZsaWN0IGNvcGllcykuXG4gICAqL1xuICBwcml2YXRlIGFzeW5jIGNoYW5nZUlzU2FmZShjaGFuZ2U6IENoYW5nZU1lc3NhZ2UpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBpZiAoY2hhbmdlLmlzRm9sZGVyID09PSB0cnVlKSByZXR1cm4gdHJ1ZTtcbiAgICBpZiAoY2hhbmdlLmtpbmQgPT09ICdyZW5hbWUnICYmIGNoYW5nZS5mcm9tUGF0aCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICBpZiAoYXdhaXQgdGhpcy5wYXRoSGFzTG9jYWxEaXZlcmdlbmNlKGNoYW5nZS5mcm9tUGF0aCkpIHJldHVybiBmYWxzZTtcbiAgICAgIGlmIChhd2FpdCB0aGlzLnN0b3JhZ2VFeGlzdHMoY2hhbmdlLnBhdGgpKSB7XG4gICAgICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5pbmRleFtjaGFuZ2UucGF0aF07XG4gICAgICAgIGlmIChlbnRyeSA9PT0gdW5kZWZpbmVkIHx8IGVudHJ5LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkKSByZXR1cm4gZmFsc2U7XG4gICAgICAgIGNvbnN0IGFjdHVhbCA9IGF3YWl0IHNoYTI1NkhleChhd2FpdCB0aGlzLm9wdGlvbnMuc3RvcmFnZS5yZWFkRmlsZShjaGFuZ2UucGF0aCkpO1xuICAgICAgICBpZiAoYWN0dWFsICE9PSBlbnRyeS5oYXNoKSByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgcmV0dXJuICEoYXdhaXQgdGhpcy5wYXRoSGFzTG9jYWxEaXZlcmdlbmNlKGNoYW5nZS5wYXRoKSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHBhdGhIYXNMb2NhbERpdmVyZ2VuY2UocGF0aDogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgY29uc3QgZW50cnkgPSB0aGlzLmluZGV4W3BhdGhdO1xuICAgIGlmIChlbnRyeT8uaXNGb2xkZXIpIHJldHVybiBmYWxzZTtcbiAgICBpZiAoIShhd2FpdCB0aGlzLnN0b3JhZ2VFeGlzdHMocGF0aCkpKSByZXR1cm4gZmFsc2U7XG4gICAgaWYgKGVudHJ5ID09PSB1bmRlZmluZWQgfHwgZW50cnkuZGVsZXRlZEF0ICE9PSB1bmRlZmluZWQpIHJldHVybiB0cnVlO1xuICAgIGNvbnN0IGFjdHVhbCA9IGF3YWl0IHNoYTI1NkhleChhd2FpdCB0aGlzLm9wdGlvbnMuc3RvcmFnZS5yZWFkRmlsZShwYXRoKSk7XG4gICAgcmV0dXJuIGFjdHVhbCAhPT0gZW50cnkuaGFzaDtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgc3RvcmFnZUV4aXN0cyhwYXRoOiBzdHJpbmcpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGF3YWl0IHRoaXMub3B0aW9ucy5zdG9yYWdlLmV4aXN0cyhwYXRoKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHB1bGxPcEZyb21DaGFuZ2UoY2hhbmdlOiBDaGFuZ2VNZXNzYWdlKTogUHVsbE9wIHtcbiAgICBpZiAoY2hhbmdlLmtpbmQgPT09ICdyZW5hbWUnICYmIGNoYW5nZS5mcm9tUGF0aCAhPT0gdW5kZWZpbmVkKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBraW5kOiAncmVuYW1lJyxcbiAgICAgICAgZnJvbVBhdGg6IGNoYW5nZS5mcm9tUGF0aCxcbiAgICAgICAgdG9QYXRoOiBjaGFuZ2UucGF0aCxcbiAgICAgICAgaGFzaDogY2hhbmdlLmhhc2gsXG4gICAgICAgIHNpemU6IGNoYW5nZS5zaXplLFxuICAgICAgICB2ZXJzaW9uOiBjaGFuZ2UudmVyc2lvbixcbiAgICAgICAgY2xvY2s6IGNoYW5nZS5jbG9jayxcbiAgICAgIH07XG4gICAgfVxuICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5pbmRleFtjaGFuZ2UucGF0aF07XG4gICAgY29uc3Qga2luZDogUHVsbEZpbGVPcFsna2luZCddID0gY2hhbmdlLmRlbGV0ZWRcbiAgICAgID8gJ2RlbGV0ZSdcbiAgICAgIDogZW50cnkgPT09IHVuZGVmaW5lZFxuICAgICAgICA/ICdhZGQnXG4gICAgICAgIDogZW50cnkuZGVsZXRlZEF0ICE9PSB1bmRlZmluZWRcbiAgICAgICAgICA/ICdyZXN0b3JlJ1xuICAgICAgICAgIDogJ2VkaXQnO1xuICAgIHJldHVybiB7XG4gICAgICBraW5kLFxuICAgICAgcGF0aDogY2hhbmdlLnBhdGgsXG4gICAgICBoYXNoOiBjaGFuZ2UuaGFzaCxcbiAgICAgIHNpemU6IGNoYW5nZS5zaXplLFxuICAgICAgdmVyc2lvbjogY2hhbmdlLnZlcnNpb24sXG4gICAgICBjbG9jazogY2hhbmdlLmNsb2NrLFxuICAgICAgZGVsZXRlZDogY2hhbmdlLmRlbGV0ZWQsXG4gICAgICAuLi4oY2hhbmdlLmlzRm9sZGVyID09PSB0cnVlID8geyBpc0ZvbGRlcjogdHJ1ZSB9IDoge30pLFxuICAgIH07XG4gIH1cblxuICAvKiogTWF0ZXJpYWxpemUgcHVsbHMgdGhyb3VnaCB0aGUgdmVyaWZpZWQgZW5naW5lIHBhdGg7IHJldHVybnMgdGhlIG5ldyBpbmRleC4gKi9cbiAgcHJpdmF0ZSBhc3luYyBhcHBseVB1bGxzKHB1bGxzOiBSZWFkb25seUFycmF5PFB1bGxPcD4pOiBQcm9taXNlPExvY2FsSW5kZXg+IHtcbiAgICByZXR1cm4gYXBwbHlQdWxsKFxuICAgICAgdGhpcy5vcHRpb25zLnN0b3JhZ2UsXG4gICAgICB0aGlzLmluZGV4LFxuICAgICAgeyBwdXNoZXM6IFtdLCBwdWxsczogWy4uLnB1bGxzXSwgY29uZmxpY3RzOiBbXSwgZm9sZGVyUHVzaGVzOiBbXSB9LFxuICAgICAgdGhpcy5mZXRjaEJsb2IsXG4gICAgICB7IG5vdzogdGhpcy5ub3coKSB9LFxuICAgICk7XG4gIH1cblxuICAvLyAtLS0gd2F0Y2hlciAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICBwcml2YXRlIG9uV2F0Y2hFdmVudHMoZXZlbnRzOiBSZWFkb25seUFycmF5PHsgcGF0aDogc3RyaW5nIH0+KTogdm9pZCB7XG4gICAgY29uc3QgcmVsZXZhbnQgPSBldmVudHMuZmlsdGVyKChldmVudCkgPT4gIWlzSWdub3JlZChldmVudC5wYXRoLCB0aGlzLmlnbm9yZVNldHRpbmdzKSk7XG4gICAgaWYgKHJlbGV2YW50Lmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuICAgIHRoaXMucGVuZGluZyArPSByZWxldmFudC5sZW5ndGg7XG4gICAgdGhpcy5zY2hlZHVsZVJlY29uY2lsZSgpO1xuICB9XG5cbiAgLyoqIERlYm91bmNlZCBzY2FuXHUyMTkycGxhblx1MjE5MmV4ZWN1dGUgKHNoYXJlZCBieSB3YXRjaGVyIGFuZCBkZWZlcnJlZCBjaGFuZ2VzKS4gKi9cbiAgcHJpdmF0ZSBzY2hlZHVsZVJlY29uY2lsZSgpOiB2b2lkIHtcbiAgICB0aGlzLmNhbmNlbERlYm91bmNlPy4oKTtcbiAgICB0aGlzLmNhbmNlbERlYm91bmNlID0gdGhpcy5zY2hlZHVsZSgoKSA9PiB7XG4gICAgICB0aGlzLmNhbmNlbERlYm91bmNlID0gbnVsbDtcbiAgICAgIHRoaXMuZW5xdWV1ZSgoKSA9PiB0aGlzLnJ1bkN5Y2xlKCkpLmNhdGNoKChlcnJvcjogdW5rbm93bikgPT5cbiAgICAgICAgdGhpcy5sb2cud2FybignZGVib3VuY2VkIHN5bmMgY3ljbGUgZmFpbGVkJywgZXJyb3IpLFxuICAgICAgKTtcbiAgICB9LCB0aGlzLmRlYm91bmNlTXMpO1xuICB9XG5cbiAgLy8gLS0tIHRoZSBzeW5jIGN5Y2xlIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgcHJpdmF0ZSBhc3luYyBydW5DeWNsZSgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAodGhpcy50cmFuc3BvcnQgPT09IG51bGwgfHwgdGhpcy5pc0Rpc2Nvbm5lY3RlZCgpKSByZXR1cm47XG4gICAgdGhpcy5zdGF0ZSA9ICdzeW5jaW5nJztcbiAgICB0cnkge1xuICAgICAgY29uc3QgbWFuaWZlc3QgPSBhd2FpdCB0aGlzLmZldGNoTWFuaWZlc3QoKTtcbiAgICAgIGNvbnN0IGxvY2FsQ2hhbmdlcyA9IGF3YWl0IHNjYW5WYXVsdChcbiAgICAgICAgdGhpcy5vcHRpb25zLnN0b3JhZ2UsXG4gICAgICAgIHRoaXMuaW5kZXgsXG4gICAgICAgIHRoaXMuaWdub3JlU2V0dGluZ3MsXG4gICAgICAgIHRoaXMubm93KCksXG4gICAgICApO1xuICAgICAgY29uc3QgcGxhbiA9IGNvbXB1dGVTeW5jUGxhbih7XG4gICAgICAgIGxvY2FsQ2hhbmdlcyxcbiAgICAgICAgaW5kZXg6IHRoaXMuaW5kZXgsXG4gICAgICAgIG1hbmlmZXN0LFxuICAgICAgICB0aGlzRGV2aWNlSWQ6IHRoaXMub3B0aW9ucy5kZXZpY2VJZCxcbiAgICAgICAgdGhpc0RldmljZU5hbWU6IHRoaXMub3B0aW9ucy5kZXZpY2VOYW1lLFxuICAgICAgICBub3c6IHRoaXMubm93KCksXG4gICAgICB9KTtcbiAgICAgIHRoaXMuY29uZmxpY3RzID0gWy4uLnRoaXMuY29uZmxpY3RzLCAuLi5wbGFuLmNvbmZsaWN0c107XG5cbiAgICAgIC8vIFN0YWdlIHB1c2ggY29udGVudHMgQkVGT1JFIHB1bGxzIG92ZXJ3cml0ZSB0aGUgd29ya2luZyB0cmVlIChhXG4gICAgICAvLyBjb25mbGljdC1jb3B5IHB1c2ggcmVhZHMgdGhlIGxvc2VyIGNvbnRlbnQgZnJvbSB0aGUgb3JpZ2luYWwgcGF0aCkuXG4gICAgICBjb25zdCBzdGFnZWQgPSBhd2FpdCB0aGlzLnN0YWdlUHVzaGVzKHBsYW4sIGxvY2FsQ2hhbmdlcy5oYXNoZWQpO1xuXG4gICAgICB0aGlzLmluZGV4ID0gYXdhaXQgdGhpcy5hcHBseVB1bGxzKHBsYW4ucHVsbHMpO1xuXG4gICAgICBmb3IgKGNvbnN0IGNvbW1pdCBvZiBzdGFnZWQpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5zZW5kQ29tbWl0KGNvbW1pdCk7XG4gICAgICB9XG4gICAgICBmb3IgKGNvbnN0IHBhdGggb2YgcGxhbi5mb2xkZXJQdXNoZXMpIHtcbiAgICAgICAgYXdhaXQgdGhpcy5zZW5kQ29tbWl0KHtcbiAgICAgICAgICBraW5kOiAnZWRpdCcsXG4gICAgICAgICAgcGF0aCxcbiAgICAgICAgICBwYXJlbnRWZXJzaW9uOiB0aGlzLmluZGV4W3BhdGhdPy52ZXJzaW9uSWQgPz8gbnVsbCxcbiAgICAgICAgICBoYXNoOiAnJyxcbiAgICAgICAgICBzaXplOiAwLFxuICAgICAgICAgIGlzRm9sZGVyOiB0cnVlLFxuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgLy8gQ2FjaGUgdGhlIHNjYW4ncyBoYXNoIG9ic2VydmF0aW9ucyAobXRpbWUpIG9udG8gZW50cmllcyB3aG9zZSBoYXNoXG4gICAgICAvLyBzdGlsbCBtYXRjaGVzLCBzbyB0aGUgbmV4dCBmYXN0IHNjYW4gY2FuIHNraXAgdGhvc2UgZmlsZXMuIFJ1bnNcbiAgICAgIC8vIGFmdGVyIHB1bGxzL3B1c2hlcyBzbyBmcmVzaGx5LWFja2VkIGVudHJpZXMgYmVuZWZpdCBpbW1lZGlhdGVseTtcbiAgICAgIC8vIGByZWNvcmRIYXNoZWRGaWxlc2Agc2tpcHMgYW55dGhpbmcgdGhlIGN5Y2xlIGNoYW5nZWQgdW5kZXJuZWF0aCB1cy5cbiAgICAgIHRoaXMuaW5kZXggPSByZWNvcmRIYXNoZWRGaWxlcyh0aGlzLmluZGV4LCBsb2NhbENoYW5nZXMuaGFzaGVkKTtcblxuICAgICAgdGhpcy5sYXN0U3luY0F0ID0gdGhpcy5ub3coKTtcbiAgICAgIHRoaXMucGVuZGluZyA9IDA7XG4gICAgICBpZiAoIXRoaXMuaXNEaXNjb25uZWN0ZWQoKSkgdGhpcy5zdGF0ZSA9ICdsaXZlJztcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgdGhpcy5sb2cuZXJyb3IoJ3N5bmMgY3ljbGUgZmFpbGVkJywgZXJyb3IpO1xuICAgICAgaWYgKCF0aGlzLmlzRGlzY29ubmVjdGVkKCkpIHRoaXMuc3RhdGUgPSB0aGlzLnRyYW5zcG9ydCAhPT0gbnVsbCA/ICdsaXZlJyA6ICdpZGxlJztcbiAgICAgIHRocm93IGVycm9yO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgZmV0Y2hNYW5pZmVzdCgpOiBQcm9taXNlPFJlbW90ZUZpbGVbXT4ge1xuICAgIGNvbnN0IHRyYW5zcG9ydCA9IHRoaXMudHJhbnNwb3J0O1xuICAgIGlmICh0cmFuc3BvcnQgPT09IG51bGwpIHRocm93IG5ldyBOZXR3b3JrRXJyb3IoJ25vdCBjb25uZWN0ZWQnKTtcbiAgICBjb25zdCByZXBseSA9IGF3YWl0IHRoaXMucmVxdWVzdDxNYW5pZmVzdE1lc3NhZ2UgfCBTZXJ2ZXJFcnJvck1lc3NhZ2U+KFxuICAgICAgKG0pID0+IG0udHlwZSA9PT0gJ21hbmlmZXN0JyB8fCBtLnR5cGUgPT09ICdlcnJvcicsXG4gICAgICAoKSA9PiB0cmFuc3BvcnQuc2VuZCh7IHR5cGU6ICdnZXRNYW5pZmVzdCcgfSksXG4gICAgKTtcbiAgICBpZiAocmVwbHkudHlwZSA9PT0gJ2Vycm9yJykgdGhyb3cgdGhpcy50b0Vycm9yKHJlcGx5KTtcbiAgICBpZiAocmVwbHkuY3Vyc29yID4gdGhpcy5jdXJzb3IpIHRoaXMuY3Vyc29yID0gcmVwbHkuY3Vyc29yO1xuICAgIHJldHVybiBPYmplY3QudmFsdWVzKHJlcGx5LmVudHJpZXMpLm1hcCgoZW50cnkpID0+ICh7IC4uLmVudHJ5IH0pKTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgc3RhZ2VQdXNoZXMoXG4gICAgcGxhbjogU3luY1BsYW4sXG4gICAgaGFzaGVkOiByZWFkb25seSBIYXNoZWRGaWxlW10sXG4gICk6IFByb21pc2U8U3RhZ2VkQ29tbWl0W10+IHtcbiAgICAvLyBBIGNvbmZsaWN0LWNvcHkgcHVzaCBjYXJyaWVzIGNvbnRlbnQgcmVhZCBmcm9tIHRoZSAqb3JpZ2luYWwqIHBhdGguXG4gICAgY29uc3QgY29weVNvdXJjZXMgPSBuZXcgTWFwPHN0cmluZywgc3RyaW5nPigpO1xuICAgIGZvciAoY29uc3QgY29uZmxpY3Qgb2YgcGxhbi5jb25mbGljdHMpIHtcbiAgICAgIGlmIChjb25mbGljdC5jb25mbGljdENvcHlQYXRoICE9PSB1bmRlZmluZWQpIHtcbiAgICAgICAgY29weVNvdXJjZXMuc2V0KGNvbmZsaWN0LmNvbmZsaWN0Q29weVBhdGgsIGNvbmZsaWN0LnBhdGgpO1xuICAgICAgfVxuICAgIH1cbiAgICAvLyBIYXNoLXRpbWUgc3RhdHMgYnkgcGF0aDogcGlubmluZyB0aGVzZSBvbnRvIHRoZSBhY2tlZCBlbnRyaWVzIChiZWxvdylcbiAgICAvLyBrZWVwcyB0aGUgZmFzdC1wYXRoIGNhY2hlIGhvbmVzdCBcdTIwMTQgc2VlIGBTdGFnZWRDb21taXQubXRpbWVgLlxuICAgIGNvbnN0IGhhc2hUaW1lTXRpbWUgPSBuZXcgTWFwKGhhc2hlZC5tYXAoKG9ic2VydmVkKSA9PiBbb2JzZXJ2ZWQucGF0aCwgb2JzZXJ2ZWQubXRpbWVdKSk7XG5cbiAgICBjb25zdCBzdGFnZWQ6IFN0YWdlZENvbW1pdFtdID0gW107XG4gICAgZm9yIChjb25zdCBwdXNoIG9mIHBsYW4ucHVzaGVzKSB7XG4gICAgICBpZiAocHVzaC5raW5kID09PSAnZGVsZXRlJyB8fCBwdXNoLmtpbmQgPT09ICdyZW5hbWUnKSB7XG4gICAgICAgIHN0YWdlZC5wdXNoKHRoaXMudG9TdGFnZWQocHVzaCkpO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGNvbnN0IHNvdXJjZVBhdGggPVxuICAgICAgICBwdXNoLmtpbmQgPT09ICdjb25mbGljdENvcHknID8gY29weVNvdXJjZXMuZ2V0KHB1c2gucGF0aCkgPz8gcHVzaC5wYXRoIDogcHVzaC5wYXRoO1xuICAgICAgY29uc3QgYnl0ZXMgPSBhd2FpdCB0aGlzLnJlYWRMb2NhbChzb3VyY2VQYXRoKTtcbiAgICAgIGlmIChieXRlcyA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgIHRoaXMubG9nLndhcm4oJ3B1c2ggc291cmNlIHZhbmlzaGVkIHNpbmNlIHNjYW47IGRlZmVycmluZycsIHB1c2gucGF0aCk7XG4gICAgICAgIHRoaXMuc2NoZWR1bGVSZWNvbmNpbGUoKTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBjb25zdCBoYXNoID0gYXdhaXQgc2hhMjU2SGV4KGJ5dGVzKTtcbiAgICAgIGlmIChoYXNoICE9PSBwdXNoLmhhc2ggfHwgYnl0ZXMuYnl0ZUxlbmd0aCAhPT0gcHVzaC5zaXplKSB7XG4gICAgICAgIHRoaXMubG9nLndhcm4oJ2xvY2FsIGNvbnRlbnQgZHJpZnRlZCBzaW5jZSBzY2FuOyBkZWZlcnJpbmcgcHVzaCcsIHB1c2gucGF0aCk7XG4gICAgICAgIHRoaXMuc2NoZWR1bGVSZWNvbmNpbGUoKTtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAocHVzaC5raW5kID09PSAnY29uZmxpY3RDb3B5Jykge1xuICAgICAgICAvLyBNYXRlcmlhbGl6ZSB0aGUgY29weSBsb2NhbGx5IE5PVywgYmVmb3JlIHRoZSBwdWxscyBvdmVyd3JpdGUgdGhlXG4gICAgICAgIC8vIG9yaWdpbmFsOiB0aGUgc2VydmVyIGJyb2FkY2FzdHMgdGhlIGNvcHkgdG8gKm90aGVyKiBjbGllbnRzIG9ubHksXG4gICAgICAgIC8vIHNvIHRoaXMgZGV2aWNlIG11c3Qgd3JpdGUgaXRzIG93biBjb3B5IGl0c2VsZi4gVGhlIGNvcHkgbGFuZHMgYXQgYVxuICAgICAgICAvLyBORVcgcGF0aCB3aG9zZSBvbi1kaXNrIHN0YXQgZGlmZmVycyBmcm9tIHRoZSBzb3VyY2UncyBcdTIwMTQgbm8gaGFzaC10aW1lXG4gICAgICAgIC8vIHN0YXQgdG8gcGluLCB0aGUgbmV4dCBzY2FuIHJlY29yZHMgb25lLlxuICAgICAgICBhd2FpdCB0aGlzLm9wdGlvbnMuc3RvcmFnZS53cml0ZUZpbGUocHVzaC5wYXRoLCBieXRlcyk7XG4gICAgICAgIHN0YWdlZC5wdXNoKHsgLi4udGhpcy50b1N0YWdlZChwdXNoKSwgYnl0ZXMgfSk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgc3RhZ2VkLnB1c2goe1xuICAgICAgICAuLi50aGlzLnRvU3RhZ2VkKHB1c2gpLFxuICAgICAgICBieXRlcyxcbiAgICAgICAgLi4uKGhhc2hUaW1lTXRpbWUuZ2V0KHNvdXJjZVBhdGgpICE9PSB1bmRlZmluZWRcbiAgICAgICAgICA/IHsgbXRpbWU6IGhhc2hUaW1lTXRpbWUuZ2V0KHNvdXJjZVBhdGgpIH1cbiAgICAgICAgICA6IHt9KSxcbiAgICAgIH0pO1xuICAgIH1cbiAgICByZXR1cm4gc3RhZ2VkO1xuICB9XG5cbiAgcHJpdmF0ZSB0b1N0YWdlZChwdXNoOiBQdXNoT3ApOiBTdGFnZWRDb21taXQge1xuICAgIGlmIChwdXNoLmtpbmQgPT09ICdyZW5hbWUnKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBraW5kOiAncmVuYW1lJyxcbiAgICAgICAgcGF0aDogcHVzaC50b1BhdGgsXG4gICAgICAgIHBhcmVudFZlcnNpb246IHB1c2gucGFyZW50VmVyc2lvbixcbiAgICAgICAgaGFzaDogcHVzaC5oYXNoLFxuICAgICAgICBzaXplOiBwdXNoLnNpemUsXG4gICAgICAgIGZyb21QYXRoOiBwdXNoLmZyb21QYXRoLFxuICAgICAgfTtcbiAgICB9XG4gICAgcmV0dXJuIHtcbiAgICAgIGtpbmQ6IHB1c2gua2luZCA9PT0gJ2FkZCcgPyAnZWRpdCcgOiBwdXNoLmtpbmQsXG4gICAgICBwYXRoOiBwdXNoLnBhdGgsXG4gICAgICBwYXJlbnRWZXJzaW9uOiBwdXNoLnBhcmVudFZlcnNpb24sXG4gICAgICBoYXNoOiBwdXNoLmhhc2gsXG4gICAgICBzaXplOiBwdXNoLnNpemUsXG4gICAgfTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVhZExvY2FsKHBhdGg6IHN0cmluZyk6IFByb21pc2U8VWludDhBcnJheSB8IHVuZGVmaW5lZD4ge1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5vcHRpb25zLnN0b3JhZ2UucmVhZEZpbGUocGF0aCk7XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgc2VuZENvbW1pdChjb21taXQ6IFN0YWdlZENvbW1pdCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHRyYW5zcG9ydCA9IHRoaXMudHJhbnNwb3J0O1xuICAgIGlmICh0cmFuc3BvcnQgPT09IG51bGwpIHRocm93IG5ldyBOZXR3b3JrRXJyb3IoJ25vdCBjb25uZWN0ZWQnKTtcblxuICAgIGNvbnN0IG1lc3NhZ2U6IENvbW1pdE1lc3NhZ2UgPSB7XG4gICAgICB0eXBlOiAnY29tbWl0JyxcbiAgICAgIHBhdGg6IGNvbW1pdC5wYXRoLFxuICAgICAgcGFyZW50VmVyc2lvbjogY29tbWl0LnBhcmVudFZlcnNpb24sXG4gICAgICBoYXNoOiBjb21taXQuaGFzaCxcbiAgICAgIHNpemU6IGNvbW1pdC5zaXplLFxuICAgICAga2luZDogY29tbWl0LmtpbmQsXG4gICAgICAuLi4oY29tbWl0LmZyb21QYXRoICE9PSB1bmRlZmluZWQgPyB7IGZyb21QYXRoOiBjb21taXQuZnJvbVBhdGggfSA6IHt9KSxcbiAgICAgIC4uLihjb21taXQuaXNGb2xkZXIgPT09IHRydWUgPyB7IGlzRm9sZGVyOiB0cnVlIH0gOiB7fSksXG4gICAgICAuLi4oY29tbWl0LmJ5dGVzICE9PSB1bmRlZmluZWQgJiYgY29tbWl0LmJ5dGVzLmJ5dGVMZW5ndGggPD0gSU5MSU5FX0NPTlRFTlRfTUFYX0JZVEVTXG4gICAgICAgID8geyBpbmxpbmU6IGJ5dGVzVG9CYXNlNjQoY29tbWl0LmJ5dGVzKSB9XG4gICAgICAgIDoge30pLFxuICAgIH07XG5cbiAgICAvLyBBdHRhY2htZW50cyBhYm92ZSB0aGUgaW5saW5lIGNhcCByaWRlIHRoZSBibG9iIHN0b3JlIChGUi04KS5cbiAgICBpZiAoY29tbWl0LmJ5dGVzICE9PSB1bmRlZmluZWQgJiYgY29tbWl0LmJ5dGVzLmJ5dGVMZW5ndGggPiBJTkxJTkVfQ09OVEVOVF9NQVhfQllURVMpIHtcbiAgICAgIGF3YWl0IHRoaXMudXBsb2FkQmxvYihjb21taXQuaGFzaCwgY29tbWl0LmJ5dGVzKTtcbiAgICB9XG5cbiAgICBjb25zdCByZXBseSA9IGF3YWl0IHRoaXMucmVxdWVzdDxDb21taXRBY2tNZXNzYWdlIHwgQ29uZmxpY3RNZXNzYWdlIHwgU2VydmVyRXJyb3JNZXNzYWdlPihcbiAgICAgIChtKSA9PiBtLnR5cGUgPT09ICdjb21taXRBY2snIHx8IG0udHlwZSA9PT0gJ2NvbmZsaWN0JyB8fCBtLnR5cGUgPT09ICdlcnJvcicsXG4gICAgICAoKSA9PiB0cmFuc3BvcnQuc2VuZChtZXNzYWdlKSxcbiAgICApO1xuICAgIGlmIChyZXBseS50eXBlID09PSAnZXJyb3InKSB0aHJvdyB0aGlzLnRvRXJyb3IocmVwbHkpO1xuXG4gICAgaWYgKHJlcGx5LnR5cGUgPT09ICdjb21taXRBY2snKSB7XG4gICAgICBpZiAocmVwbHkuc2VxID4gdGhpcy5jdXJzb3IpIHRoaXMuY3Vyc29yID0gcmVwbHkuc2VxO1xuICAgICAgdGhpcy5hcHBseUFja1RvSW5kZXgoY29tbWl0LCByZXBseS52ZXJzaW9uLCByZXBseS5jbG9jayk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGF3YWl0IHRoaXMuaGFuZGxlQ29uZmxpY3RSZXBseShjb21taXQsIHJlcGx5KTtcbiAgfVxuXG4gIHByaXZhdGUgYXBwbHlBY2tUb0luZGV4KGNvbW1pdDogU3RhZ2VkQ29tbWl0LCB2ZXJzaW9uSWQ6IHN0cmluZywgY2xvY2s6IExvZ2ljYWxDbG9jayk6IHZvaWQge1xuICAgIGNvbnN0IGRlbGV0ZWQgPSBjb21taXQua2luZCA9PT0gJ2RlbGV0ZSc7XG4gICAgaWYgKGNvbW1pdC5raW5kID09PSAncmVuYW1lJyAmJiBjb21taXQuZnJvbVBhdGggIT09IHVuZGVmaW5lZCkge1xuICAgICAgdGhpcy5pbmRleCA9IGFwcGx5Q29tbWl0KHJlbW92ZUVudHJ5KHRoaXMuaW5kZXgsIGNvbW1pdC5mcm9tUGF0aCksIHtcbiAgICAgICAgcGF0aDogY29tbWl0LnBhdGgsXG4gICAgICAgIHZlcnNpb25JZCxcbiAgICAgICAgaGFzaDogY29tbWl0Lmhhc2gsXG4gICAgICAgIHNpemU6IGNvbW1pdC5zaXplLFxuICAgICAgICBjbG9jayxcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICAvLyBgY29tbWl0Lm10aW1lYCBpcyB0aGUgc3RhdCBvYnNlcnZlZCBhdCBIQVNIIHRpbWUgZm9yIHRoaXMgZXhhY3QgY29udGVudFxuICAgIC8vICh0aHJlYWRlZCB0aHJvdWdoIGBzdGFnZVB1c2hlc2ApLCBuZXZlciBhIHN0YXQgdGFrZW4gYXQgYWNrIHRpbWUgXHUyMDE0IGFuXG4gICAgLy8gZWRpdCB0aGF0IGxhbmRlZCBiZXR3ZWVuIGhhc2hpbmcgYW5kIHRoaXMgYWNrIGNoYW5nZWQgdGhlIGRpc2sgc3RhdCwgc29cbiAgICAvLyB0aGUgbmV4dCBzY2FuIG1pc3NlcyB0aGUgZmFzdCBwYXRoIGFuZCByZS1oYXNoZXMvcHVzaGVzIHRoZSBlZGl0LlxuICAgIHRoaXMuaW5kZXggPSBhcHBseUNvbW1pdCh0aGlzLmluZGV4LCB7XG4gICAgICBwYXRoOiBjb21taXQucGF0aCxcbiAgICAgIHZlcnNpb25JZCxcbiAgICAgIGhhc2g6IGNvbW1pdC5oYXNoLFxuICAgICAgc2l6ZTogY29tbWl0LnNpemUsXG4gICAgICBjbG9jayxcbiAgICAgIGRlbGV0ZWQsXG4gICAgICBkZWxldGVkQXQ6IGRlbGV0ZWQgPyB0aGlzLm5vdygpIDogdW5kZWZpbmVkLFxuICAgICAgLi4uKGNvbW1pdC5pc0ZvbGRlciA9PT0gdHJ1ZSA/IHsgaXNGb2xkZXI6IHRydWUgfSA6IHt9KSxcbiAgICAgIC4uLihjb21taXQubXRpbWUgIT09IHVuZGVmaW5lZCA/IHsgbXRpbWU6IGNvbW1pdC5tdGltZSB9IDoge30pLFxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBoYW5kbGVDb25mbGljdFJlcGx5KFxuICAgIGNvbW1pdDogU3RhZ2VkQ29tbWl0LFxuICAgIHJlcGx5OiBDb25mbGljdE1lc3NhZ2UsXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGlmIChyZXBseS5zZXEgIT09IHVuZGVmaW5lZCAmJiByZXBseS5zZXEgPiB0aGlzLmN1cnNvcikgdGhpcy5jdXJzb3IgPSByZXBseS5zZXE7XG4gICAgY29uc3Qgd2VXb24gPVxuICAgICAgcmVwbHkud2lubmVyLmRldmljZUlkID09PSB0aGlzLm9wdGlvbnMuZGV2aWNlSWQgJiYgcmVwbHkud2lubmVyLmhhc2ggPT09IGNvbW1pdC5oYXNoO1xuICAgIGlmICh3ZVdvbikge1xuICAgICAgdGhpcy5hcHBseUFja1RvSW5kZXgoY29tbWl0LCByZXBseS53aW5uZXIuaWQsIHJlcGx5Lndpbm5lci5jbG9jayk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgLy8gV2UgbG9zdCB0aGUgcmFjZS4gTWF0ZXJpYWxpemUgdGhlIHdpbm5lciBkaXJlY3RseSBcdTIwMTQgdGhlIHNlcnZlciBoYXNcbiAgICAvLyBhbHJlYWR5IHByZXNlcnZlZCBvdXIgY29udGVudCBhcyBhIGNvbmZsaWN0IGNvcHkgKGlmIGl0IHdhcyBkaXN0aW5jdCkuXG4gICAgLy8gT25lIGNhdmVhdDogaWYgdGhlIHdvcmtpbmcgdHJlZSBtb3ZlZCBvbiBBR0FJTiBzaW5jZSB3ZSBzdGFnZWQgdGhpc1xuICAgIC8vIGNvbW1pdCwgZG8gbm90IGNsb2JiZXIgaXQgZWl0aGVyIFx1MjAxNCBoYW5kIHRoZSB3aG9sZSB0aGluZyB0byBhIGN5Y2xlLlxuICAgIGlmIChjb21taXQua2luZCAhPT0gJ2RlbGV0ZScgJiYgY29tbWl0LmtpbmQgIT09ICdyZW5hbWUnICYmIGNvbW1pdC5pc0ZvbGRlciAhPT0gdHJ1ZSkge1xuICAgICAgY29uc3QgbG9jYWwgPSBhd2FpdCB0aGlzLnJlYWRMb2NhbChjb21taXQucGF0aCk7XG4gICAgICBpZiAobG9jYWwgIT09IHVuZGVmaW5lZCAmJiAoYXdhaXQgc2hhMjU2SGV4KGxvY2FsKSkgIT09IGNvbW1pdC5oYXNoKSB7XG4gICAgICAgIHRoaXMuc2NoZWR1bGVSZWNvbmNpbGUoKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChjb21taXQua2luZCA9PT0gJ3JlbmFtZScgJiYgY29tbWl0LmZyb21QYXRoICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIC8vIE91ciByZW5hbWUgbG9zdDogdGhlIGZpbGUgc3RheXMgd2hlcmUgdGhlIHdpbm5lciBrZWVwcyBpdDsgcmVjb3JkXG4gICAgICAvLyB0aGUgd2lubmVyIGhlYWQgZm9yIHRoZSBkZXN0aW5hdGlvbiAodGhlIHNvdXJjZSBwYXRoIGlzIHVudG91Y2hlZCkuXG4gICAgICB0aGlzLmluZGV4ID0gYXBwbHlDb21taXQodGhpcy5pbmRleCwge1xuICAgICAgICBwYXRoOiByZXBseS53aW5uZXIucGF0aCxcbiAgICAgICAgdmVyc2lvbklkOiByZXBseS53aW5uZXIuaWQsXG4gICAgICAgIGhhc2g6IHJlcGx5Lndpbm5lci5oYXNoLFxuICAgICAgICBzaXplOiByZXBseS53aW5uZXIuc2l6ZSxcbiAgICAgICAgY2xvY2s6IHJlcGx5Lndpbm5lci5jbG9jayxcbiAgICAgIH0pO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRoaXMuaW5kZXggPSBhd2FpdCB0aGlzLmFwcGx5UHVsbHMoW3RoaXMud2lubmVyQXNQdWxsKHJlcGx5Lndpbm5lcildKTtcbiAgfVxuXG4gIC8qKiBUdXJuIGFuIGFyYml0cmF0ZWQgd2lubmVyIHZlcnNpb24gaW50byBhIHB1bGwgb3AgKGNvbnRlbnQgb3BzIG9ubHkpLiAqL1xuICBwcml2YXRlIHdpbm5lckFzUHVsbCh3aW5uZXI6IHtcbiAgICBwYXRoOiBzdHJpbmc7XG4gICAgaWQ6IHN0cmluZztcbiAgICBoYXNoOiBzdHJpbmc7XG4gICAgc2l6ZTogbnVtYmVyO1xuICAgIGRldmljZUlkOiBzdHJpbmc7XG4gICAgY2xvY2s6IExvZ2ljYWxDbG9jaztcbiAgICBraW5kOiBDb21taXRNZXNzYWdlWydraW5kJ107XG4gIH0pOiBQdWxsT3Age1xuICAgIGNvbnN0IGVudHJ5ID0gdGhpcy5pbmRleFt3aW5uZXIucGF0aF07XG4gICAgY29uc3QgZGVsZXRlZCA9IHdpbm5lci5raW5kID09PSAnZGVsZXRlJztcbiAgICBjb25zdCBraW5kOiBQdWxsRmlsZU9wWydraW5kJ10gPSBkZWxldGVkXG4gICAgICA/ICdkZWxldGUnXG4gICAgICA6IGVudHJ5ID09PSB1bmRlZmluZWRcbiAgICAgICAgPyAnYWRkJ1xuICAgICAgICA6IGVudHJ5LmRlbGV0ZWRBdCAhPT0gdW5kZWZpbmVkXG4gICAgICAgICAgPyAncmVzdG9yZSdcbiAgICAgICAgICA6ICdlZGl0JztcbiAgICByZXR1cm4ge1xuICAgICAga2luZCxcbiAgICAgIHBhdGg6IHdpbm5lci5wYXRoLFxuICAgICAgaGFzaDogd2lubmVyLmhhc2gsXG4gICAgICBzaXplOiB3aW5uZXIuc2l6ZSxcbiAgICAgIHZlcnNpb246IHdpbm5lci5pZCxcbiAgICAgIGNsb2NrOiB3aW5uZXIuY2xvY2ssXG4gICAgICBkZWxldGVkLFxuICAgIH07XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHVwbG9hZEJsb2IoaGFzaDogc3RyaW5nLCBieXRlczogVWludDhBcnJheSk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHRyYW5zcG9ydCA9IHRoaXMudHJhbnNwb3J0O1xuICAgIGlmICh0cmFuc3BvcnQgPT09IG51bGwpIHRocm93IG5ldyBOZXR3b3JrRXJyb3IoJ25vdCBjb25uZWN0ZWQnKTtcbiAgICBjb25zdCByZXBseSA9IGF3YWl0IHRoaXMucmVxdWVzdDxCbG9iQWNrTWVzc2FnZSB8IFNlcnZlckVycm9yTWVzc2FnZT4oXG4gICAgICAobSkgPT4gbS50eXBlID09PSAnYmxvYkFjaycgfHwgbS50eXBlID09PSAnZXJyb3InLFxuICAgICAgKCkgPT4gdHJhbnNwb3J0LnNlbmQoeyB0eXBlOiAncHV0QmxvYicsIGhhc2gsIGNvbnRlbnQ6IGJ5dGVzVG9CYXNlNjQoYnl0ZXMpIH0pLFxuICAgICk7XG4gICAgaWYgKHJlcGx5LnR5cGUgPT09ICdlcnJvcicpIHRocm93IHRoaXMudG9FcnJvcihyZXBseSk7XG4gICAgYXdhaXQgdGhpcy5vcHRpb25zLmJsb2JTdG9yZS5wdXQoaGFzaCwgYnl0ZXMpO1xuICB9XG5cbiAgcHJpdmF0ZSByZWFkb25seSBmZXRjaEJsb2I6IEZldGNoQmxvYiA9IGFzeW5jIChoYXNoOiBzdHJpbmcpOiBQcm9taXNlPFVpbnQ4QXJyYXk+ID0+IHtcbiAgICBpZiAoaGFzaCA9PT0gJycpIHRocm93IG5ldyBQcm90b2NvbEVycm9yKCdyZWZ1c2luZyB0byBmZXRjaCBjb250ZW50IGZvciBhbiBlbXB0eSBoYXNoJyk7XG4gICAgY29uc3QgY2FjaGVkID0gYXdhaXQgdGhpcy5vcHRpb25zLmJsb2JTdG9yZS5nZXQoaGFzaCk7XG4gICAgaWYgKGNhY2hlZCAhPT0gdW5kZWZpbmVkKSByZXR1cm4gY2FjaGVkO1xuICAgIGNvbnN0IGJ5dGVzID0gYXdhaXQgdGhpcy5kb3dubG9hZEJsb2IoaGFzaCk7XG4gICAgYXdhaXQgdGhpcy5vcHRpb25zLmJsb2JTdG9yZS5wdXQoaGFzaCwgYnl0ZXMpO1xuICAgIHJldHVybiBieXRlcztcbiAgfTtcblxuICBwcml2YXRlIGFzeW5jIGRvd25sb2FkQmxvYihoYXNoOiBzdHJpbmcpOiBQcm9taXNlPFVpbnQ4QXJyYXk+IHtcbiAgICBjb25zdCB0cmFuc3BvcnQgPSB0aGlzLnRyYW5zcG9ydDtcbiAgICBpZiAodHJhbnNwb3J0ID09PSBudWxsKSB0aHJvdyBuZXcgTmV0d29ya0Vycm9yKCdub3QgY29ubmVjdGVkJyk7XG4gICAgY29uc3QgcmVwbHkgPSBhd2FpdCB0aGlzLnJlcXVlc3Q8QmxvYk1lc3NhZ2UgfCBTZXJ2ZXJFcnJvck1lc3NhZ2U+KFxuICAgICAgKG0pID0+IChtLnR5cGUgPT09ICdibG9iJyAmJiBtLmhhc2ggPT09IGhhc2gpIHx8IG0udHlwZSA9PT0gJ2Vycm9yJyxcbiAgICAgICgpID0+IHRyYW5zcG9ydC5zZW5kKHsgdHlwZTogJ2dldEJsb2InLCBoYXNoIH0pLFxuICAgICk7XG4gICAgaWYgKHJlcGx5LnR5cGUgPT09ICdlcnJvcicpIHRocm93IHRoaXMudG9FcnJvcihyZXBseSk7XG4gICAgY29uc3QgYnl0ZXMgPSBiYXNlNjRUb0J5dGVzKHJlcGx5LmNvbnRlbnQpO1xuICAgIGlmICgoYXdhaXQgc2hhMjU2SGV4KGJ5dGVzKSkgIT09IGhhc2gpIHtcbiAgICAgIHRocm93IG5ldyBQcm90b2NvbEVycm9yKGBibG9iICR7aGFzaH0gZmFpbGVkIHZlcmlmaWNhdGlvbiBvbiBkb3dubG9hZGApO1xuICAgIH1cbiAgICByZXR1cm4gYnl0ZXM7XG4gIH1cblxuICAvLyAtLS0gcGx1bWJpbmcgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIHByaXZhdGUgcmVxdWVzdDxUIGV4dGVuZHMgU2VydmVyTWVzc2FnZT4oXG4gICAgbWF0Y2hlczogKG1lc3NhZ2U6IE1lc3NhZ2UpID0+IGJvb2xlYW4sXG4gICAgc2VuZDogKCkgPT4gdm9pZCxcbiAgKTogUHJvbWlzZTxUPiB7XG4gICAgcmV0dXJuIG5ldyBQcm9taXNlPFQ+KChyZXNvbHZlLCByZWplY3QpID0+IHtcbiAgICAgIHRoaXMuZXhwZWN0YXRpb24gPSB7XG4gICAgICAgIG1hdGNoZXM6IChtZXNzYWdlKSA9PiBtYXRjaGVzKG1lc3NhZ2UpLFxuICAgICAgICByZXNvbHZlOiAobWVzc2FnZSkgPT4gcmVzb2x2ZShtZXNzYWdlIGFzIFQpLFxuICAgICAgICByZWplY3QsXG4gICAgICB9O1xuICAgICAgdHJ5IHtcbiAgICAgICAgc2VuZCgpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdGhpcy5leHBlY3RhdGlvbiA9IG51bGw7XG4gICAgICAgIHJlamVjdChlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IgOiBuZXcgTmV0d29ya0Vycm9yKFN0cmluZyhlcnJvcikpKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgdG9FcnJvcihtZXNzYWdlOiBTZXJ2ZXJFcnJvck1lc3NhZ2UpOiBFcnJvciB7XG4gICAgc3dpdGNoIChtZXNzYWdlLmNvZGUpIHtcbiAgICAgIGNhc2UgJ1VOQVVUSE9SSVpFRCc6XG4gICAgICAgIHJldHVybiBuZXcgVW5hdXRob3JpemVkRXJyb3IobWVzc2FnZS5tZXNzYWdlKTtcbiAgICAgIGNhc2UgJ1JFVk9LRUQnOlxuICAgICAgICByZXR1cm4gbmV3IFJldm9rZWRFcnJvcihtZXNzYWdlLm1lc3NhZ2UpO1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgcmV0dXJuIG5ldyBQcm90b2NvbEVycm9yKG1lc3NhZ2UubWVzc2FnZSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBlbnF1ZXVlKG9wZXJhdGlvbjogKCkgPT4gUHJvbWlzZTx2b2lkPik6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMucXVldWVkT3BzICs9IDE7XG4gICAgY29uc3QgcnVuID0gdGhpcy50YWlsLnRoZW4ob3BlcmF0aW9uLCBvcGVyYXRpb24pO1xuICAgIGNvbnN0IHNldHRsZWQgPSBydW4udGhlbihcbiAgICAgICgpID0+IHtcbiAgICAgICAgdGhpcy5xdWV1ZWRPcHMgLT0gMTtcbiAgICAgICAgdGhpcy5wZXJzaXN0SW5kZXgoKTtcbiAgICAgIH0sXG4gICAgICAoZXJyb3I6IHVua25vd24pID0+IHtcbiAgICAgICAgdGhpcy5xdWV1ZWRPcHMgLT0gMTtcbiAgICAgICAgdGhpcy5wZXJzaXN0SW5kZXgoKTtcbiAgICAgICAgdGhyb3cgZXJyb3I7XG4gICAgICB9LFxuICAgICk7XG4gICAgLy8gU3dhbGxvdyByZWplY3Rpb25zIG9uIHRoZSBzaGFyZWQgdGFpbCAoaW5kaXZpZHVhbCBjYWxsZXJzIHNlZSB0aGVtIHZpYVxuICAgIC8vIGBzZXR0bGVkYCk7IG9uZSBmYWlsZWQgb3AgbXVzdCBub3QgcG9pc29uIHRoZSBxdWV1ZS5cbiAgICB0aGlzLnRhaWwgPSBzZXR0bGVkLnRoZW4oXG4gICAgICAoKSA9PiB7fSxcbiAgICAgICgpID0+IHt9LFxuICAgICk7XG4gICAgcmV0dXJuIHNldHRsZWQ7XG4gIH1cblxuICBwcml2YXRlIHBlcnNpc3RJbmRleCgpOiB2b2lkIHtcbiAgICBjb25zdCBzbmFwc2hvdCA9IHNlcmlhbGl6ZUxvY2FsSW5kZXgodGhpcy5pbmRleCk7XG4gICAgdm9pZCB0aGlzLm9wdGlvbnMuc3RvcmFnZVxuICAgICAgLndyaXRlRmlsZShMT0NBTF9JTkRFWF9TVEFURV9QQVRILCBuZXcgVGV4dEVuY29kZXIoKS5lbmNvZGUoc25hcHNob3QpKVxuICAgICAgLmNhdGNoKChlcnJvcjogdW5rbm93bikgPT4gdGhpcy5sb2cud2FybignZmFpbGVkIHRvIHBlcnNpc3QgbG9jYWwgaW5kZXgnLCBlcnJvcikpO1xuICB9XG59XG5cbi8vIC0tLSBtb2R1bGUtcHJpdmF0ZSB0eXBlIGFsaWFzZXMgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbnR5cGUgU2VydmVyRXJyb3JNZXNzYWdlID0gRXh0cmFjdDxTZXJ2ZXJNZXNzYWdlLCB7IHR5cGU6ICdlcnJvcicgfT47XG4iLCAiLyoqXG4gKiBgT2JzaWRpYW5TdG9yYWdlQWRhcHRlcmAgXHUyMDE0IGNvcmUncyBgU3RvcmFnZUFkYXB0ZXJgIG92ZXIgdGhlIE9ic2lkaWFuIHZhdWx0XG4gKiBgRGF0YUFkYXB0ZXJgIChBUkNISVRFQ1RVUkUgXHUwMEE3OCBhZGFwdGVyczogcGx1Z2luIGltcGxlbWVudGF0aW9uLCBkZXNrdG9wIGFuZFxuICogbW9iaWxlIGFsaWtlKS5cbiAqXG4gKiBQYXRoIG1hcHBpbmc6IGV2ZXJ5IHBhdGggY3Jvc3NpbmcgdGhlIGNvcmUgc2VhbSBpcyBhIFBPU0lYLW5vcm1hbGl6ZWQgdmF1bHRcbiAqIHBhdGggKGAvbm90ZXMvYS5tZGAsIHJvb3QgYC9gKTsgdGhlIE9ic2lkaWFuIGFkYXB0ZXIgd2FudHMgdGhlIHNhbWUgcGF0aFxuICogKndpdGhvdXQqIHRoZSBsZWFkaW5nIHNsYXNoIChgbm90ZXMvYS5tZGApLCB3aXRoIGAvYCAob3IgYCcnYCkgZm9yIHRoZSByb290LlxuICpcbiAqIEFsbCB3cml0ZXMgZ28gdGhyb3VnaCB0aGUgYWRhcHRlciAobmV2ZXIgYHZhdWx0Lm1vZGlmeWAgb24gdGhlIHNpZGUpLCBzb1xuICogT2JzaWRpYW4ncyBvd24gZmlsZSB3YXRjaGluZyBvYnNlcnZlcyB0aGVtIGxpa2UgYW55IGV4dGVybmFsIGVkaXQgYW5kIG9wZW5cbiAqIGVkaXRvcnMgcmVmcmVzaCAoRlItMykuIFdyaXRlcyBhcmUgYXRvbWljLWlzaDogY29udGVudCBsYW5kcyBpbiBhIHRlbXAgZmlsZVxuICogdW5kZXIgYC8udmF1bHRzeW5jZm9yYWdlbnRzL3RtcC9gIChjb3JlIGlnbm9yZXMgdGhhdCB3aG9sZSBzdWJ0cmVlKSBhbmQgaXNcbiAqIHJlbmFtZWQgb250byB0aGUgdGFyZ2V0OyBpZiByZW5hbWluZyBpcyB1bmF2YWlsYWJsZSAoZXhvdGljIG1vYmlsZVxuICogYWRhcHRlcnMpLCB3ZSBmYWxsIGJhY2sgdG8gYSBkaXJlY3Qgd3JpdGUuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBEYXRhQWRhcHRlciB9IGZyb20gJ29ic2lkaWFuJztcbmltcG9ydCB0eXBlIHsgRmlsZVN0YXQsIFN0b3JhZ2VBZGFwdGVyIH0gZnJvbSAnQHZzYS9jb3JlJztcbmltcG9ydCB7IG5vcm1hbGl6ZVZhdWx0UGF0aCB9IGZyb20gJ0B2c2EvY29yZSc7XG5cbi8qKiBEaXJlY3RvcnkgKGluc2lkZSB0aGUgdmF1bHQpIGhvbGRpbmcgdGVtcCBmaWxlcyBkdXJpbmcgYXRvbWljIHdyaXRlcy4gKi9cbmV4cG9ydCBjb25zdCBURU1QX0RJUl9WQVVMVF9QQVRIID0gJy8udmF1bHRzeW5jZm9yYWdlbnRzL3RtcCc7XG5cbi8qKiBTdGF0cyBPYnNpZGlhbidzIGBEYXRhQWRhcHRlci5zdGF0YCByZXR1cm5zIGZvciBhIGZpbGUuICovXG5pbnRlcmZhY2UgQWRhcHRlclN0YXQge1xuICBzaXplOiBudW1iZXI7XG4gIG10aW1lOiBudW1iZXI7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgT2JzaWRpYW5TdG9yYWdlQWRhcHRlck9wdGlvbnMge1xuICBhZGFwdGVyOiBEYXRhQWRhcHRlcjtcbn1cblxuZXhwb3J0IGNsYXNzIE9ic2lkaWFuU3RvcmFnZUFkYXB0ZXIgaW1wbGVtZW50cyBTdG9yYWdlQWRhcHRlciB7XG4gIHByaXZhdGUgcmVhZG9ubHkgYWRhcHRlcjogRGF0YUFkYXB0ZXI7XG4gIC8qKlxuICAgKiBMYXRjaGVkIHdoZW4gYSB0ZW1wK3JlbmFtZSBhdHRlbXB0IGZhaWxzOiBldmVyeSBsYXRlciB3cml0ZSBnb2VzIHN0cmFpZ2h0XG4gICAqIHRvIGB3cml0ZUJpbmFyeWAgaW5zdGVhZCBvZiBwYXlpbmcgdGhlIGZhaWxpbmctcmVuYW1lIHBlbmFsdHkgYWdhaW4uXG4gICAqL1xuICBwcml2YXRlIHRlbXBSZW5hbWVCcm9rZW4gPSBmYWxzZTtcbiAgcHJpdmF0ZSB0ZW1wQ291bnRlciA9IDA7XG5cbiAgY29uc3RydWN0b3Iob3B0aW9uczogT2JzaWRpYW5TdG9yYWdlQWRhcHRlck9wdGlvbnMpIHtcbiAgICB0aGlzLmFkYXB0ZXIgPSBvcHRpb25zLmFkYXB0ZXI7XG4gIH1cblxuICAvLyAtLS0gcGF0aCBtYXBwaW5nIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICAvKiogVmF1bHQgcGF0aCBcdTIxOTIgYWRhcHRlciBwYXRoIChgL2EvYi5tZGAgXHUyMTkyIGBhL2IubWRgLCBgL2AgXHUyMTkyIGAvYCkuICovXG4gIHByaXZhdGUgdG9BZGFwdGVyUGF0aCh2YXVsdFBhdGg6IHN0cmluZyk6IHN0cmluZyB7XG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IG5vcm1hbGl6ZVZhdWx0UGF0aCh2YXVsdFBhdGgpO1xuICAgIHJldHVybiBub3JtYWxpemVkID09PSAnLycgPyAnLycgOiBub3JtYWxpemVkLnNsaWNlKDEpO1xuICB9XG5cbiAgLy8gLS0tIFN0b3JhZ2VBZGFwdGVyIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIGFzeW5jIHJlYWRGaWxlKHBhdGg6IHN0cmluZyk6IFByb21pc2U8VWludDhBcnJheT4ge1xuICAgIGNvbnN0IGJ1ZmZlciA9IGF3YWl0IHRoaXMuYWRhcHRlci5yZWFkQmluYXJ5KHRoaXMudG9BZGFwdGVyUGF0aChwYXRoKSk7XG4gICAgcmV0dXJuIG5ldyBVaW50OEFycmF5KGJ1ZmZlcik7XG4gIH1cblxuICBhc3luYyB3cml0ZUZpbGUocGF0aDogc3RyaW5nLCBkYXRhOiBVaW50OEFycmF5KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgdGFyZ2V0ID0gdGhpcy50b0FkYXB0ZXJQYXRoKHBhdGgpO1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlUGFyZW50RGlycyh0YXJnZXQpO1xuICAgIC8vIENvcHkgaW50byBhIHN0YW5kYWxvbmUgQXJyYXlCdWZmZXI6IGBieXRlcy5idWZmZXJgIG1heSBiZSBhIHBvb2xlZFxuICAgIC8vIGJ1ZmZlciBsYXJnZXIgdGhhbiB0aGUgdmlldyAoY29yZSBzbGljZXMgYW5kIHJldXNlcyBidWZmZXJzKS5cbiAgICBjb25zdCBidWZmZXIgPSBuZXcgQXJyYXlCdWZmZXIoZGF0YS5ieXRlTGVuZ3RoKTtcbiAgICBuZXcgVWludDhBcnJheShidWZmZXIpLnNldChkYXRhKTtcblxuICAgIGlmICh0aGlzLnRlbXBSZW5hbWVCcm9rZW4pIHtcbiAgICAgIGF3YWl0IHRoaXMuYWRhcHRlci53cml0ZUJpbmFyeSh0YXJnZXQsIGJ1ZmZlcik7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IHRlbXAgPSBhd2FpdCB0aGlzLnRlbXBQYXRoKCk7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuYWRhcHRlci53cml0ZUJpbmFyeSh0ZW1wLCBidWZmZXIpO1xuICAgICAgYXdhaXQgdGhpcy5hZGFwdGVyLnJlbmFtZSh0ZW1wLCB0YXJnZXQpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gQ2xlYW4gdXAgdGhlIG9ycGhhbmVkIHRlbXAgKGJlc3QgZWZmb3J0IFx1MjAxNCBpdCBsaXZlcyBpbiB0aGUgaWdub3JlZFxuICAgICAgLy8gc3RhdGUgZGlyLCBzbyBldmVuIGEgbGVhayBpcyBpbnZpc2libGUgdG8gc3luYyksIHRoZW4gZmFsbCBiYWNrIHRvXG4gICAgICAvLyBhIGRpcmVjdCwgbm9uLWF0b21pYyB3cml0ZSByYXRoZXIgdGhhbiBmYWlsaW5nIHRoZSBzeW5jLlxuICAgICAgYXdhaXQgdGhpcy5zaWxlbnRSZW1vdmUodGVtcCk7XG4gICAgICB0aGlzLnRlbXBSZW5hbWVCcm9rZW4gPSB0cnVlO1xuICAgICAgYXdhaXQgdGhpcy5hZGFwdGVyLndyaXRlQmluYXJ5KHRhcmdldCwgYnVmZmVyKTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBkZWxldGVGaWxlKHBhdGg6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHRhcmdldCA9IHRoaXMudG9BZGFwdGVyUGF0aChwYXRoKTtcbiAgICAvLyBJZGVtcG90ZW50IHBlciB0aGUgYWRhcHRlciBjb250cmFjdC5cbiAgICBpZiAoIShhd2FpdCB0aGlzLmFkYXB0ZXIuZXhpc3RzKHRhcmdldCkpKSByZXR1cm47XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuYWRhcHRlci5yZW1vdmUodGFyZ2V0KTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIExvc3QgYSByYWNlIHdpdGggYSBjb25jdXJyZW50IGRlbGV0ZSBcdTIwMTQgb25seSBzdXJmYWNlIGlmIGl0IHN1cnZpdmVzLlxuICAgICAgaWYgKGF3YWl0IHRoaXMuYWRhcHRlci5leGlzdHModGFyZ2V0KSkgdGhyb3cgbmV3IEVycm9yKGBmYWlsZWQgdG8gZGVsZXRlICR7dGFyZ2V0fWApO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIHJlbmFtZUZpbGUoZnJvbTogc3RyaW5nLCB0bzogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgZnJvbVBhdGggPSB0aGlzLnRvQWRhcHRlclBhdGgoZnJvbSk7XG4gICAgY29uc3QgdG9QYXRoID0gdGhpcy50b0FkYXB0ZXJQYXRoKHRvKTtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVBhcmVudERpcnModG9QYXRoKTtcbiAgICBhd2FpdCB0aGlzLmFkYXB0ZXIucmVuYW1lKGZyb21QYXRoLCB0b1BhdGgpO1xuICB9XG5cbiAgYXN5bmMgbGlzdEZpbGVzKCk6IFByb21pc2U8cmVhZG9ubHkgRmlsZVN0YXRbXT4ge1xuICAgIGNvbnN0IGZpbGVzOiBGaWxlU3RhdFtdID0gW107XG4gICAgYXdhaXQgdGhpcy53YWxrRmlsZXMoJy8nLCBhc3luYyAoYWRhcHRlclBhdGgpID0+IHtcbiAgICAgIGNvbnN0IHN0YXQgPSBhd2FpdCB0aGlzLnN0YXRPck51bGwoYWRhcHRlclBhdGgpO1xuICAgICAgaWYgKHN0YXQgPT09IG51bGwpIHJldHVybjsgLy8gdmFuaXNoZWQgbWlkLXdhbGtcbiAgICAgIGZpbGVzLnB1c2goe1xuICAgICAgICBwYXRoOiBgLyR7YWRhcHRlclBhdGh9YCxcbiAgICAgICAgc2l6ZTogc3RhdC5zaXplLFxuICAgICAgICBtdGltZTogc3RhdC5tdGltZSxcbiAgICAgIH0pO1xuICAgIH0pO1xuICAgIGZpbGVzLnNvcnQoKGEsIGIpID0+IChhLnBhdGggPCBiLnBhdGggPyAtMSA6IGEucGF0aCA+IGIucGF0aCA/IDEgOiAwKSk7XG4gICAgcmV0dXJuIGZpbGVzO1xuICB9XG5cbiAgYXN5bmMgbGlzdERpcnMoKTogUHJvbWlzZTxyZWFkb25seSBzdHJpbmdbXT4ge1xuICAgIGNvbnN0IGRpcnM6IHN0cmluZ1tdID0gWycvJ107XG4gICAgYXdhaXQgdGhpcy53YWxrRm9sZGVycygnLycsIGFzeW5jIChhZGFwdGVyUGF0aCkgPT4ge1xuICAgICAgZGlycy5wdXNoKGAvJHthZGFwdGVyUGF0aH1gKTtcbiAgICB9KTtcbiAgICBkaXJzLnNvcnQoKGEsIGIpID0+IChhIDwgYiA/IC0xIDogYSA+IGIgPyAxIDogMCkpO1xuICAgIHJldHVybiBkaXJzO1xuICB9XG5cbiAgYXN5bmMgZW5zdXJlRGlyKHBhdGg6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBub3JtYWxpemVWYXVsdFBhdGgocGF0aCk7XG4gICAgY29uc3Qgc2VnbWVudHMgPSBub3JtYWxpemVkID09PSAnLycgPyBbXSA6IG5vcm1hbGl6ZWQuc2xpY2UoMSkuc3BsaXQoJy8nKTtcbiAgICBsZXQgY3VycmVudCA9ICcnO1xuICAgIGZvciAoY29uc3Qgc2VnbWVudCBvZiBzZWdtZW50cykge1xuICAgICAgY3VycmVudCA9IGN1cnJlbnQgPT09ICcnID8gc2VnbWVudCA6IGAke2N1cnJlbnR9LyR7c2VnbWVudH1gO1xuICAgICAgaWYgKCEoYXdhaXQgdGhpcy5hZGFwdGVyLmV4aXN0cyhjdXJyZW50KSkpIGF3YWl0IHRoaXMuYWRhcHRlci5ta2RpcihjdXJyZW50KTtcbiAgICB9XG4gIH1cblxuICBhc3luYyBleGlzdHMocGF0aDogc3RyaW5nKTogUHJvbWlzZTxib29sZWFuPiB7XG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IG5vcm1hbGl6ZVZhdWx0UGF0aChwYXRoKTtcbiAgICBpZiAobm9ybWFsaXplZCA9PT0gJy8nKSByZXR1cm4gdHJ1ZTsgLy8gdGhlIHZhdWx0IHJvb3QgYWx3YXlzIGV4aXN0c1xuICAgIHRyeSB7XG4gICAgICByZXR1cm4gYXdhaXQgdGhpcy5hZGFwdGVyLmV4aXN0cyh0aGlzLnRvQWRhcHRlclBhdGgobm9ybWFsaXplZCkpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cbiAgfVxuXG4gIC8vIC0tLSBoZWxwZXJzIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuICBwcml2YXRlIGFzeW5jIHN0YXRPck51bGwoYWRhcHRlclBhdGg6IHN0cmluZyk6IFByb21pc2U8QWRhcHRlclN0YXQgfCBudWxsPiB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IHN0YXQgPSBhd2FpdCB0aGlzLmFkYXB0ZXIuc3RhdChhZGFwdGVyUGF0aCk7XG4gICAgICBpZiAoc3RhdCA9PT0gbnVsbCB8fCBzdGF0LnR5cGUgIT09ICdmaWxlJykgcmV0dXJuIG51bGw7XG4gICAgICByZXR1cm4geyBzaXplOiBzdGF0LnNpemUsIG10aW1lOiBzdGF0Lm10aW1lIH07XG4gICAgfSBjYXRjaCB7XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG4gIH1cblxuICAvKiogQSB1bmlxdWUgdGVtcCBwYXRoIGluc2lkZSB0aGUgKHN5bmMtaWdub3JlZCkgY2xpZW50IHN0YXRlIGRpci4gKi9cbiAgcHJpdmF0ZSBhc3luYyB0ZW1wUGF0aCgpOiBQcm9taXNlPHN0cmluZz4ge1xuICAgIGF3YWl0IHRoaXMuZW5zdXJlRGlyKFRFTVBfRElSX1ZBVUxUX1BBVEgpO1xuICAgIHRoaXMudGVtcENvdW50ZXIgKz0gMTtcbiAgICByZXR1cm4gYCR7VEVNUF9ESVJfVkFVTFRfUEFUSC5zbGljZSgxKX0vdy0ke0RhdGUubm93KCkudG9TdHJpbmcoMzYpfS0ke3RoaXMudGVtcENvdW50ZXJ9LnRtcGA7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHNpbGVudFJlbW92ZShhZGFwdGVyUGF0aDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuYWRhcHRlci5yZW1vdmUoYWRhcHRlclBhdGgpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gYmVzdCBlZmZvcnRcbiAgICB9XG4gIH1cblxuICAvKiogQ3JlYXRlIGV2ZXJ5IGFuY2VzdG9yIGRpcmVjdG9yeSBvZiBhbiBhZGFwdGVyIGZpbGUgcGF0aC4gKi9cbiAgcHJpdmF0ZSBhc3luYyBlbnN1cmVQYXJlbnREaXJzKGFkYXB0ZXJQYXRoOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBzbGFzaCA9IGFkYXB0ZXJQYXRoLmxhc3RJbmRleE9mKCcvJyk7XG4gICAgaWYgKHNsYXNoIDw9IDApIHJldHVybjsgLy8gdmF1bHQgcm9vdCBcdTIwMTQgYWx3YXlzIGV4aXN0c1xuICAgIGNvbnN0IHBhcmVudCA9IGFkYXB0ZXJQYXRoLnNsaWNlKDAsIHNsYXNoKTtcbiAgICBhd2FpdCB0aGlzLmVuc3VyZURpcihgLyR7cGFyZW50fWApO1xuICB9XG5cbiAgLyoqIFJlY3Vyc2l2ZWx5IHZpc2l0IGV2ZXJ5IGZpbGUgdW5kZXIgYGRpckFkYXB0ZXJQYXRoYCAoYWRhcHRlciBwYXRocykuICovXG4gIHByaXZhdGUgYXN5bmMgd2Fsa0ZpbGVzKFxuICAgIGRpckFkYXB0ZXJQYXRoOiBzdHJpbmcsXG4gICAgdmlzaXQ6IChhZGFwdGVyUGF0aDogc3RyaW5nKSA9PiBQcm9taXNlPHZvaWQ+LFxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBsZXQgbGlzdGluZztcbiAgICB0cnkge1xuICAgICAgbGlzdGluZyA9IGF3YWl0IHRoaXMuYWRhcHRlci5saXN0KGRpckFkYXB0ZXJQYXRoKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybjsgLy8gdW5yZWFkYWJsZS9taXNzaW5nIFx1MjAxNCB0cmVhdCBhcyBlbXB0eVxuICAgIH1cbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgbGlzdGluZy5maWxlcykgYXdhaXQgdmlzaXQoZmlsZSk7XG4gICAgZm9yIChjb25zdCBmb2xkZXIgb2YgbGlzdGluZy5mb2xkZXJzKSBhd2FpdCB0aGlzLndhbGtGaWxlcyhmb2xkZXIsIHZpc2l0KTtcbiAgfVxuXG4gIC8qKiBSZWN1cnNpdmVseSB2aXNpdCBldmVyeSBmb2xkZXIgdW5kZXIgYGRpckFkYXB0ZXJQYXRoYCAoYWRhcHRlciBwYXRocykuICovXG4gIHByaXZhdGUgYXN5bmMgd2Fsa0ZvbGRlcnMoXG4gICAgZGlyQWRhcHRlclBhdGg6IHN0cmluZyxcbiAgICB2aXNpdDogKGFkYXB0ZXJQYXRoOiBzdHJpbmcpID0+IFByb21pc2U8dm9pZD4sXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGxldCBsaXN0aW5nO1xuICAgIHRyeSB7XG4gICAgICBsaXN0aW5nID0gYXdhaXQgdGhpcy5hZGFwdGVyLmxpc3QoZGlyQWRhcHRlclBhdGgpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBmb3IgKGNvbnN0IGZvbGRlciBvZiBsaXN0aW5nLmZvbGRlcnMpIHtcbiAgICAgIGF3YWl0IHZpc2l0KGZvbGRlcik7XG4gICAgICBhd2FpdCB0aGlzLndhbGtGb2xkZXJzKGZvbGRlciwgdmlzaXQpO1xuICAgIH1cbiAgfVxufVxuIiwgIi8qKlxuICogYE9ic2lkaWFuV2F0Y2hBZGFwdGVyYCArIGBSZXNjYW5TY2hlZHVsZXJgIFx1MjAxNCBjb3JlJ3MgYFdhdGNoQWRhcHRlcmAgb3ZlclxuICogT2JzaWRpYW4gdmF1bHQgZXZlbnRzIChBUkNISVRFQ1RVUkUgXHUwMEE3OCBhZGFwdGVycyksIHBsdXMgdGhlIHBlcmlvZGljIC9cbiAqIGZvY3VzLWRyaXZlbiByZWNvbmNpbGlhdGlvbiBob29rcyB0aGUgbW9iaWxlICYgZXh0ZXJuYWwtZWRpdCBzdG9yaWVzIG5lZWRcbiAqIChcdTAwQTc4IFwiTW9iaWxlXCIsIEZSLTUsIEZSLTEyKS5cbiAqXG4gKiBWYXVsdCBldmVudHMgY292ZXIgZXZlcnl0aGluZyBPYnNpZGlhbiBpdHNlbGYgb2JzZXJ2ZXMgXHUyMDE0IGluLWFwcCBlZGl0cyxcbiAqIGRyYWctZHJvcHMsIGFuZCBleHRlcm5hbCBlZGl0cyBtYWRlIHdoaWxlIE9ic2lkaWFuIGlzICpvcGVuKi4gRWRpdHMgbWFkZVxuICogd2hpbGUgT2JzaWRpYW4gd2FzIGNsb3NlZCBhcmUgcGlja2VkIHVwIGJ5IHRoZSBzdGFydHVwIHJlY29uY2lsaWF0aW9uIGFuZFxuICogYnkgdGhlIHBlcmlvZGljIHJlc2NhbiB3aXJlZCBoZXJlOlxuICpcbiAqICAgdmF1bHQgZXZlbnRzIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjVCQSBXYXRjaEFkYXB0ZXIuc3RhcnQoY2IpIFx1MjUwMFx1MjVCQSBTeW5jQ2xpZW50IGRlYm91bmNlZCBjeWNsZVxuICogICBzZXRJbnRlcnZhbCAoZGVmYXVsdCAzMHMpIFx1MjUwMFx1MjVCQSBSZXNjYW5TY2hlZHVsZXIgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNUJBIFN5bmNDbGllbnQudHJpZ2dlclN5bmMoKVxuICogICBhY3RpdmUtbGVhZi1jaGFuZ2UgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNUJBIFJlc2NhblNjaGVkdWxlci5wb2tlKCkgXHUyNTAwXHUyNTAwXHUyNUJBIChzaG9ydCBkZWJvdW5jZSwgdGhlbiBhIGN5Y2xlKVxuICovXG5cbmltcG9ydCB0eXBlIHsgRXZlbnRSZWYsIFRBYnN0cmFjdEZpbGUsIFZhdWx0IH0gZnJvbSAnb2JzaWRpYW4nO1xuaW1wb3J0IHR5cGUgeyBGaWxlQ2hhbmdlRXZlbnQsIFdhdGNoQWRhcHRlciB9IGZyb20gJ0B2c2EvY29yZSc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgT2JzaWRpYW5XYXRjaEFkYXB0ZXJPcHRpb25zIHtcbiAgdmF1bHQ6IFZhdWx0O1xufVxuXG5leHBvcnQgY2xhc3MgT2JzaWRpYW5XYXRjaEFkYXB0ZXIgaW1wbGVtZW50cyBXYXRjaEFkYXB0ZXIge1xuICBwcml2YXRlIHJlYWRvbmx5IHZhdWx0OiBWYXVsdDtcbiAgcHJpdmF0ZSByZWZzOiBFdmVudFJlZltdID0gW107XG4gIHByaXZhdGUgZW1pdDogKChldmVudHM6IHJlYWRvbmx5IEZpbGVDaGFuZ2VFdmVudFtdKSA9PiB2b2lkKSB8IG51bGwgPSBudWxsO1xuXG4gIGNvbnN0cnVjdG9yKG9wdGlvbnM6IE9ic2lkaWFuV2F0Y2hBZGFwdGVyT3B0aW9ucykge1xuICAgIHRoaXMudmF1bHQgPSBvcHRpb25zLnZhdWx0O1xuICB9XG5cbiAgc3RhcnQoY2I6IChldmVudHM6IHJlYWRvbmx5IEZpbGVDaGFuZ2VFdmVudFtdKSA9PiB2b2lkKTogdm9pZCB7XG4gICAgdGhpcy5zdG9wKCk7XG4gICAgdGhpcy5lbWl0ID0gY2I7XG4gICAgLy8gQm90aCBmaWxlcyBhbmQgZm9sZGVycyBhcmUgZm9yd2FyZGVkOiBmb2xkZXIgZXZlbnRzIChjcmVhdGUvcmVuYW1lL1xuICAgIC8vIGRlbGV0ZSkgdHJpZ2dlciB0aGUgcmVjb25jaWxpYXRpb24gc2NhbiB0aGF0IGRpc2NvdmVycyBlbXB0eS1mb2xkZXJcbiAgICAvLyBwbGFjZWhvbGRlciBjaGFuZ2VzIChGUi0xMCkuIFRoZSBlbmdpbmUgZmlsdGVycyBpZ25vcmVkIHBhdGhzIGl0c2VsZi5cbiAgICB0aGlzLnJlZnMgPSBbXG4gICAgICB0aGlzLnZhdWx0Lm9uKCdjcmVhdGUnLCAoZmlsZTogVEFic3RyYWN0RmlsZSkgPT4ge1xuICAgICAgICB0aGlzLmZvcndhcmQoeyBraW5kOiAnYWRkJywgcGF0aDogdmF1bHRQYXRoT2YoZmlsZSkgfSk7XG4gICAgICB9KSxcbiAgICAgIHRoaXMudmF1bHQub24oJ21vZGlmeScsIChmaWxlOiBUQWJzdHJhY3RGaWxlKSA9PiB7XG4gICAgICAgIHRoaXMuZm9yd2FyZCh7IGtpbmQ6ICdtb2RpZnknLCBwYXRoOiB2YXVsdFBhdGhPZihmaWxlKSB9KTtcbiAgICAgIH0pLFxuICAgICAgdGhpcy52YXVsdC5vbignZGVsZXRlJywgKGZpbGU6IFRBYnN0cmFjdEZpbGUpID0+IHtcbiAgICAgICAgdGhpcy5mb3J3YXJkKHsga2luZDogJ2RlbGV0ZScsIHBhdGg6IHZhdWx0UGF0aE9mKGZpbGUpIH0pO1xuICAgICAgfSksXG4gICAgICB0aGlzLnZhdWx0Lm9uKCdyZW5hbWUnLCAoZmlsZTogVEFic3RyYWN0RmlsZSwgb2xkUGF0aDogc3RyaW5nKSA9PiB7XG4gICAgICAgIC8vIGBvbGRQYXRoYCBcdTIxOTIgYGZpbGUucGF0aGA6IHRoZSBlbnRyeSBhdCBgcGF0aGAgbW92ZWQgdG8gYHRvUGF0aGAuXG4gICAgICAgIHRoaXMuZm9yd2FyZCh7IGtpbmQ6ICdyZW5hbWUnLCBwYXRoOiBgLyR7b2xkUGF0aH1gLCB0b1BhdGg6IHZhdWx0UGF0aE9mKGZpbGUpIH0pO1xuICAgICAgfSksXG4gICAgXTtcbiAgfVxuXG4gIHN0b3AoKTogdm9pZCB7XG4gICAgZm9yIChjb25zdCByZWYgb2YgdGhpcy5yZWZzKSB0aGlzLnZhdWx0Lm9mZnJlZihyZWYpO1xuICAgIHRoaXMucmVmcyA9IFtdO1xuICAgIHRoaXMuZW1pdCA9IG51bGw7XG4gIH1cblxuICBwcml2YXRlIGZvcndhcmQoZXZlbnQ6IEZpbGVDaGFuZ2VFdmVudCk6IHZvaWQge1xuICAgIHRoaXMuZW1pdD8uKFtldmVudF0pO1xuICB9XG59XG5cbi8qKiBWYXVsdCBldmVudCBwYXRoIChhZGFwdGVyLW5vcm1hbGl6ZWQsIG5vIGxlYWRpbmcgc2xhc2gpIFx1MjE5MiBjb3JlIHZhdWx0IHBhdGguICovXG5mdW5jdGlvbiB2YXVsdFBhdGhPZihmaWxlOiBUQWJzdHJhY3RGaWxlKTogc3RyaW5nIHtcbiAgcmV0dXJuIGZpbGUucGF0aC5zdGFydHNXaXRoKCcvJykgPyBmaWxlLnBhdGggOiBgLyR7ZmlsZS5wYXRofWA7XG59XG5cbi8vIC0tLSBSZXNjYW5TY2hlZHVsZXIgLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cblxuZXhwb3J0IGludGVyZmFjZSBSZXNjYW5TY2hlZHVsZXJPcHRpb25zIHtcbiAgLyoqIFBlcmlvZCBiZXR3ZWVuIGZ1bGwgcmVzY2FucyBpbiBtczsgYDBgIGRpc2FibGVzIHRoZSBwZXJpb2RpYyB0aW1lci4gKi9cbiAgaW50ZXJ2YWxNczogbnVtYmVyO1xuICAvKiogRGVib3VuY2Ugd2luZG93IGZvciBgcG9rZSgpYCAoYWN0aXZlLWxlYWYtY2hhbmdlKSwgZGVmYXVsdCAzMDAwIG1zLiAqL1xuICBwb2tlRGVsYXlNcz86IG51bWJlcjtcbiAgLyoqIEluamVjdGFibGUgdGltZXIgc2VhbXMgKHRlc3RzIHVzZSBmYWtlIHRpbWVycyBhZ2FpbnN0IHRoZSBnbG9iYWxzKS4gKi9cbiAgc2V0SW50ZXJ2YWxJbXBsPzogKGZuOiAoKSA9PiB2b2lkLCBtczogbnVtYmVyKSA9PiB1bmtub3duO1xuICBjbGVhckludGVydmFsSW1wbD86IChoYW5kbGU6IHVua25vd24pID0+IHZvaWQ7XG4gIHNldFRpbWVvdXRJbXBsPzogKGZuOiAoKSA9PiB2b2lkLCBtczogbnVtYmVyKSA9PiB1bmtub3duO1xuICBjbGVhclRpbWVvdXRJbXBsPzogKGhhbmRsZTogdW5rbm93bikgPT4gdm9pZDtcbn1cblxuLyoqXG4gKiBEcml2ZXMgcGVyaW9kaWMgKyBmb2N1cy10cmlnZ2VyZWQgZnVsbCByZWNvbmNpbGlhdGlvbiBjeWNsZXMuIE5vdCBhXG4gKiBgV2F0Y2hBZGFwdGVyYCBpdHNlbGYgXHUyMDE0IGl0cyBgcnVuYCBjYWxsYmFjayBpcyB3aXJlZCB0b1xuICogYFN5bmNDbGllbnQudHJpZ2dlclN5bmMoKWAgYnkgdGhlIHBsdWdpbiAoYSByZXNjYW4gaXMgYSBmdWxsIGN5Y2xlLCBub3QgYVxuICogc2luZ2xlIGZpbGUgZXZlbnQpLlxuICovXG5leHBvcnQgY2xhc3MgUmVzY2FuU2NoZWR1bGVyIHtcbiAgcHJpdmF0ZSByZWFkb25seSBwb2tlRGVsYXlNczogbnVtYmVyO1xuICBwcml2YXRlIHJlYWRvbmx5IHNldEludGVydmFsSW1wbDogKGZuOiAoKSA9PiB2b2lkLCBtczogbnVtYmVyKSA9PiB1bmtub3duO1xuICBwcml2YXRlIHJlYWRvbmx5IGNsZWFySW50ZXJ2YWxJbXBsOiAoaGFuZGxlOiB1bmtub3duKSA9PiB2b2lkO1xuICBwcml2YXRlIHJlYWRvbmx5IHNldFRpbWVvdXRJbXBsOiAoZm46ICgpID0+IHZvaWQsIG1zOiBudW1iZXIpID0+IHVua25vd247XG4gIHByaXZhdGUgcmVhZG9ubHkgY2xlYXJUaW1lb3V0SW1wbDogKGhhbmRsZTogdW5rbm93bikgPT4gdm9pZDtcblxuICBwcml2YXRlIHJ1bjogKCgpID0+IHZvaWQpIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgaW50ZXJ2YWxIYW5kbGU6IHVua25vd24gPSBudWxsO1xuICBwcml2YXRlIGludGVydmFsTXM6IG51bWJlcjtcbiAgcHJpdmF0ZSBwb2tlSGFuZGxlOiB1bmtub3duID0gbnVsbDtcblxuICBjb25zdHJ1Y3RvcihvcHRpb25zOiBSZXNjYW5TY2hlZHVsZXJPcHRpb25zKSB7XG4gICAgdGhpcy5pbnRlcnZhbE1zID0gb3B0aW9ucy5pbnRlcnZhbE1zO1xuICAgIHRoaXMucG9rZURlbGF5TXMgPSBvcHRpb25zLnBva2VEZWxheU1zID8/IDMwMDA7XG4gICAgdGhpcy5zZXRJbnRlcnZhbEltcGwgPSBvcHRpb25zLnNldEludGVydmFsSW1wbCA/PyAoKGZuLCBtcykgPT4gc2V0SW50ZXJ2YWwoZm4sIG1zKSk7XG4gICAgdGhpcy5jbGVhckludGVydmFsSW1wbCA9IG9wdGlvbnMuY2xlYXJJbnRlcnZhbEltcGwgPz8gKChoYW5kbGUpID0+IGNsZWFySW50ZXJ2YWwoaGFuZGxlIGFzIG51bWJlcikpO1xuICAgIHRoaXMuc2V0VGltZW91dEltcGwgPSBvcHRpb25zLnNldFRpbWVvdXRJbXBsID8/ICgoZm4sIG1zKSA9PiBzZXRUaW1lb3V0KGZuLCBtcykpO1xuICAgIHRoaXMuY2xlYXJUaW1lb3V0SW1wbCA9IG9wdGlvbnMuY2xlYXJUaW1lb3V0SW1wbCA/PyAoKGhhbmRsZSkgPT4gY2xlYXJUaW1lb3V0KGhhbmRsZSBhcyBudW1iZXIpKTtcbiAgfVxuXG4gIC8qKiBCZWdpbiBwZXJpb2RpYyByZXNjYW5zOyBgcnVuYCBtdXN0IGJlIHNhZmUgdG8gY2FsbCBhdCBhbnkgdGltZS4gKi9cbiAgc3RhcnQocnVuOiAoKSA9PiB2b2lkKTogdm9pZCB7XG4gICAgdGhpcy5zdG9wKCk7XG4gICAgdGhpcy5ydW4gPSBydW47XG4gICAgdGhpcy5hcm1JbnRlcnZhbCgpO1xuICB9XG5cbiAgc3RvcCgpOiB2b2lkIHtcbiAgICB0aGlzLmNsZWFySW50ZXJ2YWxJbXBsS2VlcCgpO1xuICAgIGlmICh0aGlzLnBva2VIYW5kbGUgIT09IG51bGwpIHtcbiAgICAgIHRoaXMuY2xlYXJUaW1lb3V0SW1wbCh0aGlzLnBva2VIYW5kbGUpO1xuICAgICAgdGhpcy5wb2tlSGFuZGxlID0gbnVsbDtcbiAgICB9XG4gICAgdGhpcy5ydW4gPSBudWxsO1xuICB9XG5cbiAgLyoqIENoYW5nZSB0aGUgcGVyaW9kaWMgaW50ZXJ2YWwgbGl2ZSAodGhlIHNldHRpbmdzLXRhYiB0b2dnbGUpLiAqL1xuICBzZXRJbnRlcnZhbE1zKG1zOiBudW1iZXIpOiB2b2lkIHtcbiAgICB0aGlzLmludGVydmFsTXMgPSBtcztcbiAgICBpZiAodGhpcy5ydW4gIT09IG51bGwpIHtcbiAgICAgIHRoaXMuY2xlYXJJbnRlcnZhbEltcGxLZWVwKCk7XG4gICAgICB0aGlzLmFybUludGVydmFsKCk7XG4gICAgfVxuICB9XG5cbiAgLyoqIEEgZm9jdXMvYXBwLXN3aXRjaCBzaWduYWwgKGFjdGl2ZS1sZWFmLWNoYW5nZSk6IHJlc2NhbiBzb29uLCBjb2FsZXNjZWQuICovXG4gIHBva2UoKTogdm9pZCB7XG4gICAgaWYgKHRoaXMucnVuID09PSBudWxsKSByZXR1cm47XG4gICAgaWYgKHRoaXMucG9rZUhhbmRsZSAhPT0gbnVsbCkgcmV0dXJuOyAvLyBhbHJlYWR5IHNjaGVkdWxlZFxuICAgIHRoaXMucG9rZUhhbmRsZSA9IHRoaXMuc2V0VGltZW91dEltcGwoKCkgPT4ge1xuICAgICAgdGhpcy5wb2tlSGFuZGxlID0gbnVsbDtcbiAgICAgIHRoaXMucnVuPy4oKTtcbiAgICB9LCB0aGlzLnBva2VEZWxheU1zKTtcbiAgfVxuXG4gIGdldCBpbnRlcnZhbE1zVmFsdWUoKTogbnVtYmVyIHtcbiAgICByZXR1cm4gdGhpcy5pbnRlcnZhbE1zO1xuICB9XG5cbiAgcHJpdmF0ZSBhcm1JbnRlcnZhbCgpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5pbnRlcnZhbE1zIDw9IDAgfHwgdGhpcy5ydW4gPT09IG51bGwpIHJldHVybjtcbiAgICB0aGlzLmludGVydmFsSGFuZGxlID0gdGhpcy5zZXRJbnRlcnZhbEltcGwoKCkgPT4gdGhpcy5ydW4/LigpLCB0aGlzLmludGVydmFsTXMpO1xuICB9XG5cbiAgcHJpdmF0ZSBjbGVhckludGVydmFsSW1wbEtlZXAoKTogdm9pZCB7XG4gICAgaWYgKHRoaXMuaW50ZXJ2YWxIYW5kbGUgIT09IG51bGwpIHtcbiAgICAgIHRoaXMuY2xlYXJJbnRlcnZhbEltcGwodGhpcy5pbnRlcnZhbEhhbmRsZSk7XG4gICAgICB0aGlzLmludGVydmFsSGFuZGxlID0gbnVsbDtcbiAgICB9XG4gIH1cbn1cbiIsICIvKipcbiAqIGBIdHRwQmxvYlN0b3JlYCBcdTIwMTQgY29yZSdzIGBCbG9iU3RvcmVgIGFnYWluc3QgdGhlIHdvcmtlcidzIGAvYmxvYi86aGFzaGBcbiAqIHJvdXRlcyAoQVJDSElURUNUVVJFIFx1MDBBNzUgSFRUUFMgcm91dGVzKSwgYXV0aGVudGljYXRlZCB3aXRoIHRoZSBkZXZpY2UgdG9rZW5cbiAqIGFzIGEgQmVhcmVyIGhlYWRlci4gQnVpbHQgb24gdGhlIGdsb2JhbCBgZmV0Y2hgIChPYnNpZGlhbiBkZXNrdG9wIGFuZFxuICogbW9iaWxlKSwgaW5qZWN0YWJsZSBmb3IgdGVzdHMuIFBsdWdpbi1sb2NhbCB0d2luIG9mIHRoZSBub2RlLXJ1bnRpbWUgb25lOlxuICogbm8gaW1wb3J0cyBmcm9tIGBAdnNhL25vZGUtcnVudGltZWAgKE5vZGUtb25seSBwYWNrYWdlKS5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IEJsb2JTdG9yZSB9IGZyb20gJ0B2c2EvY29yZSc7XG5cbi8qKiBOb24tMnh4IGJsb2Itcm91dGUgcmVwbHkuIGBzdGF0dXNgIGlzIHRoZSBIVFRQIHN0YXR1cyBjb2RlLiAqL1xuZXhwb3J0IGNsYXNzIEh0dHBCbG9iRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIGNvbnN0cnVjdG9yKFxuICAgIHJlYWRvbmx5IHN0YXR1czogbnVtYmVyLFxuICAgIG1lc3NhZ2U6IHN0cmluZyxcbiAgKSB7XG4gICAgc3VwZXIobWVzc2FnZSk7XG4gICAgdGhpcy5uYW1lID0gJ0h0dHBCbG9iRXJyb3InO1xuICB9XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgSHR0cEJsb2JTdG9yZU9wdGlvbnMge1xuICAvKiogV29ya2VyIG9yaWdpbiwgZS5nLiBgaHR0cHM6Ly9wZXJzb25hbC54LndvcmtlcnMuZGV2YC4gKi9cbiAgYmFzZVVybDogc3RyaW5nO1xuICAvKiogRGV2aWNlIHRva2VuIChCZWFyZXIpLiAqL1xuICB0b2tlbjogc3RyaW5nO1xuICAvKiogSW5qZWN0YWJsZSBmZXRjaCAodGVzdHMpLiBEZWZhdWx0cyB0byB0aGUgZ2xvYmFsLiAqL1xuICBmZXRjaEltcGw/OiB0eXBlb2YgZmV0Y2g7XG59XG5cbmV4cG9ydCBjbGFzcyBIdHRwQmxvYlN0b3JlIGltcGxlbWVudHMgQmxvYlN0b3JlIHtcbiAgcHJpdmF0ZSByZWFkb25seSBiYXNlOiBzdHJpbmc7XG4gIHByaXZhdGUgcmVhZG9ubHkgdG9rZW46IHN0cmluZztcbiAgcHJpdmF0ZSByZWFkb25seSBkb0ZldGNoOiB0eXBlb2YgZmV0Y2g7XG5cbiAgY29uc3RydWN0b3Iob3B0aW9uczogSHR0cEJsb2JTdG9yZU9wdGlvbnMpIHtcbiAgICB0aGlzLmJhc2UgPSBvcHRpb25zLmJhc2VVcmwucmVwbGFjZSgvXFwvKyQvLCAnJyk7XG4gICAgdGhpcy50b2tlbiA9IG9wdGlvbnMudG9rZW47XG4gICAgLy8gQm91bmQgbGlrZSB0aGUgcGx1Z2luJ3MgYGZldGNoSW1wbGAgc2VhbTogdGhpcyBjbGFzcyBjYWxscyBgZG9GZXRjaGBcbiAgICAvLyBkZXRhY2hlZCwgYW5kIGEgYmFyZSBnbG9iYWwgYGZldGNoYCBpcyBhbiBpbGxlZ2FsIGludm9jYXRpb24gaW5cbiAgICAvLyBDaHJvbWl1bSByZW5kZXJlcnMgKHJlYWwgT2JzaWRpYW4pLlxuICAgIHRoaXMuZG9GZXRjaCA9IG9wdGlvbnMuZmV0Y2hJbXBsID8/IGdsb2JhbFRoaXMuZmV0Y2guYmluZChnbG9iYWxUaGlzKTtcbiAgfVxuXG4gIC8qKiBHRVQgL2Jsb2IvOmhhc2ggXHUyMTkyIGJ5dGVzLCBvciBgdW5kZWZpbmVkYCBvbiA0MDQuICovXG4gIGFzeW5jIGdldChoYXNoOiBzdHJpbmcpOiBQcm9taXNlPFVpbnQ4QXJyYXkgfCB1bmRlZmluZWQ+IHtcbiAgICBjb25zdCByZXNwb25zZSA9IGF3YWl0IHRoaXMuZG9GZXRjaChgJHt0aGlzLmJhc2V9L2Jsb2IvJHtoYXNofWAsIHtcbiAgICAgIGhlYWRlcnM6IHsgYXV0aG9yaXphdGlvbjogYEJlYXJlciAke3RoaXMudG9rZW59YCB9LFxuICAgIH0pO1xuICAgIGlmIChyZXNwb25zZS5zdGF0dXMgPT09IDQwNCkgcmV0dXJuIHVuZGVmaW5lZDtcbiAgICBpZiAoIXJlc3BvbnNlLm9rKSB7XG4gICAgICB0aHJvdyBuZXcgSHR0cEJsb2JFcnJvcihyZXNwb25zZS5zdGF0dXMsIGF3YWl0IGVycm9yTWVzc2FnZShyZXNwb25zZSwgJ2ZldGNoIGJsb2InKSk7XG4gICAgfVxuICAgIHJldHVybiBuZXcgVWludDhBcnJheShhd2FpdCByZXNwb25zZS5hcnJheUJ1ZmZlcigpKTtcbiAgfVxuXG4gIC8qKiBQVVQgL2Jsb2IvOmhhc2ggXHUyMDE0IGlkZW1wb3RlbnQgcGVyIHRoZSBDQVMgY29udHJhY3QuICovXG4gIGFzeW5jIHB1dChoYXNoOiBzdHJpbmcsIGJ5dGVzOiBVaW50OEFycmF5KTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgcmVzcG9uc2UgPSBhd2FpdCB0aGlzLmRvRmV0Y2goYCR7dGhpcy5iYXNlfS9ibG9iLyR7aGFzaH1gLCB7XG4gICAgICBtZXRob2Q6ICdQVVQnLFxuICAgICAgaGVhZGVyczoge1xuICAgICAgICBhdXRob3JpemF0aW9uOiBgQmVhcmVyICR7dGhpcy50b2tlbn1gLFxuICAgICAgICAnY29udGVudC10eXBlJzogJ2FwcGxpY2F0aW9uL29jdGV0LXN0cmVhbScsXG4gICAgICB9LFxuICAgICAgYm9keTogYnl0ZXMgYXMgQm9keUluaXQsXG4gICAgfSk7XG4gICAgaWYgKCFyZXNwb25zZS5vaykge1xuICAgICAgdGhyb3cgbmV3IEh0dHBCbG9iRXJyb3IocmVzcG9uc2Uuc3RhdHVzLCBhd2FpdCBlcnJvck1lc3NhZ2UocmVzcG9uc2UsICdzdG9yZSBibG9iJykpO1xuICAgIH1cbiAgfVxufVxuXG5hc3luYyBmdW5jdGlvbiBlcnJvck1lc3NhZ2UocmVzcG9uc2U6IFJlc3BvbnNlLCB3aGF0OiBzdHJpbmcpOiBQcm9taXNlPHN0cmluZz4ge1xuICBjb25zdCBkZXRhaWwgPSAoYXdhaXQgcmVzcG9uc2UudGV4dCgpLmNhdGNoKCgpID0+ICcnKSkuc2xpY2UoMCwgMzAwKTtcbiAgcmV0dXJuIGRldGFpbCA9PT0gJydcbiAgICA/IGBmYWlsZWQgdG8gJHt3aGF0fTogSFRUUCAke3Jlc3BvbnNlLnN0YXR1c31gXG4gICAgOiBgZmFpbGVkIHRvICR7d2hhdH06IEhUVFAgJHtyZXNwb25zZS5zdGF0dXN9OiAke2RldGFpbH1gO1xufVxuIiwgIi8qKlxuICogVGhlIHBsdWdpbidzIHBlcnNpc3RlZCBzdGF0ZSAoYGRhdGEuanNvbmAsIHZpYSBgUGx1Z2luLmxvYWREYXRhL3NhdmVEYXRhYCkuXG4gKlxuICogS2VwdCBkZWxpYmVyYXRlbHkgc21hbGw6IGxpbmsgaWRlbnRpdHkgKHVybC90b2tlbi9kZXZpY2VJZC9kZXZpY2VOYW1lKSBwbHVzXG4gKiB0aGUgdHdvIGNsaWVudC1zaWRlIHRvZ2dsZXMuIFRoZSB0b2tlbiBpcyB0aGUgZGV2aWNlJ3MgbG9uZy1saXZlZFxuICogY3JlZGVudGlhbCAoQVJDSElURUNUVVJFIFx1MDBBNzMpIFx1MjAxNCBPYnNpZGlhbiBzdG9yZXMgZGF0YS5qc29uIGluc2lkZSB0aGUgdmF1bHQnc1xuICogYC5vYnNpZGlhbi9wbHVnaW5zL2AgZGlyLCB3aGljaCBzeW5jIGV4Y2x1ZGVzLCBzbyBpdCBuZXZlciBsZWF2ZXMgdGhlXG4gKiBtYWNoaW5lIHRocm91Z2ggc3luYyBpdHNlbGYuXG4gKi9cblxuaW1wb3J0IHsgUGxhdGZvcm0gfSBmcm9tICdvYnNpZGlhbic7XG5cbi8qKiBDbGllbnQtc2lkZSBzeW5jIGJlaGF2aW9yIHNldHRpbmdzICh0aGUgc2V0dGluZ3MtdGFiIHRvZ2dsZXMpLiAqL1xuZXhwb3J0IGludGVyZmFjZSBQbHVnaW5TeW5jU2V0dGluZ3Mge1xuICAvKipcbiAgICogUGVyaW9kaWMgZnVsbC1yZXNjYW4gaW50ZXJ2YWwgaW4gc2Vjb25kcyAoQVJDSElURUNUVVJFIFx1MDBBNzggbW9iaWxlIC9cbiAgICogZXh0ZXJuYWwgZWRpdHMpLiBgMGAgZGlzYWJsZXMgdGhlIHRpbWVyIFx1MjAxNCB2YXVsdCBldmVudHMgYW5kIGFwcC1vcGVuXG4gICAqIHJlY29uY2lsaWF0aW9uIHN0aWxsIHJ1bi5cbiAgICovXG4gIHJlc2NhbkludGVydmFsU2VjOiBudW1iZXI7XG4gIC8qKlxuICAgKiBPcHQgaW4gdG8gc3luY2luZyBgLm9ic2lkaWFuL2AgKEZSLTExKS4gVGhpcyBpcyB0aGUgY2xpZW50LXNpZGUgaW5pdGlhbFxuICAgKiBpZ25vcmUgc2V0dGluZzsgdGhlIHdvcmtlcidzIHBlci12YXVsdCBgVmF1bHRTZXR0aW5ncy5vYnNpZGlhblN5bmNgXG4gICAqIChkZWxpdmVyZWQgaW4gYGhlbGxvQWNrYCkgc3VwZXJzZWRlcyBpdCBvbmNlIGNvbm5lY3RlZC5cbiAgICovXG4gIG9ic2lkaWFuU3luYzogYm9vbGVhbjtcbn1cblxuLyoqIFNoYXBlIG9mIHRoZSBwbHVnaW4ncyBgZGF0YS5qc29uYC4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgVmF1bHRTeW5jUGx1Z2luRGF0YSB7XG4gIC8qKiBXb3JrZXIgb3JpZ2luLCBlLmcuIGBodHRwczovL3BlcnNvbmFsLngud29ya2Vycy5kZXZgIChlbXB0eSBwcmUtcGFpcikuICovXG4gIHVybDogc3RyaW5nO1xuICAvKiogTG9uZy1saXZlZCBkZXZpY2UgdG9rZW4gKGVtcHR5IHByZS1wYWlyKS4gKi9cbiAgdG9rZW46IHN0cmluZztcbiAgLyoqIERldmljZSBpZCBhc3NpZ25lZCBieSB0aGUgd29ya2VyIGF0IHBhaXIgdGltZS4gKi9cbiAgZGV2aWNlSWQ6IHN0cmluZztcbiAgLyoqIEh1bWFuLXJlYWRhYmxlIGRldmljZSBuYW1lIHNob3duIGluIHRoZSBkYXNoYm9hcmQncyBkZXZpY2UgbGlzdC4gKi9cbiAgZGV2aWNlTmFtZTogc3RyaW5nO1xuICBzZXR0aW5nczogUGx1Z2luU3luY1NldHRpbmdzO1xufVxuXG5leHBvcnQgY29uc3QgREVGQVVMVF9SRVNDQU5fSU5URVJWQUxfU0VDID0gMzA7XG5cbi8qKiBDaG9pY2VzIG9mZmVyZWQgYnkgdGhlIHNldHRpbmdzIGRyb3Bkb3duOiBzZWNvbmRzIFx1MjE5MiBsYWJlbC4gKi9cbmV4cG9ydCBjb25zdCBSRVNDQU5fSU5URVJWQUxfQ0hPSUNFUzogUmVhZG9ubHlBcnJheTx7IHZhbHVlOiBudW1iZXI7IGxhYmVsOiBzdHJpbmcgfT4gPSBbXG4gIHsgdmFsdWU6IDEwLCBsYWJlbDogJ0V2ZXJ5IDEwIHNlY29uZHMnIH0sXG4gIHsgdmFsdWU6IDMwLCBsYWJlbDogJ0V2ZXJ5IDMwIHNlY29uZHMnIH0sXG4gIHsgdmFsdWU6IDYwLCBsYWJlbDogJ0V2ZXJ5IG1pbnV0ZScgfSxcbiAgeyB2YWx1ZTogMzAwLCBsYWJlbDogJ0V2ZXJ5IDUgbWludXRlcycgfSxcbiAgeyB2YWx1ZTogMCwgbGFiZWw6ICdPZmYgKHZhdWx0IGV2ZW50cyBvbmx5KScgfSxcbl07XG5cbmV4cG9ydCBmdW5jdGlvbiBkZWZhdWx0UGx1Z2luRGF0YSgpOiBWYXVsdFN5bmNQbHVnaW5EYXRhIHtcbiAgcmV0dXJuIHtcbiAgICB1cmw6ICcnLFxuICAgIHRva2VuOiAnJyxcbiAgICBkZXZpY2VJZDogJycsXG4gICAgZGV2aWNlTmFtZTogJycsXG4gICAgc2V0dGluZ3M6IHtcbiAgICAgIHJlc2NhbkludGVydmFsU2VjOiBERUZBVUxUX1JFU0NBTl9JTlRFUlZBTF9TRUMsXG4gICAgICBvYnNpZGlhblN5bmM6IGZhbHNlLFxuICAgIH0sXG4gIH07XG59XG5cbi8qKiBDb2VyY2Ugd2hhdGV2ZXIgYGxvYWREYXRhKClgIHJldHVybmVkIGludG8gYSB3ZWxsLWZvcm1lZCBvYmplY3QuICovXG5leHBvcnQgZnVuY3Rpb24gbm9ybWFsaXplUGx1Z2luRGF0YShyYXc6IHVua25vd24pOiBWYXVsdFN5bmNQbHVnaW5EYXRhIHtcbiAgY29uc3QgYmFzZSA9IGRlZmF1bHRQbHVnaW5EYXRhKCk7XG4gIGlmICh0eXBlb2YgcmF3ICE9PSAnb2JqZWN0JyB8fCByYXcgPT09IG51bGwpIHJldHVybiBiYXNlO1xuICBjb25zdCBzb3VyY2UgPSByYXcgYXMgUGFydGlhbDxWYXVsdFN5bmNQbHVnaW5EYXRhPiAmIHsgc2V0dGluZ3M/OiBQYXJ0aWFsPFBsdWdpblN5bmNTZXR0aW5ncz4gfTtcbiAgcmV0dXJuIHtcbiAgICB1cmw6IHR5cGVvZiBzb3VyY2UudXJsID09PSAnc3RyaW5nJyA/IHNvdXJjZS51cmwgOiAnJyxcbiAgICB0b2tlbjogdHlwZW9mIHNvdXJjZS50b2tlbiA9PT0gJ3N0cmluZycgPyBzb3VyY2UudG9rZW4gOiAnJyxcbiAgICBkZXZpY2VJZDogdHlwZW9mIHNvdXJjZS5kZXZpY2VJZCA9PT0gJ3N0cmluZycgPyBzb3VyY2UuZGV2aWNlSWQgOiAnJyxcbiAgICBkZXZpY2VOYW1lOiB0eXBlb2Ygc291cmNlLmRldmljZU5hbWUgPT09ICdzdHJpbmcnID8gc291cmNlLmRldmljZU5hbWUgOiAnJyxcbiAgICBzZXR0aW5nczoge1xuICAgICAgcmVzY2FuSW50ZXJ2YWxTZWM6XG4gICAgICAgIHR5cGVvZiBzb3VyY2Uuc2V0dGluZ3M/LnJlc2NhbkludGVydmFsU2VjID09PSAnbnVtYmVyJyAmJiBzb3VyY2Uuc2V0dGluZ3MucmVzY2FuSW50ZXJ2YWxTZWMgPj0gMFxuICAgICAgICAgID8gTWF0aC5mbG9vcihzb3VyY2Uuc2V0dGluZ3MucmVzY2FuSW50ZXJ2YWxTZWMpXG4gICAgICAgICAgOiBERUZBVUxUX1JFU0NBTl9JTlRFUlZBTF9TRUMsXG4gICAgICBvYnNpZGlhblN5bmM6IHNvdXJjZS5zZXR0aW5ncz8ub2JzaWRpYW5TeW5jID09PSB0cnVlLFxuICAgIH0sXG4gIH07XG59XG5cbi8qKiBBIHZhdWx0IGlzIGxpbmtlZCBpZmYgcGFpciBpZGVudGl0eSBpcyBjb21wbGV0ZS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBpc0xpbmtlZChkYXRhOiBWYXVsdFN5bmNQbHVnaW5EYXRhKTogYm9vbGVhbiB7XG4gIHJldHVybiBkYXRhLnVybCAhPT0gJycgJiYgZGF0YS50b2tlbiAhPT0gJycgJiYgZGF0YS5kZXZpY2VJZCAhPT0gJyc7XG59XG5cbi8qKiBEZXZpY2UgdHlwZSBmb3IgdGhlIHdvcmtlciByZWdpc3RyeSwgZnJvbSB0aGUgcGxhdGZvcm0gKEZSLTIzKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBkZXRlY3REZXZpY2VUeXBlKCk6ICdkZXNrdG9wJyB8ICdtb2JpbGUnIHtcbiAgcmV0dXJuIFBsYXRmb3JtLmlzTW9iaWxlQXBwID8gJ21vYmlsZScgOiAnZGVza3RvcCc7XG59XG5cbi8qKiBEZWZhdWx0IGRldmljZSBuYW1lIHdoZW4gdGhlIHVzZXIgaGFzIG5vdCB0eXBlZCBvbmUuICovXG5leHBvcnQgZnVuY3Rpb24gZGVmYXVsdERldmljZU5hbWUoKTogc3RyaW5nIHtcbiAgaWYgKFBsYXRmb3JtLmlzTW9iaWxlQXBwKSB7XG4gICAgaWYgKFBsYXRmb3JtLmlzSW9zQXBwKSByZXR1cm4gJ2lQaG9uZS9pUGFkJztcbiAgICBpZiAoUGxhdGZvcm0uaXNBbmRyb2lkQXBwKSByZXR1cm4gJ0FuZHJvaWQnO1xuICAgIHJldHVybiAnT2JzaWRpYW4gbW9iaWxlJztcbiAgfVxuICByZXR1cm4gJ09ic2lkaWFuIGRlc2t0b3AnO1xufVxuIiwgIi8qKlxuICogTWluaW1hbCB0eXBlZCBjbGllbnQgZm9yIHRoZSB3b3JrZXIncyBIVFRQIHN1cmZhY2UgYXMgdGhlIHBsdWdpbiB1c2VzIGl0OlxuICogYEdFVCAvaGVhbHRoYCAoY2xhaW0tc3RhdGUgcHJvYmUgYmVmb3JlIHBhaXJpbmcpIGFuZCBgUE9TVCAvcGFpcmAgKHJlZGVlbSBhXG4gKiBwYWlyaW5nIGNvZGUsIEFSQ0hJVEVDVFVSRSBcdTAwQTczKS4gQnVpbHQgb24gYW4gaW5qZWN0YWJsZSBgZmV0Y2hgOyBmYWlsdXJlc1xuICogbWFwIHRvIHR5cGVkIGVycm9ycyB3aXRoIGFjdGlvbmFibGUgbWVzc2FnZXMgc28gdGhlIHNldHRpbmdzIFVJIGFuZCB0aGVcbiAqIGRlZXAtbGluayBoYW5kbGVyIG5ldmVyIHNlZSBhIHJhdyBgVHlwZUVycm9yOiBGYWlsZWQgdG8gZmV0Y2hgLlxuICovXG5cbi8qKiBBIHdvcmtlciBjYWxsIGZhaWxlZCAodW5yZWFjaGFibGUgb3IgdW5leHBlY3RlZCBIVFRQKS4gKi9cbmV4cG9ydCBjbGFzcyBXb3JrZXJBcGlFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgY29uc3RydWN0b3IoXG4gICAgbWVzc2FnZTogc3RyaW5nLFxuICAgIHJlYWRvbmx5IHN0YXR1cz86IG51bWJlcixcbiAgKSB7XG4gICAgc3VwZXIobWVzc2FnZSk7XG4gICAgdGhpcy5uYW1lID0gJ1dvcmtlckFwaUVycm9yJztcbiAgfVxufVxuXG4vKiogVGhlIHBhaXJpbmcgY29kZSB3YXMgcmVqZWN0ZWQgKGludmFsaWQgLyBleHBpcmVkIC8gYWxyZWFkeSB1c2VkKS4gKi9cbmV4cG9ydCBjbGFzcyBQYWlyUmVqZWN0ZWRFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgY29uc3RydWN0b3IobWVzc2FnZTogc3RyaW5nKSB7XG4gICAgc3VwZXIobWVzc2FnZSk7XG4gICAgdGhpcy5uYW1lID0gJ1BhaXJSZWplY3RlZEVycm9yJztcbiAgfVxufVxuXG4vKiogVGhlIHdvcmtlciBleGlzdHMgYnV0IGhhcyBub3QgYmVlbiBjbGFpbWVkIHlldCAoSFRUUCA0MjEgc2VtYW50aWNzKS4gKi9cbmV4cG9ydCBjbGFzcyBVbmNsYWltZWRXb3JrZXJFcnJvciBleHRlbmRzIEVycm9yIHtcbiAgY29uc3RydWN0b3IobWVzc2FnZTogc3RyaW5nKSB7XG4gICAgc3VwZXIobWVzc2FnZSk7XG4gICAgdGhpcy5uYW1lID0gJ1VuY2xhaW1lZFdvcmtlckVycm9yJztcbiAgfVxufVxuXG5leHBvcnQgaW50ZXJmYWNlIEhlYWx0aEluZm8ge1xuICByZWFjaGFibGU6IGJvb2xlYW47XG4gIGNsYWltZWQ6IGJvb2xlYW47XG4gIC8qKiBIdW1hbi1yZWFkYWJsZSByZWFzb24gd2hlbiB0aGUgd29ya2VyIGNvdWxkIG5vdCBiZSByZWFjaGVkLiAqL1xuICByZWFzb24/OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBpbnRlcmZhY2UgUGFpckNyZWRlbnRpYWxzIHtcbiAgdG9rZW46IHN0cmluZztcbiAgZGV2aWNlSWQ6IHN0cmluZztcbn1cblxuLyoqXG4gKiBOb3JtYWxpemUgdXNlciBpbnB1dCBpbnRvIGEgd29ya2VyIG9yaWdpbjogdHJpbXMsIHRvbGVyYXRlcyBhIG1pc3NpbmdcbiAqIHNjaGVtZSAoYXNzdW1lcyBodHRwcyksIGEgdHJhaWxpbmcgc2xhc2gsIGFuZCBzdHJheSBwYXRoIGNvbXBvbmVudHM7XG4gKiByZXR1cm5zIGBodHRwczovL2hvc3RgIHN0eWxlIG9yaWdpbi4gVGhyb3dzIGBXb3JrZXJBcGlFcnJvcmAgb24gZ2FyYmFnZS5cbiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG5vcm1hbGl6ZVdvcmtlclVybChpbnB1dDogc3RyaW5nKTogc3RyaW5nIHtcbiAgbGV0IGNhbmRpZGF0ZSA9IGlucHV0LnRyaW0oKTtcbiAgaWYgKGNhbmRpZGF0ZSA9PT0gJycpIHRocm93IG5ldyBXb3JrZXJBcGlFcnJvcignd29ya2VyIFVSTCBpcyBlbXB0eScpO1xuICBpZiAoIS9eW2EtekEtWl1bYS16QS1aMC05Ky4tXSo6XFwvXFwvLy50ZXN0KGNhbmRpZGF0ZSkpIGNhbmRpZGF0ZSA9IGBodHRwczovLyR7Y2FuZGlkYXRlfWA7XG4gIGxldCBvcmlnaW46IHN0cmluZztcbiAgdHJ5IHtcbiAgICBvcmlnaW4gPSBuZXcgVVJMKGNhbmRpZGF0ZSkub3JpZ2luO1xuICB9IGNhdGNoIHtcbiAgICB0aHJvdyBuZXcgV29ya2VyQXBpRXJyb3IoYGludmFsaWQgd29ya2VyIFVSTDogJHtKU09OLnN0cmluZ2lmeShpbnB1dCl9YCk7XG4gIH1cbiAgaWYgKCFvcmlnaW4uc3RhcnRzV2l0aCgnaHR0cDovLycpICYmICFvcmlnaW4uc3RhcnRzV2l0aCgnaHR0cHM6Ly8nKSkge1xuICAgIHRocm93IG5ldyBXb3JrZXJBcGlFcnJvcihgd29ya2VyIFVSTCBtdXN0IGJlIGh0dHAocyksIGdvdCAke29yaWdpbn1gKTtcbiAgfVxuICByZXR1cm4gb3JpZ2luO1xufVxuXG4vKiogR0VUIC9oZWFsdGggXHUyMDE0IG5ldmVyIHRocm93cyBmb3IgcmVhY2hhYmlsaXR5OyByZXBvcnRzIGNsYWltIHN0YXRlIGluc3RlYWQuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gZmV0Y2hIZWFsdGgoXG4gIG9yaWdpbjogc3RyaW5nLFxuICBmZXRjaEltcGw6IHR5cGVvZiBmZXRjaCxcbik6IFByb21pc2U8SGVhbHRoSW5mbz4ge1xuICBsZXQgcmVzcG9uc2U6IFJlc3BvbnNlO1xuICB0cnkge1xuICAgIHJlc3BvbnNlID0gYXdhaXQgZmV0Y2hJbXBsKGAke29yaWdpbn0vaGVhbHRoYCk7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIHJlYWNoYWJsZTogZmFsc2UsXG4gICAgICBjbGFpbWVkOiBmYWxzZSxcbiAgICAgIHJlYXNvbjogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpLFxuICAgIH07XG4gIH1cbiAgaWYgKCFyZXNwb25zZS5vaykge1xuICAgIHJldHVybiB7IHJlYWNoYWJsZTogZmFsc2UsIGNsYWltZWQ6IGZhbHNlLCByZWFzb246IGBIVFRQICR7cmVzcG9uc2Uuc3RhdHVzfWAgfTtcbiAgfVxuICBjb25zdCBib2R5ID0gKGF3YWl0IHJlc3BvbnNlLmpzb24oKS5jYXRjaCgoKSA9PiAoe30pKSkgYXMgeyBjbGFpbWVkPzogYm9vbGVhbiB9O1xuICByZXR1cm4geyByZWFjaGFibGU6IHRydWUsIGNsYWltZWQ6IGJvZHkuY2xhaW1lZCA9PT0gdHJ1ZSB9O1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFBhaXJSZXF1ZXN0UGFyYW1zIHtcbiAgb3JpZ2luOiBzdHJpbmc7XG4gIGNvZGU6IHN0cmluZztcbiAgZGV2aWNlTmFtZTogc3RyaW5nO1xuICBkZXZpY2VUeXBlOiAnZGVza3RvcCcgfCAnbW9iaWxlJztcbiAgZmV0Y2hJbXBsOiB0eXBlb2YgZmV0Y2g7XG59XG5cbi8qKlxuICogUE9TVCAvcGFpciBcdTIwMTQgcmVkZWVtIGEgb25lLXRpbWUgcGFpcmluZyBjb2RlIGZvciBsb25nLWxpdmVkIGRldmljZVxuICogY3JlZGVudGlhbHMuIFRocm93cyBgUGFpclJlamVjdGVkRXJyb3JgIChiYWQgY29kZSksIGBVbmNsYWltZWRXb3JrZXJFcnJvcmBcbiAqICg0MjEpLCBvciBgV29ya2VyQXBpRXJyb3JgICh1bnJlYWNoYWJsZSAvIHVuZXhwZWN0ZWQpLlxuICovXG5leHBvcnQgYXN5bmMgZnVuY3Rpb24gcmVxdWVzdFBhaXIocGFyYW1zOiBQYWlyUmVxdWVzdFBhcmFtcyk6IFByb21pc2U8UGFpckNyZWRlbnRpYWxzPiB7XG4gIGxldCByZXNwb25zZTogUmVzcG9uc2U7XG4gIHRyeSB7XG4gICAgcmVzcG9uc2UgPSBhd2FpdCBwYXJhbXMuZmV0Y2hJbXBsKGAke3BhcmFtcy5vcmlnaW59L3BhaXJgLCB7XG4gICAgICBtZXRob2Q6ICdQT1NUJyxcbiAgICAgIGhlYWRlcnM6IHsgJ2NvbnRlbnQtdHlwZSc6ICdhcHBsaWNhdGlvbi9qc29uJyB9LFxuICAgICAgYm9keTogSlNPTi5zdHJpbmdpZnkoe1xuICAgICAgICBjb2RlOiBwYXJhbXMuY29kZSxcbiAgICAgICAgZGV2aWNlTmFtZTogcGFyYW1zLmRldmljZU5hbWUsXG4gICAgICAgIGRldmljZVR5cGU6IHBhcmFtcy5kZXZpY2VUeXBlLFxuICAgICAgfSksXG4gICAgfSk7XG4gIH0gY2F0Y2ggKGVycm9yKSB7XG4gICAgdGhyb3cgbmV3IFdvcmtlckFwaUVycm9yKFxuICAgICAgYGNvdWxkIG5vdCByZWFjaCB0aGUgd29ya2VyIGF0ICR7cGFyYW1zLm9yaWdpbn06ICR7XG4gICAgICAgIGVycm9yIGluc3RhbmNlb2YgRXJyb3IgPyBlcnJvci5tZXNzYWdlIDogU3RyaW5nKGVycm9yKVxuICAgICAgfWAsXG4gICAgKTtcbiAgfVxuICAvLyBSZWFkIHRoZSBib2R5IG9uY2UgKGEgUmVzcG9uc2UgYm9keSBpcyBzaW5nbGUtdXNlKSBhbmQgcGFyc2UgZnJvbSB0ZXh0LlxuICBjb25zdCBkZXRhaWwgPSAoYXdhaXQgcmVzcG9uc2UudGV4dCgpLmNhdGNoKCgpID0+ICcnKSkudHJpbSgpO1xuICBpZiAocmVzcG9uc2Uuc3RhdHVzID09PSA0MjEpIHtcbiAgICB0aHJvdyBuZXcgVW5jbGFpbWVkV29ya2VyRXJyb3IoJ3RoaXMgd29ya2VyIGhhcyBub3QgYmVlbiBjbGFpbWVkIHlldCcpO1xuICB9XG4gIGlmIChyZXNwb25zZS5zdGF0dXMgPT09IDQwMSB8fCByZXNwb25zZS5zdGF0dXMgPT09IDQwMykge1xuICAgIHRocm93IG5ldyBQYWlyUmVqZWN0ZWRFcnJvcihcbiAgICAgICdwYWlyaW5nIGNvZGUgcmVqZWN0ZWQgXHUyMDE0IGNvZGVzIGFyZSBvbmUtdGltZSwgZXhwaXJlIGFmdGVyIDEwIG1pbnV0ZXMsIGFuZCBjb21lICcgK1xuICAgICAgICAnZnJvbSB0aGUgd29ya2VyIGRhc2hib2FyZC4gR2VuZXJhdGUgYSBmcmVzaCBvbmUgYW5kIHJldHJ5LicsXG4gICAgKTtcbiAgfVxuICBpZiAoIXJlc3BvbnNlLm9rKSB7XG4gICAgdGhyb3cgbmV3IFdvcmtlckFwaUVycm9yKFxuICAgICAgYHBhaXJpbmcgZmFpbGVkOiBIVFRQICR7cmVzcG9uc2Uuc3RhdHVzfSAke2RldGFpbC5zbGljZSgwLCAyMDApfWAudHJpbSgpLFxuICAgICAgcmVzcG9uc2Uuc3RhdHVzLFxuICAgICk7XG4gIH1cbiAgbGV0IGJvZHk6IHsgdG9rZW4/OiB1bmtub3duOyBkZXZpY2VJZD86IHVua25vd24gfTtcbiAgdHJ5IHtcbiAgICBib2R5ID0gSlNPTi5wYXJzZShkZXRhaWwpIGFzIHsgdG9rZW4/OiB1bmtub3duOyBkZXZpY2VJZD86IHVua25vd24gfTtcbiAgfSBjYXRjaCB7XG4gICAgdGhyb3cgbmV3IFdvcmtlckFwaUVycm9yKCdwYWlyaW5nIHJlcGx5IHdhcyBub3QgSlNPTicsIHJlc3BvbnNlLnN0YXR1cyk7XG4gIH1cbiAgaWYgKHR5cGVvZiBib2R5LnRva2VuICE9PSAnc3RyaW5nJyB8fCB0eXBlb2YgYm9keS5kZXZpY2VJZCAhPT0gJ3N0cmluZycpIHtcbiAgICB0aHJvdyBuZXcgV29ya2VyQXBpRXJyb3IoJ3BhaXJpbmcgcmVwbHkgd2FzIG1pc3NpbmcgdG9rZW4vZGV2aWNlSWQnLCByZXNwb25zZS5zdGF0dXMpO1xuICB9XG4gIHJldHVybiB7IHRva2VuOiBib2R5LnRva2VuLCBkZXZpY2VJZDogYm9keS5kZXZpY2VJZCB9O1xufVxuIiwgIi8qKlxuICogVGhlIHBhaXIgZmxvdyBzaGFyZWQgYnkgdGhlIHNldHRpbmdzIGZvcm0gYW5kIHRoZSBgb2JzaWRpYW46Ly9gIGRlZXAgbGlua1xuICogKEFSQ0hJVEVDVFVSRSBcdTAwQTczKTogcHJvYmUgYEdFVCAvaGVhbHRoYCBmaXJzdCBcdTIwMTQgYW4gKnVuY2xhaW1lZCogd29ya2VyIGdldHNcbiAqIGZyaWVuZGx5IG9uYm9hcmRpbmcgZ3VpZGFuY2UgaW5zdGVhZCBvZiBhIGNyeXB0aWMgNDIxIFx1MjAxNCB0aGVuIGBQT1NUIC9wYWlyYFxuICogYW5kIGhhbmQgdGhlIGNyZWRlbnRpYWxzIGJhY2sgdG8gYmUgcGVyc2lzdGVkLlxuICovXG5cbmltcG9ydCB7XG4gIGZldGNoSGVhbHRoLFxuICBub3JtYWxpemVXb3JrZXJVcmwsXG4gIHJlcXVlc3RQYWlyLFxuICBQYWlyUmVqZWN0ZWRFcnJvcixcbiAgVW5jbGFpbWVkV29ya2VyRXJyb3IsXG4gIFdvcmtlckFwaUVycm9yLFxufSBmcm9tICcuL3dvcmtlcmFwaS5qcyc7XG5cbmV4cG9ydCB0eXBlIFBhaXJPdXRjb21lID1cbiAgfCB7IHN0YXR1czogJ3BhaXJlZCc7IHVybDogc3RyaW5nOyB0b2tlbjogc3RyaW5nOyBkZXZpY2VJZDogc3RyaW5nIH1cbiAgfCB7IHN0YXR1czogJ3VuY2xhaW1lZCc7IHVybDogc3RyaW5nOyBndWlkYW5jZTogc3RyaW5nIH1cbiAgfCB7IHN0YXR1czogJ3VucmVhY2hhYmxlJzsgdXJsOiBzdHJpbmc7IHJlYXNvbjogc3RyaW5nIH1cbiAgfCB7IHN0YXR1czogJ3JlamVjdGVkJzsgdXJsOiBzdHJpbmc7IHJlYXNvbjogc3RyaW5nIH1cbiAgfCB7IHN0YXR1czogJ2ludmFsaWQtdXJsJzsgaW5wdXQ6IHN0cmluZyB9O1xuXG5leHBvcnQgaW50ZXJmYWNlIFBhaXJGbG93UGFyYW1zIHtcbiAgLyoqIFdvcmtlciBVUkwgYXMgdHlwZWQgLyBkZWVwLWxpbmtlZCAoc2NoZW1lbGVzcyBpcyB0b2xlcmF0ZWQpLiAqL1xuICB1cmw6IHN0cmluZztcbiAgLyoqIE9uZS10aW1lIHBhaXJpbmcgY29kZSBmcm9tIHRoZSB3b3JrZXIgZGFzaGJvYXJkLiAqL1xuICBjb2RlOiBzdHJpbmc7XG4gIGRldmljZU5hbWU6IHN0cmluZztcbiAgZGV2aWNlVHlwZTogJ2Rlc2t0b3AnIHwgJ21vYmlsZSc7XG4gIGZldGNoSW1wbDogdHlwZW9mIGZldGNoO1xufVxuXG4vKiogT25ib2FyZGluZyB0ZXh0IHNob3duIHdoZW4gdGhlIHdvcmtlciBpcyBkZXBsb3llZCBidXQgbm90IGNsYWltZWQuICovXG5leHBvcnQgZnVuY3Rpb24gdW5jbGFpbWVkR3VpZGFuY2UodXJsOiBzdHJpbmcpOiBzdHJpbmcge1xuICByZXR1cm4gW1xuICAgIGBUaGUgd29ya2VyIGF0ICR7dXJsfSBpcyBkZXBsb3llZCBidXQgbm90IGNsYWltZWQgeWV0LiBGaW5pc2ggc2V0dXAgaW4gYSBicm93c2VyOmAsXG4gICAgJycsXG4gICAgYDEuIE9wZW4gJHt1cmx9YCxcbiAgICAnMi4gU2V0IHRoZSBhZG1pbiBwYXNzcGhyYXNlIGFuZCBuYW1lIHRoZSB2YXVsdCAodGhlIGNsYWltIHBhZ2UpLicsXG4gICAgJzMuIE9uIHRoZSBkYXNoYm9hcmQsIGNyZWF0ZSBhIHBhaXJpbmcgY29kZSAoRGV2aWNlcyBcdTIxOTIgUGFpciBuZXcgZGV2aWNlKS4nLFxuICAgICc0LiBFbnRlciB0aGF0IGNvZGUgaGVyZSAob3IgY2xpY2sgdGhlIG9ic2lkaWFuOi8vIGxpbmsgdGhlIGRhc2hib2FyZCBzaG93cykgYW5kIHBhaXIuJyxcbiAgXS5qb2luKCdcXG4nKTtcbn1cblxuLyoqXG4gKiBSdW4gdGhlIHBhaXIgZmxvdy4gTmV2ZXIgdGhyb3dzIFx1MjAxNCBldmVyeSBmYWlsdXJlIG1vZGUgaXMgYSB0eXBlZCBvdXRjb21lIHRoZVxuICogVUkgY2FuIHJlbmRlciAoYW5kIHRoZSBkZWVwLWxpbmsgaGFuZGxlciBjYW4gdHVybiBpbnRvIGEgTm90aWNlKS5cbiAqL1xuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHBhaXJXaXRoV29ya2VyKHBhcmFtczogUGFpckZsb3dQYXJhbXMpOiBQcm9taXNlPFBhaXJPdXRjb21lPiB7XG4gIGxldCBvcmlnaW46IHN0cmluZztcbiAgdHJ5IHtcbiAgICBvcmlnaW4gPSBub3JtYWxpemVXb3JrZXJVcmwocGFyYW1zLnVybCk7XG4gIH0gY2F0Y2gge1xuICAgIHJldHVybiB7IHN0YXR1czogJ2ludmFsaWQtdXJsJywgaW5wdXQ6IHBhcmFtcy51cmwgfTtcbiAgfVxuXG4gIGNvbnN0IGhlYWx0aCA9IGF3YWl0IGZldGNoSGVhbHRoKG9yaWdpbiwgcGFyYW1zLmZldGNoSW1wbCk7XG4gIGlmICghaGVhbHRoLnJlYWNoYWJsZSkge1xuICAgIHJldHVybiB7XG4gICAgICBzdGF0dXM6ICd1bnJlYWNoYWJsZScsXG4gICAgICB1cmw6IG9yaWdpbixcbiAgICAgIHJlYXNvbjpcbiAgICAgICAgYCR7aGVhbHRoLnJlYXNvbiA/PyAndW5rbm93biBlcnJvcid9IFx1MjAxNCBjaGVjayB0aGUgVVJMLCB5b3VyIG5ldHdvcmssIGFuZCB0aGF0IHRoZSBgICtcbiAgICAgICAgJ3dvcmtlciBpcyBkZXBsb3llZC4nLFxuICAgIH07XG4gIH1cbiAgaWYgKCFoZWFsdGguY2xhaW1lZCkge1xuICAgIHJldHVybiB7IHN0YXR1czogJ3VuY2xhaW1lZCcsIHVybDogb3JpZ2luLCBndWlkYW5jZTogdW5jbGFpbWVkR3VpZGFuY2Uob3JpZ2luKSB9O1xuICB9XG5cbiAgdHJ5IHtcbiAgICBjb25zdCBjcmVkZW50aWFscyA9IGF3YWl0IHJlcXVlc3RQYWlyKHtcbiAgICAgIG9yaWdpbixcbiAgICAgIGNvZGU6IHBhcmFtcy5jb2RlLFxuICAgICAgZGV2aWNlTmFtZTogcGFyYW1zLmRldmljZU5hbWUsXG4gICAgICBkZXZpY2VUeXBlOiBwYXJhbXMuZGV2aWNlVHlwZSxcbiAgICAgIGZldGNoSW1wbDogcGFyYW1zLmZldGNoSW1wbCxcbiAgICB9KTtcbiAgICByZXR1cm4geyBzdGF0dXM6ICdwYWlyZWQnLCB1cmw6IG9yaWdpbiwgLi4uY3JlZGVudGlhbHMgfTtcbiAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICBpZiAoZXJyb3IgaW5zdGFuY2VvZiBVbmNsYWltZWRXb3JrZXJFcnJvcikge1xuICAgICAgcmV0dXJuIHsgc3RhdHVzOiAndW5jbGFpbWVkJywgdXJsOiBvcmlnaW4sIGd1aWRhbmNlOiB1bmNsYWltZWRHdWlkYW5jZShvcmlnaW4pIH07XG4gICAgfVxuICAgIGlmIChlcnJvciBpbnN0YW5jZW9mIFBhaXJSZWplY3RlZEVycm9yKSB7XG4gICAgICByZXR1cm4geyBzdGF0dXM6ICdyZWplY3RlZCcsIHVybDogb3JpZ2luLCByZWFzb246IGVycm9yLm1lc3NhZ2UgfTtcbiAgICB9XG4gICAgY29uc3QgcmVhc29uID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpO1xuICAgIHJldHVybiB7IHN0YXR1czogJ3JlamVjdGVkJywgdXJsOiBvcmlnaW4sIHJlYXNvbiB9O1xuICB9XG59XG5cbi8qKiBSZW5kZXIgYW55IG91dGNvbWUgYXMgdXNlci1mYWNpbmcgdGV4dCAoTm90aWNlcywgZGVlcC1saW5rIGZlZWRiYWNrKS4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYWlyT3V0Y29tZU1lc3NhZ2Uob3V0Y29tZTogUGFpck91dGNvbWUpOiBzdHJpbmcge1xuICBzd2l0Y2ggKG91dGNvbWUuc3RhdHVzKSB7XG4gICAgY2FzZSAncGFpcmVkJzpcbiAgICAgIHJldHVybiBgUGFpcmVkIHdpdGggJHtvdXRjb21lLnVybH0gXHUyMDE0IHN5bmNpbmcgbm93LmA7XG4gICAgY2FzZSAndW5jbGFpbWVkJzpcbiAgICAgIHJldHVybiBvdXRjb21lLmd1aWRhbmNlO1xuICAgIGNhc2UgJ3VucmVhY2hhYmxlJzpcbiAgICAgIHJldHVybiBgQ291bGQgbm90IHJlYWNoIHRoZSB3b3JrZXI6ICR7b3V0Y29tZS5yZWFzb259YDtcbiAgICBjYXNlICdyZWplY3RlZCc6XG4gICAgICByZXR1cm4gYFBhaXJpbmcgZmFpbGVkOiAke291dGNvbWUucmVhc29ufWA7XG4gICAgY2FzZSAnaW52YWxpZC11cmwnOlxuICAgICAgcmV0dXJuIGBUaGF0IGRvZXMgbm90IGxvb2sgbGlrZSBhIHdvcmtlciBVUkw6ICR7SlNPTi5zdHJpbmdpZnkob3V0Y29tZS5pbnB1dCl9YDtcbiAgfVxufVxuIiwgIi8qKlxuICogYG9ic2lkaWFuOi8vdmF1bHRzeW5jZm9yYWdlbnRzL3BhaXI/dXJsPTx3b3JrZXI+JmNvZGU9PHBhaXJpbmc+YCBkZWVwLWxpbmtcbiAqIGhhbmRsaW5nIChBUkNISVRFQ1RVUkUgXHUwMEE3Myk6IHRoZSBkYXNoYm9hcmQgcmVuZGVycyB0aGlzIGxpbmsgKGFuZCB0aGUgUVJcbiAqIGVxdWl2YWxlbnQpIHNvIGEgbmV3IGRldmljZSBwYWlycyB3aXRoIHplcm8gdHlwaW5nLlxuICpcbiAqIFRoZSBoYW5kbGVyIGlzIHJlZ2lzdGVyZWQgZm9yIHRoZSBhY3Rpb24gYHZhdWx0c3luY2ZvcmFnZW50c2AuIE9ic2lkaWFuXG4gKiBidWlsZHMgZGlmZmVyIHN1YnRseSBpbiBob3cgdGhlIGAvcGFpcmAgcGF0aCBzZWdtZW50IG9mIGEgcHJvdG9jb2wgVVJMIGlzXG4gKiBtYXRjaGVkLCBzbyB0aGUgc2FtZSBoYW5kbGVyIGlzIHJlZ2lzdGVyZWQgZm9yIGB2YXVsdHN5bmNmb3JhZ2VudHMvcGFpcmBcbiAqIHRvbyBcdTIwMTQgd2hpY2hldmVyIHNwZWxsaW5nIGEgZ2l2ZW4gYnVpbGQgcmVzb2x2ZXMsIHRoZSBsaW5rIHdvcmtzLiBXaGVuXG4gKiBgdXJsYC9gY29kZWAgYXJlIGFic2VudCB0aGUgaW52b2NhdGlvbiBpcyBpZ25vcmVkIChhIHN0cmF5IHByb3RvY29sIGhpdFxuICogbXVzdCBub3Qgc3BhbSBhIE5vdGljZSk7IGEgKm1hbGZvcm1lZCogcGFpciBsaW5rIChvbmUgb2YgdGhlIHR3byBwcmVzZW50KVxuICogZ2V0cyBhbiBhY3Rpb25hYmxlIGVycm9yLlxuICovXG5cbmltcG9ydCB7IE5vdGljZSB9IGZyb20gJ29ic2lkaWFuJztcblxuLyoqIFByb3RvY29sIGFjdGlvbiAodGhlIGBvYnNpZGlhbjovL2AgXCJob3N0XCIgcGFydCkuICovXG5leHBvcnQgY29uc3QgUFJPVE9DT0xfQUNUSU9OID0gJ3ZhdWx0c3luY2ZvcmFnZW50cyc7XG5cbi8qKiBIYW5kbGVyIHNoYXBlIChPYnNpZGlhbiBwYXNzZXMgaXRzIGRlY29kZWQgcXVlcnkgcGFyYW1zKS4gKi9cbmV4cG9ydCB0eXBlIFByb3RvY29sSGFuZGxlciA9IChwYXJhbXM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KSA9PiB2b2lkO1xuXG4vKiogSG93IGhhbmRsZXJzIGdldCByZWdpc3RlcmVkIFx1MjAxNCBgUGx1Z2luLnJlZ2lzdGVyT2JzaWRpYW5Qcm90b2NvbEhhbmRsZXJgLiAqL1xuZXhwb3J0IHR5cGUgUHJvdG9jb2xSZWdpc3RyYXIgPSAoYWN0aW9uOiBzdHJpbmcsIGhhbmRsZXI6IFByb3RvY29sSGFuZGxlcikgPT4gdm9pZDtcblxuLyoqIFBhcnNlZCBwYWlyIGRlZXAgbGluay4gKi9cbmV4cG9ydCBpbnRlcmZhY2UgUGFpckRlZXBMaW5rIHtcbiAgdXJsOiBzdHJpbmc7XG4gIGNvZGU6IHN0cmluZztcbn1cblxuZXhwb3J0IHR5cGUgRGVlcExpbmtQYXJzZVJlc3VsdCA9XG4gIHwgeyBvazogdHJ1ZTsgbGluazogUGFpckRlZXBMaW5rIH1cbiAgfCB7IG9rOiBmYWxzZTsgZXJyb3I6IHN0cmluZyB9O1xuXG4vKipcbiAqIEV4dHJhY3QgYHt1cmwsIGNvZGV9YCBmcm9tIE9ic2lkaWFuJ3MgZGVjb2RlZCBxdWVyeSBwYXJhbXMuIFZhbHVlcyBhcnJpdmVcbiAqIGFzIHN0cmluZ3MgKHVzdWFsbHkgYWxyZWFkeSBkZWNvZGVkOyBhIGRvdWJsZS1lbmNvZGVkIGAleHhgIHJlbW5hbnQgaXNcbiAqIGRlY29kZWQgb25jZSBtb3JlLCBiZXN0IGVmZm9ydCkuXG4gKi9cbmV4cG9ydCBmdW5jdGlvbiBwYXJzZVBhaXJEZWVwTGluayhwYXJhbXM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+KTogRGVlcExpbmtQYXJzZVJlc3VsdCB7XG4gIGNvbnN0IHVybCA9IHBhcmFtVGV4dChwYXJhbXMsICd1cmwnKTtcbiAgY29uc3QgY29kZSA9IHBhcmFtVGV4dChwYXJhbXMsICdjb2RlJyk7XG4gIGlmICh1cmwgPT09ICcnICYmIGNvZGUgPT09ICcnKSB7XG4gICAgcmV0dXJuIHsgb2s6IGZhbHNlLCBlcnJvcjogJ25vIHBhaXJpbmcgcGFyYW1ldGVycycgfTtcbiAgfVxuICBpZiAodXJsID09PSAnJykgcmV0dXJuIHsgb2s6IGZhbHNlLCBlcnJvcjogJ2RlZXAgbGluayBpcyBtaXNzaW5nIHRoZSB3b3JrZXIgVVJMICg/dXJsPVx1MjAyNiknIH07XG4gIGlmIChjb2RlID09PSAnJykgcmV0dXJuIHsgb2s6IGZhbHNlLCBlcnJvcjogJ2RlZXAgbGluayBpcyBtaXNzaW5nIHRoZSBwYWlyaW5nIGNvZGUgKD9jb2RlPVx1MjAyNiknIH07XG4gIHJldHVybiB7IG9rOiB0cnVlLCBsaW5rOiB7IHVybCwgY29kZSB9IH07XG59XG5cbmZ1bmN0aW9uIHBhcmFtVGV4dChwYXJhbXM6IFJlY29yZDxzdHJpbmcsIHVua25vd24+LCBrZXk6IHN0cmluZyk6IHN0cmluZyB7XG4gIGNvbnN0IHZhbHVlID0gcGFyYW1zW2tleV07XG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdudW1iZXInKSByZXR1cm4gU3RyaW5nKHZhbHVlKTtcbiAgaWYgKHR5cGVvZiB2YWx1ZSAhPT0gJ3N0cmluZycpIHJldHVybiAnJztcbiAgY29uc3QgdHJpbW1lZCA9IHZhbHVlLnRyaW0oKTtcbiAgLy8gT2JzaWRpYW4gaGFuZHMgb3ZlciBkZWNvZGVkIHZhbHVlczsgdG9sZXJhdGUgb25lIHN1cnZpdmluZyByb3VuZCBvZlxuICAvLyBwZXJjZW50LWVuY29kaW5nIGZyb20gb3Zlci1lYWdlciBsaW5rIGdlbmVyYXRvcnMuXG4gIGlmICh0cmltbWVkLmluY2x1ZGVzKCclJykpIHtcbiAgICB0cnkge1xuICAgICAgcmV0dXJuIGRlY29kZVVSSUNvbXBvbmVudCh0cmltbWVkKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiB0cmltbWVkO1xuICAgIH1cbiAgfVxuICByZXR1cm4gdHJpbW1lZDtcbn1cblxuLyoqXG4gKiBSZWdpc3RlciB0aGUgcGFpciBkZWVwLWxpbmsgaGFuZGxlciAoY2FsbCBmcm9tIGBvbmxvYWRgIHdpdGggdGhlIHBsdWdpbidzXG4gKiBvd24gcmVnaXN0cmFyKS4gYG9uUGFpcmAgcnVucyB0aGUgc2hhcmVkIHBhaXIgZmxvdyAoc2V0dGluZ3MgKyBOb3RpY2VzXG4gKiBsaXZlIGluIHRoZSBwbHVnaW4pOyBpdHMgZXJyb3JzIGFyZSBsb2dnZWQsIG5ldmVyIGZhdGFsLlxuICovXG5leHBvcnQgZnVuY3Rpb24gcmVnaXN0ZXJQYWlyUHJvdG9jb2xIYW5kbGVyKFxuICByZWdpc3RlcjogUHJvdG9jb2xSZWdpc3RyYXIsXG4gIG9uUGFpcjogKGxpbms6IFBhaXJEZWVwTGluaykgPT4gUHJvbWlzZTx2b2lkPixcbik6IHZvaWQge1xuICBjb25zdCBoYW5kbGVyOiBQcm90b2NvbEhhbmRsZXIgPSAocGFyYW1zKSA9PiB7XG4gICAgY29uc3QgcGFyc2VkID0gcGFyc2VQYWlyRGVlcExpbmsocGFyYW1zKTtcbiAgICBpZiAoIXBhcnNlZC5vaykge1xuICAgICAgLy8gTWlzc2luZyBib3RoIFx1MjE5MiBhIGJhcmUgb2JzaWRpYW46Ly92YXVsdHN5bmNmb3JhZ2VudHMgaGl0OyBzdGF5IHF1aWV0LlxuICAgICAgaWYgKHBhcnNlZC5lcnJvciAhPT0gJ25vIHBhaXJpbmcgcGFyYW1ldGVycycpIHtcbiAgICAgICAgbmV3IE5vdGljZShgVmF1bHRTeW5jIGRlZXAgbGluazogJHtwYXJzZWQuZXJyb3J9YCk7XG4gICAgICB9XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHZvaWQgb25QYWlyKHBhcnNlZC5saW5rKS5jYXRjaCgoZXJyb3I6IHVua25vd24pID0+IHtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJ1t2c2FdIGRlZXAtbGluayBwYWlyaW5nIGZhaWxlZCcsIGVycm9yKTtcbiAgICAgIG5ldyBOb3RpY2UoJ1ZhdWx0U3luYzogcGFpcmluZyB2aWEgbGluayBmYWlsZWQgXHUyMDE0IHNlZSB0aGUgY29uc29sZSBmb3IgZGV0YWlscy4nKTtcbiAgICB9KTtcbiAgfTtcbiAgcmVnaXN0ZXIoUFJPVE9DT0xfQUNUSU9OLCBoYW5kbGVyKTtcbiAgLy8gUmVnaXN0ZXIgdGhlIHBhdGgtc3BlbGxlZCBhY3Rpb24gdG9vIChidWlsZC1kZXBlbmRlbnQgbWF0Y2hpbmcpLlxuICByZWdpc3RlcihgJHtQUk9UT0NPTF9BQ1RJT059L3BhaXJgLCBoYW5kbGVyKTtcbn1cbiIsICIvKipcbiAqIFJlY29ubmVjdCBwb2xpY3kgKHBsdWdpbiBzY29wZSBpdGVtICM1KTogZXhwb25lbnRpYWwgYmFja29mZiB3aXRoIGppdHRlcixcbiAqIGNhcHBlZCBhdCA2MCBzLiBUaGUgcGx1Z2luJ3MgMSBzIHN1cGVydmlzaW9uIHRpY2sgYXNrcyB0aGUgc3VwZXJ2aXNvciB3aGF0XG4gKiB0byBkbyB3aGVuZXZlciB0aGUgY2xpZW50IHJlcG9ydHMgYGRpc2Nvbm5lY3RlZGA7IGEgc2NoZWR1bGVkIHJlY29ubmVjdCBpc1xuICogYSBzaW5nbGUgZmxpZ2h0IFx1MjAxNCBuZXZlciBhIHN0YWNrIG9mIHJldHJpZXMuXG4gKi9cblxuaW1wb3J0IHR5cGUgeyBTeW5jQ2xpZW50U3RhdGUgfSBmcm9tICdAdnNhL2NvcmUnO1xuXG5leHBvcnQgaW50ZXJmYWNlIEJhY2tvZmZPcHRpb25zIHtcbiAgLyoqIEZpcnN0IGF0dGVtcHQgZGVsYXkgKGRlZmF1bHQgMSBzKS4gKi9cbiAgYmFzZU1zPzogbnVtYmVyO1xuICAvKiogQ2VpbGluZyAoZGVmYXVsdCA2MCBzIHBlciB0aGUgcGx1Z2luIHNwZWMpLiAqL1xuICBjYXBNcz86IG51bWJlcjtcbiAgLyoqIEppdHRlciBmcmFjdGlvbiBhcm91bmQgdGhlIGV4cG9uZW50aWFsIHZhbHVlLCAwXHUyMDEzMC41IChkZWZhdWx0IDAuMykuICovXG4gIGppdHRlcj86IG51bWJlcjtcbiAgLyoqIEluamVjdGFibGUgcmFuZG9tbmVzcyAodGVzdHMpLiBEZWZhdWx0IGBNYXRoLnJhbmRvbWAuICovXG4gIHJhbmRvbT86ICgpID0+IG51bWJlcjtcbn1cblxuZXhwb3J0IGNvbnN0IERFRkFVTFRfUkVDT05ORUNUX0JBU0VfTVMgPSAxMDAwO1xuZXhwb3J0IGNvbnN0IERFRkFVTFRfUkVDT05ORUNUX0NBUF9NUyA9IDYwXzAwMDtcblxuLyoqXG4gKiBEZWxheSBmb3IgYXR0ZW1wdCBOICgwLWJhc2VkKTogYG1pbihjYXAsIGJhc2UgXHUwMEI3IDJeYXR0ZW1wdClgIHdpdGggc3ltbWV0cmljXG4gKiBtdWx0aXBsaWNhdGl2ZSBqaXR0ZXIsIGZsb29yZWQgYXQgMjUwIG1zLlxuICovXG5leHBvcnQgZnVuY3Rpb24gYmFja29mZkRlbGF5TXMoYXR0ZW1wdDogbnVtYmVyLCBvcHRpb25zOiBCYWNrb2ZmT3B0aW9ucyA9IHt9KTogbnVtYmVyIHtcbiAgY29uc3QgYmFzZSA9IG9wdGlvbnMuYmFzZU1zID8/IERFRkFVTFRfUkVDT05ORUNUX0JBU0VfTVM7XG4gIGNvbnN0IGNhcCA9IG9wdGlvbnMuY2FwTXMgPz8gREVGQVVMVF9SRUNPTk5FQ1RfQ0FQX01TO1xuICBjb25zdCBqaXR0ZXIgPSBvcHRpb25zLmppdHRlciA/PyAwLjM7XG4gIGNvbnN0IHJhbmRvbSA9IG9wdGlvbnMucmFuZG9tID8/IE1hdGgucmFuZG9tO1xuICBjb25zdCBleHBvbmVudGlhbCA9IE1hdGgubWluKGNhcCwgYmFzZSAqIDIgKiogYXR0ZW1wdCk7XG4gIGNvbnN0IGZhY3RvciA9IDEgKyAocmFuZG9tKCkgKiAyIC0gMSkgKiBqaXR0ZXI7XG4gIHJldHVybiBNYXRoLnJvdW5kKE1hdGgubWluKGNhcCwgTWF0aC5tYXgoMjUwLCBleHBvbmVudGlhbCAqIGZhY3RvcikpKTtcbn1cblxuZXhwb3J0IHR5cGUgUmVjb25uZWN0RGVjaXNpb24gPSB7IGFjdGlvbjogJ3JlY29ubmVjdCc7IGRlbGF5TXM6IG51bWJlciB9IHwgeyBhY3Rpb246ICd3YWl0JyB9O1xuXG4vKipcbiAqIFRyYWNrcyByZWNvbm5lY3QgYXR0ZW1wdHMgYWNyb3NzIHRoZSBzdXBlcnZpc2lvbiB0aWNrLiBOb24tZGlzY29ubmVjdGVkXG4gKiBzdGF0ZXMgcmVzZXQgdGhlIGJhY2tvZmYgbGFkZGVyIChhIHN1Y2Nlc3NmdWwgY3ljbGUgbWVhbnMgdGhlIG5ldHdvcmsgaXNcbiAqIGJhY2spOyBgc2NoZWR1bGVkYCBrZWVwcyBleGFjdGx5IG9uZSByZWNvbm5lY3QgaW4gZmxpZ2h0LlxuICovXG5leHBvcnQgY2xhc3MgUmVjb25uZWN0U3VwZXJ2aXNvciB7XG4gIHByaXZhdGUgYXR0ZW1wdCA9IDA7XG4gIHByaXZhdGUgc2NoZWR1bGVkID0gZmFsc2U7XG4gIHByaXZhdGUgcmVhZG9ubHkgb3B0aW9uczogQmFja29mZk9wdGlvbnM7XG5cbiAgY29uc3RydWN0b3Iob3B0aW9uczogQmFja29mZk9wdGlvbnMgPSB7fSkge1xuICAgIHRoaXMub3B0aW9ucyA9IG9wdGlvbnM7XG4gIH1cblxuICAvKiogQ2FsbCBlYWNoIHRpY2s7IG9uIGByZWNvbm5lY3RgLCBmb2xsb3cgdXAgd2l0aCBgYWNrbm93bGVkZ2VkKClgLiAqL1xuICBjb25zaWRlcihzdGF0ZTogU3luY0NsaWVudFN0YXRlKTogUmVjb25uZWN0RGVjaXNpb24ge1xuICAgIGlmIChzdGF0ZSAhPT0gJ2Rpc2Nvbm5lY3RlZCcpIHtcbiAgICAgIHRoaXMuYXR0ZW1wdCA9IDA7XG4gICAgICB0aGlzLnNjaGVkdWxlZCA9IGZhbHNlO1xuICAgICAgcmV0dXJuIHsgYWN0aW9uOiAnd2FpdCcgfTtcbiAgICB9XG4gICAgaWYgKHRoaXMuc2NoZWR1bGVkKSByZXR1cm4geyBhY3Rpb246ICd3YWl0JyB9O1xuICAgIHJldHVybiB7IGFjdGlvbjogJ3JlY29ubmVjdCcsIGRlbGF5TXM6IGJhY2tvZmZEZWxheU1zKHRoaXMuYXR0ZW1wdCwgdGhpcy5vcHRpb25zKSB9O1xuICB9XG5cbiAgLyoqIE1hcmsgdGhlIHJldHVybmVkIHJlY29ubmVjdCBhcyBpbiBmbGlnaHQgKG9uZSBhdCBhIHRpbWUpLiAqL1xuICBhY2tub3dsZWRnZWQoKTogdm9pZCB7XG4gICAgdGhpcy5hdHRlbXB0ICs9IDE7XG4gICAgdGhpcy5zY2hlZHVsZWQgPSB0cnVlO1xuICB9XG5cbiAgLyoqIFRoZSBpbi1mbGlnaHQgcmVjb25uZWN0IHNldHRsZWQgKHN1Y2Nlc3Mgb3IgZmFpbHVyZSkuICovXG4gIHNldHRsZWQoKTogdm9pZCB7XG4gICAgdGhpcy5zY2hlZHVsZWQgPSBmYWxzZTtcbiAgfVxuXG4gIC8qKiBDb21wbGV0ZWQgcmVjb25uZWN0IGF0dGVtcHRzIHNpbmNlIHRoZSBsYXN0IGhlYWx0aHkgc3RhdGUuICovXG4gIGdldCBhdHRlbXB0cygpOiBudW1iZXIge1xuICAgIHJldHVybiB0aGlzLmF0dGVtcHQ7XG4gIH1cbn1cbiIsICIvKipcbiAqIFRoZSBzZXR0aW5ncyB0YWIgKHBsdWdpbiBzY29wZSBpdGVtICM2KTogd29ya2VyIFVSTCArIGRldmljZSBuYW1lICtcbiAqIHBhaXJpbmcgY29kZSArIFwiUGFpclwiICh3aXRoIHVuY2xhaW1lZC13b3JrZXIgb25ib2FyZGluZyBndWlkYW5jZSksIFwiU3luY1xuICogbm93XCIsIHVubGluay13aXRoLWNvbmZpcm0sIHJlc2Nhbi1pbnRlcnZhbCBhbmQgYC5vYnNpZGlhbi9gIHRvZ2dsZXMsIGFuZCBhXG4gKiBsaXZlIHN0YXR1cyByZWFkb3V0IChjb25uZWN0ZWQsIGxhc3Qgc3luYywgcGVuZGluZywgY29uZmxpY3RzKS5cbiAqXG4gKiBBbGwgbG9naWMgbGl2ZXMgb24gYFZhdWx0U3luY1BsdWdpbmA7IHRoZSB0YWIgaXMgcHJlc2VudGF0aW9uIHBsdXMgd2lyaW5nLlxuICovXG5cbmltcG9ydCB7IE1vZGFsLCBOb3RpY2UsIFBsdWdpblNldHRpbmdUYWIsIFNldHRpbmcgfSBmcm9tICdvYnNpZGlhbic7XG5pbXBvcnQgdHlwZSB7IEFwcCB9IGZyb20gJ29ic2lkaWFuJztcbmltcG9ydCB7XG4gIGRlZmF1bHREZXZpY2VOYW1lLFxuICBSRVNDQU5fSU5URVJWQUxfQ0hPSUNFUyxcbiAgdHlwZSBWYXVsdFN5bmNQbHVnaW5EYXRhLFxufSBmcm9tICcuL2RhdGEuanMnO1xuaW1wb3J0IHR5cGUgeyBQYWlyT3V0Y29tZSB9IGZyb20gJy4vcGFpcmluZy5qcyc7XG5pbXBvcnQgeyBwYWlyT3V0Y29tZU1lc3NhZ2UgfSBmcm9tICcuL3BhaXJpbmcuanMnO1xuaW1wb3J0IHsgZm9ybWF0U2luY2UgfSBmcm9tICcuL3N0YXR1c2Jhci5qcyc7XG5pbXBvcnQgdHlwZSB7IFZhdWx0U3luY1BsdWdpbiB9IGZyb20gJy4vcGx1Z2luLmpzJztcblxuLyoqXG4gKiBDbG91ZGZsYXJlIERlcGxveSBCdXR0b24gdGFyZ2V0IChGUi0yMSk6IHByb3Zpc2lvbnMgYSBwcmVjb25maWd1cmVkIHdvcmtlclxuICogKyBEdXJhYmxlIE9iamVjdCArIFIyIGJ1Y2tldCBpbiB0aGUgdXNlcidzIG93biBhY2NvdW50IFx1MjAxNCBubyB3cmFuZ2xlciwgbm9cbiAqIG1hbnVhbCBjb25maWcuIFRoZSB0ZW1wbGF0ZSByZXBvIHBpbnMgYSByZWxlYXNlZCB3b3JrZXIgdmVyc2lvbi5cbiAqL1xuZXhwb3J0IGNvbnN0IERFUExPWV9VUkwgPVxuICAnaHR0cHM6Ly9kZXBsb3kud29ya2Vycy5jbG91ZGZsYXJlLmNvbS8/dXJsPScgK1xuICAnaHR0cHM6Ly9naXRodWIuY29tL3ZhdWx0c3luY2ZvcmFnZW50cy92YXVsdHN5bmNmb3JhZ2VudHMtdGVtcGxhdGUnO1xuXG4vKiogT3BlbiB0aGUgZGVwbG95IHBhZ2UgaW4gdGhlIHN5c3RlbSBicm93c2VyIChuby1vcCB3aGVyZSBgd2luZG93YCBpcyBhYnNlbnQpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIG9wZW5EZXBsb3lQYWdlKCk6IHZvaWQge1xuICBpZiAodHlwZW9mIHdpbmRvdyA9PT0gJ3VuZGVmaW5lZCcpIHJldHVybjtcbiAgd2luZG93Lm9wZW4oREVQTE9ZX1VSTCwgJ19ibGFuaycpO1xufVxuXG4vKiogU21hbGwgY29uZmlybWF0aW9uIGRpYWxvZyAodGhlIHVubGluayBidXR0b24ncyBzYWZldHkgbmV0KS4gKi9cbmV4cG9ydCBjbGFzcyBDb25maXJtTW9kYWwgZXh0ZW5kcyBNb2RhbCB7XG4gIGNvbnN0cnVjdG9yKFxuICAgIGFwcDogQXBwLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgb3B0aW9uczoge1xuICAgICAgdGl0bGU6IHN0cmluZztcbiAgICAgIGJvZHk6IHN0cmluZztcbiAgICAgIGNvbmZpcm1UZXh0OiBzdHJpbmc7XG4gICAgICBvbkNvbmZpcm06ICgpID0+IHZvaWQgfCBQcm9taXNlPHZvaWQ+O1xuICAgIH0sXG4gICkge1xuICAgIHN1cGVyKGFwcCk7XG4gIH1cblxuICBvdmVycmlkZSBvbk9wZW4oKTogdm9pZCB7XG4gICAgbmV3IFNldHRpbmcodGhpcy5jb250ZW50RWwpLnNldE5hbWUodGhpcy5vcHRpb25zLnRpdGxlKS5zZXREZXNjKHRoaXMub3B0aW9ucy5ib2R5KTtcbiAgICBuZXcgU2V0dGluZyh0aGlzLmNvbnRlbnRFbCkuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICBidXR0b24uc2V0QnV0dG9uVGV4dCgnQ2FuY2VsJykub25DbGljaygoKSA9PiB0aGlzLmNsb3NlKCkpLFxuICAgICk7XG4gICAgbmV3IFNldHRpbmcodGhpcy5jb250ZW50RWwpLmFkZEJ1dHRvbigoYnV0dG9uKSA9PlxuICAgICAgYnV0dG9uXG4gICAgICAgIC5zZXRDdGEoKVxuICAgICAgICAuc2V0QnV0dG9uVGV4dCh0aGlzLm9wdGlvbnMuY29uZmlybVRleHQpXG4gICAgICAgIC5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICB0aGlzLmNsb3NlKCk7XG4gICAgICAgICAgYXdhaXQgdGhpcy5vcHRpb25zLm9uQ29uZmlybSgpO1xuICAgICAgICB9KSxcbiAgICApO1xuICB9XG59XG5cbmV4cG9ydCBjbGFzcyBWYXVsdFN5bmNTZXR0aW5nVGFiIGV4dGVuZHMgUGx1Z2luU2V0dGluZ1RhYiB7XG4gIHByaXZhdGUgcmVhZG9ubHkgcGx1Z2luOiBWYXVsdFN5bmNQbHVnaW47XG4gIC8qKiBQYWlyaW5nIGNvZGVzIG5ldmVyIHRvdWNoIGRpc2sgXHUyMDE0IHRoZXkgYXJlIG9uZS10aW1lLCBzaG9ydC1saXZlZCBzZWNyZXRzLiAqL1xuICBwcml2YXRlIHBhaXJpbmdDb2RlID0gJyc7XG4gIHByaXZhdGUgaGludFNldHRpbmc6IFNldHRpbmcgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBzdGF0dXNTZXR0aW5nOiBTZXR0aW5nIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgcmVmcmVzaEhhbmRsZTogUmV0dXJuVHlwZTx0eXBlb2Ygc2V0SW50ZXJ2YWw+IHwgbnVsbCA9IG51bGw7XG5cbiAgY29uc3RydWN0b3IoYXBwOiBBcHAsIHBsdWdpbjogVmF1bHRTeW5jUGx1Z2luKSB7XG4gICAgc3VwZXIoYXBwLCBwbHVnaW4pO1xuICAgIHRoaXMucGx1Z2luID0gcGx1Z2luO1xuICB9XG5cbiAgb3ZlcnJpZGUgZGlzcGxheSgpOiB2b2lkIHtcbiAgICB0aGlzLnN0b3BSZWZyZXNoKCk7XG4gICAgY29uc3QgeyBjb250YWluZXJFbCB9ID0gdGhpcztcbiAgICBjb250YWluZXJFbC5lbXB0eSgpO1xuICAgIHRoaXMuaGludFNldHRpbmcgPSBudWxsO1xuICAgIHRoaXMuc3RhdHVzU2V0dGluZyA9IG51bGw7XG5cbiAgICB0aGlzLnJlbmRlckNvbm5lY3Rpb25TZWN0aW9uKCk7XG4gICAgaWYgKHRoaXMucGx1Z2luLmxpbmtlZCkge1xuICAgICAgdGhpcy5yZW5kZXJMaW5rZWRTZWN0aW9uKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMucmVuZGVyUGFpcmluZ1NlY3Rpb24oKTtcbiAgICB9XG4gICAgdGhpcy5zdGFydFJlZnJlc2goKTtcbiAgfVxuXG4gIG92ZXJyaWRlIGhpZGUoKTogdm9pZCB7XG4gICAgdGhpcy5zdG9wUmVmcmVzaCgpO1xuICB9XG5cbiAgLy8gLS0tIHNlY3Rpb25zIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5cbiAgcHJpdmF0ZSByZW5kZXJDb25uZWN0aW9uU2VjdGlvbigpOiB2b2lkIHtcbiAgICBjb25zdCB7IGNvbnRhaW5lckVsIH0gPSB0aGlzO1xuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoJ1dvcmtlciBVUkwnKVxuICAgICAgLnNldERlc2MoXG4gICAgICAgICdZb3VyIHN5bmMgd29ya2VyLCBlLmcuIGh0dHBzOi8vcGVyc29uYWwueC53b3JrZXJzLmRldi4gTm8gd29ya2VyIHlldD8gVXNlIFwiRGVwbG95IHlvdXIgd29ya2VyXCIgYmVsb3csIG9wZW4gdGhlIFVSTCBpbiBhIGJyb3dzZXIsIGFuZCBjbGFpbSBpdC4nLFxuICAgICAgKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHRcbiAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoJ2h0dHBzOi8vcGVyc29uYWwueC53b3JrZXJzLmRldicpXG4gICAgICAgICAgLnNldFZhbHVlKHRoaXMucGx1Z2luLmRhdGEudXJsKVxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIHRoaXMucGx1Z2luLmRhdGEudXJsID0gdmFsdWUudHJpbSgpO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVBsdWdpbkRhdGEoKTtcbiAgICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdEZXZpY2UgbmFtZScpXG4gICAgICAuc2V0RGVzYyhgU2hvd24gaW4gdGhlIHdvcmtlciBkYXNoYm9hcmQncyBkZXZpY2UgbGlzdC4gQXBwbGllcyB3aGVuIChyZSlwYWlyaW5nLmApXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT5cbiAgICAgICAgdGV4dFxuICAgICAgICAgIC5zZXRQbGFjZWhvbGRlcihkZWZhdWx0RGV2aWNlTmFtZSgpKVxuICAgICAgICAgIC5zZXRWYWx1ZSh0aGlzLnBsdWdpbi5kYXRhLmRldmljZU5hbWUpXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgdGhpcy5wbHVnaW4uZGF0YS5kZXZpY2VOYW1lID0gdmFsdWUudHJpbSgpO1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZVBsdWdpbkRhdGEoKTtcbiAgICAgICAgICB9KSxcbiAgICAgICk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlclBhaXJpbmdTZWN0aW9uKCk6IHZvaWQge1xuICAgIGNvbnN0IHsgY29udGFpbmVyRWwgfSA9IHRoaXM7XG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnUGFpcmluZyBjb2RlJylcbiAgICAgIC5zZXREZXNjKCdGcm9tIHlvdXIgd29ya2VyIGRhc2hib2FyZDogRGV2aWNlcyBcdTIxOTIgUGFpciBuZXcgZGV2aWNlLiBDb2RlcyBhcmUgb25lLXRpbWUgYW5kIGV4cGlyZSBhZnRlciAxMCBtaW51dGVzLicpXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT5cbiAgICAgICAgdGV4dFxuICAgICAgICAgIC5zZXRQbGFjZWhvbGRlcignN0YzSy1ROU0yJylcbiAgICAgICAgICAub25DaGFuZ2UoKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICB0aGlzLnBhaXJpbmdDb2RlID0gdmFsdWUudHJpbSgpO1xuICAgICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKS5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgIGJ1dHRvblxuICAgICAgICAuc2V0Q3RhKClcbiAgICAgICAgLnNldEJ1dHRvblRleHQoJ1BhaXIgdGhpcyB2YXVsdCcpXG4gICAgICAgIC5vbkNsaWNrKGFzeW5jICgpID0+IHtcbiAgICAgICAgICBidXR0b24uc2V0RGlzYWJsZWQodHJ1ZSk7XG4gICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgIGNvbnN0IG91dGNvbWUgPSBhd2FpdCB0aGlzLnBsdWdpbi5wYWlyRnJvbVNldHRpbmdzKHRoaXMucGFpcmluZ0NvZGUpO1xuICAgICAgICAgICAgdGhpcy5zaG93T3V0Y29tZShvdXRjb21lKTtcbiAgICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgICAgYnV0dG9uLnNldERpc2FibGVkKGZhbHNlKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pLFxuICAgICk7XG5cbiAgICB0aGlzLmhpbnRTZXR0aW5nID0gbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnR2V0dGluZyBzdGFydGVkJylcbiAgICAgIC5zZXRDbGFzcygndnNhLXNldHRpbmdzLWhpbnQnKVxuICAgICAgLnNldERlc2MoXG4gICAgICAgIFtcbiAgICAgICAgICAnMS4gRGVwbG95IHlvdXIgb3duIHdvcmtlciB3aXRoIHRoZSBidXR0b24gYmVsb3cgKHlvdXIgQ2xvdWRmbGFyZSBhY2NvdW50LCBwcmVjb25maWd1cmVkIFx1MjAxNCBubyB3cmFuZ2xlcikuJyxcbiAgICAgICAgICAnMi4gT3BlbiB0aGUgd29ya2VyIFVSTCBpbiBhIGJyb3dzZXIgYW5kIHNldCB0aGUgYWRtaW4gcGFzc3BocmFzZSAoY2xhaW0pLicsXG4gICAgICAgICAgJzMuIENyZWF0ZSBhIHBhaXJpbmcgY29kZSBvbiB0aGUgZGFzaGJvYXJkLCBwYXN0ZSBpdCBhYm92ZSwgYW5kIHBhaXIuJyxcbiAgICAgICAgICAnT24gYSBwaG9uZSwgc2Nhbm5pbmcgdGhlIGRhc2hib2FyZCBRUiBvciB0YXBwaW5nIGl0cyBvYnNpZGlhbjovLyBsaW5rIHBhaXJzIHdpdGhvdXQgdHlwaW5nLicsXG4gICAgICAgIF0uam9pbignXFxuJyksXG4gICAgICApXG4gICAgICAuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KCdEZXBsb3kgeW91ciB3b3JrZXInKS5vbkNsaWNrKCgpID0+IG9wZW5EZXBsb3lQYWdlKCkpLFxuICAgICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyTGlua2VkU2VjdGlvbigpOiB2b2lkIHtcbiAgICBjb25zdCB7IGNvbnRhaW5lckVsIH0gPSB0aGlzO1xuICAgIGNvbnN0IGRhdGEgPSB0aGlzLnBsdWdpbi5kYXRhO1xuXG4gICAgdGhpcy5zdGF0dXNTZXR0aW5nID0gbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZSgnU3RhdHVzJylcbiAgICAgIC5zZXRDbGFzcygndnNhLXN0YXR1cy1yZWFkb3V0JylcbiAgICAgIC5zZXREZXNjKHRoaXMuc3RhdHVzVGV4dCgpKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKS5hZGRCdXR0b24oKGJ1dHRvbikgPT5cbiAgICAgIGJ1dHRvbi5zZXRCdXR0b25UZXh0KCdTeW5jIG5vdycpLm9uQ2xpY2soYXN5bmMgKCkgPT4ge1xuICAgICAgICBidXR0b24uc2V0RGlzYWJsZWQodHJ1ZSk7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uc3luY05vdygpO1xuICAgICAgICB9IGZpbmFsbHkge1xuICAgICAgICAgIGJ1dHRvbi5zZXREaXNhYmxlZChmYWxzZSk7XG4gICAgICAgICAgdGhpcy5yZWZyZXNoU3RhdHVzKCk7XG4gICAgICAgIH1cbiAgICAgIH0pLFxuICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdSZXNjYW4gaW50ZXJ2YWwnKVxuICAgICAgLnNldERlc2MoXG4gICAgICAgICdQZXJpb2RpYyBmdWxsIHJlY29uY2lsaWF0aW9uIFx1MjAxNCBjYXRjaGVzIGV4dGVybmFsIGVkaXRzIHdoaWxlIE9ic2lkaWFuIGlzIG9wZW4gYW5kIGNvdmVycyBtb2JpbGUgYmFja2dyb3VuZCBsaW1pdHMuIFZhdWx0IGV2ZW50cyBhbmQgYXBwLW9wZW4gc3luYyBhbHdheXMgcnVuLicsXG4gICAgICApXG4gICAgICAuYWRkRHJvcGRvd24oKGRyb3Bkb3duKSA9PiB7XG4gICAgICAgIGZvciAoY29uc3QgY2hvaWNlIG9mIFJFU0NBTl9JTlRFUlZBTF9DSE9JQ0VTKSB7XG4gICAgICAgICAgZHJvcGRvd24uYWRkT3B0aW9uKFN0cmluZyhjaG9pY2UudmFsdWUpLCBjaG9pY2UubGFiZWwpO1xuICAgICAgICB9XG4gICAgICAgIGRyb3Bkb3duLnNldFZhbHVlKFN0cmluZyhkYXRhLnNldHRpbmdzLnJlc2NhbkludGVydmFsU2VjKSk7XG4gICAgICAgIGRyb3Bkb3duLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLmFwcGx5UmVzY2FuSW50ZXJ2YWwoTnVtYmVyKHZhbHVlKSk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcbiAgICAgIC5zZXROYW1lKCdTeW5jIC5vYnNpZGlhbi8gZm9sZGVyJylcbiAgICAgIC5zZXREZXNjKFxuICAgICAgICAnT3B0IGluIHRvIHN5bmNpbmcgLm9ic2lkaWFuLyAoc2V0dGluZ3MgYW5kIHBsdWdpbnMpLCBleGNsdWRpbmcgd29ya3NwYWNlLmpzb24gYW5kIGNhY2hlcy4gJyArXG4gICAgICAgICAgJ1RoZSB3b3JrZXJcXHUyMDE5cyBwZXItdmF1bHQgc2V0dGluZyB0YWtlcyBwcmVjZWRlbmNlIG9uY2UgY29ubmVjdGVkLicsXG4gICAgICApXG4gICAgICAuYWRkVG9nZ2xlKCh0b2dnbGUpID0+XG4gICAgICAgIHRvZ2dsZS5zZXRWYWx1ZShkYXRhLnNldHRpbmdzLm9ic2lkaWFuU3luYykub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgYXdhaXQgdGhpcy5wbHVnaW4uYXBwbHlPYnNpZGlhblN5bmModmFsdWUpO1xuICAgICAgICB9KSxcbiAgICAgICk7XG5cbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbCkuYWRkQnV0dG9uKChidXR0b24pID0+XG4gICAgICBidXR0b24uc2V0QnV0dG9uVGV4dCgnVW5saW5rIHRoaXMgdmF1bHQnKS5vbkNsaWNrKCgpID0+IHtcbiAgICAgICAgbmV3IENvbmZpcm1Nb2RhbCh0aGlzLmFwcCwge1xuICAgICAgICAgIHRpdGxlOiAnVW5saW5rIFZhdWx0U3luYz8nLFxuICAgICAgICAgIGJvZHk6ICdUaGlzIHN0b3BzIHN5bmNpbmcgYW5kIGNsZWFycyB0aGlzIGRldmljZVxcdTIwMTlzIGxvY2FsIHN5bmMgc3RhdGUuIEZpbGVzIGFscmVhZHkgaW4gdGhlIHZhdWx0IGFyZSB1bnRvdWNoZWQuIFRoZSB3b3JrZXIga2VlcHMgdGhpcyBkZXZpY2UgaW4gaXRzIHJlZ2lzdHJ5IFxcdTIwMTQgcmV2b2tlIGl0IGZyb20gdGhlIGRhc2hib2FyZCBpZiB5b3UgYXJlIGRvbmUgd2l0aCBpdC4nLFxuICAgICAgICAgIGNvbmZpcm1UZXh0OiAnVW5saW5rJyxcbiAgICAgICAgICBvbkNvbmZpcm06IGFzeW5jICgpID0+IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMucGx1Z2luLnVubGluaygpO1xuICAgICAgICAgICAgdGhpcy5kaXNwbGF5KCk7XG4gICAgICAgICAgfSxcbiAgICAgICAgfSkub3BlbigpO1xuICAgICAgfSksXG4gICAgKTtcbiAgfVxuXG4gIC8vIC0tLSBzdGF0dXMgLyBmZWVkYmFjayAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIHByaXZhdGUgc3RhdHVzVGV4dCgpOiBzdHJpbmcge1xuICAgIGNvbnN0IGRhdGE6IFZhdWx0U3luY1BsdWdpbkRhdGEgPSB0aGlzLnBsdWdpbi5kYXRhO1xuICAgIGNvbnN0IHN0YXR1cyA9IHRoaXMucGx1Z2luLmNsaWVudD8uc3RhdHVzKCk7XG4gICAgaWYgKHN0YXR1cyA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICByZXR1cm4gYExpbmtlZCB0byAke2RhdGEudXJsfSAoZGV2aWNlICR7ZGF0YS5kZXZpY2VOYW1lIHx8IGRhdGEuZGV2aWNlSWR9KS5gO1xuICAgIH1cbiAgICBjb25zdCBsYXN0U3luYyA9XG4gICAgICBzdGF0dXMubGFzdFN5bmNBdCA9PT0gbnVsbFxuICAgICAgICA/ICduZXZlcidcbiAgICAgICAgOiBgJHtmb3JtYXRTaW5jZShEYXRlLm5vdygpIC0gc3RhdHVzLmxhc3RTeW5jQXQpfSBhZ29gO1xuICAgIGNvbnN0IHN0YXRlID0gc3RhdHVzLnN0YXRlID09PSAnbGl2ZScgPyAnY29ubmVjdGVkJyA6IHN0YXR1cy5zdGF0ZTtcbiAgICByZXR1cm4gW1xuICAgICAgYFN0YXRlOiAke3N0YXRlfWAsXG4gICAgICBgV29ya2VyOiAke2RhdGEudXJsfWAsXG4gICAgICBgTGFzdCBzeW5jOiAke2xhc3RTeW5jfWAsXG4gICAgICBgUGVuZGluZyBjaGFuZ2VzOiAke3N0YXR1cy5wZW5kaW5nfWAsXG4gICAgICBgQ29uZmxpY3RzOiAke3N0YXR1cy5jb25mbGljdHMubGVuZ3RofSR7c3RhdHVzLmNvbmZsaWN0cy5sZW5ndGggPiAwID8gJyAoY29uZmxpY3QgY29waWVzIHdlcmUgd3JpdHRlbiBpbnRvIHRoZSB2YXVsdCknIDogJyd9YCxcbiAgICBdLmpvaW4oJ1xcbicpO1xuICB9XG5cbiAgcHJpdmF0ZSByZWZyZXNoU3RhdHVzKCk6IHZvaWQge1xuICAgIHRoaXMuc3RhdHVzU2V0dGluZz8uc2V0RGVzYyh0aGlzLnN0YXR1c1RleHQoKSk7XG4gIH1cblxuICAvKiogUGFpciBmZWVkYmFjazogc3VjY2VzcyByZS1yZW5kZXJzOyBmYWlsdXJlcyBsYW5kIGluIHRoZSBoaW50IFNldHRpbmcuICovXG4gIHByaXZhdGUgc2hvd091dGNvbWUob3V0Y29tZTogUGFpck91dGNvbWUpOiB2b2lkIHtcbiAgICBpZiAob3V0Y29tZS5zdGF0dXMgPT09ICdwYWlyZWQnKSB7XG4gICAgICBuZXcgTm90aWNlKHBhaXJPdXRjb21lTWVzc2FnZShvdXRjb21lKSk7XG4gICAgICB0aGlzLmRpc3BsYXkoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgY29uc3QgbWVzc2FnZSA9IHBhaXJPdXRjb21lTWVzc2FnZShvdXRjb21lKTtcbiAgICBuZXcgTm90aWNlKG1lc3NhZ2UsIDEwMDAwKTtcbiAgICBpZiAodGhpcy5oaW50U2V0dGluZyAhPT0gbnVsbCkgdGhpcy5oaW50U2V0dGluZy5zZXREZXNjKG1lc3NhZ2UpO1xuICB9XG5cbiAgLy8gLS0tIGxpdmUgcmVmcmVzaCBsb29wIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuXG4gIC8qKiBSZWZyZXNoIHRoZSBzdGF0dXMgcmVhZG91dCB+MSBIeiB3aGlsZSB0aGUgdGFiIGlzIG9wZW4uICovXG4gIHByaXZhdGUgc3RhcnRSZWZyZXNoKCk6IHZvaWQge1xuICAgIHRoaXMuc3RvcFJlZnJlc2goKTtcbiAgICBjb25zdCBoYW5kbGUgPSBzZXRJbnRlcnZhbCgoKSA9PiB0aGlzLnJlZnJlc2hTdGF0dXMoKSwgMTAwMCk7XG4gICAgdGhpcy5yZWZyZXNoSGFuZGxlID0gaGFuZGxlO1xuICAgIC8vIE9ic2lkaWFuIGNsZWFycyByZWdpc3RlcmVkIGludGVydmFscyB3aGVuIHRoZSBwbHVnaW4gdW5sb2FkcyBcdTIwMTQgbm8gbGVha1xuICAgIC8vIGV2ZW4gaWYgdGhlIHNldHRpbmdzIG1vZGFsIGlzIGZvcmNlLWNsb3NlZC5cbiAgICB0aGlzLnBsdWdpbi5yZWdpc3RlckludGVydmFsKGhhbmRsZSBhcyB1bmtub3duIGFzIG51bWJlcik7XG4gIH1cblxuICBwcml2YXRlIHN0b3BSZWZyZXNoKCk6IHZvaWQge1xuICAgIGlmICh0aGlzLnJlZnJlc2hIYW5kbGUgIT09IG51bGwpIHtcbiAgICAgIGNsZWFySW50ZXJ2YWwodGhpcy5yZWZyZXNoSGFuZGxlKTtcbiAgICAgIHRoaXMucmVmcmVzaEhhbmRsZSA9IG51bGw7XG4gICAgfVxuICB9XG59XG4iLCAiLyoqXG4gKiBTdGF0dXMtYmFyIGluZGljYXRvciAocGx1Z2luIHNjb3BlIGl0ZW0gIzUpOiBhIHNtYWxsIHBhc3NpdmUgdmlldyBvdmVyXG4gKiBgU3luY0NsaWVudFN0YXR1c2AsIHJlcGFpbnRlZCBieSB0aGUgcGx1Z2luJ3MgMSBzIHN1cGVydmlzaW9uIHRpY2suXG4gKlxuICogICB2c2EgXHUyMkVGICAgICAgICAgICAgICBjb25uZWN0aW5nIC8gc3luY2luZ1xuICogICB2c2EgXHUyNzEzIDEycyAgICAgICAgICBsaXZlLCBsYXN0IGNvbXBsZXRlZCBjeWNsZSAxMiBzIGFnb1xuICogICB2c2EgXHUyNkEwIGNvbmZsaWN0czogMiBjb25mbGljdHMgb2JzZXJ2ZWQgKGNvbmZsaWN0IGNvcGllcyBleGlzdCBpbiB0aGUgdmF1bHQpXG4gKiAgIHZzYSBcdTI3MTcgb2ZmbGluZSAgICAgIGRpc2Nvbm5lY3RlZCAocmVjb25uZWN0IGJhY2tvZmYgcnVubmluZylcbiAqXG4gKiBUaGUgdG9vbHRpcCBjYXJyaWVzIHRoZSBkZXRhaWw6IHN0YXRlLCB3b3JrZXIgVVJMLCBkZXZpY2UsIGxhc3Qgc3luYywgcGVuZGluZy5cbiAqL1xuXG5pbXBvcnQgdHlwZSB7IFN5bmNDbGllbnRTdGF0dXMgfSBmcm9tICdAdnNhL2NvcmUnO1xuXG4vKiogVGhlIHNsaWNlIG9mIEhUTUxFbGVtZW50IHRoZSBpbmRpY2F0b3IgdG91Y2hlcyAodGVzdHMgcGFzcyBhIHBsYWluIG9iamVjdCkuICovXG5leHBvcnQgaW50ZXJmYWNlIFN0YXR1c0l0ZW1MaWtlIHtcbiAgdGV4dENvbnRlbnQ6IHN0cmluZztcbiAgYWRkQ2xhc3M/KGNsczogc3RyaW5nKTogdW5rbm93bjtcbiAgcmVtb3ZlQ2xhc3M/KGNsczogc3RyaW5nKTogdW5rbm93bjtcbiAgc2V0QXR0cmlidXRlPyhuYW1lOiBzdHJpbmcsIHZhbHVlOiBzdHJpbmcpOiB1bmtub3duO1xufVxuXG5leHBvcnQgaW50ZXJmYWNlIFN0YXR1c0NvbnRleHQge1xuICB1cmw6IHN0cmluZztcbiAgZGV2aWNlTmFtZTogc3RyaW5nO1xuICAvKiogRXh0cmEgbGluZSAoZS5nLiBhbiBhdXRoIGZhaWx1cmUgbm90ZSkgYXBwZW5kZWQgdG8gdGhlIHRvb2x0aXAuICovXG4gIG5vdGU/OiBzdHJpbmc7XG59XG5cbi8qKiBgbm93IC0gc2luY2VgLCBmbG9vcmVkOiBgMTJzYCwgYDVtYCwgYDNoYCBcdTIwMTQgZGlzcGxheSBvbmx5LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIGZvcm1hdFNpbmNlKGVsYXBzZWRNczogbnVtYmVyKTogc3RyaW5nIHtcbiAgY29uc3Qgc2Vjb25kcyA9IE1hdGgubWF4KDAsIE1hdGguZmxvb3IoZWxhcHNlZE1zIC8gMTAwMCkpO1xuICBpZiAoc2Vjb25kcyA8IDYwKSByZXR1cm4gYCR7c2Vjb25kc31zYDtcbiAgY29uc3QgbWludXRlcyA9IE1hdGguZmxvb3Ioc2Vjb25kcyAvIDYwKTtcbiAgaWYgKG1pbnV0ZXMgPCA2MCkgcmV0dXJuIGAke21pbnV0ZXN9bWA7XG4gIHJldHVybiBgJHtNYXRoLmZsb29yKG1pbnV0ZXMgLyA2MCl9aGA7XG59XG5cbi8qKiBUaGUgb25lLWxpbmUgc3RhdHVzIHRleHQgZm9yIGEgY2xpZW50IHN0YXR1cyBhdCB0aW1lIGBub3dgLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN0YXR1c0xpbmVGb3Ioc3RhdHVzOiBTeW5jQ2xpZW50U3RhdHVzLCBub3c6IG51bWJlcik6IHN0cmluZyB7XG4gIHN3aXRjaCAoc3RhdHVzLnN0YXRlKSB7XG4gICAgY2FzZSAnY29ubmVjdGluZyc6XG4gICAgY2FzZSAnc3luY2luZyc6XG4gICAgICByZXR1cm4gJ3ZzYSBcdTIyRUYnO1xuICAgIGNhc2UgJ2Rpc2Nvbm5lY3RlZCc6XG4gICAgICByZXR1cm4gJ3ZzYSBcdTI3MTcgb2ZmbGluZSc7XG4gICAgY2FzZSAnbGl2ZSc6XG4gICAgICBpZiAoc3RhdHVzLmNvbmZsaWN0cy5sZW5ndGggPiAwKSByZXR1cm4gYHZzYSBcdTI2QTAgY29uZmxpY3RzOiAke3N0YXR1cy5jb25mbGljdHMubGVuZ3RofWA7XG4gICAgICBpZiAoc3RhdHVzLmxhc3RTeW5jQXQgPT09IG51bGwpIHJldHVybiAndnNhIFx1MjcxMyc7XG4gICAgICByZXR1cm4gYHZzYSBcdTI3MTMgJHtmb3JtYXRTaW5jZShub3cgLSBzdGF0dXMubGFzdFN5bmNBdCl9YDtcbiAgICBjYXNlICdpZGxlJzpcbiAgICAgIHJldHVybiAndnNhJztcbiAgfVxufVxuXG4vKiogVG9vbHRpcCBsaW5lcyAoam9pbmVkIHdpdGggYFxcbmApLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN0YXR1c1Rvb2x0aXBGb3Ioc3RhdHVzOiBTeW5jQ2xpZW50U3RhdHVzLCBjb250ZXh0OiBTdGF0dXNDb250ZXh0LCBub3c6IG51bWJlcik6IHN0cmluZyB7XG4gIGNvbnN0IHN0YXRlTGFiZWw6IFJlY29yZDxTeW5jQ2xpZW50U3RhdHVzWydzdGF0ZSddLCBzdHJpbmc+ID0ge1xuICAgIGlkbGU6ICdub3QgcnVubmluZycsXG4gICAgY29ubmVjdGluZzogJ2Nvbm5lY3RpbmdcdTIwMjYnLFxuICAgIHN5bmNpbmc6ICdzeW5jaW5nXHUyMDI2JyxcbiAgICBsaXZlOiAnbGl2ZScsXG4gICAgZGlzY29ubmVjdGVkOiAnb2ZmbGluZSBcdTIwMTQgcmVjb25uZWN0aW5nJyxcbiAgfTtcbiAgY29uc3QgbGluZXMgPSBbYFZhdWx0U3luYyBmb3IgQWdlbnRzIFx1MjAxNCAke3N0YXRlTGFiZWxbc3RhdHVzLnN0YXRlXX1gXTtcbiAgaWYgKGNvbnRleHQudXJsICE9PSAnJykgbGluZXMucHVzaChgV29ya2VyOiAke2NvbnRleHQudXJsfWApO1xuICBpZiAoY29udGV4dC5kZXZpY2VOYW1lICE9PSAnJykgbGluZXMucHVzaChgRGV2aWNlOiAke2NvbnRleHQuZGV2aWNlTmFtZX1gKTtcbiAgbGluZXMucHVzaChcbiAgICBzdGF0dXMubGFzdFN5bmNBdCA9PT0gbnVsbFxuICAgICAgPyAnTGFzdCBzeW5jOiBuZXZlcidcbiAgICAgIDogYExhc3Qgc3luYzogJHtmb3JtYXRTaW5jZShub3cgLSBzdGF0dXMubGFzdFN5bmNBdCl9IGFnb2AsXG4gICk7XG4gIGxpbmVzLnB1c2goYFBlbmRpbmcgY2hhbmdlczogJHtzdGF0dXMucGVuZGluZ31gKTtcbiAgbGluZXMucHVzaChgQ29uZmxpY3RzOiAke3N0YXR1cy5jb25mbGljdHMubGVuZ3RofWApO1xuICBpZiAoc3RhdHVzLmNvbmZsaWN0cy5sZW5ndGggPiAwKSB7XG4gICAgbGluZXMucHVzaChgQ29uZmxpY3QgY29waWVzOiAke3N0YXR1cy5jb25mbGljdHMubWFwKChjKSA9PiBjLnBhdGgpLmpvaW4oJywgJyl9YCk7XG4gIH1cbiAgaWYgKGNvbnRleHQubm90ZSAhPT0gdW5kZWZpbmVkICYmIGNvbnRleHQubm90ZSAhPT0gJycpIGxpbmVzLnB1c2goY29udGV4dC5ub3RlKTtcbiAgcmV0dXJuIGxpbmVzLmpvaW4oJ1xcbicpO1xufVxuXG4vKiogQ1NTIG1vZGlmaWVyIGZvciB0aGUgaW5kaWNhdG9yICh0aW50ZWQgd2FybmluZy9lcnJvciBzdGF0ZXMpLiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHN0YXR1c0NsYXNzRm9yKHN0YXR1czogU3luY0NsaWVudFN0YXR1cyk6IHN0cmluZyB7XG4gIGlmIChzdGF0dXMuc3RhdGUgPT09ICdkaXNjb25uZWN0ZWQnKSByZXR1cm4gJ3ZzYS1lcnJvcic7XG4gIGlmIChzdGF0dXMuY29uZmxpY3RzLmxlbmd0aCA+IDApIHJldHVybiAndnNhLXdhcm4nO1xuICByZXR1cm4gJyc7XG59XG5cbi8qKlxuICogUGFpbnRzIG9uZSBzdGF0dXMtYmFyIGl0ZW0uIFBhc3NpdmU6IHRoZSBwbHVnaW4gY2FsbHMgYHVwZGF0ZSgpYCBmcm9tIGl0c1xuICogc3VwZXJ2aXNpb24gdGljayBcdTIwMTQgbm8gdGltZXJzIG9mIGl0cyBvd24gdG8gbGVhay5cbiAqL1xuZXhwb3J0IGNsYXNzIFN0YXR1c0JhckluZGljYXRvciB7XG4gIC8qKiBBbHdheXMgb24gXHUyMDE0IHRoZSBiYXNlIGNsYXNzIHN0eWxlcy5jc3MgdGFyZ2V0cy4gKi9cbiAgcHJpdmF0ZSBzdGF0aWMgcmVhZG9ubHkgQkFTRV9DTEFTUyA9ICd2c2Etc3RhdHVzJztcbiAgcHJpdmF0ZSBzdGF0aWMgcmVhZG9ubHkgTU9ESUZJRVJfQ0xBU1NFUyA9IFsndnNhLXdhcm4nLCAndnNhLWVycm9yJ107XG5cbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBpdGVtOiBTdGF0dXNJdGVtTGlrZSkge31cblxuICB1cGRhdGUoc3RhdHVzOiBTeW5jQ2xpZW50U3RhdHVzLCBjb250ZXh0OiBTdGF0dXNDb250ZXh0LCBub3c6IG51bWJlcik6IHZvaWQge1xuICAgIHRoaXMuaXRlbS50ZXh0Q29udGVudCA9IHN0YXR1c0xpbmVGb3Ioc3RhdHVzLCBub3cpO1xuICAgIHRoaXMuaXRlbS5hZGRDbGFzcz8uKFN0YXR1c0JhckluZGljYXRvci5CQVNFX0NMQVNTKTtcbiAgICBjb25zdCBtb2RpZmllciA9IHN0YXR1c0NsYXNzRm9yKHN0YXR1cyk7XG4gICAgZm9yIChjb25zdCBjbHMgb2YgU3RhdHVzQmFySW5kaWNhdG9yLk1PRElGSUVSX0NMQVNTRVMpIHtcbiAgICAgIGlmIChjbHMgPT09IG1vZGlmaWVyKSB0aGlzLml0ZW0uYWRkQ2xhc3M/LihjbHMpO1xuICAgICAgZWxzZSB0aGlzLml0ZW0ucmVtb3ZlQ2xhc3M/LihjbHMpO1xuICAgIH1cbiAgICB0aGlzLml0ZW0uc2V0QXR0cmlidXRlPy4oJ3RpdGxlJywgc3RhdHVzVG9vbHRpcEZvcihzdGF0dXMsIGNvbnRleHQsIG5vdykpO1xuICB9XG59XG4iLCAiLyoqXG4gKiBgV2ViU29ja2V0VHJhbnNwb3J0YCBcdTIwMTQgY29yZSdzIGBUcmFuc3BvcnRgIG92ZXIgdGhlIGdsb2JhbCBgV2ViU29ja2V0YFxuICogKHByZXNlbnQgaW4gT2JzaWRpYW4gZGVza3RvcCAqYW5kKiBtb2JpbGU7IGZlYXR1cmUtY2hlY2tlZCB3aXRoIGEgY2xlYXJcbiAqIGVycm9yIGZvciBleG90aWMgYnVpbGRzKS5cbiAqXG4gKiBUaGlzIG1pcnJvcnMgYEB2c2Evbm9kZS1ydW50aW1lYCdzIHRyYW5zcG9ydCBvbiBwdXJwb3NlIChzYW1lIHdpcmUgZm9ybWF0OlxuICogb25lIEpTT04gdGV4dCBmcmFtZSBwZXIgbWVzc2FnZSwgY29yZSdzIGBwYXJzZU1lc3NhZ2VgIG9uIHJlY2VpdmUsIHF1ZXVlZFxuICogc2VuZHMgYmVmb3JlIG9wZW4pIGJ1dCBzaGFyZXMgbm8gY29kZSB3aXRoIGl0IFx1MjAxNCBgQHZzYS9ub2RlLXJ1bnRpbWVgIGlzXG4gKiBOb2RlLW9ubHkgYW5kIG11c3QgbmV2ZXIgYmUgYSBwbHVnaW4gZGVwZW5kZW5jeS5cbiAqL1xuXG5pbXBvcnQgeyBOZXR3b3JrRXJyb3IsIHBhcnNlTWVzc2FnZSB9IGZyb20gJ0B2c2EvY29yZSc7XG5pbXBvcnQgdHlwZSB7IENsb3NlUmVhc29uLCBNZXNzYWdlLCBUcmFuc3BvcnQgfSBmcm9tICdAdnNhL2NvcmUnO1xuXG4vKipcbiAqIFRoZSBtaW5pbWFsIFdlYlNvY2tldCBzdXJmYWNlIHRoaXMgdHJhbnNwb3J0IG5lZWRzLiBJbmplY3RhYmxlIHNvIHRlc3RzXG4gKiAoYW5kIGV4b3RpYyBydW50aW1lcykgY2FuIHN1cHBseSBhIGZha2U7IHByb2R1Y3Rpb24gdXNlcyB0aGUgZ2xvYmFsLlxuICovXG5leHBvcnQgaW50ZXJmYWNlIFdlYlNvY2tldExpa2Uge1xuICBzZW5kKGRhdGE6IHN0cmluZyk6IHZvaWQ7XG4gIGNsb3NlKGNvZGU/OiBudW1iZXIsIHJlYXNvbj86IHN0cmluZyk6IHZvaWQ7XG4gIGFkZEV2ZW50TGlzdGVuZXIodHlwZTogJ29wZW4nLCBsaXN0ZW5lcjogKCkgPT4gdm9pZCk6IHZvaWQ7XG4gIGFkZEV2ZW50TGlzdGVuZXIodHlwZTogJ21lc3NhZ2UnLCBsaXN0ZW5lcjogKGV2ZW50OiB7IGRhdGE6IHVua25vd24gfSkgPT4gdm9pZCk6IHZvaWQ7XG4gIGFkZEV2ZW50TGlzdGVuZXIodHlwZTogJ2Nsb3NlJywgbGlzdGVuZXI6IChldmVudDogeyBjb2RlPzogbnVtYmVyOyByZWFzb24/OiBzdHJpbmcgfSkgPT4gdm9pZCk6IHZvaWQ7XG4gIGFkZEV2ZW50TGlzdGVuZXIodHlwZTogJ2Vycm9yJywgbGlzdGVuZXI6IChldmVudDogdW5rbm93bikgPT4gdm9pZCk6IHZvaWQ7XG59XG5cbmV4cG9ydCB0eXBlIFdlYlNvY2tldEZhY3RvcnkgPSAodXJsOiBzdHJpbmcpID0+IFdlYlNvY2tldExpa2U7XG5cbmV4cG9ydCBpbnRlcmZhY2UgV2ViU29ja2V0VHJhbnNwb3J0T3B0aW9ucyB7XG4gIC8qKiBXb3JrZXIgb3JpZ2luIChgaHR0cHM6Ly9wZXJzb25hbC54LndvcmtlcnMuZGV2YCkgb3IgYSBgd3Mocyk6Ly9gIFVSTC4gKi9cbiAgdXJsOiBzdHJpbmc7XG4gIC8qKiBEZXZpY2UgdG9rZW4gXHUyMDE0IGNhcnJpZWQgaW4gdGhlIHF1ZXJ5IHN0cmluZyAodGhlIHdvcmtlcidzIHByZS1hdXRoIHBhdGgpLiAqL1xuICB0b2tlbjogc3RyaW5nO1xuICAvKiogV1MgcGF0aCBvbiB0aGUgd29ya2VyIChkZWZhdWx0IGAvd3NgOyBgL3N5bmNgIGlzIGVxdWl2YWxlbnQpLiAqL1xuICBwYXRoPzogc3RyaW5nO1xuICAvKiogSW5qZWN0YWJsZSBzb2NrZXQgZmFjdG9yeSAodGVzdHMpLiBEZWZhdWx0OiB0aGUgZ2xvYmFsIGBXZWJTb2NrZXRgLiAqL1xuICB3c0ZhY3Rvcnk/OiBXZWJTb2NrZXRGYWN0b3J5O1xufVxuXG4vKipcbiAqIEJ1aWxkIHRoZSBhdXRoZW50aWNhdGVkIFdTIFVSTDogYGh0dHBzOi8veGAgXHUyMTkyIGB3c3M6Ly94L3dzP3Rva2VuPVx1MjAyNmAuXG4gKiBUaHJvd3Mgb24gbm9uLUhUVFAoUykvV1Mgc2NoZW1lcyBvciB1bnBhcnNhYmxlIGlucHV0LlxuICovXG5leHBvcnQgZnVuY3Rpb24gdG9XZWJTb2NrZXRVcmwoYmFzZVVybDogc3RyaW5nLCB0b2tlbjogc3RyaW5nLCBwYXRoID0gJy93cycpOiBzdHJpbmcge1xuICBjb25zdCB1cmwgPSBuZXcgVVJMKGJhc2VVcmwpO1xuICBpZiAodXJsLnByb3RvY29sID09PSAnaHR0cDonKSB1cmwucHJvdG9jb2wgPSAnd3M6JztcbiAgZWxzZSBpZiAodXJsLnByb3RvY29sID09PSAnaHR0cHM6JykgdXJsLnByb3RvY29sID0gJ3dzczonO1xuICBlbHNlIGlmICh1cmwucHJvdG9jb2wgIT09ICd3czonICYmIHVybC5wcm90b2NvbCAhPT0gJ3dzczonKSB7XG4gICAgdGhyb3cgbmV3IE5ldHdvcmtFcnJvcihgd29ya2VyIFVSTCBtdXN0IGJlIGh0dHAocyk6Ly8gb3Igd3Mocyk6Ly8sIGdvdCAke3VybC5wcm90b2NvbH1gKTtcbiAgfVxuICB1cmwucGF0aG5hbWUgPSBwYXRoO1xuICB1cmwuc2VhcmNoID0gJyc7XG4gIHVybC5zZWFyY2hQYXJhbXMuc2V0KCd0b2tlbicsIHRva2VuKTtcbiAgcmV0dXJuIHVybC50b1N0cmluZygpO1xufVxuXG5mdW5jdGlvbiBkZWZhdWx0V2ViU29ja2V0RmFjdG9yeSh1cmw6IHN0cmluZyk6IFdlYlNvY2tldExpa2Uge1xuICBjb25zdCB3ZWJzb2NrZXQgPSAoZ2xvYmFsVGhpcyBhcyB7IFdlYlNvY2tldD86IHVua25vd24gfSkuV2ViU29ja2V0O1xuICBpZiAodHlwZW9mIHdlYnNvY2tldCAhPT0gJ2Z1bmN0aW9uJykge1xuICAgIHRocm93IG5ldyBOZXR3b3JrRXJyb3IoXG4gICAgICAnV2ViU29ja2V0IGlzIG5vdCBhdmFpbGFibGUgaW4gdGhpcyBPYnNpZGlhbiBidWlsZCAoaXQgaXMgYnVpbHQgaW4gb24gZGVza3RvcCBhbmQgJyArXG4gICAgICAgICdtb2JpbGU7IGEgdmVyeSBvbGQgYXBwIHZlcnNpb24gb3IgYSBzdHJpcHBlZCB3ZWJ2aWV3IGlzIHRoZSBvbmx5IGtub3duIGNhdXNlKS4gJyArXG4gICAgICAgICdTeW5jIHJlcXVpcmVzIGl0LicsXG4gICAgKTtcbiAgfVxuICByZXR1cm4gbmV3ICh3ZWJzb2NrZXQgYXMgbmV3ICh1cmw6IHN0cmluZykgPT4gV2ViU29ja2V0TGlrZSkodXJsKTtcbn1cblxuZXhwb3J0IGNsYXNzIFdlYlNvY2tldFRyYW5zcG9ydCBpbXBsZW1lbnRzIFRyYW5zcG9ydCB7XG4gIHByaXZhdGUgcmVhZG9ubHkgc29ja2V0OiBXZWJTb2NrZXRMaWtlO1xuICBwcml2YXRlIG1lc3NhZ2VDYWxsYmFjazogKChtZXNzYWdlOiBNZXNzYWdlKSA9PiB2b2lkKSB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGNsb3NlQ2FsbGJhY2s6ICgocmVhc29uOiBDbG9zZVJlYXNvbikgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBvcGVuID0gZmFsc2U7XG4gIHByaXZhdGUgY2xvc2VkID0gZmFsc2U7XG4gIHByaXZhdGUgY2xvc2VOb3RpZmllZCA9IGZhbHNlO1xuICBwcml2YXRlIHJlYWRvbmx5IHNlbmRRdWV1ZTogc3RyaW5nW10gPSBbXTtcbiAgcHJpdmF0ZSBsYXN0RXJyb3I6IHN0cmluZyB8IHVuZGVmaW5lZDtcblxuICBjb25zdHJ1Y3RvcihvcHRpb25zOiBXZWJTb2NrZXRUcmFuc3BvcnRPcHRpb25zKSB7XG4gICAgY29uc3QgZmFjdG9yeSA9IG9wdGlvbnMud3NGYWN0b3J5ID8/IGRlZmF1bHRXZWJTb2NrZXRGYWN0b3J5O1xuICAgIGNvbnN0IHVybCA9IHRvV2ViU29ja2V0VXJsKG9wdGlvbnMudXJsLCBvcHRpb25zLnRva2VuLCBvcHRpb25zLnBhdGggPz8gJy93cycpO1xuICAgIHRoaXMuc29ja2V0ID0gZmFjdG9yeSh1cmwpO1xuXG4gICAgdGhpcy5zb2NrZXQuYWRkRXZlbnRMaXN0ZW5lcignb3BlbicsICgpID0+IHtcbiAgICAgIHRoaXMub3BlbiA9IHRydWU7XG4gICAgICBjb25zdCBxdWV1ZWQgPSBbLi4udGhpcy5zZW5kUXVldWVdO1xuICAgICAgdGhpcy5zZW5kUXVldWUubGVuZ3RoID0gMDtcbiAgICAgIGZvciAoY29uc3QgZnJhbWUgb2YgcXVldWVkKSB0aGlzLnNvY2tldC5zZW5kKGZyYW1lKTtcbiAgICB9KTtcblxuICAgIHRoaXMuc29ja2V0LmFkZEV2ZW50TGlzdGVuZXIoJ21lc3NhZ2UnLCAoZXZlbnQpID0+IHtcbiAgICAgIGlmICh0eXBlb2YgZXZlbnQuZGF0YSAhPT0gJ3N0cmluZycpIHtcbiAgICAgICAgdGhpcy5mYWlsKHsgY29kZTogMTAwMywgcmVhc29uOiAnYmluYXJ5IGZyYW1lcyBhcmUgbm90IHBhcnQgb2YgdGhlIHByb3RvY29sJyB9KTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgICAgbGV0IG1lc3NhZ2U6IE1lc3NhZ2U7XG4gICAgICB0cnkge1xuICAgICAgICBtZXNzYWdlID0gcGFyc2VNZXNzYWdlKGV2ZW50LmRhdGEpO1xuICAgICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgICAgdGhpcy5mYWlsKHsgY29kZTogMTAwMiwgcmVhc29uOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcikgfSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICAgIHRoaXMubWVzc2FnZUNhbGxiYWNrPy4obWVzc2FnZSk7XG4gICAgfSk7XG5cbiAgICB0aGlzLnNvY2tldC5hZGRFdmVudExpc3RlbmVyKCdlcnJvcicsIChldmVudCkgPT4ge1xuICAgICAgdGhpcy5sYXN0RXJyb3IgPVxuICAgICAgICBldmVudCBpbnN0YW5jZW9mIEVycm9yID8gZXZlbnQubWVzc2FnZSA6IGV2ZW50ICE9PSB1bmRlZmluZWQgPyBTdHJpbmcoZXZlbnQpIDogJ3NvY2tldCBlcnJvcic7XG4gICAgfSk7XG5cbiAgICB0aGlzLnNvY2tldC5hZGRFdmVudExpc3RlbmVyKCdjbG9zZScsIChldmVudCkgPT4ge1xuICAgICAgdGhpcy5maW5pc2hDbG9zZSh7XG4gICAgICAgIGNvZGU6IGV2ZW50LmNvZGUsXG4gICAgICAgIHJlYXNvbjogZXZlbnQucmVhc29uICE9PSB1bmRlZmluZWQgJiYgZXZlbnQucmVhc29uICE9PSAnJyA/IGV2ZW50LnJlYXNvbiA6IHRoaXMubGFzdEVycm9yLFxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICBzZW5kKG1lc3NhZ2U6IE1lc3NhZ2UpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5jbG9zZWQpIHRocm93IG5ldyBOZXR3b3JrRXJyb3IoJ3NlbmQgb24gYSBjbG9zZWQgdHJhbnNwb3J0Jyk7XG4gICAgY29uc3QgZnJhbWUgPSBKU09OLnN0cmluZ2lmeShtZXNzYWdlKTtcbiAgICBpZiAodGhpcy5vcGVuKSB7XG4gICAgICB0aGlzLnNvY2tldC5zZW5kKGZyYW1lKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdGhpcy5zZW5kUXVldWUucHVzaChmcmFtZSk7XG4gIH1cblxuICBvbk1lc3NhZ2UoY2FsbGJhY2s6IChtZXNzYWdlOiBNZXNzYWdlKSA9PiB2b2lkKTogdm9pZCB7XG4gICAgdGhpcy5tZXNzYWdlQ2FsbGJhY2sgPSBjYWxsYmFjaztcbiAgfVxuXG4gIG9uQ2xvc2UoY2FsbGJhY2s6IChyZWFzb246IENsb3NlUmVhc29uKSA9PiB2b2lkKTogdm9pZCB7XG4gICAgdGhpcy5jbG9zZUNhbGxiYWNrID0gY2FsbGJhY2s7XG4gIH1cblxuICBjbG9zZSgpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5jbG9zZWQpIHJldHVybjtcbiAgICB0aGlzLmNsb3NlZCA9IHRydWU7XG4gICAgdGhpcy5zZW5kUXVldWUubGVuZ3RoID0gMDtcbiAgICB0cnkge1xuICAgICAgdGhpcy5zb2NrZXQuY2xvc2UoMTAwMCwgJ2Nsb3NlZCBieSBjYWxsZXInKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIC8vIGFscmVhZHkgZGVhZCBcdTIwMTQgdGhlIGNsb3NlIGV2ZW50IG1heSBuZXZlciBhcnJpdmVcbiAgICB9XG4gICAgLy8gTm90aWZ5IGV2ZW4gaWYgdGhlIHNvY2tldCBuZXZlciBlbWl0cyAnY2xvc2UnIChmYWlsZWQgZGlhbCkuXG4gICAgdGhpcy5maW5pc2hDbG9zZSh7IGNvZGU6IDEwMDAsIHJlYXNvbjogJ2Nsb3NlZCBieSBjYWxsZXInIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBmYWlsKHJlYXNvbjogQ2xvc2VSZWFzb24pOiB2b2lkIHtcbiAgICB0aGlzLmNsb3NlZCA9IHRydWU7XG4gICAgdHJ5IHtcbiAgICAgIHRoaXMuc29ja2V0LmNsb3NlKHJlYXNvbi5jb2RlID8/IDEwMDIsIHJlYXNvbi5yZWFzb24gPz8gJycpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgLy8gYWxyZWFkeSBjbG9zZWRcbiAgICB9XG4gICAgdGhpcy5maW5pc2hDbG9zZShyZWFzb24pO1xuICB9XG5cbiAgcHJpdmF0ZSBmaW5pc2hDbG9zZShyZWFzb246IENsb3NlUmVhc29uKTogdm9pZCB7XG4gICAgdGhpcy5vcGVuID0gZmFsc2U7XG4gICAgdGhpcy5jbG9zZWQgPSB0cnVlO1xuICAgIGlmICh0aGlzLmNsb3NlTm90aWZpZWQpIHJldHVybjtcbiAgICB0aGlzLmNsb3NlTm90aWZpZWQgPSB0cnVlO1xuICAgIHRoaXMuY2xvc2VDYWxsYmFjaz8uKHJlYXNvbik7XG4gIH1cbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTs7O0FDY0EsSUFBQUEsbUJBQStCOzs7QUNLeEIsSUFBTSx3QkFBTixjQUFvQyxNQUFNO0FBQUEsRUFDL0MsWUFBWSxTQUFpQjtBQUMzQixVQUFNLE9BQU87QUFDYixTQUFLLE9BQU87QUFBQSxFQUNkO0FBQ0Y7QUFhTyxTQUFTLG1CQUFtQixPQUEwQjtBQUMzRCxNQUFJLE9BQU8sVUFBVSxVQUFVO0FBQzdCLFVBQU0sSUFBSSxzQkFBc0Isb0NBQW9DLE9BQU8sS0FBSyxFQUFFO0FBQUEsRUFDcEY7QUFDQSxNQUFJLE1BQU0sU0FBUyxJQUFJLEdBQUc7QUFDeEIsVUFBTSxJQUFJLHNCQUFzQixpQ0FBaUMsS0FBSyxVQUFVLEtBQUssQ0FBQyxFQUFFO0FBQUEsRUFDMUY7QUFDQSxNQUFJLGFBQWEsS0FBSyxLQUFLLEdBQUc7QUFDNUIsVUFBTSxJQUFJO0FBQUEsTUFDUixnRUFBZ0UsS0FBSyxVQUFVLEtBQUssQ0FBQztBQUFBLElBQ3ZGO0FBQUEsRUFDRjtBQUNBLE1BQUksTUFBTSxXQUFXLE1BQU0sR0FBRztBQUM1QixVQUFNLElBQUk7QUFBQSxNQUNSLHNDQUFzQyxLQUFLLFVBQVUsS0FBSyxDQUFDO0FBQUEsSUFDN0Q7QUFBQSxFQUNGO0FBRUEsUUFBTSxZQUFZLE1BQU0sUUFBUSxPQUFPLEdBQUc7QUFDMUMsTUFBSSxVQUFVLFdBQVcsSUFBSSxHQUFHO0FBQzlCLFVBQU0sSUFBSTtBQUFBLE1BQ1IscUVBQXFFLEtBQUssVUFBVSxLQUFLLENBQUM7QUFBQSxJQUM1RjtBQUFBLEVBQ0Y7QUFFQSxRQUFNLFdBQXFCLENBQUM7QUFDNUIsYUFBVyxXQUFXLFVBQVUsTUFBTSxHQUFHLEdBQUc7QUFDMUMsUUFBSSxZQUFZLE1BQU0sWUFBWSxJQUFLO0FBQ3ZDLFFBQUksWUFBWSxNQUFNO0FBQ3BCLFVBQUksU0FBUyxXQUFXLEdBQUc7QUFDekIsY0FBTSxJQUFJO0FBQUEsVUFDUixzQ0FBc0MsS0FBSyxVQUFVLEtBQUssQ0FBQztBQUFBLFFBQzdEO0FBQUEsTUFDRjtBQUNBLGVBQVMsSUFBSTtBQUNiO0FBQUEsSUFDRjtBQUNBLGFBQVMsS0FBSyxPQUFPO0FBQUEsRUFDdkI7QUFDQSxTQUFPLFNBQVMsV0FBVyxJQUFJLE1BQU0sSUFBSSxTQUFTLEtBQUssR0FBRyxDQUFDO0FBQzdEO0FBMkJPLFNBQVMsV0FBVyxNQUF5QjtBQUNsRCxRQUFNLGFBQWEsbUJBQW1CLElBQUk7QUFDMUMsTUFBSSxlQUFlLElBQUssUUFBTztBQUMvQixRQUFNLFlBQVksV0FBVyxZQUFZLEdBQUc7QUFDNUMsU0FBTyxjQUFjLElBQUksTUFBTSxXQUFXLE1BQU0sR0FBRyxTQUFTO0FBQzlEO0FBS08sU0FBUyxTQUFTLE1BQXNCO0FBQzdDLFFBQU0sYUFBYSxtQkFBbUIsSUFBSTtBQUMxQyxNQUFJLGVBQWUsSUFBSyxRQUFPO0FBQy9CLFNBQU8sV0FBVyxNQUFNLFdBQVcsWUFBWSxHQUFHLElBQUksQ0FBQztBQUN6RDs7O0FDMUZPLFNBQVMsY0FBYyxHQUFpQixHQUFrQztBQUMvRSxNQUFJLEVBQUUsWUFBWSxFQUFFLFFBQVMsUUFBTyxFQUFFLFVBQVUsRUFBRSxVQUFVLElBQUk7QUFDaEUsTUFBSSxFQUFFLGFBQWEsRUFBRSxTQUFVLFFBQU8sRUFBRSxXQUFXLEVBQUUsV0FBVyxJQUFJO0FBQ3BFLFNBQU87QUFDVDtBQVdPLFNBQVMsVUFDZCxRQUNBLFVBQ2M7QUE5Q2hCO0FBK0NFLFNBQU8sRUFBRSxXQUFVLHNDQUFRLFlBQVIsWUFBbUIsS0FBSyxHQUFHLFNBQVM7QUFDekQ7OztBQ3ZDQSxlQUFzQixVQUFVLE9BQTZDO0FBQzNFLFFBQU0sT0FBTyxPQUFPLFVBQVUsV0FBVyxJQUFJLFlBQVksRUFBRSxPQUFPLEtBQUssSUFBSTtBQUszRSxRQUFNLFNBQVMsTUFBTSxPQUFPLE9BQU8sT0FBTyxXQUFXLElBQW9CO0FBQ3pFLFNBQU8sTUFBTSxJQUFJLFdBQVcsTUFBTSxDQUFDO0FBQ3JDO0FBd0NBLFNBQVMsTUFBTSxPQUEyQjtBQUN4QyxNQUFJLE1BQU07QUFDVixhQUFXLFFBQVEsT0FBTztBQUN4QixXQUFPLEtBQUssU0FBUyxFQUFFLEVBQUUsU0FBUyxHQUFHLEdBQUc7QUFBQSxFQUMxQztBQUNBLFNBQU87QUFDVDs7O0FDakRPLElBQWUsaUJBQWYsY0FBc0MsTUFBTTtBQUFBLEVBR2pELFlBQVksU0FBaUIsU0FBd0I7QUFDbkQsVUFBTSxTQUFTLE9BQU87QUFDdEIsU0FBSyxPQUFPLFdBQVc7QUFBQSxFQUN6QjtBQUNGO0FBUU8sSUFBTSxvQkFBTixjQUFnQyxlQUFlO0FBQUEsRUFBL0M7QUFBQTtBQUNMLHdCQUFTLFFBQU87QUFBQTtBQUNsQjtBQUdPLElBQU0sZUFBTixjQUEyQixlQUFlO0FBQUEsRUFBMUM7QUFBQTtBQUNMLHdCQUFTLFFBQU87QUFBQTtBQUNsQjtBQVFPLElBQU0sZ0JBQU4sY0FBNEIsZUFBZTtBQUFBLEVBQTNDO0FBQUE7QUFDTCx3QkFBUyxRQUFPO0FBQUE7QUFDbEI7QUFHTyxJQUFNLGVBQU4sY0FBMkIsZUFBZTtBQUFBLEVBQTFDO0FBQUE7QUFDTCx3QkFBUyxRQUFPO0FBQUE7QUFDbEI7OztBQ3JCTyxJQUFNLDZCQUE2QjtBQUduQyxJQUFNLGlDQUFpQztBQUd2QyxJQUFNLHlCQUF5QjtBQXlFL0IsU0FBUyxZQUFZLE9BQW1CLFFBQXNDO0FBQ25GLE1BQUksT0FBTyxXQUFXLE9BQU8sY0FBYyxRQUFXO0FBQ3BELFVBQU0sSUFBSTtBQUFBLE1BQ1IsOEJBQThCLEtBQUssVUFBVSxPQUFPLElBQUksQ0FBQztBQUFBLElBQzNEO0FBQUEsRUFDRjtBQUNBLFFBQU0sT0FBd0MsRUFBRSxHQUFHLE1BQU07QUFDekQsUUFBTSxRQUF5QjtBQUFBLElBQzdCLE1BQU0sT0FBTztBQUFBLElBQ2IsTUFBTSxPQUFPO0FBQUEsSUFDYixXQUFXLE9BQU87QUFBQSxJQUNsQixPQUFPLE9BQU87QUFBQSxFQUNoQjtBQUNBLE1BQUksT0FBTyxRQUFTLE9BQU0sWUFBWSxPQUFPO0FBQzdDLE1BQUksT0FBTyxTQUFVLE9BQU0sV0FBVztBQUN0QyxNQUFJLE9BQU8sVUFBVSxPQUFXLE9BQU0sUUFBUSxPQUFPO0FBQ3JELE9BQUssT0FBTyxJQUFJLElBQUk7QUFDcEIsU0FBTztBQUNUO0FBUU8sU0FBUyxZQUFZLE9BQW1CLE1BQTBCO0FBQ3ZFLE1BQUksRUFBRSxRQUFRLE9BQVEsUUFBTztBQUM3QixRQUFNLE9BQXdDLEVBQUUsR0FBRyxNQUFNO0FBQ3pELFNBQU8sS0FBSyxJQUFJO0FBQ2hCLFNBQU87QUFDVDtBQU9PLFNBQVMsb0JBQW9CLE9BQTJCO0FBQzdELFFBQU0sVUFBMkMsQ0FBQztBQUNsRCxhQUFXLFFBQVEsT0FBTyxLQUFLLEtBQUssRUFBRSxLQUFLLEdBQUc7QUFDNUMsWUFBUSxJQUFJLElBQUksTUFBTSxJQUFJO0FBQUEsRUFDNUI7QUFDQSxRQUFNLFdBQStCO0FBQUEsSUFDbkMsZUFBZTtBQUFBLElBQ2Y7QUFBQSxFQUNGO0FBQ0EsU0FBTyxLQUFLLFVBQVUsUUFBUTtBQUNoQztBQVVPLFNBQVMsc0JBQXNCLE1BQTBCO0FBQzlELE1BQUk7QUFDSixNQUFJO0FBQ0YsYUFBUyxLQUFLLE1BQU0sSUFBSTtBQUFBLEVBQzFCLFNBQVMsT0FBTztBQUNkLFVBQU0sSUFBSSxjQUFjLHVDQUF1QyxFQUFFLE1BQU0sQ0FBQztBQUFBLEVBQzFFO0FBQ0EsTUFBSSxDQUFDLGNBQWMsTUFBTSxHQUFHO0FBQzFCLFVBQU0sSUFBSSxjQUFjLG9DQUFvQztBQUFBLEVBQzlEO0FBQ0EsUUFBTSxVQUFVLE9BQU87QUFDdkIsTUFBSSxPQUFPLFlBQVksWUFBWSxDQUFDLE9BQU8sVUFBVSxPQUFPLEdBQUc7QUFDN0QsVUFBTSxJQUFJLGNBQWMsb0RBQW9EO0FBQUEsRUFDOUU7QUFDQSxNQUFJLFVBQVUsa0NBQWtDLFVBQVUsNEJBQTRCO0FBQ3BGLFVBQU0sSUFBSTtBQUFBLE1BQ1IsOEJBQThCLE9BQU8sNkNBQ3RCLDhCQUE4QixLQUFLLDBCQUEwQjtBQUFBLElBRTlFO0FBQUEsRUFDRjtBQUNBLFFBQU0sYUFBYSxPQUFPO0FBQzFCLE1BQUksQ0FBQyxjQUFjLFVBQVUsR0FBRztBQUM5QixVQUFNLElBQUksY0FBYyxpREFBaUQ7QUFBQSxFQUMzRTtBQUVBLFFBQU0sVUFBMkMsQ0FBQztBQUNsRCxhQUFXLENBQUMsTUFBTSxHQUFHLEtBQUssT0FBTyxRQUFRLFVBQVUsR0FBRztBQUNwRCxZQUFRLElBQUksSUFBSSxXQUFXLE1BQU0sR0FBRztBQUFBLEVBQ3RDO0FBQ0EsU0FBTztBQUNUO0FBRUEsU0FBUyxXQUFXLE1BQWMsS0FBK0I7QUFDL0QsUUFBTSxRQUFRLHFCQUFxQixLQUFLLFVBQVUsSUFBSSxDQUFDO0FBQ3ZELE1BQUksQ0FBQyxjQUFjLEdBQUcsRUFBRyxPQUFNLElBQUksY0FBYyxHQUFHLEtBQUssbUJBQW1CO0FBQzVFLFFBQU0sRUFBRSxNQUFNLE1BQU0sV0FBVyxPQUFPLFdBQVcsVUFBVSxNQUFNLElBQUk7QUFDckUsTUFBSSxPQUFPLFNBQVMsU0FBVSxPQUFNLElBQUksY0FBYyxHQUFHLEtBQUsseUJBQXlCO0FBQ3ZGLE1BQUksT0FBTyxjQUFjLFVBQVU7QUFDakMsVUFBTSxJQUFJLGNBQWMsR0FBRyxLQUFLLDhCQUE4QjtBQUFBLEVBQ2hFO0FBQ0EsTUFBSSxPQUFPLFNBQVMsWUFBWSxDQUFDLE9BQU8sVUFBVSxJQUFJLEtBQUssT0FBTyxHQUFHO0FBQ25FLFVBQU0sSUFBSSxjQUFjLEdBQUcsS0FBSyx1Q0FBdUM7QUFBQSxFQUN6RTtBQUNBLE1BQUksQ0FBQyxjQUFjLEtBQUssS0FBSyxPQUFPLE1BQU0sWUFBWSxZQUFZLE9BQU8sTUFBTSxhQUFhLFVBQVU7QUFDcEcsVUFBTSxJQUFJLGNBQWMsR0FBRyxLQUFLLHVEQUF1RDtBQUFBLEVBQ3pGO0FBQ0EsTUFBSSxjQUFjLFVBQWEsT0FBTyxjQUFjLFVBQVU7QUFDNUQsVUFBTSxJQUFJLGNBQWMsR0FBRyxLQUFLLDJDQUEyQztBQUFBLEVBQzdFO0FBQ0EsTUFBSSxhQUFhLFVBQWEsT0FBTyxhQUFhLFdBQVc7QUFDM0QsVUFBTSxJQUFJLGNBQWMsR0FBRyxLQUFLLDJDQUEyQztBQUFBLEVBQzdFO0FBQ0EsTUFBSSxVQUFVLFdBQWMsT0FBTyxVQUFVLFlBQVksQ0FBQyxPQUFPLFNBQVMsS0FBSyxJQUFJO0FBQ2pGLFVBQU0sSUFBSSxjQUFjLEdBQUcsS0FBSyw4Q0FBOEM7QUFBQSxFQUNoRjtBQUNBLFFBQU0sUUFBeUI7QUFBQSxJQUM3QjtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsSUFDQSxPQUFPLEVBQUUsU0FBUyxNQUFNLFNBQW1CLFVBQVUsTUFBTSxTQUFtQjtBQUFBLEVBQ2hGO0FBQ0EsTUFBSSxjQUFjLE9BQVcsT0FBTSxZQUFZO0FBQy9DLE1BQUksYUFBYSxPQUFXLE9BQU0sV0FBVztBQUM3QyxNQUFJLFVBQVUsT0FBVyxPQUFNLFFBQVE7QUFDdkMsU0FBTztBQUNUO0FBRUEsU0FBUyxjQUFjLE9BQWtEO0FBQ3ZFLFNBQU8sT0FBTyxVQUFVLFlBQVksVUFBVSxRQUFRLENBQUMsTUFBTSxRQUFRLEtBQUs7QUFDNUU7OztBQ3pMQSxlQUFzQixVQUNwQixTQUNBLE9BQ0EsTUFDQSxXQUNBLFVBQTRCLENBQUMsR0FDUjtBQTFEdkI7QUEyREUsUUFBTSxPQUFNLGFBQVEsUUFBUixZQUFlLEtBQUssSUFBSTtBQUNwQyxNQUFJLFVBQXNCO0FBRTFCLE1BQUk7QUFDRixlQUFXLFFBQVEsS0FBSyxPQUFPO0FBQzdCLGdCQUFVLE1BQU0sYUFBYSxTQUFTLFNBQVMsTUFBTSxXQUFXLEdBQUc7QUFBQSxJQUNyRTtBQUFBLEVBQ0YsU0FBUyxPQUFPO0FBQ2QsUUFBSTtBQUNGLFlBQU0sYUFBYSxTQUFTLE9BQU87QUFBQSxJQUNyQyxTQUFRO0FBQUEsSUFHUjtBQUNBLFVBQU07QUFBQSxFQUNSO0FBRUEsUUFBTSxhQUFhLFNBQVMsT0FBTztBQUNuQyxTQUFPO0FBQ1Q7QUFFQSxlQUFlLGFBQ2IsU0FDQSxPQUNBLE1BQ0EsV0FDQSxLQUNxQjtBQUNyQixNQUFJLEtBQUssU0FBUyxVQUFVO0FBQzFCLFFBQUksTUFBTSxRQUFRLE9BQU8sS0FBSyxRQUFRLEdBQUc7QUFDdkMsWUFBTSxRQUFRLFdBQVcsS0FBSyxVQUFVLEtBQUssTUFBTTtBQUFBLElBQ3JELE9BQU87QUFFTCxZQUFNLGNBQWMsU0FBUyxLQUFLLFFBQVEsS0FBSyxNQUFNLFNBQVM7QUFBQSxJQUNoRTtBQUNBLFdBQU8sWUFBWSxZQUFZLE9BQU8sS0FBSyxRQUFRLEdBQUc7QUFBQSxNQUNwRCxNQUFNLEtBQUs7QUFBQSxNQUNYLFdBQVcsS0FBSztBQUFBLE1BQ2hCLE1BQU0sS0FBSztBQUFBLE1BQ1gsTUFBTSxLQUFLO0FBQUEsTUFDWCxPQUFPLEtBQUs7QUFBQSxJQUNkLENBQUM7QUFBQSxFQUNIO0FBRUEsTUFBSSxLQUFLLFVBQVU7QUFJakIsUUFBSSxDQUFDLEtBQUssUUFBUyxPQUFNLFFBQVEsVUFBVSxLQUFLLElBQUk7QUFDcEQsV0FBTyxZQUFZLE9BQU87QUFBQSxNQUN4QixNQUFNLEtBQUs7QUFBQSxNQUNYLFdBQVcsS0FBSztBQUFBLE1BQ2hCLE1BQU0sS0FBSztBQUFBLE1BQ1gsTUFBTSxLQUFLO0FBQUEsTUFDWCxPQUFPLEtBQUs7QUFBQSxNQUNaLFNBQVMsS0FBSztBQUFBLE1BQ2QsV0FBVyxLQUFLLFVBQVUsTUFBTTtBQUFBLE1BQ2hDLFVBQVU7QUFBQSxJQUNaLENBQUM7QUFBQSxFQUNIO0FBRUEsTUFBSSxLQUFLLFNBQVM7QUFHaEIsVUFBTSxRQUFRLFdBQVcsS0FBSyxJQUFJO0FBQ2xDLFdBQU8sWUFBWSxPQUFPO0FBQUEsTUFDeEIsTUFBTSxLQUFLO0FBQUEsTUFDWCxXQUFXLEtBQUs7QUFBQSxNQUNoQixNQUFNLEtBQUs7QUFBQSxNQUNYLE1BQU0sS0FBSztBQUFBLE1BQ1gsT0FBTyxLQUFLO0FBQUEsTUFDWixTQUFTO0FBQUEsTUFDVCxXQUFXO0FBQUEsSUFDYixDQUFDO0FBQUEsRUFDSDtBQUVBLFFBQU0sVUFBVSxNQUFNLEtBQUssSUFBSTtBQUMvQixNQUNFLFlBQVksVUFDWixRQUFRLGNBQWMsVUFDdEIsUUFBUSxTQUFTLEtBQUssUUFDckIsTUFBTSxRQUFRLE9BQU8sS0FBSyxJQUFJLEdBQy9CO0FBS0EsV0FBTyxZQUFZLE9BQU87QUFBQSxNQUN4QixNQUFNLEtBQUs7QUFBQSxNQUNYLFdBQVcsS0FBSztBQUFBLE1BQ2hCLE1BQU0sS0FBSztBQUFBLE1BQ1gsTUFBTSxLQUFLO0FBQUEsTUFDWCxPQUFPLEtBQUs7QUFBQSxJQUNkLENBQUM7QUFBQSxFQUNIO0FBRUEsUUFBTSxjQUFjLFNBQVMsS0FBSyxNQUFNLEtBQUssTUFBTSxTQUFTO0FBQzVELFNBQU8sWUFBWSxPQUFPO0FBQUEsSUFDeEIsTUFBTSxLQUFLO0FBQUEsSUFDWCxXQUFXLEtBQUs7QUFBQSxJQUNoQixNQUFNLEtBQUs7QUFBQSxJQUNYLE1BQU0sS0FBSztBQUFBLElBQ1gsT0FBTyxLQUFLO0FBQUEsRUFDZCxDQUFDO0FBQ0g7QUFHQSxlQUFlLGNBQ2IsU0FDQSxNQUNBLE1BQ0EsV0FDZTtBQUNmLFFBQU0sUUFBUSxNQUFNLFVBQVUsSUFBSTtBQUNsQyxRQUFNLFNBQVMsTUFBTSxVQUFVLEtBQUs7QUFDcEMsTUFBSSxXQUFXLE1BQU07QUFDbkIsVUFBTSxJQUFJO0FBQUEsTUFDUiwwQkFBMEIsS0FBSyxVQUFVLElBQUksQ0FBQyxjQUFjLElBQUksU0FBUyxNQUFNO0FBQUEsSUFDakY7QUFBQSxFQUNGO0FBQ0EsUUFBTSxRQUFRLFVBQVUsTUFBTSxLQUFLO0FBQ3JDO0FBRUEsZUFBZSxhQUFhLFNBQXlCLE9BQWtDO0FBQ3JGLFFBQU0sUUFBUTtBQUFBLElBQ1o7QUFBQSxJQUNBLElBQUksWUFBWSxFQUFFLE9BQU8sb0JBQW9CLEtBQUssQ0FBQztBQUFBLEVBQ3JEO0FBQ0Y7QUFPQSxlQUFzQixlQUFlLFNBQThDO0FBQ2pGLFFBQU0sUUFBUSxNQUFNLFFBQVEsU0FBUyxzQkFBc0I7QUFDM0QsU0FBTyxzQkFBc0IsSUFBSSxZQUFZLEVBQUUsT0FBTyxLQUFLLENBQUM7QUFDOUQ7OztBQ3BMQSxJQUFNLDBCQUErQyxvQkFBSSxJQUFJO0FBQUEsRUFDM0Q7QUFBQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUE7QUFBQSxFQUNBO0FBQ0YsQ0FBQztBQUdELElBQU0sMEJBQStDLG9CQUFJLElBQUk7QUFBQSxFQUMzRDtBQUFBLEVBQ0E7QUFDRixDQUFDO0FBVU0sU0FBUyxVQUFVLFdBQW1CLFVBQW1DO0FBQzlFLFFBQU0sYUFBYSxtQkFBbUIsU0FBUztBQUMvQyxNQUFJLGVBQWUsSUFBSyxRQUFPO0FBRS9CLFFBQU0sUUFBUSxXQUFXLE1BQU0sQ0FBQyxFQUFFLFlBQVk7QUFDOUMsUUFBTSxXQUFXLE1BQU0sTUFBTSxHQUFHO0FBRWhDLE1BQUksU0FBUyxLQUFLLENBQUMsWUFBWSx3QkFBd0IsSUFBSSxPQUFPLENBQUMsR0FBRztBQUNwRSxXQUFPO0FBQUEsRUFDVDtBQUVBLE1BQUksU0FBUyxDQUFDLE1BQU0sYUFBYTtBQUMvQixRQUFJLENBQUMsU0FBUyxhQUFjLFFBQU87QUFDbkMsUUFBSSx3QkFBd0IsSUFBSSxLQUFLLEVBQUcsUUFBTztBQUMvQyxRQUFJLFNBQVMsQ0FBQyxNQUFNLFFBQVMsUUFBTztBQUFBLEVBQ3RDO0FBRUEsU0FBTztBQUNUOzs7QUMzQ08sSUFBTSxrQkFBa0I7QUFHeEIsSUFBTSwyQkFBMkIsTUFBTTtBQWtPOUMsSUFBTSxlQUFvQyxvQkFBSSxJQUFJO0FBQUEsRUFDaEQ7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUNGLENBQUM7QUFDRCxJQUFNLGVBQW9DLG9CQUFJLElBQUk7QUFBQSxFQUNoRDtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUFBLEVBQ0E7QUFBQSxFQUNBO0FBQUEsRUFDQTtBQUNGLENBQUM7QUFRTSxTQUFTLFVBQVUsT0FBa0M7QUFDMUQsU0FDRSxPQUFPLFVBQVUsWUFDakIsVUFBVSxRQUNWLE9BQVEsTUFBNkIsU0FBUyxhQUM3QyxhQUFhLElBQUssTUFBMkIsSUFBSSxLQUNoRCxhQUFhLElBQUssTUFBMkIsSUFBSTtBQUV2RDtBQXNCTyxTQUFTLGFBQWEsTUFBdUI7QUFDbEQsTUFBSTtBQUNKLE1BQUk7QUFDRixhQUFTLEtBQUssTUFBTSxJQUFJO0FBQUEsRUFDMUIsU0FBUyxPQUFPO0FBQ2QsVUFBTSxJQUFJLGNBQWMsOEJBQThCLE9BQU8sSUFBSSxFQUFFLE1BQU0sR0FBRyxHQUFHLENBQUMsSUFBSSxFQUFFLE1BQU0sQ0FBQztBQUFBLEVBQy9GO0FBQ0EsTUFBSSxDQUFDLFVBQVUsTUFBTSxHQUFHO0FBQ3RCLFVBQU0sSUFBSTtBQUFBLE1BQ1Isc0NBQXNDLEtBQUssVUFBVyxpQ0FBK0IsSUFBSSxDQUFDO0FBQUEsSUFDNUY7QUFBQSxFQUNGO0FBQ0EsU0FBTztBQUNUO0FBU08sU0FBUyxjQUFjLE9BQTJCO0FBQ3ZELE1BQUksU0FBUztBQUNiLFFBQU0sUUFBUTtBQUNkLFdBQVMsU0FBUyxHQUFHLFNBQVMsTUFBTSxRQUFRLFVBQVUsT0FBTztBQUMzRCxjQUFVLE9BQU8sYUFBYSxHQUFHLE1BQU0sU0FBUyxRQUFRLFNBQVMsS0FBSyxDQUFDO0FBQUEsRUFDekU7QUFDQSxTQUFPLEtBQUssTUFBTTtBQUNwQjtBQUdPLFNBQVMsY0FBYyxTQUE2QjtBQUN6RCxNQUFJO0FBQ0osTUFBSTtBQUNGLGFBQVMsS0FBSyxPQUFPO0FBQUEsRUFDdkIsU0FBUyxPQUFPO0FBQ2QsVUFBTSxJQUFJLGNBQWMsK0JBQStCLEVBQUUsTUFBTSxDQUFDO0FBQUEsRUFDbEU7QUFDQSxRQUFNLFFBQVEsSUFBSSxXQUFXLE9BQU8sTUFBTTtBQUMxQyxXQUFTLElBQUksR0FBRyxJQUFJLE9BQU8sUUFBUSxJQUFLLE9BQU0sQ0FBQyxJQUFJLE9BQU8sV0FBVyxDQUFDO0FBQ3RFLFNBQU87QUFDVDs7O0FDN1RBLElBQU0seUJBQXlCO0FBRS9CLElBQU0sZ0JBQWdCO0FBR3RCLElBQU0seUJBQXlCO0FBRy9CLElBQU0sdUJBQXVCO0FBRzdCLElBQU0sdUJBQXVCO0FBUXRCLFNBQVMsbUJBQW1CLE1BQXNCO0FBQ3ZELE1BQUksVUFBVSxLQUFLLFFBQVEsd0JBQXdCLEVBQUUsRUFBRSxRQUFRLGVBQWUsRUFBRTtBQUNoRixZQUFVLENBQUMsR0FBRyxPQUFPLEVBQUUsTUFBTSxHQUFHLHNCQUFzQixFQUFFLEtBQUssRUFBRTtBQUMvRCxZQUFVLFFBQVEsS0FBSyxFQUFFLFFBQVEsb0JBQW9CLEVBQUU7QUFDdkQsU0FBTyxRQUFRLFdBQVcsSUFBSSx1QkFBdUI7QUFDdkQ7QUFlTyxTQUFTLGlCQUNkLE1BQ0EsWUFDQSxLQUNBLFNBQTZDLE1BQU0sT0FDM0M7QUFDUixRQUFNLGFBQWEsbUJBQW1CLElBQUk7QUFDMUMsUUFBTSxNQUFNLFdBQVcsVUFBVTtBQUNqQyxRQUFNLE9BQU8sU0FBUyxVQUFVO0FBRWhDLFFBQU0sVUFBVSxLQUFLLFlBQVksR0FBRztBQUNwQyxRQUFNLGVBQWUsVUFBVTtBQUMvQixRQUFNLE9BQU8sZUFBZSxLQUFLLE1BQU0sR0FBRyxPQUFPLElBQUk7QUFDckQsUUFBTSxZQUFZLGVBQWUsS0FBSyxNQUFNLE9BQU8sSUFBSTtBQUV2RCxRQUFNLFNBQVMsY0FBYyxvQkFBb0IsR0FBRyxDQUFDLFdBQVcsbUJBQW1CLFVBQVUsQ0FBQztBQUM5RixRQUFNLE9BQU8sQ0FBQyxhQUE4QixRQUFRLE1BQU0sSUFBSSxRQUFRLEtBQUssR0FBRyxHQUFHLElBQUksUUFBUTtBQUU3RixNQUFJLFlBQVksS0FBSyxHQUFHLElBQUksR0FBRyxNQUFNLEdBQUcsU0FBUyxFQUFFO0FBQ25ELFdBQVMsSUFBSSxHQUFHLEtBQUssc0JBQXNCLEtBQUs7QUFDOUMsUUFBSSxDQUFDLE9BQU8sU0FBUyxFQUFHLFFBQU87QUFDL0IsZ0JBQVksS0FBSyxHQUFHLElBQUksR0FBRyxNQUFNLElBQUksQ0FBQyxHQUFHLFNBQVMsRUFBRTtBQUFBLEVBQ3REO0FBQ0EsUUFBTSxJQUFJO0FBQUEsSUFDUiwrQkFBK0Isb0JBQW9CLG1CQUFtQixLQUFLLFVBQVUsVUFBVSxDQUFDO0FBQUEsRUFDbEc7QUFDRjtBQUdBLFNBQVMsb0JBQW9CLEtBQXFCO0FBQ2hELFFBQU0sSUFBSSxJQUFJLEtBQUssR0FBRztBQUN0QixRQUFNLE1BQU0sQ0FBQyxNQUFzQixPQUFPLENBQUMsRUFBRSxTQUFTLEdBQUcsR0FBRztBQUM1RCxTQUNFLEdBQUcsRUFBRSxlQUFlLENBQUMsSUFBSSxJQUFJLEVBQUUsWUFBWSxJQUFJLENBQUMsQ0FBQyxJQUFJLElBQUksRUFBRSxXQUFXLENBQUMsQ0FBQyxJQUNwRSxJQUFJLEVBQUUsWUFBWSxDQUFDLENBQUMsSUFBSSxJQUFJLEVBQUUsY0FBYyxDQUFDLENBQUM7QUFFdEQ7OztBQ2dFQSxJQUFNLGFBQTJCLEVBQUUsU0FBUyxHQUFHLFVBQVUsR0FBRztBQU9yRCxTQUFTLGdCQUFnQixPQUFnQztBQTFLaEU7QUEyS0UsUUFBTSxFQUFFLGNBQWMsT0FBTyxjQUFjLGdCQUFnQixJQUFJLElBQUk7QUFDbkUsUUFBTSxXQUFXLENBQUMsR0FBRyxNQUFNLFFBQVEsRUFBRSxLQUFLLENBQUMsR0FBRyxNQUFNLGVBQWUsRUFBRSxNQUFNLEVBQUUsSUFBSSxDQUFDO0FBQ2xGLFFBQU0saUJBQWlCLElBQUksSUFBSSxTQUFTLElBQUksQ0FBQyxVQUFVLENBQUMsTUFBTSxNQUFNLEtBQUssQ0FBQyxDQUFDO0FBRTNFLFFBQU0sU0FBbUIsQ0FBQztBQUMxQixRQUFNLFFBQWtCLENBQUM7QUFDekIsUUFBTSxZQUEwQixDQUFDO0FBR2pDLFFBQU0sYUFBYSxvQkFBSSxJQUFZO0FBQ25DLGFBQVcsS0FBSyxhQUFhLE1BQU8sWUFBVyxJQUFJLEVBQUUsSUFBSTtBQUN6RCxhQUFXLEtBQUssYUFBYSxTQUFVLFlBQVcsSUFBSSxFQUFFLElBQUk7QUFDNUQsYUFBVyxLQUFLLGFBQWEsUUFBUyxZQUFXLElBQUksRUFBRSxJQUFJO0FBQzNELGFBQVcsS0FBSyxhQUFhLFNBQVM7QUFDcEMsZUFBVyxJQUFJLEVBQUUsSUFBSTtBQUNyQixlQUFXLElBQUksRUFBRSxFQUFFO0FBQUEsRUFDckI7QUFHQSxRQUFNLFdBQVcsb0JBQUksSUFBWTtBQUVqQyxRQUFNLGFBQWEsQ0FBQyxTQUEwQixRQUFRLFNBQVMsZUFBZSxJQUFJLElBQUk7QUFPdEYsYUFBVyxVQUFVLENBQUMsR0FBRyxhQUFhLE9BQU8sRUFBRSxLQUFLLENBQUMsR0FBRyxNQUFNLGVBQWUsRUFBRSxNQUFNLEVBQUUsSUFBSSxDQUFDLEdBQUc7QUFDN0YsVUFBTSxZQUFZLE1BQU0sT0FBTyxJQUFJO0FBQ25DLFVBQU0sVUFBVSxNQUFNLE9BQU8sRUFBRTtBQUMvQixVQUFNLGFBQWEsZUFBZSxJQUFJLE9BQU8sSUFBSTtBQUNqRCxVQUFNLFdBQVcsZUFBZSxJQUFJLE9BQU8sRUFBRTtBQUU3QyxVQUFNLGNBQWMsYUFDaEIsbUJBQW1CLFdBQVcsVUFBVSxLQUN4Qyx1Q0FBVyxlQUFjO0FBQzdCLFVBQU0sWUFBWSxXQUNkLG1CQUFtQixTQUFTLFFBQVEsSUFDcEM7QUFFSixRQUFJLENBQUMsZUFBZSxDQUFDLFdBQVc7QUFDOUIsYUFBTyxLQUFLO0FBQUEsUUFDVixNQUFNO0FBQUEsUUFDTixVQUFVLE9BQU87QUFBQSxRQUNqQixRQUFRLE9BQU87QUFBQSxRQUNmLGdCQUFlLDRDQUFXLGNBQVgsWUFBd0I7QUFBQSxRQUN2QyxNQUFNLE9BQU87QUFBQSxRQUNiLE1BQU0sT0FBTztBQUFBLE1BQ2YsQ0FBQztBQUNEO0FBQUEsSUFDRjtBQUdBLFFBQUksQ0FBQyxhQUFhO0FBRWhCLFVBQUksYUFBYSxVQUFVLGNBQWMsUUFBVztBQUNsRCxlQUFPLEtBQUs7QUFBQSxVQUNWLE1BQU07QUFBQSxVQUNOLE1BQU0sT0FBTztBQUFBLFVBQ2IsZUFBZSxVQUFVO0FBQUEsVUFDekIsTUFBTSxVQUFVO0FBQUEsVUFDaEIsTUFBTSxVQUFVO0FBQUEsUUFDbEIsQ0FBQztBQUFBLE1BQ0g7QUFBQSxJQUNGLFdBQVcsQ0FBQyxjQUFjLFdBQVcsU0FBUztBQUc1QyxZQUFNO0FBQUEsUUFDSixTQUFTLFVBQVUsT0FBTyxNQUFNO0FBQUEsVUFDOUIsT0FBTSxvREFBWSxTQUFaLFlBQW9CLHVDQUFXLFNBQS9CLFlBQXVDLE9BQU87QUFBQSxVQUNwRCxPQUFNLG9EQUFZLFNBQVosWUFBb0IsdUNBQVcsU0FBL0IsWUFBdUMsT0FBTztBQUFBLFVBQ3BELFVBQVMsOENBQVksWUFBWixZQUF1QjtBQUFBLFVBQ2hDLFFBQU8sb0RBQVksVUFBWixZQUFxQix1Q0FBVyxVQUFoQyxZQUF5QztBQUFBLFVBQ2hELFNBQVM7QUFBQSxRQUNYLENBQUM7QUFBQSxNQUNIO0FBQUEsSUFDRixPQUFPO0FBSUwsWUFBTSxhQUFhLFVBQVUsdUNBQVcsT0FBTyxZQUFZO0FBQzNELFVBQUksY0FBYyxXQUFXLE9BQU8sVUFBVSxJQUFJLEdBQUc7QUFDbkQsY0FBTSxLQUFLLFNBQVMsUUFBUSxPQUFPLE1BQU0sVUFBVSxDQUFDO0FBQ3BELGtCQUFVLEtBQUs7QUFBQSxVQUNiLE1BQU0sT0FBTztBQUFBLFVBQ2IsUUFBUTtBQUFBLFVBQ1IsUUFBUTtBQUFBO0FBQUEsVUFFUixjQUFjO0FBQUEsVUFDZCxRQUFRLGNBQWMsVUFBVTtBQUFBLFVBQ2hDO0FBQUEsUUFDRixDQUFDO0FBQUEsTUFDSCxPQUFPO0FBQ0wsZUFBTyxLQUFLO0FBQUEsVUFDVixNQUFNO0FBQUEsVUFDTixVQUFVLE9BQU87QUFBQSxVQUNqQixRQUFRLE9BQU87QUFBQSxVQUNmLGdCQUFlLDRDQUFXLGNBQVgsWUFBd0I7QUFBQSxVQUN2QyxNQUFNLE9BQU87QUFBQSxVQUNiLE1BQU0sT0FBTztBQUFBLFFBQ2YsQ0FBQztBQUNELGtCQUFVLEtBQUs7QUFBQSxVQUNiLE1BQU0sT0FBTztBQUFBLFVBQ2IsUUFBUTtBQUFBLFVBQ1IsUUFBUTtBQUFBLFVBQ1IsY0FBYztBQUFBLFVBQ2QsUUFBUSxjQUFjLFVBQVU7QUFBQSxVQUNoQztBQUFBLFFBQ0YsQ0FBQztBQUNEO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFHQSxRQUFJLENBQUMsV0FBVztBQUNkLGFBQU8sS0FBSztBQUFBLFFBQ1YsT0FBTSxtQ0FBUyxlQUFjLFNBQVksWUFBWTtBQUFBLFFBQ3JELE1BQU0sT0FBTztBQUFBLFFBQ2IsZ0JBQWUsd0NBQVMsY0FBVCxZQUFzQjtBQUFBLFFBQ3JDLE1BQU0sT0FBTztBQUFBLFFBQ2IsTUFBTSxPQUFPO0FBQUEsTUFDZixDQUFDO0FBQUEsSUFDSCxPQUFPO0FBQ0wsMkJBQXFCLE9BQU8sSUFBSSxTQUFTLFVBQXdCO0FBQUEsUUFDL0QsTUFBTSxPQUFPO0FBQUEsUUFDYixPQUFNLG1DQUFTLGVBQWMsU0FBWSxZQUFZO0FBQUEsUUFDckQsTUFBTSxPQUFPO0FBQUEsUUFDYixNQUFNLE9BQU87QUFBQSxNQUNmLENBQUM7QUFBQSxJQUNIO0FBQUEsRUFDRjtBQU9BLGFBQVcsUUFBUSxPQUFPLEtBQUssS0FBSyxFQUNqQyxPQUFPLENBQUMsTUFBTTtBQUNiLFVBQU0sUUFBUSxNQUFNLENBQUM7QUFDckIsV0FBTyxNQUFNLGNBQWMsVUFBYSxDQUFDLE1BQU07QUFBQSxFQUNqRCxDQUFDLEVBQ0EsS0FBSyxjQUFjLEdBQUc7QUFDdkIsUUFBSSxXQUFXLElBQUksSUFBSSxLQUFLLFNBQVMsSUFBSSxJQUFJLEVBQUc7QUFDaEQsUUFBSSxlQUFlLElBQUksSUFBSSxFQUFHO0FBQzlCLFVBQU0sUUFBUSxNQUFNLElBQUk7QUFFeEIsUUFBSTtBQUNKLFFBQUksY0FBYztBQUNsQixlQUFXLGFBQWEsVUFBVTtBQUNoQyxVQUFJLFVBQVUsUUFBUztBQUN2QixVQUFJLFdBQVcsSUFBSSxVQUFVLElBQUksS0FBSyxTQUFTLElBQUksVUFBVSxJQUFJLEVBQUc7QUFDcEUsWUFBTSxRQUFRLE1BQU0sVUFBVSxJQUFJO0FBQ2xDLFVBQUksVUFBVSxVQUFhLE1BQU0sY0FBYyxPQUFXO0FBQzFELFVBQUksVUFBVSxTQUFTLE1BQU0sS0FBTTtBQUNuQyxZQUFNLFVBQVUsV0FBVyxVQUFVLElBQUksTUFBTSxXQUFXLElBQUk7QUFDOUQsVUFBSSxTQUFTLFFBQVc7QUFDdEIsZUFBTztBQUNQLHNCQUFjO0FBQUEsTUFDaEIsV0FBVyxXQUFXLENBQUMsYUFBYTtBQUNsQyxlQUFPO0FBQ1Asc0JBQWM7QUFBQSxNQUNoQjtBQUFBLElBQ0Y7QUFFQSxRQUFJLE1BQU07QUFDUixZQUFNLEtBQUs7QUFBQSxRQUNULE1BQU07QUFBQSxRQUNOLFVBQVU7QUFBQSxRQUNWLFFBQVEsS0FBSztBQUFBLFFBQ2IsTUFBTSxLQUFLO0FBQUEsUUFDWCxNQUFNLEtBQUs7QUFBQSxRQUNYLFNBQVMsS0FBSztBQUFBLFFBQ2QsT0FBTyxLQUFLO0FBQUEsTUFDZCxDQUFDO0FBQ0QsZUFBUyxJQUFJLElBQUk7QUFDakIsZUFBUyxJQUFJLEtBQUssSUFBSTtBQUFBLElBQ3hCLE9BQU87QUFLTCxZQUFNO0FBQUEsUUFDSixTQUFTLFVBQVUsTUFBTTtBQUFBLFVBQ3ZCLE1BQU0sTUFBTTtBQUFBLFVBQ1osTUFBTSxNQUFNO0FBQUEsVUFDWixTQUFTO0FBQUEsVUFDVCxPQUFPLE1BQU07QUFBQSxVQUNiLFNBQVM7QUFBQSxRQUNYLENBQUM7QUFBQSxNQUNIO0FBQ0EsZUFBUyxJQUFJLElBQUk7QUFBQSxJQUNuQjtBQUFBLEVBQ0Y7QUFHQSxhQUFXLFVBQVUsVUFBVTtBQUM3QixRQUFJLFdBQVcsSUFBSSxPQUFPLElBQUksS0FBSyxTQUFTLElBQUksT0FBTyxJQUFJLEVBQUc7QUFDOUQsVUFBTSxRQUFRLE1BQU0sT0FBTyxJQUFJO0FBQy9CLFFBQUksQ0FBQyxtQkFBbUIsT0FBTyxNQUFNLEVBQUc7QUFDeEMsUUFBSSxVQUFVLFFBQVc7QUFDdkIsVUFBSSxDQUFDLE9BQU8sU0FBUztBQUNuQixjQUFNLEtBQUssU0FBUyxPQUFPLE9BQU8sTUFBTSxNQUFNLENBQUM7QUFDL0MsaUJBQVMsSUFBSSxPQUFPLElBQUk7QUFBQSxNQUMxQjtBQUVBO0FBQUEsSUFDRjtBQUNBLFFBQUksT0FBTyxTQUFTO0FBQ2xCLFlBQU0sS0FBSyxTQUFTLFVBQVUsT0FBTyxNQUFNLE1BQU0sQ0FBQztBQUFBLElBQ3BELFdBQVcsTUFBTSxjQUFjLFFBQVc7QUFDeEMsWUFBTSxLQUFLLFNBQVMsV0FBVyxPQUFPLE1BQU0sTUFBTSxDQUFDO0FBQUEsSUFDckQsT0FBTztBQUNMLFlBQU0sS0FBSyxTQUFTLFFBQVEsT0FBTyxNQUFNLE1BQU0sQ0FBQztBQUFBLElBQ2xEO0FBQ0EsYUFBUyxJQUFJLE9BQU8sSUFBSTtBQUFBLEVBQzFCO0FBR0EsUUFBTSxhQUErQjtBQUFBLElBQ25DLEdBQUcsYUFBYSxNQUFNLElBQUksQ0FBQyxPQUFPLEVBQUUsR0FBRyxHQUFHLE1BQU0sTUFBZSxFQUFFO0FBQUEsSUFDakUsR0FBRyxhQUFhLFNBQVMsSUFBSSxDQUFDLE1BQUc7QUF6WXJDLFVBQUFDO0FBeVl5QztBQUFBLFFBQ25DLEdBQUc7QUFBQSxRQUNILFFBQU1BLE1BQUEsTUFBTSxFQUFFLElBQUksTUFBWixnQkFBQUEsSUFBZSxlQUFjLFNBQWEsWUFBdUI7QUFBQSxNQUN6RTtBQUFBLEtBQUU7QUFBQSxJQUNGLEdBQUcsYUFBYSxRQUFRLElBQUksQ0FBQyxPQUF1QixFQUFFLEdBQUcsR0FBRyxNQUFNLFNBQVMsRUFBRTtBQUFBLEVBQy9FLEVBQUUsS0FBSyxDQUFDLEdBQUcsTUFBTSxlQUFlLEVBQUUsTUFBTSxFQUFFLElBQUksQ0FBQztBQUUvQyxhQUFXLGFBQWEsWUFBWTtBQUNsQyxVQUFNLFFBQVEsTUFBTSxVQUFVLElBQUk7QUFDbEMsVUFBTSxTQUFTLGVBQWUsSUFBSSxVQUFVLElBQUk7QUFDaEQsVUFBTSxvQkFDSixXQUFXLFdBQWMsVUFBVSxTQUFZLE9BQU8sWUFBWSxNQUFNLFlBQVksQ0FBQyxPQUFPO0FBQzlGLFFBQUksQ0FBQyxtQkFBbUI7QUFDdEIsZ0JBQVUsV0FBVyxLQUFLO0FBQUEsSUFDNUIsT0FBTztBQUNMLDJCQUFxQixVQUFVLE1BQU0sT0FBTyxRQUFzQixTQUFTO0FBQUEsSUFDN0U7QUFBQSxFQUNGO0FBRUEsU0FBTztBQUFBLElBQ0wsUUFBUSxPQUFPLEtBQUssQ0FBQyxHQUFHLE1BQU0sZUFBZSxPQUFPLENBQUMsR0FBRyxPQUFPLENBQUMsQ0FBQyxDQUFDO0FBQUEsSUFDbEUsT0FBTyxNQUFNLEtBQUssQ0FBQyxHQUFHLE1BQU0sZUFBZSxPQUFPLENBQUMsR0FBRyxPQUFPLENBQUMsQ0FBQyxDQUFDO0FBQUEsSUFDaEUsV0FBVyxVQUFVLEtBQUssQ0FBQyxHQUFHLE1BQU0sZUFBZSxFQUFFLE1BQU0sRUFBRSxJQUFJLENBQUM7QUFBQSxJQUNsRSxjQUFjLENBQUMsR0FBRyxhQUFhLFlBQVksRUFBRSxLQUFLLGNBQWM7QUFBQSxFQUNsRTtBQUlBLFdBQVMsVUFBVSxXQUEyQixPQUEwQztBQXJhMUYsUUFBQUEsS0FBQUMsS0FBQUMsS0FBQUM7QUFzYUksUUFBSSxVQUFVLFNBQVMsVUFBVTtBQUMvQixhQUFPLEtBQUs7QUFBQSxRQUNWLE1BQU07QUFBQSxRQUNOLE1BQU0sVUFBVTtBQUFBLFFBQ2hCLGdCQUFlSCxNQUFBLCtCQUFPLGNBQVAsT0FBQUEsTUFBb0I7QUFBQSxRQUNuQyxPQUFNQyxNQUFBLCtCQUFPLFNBQVAsT0FBQUEsTUFBZSxVQUFVO0FBQUEsUUFDL0IsT0FBTUMsTUFBQSwrQkFBTyxTQUFQLE9BQUFBLE1BQWUsVUFBVTtBQUFBLE1BQ2pDLENBQUM7QUFDRDtBQUFBLElBQ0Y7QUFDQSxXQUFPLEtBQUs7QUFBQSxNQUNWLE1BQU0sVUFBVTtBQUFBLE1BQ2hCLE1BQU0sVUFBVTtBQUFBLE1BQ2hCLGdCQUFlQyxNQUFBLCtCQUFPLGNBQVAsT0FBQUEsTUFBb0I7QUFBQSxNQUNuQyxNQUFNLFVBQVU7QUFBQSxNQUNoQixNQUFNLFVBQVU7QUFBQSxJQUNsQixDQUFDO0FBQUEsRUFDSDtBQU9BLFdBQVMscUJBQ1AsTUFDQSxPQUNBLFFBQ0EsT0FDTTtBQW5jVixRQUFBSCxLQUFBQyxLQUFBQyxLQUFBQyxLQUFBQztBQW9jSSxVQUFNLGFBQWEsVUFBVSwrQkFBTyxPQUFPLFlBQVk7QUFDdkQsVUFBTSxhQUFhLGNBQWMsT0FBTyxPQUFPLFVBQVUsSUFBSTtBQUM3RCxVQUFNLFVBQVUsY0FBYyxNQUFNO0FBQ3BDLFVBQU0sU0FDSixNQUFNLFNBQVMsWUFBWSxPQUFPLFVBQzlCLG1CQUNBLFVBQVUsU0FDUixlQUNBO0FBRVIsUUFBSSxNQUFNLFNBQVMsWUFBWSxPQUFPLFNBQVM7QUFFN0MsWUFBTSxLQUFLLFNBQVMsVUFBVSxNQUFNLE1BQU0sQ0FBQztBQUMzQztBQUFBLElBQ0Y7QUFFQSxRQUFJLE1BQU0sU0FBUyxVQUFVO0FBRTNCLFVBQUksWUFBWTtBQUNkLGNBQU0sS0FBSyxTQUFTLFFBQVEsTUFBTSxNQUFNLENBQUM7QUFDekMsa0JBQVUsS0FBSztBQUFBLFVBQ2I7QUFBQSxVQUFNO0FBQUEsVUFBUSxRQUFRO0FBQUEsVUFBVSxjQUFjO0FBQUEsVUFDOUMsUUFBUTtBQUFBLFVBQVM7QUFBQSxRQUNuQixDQUFDO0FBQUEsTUFDSCxPQUFPO0FBQ0wsZUFBTyxLQUFLO0FBQUEsVUFDVixNQUFNO0FBQUEsVUFDTjtBQUFBLFVBQ0EsZ0JBQWVKLE1BQUEsK0JBQU8sY0FBUCxPQUFBQSxNQUFvQjtBQUFBLFVBQ25DLE9BQU1DLE1BQUEsK0JBQU8sU0FBUCxPQUFBQSxNQUFlLE1BQU07QUFBQSxVQUMzQixPQUFNQyxNQUFBLCtCQUFPLFNBQVAsT0FBQUEsTUFBZSxNQUFNO0FBQUEsUUFDN0IsQ0FBQztBQUNELGtCQUFVLEtBQUs7QUFBQSxVQUNiO0FBQUEsVUFBTTtBQUFBLFVBQVEsUUFBUTtBQUFBLFVBQVMsY0FBYztBQUFBLFVBQzdDLFFBQVE7QUFBQSxVQUFTO0FBQUEsUUFDbkIsQ0FBQztBQUFBLE1BQ0g7QUFDQTtBQUFBLElBQ0Y7QUFFQSxRQUFJLE9BQU8sU0FBUztBQUVsQixVQUFJLFlBQVk7QUFDZCxjQUFNLEtBQUssU0FBUyxVQUFVLE1BQU0sTUFBTSxDQUFDO0FBQzNDLGtCQUFVLEtBQUs7QUFBQSxVQUNiO0FBQUEsVUFBTTtBQUFBLFVBQVEsUUFBUTtBQUFBLFVBQVUsY0FBYztBQUFBLFVBQzlDLGtCQUFrQixpQkFBaUIsTUFBTSxPQUFPLE1BQU07QUFBQSxVQUN0RCxRQUFRO0FBQUEsVUFBUztBQUFBLFFBQ25CLENBQUM7QUFBQSxNQUNILE9BQU87QUFDTCxlQUFPLEtBQUs7QUFBQSxVQUNWLE1BQU0sTUFBTTtBQUFBLFVBQ1o7QUFBQSxVQUNBLGdCQUFlQyxNQUFBLCtCQUFPLGNBQVAsT0FBQUEsTUFBb0I7QUFBQSxVQUNuQyxNQUFNLE1BQU07QUFBQSxVQUNaLE1BQU0sTUFBTTtBQUFBLFFBQ2QsQ0FBQztBQUNELGtCQUFVLEtBQUs7QUFBQSxVQUNiO0FBQUEsVUFBTTtBQUFBLFVBQVEsUUFBUTtBQUFBLFVBQVMsY0FBYztBQUFBLFVBQzdDLFFBQVE7QUFBQSxVQUFTO0FBQUEsUUFDbkIsQ0FBQztBQUFBLE1BQ0g7QUFDQTtBQUFBLElBQ0Y7QUFHQSxRQUFJLFlBQVk7QUFDZCxZQUFNO0FBQUEsUUFDSixVQUFTLCtCQUFPLGVBQWMsU0FBWSxZQUFZLFVBQVUsU0FBWSxRQUFRLFFBQVEsTUFBTSxNQUFNO0FBQUEsTUFDMUc7QUFDQSxnQkFBVSxLQUFLO0FBQUEsUUFDYjtBQUFBLFFBQU07QUFBQSxRQUFRLFFBQVE7QUFBQSxRQUFVLGNBQWM7QUFBQSxRQUM5QyxrQkFBa0IsaUJBQWlCLE1BQU0sT0FBTyxNQUFNO0FBQUEsUUFDdEQsUUFBUTtBQUFBLFFBQVM7QUFBQSxNQUNuQixDQUFDO0FBQUEsSUFDSCxPQUFPO0FBQ0wsYUFBTyxLQUFLO0FBQUEsUUFDVixNQUFNLE1BQU07QUFBQSxRQUNaO0FBQUE7QUFBQTtBQUFBLFFBR0EsZ0JBQWVDLE1BQUEsK0JBQU8sY0FBUCxPQUFBQSxNQUFvQjtBQUFBLFFBQ25DLE1BQU0sTUFBTTtBQUFBLFFBQ1osTUFBTSxNQUFNO0FBQUEsTUFDZCxDQUFDO0FBQ0QsZ0JBQVUsS0FBSztBQUFBLFFBQ2I7QUFBQSxRQUFNO0FBQUEsUUFBUSxRQUFRO0FBQUEsUUFBUyxjQUFjO0FBQUEsUUFDN0MsUUFBUTtBQUFBLFFBQVM7QUFBQSxNQUNuQixDQUFDO0FBQUEsSUFDSDtBQUFBLEVBQ0Y7QUFRQSxXQUFTLGlCQUFpQixNQUFjLE9BQXVCLFFBQXdDO0FBQ3JHLFFBQUksTUFBTSxTQUFTLE9BQU8sS0FBTSxRQUFPO0FBQ3ZDLFVBQU0sV0FBVyxpQkFBaUIsTUFBTSxnQkFBZ0IsS0FBSyxVQUFVO0FBQ3ZFLFdBQU8sS0FBSztBQUFBLE1BQ1YsTUFBTTtBQUFBLE1BQ04sTUFBTTtBQUFBO0FBQUEsTUFFTixlQUFlLE9BQU87QUFBQSxNQUN0QixNQUFNLE1BQU07QUFBQSxNQUNaLE1BQU0sTUFBTTtBQUFBLElBQ2QsQ0FBQztBQUNELFdBQU87QUFBQSxFQUNUO0FBQ0Y7QUFJQSxTQUFTLFNBQ1AsTUFDQSxNQUNBLFFBR1k7QUE3akJkO0FBOGpCRSxTQUFPO0FBQUEsSUFDTDtBQUFBLElBQ0E7QUFBQSxJQUNBLE1BQU0sT0FBTztBQUFBLElBQ2IsTUFBTSxPQUFPO0FBQUEsSUFDYixTQUFTLE9BQU87QUFBQSxJQUNoQixPQUFPLE9BQU87QUFBQSxJQUNkLFVBQVMsWUFBTyxZQUFQLFlBQWtCLFNBQVM7QUFBQSxJQUNwQyxHQUFJLE9BQU8sV0FBVyxFQUFFLFVBQVUsS0FBSyxJQUFJLENBQUM7QUFBQSxFQUM5QztBQUNGO0FBRUEsU0FBUyxjQUFjLFFBQTBDO0FBQy9ELFNBQU87QUFBQSxJQUNMLFNBQVMsT0FBTztBQUFBLElBQ2hCLE1BQU0sT0FBTztBQUFBLElBQ2IsTUFBTSxPQUFPO0FBQUEsSUFDYixTQUFTLE9BQU87QUFBQSxJQUNoQixPQUFPLE9BQU87QUFBQSxFQUNoQjtBQUNGO0FBUUEsU0FBUyxtQkFDUCxPQUNBLFFBQ1M7QUFDVCxNQUFJLFdBQVcsT0FBVyxRQUFPO0FBQ2pDLE1BQUksVUFBVSxPQUFXLFFBQU8sQ0FBQyxPQUFPO0FBQ3hDLFNBQU8sT0FBTyxZQUFZLE1BQU07QUFDbEM7QUFFQSxTQUFTLE9BQU8sSUFBNkI7QUFDM0MsU0FBTyxHQUFHLFNBQVMsV0FBVyxHQUFHLFNBQVMsR0FBRztBQUMvQztBQUVBLFNBQVMsZUFBZSxHQUFXLEdBQW1CO0FBQ3BELFNBQU8sSUFBSSxJQUFJLEtBQUssSUFBSSxJQUFJLElBQUk7QUFDbEM7OztBQzVlQSxlQUFzQixVQUNwQixTQUNBLE9BQ0EsVUFDQSxLQUNBLFVBQTRCLENBQUMsR0FDTjtBQW5JekI7QUFvSUUsUUFBTSxVQUFTLGFBQVEsU0FBUixZQUFnQjtBQUMvQixRQUFNLFFBQU8sYUFBUSxTQUFSLFlBQWdCO0FBRTdCLFFBQU0sUUFBUSxNQUFNLFFBQVEsVUFBVTtBQUV0QyxRQUFNLE9BQW1CLENBQUM7QUFDMUIsYUFBVyxRQUFRLE9BQU87QUFDeEIsUUFBSSxDQUFDLFVBQVUsS0FBSyxNQUFNLFFBQVEsRUFBRyxNQUFLLEtBQUssSUFBSTtBQUFBLEVBQ3JEO0FBQ0EsUUFBTSxZQUFZLElBQUksSUFBSSxLQUFLLElBQUksQ0FBQyxNQUFNLEVBQUUsSUFBSSxDQUFDO0FBRWpELFFBQU0sUUFBeUIsQ0FBQztBQUNoQyxRQUFNLFdBQTRCLENBQUM7QUFDbkMsUUFBTSxTQUF1QixDQUFDO0FBRTlCLGFBQVcsUUFBUSxNQUFNO0FBQ3ZCLFVBQU0sUUFBUSxNQUFNLEtBQUssSUFBSTtBQUM3QixRQUFJLFNBQVMsVUFBVSxpQkFBaUIsT0FBTyxJQUFJLEdBQUc7QUFDcEQ7QUFBQSxJQUNGO0FBQ0EsVUFBTSxPQUFPLE1BQU0sT0FBTyxNQUFNLFFBQVEsU0FBUyxLQUFLLElBQUksQ0FBQztBQUMzRCxXQUFPLEtBQUssRUFBRSxNQUFNLEtBQUssTUFBTSxNQUFNLE1BQU0sS0FBSyxNQUFNLE9BQU8sS0FBSyxNQUFNLENBQUM7QUFDekUsUUFBSSxVQUFVLFFBQVc7QUFDdkIsWUFBTSxLQUFLLEVBQUUsTUFBTSxLQUFLLE1BQU0sTUFBTSxNQUFNLEtBQUssS0FBSyxDQUFDO0FBQ3JEO0FBQUEsSUFDRjtBQUNBLFFBQUksTUFBTSxVQUFVO0FBRWxCLGVBQVMsS0FBSyxFQUFFLE1BQU0sS0FBSyxNQUFNLE1BQU0sTUFBTSxLQUFLLEtBQUssQ0FBQztBQUN4RDtBQUFBLElBQ0Y7QUFHQSxRQUFJLE1BQU0sY0FBYyxVQUFhLE1BQU0sU0FBUyxNQUFNO0FBQ3hELGVBQVMsS0FBSyxFQUFFLE1BQU0sS0FBSyxNQUFNLE1BQU0sTUFBTSxLQUFLLEtBQUssQ0FBQztBQUFBLElBQzFEO0FBQUEsRUFDRjtBQUVBLFFBQU0sVUFBOEIsQ0FBQztBQUNyQyxhQUFXLENBQUMsTUFBTSxLQUFLLEtBQUssT0FBTyxRQUFRLEtBQUssR0FBRztBQUNqRCxRQUFJLE1BQU0sU0FBVTtBQUNwQixRQUFJLE1BQU0sY0FBYyxPQUFXO0FBQ25DLFFBQUksVUFBVSxJQUFJLElBQUksRUFBRztBQUN6QixRQUFJLFVBQVUsTUFBTSxRQUFRLEdBQUc7QUFFN0I7QUFBQSxJQUNGO0FBQ0EsWUFBUSxLQUFLLEVBQUUsTUFBTSxNQUFNLE1BQU0sTUFBTSxNQUFNLE1BQU0sTUFBTSxXQUFXLE1BQU0sVUFBVSxDQUFDO0FBQUEsRUFDdkY7QUFFQSxRQUFNLEVBQUUsU0FBUyxTQUFTLGtCQUFrQixPQUFPLGVBQWUsSUFBSSxjQUFjLFNBQVMsS0FBSztBQUNsRyxRQUFNLGVBQWUsTUFBTSxtQkFBbUIsU0FBUyxPQUFPLFVBQVUsS0FBSztBQUU3RSxTQUFPO0FBQUEsSUFDTCxXQUFXO0FBQUEsSUFDWCxPQUFPLGVBQWUsY0FBYztBQUFBLElBQ3BDLFVBQVUsZUFBZSxRQUFRO0FBQUEsSUFDakMsU0FBUyxDQUFDLEdBQUcsZ0JBQWdCLEVBQUUsS0FBSyxNQUFNO0FBQUEsSUFDMUMsU0FBUyxDQUFDLEdBQUcsT0FBTyxFQUFFLEtBQUssQ0FBQyxHQUFHLE1BQU0sT0FBTyxHQUFHLENBQUMsQ0FBQztBQUFBLElBQ2pEO0FBQUEsSUFDQSxRQUFRLENBQUMsR0FBRyxNQUFNLEVBQUUsS0FBSyxNQUFNO0FBQUEsRUFDakM7QUFDRjtBQVFBLFNBQVMsaUJBQWlCLE9BQW9DLE1BQXlCO0FBQ3JGLFNBQ0UsVUFBVSxVQUNWLE1BQU0sY0FBYyxVQUNwQixNQUFNLGFBQWEsUUFDbkIsTUFBTSxVQUFVLFVBQ2hCLE1BQU0sVUFBVSxLQUFLLFNBQ3JCLE1BQU0sU0FBUyxLQUFLO0FBRXhCO0FBYU8sU0FBUyxrQkFDZCxPQUNBLFFBQ1k7QUFDWixNQUFJO0FBQ0osYUFBVyxZQUFZLFFBQVE7QUFDN0IsVUFBTSxRQUFRLE1BQU0sU0FBUyxJQUFJO0FBQ2pDLFFBQUksVUFBVSxVQUFhLE1BQU0sWUFBWSxNQUFNLGNBQWMsT0FBVztBQUM1RSxRQUFJLE1BQU0sU0FBUyxTQUFTLEtBQU07QUFDbEMsUUFBSSxNQUFNLFVBQVUsU0FBUyxNQUFPO0FBQ3BDLGlDQUFTLEVBQUUsR0FBRyxNQUFNO0FBQ3BCLFNBQUssU0FBUyxJQUFJLElBQUksRUFBRSxHQUFHLE9BQU8sT0FBTyxTQUFTLE1BQU07QUFBQSxFQUMxRDtBQUNBLFNBQU8sc0JBQVE7QUFDakI7QUFVQSxTQUFTLGNBQ1AsU0FDQSxPQUtBO0FBL1BGO0FBZ1FFLFFBQU0sYUFBYSxvQkFBSSxJQUE2QjtBQUNwRCxhQUFXLGFBQWEsQ0FBQyxHQUFHLEtBQUssRUFBRSxLQUFLLE1BQU0sR0FBRztBQUMvQyxVQUFNLFNBQVMsV0FBVyxJQUFJLFVBQVUsSUFBSTtBQUM1QyxRQUFJLE9BQVEsUUFBTyxLQUFLLFNBQVM7QUFBQSxRQUM1QixZQUFXLElBQUksVUFBVSxNQUFNLENBQUMsU0FBUyxDQUFDO0FBQUEsRUFDakQ7QUFFQSxRQUFNLFdBQVcsb0JBQUksSUFBWTtBQUNqQyxRQUFNLFVBQTZCLENBQUM7QUFDcEMsUUFBTSxtQkFBdUMsQ0FBQztBQUU5QyxhQUFXLFlBQVksQ0FBQyxHQUFHLE9BQU8sRUFBRSxLQUFLLE1BQU0sR0FBRztBQUNoRCxVQUFNLGNBQWEsZ0JBQVcsSUFBSSxTQUFTLElBQUksTUFBNUIsWUFBaUMsQ0FBQztBQUNyRCxRQUFJO0FBQ0osUUFBSTtBQUNKLGVBQVcsYUFBYSxZQUFZO0FBQ2xDLFVBQUksU0FBUyxJQUFJLFVBQVUsSUFBSSxFQUFHO0FBQ2xDLFVBQUksV0FBVyxVQUFVLElBQUksTUFBTSxXQUFXLFNBQVMsSUFBSSxHQUFHO0FBQzVELDhDQUFZO0FBQUEsTUFDZCxPQUFPO0FBQ0wsaURBQWE7QUFBQSxNQUNmO0FBQUEsSUFDRjtBQUNBLFVBQU0sUUFBUSw0QkFBVztBQUN6QixRQUFJLE9BQU87QUFDVCxlQUFTLElBQUksTUFBTSxJQUFJO0FBQ3ZCLGNBQVEsS0FBSyxFQUFFLE1BQU0sU0FBUyxNQUFNLElBQUksTUFBTSxNQUFNLE1BQU0sU0FBUyxNQUFNLE1BQU0sU0FBUyxLQUFLLENBQUM7QUFBQSxJQUNoRyxPQUFPO0FBQ0wsdUJBQWlCLEtBQUssUUFBUTtBQUFBLElBQ2hDO0FBQUEsRUFDRjtBQUVBLFNBQU87QUFBQSxJQUNMO0FBQUEsSUFDQSxTQUFTO0FBQUEsSUFDVCxPQUFPLE1BQU0sT0FBTyxDQUFDLGNBQWMsQ0FBQyxTQUFTLElBQUksVUFBVSxJQUFJLENBQUM7QUFBQSxFQUNsRTtBQUNGO0FBUUEsZUFBZSxtQkFDYixTQUNBLE9BQ0EsVUFDQSxPQUNtQjtBQUNuQixRQUFNLGtCQUFrQixvQkFBSSxJQUFZO0FBQ3hDLGFBQVcsUUFBUSxPQUFPO0FBQ3hCLGFBQVMsTUFBTSxXQUFXLEtBQUssSUFBSSxHQUFHLFFBQVEsS0FBSyxNQUFNLFdBQVcsR0FBRyxHQUFHO0FBQ3hFLHNCQUFnQixJQUFJLEdBQUc7QUFBQSxJQUN6QjtBQUFBLEVBQ0Y7QUFFQSxRQUFNLGVBQXlCLENBQUM7QUFDaEMsYUFBVyxPQUFPLE1BQU0sUUFBUSxTQUFTLEdBQUc7QUFDMUMsUUFBSSxRQUFRLElBQUs7QUFDakIsUUFBSSxnQkFBZ0IsSUFBSSxHQUFHLEVBQUc7QUFDOUIsUUFBSSxVQUFVLEtBQUssUUFBUSxFQUFHO0FBQzlCLFVBQU0sUUFBUSxNQUFNLEdBQUc7QUFDdkIsU0FBSSwrQkFBTyxhQUFZLE1BQU0sY0FBYyxPQUFXO0FBQ3RELGlCQUFhLEtBQUssR0FBRztBQUFBLEVBQ3ZCO0FBQ0EsU0FBTyxhQUFhLEtBQUs7QUFDM0I7QUFFQSxTQUFTLGVBQWUsWUFBOEM7QUFDcEUsU0FBTyxDQUFDLEdBQUcsVUFBVSxFQUFFLEtBQUssTUFBTTtBQUNwQztBQUVBLFNBQVMsT0FBbUQsR0FBTSxHQUFjO0FBMVVoRjtBQTJVRSxRQUFNLFFBQU8sYUFBRSxTQUFGLFlBQVUsRUFBRSxTQUFaLFlBQW9CO0FBQ2pDLFFBQU0sUUFBTyxhQUFFLFNBQUYsWUFBVSxFQUFFLFNBQVosWUFBb0I7QUFDakMsU0FBTyxPQUFPLE9BQU8sS0FBSyxPQUFPLE9BQU8sSUFBSTtBQUM5Qzs7O0FDcE9BLElBQU0sYUFBeUI7QUFBQSxFQUM3QixPQUFPLE1BQU07QUFBQSxFQUFDO0FBQUEsRUFDZCxNQUFNLE1BQU07QUFBQSxFQUFDO0FBQUEsRUFDYixNQUFNLE1BQU07QUFBQSxFQUFDO0FBQUEsRUFDYixPQUFPLE1BQU07QUFBQSxFQUFDO0FBQ2hCO0FBRUEsSUFBTSxrQkFBa0IsQ0FBQyxJQUFnQixPQUE2QjtBQUNwRSxRQUFNLFNBQVMsV0FBVyxXQUFXLElBQUksRUFBRTtBQUMzQyxTQUFPLE1BQU0sV0FBVyxhQUFhLE1BQU07QUFDN0M7QUEwQk8sSUFBTSxhQUFOLE1BQWlCO0FBQUEsRUFnQ3RCLFlBQVksU0FBNEI7QUEvQnhDLHdCQUFpQjtBQUNqQix3QkFBaUI7QUFDakIsd0JBQWlCO0FBQ2pCLHdCQUFpQjtBQUNqQix3QkFBaUI7QUFDakIsd0JBQWlCO0FBRWpCLHdCQUFRLGFBQThCO0FBQ3RDLHdCQUFRLFNBQXlCO0FBQ2pDLHdCQUFRLFNBQW9CLENBQUM7QUFDN0Isd0JBQVEsVUFBUztBQUNqQix3QkFBUSxjQUE0QjtBQUNwQyx3QkFBUSxXQUFVO0FBQ2xCLHdCQUFRLGFBQTBCLENBQUM7QUFDbkMsd0JBQVE7QUFDUix3QkFBUSxnQkFBb0M7QUFDNUMsd0JBQVEsa0JBQXNDO0FBRzlDO0FBQUEsd0JBQVEsUUFBeUIsUUFBUSxRQUFRO0FBQ2pELHdCQUFRLGFBQVk7QUFFcEI7QUFBQSx3QkFBUSxhQUFZO0FBQ3BCLHdCQUFRLFlBQXNCLENBQUM7QUFFL0I7QUFBQSx3QkFBUSxlQUlHO0FBc0pYO0FBQUEsd0JBQVEsc0JBQXFCLENBQUMsWUFBMkI7QUFDdkQsWUFBTSxjQUFjLEtBQUs7QUFDekIsVUFBSSxnQkFBZ0IsUUFBUSxZQUFZLFFBQVEsT0FBTyxHQUFHO0FBQ3hELGFBQUssY0FBYztBQUNuQixvQkFBWSxRQUFRLE9BQU87QUFDM0I7QUFBQSxNQUNGO0FBQ0EsVUFBSSxLQUFLLFdBQVc7QUFDbEIsYUFBSyxTQUFTLEtBQUssT0FBTztBQUMxQjtBQUFBLE1BQ0Y7QUFDQSxXQUFLLFFBQVEsWUFBWTtBQUN2QixjQUFNLEtBQUssU0FBUyxPQUFPO0FBQUEsTUFDN0IsQ0FBQyxFQUFFLE1BQU0sQ0FBQyxVQUFtQixLQUFLLElBQUksS0FBSyx5QkFBeUIsS0FBSyxDQUFDO0FBQUEsSUFDNUU7QUFzY0Esd0JBQWlCLGFBQXVCLE9BQU8sU0FBc0M7QUFDbkYsVUFBSSxTQUFTLEdBQUksT0FBTSxJQUFJLGNBQWMsNkNBQTZDO0FBQ3RGLFlBQU0sU0FBUyxNQUFNLEtBQUssUUFBUSxVQUFVLElBQUksSUFBSTtBQUNwRCxVQUFJLFdBQVcsT0FBVyxRQUFPO0FBQ2pDLFlBQU0sUUFBUSxNQUFNLEtBQUssYUFBYSxJQUFJO0FBQzFDLFlBQU0sS0FBSyxRQUFRLFVBQVUsSUFBSSxNQUFNLEtBQUs7QUFDNUMsYUFBTztBQUFBLElBQ1Q7QUE3eEJGO0FBK0tJLFNBQUssVUFBVTtBQUNmLFNBQUssT0FBTSxhQUFRLFFBQVIsWUFBZTtBQUMxQixTQUFLLE9BQU0sYUFBUSxRQUFSLGFBQWdCLE1BQU0sS0FBSyxJQUFJO0FBQzFDLFNBQUssY0FBYSxhQUFRLGVBQVIsWUFBc0I7QUFDeEMsU0FBSyxZQUFXLGFBQVEsYUFBUixZQUFvQjtBQUNwQyxTQUFLLGdCQUNILE9BQU8sUUFBUSxjQUFjLGFBQ3pCLFFBQVEsWUFDUixNQUFNLFFBQVE7QUFDcEIsU0FBSyxrQkFBaUIsYUFBUSxhQUFSLFlBQW9CLEVBQUUsY0FBYyxNQUFNO0FBQUEsRUFDbEU7QUFBQTtBQUFBO0FBQUEsRUFLQSxNQUFNLFVBQXlCO0FBQzdCLFVBQU0sS0FBSyxRQUFRLE1BQU0sS0FBSyxRQUFRLENBQUM7QUFBQSxFQUN6QztBQUFBO0FBQUEsRUFHQSxNQUFNLFlBQTJCO0FBQy9CLFVBQU0sS0FBSyxRQUFRLFlBQVk7QUFwTW5DO0FBcU1NLGlCQUFLLGNBQUwsbUJBQWdCO0FBQ2hCLFdBQUssWUFBWTtBQUNqQixZQUFNLEtBQUssUUFBUTtBQUFBLElBQ3JCLENBQUM7QUFBQSxFQUNIO0FBQUEsRUFFQSxRQUFjO0FBM01oQjtBQTRNSSxTQUFLLGFBQWE7QUFDbEIsZUFBSyxtQkFBTDtBQUNBLFNBQUssaUJBQWlCO0FBQ3RCLGVBQUssY0FBTCxtQkFBZ0I7QUFDaEIsU0FBSyxZQUFZO0FBQ2pCLFNBQUssUUFBUTtBQUFBLEVBQ2Y7QUFBQTtBQUFBLEVBR0EsY0FBYyxjQUFrQztBQUM5QyxTQUFLLGFBQWE7QUFDbEIsU0FBSyxlQUFlO0FBQ3BCLGlCQUFhLE1BQU0sQ0FBQyxXQUFXLEtBQUssY0FBYyxNQUFNLENBQUM7QUFBQSxFQUMzRDtBQUFBLEVBRUEsZUFBcUI7QUEzTnZCO0FBNE5JLGVBQUssaUJBQUwsbUJBQW1CO0FBQ25CLFNBQUssZUFBZTtBQUFBLEVBQ3RCO0FBQUE7QUFBQSxFQUdBLE1BQU0sY0FBNkI7QUFDakMsVUFBTSxLQUFLLFFBQVEsTUFBTSxLQUFLLFNBQVMsQ0FBQztBQUFBLEVBQzFDO0FBQUE7QUFBQSxFQUdBLE1BQU0sV0FBMEI7QUFDOUIsV0FBTyxLQUFLLFlBQVksRUFBRyxPQUFNLEtBQUs7QUFDdEMsVUFBTSxLQUFLO0FBQUEsRUFDYjtBQUFBLEVBRUEsU0FBMkI7QUFDekIsV0FBTztBQUFBLE1BQ0wsT0FBTyxLQUFLO0FBQUEsTUFDWixZQUFZLEtBQUs7QUFBQSxNQUNqQixTQUFTLEtBQUs7QUFBQSxNQUNkLFdBQVcsQ0FBQyxHQUFHLEtBQUssU0FBUztBQUFBLElBQy9CO0FBQUEsRUFDRjtBQUFBO0FBQUEsRUFHQSxlQUEyQjtBQUN6QixXQUFPLEVBQUUsR0FBRyxLQUFLLE1BQU07QUFBQSxFQUN6QjtBQUFBO0FBQUEsRUFHQSxJQUFJLGNBQXNCO0FBQ3hCLFdBQU8sS0FBSztBQUFBLEVBQ2Q7QUFBQTtBQUFBLEVBR1EsaUJBQTBCO0FBQ2hDLFdBQU8sS0FBSyxVQUFVO0FBQUEsRUFDeEI7QUFBQTtBQUFBLEVBSUEsTUFBYyxVQUF5QjtBQUNyQyxTQUFLLFFBQVE7QUFDYixTQUFLLFlBQVk7QUFDakIsU0FBSyxXQUFXLENBQUM7QUFFakIsU0FBSyxRQUFTLE1BQU0sS0FBSyxrQkFBa0Isc0JBQXNCLElBQzdELE1BQU0sZUFBZSxLQUFLLFFBQVEsT0FBTyxJQUN6QyxDQUFDO0FBRUwsVUFBTSxZQUFZLEtBQUssY0FBYztBQUNyQyxTQUFLLFlBQVk7QUFDakIsY0FBVSxVQUFVLENBQUMsWUFBWSxLQUFLLG1CQUFtQixPQUFPLENBQUM7QUFDakUsY0FBVSxRQUFRLENBQUMsV0FBVyxLQUFLLGlCQUFpQixNQUFNLENBQUM7QUFFM0QsVUFBTSxXQUFXLE1BQU0sS0FBSztBQUFBLE1BQzFCLENBQUMsTUFBTSxFQUFFLFNBQVMsY0FBYyxFQUFFLFNBQVM7QUFBQSxNQUMzQyxNQUNFLFVBQVUsS0FBSztBQUFBLFFBQ2IsTUFBTTtBQUFBLFFBQ04sT0FBTyxLQUFLLFFBQVE7QUFBQSxRQUNwQixpQkFBaUI7QUFBQSxRQUNqQixRQUFRLEtBQUs7QUFBQSxNQUNmLENBQUM7QUFBQSxJQUNMO0FBQ0EsUUFBSSxTQUFTLFNBQVMsUUFBUyxPQUFNLEtBQUssUUFBUSxRQUFRO0FBQzFELFNBQUssaUJBQWlCLEVBQUUsY0FBYyxTQUFTLFNBQVMsYUFBYTtBQUVyRSxTQUFLLFFBQVE7QUFDYixVQUFNLEtBQUssU0FBUztBQUVwQixTQUFLLFlBQVk7QUFDakIsVUFBTSxXQUFXLEtBQUs7QUFDdEIsU0FBSyxXQUFXLENBQUM7QUFDakIsZUFBVyxXQUFXLFVBQVU7QUFDOUIsWUFBTSxLQUFLLFNBQVMsT0FBTztBQUFBLElBQzdCO0FBQ0EsUUFBSSxDQUFDLEtBQUssZUFBZSxFQUFHLE1BQUssUUFBUTtBQUFBLEVBQzNDO0FBQUEsRUFFQSxNQUFjLGtCQUFrQixNQUFnQztBQUM5RCxRQUFJO0FBQ0YsYUFBTyxNQUFNLEtBQUssUUFBUSxRQUFRLE9BQU8sSUFBSTtBQUFBLElBQy9DLFNBQVE7QUFDTixhQUFPO0FBQUEsSUFDVDtBQUFBLEVBQ0Y7QUFBQSxFQUVRLGlCQUFpQixRQUFrRDtBQXBUN0U7QUFxVEksU0FBSyxJQUFJLEtBQUssb0JBQW9CLE1BQU07QUFDeEMsU0FBSyxRQUFRO0FBQ2IsVUFBTSxjQUFjLEtBQUs7QUFDekIsUUFBSSxnQkFBZ0IsTUFBTTtBQUN4QixXQUFLLGNBQWM7QUFDbkIsa0JBQVk7QUFBQSxRQUNWLElBQUksYUFBYSx1QkFBc0Isa0JBQU8sV0FBUCxZQUFpQixPQUFPLFNBQXhCLFlBQWdDLFNBQVMsRUFBRTtBQUFBLE1BQ3BGO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFBQSxFQW9CQSxNQUFjLFNBQVMsU0FBaUM7QUFDdEQsWUFBUSxRQUFRLE1BQU07QUFBQSxNQUNwQixLQUFLO0FBQ0gsY0FBTSxLQUFLLGFBQWEsT0FBTztBQUMvQjtBQUFBLE1BQ0YsS0FBSztBQUNIO0FBQUE7QUFBQSxNQUNGLEtBQUs7QUFDSDtBQUFBLE1BQ0YsS0FBSztBQUNILGFBQUssSUFBSSxNQUFNLGdCQUFnQixRQUFRLE1BQU0sUUFBUSxPQUFPO0FBQzVEO0FBQUEsTUFDRixLQUFLO0FBQUEsTUFDTCxLQUFLO0FBQUEsTUFDTCxLQUFLO0FBQUEsTUFDTCxLQUFLO0FBQUEsTUFDTCxLQUFLO0FBQUEsTUFDTCxLQUFLO0FBR0gsYUFBSyxJQUFJLEtBQUssMkJBQTJCLFFBQVEsSUFBSTtBQUNyRDtBQUFBLE1BQ0Y7QUFDRSxhQUFLLElBQUksS0FBSyxpREFBaUQsT0FBTztBQUFBLElBQzFFO0FBQUEsRUFDRjtBQUFBLEVBRUEsTUFBYyxhQUFhLFFBQXNDO0FBQy9ELFFBQUksT0FBTyxNQUFNLEtBQUssT0FBUSxNQUFLLFNBQVMsT0FBTztBQUNuRCxRQUFJLFVBQVUsT0FBTyxNQUFNLEtBQUssY0FBYyxFQUFHO0FBQ2pELFFBQUksT0FBTyxhQUFhLFVBQWEsVUFBVSxPQUFPLFVBQVUsS0FBSyxjQUFjLEVBQUc7QUFJdEYsVUFBTSxRQUFRLEtBQUssTUFBTSxPQUFPLElBQUk7QUFDcEMsUUFBSSxVQUFVLFFBQVc7QUFDdkIsVUFBSSxNQUFNLGNBQWMsT0FBTyxRQUFTO0FBQ3hDLFVBQUksY0FBYyxNQUFNLE9BQU8sT0FBTyxLQUFLLEtBQUssRUFBRztBQUFBLElBQ3JEO0FBR0EsUUFBSSxDQUFFLE1BQU0sS0FBSyxhQUFhLE1BQU0sR0FBSTtBQUN0QyxXQUFLLElBQUksS0FBSyxpREFBaUQsT0FBTyxJQUFJO0FBQzFFLFdBQUssa0JBQWtCO0FBQ3ZCO0FBQUEsSUFDRjtBQUVBLFNBQUssUUFBUSxNQUFNLEtBQUssV0FBVyxDQUFDLEtBQUssaUJBQWlCLE1BQU0sQ0FBQyxDQUFDO0FBQUEsRUFDcEU7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsRUFPQSxNQUFjLGFBQWEsUUFBeUM7QUFDbEUsUUFBSSxPQUFPLGFBQWEsS0FBTSxRQUFPO0FBQ3JDLFFBQUksT0FBTyxTQUFTLFlBQVksT0FBTyxhQUFhLFFBQVc7QUFDN0QsVUFBSSxNQUFNLEtBQUssdUJBQXVCLE9BQU8sUUFBUSxFQUFHLFFBQU87QUFDL0QsVUFBSSxNQUFNLEtBQUssY0FBYyxPQUFPLElBQUksR0FBRztBQUN6QyxjQUFNLFFBQVEsS0FBSyxNQUFNLE9BQU8sSUFBSTtBQUNwQyxZQUFJLFVBQVUsVUFBYSxNQUFNLGNBQWMsT0FBVyxRQUFPO0FBQ2pFLGNBQU0sU0FBUyxNQUFNLFVBQVUsTUFBTSxLQUFLLFFBQVEsUUFBUSxTQUFTLE9BQU8sSUFBSSxDQUFDO0FBQy9FLFlBQUksV0FBVyxNQUFNLEtBQU0sUUFBTztBQUFBLE1BQ3BDO0FBQ0EsYUFBTztBQUFBLElBQ1Q7QUFDQSxXQUFPLENBQUUsTUFBTSxLQUFLLHVCQUF1QixPQUFPLElBQUk7QUFBQSxFQUN4RDtBQUFBLEVBRUEsTUFBYyx1QkFBdUIsTUFBZ0M7QUFDbkUsVUFBTSxRQUFRLEtBQUssTUFBTSxJQUFJO0FBQzdCLFFBQUksK0JBQU8sU0FBVSxRQUFPO0FBQzVCLFFBQUksQ0FBRSxNQUFNLEtBQUssY0FBYyxJQUFJLEVBQUksUUFBTztBQUM5QyxRQUFJLFVBQVUsVUFBYSxNQUFNLGNBQWMsT0FBVyxRQUFPO0FBQ2pFLFVBQU0sU0FBUyxNQUFNLFVBQVUsTUFBTSxLQUFLLFFBQVEsUUFBUSxTQUFTLElBQUksQ0FBQztBQUN4RSxXQUFPLFdBQVcsTUFBTTtBQUFBLEVBQzFCO0FBQUEsRUFFQSxNQUFjLGNBQWMsTUFBZ0M7QUFDMUQsUUFBSTtBQUNGLGFBQU8sTUFBTSxLQUFLLFFBQVEsUUFBUSxPQUFPLElBQUk7QUFBQSxJQUMvQyxTQUFRO0FBQ04sYUFBTztBQUFBLElBQ1Q7QUFBQSxFQUNGO0FBQUEsRUFFUSxpQkFBaUIsUUFBK0I7QUFDdEQsUUFBSSxPQUFPLFNBQVMsWUFBWSxPQUFPLGFBQWEsUUFBVztBQUM3RCxhQUFPO0FBQUEsUUFDTCxNQUFNO0FBQUEsUUFDTixVQUFVLE9BQU87QUFBQSxRQUNqQixRQUFRLE9BQU87QUFBQSxRQUNmLE1BQU0sT0FBTztBQUFBLFFBQ2IsTUFBTSxPQUFPO0FBQUEsUUFDYixTQUFTLE9BQU87QUFBQSxRQUNoQixPQUFPLE9BQU87QUFBQSxNQUNoQjtBQUFBLElBQ0Y7QUFDQSxVQUFNLFFBQVEsS0FBSyxNQUFNLE9BQU8sSUFBSTtBQUNwQyxVQUFNLE9BQTJCLE9BQU8sVUFDcEMsV0FDQSxVQUFVLFNBQ1IsUUFDQSxNQUFNLGNBQWMsU0FDbEIsWUFDQTtBQUNSLFdBQU87QUFBQSxNQUNMO0FBQUEsTUFDQSxNQUFNLE9BQU87QUFBQSxNQUNiLE1BQU0sT0FBTztBQUFBLE1BQ2IsTUFBTSxPQUFPO0FBQUEsTUFDYixTQUFTLE9BQU87QUFBQSxNQUNoQixPQUFPLE9BQU87QUFBQSxNQUNkLFNBQVMsT0FBTztBQUFBLE1BQ2hCLEdBQUksT0FBTyxhQUFhLE9BQU8sRUFBRSxVQUFVLEtBQUssSUFBSSxDQUFDO0FBQUEsSUFDdkQ7QUFBQSxFQUNGO0FBQUE7QUFBQSxFQUdBLE1BQWMsV0FBVyxPQUFtRDtBQUMxRSxXQUFPO0FBQUEsTUFDTCxLQUFLLFFBQVE7QUFBQSxNQUNiLEtBQUs7QUFBQSxNQUNMLEVBQUUsUUFBUSxDQUFDLEdBQUcsT0FBTyxDQUFDLEdBQUcsS0FBSyxHQUFHLFdBQVcsQ0FBQyxHQUFHLGNBQWMsQ0FBQyxFQUFFO0FBQUEsTUFDakUsS0FBSztBQUFBLE1BQ0wsRUFBRSxLQUFLLEtBQUssSUFBSSxFQUFFO0FBQUEsSUFDcEI7QUFBQSxFQUNGO0FBQUE7QUFBQSxFQUlRLGNBQWMsUUFBK0M7QUFDbkUsVUFBTSxXQUFXLE9BQU8sT0FBTyxDQUFDLFVBQVUsQ0FBQyxVQUFVLE1BQU0sTUFBTSxLQUFLLGNBQWMsQ0FBQztBQUNyRixRQUFJLFNBQVMsV0FBVyxFQUFHO0FBQzNCLFNBQUssV0FBVyxTQUFTO0FBQ3pCLFNBQUssa0JBQWtCO0FBQUEsRUFDekI7QUFBQTtBQUFBLEVBR1Esb0JBQTBCO0FBOWRwQztBQStkSSxlQUFLLG1CQUFMO0FBQ0EsU0FBSyxpQkFBaUIsS0FBSyxTQUFTLE1BQU07QUFDeEMsV0FBSyxpQkFBaUI7QUFDdEIsV0FBSyxRQUFRLE1BQU0sS0FBSyxTQUFTLENBQUMsRUFBRTtBQUFBLFFBQU0sQ0FBQyxVQUN6QyxLQUFLLElBQUksS0FBSywrQkFBK0IsS0FBSztBQUFBLE1BQ3BEO0FBQUEsSUFDRixHQUFHLEtBQUssVUFBVTtBQUFBLEVBQ3BCO0FBQUE7QUFBQSxFQUlBLE1BQWMsV0FBMEI7QUExZTFDO0FBMmVJLFFBQUksS0FBSyxjQUFjLFFBQVEsS0FBSyxlQUFlLEVBQUc7QUFDdEQsU0FBSyxRQUFRO0FBQ2IsUUFBSTtBQUNGLFlBQU0sV0FBVyxNQUFNLEtBQUssY0FBYztBQUMxQyxZQUFNLGVBQWUsTUFBTTtBQUFBLFFBQ3pCLEtBQUssUUFBUTtBQUFBLFFBQ2IsS0FBSztBQUFBLFFBQ0wsS0FBSztBQUFBLFFBQ0wsS0FBSyxJQUFJO0FBQUEsTUFDWDtBQUNBLFlBQU0sT0FBTyxnQkFBZ0I7QUFBQSxRQUMzQjtBQUFBLFFBQ0EsT0FBTyxLQUFLO0FBQUEsUUFDWjtBQUFBLFFBQ0EsY0FBYyxLQUFLLFFBQVE7QUFBQSxRQUMzQixnQkFBZ0IsS0FBSyxRQUFRO0FBQUEsUUFDN0IsS0FBSyxLQUFLLElBQUk7QUFBQSxNQUNoQixDQUFDO0FBQ0QsV0FBSyxZQUFZLENBQUMsR0FBRyxLQUFLLFdBQVcsR0FBRyxLQUFLLFNBQVM7QUFJdEQsWUFBTSxTQUFTLE1BQU0sS0FBSyxZQUFZLE1BQU0sYUFBYSxNQUFNO0FBRS9ELFdBQUssUUFBUSxNQUFNLEtBQUssV0FBVyxLQUFLLEtBQUs7QUFFN0MsaUJBQVcsVUFBVSxRQUFRO0FBQzNCLGNBQU0sS0FBSyxXQUFXLE1BQU07QUFBQSxNQUM5QjtBQUNBLGlCQUFXLFFBQVEsS0FBSyxjQUFjO0FBQ3BDLGNBQU0sS0FBSyxXQUFXO0FBQUEsVUFDcEIsTUFBTTtBQUFBLFVBQ047QUFBQSxVQUNBLGdCQUFlLGdCQUFLLE1BQU0sSUFBSSxNQUFmLG1CQUFrQixjQUFsQixZQUErQjtBQUFBLFVBQzlDLE1BQU07QUFBQSxVQUNOLE1BQU07QUFBQSxVQUNOLFVBQVU7QUFBQSxRQUNaLENBQUM7QUFBQSxNQUNIO0FBTUEsV0FBSyxRQUFRLGtCQUFrQixLQUFLLE9BQU8sYUFBYSxNQUFNO0FBRTlELFdBQUssYUFBYSxLQUFLLElBQUk7QUFDM0IsV0FBSyxVQUFVO0FBQ2YsVUFBSSxDQUFDLEtBQUssZUFBZSxFQUFHLE1BQUssUUFBUTtBQUFBLElBQzNDLFNBQVMsT0FBTztBQUNkLFdBQUssSUFBSSxNQUFNLHFCQUFxQixLQUFLO0FBQ3pDLFVBQUksQ0FBQyxLQUFLLGVBQWUsRUFBRyxNQUFLLFFBQVEsS0FBSyxjQUFjLE9BQU8sU0FBUztBQUM1RSxZQUFNO0FBQUEsSUFDUjtBQUFBLEVBQ0Y7QUFBQSxFQUVBLE1BQWMsZ0JBQXVDO0FBQ25ELFVBQU0sWUFBWSxLQUFLO0FBQ3ZCLFFBQUksY0FBYyxLQUFNLE9BQU0sSUFBSSxhQUFhLGVBQWU7QUFDOUQsVUFBTSxRQUFRLE1BQU0sS0FBSztBQUFBLE1BQ3ZCLENBQUMsTUFBTSxFQUFFLFNBQVMsY0FBYyxFQUFFLFNBQVM7QUFBQSxNQUMzQyxNQUFNLFVBQVUsS0FBSyxFQUFFLE1BQU0sY0FBYyxDQUFDO0FBQUEsSUFDOUM7QUFDQSxRQUFJLE1BQU0sU0FBUyxRQUFTLE9BQU0sS0FBSyxRQUFRLEtBQUs7QUFDcEQsUUFBSSxNQUFNLFNBQVMsS0FBSyxPQUFRLE1BQUssU0FBUyxNQUFNO0FBQ3BELFdBQU8sT0FBTyxPQUFPLE1BQU0sT0FBTyxFQUFFLElBQUksQ0FBQyxXQUFXLEVBQUUsR0FBRyxNQUFNLEVBQUU7QUFBQSxFQUNuRTtBQUFBLEVBRUEsTUFBYyxZQUNaLE1BQ0EsUUFDeUI7QUFsakI3QjtBQW9qQkksVUFBTSxjQUFjLG9CQUFJLElBQW9CO0FBQzVDLGVBQVcsWUFBWSxLQUFLLFdBQVc7QUFDckMsVUFBSSxTQUFTLHFCQUFxQixRQUFXO0FBQzNDLG9CQUFZLElBQUksU0FBUyxrQkFBa0IsU0FBUyxJQUFJO0FBQUEsTUFDMUQ7QUFBQSxJQUNGO0FBR0EsVUFBTSxnQkFBZ0IsSUFBSSxJQUFJLE9BQU8sSUFBSSxDQUFDLGFBQWEsQ0FBQyxTQUFTLE1BQU0sU0FBUyxLQUFLLENBQUMsQ0FBQztBQUV2RixVQUFNLFNBQXlCLENBQUM7QUFDaEMsZUFBVyxRQUFRLEtBQUssUUFBUTtBQUM5QixVQUFJLEtBQUssU0FBUyxZQUFZLEtBQUssU0FBUyxVQUFVO0FBQ3BELGVBQU8sS0FBSyxLQUFLLFNBQVMsSUFBSSxDQUFDO0FBQy9CO0FBQUEsTUFDRjtBQUNBLFlBQU0sYUFDSixLQUFLLFNBQVMsa0JBQWlCLGlCQUFZLElBQUksS0FBSyxJQUFJLE1BQXpCLFlBQThCLEtBQUssT0FBTyxLQUFLO0FBQ2hGLFlBQU0sUUFBUSxNQUFNLEtBQUssVUFBVSxVQUFVO0FBQzdDLFVBQUksVUFBVSxRQUFXO0FBQ3ZCLGFBQUssSUFBSSxLQUFLLDhDQUE4QyxLQUFLLElBQUk7QUFDckUsYUFBSyxrQkFBa0I7QUFDdkI7QUFBQSxNQUNGO0FBQ0EsWUFBTSxPQUFPLE1BQU0sVUFBVSxLQUFLO0FBQ2xDLFVBQUksU0FBUyxLQUFLLFFBQVEsTUFBTSxlQUFlLEtBQUssTUFBTTtBQUN4RCxhQUFLLElBQUksS0FBSyxvREFBb0QsS0FBSyxJQUFJO0FBQzNFLGFBQUssa0JBQWtCO0FBQ3ZCO0FBQUEsTUFDRjtBQUNBLFVBQUksS0FBSyxTQUFTLGdCQUFnQjtBQU1oQyxjQUFNLEtBQUssUUFBUSxRQUFRLFVBQVUsS0FBSyxNQUFNLEtBQUs7QUFDckQsZUFBTyxLQUFLLEVBQUUsR0FBRyxLQUFLLFNBQVMsSUFBSSxHQUFHLE1BQU0sQ0FBQztBQUM3QztBQUFBLE1BQ0Y7QUFDQSxhQUFPLEtBQUs7QUFBQSxRQUNWLEdBQUcsS0FBSyxTQUFTLElBQUk7QUFBQSxRQUNyQjtBQUFBLFFBQ0EsR0FBSSxjQUFjLElBQUksVUFBVSxNQUFNLFNBQ2xDLEVBQUUsT0FBTyxjQUFjLElBQUksVUFBVSxFQUFFLElBQ3ZDLENBQUM7QUFBQSxNQUNQLENBQUM7QUFBQSxJQUNIO0FBQ0EsV0FBTztBQUFBLEVBQ1Q7QUFBQSxFQUVRLFNBQVMsTUFBNEI7QUFDM0MsUUFBSSxLQUFLLFNBQVMsVUFBVTtBQUMxQixhQUFPO0FBQUEsUUFDTCxNQUFNO0FBQUEsUUFDTixNQUFNLEtBQUs7QUFBQSxRQUNYLGVBQWUsS0FBSztBQUFBLFFBQ3BCLE1BQU0sS0FBSztBQUFBLFFBQ1gsTUFBTSxLQUFLO0FBQUEsUUFDWCxVQUFVLEtBQUs7QUFBQSxNQUNqQjtBQUFBLElBQ0Y7QUFDQSxXQUFPO0FBQUEsTUFDTCxNQUFNLEtBQUssU0FBUyxRQUFRLFNBQVMsS0FBSztBQUFBLE1BQzFDLE1BQU0sS0FBSztBQUFBLE1BQ1gsZUFBZSxLQUFLO0FBQUEsTUFDcEIsTUFBTSxLQUFLO0FBQUEsTUFDWCxNQUFNLEtBQUs7QUFBQSxJQUNiO0FBQUEsRUFDRjtBQUFBLEVBRUEsTUFBYyxVQUFVLE1BQStDO0FBQ3JFLFFBQUk7QUFDRixhQUFPLE1BQU0sS0FBSyxRQUFRLFFBQVEsU0FBUyxJQUFJO0FBQUEsSUFDakQsU0FBUTtBQUNOLGFBQU87QUFBQSxJQUNUO0FBQUEsRUFDRjtBQUFBLEVBRUEsTUFBYyxXQUFXLFFBQXFDO0FBQzVELFVBQU0sWUFBWSxLQUFLO0FBQ3ZCLFFBQUksY0FBYyxLQUFNLE9BQU0sSUFBSSxhQUFhLGVBQWU7QUFFOUQsVUFBTSxVQUF5QjtBQUFBLE1BQzdCLE1BQU07QUFBQSxNQUNOLE1BQU0sT0FBTztBQUFBLE1BQ2IsZUFBZSxPQUFPO0FBQUEsTUFDdEIsTUFBTSxPQUFPO0FBQUEsTUFDYixNQUFNLE9BQU87QUFBQSxNQUNiLE1BQU0sT0FBTztBQUFBLE1BQ2IsR0FBSSxPQUFPLGFBQWEsU0FBWSxFQUFFLFVBQVUsT0FBTyxTQUFTLElBQUksQ0FBQztBQUFBLE1BQ3JFLEdBQUksT0FBTyxhQUFhLE9BQU8sRUFBRSxVQUFVLEtBQUssSUFBSSxDQUFDO0FBQUEsTUFDckQsR0FBSSxPQUFPLFVBQVUsVUFBYSxPQUFPLE1BQU0sY0FBYywyQkFDekQsRUFBRSxRQUFRLGNBQWMsT0FBTyxLQUFLLEVBQUUsSUFDdEMsQ0FBQztBQUFBLElBQ1A7QUFHQSxRQUFJLE9BQU8sVUFBVSxVQUFhLE9BQU8sTUFBTSxhQUFhLDBCQUEwQjtBQUNwRixZQUFNLEtBQUssV0FBVyxPQUFPLE1BQU0sT0FBTyxLQUFLO0FBQUEsSUFDakQ7QUFFQSxVQUFNLFFBQVEsTUFBTSxLQUFLO0FBQUEsTUFDdkIsQ0FBQyxNQUFNLEVBQUUsU0FBUyxlQUFlLEVBQUUsU0FBUyxjQUFjLEVBQUUsU0FBUztBQUFBLE1BQ3JFLE1BQU0sVUFBVSxLQUFLLE9BQU87QUFBQSxJQUM5QjtBQUNBLFFBQUksTUFBTSxTQUFTLFFBQVMsT0FBTSxLQUFLLFFBQVEsS0FBSztBQUVwRCxRQUFJLE1BQU0sU0FBUyxhQUFhO0FBQzlCLFVBQUksTUFBTSxNQUFNLEtBQUssT0FBUSxNQUFLLFNBQVMsTUFBTTtBQUNqRCxXQUFLLGdCQUFnQixRQUFRLE1BQU0sU0FBUyxNQUFNLEtBQUs7QUFDdkQ7QUFBQSxJQUNGO0FBQ0EsVUFBTSxLQUFLLG9CQUFvQixRQUFRLEtBQUs7QUFBQSxFQUM5QztBQUFBLEVBRVEsZ0JBQWdCLFFBQXNCLFdBQW1CLE9BQTJCO0FBQzFGLFVBQU0sVUFBVSxPQUFPLFNBQVM7QUFDaEMsUUFBSSxPQUFPLFNBQVMsWUFBWSxPQUFPLGFBQWEsUUFBVztBQUM3RCxXQUFLLFFBQVEsWUFBWSxZQUFZLEtBQUssT0FBTyxPQUFPLFFBQVEsR0FBRztBQUFBLFFBQ2pFLE1BQU0sT0FBTztBQUFBLFFBQ2I7QUFBQSxRQUNBLE1BQU0sT0FBTztBQUFBLFFBQ2IsTUFBTSxPQUFPO0FBQUEsUUFDYjtBQUFBLE1BQ0YsQ0FBQztBQUNEO0FBQUEsSUFDRjtBQUtBLFNBQUssUUFBUSxZQUFZLEtBQUssT0FBTztBQUFBLE1BQ25DLE1BQU0sT0FBTztBQUFBLE1BQ2I7QUFBQSxNQUNBLE1BQU0sT0FBTztBQUFBLE1BQ2IsTUFBTSxPQUFPO0FBQUEsTUFDYjtBQUFBLE1BQ0E7QUFBQSxNQUNBLFdBQVcsVUFBVSxLQUFLLElBQUksSUFBSTtBQUFBLE1BQ2xDLEdBQUksT0FBTyxhQUFhLE9BQU8sRUFBRSxVQUFVLEtBQUssSUFBSSxDQUFDO0FBQUEsTUFDckQsR0FBSSxPQUFPLFVBQVUsU0FBWSxFQUFFLE9BQU8sT0FBTyxNQUFNLElBQUksQ0FBQztBQUFBLElBQzlELENBQUM7QUFBQSxFQUNIO0FBQUEsRUFFQSxNQUFjLG9CQUNaLFFBQ0EsT0FDZTtBQUNmLFFBQUksTUFBTSxRQUFRLFVBQWEsTUFBTSxNQUFNLEtBQUssT0FBUSxNQUFLLFNBQVMsTUFBTTtBQUM1RSxVQUFNLFFBQ0osTUFBTSxPQUFPLGFBQWEsS0FBSyxRQUFRLFlBQVksTUFBTSxPQUFPLFNBQVMsT0FBTztBQUNsRixRQUFJLE9BQU87QUFDVCxXQUFLLGdCQUFnQixRQUFRLE1BQU0sT0FBTyxJQUFJLE1BQU0sT0FBTyxLQUFLO0FBQ2hFO0FBQUEsSUFDRjtBQU1BLFFBQUksT0FBTyxTQUFTLFlBQVksT0FBTyxTQUFTLFlBQVksT0FBTyxhQUFhLE1BQU07QUFDcEYsWUFBTSxRQUFRLE1BQU0sS0FBSyxVQUFVLE9BQU8sSUFBSTtBQUM5QyxVQUFJLFVBQVUsVUFBYyxNQUFNLFVBQVUsS0FBSyxNQUFPLE9BQU8sTUFBTTtBQUNuRSxhQUFLLGtCQUFrQjtBQUN2QjtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBRUEsUUFBSSxPQUFPLFNBQVMsWUFBWSxPQUFPLGFBQWEsUUFBVztBQUc3RCxXQUFLLFFBQVEsWUFBWSxLQUFLLE9BQU87QUFBQSxRQUNuQyxNQUFNLE1BQU0sT0FBTztBQUFBLFFBQ25CLFdBQVcsTUFBTSxPQUFPO0FBQUEsUUFDeEIsTUFBTSxNQUFNLE9BQU87QUFBQSxRQUNuQixNQUFNLE1BQU0sT0FBTztBQUFBLFFBQ25CLE9BQU8sTUFBTSxPQUFPO0FBQUEsTUFDdEIsQ0FBQztBQUNEO0FBQUEsSUFDRjtBQUVBLFNBQUssUUFBUSxNQUFNLEtBQUssV0FBVyxDQUFDLEtBQUssYUFBYSxNQUFNLE1BQU0sQ0FBQyxDQUFDO0FBQUEsRUFDdEU7QUFBQTtBQUFBLEVBR1EsYUFBYSxRQVFWO0FBQ1QsVUFBTSxRQUFRLEtBQUssTUFBTSxPQUFPLElBQUk7QUFDcEMsVUFBTSxVQUFVLE9BQU8sU0FBUztBQUNoQyxVQUFNLE9BQTJCLFVBQzdCLFdBQ0EsVUFBVSxTQUNSLFFBQ0EsTUFBTSxjQUFjLFNBQ2xCLFlBQ0E7QUFDUixXQUFPO0FBQUEsTUFDTDtBQUFBLE1BQ0EsTUFBTSxPQUFPO0FBQUEsTUFDYixNQUFNLE9BQU87QUFBQSxNQUNiLE1BQU0sT0FBTztBQUFBLE1BQ2IsU0FBUyxPQUFPO0FBQUEsTUFDaEIsT0FBTyxPQUFPO0FBQUEsTUFDZDtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQUEsRUFFQSxNQUFjLFdBQVcsTUFBYyxPQUFrQztBQUN2RSxVQUFNLFlBQVksS0FBSztBQUN2QixRQUFJLGNBQWMsS0FBTSxPQUFNLElBQUksYUFBYSxlQUFlO0FBQzlELFVBQU0sUUFBUSxNQUFNLEtBQUs7QUFBQSxNQUN2QixDQUFDLE1BQU0sRUFBRSxTQUFTLGFBQWEsRUFBRSxTQUFTO0FBQUEsTUFDMUMsTUFBTSxVQUFVLEtBQUssRUFBRSxNQUFNLFdBQVcsTUFBTSxTQUFTLGNBQWMsS0FBSyxFQUFFLENBQUM7QUFBQSxJQUMvRTtBQUNBLFFBQUksTUFBTSxTQUFTLFFBQVMsT0FBTSxLQUFLLFFBQVEsS0FBSztBQUNwRCxVQUFNLEtBQUssUUFBUSxVQUFVLElBQUksTUFBTSxLQUFLO0FBQUEsRUFDOUM7QUFBQSxFQVdBLE1BQWMsYUFBYSxNQUFtQztBQUM1RCxVQUFNLFlBQVksS0FBSztBQUN2QixRQUFJLGNBQWMsS0FBTSxPQUFNLElBQUksYUFBYSxlQUFlO0FBQzlELFVBQU0sUUFBUSxNQUFNLEtBQUs7QUFBQSxNQUN2QixDQUFDLE1BQU8sRUFBRSxTQUFTLFVBQVUsRUFBRSxTQUFTLFFBQVMsRUFBRSxTQUFTO0FBQUEsTUFDNUQsTUFBTSxVQUFVLEtBQUssRUFBRSxNQUFNLFdBQVcsS0FBSyxDQUFDO0FBQUEsSUFDaEQ7QUFDQSxRQUFJLE1BQU0sU0FBUyxRQUFTLE9BQU0sS0FBSyxRQUFRLEtBQUs7QUFDcEQsVUFBTSxRQUFRLGNBQWMsTUFBTSxPQUFPO0FBQ3pDLFFBQUssTUFBTSxVQUFVLEtBQUssTUFBTyxNQUFNO0FBQ3JDLFlBQU0sSUFBSSxjQUFjLFFBQVEsSUFBSSxrQ0FBa0M7QUFBQSxJQUN4RTtBQUNBLFdBQU87QUFBQSxFQUNUO0FBQUE7QUFBQSxFQUlRLFFBQ04sU0FDQSxNQUNZO0FBQ1osV0FBTyxJQUFJLFFBQVcsQ0FBQyxTQUFTLFdBQVc7QUFDekMsV0FBSyxjQUFjO0FBQUEsUUFDakIsU0FBUyxDQUFDLFlBQVksUUFBUSxPQUFPO0FBQUEsUUFDckMsU0FBUyxDQUFDLFlBQVksUUFBUSxPQUFZO0FBQUEsUUFDMUM7QUFBQSxNQUNGO0FBQ0EsVUFBSTtBQUNGLGFBQUs7QUFBQSxNQUNQLFNBQVMsT0FBTztBQUNkLGFBQUssY0FBYztBQUNuQixlQUFPLGlCQUFpQixRQUFRLFFBQVEsSUFBSSxhQUFhLE9BQU8sS0FBSyxDQUFDLENBQUM7QUFBQSxNQUN6RTtBQUFBLElBQ0YsQ0FBQztBQUFBLEVBQ0g7QUFBQSxFQUVRLFFBQVEsU0FBb0M7QUFDbEQsWUFBUSxRQUFRLE1BQU07QUFBQSxNQUNwQixLQUFLO0FBQ0gsZUFBTyxJQUFJLGtCQUFrQixRQUFRLE9BQU87QUFBQSxNQUM5QyxLQUFLO0FBQ0gsZUFBTyxJQUFJLGFBQWEsUUFBUSxPQUFPO0FBQUEsTUFDekM7QUFDRSxlQUFPLElBQUksY0FBYyxRQUFRLE9BQU87QUFBQSxJQUM1QztBQUFBLEVBQ0Y7QUFBQSxFQUVRLFFBQVEsV0FBK0M7QUFDN0QsU0FBSyxhQUFhO0FBQ2xCLFVBQU0sTUFBTSxLQUFLLEtBQUssS0FBSyxXQUFXLFNBQVM7QUFDL0MsVUFBTSxVQUFVLElBQUk7QUFBQSxNQUNsQixNQUFNO0FBQ0osYUFBSyxhQUFhO0FBQ2xCLGFBQUssYUFBYTtBQUFBLE1BQ3BCO0FBQUEsTUFDQSxDQUFDLFVBQW1CO0FBQ2xCLGFBQUssYUFBYTtBQUNsQixhQUFLLGFBQWE7QUFDbEIsY0FBTTtBQUFBLE1BQ1I7QUFBQSxJQUNGO0FBR0EsU0FBSyxPQUFPLFFBQVE7QUFBQSxNQUNsQixNQUFNO0FBQUEsTUFBQztBQUFBLE1BQ1AsTUFBTTtBQUFBLE1BQUM7QUFBQSxJQUNUO0FBQ0EsV0FBTztBQUFBLEVBQ1Q7QUFBQSxFQUVRLGVBQXFCO0FBQzNCLFVBQU0sV0FBVyxvQkFBb0IsS0FBSyxLQUFLO0FBQy9DLFNBQUssS0FBSyxRQUFRLFFBQ2YsVUFBVSx3QkFBd0IsSUFBSSxZQUFZLEVBQUUsT0FBTyxRQUFRLENBQUMsRUFDcEUsTUFBTSxDQUFDLFVBQW1CLEtBQUssSUFBSSxLQUFLLGlDQUFpQyxLQUFLLENBQUM7QUFBQSxFQUNwRjtBQUNGOzs7QUNyMUJPLElBQU0sc0JBQXNCO0FBWTVCLElBQU0seUJBQU4sTUFBdUQ7QUFBQSxFQVM1RCxZQUFZLFNBQXdDO0FBUnBELHdCQUFpQjtBQUtqQjtBQUFBO0FBQUE7QUFBQTtBQUFBLHdCQUFRLG9CQUFtQjtBQUMzQix3QkFBUSxlQUFjO0FBR3BCLFNBQUssVUFBVSxRQUFRO0FBQUEsRUFDekI7QUFBQTtBQUFBO0FBQUEsRUFLUSxjQUFjLFdBQTJCO0FBQy9DLFVBQU0sYUFBYSxtQkFBbUIsU0FBUztBQUMvQyxXQUFPLGVBQWUsTUFBTSxNQUFNLFdBQVcsTUFBTSxDQUFDO0FBQUEsRUFDdEQ7QUFBQTtBQUFBLEVBSUEsTUFBTSxTQUFTLE1BQW1DO0FBQ2hELFVBQU0sU0FBUyxNQUFNLEtBQUssUUFBUSxXQUFXLEtBQUssY0FBYyxJQUFJLENBQUM7QUFDckUsV0FBTyxJQUFJLFdBQVcsTUFBTTtBQUFBLEVBQzlCO0FBQUEsRUFFQSxNQUFNLFVBQVUsTUFBYyxNQUFpQztBQUM3RCxVQUFNLFNBQVMsS0FBSyxjQUFjLElBQUk7QUFDdEMsVUFBTSxLQUFLLGlCQUFpQixNQUFNO0FBR2xDLFVBQU0sU0FBUyxJQUFJLFlBQVksS0FBSyxVQUFVO0FBQzlDLFFBQUksV0FBVyxNQUFNLEVBQUUsSUFBSSxJQUFJO0FBRS9CLFFBQUksS0FBSyxrQkFBa0I7QUFDekIsWUFBTSxLQUFLLFFBQVEsWUFBWSxRQUFRLE1BQU07QUFDN0M7QUFBQSxJQUNGO0FBQ0EsVUFBTSxPQUFPLE1BQU0sS0FBSyxTQUFTO0FBQ2pDLFFBQUk7QUFDRixZQUFNLEtBQUssUUFBUSxZQUFZLE1BQU0sTUFBTTtBQUMzQyxZQUFNLEtBQUssUUFBUSxPQUFPLE1BQU0sTUFBTTtBQUFBLElBQ3hDLFNBQVE7QUFJTixZQUFNLEtBQUssYUFBYSxJQUFJO0FBQzVCLFdBQUssbUJBQW1CO0FBQ3hCLFlBQU0sS0FBSyxRQUFRLFlBQVksUUFBUSxNQUFNO0FBQUEsSUFDL0M7QUFBQSxFQUNGO0FBQUEsRUFFQSxNQUFNLFdBQVcsTUFBNkI7QUFDNUMsVUFBTSxTQUFTLEtBQUssY0FBYyxJQUFJO0FBRXRDLFFBQUksQ0FBRSxNQUFNLEtBQUssUUFBUSxPQUFPLE1BQU0sRUFBSTtBQUMxQyxRQUFJO0FBQ0YsWUFBTSxLQUFLLFFBQVEsT0FBTyxNQUFNO0FBQUEsSUFDbEMsU0FBUTtBQUVOLFVBQUksTUFBTSxLQUFLLFFBQVEsT0FBTyxNQUFNLEVBQUcsT0FBTSxJQUFJLE1BQU0sb0JBQW9CLE1BQU0sRUFBRTtBQUFBLElBQ3JGO0FBQUEsRUFDRjtBQUFBLEVBRUEsTUFBTSxXQUFXLE1BQWMsSUFBMkI7QUFDeEQsVUFBTSxXQUFXLEtBQUssY0FBYyxJQUFJO0FBQ3hDLFVBQU0sU0FBUyxLQUFLLGNBQWMsRUFBRTtBQUNwQyxVQUFNLEtBQUssaUJBQWlCLE1BQU07QUFDbEMsVUFBTSxLQUFLLFFBQVEsT0FBTyxVQUFVLE1BQU07QUFBQSxFQUM1QztBQUFBLEVBRUEsTUFBTSxZQUEwQztBQUM5QyxVQUFNLFFBQW9CLENBQUM7QUFDM0IsVUFBTSxLQUFLLFVBQVUsS0FBSyxPQUFPLGdCQUFnQjtBQUMvQyxZQUFNLE9BQU8sTUFBTSxLQUFLLFdBQVcsV0FBVztBQUM5QyxVQUFJLFNBQVMsS0FBTTtBQUNuQixZQUFNLEtBQUs7QUFBQSxRQUNULE1BQU0sSUFBSSxXQUFXO0FBQUEsUUFDckIsTUFBTSxLQUFLO0FBQUEsUUFDWCxPQUFPLEtBQUs7QUFBQSxNQUNkLENBQUM7QUFBQSxJQUNILENBQUM7QUFDRCxVQUFNLEtBQUssQ0FBQyxHQUFHLE1BQU8sRUFBRSxPQUFPLEVBQUUsT0FBTyxLQUFLLEVBQUUsT0FBTyxFQUFFLE9BQU8sSUFBSSxDQUFFO0FBQ3JFLFdBQU87QUFBQSxFQUNUO0FBQUEsRUFFQSxNQUFNLFdBQXVDO0FBQzNDLFVBQU0sT0FBaUIsQ0FBQyxHQUFHO0FBQzNCLFVBQU0sS0FBSyxZQUFZLEtBQUssT0FBTyxnQkFBZ0I7QUFDakQsV0FBSyxLQUFLLElBQUksV0FBVyxFQUFFO0FBQUEsSUFDN0IsQ0FBQztBQUNELFNBQUssS0FBSyxDQUFDLEdBQUcsTUFBTyxJQUFJLElBQUksS0FBSyxJQUFJLElBQUksSUFBSSxDQUFFO0FBQ2hELFdBQU87QUFBQSxFQUNUO0FBQUEsRUFFQSxNQUFNLFVBQVUsTUFBNkI7QUFDM0MsVUFBTSxhQUFhLG1CQUFtQixJQUFJO0FBQzFDLFVBQU0sV0FBVyxlQUFlLE1BQU0sQ0FBQyxJQUFJLFdBQVcsTUFBTSxDQUFDLEVBQUUsTUFBTSxHQUFHO0FBQ3hFLFFBQUksVUFBVTtBQUNkLGVBQVcsV0FBVyxVQUFVO0FBQzlCLGdCQUFVLFlBQVksS0FBSyxVQUFVLEdBQUcsT0FBTyxJQUFJLE9BQU87QUFDMUQsVUFBSSxDQUFFLE1BQU0sS0FBSyxRQUFRLE9BQU8sT0FBTyxFQUFJLE9BQU0sS0FBSyxRQUFRLE1BQU0sT0FBTztBQUFBLElBQzdFO0FBQUEsRUFDRjtBQUFBLEVBRUEsTUFBTSxPQUFPLE1BQWdDO0FBQzNDLFVBQU0sYUFBYSxtQkFBbUIsSUFBSTtBQUMxQyxRQUFJLGVBQWUsSUFBSyxRQUFPO0FBQy9CLFFBQUk7QUFDRixhQUFPLE1BQU0sS0FBSyxRQUFRLE9BQU8sS0FBSyxjQUFjLFVBQVUsQ0FBQztBQUFBLElBQ2pFLFNBQVE7QUFDTixhQUFPO0FBQUEsSUFDVDtBQUFBLEVBQ0Y7QUFBQTtBQUFBLEVBSUEsTUFBYyxXQUFXLGFBQWtEO0FBQ3pFLFFBQUk7QUFDRixZQUFNLE9BQU8sTUFBTSxLQUFLLFFBQVEsS0FBSyxXQUFXO0FBQ2hELFVBQUksU0FBUyxRQUFRLEtBQUssU0FBUyxPQUFRLFFBQU87QUFDbEQsYUFBTyxFQUFFLE1BQU0sS0FBSyxNQUFNLE9BQU8sS0FBSyxNQUFNO0FBQUEsSUFDOUMsU0FBUTtBQUNOLGFBQU87QUFBQSxJQUNUO0FBQUEsRUFDRjtBQUFBO0FBQUEsRUFHQSxNQUFjLFdBQTRCO0FBQ3hDLFVBQU0sS0FBSyxVQUFVLG1CQUFtQjtBQUN4QyxTQUFLLGVBQWU7QUFDcEIsV0FBTyxHQUFHLG9CQUFvQixNQUFNLENBQUMsQ0FBQyxNQUFNLEtBQUssSUFBSSxFQUFFLFNBQVMsRUFBRSxDQUFDLElBQUksS0FBSyxXQUFXO0FBQUEsRUFDekY7QUFBQSxFQUVBLE1BQWMsYUFBYSxhQUFvQztBQUM3RCxRQUFJO0FBQ0YsWUFBTSxLQUFLLFFBQVEsT0FBTyxXQUFXO0FBQUEsSUFDdkMsU0FBUTtBQUFBLElBRVI7QUFBQSxFQUNGO0FBQUE7QUFBQSxFQUdBLE1BQWMsaUJBQWlCLGFBQW9DO0FBQ2pFLFVBQU0sUUFBUSxZQUFZLFlBQVksR0FBRztBQUN6QyxRQUFJLFNBQVMsRUFBRztBQUNoQixVQUFNLFNBQVMsWUFBWSxNQUFNLEdBQUcsS0FBSztBQUN6QyxVQUFNLEtBQUssVUFBVSxJQUFJLE1BQU0sRUFBRTtBQUFBLEVBQ25DO0FBQUE7QUFBQSxFQUdBLE1BQWMsVUFDWixnQkFDQSxPQUNlO0FBQ2YsUUFBSTtBQUNKLFFBQUk7QUFDRixnQkFBVSxNQUFNLEtBQUssUUFBUSxLQUFLLGNBQWM7QUFBQSxJQUNsRCxTQUFRO0FBQ047QUFBQSxJQUNGO0FBQ0EsZUFBVyxRQUFRLFFBQVEsTUFBTyxPQUFNLE1BQU0sSUFBSTtBQUNsRCxlQUFXLFVBQVUsUUFBUSxRQUFTLE9BQU0sS0FBSyxVQUFVLFFBQVEsS0FBSztBQUFBLEVBQzFFO0FBQUE7QUFBQSxFQUdBLE1BQWMsWUFDWixnQkFDQSxPQUNlO0FBQ2YsUUFBSTtBQUNKLFFBQUk7QUFDRixnQkFBVSxNQUFNLEtBQUssUUFBUSxLQUFLLGNBQWM7QUFBQSxJQUNsRCxTQUFRO0FBQ047QUFBQSxJQUNGO0FBQ0EsZUFBVyxVQUFVLFFBQVEsU0FBUztBQUNwQyxZQUFNLE1BQU0sTUFBTTtBQUNsQixZQUFNLEtBQUssWUFBWSxRQUFRLEtBQUs7QUFBQSxJQUN0QztBQUFBLEVBQ0Y7QUFDRjs7O0FDbE1PLElBQU0sdUJBQU4sTUFBbUQ7QUFBQSxFQUt4RCxZQUFZLFNBQXNDO0FBSmxELHdCQUFpQjtBQUNqQix3QkFBUSxRQUFtQixDQUFDO0FBQzVCLHdCQUFRLFFBQThEO0FBR3BFLFNBQUssUUFBUSxRQUFRO0FBQUEsRUFDdkI7QUFBQSxFQUVBLE1BQU0sSUFBd0Q7QUFDNUQsU0FBSyxLQUFLO0FBQ1YsU0FBSyxPQUFPO0FBSVosU0FBSyxPQUFPO0FBQUEsTUFDVixLQUFLLE1BQU0sR0FBRyxVQUFVLENBQUMsU0FBd0I7QUFDL0MsYUFBSyxRQUFRLEVBQUUsTUFBTSxPQUFPLE1BQU0sWUFBWSxJQUFJLEVBQUUsQ0FBQztBQUFBLE1BQ3ZELENBQUM7QUFBQSxNQUNELEtBQUssTUFBTSxHQUFHLFVBQVUsQ0FBQyxTQUF3QjtBQUMvQyxhQUFLLFFBQVEsRUFBRSxNQUFNLFVBQVUsTUFBTSxZQUFZLElBQUksRUFBRSxDQUFDO0FBQUEsTUFDMUQsQ0FBQztBQUFBLE1BQ0QsS0FBSyxNQUFNLEdBQUcsVUFBVSxDQUFDLFNBQXdCO0FBQy9DLGFBQUssUUFBUSxFQUFFLE1BQU0sVUFBVSxNQUFNLFlBQVksSUFBSSxFQUFFLENBQUM7QUFBQSxNQUMxRCxDQUFDO0FBQUEsTUFDRCxLQUFLLE1BQU0sR0FBRyxVQUFVLENBQUMsTUFBcUIsWUFBb0I7QUFFaEUsYUFBSyxRQUFRLEVBQUUsTUFBTSxVQUFVLE1BQU0sSUFBSSxPQUFPLElBQUksUUFBUSxZQUFZLElBQUksRUFBRSxDQUFDO0FBQUEsTUFDakYsQ0FBQztBQUFBLElBQ0g7QUFBQSxFQUNGO0FBQUEsRUFFQSxPQUFhO0FBQ1gsZUFBVyxPQUFPLEtBQUssS0FBTSxNQUFLLE1BQU0sT0FBTyxHQUFHO0FBQ2xELFNBQUssT0FBTyxDQUFDO0FBQ2IsU0FBSyxPQUFPO0FBQUEsRUFDZDtBQUFBLEVBRVEsUUFBUSxPQUE4QjtBQTdEaEQ7QUE4REksZUFBSyxTQUFMLDhCQUFZLENBQUMsS0FBSztBQUFBLEVBQ3BCO0FBQ0Y7QUFHQSxTQUFTLFlBQVksTUFBNkI7QUFDaEQsU0FBTyxLQUFLLEtBQUssV0FBVyxHQUFHLElBQUksS0FBSyxPQUFPLElBQUksS0FBSyxJQUFJO0FBQzlEO0FBc0JPLElBQU0sa0JBQU4sTUFBc0I7QUFBQSxFQVkzQixZQUFZLFNBQWlDO0FBWDdDLHdCQUFpQjtBQUNqQix3QkFBaUI7QUFDakIsd0JBQWlCO0FBQ2pCLHdCQUFpQjtBQUNqQix3QkFBaUI7QUFFakIsd0JBQVEsT0FBMkI7QUFDbkMsd0JBQVEsa0JBQTBCO0FBQ2xDLHdCQUFRO0FBQ1Isd0JBQVEsY0FBc0I7QUFyR2hDO0FBd0dJLFNBQUssYUFBYSxRQUFRO0FBQzFCLFNBQUssZUFBYyxhQUFRLGdCQUFSLFlBQXVCO0FBQzFDLFNBQUssbUJBQWtCLGFBQVEsb0JBQVIsYUFBNEIsQ0FBQyxJQUFJLE9BQU8sWUFBWSxJQUFJLEVBQUU7QUFDakYsU0FBSyxxQkFBb0IsYUFBUSxzQkFBUixhQUE4QixDQUFDLFdBQVcsY0FBYyxNQUFnQjtBQUNqRyxTQUFLLGtCQUFpQixhQUFRLG1CQUFSLGFBQTJCLENBQUMsSUFBSSxPQUFPLFdBQVcsSUFBSSxFQUFFO0FBQzlFLFNBQUssb0JBQW1CLGFBQVEscUJBQVIsYUFBNkIsQ0FBQyxXQUFXLGFBQWEsTUFBZ0I7QUFBQSxFQUNoRztBQUFBO0FBQUEsRUFHQSxNQUFNLEtBQXVCO0FBQzNCLFNBQUssS0FBSztBQUNWLFNBQUssTUFBTTtBQUNYLFNBQUssWUFBWTtBQUFBLEVBQ25CO0FBQUEsRUFFQSxPQUFhO0FBQ1gsU0FBSyxzQkFBc0I7QUFDM0IsUUFBSSxLQUFLLGVBQWUsTUFBTTtBQUM1QixXQUFLLGlCQUFpQixLQUFLLFVBQVU7QUFDckMsV0FBSyxhQUFhO0FBQUEsSUFDcEI7QUFDQSxTQUFLLE1BQU07QUFBQSxFQUNiO0FBQUE7QUFBQSxFQUdBLGNBQWMsSUFBa0I7QUFDOUIsU0FBSyxhQUFhO0FBQ2xCLFFBQUksS0FBSyxRQUFRLE1BQU07QUFDckIsV0FBSyxzQkFBc0I7QUFDM0IsV0FBSyxZQUFZO0FBQUEsSUFDbkI7QUFBQSxFQUNGO0FBQUE7QUFBQSxFQUdBLE9BQWE7QUFDWCxRQUFJLEtBQUssUUFBUSxLQUFNO0FBQ3ZCLFFBQUksS0FBSyxlQUFlLEtBQU07QUFDOUIsU0FBSyxhQUFhLEtBQUssZUFBZSxNQUFNO0FBN0loRDtBQThJTSxXQUFLLGFBQWE7QUFDbEIsaUJBQUssUUFBTDtBQUFBLElBQ0YsR0FBRyxLQUFLLFdBQVc7QUFBQSxFQUNyQjtBQUFBLEVBRUEsSUFBSSxrQkFBMEI7QUFDNUIsV0FBTyxLQUFLO0FBQUEsRUFDZDtBQUFBLEVBRVEsY0FBb0I7QUFDMUIsUUFBSSxLQUFLLGNBQWMsS0FBSyxLQUFLLFFBQVEsS0FBTTtBQUMvQyxTQUFLLGlCQUFpQixLQUFLLGdCQUFnQixNQUFHO0FBekpsRDtBQXlKcUQsd0JBQUssUUFBTDtBQUFBLE9BQWMsS0FBSyxVQUFVO0FBQUEsRUFDaEY7QUFBQSxFQUVRLHdCQUE4QjtBQUNwQyxRQUFJLEtBQUssbUJBQW1CLE1BQU07QUFDaEMsV0FBSyxrQkFBa0IsS0FBSyxjQUFjO0FBQzFDLFdBQUssaUJBQWlCO0FBQUEsSUFDeEI7QUFBQSxFQUNGO0FBQ0Y7OztBQ3ZKTyxJQUFNLGdCQUFOLGNBQTRCLE1BQU07QUFBQSxFQUN2QyxZQUNXLFFBQ1QsU0FDQTtBQUNBLFVBQU0sT0FBTztBQUhKO0FBSVQsU0FBSyxPQUFPO0FBQUEsRUFDZDtBQUNGO0FBV08sSUFBTSxnQkFBTixNQUF5QztBQUFBLEVBSzlDLFlBQVksU0FBK0I7QUFKM0Msd0JBQWlCO0FBQ2pCLHdCQUFpQjtBQUNqQix3QkFBaUI7QUFqQ25CO0FBb0NJLFNBQUssT0FBTyxRQUFRLFFBQVEsUUFBUSxRQUFRLEVBQUU7QUFDOUMsU0FBSyxRQUFRLFFBQVE7QUFJckIsU0FBSyxXQUFVLGFBQVEsY0FBUixZQUFxQixXQUFXLE1BQU0sS0FBSyxVQUFVO0FBQUEsRUFDdEU7QUFBQTtBQUFBLEVBR0EsTUFBTSxJQUFJLE1BQStDO0FBQ3ZELFVBQU0sV0FBVyxNQUFNLEtBQUssUUFBUSxHQUFHLEtBQUssSUFBSSxTQUFTLElBQUksSUFBSTtBQUFBLE1BQy9ELFNBQVMsRUFBRSxlQUFlLFVBQVUsS0FBSyxLQUFLLEdBQUc7QUFBQSxJQUNuRCxDQUFDO0FBQ0QsUUFBSSxTQUFTLFdBQVcsSUFBSyxRQUFPO0FBQ3BDLFFBQUksQ0FBQyxTQUFTLElBQUk7QUFDaEIsWUFBTSxJQUFJLGNBQWMsU0FBUyxRQUFRLE1BQU0sYUFBYSxVQUFVLFlBQVksQ0FBQztBQUFBLElBQ3JGO0FBQ0EsV0FBTyxJQUFJLFdBQVcsTUFBTSxTQUFTLFlBQVksQ0FBQztBQUFBLEVBQ3BEO0FBQUE7QUFBQSxFQUdBLE1BQU0sSUFBSSxNQUFjLE9BQWtDO0FBQ3hELFVBQU0sV0FBVyxNQUFNLEtBQUssUUFBUSxHQUFHLEtBQUssSUFBSSxTQUFTLElBQUksSUFBSTtBQUFBLE1BQy9ELFFBQVE7QUFBQSxNQUNSLFNBQVM7QUFBQSxRQUNQLGVBQWUsVUFBVSxLQUFLLEtBQUs7QUFBQSxRQUNuQyxnQkFBZ0I7QUFBQSxNQUNsQjtBQUFBLE1BQ0EsTUFBTTtBQUFBLElBQ1IsQ0FBQztBQUNELFFBQUksQ0FBQyxTQUFTLElBQUk7QUFDaEIsWUFBTSxJQUFJLGNBQWMsU0FBUyxRQUFRLE1BQU0sYUFBYSxVQUFVLFlBQVksQ0FBQztBQUFBLElBQ3JGO0FBQUEsRUFDRjtBQUNGO0FBRUEsZUFBZSxhQUFhLFVBQW9CLE1BQStCO0FBQzdFLFFBQU0sVUFBVSxNQUFNLFNBQVMsS0FBSyxFQUFFLE1BQU0sTUFBTSxFQUFFLEdBQUcsTUFBTSxHQUFHLEdBQUc7QUFDbkUsU0FBTyxXQUFXLEtBQ2QsYUFBYSxJQUFJLFVBQVUsU0FBUyxNQUFNLEtBQzFDLGFBQWEsSUFBSSxVQUFVLFNBQVMsTUFBTSxLQUFLLE1BQU07QUFDM0Q7OztBQ25FQSxzQkFBeUI7QUErQmxCLElBQU0sOEJBQThCO0FBR3BDLElBQU0sMEJBQTJFO0FBQUEsRUFDdEYsRUFBRSxPQUFPLElBQUksT0FBTyxtQkFBbUI7QUFBQSxFQUN2QyxFQUFFLE9BQU8sSUFBSSxPQUFPLG1CQUFtQjtBQUFBLEVBQ3ZDLEVBQUUsT0FBTyxJQUFJLE9BQU8sZUFBZTtBQUFBLEVBQ25DLEVBQUUsT0FBTyxLQUFLLE9BQU8sa0JBQWtCO0FBQUEsRUFDdkMsRUFBRSxPQUFPLEdBQUcsT0FBTywwQkFBMEI7QUFDL0M7QUFFTyxTQUFTLG9CQUF5QztBQUN2RCxTQUFPO0FBQUEsSUFDTCxLQUFLO0FBQUEsSUFDTCxPQUFPO0FBQUEsSUFDUCxVQUFVO0FBQUEsSUFDVixZQUFZO0FBQUEsSUFDWixVQUFVO0FBQUEsTUFDUixtQkFBbUI7QUFBQSxNQUNuQixjQUFjO0FBQUEsSUFDaEI7QUFBQSxFQUNGO0FBQ0Y7QUFHTyxTQUFTLG9CQUFvQixLQUFtQztBQWxFdkU7QUFtRUUsUUFBTSxPQUFPLGtCQUFrQjtBQUMvQixNQUFJLE9BQU8sUUFBUSxZQUFZLFFBQVEsS0FBTSxRQUFPO0FBQ3BELFFBQU0sU0FBUztBQUNmLFNBQU87QUFBQSxJQUNMLEtBQUssT0FBTyxPQUFPLFFBQVEsV0FBVyxPQUFPLE1BQU07QUFBQSxJQUNuRCxPQUFPLE9BQU8sT0FBTyxVQUFVLFdBQVcsT0FBTyxRQUFRO0FBQUEsSUFDekQsVUFBVSxPQUFPLE9BQU8sYUFBYSxXQUFXLE9BQU8sV0FBVztBQUFBLElBQ2xFLFlBQVksT0FBTyxPQUFPLGVBQWUsV0FBVyxPQUFPLGFBQWE7QUFBQSxJQUN4RSxVQUFVO0FBQUEsTUFDUixtQkFDRSxTQUFPLFlBQU8sYUFBUCxtQkFBaUIsdUJBQXNCLFlBQVksT0FBTyxTQUFTLHFCQUFxQixJQUMzRixLQUFLLE1BQU0sT0FBTyxTQUFTLGlCQUFpQixJQUM1QztBQUFBLE1BQ04sZ0JBQWMsWUFBTyxhQUFQLG1CQUFpQixrQkFBaUI7QUFBQSxJQUNsRDtBQUFBLEVBQ0Y7QUFDRjtBQUdPLFNBQVMsU0FBUyxNQUFvQztBQUMzRCxTQUFPLEtBQUssUUFBUSxNQUFNLEtBQUssVUFBVSxNQUFNLEtBQUssYUFBYTtBQUNuRTtBQUdPLFNBQVMsbUJBQXlDO0FBQ3ZELFNBQU8seUJBQVMsY0FBYyxXQUFXO0FBQzNDO0FBR08sU0FBUyxvQkFBNEI7QUFDMUMsTUFBSSx5QkFBUyxhQUFhO0FBQ3hCLFFBQUkseUJBQVMsU0FBVSxRQUFPO0FBQzlCLFFBQUkseUJBQVMsYUFBYyxRQUFPO0FBQ2xDLFdBQU87QUFBQSxFQUNUO0FBQ0EsU0FBTztBQUNUOzs7QUM5Rk8sSUFBTSxpQkFBTixjQUE2QixNQUFNO0FBQUEsRUFDeEMsWUFDRSxTQUNTLFFBQ1Q7QUFDQSxVQUFNLE9BQU87QUFGSjtBQUdULFNBQUssT0FBTztBQUFBLEVBQ2Q7QUFDRjtBQUdPLElBQU0sb0JBQU4sY0FBZ0MsTUFBTTtBQUFBLEVBQzNDLFlBQVksU0FBaUI7QUFDM0IsVUFBTSxPQUFPO0FBQ2IsU0FBSyxPQUFPO0FBQUEsRUFDZDtBQUNGO0FBR08sSUFBTSx1QkFBTixjQUFtQyxNQUFNO0FBQUEsRUFDOUMsWUFBWSxTQUFpQjtBQUMzQixVQUFNLE9BQU87QUFDYixTQUFLLE9BQU87QUFBQSxFQUNkO0FBQ0Y7QUFtQk8sU0FBUyxtQkFBbUIsT0FBdUI7QUFDeEQsTUFBSSxZQUFZLE1BQU0sS0FBSztBQUMzQixNQUFJLGNBQWMsR0FBSSxPQUFNLElBQUksZUFBZSxxQkFBcUI7QUFDcEUsTUFBSSxDQUFDLGdDQUFnQyxLQUFLLFNBQVMsRUFBRyxhQUFZLFdBQVcsU0FBUztBQUN0RixNQUFJO0FBQ0osTUFBSTtBQUNGLGFBQVMsSUFBSSxJQUFJLFNBQVMsRUFBRTtBQUFBLEVBQzlCLFNBQVE7QUFDTixVQUFNLElBQUksZUFBZSx1QkFBdUIsS0FBSyxVQUFVLEtBQUssQ0FBQyxFQUFFO0FBQUEsRUFDekU7QUFDQSxNQUFJLENBQUMsT0FBTyxXQUFXLFNBQVMsS0FBSyxDQUFDLE9BQU8sV0FBVyxVQUFVLEdBQUc7QUFDbkUsVUFBTSxJQUFJLGVBQWUsbUNBQW1DLE1BQU0sRUFBRTtBQUFBLEVBQ3RFO0FBQ0EsU0FBTztBQUNUO0FBR0EsZUFBc0IsWUFDcEIsUUFDQSxXQUNxQjtBQUNyQixNQUFJO0FBQ0osTUFBSTtBQUNGLGVBQVcsTUFBTSxVQUFVLEdBQUcsTUFBTSxTQUFTO0FBQUEsRUFDL0MsU0FBUyxPQUFPO0FBQ2QsV0FBTztBQUFBLE1BQ0wsV0FBVztBQUFBLE1BQ1gsU0FBUztBQUFBLE1BQ1QsUUFBUSxpQkFBaUIsUUFBUSxNQUFNLFVBQVUsT0FBTyxLQUFLO0FBQUEsSUFDL0Q7QUFBQSxFQUNGO0FBQ0EsTUFBSSxDQUFDLFNBQVMsSUFBSTtBQUNoQixXQUFPLEVBQUUsV0FBVyxPQUFPLFNBQVMsT0FBTyxRQUFRLFFBQVEsU0FBUyxNQUFNLEdBQUc7QUFBQSxFQUMvRTtBQUNBLFFBQU0sT0FBUSxNQUFNLFNBQVMsS0FBSyxFQUFFLE1BQU0sT0FBTyxDQUFDLEVBQUU7QUFDcEQsU0FBTyxFQUFFLFdBQVcsTUFBTSxTQUFTLEtBQUssWUFBWSxLQUFLO0FBQzNEO0FBZUEsZUFBc0IsWUFBWSxRQUFxRDtBQUNyRixNQUFJO0FBQ0osTUFBSTtBQUNGLGVBQVcsTUFBTSxPQUFPLFVBQVUsR0FBRyxPQUFPLE1BQU0sU0FBUztBQUFBLE1BQ3pELFFBQVE7QUFBQSxNQUNSLFNBQVMsRUFBRSxnQkFBZ0IsbUJBQW1CO0FBQUEsTUFDOUMsTUFBTSxLQUFLLFVBQVU7QUFBQSxRQUNuQixNQUFNLE9BQU87QUFBQSxRQUNiLFlBQVksT0FBTztBQUFBLFFBQ25CLFlBQVksT0FBTztBQUFBLE1BQ3JCLENBQUM7QUFBQSxJQUNILENBQUM7QUFBQSxFQUNILFNBQVMsT0FBTztBQUNkLFVBQU0sSUFBSTtBQUFBLE1BQ1IsaUNBQWlDLE9BQU8sTUFBTSxLQUM1QyxpQkFBaUIsUUFBUSxNQUFNLFVBQVUsT0FBTyxLQUFLLENBQ3ZEO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFFQSxRQUFNLFVBQVUsTUFBTSxTQUFTLEtBQUssRUFBRSxNQUFNLE1BQU0sRUFBRSxHQUFHLEtBQUs7QUFDNUQsTUFBSSxTQUFTLFdBQVcsS0FBSztBQUMzQixVQUFNLElBQUkscUJBQXFCLHNDQUFzQztBQUFBLEVBQ3ZFO0FBQ0EsTUFBSSxTQUFTLFdBQVcsT0FBTyxTQUFTLFdBQVcsS0FBSztBQUN0RCxVQUFNLElBQUk7QUFBQSxNQUNSO0FBQUEsSUFFRjtBQUFBLEVBQ0Y7QUFDQSxNQUFJLENBQUMsU0FBUyxJQUFJO0FBQ2hCLFVBQU0sSUFBSTtBQUFBLE1BQ1Isd0JBQXdCLFNBQVMsTUFBTSxJQUFJLE9BQU8sTUFBTSxHQUFHLEdBQUcsQ0FBQyxHQUFHLEtBQUs7QUFBQSxNQUN2RSxTQUFTO0FBQUEsSUFDWDtBQUFBLEVBQ0Y7QUFDQSxNQUFJO0FBQ0osTUFBSTtBQUNGLFdBQU8sS0FBSyxNQUFNLE1BQU07QUFBQSxFQUMxQixTQUFRO0FBQ04sVUFBTSxJQUFJLGVBQWUsOEJBQThCLFNBQVMsTUFBTTtBQUFBLEVBQ3hFO0FBQ0EsTUFBSSxPQUFPLEtBQUssVUFBVSxZQUFZLE9BQU8sS0FBSyxhQUFhLFVBQVU7QUFDdkUsVUFBTSxJQUFJLGVBQWUsNENBQTRDLFNBQVMsTUFBTTtBQUFBLEVBQ3RGO0FBQ0EsU0FBTyxFQUFFLE9BQU8sS0FBSyxPQUFPLFVBQVUsS0FBSyxTQUFTO0FBQ3REOzs7QUNuSE8sU0FBUyxrQkFBa0IsS0FBcUI7QUFDckQsU0FBTztBQUFBLElBQ0wsaUJBQWlCLEdBQUc7QUFBQSxJQUNwQjtBQUFBLElBQ0EsV0FBVyxHQUFHO0FBQUEsSUFDZDtBQUFBLElBQ0E7QUFBQSxJQUNBO0FBQUEsRUFDRixFQUFFLEtBQUssSUFBSTtBQUNiO0FBTUEsZUFBc0IsZUFBZSxRQUE4QztBQWpEbkY7QUFrREUsTUFBSTtBQUNKLE1BQUk7QUFDRixhQUFTLG1CQUFtQixPQUFPLEdBQUc7QUFBQSxFQUN4QyxTQUFRO0FBQ04sV0FBTyxFQUFFLFFBQVEsZUFBZSxPQUFPLE9BQU8sSUFBSTtBQUFBLEVBQ3BEO0FBRUEsUUFBTSxTQUFTLE1BQU0sWUFBWSxRQUFRLE9BQU8sU0FBUztBQUN6RCxNQUFJLENBQUMsT0FBTyxXQUFXO0FBQ3JCLFdBQU87QUFBQSxNQUNMLFFBQVE7QUFBQSxNQUNSLEtBQUs7QUFBQSxNQUNMLFFBQ0UsSUFBRyxZQUFPLFdBQVAsWUFBaUIsZUFBZTtBQUFBLElBRXZDO0FBQUEsRUFDRjtBQUNBLE1BQUksQ0FBQyxPQUFPLFNBQVM7QUFDbkIsV0FBTyxFQUFFLFFBQVEsYUFBYSxLQUFLLFFBQVEsVUFBVSxrQkFBa0IsTUFBTSxFQUFFO0FBQUEsRUFDakY7QUFFQSxNQUFJO0FBQ0YsVUFBTSxjQUFjLE1BQU0sWUFBWTtBQUFBLE1BQ3BDO0FBQUEsTUFDQSxNQUFNLE9BQU87QUFBQSxNQUNiLFlBQVksT0FBTztBQUFBLE1BQ25CLFlBQVksT0FBTztBQUFBLE1BQ25CLFdBQVcsT0FBTztBQUFBLElBQ3BCLENBQUM7QUFDRCxXQUFPLEVBQUUsUUFBUSxVQUFVLEtBQUssUUFBUSxHQUFHLFlBQVk7QUFBQSxFQUN6RCxTQUFTLE9BQU87QUFDZCxRQUFJLGlCQUFpQixzQkFBc0I7QUFDekMsYUFBTyxFQUFFLFFBQVEsYUFBYSxLQUFLLFFBQVEsVUFBVSxrQkFBa0IsTUFBTSxFQUFFO0FBQUEsSUFDakY7QUFDQSxRQUFJLGlCQUFpQixtQkFBbUI7QUFDdEMsYUFBTyxFQUFFLFFBQVEsWUFBWSxLQUFLLFFBQVEsUUFBUSxNQUFNLFFBQVE7QUFBQSxJQUNsRTtBQUNBLFVBQU0sU0FBUyxpQkFBaUIsUUFBUSxNQUFNLFVBQVUsT0FBTyxLQUFLO0FBQ3BFLFdBQU8sRUFBRSxRQUFRLFlBQVksS0FBSyxRQUFRLE9BQU87QUFBQSxFQUNuRDtBQUNGO0FBR08sU0FBUyxtQkFBbUIsU0FBOEI7QUFDL0QsVUFBUSxRQUFRLFFBQVE7QUFBQSxJQUN0QixLQUFLO0FBQ0gsYUFBTyxlQUFlLFFBQVEsR0FBRztBQUFBLElBQ25DLEtBQUs7QUFDSCxhQUFPLFFBQVE7QUFBQSxJQUNqQixLQUFLO0FBQ0gsYUFBTywrQkFBK0IsUUFBUSxNQUFNO0FBQUEsSUFDdEQsS0FBSztBQUNILGFBQU8sbUJBQW1CLFFBQVEsTUFBTTtBQUFBLElBQzFDLEtBQUs7QUFDSCxhQUFPLHlDQUF5QyxLQUFLLFVBQVUsUUFBUSxLQUFLLENBQUM7QUFBQSxFQUNqRjtBQUNGOzs7QUM1RkEsSUFBQUMsbUJBQXVCO0FBR2hCLElBQU0sa0JBQWtCO0FBdUJ4QixTQUFTLGtCQUFrQixRQUFzRDtBQUN0RixRQUFNLE1BQU0sVUFBVSxRQUFRLEtBQUs7QUFDbkMsUUFBTSxPQUFPLFVBQVUsUUFBUSxNQUFNO0FBQ3JDLE1BQUksUUFBUSxNQUFNLFNBQVMsSUFBSTtBQUM3QixXQUFPLEVBQUUsSUFBSSxPQUFPLE9BQU8sd0JBQXdCO0FBQUEsRUFDckQ7QUFDQSxNQUFJLFFBQVEsR0FBSSxRQUFPLEVBQUUsSUFBSSxPQUFPLE9BQU8sb0RBQStDO0FBQzFGLE1BQUksU0FBUyxHQUFJLFFBQU8sRUFBRSxJQUFJLE9BQU8sT0FBTyx1REFBa0Q7QUFDOUYsU0FBTyxFQUFFLElBQUksTUFBTSxNQUFNLEVBQUUsS0FBSyxLQUFLLEVBQUU7QUFDekM7QUFFQSxTQUFTLFVBQVUsUUFBaUMsS0FBcUI7QUFDdkUsUUFBTSxRQUFRLE9BQU8sR0FBRztBQUN4QixNQUFJLE9BQU8sVUFBVSxTQUFVLFFBQU8sT0FBTyxLQUFLO0FBQ2xELE1BQUksT0FBTyxVQUFVLFNBQVUsUUFBTztBQUN0QyxRQUFNLFVBQVUsTUFBTSxLQUFLO0FBRzNCLE1BQUksUUFBUSxTQUFTLEdBQUcsR0FBRztBQUN6QixRQUFJO0FBQ0YsYUFBTyxtQkFBbUIsT0FBTztBQUFBLElBQ25DLFNBQVE7QUFDTixhQUFPO0FBQUEsSUFDVDtBQUFBLEVBQ0Y7QUFDQSxTQUFPO0FBQ1Q7QUFPTyxTQUFTLDRCQUNkLFVBQ0EsUUFDTTtBQUNOLFFBQU0sVUFBMkIsQ0FBQyxXQUFXO0FBQzNDLFVBQU0sU0FBUyxrQkFBa0IsTUFBTTtBQUN2QyxRQUFJLENBQUMsT0FBTyxJQUFJO0FBRWQsVUFBSSxPQUFPLFVBQVUseUJBQXlCO0FBQzVDLFlBQUksd0JBQU8sd0JBQXdCLE9BQU8sS0FBSyxFQUFFO0FBQUEsTUFDbkQ7QUFDQTtBQUFBLElBQ0Y7QUFDQSxTQUFLLE9BQU8sT0FBTyxJQUFJLEVBQUUsTUFBTSxDQUFDLFVBQW1CO0FBQ2pELGNBQVEsTUFBTSxrQ0FBa0MsS0FBSztBQUNyRCxVQUFJLHdCQUFPLHdFQUFtRTtBQUFBLElBQ2hGLENBQUM7QUFBQSxFQUNIO0FBQ0EsV0FBUyxpQkFBaUIsT0FBTztBQUVqQyxXQUFTLEdBQUcsZUFBZSxTQUFTLE9BQU87QUFDN0M7OztBQzFFTyxJQUFNLDRCQUE0QjtBQUNsQyxJQUFNLDJCQUEyQjtBQU1qQyxTQUFTLGVBQWUsU0FBaUIsVUFBMEIsQ0FBQyxHQUFXO0FBM0J0RjtBQTRCRSxRQUFNLFFBQU8sYUFBUSxXQUFSLFlBQWtCO0FBQy9CLFFBQU0sT0FBTSxhQUFRLFVBQVIsWUFBaUI7QUFDN0IsUUFBTSxVQUFTLGFBQVEsV0FBUixZQUFrQjtBQUNqQyxRQUFNLFVBQVMsYUFBUSxXQUFSLFlBQWtCLEtBQUs7QUFDdEMsUUFBTSxjQUFjLEtBQUssSUFBSSxLQUFLLE9BQU8sS0FBSyxPQUFPO0FBQ3JELFFBQU0sU0FBUyxLQUFLLE9BQU8sSUFBSSxJQUFJLEtBQUs7QUFDeEMsU0FBTyxLQUFLLE1BQU0sS0FBSyxJQUFJLEtBQUssS0FBSyxJQUFJLEtBQUssY0FBYyxNQUFNLENBQUMsQ0FBQztBQUN0RTtBQVNPLElBQU0sc0JBQU4sTUFBMEI7QUFBQSxFQUsvQixZQUFZLFVBQTBCLENBQUMsR0FBRztBQUoxQyx3QkFBUSxXQUFVO0FBQ2xCLHdCQUFRLGFBQVk7QUFDcEIsd0JBQWlCO0FBR2YsU0FBSyxVQUFVO0FBQUEsRUFDakI7QUFBQTtBQUFBLEVBR0EsU0FBUyxPQUEyQztBQUNsRCxRQUFJLFVBQVUsZ0JBQWdCO0FBQzVCLFdBQUssVUFBVTtBQUNmLFdBQUssWUFBWTtBQUNqQixhQUFPLEVBQUUsUUFBUSxPQUFPO0FBQUEsSUFDMUI7QUFDQSxRQUFJLEtBQUssVUFBVyxRQUFPLEVBQUUsUUFBUSxPQUFPO0FBQzVDLFdBQU8sRUFBRSxRQUFRLGFBQWEsU0FBUyxlQUFlLEtBQUssU0FBUyxLQUFLLE9BQU8sRUFBRTtBQUFBLEVBQ3BGO0FBQUE7QUFBQSxFQUdBLGVBQXFCO0FBQ25CLFNBQUssV0FBVztBQUNoQixTQUFLLFlBQVk7QUFBQSxFQUNuQjtBQUFBO0FBQUEsRUFHQSxVQUFnQjtBQUNkLFNBQUssWUFBWTtBQUFBLEVBQ25CO0FBQUE7QUFBQSxFQUdBLElBQUksV0FBbUI7QUFDckIsV0FBTyxLQUFLO0FBQUEsRUFDZDtBQUNGOzs7QUN0RUEsSUFBQUMsbUJBQXlEOzs7QUNxQmxELFNBQVMsWUFBWSxXQUEyQjtBQUNyRCxRQUFNLFVBQVUsS0FBSyxJQUFJLEdBQUcsS0FBSyxNQUFNLFlBQVksR0FBSSxDQUFDO0FBQ3hELE1BQUksVUFBVSxHQUFJLFFBQU8sR0FBRyxPQUFPO0FBQ25DLFFBQU0sVUFBVSxLQUFLLE1BQU0sVUFBVSxFQUFFO0FBQ3ZDLE1BQUksVUFBVSxHQUFJLFFBQU8sR0FBRyxPQUFPO0FBQ25DLFNBQU8sR0FBRyxLQUFLLE1BQU0sVUFBVSxFQUFFLENBQUM7QUFDcEM7QUFHTyxTQUFTLGNBQWMsUUFBMEIsS0FBcUI7QUFDM0UsVUFBUSxPQUFPLE9BQU87QUFBQSxJQUNwQixLQUFLO0FBQUEsSUFDTCxLQUFLO0FBQ0gsYUFBTztBQUFBLElBQ1QsS0FBSztBQUNILGFBQU87QUFBQSxJQUNULEtBQUs7QUFDSCxVQUFJLE9BQU8sVUFBVSxTQUFTLEVBQUcsUUFBTyx5QkFBb0IsT0FBTyxVQUFVLE1BQU07QUFDbkYsVUFBSSxPQUFPLGVBQWUsS0FBTSxRQUFPO0FBQ3ZDLGFBQU8sY0FBUyxZQUFZLE1BQU0sT0FBTyxVQUFVLENBQUM7QUFBQSxJQUN0RCxLQUFLO0FBQ0gsYUFBTztBQUFBLEVBQ1g7QUFDRjtBQUdPLFNBQVMsaUJBQWlCLFFBQTBCLFNBQXdCLEtBQXFCO0FBQ3RHLFFBQU0sYUFBd0Q7QUFBQSxJQUM1RCxNQUFNO0FBQUEsSUFDTixZQUFZO0FBQUEsSUFDWixTQUFTO0FBQUEsSUFDVCxNQUFNO0FBQUEsSUFDTixjQUFjO0FBQUEsRUFDaEI7QUFDQSxRQUFNLFFBQVEsQ0FBQywrQkFBMEIsV0FBVyxPQUFPLEtBQUssQ0FBQyxFQUFFO0FBQ25FLE1BQUksUUFBUSxRQUFRLEdBQUksT0FBTSxLQUFLLFdBQVcsUUFBUSxHQUFHLEVBQUU7QUFDM0QsTUFBSSxRQUFRLGVBQWUsR0FBSSxPQUFNLEtBQUssV0FBVyxRQUFRLFVBQVUsRUFBRTtBQUN6RSxRQUFNO0FBQUEsSUFDSixPQUFPLGVBQWUsT0FDbEIscUJBQ0EsY0FBYyxZQUFZLE1BQU0sT0FBTyxVQUFVLENBQUM7QUFBQSxFQUN4RDtBQUNBLFFBQU0sS0FBSyxvQkFBb0IsT0FBTyxPQUFPLEVBQUU7QUFDL0MsUUFBTSxLQUFLLGNBQWMsT0FBTyxVQUFVLE1BQU0sRUFBRTtBQUNsRCxNQUFJLE9BQU8sVUFBVSxTQUFTLEdBQUc7QUFDL0IsVUFBTSxLQUFLLG9CQUFvQixPQUFPLFVBQVUsSUFBSSxDQUFDLE1BQU0sRUFBRSxJQUFJLEVBQUUsS0FBSyxJQUFJLENBQUMsRUFBRTtBQUFBLEVBQ2pGO0FBQ0EsTUFBSSxRQUFRLFNBQVMsVUFBYSxRQUFRLFNBQVMsR0FBSSxPQUFNLEtBQUssUUFBUSxJQUFJO0FBQzlFLFNBQU8sTUFBTSxLQUFLLElBQUk7QUFDeEI7QUFHTyxTQUFTLGVBQWUsUUFBa0M7QUFDL0QsTUFBSSxPQUFPLFVBQVUsZUFBZ0IsUUFBTztBQUM1QyxNQUFJLE9BQU8sVUFBVSxTQUFTLEVBQUcsUUFBTztBQUN4QyxTQUFPO0FBQ1Q7QUFNTyxJQUFNLHNCQUFOLE1BQU0sb0JBQW1CO0FBQUEsRUFLOUIsWUFBNkIsTUFBc0I7QUFBdEI7QUFBQSxFQUF1QjtBQUFBLEVBRXBELE9BQU8sUUFBMEIsU0FBd0IsS0FBbUI7QUFuRzlFO0FBb0dJLFNBQUssS0FBSyxjQUFjLGNBQWMsUUFBUSxHQUFHO0FBQ2pELHFCQUFLLE1BQUssYUFBViw0QkFBcUIsb0JBQW1CO0FBQ3hDLFVBQU0sV0FBVyxlQUFlLE1BQU07QUFDdEMsZUFBVyxPQUFPLG9CQUFtQixrQkFBa0I7QUFDckQsVUFBSSxRQUFRLFNBQVUsa0JBQUssTUFBSyxhQUFWLDRCQUFxQjtBQUFBLFVBQ3RDLGtCQUFLLE1BQUssZ0JBQVYsNEJBQXdCO0FBQUEsSUFDL0I7QUFDQSxxQkFBSyxNQUFLLGlCQUFWLDRCQUF5QixTQUFTLGlCQUFpQixRQUFRLFNBQVMsR0FBRztBQUFBLEVBQ3pFO0FBQ0Y7QUFBQTtBQWZFLGNBRlcscUJBRWEsY0FBYTtBQUNyQyxjQUhXLHFCQUdhLG9CQUFtQixDQUFDLFlBQVksV0FBVztBQUg5RCxJQUFNLHFCQUFOOzs7QURsRUEsSUFBTSxhQUNYO0FBSUssU0FBUyxpQkFBdUI7QUFDckMsTUFBSSxPQUFPLFdBQVcsWUFBYTtBQUNuQyxTQUFPLEtBQUssWUFBWSxRQUFRO0FBQ2xDO0FBR08sSUFBTSxlQUFOLGNBQTJCLHVCQUFNO0FBQUEsRUFDdEMsWUFDRSxLQUNpQixTQU1qQjtBQUNBLFVBQU0sR0FBRztBQVBRO0FBQUEsRUFRbkI7QUFBQSxFQUVTLFNBQWU7QUFDdEIsUUFBSSx5QkFBUSxLQUFLLFNBQVMsRUFBRSxRQUFRLEtBQUssUUFBUSxLQUFLLEVBQUUsUUFBUSxLQUFLLFFBQVEsSUFBSTtBQUNqRixRQUFJLHlCQUFRLEtBQUssU0FBUyxFQUFFO0FBQUEsTUFBVSxDQUFDLFdBQ3JDLE9BQU8sY0FBYyxRQUFRLEVBQUUsUUFBUSxNQUFNLEtBQUssTUFBTSxDQUFDO0FBQUEsSUFDM0Q7QUFDQSxRQUFJLHlCQUFRLEtBQUssU0FBUyxFQUFFO0FBQUEsTUFBVSxDQUFDLFdBQ3JDLE9BQ0csT0FBTyxFQUNQLGNBQWMsS0FBSyxRQUFRLFdBQVcsRUFDdEMsUUFBUSxZQUFZO0FBQ25CLGFBQUssTUFBTTtBQUNYLGNBQU0sS0FBSyxRQUFRLFVBQVU7QUFBQSxNQUMvQixDQUFDO0FBQUEsSUFDTDtBQUFBLEVBQ0Y7QUFDRjtBQUVPLElBQU0sc0JBQU4sY0FBa0Msa0NBQWlCO0FBQUEsRUFReEQsWUFBWSxLQUFVLFFBQXlCO0FBQzdDLFVBQU0sS0FBSyxNQUFNO0FBUm5CLHdCQUFpQjtBQUVqQjtBQUFBLHdCQUFRLGVBQWM7QUFDdEIsd0JBQVEsZUFBOEI7QUFDdEMsd0JBQVEsaUJBQWdDO0FBQ3hDLHdCQUFRLGlCQUF1RDtBQUk3RCxTQUFLLFNBQVM7QUFBQSxFQUNoQjtBQUFBLEVBRVMsVUFBZ0I7QUFDdkIsU0FBSyxZQUFZO0FBQ2pCLFVBQU0sRUFBRSxZQUFZLElBQUk7QUFDeEIsZ0JBQVksTUFBTTtBQUNsQixTQUFLLGNBQWM7QUFDbkIsU0FBSyxnQkFBZ0I7QUFFckIsU0FBSyx3QkFBd0I7QUFDN0IsUUFBSSxLQUFLLE9BQU8sUUFBUTtBQUN0QixXQUFLLG9CQUFvQjtBQUFBLElBQzNCLE9BQU87QUFDTCxXQUFLLHFCQUFxQjtBQUFBLElBQzVCO0FBQ0EsU0FBSyxhQUFhO0FBQUEsRUFDcEI7QUFBQSxFQUVTLE9BQWE7QUFDcEIsU0FBSyxZQUFZO0FBQUEsRUFDbkI7QUFBQTtBQUFBLEVBSVEsMEJBQWdDO0FBQ3RDLFVBQU0sRUFBRSxZQUFZLElBQUk7QUFDeEIsUUFBSSx5QkFBUSxXQUFXLEVBQ3BCLFFBQVEsWUFBWSxFQUNwQjtBQUFBLE1BQ0M7QUFBQSxJQUNGLEVBQ0M7QUFBQSxNQUFRLENBQUMsU0FDUixLQUNHLGVBQWUsZ0NBQWdDLEVBQy9DLFNBQVMsS0FBSyxPQUFPLEtBQUssR0FBRyxFQUM3QixTQUFTLE9BQU8sVUFBVTtBQUN6QixhQUFLLE9BQU8sS0FBSyxNQUFNLE1BQU0sS0FBSztBQUNsQyxjQUFNLEtBQUssT0FBTyxlQUFlO0FBQUEsTUFDbkMsQ0FBQztBQUFBLElBQ0w7QUFFRixRQUFJLHlCQUFRLFdBQVcsRUFDcEIsUUFBUSxhQUFhLEVBQ3JCLFFBQVEsd0VBQXdFLEVBQ2hGO0FBQUEsTUFBUSxDQUFDLFNBQ1IsS0FDRyxlQUFlLGtCQUFrQixDQUFDLEVBQ2xDLFNBQVMsS0FBSyxPQUFPLEtBQUssVUFBVSxFQUNwQyxTQUFTLE9BQU8sVUFBVTtBQUN6QixhQUFLLE9BQU8sS0FBSyxhQUFhLE1BQU0sS0FBSztBQUN6QyxjQUFNLEtBQUssT0FBTyxlQUFlO0FBQUEsTUFDbkMsQ0FBQztBQUFBLElBQ0w7QUFBQSxFQUNKO0FBQUEsRUFFUSx1QkFBNkI7QUFDbkMsVUFBTSxFQUFFLFlBQVksSUFBSTtBQUN4QixRQUFJLHlCQUFRLFdBQVcsRUFDcEIsUUFBUSxjQUFjLEVBQ3RCLFFBQVEsNkdBQXdHLEVBQ2hIO0FBQUEsTUFBUSxDQUFDLFNBQ1IsS0FDRyxlQUFlLFdBQVcsRUFDMUIsU0FBUyxDQUFDLFVBQVU7QUFDbkIsYUFBSyxjQUFjLE1BQU0sS0FBSztBQUFBLE1BQ2hDLENBQUM7QUFBQSxJQUNMO0FBRUYsUUFBSSx5QkFBUSxXQUFXLEVBQUU7QUFBQSxNQUFVLENBQUMsV0FDbEMsT0FDRyxPQUFPLEVBQ1AsY0FBYyxpQkFBaUIsRUFDL0IsUUFBUSxZQUFZO0FBQ25CLGVBQU8sWUFBWSxJQUFJO0FBQ3ZCLFlBQUk7QUFDRixnQkFBTSxVQUFVLE1BQU0sS0FBSyxPQUFPLGlCQUFpQixLQUFLLFdBQVc7QUFDbkUsZUFBSyxZQUFZLE9BQU87QUFBQSxRQUMxQixVQUFFO0FBQ0EsaUJBQU8sWUFBWSxLQUFLO0FBQUEsUUFDMUI7QUFBQSxNQUNGLENBQUM7QUFBQSxJQUNMO0FBRUEsU0FBSyxjQUFjLElBQUkseUJBQVEsV0FBVyxFQUN2QyxRQUFRLGlCQUFpQixFQUN6QixTQUFTLG1CQUFtQixFQUM1QjtBQUFBLE1BQ0M7QUFBQSxRQUNFO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsTUFDRixFQUFFLEtBQUssSUFBSTtBQUFBLElBQ2IsRUFDQztBQUFBLE1BQVUsQ0FBQyxXQUNWLE9BQU8sY0FBYyxvQkFBb0IsRUFBRSxRQUFRLE1BQU0sZUFBZSxDQUFDO0FBQUEsSUFDM0U7QUFBQSxFQUNKO0FBQUEsRUFFUSxzQkFBNEI7QUFDbEMsVUFBTSxFQUFFLFlBQVksSUFBSTtBQUN4QixVQUFNLE9BQU8sS0FBSyxPQUFPO0FBRXpCLFNBQUssZ0JBQWdCLElBQUkseUJBQVEsV0FBVyxFQUN6QyxRQUFRLFFBQVEsRUFDaEIsU0FBUyxvQkFBb0IsRUFDN0IsUUFBUSxLQUFLLFdBQVcsQ0FBQztBQUU1QixRQUFJLHlCQUFRLFdBQVcsRUFBRTtBQUFBLE1BQVUsQ0FBQyxXQUNsQyxPQUFPLGNBQWMsVUFBVSxFQUFFLFFBQVEsWUFBWTtBQUNuRCxlQUFPLFlBQVksSUFBSTtBQUN2QixZQUFJO0FBQ0YsZ0JBQU0sS0FBSyxPQUFPLFFBQVE7QUFBQSxRQUM1QixVQUFFO0FBQ0EsaUJBQU8sWUFBWSxLQUFLO0FBQ3hCLGVBQUssY0FBYztBQUFBLFFBQ3JCO0FBQUEsTUFDRixDQUFDO0FBQUEsSUFDSDtBQUVBLFFBQUkseUJBQVEsV0FBVyxFQUNwQixRQUFRLGlCQUFpQixFQUN6QjtBQUFBLE1BQ0M7QUFBQSxJQUNGLEVBQ0MsWUFBWSxDQUFDLGFBQWE7QUFDekIsaUJBQVcsVUFBVSx5QkFBeUI7QUFDNUMsaUJBQVMsVUFBVSxPQUFPLE9BQU8sS0FBSyxHQUFHLE9BQU8sS0FBSztBQUFBLE1BQ3ZEO0FBQ0EsZUFBUyxTQUFTLE9BQU8sS0FBSyxTQUFTLGlCQUFpQixDQUFDO0FBQ3pELGVBQVMsU0FBUyxPQUFPLFVBQVU7QUFDakMsY0FBTSxLQUFLLE9BQU8sb0JBQW9CLE9BQU8sS0FBSyxDQUFDO0FBQUEsTUFDckQsQ0FBQztBQUFBLElBQ0gsQ0FBQztBQUVILFFBQUkseUJBQVEsV0FBVyxFQUNwQixRQUFRLHdCQUF3QixFQUNoQztBQUFBLE1BQ0M7QUFBQSxJQUVGLEVBQ0M7QUFBQSxNQUFVLENBQUMsV0FDVixPQUFPLFNBQVMsS0FBSyxTQUFTLFlBQVksRUFBRSxTQUFTLE9BQU8sVUFBVTtBQUNwRSxjQUFNLEtBQUssT0FBTyxrQkFBa0IsS0FBSztBQUFBLE1BQzNDLENBQUM7QUFBQSxJQUNIO0FBRUYsUUFBSSx5QkFBUSxXQUFXLEVBQUU7QUFBQSxNQUFVLENBQUMsV0FDbEMsT0FBTyxjQUFjLG1CQUFtQixFQUFFLFFBQVEsTUFBTTtBQUN0RCxZQUFJLGFBQWEsS0FBSyxLQUFLO0FBQUEsVUFDekIsT0FBTztBQUFBLFVBQ1AsTUFBTTtBQUFBLFVBQ04sYUFBYTtBQUFBLFVBQ2IsV0FBVyxZQUFZO0FBQ3JCLGtCQUFNLEtBQUssT0FBTyxPQUFPO0FBQ3pCLGlCQUFLLFFBQVE7QUFBQSxVQUNmO0FBQUEsUUFDRixDQUFDLEVBQUUsS0FBSztBQUFBLE1BQ1YsQ0FBQztBQUFBLElBQ0g7QUFBQSxFQUNGO0FBQUE7QUFBQSxFQUlRLGFBQXFCO0FBbFAvQjtBQW1QSSxVQUFNLE9BQTRCLEtBQUssT0FBTztBQUM5QyxVQUFNLFVBQVMsVUFBSyxPQUFPLFdBQVosbUJBQW9CO0FBQ25DLFFBQUksV0FBVyxRQUFXO0FBQ3hCLGFBQU8sYUFBYSxLQUFLLEdBQUcsWUFBWSxLQUFLLGNBQWMsS0FBSyxRQUFRO0FBQUEsSUFDMUU7QUFDQSxVQUFNLFdBQ0osT0FBTyxlQUFlLE9BQ2xCLFVBQ0EsR0FBRyxZQUFZLEtBQUssSUFBSSxJQUFJLE9BQU8sVUFBVSxDQUFDO0FBQ3BELFVBQU0sUUFBUSxPQUFPLFVBQVUsU0FBUyxjQUFjLE9BQU87QUFDN0QsV0FBTztBQUFBLE1BQ0wsVUFBVSxLQUFLO0FBQUEsTUFDZixXQUFXLEtBQUssR0FBRztBQUFBLE1BQ25CLGNBQWMsUUFBUTtBQUFBLE1BQ3RCLG9CQUFvQixPQUFPLE9BQU87QUFBQSxNQUNsQyxjQUFjLE9BQU8sVUFBVSxNQUFNLEdBQUcsT0FBTyxVQUFVLFNBQVMsSUFBSSxtREFBbUQsRUFBRTtBQUFBLElBQzdILEVBQUUsS0FBSyxJQUFJO0FBQUEsRUFDYjtBQUFBLEVBRVEsZ0JBQXNCO0FBdFFoQztBQXVRSSxlQUFLLGtCQUFMLG1CQUFvQixRQUFRLEtBQUssV0FBVztBQUFBLEVBQzlDO0FBQUE7QUFBQSxFQUdRLFlBQVksU0FBNEI7QUFDOUMsUUFBSSxRQUFRLFdBQVcsVUFBVTtBQUMvQixVQUFJLHdCQUFPLG1CQUFtQixPQUFPLENBQUM7QUFDdEMsV0FBSyxRQUFRO0FBQ2I7QUFBQSxJQUNGO0FBQ0EsVUFBTSxVQUFVLG1CQUFtQixPQUFPO0FBQzFDLFFBQUksd0JBQU8sU0FBUyxHQUFLO0FBQ3pCLFFBQUksS0FBSyxnQkFBZ0IsS0FBTSxNQUFLLFlBQVksUUFBUSxPQUFPO0FBQUEsRUFDakU7QUFBQTtBQUFBO0FBQUEsRUFLUSxlQUFxQjtBQUMzQixTQUFLLFlBQVk7QUFDakIsVUFBTSxTQUFTLFlBQVksTUFBTSxLQUFLLGNBQWMsR0FBRyxHQUFJO0FBQzNELFNBQUssZ0JBQWdCO0FBR3JCLFNBQUssT0FBTyxpQkFBaUIsTUFBMkI7QUFBQSxFQUMxRDtBQUFBLEVBRVEsY0FBb0I7QUFDMUIsUUFBSSxLQUFLLGtCQUFrQixNQUFNO0FBQy9CLG9CQUFjLEtBQUssYUFBYTtBQUNoQyxXQUFLLGdCQUFnQjtBQUFBLElBQ3ZCO0FBQUEsRUFDRjtBQUNGOzs7QUU1UE8sU0FBUyxlQUFlLFNBQWlCLE9BQWUsT0FBTyxPQUFlO0FBQ25GLFFBQU0sTUFBTSxJQUFJLElBQUksT0FBTztBQUMzQixNQUFJLElBQUksYUFBYSxRQUFTLEtBQUksV0FBVztBQUFBLFdBQ3BDLElBQUksYUFBYSxTQUFVLEtBQUksV0FBVztBQUFBLFdBQzFDLElBQUksYUFBYSxTQUFTLElBQUksYUFBYSxRQUFRO0FBQzFELFVBQU0sSUFBSSxhQUFhLGtEQUFrRCxJQUFJLFFBQVEsRUFBRTtBQUFBLEVBQ3pGO0FBQ0EsTUFBSSxXQUFXO0FBQ2YsTUFBSSxTQUFTO0FBQ2IsTUFBSSxhQUFhLElBQUksU0FBUyxLQUFLO0FBQ25DLFNBQU8sSUFBSSxTQUFTO0FBQ3RCO0FBRUEsU0FBUyx3QkFBd0IsS0FBNEI7QUFDM0QsUUFBTSxZQUFhLFdBQXVDO0FBQzFELE1BQUksT0FBTyxjQUFjLFlBQVk7QUFDbkMsVUFBTSxJQUFJO0FBQUEsTUFDUjtBQUFBLElBR0Y7QUFBQSxFQUNGO0FBQ0EsU0FBTyxJQUFLLFVBQWlELEdBQUc7QUFDbEU7QUFFTyxJQUFNLHFCQUFOLE1BQThDO0FBQUEsRUFVbkQsWUFBWSxTQUFvQztBQVRoRCx3QkFBaUI7QUFDakIsd0JBQVEsbUJBQXVEO0FBQy9ELHdCQUFRLGlCQUF3RDtBQUNoRSx3QkFBUSxRQUFPO0FBQ2Ysd0JBQVEsVUFBUztBQUNqQix3QkFBUSxpQkFBZ0I7QUFDeEIsd0JBQWlCLGFBQXNCLENBQUM7QUFDeEMsd0JBQVE7QUE3RVY7QUFnRkksVUFBTSxXQUFVLGFBQVEsY0FBUixZQUFxQjtBQUNyQyxVQUFNLE1BQU0sZUFBZSxRQUFRLEtBQUssUUFBUSxRQUFPLGFBQVEsU0FBUixZQUFnQixLQUFLO0FBQzVFLFNBQUssU0FBUyxRQUFRLEdBQUc7QUFFekIsU0FBSyxPQUFPLGlCQUFpQixRQUFRLE1BQU07QUFDekMsV0FBSyxPQUFPO0FBQ1osWUFBTSxTQUFTLENBQUMsR0FBRyxLQUFLLFNBQVM7QUFDakMsV0FBSyxVQUFVLFNBQVM7QUFDeEIsaUJBQVcsU0FBUyxPQUFRLE1BQUssT0FBTyxLQUFLLEtBQUs7QUFBQSxJQUNwRCxDQUFDO0FBRUQsU0FBSyxPQUFPLGlCQUFpQixXQUFXLENBQUMsVUFBVTtBQTNGdkQsVUFBQUM7QUE0Rk0sVUFBSSxPQUFPLE1BQU0sU0FBUyxVQUFVO0FBQ2xDLGFBQUssS0FBSyxFQUFFLE1BQU0sTUFBTSxRQUFRLDZDQUE2QyxDQUFDO0FBQzlFO0FBQUEsTUFDRjtBQUNBLFVBQUk7QUFDSixVQUFJO0FBQ0Ysa0JBQVUsYUFBYSxNQUFNLElBQUk7QUFBQSxNQUNuQyxTQUFTLE9BQU87QUFDZCxhQUFLLEtBQUssRUFBRSxNQUFNLE1BQU0sUUFBUSxpQkFBaUIsUUFBUSxNQUFNLFVBQVUsT0FBTyxLQUFLLEVBQUUsQ0FBQztBQUN4RjtBQUFBLE1BQ0Y7QUFDQSxPQUFBQSxNQUFBLEtBQUssb0JBQUwsZ0JBQUFBLElBQUEsV0FBdUI7QUFBQSxJQUN6QixDQUFDO0FBRUQsU0FBSyxPQUFPLGlCQUFpQixTQUFTLENBQUMsVUFBVTtBQUMvQyxXQUFLLFlBQ0gsaUJBQWlCLFFBQVEsTUFBTSxVQUFVLFVBQVUsU0FBWSxPQUFPLEtBQUssSUFBSTtBQUFBLElBQ25GLENBQUM7QUFFRCxTQUFLLE9BQU8saUJBQWlCLFNBQVMsQ0FBQyxVQUFVO0FBQy9DLFdBQUssWUFBWTtBQUFBLFFBQ2YsTUFBTSxNQUFNO0FBQUEsUUFDWixRQUFRLE1BQU0sV0FBVyxVQUFhLE1BQU0sV0FBVyxLQUFLLE1BQU0sU0FBUyxLQUFLO0FBQUEsTUFDbEYsQ0FBQztBQUFBLElBQ0gsQ0FBQztBQUFBLEVBQ0g7QUFBQSxFQUVBLEtBQUssU0FBd0I7QUFDM0IsUUFBSSxLQUFLLE9BQVEsT0FBTSxJQUFJLGFBQWEsNEJBQTRCO0FBQ3BFLFVBQU0sUUFBUSxLQUFLLFVBQVUsT0FBTztBQUNwQyxRQUFJLEtBQUssTUFBTTtBQUNiLFdBQUssT0FBTyxLQUFLLEtBQUs7QUFDdEI7QUFBQSxJQUNGO0FBQ0EsU0FBSyxVQUFVLEtBQUssS0FBSztBQUFBLEVBQzNCO0FBQUEsRUFFQSxVQUFVLFVBQTRDO0FBQ3BELFNBQUssa0JBQWtCO0FBQUEsRUFDekI7QUFBQSxFQUVBLFFBQVEsVUFBK0M7QUFDckQsU0FBSyxnQkFBZ0I7QUFBQSxFQUN2QjtBQUFBLEVBRUEsUUFBYztBQUNaLFFBQUksS0FBSyxPQUFRO0FBQ2pCLFNBQUssU0FBUztBQUNkLFNBQUssVUFBVSxTQUFTO0FBQ3hCLFFBQUk7QUFDRixXQUFLLE9BQU8sTUFBTSxLQUFNLGtCQUFrQjtBQUFBLElBQzVDLFNBQVE7QUFBQSxJQUVSO0FBRUEsU0FBSyxZQUFZLEVBQUUsTUFBTSxLQUFNLFFBQVEsbUJBQW1CLENBQUM7QUFBQSxFQUM3RDtBQUFBLEVBRVEsS0FBSyxRQUEyQjtBQXRKMUM7QUF1SkksU0FBSyxTQUFTO0FBQ2QsUUFBSTtBQUNGLFdBQUssT0FBTyxPQUFNLFlBQU8sU0FBUCxZQUFlLE9BQU0sWUFBTyxXQUFQLFlBQWlCLEVBQUU7QUFBQSxJQUM1RCxTQUFRO0FBQUEsSUFFUjtBQUNBLFNBQUssWUFBWSxNQUFNO0FBQUEsRUFDekI7QUFBQSxFQUVRLFlBQVksUUFBMkI7QUFoS2pEO0FBaUtJLFNBQUssT0FBTztBQUNaLFNBQUssU0FBUztBQUNkLFFBQUksS0FBSyxjQUFlO0FBQ3hCLFNBQUssZ0JBQWdCO0FBQ3JCLGVBQUssa0JBQUwsOEJBQXFCO0FBQUEsRUFDdkI7QUFDRjs7O0F2QjlIQSxJQUFNLDJCQUEyQjtBQUNqQyxJQUFNLHlCQUF5QjtBQUMvQixJQUFNLHNCQUFzQjtBQWNyQixJQUFNLGtCQUFOLGNBQThCLHdCQUFPO0FBQUEsRUF1QjFDLFlBQVksS0FBVSxVQUEwQixZQUE2QixDQUFDLEdBQUc7QUFDL0UsVUFBTSxLQUFLLFFBQVE7QUF2QnJCLGdDQUE0QixrQkFBa0I7QUFFOUM7QUFBQSxrQ0FBNEI7QUFFNUIsd0JBQWlCO0FBQ2pCLHdCQUFRLFdBQXVDO0FBQy9DLHdCQUFRLFVBQWlDO0FBQ3pDLHdCQUFRLGFBQXVDO0FBQy9DLHdCQUFRLGlCQUFvQztBQUM1Qyx3QkFBUSxjQUFpQztBQUN6Qyx3QkFBUSxrQkFBcUM7QUFDN0Msd0JBQVEsY0FBYSxJQUFJLG9CQUFvQjtBQUU3QztBQUFBLHdCQUFRLGNBQWE7QUFDckIsd0JBQVEsY0FBYTtBQUNyQix3QkFBaUIsV0FBc0I7QUFBQSxNQUNyQyxPQUFPLElBQUksU0FBb0IsUUFBUSxNQUFNLFNBQVMsR0FBRyxJQUFJO0FBQUEsTUFDN0QsTUFBTSxJQUFJLFNBQW9CLFFBQVEsS0FBSyxTQUFTLEdBQUcsSUFBSTtBQUFBLE1BQzNELE1BQU0sSUFBSSxTQUFvQixRQUFRLEtBQUssU0FBUyxHQUFHLElBQUk7QUFBQSxNQUMzRCxPQUFPLElBQUksU0FBb0IsUUFBUSxNQUFNLFNBQVMsR0FBRyxJQUFJO0FBQUEsSUFDL0Q7QUFJRSxTQUFLLFlBQVk7QUFBQSxFQUNuQjtBQUFBLEVBRUEsSUFBWSxNQUFvQjtBQXJGbEM7QUFzRkksWUFBTyxVQUFLLFVBQVUsUUFBZixhQUF1QixNQUFNLEtBQUssSUFBSTtBQUFBLEVBQy9DO0FBQUEsRUFFQSxJQUFZLFlBQTBCO0FBekZ4QztBQStGSSxZQUFPLFVBQUssVUFBVSxjQUFmLFlBQTRCLFdBQVcsTUFBTSxLQUFLLFVBQVU7QUFBQSxFQUNyRTtBQUFBLEVBRUEsSUFBSSxTQUFrQjtBQUNwQixXQUFPLFNBQVMsS0FBSyxJQUFJO0FBQUEsRUFDM0I7QUFBQSxFQUVBLE1BQWUsU0FBd0I7QUFDckMsU0FBSyxPQUFPLG9CQUFvQixNQUFNLEtBQUssU0FBUyxDQUFDO0FBQ3JELFNBQUssY0FBYyxJQUFJLG9CQUFvQixLQUFLLEtBQUssSUFBSSxDQUFDO0FBQzFEO0FBQUEsTUFDRSxDQUFDLFFBQVEsWUFBWSxLQUFLLGdDQUFnQyxRQUFRLE9BQU87QUFBQSxNQUN6RSxDQUFDLFNBQVMsS0FBSyxtQkFBbUIsS0FBSyxLQUFLLEtBQUssSUFBSTtBQUFBLElBQ3ZEO0FBR0EsU0FBSyxjQUFjLEtBQUssSUFBSSxVQUFVLEdBQUcsc0JBQXNCLE1BQUc7QUEvR3RFO0FBK0d5RSx3QkFBSyxXQUFMLG1CQUFhO0FBQUEsS0FBTSxDQUFDO0FBQ3pGLFFBQUksS0FBSyxPQUFRLE9BQU0sS0FBSyxVQUFVO0FBQUEsRUFDeEM7QUFBQSxFQUVTLFdBQWlCO0FBQ3hCLFNBQUssU0FBUztBQUFBLEVBQ2hCO0FBQUE7QUFBQSxFQUlBLE1BQU0saUJBQWdDO0FBQ3BDLFVBQU0sS0FBSyxTQUFTLEtBQUssSUFBSTtBQUFBLEVBQy9CO0FBQUE7QUFBQTtBQUFBLEVBS0EsTUFBTSxpQkFBaUIsTUFBb0M7QUFDekQsVUFBTSxhQUFhLEtBQUssa0JBQWtCO0FBQzFDLFVBQU0sVUFBVSxNQUFNLGVBQWU7QUFBQSxNQUNuQyxLQUFLLEtBQUssS0FBSztBQUFBLE1BQ2Y7QUFBQSxNQUNBO0FBQUEsTUFDQSxZQUFZLGlCQUFpQjtBQUFBLE1BQzdCLFdBQVcsS0FBSztBQUFBLElBQ2xCLENBQUM7QUFDRCxVQUFNLEtBQUssaUJBQWlCLFNBQVMsVUFBVTtBQUMvQyxXQUFPO0FBQUEsRUFDVDtBQUFBO0FBQUEsRUFHQSxNQUFjLG1CQUFtQixLQUFhLE1BQTZCO0FBQ3pFLFFBQUksS0FBSyxRQUFRO0FBQ2YsVUFBSSx1QkFBdUIsR0FBRyxNQUFNLHVCQUF1QixLQUFLLEtBQUssR0FBRyxHQUFHO0FBQ3pFLFlBQUksd0JBQU8sMkRBQTJEO0FBQUEsTUFDeEUsT0FBTztBQUNMLFlBQUk7QUFBQSxVQUNGO0FBQUEsVUFDQTtBQUFBLFFBQ0Y7QUFBQSxNQUNGO0FBQ0E7QUFBQSxJQUNGO0FBQ0EsVUFBTSxhQUFhLEtBQUssa0JBQWtCO0FBQzFDLFVBQU0sVUFBVSxNQUFNLGVBQWU7QUFBQSxNQUNuQztBQUFBLE1BQ0E7QUFBQSxNQUNBO0FBQUEsTUFDQSxZQUFZLGlCQUFpQjtBQUFBLE1BQzdCLFdBQVcsS0FBSztBQUFBLElBQ2xCLENBQUM7QUFDRCxVQUFNLEtBQUssaUJBQWlCLFNBQVMsVUFBVTtBQUFBLEVBQ2pEO0FBQUEsRUFFQSxNQUFjLGlCQUFpQixTQUFzQixZQUFtQztBQUN0RixRQUFJLFFBQVEsV0FBVyxVQUFVO0FBQy9CLFVBQUksd0JBQU8sbUJBQW1CLE9BQU8sR0FBRyxHQUFLO0FBQzdDO0FBQUEsSUFDRjtBQUNBLFNBQUssS0FBSyxNQUFNLFFBQVE7QUFDeEIsU0FBSyxLQUFLLFFBQVEsUUFBUTtBQUMxQixTQUFLLEtBQUssV0FBVyxRQUFRO0FBQzdCLFNBQUssS0FBSyxhQUFhO0FBQ3ZCLFVBQU0sS0FBSyxlQUFlO0FBQzFCLFVBQU0sS0FBSyxrQkFBa0I7QUFDN0IsUUFBSSx3QkFBTyxtQkFBbUIsT0FBTyxDQUFDO0FBQ3RDLFVBQU0sS0FBSyxVQUFVO0FBQUEsRUFDdkI7QUFBQSxFQUVRLG9CQUE0QjtBQUNsQyxVQUFNLFFBQVEsS0FBSyxLQUFLLFdBQVcsS0FBSztBQUN4QyxXQUFPLFVBQVUsS0FBSyxRQUFRLGtCQUFrQjtBQUFBLEVBQ2xEO0FBQUE7QUFBQSxFQUdBLE1BQWMsb0JBQW1DO0FBQy9DLFFBQUksQ0FBQyxLQUFLLE9BQVE7QUFDbEIsVUFBTSxVQUFVLElBQUksdUJBQXVCLEVBQUUsU0FBUyxLQUFLLElBQUksTUFBTSxRQUFRLENBQUM7QUFDOUUsVUFBTSxTQUFTO0FBQUEsTUFDYixVQUFVLEtBQUssS0FBSztBQUFBLE1BQ3BCLFlBQVksS0FBSyxrQkFBa0I7QUFBQSxNQUNuQyxLQUFLLEtBQUssS0FBSztBQUFBLE1BQ2YsVUFBVSxLQUFLLElBQUk7QUFBQSxJQUNyQjtBQUNBLFFBQUk7QUFDRixZQUFNLFFBQVE7QUFBQSxRQUNaO0FBQUEsUUFDQSxJQUFJLFlBQVksRUFBRSxPQUFPLEdBQUcsS0FBSyxVQUFVLFFBQVEsTUFBTSxDQUFDLENBQUM7QUFBQSxDQUFJO0FBQUEsTUFDakU7QUFBQSxJQUNGLFNBQVMsT0FBTztBQUNkLFdBQUssUUFBUSxLQUFLLGlDQUFpQyxLQUFLO0FBQUEsSUFDMUQ7QUFBQSxFQUNGO0FBQUE7QUFBQTtBQUFBLEVBS0EsTUFBYyxZQUEyQjtBQWhOM0M7QUFpTkksUUFBSSxDQUFDLEtBQUssT0FBUTtBQUNsQixTQUFLLFNBQVM7QUFFZCxVQUFNLEVBQUUsS0FBSyxPQUFPLFNBQVMsSUFBSSxLQUFLO0FBQ3RDLFVBQU0sYUFBYSxLQUFLLGtCQUFrQjtBQUMxQyxVQUFNLFVBQVUsSUFBSSx1QkFBdUIsRUFBRSxTQUFTLEtBQUssSUFBSSxNQUFNLFFBQVEsQ0FBQztBQUM5RSxVQUFNLEtBQUssc0JBQXNCLE9BQU87QUFFeEMsVUFBTSxTQUFTLElBQUksV0FBVztBQUFBLE1BQzVCO0FBQUEsTUFDQTtBQUFBLE1BQ0E7QUFBQSxNQUNBLFdBQVcsTUFBTSxJQUFJLG1CQUFtQixFQUFFLEtBQUssT0FBTyxXQUFXLEtBQUssVUFBVSxVQUFVLENBQUM7QUFBQSxNQUMzRixXQUFXLElBQUksY0FBYyxFQUFFLFNBQVMsS0FBSyxPQUFPLFdBQVcsS0FBSyxVQUFVLENBQUM7QUFBQSxNQUMvRTtBQUFBLE1BQ0EsVUFBVSxFQUFFLGNBQWMsS0FBSyxLQUFLLFNBQVMsYUFBYTtBQUFBLE1BQzFELEtBQUssS0FBSztBQUFBLE1BQ1YsS0FBSyxLQUFLO0FBQUEsSUFDWixDQUFDO0FBQ0QsU0FBSyxTQUFTO0FBQ2QsU0FBSyxhQUFhO0FBQ2xCLFNBQUssYUFBYTtBQUNsQixTQUFLLGFBQWEsSUFBSSxxQkFBb0IsVUFBSyxVQUFVLGNBQWYsWUFBNEIsQ0FBQyxDQUFDO0FBRXhFLFFBQUk7QUFDRixZQUFNLE9BQU8sUUFBUTtBQUFBLElBQ3ZCLFNBQVMsT0FBTztBQUNkLFdBQUssZ0JBQWdCLE9BQU8scUJBQXFCO0FBQUEsSUFDbkQ7QUFHQSxTQUFLLFVBQVUsSUFBSSxxQkFBcUIsRUFBRSxPQUFPLEtBQUssSUFBSSxNQUFNLENBQUM7QUFDakUsV0FBTyxjQUFjLEtBQUssT0FBTztBQUNqQyxTQUFLLFNBQVMsSUFBSSxnQkFBZ0I7QUFBQSxNQUNoQyxZQUFZLEtBQUssS0FBSyxTQUFTLG9CQUFvQjtBQUFBLElBQ3JELENBQUM7QUFDRCxTQUFLLE9BQU8sTUFBTSxNQUFNO0FBQ3RCLFdBQUssT0FBTyxZQUFZLEVBQUUsTUFBTSxDQUFDLFVBQW1CO0FBQ2xELGFBQUssZ0JBQWdCLE9BQU8sZUFBZTtBQUFBLE1BQzdDLENBQUM7QUFBQSxJQUNILENBQUM7QUFJRCxVQUFNLE9BQU8sS0FBSyxpQkFBaUI7QUFDbkMsU0FBSyxnQkFBZ0I7QUFDckIsU0FBSyxZQUFZLElBQUksbUJBQW1CLElBQUk7QUFDNUMsVUFBTSxPQUFPLFlBQVksTUFBTSxLQUFLLE9BQU8sR0FBRyxtQkFBbUI7QUFDakUsU0FBSyxhQUFhO0FBQ2xCLFNBQUssaUJBQWlCLElBQXlCO0FBQy9DLFNBQUssT0FBTztBQUFBLEVBQ2Q7QUFBQTtBQUFBLEVBR1EsV0FBaUI7QUF2UTNCO0FBd1FJLFFBQUksS0FBSyxtQkFBbUIsTUFBTTtBQUNoQyxtQkFBYSxLQUFLLGNBQWM7QUFDaEMsV0FBSyxpQkFBaUI7QUFBQSxJQUN4QjtBQUNBLFFBQUksS0FBSyxlQUFlLE1BQU07QUFDNUIsb0JBQWMsS0FBSyxVQUFVO0FBQzdCLFdBQUssYUFBYTtBQUFBLElBQ3BCO0FBQ0EsZUFBSyxXQUFMLG1CQUFhO0FBQ2IsU0FBSyxTQUFTO0FBQ2QsZUFBSyxXQUFMLG1CQUFhO0FBQ2IsU0FBSyxTQUFTO0FBQ2QsU0FBSyxVQUFVO0FBQ2YsZUFBSyxrQkFBTCxtQkFBb0I7QUFDcEIsU0FBSyxnQkFBZ0I7QUFDckIsU0FBSyxZQUFZO0FBQUEsRUFDbkI7QUFBQTtBQUFBLEVBSUEsTUFBTSxVQUF5QjtBQUM3QixVQUFNLFNBQVMsS0FBSztBQUNwQixRQUFJLFdBQVcsTUFBTTtBQUNuQixVQUFJLHdCQUFPLHNGQUFpRjtBQUM1RjtBQUFBLElBQ0Y7QUFDQSxRQUFJO0FBQ0YsWUFBTSxPQUFPLFlBQVk7QUFDekIsWUFBTSxTQUFTLE9BQU8sT0FBTztBQUM3QixVQUFJO0FBQUEsUUFDRixPQUFPLFVBQVUsaUJBQ2IsOEVBQ0E7QUFBQSxNQUNOO0FBQUEsSUFDRixTQUFTLE9BQU87QUFDZCxXQUFLLGdCQUFnQixPQUFPLGlCQUFpQjtBQUM3QyxVQUFJLHdCQUFPLHNFQUFpRTtBQUFBLElBQzlFO0FBQUEsRUFDRjtBQUFBLEVBRUEsTUFBTSxTQUF3QjtBQUM1QixTQUFLLFNBQVM7QUFJZCxVQUFNLFVBQVUsSUFBSSx1QkFBdUIsRUFBRSxTQUFTLEtBQUssSUFBSSxNQUFNLFFBQVEsQ0FBQztBQUM5RSxVQUFNLFFBQVEsV0FBVyx3QkFBd0I7QUFDakQsVUFBTSxRQUFRLFdBQVcsc0JBQXNCO0FBQy9DLFNBQUssT0FBTztBQUFBLE1BQ1YsR0FBRyxrQkFBa0I7QUFBQSxNQUNyQixZQUFZLEtBQUssS0FBSztBQUFBLE1BQ3RCLFVBQVUsS0FBSyxLQUFLO0FBQUEsSUFDdEI7QUFDQSxVQUFNLEtBQUssZUFBZTtBQUMxQixRQUFJO0FBQUEsTUFDRjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQUEsRUFFQSxNQUFNLG9CQUFvQixTQUFnQztBQW5VNUQ7QUFvVUksU0FBSyxLQUFLLFNBQVMsb0JBQW9CLEtBQUssSUFBSSxHQUFHLEtBQUssTUFBTSxPQUFPLENBQUM7QUFDdEUsVUFBTSxLQUFLLGVBQWU7QUFDMUIsZUFBSyxXQUFMLG1CQUFhLGNBQWMsS0FBSyxLQUFLLFNBQVMsb0JBQW9CO0FBQUEsRUFDcEU7QUFBQSxFQUVBLE1BQU0sa0JBQWtCLFNBQWlDO0FBQ3ZELFNBQUssS0FBSyxTQUFTLGVBQWU7QUFDbEMsVUFBTSxLQUFLLGVBQWU7QUFDMUIsUUFBSTtBQUFBLE1BQ0YsVUFDSSxxSEFDQTtBQUFBLElBQ047QUFBQSxFQUNGO0FBQUE7QUFBQSxFQUlRLFNBQWU7QUFyVnpCO0FBc1ZJLFVBQU0sU0FBUyxLQUFLO0FBQ3BCLFFBQUksV0FBVyxLQUFNO0FBQ3JCLFVBQU0sU0FBUyxPQUFPLE9BQU87QUFDN0IsZUFBSyxjQUFMLG1CQUFnQjtBQUFBLE1BQ2Q7QUFBQSxNQUNBLEVBQUUsS0FBSyxLQUFLLEtBQUssS0FBSyxZQUFZLEtBQUssa0JBQWtCLEdBQUcsTUFBTSxLQUFLLFdBQVc7QUFBQSxNQUNsRixLQUFLLElBQUk7QUFBQTtBQUVYLFFBQUksS0FBSyxXQUFZO0FBQ3JCLFVBQU0sV0FBVyxLQUFLLFdBQVcsU0FBUyxPQUFPLEtBQUs7QUFDdEQsUUFBSSxTQUFTLFdBQVcsT0FBUTtBQUNoQyxTQUFLLFdBQVcsYUFBYTtBQUM3QixTQUFLLGtCQUFrQixTQUFTLE9BQU87QUFBQSxFQUN6QztBQUFBLEVBRVEsa0JBQWtCLFNBQXVCO0FBQy9DLFFBQUksS0FBSyxtQkFBbUIsS0FBTTtBQUNsQyxTQUFLLGlCQUFpQixXQUFXLE1BQU07QUFDckMsV0FBSyxpQkFBaUI7QUFDdEIsWUFBTSxTQUFTLEtBQUs7QUFDcEIsVUFBSSxXQUFXLE1BQU07QUFDbkIsYUFBSyxXQUFXLFFBQVE7QUFDeEI7QUFBQSxNQUNGO0FBQ0EsYUFDRyxVQUFVLEVBQ1Y7QUFBQSxRQUNDLE1BQU07QUFDSixlQUFLLFdBQVcsUUFBUTtBQUFBLFFBQzFCO0FBQUEsUUFDQSxDQUFDLFVBQW1CO0FBQ2xCLGVBQUssV0FBVyxRQUFRO0FBQ3hCLGVBQUssZ0JBQWdCLE9BQU8sa0JBQWtCO0FBQUEsUUFDaEQ7QUFBQSxNQUNGLEVBQ0MsTUFBTSxNQUFNO0FBQUEsTUFBQyxDQUFDO0FBQUEsSUFDbkIsR0FBRyxPQUFPO0FBQUEsRUFDWjtBQUFBO0FBQUEsRUFHUSxnQkFBZ0IsT0FBZ0IsU0FBdUI7QUFDN0QsUUFBSSxpQkFBaUIsZ0JBQWdCLGlCQUFpQixtQkFBbUI7QUFDdkUsV0FBSyxhQUFhO0FBQ2xCLFdBQUssYUFBYTtBQUNsQixXQUFLLFFBQVEsTUFBTSxTQUFTLEtBQUs7QUFDakMsVUFBSTtBQUFBLFFBQ0Y7QUFBQSxRQUNBO0FBQUEsTUFDRjtBQUNBO0FBQUEsSUFDRjtBQUNBLFNBQUssUUFBUSxLQUFLLFNBQVMsS0FBSztBQUFBLEVBQ2xDO0FBQUE7QUFBQSxFQUdBLE1BQWMsc0JBQXNCLFNBQWdEO0FBQ2xGLFFBQUk7QUFDSixRQUFJO0FBQ0YsWUFBTSxRQUFRLE1BQU0sUUFBUSxTQUFTLHdCQUF3QjtBQUM3RCxlQUFTLEtBQUssTUFBTSxJQUFJLFlBQVksRUFBRSxPQUFPLEtBQUssQ0FBQztBQUFBLElBQ3JELFNBQVE7QUFDTjtBQUFBLElBQ0Y7QUFDQSxRQUNFLE9BQU8sT0FBTyxhQUFhLFlBQzNCLE9BQU8sYUFBYSxLQUFLLEtBQUssVUFDOUI7QUFDQSxZQUFNLE9BQU8sT0FBTyxPQUFPLGVBQWUsV0FBVyxPQUFPLGFBQWEsT0FBTztBQUNoRixZQUFNLFFBQVEsT0FBTyxPQUFPLFFBQVEsV0FBVyxPQUFPLE1BQU07QUFDNUQsVUFBSTtBQUFBLFFBQ0YsNERBQTRELElBQUksZ0JBQWdCLEtBQUs7QUFBQSxRQUdyRjtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBQUEsRUFDRjtBQUNGO0FBRUEsU0FBUyx1QkFBdUIsT0FBdUI7QUFDckQsTUFBSTtBQUNGLFdBQU8sbUJBQW1CLEtBQUs7QUFBQSxFQUNqQyxTQUFRO0FBQ04sV0FBTztBQUFBLEVBQ1Q7QUFDRjsiLAogICJuYW1lcyI6IFsiaW1wb3J0X29ic2lkaWFuIiwgIl9hIiwgIl9iIiwgIl9jIiwgIl9kIiwgIl9lIiwgImltcG9ydF9vYnNpZGlhbiIsICJpbXBvcnRfb2JzaWRpYW4iLCAiX2EiXQp9Cg==
